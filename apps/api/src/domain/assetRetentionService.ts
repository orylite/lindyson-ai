import { pool, withTransaction, type DbClient } from '../db/pool.js';
import { getBillingDate } from './billingClock.js';
import { scheduleSystemAssetDeletion } from './assetDeletionService.js';

const RETENTION_TIME_ZONE = 'Asia/Shanghai';
const RETENTION_SCAN_HOUR = 3;
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 100;
const DEFAULT_LEASE_MS = 2 * 60_000;

interface SweepRunRow {
  business_date: string;
  status: 'running' | 'completed';
  claim_token: string | null;
  scanned_count: number | string;
  scheduled_count: number | string;
}

interface RetentionCandidateRow {
  id: string;
  user_id: string;
  object_key: string | null;
  thumbnail_key: string | null;
}

export interface AssetRetentionSweepResult {
  businessDate: string;
  status: 'not-due' | 'already-running' | 'already-completed' | 'completed' | 'deferred' | 'lost-lease';
  scanned: number;
  scheduled: number;
}

let settledBusinessDate: string | null = null;

export function getAssetRetentionSchedule(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: RETENTION_TIME_ZONE,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? -1);
  return {
    businessDate: getBillingDate(now),
    due: hour >= RETENTION_SCAN_HOUR,
  };
}

export async function runDailyAssetRetentionSweep(options: {
  now?: Date;
  batchSize?: number;
  leaseMs?: number;
  bypassMemoryCache?: boolean;
} = {}): Promise<AssetRetentionSweepResult> {
  const now = options.now ?? new Date();
  const schedule = getAssetRetentionSchedule(now);
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, Math.trunc(options.batchSize ?? DEFAULT_BATCH_SIZE)));
  const leaseMs = Math.max(1_000, Math.trunc(options.leaseMs ?? DEFAULT_LEASE_MS));
  // 中断可能跨过北京时间午夜。先接管所有历史业务日期中最早的过期租约，
  // 再判断当天是否到 03:00，避免旧运行记录永久停在 running。
  const recovered = await claimExpiredSweepRun(leaseMs, now);
  if (recovered) return processClaimedSweep(recovered, batchSize, leaseMs);

  if (!schedule.due) return emptyResult(schedule.businessDate, 'not-due');
  if (!options.bypassMemoryCache && settledBusinessDate === schedule.businessDate) {
    return emptyResult(schedule.businessDate, 'already-completed');
  }

  const claim = await claimSweepRun(schedule.businessDate, leaseMs);
  if (!claim.claimToken) {
    if (claim.status === 'completed') settledBusinessDate = schedule.businessDate;
    return {
      businessDate: schedule.businessDate,
      status: claim.status === 'completed' ? 'already-completed' : 'already-running',
      scanned: claim.scanned,
      scheduled: claim.scheduled,
    };
  }

  return processClaimedSweep({ ...claim, businessDate: schedule.businessDate }, batchSize, leaseMs);
}

async function processClaimedSweep(
  claim: {
    businessDate: string;
    claimToken: string;
    scanned: number;
    scheduled: number;
  },
  batchSize: number,
  leaseMs: number,
): Promise<AssetRetentionSweepResult> {
  let scanned = claim.scanned;
  let scheduled = claim.scheduled;
  try {
    while (true) {
      const batch = await processRetentionBatch({
        businessDate: claim.businessDate,
        claimToken: claim.claimToken,
        batchSize,
        leaseMs,
      });
      scanned = batch.scanned;
      scheduled = batch.scheduled;
      if (batch.status === 'continue') continue;
      if (batch.status === 'completed') settledBusinessDate = claim.businessDate;
      return {
        businessDate: claim.businessDate,
        status: batch.status,
        scanned,
        scheduled,
      };
    }
  } catch (error) {
    await releaseFailedClaim(claim.businessDate, claim.claimToken, safeErrorCode(error));
    throw error;
  }
}

export function resetAssetRetentionSweepMemoryForTests() {
  settledBusinessDate = null;
}

