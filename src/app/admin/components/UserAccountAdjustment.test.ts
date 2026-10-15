import { describe,expect,it } from 'vitest';
import type { AdminPlan,AdminUser } from '../../data/admin';
import {
  calculateSubscriptionPreview,
  isPortraitEntitlementsReduced,
  parseCreditAdjustmentDelta,
  validateCreditAdjustment,
  validateSubscriptionAdjustment,
} from './UserAccountAdjustment';

const user: AdminUser = {
  id: 'user-1',
  userName: '测试用户',
  email: 'user@example.com',
  planId: 'plan-basic',
  planCode: 'basic',
  planName: '基础版',
  billingCycle: 'monthly',
  planCycleStartedAt: '2026-07-17',
  mainCredits: 40,
  addonCredits: 20,
  credits: 60,
  totalCredits: 60,
  planResetAt: '2026-08-17',
  planExpiresAt: '2026-09-17',
  activeSubscriptionOrderId: 'order-1',
  status: 'active',
  registeredAt: '2026-07-01 10:00',
  lastActiveAt: '2026-07-17 10:00',
  orderCount: 1,
  apiCalls: 0,
  ticketCount: 0,
  acquisition: null,
};

const plan: AdminPlan = {
  id: 'plan-pro',
  name: '专业版',
  nameEn: 'Pro',
  code: 'pro',
  kind: 'main',
  billing: 'both',
  description: '专业版',
  monthlyPrice: 9900,
  yearlyPrice: 99000,
  credits: 1000,
  assetRetentionDays: 30,
  portraitEntitlements: {
    enabled: true,
    profileLimit: 5,
    activeLimit: 3,
    assetsPerActor: 2,
  },
  storage: '100GB',
  tiktokAccounts: '5',
  features: [],
  recommendation: null,
  iconKey: 'sparkles',
  ctaLabel: '选择套餐',
  status: 'active',
  landingVisible: true,
  subscribers: 0,
  revenue: 0,
  updatedAt: '2026-07-17 10:00',
};

describe('后台分桶积分调整校验', () => {
  it('只接受安全整数并允许显式正负号', () => {
    expect(parseCreditAdjustmentDelta('+20')).toBe(20);
    expect(parseCreditAdjustmentDelta('-10')).toBe(-10);
    expect(parseCreditAdjustmentDelta('1.5')).toBeNull();
    expect(parseCreditAdjustmentDelta('1e3')).toBeNull();
  });

  it('分别阻止主套餐和加购包积分扣成负数', () => {
    expect(validateCreditAdjustment({
      mainDelta: '-41',
      addonDelta: '0',
      note: '纠错',
      currentMainCredits: 40,
      currentAddonCredits: 20,
    })).toBe('调整后的主套餐积分不能小于 0');
    expect(validateCreditAdjustment({
      mainDelta: '0',
      addonDelta: '-21',
      note: '纠错',
      currentMainCredits: 40,
      currentAddonCredits: 20,
    })).toBe('调整后的加购包积分不能小于 0');
  });

  it('要求至少一项变化并填写内部原因', () => {
    expect(validateCreditAdjustment({
      mainDelta: '0',
      addonDelta: '0',
      note: '无变化',
      currentMainCredits: 40,
      currentAddonCredits: 20,
    })).toBe('至少填写一项非 0 的积分调整值');
    expect(validateCreditAdjustment({
      mainDelta: '1',
      addonDelta: '0',
      note: ' ',
      currentMainCredits: 40,
      currentAddonCredits: 20,
    })).toBe('请填写内部调整原因');
  });
});

