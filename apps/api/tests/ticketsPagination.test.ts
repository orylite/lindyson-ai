import { describe, expect, it, vi } from 'vitest';
import {
  materializeExactCursorPageQuery,
  parseExactCursorPageRequest,
} from '../src/domain/cursorPagination.js';
import { listUserTickets } from '../src/domain/tickets.js';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const NEWER_ID = '11111111-1111-4111-8111-111111111111';
const OLDER_ID = '22222222-2222-4222-8222-222222222222';
const NEWER_AT = '2026-07-17T10:00:00.123456Z';
const OLDER_AT = '2026-07-17T09:00:00.123455Z';

describe('用户工单四向分页', () => {
  it('首页不计总数，并在选出当前页后才读取消息统计', async () => {
    const client = {
      query: vi.fn().mockResolvedValue(queryResult([
        ticketRow(NEWER_ID, NEWER_AT),
        ticketRow(OLDER_ID, OLDER_AT),
      ])),
    };
    const query = materializeExactCursorPageQuery(parseExactCursorPageRequest({
      position: 'first',
      limit: 1,
      filters: { userId: USER_ID, search: '', status: null, priority: null },
      resource: 'user-tickets',
      defaultLimit: 20,
      maxLimit: 50,
    }), { resourceVersion: '0', totalItems: 2, snapshotAt: SNAPSHOT_AT });

    const page = await listUserTickets(client as never, USER_ID, query);

    expect(page.items.map(item => item.id)).toEqual([NEWER_ID]);
    expect(page.pagination).toEqual({
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
    const sql = String(client.query.mock.calls[0]?.[0]);
    expect(sql).toContain('WITH paged_tickets AS MATERIALIZED');
    expect(sql).not.toContain('__pagination_total_count');
    expect(sql).not.toContain('count(*) OVER()::bigint');
    expect(sql.indexOf('LIMIT $7')).toBeLessThan(sql.indexOf('FROM ticket_messages tm'));
    expect(sql).not.toContain('OFFSET');
  });

  it('尾页在消息 LATERAL 聚合前精确计数', async () => {
    const client = {
      query: vi.fn().mockResolvedValue(queryResult([
        ticketRow(OLDER_ID, OLDER_AT, 2),
        ticketRow(NEWER_ID, NEWER_AT, 2),
      ])),
    };
    const query = materializeExactCursorPageQuery(parseExactCursorPageRequest({
      position: 'last',
      limit: 1,
      filters: { userId: USER_ID, search: '', status: null, priority: null },
      resource: 'user-tickets',
      defaultLimit: 20,
      maxLimit: 50,
    }), { resourceVersion: '0', totalItems: 2, snapshotAt: SNAPSHOT_AT });

    const page = await listUserTickets(client as never, USER_ID, query);

    expect(page.items.map(item => item.id)).toEqual([OLDER_ID]);
    expect(page.pagination).toEqual(expect.objectContaining({
      limit: 1,
      hasPrevious: true,
      hasNext: false,
      nextCursor: null,
    }));
    const sql = String(client.query.mock.calls[0]?.[0]);
    expect(sql).not.toContain('count(*) OVER()::bigint');
    expect(sql).not.toContain('OFFSET');
  });
});

const SNAPSHOT_AT = '2026-07-17T11:00:00.000000Z';

function ticketRow(id: string, updatedAt: string, totalCount: number | null = null) {
  return {
    id,
    user_id: USER_ID,
    title: '生成问题',
    user_name: '测试用户',
    email: 'user@example.com',
    priority: 'medium',
    status: 'open',
    assignee: 'unassigned',
    created_at: updatedAt,
    updated_at: updatedAt,
    sla_hours: 24,
    last_message: '请协助排查。',
    unread_count: 1,
    message_count: 1,
    last_message_author: 'user',
    last_message_at: updatedAt,
    internal_note: null,
    __pagination_total_count: totalCount,
    __pagination_cursor_timestamp: updatedAt,
  };
}

function queryResult(rows: unknown[]) {
  return { rows, rowCount: rows.length };
}
