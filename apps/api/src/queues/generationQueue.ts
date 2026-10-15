import { Queue, type ConnectionOptions } from 'bullmq';
import { env } from '../config/env.js';
import { registerSafeEmitterErrorListener } from '../safeEmitterError.js';

export const generationQueueName = 'generation-tasks';

let queue: Queue | null = null;

export function getRedisConnectionOptions(): ConnectionOptions {
  return {
    url: env.REDIS_URL,
    maxRetriesPerRequest: null,
  };
}

export function getGenerationQueue() {
  if (queue) return queue;

  const nextQueue = new Queue(generationQueueName, {
    connection: getRedisConnectionOptions(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  });
  registerSafeEmitterErrorListener(nextQueue, 'generation-queue-error', 'BULLMQ_QUEUE_ERROR');
  queue = nextQueue;

  return nextQueue;
}

export async function enqueueGenerationTask(taskId: string, attempt = 0, claimEpoch = 0) {
  const generationQueue = getGenerationQueue();
  // attempt 只表示用户/管理员发起的业务重试；claimEpoch 表示同一 attempt 的租约接管代次。
  // 已完成的 BullMQ job 会保留用于诊断，因此恢复投递必须使用新的 claimEpoch，
  // 否则 add 只会命中旧的 completed job，数据库任务会永久停在 queued。
  // BullMQ 把冒号作为内部 key 分隔符，所以 jobId 只使用连字符。
  const jobId = `${taskId}-attempt-${attempt}-claim-${claimEpoch}`;
  await generationQueue.add('process-generation', { taskId, attempt, claimEpoch }, { jobId });
}

export async function closeGenerationQueue() {
  if (!queue) return;
  const current = queue;
  queue = null;
  await current.close();
}
