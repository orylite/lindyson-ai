import { scheduleInvalidRealPortraitThumbnailDeletion } from './realPortraitThumbnails.js';
import { env } from '../config/env.js';
import { pool, withTransaction, type DbClient } from '../db/pool.js';
import {
  getConfiguredRealPortraitProvider,
  type RealPortraitProvider,
} from '../providers/realPortraitProvider.js';
import { bucketForUsage } from './credits.js';
import { setUserAvailableCreditsWithClient } from './financialCredits.js';
import {
  releaseGenerationLotsWithClient,
} from './generationCredits.js';
import { scheduleObjectDeletion } from './assetDeletionService.js';
import {
  getPortraitEntitlementsForUser,
  type PortraitEntitlementValues,
} from './portraitEntitlements.js';
import {
  processPendingAmbiguousRealPortraitAssetSubmissions,
  processPendingRealPortraitVerificationResults,
} from './realPortraitService.js';
import { toInt } from './serialization.js';

const CAPACITY_LOCK_KEY = 'lindyson:real-portrait:provider-capacity:v1';
const QUOTA_GRACE_DAYS = 7;
const CAPACITY_RESERVATION_HOURS = 24;
const COLD_ACTOR_DAYS = 30;
const STALE_CLAIM_MINUTES = 5;
const ASSET_PROCESSING_TIMEOUT_HOURS = 24;
const ASSET_POLL_MAX_DELAY_SECONDS = 300;

export interface PortraitEntitlementSnapshot {
  sourcePlanId: string;
  enabled: boolean;
  profileLimit: number | null;
  activeLimit: number;
  assetsPerActor: number;
}

interface QuotaStateRow {
  user_id: string;
  source_plan_id: string | null;
  portrait_enabled: boolean;
  profile_limit: number | string | null;
  active_limit: number | string;
  assets_per_actor: number | string;
  grace_status: 'none' | 'active' | 'reconciling' | 'completed';
  grace_until: Date | string | null;
  retained_actor_ids: unknown;
  active_actor_ids: unknown;
}

interface ActorQuotaRow {
  id: string;
  lifecycle_status: string;
  last_successful_generation_at: Date | string | null;
  created_at: Date | string;
  live_asset_count: number | string;
  occupies_active_slot: boolean;
}

interface ReconcileOutboxRow {
  id: string;
  user_id: string;
  event_key: string;
  attempt_count: number | string;
  old_entitlements: unknown;
}

interface RemoteOperationClaim {
  id: string;
  user_id: string;
  actor_id: string;
  materialization_id: string | null;
  portrait_asset_id: string | null;
  operation_type: string;
  attempt_count: number | string;
  provider_asset_id: string | null;
  provider_group_id: string | null;
  project_name: string | null;
}

interface PendingPortraitAssetClaim {
  operation_id: string;
  user_id: string;
  actor_id: string;
  authorization_id: string;
  materialization_id: string;
  portrait_asset_id: string;
  provider_asset_id: string;
  provider_group_id: string;
  project_name: string;
  attempt_count: number | string;
  operation_created_at: Date | string;
}

interface ReconciliationDependencies {
  provider?: RealPortraitProvider;
  now?: () => Date;
}

export interface PortraitReconciliationMaintenanceResult {
  entitlements: { claimed: number; completed: number; failed: number };
  grace: { scanned: number; completed: number; failed: number };
  expiredSessions: { scanned: number; expired: number; failed: number };
  expiredAuthorizations?: { scanned: number; expired: number; cleanupPending: number; failed: number };
  pendingVerificationResults?: { processed: number };
  ambiguousAssetSubmissions?: { scanned: number; recovered: number };
  pendingAssets?: {
    claimed: number;
    active: number;
    processing: number;
    failed: number;
    timedOut: number;
    retried: number;
  };
  expiredUploads?: { scanned: number; expired: number; actorsReconciled: number };
  uploadObjects: { scanned: number; scheduled: number };
  remoteDeletions: { claimed: number; completed: number; failed: number };
  capacityQueue: { scanned: number; promoted: number; cancelled: number; waiting: number };
}

/** 套餐切换事务只写本地 outbox，禁止在支付、退款或后台请求内调用供应商。 */
export async function enqueuePortraitEntitlementReconcileWithClient(
  client: DbClient,
  input: {
    userId: string;
    eventKey: string;
    reason: string;
    oldPlanId: string | null;
    newPlanId: string | null;
    effectiveAt?: Date;
  },
) {
  const oldEntitlements = await readPlanEntitlements(client, input.oldPlanId);
  const newEntitlements = await readPlanEntitlements(client, input.newPlanId);
  if (sameEntitlements(oldEntitlements, newEntitlements)) return false;
  const inserted = await client.query(
    `INSERT INTO portrait_entitlement_reconcile_outbox (
       user_id, event_key, reason, old_entitlements, new_entitlements, effective_at
     ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
     ON CONFLICT (event_key) DO NOTHING`,
    [
      input.userId,
      input.eventKey,
      input.reason,
      JSON.stringify(oldEntitlements),
      JSON.stringify(newEntitlements),
      input.effectiveAt ?? new Date(),
    ],
  );
  return Boolean(inserted.rowCount);
}

/** 后台改套餐权益时用单条 INSERT ... SELECT 批量投递，避免逐用户同步协调。 */
export async function enqueuePlanPortraitReconciliationWithClient(
  client: DbClient,
  input: {
    planId: string;
    planCode: string;
    eventKeyPrefix: string;
    reason: string;
    oldEntitlements: PortraitEntitlementValues;
    newEntitlements: PortraitEntitlementValues;
    effectiveAt?: Date;
  },
) {
  const oldSnapshot = entitlementSnapshot(input.planId, input.oldEntitlements);
  const newSnapshot = entitlementSnapshot(input.planId, input.newEntitlements);
  if (sameEntitlements(oldSnapshot, newSnapshot)) return 0;
  const result = await client.query(
    `INSERT INTO portrait_entitlement_reconcile_outbox (
       user_id, event_key, reason, old_entitlements, new_entitlements, effective_at
     )
     SELECT u.id,
            $2 || ':' || u.id::text,
            $3,
            $4::jsonb,
            $5::jsonb,
            $6
     FROM users u
     WHERE u.plan_id = $1
        OR ($7 = 'free' AND u.plan_id IS NULL)
     ON CONFLICT (event_key) DO NOTHING`,
    [
      input.planId,
      input.eventKeyPrefix,
      input.reason,
      JSON.stringify(oldSnapshot),
      JSON.stringify(newSnapshot),
      input.effectiveAt ?? new Date(),
      input.planCode.toLowerCase(),
    ],
  );
  return result.rowCount ?? 0;
}

export async function runRealPortraitReconciliationMaintenance(
  dependencies: ReconciliationDependencies = {},
): Promise<PortraitReconciliationMaintenanceResult> {
  const entitlements = await processPortraitEntitlementReconcileOutbox(30, dependencies);
  const grace = await processDuePortraitQuotaReconciliations(30, dependencies);
  // H5 到期前先做一次权威查单；只有仍未得到终态的会话才进入下方过期收敛。
  const pendingVerificationResults = await processPendingRealPortraitVerificationResults(20, dependencies);
  const expiredSessions = await processExpiredRealPortraitVerificationSessions(50, dependencies);
  const expiredAuthorizations = await processExpiredRealPortraitAuthorizations(50, dependencies);
  const ambiguousAssetSubmissions = await processPendingAmbiguousRealPortraitAssetSubmissions(20, dependencies);
  const pendingAssets = await processPendingRealPortraitAssets(30, dependencies);
  const expiredUploads = await processExpiredRealPortraitUploadSessions(100, dependencies);
  const uploadObjects = await scheduleExpiredRealPortraitUploadObjectDeletion(100, dependencies);
  const remoteDeletions = await processRealPortraitRemoteDeletions(20, dependencies);
  await scheduleInvalidRealPortraitThumbnailDeletion();
  const capacityQueue = await processRealPortraitCapacityQueue(20, dependencies);
  return {
    entitlements,
    grace,
    expiredSessions,
    expiredAuthorizations,
    pendingVerificationResults,
    ambiguousAssetSubmissions,
    pendingAssets,
    expiredUploads,
    uploadObjects,
    remoteDeletions,
    capacityQueue,
  };
}

/**
 * 邀请或 H5 会话过期后收敛本地状态。已有 BytedToken 但尚无权威 GroupId 的会话
 * 必须保留在可查单状态；即使 reservation 已释放，也由全局 pending group 计数继续占槽。
 */
