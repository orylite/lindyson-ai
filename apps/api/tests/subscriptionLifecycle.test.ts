import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replaceSubscriptionMainLotWithClient: vi.fn(),
  setUserAvailableCreditsWithClient: vi.fn(),
  enqueuePortraitEntitlementReconcileWithClient: vi.fn(),
}));

vi.mock('../src/domain/financialCredits.js', () => ({
  replaceSubscriptionMainLotWithClient: mocks.replaceSubscriptionMainLotWithClient,
  setUserAvailableCreditsWithClient: mocks.setUserAvailableCreditsWithClient,
}));
vi.mock('../src/domain/realPortraitReconciliation.js', () => ({
  enqueuePortraitEntitlementReconcileWithClient: mocks.enqueuePortraitEntitlementReconcileWithClient,
}));

import { reconcileSubscriptionWithClient } from '../src/domain/subscriptionLifecycle.js';

describe('订阅生命周期', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.replaceSubscriptionMainLotWithClient.mockResolvedValue(undefined);
    mocks.setUserAvailableCreditsWithClient.mockResolvedValue({
      mainCredits: 0,
      addonCredits: 3000,
      balance: 3000,
    });
    mocks.enqueuePortraitEntitlementReconcileWithClient.mockResolvedValue(true);
  });

  it('年付周期到点时重置主套餐积分并保留加购积分', async () => {
    mocks.setUserAvailableCreditsWithClient.mockResolvedValue({
      mainCredits: 10000,
      addonCredits: 3000,
      balance: 13000,
    });
    const query = vi.fn().mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM users u')) return result([subscriptionUser({ plan_reset_at: '2020-01-01', plan_expires_at: '2099-01-01' })]);
      if (text.includes('UPDATE users')) return result([]);
      if (text.includes('INSERT INTO credit_ledger')) return result([]);
      throw new Error(`未预期查询：${text}`);
    });

    await expect(reconcileSubscriptionWithClient(
      { query } as any,
      'user-1',
      new Date('2026-07-09T22:30:00.000Z'),
    )).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('plan_reset_at = $2::date + 30'),
      ['user-1', '2026-07-10'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO credit_ledger'),
      ['user-1', 9000, 13000, '套餐周期重置', '新订阅周期已开始，“专业版”套餐积分已重置。', 'subscription-cycle:user-1:2026-07-10'],
    );
    expect(mocks.replaceSubscriptionMainLotWithClient).toHaveBeenCalledWith(
      expect.objectContaining({ query }),
      expect.objectContaining({
        userId: 'user-1',
        expectedAvailable: 1000,
        nextAmount: 10000,
        cycleEventKey: 'subscription-cycle:user-1:2026-07-10',
      }),
    );
    expect(mocks.setUserAvailableCreditsWithClient).toHaveBeenCalledWith(
      expect.objectContaining({ query }),
      'user-1',
    );
  });

  it('套餐到期后降级免费版且保留加购积分', async () => {
    const query = vi.fn().mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM users u')) return result([subscriptionUser({ plan_expires_at: '2020-01-01' })]);
      if (text.includes('UPDATE users')) return result([]);
      if (text.includes('INSERT INTO credit_ledger')) return result([]);
      throw new Error(`未预期查询：${text}`);
    });

    await expect(reconcileSubscriptionWithClient(
      { query } as any,
      'user-1',
      new Date('2026-07-09T22:30:00.000Z'),
    )).resolves.toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('FROM plans'))).toBe(false);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/plan_id = NULL[\s\S]*plan_reset_at = NULL[\s\S]*plan_expires_at = NULL/),
      ['user-1', '2026-07-10'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO credit_ledger'),
      ['user-1', -1000, 3000, '套餐到期回退', '付费套餐已到期，账户已切换为免费版。', 'subscription-expired:user-1:2026-07-10'],
    );
    expect(mocks.replaceSubscriptionMainLotWithClient).toHaveBeenCalledWith(
      expect.objectContaining({ query }),
      expect.objectContaining({ nextAmount: 0 }),
    );
    expect(mocks.enqueuePortraitEntitlementReconcileWithClient).toHaveBeenCalledWith(
      expect.objectContaining({ query }),
      {
        userId: 'user-1',
        eventKey: 'portrait-subscription-expired:user-1:2026-07-10',
        reason: 'subscription-expired',
        oldPlanId: 'plan-pro',
        newPlanId: null,
      },
    );
  });

  it('套餐到期时主积分已经为零则不写零金额流水', async () => {
    const query = vi.fn().mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM users u')) return result([subscriptionUser({ main_credits: 0, plan_expires_at: '2020-01-01' })]);
      if (text.includes('UPDATE users')) return result([]);
      throw new Error(`未预期查询：${text}`);
    });

    await expect(reconcileSubscriptionWithClient(
      { query } as any,
      'user-1',
      new Date('2026-07-09T22:30:00.000Z'),
    )).resolves.toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('credit_ledger'))).toBe(false);
  });
});

function subscriptionUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    plan_id: 'plan-pro',
    plan_code: 'pro',
    plan_name: '专业版',
    plan_credits: 10000,
    billing_cycle: 'yearly',
    main_credits: 1000,
    addon_credits: 3000,
    plan_reset_at: '2099-01-01',
    plan_expires_at: '2099-12-31',
    ...overrides,
  };
}

function result(rows: unknown[]) {
  return { rows, rowCount: rows.length };
}
