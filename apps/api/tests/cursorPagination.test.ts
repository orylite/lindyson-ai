import { describe, expect, it } from 'vitest';
import {
  createExactCursorPage,
  createFourWayCursorPage,
  exactPageMetadataColumns,
  fourWayPageMetadataColumns,
  materializeExactCursorPageQuery,
  parseExactCursorPageRequest,
  parseFourWayCursorPageQuery,
  type FourWayCursorPageQuery,
  type FourWayPageMetadata,
} from '../src/domain/cursorPagination.js';

interface TestRow extends FourWayPageMetadata {
  id: string;
  index: number;
}

describe('四向游标分页核心规则', () => {
  it.each([
    { total: 0, expected: [] },
    { total: 10, expected: range(1, 10) },
    { total: 20, expected: range(1, 20) },
    { total: 21, expected: [21] },
    { total: 40, expected: range(21, 40) },
    { total: 50, expected: range(41, 50) },
  ])('总数 $total、每页 20 条时返回标准尾页', ({ total, expected }) => {
    const query = pageQuery('last', 20);
    const rows = rangeDescending(total, Math.max(1, total - 20))
      .map(index => testRow(index, String(total)));

    const page = createFourWayCursorPage({
      rows,
      query,
      getId: row => row.id,
      map: row => row.index,
    });

    expect(page.items).toEqual(expected);
    expect(page.pagination).toMatchObject({
      limit: 20,
      hasPrevious: total > expected.length,
      hasNext: false,
      nextCursor: null,
    });
  });

  it('50/20 从尾页向前依次返回 10、20、20 条，且无重复、遗漏或乱序', () => {
    const last = createFourWayCursorPage({
      rows: rangeDescending(50, 30).map(index => testRow(index, '50')),
      query: pageQuery('last', 20),
      getId: row => row.id,
      map: row => row.index,
    });
    expect(last.items).toEqual(range(41, 50));
    expect(last.pagination.previousCursor).toEqual(expect.any(String));

    const middleQuery = pageQuery('previous', 20, last.pagination.previousCursor!);
    const middle = createFourWayCursorPage({
      rows: rangeDescending(40, 20).map(index => testRow(index)),
      query: middleQuery,
      getId: row => row.id,
      map: row => row.index,
    });
    expect(middle.items).toEqual(range(21, 40));
    expect(middle.pagination).toMatchObject({ hasPrevious: true, hasNext: true });

    const firstQuery = pageQuery('previous', 20, middle.pagination.previousCursor!);
    const first = createFourWayCursorPage({
      rows: rangeDescending(20, 1).map(index => testRow(index)),
      query: firstQuery,
      getId: row => row.id,
      map: row => row.index,
    });
    expect(first.items).toEqual(range(1, 20));
    expect(first.pagination).toMatchObject({ hasPrevious: false, hasNext: true });

    const completeOrder = [...first.items, ...middle.items, ...last.items];
    expect(completeOrder).toEqual(range(1, 50));
    expect(new Set(completeOrder).size).toBe(50);
  });

  it('非空尾页缺少精确总数元数据时触发服务端不变量错误', () => {
    let thrown: unknown;
    try {
      createFourWayCursorPage({
        rows: [testRow(1)],
        query: pageQuery('last', 20),
        getId: row => row.id,
        map: row => row.index,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      statusCode: 500,
      code: 'PAGINATION_INVARIANT_VIOLATION',
      message: '尾页缺少精确总数元数据',
    });
  });

  it('完整保留微秒边界，并用 UUID 稳定区分完全相同的时间', () => {
    const highId = '22222222-2222-4222-8222-222222222222';
    const lowId = '11111111-1111-4111-8111-111111111111';
    const olderId = '33333333-3333-4333-8333-333333333333';
    const sameTimestamp = '2026-07-17T00:00:00.123456Z';
    const olderTimestamp = '2026-07-17T00:00:00.123455Z';
    const high = exactRow(highId, 1, sameTimestamp);
    const low = exactRow(lowId, 2, sameTimestamp);
    const older = exactRow(olderId, 3, olderTimestamp);

    const first = createFourWayCursorPage({
      rows: [high, low],
      query: pageQuery('first', 1),
      getId: row => row.id,
      map: row => row.id,
    });
    const secondQuery = pageQuery('next', 1, first.pagination.nextCursor!);
    expect(secondQuery.cursor).toEqual({ timestamp: sameTimestamp, id: highId });

    const second = createFourWayCursorPage({
      rows: [low, older],
      query: secondQuery,
      getId: row => row.id,
      map: row => row.id,
    });
    const thirdQuery = pageQuery('next', 1, second.pagination.nextCursor!);
    expect(thirdQuery.cursor).toEqual({ timestamp: sameTimestamp, id: lowId });

    const third = createFourWayCursorPage({
      rows: [older],
      query: thirdQuery,
      getId: row => row.id,
      map: row => row.id,
    });
    expect([...first.items, ...second.items, ...third.items]).toEqual([highId, lowId, olderId]);

    const backwardQuery = pageQuery('previous', 1, third.pagination.previousCursor!);
    expect(backwardQuery.cursor).toEqual({ timestamp: olderTimestamp, id: olderId });
    const backward = createFourWayCursorPage({
      rows: [low, high],
      query: backwardQuery,
      getId: row => row.id,
      map: row => row.id,
    });
    expect(backward.items).toEqual([lowId]);

    const backToFirstQuery = pageQuery('previous', 1, backward.pagination.previousCursor!);
    expect(backToFirstQuery.cursor).toEqual({ timestamp: sameTimestamp, id: lowId });
    const backToFirst = createFourWayCursorPage({
      rows: [high],
      query: backToFirstQuery,
      getId: row => row.id,
      map: row => row.id,
    });
    expect(backToFirst.items).toEqual([highId]);
  });

  it('只有 last SQL 元数据投影包含精确计数，所有方向都不使用 OFFSET', () => {
    for (const position of ['first', 'previous', 'next', 'last'] as const) {
      const sql = fourWayPageMetadataColumns(
        pageQuery(position, 20, position === 'previous' || position === 'next' ? seedCursor() : undefined),
        'records.created_at',
      );
      expect(sql).not.toMatch(/\bOFFSET\b/i);
      expect(sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
      if (position === 'last') expect(sql).toContain('count(*) OVER()::bigint');
      else expect(sql).toContain('NULL::bigint');
    }
  });
});

describe('用户端 v3 精准快照分页', () => {
  it('41 条、每页 7 条时按 1 / 6 → 6 / 6 → 5 / 6 → 1 / 6 导航', () => {
    const firstQuery = exactQuery({ position: 'first', limit: 7, totalItems: 41 });
    const first = createExactCursorPage({
      rows: rangeDescending(41, 34).map(index => testRow(index)),
      query: firstQuery,
      getId: row => row.id,
      map: row => row.index,
    });
    expect(first.pagination).toMatchObject({ currentPage: 1, totalPages: 6, totalItems: 41 });

    const lastQuery = exactQuery({
      position: 'last',
      limit: 7,
      snapshotCursor: first.pagination.snapshotCursor,
    });
    const last = createExactCursorPage({
      rows: rangeDescending(41, 35).map(index => testRow(index)),
      query: lastQuery,
      getId: row => row.id,
      map: row => row.index,
    });
    expect(last.items).toEqual(range(36, 41));
    expect(last.pagination).toMatchObject({ currentPage: 6, totalPages: 6 });

    const previousQuery = exactQuery({
      position: 'previous',
      limit: 7,
      snapshotCursor: last.pagination.snapshotCursor,
      cursor: last.pagination.previousCursor!,
    });
    const previous = createExactCursorPage({
      rows: rangeDescending(35, 29).map(index => testRow(index)),
      query: previousQuery,
      getId: row => row.id,
      map: row => row.index,
    });
    expect(previous.items).toEqual(range(29, 35));
    expect(previous.pagination).toMatchObject({ currentPage: 5, totalPages: 6 });

    const backToFirst = exactQuery({
      position: 'first',
      limit: 7,
      snapshotCursor: previous.pagination.snapshotCursor,
    });
    expect(backToFirst).toMatchObject({ currentPage: 1, totalPages: 6, totalItems: 41 });
    expect(first.pagination.snapshotCursor.length).toBeLessThanOrEqual(1024);
    expect(first.pagination.nextCursor!.length).toBeLessThanOrEqual(1024);
  });

  it.each([
    { totalItems: 0, currentPage: 0, totalPages: 0 },
    { totalItems: 7, currentPage: 1, totalPages: 1 },
    { totalItems: 8, currentPage: 1, totalPages: 2 },
    { totalItems: 14, currentPage: 1, totalPages: 2 },
  ])('精确计算 $totalItems 条记录的页码', expected => {
    const query = exactQuery({ position: 'first', limit: 7, totalItems: expected.totalItems });
    expect(query).toMatchObject(expected);
    const page = createExactCursorPage({
      rows: rangeDescending(expected.totalItems, Math.max(1, expected.totalItems - 7))
        .map(index => testRow(index)),
      query,
      getId: row => row.id,
      map: row => row.index,
    });
    expect(page.pagination).toMatchObject(expected);
  });

  it('拒绝篡改、跨筛选、跨 limit 重放，并在资源版本变化时返回 409', () => {
    const first = exactQuery({ position: 'first', limit: 7, totalItems: 41 });
    const snapshotCursor = first.snapshotCursor;
    const tamperIndex = Math.floor(snapshotCursor.length / 2);
    const tampered = `${snapshotCursor.slice(0, tamperIndex)}${snapshotCursor[tamperIndex] === 'a' ? 'b' : 'a'}${snapshotCursor.slice(tamperIndex + 1)}`;

    expect(() => exactRequest({ position: 'first', limit: 7, snapshotCursor: tampered }))
      .toThrow(expect.objectContaining({ statusCode: 400, code: 'INVALID_CURSOR' }));
    expect(() => parseExactCursorPageRequest({
      position: 'first',
      limit: 7,
      snapshotCursor,
      filters: { ownerId: 'another-user' },
      resource: 'pagination-unit-test',
      defaultLimit: 7,
      maxLimit: 50,
    })).toThrow(expect.objectContaining({ statusCode: 400, code: 'INVALID_CURSOR' }));
    expect(() => exactRequest({ position: 'first', limit: 8, snapshotCursor }))
      .toThrow(expect.objectContaining({ statusCode: 400, code: 'INVALID_CURSOR' }));

    const request = exactRequest({ position: 'first', limit: 7, snapshotCursor });
    expect(() => materializeExactCursorPageQuery(request, {
      resourceVersion: '8',
      snapshotAt: SNAPSHOT_AT,
    })).toThrow(expect.objectContaining({ statusCode: 409, code: 'PAGINATION_SNAPSHOT_CHANGED' }));
  });

  it('精准 SQL 元数据只读取键集时间且从不使用 OFFSET', () => {
    const sql = exactPageMetadataColumns('records.created_at');
    expect(sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    expect(sql).not.toContain('count(*)');
    expect(sql).not.toMatch(/\bOFFSET\b/i);
  });
});

const SNAPSHOT_AT = '2026-07-17T11:00:00.000000Z';

function exactRequest(input: {
  position: FourWayCursorPageQuery['position'];
  limit: number;
  cursor?: string;
  snapshotCursor?: string;
}) {
  return parseExactCursorPageRequest({
    ...input,
    filters: { ownerId: 'pagination-unit-test' },
    resource: 'pagination-unit-test',
    defaultLimit: 7,
    maxLimit: 50,
  });
}

function exactQuery(input: {
  position: FourWayCursorPageQuery['position'];
  limit: number;
  totalItems?: number;
  cursor?: string;
  snapshotCursor?: string;
}) {
  return materializeExactCursorPageQuery(exactRequest(input), {
    resourceVersion: '7',
    totalItems: input.totalItems,
    snapshotAt: SNAPSHOT_AT,
  });
}

function pageQuery(
  position: FourWayCursorPageQuery['position'],
  limit: number,
  cursor?: string,
) {
  return parseFourWayCursorPageQuery({
    position,
    cursor,
    limit,
    filters: { ownerId: 'pagination-unit-test' },
    resource: 'pagination-unit-test',
    defaultLimit: 20,
    maxLimit: 50,
  });
}

function testRow(index: number, totalCount: string | null = null): TestRow {
  const seconds = String(60 - index).padStart(2, '0');
  return exactRow(
    `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    index,
    `2026-07-17T00:00:${seconds}.123456Z`,
    totalCount,
  );
}

function exactRow(
  id: string,
  index: number,
  timestamp: string,
  totalCount: string | null = null,
): TestRow {
  return {
    id,
    index,
    __pagination_total_count: totalCount,
    __pagination_cursor_timestamp: timestamp,
  };
}

function range(start: number, end: number) {
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

function rangeDescending(start: number, end: number) {
  if (start < end) return [];
  return Array.from({ length: start - end + 1 }, (_, offset) => start - offset);
}

function seedCursor() {
  const first = createFourWayCursorPage({
    rows: [testRow(1), testRow(2)],
    query: pageQuery('first', 1),
    getId: row => row.id,
    map: row => row.index,
  });
  return first.pagination.nextCursor!;
}
