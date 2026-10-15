import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  readSettings: vi.fn(),
  createRun: vi.fn(),
  readRun: vi.fn(),
  createGeneration: vi.fn(),
  readGeneration: vi.fn(),
  readResume: vi.fn(),
  enqueueAnalysis: vi.fn(),
  enqueueStrategy: vi.fn(),
}));

vi.mock('../src/auth/session.js', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('../src/domain/tkPromptEngineService.js', () => ({
  readTkPromptEngineSettings: mocks.readSettings,
  createTkPromptRun: mocks.createRun,
  readTkPromptRun: mocks.readRun,
  createTkPromptGeneration: mocks.createGeneration,
  readTkPromptGeneration: mocks.readGeneration,
  readTkPromptResume: mocks.readResume,
}));
vi.mock('../src/queues/tkPromptEngineQueue.js', () => ({
  enqueueTkPromptAnalysis: mocks.enqueueAnalysis,
  enqueueTkPromptStrategy: mocks.enqueueStrategy,
}));

import { registerTkPromptEngineRoutes } from '../src/routes/tkPromptEngineRoutes.js';

const userId = '00000000-0000-4000-8000-000000000901';
const runId = '00000000-0000-4000-8000-000000000902';
const generationId = '00000000-0000-4000-8000-000000000903';
const imageId = '00000000-0000-4000-8000-000000000904';
const now = '2026-08-17T00:00:00.000Z';

describe('TK Prompt Engine 1.0 路由状态机边界', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: userId, email: 'member@example.com', role: 'user' });
    mocks.enqueueAnalysis.mockResolvedValue(undefined);
    mocks.enqueueStrategy.mockResolvedValue(undefined);
    mocks.readSettings.mockResolvedValue({
      schemaVersion: 1,
      generationCredits: 7,
      available: true,
      updatedAt: now,
    });
    mocks.createRun.mockResolvedValue(run());
    mocks.readRun.mockResolvedValue(run());
    mocks.createGeneration.mockResolvedValue(generation());
    mocks.readGeneration.mockResolvedValue(generation());
    mocks.readResume.mockResolvedValue({ run: run(), generation: generation() });
  });

  it('POST /runs 只创建事实分析 run，并以实体 ID 投递 analysis job', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ai/tk-prompt-engine/runs',
        payload: { idempotencyKey: 'analysis-0001', imageAssetIds: [imageId] },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ run: run() });
      expect(mocks.createRun).toHaveBeenCalledWith({
        userId,
        idempotencyKey: 'analysis-0001',
        imageAssetIds: [imageId],
      });
      expect(mocks.enqueueAnalysis).toHaveBeenCalledWith(runId, 1);
      expect(mocks.createGeneration).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('POST /runs/:id/generations 创建整批并只投递 strategy job', async () => {
    const app = makeApp();
    const payload = {
      idempotencyKey: 'generation-0001',
      expectedGenerationCredits: 7,
      evidenceReview: {
        productName: '参考商品',
        category: '家居用品',
        rejectedVisibleFactIds: [],
        userConfirmedFacts: [],
        forbiddenClaims: [],
      },
      creativeInput: {
        targetMarket: 'United States',
        targetAudience: 'Pet owners',
        spokenLanguage: '英语',
        verifiedOffer: '',
        appearance: { mode: 'auto' },
        availableScenes: [],
        availableAssets: ['产品参考图片1'],
      },
      videoConfig: {
        model: 'seedance-2.0',
        aspectRatio: '9:16',
        resolution: '480p',
        durationSeconds: 10,
      },
    };
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/ai/tk-prompt-engine/runs/${runId}/generations`,
        payload,
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ generation: generation() });
      expect(mocks.createGeneration).toHaveBeenCalledWith({ userId, runId, ...payload });
      expect(mocks.enqueueStrategy).toHaveBeenCalledWith(generationId, 1);
    } finally {
      await app.close();
    }
  });

  it('Redis 首次投递失败不把已落库 run/已 hold 批次伪装成 HTTP 500', async () => {
    const app = makeApp();
    mocks.enqueueAnalysis.mockRejectedValueOnce(new Error('redis unavailable'));
    const paidGeneration = {
      ...generation(),
      isFree: false,
      credits: 7,
      creditStatus: 'held',
    };
    mocks.createGeneration.mockResolvedValueOnce(paidGeneration);
    mocks.enqueueStrategy.mockRejectedValueOnce(new Error('redis unavailable'));
    try {
      const runResponse = await app.inject({
        method: 'POST',
        url: '/api/ai/tk-prompt-engine/runs',
        payload: { idempotencyKey: 'analysis-enqueue-failure', imageAssetIds: [imageId] },
      });
      expect(runResponse.statusCode).toBe(202);
      expect(runResponse.json()).toEqual({ run: run() });

      const generationResponse = await app.inject({
        method: 'POST',
        url: `/api/ai/tk-prompt-engine/runs/${runId}/generations`,
        payload: generationCreatePayload('generation-enqueue-failure'),
      });
      expect(generationResponse.statusCode).toBe(202);
      expect(generationResponse.json()).toEqual({ generation: paidGeneration });
      expect(mocks.enqueueAnalysis).toHaveBeenCalledWith(runId, 1);
      expect(mocks.enqueueStrategy).toHaveBeenCalledWith(generationId, 1);
    } finally {
      await app.close();
    }
  });

  it('settings、generation 与 resume 均按冻结公共路径读取', async () => {
    const app = makeApp();
    try {
      const [settings, generationResponse, resume] = await Promise.all([
        app.inject({ method: 'GET', url: '/api/ai/tk-prompt-engine/settings' }),
        app.inject({ method: 'GET', url: `/api/ai/tk-prompt-engine/generations/${generationId}` }),
        app.inject({ method: 'GET', url: '/api/ai/tk-prompt-engine/resume' }),
      ]);
      expect(settings.statusCode).toBe(200);
      expect(settings.json()).toHaveProperty('settings.generationCredits', 7);
      expect(generationResponse.json()).toEqual({ generation: generation() });
      expect(resume.json()).toEqual({ run: run(), generation: generation() });
      expect(mocks.readGeneration).toHaveBeenCalledWith(userId, generationId);
      expect(mocks.readResume).toHaveBeenCalledWith(userId);
    } finally {
      await app.close();
    }
  });
});

function run() {
  return {
    id: runId,
    schemaVersion: 1,
    status: 'analyzing',
    imageAssetIds: [imageId],
    evidenceProfile: null,
    failureReason: null,
    createdAt: now,
    completedAt: null,
  };
}

function generation() {
  return {
    id: generationId,
    runId,
    schemaVersion: 1,
    status: 'queued',
    evidenceReview: generationCreatePayload('resume-snapshot').evidenceReview,
    creativeInput: generationCreatePayload('resume-snapshot').creativeInput,
    videoConfig: generationCreatePayload('resume-snapshot').videoConfig,
    isFree: true,
    credits: 0,
    creditStatus: 'none',
    strategySet: [],
    options: [],
    failureReason: null,
    createdAt: now,
    completedAt: null,
  };
}

function generationCreatePayload(idempotencyKey: string) {
  return {
    idempotencyKey,
    expectedGenerationCredits: 7,
    evidenceReview: {
      productName: '参考商品',
      category: '家居用品',
      rejectedVisibleFactIds: [],
      userConfirmedFacts: [],
      forbiddenClaims: [],
    },
    creativeInput: {
      targetMarket: 'United States',
      targetAudience: 'Pet owners',
      spokenLanguage: '英语',
      verifiedOffer: '',
      appearance: { mode: 'auto' },
      availableScenes: [],
      availableAssets: ['产品参考图片1'],
    },
    videoConfig: {
      model: 'seedance-2.0',
      aspectRatio: '9:16',
      resolution: '480p',
      durationSeconds: 10,
    },
  };
}

function makeApp() {
  const app = fastify({ logger: false });
  app.register(registerTkPromptEngineRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const value = error as { statusCode?: number; name?: string; message?: string; code?: string };
    return reply.code(value.statusCode ?? (value.name === 'ZodError' ? 400 : 500)).send({
      message: value.message,
      code: value.code,
    });
  });
  return app;
}