describe('后台套餐调整校验', () => {
  it('要求启用主套餐、受支持周期和未来日期', () => {
    const base = {
      currentUser: user,
      targetPlanId: plan.id,
      targetPlan: plan,
      billingCycle: 'monthly' as const,
      planResetAt: '2026-08-17',
      planExpiresAt: '2027-07-17',
      note: '线下签约',
      today: '2026-07-17',
    };
    expect(validateSubscriptionAdjustment(base)).toBe('');
    expect(validateSubscriptionAdjustment({ ...base, targetPlan: { ...plan, status: 'disabled' } })).toBe('只能分配启用中的主套餐');
    expect(validateSubscriptionAdjustment({ ...base, planResetAt: '2026-07-17' })).toBe('套餐重置日期必须晚于北京时间今天');
    expect(validateSubscriptionAdjustment({ ...base, planResetAt: '2027-08-17' })).toBe('套餐重置日期不能晚于套餐到期日期');
  });

  it('允许付费套餐切换为免费版，但拒绝免费版重复保存', () => {
    expect(validateSubscriptionAdjustment({
      currentUser: user,
      targetPlanId: null,
      targetPlan: null,
      billingCycle: 'monthly',
      planResetAt: '',
      planExpiresAt: '',
      note: '取消订阅',
      today: '2026-07-17',
    })).toBe('');
    expect(validateSubscriptionAdjustment({
      currentUser: {
        ...user,
        planId: null,
        planCode: null,
        planName: '免费版',
        activeSubscriptionOrderId: null,
        planResetAt: null,
        planExpiresAt: null,
      },
      targetPlanId: null,
      targetPlan: null,
      billingCycle: 'monthly',
      planResetAt: '',
      planExpiresAt: '',
      note: '重复保存',
      today: '2026-07-17',
    })).toBe('当前已经是免费版，无需重复保存');
  });
});

describe('后台真人演员库降级识别', () => {
  const pro = {
    enabled: true,
    profileLimit: 5,
    activeLimit: 3,
    assetsPerActor: 2,
  };

  it('任一结构化权益减少都触发降级提示', () => {
    expect(isPortraitEntitlementsReduced(pro, { ...pro, profileLimit: 4 })).toBe(true);
    expect(isPortraitEntitlementsReduced(pro, { ...pro, activeLimit: 2 })).toBe(true);
    expect(isPortraitEntitlementsReduced(pro, { ...pro, assetsPerActor: 1 })).toBe(true);
    expect(isPortraitEntitlementsReduced(pro, {
      enabled: false,
      profileLimit: 0,
      activeLimit: 0,
      assetsPerActor: 0,
    })).toBe(true);
  });

  it('有限档案升级为不限或扩大额度不视为降级', () => {
    expect(isPortraitEntitlementsReduced(pro, { ...pro, profileLimit: null })).toBe(false);
    expect(isPortraitEntitlementsReduced(pro, {
      ...pro,
      profileLimit: 10,
      activeLimit: 5,
    })).toBe(false);
  });

  it('不限档案改为有限额度属于降级', () => {
    expect(isPortraitEntitlementsReduced(
      { ...pro, profileLimit: null },
      pro,
    )).toBe(true);
  });
});

describe('后台套餐调整预览与服务端结算顺序一致', () => {
  const currentPlan = { ...plan, id: 'plan-basic', code: 'basic', name: '基础版', credits: 500 };

  it('已到重置日时先按当前套餐标准积分结算', () => {
    expect(calculateSubscriptionPreview({
      currentUser: { ...user, planResetAt: '2026-07-17', planExpiresAt: '2026-09-17' },
      currentAssignedPlan: currentPlan,
      targetPlanId: currentPlan.id,
      targetPlan: currentPlan,
      today: '2026-07-17',
    })).toEqual({
      reconcileWillExpire: false,
      reconcileWillReset: true,
      planActuallyChanges: false,
      previewMainCredits: 500,
    });
  });

  it('已到期时先回退免费版，再按目标套餐标准积分切回', () => {
    expect(calculateSubscriptionPreview({
      currentUser: { ...user, planExpiresAt: '2026-07-17' },
      currentAssignedPlan: currentPlan,
      targetPlanId: currentPlan.id,
      targetPlan: currentPlan,
      today: '2026-07-17',
    })).toEqual({
      reconcileWillExpire: true,
      reconcileWillReset: false,
      planActuallyChanges: true,
      previewMainCredits: 500,
    });
  });
});
