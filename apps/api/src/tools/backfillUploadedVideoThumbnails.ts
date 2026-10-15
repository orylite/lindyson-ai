import { pathToFileURL } from 'node:url';
import type { PoolClient, QueryResult } from 'pg';
import { pool, withTransaction } from '../db/pool.js';
import { scheduleObjectDeletion } from '../domain/assetDeletionService.js';
import {
  buildHistoricalVideoThumbnailKey,
  createUploadedVideoPreview,
  isPermanentVideoPreviewFailure,
  isUserUploadedObjectKey,
} from '../domain/uploadedVideoPreview.js';
import { buildPublicUrl } from '../storage/storageService.js';

interface UploadedVideoAssetRow {
  id: string;
  user_id: string;
  object_key: string;
  thumbnail_key: string | null;
  thumbnail_status: 'pending' | 'ready' | 'failed' | 'not-required';
  width: number | null;
  height: number | null;
  duration_seconds: string | number | null;
  created_at: Date | string;
}

interface GeneratedVideoThumbnailAssetRow extends UploadedVideoAssetRow {
  generation_thumbnail_key: string | null;
  thumbnail_updated_at: Date | string | null;
}

type BackfillOutcome = 'updated' | 'skipped' | 'permanent-failed' | 'retryable-failed';

const BATCH_SIZE = 50;
const ORPHAN_DELETION_DELAY_MS = 5 * 60_000;
const GENERATED_RETRY_DELAY_MINUTES = 5;

export async function backfillUploadedVideoThumbnails(options: { assetId?: string | null } = {}) {
  const assetId = options.assetId?.trim() || null;
  let updated = 0;
  let skipped = 0;
  let permanentFailed = 0;
  let retryableFailed = 0;
  let cursorCreatedAt: Date | string | null = null;
  let cursorId: string | null = null;

  while (true) {
    const result: QueryResult<UploadedVideoAssetRow> = await pool.query<UploadedVideoAssetRow>(
      `SELECT id, user_id, object_key, thumbnail_key, thumbnail_status,
              width, height, duration_seconds, created_at
       FROM assets
       WHERE type = 'video'
         AND source = 'uploaded-video'
         AND deletion_status = 'active'
         AND ($1::uuid IS NULL OR id = $1::uuid)
         AND (
           thumbnail_key IS NULL
           OR thumbnail_key = object_key
           OR thumbnail_status IN ('pending', 'failed')
           OR width IS NULL
           OR height IS NULL
           OR duration_seconds IS NULL
         )
         AND (
           $3::timestamptz IS NULL
           OR (created_at, id) > ($3::timestamptz, $4::uuid)
         )
       ORDER BY created_at ASC, id ASC
       LIMIT $2`,
      [assetId, BATCH_SIZE, cursorCreatedAt, cursorId],
    );
    if (result.rows.length === 0) break;

    // 视频处理默认只占用一个 FFmpeg 槽位，避免回填挤占正常上传 worker。
    for (const asset of result.rows) {
      const outcome = await processUploadedVideoAsset(asset);
      if (outcome === 'updated') updated += 1;
      if (outcome === 'skipped') skipped += 1;
      if (outcome === 'permanent-failed') permanentFailed += 1;
      if (outcome === 'retryable-failed') retryableFailed += 1;
    }

    const tail = result.rows.at(-1)!;
    cursorCreatedAt = tail.created_at;
    cursorId = tail.id;
  }

  const remaining = await pool.query<{ pending: string; failed: string }>(
    `SELECT
       count(*) FILTER (
         WHERE thumbnail_status <> 'failed'
           AND (
             thumbnail_key IS NULL OR thumbnail_key = object_key
             OR thumbnail_status = 'pending'
             OR width IS NULL OR height IS NULL OR duration_seconds IS NULL
           )
       ) AS pending,
       count(*) FILTER (WHERE thumbnail_status = 'failed') AS failed
     FROM assets
     WHERE type = 'video'
       AND source = 'uploaded-video'
       AND deletion_status = 'active'
       AND ($1::uuid IS NULL OR id = $1::uuid)`,
    [assetId],
  );

  return {
    updated,
    skipped,
    permanentFailed,
    retryableFailed,
    pendingCount: Number(remaining.rows[0]?.pending ?? 0),
    failedCount: Number(remaining.rows[0]?.failed ?? 0),
  };
}

