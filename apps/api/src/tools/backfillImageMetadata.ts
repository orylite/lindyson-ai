import { pathToFileURL } from 'node:url';
import type { PoolClient, QueryResult } from 'pg';
import { pool } from '../db/pool.js';
import { probeMedia, validateMediaDecoding, type MediaMetadata } from '../storage/mediaProcessor.js';
import { getStoredObjectSize, resolveObjectProcessingInput } from '../storage/storageService.js';

interface ImageMetadataAssetRow {
  id: string;
  user_id: string;
  name: string;
  object_key: string;
  size_bytes: number | string | null;
  width: number | string | null;
  height: number | string | null;
  created_at: Date | string;
}

type BackfillOutcome = 'updated' | 'would-update' | 'skipped' | 'failed';

export interface BackfillImageMetadataOptions {
  dryRun?: boolean;
  assetId?: string | null;
}

export interface BackfillImageMetadataResult {
  dryRun: boolean;
  assetId: string | null;
  scanned: number;
  updated: number;
  wouldUpdate: number;
  skipped: number;
  failed: number;
  remainingCount: number;
}

const BATCH_SIZE = 50;
const PROCESS_CONCURRENCY = 2;
const supportedImageExtensions = new Set([
  'jpeg', 'jpg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'heic', 'heif',
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function backfillImageMetadata(
  options: BackfillImageMetadataOptions = {},
): Promise<BackfillImageMetadataResult> {
  const dryRun = options.dryRun === true;
  const assetId = normalizeAssetId(options.assetId);
  const summary: BackfillImageMetadataResult = {
    dryRun,
    assetId,
    scanned: 0,
    updated: 0,
    wouldUpdate: 0,
    skipped: 0,
    failed: 0,
    remainingCount: 0,
  };
  let cursorCreatedAt: Date | string | null = null;
  let cursorId: string | null = null;

  while (true) {
    const result: QueryResult<ImageMetadataAssetRow> = await pool.query<ImageMetadataAssetRow>(
      `SELECT id, user_id, name, object_key, size_bytes, width, height,
              created_at::text AS created_at
       FROM assets
       WHERE deletion_status = 'active'
         AND type = 'image'
         AND ($1::uuid IS NULL OR id = $1::uuid)
         AND (
           size_bytes IS NULL OR size_bytes <= 0
           OR width IS NULL OR width <= 0
           OR height IS NULL OR height <= 0
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

    summary.scanned += result.rows.length;
    const outcomes = await mapWithConcurrency(
      result.rows,
      PROCESS_CONCURRENCY,
      asset => processImageMetadataAsset(asset, dryRun),
    );
    for (const outcome of outcomes) {
      if (outcome === 'updated') summary.updated += 1;
      if (outcome === 'would-update') summary.wouldUpdate += 1;
      if (outcome === 'skipped') summary.skipped += 1;
      if (outcome === 'failed') summary.failed += 1;
    }

    const tail = result.rows.at(-1)!;
    cursorCreatedAt = tail.created_at;
    cursorId = tail.id;
  }

  const remaining = await pool.query<{ count: string }>(
    `SELECT count(*)::bigint AS count
     FROM assets
     WHERE deletion_status = 'active'
       AND type = 'image'
       AND ($1::uuid IS NULL OR id = $1::uuid)
       AND (
         size_bytes IS NULL OR size_bytes <= 0
         OR width IS NULL OR width <= 0
         OR height IS NULL OR height <= 0
       )`,
    [assetId],
  );
  summary.remainingCount = Number(remaining.rows[0]?.count ?? 0);
  return summary;
}

async function processImageMetadataAsset(
  asset: ImageMetadataAssetRow,
  dryRun: boolean,
): Promise<BackfillOutcome> {
  const client = await pool.connect();
  const lockKey = `asset-image-metadata:${asset.id}`;
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
      [lockKey],
    );
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return 'skipped';

    const current = await readCurrentImage(client, asset.id);
    if (!current || !requiresMetadataRepair(current)) return 'skipped';

    try {
      const detected = await inspectOriginalImage(current);
      if (dryRun) return 'would-update';

      const updated = await client.query(
        `UPDATE assets
         SET size_bytes = $2, width = $3, height = $4, updated_at = now()
         WHERE id = $1
           AND user_id = $5
           AND object_key = $6
           AND type = 'image'
           AND deletion_status = 'active'
           AND size_bytes IS NOT DISTINCT FROM $7::bigint
           AND width IS NOT DISTINCT FROM $8::integer
           AND height IS NOT DISTINCT FROM $9::integer
           AND (
             size_bytes IS NULL OR size_bytes <= 0
             OR width IS NULL OR width <= 0
             OR height IS NULL OR height <= 0
           )`,
        [
          current.id,
          detected.sizeBytes,
          detected.width,
          detected.height,
          current.user_id,
          current.object_key,
          current.size_bytes,
          current.width,
          current.height,
        ],
      );
      return updated.rowCount === 1 ? 'updated' : 'skipped';
    } catch (error) {
      console.error(`图片元数据回填失败：asset=${current.id} code=${safeErrorCode(error)}`);
      return 'failed';
    }
  } finally {
    let destroyClient = false;
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
      } catch {
        destroyClient = true;
        console.error(`图片元数据回填失败：asset=${asset.id} code=IMAGE_METADATA_LOCK_RELEASE_FAILED`);
      }
    }
    if (destroyClient) client.release(true);
    else client.release();
  }
}

async function readCurrentImage(client: PoolClient, assetId: string) {
  const result = await client.query<ImageMetadataAssetRow>(
    `SELECT id, user_id, name, object_key, size_bytes, width, height, created_at
     FROM assets
     WHERE id = $1 AND type = 'image' AND deletion_status = 'active'`,
    [assetId],
  );
  return result.rows[0] ?? null;
}

async function inspectOriginalImage(asset: ImageMetadataAssetRow) {
  const sizeBytes = await getStoredObjectSize(asset.object_key);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw codedError('IMAGE_METADATA_OBJECT_SIZE_INVALID');
  }

  const processingInput = await resolveObjectProcessingInput(asset.object_key);
  const metadata = await probeMedia(processingInput);
  assertDetectedImage(asset, metadata);
  await validateMediaDecoding(processingInput, 'image');
  return {
    sizeBytes,
    width: metadata.width!,
    height: metadata.height!,
  };
}

function assertDetectedImage(asset: Pick<ImageMetadataAssetRow, 'name' | 'object_key'>, metadata: MediaMetadata) {
  const extension = fileExtension(asset.object_key) ?? fileExtension(asset.name);
  const format = metadata.formatName?.toLowerCase() ?? '';
  const imageContainer = /(?:image2|png_pipe|jpeg_pipe|webp_pipe|bmp_pipe|tiff_pipe|gif)/.test(format);
  const majorBrand = metadata.majorBrand?.toLowerCase() ?? '';
  const heifContainer = ['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(majorBrand)
    && metadata.videoCodec?.toLowerCase() === 'hevc'
    && (extension === 'heic' || extension === 'heif');
  if (!extension || !supportedImageExtensions.has(extension)
    || metadata.hasVideo !== true || metadata.hasAudio === true
    || (!imageContainer && !heifContainer)
    || !isPositiveSafeInteger(metadata.width) || !isPositiveSafeInteger(metadata.height)) {
    throw codedError('IMAGE_METADATA_MEDIA_INVALID');
  }
}

function requiresMetadataRepair(asset: Pick<ImageMetadataAssetRow, 'size_bytes' | 'width' | 'height'>) {
  return !isPositiveSafeInteger(asset.size_bytes)
    || !isPositiveSafeInteger(asset.width)
    || !isPositiveSafeInteger(asset.height);
}

function isPositiveSafeInteger(value: unknown): value is number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

function fileExtension(value: string) {
  const withoutQuery = value.split(/[?#]/)[0] ?? '';
  const basename = withoutQuery.split('/').at(-1) ?? '';
  return basename.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() ?? null;
}

function codedError(code: string) {
  return Object.assign(new Error(code), { code });
}

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'IMAGE_METADATA_PROCESSING_FAILED';
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(code)) return code;
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z0-9_.-]{1,100}$/.test(name) && name !== 'Error'
    ? name
    : 'IMAGE_METADATA_PROCESSING_FAILED';
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<R>,
) {
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

function normalizeAssetId(value: string | null | undefined) {
  const assetId = value?.trim() || null;
  if (assetId && !uuidPattern.test(assetId)) throw codedError('IMAGE_METADATA_ASSET_ID_INVALID');
  return assetId;
}

export function parseBackfillImageMetadataArgs(args: string[]): Required<BackfillImageMetadataOptions> {
  let dryRun = false;
  let assetId: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (argument === '--asset-id') {
      const value = args[index + 1];
      if (!value || value.startsWith('--') || assetId !== null) {
        throw codedError('IMAGE_METADATA_ARGUMENT_INVALID');
      }
      assetId = normalizeAssetId(value);
      index += 1;
      continue;
    }
    throw codedError('IMAGE_METADATA_ARGUMENT_INVALID');
  }
  return { dryRun, assetId };
}

export function shouldFailImageMetadataBackfill(result: BackfillImageMetadataResult) {
  if (result.failed > 0) return true;
  if (!result.dryRun) return result.remainingCount > 0;
  return result.skipped > 0 && result.remainingCount > 0;
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectExecution) {
  let options: Required<BackfillImageMetadataOptions>;
  try {
    options = parseBackfillImageMetadataArgs(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({
      event: 'image-metadata-backfill-arguments-invalid',
      errorCode: safeErrorCode(error),
    }));
    process.exitCode = 1;
    options = { dryRun: true, assetId: null };
  }

  if (process.exitCode !== 1) {
    backfillImageMetadata(options)
      .then(result => {
        console.log(`图片元数据${result.dryRun ? '演练' : '回填'}完成：${JSON.stringify(result)}`);
        if (shouldFailImageMetadataBackfill(result)) process.exitCode = 1;
      })
      .catch(error => {
        console.error(JSON.stringify({
          event: 'image-metadata-backfill-aborted',
          errorCode: safeErrorCode(error),
        }));
        process.exitCode = 1;
      })
      .finally(() => pool.end());
  } else {
    void pool.end();
  }
}
