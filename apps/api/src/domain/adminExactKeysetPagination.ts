import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import type { DbClient } from '../db/pool.js';
import { canonicalTailSize, normalizeCursorTimestamp } from './cursorPagination.js';

export type AdminExactPagePosition = 'first' | 'previous' | 'next' | 'last';
export type AdminExactKey = Array<string | number | null>;

interface AdminExactSnapshotCore {
  version: 4;
  resource: string;
  fingerprint: string;
  limit: number;
  asOf: string;
  versionResource: string;
  resourceVersion: string;
  totalItems: number;
}

interface AdminExactSnapshotCursor extends AdminExactSnapshotCore {
  kind: 'snapshot';
}

interface AdminExactBoundaryCursor extends AdminExactSnapshotCore {
  kind: 'boundary';
  direction: 'previous' | 'next';
  targetPage: number;
  key: AdminExactKey;
}

export interface AdminExactKeysetQuery<Filters> {
  limit: number;
  position: AdminExactPagePosition;
  reverseQuery: boolean;
  filters: Filters;
  resource: string;
  fingerprint: string;
  asOf: string;
  authorizationScope: string;
  versionResource: string;
  resourceVersion: string;
  snapshot: AdminExactSnapshotCursor | null;
  cursor: AdminExactBoundaryCursor | null;
}

export interface AdminExactPageMetadata {
  __pagination_total_count: string | number | bigint | null;
}

export interface AdminExactTimestampPageMetadata extends AdminExactPageMetadata {
  __pagination_cursor_timestamp: string;
}

interface AdminExactPagePagination {
  limit: number;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  snapshotCursor: string;
  hasPrevious: boolean;
  hasNext: boolean;
  previousCursor: string | null;
  nextCursor: string | null;
}

export async function parseAdminExactKeysetQuery<Filters>(client: DbClient, input: {
  rawQuery: unknown;
  filters: Filters;
  fingerprintFilters?: unknown;
  resource: string;
  versionResource: string;
  asOf: string;
  authorizationScope?: string;
  defaultLimit?: number;
  maxLimit?: number;
}): Promise<AdminExactKeysetQuery<Filters>> {
  const raw = input.rawQuery && typeof input.rawQuery === 'object'
    ? input.rawQuery as Record<string, unknown>
    : {};
  const maxLimit = input.maxLimit ?? 50;
  const authorizationScope = input.authorizationScope ?? 'role:admin';
  const defaultLimit = input.defaultLimit ?? Math.min(20, maxLimit);
  const rawLimit = raw.limit;
  const limit = rawLimit === undefined ? defaultLimit : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw cursorError('分页数量无效', 'INVALID_PAGE_LIMIT', 400);
  }

  const rawPosition = raw.position;
  if (rawPosition !== undefined && rawPosition !== 'first' && rawPosition !== 'previous'
    && rawPosition !== 'next' && rawPosition !== 'last') {
    throw cursorError('分页位置无效', 'INVALID_CURSOR', 400);
  }
  const position = (rawPosition ?? 'first') as AdminExactPagePosition;
  const fingerprint = createHash('sha256')
    .update(stableStringify({ authorizationScope, filters: input.fingerprintFilters ?? input.filters }))
    .digest('hex');
  const snapshot = typeof raw.snapshotCursor === 'string'
    ? decodeAdminExactSnapshotCursor(raw.snapshotCursor, input.resource, fingerprint, limit)
    : null;
  const cursor = typeof raw.cursor === 'string'
    ? decodeAdminExactBoundaryCursor(raw.cursor, input.resource, fingerprint, limit)
    : null;

  const needsBoundary = position === 'previous' || position === 'next';
  if (needsBoundary && !cursor) throw cursorError('翻页操作缺少游标', 'INVALID_CURSOR', 400);
  if (!needsBoundary && cursor) throw cursorError('首页或尾页不能携带游标', 'INVALID_CURSOR', 400);
  if (cursor && cursor.direction !== position) {
    throw cursorError('分页游标方向不一致', 'INVALID_CURSOR', 400);
  }
  if (snapshot && cursor && !sameSnapshot(snapshot, cursor)) throw paginationSnapshotChangedError();
  const effectiveSnapshot = snapshot ?? (cursor ? snapshotFromBoundary(cursor) : null);
  // 后续页默认沿用已签名快照时间；只有请求明确携带 asOf 时才校验漂移。
  // 这样保留旧成本游标只传 cursor 的调用方式，也避免每次 resolveAsOf() 产生新时间。
  const hasExplicitAsOf = typeof raw.asOf === 'string' && raw.asOf.trim().length > 0;
  if (hasExplicitAsOf && effectiveSnapshot && effectiveSnapshot.asOf !== input.asOf) {
    throw paginationSnapshotChangedError();
  }
  const effectiveAsOf = effectiveSnapshot?.asOf ?? input.asOf;

  // 路由始终传真实 PoolClient；不具备连接身份的轻量 domain stub 保持旧测试可用。
  const isDatabaseClient = 'release' in client || 'connect' in client;
  let resourceVersion = '0';
  if (isDatabaseClient) {
    const versionResult = await client.query<{ version: string }>(
      `SELECT COALESCE((
         SELECT version::text FROM admin_cost_pagination_versions WHERE resource = $1
       ), '0') AS version`,
      [input.versionResource],
    );
    resourceVersion = String(versionResult.rows[0]?.version ?? '0');
  }
  if (effectiveSnapshot && (effectiveSnapshot.versionResource !== input.versionResource
    || effectiveSnapshot.resourceVersion !== resourceVersion)) throw paginationSnapshotChangedError();
  if (cursor && (cursor.versionResource !== input.versionResource
    || cursor.resourceVersion !== resourceVersion)) throw paginationSnapshotChangedError();

  return {
    limit,
    position,
    reverseQuery: position === 'previous' || position === 'last',
    filters: input.filters,
    resource: input.resource,
    fingerprint,
    asOf: effectiveAsOf,
    authorizationScope,
    versionResource: input.versionResource,
    resourceVersion,
    snapshot: effectiveSnapshot,
    cursor,
  };
}

