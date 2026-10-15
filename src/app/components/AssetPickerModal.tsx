import { Check,ChevronLeft,FolderOpen,Image as ImageIcon,Loader2,Music2,Pause,Play,Search,Trash2,Upload,Video,X } from 'lucide-react';
import { AnimatePresence,motion } from 'motion/react';
import { useEffect,useMemo,useRef,useState } from 'react';
import { toast } from 'sonner';
import type { UploadProgressEvent } from '../api/assetUpload';
import type { ExactCursorPagination as CursorPaginationState,PagePosition } from '../api/cursor';
import { CATEGORY_LABELS,type Asset,type AssetCategory,type AssetFolder,type AssetSource,type AssetSummary } from '../data/assets';
import { AssetThumbnail,Button,Card,Dialog } from '../ui';
import { AssetUploadPanel,type AssetUploadAccept } from './AssetUploadPanel';
import { CursorPagination } from './CursorPagination';
import { PaginationFooter } from './PaginationFooter';

export interface AssetPickerSelectionRules {
  maxTotal?: number;
  maxImages?: number;
  maxVideos?: number;
  maxAudios?: number;
  allowMixedTypes?: boolean;
  maxVideoDurationSeconds?: number;
  videoMaxDurationLabel?: string;
  minSingleVideoDurationSeconds?: number;
  maxSingleVideoDurationSeconds?: number;
  maxAudioDurationSeconds?: number;
  audioMaxDurationLabel?: string;
  minSingleAudioDurationSeconds?: number;
  maxSingleAudioDurationSeconds?: number;
  maxAudioSizeBytes?: number;
  requireVisualWithAudio?: boolean;
  image?: {
    supportedExtensions?: readonly string[];
    requireFileSize?: boolean;
    maxSizeBytes?: number;
    requireDimensions?: boolean;
    minDimensionExclusive?: number;
    maxPixels?: number;
    minAspectRatio?: number;
    maxAspectRatio?: number;
  };
}

interface Props {
  assets?: Asset[];
  folders?: AssetFolder[];
  assetSummary?: AssetSummary;
  pagination?: CursorPaginationState;
  pageLoading?: boolean;
  pageError?: unknown;
  defaultCategory?: AssetCategory;
  /** 'single' = pick one, 'multi' = pick many */
  mode?: 'single' | 'multi';
  /** only allow certain types */
  accept?: 'all' | 'visual' | 'video' | 'image' | 'audio';
  /** hide the all-category tab for flows that require a concrete asset source */
  showAllCategory?: boolean;
  /** show one-level folders before assets in source categories */
  enableFolders?: boolean;
  /** 保留完整已选卡片，不依赖当前页反查，因此可跨来源和跨页重开。 */
  initialSelectedAssets?: Asset[];
  selectionRules?: AssetPickerSelectionRules;
  uploadAccept?: AssetUploadAccept;
  onUploadFile?: (file: File, folderId: string | null, onProgress?: (event: UploadProgressEvent) => void) => Promise<Asset>;
  onAssetsPrepare?: () => void;
  onAssetFiltersChange?: (filters: { source?: AssetSource; folderId?: string | null; search?: string }) => void;
  onAssetPageNavigate?: (position: PagePosition) => void;
  onAssetPageRetry?: () => void;
  onAssetDetailLoad?: (assetId: string) => Promise<Asset>;
  onAssetDelete?: (assetId: string) => Promise<void>;
  onClose: () => void;
  onConfirm: (assets: Asset[]) => void;
}

const CATEGORIES: AssetCategory[] = ['all', 'ai-video', 'ai-image', 'uploaded-video', 'uploaded-image', 'uploaded-audio'];
const SOURCE_CATEGORIES = CATEGORIES.filter(category => category !== 'all');
const IMAGE_CATEGORIES: AssetCategory[] = ['ai-image', 'uploaded-image'];
const VIDEO_CATEGORIES: AssetCategory[] = ['ai-video', 'uploaded-video'];
const AUDIO_CATEGORIES: AssetCategory[] = ['uploaded-audio'];
const SOURCE_TYPE: Record<AssetSource, Asset['type']> = {
  'ai-video': 'video',
  'ai-image': 'image',
  'uploaded-video': 'video',
  'uploaded-image': 'image',
  'uploaded-audio': 'audio',
};

