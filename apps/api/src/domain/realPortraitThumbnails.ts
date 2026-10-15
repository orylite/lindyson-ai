import { createRequire } from 'node:module';
import { pool, withTransaction } from '../db/pool.js';
import { openStoredObjectStream, uploadObjectBuffer } from '../storage/storageService.js';
import { scheduleObjectDeletion } from './assetDeletionService.js';

interface ThumbnailPipeline {
  rotate(): ThumbnailPipeline;
  resize(options: { width: number; height: number; fit: 'inside'; withoutEnlargement: boolean }): ThumbnailPipeline;
  webp(options: { quality: number }): ThumbnailPipeline;
  toBuffer(): Promise<Buffer>;
}
const sharp = createRequire(import.meta.url)('sharp') as (input: Buffer, options: { limitInputPixels: number; animated: boolean }) => ThumbnailPipeline;

const joins = `FROM real_portrait_assets pa
  JOIN real_portrait_actors a ON a.id = pa.actor_id
  JOIN real_portrait_materializations m ON m.id = pa.materialization_id
  JOIN real_portrait_authorizations auth ON auth.id = m.authorization_id`;
const retained = `auth.thumbnail_storage_allowed AND auth.status IN ('verified', 'active')
  AND auth.valid_until > now() AND a.deleted_at IS NULL
  AND a.lifecycle_status NOT IN ('revoked', 'expired', 'evicted', 'deleting', 'sync_error')
  AND m.status NOT IN ('deleting', 'evicted', 'deleted', 'error')
  AND pa.status IN ('queued', 'processing', 'active') AND pa.consistency_status <> 'failed'
  AND NOT EXISTS (SELECT 1 FROM real_portrait_upload_sessions upload
    WHERE upload.asset_id = pa.id AND upload.status IN ('expired', 'failed'))`;

export async function createPortraitThumbnail(input: Buffer) {
  return sharp(input, { limitInputPixels: 36_000_000, animated: false })
    .rotate().resize({ width: 160, height: 160, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 }).toBuffer();
}

/** 对象键已在上传准备事务中持久化；崩溃、重试或写入失败仍能由清理任务找回。 */
export async function ensureRealPortraitThumbnail(userId: string, assetId: string, sourceKey: string) {
  await withTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('lindyson:real-portrait:provider-capacity:v1'))");
    const result = await client.query<{ thumbnail_object_key: string }>(
      `SELECT pa.thumbnail_object_key ${joins}
       WHERE pa.id = $1 AND a.user_id = $2 AND pa.thumbnail_object_key IS NOT NULL
         AND NOT pa.thumbnail_ready AND ${retained}
       FOR UPDATE OF pa, a, m, auth`, [assetId, userId],
    );
    const asset = result.rows[0];
    if (!asset) return;
    const stream = await openStoredObjectStream(sourceKey);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size >= 30 * 1024 * 1024) throw new Error('真人缩略图源文件超出大小限制');
      chunks.push(buffer);
    }
    const body = await createPortraitThumbnail(Buffer.concat(chunks));
    await uploadObjectBuffer({ objectKey: asset.thumbnail_object_key, body, contentType: 'image/webp' });
    await client.query('UPDATE real_portrait_assets SET thumbnail_ready = true WHERE id = $1', [assetId]);
  });
}

export async function readRealPortraitThumbnail(userId: string, actorId: string, assetId: string) {
  const result = await pool.query<{ thumbnail_object_key: string }>(
    `SELECT pa.thumbnail_object_key ${joins}
     WHERE a.id = $1 AND a.user_id = $2 AND pa.id = $3 AND pa.thumbnail_ready
       AND ${retained} AND auth.status = 'active' AND auth.valid_from <= now()
       AND a.plan_access_status <> 'plan_locked' AND a.lifecycle_status = 'active'
       AND m.status IN ('active', 'eviction_warning')
       AND pa.status = 'active' AND pa.consistency_status = 'passed'`,
    [actorId, userId, assetId],
  );
  if (!result.rows[0]) throw Object.assign(new Error('真人图片预览不可用'), { statusCode: 404 });
  return openStoredObjectStream(result.rows[0].thumbnail_object_key);
}

export async function scheduleInvalidRealPortraitThumbnailDeletion(limit = 100) {
  return withTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('lindyson:real-portrait:provider-capacity:v1'))");
    const result = await client.query<{ id: string; thumbnail_object_key: string }>(
      `SELECT pa.id, pa.thumbnail_object_key ${joins}
       WHERE pa.thumbnail_object_key IS NOT NULL AND NOT (${retained})
       ORDER BY pa.id LIMIT $1 FOR UPDATE OF pa SKIP LOCKED`, [limit],
    );
    for (const asset of result.rows) {
      await scheduleObjectDeletion(client, asset.thumbnail_object_key);
      await client.query(
        'UPDATE real_portrait_assets SET thumbnail_object_key = NULL, thumbnail_ready = false WHERE id = $1',
        [asset.id],
      );
    }
    return result.rows.length;
  });
}
