import {
  createExactCursorPage,
  materializeExactCursorPageQuery,
  parseExactCursorPageRequest,
  type ExactCursorPageQuery,
  type ExactCursorPageRequest,
  type ExactPageMetadata,
  type FourWayPagePosition,
} from './cursorPagination.js';
import type { AssetCardSort } from '@lindyson/api-contracts';

export type AssetCardPosition = FourWayPagePosition;

interface AssetCardFilters {
  source: string | null;
  type: string | null;
  folderId: string | null;
  search: string | null;
  sort: AssetCardSort;
  comparison: '<' | '>' | null;
  queryOrder: 'ASC' | 'DESC';
}

export interface AssetCardPageRequest extends ExactCursorPageRequest, AssetCardFilters {}

export interface AssetCardPageQuery extends ExactCursorPageQuery, AssetCardFilters {}

interface RawAssetCardQuery {
  limit?: number;
  position?: AssetCardPosition;
  cursor?: string;
  snapshotCursor?: string;
  source?: string;
  type?: string;
  folderId?: string;
  search?: string;
  sort?: AssetCardSort;
}

interface AssetCardKeyRow extends ExactPageMetadata {
  id: string;
}

export function parseAssetCardPageQuery(raw: RawAssetCardQuery, userId: string): AssetCardPageRequest {
  const source = cleanOptional(raw.source);
  const type = cleanOptional(raw.type);
  const folderId = cleanOptional(raw.folderId);
  const search = cleanOptional(raw.search);
  const sort = raw.sort ?? 'created-desc';
  const page = parseExactCursorPageRequest({
    position: raw.position,
    cursor: raw.cursor,
    snapshotCursor: raw.snapshotCursor,
    limit: raw.limit,
    defaultLimit: 24,
    maxLimit: 50,
    resource: 'user-asset-cards',
    filters: {
      userId,
      source,
      type,
      folderId,
      search: search?.toLowerCase() ?? null,
      sort,
    },
  });
  const canonicalOrder = sort === 'created-asc' ? 'ASC' : 'DESC';
  const reverseQuery = page.position === 'previous' || page.position === 'last';
  const queryOrder = reverseQuery ? reverseOrder(canonicalOrder) : canonicalOrder;
  const nextComparison = canonicalOrder === 'ASC' ? '>' : '<';
  return {
    ...page,
    source,
    type,
    folderId,
    search,
    sort,
    comparison: page.position === 'previous'
      ? reverseComparison(nextComparison)
      : page.position === 'next'
        ? nextComparison
        : null,
    queryOrder,
  };
}

export function materializeAssetCardPageQuery(
  request: AssetCardPageRequest,
  options: { resourceVersion: string; totalItems?: number | string | bigint; snapshotAt: Date | string },
): AssetCardPageQuery {
  return {
    ...request,
    ...materializeExactCursorPageQuery(request, options),
  };
}

export function createAssetCardPage<Row extends AssetCardKeyRow, Item>(input: {
  rows: Row[];
  query: AssetCardPageQuery;
  map: (row: Row) => Item;
}) {
  const page = createExactCursorPage({
    rows: input.rows,
    query: input.query,
    getId: row => row.id,
    map: input.map,
  });
  return {
    ...page,
    pagination: {
      ...page.pagination,
      position: input.query.position,
    },
  };
}

function cleanOptional(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned || null;
}

function reverseOrder(order: 'ASC' | 'DESC') {
  return order === 'ASC' ? 'DESC' : 'ASC';
}

function reverseComparison(comparison: '<' | '>') {
  return comparison === '<' ? '>' : '<';
}
