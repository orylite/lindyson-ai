import { pool } from '../db/pool.js';

type QueueAgeMetric = {
  count: number;
  maxAgeSeconds: number | null;
};

export interface StateMachineMonitoringSnapshot {
  available: boolean;
  checkedAt: string;
  nonTerminal: {
    payment: QueueAgeMetric;
    refund: QueueAgeMetric;
    generation: QueueAgeMetric;
    upload: QueueAgeMetric;
  };
  expiredLeases: {
    payment: number;
    refund: number;
    generation: number;
    upload: number;
    objectDeletion: number;
    paymentNotification: number;
    total: number;
  };
  manualReview: {
    payment: number;
    refund: number;
    generation: number;
    total: number;
  };
  providerIntegrity: {
    fieldConflicts: number;
    rejectedEvents: number;
    rejectedEventsLast24Hours: number;
  };
  creditBalanceMismatchUsers: number;
  uploadStagingOrphans: number;
  assetThumbnails: {
    pending: number;
    failed: number;
  };
  objectDeletionOutbox: {
    backlog: number;
    dueBacklog: number;
    maxAgeSeconds: number | null;
    maxDueAgeSeconds: number | null;
  };
}

interface MonitoringRow {
  checked_at: Date | string;
  payment_non_terminal_count: string | number;
  payment_max_age_seconds: string | number | null;
  payment_expired_leases: string | number;
  payment_manual_review: string | number;
  payment_field_conflicts: string | number;
  refund_non_terminal_count: string | number;
  refund_max_age_seconds: string | number | null;
  refund_expired_leases: string | number;
  refund_manual_review: string | number;
  refund_field_conflicts: string | number;
  generation_non_terminal_count: string | number;
  generation_max_age_seconds: string | number | null;
  generation_expired_leases: string | number;
  generation_manual_review: string | number;
  generation_field_conflicts: string | number;
  upload_non_terminal_count: string | number;
  upload_max_age_seconds: string | number | null;
  upload_expired_leases: string | number;
  upload_staging_orphans: string | number;
  asset_thumbnail_pending: string | number;
  asset_thumbnail_failed: string | number;
  provider_rejected_events: string | number;
  provider_rejected_events_last_24_hours: string | number;
  credit_balance_mismatch_users: string | number;
  object_deletion_backlog: string | number;
  object_deletion_due_backlog: string | number;
  object_deletion_max_age_seconds: string | number | null;
  object_deletion_max_due_age_seconds: string | number | null;
  object_deletion_expired_leases: string | number;
  payment_notification_expired_leases: string | number;
}

const PROVIDER_CONFLICT_PATTERN = '(不匹配|不一致|冲突|mismatch|conflict)';

/**
 * 状态机可观测性只读取事实表。所有指标在同一条聚合 SQL 中返回，避免
 * maintenance 循环为了监控制造多次往返或逐行查询。
 */
