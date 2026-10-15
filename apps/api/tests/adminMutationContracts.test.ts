import fastify from 'fastify';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  requireAdmin: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: vi.fn() },
  withTransaction: mocks.withTransaction,
}));
vi.mock('../src/auth/session.js', () => ({ requireAdmin: mocks.requireAdmin }));
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

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';

describe('后台 mutation 完整响应契约', () => {
  beforeEach(() => {
    mocks.clientQuery.mockReset();
    mocks.requireAdmin.mockReset();
    mocks.withTransaction.mockReset();
    mocks.requireAdmin.mockResolvedValue({ id: ADMIN_ID, email: 'admin@example.com', role: 'admin' });
    mocks.withTransaction.mockImplementation(async callback => callback({ query: mocks.clientQuery }));
  });

  it('修改用户状态返回完整 AdminUser DTO', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT email, status FROM users')) {
        return result([{ email: 'user@example.com', status: 'active' }]);
      }
      if (query.includes('UPDATE users')) return result([{ id: USER_ID, email: 'user@example.com', status: 'frozen' }]);
      if (query.includes('INSERT INTO audit_logs')) return result([]);
      if (query.includes('FROM users u') && query.includes('LEFT JOIN plans')) {
        return result([adminUserRow({ status: 'frozen' })]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    const app = fastify();
    await app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${USER_ID}/status`,
        headers: { 'idempotency-key': 'user-status-key-100' },
        payload: { status: 'frozen' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().user).toEqual(expect.objectContaining({
        id: USER_ID,
        userName: '测试用户',
        email: 'user@example.com',
        status: 'frozen',
        planName: '专业版',
        mainCredits: 100,
        orderCount: 1,
      }));
    } finally {
      await app.close();
    }
  });

  it('更新发票状态返回 camelCase 完整 Invoice DTO', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT order_id, status FROM invoice_requests')) {
        return result([{ order_id: ORDER_ID, status: 'unissued' }]);
      }
      if (query.includes('UPDATE invoice_requests')) {
        return result([{ id: INVOICE_ID, order_id: ORDER_ID, user_id: USER_ID, receive_email: 'billing@example.com', status: 'issued' }]);
      }
      if (query.includes('UPDATE orders')) return result([]);
      if (query.includes('INSERT INTO audit_logs')) return result([]);
      if (query.includes('FROM invoice_requests ir') && query.includes('JOIN orders')) return result([invoiceRow()]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = fastify();
    await app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/invoices/${INVOICE_ID}/status`,
        headers: { 'idempotency-key': 'invoice-status-key-100' },
        payload: { status: 'issued' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().invoice).toEqual(expect.objectContaining({
        id: INVOICE_ID,
        orderId: ORDER_ID,
        userId: USER_ID,
        userName: '测试用户',
        planName: '专业版',
        invoiceTitle: '测试公司',
        status: 'issued',
      }));
    } finally {
      await app.close();
    }
  });

  it('重复确认已开票不更新时间、不写审计且保留首次 issuedAt', async () => {
    const firstIssuedAt = '2026-07-11T01:00:00.000Z';
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT order_id, status FROM invoice_requests')) {
        return result([{ order_id: ORDER_ID, status: 'issued' }]);
      }
      if (query.includes('FROM invoice_requests ir') && query.includes('JOIN orders')) {
        return result([invoiceRow({ issued_at: firstIssuedAt })]);
      }
      if (query.includes('UPDATE invoice_requests') || query.includes('UPDATE orders') || query.includes('INSERT INTO audit_logs')) {
        throw new Error(`重复确认不应产生写操作：${query}`);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    const app = fastify();
    await app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/invoices/${INVOICE_ID}/status`,
        headers: { 'idempotency-key': 'invoice-issued-noop-100' },
        payload: { status: 'issued' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().invoice.issuedAt).toBe(firstIssuedAt);
      expect(mocks.clientQuery.mock.calls.some(([sql]) => (
        String(sql).includes('UPDATE invoice_requests')
        || String(sql).includes('UPDATE orders')
        || String(sql).includes('INSERT INTO audit_logs')
      ))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('恢复未开票时保留首次人工确认时间且不发送任何邮件副作用', async () => {
    const firstIssuedAt = '2026-07-11T01:00:00.000Z';
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT order_id, status FROM invoice_requests')) {
        return result([{ order_id: ORDER_ID, status: 'issued' }]);
      }
      if (query.includes('UPDATE invoice_requests')) {
        expect(query).toContain("ELSE issued_at END");
        expect(query).not.toContain('ELSE NULL END');
        return result([]);
      }
      if (query.includes('UPDATE orders') || query.includes('INSERT INTO audit_logs')) return result([]);
      if (query.includes('FROM invoice_requests ir') && query.includes('JOIN orders')) {
        return result([invoiceRow({ status: 'unissued', issued_at: firstIssuedAt })]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    const app = fastify();
    await app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/invoices/${INVOICE_ID}/status`,
        headers: { 'idempotency-key': 'invoice-restore-key-100' },
        payload: { status: 'unissued' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().invoice).toMatchObject({ status: 'unissued', issuedAt: firstIssuedAt });
      expect(mocks.clientQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO audit_logs'))).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const INVOICE_ID = '33333333-3333-4333-8333-333333333333';

function adminUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: 'user@example.com',
    user_name: '测试用户',
    role: 'user',
    status: 'active',
    plan_id: '44444444-4444-4444-8444-444444444444',
    plan_code: 'pro',
    plan_name: '专业版',
    billing_cycle: 'monthly',
    main_credits: 100,
    addon_credits: 20,
    total_credits: 120,
    order_count: 1,
    ticket_count: 2,
    api_calls: 3,
    plan_cycle_started_at: '2026-07-01',
    plan_reset_at: '2026-08-01',
    plan_expires_at: '2027-07-01',
    active_subscription_order_id: null,
    registered_at: '2026-01-01T00:00:00.000Z',
    last_active_at: '2026-07-11T00:00:00.000Z',
    ...overrides,
  };
}

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    order_id: ORDER_ID,
    user_id: USER_ID,
    user_name: '测试用户',
    email: 'user@example.com',
    plan_name: '专业版',
    amount: 2900,
    invoice_title: '测试公司',
    tax_id: '91310000TEST',
    receive_email: 'billing@example.com',
    status: 'issued',
    note: '测试开票',
    requested_at: '2026-07-11T00:00:00.000Z',
    issued_at: '2026-07-11T01:00:00.000Z',
    ...overrides,
  };
}

function result(rows: unknown[]) {
  return { rowCount: rows.length, rows };
}
