import {
  Check,
  CheckSquare,
  Download,
  Edit3,
  Eye,
  FileAudio,
  FileImage,
  FileVideo,
  FolderOpen,
  FolderPlus,
  Folders,
  Image as ImageIcon,
  Info,
  Loader2,
  MoveRight,
  Music2,
  Play,
  RefreshCw,
  Search,
  Square,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { AnimatePresence,motion } from 'motion/react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import type { UploadProgressEvent } from '../api/assetUpload';
import type { ExactCursorPagination as CursorPaginationState,PagePosition } from '../api/cursor';
import {
  CATEGORY_LABELS,
  SOURCE_LABELS,
  listFolders,
  type Asset,
  type AssetFolder,
  type AssetLibraryState,
  type AssetSort,
  type AssetSource,
  type AssetSummary,
} from '../data/assets';
import { AppPage,AssetThumbnail,Button,Card,Dialog,FolderSelect,PageHeader,StatCard,StudioTab,StudioTabList,type StudioTabAccent } from '../ui';
import type { BrowserDownloadResult } from '../utils/assetDownload';
import { AssetUploadPanel,type AssetUploadCompleteResult } from './AssetUploadPanel';
import { AssetPreviewModal } from './AssetPreviewModal';
import { CursorPagination } from './CursorPagination';
import { PaginationFooter } from './PaginationFooter';
import { ObjectMenu,type ObjectMenuItem } from './asset-library/ObjectMenu';
import { formatBeijingDateTime } from '../utils/beijingTime';

export interface DigitalAssetFilters {
  source?: AssetSource;
  folderId?: string | null;
  search?: string;
  sort?: AssetSort;
}

export interface DigitalAssetsProps {
  library: AssetLibraryState;
  summary: AssetSummary;
  pagination?: CursorPaginationState;
  pageLoading?: boolean;
  pageError?: unknown;
  foldersLoading?: boolean;
  foldersError?: unknown;
  summaryLoading?: boolean;
  summaryReady?: boolean;
  summaryError?: unknown;
  focusSource: AssetSource;
  onAIStudioOpen?: () => void;
  onReuseGenerate: (asset: Asset) => void;
  onFolderCreate: (source: AssetSource, name: string) => Promise<AssetFolder>;
  onFolderRename: (folderId: string, name: string) => Promise<void>;
  onFolderDelete: (
    folderId: string,
    contentAction: 'move-to-root' | 'delete-assets',
  ) => Promise<{ ok: true; contentAction: 'move-to-root' | 'delete-assets'; affectedAssetCount: number | null }>;
  onUploadFile: (file: File, folderId: string | null, onProgress?: (event: UploadProgressEvent) => void) => Promise<Asset>;
  onAssetFiltersChange: (filters: DigitalAssetFilters) => void;
  onAssetPageNavigate: (position: PagePosition) => void;
  onAssetPageRetry: () => void;
  onFoldersRetry: () => void;
  onSummaryRetry: () => void;
  onAssetDetailLoad: (assetId: string) => Promise<Asset>;
  onAssetUpdate: (assetId: string, patch: Partial<Omit<Asset, 'id'>>) => Promise<void>;
  onAssetDownload: (asset: Asset) => Promise<BrowserDownloadResult | null>;
  onAssetDelete: (assetId: string) => Promise<void>;
  onBulkMove: (assetIds: string[], folderId: string | null) => Promise<void>;
  onBulkDelete: (assetIds: string[]) => Promise<void>;
}

const CATEGORIES: AssetSource[] = ['ai-video', 'ai-image', 'uploaded-video', 'uploaded-image', 'uploaded-audio'];
const CATEGORY_TAB_ACCENTS = {
  'ai-video': 'violet',
  'ai-image': 'pink',
  'uploaded-video': 'blue',
  'uploaded-image': 'pink',
  'uploaded-audio': 'cyan',
} satisfies Record<AssetSource, StudioTabAccent>;
const CATEGORY_TAB_ICONS = {
  'ai-video': Video,
  'ai-image': ImageIcon,
  'uploaded-video': FileVideo,
  'uploaded-image': FileImage,
  'uploaded-audio': FileAudio,
};

export interface DigitalAssetsUrlState {
  source: AssetSource;
  folderId: string | null;
  search: string;
}

type FolderModalState = { mode: 'create' } | { mode: 'rename'; folder: AssetFolder };
type FolderDeleteState = { folder: AssetFolder; contentAction: 'move-to-root' | 'delete-assets' };
type AssetMoveState = { asset: Asset; targetId: string };

export function advanceAssetDetailRequestSequence(current: number) {
  return current + 1;
}

export function isAssetRootMissing(rootFolderId: string | null, loading: boolean, error: unknown) {
  return !loading && !error && rootFolderId === null;
}

export function getKnownFolderAssetCount(
  summary: AssetSummary,
  summaryKnown: boolean,
  folderId: string | null,
) {
  if (!summaryKnown || !folderId) return null;
  return summary.folderCounts.find(item => item.folderId === folderId)?.count ?? 0;
}

export function requiresFolderContentChoice(assetCount: number | null) {
  return assetCount !== 0;
}

function getSystemFolderId(library: AssetLibraryState, source: AssetSource) {
  return library.folders.find(folder => folder.source === source && folder.isSystem)?.id ?? null;
}

function getNonSystemUploadFolderId(library: AssetLibraryState, source: AssetSource, folderId: string | null) {
  if (!folderId) return null;
  const folder = listFolders(library, source).find(item => item.id === folderId);
  return folder && !folder.isSystem ? folder.id : null;
}

function isAssetSource(value: string | null): value is AssetSource {
  return Boolean(value && CATEGORIES.includes(value as AssetSource));
}

export function parseDigitalAssetsUrlSearch(search: string, fallbackSource: AssetSource): DigitalAssetsUrlState {
  const params = new URLSearchParams(search);
  return {
    source: isAssetSource(params.get('source')) ? params.get('source') as AssetSource : fallbackSource,
    folderId: params.get('folder') && params.get('folder') !== 'root' ? params.get('folder') : null,
    search: params.get('q') ?? '',
  };
}

function readUrlState(fallbackSource: AssetSource): DigitalAssetsUrlState {
  if (typeof window === 'undefined') return { source: fallbackSource, folderId: null, search: '' };
  return parseDigitalAssetsUrlSearch(window.location.search, fallbackSource);
}

export function createDigitalAssetsUrlSearch(state: DigitalAssetsUrlState, fallbackSource: AssetSource) {
  const params = new URLSearchParams();
  params.set('source', state.source || fallbackSource);
  params.set('folder', state.folderId ?? 'root');
  if (state.search.trim()) params.set('q', state.search.trim());
  return `?${params.toString()}`;
}

export function resolveDigitalAssetCardFilters(input: {
  source: AssetSource;
  rootFolderId: string | null;
  activeFolderId: string | null;
  search: string;
}) {
  if (!input.rootFolderId) return null;
  return {
    source: input.source,
    // 有搜索词时不传 folderId，后端在当前分类的所有目录中检索。
    ...(input.search.trim() ? {} : { folderId: input.activeFolderId ?? input.rootFolderId }),
    search: input.search.trim() || undefined,
    sort: 'created-desc' as const,
  };
}

/** null 表示草稿没有形成新操作；空字符串表示清除已应用搜索。 */
export function resolveDigitalAssetSearchSubmission(draft: string, applied: string) {
  const normalizedDraft = draft.trim();
  return normalizedDraft === applied || (!normalizedDraft && !applied) ? null : normalizedDraft;
}

export function DigitalAssets(props: DigitalAssetsProps) {
  const {
    library,
    summary,
    pagination,
    pageLoading = false,
    pageError,
    foldersLoading = false,
    foldersError,
    summaryLoading = false,
    summaryReady = !summaryLoading,
    summaryError,
    focusSource,
    onAIStudioOpen,
    onReuseGenerate,
    onFolderCreate,
    onFolderRename,
    onFolderDelete,
    onUploadFile,
    onAssetFiltersChange,
    onAssetPageNavigate,
    onAssetPageRetry,
    onFoldersRetry,
    onSummaryRetry,
    onAssetDetailLoad,
    onAssetUpdate,
    onAssetDownload,
    onAssetDelete,
    onBulkMove,
    onBulkDelete,
  } = props;
  const initialUrlStateRef = useRef<DigitalAssetsUrlState | null>(null);
  if (!initialUrlStateRef.current) initialUrlStateRef.current = readUrlState(focusSource);
  const initialUrlState = initialUrlStateRef.current;
  const [category,setCategory] = useState<AssetSource>(initialUrlState.source);
  const [activeFolderId,setActiveFolderId] = useState<string | null>(initialUrlState.folderId);
  const [searchDraft,setSearchDraft] = useState(initialUrlState.search.trim());
  const [appliedSearch,setAppliedSearch] = useState(initialUrlState.search.trim());
  const [searchSubmitting,setSearchSubmitting] = useState(false);
  const searchOriginFolderRef = useRef<string | null>(initialUrlState.folderId);
  const searchSubmissionObservedLoadingRef = useRef(false);
  const searchSubmissionFallbackFrameRef = useRef<number | null>(null);
  const [folderBrowserOpen,setFolderBrowserOpen] = useState(false);
  const [selectionMode,setSelectionMode] = useState(false);
  const [selectedIds,setSelectedIds] = useState<Set<string>>(new Set());
  const [moveTargetFolderId,setMoveTargetFolderId] = useState('');
  const [uploadOpen,setUploadOpen] = useState(false);
  const [folderModal,setFolderModal] = useState<FolderModalState | null>(null);
  const [folderName,setFolderName] = useState('');
  const [folderToDelete,setFolderToDelete] = useState<FolderDeleteState | null>(null);
  const [folderDeleteConfirmation,setFolderDeleteConfirmation] = useState('');
  const [assetToDelete,setAssetToDelete] = useState<Asset | null>(null);
  const [assetToMove,setAssetToMove] = useState<AssetMoveState | null>(null);
  const [bulkDeleteIds,setBulkDeleteIds] = useState<string[] | null>(null);
  const [bulkMoveConfirm,setBulkMoveConfirm] = useState<{ assetIds: string[]; folderId: string | null; folderLabel: string } | null>(null);
  const [detailAsset,setDetailAsset] = useState<Asset | null>(null);
  const [detailLoadingId,setDetailLoadingId] = useState<string | null>(null);
  const [pendingDownloadIds,setPendingDownloadIds] = useState<Set<string>>(new Set());
  const [requestedDownloadIds,setRequestedDownloadIds] = useState<Set<string>>(new Set());
  const [actionError,setActionError] = useState('');
  const reportActionError = (message: string) => { setActionError(message); };
  const [pendingAction,setPendingAction] = useState<string | null>(null);
  const detailRequestRef = useRef(0);
  const pendingDownloadIdsRef = useRef(new Set<string>());
  const newlyCreatedFolderIdRef = useRef<string | null>(null);
  const liveRegionRef = useRef<HTMLParagraphElement>(null);
  const invalidatePendingDetail = useCallback(() => {
    detailRequestRef.current = advanceAssetDetailRequestSequence(detailRequestRef.current);
    setDetailLoadingId(null);
  }, []);

  const categoryFolders = useMemo(
    () => listFolders(library, category).filter(folder => !folder.isSystem),
    [category, library],
  );
  const activeFolder = activeFolderId ? categoryFolders.find(folder => folder.id === activeFolderId) ?? null : null;
  const rootFolderId = getSystemFolderId(library, category);
  const categoryRootMissing = isAssetRootMissing(rootFolderId, foldersLoading, foldersError);
  // 后台刷新期间继续显示已确认的统计；只在首次数据尚未到达或无缓存失败时显示未知。
  const summaryKnown = summaryReady && !summaryError;
  const visibleAssets = useMemo(() => {
    if (!rootFolderId) return [];
    const expectedFolderId = activeFolderId ?? rootFolderId;
    const normalizedSearch = appliedSearch.toLocaleLowerCase();
    return library.assets.filter(asset => (
      asset.source === category
      && (normalizedSearch
        ? asset.name.toLocaleLowerCase().includes(normalizedSearch)
        : asset.folderId === expectedFolderId)
    ));
  }, [activeFolderId, appliedSearch, category, library.assets, rootFolderId]);
  const folderResolutionError = !rootFolderId ? foldersError : null;
  const cardsLoading = !folderResolutionError && (foldersLoading || (Boolean(rootFolderId) && pageLoading));
  const cardsError = folderResolutionError ?? (rootFolderId ? pageError : null);
  const selectedAssets = useMemo(() => visibleAssets.filter(asset => selectedIds.has(asset.id)), [selectedIds, visibleAssets]);
  const allPageSelected = visibleAssets.length > 0 && visibleAssets.every(asset => selectedIds.has(asset.id));
  const searchActive = Boolean(appliedSearch);

  useEffect(() => {
    if (!searchSubmitting) return;
    if (cardsLoading) {
      searchSubmissionObservedLoadingRef.current = true;
      return;
    }
    if (!searchSubmissionObservedLoadingRef.current) return;
    searchSubmissionObservedLoadingRef.current = false;
    setSearchSubmitting(false);
  }, [cardsLoading, searchSubmitting]);

  useEffect(() => () => {
    if (searchSubmissionFallbackFrameRef.current !== null) {
      window.cancelAnimationFrame(searchSubmissionFallbackFrameRef.current);
    }
  }, []);

  const updateUrl = useCallback((next: DigitalAssetsUrlState, mode: 'push' | 'replace') => {
    if (typeof window === 'undefined') return;
    const nextUrl = `${window.location.pathname}${createDigitalAssetsUrlSearch(next, focusSource)}${window.location.hash}`;
    window.history[mode === 'push' ? 'pushState' : 'replaceState']({}, '', nextUrl);
  }, [focusSource]);

  useEffect(() => {
    updateUrl({ source: category, folderId: activeFolderId, search: appliedSearch }, 'replace');
    // 仅用于首次把无参数地址及历史 sort 参数规范化；后续 URL 由显式交互维护。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      // 浏览器前进/后退可能先触发当前页监听器，再由应用壳卸载本组件。
      // 只规范化数字资产自己的 URL，避免把目录参数写入 AI Studio 等页面。
      if (window.location.pathname !== '/app/digital-assets') return;
      const state = readUrlState(focusSource);
      setCategory(state.source);
      setActiveFolderId(state.folderId);
      setSearchDraft(state.search.trim());
      setAppliedSearch(state.search.trim());
      setSearchSubmitting(false);
      searchSubmissionObservedLoadingRef.current = false;
      if (searchSubmissionFallbackFrameRef.current !== null) {
        window.cancelAnimationFrame(searchSubmissionFallbackFrameRef.current);
        searchSubmissionFallbackFrameRef.current = null;
      }
      searchOriginFolderRef.current = state.folderId;
      setSelectedIds(new Set());
      setSelectionMode(false);
      invalidatePendingDetail();
      const canonicalSearch = createDigitalAssetsUrlSearch(state, focusSource);
      if (window.location.search !== canonicalSearch) {
        window.history.replaceState({}, '', `${window.location.pathname}${canonicalSearch}${window.location.hash}`);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [focusSource, invalidatePendingDetail]);

  // 在绘制前同步目标查询，避免新目录短暂沿用旧查询的已完成状态。
  useLayoutEffect(() => {
    const filters = resolveDigitalAssetCardFilters({ source: category, rootFolderId, activeFolderId, search: appliedSearch });
    if (filters) onAssetFiltersChange(filters);
  }, [activeFolderId, appliedSearch, category, onAssetFiltersChange, rootFolderId]);

  useEffect(() => {
    if (newlyCreatedFolderIdRef.current && activeFolder?.id === newlyCreatedFolderIdRef.current) {
      newlyCreatedFolderIdRef.current = null;
      return;
    }
    if (!foldersLoading && !foldersError && activeFolderId && !activeFolder && activeFolderId !== newlyCreatedFolderIdRef.current) {
      invalidatePendingDetail();
      setActiveFolderId(null);
      searchOriginFolderRef.current = null;
      updateUrl({ source: category, folderId: null, search: appliedSearch }, 'replace');
    }
  }, [activeFolder, activeFolderId, appliedSearch, category, foldersError, foldersLoading, invalidatePendingDetail, updateUrl]);

  useEffect(() => {
    if (!cardsLoading && !cardsError) {
      liveRegionRef.current && (liveRegionRef.current.textContent = `已显示 ${visibleAssets.length} 个素材`);
    }
  }, [cardsError, cardsLoading, visibleAssets.length]);

  const changeLocation = (nextCategory: AssetSource, nextFolderId: string | null, options?: { clearSearch?: boolean }) => {
    invalidatePendingDetail();
    setSearchSubmitting(false);
    searchSubmissionObservedLoadingRef.current = false;
    if (searchSubmissionFallbackFrameRef.current !== null) {
      window.cancelAnimationFrame(searchSubmissionFallbackFrameRef.current);
      searchSubmissionFallbackFrameRef.current = null;
    }
    const nextSearch = options?.clearSearch ? '' : appliedSearch;
    setCategory(nextCategory);
    setActiveFolderId(nextFolderId);
    setSearchDraft(nextSearch);
    if (options?.clearSearch) {
      setAppliedSearch('');
      searchOriginFolderRef.current = nextFolderId;
    }
    setSelectedIds(new Set());
    setSelectionMode(false);
    setMoveTargetFolderId('');
    setFolderBrowserOpen(false);
    updateUrl({ source: nextCategory, folderId: nextFolderId, search: nextSearch }, 'push');
  };

  const handleCategoryChange = (source: AssetSource) => {
    searchOriginFolderRef.current = null;
    changeLocation(source, null);
  };
  const handleFolderSelect = (folderId: string | null) => changeLocation(category, folderId, { clearSearch: true });

  const applySearch = () => {
    const nextSearch = resolveDigitalAssetSearchSubmission(searchDraft, appliedSearch);
    if (searchSubmitting || nextSearch === null) {
      if (searchDraft !== searchDraft.trim()) setSearchDraft(searchDraft.trim());
      return;
    }
    if (!nextSearch) {
      if (appliedSearch) clearSearch();
      return;
    }
    invalidatePendingDetail();
    if (!appliedSearch) searchOriginFolderRef.current = activeFolderId;
    searchSubmissionObservedLoadingRef.current = false;
    setSearchSubmitting(true);
    armSearchSubmissionFallback();
    setSearchDraft(nextSearch);
    setAppliedSearch(nextSearch);
    setSelectedIds(new Set());
    setSelectionMode(false);
    updateUrl({ source: category, folderId: activeFolderId, search: nextSearch }, 'replace');
  };

  function clearSearch() {
    if (!appliedSearch) {
      setSearchDraft('');
      return;
    }
    invalidatePendingDetail();
    searchSubmissionObservedLoadingRef.current = false;
    setSearchSubmitting(true);
    armSearchSubmissionFallback();
    const requestedOrigin = searchOriginFolderRef.current;
    const originFolder = requestedOrigin && categoryFolders.some(folder => folder.id === requestedOrigin)
      ? requestedOrigin
      : null;
    setSearchDraft('');
    setAppliedSearch('');
    setActiveFolderId(originFolder);
    setSelectedIds(new Set());
    setSelectionMode(false);
    updateUrl({ source: category, folderId: originFolder, search: '' }, 'replace');
  }

  function armSearchSubmissionFallback() {
    if (searchSubmissionFallbackFrameRef.current !== null) {
      window.cancelAnimationFrame(searchSubmissionFallbackFrameRef.current);
    }
    searchSubmissionFallbackFrameRef.current = window.requestAnimationFrame(() => {
      searchSubmissionFallbackFrameRef.current = window.requestAnimationFrame(() => {
        searchSubmissionFallbackFrameRef.current = null;
        if (!searchSubmissionObservedLoadingRef.current) setSearchSubmitting(false);
      });
    });
  }

  const toggleSelected = (assetId: string) => {
    setSelectedIds(current => {
      const next = new Set(current);
      next.has(assetId) ? next.delete(assetId) : next.add(assetId);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectionMode(false);
    setMoveTargetFolderId('');
  };

  const toggleSelectPage = () => {
    setSelectedIds(allPageSelected ? new Set() : new Set(visibleAssets.map(asset => asset.id)));
  };

  const folderOptionsForSource = (source: AssetSource, excludedFolderId?: string | null) => {
    if (foldersError) return [];
    const rootId = getSystemFolderId(library, source);
    return [
      ...(rootId && rootId !== excludedFolderId ? [{ value: rootId, label: '主目录' }] : []),
      ...listFolders(library, source)
        .filter(folder => !folder.isSystem && folder.id !== excludedFolderId)
        .map(folder => ({ value: folder.id, label: folder.name })),
    ];
  };

  const currentMoveFolderOptions = useMemo(() => {
    if (selectedAssets.length === 0) return [];
    const source = selectedAssets[0]?.source;
    if (!source || !selectedAssets.every(asset => asset.source === source)) return [];
    const currentIds = new Set(selectedAssets.map(asset => asset.folderId));
    return folderOptionsForSource(source).filter(option => !currentIds.has(option.value));
  // library is intentionally included because folderOptionsForSource reads it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldersError, library, selectedAssets]);

  useEffect(() => {
    if (moveTargetFolderId && !currentMoveFolderOptions.some(option => option.value === moveTargetFolderId)) setMoveTargetFolderId('');
  }, [currentMoveFolderOptions, moveTargetFolderId]);

  useEffect(() => { setActionError(''); }, [folderModal, folderToDelete, assetToMove, assetToDelete, bulkMoveConfirm, bulkDeleteIds]);

  const submitFolderModal = async () => {
    const normalizedName = folderName.trim();
    if (!folderModal || !normalizedName || pendingAction) {
      if (!normalizedName) reportActionError('请输入文件夹名称');
      return;
    }
    setActionError('');
    try {
      setPendingAction('folder-save');
      if (folderModal.mode === 'rename') {
        await onFolderRename(folderModal.folder.id, normalizedName);
        toast.success('文件夹已重命名');
      } else {
        const created = await onFolderCreate(category, normalizedName);
        toast.success('文件夹已创建');
        newlyCreatedFolderIdRef.current = created.id;
        changeLocation(category, created.id, { clearSearch: true });
      }
      setFolderModal(null);
    } catch (error) {
      reportActionError(error instanceof Error ? error.message : '文件夹操作失败');
    } finally {
      setPendingAction(null);
    }
  };

  const confirmDeleteFolder = async () => {
    if (!folderToDelete || pendingAction) return;
    if (folderToDelete.contentAction === 'delete-assets' && folderDeleteConfirmation !== folderToDelete.folder.name) {
      reportActionError('请输入完整文件夹名称以确认删除');
      return;
    }
    setActionError('');
    try {
      setPendingAction('folder-delete');
      const result = await onFolderDelete(folderToDelete.folder.id, folderToDelete.contentAction);
      if (activeFolderId === folderToDelete.folder.id) handleFolderSelect(null);
      const affected = result.affectedAssetCount === null ? '' : ` ${result.affectedAssetCount} 个素材`;
      toast.success(result.contentAction === 'move-to-root' ? `文件夹已删除，${affected.trim()}已移到主目录` : `文件夹及${affected.trim() || '内部素材'}已删除`);
      setFolderToDelete(null);
      setFolderDeleteConfirmation('');
      clearSelection();
    } catch (error) {
      reportActionError(error instanceof Error ? error.message : '文件夹删除失败');
    } finally {
      setPendingAction(null);
    }
  };

  const openAssetDetail = async (asset: Asset) => {
    const requestId = ++detailRequestRef.current;
    setDetailLoadingId(asset.id);
    setActionError('');
    try {
      const detail = await onAssetDetailLoad(asset.id);
      if (requestId === detailRequestRef.current) setDetailAsset(detail);
    } catch (error) {
      if (requestId === detailRequestRef.current) reportActionError(error instanceof Error ? error.message : '素材详情加载失败');
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoadingId(null);
    }
  };

  const closeAssetDetail = () => {
    invalidatePendingDetail();
    setDetailAsset(null);
  };

  const downloadAsset = async (asset: Asset) => {
    if (pendingDownloadIdsRef.current.has(asset.id)) return;
    pendingDownloadIdsRef.current.add(asset.id);
    setPendingDownloadIds(current => new Set(current).add(asset.id));
    setActionError('');
    try {
      const result = await onAssetDownload(asset);
      if (result) {
        setRequestedDownloadIds(current => new Set(current).add(asset.id));
        toast.success('素材下载已开始');
      }
      else toast.info('素材还未生成完成');
    } catch (error) {
      reportActionError(error instanceof Error ? error.message : '素材下载失败');
    } finally {
      pendingDownloadIdsRef.current.delete(asset.id);
      setPendingDownloadIds(current => {
        const next = new Set(current);
        next.delete(asset.id);
        return next;
      });
    }
  };

  const downloadDetailAsset = async (asset: Asset) => {
    const result = await onAssetDownload(asset);
    if (result) setRequestedDownloadIds(current => new Set(current).add(asset.id));
    if (result?.downloadRequestedAt) {
      const requestedAt = formatBeijingDateTime(result.downloadRequestedAt).slice(0, 16);
      setDetailAsset(current => current?.id === asset.id ? { ...current, downloadRequestedAt: requestedAt } : current);
    }
    return result;
  };

  const confirmDeleteAsset = async () => {
    if (!assetToDelete || pendingAction) return;
    setActionError('');
    try {
      setPendingAction('asset-delete');
      await onAssetDelete(assetToDelete.id);
      if (detailAsset?.id === assetToDelete.id) closeAssetDetail();
      setAssetToDelete(null);
      toast.success('素材已删除');
    } catch (error) {
      reportActionError(error instanceof Error ? error.message : '素材删除失败');
    } finally {
      setPendingAction(null);
    }
  };

  const confirmMoveAsset = async () => {
    if (!assetToMove?.targetId || pendingAction) return;
    setActionError('');
    try {
      setPendingAction('asset-move');
      await onBulkMove([assetToMove.asset.id], assetToMove.targetId);
      toast.success('素材已移动');
      setAssetToMove(null);
    } catch (error) {
      reportActionError(error instanceof Error ? error.message : '素材移动失败');
    } finally {
      setPendingAction(null);
    }
  };

  const confirmBulkDelete = async () => {
    if (!bulkDeleteIds?.length || pendingAction) return;
    setActionError('');
    try {
      setPendingAction('bulk-delete');
      await onBulkDelete(bulkDeleteIds);
      toast.success(`已删除 ${bulkDeleteIds.length} 个素材`);
      setBulkDeleteIds(null);
      clearSelection();
    } catch (error) {
      reportActionError(error instanceof Error ? error.message : '批量删除失败');
    } finally {
      setPendingAction(null);
    }
  };

  const confirmBulkMove = async () => {
    if (!bulkMoveConfirm?.assetIds.length || pendingAction) return;
    setActionError('');
    try {
      setPendingAction('bulk-move');
      await onBulkMove(bulkMoveConfirm.assetIds, bulkMoveConfirm.folderId);
      toast.success(`已移动 ${bulkMoveConfirm.assetIds.length} 个素材到${bulkMoveConfirm.folderLabel}`);
      setBulkMoveConfirm(null);
      clearSelection();
    } catch (error) {
      reportActionError(error instanceof Error ? error.message : '批量移动失败');
    } finally {
      setPendingAction(null);
    }
  };

  const handleUploadComplete = (result: AssetUploadCompleteResult) => {
    if (!result.firstSuccess) return;
    const nextSource = result.firstSuccess.source;
    const nextFolder = getNonSystemUploadFolderId(library, nextSource, result.firstSuccess.requestedFolderId);
    changeLocation(nextSource, nextFolder, { clearSearch: true });
  };

  const navigatePage = (position: PagePosition) => {
    invalidatePendingDetail();
    setSelectedIds(new Set());
    setMoveTargetFolderId('');
    onAssetPageNavigate(position);
  };

  const updateDetailAsset = async (assetId: string, patch: Partial<Omit<Asset, 'id'>>) => {
    await onAssetUpdate(assetId, patch);
    setDetailAsset(current => current?.id === assetId ? { ...current, ...patch } : current);
  };

  const currentLocationLabel = activeFolder?.name ?? '主目录';
  const activeRootFolderId = getSystemFolderId(library, category);
  const folderDeleteAssetCount = folderToDelete
    ? getKnownFolderAssetCount(summary, summaryKnown, folderToDelete.folder.id)
    : 0;
  const openFolderDelete = (folder: AssetFolder) => {
    setFolderDeleteConfirmation('');
    setFolderToDelete({ folder, contentAction: 'move-to-root' });
  };
  const currentLocationCount = getKnownFolderAssetCount(
    summary,
    summaryKnown,
    activeFolderId ?? activeRootFolderId,
  );
  const hasAvailableUploadRoot = (['uploaded-image', 'uploaded-video', 'uploaded-audio'] as const)
    .some(source => Boolean(getSystemFolderId(library, source)));
  const emptyKind = searchActive ? 'search' : activeFolder ? 'folder' : 'category';

  return (
    <AppPage width="workspace" className={`space-y-4 sm:space-y-5 ${selectionMode ? 'pb-[calc(144px+env(safe-area-inset-bottom))] md:pb-6' : ''}`}>
      <PageHeader
        eyebrow="ASSET LIBRARY"
        title="数字资产"
        subtitle="集中管理、查找与复用你的创作素材"
        titleTone="solid"
      />

      <CompactSummary
        summary={summary}
        loading={summaryLoading}
        ready={summaryKnown}
        error={summaryError}
        onRetry={onSummaryRetry}
      />

      <section aria-labelledby="asset-category-title">
        <h2 id="asset-category-title" className="sr-only">素材分类</h2>
        <StudioTabList aria-label="数字资产分类">
          {CATEGORIES.map((source,index) => {
            const CategoryIcon = CATEGORY_TAB_ICONS[source];
            return (
            <StudioTab
              key={source}
              id={`asset-tab-${source}`}
              active={category === source}
              accent={CATEGORY_TAB_ACCENTS[source]}
              density="compact"
              icon={<CategoryIcon className="h-4 w-4" aria-hidden="true" />}
              aria-label={summaryKnown ? `${CATEGORY_LABELS[source]}，${summary.bySource[source]}个素材` : `${CATEGORY_LABELS[source]}，数量暂不可用`}
              aria-controls="digital-assets-panel"
              tabIndex={category === source ? 0 : -1}
              onClick={() => handleCategoryChange(source)}
              onKeyDown={event => {
                let nextIndex: number | null = null;
                if (event.key === 'ArrowRight') nextIndex = (index + 1) % CATEGORIES.length;
                if (event.key === 'ArrowLeft') nextIndex = (index - 1 + CATEGORIES.length) % CATEGORIES.length;
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = CATEGORIES.length - 1;
                if (nextIndex === null) return;
                event.preventDefault();
                const next = CATEGORIES[nextIndex];
                handleCategoryChange(next);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
              }}
            >
              {CATEGORY_LABELS[source]}
              <span aria-hidden="true" className="tabular-nums text-[11px] text-current">{summaryKnown ? summary.bySource[source] : '—'}</span>
            </StudioTab>
            );
          })}
        </StudioTabList>
      </section>

      {categoryRootMissing && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
          <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{CATEGORY_LABELS[category]}目录暂不可用</p>
            <p className="mt-1 text-xs leading-5 text-amber-100/75">仅暂停当前分类的上传、创建和移动操作，其他分类仍可正常使用。</p>
          </div>
          <button type="button" className="min-h-11 shrink-0 rounded-lg px-3 text-xs font-semibold hover:bg-white/10" onClick={onFoldersRetry}>重试</button>
        </div>
      )}

      <div id="digital-assets-panel" role="tabpanel" aria-labelledby={`asset-tab-${category}`} className="grid min-w-0 gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden xl:block">
          <FolderSidebar
            category={category}
            rootFolderId={activeRootFolderId}
            activeFolderId={activeFolderId}
            searchActive={searchActive}
            searchResultCount={visibleAssets.length}
            folders={categoryFolders}
            summary={summary}
            summaryKnown={summaryKnown}
            loading={foldersLoading}
            error={foldersError}
            onRetry={onFoldersRetry}
            onSelect={handleFolderSelect}
            onCreate={() => { setFolderName(''); setFolderModal({ mode: 'create' }); }}
            onRename={folder => { setFolderName(folder.name); setFolderModal({ mode: 'rename', folder }); }}
            onDelete={openFolderDelete}
          />
        </aside>

        <main className="digital-assets-results-container min-w-0 rounded-2xl border border-white/[0.08] bg-white/[0.018] p-3 sm:p-4" aria-labelledby="asset-results-heading">
          <h2 id="asset-results-heading" className="sr-only">
            {CATEGORY_LABELS[category]} / {searchActive ? `搜索“${appliedSearch}”` : currentLocationLabel}
          </h2>
          <div className="flex flex-col gap-3 border-b border-white/[0.08] pb-4">
            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
              <div className="flex min-w-0 max-w-full items-center gap-2">
                <button
                  type="button"
                  aria-label={`选择文件夹，当前为${CATEGORY_LABELS[category]} / ${searchActive ? '搜索结果' : currentLocationLabel}`}
                  aria-haspopup="dialog"
                  aria-expanded={folderBrowserOpen}
                  onClick={() => setFolderBrowserOpen(true)}
                  className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-semibold text-white hover:bg-white/10 xl:hidden"
                >
                  <Folders className="h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />
                  <span className="truncate">{CATEGORY_LABELS[category]} / {searchActive ? '搜索结果' : currentLocationLabel}</span>
                  <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-gray-300">{searchActive ? `本页 ${visibleAssets.length}` : currentLocationCount ?? '—'}</span>
                </button>
                <div className="hidden min-w-0 xl:block">
                  <p className="text-xs text-gray-400">{CATEGORY_LABELS[category]} /</p>
                  <h2 className="truncate text-lg font-semibold text-white">{searchActive ? `搜索“${appliedSearch}”` : currentLocationLabel}</h2>
                  <p className="mt-0.5 text-xs text-gray-400">{searchActive ? `本页 ${visibleAssets.length} 个结果` : currentLocationCount === null ? '素材数量未知' : `${currentLocationCount} 个素材`}</p>
                </div>
              </div>
              <div data-testid="digital-asset-toolbar-actions" className="grid w-full grid-cols-2 gap-2 md:ml-auto md:flex md:w-auto md:shrink-0 md:items-center">
                <div data-testid="digital-asset-search" className="digital-asset-search relative col-span-2 h-11 min-w-0 rounded-xl bg-white/5 md:col-span-1 md:w-[clamp(200px,18vw,260px)] md:shrink-0">
                  <input
                    data-testid="digital-asset-search-input"
                    value={searchDraft}
                    onChange={event => setSearchDraft(event.target.value)}
                    onKeyDown={event => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      applySearch();
                    }}
                    placeholder={`搜索${CATEGORY_LABELS[category]}`}
                    aria-label={`搜索${CATEGORY_LABELS[category]}全部文件夹`}
                    className={`h-full w-full rounded-xl border-0 bg-transparent px-3 text-sm text-white placeholder:text-gray-400 ${appliedSearch ? 'pr-[5.75rem]' : 'pr-12'}`}
                  />
                  {appliedSearch && (
                    <button data-testid="digital-asset-search-clear" type="button" aria-label="清除搜索" disabled={searchSubmitting} onClick={() => clearSearch()} className="absolute right-11 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-gray-300 hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-50">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    data-testid="digital-asset-search-submit"
                    type="button"
                    aria-label="确认搜索"
                    title="确认搜索"
                    aria-busy={searchSubmitting || undefined}
                    disabled={searchSubmitting || !rootFolderId || (searchDraft.trim() === appliedSearch) || (!searchDraft.trim() && !appliedSearch)}
                    onClick={applySearch}
                    className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-r-xl text-violet-200 hover:bg-violet-500/15 hover:text-white disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:bg-transparent"
                  >
                    {searchSubmitting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                <Button
                  variant={selectionMode ? 'primary' : 'secondary'}
                  size="md"
                  className="min-h-11 w-full md:w-auto"
                  aria-pressed={selectionMode}
                  icon={selectionMode ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  onClick={() => selectionMode ? clearSelection() : setSelectionMode(true)}
                >
                  {selectionMode ? '退出批量操作' : '批量操作'}
                </Button>
                <Button
                  size="md"
                  className="min-h-11 w-full md:w-auto"
                  icon={<Upload className="h-4 w-4" />}
                  disabled={foldersLoading || !hasAvailableUploadRoot}
                  onClick={() => setUploadOpen(true)}
                >
                  上传素材
                </Button>
              </div>
            </div>
            {searchActive && <p className="text-xs text-violet-200">正在搜索当前“{CATEGORY_LABELS[category]}”分类的全部文件夹，不受当前目录限制。</p>}
          </div>

          <AnimatePresence>
            {selectionMode && (
              <BulkToolbar
                selectedCount={selectedIds.size}
                allPageSelected={allPageSelected}
                pageCount={visibleAssets.length}
                moveOptions={currentMoveFolderOptions}
                moveTarget={moveTargetFolderId}
                moveDisabled={categoryRootMissing || Boolean(foldersError)}
                onTogglePage={toggleSelectPage}
                onMoveTarget={setMoveTargetFolderId}
                onMove={() => {
                  const option = currentMoveFolderOptions.find(item => item.value === moveTargetFolderId);
                  if (option) setBulkMoveConfirm({ assetIds: Array.from(selectedIds), folderId: moveTargetFolderId, folderLabel: option.label });
                }}
                onDelete={() => setBulkDeleteIds(Array.from(selectedIds))}
                onCancel={clearSelection}
              />
            )}
          </AnimatePresence>

          {actionError && !folderModal && !folderToDelete && !assetToMove && !assetToDelete && !bulkMoveConfirm && !bulkDeleteIds && <p role="alert" className="product-field-error rounded-xl border border-red-400/25 bg-red-400/5 p-3">{actionError}</p>}
          <p ref={liveRegionRef} className="sr-only" role="status" aria-live="polite" />
          <AssetResults
            key={JSON.stringify([category, activeFolderId, appliedSearch])}
            assets={visibleAssets}
            loading={cardsLoading}
            error={cardsError}
            errorKind={folderResolutionError ? 'folders' : 'assets'}
            emptyKind={emptyKind}
            category={category}
            activeFolderName={activeFolder?.name}
            search={appliedSearch}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            detailLoadingId={detailLoadingId}
            showFolder={searchActive}
            getFolderLabel={asset => asset.folderId === activeRootFolderId ? '主目录' : categoryFolders.find(folder => folder.id === asset.folderId)?.name ?? '主目录'}
            getMoveOptions={asset => categoryRootMissing || foldersError ? [] : folderOptionsForSource(asset.source, asset.folderId)}
            onRetry={folderResolutionError ? onFoldersRetry : onAssetPageRetry}
            onClearSearch={clearSearch}
            onAIStudioOpen={onAIStudioOpen}
            onOpen={asset => void openAssetDetail(asset)}
            onToggleSelected={toggleSelected}
            onDownload={asset => void downloadAsset(asset)}
            pendingDownloadIds={pendingDownloadIds}
            requestedDownloadIds={requestedDownloadIds}
            onRename={asset => void openAssetDetail(asset)}
            onMove={asset => setAssetToMove({ asset, targetId: '' })}
            onDelete={setAssetToDelete}
          />

          {!cardsError && !cardsLoading && visibleAssets.length > 0 && (
            <PaginationFooter count={visibleAssets.length} totalItems={pagination?.totalItems ?? visibleAssets.length} totalPages={pagination?.totalPages} unit="个素材" className="mt-4 border-t border-white/[0.08] pt-4">
              {pagination && <CursorPagination pagination={pagination} loading={cardsLoading} empty={false} onNavigate={navigatePage} label="数字资产翻页" />}
            </PaginationFooter>
          )}
        </main>
      </div>

      {folderBrowserOpen && (
        <ResponsiveFolderDialog title="选择文件夹" onClose={() => setFolderBrowserOpen(false)}>
          <FolderSidebar
            category={category}
            rootFolderId={activeRootFolderId}
            activeFolderId={activeFolderId}
            searchActive={searchActive}
            searchResultCount={visibleAssets.length}
            folders={categoryFolders}
            summary={summary}
            summaryKnown={summaryKnown}
            loading={foldersLoading}
            error={foldersError}
            onRetry={onFoldersRetry}
            onSelect={handleFolderSelect}
            onCreate={() => { setFolderBrowserOpen(false); setFolderName(''); setFolderModal({ mode: 'create' }); }}
            onRename={folder => { setFolderBrowserOpen(false); setFolderName(folder.name); setFolderModal({ mode: 'rename', folder }); }}
            onDelete={folder => { setFolderBrowserOpen(false); openFolderDelete(folder); }}
            compact
          />
        </ResponsiveFolderDialog>
      )}

      <AnimatePresence>
        {uploadOpen && <AssetUploadPanel key="upload-panel" library={library} initialFolderIds={category.startsWith('uploaded-') && activeFolderId ? { [category]: activeFolderId } : undefined} onClose={() => setUploadOpen(false)} onUploadFile={onUploadFile} onComplete={handleUploadComplete} />}

        {folderModal && (
          <Modal title={folderModal.mode === 'rename' ? '重命名文件夹' : `新建${SOURCE_LABELS[category]}文件夹`} closeDisabled={pendingAction === 'folder-save'} onClose={() => setFolderModal(null)}>
            <div className="space-y-4">{actionError && <p role="alert" className="product-field-error">{actionError}</p>}
              <label className="block text-xs text-gray-300">文件夹名称
                <input autoFocus value={folderName} onChange={event => setFolderName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void submitFolderModal(); }} className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-gray-400 focus:border-purple-400/60 focus:outline-none" />
              </label>
              <div className="flex justify-end gap-3"><Button variant="secondary" className="min-h-11" disabled={pendingAction === 'folder-save'} onClick={() => setFolderModal(null)}>取消</Button><Button className="min-h-11" loading={pendingAction === 'folder-save'} onClick={() => void submitFolderModal()}>{folderModal.mode === 'rename' ? '保存' : '创建'}</Button></div>
            </div>
          </Modal>
        )}

        {folderToDelete && (
          <Modal title="删除文件夹" role="alertdialog" closeDisabled={pendingAction === 'folder-delete'} onClose={() => setFolderToDelete(null)}>
            <div className="space-y-4">
              <p className="text-sm leading-6 text-gray-200">{folderDeleteAssetCount === 0 ? `确认删除空文件夹“${folderToDelete.folder.name}”？` : folderDeleteAssetCount === null ? `暂时无法确认“${folderToDelete.folder.name}”中的素材数量。为避免误删，请选择删除文件夹后的处理方式。` : `“${folderToDelete.folder.name}”中有 ${folderDeleteAssetCount} 个素材。删除文件夹后，如何处理？`}</p>
              {requiresFolderContentChoice(folderDeleteAssetCount) && <><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 p-3"><input type="radio" name="folder-delete-action" className="mt-1" checked={folderToDelete.contentAction === 'move-to-root'} onChange={() => setFolderToDelete(current => current && { ...current, contentAction: 'move-to-root' })} /><span><span className="block text-sm font-semibold text-white">移到主目录（推荐）</span><span className="mt-1 block text-xs text-gray-400">保留文件夹里的素材，只删除文件夹。</span></span></label><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3"><input type="radio" name="folder-delete-action" className="mt-1" checked={folderToDelete.contentAction === 'delete-assets'} onChange={() => setFolderToDelete(current => current && { ...current, contentAction: 'delete-assets' })} /><span><span className="block text-sm font-semibold text-red-200">同时删除内部素材</span><span className="mt-1 block text-xs text-red-200/70">此操作无法撤回。</span></span></label></>}
              {folderToDelete.contentAction === 'delete-assets' && <label className="block text-xs text-red-100">输入完整文件夹名称“{folderToDelete.folder.name}”确认永久删除<input value={folderDeleteConfirmation} onChange={event => setFolderDeleteConfirmation(event.target.value)} autoComplete="off" className="mt-2 h-11 w-full rounded-xl border border-red-400/40 bg-red-500/5 px-3 text-sm text-white focus:border-red-300 focus:outline-none" /></label>}
              <div className="flex justify-end gap-3"><Button variant="secondary" className="min-h-11" disabled={pendingAction === 'folder-delete'} onClick={() => { setFolderToDelete(null); setFolderDeleteConfirmation(''); }}>取消</Button><Button variant="danger" className="min-h-11" disabled={folderToDelete.contentAction === 'delete-assets' && folderDeleteConfirmation !== folderToDelete.folder.name} loading={pendingAction === 'folder-delete'} onClick={() => void confirmDeleteFolder()}>确认删除</Button></div>
            </div>
          </Modal>
        )}

        {assetToMove && (
          <Modal title={`移动“${assetToMove.asset.name}”`} closeDisabled={pendingAction === 'asset-move'} onClose={() => setAssetToMove(null)}>
            <div className="space-y-4">{actionError && <p role="alert" className="product-field-error">{actionError}</p>}<FolderSelect label="目标文件夹" value={assetToMove.targetId} options={folderOptionsForSource(assetToMove.asset.source, assetToMove.asset.folderId)} onChange={targetId => setAssetToMove(current => current && { ...current, targetId })} /><div className="flex justify-end gap-3"><Button variant="secondary" className="min-h-11" onClick={() => setAssetToMove(null)}>取消</Button><Button className="min-h-11" disabled={!assetToMove.targetId} loading={pendingAction === 'asset-move'} onClick={() => void confirmMoveAsset()}>移动</Button></div></div>
          </Modal>
        )}

        {assetToDelete && <ConfirmDeleteModal title="删除素材" description={`确认删除“${assetToDelete.name}”？此操作无法撤回。`} error={actionError} loading={pendingAction === 'asset-delete'} onClose={() => setAssetToDelete(null)} onConfirm={() => void confirmDeleteAsset()} />}
        {bulkDeleteIds && <ConfirmDeleteModal title="批量删除素材" description={`确认删除当前页已选择的 ${bulkDeleteIds.length} 个素材：${visibleAssets.filter(asset => bulkDeleteIds.includes(asset.id)).slice(0,3).map(asset => `“${asset.name}”`).join('、')}${bulkDeleteIds.length > 3 ? ` 等 ${bulkDeleteIds.length} 项` : ''}？此操作无法撤回。`} error={actionError} loading={pendingAction === 'bulk-delete'} onClose={() => setBulkDeleteIds(null)} onConfirm={() => void confirmBulkDelete()} />}
        {bulkMoveConfirm && <Modal title="批量移动素材" closeDisabled={pendingAction === 'bulk-move'} onClose={() => setBulkMoveConfirm(null)}><div className="space-y-4">{actionError && <p role="alert" className="product-field-error">{actionError}</p>}<p className="text-sm leading-6 text-gray-200">确认将当前页已选择的 {bulkMoveConfirm.assetIds.length} 个素材移动到“{bulkMoveConfirm.folderLabel}”？</p><div className="flex justify-end gap-3"><Button variant="secondary" className="min-h-11" onClick={() => setBulkMoveConfirm(null)}>取消</Button><Button className="min-h-11" loading={pendingAction === 'bulk-move'} onClick={() => void confirmBulkMove()}>确认移动</Button></div></div></Modal>}

        {detailAsset && (
          <AssetPreviewModal
            key={`detail-${detailAsset.id}`}
            asset={detailAsset}
            mode="editable"
            folders={listFolders(library, detailAsset.source).filter(folder => !folder.isSystem)}
            rootFolderId={getSystemFolderId(library, detailAsset.source)}
            onClose={closeAssetDetail}
            onUpdate={patch => updateDetailAsset(detailAsset.id, patch)}
            onDownload={downloadDetailAsset}
            onDelete={() => setAssetToDelete(detailAsset)}
            onReuseGenerate={onReuseGenerate}
          />
        )}
      </AnimatePresence>
    </AppPage>
  );
}

function CompactSummary({ summary,loading,ready,error,onRetry }: { summary: AssetSummary; loading: boolean; ready: boolean; error: unknown; onRetry: () => void }) {
  const items = [
    { label: '全部资产', value: summary.total, icon: FolderOpen, accent: 'violet' as const, gradient: 'from-violet-600 to-purple-600' },
    { label: '视频文件', value: summary.byType.video, icon: Video, accent: 'blue' as const, gradient: 'from-blue-600 to-indigo-600' },
    { label: '图片文件', value: summary.byType.image, icon: ImageIcon, accent: 'pink' as const, gradient: 'from-pink-600 to-purple-600' },
    { label: '音频文件', value: summary.byType.audio, icon: Music2, accent: 'cyan' as const, gradient: 'from-cyan-600 to-blue-600' },
  ];
  return (
    <section aria-label="资产统计" aria-busy={loading}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(item => {
          const Icon = item.icon;
          return (
            <StatCard
              key={item.label}
              tone="product"
              accent={item.accent}
              label={item.label}
              value={ready ? item.value : '—'}
              icon={<Icon className="h-5 w-5" aria-hidden="true" />}
              gradient={item.gradient}
            />
          );
        })}
      </div>
      {Boolean(error) && <div className="mt-3"><InlineError title="资产统计加载失败" onRetry={onRetry} /></div>}
    </section>
  );
}

interface FolderSidebarProps {
  category: AssetSource;
  rootFolderId: string | null;
  activeFolderId: string | null;
  searchActive: boolean;
  searchResultCount: number;
  folders: AssetFolder[];
  summary: AssetSummary;
  summaryKnown: boolean;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (folderId: string | null) => void;
  onCreate: () => void;
  onRename: (folder: AssetFolder) => void;
  onDelete: (folder: AssetFolder) => void;
  compact?: boolean;
}

function FolderSidebar({ category,rootFolderId,activeFolderId,searchActive,searchResultCount,folders,summary,summaryKnown,loading,error,onRetry,onSelect,onCreate,onRename,onDelete,compact = false }: FolderSidebarProps) {
  const rootCount = getKnownFolderAssetCount(summary, summaryKnown, rootFolderId);
  const currentFolderRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!searchActive && activeFolderId) currentFolderRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeFolderId,searchActive]);
  return (
    <nav data-testid={!compact ? 'digital-asset-folder-sidebar' : undefined} aria-label={`${CATEGORY_LABELS[category]}文件夹`} className={`${compact ? '' : 'sticky top-4'} overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d0d13]`}>
      <div className="flex items-center justify-between border-b border-white/[0.08] px-3 py-3"><div><h2 className="text-sm font-semibold text-white">文件夹</h2><p className="mt-0.5 text-[11px] text-gray-400">{folders.length} 个自定义目录</p></div><button type="button" aria-label={`新建${CATEGORY_LABELS[category]}文件夹`} disabled={!rootFolderId || loading} onClick={onCreate} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"><FolderPlus className="h-4 w-4" /></button></div>
      <div className={`${compact ? 'max-h-[58dvh]' : 'max-h-[calc(100dvh-330px)]'} ${loading || error || folders.length > 0 ? 'min-h-32' : ''} overflow-y-auto p-2`}>
        {loading ? <FolderSkeleton /> : error ? <InlineError title="文件夹加载失败" onRetry={onRetry} compact /> : (
          <ul className="space-y-1">
            {searchActive && <li className="grid grid-cols-[minmax(0,1fr)_48px]"><div aria-current="page" className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl bg-violet-500/15 px-3 text-left text-sm text-violet-100"><Search className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">搜索结果</span><span className="w-8 shrink-0 text-right text-xs tabular-nums text-gray-300">{searchResultCount}</span></div><span aria-hidden="true" /></li>}
            <li className={`grid grid-cols-[minmax(0,1fr)_48px] rounded-xl ${!searchActive && !activeFolderId ? 'bg-violet-500/15' : ''}`}><button type="button" aria-current={!searchActive && !activeFolderId ? 'page' : undefined} aria-label={`选择主目录，${rootCount === null ? '素材数量未知' : `${rootCount} 个素材`}`} onClick={() => onSelect(null)} className={`flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-3 text-left text-sm transition-colors ${!searchActive && !activeFolderId ? 'text-violet-100' : 'text-gray-300 hover:bg-white/5 hover:text-white'}`}><FolderOpen className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">主目录</span><span className="w-8 shrink-0 text-right text-xs tabular-nums text-gray-400">{rootCount ?? '—'}</span></button><span aria-hidden="true" /></li>
            {folders.map(folder => {
              const count = getKnownFolderAssetCount(summary, summaryKnown, folder.id);
              const selected = !searchActive && folder.id === activeFolderId;
              return (
                <li key={folder.id} className={`group grid grid-cols-[minmax(0,1fr)_48px] items-center rounded-xl ${selected ? 'bg-violet-500/15' : 'hover:bg-white/5'}`}>
                  <button ref={selected ? currentFolderRef : undefined} type="button" aria-current={selected ? 'page' : undefined} aria-label={`打开文件夹 ${folder.name}，${count === null ? '素材数量未知' : `${count} 个素材`}`} onClick={() => onSelect(folder.id)} className={`flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-3 text-left text-sm ${selected ? 'text-violet-100' : 'text-gray-300'}`}><FolderOpen className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{folder.name}</span><span className="w-8 shrink-0 text-right text-xs tabular-nums text-gray-400">{count ?? '—'}</span></button>
                  <ObjectMenu variant="transparent" className="flex w-12 shrink-0 justify-center" label={`更多操作：文件夹 ${folder.name}`} items={[{ id: 'rename', label: '重命名', icon: <Edit3 className="h-4 w-4" />, onSelect: () => onRename(folder) },{ id: 'delete', label: '删除文件夹', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => onDelete(folder) }]} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}

function AssetResults(props: {
  assets: Asset[];
  loading: boolean;
  error: unknown;
  errorKind: 'folders' | 'assets';
  emptyKind: 'search' | 'folder' | 'category';
  category: AssetSource;
  activeFolderName?: string;
  search: string;
  selectionMode: boolean;
  selectedIds: Set<string>;
  detailLoadingId: string | null;
  showFolder: boolean;
  pendingDownloadIds: Set<string>;
  requestedDownloadIds: Set<string>;
  getFolderLabel: (asset: Asset) => string;
  getMoveOptions: (asset: Asset) => Array<{ value: string; label: string }>;
  onRetry: () => void;
  onClearSearch: () => void;
  onAIStudioOpen?: () => void;
  onOpen: (asset: Asset) => void;
  onToggleSelected: (assetId: string) => void;
  onDownload: (asset: Asset) => void;
  onRename: (asset: Asset) => void;
  onMove: (asset: Asset) => void;
  onDelete: (asset: Asset) => void;
}) {
  if (props.loading && props.assets.length === 0) return <AssetLoadingState />;
  if (props.error) return <ResultsError kind={props.errorKind} onRetry={props.onRetry} />;
  if (props.assets.length === 0) return <AssetEmptyState {...props} />;
  return (
    <>
      {props.loading && <p role="status" className="mt-3 text-sm text-[var(--product-text-secondary)]">正在更新素材，当前显示上次加载结果…</p>}
    <ul data-testid="digital-asset-grid" aria-label="素材列表" aria-busy={props.loading} className="digital-asset-card-grid mt-4">
      {props.assets.map(asset => <li key={asset.id}><AssetCard asset={asset} folderLabel={props.showFolder ? props.getFolderLabel(asset) : undefined} selectionMode={props.selectionMode} selected={props.selectedIds.has(asset.id)} loading={props.detailLoadingId === asset.id} downloadPending={props.pendingDownloadIds.has(asset.id)} downloadRequested={props.requestedDownloadIds.has(asset.id) || Boolean(asset.downloadRequestedAt ?? asset.downloadedAt)} moveOptions={props.getMoveOptions(asset)} onOpen={() => props.onOpen(asset)} onSelect={() => props.onToggleSelected(asset.id)} onDownload={() => props.onDownload(asset)} onRename={() => props.onRename(asset)} onMove={() => props.onMove(asset)} onDelete={() => props.onDelete(asset)} /></li>)}
    </ul>
    </>
  );
}

function AssetCard({ asset,folderLabel,selectionMode,selected,loading,downloadPending,downloadRequested,moveOptions,onOpen,onSelect,onDownload,onRename,onMove,onDelete }: { asset: Asset; folderLabel?: string; selectionMode: boolean; selected: boolean; loading: boolean; downloadPending: boolean; downloadRequested: boolean; moveOptions: Array<{ value: string; label: string }>; onOpen: () => void; onSelect: () => void; onDownload: () => void; onRename: () => void; onMove: () => void; onDelete: () => void }) {
  const mediaMeta = asset.type === 'image' ? asset.dimensions ?? '尺寸未知' : asset.duration ?? '时长未知';
  const downloadActionLabel = downloadPending
    ? `正在准备下载素材 ${asset.name}`
    : downloadRequested
      ? `重新下载素材 ${asset.name}（已发起过下载）`
      : `下载素材 ${asset.name}`;
  const menuItems: ObjectMenuItem[] = [
    { id: 'rename', label: '重命名', icon: <Edit3 className="h-4 w-4" />, onSelect: onRename },
    { id: 'move', label: '移动到文件夹', icon: <MoveRight className="h-4 w-4" />, disabled: moveOptions.length === 0, onSelect: onMove },
    { id: 'delete', label: '删除', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: onDelete },
  ];
  return (
    <article data-selected={selected} className={`product-media-card group relative overflow-visible rounded-2xl border ${selected ? 'border-purple-400 ring-2 ring-purple-500/25' : 'border-white/[0.09] hover:border-white/20'}`}>
      <div className="relative aspect-[9/16] overflow-hidden rounded-t-2xl bg-black/20">
        <AssetThumbnail asset={asset} decorative className="h-full w-full" />
        <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-2">
          <span className={`inline-flex min-h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-white shadow-sm ${asset.type === 'video' ? 'bg-purple-800' : asset.type === 'audio' ? 'bg-cyan-800' : 'bg-blue-800'}`}><span aria-hidden="true">{asset.type === 'video' ? <Video className="h-3 w-3" /> : asset.type === 'audio' ? <Music2 className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}</span>{asset.type === 'image' ? '图片' : asset.duration ?? '时长未知'}</span>
          {!selectionMode && <ObjectMenu label={`更多操作：${asset.name}`} items={menuItems} />}
        </div>
        <button type="button" aria-label={selectionMode ? `选择素材 ${asset.name}` : `打开素材 ${asset.name}`} aria-pressed={selectionMode ? selected : undefined} aria-busy={loading || undefined} onClick={selectionMode ? onSelect : onOpen} className="absolute inset-0 z-10 flex items-center justify-center rounded-t-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-300">
          {selectionMode ? <span className={`inline-flex h-11 w-11 items-center justify-center rounded-full border-2 shadow-xl ${selected ? 'border-[var(--product-focus)] bg-[var(--product-button-bg)] text-[var(--product-button-text)]' : 'border-white/70 bg-[var(--product-surface-base)] text-white'}`}>{selected ? <Check className="h-5 w-5" /> : <Square className="h-5 w-5" />}</span> : loading ? <RefreshCw className="h-7 w-7 animate-spin text-white" /> : <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-[var(--product-surface-base)] text-white product-preview-action backdrop-blur"><span aria-hidden="true">{asset.type === 'image' ? <Eye className="h-5 w-5" /> : <Play className="h-5 w-5" />}</span></span>}
        </button>
        {!selectionMode && <button type="button" data-download-state={downloadRequested ? 'requested' : 'idle'} aria-label={downloadActionLabel} title={downloadActionLabel} aria-busy={downloadPending || undefined} disabled={downloadPending} onClick={event => { event.stopPropagation(); onDownload(); }} className={`product-media-surface absolute bottom-2 right-2 z-20 inline-flex h-11 w-11 items-center justify-center rounded-xl border shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 disabled:cursor-wait ${downloadRequested ? 'border-emerald-300/35 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200' : 'border-white/20 bg-black/75 text-white hover:bg-black'}`}>{downloadPending ? <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}</button>}
      </div>
      <div className="p-3">
        <p title={asset.name} className="line-clamp-2 min-h-10 text-sm font-medium leading-5 text-white">{asset.name}</p>
        {folderLabel && <p className="mt-1 truncate text-[11px] text-violet-200">文件夹：{folderLabel}</p>}
        <p className="mt-1.5 truncate text-xs text-gray-300">{mediaMeta} · {asset.size}</p>
        <time dateTime={asset.createdAt} className="mt-1 block text-xs text-gray-400">{asset.createdAt.slice(0,10)}</time>
      </div>
    </article>
  );
}

function BulkToolbar({ selectedCount,allPageSelected,pageCount,moveOptions,moveTarget,moveDisabled,onTogglePage,onMoveTarget,onMove,onDelete,onCancel }: { selectedCount: number; allPageSelected: boolean; pageCount: number; moveOptions: Array<{ value: string; label: string }>; moveTarget: string; moveDisabled: boolean; onTogglePage: () => void; onMoveTarget: (value: string) => void; onMove: () => void; onDelete: () => void; onCancel: () => void }) {
  return <motion.div initial={{ opacity: 0,y: 4 }} animate={{ opacity: 1,y: 0 }} exit={{ opacity: 0,y: 4 }} transition={{ duration: 0.18 }} className="fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2 border-t border-purple-400/25 bg-[var(--product-surface-floating)] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl backdrop-blur md:sticky md:inset-x-auto md:top-0 md:z-30 md:mx-0 md:mt-3 md:rounded-xl md:border"><div className="flex flex-wrap items-center gap-2"><p role="status" aria-live="polite" className="mr-auto text-sm font-semibold text-white">已选择 {selectedCount} 个</p><button type="button" aria-pressed={allPageSelected} disabled={pageCount === 0} onClick={onTogglePage} className="min-h-11 rounded-lg px-3 text-xs font-semibold text-violet-200 hover:bg-white/10">{allPageSelected ? '取消全选本页' : `选择本页 ${pageCount} 项`}</button><button type="button" onClick={onCancel} className="min-h-11 rounded-lg px-3 text-xs text-gray-300 hover:bg-white/10">取消</button></div><div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2"><FolderSelect value={moveTarget} placeholder={moveOptions.length ? '选择目标文件夹' : '没有可移动的文件夹'} options={moveOptions} disabled={selectedCount === 0 || moveDisabled || moveOptions.length === 0} onChange={onMoveTarget} size="md" /><Button variant="secondary" size="sm" className="min-h-11" icon={<MoveRight className="h-3.5 w-3.5" />} disabled={selectedCount === 0 || !moveTarget || moveDisabled} onClick={onMove}>移动</Button><Button variant="danger" size="sm" className="min-h-11" icon={<Trash2 className="h-3.5 w-3.5" />} disabled={selectedCount === 0} onClick={onDelete}>删除</Button></div></motion.div>;
}

function AssetEmptyState({ emptyKind,category,activeFolderName,search,onRetry,onClearSearch,onAIStudioOpen }: { emptyKind: 'search' | 'folder' | 'category'; category: AssetSource; activeFolderName?: string; search: string; onRetry: () => void; onClearSearch: () => void; onAIStudioOpen?: () => void }) {
  const uploaded = category.startsWith('uploaded-');
  const title = emptyKind === 'search' ? `没有找到“${search}”` : emptyKind === 'folder' ? `“${activeFolderName}”还是空的` : `暂无${CATEGORY_LABELS[category]}素材`;
  const description = emptyKind === 'search' ? `已搜索${CATEGORY_LABELS[category]}的全部文件夹，请尝试其他关键词。` : uploaded ? '使用上方“上传素材”添加内容，素材会保存在当前分类中。' : '完成 AI 创作后，生成结果会自动归档到这里。';
  return <div className="mt-4 flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-5 text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-200">{emptyKind === 'search' ? <Search className="h-7 w-7" /> : <ImageIcon className="h-7 w-7" />}</div><h3 className="mt-4 text-base font-semibold text-white">{title}</h3><p className="mt-2 max-w-md text-sm leading-6 text-gray-300">{description}</p><div className="mt-5 flex flex-wrap justify-center gap-2">{emptyKind === 'search' ? <Button variant="secondary" className="min-h-11" onClick={onClearSearch}>清除搜索</Button> : !uploaded && onAIStudioOpen ? <Button className="min-h-11" onClick={onAIStudioOpen}>前往 AI Studio</Button> : null}<Button variant="ghost" className="min-h-11" icon={<RefreshCw className="h-4 w-4" />} onClick={onRetry}>刷新</Button></div></div>;
}

function ResultsError({ kind,onRetry }: { kind: 'folders' | 'assets'; onRetry: () => void }) { return <div role="alert" className="mt-4 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-red-500/25 bg-red-500/[0.07] px-5 text-center"><Info className="h-8 w-8 text-red-300" /><h3 className="mt-3 font-semibold text-white">{kind === 'folders' ? '文件夹加载失败' : '素材加载失败'}</h3><p className="mt-2 text-sm text-gray-300">{kind === 'folders' ? '无法确认当前分类的主目录，已暂停目录相关操作；请检查网络后重试。' : '当前内容仍未被当作空文件夹处理，请检查网络后重试。'}</p><Button className="mt-5 min-h-11" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={onRetry}>重新加载</Button></div>; }
function InlineError({ title,onRetry,compact = false }: { title: string; onRetry: () => void; compact?: boolean }) { return <div role="alert" className={`flex items-center gap-3 rounded-xl border border-red-500/25 bg-red-500/10 text-sm text-red-100 ${compact ? 'm-2 p-3' : 'p-4'}`}><Info className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{title}</span><button type="button" onClick={onRetry} className="min-h-11 rounded-lg px-3 text-xs font-semibold hover:bg-white/10">重试</button></div>; }
function FolderSkeleton() { return <div aria-hidden="true" className="space-y-2 p-1">{Array.from({ length: 5 },(_,index) => <div key={index} className="h-11 animate-pulse rounded-xl bg-white/5" />)}</div>; }
function AssetLoadingState() {
  const [showIndicator, setShowIndicator] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShowIndicator(true), 200);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div role="status" aria-label="正在加载素材" aria-busy="true" className="mt-4 flex min-h-72 items-center justify-center">
      {showIndicator && <span className="flex items-center gap-2 text-sm text-[var(--product-text-secondary)]"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />正在加载素材</span>}
    </div>
  );
}

function ResponsiveFolderDialog({ title,children,onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const titleId = useId();
  return <Dialog onClose={onClose} titleId={titleId} rootClassName="items-end !p-0 md:items-stretch md:justify-start" panelClassName="max-h-[78dvh] md:h-full md:max-h-none md:max-w-[320px]" zIndexClass="z-50"><motion.div initial={{ y: 12,opacity: 0 }} animate={{ y: 0,opacity: 1 }} exit={{ y: 12,opacity: 0 }} transition={{ duration: 0.2 }} className="h-full w-full overflow-hidden rounded-t-3xl bg-[var(--product-surface-floating)] p-3 shadow-2xl md:rounded-none md:p-4"><div className="mb-3 flex items-center justify-between px-1"><h2 id={titleId} className="text-base font-semibold text-white">{title}</h2><button type="button" aria-label={`关闭${title}`} onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-gray-200 hover:bg-white/10"><X className="h-5 w-5" /></button></div>{children}</motion.div></Dialog>;
}
function ConfirmDeleteModal({ title,description,error,loading,onClose,onConfirm }: { title: string; description: string; error?: string; loading: boolean; onClose: () => void; onConfirm: () => void }) { return <Modal title={title} role="alertdialog" closeDisabled={loading} onClose={onClose}><div className="space-y-4"><div className="flex gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100"><Info className="h-5 w-5 shrink-0" /><p>{description}</p></div>{error && <p role="alert" className="product-field-error">{error}</p>}<div className="flex justify-end gap-3"><Button variant="secondary" className="min-h-11" disabled={loading} onClick={onClose}>取消</Button><Button variant="danger" className="min-h-11" loading={loading} onClick={onConfirm}>确认删除</Button></div></div></Modal>; }

function Modal({ title,children,onClose,closeDisabled = false,role = 'dialog' }: { title: string; children: ReactNode; onClose: () => void; closeDisabled?: boolean; role?: 'dialog' | 'alertdialog' }) {
  const titleId = useId();
  return <Dialog onClose={onClose} titleId={titleId} role={role} closeDisabled={closeDisabled} panelClassName="max-w-lg"><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}><Card variant="modal"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><h2 id={titleId} className="text-base font-semibold text-white">{title}</h2><button type="button" aria-label={`关闭${title}`} onClick={onClose} disabled={closeDisabled} className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white disabled:opacity-50"><X className="h-4 w-4" /></button></div><div className="max-h-[calc(100dvh-8rem)] overflow-y-auto p-5">{children}</div></Card></motion.div></Dialog>;
}