/**
 * 生成成片已经归档、但供应商阶段缩略图失败时，资产会以 pending 完成。worker
 * 定时调用本函数，从私有 TOS 成片重新抽帧；advisory lock 防止重复计算，最终写入
 * 仍以资产快照 CAS 围栏。临时故障只更新时间用于退避，明确损坏才进入 failed。
 */
export async function recoverPendingGeneratedVideoThumbnails(options: {
  assetId?: string | null;
  limit?: number;
  force?: boolean;
} = {}) {
  const assetId = options.assetId?.trim() || null;
  const limit = clampBatchSize(options.limit);
  const result = await pool.query<GeneratedVideoThumbnailAssetRow>(
    `SELECT asset.id, asset.user_id, asset.object_key, asset.thumbnail_key,
            asset.thumbnail_status, asset.width, asset.height, asset.duration_seconds,
            asset.created_at, asset.thumbnail_updated_at,
            run.thumbnail_object_key AS generation_thumbnail_key
     FROM assets asset
     JOIN generation_tasks task
       ON task.asset_id = asset.id
      AND task.user_id = asset.user_id
      AND task.status = 'completed'
     JOIN generation_provider_runs run
       ON run.id = task.active_provider_run_id
      AND run.task_id = task.id
      AND run.status = 'settled'
      AND run.output_object_key = asset.object_key
     WHERE asset.type = 'video'
       AND asset.source = 'ai-video'
       AND asset.deletion_status = 'active'
       AND asset.thumbnail_status = 'pending'
       AND ($1::uuid IS NULL OR asset.id = $1::uuid)
       AND (
         $3::boolean
         OR asset.thumbnail_updated_at IS NULL
         OR asset.thumbnail_updated_at <= now() - interval '${GENERATED_RETRY_DELAY_MINUTES} minutes'
       )
     ORDER BY asset.thumbnail_updated_at ASC NULLS FIRST, asset.created_at ASC, asset.id ASC
     LIMIT $2`,
    [assetId, limit, options.force === true],
  );

  const summary = {
    scanned: result.rows.length,
    updated: 0,
    skipped: 0,
    permanentFailed: 0,
    retryableFailed: 0,
  };
  // createUploadedVideoPreview 内部使用共享 video permit；此处顺序处理，避免恢复任务
  // 抢占正常生成和上传的 FFmpeg 槽位。
  for (const asset of result.rows) {
    const outcome = await processGeneratedVideoThumbnail(asset);
    if (outcome === 'updated') summary.updated += 1;
    if (outcome === 'skipped') summary.skipped += 1;
    if (outcome === 'permanent-failed') summary.permanentFailed += 1;
    if (outcome === 'retryable-failed') summary.retryableFailed += 1;
  }
  return summary;
}

