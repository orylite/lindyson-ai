import path from 'node:path';
import { pool, type DbClient } from '../db/pool.js';
import { signOwnedObjectReadUrl, signOwnedObjectReadUrls } from './assetReadUrlSigner.js';
import {
  assetReferenceOwnershipKey,
  buildCanonicalAssetReference,
  readOwnedAssetReferences,
  type OwnedAssetReferenceRow,
} from './assetReferences.js';
import { toIsoDateTime, toInt } from './serialization.js';

export interface AssetRow {
  id: string;
  user_id: string;
  name: string;
  type: string;
  source: string;
  folder_id: string | null;
  object_key: string;
  thumbnail_key: string | null;
  thumbnail_status?: string | null;
  size_bytes: number | string | null;
  duration_seconds: number | string | null;
  width: number | null;
  height: number | null;
  generation_meta: unknown;
  views: number | string | null;
  downloaded_at: Date | string | null;
  download_requested_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export type AssetCardRow = Pick<AssetRow,
  | 'id'
  | 'name'
  | 'type'
  | 'source'
  | 'folder_id'
  | 'object_key'
  | 'thumbnail_key'
  | 'thumbnail_status'
  | 'size_bytes'
  | 'duration_seconds'
  | 'width'
  | 'height'
  | 'views'
  | 'downloaded_at'
  | 'download_requested_at'
  | 'created_at'
  | 'updated_at'
>;

const referenceRoles = new Set([
  'reference_image',
  'reference_video',
  'reference_audio',
  'first_frame',
  'last_frame',
]);
const assetTypes = new Set(['video', 'image', 'audio']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 新用户端详情映射器。对象 key 只在服务端用于所有权核对和签名，任何层级的响应
 * 都不会返回 objectKey/thumbnailKey；历史引用只投影为安全预览字段。
 */
export async function mapAssetDetailRow(row: AssetRow, client: DbClient = pool) {
  const ownedReferences = await readOwnedAssetReferences(
    client,
    collectReferenceOwnerships([row]),
  );
  const signedUrls = new Map<string, Promise<string>>();
  const signObject = (objectKey: string) => {
    let signed = signedUrls.get(objectKey);
    if (!signed) {
      signed = signOwnedObjectReadUrl(objectKey);
      signedUrls.set(objectKey, signed);
    }
    return signed;
  };
  const publicUrl = await signObject(row.object_key);
  const thumbnailUrl = row.thumbnail_status === 'ready'
    && row.thumbnail_key
    && row.thumbnail_key !== row.object_key
    ? await signObject(row.thumbnail_key)
    : null;
  const generationWithFreshUrls = await refreshGenerationReferenceUrls(
    row.generation_meta,
    row.user_id,
    ownedReferences,
    signObject,
    false,
  );

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    source: row.source,
    folderId: row.folder_id,
    publicUrl,
    thumbnailUrl,
    sizeBytes: toInt(row.size_bytes),
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    width: row.width,
    height: row.height,
    generation: mapSafeAssetGeneration(generationWithFreshUrls),
    views: toInt(row.views),
    downloadedAt: toIsoDateTime(row.downloaded_at),
    downloadRequestedAt: toIsoDateTime(row.download_requested_at ?? row.downloaded_at),
    createdAt: toIsoDateTime(row.created_at),
    updatedAt: toIsoDateTime(row.updated_at),
  };
}

/** 列表只签真实缩略图，不读取或投影生成配置和原始对象访问地址。 */
export async function mapAssetCardRows(rows: AssetCardRow[]) {
  const thumbnailKeys = rows.flatMap(row => isReadyCardThumbnail(row) ? [row.thumbnail_key!] : []);
  const signedThumbnails = await signOwnedObjectReadUrls(thumbnailKeys);
  return rows.map(row => mapAssetCardRowWithUrls(row, signedThumbnails));
}

export async function mapAssetCardRow(row: AssetCardRow) {
  const signedThumbnails = isReadyCardThumbnail(row)
    ? await signOwnedObjectReadUrls([row.thumbnail_key!])
    : new Map<string, string>();
  return mapAssetCardRowWithUrls(row, signedThumbnails);
}

function mapAssetCardRowWithUrls(row: AssetCardRow, signedThumbnails: ReadonlyMap<string, string>) {
  const extension = path.posix.extname(row.object_key).toLowerCase();
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    source: row.source,
    folderId: row.folder_id,
    previewUrl: isReadyCardThumbnail(row) ? signedThumbnails.get(row.thumbnail_key!) ?? null : null,
    sizeBytes: toInt(row.size_bytes),
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    width: row.width,
    height: row.height,
    mediaExtension: extension ? extension.slice(1) : null,
    views: toInt(row.views),
    firstDownloadAt: toIsoDateTime(row.download_requested_at ?? row.downloaded_at),
    createdAt: toIsoDateTime(row.created_at),
    updatedAt: toIsoDateTime(row.updated_at),
  };
}

