import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: mocks.withTransaction,
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

vi.mock('../src/queues/promptWizardQueue.js', () => ({
  enqueuePromptWizardRouteSetV6: vi.fn(),
}));

import {
  createPromptWizardRun,
  processPromptWizardRouteSetV6,
  purgeExpiredPromptWizardContent,
  readPromptWizardSettings,
  recoverPromptWizardJobs,
  resumePromptWizard,
  updatePromptWizardSettingsWithClient,
} from '../src/domain/promptWizardService.js';

const SETTINGS_V3_ROW = {
  refresh_credits: 1,
  available: false,
  engine_version: 3,
  updated_at: '2026-08-08T00:00:00.000Z',
};

const EMPTY_RECOVERY = {
  runs: [],
  conceptSets: [],
  useDirectionSets: [],
  routeSets: [],
  batches: [],
  planRevisions: [],
};

describe('Migration 070 / engine 3 滚动发布兼容边界', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withTransaction.mockImplementation(async callback => callback({
      query: mocks.clientQuery,
    }));
  });

  it('公开设置可读取 engine 3，且不会伪装成 engine 4', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([SETTINGS_V3_ROW]));

    await expect(readPromptWizardSettings()).resolves.toEqual({
      generationCredits: 1,
      available: false,
      engineVersion: 3,
      updatedAt: '2026-08-08T00:00:00.000Z',
    });
  });

  it('engine 3 即使配置被误设为 available，也在读取用户与写任务前拒绝新建 V6', async () => {
    mocks.clientQuery.mockResolvedValueOnce(queryResult([{
      ...SETTINGS_V3_ROW,
      available: true,
    }]));

    await expect(createPromptWizardRun({
      userId: 'user-1',
      imageAssetIds: ['00000000-0000-4000-8000-000000000001'],
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROMPT_WIZARD_V6_ENGINE_NOT_READY',
    });

    expect(mocks.clientQuery).toHaveBeenCalledOnce();
    expect(String(mocks.clientQuery.mock.calls[0]?.[0])).toContain('prompt_wizard_settings');
    expect(String(mocks.clientQuery.mock.calls[0]?.[0])).not.toContain('INSERT INTO');
  });

  it('engine 3 拒绝管理员打开向导，且拒绝路径没有 UPDATE 副作用', async () => {
    mocks.clientQuery.mockResolvedValueOnce(queryResult([SETTINGS_V3_ROW]));

    await expect(updatePromptWizardSettingsWithClient({
      client: { query: mocks.clientQuery } as unknown as DbClient,
      adminUserId: 'admin-1',
      available: true,
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROMPT_WIZARD_V6_ENGINE_NOT_READY',
    });

    expect(mocks.clientQuery).toHaveBeenCalledOnce();
    expect(String(mocks.clientQuery.mock.calls[0]?.[0])).toContain('FOR UPDATE');
    expect(String(mocks.clientQuery.mock.calls[0]?.[0])).not.toContain('UPDATE prompt_wizard_settings');
  });

  it('engine 3 仍允许调整积分或关闭功能，但更新 SQL 不改引擎版本', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce(queryResult([SETTINGS_V3_ROW]))
      .mockResolvedValueOnce(queryResult([{
        ...SETTINGS_V3_ROW,
        refresh_credits: 2,
        updated_at: '2026-08-08T01:00:00.000Z',
      }]));

    await expect(updatePromptWizardSettingsWithClient({
      client: { query: mocks.clientQuery } as unknown as DbClient,
      adminUserId: 'admin-1',
      generationCredits: 2,
      available: false,
    })).resolves.toMatchObject({
      generationCredits: 2,
      available: false,
      engineVersion: 3,
    });

    const updateSql = String(mocks.clientQuery.mock.calls[1]?.[0]);
    expect(updateSql).toContain('UPDATE prompt_wizard_settings');
    expect(updateSql).not.toContain('engine_version =');
  });

  it('engine 3 恢复只读历史信号，不查询 071 route_sets', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([{ engine_version: 3 }]))
      .mockResolvedValueOnce(queryResult([{
        engine_version: 3,
        status: 'ready',
        has_product_profile: true,
        has_evidence_graph: true,
        has_production_brief: true,
      }]));

    await expect(resumePromptWizard('user-1')).resolves.toMatchObject({
      run: null,
      batch: null,
      legacyTaskRetired: true,
    });

    const sql = mocks.poolQuery.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).not.toContain('prompt_wizard_route_sets');
    expect(sql).not.toContain("engine_version = 4 AND status");
  });

  it('engine 3 worker 恢复、V6 路线任务与过期清理均安全跳过且不写库', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([{ engine_version: 3 }]));

    await expect(recoverPromptWizardJobs()).resolves.toEqual(EMPTY_RECOVERY);
    await expect(processPromptWizardRouteSetV6('route-set-1')).resolves.toBeUndefined();
    await expect(purgeExpiredPromptWizardContent()).resolves.toBe(0);

    const sql = mocks.poolQuery.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).not.toContain('prompt_wizard_route_sets');
    expect(sql).not.toContain('UPDATE ');
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });
});

function queryResult<T>(rows: T[], rowCount = rows.length) {
  return { rows, rowCount };
}
