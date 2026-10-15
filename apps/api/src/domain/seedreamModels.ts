import type { SeedreamAnnotation } from '@lindyson/api-contracts';
import type { DbClient } from '../db/pool.js';
import {
  buildCanonicalAssetReference,
  readOwnedAssetReferencesByIds,
} from './assetReferences.js';
import { SEEDREAM_5_PRO_MODEL_LABEL } from './seedreamListPrice.js';

export const SEEDREAM_IMAGE_RESOLUTIONS = ['1K', '2K'] as const;
export const SEEDREAM_IMAGE_ASPECT_RATIOS = [
  '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9',
] as const;
export const SEEDREAM_OPTIMIZE_PROMPT_MODES = ['standard', 'fast'] as const;

export type SeedreamImageResolution = typeof SEEDREAM_IMAGE_RESOLUTIONS[number];
export type SeedreamImageAspectRatio = typeof SEEDREAM_IMAGE_ASPECT_RATIOS[number];
export type SeedreamOptimizePromptMode = typeof SEEDREAM_OPTIMIZE_PROMPT_MODES[number];

export interface SeedreamImageReferenceInput {
  assetId: string;
  role: 'reference_image';
}

export interface SeedreamImageRequestInput {
  client: DbClient;
  userId: string;
  model: string;
  prompt: string;
  config: Record<string, unknown>;
  references?: SeedreamImageReferenceInput[];
  annotations?: SeedreamAnnotation[];
}

const rawCoordinateTagPattern = /<\s*\/?\s*(?:point|bbox)\b/i;
const annotationTokenPattern = /@标记(?:[1-9]\d{0,2})(?!\d)/g;
const anyAnnotationTokenPattern = /@标记\d+/g;
const imageReferenceStartPattern = /@图片/g;
const imageReferenceTokenPattern = /@图片([1-9]\d*)(?!\d|[A-Za-z_]|[._+\-/][A-Za-z0-9_])/g;
const imageMaxBytes = 30 * 1024 * 1024;
const imageMaxPixels = 36_000_000;
const supportedReferenceExtensions = new Set([
  'jpeg', 'jpg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'heic', 'heif',
]);

const outputSizeByResolution: Record<SeedreamImageResolution, Record<SeedreamImageAspectRatio, string>> = {
  '1K': {
    '1:1': '1024x1024',
    '4:3': '1152x864',
    '3:4': '864x1152',
    '16:9': '1424x800',
    '9:16': '800x1424',
    '3:2': '1248x832',
    '2:3': '832x1248',
    '21:9': '1568x672',
  },
  '2K': {
    '1:1': '2048x2048',
    '4:3': '2368x1776',
    '3:4': '1776x2368',
    '16:9': '2816x1584',
    '9:16': '1584x2816',
    '3:2': '2496x1664',
    '2:3': '1664x2496',
    '21:9': '3136x1344',
  },
};

export function isSeedreamModelLabel(model: string): model is typeof SEEDREAM_5_PRO_MODEL_LABEL {
  return model === SEEDREAM_5_PRO_MODEL_LABEL;
}

export function getSeedreamOutputSize(
  resolution: SeedreamImageResolution,
  aspectRatio: SeedreamImageAspectRatio,
) {
  return outputSizeByResolution[resolution][aspectRatio];
}

export async function sanitizeSeedreamImageConfig(input: SeedreamImageRequestInput) {
  if (!isSeedreamModelLabel(input.model)) throw badRequest('当前图片模型暂不开放');
  rejectRawCoordinateTags(input.prompt);

  const source = isRecord(input.config) ? input.config : {};
  const resolution = normalizeResolution(source.resolution);
  const aspectRatio = normalizeAspectRatio(source.aspectRatio);
  const optimizePromptMode = normalizeOptimizePromptMode(source.optimizePromptMode);
  const references = input.references ?? [];
  if (references.length > 10) throw badRequest('Seedream 5.0 Pro 最多支持 10 张参考图片');
  validateImageReferenceTokens(input.prompt, references.length);

  const uniqueAssetIds = new Set<string>();
  for (const reference of references) {
    if (reference.role !== 'reference_image') {
      throw badRequest('Seedream 参考素材 role 必须为 reference_image', 'INVALID_REFERENCE_ROLE');
    }
    if (uniqueAssetIds.has(reference.assetId)) throw badRequest('同一参考图片不能重复提交');
    uniqueAssetIds.add(reference.assetId);
  }

  const ownedAssets = await readOwnedAssetReferencesByIds(
    input.client,
    input.userId,
    references.map(reference => reference.assetId),
  );
  const referenceAssets = references.map(reference => {
    const asset = ownedAssets.get(reference.assetId);
    if (!asset) throw badRequest('参考图片不存在或不属于当前用户');
    validateReferenceImage(asset);
    return buildCanonicalAssetReference(asset, { role: 'reference_image' });
  });

  const annotations = validateAnnotations({
    prompt: input.prompt,
    annotations: input.annotations ?? [],
    referenceAssetIds: references.map(reference => reference.assetId),
  });

  return {
    resolution,
    aspectRatio,
    optimizePromptMode,
    outputSize: getSeedreamOutputSize(resolution, aspectRatio),
    referenceAssets,
    annotations,
  };
}