export async function processExpiredRealPortraitVerificationSessions(
  limit = 50,
  dependencies: Pick<ReconciliationDependencies, 'now'> = {},
) {
  const now = dependencies.now?.() ?? new Date();
  const candidates = await pool.query<{ id: string }>(
    `SELECT DISTINCT invite.id
     FROM real_portrait_invites invite
     LEFT JOIN real_portrait_verification_sessions verification_session
       ON verification_session.invite_id = invite.id
     WHERE (
       invite.status IN ('pending', 'accepted') AND invite.expires_at <= $1
     ) OR (
       verification_session.status IN (
         'prepared', 'submitting', 'invitation_ready', 'waiting', 'submission_unknown'
       )
       AND verification_session.byted_token_ciphertext IS NULL
       AND verification_session.h5_expires_at IS NOT NULL
       AND verification_session.h5_expires_at <= $1
     )
     ORDER BY invite.id
     LIMIT $2`,
    [now, limit],
  );
  const summary = { scanned: candidates.rows.length, expired: 0, failed: 0 };
  for (const candidate of candidates.rows) {
    try {
      const changed = await withTransaction(client => expirePortraitVerificationWithClient(
        client,
        candidate.id,
        now,
      ));
      if (changed) summary.expired += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

async function expirePortraitVerificationWithClient(
  client: DbClient,
  inviteId: string,
  now: Date,
) {
  const locked = await client.query<{
    invite_id: string;
    invite_status: string;
    invite_expires_at: Date | string;
    actor_id: string;
    user_id: string;
    authorization_id: string;
    authorization_status: string;
    consented_at: Date | string | null;
    materialization_id: string;
    materialization_status: string;
    provider_group_id: string | null;
  }>(
    `SELECT invite.id AS invite_id, invite.status AS invite_status,
            invite.expires_at AS invite_expires_at,
            actor.id AS actor_id, actor.user_id,
            portrait_authorization.id AS authorization_id,
            portrait_authorization.status AS authorization_status,
            portrait_authorization.consented_at,
            materialization.id AS materialization_id,
            materialization.status AS materialization_status,
            materialization.provider_group_id
     FROM real_portrait_invites invite
     JOIN real_portrait_authorizations portrait_authorization
       ON portrait_authorization.id = invite.authorization_id
     JOIN real_portrait_actors actor ON actor.id = invite.actor_id
     JOIN real_portrait_materializations materialization
       ON materialization.actor_id = invite.actor_id
      AND materialization.authorization_id = invite.authorization_id
     WHERE invite.id = $1
     ORDER BY materialization.generation DESC
     LIMIT 1
     FOR UPDATE OF invite, portrait_authorization, actor, materialization`,
    [inviteId],
  );
  const row = locked.rows[0];
  if (!row) return false;
  const sessions = await client.query<{
    id: string;
    status: string;
    h5_expires_at: Date | string | null;
    byted_token_ciphertext: string | null;
  }>(
    `SELECT id, status, h5_expires_at, byted_token_ciphertext
     FROM real_portrait_verification_sessions
     WHERE invite_id = $1
     FOR UPDATE`,
    [inviteId],
  );
  const inviteDue = ['pending', 'accepted'].includes(row.invite_status)
    && new Date(row.invite_expires_at).getTime() <= now.getTime();
  const h5Due = sessions.rows.some(session => (
    ['prepared', 'submitting', 'invitation_ready', 'waiting', 'submission_unknown'].includes(session.status)
    && session.h5_expires_at !== null
    && new Date(session.h5_expires_at).getTime() <= now.getTime()
  ));
  if (!inviteDue && !h5Due) return false;
  const unresolvedGroupSessionIds = row.provider_group_id
    ? []
    : sessions.rows
      .filter(session => (
        ['invitation_ready', 'waiting', 'submission_unknown'].includes(session.status)
        && Boolean(session.byted_token_ciphertext)
      ))
      .map(session => session.id);
  const expirableSessionIds = sessions.rows
    .filter(session => !unresolvedGroupSessionIds.includes(session.id))
    .map(session => session.id);

  await client.query(
    `UPDATE real_portrait_invites
     SET status = 'expired', accepted_at = NULL, updated_at = now()
     WHERE id = $1 AND status IN ('pending', 'accepted')`,
    [inviteId],
  );
  await client.query(
    `UPDATE real_portrait_verification_sessions
     SET status = 'expired', failure_code = 'VERIFICATION_SESSION_EXPIRED', updated_at = now()
     WHERE id = ANY($1::uuid[])
       AND status IN ('prepared', 'submitting', 'invitation_ready', 'waiting', 'submission_unknown')
       AND ($2::boolean OR (h5_expires_at IS NOT NULL AND h5_expires_at <= $3))`,
    [expirableSessionIds, inviteDue, now],
  );
  await client.query(
    `UPDATE real_portrait_remote_operations
     SET status = 'failed', next_retry_at = NULL,
         last_error_code = 'VERIFICATION_SESSION_EXPIRED', updated_at = now()
     WHERE verification_session_id = ANY($1::uuid[])
       AND operation_type = 'create_visual_validation_session'
       AND status IN ('prepared', 'submitting', 'submitted', 'submission_unknown')`,
    [expirableSessionIds],
  );
  await client.query(
    `UPDATE real_portrait_authorizations
     SET status = CASE WHEN consented_at IS NULL THEN 'rejected' ELSE 'expired' END,
         updated_at = now()
     WHERE id = $1 AND status IN ('draft', 'pending')`,
    [row.authorization_id],
  );
  if (row.provider_group_id) {
    await client.query(
      `UPDATE real_portrait_materializations
       SET status = 'deleting', eviction_eligible_at = COALESCE(eviction_eligible_at, now()),
           updated_at = now()
       WHERE id = $1 AND status NOT IN ('deleting', 'deleted', 'evicted')`,
      [row.materialization_id],
    );
    await scheduleRemoteOperation(client, {
      userId: row.user_id,
      actorId: row.actor_id,
      materializationId: row.materialization_id,
      portraitAssetId: null,
      operationType: 'expired_verification_delete_group',
      idempotencyKey: `expired-verification-group:${row.materialization_id}`,
    });
  } else {
    await client.query(
      `UPDATE real_portrait_materializations
       SET status = 'error', updated_at = now()
       WHERE id = $1 AND status NOT IN ('deleted', 'evicted', 'error')`,
      [row.materialization_id],
    );
  }
  await client.query(
    `UPDATE real_portrait_capacity_reservations
     SET status = 'released', updated_at = now()
     WHERE actor_id = $1 AND status = 'reserved'`,
    [row.actor_id],
  );
  await client.query(
    `UPDATE real_portrait_activation_queue
     SET status = 'cancelled', updated_at = now()
     WHERE actor_id = $1 AND status IN ('waiting', 'promoted')`,
    [row.actor_id],
  );
  await client.query(
    `UPDATE real_portrait_actors
     SET lifecycle_status = 'expired', updated_at = now()
     WHERE id = $1 AND lifecycle_status NOT IN ('revoked', 'deleting', 'sync_error')`,
    [row.actor_id],
  );
  await appendSystemPortraitEvent(
    client,
    row.user_id,
    'verification.session_expired',
    { inviteId, inviteDue, h5Due, lateGroupCleanup: Boolean(row.provider_group_id) },
    row.actor_id,
    row.materialization_id,
  );
  return true;
}

/**
 * 自然到期的授权必须从“仅在请求时校验”收敛为持久状态，并在已提交任务终态后清理旧物化。
 * 重试始终绑定 authorization + materialization，避免用户重新授权后误删新 Group。
 */
export async function processExpiredRealPortraitAuthorizations(
  limit = 50,
  dependencies: Pick<ReconciliationDependencies, 'now'> = {},
) {
  const now = dependencies.now?.() ?? new Date();
  const candidates = await pool.query<{ id: string }>(
    `SELECT portrait_authorization.id
     FROM real_portrait_authorizations portrait_authorization
     JOIN real_portrait_materializations materialization
       ON materialization.authorization_id = portrait_authorization.id
      AND materialization.actor_id = portrait_authorization.actor_id
     WHERE portrait_authorization.valid_until <= $1
       AND (
         portrait_authorization.status = 'active'
         OR (
           portrait_authorization.status = 'expired'
           AND materialization.provider_group_id IS NOT NULL
           AND materialization.remote_deleted_at IS NULL
         )
       )
     ORDER BY portrait_authorization.valid_until ASC, portrait_authorization.id ASC
     LIMIT $2`,
    [now, limit],
  );
  const summary = {
    scanned: candidates.rows.length,
    expired: 0,
    cleanupPending: 0,
    failed: 0,
  };
  for (const candidate of candidates.rows) {
    try {
      const outcome = await withTransaction(client => expireRealPortraitAuthorizationWithClient(
        client,
        candidate.id,
        now,
      ));
      if (outcome.expired) summary.expired += 1;
      if (outcome.cleanupPending) summary.cleanupPending += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

async function expireRealPortraitAuthorizationWithClient(
  client: DbClient,
  authorizationId: string,
  now: Date,
) {
  const locked = await client.query<{
    authorization_id: string;
    authorization_status: string;
    valid_until: Date | string;
    actor_id: string;
    user_id: string;
    materialization_id: string;
    materialization_status: string;
    provider_group_id: string | null;
    remote_deleted_at: Date | string | null;
  }>(
    `SELECT portrait_authorization.id AS authorization_id,
            portrait_authorization.status AS authorization_status,
            portrait_authorization.valid_until,
            actor.id AS actor_id, actor.user_id,
            materialization.id AS materialization_id,
            materialization.status AS materialization_status,
            materialization.provider_group_id,
            materialization.remote_deleted_at
     FROM real_portrait_authorizations portrait_authorization
     JOIN real_portrait_actors actor ON actor.id = portrait_authorization.actor_id
     JOIN real_portrait_materializations materialization
       ON materialization.authorization_id = portrait_authorization.id
      AND materialization.actor_id = portrait_authorization.actor_id
     WHERE portrait_authorization.id = $1
     ORDER BY materialization.generation DESC
     LIMIT 1
     FOR UPDATE OF portrait_authorization, actor, materialization`,
    [authorizationId],
  );
  const row = locked.rows[0];
  if (!row || new Date(row.valid_until).getTime() > now.getTime()) {
    return { expired: false, cleanupPending: false };
  }
  const transitioning = row.authorization_status === 'active';
  const cleanupRetry = row.authorization_status === 'expired'
    && Boolean(row.provider_group_id)
    && row.remote_deleted_at === null;
  if (!transitioning && !cleanupRetry) {
    return { expired: false, cleanupPending: false };
  }

  if (transitioning) {
    await client.query(
      `UPDATE real_portrait_authorizations
       SET status = 'expired', updated_at = now()
       WHERE id = $1 AND status = 'active' AND valid_until <= $2`,
      [authorizationId, now],
    );
    await client.query(
      `UPDATE real_portrait_actors actor
       SET lifecycle_status = 'expired', updated_at = now()
       WHERE actor.id = $1
         AND actor.lifecycle_status NOT IN ('revoked', 'deleting', 'sync_error')
         AND NOT EXISTS (
           SELECT 1
           FROM real_portrait_authorizations current_authorization
           WHERE current_authorization.actor_id = actor.id
             AND current_authorization.id <> $2
             AND current_authorization.status = 'active'
             AND current_authorization.valid_until > $3
         )`,
      [row.actor_id, authorizationId, now],
    );
    await requestPortraitTaskCancellationWithClient(
      client,
      row.user_id,
      [row.actor_id],
      { authorizationIds: [authorizationId], reason: 'authorization-expired' },
    );
    await appendSystemPortraitEvent(client, row.user_id, 'authorization.expired', {
      authorizationId,
      validUntil: new Date(row.valid_until).toISOString(),
    }, row.actor_id, row.materialization_id);
  }

  const cleanupPending = await scheduleExpiredAuthorizationCleanupWithClient(client, {
    userId: row.user_id,
    actorId: row.actor_id,
    authorizationId,
    materializationId: row.materialization_id,
    materializationStatus: row.materialization_status,
    providerGroupId: row.provider_group_id,
  });
  return { expired: transitioning, cleanupPending };
}

async function scheduleExpiredAuthorizationCleanupWithClient(
  client: DbClient,
  input: {
    userId: string;
    actorId: string;
    authorizationId: string;
    materializationId: string;
    materializationStatus: string;
    providerGroupId: string | null;
  },
) {
  if (!input.providerGroupId) {
    await client.query(
      `UPDATE real_portrait_materializations
       SET status = 'error', updated_at = now()
       WHERE id = $1 AND authorization_id = $2
         AND status NOT IN ('evicted', 'deleted', 'error')`,
      [input.materializationId, input.authorizationId],
    );
    await client.query(
      `UPDATE real_portrait_capacity_reservations
       SET status = 'released', updated_at = now()
       WHERE actor_id = $1 AND status = 'reserved'`,
      [input.actorId],
    );
    return false;
  }

  const pinned = await authorizationMaterializationHasNonterminalGeneration(
    client,
    input.authorizationId,
    input.materializationId,
  ) || await materializationHasUnsettledCreateAsset(client, input.materializationId);
  if (pinned) {
    await client.query(
      `UPDATE real_portrait_materializations
       SET status = 'eviction_warning',
           eviction_eligible_at = COALESCE(eviction_eligible_at, now()),
           updated_at = now()
       WHERE id = $1 AND authorization_id = $2
         AND status IN ('active', 'processing', 'awaiting_upload', 'eviction_warning')`,
      [input.materializationId, input.authorizationId],
    );
    return true;
  }

  const assets = await client.query<{ id: string; provider_asset_id: string | null }>(
    `SELECT id, provider_asset_id
     FROM real_portrait_assets
     WHERE materialization_id = $1 AND status <> 'deleted'
     FOR UPDATE`,
    [input.materializationId],
  );
  for (const asset of assets.rows) {
    if (!asset.provider_asset_id) {
      await client.query(
        `UPDATE real_portrait_assets
         SET status = 'deleted', error_code = NULL,
             remote_deleted_at = now(), updated_at = now()
         WHERE id = $1`,
        [asset.id],
      );
      continue;
    }
    await scheduleRemoteOperation(client, {
      userId: input.userId,
      actorId: input.actorId,
      materializationId: input.materializationId,
      portraitAssetId: asset.id,
      operationType: 'authorization_delete_asset',
      idempotencyKey: `authorization-asset:${input.authorizationId}:${asset.id}`,
    });
    await client.query(
      `UPDATE real_portrait_assets
       SET status = 'deleting', error_code = NULL, updated_at = now()
       WHERE id = $1`,
      [asset.id],
    );
  }
  await client.query(
    `UPDATE real_portrait_materializations
     SET status = 'deleting', eviction_eligible_at = COALESCE(eviction_eligible_at, now()),
         updated_at = now()
     WHERE id = $1 AND authorization_id = $2
       AND remote_deleted_at IS NULL`,
    [input.materializationId, input.authorizationId],
  );
  if (assets.rows.every(asset => !asset.provider_asset_id)) {
    await scheduleRemoteOperation(client, {
      userId: input.userId,
      actorId: input.actorId,
      materializationId: input.materializationId,
      portraitAssetId: null,
      operationType: 'authorization_delete_group',
      idempotencyKey: `authorization-group:${input.authorizationId}:${input.materializationId}`,
    });
  }
  return true;
}

async function authorizationMaterializationHasNonterminalGeneration(
  client: DbClient,
  authorizationId: string,
  materializationId: string,
) {
  const result = await client.query(
    `SELECT 1
     FROM generation_real_portrait_references ref
     JOIN generation_tasks task ON task.id = ref.task_id AND task.attempt = ref.task_attempt
     WHERE ref.authorization_id = $1 AND ref.materialization_id = $2
       AND task.status IN ('queued', 'processing')
     LIMIT 1`,
    [authorizationId, materializationId],
  );
  return Boolean(result.rowCount);
}

async function materializationHasUnsettledCreateAsset(
  client: DbClient,
  materializationId: string,
) {
  const result = await client.query(
    `SELECT 1
     FROM real_portrait_remote_operations operation
     WHERE operation.materialization_id = $1
       AND operation.operation_type = 'create_asset'
       AND operation.status IN ('submitting', 'submission_unknown', 'manual_review')
     LIMIT 1`,
    [materializationId],
  );
  return Boolean(result.rowCount);
}

/**
 * CreateAsset 成功只表示进入异步处理。这里以 create_asset operation 作为持久轮询游标，
 * 进程崩溃后可从 stale submitting 状态恢复，不依赖用户再次打开档案页面。
 */
export async function processPendingRealPortraitAssets(
  limit = 30,
  dependencies: ReconciliationDependencies = {},
) {
  const provider = dependencies.provider ?? getConfiguredRealPortraitProvider();
  const now = dependencies.now?.() ?? new Date();
  await pool.query(
    `UPDATE real_portrait_remote_operations operation
     SET status = 'submission_unknown', next_retry_at = $1, updated_at = now()
     FROM real_portrait_assets asset
     WHERE asset.id = operation.portrait_asset_id
       AND operation.operation_type = 'create_asset'
       AND operation.status = 'submitting'
       AND asset.status = 'processing'
       AND operation.updated_at < $1::timestamptz - ($2::int * interval '1 minute')`,
    [now, STALE_CLAIM_MINUTES],
  );
  const summary = {
    claimed: 0,
    active: 0,
    processing: 0,
    failed: 0,
    timedOut: 0,
    retried: 0,
  };
  for (let index = 0; index < limit; index += 1) {
    const claim = await claimPendingRealPortraitAsset(now);
    if (!claim) break;
    summary.claimed += 1;
    const timedOut = new Date(claim.operation_created_at).getTime()
      <= now.getTime() - ASSET_PROCESSING_TIMEOUT_HOURS * 60 * 60 * 1_000;
    try {
      const remote = await provider.getAsset(claim.provider_asset_id, claim.project_name);
      const consistent = remote.id === claim.provider_asset_id
        && remote.groupId === claim.provider_group_id
        && remote.projectName === claim.project_name;
      if (!consistent) {
        const settled = await settlePendingPortraitAsset(claim, {
          kind: 'failed',
          errorCode: 'PROVIDER_ID_MISMATCH',
          consistencyStatus: 'failed',
        }, now);
        if (settled) summary.failed += 1;
        continue;
      }
      if (remote.status === 'Active') {
        const settled = await settlePendingPortraitAsset(claim, {
          kind: 'active',
          errorCode: null,
          consistencyStatus: 'passed',
        }, now);
        if (settled) summary.active += 1;
        continue;
      }
      if (remote.status === 'Failed') {
        const settled = await settlePendingPortraitAsset(claim, {
          kind: 'failed',
          errorCode: remote.errorCode ?? 'PROVIDER_ASSET_FAILED',
          consistencyStatus: 'pending',
        }, now);
        if (settled) summary.failed += 1;
        continue;
      }
      if (timedOut) {
        const settled = await settlePendingPortraitAsset(claim, {
          kind: 'timed-out',
          errorCode: 'REAL_PORTRAIT_ASSET_PROCESSING_TIMEOUT',
          consistencyStatus: 'unknown',
        }, now);
        if (settled) summary.timedOut += 1;
        continue;
      }
      await deferPendingPortraitAsset(claim, now, 'REAL_PORTRAIT_ASSET_PROCESSING');
      summary.processing += 1;
    } catch (error) {
      if (timedOut) {
        const settled = await settlePendingPortraitAsset(claim, {
          kind: 'timed-out',
          errorCode: 'REAL_PORTRAIT_ASSET_PROCESSING_TIMEOUT',
          consistencyStatus: 'unknown',
        }, now);
        if (settled) summary.timedOut += 1;
        continue;
      }
      await deferPendingPortraitAsset(claim, now, safeErrorCode(error));
      summary.retried += 1;
    }
  }
  return summary;
}

async function claimPendingRealPortraitAsset(now: Date): Promise<PendingPortraitAssetClaim | null> {
  return withTransaction(async client => {
    const result = await client.query<PendingPortraitAssetClaim>(
      `SELECT operation.id AS operation_id, operation.user_id, operation.actor_id,
              portrait_authorization.id AS authorization_id,
              operation.materialization_id, operation.portrait_asset_id,
              asset.provider_asset_id, materialization.provider_group_id,
              materialization.project_name, operation.attempt_count,
              operation.created_at AS operation_created_at
       FROM real_portrait_remote_operations operation
       JOIN real_portrait_assets asset ON asset.id = operation.portrait_asset_id
       JOIN real_portrait_materializations materialization
         ON materialization.id = operation.materialization_id
        AND materialization.id = asset.materialization_id
       JOIN real_portrait_authorizations portrait_authorization
         ON portrait_authorization.id = materialization.authorization_id
       WHERE operation.operation_type = 'create_asset'
         AND operation.status IN ('prepared', 'completed', 'failed', 'submitted', 'submission_unknown')
         AND (operation.next_retry_at IS NULL OR operation.next_retry_at <= $1)
         AND asset.status = 'processing' AND asset.provider_asset_id IS NOT NULL
         AND materialization.provider_group_id IS NOT NULL
         AND materialization.status NOT IN ('deleting', 'evicted', 'deleted', 'error')
         AND portrait_authorization.status = 'active'
         AND portrait_authorization.valid_until > $1
       ORDER BY operation.next_retry_at ASC NULLS FIRST,
                operation.created_at ASC, operation.id ASC
       FOR UPDATE OF operation, asset SKIP LOCKED
       LIMIT 1`,
      [now],
    );
    const row = result.rows[0];
    if (!row) return null;
    const claimed = await client.query<{ attempt_count: number | string }>(
      `UPDATE real_portrait_remote_operations
       SET status = 'submitting', attempt_count = attempt_count + 1,
           next_retry_at = NULL, last_error_code = NULL, updated_at = now()
       WHERE id = $1
       RETURNING attempt_count`,
      [row.operation_id],
    );
    if (!claimed.rowCount) return null;
    return { ...row, attempt_count: claimed.rows[0]!.attempt_count };
  });
}

async function deferPendingPortraitAsset(
  claim: PendingPortraitAssetClaim,
  now: Date,
  errorCode: string,
) {
  const retryAt = new Date(now.getTime() + pendingAssetRetryDelaySeconds(claim.attempt_count) * 1_000);
  await pool.query(
    `UPDATE real_portrait_remote_operations
     SET status = 'submitted', next_retry_at = $2,
         last_error_code = $3, updated_at = now()
     WHERE id = $1 AND status = 'submitting'`,
    [claim.operation_id, retryAt, errorCode],
  );
}

async function settlePendingPortraitAsset(
  claim: PendingPortraitAssetClaim,
  outcome: {
    kind: 'active' | 'failed' | 'timed-out';
    errorCode: string | null;
    consistencyStatus: 'passed' | 'pending' | 'failed' | 'unknown';
  },
  now: Date,
) {
  return withTransaction(async client => {
    const locked = await client.query<{
      operation_status: string;
      asset_status: string;
      authorization_status: string;
      valid_until: Date | string;
      materialization_status: string;
    }>(
      `SELECT operation.status AS operation_status, asset.status AS asset_status,
              portrait_authorization.status AS authorization_status,
              portrait_authorization.valid_until,
              materialization.status AS materialization_status
       FROM real_portrait_remote_operations operation
       JOIN real_portrait_assets asset ON asset.id = operation.portrait_asset_id
       JOIN real_portrait_materializations materialization
         ON materialization.id = operation.materialization_id
       JOIN real_portrait_authorizations portrait_authorization
         ON portrait_authorization.id = materialization.authorization_id
       JOIN real_portrait_actors actor ON actor.id = operation.actor_id
       WHERE operation.id = $1 AND asset.id = $2
       FOR UPDATE OF operation, asset, materialization, portrait_authorization, actor`,
      [claim.operation_id, claim.portrait_asset_id],
    );
    const state = locked.rows[0];
    if (!state || state.operation_status !== 'submitting' || state.asset_status !== 'processing') {
      return false;
    }
    const authorizationUsable = state.authorization_status === 'active'
      && new Date(state.valid_until).getTime() > now.getTime()
      && !['deleting', 'evicted', 'deleted', 'error'].includes(state.materialization_status);
    const effectiveOutcome = authorizationUsable
      ? outcome
      : {
        kind: 'failed' as const,
        errorCode: 'AUTHORIZATION_NO_LONGER_USABLE',
        consistencyStatus: 'unknown' as const,
      };
    if (effectiveOutcome.kind === 'active') {
      await client.query(
        `UPDATE real_portrait_assets
         SET status = 'active', consistency_status = $2,
             error_code = NULL, updated_at = now()
         WHERE id = $1 AND status = 'processing'`,
        [claim.portrait_asset_id, effectiveOutcome.consistencyStatus],
      );
    } else {
      await client.query(
        `UPDATE real_portrait_assets
         SET status = 'deleting', consistency_status = $2,
             error_code = NULL, updated_at = now()
         WHERE id = $1 AND status = 'processing'`,
        [claim.portrait_asset_id, effectiveOutcome.consistencyStatus],
      );
      await scheduleRemoteOperation(client, {
        userId: claim.user_id,
        actorId: claim.actor_id,
        materializationId: claim.materialization_id,
        portraitAssetId: claim.portrait_asset_id,
        operationType: effectiveOutcome.kind === 'timed-out'
          ? 'asset_processing_timeout_delete_asset'
          : 'asset_processing_failed_delete_asset',
        idempotencyKey: effectiveOutcome.kind === 'timed-out'
          ? `asset-processing-timeout:${claim.portrait_asset_id}`
          : `asset-processing-failed:${claim.portrait_asset_id}`,
      });
    }
    await client.query(
      `UPDATE real_portrait_upload_sessions
       SET status = $2, updated_at = now()
       WHERE asset_id = $1 AND status IN ('submitting', 'processing')`,
      [claim.portrait_asset_id, effectiveOutcome.kind === 'active' ? 'active' : 'failed'],
    );
    const uploads = await client.query<{ object_key: string }>(
      `SELECT object_key
       FROM real_portrait_upload_sessions
       WHERE asset_id = $1 AND object_key IS NOT NULL`,
      [claim.portrait_asset_id],
    );
    for (const upload of uploads.rows) {
      await scheduleObjectDeletion(client, upload.object_key, [], now);
    }
    await recomputePendingPortraitLifecycleWithClient(
      client,
      claim.materialization_id,
      claim.actor_id,
    );
    if (effectiveOutcome.kind === 'active') {
      await client.query(
        `UPDATE real_portrait_capacity_reservations reservation
         SET status = 'consumed', updated_at = now()
         WHERE reservation.actor_id = $1 AND reservation.status = 'reserved'
           AND (
             SELECT count(*)
             FROM real_portrait_assets asset
             WHERE asset.actor_id = reservation.actor_id AND asset.status = 'active'
           ) >= reservation.asset_slots`,
        [claim.actor_id],
      );
    } else {
      await client.query(
        `UPDATE real_portrait_capacity_reservations
         SET status = 'released', updated_at = now()
         WHERE actor_id = $1 AND status = 'reserved'`,
        [claim.actor_id],
      );
    }
    await client.query(
      `UPDATE real_portrait_remote_operations
       SET status = 'completed', next_retry_at = NULL,
           last_error_code = $2, updated_at = now()
       WHERE id = $1 AND status = 'submitting'`,
      [claim.operation_id, effectiveOutcome.errorCode],
    );
    await appendSystemPortraitEvent(
      client,
      claim.user_id,
      effectiveOutcome.kind === 'active' ? 'asset.active' : 'asset.processing_terminal',
      {
        authorizationId: claim.authorization_id,
        outcome: effectiveOutcome.kind,
        errorCode: effectiveOutcome.errorCode,
      },
      claim.actor_id,
      claim.materialization_id,
    );
    return true;
  });
}

async function recomputePendingPortraitLifecycleWithClient(
  client: DbClient,
  materializationId: string,
  actorId: string,
) {
  const result = await client.query<{ next_status: 'active' | 'processing' | 'awaiting_upload' }>(
    `SELECT CASE
              WHEN count(*) FILTER (
                WHERE kind = 'primary'
                  AND status = 'active'
                  AND consistency_status = 'passed'
                  AND provider_asset_id IS NOT NULL
                  AND remote_deleted_at IS NULL
              ) > 0 THEN 'active'
              WHEN count(*) FILTER (WHERE status = 'processing') > 0 THEN 'processing'
              ELSE 'awaiting_upload'
            END AS next_status
     FROM real_portrait_assets
     WHERE materialization_id = $1 AND status <> 'deleted'`,
    [materializationId],
  );
  const nextStatus = result.rows[0]?.next_status ?? 'awaiting_upload';
  await client.query(
    `UPDATE real_portrait_materializations materialization
     SET status = $2,
         activated_at = CASE WHEN $2 = 'active'
           THEN COALESCE(activated_at, now()) ELSE activated_at END,
         updated_at = now()
     FROM real_portrait_authorizations portrait_authorization
     WHERE materialization.id = $1
       AND portrait_authorization.id = materialization.authorization_id
       AND portrait_authorization.status = 'active'
       AND portrait_authorization.valid_until > now()
       AND materialization.status NOT IN ('deleting', 'evicted', 'deleted', 'error')`,
    [materializationId, nextStatus],
  );
  await client.query(
    `UPDATE real_portrait_actors actor
     SET lifecycle_status = $2, updated_at = now()
     FROM real_portrait_materializations materialization
     JOIN real_portrait_authorizations portrait_authorization
       ON portrait_authorization.id = materialization.authorization_id
     WHERE actor.id = $1 AND materialization.id = $3
       AND materialization.actor_id = actor.id
       AND portrait_authorization.status = 'active'
       AND portrait_authorization.valid_until > now()
       AND actor.lifecycle_status NOT IN ('revoked', 'deleting', 'evicted', 'expired', 'sync_error')`,
    [actorId, nextStatus, materializationId],
  );
}

function pendingAssetRetryDelaySeconds(attemptCount: number | string) {
  const exponent = Math.min(8, Math.max(0, toInt(attemptCount) - 1));
  return Math.min(ASSET_POLL_MAX_DELAY_SECONDS, 5 * (2 ** exponent));
}

/** 释放过期但从未进入供应商处理的上传占位；processing / active 会继续由素材轮询收敛。 */
export async function processExpiredRealPortraitUploadSessions(
  limit = 100,
  dependencies: Pick<ReconciliationDependencies, 'now'> = {},
) {
  const now = dependencies.now?.() ?? new Date();
  return withTransaction(async client => {
    const expired = await client.query<{
      id: string;
      user_id: string;
      actor_id: string;
      materialization_id: string;
      object_key: string | null;
    }>(
      `SELECT id, user_id, actor_id, materialization_id, object_key
       FROM real_portrait_upload_sessions
       WHERE status IN ('waiting_upload', 'uploaded') AND expires_at <= $1
       ORDER BY expires_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [now, limit],
    );
    if (!expired.rowCount) return { scanned: 0, expired: 0, actorsReconciled: 0 };
    const sessionIds = expired.rows.map(row => row.id);
    await client.query(
      `UPDATE real_portrait_upload_sessions
       SET status = 'expired', updated_at = now()
       WHERE id = ANY($1::uuid[])
         AND status IN ('waiting_upload', 'uploaded')`,
      [sessionIds],
    );
    for (const row of expired.rows) {
      if (row.object_key) await scheduleObjectDeletion(client, row.object_key, [], now);
    }
    const actorIds = [...new Set(expired.rows.map(row => row.actor_id))];
    for (const actorId of actorIds) {
      const usage = await client.query<{
        has_remote_group: boolean;
        remote_assets: number | string;
        pending_uploads: number | string;
      }>(
        `SELECT
           EXISTS (
             SELECT 1
             FROM real_portrait_materializations materialization
             WHERE materialization.actor_id = $1
               AND materialization.provider_group_id IS NOT NULL
               AND materialization.remote_deleted_at IS NULL
           ) AS has_remote_group,
           (SELECT count(*)
            FROM real_portrait_assets asset
            WHERE asset.actor_id = $1
              AND asset.provider_asset_id IS NOT NULL
              AND asset.remote_deleted_at IS NULL)::integer AS remote_assets,
           (SELECT count(DISTINCT upload.kind)
            FROM real_portrait_upload_sessions upload
            LEFT JOIN real_portrait_assets asset ON asset.id = upload.asset_id
            WHERE upload.actor_id = $1
              AND upload.status IN ('waiting_upload', 'uploaded', 'submitting', 'processing', 'active')
              AND (
                upload.status IN ('submitting', 'processing', 'active')
                OR upload.expires_at > $2
              )
              AND (asset.id IS NULL OR asset.provider_asset_id IS NULL))::integer AS pending_uploads`,
        [actorId, now],
      );
      const row = usage.rows[0];
      const desiredAssetSlots = toInt(row?.remote_assets) + toInt(row?.pending_uploads);
      if (desiredAssetSlots > 0 || !row?.has_remote_group) {
        await client.query(
          `UPDATE real_portrait_capacity_reservations
           SET asset_slots = GREATEST(1, $2), updated_at = now()
           WHERE actor_id = $1 AND status = 'reserved'`,
          [actorId, desiredAssetSlots],
        );
      } else {
        // 远端 Group 已由权威占用统计计数；这里只释放已无用途的 Asset 预留，不会漏算 Group。
        await client.query(
          `UPDATE real_portrait_capacity_reservations
           SET status = 'released', updated_at = now()
           WHERE actor_id = $1 AND status = 'reserved'`,
          [actorId],
        );
      }
    }
    return {
      scanned: expired.rows.length,
      expired: expired.rows.length,
      actorsReconciled: actorIds.length,
    };
  });
}

export async function scheduleExpiredRealPortraitUploadObjectDeletion(
  limit = 100,
  dependencies: Pick<ReconciliationDependencies, 'now'> = {},
) {
  const now = dependencies.now?.() ?? new Date();
  return withTransaction(async client => {
    const candidates = await client.query<{ object_key: string }>(
      `SELECT upload_session.object_key
       FROM real_portrait_upload_sessions upload_session
       WHERE upload_session.object_key IS NOT NULL
         AND upload_session.created_at <= $1::timestamptz - interval '24 hours'
         AND NOT EXISTS (
           SELECT 1 FROM object_deletion_outbox deletion
           WHERE deletion.object_key = upload_session.object_key
         )
       ORDER BY upload_session.created_at ASC, upload_session.id ASC
       FOR UPDATE OF upload_session SKIP LOCKED
       LIMIT $2`,
      [now, limit],
    );
    let scheduled = 0;
    for (const candidate of candidates.rows) {
      await scheduleObjectDeletion(client, candidate.object_key, [], now);
      scheduled += 1;
    }
    return { scanned: candidates.rows.length, scheduled };
  });
}

export async function processPortraitEntitlementReconcileOutbox(
  limit = 30,
  dependencies: ReconciliationDependencies = {},
) {
  const now = dependencies.now?.() ?? new Date();
  await pool.query(
    `UPDATE portrait_entitlement_reconcile_outbox
     SET status = 'failed', last_error = 'stale-processing-claim', updated_at = now()
     WHERE status = 'processing'
       AND updated_at < now() - ($1::int * interval '1 minute')`,
    [STALE_CLAIM_MINUTES],
  );
  const summary = { claimed: 0, completed: 0, failed: 0 };
  for (let index = 0; index < limit; index += 1) {
    const claim = await claimEntitlementOutbox(now);
    if (!claim) break;
    summary.claimed += 1;
    try {
      await withTransaction(async client => {
        const current = await client.query<{ status: string }>(
          `SELECT status FROM portrait_entitlement_reconcile_outbox WHERE id = $1 FOR UPDATE`,
          [claim.id],
        );
        if (current.rows[0]?.status !== 'processing') return;
        await reconcileUserPortraitEntitlementsWithClient(
          client,
          claim.user_id,
          now,
          parseEntitlementSnapshot(claim.old_entitlements),
        );
        await client.query(
          `UPDATE portrait_entitlement_reconcile_outbox
           SET status = 'completed', last_error = NULL, updated_at = now()
           WHERE id = $1 AND status = 'processing'`,
          [claim.id],
        );
      });
      summary.completed += 1;
    } catch (error) {
      summary.failed += 1;
      await pool.query(
        `UPDATE portrait_entitlement_reconcile_outbox
         SET status = 'failed', last_error = $2, updated_at = now()
         WHERE id = $1 AND status = 'processing'`,
        [claim.id, safeErrorCode(error)],
      ).catch(() => undefined);
    }
  }
  return summary;
}

export async function processDuePortraitQuotaReconciliations(
  limit = 30,
  dependencies: ReconciliationDependencies = {},
) {
  const now = dependencies.now?.() ?? new Date();
  const due = await pool.query<{ user_id: string }>(
    `SELECT user_id
     FROM user_portrait_quota_states
     WHERE grace_status IN ('active', 'reconciling')
       AND grace_until <= $1
     ORDER BY grace_until ASC NULLS FIRST, updated_at ASC, user_id ASC
     LIMIT $2`,
    [now, limit],
  );
  const summary = { scanned: due.rows.length, completed: 0, failed: 0 };
  for (const row of due.rows) {
    try {
      await withTransaction(client => reconcileUserPortraitEntitlementsWithClient(client, row.user_id, now));
      summary.completed += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

async function claimEntitlementOutbox(now: Date): Promise<ReconcileOutboxRow | null> {
  return withTransaction(async client => {
    const result = await client.query<ReconcileOutboxRow>(
      `SELECT id, user_id, event_key, attempt_count, old_entitlements
       FROM portrait_entitlement_reconcile_outbox
       WHERE effective_at <= $1
         AND (
           status = 'pending'
           OR (
             status = 'failed'
             AND updated_at <= now() - (
               LEAST(300, GREATEST(1, attempt_count * 5)) * interval '1 second'
             )
           )
         )
       ORDER BY effective_at ASC, created_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [now],
    );
    const row = result.rows[0];
    if (!row) return null;
    const claimed = await client.query<ReconcileOutboxRow>(
      `UPDATE portrait_entitlement_reconcile_outbox
       SET status = 'processing', attempt_count = attempt_count + 1,
           last_error = NULL, updated_at = now()
       WHERE id = $1
       RETURNING id, user_id, event_key, attempt_count, old_entitlements`,
      [row.id],
    );
    return claimed.rows[0] ?? null;
  });
}

async function reconcileUserPortraitEntitlementsWithClient(
  client: DbClient,
  userId: string,
  now: Date,
  outboxPrevious: PortraitEntitlementSnapshot | null = null,
) {
  const user = await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
  if (!user.rowCount) return;
  const resolved = await getPortraitEntitlementsForUser(client, userId);
  if (!resolved) return;
  const next = entitlementSnapshot(resolved.sourcePlanId, resolved);
  const stateResult = await client.query<QuotaStateRow>(
    `SELECT * FROM user_portrait_quota_states WHERE user_id = $1 FOR UPDATE`,
    [userId],
  );
  const actors = await readQuotaActors(client, userId);
  const usage = portraitUsage(actors);
  const overProfile = next.profileLimit !== null && usage.profiles > next.profileLimit;
  const overActive = usage.active > next.activeLimit;
  const overAssets = actors.some(actor => toInt(actor.live_asset_count) > next.assetsPerActor);
  const current = stateResult.rows[0] ?? null;
  const statePrevious = current ? quotaStateSnapshot(current, next.sourcePlanId) : null;
  const entitlementDecreased = Boolean(
    (statePrevious && portraitEntitlementsDecreased(statePrevious, next))
    || (outboxPrevious && portraitEntitlementsDecreased(outboxPrevious, next)),
  );
  const entitlementIncreased = Boolean(
    statePrevious && portraitEntitlementsIncreased(statePrevious, next),
  );
  const usageExceeds = !next.enabled
    ? usage.profiles > 0 || usage.active > 0 || actors.some(actor => toInt(actor.live_asset_count) > 0)
    : overProfile || overActive || overAssets;
  const graceInProgress = current?.grace_status === 'active' || current?.grace_status === 'reconciling';
  const graceAlreadyEstablished = current?.grace_status !== 'none' && current?.grace_until !== null;

  // 升级先撤销尚未提交的清理；已经提交/已删除的远端资源不会伪造恢复，档案解锁后需重新认证。
  if (entitlementIncreased && graceAlreadyEstablished) {
    const cleanupInFlight = await restoreEntitlementCleanupWithClient(client, userId);
    if (!usageExceeds) {
      await writeQuotaState(client, userId, next, {
        // 远端删除是否仍在飞由 real_portrait_remote_operations 独立追踪；
        // 不能继续占用套餐宽限状态，否则过期的空选择会在下一轮误清理全部演员。
        graceStatus: 'none',
        graceUntil: null,
        retainedActorIds: [],
        activeActorIds: [],
      });
      await unlockUserPortraitActors(client, userId);
      await appendSystemPortraitEvent(client, userId, 'quota.cleanup_cancelled_by_upgrade', {
        remoteCleanupInFlight: cleanupInFlight,
      });
      return;
    }
  }

  const needsGraceHandling = entitlementDecreased
    || usageExceeds
    || (graceInProgress && !entitlementIncreased);
  if (!needsGraceHandling) {
    await restoreEntitlementCleanupWithClient(client, userId);
    await writeQuotaState(client, userId, next, {
      graceStatus: 'none',
      graceUntil: null,
      retainedActorIds: [],
      activeActorIds: [],
    });
    await unlockUserPortraitActors(client, userId);
    return;
  }

  const explicitSelection = current?.grace_status === 'reconciling'
    || current?.grace_status === 'completed';
  // 权益有所增加但仍不足以容纳现有用量时，沿用原宽限截止时间，禁止通过反复切换套餐续期。
  const graceUntil = graceAlreadyEstablished && current?.grace_until
    ? current.grace_until
    : addDays(now, QUOTA_GRACE_DAYS);
  const graceExpired = graceUntil !== null && new Date(graceUntil).getTime() <= now.getTime();
  if (!graceExpired) {
    await writeQuotaState(client, userId, next, {
      graceStatus: explicitSelection ? 'reconciling' : 'active',
      graceUntil: graceUntil ?? addDays(now, QUOTA_GRACE_DAYS),
      retainedActorIds: parseIdArray(current?.retained_actor_ids),
      activeActorIds: parseIdArray(current?.active_actor_ids),
    });
    await client.query(
      `UPDATE real_portrait_actors
       SET plan_access_status = 'grace', locked_at = NULL, updated_at = now()
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (current?.grace_status !== 'active') {
      await appendSystemPortraitEvent(client, userId, 'quota.grace_started', {
        graceUntil: new Date(graceUntil ?? addDays(now, QUOTA_GRACE_DAYS)).toISOString(),
      });
    }
    return;
  }

  const selection = selectQuotaActors(
    actors,
    next,
    current,
    explicitSelection,
    entitlementIncreased && graceAlreadyEstablished,
  );
  await requestPortraitTaskCancellationWithClient(client, userId, selection.cleanupActorIds);
  for (const actor of actors) {
    if (!selection.activeActorIds.includes(actor.id)) {
      await scheduleActorRemoteCleanupWithClient(
        client,
        userId,
        actor.id,
        `entitlement:${new Date(graceUntil ?? now).getTime()}`,
      );
    } else if (next.assetsPerActor < toInt(actor.live_asset_count)) {
      await scheduleExcessSecondaryCleanupWithClient(
        client,
        userId,
        actor.id,
        `entitlement:${new Date(graceUntil ?? now).getTime()}`,
      );
    }
  }
  await client.query(
    `UPDATE real_portrait_actors
     SET plan_access_status = CASE WHEN id = ANY($2::uuid[]) THEN 'available' ELSE 'plan_locked' END,
         locked_at = CASE WHEN id = ANY($2::uuid[]) THEN NULL ELSE COALESCE(locked_at, now()) END,
         updated_at = now()
     WHERE user_id = $1 AND deleted_at IS NULL`,
    [userId, selection.retainedActorIds],
  );
  const cleanupPending = await hasPendingEntitlementCleanup(client, userId)
    || await hasUnresolvedQuotaCleanup(client, userId, next, selection.activeActorIds);
  await writeQuotaState(client, userId, next, {
    graceStatus: cleanupPending ? 'reconciling' : 'completed',
    graceUntil: graceUntil ?? now,
    retainedActorIds: selection.retainedActorIds,
    activeActorIds: selection.activeActorIds,
  });
  await appendSystemPortraitEvent(client, userId, 'quota.reconciled', selection);
}

async function readQuotaActors(client: DbClient, userId: string) {
  const result = await client.query<ActorQuotaRow>(
    `SELECT a.id, a.lifecycle_status, a.last_successful_generation_at, a.created_at,
            count(pa.id) FILTER (
              WHERE pa.provider_asset_id IS NOT NULL AND pa.remote_deleted_at IS NULL
            )::integer AS live_asset_count,
            ${activeActorOccupancySql('a')} AS occupies_active_slot
     FROM real_portrait_actors a
     LEFT JOIN real_portrait_assets pa ON pa.actor_id = a.id
     WHERE a.user_id = $1 AND a.deleted_at IS NULL
     GROUP BY a.id
     ORDER BY a.last_successful_generation_at DESC NULLS LAST,
              a.created_at DESC, a.id DESC`,
    [userId],
  );
  return result.rows;
}

function activeActorOccupancySql(actorAlias: 'a' | 'actor') {
  return `(
    ${actorAlias}.lifecycle_status IN (
      'waiting', 'invited', 'verifying', 'awaiting_upload',
      'processing', 'active', 'eviction_warning'
    )
    OR EXISTS (
      SELECT 1 FROM real_portrait_materializations materialization
      WHERE materialization.actor_id = ${actorAlias}.id
        AND materialization.provider_group_id IS NOT NULL
        AND materialization.remote_deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM real_portrait_capacity_reservations reservation
      WHERE reservation.actor_id = ${actorAlias}.id
        AND reservation.status = 'reserved' AND reservation.expires_at > now()
    )
    OR EXISTS (
      SELECT 1 FROM real_portrait_activation_queue queue
      WHERE queue.actor_id = ${actorAlias}.id AND queue.status IN ('waiting', 'promoted')
    )
  )`;
}

function portraitUsage(actors: ActorQuotaRow[]) {
  return {
    profiles: actors.length,
    active: actors.filter(actor => actor.occupies_active_slot).length,
  };
}

function selectQuotaActors(
  actors: ActorQuotaRow[],
  entitlements: PortraitEntitlementSnapshot,
  state: QuotaStateRow | null,
  explicitSelection: boolean,
  fillExpandedQuota = false,
) {
  const owned = new Set(actors.map(actor => actor.id));
  const profileLimit = entitlements.enabled ? entitlements.profileLimit : 0;
  const activeLimit = entitlements.enabled ? entitlements.activeLimit : 0;
  const maxProfiles = profileLimit === null ? actors.length : profileLimit;
  const requestedRetained = parseIdArray(state?.retained_actor_ids).filter(id => owned.has(id));
  const retainedFallback = actors.map(actor => actor.id).filter(id => !requestedRetained.includes(id));
  const retainedActorIds = (explicitSelection
    ? [...requestedRetained, ...(fillExpandedQuota ? retainedFallback : [])]
    : actors.map(actor => actor.id))
    .slice(0, maxProfiles);
  const retained = new Set(retainedActorIds);
  const activeEligible = new Set(
    actors.filter(actor => actor.occupies_active_slot).map(actor => actor.id),
  );
  const requestedActive = parseIdArray(state?.active_actor_ids)
    .filter(id => retained.has(id) && activeEligible.has(id));
  const autoActive = actors
    .filter(actor => (
      retained.has(actor.id)
      && activeEligible.has(actor.id)
    ))
    .map(actor => actor.id);
  const activeFallback = autoActive.filter(id => !requestedActive.includes(id));
  const activeActorIds = (explicitSelection
    ? [...requestedActive, ...(fillExpandedQuota ? activeFallback : [])]
    : autoActive)
    .slice(0, activeLimit);
  const active = new Set(activeActorIds);
  return {
    retainedActorIds,
    activeActorIds,
    cleanupActorIds: actors.filter(actor => !active.has(actor.id)).map(actor => actor.id),
  };
}

async function writeQuotaState(
  client: DbClient,
  userId: string,
  entitlements: PortraitEntitlementSnapshot,
  state: {
    graceStatus: QuotaStateRow['grace_status'];
    graceUntil: Date | string | null;
    retainedActorIds: string[];
    activeActorIds: string[];
  },
) {
  await client.query(
    `INSERT INTO user_portrait_quota_states (
       user_id, source_plan_id, portrait_enabled, profile_limit,
       active_limit, assets_per_actor, grace_status, grace_until,
       retained_actor_ids, active_actor_ids
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
     ON CONFLICT (user_id) DO UPDATE
     SET source_plan_id = EXCLUDED.source_plan_id,
         portrait_enabled = EXCLUDED.portrait_enabled,
         profile_limit = EXCLUDED.profile_limit,
         active_limit = EXCLUDED.active_limit,
         assets_per_actor = EXCLUDED.assets_per_actor,
         grace_status = EXCLUDED.grace_status,
         grace_until = EXCLUDED.grace_until,
         retained_actor_ids = EXCLUDED.retained_actor_ids,
         active_actor_ids = EXCLUDED.active_actor_ids,
         updated_at = now()`,
    [
      userId,
      entitlements.sourcePlanId,
      entitlements.enabled,
      entitlements.profileLimit,
      entitlements.activeLimit,
      entitlements.assetsPerActor,
      state.graceStatus,
      state.graceUntil,
      JSON.stringify(state.retainedActorIds),
      JSON.stringify(state.activeActorIds),
    ],
  );
}

async function unlockUserPortraitActors(client: DbClient, userId: string) {
  await client.query(
    `UPDATE real_portrait_actors
     SET plan_access_status = 'available', locked_at = NULL, updated_at = now()
     WHERE user_id = $1 AND deleted_at IS NULL`,
    [userId],
  );
}

export async function requestPortraitTaskCancellationWithClient(
  client: DbClient,
  userId: string,
  actorIds: string[],
  options: {
    authorizationIds?: string[];
    reason?: 'entitlement' | 'authorization-expired';
  } = {},
) {
  if (actorIds.length === 0) return;
  const authorizationIds = options.authorizationIds?.length ? options.authorizationIds : null;
  const tasks = await client.query<{
    id: string;
    attempt: number | string;
    status: 'queued' | 'processing';
    credit_status: string;
    reserved_credits: number | string;
    main_credits_used: number | string;
    addon_credits_used: number | string;
    active_provider_run_id: string | null;
    provider_run_status: string | null;
  }>(
    `SELECT task.id, task.attempt, task.status, task.credit_status,
            task.reserved_credits, task.main_credits_used, task.addon_credits_used,
            task.active_provider_run_id, run.status AS provider_run_status
     FROM generation_tasks task
     LEFT JOIN generation_provider_runs run ON run.id = task.active_provider_run_id
     WHERE task.user_id = $1
       AND task.status IN ('queued', 'processing')
       AND EXISTS (
         SELECT 1 FROM generation_real_portrait_references ref
         WHERE ref.task_id = task.id AND ref.task_attempt = task.attempt
           AND ref.actor_id = ANY($2::uuid[])
           AND ($3::uuid[] IS NULL OR ref.authorization_id = ANY($3::uuid[]))
       )
     FOR UPDATE OF task`,
    [userId, actorIds, authorizationIds],
  );
  for (const task of tasks.rows) {
    const lockedRun = task.active_provider_run_id
      ? await client.query<{ status: string }>(
          `SELECT status FROM generation_provider_runs WHERE id = $1 FOR UPDATE`,
          [task.active_provider_run_id],
        )
      : null;
    const providerRunStatus = lockedRun?.rows[0]?.status ?? task.provider_run_status;
    const definitelyUnsubmitted = providerRunStatus === 'prepared'
      || (task.status === 'queued' && !providerRunStatus);
    if (definitelyUnsubmitted) {
      await cancelQueuedPortraitTaskWithRefund(client, userId, task, options.reason ?? 'entitlement');
    }
  }
}

async function cancelQueuedPortraitTaskWithRefund(
  client: DbClient,
  userId: string,
  task: {
    id: string;
    attempt: number | string;
    credit_status: string;
    reserved_credits: number | string;
    main_credits_used: number | string;
    addon_credits_used: number | string;
    active_provider_run_id: string | null;
  },
  reason: 'entitlement' | 'authorization-expired',
) {
  const attempt = toInt(task.attempt);
  const authorizationExpired = reason === 'authorization-expired';
  const ledgerNote = authorizationExpired
    ? '真人授权已过期；任务尚未提交供应商，已安全取消。'
    : '真人套餐额度调整；任务尚未提交供应商，已安全取消。';
  const eventKeyPrefix = authorizationExpired
    ? 'portrait-authorization-expired-cancel-refund'
    : 'portrait-entitlement-cancel-refund';
  let returnedCredits = 0;
  if (task.credit_status === 'held') {
    const release = await releaseGenerationLotsWithClient(client, task.id, attempt);
    if (!release) throw reconciliationError('排队任务缺少积分冻结批次', 'PORTRAIT_TASK_CREDIT_LOT_MISSING');
    returnedCredits = toInt(release.mainReturned) + toInt(release.addonReturned);
    if (returnedCredits + toInt(release.expiredAmount) !== toInt(task.reserved_credits)) {
      throw reconciliationError('排队任务积分释放不完整', 'PORTRAIT_TASK_CREDIT_RELEASE_MISMATCH');
    }
    const synced = await setUserAvailableCreditsWithClient(client, userId);
    await client.query(
      `UPDATE credit_ledger
       SET settlement_status = 'refunded', note = $2
       WHERE related_job_id = $1 AND type = 'hold' AND settlement_status = 'held'`,
      [task.id, authorizationExpired
        ? '真人授权过期，供应商提交前取消并释放预扣'
        : '真人套餐调整，供应商提交前取消并释放预扣'],
    );
    await client.query(
      `INSERT INTO credit_ledger (
         user_id, type, bucket, settlement_status, amount, balance,
         source, operator, note, related_job_id, business_event_key
       ) VALUES ($1, 'refund', $2, 'refunded', $3, $4,
                 $8, 'system', $5, $6, $7)
       ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO NOTHING`,
      [
        userId,
        bucketForUsage(toInt(task.main_credits_used), toInt(task.addon_credits_used)),
        returnedCredits,
        synced.balance,
        ledgerNote,
        task.id,
        `${eventKeyPrefix}:${task.id}:${attempt}`,
        authorizationExpired ? '真人授权过期取消' : '真人套餐调整取消',
      ],
    );
  }
  await client.query(
    `UPDATE generation_tasks
     SET status = 'canceled', processing_stage = 'canceled', cancel_state = 'canceled',
         cancel_requested_at = COALESCE(cancel_requested_at, now()),
         cancel_origin = $4,
         cancel_reason_code = $5,
         failure_category = 'user-canceled',
         failure_reason = $6,
         refunded_credits = CASE WHEN credit_status = 'held' THEN $3 ELSE refunded_credits END,
         credit_status = CASE WHEN credit_status = 'held' THEN 'refunded' ELSE credit_status END,
         claim_token = NULL, lease_expires_at = NULL, completed_at = now(), updated_at = now()
     WHERE id = $1 AND attempt = $2 AND status IN ('queued', 'processing')`,
    [
      task.id,
      attempt,
      returnedCredits,
      authorizationExpired ? 'portrait-authorization' : 'portrait-entitlement',
      authorizationExpired ? 'portrait-authorization-expired' : 'portrait-plan-reconciled',
      authorizationExpired
        ? '真人授权已过期，任务在供应商提交前取消'
        : '真人套餐额度调整，任务在供应商提交前取消',
    ],
  );
  if (task.active_provider_run_id) {
    const cancelledRun = await client.query(
      `UPDATE generation_provider_runs
       SET status = 'refunded', lease_token = NULL, lease_expires_at = NULL,
           completed_at = now(), updated_at = now()
       WHERE id = $1 AND task_attempt = $2 AND status = 'prepared'`,
      [task.active_provider_run_id, attempt],
    );
    if (!cancelledRun.rowCount) {
      throw reconciliationError('供应商执行已越过安全取消边界', 'PORTRAIT_TASK_ALREADY_SUBMITTED');
    }
  }
}

async function restoreEntitlementCleanupWithClient(client: DbClient, userId: string) {
  await client.query(
    `UPDATE real_portrait_remote_operations
     SET status = 'completed', last_error_code = 'CANCELLED_BY_ENTITLEMENT_UPGRADE',
         next_retry_at = NULL, updated_at = now()
     WHERE user_id = $1
       AND operation_type LIKE 'entitlement_%'
       AND status IN ('prepared', 'failed')`,
    [userId],
  );
  await client.query(
    `UPDATE real_portrait_assets asset
     SET status = 'active', error_code = NULL, updated_at = now()
     FROM real_portrait_actors actor
     WHERE actor.id = asset.actor_id AND actor.user_id = $1
       AND asset.status = 'deleting' AND asset.remote_deleted_at IS NULL
       AND asset.provider_asset_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM real_portrait_remote_operations operation
         WHERE operation.portrait_asset_id = asset.id
           AND operation.status IN ('submitting', 'submitted', 'submission_unknown', 'manual_review')
       )`,
    [userId],
  );
  await client.query(
    `UPDATE real_portrait_materializations materialization
     SET status = 'active', updated_at = now()
     FROM real_portrait_actors actor
     WHERE actor.id = materialization.actor_id AND actor.user_id = $1
       AND materialization.status IN ('eviction_warning', 'deleting')
       AND materialization.remote_deleted_at IS NULL
       AND materialization.provider_group_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM real_portrait_assets asset
         WHERE asset.materialization_id = materialization.id
           AND asset.kind = 'primary'
           AND asset.status = 'active'
           AND asset.consistency_status = 'passed'
           AND asset.provider_asset_id IS NOT NULL
           AND asset.remote_deleted_at IS NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM real_portrait_remote_operations operation
         WHERE operation.materialization_id = materialization.id
           AND operation.operation_type LIKE '%group%'
           AND operation.status IN ('submitting', 'submitted', 'submission_unknown', 'manual_review')
       )`,
    [userId],
  );
  await client.query(
    `UPDATE real_portrait_actors actor
     SET lifecycle_status = CASE
           WHEN EXISTS (
             SELECT 1
             FROM real_portrait_materializations materialization
             JOIN real_portrait_assets primary_asset
               ON primary_asset.materialization_id = materialization.id
              AND primary_asset.actor_id = actor.id
              AND primary_asset.kind = 'primary'
              AND primary_asset.status = 'active'
              AND primary_asset.consistency_status = 'passed'
              AND primary_asset.provider_asset_id IS NOT NULL
              AND primary_asset.remote_deleted_at IS NULL
             WHERE materialization.actor_id = actor.id
               AND materialization.status = 'active'
           ) THEN 'active'
           WHEN EXISTS (
             SELECT 1 FROM real_portrait_materializations materialization
             WHERE materialization.actor_id = actor.id AND materialization.remote_deleted_at IS NOT NULL
           ) THEN 'evicted'
           ELSE actor.lifecycle_status
         END,
         updated_at = now()
     WHERE actor.user_id = $1 AND actor.deleted_at IS NULL
       AND actor.lifecycle_status IN ('eviction_warning', 'deleting', 'evicted')`,
    [userId],
  );
  await client.query(
    `UPDATE generation_tasks task
     SET cancel_requested_at = NULL, cancel_state = 'none', cancel_origin = NULL,
         cancel_reason_code = NULL, updated_at = now()
     WHERE task.user_id = $1 AND task.status IN ('queued', 'processing')
       AND task.cancel_origin = 'portrait-entitlement'
       AND NOT EXISTS (
         SELECT 1
         FROM generation_real_portrait_references ref
         JOIN real_portrait_actors actor ON actor.id = ref.actor_id
         JOIN real_portrait_authorizations auth ON auth.id = ref.authorization_id
         WHERE ref.task_id = task.id AND ref.task_attempt = task.attempt
           AND (actor.plan_access_status = 'plan_locked' OR auth.status IN ('revoked', 'expired'))
       )`,
    [userId],
  );
  const pending = await client.query(
    `SELECT 1 FROM real_portrait_remote_operations
     WHERE user_id = $1 AND operation_type LIKE 'entitlement_%'
       AND status IN ('submitting', 'submitted', 'submission_unknown', 'manual_review')
     LIMIT 1`,
    [userId],
  );
  return Boolean(pending.rowCount);
}

async function scheduleActorRemoteCleanupWithClient(
  client: DbClient,
  userId: string,
  actorId: string,
  cleanupEpoch: string,
) {
  const pinned = await actorHasNonterminalGeneration(client, actorId)
    || await actorHasUnsettledCreateAsset(client, actorId);
  if (pinned) {
    await client.query(
      `UPDATE real_portrait_materializations
       SET status = 'eviction_warning', eviction_eligible_at = COALESCE(eviction_eligible_at, now()),
           updated_at = now()
       WHERE actor_id = $1 AND status IN ('active', 'processing', 'awaiting_upload')`,
      [actorId],
    );
    await client.query(
      `UPDATE real_portrait_actors
       SET lifecycle_status = 'eviction_warning', updated_at = now()
       WHERE id = $1 AND lifecycle_status NOT IN ('revoked', 'expired')`,
      [actorId],
    );
    return false;
  }
  const materializations = await client.query<{
    id: string;
    provider_group_id: string | null;
  }>(
    `SELECT id, provider_group_id
     FROM real_portrait_materializations
     WHERE actor_id = $1
       AND (
         (provider_group_id IS NOT NULL AND remote_deleted_at IS NULL)
         OR status NOT IN ('evicted', 'deleted', 'error')
       )
     FOR UPDATE`,
    [actorId],
  );
  for (const materialization of materializations.rows) {
    if (!materialization.provider_group_id) {
      // Group 尚未回写时，权威查单仍可能在稍后返回真实远端资源。此时不能把物化
      // 推入数据库禁止的 deleting，也不能伪造远端已经删除；查单 worker 会在
      // Group 迟到后使用 late-validation-group 幂等键接管删除。
      if (await materializationHasUnresolvedRemoteState(client, materialization.id)) continue;
      await client.query(
        `UPDATE real_portrait_materializations
         SET status = 'error', remote_deleted_at = COALESCE(remote_deleted_at, now()),
             updated_at = now()
         WHERE id = $1 AND provider_group_id IS NULL`,
        [materialization.id],
      );
      continue;
    }
    const assets = await client.query<{ id: string; provider_asset_id: string | null }>(
      `SELECT id, provider_asset_id
       FROM real_portrait_assets
       WHERE materialization_id = $1 AND status <> 'deleted'
       FOR UPDATE`,
      [materialization.id],
    );
    for (const asset of assets.rows) {
      if (!asset.provider_asset_id) {
        await client.query(
          `UPDATE real_portrait_assets
           SET status = 'deleted', error_code = NULL,
               remote_deleted_at = now(), updated_at = now()
           WHERE id = $1`,
          [asset.id],
        );
        continue;
      }
      await scheduleRemoteOperation(client, {
        userId,
        actorId,
        materializationId: materialization.id,
        portraitAssetId: asset.id,
        operationType: 'entitlement_delete_asset',
        idempotencyKey: `entitlement-asset:${cleanupEpoch}:${asset.id}`,
      });
      await client.query(
        `UPDATE real_portrait_assets
         SET status = 'deleting', error_code = NULL, updated_at = now()
         WHERE id = $1`,
        [asset.id],
      );
    }
    await client.query(
      `UPDATE real_portrait_materializations
       SET status = 'deleting', eviction_eligible_at = COALESCE(eviction_eligible_at, now()),
           updated_at = now()
       WHERE id = $1 AND provider_group_id IS NOT NULL`,
      [materialization.id],
    );
    if (assets.rows.every(asset => !asset.provider_asset_id) && materialization.provider_group_id) {
      await scheduleRemoteOperation(client, {
        userId,
        actorId,
        materializationId: materialization.id,
        portraitAssetId: null,
        operationType: 'entitlement_delete_group',
        idempotencyKey: `entitlement-group:${cleanupEpoch}:${materialization.id}`,
      });
    }
  }
  return true;
}

async function materializationHasUnresolvedRemoteState(
  client: DbClient,
  materializationId: string,
) {
  const result = await client.query(
    `SELECT 1
     WHERE EXISTS (
       SELECT 1
       FROM real_portrait_remote_operations operation
       WHERE operation.materialization_id = $1
         AND operation.status <> 'completed'
     )
     OR EXISTS (
       SELECT 1
       FROM real_portrait_materializations materialization
       JOIN real_portrait_verification_sessions verification_session
         ON verification_session.actor_id = materialization.actor_id
        AND verification_session.authorization_id = materialization.authorization_id
       WHERE materialization.id = $1
         AND verification_session.status IN (
           'prepared', 'submitting', 'invitation_ready', 'waiting', 'submission_unknown'
         )
     )
     OR EXISTS (
       SELECT 1
       FROM real_portrait_assets asset
       WHERE asset.materialization_id = $1
         AND asset.provider_asset_id IS NOT NULL
         AND asset.remote_deleted_at IS NULL
     )
     LIMIT 1`,
    [materializationId],
  );
  return Boolean(result.rowCount);
}

async function scheduleExcessSecondaryCleanupWithClient(
  client: DbClient,
  userId: string,
  actorId: string,
  cleanupEpoch: string,
) {
  const assets = await client.query<{ id: string; materialization_id: string; provider_asset_id: string | null }>(
    `SELECT asset.id, asset.materialization_id, asset.provider_asset_id
     FROM real_portrait_assets asset
     WHERE asset.actor_id = $1 AND asset.kind = 'secondary' AND asset.status <> 'deleted'
       AND NOT EXISTS (
         SELECT 1
         FROM generation_real_portrait_references ref
         JOIN generation_tasks task ON task.id = ref.task_id AND task.attempt = ref.task_attempt
         WHERE ref.portrait_asset_id = asset.id AND task.status IN ('queued', 'processing')
       )
     FOR UPDATE`,
    [actorId],
  );
  for (const asset of assets.rows) {
    if (!asset.provider_asset_id) {
      await client.query(
        `UPDATE real_portrait_assets
         SET status = 'deleted', error_code = NULL,
             remote_deleted_at = now(), updated_at = now()
         WHERE id = $1`,
        [asset.id],
      );
      continue;
    }
    await scheduleRemoteOperation(client, {
      userId,
      actorId,
      materializationId: asset.materialization_id,
      portraitAssetId: asset.id,
      operationType: 'entitlement_delete_asset',
      idempotencyKey: `entitlement-secondary:${cleanupEpoch}:${asset.id}`,
    });
    await client.query(
      `UPDATE real_portrait_assets
       SET status = 'deleting', error_code = NULL, updated_at = now()
       WHERE id = $1`,
      [asset.id],
    );
  }
}

async function actorHasNonterminalGeneration(client: DbClient, actorId: string) {
  const result = await client.query(
    `SELECT 1
     FROM generation_real_portrait_references ref
     JOIN generation_tasks task ON task.id = ref.task_id AND task.attempt = ref.task_attempt
     WHERE ref.actor_id = $1 AND task.status IN ('queued', 'processing')
     LIMIT 1`,
    [actorId],
  );
  return Boolean(result.rowCount);
}

async function actorHasUnsettledCreateAsset(client: DbClient, actorId: string) {
  const result = await client.query(
    `SELECT 1
     FROM real_portrait_remote_operations operation
     WHERE operation.actor_id = $1
       AND operation.operation_type = 'create_asset'
       AND operation.status IN ('submitting', 'submission_unknown', 'manual_review')
     LIMIT 1`,
    [actorId],
  );
  return Boolean(result.rowCount);
}

async function hasPendingEntitlementCleanup(client: DbClient, userId: string) {
  const result = await client.query(
    `SELECT 1
     FROM real_portrait_remote_operations
     WHERE user_id = $1 AND operation_type LIKE 'entitlement_%'
       AND status <> 'completed'
     LIMIT 1`,
    [userId],
  );
  return Boolean(result.rowCount);
}

async function hasUnresolvedQuotaCleanup(
  client: DbClient,
  userId: string,
  entitlements: PortraitEntitlementSnapshot,
  activeActorIds: string[],
) {
  const result = await client.query(
    `SELECT 1
     FROM real_portrait_actors actor
     WHERE actor.user_id = $1 AND actor.deleted_at IS NULL
       AND (
         (
           NOT (actor.id = ANY($2::uuid[]))
           AND EXISTS (
             SELECT 1 FROM real_portrait_materializations materialization
             WHERE materialization.actor_id = actor.id
               AND materialization.provider_group_id IS NOT NULL
               AND materialization.remote_deleted_at IS NULL
           )
         )
         OR (
           actor.id = ANY($2::uuid[])
           AND (
             SELECT count(*) FROM real_portrait_assets asset
             WHERE asset.actor_id = actor.id
               AND asset.provider_asset_id IS NOT NULL
               AND asset.remote_deleted_at IS NULL
           ) > $3
         )
       )
     LIMIT 1`,
    [userId, activeActorIds, entitlements.assetsPerActor],
  );
  return Boolean(result.rowCount);
}

async function scheduleRemoteOperation(client: DbClient, input: {
  userId: string;
  actorId: string;
  materializationId: string | null;
  portraitAssetId: string | null;
  operationType: string;
  idempotencyKey: string;
}) {
  await client.query(
    `INSERT INTO real_portrait_remote_operations (
       user_id, actor_id, materialization_id, portrait_asset_id,
       operation_type, status, idempotency_key
     ) VALUES ($1, $2, $3, $4, $5, 'prepared', $6)
     ON CONFLICT (idempotency_key) DO UPDATE
     SET status = CASE
           WHEN real_portrait_remote_operations.status = 'completed'
             AND real_portrait_remote_operations.last_error_code IS NULL
           THEN 'completed'
           WHEN real_portrait_remote_operations.status IN ('submitting', 'submitted', 'submission_unknown', 'manual_review')
           THEN real_portrait_remote_operations.status
           ELSE 'prepared'
         END,
         last_error_code = CASE
           WHEN real_portrait_remote_operations.status = 'completed'
             AND real_portrait_remote_operations.last_error_code IS NULL
           THEN NULL
           ELSE real_portrait_remote_operations.last_error_code
         END,
         next_retry_at = NULL,
         updated_at = now()`,
    [
      input.userId,
      input.actorId,
      input.materializationId,
      input.portraitAssetId,
      input.operationType,
      input.idempotencyKey,
    ],
  );
}

export async function processRealPortraitRemoteDeletions(
  limit = 20,
  dependencies: ReconciliationDependencies = {},
) {
  const provider = dependencies.provider ?? getConfiguredRealPortraitProvider();
  const now = dependencies.now?.() ?? new Date();
  await pool.query(
    `UPDATE real_portrait_remote_operations
     SET status = 'submission_unknown', next_retry_at = now(), updated_at = now()
     WHERE operation_type LIKE '%delete%'
       AND status IN ('submitting', 'submitted')
       AND updated_at < now() - ($1::int * interval '1 minute')`,
    [STALE_CLAIM_MINUTES],
  );
  const summary = { claimed: 0, completed: 0, failed: 0 };
  for (let index = 0; index < limit; index += 1) {
    const operation = await claimRemoteDeletion(now);
    if (!operation) break;
    summary.claimed += 1;
    try {
      if (isGroupOperation(operation.operation_type)) {
        if (operation.provider_group_id && operation.project_name) {
          await provider.deleteAssetGroup(operation.provider_group_id, operation.project_name);
        }
      } else if (operation.provider_asset_id && operation.project_name) {
        await provider.deleteAsset(operation.provider_asset_id, operation.project_name);
      }
      await completeRemoteDeletion(operation);
      summary.completed += 1;
    } catch (error) {
      if (isRemoteAlreadyMissing(error)) {
        await completeRemoteDeletion(operation);
        summary.completed += 1;
        continue;
      }
      summary.failed += 1;
      const delaySeconds = Math.min(300, 2 ** Math.min(8, toInt(operation.attempt_count)));
      await pool.query(
        `UPDATE real_portrait_remote_operations
         SET status = 'failed', next_retry_at = $2, last_error_code = $3, updated_at = now()
         WHERE id = $1 AND status = 'submitting'`,
        [operation.id, new Date(now.getTime() + delaySeconds * 1_000), safeErrorCode(error)],
      ).catch(() => undefined);
    }
  }
  return summary;
}

async function claimRemoteDeletion(now: Date): Promise<RemoteOperationClaim | null> {
  return withTransaction(async client => {
    const result = await client.query<RemoteOperationClaim>(
      `SELECT operation.id, operation.user_id, operation.actor_id,
              operation.materialization_id, operation.portrait_asset_id,
              operation.operation_type, operation.attempt_count,
              asset.provider_asset_id, materialization.provider_group_id,
              materialization.project_name
       FROM real_portrait_remote_operations operation
       JOIN real_portrait_actors actor ON actor.id = operation.actor_id
       LEFT JOIN real_portrait_assets asset ON asset.id = operation.portrait_asset_id
       LEFT JOIN real_portrait_materializations materialization ON materialization.id = operation.materialization_id
       WHERE operation.operation_type LIKE '%delete%'
         AND operation.status IN ('prepared', 'failed', 'submission_unknown')
         AND (operation.next_retry_at IS NULL OR operation.next_retry_at <= $1)
         AND (
           operation.operation_type NOT LIKE '%group%'
           OR NOT EXISTS (
             SELECT 1
             FROM real_portrait_remote_operations create_operation
             WHERE create_operation.materialization_id = operation.materialization_id
               AND create_operation.operation_type = 'create_asset'
               AND create_operation.status IN ('submitting', 'submission_unknown', 'manual_review')
           )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM generation_real_portrait_references reference
           JOIN generation_tasks task
             ON task.id = reference.task_id AND task.attempt = reference.task_attempt
           WHERE reference.actor_id = operation.actor_id
             AND task.status IN ('queued', 'processing')
         )
       ORDER BY operation.next_retry_at ASC NULLS FIRST, operation.created_at ASC, operation.id ASC
       FOR UPDATE OF operation, actor SKIP LOCKED
       LIMIT 1`,
      [now],
    );
    const row = result.rows[0];
    if (!row) return null;
    const claimed = await client.query(
      `UPDATE real_portrait_remote_operations
       SET status = 'submitting', attempt_count = attempt_count + 1,
           next_retry_at = NULL, last_error_code = NULL, updated_at = now()
       WHERE id = $1
       RETURNING attempt_count`,
      [row.id],
    );
    return { ...row, attempt_count: claimed.rows[0]?.attempt_count ?? row.attempt_count };
  });
}

async function completeRemoteDeletion(operation: RemoteOperationClaim) {
  await withTransaction(async client => {
    const locked = await client.query<{ status: string }>(
      `SELECT status FROM real_portrait_remote_operations WHERE id = $1 FOR UPDATE`,
      [operation.id],
    );
    if (!locked.rows[0] || locked.rows[0].status === 'completed') return;
    if (isGroupOperation(operation.operation_type)) {
      await client.query(
        `UPDATE real_portrait_assets
         SET status = 'deleted', error_code = NULL,
             remote_deleted_at = COALESCE(remote_deleted_at, now()), updated_at = now()
         WHERE materialization_id = $1 AND status <> 'deleted'`,
        [operation.materialization_id],
      );
      await client.query(
        `UPDATE real_portrait_materializations
         SET status = CASE
               WHEN EXISTS (
                 SELECT 1 FROM real_portrait_actors actor
                 WHERE actor.id = real_portrait_materializations.actor_id
                   AND (actor.lifecycle_status = 'revoked' OR actor.deleted_at IS NOT NULL)
               ) THEN 'deleted'
               ELSE 'evicted'
             END,
             remote_deleted_at = COALESCE(remote_deleted_at, now()), updated_at = now()
         WHERE id = $1`,
        [operation.materialization_id],
      );
      await client.query(
        `UPDATE real_portrait_actors
         SET lifecycle_status = CASE
               WHEN lifecycle_status IN ('revoked', 'expired') OR deleted_at IS NOT NULL
               THEN lifecycle_status ELSE 'evicted' END,
             updated_at = now()
         WHERE id = $1`,
        [operation.actor_id],
      );
      await client.query(
        `UPDATE real_portrait_capacity_reservations
         SET status = 'released', updated_at = now()
         WHERE actor_id = $1 AND status = 'reserved'`,
        [operation.actor_id],
      );
    } else if (operation.portrait_asset_id) {
      await client.query(
        `UPDATE real_portrait_assets
         SET status = 'deleted', error_code = NULL,
             remote_deleted_at = COALESCE(remote_deleted_at, now()), updated_at = now()
         WHERE id = $1`,
        [operation.portrait_asset_id],
      );
    }
    await client.query(
      `UPDATE real_portrait_remote_operations
       SET status = 'completed', next_retry_at = NULL, last_error_code = NULL, updated_at = now()
       WHERE id = $1`,
      [operation.id],
    );
    if (!isGroupOperation(operation.operation_type) && operation.materialization_id) {
      await scheduleGroupAfterAssetsWithClient(client, operation);
    }
    await appendSystemPortraitEvent(client, operation.user_id, 'remote_cleanup.completed', {
      operationId: operation.id,
      operationType: operation.operation_type,
    }, operation.actor_id, operation.materialization_id);
  });
}

async function scheduleGroupAfterAssetsWithClient(client: DbClient, operation: RemoteOperationClaim) {
  const materialization = await client.query<{
    actor_id: string;
    provider_group_id: string | null;
    status: string;
  }>(
    `SELECT actor_id, provider_group_id, status
     FROM real_portrait_materializations
     WHERE id = $1 FOR UPDATE`,
    [operation.materialization_id],
  );
  const row = materialization.rows[0];
  if (!row?.provider_group_id || row.status !== 'deleting') return;
  if (await materializationHasUnsettledCreateAsset(client, operation.materialization_id!)) return;
  const remaining = await client.query(
    `SELECT 1 FROM real_portrait_assets
     WHERE materialization_id = $1 AND status <> 'deleted'
     LIMIT 1`,
    [operation.materialization_id],
  );
  if (remaining.rowCount) return;
  const prefix = operation.operation_type.startsWith('capacity_')
    ? 'capacity'
    : operation.operation_type.startsWith('authorization_')
      ? 'authorization'
      : 'entitlement';
  await scheduleRemoteOperation(client, {
    userId: operation.user_id,
    actorId: row.actor_id,
    materializationId: operation.materialization_id,
    portraitAssetId: null,
    operationType: `${prefix}_delete_group`,
    idempotencyKey: `${prefix}-group:${operation.materialization_id}`,
  });
}

export async function processRealPortraitCapacityQueue(
  limit = 20,
  dependencies: ReconciliationDependencies = {},
) {
  const now = dependencies.now?.() ?? new Date();
  return withTransaction(async client => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [CAPACITY_LOCK_KEY]);
    const cancelledPromoted = await client.query<{ reservation_id: string | null }>(
      `UPDATE real_portrait_activation_queue queue
       SET status = 'cancelled', updated_at = now()
       FROM real_portrait_actors actor
       WHERE actor.id = queue.actor_id
         AND queue.status = 'promoted'
         AND actor.plan_access_status = 'plan_locked'
       RETURNING queue.reservation_id`,
    );
    const cancelledReservationIds = cancelledPromoted.rows
      .map(row => row.reservation_id)
      .filter((id): id is string => Boolean(id));
    if (cancelledReservationIds.length > 0) {
      await client.query(
        `UPDATE real_portrait_capacity_reservations
         SET status = 'released', updated_at = now()
         WHERE id = ANY($1::uuid[]) AND status IN ('reserved', 'expired')`,
        [cancelledReservationIds],
      );
    }
    const restoredWaiting = await client.query(
      `UPDATE real_portrait_activation_queue queue
       SET status = 'waiting', reservation_id = NULL,
           promoted_at = NULL, updated_at = now()
       FROM real_portrait_actors actor
       WHERE actor.id = queue.actor_id
         AND queue.status = 'promoted'
         AND actor.plan_access_status <> 'plan_locked'
         AND NOT EXISTS (
           SELECT 1
           FROM real_portrait_capacity_reservations reservation
           WHERE reservation.id = queue.reservation_id
             AND reservation.user_id = queue.user_id
             AND reservation.actor_id = queue.actor_id
             AND reservation.status = 'reserved'
             AND reservation.expires_at > $1
         )`,
      [now],
    );
    await client.query(
      `UPDATE real_portrait_capacity_reservations
       SET status = 'expired', updated_at = now()
       WHERE status = 'reserved' AND expires_at <= $1`,
      [now],
    );
    const summary = {
      scanned: 0,
      promoted: 0,
      cancelled: cancelledPromoted.rowCount ?? 0,
      waiting: restoredWaiting.rowCount ?? 0,
    };
    for (let index = 0; index < limit; index += 1) {
      const queue = await client.query<{ id: string; user_id: string; actor_id: string; plan_access_status: string }>(
        `SELECT queue.id, queue.user_id, queue.actor_id, actor.plan_access_status
         FROM real_portrait_activation_queue queue
         JOIN real_portrait_actors actor ON actor.id = queue.actor_id AND actor.deleted_at IS NULL
         WHERE queue.status = 'waiting'
           AND NOT EXISTS (
             SELECT 1
             FROM real_portrait_activation_queue earlier
             WHERE earlier.user_id = queue.user_id AND earlier.status = 'waiting'
               AND (earlier.requested_at, earlier.id) < (queue.requested_at, queue.id)
           )
         ORDER BY (
           SELECT max(history.promoted_at)
           FROM real_portrait_activation_queue history
           WHERE history.user_id = queue.user_id AND history.promoted_at IS NOT NULL
         ) ASC NULLS FIRST,
         queue.requested_at ASC, queue.id ASC
         FOR UPDATE OF queue SKIP LOCKED
         LIMIT 1`,
      );
      const item = queue.rows[0];
      if (!item) break;
      summary.scanned += 1;
      const entitlements = await getPortraitEntitlementsForUser(client, item.user_id);
      const activeCount = await countUserActiveActors(client, item.user_id, item.actor_id);
      if (!entitlements?.portraitEnabled
        || item.plan_access_status === 'plan_locked'
        || activeCount >= (entitlements?.portraitActiveLimit ?? 0)) {
        await client.query(
          `UPDATE real_portrait_activation_queue
           SET status = 'cancelled', updated_at = now() WHERE id = $1`,
          [item.id],
        );
        summary.cancelled += 1;
        continue;
      }
      const snapshot = await readGlobalCapacity(client);
      // 队列提升只保证 1 Group + 1 张必选主图；第二张弹性图在实际上传时单独抢占容量。
      const desiredAssets = 1;
      if (snapshot.groupsUsed + snapshot.groupsReserved + 1 <= env.REAL_PORTRAIT_GROUP_SOFT_LIMIT
        && snapshot.assetsUsed + snapshot.assetsReserved + desiredAssets <= env.REAL_PORTRAIT_ASSET_SOFT_LIMIT) {
        const reservation = await client.query<{ id: string }>(
          `INSERT INTO real_portrait_capacity_reservations (
             user_id, actor_id, group_slots, asset_slots, expires_at
           ) VALUES ($1, $2, 1, $3, $4)
           ON CONFLICT (actor_id) WHERE status = 'reserved'
           DO UPDATE SET expires_at = GREATEST(real_portrait_capacity_reservations.expires_at, EXCLUDED.expires_at),
                         updated_at = now()
           RETURNING id`,
          [item.user_id, item.actor_id, desiredAssets, addHours(now, CAPACITY_RESERVATION_HOURS)],
        );
        await client.query(
          `UPDATE real_portrait_activation_queue
           SET status = 'promoted', reservation_id = $2, promoted_at = now(), updated_at = now()
           WHERE id = $1 AND status = 'waiting'`,
          [item.id, reservation.rows[0]!.id],
        );
        await appendSystemPortraitEvent(client, item.user_id, 'activation.promoted', {
          queueId: item.id,
          reservationId: reservation.rows[0]!.id,
        }, item.actor_id);
        summary.promoted += 1;
        continue;
      }
      await scheduleCapacityEvictionWithClient(client, snapshot, now);
      summary.waiting += 1;
      break;
    }
    return summary;
  });
}

async function scheduleCapacityEvictionWithClient(
  client: DbClient,
  snapshot: Awaited<ReturnType<typeof readGlobalCapacity>>,
  now: Date,
) {
  if (snapshot.assetsUsed + snapshot.assetsReserved >= env.REAL_PORTRAIT_ASSET_SOFT_LIMIT) {
    const secondary = await client.query<{
      id: string;
      actor_id: string;
      user_id: string;
      materialization_id: string;
      provider_asset_id: string;
    }>(
      `SELECT asset.id, asset.actor_id, actor.user_id, asset.materialization_id, asset.provider_asset_id
       FROM real_portrait_assets asset
       JOIN real_portrait_actors actor ON actor.id = asset.actor_id AND actor.deleted_at IS NULL
       WHERE asset.kind = 'secondary' AND asset.status = 'active' AND asset.provider_asset_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM generation_real_portrait_references ref
           JOIN generation_tasks task ON task.id = ref.task_id AND task.attempt = ref.task_attempt
           WHERE ref.portrait_asset_id = asset.id AND task.status IN ('queued', 'processing')
         )
       ORDER BY actor.last_successful_generation_at ASC NULLS FIRST,
                actor.created_at ASC, asset.created_at ASC, asset.id ASC
       FOR UPDATE OF asset SKIP LOCKED
       LIMIT 1`,
    );
    const asset = secondary.rows[0];
    if (asset) {
      await scheduleRemoteOperation(client, {
        userId: asset.user_id,
        actorId: asset.actor_id,
        materializationId: asset.materialization_id,
        portraitAssetId: asset.id,
        operationType: 'capacity_delete_asset',
        idempotencyKey: `capacity-secondary:${asset.id}`,
      });
      await client.query(
        `UPDATE real_portrait_assets
         SET status = 'deleting', error_code = NULL, updated_at = now()
         WHERE id = $1`,
        [asset.id],
      );
      return true;
    }
  }
  const actor = await client.query<{ id: string; user_id: string }>(
    `SELECT actor.id, actor.user_id
     FROM real_portrait_actors actor
     JOIN real_portrait_materializations materialization ON materialization.actor_id = actor.id
     WHERE actor.deleted_at IS NULL
       AND materialization.status = 'active' AND materialization.provider_group_id IS NOT NULL
       AND (
         actor.last_successful_generation_at <= $1::timestamptz - ($2::int * interval '1 day')
         OR (
           actor.last_successful_generation_at IS NULL
           AND actor.created_at <= $1::timestamptz - ($2::int * interval '1 day')
         )
       )
       AND NOT EXISTS (
         SELECT 1
         FROM generation_real_portrait_references ref
         JOIN generation_tasks task ON task.id = ref.task_id AND task.attempt = ref.task_attempt
         WHERE ref.actor_id = actor.id AND task.status IN ('queued', 'processing')
       )
       AND NOT EXISTS (
         SELECT 1
         FROM real_portrait_remote_operations operation
         WHERE operation.actor_id = actor.id
           AND operation.operation_type = 'create_asset'
           AND operation.status IN ('submitting', 'submission_unknown', 'manual_review')
       )
     ORDER BY actor.last_successful_generation_at ASC NULLS FIRST, actor.created_at ASC, actor.id ASC
     FOR UPDATE OF actor SKIP LOCKED
     LIMIT 1`,
    [now, COLD_ACTOR_DAYS],
  );
  const candidate = actor.rows[0];
  if (!candidate) return false;
  await scheduleActorCapacityCleanupWithClient(client, candidate.user_id, candidate.id);
  return true;
}

async function scheduleActorCapacityCleanupWithClient(client: DbClient, userId: string, actorId: string) {
  const materializations = await client.query<{ id: string; provider_group_id: string | null }>(
    `SELECT id, provider_group_id FROM real_portrait_materializations
     WHERE actor_id = $1 AND status = 'active' FOR UPDATE`,
    [actorId],
  );
  for (const materialization of materializations.rows) {
    if (await materializationHasUnsettledCreateAsset(client, materialization.id)) continue;
    const assets = await client.query<{ id: string; provider_asset_id: string | null }>(
      `SELECT id, provider_asset_id FROM real_portrait_assets
       WHERE materialization_id = $1 AND status <> 'deleted' FOR UPDATE`,
      [materialization.id],
    );
    for (const asset of assets.rows) {
      if (!asset.provider_asset_id) {
        await client.query(
          `UPDATE real_portrait_assets
           SET status = 'deleted', error_code = NULL,
               remote_deleted_at = now(), updated_at = now()
           WHERE id = $1`,
          [asset.id],
        );
        continue;
      }
      await scheduleRemoteOperation(client, {
        userId,
        actorId,
        materializationId: materialization.id,
        portraitAssetId: asset.id,
        operationType: 'capacity_delete_asset',
        idempotencyKey: `capacity-asset:${asset.id}`,
      });
      await client.query(
        `UPDATE real_portrait_assets
         SET status = 'deleting', error_code = NULL, updated_at = now()
         WHERE id = $1`,
        [asset.id],
      );
    }
    await client.query(
      `UPDATE real_portrait_materializations
       SET status = 'deleting', eviction_eligible_at = COALESCE(eviction_eligible_at, now()),
           updated_at = now() WHERE id = $1`,
      [materialization.id],
    );
    if (assets.rows.every(asset => !asset.provider_asset_id) && materialization.provider_group_id) {
      await scheduleRemoteOperation(client, {
        userId,
        actorId,
        materializationId: materialization.id,
        portraitAssetId: null,
        operationType: 'capacity_delete_group',
        idempotencyKey: `capacity-group:${materialization.id}`,
      });
    }
  }
  await client.query(
    `UPDATE real_portrait_actors SET lifecycle_status = 'eviction_warning', updated_at = now()
     WHERE id = $1 AND lifecycle_status = 'active'`,
    [actorId],
  );
}

export async function readGlobalCapacity(client: DbClient) {
  const result = await client.query<{
    groups_used: number | string;
    assets_used: number | string;
    groups_reserved: number | string;
    assets_reserved: number | string;
  }>(
    `WITH remote_group_slots AS (
       SELECT actor_id, count(*)::integer AS count
       FROM real_portrait_materializations
       WHERE provider_group_id IS NOT NULL AND remote_deleted_at IS NULL
       GROUP BY actor_id
     ),
     pending_group_slots AS (
       SELECT verification_session.actor_id, count(*)::integer AS count
       FROM real_portrait_verification_sessions verification_session
       JOIN real_portrait_materializations materialization
         ON materialization.actor_id = verification_session.actor_id
        AND materialization.authorization_id = verification_session.authorization_id
       WHERE verification_session.status IN ('invitation_ready', 'waiting', 'submission_unknown')
         AND verification_session.byted_token_ciphertext IS NOT NULL
         AND verification_session.byted_token_fingerprint IS NOT NULL
         AND materialization.provider_group_id IS NULL
       GROUP BY verification_session.actor_id
     ),
     remote_asset_slots AS (
       SELECT asset.actor_id, count(*)::integer AS count
       FROM real_portrait_assets asset
       WHERE asset.provider_asset_id IS NOT NULL AND asset.remote_deleted_at IS NULL
       GROUP BY asset.actor_id
     ),
     pending_asset_slots AS (
       SELECT pending.actor_id, count(*)::integer AS count
       FROM (
         SELECT asset.actor_id, asset.id AS slot_id
         FROM real_portrait_assets asset
         WHERE asset.provider_asset_id IS NULL
           AND asset.status = 'queued'
         UNION ALL
         SELECT upload.actor_id, upload.id AS slot_id
         FROM real_portrait_upload_sessions upload
         WHERE upload.asset_id IS NULL
           AND upload.status IN ('waiting_upload', 'uploaded', 'submitting', 'processing', 'active')
           AND (
             upload.status IN ('submitting', 'processing', 'active')
             OR upload.expires_at > now()
           )
       ) pending
       GROUP BY pending.actor_id
     )
     SELECT
       COALESCE((SELECT sum(remote.count) FROM remote_group_slots remote), 0)::integer AS groups_used,
       COALESCE((SELECT sum(remote.count) FROM remote_asset_slots remote), 0)::integer AS assets_used,
       (
         COALESCE((SELECT sum(pending.count) FROM pending_group_slots pending), 0)
         + COALESCE((SELECT sum(GREATEST(reservation.group_slots - (
           COALESCE((
             SELECT remote.count FROM remote_group_slots remote
             WHERE remote.actor_id = reservation.actor_id
           ), 0)
           + COALESCE((
             SELECT pending.count FROM pending_group_slots pending
             WHERE pending.actor_id = reservation.actor_id
           ), 0)
         ), 0))
         FROM real_portrait_capacity_reservations reservation
         WHERE reservation.status = 'reserved' AND reservation.expires_at > now()), 0)
       )::integer AS groups_reserved,
       (
         COALESCE((SELECT sum(pending.count) FROM pending_asset_slots pending), 0)
         + COALESCE((SELECT sum(GREATEST(reservation.asset_slots - (
           COALESCE((
             SELECT remote.count FROM remote_asset_slots remote
             WHERE remote.actor_id = reservation.actor_id
           ), 0)
           + COALESCE((
             SELECT pending.count FROM pending_asset_slots pending
             WHERE pending.actor_id = reservation.actor_id
           ), 0)
         ), 0))
         FROM real_portrait_capacity_reservations reservation
         WHERE reservation.status = 'reserved' AND reservation.expires_at > now()), 0)
       )::integer AS assets_reserved`,
  );
  const row = result.rows[0];
  return {
    groupsUsed: toInt(row?.groups_used),
    assetsUsed: toInt(row?.assets_used),
    groupsReserved: toInt(row?.groups_reserved),
    assetsReserved: toInt(row?.assets_reserved),
  };
}

export async function countUserActiveActors(client: DbClient, userId: string, exceptActorId: string) {
  const result = await client.query<{ count: number | string }>(
    `SELECT count(*)::integer AS count
     FROM real_portrait_actors actor
     WHERE actor.user_id = $1 AND actor.id <> $2 AND actor.deleted_at IS NULL
       AND ${activeActorOccupancySql('actor')}`,
    [userId, exceptActorId],
  );
  return toInt(result.rows[0]?.count);
}

async function readPlanEntitlements(client: DbClient, planId: string | null) {
  const result = await client.query<{
    id: string;
    portrait_enabled: boolean;
    portrait_profile_limit: number | string | null;
    portrait_active_limit: number | string;
    portrait_assets_per_actor: number | string;
  }>(
    `SELECT id, portrait_enabled, portrait_profile_limit,
            portrait_active_limit, portrait_assets_per_actor
     FROM plans
     WHERE ($1::uuid IS NOT NULL AND id = $1)
        OR ($1::uuid IS NULL AND code = 'free' AND kind = 'main')
     ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [planId],
  );
  const row = result.rows[0];
  if (!row) throw reconciliationError('真人权益来源套餐不存在', 'PORTRAIT_PLAN_MISSING');
  return {
    sourcePlanId: row.id,
    enabled: Boolean(row.portrait_enabled),
    profileLimit: row.portrait_profile_limit === null ? null : toInt(row.portrait_profile_limit),
    activeLimit: toInt(row.portrait_active_limit),
    assetsPerActor: toInt(row.portrait_assets_per_actor),
  };
}

function entitlementSnapshot(
  sourcePlanId: string,
  values: PortraitEntitlementValues | {
    portraitEnabled: boolean;
    portraitProfileLimit: number | null;
    portraitActiveLimit: number;
    portraitAssetsPerActor: number;
  },
): PortraitEntitlementSnapshot {
  return {
    sourcePlanId,
    enabled: values.portraitEnabled,
    profileLimit: values.portraitProfileLimit,
    activeLimit: values.portraitActiveLimit,
    assetsPerActor: values.portraitAssetsPerActor,
  };
}

function sameEntitlements(left: PortraitEntitlementSnapshot, right: PortraitEntitlementSnapshot) {
  return left.enabled === right.enabled
    && left.profileLimit === right.profileLimit
    && left.activeLimit === right.activeLimit
    && left.assetsPerActor === right.assetsPerActor;
}

function quotaStateSnapshot(
  state: QuotaStateRow,
  fallbackSourcePlanId: string,
): PortraitEntitlementSnapshot {
  return {
    sourcePlanId: state.source_plan_id ?? fallbackSourcePlanId,
    enabled: state.portrait_enabled,
    profileLimit: state.profile_limit === null ? null : toInt(state.profile_limit),
    activeLimit: toInt(state.active_limit),
    assetsPerActor: toInt(state.assets_per_actor),
  };
}

function parseEntitlementSnapshot(value: unknown): PortraitEntitlementSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.sourcePlanId !== 'string'
    || typeof input.enabled !== 'boolean'
    || (input.profileLimit !== null && typeof input.profileLimit !== 'number')
    || typeof input.activeLimit !== 'number'
    || typeof input.assetsPerActor !== 'number') {
    return null;
  }
  return {
    sourcePlanId: input.sourcePlanId,
    enabled: input.enabled,
    profileLimit: input.profileLimit as number | null,
    activeLimit: input.activeLimit,
    assetsPerActor: input.assetsPerActor,
  };
}

export function portraitEntitlementsDecreased(
  previous: PortraitEntitlementSnapshot,
  next: PortraitEntitlementSnapshot,
) {
  return (previous.enabled && !next.enabled)
    || (previous.profileLimit === null && next.profileLimit !== null)
    || (previous.profileLimit !== null
      && next.profileLimit !== null
      && next.profileLimit < previous.profileLimit)
    || next.activeLimit < previous.activeLimit
    || next.assetsPerActor < previous.assetsPerActor;
}

function portraitEntitlementsIncreased(
  previous: PortraitEntitlementSnapshot,
  next: PortraitEntitlementSnapshot,
) {
  return (!previous.enabled && next.enabled)
    || (previous.profileLimit !== null && next.profileLimit === null)
    || (previous.profileLimit !== null
      && next.profileLimit !== null
      && next.profileLimit > previous.profileLimit)
    || next.activeLimit > previous.activeLimit
    || next.assetsPerActor > previous.assetsPerActor;
}

function isGroupOperation(operationType: string) {
  return operationType.includes('group');
}

function isRemoteAlreadyMissing(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as { statusCode?: unknown; code?: unknown };
  if (value.statusCode === 404) return true;
  return typeof value.code === 'string' && /not.?found|resource.?missing/i.test(value.code);
}

async function appendSystemPortraitEvent(
  client: DbClient,
  userId: string,
  eventType: string,
  metadata: Record<string, unknown>,
  actorId: string | null = null,
  materializationId: string | null = null,
) {
  await client.query(
    `INSERT INTO real_portrait_events (
       user_id, actor_id, materialization_id, event_type, initiator_type, metadata
     ) VALUES ($1, $2, $3, $4, 'system', $5::jsonb)`,
    [userId, actorId, materializationId, eventType, JSON.stringify(metadata)],
  );
}

function parseIdArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string'))]
    : [];
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1_000);
}

function addHours(value: Date, hours: number) {
  return new Date(value.getTime() + hours * 60 * 60 * 1_000);
}

function safeErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code.slice(0, 240);
  }
  return 'REAL_PORTRAIT_RECONCILIATION_FAILED';
}

function reconciliationError(message: string, code: string) {
  return Object.assign(new Error(message), { code });
}
