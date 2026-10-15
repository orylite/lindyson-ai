import path from 'node:path';
import { pool, type DbClient } from '../db/pool.js';
import {
  createObjectDownloadUrl,
  readStoredObjectSize,
} from '../storage/storageService.js';

interface AssetDownloadRow {
  object_key: string;
  name: string;
}

export interface AssetDownload {
  url: string;
  filename: string;
}

export interface OwnedAssetDownload extends AssetDownload {
  downloadRequestedAt: Date | string;
}

const DOWNLOAD_FILE_EXTENSIONS = new Set([
  '.avif', '.gif', '.jpeg', '.jpg', '.mov', '.mp3', '.mp4', '.mpeg', '.png', '.wav', '.webm', '.webp',
]);

export async function prepareOwnedAssetDownload(
  assetId: string,
  userId: string,
  client: DbClient = pool,
): Promise<OwnedAssetDownload> {
  const asset = await readActiveAsset(client, assetId, userId);
  const download = await prepareOriginalAssetDownload(asset);
  const updated = await client.query<{ download_requested_at: Date | string }>(
    `UPDATE assets
     SET download_requested_at = COALESCE(download_requested_at, now())
     WHERE id = $1 AND user_id = $2 AND deletion_status = 'active'
     RETURNING download_requested_at`,
    [assetId, userId],
  );
  if (!updated.rowCount) throw assetNotFoundError();

  return {
    ...download,
    downloadRequestedAt: updated.rows[0]!.download_requested_at,
  };
}

export async function prepareAdminAssetDownload(
  assetId: string,
  client: DbClient = pool,
): Promise<AssetDownload> {
  const asset = await readActiveAsset(client, assetId);
  return prepareOriginalAssetDownload(asset);
}

export function buildAssetDownloadFilename(name: string, objectKey: string) {
  const storedExtension = path.posix.extname(objectKey).toLowerCase();
  if (!DOWNLOAD_FILE_EXTENSIONS.has(storedExtension)) return name.slice(0, 255);

  const currentExtension = path.posix.extname(name).toLowerCase();
  const basename = DOWNLOAD_FILE_EXTENSIONS.has(currentExtension)
    ? name.slice(0, -currentExtension.length)
    : name;
  return `${basename.slice(0, Math.max(1, 255 - storedExtension.length))}${storedExtension}`;
}

async function readActiveAsset(client: DbClient, assetId: string, userId?: string) {
  const values = userId === undefined ? [assetId] : [assetId, userId];
  const ownershipCondition = userId === undefined ? '' : ' AND user_id = $2';
  const result = await client.query<AssetDownloadRow>(
    `SELECT object_key, name
     FROM assets
     WHERE id = $1${ownershipCondition} AND deletion_status = 'active'
     LIMIT 1`,
    values,
  );
  const asset = result.rows[0];
  if (!asset) throw assetNotFoundError();
  return asset;
}

async function prepareOriginalAssetDownload(asset: AssetDownloadRow): Promise<AssetDownload> {
  try {
    await readStoredObjectSize(asset.object_key);
  } catch (error) {
    if (isMissingStoredObjectError(error)) throw assetOriginalMissingError();
    throw error;
  }

  const filename = buildAssetDownloadFilename(asset.name, asset.object_key);
  return {
    url: await createObjectDownloadUrl(asset.object_key, filename),
    filename,
  };
}

function assetNotFoundError() {
  return Object.assign(new Error('素材不存在'), { statusCode: 404 });
}

function assetOriginalMissingError() {
  return Object.assign(new Error('素材原始文件不存在'), {
    statusCode: 404,
    code: 'ASSET_ORIGINAL_MISSING',
  });
}

function isMissingStoredObjectError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as {
    code?: string;
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return value.code === 'ENOENT'
    || value.name === 'NotFound'
    || value.name === 'NoSuchKey'
    || value.$metadata?.httpStatusCode === 404;
}
