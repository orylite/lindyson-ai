import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  assertPromptWizardRunAcceptsV6Requests: vi.fn(),
  createPromptWizardRun: vi.fn(),
  getPromptWizardRun: vi.fn(),
  updatePromptWizardRun: vi.fn(),
  getPromptWizardConceptSet: vi.fn(),
  getPromptWizardUseDirectionSet: vi.fn(),
  createPromptWizardBatch: vi.fn(),
  getPromptWizardBatch: vi.fn(),
  getPromptWizardPlanRevision: vi.fn(),
  resumePromptWizard: vi.fn(),
  enqueuePromptWizardAnalysis: vi.fn(),
  enqueuePromptWizardBatch: vi.fn(),
  enqueuePromptWizardUseDirectionSet: vi.fn(),
  enqueuePromptWizardPlanRefinement: vi.fn(),
  readTkPromptEngineV6WritesRetired: vi.fn(),
}));

vi.mock('../src/auth/session.js', () => ({ requireAuth: mocks.requireAuth }));

vi.mock('../src/domain/promptWizardService.js', () => ({
  assertPromptWizardRunAcceptsV6Requests: mocks.assertPromptWizardRunAcceptsV6Requests,
  createPromptWizardRun: mocks.createPromptWizardRun,
  getPromptWizardRun: mocks.getPromptWizardRun,
  updatePromptWizardRun: mocks.updatePromptWizardRun,
  getPromptWizardConceptSet: mocks.getPromptWizardConceptSet,
  getPromptWizardUseDirectionSet: mocks.getPromptWizardUseDirectionSet,
  createPromptWizardBatch: mocks.createPromptWizardBatch,
  getPromptWizardBatch: mocks.getPromptWizardBatch,
  getPromptWizardPlanRevision: mocks.getPromptWizardPlanRevision,
  resumePromptWizard: mocks.resumePromptWizard,
}));

vi.mock('../src/queues/promptWizardQueue.js', () => ({
  enqueuePromptWizardAnalysis: mocks.enqueuePromptWizardAnalysis,
  enqueuePromptWizardBatch: mocks.enqueuePromptWizardBatch,
  enqueuePromptWizardUseDirectionSet: mocks.enqueuePromptWizardUseDirectionSet,
  enqueuePromptWizardPlanRefinement: mocks.enqueuePromptWizardPlanRefinement,
}));

vi.mock('../src/domain/tkPromptEngineRepository.js', () => ({
  readTkPromptEngineV6WritesRetired: mocks.readTkPromptEngineV6WritesRetired,
}));

import { registerPromptWizardRoutes } from '../src/routes/promptWizardRoutes.js';

const ids = {
  run: '00000000-0000-4000-8000-000000000801',
  conceptSet: '00000000-0000-4000-8000-000000000802',
  useDirectionSet: '00000000-0000-4000-8000-000000000807',
  batch: '00000000-0000-4000-8000-000000000803',
  plan: '00000000-0000-4000-8000-000000000804',
  concept: '00000000-0000-4000-8000-000000000805',
  revision: '00000000-0000-4000-8000-000000000806',
};

