import { QueryClient } from '@tanstack/react-query';
import { describe,expect,it } from 'vitest';
import type { CursorPage } from '../api/cursor';
import { privateQueryKey } from '../api/queryClient';
import type { Asset,AssetSummary } from '../data/assets';
import {
  assetMatchesCardFilters,
  canReuseAssetPagePlaceholder,
  canReuseAssetPagePlaceholderForNavigation,
  commitUploadedAsset,
  commitUploadedAssetForCurrentSession,
  createUploadControllerRegistry,
  getAssetCardsPageLimit,
  isAssetCardsPageLimitReady,
  mergeAssetCardIntoDetail,
  mergeAssetDownloadIntoDetail,
  recordAssetDownloadInCache,
  removeCachedAssetDetails,
} from './useAssets';

describe('资产分页容量路由隔离', () => {
  it('只有数字资产主页使用 30 条，素材选择器保持 24 条', () => {
    expect(getAssetCardsPageLimit('digital-assets')).toBe(30);
    expect(getAssetCardsPageLimit('ai-studio')).toBe(24);
    expect(getAssetCardsPageLimit('tiktok-publish')).toBe(24);
  });

  it('切换路由后拦截带旧容量游标的请求，直到新容量回到首页', () => {
    const pickerNextPage = { limit: 24, position: 'next' as const, cursor: 'picker-cursor' };
    const libraryNextPage = { limit: 30, position: 'next' as const, cursor: 'library-cursor' };

    expect(isAssetCardsPageLimitReady('digital-assets', pickerNextPage)).toBe(false);
    expect(isAssetCardsPageLimitReady('ai-studio', libraryNextPage)).toBe(false);
    expect(isAssetCardsPageLimitReady('tiktok-publish', libraryNextPage)).toBe(false);
    expect(isAssetCardsPageLimitReady('digital-assets', { limit: 30, position: 'first' })).toBe(true);
    expect(isAssetCardsPageLimitReady('ai-studio', { limit: 24, position: 'first' })).toBe(true);
  });
});

describe('上传会话取消注册表', () => {
  it('切换账号时立即取消并清空全部进行中的上传', () => {
    const registry = createUploadControllerRegistry();
    const first = registry.create();
    const second = registry.create();
    expect(registry.size).toBe(2);

    registry.abortAll();

    expect(first.signal).toMatchObject({ aborted: true });
    expect(second.signal).toMatchObject({ aborted: true });
    expect(registry.size).toBe(0);
  });

  it('任务结束后可单独释放控制器', () => {
    const registry = createUploadControllerRegistry();
    const controller = registry.create();
    registry.release(controller);
    expect(registry.size).toBe(0);
    expect(controller.signal.aborted).toBe(false);
  });
});

