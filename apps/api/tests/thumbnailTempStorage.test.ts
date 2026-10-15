import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import {
  withThumbnailTempDirectory,
  writeThumbnailTempFile,
} from '../src/domain/thumbnailTempStorage.js';

const originalRoot = env.THUMBNAIL_TEMP_ROOT;
let testRoot: string | null = null;

afterEach(async () => {
  env.THUMBNAIL_TEMP_ROOT = originalRoot;
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true });
  testRoot = null;
});

describe('thumbnailTempStorage', () => {
  it('任务结束后无论成功与否都删除任务专属目录', async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbnail-temp-test-'));
    env.THUMBNAIL_TEMP_ROOT = testRoot;
    const jobId = '00000000-0000-4000-8000-000000000001';
    const leaseToken = '00000000-0000-4000-8000-000000000002';
    let taskDirectory = '';

    await expect(withThumbnailTempDirectory(jobId, leaseToken, async directory => {
      taskDirectory = directory;
      const file = await writeThumbnailTempFile(directory, 'thumbnail.webp', Buffer.from('test'));
      const stats = await fs.stat(file);
      expect(stats.mode & 0o777).toBe(0o600);
      throw new Error('模拟处理失败');
    })).rejects.toThrow('模拟处理失败');

    await expect(fs.access(taskDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