function getVisibleCategories(accept: Props['accept'], showAllCategory: boolean) {
  if (accept === 'image') return IMAGE_CATEGORIES;
  if (accept === 'video') return VIDEO_CATEGORIES;
  if (accept === 'audio') return AUDIO_CATEGORIES;
  if (accept === 'visual') return CATEGORIES.filter(category => category !== 'all' && category !== 'uploaded-audio');
  return showAllCategory ? CATEGORIES : SOURCE_CATEGORIES;
}

type PickerGridItem =
  | { kind: 'back' }
  | { kind: 'folder'; folder: AssetFolder; count: number }
  | { kind: 'asset'; asset: Asset };

const pickerCardClass = 'relative group aspect-[9/16] rounded-xl overflow-hidden transition-all';

export function isRootAsset(asset: Asset, systemFolderIds: ReadonlySet<string>) {
  return !asset.folderId || systemFolderIds.has(asset.folderId);
}

export function resolveAssetPickerCardFilters(input: {
  category: AssetCategory;
  folders: AssetFolder[];
  enableFolders: boolean;
  activeFolderId: string | null;
  search: string;
}): { source?: AssetSource; folderId?: string | null; search?: string } | null {
  const source = input.category === 'all' ? undefined : input.category;
  const systemFolderId = source
    ? input.folders.find(folder => folder.source === source && folder.isSystem)?.id
    : undefined;
  if (input.enableFolders && source && !input.activeFolderId && !systemFolderId) return null;
  return {
    source,
    folderId: input.enableFolders ? input.activeFolderId ?? systemFolderId ?? null : undefined,
    search: input.search.trim() || undefined,
  };
}

export async function resolveAudioPreviewUrl(
  asset: Asset,
  loadDetail: (assetId: string) => Promise<Asset>,
) {
  if (asset.publicUrl) return asset.publicUrl;
  const detail = await loadDetail(asset.id);
  if (detail.id !== asset.id || detail.type !== 'audio' || !detail.publicUrl) {
    throw new Error('音频试听地址不可用');
  }
  return detail.publicUrl;
}

