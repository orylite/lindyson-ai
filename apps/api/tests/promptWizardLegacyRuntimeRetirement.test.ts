import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  withTransaction: vi.fn(),
  analyzeProduct: vi.fn(),
  generateConcepts: vi.fn(),
  generateDrafts: vi.fn(),
  repairDrafts: vi.fn(),
  generateUseDirections: vi.fn(),
  generateUseDirectionDrafts: vi.fn(),
  repairUseDirectionDrafts: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: mocks.withTransaction,
}));

vi.mock('../src/providers/promptWizardProvider.js', () => ({
  getPromptWizardProvider: () => ({
    analyzeProduct: mocks.analyzeProduct,
    generateConcepts: mocks.generateConcepts,
    generateDrafts: mocks.generateDrafts,
    repairDrafts: mocks.repairDrafts,
    generateUseDirections: mocks.generateUseDirections,
    generateUseDirectionDrafts: mocks.generateUseDirectionDrafts,
    repairUseDirectionDrafts: mocks.repairUseDirectionDrafts,
  }),
}));

import {
  processPromptWizardConceptSet,
  processPromptWizardPlanRefinement,
  recoverPromptWizardJobs,
} from '../src/domain/promptWizardService.js';
import { buildPromptWizardProductionBrief } from '../src/domain/promptWizardCreativePlaybook.js';
import { makePromptWizardV4Selection } from './promptWizardV4Fixtures.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const RUN_ID = '00000000-0000-4000-8000-000000000002';
const BATCH_ID = '00000000-0000-4000-8000-000000000003';
const CONCEPT_SET_ID = '00000000-0000-4000-8000-000000000004';
const REVISION_ID = '00000000-0000-4000-8000-000000000005';
const USE_DIRECTION_SET_ID = '00000000-0000-4000-8000-000000000006';
const ROUTE_SET_ID = '00000000-0000-4000-8000-000000000007';
const V5_BATCH_ID = '00000000-0000-4000-8000-000000000008';
const V5_REVISION_ID = '00000000-0000-4000-8000-000000000009';

const PROFILE = {
  productName: '折叠式头戴耳机',
  category: '头戴式耳机',
  colors: '黑色',
  materials: '哑光塑料',
  structure: '可折叠头梁',
  logo: '右侧耳罩有可见 Logo',
  usage: '佩戴于双耳',
  suggestedAudience: '通勤用户',
  suggestedScenarios: '通勤、办公与旅行',
  visibleFacts: ['黑色外观', '头梁可以折叠'],
  needsConfirmation: ['续航时长需由用户确认'],
  userConfirmedClaims: '',
  consistencyConstraints: '所有镜头保持颜色、材质和耳罩结构一致',
};

const LEGACY_BRIEF = {
  targetLanguage: '英语',
  direction: 'ugc',
  marketingGoal: 'conversion',
  creativeIntensity: 'balanced',
  confirmedOffer: '',
} as const;

const VIDEO_CONFIG = {
  model: 'seedance-2.0',
  aspectRatio: '9:16',
  resolution: '720p',
  durationSeconds: 15,
} as const;

const V4_SELECTION = makePromptWizardV4Selection({
  runId: RUN_ID,
  ordinal: 1,
  profile: PROFILE,
  brief: LEGACY_BRIEF,
  config: VIDEO_CONFIG,
});

const LEGACY_PRODUCTION_BRIEF = buildPromptWizardProductionBrief(PROFILE, {
  primaryPurchaseReason: '可折叠头梁便于取用与收纳',
  appearanceMode: 'hands-only',
  availableScenes: ['玄关', '办公桌', '通勤座位', '窗边桌面', '旅行收纳区', '书房', '客厅', '工作室'],
  availableAssets: ['产品参考图片', '手部素材'],
});

const READY_V4_RUN = {
  id: RUN_ID,
  user_id: USER_ID,
  engine_version: 3,
  status: 'ready',
  revision: 1,
  image_asset_ids: ['00000000-0000-4000-8000-000000000010'],
  product_profile: PROFILE,
  creative_brief: LEGACY_BRIEF,
  video_config: VIDEO_CONFIG,
  production_brief: LEGACY_PRODUCTION_BRIEF,
  evidence_graph: V4_SELECTION.evidenceGraph,
  failure_reason: null,
  attempt_count: 1,
  started_at: null,
  expires_at: '2099-08-05T00:00:00.000Z',
  created_at: '2026-08-05T00:00:00.000Z',
  updated_at: '2026-08-05T00:00:00.000Z',
};

