import { describe, expect, it } from 'vitest';
import { getAssetPreviewAspectRatio, getAssetThumbnailUrl, getImagePreviewUrl, getVideoPosterUrl } from './assetPreview';

describe('assetPreview', () => {
  it('视频素材不会把原视频地址当作缩略图', () => {
    const asset = {
      type: 'video' as const,
      thumbnail: 'https://cdn.example.com/users/user-1/video.mp4',
      thumbnailUrl: 'https://cdn.example.com/users/user-1/video.mp4',
      publicUrl: 'https://cdn.example.com/users/user-1/video.mp4',
    };

    expect(getAssetThumbnailUrl(asset)).toBeUndefined();
    expect(getVideoPosterUrl(asset)).toBeUndefined();
  });

  it('视频素材会使用真实图片缩略图', () => {
    const asset = {
      type: 'video' as const,
      thumbnail: 'https://cdn.example.com/users/user-1/thumb.jpg',
      thumbnailUrl: 'https://cdn.example.com/users/user-1/thumb.jpg',
      publicUrl: 'https://cdn.example.com/users/user-1/video.mp4',
    };

    expect(getAssetThumbnailUrl(asset)).toBe('https://cdn.example.com/users/user-1/thumb.jpg');
    expect(getVideoPosterUrl(asset)).toBe('https://cdn.example.com/users/user-1/thumb.jpg');
  });

  it('图片素材缺少缩略图时卡片使用占位图，详情仍可用原图预览', () => {
    const asset = {
      type: 'image' as const,
      thumbnail: '',
      publicUrl: 'https://cdn.example.com/users/user-1/image.png',
    };

    expect(getAssetThumbnailUrl(asset)).toBeUndefined();
    expect(getImagePreviewUrl(asset)).toBe('https://cdn.example.com/users/user-1/image.png');
  });

  it('普通上传视频优先使用真实宽高作为预览比例', () => {
    expect(getAssetPreviewAspectRatio({
      type: 'video',
      dimensions: '1080×1920',
    })).toBe('1080 / 1920');
  });

  it('adaptive 生成视频使用归档探测宽高，缺失时不伪造横版比例', () => {
    const generation = {
      kind: 'video' as const,
      mode: 'first-last' as const,
      model: 'Seedance 2.5',
      aspectRatio: 'adaptive' as const,
      resolution: '720p',
      duration: '30s',
      prompt: '跟随首帧比例',
      referenceImages: [],
    };

    expect(getAssetPreviewAspectRatio({
      type: 'video',
      dimensions: '1024×1024',
      generation,
    })).toBe('1024 / 1024');
    expect(getAssetPreviewAspectRatio({
      type: 'video',
      generation,
    })).toBeNull();
    expect(getAssetPreviewAspectRatio({
      type: 'video',
      dimensions: 'unknown',
      generation,
    })).toBeNull();
  });

  it('普通上传图片优先使用真实宽高作为预览比例', () => {
    expect(getAssetPreviewAspectRatio({
      type: 'image',
      dimensions: '720×1280',
    })).toBe('720 / 1280');
  });

  it('没有宽高的历史图片不再强制方形预览比例', () => {
    expect(getAssetPreviewAspectRatio({
      type: 'image',
    })).toBeNull();
  });

  it('没有宽高的视频仍使用播放器默认横版比例', () => {
    expect(getAssetPreviewAspectRatio({
      type: 'video',
    })).toBe('16 / 9');
  });
});
