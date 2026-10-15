import { describe,expect,it } from 'vitest';
import type { AdminGenerationJob,AdminPlan } from '../data/admin';
import {
  abortApiCostPageRequests,
  assertApiCostCursorProgress,
  assertApiCostPageConsistency,
  apiCostFilterKey,
  createApiCostResourceState,
  generationRefundFeedback,
  rejectApiCostResource,
  releaseApiCostPageRequest,
  resolveApiCostResource,
  startApiCostResource,
  toPlanMutationPayload,
} from './useAdminData';

describe('后台套餐真人权益提交', () => {
  it('保留主套餐结构化额度，并把加购包强制归零', () => {
    const mainPlan = adminPlan({
      portraitEntitlements: {
        enabled: true,
        profileLimit: null,
        activeLimit: 10,
        assetsPerActor: 2,
      },
    });
    expect(toPlanMutationPayload(mainPlan).portraitEntitlements).toEqual({
      enabled: true,
      profileLimit: null,
      activeLimit: 10,
      assetsPerActor: 2,
    });

    expect(toPlanMutationPayload({
      ...mainPlan,
      kind: 'addon',
      billing: 'one-time',
    }).portraitEntitlements).toEqual({
      enabled: false,
      profileLimit: 0,
      activeLimit: 0,
      assetsPerActor: 0,
    });
  });
});

describe('后台生成积分退回反馈', () => {
  it('不把冻结、已结算或过期批次虚报成全额退款', () => {
    expect(generationRefundFeedback(generationJob({ creditStatus: 'held' })).kind).toBe('warning');
    expect(generationRefundFeedback(generationJob({ creditStatus: 'settled', settledCredits: 80 })).message)
      .toContain('未退回积分');
    expect(generationRefundFeedback(generationJob({
      creditStatus: 'refunded',
      refundedCredits: 50,
    })).message).toContain('30 积分所属批次已过期');
  });
});

const selection = {
  range: 'month' as const,
  month: '2026-07',
  date: null,
  rangeStart: '2026-07-01',
  rangeEnd: '2026-07-13',
  timezone: 'Asia/Shanghai' as const,
  grain: 'day' as const,
};

describe('API 成本看盘数据截点', () => {
  it('经营与审计明细必须使用相同 asOf；仅对账矩阵裁剪到共同可比范围', () => {
    const asOf = '2026-07-13T06:00:00.000Z';
    const detailSelection = { ...selection, rangeStart: '2026-07-03' };
    const dashboard = {
      asOf,
      selection,
      coverage: {
        local: { start: '2026-07-01', end: '2026-07-13', status: 'complete' as const, reason: null },
        official: { start: '2026-07-03', end: '2026-07-13', status: 'complete' as const, reason: null },
        comparable: { start: '2026-07-03', end: '2026-07-13', status: 'partial' as const, reason: null },
        excludedPeriods: [],
      },
    };
    const identity = { asOf, selection: detailSelection };

    expect(() => assertApiCostPageConsistency(dashboard, 'reconciliation', identity)).not.toThrow();
    expect(() => assertApiCostPageConsistency(dashboard, 'settlement', { asOf, selection })).not.toThrow();
    expect(() => assertApiCostPageConsistency(dashboard, 'attempts', { asOf, selection })).not.toThrow();
    expect(() => assertApiCostPageConsistency(dashboard, 'tasks', { asOf, selection })).not.toThrow();
    expect(() => assertApiCostPageConsistency(dashboard, 'users', { asOf, selection })).not.toThrow();

    expect(() => assertApiCostPageConsistency(dashboard, 'tasks', {
      asOf: '2026-07-13T06:00:01.000Z', selection,
    })).toThrow('任务明细未返回统一数据截点');

    expect(() => assertApiCostPageConsistency(dashboard, 'settlement', identity))
      .toThrow('结算明细未返回统一数据截点');
  });
});

describe('API 成本服务端游标', () => {
  it('服务端声明可继续翻页时必须推进对应方向游标', () => {
    expect(() => assertApiCostCursorProgress('cursor-1', {
      hasPrevious: true,
      hasNext: true,
      previousCursor: 'cursor-0',
      nextCursor: 'cursor-2',
    })).not.toThrow();
    expect(() => assertApiCostCursorProgress('cursor-1', {
      hasPrevious: true,
      hasNext: true,
      previousCursor: 'cursor-0',
      nextCursor: 'cursor-1',
    })).toThrow('未返回有效游标');
    expect(() => assertApiCostCursorProgress('cursor-1', {
      hasPrevious: true,
      hasNext: true,
      previousCursor: 'cursor-1',
      nextCursor: 'cursor-2',
    }, 'previous')).toThrow('未返回有效游标');
  });

  it('离页或切换筛选会中止指定分页请求并释放防重键', () => {
    const taskController = new AbortController();
    const auditController = new AbortController();
    const controllers = new Map([
      ['tasks:2026-07-15T00:00:00.000Z', taskController],
      ['attempts:2026-07-15T00:00:00.000Z', auditController],
    ]);
    const activeKeys = new Set(controllers.keys());

    abortApiCostPageRequests(controllers, activeKeys, new Set(['tasks']));

    expect(taskController.signal.aborted).toBe(true);
    expect(auditController.signal.aborted).toBe(false);
    expect([...controllers.keys()]).toEqual(['attempts:2026-07-15T00:00:00.000Z']);
    expect([...activeKeys]).toEqual(['attempts:2026-07-15T00:00:00.000Z']);
  });

  it('旧分页请求结束时不会清除同键的新请求', () => {
    const key = 'tasks:2026-07-15T00:00:00.000Z';
    const oldController = new AbortController();
    const currentController = new AbortController();
    const controllers = new Map([[key, currentController]]);
    const activeKeys = new Set([key]);

    expect(releaseApiCostPageRequest(controllers, activeKeys, key, oldController)).toBe(false);
    expect(controllers.get(key)).toBe(currentController);
    expect(activeKeys.has(key)).toBe(true);

    expect(releaseApiCostPageRequest(controllers, activeKeys, key, currentController)).toBe(true);
    expect(controllers.has(key)).toBe(false);
    expect(activeKeys.has(key)).toBe(false);
  });
});

