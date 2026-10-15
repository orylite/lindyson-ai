import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';
import {
  getPortraitEntitlementsForUser,
  validatePortraitEntitlements,
} from '../src/domain/portraitEntitlements.js';

describe('真人人像套餐权益', () => {
  it('未绑定套餐的用户回落到免费版 1/1/1', async () => {
    const query = vi.fn().mockResolvedValue(queryResult([entitlementRow({
      assigned_plan_id: null,
      source_plan_id: 'plan-free',
      source_plan_code: 'free',
      source_plan_name: '免费版',
      portrait_profile_limit: 1,
      portrait_active_limit: 1,
      portrait_assets_per_actor: 1,
    })]));

    await expect(getPortraitEntitlementsForUser({ query } as unknown as DbClient, 'user-1'))
      .resolves.toEqual({
        sourcePlanId: 'plan-free',
        sourcePlanCode: 'free',
        sourcePlanName: '免费版',
        portraitEnabled: true,
        portraitProfileLimit: 1,
        portraitActiveLimit: 1,
        portraitAssetsPerActor: 1,
      });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('CASE WHEN u.plan_id IS NULL'), ['user-1']);
  });

  it('保留企业版 null 建档上限，不会被免费额度覆盖', async () => {
    const query = vi.fn().mockResolvedValue(queryResult([entitlementRow({
      assigned_plan_id: 'plan-enterprise',
      source_plan_id: 'plan-enterprise',
      source_plan_code: 'enterprise',
      source_plan_name: '企业版',
      portrait_profile_limit: null,
      portrait_active_limit: 10,
      portrait_assets_per_actor: 2,
    })]));

    const result = await getPortraitEntitlementsForUser({ query } as unknown as DbClient, 'user-1');
    expect(result?.portraitProfileLimit).toBeNull();
    expect(result?.portraitActiveLimit).toBe(10);
    expect(result?.sourcePlanName).toBe('企业版');
  });

  it('用户不存在时返回 null，默认免费套餐缺失时明确失败', async () => {
    const missingUser = vi.fn().mockResolvedValue(queryResult([]));
    await expect(getPortraitEntitlementsForUser({ query: missingUser } as unknown as DbClient, 'missing'))
      .resolves.toBeNull();

    const missingFree = vi.fn().mockResolvedValue(queryResult([entitlementRow({
      assigned_plan_id: null,
      source_plan_id: null,
      source_plan_code: null,
      source_plan_name: null,
    })]));
    await expect(getPortraitEntitlementsForUser({ query: missingFree } as unknown as DbClient, 'user-1'))
      .rejects.toMatchObject({ code: 'FREE_PORTRAIT_PLAN_MISSING' });
  });

  it('领域校验锁定关闭态、激活上限和每人最多两份素材', () => {
    expect(validatePortraitEntitlements('main', {
      portraitEnabled: false,
      portraitProfileLimit: 1,
      portraitActiveLimit: 0,
      portraitAssetsPerActor: 0,
    })).toContain('全部为 0');
    expect(validatePortraitEntitlements('main', {
      portraitEnabled: true,
      portraitProfileLimit: 2,
      portraitActiveLimit: 3,
      portraitAssetsPerActor: 2,
    })).toContain('不能超过');
    expect(validatePortraitEntitlements('main', {
      portraitEnabled: true,
      portraitProfileLimit: null,
      portraitActiveLimit: 10,
      portraitAssetsPerActor: 3,
    })).toContain('1 或 2');
    expect(validatePortraitEntitlements('addon', {
      portraitEnabled: true,
      portraitProfileLimit: 1,
      portraitActiveLimit: 1,
      portraitAssetsPerActor: 1,
    })).toContain('加购包');
  });
});

function entitlementRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    assigned_plan_id: 'plan-pro',
    source_plan_id: 'plan-pro',
    source_plan_code: 'pro',
    source_plan_name: '专业版',
    source_plan_kind: 'main',
    portrait_enabled: true,
    portrait_profile_limit: 5,
    portrait_active_limit: 3,
    portrait_assets_per_actor: 2,
    ...overrides,
  };
}

function queryResult(rows: unknown[]) {
  return { rowCount: rows.length, rows };
}