const MONITORING_QUERY = `
WITH
clock AS (
  SELECT now() AS checked_at
),
payment AS (
  SELECT
    count(*) FILTER (WHERE status IN ('queued', 'processing', 'ready', 'uncertain'))::bigint AS non_terminal_count,
    min(created_at) FILTER (WHERE status IN ('queued', 'processing', 'ready', 'uncertain')) AS oldest_non_terminal_at,
    count(*) FILTER (WHERE status = 'processing' AND lease_until < now())::bigint AS expired_leases,
    count(*) FILTER (WHERE status = 'manual-review')::bigint AS manual_review,
    count(*) FILTER (
      WHERE status = 'manual-review'
        AND coalesce(manual_review_reason, '') ~* $1
    )::bigint AS field_conflicts
  FROM payment_attempts
),
refund AS (
  SELECT
    count(*) FILTER (WHERE status IN ('queued', 'processing', 'submitted', 'uncertain'))::bigint AS non_terminal_count,
    min(created_at) FILTER (WHERE status IN ('queued', 'processing', 'submitted', 'uncertain')) AS oldest_non_terminal_at,
    count(*) FILTER (WHERE status = 'processing' AND lease_until < now())::bigint AS expired_leases,
    count(*) FILTER (WHERE status = 'manual-review')::bigint AS manual_review,
    count(*) FILTER (
      WHERE status = 'manual-review'
        AND coalesce(manual_review_reason, '') ~* $1
    )::bigint AS field_conflicts
  FROM order_refund_attempts
),
generation AS (
  SELECT
    count(*) FILTER (WHERE status IN (
      'prepared', 'submitting', 'submitted', 'submission-unknown',
      'provider-running', 'provider-succeeded', 'archiving', 'settlement-pending'
    ))::bigint AS non_terminal_count,
    min(created_at) FILTER (WHERE status IN (
      'prepared', 'submitting', 'submitted', 'submission-unknown',
      'provider-running', 'provider-succeeded', 'archiving', 'settlement-pending'
    )) AS oldest_non_terminal_at,
    count(*) FILTER (
      WHERE lease_token IS NOT NULL AND lease_expires_at < now()
    )::bigint AS expired_leases,
    count(*) FILTER (WHERE status = 'manual-review')::bigint AS manual_review,
    count(*) FILTER (
      WHERE status = 'manual-review'
        AND coalesce(last_error, '') ~* $1
    )::bigint AS field_conflicts
  FROM generation_provider_runs
),
upload AS (
  SELECT
    count(*) FILTER (WHERE status IN ('pending', 'processing'))::bigint AS non_terminal_count,
    min(created_at) FILTER (WHERE status IN ('pending', 'processing')) AS oldest_non_terminal_at,
    count(*) FILTER (
      WHERE status = 'processing' AND lease_expires_at < now()
    )::bigint AS expired_leases
  FROM upload_sessions
),
provider_event_summary AS (
  SELECT
    count(*) FILTER (WHERE status = 'rejected')::bigint AS rejected_events,
    count(*) FILTER (
      WHERE status = 'rejected' AND received_at >= now() - interval '24 hours'
    )::bigint AS rejected_events_last_24_hours
  FROM provider_events
),
credit_per_user AS (
  SELECT
    account.id,
    account.main_credits,
    account.addon_credits,
    account.total_credits,
    coalesce(sum(lot.available_amount) FILTER (WHERE lot.bucket = 'main'), 0)::bigint AS lot_main,
    coalesce(sum(lot.available_amount) FILTER (WHERE lot.bucket = 'addon'), 0)::bigint AS lot_addon
  FROM users account
  LEFT JOIN credit_lots lot ON lot.user_id = account.id
  GROUP BY account.id, account.main_credits, account.addon_credits, account.total_credits
),
credit_summary AS (
  SELECT count(*) FILTER (
    WHERE main_credits::bigint <> lot_main
       OR addon_credits::bigint <> lot_addon
       OR total_credits::bigint <> lot_main + lot_addon
  )::bigint AS balance_mismatch_users
  FROM credit_per_user
),
staging_orphan_summary AS (
  SELECT count(*)::bigint AS staging_orphans
  FROM upload_sessions session
  WHERE (
      session.status = 'completed'
      OR session.status IN ('canceled', 'expired')
      OR (session.status = 'failed' AND session.retention_until <= now())
    )
    AND session.object_key IS DISTINCT FROM session.final_object_key
    AND NOT EXISTS (
      SELECT 1
      FROM assets asset
      WHERE asset.deletion_status IN ('active', 'deleting')
        AND (asset.object_key = session.object_key OR asset.thumbnail_key = session.object_key)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM object_deletion_outbox outbox
      WHERE outbox.object_key = session.object_key
        AND outbox.status IN ('pending', 'processing', 'completed')
    )
),
asset_thumbnail_summary AS (
  SELECT
    count(*) FILTER (WHERE thumbnail_status = 'pending')::bigint AS pending,
    count(*) FILTER (WHERE thumbnail_status = 'failed')::bigint AS failed
  FROM assets
  WHERE deletion_status = 'active' AND type IN ('image', 'video')
),
object_deletion AS (
  SELECT
    count(*) FILTER (WHERE status IN ('pending', 'processing'))::bigint AS backlog,
    min(created_at) FILTER (WHERE status IN ('pending', 'processing')) AS oldest_backlog_at,
    count(*) FILTER (
      WHERE (status = 'pending' AND available_at <= now())
         OR (status = 'processing' AND lease_expires_at < now())
    )::bigint AS due_backlog,
    min(CASE
      WHEN status = 'pending' THEN available_at
      ELSE lease_expires_at
    END) FILTER (
      WHERE (status = 'pending' AND available_at <= now())
         OR (status = 'processing' AND lease_expires_at < now())
    ) AS oldest_due_since,
    count(*) FILTER (
      WHERE status = 'processing' AND lease_expires_at < now()
    )::bigint AS expired_leases
  FROM object_deletion_outbox
),
payment_notification AS (
  SELECT count(*) FILTER (
    WHERE status = 'processing' AND lease_until < now()
  )::bigint AS expired_leases
  FROM payment_notification_outbox
)
SELECT
  clock.checked_at,
  payment.non_terminal_count AS payment_non_terminal_count,
  CASE WHEN payment.oldest_non_terminal_at IS NULL THEN NULL
    ELSE floor(extract(epoch FROM clock.checked_at - payment.oldest_non_terminal_at))::bigint
  END AS payment_max_age_seconds,
  payment.expired_leases AS payment_expired_leases,
  payment.manual_review AS payment_manual_review,
  payment.field_conflicts AS payment_field_conflicts,
  refund.non_terminal_count AS refund_non_terminal_count,
  CASE WHEN refund.oldest_non_terminal_at IS NULL THEN NULL
    ELSE floor(extract(epoch FROM clock.checked_at - refund.oldest_non_terminal_at))::bigint
  END AS refund_max_age_seconds,
  refund.expired_leases AS refund_expired_leases,
  refund.manual_review AS refund_manual_review,
  refund.field_conflicts AS refund_field_conflicts,
  generation.non_terminal_count AS generation_non_terminal_count,
  CASE WHEN generation.oldest_non_terminal_at IS NULL THEN NULL
    ELSE floor(extract(epoch FROM clock.checked_at - generation.oldest_non_terminal_at))::bigint
  END AS generation_max_age_seconds,
  generation.expired_leases AS generation_expired_leases,
  generation.manual_review AS generation_manual_review,
  generation.field_conflicts AS generation_field_conflicts,
  upload.non_terminal_count AS upload_non_terminal_count,
  CASE WHEN upload.oldest_non_terminal_at IS NULL THEN NULL
    ELSE floor(extract(epoch FROM clock.checked_at - upload.oldest_non_terminal_at))::bigint
  END AS upload_max_age_seconds,
  upload.expired_leases AS upload_expired_leases,
  staging_orphan_summary.staging_orphans AS upload_staging_orphans,
  asset_thumbnail_summary.pending AS asset_thumbnail_pending,
  asset_thumbnail_summary.failed AS asset_thumbnail_failed,
  provider_event_summary.rejected_events AS provider_rejected_events,
  provider_event_summary.rejected_events_last_24_hours AS provider_rejected_events_last_24_hours,
  credit_summary.balance_mismatch_users AS credit_balance_mismatch_users,
  object_deletion.backlog AS object_deletion_backlog,
  object_deletion.due_backlog AS object_deletion_due_backlog,
  CASE WHEN object_deletion.oldest_backlog_at IS NULL THEN NULL
    ELSE floor(extract(epoch FROM clock.checked_at - object_deletion.oldest_backlog_at))::bigint
  END AS object_deletion_max_age_seconds,
  CASE WHEN object_deletion.oldest_due_since IS NULL THEN NULL
    ELSE floor(extract(epoch FROM clock.checked_at - object_deletion.oldest_due_since))::bigint
  END AS object_deletion_max_due_age_seconds,
  object_deletion.expired_leases AS object_deletion_expired_leases,
  payment_notification.expired_leases AS payment_notification_expired_leases
FROM clock
CROSS JOIN payment
CROSS JOIN refund
CROSS JOIN generation
CROSS JOIN upload
CROSS JOIN provider_event_summary
CROSS JOIN credit_summary
CROSS JOIN staging_orphan_summary
CROSS JOIN asset_thumbnail_summary
CROSS JOIN object_deletion
CROSS JOIN payment_notification`;

