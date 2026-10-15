import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import {
  processTkPromptAnalysis,
  processTkPromptOption,
  processTkPromptStrategy,
  recoverTkPromptEngineWork,
  TK_PROMPT_STALE_CLAIM_AFTER_MS,
  type TkPromptEngineRuntime,
} from '../domain/tkPromptEngineService.js';
import {
  enqueueTkPromptAnalysis,
  enqueueTkPromptOption,
  enqueueTkPromptStrategy,
  tkPromptEngineQueueName,
  type TkPromptEngineQueueJob,
} from '../queues/tkPromptEngineQueue.js';
import { getRedisConnectionOptions } from '../queues/generationQueue.js';
import { tkPromptEngineRepository } from '../domain/tkPromptEngineRepository.js';
import { registerSafeWorkerErrorListener } from './workerLifecycle.js';

export async function processTkPromptEngineQueueJob(
  job: TkPromptEngineQueueJob,
  runtime: TkPromptEngineRuntime = {},
) {
  if (job.kind === 'analysis') {
    await processTkPromptAnalysis(job.runId, job.attempt, runtime);
    return;
  }
  if (job.kind === 'strategy') {
    const optionIds = await processTkPromptStrategy(job.generationId, job.attempt, runtime);
    await Promise.all(optionIds.map(optionId => enqueueTkPromptOption(optionId, 1)));
    return;
  }
  if (job.kind === 'option') {
    await processTkPromptOption(job.optionId, job.attempt, runtime);
    return;
  }
  const exhaustive: never = job;
  throw Object.assign(new Error(`TK Prompt Engine 未知队列任务：${String(exhaustive)}`), {
    code: 'TK_PROMPT_QUEUE_JOB_INVALID',
  });
}

export async function enqueueRecoverableTkPromptEngineJobs() {
  const work = await recoverTkPromptEngineWork();
  await Promise.all([
    ...work.runs.map(item => enqueueTkPromptAnalysis(item.id, item.attempt)),
    ...work.generations.map(item => enqueueTkPromptStrategy(item.id, item.attempt)),
    ...work.options.map(item => enqueueTkPromptOption(item.id, item.attempt)),
  ]);
  return {
    runs: work.runs.length,
    generations: work.generations.length,
    options: work.options.length,
  };
}

export async function runTkPromptEngineMaintenance() {
  const providerRequests = await tkPromptEngineRepository.expireStartedProviderRequests(
    // Provider 的完整调用预算本身可达 180 秒；结果返回后仍需写 Token/价格终态。
    // 只有与 claim 同样失联 20 分钟后才判 outcome unknown，避免维护线程抢先封账。
    new Date(Date.now() - TK_PROMPT_STALE_CLAIM_AFTER_MS),
    100,
  );
  const expired = await tkPromptEngineRepository.expireActive(100);
  const purged = await tkPromptEngineRepository.purgeExpired(100);
  const recovered = await enqueueRecoverableTkPromptEngineJobs();
  return { providerRequests, expired, purged, recovered };
}

export function startTkPromptEngineWorker(runtime: TkPromptEngineRuntime = {}) {
  const worker = new Worker<TkPromptEngineQueueJob, void>(
    tkPromptEngineQueueName,
    job => processTkPromptEngineQueueJob(job.data, runtime),
    {
      connection: getRedisConnectionOptions(),
      concurrency: env.PROMPT_WIZARD_QUEUE_CONCURRENCY,
      lockDuration: env.PROMPT_WIZARD_BATCH_BUDGET_MS + 60_000,
    },
  );
  registerSafeWorkerErrorListener(worker, 'tk-prompt-engine-worker-error');
  worker.on('completed', job => console.log(JSON.stringify({
    event: 'tk-prompt-engine-job-completed',
    kind: job.data.kind,
    jobId: job.id,
  })));
  worker.on('failed', (job, error) => console.error(JSON.stringify({
    event: 'tk-prompt-engine-job-failed',
    kind: job?.data.kind ?? null,
    jobId: job?.id ?? null,
    errorCode: safeWorkerErrorCode(error),
  })));
  return worker;
}

function safeWorkerErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'TK_PROMPT_TASK_FAILED';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^TK_PROMPT_[A-Z0-9_]{1,80}$/u.test(code)
    ? code
    : 'TK_PROMPT_TASK_FAILED';
}
