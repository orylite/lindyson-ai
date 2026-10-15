import { describe,expect,it } from 'vitest';
import type { AssetFolder,AssetLibraryState } from '../data/assets';
import {
  createInitialUploadFolderIds,
  getMissingUploadRootSources,
  hasAvailableUploadSource,
  normalizeSelectedUploadFolderId,
} from './AssetUploadPanel';

describe('上传来源的系统目录隔离', () => {
  it('仅阻断缺少系统目录的来源，混合队列仍可上传其他来源', () => {
    const library = makeLibrary([
      folder('root-video', 'uploaded-video', true),
      folder('root-audio', 'uploaded-audio', true),
      folder('image-archive', 'uploaded-image'),
    ]);
    const mixedSources = ['uploaded-image', 'uploaded-video', 'uploaded-image'] as const;

    expect(getMissingUploadRootSources(library, mixedSources)).toEqual(['uploaded-image']);
    expect(hasAvailableUploadSource(library, mixedSources)).toBe(true);
    expect(hasAvailableUploadSource(library, ['uploaded-image'])).toBe(false);
  });
});

describe('上传目标文件夹初始值', () => {
  const library = makeLibrary([
    folder('root-image', 'uploaded-image', true),
    folder('current-image-folder', 'uploaded-image'),
    folder('ai-image-folder', 'ai-image'),
  ]);

  it('已上传分类可预填当前自定义文件夹', () => {
    const initial = createInitialUploadFolderIds({
      'uploaded-image': 'current-image-folder',
    });

    expect(normalizeSelectedUploadFolderId(
      library,
      'uploaded-image',
      initial['uploaded-image'],
    )).toBe('current-image-folder');
    expect(initial['uploaded-video']).toBe('');
    expect(initial['uploaded-audio']).toBe('');
  });

  it('AI 分类不传上传目录时保持空值，也不接受 AI 文件夹作为上传目标', () => {
    const initial = createInitialUploadFolderIds();

    expect(initial).toEqual({
      'uploaded-image': '',
      'uploaded-video': '',
      'uploaded-audio': '',
    });
    expect(normalizeSelectedUploadFolderId(
      library,
      'uploaded-image',
      'ai-image-folder',
    )).toBe('');
  });
});

function makeLibrary(folders: AssetFolder[]): AssetLibraryState {
  return { assets: [], folders };
}

function folder(id: string, source: AssetFolder['source'], isSystem = false): AssetFolder {
  return {
    id,
    name: id,
    source,
    isSystem,
    createdAt: '2026-08-12 12:00',
  };
}
