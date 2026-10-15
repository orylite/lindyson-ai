import {
  enqueuePromptWizardAnalysis,
  enqueuePromptWizardBatch,
  enqueuePromptWizardConceptSet,
  enqueuePromptWizardPlanRefinement,
  enqueuePromptWizardRouteSetV6,
  enqueuePromptWizardUseDirectionSet,
} from '../queues/promptWizardQueue.js';

interface RecoverablePromptWizardJob {
  id: string;
  attempt: number;
}

export interface RecoverablePromptWizardJobs {
  runs: RecoverablePromptWizardJob[];
  conceptSets: RecoverablePromptWizardJob[];
  useDirectionSets: RecoverablePromptWizardJob[];
  routeSets: RecoverablePromptWizardJob[];
  batches: RecoverablePromptWizardJob[];
  planRevisions: RecoverablePromptWizardJob[];
}

/**
 * 将数据库中的可恢复状态逐类映射回 BullMQ。V4/V5 历史任务仍需消费
 * Concept Set 与 refinement；V6 则消费 route set 与三方案批次。
 */
export async function enqueueRecoverablePromptWizardJobs(
  recoverable: RecoverablePromptWizardJobs,
) {
  await Promise.all([
    ...recoverable.runs.map(run => enqueuePromptWizardAnalysis(run.id, run.attempt)),
    ...recoverable.conceptSets.map(conceptSet => (
      enqueuePromptWizardConceptSet(conceptSet.id, conceptSet.attempt)
    )),
    ...recoverable.useDirectionSets.map(useDirectionSet => (
      enqueuePromptWizardUseDirectionSet(useDirectionSet.id, useDirectionSet.attempt)
    )),
    ...recoverable.routeSets.map(routeSet => (
      enqueuePromptWizardRouteSetV6(routeSet.id, routeSet.attempt)
    )),
    ...recoverable.batches.map(batch => enqueuePromptWizardBatch(batch.id, batch.attempt)),
    ...recoverable.planRevisions.map(revision => (
      enqueuePromptWizardPlanRefinement(revision.id, revision.attempt)
    )),
  ]);
}
