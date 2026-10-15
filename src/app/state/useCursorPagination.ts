import { useCallback,useState } from 'react';
import type { CursorPageInput,CursorPagination,ExactCursorPagination,PagePosition } from '../api/cursor';

export type CursorPageRequest = Required<Pick<CursorPageInput, 'limit' | 'position'>> & {
  cursor?: string;
  snapshotCursor?: string;
  revision?: number;
};

export function useCursorPagination(limit: number) {
  const [request, setRequest] = useState<CursorPageRequest>({
    limit,
    position: 'first',
    cursor: undefined,
  });

  const reset = useCallback(() => {
    setRequest(current => ({
      limit,
      position: 'first',
      cursor: undefined,
      revision: (current.revision ?? 0) + 1,
    }));
  }, [limit]);

  const navigate = useCallback((position: PagePosition, pagination?: CursorPagination) => {
    const snapshotCursor = readSnapshotCursor(pagination);
    if (position === 'first' || position === 'last') {
      setRequest(current => ({
        limit,
        position,
        cursor: undefined,
        snapshotCursor,
        revision: current.revision,
      }));
      return;
    }
    const cursor = position === 'previous' ? pagination?.previousCursor : pagination?.nextCursor;
    if (!cursor) return;
    setRequest(current => ({
      limit,
      position,
      cursor,
      snapshotCursor,
      revision: current.revision,
    }));
  }, [limit]);

  const recoverEmptyPage = useCallback((pagination: CursorPagination) => {
    setRequest(current => {
      return getEmptyPageRecoveryRequest(current, pagination) ?? current;
    });
  }, []);

  const adoptSnapshot = useCallback((pagination: ExactCursorPagination) => {
    setRequest(current => current.snapshotCursor === pagination.snapshotCursor
      ? current
      : { ...current, snapshotCursor: pagination.snapshotCursor });
  }, []);

  return { request, reset, navigate, recoverEmptyPage, adoptSnapshot };
}

export function getEmptyPageRecoveryRequest(
  request: CursorPageRequest,
  pagination: CursorPagination,
): CursorPageRequest | null {
  if (request.position === 'first' || !pagination.hasPrevious || !pagination.previousCursor) return null;
  return {
    limit: request.limit,
    position: 'previous',
    cursor: pagination.previousCursor,
    snapshotCursor: readSnapshotCursor(pagination),
    revision: request.revision,
  };
}

/** 快照令牌不改变用户所处页；采用快照后不应额外请求同一页。 */
export function cursorPageRequestIdentity(request: CursorPageRequest) {
  return {
    limit: request.limit,
    position: request.position,
    cursor: request.cursor,
    revision: request.revision ?? 0,
  };
}

function readSnapshotCursor(pagination?: CursorPagination) {
  const value = (pagination as Partial<ExactCursorPagination> | undefined)?.snapshotCursor;
  return typeof value === 'string' && value ? value : undefined;
}
