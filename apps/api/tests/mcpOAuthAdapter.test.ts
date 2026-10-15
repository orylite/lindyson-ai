import { beforeEach, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('../src/db/pool.js', () => ({ pool: { query } }));
vi.mock('../src/config/env.js', () => ({ env: { MCP_OAUTH_SECRET: 'test-only-oauth-secret' } }));
import { PostgresOAuthAdapter } from '../src/mcp/oauthAdapter.js';
import { hashSecret } from '../src/mcp/security.js';
beforeEach(() => query.mockReset());
it('OAuth 原始令牌和 payload 不以明文落库，读取保留消费标记', async () => {
  query.mockResolvedValue({ rows: [], rowCount: 1 });
  const adapter = new PostgresOAuthAdapter('RefreshToken');
  await adapter.upsert('raw-token', { grantId: 'grant', accountId: 'user:1' }, 3600);
  const values = query.mock.calls[0]![1];
  expect(values[1]).toBe(hashSecret('RefreshToken:raw-token'));
  expect(JSON.stringify(values)).not.toContain('raw-token');
  expect(values[2]).not.toContain('user:1');
  query.mockResolvedValue({
    rows: [{ id_hash: values[1], payload_encrypted: values[2], consumed_at: new Date(1000) }],
  });
  expect(await adapter.find('raw-token')).toEqual({
    grantId: 'grant',
    accountId: 'user:1',
    consumed: 1,
  });
});
it('并发消费只有首次成功，拒绝重放', async () => {
  query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
  const adapter = new PostgresOAuthAdapter('AuthorizationCode');
  const results = await Promise.allSettled([adapter.consume('code'), adapter.consume('code')]);
  expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
  expect(query.mock.calls[0]![0]).toContain('consumed_at IS NULL');
});
