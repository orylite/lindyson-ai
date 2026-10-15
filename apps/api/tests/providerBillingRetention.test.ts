import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  poolConnect: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { connect: mocks.poolConnect, query: vi.fn(), end: vi.fn() },
}));

import { env } from '../src/config/env.js';
import { runProviderBillingRetentionSweep } from '../src/domain/providerBillingRetention.js';

type Call = { sql: string; values: unknown[] };

function normalize(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

function calls(): Call[] {
  return mocks.clientQuery.mock.calls.map(([sql, values]) => ({
    sql: normalize(String(sql)),
    values: (values ?? []) as unknown[],
  }));
}

function isLock(sql: string) {
  return sql.includes('pg_try_advisory_lock');
}

function isUnlock(sql: string) {
  return sql.includes('pg_advisory_unlock');
}

function isRunCandidates(sql: string) {
  return sql.startsWith('WITH keepers AS MATERIALIZED') && sql.includes('SELECT runs.id::text AS id FROM provider_billing_sync_runs runs');
}

function isRunItemsDelete(sql: string) {
  return sql.includes('DELETE FROM provider_bill_sync_run_items');
}

function isSnapshotDelete(sql: string) {
  return sql.includes('DELETE FROM provider_resource_package_snapshots');
}

function isSyncRunDelete(sql: string) {
  return sql.includes('DELETE FROM provider_billing_sync_runs');
}

/**
 * 以内存状态模拟三张表：候选 run 查询返回仍有 run_items 的 run，删除按批次递减。
 */
function installScriptedDatabase(state: {
  locked?: boolean;
  runItemsByRun: Map<string, number>;
  snapshots: number;
  syncRuns: number;
}) {
  mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
    const text = normalize(sql);
    if (isLock(text)) return { rows: [{ locked: state.locked ?? true }], rowCount: 1 };
    if (isUnlock(text)) return { rows: [], rowCount: 0 };
    if (isRunCandidates(text)) {
      const limit = Number(values[1]);
      const ids = [...state.runItemsByRun.entries()]
        .filter(([, remaining]) => remaining > 0)
        .map(([id]) => ({ id }))
        .slice(0, limit);
      return { rows: ids, rowCount: ids.length };
    }
    if (isRunItemsDelete(text)) {
      const runIds = values[0] as string[];
      const batchSize = Number(values[1]);
      let deleted = 0;
      for (const runId of runIds) {
        const remaining = state.runItemsByRun.get(runId) ?? 0;
        const take = Math.min(remaining, batchSize - deleted);
        state.runItemsByRun.set(runId, remaining - take);
        deleted += take;
        if (deleted >= batchSize) break;
      }
      return { rows: [], rowCount: deleted };
    }
    if (isSnapshotDelete(text)) {
      const batchSize = Number(values[1]);
      const deleted = Math.min(state.snapshots, batchSize);
      state.snapshots -= deleted;
      return { rows: [], rowCount: deleted };
    }
    if (isSyncRunDelete(text)) {
      const batchSize = Number(values[1]);
      const deleted = Math.min(state.syncRuns, batchSize);
      state.syncRuns -= deleted;
      return { rows: [], rowCount: deleted };
    }
    throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
  });
}

