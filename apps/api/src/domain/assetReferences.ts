import type { DbClient } from '../db/pool.js';

export interface OwnedAssetReferenceRow {
  id: string;
  user_id: string;
  name: string;
  object_key: string;
  thumbnail_key: string | null;
  thumbnail_status: string | null;
  type: string;
  duration_seconds: number | string | null;
  size_bytes: number | string | null;
  width: number | string | null;
  height: number | string | null;
}

export interface AssetReferenceOwnership {
  userId: string;
  objectKey: string;
}

export function assetReferenceOwnershipKey(userId: string, objectKey: string) {
  return `${userId}\u0000${objectKey}`;
}

/**
 * 参考素材的对象 key 只能在所属用户的活动资产中解析。使用成对的 unnest
 * 避免 userId/objectKey 两个数组产生笛卡尔积，也让资产列表一次完成归属查询。
 */
export async function readOwnedAssetReferences(
  client: DbClient,
  ownerships: AssetReferenceOwnership[],
) {
  const unique = new Map<string, AssetReferenceOwnership>();
  for (const ownership of ownerships) {
    const userId = ownership.userId.trim();
    const objectKey = ownership.objectKey.trim();
    if (!userId || !objectKey) continue;
    unique.set(assetReferenceOwnershipKey(userId, objectKey), { userId, objectKey });
  }

  if (unique.size === 0) return new Map<string, OwnedAssetReferenceRow>();

  const requested = [...unique.values()];
  const result = await client.query<OwnedAssetReferenceRow>(
    `WITH requested(user_id, object_key) AS (
       SELECT * FROM unnest($1::uuid[], $2::text[])
     )
     SELECT a.id, a.user_id, a.name, a.object_key, a.thumbnail_key,
            a.thumbnail_status,
            a.type, a.duration_seconds, a.size_bytes, a.width, a.height
     FROM assets a
     JOIN requested r
       ON r.user_id = a.user_id AND r.object_key = a.object_key
     WHERE a.deletion_status = 'active'`,
    [requested.map(item => item.userId), requested.map(item => item.objectKey)],
  );

  return new Map(result.rows.map(row => [
    assetReferenceOwnershipKey(row.user_id, row.object_key),
    row,
  ]));
}

/** 新写入边界按不可伪造的资产 ID 解析，返回值只包含当前用户的活动资产。 */
export async function readOwnedAssetReferencesByIds(
  client: DbClient,
  userId: string,
  assetIds: string[],
) {
  const uniqueIds = Array.from(new Set(assetIds.map(id => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return new Map<string, OwnedAssetReferenceRow>();

  const result = await client.query<OwnedAssetReferenceRow>(
    `SELECT id, user_id, name, object_key, thumbnail_key,
            thumbnail_status,
            type, duration_seconds, size_bytes, width, height
     FROM assets
     WHERE user_id = $1
       AND id = ANY($2::uuid[])
       AND deletion_status = 'active'`,
    [userId, uniqueIds],
  );
  return new Map(result.rows.map(row => [row.id, row]));
}

export function buildCanonicalAssetReference(
  asset: OwnedAssetReferenceRow,
  options: { role?: string } = {},
) {
  const reference: Record<string, unknown> = {
    id: asset.id,
    name: asset.name,
    thumbnail: '',
    objectKey: asset.object_key,
    type: asset.type,
  };

  if (asset.thumbnail_key) reference.thumbnailKey = asset.thumbnail_key;
  const durationSeconds = optionalFiniteNumber(asset.duration_seconds, value => value >= 0);
  const sizeBytes = optionalFiniteNumber(asset.size_bytes, value => Number.isSafeInteger(value) && value >= 0);
  const width = optionalFiniteNumber(asset.width, value => Number.isSafeInteger(value) && value > 0);
  const height = optionalFiniteNumber(asset.height, value => Number.isSafeInteger(value) && value > 0);
  if (durationSeconds !== null) reference.durationSeconds = durationSeconds;
  if (sizeBytes !== null) reference.sizeBytes = sizeBytes;
  if (width !== null) reference.width = width;
  if (height !== null) reference.height = height;
  if (options.role) reference.role = options.role;
  return reference;
}

function optionalFiniteNumber(
  value: number | string | null | undefined,
  isValid: (parsed: number) => boolean,
) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && isValid(parsed) ? parsed : null;
}
