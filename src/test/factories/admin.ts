import type { AdminPlan } from '../../app/data/admin';

export function createAdminPlan(overrides: Partial<AdminPlan> = {}): AdminPlan {
  return {
    id: 'plan-test',
    name: '测试套餐',
    nameEn: 'Test',
    code: 'test',
    kind: 'main',
    billing: 'both',
    description: '测试专用套餐',
    monthlyPrice: 0,
    yearlyPrice: 0,
    credits: 0,
    assetRetentionDays: 0,
    portraitEntitlements: { enabled: false, profileLimit: 0, activeLimit: 0, assetsPerActor: 0 },
    storage: '0GB',
    tiktokAccounts: '0',
    features: [],
    recommendation: null,
    iconKey: 'zap',
    ctaLabel: '测试',
    status: 'active',
    landingVisible: false,
    subscribers: 0,
    revenue: 0,
    updatedAt: '2026-01-01 00:00',
    ...overrides,
  };
}
