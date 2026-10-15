import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setApiErrorHandler } from '../src/app.js';

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  requireAdmin: vi.fn(),
  withTransaction: vi.fn(),
  reconcileSubscriptionWithClient: vi.fn(),
  replaceSubscriptionMainLotWithClient: vi.fn(),
  setUserAvailableCreditsWithClient: vi.fn(),
  enqueuePortraitEntitlementReconcileWithClient: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: vi.fn() },
  withTransaction: mocks.withTransaction,
}));
vi.mock('../src/auth/session.js', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('../src/domain/billingClock.js', () => ({ getBillingDate: () => '2026-07-17' }));
vi.mock('../src/domain/financialCredits.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/domain/financialCredits.js')>();
  return {
    ...actual,
    replaceSubscriptionMainLotWithClient: mocks.replaceSubscriptionMainLotWithClient,
    setUserAvailableCreditsWithClient: mocks.setUserAvailableCreditsWithClient,
  };
});
vi.mock('../src/domain/subscriptionLifecycle.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/domain/subscriptionLifecycle.js')>();
  return {
    ...actual,
    reconcileSubscriptionWithClient: mocks.reconcileSubscriptionWithClient,
  };
});
vi.mock('../src/domain/realPortraitReconciliation.js', () => ({
  enqueuePortraitEntitlementReconcileWithClient: mocks.enqueuePortraitEntitlementReconcileWithClient,
  enqueuePlanPortraitReconciliationWithClient: vi.fn(),
}));

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';

