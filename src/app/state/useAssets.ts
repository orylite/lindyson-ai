import { useQuery,useQueryClient } from '@tanstack/react-query';
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { toast } from 'sonner';
import { uploadAssetFile as uploadAssetFileToStorage,type UploadProgressEvent } from '../api/assetUpload';
import { isPaginationSnapshotChanged,retryUnlessPaginationSnapshotChanged } from '../api/client';
import type { CursorPage,PagePosition } from '../api/cursor';
import * as mutations from '../api/mutations';
import { privateQueryKey } from '../api/queryClient';
import * as queries from '../api/queries';
import type {
  Asset,
  AssetGenerationMeta,
  AssetLibraryState,
  AssetSort,
  AssetSource,
  AssetSummary,
} from '../data/assets';
import { prepareAssetDownload,startBrowserDownload,type DownloadableAsset } from '../utils/assetDownload';
import { formatBeijingDateTime } from '../utils/beijingTime';
import type { AppTab } from './routing';
import {
  cursorPageRequestIdentity,
  useCursorPagination,
  type CursorPageRequest,
} from './useCursorPagination';

interface UseAssetsOptions {
  setActiveTab: (tab: string) => void;
  activeTab: AppTab;
  accountEmail: string;
  sessionEpoch: number;
}

export interface AssetCardFilters {
  source?: AssetSource;
  type?: Asset['type'];
  folderId?: string | null;
  search?: string;
  sort?: AssetSort;
}

export type AssetFolderContentAction = 'move-to-root' | 'delete-assets';

const DEFAULT_ASSET_SORT: AssetSort = 'created-desc';
const DEFAULT_ASSET_PAGE_LIMIT = 24;
const DIGITAL_ASSET_PAGE_LIMIT = 30;

export function getAssetCardsPageLimit(activeTab: AppTab) {
  return activeTab === 'digital-assets' ? DIGITAL_ASSET_PAGE_LIMIT : DEFAULT_ASSET_PAGE_LIMIT;
}

export function isAssetCardsPageLimitReady(activeTab: AppTab, request: CursorPageRequest) {
  return request.limit === getAssetCardsPageLimit(activeTab);
}

