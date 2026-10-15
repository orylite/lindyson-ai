import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploadObjectBuffer = vi.hoisted(() => vi.fn());
vi.mock('../src/config/env.js', () => ({
  env: { FAKE_PROVIDER_DELAY_MS: 0 },
}));
vi.mock('../src/storage/storageService.js', () => ({
  buildPublicUrl: (key: string) => `http://storage.test/${key}`,
  uploadObjectBuffer,
}));

import { runFakeProvider } from '../src/providers/fakeProvider.js';

describe('fakeProvider', () => {
  beforeEach(() => {
    uploadObjectBuffer.mockReset();
    uploadObjectBuffer.mockResolvedValue({});
  });

  it('成功任务会真正写入原文件和缩略图，避免假 URL 404', async () => {
    const result = await runFakeProvider({
      taskId: 'task-1', userId: 'user-1', kind: 'video', model: 'Seedance 2.0',
      prompt: '生成视频', config: { durationSeconds: 5 }, credits: 10,
      outputObjectKey: 'generated/video/user-1/task-1/attempt-0/output.mp4',
      thumbnailObjectKey: 'generated/video/user-1/task-1/attempt-0/thumbnail.jpg',
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      objectKey: 'generated/video/user-1/task-1/attempt-0/output.mp4',
      thumbnailKey: 'generated/video/user-1/task-1/attempt-0/thumbnail.jpg',
      sizeBytes: expect.any(Number),
    }));
    expect(uploadObjectBuffer).toHaveBeenNthCalledWith(1, expect.objectContaining({
      objectKey: 'generated/video/user-1/task-1/attempt-0/output.mp4',
      contentType: 'video/mp4',
      body: expect.any(Buffer),
    }));
    expect(uploadObjectBuffer).toHaveBeenNthCalledWith(2, expect.objectContaining({
      objectKey: 'generated/video/user-1/task-1/attempt-0/thumbnail.jpg',
      contentType: 'image/jpeg',
    }));
  });

  it('拒绝回退到按执行日期或临时规则计算的对象 key', async () => {
    await expect(runFakeProvider({
      taskId: 'task-1', userId: 'user-1', kind: 'video', model: 'Seedance 2.0',
      prompt: '生成视频', config: { durationSeconds: 5 }, credits: 10,
    })).rejects.toMatchObject({ code: 'GENERATION_OBJECT_KEY_MISSING' });
    expect(uploadObjectBuffer).not.toHaveBeenCalled();
  });
});