describe('后台用户套餐调整', () => {
  beforeEach(() => {
    mocks.clientQuery.mockReset();
    mocks.requireAdmin.mockReset();
    mocks.withTransaction.mockReset();
    mocks.reconcileSubscriptionWithClient.mockReset();
    mocks.replaceSubscriptionMainLotWithClient.mockReset();
    mocks.setUserAvailableCreditsWithClient.mockReset();
    mocks.enqueuePortraitEntitlementReconcileWithClient.mockReset();
    mocks.requireAdmin.mockResolvedValue({ id: ADMIN_ID, email: 'admin@example.com', role: 'admin' });
    mocks.withTransaction.mockImplementation(async callback => callback({ query: mocks.clientQuery }));
    mocks.reconcileSubscriptionWithClient.mockResolvedValue(false);
    mocks.replaceSubscriptionMainLotWithClient.mockResolvedValue(undefined);
    mocks.enqueuePortraitEntitlementReconcileWithClient.mockResolvedValue(true);
  });

  it('切换已上架主套餐时按目标标准积分重建批次并原子写流水、审计和幂等响应', async () => {
    const initial = subscriptionState();
    const final = adminUserRow({
      plan_id: ENTERPRISE_PLAN_ID,
      plan_code: 'enterprise',
      plan_name: '企业版',
      billing_cycle: 'yearly',
      plan_cycle_started_at: '2026-07-17',
      plan_reset_at: '2026-08-17',
      plan_expires_at: '2027-07-17',
      active_subscription_order_id: null,
      main_credits: 500,
      addon_credits: 20,
      total_credits: 520,
    });
    let stateReads = 0;
    mocks.setUserAvailableCreditsWithClient.mockResolvedValue({ mainCredits: 500, addonCredits: 20, balance: 520 });
    mocks.clientQuery.mockImplementation(async (sql: unknown, values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('hashtextextended')) return result([]);
      if (query.includes('FROM admin_action_idempotency') && query.includes('FOR UPDATE')) return result([]);
      if (query.includes('INSERT INTO admin_action_idempotency')) return result([{ id: ACTION_ID }]);
      if (query.includes('SELECT u.id, u.email, u.plan_id')) {
        stateReads += 1;
        return result([initial]);
      }
      if (query.includes('FROM plans') && query.includes('FOR SHARE')) return result([enterprisePlan()]);
      if (query.includes('FROM orders item')) return result([]);
      if (query.includes('INSERT INTO credit_ledger')) {
        expect(values).toEqual([
          USER_ID,
          400,
          520,
          'admin@example.com',
          '套餐已调整为“企业版”，主套餐积分已同步。',
          `admin-subscription:${ACTION_ID}:main-ledger`,
        ]);
        return result([ledgerRow({ amount: 400, balance: 520 })]);
      }
      if (query.includes('UPDATE users') && query.includes('active_subscription_order_id = NULL')) {
        expect(values).toEqual([
          USER_ID,
          ENTERPRISE_PLAN_ID,
          'yearly',
          '2026-07-17',
          '2026-08-17',
          '2027-07-17',
        ]);
        return result([]);
      }
      if (query.includes('INSERT INTO audit_logs')) {
        expect(values).toEqual(expect.arrayContaining([
          '用户管理',
          '调整用户套餐',
          expect.stringContaining('人工升级'),
        ]));
        return result([]);
      }
      if (query.includes('SELECT u.*') && query.includes('LEFT JOIN plans')) return result([final]);
      if (query.includes('UPDATE admin_action_idempotency')) return result([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const response = await injectSubscription(paidPayload());

    expect(response.statusCode).toBe(200);
    expect(mocks.enqueuePortraitEntitlementReconcileWithClient).toHaveBeenCalledWith(
      expect.objectContaining({ query: mocks.clientQuery }),
      {
        userId: USER_ID,
        eventKey: `portrait-admin-subscription:${ACTION_ID}`,
        reason: 'admin-user-plan-switched',
        oldPlanId: PRO_PLAN_ID,
        newPlanId: ENTERPRISE_PLAN_ID,
      },
    );
    expect(response.json()).toEqual(expect.objectContaining({
      entry: expect.objectContaining({ amount: 400, bucket: 'main', balance: 520 }),
      user: expect.objectContaining({
        planId: ENTERPRISE_PLAN_ID,
        planCode: 'enterprise',
        planName: '企业版',
        billingCycle: 'yearly',
        planCycleStartedAt: '2026-07-17',
        planResetAt: '2026-08-17',
        planExpiresAt: '2027-07-17',
        activeSubscriptionOrderId: null,
        mainCredits: 500,
        addonCredits: 20,
      }),
    }));
    expect(stateReads).toBe(2);
    expect(mocks.reconcileSubscriptionWithClient).toHaveBeenCalledWith(
      expect.objectContaining({ query: mocks.clientQuery }),
      USER_ID,
    );
    expect(mocks.replaceSubscriptionMainLotWithClient).toHaveBeenCalledWith(
      expect.objectContaining({ query: mocks.clientQuery }),
      {
        userId: USER_ID,
        expectedAvailable: 100,
        nextAmount: 500,
        cycleEventKey: `admin-subscription:${ACTION_ID}:main-lot`,
        nextExpiresAt: '2026-08-17',
      },
    );
  });

  it('同一套餐只修改日期时保持主积分金额但仍重建到期批次', async () => {
    const initial = subscriptionState();
    const final = adminUserRow({
      plan_cycle_started_at: '2026-07-17',
      plan_reset_at: '2026-08-20',
      plan_expires_at: '2026-10-20',
      active_subscription_order_id: null,
    });
    mocks.setUserAvailableCreditsWithClient.mockResolvedValue({ mainCredits: 100, addonCredits: 20, balance: 120 });
    mocks.clientQuery.mockImplementation(successQueryHandler({
      state: initial,
      plan: proPlan(),
      final,
      expectedUpdateValues: [
        USER_ID,
        PRO_PLAN_ID,
        'monthly',
        '2026-07-17',
        '2026-08-20',
        '2026-10-20',
      ],
    }));

    const response = await injectSubscription(paidPayload({
      planId: PRO_PLAN_ID,
      billingCycle: 'monthly',
      planResetAt: '2026-08-20',
      planExpiresAt: '2026-10-20',
      expectedPlanCredits: 500,
      note: '延长测试周期',
    }));

    expect(response.statusCode).toBe(200);
    expect(response.json().entry).toBeNull();
    expect(mocks.replaceSubscriptionMainLotWithClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expectedAvailable: 100, nextAmount: 100, nextExpiresAt: '2026-08-20' }),
    );
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO credit_ledger'))).toBe(false);
  });

  it('切换免费版时清零主积分、保留加购积分并写入统一用户流水', async () => {
    const initial = subscriptionState();
    const final = adminUserRow({
      plan_id: null,
      plan_code: null,
      plan_name: null,
      billing_cycle: 'monthly',
      plan_cycle_started_at: '2026-07-17',
      plan_reset_at: null,
      plan_expires_at: null,
      active_subscription_order_id: null,
      main_credits: 0,
      addon_credits: 20,
      total_credits: 20,
    });
    mocks.setUserAvailableCreditsWithClient.mockResolvedValue({ mainCredits: 0, addonCredits: 20, balance: 20 });
    mocks.clientQuery.mockImplementation(successQueryHandler({
      state: initial,
      plan: null,
      final,
      ledger: ledgerRow({ amount: -100, balance: 20, note: '账户已切换为免费版，主套餐积分已清零。' }),
      expectedUpdateValues: [USER_ID, null, 'monthly', '2026-07-17', null, null],
    }));

    const response = await injectSubscription({
      planId: null,
      billingCycle: null,
      planResetAt: null,
      planExpiresAt: null,
      note: '结束人工套餐',
      expected: expectedSnapshot(),
      expectedPlanCredits: 0,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      entry: expect.objectContaining({ amount: -100, balance: 20 }),
      user: expect.objectContaining({ planId: null, planCode: null, mainCredits: 0, addonCredits: 20 }),
    }));
    expect(mocks.replaceSubscriptionMainLotWithClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nextAmount: 0, nextExpiresAt: null }),
    );
  });

  it('expected 快照过期时返回 409，且不执行 reconcile 或财务写入', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('hashtextextended')) return result([]);
      if (query.includes('FROM admin_action_idempotency') && query.includes('FOR UPDATE')) return result([]);
      if (query.includes('INSERT INTO admin_action_idempotency')) return result([{ id: ACTION_ID }]);
      if (query.includes('SELECT u.id, u.email, u.plan_id')) return result([subscriptionState({ main_credits: 99 })]);
      throw new Error(`快照冲突后不应继续查询：${query}`);
    });

    const response = await injectSubscription(paidPayload());

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'ADMIN_USER_SUBSCRIPTION_STALE' });
    expect(mocks.reconcileSubscriptionWithClient).not.toHaveBeenCalled();
    expect(mocks.replaceSubscriptionMainLotWithClient).not.toHaveBeenCalled();
  });

  it('套餐积分配置变化或存在非终态主套餐订单时拒绝调整', async () => {
    const run = async (mode: 'credits' | 'order') => {
      mocks.clientQuery.mockReset();
      mocks.clientQuery.mockImplementation(async (sql: unknown) => {
        const query = String(sql);
        if (query.includes('hashtextextended')) return result([]);
        if (query.includes('FROM admin_action_idempotency') && query.includes('FOR UPDATE')) return result([]);
        if (query.includes('INSERT INTO admin_action_idempotency')) return result([{ id: ACTION_ID }]);
        if (query.includes('SELECT u.id, u.email, u.plan_id')) return result([subscriptionState()]);
        if (query.includes('FROM plans') && query.includes('FOR SHARE')) {
          return result([enterprisePlan({ credits: mode === 'credits' ? 501 : 500 })]);
        }
        if (query.includes('FROM orders item')) {
          return mode === 'order' ? result([{ id: ORDER_ID, status: 'pending', refund_status: 'none' }]) : result([]);
        }
        throw new Error(`拒绝后不应继续查询：${query}`);
      });
      return injectSubscription(paidPayload(), `subscription-${mode}-key`);
    };

    const creditsResponse = await run('credits');
    expect(creditsResponse.statusCode).toBe(409);
    expect(creditsResponse.json()).toMatchObject({ code: 'ADMIN_PLAN_CREDITS_STALE' });

    const orderResponse = await run('order');
    expect(orderResponse.statusCode).toBe(409);
    expect(orderResponse.json()).toMatchObject({ code: 'SUBSCRIPTION_CHANGE_BLOCKED_BY_ORDER_STATE' });
    expect(mocks.reconcileSubscriptionWithClient).not.toHaveBeenCalled();
  });
});

