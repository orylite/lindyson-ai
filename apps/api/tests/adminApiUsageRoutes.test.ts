import fastify from 'fastify';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  withCostSession: vi.fn(),
  requireAdmin: vi.fn(),
  getDashboard: vi.fn(),
  getOverview: vi.fn(),
  listAttempts: vi.fn(),
  listTasks: vi.fn(),
  listUsers: vi.fn(),
  listReconciliation: vi.fn(),
  getReconciliationDetail: vi.fn(),
  listSettlement: vi.fn(),
  getMultimodalOverview: vi.fn(),
  listMultimodalUsers: vi.fn(),
  listMultimodalOperations: vi.fn(),
  getImageOverview: vi.fn(),
  listImageUsers: vi.fn(),
  listImageTasks: vi.fn(),
  requestSync: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: vi.fn(),
  withCostReportingSession: mocks.withCostSession,
}));

vi.mock('../src/auth/session.js', () => ({ requireAdmin: mocks.requireAdmin }));

vi.mock('../src/domain/apiCostReporting.js', () => ({
  getAdminApiCostDashboard: mocks.getDashboard,
  getAdminApiCostOverview: mocks.getOverview,
  listAdminApiCostAttempts: mocks.listAttempts,
  listAdminApiCostTasks: mocks.listTasks,
  listAdminApiCostUsers: mocks.listUsers,
  listAdminApiCostReconciliation: mocks.listReconciliation,
  getAdminApiCostReconciliationDetail: mocks.getReconciliationDetail,
  listAdminApiCostSettlement: mocks.listSettlement,
}));

vi.mock('../src/domain/multimodalCostReporting.js', () => ({
  getAdminMultimodalCostOverview: mocks.getMultimodalOverview,
  listAdminMultimodalCostUsers: mocks.listMultimodalUsers,
  listAdminMultimodalCostOperations: mocks.listMultimodalOperations,
}));

vi.mock('../src/domain/imageCostReporting.js', () => ({
  getAdminImageCostOverview: mocks.getImageOverview,
  listAdminImageCostUsers: mocks.listImageUsers,
  listAdminImageCostTasks: mocks.listImageTasks,
}));

vi.mock('../src/providers/volcengineBillingProvider.js', () => ({
  requestVolcengineBillingSync: mocks.requestSync,
}));

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';

const adminPaginationScope = 'admin:admin-1:role:admin';

