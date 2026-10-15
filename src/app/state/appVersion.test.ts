import { describe,expect,it,vi } from 'vitest';
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  fetchAppVersionManifest,
  hasAppUpdate,
  isAppVersionManifest,
  type VersionManifestFetcher,
} from './appVersion';
import { recoverFromStaleChunk } from './staleChunkRecovery';

describe('应用版本更新', () => {
  it('每五分钟检测一次更新', () => {
    expect(APP_UPDATE_CHECK_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it('仅接受具有构建标识和构建时间的版本清单', () => {
    expect(isAppVersionManifest({ buildId: '20260711', builtAt: '2026-07-11T10:00:00.000Z' })).toBe(true);
    expect(isAppVersionManifest({ buildId: '', builtAt: '2026-07-11T10:00:00.000Z' })).toBe(false);
    expect(isAppVersionManifest({ buildId: '20260711' })).toBe(false);
  });

  it('远端构建标识变化时才提示更新', () => {
    expect(hasAppUpdate('build-a', { buildId: 'build-a', builtAt: '2026-07-11T10:00:00.000Z' })).toBe(false);
    expect(hasAppUpdate('build-a', { buildId: 'build-b', builtAt: '2026-07-11T10:00:00.000Z' })).toBe(true);
    expect(hasAppUpdate('build-a', null)).toBe(false);
  });

  it('以 no-store 拉取版本清单，并在失败或格式异常时静默忽略', async () => {
    const fetcher = vi.fn<VersionManifestFetcher>().mockResolvedValue(new Response(JSON.stringify({
      buildId: 'build-b',
      builtAt: '2026-07-11T10:00:00.000Z',
    })));

    await expect(fetchAppVersionManifest('build-a', fetcher)).resolves.toMatchObject({ buildId: 'build-b' });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/^\/version\.json\?build=build-a&t=\d+$/),
      expect.objectContaining({ cache: 'no-store' }),
    );

    const malformedFetcher: VersionManifestFetcher = async () => new Response(JSON.stringify({ buildId: 'build-b' }));
    const rejectedFetcher: VersionManifestFetcher = async () => Promise.reject(new Error('network failure'));
    await expect(fetchAppVersionManifest('build-a', malformedFetcher)).resolves.toBeNull();
    await expect(fetchAppVersionManifest('build-a', rejectedFetcher)).resolves.toBeNull();
  });

  it('同一构建发生陈旧代码块错误时只自动刷新一次', () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
    };
    const reload = vi.fn();

    expect(recoverFromStaleChunk(storage, 'build-a', reload)).toBe(true);
    expect(recoverFromStaleChunk(storage, 'build-a', reload)).toBe(false);
    expect(recoverFromStaleChunk(storage, 'build-b', reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
