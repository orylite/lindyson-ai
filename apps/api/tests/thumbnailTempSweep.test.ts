import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const poolQuery = vi.hoisted(() => vi.fn());
vi.mock('../src/db/pool.js', () => ({
  pool: { query: poolQuery },
}));

import { env } from '../src/config/env.js';
import { sweepOrphanThumbnailTempDirectories } from '../src/domain/thumbnailTempStorage.js';

const originalRoot = env.THUMBNAIL_TEMP_ROOT;
const originalMaxAge = env.THUMBNAIL_TEMP_MAX_AGE_MS;
let testRoot: string | null = null;

beforeEach(async () => {
  poolQuery.mockReset();
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbnail-sweep-test-'));
  env.THUMBNAIL_TEMP_ROOT = testRoot;
  env.THUMBNAIL_TEMP_MAX_AGE_MS = 60 * 60_000;
});

afterEach(async () => {
  env.THUMBNAIL_TEMP_ROOT = originalRoot;
  env.THUMBNAIL_TEMP_MAX_AGE_MS = originalMaxAge;
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true });
  testRoot = null;
});

describe('缩略图临时目录孤儿清扫', () => {
  it('删除过期且无租约目录，但保留已由数据库确认的活动租约', async () => {
    const staleJob = '00000000-0000-4000-8000-000000000011';
    const staleLease = '00000000-0000-4000-8000-000000000012';
    const activeJob = '00000000-0000-4000-8000-000000000021';
    const activeLease = '00000000-0000-4000-8000-000000000022';
    const staleDirectory = await createOldDirectory(staleJob, staleLease, 'stale');
    const activeDirectory = await createOldDirectory(activeJob, activeLease, 'active');
    poolQuery.mockImplementation(async (_sql, values: unknown[]) => ({
      rowCount: values[0] === activeJob && values[1] === activeLease ? 1 : 0,
      rows: values[0] === activeJob && values[1] === activeLease ? [{ present: 1 }] : [],
    }));

    const result = await sweepOrphanThumbnailTempDirectories(Date.now());

    expect(result).toMatchObject({ scanned: 2, removed: 1, active: 1 });
    expect(result.bytes).toBe(Buffer.byteLength('stale') + Buffer.byteLength('active'));
    await expect(fs.access(staleDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(activeDirectory)).resolves.toBeUndefined();
  });

  it('数据库检查失败时保持 fail-closed，不删除目录', async () => {
    const directory = await createOldDirectory(
      '00000000-0000-4000-8000-000000000031',
      '00000000-0000-4000-8000-000000000032',
      'keep',
    );
    poolQuery.mockRejectedValue(new Error('database unavailable'));

    await expect(sweepOrphanThumbnailTempDirectories(Date.now())).rejects.toThrow('database unavailable');
    await expect(fs.access(directory)).resolves.toBeUndefined();
  });
});

async function createOldDirectory(jobId: string, leaseToken: string, body: string) {
  const directory = path.join(testRoot!, jobId, leaseToken);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(directory, 'thumbnail.tmp'), body, { mode: 0o600 });
  const old = new Date(Date.now() - 2 * 60 * 60_000);
  await fs.utimes(directory, old, old);
  return directory;
}
