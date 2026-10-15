import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveObjectProcessingInput: vi.fn(),
  validateMediaDecoding: vi.fn(),
}));

vi.mock('../src/storage/storageService.js', () => ({
  resolveObjectProcessingInput: mocks.resolveObjectProcessingInput,
  uploadObjectBuffer: vi.fn(),
}));
vi.mock('../src/storage/mediaProcessor.js', () => ({
  createVideoThumbnailBuffer: vi.fn(),
  probeMedia: vi.fn(),
  validateMediaDecoding: mocks.validateMediaDecoding,
}));

import {
  buildHistoricalVideoThumbnailKey,
  validateUploadedMediaDecoding,
} from '../src/domain/uploadedVideoPreview.js';

describe('validateUploadedMediaDecoding', () => {
  beforeEach(() => {
    mocks.resolveObjectProcessingInput.mockReset();
    mocks.validateMediaDecoding.mockReset();
    mocks.resolveObjectProcessingInput.mockResolvedValue('https://storage.example.com/damaged.mp4');
  });

  it('包含 TOS URL 的媒体损坏错误仍标记为永久失败', async () => {
    mocks.validateMediaDecoding.mockRejectedValue(new Error(
      'moov atom not found\nhttps://storage.example.com/damaged.mp4: Invalid data found when processing input',
    ));

    await expect(validateUploadedMediaDecoding({
      objectKey: 'users/user-1/uploads/session/damaged.mp4',
      assetType: 'video',
    })).rejects.toMatchObject({ code: 'UPLOAD_MEDIA_DETECTION_FAILED' });
  });

  it('明确的上游连接故障保留原错误以便 worker 重试', async () => {
    const upstreamError = new Error('Connection timed out while reading input');
    mocks.validateMediaDecoding.mockRejectedValue(upstreamError);

    await expect(validateUploadedMediaDecoding({
      objectKey: 'users/user-1/uploads/session/video.mp4',
      assetType: 'video',
    })).rejects.toBe(upstreamError);
  });
});

describe('历史视频缩略图 key', () => {
  it('只由用户和资产 ID 决定，不包含日期或随机段', () => {
    expect(buildHistoricalVideoThumbnailKey('user-1', 'asset-1'))
      .toBe('users/user-1/asset-thumbnails/asset-1.jpg');
  });
});
