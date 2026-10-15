export interface CursorPagination {
  limit: number;
  position: PagePosition;
  hasPrevious: boolean;
  hasNext: boolean;
  previousCursor: string | null;
  nextCursor: string | null;
}

export interface CursorPage<Item> {
  items: Item[];
  pagination: CursorPagination;
}

export interface ExactCursorPagination extends CursorPagination {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  snapshotCursor: string;
}

export interface ExactCursorPage<Item> {
  items: Item[];
  pagination: ExactCursorPagination;
}

export interface CursorPageInput {
  cursor?: string | null;
  snapshotCursor?: string | null;
  limit?: number;
  position?: PagePosition;
}

export function normalizeExactCursorPagination(input: {
  limit: number;
  position?: PagePosition;
  hasPrevious: boolean;
  hasNext: boolean;
  previousCursor: string | null;
  nextCursor: string | null;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  snapshotCursor: string;
}): ExactCursorPagination {
  return {
    ...normalizeCursorPagination(input),
    currentPage: input.currentPage,
    totalPages: input.totalPages,
    totalItems: input.totalItems,
    snapshotCursor: input.snapshotCursor,
  };
}

export type PagePosition = 'first' | 'previous' | 'next' | 'last';

export const EMPTY_CURSOR_PAGINATION: CursorPagination = {
  limit: 20,
  position: 'first',
  hasPrevious: false,
  hasNext: false,
  previousCursor: null,
  nextCursor: null,
};

export function normalizeCursorPagination(input: {
  limit: number;
  position?: PagePosition;
  hasPrevious: boolean;
  hasNext: boolean;
  previousCursor: string | null;
  nextCursor: string | null;
}): CursorPagination {
  return {
    limit: input.limit,
    position: input.position ?? 'first',
    hasPrevious: input.hasPrevious,
    hasNext: input.hasNext,
    previousCursor: input.previousCursor,
    nextCursor: input.nextCursor,
  };
}
