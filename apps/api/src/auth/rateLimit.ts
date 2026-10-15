import { createHmac } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { withTransaction, type DbClient } from '../db/pool.js';

interface RateLimitPolicy {
  scope: string;
  identity: string;
  maxAttempts: number;
  windowSeconds: number;
}

interface RequestRateLimitPolicy extends Omit<RateLimitPolicy, 'identity'> {
  identity?: string;
  ipMaxAttempts?: number;
  includeIp?: boolean;
}

let lastCleanupAt = 0;

export async function enforceAuthRateLimit(
  request: FastifyRequest,
  policy: RequestRateLimitPolicy,
) {
  await withTransaction(async client => {
    // IP 始终先于账号加锁，避免两个维度的并发请求形成锁顺序死锁。
    if (policy.includeIp !== false) {
      await consumeRateLimit(client, {
        scope: `${policy.scope}:ip`,
        identity: request.ip,
        maxAttempts: policy.ipMaxAttempts ?? policy.maxAttempts,
        windowSeconds: policy.windowSeconds,
      });
    }
    const accountIdentity = policy.identity?.trim().toLowerCase();
    if (accountIdentity) {
      await consumeRateLimit(client, {
        scope: `${policy.scope}:account`,
        identity: accountIdentity,
        maxAttempts: policy.maxAttempts,
        windowSeconds: policy.windowSeconds,
      });
    }

    await cleanupOldRateLimitEvents(client);
  });
}

export async function clearAuthAccountRateLimit(client: DbClient, scope: string, identity: string) {
  const accountScope = `${scope}:account`;
  const keyHash = hashRateLimitKey(accountScope, identity.trim().toLowerCase());
  await client.query(
    `DELETE FROM auth_rate_limit_events
     WHERE scope = $1 AND key_hash = $2`,
    [accountScope, keyHash],
  );
}

export async function consumeRateLimit(client: DbClient, policy: RateLimitPolicy) {
  const keyHash = hashRateLimitKey(policy.scope, policy.identity);

  // enforceAuthRateLimit 在显式事务内调用本函数。事务级键锁让多实例对同一
  // 限流键串行计数，避免并发 INSERT 彼此不可见而一起越过阈值。
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`auth-rate-limit:${policy.scope}:${keyHash}`],
  );

  await client.query(
    `INSERT INTO auth_rate_limit_events (scope, key_hash)
     VALUES ($1, $2)`,
    [policy.scope, keyHash],
  );
  const result = await client.query<{ attempts: number }>(
    `SELECT count(*)::integer AS attempts
     FROM auth_rate_limit_events
     WHERE scope = $1
       AND key_hash = $2
       AND created_at > now() - ($3::text || ' seconds')::interval`,
    [policy.scope, keyHash, policy.windowSeconds],
  );

  if ((result.rows[0]?.attempts ?? 0) > policy.maxAttempts) {
    throw Object.assign(new Error('请求过于频繁，请稍后再试'), {
      statusCode: 429,
      code: 'AUTH_RATE_LIMITED',
    });
  }
}

function hashRateLimitKey(scope: string, identity: string) {
  return createHmac('sha256', env.JWT_SECRET)
    .update(`${scope}:${identity}`)
    .digest('hex');
}

async function cleanupOldRateLimitEvents(client: DbClient) {
  const now = Date.now();
  if (now - lastCleanupAt < 60 * 60 * 1000) return;
  lastCleanupAt = now;
  await client.query(
    `DELETE FROM auth_rate_limit_events
     WHERE created_at < now() - interval '24 hours'`,
  );
}

export function resetRateLimitCleanupForTests() {
  lastCleanupAt = 0;
}