/** 新快照在当前只读事务内精确计数；后续页只使用已签名总数。 */
export function adminExactPageTotalCountSql<Filters>(query: AdminExactKeysetQuery<Filters>) {
  return query.snapshot ? 'NULL::bigint' : 'count(*) OVER()::bigint';
}

export function adminExactTimestampMetadataColumns<Filters>(
  query: AdminExactKeysetQuery<Filters>,
  timestampSql: string,
) {
  return `${adminExactPageTotalCountSql(query)} AS __pagination_total_count,
          to_char(${timestampSql} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
            AS __pagination_cursor_timestamp`;
}

export function adminExactTimestampCursorValues<Filters>(query: AdminExactKeysetQuery<Filters>) {
  return [query.cursor?.key[0] ?? null, query.cursor?.key[1] ?? null];
}

export function adminExactTimestampCursorCondition<Filters>(
  query: AdminExactKeysetQuery<Filters>,
  timestampSql: string,
  idSql: string,
  timestampParameter: number,
  idParameter: number,
) {
  const operator = query.position === 'previous' ? '>' : '<';
  return `($${timestampParameter}::timestamptz IS NULL OR (${timestampSql}, ${idSql}) ${operator}
    ($${timestampParameter}::timestamptz, $${idParameter}::uuid))`;
}

export function adminExactTimestampOrderBy<Filters>(
  query: AdminExactKeysetQuery<Filters>,
  timestampSql: string,
  idSql: string,
) {
  const direction = query.reverseQuery ? 'ASC' : 'DESC';
  return `${timestampSql} ${direction}, ${idSql} ${direction}`;
}

export function createAdminExactTimestampPage<
  Row extends AdminExactTimestampPageMetadata,
  Item,
  Filters,
>(options: {
  rows: Row[];
  query: AdminExactKeysetQuery<Filters>;
  getId: (row: Row) => string;
  map: (row: Row) => Item;
}) {
  return createAdminExactKeysetPage({
    ...options,
    keyOf: row => [normalizeCursorTimestamp(row.__pagination_cursor_timestamp), options.getId(row)],
  });
}

export function createAdminExactKeysetPage<
  Row extends AdminExactPageMetadata,
  Item,
  Filters,
