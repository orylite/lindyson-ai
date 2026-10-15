import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  requireAdmin: vi.fn(),
  withTransaction: vi.fn(),
  retryTask: vi.fn(),
  enqueueTask: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: vi.fn() },
  withTransaction: mocks.withTransaction,
}));
vi.mock('../src/auth/session.js', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('../src/domain/generationService.js', () => ({
  failTaskWithRefundWithClient: vi.fn(),
  retryGenerationTaskWithClient: mocks.retryTask,
}));
vi.mock('../src/queues/generationQueue.js', () => ({ enqueueGenerationTask: mocks.enqueueTask }));
vi.mock('../src/domain/adminIdempotency.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/domain/adminIdempotency.js')>();
  return {
    ...actual,
    runAdminIdempotentAction: vi.fn(async (input: {
      execute: (client: unknown, actionId: string) => Promise<unknown>;
      responseSchema: { parse: (value: unknown) => Record<string, unknown> };
      successStatus?: number;
    }) => mocks.withTransaction(async (client: unknown) => ({
      response: input.responseSchema.parse(await input.execute(client, 'action-1')),
      statusCode: input.successStatus ?? 200,
      reused: false,
      actionId: 'action-1',
    }))),
  };
});

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';

describe('后台生成任务 mutation 响应契约', () => {
  beforeEach(() => {
    mocks.clientQuery.mockReset();
    mocks.requireAdmin.mockReset();
    mocks.withTransaction.mockReset();
    mocks.retryTask.mockReset();
    mocks.enqueueTask.mockReset();
    mocks.requireAdmin.mockResolvedValue({ id: ADMIN_ID, email: 'admin@example.com', role: 'admin' });
    mocks.withTransaction.mockImplementation(async callback => callback({ query: mocks.clientQuery }));
    mocks.retryTask.mockResolvedValue({ id: TASK_ID, attempt: 2 });
    mocks.enqueueTask.mockResolvedValue(undefined);
  });

  it('重试接口在入幂等快照前补全 AdminGenerationTask DTO', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM generation_tasks gt') && query.includes('WHERE gt.id = $1')) {
        return result([adminJobRow()]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    const app = fastify();
    await app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/jobs/${TASK_ID}/retry`,
        headers: { 'idempotency-key': 'job-retry-key-100' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().task).toEqual(expect.objectContaining({
        id: TASK_ID,
        userId: USER_ID,
        userName: '测试用户',
        email: 'user@example.com',
        status: 'queued',
        attempt: 2,
        ledgerIds: [],
      }));
      expect(mocks.retryTask).toHaveBeenCalledWith(expect.anything(), TASK_ID, ADMIN_ID);
      expect(mocks.enqueueTask).toHaveBeenCalledWith(TASK_ID, 2, 0);
    } finally {
      await app.close();
    }
  });
});

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';

function adminJobRow() {
  return {
    id: TASK_ID,
    user_id: USER_ID,
    user_name: '测试用户',
    email: 'user@example.com',
    kind: 'video',
    model: 'Seedance 2.0',
    status: 'queued',
    attempt: 2,
    processing_stage: 'queued',
    provider_task_id: null,
    failure_category: null,
    failure_reason: null,
    settlement_error: null,
    prompt: '生成产品视频',
    config: {},
    credits: 20,
    reserved_credits: 20,
    settled_credits: 0,
    refunded_credits: 0,
    main_credits_used: 20,
    addon_credits_used: 0,
    credit_status: 'held',
    asset_id: null,
    asset_name: null,
    asset_source: null,
    retry_count: 1,
    ledger_ids: [],
    created_at: '2026-07-01T10:00:00.000Z',
    started_at: null,
    heartbeat_at: null,
    lease_expires_at: null,
    completed_at: null,
  };
}

function result(rows: unknown[]) {
  return { rows, rowCount: rows.length };
}