export async function collectStateMachineMonitoringSnapshot(): Promise<StateMachineMonitoringSnapshot> {
  const result = await pool.query<MonitoringRow>(MONITORING_QUERY, [PROVIDER_CONFLICT_PATTERN]);
  const row = result.rows[0];
  if (!row) throw new Error('状态机监控查询未返回结果');

  const paymentExpiredLeases = integer(row.payment_expired_leases);
  const refundExpiredLeases = integer(row.refund_expired_leases);
  const generationExpiredLeases = integer(row.generation_expired_leases);
  const uploadExpiredLeases = integer(row.upload_expired_leases);
  const objectDeletionExpiredLeases = integer(row.object_deletion_expired_leases);
  const paymentNotificationExpiredLeases = integer(row.payment_notification_expired_leases);
  const paymentManualReview = integer(row.payment_manual_review);
  const refundManualReview = integer(row.refund_manual_review);
  const generationManualReview = integer(row.generation_manual_review);

  return {
    available: true,
    checkedAt: new Date(row.checked_at).toISOString(),
    nonTerminal: {
      payment: queueAge(row.payment_non_terminal_count, row.payment_max_age_seconds),
      refund: queueAge(row.refund_non_terminal_count, row.refund_max_age_seconds),
      generation: queueAge(row.generation_non_terminal_count, row.generation_max_age_seconds),
      upload: queueAge(row.upload_non_terminal_count, row.upload_max_age_seconds),
    },
    expiredLeases: {
      payment: paymentExpiredLeases,
      refund: refundExpiredLeases,
      generation: generationExpiredLeases,
      upload: uploadExpiredLeases,
      objectDeletion: objectDeletionExpiredLeases,
      paymentNotification: paymentNotificationExpiredLeases,
      total: paymentExpiredLeases + refundExpiredLeases + generationExpiredLeases
        + uploadExpiredLeases + objectDeletionExpiredLeases + paymentNotificationExpiredLeases,
    },
    manualReview: {
      payment: paymentManualReview,
      refund: refundManualReview,
      generation: generationManualReview,
      total: paymentManualReview + refundManualReview + generationManualReview,
    },
    providerIntegrity: {
      fieldConflicts: integer(row.payment_field_conflicts)
        + integer(row.refund_field_conflicts)
        + integer(row.generation_field_conflicts),
      rejectedEvents: integer(row.provider_rejected_events),
      rejectedEventsLast24Hours: integer(row.provider_rejected_events_last_24_hours),
    },
    creditBalanceMismatchUsers: integer(row.credit_balance_mismatch_users),
    uploadStagingOrphans: integer(row.upload_staging_orphans),
    assetThumbnails: {
      pending: integer(row.asset_thumbnail_pending),
      failed: integer(row.asset_thumbnail_failed),
    },
    objectDeletionOutbox: {
      backlog: integer(row.object_deletion_backlog),
      dueBacklog: integer(row.object_deletion_due_backlog),
      maxAgeSeconds: nullableInteger(row.object_deletion_max_age_seconds),
      maxDueAgeSeconds: nullableInteger(row.object_deletion_max_due_age_seconds),
    },
  };
}

