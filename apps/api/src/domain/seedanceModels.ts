import type { DbClient } from '../db/pool.js';
import type { RealPortraitGenerationReference } from './realPortraitTypes.js';
import {
  assetReferenceOwnershipKey,
  buildCanonicalAssetReference,
  readOwnedAssetReferences,
  readOwnedAssetReferencesByIds,
  type OwnedAssetReferenceRow,
} from './assetReferences.js';

export const SEEDANCE_MODEL_LABELS = [
  'Seedance 2.0',
  'Seedance 2.0 Fast',
  'Seedance 2.0 Mini',
  'Seedance 2.5',
] as const;

export type SeedanceModelLabel = typeof SEEDANCE_MODEL_LABELS[number];

// 成本看盘固定把当前主推模型放在首位；开放能力表仍保留原有产品顺序。
export const SEEDANCE_COST_MODEL_LABELS = [
  'Seedance 2.5',
  'Seedance 2.0',
  'Seedance 2.0 Fast',
  'Seedance 2.0 Mini',
] as const;

export type SeedanceCostModelLabel = typeof SEEDANCE_COST_MODEL_LABELS[number];
export type SeedanceReferenceType = 'image' | 'video' | 'audio';
export type SeedanceReferenceRole = 'reference_image' | 'reference_video' | 'reference_audio' | 'first_frame' | 'last_frame';
export type SeedanceMode = 'general' | 'first-last';

export type SeedanceAspectRatio = '9:16' | '16:9' | 'adaptive';
type SeedanceResolution = '480p' | '720p' | '1080p';
type SeedanceDuration = 5 | 10 | 15 | 20 | 25 | 30;

export interface SeedanceModelCapability {
  label: SeedanceModelLabel;
  id: 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-2.0-mini' | 'seedance-2.5';
  recommended: boolean;
  resolutions: readonly SeedanceResolution[];
  durationSeconds: readonly SeedanceDuration[];
  modes: readonly SeedanceMode[];
  aspectRatios: {
    general: readonly SeedanceAspectRatio[];
    firstLast: readonly SeedanceAspectRatio[];
  };
  references: {
    maxTotal: number;
    maxImages: number;
    maxVideos: number;
    maxAudios: number;
    maxVideoDurationSeconds: number;
    maxAudioDurationSeconds: number;
    allowAudioOnly: boolean;
  };
  supportsPromptWizard: boolean;
  supportsRealPortrait: boolean;
  outputFormat: 'mp4';
  generateAudio: true;
}

const seedance20References = {
  maxTotal: 15,
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
  maxVideoDurationSeconds: 15,
  maxAudioDurationSeconds: 15,
  allowAudioOnly: false,
} as const;

/** API、路由与领域校验共用的唯一 Seedance 产品能力来源。 */
export const SEEDANCE_MODEL_CAPABILITIES = [
  {
    label: 'Seedance 2.0',
    id: 'seedance-2.0',
    recommended: false,
    resolutions: ['480p', '720p', '1080p'],
    durationSeconds: [5, 10, 15],
    modes: ['general', 'first-last'],
    aspectRatios: { general: ['9:16', '16:9'], firstLast: ['9:16', '16:9'] },
    references: seedance20References,
    supportsPromptWizard: true,
    supportsRealPortrait: true,
    outputFormat: 'mp4',
    generateAudio: true,
  },
  {
    label: 'Seedance 2.0 Fast',
    id: 'seedance-2.0-fast',
    recommended: false,
    resolutions: ['480p', '720p'],
    durationSeconds: [5, 10, 15],
    modes: ['general', 'first-last'],
    aspectRatios: { general: ['9:16', '16:9'], firstLast: ['9:16', '16:9'] },
    references: seedance20References,
    supportsPromptWizard: true,
    supportsRealPortrait: true,
    outputFormat: 'mp4',
    generateAudio: true,
  },
  {
    label: 'Seedance 2.0 Mini',
    id: 'seedance-2.0-mini',
    recommended: false,
    resolutions: ['480p', '720p'],
    durationSeconds: [5, 10, 15],
    modes: ['general', 'first-last'],
    aspectRatios: { general: ['9:16', '16:9'], firstLast: ['9:16', '16:9'] },
    references: seedance20References,
    supportsPromptWizard: true,
    supportsRealPortrait: true,
    outputFormat: 'mp4',
    generateAudio: true,
  },
  {
    label: 'Seedance 2.5',
    id: 'seedance-2.5',
    recommended: true,
    resolutions: ['480p', '720p'],
    durationSeconds: [5, 10, 15, 20, 25, 30],
    modes: ['general', 'first-last'],
    aspectRatios: { general: ['9:16', '16:9'], firstLast: ['adaptive'] },
    references: {
      maxTotal: 50,
      maxImages: 30,
      maxVideos: 10,
      maxAudios: 10,
      maxVideoDurationSeconds: 30,
      maxAudioDurationSeconds: 30,
      allowAudioOnly: true,
    },
    supportsPromptWizard: false,
    supportsRealPortrait: false,
    outputFormat: 'mp4',
    generateAudio: true,
  },
] as const satisfies readonly SeedanceModelCapability[];

