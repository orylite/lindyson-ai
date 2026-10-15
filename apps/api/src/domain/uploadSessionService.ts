import { createHash, randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { pool, withTransaction, type DbClient } from '../db/pool.js';
import { resolveAssetFolderId } from './assetFolders.js';
import { mapAssetCardRow, type AssetRow } from './assets.js';
import {
  buildUploadedImageThumbnailKey,
  buildUploadedVideoThumbnailKey,
  createUploadedImageThumbnail,
  createUploadedVideoPreview,
  readUploadedMediaMetadata,
  validateUploadedMediaDecoding,
} from './uploadedVideoPreview.js';
import { enqueueUploadSession } from '../queues/uploadQueue.js';
import {
  buildPublicUrl,
  buildUploadFinalObjectKey,
  buildUploadStagingObjectKey,
  copyStoredObject,
  createUploadSignature,
  readStoredObjectSize,
  UPLOAD_MAX_BYTES,
} from '../storage/storageService.js';
import { scheduleObjectDeletion } from './assetDeletionService.js';

export type UploadSource = 'uploaded-video' | 'uploaded-image' | 'uploaded-audio';
export type UploadAssetType = 'video' | 'image' | 'audio';
export type UploadStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired';
export type UploadStage = 'waiting-upload' | 'queued' | 'sealing' | 'validating' | 'probing' |
  'thumbnailing' | 'persisting' | 'completed' | 'failed' | 'canceled' | 'expired';

export interface UploadSessionRow extends QueryResultRow {
  id: string;
  user_id: string;
  object_key: string;
  filename: string;
  content_type: string;
  max_size_bytes: number | string;
  status: UploadStatus;
  asset_id: string | null;
  expires_at: Date | string;
  completed_at: Date | string | null;
  updated_at: Date | string;
  idempotency_key: string;
  request_hash: string;
  source: UploadSource | null;
  asset_type: UploadAssetType;
  asset_name: string;
  folder_id: string | null;
  final_object_key: string | null;
  thumbnail_key: string | null;
  actual_size_bytes: number | string | null;
  sealed_at: Date | string | null;
  sealed_size_bytes: number | string | null;
  retryable: boolean;
  attempt: number;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  heartbeat_at: Date | string | null;
  processing_stage: UploadStage;
  error_code: string | null;
  error_message: string | null;
  cancel_requested_at: Date | string | null;
  retention_until: Date | string;
}

interface UploadSessionPositionRow extends QueryResultRow {
  user_id: string;
  source: UploadSource | null;
  folder_id: string | null;
}

export interface CreateUploadSessionInput {
  filename: string;
  contentType: string;
  sizeBytes?: number;
  source: UploadSource;
  folderId?: string | null;
  idempotencyKey: string;
}

const STAGE_PROGRESS: Record<UploadStage, number> = {
  'waiting-upload': 5,
  queued: 10,
  sealing: 24,
  validating: 40,
  probing: 58,
  thumbnailing: 74,
  persisting: 90,
  completed: 100,
  failed: 100,
  canceled: 100,
  expired: 100,
};

export async function createOrReplayUploadSession(userId: string, input: CreateUploadSessionInput) {
  const normalized = normalizeCreateInput(input);
  const requestHash = hashUploadRequest(normalized);
  const existing = await getUploadSessionByIdempotency(userId, normalized.idempotencyKey);
  let session = existing;

  if (existing) {
    if (existing.request_hash !== requestHash) throw uploadConflict('UPLOAD_IDEMPOTENCY_CONFLICT', '相同幂等键对应的文件信息不同');
    if (existing.status !== 'pending' || existing.processing_stage !== 'waiting-upload') {
      return { signature: null, session: await mapUploadSession(existing) };
    }
  } else {
    const sessionId = randomUUID();
    const objectKey = buildUploadStagingObjectKey({ userId, sessionId, filename: normalized.filename });
    const finalObjectKey = buildUploadFinalObjectKey({ userId, sessionId, filename: normalized.filename });
    session = await withTransaction(async client => {
      const folderId = await resolveAssetFolderId(client, {
        userId,
        folderId: normalized.folderId,
        source: normalized.source,
      });
      const result = await client.query<UploadSessionRow>(
        `INSERT INTO upload_sessions (
           id, user_id, object_key, filename, content_type, max_size_bytes, status,
           expires_at, idempotency_key, request_hash, source, asset_type, asset_name,
           folder_id, final_object_key, retention_until, processing_stage
         ) VALUES (
           $1, $2, $3, $4, $5, $6, 'pending', now() + interval '10 minutes',
           $7, $8, $9, $10, $11, $12, $13, now() + interval '24 hours', 'waiting-upload'
         )
         ON CONFLICT (user_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [
          sessionId, userId, objectKey, normalized.filename, normalized.contentType,
          normalized.sizeBytes, normalized.idempotencyKey, requestHash, normalized.source,
          sourceToType(normalized.source), normalized.assetName, folderId, finalObjectKey,
        ],
      );
      if (result.rows[0]) return result.rows[0];
      const winner = await client.query<UploadSessionRow>(
        'SELECT * FROM upload_sessions WHERE user_id = $1 AND idempotency_key = $2',
        [userId, normalized.idempotencyKey],
      );
      const row = winner.rows[0];
      if (!row || row.request_hash !== requestHash) throw uploadConflict('UPLOAD_IDEMPOTENCY_CONFLICT', '相同幂等键对应的文件信息不同');
      return row;
    });
  }

  if (!session) throw new Error('上传会话创建失败');
  const signature = await createUploadSignature({
    contentType: session.content_type,
    maxSizeBytes: Number(session.max_size_bytes),
    objectKey: session.object_key,
  });
  const refreshed = await pool.query<UploadSessionRow>(
    `UPDATE upload_sessions
     SET expires_at = $3, retention_until = $3::timestamptz + interval '24 hours', updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status = 'pending' AND processing_stage = 'waiting-upload'
     RETURNING *`,
    [session.id, userId, signature.expiresAt],
  );
  const current = refreshed.rows[0];
  if (!current) {
    const replay = await pool.query<UploadSessionRow>(
      'SELECT * FROM upload_sessions WHERE id = $1 AND user_id = $2',
      [session.id, userId],
    );
    if (!replay.rows[0]) throw Object.assign(new Error('上传会话不存在'), { statusCode: 404, code: 'UPLOAD_SESSION_NOT_FOUND' });
    return { signature: null, session: await mapUploadSession(replay.rows[0]) };
  }

  return {
    signature: { ...signature, sessionId: current.id },
    session: await mapUploadSession(current),
  };
}

export async function queueUploadCompletion(
  userId: string,
  sessionId: string,
  options: {
    signal?: AbortSignal;
    // 内部调用方可在同一事务内核验并交接上游任务，避免失效执行再次入队。
    beforeQueue?: (client: DbClient) => Promise<void>;
  } = {},
) {
  options.signal?.throwIfAborted();
  const outcome = await withTransaction(async client => {
    options.signal?.throwIfAborted();
    await options.beforeQueue?.(client);
    options.signal?.throwIfAborted();
    const current = await lockOwnedSession(client, userId, sessionId);
    options.signal?.throwIfAborted();
    if (current.status === 'completed' || current.status === 'processing' || current.processing_stage === 'queued') {
      return { session: current, expired: false };
    }
    if (current.status !== 'pending') throw uploadConflict('UPLOAD_SESSION_TERMINAL', '上传会话已经结束');
    if (new Date(current.expires_at).getTime() + 15 * 60_000 <= Date.now()) {
      const expired = await client.query<UploadSessionRow>(
        `UPDATE upload_sessions
         SET status = 'expired', processing_stage = 'expired', retryable = false,
             error_code = 'UPLOAD_SESSION_EXPIRED', error_message = '上传签名及宽限期已过期',
             updated_at = now()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [sessionId, userId],
      );
      await scheduleSessionObjects(client, expired.rows[0]!);
      options.signal?.throwIfAborted();
      return { session: expired.rows[0]!, expired: true };
    }
    const updated = await client.query<UploadSessionRow>(
      `UPDATE upload_sessions
       SET processing_stage = 'queued', error_code = NULL, error_message = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2 AND status = 'pending'
       RETURNING *`,
      [sessionId, userId],
    );
    options.signal?.throwIfAborted();
    return { session: updated.rows[0]!, expired: false };
  });

  if (outcome.expired) {
    throw Object.assign(new Error('上传会话已过期'), { statusCode: 410, code: 'UPLOAD_SESSION_EXPIRED' });
  }
  const result = outcome.session;

  if (result.status === 'pending' && result.processing_stage === 'queued') {
    await enqueueUploadSession(result.id, result.attempt + 1);
  }
  return mapUploadSession(result);
}

export async function getOwnedUploadSession(userId: string, sessionId: string) {
  const result = await pool.query<UploadSessionRow>(
    'SELECT * FROM upload_sessions WHERE id = $1 AND user_id = $2',
    [sessionId, userId],
  );
  if (!result.rows[0]) throw Object.assign(new Error('上传会话不存在'), { statusCode: 404, code: 'UPLOAD_SESSION_NOT_FOUND' });
  return mapUploadSession(result.rows[0]);
}

export async function cancelOwnedUploadSession(userId: string, sessionId: string) {
  const result = await withTransaction(async client => {
    const current = await lockOwnedSession(client, userId, sessionId);
    if (current.status === 'completed' || current.status === 'failed' || current.status === 'expired') {
      throw uploadConflict('UPLOAD_SESSION_TERMINAL', '该上传会话不能取消');
    }
    if (current.status === 'canceled') return current;
    if (current.status === 'processing') {
      const requested = await client.query<UploadSessionRow>(
        `UPDATE upload_sessions SET cancel_requested_at = COALESCE(cancel_requested_at, now()), updated_at = now()
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [sessionId, userId],
      );
      return requested.rows[0]!;
    }
    const canceled = await client.query<UploadSessionRow>(
      `UPDATE upload_sessions
       SET status = 'canceled', processing_stage = 'canceled', cancel_requested_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [sessionId, userId],
    );
    await scheduleSessionObjects(client, canceled.rows[0]!);
    return canceled.rows[0]!;
  });
  return mapUploadSession(result);
}

export async function retryOwnedUploadSession(userId: string, sessionId: string) {
  const result = await withTransaction(async client => {
    const current = await lockOwnedSession(client, userId, sessionId);
    if (current.status !== 'failed' || !current.retryable || new Date(current.retention_until).getTime() <= Date.now()) {
      throw uploadConflict('UPLOAD_RETRY_NOT_ALLOWED', '该上传失败不能重试或已超过保留期');
    }
    const updated = await client.query<UploadSessionRow>(
      `UPDATE upload_sessions
       SET status = 'pending', processing_stage = 'queued', lease_token = NULL,
           lease_expires_at = NULL, heartbeat_at = NULL, error_code = NULL,
           error_message = NULL, retryable = false, cancel_requested_at = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2 AND status = 'failed'
       RETURNING *`,
      [sessionId, userId],
    );
    return updated.rows[0]!;
  });
  await enqueueUploadSession(result.id, result.attempt + 1);
  return mapUploadSession(result);
}

export async function processUploadSession(sessionId: string) {
  const claimed = await claimUploadSession(sessionId);
  if (!claimed) return { skipped: true };
  const token = claimed.lease_token!;
  let unreferencedThumbnailKey: string | null = null;
  const heartbeat = setInterval(() => {
    void heartbeatUploadSession(claimed.id, token).catch(error => console.error(JSON.stringify({
      event: 'upload-session-heartbeat-failed',
      sessionId: claimed.id,
      errorCode: safeErrorCode(error),
    })));
  }, 10_000);
  heartbeat.unref();

  try {
    await assertClaimActive(claimed.id, token);
    if (!claimed.sealed_at) {
      const stagingSize = await readStoredObjectSize(claimed.object_key);
      if (stagingSize !== Number(claimed.max_size_bytes)) {
        throw Object.assign(new Error('上传文件大小与声明值不一致'), { code: 'UPLOAD_SIZE_MISMATCH' });
      }
      await copyStoredObject(claimed.object_key, claimed.final_object_key!);
      await markUploadSealed(claimed.id, token, stagingSize);
    } else {
      await advanceStage(claimed.id, token, 'validating');
    }
    const sizeBytes = await readStoredObjectSize(claimed.final_object_key!);
    if (sizeBytes !== Number(claimed.max_size_bytes)) {
      throw Object.assign(new Error('封口文件大小与声明值不一致'), { code: 'UPLOAD_SIZE_MISMATCH' });
    }

    await advanceStage(claimed.id, token, 'probing');
    const metadata = await readDetectedMediaMetadata(claimed.final_object_key!);
    validateDetectedMedia(claimed, metadata);
    await validateUploadedMediaDecoding({
      objectKey: claimed.final_object_key!,
      assetType: claimed.asset_type,
    });

    let thumbnailKey: string | null = null;
    if (claimed.asset_type === 'video' || claimed.asset_type === 'image') {
      const intendedThumbnailKey = claimed.asset_type === 'video'
        ? buildUploadedVideoThumbnailKey(claimed.user_id, claimed.id)
        : buildUploadedImageThumbnailKey(claimed.user_id, claimed.id);
      await prepareUploadThumbnail(claimed.id, token);
      thumbnailKey = claimed.asset_type === 'video'
        ? (await createUploadedVideoPreview({
            userId: claimed.user_id,
            objectKey: claimed.final_object_key!,
            thumbnailKey: intendedThumbnailKey,
            metadata,
          })).thumbnailKey
        : await createUploadedImageThumbnail({
            objectKey: claimed.final_object_key!,
            thumbnailKey: intendedThumbnailKey,
          });
      if (!thumbnailKey) throw Object.assign(new Error('缩略图生成结果为空'), { code: 'UPLOAD_THUMBNAIL_FAILED' });
      unreferencedThumbnailKey = thumbnailKey;
      await recordUploadedThumbnail(claimed.id, token, thumbnailKey);
      unreferencedThumbnailKey = null;
    }

    await advanceStage(claimed.id, token, 'persisting');
    const asset = await persistCompletedUpload(claimed, token, sizeBytes, metadata, thumbnailKey);
    return { skipped: false, assetId: asset.id };
  } catch (error) {
    await failClaimedUpload(claimed, token, error, unreferencedThumbnailKey);
    // BullMQ 会持久化 failedReason/stack；不得把 ffmpeg 可能携带的 TOS
    // 签名 URL 或对象路径原样写入 Redis。
    throw Object.assign(new Error(safeErrorMessage(error)), { code: safeErrorCode(error) });
  } finally {
    clearInterval(heartbeat);
  }
}

export async function enqueueRecoverableUploadSessions(limit = 100) {
  await finalizeAbandonedCanceledUploadSessions(limit);
  const result = await pool.query<{ id: string; attempt: number }>(
    `SELECT id, attempt FROM upload_sessions
     WHERE (status = 'pending' AND processing_stage = 'queued')
        OR (status = 'processing' AND cancel_requested_at IS NULL AND lease_expires_at < now())
     ORDER BY updated_at ASC LIMIT $1`,
    [limit],
  );
  for (const row of result.rows) await enqueueUploadSession(row.id, row.attempt + 1);
  return result.rowCount ?? 0;
}

async function claimUploadSession(sessionId: string) {
  const leaseToken = randomUUID();
  return withTransaction(async client => {
    const result = await client.query<UploadSessionRow>(
      `UPDATE upload_sessions
       SET status = 'processing', processing_stage = 'sealing', attempt = attempt + 1,
           lease_token = $2, lease_expires_at = now() + interval '2 minutes',
           heartbeat_at = now(), started_at = COALESCE(started_at, now()), updated_at = now()
       WHERE id = $1
         AND cancel_requested_at IS NULL
         AND ((status = 'pending' AND processing_stage = 'queued')
           OR (status = 'processing' AND lease_expires_at < now()))
       RETURNING *`,
      [sessionId, leaseToken],
    );
    return result.rows[0] ?? null;
  });
}

async function advanceStage(sessionId: string, leaseToken: string, stage: UploadStage) {
  const result = await pool.query(
    `UPDATE upload_sessions
     SET processing_stage = $3, heartbeat_at = now(), lease_expires_at = now() + interval '2 minutes', updated_at = now()
     WHERE id = $1 AND status = 'processing' AND lease_token = $2 AND cancel_requested_at IS NULL`,
    [sessionId, leaseToken, stage],
  );
  if (result.rowCount !== 1) throw Object.assign(new Error('上传任务租约已失效或已取消'), { code: 'UPLOAD_LEASE_LOST' });
}

async function markUploadSealed(sessionId: string, leaseToken: string, sizeBytes: number) {
  const result = await pool.query(
    `UPDATE upload_sessions
     SET sealed_at = COALESCE(sealed_at, now()), sealed_size_bytes = $3,
         processing_stage = 'validating', heartbeat_at = now(),
         lease_expires_at = now() + interval '2 minutes', updated_at = now()
     WHERE id = $1 AND status = 'processing' AND lease_token = $2 AND cancel_requested_at IS NULL`,
    [sessionId, leaseToken, sizeBytes],
  );
  if (result.rowCount !== 1) throw Object.assign(new Error('上传任务租约已失效或已取消'), { code: 'UPLOAD_LEASE_LOST' });
}

async function prepareUploadThumbnail(sessionId: string, leaseToken: string) {
  const result = await pool.query(
    `UPDATE upload_sessions
     SET processing_stage = 'thumbnailing', heartbeat_at = now(),
         lease_expires_at = now() + interval '2 minutes', updated_at = now()
     WHERE id = $1 AND status = 'processing' AND lease_token = $2 AND cancel_requested_at IS NULL`,
    [sessionId, leaseToken],
  );
  if (result.rowCount !== 1) {
    throw Object.assign(new Error('上传任务租约已失效或已取消'), { code: 'UPLOAD_LEASE_LOST' });
  }
}

async function recordUploadedThumbnail(sessionId: string, leaseToken: string, thumbnailKey: string) {
  const result = await pool.query(
    `UPDATE upload_sessions
     SET thumbnail_key = $3, heartbeat_at = now(),
         lease_expires_at = now() + interval '2 minutes', updated_at = now()
     WHERE id = $1 AND status = 'processing' AND lease_token = $2
       AND processing_stage = 'thumbnailing' AND cancel_requested_at IS NULL`,
    [sessionId, leaseToken, thumbnailKey],
  );
  if (result.rowCount !== 1) {
    throw Object.assign(new Error('缩略图上传完成后任务租约已失效或已取消'), { code: 'UPLOAD_LEASE_LOST' });
  }
}

async function heartbeatUploadSession(sessionId: string, leaseToken: string) {
  await pool.query(
    `UPDATE upload_sessions SET heartbeat_at = now(), lease_expires_at = now() + interval '2 minutes', updated_at = now()
     WHERE id = $1 AND status = 'processing' AND lease_token = $2 AND cancel_requested_at IS NULL`,
    [sessionId, leaseToken],
  );
}

async function assertClaimActive(sessionId: string, leaseToken: string) {
  const result = await pool.query(
    `SELECT 1 FROM upload_sessions
     WHERE id = $1 AND status = 'processing' AND lease_token = $2 AND cancel_requested_at IS NULL`,
    [sessionId, leaseToken],
  );
  if (!result.rowCount) throw Object.assign(new Error('上传任务租约已失效或已取消'), { code: 'UPLOAD_LEASE_LOST' });
}

async function persistCompletedUpload(
  session: UploadSessionRow,
  leaseToken: string,
  sizeBytes: number,
  metadata: { width: number | null; height: number | null; durationSeconds: number | null },
  thumbnailKey: string | null,
) {
  const maxPositionAttempts = 3;
  let lastPositionError: unknown;

  for (let attempt = 0; attempt < maxPositionAttempts; attempt += 1) {
    // 不持锁读取最新位置，只用于确定本轮首先要锁哪一个目录。真正写入前仍会
    // 在同一事务内锁住会话并核对位置，不能把这里的快照当成最终事实。
    const observedResult = await pool.query<UploadSessionPositionRow>(
      `SELECT user_id, source, folder_id
       FROM upload_sessions
       WHERE id = $1 AND status = 'processing' AND lease_token = $2
         AND cancel_requested_at IS NULL`,
      [session.id, leaseToken],
    );
    const observed = observedResult.rows[0];
    if (!observed) throw uploadLeaseLost();
    if (!observed.source || !observed.folder_id) {
      throw Object.assign(new Error('上传会话目录位置无效'), { code: 'UPLOAD_FOLDER_UNAVAILABLE' });
    }
    const observedSource = observed.source;
    const observedFolderId = observed.folder_id;

    try {
      return await withTransaction(async client => {
        // 与文件夹删除统一按“目录 → 上传会话”的顺序取锁。删除若已先提交，
        // observed 会读到迁移后的主目录；若位置在本窗口改变，则回滚并重试。
        await resolveAssetFolderId(client, {
          userId: observed.user_id,
          source: observedSource,
          folderId: observedFolderId,
        });
        const lockedResult = await client.query<UploadSessionRow>(
          `SELECT * FROM upload_sessions
           WHERE id = $1 AND status = 'processing' AND lease_token = $2
             AND cancel_requested_at IS NULL
           FOR UPDATE`,
          [session.id, leaseToken],
        );
        const locked = lockedResult.rows[0];
        if (!locked) throw uploadLeaseLost();
        if (locked.user_id !== observed.user_id
          || locked.source !== observedSource
          || locked.folder_id !== observedFolderId) {
          throw uploadFolderPositionChanged();
        }
        if (!locked.source || !locked.folder_id || !locked.final_object_key) {
          throw Object.assign(new Error('上传会话目录或最终对象位置无效'), { code: 'UPLOAD_FOLDER_UNAVAILABLE' });
        }

        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`asset-object:${locked.final_object_key}`],
        );
        const persistedThumbnailKey = locked.thumbnail_key;
        if (persistedThumbnailKey !== thumbnailKey) {
          throw Object.assign(new Error('上传缩略图状态已变化'), { code: 'UPLOAD_LEASE_LOST' });
        }
        const inserted = await client.query<AssetRow>(
          `INSERT INTO assets (
             user_id, folder_id, name, type, source, object_key, thumbnail_key,
             public_url, thumbnail_url, size_bytes, width, height, duration_seconds,
             thumbnail_status, thumbnail_error_code, thumbnail_error_message, thumbnail_updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, NULL, NULL, CASE WHEN $14 = 'ready' THEN now() ELSE NULL END)
           RETURNING *`,
          [
            locked.user_id, locked.folder_id, locked.asset_name, locked.asset_type, locked.source,
            locked.final_object_key, persistedThumbnailKey, buildPublicUrl(locked.final_object_key),
            persistedThumbnailKey ? buildPublicUrl(persistedThumbnailKey) : null,
            sizeBytes, metadata.width, metadata.height, metadata.durationSeconds,
            locked.asset_type === 'audio' ? 'not-required' : 'ready',
          ],
        );
        const completed = await client.query<UploadSessionRow>(
          `UPDATE upload_sessions
           SET status = 'completed', processing_stage = 'completed', asset_id = $3,
               thumbnail_key = $4, actual_size_bytes = $5, completed_at = now(),
               lease_token = NULL, lease_expires_at = NULL, heartbeat_at = now(),
               error_code = NULL, error_message = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2 AND status = 'processing'
           RETURNING *`,
          [locked.id, leaseToken, inserted.rows[0]!.id, persistedThumbnailKey, sizeBytes],
        );
        if (!completed.rowCount) throw uploadLeaseLost();
        if (locked.object_key !== locked.final_object_key) {
          const stagingAvailableAt = new Date(new Date(locked.expires_at).getTime() + 15 * 60_000);
          await scheduleObjectDeletion(client, locked.object_key, [], stagingAvailableAt);
        }
        return inserted.rows[0]!;
      });
    } catch (error) {
      if (!isRetryableUploadFolderPositionError(error)) throw error;
      lastPositionError = error;
    }
  }

  throw Object.assign(new Error('上传会话目录位置持续变化，请稍后重试'), {
    code: 'UPLOAD_FOLDER_POSITION_UNSTABLE',
    cause: lastPositionError,
  });
}