export function AssetPickerModal({
  assets = [],
  folders = [],
  assetSummary,
  pagination,
  pageLoading = false,
  pageError,
  defaultCategory = 'all',
  mode = 'single',
  accept = 'all',
  showAllCategory = true,
  enableFolders = false,
  initialSelectedAssets = [],
  selectionRules,
  uploadAccept,
  onUploadFile,
  onAssetsPrepare,
  onAssetFiltersChange,
  onAssetPageNavigate,
  onAssetPageRetry,
  onAssetDetailLoad,
  onAssetDelete,
  onClose,
  onConfirm,
}: Props) {
  const visibleCategories = getVisibleCategories(accept, showAllCategory);
  const initialCategory = visibleCategories.includes(defaultCategory) ? defaultCategory : visibleCategories[0] ?? 'all';
  const [category, setCategory] = useState<AssetCategory>(initialCategory);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedById, setSelectedById] = useState<Map<string, Asset>>(
    () => new Map(initialSelectedAssets.map(asset => [asset.id, asset])),
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelectedAssets.map(asset => asset.id)),
  );
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const [audioPreviewUrls, setAudioPreviewUrls] = useState<Record<string, string>>({});
  const [deletingAudioId, setDeletingAudioId] = useState<string | null>(null);
  const [pendingAudioDelete, setPendingAudioDelete] = useState<Asset | null>(null);
  const audioRequestSequenceRef = useRef(0);

  const sourceCategory = category === 'all' ? null : category as AssetSource;
  const query = debouncedSearch.toLowerCase();
  const selectedAssets = useMemo(() => [...selectedById.values()], [selectedById]);
  const acceptsAsset = (asset: Asset) => {
    if (accept === 'video') return asset.type === 'video';
    if (accept === 'image') return asset.type === 'image';
    if (accept === 'audio') return asset.type === 'audio';
    if (accept === 'visual') return asset.type !== 'audio';
    return true;
  };
  const acceptsSource = (source: AssetSource) => accept === 'all'
    || (accept === 'visual' ? SOURCE_TYPE[source] !== 'audio' : SOURCE_TYPE[source] === accept);
  const getFolderAssetCount = (folderId: string) => assetSummary?.folderCounts.find(item => item.folderId === folderId)?.count ?? 0;
  const systemFolderIds = useMemo(
    () => new Set(folders.filter(folder => folder.isSystem).map(folder => folder.id)),
    [folders],
  );

  const handleCategoryChange = (nextCategory: AssetCategory) => {
    setCategory(nextCategory);
    setActiveFolderId(null);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => onAssetsPrepare?.(), [onAssetsPrepare]);

  useEffect(() => {
    if (!onAssetFiltersChange) return;
    const filters = resolveAssetPickerCardFilters({
      category,
      folders,
      enableFolders,
      activeFolderId,
      search: debouncedSearch,
    });
    if (filters) onAssetFiltersChange(filters);
  }, [activeFolderId, category, debouncedSearch, enableFolders, folders, onAssetFiltersChange]);

  const toggleAudioPreview = async (asset: Asset) => {
    const requestSequence = ++audioRequestSequenceRef.current;
    if (playingAudioId === asset.id) {
      setPlayingAudioId(null);
      setLoadingAudioId(null);
      return;
    }

    const cachedUrl = audioPreviewUrls[asset.id] ?? asset.publicUrl;
    if (cachedUrl) {
      setPlayingAudioId(asset.id);
      return;
    }
    if (!onAssetDetailLoad) return;

    setPlayingAudioId(null);
    setLoadingAudioId(asset.id);
    try {
      const url = await resolveAudioPreviewUrl(asset, onAssetDetailLoad);
      if (audioRequestSequenceRef.current !== requestSequence) return;
      setAudioPreviewUrls(current => ({ ...current, [asset.id]: url }));
      setPlayingAudioId(asset.id);
    } catch (error) {
      if (audioRequestSequenceRef.current === requestSequence) {
        toast.error(error instanceof Error ? error.message : '音频试听加载失败');
      }
    } finally {
      if (audioRequestSequenceRef.current === requestSequence) setLoadingAudioId(null);
    }
  };

  const filtered = enableFolders && activeFolderId
    ? assets.filter(asset => {
        const matchFolder = asset.folderId === activeFolderId;
        const matchSearch = !query || asset.name.toLowerCase().includes(query);
        return matchFolder && matchSearch && acceptsAsset(asset);
      })
    : assets.filter(asset => {
        const matchCategory = category === 'all' || asset.source === category;
        const matchSearch = !query || asset.name.toLowerCase().includes(query);
        return matchCategory && matchSearch;
      })
        .filter(acceptsAsset)
        .filter(asset => !enableFolders || isRootAsset(asset, systemFolderIds));

  const visibleFolders = enableFolders && sourceCategory && acceptsSource(sourceCategory)
    ? folders
        .filter(folder => !folder.isSystem && folder.source === sourceCategory)
        .filter(folder => !query || folder.name.toLowerCase().includes(query))
        .map(folder => ({ kind: 'folder' as const, folder, count: getFolderAssetCount(folder.id) }))
    : [];

  const gridItems: PickerGridItem[] = enableFolders
    ? activeFolderId
      ? [{ kind: 'back' }, ...filtered.map(asset => ({ kind: 'asset' as const, asset }))]
      : [...visibleFolders, ...filtered.map(asset => ({ kind: 'asset' as const, asset }))]
    : filtered.map(asset => ({ kind: 'asset' as const, asset }));

  const toggle = (asset: Asset) => {
    const id = asset.id;
    const intrinsicViolation = getAssetSelectionViolation(asset, selectionRules);
    if (intrinsicViolation) {
      toast.error(intrinsicViolation);
      return;
    }
    if (mode === 'single') {
      setSelected(new Set([id]));
      setSelectedById(new Map([[id, asset]]));
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
          setSelectedById(current => {
            const selectedItems = new Map(current);
            selectedItems.delete(id);
            return selectedItems;
          });
          return next;
        }

        const nextAssets = [...selectedAssets, asset];
        const violation = getSelectionViolation(nextAssets, selectionRules);
        if (violation) {
          toast.error(violation);
          return prev;
        }
        next.add(id);
        setSelectedById(current => new Map(current).set(id, asset));
        return next;
      });
    }
  };

  const handleConfirm = () => {
    const picked = [...selectedById.values()];
    const violation = getConfirmationViolation(picked, selectionRules);
    if (violation) {
      toast.error(violation);
      return;
    }
    onConfirm(picked);
  };

  const handleAudioDelete = async (asset: Asset) => {
    if (deletingAudioId || !onAssetDelete) return;
    try {
      setDeletingAudioId(asset.id);
      await onAssetDelete(asset.id);
      setSelected(previous => {
        const next = new Set(previous);
        next.delete(asset.id);
        return next;
      });
      setSelectedById(current => {
        const next = new Map(current);
        next.delete(asset.id);
        return next;
      });
      setPlayingAudioId(current => current === asset.id ? null : current);
      setPendingAudioDelete(null);
      toast.success('音频素材已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '音频素材删除失败');
    } finally {
      setDeletingAudioId(null);
    }
  };

  const canOpenUpload = Boolean(onUploadFile);
  const panelUploadAccept = uploadAccept ?? (accept === 'all' ? 'all' : accept);
  const selectedSummary = getSelectedSummary(selectedAssets);
  const confirmationViolation = getConfirmationViolation(selectedAssets, selectionRules);

  return (
    <Dialog onClose={onClose} titleId="asset-picker-title" panelClassName="max-w-4xl" zIndexClass="z-[110]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="relative w-full bg-[var(--product-surface-floating)] border border-white/10 rounded-2xl shadow-2xl flex flex-col"
        style={{ height: '80vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
          <h2 id="asset-picker-title" className="text-base font-semibold text-white">选择数字资产</h2>
          <div className="flex items-center gap-3">
            {canOpenUpload && (
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-sm text-gray-300 hover:text-white transition-all"
              >
                <Upload className="w-3.5 h-3.5" />上传素材
              </button>
            )}
            <button type="button" aria-label="关闭资产选择器" onClick={onClose} className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Category tabs + Search */}
        <div className="flex flex-shrink-0 flex-col gap-3 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
          <div role="tablist" aria-label="资产类型" className="flex max-w-full gap-1 overflow-x-auto pb-1 sm:pb-0">
            {visibleCategories.map(cat => (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={category === cat}
                tabIndex={category === cat ? 0 : -1}
                onClick={() => handleCategoryChange(cat)}
                onKeyDown={event => {
                  const currentIndex = visibleCategories.indexOf(cat);
                  const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                  if (!offset) return;
                  event.preventDefault();
                  const nextIndex = (currentIndex + offset + visibleCategories.length) % visibleCategories.length;
                  const nextCategory = visibleCategories[nextIndex];
                  if (!nextCategory) return;
                  handleCategoryChange(nextCategory);
                  const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                  tabs?.[nextIndex]?.focus();
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  category === cat
                    ? 'bg-purple-600 text-white'
                    : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                }`}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:ml-auto sm:w-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索资产..."
              aria-label="搜索资产"
              className="w-full rounded-xl border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 sm:w-52"
            />
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {pageError ? (
            <div role="alert" className="flex h-full flex-col items-center justify-center text-center text-gray-400">
              <FolderOpen className="mb-2 h-10 w-10 opacity-20" aria-hidden="true" />
              <p className="text-sm font-medium text-gray-300">素材加载失败</p>
              <p className="mt-1 text-xs text-gray-500">请检查网络后重新加载</p>
              {onAssetPageRetry && (
                <button
                  type="button"
                  disabled={pageLoading}
                  onClick={onAssetPageRetry}
                  className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
                >
                  {pageLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  重新加载素材
                </button>
              )}
            </div>
          ) : pageLoading && gridItems.length === 0 ? (
            <div role="status" aria-label="正在加载素材" className="flex h-full flex-col items-center justify-center text-gray-500">
              <Loader2 className="mb-2 h-7 w-7 animate-spin" aria-hidden="true" />
              <p className="text-sm">正在加载素材</p>
            </div>
          ) : gridItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <FolderOpen className="w-10 h-10 mb-2 opacity-20" />
              <p className="text-sm">暂无匹配资产</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6">
              {gridItems.map(item => {
                if (item.kind === 'back') {
                  return (
                    <button
                      key="back-to-root"
                      data-ui="asset-folder-card"
                      type="button"
                      onClick={() => setActiveFolderId(null)}
                      className={`${pickerCardClass} border border-purple-500/30 bg-white/5 hover:border-purple-400/60`}
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-[#201238] via-[#221b35] to-[#0f1b3d]" />
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(236,72,153,0.24),transparent_48%)]" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-600 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-900/30 group-hover:scale-105 transition-transform">
                          <ChevronLeft className="w-5 h-5 text-white" />
                        </div>
                        <p className="mt-3 text-xs font-semibold text-white">返回主目录</p>
                        <p className="mt-1 text-[10px] text-gray-400 truncate max-w-full">{CATEGORY_LABELS[category]} / 全部素材</p>
                      </div>
                    </button>
                  );
                }

                if (item.kind === 'folder') {
                  return (
                    <button
                      key={item.folder.id}
                      data-ui="asset-folder-card"
                      type="button"
                      onClick={() => setActiveFolderId(item.folder.id)}
                      className={`${pickerCardClass} border border-white/10 bg-white/5 hover:border-purple-500/40`}
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-purple-600/30 via-[#24203a] to-blue-600/20" />
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(168,85,247,0.28),transparent_48%)]" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shadow-lg shadow-purple-900/30 group-hover:scale-105 transition-transform">
                          <FolderOpen className="w-5 h-5 text-white" />
                        </div>
                        <p className="mt-3 text-xs font-semibold text-white line-clamp-2">{item.folder.name}</p>
                        <p className="mt-1 text-[10px] text-gray-400">{item.count} 个素材</p>
                      </div>
                    </button>
                  );
                }

                const asset = item.asset;
                const isSelected = selected.has(asset.id);
                const ruleViolation = !isSelected
                  ? getAssetSelectionViolation(asset, selectionRules) ?? getSelectionViolation(mode === 'single' ? [asset] : [...selectedAssets, asset], selectionRules)
                  : null;
                const disabledByRules = Boolean(ruleViolation);
                const isPlayingAudio = playingAudioId === asset.id;
                const audioPreviewUrl = audioPreviewUrls[asset.id] ?? asset.publicUrl;
                return (
                  <div
                    key={asset.id}
                    role="button"
                    tabIndex={disabledByRules ? -1 : 0}
                    aria-disabled={disabledByRules}
                    title={ruleViolation ?? asset.name}
                    onClick={() => { if (!disabledByRules) toggle(asset); }}
                    onKeyDown={(event) => {
                      if (!disabledByRules && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        toggle(asset);
                      }
                    }}
                    className={`${pickerCardClass} border-2 bg-black/30 ${
                      isSelected ? 'border-purple-500' : 'border-transparent hover:border-white/20'
                    } ${disabledByRules ? 'cursor-not-allowed opacity-40 grayscale' : ''}`}
                  >
                    {/* Thumbnail */}
                    <AssetThumbnail
                      asset={asset}
                      className="absolute inset-0 h-full w-full"
                      imageClassName="object-cover group-hover:scale-105 transition-transform duration-200"
                      iconClassName="h-7 w-7 opacity-80"
                    />

                    {/* Type badge */}
                    <div className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-0.5 ${
                      asset.type === 'video' ? 'bg-purple-600/80' : asset.type === 'audio' ? 'bg-cyan-600/80' : 'bg-pink-600/80'
                    } text-white`}>
                      {asset.type === 'video' ? <Video className="w-2.5 h-2.5" /> : asset.type === 'audio' ? <Music2 className="w-2.5 h-2.5" /> : <ImageIcon className="w-2.5 h-2.5" />}
                      {asset.duration ?? (asset.type === 'audio' ? '音频' : '图片')}
                    </div>

                    {asset.type === 'audio' && (onAssetDetailLoad || audioPreviewUrl) && !disabledByRules && (
                      <button
                        type="button"
                        aria-label={isPlayingAudio ? `暂停 ${asset.name}` : `试听 ${asset.name}`}
                        disabled={loadingAudioId === asset.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleAudioPreview(asset);
                        }}
                        className="product-media-surface absolute right-1.5 top-1.5 z-20 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white hover:bg-cyan-600/80 disabled:cursor-wait disabled:opacity-70"
                      >
                        {loadingAudioId === asset.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : isPlayingAudio ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    {asset.type === 'audio' && onAssetDelete && (
                      <button
                        type="button"
                        aria-label={`删除音频 ${asset.name}`}
                        disabled={deletingAudioId === asset.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPendingAudioDelete(asset);
                        }}
                        className="product-media-surface absolute bottom-7 right-1.5 z-20 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white opacity-0 transition-opacity hover:bg-red-600/80 disabled:cursor-wait disabled:opacity-50 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {isPlayingAudio && audioPreviewUrl && (
                      <audio
                        src={audioPreviewUrl}
                        autoPlay
                        className="hidden"
                        onEnded={() => setPlayingAudioId(null)}
                        onError={() => {
                          setPlayingAudioId(null);
                          setAudioPreviewUrls(current => {
                            const next = { ...current };
                            delete next[asset.id];
                            return next;
                          });
                          toast.error('音频试听地址已失效，请重试');
                        }}
                      />
                    )}

                    {disabledByRules && ruleViolation && (
                      <div className="product-media-surface absolute inset-x-1.5 bottom-7 rounded-md bg-black/75 px-1.5 py-1 text-[9px] leading-tight text-amber-200">
                        {ruleViolation}
                      </div>
                    )}

                    {/* Selected check */}
                    <AnimatePresence>
                      {isSelected && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          className="absolute inset-0 bg-purple-600/20 flex items-center justify-center"
                        >
                          <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center">
                            <Check className="w-3.5 h-3.5 text-white" />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Name */}
                    <div className="product-media-surface absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/80 to-transparent">
                      <p className="text-[10px] text-white truncate">{asset.name}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 flex-col gap-3 border-t border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
          <div className="min-w-0 flex-1 space-y-2">
            <span className="block text-xs text-gray-500">
              {pageError ? '资产加载失败，请稍后重试' : confirmationViolation ?? (selected.size > 0 ? selectedSummary : '点击资产进行选择')}
              {pageLoading ? ' · 正在加载' : ''}
            </span>
            {pagination && (!pageError || onAssetPageNavigate) && (
              <PaginationFooter count={assets.length} totalItems={pagination.totalItems} totalPages={pagination.totalPages} unit="个素材" hideSummary={Boolean(pageError)}>
                {onAssetPageNavigate && (
                  <CursorPagination
                    pagination={pagination}
                    loading={pageLoading}
                    empty={assets.length === 0}
                    onNavigate={onAssetPageNavigate}
                    label="资产选择器翻页"
                  />
                )}
              </PaginationFooter>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-all">
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={selected.size === 0 || Boolean(confirmationViolation)}
              title={confirmationViolation ?? undefined}
              className="relative overflow-hidden px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-blue-600" />
              <span className="relative">确认选择{selected.size > 0 ? `（${selected.size}）` : ''}</span>
            </button>
          </div>
        </div>
      </motion.div>
      <AnimatePresence>
        {uploadOpen && canOpenUpload && (
          <AssetUploadPanel
            key="picker-upload-panel"
            library={{ assets, folders }}
            accept={panelUploadAccept}
            zIndexClass="z-[120]"
            onClose={() => setUploadOpen(false)}
            onUploadFile={onUploadFile!}
          />
        )}
        {pendingAudioDelete && (
          <Dialog
            role="alertdialog"
            titleId="asset-picker-audio-delete-title"
            descriptionId="asset-picker-audio-delete-description"
            zIndexClass="z-[130]"
            closeDisabled={Boolean(deletingAudioId)}
            onClose={() => setPendingAudioDelete(null)}
            panelClassName="max-w-md"
          >
            <Card variant="modal" className="p-5">
              <h2 id="asset-picker-audio-delete-title" className="text-lg font-bold text-white">删除音频素材</h2>
              <p id="asset-picker-audio-delete-description" className="mt-2 text-sm leading-6 text-gray-400">
                确认删除音频“{pendingAudioDelete.name}”吗？此操作无法撤回。
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <Button
                  data-dialog-initial-focus
                  variant="secondary"
                  disabled={Boolean(deletingAudioId)}
                  onClick={() => setPendingAudioDelete(null)}
                >
                  取消
                </Button>
                <Button
                  variant="danger"
                  loading={deletingAudioId === pendingAudioDelete.id}
                  disabled={Boolean(deletingAudioId)}
                  onClick={() => void handleAudioDelete(pendingAudioDelete)}
                >
                  {deletingAudioId ? '正在删除' : '确认删除'}
                </Button>
              </div>
            </Card>
          </Dialog>
        )}
      </AnimatePresence>
    </Dialog>
  );
}

export function getSelectionViolation(assets: Asset[], rules?: AssetPickerSelectionRules) {
  if (!rules) return null;
  const imageCount = assets.filter(asset => asset.type === 'image').length;
  const videoAssets = assets.filter(asset => asset.type === 'video');
  const audioAssets = assets.filter(asset => asset.type === 'audio');
  const videoCount = videoAssets.length;
  const audioCount = audioAssets.length;

  if (rules.maxTotal !== undefined && assets.length > rules.maxTotal) {
    return `最多选择 ${rules.maxTotal} 个参考素材`;
  }
  if (rules.allowMixedTypes === false && imageCount > 0 && videoCount > 0) {
    return '图片和视频不能混选';
  }
  if (rules.maxImages !== undefined && imageCount > rules.maxImages) {
    return `最多选择 ${rules.maxImages} 张图片`;
  }
  if (rules.maxVideos !== undefined && videoCount > rules.maxVideos) {
    return `最多选择 ${rules.maxVideos} 个视频`;
  }
  if (rules.maxAudios !== undefined && audioCount > rules.maxAudios) {
    return `最多选择 ${rules.maxAudios} 个音频`;
  }
  if (rules.maxVideoDurationSeconds !== undefined) {
    const totalSeconds = videoAssets.reduce((sum, asset) => sum + getAssetDurationSeconds(asset), 0);
    if (totalSeconds > rules.maxVideoDurationSeconds) {
      return `参考视频总时长不能超过 ${rules.videoMaxDurationLabel ?? `${rules.maxVideoDurationSeconds}s`}`;
    }
  }
  if (rules.maxAudioDurationSeconds !== undefined) {
    const totalSeconds = audioAssets.reduce((sum, asset) => sum + getAssetDurationSeconds(asset), 0);
    if (totalSeconds > rules.maxAudioDurationSeconds) {
      return `参考音频总时长不能超过 ${rules.audioMaxDurationLabel ?? `${rules.maxAudioDurationSeconds}s`}`;
    }
  }
  return null;
}

export function getAssetSelectionViolation(asset: Asset, rules?: AssetPickerSelectionRules) {
  if (!rules) return null;
  if (asset.type === 'image') return getImageSelectionViolation(asset, rules.image);
  const hasDurationRule = asset.type === 'video'
    ? rules.minSingleVideoDurationSeconds !== undefined || rules.maxSingleVideoDurationSeconds !== undefined || rules.maxVideoDurationSeconds !== undefined
    : rules.minSingleAudioDurationSeconds !== undefined || rules.maxSingleAudioDurationSeconds !== undefined || rules.maxAudioDurationSeconds !== undefined;
  const duration = getAssetDurationSeconds(asset);
  if (hasDurationRule && !duration) return asset.type === 'audio' ? '音频缺少可校验时长' : '视频缺少可校验时长';

  if (asset.type === 'video') {
    if (rules.minSingleVideoDurationSeconds !== undefined && duration < rules.minSingleVideoDurationSeconds) {
      return `单个视频不能少于 ${rules.minSingleVideoDurationSeconds}s`;
    }
    if (rules.maxSingleVideoDurationSeconds !== undefined && duration > rules.maxSingleVideoDurationSeconds) {
      return `单个视频不能超过 ${rules.videoMaxDurationLabel ?? `${rules.maxSingleVideoDurationSeconds}s`}`;
    }
  }

  if (asset.type === 'audio') {
    if ((rules.maxAudios !== undefined || hasDurationRule) && asset.mediaExtension && !/^(mp3|wav)$/i.test(asset.mediaExtension)) {
      return '参考音频仅支持 MP3 或 WAV 格式';
    }
    if (rules.minSingleAudioDurationSeconds !== undefined && duration < rules.minSingleAudioDurationSeconds) {
      return `单个音频不能少于 ${rules.minSingleAudioDurationSeconds}s`;
    }
    if (rules.maxSingleAudioDurationSeconds !== undefined && duration > rules.maxSingleAudioDurationSeconds) {
      return `单个音频不能超过 ${rules.audioMaxDurationLabel ?? `${rules.maxSingleAudioDurationSeconds}s`}`;
    }
    if (rules.maxAudioSizeBytes !== undefined) {
      if (!asset.sizeBytes || !Number.isFinite(asset.sizeBytes)) return '音频缺少可校验的文件大小';
      if (asset.sizeBytes > rules.maxAudioSizeBytes) {
        return `单个音频不能超过 ${formatLimitSize(rules.maxAudioSizeBytes)}`;
      }
    }
  }
  return null;
}

function getImageSelectionViolation(asset: Asset, rules?: AssetPickerSelectionRules['image']) {
  if (!rules) return null;
  const extension = resolveAssetExtension(asset);
  if (rules.supportedExtensions && (!extension || !rules.supportedExtensions.includes(extension))) {
    return '参考图片格式仅支持 JPEG、PNG、WebP、BMP、TIFF、GIF、HEIC 或 HEIF';
  }

  if (rules.requireFileSize || rules.maxSizeBytes !== undefined) {
    if (!Number.isSafeInteger(asset.sizeBytes) || Number(asset.sizeBytes) <= 0) {
      return '参考图片缺少可校验的文件大小，请重新上传或等待系统修复后再选择';
    }
    if (rules.maxSizeBytes !== undefined && Number(asset.sizeBytes) > rules.maxSizeBytes) {
      return `单张参考图片不能超过 ${formatLimitSize(rules.maxSizeBytes)}`;
    }
  }

  const width = asset.width;
  const height = asset.height;
  const needsDimensions = rules.requireDimensions
    || rules.minDimensionExclusive !== undefined
    || rules.maxPixels !== undefined
    || rules.minAspectRatio !== undefined
    || rules.maxAspectRatio !== undefined;
  if (needsDimensions && (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || Number(width) <= 0 || Number(height) <= 0)) {
    return '参考图片缺少可校验的宽高，请重新上传或等待系统修复后再选择';
  }
  if (width === undefined || height === undefined) return null;
  if (rules.minDimensionExclusive !== undefined && (width <= rules.minDimensionExclusive || height <= rules.minDimensionExclusive)) {
    return `参考图片宽高必须都大于 ${rules.minDimensionExclusive} px`;
  }
  if (rules.maxPixels !== undefined && width * height > rules.maxPixels) {
    return `单张参考图片总像素不能超过 ${formatPixelLimit(rules.maxPixels)}`;
  }
  const ratio = width / height;
  if ((rules.minAspectRatio !== undefined && ratio < rules.minAspectRatio)
    || (rules.maxAspectRatio !== undefined && ratio > rules.maxAspectRatio)) {
    return '参考图片宽高比必须在 1:16 到 16:1 之间';
  }
  return null;
}

function resolveAssetExtension(asset: Asset) {
  const explicit = asset.mediaExtension?.trim().toLowerCase();
  if (explicit && /^[a-z0-9]+$/.test(explicit)) return explicit;
  const match = asset.name.split(/[?#]/, 1)[0]?.match(/\.([A-Za-z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? null;
}

function formatPixelLimit(pixels: number) {
  return pixels === 36_000_000 ? '3600 万' : `${pixels.toLocaleString('zh-CN')}`;
}

export function getConfirmationViolation(assets: Asset[], rules?: AssetPickerSelectionRules) {
  for (const asset of assets) {
    const assetViolation = getAssetSelectionViolation(asset, rules);
    if (assetViolation) return assetViolation;
  }
  const selectionViolation = getSelectionViolation(assets, rules);
  if (selectionViolation) return selectionViolation;
  if (rules?.requireVisualWithAudio && assets.some(asset => asset.type === 'audio') && !assets.some(asset => asset.type === 'image' || asset.type === 'video')) {
    return '参考音频不能单独使用，请至少选择一张图片或一个视频';
  }
  return null;
}

function formatLimitSize(sizeBytes: number) {
  return `${Math.round(sizeBytes / 1024 / 1024)} MB`;
}

function getAssetDurationSeconds(asset: Asset) {
  if (asset.durationSeconds !== undefined && Number.isFinite(asset.durationSeconds)) return asset.durationSeconds;
  return parseDurationSeconds(asset.duration);
}

function parseDurationSeconds(duration?: string) {
  if (!duration) return 0;
  const trimmed = duration.trim();
  if (!trimmed) return 0;
  if (trimmed.endsWith('s')) return Number(trimmed.replace('s', '')) || 0;
  const parts = trimmed.split(':').map(part => Number(part));
  if (parts.length === 2 && parts.every(part => Number.isFinite(part))) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3 && parts.every(part => Number.isFinite(part))) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return Number(trimmed) || 0;
}

function getSelectedSummary(assets: Asset[]) {
  const imageCount = assets.filter(asset => asset.type === 'image').length;
  const videoCount = assets.filter(asset => asset.type === 'video').length;
  const audioCount = assets.filter(asset => asset.type === 'audio').length;
  const parts = [
    imageCount > 0 ? `${imageCount} 张图片` : '',
    videoCount > 0 ? `${videoCount} 个视频` : '',
    audioCount > 0 ? `${audioCount} 个音频` : '',
  ].filter(Boolean);
  if (parts.length > 0) return `已选择 ${parts.join('、')}`;
  return '点击资产进行选择';
}
