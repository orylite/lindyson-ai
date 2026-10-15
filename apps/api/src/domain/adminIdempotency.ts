import { createHash } from 'node:crypto';
import { z } from 'zod';
import { pool, withTransaction, type DbClient } from '../db/pool.js';

export const adminIdempotencyKeySchema = z.string().trim().min(8).max(128);

interface AdminIdempotencyRow {
  id: string;
  request_hash: string | null;
  response_json: unknown;
  response_status: number | null;
  completed_at: Date | string | null;
  response_expires_at: Date | string;
  key_expires_at: Date | string;
}

export interface AdminIdempotentActionInput<T> {
  adminUserId: string;
  action: string;
  target: string;
  idempotencyKey: string;
  body: unknown;
  responseSchema: z.ZodType<T>;
  successStatus?: number;
  // 业务回调产生的值在经过 responseSchema 之前不可信。
  execute: (client: DbClient, actionId: string) => Promise<unknown>;
}

export interface AdminIdempotentResult<T> {
  response: T;
  statusCode: number;
  reused: boolean;
  actionId: string;
}

export function resolveAdminIdempotencyKey(input: {
  headerKey?: string | string[];
}) {
  const headerValue = Array.isArray(input.headerKey) ? input.headerKey[0] : input.headerKey;
  const headerKey = typeof headerValue === 'string' && headerValue.trim() ? headerValue.trim() : undefined;
  if (!headerKey) throw publicError('后台写操作必须提供幂等键', 400, 'IDEMPOTENCY_KEY_REQUIRED');
  return adminIdempotencyKeySchema.parse(headerKey);
}

export function createAdminActionRequestHash(input: {
  action: string;
  target: string;
  body: unknown;
}) {
  const body = stripTransportFields(input.body);
  return createHash('sha256').update(canonicalJson({
    version: 1,
    action: input.action.trim(),
    target: input.target.trim(),
    body,
  })).digest('hex');
}

export function runAdminIdempotentAction<T>(input: AdminIdempotentActionInput<T>) {
  return withTransaction(client => runAdminIdempotentActionWithClient(client, input));
}

export async function runAdminIdempotentActionWithClient<T>(
  client: DbClient,
  input: AdminIdempotentActionInput<T>,
): Promise<AdminIdempotentResult<T>> {
  const action = input.action.trim();
  const target = input.target.trim();
  const idempotencyKey = adminIdempotencyKeySchema.parse(input.idempotencyKey);
  const requestHash = createAdminActionRequestHash({ action, target, body: input.body });
  const lockKey = `admin-idem:${input.adminUserId}:${idempotencyKey}`;

  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
  const existingResult = await client.query<AdminIdempotencyRow>(
    `SELECT id, request_hash, response_json, response_status, completed_at,
            response_expires_at, key_expires_at
     FROM admin_action_idempotency
     WHERE admin_user_id = $1 AND idempotency_key = $2
     FOR UPDATE`,
    [input.adminUserId, idempotencyKey],
  );
  let existing: AdminIdempotencyRow | undefined = existingResult.rows[0];
  const now = Date.now();

  if (existing && new Date(existing.key_expires_at).getTime() <= now) {
    await client.query('DELETE FROM admin_action_idempotency WHERE id = $1', [existing.id]);
    existing = undefined;
  }

  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw publicError('该幂等键已用于不同的后台操作', 409, 'IDEMPOTENCY_CONFLICT');
    }
    if (!existing.response_json || new Date(existing.response_expires_at).getTime() <= now) {
      throw publicError('该幂等请求的响应已过期，不能重新执行', 410, 'IDEMPOTENCY_RESPONSE_EXPIRED');
    }
    if (!existing.completed_at || existing.response_status === null) {
      throw publicError('该幂等请求记录尚未完成', 409, 'IDEMPOTENCY_RECORD_INCOMPLETE');
    }
    const parsed = input.responseSchema.safeParse(existing.response_json);
    if (!parsed.success) {
      throw responseSchemaMismatchError(parsed.error, 'replay');
    }
    return {
      response: parsed.data,
      statusCode: existing.response_status,
      reused: true,
      actionId: existing.id,
    };
  }

  const reservation = await client.query<{ id: string }>(
    `INSERT INTO admin_action_idempotency (
       admin_user_id, action, idempotency_key, request_hash,
       response_expires_at, key_expires_at
     )
     VALUES ($1, $2, $3, $4, now() + interval '30 days', now() + interval '365 days')
     RETURNING id`,
    [input.adminUserId, action, idempotencyKey, requestHash],
  );
  const actionId = reservation.rows[0]!.id;
  const executedResponse = await input.execute(client, actionId);
  const parsedResponse = input.responseSchema.safeParse(executedResponse);
  if (!parsedResponse.success) {
    // 验证必须在写入幂等快照之前完成。抛错后外层事务会回滚预留记录，
    // 避免将无效的服务端响应固化为可重放结果。
    throw responseSchemaMismatchError(parsedResponse.error, 'first-run');
  }
  const response = parsedResponse.data;
  const statusCode = input.successStatus ?? 200;
  await client.query(
    `UPDATE admin_action_idempotency
     SET response_json = $2::jsonb,
         response_status = $3,
         completed_at = now()
     WHERE id = $1`,
    [actionId, JSON.stringify(response), statusCode],
  );
  return { response, statusCode, reused: false, actionId };
}

export async function cleanupExpiredAdminIdempotency(
  client: DbClient = pool,
  limit = 500,
) {
  const safeLimit = Math.max(1, Math.min(5_000, Math.trunc(limit)));
  const responses = await client.query(
    `WITH expired AS (
       SELECT id FROM admin_action_idempotency
       WHERE response_json IS NOT NULL AND response_expires_at <= now()
       ORDER BY response_expires_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE admin_action_idempotency item
     SET response_json = NULL, response_status = NULL
     FROM expired
     WHERE item.id = expired.id`,
    [safeLimit],
  );
  const tombstones = await client.query(
    `WITH expired AS (
       SELECT id FROM admin_action_idempotency
       WHERE key_expires_at <= now()
       ORDER BY key_expires_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     DELETE FROM admin_action_idempotency item
     USING expired
     WHERE item.id = expired.id`,
    [safeLimit],
  );
  return {
    responsesPurged: responses.rowCount ?? 0,
    tombstonesDeleted: tombstones.rowCount ?? 0,
  };
}

function stripTransportFields(value: unknown) {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'idempotencyKey')) return value;
  const { idempotencyKey: _ignored, ...body } = value;
  return body;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicError(message: string, statusCode: number, code: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

function responseSchemaMismatchError(error: z.ZodError, phase: 'first-run' | 'replay') {
  return Object.assign(new Error('服务端响应不符合 API 契约'), {
    statusCode: 500,
    code: 'API_RESPONSE_SCHEMA_MISMATCH',
    responseValidationPhase: phase,
    validationIssues: error.issues,
  });
}