/** 仅供数据库中已持久化的 Seedream 图片任务失败重试。 */
export async function sanitizeHistoricalSeedreamImageConfig(input: {
  client: DbClient;
  userId: string;
  model: string;
  prompt: string;
  config: Record<string, unknown>;
}) {
  const source = isRecord(input.config) ? input.config : {};
  const rawReferences = Array.isArray(source.referenceAssets)
    ? source.referenceAssets.filter(isRecord)
    : [];
  const references: SeedreamImageReferenceInput[] = rawReferences.map(reference => {
    const assetId = safeString(reference.id);
    if (!assetId) throw badRequest('历史参考图片缺少资产 ID，无法安全重试');
    return { assetId, role: 'reference_image' };
  });
  const annotations = Array.isArray(source.annotations)
    ? source.annotations as SeedreamAnnotation[]
    : [];
  return sanitizeSeedreamImageConfig({
    ...input,
    references,
    annotations,
  });
}

/**
 * 数据库存储用户可读的 @图片N / @标记N，只有在供应商请求边界才编译为
 * 方舟图片序号与坐标 XML。
 * referenceAssets 的数组顺序就是“图 1、图 2……”的唯一来源。
 */
export function compileSeedreamPrompt(prompt: string, config: Record<string, unknown>) {
  rejectRawCoordinateTags(prompt);
  const referenceAssets = Array.isArray(config.referenceAssets)
    ? config.referenceAssets.filter(isRecord)
    : [];
  const annotations = Array.isArray(config.annotations)
    ? config.annotations.filter(isRecord)
    : [];
  validateImageReferenceTokens(prompt, referenceAssets.length);
  const assetIndexes = new Map<string, number>();
  referenceAssets.forEach((reference, index) => {
    const assetId = safeString(reference.id);
    if (assetId && !assetIndexes.has(assetId)) assetIndexes.set(assetId, index + 1);
  });
  const annotationByToken = new Map<string, Record<string, unknown>>();
  for (const annotation of annotations) {
    const token = safeString(annotation.token);
    if (token) annotationByToken.set(token, annotation);
  }

  const invalidToken = (prompt.match(anyAnnotationTokenPattern) ?? [])
    .find(token => !/^@标记(?:[1-9]\d{0,2})$/.test(token));
  if (invalidToken) throw badRequest(`提示词中的标注 token 无效：${invalidToken}`);
  return prompt
    .replace(imageReferenceTokenPattern, (_token, rawIndex: string) => `图 ${Number(rawIndex)}`)
    .replace(annotationTokenPattern, token => {
      const annotation = annotationByToken.get(token);
      if (!annotation) throw badRequest(`提示词中的 ${token} 没有对应标注`);
      const assetId = safeString(annotation.assetId);
      const imageIndex = assetId ? assetIndexes.get(assetId) : undefined;
      if (!imageIndex) throw badRequest(`${token} 对应的参考图片不可用`);
      if (annotation.type === 'point') {
        return `图 ${imageIndex} <point>${annotation.x} ${annotation.y}</point>`;
      }
      if (annotation.type === 'bbox') {
        return `图 ${imageIndex} <bbox>${annotation.x1} ${annotation.y1} ${annotation.x2} ${annotation.y2}</bbox>`;
      }
      throw badRequest(`${token} 的标注类型无效`);
    });
}

function validateImageReferenceTokens(prompt: string, referenceCount: number) {
  const referenceStarts = prompt.match(imageReferenceStartPattern)?.length ?? 0;
  const references = Array.from(prompt.matchAll(imageReferenceTokenPattern));
  if (referenceStarts !== references.length) {
    throw badRequest('提示词中的图片引用格式无效，请使用 @图片1 这类格式');
  }
  for (const reference of references) {
    const imageIndex = Number(reference[1]);
    if (!Number.isSafeInteger(imageIndex) || imageIndex > referenceCount) {
      throw badRequest(`提示词中的 @图片${reference[1]} 没有对应参考图片`);
    }
  }
}

