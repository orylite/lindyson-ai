import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { deriveSigningKey } from '../config/env.js';
import type { DbClient } from '../db/pool.js';

const fourWayCursorPayloadSchema = z.object({
  version: z.literal(2),
  resource: z.string().min(1).max(80),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  timestamp: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
}).strict();

const signedCursorEnvelopeSchema = z.object({
  payload: z.string().min(1).max(2048),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const exactSnapshotCoreShape = {
  resource: z.string().min(1).max(80),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  limit: z.number().int().positive().max(50),
  resourceVersion: z.string().regex(/^\d+$/),
  totalItems: z.number().int().nonnegative().safe(),
  snapshotAt: z.string().datetime({ offset: true }),
};

const exactSnapshotCursorPayloadSchema = z.object({
  version: z.literal(3),
  kind: z.literal('snapshot'),
  ...exactSnapshotCoreShape,
}).strict();

const exactBoundaryCursorPayloadSchema = z.object({
  version: z.literal(3),
  kind: z.literal('boundary'),
  ...exactSnapshotCoreShape,
  direction: z.enum(['previous', 'next']),
  targetPage: z.number().int().positive().safe(),
  timestamp: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
}).strict();

export interface CursorPosition {
  timestamp: string;
  id: string;
}

export type FourWayPagePosition = 'first' | 'previous' | 'next' | 'last';

export interface FourWayCursorPageQuery {
  position: FourWayPagePosition;
  limit: number;
  cursor: CursorPosition | null;
  fingerprint: string;
  resource: string;
  reverseQuery: boolean;
}

export interface FourWayCursorPagination {
  limit: number;
  hasPrevious: boolean;
  hasNext: boolean;
  previousCursor: string | null;
  nextCursor: string | null;
}

export interface FourWayPageMetadata {
  __pagination_total_count: string | number | bigint | null;
  __pagination_cursor_timestamp: string;
}

export interface ExactPageMetadata {
  __pagination_cursor_timestamp: string;
}

export interface ExactCursorPagination extends FourWayCursorPagination {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  snapshotCursor: string;
}

export interface ExactSnapshotState {
  resource: string;
  fingerprint: string;
  limit: number;
  resourceVersion: string;
  totalItems: number;
  snapshotAt: string;
}

export interface ExactBoundaryState extends ExactSnapshotState {
  direction: 'previous' | 'next';
  targetPage: number;
  timestamp: string;
  id: string;
}

export interface ExactCursorPageRequest {
  position: FourWayPagePosition;
  limit: number;
  fingerprint: string;
  resource: string;
  snapshot: ExactSnapshotState | null;
  boundary: ExactBoundaryState | null;
}

export interface ExactCursorPageQuery extends FourWayCursorPageQuery {
  snapshot: ExactSnapshotState;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  snapshotCursor: string;
}

export type FourWayPageRow<Row> = Row & FourWayPageMetadata;

const CURSOR_TIMESTAMP_SQL_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/**
 * 分页内部元数据：只有直达尾页需要精确总数；时间游标使用 PostgreSQL 原始
 * 微秒精度，避免 node-postgres 的 Date 解析把边界截断到毫秒。
 */
export function fourWayPageMetadataColumns(
  query: Pick<FourWayCursorPageQuery, 'position'>,
  timestampSql: string,
) {
  const totalCountSql = query.position === 'last'
    ? 'count(*) OVER()::bigint'
    : 'NULL::bigint';
  return `${totalCountSql} AS __pagination_total_count,
          to_char(${timestampSql} AT TIME ZONE 'UTC', '${CURSOR_TIMESTAMP_SQL_FORMAT}')
            AS __pagination_cursor_timestamp`;
}

/** 精准页码接口只需要键集边界时间；总数在建立新快照时独立、只计算一次。 */
export function exactPageMetadataColumns(timestampSql: string) {
  return `to_char(${timestampSql} AT TIME ZONE 'UTC', '${CURSOR_TIMESTAMP_SQL_FORMAT}')
            AS __pagination_cursor_timestamp`;
}

export function parseExactCursorPageRequest(input: {
  position?: FourWayPagePosition;
  cursor?: string;
  snapshotCursor?: string;
  limit?: number;
  filters: unknown;
  resource: string;
  defaultLimit?: number;
  maxLimit?: number;
}): ExactCursorPageRequest {
  const position = input.position ?? 'first';
  const maxLimit = input.maxLimit ?? input.defaultLimit ?? 50;
  const defaultLimit = input.defaultLimit ?? Math.min(20, maxLimit);
  const limit = input.limit ?? defaultLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw cursorError('分页数量无效', 'INVALID_PAGE_LIMIT');
  }

  const needsBoundary = position === 'previous' || position === 'next';
  if (needsBoundary && !input.cursor) {
    throw cursorError('翻页操作缺少游标', 'INVALID_CURSOR');
  }
  if (!needsBoundary && input.cursor) {
    throw cursorError('首页或末页不能携带游标', 'INVALID_CURSOR');
  }

  const fingerprint = createCursorFilterFingerprint(input.filters);
  const snapshotPayload = input.snapshotCursor
    ? decodeExactCursor(input.snapshotCursor, input.resource, fingerprint, limit)
    : null;
  const boundaryPayload = input.cursor
    ? decodeExactCursor(input.cursor, input.resource, fingerprint, limit)
    : null;
  if (snapshotPayload && snapshotPayload.kind !== 'snapshot') {
    throw cursorError('分页快照令牌无效', 'INVALID_CURSOR');
  }
  if (boundaryPayload && boundaryPayload.kind !== 'boundary') {
    throw cursorError('翻页边界令牌无效', 'INVALID_CURSOR');
  }
  if (boundaryPayload && boundaryPayload.direction !== position) {
    throw cursorError('翻页边界方向不一致', 'INVALID_CURSOR');
  }

  const snapshot = snapshotPayload ? exactSnapshotState(snapshotPayload) : null;
  const boundary = boundaryPayload?.kind === 'boundary'
    ? exactBoundaryState(boundaryPayload)
    : null;
  if (snapshot && boundary && !sameExactSnapshot(snapshot, boundary)) {
    throw cursorError('翻页边界与分页快照不一致', 'INVALID_CURSOR');
  }

  return {
    position,
    limit,
    fingerprint,
    resource: input.resource,
    snapshot: snapshot ?? (boundary ? exactSnapshotState(boundary) : null),
    boundary,
  };
}

export function materializeExactCursorPageQuery(
  request: ExactCursorPageRequest,
  options: {
    resourceVersion: string;
    totalItems?: number | string | bigint;
    snapshotAt: Date | string;
  },
): ExactCursorPageQuery {
  const resourceVersion = normalizeResourceVersion(options.resourceVersion);
  let snapshot = request.snapshot;
  if (snapshot) {
    if (snapshot.resourceVersion !== resourceVersion) throw paginationSnapshotChangedError();
  } else {
    if (options.totalItems === undefined) {
      throw paginationInvariantError('新分页快照缺少精确总数');
    }
    snapshot = {
      resource: request.resource,
      fingerprint: request.fingerprint,
      limit: request.limit,
      resourceVersion,
      totalItems: normalizeExactTotalItems(options.totalItems),
      snapshotAt: normalizeCursorTimestamp(options.snapshotAt),
    };
  }

  const totalPages = snapshot.totalItems === 0
    ? 0
    : Math.ceil(snapshot.totalItems / snapshot.limit);
  const currentPage = request.position === 'first'
    ? (totalPages === 0 ? 0 : 1)
    : request.position === 'last'
      ? totalPages
      : request.boundary?.targetPage ?? 0;
  if (
    (totalPages === 0 && currentPage !== 0)
    || (totalPages > 0 && (currentPage < 1 || currentPage > totalPages))
  ) {
    throw paginationSnapshotChangedError();
  }

  return {
    position: request.position,
    limit: request.limit,
    cursor: request.boundary
      ? { timestamp: request.boundary.timestamp, id: request.boundary.id }
      : null,
    fingerprint: request.fingerprint,
    resource: request.resource,
    reverseQuery: request.position === 'previous' || request.position === 'last',
    snapshot,
    currentPage,
    totalPages,
    totalItems: snapshot.totalItems,
    snapshotCursor: encodeExactSnapshotCursor(snapshot),
  };
}

export async function readUserPaginationVersion(
  client: DbClient,
  userId: string,
  resource: string,
) {
  const result = await client.query<{ version: string; snapshot_at: Date | string }>(
    `SELECT COALESCE((
       SELECT version::text
       FROM user_pagination_versions
       WHERE user_id = $1 AND resource = $2
     ), '0') AS version,
     transaction_timestamp() AS snapshot_at`,
    [userId, resource],
  );
  const row = result.rows[0];
  if (!row) throw paginationInvariantError('分页资源版本读取失败');
  return { version: normalizeResourceVersion(row.version), snapshotAt: row.snapshot_at };
}

/**
 * 后台列表是跨用户的全局视图，不能借用任意业务用户 UUID 充当版本所有者。
 * 资源版本由 admin_pagination_versions 单独维护，其余快照规则与用户端 v3 一致。
 */
export async function readAdminPaginationVersion(
  client: DbClient,
  resource: string,
) {
  const result = await client.query<{ version: string; snapshot_at: Date | string }>(
    `SELECT COALESCE((
       SELECT version::text
       FROM admin_pagination_versions
       WHERE resource = $1
     ), '0') AS version,
     transaction_timestamp() AS snapshot_at`,
    [resource],
  );
  const row = result.rows[0];
  if (!row) throw paginationInvariantError('后台分页资源版本读取失败');
  return { version: normalizeResourceVersion(row.version), snapshotAt: row.snapshot_at };
}

export function createExactCursorPage<Row extends ExactPageMetadata, Item>(options: {
  rows: Row[];
  query: ExactCursorPageQuery;
  getId: (row: Row) => string;
  map: (row: Row) => Item;
}): { items: Item[]; pagination: ExactCursorPagination } {
  const pageRows = selectExactCursorPageRows(options.rows, options.query);
  if (options.query.totalItems > 0 && pageRows.length === 0) {
    throw paginationSnapshotChangedError();
  }

  const hasPrevious = options.query.currentPage > 1;
  const hasNext = options.query.currentPage > 0
    && options.query.currentPage < options.query.totalPages;
  const first = pageRows[0];
  const last = pageRows.at(-1);
  if ((hasPrevious && !first) || (hasNext && !last)) {
    throw paginationInvariantError('精准分页边界缺少行数据');
  }

  return {
    items: pageRows.map(options.map),
    pagination: {
      limit: options.query.limit,
      currentPage: options.query.currentPage,
      totalPages: options.query.totalPages,
      totalItems: options.query.totalItems,
      snapshotCursor: options.query.snapshotCursor,
      hasPrevious,
      hasNext,
      previousCursor: first && hasPrevious
        ? encodeExactBoundaryCursor(
            options.query.snapshot,
            'previous',
            options.query.currentPage - 1,
            first.__pagination_cursor_timestamp,
            options.getId(first),
          )
        : null,
      nextCursor: last && hasNext
        ? encodeExactBoundaryCursor(
            options.query.snapshot,
            'next',
            options.query.currentPage + 1,
            last.__pagination_cursor_timestamp,
            options.getId(last),
          )
        : null,
    },
  };
}

export function selectExactCursorPageRows<Row extends ExactPageMetadata>(
  rows: Row[],
  query: ExactCursorPageQuery,
) {
  const selectedCount = query.position === 'last'
    ? canonicalTailSize(BigInt(query.totalItems), query.limit)
    : query.limit;
  const selected = rows.slice(0, selectedCount);
  return query.reverseQuery ? [...selected].reverse() : selected;
}

/**
 * 解析固定“最新在前”列表的四向游标。筛选条件会写入签名游标的指纹，游标不能
 * 跨用户、跨筛选或跨资源重放。first/last 不接收游标，previous/next 必须接收游标。
 */
export function parseFourWayCursorPageQuery(input: {
  position?: FourWayPagePosition;
  cursor?: string;
  limit?: number;
  filters: unknown;
  resource: string;
  defaultLimit?: number;
  maxLimit?: number;
}): FourWayCursorPageQuery {
  const position = input.position ?? 'first';
  const maxLimit = input.maxLimit ?? input.defaultLimit ?? 50;
  const defaultLimit = input.defaultLimit ?? Math.min(20, maxLimit);
  const requestedLimit = input.limit ?? defaultLimit;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > maxLimit) {
    throw cursorError('分页数量无效', 'INVALID_PAGE_LIMIT');
  }

  const fingerprint = createCursorFilterFingerprint(input.filters);
  const needsCursor = position === 'previous' || position === 'next';
  if (needsCursor && !input.cursor) {
    throw cursorError('翻页操作缺少游标', 'INVALID_CURSOR');
  }
  if (!needsCursor && input.cursor) {
    throw cursorError('首页或末页不能携带游标', 'INVALID_CURSOR');
  }

  const cursor = input.cursor
    ? decodeFourWayCursor(input.cursor, input.resource, fingerprint)
    : null;
  return {
    position,
    limit: requestedLimit,
    cursor,
    fingerprint,
    resource: input.resource,
    reverseQuery: position === 'previous' || position === 'last',
  };
}

