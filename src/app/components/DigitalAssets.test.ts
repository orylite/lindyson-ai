import { describe,expect,it } from 'vitest';
import {
  advanceAssetDetailRequestSequence,
  createDigitalAssetsUrlSearch,
  getKnownFolderAssetCount,
  isAssetRootMissing,
  parseDigitalAssetsUrlSearch,
  requiresFolderContentChoice,
  resolveDigitalAssetCardFilters,
  resolveDigitalAssetSearchSubmission,
} from './DigitalAssets';

describe('数字资产目标筛选', () => {
  it('等待系统主目录后才启用 cards 查询', () => {
    expect(resolveDigitalAssetCardFilters({
      source: 'ai-video',
      rootFolderId: null,
      activeFolderId: null,
      search: '',
    })).toBeNull();

    expect(resolveDigitalAssetCardFilters({
      source: 'ai-video',
      rootFolderId: 'root-video',
      activeFolderId: null,
      search: '  夏日  ',
    })).toEqual({ source: 'ai-video', search: '夏日', sort: 'created-desc' });
  });

  it('无搜索词时锁定当前目录并始终使用最新创建', () => {
    expect(resolveDigitalAssetCardFilters({
      source: 'uploaded-image',
      rootFolderId: 'root-image',
      activeFolderId: null,
      search: '',
    })).toEqual({
      source: 'uploaded-image',
      folderId: 'root-image',
      search: undefined,
      sort: 'created-desc',
    });

    expect(resolveDigitalAssetCardFilters({
      source: 'uploaded-image',
      rootFolderId: 'root-image',
      activeFolderId: 'campaign-folder',
      search: ' ',
    })).toEqual({
      source: 'uploaded-image',
      folderId: 'campaign-folder',
      search: undefined,
      sort: 'created-desc',
    });
  });
});

describe('数字资产提交式搜索', () => {
  it('输入仅形成草稿，只有新关键词或清除已应用词才产生提交', () => {
    expect(resolveDigitalAssetSearchSubmission('', '')).toBeNull();
    expect(resolveDigitalAssetSearchSubmission('   ', '')).toBeNull();
    expect(resolveDigitalAssetSearchSubmission('  夏日  ', '')).toBe('夏日');
    expect(resolveDigitalAssetSearchSubmission('夏日', '夏日')).toBeNull();
    expect(resolveDigitalAssetSearchSubmission('', '夏日')).toBe('');
  });
});

describe('数字资产 URL 状态', () => {
  it('解析分类、目录和跨目录搜索并忽略历史排序参数', () => {
    expect(parseDigitalAssetsUrlSearch(
      '?source=uploaded-image&folder=campaign-folder&q=%E5%A4%8F%E6%97%A5&sort=created-asc',
      'ai-video',
    )).toEqual({
      source: 'uploaded-image',
      folderId: 'campaign-folder',
      search: '夏日',
    });
  });

  it('忽略无效值并省略默认参数', () => {
    expect(parseDigitalAssetsUrlSearch('?source=unknown&sort=unknown', 'ai-video')).toEqual({
      source: 'ai-video',
      folderId: null,
      search: '',
    });
    expect(createDigitalAssetsUrlSearch({
      source: 'ai-video',
      folderId: null,
      search: '',
    }, 'ai-video')).toBe('?source=ai-video&folder=root');
  });

  it('序列化分类、目录与搜索并清理空白', () => {
    expect(createDigitalAssetsUrlSearch({
      source: 'ai-image',
      folderId: 'folder-1',
      search: '  商品图  ',
    }, 'ai-video')).toBe('?source=ai-image&folder=folder-1&q=%E5%95%86%E5%93%81%E5%9B%BE');
  });

  it('把 URL 中的 root 归一为内部主目录状态', () => {
    expect(parseDigitalAssetsUrlSearch(
      '?source=ai-video&folder=root&sort=created-desc',
      'ai-image',
    )).toEqual({
      source: 'ai-video',
      folderId: null,
      search: '',
    });
  });

  it('把旧排序链接规范化为不含 sort 的标准地址', () => {
    const state = parseDigitalAssetsUrlSearch(
      '?source=ai-image&folder=root&q=%E5%95%86%E5%93%81&sort=created-asc',
      'ai-video',
    );
    expect(createDigitalAssetsUrlSearch(state, 'ai-video'))
      .toBe('?source=ai-image&folder=root&q=%E5%95%86%E5%93%81');
  });
});

describe('数字资产保守状态边界', () => {
  const summary = {
    total: 3,
    byType: { video: 1, image: 2, audio: 0 },
    bySource: { 'ai-video': 1, 'ai-image': 0, 'uploaded-video': 0, 'uploaded-image': 2, 'uploaded-audio': 0 },
    downloaded: 0,
    notDownloaded: 3,
    folderCounts: [{ folderId: 'folder-1', count: 2 }],
  };

  it('目录错误不能被判定为系统主目录缺失', () => {
    expect(isAssetRootMissing(null, false, new Error('目录请求失败'))).toBe(false);
    expect(isAssetRootMissing(null, true, undefined)).toBe(false);
    expect(isAssetRootMissing(null, false, undefined)).toBe(true);
    expect(isAssetRootMissing('root-1', false, undefined)).toBe(false);
  });

  it('汇总未知时不伪造目录为零，并按可能非空走安全删除选择', () => {
    expect(getKnownFolderAssetCount(summary, false, 'folder-1')).toBeNull();
    expect(getKnownFolderAssetCount(summary, true, 'folder-1')).toBe(2);
    expect(getKnownFolderAssetCount(summary, true, 'folder-missing')).toBe(0);
    expect(requiresFolderContentChoice(null)).toBe(true);
    expect(requiresFolderContentChoice(2)).toBe(true);
    expect(requiresFolderContentChoice(0)).toBe(false);
  });

  it('位置变化通过递增序列使先前详情请求失效', () => {
    const pendingRequest = advanceAssetDetailRequestSequence(4);
    const afterLocationChange = advanceAssetDetailRequestSequence(pendingRequest);
    expect(pendingRequest).toBe(5);
    expect(afterLocationChange).toBe(6);
    expect(pendingRequest).not.toBe(afterLocationChange);
  });
});