async function failClaimedUpload(
  session: UploadSessionRow,
  leaseToken: string,
  error: unknown,
  unreferencedThumbnailKey: string | null = null,
) {
  const next = await withTransaction(async client => {
    const permanent = isPermanentUploadFailure(error);
    const retryAutomatically = !permanent && session.attempt < 3 && safeErrorCode(error) !== 'UPLOAD_LEASE_LOST';
    const result = await client.query<UploadSessionRow>(
      `UPDATE upload_sessions
       SET status = CASE
             WHEN cancel_requested_at IS NOT NULL THEN 'canceled'
             WHEN $5::boolean THEN 'pending'
             ELSE 'failed'
           END,
           processing_stage = CASE
             WHEN cancel_requested_at IS NOT NULL THEN 'canceled'
             WHEN $5::boolean THEN 'queued'
             ELSE 'failed'
           END,
           error_code = CASE WHEN cancel_requested_at IS NOT NULL THEN 'UPLOAD_CANCELED' ELSE $3 END,
           error_message = CASE WHEN cancel_requested_at IS NOT NULL THEN '上传已取消' ELSE $4 END,
           lease_token = NULL,
           lease_expires_at = NULL,
           retryable = CASE WHEN cancel_requested_at IS NULL AND NOT $5::boolean AND NOT $6::boolean THEN true ELSE false END,
           updated_at = now()
       WHERE id = $1 AND lease_token = $2 AND status = 'processing'
       RETURNING *`,
      [session.id, leaseToken, safeErrorCode(error), safeErrorMessage(error), retryAutomatically, permanent],
    );
    const row = result.rows[0];
    if (unreferencedThumbnailKey && row?.thumbnail_key !== unreferencedThumbnailKey) {
      await scheduleObjectDeletion(
        client,
        unreferencedThumbnailKey,
        [],
        new Date(Date.now() + 5 * 60_000),
      );
    }
    if (row?.status === 'canceled') await scheduleSessionObjects(client, row, true);
    return row ?? null;
  });
  if (next?.status === 'pending' && next.processing_stage === 'queued') {
    await enqueueUploadSession(next.id, next.attempt + 1);
  }
}

