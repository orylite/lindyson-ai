import { Image as ImageIcon,Music2,Plus,Sparkles,Upload,Video,Wand2,X,Zap } from 'lucide-react';
import { AnimatePresence,motion } from 'motion/react';
import { useCallback,useEffect,useMemo,useRef,useState,type ChangeEvent,type KeyboardEvent,type MouseEvent } from 'react';
import { toast } from 'sonner';
import type { TkPromptSource,TkPromptVideoConfig } from '@lindyson/api-contracts';
import type { UploadProgressEvent } from '../api/assetUpload';
import type { ExactCursorPagination as CursorPaginationState,PagePosition } from '../api/cursor';
import type { AdminGenerationJob,GenerationReserveRequest,GenerationReserveResult } from '../data/admin';
import type { Asset,AssetFolder,AssetGenerationMeta,AssetReferenceAsset,AssetReferenceImage,AssetSource,AssetSummary } from '../data/assets';
import {
  getAvailableVideoConsumptionCombinations,
  getVideoModelCapability,
  getVideoConsumptionCredits,
  isTkPromptEngineAvailable,
  type ConsumptionSettings,
  type ConsumptionVideoDurationSeconds,
  type VideoModelCapability,
} from '../data/consumption';
import { canUsePortraitActor,type RealPortraitActor } from '../data/realPortraits';
import { buildAIStudioQueueItems,type AIStudioQueueItem } from '../state/aiStudioQueue';
import { AssetThumbnail,Card } from '../ui';
import type { BrowserDownloadResult,DownloadableAsset } from '../utils/assetDownload';
import { AssetPickerModal } from './AssetPickerModal';
import { AssetPreviewModal } from './AssetPreviewModal';
import {
  AIStudioMentionMenu,
  getMentionMenuHorizontalBounds,
  measureTextareaCaret,
  type MentionMenuPosition,
} from './AIStudioMentionMenu';
import { useAIStudioGenerateFeedback } from './AIStudioGenerateFeedback';
import {
  AIStudioVideoControls,
  isLimitedResolutionModel,
  type AspectRatio,
  type Duration,
  type ReferenceMode,
  type Resolution,
  type VideoModel,
  type VideoModelOption,
} from './AIStudioVideoControls';
import { AIStudioResults } from './AIStudioResults';
import { getPromptEditBucket,PromptWizard,tkPromptVideoConfigEquals,type TkPromptApplyDraft } from './PromptWizard';

type AssetPickerTarget = 'general' | 'first-frame' | 'last-frame' | 'wizard-images';
type FrameAssetSlot = Exclude<AssetPickerTarget, 'general' | 'wizard-images'>;

const PROMPT_EDIT_BUCKET_RANK: Record<TkPromptSource['editBucket'], number> = {
  none: 0,
  minor: 1,
  material: 2,
};

export function mergePromptEditBuckets(
  current: TkPromptSource['editBucket'],
  next: TkPromptSource['editBucket'],
): TkPromptSource['editBucket'] {
  return PROMPT_EDIT_BUCKET_RANK[next] > PROMPT_EDIT_BUCKET_RANK[current] ? next : current;
}

export function tkPromptReferenceAssetsEqual(
  left: AssetReferenceAsset[],
  right: AssetReferenceAsset[],
) {
  return left.length === right.length && left.every((asset, index) => (
    asset.id === right[index]?.id && asset.type === right[index]?.type
  ));
}

const REFERENCE_MENU_CARET_GAP = 4;
const REFERENCE_MEDIA_DURATION_TOLERANCE_SECONDS = 0.1;
type ReferenceMenuPosition = MentionMenuPosition;

export function getReferenceMenuHorizontalBounds(
  caretLeft: number,
  inputWidth: number,
  preferredWidth = 320,
  sideInset = 8,
) {
  return getMentionMenuHorizontalBounds(caretLeft, inputWidth, preferredWidth, sideInset);
}

const VIDEO_MODEL_LABELS: Record<VideoModel, string> = {
  'seedance-2.5': 'Seedance 2.5',
  'seedance-2.0': 'Seedance 2.0',
  'seedance-2.0-fast': 'Seedance 2.0 Fast',
  'seedance-2.0-mini': 'Seedance 2.0 Mini',
};

const VIDEO_MODEL_BY_LABEL = Object.entries(VIDEO_MODEL_LABELS).reduce<Record<string, VideoModel>>((map, [id, label]) => {
  map[label] = id as VideoModel;
  map[id] = id as VideoModel;
  return map;
}, {});

function normalizeDuration(value: string): Duration {
  const seconds = value.replace('s', '') as Duration;
  return ['5', '10', '15', '20', '25', '30'].includes(seconds) ? seconds : '15';
}

function normalizeResolution(value: string): Resolution {
  return ['480p', '720p', '1080p'].includes(value) ? value as Resolution : '480p';
}

function normalizeAspectRatio(value: string): AspectRatio {
  return value === '9:16' || value === '16:9' || value === 'adaptive' ? value : '9:16';
}

function toReferenceAsset(reference: AssetReferenceImage | AssetReferenceAsset): AssetReferenceAsset {
  return {
    ...reference,
    type: 'type' in reference ? reference.type : 'image',
  };
}

function assetToReferenceAsset(asset: Asset): AssetReferenceAsset {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    thumbnail: asset.thumbnail,
    publicUrl: asset.publicUrl,
    thumbnailUrl: asset.thumbnailUrl,
    duration: asset.duration,
    durationSeconds: asset.durationSeconds,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    mediaExtension: asset.mediaExtension,
  };
}

function referenceToPickerAsset(reference: AssetReferenceAsset): Asset {
  const source: AssetSource = reference.type === 'image'
    ? 'uploaded-image'
    : reference.type === 'video'
      ? 'uploaded-video'
      : 'uploaded-audio';
  return {
    id: reference.id,
    name: reference.name,
    type: reference.type,
    source,
    folderId: null,
    size: '',
    sizeBytes: reference.sizeBytes,
    duration: reference.duration,
    durationSeconds: reference.durationSeconds,
    width: reference.width,
    height: reference.height,
    mediaExtension: reference.mediaExtension,
    createdAt: '',
    updatedAt: '',
    thumbnail: reference.thumbnail,
    publicUrl: reference.publicUrl,
    thumbnailUrl: reference.thumbnailUrl,
    views: 0,
  };
}

function isReferenceAvailable(reference: AssetReferenceAsset) {
  return Boolean(reference.id && (reference.thumbnail || reference.thumbnailUrl || reference.publicUrl));
}

function getReferenceTypeLabel(type: AssetReferenceAsset['type']) {
  return type === 'video' ? '视频' : type === 'audio' ? '音频' : '图片';
}

function getReferenceAssetLabel(assets: AssetReferenceAsset[], index: number) {
  const asset = assets[index];
  if (!asset) return `素材${index + 1}`;
  const ordinal = assets.slice(0, index + 1).filter(item => item.type === asset.type).length;
  return `${getReferenceTypeLabel(asset.type)}${ordinal}`;
}

function getReferenceDurationSeconds(asset: AssetReferenceAsset) {
  if (typeof asset.durationSeconds === 'number' && Number.isFinite(asset.durationSeconds)) return asset.durationSeconds;
  if (!asset.duration) return 0;
  const value = asset.duration.trim();
  if (value.endsWith('s')) return Number(value.slice(0, -1)) || 0;
  const parts = value.split(':').map(Number);
  if (parts.length === 2 && parts.every(Number.isFinite)) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts.every(Number.isFinite)) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number(value) || 0;
}

function formatReferenceDuration(seconds: number) {
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}

function getReferenceSummary(assets: AssetReferenceAsset[]) {
  const imageCount = assets.filter(asset => asset.type === 'image').length;
  const videoAssets = assets.filter(asset => asset.type === 'video');
  const audioAssets = assets.filter(asset => asset.type === 'audio');
  const parts = [
    imageCount > 0 ? `${imageCount} 张图片` : '',
    videoAssets.length > 0 ? `${videoAssets.length} 个视频` : '',
    audioAssets.length > 0 ? `${audioAssets.length} 个音频` : '',
  ].filter(Boolean);
  if (parts.length > 0) return `已选择 ${parts.join('、')}`;
  return '选择参考素材';
}

