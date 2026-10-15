import { withTransaction, type DbClient } from '../db/pool.js';
import { deleteObject } from '../storage/storageService.js';

export interface DeletableAssetRow {
  id: string;
  object_key: string | null;
  thumbnail_key: string | null;
}

export interface SystemAssetDeletionTarget {
  id: string;
  userId: string;
}

export async function scheduleObjectDeletion(
  client: DbClient,
  objectKey: string,
  assetIds: string[] = [],
  availableAt: Date | string | null = null,
) {
  const safeKey = objectKey.trim();
  if (!safeKey) return;
  await client.query(
    `INSERT INTO object_deletion_outbox (object_key, asset_ids, available_at)
     VALUES ($1, $2::uuid[], COALESCE($3::timestamptz, now()))
     ON CONFLICT (object_key) DO UPDATE
     SET asset_ids = ARRAY(
           SELECT DISTINCT unnest(object_deletion_outbox.asset_ids || EXCLUDED.asset_ids)
         ),
         status = 'pending',
         claim_token = NULL,
         lease_expires_at = NULL,
         available_at = CASE
           WHEN object_deletion_outbox.status IN ('completed', 'skipped') THEN EXCLUDED.available_at
           ELSE LEAST(object_deletion_outbox.available_at, EXCLUDED.available_at)
         END,
         updated_at = now()`,
    [safeKey, assetIds, availableAt],
  );
}

export async function scheduleAssetDeletion(
  client: DbClient,
  userId: string,
  assetIds: string[],
) {
  const uniqueIds = Array.from(new Set(assetIds));
  if (uniqueIds.length === 0) return 0;

  const result = await client.query<DeletableAssetRow>(
    `SELECT id, object_key, thumbnail_key
     FROM assets
     WHERE user_id = $1
       AND id = ANY($2::uuid[])
       AND deletion_status = 'active'
     FOR UPDATE`,
    [userId, uniqueIds],
  );
  if (!result.rowCount) return 0;

  return scheduleLockedAssetRowsDeletion(client, result.rows);
}

/** 仅供已在服务端确认归属的系统维护任务跨用户批量删除。 */
export async function scheduleSystemAssetDeletion(
  client: DbClient,
  targets: SystemAssetDeletionTarget[],
) {
  const uniqueTargets = [...new Map(targets.map(target => [target.id, target])).values()];
  if (uniqueTargets.length === 0) return 0;

  const result = await client.query<DeletableAssetRow>(
    `WITH targets AS (
       SELECT *
       FROM unnest($1::uuid[], $2::uuid[]) AS target(id, user_id)
     )
     SELECT asset.id, asset.object_key, asset.thumbnail_key
     FROM assets asset
     JOIN targets target ON target.id = asset.id AND target.user_id = asset.user_id
     WHERE asset.deletion_status = 'active'
     FOR UPDATE OF asset`,
    [uniqueTargets.map(target => target.id), uniqueTargets.map(target => target.userId)],
  );
  if (!result.rowCount) return 0;
  return scheduleLockedAssetRowsDeletion(client, result.rows);
}

async function scheduleLockedAssetRowsDeletion(client: DbClient, assets: DeletableAssetRow[]) {
  const targetIds = assets.map(asset => asset.id);
  const targetKeys = collectObjectKeys(assets);
  // 共享对象可能同时被不同资产引用。按 key 排序获取事务级锁，保证并发删除中
  // 最后一个引用者一定能够观察到前序事务的已提交状态并创建删除 outbox。
  for (const objectKey of [...targetKeys].sort()) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`asset-object:${objectKey}`],
    );
  }
  await client.query(
    `UPDATE assets
     SET deletion_status = 'deleting', updated_at = now()
     WHERE id = ANY($1::uuid[])`,
    [targetIds],
  );

  // 所有目标对象都进入 Outbox；不同批次对同一 key 的 upsert 会合并 asset_ids。
  // 物理删除前仍由 Outbox 在对象锁内复核资产、上传会话和供应商任务引用。
  // 这可避免“共享主文件 + 各自缩略图”跨 100 条批次时，前序 deleting 行
  // 让最后一批误以为对象仍有外部引用，从而永久漏掉主文件清理。
  for (const objectKey of [...targetKeys].sort()) {
    const owners = assets
      .filter(asset => asset.object_key === objectKey || asset.thumbnail_key === objectKey)
      .map(asset => asset.id);
    await scheduleObjectDeletion(client, objectKey, owners);
  }

  await markAssetsDeletedWhenOutboxComplete(client, targetIds);
  return targetIds.length;
}

export async function processObjectDeletionOutbox(limit = 20) {
  let completed = 0;
  let skipped = 0;
  let failed = 0;

  for (let index = 0; index < limit; index += 1) {
    const claimed = await claimNextDeletion();
    if (!claimed) break;

    try {
      const outcome = await finalizeClaimedDeletion(claimed);
      if (outcome === 'completed') completed += 1;
      if (outcome === 'skipped') skipped += 1;
    } catch (error) {
      await withTransaction(async client => {
        await client.query(
          `UPDATE object_deletion_outbox
         SET status = 'pending',
               last_error = $2,
               claim_token = NULL,
               lease_expires_at = NULL,
               available_at = now() + (LEAST(attempts, 10) * interval '30 seconds'),
               updated_at = now()
           WHERE id = $1 AND claim_token = $3`,
          [claimed.id, safeErrorMessage(error), claimed.claim_token],
        );
      });
      failed += 1;
    }
  }

  return { completed, skipped, failed };
}