function isReadyCardThumbnail(row: AssetCardRow) {
  return row.thumbnail_status === 'ready'
    && Boolean(row.thumbnail_key)
    && row.thumbnail_key !== row.object_key;
}

function collectReferenceOwnerships(rows: AssetRow[]) {
  const ownerships: Array<{ userId: string; objectKey: string }> = [];
  for (const row of rows) {
    collectReferenceContainerOwnerships(row.generation_meta, row.user_id, ownerships);
    if (isRecord(row.generation_meta)) {
      collectReferenceContainerOwnerships(row.generation_meta.config, row.user_id, ownerships);
    }
  }
  return ownerships;
}

function collectReferenceContainerOwnerships(
  container: unknown,
  userId: string,
  ownerships: Array<{ userId: string; objectKey: string }>,
) {
  if (!isRecord(container)) return;
  for (const field of ['referenceAssets', 'referenceImages'] as const) {
    const references = container[field];
    if (!Array.isArray(references)) continue;
    for (const reference of references) {
      if (!isRecord(reference)) continue;
      const objectKey = safeString(reference.objectKey);
      if (objectKey) ownerships.push({ userId, objectKey });
    }
  }
}

async function refreshGenerationReferenceUrls(
  generation: unknown,
  userId: string,
  ownedReferences: Map<string, OwnedAssetReferenceRow>,
  signObject: (objectKey: string) => Promise<string>,
  includeReferenceOriginals = true,
) {
  if (!isRecord(generation)) return generation;

  const next = { ...generation };
  if (isRecord(next.config)) {
    next.config = await refreshReferenceContainer(
      next.config,
      userId,
      ownedReferences,
      signObject,
      includeReferenceOriginals,
    );
  }

  return refreshReferenceContainer(
    next,
    userId,
    ownedReferences,
    signObject,
    includeReferenceOriginals,
  );
}

async function refreshReferenceContainer(
  container: Record<string, unknown>,
  userId: string,
  ownedReferences: Map<string, OwnedAssetReferenceRow>,
  signObject: (objectKey: string) => Promise<string>,
  includeReferenceOriginals: boolean,
) {
  const next = { ...container };

  if (Array.isArray(next.referenceAssets)) {
    next.referenceAssets = (await Promise.all(next.referenceAssets.map(reference => (
      refreshReferenceAssetUrls(
        reference,
        userId,
        ownedReferences,
        signObject,
        false,
        includeReferenceOriginals,
      )
    )))).filter((reference): reference is Record<string, unknown> => reference !== null);
  }

  if (Array.isArray(next.referenceImages)) {
    next.referenceImages = (await Promise.all(next.referenceImages.map(reference => (
      refreshReferenceAssetUrls(
        reference,
        userId,
        ownedReferences,
        signObject,
        true,
        includeReferenceOriginals,
      )
    )))).filter((reference): reference is Record<string, unknown> => reference !== null);
  }

  return next;
}

async function refreshReferenceAssetUrls(
  reference: unknown,
  userId: string,
  ownedReferences: Map<string, OwnedAssetReferenceRow>,
  signObject: (objectKey: string) => Promise<string>,
  imageOnly: boolean,
  includeReferenceOriginals: boolean,
): Promise<Record<string, unknown> | null> {
  if (!isRecord(reference)) return null;

  const objectKey = safeString(reference.objectKey);
  if (!objectKey) return sanitizeLegacyExternalReference(reference, imageOnly);

  const owned = ownedReferences.get(assetReferenceOwnershipKey(userId, objectKey));
  if (!owned) return scrubUnownedReference(reference, imageOnly);
  if (imageOnly && owned.type !== 'image') return null;

  const role = safeReferenceRole(reference.role);
  const next = buildCanonicalAssetReference(owned, { role });
  const publicUrl = includeReferenceOriginals ? await signObject(owned.object_key) : null;
  const thumbnailUrl = owned.thumbnail_status === 'ready'
    && owned.thumbnail_key
    && owned.thumbnail_key !== owned.object_key
    ? await signObject(owned.thumbnail_key)
    : null;

  if (publicUrl) next.publicUrl = publicUrl;
  next.thumbnail = thumbnailUrl ?? '';
  if (thumbnailUrl) next.thumbnailUrl = thumbnailUrl;
  return next;
}

function sanitizeLegacyExternalReference(reference: Record<string, unknown>, imageOnly: boolean) {
  const next = { ...reference };
  delete next.objectKey;
  delete next.thumbnailKey;
  delete next.publicUrl;
  delete next.thumbnailUrl;
  delete next.url;
  next.thumbnail = '';
  if (imageOnly) next.type = 'image';
  return next;
}

function scrubUnownedReference(reference: Record<string, unknown>, imageOnly: boolean) {
  const next = { ...reference };
  delete next.objectKey;
  delete next.thumbnailKey;
  delete next.publicUrl;
  delete next.thumbnailUrl;
  delete next.url;
  next.thumbnail = '';
  if (imageOnly) next.type = 'image';
  return next;
}