describe('资产卡片与详情缓存合并', () => {
  it('上传完成只局部写入匹配的首页和汇总，不改写下一页或刷新全量资源', () => {
    const queryClient = new QueryClient();
    const sessionEpoch = 9;
    const filters = { source: 'uploaded-image' as const, folderId: 'folder-1' };
    const firstKey = privateQueryKey(sessionEpoch, 'assets', 'cards', filters, { position: 'first', limit: 2 });
    const nextKey = privateQueryKey(sessionEpoch, 'assets', 'cards', filters, { position: 'next', cursor: 'next-page', limit: 2 });
    const oldestFirstKey = privateQueryKey(
      sessionEpoch,
      'assets',
      'cards',
      { ...filters, sort: 'created-asc' },
      { position: 'first', limit: 2 },
    );
    const firstPage = page([makeAsset({ id: 'old-1' }), makeAsset({ id: 'old-2' })], {
      hasNext: true,
      nextCursor: 'signed-old-boundary',
    });
    const nextPage = page([makeAsset({ id: 'old-3' })], { hasPrevious: true, previousCursor: 'signed-previous' });
    queryClient.setQueryData(firstKey, firstPage);
    queryClient.setQueryData(nextKey, nextPage);
    queryClient.setQueryData(oldestFirstKey, page([makeAsset({ id: 'oldest-1' })]));
    queryClient.setQueryData<AssetSummary>(privateQueryKey(sessionEpoch, 'assets', 'summary'), emptySummary());

    commitUploadedAsset(queryClient, sessionEpoch, makeAsset({ id: 'uploaded-new' }));

    expect(queryClient.getQueryData<CursorPage<Asset>>(firstKey)?.items.map(item => item.id)).toEqual(['uploaded-new', 'old-1']);
    expect(queryClient.getQueryData<CursorPage<Asset>>(nextKey)?.items.map(item => item.id)).toEqual(['old-3']);
    expect(queryClient.getQueryData<CursorPage<Asset>>(oldestFirstKey)?.items.map(item => item.id)).toEqual(['oldest-1']);
    expect(queryClient.getQueryState(firstKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(nextKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(oldestFirstKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData<AssetSummary>(privateQueryKey(sessionEpoch, 'assets', 'summary'))).toMatchObject({
      total: 1,
      byType: { image: 1 },
      bySource: { 'uploaded-image': 1 },
      notDownloaded: 1,
      folderCounts: [{ folderId: 'folder-1', count: 1 }],
    });
  });

  it('切换账号后废弃迟到的上传响应，不重新填充旧账号或污染新账号缓存', () => {
    const queryClient = new QueryClient();
    const oldEpoch = 9;
    const activeEpoch = 10;
    const oldSummaryKey = privateQueryKey(oldEpoch, 'assets', 'summary');
    const activeSummaryKey = privateQueryKey(activeEpoch, 'assets', 'summary');
    queryClient.setQueryData<AssetSummary>(oldSummaryKey, emptySummary());
    queryClient.setQueryData<AssetSummary>(activeSummaryKey, emptySummary());

    const committed = commitUploadedAssetForCurrentSession(
      queryClient,
      oldEpoch,
      activeEpoch,
      makeAsset({ id: 'late-upload' }),
    );

    expect(committed).toBe(false);
    expect(queryClient.getQueryData<AssetSummary>(oldSummaryKey)?.total).toBe(0);
    expect(queryClient.getQueryData<AssetSummary>(activeSummaryKey)?.total).toBe(0);
  });

  it('改名或移动时保留详情接口独有的临时 URL 与生成配置', () => {
    const detail = makeAsset({
      name: '旧名称',
      folderId: 'folder-old',
      publicUrl: 'https://example.com/signed-original.mp3',
      generation: {
        kind: 'image',
        model: 'seedream',
        prompt: 'detail-only prompt',
        referenceImages: [],
        outputSize: '2K',
        ratio: '1:1',
      },
    });
    const card = makeAsset({
      name: '新名称',
      folderId: 'folder-new',
      thumbnail: 'https://example.com/new-thumbnail.webp',
      thumbnailUrl: 'https://example.com/new-thumbnail.webp',
      publicUrl: undefined,
      generation: undefined,
    });

    const merged = mergeAssetCardIntoDetail(detail, card);

    expect(merged).toMatchObject({
      name: '新名称',
      folderId: 'folder-new',
      thumbnailUrl: 'https://example.com/new-thumbnail.webp',
      publicUrl: 'https://example.com/signed-original.mp3',
    });
    expect(merged.generation).toEqual(detail.generation);
  });

  it('下载成功后同步详情缓存中的首次下载请求时间', () => {
    const detail = makeAsset({ downloadRequestedAt: undefined });

    expect(mergeAssetDownloadIntoDetail(detail, '2026-08-12 12:08')).toMatchObject({
      id: detail.id,
      downloadRequestedAt: '2026-08-12 12:08',
    });
    expect(mergeAssetDownloadIntoDetail(undefined, '2026-08-12 12:08')).toBeUndefined();
  });

  it('下载成功后同步当前会话的所有卡片页与详情，并使汇总失效', () => {
    const queryClient = new QueryClient();
    const sessionEpoch = 9;
    const otherEpoch = 10;
    const firstKey = privateQueryKey(sessionEpoch, 'assets', 'cards', { source: 'uploaded-image' }, { position: 'first', limit: 2 });
    const nextKey = privateQueryKey(sessionEpoch, 'assets', 'cards', { source: 'uploaded-image' }, { position: 'next', cursor: 'next-page', limit: 2 });
    const otherSessionKey = privateQueryKey(otherEpoch, 'assets', 'cards', { source: 'uploaded-image' }, { position: 'first', limit: 2 });
    const detailKey = privateQueryKey(sessionEpoch, 'assets', 'detail', 'asset-1');
    const summaryKey = privateQueryKey(sessionEpoch, 'assets', 'summary');
    queryClient.setQueryData(firstKey, page([makeAsset({ id: 'asset-1' }), makeAsset({ id: 'asset-2' })]));
    queryClient.setQueryData(nextKey, page([makeAsset({ id: 'asset-1' })]));
    queryClient.setQueryData(otherSessionKey, page([makeAsset({ id: 'asset-1' })]));
    queryClient.setQueryData(detailKey, makeAsset({ id: 'asset-1', downloadRequestedAt: undefined }));
    queryClient.setQueryData<AssetSummary>(summaryKey, emptySummary());

    recordAssetDownloadInCache(queryClient, sessionEpoch, 'asset-1', '2026-08-12 12:08');

    const firstPageItems = queryClient.getQueryData<CursorPage<Asset>>(firstKey)?.items;
    expect(firstPageItems?.map(item => item.id)).toEqual(['asset-1', 'asset-2']);
    expect(firstPageItems?.[0]?.downloadRequestedAt).toBe('2026-08-12 12:08');
    expect(firstPageItems?.[1]?.downloadRequestedAt).toBeUndefined();
    expect(queryClient.getQueryData<CursorPage<Asset>>(nextKey)?.items[0]).toMatchObject({
      id: 'asset-1',
      downloadRequestedAt: '2026-08-12 12:08',
    });
    expect(queryClient.getQueryData<Asset>(detailKey)).toMatchObject({
      id: 'asset-1',
      downloadRequestedAt: '2026-08-12 12:08',
    });
    expect(queryClient.getQueryData<CursorPage<Asset>>(otherSessionKey)?.items[0]?.downloadRequestedAt).toBeUndefined();
    expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(true);
  });

  it('卡片合并优先采用规范下载时间，且不被缺失字段清空', () => {
    const detail = makeAsset({
      downloadRequestedAt: '2026-08-12 12:08',
      downloadedAt: '2026-07-01 08:00',
    });

    expect(mergeAssetCardIntoDetail(detail, makeAsset({
      downloadRequestedAt: '2026-08-12 12:09',
      downloadedAt: undefined,
    }))).toMatchObject({
      downloadRequestedAt: '2026-08-12 12:09',
      downloadedAt: '2026-07-01 08:00',
    });
    expect(mergeAssetCardIntoDetail(detail, makeAsset({
      downloadRequestedAt: undefined,
      downloadedAt: undefined,
    }))).toMatchObject({
      downloadRequestedAt: '2026-08-12 12:08',
      downloadedAt: '2026-07-01 08:00',
    });
  });

  it('批量删除会清理所有选中素材的详情缓存且保留无关详情', () => {
    const queryClient = new QueryClient();
    const sessionEpoch = 9;
    const firstKey = privateQueryKey(sessionEpoch, 'assets', 'detail', 'asset-1');
    const secondKey = privateQueryKey(sessionEpoch, 'assets', 'detail', 'asset-2');
    const keptKey = privateQueryKey(sessionEpoch, 'assets', 'detail', 'asset-3');
    queryClient.setQueryData(firstKey, makeAsset({ id: 'asset-1' }));
    queryClient.setQueryData(secondKey, makeAsset({ id: 'asset-2' }));
    queryClient.setQueryData(keptKey, makeAsset({ id: 'asset-3' }));

    removeCachedAssetDetails(queryClient, sessionEpoch, ['asset-1', 'asset-2', 'asset-2']);

    expect(queryClient.getQueryData(firstKey)).toBeUndefined();
    expect(queryClient.getQueryData(secondKey)).toBeUndefined();
    expect(queryClient.getQueryData(keptKey)).toMatchObject({ id: 'asset-3' });
  });

  it('移动或改名后会从不再匹配的文件夹、类型和搜索缓存页移除', () => {
    const moved = makeAsset({ name: '产品发布视频', folderId: 'folder-release', type: 'video' });

    expect(assetMatchesCardFilters(moved, { folderId: 'folder-main' })).toBe(false);
    expect(assetMatchesCardFilters(moved, { folderId: 'folder-release', type: 'video' })).toBe(true);
    expect(assetMatchesCardFilters(moved, { type: 'image' })).toBe(false);
    expect(assetMatchesCardFilters(moved, { search: '发布视频' })).toBe(true);
    expect(assetMatchesCardFilters(moved, { search: '参考音频' })).toBe(false);
  });

  it('只有筛选和排序完全一致时才复用上一页占位数据', () => {
    const current = {
      source: 'ai-video' as const,
      folderId: 'folder-main',
      search: '  产品  ',
      sort: 'created-desc' as const,
    };

    expect(canReuseAssetPagePlaceholder(current, {
      source: 'ai-video',
      folderId: 'folder-main',
      search: '产品',
      sort: 'created-desc',
    })).toBe(true);
    expect(canReuseAssetPagePlaceholder(current, { ...current, folderId: 'folder-other' })).toBe(false);
    expect(canReuseAssetPagePlaceholder(current, { ...current, sort: 'created-asc' })).toBe(false);
    expect(canReuseAssetPagePlaceholderForNavigation(
      current,
      current,
      { limit: 24, position: 'first' },
      { limit: 24, position: 'next', cursor: 'cursor-1' },
    )).toBe(true);
    expect(canReuseAssetPagePlaceholderForNavigation(
      current,
      current,
      { limit: 24, position: 'next', cursor: 'cursor-1' },
      { limit: 24, position: 'next', cursor: 'cursor-2' },
    )).toBe(true);
    expect(canReuseAssetPagePlaceholderForNavigation(
      current,
      current,
      { limit: 24, position: 'next', cursor: 'cursor-1' },
      { limit: 24, position: 'next', cursor: 'cursor-1' },
    )).toBe(false);
    expect(canReuseAssetPagePlaceholderForNavigation(
      current,
      current,
      { limit: 24, position: 'next', cursor: 'cursor-1' },
      { limit: 30, position: 'first' },
    )).toBe(false);
    expect(canReuseAssetPagePlaceholderForNavigation(
      current,
      { ...current, folderId: 'folder-other' },
      { limit: 24, position: 'first' },
      { limit: 24, position: 'next', cursor: 'cursor-1' },
    )).toBe(false);
  });
});

function makeAsset(patch: Partial<Asset>): Asset {
  return {
    id: 'asset-1',
    name: 'asset',
    type: 'image',
    source: 'uploaded-image',
    folderId: 'folder-1',
    size: '1 MB',
    sizeBytes: 1024,
    createdAt: '2026-07-17 10:00',
    updatedAt: '2026-07-17',
    thumbnail: '',
    views: 0,
    ...patch,
  };
}

function page(items: Asset[], patch: Partial<CursorPage<Asset>['pagination']> = {}): CursorPage<Asset> {
  return {
    items,
    pagination: {
      limit: 2,
      hasPrevious: false,
      hasNext: false,
      previousCursor: null,
      nextCursor: null,
      ...patch,
      position: patch.position ?? 'first',
    },
  };
}

function emptySummary(): AssetSummary {
  return {
    total: 0,
    byType: { video: 0, image: 0, audio: 0 },
    bySource: { 'ai-video': 0, 'ai-image': 0, 'uploaded-video': 0, 'uploaded-image': 0, 'uploaded-audio': 0 },
    downloaded: 0,
    notDownloaded: 0,
    folderCounts: [],
  };
}