describe('火山账单同步数据保留清理', () => {
  beforeEach(() => {
    mocks.clientQuery.mockReset();
    mocks.clientRelease.mockReset();
    mocks.poolConnect.mockReset();
    mocks.poolConnect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.clientRelease });
  });

  it('按 run_items → 快照 → sync_runs 的外键顺序分批删除，并在完成后释放锁与连接', async () => {
    installScriptedDatabase({
      runItemsByRun: new Map([['run-a', 7], ['run-b', 3]]),
      snapshots: 5,
      syncRuns: 2,
    });

    const result = await runProviderBillingRetentionSweep({
      runItemsRetentionDays: 30,
      packageSnapshotsRetentionDays: 30,
      syncRunsRetentionDays: 90,
      batchSize: 4,
      batchPauseMs: 0,
    });

    expect(result).toEqual({
      status: 'completed',
      runItems: 10,
      packageSnapshots: 5,
      syncRuns: 2,
      batches: 3 + 2 + 1,
    });
    const sequence = calls().map(call => {
      if (isLock(call.sql)) return 'lock';
      if (isUnlock(call.sql)) return 'unlock';
      if (isRunCandidates(call.sql)) return 'candidates';
      if (isRunItemsDelete(call.sql)) return 'items';
      if (isSnapshotDelete(call.sql)) return 'snapshots';
      if (isSyncRunDelete(call.sql)) return 'runs';
      return 'other';
    });
    expect(sequence[0]).toBe('lock');
    expect(sequence.at(-1)).toBe('unlock');
    const firstSnapshot = sequence.indexOf('snapshots');
    const firstRun = sequence.indexOf('runs');
    const lastItems = sequence.lastIndexOf('items');
    expect(lastItems).toBeLessThan(firstSnapshot);
    expect(firstSnapshot).toBeLessThan(firstRun);
    expect(sequence.filter(step => step === 'items')).toHaveLength(3);
    expect(sequence.filter(step => step === 'snapshots')).toHaveLength(2);
    expect(sequence.filter(step => step === 'runs')).toHaveLength(1);
    expect(mocks.clientRelease).toHaveBeenCalledOnce();
  });

  it('每批都带 LIMIT 与 FOR UPDATE SKIP LOCKED，保留天数作为参数传入', async () => {
    installScriptedDatabase({
      runItemsByRun: new Map([['run-a', 1]]),
      snapshots: 1,
      syncRuns: 1,
    });

    await runProviderBillingRetentionSweep({
      runItemsRetentionDays: 31,
      packageSnapshotsRetentionDays: 32,
      syncRunsRetentionDays: 93,
      batchSize: 2_000,
      batchPauseMs: 0,
    });

    const all = calls();
    const candidates = all.find(call => isRunCandidates(call.sql))!;
    expect(candidates.values[0]).toBe(31);
    const items = all.find(call => isRunItemsDelete(call.sql))!;
    expect(items.sql).toContain('LIMIT $2 FOR UPDATE SKIP LOCKED');
    expect(items.values).toEqual([['run-a'], 2_000]);
    const snapshots = all.find(call => isSnapshotDelete(call.sql))!;
    expect(snapshots.sql).toContain('LIMIT $2 )');
    expect(snapshots.values).toEqual([32, 2_000]);
    const runs = all.find(call => isSyncRunDelete(call.sql))!;
    expect(runs.sql).toContain('LIMIT $2 FOR UPDATE SKIP LOCKED');
    expect(runs.values).toEqual([93, 2_000]);
    expect(all.some(call => call.sql.startsWith('BEGIN'))).toBe(false);
  });

  it('run_items 只删被更新成功同步完整覆盖窗口的旧 run，取代者本身也必须早于截止时间且仍有明细', async () => {
    installScriptedDatabase({ runItemsByRun: new Map(), snapshots: 0, syncRuns: 0 });

    await runProviderBillingRetentionSweep({ batchPauseMs: 0 });

    const candidates = calls().find(call => isRunCandidates(call.sql))!;
    expect(candidates.sql).toContain("runs.kind = 'bill'");
    expect(candidates.sql).toContain("runs.status = 'success'");
    expect(candidates.sql).toContain("runs.started_at < now() - ($1::int * interval '1 day')");
    expect(candidates.sql).toContain('WITH keepers AS MATERIALIZED ( SELECT DISTINCT ON (runs.provider, runs.window_start, runs.window_end)');
    expect(candidates.sql).toContain("runs.completed_at < now() - ($1::int * interval '1 day') AND EXISTS ( SELECT 1 FROM provider_bill_sync_run_items items WHERE items.sync_run_id = runs.id ) ORDER BY runs.provider, runs.window_start, runs.window_end, runs.completed_at DESC, runs.id DESC");
    expect(candidates.sql).toContain('FROM keepers newer WHERE newer.provider = runs.provider AND newer.window_start <= runs.window_start AND newer.window_end >= runs.window_end AND (newer.completed_at, newer.id) > (runs.completed_at, runs.id)');
    expect(candidates.values).toEqual([30, 500]);
  });

  it('资源包快照只删无成本事件引用、非最新且与上一条 payload 相同的旧快照', async () => {
    installScriptedDatabase({ runItemsByRun: new Map(), snapshots: 0, syncRuns: 0 });

    await runProviderBillingRetentionSweep({ batchPauseMs: 0 });

    const snapshots = calls().find(call => isSnapshotDelete(call.sql))!;
    expect(snapshots.sql).toContain('lag(snapshots.payload_hash) OVER w AS previous_hash, lead(snapshots.id) OVER w AS next_id');
    expect(snapshots.sql).toContain('WINDOW w AS (PARTITION BY snapshots.provider, snapshots.package_id ORDER BY snapshots.captured_at, snapshots.id)');
    expect(snapshots.sql).toContain("ranked.captured_at < now() - ($1::int * interval '1 day')");
    expect(snapshots.sql).toContain('ranked.next_id IS NOT NULL AND ranked.previous_hash = ranked.payload_hash');
    expect(snapshots.sql).toContain('NOT EXISTS ( SELECT 1 FROM provider_resource_package_cost_events events WHERE events.source_snapshot_id = ranked.id )');
  });

  it('sync_runs 只删没有 run_items、revision 和快照引用的旧记录', async () => {
    installScriptedDatabase({ runItemsByRun: new Map(), snapshots: 0, syncRuns: 0 });

    await runProviderBillingRetentionSweep({ batchPauseMs: 0 });

    const runs = calls().find(call => isSyncRunDelete(call.sql))!;
    expect(runs.sql).toContain("runs.started_at < now() - ($1::int * interval '1 day')");
    expect(runs.sql).toContain('NOT EXISTS ( SELECT 1 FROM provider_bill_sync_run_items items WHERE items.sync_run_id = runs.id )');
    expect(runs.sql).toContain('NOT EXISTS ( SELECT 1 FROM provider_bill_detail_revisions revisions WHERE revisions.sync_run_id = runs.id )');
    expect(runs.sql).toContain('NOT EXISTS ( SELECT 1 FROM provider_resource_package_snapshots snapshots WHERE snapshots.sync_run_id = runs.id )');
  });

  it('默认参数取自环境变量', async () => {
    installScriptedDatabase({ runItemsByRun: new Map(), snapshots: 0, syncRuns: 0 });
    const original = {
      items: env.VOLC_BILLING_RUN_ITEMS_RETENTION_DAYS,
      snapshots: env.VOLC_BILLING_PACKAGE_SNAPSHOTS_RETENTION_DAYS,
      runs: env.VOLC_BILLING_SYNC_RUNS_RETENTION_DAYS,
      batch: env.VOLC_BILLING_RETENTION_BATCH_SIZE,
    };
    env.VOLC_BILLING_RUN_ITEMS_RETENTION_DAYS = 11;
    env.VOLC_BILLING_PACKAGE_SNAPSHOTS_RETENTION_DAYS = 12;
    env.VOLC_BILLING_SYNC_RUNS_RETENTION_DAYS = 13;
    env.VOLC_BILLING_RETENTION_BATCH_SIZE = 123;
    try {
      await runProviderBillingRetentionSweep({ batchPauseMs: 0 });
    } finally {
      env.VOLC_BILLING_RUN_ITEMS_RETENTION_DAYS = original.items;
      env.VOLC_BILLING_PACKAGE_SNAPSHOTS_RETENTION_DAYS = original.snapshots;
      env.VOLC_BILLING_SYNC_RUNS_RETENTION_DAYS = original.runs;
      env.VOLC_BILLING_RETENTION_BATCH_SIZE = original.batch;
    }

    const all = calls();
    expect(all.find(call => isRunCandidates(call.sql))!.values[0]).toBe(11);
    expect(all.find(call => isSnapshotDelete(call.sql))!.values).toEqual([12, 123]);
    expect(all.find(call => isSyncRunDelete(call.sql))!.values).toEqual([13, 123]);
  });

  it('拿不到 advisory lock 时直接返回 already-running，不执行任何删除也不解锁', async () => {
    installScriptedDatabase({
      locked: false,
      runItemsByRun: new Map([['run-a', 5]]),
      snapshots: 5,
      syncRuns: 5,
    });

    const result = await runProviderBillingRetentionSweep({ batchPauseMs: 0 });

    expect(result).toEqual({
      status: 'already-running',
      runItems: 0,
      packageSnapshots: 0,
      syncRuns: 0,
      batches: 0,
    });
    const all = calls();
    expect(all).toHaveLength(1);
    expect(isLock(all[0]!.sql)).toBe(true);
    expect(mocks.clientRelease).toHaveBeenCalledOnce();
  });

  it('批次预算耗尽时停止并标记 budget-exhausted，剩余留给下一次', async () => {
    installScriptedDatabase({
      runItemsByRun: new Map([['run-a', 100]]),
      snapshots: 100,
      syncRuns: 100,
    });

    const result = await runProviderBillingRetentionSweep({
      batchSize: 10,
      maxBatches: 3,
      batchPauseMs: 0,
    });

    expect(result).toEqual({
      status: 'budget-exhausted',
      runItems: 30,
      packageSnapshots: 0,
      syncRuns: 0,
      batches: 3,
    });
    expect(calls().some(call => isSnapshotDelete(call.sql))).toBe(false);
    expect(calls().some(call => isSyncRunDelete(call.sql))).toBe(false);
    expect(calls().at(-1)!.sql).toContain('pg_advisory_unlock');
  });

  it('停止信号在当前批次提交后生效，返回 stopped 并释放锁', async () => {
    installScriptedDatabase({
      runItemsByRun: new Map([['run-a', 100]]),
      snapshots: 100,
      syncRuns: 100,
    });
    // 完成两批 run_items 删除后请求停止；remaining 每批会被读取多次，所以按已执行的删除批次判断。
    const shouldContinue = () => calls().filter(call => isRunItemsDelete(call.sql)).length < 2;

    const result = await runProviderBillingRetentionSweep({
      batchSize: 10,
      batchPauseMs: 0,
      shouldContinue,
    });

    expect(result).toEqual({
      status: 'stopped',
      runItems: 20,
      packageSnapshots: 0,
      syncRuns: 0,
      batches: 2,
    });
    expect(calls().at(-1)!.sql).toContain('pg_advisory_unlock');
    expect(mocks.clientRelease).toHaveBeenCalledOnce();
  });

  it('删除中途失败仍释放锁与连接并抛出原错误', async () => {
    installScriptedDatabase({ runItemsByRun: new Map([['run-a', 1]]), snapshots: 0, syncRuns: 0 });
    const base = mocks.clientQuery.getMockImplementation()!;
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (isRunItemsDelete(normalize(sql))) throw new Error('deadlock detected');
      return base(sql, values);
    });

    await expect(runProviderBillingRetentionSweep({ batchPauseMs: 0 })).rejects.toThrow('deadlock detected');

    expect(calls().at(-1)!.sql).toContain('pg_advisory_unlock');
    expect(mocks.clientRelease).toHaveBeenCalledOnce();
  });
});
