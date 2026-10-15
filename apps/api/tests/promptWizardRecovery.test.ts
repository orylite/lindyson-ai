import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analysis: vi.fn().mockResolvedValue(undefined),
  batch: vi.fn().mockResolvedValue(undefined),
  concept: vi.fn().mockResolvedValue(undefined),
  refinement: vi.fn().mockResolvedValue(undefined),
  routeSet: vi.fn().mockResolvedValue(undefined),
  useDirection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/queues/promptWizardQueue.js', () => ({
  enqueuePromptWizardAnalysis: mocks.analysis,
  enqueuePromptWizardBatch: mocks.batch,
  enqueuePromptWizardConceptSet: mocks.concept,
  enqueuePromptWizardPlanRefinement: mocks.refinement,
  enqueuePromptWizardRouteSetV6: mocks.routeSet,
  enqueuePromptWizardUseDirectionSet: mocks.useDirection,
}));

import { enqueueRecoverablePromptWizardJobs } from '../src/worker/promptWizardRecovery.js';

describe('提示词向导任务恢复入队', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('同时恢复旧 Concept/Refinement 与 V6 Route Set/批次', async () => {
    await enqueueRecoverablePromptWizardJobs({
      runs: [{ id: 'run-1', attempt: 1 }],
      conceptSets: [{ id: 'concept-1', attempt: 2 }],
      useDirectionSets: [{ id: 'direction-1', attempt: 3 }],
      routeSets: [{ id: 'route-1', attempt: 4 }],
      batches: [{ id: 'batch-1', attempt: 5 }],
      planRevisions: [{ id: 'revision-1', attempt: 6 }],
    });

    expect(mocks.analysis).toHaveBeenCalledWith('run-1', 1);
    expect(mocks.concept).toHaveBeenCalledWith('concept-1', 2);
    expect(mocks.useDirection).toHaveBeenCalledWith('direction-1', 3);
    expect(mocks.routeSet).toHaveBeenCalledWith('route-1', 4);
    expect(mocks.batch).toHaveBeenCalledWith('batch-1', 5);
    expect(mocks.refinement).toHaveBeenCalledWith('revision-1', 6);
  });
});
