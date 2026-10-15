import pg from 'pg';
import { env } from '../config/env.js';
import { registerSafeEmitterErrorListener } from '../safeEmitterError.js';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
});
registerSafeEmitterErrorListener(pool, 'postgres-main-pool-error', 'POSTGRES_POOL_ERROR');

/**
 * 成本报表与交易流量隔离。报表即使触发慢查询，也不能耗尽登录、任务和支付
 * 共用的主连接池。
 */
export const costReportingPool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 5_000,
  application_name: 'lindyson-cost-reporting',
});
registerSafeEmitterErrorListener(
  costReportingPool,
  'postgres-cost-reporting-pool-error',
  'POSTGRES_POOL_ERROR',
);

export type DbClient = pg.PoolClient | pg.Pool;

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 精准分页的版本、总数和当前页必须来自同一个 PostgreSQL 快照。事务只读且很短，
 * 不持有跨请求快照；后续请求通过单调资源版本判断原分页快照是否仍然有效。
 */
export async function withReadOnlyRepeatableRead<T>(fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function withCostReportingSession<T>(
  options: { timeoutMs: number; signal?: AbortSignal },
  fn: (client: pg.PoolClient) => Promise<T>,
) {
  if (options.signal?.aborted) throw reportTimeoutError();
  let client: pg.PoolClient;
  try {
    client = await costReportingPool.connect();
  } catch {
    throw reportTimeoutError();
  }
  if (options.signal?.aborted) {
    client.release();
    throw reportTimeoutError();
  }
  const backendProcessId = (client as pg.PoolClient & { processID?: number }).processID;
  let settled = false;
  const cancelActiveQuery = () => {
    if (settled || !backendProcessId) return;
    // 活跃 client 无法在自己的查询结束前发送取消命令，使用主池的空闲连接
    // 调用 PostgreSQL 原生取消；statement_timeout 仍是最终兜底。
    void pool.query('SELECT pg_cancel_backend($1)', [backendProcessId]).catch(() => undefined);
  };
  options.signal?.addEventListener('abort', cancelActiveQuery, { once: true });

  try {
    // 成本精准分页的版本、首次 COUNT 与键集页必须共享同一数据库快照。
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(
      "SELECT set_config('jit', 'off', true), set_config('statement_timeout', $1, true)",
      [String(options.timeoutMs)],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    settled = true;
    return result;
  } catch (error) {
    settled = true;
    await client.query('ROLLBACK').catch(() => undefined);
    if (options.signal?.aborted || isPostgresQueryCanceled(error)) throw reportTimeoutError();
    throw error;
  } finally {
    settled = true;
    options.signal?.removeEventListener('abort', cancelActiveQuery);
    client.release();
  }
}

function isPostgresQueryCanceled(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === '57014');
}

function reportTimeoutError() {
  return Object.assign(new Error('成本报表查询超时，请稍后重试'), {
    statusCode: 503,
    code: 'REPORT_TIMEOUT',
    exposeMessage: true,
  });
}