/**
 * worker 的恢复循环每 15 秒运行，但全量健康快照没有必要按相同频率扫描历史表。
 * 采样器复用最近一次成功结果；失败不会进入缓存，下一轮仍会尝试恢复。
 */
export function createStateMachineMonitoringSampler(
  minimumIntervalMs = 60_000,
  collect = collectStateMachineMonitoringSnapshot,
  now = () => Date.now(),
) {
  let cached: StateMachineMonitoringSnapshot | null = null;
  let refreshAfter = 0;
  let inFlight: Promise<StateMachineMonitoringSnapshot> | null = null;

  return () => {
    const currentTime = now();
    if (cached && currentTime < refreshAfter) return Promise.resolve(cached);
    if (inFlight) return inFlight;

    inFlight = collect()
      .then(snapshot => {
        cached = snapshot;
        refreshAfter = now() + minimumIntervalMs;
        return snapshot;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}

export function emptyStateMachineMonitoringSnapshot(
  checkedAt = new Date().toISOString(),
): StateMachineMonitoringSnapshot {
  return {
    available: false,
    checkedAt,
    nonTerminal: {
      payment: { count: 0, maxAgeSeconds: null },
      refund: { count: 0, maxAgeSeconds: null },
      generation: { count: 0, maxAgeSeconds: null },
      upload: { count: 0, maxAgeSeconds: null },
    },
    expiredLeases: {
      payment: 0,
      refund: 0,
      generation: 0,
      upload: 0,
      objectDeletion: 0,
      paymentNotification: 0,
      total: 0,
    },
    manualReview: { payment: 0, refund: 0, generation: 0, total: 0 },
    providerIntegrity: { fieldConflicts: 0, rejectedEvents: 0, rejectedEventsLast24Hours: 0 },
    creditBalanceMismatchUsers: 0,
    uploadStagingOrphans: 0,
    assetThumbnails: { pending: 0, failed: 0 },
    objectDeletionOutbox: {
      backlog: 0,
      dueBacklog: 0,
      maxAgeSeconds: null,
      maxDueAgeSeconds: null,
    },
  };
}

export function stateMachineMonitoringAnomalies(snapshot: StateMachineMonitoringSnapshot) {
  const anomalies: string[] = [];
  if (!snapshot.available) anomalies.push('monitoring-unavailable');
  if (snapshot.expiredLeases.total > 0) anomalies.push('expired-leases');
  if (snapshot.manualReview.total > 0) anomalies.push('manual-review');
  if (snapshot.providerIntegrity.fieldConflicts > 0) anomalies.push('provider-field-conflicts');
  if (snapshot.providerIntegrity.rejectedEventsLast24Hours > 0) anomalies.push('provider-events-rejected');
  if (snapshot.creditBalanceMismatchUsers > 0) anomalies.push('credit-balance-mismatch');
  if (snapshot.uploadStagingOrphans > 0) anomalies.push('upload-staging-orphans');
  if (snapshot.assetThumbnails.pending > 0) anomalies.push('asset-thumbnails-pending');
  if (snapshot.assetThumbnails.failed > 0) anomalies.push('asset-thumbnails-failed');
  if (
    snapshot.objectDeletionOutbox.dueBacklog > 0
    && (snapshot.objectDeletionOutbox.maxDueAgeSeconds ?? 0) >= 300
  ) anomalies.push('object-deletion-backlog');
  return anomalies;
}

export function createStateMachineMonitoringLogGate(intervalMs = 5 * 60_000) {
  let lastLogAt: number | null = null;
  let lastAnomalyFingerprint: string | null = null;

  return (snapshot: StateMachineMonitoringSnapshot, nowMs = Date.now()) => {
    const anomalies = stateMachineMonitoringAnomalies(snapshot);
    const fingerprint = anomalies.join('|');
    const anomalyChanged = lastAnomalyFingerprint !== null && fingerprint !== lastAnomalyFingerprint;
    const intervalElapsed = lastLogAt === null || nowMs - lastLogAt >= intervalMs;
    if (!anomalyChanged && !intervalElapsed) return null;

    const previousFingerprint = lastAnomalyFingerprint;
    lastLogAt = nowMs;
    lastAnomalyFingerprint = fingerprint;
    return {
      event: 'state-machine-monitoring',
      level: anomalies.length > 0 ? 'warn' as const : 'info' as const,
      kind: anomalies.length > 0
        ? 'anomaly' as const
        : previousFingerprint
          ? 'recovered' as const
          : 'snapshot' as const,
      anomalies,
      metrics: snapshot,
    };
  };
}

function queueAge(count: string | number, age: string | number | null): QueueAgeMetric {
  return { count: integer(count), maxAgeSeconds: nullableInteger(age) };
}

function integer(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function nullableInteger(value: string | number | null) {
  return value === null ? null : integer(value);
}
