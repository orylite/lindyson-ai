import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { getRedisConnectionOptions } from './generationQueue.js';
import { registerSafeEmitterErrorListener } from '../safeEmitterError.js';

export const tkPromptEngineQueueName = 'tk-prompt-engine-tasks-v1';

export type TkPromptEngineQueueJob =
  | { kind: 'analysis'; runId: string; attempt: number }
  | { kind: 'strategy'; generationId: string; attempt: number }
  | { kind: 'option'; optionId: string; attempt: number };

let queue: Queue<TkPromptEngineQueueJob, void, string> | null = null;

export function getTkPromptEngineQueue() {
  if (queue) return queue;
  const nextQueue = new Queue<TkPromptEngineQueueJob, void, string>(tkPromptEngineQueueName, {
    connection: getRedisConnectionOptions(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
      removeOnFail: { age: 24 * 60 * 60, count: 5_000 },
    },
  });
  registerSafeEmitterErrorListener(nextQueue, 'tk-prompt-engine-queue-error', 'BULLMQ_QUEUE_ERROR');
  queue = nextQueue;
  return nextQueue;
}

export async function configureTkPromptEngineQueueGlobalConcurrency(
  concurrency = env.PROMPT_WIZARD_QUEUE_CONCURRENCY,
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('TK Prompt Engine 队列并发数必须是正整数');
  }
  await getTkPromptEngineQueue().setGlobalConcurrency(concurrency);
}

export async function enqueueTkPromptAnalysis(runId: string, attempt = 1) {
  await getTkPromptEngineQueue().add(
    'analysis',
    { kind: 'analysis', runId, attempt },
    { jobId: jobId('analysis', runId, attempt) },
  );
}

export async function enqueueTkPromptStrategy(generationId: string, attempt = 1) {
  await getTkPromptEngineQueue().add(
    'strategy',
    { kind: 'strategy', generationId, attempt },
    { jobId: jobId('strategy', generationId, attempt) },
  );
}

export async function enqueueTkPromptOption(optionId: string, attempt = 1) {
  await getTkPromptEngineQueue().add(
    'option',
    { kind: 'option', optionId, attempt },
    { jobId: jobId('option', optionId, attempt) },
  );
}

export async function closeTkPromptEngineQueue() {
  if (!queue) return;
  const current = queue;
  queue = null;
  await current.close();
}

function jobId(kind: TkPromptEngineQueueJob['kind'], entityId: string, attempt: number) {
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error('TK Prompt Engine 队列 attempt 必须为正整数');
  }
  return `${kind}:${entityId}:${attempt}`;
}