describe('成本看盘加载状态', () => {
  it('首次失败不生成假数据，同筛选刷新失败保留上次成功数据键', () => {
    const firstKey = 'range=month&month=2026-07';
    const idle = createApiCostResourceState();
    const loading = startApiCostResource(idle, firstKey);
    expect(loading).toMatchObject({ phase: 'loading', requestedKey: firstKey, dataKey: null });

    const initialFailure = rejectApiCostResource(loading, firstKey, new Error('请求超时'));
    expect(initialFailure).toMatchObject({
      phase: 'error', requestedKey: firstKey, dataKey: null, error: '请求超时',
    });

    const ready = resolveApiCostResource(loading, firstKey);
    const refreshing = startApiCostResource(ready, firstKey);
    expect(refreshing).toMatchObject({ phase: 'refreshing', dataKey: firstKey });
    expect(rejectApiCostResource(refreshing, firstKey, new Error('更新失败'))).toMatchObject({
      phase: 'error', requestedKey: firstKey, dataKey: firstKey, error: '更新失败',
    });
  });

  it('新周期失败保留旧数据身份但不会把旧周期标成当前周期', () => {
    const oldKey = 'range=month&month=2026-06';
    const newKey = 'range=month&month=2026-07';
    const ready = resolveApiCostResource(startApiCostResource(createApiCostResourceState(), oldKey), oldKey);
    const loadingNewRange = startApiCostResource(ready, newKey);

    expect(loadingNewRange).toMatchObject({
      phase: 'loading', requestedKey: newKey, dataKey: oldKey,
    });
    expect(rejectApiCostResource(loadingNewRange, newKey, new Error('新周期失败'))).toMatchObject({
      phase: 'error', requestedKey: newKey, dataKey: oldKey, error: '新周期失败',
    });
    expect(resolveApiCostResource(loadingNewRange, oldKey)).toBe(loadingNewRange);
  });

  it('搜索、状态和分辨率只改变任务键，不触发汇总或用户请求', () => {
    const base = { range: 'month' as const, month: '2026-07', model: 'Seedance 2.0' };
    const taskOnly = { ...base, search: 'user@example.com', status: 'failed' as const, resolution: '720p' as const };

    expect(apiCostFilterKey(taskOnly, 'overview')).toBe(apiCostFilterKey(base, 'overview'));
    expect(apiCostFilterKey(taskOnly, 'users')).toBe(apiCostFilterKey(base, 'users'));
    expect(apiCostFilterKey(taskOnly, 'tasks')).not.toBe(apiCostFilterKey(base, 'tasks'));
  });
});

function generationJob(patch: Partial<AdminGenerationJob>): AdminGenerationJob {
  return {
    id: 'job-1',
    time: '2026-07-01 10:00',
    userName: '测试用户',
    email: 'test@example.com',
    kind: 'video',
    model: 'Seedance 2.0',
    status: 'failed',
    duration: '-',
    credits: 80,
    reservedCredits: 80,
    settledCredits: 0,
    refundedCredits: 0,
    creditStatus: 'held',
    mainCreditsUsed: 80,
    addonCreditsUsed: 0,
    prompt: '测试',
    config: '{}',
    retryCount: 0,
    ...patch,
  };
}

function adminPlan(patch: Partial<AdminPlan> = {}): AdminPlan {
  return {
    id: 'plan-enterprise',
    name: '企业版',
    nameEn: 'Enterprise',
    code: 'enterprise',
    kind: 'main',
    billing: 'both',
    description: '企业套餐',
    monthlyPrice: 99900,
    yearlyPrice: 999000,
    credits: 100000,
    assetRetentionDays: 90,
    portraitEntitlements: {
      enabled: false,
      profileLimit: 0,
      activeLimit: 0,
      assetsPerActor: 0,
    },
    storage: '1TB',
    tiktokAccounts: '不限',
    features: [],
    recommendation: 'enterprise',
    iconKey: 'building-2',
    ctaLabel: '联系销售',
    status: 'active',
    landingVisible: true,
    subscribers: 0,
    revenue: 0,
    updatedAt: '2026-07-30 10:00',
    ...patch,
  };
}
