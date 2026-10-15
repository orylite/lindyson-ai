import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdminActionRequestHash } from '../src/domain/adminIdempotency.js';
import { setApiErrorHandler } from '../src/app.js';

const mocks = vi.hoisted(() => ({
  adjustCreditLotsWithClient: vi.fn(),
  replaceSubscriptionMainLotWithClient: vi.fn(),
  setUserAvailableCreditsWithClient: vi.fn(),
  clientQuery: vi.fn(),
  requireAdmin: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: vi.fn() },
  withTransaction: mocks.withTransaction,
}));

vi.mock('../src/auth/session.js', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('../src/domain/financialCredits.js', () => ({
  adjustCreditLotsWithClient: mocks.adjustCreditLotsWithClient,
  replaceSubscriptionMainLotWithClient: mocks.replaceSubscriptionMainLotWithClient,
  setUserAvailableCreditsWithClient: mocks.setUserAvailableCreditsWithClient,
}));

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';

describe('后台积分调整', () => {
  beforeEach(() => {
    mocks.clientQuery.mockReset();
    mocks.requireAdmin.mockReset();
    mocks.withTransaction.mockReset();
    mocks.adjustCreditLotsWithClient.mockReset();
    mocks.adjustCreditLotsWithClient.mockResolvedValue(undefined);
    mocks.setUserAvailableCreditsWithClient.mockReset();
    mocks.setUserAvailableCreditsWithClient.mockResolvedValue({
      mainCredits: 110,
      addonCredits: 35,
      balance: 145,
    });
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', role: 'admin' });
    mocks.withTransaction.mockImplementation(async callback => callback({ query: mocks.clientQuery }));
  });

  it('分别记录主积分与加购积分，并在同一事务写审计和幂等响应', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown, values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('pg_advisory_xact_lock')) return result([]);
      if (query.includes('FROM admin_action_idempotency') && query.includes('FOR UPDATE')) return result([]);
      if (query.includes('INSERT INTO admin_action_idempotency')) return result([{ id: 'idem-1' }]);
      if (query.includes('SELECT main_credits')) return result([{ main_credits: 100, addon_credits: 40, total_credits: 140, plan_reset_at: '2026-08-01' }]);
      if (query.includes('UPDATE users')) {
        expect(values).toEqual(['11111111-1111-4111-8111-111111111111', 110, 35, 145]);
        return result([]);
      }
      if (query.includes('INSERT INTO credit_ledger')) {
        const bucket = values?.[1];
        return result([{
          id: bucket === 'main' ? LEDGER_MAIN_ID : LEDGER_ADDON_ID,
          user_id: '11111111-1111-4111-8111-111111111111',
          type: 'adjust',
          bucket,
          settlement_status: 'settled',
          amount: values?.[2],
          balance: values?.[3],
          source: '后台人工调整',
          operator: 'admin@example.com',
          note: values?.[5],
          related_order_id: null,
          related_job_id: null,
          related_asset_id: null,
          created_at: '2026-07-11T00:00:00.000Z',
        }]);
      }
      if (query.includes('INSERT INTO audit_logs')) return result([]);
      if (query.includes('FROM users u') && query.includes('LEFT JOIN plans')) {
        return result([adminUserRow({ main_credits: 110, addon_credits: 35, total_credits: 145 })]);
      }
      if (query.includes('UPDATE admin_action_idempotency')) return result([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = fastify();
    await app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/credits/adjust',
        headers: { 'idempotency-key': 'credit-adjustment-100' },
        payload: {
          userId: '11111111-1111-4111-8111-111111111111',
          mainDelta: 10,
          addonDelta: -5,
          note: '修正测试积分',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(expect.objectContaining({
        entries: [
          expect.objectContaining({
            userId: '11111111-1111-4111-8111-111111111111',
            userName: '测试用户',
            email: 'user@example.com',
            type: 'adjust',
            bucket: 'main',
            settlementStatus: 'settled',
            amount: 10,
            balance: 150,
            note: '账户积分已补发。',
            createdAt: '2026-07-11T00:00:00.000Z',
          }),
          expect.objectContaining({
            bucket: 'addon',
            amount: -5,
            balance: 145,
            note: '账户积分已由管理员调整。',
          }),
        ],
        user: expect.objectContaining({
          id: '11111111-1111-4111-8111-111111111111',
          mainCredits: 110,
          addonCredits: 35,
          credits: 145,
          totalCredits: 145,
        }),
      }));
      expect(mocks.adjustCreditLotsWithClient).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ query: mocks.clientQuery }),
        expect.objectContaining({ bucket: 'main', delta: 10 }),
      );
      expect(mocks.setUserAvailableCreditsWithClient).toHaveBeenCalledWith(
        expect.objectContaining({ query: mocks.clientQuery }),
        '11111111-1111-4111-8111-111111111111',
      );
      expect(mocks.adjustCreditLotsWithClient).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ query: mocks.clientQuery }),
        expect.objectContaining({ bucket: 'addon', delta: -5 }),
      );
      expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'), expect.any(Array));
      const auditCall = mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO audit_logs'));
      expect(auditCall?.[1]).toEqual(expect.arrayContaining(['修正测试积分']));
      expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE admin_action_idempotency'), expect.any(Array));
    } finally {
      await app.close();
    }
  });

  it('重复幂等键直接返回原响应', async () => {
    const previous = {
      entry: {
        id: LEDGER_MAIN_ID,
        userId: '11111111-1111-4111-8111-111111111111',
        userName: '测试用户',
        email: 'user@example.com',
        type: 'adjust',
        bucket: 'main',
        settlementStatus: 'settled',
        amount: 10,
        balance: 150,
        source: '后台人工调整',
        operator: 'admin@example.com',
        note: '修正测试积分',
        relatedOrderId: null,
        relatedJobId: null,
        relatedAssetId: null,
        createdAt: '2026-07-11T00:00:00.000Z',
      },
      entries: [{
        id: LEDGER_MAIN_ID,
        userId: '11111111-1111-4111-8111-111111111111',
        userName: '测试用户',
        email: 'user@example.com',
        type: 'adjust',
        bucket: 'main',
        settlementStatus: 'settled',
        amount: 10,
        balance: 150,
        source: '后台人工调整',
        operator: 'admin@example.com',
        note: '修正测试积分',
        relatedOrderId: null,
        relatedJobId: null,
        relatedAssetId: null,
        createdAt: '2026-07-11T00:00:00.000Z',
      }],
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'user@example.com',
        userName: '测试用户',
        role: 'user',
        status: 'active',
        planId: '33333333-3333-4333-8333-333333333333',
        planCode: 'pro',
        planName: '专业版',
        billingCycle: 'monthly',
        mainCredits: 110,
        addonCredits: 40,
        credits: 150,
        totalCredits: 200,
        orderCount: 1,
        ticketCount: 2,
        apiCalls: 3,
        planCycleStartedAt: '2026-07-01',
        planResetAt: '2026-08-01',
        planExpiresAt: '2027-07-01',
        activeSubscriptionOrderId: null,
        registeredAt: '2026-01-01T00:00:00.000Z',
        lastActiveAt: '2026-07-11T00:00:00.000Z',
      },
    };
    const requestHash = createAdminActionRequestHash({
      action: 'credit-adjust',
      target: '11111111-1111-4111-8111-111111111111',
      body: {
        userId: '11111111-1111-4111-8111-111111111111',
        mainDelta: 10,
        addonDelta: 0,
        note: '修正测试积分',
      },
    });
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('pg_advisory_xact_lock')) return result([]);
      if (query.includes('FROM admin_action_idempotency') && query.includes('FOR UPDATE')) {
        return result([{
          id: 'idem-1',
          request_hash: requestHash,
          response_json: previous,
          response_status: 200,
          completed_at: new Date().toISOString(),
          response_expires_at: future(30),
          key_expires_at: future(365),
        }]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    const app = fastify();
    await app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/credits/adjust',
        headers: { 'idempotency-key': 'credit-adjustment-100' },
        payload: {
          userId: '11111111-1111-4111-8111-111111111111',
          mainDelta: 10,
          note: '修正测试积分',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['idempotency-replayed']).toBe('true');
      expect(response.json().user).toEqual(expect.objectContaining({
        userName: '测试用户',
        mainCredits: 110,
        addonCredits: 40,
        credits: 150,
        totalCredits: 200,
      }));
      expect(mocks.clientQuery).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it('缺少幂等键时拒绝调整积分', async () => {
    const app = fastify();
    await app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/credits/adjust',
        payload: {
          userId: '11111111-1111-4111-8111-111111111111',
          mainDelta: 10,
          note: '修正测试积分',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(expect.objectContaining({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '后台写操作必须提供幂等键',
      }));
      expect(mocks.withTransaction).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('严格拒绝请求体中的旧幂等字段', async () => {
    const app = fastify();
    setApiErrorHandler(app);
    await app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/credits/adjust',
        payload: {
          userId: '11111111-1111-4111-8111-111111111111',
          mainDelta: 10,
          note: '旧客户端请求体键',
          idempotencyKey: 'legacy-body-only-key',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(expect.objectContaining({
        code: 'VALIDATION_ERROR',
      }));
      expect(mocks.withTransaction).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('同一幂等键不能复用于不同积分调整请求', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('pg_advisory_xact_lock')) return result([]);
      if (query.includes('FROM admin_action_idempotency') && query.includes('FOR UPDATE')) {
        return result([{
          id: 'idem-1',
          request_hash: '0'.repeat(64),
          response_json: {},
          response_status: 200,
          completed_at: new Date().toISOString(),
          response_expires_at: future(30),
          key_expires_at: future(365),
        }]);
      }
      throw new Error(`未预期的查询：${query}`);
    });
    const app = fastify();
    await app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/credits/adjust',
        headers: { 'idempotency-key': 'credit-adjustment-conflict' },
        payload: {
          userId: '11111111-1111-4111-8111-111111111111',
          mainDelta: 10,
          note: '与原请求不同',
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual(expect.objectContaining({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '该幂等键已用于不同的后台操作',
      }));
    } finally {
      await app.close();
    }
  });
});

function result(rows: unknown[]) {
  return { rowCount: rows.length, rows };
}

function future(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function adminUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    user_name: '测试用户',
    role: 'user',
    status: 'active',
    plan_id: '33333333-3333-4333-8333-333333333333',
    plan_code: 'pro',
    plan_name: '专业版',
    billing_cycle: 'monthly',
    main_credits: 100,
    addon_credits: 40,
    total_credits: 200,
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

const LEDGER_MAIN_ID = '44444444-4444-4444-8444-444444444444';
const LEDGER_ADDON_ID = '55555555-5555-4555-8555-555555555555';
