import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  transactionQuery: vi.fn(),
  withTransaction: vi.fn(),
  scheduleSystemAssetDeletion: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: mocks.withTransaction,
}));

vi.mock('../src/domain/assetDeletionService.js', () => ({
  scheduleSystemAssetDeletion: mocks.scheduleSystemAssetDeletion,
}));

import {
  getAssetRetentionSchedule,
  resetAssetRetentionSweepMemoryForTests,
  runDailyAssetRetentionSweep,
} from '../src/domain/assetRetentionService.js';

describe('AI 历史素材每日保留期扫描', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.poolQuery.mockResolvedValue(result([]));
    mocks.transactionQuery.mockReset();
    mocks.withTransaction.mockReset();
    mocks.scheduleSystemAssetDeletion.mockReset();
    mocks.withTransaction.mockImplementation(async callback => callback({ query: mocks.transactionQuery }));
    mocks.scheduleSystemAssetDeletion.mockResolvedValue(1);
    resetAssetRetentionSweepMemoryForTests();
  });

  it('北京时间 02:59:59 不扫描，03:00:00 开始扫描', () => {
    expect(getAssetRetentionSchedule(new Date('2026-07-16T18:59:59.999Z'))).toEqual({
      businessDate: '2026-07-17',
      due: false,
    });
    expect(getAssetRetentionSchedule(new Date('2026-07-16T19:00:00.000Z'))).toEqual({
      businessDate: '2026-07-17',
      due: true,
    });
  });

  it('03:00 前只检查历史过期租约，不创建当天扫描', async () => {
    await expect(runDailyAssetRetentionSweep({
      now: new Date('2026-07-16T18:59:59.999Z'),
    })).resolves.toEqual({
      businessDate: '2026-07-17', status: 'not-due', scanned: 0, scheduled: 0,
    });
    expect(mocks.poolQuery).toHaveBeenCalledOnce();
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain('WITH recoverable AS');
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain("business_date + time '03:00'");
    expect(mocks.poolQuery.mock.calls[0]?.[1]).toEqual([
      120_000,
      new Date('2026-07-16T18:59:59.999Z'),
    ]);
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).not.toContain('INSERT INTO asset_retention_sweep_runs');
  });

  it('北京时间 02:59 可接管昨天中断且租约已过期的扫描', async () => {
    mocks.poolQuery.mockResolvedValueOnce(result([{
      ...claimedRun(),
      business_date: '2026-07-16',
      scanned_count: 4,
      scheduled_count: 4,
    }]));
    mocks.transactionQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('lease_expires_at > now()')) return result([{ scanned_count: 4, scheduled_count: 4 }]);
      if (query.includes('SELECT EXISTS')) return result([{ remaining: false }]);
      if (query.includes("code = 'free'") && query.includes('SELECT 1')) return result([{ '?column?': 1 }]);
      if (query.includes('FOR UPDATE OF asset SKIP LOCKED')) return result([]);
      if (query.includes("SET status = 'completed'")) return result([{ scanned_count: 4, scheduled_count: 4 }]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(runDailyAssetRetentionSweep({
      now: new Date('2026-07-16T18:59:59.999Z'),
    })).resolves.toEqual({
      businessDate: '2026-07-16', status: 'completed', scanned: 4, scheduled: 4,
    });
    expect(mocks.poolQuery).toHaveBeenCalledOnce();
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain('ORDER BY business_date ASC');
  });

  it('下午补跑仍以当天北京时间 03:00 为截止点并完成全部批次', async () => {
    mockClaimedRun();
    let candidateRead = 0;
    mocks.transactionQuery.mockImplementation(async (sql: unknown, values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('UPDATE asset_retention_sweep_runs') && query.includes('lease_expires_at > now()')) {
        return result([{ scanned_count: candidateRead, scheduled_count: candidateRead }]);
      }
      if (query.includes('SELECT EXISTS')) return result([{ remaining: false }]);
      if (query.includes("code = 'free'") && query.includes('SELECT 1')) return result([{ '?column?': 1 }]);
      if (query.includes('FOR UPDATE OF asset SKIP LOCKED')) {
        expect(query).toContain("asset.source IN ('ai-video', 'ai-image')");
        expect(query).toContain("$1::date + time '03:00'");
        expect(query).toContain("current_plan.kind = 'main'");
        expect(query).toContain('account.plan_expires_at > $1::date');
        expect(values).toEqual(['2026-07-17', 100]);
        candidateRead += 1;
        return candidateRead === 1
          ? result([{ id: ASSET_ID, user_id: USER_ID, object_key: 'ai/video.mp4', thumbnail_key: 'ai/video.jpg' }])
          : result([]);
      }
      if (query.includes('scanned_count = scanned_count +')) {
        return result([{ scanned_count: 1, scheduled_count: 1 }]);
      }
      if (query.includes("SET status = 'completed'")) {
        return result([{ scanned_count: 1, scheduled_count: 1 }]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(runDailyAssetRetentionSweep({
      now: new Date('2026-07-17T06:00:00.000Z'),
    })).resolves.toEqual({
      businessDate: '2026-07-17', status: 'completed', scanned: 1, scheduled: 1,
    });
    expect(mocks.scheduleSystemAssetDeletion).toHaveBeenCalledWith(
      expect.any(Object),
      [{ id: ASSET_ID, userId: USER_ID }],
    );

    await expect(runDailyAssetRetentionSweep({
      now: new Date('2026-07-17T07:00:00.000Z'),
    })).resolves.toMatchObject({ status: 'already-completed' });
    expect(mocks.poolQuery).toHaveBeenCalledTimes(3);
  });

  it('活动租约不重复执行，过期租约由领取 SQL 原子接管', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{
        business_date: '2026-07-17', status: 'running', claim_token: 'active-token',
        scanned_count: 4, scheduled_count: 4,
      }]));

    await expect(runDailyAssetRetentionSweep({
      now: new Date('2026-07-17T06:00:00.000Z'),
      bypassMemoryCache: true,
    })).resolves.toEqual({
      businessDate: '2026-07-17', status: 'already-running', scanned: 4, scheduled: 4,
    });
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain('lease_expires_at <= now()');
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain('attempt_count + 1');
  });

  it('旧 token 无法续租时立即停止且不能写完成状态', async () => {
    mockClaimedRun();
    mocks.transactionQuery.mockResolvedValue(result([]));

    await expect(runDailyAssetRetentionSweep({
      now: new Date('2026-07-17T06:00:00.000Z'),
    })).resolves.toEqual({
      businessDate: '2026-07-17', status: 'lost-lease', scanned: 0, scheduled: 0,
    });
    expect(mocks.scheduleSystemAssetDeletion).not.toHaveBeenCalled();
    expect(mocks.transactionQuery.mock.calls.some(([sql]) => String(sql).includes("SET status = 'completed'"))).toBe(false);
  });

  it('SKIP LOCKED 暂时看不到候选时不误标完成并释放租约供下轮重试', async () => {
    mockClaimedRun();
    mocks.transactionQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('lease_expires_at > now()')) return result([{ scanned_count: 0, scheduled_count: 0 }]);
      if (query.includes('SELECT EXISTS')) return result([{ remaining: true }]);
      if (query.includes("code = 'free'") && query.includes('SELECT 1')) return result([{ '?column?': 1 }]);
      if (query.includes('FOR UPDATE OF asset SKIP LOCKED')) return result([]);
      if (query.includes("last_error_code = 'RETENTION_CANDIDATES_LOCKED'")) return result([]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(runDailyAssetRetentionSweep({
      now: new Date('2026-07-17T06:00:00.000Z'),
    })).resolves.toMatchObject({ status: 'deferred' });
    expect(mocks.transactionQuery.mock.calls.some(([sql]) => String(sql).includes("SET status = 'completed'"))).toBe(false);
  });

  it('免费策略缺失时失败关闭且只释放当前 claim，不删除任何素材', async () => {
    mockClaimedRun();
    mocks.transactionQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('lease_expires_at > now()')) return result([{ scanned_count: 0, scheduled_count: 0 }]);
      if (query.includes("code = 'free'") && query.includes('SELECT 1')) return result([]);
      throw new Error(`未预期的查询：${query}`);
    });
    mocks.poolQuery.mockResolvedValueOnce(result([]));

    await expect(runDailyAssetRetentionSweep({
      now: new Date('2026-07-17T06:00:00.000Z'),
    })).rejects.toMatchObject({ code: 'FREE_RETENTION_PLAN_MISSING' });
    expect(mocks.scheduleSystemAssetDeletion).not.toHaveBeenCalled();
    expect(String(mocks.poolQuery.mock.calls.at(-1)?.[0])).toContain('last_error_code = $3');
  });
});

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const CLAIM_TOKEN = '33333333-3333-4333-8333-333333333333';

function mockClaimedRun() {
  mocks.poolQuery
    .mockResolvedValueOnce(result([]))
    .mockResolvedValueOnce(result([claimedRun()]));
}

function claimedRun() {
  return {
    business_date: '2026-07-17',
    status: 'running',
    claim_token: CLAIM_TOKEN,
    scanned_count: 0,
    scheduled_count: 0,
  };
}

function result(rows: unknown[]) {
  return { rowCount: rows.length, rows };
}
