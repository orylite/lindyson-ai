import { beforeEach,describe,expect,it,vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolOptions: [] as Array<Record<string, unknown>>,
  mainQuery: vi.fn(),
  reportConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  poolErrorListeners: [] as Array<((...args: unknown[]) => void) | undefined>,
}));

vi.mock('../src/config/env.js', () => ({
  env: { DATABASE_URL: 'postgresql://test:test@localhost:5432/test' },
}));

vi.mock('pg', () => {
  class Pool {
    readonly query: typeof mocks.mainQuery;
    readonly connect: typeof mocks.reportConnect;
    readonly poolIndex: number;

    constructor(options: Record<string, unknown>) {
      const index = mocks.poolOptions.push(options) - 1;
      this.poolIndex = index;
      this.query = index === 0 ? mocks.mainQuery : vi.fn();
      this.connect = index === 1 ? mocks.reportConnect : vi.fn();
    }

    on(event: string, listener: (...args: unknown[]) => void) {
      if (event === 'error') {
        mocks.poolErrorListeners[this.poolIndex] = listener;
      }
      return this;
    }

    end() {
      return Promise.resolve();
    }
  }

  return { default: { Pool } };
});

import { costReportingPool, pool, withCostReportingSession } from '../src/db/pool.js';

describe('成本报表独立连接池', () => {
  beforeEach(() => {
    mocks.mainQuery.mockReset().mockResolvedValue({ rows: [] });
    mocks.reportConnect.mockReset().mockResolvedValue({
      processID: 4242,
      query: mocks.clientQuery,
      release: mocks.clientRelease,
    });
    mocks.clientQuery.mockReset().mockResolvedValue({ rows: [] });
    mocks.clientRelease.mockReset();
  });

  it('与主池隔离为最多 3 个连接，并在只读事务关闭 JIT 和设置查询超时', async () => {
    expect(mocks.poolOptions).toEqual([
      expect.objectContaining({ max: 10 }),
      expect.objectContaining({
        max: 3,
        connectionTimeoutMillis: 5_000,
        application_name: 'lindyson-cost-reporting',
      }),
    ]);

    await expect(withCostReportingSession({ timeoutMs: 5_000 }, async client => {
      await client.query('SELECT 42');
      return 'ok';
    })).resolves.toBe('ok');

    expect(mocks.clientQuery.mock.calls.map(call => call[0])).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      "SELECT set_config('jit', 'off', true), set_config('statement_timeout', $1, true)",
      'SELECT 42',
      'COMMIT',
    ]);
    expect(mocks.clientQuery.mock.calls[1]?.[1]).toEqual(['5000']);
    expect(mocks.clientRelease).toHaveBeenCalledOnce();
  });

  it('客户端中断会取消 PostgreSQL 查询并统一映射 REPORT_TIMEOUT', async () => {
    const controller = new AbortController();
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'SELECT pg_sleep(30)') {
        controller.abort();
        await Promise.resolve();
        throw Object.assign(new Error('canceling statement due to user request'), { code: '57014' });
      }
      return { rows: [] };
    });

    await expect(withCostReportingSession({ timeoutMs: 5_000, signal: controller.signal }, async client => {
      await client.query('SELECT pg_sleep(30)');
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'REPORT_TIMEOUT',
      message: '成本报表查询超时，请稍后重试',
    });

    await vi.waitFor(() => {
      expect(mocks.mainQuery).toHaveBeenCalledWith('SELECT pg_cancel_backend($1)', [4242]);
    });
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.clientRelease).toHaveBeenCalledOnce();
  });

  it('连接池排队失败也映射为报表超时，不泄漏底层连接错误', async () => {
    mocks.reportConnect.mockRejectedValueOnce(new Error('connection timeout'));

    await expect(withCostReportingSession({ timeoutMs: 5_000 }, async () => undefined)).rejects.toMatchObject({
      statusCode: 503,
      code: 'REPORT_TIMEOUT',
    });
    expect(mocks.clientRelease).not.toHaveBeenCalled();
  });

  it('主池与成本池 idle error 都只输出固定安全事件', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(pool).toBeDefined();
      expect(costReportingPool).toBeDefined();
      mocks.poolErrorListeners[0]?.(new Error('main-pool-secret'), { client: 'secret-client' });
      mocks.poolErrorListeners[1]?.(new Error('cost-pool-secret'), { client: 'secret-client' });

      expect(consoleError.mock.calls).toEqual([
        [JSON.stringify({ event: 'postgres-main-pool-error', errorCode: 'POSTGRES_POOL_ERROR' })],
        [JSON.stringify({
          event: 'postgres-cost-reporting-pool-error',
          errorCode: 'POSTGRES_POOL_ERROR',
        })],
      ]);
      const output = consoleError.mock.calls.flat().join('\n');
      expect(output).not.toContain('main-pool-secret');
      expect(output).not.toContain('cost-pool-secret');
      expect(output).not.toContain('secret-client');
      expect(output).not.toContain('Error:');
    } finally {
      consoleError.mockRestore();
    }
  });
});
