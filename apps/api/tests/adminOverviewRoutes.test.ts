import fastify from 'fastify';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: vi.fn(),
  withCostReportingSession: vi.fn(),
}));

vi.mock('../src/auth/session.js', () => ({
  requireAdmin: mocks.requireAdmin,
}));

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';

describe('后台总览聚合', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.requireAdmin.mockReset();
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', role: 'admin' });
  });

  it('从完整数据库集合返回北京时间聚合，不依赖列表分页结果', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([{
      total_users: 1200,
      today_new_users: 8,
      month_new_users: 75,
      total_revenue: 980000,
      today_revenue: 32000,
      month_revenue: 380000,
      seven_day_revenue: 120000,
      total_jobs: 6000,
      today_jobs: 32,
      active_jobs: 5,
      open_tickets: 6,
      pending_invoices: 7,
      seven_day_payment_failures: 3,
      inactive_users: 84,
      failed_jobs: 12,
      seven_day_api_requests: 5,
      seven_day_api_successes: 4,
      revenue_trend: [
        { day: '2026-07-05', revenue: 10000, orders: 2 },
        { day: '2026-07-11', revenue: 32000, orders: 5 },
      ],
      model_usage: [
        { model: 'Seedance 2.0', billableTokens: 108900 },
        { model: 'Doubao Seed 2.0 Lite', billableTokens: 8200 },
      ],
      acquisition_mix: [
        { source: 'xiaohongshu', registrations: 40, paidUsers: 6, revenue: 119400 },
        { source: 'direct', registrations: 20, paidUsers: 1, revenue: 19900 },
      ],
      day_start: '2026-07-10T16:00:00.000Z',
      month_start: '2026-06-30T16:00:00.000Z',
    }]));

    const app = makeApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/admin/overview' });

      expect(response.statusCode).toBe(200);
      expect(response.json().summary).toEqual(expect.objectContaining({
        totalUsers: 1200,
        sevenDayPaymentFailures: 3,
        inactiveUsers: 84,
        failedJobs: 12,
        sevenDayApiRequests: 5,
        sevenDayApiSuccesses: 4,
        sevenDayApiSuccessRate: 80,
        revenueTrend: [
          { day: '2026-07-05', revenue: 10000, orders: 2 },
          { day: '2026-07-11', revenue: 32000, orders: 5 },
        ],
        modelUsage: [
          { model: 'Seedance 2.0', billableTokens: 108900 },
          { model: 'Doubao Seed 2.0 Lite', billableTokens: 8200 },
        ],
        acquisitionMix: [
          { source: 'xiaohongshu', registrations: 40, paidUsers: 6, revenue: 119400 },
          { source: 'direct', registrations: 20, paidUsers: 1, revenue: 19900 },
        ],
        timezone: 'Asia/Shanghai',
      }));
      expect(response.json().apiCostHealth).toEqual({
        syncStatus: 'warning',
        lastSyncedAt: '-',
        matchState: 'cannot-reconcile',
        residualTokens: null,
        residualCostCny: null,
      });

      const sql = String(mocks.poolQuery.mock.calls[0]?.[0]);
      expect(sql).toContain("AT TIME ZONE 'Asia/Shanghai'");
      expect(sql).toContain('generate_series');
      expect(sql).toContain("coalesce(failed_at, created_at) >= day_start - interval '6 days'");
      expect(sql).toContain("last_active_at < day_start - interval '30 days'");
      expect(sql).toContain("coalesce(completed_at, created_at) >= day_start - interval '6 days'");
      expect(sql).toContain("pur.usage_unit = 'tokens'");
      expect(sql).toContain('FROM image_provider_usage_records image_usage');
      expect(sql).toContain('image_usage.total_tokens::bigint AS token_count');
      expect(sql).toContain('FROM prompt_wizard_provider_requests prompt_usage');
      expect(sql).toContain("prompt_usage.request_status = 'succeeded'");
      expect(sql).toContain("THEN 'Doubao Seed 2.0 Lite'");
      expect(sql).toContain('prompt_usage.input_tokens::bigint + prompt_usage.output_tokens::bigint');
      expect(sql).toContain("CASE WHEN completed_at > now() THEN 'running' ELSE status END");
      expect(sql).toContain('CASE WHEN completed_at > now() THEN NULL ELSE completed_at END');
      expect(sql).toContain("status = 'success' AND completed_at <= now()");
      expect(sql).toContain('AND started_at <= now()');
      expect(sql).not.toContain('LIMIT');
    } finally {
      await app.close();
    }
  });

  it('导航摘要只查询徽标所需计数', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([{
      open_tickets: 4,
      pending_invoices: 3,
      active_jobs: 2,
      manual_review_payments: 1,
      manual_review_refunds: 5,
      as_of: '2026-07-17T08:00:00.000Z',
    }]));
    const app = makeApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/admin/navigation-summary' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        openTickets: 4,
        pendingInvoices: 3,
        activeJobs: 2,
        manualReviewPayments: 1,
        manualReviewRefunds: 5,
        asOf: '2026-07-17T08:00:00.000Z',
      });
      expect(String(mocks.poolQuery.mock.calls[0]?.[0])).not.toContain('SELECT *');
    } finally {
      await app.close();
    }
  });
});

function makeApp() {
  const app = fastify({ logger: false });
  app.register(registerAdminRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const value = error as { statusCode?: number; message?: string };
    return reply.code(value.statusCode ?? 400).send({ message: value.message });
  });
  return app;
}

function queryResult(rows: unknown[]) {
  return { rows, rowCount: rows.length };
}
