import { env } from '../config/env.js';
import { pool, type DbClient } from '../db/pool.js';

/**
 * 火山账单同步数据保留。
 *
 * 成本报表按"覆盖某天、completed_at 最新的成功 bill run → 该 run 的 run_items → revision"
 * 取数，并允许用户指定历史 asOf。因此这里不能按年龄裸删：
 *
 * - run_items 只删"被更新的成功 run 完整覆盖窗口"的旧 run，且取代者本身也早于截止时间，
 *   保证 asOf 在保留窗口内的所有报表视图逐行不变；每个账期最后一次同步的明细永久保留。
 * - 资源包快照只删"连续重复"的旧快照：不是该 package 的最新快照、没有成本事件引用、
 *   payload_hash 与紧邻的上一条相同（一次窗口函数扫描判定，不用逐行相关子查询）。每个 package 的最新快照与全部 payload 变化点永久保留，
 *   `min/max(total_quota)` 之类的历史判断不受影响。
 * - sync_runs 只删没有任何 RESTRICT 引用（run_items、revision、快照）的旧记录；
 *   `provider_reconciliation_runs.official_sync_run_id` 与 `provider_bill_details.last_seen_run_id`
 *   是 SET NULL，置空后对同步与报表无副作用。
 *
 * 每批自动提交、不开长事务；单次扫描有批次上限，剩余留到下一次。
 */

const ADVISORY_LOCK_KEY = 'lindyson-provider-billing-retention';
const DEFAULT_MAX_BATCHES = 400;
const DEFAULT_BATCH_PAUSE_MS = 50;
const CANDIDATE_RUNS_PER_BATCH = 500;

export interface ProviderBillingRetentionOptions {
  runItemsRetentionDays?: number;
  packageSnapshotsRetentionDays?: number;
  syncRunsRetentionDays?: number;
  batchSize?: number;
  maxBatches?: number;
  batchPauseMs?: number;
  /** 返回 false 时在当前批次提交后停止，供 worker 关闭时使用。 */
  shouldContinue?: () => boolean;
  client?: DbClient & { release?: () => void };
}

export interface ProviderBillingRetentionResult {
  status: 'completed' | 'budget-exhausted' | 'already-running' | 'stopped';
  runItems: number;
  packageSnapshots: number;
  syncRuns: number;
  batches: number;
}

export async function runProviderBillingRetentionSweep(
  options: ProviderBillingRetentionOptions = {},
): Promise<ProviderBillingRetentionResult> {
  const runItemsRetentionDays = positiveInt(options.runItemsRetentionDays, env.VOLC_BILLING_RUN_ITEMS_RETENTION_DAYS);
  const packageSnapshotsRetentionDays = positiveInt(
    options.packageSnapshotsRetentionDays,
    env.VOLC_BILLING_PACKAGE_SNAPSHOTS_RETENTION_DAYS,
  );
  const syncRunsRetentionDays = positiveInt(options.syncRunsRetentionDays, env.VOLC_BILLING_SYNC_RUNS_RETENTION_DAYS);
  const batchSize = positiveInt(options.batchSize, env.VOLC_BILLING_RETENTION_BATCH_SIZE);
  const maxBatches = positiveInt(options.maxBatches, DEFAULT_MAX_BATCHES);
  const batchPauseMs = Math.max(0, Math.trunc(options.batchPauseMs ?? DEFAULT_BATCH_PAUSE_MS));
  const shouldContinue = options.shouldContinue ?? (() => true);

  const client = options.client ?? await pool.connect();
  const ownsClient = !options.client;
  let locked = false;
  const result: ProviderBillingRetentionResult = {
    status: 'completed',
    runItems: 0,
    packageSnapshots: 0,
    syncRuns: 0,
    batches: 0,
  };
  let stopped = false;
  const budget: Budget = {
    get remaining() {
      if (stopped) return 0;
      if (!shouldContinue()) {
        stopped = true;
        return 0;
      }
      return maxBatches - result.batches;
    },
    async spend(deleted: number) {
      result.batches += 1;
      if (deleted > 0 && batchPauseMs > 0) await sleep(batchPauseMs);
    },
  };

  try {
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
      [ADVISORY_LOCK_KEY],
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { ...result, status: 'already-running' };

    // 外键顺序：run_items 与快照都引用 sync_runs，先清子表，最后才清运行记录。
    result.runItems = await deleteSupersededRunItems(client, runItemsRetentionDays, batchSize, budget);
    if (budget.remaining > 0) {
      result.packageSnapshots = await deleteDuplicatePackageSnapshots(
        client,
        packageSnapshotsRetentionDays,
        batchSize,
        budget,
      );
    }
    if (budget.remaining > 0) {
      result.syncRuns = await deleteUnreferencedSyncRuns(client, syncRunsRetentionDays, batchSize, budget);
    }
    if (stopped) result.status = 'stopped';
    else if (result.batches >= maxBatches) result.status = 'budget-exhausted';
    return result;
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [ADVISORY_LOCK_KEY])
        .catch(() => undefined);
    }
    if (ownsClient) client.release?.();
  }
}

type Budget = { readonly remaining: number; spend(deleted: number): Promise<void> };