/** 返回复合 keyset 条件；timestampParam/idParam 由调用方根据动态 SQL 参数位置提供。 */
export function fourWayCursorCondition(
  query: FourWayCursorPageQuery,
  timestampSql: string,
  idSql: string,
  timestampParam = 1,
  idParam = 2,
) {
  const operator = query.position === 'previous' ? '>' : '<';
  return `(
    $${timestampParam}::timestamptz IS NULL
    OR (${timestampSql}, ${idSql}) ${operator} ($${timestampParam}::timestamptz, $${idParam}::uuid)
  )`;
}

export function fourWayCursorValues(query: FourWayCursorPageQuery) {
  return [query.cursor?.timestamp ?? null, query.cursor?.id ?? null];
}

export function fourWayPageOrderBy(
  query: FourWayCursorPageQuery,
  timestampSql: string,
  idSql: string,
) {
  const direction = query.reverseQuery ? 'ASC' : 'DESC';
  return `${timestampSql} ${direction}, ${idSql} ${direction}`;
}

export function selectFourWayCursorPageRows<Row extends FourWayPageMetadata>(
  rows: Row[],
  query: FourWayCursorPageQuery,
) {
  const totalCount = readTailTotalCount(rows, query);
  const selectedCount = query.position === 'last'
    ? canonicalTailSize(totalCount ?? 0n, query.limit)
    : query.limit;
  const selected = rows.slice(0, selectedCount);
  return query.reverseQuery ? [...selected].reverse() : selected;
}

