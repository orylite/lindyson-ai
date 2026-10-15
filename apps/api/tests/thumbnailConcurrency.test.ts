import { describe, expect, it } from 'vitest';
import { createThumbnailConcurrencyController } from '../src/domain/thumbnailConcurrency.js';

describe('缩略图媒体类型并发限制', () => {
  it('图片最多同时处理 2 个，等待任务按 permit 继续执行', async () => {
    const controller = createThumbnailConcurrencyController({ image: 2, video: 1 });
    const gates = Array.from({ length: 3 }, deferred);
    let active = 0;
    let maxActive = 0;
    const started: number[] = [];

    const tasks = gates.map((gate, index) => controller.run('image', async () => {
      started.push(index);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active -= 1;
      return index;
    }));

    await waitUntil(() => started.length === 2);
    expect(started).toEqual([0, 1]);
    expect(controller.snapshot().image).toEqual({ active: 2, waiting: 1, limit: 2 });

    gates[0]!.resolve();
    await waitUntil(() => started.length === 3);
    gates[1]!.resolve();
    gates[2]!.resolve();

    await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2]);
    expect(maxActive).toBe(2);
    expect(controller.snapshot().image).toEqual({ active: 0, waiting: 0, limit: 2 });
  });

  it('视频最多同时处理 1 个，且图片使用独立 permit', async () => {
    const controller = createThumbnailConcurrencyController({ image: 2, video: 1 });
    const firstVideo = deferred();
    const secondVideo = deferred();
    const image = deferred();
    const started: string[] = [];

    const tasks = [
      controller.run('video', async () => {
        started.push('video-1');
        await firstVideo.promise;
      }),
      controller.run('video', async () => {
        started.push('video-2');
        await secondVideo.promise;
      }),
      controller.run('image', async () => {
        started.push('image-1');
        await image.promise;
      }),
    ];

    await waitUntil(() => started.length === 2);
    expect(started).toEqual(['video-1', 'image-1']);
    expect(controller.snapshot()).toEqual({
      image: { active: 1, waiting: 0, limit: 2 },
      video: { active: 1, waiting: 1, limit: 1 },
    });

    firstVideo.resolve();
    await waitUntil(() => started.includes('video-2'));
    secondVideo.resolve();
    image.resolve();
    await Promise.all(tasks);
  });

  it('任务失败时也释放 permit', async () => {
    const controller = createThumbnailConcurrencyController({ image: 1, video: 1 });
    await expect(controller.run('video', async () => {
      throw new Error('ffmpeg failed');
    })).rejects.toThrow('ffmpeg failed');

    await expect(controller.run('video', async () => 'recovered')).resolves.toBe('recovered');
    expect(controller.snapshot().video.active).toBe(0);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('等待并发任务进入目标状态超时');
}