describe('后台 API 成本与用量路由', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', role: 'admin' });
    mocks.withCostSession.mockImplementation(async (_options, read) => read({ query: mocks.poolQuery }));
    mocks.getDashboard.mockResolvedValue(validDashboard());
    mocks.getOverview.mockResolvedValue(validOverview());
    mocks.listAttempts.mockResolvedValue(emptyPage());
    mocks.listTasks.mockResolvedValue(emptyPage());
    mocks.listUsers.mockResolvedValue(emptyPage());
    mocks.listReconciliation.mockResolvedValue({ ...emptyPage(), asOf: '2026-07-13T06:00:00.000Z', selection: selection() });
    mocks.getReconciliationDetail.mockResolvedValue({ bucket: {}, evidence: [] });
    mocks.listSettlement.mockResolvedValue({
      ...emptyPage(), asOf: '2026-07-13T06:00:00.000Z', selection: selection(), summary: settlementBook(),
    });
    mocks.getMultimodalOverview.mockResolvedValue(validMultimodalOverview());
    mocks.listMultimodalUsers.mockResolvedValue({
      ...emptyPage(), asOf: '2026-07-13T06:00:00.000Z', selection: selection(),
    });
    mocks.listMultimodalOperations.mockResolvedValue({
      ...emptyPage(), asOf: '2026-07-13T06:00:00.000Z', selection: selection(),
    });
    mocks.getImageOverview.mockResolvedValue(validImageOverview());
    mocks.listImageUsers.mockResolvedValue({
      ...emptyPage(), asOf: '2026-07-13T06:00:00.000Z', selection: selection(),
    });
    mocks.listImageTasks.mockResolvedValue({
      ...emptyPage(), asOf: '2026-07-13T06:00:00.000Z', selection: selection(),
    });
    mocks.requestSync.mockResolvedValue({ id: 'sync-request-1' });
  });

  it('GET 汇总只读取本地快照，不触发官方同步', async () => {
    const app = makeAdminApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/admin/api-usage' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        account: { availableBalanceCny: '0.000000' },
        summary: {
          officialBillableTokens: 9_227_670,
          officialListEquivalentCostCny: '305.773290',
          localBillableTokens: 8_042_794,
          localEstimatedCostCny: '272.807868',
          officialPayableAmountCny: '0.000000',
        },
      });
      expect(mocks.getDashboard).toHaveBeenCalledOnce();
      expect(mocks.requestSync).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('主看盘轻量端点不返回审计账本，并使用 5 秒报表会话', async () => {
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/api-usage/overview?range=month&month=2026-07',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        operations: { taskCount: 2, settledCredits: 200, estimatedCostCny: '305.773290' },
        models: [{ model: 'Seedance 2.0' }],
      });
      expect(response.json()).not.toHaveProperty('books');
      expect(response.json()).not.toHaveProperty('coverage');
      expect(mocks.getOverview).toHaveBeenCalledOnce();
      expect(mocks.getDashboard).not.toHaveBeenCalled();
      expect(mocks.withCostSession.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: 5_000 });
      expect(mocks.requestSync).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('报表查询超时统一返回 503 和 REPORT_TIMEOUT', async () => {
    mocks.withCostSession.mockRejectedValueOnce(Object.assign(new Error('成本报表查询超时，请稍后重试'), {
      statusCode: 503,
      code: 'REPORT_TIMEOUT',
    }));
    const app = makeAdminApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/admin/api-usage/overview' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        message: '成本报表查询超时，请稍后重试',
        code: 'REPORT_TIMEOUT',
      });
    } finally {
      await app.close();
    }
  });

  it('九条成本列表路由统一返回精准分页元数据并绑定管理员作用域', async () => {
    const app = makeAdminApp();
    try {
      const endpoints = [
        '/api/admin/api-usage/attempts',
        '/api/admin/api-usage/tasks',
        '/api/admin/api-usage/users',
        '/api/admin/api-usage/reconciliation',
        '/api/admin/api-usage/settlement',
        '/api/admin/api-usage/multimodal/users',
        '/api/admin/api-usage/multimodal/operations',
        '/api/admin/api-usage/image/users',
        '/api/admin/api-usage/image/tasks',
      ];
      const responses = await Promise.all(endpoints.map(url => app.inject({ method: 'GET', url })));

      expect(responses.map(response => response.statusCode)).toEqual(endpoints.map(() => 200));
      expectExactEmptyPagination(responses);

      for (const listMock of [
        mocks.listAttempts,
        mocks.listTasks,
        mocks.listUsers,
        mocks.listReconciliation,
        mocks.listSettlement,
        mocks.listMultimodalUsers,
        mocks.listMultimodalOperations,
        mocks.listImageUsers,
        mocks.listImageTasks,
      ]) {
        expect(listMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), adminPaginationScope);
      }
    } finally {
      await app.close();
    }
  });

  it('多模态汇总、用户和操作端点使用独立的 5 秒只读报表会话', async () => {
    const app = makeAdminApp();
    try {
      const [overview, users, operations] = await Promise.all([
        app.inject({
          method: 'GET',
          url: '/api/admin/api-usage/multimodal/overview?range=month&month=2026-07',
        }),
        app.inject({
          method: 'GET',
          url: '/api/admin/api-usage/multimodal/users?range=month&month=2026-07&search=test',
        }),
        app.inject({
          method: 'GET',
          url: '/api/admin/api-usage/multimodal/operations?range=month&month=2026-07&operationType=plan-batch&status=completed',
        }),
      ]);
      expect([overview.statusCode, users.statusCode, operations.statusCode]).toEqual([200, 200, 200]);
      expect(overview.json()).toMatchObject({
        summary: { analysisCount: 1, batchCount: 2, estimateCompleteness: 'partial' },
        models: [{ model: 'Doubao Seed 2.0 Lite' }],
      });
      expect(mocks.getMultimodalOverview).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        range: 'month', month: '2026-07',
      }));
      expect(mocks.listMultimodalUsers).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        position: 'first', limit: 20, search: 'test',
      }), adminPaginationScope);
      expect(mocks.listMultimodalOperations).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        position: 'first', limit: 20, operationType: 'plan-batch', status: 'completed',
      }), adminPaginationScope);
      expect(mocks.withCostSession.mock.calls.slice(-3).every(([options]) => (
        options.timeoutMs === 5_000
      ))).toBe(true);
      expect(mocks.getOverview).not.toHaveBeenCalled();
      expect(mocks.getDashboard).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('图片汇总、用户和任务端点独立读取 Seedream 价格证据', async () => {
    const app = makeAdminApp();
    try {
      const [overview, users, tasks] = await Promise.all([
        app.inject({ method: 'GET', url: '/api/admin/api-usage/image/overview?range=month&month=2026-07' }),
        app.inject({ method: 'GET', url: '/api/admin/api-usage/image/users?range=month&month=2026-07&search=test' }),
        app.inject({ method: 'GET', url: '/api/admin/api-usage/image/tasks?range=month&month=2026-07&status=failed&evidenceStatus=missing-evidence&search=logid' }),
      ]);
      expect([overview.statusCode, users.statusCode, tasks.statusCode]).toEqual([200, 200, 200]);
      expect(overview.json()).toMatchObject({
        summary: { taskCount: 3, knownCostCny: '0.640000', missingEvidenceTaskCount: 1 },
        pricing: { model: 'Seedream 5.0 Pro', outputPixelThreshold: 2_360_000 },
      });
      expect(mocks.getImageOverview).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        range: 'month', month: '2026-07',
      }));
      expect(mocks.listImageUsers).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        position: 'first', limit: 20, search: 'test',
      }), adminPaginationScope);
      expect(mocks.listImageTasks).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        status: 'failed', evidenceStatus: 'missing-evidence', search: 'logid',
      }), adminPaginationScope);
      expect(mocks.withCostSession.mock.calls.slice(-3).every(([options]) => options.timeoutMs === 5_000)).toBe(true);
      expect(mocks.getOverview).not.toHaveBeenCalled();
      expect(mocks.getMultimodalOverview).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('多模态报表拒绝非法日历日期并返回 400', async () => {
    mocks.getMultimodalOverview.mockRejectedValueOnce(Object.assign(new Error('日期模式必须提供有效 date'), {
      statusCode: 400,
      code: 'INVALID_DATE',
    }));
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'GET', url: '/api/admin/api-usage/multimodal/overview?range=date&date=2026-02-31',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'INVALID_DATE' });
      expect(mocks.withCostSession.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: 5_000 });
    } finally {
      await app.close();
    }
  });

  it('任务、用户和 attempt 接口按各自口径校验筛选条件', async () => {
    const app = makeAdminApp();
    try {
      const businessQuery = 'range=custom&from=2026-07-01&to=2026-07-13&model=Seedance%202.0&resolution=720p&status=failed&search=test&limit=50';
      const attemptQuery = `${businessQuery}&inputClass=with-video&estimateStatus=priced`;
      const [tasks, users, attempts] = await Promise.all([
        app.inject({ method: 'GET', url: `/api/admin/api-usage/tasks?${businessQuery}` }),
        app.inject({ method: 'GET', url: `/api/admin/api-usage/users?${businessQuery}` }),
        app.inject({ method: 'GET', url: `/api/admin/api-usage/attempts?${attemptQuery}` }),
      ]);
      expect(tasks.statusCode).toBe(200);
      expect(users.statusCode).toBe(200);
      expect(attempts.statusCode).toBe(200);
      expect(mocks.listTasks.mock.calls[0]?.[1]).toMatchObject({
        range: 'custom', from: '2026-07-01', to: '2026-07-13', model: 'Seedance 2.0',
        resolution: '720p', status: 'failed', search: 'test', position: 'first', limit: 50,
      });
      expect(mocks.listUsers.mock.calls[0]?.[1]).toMatchObject({ position: 'first', limit: 50, search: 'test' });
      expect(mocks.listAttempts.mock.calls[0]?.[1]).toMatchObject({
        inputClass: 'with-video', estimateStatus: 'priced', position: 'first', limit: 50,
      });
      expect(mocks.listTasks.mock.calls[0]?.[2]).toBe(adminPaginationScope);
      expect(mocks.listUsers.mock.calls[0]?.[2]).toBe(adminPaginationScope);
      expect(mocks.listAttempts.mock.calls[0]?.[2]).toBe(adminPaginationScope);
    } finally {
      await app.close();
    }
  });

  it('月份看盘、对账矩阵和结算明细共用服务端范围选择', async () => {
    const app = makeAdminApp();
    try {
      const range = 'range=month&month=2026-07&model=Seedance%202.0';
      const [dashboard, reconciliation, settlement] = await Promise.all([
        app.inject({ method: 'GET', url: `/api/admin/api-usage?${range}` }),
        app.inject({ method: 'GET', url: `/api/admin/api-usage/reconciliation?${range}&limit=20` }),
        app.inject({ method: 'GET', url: `/api/admin/api-usage/settlement?${range}&billLineType=package-purchase&limit=20` }),
      ]);
      expect([dashboard.statusCode, reconciliation.statusCode, settlement.statusCode]).toEqual([200, 200, 200]);
      expect(mocks.getDashboard.mock.calls[0]?.[1]).toMatchObject({ range: 'month', month: '2026-07', model: 'Seedance 2.0' });
      expect(mocks.listReconciliation.mock.calls[0]?.[1]).toMatchObject({ range: 'month', month: '2026-07', limit: 20 });
      expect(mocks.listSettlement.mock.calls[0]?.[1]).toMatchObject({ billLineType: 'package-purchase', limit: 20 });
      expect(mocks.listReconciliation.mock.calls[0]?.[2]).toBe(adminPaginationScope);
      expect(mocks.listSettlement.mock.calls[0]?.[2]).toBe(adminPaginationScope);
    } finally {
      await app.close();
    }
  });

  it('手动同步只进入 worker 队列并记录管理员，不在请求内拉账单', async () => {
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/admin/provider-billing/sync', payload: { scope: 'bill' },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ accepted: true, scope: 'bill' });
      expect(mocks.requestSync).toHaveBeenCalledWith({ scope: 'bill', requestedBy: 'admin-1' });
      expect(mocks.getDashboard).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('账单历史回拉接受最长 93 天的明确窗口', async () => {
    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/admin/provider-billing/sync',
        payload: { scope: 'bill', windowStart: '2026-05-01', windowEnd: '2026-07-31' },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({
        accepted: true, scope: 'bill', windowStart: '2026-05-01', windowEnd: '2026-07-31',
      });
      expect(mocks.requestSync).toHaveBeenCalledWith({
        scope: 'bill', windowStart: '2026-05-01', windowEnd: '2026-07-31', requestedBy: 'admin-1',
      });
    } finally {
      await app.close();
    }
  });

  it('非管理员不能读取成本或提交同步', async () => {
    mocks.requireAdmin.mockRejectedValue(Object.assign(new Error('需要管理员权限'), { statusCode: 403 }));
    const app = makeAdminApp();
    try {
      const [read, multimodalRead, write] = await Promise.all([
        app.inject({ method: 'GET', url: '/api/admin/api-usage' }),
        app.inject({ method: 'GET', url: '/api/admin/api-usage/multimodal/overview' }),
        app.inject({ method: 'POST', url: '/api/admin/provider-billing/sync', payload: { scope: 'all' } }),
      ]);
      expect(read.statusCode).toBe(403);
      expect(multimodalRead.statusCode).toBe(403);
      expect(write.statusCode).toBe(403);
      expect(mocks.getDashboard).not.toHaveBeenCalled();
      expect(mocks.getMultimodalOverview).not.toHaveBeenCalled();
      expect(mocks.requestSync).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

function makeAdminApp() {
  const app = fastify({ logger: false });
  app.register(registerAdminRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const value = error as { statusCode?: number; message?: string; code?: string };
    return reply.code(value.statusCode ?? 400).send({ message: value.message, code: value.code });
  });
  return app;
}

function emptyPage() {
  return {
    items: [],
    pagination: {
      limit: 20, hasPrevious: false, hasNext: false, previousCursor: null, nextCursor: null,
      currentPage: 0, totalPages: 0, totalItems: 0, snapshotCursor: 'signed-snapshot',
    },
  };
}

function expectExactEmptyPagination(responses: Array<{ json: () => unknown }>) {
  expect(responses.map(response => {
    const body = response.json() as {
      pagination: { currentPage: number; totalPages: number; totalItems: number; snapshotCursor: string };
    };
    return {
      currentPage: body.pagination.currentPage,
      totalPages: body.pagination.totalPages,
      totalItems: body.pagination.totalItems,
      snapshotCursor: body.pagination.snapshotCursor,
    };
  })).toEqual(responses.map(() => ({
    currentPage: 0,
    totalPages: 0,
    totalItems: 0,
    snapshotCursor: 'signed-snapshot',
  })));
}

function validDashboard() {
  const syncItem = (kind: 'balance' | 'bill' | 'packages') => ({
    kind, status: 'fresh' as const, lastAttemptAt: '2026-07-13T06:00:00.000Z',
    lastSuccessAt: '2026-07-13T06:00:00.000Z', dataThrough: '2026-07-13', reason: null,
  });
  return {
    asOf: '2026-07-13T06:00:00.000Z',
    selection: selection(),
    coverage: {
      local: { start: '2026-07-01', end: '2026-07-13', status: 'complete', reason: null },
      official: { start: '2026-07-01', end: '2026-07-13', status: 'complete', reason: null },
      comparable: { start: '2026-07-01', end: '2026-07-13', status: 'complete', reason: null },
      excludedPeriods: [],
    },
    currentState: {
      capturedAt: '2026-07-13T06:00:00.000Z', balanceSnapshotAt: '2026-07-13T06:00:00.000Z',
      packageSnapshotAt: '2026-07-13T06:00:00.000Z', historicalFilterAppliedToAccount: false,
      historicalFilterAppliedToPackages: false, historicalFilterAppliedToPricing: false,
    },
    combinedStatus: {
      billState: 'provisional', matchState: 'residual', coverageState: 'complete', label: '出账中 · 仍有未解释残差',
    },
    books: {
      usage: {
        rawLocalTokens: 8_042_794, inferredAdjustmentTokens: 0, adjustedLocalTokens: 8_042_794,
        officialTokens: 9_227_670, rawTokenDelta: 1_184_876, explainedTokenDelta: 0,
        timingShiftTokens: 0, residualTokens: 1_184_876, rawCoveragePercent: 87.16, adjustedCoveragePercent: 87.16,
      },
      valuation: {
        localEstimateCompleteness: 'complete', officialEstimateCompleteness: 'complete',
        rawLocalCostCny: '272.807868', inferredAdjustmentCostCny: '0.000000', adjustedLocalCostCny: '272.807868',
        officialListEquivalentCostCny: '305.773290', rawCostDeltaCny: '32.965422', explainedCostDeltaCny: '0.000000',
        timingShiftCostCny: '0.000000', rateVarianceCny: '0.000000', roundingVarianceCny: '0.000000', residualCostCny: '32.965422',
      },
      settlement: settlementBook(),
    },
    account: {
      provider: 'volcengine-ark', currency: 'CNY', availableBalanceCny: '0.000000', cashBalanceCny: '0.000000',
      frozenAmountCny: '0.000000', arrearsBalanceCny: '0.000000', creditLimitCny: '0.000000',
      syncedAt: '2026-07-13T06:00:00.000Z', status: 'fresh',
    },
    sync: {
      status: 'normal', stale: false, lastSyncedAt: '2026-07-13T06:00:00.000Z',
      items: [syncItem('balance'), syncItem('bill'), syncItem('packages')],
    },
    summary: {
      rangeStart: '2026-07-01', rangeEnd: '2026-07-13', timezone: 'Asia/Shanghai', billStatus: 'provisional',
      localBillableTokens: 8_042_794, localEstimatedCostCny: '272.807868', localEstimateCompleteness: 'complete',
      localUnpricedAttempts: 0, localUnpricedTokens: 0, localUnavailableUsageAttempts: 0,
      officialBillableTokens: 9_227_670,
      officialUnpricedRows: 0, officialUnpricedTokens: 0,
      officialListEquivalentCostCny: '305.773290', officialOriginalBillAmountCny: '0.000000',
      officialPayableAmountCny: '0.000000', officialPaidAmountCny: '0.000000', officialUnpaidAmountCny: '0.000000',
      officialDiscountAmountCny: '305.773290', resourcePackageDeductedTokens: 9_227_670,
      todayEstimatedCostCny: '0.000000', todayEstimateCompleteness: 'complete',
      todayUnpricedAttempts: 0, todayUnavailableUsageAttempts: 0,
      monthEstimatedCostCny: '272.807868', monthEstimateCompleteness: 'complete',
      monthUnpricedAttempts: 0, monthUnavailableUsageAttempts: 0, tokenDelta: 1_184_876,
      costDeltaCny: '32.965422', localCostUnderstatementPercent: 10.781,
      allAccountOfficialDailyAverageCny: '0.000000', seedanceOfficialDailyAverageCny: '0.000000',
      seedanceListDailyAverageCny: '23.520000', noPackageProjectedDailyCostCny: '23.520000', noPackageRunwayDays: 0,
      noPackageProjectionCoveredDays: 7, noPackageProjectionStatus: 'complete',
      noPackageProjectionUnpricedRows: 0, noPackageProjectionUnpricedTokens: 0,
    },
    operations: {
      taskCount: 2, userCount: 1, settledCredits: 200, heldCredits: 0, refundedCredits: 0,
      estimatedCostCny: '305.773290', estimateCompleteness: 'complete', incompleteTaskCount: 0,
      officialEquivalentCostCny: '305.773290', differenceCny: '0.000000',
      officialPayableCny: '0.000000', reconciliationStatus: 'matched',
      models: [{
        id: 'Seedance 2.0', model: 'Seedance 2.0', taskCount: 2,
        settledCredits: 200, heldCredits: 0, refundedCredits: 0,
        estimatedCostCny: '305.773290', estimateCompleteness: 'complete',
        incompleteTaskCount: 0, averageTaskCostCny: '152.886645',
      }],
    },
    models: [], daily: [], pricingRules: [], packages: [],
  };
}

function validOverview() {
  const dashboard = validDashboard();
  const { models, ...operations } = dashboard.operations;
  return {
    asOf: dashboard.asOf,
    selection: dashboard.selection,
    account: dashboard.account,
    sync: dashboard.sync,
    operations: {
      ...operations,
      pendingFinalBillTaskCount: 0,
      approvedZeroCostTaskCount: 0,
    },
    models,
  };
}

function validMultimodalOverview() {
  const usage = {
    knownInputTokens: 1200,
    knownCachedInputTokens: 200,
    knownOutputTokens: 300,
    knownCostCny: '0.001920',
    providerRequestCount: 4,
    unknownUsageRequestCount: 1,
    unpricedRequestCount: 0,
    estimateCompleteness: 'partial' as const,
  };
  return {
    asOf: '2026-07-13T06:00:00.000Z',
    selection: selection(),
    account: validDashboard().account,
    summary: {
      analysisCount: 1, batchCount: 2, userCount: 1,
      settledCredits: 1, refundedCredits: 0, incompleteOperationCount: 1,
      ...usage,
    },
    models: [{
      id: 'doubao-seed-2-0-lite-260428', provider: 'volcengine-ark',
      model: 'Doubao Seed 2.0 Lite', analysisCount: 1, batchCount: 2, userCount: 1,
      settledCredits: 1, refundedCredits: 0, incompleteOperationCount: 1,
      ...usage,
    }],
  };
}

function validImageOverview() {
  return {
    asOf: '2026-07-13T06:00:00.000Z',
    selection: selection(),
    summary: {
      taskCount: 3, userCount: 2, completedTaskCount: 2, failedTaskCount: 1, canceledTaskCount: 0,
      settledCredits: 28, heldCredits: 0, refundedCredits: 14, referenceImageCount: 4,
      outputPixels: 4_720_000, knownCostTaskCount: 2, missingEvidenceTaskCount: 1,
      knownCostCny: '0.640000', estimateCompleteness: 'partial' as const,
    },
    pricing: {
      model: 'Seedream 5.0 Pro', modelId: 'doubao-seedream-5-0-pro-260628', currency: 'CNY' as const,
      firstReferenceImageIncluded: 1, additionalReferenceUnitPriceCny: '0.020000',
      outputPixelThreshold: 2_360_000, smallOutputPriceCny: '0.300000', largeOutputPriceCny: '0.600000',
      priceVersion: 'volcengine-seedream-5.0-pro-list-2026-07-27',
      pricingSourceUrl: 'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
      disclaimer: '官网公开列表价估算，不等于火山账户实际扣款。',
    },
  };
}

function selection() {
  return {
    range: 'month' as const, month: '2026-07', date: null, rangeStart: '2026-07-01', rangeEnd: '2026-07-13',
    timezone: 'Asia/Shanghai' as const, grain: 'day' as const,
  };
}

function settlementBook() {
  return {
    rangeStart: '2026-07-01', rangeEnd: '2026-07-13', timezone: 'Asia/Shanghai' as const,
    coverageStatus: 'complete' as const, coverageReason: null,
    usageOriginalAmountCny: '0.000000', usagePayableAmountCny: '0.000000', usagePaidAmountCny: '0.000000',
    usageUnpaidAmountCny: '0.000000', packagePurchaseAmountCny: '394.000000', packagePurchasePaidAmountCny: '394.000000',
    packagePurchaseUnpaidAmountCny: '0.000000', paygPayableAmountCny: '0.000000', listPriceOffsetValueCny: '305.773290',
    listPriceOffsetStatus: 'priced' as const, refundAmountCny: '0.000000',
    billingAdjustmentAmountCny: '0.000000', netOfficialPayableCny: '394.000000',
    openingPrepaidAssetCny: null, acquisitionCostCny: null, amortizedCostCny: null,
    openingCatchUpCny: null, expiryLossCny: null, adjustmentCny: null, endingPrepaidAssetCny: null,
    allocationStatus: 'unavailable' as const, timeAttributionStatus: 'unavailable' as const,
    timeAttributionReason: '尚无资源包成本事件可用于时间归属',
  };
}