describe('提示词向导 3.0 公开路由', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', email: 'user@example.com', role: 'user' });
    mocks.enqueuePromptWizardAnalysis.mockResolvedValue(undefined);
    mocks.enqueuePromptWizardBatch.mockResolvedValue(undefined);
    mocks.enqueuePromptWizardUseDirectionSet.mockResolvedValue(undefined);
    mocks.enqueuePromptWizardPlanRefinement.mockResolvedValue(undefined);
    mocks.assertPromptWizardRunAcceptsV6Requests.mockResolvedValue(undefined);
    mocks.readTkPromptEngineV6WritesRetired.mockResolvedValue(true);
  });

  it('TK 1.0 尚未切流时仍允许旧 V6 创建事实分析任务', async () => {
    mocks.readTkPromptEngineV6WritesRetired.mockResolvedValue(false);
    const run = { id: ids.run, status: 'analyzing' };
    mocks.createPromptWizardRun.mockResolvedValue(run);
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ai/prompt-wizard/runs',
        payload: {
          imageAssetIds: ['00000000-0000-4000-8000-000000000811'],
          referenceMode: 'general',
        },
      });

      expect(response.statusCode, response.body).toBe(202);
      expect(response.json()).toEqual({ run });
      expect(mocks.createPromptWizardRun).toHaveBeenCalledWith({
        userId: 'user-1',
        imageAssetIds: ['00000000-0000-4000-8000-000000000811'],
      });
      expect(mocks.enqueuePromptWizardAnalysis).toHaveBeenCalledWith(ids.run);
    } finally {
      await app.close();
    }
  });

  it('TK 1.0 回滚关闭后仍依据永久墓碑在解析请求体前返回 410', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/ai/prompt-wizard/runs/${ids.run}/batches`,
        // 模拟仍未提交 Concept Set 的 2.0 旧页面载荷。
        payload: {
          idempotencyKey: 'legacy-batch-create-1',
          revision: 3,
          expectedGenerationCredits: 0,
        },
      });

      expect(response.statusCode).toBe(410);
      expect(response.json()).toMatchObject({
        message: '旧版提示词生成已退役，请使用 TK Prompt Engine 1.0。',
        code: 'PROMPT_WIZARD_WRITE_RETIRED',
        requestId: expect.any(String),
      });
      expect(mocks.assertPromptWizardRunAcceptsV6Requests).not.toHaveBeenCalled();
      expect(mocks.createPromptWizardBatch).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('旧 Concept 创建接口固定返回 410，且不会进入服务或队列', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/ai/prompt-wizard/runs/${ids.run}/concept-sets`,
        payload: { idempotencyKey: 'concept-set-create-1', revision: 3 },
      });

      expect(response.statusCode).toBe(410);
      expect(response.json()).toMatchObject({
        code: 'PROMPT_WIZARD_WRITE_RETIRED',
      });
      expect(mocks.enqueuePromptWizardUseDirectionSet).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('旧使用方向写接口固定返回 410，且不会进入服务或队列', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/ai/prompt-wizard/runs/${ids.run}/use-direction-sets`,
        payload: { idempotencyKey: 'use-direction-set-create-1', revision: 3 },
      });

      expect(response.statusCode).toBe(410);
      expect(response.json()).toMatchObject({
        code: 'PROMPT_WIZARD_WRITE_RETIRED',
      });
      expect(mocks.enqueuePromptWizardUseDirectionSet).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('旧使用方向写接口不再解析请求体', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/ai/prompt-wizard/runs/${ids.run}/use-direction-sets`,
        payload: { idempotencyKey: 'use-direction-set-create-2', revision: -1 },
      });

      expect(response.statusCode).toBe(410);
      expect(response.json()).toMatchObject({
        code: 'PROMPT_WIZARD_WRITE_RETIRED',
      });
      expect(mocks.enqueuePromptWizardUseDirectionSet).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('读取使用方向集合时使用当前用户归属', async () => {
    const useDirectionSet = queuedUseDirectionSet();
    mocks.getPromptWizardUseDirectionSet.mockResolvedValue(useDirectionSet);
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/ai/prompt-wizard/use-direction-sets/${ids.useDirectionSet}`,
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({ useDirectionSet });
      expect(mocks.getPromptWizardUseDirectionSet).toHaveBeenCalledWith(
        'user-1',
        ids.useDirectionSet,
      );
    } finally {
      await app.close();
    }
  });

  it('读取创意集合时使用当前用户归属', async () => {
    const conceptSet = queuedConceptSet();
    mocks.getPromptWizardConceptSet.mockResolvedValue(conceptSet);
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/ai/prompt-wizard/concept-sets/${ids.conceptSet}`,
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({ conceptSet });
      expect(mocks.getPromptWizardConceptSet).toHaveBeenCalledWith('user-1', ids.conceptSet);
    } finally {
      await app.close();
    }
  });

  it('读取其他用户创意集合时保留服务层 404 边界', async () => {
    mocks.getPromptWizardConceptSet.mockRejectedValue(Object.assign(new Error('创意路线不存在'), {
      statusCode: 404,
      code: 'PROMPT_WIZARD_CONCEPT_SET_NOT_FOUND',
    }));
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/ai/prompt-wizard/concept-sets/${ids.conceptSet}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'PROMPT_WIZARD_CONCEPT_SET_NOT_FOUND' });
    } finally {
      await app.close();
    }
  });

  it('旧单方案精修写接口固定返回 410，且不会进入服务或队列', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/ai/prompt-wizard/batches/${ids.batch}/plans/${ids.plan}/refinements`,
        payload: {
          idempotencyKey: 'plan-refinement-1',
          action: 'change-scene',
          replacementScene: '靠窗的真实家庭厨房',
        },
      });

      expect(response.statusCode).toBe(410);
      expect(response.json()).toMatchObject({
        code: 'PROMPT_WIZARD_WRITE_RETIRED',
      });
      expect(mocks.enqueuePromptWizardPlanRefinement).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('旧单方案精修写接口不再解析请求体', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/ai/prompt-wizard/batches/${ids.batch}/plans/${ids.plan}/refinements`,
        payload: { idempotencyKey: 'plan-refinement-2', action: 'change-scene' },
      });

      expect(response.statusCode).toBe(410);
      expect(response.json()).toMatchObject({
        code: 'PROMPT_WIZARD_WRITE_RETIRED',
      });
      expect(mocks.enqueuePromptWizardPlanRefinement).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('恢复端点返回最近 24 小时可恢复状态', async () => {
    const resumable = {
      run: null,
      conceptSet: null,
      useDirectionSet: queuedUseDirectionSet(),
      batch: null,
      planRevision: queuedRevision('stronger-hook'),
    };
    mocks.resumePromptWizard.mockResolvedValue(resumable);
    const app = makeApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/ai/prompt-wizard/resume' });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual(resumable);
      expect(mocks.resumePromptWizard).toHaveBeenCalledWith('user-1');
    } finally {
      await app.close();
    }
  });

  it('恢复端点拒绝无效登录会话且不读取任务', async () => {
    mocks.requireAuth.mockRejectedValue(Object.assign(new Error('登录状态已失效'), {
      statusCode: 401,
      code: 'AUTH_SESSION_INVALID',
    }));
    const app = makeApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/ai/prompt-wizard/resume' });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'AUTH_SESSION_INVALID' });
      expect(mocks.resumePromptWizard).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

function queuedConceptSet() {
  return {
    id: ids.conceptSet,
    runId: ids.run,
    status: 'queued',
    runRevision: 3,
    candidates: [],
    recommendedConceptIds: [],
    failureReason: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    completedAt: null,
  };
}

function queuedUseDirectionSet() {
  return {
    id: ids.useDirectionSet,
    runId: ids.run,
    status: 'queued',
    runRevision: 3,
    directions: [],
    clarificationQuestion: null,
    clarificationCount: 0,
    failureReason: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    completedAt: null,
  };
}

function queuedRevision(action: 'change-scene' | 'stronger-hook') {
  return {
    id: ids.revision,
    batchId: ids.batch,
    sourcePlanId: ids.plan,
    conceptId: ids.concept,
    planIndex: 0,
    action,
    status: 'queued',
    isFree: true,
    plan: null,
    failureReason: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    completedAt: null,
  };
}

function makeApp() {
  const app = fastify({ logger: false });
  app.register(registerPromptWizardRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const value = error as { statusCode?: number; message?: string; code?: string; name?: string };
    const statusCode = typeof value.statusCode === 'number'
      ? value.statusCode
      : value.name === 'ZodError' ? 400 : 500;
    return reply.code(statusCode).send({ message: value.message, code: value.code });
  });
  return app;
}