interface ReferenceRecord {
  assetId: string;
  requestedRole: SeedanceReferenceRole;
  type: SeedanceReferenceType;
  objectKey: string;
  asset: OwnedAssetReferenceRow;
  durationSeconds?: number | null;
  sizeBytes?: number | null;
}

export interface SeedanceReferenceInput {
  assetId: string;
  role: SeedanceReferenceRole;
}

const seedanceModelLabelSet = new Set<string>(SEEDANCE_MODEL_LABELS);
const seedanceCostModelLabelSet = new Set<string>(SEEDANCE_COST_MODEL_LABELS);
const capabilityByLabel = new Map<SeedanceModelLabel, SeedanceModelCapability>(
  SEEDANCE_MODEL_CAPABILITIES.map(capability => [capability.label, capability]),
);
const referenceMediaDurationToleranceSeconds = 0.1;
const referenceMediaMinDurationSeconds = 2;

export function isSeedanceModelLabel(model: string): model is SeedanceModelLabel {
  return seedanceModelLabelSet.has(model);
}

export function isSeedanceCostModelLabel(model: string): model is SeedanceCostModelLabel {
  return seedanceCostModelLabelSet.has(model);
}

export function getSeedanceModelCapability(model: string): SeedanceModelCapability | null {
  return isSeedanceModelLabel(model) ? capabilityByLabel.get(model) ?? null : null;
}

export interface SeedanceConsumptionCombination {
  durationSeconds: number;
  resolution: string;
}

/**
 * 固定积分档必须直接由模型能力笛卡尔积派生，避免路由、计费与后台各自维护一份组合表。
 */
export function listSeedanceConsumptionCombinations(
  capability: SeedanceModelCapability,
): SeedanceConsumptionCombination[] {
  return capability.resolutions.flatMap(resolution => (
    capability.durationSeconds.map(durationSeconds => ({ durationSeconds, resolution }))
  ));
}

/** 缺失、重复或出现能力表之外的额外档位都不属于完整固定档。 */
export function hasExactSeedanceConsumptionCombinations(
  capability: SeedanceModelCapability,
  rows: readonly SeedanceConsumptionCombination[],
) {
  const expected = listSeedanceConsumptionCombinations(capability);
  if (rows.length !== expected.length) return false;
  const expectedKeys = new Set(expected.map(consumptionCombinationKey));
  const actualKeys = new Set(rows.map(consumptionCombinationKey));
  return actualKeys.size === expectedKeys.size
    && [...expectedKeys].every(key => actualKeys.has(key));
}

function consumptionCombinationKey(item: SeedanceConsumptionCombination) {
  return `${item.durationSeconds}:${item.resolution}`;
}