async function processGeneratedVideoThumbnail(
  asset: GeneratedVideoThumbnailAssetRow,
): Promise<BackfillOutcome> {
  const client = await pool.connect();
  const lockKey = `asset-thumbnail:${asset.id}`;
  let locked = false;
  let uploadedThumbnailKey: string | null = null;

  try {
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
      [lockKey],
    );
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return 'skipped';

    const current = await readCurrentGeneratedVideo(client, asset.id);
    if (!current || current.thumbnail_status !== 'pending') return 'skipped';
    const intendedThumbnailKey = resolveGeneratedThumbnailKey(current);

    try {
      const preview = await createUploadedVideoPreview({
        userId: current.user_id,
        objectKey: current.object_key,
        existingThumbnailKey: null,
        thumbnailKey: intendedThumbnailKey,
      });
      if (!preview.thumbnailKey || preview.thumbnailKey !== intendedThumbnailKey) {
        throw Object.assign(new Error('生成视频缩略图结果不完整'), {
          code: 'VIDEO_PREVIEW_INCOMPLETE',
        });
      }
      uploadedThumbnailKey = preview.thumbnailKey;

      const updated = await client.query(
        `UPDATE assets
         SET thumbnail_key = $2,
             thumbnail_url = $3,
             thumbnail_status = 'ready',
             thumbnail_error_code = NULL,
             thumbnail_error_message = NULL,
             thumbnail_updated_at = now(),
             width = COALESCE(width, $4),
             height = COALESCE(height, $5),
             duration_seconds = COALESCE(duration_seconds, $6),
             updated_at = now()
         WHERE id = $1
           AND user_id = $7
           AND type = 'video'
           AND source = 'ai-video'
           AND deletion_status = 'active'
           AND object_key = $8
           AND thumbnail_key IS NOT DISTINCT FROM $9::text
           AND thumbnail_status = 'pending'
           AND width IS NOT DISTINCT FROM $10::integer
           AND height IS NOT DISTINCT FROM $11::integer
           AND duration_seconds IS NOT DISTINCT FROM $12::numeric
           AND thumbnail_updated_at IS NOT DISTINCT FROM $13::timestamptz`,
        [
          current.id,
          intendedThumbnailKey,
          buildPublicUrl(intendedThumbnailKey),
          preview.width,
          preview.height,
          preview.durationSeconds,
          current.user_id,
          current.object_key,
          current.thumbnail_key,
          current.width,
          current.height,
          current.duration_seconds,
          current.thumbnail_updated_at,
        ],
      );
      if (updated.rowCount === 1) {
        uploadedThumbnailKey = null;
        return 'updated';
      }

      await scheduleUnreferencedThumbnail(intendedThumbnailKey);
      uploadedThumbnailKey = null;
      return 'skipped';
    } catch (error) {
      if (uploadedThumbnailKey) {
        await scheduleUnreferencedThumbnail(uploadedThumbnailKey);
        uploadedThumbnailKey = null;
      }
      const permanent = isPermanentVideoPreviewFailure(error);
      const stateUpdated = permanent
        ? await markGeneratedVideoThumbnailFailed(client, current)
        : await deferGeneratedVideoThumbnailRetry(client, current);
      if (!stateUpdated) return 'skipped';
      console.error(JSON.stringify({
        event: 'generated-video-thumbnail-recovery-failed',
        assetId: current.id,
        errorCode: safeErrorCode(error),
        retryable: !permanent,
      }));
      return permanent ? 'permanent-failed' : 'retryable-failed';
    }
  } finally {
    // 恢复链路使用 FFmpeg image2pipe + Buffer，不创建本地缩略图文件；finally 仅需
    // 释放数据库会话锁。若未来必须落盘，仍须走 withThumbnailTempDirectory。
    if (uploadedThumbnailKey) {
      await scheduleUnreferencedThumbnail(uploadedThumbnailKey).catch(() => undefined);
    }
    if (locked) {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]).catch(() => undefined);
    }
    client.release();
  }
}

async function readCurrentGeneratedVideo(client: PoolClient, assetId: string) {
  const result = await client.query<GeneratedVideoThumbnailAssetRow>(
    `SELECT asset.id, asset.user_id, asset.object_key, asset.thumbnail_key,
            asset.thumbnail_status, asset.width, asset.height, asset.duration_seconds,
            asset.created_at, asset.thumbnail_updated_at,
            run.thumbnail_object_key AS generation_thumbnail_key
     FROM assets asset
     JOIN generation_tasks task
       ON task.asset_id = asset.id AND task.user_id = asset.user_id AND task.status = 'completed'
     JOIN generation_provider_runs run
       ON run.id = task.active_provider_run_id AND run.task_id = task.id
      AND run.status = 'settled' AND run.output_object_key = asset.object_key
     WHERE asset.id = $1
       AND asset.type = 'video'
       AND asset.source = 'ai-video'
       AND asset.deletion_status = 'active'`,
    [assetId],
  );
  return result.rows[0] ?? null;
}