describe('提示词向导旧运行时迁移边界', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.withTransaction.mockImplementation(async (
      callback: (client: { query: typeof mocks.clientQuery }) => Promise<unknown>,
    ) => callback({ query: mocks.clientQuery }));
  });

  it('滚动发布前已入队的 V4 Concept 仍由旧 worker 完成，而不是迁移时直接标失败', async () => {
    const { FakePromptWizardProvider } = await vi.importActual<
      typeof import('../src/providers/promptWizardProvider.js')
    >('../src/providers/promptWizardProvider.js');
    const legacyProvider = new FakePromptWizardProvider();
    const conceptSet = {
      id: CONCEPT_SET_ID,
      run_id: RUN_ID,
      user_id: USER_ID,
      run_revision: READY_V4_RUN.revision,
      status: 'processing',
      attempt_count: 1,
    };
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('UPDATE prompt_wizard_concept_sets') && query.includes("SET status = 'processing'")) {
        return queryResult([conceptSet]);
      }
      if (query.includes('FROM prompt_wizard_runs')) return queryResult([READY_V4_RUN]);
      if (query.includes('SELECT candidates') && query.includes('prompt_wizard_concept_sets')) {
        return queryResult([]);
      }
      if (query.includes('UPDATE prompt_wizard_concept_sets') && query.includes("SET status = 'completed'")) {
        return queryResult([], 1);
      }
      if (query.includes('UPDATE prompt_wizard_concept_sets') && query.includes("SET status = 'failed'")) {
        return queryResult([], 1);
      }
      if (query.includes('UPDATE prompt_wizard_runs')) return queryResult([], 1);
      throw new Error(`未预期的 V4 Concept worker 查询：${query}`);
    });
    mocks.generateConcepts.mockImplementation(input => legacyProvider.generateConcepts(input));

    await expect(processPromptWizardConceptSet(CONCEPT_SET_ID)).resolves.toBeUndefined();

    expect(mocks.generateConcepts).toHaveBeenCalledOnce();
    expect(mocks.generateConcepts).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({
        productName: PROFILE.productName,
        category: PROFILE.category,
      }),
      evidenceGraph: expect.objectContaining({ version: 1 }),
      historicalConcepts: [],
      costOwner: expect.objectContaining({ runId: RUN_ID, repairRound: 0 }),
    }));
    const completedCall = mocks.poolQuery.mock.calls.find(([sql]) => (
      String(sql).includes('UPDATE prompt_wizard_concept_sets')
      && String(sql).includes("SET status = 'completed'")
    ));
    expect(completedCall).toBeDefined();
    expect(JSON.parse(String(completedCall?.[1]?.[1]))).toHaveLength(8);
    expect(mocks.poolQuery.mock.calls.some(([sql]) => (
      String(sql).includes("SET status = 'failed'")
    ))).toBe(false);
  });

  it('遗留 V4/V5 精修 worker 仍读取原始批次与运行快照，不会在领取任务后立即按退役处理', async () => {
    const revision = {
      id: REVISION_ID,
      run_id: RUN_ID,
      batch_id: BATCH_ID,
      user_id: USER_ID,
      source_plan_id: '00000000-0000-4000-8000-000000000011',
      concept_id: CONCEPT_SET_ID,
      use_direction_id: null,
      plan_index: 0,
      action: 'stronger-hook',
      replacement_scene: null,
      status: 'processing',
      attempt_count: 1,
    };
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('UPDATE prompt_wizard_plan_revisions') && query.includes("SET status = 'processing'")) {
        return queryResult([revision]);
      }
      // 用缺失的历史正文模拟 24 小时窗口末端。关键断言是 worker 会真正读取
      // 两份快照并按来源失效收口，而不是因 V6 上线直接写入“只读退役”。
      if (query.includes('FROM prompt_wizard_batches')) return queryResult([]);
      if (query.includes('FROM prompt_wizard_runs')) return queryResult([]);
      if (query.includes('UPDATE prompt_wizard_plan_revisions') && query.includes("SET status = 'failed'")) {
        return queryResult([], 1);
      }
      throw new Error(`未预期的遗留精修 worker 查询：${query}`);
    });

    await expect(processPromptWizardPlanRefinement(REVISION_ID)).resolves.toBeUndefined();

    expect(mocks.poolQuery.mock.calls.some(([sql]) => (
      String(sql).includes('FROM prompt_wizard_batches')
    ))).toBe(true);
    expect(mocks.poolQuery.mock.calls.some(([sql]) => (
      String(sql).includes('FROM prompt_wizard_runs')
    ))).toBe(true);
    const failedCall = mocks.poolQuery.mock.calls.find(([sql]) => (
      String(sql).includes('UPDATE prompt_wizard_plan_revisions')
      && String(sql).includes("SET status = 'failed'")
    ));
    expect(failedCall?.[1]?.[1]).toBe('原始方案或创意路线已过期。');
    expect(failedCall?.[1]?.[1]).not.toContain('旧版提示词方案仅支持查看和应用');
    expectProviderNotCalled();
  });

  it('恢复器同时返回 V6 routeSets 与尚在 24 小时迁移窗口内的 V4/V5 队列', async () => {
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM prompt_wizard_settings')) {
        return queryResult([{ engine_version: 4 }]);
      }
      if (!query.trimStart().startsWith('SELECT')) return queryResult([], 1);
      if (query.includes('FROM prompt_wizard_runs') && !query.includes('JOIN')) {
        return queryResult([
          { id: RUN_ID, attempt_count: 1 },
          { id: '00000000-0000-4000-8000-000000000012', attempt_count: 2 },
        ]);
      }
      if (query.includes('FROM prompt_wizard_concept_sets')) {
        return queryResult([{ id: CONCEPT_SET_ID, attempt_count: 1 }]);
      }
      if (query.includes('FROM prompt_wizard_use_direction_sets')) {
        return queryResult([{ id: USE_DIRECTION_SET_ID, attempt_count: 2 }]);
      }
      if (query.includes('FROM prompt_wizard_route_sets')) {
        return queryResult([{ id: ROUTE_SET_ID, attempt_count: 3 }]);
      }
      if (query.includes('FROM prompt_wizard_batches')) {
        return queryResult([
          { id: BATCH_ID, attempt_count: 4 },
          { id: V5_BATCH_ID, attempt_count: 5 },
        ]);
      }
      if (query.includes('FROM prompt_wizard_plan_revisions')) {
        return queryResult([
          { id: REVISION_ID, attempt_count: 6 },
          { id: V5_REVISION_ID, attempt_count: 7 },
        ]);
      }
      throw new Error(`未预期的恢复查询：${query}`);
    });

    await expect(recoverPromptWizardJobs()).resolves.toEqual({
      runs: [
        { id: RUN_ID, attempt: 1 },
        { id: '00000000-0000-4000-8000-000000000012', attempt: 2 },
      ],
      conceptSets: [{ id: CONCEPT_SET_ID, attempt: 1 }],
      useDirectionSets: [{ id: USE_DIRECTION_SET_ID, attempt: 2 }],
      routeSets: [{ id: ROUTE_SET_ID, attempt: 3 }],
      batches: [
        { id: BATCH_ID, attempt: 4 },
        { id: V5_BATCH_ID, attempt: 5 },
      ],
      planRevisions: [
        { id: REVISION_ID, attempt: 6 },
        { id: V5_REVISION_ID, attempt: 7 },
      ],
    });

    const sql = mocks.poolQuery.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).toContain('UPDATE prompt_wizard_concept_sets concept_set');
    expect(sql).toContain('UPDATE prompt_wizard_plan_revisions revision');
    expect(sql).toContain('UPDATE prompt_wizard_route_sets route_set');
    expect(sql).toContain("SET status = 'queued', started_at = NULL");
    expect(sql).toContain('run.engine_version = 3');
    expect(sql).toContain('run.engine_version = 4');
    expect(sql).toContain('run.engine_version IN (3, 4)');
    expect(sql).not.toContain("SET status = 'failed'");
    expect(sql).not.toContain('failure_reason =');
    expectProviderNotCalled();
  });
});

function expectProviderNotCalled() {
  expect(mocks.analyzeProduct).not.toHaveBeenCalled();
  expect(mocks.generateConcepts).not.toHaveBeenCalled();
  expect(mocks.generateDrafts).not.toHaveBeenCalled();
  expect(mocks.repairDrafts).not.toHaveBeenCalled();
  expect(mocks.generateUseDirections).not.toHaveBeenCalled();
  expect(mocks.generateUseDirectionDrafts).not.toHaveBeenCalled();
  expect(mocks.repairUseDirectionDrafts).not.toHaveBeenCalled();
}

function queryResult<T>(rows: T[], rowCount = rows.length) {
  return { rows, rowCount };
}
