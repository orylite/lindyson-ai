export type ConsumptionVideoModel = 'seedance-2.5' | 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-2.0-mini';
export type ConsumptionVideoDurationSeconds = 5 | 10 | 15 | 20 | 25 | 30;
export type ConsumptionVideoDuration = `${ConsumptionVideoDurationSeconds}`;
export type ConsumptionVideoResolution = '480p' | '720p' | '1080p';
export type ConsumptionVideoMode = 'general' | 'first-last';
export type ConsumptionVideoAspectRatio = '9:16' | '16:9' | 'adaptive';
export type ConsumptionImageModel = 'seedream-5.0-pro';
export type ConsumptionImageResolution = '1K' | '2K';

export interface VideoModelCapabilityReferences {
  maxTotal: number;
  maxImages: number;
  maxVideos: number;
  maxAudios: number;
  maxVideoDurationSeconds: number;
  maxAudioDurationSeconds: number;
  allowAudioOnly: boolean;
}

/**
 * 用户端只消费展示与前置校验所需的能力元数据。滚动发布期间接口可以省略
 * videoModels，此时由 DEFAULT_VIDEO_MODEL_CAPABILITIES 提供保守兼容值。
 */
export interface VideoModelCapability {
  id: ConsumptionVideoModel;
  label: string;
  available: boolean;
  recommended: boolean;
  resolutions: ConsumptionVideoResolution[];
  durationSeconds: ConsumptionVideoDurationSeconds[];
  modes: ConsumptionVideoMode[];
  aspectRatios: {
    general: ConsumptionVideoAspectRatio[];
    firstLast: ConsumptionVideoAspectRatio[];
  };
  references: VideoModelCapabilityReferences;
  supportsPromptWizard: boolean;
  supportsRealPortrait: boolean;
  outputFormat: 'mp4';
  generateAudio: true;
}

export interface VideoConsumptionSetting {
  id: string;
  model: ConsumptionVideoModel;
  modelLabel: string;
  duration: ConsumptionVideoDuration;
  resolution: ConsumptionVideoResolution;
  credits: number;
  referenceVideoCredits: number;
  available: boolean;
}

export interface ImageConsumptionSetting {
  id: string;
  model: ConsumptionImageModel;
  modelLabel: 'Seedream 5.0 Pro';
  resolution: ConsumptionImageResolution;
  credits: number;
  available: boolean;
}

export interface ConsumptionSettings {
  video: VideoConsumptionSetting[];
  videoModels?: VideoModelCapability[];
  image: ImageConsumptionSetting[];
  promptWizard: {
    generationCredits: number;
    available: boolean;
    engineVersion: 3 | 4;
    updatedAt: string;
  };
  /** TK Prompt Engine 1.0 使用独立开关；缺省必须视为关闭，不能回退到 V6。 */
  tkPromptEngine?: {
    schemaVersion: 1;
    generationCredits: number;
    available: boolean;
    updatedAt: string;
  };
}

/** 只有已开放且已切到 engine 4 的设置才能进入 V6 向导。 */
export function isPromptWizardV6Available(
  settings: ConsumptionSettings['promptWizard'],
) {
  return settings.available && settings.engineVersion === 4;
}

export function isTkPromptEngineAvailable(
  settings: ConsumptionSettings['tkPromptEngine'],
) {
  return settings?.available === true && settings.schemaVersion === 1;
}