function validateAnnotations(input: {
  prompt: string;
  annotations: SeedreamAnnotation[];
  referenceAssetIds: string[];
}) {
  if (input.annotations.length > 50) throw badRequest('单个图片任务最多支持 50 个交互标注');
  const availableAssets = new Set(input.referenceAssetIds);
  const tokenCounts = new Map<string, number>();
  for (const token of input.prompt.match(anyAnnotationTokenPattern) ?? []) {
    if (!/^@标记(?:[1-9]\d{0,2})$/.test(token)) throw badRequest(`提示词中的标注 token 无效：${token}`);
    tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  }
  const seenTokens = new Set<string>();
  for (const annotation of input.annotations) {
    if (!/^@标记(?:[1-9]\d{0,2})$/.test(annotation.token)) throw badRequest('标注 token 格式无效');
    if (seenTokens.has(annotation.token)) throw badRequest(`标注 token 重复：${annotation.token}`);
    seenTokens.add(annotation.token);
    if (!availableAssets.has(annotation.assetId)) {
      throw badRequest(`${annotation.token} 对应的 assetId 不在参考图片中`);
    }
    if (tokenCounts.get(annotation.token) !== 1) {
      throw badRequest(`${annotation.token} 必须在提示词中恰好出现一次`);
    }
    validateAnnotationCoordinates(annotation);
  }
  for (const token of tokenCounts.keys()) {
    if (!seenTokens.has(token)) throw badRequest(`提示词中的 ${token} 没有声明结构化标注`);
  }
  return input.annotations;
}

function validateAnnotationCoordinates(annotation: SeedreamAnnotation) {
  const coordinates = annotation.type === 'point'
    ? [annotation.x, annotation.y]
    : [annotation.x1, annotation.y1, annotation.x2, annotation.y2];
  if (coordinates.some(value => !Number.isInteger(value) || value < 0 || value > 999)) {
    throw badRequest('交互标注坐标必须是 0 到 999 的整数');
  }
  if (annotation.type === 'bbox' && (annotation.x1 >= annotation.x2 || annotation.y1 >= annotation.y2)) {
    throw badRequest('框选坐标必须满足 x1 < x2 且 y1 < y2');
  }
}

function validateReferenceImage(asset: {
  type: string;
  name: string;
  object_key: string;
  size_bytes: number | string | null;
  width: number | string | null;
  height: number | string | null;
}) {
  if (asset.type !== 'image') throw badRequest('Seedream 参考素材只支持图片');
  const extension = fileExtension(asset.object_key) ?? fileExtension(asset.name);
  if (!extension || !supportedReferenceExtensions.has(extension)) {
    throw badRequest('参考图片格式只支持 JPEG、PNG、WebP、BMP、TIFF、GIF、HEIC 或 HEIF');
  }
  const sizeBytes = Number(asset.size_bytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw badRequest(
      '参考图片缺少可校验的文件大小',
      'REFERENCE_IMAGE_METADATA_INCOMPLETE',
    );
  }
  if (sizeBytes > imageMaxBytes) throw badRequest('单张参考图片不能超过 30 MB');
  const width = Number(asset.width);
  const height = Number(asset.height);
  if (
    asset.width === null
    || asset.height === null
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) {
    throw badRequest(
      '参考图片缺少完整且有效的宽高元数据',
      'REFERENCE_IMAGE_METADATA_INCOMPLETE',
    );
  }
  if (width <= 14 || height <= 14) {
    throw badRequest('参考图片宽度和高度必须均大于 14 像素');
  }
  if (width * height > imageMaxPixels) throw badRequest('单张参考图片总像素不能超过 3600 万');
  const ratio = width / height;
  if (ratio < 1 / 16 || ratio > 16) throw badRequest('参考图片宽高比必须在 1:16 到 16:1 之间');
}

function fileExtension(value: string) {
  const withoutQuery = value.split(/[?#]/)[0] ?? '';
  const basename = withoutQuery.split('/').at(-1) ?? '';
  const match = basename.match(/\.([A-Za-z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? null;
}

function normalizeResolution(value: unknown): SeedreamImageResolution {
  if (value === '1K' || value === '2K') return value;
  throw badRequest('Seedream 图片分辨率只支持 1K 或 2K');
}

function normalizeAspectRatio(value: unknown): SeedreamImageAspectRatio {
  if (SEEDREAM_IMAGE_ASPECT_RATIOS.includes(value as SeedreamImageAspectRatio)) {
    return value as SeedreamImageAspectRatio;
  }
  throw badRequest('Seedream 图片比例暂不开放');
}

function normalizeOptimizePromptMode(value: unknown): SeedreamOptimizePromptMode {
  if (value === 'standard' || value === 'fast') return value;
  throw badRequest('Seedream 提示词优化模式只支持 standard 或 fast');
}

function rejectRawCoordinateTags(prompt: string) {
  if (rawCoordinateTagPattern.test(prompt)) {
    throw badRequest('提示词不能直接包含 point 或 bbox XML，请使用结构化 annotations');
  }
}

function badRequest(message: string, code = 'INVALID_SEEDREAM_REQUEST') {
  return Object.assign(new Error(message), { statusCode: 400, code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