/** 资产查询、上传和服务端 CRUD；生产状态不再维护本地伪数据。 */
export function useAssets({ setActiveTab, activeTab, accountEmail, sessionEpoch }: UseAssetsOptions) {
  const queryClient = useQueryClient();
  const [reuseGenerationDraft, setReuseGenerationDraft] = useState<AssetGenerationMeta | null>(null);
  const [filters, setFilters] = useState<AssetCardFilters>({ sort: DEFAULT_ASSET_SORT });
  const [manualAssetsEnabled, setManualAssetsEnabled] = useState(false);
  const [filterOwner, setFilterOwner] = useState<AppTab | null>(null);
  const uploadControllersRef = useRef(createUploadControllerRegistry());
  const committedUploadIdsRef = useRef(new Set<string>());
  const activeSessionEpochRef = useRef(sessionEpoch);
  const snapshotNoticeRef = useRef(false);
  activeSessionEpochRef.current = sessionEpoch;
  const assetCardsPageLimit = getAssetCardsPageLimit(activeTab);
  const paging = useCursorPagination(assetCardsPageLimit);
  const pageLimitReady = isAssetCardsPageLimitReady(activeTab, paging.request);
  const assetFocusSource: AssetSource = 'ai-video';
  const routeNeedsAssetMetadata = activeTab === 'digital-assets' || activeTab === 'tiktok-publish';
  const manualAssetContextActive = activeTab === 'ai-studio' && manualAssetsEnabled;
  const assetMetadataEnabled = Boolean(accountEmail) && (routeNeedsAssetMetadata || manualAssetContextActive);
  // 所有资产卡片消费者都必须先声明自己的目标筛选，避免路由切换时
  // 先使用上一页遗留的分类、目录或搜索条件请求 cards。
  const cardsEnabled = pageLimitReady && Boolean(accountEmail) && (
    filterOwner === activeTab && (routeNeedsAssetMetadata || manualAssetContextActive)
  );
  const cardsKey = privateQueryKey(
    sessionEpoch,
    'assets',
    'cards',
    filters,
    cursorPageRequestIdentity(paging.request),
  );
  const foldersKey = privateQueryKey(sessionEpoch, 'assets', 'folders');
  const summaryKey = privateQueryKey(sessionEpoch, 'assets', 'summary');

  const cardsQuery = useQuery({
    queryKey: cardsKey,
    queryFn: ({ signal }) => queries.getAssetCardsPage({ ...filters, ...paging.request }, signal),
    enabled: cardsEnabled,
    placeholderData: (previousData, previousQuery) => (
      previousQuery && canReuseAssetPagePlaceholderForNavigation(
        readAssetFiltersFromQueryKey(previousQuery.queryKey),
        filters,
        readAssetPageRequest(previousQuery.queryKey),
        paging.request,
      )
        ? previousData
        : undefined
    ),
    retry: retryUnlessPaginationSnapshotChanged,
    staleTime: 30_000,
  });
  const foldersQuery = useQuery({
    queryKey: foldersKey,
    queryFn: ({ signal }) => queries.getAssetFolders(undefined, signal),
    enabled: assetMetadataEnabled,
    staleTime: 5 * 60_000,
  });
  const summaryQuery = useQuery({
    queryKey: summaryKey,
    queryFn: ({ signal }) => queries.getAssetSummary(signal),
    enabled: assetMetadataEnabled,
    staleTime: 30_000,
  });

  const assetLibrary = useMemo<AssetLibraryState>(() => ({
    assets: cardsQuery.data?.items ?? [],
    folders: foldersQuery.data ?? [],
  }), [cardsQuery.data?.items, foldersQuery.data]);

  useEffect(() => {
    if (pageLimitReady) return;
    // 路由在数字资产与素材选择器之间切换时，先停用旧容量请求，
    // 再以新容量回到首页，避免把 24/30 条的签名游标跨容量重放。
    paging.reset();
  }, [pageLimitReady, paging.reset]);

  useEffect(() => {
    if (!pageLimitReady || cardsQuery.isFetching || !cardsQuery.data) return;
    paging.adoptSnapshot(cardsQuery.data.pagination);
    snapshotNoticeRef.current = false;
  }, [cardsQuery.data, cardsQuery.isFetching, pageLimitReady, paging.adoptSnapshot]);

  useEffect(() => {
    if (!pageLimitReady || !isPaginationSnapshotChanged(cardsQuery.error)) return;
    paging.reset();
    if (!snapshotNoticeRef.current) {
      snapshotNoticeRef.current = true;
      toast.info('列表已更新，已返回第 1 页');
    }
  }, [cardsQuery.error, pageLimitReady, paging.reset]);

  useEffect(() => {
    if (pageLimitReady && !cardsQuery.isFetching && cardsQuery.data?.items.length === 0 && paging.request.position !== 'first') {
      paging.recoverEmptyPage(cardsQuery.data.pagination);
    }
  }, [cardsQuery.data, cardsQuery.isFetching, pageLimitReady, paging.recoverEmptyPage, paging.request.position]);

  useEffect(() => {
    uploadControllersRef.current.abortAll();
    committedUploadIdsRef.current.clear();
    setManualAssetsEnabled(false);
    setFilterOwner(null);
    setFilters({ sort: DEFAULT_ASSET_SORT });
    paging.reset();
  }, [sessionEpoch]);

  const prepareAssetLibrary = useCallback(() => {
    setManualAssetsEnabled(true);
  }, []);

  const setAssetFilters = useCallback((next: AssetCardFilters) => {
    setManualAssetsEnabled(true);
    setFilterOwner(activeTab);
    setFilters(current => sameAssetFilters(current, next) ? current : normalizeAssetFilters(next));
    paging.reset();
  }, [activeTab, paging.reset]);

  const navigateAssetPage = useCallback((position: PagePosition) => {
    paging.navigate(position, cardsQuery.data?.pagination);
  }, [cardsQuery.data?.pagination, paging.navigate]);

  const loadAssetDetail = useCallback((assetId: string) => queryClient.fetchQuery({
    queryKey: privateQueryKey(sessionEpoch, 'assets', 'detail', assetId),
    queryFn: ({ signal }) => queries.getAssetDetail(assetId, signal),
    staleTime: 5 * 60_000,
  }), [queryClient, sessionEpoch]);

  const reuseGeneratedAsset = useCallback(async (asset: Asset) => {
    const detail = asset.generation ? asset : await loadAssetDetail(asset.id);
    if (!detail.generation) return;
    setReuseGenerationDraft(detail.generation);
    setActiveTab('ai-studio');
  }, [loadAssetDetail, setActiveTab]);

  const createAssetFolder = useCallback(async (source: AssetSource, name: string) => {
    const created = await mutations.createFolder({ source, name });
    queryClient.setQueryData<AssetLibraryState['folders']>(foldersKey, current => insertNewestFolder(current ?? [], created));
    return created;
  }, [foldersKey, queryClient]);

  const renameAssetFolder = useCallback(async (folderId: string, name: string) => {
    const updated = await mutations.renameFolder(folderId, name);
    queryClient.setQueryData<AssetLibraryState['folders']>(foldersKey, current => (
      (current ?? []).map(folder => folder.id === updated.id ? updated : folder)
    ));
  }, [foldersKey, queryClient]);

  const deleteAssetFolder = useCallback(async (folderId: string, contentAction: AssetFolderContentAction) => {
    const folders = queryClient.getQueryData<AssetLibraryState['folders']>(foldersKey) ?? [];
    const deletedFolder = folders.find(folder => folder.id === folderId);
    const rootFolder = deletedFolder
      ? folders.find(folder => folder.source === deletedFolder.source && folder.isSystem)
      : undefined;
    const response = await mutations.deleteFolder(folderId, contentAction);
    const appliedContentAction = response.contentAction;
    queryClient.setQueryData<AssetLibraryState['folders']>(foldersKey, current => (
      (current ?? []).filter(folder => folder.id !== folderId)
    ));
    updateCachedAssetPages(queryClient, sessionEpoch, items => (
      appliedContentAction === 'move-to-root' && rootFolder
        ? items.map(asset => asset.folderId === folderId ? { ...asset, folderId: rootFolder.id } : asset)
        : items.filter(asset => asset.folderId !== folderId)
    ));
    updateCachedAssetDetailsForDeletedFolder(queryClient, sessionEpoch, folderId, appliedContentAction, rootFolder?.id);
    updateCachedSummaryForDeletedFolder(
      queryClient,
      summaryKey,
      folderId,
      appliedContentAction,
      rootFolder?.id,
    );
    void queryClient.invalidateQueries({
      queryKey: privateQueryKey(sessionEpoch, 'assets', 'cards'),
      refetchType: 'active',
    });
    void queryClient.invalidateQueries({ queryKey: summaryKey });
    return response;
  }, [foldersKey, queryClient, sessionEpoch, summaryKey]);

  const uploadAssetFile = useCallback(async (
    file: File,
    folderId: string | null,
    onProgress?: (event: UploadProgressEvent) => void,
    signal?: AbortSignal,
  ) => {
    const requestedSessionEpoch = sessionEpoch;
    const controller = uploadControllersRef.current.create();
    const combined = combineUploadSignals(controller.signal, signal);
    try {
      const uploaded = await uploadAssetFileToStorage({ file, folderId, onProgress, signal: combined.signal });
      if (activeSessionEpochRef.current !== requestedSessionEpoch) {
        throw new DOMException('会话已切换，上传结果已废弃', 'AbortError');
      }
      if (!committedUploadIdsRef.current.has(uploaded.id)) {
        if (!commitUploadedAssetForCurrentSession(
          queryClient,
          requestedSessionEpoch,
          activeSessionEpochRef.current,
          uploaded,
        )) {
          throw new DOMException('会话已切换，上传结果已废弃', 'AbortError');
        }
        committedUploadIdsRef.current.add(uploaded.id);
      }
      return uploaded;
    } finally {
      combined.cleanup();
      uploadControllersRef.current.release(controller);
    }
  }, [queryClient, sessionEpoch]);

  const updateAssetRecord = useCallback(async (assetId: string, patch: Partial<Omit<Asset, 'id'>>) => {
    const updated = await mutations.updateAsset(assetId, { name: patch.name, folderId: patch.folderId });
    updateCachedAssetPages(queryClient, sessionEpoch, items => items.map(asset => asset.id === updated.id ? updated : asset));
    invalidateAssetPagesMissingCards(queryClient, sessionEpoch, [updated]);
    queryClient.setQueryData<Asset>(privateQueryKey(sessionEpoch, 'assets', 'detail', assetId), current => (
      current ? mergeAssetCardIntoDetail(current, updated) : current
    ));
    void queryClient.invalidateQueries({ queryKey: summaryKey });
  }, [queryClient, sessionEpoch, summaryKey]);

  const downloadAssetRecord = useCallback(async (asset: DownloadableAsset) => {
    const assetId = asset.id;
    const download = await prepareAssetDownload(asset);
    if (!download || !assetId) return null;

    const downloadRequestedAt = formatBeijingDateTime(download.downloadRequestedAt).slice(0, 16);
    recordAssetDownloadInCache(queryClient, sessionEpoch, assetId, downloadRequestedAt);
    startBrowserDownload(download.url, download.filename);
    return download;
  }, [queryClient, sessionEpoch]);

  const deleteAssetRecord = useCallback(async (assetId: string) => {
    await mutations.deleteAsset(assetId);
    updateCachedAssetPages(queryClient, sessionEpoch, items => items.filter(asset => asset.id !== assetId));
    removeCachedAssetDetails(queryClient, sessionEpoch, [assetId]);
    void queryClient.invalidateQueries({ queryKey: summaryKey });
  }, [queryClient, sessionEpoch, summaryKey]);

  const bulkMoveAssetRecords = useCallback(async (assetIds: string[], folderId: string | null) => {
    const updated = await mutations.bulkMoveAssets(assetIds, folderId);
    const byId = new Map(updated.map(asset => [asset.id, asset]));
    updateCachedAssetPages(queryClient, sessionEpoch, items => items.map(asset => byId.get(asset.id) ?? asset));
    invalidateAssetPagesMissingCards(queryClient, sessionEpoch, updated);
    for (const card of updated) {
      queryClient.setQueryData<Asset>(privateQueryKey(sessionEpoch, 'assets', 'detail', card.id), current => (
        current ? mergeAssetCardIntoDetail(current, card) : current
      ));
    }
    void queryClient.invalidateQueries({ queryKey: summaryKey });
  }, [queryClient, sessionEpoch, summaryKey]);

  const bulkDeleteAssetRecords = useCallback(async (assetIds: string[]) => {
    await mutations.bulkDeleteAssets(assetIds);
    const ids = new Set(assetIds);
    updateCachedAssetPages(queryClient, sessionEpoch, items => items.filter(asset => !ids.has(asset.id)));
    removeCachedAssetDetails(queryClient, sessionEpoch, assetIds);
    void queryClient.invalidateQueries({ queryKey: summaryKey });
  }, [queryClient, sessionEpoch, summaryKey]);

  const clearAssetsState = useCallback(() => {
    uploadControllersRef.current.abortAll();
    committedUploadIdsRef.current.clear();
    setReuseGenerationDraft(null);
    setManualAssetsEnabled(false);
    setFilterOwner(null);
    setFilters({ sort: DEFAULT_ASSET_SORT });
    paging.reset();
  }, [paging.reset]);

  return {
    assetLibrary,
    assetSummary: summaryQuery.data ?? EMPTY_ASSET_SUMMARY,
    assetPagination: cardsQuery.data?.pagination,
    assetPageLoading: cardsQuery.isFetching,
    // 后台刷新失败时保留已确认的旧页；只有首次加载无数据时进入整页错误态。
    assetPageError: cardsQuery.data ? null : cardsQuery.error,
    retryAssetPage: cardsQuery.refetch,
    assetFoldersLoading: foldersQuery.isFetching && !foldersQuery.data,
    assetFoldersError: foldersQuery.data ? null : foldersQuery.error,
    retryAssetFolders: foldersQuery.refetch,
    assetSummaryLoading: summaryQuery.isFetching,
    assetSummaryReady: summaryQuery.data !== undefined,
    assetSummaryError: summaryQuery.data ? null : summaryQuery.error,
    retryAssetSummary: summaryQuery.refetch,
    assetFilters: filters,
    setAssetFilters,
    navigateAssetPage,
    loadAssetDetail,
    assetFocusSource,
    reuseGenerationDraft,
    setReuseGenerationDraft,
    prepareAssetLibrary,
    reuseGeneratedAsset,
    createAssetFolder,
    renameAssetFolder,
    deleteAssetFolder,
    uploadAssetFile,
    updateAssetRecord,
    downloadAssetRecord,
    deleteAssetRecord,
    bulkMoveAssetRecords,
    bulkDeleteAssetRecords,
    clearAssetsState,
  };
}