export function createFourWayCursorPage<Row extends FourWayPageMetadata, Item>(options: {
  rows: Row[];
  query: FourWayCursorPageQuery;
  getId: (row: Row) => string;
  map: (row: Row) => Item;
}): { items: Item[]; pagination: FourWayCursorPagination } {
  const overflow = options.rows.length > options.query.limit;
  const totalCount = readTailTotalCount(options.rows, options.query);
  const pageRows = selectFourWayCursorPageRows(options.rows, options.query);
  const hasPrevious = options.query.position === 'first'
    ? false
    : options.query.position === 'last'
      ? (totalCount ?? 0n) > BigInt(pageRows.length)
      : options.query.position === 'previous'
      ? overflow
      : true;
  const hasNext = options.query.position === 'last'
    ? false
    : options.query.position === 'first' || options.query.position === 'next'
      ? overflow
      : true;
  const first = pageRows[0];
  const last = pageRows.at(-1);
  const previousBoundary = first
    ? { timestamp: first.__pagination_cursor_timestamp, id: options.getId(first) }
    : options.query.cursor;
  const nextBoundary = last
    ? { timestamp: last.__pagination_cursor_timestamp, id: options.getId(last) }
    : options.query.cursor;
  return {
    items: pageRows.map(options.map),
    pagination: {
      limit: options.query.limit,
      hasPrevious: Boolean(previousBoundary && hasPrevious),
      hasNext: Boolean(nextBoundary && hasNext),
      previousCursor: previousBoundary && hasPrevious
        ? encodeFourWayCursor(options.query, previousBoundary.timestamp, previousBoundary.id)
        : null,
      nextCursor: nextBoundary && hasNext
        ? encodeFourWayCursor(options.query, nextBoundary.timestamp, nextBoundary.id)
        : null,
    },
  };
}