export const VIDEO_CONSUMPTION_MODELS: Array<{ id: ConsumptionVideoModel; label: string }> = [
  { id: 'seedance-2.5', label: 'Seedance 2.5' },
  { id: 'seedance-2.0', label: 'Seedance 2.0' },
  { id: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast' },
  { id: 'seedance-2.0-mini', label: 'Seedance 2.0 Mini' },
];

const SEEDANCE_20_REFERENCES: VideoModelCapabilityReferences = {
  maxTotal: 15,
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
  maxVideoDurationSeconds: 15,
  maxAudioDurationSeconds: 15,
  allowAudioOnly: false,
};

export const DEFAULT_VIDEO_MODEL_CAPABILITIES: Record<ConsumptionVideoModel, VideoModelCapability> = {
  'seedance-2.5': {
    id: 'seedance-2.5',
    label: 'Seedance 2.5',
    available: false,
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
  'seedance-2.0': {
    id: 'seedance-2.0',
    label: 'Seedance 2.0',
    available: false,
    recommended: false,
    resolutions: ['480p', '720p', '1080p'],
    durationSeconds: [5, 10, 15],
    modes: ['general', 'first-last'],
    aspectRatios: { general: ['9:16', '16:9'], firstLast: ['9:16', '16:9'] },
    references: { ...SEEDANCE_20_REFERENCES },
    supportsPromptWizard: true,
    supportsRealPortrait: true,
    outputFormat: 'mp4',
    generateAudio: true,
  },
  'seedance-2.0-fast': {
    id: 'seedance-2.0-fast',
    label: 'Seedance 2.0 Fast',
    available: false,
    recommended: false,
    resolutions: ['480p', '720p'],
    durationSeconds: [5, 10, 15],
    modes: ['general', 'first-last'],
    aspectRatios: { general: ['9:16', '16:9'], firstLast: ['9:16', '16:9'] },
    references: { ...SEEDANCE_20_REFERENCES },
    supportsPromptWizard: true,
    supportsRealPortrait: true,
    outputFormat: 'mp4',
    generateAudio: true,
  },
  'seedance-2.0-mini': {
    id: 'seedance-2.0-mini',
    label: 'Seedance 2.0 Mini',
    available: false,
    recommended: false,
    resolutions: ['480p', '720p'],
    durationSeconds: [5, 10, 15],
    modes: ['general', 'first-last'],
    aspectRatios: { general: ['9:16', '16:9'], firstLast: ['9:16', '16:9'] },
    references: { ...SEEDANCE_20_REFERENCES },
    supportsPromptWizard: true,
    supportsRealPortrait: true,
    outputFormat: 'mp4',
    generateAudio: true,
  },
};

export function getVideoModelCapability(
  settings: ConsumptionSettings,
  model: ConsumptionVideoModel,
): VideoModelCapability {
  const fallback = DEFAULT_VIDEO_MODEL_CAPABILITIES[model];
  const remote = settings.videoModels?.find(item => item.id === model);
  const modelRows = settings.video.filter(item => item.model === model);
  // 兼容静态必须先于 API 发布。旧 API 完全没有 videoModels 字段，且只返回
  // 2.5 的旧 10 档；此时用不含 25 秒的精确能力定义校验，避免把已开放的
  // 2.5 整体误判为不可用。若行中已经出现 25 秒，则按新 12 档定义校验。
  const legacySeedance25Definition = model === 'seedance-2.5'
    && !remote
    && !modelRows.some(item => item.duration === '25')
    ? { ...fallback, durationSeconds: [5, 10, 15, 20, 30] as ConsumptionVideoDurationSeconds[] }
    : fallback;
  const definition = remote ?? legacySeedance25Definition;
  const positiveRows = modelRows.filter(item => (
    isPositiveAvailableVideoSetting(item)
    && isVideoConsumptionSettingWithinCapability(item, definition)
  ));
  const hasAvailableConsumption = model === 'seedance-2.5'
    ? hasExactVideoConsumptionCombinations(definition, modelRows)
      && modelRows.every(isPositiveAvailableVideoSetting)
    : positiveRows.length > 0;
  if (!remote) return { ...definition, available: hasAvailableConsumption };
  return {
    ...fallback,
    ...remote,
    available: remote.available && hasAvailableConsumption,
    aspectRatios: {
      general: remote.aspectRatios.general.length > 0
        ? remote.aspectRatios.general
        : fallback.aspectRatios.general,
      firstLast: remote.aspectRatios.firstLast.length > 0
        ? remote.aspectRatios.firstLast
        : fallback.aspectRatios.firstLast,
    },
    references: { ...fallback.references, ...remote.references },
  };
}

function isPositiveAvailableVideoSetting(setting: VideoConsumptionSetting) {
  return setting.available
    && Number.isSafeInteger(setting.credits)
    && setting.credits > 0
    && Number.isSafeInteger(setting.referenceVideoCredits)
    && setting.referenceVideoCredits > 0;
}

function isVideoConsumptionSettingWithinCapability(
  setting: VideoConsumptionSetting,
  capability: VideoModelCapability,
) {
  return capability.resolutions.includes(setting.resolution)
    && capability.durationSeconds.includes(Number(setting.duration) as ConsumptionVideoDurationSeconds);
}

function hasExactVideoConsumptionCombinations(
  capability: VideoModelCapability,
  rows: VideoConsumptionSetting[],
) {
  const expected = capability.resolutions.flatMap(resolution => (
    capability.durationSeconds.map(duration => `${duration}:${resolution}`)
  ));
  if (rows.length !== expected.length) return false;
  const expectedKeys = new Set(expected);
  const actualKeys = new Set(rows.map(row => `${row.duration}:${row.resolution}`));
  return actualKeys.size === expectedKeys.size
    && [...expectedKeys].every(key => actualKeys.has(key));
}

/** 参数菜单只能消费能力表与开放正价档的交集。 */
export function getAvailableVideoConsumptionCombinations(
  settings: ConsumptionSettings,
  model: ConsumptionVideoModel,
  capability = getVideoModelCapability(settings, model),
) {
  if (!capability.available) return [];
  return settings.video.filter(setting => (
    setting.model === model
    && isPositiveAvailableVideoSetting(setting)
    && isVideoConsumptionSettingWithinCapability(setting, capability)
  ));
}

export function getVideoConsumptionParameterOptions(
  capability: VideoModelCapability,
  combinations: VideoConsumptionSetting[],
  resolution: ConsumptionVideoResolution,
) {
  return {
    resolutions: capability.resolutions.filter(value => (
      combinations.some(combination => combination.resolution === value)
    )),
    durationSeconds: capability.durationSeconds.filter(value => (
      combinations.some(combination => (
        combination.resolution === resolution && combination.duration === String(value)
      ))
    )),
  };
}

export function findVideoConsumptionSetting(
  settings: ConsumptionSettings,
  model: ConsumptionVideoModel,
  duration: ConsumptionVideoDuration,
  resolution: ConsumptionVideoResolution,
) {
  return settings.video.find(item => (
    item.model === model
    && item.duration === duration
    && item.resolution === resolution
  ));
}

export const IMAGE_CONSUMPTION_RESOLUTIONS: readonly ConsumptionImageResolution[] = ['1K', '2K'];

export function getVideoConsumptionCredits(
  settings: ConsumptionSettings,
  model: ConsumptionVideoModel,
  duration: ConsumptionVideoDuration,
  resolution: ConsumptionVideoResolution,
  hasReferenceVideo = false,
) {
  const setting = findVideoConsumptionSetting(settings, model, duration, resolution);
  if (!setting?.available) return 0;
  return Math.max(0, hasReferenceVideo ? setting.referenceVideoCredits : setting.credits);
}

export function getImageConsumptionCredits(
  settings: ConsumptionSettings,
  resolution: ConsumptionImageResolution,
) {
  const setting = settings.image.find(item => item.resolution === resolution);
  if (!setting?.available) return 0;
  return Math.max(0, setting.credits);
}
