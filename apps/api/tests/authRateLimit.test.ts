import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';
import { consumeRateLimit } from '../src/auth/rateLimit.js';

describe('认证限流', () => {
  it('超过窗口允许次数后返回 429，且数据库中不存储原始账号标识', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([{ attempts: 4 }]));
    const client = { query } as unknown as DbClient;

    await expect(consumeRateLimit(client, {
      scope: 'login',
      identity: 'Member@Example.com',
      maxAttempts: 3,
      windowSeconds: 900,
    })).rejects.toMatchObject({
      statusCode: 429,
      code: 'AUTH_RATE_LIMITED',
    });

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('pg_advisory_xact_lock'),
      [expect.stringMatching(/^auth-rate-limit:login:[a-f0-9]{64}$/)],
    );
    const insertParams = query.mock.calls[1]?.[1] as unknown[];
    expect(insertParams[0]).toBe('login');
    expect(insertParams[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(insertParams[1]).not.toContain('Member@Example.com');
  });
});

function queryResult(rows: unknown[]) {
  return { rows, rowCount: rows.length };
}