export function seedanceModelOrder(model: string) {
  const index = SEEDANCE_MODEL_LABELS.indexOf(model as SeedanceModelLabel);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function seedanceCostModelOrder(model: string) {
  const index = SEEDANCE_COST_MODEL_LABELS.indexOf(model as SeedanceCostModelLabel);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export async function sanitizeSeedanceVideoConfig(input: {
  client: DbClient;
  userId: string;
  model: string;
  config: Record<string, unknown>;
  references?: SeedanceReferenceInput[];
  realPortraitReference?: RealPortraitGenerationReference | null;
}) {
  if (!isSeedanceModelLabel(input.model)) throw badRequest('当前视频模型暂不开放');
  const capability = getSeedanceModelCapability(input.model);
  if (!capability) throw badRequest('当前视频模型暂不开放');

  const source = isRecord(input.config) ? input.config : {};
  const mode = source.mode === 'first-last' ? 'first-last' : 'general';
  const aspectRatio = normalizeAspectRatio(source.aspectRatio, capability, mode);
  const resolution = normalizeResolution(source.resolution);
  const durationSeconds = normalizeDuration(source.durationSeconds ?? source.duration, capability);

  if (!capability.resolutions.includes(resolution)) {
    throw badRequest(`${input.model} 当前不支持 ${resolution} 分辨率`);
  }

  if (input.realPortraitReference && !capability.supportsRealPortrait) {
    throw badRequest(`${input.model} 暂不支持真人演员`, 'REAL_PORTRAIT_MODEL_UNSUPPORTED');
  }
  if (input.realPortraitReference && mode !== 'general') {
    throw badRequest('真人演员只能在全能参考模式中使用', 'REAL_PORTRAIT_GENERAL_MODE_REQUIRED');
  }

  const references = await normalizeReferenceRecords({
    client: input.client,
    userId: input.userId,
    references: input.references ?? [],
    mode,
    capability,
  });

  if (input.realPortraitReference
    && references.filter(reference => reference.type === 'image').length >= capability.references.maxImages) {
    throw badRequest(
      `真人演员会占用 1 个图片参考位，请将普通参考图片减少到 ${Math.max(0, capability.references.maxImages - 1)} 张`,
    );
  }

  const referenceAssets = references.map((reference, index) => buildCanonicalAssetReference(
    reference.asset!,
    { role: referenceRole(mode, reference.type, index) },
  ));
  return {
    mode,
    aspectRatio,
    resolution,
    durationSeconds,
    generateAudio: true,
    referenceAssets,
    ...(input.realPortraitReference ? {
      realPortraitReference: {
        actorId: input.realPortraitReference.actorId,
        portraitAssetId: input.realPortraitReference.portraitAssetId,
        authorizationId: input.realPortraitReference.authorizationId,
        materializationId: input.realPortraitReference.materializationId,
        authorizationVersion: input.realPortraitReference.authorizationVersion,
        projectName: input.realPortraitReference.projectName,
        providerAssetUri: input.realPortraitReference.providerUrl,
      },
    } : {}),
  };
}

/**
 * 仅供数据库中的历史任务重试使用。旧 JSON 的 objectKey 只能用于当前用户活动资产的
 * 服务端归属查询，随后立即转换为新 `{assetId, role}` 边界；任何 HTTP 写请求都不能走这里。
 */
export async function sanitizeHistoricalSeedanceVideoConfig(input: {
  client: DbClient;
  userId: string;
  model: string;
  config: Record<string, unknown>;
  realPortraitReference?: RealPortraitGenerationReference | null;
}) {
  const source = isRecord(input.config) ? input.config : {};
  const rawAssets = Array.isArray(source.referenceAssets) && source.referenceAssets.length > 0
    ? source.referenceAssets
    : Array.isArray(source.referenceImages) ? source.referenceImages : [];
  const legacyReferences = rawAssets.filter(isRecord);
  const ownerships = legacyReferences.flatMap(reference => {
    const objectKey = safeString(reference.objectKey);
    return objectKey ? [{ userId: input.userId, objectKey }] : [];
  });
  const owned = await readOwnedAssetReferences(input.client, ownerships);
  const mode = source.mode === 'first-last' ? 'first-last' : 'general';
  const references: SeedanceReferenceInput[] = legacyReferences.map((reference, index) => {
    const objectKey = safeString(reference.objectKey);
    const asset = objectKey
      ? owned.get(assetReferenceOwnershipKey(input.userId, objectKey))
      : undefined;
    if (!asset) throw badRequest('参考素材不存在或不属于当前用户');
    const type = normalizeStoredReferenceType(asset.type);
    return {
      assetId: asset.id,
      role: referenceRole(mode, type, index),
    };
  });
  return sanitizeSeedanceVideoConfig({
    client: input.client,
    userId: input.userId,
    model: input.model,
    config: input.config,
    references,
    realPortraitReference: input.realPortraitReference,
  });
}

export function isSeedanceTokenUsageUnit(value: unknown) {
  return value === 'tokens';
}

async function normalizeReferenceRecords(input: {
  client: DbClient;
  userId: string;
  references: SeedanceReferenceInput[];
  mode: SeedanceMode;
  capability: SeedanceModelCapability;
}): Promise<ReferenceRecord[]> {
  if (input.references.length > input.capability.references.maxTotal) {
    const productLabel = input.capability.label === 'Seedance 2.5'
      ? input.capability.label
      : 'Seedance 2.0';
    throw badRequest(`${productLabel} 最多支持 ${input.capability.references.maxTotal} 个参考素材`);
  }
  // 同一资产可在首尾帧模式承担不同 role；只按 pair 去重，角色规则仍在下方校验。
  const uniquePairs = new Set<string>();
  const references = input.references.filter(reference => {
    const key = `${reference.assetId}\u0000${reference.role}`;
    if (uniquePairs.has(key)) return false;
    uniquePairs.add(key);
    return true;
  });
  const assetIds = Array.from(new Set(references.map(reference => reference.assetId)));
  const assetMeta = await readOwnedAssetReferencesByIds(
    input.client,
    input.userId,
    assetIds,
  );

  const normalized = references.map(reference => {
    const meta = assetMeta.get(reference.assetId);
    if (!meta) throw badRequest('参考素材不存在或不属于当前用户');
    const type = normalizeStoredReferenceType(meta.type);
    return {
      assetId: meta.id,
      requestedRole: reference.role,
      objectKey: meta.object_key,
      asset: meta,
      type,
      durationSeconds: meta.duration_seconds === null ? null : Number(meta.duration_seconds),
      sizeBytes: meta.size_bytes === null ? null : Number(meta.size_bytes),
    };
  });

  if (input.mode === 'first-last') return validateFirstLastReferences(normalized, input.capability);
  return validateGeneralReferences(normalized, input.capability);
}

function validateGeneralReferences(records: ReferenceRecord[], capability: SeedanceModelCapability) {
  const imageCount = records.filter(record => record.type === 'image').length;
  const videoRecords = records.filter(record => record.type === 'video');
  const audioRecords = records.filter(record => record.type === 'audio');
  const productLabel = capability.label === 'Seedance 2.5' ? capability.label : 'Seedance 2.0';
  const limits = capability.references;
  if (imageCount > limits.maxImages) {
    throw badRequest(`${productLabel} 最多支持 ${limits.maxImages} 张参考图片`);
  }
  if (videoRecords.length > limits.maxVideos) {
    throw badRequest(`${productLabel} 最多支持 ${limits.maxVideos} 个参考视频`);
  }
  if (audioRecords.length > limits.maxAudios) {
    throw badRequest(`${productLabel} 最多支持 ${limits.maxAudios} 个参考音频`);
  }
  if (records.length > limits.maxTotal) {
    throw badRequest(`${productLabel} 最多支持 ${limits.maxTotal} 个参考素材`);
  }

  let totalVideoDuration = 0;
  const maxVideoDurationWithTolerance = limits.maxVideoDurationSeconds + referenceMediaDurationToleranceSeconds;
  for (const record of videoRecords) {
    const duration = record.durationSeconds;
    if (duration === null || duration === undefined || !Number.isFinite(duration)) {
      throw badRequest('参考视频缺少可校验的时长信息');
    }
    if (duration < referenceMediaMinDurationSeconds || duration > maxVideoDurationWithTolerance) {
      throw badRequest(`单个参考视频时长必须在 2s 到 ${limits.maxVideoDurationSeconds}s 之间`);
    }
    totalVideoDuration += duration;
  }
  if (totalVideoDuration > maxVideoDurationWithTolerance) {
    throw badRequest(`参考视频总时长不能超过 ${limits.maxVideoDurationSeconds}s`);
  }

  let totalAudioDuration = 0;
  const maxAudioDurationWithTolerance = limits.maxAudioDurationSeconds + referenceMediaDurationToleranceSeconds;
  for (const record of audioRecords) {
    const duration = record.durationSeconds;
    if (duration === null || duration === undefined || !Number.isFinite(duration)) {
      throw badRequest('参考音频缺少可校验的时长信息');
    }
    if (duration < referenceMediaMinDurationSeconds || duration > maxAudioDurationWithTolerance) {
      throw badRequest(`单个参考音频时长必须在 2s 到 ${limits.maxAudioDurationSeconds}s 之间`);
    }
    if (record.sizeBytes === null || record.sizeBytes === undefined || !Number.isFinite(record.sizeBytes)) {
      throw badRequest('参考音频缺少可校验的文件大小信息');
    }
    if (record.sizeBytes > 15 * 1024 * 1024) throw badRequest('单个参考音频不能超过 15 MB');
    if (!record.objectKey || !/\.(mp3|wav)$/i.test(record.objectKey)) throw badRequest('参考音频仅支持 MP3 或 WAV 格式');
    totalAudioDuration += duration;
  }
  if (totalAudioDuration > maxAudioDurationWithTolerance) {
    throw badRequest(`参考音频总时长不能超过 ${limits.maxAudioDurationSeconds}s`);
  }
  if (!limits.allowAudioOnly && audioRecords.length > 0 && imageCount === 0 && videoRecords.length === 0) {
    throw badRequest('参考音频不能单独使用，请至少选择一张图片或一个视频');
  }

  for (const record of records) {
    const expectedRole = referenceRole('general', record.type, 0);
    if (record.requestedRole !== expectedRole) {
      throw badRequest('参考素材 role 与真实媒体类型不一致', 'INVALID_REFERENCE_ROLE');
    }
  }

  return records;
}

function validateFirstLastReferences(records: ReferenceRecord[], capability: SeedanceModelCapability) {
  const nonImageCount = records.filter(record => record.type !== 'image').length;
  if (nonImageCount > 0) throw badRequest('首尾帧模式只支持图片素材');

  const imageRecords = records.filter(record => record.type === 'image');
  if (imageRecords.length < 1) throw badRequest('首尾帧模式至少需要首帧图片');
  if (imageRecords.length > 2) throw badRequest('首尾帧模式最多支持首帧和尾帧 2 张图片');
  for (let index = 0; index < imageRecords.length; index += 1) {
    if (imageRecords[index]!.requestedRole !== referenceRole('first-last', 'image', index)) {
      throw badRequest('首尾帧参考素材 role 或顺序无效', 'INVALID_REFERENCE_ROLE');
    }
  }
  if (capability.label === 'Seedance 2.5') {
    const firstFrame = imageRecords[0]!.asset;
    if (!isPositiveIntegerMetadata(firstFrame.width) || !isPositiveIntegerMetadata(firstFrame.height)) {
      throw badRequest('首帧尺寸信息不完整，请重新上传或等待处理');
    }
  }
  return imageRecords;
}

function referenceRole(mode: SeedanceMode, type: SeedanceReferenceType, index: number): SeedanceReferenceRole {
  if (mode === 'first-last') return index === 0 ? 'first_frame' : 'last_frame';
  if (type === 'video') return 'reference_video';
  if (type === 'audio') return 'reference_audio';
  return 'reference_image';
}

function normalizeStoredReferenceType(type: string): SeedanceReferenceType {
  if (type === 'image' || type === 'video' || type === 'audio') return type;
  throw badRequest('参考素材类型不受支持');
}

function normalizeAspectRatio(
  value: unknown,
  capability: SeedanceModelCapability,
  mode: SeedanceMode,
): SeedanceAspectRatio {
  const allowed = mode === 'first-last'
    ? capability.aspectRatios.firstLast
    : capability.aspectRatios.general;
  if (value === undefined || value === null || value === '') return allowed[0] ?? '9:16';
  if (allowed.includes(value as SeedanceAspectRatio)) return value as SeedanceAspectRatio;
  throw badRequest('当前视频比例暂不开放');
}

function normalizeResolution(value: unknown): SeedanceResolution {
  if (value === undefined || value === null || value === '') return '720p';
  if (value === '480p' || value === '720p' || value === '1080p') return value;
  throw badRequest('当前视频分辨率暂不开放');
}

function normalizeDuration(value: unknown, capability: SeedanceModelCapability): SeedanceDuration {
  if (value === undefined || value === null || value === '') return 5;
  const parsed = Number(value);
  if (capability.durationSeconds.includes(parsed as SeedanceDuration)) return parsed as SeedanceDuration;
  throw badRequest('当前视频时长暂不开放');
}

function badRequest(message: string, code?: string) {
  return Object.assign(new Error(message), { statusCode: 400, ...(code ? { code } : {}) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isPositiveIntegerMetadata(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}