/** 将列表卡片的新值合并进详情，同时保留详情接口独有的临时 URL 与生成配置。 */
export function mergeAssetCardIntoDetail(detail: Asset, card: Asset): Asset {
  return {
    ...detail,
    id: card.id,
    name: card.name,
    type: card.type,
    source: card.source,
    folderId: card.folderId,
    size: card.size,
    sizeBytes: card.sizeBytes,
    duration: card.duration,
    durationSeconds: card.durationSeconds,
    width: card.width,
    height: card.height,
    dimensions: card.dimensions,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    downloadedAt: card.downloadedAt ?? detail.downloadedAt,
    downloadRequestedAt: card.downloadRequestedAt ?? detail.downloadRequestedAt,
    thumbnail: card.thumbnail,
    thumbnailUrl: card.thumbnailUrl,
    mediaExtension: card.mediaExtension,
    views: card.views,
  };
}

export function mergeAssetDownloadIntoDetail(detail: Asset | undefined, downloadRequestedAt: string) {
  return detail ? { ...detail, downloadRequestedAt } : detail;
}

/** 下载成功后只同步当前登录会话的缓存，并重新获取依赖首次下载时间的汇总。 */
export function recordAssetDownloadInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionEpoch: number,
  assetId: string,
  downloadRequestedAt: string,
) {
  updateCachedAssetPages(queryClient, sessionEpoch, items => items.map(item => item.id === assetId
    ? { ...item, downloadRequestedAt }
    : item));
  queryClient.setQueryData<Asset>(
    privateQueryKey(sessionEpoch, 'assets', 'detail', assetId),
    current => mergeAssetDownloadIntoDetail(current, downloadRequestedAt),
  );
  void queryClient.invalidateQueries({
    queryKey: privateQueryKey(sessionEpoch, 'assets', 'summary'),
  });
}