>(options: {
  rows: Row[];
  query: AdminExactKeysetQuery<Filters>;
  keyOf: (row: Row) => AdminExactKey;
  map: (row: Row) => Item;
  totalItems?: string | number | bigint | null;
}) : { items: Item[]; pagination: AdminExactPagePagination } {
  const totalItems = options.query.snapshot?.totalItems
    ?? readInitialTotalItems(options.totalItems, options.rows);
  const snapshot: AdminExactSnapshotCursor = options.query.snapshot ?? {
    version: 4,
    kind: 'snapshot',
    resource: options.query.resource,
    fingerprint: options.query.fingerprint,
    limit: options.query.limit,
    asOf: options.query.asOf,
    versionResource: options.query.versionResource,
    resourceVersion: options.query.resourceVersion,
    totalItems,
  };
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / options.query.limit);
  const currentPage = options.query.position === 'first'
    ? (totalPages === 0 ? 0 : 1)
    : options.query.position === 'last'
      ? totalPages
      : options.query.cursor?.targetPage ?? 0;
  if ((totalPages === 0 && currentPage !== 0)
    || (totalPages > 0 && (currentPage < 1 || currentPage > totalPages))) {
    throw paginationSnapshotChangedError();
  }

  const selectedCount = options.query.position === 'last'
    ? canonicalTailSize(BigInt(totalItems), options.query.limit)
    : options.query.limit;
  const selectedRows = options.rows.slice(0, selectedCount);
  const pageRows = options.query.reverseQuery ? [...selectedRows].reverse() : selectedRows;
  if (totalItems > 0 && pageRows.length === 0) throw paginationSnapshotChangedError();

  const hasPrevious = currentPage > 1;
  const hasNext = currentPage > 0 && currentPage < totalPages;
  const first = pageRows[0];
  const last = pageRows.at(-1);
  if ((hasPrevious && !first) || (hasNext && !last)) throw paginationSnapshotChangedError();

  return {
    items: pageRows.map(options.map),
    pagination: {
      limit: options.query.limit,
      currentPage,
      totalPages,
      totalItems,
      snapshotCursor: encodeAdminExactCursor(snapshot),
      hasPrevious,
      hasNext,
      previousCursor: first && hasPrevious
        ? encodeAdminExactCursor(boundaryFrom(snapshot, 'previous', currentPage - 1, options.keyOf(first)))
        : null,
      nextCursor: last && hasNext
        ? encodeAdminExactCursor(boundaryFrom(snapshot, 'next', currentPage + 1, options.keyOf(last)))
        : null,
    },
  };
}

export function paginationSnapshotChangedError() {
  return cursorError('列表已更新，请从第 1 页重新加载', 'PAGINATION_SNAPSHOT_CHANGED', 409);
}

function readInitialTotalItems<Row extends AdminExactPageMetadata>(
  explicit: string | number | bigint | null | undefined,
  rows: Row[],
) {
  const raw = explicit ?? rows[0]?.__pagination_total_count;
  if (raw === null || raw === undefined || raw === '') {
    if (rows.length === 0) return 0;
    // 兼容旧测试夹具；真实新快照 SQL 会通过 count(*) OVER() 返回精确总数。
    return rows.length;
  }
  let total: bigint;
  try {
    total = typeof raw === 'bigint' ? raw : BigInt(raw);
  } catch {
    throw cursorError('精准分页总数元数据无效', 'PAGINATION_INVARIANT_VIOLATION', 500);
  }
  if (total < 0n || total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw cursorError('精准分页总数超出安全范围', 'PAGINATION_INVARIANT_VIOLATION', 500);
  }
  return Number(total);
}

function boundaryFrom(
  snapshot: AdminExactSnapshotCursor,
  direction: 'previous' | 'next',
  targetPage: number,
  key: AdminExactKey,
): AdminExactBoundaryCursor {
  return { ...snapshot, kind: 'boundary', direction, targetPage, key };
}

function snapshotFromBoundary(boundary: AdminExactBoundaryCursor): AdminExactSnapshotCursor {
  const { direction: _direction, targetPage: _targetPage, key: _key, ...core } = boundary;
  return { ...core, kind: 'snapshot' };
}

function sameSnapshot(left: AdminExactSnapshotCore, right: AdminExactSnapshotCore) {
  return left.resource === right.resource && left.fingerprint === right.fingerprint
    && left.limit === right.limit && left.asOf === right.asOf
    && left.versionResource === right.versionResource
    && left.resourceVersion === right.resourceVersion
    && left.totalItems === right.totalItems;
}

function encodeAdminExactCursor(cursor: AdminExactSnapshotCursor | AdminExactBoundaryCursor) {
  const payload = Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  const encoded = Buffer.from(JSON.stringify({
    payload,
    signature: sign(payload),
  }), 'utf8').toString('base64url');
  if (encoded.length > 1024) {
    throw cursorError('精准分页游标超出契约长度上限', 'PAGINATION_INVARIANT_VIOLATION', 500);
  }
  return encoded;
}

