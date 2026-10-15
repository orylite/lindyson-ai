import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it,vi } from 'vitest';
import type { Asset } from '../data/assets';
import { AssetPickerModal,getAssetSelectionViolation,getConfirmationViolation,getSelectionViolation,isRootAsset,resolveAssetPickerCardFilters,resolveAudioPreviewUrl,type AssetPickerSelectionRules } from './AssetPickerModal';

const rules: AssetPickerSelectionRules = {
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
  minSingleVideoDurationSeconds: 2,
  maxSingleVideoDurationSeconds: 15.1,
  maxVideoDurationSeconds: 15.1,
  videoMaxDurationLabel: '15s',
  minSingleAudioDurationSeconds: 2,
  maxSingleAudioDurationSeconds: 15.1,
  maxAudioDurationSeconds: 15.1,
  audioMaxDurationLabel: '15s',
  maxAudioSizeBytes: 15 * 1024 * 1024,
  requireVisualWithAudio: true,
};

const seedreamRules: AssetPickerSelectionRules = {
  maxImages: 10,
  image: {
    supportedExtensions: ['jpeg', 'jpg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'heic', 'heif'],
    requireFileSize: true,
    maxSizeBytes: 30 * 1024 * 1024,
    requireDimensions: true,
    minDimensionExclusive: 14,
    maxPixels: 36_000_000,
    minAspectRatio: 1 / 16,
    maxAspectRatio: 16,
  },
};

describe('参考素材选择约束', () => {
  it('文件夹模式根目录不会泄漏普通子文件夹资产', () => {
    expect(isRootAsset({ ...asset('root', 'image'), folderId: null }, new Set())).toBe(true);
    expect(isRootAsset({ ...asset('system', 'image'), folderId: 'folder-system' }, new Set(['folder-system']))).toBe(true);
    expect(isRootAsset({ ...asset('nested', 'image'), folderId: 'folder-user' }, new Set(['folder-system']))).toBe(false);
  });

  it('分别限制图片、视频和音频数量', () => {
    expect(getSelectionViolation(Array.from({ length: 10 }, (_, index) => asset(`image-${index}`, 'image')), rules)).toContain('9 张图片');
    expect(getSelectionViolation(Array.from({ length: 4 }, (_, index) => asset(`video-${index}`, 'video', '2s')), rules)).toContain('3 个视频');
    expect(getSelectionViolation(Array.from({ length: 4 }, (_, index) => asset(`audio-${index}`, 'audio', '2s')), rules)).toContain('3 个音频');
  });

  it('Seedance 2.5 可独立限制 50 个参考素材总数', () => {
    const seedance25Rules: AssetPickerSelectionRules = {
      maxTotal: 50,
      maxImages: 30,
      maxVideos: 10,
      maxAudios: 10,
      requireVisualWithAudio: false,
    };
    const fiftyOneAssets = [
      ...Array.from({ length: 30 }, (_, index) => asset(`image-${index}`, 'image')),
      ...Array.from({ length: 10 }, (_, index) => asset(`video-${index}`, 'video')),
      ...Array.from({ length: 10 }, (_, index) => asset(`audio-${index}`, 'audio')),
      asset('extra', 'image'),
    ];

    expect(getSelectionViolation(fiftyOneAssets, seedance25Rules)).toContain('50 个参考素材');
    expect(getConfirmationViolation([asset('audio-only', 'audio')], seedance25Rules)).toBeNull();
  });

  it('限制单个视频和音频的时长与音频大小', () => {
    expect(getAssetSelectionViolation(asset('short-video', 'video', '1s'), rules)).toContain('2s');
    expect(getAssetSelectionViolation(asset('long-audio', 'audio', '16s'), rules)).toContain('15s');
    expect(getAssetSelectionViolation({ ...asset('large-audio', 'audio', '5s'), sizeBytes: 15 * 1024 * 1024 + 1 }, rules)).toContain('15 MB');
    expect(getAssetSelectionViolation(asset('unknown-audio', 'audio'), rules)).toContain('缺少可校验时长');
    expect(getAssetSelectionViolation({ ...asset('unknown-size-audio', 'audio', '5s'), sizeBytes: undefined }, rules)).toContain('缺少可校验的文件大小');
  });

  it('分别限制视频和音频总时长', () => {
    expect(getSelectionViolation([asset('v1', 'video', '8s'), asset('v2', 'video', '8s')], rules)).toContain('视频总时长');
    expect(getSelectionViolation([asset('a1', 'audio', '8s'), asset('a2', 'audio', '8s')], rules)).toContain('音频总时长');
  });

  it('使用真实秒数接受 15.1s 容差并保持 15s 提示文案', () => {
    for (const type of ['video', 'audio'] as const) {
      expect(getAssetSelectionViolation(asset(`${type}-probe`, type, '15s', 15.041667), rules)).toBeNull();
      expect(getAssetSelectionViolation(asset(`${type}-edge`, type, '15s', 15.1), rules)).toBeNull();
      expect(getAssetSelectionViolation(asset(`${type}-over`, type, '15s', 15.100001), rules)).toBe(`单个${type === 'video' ? '视频' : '音频'}不能超过 15s`);
    }
  });

  it('视频和音频分别按真实秒数计算 15.1s 总时长', () => {
    for (const type of ['video', 'audio'] as const) {
      expect(getSelectionViolation([
        asset(`${type}-1`, type, '8s', 7.55),
        asset(`${type}-2`, type, '8s', 7.55),
      ], rules)).toBeNull();
      expect(getSelectionViolation([
        asset(`${type}-3`, type, '8s', 7.550001),
        asset(`${type}-4`, type, '8s', 7.55),
      ], rules)).toBe(`参考${type === 'video' ? '视频' : '音频'}总时长不能超过 15s`);
    }
  });

  it('音频可以先选但确认时必须带图片或视频', () => {
    expect(getConfirmationViolation([asset('audio', 'audio', '5s')], rules)).toContain('不能单独使用');
    expect(getConfirmationViolation([asset('image', 'image'), asset('audio', 'audio', '5s')], rules)).toBeNull();
  });

  it('Seedream 参考图在选择时预检文件、宽高、像素和比例', () => {
    const valid = { ...asset('valid.png', 'image'), width: 2048, height: 2048, mediaExtension: 'png' };
    expect(getAssetSelectionViolation(valid, seedreamRules)).toBeNull();
    expect(getAssetSelectionViolation({ ...valid, width: undefined }, seedreamRules)).toContain('缺少可校验的宽高');
    expect(getAssetSelectionViolation({ ...valid, width: 14 }, seedreamRules)).toContain('大于 14 px');
    expect(getAssetSelectionViolation({ ...valid, width: 6001, height: 6000 }, seedreamRules)).toContain('3600 万');
    expect(getAssetSelectionViolation({ ...valid, width: 1601, height: 100 }, seedreamRules)).toContain('1:16 到 16:1');
    expect(getAssetSelectionViolation({ ...valid, sizeBytes: 30 * 1024 * 1024 + 1 }, seedreamRules)).toContain('30 MB');
    expect(getAssetSelectionViolation({ ...valid, name: 'valid.avif', mediaExtension: 'avif' }, seedreamRules)).toContain('格式仅支持');
  });

  it('Seedream 图片规则不会改变视频选择器的原有图片行为', () => {
    expect(getAssetSelectionViolation(asset('legacy-image', 'image'), rules)).toBeNull();
  });
});

describe('素材选择器按目标加载', () => {
  it('使用高于提示词向导的层级展示在最前端', () => {
    const markup = renderToStaticMarkup(createElement(AssetPickerModal, {
      onClose: vi.fn(),
      onConfirm: vi.fn(),
    }));

    expect(markup).toContain('z-[110]');
  });

  it('文件夹主目录尚未就绪时不发起无筛选卡片请求', () => {
    expect(resolveAssetPickerCardFilters({
      category: 'uploaded-image',
      folders: [],
      enableFolders: true,
      activeFolderId: null,
      search: '',
    })).toBeNull();

    expect(resolveAssetPickerCardFilters({
      category: 'uploaded-image',
      folders: [{ id: 'root-image', name: '主目录', source: 'uploaded-image', isSystem: true, createdAt: '2026-07-17' }],
      enableFolders: true,
      activeFolderId: null,
      search: '  海报  ',
    })).toEqual({ source: 'uploaded-image', folderId: 'root-image', search: '海报' });
  });

  it('服务端卡片加载失败时提供明确的重试入口', () => {
    const markup = renderToStaticMarkup(createElement(AssetPickerModal, {
      pageError: new Error('network failed'),
      onAssetPageRetry: vi.fn(),
      onClose: vi.fn(),
      onConfirm: vi.fn(),
    }));

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('素材加载失败');
    expect(markup).toContain('重新加载素材');
  });

  it('音频卡片通过 assetId 懒加载详情 URL', async () => {
    const card = asset('audio-card', 'audio', '5s');
    const requestedIds: string[] = [];

    await expect(resolveAudioPreviewUrl(card, async assetId => {
      requestedIds.push(assetId);
      return { ...card, publicUrl: 'https://example.com/signed-audio.mp3' };
    })).resolves.toBe('https://example.com/signed-audio.mp3');
    expect(requestedIds).toEqual(['audio-card']);
  });
});

function asset(id: string, type: Asset['type'], duration?: string, durationSeconds?: number): Asset {
  return {
    id,
    name: id,
    type,
    source: type === 'video' ? 'uploaded-video' : type === 'audio' ? 'uploaded-audio' : 'uploaded-image',
    folderId: `folder-${type}`,
    size: '1 MB',
    sizeBytes: 1024 * 1024,
    duration,
    durationSeconds,
    createdAt: '2026-07-10 10:00',
    updatedAt: '2026-07-10',
    thumbnail: '',
    views: 0,
  };
}