function successQueryHandler(input: {
  state: Record<string, unknown>;
  plan: Record<string, unknown> | null;
  final: Record<string, unknown>;
  ledger?: Record<string, unknown>;
  expectedUpdateValues: unknown[];
}) {
  let stateReads = 0;
  return async (sql: unknown, values?: unknown[]) => {
    const query = String(sql);
    if (query.includes('hashtextextended')) return result([]);
    if (query.includes('FROM admin_action_idempotency') && query.includes('FOR UPDATE')) return result([]);
    if (query.includes('INSERT INTO admin_action_idempotency')) return result([{ id: ACTION_ID }]);
    if (query.includes('SELECT u.id, u.email, u.plan_id')) {
      stateReads += 1;
      return result([input.state]);
    }
    if (query.includes('FROM plans') && query.includes('FOR SHARE')) {
      if (!input.plan) throw new Error('免费版不应查询 plans');
      return result([input.plan]);
    }
    if (query.includes('FROM orders item')) return result([]);
    if (query.includes('INSERT INTO credit_ledger')) {
      if (!input.ledger) throw new Error('主积分未变化时不应写积分流水');
      return result([input.ledger]);
    }
    if (query.includes('UPDATE users') && query.includes('active_subscription_order_id = NULL')) {
      expect(values).toEqual(input.expectedUpdateValues);
      return result([]);
    }
    if (query.includes('INSERT INTO audit_logs')) return result([]);
    if (query.includes('SELECT u.*') && query.includes('LEFT JOIN plans')) return result([input.final]);
    if (query.includes('UPDATE admin_action_idempotency')) return result([]);
    throw new Error(`未预期的查询：${query}; stateReads=${stateReads}`);
  };
}

