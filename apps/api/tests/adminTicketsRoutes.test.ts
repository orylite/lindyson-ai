import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  requireAdmin: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
  },
  withTransaction: mocks.withTransaction,
}));

vi.mock('../src/auth/session.js', () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock('../src/domain/adminIdempotency.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/domain/adminIdempotency.js')>();
  return {
    ...actual,
    runAdminIdempotentAction: vi.fn(async (input: {
      execute: (client: unknown, actionId: string) => Promise<unknown>;
      successStatus?: number;
    }) => mocks.withTransaction(async (client: unknown) => ({
      response: await input.execute(client, 'idem-action-1'),
      statusCode: input.successStatus ?? 200,
      reused: false,
      actionId: 'idem-action-1',
    }))),
  };
});

vi.mock('../src/providers/volcengineBillingProvider.js', () => ({
  maybeSyncVolcengineBillingPackages: vi.fn(),
}));

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';

describe('后台工单会话接口', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.clientQuery.mockReset();
    mocks.requireAdmin.mockReset();
    mocks.withTransaction.mockReset();
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@lindyson.ai', role: 'admin' });
    mocks.withTransaction.mockImplementation(async fn => fn({ query: mocks.clientQuery }));
  });

  it('管理员回复工单时写入消息并把状态改为处理中', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT id, status, assignee')) return queryResult([{ id: '11111111-1111-4111-8111-111111111111', status: 'open', assignee: 'unassigned' }]);
      if (query.includes('INSERT INTO ticket_messages')) return queryResult([{ id: 'message-1', ticket_id: '11111111-1111-4111-8111-111111111111', author_role: 'admin', author_user_id: 'admin-1', body: '已为你处理。', created_at: '2026-07-01T10:05:00.000Z' }]);
      if (query.includes('UPDATE tickets')) return queryResult([]);
      if (query.includes('FROM tickets t')) return queryResult([ticketSummary({ status: 'pending', last_message: '已为你处理。', last_message_author: 'admin' })]);
      if (query.includes('INSERT INTO audit_logs')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });
    mocks.poolQuery.mockResolvedValue(queryResult([]));

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/tickets/11111111-1111-4111-8111-111111111111/messages',
        headers: { 'idempotency-key': 'ticket-reply-key-100' },
        payload: { message: '已为你处理。' },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.clientQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ticket_messages'),
        ['11111111-1111-4111-8111-111111111111', 'admin-1', '已为你处理。'],
      );
      expect(mocks.clientQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'pending'"),
        ['11111111-1111-4111-8111-111111111111', '已为你处理。', 'admin@lindyson.ai'],
      );
      expect(mocks.clientQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining(['admin-1', '工单管理', '回复工单']),
      );
      expect(response.json().ticket).toEqual(expect.objectContaining({
        status: 'pending',
        lastMessageAuthor: 'admin',
      }));
    } finally {
      await app.close();
    }
  });

  it('管理员标记工单已读时不引用不存在的资产删除字段', async () => {
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('UPDATE tickets')) return queryResult([{ id: '11111111-1111-4111-8111-111111111111' }]);
      if (query.includes('FROM tickets t')) return queryResult([ticketSummary()]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/tickets/11111111-1111-4111-8111-111111111111/read',
      });

      expect(response.statusCode).toBe(200);
      const updateSql = String(mocks.poolQuery.mock.calls[0]?.[0]);
      expect(updateSql).toContain('SET admin_read_at = now()');
      expect(updateSql).not.toContain('deletion_status');
    } finally {
      await app.close();
    }
  });
});

function makeApp() {
  const app = fastify({ logger: false });
  app.register(registerAdminRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const fastifyError = error as { statusCode?: number; message?: string };
    return reply.code(fastifyError.statusCode ?? 400).send({ message: fastifyError.message });
  });
  return app;
}

function ticketSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: 'user-1',
    title: '生成问题',
    user_name: '测试用户',
    email: 'user@example.com',
    priority: 'medium',
    status: 'open',
    assignee: 'admin@lindyson.ai',
    created_at: '2026-07-01T10:00:00.000Z',
    updated_at: '2026-07-01T10:05:00.000Z',
    sla_hours: 24,
    last_message: '生成任务需要人工确认。',
    internal_note: '',
    unread_count: 0,
    message_count: 2,
    last_message_author: 'user',
    last_message_at: '2026-07-01T10:05:00.000Z',
    ...overrides,
  };
}

function queryResult(rows: unknown[]) {
  return {
    rowCount: rows.length,
    rows,
  };
}