export async function sweepExpiredUploadSessions(limit = 100) {
  return withTransaction(async client => {
    // 签名过期后保留 15 分钟宽限，避免删除已经开始但仍在传输的大文件。
    const expired = await client.query<{
      id: string;
      object_key: string;
      final_object_key: string | null;
      thumbnail_key: string | null;
    }>(
      `WITH candidates AS (
         SELECT id
         FROM upload_sessions
         WHERE (
             status = 'pending' AND processing_stage = 'waiting-upload'
               AND expires_at < now() - interval '15 minutes'
           ) OR (
             status IN ('failed', 'canceled') AND retention_until < now()
           )
         ORDER BY expires_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE upload_sessions session
       SET status = 'expired', processing_stage = 'expired', retryable = false, updated_at = now()
       FROM candidates
       WHERE session.id = candidates.id
       RETURNING session.id, session.object_key, session.final_object_key, session.thumbnail_key`,
      [limit],
    );

    for (const session of expired.rows) {
      const asset = await client.query<{ id: string }>(
        `SELECT id FROM assets
         WHERE object_key = $1 AND deletion_status <> 'deleted'
         LIMIT 1`,
        [session.object_key],
      );
      if (asset.rowCount) continue;
      for (const objectKey of [session.object_key, session.final_object_key, session.thumbnail_key]) {
        if (objectKey) await scheduleObjectDeletion(client, objectKey, []);
      }
    }

    return expired.rowCount ?? 0;
  });
}

async function claimNextDeletion() {
  return withTransaction(async client => {
    const result = await client.query<{
      id: string;
      object_key: string;
      asset_ids: string[];
      claim_token: string;
    }>(
      `WITH next_item AS (
         SELECT id
         FROM object_deletion_outbox
         WHERE (
             status = 'pending' AND available_at <= now()
           ) OR (
             status = 'processing' AND lease_expires_at < now()
           )
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE object_deletion_outbox outbox
       SET status = 'processing', attempts = attempts + 1, claim_token = gen_random_uuid(),
           lease_expires_at = now() + interval '5 minutes', updated_at = now()
       FROM next_item
       WHERE outbox.id = next_item.id
       RETURNING outbox.id, outbox.object_key, outbox.asset_ids, outbox.claim_token`,
    );
    return result.rows[0] ?? null;
  });
}

async function finalizeClaimedDeletion(claimed: {
  id: string;
  object_key: string;
  asset_ids: string[];
  claim_token: string;
}) {
  return withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`asset-object:${claimed.object_key}`]);
    const owned = await client.query(
      `SELECT 1 FROM object_deletion_outbox
       WHERE id = $1 AND claim_token = $2 AND status = 'processing' AND lease_expires_at > now()
       FOR UPDATE`,
      [claimed.id, claimed.claim_token],
    );
    if (!owned.rowCount) throw new Error('对象删除任务租约已失效');
    const references = await client.query(
      `SELECT 1 FROM assets
       WHERE id <> ALL($2::uuid[])
         AND deletion_status = 'active'
         AND (object_key = $1 OR thumbnail_key = $1)
       UNION ALL
       SELECT 1 FROM upload_sessions
       WHERE (status IN ('pending', 'processing')
           OR (status = 'failed' AND retryable = true AND retention_until > now()))
         AND (
           object_key = $1 OR final_object_key = $1 OR thumbnail_key = $1
           OR CASE asset_type
                WHEN 'image' THEN 'users/' || user_id || '/upload-thumbnails/' || id || '.webp'
                WHEN 'video' THEN 'users/' || user_id || '/upload-thumbnails/' || id || '.jpg'
                ELSE NULL
              END = $1
         )
       UNION ALL
       SELECT 1 FROM generation_provider_runs
       WHERE status NOT IN ('settled', 'refunded', 'provider-failed')
         AND (output_object_key = $1 OR thumbnail_object_key = $1 OR staging_object_key = $1)
       LIMIT 1`,
      [claimed.object_key, claimed.asset_ids],
    );
    const status = references.rowCount ? 'skipped' : 'completed';
    if (status === 'completed') await deleteObject(claimed.object_key);
    const terminal = await client.query(
      `UPDATE object_deletion_outbox
       SET status = $3, completed_at = now(), last_error = NULL,
           claim_token = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND claim_token = $2 AND status = 'processing'
       RETURNING id`,
      [claimed.id, claimed.claim_token, status],
    );
    if (!terminal.rowCount) throw new Error('对象删除任务租约已失效');
    await markAssetsDeletedWhenOutboxComplete(client, claimed.asset_ids);
    return status;
  });
}

async function markAssetsDeletedWhenOutboxComplete(client: DbClient, assetIds: string[]) {
  if (assetIds.length === 0) return;
  await client.query(
    `UPDATE assets asset
     SET deletion_status = 'deleted', deleted_at = COALESCE(deleted_at, now()), updated_at = now()
     WHERE asset.id = ANY($1::uuid[])
       AND asset.deletion_status = 'deleting'
       AND NOT EXISTS (
         SELECT 1
         FROM object_deletion_outbox outbox
         WHERE asset.id = ANY(outbox.asset_ids)
           AND outbox.status NOT IN ('completed', 'skipped')
       )`,
    [assetIds],
  );
}

function collectObjectKeys(rows: Array<{ object_key: string | null; thumbnail_key: string | null }>) {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of [row.object_key, row.thumbnail_key]) {
      const normalized = key?.trim();
      if (normalized) keys.add(normalized);
    }
  }
  return [...keys];
}

function safeErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : 'Unknown object deletion error').slice(0, 500);
}
