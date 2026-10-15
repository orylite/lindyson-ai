import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: vi.fn(),
}));

vi.mock('../src/providers/promptWizardProvider.js', () => ({
  getPromptWizardProvider: vi.fn(),
}));

vi.mock('../src/domain/assetReferences.js', () => ({
  readOwnedAssetReferencesByIds: vi.fn(),
}));

vi.mock('../src/domain/assetReadUrlSigner.js', () => ({
  signOwnedObjectReadUrls: vi.fn(),
}));

vi.mock('../src/storage/storageService.js', () => ({
  getStoredObjectSize: vi.fn(),
}));

vi.mock('../src/domain/promptWizardCredits.js', () => ({
  holdPromptWizardCreditsWithClient: vi.fn(),
  releasePromptWizardCreditsWithClient: vi.fn(),
  settlePromptWizardCreditsWithClient: vi.fn(),
}));

vi.mock('../src/domain/generationCredits.js', () => ({
  planGenerationLotAllocationsWithClient: vi.fn(),
}));

vi.mock('../src/domain/subscriptionLifecycle.js', () => ({
  reconcileSubscriptionWithClient: vi.fn(),
}));

import { resumePromptWizard } from '../src/domain/promptWizardService.js';

const EMPTY_RESUME = {
  run: null,
  conceptSet: null,
  useDirectionSet: null,
  batch: null,
  planRevision: null,
};

describe('提示词向导 3.0 独占恢复信号', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
  });

  it('最近任务为已归档 2.0 时只返回退役信号，不返回旧正文', async () => {
    mockNoResumableRun({
      engine_version: 2,
      status: 'archived',
      has_product_profile: false,
      has_evidence_graph: false,
      has_production_brief: false,
    });

    await expect(resumePromptWizard('user-legacy')).resolves.toEqual({
      ...EMPTY_RESUME,
      legacyTaskRetired: true,
    });
  });

  it.each([
    ['产品档案', false, true, true],
    ['证据图谱', true, false, true],
    ['生产简报', true, true, false],
  ])('3.0 ready 任务缺少%s时返回清理信号', async (
    _missingField,
    hasProductProfile,
    hasEvidenceGraph,
    hasProductionBrief,
  ) => {
    mockNoResumableRun({
      engine_version: 3,
      status: 'ready',
      has_product_profile: hasProductProfile,
      has_evidence_graph: hasEvidenceGraph,
      has_production_brief: hasProductionBrief,
    });

    await expect(resumePromptWizard('user-incomplete-v3')).resolves.toEqual({
      ...EMPTY_RESUME,
      legacyTaskRetired: true,
    });
  });

  it('用户没有任何历史任务时返回空快照且不触发退役提示', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([{ engine_version: 3 }]))
      .mockResolvedValueOnce(queryResult([]));

    await expect(resumePromptWizard('user-new')).resolves.toEqual({
      ...EMPTY_RESUME,
      legacyTaskRetired: false,
    });
  });
});

function mockNoResumableRun(latest: {
  engine_version: 2 | 3;
  status: string;
  has_product_profile: boolean;
  has_evidence_graph: boolean;
  has_production_brief: boolean;
}) {
  mocks.poolQuery
    .mockResolvedValueOnce(queryResult([{ engine_version: 3 }]))
    .mockResolvedValueOnce(queryResult([latest]));
}

function queryResult<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}
