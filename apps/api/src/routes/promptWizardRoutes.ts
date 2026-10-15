import type { FastifyInstance } from 'fastify';
import { endpointContracts } from '@lindyson/api-contracts';
import { requireAuth } from '../auth/session.js';
import {
  assertPromptWizardRunAcceptsV6Requests,
  createPromptWizardBatch,
  createPromptWizardRun,
  getPromptWizardBatch,
  getPromptWizardConceptSet,
  getPromptWizardUseDirectionSet,
  getPromptWizardPlanRevision,
  getPromptWizardRun,
  resumePromptWizard,
  updatePromptWizardRun,
} from '../domain/promptWizardService.js';
import { readTkPromptEngineV6WritesRetired } from '../domain/tkPromptEngineRepository.js';
import {
  enqueuePromptWizardAnalysis,
  enqueuePromptWizardBatch,
} from '../queues/promptWizardQueue.js';

export async function registerPromptWizardRoutes(app: FastifyInstance) {
  // 滚动发布期间墓碑为空，旧 V6 写链仍可用；TK 1.0 首次切流后墓碑永久保留，
  // 即使回滚关闭新引擎，旧写请求也继续在 Schema 解析前稳定返回 410。
  app.addHook('onRequest', async (request, reply) => {
    if (!['POST', 'PATCH'].includes(request.method)) return;
    if (!request.url.startsWith('/api/ai/prompt-wizard/')) return;
    if (!await readTkPromptEngineV6WritesRetired()) return;
    await requireAuth(request);
    return reply.code(410).send({
      message: '旧版提示词生成已退役，请使用 TK Prompt Engine 1.0。',
      code: 'PROMPT_WIZARD_WRITE_RETIRED',
      requestId: request.id,
    });
  });

  app.post('/api/ai/prompt-wizard/runs', async (request, reply) => {
    const user = await requireAuth(request);
    const payload = endpointContracts.promptWizardRunCreate.body.parse(request.body);
    const run = await createPromptWizardRun({
      userId: user.id,
      imageAssetIds: payload.imageAssetIds,
    });
    await tryEnqueue(
      () => enqueuePromptWizardAnalysis(run.id),
      '产品识别任务已写入数据库，但暂未进入 Redis 队列。worker 启动后会恢复。',
    );
    return reply.code(202).send({ run });
  });

  app.get('/api/ai/prompt-wizard/runs/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.promptWizardRun.params.parse(request.params);
    return { run: await getPromptWizardRun(user.id, id) };
  });

  app.patch('/api/ai/prompt-wizard/runs/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.promptWizardRunUpdate.params.parse(request.params);
    const payload = endpointContracts.promptWizardRunUpdate.body.parse(request.body);
    return {
      run: await updatePromptWizardRun({
        userId: user.id,
        runId: id,
        revision: payload.revision,
        productProfile: payload.productProfile,
      }),
    };
  });

  app.post('/api/ai/prompt-wizard/runs/:id/concept-sets', async request => {
    await requireAuth(request);
    throw Object.assign(new Error('提示词流程已升级，请按新版流程重新识别并生成三个方向。'), {
      statusCode: 410,
      code: 'PROMPT_WIZARD_CONCEPT_FLOW_RETIRED',
    });
  });

  app.post('/api/ai/prompt-wizard/runs/:id/use-direction-sets', async request => {
    await requireAuth(request);
    throw Object.assign(new Error('提示词流程已升级，请按新版流程重新识别并生成三个方向。'), {
      statusCode: 410,
      code: 'PROMPT_WIZARD_USE_DIRECTION_FLOW_RETIRED',
    });
  });

  app.get('/api/ai/prompt-wizard/use-direction-sets/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.promptWizardUseDirectionSet.params.parse(request.params);
    return { useDirectionSet: await getPromptWizardUseDirectionSet(user.id, id) };
  });

  app.get('/api/ai/prompt-wizard/concept-sets/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.promptWizardConceptSet.params.parse(request.params);
    return { conceptSet: await getPromptWizardConceptSet(user.id, id) };
  });

  app.post('/api/ai/prompt-wizard/runs/:id/batches', async (request, reply) => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.promptWizardBatchCreate.params.parse(request.params);
    await assertPromptWizardRunAcceptsV6Requests(user.id, id);
    const payload = endpointContracts.promptWizardBatchCreate.body.parse(request.body);
    const batch = await createPromptWizardBatch({
      userId: user.id,
      runId: id,
      revision: payload.revision,
      idempotencyKey: payload.idempotencyKey,
      expectedGenerationCredits: payload.expectedGenerationCredits,
      ...(payload.voiceoverLanguage !== undefined
        ? { voiceoverLanguage: payload.voiceoverLanguage }
        : {}),
      ...(payload.verifiedOffer ? { verifiedOffer: payload.verifiedOffer } : {}),
      videoConfig: payload.videoConfig,
    });
    if (batch.status === 'queued') {
      await tryEnqueue(
        () => enqueuePromptWizardBatch(batch.id),
        '提示词方案批次已写入数据库，但暂未进入 Redis 队列。worker 启动后会恢复。',
      );
    }
    return reply.code(202).send({ batch });
  });

  app.get('/api/ai/prompt-wizard/batches/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.promptWizardBatch.params.parse(request.params);
    return { batch: await getPromptWizardBatch(user.id, id) };
  });

  app.post(
    '/api/ai/prompt-wizard/batches/:batchId/plans/:planId/refinements',
    async request => {
      await requireAuth(request);
      throw Object.assign(new Error('单方案精修已退役，请使用“换一批”。'), {
        statusCode: 410,
        code: 'PROMPT_WIZARD_PLAN_REFINEMENT_RETIRED',
      });
    },
  );

  app.get('/api/ai/prompt-wizard/plan-revisions/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.promptWizardPlanRevision.params.parse(request.params);
    return { revision: await getPromptWizardPlanRevision(user.id, id) };
  });

  app.get('/api/ai/prompt-wizard/resume', async request => {
    const user = await requireAuth(request);
    return resumePromptWizard(user.id);
  });
}

async function tryEnqueue(run: () => Promise<void>, message: string) {
  try {
    await run();
  } catch (error) {
    console.error(message, error);
  }
}
