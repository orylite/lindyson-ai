import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createAdminActionRequestHash,
  resolveAdminIdempotencyKey,
  runAdminIdempotentActionWithClient,
} from '../src/domain/adminIdempotency.js';

const responseSchema = z.object({ ok: z.boolean(), value: z.string() });

describe('后台统一幂等执行器', () => {
  it('规范化请求摘要并忽略请求体中的传输键', () => {
    const first = createAdminActionRequestHash({
      action: 'announcement-create', target: 'collection',
      body: { title: 'A', nested: { b: 2, a: 1 }, idempotencyKey: 'body-key-100' },
    });
    const second = createAdminActionRequestHash({
      action: 'announcement-create', target: 'collection',
      body: { nested: { a: 1, b: 2 }, title: 'A' },
    });
    expect(first).toBe(second);
  });

  it('只接受标准 Header 并拒绝缺失的键', () => {
    expect(resolveAdminIdempotencyKey({ headerKey: 'header-key-100' })).toBe('header-key-100');
    expect(() => resolveAdminIdempotencyKey({})).toThrow(/必须提供幂等键/);
  });

  it('首次执行保存响应，同键重放不再次执行业务', async () => {
    const stored = new Map<string, Record<string, unknown>>();
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('pg_advisory_xact_lock')) return result([]);
      if (sql.includes('FROM admin_action_idempotency') && sql.includes('FOR UPDATE')) {
        const row = stored.get(String(params[1]));
        return result(row ? [row] : []);
      }
      if (sql.includes('INSERT INTO admin_action_idempotency')) {
        const row = {
          id: 'action-1', request_hash: params[3], response_json: null, response_status: null,
          completed_at: null, response_expires_at: future(30), key_expires_at: future(365),
        };
        stored.set(String(params[2]), row);
        return result([{ id: 'action-1' }]);
      }
      if (sql.includes('UPDATE admin_action_idempotency')) {
        const row = stored.get('announcement-key-100')!;
        row.response_json = JSON.parse(String(params[1]));
        row.response_status = params[2] as number;
        row.completed_at = new Date().toISOString();
        return result([]);
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const client = { query } as never;
    const execute = vi.fn(async () => ({ ok: true, value: 'created' }));
    const input = {
      adminUserId: 'admin-1', action: 'announcement-create', target: 'collection',
      idempotencyKey: 'announcement-key-100', body: { title: 'A' }, responseSchema, execute,
    };

    const first = await runAdminIdempotentActionWithClient(client, input);
    const replay = await runAdminIdempotentActionWithClient(client, input);
    expect(first).toMatchObject({ reused: false, statusCode: 200 });
    expect(replay).toMatchObject({ reused: true, response: { ok: true, value: 'created' } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('相同键不能用于不同请求', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return result([]);
      return result([{
        id: 'action-1', request_hash: 'different', response_json: { ok: true, value: 'old' },
        response_status: 200, completed_at: new Date().toISOString(),
        response_expires_at: future(30), key_expires_at: future(365),
      }]);
    });
    await expect(runAdminIdempotentActionWithClient({ query } as never, {
      adminUserId: 'admin-1', action: 'announcement-create', target: 'collection',
      idempotencyKey: 'announcement-key-100', body: { title: 'new' }, responseSchema,
      execute: async () => ({ ok: true, value: 'new' }),
    })).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('相同管理员不能跨操作复用同一键', async () => {
    const oldHash = createAdminActionRequestHash({
      action: 'announcement-create',
      target: 'collection',
      body: { title: 'A' },
    });
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('pg_advisory_xact_lock')) return result([]);
      expect(params).toEqual(['admin-1', 'shared-admin-key-100']);
      return result([{
        id: 'action-1', request_hash: oldHash, response_json: { ok: true, value: 'old' },
        response_status: 200, completed_at: new Date().toISOString(),
        response_expires_at: future(30), key_expires_at: future(365),
      }]);
    });
    await expect(runAdminIdempotentActionWithClient({ query } as never, {
      adminUserId: 'admin-1', action: 'plan-create', target: 'collection',
      idempotencyKey: 'shared-admin-key-100', body: { title: 'A' }, responseSchema,
      execute: async () => ({ ok: true, value: 'new' }),
    })).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('首次执行的响应不符合契约时不写入幂等快照', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return result([]);
      if (sql.includes('FROM admin_action_idempotency') && sql.includes('FOR UPDATE')) return result([]);
      if (sql.includes('INSERT INTO admin_action_idempotency')) return result([{ id: 'action-1' }]);
      if (sql.includes('UPDATE admin_action_idempotency')) {
        throw new Error('无效响应不应写入快照');
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    await expect(runAdminIdempotentActionWithClient({ query } as never, {
      adminUserId: 'admin-1', action: 'announcement-create', target: 'collection',
      idempotencyKey: 'announcement-key-100', body: { title: 'A' }, responseSchema,
      execute: async () => ({ ok: true, value: 123 }) as never,
    })).rejects.toMatchObject({
      statusCode: 500,
      code: 'API_RESPONSE_SCHEMA_MISMATCH',
      responseValidationPhase: 'first-run',
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE admin_action_idempotency'))).toBe(false);
  });

  it('重放时使用同一契约验证已保存响应', async () => {
    const requestHash = createAdminActionRequestHash({
      action: 'announcement-create', target: 'collection', body: { title: 'A' },
    });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return result([]);
      return result([{
        id: 'action-1', request_hash: requestHash, response_json: { ok: true, value: 123 },
        response_status: 200, completed_at: new Date().toISOString(),
        response_expires_at: future(30), key_expires_at: future(365),
      }]);
    });

    await expect(runAdminIdempotentActionWithClient({ query } as never, {
      adminUserId: 'admin-1', action: 'announcement-create', target: 'collection',
      idempotencyKey: 'announcement-key-100', body: { title: 'A' }, responseSchema,
      execute: async () => ({ ok: true, value: 'unused' }),
    })).rejects.toMatchObject({
      statusCode: 500,
      code: 'API_RESPONSE_SCHEMA_MISMATCH',
      responseValidationPhase: 'replay',
    });
  });
});

function result(rows: unknown[]) {
  return { rows, rowCount: rows.length };
}

function future(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}