async function claimExpiredSweepRun(leaseMs: number, now: Date) {
  const claimed = await pool.query<SweepRunRow>(
    `WITH recoverable AS (
       SELECT business_date
       FROM asset_retention_sweep_runs
       WHERE status = 'running'
         AND lease_expires_at <= now()
         AND ((business_date + time '03:00') AT TIME ZONE 'Asia/Shanghai') <= $2::timestamptz
       ORDER BY business_date ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE asset_retention_sweep_runs run
     SET claim_token = gen_random_uuid(),
         lease_expires_at = now() + ($1::double precision * interval '1 millisecond'),
         attempt_count = run.attempt_count + 1,
         last_error_code = NULL,
         updated_at = now()
     FROM recoverable
     WHERE run.business_date = recoverable.business_date
       AND run.status = 'running'
       AND run.lease_expires_at <= now()
     RETURNING run.business_date::text, run.status, run.claim_token,
               run.scanned_count, run.scheduled_count`,
    [leaseMs, now],
  );
  const row = claimed.rows[0];
  if (!row?.claim_token) return null;
  return {
    businessDate: row.business_date,
    claimToken: row.claim_token,
    scanned: toCount(row.scanned_count),
    scheduled: toCount(row.scheduled_count),
  };
}

async function claimSweepRun(businessDate: string, leaseMs: number) {
  const claimed = await pool.query<SweepRunRow>(
    `INSERT INTO asset_retention_sweep_runs (
       business_date, status, claim_token, lease_expires_at, attempt_count
     )
     VALUES ($1::date, 'running', gen_random_uuid(), now() + ($2::double precision * interval '1 millisecond'), 1)
     ON CONFLICT (business_date) DO UPDATE
     SET claim_token = gen_random_uuid(),
         lease_expires_at = now() + ($2::double precision * interval '1 millisecond'),
         attempt_count = asset_retention_sweep_runs.attempt_count + 1,
         last_error_code = NULL,
         updated_at = now()
     WHERE asset_retention_sweep_runs.status = 'running'
       AND asset_retention_sweep_runs.lease_expires_at <= now()
     RETURNING business_date::text, status, claim_token,
               scanned_count, scheduled_count`,
    [businessDate, leaseMs],
  );
  const row = claimed.rows[0];
  if (row?.claim_token) {
    return {
      status: row.status,
      claimToken: row.claim_token,
      scanned: toCount(row.scanned_count),
      scheduled: toCount(row.scheduled_count),
    };
  }

  const existing = await pool.query<SweepRunRow>(
    `SELECT business_date::text, status, claim_token, scanned_count, scheduled_count
     FROM asset_retention_sweep_runs
     WHERE business_date = $1::date
     LIMIT 1`,
    [businessDate],
  );
  const current = existing.rows[0];
  return {
    status: current?.status ?? 'running',
    claimToken: null,
    scanned: toCount(current?.scanned_count),
    scheduled: toCount(current?.scheduled_count),
  };
}