const EMPTY_ASSET_SUMMARY: AssetSummary = {
  total: 0,
  byType: { video: 0, image: 0, audio: 0 },
  bySource: { 'ai-video': 0, 'ai-image': 0, 'uploaded-video': 0, 'uploaded-image': 0, 'uploaded-audio': 0 },
  downloaded: 0,
  notDownloaded: 0,
  folderCounts: [],
};

function normalizeAssetFilters(filters: AssetCardFilters): AssetCardFilters {
  return {
    source: filters.source,
    type: filters.type,
    folderId: filters.folderId ?? null,
    search: filters.search?.trim() || undefined,
    sort: filters.sort ?? DEFAULT_ASSET_SORT,
  };
}

function sameAssetFilters(left: AssetCardFilters, right: AssetCardFilters) {
  const normalizedLeft = normalizeAssetFilters(left);
  const normalizedRight = normalizeAssetFilters(right);
  return normalizedLeft.source === normalizedRight.source
    && normalizedLeft.type === normalizedRight.type
    && normalizedLeft.folderId === normalizedRight.folderId
    && normalizedLeft.search === normalizedRight.search
    && normalizedLeft.sort === normalizedRight.sort;
}

export function canReuseAssetPagePlaceholder(previous: AssetCardFilters, next: AssetCardFilters) {
  return sameAssetFilters(previous, next);
}