function resolveGeneratedThumbnailKey(asset: GeneratedVideoThumbnailAssetRow) {
  const persisted = asset.generation_thumbnail_key?.trim();
  if (persisted && persisted !== asset.object_key) return persisted;
  return buildHistoricalVideoThumbnailKey(asset.user_id, asset.id);
}

async function markGeneratedVideoThumbnailFailed(
  client: PoolClient,
  asset: GeneratedVideoThumbnailAssetRow,
) {
  const result = await client.query(
    `UPDATE assets
     SET thumbnail_status = 'failed',
         thumbnail_error_code = 'GENERATION_VIDEO_THUMBNAIL_DECODE_FAILED',
         thumbnail_error_message = '生成视频缩略图无法解码',
         thumbnail_updated_at = now(),
         updated_at = now()
     WHERE id = $1 AND user_id = $2 AND source = 'ai-video'
       AND deletion_status = 'active' AND object_key = $3
       AND thumbnail_key IS NOT DISTINCT FROM $4::text
       AND thumbnail_status = 'pending'
       AND width IS NOT DISTINCT FROM $5::integer
       AND height IS NOT DISTINCT FROM $6::integer
       AND duration_seconds IS NOT DISTINCT FROM $7::numeric
       AND thumbnail_updated_at IS NOT DISTINCT FROM $8::timestamptz`,
    [
      asset.id,
      asset.user_id,
      asset.object_key,
      asset.thumbnail_key,
      asset.width,
      asset.height,
      asset.duration_seconds,
      asset.thumbnail_updated_at,
    ],
  );
  return result.rowCount === 1;
}

async function deferGeneratedVideoThumbnailRetry(
  client: PoolClient,
  asset: GeneratedVideoThumbnailAssetRow,
) {
  const result = await client.query(
    `UPDATE assets
     SET thumbnail_updated_at = now(), updated_at = now()
     WHERE id = $1 AND user_id = $2 AND source = 'ai-video'
       AND deletion_status = 'active' AND object_key = $3
       AND thumbnail_key IS NOT DISTINCT FROM $4::text
       AND thumbnail_status = 'pending'
       AND width IS NOT DISTINCT FROM $5::integer
       AND height IS NOT DISTINCT FROM $6::integer
       AND duration_seconds IS NOT DISTINCT FROM $7::numeric
       AND thumbnail_updated_at IS NOT DISTINCT FROM $8::timestamptz`,
    [
      asset.id,
      asset.user_id,
      asset.object_key,
      asset.thumbnail_key,
      asset.width,
      asset.height,
      asset.duration_seconds,
      asset.thumbnail_updated_at,
    ],
  );
  return result.rowCount === 1;
}