function decodeAdminExactSnapshotCursor(
  value: string,
  resource: string,
  fingerprint: string,
  limit: number,
): AdminExactSnapshotCursor {
  return decodeAdminExactCursor(value, resource, fingerprint, limit, 'snapshot') as AdminExactSnapshotCursor;
}

function decodeAdminExactBoundaryCursor(
  value: string,
  resource: string,
  fingerprint: string,
  limit: number,
): AdminExactBoundaryCursor {
  return decodeAdminExactCursor(value, resource, fingerprint, limit, 'boundary') as AdminExactBoundaryCursor;
}

function decodeAdminExactCursor(
  value: string,
  resource: string,
  fingerprint: string,
  limit: number,
  expectedKind: 'snapshot' | 'boundary',
): AdminExactSnapshotCursor | AdminExactBoundaryCursor {
  try {
    const envelope = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof envelope.payload !== 'string' || envelope.payload.length < 1 || envelope.payload.length > 4096
      || typeof envelope.signature !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.signature)) {
      throw new Error('invalid envelope');
    }
    const payloadObject = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (payloadObject.version === 2 || payloadObject.version === 3) {
      validateLegacyCursorForUpgrade(envelope.payload, envelope.signature, payloadObject, resource);
      throw paginationSnapshotChangedError();
    }
    const expected = Buffer.from(sign(envelope.payload), 'hex');
    const received = Buffer.from(envelope.signature, 'hex');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new Error('invalid signature');
    }
    assertCursorPayload(payloadObject, expectedKind);
    if (payloadObject.resource !== resource || payloadObject.fingerprint !== fingerprint
      || payloadObject.limit !== limit) {
      throw cursorError('分页游标与当前访问范围不一致', 'INVALID_CURSOR', 400);
    }
    return payloadObject as unknown as AdminExactSnapshotCursor | AdminExactBoundaryCursor;
  } catch (error) {
    if (isPublicPaginationError(error)) throw error;
    throw cursorError('分页游标无效或已过期', 'INVALID_CURSOR', 400);
  }
}

function assertCursorPayload(
  value: Record<string, unknown>,
  expectedKind: 'snapshot' | 'boundary',
) {
  if (value.version !== 4 || value.kind !== expectedKind
    || typeof value.resource !== 'string' || !/^[0-9a-f]{64}$/.test(String(value.fingerprint))
    || !Number.isInteger(value.limit) || Number(value.limit) < 1 || Number(value.limit) > 100
    || typeof value.asOf !== 'string' || Number.isNaN(new Date(value.asOf).getTime())
    || typeof value.versionResource !== 'string' || !/^admin:[a-z-]+$/.test(value.versionResource)
    || typeof value.resourceVersion !== 'string' || !/^\d+$/.test(value.resourceVersion)
    || !Number.isSafeInteger(value.totalItems) || Number(value.totalItems) < 0) {
    throw new Error('invalid payload');
  }
  if (expectedKind === 'boundary' && (
    (value.direction !== 'previous' && value.direction !== 'next')
    || !Number.isSafeInteger(value.targetPage) || Number(value.targetPage) < 1
    || !Array.isArray(value.key) || value.key.length < 1 || value.key.length > 8
    || value.key.some(item => item !== null && typeof item !== 'string' && typeof item !== 'number')
  )) throw new Error('invalid boundary');
}

function validateLegacyCursorForUpgrade(
  encodedPayload: string,
  signature: unknown,
  payload: Record<string, unknown>,
  expectedResource: string,
) {
  if (payload.resource !== expectedResource || typeof signature !== 'string') {
    throw cursorError('分页游标无效或已过期', 'INVALID_CURSOR', 400);
  }
  const prefix = payload.version === 3 && expectedResource.startsWith('admin-api-cost-')
    ? 'admin-api-cost-keyset-v3'
    : 'cursor-pagination-v2';
  const expected = Buffer.from(signWithPrefix(prefix, encodedPayload), 'hex');
  const received = Buffer.from(signature, 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw cursorError('分页游标无效或已过期', 'INVALID_CURSOR', 400);
  }
}

function sign(payload: string) {
  return createHmac('sha256', env.JWT_SECRET)
    .update(`admin-exact-keyset-v4:${payload}`)
    .digest('hex');
}

function signWithPrefix(prefix: string, payload: string) {
  return createHmac('sha256', env.JWT_SECRET).update(`${prefix}:${payload}`).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
}

function isPublicPaginationError(error: unknown): error is Error & { statusCode: number; code: string } {
  return error instanceof Error && 'statusCode' in error && 'code' in error;
}

function cursorError(message: string, code: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode, code });
}