function safeReferenceRole(value: unknown) {
  const role = safeString(value);
  return role && referenceRoles.has(role) ? role : undefined;
}

function mapSafeAssetGeneration(value: unknown) {
  if (!isRecord(value)) return value === null ? null : undefined;
  const kind = safeString(value.kind);
  const model = safeString(value.model);
  if (!kind || !model || typeof value.prompt !== 'string') return null;

  const result: Record<string, unknown> = {
    kind,
    model,
    prompt: value.prompt,
  };
  copySafeGenerationScalars(value, result, true);
  if (isRecord(value.config)) result.config = mapSafeGenerationContainer(value.config);
  copySafeGenerationReferences(value, result);
  return result;
}

function mapSafeGenerationContainer(value: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  copySafeGenerationScalars(value, result, false);
  copySafeGenerationReferences(value, result);
  return result;
}

function copySafeGenerationScalars(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  includeCredits: boolean,
) {
  for (const key of ['mode', 'aspectRatio', 'resolution', 'outputSize', 'ratio'] as const) {
    if (typeof source[key] === 'string') target[key] = source[key];
  }
  if (source.optimizePromptMode === 'standard' || source.optimizePromptMode === 'fast') {
    target.optimizePromptMode = source.optimizePromptMode;
  }
  if (typeof source.generateAudio === 'boolean') target.generateAudio = source.generateAudio;
  if (isNonnegativeFinite(source.durationSeconds)) target.durationSeconds = Number(source.durationSeconds);
  if (includeCredits && isNonnegativeFinite(source.credits)) target.credits = Math.trunc(Number(source.credits));

  const annotations = mapSafeImageAnnotations(source.annotations);
  if (annotations.length > 0) target.annotations = annotations;
}

function mapSafeImageAnnotations(value: unknown) {
  if (!Array.isArray(value)) return [];
  const safeAnnotations: Array<
    | { token: string; assetId: string; type: 'point'; x: number; y: number }
    | { token: string; assetId: string; type: 'bbox'; x1: number; y1: number; x2: number; y2: number }
  > = [];
  for (const annotation of value) {
    if (!isRecord(annotation)) continue;
    const token = safeString(annotation.token);
    const assetId = safeString(annotation.assetId);
    if (!token || !/^@标记(?:[1-9]\d{0,2})$/.test(token)
      || !assetId || !uuidPattern.test(assetId)) continue;

    if (annotation.type === 'point') {
      const x = safeImageCoordinate(annotation.x);
      const y = safeImageCoordinate(annotation.y);
      if (x !== null && y !== null) safeAnnotations.push({ token, assetId, type: 'point', x, y });
      continue;
    }
    if (annotation.type === 'bbox') {
      const x1 = safeImageCoordinate(annotation.x1);
      const y1 = safeImageCoordinate(annotation.y1);
      const x2 = safeImageCoordinate(annotation.x2);
      const y2 = safeImageCoordinate(annotation.y2);
      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null && x1 < x2 && y1 < y2) {
        safeAnnotations.push({ token, assetId, type: 'bbox', x1, y1, x2, y2 });
      }
    }
  }
  return safeAnnotations;
}

function safeImageCoordinate(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 999
    ? Number(value)
    : null;
}

function copySafeGenerationReferences(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
) {
  if (Array.isArray(source.referenceImages)) {
    target.referenceImages = source.referenceImages
      .map(reference => mapSafeAssetReference(reference, true))
      .filter((reference): reference is Record<string, unknown> => reference !== null);
  }
  if (Array.isArray(source.referenceAssets)) {
    target.referenceAssets = source.referenceAssets
      .map(reference => mapSafeAssetReference(reference, false))
      .filter((reference): reference is Record<string, unknown> => reference !== null);
  }
}

function mapSafeAssetReference(reference: unknown, imageOnly: boolean) {
  if (!isRecord(reference)) return null;
  const id = safeString(reference.id);
  const name = safeString(reference.name);
  const rawType = imageOnly ? 'image' : safeString(reference.type);
  if (!id || !uuidPattern.test(id) || !name || !rawType || !assetTypes.has(rawType)) return null;

  const result: Record<string, unknown> = {
    id,
    name,
    type: rawType,
    previewUrl: safeHttpUrl(reference.thumbnailUrl)
      ?? safeHttpUrl(reference.thumbnail)
      ?? null,
  };
  const role = safeReferenceRole(reference.role);
  if (role) result.role = role;
  if (isNonnegativeFinite(reference.durationSeconds)) {
    result.durationSeconds = Number(reference.durationSeconds);
  }
  if (isNonnegativeFinite(reference.sizeBytes)) {
    result.sizeBytes = Math.trunc(Number(reference.sizeBytes));
  }
  return result;
}

function safeHttpUrl(value: unknown) {
  const raw = safeString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function isNonnegativeFinite(value: unknown) {
  const numeric = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) && numeric >= 0;
}

function safeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
