import { beforeEach, describe, expect, it, vi } from 'vitest';

const { uploadObjectWithProgress, createRealPortraitUpload, completeRealPortraitUpload } = vi.hoisted(() => ({
  uploadObjectWithProgress: vi.fn(),
  createRealPortraitUpload: vi.fn(),
  completeRealPortraitUpload: vi.fn(),
}));

vi.mock('./assetUpload', () => ({ uploadObjectWithProgress }));
vi.mock('./mutations', () => ({ createRealPortraitUpload, completeRealPortraitUpload }));

import { uploadRealPortraitFile } from './realPortraitUpload';

function file(name: string, type: string, bytes = 'portrait-image') {
  return new File([bytes], name, { type });
}

describe('真人素材临时上传', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 800, height: 1200, close: vi.fn() }));
    createRealPortraitUpload.mockResolvedValue({
      id: 'upload-session-1',
      signature: {
        uploadUrl: 'https://storage.example.test/upload',
        method: 'PUT',
        headers: {},
      },
    });
    uploadObjectWithProgress.mockImplementation(async (_signature: unknown, _file: File, onProgress: (progress: number) => void) => {
      onProgress(100);
    });
    completeRealPortraitUpload.mockResolvedValue({
      id: 'portrait-asset-1',
      kind: 'primary',
      status: 'processing',
      consistencyStatus: 'pending',
    });
  });

  it('由文件扩展名安全推导 MIME，上传到临时通道后把尺寸和 SHA-256 回传服务端', async () => {
    const progress: number[] = [];

    await expect(uploadRealPortraitFile({
      actorId: 'actor-1',
      kind: 'primary',
      file: file('portrait.JPEG', ''),
      onProgress: value => progress.push(value),
    })).resolves.toMatchObject({ id: 'portrait-asset-1', kind: 'primary' });

    expect(createRealPortraitUpload).toHaveBeenCalledWith('actor-1', {
      kind: 'primary',
      mimeType: 'image/jpeg',
      sizeBytes: 14,
    });
    expect(uploadObjectWithProgress).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'upload-session-1' }),
      expect.any(File),
      expect.any(Function),
      expect.objectContaining({ timeoutMs: 20 * 60_000, idleTimeoutMs: 45_000 }),
    );
    expect(completeRealPortraitUpload).toHaveBeenCalledWith('upload-session-1', expect.objectContaining({
      mimeType: 'image/jpeg',
      sizeBytes: 14,
      width: 800,
      height: 1200,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(progress).toEqual([5, 85, 90, 100]);
  });

  it('不支持的格式和越界尺寸会在获取上传凭证前被本地拒绝', async () => {
    await expect(uploadRealPortraitFile({ actorId: 'actor-1', kind: 'primary', file: file('portrait.svg', 'image/svg+xml') }))
      .rejects.toThrow('仅支持 JPEG、PNG、WebP、BMP、TIFF、GIF、HEIC 或 HEIF 图片');
    expect(createRealPortraitUpload).not.toHaveBeenCalled();

    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 299, height: 800, close: vi.fn() }));
    await expect(uploadRealPortraitFile({ actorId: 'actor-1', kind: 'primary', file: file('portrait.png', 'image/png') }))
      .rejects.toThrow('真人图片宽高均须在 300 到 6000 像素之间');
    expect(createRealPortraitUpload).not.toHaveBeenCalled();
  });
});
