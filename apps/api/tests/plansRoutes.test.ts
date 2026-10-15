import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  requireAdmin: vi.fn(),
  withTransaction: vi.fn(),
  runAdminIdempotentAction: vi.fn(),
  enqueuePlanPortraitReconciliationWithClient: vi.fn(),
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
    runAdminIdempotentAction: mocks.runAdminIdempotentAction,
  };
});
vi.mock('../src/domain/realPortraitReconciliation.js', () => ({
  enqueuePlanPortraitReconciliationWithClient: mocks.enqueuePlanPortraitReconciliationWithClient,
  enqueuePortraitEntitlementReconcileWithClient: vi.fn(),
}));

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';
import { registerPublicRoutes } from '../src/routes/publicRoutes.js';

describe('套餐接口', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.requireAdmin.mockReset();
    mocks.withTransaction.mockReset();
    mocks.runAdminIdempotentAction.mockReset();
    mocks.enqueuePlanPortraitReconciliationWithClient.mockReset();
    mocks.enqueuePlanPortraitReconciliationWithClient.mockResolvedValue(0);
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@lindyson.ai', role: 'admin' });
    mocks.withTransaction.mockImplementation(async callback => callback({ query: mocks.poolQuery }));
    mocks.runAdminIdempotentAction.mockImplementation(async input => mocks.withTransaction(async (client: DbClient) => ({
      response: await input.execute(client, 'test-admin-action'),
      statusCode: input.successStatus ?? 200,
      reused: false,
      actionId: 'test-admin-action',
    })));
  });

  it('公开套餐接口只查询上架套餐并返回人民币分金额字段', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([
      planRow({ id: 'plan-active', status: 'active', monthly_price: 2900, yearly_price: 22800, landing_visible: true }),
    ]));

    const app = makePublicApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/subscription/plans',
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.poolQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE status = 'active'"));
      expect(response.json()).toEqual({
        items: [expect.objectContaining({
          id: 'plan-active',
          status: 'active',
          monthlyPrice: 2900,
          yearlyPrice: 22800,
          assetRetentionDays: 30,
          portraitEntitlements: {
            enabled: true,
            profileLimit: 5,
            activeLimit: 3,
            assetsPerActor: 2,
          },
          iconKey: 'sparkles',
          landingVisible: true,
        })],
      });
    } finally {
      await app.close();
    }
  });

  it('后台套餐接口返回全量状态套餐', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([
      planRow({ id: 'plan-active', status: 'active' }),
      planRow({ id: 'plan-disabled', status: 'disabled' }),
      planRow({ id: 'plan-draft', status: 'draft' }),
    ]));

    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/plans',
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.poolQuery).toHaveBeenCalledWith(expect.stringContaining('COALESCE(s.subscribers, 0)'));
      expect(mocks.poolQuery).toHaveBeenCalledWith(expect.stringContaining("CASE WHEN p.kind = 'main' THEN 0 ELSE 1 END"));
      expect(mocks.poolQuery).toHaveBeenCalledWith(expect.stringContaining('p.monthly_price ASC'));
      expect(mocks.poolQuery).toHaveBeenCalledWith(expect.stringContaining('p.created_at ASC'));
      expect(response.json().items.map((item: { status: string }) => item.status)).toEqual(['active', 'disabled', 'draft']);
    } finally {
      await app.close();
    }
  });

  it('新增套餐只写入可编辑字段并清理同类推荐标识', async () => {
    const inserted = planRow({
      id: '11111111-1111-4111-8111-111111111111',
      code: 'growth',
      name: '增长版',
      name_en: 'Growth',
      description: '增长团队套餐',
      monthly_price: 3900,
      yearly_price: 39000,
      credits: 20000,
      asset_retention_days: 45,
      portrait_profile_limit: 8,
      portrait_active_limit: 4,
      recommendation: 'popular',
      icon_key: 'rocket',
    });
    mocks.poolQuery.mockImplementation(async (sql: unknown, values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('UPDATE plans') && query.includes('recommendation = NULL')) return queryResult([]);
      if (query.includes('INSERT INTO plans')) {
        expect(values?.slice(18, 22)).toEqual([true, 8, 4, 2]);
        return queryResult([inserted]);
      }
      if (query.includes('INSERT INTO audit_logs')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/plans',
        headers: { 'idempotency-key': 'plan-create-growth' },
        payload: {
          code: 'growth',
          name: '增长版',
          nameEn: 'Growth',
          kind: 'main',
          billing: 'both',
          description: '增长团队套餐',
          monthlyPrice: 3900,
          yearlyPrice: 39000,
          credits: 20000,
          assetRetentionDays: 45,
          portraitEntitlements: {
            enabled: true,
            profileLimit: 8,
            activeLimit: 4,
            assetsPerActor: 2,
          },
          storage: '200GB',
          tiktokAccounts: '10',
          recommendation: 'popular',
          iconKey: 'rocket',
          ctaLabel: '升级增长版',
          status: 'active',
          features: [{ text: 'AI 视频生成', enabled: true }],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.poolQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('UPDATE plans'),
        ['popular', null],
      );
      expect(mocks.poolQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO plans'),
        expect.arrayContaining(['growth', '增长版', 'Growth', 'main', 'both', '增长团队套餐', 3900, 39000, 20000]),
      );
      expect(response.json().plan).toEqual(expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        code: 'growth',
        monthlyPrice: 3900,
        assetRetentionDays: 45,
        portraitEntitlements: {
          enabled: true,
          profileLimit: 8,
          activeLimit: 4,
          assetsPerActor: 2,
        },
        iconKey: 'rocket',
      }));
    } finally {
      await app.close();
    }
  });

  it('新增主套餐缺省图标时使用星光', async () => {
    const inserted = planRow({ id: 'plan-default-icon', code: 'default-icon', icon_key: 'sparkles' });
    mocks.poolQuery.mockImplementation(async (sql: unknown, values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('INSERT INTO plans')) {
        expect(values?.[12]).toBe('sparkles');
        return queryResult([inserted]);
      }
      if (query.includes('INSERT INTO audit_logs')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/plans',
        headers: { 'idempotency-key': 'plan-create-default-icon' },
        payload: requiredPlanPayload({ code: 'default-icon' }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().plan.iconKey).toBe('sparkles');
    } finally {
      await app.close();
    }
  });

  it('加购包忽略传入图标和首页展示并规范化为空与隐藏', async () => {
    const inserted = planRow({ id: 'plan-addon', code: 'addon-test', kind: 'addon', billing: 'one-time', icon_key: null });
    mocks.poolQuery.mockImplementation(async (sql: unknown, values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('INSERT INTO plans')) {
        expect(values?.[12]).toBeNull();
        expect(values?.[15]).toBe(false);
        return queryResult([inserted]);
      }
      if (query.includes('INSERT INTO audit_logs')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/plans',
        headers: { 'idempotency-key': 'plan-create-addon' },
        payload: requiredPlanPayload({ code: 'addon-test', kind: 'addon', billing: 'one-time', iconKey: 'rocket', landingVisible: true }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().plan.iconKey).toBeNull();
      expect(response.json().plan.landingVisible).toBe(false);
      expect(mocks.enqueuePlanPortraitReconciliationWithClient).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('拒绝为加购包设置非零 AI 素材保留期', async () => {
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/plans',
        headers: { 'idempotency-key': 'plan-addon-retention' },
        payload: requiredPlanPayload({
          kind: 'addon', billing: 'one-time', assetRetentionDays: 30,
        }),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('加购包不能设置');
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each(['free', 'FREE', 'Free'])('拒绝新增系统保留的免费版代码 %s', async code => {
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/plans',
        headers: { 'idempotency-key': `plan-reserved-${code}` },
        payload: requiredPlanPayload({ code }),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('系统保留');
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([-1, 1.5, 3651])('拒绝越界素材保留天数 %s', async assetRetentionDays => {
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/plans',
        headers: { 'idempotency-key': `plan-invalid-retention-${assetRetentionDays}` },
        payload: requiredPlanPayload({ assetRetentionDays }),
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([undefined, 0])('拒绝真人库已启用但未设置正整数保留期：%s', async assetRetentionDays => {
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/plans',
        headers: { 'idempotency-key': `plan-portrait-retention-${assetRetentionDays ?? 'missing'}` },
        payload: requiredPlanPayload({ assetRetentionDays }),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('启用真人演员库');
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('修改主套餐图标并保留其他字段', async () => {
    const current = planRow({ id: '11111111-1111-4111-8111-111111111111', icon_key: 'sparkles' });
    const updated = planRow({ id: '11111111-1111-4111-8111-111111111111', icon_key: 'gem' });
    mocks.poolQuery.mockImplementation(async (sql: unknown, values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM plans WHERE id = $1')) return queryResult([current]);
      if (query.includes('UPDATE plans') && query.includes('SET code = $2')) {
        expect(values?.[13]).toBe('gem');
        return queryResult([updated]);
      }
      if (query.includes('INSERT INTO audit_logs')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/plans/11111111-1111-4111-8111-111111111111',
        headers: { 'idempotency-key': 'plan-update-icon' },
        payload: {
          iconKey: 'gem',
          assetRetentionDays: 30,
          portraitEntitlements: {
            enabled: true,
            profileLimit: 5,
            activeLimit: 3,
            assetsPerActor: 2,
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().plan.iconKey).toBe('gem');
    } finally {
      await app.close();
    }
  });

  it('修改套餐未显式提交真人权益时在契约层拒绝', async () => {
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/plans/11111111-1111-4111-8111-111111111111',
        headers: { 'idempotency-key': 'plan-update-without-portrait' },
        payload: { name: '缺少真人权益' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('必须显式提交真人演员库权益');
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([undefined, 0])('修改启用真人库的主套餐时必须显式提交正整数保留期：%s', async assetRetentionDays => {
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/plans/11111111-1111-4111-8111-111111111111',
        headers: { 'idempotency-key': `plan-update-portrait-retention-${assetRetentionDays ?? 'missing'}` },
        payload: {
          assetRetentionDays,
          portraitEntitlements: {
            enabled: true,
            profileLimit: 5,
            activeLimit: 3,
            assetsPerActor: 2,
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('启用真人演员库');
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('修改现有加购包时拒绝非关闭的真人权益', async () => {
    const current = planRow({
      id: '77777777-7777-4777-8777-777777777777',
      kind: 'addon',
      billing: 'one-time',
    });
    mocks.poolQuery.mockResolvedValue(queryResult([current]));
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/plans/77777777-7777-4777-8777-777777777777',
        headers: { 'idempotency-key': 'plan-addon-invalid-portrait' },
        payload: {
          kind: 'addon',
          assetRetentionDays: 0,
          status: 'disabled',
          portraitEntitlements: {
            enabled: true,
            profileLimit: 1,
            activeLimit: 1,
            assetsPerActor: 1,
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('加购包不能包含真人人像素材库权益');
      expect(mocks.poolQuery.mock.calls.some(([sql]) => (
        String(sql).includes('UPDATE plans') && String(sql).includes('SET code = $2')
      ))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('无订阅者的主套餐可切换为加购包，并清空图标、首页展示和真人权益', async () => {
    const current = planRow({ id: '22222222-2222-4222-8222-222222222222', icon_key: 'rocket', landing_visible: true });
    const updated = planRow({ id: '22222222-2222-4222-8222-222222222222', kind: 'addon', billing: 'one-time', icon_key: null });
    mocks.poolQuery.mockImplementation(async (sql: unknown, values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM plans WHERE id = $1')) return queryResult([current]);
      if (query.includes('FROM users') && query.includes('WHERE plan_id = $1')) {
        expect(values).toEqual(['22222222-2222-4222-8222-222222222222']);
        return queryResult([]);
      }
      if (query.includes('UPDATE plans') && query.includes('SET code = $2')) {
        expect(values?.[13]).toBeNull();
        expect(values?.[16]).toBe(false);
        expect(values?.slice(18, 22)).toEqual([false, 0, 0, 0]);
        return queryResult([updated]);
      }
      if (query.includes('INSERT INTO audit_logs')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/plans/22222222-2222-4222-8222-222222222222',
        headers: { 'idempotency-key': 'plan-main-to-addon' },
        payload: {
          kind: 'addon',
          billing: 'one-time',
          portraitEntitlements: {
            enabled: false,
            profileLimit: 0,
            activeLimit: 0,
            assetsPerActor: 0,
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().plan.iconKey).toBeNull();
      expect(response.json().plan.landingVisible).toBe(false);
      expect(mocks.enqueuePlanPortraitReconciliationWithClient).toHaveBeenCalledWith(
        expect.objectContaining({ query: mocks.poolQuery }),
        expect.objectContaining({
          planId: '22222222-2222-4222-8222-222222222222',
          eventKeyPrefix: 'portrait-plan-update:test-admin-action',
          reason: 'admin-plan-entitlements-updated',
          oldEntitlements: {
            portraitEnabled: true,
            portraitProfileLimit: 5,
            portraitActiveLimit: 3,
            portraitAssetsPerActor: 2,
          },
          newEntitlements: {
            portraitEnabled: false,
            portraitProfileLimit: 0,
            portraitActiveLimit: 0,
            portraitAssetsPerActor: 0,
          },
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('有订阅者的主套餐拒绝切换为加购包，且不产生 outbox、审计或部分写入', async () => {
    const planId = '88888888-8888-4888-8888-888888888888';
    const current = planRow({ id: planId, icon_key: 'rocket', landing_visible: true });
    mocks.poolQuery.mockImplementation(async (sql: unknown, values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM plans WHERE id = $1')) {
        expect(query).toContain('FOR UPDATE');
        expect(values).toEqual([planId]);
        return queryResult([current]);
      }
      if (query.includes('FROM users') && query.includes('WHERE plan_id = $1')) {
        expect(values).toEqual([planId]);
        return queryResult([{ '?column?': 1 }]);
      }
      throw new Error(`存在订阅者后不应继续查询或写入：${query}`);
    });

    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/plans/${planId}`,
        headers: { 'idempotency-key': 'plan-main-to-addon-with-subscribers' },
        payload: {
          kind: 'addon',
          billing: 'one-time',
          recommendation: 'popular',
          portraitEntitlements: {
            enabled: false,
            profileLimit: 0,
            activeLimit: 0,
            assetsPerActor: 0,
          },
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain('仍有订阅用户');
      expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
      expect(mocks.poolQuery.mock.calls.some(([sql]) => (
        String(sql).includes('UPDATE plans')
        || String(sql).includes('INSERT INTO audit_logs')
        || String(sql).includes('portrait_entitlement_reconcile_outbox')
      ))).toBe(false);
      expect(mocks.enqueuePlanPortraitReconciliationWithClient).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('加购包切换为主套餐时要求显式权益，未指定图标则使用星光', async () => {
    const current = planRow({ id: '33333333-3333-4333-8333-333333333333', kind: 'addon', billing: 'one-time', icon_key: null });
    const updated = planRow({ id: '33333333-3333-4333-8333-333333333333', kind: 'main', billing: 'both', icon_key: 'sparkles' });
    mocks.poolQuery.mockImplementation(async (sql: unknown, values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM plans WHERE id = $1')) return queryResult([current]);
      if (query.includes('UPDATE plans') && query.includes('SET code = $2')) {
        expect(values?.[13]).toBe('sparkles');
        expect(values?.slice(18, 22)).toEqual([true, 5, 3, 2]);
        return queryResult([updated]);
      }
      if (query.includes('INSERT INTO audit_logs')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/plans/33333333-3333-4333-8333-333333333333',
        headers: { 'idempotency-key': 'plan-addon-to-main' },
        payload: {
          kind: 'main',
          billing: 'both',
          assetRetentionDays: 30,
          portraitEntitlements: {
            enabled: true,
            profileLimit: 5,
            activeLimit: 3,
            assetsPerActor: 2,
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().plan.iconKey).toBe('sparkles');
    } finally {
      await app.close();
    }
  });

  it('拒绝未明确真人权益的新主套餐', async () => {
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/plans',
        headers: { 'idempotency-key': 'plan-main-without-portrait' },
        payload: {
          code: 'missing-portrait',
          name: '缺少权益套餐',
          kind: 'main',
          billing: 'both',
          credits: 1000,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('拒绝加购包启用真人人像权益', async () => {
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/plans',
        headers: { 'idempotency-key': 'plan-addon-with-portrait' },
        payload: requiredPlanPayload({
          kind: 'addon',
          billing: 'one-time',
          portraitEntitlements: {
            enabled: true,
            profileLimit: 1,
            activeLimit: 1,
            assetsPerActor: 1,
          },
        }),
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('主套餐切换为加购包时将素材保留期归零', async () => {
    const current = planRow({
      id: '44444444-4444-4444-8444-444444444444', asset_retention_days: 30,
    });
    const updated = planRow({
      id: '44444444-4444-4444-8444-444444444444', kind: 'addon', billing: 'one-time',
      icon_key: null, asset_retention_days: 0,
    });
    mocks.poolQuery.mockImplementation(async (sql: unknown, values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM plans WHERE id = $1')) return queryResult([current]);
      if (query.includes('FROM users') && query.includes('WHERE plan_id = $1')) return queryResult([]);
      if (query.includes('UPDATE plans') && query.includes('SET code = $2')) {
        expect(values?.[17]).toBe(0);
        return queryResult([updated]);
      }
      if (query.includes('INSERT INTO audit_logs')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/plans/44444444-4444-4444-8444-444444444444',
        headers: { 'idempotency-key': 'plan-main-to-addon-retention' },
        payload: {
          kind: 'addon',
          billing: 'one-time',
          portraitEntitlements: {
            enabled: false,
            profileLimit: 0,
            activeLimit: 0,
            assetsPerActor: 0,
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().plan.assetRetentionDays).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('新增套餐不能占用免费版系统代码的大小写变体', async () => {
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/plans',
        headers: { 'idempotency-key': 'plan-create-reserved-free' },
        payload: requiredPlanPayload({ code: 'FREE' }),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('系统保留');
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('免费版套餐代码和类型不可修改', async () => {
    const current = planRow({ id: '55555555-5555-4555-8555-555555555555', code: 'free', asset_retention_days: 7 });
    const app = makeAdminApp();
    mocks.poolQuery.mockResolvedValue(queryResult([current]));
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/plans/55555555-5555-4555-8555-555555555555',
        headers: { 'idempotency-key': 'plan-free-identity' },
        payload: {
          code: 'renamed-free',
          assetRetentionDays: 7,
          portraitEntitlements: {
            enabled: true,
            profileLimit: 5,
            activeLimit: 3,
            assetsPerActor: 2,
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('免费版套餐代码和类型不能修改');
    } finally {
      await app.close();
    }
  });

  it('普通套餐不能改成免费版代码的大小写变体', async () => {
    const current = planRow({
      id: '66666666-6666-4666-8666-666666666666', code: 'growth', asset_retention_days: 30,
    });
    const app = makeAdminApp();
    mocks.poolQuery.mockResolvedValue(queryResult([current]));
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/plans/66666666-6666-4666-8666-666666666666',
        headers: { 'idempotency-key': 'plan-reserved-free-variant' },
        payload: {
          code: 'FREE',
          assetRetentionDays: 30,
          portraitEntitlements: {
            enabled: true,
            profileLimit: 5,
            activeLimit: 3,
            assetsPerActor: 2,
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('系统保留');
    } finally {
      await app.close();
    }
  });

  it('拒绝未定义的套餐图标键', async () => {
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/plans',
        headers: { 'idempotency-key': 'plan-invalid-icon' },
        payload: requiredPlanPayload({ iconKey: 'unknown-icon' }),
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('修改套餐严格拒绝只读统计字段', async () => {
    const current = planRow({ id: '11111111-1111-4111-8111-111111111111', code: 'growth', status: 'active', subscribers: 8, revenue: 390000 });
    const updated = planRow({ ...current, status: 'disabled', subscribers: 8, revenue: 390000 });
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM plans WHERE id = $1')) return queryResult([current]);
      if (query.includes('UPDATE plans') && query.includes('SET code = $2')) return queryResult([updated]);
      if (query.includes('INSERT INTO audit_logs')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/plans/11111111-1111-4111-8111-111111111111',
        headers: { 'idempotency-key': 'plan-update-status' },
        payload: {
          status: 'disabled',
          subscribers: 999,
          revenue: 999999,
          portraitEntitlements: {
            enabled: true,
            profileLimit: 5,
            activeLimit: 3,
            assetsPerActor: 2,
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

function makePublicApp() {
  const app = fastify({ logger: false });
  app.register(registerPublicRoutes);
  return app;
}

function makeAdminApp() {
  const app = fastify({ logger: false });
  app.register(registerAdminRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const fastifyError = error as { statusCode?: number; message?: string };
    const statusCode = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 400;
    return reply.code(statusCode).send({ message: fastifyError.message });
  });
  return app;
}

function planRow(overrides: Record<string, unknown> = {}) {
  const kind = overrides.kind === 'addon' ? 'addon' : 'main';
  return {
    id: 'plan-pro',
    code: 'pro',
    name: '专业版',
    name_en: 'Pro',
    kind,
    billing: 'both',
    description: '适合稳定产出',
    monthly_price: 2900,
    yearly_price: 22800,
    credits: 10000,
    asset_retention_days: kind === 'addon' ? 0 : 30,
    portrait_enabled: kind !== 'addon',
    portrait_profile_limit: kind === 'addon' ? 0 : 5,
    portrait_active_limit: kind === 'addon' ? 0 : 3,
    portrait_assets_per_actor: kind === 'addon' ? 0 : 2,
    storage_label: '100GB',
    tiktok_accounts: '5',
    recommendation: null,
    icon_key: 'sparkles',
    cta_label: '升级专业版',
    status: 'active',
    landing_visible: false,
    subscribers: 0,
    revenue: 0,
    features: [{ text: 'AI 视频生成', enabled: true }],
    created_at: '2026-07-01T10:00:00.000Z',
    updated_at: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

function requiredPlanPayload(overrides: Record<string, unknown> = {}) {
  const kind = overrides.kind === 'addon' ? 'addon' : 'main';
  return {
    code: 'test-plan',
    name: '测试套餐',
    kind,
    billing: 'both',
    credits: 1000,
    assetRetentionDays: kind === 'addon' ? 0 : 30,
    portraitEntitlements: kind === 'addon'
      ? { enabled: false, profileLimit: 0, activeLimit: 0, assetsPerActor: 0 }
      : { enabled: true, profileLimit: 5, activeLimit: 3, assetsPerActor: 2 },
    ...overrides,
  };
}

function queryResult(rows: unknown[]) {
  return {
    rowCount: rows.length,
    rows,
  };
}