export function canonicalTailSize(totalCount: bigint, limit: number) {
  if (totalCount < 0n) throw paginationInvariantError('分页总数不能为负数');
  if (!Number.isInteger(limit) || limit < 1) throw paginationInvariantError('分页数量无效');
  if (totalCount === 0n) return 0;
  return Number(((totalCount - 1n) % BigInt(limit)) + 1n);
}

function readTailTotalCount<Row extends FourWayPageMetadata>(
  rows: Row[],
  query: FourWayCursorPageQuery,
) {
  if (query.position !== 'last') return null;
  if (rows.length === 0) return 0n;
  const raw = rows[0].__pagination_total_count;
  if (raw === null || raw === undefined || raw === '') {
    throw paginationInvariantError('尾页缺少精确总数元数据');
  }
  let totalCount: bigint;
  try {
    totalCount = typeof raw === 'bigint' ? raw : BigInt(raw);
  } catch {
    throw paginationInvariantError('尾页总数元数据无效');
  }
  if (totalCount < BigInt(rows.length)) {
    throw paginationInvariantError('尾页总数小于查询结果数量');
  }
  return totalCount;
}

export function createCursorFilterFingerprint(filters: unknown) {
  return createHash('sha256').update(stableJson(filters)).digest('hex');
}

function encodeFourWayCursor(
  query: FourWayCursorPageQuery,
  timestamp: Date | string,
  id: string,
) {
  const payload = Buffer.from(JSON.stringify(fourWayCursorPayloadSchema.parse({
    version: 2,
    resource: query.resource,
    fingerprint: query.fingerprint,
    timestamp: normalizeCursorTimestamp(timestamp),
    id,
  })), 'utf8').toString('base64url');
  const envelope = signedCursorEnvelopeSchema.parse({
    payload,
    signature: signFourWayCursor(payload),
  });
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
}

