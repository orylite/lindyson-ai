const assetTypes = new Set(['video', 'image', 'audio']);
const referenceRoles = new Set([
  'reference_image',
  'reference_video',
  'reference_audio',
  'first_frame',
  'last_frame',
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 任务配置是历史 JSON，内部仍可能含对象 key 和已过期 URL。响应边界只保留
 * 展示需要的标量和不可反推出存储路径的引用元数据。
 */
export function mapSafeGenerationTaskConfig(value: unknown) {
  if (!isRecord(value)) return {};
  const config: Record<string, unknown> = {};
  for (const field of ['mode', 'aspectRatio', 'resolution', 'outputSize', 'ratio'] as const) {
    if (typeof value[field] === 'string') config[field] = value[field];
  }
  if (value.optimizePromptMode === 'standard' || value.optimizePromptMode === 'fast') {
    config.optimizePromptMode = value.optimizePromptMode;
  }
  if (typeof value.generateAudio === 'boolean') config.generateAudio = value.generateAudio;
  const durationSeconds = Number(value.durationSeconds);
  if (value.durationSeconds !== null && value.durationSeconds !== undefined
    && Number.isFinite(durationSeconds) && durationSeconds >= 0) {
    config.durationSeconds = durationSeconds;
  }

  const seen = new Set<string>();
  const references = [
    ...readSafeReferences(value.referenceAssets, false),
    ...readSafeReferences(value.referenceImages, true),
  ].filter(reference => {
    const key = `${reference.id}\u0000${reference.role ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (references.length > 0) config.referenceAssets = references;
  if (isRecord(value.realPortraitReference)) {
    const actorId = safeUuid(value.realPortraitReference.actorId);
    const portraitAssetId = safeUuid(value.realPortraitReference.portraitAssetId);
    if (actorId && portraitAssetId) config.realPortrait = { actorId, portraitAssetId };
  }
  const annotations = readSafeAnnotations(value.annotations);
  if (annotations.length > 0) config.annotations = annotations;
  return config;
}

function readSafeAnnotations(value: unknown) {
  if (!Array.isArray(value)) return [];
  const safeAnnotations: Array<
    | { token: string; assetId: string; type: 'point'; x: number; y: number }
    | { token: string; assetId: string; type: 'bbox'; x1: number; y1: number; x2: number; y2: number }
  > = [];
  for (const annotation of value) {
    if (!isRecord(annotation)) continue;
    const token = safeText(annotation.token);
    const assetId = safeUuid(annotation.assetId);
    if (!token || !/^@标记(?:[1-9]\d{0,2})$/.test(token) || !assetId) continue;
    if (annotation.type === 'point') {
      const x = safeCoordinate(annotation.x);
      const y = safeCoordinate(annotation.y);
      if (x !== null && y !== null) safeAnnotations.push({ token, assetId, type: 'point', x, y });
      continue;
    }
    if (annotation.type === 'bbox') {
      const x1 = safeCoordinate(annotation.x1);
      const y1 = safeCoordinate(annotation.y1);
      const x2 = safeCoordinate(annotation.x2);
      const y2 = safeCoordinate(annotation.y2);
      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null && x1 < x2 && y1 < y2) {
        safeAnnotations.push({ token, assetId, type: 'bbox', x1, y1, x2, y2 });
      }
    }
  }
  return safeAnnotations;
}

function safeCoordinate(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 999
    ? Number(value)
    : null;
}

function readSafeReferences(value: unknown, imageOnly: boolean) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(reference => {
    if (!isRecord(reference)) return [];
    const id = safeUuid(reference.id);
    const name = safeText(reference.name);
    const type = imageOnly ? 'image' : safeAssetType(reference.type);
    if (!id || !name || !type) return [];
    const item: Record<string, unknown> = { id, name, type, previewUrl: null };
    const role = safeReferenceRole(reference.role);
    if (role) item.role = role;
    const duration = Number(reference.durationSeconds);
    if (reference.durationSeconds !== null && reference.durationSeconds !== undefined
      && Number.isFinite(duration) && duration >= 0) item.durationSeconds = duration;
    const size = Number(reference.sizeBytes);
    if (reference.sizeBytes !== null && reference.sizeBytes !== undefined
      && Number.isSafeInteger(size) && size >= 0) item.sizeBytes = size;
    const width = Number(reference.width);
    if (reference.width !== null && reference.width !== undefined
      && Number.isSafeInteger(width) && width > 0) item.width = width;
    const height = Number(reference.height);
    if (reference.height !== null && reference.height !== undefined
      && Number.isSafeInteger(height) && height > 0) item.height = height;
    return [item];
  });
}

function safeUuid(value: unknown) {
  const text = safeText(value);
  return text && uuidPattern.test(text) ? text : null;
}

function safeText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeAssetType(value: unknown) {
  return typeof value === 'string' && assetTypes.has(value) ? value : null;
}

function safeReferenceRole(value: unknown) {
  return typeof value === 'string' && referenceRoles.has(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
