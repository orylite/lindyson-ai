import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  withCostSession: vi.fn(),
  requireAdmin: vi.fn(),
  overview: vi.fn(),
  details: vi.fn(),
  operational: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: vi.fn(),
  withCostReportingSession: mocks.withCostSession,
}));
vi.mock('../src/auth/session.js', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('../src/domain/providerBillingReporting.js', () => ({
  getAdminProviderBillingOverview: mocks.overview,
  listAdminProviderBillingDetails: mocks.details,
  listAdminProviderOperationalUsage: mocks.operational,
}));

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';

describe('全产品官方账单后台路由', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireAdmin.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      email: 'admin@lindyson.com',
      role: 'admin',
    });
    mocks.withCostSession.mockImplementation(async (_options, read) => read({ query: mocks.poolQuery }));
    mocks.overview.mockResolvedValue(overviewResponse());
    mocks.details.mockResolvedValue(pageResponse());
    mocks.operational.mockResolvedValue(pageResponse());
  });

  it('三条接口均要求管理员并使用隔离的十秒只读报表会话', async () => {
    const app = makeApp();
    try {
      const common = [
        'range=custom',
        'from=2026-08-01',
        'to=2026-08-11',
        'product=ark_bd',
        'serviceType=video',
        'model=Seedance%202.5',
        'finality=final',
        'attributionStatus=admin-operational',
        'search=shadow',
      ].join('&');
      const [overview, details, operational] = await Promise.all([
        app.inject({ method: 'GET', url: `/api/admin/provider-billing/overview?${common}` }),
        app.inject({ method: 'GET', url: `/api/admin/provider-billing/details?${common}&limit=30` }),
        app.inject({ method: 'GET', url: `/api/admin/provider-billing/operational-usage?${common}&limit=30` }),
      ]);

      expect([overview.statusCode, details.statusCode, operational.statusCode]).toEqual([200, 200, 200]);
      expect(mocks.requireAdmin).toHaveBeenCalledTimes(3);
      expect(mocks.overview).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        range: 'custom', product: 'ark_bd', serviceType: 'video', model: 'Seedance 2.5',
        finality: 'final', attributionStatus: 'admin-operational', search: 'shadow',
      }));
      expect(mocks.details).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        position: 'first', limit: 30,
      }), 'admin:00000000-0000-4000-8000-000000000001:role:admin');
      expect(mocks.operational).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        position: 'first', limit: 30,
      }), 'admin:00000000-0000-4000-8000-000000000001:role:admin');
      expectExactEmptyPagination([details, operational]);
      expect(mocks.withCostSession).toHaveBeenCalledTimes(3);
      expect(mocks.withCostSession.mock.calls.every(([options]) => options.timeoutMs === 10_000)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('契约拒绝混用范围和非法归属，游标配对交给签名游标 domain 校验', async () => {
    const app = makeApp();
    try {
      const [mixedRange, attribution, missingCursor] = await Promise.all([
        app.inject({
          method: 'GET',
          url: '/api/admin/provider-billing/overview?range=month&month=2026-08&from=2026-08-01&to=2026-08-02',
        }),
        app.inject({
          method: 'GET',
          url: '/api/admin/provider-billing/details?attributionStatus=some-user',
        }),
        app.inject({
          method: 'GET',
          url: '/api/admin/provider-billing/operational-usage?position=next',
        }),
      ]);

      expect(mixedRange.statusCode).toBe(400);
      expect(attribution.statusCode).toBe(400);
      // position/cursor 的配对由 domain 的签名游标解析器校验；路由只负责结构校验。
      expect(missingCursor.statusCode).toBe(200);
      expect(mocks.overview).not.toHaveBeenCalled();
      expect(mocks.details).not.toHaveBeenCalled();
      expect(mocks.operational).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it('非管理员无法读取官方账单或运营用量', async () => {
    mocks.requireAdmin.mockRejectedValue(Object.assign(new Error('需要管理员权限'), { statusCode: 403 }));
    const app = makeApp();
    try {
      const responses = await Promise.all([
        app.inject({ method: 'GET', url: '/api/admin/provider-billing/overview' }),
        app.inject({ method: 'GET', url: '/api/admin/provider-billing/details' }),
        app.inject({ method: 'GET', url: '/api/admin/provider-billing/operational-usage' }),
      ]);
      expect(responses.map(response => response.statusCode)).toEqual([403, 403, 403]);
      expect(mocks.withCostSession).not.toHaveBeenCalled();
      expect(mocks.overview).not.toHaveBeenCalled();
      expect(mocks.details).not.toHaveBeenCalled();
      expect(mocks.operational).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

function makeApp() {
  const app = fastify({ logger: false });
  app.register(registerAdminRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const value = error as { statusCode?: number; message?: string; code?: string };
    return reply.code(value.statusCode ?? 400).send({ message: value.message, code: value.code });
  });
  return app;
}

function selection() {
  return {
    range: 'custom', month: null, date: null,
    rangeStart: '2026-08-01', rangeEnd: '2026-08-11',
    timezone: 'Asia/Shanghai', grain: 'day',
  };
}

function pageResponse() {
  return {
    asOf: '2026-08-11T12:00:00.000Z',
    selection: selection(),
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

function overviewResponse() {
  return {
    asOf: '2026-08-11T12:00:00.000Z',
    selection: selection(),
    summary: {
      lineCount: 0, productCount: 0, finalLineCount: 0, provisionalLineCount: 0,
      originalBillAmountCny: '0.000000', preferentialBillAmountCny: '0.000000',
      discountBillAmountCny: '0.000000', couponAmountCny: '0.000000',
      payableAmountCny: '0.000000', paidAmountCny: '0.000000', unpaidAmountCny: '0.000000',
    },
    products: [],
    byServiceType: [],
    byAttribution: [],
  };
}