function encodeExactSnapshotCursor(snapshot: ExactSnapshotState) {
  return encodeExactCursor(exactSnapshotCursorPayloadSchema.parse({
    version: 3,
    kind: 'snapshot',
    ...snapshot,
  }));
}

function encodeExactBoundaryCursor(
  snapshot: ExactSnapshotState,
  direction: 'previous' | 'next',
  targetPage: number,
  timestamp: Date | string,
  id: string,
) {
  return encodeExactCursor(exactBoundaryCursorPayloadSchema.parse({
    version: 3,
    kind: 'boundary',
    ...snapshot,
    direction,
    targetPage,
    timestamp: normalizeCursorTimestamp(timestamp),
    id,
  }));
}

type ExactCursorPayload =
  | z.infer<typeof exactSnapshotCursorPayloadSchema>
  | z.infer<typeof exactBoundaryCursorPayloadSchema>;

function encodeExactCursor(payloadValue: ExactCursorPayload) {
  const payload = Buffer.from(JSON.stringify(payloadValue), 'utf8').toString('base64url');
  const envelope = signedCursorEnvelopeSchema.parse({
    payload,
    signature: signExactCursor(payload),
  });
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
}

function decodeExactCursor(
  value: string,
  expectedResource: string,
  expectedFingerprint: string,
  expectedLimit: number,
): ExactCursorPayload {
  try {
    const envelope = signedCursorEnvelopeSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    const expectedSignature = Buffer.from(signExactCursor(envelope.payload), 'hex');
    const receivedSignature = Buffer.from(envelope.signature, 'hex');
    if (
      expectedSignature.length !== receivedSignature.length
      || !timingSafeEqual(expectedSignature, receivedSignature)
    ) {
      throw new Error('cursor signature mismatch');
    }
    const parsed = z.union([
      exactSnapshotCursorPayloadSchema,
      exactBoundaryCursorPayloadSchema,
    ]).parse(JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8')));
    if (
      parsed.resource !== expectedResource
      || parsed.fingerprint !== expectedFingerprint
      || parsed.limit !== expectedLimit
    ) {
      throw new Error('cursor scope mismatch');
    }
    return parsed;
  } catch {
    // 兼容期内识别合法 v2 游标，但不把它伪装成具有精准页码的快照。
    // 新前端收到 409 后会回首页建立 v3 快照。
    try {
      decodeFourWayCursorForExactUpgrade(value, expectedResource);
      throw paginationSnapshotChangedError('分页协议已升级，正在重新建立列表快照');
    } catch (error) {
      if (isPaginationSnapshotChangedError(error)) throw error;
      throw cursorError('分页游标无效或已过期', 'INVALID_CURSOR');
    }
  }
}

/**
 * v2 升级识别只验证签名和资源。v3 为了绑定后台操作者与 limit 扩大了
 * fingerprint 作用域，因此合法旧游标的旧指纹不可能等于新指纹。这里不返回旧边界，
 * 只把可验签的同资源 v2 识别为需要安全回首页的 409；篡改或跨资源仍是 400。
 */
function decodeFourWayCursorForExactUpgrade(value: string, expectedResource: string) {
  try {
    const envelope = signedCursorEnvelopeSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    const expectedSignature = Buffer.from(signFourWayCursor(envelope.payload), 'hex');
    const receivedSignature = Buffer.from(envelope.signature, 'hex');
    if (
      expectedSignature.length !== receivedSignature.length
      || !timingSafeEqual(expectedSignature, receivedSignature)
    ) {
      throw new Error('cursor signature mismatch');
    }
    const payload = fourWayCursorPayloadSchema.parse(
      JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8')),
    );
    if (payload.resource !== expectedResource) throw new Error('cursor resource mismatch');
  } catch {
    throw cursorError('分页游标无效或已过期', 'INVALID_CURSOR');
  }
}

function exactSnapshotState(payload: ExactSnapshotState): ExactSnapshotState {
  return {
    resource: payload.resource,
    fingerprint: payload.fingerprint,
    limit: payload.limit,
    resourceVersion: payload.resourceVersion,
    totalItems: payload.totalItems,
    snapshotAt: payload.snapshotAt,
  };
}

function exactBoundaryState(
  payload: z.infer<typeof exactBoundaryCursorPayloadSchema>,
): ExactBoundaryState {
  return {
    ...exactSnapshotState(payload),
    direction: payload.direction,
    targetPage: payload.targetPage,
    timestamp: payload.timestamp,
    id: payload.id,
  };
}

function sameExactSnapshot(left: ExactSnapshotState, right: ExactSnapshotState) {
  return left.resource === right.resource
    && left.fingerprint === right.fingerprint
    && left.limit === right.limit
    && left.resourceVersion === right.resourceVersion
    && left.totalItems === right.totalItems
    && left.snapshotAt === right.snapshotAt;
}

function decodeFourWayCursor(
  value: string,
  expectedResource: string,
  expectedFingerprint: string,
): CursorPosition {
  let payload: z.infer<typeof fourWayCursorPayloadSchema>;
  try {
    const envelope = signedCursorEnvelopeSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    const expectedSignature = Buffer.from(signFourWayCursor(envelope.payload), 'hex');
    const receivedSignature = Buffer.from(envelope.signature, 'hex');
    if (
      expectedSignature.length !== receivedSignature.length
      || !timingSafeEqual(expectedSignature, receivedSignature)
    ) {
      throw new Error('cursor signature mismatch');
    }
    payload = fourWayCursorPayloadSchema.parse(
      JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8')),
    );
    if (payload.resource !== expectedResource) throw new Error('cursor resource mismatch');
  } catch {
    throw cursorError('分页游标无效或已过期', 'INVALID_CURSOR');
  }

  if (payload.fingerprint !== expectedFingerprint) {
    throw cursorError('分页游标与当前筛选条件不一致', 'INVALID_CURSOR');
  }
  return { timestamp: payload.timestamp, id: payload.id };
}

function signFourWayCursor(payload: string) {
  return createHmac('sha256', deriveSigningKey('cursor-pagination'))
    .update(`cursor-pagination-v2:${payload}`)
    .digest('hex');
}

function signExactCursor(payload: string) {
  return createHmac('sha256', deriveSigningKey('cursor-pagination'))
    .update(`cursor-pagination-v3:${payload}`)
    .digest('hex');
}

function normalizeResourceVersion(value: string) {
  if (!/^\d+$/.test(value)) throw paginationInvariantError('分页资源版本无效');
  try {
    return BigInt(value).toString();
  } catch {
    throw paginationInvariantError('分页资源版本无效');
  }
}

function normalizeExactTotalItems(value: number | string | bigint) {
  let parsed: bigint;
  try {
    parsed = typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    throw paginationInvariantError('分页总数元数据无效');
  }
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw paginationInvariantError('分页总数超出安全范围');
  }
  return Number(parsed);
}

export function normalizeCursorTimestamp(timestamp: Date | string) {
  if (timestamp instanceof Date) return timestamp.toISOString();
  const normalized = timestamp.trim()
    .replace(' ', 'T')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
    .replace(/([+-]\d{2})$/, '$1:00');
  const parsed = z.string().datetime({ offset: true }).safeParse(normalized);
  if (!parsed.success) throw paginationInvariantError('分页时间元数据无效');
  return parsed.data;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function cursorError(message: string, code: string) {
  return Object.assign(new Error(message), { statusCode: 400, code });
}

function paginationInvariantError(message: string) {
  return Object.assign(new Error(message), {
    statusCode: 500,
    code: 'PAGINATION_INVARIANT_VIOLATION',
  });
}

export function paginationSnapshotChangedError(message = '列表已更新，请重新建立分页快照') {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code: 'PAGINATION_SNAPSHOT_CHANGED',
  });
}

function isPaginationSnapshotChangedError(error: unknown) {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'PAGINATION_SNAPSHOT_CHANGED',
  );
}
