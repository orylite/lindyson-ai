import { pathToFileURL } from 'node:url';
import type { PoolClient, QueryResult } from 'pg';
import { env } from '../config/env.js';
import { pool, withTransaction } from '../db/pool.js';
import { scheduleObjectDeletion } from '../domain/assetDeletionService.js';
import {
  buildHistoricalImageThumbnailKey,
  createUploadedImageThumbnail,
} from '../domain/uploadedVideoPreview.js';
import { buildPublicUrl } from '../storage/storageService.js';

interface ImageAssetRow {
  id: string;
  user_id: string;
  object_key: string;
  thumbnail_key: string | null;
  thumbnail_status: 'pending' | 'ready' | 'failed' | 'not-required';
  created_at: Date | string;
}

const BATCH_SIZE = 50;

export async function backfillImageThumbnails(options: { retryFailed?: boolean } = {}) {
  let ready = 0;
  let failed = 0;
  let retryableFailed = 0;
  let skipped = 0;
  let cursorCreatedAt: Date | string | null = null;
  let cursorId: string | null = null;

  while (true) {
    const result: QueryResult<ImageAssetRow> = await pool.query<ImageAssetRow>(
      `SELECT id, user_id, object_key, thumbnail_key, thumbnail_status, created_at
       FROM assets
       WHERE deletion_status = 'active'
         AND type = 'image'
         AND (thumbnail_status <> 'failed' OR $1::boolean)
         AND (
           thumbnail_key IS NULL
           OR thumbnail_key = object_key
           OR thumbnail_status = 'pending'
         )
         AND (
           $3::timestamptz IS NULL
           OR (created_at, id) > ($3::timestamptz, $4::uuid)
         )
       ORDER BY created_at ASC, id ASC
       LIMIT $2`,
      [Boolean(options.retryFailed), BATCH_SIZE, cursorCreatedAt, cursorId],
    );
    if (result.rows.length === 0) break;

    const outcomes = await mapWithConcurrency(
      result.rows,
      env.THUMBNAIL_IMAGE_CONCURRENCY,
      processImageAsset,
    );
    for (const outcome of outcomes) {
      if (outcome === 'ready') ready += 1;
      if (outcome === 'permanent-failed') failed += 1;
      if (outcome === 'retryable-failed') retryableFailed += 1;
      if (outcome === 'skipped') skipped += 1;
    }
    const tail: ImageAssetRow = result.rows.at(-1)!;
    cursorCreatedAt = tail.created_at;
    cursorId = tail.id;
  }

  const remaining = await pool.query<{ pending: string; failed: string }>(
    `SELECT
       count(*) FILTER (
         WHERE thumbnail_status = 'pending'
           AND (thumbnail_key IS NULL OR thumbnail_key = object_key)
       ) AS pending,
       count(*) FILTER (WHERE thumbnail_status = 'failed') AS failed
     FROM assets
     WHERE deletion_status = 'active' AND type = 'image'`,
  );
  return {
    ready,
    failed,
    retryableFailed,
    skipped,
    pendingCount: Number(remaining.rows[0]?.pending ?? 0),
    failedCount: Number(remaining.rows[0]?.failed ?? 0),
  };
}