export function canReuseAssetPagePlaceholderForNavigation(
  previous: AssetCardFilters,
  next: AssetCardFilters,
  previousRequest: CursorPageRequest,
  nextRequest: CursorPageRequest,
) {
  return sameAssetFilters(previous, next)
    && previousRequest.limit === nextRequest.limit
    && (
      previousRequest.position !== nextRequest.position
      || previousRequest.cursor !== nextRequest.cursor
      || previousRequest.revision !== nextRequest.revision
    );
}

function updateCachedAssetPages(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionEpoch: number,
  update: (items: Asset[]) => Asset[],
) {
  const prefix = privateQueryKey(sessionEpoch, 'assets', 'cards');
  for (const [queryKey, current] of queryClient.getQueriesData<CursorPage<Asset>>({ queryKey: prefix })) {
    if (!current) continue;
    const filters = readAssetFiltersFromQueryKey(queryKey);
    queryClient.setQueryData<CursorPage<Asset>>(queryKey, {
      ...current,
      items: update(current.items).filter(asset => assetMatchesCardFilters(asset, filters)),
    });
  }
}

export function removeCachedAssetDetails(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionEpoch: number,
  assetIds: readonly string[],
) {
  for (const assetId of new Set(assetIds)) {
    queryClient.removeQueries({
      queryKey: privateQueryKey(sessionEpoch, 'assets', 'detail', assetId),
      exact: true,
    });
  }
}

