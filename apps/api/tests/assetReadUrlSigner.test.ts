import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createObjectReadUrl: vi.fn(),
}));

vi.mock('../src/storage/storageService.js', () => ({
  createObjectReadUrl: mocks.createObjectReadUrl,
}));

import {
  assetReadUrlSignerLimits,
  resetAssetReadUrlSignerForTests,
  signOwnedObjectReadUrl,
  signOwnedObjectReadUrls,
} from '../src/domain/assetReadUrlSigner.js';

describe('assetReadUrlSigner', () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetAssetReadUrlSignerForTests();
    mocks.createObjectReadUrl.mockReset();
    mocks.createObjectReadUrl.mockImplementation(async (key: string) => `https://read.example.com/${key}`);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetAssetReadUrlSignerForTests();
  });

  it('并发和后续重复 key 共用一次成功签名', async () => {
    const [first, second, batch] = await Promise.all([
      signOwnedObjectReadUrl('users/user-1/thumb.jpg'),
      signOwnedObjectReadUrl('users/user-1/thumb.jpg'),
      signOwnedObjectReadUrls([
        'users/user-1/thumb.jpg',
        'users/user-1/thumb.jpg',
      ]),
    ]);
    const replay = await signOwnedObjectReadUrl('users/user-1/thumb.jpg');

    expect(first).toBe(second);
    expect(replay).toBe(first);
    expect(batch.get('users/user-1/thumb.jpg')).toBe(first);
    expect(mocks.createObjectReadUrl).toHaveBeenCalledTimes(1);
  });

  it('失败签名不会进入缓存', async () => {
    mocks.createObjectReadUrl
      .mockRejectedValueOnce(new Error('temporary storage failure'))
      .mockResolvedValueOnce('https://read.example.com/recovered.jpg');

    await expect(signOwnedObjectReadUrl('users/user-1/retry.jpg')).rejects.toThrow('temporary');
    await expect(signOwnedObjectReadUrl('users/user-1/retry.jpg')).resolves.toBe(
      'https://read.example.com/recovered.jpg',
    );
    expect(mocks.createObjectReadUrl).toHaveBeenCalledTimes(2);
  });

  it('任何时刻最多执行 16 个底层签名', async () => {
    let active = 0;
    let peak = 0;
    mocks.createObjectReadUrl.mockImplementation(async (key: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active -= 1;
      return `https://read.example.com/${key}`;
    });

    await signOwnedObjectReadUrls(Array.from({ length: 48 }, (_, index) => `users/user-1/${index}.jpg`));

    expect(peak).toBe(assetReadUrlSignerLimits.maxConcurrency);
    expect(assetReadUrlSignerLimits).toMatchObject({
      maxConcurrency: 16,
      cacheTtlMs: 5 * 60_000,
      cacheMaxEntries: 5_000,
    });
  });

  it('成功缓存超过五分钟后重新签名', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
    await signOwnedObjectReadUrl('users/user-1/expiring.jpg');
    vi.setSystemTime(new Date('2026-07-17T00:05:00.001Z'));
    await signOwnedObjectReadUrl('users/user-1/expiring.jpg');

    expect(mocks.createObjectReadUrl).toHaveBeenCalledTimes(2);
  });

  it('不同有效期不共用签名，并把指定有效期传给存储层', async () => {
    await signOwnedObjectReadUrl('users/user-1/product.webp');
    await signOwnedObjectReadUrl('users/user-1/product.webp', { expiresInSeconds: 10 * 60 });
    await signOwnedObjectReadUrl('users/user-1/product.webp', { expiresInSeconds: 10 * 60 });

    expect(mocks.createObjectReadUrl).toHaveBeenCalledTimes(2);
    expect(mocks.createObjectReadUrl).toHaveBeenNthCalledWith(
      2,
      'users/user-1/product.webp',
      10 * 60,
    );
  });
});
