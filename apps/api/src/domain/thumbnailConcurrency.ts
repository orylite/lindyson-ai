import { env } from '../config/env.js';

export type ThumbnailMediaKind = 'image' | 'video';

interface ThumbnailConcurrencyLimits {
  image: number;
  video: number;
}

interface PermitWaiter {
  resolve: () => void;
}

/**
 * 图片和视频缩略图分别限流。生产 worker 会在同一进程同时消费生成与上传队列，
 * 因而必须共享同一组 permit，不能只限制某一条队列的 BullMQ 并发数。
 */
export function createThumbnailConcurrencyController(limits: ThumbnailConcurrencyLimits) {
  const states = {
    image: createPermitState(limits.image, '图片'),
    video: createPermitState(limits.video, '视频'),
  };

  return {
    async run<T>(kind: ThumbnailMediaKind, task: () => Promise<T>): Promise<T> {
      const state = states[kind];
      await acquirePermit(state);
      try {
        return await task();
      } finally {
        releasePermit(state);
      }
    },
    snapshot() {
      return {
        image: { active: states.image.active, waiting: states.image.waiters.length, limit: states.image.limit },
        video: { active: states.video.active, waiting: states.video.waiters.length, limit: states.video.limit },
      };
    },
  };
}

const workerThumbnailConcurrency = createThumbnailConcurrencyController({
  image: env.THUMBNAIL_IMAGE_CONCURRENCY,
  video: env.THUMBNAIL_VIDEO_CONCURRENCY,
});

/** 在缩略图读取、计算和 TOS 上传全部结束前持续占用对应媒体类型的 permit。 */
export function withThumbnailConcurrency<T>(kind: ThumbnailMediaKind, task: () => Promise<T>) {
  return workerThumbnailConcurrency.run(kind, task);
}

export const thumbnailConcurrencyLimits = {
  image: env.THUMBNAIL_IMAGE_CONCURRENCY,
  video: env.THUMBNAIL_VIDEO_CONCURRENCY,
} as const;

function createPermitState(limit: number, label: string) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`${label}缩略图并发数必须是正整数`);
  return {
    limit,
    active: 0,
    waiters: [] as PermitWaiter[],
  };
}

async function acquirePermit(state: ReturnType<typeof createPermitState>) {
  if (state.active < state.limit) {
    state.active += 1;
    return;
  }
  await new Promise<void>(resolve => state.waiters.push({ resolve }));
}

function releasePermit(state: ReturnType<typeof createPermitState>) {
  const next = state.waiters.shift();
  if (next) {
    // permit 直接交给队首等待者，active 保持不变，避免唤醒间隙被新任务抢占。
    next.resolve();
    return;
  }
  state.active -= 1;
}
