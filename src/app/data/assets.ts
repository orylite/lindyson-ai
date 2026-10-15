export type AssetSource = 'ai-video' | 'ai-image' | 'uploaded-video' | 'uploaded-image' | 'uploaded-audio';
export type AssetSort = 'created-desc' | 'created-asc';

export type AssetGenerationMode = 'general' | 'first-last';
export type AssetAspectRatio = '9:16' | '16:9' | 'adaptive';
export type AssetReferenceRole = 'reference_image' | 'reference_video' | 'reference_audio' | 'first_frame' | 'last_frame';

export interface AssetReferenceImage {
  id: string;
  name: string;
  thumbnail: string;
  publicUrl?: string;
  thumbnailUrl?: string;
  role?: AssetReferenceRole;
}

export interface AssetReferenceAsset extends AssetReferenceImage {
  type: 'image' | 'video' | 'audio';
  duration?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  width?: number;
  height?: number;
  mediaExtension?: string;
}

interface AssetGenerationBase {
  model: string;
  prompt: string;
  referenceImages: AssetReferenceImage[];
  referenceAssets?: AssetReferenceAsset[];
  credits?: number;
}

export interface VideoAssetGenerationMeta extends AssetGenerationBase {
  kind: 'video';
  mode: AssetGenerationMode;
  aspectRatio: AssetAspectRatio;
  resolution: string;
  duration: string;
  generateAudio?: boolean;
  outputFormat?: 'mp4' | 'mov';
}

export interface ImageAssetGenerationMeta extends AssetGenerationBase {
  kind: 'image';
  outputSize: string;
  ratio: string;
  resolution?: '1K' | '2K';
  optimizePromptMode?: 'standard' | 'fast';
  annotations?: import('./admin').ImageGenerationAnnotation[];
}

export type AssetGenerationMeta = VideoAssetGenerationMeta | ImageAssetGenerationMeta;

export interface Asset {
  id: string;
  name: string;
  type: 'video' | 'image' | 'audio';
  source: AssetSource;
  folderId: string | null;
  size: string;
  sizeBytes?: number;
  duration?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  dimensions?: string;
  createdAt: string;
  updatedAt: string;
  downloadedAt?: string;
  downloadRequestedAt?: string;
  thumbnail: string;
  publicUrl?: string;
  thumbnailUrl?: string;
  mediaExtension?: string;
  views: number;
  generation?: AssetGenerationMeta;
}

export interface AssetFolder {
  id: string;
  name: string;
  source: AssetSource;
  isSystem?: boolean;
  createdAt: string;
}

export interface AssetLibraryState {
  assets: Asset[];
  folders: AssetFolder[];
}

export interface AssetSummary {
  total: number;
  byType: Record<Asset['type'], number>;
  bySource: Record<AssetSource, number>;
  downloaded: number;
  notDownloaded: number;
  folderCounts: Array<{ folderId: string | null; count: number }>;
}

export const CATEGORY_LABELS: Record<AssetCategory, string> = {
  'all':            '全部',
  'ai-video':       'AI视频',
  'ai-image':       'AI图片',
  'uploaded-video': '已上传视频',
  'uploaded-image': '已上传图片',
  'uploaded-audio': '已上传音频',
};

export const SOURCE_LABELS: Record<AssetSource, string> = {
  'ai-video': 'AI视频',
  'ai-image': 'AI图片',
  'uploaded-video': '已上传视频',
  'uploaded-image': '已上传图片',
  'uploaded-audio': '已上传音频',
};

export type AssetCategory = 'all' | 'ai-video' | 'ai-image' | 'uploaded-video' | 'uploaded-image' | 'uploaded-audio';

export function listFolders(state: AssetLibraryState, source?: AssetSource) {
  return source ? state.folders.filter(folder => folder.source === source) : state.folders;
}
