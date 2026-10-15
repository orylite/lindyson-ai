import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  assets: vi.fn(),
  signedUrls: vi.fn(),
  objectSize: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: vi.fn(),
}));

vi.mock('../src/domain/assetReferences.js', () => ({
  readOwnedAssetReferencesByIds: mocks.assets,
}));

vi.mock('../src/domain/assetReadUrlSigner.js', () => ({
  signOwnedObjectReadUrls: mocks.signedUrls,
}));

vi.mock('../src/storage/storageService.js', () => ({
  getStoredObjectSize: mocks.objectSize,
}));

import { resolveTkPromptEngineImages } from '../src/domain/tkPromptEngineService.js';

const userId = '00000000-0000-4000-8000-000000000901';
const assetId = '00000000-0000-4000-8000-000000000902';

describe('TK Prompt Engine 商品图 MIME 解析', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.assets.mockReset();
    mocks.signedUrls.mockReset();
    mocks.objectSize.mockReset();
    const asset = imageAsset('users/user/uploads/session/product');
    mocks.assets.mockResolvedValue(new Map([[assetId, asset]]));
    mocks.signedUrls.mockResolvedValue(new Map([[
      asset.object_key,
      'https://assets.example.com/product?signature=redacted',
    ]]));
    mocks.objectSize.mockResolvedValue(2_048);
  });

  it('无后缀商品图必须由完成上传会话与 ready 缩略图链提供 JPEG 类型', async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [{ asset_id: assetId, content_type: 'image/jpeg' }],
      rowCount: 1,
    });

    await expect(resolveTkPromptEngineImages(userId, [assetId])).resolves.toEqual([
      expect.objectContaining({ assetId, mimeType: 'image/jpeg', sizeBytes: 2_048 }),
    ]);
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain(
      "session.status = 'completed'",
    );
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain(
      "asset.thumbnail_status = 'ready'",
    );
    expect(mocks.poolQuery.mock.calls[0]?.[1]).toEqual([userId, [assetId]]);
  });

  it('完成会话记录伪造类型时即使对象键有图片后缀也拒绝', async () => {
    const asset = imageAsset('users/user/uploads/session/product.jpg');
    mocks.assets.mockResolvedValue(new Map([[assetId, asset]]));
    mocks.signedUrls.mockResolvedValue(new Map([[
      asset.object_key,
      'https://assets.example.com/product.jpg?signature=redacted',
    ]]));
    mocks.poolQuery.mockResolvedValue({
      rows: [{ asset_id: assetId, content_type: 'text/plain' }],
      rowCount: 1,
    });

    await expect(resolveTkPromptEngineImages(userId, [assetId])).rejects.toMatchObject({
      code: 'TK_PROMPT_IMAGE_MIME_INVALID',
    });
  });

  it('没有完成会话时仅允许对象键的安全后缀回退，无后缀保持关闭', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(resolveTkPromptEngineImages(userId, [assetId])).rejects.toMatchObject({
      code: 'TK_PROMPT_IMAGE_MIME_INVALID',
    });

    const asset = imageAsset('users/user/historical/product.png');
    mocks.assets.mockResolvedValue(new Map([[assetId, asset]]));
    mocks.signedUrls.mockResolvedValue(new Map([[
      asset.object_key,
      'https://assets.example.com/product.png?signature=redacted',
    ]]));
    await expect(resolveTkPromptEngineImages(userId, [assetId])).resolves.toEqual([
      expect.objectContaining({ mimeType: 'image/png' }),
    ]);
  });
});

function imageAsset(objectKey: string) {
  return {
    id: assetId,
    user_id: userId,
    name: '商品图片',
    object_key: objectKey,
    thumbnail_key: 'users/user/upload-thumbnails/session.webp',
    thumbnail_status: 'ready',
    type: 'image',
    duration_seconds: null,
    size_bytes: 2_048,
    width: 1_080,
    height: 1_080,
  };
}
