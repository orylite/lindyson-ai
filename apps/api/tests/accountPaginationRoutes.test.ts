import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  requireAuth: vi.fn(),
  paginationTotal: 2,
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: vi.fn(),
  withReadOnlyRepeatableRead: (fn: (client: { query: typeof mocks.poolQuery }) => unknown) => fn({ query: paginationQuery as typeof mocks.poolQuery }),
}));

const paginationQuery = (sql: unknown, values?: unknown[]) => {
  const text = String(sql);
  if (text.includes('user_pagination_versions')) {
    return Promise.resolve(result([{ version: '0', snapshot_at: '2026-07-17T11:00:00.000Z' }]));
  }
  if (text.includes('SELECT count(*)::text AS count')) {
    return Promise.resolve(result([{ count: String(mocks.paginationTotal) }]));
  }
  return mocks.poolQuery(sql, values);
};

vi.mock('../src/auth/session.js', () => ({
  requireAuth: mocks.requireAuth,
  issueAuthSession: vi.fn(),
}));

import { registerAccountRoutes } from '../src/routes/accountRoutes.js';

const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';
const FIRST_AT = '2026-07-17T10:00:00.123456Z';
const SECOND_AT = '2026-07-17T09:00:00.123455Z';

describe('用户积分流水四向分页', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.requireAuth.mockReset();
    mocks.paginationTotal = 2;
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', email: 'user@example.com', role: 'user' });
  });

  it('绑定用户和类型筛选，返回双向游标并拒绝跨筛选重放', async () => {
    mocks.poolQuery.mockResolvedValueOnce(result([
      ledgerRow(FIRST_ID, FIRST_AT),
      ledgerRow(SECOND_ID, SECOND_AT),
    ]));
    const app = makeApp();
    try {
      const first = await app.inject({
        method: 'GET',
        url: '/api/account/credit-ledger?position=first&limit=1&type=spend',
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().pagination).toEqual({
        limit: 1,
        hasPrevious: false,
        hasNext: true,
        previousCursor: null,
        nextCursor: expect.any(String),
        currentPage: 1,
        totalPages: 2,
        totalItems: 2,
        snapshotCursor: expect.any(String),
      });
      expect(mocks.poolQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC, id DESC'),
        ['user-1', null, null, 'spend', 2],
      );
      const firstSql = String(mocks.poolQuery.mock.calls[0]?.[0]);
      expect(firstSql).not.toContain('__pagination_total_count');
      expect(firstSql).toContain('AS __pagination_cursor_timestamp');
      expect(firstSql).not.toContain('count(*) OVER()::bigint');
      expect(firstSql).not.toContain('OFFSET');

      const cursor = first.json().pagination.nextCursor;
      mocks.poolQuery.mockResolvedValueOnce(result([ledgerRow(SECOND_ID, SECOND_AT)]));
      const next = await app.inject({
        method: 'GET',
        url: `/api/account/credit-ledger?position=next&limit=1&type=spend&cursor=${encodeURIComponent(cursor)}`,
      });
      expect(next.statusCode).toBe(200);
      expect(next.json().items[0].id).toBe(SECOND_ID);
      expect(next.json().pagination).toEqual({
        limit: 1,
        hasPrevious: true,
        hasNext: false,
        previousCursor: expect.any(String),
        nextCursor: null,
        currentPage: 2,
        totalPages: 2,
        totalItems: 2,
        snapshotCursor: first.json().pagination.snapshotCursor,
      });
      expect(mocks.poolQuery.mock.calls.at(-1)?.[1]).toEqual([
        'user-1', FIRST_AT, FIRST_ID, 'spend', 2,
      ]);

      mocks.poolQuery.mockClear();
      const mismatch = await app.inject({
        method: 'GET',
        url: `/api/account/credit-ledger?position=next&limit=1&type=refund&cursor=${encodeURIComponent(cursor)}`,
      });
      expect(mismatch.statusCode).toBe(400);
      expect(mismatch.json().code).toBe('INVALID_CURSOR');
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('默认页大小为 20，last 从最旧方向查询后仍按最新在前返回', async () => {
    mocks.poolQuery.mockResolvedValueOnce(result([
      ledgerRow(SECOND_ID, SECOND_AT, 2),
      ledgerRow(FIRST_ID, FIRST_AT, 2),
    ]));
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/account/credit-ledger?position=last',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().pagination.limit).toBe(20);
      expect(response.json().items.map((item: { id: string }) => item.id)).toEqual([FIRST_ID, SECOND_ID]);
      expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain('ORDER BY created_at ASC, id ASC');
      expect(String(mocks.poolQuery.mock.calls[0]?.[0])).not.toContain('count(*) OVER()::bigint');
      expect(String(mocks.poolQuery.mock.calls[0]?.[0])).not.toContain('OFFSET');
      expect(mocks.poolQuery.mock.calls[0]?.[1]?.at(-1)).toBe(21);
    } finally {
      await app.close();
    }
  });

  it('生成流水直接返回落库 attempt 快照，不额外查询任务当前状态', async () => {
    mocks.poolQuery.mockResolvedValueOnce(result([{
      ...ledgerRow(FIRST_ID, FIRST_AT),
      type: 'refund',
      settlement_status: 'refunded',
      amount: 122,
      related_job_id: '33333333-3333-4333-8333-333333333333',
      generation_snapshot: {
        attempt: 0,
        model: 'Seedance 2.5',
        durationSeconds: 15,
        resolution: '720p',
        hasReferenceVideo: false,
        reservedCredits: 122,
        settledCredits: 0,
        refundedCredits: 122,
        taskStatus: 'failed',
        creditStatus: 'refunded',
      },
    }]));
    const app = makeApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/account/credit-ledger?limit=1' });
      expect(response.statusCode).toBe(200);
      expect(response.json().items[0].generationSnapshot).toMatchObject({
        attempt: 0,
        model: 'Seedance 2.5',
        taskStatus: 'failed',
        refundedCredits: 122,
      });
      expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
      expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain('FROM credit_ledger');
      expect(String(mocks.poolQuery.mock.calls[0]?.[0])).not.toContain('JOIN generation_tasks');
    } finally {
      await app.close();
    }
  });
});

function makeApp() {
  const app = fastify({ logger: false });
  app.register(registerAccountRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const value = error as { statusCode?: number; message?: string; code?: string };
    return reply.code(value.statusCode ?? 400).send({ message: value.message, code: value.code });
  });
  return app;
}

function ledgerRow(id: string, createdAt: string, totalCount: number | null = null) {
  return {
    id,
    user_id: 'user-1',
    type: 'spend',
    bucket: 'main',
    settlement_status: 'settled',
    amount: -10,
    balance: 90,
    source: 'AI 视频生成',
    operator: 'system',
    note: '',
    related_order_id: null,
    related_job_id: null,
    related_asset_id: null,
    generation_snapshot: null,
    created_at: createdAt,
    __pagination_total_count: totalCount,
    __pagination_cursor_timestamp: createdAt,
  };
}

function result(rows: unknown[]) {
  return { rows, rowCount: rows.length };
}