/**
 * 上传完成响应已经包含服务端确认的卡片事实。只有“最新创建”排序的匹配首页能安全
 * 确定新卡片的位置，其余匹配页统一失效，避免把新素材错误插入升序或游标中间页。
 */
export function commitUploadedAsset(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionEpoch: number,
  uploaded: Asset,
) {
  const prefix = privateQueryKey(sessionEpoch, 'assets', 'cards');
  for (const [queryKey, current] of queryClient.getQueriesData<CursorPage<Asset>>({ queryKey: prefix })) {
    if (!current) continue;
    const filters = readAssetFiltersFromQueryKey(queryKey);
    if (!assetMatchesCardFilters(uploaded, filters)) continue;
    const canInsert = (filters.sort ?? DEFAULT_ASSET_SORT) === 'created-desc'
      && readAssetPagePosition(queryKey) === 'first';
    if (!canInsert) {
      void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'active' });
      continue;
    }
    const existing = current.items.some(asset => asset.id === uploaded.id);
    if (existing) continue;
    const boundaryChanged = current.items.length >= current.pagination.limit;
    queryClient.setQueryData<CursorPage<Asset>>(queryKey, {
      ...current,
      items: [uploaded, ...current.items].slice(0, current.pagination.limit),
    });
    if (boundaryChanged) {
      void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'active' });
    }
  }

  queryClient.setQueryData<AssetSummary>(
    privateQueryKey(sessionEpoch, 'assets', 'summary'),
    current => current ? incrementAssetSummary(current, uploaded) : current,
  );
}

/** 迟到的上传响应不得在退出登录或切换账号后重新填充私有缓存。 */
export function commitUploadedAssetForCurrentSession(
  queryClient: ReturnType<typeof useQueryClient>,
  requestedSessionEpoch: number,
  activeSessionEpoch: number,
  uploaded: Asset,
) {
  if (requestedSessionEpoch !== activeSessionEpoch) return false;
  commitUploadedAsset(queryClient, requestedSessionEpoch, uploaded);
  return true;
}

function invalidateAssetPagesMissingCards(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionEpoch: number,
  cards: Asset[],
) {
  const prefix = privateQueryKey(sessionEpoch, 'assets', 'cards');
  for (const [queryKey, current] of queryClient.getQueriesData<CursorPage<Asset>>({ queryKey: prefix })) {
    if (!current) continue;
    const ids = new Set(current.items.map(asset => asset.id));
    const filters = readAssetFiltersFromQueryKey(queryKey);
    if (cards.some(card => !ids.has(card.id) && assetMatchesCardFilters(card, filters))) {
      void queryClient.invalidateQueries({ queryKey, exact: true });
    }
  }
}

function updateCachedAssetDetailsForDeletedFolder(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionEpoch: number,
  folderId: string,
  contentAction: AssetFolderContentAction,
  rootFolderId?: string,
) {
  const prefix = privateQueryKey(sessionEpoch, 'assets', 'detail');
  for (const [queryKey, current] of queryClient.getQueriesData<Asset>({ queryKey: prefix })) {
    if (!current || current.folderId !== folderId) continue;
    if (contentAction === 'move-to-root' && rootFolderId) {
      queryClient.setQueryData<Asset>(queryKey, { ...current, folderId: rootFolderId });
      continue;
    }
    queryClient.removeQueries({ queryKey, exact: true });
  }
}

function updateCachedSummaryForDeletedFolder(
  queryClient: ReturnType<typeof useQueryClient>,
  summaryKey: readonly unknown[],
  folderId: string,
  contentAction: AssetFolderContentAction,
  rootFolderId: string | undefined,
) {
  if (contentAction !== 'move-to-root' || !rootFolderId) return;
  queryClient.setQueryData<AssetSummary>(summaryKey, current => {
    if (!current) return current;
    const cachedCount = current.folderCounts.find(item => item.folderId === folderId)?.count ?? 0;
    const nextFolderCounts = current.folderCounts
      .filter(item => item.folderId !== folderId)
      .map(item => item.folderId === rootFolderId ? { ...item, count: item.count + cachedCount } : item);
    if (cachedCount > 0 && !nextFolderCounts.some(item => item.folderId === rootFolderId)) {
      nextFolderCounts.push({ folderId: rootFolderId, count: cachedCount });
    }
    return { ...current, folderCounts: nextFolderCounts };
  });
}

