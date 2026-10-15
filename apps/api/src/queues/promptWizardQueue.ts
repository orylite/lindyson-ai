import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { getRedisConnectionOptions } from './generationQueue.js';
import { registerSafeEmitterErrorListener } from '../safeEmitterError.js';

export const promptWizardQueueName = 'prompt-wizard-tasks';

type PromptWizardQueueJob =
  | { kind: 'analyze'; runId: string }
  | { kind: 'concept'; conceptSetId: string }
  | { kind: 'use-direction'; useDirectionSetId: string }
  | { kind: 'route-set-v6'; routeSetId: string }
  | { kind: 'generate'; batchId: string }
  | { kind: 'refine'; revisionId: string };

let queue: Queue<PromptWizardQueueJob> | null = null;

export function getPromptWizardQueue() {
  if (queue) return queue;
  const nextQueue = new Queue<PromptWizardQueueJob>(promptWizardQueueName, {
    connection: getRedisConnectionOptions(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
    },
  });
  registerSafeEmitterErrorListener(nextQueue, 'prompt-wizard-queue-error', 'BULLMQ_QUEUE_ERROR');
  queue = nextQueue;
  return nextQueue;
}

/** 多 worker 实例共享此上限，避免副本数放大提示词任务并发。 */
export async function configurePromptWizardQueueGlobalConcurrency(
  concurrency = env.PROMPT_WIZARD_QUEUE_CONCURRENCY,
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('提示词向导队列并发数必须是正整数');
  }
  await getPromptWizardQueue().setGlobalConcurrency(concurrency);
}

export async function enqueuePromptWizardAnalysis(runId: string, attempt = 0) {
  await getPromptWizardQueue().add(
    'analyze-product',
    { kind: 'analyze', runId },
    { jobId: `analysis-${runId}-attempt-${attempt}` },
  );
}

export async function enqueuePromptWizardBatch(batchId: string, attempt = 0) {
  await getPromptWizardQueue().add(
    'generate-plans',
    { kind: 'generate', batchId },
    { jobId: `batch-${batchId}-attempt-${attempt}` },
  );
}

export async function enqueuePromptWizardRouteSetV6(routeSetId: string, attempt = 0) {
  await getPromptWizardQueue().add(
    'generate-routes-v6',
    { kind: 'route-set-v6', routeSetId },
    { jobId: `route-set-v6-${routeSetId}-attempt-${attempt}` },
  );
}

export async function enqueuePromptWizardConceptSet(conceptSetId: string, attempt = 0) {
  await getPromptWizardQueue().add(
    'generate-concepts',
    { kind: 'concept', conceptSetId },
    { jobId: `concept-set-${conceptSetId}-attempt-${attempt}` },
  );
}

export async function enqueuePromptWizardUseDirectionSet(
  useDirectionSetId: string,
  attempt = 0,
) {
  await getPromptWizardQueue().add(
    'generate-use-directions',
    { kind: 'use-direction', useDirectionSetId },
    { jobId: `use-direction-set-${useDirectionSetId}-attempt-${attempt}` },
  );
}

export async function enqueuePromptWizardPlanRefinement(revisionId: string, attempt = 0) {
  await getPromptWizardQueue().add(
    'refine-plan',
    { kind: 'refine', revisionId },
    { jobId: `plan-revision-${revisionId}-attempt-${attempt}` },
  );
}

export async function closePromptWizardQueue() {
  if (!queue) return;
  const current = queue;
  queue = null;
  await current.close();
}