async function scheduleSessionObjects(client: DbClient, session: UploadSessionRow, finalImmediately = false) {
  const stagingAvailableAt = new Date(new Date(session.expires_at).getTime() + 15 * 60_000);
  await scheduleObjectDeletion(client, session.object_key, [], stagingAvailableAt);
  for (const key of [session.final_object_key, session.thumbnail_key]) {
    if (key) await scheduleObjectDeletion(client, key, [], finalImmediately ? null : stagingAvailableAt);
  }
}

async function mapUploadSession(row: UploadSessionRow) {
  let asset = null;
  if (row.asset_id) {
    const result = await pool.query<AssetRow>(
      `SELECT * FROM assets WHERE id = $1 AND user_id = $2 AND deletion_status = 'active'`,
      [row.asset_id, row.user_id],
    );
    if (result.rows[0]) asset = await mapAssetCardRow(result.rows[0]);
  }
  const error = row.status === 'completed' && !asset
    ? { code: 'UPLOAD_ASSET_UNAVAILABLE', message: '上传已完成，但对应素材已不可用' }
    : row.error_code && row.error_message
      ? { code: row.error_code, message: row.error_message }
      : null;
  return {
    id: row.id,
    status: row.status,
    processingStage: row.processing_stage,
    progress: STAGE_PROGRESS[row.processing_stage],
    attempt: row.attempt,
    filename: row.filename,
    source: row.source,
    asset,
    error,
    canRetry: row.status === 'failed' && row.retryable && new Date(row.retention_until).getTime() > Date.now(),
    expiresAt: new Date(row.expires_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function normalizeCreateInput(input: CreateUploadSessionInput) {
  const contentType = input.contentType.trim().toLowerCase();
  const assetType = sourceToType(input.source);
  if (!contentType.startsWith(`${assetType}/`)) {
    throw Object.assign(new Error('文件类型与上传分类不匹配'), { statusCode: 400, code: 'UPLOAD_MEDIA_TYPE_MISMATCH' });
  }
  const extension = input.filename.split(/[?#]/, 1)[0]?.split('.').pop()?.toLowerCase() ?? '';
  if (assetType === 'audio' && !['mp3', 'wav'].includes(extension)) {
    throw Object.assign(new Error('音频仅支持 MP3 或 WAV 格式'), { statusCode: 400, code: 'UPLOAD_AUDIO_FORMAT_UNSUPPORTED' });
  }
  const sizeBytes = Math.min(Math.max(1, Math.trunc(input.sizeBytes ?? UPLOAD_MAX_BYTES)), UPLOAD_MAX_BYTES);
  return {
    ...input,
    filename: input.filename.trim(),
    contentType,
    sizeBytes,
    folderId: input.folderId ?? null,
    assetName: input.filename.replace(/\.[^.]+$/, '') || input.filename || '上传素材',
  };
}

function hashUploadRequest(input: ReturnType<typeof normalizeCreateInput>) {
  return createHash('sha256').update(JSON.stringify({
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    source: input.source,
    folderId: input.folderId,
  })).digest('hex');
}

function sourceToType(source: UploadSource): UploadAssetType {
  return source === 'uploaded-video' ? 'video' : source === 'uploaded-audio' ? 'audio' : 'image';
}

function validateDetectedMedia(
  session: UploadSessionRow,
  metadata: {
    hasVideo?: boolean;
    hasAudio?: boolean;
    formatName?: string | null;
    frameCount?: number | null;
    durationSeconds: number | null;
    width: number | null;
    height: number | null;
    videoCodec?: string | null;
    majorBrand?: string | null;
  },
) {
  const format = metadata.formatName?.toLowerCase() ?? '';
  const imageContainer = /(?:image2|png_pipe|jpeg_pipe|webp_pipe|bmp_pipe|tiff_pipe|gif)/.test(format);
  const extension = session.filename.split(/[?#]/, 1)[0]?.split('.').pop()?.toLowerCase() ?? '';
  const majorBrand = metadata.majorBrand?.toLowerCase() ?? '';
  const supportedImageExtension = [
    'jpeg', 'jpg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'heic', 'heif',
  ].includes(extension);
  const heifContainer = ['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(majorBrand)
    && metadata.videoCodec?.toLowerCase() === 'hevc'
    && ['heic', 'heif'].includes(extension);
  const audioContainerMatches = extension === 'mp3'
    ? format.split(',').includes('mp3')
    : extension === 'wav' && format.split(',').includes('wav');
  const valid = session.asset_type === 'video'
    ? metadata.hasVideo === true && !imageContainer && metadata.width !== null && metadata.height !== null && metadata.durationSeconds !== null
    : session.asset_type === 'audio'
      ? metadata.hasAudio === true && metadata.hasVideo !== true && audioContainerMatches && metadata.durationSeconds !== null
      : metadata.hasVideo === true && supportedImageExtension && (imageContainer || heifContainer)
        && metadata.width !== null && metadata.height !== null && metadata.hasAudio !== true;
  if (!valid) throw Object.assign(new Error('文件内容与声明的媒体类型不一致'), { code: 'UPLOAD_MEDIA_DETECTION_FAILED' });
}

async function readDetectedMediaMetadata(objectKey: string) {
  try {
    return await readUploadedMediaMetadata({ objectKey });
  } catch (error) {
    const message = safeErrorMessage(error).toLowerCase();
    if (/(invalid data|could not find codec|moov atom not found|failed to read|end of file)/.test(message)) {
      throw Object.assign(new Error('无法解析上传文件的媒体格式'), { code: 'UPLOAD_MEDIA_DETECTION_FAILED' });
    }
    throw error;
  }
}

async function getUploadSessionByIdempotency(userId: string, idempotencyKey: string) {
  const result = await pool.query<UploadSessionRow>(
    'SELECT * FROM upload_sessions WHERE user_id = $1 AND idempotency_key = $2',
    [userId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function lockOwnedSession(client: DbClient, userId: string, sessionId: string) {
  const result = await client.query<UploadSessionRow>(
    'SELECT * FROM upload_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE',
    [sessionId, userId],
  );
  if (!result.rows[0]) throw Object.assign(new Error('上传会话不存在'), { statusCode: 404, code: 'UPLOAD_SESSION_NOT_FOUND' });
  return result.rows[0];
}

async function finalizeAbandonedCanceledUploadSessions(limit: number) {
  return withTransaction(async client => {
    const result = await client.query<UploadSessionRow>(
      `WITH candidates AS (
         SELECT id
         FROM upload_sessions
         WHERE status = 'processing'
           AND cancel_requested_at IS NOT NULL
           AND lease_expires_at < now()
         ORDER BY updated_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE upload_sessions session
       SET status = 'canceled', processing_stage = 'canceled', retryable = false,
           error_code = 'UPLOAD_CANCELED', error_message = '上传已取消',
           lease_token = NULL, lease_expires_at = NULL, heartbeat_at = now(), updated_at = now()
       FROM candidates
       WHERE session.id = candidates.id
       RETURNING session.*`,
      [limit],
    );
    for (const row of result.rows) await scheduleSessionObjects(client, row, true);
    return result.rowCount ?? 0;
  });
}

function uploadConflict(code: string, message: string) {
  return Object.assign(new Error(message), { statusCode: 409, code });
}

function uploadLeaseLost() {
  return Object.assign(new Error('上传任务租约已失效或已取消'), { code: 'UPLOAD_LEASE_LOST' });
}

function uploadFolderPositionChanged() {
  return Object.assign(new Error('上传会话目录位置已变化'), { code: 'UPLOAD_FOLDER_POSITION_CHANGED' });
}

function isRetryableUploadFolderPositionError(error: unknown) {
  const code = safeErrorCode(error);
  return code === 'UPLOAD_FOLDER_POSITION_CHANGED' || code === 'ASSET_FOLDER_INVALID';
}

function safeErrorCode(error: unknown) {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    const code = String((error as { code: string }).code);
    if (/^[A-Za-z0-9_.-]{1,64}$/.test(code)) return code;
  }
  return 'UPLOAD_FINALIZATION_FAILED';
}

function safeErrorMessage(error: unknown) {
  const messages: Record<string, string> = {
    UPLOAD_SIZE_MISMATCH: '上传文件大小与声明值不一致',
    UPLOAD_SIZE_INVALID: '上传文件大小无效',
    UPLOAD_MEDIA_DETECTION_FAILED: '无法解析上传文件的媒体格式',
    UPLOAD_MEDIA_TYPE_MISMATCH: '文件内容与声明的媒体类型不一致',
    UPLOAD_AUDIO_FORMAT_UNSUPPORTED: '音频格式不受支持',
    UPLOAD_THUMBNAIL_FAILED: '缩略图生成失败，请重试',
    UPLOAD_LEASE_LOST: '上传任务已由其他 worker 接管',
    UPLOAD_FOLDER_POSITION_UNSTABLE: '上传目录状态变化，请稍后重试',
    UPLOAD_FOLDER_UNAVAILABLE: '上传目录暂不可用，请稍后重试',
    STORAGE_IMMUTABLE_CONFLICT: '上传对象冲突，请重新上传',
  };
  return messages[safeErrorCode(error)] ?? '上传处理暂时失败，系统将自动重试';
}

function isPermanentUploadFailure(error: unknown) {
  return new Set([
    'UPLOAD_SIZE_MISMATCH',
    'UPLOAD_SIZE_INVALID',
    'UPLOAD_MEDIA_DETECTION_FAILED',
    'UPLOAD_MEDIA_TYPE_MISMATCH',
    'UPLOAD_AUDIO_FORMAT_UNSUPPORTED',
    'STORAGE_IMMUTABLE_CONFLICT',
  ]).has(safeErrorCode(error));
}