function readAssetFiltersFromQueryKey(queryKey: readonly unknown[]): AssetCardFilters {
  const value = queryKey[4];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as AssetCardFilters;
}

function readAssetPagePosition(queryKey: readonly unknown[]): PagePosition {
  return readAssetPageRequest(queryKey).position;
}

function readAssetPageRequest(queryKey: readonly unknown[]): CursorPageRequest {
  const value = queryKey[5];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { limit: 24, position: 'first', cursor: undefined };
  }
  const request = value as { limit?: unknown; position?: unknown; cursor?: unknown; revision?: unknown };
  const position = request.position === 'previous' || request.position === 'next' || request.position === 'last'
    ? request.position
    : 'first';
  return {
    limit: typeof request.limit === 'number' ? request.limit : 24,
    position,
    cursor: typeof request.cursor === 'string' ? request.cursor : undefined,
    revision: typeof request.revision === 'number' ? request.revision : undefined,
  };
}

function incrementAssetSummary(summary: AssetSummary, asset: Asset): AssetSummary {
  const folderCounts = summary.folderCounts.map(item => ({ ...item }));
  const folderIndex = folderCounts.findIndex(item => item.folderId === asset.folderId);
  if (folderIndex >= 0) folderCounts[folderIndex]!.count += 1;
  else folderCounts.push({ folderId: asset.folderId, count: 1 });
  return {
    ...summary,
    total: summary.total + 1,
    byType: { ...summary.byType, [asset.type]: summary.byType[asset.type] + 1 },
    bySource: { ...summary.bySource, [asset.source]: summary.bySource[asset.source] + 1 },
    notDownloaded: summary.notDownloaded + 1,
    folderCounts,
  };
}

export function assetMatchesCardFilters(asset: Asset, filters: AssetCardFilters) {
  if (filters.source && asset.source !== filters.source) return false;
  if (filters.type && asset.type !== filters.type) return false;
  if (filters.folderId && asset.folderId !== filters.folderId) return false;
  const search = filters.search?.trim().toLocaleLowerCase();
  return !search || asset.name.toLocaleLowerCase().includes(search);
}

function insertNewestFolder(folders: AssetLibraryState['folders'], created: AssetLibraryState['folders'][number]) {
  const firstRegularFolderIndex = folders.findIndex(folder => !folder.isSystem);
  if (firstRegularFolderIndex < 0) return [...folders, created];
  return [
    ...folders.slice(0, firstRegularFolderIndex),
    created,
    ...folders.slice(firstRegularFolderIndex),
  ];
}

export function createUploadControllerRegistry() {
  const controllers = new Set<AbortController>();
  return {
    create() {
      const controller = new AbortController();
      controllers.add(controller);
      return controller;
    },
    release(controller: AbortController) {
      controllers.delete(controller);
    },
    abortAll() {
      controllers.forEach(controller => {
        controller.abort(new DOMException('会话已切换，上传已取消', 'AbortError'));
      });
      controllers.clear();
    },
    get size() {
      return controllers.size;
    },
  };
}

function combineUploadSignals(sessionSignal: AbortSignal, callerSignal?: AbortSignal) {
  if (!callerSignal) return { signal: sessionSignal, cleanup: () => undefined };
  if (callerSignal.aborted) return { signal: callerSignal, cleanup: () => undefined };
  const controller = new AbortController();
  const cleanup = () => {
    sessionSignal.removeEventListener('abort', abort);
    callerSignal.removeEventListener('abort', abort);
  };
  const abort = (event: Event) => {
    const source = event.target as AbortSignal;
    cleanup();
    controller.abort(source.reason ?? new DOMException('上传已取消', 'AbortError'));
  };
  sessionSignal.addEventListener('abort', abort, { once: true });
  callerSignal.addEventListener('abort', abort, { once: true });
  return { signal: controller.signal, cleanup };
}
