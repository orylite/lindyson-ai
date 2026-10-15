import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  requireAuth: vi.fn(),
  withTransaction: vi.fn(),
  sendSupportTicketEmail: vi.fn(),
  paginationTotal: 2,
}));

vi.mock('../src/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
  },
  withTransaction: mocks.withTransaction,
  withReadOnlyRepeatableRead: (fn: (client: { query: typeof mocks.poolQuery }) => unknown) => fn({ query: paginationQuery as typeof mocks.poolQuery }),
}));

const paginationQuery = (sql: unknown, values?: unknown[]) => {
  const text = String(sql);
  if (text.includes('user_pagination_versions')) {
    return Promise.resolve({ rows: [{ version: '0', snapshot_at: '2026-07-17T11:00:00.000Z' }], rowCount: 1 });
  }
  if (text.includes('SELECT count(*)::text AS count')) {
    return Promise.resolve({ rows: [{ count: String(mocks.paginationTotal) }], rowCount: 1 });
  }
  return mocks.poolQuery(sql, values);
};

vi.mock('../src/auth/session.js', () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock('../src/notifications/emailService.js', () => ({
  sendSupportTicketEmail: mocks.sendSupportTicketEmail,
}));

import { registerSupportRoutes } from '../src/routes/supportRoutes.js';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TICKET_ID = '22222222-2222-4222-8222-222222222222';

describe('用户端工单会话接口', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.clientQuery.mockReset();
    mocks.requireAuth.mockReset();
    mocks.withTransaction.mockReset();
    mocks.sendSupportTicketEmail.mockReset();
    mocks.paginationTotal = 2;
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', email: 'user@example.com', userName: '测试用户', role: 'user' });
    mocks.withTransaction.mockImplementation(async fn => fn({ query: mocks.clientQuery }));
  });

  it('工单轻量汇总只返回未读、未关闭数量和统计时间', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([{
      unread_tickets: '2',
      open_tickets: 3,
      as_of: '2026-07-17T01:02:03.000Z',
    }]));
    const app = makeApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/support/summary' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        unreadTickets: 2,
        openTickets: 3,
        asOf: '2026-07-17T01:02:03.000Z',
      });
      expect(mocks.poolQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM tickets ticket'),
        ['user-1'],
      );
    } finally {
      await app.close();
    }
  });

  it('创建工单时同步写入首条用户消息', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('INSERT INTO tickets')) return queryResult([{ id: TICKET_ID }]);
      if (query.includes('INSERT INTO ticket_messages')) return queryResult([]);
      if (query.includes('FROM tickets t')) return queryResult([ticketSummary()]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/support/tickets',
        payload: {
          title: '生成问题',
          message: '生成任务需要人工确认。',
          priority: 'medium',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.clientQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ticket_messages'),
        [TICKET_ID, 'user-1', '生成任务需要人工确认。'],
      );
      expect(response.json().ticket).toEqual(expect.objectContaining({
        id: TICKET_ID,
        lastMessage: '生成任务需要人工确认。',
        unreadCount: 0,
      }));
      expect(response.json().ticket).not.toHaveProperty('internalNote');
    } finally {
      await app.close();
    }
  });

  it('非本人不能读取工单消息', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([]));

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/support/tickets/${OTHER_TICKET_ID}/messages`,
      });

      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('用户消息 DTO 不暴露客服内部邮箱', async () => {
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM tickets t')) return queryResult([ticketSummary()]);
      if (query.includes('FROM ticket_messages')) {
        return queryResult([{
          id: 'message-1',
          ticket_id: TICKET_ID,
          author_role: 'admin',
          author_email: 'private-support@example.com',
          author_name: '客服',
          body: '已处理',
          created_at: '2026-07-01T10:05:00.000Z',
        }]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeApp();
    try {
      const response = await app.inject({ method: 'GET', url: `/api/support/tickets/${TICKET_ID}/messages` });
      expect(response.statusCode).toBe(200);
      expect(response.json().items[0]).toEqual(expect.objectContaining({ authorName: '客服', body: '已处理' }));
      expect(response.json().items[0]).not.toHaveProperty('authorEmail');
    } finally {
      await app.close();
    }
  });

  it('已关闭工单禁止用户继续回复', async () => {
    mocks.clientQuery.mockResolvedValueOnce(queryResult([{ id: TICKET_ID, status: 'resolved' }]));

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/support/tickets/${TICKET_ID}/messages`,
        payload: { message: '还有问题' },
      });

      expect(response.statusCode).toBe(409);
      expect(mocks.clientQuery).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('工单列表返回四向游标分页且不泄露内部备注', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      ticketSummary(),
      ticketSummary({
        id: OTHER_TICKET_ID,
        updated_at: '2026-06-30T10:00:00.000Z',
        last_message_at: '2026-06-30T10:00:00.000Z',
      }),
    ]));

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/support/tickets?limit=1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        items: [expect.objectContaining({ id: TICKET_ID })],
        pagination: {
          limit: 1,
          hasPrevious: false,
          hasNext: true,
          previousCursor: null,
          nextCursor: expect.any(String),
          currentPage: 1,
          totalPages: 2,
          totalItems: 2,
          snapshotCursor: expect.any(String),
        },
      });
      expect(response.json().items[0]).not.toHaveProperty('internalNote');
      expect(mocks.poolQuery).toHaveBeenCalledWith(
        expect.stringMatching(/t\.user_id = \$1[\s\S]*ORDER BY t\.updated_at DESC[\s\S]*LIMIT \$7/),
        ['user-1', null, null, null, null, null, 2],
      );
      const firstPageSql = String(mocks.poolQuery.mock.calls.at(-1)?.[0]);
      expect(firstPageSql).toContain('WITH paged_tickets AS MATERIALIZED');
      expect(firstPageSql).toContain('FROM paged_tickets t');
      expect(firstPageSql).toContain('LEFT JOIN LATERAL');
      expect(firstPageSql.indexOf('LIMIT $7')).toBeLessThan(firstPageSql.indexOf('FROM ticket_messages tm'));

      const cursor = response.json().pagination.nextCursor;
      mocks.poolQuery.mockResolvedValueOnce(queryResult([ticketSummary({
        id: OTHER_TICKET_ID,
        updated_at: '2026-06-30T10:00:00.000Z',
        last_message_at: '2026-06-30T10:00:00.000Z',
      })]));
      const next = await app.inject({
        method: 'GET',
        url: `/api/support/tickets?position=next&limit=1&cursor=${encodeURIComponent(cursor)}`,
      });
      expect(next.statusCode).toBe(200);
      expect(next.json().pagination).toEqual({
        limit: 1,
        hasPrevious: true,
        hasNext: false,
        previousCursor: expect.any(String),
        nextCursor: null,
        currentPage: 2,
        totalPages: 2,
        totalItems: 2,
        snapshotCursor: response.json().pagination.snapshotCursor,
      });
      expect(mocks.poolQuery.mock.calls.at(-1)?.[1]).toEqual([
        'user-1', '2026-07-01T10:00:00.000Z', TICKET_ID, null, null, null, 2,
      ]);

      mocks.poolQuery.mockClear();
      const mismatch = await app.inject({
        method: 'GET',
        url: `/api/support/tickets?position=next&limit=1&status=open&cursor=${encodeURIComponent(cursor)}`,
      });
      expect(mismatch.statusCode).toBe(400);
      expect(mismatch.json().code).toBe('INVALID_CURSOR');
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('用户工单搜索使用参数化逐列 trigram 条件', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([ticketSummary()]));
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/support/tickets?search=needle',
      });

      expect(response.statusCode).toBe(200);
      const [rawSql, values] = mocks.poolQuery.mock.calls.at(-1) ?? [];
      const sql = String(rawSql);
      expect(sql).not.toContain('concat_ws');
      expect(sql).not.toContain('needle');
      expect(sql).toContain('t.id::text ILIKE');
      expect(sql).toContain('t.title ILIKE');
      expect(sql).toContain('t.last_message ILIKE');
      expect(values).toContain('needle');
    } finally {
      await app.close();
    }
  });

  it('用户工单和发票 UUID 在数据库查询前校验', async () => {
    const app = makeApp();
    try {
      const messageResponse = await app.inject({
        method: 'GET',
        url: '/api/support/tickets/not-a-uuid/messages',
      });
      const invoiceResponse = await app.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: {
          orderId: 'not-a-uuid',
          invoiceTitle: '测试公司',
          receiveEmail: 'billing@example.com',
        },
      });
      const missingTaxIdResponse = await app.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: {
          orderId: '33333333-3333-4333-8333-333333333333',
          invoiceTitle: '测试公司',
          receiveEmail: 'billing@example.com',
        },
      });

      expect(messageResponse.statusCode).toBe(400);
      expect(invoiceResponse.statusCode).toBe(400);
      expect(missingTaxIdResponse.statusCode).toBe(400);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
      expect(mocks.clientQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('创建发票申请返回完整 camelCase 用户 DTO', async () => {
    const orderId = '33333333-3333-4333-8333-333333333333';
    const invoiceId = '44444444-4444-4444-8444-444444444444';
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM orders') && query.includes('FOR UPDATE')) {
        return queryResult([{ id: orderId, status: 'paid', invoice_status: 'unissued' }]);
      }
      if (query.includes('SELECT id FROM invoice_requests')) return queryResult([]);
      if (query.includes('INSERT INTO invoice_requests')) return queryResult([{ id: invoiceId }]);
      if (query.includes('UPDATE orders')) return queryResult([]);
      if (query.includes('INSERT INTO invoice_notification_outbox')) return queryResult([]);
      if (query.includes('FROM invoice_requests ir') && query.includes('JOIN orders')) {
        return queryResult([{
          id: invoiceId,
          order_id: orderId,
          user_id: 'user-1',
          user_name: '测试用户',
          email: 'user@example.com',
          plan_name: '专业版',
          amount: 2900,
          invoice_title: '测试公司',
          tax_id: '91310000TEST',
          receive_email: 'billing@example.com',
          status: 'unissued',
          note: '电子发票',
          requested_at: '2026-07-11T00:00:00.000Z',
          issued_at: null,
        }]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: {
          orderId,
          invoiceTitle: '测试公司',
          taxId: '91310000TEST',
          receiveEmail: 'billing@example.com',
          note: '电子发票',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().invoice).toEqual(expect.objectContaining({
        id: invoiceId,
        orderId,
        userName: '测试用户',
        email: 'user@example.com',
        planName: '专业版',
        amount: 2900,
        invoiceTitle: '测试公司',
        status: 'unissued',
      }));
      expect(mocks.clientQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO invoice_notification_outbox'),
        [
          `invoice-requested-admin:${invoiceId}`,
          invoiceId,
          JSON.stringify({
            invoiceId,
            orderId,
            userId: 'user-1',
            userName: '测试用户',
            accountEmail: 'user@example.com',
            planName: '专业版',
            amount: 2900,
            invoiceTitle: '测试公司',
            taxId: '91310000TEST',
            receiveEmail: 'billing@example.com',
            note: '电子发票',
          }),
        ],
      );
      expect(mocks.sendSupportTicketEmail).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

function makeApp() {
  const app = fastify({ logger: false });
  app.register(registerSupportRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const fastifyError = error as { statusCode?: number; message?: string; code?: string };
    return reply.code(fastifyError.statusCode ?? 400).send({
      message: fastifyError.message,
      code: fastifyError.code,
    });
  });
  return app;
}

function ticketSummary(overrides: Record<string, unknown> = {}) {
  const updatedAt = typeof overrides.updated_at === 'string'
    ? overrides.updated_at
    : '2026-07-01T10:00:00.000Z';
  return {
    id: TICKET_ID,
    user_id: 'user-1',
    title: '生成问题',
    user_name: '测试用户',
    email: 'user@example.com',
    priority: 'medium',
    status: 'open',
    assignee: 'unassigned',
    created_at: '2026-07-01T10:00:00.000Z',
    updated_at: updatedAt,
    sla_hours: 24,
    last_message: '生成任务需要人工确认。',
    internal_note: '',
    unread_count: 0,
    message_count: 1,
    last_message_author: 'user',
    last_message_at: '2026-07-01T10:00:00.000Z',
    __pagination_total_count: null,
    __pagination_cursor_timestamp: updatedAt,
    ...overrides,
  };
}

function queryResult(rows: unknown[]) {
  return {
    rowCount: rows.length,
    rows,
  };
}
