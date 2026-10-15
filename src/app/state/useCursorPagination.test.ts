import { describe,expect,it } from 'vitest';
import type { CursorPagination } from '../api/cursor';
import { getEmptyPageRecoveryRequest } from './useCursorPagination';

const pagination: CursorPagination = {
  limit: 20,
  position: 'next',
  hasPrevious: true,
  hasNext: false,
  previousCursor: 'previous-page',
  nextCursor: null,
};

describe('游标空页恢复', () => {
  it('非首页被删空后使用响应中的 previousCursor 返回上一页', () => {
    expect(getEmptyPageRecoveryRequest(
      { limit: 20, position: 'next', cursor: 'current-page' },
      pagination,
    )).toEqual({ limit: 20, position: 'previous', cursor: 'previous-page' });
  });

  it('首页或缺少有效上一页游标时不触发恢复', () => {
    expect(getEmptyPageRecoveryRequest({ limit: 20, position: 'first' }, pagination)).toBeNull();
    expect(getEmptyPageRecoveryRequest(
      { limit: 20, position: 'last' },
      { ...pagination, hasPrevious: false, previousCursor: null },
    )).toBeNull();
  });
});