async function deleteSupersededRunItems(
  client: DbClient,
  retentionDays: number,
  batchSize: number,
  budget: Budget,
) {
  let deleted = 0;
  while (budget.remaining > 0) {
    // keepers：每个窗口里 completed_at 最新、仍有明细且早于截止时间的成功 run。
    // 任何能覆盖某 run 的更新 run，都被其所在窗口的 keeper 覆盖或相等，所以只需与 keepers 比较。
    const candidates = await client.query<{ id: string }>(
      `WITH keepers AS MATERIALIZED (
         SELECT DISTINCT ON (runs.provider, runs.window_start, runs.window_end)
                runs.id, runs.provider, runs.window_start, runs.window_end, runs.completed_at
         FROM provider_billing_sync_runs runs
         WHERE runs.kind = 'bill'
           AND runs.status = 'success'
           AND runs.completed_at < now() - ($1::int * interval '1 day')
           AND EXISTS (
             SELECT 1 FROM provider_bill_sync_run_items items
             WHERE items.sync_run_id = runs.id
           )
         ORDER BY runs.provider, runs.window_start, runs.window_end, runs.completed_at DESC, runs.id DESC
       )
       SELECT runs.id::text AS id
       FROM provider_billing_sync_runs runs
       WHERE runs.kind = 'bill'
         AND runs.status = 'success'
         AND runs.started_at < now() - ($1::int * interval '1 day')
         AND EXISTS (
           SELECT 1 FROM provider_bill_sync_run_items items
           WHERE items.sync_run_id = runs.id
         )
         AND EXISTS (
           SELECT 1
           FROM keepers newer
           WHERE newer.provider = runs.provider
             AND newer.window_start <= runs.window_start
             AND newer.window_end >= runs.window_end
             AND (newer.completed_at, newer.id) > (runs.completed_at, runs.id)
         )
       ORDER BY runs.started_at ASC, runs.id ASC
       LIMIT $2`,
      [retentionDays, CANDIDATE_RUNS_PER_BATCH],
    );
    const runIds = candidates.rows.map(row => row.id);
    if (runIds.length === 0) return deleted;

    let exhausted = false;
    while (budget.remaining > 0) {
      const batch = await client.query(
        `WITH doomed AS (
           SELECT sync_run_id, source_detail_key
           FROM provider_bill_sync_run_items
           WHERE sync_run_id = ANY($1::uuid[])
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         DELETE FROM provider_bill_sync_run_items items
         USING doomed
         WHERE items.sync_run_id = doomed.sync_run_id
           AND items.source_detail_key = doomed.source_detail_key`,
        [runIds, batchSize],
      );
      const count = batch.rowCount ?? 0;
      deleted += count;
      await budget.spend(count);
      if (count < batchSize) {
        exhausted = true;
        break;
      }
    }
    if (!exhausted) return deleted;
  }
  return deleted;
}

async function deleteDuplicatePackageSnapshots(
  client: DbClient,
  retentionDays: number,
  batchSize: number,
  budget: Budget,
) {
  let deleted = 0;
  while (budget.remaining > 0) {
    const batch = await client.query(
      `WITH ranked AS (
         SELECT snapshots.id, snapshots.captured_at, snapshots.payload_hash,
                lag(snapshots.payload_hash) OVER w AS previous_hash,
                lead(snapshots.id) OVER w AS next_id
         FROM provider_resource_package_snapshots snapshots
         WINDOW w AS (PARTITION BY snapshots.provider, snapshots.package_id ORDER BY snapshots.captured_at, snapshots.id)
       ), doomed AS (
         SELECT ranked.id
         FROM ranked
         WHERE ranked.captured_at < now() - ($1::int * interval '1 day')
           AND ranked.next_id IS NOT NULL
           AND ranked.previous_hash = ranked.payload_hash
           AND NOT EXISTS (
             SELECT 1 FROM provider_resource_package_cost_events events
             WHERE events.source_snapshot_id = ranked.id
           )
         ORDER BY ranked.captured_at ASC, ranked.id ASC
         LIMIT $2
       )
       DELETE FROM provider_resource_package_snapshots snapshots
       USING doomed
       WHERE snapshots.id = doomed.id`,
      [retentionDays, batchSize],
    );
    const count = batch.rowCount ?? 0;
    deleted += count;
    await budget.spend(count);
    if (count < batchSize) return deleted;
  }
  return deleted;
}

async function deleteUnreferencedSyncRuns(
  client: DbClient,
  retentionDays: number,
  batchSize: number,
  budget: Budget,
) {
  let deleted = 0;
  while (budget.remaining > 0) {
    const batch = await client.query(
      `WITH doomed AS (
         SELECT runs.id
         FROM provider_billing_sync_runs runs
         WHERE runs.started_at < now() - ($1::int * interval '1 day')
           AND NOT EXISTS (
             SELECT 1 FROM provider_bill_sync_run_items items
             WHERE items.sync_run_id = runs.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM provider_bill_detail_revisions revisions
             WHERE revisions.sync_run_id = runs.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM provider_resource_package_snapshots snapshots
             WHERE snapshots.sync_run_id = runs.id
           )
         ORDER BY runs.started_at ASC, runs.id ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM provider_billing_sync_runs runs
       USING doomed
       WHERE runs.id = doomed.id`,
      [retentionDays, batchSize],
    );
    const count = batch.rowCount ?? 0;
    deleted += count;
    await budget.spend(count);
    if (count < batchSize) return deleted;
  }
  return deleted;
}

function positiveInt(value: number | undefined, fallback: number) {
  const candidate = value ?? fallback;
  if (!Number.isFinite(candidate) || candidate < 1) return Math.max(1, Math.trunc(fallback));
  return Math.trunc(candidate);
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}