async function processImageAsset(asset: ImageAssetRow): Promise<'ready' | 'permanent-failed' | 'retryable-failed' | 'skipped'> {
  const client = await pool.connect();
  const lockKey = `asset-thumbnail:${asset.id}`;
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
      [lockKey],
    );
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return 'skipped';

    const current = await readCurrentImage(client, asset.id);
    if (!current || !requiresThumbnail(current)) return 'skipped';
    const thumbnailKey = buildHistoricalImageThumbnailKey(current.user_id, current.id);

    try {
      await createUploadedImageThumbnail({ objectKey: current.object_key, thumbnailKey });
      const updated = await client.query(
        `UPDATE assets
         SET thumbnail_key = $2, thumbnail_url = $3, thumbnail_status = 'ready',
             thumbnail_error_code = NULL, thumbnail_error_message = NULL,
             thumbnail_updated_at = now(), updated_at = now()
         WHERE id = $1 AND user_id = $4 AND deletion_status = 'active'
           AND (thumbnail_key IS NULL OR thumbnail_key = object_key OR thumbnail_status IN ('pending', 'failed'))`,
        [current.id, thumbnailKey, buildPublicUrl(thumbnailKey), current.user_id],
      );
      if (updated.rowCount === 1) return 'ready';
      await scheduleUnreferencedThumbnail(thumbnailKey);
      return 'skipped';
    } catch (error) {
      const permanent = isPermanentImageDecodeFailure(error);
      if (permanent) {
        await client.query(
          `UPDATE assets
           SET thumbnail_status = 'failed', thumbnail_error_code = 'THUMBNAIL_DECODE_FAILED',
               thumbnail_error_message = '图片无法解码或格式不受支持',
               thumbnail_updated_at = now(), updated_at = now()
           WHERE id = $1 AND deletion_status = 'active'
             AND (thumbnail_key IS NULL OR thumbnail_key = object_key)`,
          [current.id],
        );
      } else {
        // 网络、TOS、鉴权和未知基础设施错误不能永久降级为占位图；保留 pending，
        // 由下一次回填重试，CLI 也会因 pending 非零而阻断发布。
        await client.query(
          `UPDATE assets
           SET thumbnail_status = 'pending', thumbnail_error_code = NULL,
               thumbnail_error_message = NULL, thumbnail_updated_at = NULL,
               updated_at = now()
           WHERE id = $1 AND deletion_status = 'active'
             AND (thumbnail_key IS NULL OR thumbnail_key = object_key)`,
          [current.id],
        );
      }
      console.error(`图片缩略图回填失败：asset=${current.id} code=${safeErrorCode(error)} retryable=${String(!permanent)}`);
      return permanent ? 'permanent-failed' : 'retryable-failed';
    }
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]).catch(() => undefined);
    client.release();
  }
}

async function readCurrentImage(client: PoolClient, assetId: string) {
  const result = await client.query<ImageAssetRow>(
    `SELECT id, user_id, object_key, thumbnail_key, thumbnail_status, created_at
     FROM assets
     WHERE id = $1 AND type = 'image' AND deletion_status = 'active'`,
    [assetId],
  );
  return result.rows[0] ?? null;
}

function requiresThumbnail(asset: ImageAssetRow) {
  return !asset.thumbnail_key
    || asset.thumbnail_key === asset.object_key
    || asset.thumbnail_status === 'pending'
    || asset.thumbnail_status === 'failed';
}

async function scheduleUnreferencedThumbnail(objectKey: string) {
  await withTransaction(client => scheduleObjectDeletion(
    client,
    objectKey,
    [],
    new Date(Date.now() + 5 * 60_000),
  ));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, run: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await run(items[current]!);
    }
  }));
  return results;
}

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'THUMBNAIL_UNKNOWN';
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(code)) return code;
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z0-9_.-]{1,100}$/.test(name) ? name : 'THUMBNAIL_PROCESSING_FAILED';
}

/** 只有能够明确归因到图片内容/格式的错误才能永久使用占位图。 */
export function isPermanentImageDecodeFailure(error: unknown) {
  for (const item of errorChain(error)) {
    const message = item instanceof Error
      ? item.message
      : typeof item === 'object' && item && typeof (item as { message?: unknown }).message === 'string'
        ? String((item as { message: string }).message)
        : '';
    if (
      /unsupported image format|not a known file format|corrupt image|corrupt header|premature end of (?:jpeg|png|webp|gif|image|file)|invalid (?:jpeg|png|webp|gif|avif|heif|image)|input image exceeds pixel limit|limitInputPixels|VipsForeignLoad[^\n]*(?:failed|unable|not)/i.test(message)
    ) return true;
  }
  return false;
}

function errorChain(error: unknown) {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current) && chain.length < 8) {
    chain.push(current);
    seen.add(current);
    current = typeof current === 'object' && current
      ? (current as { cause?: unknown }).cause
      : undefined;
  }
  return chain;
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectExecution) {
  backfillImageThumbnails({ retryFailed: process.argv.includes('--retry-failed') })
    .then(result => {
      console.log(`图片缩略图回填完成：${JSON.stringify(result)}`);
      if (result.pendingCount > 0 || result.retryableFailed > 0) process.exitCode = 1;
    })
    .catch(error => {
      console.error(JSON.stringify({
        event: 'image-thumbnail-backfill-aborted',
        errorCode: safeErrorCode(error),
      }));
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