async function processRetentionBatch(input: {
  businessDate: string;
  claimToken: string;
  batchSize: number;
  leaseMs: number;
}) {
  return withTransaction(async client => {
    const ownership = await client.query<{
      scanned_count: number | string;
      scheduled_count: number | string;
    }>(
      `UPDATE asset_retention_sweep_runs
       SET lease_expires_at = now() + ($3::double precision * interval '1 millisecond'),
           updated_at = now()
       WHERE business_date = $1::date
         AND status = 'running'
         AND claim_token = $2::uuid
         AND lease_expires_at > now()
       RETURNING scanned_count, scheduled_count`,
      [input.businessDate, input.claimToken, input.leaseMs],
    );
    const run = ownership.rows[0];
    if (!run) {
      return { status: 'lost-lease' as const, scanned: 0, scheduled: 0 };
    }

    await assertFreeRetentionPlan(client);
    const candidates = await client.query<RetentionCandidateRow>(
      `SELECT asset.id, asset.user_id, asset.object_key, asset.thumbnail_key
       ${RETENTION_POLICY_FROM_WHERE}
       ORDER BY asset.created_at ASC, asset.id ASC
       FOR UPDATE OF asset SKIP LOCKED
       LIMIT $2`,
      [input.businessDate, input.batchSize],
    );

    if (!candidates.rowCount) {
      const remaining = await client.query<{ remaining: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           ${RETENTION_POLICY_FROM_WHERE}
         ) AS remaining`,
        [input.businessDate],
      );
      if (remaining.rows[0]?.remaining) {
        await client.query(
          `UPDATE asset_retention_sweep_runs
           SET lease_expires_at = now(),
               last_error_code = 'RETENTION_CANDIDATES_LOCKED',
               updated_at = now()
           WHERE business_date = $1::date
             AND status = 'running'
             AND claim_token = $2::uuid`,
          [input.businessDate, input.claimToken],
        );
        return {
          status: 'deferred' as const,
          scanned: toCount(run.scanned_count),
          scheduled: toCount(run.scheduled_count),
        };
      }

      const completed = await client.query<{
        scanned_count: number | string;
        scheduled_count: number | string;
      }>(
        `UPDATE asset_retention_sweep_runs
         SET status = 'completed',
             claim_token = NULL,
             lease_expires_at = NULL,
             completed_at = now(),
             last_error_code = NULL,
             updated_at = now()
         WHERE business_date = $1::date
           AND status = 'running'
           AND claim_token = $2::uuid
         RETURNING scanned_count, scheduled_count`,
        [input.businessDate, input.claimToken],
      );
      const finalRun = completed.rows[0];
      if (!finalRun) return { status: 'lost-lease' as const, scanned: 0, scheduled: 0 };
      return {
        status: 'completed' as const,
        scanned: toCount(finalRun.scanned_count),
        scheduled: toCount(finalRun.scheduled_count),
      };
    }

    const scheduledInBatch = await scheduleSystemAssetDeletion(
      client,
      candidates.rows.map(candidate => ({ id: candidate.id, userId: candidate.user_id })),
    );
    if (scheduledInBatch !== candidates.rows.length) {
      throw Object.assign(new Error('保留期候选素材未能完整进入删除流程'), {
        code: 'RETENTION_SCHEDULE_COUNT_MISMATCH',
      });
    }

    const updated = await client.query<{
      scanned_count: number | string;
      scheduled_count: number | string;
    }>(
      `UPDATE asset_retention_sweep_runs
       SET scanned_count = scanned_count + $3,
           scheduled_count = scheduled_count + $4,
           lease_expires_at = now() + ($5::double precision * interval '1 millisecond'),
           last_error_code = NULL,
           updated_at = now()
       WHERE business_date = $1::date
         AND status = 'running'
         AND claim_token = $2::uuid
       RETURNING scanned_count, scheduled_count`,
      [input.businessDate, input.claimToken, candidates.rows.length, scheduledInBatch, input.leaseMs],
    );
    const nextRun = updated.rows[0];
    if (!nextRun) return { status: 'lost-lease' as const, scanned: 0, scheduled: 0 };
    return {
      status: 'continue' as const,
      scanned: toCount(nextRun.scanned_count),
      scheduled: toCount(nextRun.scheduled_count),
    };
  });
}

const RETENTION_POLICY_FROM_WHERE = `FROM assets asset
  JOIN users account ON account.id = asset.user_id
  LEFT JOIN plans current_plan ON current_plan.id = account.plan_id
  JOIN plans free_plan ON free_plan.code = 'free' AND free_plan.kind = 'main'
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN account.plan_id IS NOT NULL
       AND current_plan.kind = 'main'
       AND (account.plan_expires_at IS NULL OR account.plan_expires_at > $1::date)
        THEN current_plan.asset_retention_days
      ELSE free_plan.asset_retention_days
    END::integer AS retention_days
  ) retention_policy
  WHERE asset.deletion_status = 'active'
    AND asset.source IN ('ai-video', 'ai-image')
    AND retention_policy.retention_days > 0
    AND asset.created_at <= (
      (($1::date + time '03:00') AT TIME ZONE 'Asia/Shanghai')
      - retention_policy.retention_days * interval '1 day'
    )`;

async function assertFreeRetentionPlan(client: DbClient) {
  const result = await client.query(
    `SELECT 1
     FROM plans
     WHERE code = 'free' AND kind = 'main'
     LIMIT 1`,
  );
  if (!result.rowCount) {
    throw Object.assign(new Error('免费版素材保留策略不存在'), {
      code: 'FREE_RETENTION_PLAN_MISSING',
    });
  }
}

async function releaseFailedClaim(businessDate: string, claimToken: string, errorCode: string) {
  await pool.query(
    `UPDATE asset_retention_sweep_runs
     SET lease_expires_at = now(),
         last_error_code = $3,
         updated_at = now()
     WHERE business_date = $1::date
       AND status = 'running'
       AND claim_token = $2::uuid`,
    [businessDate, claimToken, errorCode],
  ).catch(() => undefined);
}

function emptyResult(businessDate: string, status: AssetRetentionSweepResult['status']): AssetRetentionSweepResult {
  return { businessDate, status, scanned: 0, scheduled: 0 };
}

function toCount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(code)) return code;
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z0-9_.-]{1,100}$/.test(name) ? name : 'UNKNOWN';
}