async function injectSubscription(payload: Record<string, unknown>, idempotencyKey = 'subscription-change-key-100') {
  const app = fastify();
  setApiErrorHandler(app);
  await app.register(registerAdminRoutes);
  try {
    return await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${USER_ID}/subscription`,
      headers: { 'idempotency-key': idempotencyKey },
      payload,
    });
  } finally {
    await app.close();
  }
}

function paidPayload(overrides: Record<string, unknown> = {}) {
  return {
    planId: ENTERPRISE_PLAN_ID,
    billingCycle: 'yearly',
    planResetAt: '2026-08-17',
    planExpiresAt: '2027-07-17',
    note: '人工升级',
    expected: expectedSnapshot(),
    expectedPlanCredits: 500,
    ...overrides,
  };
}

function expectedSnapshot() {
  return {
    planId: PRO_PLAN_ID,
    billingCycle: 'monthly',
    planCycleStartedAt: '2026-07-01',
    planResetAt: '2026-08-01',
    planExpiresAt: '2026-08-01',
    activeSubscriptionOrderId: ORDER_ID,
    mainCredits: 100,
  };
}

function subscriptionState(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: 'user@example.com',
    plan_id: PRO_PLAN_ID,
    plan_code: 'pro',
    plan_name: '专业版',
    billing_cycle: 'monthly',
    plan_cycle_started_at: '2026-07-01',
    plan_reset_at: '2026-08-01',
    plan_expires_at: '2026-08-01',
    active_subscription_order_id: ORDER_ID,
    main_credits: 100,
    addon_credits: 20,
    ...overrides,
  };
}

function adminUserRow(overrides: Record<string, unknown> = {}) {
  return {
    ...subscriptionState(),
    user_name: '测试用户',
    role: 'user',
    status: 'active',
    total_credits: 120,
    order_count: 1,
    ticket_count: 0,
    api_calls: 0,
    registered_at: '2026-01-01T00:00:00.000Z',
    last_active_at: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

function enterprisePlan(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTERPRISE_PLAN_ID,
    code: 'enterprise',
    name: '企业版',
    kind: 'main',
    billing: 'both',
    status: 'active',
    credits: 500,
    ...overrides,
  };
}

function proPlan() {
  return {
    id: PRO_PLAN_ID,
    code: 'pro',
    name: '专业版',
    kind: 'main',
    billing: 'both',
    status: 'active',
    credits: 500,
  };
}

function ledgerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEDGER_ID,
    user_id: USER_ID,
    type: 'adjust',
    bucket: 'main',
    settlement_status: 'settled',
    amount: 400,
    balance: 520,
    source: '后台套餐调整',
    operator: 'admin@example.com',
    note: '套餐已调整为“企业版”，主套餐积分已同步。',
    related_order_id: null,
    related_job_id: null,
    related_asset_id: null,
    created_at: '2026-07-17T04:00:00.000Z',
    ...overrides,
  };
}

function result(rows: unknown[]) {
  return { rowCount: rows.length, rows };
}

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const PRO_PLAN_ID = '33333333-3333-4333-8333-333333333333';
const ENTERPRISE_PLAN_ID = '44444444-4444-4444-8444-444444444444';
const LEDGER_ID = '55555555-5555-4555-8555-555555555555';
const ACTION_ID = '66666666-6666-4666-8666-666666666666';
