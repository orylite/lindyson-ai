import { Queue, type ConnectionOptions } from 'bullmq';
import { env } from '../config/env.js';
import { registerSafeEmitterErrorListener } from '../safeEmitterError.js';

export const uploadQueueName = 'asset-upload-finalization';

let queue: Queue | null = null;

export function getUploadQueueConnectionOptions(): ConnectionOptions {
  return { url: env.REDIS_URL, maxRetriesPerRequest: null };
}

export function getUploadQueue() {
  if (queue) return queue;
  const nextQueue = new Queue(uploadQueueName, {
    connection: getUploadQueueConnectionOptions(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  });
  registerSafeEmitterErrorListener(nextQueue, 'upload-queue-error', 'BULLMQ_QUEUE_ERROR');
  queue = nextQueue;
  return nextQueue;
}

export async function enqueueUploadSession(sessionId: string, nextAttempt: number) {
  await getUploadQueue().add(
    'finalize-upload',
    { sessionId },
    { jobId: `${sessionId}-attempt-${nextAttempt}` },
  );
}

export async function closeUploadQueue() {
  if (!queue) return;
  const current = queue;
  queue = null;
  await current.close();
}
