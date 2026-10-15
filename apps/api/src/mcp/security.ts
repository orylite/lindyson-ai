import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';

export const MCP_SCOPES = [
  'account:read',
  'assets:read',
  'assets:write',
  'generation:write',
  'generation:read',
] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export interface McpIdentity {
  userId: string;
  authVersion: number;
  connectionId: string;
  scopes: string[];
}

export function mcpError(code: string, message: string, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode, exposeMessage: true });
}
export function hashSecret(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export function seal(value: string, secret: string, context: string) {
  const key = createHmac('sha256', secret).update(context).digest();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function unseal(value: string, secret: string, context: string) {
  const bytes = Buffer.from(value, 'base64url');
  const key = createHmac('sha256', secret).update(context).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}
export function requireMcpScope(identity: McpIdentity, scope: McpScope) {
  if (!identity.scopes.includes(scope))
    throw mcpError('MCP_SCOPE_REQUIRED', `需要 ${scope} 授权`, 403);
}
export async function enforceMcpRateLimit(key: string, limit: number) {
  const result = await pool.query<{ calls: number }>(
    `INSERT INTO mcp_rate_limits (key_hash, window_start, calls)
     VALUES ($1, date_trunc('minute', now()), 1)
     ON CONFLICT (key_hash, window_start) DO UPDATE SET calls = mcp_rate_limits.calls + 1
     RETURNING calls`,
    [hashSecret(key)],
  );
  if (result.rows[0]!.calls > limit)
    throw mcpError('MCP_RATE_LIMITED', '调用过于频繁，请在一分钟后重试', 429);
}
export async function assertMcpConnection(connectionId: string): Promise<McpIdentity> {
  const result = await pool.query<{ user_id: string; auth_version: number; scopes: string[] }>(
    `SELECT c.user_id, c.auth_version, c.scopes FROM mcp_connections c
     JOIN users u ON u.id = c.user_id
     WHERE c.id = $1 AND c.revoked_at IS NULL AND c.created_at > now() - interval '30 days'
       AND u.status <> 'frozen' AND u.auth_version = c.auth_version`,
    [connectionId],
  );
  if (!result.rows[0]) throw mcpError('MCP_AUTH_INVALID', '连接已失效，请重新授权', 401);
  const row = result.rows[0];
  return { userId: row.user_id, authVersion: row.auth_version, scopes: row.scopes, connectionId };
}
export function mcpResourceUrl() {
  return env.MCP_PUBLIC_URL!;
}
export function mcpIssuerUrl() {
  return new URL('/oauth', mcpResourceUrl()).href;
}