function getReferenceDurationSummary(assets: AssetReferenceAsset[]) {
  const videoAssets = assets.filter(asset => asset.type === 'video');
  const audioAssets = assets.filter(asset => asset.type === 'audio');
  const parts = [
    videoAssets.length > 0
      ? `视频 ${formatReferenceDuration(videoAssets.reduce((total, asset) => total + getReferenceDurationSeconds(asset), 0))}`
      : '',
    audioAssets.length > 0
      ? `音频 ${formatReferenceDuration(audioAssets.reduce((total, asset) => total + getReferenceDurationSeconds(asset), 0))}`
      : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

export interface ReferenceMentionOption {
  asset: AssetReferenceAsset;
  index: number;
  label: string;
}

export function getReferenceMentionOptions(
  assets: AssetReferenceAsset[],
  query: string,
): ReferenceMentionOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const typeRank: Record<AssetReferenceAsset['type'], number> = { image: 0, video: 1, audio: 2 };
  return assets
    .map((asset, index) => ({ asset, index, label: getReferenceAssetLabel(assets, index) }))
    .filter(option => {
      if (!normalizedQuery) return true;
      const haystack = `${option.label} ${getReferenceTypeLabel(option.asset.type)} ${option.asset.name}`.toLocaleLowerCase('zh-CN');
      return haystack.includes(normalizedQuery);
    })
    .sort((left, right) => typeRank[left.asset.type] - typeRank[right.asset.type] || left.index - right.index);
}

export function getReferenceCapabilityViolation(
  assets: AssetReferenceAsset[],
  capability: VideoModelCapability,
) {
  const imageCount = assets.filter(asset => asset.type === 'image').length;
  const videoAssets = assets.filter(asset => asset.type === 'video');
  const audioAssets = assets.filter(asset => asset.type === 'audio');
  const limits = capability.references;
  if (assets.length > limits.maxTotal) return `参考素材总数不能超过 ${limits.maxTotal} 个`;
  if (imageCount > limits.maxImages) return `参考图片不能超过 ${limits.maxImages} 张`;
  if (videoAssets.length > limits.maxVideos) return `参考视频不能超过 ${limits.maxVideos} 个`;
  if (audioAssets.length > limits.maxAudios) return `参考音频不能超过 ${limits.maxAudios} 个`;
  const videoDuration = videoAssets.reduce((total, asset) => total + getReferenceDurationSeconds(asset), 0);
  if (videoDuration > limits.maxVideoDurationSeconds + REFERENCE_MEDIA_DURATION_TOLERANCE_SECONDS) {
    return `参考视频总时长不能超过 ${limits.maxVideoDurationSeconds}s`;
  }
  const audioDuration = audioAssets.reduce((total, asset) => total + getReferenceDurationSeconds(asset), 0);
  if (audioDuration > limits.maxAudioDurationSeconds + REFERENCE_MEDIA_DURATION_TOLERANCE_SECONDS) {
    return `参考音频总时长不能超过 ${limits.maxAudioDurationSeconds}s`;
  }
  if (!limits.allowAudioOnly && audioAssets.length > 0 && imageCount === 0 && videoAssets.length === 0) {
    return '参考音频不能单独使用，请至少选择一张图片或一个视频';
  }
  return null;
}

function updatePromptAfterReferenceRemoval(
  prompt: string,
  removedAsset: AssetReferenceAsset,
  removedNumber: number,
) {
  const removedLabel = getReferenceTypeLabel(removedAsset.type);
  return prompt.replace(/@(图片|视频|音频)(\d+)(\s?)/g, (match, label: string, rawNumber: string, trailingSpace: string) => {
    if (label !== removedLabel) return match;
    const referenceNumber = Number(rawNumber);
    if (!Number.isInteger(referenceNumber) || referenceNumber < 1) return match;
    if (referenceNumber === removedNumber) return '';
    if (referenceNumber > removedNumber) return `@${label}${referenceNumber - 1}${trailingSpace}`;
    return match;
  });
}

export function removeUnavailableReferenceMentions(prompt: string, references: AssetReferenceAsset[]) {
  const counts = { image: 0, video: 0, audio: 0 };
  const removals = references.flatMap(asset => {
    counts[asset.type] += 1;
    return isReferenceAvailable(asset) ? [] : [{ asset, number: counts[asset.type] }];
  });

  // 同类型从后往前删除，避免前一个编号变化影响后续匹配。
  removals.sort((left, right) => (
    left.asset.type.localeCompare(right.asset.type) || right.number - left.number
  ));
  return removals.reduce(
    (nextPrompt, removal) => updatePromptAfterReferenceRemoval(
      nextPrompt,
      removal.asset,
      removal.number,
    ),
    prompt,
  );
}

function getFrameBadgeLabel(slot: FrameAssetSlot) {
  return slot === 'first-frame' ? '首帧' : '尾帧';
}

const VIDEO_MODEL_PRESENTATION: Array<Omit<VideoModelOption, 'enabled'>> = [
  { id: 'seedance-2.5', name: 'Seedance 2.5', desc: '多模态长视频，原生有声更沉浸', badge: '新品推荐', icon: Sparkles, from: 'from-fuchsia-500', to: 'to-violet-600', badgeColor: 'bg-fuchsia-500/20 text-fuchsia-200' },
  { id: 'seedance-2.0', name: 'Seedance 2.0', desc: '1080p 高清输出，正式成片首选', badge: '全能推荐', icon: Sparkles, from: 'from-purple-600', to: 'to-blue-600', badgeColor: 'bg-purple-500/20 text-purple-300' },
  { id: 'seedance-2.0-fast', name: 'Seedance 2.0 Fast', desc: '更快生成，适合高效试稿', badge: '快速出片', icon: Zap, from: 'from-orange-500', to: 'to-red-600', badgeColor: 'bg-orange-500/20 text-orange-300' },
  { id: 'seedance-2.0-mini', name: 'Seedance 2.0 Mini', desc: '低成本批量创作，日常出片更省', badge: '高性价比', icon: Zap, from: 'from-red-600', to: 'to-pink-600', badgeColor: 'bg-pink-500/20 text-pink-300' },
];

export function reconcileVideoConfiguration(
  capability: VideoModelCapability,
  current: {
    mode: ReferenceMode;
    aspectRatio: AspectRatio;
    resolution: Resolution;
    duration: Duration;
  },
) {
  const mode = capability.modes.includes(current.mode) ? current.mode : capability.modes[0] ?? 'general';
  const aspectRatios = mode === 'first-last'
    ? capability.aspectRatios.firstLast
    : capability.aspectRatios.general;
  const aspectRatio = aspectRatios.includes(current.aspectRatio)
    ? current.aspectRatio
    : aspectRatios[0] ?? '9:16';
  const resolution = capability.resolutions.includes(current.resolution)
    ? current.resolution
    : [...capability.resolutions]
        .sort((left, right) => (
          Math.abs(Number.parseInt(current.resolution, 10) - Number.parseInt(left, 10))
          - Math.abs(Number.parseInt(current.resolution, 10) - Number.parseInt(right, 10))
        ))[0] ?? '480p';
  const duration = capability.durationSeconds.includes(Number(current.duration) as ConsumptionVideoDurationSeconds)
    ? current.duration
    : String(
        [...capability.durationSeconds]
          .sort((left, right) => Math.abs(Number(current.duration) - left) - Math.abs(Number(current.duration) - right))[0]
          ?? 5,
      ) as Duration;
  const adjusted: string[] = [];
  if (mode !== current.mode) adjusted.push('参考模式');
  if (aspectRatio !== current.aspectRatio) adjusted.push('画面比例');
  if (resolution !== current.resolution) adjusted.push('分辨率');
  if (duration !== current.duration) adjusted.push('时长');
  return { mode, aspectRatio, resolution, duration, adjusted };
}

export function getFrameAssetSelectionRules(model: VideoModel) {
  return {
    maxImages: 1,
    maxVideos: 0,
    maxAudios: 0,
    ...(model === 'seedance-2.5' ? { image: { requireDimensions: true } } : {}),
  };
}

export function getFrameCapabilityViolation(
  model: VideoModel,
  mode: ReferenceMode,
  firstFrame: AssetReferenceAsset | null,
) {
  if (model !== 'seedance-2.5' || mode !== 'first-last' || !firstFrame) return null;
  if (Number.isSafeInteger(firstFrame.width) && Number(firstFrame.width) > 0
    && Number.isSafeInteger(firstFrame.height) && Number(firstFrame.height) > 0) return null;
  return '首帧尺寸信息不完整，请重新选择已完成处理的图片';
}

export interface AIVideoStudioProps {
  assets: Asset[];
  folders: AssetFolder[];
  assetSummary: AssetSummary;
  assetPagination?: CursorPaginationState;
  assetPageLoading?: boolean;
  assetPageError?: unknown;
  generationJobs: AdminGenerationJob[];
  generationPagination?: CursorPaginationState;
  generationPageLoading?: boolean;
  reuseDraft?: AssetGenerationMeta | null;
  onReuseDraftConsumed?: () => void;
  onGenerationReserve: (requests: GenerationReserveRequest[]) => Promise<GenerationReserveResult>;
  onAssetsPrepare: () => void;
  onAssetFiltersChange: (filters: { source?: AssetSource; folderId?: string | null; search?: string }) => void;
  onAssetPageNavigate: (position: PagePosition) => void;
  onAssetDetailLoad: (assetId: string) => Promise<Asset>;
  onGenerationJobDetailLoad: (jobId: string) => Promise<AdminGenerationJob>;
  onGenerationPageNavigate: (position: PagePosition) => void;
  onConsumptionSettingsRefresh: () => Promise<ConsumptionSettings>;
  onUploadFile: (file: File, folderId: string | null, onProgress?: (event: UploadProgressEvent) => void) => Promise<Asset>;
  onAssetDownload: (asset: DownloadableAsset) => Promise<BrowserDownloadResult | null>;
  onAssetDelete: (assetId: string) => Promise<void>;
  consumptionSettings: ConsumptionSettings;
  availableCredits: number;
  onPromptWizardCreditsChanged: () => Promise<void>;
  onCreditsRecharge: () => void;
  realPortraitActors: RealPortraitActor[];
  realPortraitsLoading?: boolean;
  onRealPortraitLibraryOpen: () => void;
}

export async function loadAIStudioQueueAssetDetail(
  item: Pick<AIStudioQueueItem, 'assetId'>,
  loadAssetDetail: (assetId: string) => Promise<Asset>,
) {
  if (!item.assetId) return null;
  return loadAssetDetail(item.assetId);
}

export function buildGenerationDraftFromJob(
  job: AdminGenerationJob,
  availableAssets: Asset[],
): AssetGenerationMeta | null {
  if (job.kind !== 'video') return null;
  const config = job.configData ?? {};
  const assetById = new Map(availableAssets.map(asset => [asset.id, asset]));
  const rawReferences = Array.isArray(config.referenceAssets) ? config.referenceAssets : [];
  const referenceAssets = rawReferences.flatMap<AssetReferenceAsset>(reference => {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return [];
    const record = reference as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.id) return [];
    const asset = assetById.get(record.id);
    const type = record.type === 'video' || record.type === 'audio' || record.type === 'image'
      ? record.type
      : asset?.type ?? 'image';
    const role = record.role === 'reference_image'
      || record.role === 'reference_video'
      || record.role === 'reference_audio'
      || record.role === 'first_frame'
      || record.role === 'last_frame'
      ? record.role
      : undefined;
    return [{
      ...(asset ? assetToReferenceAsset(asset) : {
        id: record.id,
        name: typeof record.name === 'string' ? record.name : '原参考素材',
        type,
        thumbnail: typeof record.previewUrl === 'string' ? record.previewUrl : '',
        publicUrl: typeof record.previewUrl === 'string' ? record.previewUrl : undefined,
      }),
      type,
      role,
      durationSeconds: typeof record.durationSeconds === 'number' ? record.durationSeconds : asset?.durationSeconds,
      width: typeof record.width === 'number' ? record.width : asset?.width,
      height: typeof record.height === 'number' ? record.height : asset?.height,
    }];
  });
  const durationSeconds = typeof config.durationSeconds === 'number'
    ? config.durationSeconds
    : Number.parseInt(job.duration, 10) || 5;
  const outputFormat = config.outputFormat === 'mov' ? 'mov' : config.outputFormat === 'mp4' ? 'mp4' : undefined;
  return {
    kind: 'video',
    model: job.model,
    prompt: job.prompt,
    mode: config.mode === 'first-last' ? 'first-last' : 'general',
    aspectRatio: normalizeAspectRatio(typeof config.aspectRatio === 'string' ? config.aspectRatio : '9:16'),
    resolution: typeof config.resolution === 'string' ? config.resolution : '480p',
    duration: `${durationSeconds}s`,
    generateAudio: typeof config.generateAudio === 'boolean' ? config.generateAudio : undefined,
    outputFormat,
    referenceImages: [],
    referenceAssets,
  };
}

