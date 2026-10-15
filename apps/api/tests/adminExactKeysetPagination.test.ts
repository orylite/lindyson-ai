import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { deriveSigningKey } from '../src/config/env.js';
import type { DbClient } from '../src/db/pool.js';
import {
  adminExactPageTotalCountSql,
  createAdminExactKeysetPage,
  parseAdminExactKeysetQuery,
} from '../src/domain/adminExactKeysetPagination.js';

function client(version = '7') {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ version }], rowCount: 1 }),
    release: vi.fn(),
  } as unknown as DbClient;
}

function row(id: string, count: number | null = null) {
  return { id, __pagination_total_count: count };
}

function legacyCursor(prefix: string, payload: Record<string, unknown>, signatureOverride?: string) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return Buffer.from(JSON.stringify({
    payload: encodedPayload,
    signature: signatureOverride ?? createHmac('sha256', deriveSigningKey('admin-keyset-pagination'))
      .update(`${prefix}:${encodedPayload}`).digest('hex'),
  }), 'utf8').toString('base64url');
}

describe('后台成本精准键集分页', () => {
  it('首次精确计数并签发 41 条 / 20 条一页的页码快照', async () => {
    const query = await parseAdminExactKeysetQuery(client(), {
      rawQuery: { position: 'first', limit: 20 },
      filters: { range: 'month', month: '2026-08' },
      resource: 'admin-api-cost-tasks',
      versionResource: 'admin:cost-video',
      asOf: '2026-08-14T00:00:00.000Z',
    });
    expect(adminExactPageTotalCountSql(query)).toBe('count(*) OVER()::bigint');
    const page = createAdminExactKeysetPage({
      query,
      rows: Array.from({ length: 21 }, (_, index) => row(String(index + 1), 41)),
      keyOf: item => [item.id],
      map: item => item.id,
    });
    expect(page.pagination).toMatchObject({
      currentPage: 1, totalPages: 3, totalItems: 41,
      hasPrevious: false, hasNext: true,
      snapshotCursor: expect.any(String), nextCursor: expect.any(String),
    });
    expect(page.pagination.snapshotCursor.length).toBeLessThanOrEqual(1024);
    expect(page.pagination.nextCursor!.length).toBeLessThanOrEqual(1024);
  });

  it('支持 41/20 的 1→3→2→1、多列键与余数尾页', async () => {
    const input = {
      filters: { range: 'all' }, resource: 'admin-api-cost-attempts',
      versionResource: 'admin:cost-video', asOf: '2026-08-14T00:00:00.000Z',
      authorizationScope: 'admin:00000000-0000-4000-8000-000000000001:role:admin',
    } as const;
    const firstQuery = await parseAdminExactKeysetQuery(client(), {
      ...input, rawQuery: { position: 'first', limit: 20 },
    });
    const first = createAdminExactKeysetPage({
      query: firstQuery,
      rows: Array.from({ length: 21 }, (_, index) => row(String(index + 1), 41)),
      keyOf: item => ['100.000000', 42, '2026-08-14T00:00:00.000000Z', item.id],
      map: item => item.id,
    });
    const lastQuery = await parseAdminExactKeysetQuery(client(), {
      ...input, rawQuery: { position: 'last', limit: 20, snapshotCursor: first.pagination.snapshotCursor },
    });
    const last = createAdminExactKeysetPage({
      query: lastQuery, rows: [row('41')],
      keyOf: item => ['1.000000', 1, '2026-08-01T00:00:00.000000Z', item.id], map: item => item.id,
    });
    expect(last.pagination).toMatchObject({ currentPage: 3, totalPages: 3, totalItems: 41 });
    const previousQuery = await parseAdminExactKeysetQuery(client(), {
      ...input,
      rawQuery: {
        position: 'previous', limit: 20, cursor: last.pagination.previousCursor,
        snapshotCursor: last.pagination.snapshotCursor,
      },
    });
    const second = createAdminExactKeysetPage({
      query: previousQuery, rows: Array.from({ length: 20 }, (_, index) => row(String(index + 21))),
      keyOf: item => ['50.000000', 20, '2026-08-07T00:00:00.000000Z', item.id], map: item => item.id,
    });
    expect(second.pagination.currentPage).toBe(2);
    const homeQuery = await parseAdminExactKeysetQuery(client(), {
      ...input, rawQuery: { position: 'first', limit: 20, snapshotCursor: second.pagination.snapshotCursor },
    });
    const home = createAdminExactKeysetPage({
      query: homeQuery, rows: Array.from({ length: 20 }, (_, index) => row(String(index + 1))),
      keyOf: item => [item.id], map: item => item.id,
    });
    expect(home.pagination.currentPage).toBe(1);
    expect(first.pagination.nextCursor!.length).toBeLessThanOrEqual(1024);
  });

  it('空集合、单页与整页返回稳定精准元数据', async () => {
    for (const [total, expectedPages] of [[0, 0], [1, 1], [20, 1]] as const) {
      const query = await parseAdminExactKeysetQuery(client(), {
        rawQuery: { limit: 20 }, filters: { total }, resource: 'admin-provider-operational-usage',
        versionResource: 'admin:provider-billing', asOf: '2026-08-14T00:00:00.000Z',
      });
      const page = createAdminExactKeysetPage({
        query,
        rows: Array.from({ length: total }, (_, index) => row(String(index + 1), total)),
        keyOf: item => [item.id], map: item => item.id, totalItems: total,
      });
      expect(page.pagination).toMatchObject({
        currentPage: total === 0 ? 0 : 1, totalPages: expectedPages, totalItems: total,
      });
    }
  });

  it('HMAC 篡改与跨资源重放返回 400，合法旧 v2/v3 同资源才返回 409', async () => {
    const query = await parseAdminExactKeysetQuery(client(), {
      rawQuery: { limit: 20 }, filters: {}, resource: 'admin-api-cost-tasks',
      versionResource: 'admin:cost-video', asOf: '2026-08-14T00:00:00.000Z',
    });
    const page = createAdminExactKeysetPage({
      query, rows: [row('1', 1)], keyOf: item => [item.id], map: item => item.id,
    });
    const tampered = `${page.pagination.snapshotCursor.slice(0, -1)}x`;
    await expect(parseAdminExactKeysetQuery(client(), {
      rawQuery: { limit: 20, snapshotCursor: tampered }, filters: {}, resource: 'admin-api-cost-tasks',
      versionResource: 'admin:cost-video', asOf: '2026-08-14T00:00:00.000Z',
    })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });
    await expect(parseAdminExactKeysetQuery(client(), {
      rawQuery: { limit: 20, snapshotCursor: page.pagination.snapshotCursor }, filters: {},
      resource: 'admin-api-cost-users-v2', versionResource: 'admin:cost-video',
      asOf: '2026-08-14T00:00:00.000Z',
    })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });

    const legacyPayload = {
      version: 3, resource: 'admin-api-cost-tasks', fingerprint: '0'.repeat(64),
      asOf: '2026-08-14T00:00:00.000Z', key: ['x'],
    };
    const legacy = legacyCursor('admin-api-cost-keyset-v3', legacyPayload);
    await expect(parseAdminExactKeysetQuery(client(), {
      rawQuery: { position: 'next', limit: 20, cursor: legacy }, filters: {},
      resource: 'admin-api-cost-tasks', versionResource: 'admin:cost-video',
      asOf: '2026-08-14T00:00:00.000Z',
    })).rejects.toMatchObject({ statusCode: 409, code: 'PAGINATION_SNAPSHOT_CHANGED' });

    const legacyV2Payload = {
      version: 2, resource: 'admin-image-cost-tasks', fingerprint: '0'.repeat(64),
      timestamp: '2026-08-14T00:00:00.000Z', id: '00000000-0000-4000-8000-000000000001',
    };
    const legacyV2 = legacyCursor('cursor-pagination-v2', legacyV2Payload);
    await expect(parseAdminExactKeysetQuery(client(), {
      rawQuery: { position: 'next', limit: 20, cursor: legacyV2 }, filters: {},
      resource: 'admin-image-cost-tasks', versionResource: 'admin:cost-image',
      asOf: '2026-08-14T00:00:00.000Z',
    })).rejects.toMatchObject({ statusCode: 409, code: 'PAGINATION_SNAPSHOT_CHANGED' });

    await expect(parseAdminExactKeysetQuery(client(), {
      rawQuery: {
        position: 'next', limit: 20,
        cursor: legacyCursor('cursor-pagination-v2', legacyV2Payload, '0'.repeat(64)),
      },
      filters: {}, resource: 'admin-image-cost-tasks', versionResource: 'admin:cost-image',
      asOf: '2026-08-14T00:00:00.000Z',
    })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });

    await expect(parseAdminExactKeysetQuery(client(), {
      rawQuery: { position: 'next', limit: 20, cursor: legacy }, filters: {},
      resource: 'admin-api-cost-users', versionResource: 'admin:cost-video',
      asOf: '2026-08-14T00:00:00.000Z',
    })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });
  });

  it('后续页复用签名总数且资源版本变化返回 409', async () => {
    const firstQuery = await parseAdminExactKeysetQuery(client(), {
      rawQuery: { position: 'first', limit: 2 },
      filters: { search: null }, resource: 'admin-image-cost-tasks',
      versionResource: 'admin:cost-image', asOf: '2026-08-14T00:00:00.000Z',
    });
    const first = createAdminExactKeysetPage({
      query: firstQuery,
      rows: [row('1', 3), row('2', 3), row('3', 3)],
      keyOf: item => [item.id], map: item => item.id,
    });
    const nextQuery = await parseAdminExactKeysetQuery(client(), {
      rawQuery: {
        position: 'next', limit: 2, cursor: first.pagination.nextCursor,
        snapshotCursor: first.pagination.snapshotCursor,
      },
      filters: { search: null }, resource: 'admin-image-cost-tasks',
      versionResource: 'admin:cost-image', asOf: '2026-08-14T00:00:00.000Z',
    });
    expect(adminExactPageTotalCountSql(nextQuery)).toBe('NULL::bigint');
    expect(() => createAdminExactKeysetPage({
      query: nextQuery, rows: [row('3')], keyOf: item => [item.id], map: item => item.id,
    })).not.toThrow();

    await expect(parseAdminExactKeysetQuery(client('8'), {
      rawQuery: {
        position: 'next', limit: 2, cursor: first.pagination.nextCursor,
        snapshotCursor: first.pagination.snapshotCursor,
      },
      filters: { search: null }, resource: 'admin-image-cost-tasks',
      versionResource: 'admin:cost-image', asOf: '2026-08-14T00:00:00.000Z',
    })).rejects.toMatchObject({ statusCode: 409, code: 'PAGINATION_SNAPSHOT_CHANGED' });
  });

  it('筛选、limit 与授权范围重放均被拒绝', async () => {
    const base = {
      filters: { search: null }, resource: 'admin-provider-billing-details',
      versionResource: 'admin:provider-billing', asOf: '2026-08-14T00:00:00.000Z',
    } as const;
    const query = await parseAdminExactKeysetQuery(client(), {
      ...base, rawQuery: { limit: 20 }, authorizationScope: 'role:admin',
    });
    const page = createAdminExactKeysetPage({
      query, rows: [row('1', 1)], keyOf: item => [item.id], map: item => item.id,
    });
    await expect(parseAdminExactKeysetQuery(client(), {
      ...base, filters: { search: 'changed' }, rawQuery: { limit: 20, snapshotCursor: page.pagination.snapshotCursor },
    })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });
    await expect(parseAdminExactKeysetQuery(client(), {
      ...base, rawQuery: { limit: 10, snapshotCursor: page.pagination.snapshotCursor },
    })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });
    await expect(parseAdminExactKeysetQuery(client(), {
      ...base, rawQuery: { limit: 20, snapshotCursor: page.pagination.snapshotCursor },
      authorizationScope: 'role:readonly-admin',
    })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });
  });

  it('异常超长边界在服务端失败关闭，不产生超过契约上限的令牌', async () => {
    const query = await parseAdminExactKeysetQuery(client(), {
      rawQuery: { limit: 1 }, filters: {}, resource: 'admin-api-cost-settlement',
      versionResource: 'admin:cost-video', asOf: '2026-08-14T00:00:00.000Z',
    });
    expect(() => createAdminExactKeysetPage({
      query,
      rows: [row('first', 2), row('overflow', 2)],
      keyOf: item => ['1.000000', '2026-08-14', item.id.repeat(1200)],
      map: item => item.id,
    })).toThrowError(expect.objectContaining({
      statusCode: 500, code: 'PAGINATION_INVARIANT_VIOLATION',
    }));
  });
});
