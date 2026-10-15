import { endpointContracts } from '@lindyson/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAuth } from '../auth/session.js';
import {
  createTkPromptGeneration,
  createTkPromptRun,
  readTkPromptEngineSettings,
  readTkPromptGeneration,
  readTkPromptResume,
  readTkPromptRun,
} from '../domain/tkPromptEngineService.js';
import {
  enqueueTkPromptAnalysis,
  enqueueTkPromptStrategy,
} from '../queues/tkPromptEngineQueue.js';

/**
 * TK Prompt Engine 1.0 公共边界：run 只分析事实，generation 再生成三案。
 * BullMQ 只承载实体 ID；状态、幂等、积分和最终结果均以 PostgreSQL 为准。
 */
export async function registerTkPromptEngineRoutes(app: FastifyInstance) {
  app.get('/api/ai/tk-prompt-engine/settings', async request => {
    await requireAuth(request);
    return { settings: await readTkPromptEngineSettings() };
  });

  app.post('/api/ai/tk-prompt-engine/runs', async (request, reply) => {
    const user = await requireAuth(request);
    const body = endpointContracts.tkPromptRunCreate.body.parse(request.body);
    const run = await createTkPromptRun({ userId: user.id, ...body });
    if (run.status === 'analyzing') {
      await tryEnqueueTkPromptEntity(
        request,
        'analysis',
        run.id,
        () => enqueueTkPromptAnalysis(run.id, 1),
      );
    }
    return reply.code(202).send({ run });
  });

  app.get('/api/ai/tk-prompt-engine/runs/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.tkPromptRun.params.parse(request.params);
    return { run: await readTkPromptRun(user.id, id) };
  });

  app.post('/api/ai/tk-prompt-engine/runs/:id/generations', async (request, reply) => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.tkPromptGenerationCreate.params.parse(request.params);
    const body = endpointContracts.tkPromptGenerationCreate.body.parse(request.body);
    const generation = await createTkPromptGeneration({
      userId: user.id,
      runId: id,
      ...body,
    });
    if (generation.status === 'queued') {
      await tryEnqueueTkPromptEntity(
        request,
        'strategy',
        generation.id,
        () => enqueueTkPromptStrategy(generation.id, 1),
      );
    }
    return reply.code(202).send({ generation });
  });

  app.get('/api/ai/tk-prompt-engine/generations/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.tkPromptGeneration.params.parse(request.params);
    return { generation: await readTkPromptGeneration(user.id, id) };
  });

  app.get('/api/ai/tk-prompt-engine/resume', async request => {
    const user = await requireAuth(request);
    return readTkPromptResume(user.id);
  });
}

async function tryEnqueueTkPromptEntity(
  request: FastifyRequest,
  kind: 'analysis' | 'strategy',
  entityId: string,
  enqueue: () => Promise<void>,
) {
  try {
    await enqueue();
  } catch (error) {
    // PostgreSQL 是真源；实体已落库（生成批次可能已 hold 积分）后不能将
    // Redis 短暂故障伪装成创建失败。worker 的周期 recovery 会按实体/attempt 补投。
    request.log.error({ err: error, kind, entityId }, 'TK Prompt Engine 首次队列投递失败，等待周期恢复');
  }
}