export async function loadFailedGenerationDraft(
  jobId: string,
  availableAssets: Asset[],
  loadJobDetail: (id: string) => Promise<AdminGenerationJob>,
) {
  return buildGenerationDraftFromJob(await loadJobDetail(jobId), availableAssets);
}

export function AIVideoStudio({ assets, folders, assetSummary, assetPagination, assetPageLoading, assetPageError, generationJobs, generationPagination, generationPageLoading, reuseDraft, onReuseDraftConsumed, onGenerationReserve, onAssetsPrepare, onAssetFiltersChange, onAssetPageNavigate, onAssetDetailLoad, onGenerationJobDetailLoad, onGenerationPageNavigate, onConsumptionSettingsRefresh, onUploadFile, onAssetDownload, onAssetDelete, consumptionSettings, availableCredits, onPromptWizardCreditsChanged, onCreditsRecharge, realPortraitActors, realPortraitsLoading = false, onRealPortraitLibraryOpen }: AIVideoStudioProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardImages, setWizardImages] = useState<AssetReferenceAsset[]>([]);
  const [assetPickerTarget, setAssetPickerTarget] = useState<AssetPickerTarget | null>(null);
  const tkPromptEngineAvailable = isTkPromptEngineAvailable(consumptionSettings.tkPromptEngine);

  // ── Video state ──
  const [videoPrompt, setVideoPrompt] = useState('');
  const [appliedTkPrompt, setAppliedTkPrompt] = useState<{
    source: TkPromptSource;
    prompt: string;
    videoConfig: TkPromptVideoConfig;
  } | null>(null);
  const [selectedReferenceAssets, setSelectedReferenceAssets] = useState<AssetReferenceAsset[]>([]);
  const [referenceRestoreWarning, setReferenceRestoreWarning] = useState<string | null>(null);
  const [referenceAssetsExpanded, setReferenceAssetsExpanded] = useState(false);
  const [referenceMenuIndex, setReferenceMenuIndex] = useState<number | null>(null);
  const [referenceMenuPosition, setReferenceMenuPosition] = useState<ReferenceMenuPosition | null>(null);
  const [referenceMenuQuery, setReferenceMenuQuery] = useState('');
  const [referenceMenuActiveIndex, setReferenceMenuActiveIndex] = useState(0);
  const [videoModel, setVideoModel] = useState<VideoModel>('seedance-2.0');
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('general');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [resolution, setResolution] = useState<Resolution>('480p');
  const [duration, setDuration] = useState<Duration>('15');
  const [quantity, setQuantity] = useState(1);
  const [firstFrame, setFirstFrame] = useState<AssetReferenceAsset | null>(null);
  const [lastFrame, setLastFrame] = useState<AssetReferenceAsset | null>(null);
  const {
    status: videoGenerateStatus,
    isLocked: isVideoGenerateLocked,
    run: runVideoGenerate,
  } = useAIStudioGenerateFeedback();
  const [editingFailedJobId, setEditingFailedJobId] = useState<string | null>(null);
  const [selectedRealPortraitActorId, setSelectedRealPortraitActorId] = useState<string | null>(null);
  const [selectedRealPortraitAssetId, setSelectedRealPortraitAssetId] = useState<string | null>(null);
  const videoPromptRef = useRef<HTMLTextAreaElement>(null);
  const referenceSectionRef = useRef<HTMLDivElement>(null);
  const [generationError, setGenerationError] = useState<{ message: string; field: 'prompt' | 'references' | 'submit' } | null>(null);
  const reportGenerationError = (message: string, field: 'prompt' | 'references' | 'submit' = 'submit') => {
    setGenerationError({ message, field });
    if (field === 'prompt') videoPromptRef.current?.focus();
    if (field === 'references') referenceSectionRef.current?.querySelector<HTMLElement>('button:not(:disabled), [role="button"]')?.focus();
  };
  useEffect(() => {
    setGenerationError(current => current?.field === 'references' ? null : current);
  }, [firstFrame, lastFrame, referenceMode, selectedReferenceAssets]);

  const detachAppliedTkPrompt = useCallback((reason: string) => {
    if (!appliedTkPrompt) return;
    setAppliedTkPrompt(null);
    toast.info(`已保留当前执行提示词；${reason}与原 TK 方案快照不同，已转为手动草稿，提交时不再关联原方案。`);
  }, [appliedTkPrompt]);

  const handleRealPortraitSelection = (actorId: string | null, assetId: string | null) => {
    // TK 来源与站内真人演员请求互斥。用户在应用 TK 方案后主动添加或
    // 更换真人演员时保留提示词，但必须解除 TK 来源，避免提交必然失败。
    if (actorId !== selectedRealPortraitActorId || assetId !== selectedRealPortraitAssetId) {
      detachAppliedTkPrompt('真人演员选择');
    }
    setSelectedRealPortraitActorId(actorId);
    setSelectedRealPortraitAssetId(assetId);
  };

  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const videoQueue = useMemo(() => buildAIStudioQueueItems(generationJobs, assets), [assets, generationJobs]);
  const videoModels = useMemo(() => VIDEO_MODEL_PRESENTATION.map(model => ({
    ...model,
    enabled: getVideoModelCapability(consumptionSettings, model.id).available,
  })), [consumptionSettings]);
  const videoCapability = useMemo(
    () => getVideoModelCapability(consumptionSettings, videoModel),
    [consumptionSettings, videoModel],
  );
  const availableVideoCombinations = useMemo(
    () => getAvailableVideoConsumptionCombinations(consumptionSettings, videoModel, videoCapability),
    [consumptionSettings, videoCapability, videoModel],
  );
  const hasReferenceVideo = referenceMode === 'general'
    && selectedReferenceAssets.some(asset => asset.type === 'video');
  const videoCreditPerItem = getVideoConsumptionCredits(
    consumptionSettings,
    videoModel,
    duration,
    resolution,
    hasReferenceVideo,
  );
  const videoTotalCredits = videoCreditPerItem * quantity;
  const hasAvailableVideoCombination = availableVideoCombinations.some(combination => (
    combination.duration === duration && combination.resolution === resolution
  ));
  const videoConfigAvailable = videoCapability.available
    && hasAvailableVideoCombination
    && videoCreditPerItem > 0;
  const consumptionRefreshRef = useRef(onConsumptionSettingsRefresh);
  const assetPickerOpen = assetPickerTarget !== null;
  const usableRealPortraitActors = useMemo(
    () => realPortraitActors.filter(canUsePortraitActor),
    [realPortraitActors],
  );
  const selectedRealPortraitActor = usableRealPortraitActors.find(actor => actor.id === selectedRealPortraitActorId) ?? null;
  const usableRealPortraitAssets = useMemo(
    () => selectedRealPortraitActor?.assets.filter(asset => (
      asset.status === 'active' && asset.consistencyStatus === 'passed'
    )) ?? [],
    [selectedRealPortraitActor],
  );
  const selectedRealPortraitAsset = usableRealPortraitAssets.find(
    asset => asset.id === selectedRealPortraitAssetId,
  ) ?? null;
  const tkPromptEngineAvailableForModel = tkPromptEngineAvailable && videoCapability.supportsPromptWizard;
  const referenceMentionOptions = useMemo(
    () => getReferenceMentionOptions(selectedReferenceAssets, referenceMenuQuery),
    [referenceMenuQuery, selectedReferenceAssets],
  );
  const visibleReferenceAssets = referenceAssetsExpanded
    ? selectedReferenceAssets
    : selectedReferenceAssets.slice(0, 10);
  const referenceCapabilityViolation = referenceMode === 'general'
    ? getReferenceCapabilityViolation(selectedReferenceAssets, videoCapability)
    : null;
  const frameCapabilityViolation = getFrameCapabilityViolation(videoModel, referenceMode, firstFrame);
  const generationReferenceViolation = referenceCapabilityViolation ?? frameCapabilityViolation;

  useEffect(() => {
    if (!tkPromptEngineAvailableForModel) setWizardOpen(false);
  }, [tkPromptEngineAvailableForModel]);

  useEffect(() => {
    if (selectedReferenceAssets.length <= 10) setReferenceAssetsExpanded(false);
  }, [selectedReferenceAssets.length]);

  useEffect(() => {
    if (selectedRealPortraitActorId && !usableRealPortraitActors.some(actor => actor.id === selectedRealPortraitActorId)) {
      setSelectedRealPortraitActorId(null);
    }
  }, [selectedRealPortraitActorId, usableRealPortraitActors]);

  useEffect(() => {
    if (!selectedRealPortraitActor) {
      // 演员本身刚失效时由上一个 effect 清空选择；TK 来源只绑定商品图，
      // 不再把独立的真人演员库选择视为方案快照的一部分。
      if (selectedRealPortraitActorId !== null) return;
      setSelectedRealPortraitAssetId(null);
      return;
    }
    if (selectedRealPortraitAsset) return;
    const nextAssetId = usableRealPortraitAssets.find(asset => asset.kind === 'primary')?.id ?? null;
    setSelectedRealPortraitAssetId(nextAssetId);
  }, [
    selectedRealPortraitActor,
    selectedRealPortraitAsset,
    selectedRealPortraitAssetId,
    usableRealPortraitAssets,
  ]);

  const closeReferenceMenu = () => {
    setReferenceMenuIndex(null);
    setReferenceMenuPosition(null);
    setReferenceMenuQuery('');
    setReferenceMenuActiveIndex(0);
  };

  useEffect(() => {
    consumptionRefreshRef.current = onConsumptionSettingsRefresh;
  }, [onConsumptionSettingsRefresh]);

  const refreshConsumptionBeforeGenerate = async () => {
    try {
      return await consumptionRefreshRef.current();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '积分消耗配置刷新失败，请稍后重试');
      return null;
    }
  };

  const applyGenerationDraft = (draft: AssetGenerationMeta) => {
    setAppliedTkPrompt(null);
    if (draft.kind === 'video') {
      const draftModel = VIDEO_MODEL_BY_LABEL[draft.model] ?? 'seedance-2.0';
      const draftCapability = getVideoModelCapability(consumptionSettings, draftModel);
      const normalizedDraft = reconcileVideoConfiguration(draftCapability, {
        mode: draft.mode,
        aspectRatio: normalizeAspectRatio(draft.aspectRatio),
        resolution: normalizeResolution(draft.resolution),
        duration: normalizeDuration(draft.duration),
      });
      const referenceSource = draft.referenceAssets?.length
        ? draft.referenceAssets
        : draft.referenceImages;
      const draftReferences = referenceSource.map(toReferenceAsset);
      const unavailableReferenceCount = draftReferences.filter(asset => !isReferenceAvailable(asset)).length;
      setReferenceRestoreWarning(unavailableReferenceCount > 0
        ? `${unavailableReferenceCount} 个原参考素材已删除或不可访问，请重新选择后再提交。`
        : null);

      setVideoPrompt(removeUnavailableReferenceMentions(draft.prompt, draftReferences));
      setReferenceMode(normalizedDraft.mode);
      setVideoModel(draftModel);
      setAspectRatio(normalizedDraft.aspectRatio);
      setResolution(normalizedDraft.resolution);
      setDuration(normalizedDraft.duration);
      closeReferenceMenu();

      if (normalizedDraft.mode === 'general') {
        setSelectedReferenceAssets(draftReferences.filter(isReferenceAvailable));
        setFirstFrame(null);
        setLastFrame(null);
      } else {
        const frameReferences = draftReferences.filter(asset => asset.type === 'image');
        const firstFrameReference = frameReferences.find(asset => asset.role === 'first_frame') ?? frameReferences[0];
        const lastFrameReference = frameReferences.find(asset => asset.role === 'last_frame') ?? frameReferences[1];
        setSelectedReferenceAssets([]);
        setFirstFrame(firstFrameReference && isReferenceAvailable(firstFrameReference) ? firstFrameReference : null);
        setLastFrame(lastFrameReference && isReferenceAvailable(lastFrameReference) ? lastFrameReference : null);
      }
      return unavailableReferenceCount;
    }
    toast.info('图片生成功能暂未开放，无法载入该历史参数');
    return null;
  };

  useEffect(() => {
    if (!reuseDraft) return;

    const unavailableReferenceCount = applyGenerationDraft(reuseDraft);
    onReuseDraftConsumed?.();
    if (unavailableReferenceCount === 0) toast.success('已载入生成参数');
    else if (unavailableReferenceCount !== null) {
      toast.warning(`已载入生成参数；${unavailableReferenceCount} 个原始参考素材已删除或不可访问，已自动移除`);
    }
  }, [reuseDraft, onReuseDraftConsumed]);

  const handleReferenceModeChange = (mode: ReferenceMode) => {
    if (mode !== referenceMode) detachAppliedTkPrompt('参考模式');
    setReferenceMode(mode);
    const allowedRatios = mode === 'first-last'
      ? videoCapability.aspectRatios.firstLast
      : videoCapability.aspectRatios.general;
    if (!allowedRatios.includes(aspectRatio)) {
      const nextRatio = allowedRatios[0] ?? '9:16';
      setAspectRatio(nextRatio);
      toast.info(`画面比例已调整为${nextRatio === 'adaptive' ? '跟随首帧' : ` ${nextRatio}`}`);
    }
    closeReferenceMenu();
  };

  const handleModelChange = (m: VideoModel) => {
    const model = videoModels.find(item => item.id === m);
    if (!model?.enabled) {
      toast.info('该模型暂未接入生产');
      return;
    }
    const capability = getVideoModelCapability(consumptionSettings, m);
    const next = reconcileVideoConfiguration(capability, {
      mode: referenceMode,
      aspectRatio,
      resolution,
      duration,
    });
    if (
      m !== videoModel
      || next.mode !== referenceMode
      || next.aspectRatio !== aspectRatio
      || next.resolution !== resolution
      || next.duration !== duration
    ) {
      detachAppliedTkPrompt('视频模型');
    }
    setVideoModel(m);
    setReferenceMode(next.mode);
    setAspectRatio(next.aspectRatio);
    setResolution(next.resolution);
    setDuration(next.duration);
    if (!capability.supportsPromptWizard) {
      setWizardOpen(false);
    }
    if (next.adjusted.length > 0) {
      toast.info(`已保留参考素材，并将${next.adjusted.join('、')}调整为 ${model.name} 支持的选项`);
    }
  };

  const handleResolutionChange = (nextResolution: Resolution) => {
    const resolutionChanged = nextResolution !== resolution;
    if (resolutionChanged) detachAppliedTkPrompt('视频分辨率');
    const pricedDurations = availableVideoCombinations
      .filter(combination => combination.resolution === nextResolution)
      .map(combination => combination.duration);
    setResolution(nextResolution);
    if (pricedDurations.includes(duration)) return;
    const nextDuration = [...pricedDurations].sort((left, right) => (
      Math.abs(Number(left) - Number(duration)) - Math.abs(Number(right) - Number(duration))
    ))[0];
    if (!nextDuration) return;
    if (!resolutionChanged && nextDuration !== duration) detachAppliedTkPrompt('视频分辨率');
    setDuration(nextDuration);
    toast.info(`该分辨率未开放 ${duration}s，已调整为最近可用的 ${nextDuration}s`);
  };

  const handleAspectRatioChange = (nextAspectRatio: AspectRatio) => {
    if (nextAspectRatio !== aspectRatio) detachAppliedTkPrompt('画面比例');
    setAspectRatio(nextAspectRatio);
  };

  const handleDurationChange = (nextDuration: Duration) => {
    if (nextDuration !== duration) detachAppliedTkPrompt('视频时长');
    setDuration(nextDuration);
  };

  const handleReferenceAssetsConfirm = (assets: Asset[]) => {
    const referenceAssets = assets.map(assetToReferenceAsset);

    if (assetPickerTarget === 'wizard-images') {
      setWizardImages(referenceAssets.filter(asset => asset.type === 'image'));
    } else if (assetPickerTarget === 'first-frame') {
      setFirstFrame(referenceAssets[0] ?? null);
    } else if (assetPickerTarget === 'last-frame') {
      setLastFrame(referenceAssets[0] ?? null);
    } else {
      if (!tkPromptReferenceAssetsEqual(selectedReferenceAssets, referenceAssets)) {
        detachAppliedTkPrompt('商品参考素材');
      }
      setSelectedReferenceAssets(referenceAssets);
    }

    setReferenceRestoreWarning(null);

    closeReferenceMenu();
    setAssetPickerTarget(null);
  };

  const handleReferenceAssetRemove = (event: MouseEvent<HTMLButtonElement>, indexToRemove: number) => {
    event.stopPropagation();
    const removedAsset = selectedReferenceAssets[indexToRemove];
    if (!removedAsset) return;
    detachAppliedTkPrompt('商品参考素材');
    const removedNumber = selectedReferenceAssets.slice(0, indexToRemove + 1).filter(asset => asset.type === removedAsset.type).length;
    setSelectedReferenceAssets(prev => prev.filter((_, index) => index !== indexToRemove));
    setVideoPrompt(prev => updatePromptAfterReferenceRemoval(prev, removedAsset, removedNumber));
    closeReferenceMenu();
  };

  const openAssetPicker = () => setAssetPickerTarget('general');
  const openPromptWizard = () => {
    if (referenceMode !== 'general') return;
    if (!videoCapability.supportsPromptWizard) {
      toast.info(`${videoCapability.label} 的 AI 提示词正在适配中`);
      return;
    }
    if (!tkPromptEngineAvailableForModel) {
      toast.error('AI 提示词功能当前不可用');
      return;
    }
    setWizardImages(selectedReferenceAssets.filter(asset => asset.type === 'image'));
    setWizardOpen(true);
  };
  const applyTkPromptDraft = (draft: TkPromptApplyDraft) => {
    if (referenceMode !== 'general') {
      toast.error('提示词向导只能应用到全能参考模式');
      return;
    }
    const imageById = new Map(wizardImages.map(image => [image.id, image]));
    const nextImages = draft.referenceImageAssetIds
      .map(id => imageById.get(id))
      .filter((image): image is AssetReferenceAsset => Boolean(image));
    if (nextImages.length !== draft.referenceImageAssetIds.length) {
      toast.error('部分向导图片已不可用，请重新选择');
      return;
    }
    // TK 人物出镜由 Seedance 根据执行提示词生成，不绑定真人演员库素材。
    // 应用方案时清空可能残留的手动演员，确保参考输入只有本次商品图片。
    setSelectedRealPortraitActorId(null);
    setSelectedRealPortraitAssetId(null);
    setVideoPrompt(draft.prompt);
    setAppliedTkPrompt(draft.source ? {
      source: draft.source,
      prompt: draft.prompt,
      videoConfig: draft.videoConfig,
    } : null);
    setVideoModel(draft.videoConfig.model);
    setAspectRatio(draft.videoConfig.aspectRatio);
    setResolution(
      isLimitedResolutionModel(draft.videoConfig.model) && draft.videoConfig.resolution === '1080p'
        ? '480p'
        : draft.videoConfig.resolution,
    );
    setDuration(String(draft.videoConfig.durationSeconds) as Duration);
    // TK 方案只对本次确认的商品图片负责。采用方案时必须
    // 替换旧参考素材，不能把向导未分析的历史视频/音频静默夹带给 Seedance。
    setSelectedReferenceAssets(nextImages);
    closeReferenceMenu();
    setWizardOpen(false);
    requestAnimationFrame(() => {
      videoPromptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      videoPromptRef.current?.focus();
      videoPromptRef.current?.setSelectionRange(draft.prompt.length, draft.prompt.length);
    });
    toast.success('已更新视频描述、模型、比例、分辨率、时长和全能参考图片；视频尚未生成');
  };
  const openFrameAssetPicker = (target: FrameAssetSlot) => setAssetPickerTarget(target);
  const clearFrameAsset = (target: FrameAssetSlot) => {
    if (target === 'first-frame') {
      setFirstFrame(null);
    } else {
      setLastFrame(null);
    }
  };

  const getReferenceTriggerIndex = (prompt: string, caret: number) => {
    const canMentionReference = referenceMode === 'general' && selectedReferenceAssets.length > 0;
    if (!canMentionReference) return null;

    const beforeCaret = prompt.slice(0, caret);
    const triggerIndex = beforeCaret.lastIndexOf('@');
    if (triggerIndex === -1) return null;

    const mentionText = beforeCaret.slice(triggerIndex);
    if (!mentionText.startsWith('@') || /\s/.test(mentionText)) return null;

    return triggerIndex;
  };

  const syncReferenceMenu = (
    prompt: string,
    caret: number,
    input = videoPromptRef.current,
  ) => {
    const triggerIndex = getReferenceTriggerIndex(prompt, caret);
    if (triggerIndex === null || !input) {
      closeReferenceMenu();
      return;
    }

    const caretPosition = measureTextareaCaret(input, caret);
    const inputWidth = input.getBoundingClientRect().width;
    const horizontalBounds = getReferenceMenuHorizontalBounds(caretPosition.left, inputWidth);
    setReferenceMenuIndex(triggerIndex);
    setReferenceMenuQuery(prompt.slice(triggerIndex + 1, caret));
    setReferenceMenuActiveIndex(0);
    setReferenceMenuPosition({
      ...horizontalBounds,
      top: caretPosition.top + caretPosition.height + REFERENCE_MENU_CARET_GAP,
    });
  };

  const getPromptCaret = (input: HTMLTextAreaElement, prompt = input.value) => {
    const caret = input.selectionStart ?? prompt.length;
    return caret === 0 && prompt.length > 0 ? prompt.length : caret;
  };

  const handleVideoPromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextPrompt = event.target.value;
    const caret = getPromptCaret(event.target, nextPrompt);

    setVideoPrompt(nextPrompt);
    syncReferenceMenu(nextPrompt, caret, event.target);
  };

  const handleVideoPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (referenceMenuIndex === null) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeReferenceMenu();
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && referenceMentionOptions.length > 0) {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setReferenceMenuActiveIndex(current => (
        current + direction + referenceMentionOptions.length
      ) % referenceMentionOptions.length);
      return;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && referenceMentionOptions.length > 0) {
      event.preventDefault();
      const option = referenceMentionOptions[referenceMenuActiveIndex] ?? referenceMentionOptions[0];
      if (option) insertReferenceToken(option.index);
    }
  };

  const handleVideoPromptKeyUp = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (['Escape', 'ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)) return;
    const input = event.currentTarget;
    syncReferenceMenu(input.value, getPromptCaret(input), input);
  };

  const handleVideoPromptCursorChange = () => {
    const input = videoPromptRef.current;
    if (!input) return;
    syncReferenceMenu(input.value, getPromptCaret(input), input);
  };

  useEffect(() => {
    if (referenceMenuIndex === null) return;
    const input = videoPromptRef.current;
    if (!input) return;

    const refreshPosition = () => {
      syncReferenceMenu(input.value, getPromptCaret(input), input);
    };
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(refreshPosition);

    resizeObserver?.observe(input);
    window.addEventListener('resize', refreshPosition);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', refreshPosition);
    };
  }, [referenceMenuIndex, referenceMode, selectedReferenceAssets.length]);

  const insertReferenceToken = (index: number) => {
    const input = videoPromptRef.current;
    const triggerIndex = referenceMenuIndex ?? input?.selectionStart ?? videoPrompt.length;
    const currentCaret = input?.selectionStart ?? triggerIndex + 1;
    const replaceEnd = Math.max(currentCaret, triggerIndex + 1);
    const asset = selectedReferenceAssets[index];
    const token = `@${asset ? getReferenceAssetLabel(selectedReferenceAssets, index) : `素材${index + 1}`} `;
    const nextPrompt = `${videoPrompt.slice(0, triggerIndex)}${token}${videoPrompt.slice(replaceEnd)}`;
    const nextCaret = triggerIndex + token.length;

    setVideoPrompt(nextPrompt);
    closeReferenceMenu();

    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const shouldShowReferenceMenu = referenceMode === 'general'
    && referenceMenuIndex !== null
    && referenceMenuPosition !== null
    && selectedReferenceAssets.length > 0;
  const assetPickerInitialSelectedAssets = assetPickerTarget === 'general'
    ? selectedReferenceAssets.map(reference => (
        assets.find(asset => asset.id === reference.id) ?? referenceToPickerAsset(reference)
      ))
    : assetPickerTarget === 'wizard-images'
      ? wizardImages.map(reference => (
          assets.find(asset => asset.id === reference.id) ?? referenceToPickerAsset(reference)
        ))
    : assetPickerTarget === 'first-frame' && firstFrame
      ? [assets.find(asset => asset.id === firstFrame.id) ?? referenceToPickerAsset(firstFrame)]
      : assetPickerTarget === 'last-frame' && lastFrame
        ? [assets.find(asset => asset.id === lastFrame.id) ?? referenceToPickerAsset(lastFrame)]
        : [];

  const handleQueuePreview = async (item: AIStudioQueueItem) => {
    if (!item.previewReady || !item.assetId) return;
    try {
      setPreviewAsset(await loadAIStudioQueueAssetDetail(item, onAssetDetailLoad));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '素材详情加载失败');
    }
  };

  const handleQueueDownload = async (event: MouseEvent<HTMLButtonElement>, item: AIStudioQueueItem) => {
    event.stopPropagation();
    if (!item.previewReady || !item.assetId) return;

    try {
      await onAssetDownload({ id: item.assetId, name: item.model, type: 'video' });
      toast.success('素材下载已开始');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '素材下载失败');
    }
  };

  const handleQueueReuseGenerate = (asset: Asset) => {
    if (!asset.generation) return;

    const unavailableReferenceCount = applyGenerationDraft(asset.generation);
    setPreviewAsset(null);
    if (unavailableReferenceCount === 0) toast.success('已载入生成参数');
    else if (unavailableReferenceCount !== null) {
      toast.warning(`已载入生成参数；${unavailableReferenceCount} 个原始参考素材已删除或不可访问，已自动移除`);
    }
  };

  const handleFailedJobEdit = async (event: MouseEvent<HTMLButtonElement>, item: AIStudioQueueItem) => {
    event.stopPropagation();
    if (editingFailedJobId) return;
    setEditingFailedJobId(item.id);
    try {
      const draft = await loadFailedGenerationDraft(item.id, assets, onGenerationJobDetailLoad);
      if (!draft) {
        toast.error('该任务不支持在视频工作台修改');
        return;
      }
      const unavailableReferenceCount = applyGenerationDraft(draft);
      if (unavailableReferenceCount) {
        toast.warning(`已载入失败任务参数；${unavailableReferenceCount} 个原参考素材当前不可访问，请重新选择后提交`);
      } else {
        toast.info('已载入失败任务参数，请修改后重新生成；系统会创建新任务，不会覆盖原任务');
      }
      requestAnimationFrame(() => videoPromptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    } catch (error) {
      toast.error(error instanceof Error ? `任务详情加载失败：${error.message}` : '任务详情加载失败，请刷新后重试');
    } finally {
      setEditingFailedJobId(null);
    }
  };

  const handleGenerateVideo = async () => {
    if (isVideoGenerateLocked()) return false;
    setGenerationError(null);
    if (!videoPrompt.trim()) { reportGenerationError('请输入视频描述', 'prompt'); return false; }
    if (referenceMode === 'first-last' && !firstFrame) { reportGenerationError('请选择首帧图片', 'references'); return false; }
    if (generationReferenceViolation) { reportGenerationError(generationReferenceViolation, 'references'); return false; }
    if (selectedRealPortraitActor && !videoCapability.supportsRealPortrait) {
      reportGenerationError(`${videoCapability.label} 的真人演员功能正在适配中`);
      return false;
    }
    if (selectedRealPortraitActor && referenceMode !== 'general') { reportGenerationError('真人演员仅支持全能参考模式'); return false; }
    if (selectedRealPortraitActor && selectedReferenceAssets.filter(asset => asset.type === 'image').length >= videoCapability.references.maxImages) {
      reportGenerationError(`选择真人演员后，普通参考图片最多 ${Math.max(0, videoCapability.references.maxImages - 1)} 张`);
      return false;
    }

    return runVideoGenerate(async () => {
      try {
        const latestConsumptionSettings = await refreshConsumptionBeforeGenerate();
        if (!latestConsumptionSettings) { reportGenerationError('积分消耗配置刷新失败，请稍后重试'); return false; }
        const latestCapability = getVideoModelCapability(latestConsumptionSettings, videoModel);
        const latestAvailableCombinations = getAvailableVideoConsumptionCombinations(
          latestConsumptionSettings,
          videoModel,
          latestCapability,
        );
        const latestConfiguration = reconcileVideoConfiguration(latestCapability, {
          mode: referenceMode,
          aspectRatio,
          resolution,
          duration,
        });
        const latestCombinationAvailable = latestAvailableCombinations.some(combination => (
          combination.duration === duration && combination.resolution === resolution
        ));
        if (!latestCapability.available || !latestCombinationAvailable || latestConfiguration.adjusted.length > 0) {
          reportGenerationError('模型能力配置已更新，请重新选择模型或参数后重试');
          return false;
        }
        const latestFrameViolation = getFrameCapabilityViolation(videoModel, referenceMode, firstFrame);
        if (latestFrameViolation) {
          reportGenerationError(latestFrameViolation);
          return false;
        }
        const latestReferenceViolation = referenceMode === 'general'
          ? getReferenceCapabilityViolation(selectedReferenceAssets, latestCapability)
          : null;
        if (latestReferenceViolation) {
          reportGenerationError(`模型能力配置已更新：${latestReferenceViolation}`);
          return false;
        }

        const currentVideoCreditPerItem = getVideoConsumptionCredits(
          latestConsumptionSettings,
          videoModel,
          duration,
          resolution,
          hasReferenceVideo,
        );
        if (currentVideoCreditPerItem <= 0) {
          reportGenerationError('当前模型或配置暂不开放，请调整参数后重试');
          return false;
        }

        const modelLabel = VIDEO_MODEL_LABELS[videoModel];
        const generationReferenceAssets = prepareVideoReferenceAssets();
        const prompt = videoPrompt.trim();
        const currentTkPromptConfig: TkPromptVideoConfig = {
          model: videoModel as TkPromptVideoConfig['model'],
          aspectRatio: aspectRatio as TkPromptVideoConfig['aspectRatio'],
          resolution,
          durationSeconds: Number(duration) as TkPromptVideoConfig['durationSeconds'],
        };
        const tkPromptSource = appliedTkPrompt
          ? {
              ...appliedTkPrompt.source,
              editBucket: mergePromptEditBuckets(
                appliedTkPrompt.source.editBucket,
                mergePromptEditBuckets(
                  getPromptEditBucket(appliedTkPrompt.prompt, prompt),
                  tkPromptVideoConfigEquals(appliedTkPrompt.videoConfig, currentTkPromptConfig)
                    ? 'none'
                    : 'material',
                ),
              ),
            }
          : undefined;
        const requests: GenerationReserveRequest[] = Array.from({ length: quantity }, () => ({
          kind: 'video',
          model: modelLabel,
          prompt,
          config: {
            mode: referenceMode,
            aspectRatio,
            resolution,
            durationSeconds: Number(duration) as ConsumptionVideoDurationSeconds,
            generateAudio: latestCapability.generateAudio,
          },
          references: generationReferenceAssets.map(asset => ({
            assetId: asset.id,
            role: asset.role ?? (asset.type === 'image'
              ? 'reference_image'
              : asset.type === 'video'
                ? 'reference_video'
                : 'reference_audio'),
          })),
          ...(tkPromptSource ? { tkPromptSource } : {}),
          ...(selectedRealPortraitActor ? {
            realPortrait: {
              actorId: selectedRealPortraitActor.id,
              ...(selectedRealPortraitAsset ? { portraitAssetId: selectedRealPortraitAsset.id } : {}),
            },
          } : {}),
        }));
        const reserveResult = await onGenerationReserve(requests);

        if (!reserveResult.ok) {
          reportGenerationError(reserveResult.message);
          return false;
        }

        return true;
      } catch (error) {
        reportGenerationError(error instanceof Error ? error.message : '生成任务提交失败');
        return false;
      }
    });
  };

  const prepareVideoReferenceAssets = () => {
    if (referenceMode === 'general') return selectedReferenceAssets.map(asset => ({
      ...asset,
      role: asset.type === 'image'
        ? 'reference_image' as const
        : asset.type === 'video'
          ? 'reference_video' as const
          : 'reference_audio' as const,
    }));

    return [
      firstFrame ? { ...firstFrame, role: 'first_frame' as const } : null,
      lastFrame ? { ...lastFrame, role: 'last_frame' as const } : null,
    ].filter(Boolean) as AssetReferenceAsset[];
  };

  return (
    <div className="min-w-0">
      <div className="space-y-5">
        <motion.div key="video" initial={false} animate={{ opacity: 1 }}
              className="grid min-w-0 grid-cols-1 gap-5">

              {/* 创作表单 */}
              <div className="space-y-4" data-testid="ai-studio-video-composer">

                {/* Upload */}
                <Card ref={referenceSectionRef} variant="raised" accent="violet" className="p-5" data-testid="ai-studio-video-reference-card" aria-invalid={generationError?.field === 'references' || undefined}>
                  {generationError?.field === 'references' && <p role="alert" className="product-field-error mb-3">{generationError.message}</p>}
                  <label className="flex items-center gap-2 text-sm text-white mb-3">
                    <Upload className="w-4 h-4 text-purple-400" />
                    {referenceMode === 'first-last' ? '首尾帧图片' : '参考素材'}
                  </label>
                  {referenceRestoreWarning && (
                    <p className="mb-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-xs leading-5 text-amber-200" role="alert">
                      参数已恢复，但{referenceRestoreWarning}
                    </p>
                  )}
                  <AnimatePresence mode="wait">
                    {referenceMode === 'first-last' ? (
                      <motion.div key="first-last-assets" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="grid grid-cols-2 gap-3">
                        {([
                          ['first-frame', '首帧图片', firstFrame, false],
                          ['last-frame', '尾帧图片', lastFrame, true],
                        ] as const).map(([slot, label, val, optional]) => {
                          const badgeLabel = getFrameBadgeLabel(slot);

                          return (
                            <div key={label}>
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <p className="text-xs text-gray-400">
                                  {label}
                                  {optional && <span className="text-gray-600 ml-1">（可选）</span>}
                                </p>
                              </div>
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => openFrameAssetPicker(slot)}
                                  className={`relative flex h-32 w-full flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-all group ${
                                    val ? 'border-purple-500/50 bg-purple-500/5 p-3 text-left hover:border-purple-400/60' : 'border-white/15 hover:border-purple-500/40 hover:bg-white/5'
                                  }`}
                                  aria-label={`${val ? '重新选择' : '选择'}${label}`}
                                >
                                  {val ? (
                                    <div className="flex h-full w-full items-center gap-3">
                                      <div className="relative h-full aspect-[3/4] shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                                        <img src={val.thumbnail} className="h-full w-full object-cover" alt={label} />
                                        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-md bg-pink-600/90 px-1.5 py-0.5 text-[10px] text-white">
                                          <ImageIcon className="h-2.5 w-2.5" />
                                          {badgeLabel}
                                        </div>
                                      </div>
                                      <div className="min-w-0 flex-1 pr-8">
                                        <p className="truncate text-xs font-medium text-white">{val.name}</p>
                                        <p className="mt-1 text-[11px] text-gray-500">点击重新选择</p>
                                      </div>
                                      <div className="product-media-surface pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 product-preview-action transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                                        <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">重新选择</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="text-center">
                                      <div className="w-8 h-8 rounded-lg bg-white/10 group-hover:bg-purple-500/20 flex items-center justify-center mx-auto transition-colors">
                                        <Plus className="w-4 h-4 text-gray-400 group-hover:text-purple-400 transition-colors" />
                                      </div>
                                      <p className="text-xs text-gray-500 mt-2">从数字资产选择</p>
                                    </div>
                                  )}
                                </button>
                                {val && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      clearFrameAsset(slot);
                                    }}
                                    className="product-media-surface absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/55 border border-white/15 backdrop-blur-sm flex items-center justify-center text-white/80 hover:bg-red-500/80 hover:border-red-300/50 hover:text-white transition-all"
                                    aria-label={`清除${label}`}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {frameCapabilityViolation && (
                          <p className="col-span-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-200" role="alert">
                            已保留首帧；当前模型需要调整：{frameCapabilityViolation}
                          </p>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div
                        key="general-upload"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={openAssetPicker}
                        role={selectedReferenceAssets.length ? undefined : 'button'}
                        tabIndex={selectedReferenceAssets.length ? undefined : 0}
                        aria-label={selectedReferenceAssets.length ? undefined : '选择参考素材'}
                        onKeyDown={event => {
                          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                            event.preventDefault();
                            openAssetPicker();
                          }
                        }}
                        className={`w-full rounded-xl border-2 border-dashed transition-all group ${
                          selectedReferenceAssets.length
                            ? 'cursor-pointer border-purple-500/35 bg-purple-500/5 p-3 text-left hover:border-purple-400/50'
                            : 'cursor-pointer flex flex-col items-center justify-center gap-3 py-8 border-white/15 hover:border-purple-500/40 hover:bg-white/5'
                        }`}
                      >
                        {selectedReferenceAssets.length ? (
                          <>
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <div>
                                <p className="text-sm font-medium text-white">{getReferenceSummary(selectedReferenceAssets)}</p>
                                <p className="text-xs text-gray-500 mt-0.5">点击可重新选择参考素材</p>
                                <p className="mt-0.5 text-[11px] text-gray-600">
                                  共 {selectedReferenceAssets.length}/{videoCapability.references.maxTotal} 个
                                  {getReferenceDurationSummary(selectedReferenceAssets) ? ` · ${getReferenceDurationSummary(selectedReferenceAssets)}` : ''}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={openAssetPicker}
                                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-purple-500/20 flex items-center justify-center transition-colors"
                                aria-label="重新选择参考素材"
                              >
                                <Plus className="w-4 h-4 text-gray-400 group-hover:text-purple-400 transition-colors" />
                              </button>
                            </div>
                            {referenceCapabilityViolation && (
                              <p className="mb-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-200">
                                已保留全部素材；当前模型需要调整：{referenceCapabilityViolation}
                              </p>
                            )}
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                              {visibleReferenceAssets.map((asset, index) => (
                                <div key={asset.id} className="group relative aspect-[3/4] rounded-lg overflow-hidden bg-black/30 border border-white/10">
                                  <AssetThumbnail asset={asset} className="h-full w-full" iconClassName="h-6 w-6 opacity-80" />
                                  <div className={`absolute top-1.5 left-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-white ${asset.type === 'video' ? 'bg-purple-600/90' : asset.type === 'audio' ? 'bg-cyan-600/90' : 'bg-pink-600/90'}`}>
                                    {asset.type === 'video' ? <Video className="h-2.5 w-2.5" /> : asset.type === 'audio' ? <Music2 className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
                                    {getReferenceAssetLabel(selectedReferenceAssets, index)}
                                  </div>
                                  <button
                                    type="button"
                                    aria-label={`删除${getReferenceAssetLabel(selectedReferenceAssets, index)}`}
                                    onClick={(event) => handleReferenceAssetRemove(event, index)}
                                    className="product-media-surface absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/55 border border-white/15 backdrop-blur-sm flex items-center justify-center text-white/80 product-preview-action group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-red-500/80 hover:border-red-300/50 hover:text-white transition-all"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                            {selectedReferenceAssets.length > 10 && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setReferenceAssetsExpanded(current => !current);
                                }}
                                className="mt-3 w-full rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-medium text-violet-300 hover:bg-white/[0.06]"
                              >
                                {referenceAssetsExpanded ? '收起素材' : `展开其余 ${selectedReferenceAssets.length - 10} 个素材`}
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="w-9 h-9 rounded-xl bg-white/10 group-hover:bg-purple-500/20 flex items-center justify-center transition-colors">
                              <Plus className="w-5 h-5 text-gray-400 group-hover:text-purple-400 transition-colors" />
                            </div>
                            <div className="text-center">
                              <p className="text-sm font-medium text-white">图片 / 视频 / 音频</p>
                              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                                最多{videoCapability.references.maxImages}张图片 / 最多{videoCapability.references.maxVideos}个视频（总时长≤{videoCapability.references.maxVideoDurationSeconds}s） / 最多{videoCapability.references.maxAudios}个音频（总时长≤{videoCapability.references.maxAudioDurationSeconds}s）
                              </p>
                              {videoCapability.references.allowAudioOnly && (
                                <p className="mt-1 text-[11px] text-emerald-300">支持仅使用音频作为参考</p>
                              )}
                            </div>
                          </>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>

                {/* Prompt and compact generation controls */}
                <Card variant="raised" accent="blue" className="p-5" style={{ overflow: 'visible' }} data-testid="ai-studio-video-prompt-card">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm text-white">
                      <Wand2 className="h-4 w-4 text-purple-400" />视频描述
                    </label>
                    {referenceMode === 'general' && !videoCapability.supportsPromptWizard && (
                      <button
                        type="button"
                        disabled
                        title={`${videoCapability.label} 的 AI 提示词正在适配中`}
                        className="inline-flex h-10 flex-shrink-0 cursor-not-allowed items-center gap-2 whitespace-nowrap rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-gray-500"
                      >
                        <Sparkles className="h-4 w-4" />
                        <span>AI 提示词适配中</span>
                      </button>
                    )}
                    {referenceMode === 'general' && tkPromptEngineAvailableForModel && (
                      <button
                        type="button"
                        onClick={openPromptWizard}
                        className="inline-flex h-10 flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-[#7c3aed] px-4 text-sm font-semibold text-white transition-[filter,transform] duration-120 hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f1e]"
                      >
                        <Sparkles className="h-4 w-4" />
                        <span>AI 帮我写提示词</span>
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <textarea
                      aria-label="视频描述"
                      ref={videoPromptRef}
                      aria-invalid={generationError?.field === 'prompt' || undefined}
                      aria-describedby={generationError?.field === 'prompt' ? 'video-prompt-error' : undefined}
                      value={videoPrompt}
                      onChange={event => { setGenerationError(current => current?.field === 'prompt' ? null : current); handleVideoPromptChange(event); }}
                      onKeyDown={handleVideoPromptKeyDown}
                      onKeyUp={handleVideoPromptKeyUp}
                      onClick={handleVideoPromptCursorChange}
                      onFocus={handleVideoPromptCursorChange}
                      onSelect={handleVideoPromptCursorChange}
                      onScroll={handleVideoPromptCursorChange}
                      onBlur={closeReferenceMenu}
                      placeholder="详细描述你想生成的视频内容、场景、风格..."
                      rows={8}
                      className="w-full resize-none rounded-xl border border-white/10 bg-white/5 p-3 text-sm leading-5 text-white placeholder-gray-500 transition-colors focus:border-purple-500/50 focus:outline-none"
                    />
                    <AnimatePresence>
                      {shouldShowReferenceMenu && (
                        <AIStudioMentionMenu
                          groups={( ['image', 'video', 'audio'] as const).map(type => ({
                            id: type,
                            label: getReferenceTypeLabel(type),
                            options: referenceMentionOptions
                              .filter(option => option.asset.type === type)
                              .map(option => ({
                                id: option.asset.id,
                                label: option.label,
                                description: option.asset.name,
                                leading: <AssetThumbnail asset={option.asset} className="h-10 w-10 rounded-lg bg-white/5" iconClassName="h-5 w-5 opacity-80" />,
                              })),
                          }))}
                          activeIndex={referenceMenuActiveIndex}
                          position={referenceMenuPosition}
                          accent="violet"
                          testId="reference-mention-menu"
                          ariaLabel="插入参考素材"
                          emptyMessage="没有匹配的参考素材"
                          onActiveIndexChange={setReferenceMenuActiveIndex}
                          onSelect={(activeIndex) => {
                            const option = referenceMentionOptions[activeIndex];
                            if (option) insertReferenceToken(option.index);
                          }}
                        />
                      )}
                    </AnimatePresence>
                  </div>
                  {generationError && generationError.field !== 'references' && <p id="video-prompt-error" role="alert" className="product-field-error mt-3">{generationError.message}</p>}
                  <AIStudioVideoControls
                    referenceMode={referenceMode}
                    videoModel={videoModel}
                    aspectRatio={aspectRatio}
                    resolution={resolution}
                    duration={duration}
                    quantity={quantity}
                    models={videoModels}
                    capability={videoCapability}
                    availableCombinations={availableVideoCombinations}
                    videoTotalCredits={videoTotalCredits}
                    availableCredits={availableCredits}
                    configAvailable={videoConfigAvailable}
                    generateBlockReason={generationReferenceViolation}
                    generateStatus={videoGenerateStatus}
                    onReferenceModeChange={handleReferenceModeChange}
                    onModelChange={handleModelChange}
                    onAspectRatioChange={handleAspectRatioChange}
                    onResolutionChange={handleResolutionChange}
                    onDurationChange={handleDurationChange}
                    onQuantityChange={setQuantity}
                    realPortraitActors={usableRealPortraitActors}
                    realPortraitsLoading={realPortraitsLoading}
                    selectedRealPortraitActor={selectedRealPortraitActor}
                    realPortraitAssets={usableRealPortraitAssets}
                    selectedRealPortraitAssetId={selectedRealPortraitAssetId}
                    onRealPortraitSelection={handleRealPortraitSelection}
                    onRealPortraitLibraryOpen={onRealPortraitLibraryOpen}
                    onGenerate={handleGenerateVideo}
                    onCreditsRecharge={onCreditsRecharge}
                    onMenuOpen={closeReferenceMenu}
                  />
                </Card>

              </div>

              <AIStudioResults
                kind="video"
                items={videoQueue}
                pagination={generationPagination}
                loading={generationPageLoading}
                onNavigate={onGenerationPageNavigate}
                onPreview={handleQueuePreview}
                onDownload={handleQueueDownload}
                onEditFailed={handleFailedJobEdit}
                editingFailedJobId={editingFailedJobId}
              />
        </motion.div>
      </div>

      <AnimatePresence>
        {wizardOpen && tkPromptEngineAvailableForModel && (
          <PromptWizard
            images={wizardImages}
            initialConfig={{
              model: videoModel as TkPromptVideoConfig['model'],
              aspectRatio: aspectRatio as TkPromptVideoConfig['aspectRatio'],
              resolution,
              durationSeconds: Number(duration) as TkPromptVideoConfig['durationSeconds'],
            }}
            hasReferenceVideo={selectedReferenceAssets.some(asset => asset.type === 'video')}
            consumptionSettings={consumptionSettings}
            availableCredits={availableCredits}
            onPickImages={() => setAssetPickerTarget('wizard-images')}
            onRemoveImage={(assetId) => setWizardImages(current => current.filter(image => image.id !== assetId))}
            onConsumptionSettingsRefresh={onConsumptionSettingsRefresh}
            onCreditsChanged={onPromptWizardCreditsChanged}
            onClose={() => setWizardOpen(false)}
            onApply={applyTkPromptDraft}
          />
        )}
        {assetPickerOpen && (
          <AssetPickerModal
            assets={assets}
            folders={folders}
            assetSummary={assetSummary}
            pagination={assetPagination}
            pageLoading={assetPageLoading}
            pageError={assetPageError}
            defaultCategory="uploaded-image"
            mode={assetPickerTarget === 'general' || assetPickerTarget === 'wizard-images' ? 'multi' : 'single'}
            accept={assetPickerTarget === 'general' ? 'all' : 'image'}
            showAllCategory={false}
            enableFolders
            initialSelectedAssets={assetPickerInitialSelectedAssets}
            selectionRules={assetPickerTarget === 'general' ? {
              maxTotal: Math.max(0, videoCapability.references.maxTotal - (selectedRealPortraitActor ? 1 : 0)),
              maxImages: Math.max(0, videoCapability.references.maxImages - (selectedRealPortraitActor ? 1 : 0)),
              maxVideos: videoCapability.references.maxVideos,
              maxAudios: videoCapability.references.maxAudios,
              minSingleVideoDurationSeconds: 2,
              maxSingleVideoDurationSeconds: videoCapability.references.maxVideoDurationSeconds + REFERENCE_MEDIA_DURATION_TOLERANCE_SECONDS,
              maxVideoDurationSeconds: videoCapability.references.maxVideoDurationSeconds + REFERENCE_MEDIA_DURATION_TOLERANCE_SECONDS,
              videoMaxDurationLabel: `${videoCapability.references.maxVideoDurationSeconds}s`,
              minSingleAudioDurationSeconds: 2,
              maxSingleAudioDurationSeconds: videoCapability.references.maxAudioDurationSeconds + REFERENCE_MEDIA_DURATION_TOLERANCE_SECONDS,
              maxAudioDurationSeconds: videoCapability.references.maxAudioDurationSeconds + REFERENCE_MEDIA_DURATION_TOLERANCE_SECONDS,
              audioMaxDurationLabel: `${videoCapability.references.maxAudioDurationSeconds}s`,
              maxAudioSizeBytes: 15 * 1024 * 1024,
              requireVisualWithAudio: !videoCapability.references.allowAudioOnly,
            } : assetPickerTarget === 'wizard-images'
              ? { maxImages: 9, maxVideos: 0, maxAudios: 0 }
              : getFrameAssetSelectionRules(videoModel)}
            uploadAccept={assetPickerTarget === 'general' ? 'all' : 'image'}
            onUploadFile={onUploadFile}
            onAssetsPrepare={onAssetsPrepare}
            onAssetFiltersChange={onAssetFiltersChange}
            onAssetPageNavigate={onAssetPageNavigate}
            onAssetDetailLoad={onAssetDetailLoad}
            onAssetDelete={onAssetDelete}
            onClose={() => setAssetPickerTarget(null)}
            onConfirm={handleReferenceAssetsConfirm}
          />
        )}
        {previewAsset && (
          <AssetPreviewModal
            key={`queue-preview-${previewAsset.id}`}
            asset={previewAsset}
            mode="readonly"
            rootFolderId={previewAsset.folderId}
            onClose={() => setPreviewAsset(null)}
            onDownload={onAssetDownload}
            onReuseGenerate={handleQueueReuseGenerate}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