async function processUploadedVideoAsset(asset: UploadedVideoAssetRow): Promise<BackfillOutcome> {
  const client = await pool.connect();
  const lockKey = `asset-thumbnail:${asset.id}`;
  let locked = false;
  let uploadedThumbnailKey: string | null = null;

  try {
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
      [lockKey],
    );
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return 'skipped';

    const current = await readCurrentVideo(client, asset.id);
    if (!current || !requiresVideoPreview(current)) return 'skipped';
    if (!isUserUploadedObjectKey(current.user_id, current.object_key)) {
      const marked = await markVideoPreviewFailed(client, current, 'THUMBNAIL_OBJECT_OWNERSHIP_INVALID');
      if (!marked) return 'skipped';
      console.error(`视频缩略图回填失败：asset=${current.id} code=THUMBNAIL_OBJECT_OWNERSHIP_INVALID retryable=false`);
      return 'permanent-failed';
    }

    const existingThumbnailKey = current.thumbnail_key && current.thumbnail_key !== current.object_key
      ? current.thumbnail_key
      : null;
    const intendedThumbnailKey = buildHistoricalVideoThumbnailKey(current.user_id, current.id);

    try {
      const preview = await createUploadedVideoPreview({
        userId: current.user_id,
        objectKey: current.object_key,
        existingThumbnailKey,
        thumbnailKey: intendedThumbnailKey,
      });
      const thumbnailKey = preview.thumbnailKey ?? existingThumbnailKey;
      if (!existingThumbnailKey && thumbnailKey) uploadedThumbnailKey = thumbnailKey;
      if (
        !thumbnailKey
        || preview.width === null
        || preview.height === null
        || preview.durationSeconds === null
      ) {
        throw Object.assign(new Error('视频缩略图或元数据不完整'), {
          code: 'VIDEO_PREVIEW_INCOMPLETE',
        });
      }

      const updated = await client.query(
        `UPDATE assets
         SET thumbnail_key = $2,
             thumbnail_url = $3,
             thumbnail_status = 'ready',
             thumbnail_error_code = NULL,
             thumbnail_error_message = NULL,
             thumbnail_updated_at = now(),
             width = $4,
             height = $5,
             duration_seconds = $6,
             updated_at = now()
         WHERE id = $1
           AND user_id = $7
           AND type = 'video'
           AND source = 'uploaded-video'
           AND deletion_status = 'active'
           AND object_key = $8
           AND thumbnail_key IS NOT DISTINCT FROM $9::text
           AND thumbnail_status = $10
           AND width IS NOT DISTINCT FROM $11::integer
           AND height IS NOT DISTINCT FROM $12::integer
           AND duration_seconds IS NOT DISTINCT FROM $13::numeric`,
        [
          current.id,
          thumbnailKey,
          buildPublicUrl(thumbnailKey),
          preview.width,
          preview.height,
          preview.durationSeconds,
          current.user_id,
          current.object_key,
          current.thumbnail_key,
          current.thumbnail_status,
          current.width,
          current.height,
          current.duration_seconds,
        ],
      );
      if (updated.rowCount === 1) return 'updated';

      if (uploadedThumbnailKey) await scheduleUnreferencedThumbnail(uploadedThumbnailKey);
      return 'skipped';
    } catch (error) {
      if (uploadedThumbnailKey) await scheduleUnreferencedThumbnail(uploadedThumbnailKey);
      const permanent = isPermanentVideoPreviewFailure(error);
      const stateUpdated = permanent
        ? await markVideoPreviewFailed(client, current, 'VIDEO_PREVIEW_DECODE_FAILED')
        : await resetVideoPreviewPending(client, current);
      if (!stateUpdated) return 'skipped';
      console.error(`视频缩略图回填失败：asset=${current.id} code=${safeErrorCode(error)} retryable=${String(!permanent)}`);
      return permanent ? 'permanent-failed' : 'retryable-failed';
    }
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]).catch(() => undefined);
    }
    client.release();
  }
}

async function readCurrentVideo(client: PoolClient, assetId: string) {
  const result = await client.query<UploadedVideoAssetRow>(
    `SELECT id, user_id, object_key, thumbnail_key, thumbnail_status,
            width, height, duration_seconds, created_at
     FROM assets
     WHERE id = $1
       AND type = 'video'
       AND source = 'uploaded-video'
       AND deletion_status = 'active'`,
    [assetId],
  );
  return result.rows[0] ?? null;
}

function requiresVideoPreview(asset: UploadedVideoAssetRow) {
  return !asset.thumbnail_key
    || asset.thumbnail_key === asset.object_key
    || asset.thumbnail_status === 'pending'
    || asset.thumbnail_status === 'failed'
    || asset.width === null
    || asset.height === null
    || asset.duration_seconds === null;
}

