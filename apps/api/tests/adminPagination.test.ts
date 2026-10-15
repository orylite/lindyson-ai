import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  requireAdmin: vi.fn(),
  reconcileDueSubscriptions: vi.fn(),
  paginationTotal: 2,
  resourceVersion: '1',
  countQueries: 0,
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: vi.fn(),
  withReadOnlyRepeatableRead: (fn: (client: { query: typeof adminPaginationQuery }) => unknown) => (
    fn({ query: adminPaginationQuery })
  ),
}));

vi.mock('../src/auth/session.js', () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock('../src/domain/subscriptionLifecycle.js', () => ({
  reconcileDueSubscriptions: mocks.reconcileDueSubscriptions,
  reconcileSubscription: vi.fn(),
}));

vi.mock('../src/providers/volcengineBillingProvider.js', () => ({
  maybeSyncVolcengineBillingPackages: vi.fn(),
}));

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';
import {
  createFourWayCursorPage,
  parseFourWayCursorPageQuery,
} from '../src/domain/cursorPagination.js';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const firstAt = '2026-07-11T10:00:00.000Z';
const secondAt = '2026-07-11T09:00:00.000Z';

function adminPaginationQuery(sql: unknown, values?: unknown[]) {
  const text = String(sql);
  if (text.includes('admin_pagination_versions')) {
    return Promise.resolve(queryResult([{
      version: mocks.resourceVersion,
      snapshot_at: '2026-07-11T11:00:00.000000Z',
    }]));
  }
  if (text.includes('count(*)::text AS count')) {
    mocks.countQueries += 1;
    return Promise.resolve(queryResult([{ count: String(mocks.paginationTotal) }]));
  }
  return mocks.poolQuery(sql, values);
}

describe('后台核心列表精准快照分页', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.requireAdmin.mockReset();
    mocks.reconcileDueSubscriptions.mockReset();
    mocks.paginationTotal = 2;
    mocks.resourceVersion = '1';
    mocks.countQueries = 0;
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', role: 'admin' });
    mocks.reconcileDueSubscriptions.mockResolvedValue(undefined);
  });

  it.each([
    {
      path: '/api/admin/announcements',
      rows: [adminAnnouncement(firstId, firstAt), adminAnnouncement(secondId, secondAt)],
    },
    {
      path: '/api/admin/users',
      rows: [adminUser(firstId, firstAt), adminUser(secondId, secondAt)],
    },
    {
      path: '/api/admin/orders',
      rows: [adminOrder(firstId, firstAt), adminOrder(secondId, secondAt)],
    },
    {
      path: '/api/admin/invoices',
      rows: [adminInvoice(firstId, firstAt), adminInvoice(secondId, secondAt)],
    },
    {
      path: '/api/admin/tickets',
      rows: [adminTicket(firstId, firstAt), adminTicket(secondId, secondAt)],
    },
    {
      path: '/api/admin/jobs',
      rows: [adminJob(firstId, firstAt), adminJob(secondId, secondAt)],
    },
    {
      path: '/api/admin/credit-ledger',
      rows: [adminLedger(firstId, firstAt), adminLedger(secondId, secondAt)],
    },
    {
      path: '/api/admin/audit-logs',
      rows: [adminAudit(firstId, firstAt), adminAudit(secondId, secondAt)],
    },
  ])('$path 返回精准快照页码结构', async ({ path, rows }) => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult(rows));
    const app = makeApp();
    try {
      const response = await app.inject({ method: 'GET', url: `${path}?limit=1` });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(firstId);
      expect(mocks.countQueries).toBe(1);
      expect(body.pagination).toEqual({
        limit: 1,
        currentPage: 1,
        totalPages: 2,
        totalItems: 2,
        snapshotCursor: expect.any(String),
        hasPrevious: false,
        hasNext: true,
        previousCursor: null,
        nextCursor: expect.any(String),
      });
      expect(mocks.poolQuery.mock.calls.at(-1)?.[1]?.slice(0, 2)).toEqual([null, null]);
      expect(mocks.poolQuery.mock.calls.at(-1)?.[1]?.at(-1)).toBe(2);
      const sql = String(mocks.poolQuery.mock.calls.at(-1)?.[0]);
      expect(sql).toMatch(/ORDER BY[\s\S]+id DESC/);
      expect(sql).not.toContain('__pagination_total_count');
      expect(sql).toContain('AS __pagination_cursor_timestamp');
      expect(sql).not.toContain('count(*) OVER()::bigint');
      expect(sql).not.toContain('OFFSET');
      if (path === '/api/admin/tickets') {
        expect(sql).toContain('WITH paged_tickets AS MATERIALIZED');
        expect(sql).toContain('FROM paged_tickets t');
        expect(sql).toContain('LEFT JOIN LATERAL');
        expect(sql.indexOf('LIMIT $6')).toBeLessThan(sql.indexOf('FROM ticket_messages tm'));
      }
      expect(mocks.reconcileDueSubscriptions).not.toHaveBeenCalled();
      if (path === '/api/admin/jobs') {
        expect(body.items[0]).toEqual(expect.objectContaining({
          userName: '测试用户',
          model: 'seedance',
          providerRunStatus: 'provider-running',
        }));
        expect(body.items[0]).not.toHaveProperty('prompt');
        expect(body.items[0]).not.toHaveProperty('config');
        expect(body.items[0]).not.toHaveProperty('providerTaskId');
        expect(body.items[0]).not.toHaveProperty('heartbeatAt');
      }
    } finally {
      await app.close();
    }
  });

  it('下一页使用时间与 UUID 复合游标，末页不再返回游标', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      adminAudit(firstId, firstAt),
      adminAudit(secondId, secondAt),
    ]));
    const app = makeApp();
    try {
      const firstResponse = await app.inject({ method: 'GET', url: '/api/admin/audit-logs?limit=1' });
      const cursor = firstResponse.json().pagination.nextCursor as string;
      const snapshotCursor = firstResponse.json().pagination.snapshotCursor as string;
      mocks.poolQuery.mockResolvedValueOnce(queryResult([adminAudit(secondId, secondAt)]));

      const secondResponse = await app.inject({
        method: 'GET',
        url: `/api/admin/audit-logs?limit=1&position=next&cursor=${encodeURIComponent(cursor)}&snapshotCursor=${encodeURIComponent(snapshotCursor)}`,
      });

      expect(secondResponse.statusCode).toBe(200);
      expect(mocks.countQueries).toBe(1);
      expect(mocks.poolQuery.mock.calls.at(-1)?.[1]?.slice(0, 2)).toEqual([firstAt, firstId]);
      expect(secondResponse.json()).toEqual(expect.objectContaining({
        items: [expect.objectContaining({ id: secondId })],
        pagination: {
          limit: 1,
          currentPage: 2,
          totalPages: 2,
          totalItems: 2,
          snapshotCursor,
          hasPrevious: true,
          hasNext: false,
          previousCursor: expect.any(String),
          nextCursor: null,
        },
      }));
    } finally {
      await app.close();
    }
  });

  it.each([
    { path: '/api/admin/announcements', row: adminAnnouncement },
    { path: '/api/admin/users', row: adminUser },
    { path: '/api/admin/orders', row: adminOrder },
    { path: '/api/admin/invoices', row: adminInvoice },
    { path: '/api/admin/tickets', row: adminTicket },
    { path: '/api/admin/jobs', row: adminJob },
    { path: '/api/admin/credit-ledger', row: adminLedger },
    { path: '/api/admin/audit-logs', row: adminAudit },
  ])('$path 尾页使用快照精确总数并恢复成统一倒序展示', async ({ path, row }) => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      row(secondId, secondAt),
      row(firstId, firstAt),
    ], 2));
    const app = makeApp();
    try {
      const response = await app.inject({ method: 'GET', url: `${path}?limit=1&position=last` });
      expect(response.statusCode).toBe(200);
      const sql = String(mocks.poolQuery.mock.calls.at(-1)?.[0]);
      expect(sql).toMatch(/ORDER BY[\s\S]+ ASC[\s\S]+id ASC/);
      expect(sql).not.toContain('count(*) OVER()::bigint');
      expect(sql).not.toContain('__pagination_total_count');
      expect(sql).not.toContain('OFFSET');
      expect(response.json()).toEqual(expect.objectContaining({
        items: [expect.objectContaining({ id: secondId })],
        pagination: expect.objectContaining({
          currentPage: 2,
          totalPages: 2,
          totalItems: 2,
          hasPrevious: true,
          hasNext: false,
          nextCursor: null,
        }),
      }));
    } finally {
      await app.close();
    }
  });

  it('游标绑定当前筛选条件，变更筛选后拒绝复用', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([adminAudit(firstId, firstAt), adminAudit(secondId, secondAt)]));
    const app = makeApp();
    try {
      const initial = await app.inject({ method: 'GET', url: '/api/admin/audit-logs?limit=1&risk=high' });
      const cursor = initial.json().pagination.nextCursor as string;
      mocks.poolQuery.mockClear();
      const mismatched = await app.inject({
        method: 'GET',
        url: `/api/admin/audit-logs?limit=1&position=next&risk=low&cursor=${encodeURIComponent(cursor)}`,
      });
      expect(mismatched.statusCode).toBe(400);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('快照绑定管理员身份和 limit，不允许跨权限域重放', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      adminAudit(firstId, firstAt),
      adminAudit(secondId, secondAt),
    ]));
    const app = makeApp();
    try {
      const initial = await app.inject({ method: 'GET', url: '/api/admin/audit-logs?limit=1' });
      const { nextCursor, snapshotCursor } = initial.json().pagination;
      mocks.poolQuery.mockClear();

      mocks.requireAdmin.mockResolvedValueOnce({ id: 'admin-2', email: 'other@example.com', role: 'admin' });
      const crossAdmin = await app.inject({
        method: 'GET',
        url: `/api/admin/audit-logs?limit=1&position=next&cursor=${encodeURIComponent(nextCursor)}&snapshotCursor=${encodeURIComponent(snapshotCursor)}`,
      });
      const changedLimit = await app.inject({
        method: 'GET',
        url: `/api/admin/audit-logs?limit=2&position=next&cursor=${encodeURIComponent(nextCursor)}&snapshotCursor=${encodeURIComponent(snapshotCursor)}`,
      });

      expect(crossAdmin.statusCode).toBe(400);
      expect(changedLimit.statusCode).toBe(400);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('资源版本变化时返回 409，且不再执行页面查询', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      adminAudit(firstId, firstAt),
      adminAudit(secondId, secondAt),
    ]));
    const app = makeApp();
    try {
      const initial = await app.inject({ method: 'GET', url: '/api/admin/audit-logs?limit=1' });
      const { nextCursor, snapshotCursor } = initial.json().pagination;
      mocks.resourceVersion = '2';
      mocks.poolQuery.mockClear();

      const changed = await app.inject({
        method: 'GET',
        url: `/api/admin/audit-logs?limit=1&position=next&cursor=${encodeURIComponent(nextCursor)}&snapshotCursor=${encodeURIComponent(snapshotCursor)}`,
      });

      expect(changed.statusCode).toBe(409);
      expect(changed.json().message).toContain('列表已更新');
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    {
      path: '/api/admin/announcements',
      row: adminAnnouncement(firstId, firstAt),
      columns: ['title', 'content'],
    },
    {
      path: '/api/admin/users',
      row: adminUser(firstId, firstAt),
      columns: ['u.user_name', 'u.email::text', 'search_plan.name'],
    },
    {
      path: '/api/admin/orders',
      row: adminOrder(firstId, firstAt),
      columns: ['o.id::text', 'o.plan_name', 'o.merchant_order_no', 'o.provider_order_id', 'o.provider_trade_id', 'u.user_name', 'u.email::text'],
    },
    {
      path: '/api/admin/invoices',
      row: adminInvoice(firstId, firstAt),
      columns: ['ir.id::text', 'ir.order_id::text', 'ir.invoice_title', 'ir.tax_id', 'u.user_name', 'u.email::text'],
    },
    {
      path: '/api/admin/tickets',
      row: adminTicket(firstId, firstAt),
      columns: ['t.id::text', 't.title', 'u.user_name', 'u.email::text'],
    },
    {
      path: '/api/admin/jobs',
      row: adminJob(firstId, firstAt),
      columns: ['gt.id::text', 'gt.model', 'gt.prompt', 'u.user_name', 'u.email::text'],
    },
    {
      path: '/api/admin/credit-ledger',
      row: adminLedger(firstId, firstAt),
      columns: ['cl.source', 'cl.note', 'cl.related_order_id::text', 'cl.related_job_id::text', 'cl.related_asset_id::text', 'u.user_name', 'u.email::text'],
    },
    {
      path: '/api/admin/audit-logs',
      row: adminAudit(firstId, firstAt),
      columns: ['admin_email::text', 'module', 'action', 'target', 'detail'],
    },
  ])('$path 将模糊搜索拆为可命中 trigram 的参数化逐列条件', async ({ path, row, columns }) => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([row]));
    const app = makeApp();
    try {
      const response = await app.inject({ method: 'GET', url: `${path}?search=needle` });

      expect(response.statusCode).toBe(200);
      const [rawSql, values] = mocks.poolQuery.mock.calls.at(-1) ?? [];
      const sql = String(rawSql);
      expect(sql).not.toContain('concat_ws');
      expect(sql).not.toContain('needle');
      for (const column of columns) expect(sql).toContain(`${column} ILIKE`);
      expect(values).toContain('needle');
    } finally {
      await app.close();
    }
  });

  it('拒绝损坏、跨资源游标和非法 limit', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      adminAudit(firstId, firstAt),
      adminAudit(secondId, secondAt),
    ]));
    const app = makeApp();
    try {
      const initial = await app.inject({ method: 'GET', url: '/api/admin/audit-logs?limit=1' });
      const cursor = initial.json().pagination.nextCursor as string;
      mocks.poolQuery.mockClear();

      const damaged = await app.inject({ method: 'GET', url: '/api/admin/audit-logs?position=next&cursor=not-a-cursor' });
      const wrongResource = await app.inject({
        method: 'GET',
        url: `/api/admin/orders?position=next&cursor=${encodeURIComponent(cursor)}`,
      });
      const invalidLimit = await app.inject({ method: 'GET', url: '/api/admin/users?limit=0' });

      expect(damaged.statusCode).toBe(400);
      expect(damaged.json().message).toContain('分页游标无效');
      expect(wrongResource.statusCode).toBe(400);
      expect(invalidLimit.statusCode).toBe(400);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('合法旧 v2 游标即使指纹不含管理员和 limit，也返回 409 安全回首页', async () => {
    const legacyQuery = parseFourWayCursorPageQuery({
      position: 'first',
      limit: 1,
      filters: { search: '', risk: null, module: '' },
      resource: 'admin-audit-logs',
      defaultLimit: 20,
      maxLimit: 50,
    });
    const legacyPage = createFourWayCursorPage({
      rows: [
        adminAudit(firstId, firstAt),
        adminAudit(secondId, secondAt),
      ].map(row => ({
        ...row,
        __pagination_total_count: null,
        __pagination_cursor_timestamp: row.created_at,
      })),
      query: legacyQuery,
      getId: row => row.id,
      map: row => row,
    });
    const oldCursor = legacyPage.pagination.nextCursor!;
    const app = makeApp();
    try {
      mocks.poolQuery.mockClear();
      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/audit-logs?limit=1&position=next&cursor=${encodeURIComponent(oldCursor)}`,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain('分页协议已升级');
      expect(mocks.poolQuery).not.toHaveBeenCalled();

      const tamperIndex = Math.floor(oldCursor.length / 2);
      const tampered = `${oldCursor.slice(0, tamperIndex)}${oldCursor[tamperIndex] === 'a' ? 'b' : 'a'}${oldCursor.slice(tamperIndex + 1)}`;
      const tamperedResponse = await app.inject({
        method: 'GET',
        url: `/api/admin/audit-logs?limit=1&position=next&cursor=${encodeURIComponent(tampered)}`,
      });
      const crossResource = await app.inject({
        method: 'GET',
        url: `/api/admin/orders?limit=1&position=next&cursor=${encodeURIComponent(oldCursor)}`,
      });
      expect(tamperedResponse.statusCode).toBe(400);
      expect(crossResource.statusCode).toBe(400);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('后台 UUID 路径参数在进入数据库前校验', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/admin/assets/not-a-uuid' });

      expect(response.statusCode).toBe(400);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
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

function adminUser(id: string, registeredAt: string) {
  return {
    id,
    email: `${id.slice(0, 4)}@example.com`,
    user_name: '用户',
    role: 'user',
    status: 'active',
    plan_id: null,
    plan_code: null,
    plan_name: null,
    billing_cycle: 'monthly',
    main_credits: 10,
    addon_credits: 2,
    total_credits: 100,
    order_count: 3,
    ticket_count: 1,
    api_calls: 5,
    plan_cycle_started_at: '2026-07-01',
    plan_reset_at: null,
    plan_expires_at: null,
    active_subscription_order_id: null,
    registered_at: registeredAt,
    last_active_at: registeredAt,
  };
}

function adminOrder(id: string, createdAt: string) {
  return {
    id,
    user_id: firstId,
    kind: 'main',
    plan_name: '专业版',
    amount: 9900,
    billing: 'monthly',
    status: 'paid',
    invoice_status: 'unissued',
    credit_status: 'settled',
    credit_amount: 1000,
    credit_bucket: 'main',
    payment_method: '在线支付',
    payment_provider: 'manual',
    payment_way_code: null,
    payment_surface: null,
    refund_status: 'none',
    created_at: createdAt,
  };
}

function adminInvoice(id: string, requestedAt: string) {
  return { id, amount: 9900, status: 'unissued', requested_at: requestedAt };
}

function adminTicket(id: string, updatedAt: string) {
  return {
    id,
    priority: 'medium',
    status: 'open',
    sla_hours: 24,
    unread_count: 1,
    message_count: 1,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

function adminJob(id: string, createdAt: string) {
  return {
    id,
    user_id: '33333333-3333-4333-8333-333333333333',
    user_name: '测试用户',
    email: 'user@example.com',
    kind: 'video',
    model: 'seedance',
    status: 'processing',
    failure_category: null,
    credit_status: 'held',
    asset_id: null,
    asset_name: null,
    asset_source: null,
    retry_count: 0,
    active_provider_run_id: '44444444-4444-4444-8444-444444444444',
    provider_run_status: 'provider-running',
    created_at: createdAt,
  };
}

function adminLedger(id: string, createdAt: string) {
  return { id, amount: -20, balance: 80, created_at: createdAt };
}

function adminAudit(id: string, createdAt: string) {
  return { id, risk: 'low', created_at: createdAt };
}

function adminAnnouncement(id: string, publishedAt: string) {
  return {
    id,
    title: '维护公告',
    content: '维护内容',
    pinned: false,
    published_at: publishedAt,
    created_at: publishedAt,
    updated_at: publishedAt,
  };
}

function queryResult(rows: unknown[], totalCount: number | null = null) {
  const enrichedRows = rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const value = row as Record<string, unknown>;
    const timestamp = value.__pagination_cursor_timestamp
      ?? value.registered_at
      ?? value.requested_at
      ?? value.published_at
      ?? value.updated_at
      ?? value.created_at;
    if (typeof timestamp !== 'string') return row;
    return {
      __pagination_total_count: totalCount,
      __pagination_cursor_timestamp: timestamp,
      ...value,
    };
  });
  return { rowCount: enrichedRows.length, rows: enrichedRows };
}