async function markVideoPreviewFailed(
  client: PoolClient,
  asset: UploadedVideoAssetRow,
  errorCode: string,
) {
  const result = await client.query(
    `UPDATE assets
     SET thumbnail_status = 'failed',
         thumbnail_error_code = $2,
         thumbnail_error_message = '历史视频缩略图无法生成',
         thumbnail_updated_at = now(),
         updated_at = now()
     WHERE id = $1
       AND user_id = $3
       AND deletion_status = 'active'
       AND object_key = $4
       AND thumbnail_key IS NOT DISTINCT FROM $5::text
       AND thumbnail_status = $6
       AND width IS NOT DISTINCT FROM $7::integer
       AND height IS NOT DISTINCT FROM $8::integer
       AND duration_seconds IS NOT DISTINCT FROM $9::numeric`,
    [
      asset.id,
      errorCode,
      asset.user_id,
      asset.object_key,
      asset.thumbnail_key,
      asset.thumbnail_status,
      asset.width,
      asset.height,
      asset.duration_seconds,
    ],
  );
  return result.rowCount === 1;
}

async function resetVideoPreviewPending(client: PoolClient, asset: UploadedVideoAssetRow) {
  const result = await client.query(
    `UPDATE assets
     SET thumbnail_status = 'pending',
         thumbnail_error_code = NULL,
         thumbnail_error_message = NULL,
         thumbnail_updated_at = NULL,
         updated_at = now()
     WHERE id = $1
       AND user_id = $2
       AND deletion_status = 'active'
       AND object_key = $3
       AND thumbnail_key IS NOT DISTINCT FROM $4::text
       AND thumbnail_status = $5
       AND width IS NOT DISTINCT FROM $6::integer
       AND height IS NOT DISTINCT FROM $7::integer
       AND duration_seconds IS NOT DISTINCT FROM $8::numeric`,
    [
      asset.id,
      asset.user_id,
      asset.object_key,
      asset.thumbnail_key,
      asset.thumbnail_status,
      asset.width,
      asset.height,
      asset.duration_seconds,
    ],
  );
  return result.rowCount === 1;
}

async function scheduleUnreferencedThumbnail(objectKey: string) {
  await withTransaction(client => scheduleObjectDeletion(
    client,
    objectKey,
    [],
    new Date(Date.now() + ORPHAN_DELETION_DELAY_MS),
  ));
}

export { isPermanentVideoPreviewFailure } from '../domain/uploadedVideoPreview.js';

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'VIDEO_PREVIEW_UNKNOWN';
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) {
    return 'VIDEO_PREVIEW_PROCESSING_FAILED';
  }
  return code;
}

export function parseAssetId(args: string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--asset-id') return args[index + 1]?.trim() || null;
    if (arg.startsWith('--asset-id=')) return arg.slice('--asset-id='.length).trim() || null;
    if (!arg.startsWith('-')) return arg.trim() || null;
  }
  return null;
}

export function parseGeneratedVideoMode(args: string[]) {
  return args.includes('--generated');
}

function clampBatchSize(value: number | undefined) {
  return Number.isInteger(value) ? Math.max(1, Math.min(BATCH_SIZE, Number(value))) : 10;
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectExecution) {
  const args = process.argv.slice(2);
  const generatedMode = parseGeneratedVideoMode(args);
  const operation = generatedMode
    ? recoverPendingGeneratedVideoThumbnails({
        assetId: parseAssetId(args),
        limit: BATCH_SIZE,
        force: true,
      })
    : backfillUploadedVideoThumbnails({ assetId: parseAssetId(args) });
  operation
    .then(result => {
      console.log(`${generatedMode ? '生成视频缩略图恢复' : '上传视频缩略图回填'}完成：${JSON.stringify(result)}`);
      if (result.permanentFailed > 0 || result.retryableFailed > 0) process.exitCode = 1;
      if (!generatedMode && (
        'pendingCount' in result && result.pendingCount > 0
        || 'failedCount' in result && result.failedCount > 0
      )) process.exitCode = 1;
    })
    .catch(error => {
      console.error(`${generatedMode ? '生成视频缩略图恢复' : '上传视频缩略图回填'}中止：code=${safeErrorCode(error)}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
