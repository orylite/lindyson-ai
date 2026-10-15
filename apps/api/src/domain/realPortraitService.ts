import { ensureRealPortraitThumbnail } from './realPortraitThumbnails.js';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { env } from '../config/env.js';
import { pool, withTransaction, type DbClient } from '../db/pool.js';
import {
  createObjectReadUrl,
  createUploadSignature,
  getStoredObjectSize,
  openStoredObjectStream,
} from '../storage/storageService.js';
import {
  getConfiguredRealPortraitProvider,
  type RealPortraitProvider,
} from '../providers/realPortraitProvider.js';
import { assertProfileQuota, decideRealPortraitCapacity } from './realPortraitCapacity.js';
import {
  scheduleObjectDeletion,
  scheduleSystemAssetDeletion,
} from './assetDeletionService.js';
import { getPortraitEntitlementsForUser } from './portraitEntitlements.js';
import {
  createRealPortraitBearerToken,
  decryptRealPortraitSecret,
  encryptRealPortraitSecret,
  fingerprintRealPortraitSecret,
} from './realPortraitSecrets.js';
import { toIsoDateTime, toInt } from './serialization.js';
import { reconcileSubscriptionWithClient } from './subscriptionLifecycle.js';
import type {
  RealPortraitActor,
  RealPortraitAsset,
  RealPortraitAssetKind,
  RealPortraitCapacityDto,
  RealPortraitCapacitySnapshot,
  RealPortraitGenerationDeliveryDecision,
  RealPortraitGenerationReference,
  RealPortraitQuota,
} from './realPortraitTypes.js';

const CAPACITY_LOCK_KEY = 'lindyson:real-portrait:provider-capacity:v1';
const AUTHORIZATION_VALID_DAYS = 90;
const CAPACITY_RESERVATION_HOURS = 24;
const QUOTA_GRACE_DAYS = 7;
const VERIFICATION_LOOKUP_RETRY_BASE_SECONDS = 60;
const VERIFICATION_LOOKUP_RETRY_MAX_SECONDS = 6 * 60 * 60;
export const REAL_PORTRAIT_PROCESSING_SCOPE =
  '为本人活体校验、真人素材一致性校验、授权素材的缩略图选择及经本人授权的 AI 视频生成处理肖像与敏感人脸信息。生成内容可用于合法的商品宣传、品牌营销、广告投放和商业展示，并发布至品牌官网、电商平台、TikTok、抖音、小红书、微信视频号等短视频或社交媒体、数字广告平台及线下展示渠道；可为适配渠道进行必要的剪辑、裁切、字幕、配音、画幅和版式调整。不得出售、转授权真人肖像，不得用于模型训练、身份冒用、虚假代言或其他违法违规用途。Lindyson 不采集身份证、活体帧或人脸模板。';
export const REAL_PORTRAIT_RETENTION_RULE =
  '授权自本人同意之日起最长 90 天；上传原图在供应商读取成功、失败或最迟 24 小时后删除。另保存最长边 160 像素的缩略图，仅供创建者选择本人授权的真人素材；缩略图随素材失败、删除、演员释放、授权撤回或到期停止展示并异步删除。授权到期后立即停止新生成并异步删除远端真人素材；已经生成的历史视频继续按创建者账号当前套餐的历史素材保留天数保存。本人撤回后，系统内相关历史视频不再展示、下载或复用，不适用套餐保留期；已提交供应商的任务按终态处理但不再向创建者交付。撤回前已经合法发布到第三方渠道的内容不会自动召回，但撤回生效后不得新增投放、转载、编辑或再次发布，平台将对合理的投诉和下架请求提供协助。依法必须保留的脱敏审计记录除外。';
const PORTRAIT_MAX_UPLOAD_BYTES = 30 * 1024 * 1024 - 1;
const PORTRAIT_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/gif',
  'image/heic',
  'image/heif',
]);
const sharp = createRequire(import.meta.url)('sharp') as (input: Buffer) => {
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
};

interface ActorRow {
  id: string;
  alias: string;
  plan_access_status: RealPortraitActor['planAccessStatus'];
  lifecycle_status: RealPortraitActor['lifecycleStatus'];
  authorization_status: RealPortraitActor['authorizationStatus'];
  authorization_expires_at: Date | string | null;
  last_successful_generation_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  assets: unknown;
}

interface QuotaStateRow {
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

interface CapacityCountRow {
  profiles: number | string;
  active: number | string;
  queued: number | string;
  groups_used: number | string;
  assets_used: number | string;
  groups_reserved: number | string;
  assets_reserved: number | string;
}

interface ActivationResult {
  actor: RealPortraitActor;
  queuePosition: number | null;
  invitationUrl: string | null;
  invitationExpiresAt: string | null;
}

type PublicRealPortraitConsentDecision =
  | { accepted: false }
  | {
    accepted: true;
    adultConfirmed: true;
    portraitConsent: true;
    sensitiveFaceConsent: true;
    commercialUseConsent: true;
    authorizationDays: 90;
  };

interface PublicInviteRow {
  invite_id: string;
  invite_status: 'pending' | 'accepted' | 'consumed' | 'expired' | 'cancelled';
  invite_expires_at: Date | string;
  accepted_at: Date | string | null;
  actor_id: string;
  alias: string;
  plan_access_status: string;
  lifecycle_status: string;
  user_id: string;
  authorization_id: string;
  authorization_status: string;
  authorization_valid_until: Date | string;
  purpose: string;
  commercial_use: boolean;
  controller_name: string;
  processor_name: string;
  privacy_contact: string;
  privacy_policy_url: string;
  processing_scope: string;
  retention_rule: string;
  consented_at: Date | string | null;
  portrait_notice_version: string;
  sensitive_info_notice_version: string;
  materialization_id: string;
  materialization_status: string;
  verification_status: string | null;
}

interface VerificationCallbackRow {
  session_id: string;
  actor_id: string;
  authorization_id: string;
  byted_token_ciphertext: string | null;
  byted_token_fingerprint: string | null;
  status: string;
  user_id: string;
  materialization_id: string;
  project_name: string;
}

interface VerificationLookupClaim {
  operationId: string;
  attemptCount: number;
}

interface ManagedAuthorizationRow {
  token_id: string;
  token_status: string;
  token_expires_at: Date | string;
  actor_id: string;
  alias: string;
  user_id: string;
  authorization_id: string;
  authorization_status: string;
  purpose: string;
  commercial_use: boolean;
  controller_name: string;
  processor_name: string;
  privacy_contact: string;
  privacy_policy_url: string;
  processing_scope: string;
  retention_rule: string;
  valid_from: Date | string;
  valid_until: Date | string;
  consented_at: Date | string | null;
  revoked_at: Date | string | null;
  cleanup_status: 'not-requested' | 'pending' | 'completed' | 'manual-review';
}

interface UploadSessionRow {
  id: string;
  user_id: string;
  actor_id: string;
  materialization_id: string;
  kind: RealPortraitAssetKind;
  status: string;
  object_key: string | null;
  mime_type: string | null;
  expires_at: Date | string;
  asset_id: string | null;
  provider_group_id: string | null;
  project_name: string;
  alias: string;
}

interface PortraitAssetProviderRow {
  id: string;
  actor_id?: string;
  materialization_id: string;
  provider_asset_id: string | null;
  provider_group_id?: string | null;
  project_name: string;
  status: string;
}

interface GenerationReferenceRow {
  actor_id: string;
  authorization_id: string;
  authorization_version: number | string;
  materialization_id: string;
  portrait_asset_id: string;
  provider_asset_id: string | null;
  project_name: string;
}

export interface RealPortraitServiceDependencies {
  provider?: RealPortraitProvider;
  now?: () => Date;
}

export async function listRealPortraitActors(userId: string) {
  await reconcileRealPortraitQuota(userId);
  const result = await pool.query<ActorRow>(actorSelectSql(
    `a.user_id = $1 AND a.deleted_at IS NULL`,
    'a.created_at DESC, a.id DESC',
  ), [userId]);
  return {
    items: result.rows.map(mapActorRow),
    capacity: await getRealPortraitCapacity(userId),
  };
}

export async function getRealPortraitActor(
  userId: string,
  actorId: string,
) {
  const actor = await findOwnedActor(pool, userId, actorId);
  if (!actor) throw notFound('真人档案不存在');
  return actor;
}

export async function createRealPortraitActor(userId: string, alias: string) {
  const normalizedAlias = normalizeAlias(alias);
  return withTransaction(async client => {
    const quota = await reconcileRealPortraitQuotaWithClient(client, userId);
    assertPortraitEnabled(quota);
    const usage = await assertRealPortraitQuotaExpansionAllowedWithClient(client, userId, quota);
    assertProfileQuota(usage.profiles, quota.profileLimit);
    const result = await client.query<{ id: string }>(
      `INSERT INTO real_portrait_actors (user_id, alias)
       VALUES ($1, $2)
       RETURNING id`,
      [userId, normalizedAlias],
    );
    await appendPortraitEvent(client, {
      userId,
      actorId: result.rows[0].id,
      eventType: 'actor.created',
      initiatorType: 'user',
      initiatorUserId: userId,
    });
    return requireOwnedActor(client, userId, result.rows[0].id);
  });
}

export async function deleteRealPortraitActor(userId: string, actorId: string) {
  return withTransaction(async client => {
    const locked = await client.query<{
      lifecycle_status: string;
      plan_access_status: string;
    }>(
      `SELECT a.lifecycle_status, a.plan_access_status
       FROM real_portrait_actors a
       WHERE a.id = $1 AND a.user_id = $2 AND a.deleted_at IS NULL
       FOR UPDATE OF a`,
      [actorId, userId],
    );
    const actor = locked.rows[0];
    if (!actor) throw notFound('真人档案不存在');
    const authorization = await client.query<{
      id: string;
      status: string;
      consented_at: Date | string | null;
    }>(
      `SELECT id, status, consented_at
       FROM real_portrait_authorizations
       WHERE actor_id = $1
       ORDER BY version DESC
       LIMIT 1
       FOR UPDATE`,
      [actorId],
    );
    const latestAuthorization = authorization.rows[0] ?? null;
    const authorizationStatus = latestAuthorization?.status ?? null;
    const planLocked = actor.plan_access_status === 'plan_locked';
    if (!planLocked && authorizationStatus === 'active') {
      throw conflict('请先撤回真人授权，再删除档案', 'REAL_PORTRAIT_REVOKE_REQUIRED');
    }
    if (!planLocked
      && !['draft', 'waiting', 'evicted', 'revoked', 'expired', 'sync_error'].includes(actor.lifecycle_status)) {
      throw conflict('请先撤回真人授权，再删除档案', 'REAL_PORTRAIT_REVOKE_REQUIRED');
    }
    if (planLocked && latestAuthorization && latestAuthorization.status !== 'revoked') {
      if (latestAuthorization.consented_at) {
        await client.query(
          `UPDATE real_portrait_authorizations
           SET status = 'revoked', revoked_at = now(), revoke_source = 'owner',
               revoke_reason_code = 'actor-deleted', updated_at = now()
           WHERE id = $1`,
          [latestAuthorization.id],
        );
        await client.query(
          `UPDATE real_portrait_subject_access_tokens
           SET status = 'revoked'
           WHERE authorization_id = $1 AND status = 'active'`,
          [latestAuthorization.id],
        );
      } else if (['draft', 'pending'].includes(latestAuthorization.status)) {
        await client.query(
          `UPDATE real_portrait_authorizations
           SET status = 'rejected', updated_at = now()
           WHERE id = $1`,
          [latestAuthorization.id],
        );
      }
    }
    // 删除档案是本地软删除，不应被后台查单或远端删除重试阻塞。仍在进行的操作继续
    // 关联脱敏墓碑；若稍后才发现 Group/Asset，worker 会按原幂等键补做远端清理。
    const { requestPortraitTaskCancellationWithClient } = await import('./realPortraitReconciliation.js');
    await requestPortraitTaskCancellationWithClient(client, userId, [actorId]);
    await ensureSoftDeletedActorRemoteCleanupWithClient(client, userId, actorId);
    await client.query(
      `UPDATE real_portrait_invites
       SET status = 'cancelled', accepted_at = NULL, updated_at = now()
       WHERE actor_id = $1 AND status IN ('pending', 'accepted')`,
      [actorId],
    );
    await client.query(
      `UPDATE real_portrait_activation_queue
       SET status = 'cancelled', updated_at = now()
       WHERE actor_id = $1 AND status IN ('waiting', 'promoted')`,
      [actorId],
    );
    await client.query(
      `UPDATE real_portrait_capacity_reservations
       SET status = 'released', updated_at = now()
       WHERE actor_id = $1 AND status = 'reserved'`,
      [actorId],
    );
    await client.query(
      `UPDATE real_portrait_actors
       SET deleted_at = now(),
           alias = '已删除演员',
           lifecycle_status = 'revoked',
           updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [actorId, userId],
    );
    await appendPortraitEvent(client, {
      userId,
      actorId,
      eventType: 'actor.deleted',
      initiatorType: 'user',
      initiatorUserId: userId,
    });
    return { deleted: true };
  });
}

async function ensureSoftDeletedActorRemoteCleanupWithClient(
  client: DbClient,
  userId: string,
  actorId: string,
) {
  await client.query(
    `UPDATE real_portrait_materializations
     SET status = 'deleting', eviction_eligible_at = COALESCE(eviction_eligible_at, now()),
         updated_at = now()
     WHERE actor_id = $1
       AND provider_group_id IS NOT NULL
       AND remote_deleted_at IS NULL
       AND status <> 'deleting'`,
    [actorId],
  );
  await client.query(
    `INSERT INTO real_portrait_remote_operations (
       user_id, actor_id, materialization_id, portrait_asset_id,
       operation_type, status, idempotency_key
     )
     SELECT $1, materialization.actor_id, materialization.id, NULL,
            'actor_delete_group', 'prepared', 'actor-delete-group:' || materialization.id::text
     FROM real_portrait_materializations materialization
     WHERE materialization.actor_id = $2
       AND materialization.provider_group_id IS NOT NULL
       AND materialization.remote_deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM real_portrait_remote_operations existing
         WHERE existing.materialization_id = materialization.id
           AND existing.operation_type LIKE '%delete%group%'
           AND existing.status <> 'completed'
       )
     ON CONFLICT (idempotency_key) DO UPDATE
     SET status = CASE
           WHEN real_portrait_remote_operations.status IN (
             'submitting', 'submitted', 'submission_unknown', 'manual_review'
           ) THEN real_portrait_remote_operations.status
           ELSE 'prepared'
         END,
         next_retry_at = CASE
           WHEN real_portrait_remote_operations.status IN (
             'submitting', 'submitted', 'submission_unknown', 'manual_review'
           ) THEN real_portrait_remote_operations.next_retry_at
           ELSE now()
         END,
         updated_at = now()`,
    [userId, actorId],
  );
  await client.query(
    `INSERT INTO real_portrait_remote_operations (
       user_id, actor_id, materialization_id, portrait_asset_id,
       operation_type, status, idempotency_key
     )
     SELECT $1, asset.actor_id, asset.materialization_id, asset.id,
            'actor_delete_asset', 'prepared', 'actor-delete-asset:' || asset.id::text
     FROM real_portrait_assets asset
     WHERE asset.actor_id = $2
       AND asset.provider_asset_id IS NOT NULL
       AND asset.remote_deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM real_portrait_materializations materialization
         WHERE materialization.id = asset.materialization_id
           AND materialization.provider_group_id IS NOT NULL
           AND materialization.remote_deleted_at IS NULL
       )
       AND NOT EXISTS (
         SELECT 1
         FROM real_portrait_remote_operations existing
         WHERE existing.portrait_asset_id = asset.id
           AND existing.operation_type LIKE '%delete%asset%'
           AND existing.status <> 'completed'
       )
     ON CONFLICT (idempotency_key) DO UPDATE
     SET status = CASE
           WHEN real_portrait_remote_operations.status IN (
             'submitting', 'submitted', 'submission_unknown', 'manual_review'
           ) THEN real_portrait_remote_operations.status
           ELSE 'prepared'
         END,
         next_retry_at = CASE
           WHEN real_portrait_remote_operations.status IN (
             'submitting', 'submitted', 'submission_unknown', 'manual_review'
           ) THEN real_portrait_remote_operations.next_retry_at
           ELSE now()
         END,
         updated_at = now()`,
    [userId, actorId],
  );
}

export async function getRealPortraitCapacity(userId: string): Promise<RealPortraitCapacityDto> {
  return withTransaction(async client => {
    const quota = await reconcileRealPortraitQuotaWithClient(client, userId);
    const counts = await readCapacityCounts(client, userId);
    const state = await client.query<QuotaStateRow>(
      `SELECT * FROM user_portrait_quota_states WHERE user_id = $1`,
      [userId],
    );
    return mapCapacityDto(quota, counts, state.rows[0] ?? null);
  });
}

export async function getAdminRealPortraitCapacity() {
  return withTransaction(async client => {
    const globalCounts = await readCapacityCounts(client, '00000000-0000-0000-0000-000000000000');
    const users = await client.query<{
      user_id: string;
      user_name: string;
      email: string;
      plan_code: string | null;
      portrait_enabled: boolean;
      profile_limit: number | string | null;
      active_limit: number | string;
      assets_per_actor: number | string;
      profiles: number | string;
      active: number | string;
      queued: number | string;
      total_count: number | string;
      grace_status: 'none' | 'active' | 'reconciling' | 'completed' | null;
      grace_until: Date | string | null;
    }>(
      `SELECT u.id AS user_id, u.user_name, u.email::text,
              count(*) OVER()::integer AS total_count,
              CASE WHEN u.plan_id IS NULL THEN free_plan.code ELSE assigned_plan.code END AS plan_code,
              CASE WHEN qs.user_id IS NOT NULL THEN qs.portrait_enabled
                   WHEN u.plan_id IS NULL THEN free_plan.portrait_enabled
                   ELSE assigned_plan.portrait_enabled END AS portrait_enabled,
              CASE WHEN qs.user_id IS NOT NULL THEN qs.profile_limit
                   WHEN u.plan_id IS NULL THEN free_plan.portrait_profile_limit
                   ELSE assigned_plan.portrait_profile_limit END AS profile_limit,
              CASE WHEN qs.user_id IS NOT NULL THEN qs.active_limit
                   WHEN u.plan_id IS NULL THEN free_plan.portrait_active_limit
                   ELSE assigned_plan.portrait_active_limit END AS active_limit,
              CASE WHEN qs.user_id IS NOT NULL THEN qs.assets_per_actor
                   WHEN u.plan_id IS NULL THEN free_plan.portrait_assets_per_actor
                   ELSE assigned_plan.portrait_assets_per_actor END AS assets_per_actor,
              COALESCE(usage.profiles, 0)::integer AS profiles,
              COALESCE(usage.active, 0)::integer AS active,
              COALESCE(queued.count, 0)::integer AS queued,
              qs.grace_status, qs.grace_until
       FROM users u
       LEFT JOIN plans assigned_plan ON assigned_plan.id = u.plan_id
       LEFT JOIN LATERAL (
         SELECT code, portrait_enabled, portrait_profile_limit,
                portrait_active_limit, portrait_assets_per_actor
         FROM plans WHERE code = 'free' AND kind = 'main'
         LIMIT 1
       ) free_plan ON true
       LEFT JOIN user_portrait_quota_states qs ON qs.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE deleted_at IS NULL)::integer AS profiles,
                count(*) FILTER (
                  WHERE deleted_at IS NULL
                    AND (
                      lifecycle_status IN (
                        'waiting', 'invited', 'verifying', 'awaiting_upload', 'processing', 'active', 'eviction_warning'
                      )
                      OR EXISTS (
                        SELECT 1 FROM real_portrait_materializations materialization
                        WHERE materialization.actor_id = real_portrait_actors.id
                          AND materialization.provider_group_id IS NOT NULL
                          AND materialization.remote_deleted_at IS NULL
                      )
                      OR EXISTS (
                        SELECT 1 FROM real_portrait_capacity_reservations reservation
                        WHERE reservation.actor_id = real_portrait_actors.id
                          AND reservation.status = 'reserved' AND reservation.expires_at > now()
                      )
                      OR EXISTS (
                        SELECT 1 FROM real_portrait_activation_queue queue
                        WHERE queue.actor_id = real_portrait_actors.id
                          AND queue.status IN ('waiting', 'promoted')
                      )
                    )
                )::integer AS active
         FROM real_portrait_actors WHERE user_id = u.id
       ) usage ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::integer AS count
         FROM real_portrait_activation_queue
         WHERE user_id = u.id AND status = 'waiting'
       ) queued ON true
       WHERE qs.user_id IS NOT NULL OR COALESCE(usage.profiles, 0) > 0 OR COALESCE(queued.count, 0) > 0
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT 1000`,
    );
    const queue = await client.query<{
      id: string;
      user_id: string;
      user_name: string;
      actor_alias: string;
      status: 'waiting' | 'promoted' | 'completed' | 'cancelled';
      requested_at: Date | string;
      position: number | string;
      total_count: number | string;
      waiting_count: number | string;
    }>(
      `WITH ranked AS (
         SELECT q.*,
                row_number() OVER (
                  PARTITION BY q.user_id, q.status
                  ORDER BY q.requested_at, q.id
                )::integer AS user_position,
                max(q.promoted_at) FILTER (WHERE q.promoted_at IS NOT NULL)
                  OVER (PARTITION BY q.user_id) AS user_last_promoted_at
         FROM real_portrait_activation_queue q
       )
       SELECT q.id, q.user_id, u.user_name, a.alias AS actor_alias,
              count(*) OVER()::integer AS total_count,
              count(*) FILTER (WHERE q.status = 'waiting') OVER()::integer AS waiting_count,
              q.status, q.requested_at, q.user_position AS position
       FROM ranked q
       JOIN users u ON u.id = q.user_id
       JOIN real_portrait_actors a ON a.id = q.actor_id
       ORDER BY CASE q.status WHEN 'waiting' THEN 0 WHEN 'promoted' THEN 1 ELSE 2 END,
                q.user_position,
                q.user_last_promoted_at ASC NULLS FIRST,
                q.requested_at, q.id
       LIMIT 500`,
    );
    const failures = await client.query<{
      id: string;
      user_id: string;
      user_name: string;
      actor_alias: string;
      operation_type: string;
      attempt_count: number | string;
      last_error_code: string | null;
      updated_at: Date | string | null;
      next_retry_at: Date | string | null;
      total_count: number | string;
    }>(
      `SELECT op.id, op.user_id, u.user_name, a.alias AS actor_alias,
              count(*) OVER()::integer AS total_count,
              op.operation_type, op.attempt_count, op.last_error_code,
              op.updated_at, op.next_retry_at
       FROM real_portrait_remote_operations op
       JOIN users u ON u.id = op.user_id
       JOIN real_portrait_actors a ON a.id = op.actor_id
       WHERE op.operation_type LIKE '%delete%'
         AND op.status IN ('failed', 'submission_unknown', 'manual_review')
       ORDER BY op.updated_at DESC, op.id DESC
       LIMIT 500`,
    );
    const usersTotal = toInt(users.rows[0]?.total_count);
    const queueTotal = toInt(queue.rows[0]?.total_count);
    const queueWaiting = toInt(queue.rows[0]?.waiting_count);
    const failuresTotal = toInt(failures.rows[0]?.total_count);
    return {
      global: {
        groupSoftLimit: env.REAL_PORTRAIT_GROUP_SOFT_LIMIT,
        assetSoftLimit: env.REAL_PORTRAIT_ASSET_SOFT_LIMIT,
        groupsUsed: toInt(globalCounts.groups_used),
        assetsUsed: toInt(globalCounts.assets_used),
        groupsReserved: toInt(globalCounts.groups_reserved),
        assetsReserved: toInt(globalCounts.assets_reserved),
      },
      listInfo: {
        users: {
          total: usersTotal,
          returned: users.rows.length,
          truncated: usersTotal > users.rows.length,
        },
        queue: {
          total: queueTotal,
          waiting: queueWaiting,
          returned: queue.rows.length,
          truncated: queueTotal > queue.rows.length,
        },
        remoteDeleteFailures: {
          total: failuresTotal,
          returned: failures.rows.length,
          truncated: failuresTotal > failures.rows.length,
        },
      },
      users: users.rows.map(row => ({
        userId: row.user_id,
        userName: row.user_name,
        email: row.email,
        planCode: row.plan_code,
        entitlements: {
          enabled: Boolean(row.portrait_enabled),
          profileLimit: row.profile_limit === null ? null : toInt(row.profile_limit),
          activeLimit: toInt(row.active_limit),
          assetsPerActor: toInt(row.assets_per_actor),
        },
        usage: {
          profiles: toInt(row.profiles),
          active: toInt(row.active),
          queued: toInt(row.queued),
        },
        quotaState: row.grace_status ? {
          graceStatus: row.grace_status,
          graceUntil: toIsoDateTime(row.grace_until),
        } : null,
      })),
      queue: queue.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        userName: row.user_name,
        actorAlias: row.actor_alias,
        status: row.status,
        requestedAt: toIsoDateTime(row.requested_at)!,
        position: toInt(row.position),
      })),
      remoteDeleteFailures: failures.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        userName: row.user_name,
        actorAlias: row.actor_alias,
        resourceKind: row.operation_type.includes('group') ? 'group' as const : 'asset' as const,
        attempts: toInt(row.attempt_count),
        errorCode: row.last_error_code,
        lastAttemptAt: toIsoDateTime(row.updated_at),
        nextRetryAt: toIsoDateTime(row.next_retry_at),
      })),
    };
  });
}

export async function requestRealPortraitActivation(
  userId: string,
  actorId: string,
  input: {
    purpose: string;
    commercialUse: boolean;
    portraitNoticeVersion: string;
    sensitiveInfoNoticeVersion: string;
  },
  dependencies: RealPortraitServiceDependencies = {},
): Promise<ActivationResult> {
  const legalDisclosure = requireRealPortraitLegalDisclosure();
  assertProviderConfigured(dependencies.provider ?? getConfiguredRealPortraitProvider());
  const now = dependencies.now?.() ?? new Date();
  const validUntil = addDays(now, AUTHORIZATION_VALID_DAYS);
  const purpose = requireText(input.purpose, '授权用途', 500);
  const portraitNoticeVersion = requireText(input.portraitNoticeVersion, '肖像授权告知版本', 80);
  const sensitiveInfoNoticeVersion = requireText(
    input.sensitiveInfoNoticeVersion,
    '敏感个人信息告知版本',
    80,
  );
  const inviteToken = createRealPortraitBearerToken();
  const tokenHash = fingerprintRealPortraitSecret(inviteToken);
  const expiresAt = new Date(now.getTime() + env.REAL_PORTRAIT_INVITE_TTL_SECONDS * 1_000);

  const result = await withTransaction(async client => {
    await acquireCapacityLock(client);
    await client.query(
      `UPDATE real_portrait_capacity_reservations
       SET status = 'expired', updated_at = now()
       WHERE status = 'reserved' AND expires_at <= now()`,
    );
    const quota = await reconcileRealPortraitQuotaWithClient(client, userId, now);
    assertPortraitEnabled(quota);
    await assertRealPortraitQuotaExpansionAllowedWithClient(client, userId, quota);
    const locked = await client.query<{ lifecycle_status: string; plan_access_status: string }>(
      `SELECT lifecycle_status, plan_access_status
       FROM real_portrait_actors
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [actorId, userId],
    );
    const actor = locked.rows[0];
    if (!actor) throw notFound('真人档案不存在');
    if (actor.plan_access_status === 'plan_locked') {
      throw conflict('该真人档案已因套餐额度锁定', 'REAL_PORTRAIT_PLAN_LOCKED');
    }
    if (!['draft', 'waiting', 'evicted', 'expired'].includes(actor.lifecycle_status)) {
      throw conflict('该真人档案当前不能重复发起激活', 'REAL_PORTRAIT_ACTIVATION_CONFLICT');
    }
    const promotedReservation = await client.query<{ reservation_id: string }>(
      `SELECT q.reservation_id
       FROM real_portrait_activation_queue q
       JOIN real_portrait_capacity_reservations r
         ON r.id = q.reservation_id AND r.user_id = q.user_id AND r.actor_id = q.actor_id
       WHERE q.actor_id = $1 AND q.user_id = $2 AND q.status = 'promoted'
         AND r.status = 'reserved' AND r.expires_at > now()
       LIMIT 1
       FOR UPDATE OF q, r`,
      [actorId, userId],
    );
    const counts = await readCapacityCounts(client, userId);
    const currentUserActiveActors = Math.max(
      0,
      toInt(counts.active) - (
        promotedReservation.rows[0] || actor.lifecycle_status === 'waiting' ? 1 : 0
      ),
    );
    const decision = promotedReservation.rows[0]
      ? currentUserActiveActors >= quota.activeLimit
        ? {
          outcome: 'over-user-quota' as const,
          groupSlots: 0,
          assetSlots: 0,
          reason: '当前套餐活跃真人额度已用完',
        }
        : {
        outcome: 'reserve' as const,
        groupSlots: 1,
        assetSlots: 1,
        reason: null,
      }
      : decideRealPortraitCapacity({
        quota,
        currentUserActiveActors,
        // 激活只为必选主图预留一个 Asset；第二张图是可释放的弹性权益，上传时再独立抢占容量。
        desiredAssetCount: 1,
        snapshot: capacitySnapshot(counts),
      });
    if (decision.outcome === 'over-user-quota') {
      throw conflict(decision.reason ?? '当前套餐活跃真人额度已用完', 'REAL_PORTRAIT_ACTIVE_QUOTA_EXCEEDED');
    }
    if (decision.outcome === 'wait-capacity') {
      await client.query(
        `INSERT INTO real_portrait_activation_queue (user_id, actor_id)
         VALUES ($1, $2)
         ON CONFLICT (actor_id) WHERE status IN ('waiting', 'promoted')
         DO UPDATE SET requested_at = real_portrait_activation_queue.requested_at,
                       updated_at = now()`,
        [userId, actorId],
      );
      await client.query(
        `UPDATE real_portrait_actors
         SET lifecycle_status = 'waiting', updated_at = now()
         WHERE id = $1`,
        [actorId],
      );
      const position = await readQueuePosition(client, actorId);
      await appendPortraitEvent(client, {
        userId,
        actorId,
        eventType: 'activation.queued',
        initiatorType: 'user',
        initiatorUserId: userId,
        metadata: { queuePosition: position },
      });
      return { queuePosition: position, invitationUrl: null, invitationExpiresAt: null };
    }

    const versionResult = await client.query<{ version: number | string }>(
      `SELECT COALESCE(max(version), 0) + 1 AS version
       FROM real_portrait_authorizations
       WHERE actor_id = $1`,
      [actorId],
    );
    const version = toInt(versionResult.rows[0]?.version);
    const authorization = await client.query<{ id: string }>(
      `INSERT INTO real_portrait_authorizations (
         actor_id, version, status, purpose, commercial_use, valid_from, valid_until,
         portrait_notice_version, sensitive_info_notice_version,
         controller_name, processor_name, privacy_contact, privacy_policy_url,
         processing_scope, retention_rule, thumbnail_storage_allowed
       ) VALUES (
         $1, $2, 'draft', $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14, true
       )
       RETURNING id`,
      [
        actorId,
        version,
        purpose,
        input.commercialUse,
        now,
        validUntil,
        portraitNoticeVersion,
        sensitiveInfoNoticeVersion,
        legalDisclosure.controllerName,
        legalDisclosure.processorName,
        legalDisclosure.privacyContact,
        legalDisclosure.privacyPolicyUrl,
        legalDisclosure.processingScope,
        legalDisclosure.retentionRule,
      ],
    );
    const materialization = await client.query<{ id: string }>(
      `INSERT INTO real_portrait_materializations (
         actor_id, authorization_id, generation, provider_account_key,
         region, project_name, status
       ) VALUES (
         $1, $2,
         COALESCE((SELECT max(generation) + 1 FROM real_portrait_materializations WHERE actor_id = $1), 1),
         $3, $4, $5, 'reserved'
       ) RETURNING id`,
      [actorId, authorization.rows[0].id, providerAccountKey(), env.VOLC_ARK_ASSET_REGION, env.VOLC_ARK_ASSET_PROJECT_NAME],
    );
    const reservationId = promotedReservation.rows[0]?.reservation_id ?? (await client.query<{ id: string }>(
      `INSERT INTO real_portrait_capacity_reservations (
         user_id, actor_id, group_slots, asset_slots, expires_at
       ) VALUES ($1, $2, 1, $3, $4)
       RETURNING id`,
      [userId, actorId, 1, addHours(now, CAPACITY_RESERVATION_HOURS)],
    )).rows[0].id;
    const invite = await client.query<{ id: string }>(
      `INSERT INTO real_portrait_invites (
         actor_id, authorization_id, token_hash, expires_at
       ) VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [actorId, authorization.rows[0].id, tokenHash, expiresAt],
    );
    await client.query(
      `UPDATE real_portrait_activation_queue
       SET status = 'promoted', reservation_id = $2,
           promoted_at = COALESCE(promoted_at, now()), updated_at = now()
       WHERE actor_id = $1 AND status IN ('waiting', 'promoted')`,
      [actorId, reservationId],
    );
    await client.query(
      `UPDATE real_portrait_actors
       SET lifecycle_status = 'invited', updated_at = now()
       WHERE id = $1`,
      [actorId],
    );
    await appendPortraitEvent(client, {
      userId,
      actorId,
      authorizationId: authorization.rows[0].id,
      materializationId: materialization.rows[0].id,
      eventType: 'activation.invited',
      initiatorType: 'user',
      initiatorUserId: userId,
      metadata: { inviteId: invite.rows[0].id },
    });
    return {
      queuePosition: null,
      invitationUrl: buildInvitationUrl(inviteToken),
      invitationExpiresAt: expiresAt.toISOString(),
    };
  });

  return {
    actor: await getRealPortraitActor(userId, actorId),
    ...result,
  };
}

export async function getPublicRealPortraitInvite(token: string) {
  const invite = await findInviteByToken(token);
  return mapPublicInvite(invite);
}

export async function acceptPublicRealPortraitInvite(
  token: string,
  decision: PublicRealPortraitConsentDecision,
) {
  if (!decision.accepted) {
    await withTransaction(async client => {
      const current = await lockInviteByToken(client, token);
      assertInviteUsable(current, new Date());
      await client.query(
        `UPDATE real_portrait_invites
         SET status = 'cancelled', accepted_at = NULL, updated_at = now()
         WHERE id = $1`,
        [current.invite_id],
      );
      await client.query(
        `UPDATE real_portrait_authorizations
         SET status = 'rejected', updated_at = now()
         WHERE id = $1 AND status = 'draft'`,
        [current.authorization_id],
      );
      await client.query(
        `UPDATE real_portrait_materializations
         SET status = 'error', updated_at = now()
         WHERE id = $1 AND status = 'reserved'`,
        [current.materialization_id],
      );
      await client.query(
        `UPDATE real_portrait_capacity_reservations
         SET status = 'released', updated_at = now()
         WHERE actor_id = $1 AND status = 'reserved'`,
        [current.actor_id],
      );
      await client.query(
        `UPDATE real_portrait_actors
         SET lifecycle_status = 'revoked', updated_at = now()
         WHERE id = $1`,
        [current.actor_id],
      );
      await appendPortraitEvent(client, {
        userId: current.user_id,
        actorId: current.actor_id,
        authorizationId: current.authorization_id,
        materializationId: current.materialization_id,
        eventType: 'authorization.declined',
        initiatorType: 'subject',
      });
    });
    return { status: 'declined' as const, manageUrl: null };
  }
  const manageToken = createRealPortraitBearerToken();
  const manageTokenHash = fingerprintRealPortraitSecret(manageToken);
  const now = new Date();
  const validUntil = addDays(now, AUTHORIZATION_VALID_DAYS);
  await withTransaction(async client => {
    const current = await lockInviteByToken(client, token);
    assertInviteUsable(current, now);
    await client.query(
      `UPDATE real_portrait_invites
       SET status = 'accepted', accepted_at = COALESCE(accepted_at, $2), updated_at = now()
       WHERE id = $1`,
      [current.invite_id, now],
    );
    await client.query(
      `UPDATE real_portrait_authorizations
       SET status = 'pending', valid_from = $2, valid_until = $3,
           consented_at = COALESCE(consented_at, $2), updated_at = now()
       WHERE id = $1 AND status IN ('draft', 'pending')`,
      [current.authorization_id, now, validUntil],
    );
    await client.query(
      `INSERT INTO real_portrait_subject_access_tokens (
         authorization_id, token_hash, expires_at
       ) VALUES ($1, $2, $3)`,
      [current.authorization_id, manageTokenHash, validUntil],
    );
    await appendPortraitEvent(client, {
      userId: current.user_id,
      actorId: current.actor_id,
      authorizationId: current.authorization_id,
      eventType: 'authorization.consented',
      initiatorType: 'subject',
      metadata: {
        adultConfirmed: decision.adultConfirmed,
        portraitConsent: decision.portraitConsent,
        sensitiveFaceConsent: decision.sensitiveFaceConsent,
        commercialUseConsent: decision.commercialUseConsent,
        authorizationDays: AUTHORIZATION_VALID_DAYS,
        commercialUse: current.commercial_use,
        portraitNoticeVersion: current.portrait_notice_version,
        sensitiveInfoNoticeVersion: current.sensitive_info_notice_version,
      },
    });
    return current;
  });
  return {
    status: 'accepted' as const,
    manageUrl: buildManageUrl(manageToken),
  };
}

export async function startPublicRealPortraitVerification(
  token: string,
  dependencies: RealPortraitServiceDependencies = {},
) {
  const provider = dependencies.provider ?? getConfiguredRealPortraitProvider();
  assertProviderConfigured(provider);
  const callbackNonce = createRealPortraitBearerToken();
  const callbackNonceHash = fingerprintRealPortraitSecret(callbackNonce);
  const now = dependencies.now?.() ?? new Date();
  const prepared = await withTransaction(async client => {
    const owner = await client.query<{ user_id: string }>(
      `SELECT actor.user_id
       FROM real_portrait_invites invite
       JOIN real_portrait_actors actor ON actor.id = invite.actor_id
       WHERE invite.token_hash = $1
       LIMIT 1`,
      [fingerprintRealPortraitSecret(token)],
    );
    if (!owner.rows[0]) throw notFound('邀请不存在或已失效');
    const quota = await reconcileRealPortraitQuotaWithClient(client, owner.rows[0].user_id, now);
    const invite = await lockInviteByToken(client, token);
    await assertRealPortraitActorPlanUsableWithClient(
      client,
      invite.user_id,
      invite.plan_access_status,
      quota,
    );
    assertInviteUsable(invite, now, true);
    if (invite.authorization_status !== 'pending' || !invite.consented_at) {
      throw conflict('必须先完成授权同意', 'REAL_PORTRAIT_CONSENT_REQUIRED');
    }
    const existing = await client.query<{
      id: string;
      status: string;
      h5_link_ciphertext: string | null;
      h5_expires_at: Date | string | null;
    }>(
      `SELECT id, status, h5_link_ciphertext, h5_expires_at
       FROM real_portrait_verification_sessions
       WHERE invite_id = $1
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [invite.invite_id],
    );
    const existingSession = existing.rows[0];
    const existingExpiry = existingSession?.h5_expires_at
      ? new Date(existingSession.h5_expires_at)
      : null;
    if (existingSession
        && ['invitation_ready', 'waiting', 'submission_unknown'].includes(existingSession.status)
        && existingSession.h5_link_ciphertext
        && existingExpiry
        && existingExpiry.getTime() > now.getTime()
        && invite.lifecycle_status === 'verifying'
        && invite.materialization_status === 'verifying') {
      const promoted = await client.query(
        `UPDATE real_portrait_verification_sessions
         SET status = 'invitation_ready', failure_code = NULL, updated_at = now()
         WHERE id = $1
           AND status IN ('invitation_ready', 'waiting', 'submission_unknown')
           AND h5_link_ciphertext IS NOT NULL AND h5_expires_at > $2`,
        [existingSession.id, now],
      );
      if (!promoted.rowCount) {
        throw conflict('实名认证恢复状态已改变', 'REAL_PORTRAIT_VERIFICATION_NO_LONGER_USABLE');
      }
      await client.query(
        `UPDATE real_portrait_remote_operations
         SET status = 'completed', next_retry_at = NULL, last_error_code = NULL, updated_at = now()
         WHERE verification_session_id = $1
           AND operation_type = 'create_visual_validation_session'
           AND status IN ('submitting', 'submission_unknown')`,
        [existingSession.id],
      );
      await upsertVerificationLookupOperationWithClient(client, {
        userId: invite.user_id,
        actorId: invite.actor_id,
        materializationId: invite.materialization_id,
        sessionId: existingSession.id,
        nextRetryAt: new Date(now.getTime() + 60_000),
      });
      return {
        kind: 'ready' as const,
        verificationUrl: decryptRealPortraitSecret(
          parseEncryptedSecret(existingSession.h5_link_ciphertext),
        ),
        expiresAt: existingExpiry.toISOString(),
      };
    }
    if (existingSession && !['failed', 'expired'].includes(existingSession.status)) {
      throw conflict('实名认证会话已创建，请查看当前状态', 'REAL_PORTRAIT_VERIFICATION_EXISTS');
    }
    if (invite.lifecycle_status !== 'invited' || invite.materialization_status !== 'reserved') {
      throw conflict('该真人档案已不允许开始实名认证', 'REAL_PORTRAIT_VERIFICATION_NO_LONGER_USABLE');
    }
    const session = await client.query<{ id: string }>(
      `INSERT INTO real_portrait_verification_sessions (
         actor_id, authorization_id, invite_id, callback_nonce_hash, status
       ) VALUES ($1, $2, $3, $4, 'submitting')
       RETURNING id`,
      [invite.actor_id, invite.authorization_id, invite.invite_id, callbackNonceHash],
    );
    const operation = await client.query<{ id: string }>(
      `INSERT INTO real_portrait_remote_operations (
         user_id, actor_id, materialization_id, verification_session_id,
         operation_type, status, idempotency_key, attempt_count
       ) VALUES ($1, $2, $3, $4, 'create_visual_validation_session', 'submitting', $5, 1)
       RETURNING id`,
      [
        invite.user_id,
        invite.actor_id,
        invite.materialization_id,
        session.rows[0].id,
        `visual-validation:${session.rows[0].id}`,
      ],
    );
    const actorUpdated = await client.query(
      `UPDATE real_portrait_actors
       SET lifecycle_status = 'verifying', updated_at = now()
       WHERE id = $1 AND lifecycle_status = 'invited'`,
      [invite.actor_id],
    );
    const materializationUpdated = await client.query(
      `UPDATE real_portrait_materializations
       SET status = 'verifying', updated_at = now()
       WHERE id = $1 AND status = 'reserved'`,
      [invite.materialization_id],
    );
    if (!actorUpdated.rowCount || !materializationUpdated.rowCount) {
      throw conflict('该真人档案已不允许开始实名认证', 'REAL_PORTRAIT_VERIFICATION_NO_LONGER_USABLE');
    }
    return {
      kind: 'prepared' as const,
      invite,
      sessionId: session.rows[0].id,
      operationId: operation.rows[0].id,
    };
  });

  if (prepared.kind === 'ready') {
    return {
      status: 'verification-ready' as const,
      verificationUrl: prepared.verificationUrl,
      expiresAt: prepared.expiresAt,
      queuePosition: null,
    };
  }

  await withTransaction(async client => {
    const quota = await reconcileRealPortraitQuotaWithClient(client, prepared.invite.user_id, now);
    const state = await lockVisualValidationSubmissionState(
      client,
      prepared.sessionId,
      prepared.invite.materialization_id,
      prepared.operationId,
    );
    if (!visualValidationSubmissionIsDeliverable(state)) {
      throw conflict('实名认证会话已失效，未向供应商提交', 'REAL_PORTRAIT_VERIFICATION_NO_LONGER_USABLE');
    }
    await assertRealPortraitActorPlanUsableWithClient(
      client,
      prepared.invite.user_id,
      state.plan_access_status,
      quota,
    );
    const claimed = await client.query(
      `UPDATE real_portrait_remote_operations
       SET updated_at = now()
       WHERE id = $1 AND status = 'submitting'`,
      [prepared.operationId],
    );
    if (!claimed.rowCount) {
      throw conflict('实名认证提交状态已改变', 'REAL_PORTRAIT_VERIFICATION_NO_LONGER_USABLE');
    }
  });

  let result: Awaited<ReturnType<RealPortraitProvider['createVisualValidationSession']>>;
  try {
    result = await provider.createVisualValidationSession({
      callbackUrl: buildProviderCallbackUrl(callbackNonce),
      projectName: env.VOLC_ARK_ASSET_PROJECT_NAME,
    });
  } catch (error) {
    const submissionUnknown = isSubmissionUnknown(error);
    const operationStatus = submissionUnknown ? 'submission_unknown' : 'failed';
    await withTransaction(async client => {
      await client.query(
        `UPDATE real_portrait_verification_sessions
         SET status = $2, failure_code = $3, updated_at = now()
         WHERE id = $1 AND status = 'submitting'`,
        [prepared.sessionId, operationStatus, safeErrorCode(error)],
      );
      await client.query(
        `UPDATE real_portrait_remote_operations
         SET status = $2, last_error_code = $3, next_retry_at = now() + interval '1 minute', updated_at = now()
         WHERE id = $1 AND status = 'submitting'`,
        [prepared.operationId, operationStatus, safeErrorCode(error)],
      );
      if (!submissionUnknown) {
        await client.query(
          `UPDATE real_portrait_actors
           SET lifecycle_status = 'invited', updated_at = now()
           WHERE id = $1 AND lifecycle_status = 'verifying'`,
          [prepared.invite.actor_id],
        );
        await client.query(
          `UPDATE real_portrait_materializations
           SET status = 'reserved', updated_at = now()
           WHERE id = $1 AND status = 'verifying' AND provider_group_id IS NULL`,
          [prepared.invite.materialization_id],
        );
      }
    });
    throw error;
  }

  const h5ExpiresAt = new Date(
    (dependencies.now?.() ?? new Date()).getTime() + env.REAL_PORTRAIT_INVITE_TTL_SECONDS * 1_000,
  );
  const bytedTokenCiphertext = JSON.stringify(encryptRealPortraitSecret(result.bytedToken));
  const bytedTokenFingerprint = fingerprintRealPortraitSecret(result.bytedToken);
  const h5LinkCiphertext = JSON.stringify(encryptRealPortraitSecret(result.h5Link));
  let deliverable: boolean;
  try {
    deliverable = await withTransaction(async client => {
      const quota = await reconcileRealPortraitQuotaWithClient(client, prepared.invite.user_id, now);
    const state = await lockVisualValidationSubmissionState(
      client,
      prepared.sessionId,
      prepared.invite.materialization_id,
      prepared.operationId,
    );
    let accessUsable = visualValidationSubmissionCanBeFinalized(
      state,
      bytedTokenFingerprint,
    );
    if (accessUsable) {
      try {
        await assertRealPortraitActorPlanUsableWithClient(
          client,
          prepared.invite.user_id,
          state.plan_access_status,
          quota,
        );
      } catch {
        accessUsable = false;
      }
    }
    if (accessUsable) {
      const sessionUpdated = await client.query(
        `UPDATE real_portrait_verification_sessions
         SET byted_token_ciphertext = $2,
             byted_token_fingerprint = $3,
             h5_link_ciphertext = $5,
             status = 'invitation_ready',
             h5_expires_at = $4,
             failure_code = NULL,
             updated_at = now()
         WHERE id = $1 AND status IN ('submitting', 'submission_unknown')
           AND (byted_token_fingerprint IS NULL OR byted_token_fingerprint = $3)`,
        [
          prepared.sessionId,
          bytedTokenCiphertext,
          bytedTokenFingerprint,
          h5ExpiresAt,
          h5LinkCiphertext,
        ],
      );
      const operationUpdated = await client.query(
        `UPDATE real_portrait_remote_operations
         SET status = 'completed', next_retry_at = NULL,
             last_error_code = NULL, updated_at = now()
         WHERE id = $1 AND status IN ('submitting', 'submission_unknown', 'completed')`,
        [prepared.operationId],
      );
      if (!sessionUpdated.rowCount || !operationUpdated.rowCount) {
        throw Object.assign(new Error('实名认证提交结果无法按预期状态落库'), {
          code: 'REAL_PORTRAIT_VISUAL_SESSION_CAS_FAILED',
        });
      }
      await appendPortraitEvent(client, {
        userId: prepared.invite.user_id,
        actorId: prepared.invite.actor_id,
        authorizationId: prepared.invite.authorization_id,
        materializationId: prepared.invite.materialization_id,
        eventType: 'verification.session_ready',
        initiatorType: 'subject',
      });
      await upsertVerificationLookupOperationWithClient(client, {
        userId: prepared.invite.user_id,
        actorId: prepared.invite.actor_id,
        materializationId: prepared.invite.materialization_id,
        sessionId: prepared.sessionId,
        nextRetryAt: new Date(now.getTime() + 60_000),
      });
      return true;
    }

    const tokenPersisted = await client.query(
      `UPDATE real_portrait_verification_sessions
       SET byted_token_ciphertext = COALESCE(byted_token_ciphertext, $2),
           byted_token_fingerprint = COALESCE(byted_token_fingerprint, $3),
           h5_link_ciphertext = COALESCE(h5_link_ciphertext, $5),
           status = CASE
             WHEN status IN ('verified', 'expired') THEN status
             ELSE 'failed'
           END,
           h5_expires_at = COALESCE(h5_expires_at, $4),
           failure_code = CASE
             WHEN status = 'verified' THEN NULL
             ELSE 'ACCESS_CHANGED_AFTER_SUBMISSION'
           END,
           updated_at = now()
       WHERE id = $1
         AND (byted_token_fingerprint IS NULL OR byted_token_fingerprint = $3)`,
      [
        prepared.sessionId,
        bytedTokenCiphertext,
        bytedTokenFingerprint,
        h5ExpiresAt,
        h5LinkCiphertext,
      ],
    );
    if (!tokenPersisted.rowCount) {
      throw Object.assign(new Error('实名认证远端凭证与已保存凭证冲突'), {
        code: 'REAL_PORTRAIT_VISUAL_SESSION_TOKEN_CONFLICT',
      });
    }
    await client.query(
      `UPDATE real_portrait_remote_operations
       SET status = 'completed', next_retry_at = NULL,
           last_error_code = 'ACCESS_CHANGED_AFTER_SUBMISSION', updated_at = now()
       WHERE id = $1`,
      [prepared.operationId],
    );
    await appendPortraitEvent(client, {
      userId: prepared.invite.user_id,
      actorId: prepared.invite.actor_id,
      authorizationId: prepared.invite.authorization_id,
      materializationId: prepared.invite.materialization_id,
      eventType: 'verification.session_discarded_before_delivery',
      initiatorType: 'system',
      metadata: { requestId: result.requestId },
    });
      return false;
    });
  } catch (error) {
    try {
      await persistVisualValidationSubmissionForRecovery({
        userId: prepared.invite.user_id,
        actorId: prepared.invite.actor_id,
        materializationId: prepared.invite.materialization_id,
        sessionId: prepared.sessionId,
        operationId: prepared.operationId,
        bytedTokenCiphertext,
        bytedTokenFingerprint,
        h5LinkCiphertext,
        h5ExpiresAt,
        failureCode: safeErrorCode(error),
      });
    } catch (recoveryError) {
      throw Object.assign(new Error('实名认证远端会话已创建，但恢复凭证落库失败'), {
        code: 'REAL_PORTRAIT_VISUAL_SESSION_RECOVERY_PERSIST_FAILED',
        cause: recoveryError,
      });
    }
    throw error;
  }
  if (!deliverable) {
    throw conflict('实名认证资格已变化，远端会话已隔离且不会交付', 'REAL_PORTRAIT_VERIFICATION_NO_LONGER_USABLE');
  }
  return {
    status: 'verification-ready' as const,
    verificationUrl: result.h5Link,
    expiresAt: h5ExpiresAt.toISOString(),
    queuePosition: null,
  };
}

interface LockedVisualValidationSubmissionState {
  session_status: string;
  byted_token_fingerprint: string | null;
  authorization_status: string;
  authorization_valid_now: boolean;
  materialization_status: string;
  lifecycle_status: string;
  plan_access_status: string;
  operation_status: string;
}

async function lockVisualValidationSubmissionState(
  client: DbClient,
  sessionId: string,
  materializationId: string,
  operationId: string,
) {
  const state = await client.query<LockedVisualValidationSubmissionState>(
    `SELECT verification_session.status AS session_status,
            verification_session.byted_token_fingerprint,
            portrait_authorization.status AS authorization_status,
            (portrait_authorization.valid_from <= now()
             AND portrait_authorization.valid_until > now()) AS authorization_valid_now,
            materialization.status AS materialization_status,
            actor.lifecycle_status, actor.plan_access_status,
            operation.status AS operation_status
     FROM real_portrait_verification_sessions verification_session
     JOIN real_portrait_authorizations portrait_authorization
       ON portrait_authorization.id = verification_session.authorization_id
     JOIN real_portrait_actors actor ON actor.id = verification_session.actor_id
     JOIN real_portrait_materializations materialization
       ON materialization.id = $2
      AND materialization.actor_id = verification_session.actor_id
      AND materialization.authorization_id = verification_session.authorization_id
     JOIN real_portrait_remote_operations operation
       ON operation.id = $3
      AND operation.verification_session_id = verification_session.id
      AND operation.operation_type = 'create_visual_validation_session'
     WHERE verification_session.id = $1
     FOR UPDATE OF verification_session, portrait_authorization, actor, materialization, operation`,
    [sessionId, materializationId, operationId],
  );
  return state.rows[0] ?? null;
}

function visualValidationSubmissionIsDeliverable(
  state: LockedVisualValidationSubmissionState | null,
): state is LockedVisualValidationSubmissionState {
  if (!state) return false;
  return state.session_status === 'submitting'
    && state.operation_status === 'submitting'
    && state.authorization_status === 'pending'
    && state.authorization_valid_now
    && state.lifecycle_status === 'verifying'
    && state.materialization_status === 'verifying';
}

function visualValidationSubmissionCanBeFinalized(
  state: LockedVisualValidationSubmissionState | null,
  bytedTokenFingerprint: string,
): state is LockedVisualValidationSubmissionState {
  if (!state) return false;
  const submissionStateUsable = (
    state.session_status === 'submitting'
    && state.operation_status === 'submitting'
  ) || (
    state.session_status === 'submission_unknown'
    && state.byted_token_fingerprint === bytedTokenFingerprint
    && ['submitting', 'submission_unknown', 'completed'].includes(state.operation_status)
  );
  return submissionStateUsable
    && state.authorization_status === 'pending'
    && state.authorization_valid_now
    && state.lifecycle_status === 'verifying'
    && state.materialization_status === 'verifying';
}

interface VerificationLookupOperationInput {
  userId: string;
  actorId: string;
  materializationId: string;
  sessionId: string;
  nextRetryAt: Date;
}

async function upsertVerificationLookupOperationWithClient(
  client: DbClient,
  input: VerificationLookupOperationInput,
) {
  await client.query(
    `INSERT INTO real_portrait_remote_operations (
       user_id, actor_id, materialization_id, verification_session_id,
       operation_type, status, idempotency_key, attempt_count, next_retry_at
     ) VALUES ($1, $2, $3, $4, 'get_visual_validation_result', 'prepared', $5, 0, $6)
     ON CONFLICT (idempotency_key) DO UPDATE
     SET status = CASE
           WHEN real_portrait_remote_operations.status = 'submitting' THEN 'submitting'
           ELSE 'prepared'
         END,
         next_retry_at = CASE
           WHEN real_portrait_remote_operations.status = 'submitting'
             THEN real_portrait_remote_operations.next_retry_at
           ELSE EXCLUDED.next_retry_at
         END,
         last_error_code = NULL,
         updated_at = now()`,
    [
      input.userId,
      input.actorId,
      input.materializationId,
      input.sessionId,
      `visual-validation-result:${input.sessionId}`,
      input.nextRetryAt,
    ],
  );
}

async function persistVisualValidationSubmissionForRecovery(input: {
  userId: string;
  actorId: string;
  materializationId: string;
  sessionId: string;
  operationId: string;
  bytedTokenCiphertext: string;
  bytedTokenFingerprint: string;
  h5LinkCiphertext: string;
  h5ExpiresAt: Date;
  failureCode: string;
}) {
  await withTransaction(async client => {
    const locked = await client.query<{
      status: string;
      byted_token_fingerprint: string | null;
    }>(
      `SELECT verification_session.status, verification_session.byted_token_fingerprint
       FROM real_portrait_verification_sessions verification_session
       JOIN real_portrait_actors actor ON actor.id = verification_session.actor_id
       JOIN real_portrait_authorizations portrait_authorization
         ON portrait_authorization.id = verification_session.authorization_id
       JOIN real_portrait_materializations materialization
         ON materialization.id = $2
        AND materialization.actor_id = verification_session.actor_id
        AND materialization.authorization_id = verification_session.authorization_id
       WHERE verification_session.id = $1 AND verification_session.actor_id = $3
       FOR UPDATE OF verification_session, actor, portrait_authorization, materialization`,
      [input.sessionId, input.materializationId, input.actorId],
    );
    const session = locked.rows[0];
    if (!session || !['submitting', 'submission_unknown', 'invitation_ready', 'waiting'].includes(session.status)) {
      throw Object.assign(new Error('实名认证会话已不允许恢复远端凭证'), {
        code: 'REAL_PORTRAIT_VISUAL_SESSION_RECOVERY_STATE_CONFLICT',
      });
    }
    if (session.byted_token_fingerprint
        && session.byted_token_fingerprint !== input.bytedTokenFingerprint) {
      throw Object.assign(new Error('实名认证恢复凭证与已保存凭证冲突'), {
        code: 'REAL_PORTRAIT_VISUAL_SESSION_TOKEN_CONFLICT',
      });
    }
    const persisted = await client.query(
      `UPDATE real_portrait_verification_sessions
       SET byted_token_ciphertext = COALESCE(byted_token_ciphertext, $2),
           byted_token_fingerprint = COALESCE(byted_token_fingerprint, $3),
           h5_link_ciphertext = COALESCE(h5_link_ciphertext, $6),
           status = CASE
             WHEN status IN ('submitting', 'submission_unknown') THEN 'submission_unknown'
             ELSE status
           END,
           h5_expires_at = COALESCE(h5_expires_at, $4),
           failure_code = CASE
             WHEN status IN ('submitting', 'submission_unknown') THEN $5
             ELSE NULL
           END,
           updated_at = now()
       WHERE id = $1
         AND status IN ('submitting', 'submission_unknown', 'invitation_ready', 'waiting')
         AND (byted_token_fingerprint IS NULL OR byted_token_fingerprint = $3)`,
      [
        input.sessionId,
        input.bytedTokenCiphertext,
        input.bytedTokenFingerprint,
        input.h5ExpiresAt,
        input.failureCode,
        input.h5LinkCiphertext,
      ],
    );
    if (!persisted.rowCount) {
      throw Object.assign(new Error('实名认证恢复凭证未能按预期状态落库'), {
        code: 'REAL_PORTRAIT_VISUAL_SESSION_RECOVERY_CAS_FAILED',
      });
    }
    await client.query(
      `UPDATE real_portrait_remote_operations
       SET status = CASE WHEN status = 'completed' THEN 'completed' ELSE 'submission_unknown' END,
           next_retry_at = CASE WHEN status = 'completed' THEN NULL ELSE now() END,
           last_error_code = CASE WHEN status = 'completed' THEN last_error_code ELSE $2 END,
           updated_at = now()
       WHERE id = $1 AND operation_type = 'create_visual_validation_session'`,
      [input.operationId, input.failureCode],
    );
    await upsertVerificationLookupOperationWithClient(client, {
      userId: input.userId,
      actorId: input.actorId,
      materializationId: input.materializationId,
      sessionId: input.sessionId,
      nextRetryAt: new Date(),
    });
  });
}

export async function getPublicRealPortraitInviteStatus(
  token: string,
  dependencies: RealPortraitServiceDependencies = {},
) {
  let invite = await findInviteByToken(token);
  if (invite.verification_status === 'submission_unknown') {
    const session = await findVerificationSessionByInviteToken(token);
    if (session) {
      await resolveVerificationSessionAuthoritatively(
        session,
        dependencies.provider ?? getConfiguredRealPortraitProvider(),
        dependencies.now?.() ?? new Date(),
      ).catch(() => undefined);
      invite = await findInviteByToken(token);
    }
  }
  return {
    status: publicVerificationStatus(invite),
    authorizationExpiresAt: toIsoDateTime(invite.authorization_valid_until),
  };
}

export async function handleVolcRealPortraitValidationCallback(
  opaqueNonce: string,
  callback: { bytedToken?: string; resultCode?: string },
  dependencies: RealPortraitServiceDependencies = {},
) {
  const now = dependencies.now?.() ?? new Date();
  const session = await prepareVerificationCallbackLookup(
    opaqueNonce,
    callback.bytedToken,
    now,
  );
  if (session.status === 'verified') return { accepted: true, status: 'verified' as const };
  // callback.resultCode 只用于审计；状态和 GroupId 始终以官方查单为准。
  const status = await resolveVerificationSessionAuthoritatively(
    session,
    dependencies.provider ?? getConfiguredRealPortraitProvider(),
    now,
    callback.resultCode,
  );
  return { accepted: true, status };
}

async function prepareVerificationCallbackLookup(
  opaqueNonce: string,
  callbackBytedToken: string | undefined,
  now: Date,
) {
  const callbackNonceHash = fingerprintRealPortraitSecret(opaqueNonce);
  const callbackTokenFingerprint = callbackBytedToken
    ? fingerprintRealPortraitSecret(callbackBytedToken)
    : null;
  const callbackTokenCiphertext = callbackBytedToken
    ? JSON.stringify(encryptRealPortraitSecret(callbackBytedToken))
    : null;
  const fallbackExpiresAt = new Date(
    now.getTime() + env.REAL_PORTRAIT_INVITE_TTL_SECONDS * 1_000,
  );
  return withTransaction(async client => {
    const locked = await client.query<VerificationCallbackRow>(
      `SELECT verification_session.id AS session_id,
              verification_session.actor_id,
              verification_session.authorization_id,
              verification_session.byted_token_ciphertext,
              verification_session.byted_token_fingerprint,
              verification_session.status,
              actor.user_id, materialization.id AS materialization_id,
              materialization.project_name
       FROM real_portrait_verification_sessions verification_session
       JOIN real_portrait_actors actor ON actor.id = verification_session.actor_id
       JOIN real_portrait_authorizations portrait_authorization
         ON portrait_authorization.id = verification_session.authorization_id
       JOIN real_portrait_materializations materialization
         ON materialization.actor_id = verification_session.actor_id
        AND materialization.authorization_id = verification_session.authorization_id
       WHERE verification_session.callback_nonce_hash = $1
       ORDER BY materialization.generation DESC
       LIMIT 1
       FOR UPDATE OF verification_session, actor, portrait_authorization, materialization`,
      [callbackNonceHash],
    );
    const session = locked.rows[0];
    if (!session) throw notFound('验证回调不存在');
    if (callbackTokenFingerprint && session.byted_token_fingerprint
        && callbackTokenFingerprint !== session.byted_token_fingerprint) {
      throw badRequest('验证回调凭证不匹配', 'REAL_PORTRAIT_CALLBACK_TOKEN_MISMATCH');
    }
    if (session.status === 'verified') return session;
    if (!['submitting', 'submission_unknown', 'invitation_ready', 'waiting'].includes(session.status)) {
      throw conflict('验证回调会话已终止', 'REAL_PORTRAIT_CALLBACK_SESSION_TERMINAL');
    }
    if (!session.byted_token_ciphertext && !callbackBytedToken) {
      throw badRequest('验证回调缺少远端会话凭证', 'REAL_PORTRAIT_CALLBACK_TOKEN_REQUIRED');
    }
    const persisted = await client.query(
      `UPDATE real_portrait_verification_sessions
       SET byted_token_ciphertext = COALESCE(byted_token_ciphertext, $2),
           byted_token_fingerprint = COALESCE(byted_token_fingerprint, $3),
           status = CASE
             WHEN status IN ('submitting', 'submission_unknown') THEN 'submission_unknown'
             ELSE status
           END,
           h5_expires_at = COALESCE(h5_expires_at, $4),
           failure_code = CASE
             WHEN status IN ('submitting', 'submission_unknown')
               THEN COALESCE(failure_code, 'CALLBACK_AUTHORITATIVE_LOOKUP_PENDING')
             ELSE NULL
           END,
           updated_at = now()
       WHERE id = $1
         AND status IN ('submitting', 'submission_unknown', 'invitation_ready', 'waiting')
         AND (byted_token_fingerprint IS NULL OR byted_token_fingerprint = $3)`,
      [
        session.session_id,
        callbackTokenCiphertext,
        callbackTokenFingerprint ?? session.byted_token_fingerprint,
        fallbackExpiresAt,
      ],
    );
    if (!persisted.rowCount) {
      throw conflict('验证回调会话状态已改变', 'REAL_PORTRAIT_CALLBACK_STATE_CONFLICT');
    }
    await client.query(
      `UPDATE real_portrait_remote_operations
       SET status = 'completed', next_retry_at = NULL, last_error_code = NULL, updated_at = now()
       WHERE verification_session_id = $1
         AND operation_type = 'create_visual_validation_session'
         AND status IN ('submitting', 'submission_unknown')`,
      [session.session_id],
    );
    await upsertVerificationLookupOperationWithClient(client, {
      userId: session.user_id,
      actorId: session.actor_id,
      materializationId: session.materialization_id,
      sessionId: session.session_id,
      nextRetryAt: now,
    });
    return {
      ...session,
      byted_token_ciphertext: session.byted_token_ciphertext ?? callbackTokenCiphertext,
      byted_token_fingerprint: session.byted_token_fingerprint ?? callbackTokenFingerprint,
      status: ['submitting', 'submission_unknown'].includes(session.status)
        ? 'submission_unknown'
        : session.status,
    };
  });
}

export async function processPendingRealPortraitVerificationResults(
  limit = 20,
  dependencies: RealPortraitServiceDependencies = {},
) {
  const provider = dependencies.provider ?? getConfiguredRealPortraitProvider();
  const now = dependencies.now?.() ?? new Date();
  await pool.query(
    `UPDATE real_portrait_remote_operations
     SET status = 'submission_unknown', next_retry_at = $1, updated_at = now()
     WHERE operation_type = 'get_visual_validation_result'
       AND status = 'submitting'
       AND updated_at < $1::timestamptz - interval '5 minutes'`,
    [now],
  );
  let processed = 0;
  const processedOperationIds: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    const session = await withTransaction(async client => {
      const result = await client.query<VerificationCallbackRow & {
        operation_id: string;
        attempt_count: number | string;
      }>(
        `SELECT s.id AS session_id, s.actor_id, s.authorization_id,
                s.byted_token_ciphertext, s.byted_token_fingerprint, s.status,
                a.user_id, m.id AS materialization_id, m.project_name,
                op.id AS operation_id, op.attempt_count
         FROM real_portrait_remote_operations op
         JOIN real_portrait_verification_sessions s ON s.id = op.verification_session_id
         JOIN real_portrait_actors a ON a.id = s.actor_id
         JOIN real_portrait_materializations m
           ON m.actor_id = s.actor_id AND m.authorization_id = s.authorization_id
         WHERE op.operation_type = 'get_visual_validation_result'
           AND op.status IN ('prepared', 'failed', 'submission_unknown')
           AND (op.next_retry_at IS NULL OR op.next_retry_at <= $1)
           AND s.status IN ('submission_unknown', 'invitation_ready', 'waiting')
           AND s.byted_token_ciphertext IS NOT NULL
           AND s.byted_token_fingerprint IS NOT NULL
           AND op.id <> ALL($2::uuid[])
         ORDER BY (s.h5_expires_at IS NOT NULL AND s.h5_expires_at <= $1) DESC,
                  op.next_retry_at ASC NULLS FIRST, op.created_at, op.id
         FOR UPDATE OF op SKIP LOCKED
         LIMIT 1`,
        [now, processedOperationIds],
      );
      const row = result.rows[0];
      if (!row) return null;
      const claimed = await client.query<{ attempt_count: number | string }>(
        `UPDATE real_portrait_remote_operations
         SET status = 'submitting', attempt_count = attempt_count + 1,
             next_retry_at = NULL, last_error_code = NULL, updated_at = now()
         WHERE id = $1
           AND status IN ('prepared', 'failed', 'submission_unknown')
         RETURNING attempt_count`,
        [row.operation_id],
      );
      const attemptCount = claimed.rows[0]?.attempt_count;
      if (attemptCount === undefined) return null;
      return { ...row, attempt_count: attemptCount };
    });
    if (!session) break;
    processedOperationIds.push(session.operation_id);
    processed += 1;
    await resolveVerificationSessionAuthoritatively(session, provider, now, undefined, {
      operationId: session.operation_id,
      attemptCount: toInt(session.attempt_count),
    });
  }
  return { processed };
}

async function findVerificationSessionByInviteToken(token: string) {
  const result = await pool.query<VerificationCallbackRow>(
    verificationSessionSql(`i.token_hash = $1 AND s.status = 'submission_unknown'`),
    [fingerprintRealPortraitSecret(token)],
  );
  return result.rows[0] ?? null;
}

function verificationSessionSql(where: string) {
  return `SELECT s.id AS session_id, s.actor_id, s.authorization_id,
                 s.byted_token_ciphertext, s.byted_token_fingerprint, s.status,
                 a.user_id, m.id AS materialization_id, m.project_name
          FROM real_portrait_verification_sessions s
          JOIN real_portrait_invites i ON i.id = s.invite_id
          JOIN real_portrait_actors a ON a.id = s.actor_id
          JOIN real_portrait_materializations m
            ON m.actor_id = s.actor_id AND m.authorization_id = s.authorization_id
          WHERE ${where}
          ORDER BY m.generation DESC
          LIMIT 1`;
}

async function resolveVerificationSessionAuthoritatively(
  session: VerificationCallbackRow,
  provider: RealPortraitProvider,
  now: Date,
  callbackResultCode: string | undefined = undefined,
  lookupClaim: VerificationLookupClaim | undefined = undefined,
): Promise<'verified' | 'verifying' | 'discarded' | 'cleanup-pending'> {
  if (!session.byted_token_ciphertext) return 'verifying';
  const bytedToken = decryptRealPortraitSecret(parseEncryptedSecret(session.byted_token_ciphertext));
  let verified: Awaited<ReturnType<RealPortraitProvider['getVisualValidationResult']>>;
  try {
    verified = await provider.getVisualValidationResult(bytedToken, session.project_name);
  } catch (error) {
    await markVerificationLookupPending(session, error, now, lookupClaim);
    return 'verifying';
  }

  const outcome = await withTransaction(async client => {
    await acquireCapacityLock(client);
    const quota = await reconcileRealPortraitQuotaWithClient(client, session.user_id, now);
    const locked = await client.query<{
      session_status: string;
      authorization_status: string;
      authorization_valid_now: boolean;
      lifecycle_status: string;
      plan_access_status: string;
      materialization_status: string;
      grace_valid: boolean;
    }>(
      `SELECT s.status AS session_status, auth.status AS authorization_status,
              (auth.valid_from <= now() AND auth.valid_until > now()) AS authorization_valid_now,
              a.lifecycle_status, a.plan_access_status,
              m.status AS materialization_status,
              COALESCE(
                qs.grace_status IN ('active', 'reconciling') AND qs.grace_until > now(),
                false
              ) AS grace_valid
       FROM real_portrait_verification_sessions s
       JOIN real_portrait_authorizations auth ON auth.id = s.authorization_id
       JOIN real_portrait_actors a ON a.id = s.actor_id
       JOIN real_portrait_materializations m
         ON m.actor_id = s.actor_id AND m.authorization_id = s.authorization_id
       LEFT JOIN user_portrait_quota_states qs ON qs.user_id = a.user_id
       WHERE s.id = $1
       FOR UPDATE OF s, auth, a, m`,
      [session.session_id],
    );
    const state = locked.rows[0];
    if (state?.session_status === 'verified') {
      await markVerificationLookupCompletedWithClient(client, session.session_id);
      return { status: 'verified' as const, cleanupOperationId: null };
    }
    const planUsable = Boolean(state) && (
      (state.plan_access_status === 'available' && quota.enabled)
      || (state.plan_access_status === 'grace' && state.grace_valid)
    );
    const authorizationUsable = Boolean(state)
      && ['pending', 'verified'].includes(state.authorization_status)
      && state.authorization_valid_now
      && state.lifecycle_status === 'verifying'
      && state.materialization_status === 'verifying';
    if (!authorizationUsable || !planUsable) {
      const failureCode = planUsable
        ? 'AUTHORIZATION_NO_LONGER_USABLE'
        : 'PLAN_ACCESS_NO_LONGER_USABLE';
      await client.query(
        `UPDATE real_portrait_verification_sessions
         SET status = 'failed', last_polled_at = $2,
             failure_code = $3, updated_at = now()
         WHERE id = $1`,
        [session.session_id, now, failureCode],
      );
      await client.query(
        `UPDATE real_portrait_authorizations
         SET status = CASE
               WHEN status IN ('pending', 'verified') AND valid_until <= now() THEN 'expired'
               ELSE status
             END,
             updated_at = now()
         WHERE id = $1`,
        [session.authorization_id],
      );
      await client.query(
       `UPDATE real_portrait_materializations
         SET provider_group_id = $2,
             status = CASE WHEN status = 'deleted' THEN 'deleted' ELSE 'deleting' END,
             remote_deleted_at = CASE
               WHEN status = 'deleted' THEN remote_deleted_at
               ELSE NULL
             END,
             updated_at = now()
         WHERE id = $1`,
        [session.materialization_id, verified.groupId],
      );
      await client.query(
        `UPDATE real_portrait_actors
         SET lifecycle_status = CASE
               WHEN lifecycle_status IN ('revoked', 'expired', 'sync_error') THEN lifecycle_status
               ELSE 'deleting'
             END,
             updated_at = now()
         WHERE id = $1`,
        [session.actor_id],
      );
      const cleanupIdempotencyKey = `late-validation-group:${session.session_id}`;
      await client.query(
        `INSERT INTO real_portrait_remote_operations (
           user_id, actor_id, materialization_id, verification_session_id,
           operation_type, status, idempotency_key, attempt_count
         ) VALUES ($1, $2, $3, $4, 'expired_verification_delete_group', 'prepared', $5, 0)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          session.user_id,
          session.actor_id,
          session.materialization_id,
          session.session_id,
          cleanupIdempotencyKey,
        ],
      );
      const cleanupClaim = await client.query<{ id: string }>(
        `UPDATE real_portrait_remote_operations
         SET status = 'submitting', attempt_count = attempt_count + 1,
             next_retry_at = NULL, last_error_code = NULL, updated_at = now()
         WHERE idempotency_key = $1
           AND operation_type = 'expired_verification_delete_group'
           AND status IN ('prepared', 'failed', 'submission_unknown')
           AND (next_retry_at IS NULL OR next_retry_at <= $2)
         RETURNING id`,
        [cleanupIdempotencyKey, now],
      );
      await markVerificationLookupCompletedWithClient(client, session.session_id);
      await appendPortraitEvent(client, {
        userId: session.user_id,
        actorId: session.actor_id,
        authorizationId: session.authorization_id,
        materializationId: session.materialization_id,
        eventType: 'verification.discarded_after_access_change',
        initiatorType: 'system',
        metadata: { authoritativeQuery: true, failureCode },
      });
      return {
        status: 'cleanup-pending' as const,
        cleanupOperationId: cleanupClaim.rows[0]?.id ?? null,
      };
    }
    await client.query(
      `UPDATE real_portrait_verification_sessions
       SET status = 'verified', last_polled_at = $2, failure_code = NULL, updated_at = now()
       WHERE id = $1`,
      [session.session_id, now],
    );
    await client.query(
      `UPDATE real_portrait_authorizations
       SET status = 'active', updated_at = now()
       WHERE id = $1 AND status IN ('pending', 'verified')`,
      [session.authorization_id],
    );
    await client.query(
      `UPDATE real_portrait_materializations
       SET provider_group_id = $2, status = 'awaiting_upload', updated_at = now()
       WHERE id = $1 AND status IN ('reserved', 'verifying')`,
      [session.materialization_id, verified.groupId],
    );
    await client.query(
      `UPDATE real_portrait_actors
       SET lifecycle_status = 'awaiting_upload', updated_at = now()
       WHERE id = $1 AND lifecycle_status = 'verifying'`,
      [session.actor_id],
    );
    await client.query(
      `UPDATE real_portrait_invites SET status = 'consumed', updated_at = now()
       WHERE authorization_id = $1 AND status = 'accepted'`,
      [session.authorization_id],
    );
    await client.query(
      `UPDATE real_portrait_activation_queue SET status = 'completed', updated_at = now()
       WHERE actor_id = $1 AND status = 'promoted'`,
      [session.actor_id],
    );
    await markVerificationLookupCompletedWithClient(client, session.session_id);
    await appendPortraitEvent(client, {
      userId: session.user_id,
      actorId: session.actor_id,
      authorizationId: session.authorization_id,
      materializationId: session.materialization_id,
      eventType: 'verification.verified',
      initiatorType: 'system',
      metadata: { callbackResultCode: callbackResultCode ?? null, authoritativeQuery: true },
    });
    return { status: 'verified' as const, cleanupOperationId: null };
  });

  if (outcome.status !== 'cleanup-pending' || !outcome.cleanupOperationId) return outcome.status;
  try {
    await provider.deleteAssetGroup(verified.groupId, session.project_name);
    await withTransaction(async client => {
      await client.query(
        `UPDATE real_portrait_materializations
         SET status = 'deleted', remote_deleted_at = $2, updated_at = now()
         WHERE id = $1`,
        [session.materialization_id, now],
      );
      await client.query(
        `UPDATE real_portrait_remote_operations SET status = 'completed', updated_at = now()
         WHERE id = $1`,
        [outcome.cleanupOperationId],
      );
    });
    return 'discarded';
  } catch (error) {
    await withTransaction(async client => {
      await client.query(
        `UPDATE real_portrait_actors
         SET lifecycle_status = CASE
               WHEN lifecycle_status IN ('revoked', 'expired') THEN lifecycle_status
               ELSE 'sync_error'
             END,
             updated_at = now()
         WHERE id = $1`,
        [session.actor_id],
      );
      await markRemoteOperationFailureWithClient(client, outcome.cleanupOperationId!, error);
    });
    return 'cleanup-pending';
  }
}

function verificationLookupRetryDelaySeconds(attemptCount: number) {
  const normalizedAttempt = Math.max(1, Math.floor(attemptCount));
  const exponentialDelay = VERIFICATION_LOOKUP_RETRY_BASE_SECONDS
    * (2 ** Math.min(30, normalizedAttempt - 1));
  return Math.min(VERIFICATION_LOOKUP_RETRY_MAX_SECONDS, exponentialDelay);
}

async function markVerificationLookupPending(
  session: VerificationCallbackRow,
  error: unknown,
  now: Date,
  lookupClaim: VerificationLookupClaim | undefined = undefined,
) {
  await withTransaction(async client => {
    const pending = await client.query(
      `UPDATE real_portrait_verification_sessions
       SET status = CASE
             WHEN status IN ('invitation_ready', 'waiting') THEN status
             ELSE 'submission_unknown'
           END,
           last_polled_at = now(),
           failure_code = CASE
             WHEN status IN ('invitation_ready', 'waiting') THEN NULL
             ELSE $2
           END,
           updated_at = now()
       WHERE id = $1
         AND status IN ('submitting', 'submission_unknown', 'invitation_ready', 'waiting')`,
      [session.session_id, safeErrorCode(error)],
    );
    if (!pending.rowCount) {
      await markVerificationLookupCompletedWithClient(client, session.session_id);
      return;
    }
    const errorCode = safeErrorCode(error);
    if (lookupClaim) {
      const retryAt = new Date(
        now.getTime() + verificationLookupRetryDelaySeconds(lookupClaim.attemptCount) * 1_000,
      );
      const deferred = await client.query(
        `UPDATE real_portrait_remote_operations
         SET status = 'submission_unknown', next_retry_at = $2,
             last_error_code = $3, updated_at = now()
         WHERE id = $1
           AND operation_type = 'get_visual_validation_result'
           AND status = 'submitting'
           AND attempt_count = $4`,
        [lookupClaim.operationId, retryAt, errorCode, lookupClaim.attemptCount],
      );
      if (!deferred.rowCount) {
        throw new Error('REAL_PORTRAIT_VERIFICATION_LOOKUP_CLAIM_LOST');
      }
      return;
    }

    const scheduled = await client.query<{
      id: string;
      status: string;
      attempt_count: number | string;
    }>(
      `INSERT INTO real_portrait_remote_operations (
         user_id, actor_id, materialization_id, verification_session_id,
         operation_type, status, idempotency_key, attempt_count, next_retry_at, last_error_code
       ) VALUES ($1, $2, $3, $4, 'get_visual_validation_result', 'submission_unknown', $5, 1,
                 NULL, $6)
       ON CONFLICT (idempotency_key) DO UPDATE
       SET status = CASE
             WHEN real_portrait_remote_operations.status = 'completed' THEN 'completed'
             ELSE 'submission_unknown'
           END,
           attempt_count = CASE
             WHEN real_portrait_remote_operations.status = 'completed'
               THEN real_portrait_remote_operations.attempt_count
             ELSE real_portrait_remote_operations.attempt_count + 1
           END,
           next_retry_at = NULL,
           last_error_code = EXCLUDED.last_error_code,
           updated_at = now()
       RETURNING id, status, attempt_count`,
      [
        session.user_id,
        session.actor_id,
        session.materialization_id,
        session.session_id,
        `visual-validation-result:${session.session_id}`,
        errorCode,
      ],
    );
    const operation = scheduled.rows[0];
    if (!operation || operation.status === 'completed') return;
    const attemptCount = toInt(operation.attempt_count);
    const retryAt = new Date(
      now.getTime() + verificationLookupRetryDelaySeconds(attemptCount) * 1_000,
    );
    const deferred = await client.query(
      `UPDATE real_portrait_remote_operations
       SET next_retry_at = $2, updated_at = now()
       WHERE id = $1
         AND status = 'submission_unknown'
         AND attempt_count = $3`,
      [operation.id, retryAt, attemptCount],
    );
    if (!deferred.rowCount) {
      throw new Error('REAL_PORTRAIT_VERIFICATION_LOOKUP_SCHEDULE_LOST');
    }
  });
}

async function markVerificationLookupCompletedWithClient(client: DbClient, sessionId: string) {
  await client.query(
    `UPDATE real_portrait_remote_operations
     SET status = 'completed', next_retry_at = NULL, last_error_code = NULL, updated_at = now()
     WHERE verification_session_id = $1 AND operation_type = 'get_visual_validation_result'`,
    [sessionId],
  );
}

export async function getRealPortraitAuthorizationByManageToken(manageToken: string) {
  const row = await findManageAuthorization(manageToken);
  return mapManagedAuthorization(row);
}

export async function revokeRealPortraitAuthorizationByManageToken(
  manageToken: string,
  input: { reasonCode?: string },
  dependencies: RealPortraitServiceDependencies = {},
) {
  const row = await findManageAuthorization(manageToken);
  if (row.authorization_status === 'revoked') {
    return { authorization: mapManagedAuthorization(row) };
  }
  const result = await revokeRealPortraitAuthorization(row.user_id, row.actor_id, {
    source: 'subject',
    reasonCode: input.reasonCode,
    manageTokenHash: fingerprintRealPortraitSecret(manageToken),
  }, dependencies);
  return {
    authorization: {
      status: 'revoked' as const,
      ...mapRealPortraitLegalDisclosure(row),
      purpose: row.purpose,
      commercialUse: Boolean(row.commercial_use),
      validUntil: toIsoDateTime(row.valid_until)!,
      cleanupStatus: result.cleanupPending ? 'pending' as const : 'completed' as const,
    },
  };
}

export async function createRealPortraitUpload(
  userId: string,
  actorId: string,
  input: { kind: RealPortraitAssetKind; mimeType: string; sizeBytes: number },
) {
  const mimeType = normalizePortraitMimeType(input.mimeType);
  assertPortraitUploadSize(input.sizeBytes);
  const now = new Date();
  const uploadId = randomUUID();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1_000);
  const objectKey = `real-portrait-uploads/${userId}/${actorId}/${uploadId}`;
  await withTransaction(async client => {
    await acquireCapacityLock(client);
    const quota = await reconcileRealPortraitQuotaWithClient(client, userId, now);
    if (input.kind === 'secondary' && quota.assetsPerActor < 2) {
      throw conflict('当前套餐不包含第二张真人素材', 'REAL_PORTRAIT_ASSET_QUOTA_EXCEEDED');
    }
    const materialization = await client.query<{
      id: string;
      status: string;
      authorization_status: string;
      authorization_valid_now: boolean;
      plan_access_status: string;
      actor_lifecycle_status: string;
    }>(
      `SELECT m.id, m.status, auth.status AS authorization_status,
              (auth.valid_from <= now() AND auth.valid_until > now()) AS authorization_valid_now,
              a.plan_access_status, a.lifecycle_status AS actor_lifecycle_status
       FROM real_portrait_materializations m
       JOIN real_portrait_actors a ON a.id = m.actor_id
       JOIN real_portrait_authorizations auth ON auth.id = m.authorization_id
       WHERE m.actor_id = $1 AND a.user_id = $2 AND a.deleted_at IS NULL
         AND m.status NOT IN ('evicted', 'deleted', 'error')
       ORDER BY m.generation DESC
       LIMIT 1
       FOR UPDATE OF m, a, auth`,
      [actorId, userId],
    );
    const row = materialization.rows[0];
    if (!row) throw notFound('真人档案尚未完成实名验证');
    await assertRealPortraitActorPlanUsableWithClient(client, userId, row.plan_access_status, quota);
    if (row.authorization_status !== 'active' || !row.authorization_valid_now) {
      throw conflict('真人授权无效或已过期', 'REAL_PORTRAIT_AUTHORIZATION_INACTIVE');
    }
    if (!['awaiting_upload', 'processing', 'active'].includes(row.status)) {
      throw conflict('真人档案当前不能上传素材', 'REAL_PORTRAIT_UPLOAD_NOT_ALLOWED');
    }
    if (!['awaiting_upload', 'processing', 'active'].includes(row.actor_lifecycle_status)) {
      throw conflict('真人档案当前不能上传素材', 'REAL_PORTRAIT_UPLOAD_NOT_ALLOWED');
    }
    if (input.kind === 'secondary') {
      const primary = await client.query<{ id: string }>(
        `SELECT primary_asset.id
         FROM real_portrait_assets primary_asset
         WHERE primary_asset.materialization_id = $1
           AND primary_asset.actor_id = $2
           AND primary_asset.kind = 'primary'
           AND primary_asset.status = 'active'
           AND primary_asset.consistency_status = 'passed'
           AND primary_asset.provider_asset_id IS NOT NULL
           AND primary_asset.remote_deleted_at IS NULL
         LIMIT 1
         FOR SHARE OF primary_asset`,
        [row.id, actorId],
      );
      if (!primary.rowCount) {
        throw conflict(
          '请先完成主真人素材校验，再上传第二张素材',
          'REAL_PORTRAIT_PRIMARY_ASSET_REQUIRED',
        );
      }
    }
    const duplicate = await client.query(
      `SELECT 1
       FROM real_portrait_assets
       WHERE materialization_id = $1 AND kind = $2 AND status <> 'deleted'
       UNION ALL
       SELECT 1
       FROM real_portrait_upload_sessions
       WHERE materialization_id = $1 AND kind = $2
         AND status IN ('waiting_upload', 'uploaded', 'submitting', 'processing', 'active')
         AND expires_at > now()
       LIMIT 1`,
      [row.id, input.kind],
    );
    if (duplicate.rowCount) {
      throw conflict('该真人素材位已有上传或处理任务', 'REAL_PORTRAIT_UPLOAD_EXISTS');
    }
    const counts = await readCapacityCounts(client, userId);
    const snapshot = capacitySnapshot(counts);
    const ownReservation = await client.query<{
      remaining_asset_slots: number | string;
      current_assets: number | string;
    }>(
      `WITH current_asset_slots AS (
         SELECT asset.id AS slot_id
         FROM real_portrait_assets asset
         WHERE asset.actor_id = $1
           AND (
             (asset.provider_asset_id IS NOT NULL AND asset.remote_deleted_at IS NULL)
             OR (asset.provider_asset_id IS NULL AND asset.status = 'queued')
           )
         UNION ALL
         SELECT upload.id AS slot_id
         FROM real_portrait_upload_sessions upload
         WHERE upload.actor_id = $1
           AND upload.asset_id IS NULL
           AND upload.status IN ('waiting_upload', 'uploaded', 'submitting', 'processing', 'active')
           AND (
             upload.status IN ('submitting', 'processing', 'active')
             OR upload.expires_at > now()
           )
       )
       SELECT
         COALESCE(max(GREATEST(r.asset_slots - current_assets.count, 0))
           FILTER (WHERE r.status = 'reserved' AND r.expires_at > now()), 0)::integer
           AS remaining_asset_slots,
         current_assets.count::integer AS current_assets
       FROM (
         SELECT count(*) AS count FROM current_asset_slots
       ) current_assets
       LEFT JOIN real_portrait_capacity_reservations r ON r.actor_id = $1
       GROUP BY current_assets.count`,
      [actorId],
    );
    const remainingAssetSlots = toInt(ownReservation.rows[0]?.remaining_asset_slots);
    const currentAssets = toInt(ownReservation.rows[0]?.current_assets);
    if (
      remainingAssetSlots < 1
      && snapshot.residentAssets + snapshot.heldAssetSlots >= snapshot.assetSoftLimit
    ) {
      throw conflict('真人素材共享容量暂时不足，请稍后重试', 'REAL_PORTRAIT_CAPACITY_WAIT');
    }
    if (remainingAssetSlots < 1) {
      await client.query(
        `UPDATE real_portrait_capacity_reservations
         SET status = 'expired', updated_at = now()
         WHERE actor_id = $1 AND status = 'reserved' AND expires_at <= now()`,
        [actorId],
      );
      await client.query(
        `INSERT INTO real_portrait_capacity_reservations (
           user_id, actor_id, group_slots, asset_slots, expires_at
         ) VALUES ($1, $2, 1, $3, $4)
         ON CONFLICT (actor_id) WHERE status = 'reserved'
         DO UPDATE SET
           group_slots = GREATEST(real_portrait_capacity_reservations.group_slots, EXCLUDED.group_slots),
           asset_slots = GREATEST(real_portrait_capacity_reservations.asset_slots, EXCLUDED.asset_slots),
           expires_at = GREATEST(real_portrait_capacity_reservations.expires_at, EXCLUDED.expires_at),
           updated_at = now()`,
        [userId, actorId, currentAssets + 1, addHours(now, CAPACITY_RESERVATION_HOURS)],
      );
    }
    await client.query(
      `INSERT INTO real_portrait_upload_sessions (
         id, user_id, actor_id, materialization_id, kind, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [uploadId, userId, actorId, row.id, input.kind, expiresAt],
    );
    await appendPortraitEvent(client, {
      userId,
      actorId,
      materializationId: row.id,
      eventType: 'asset.upload_prepared',
      initiatorType: 'user',
      initiatorUserId: userId,
      metadata: { kind: input.kind },
    });
  });
  let signature;
  try {
    signature = await createUploadSignature({
      objectKey,
      contentType: mimeType,
      maxSizeBytes: PORTRAIT_MAX_UPLOAD_BYTES,
    });
  } catch (error) {
    await pool.query(
      `UPDATE real_portrait_upload_sessions
       SET status = 'failed', updated_at = now()
       WHERE id = $1 AND status = 'waiting_upload'`,
      [uploadId],
    );
    throw error;
  }
  return {
    upload: {
      id: uploadId,
      kind: input.kind,
      status: 'waiting_upload' as const,
      expiresAt: expiresAt.toISOString(),
      signature,
    },
  };
}

export async function completeRealPortraitUpload(
  userId: string,
  uploadId: string,
  input: { mimeType: string; sizeBytes: number; width?: number; height?: number; sha256: string },
  dependencies: RealPortraitServiceDependencies = {},
) {
  const provider = dependencies.provider ?? getConfiguredRealPortraitProvider();
  assertProviderConfigured(provider);
  const now = dependencies.now?.() ?? new Date();
  const mimeType = normalizePortraitMimeType(input.mimeType);
  assertPortraitUploadSize(input.sizeBytes);
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw badRequest('真人图片 SHA-256 不正确', 'REAL_PORTRAIT_IMAGE_HASH_INVALID');
  }
  if (input.width !== undefined && input.height !== undefined) {
    assertPortraitImageMetadata({ ...input, width: input.width, height: input.height });
  }
  const sessionResult = await pool.query<UploadSessionRow>(
    `SELECT s.*, m.provider_group_id, m.project_name, a.alias
     FROM real_portrait_upload_sessions s
     JOIN real_portrait_materializations m ON m.id = s.materialization_id
     JOIN real_portrait_actors a ON a.id = s.actor_id
     WHERE s.id = $1 AND s.user_id = $2 AND a.deleted_at IS NULL
     LIMIT 1`,
    [uploadId, userId],
  );
  const session = sessionResult.rows[0];
  if (!session) throw notFound('真人素材上传会话不存在');
  const objectKey = session.object_key
    ?? `real-portrait-uploads/${userId}/${session.actor_id}/${uploadId}`;
  if (['processing', 'active'].includes(session.status) && session.asset_id) {
    return { asset: await requireOwnedPortraitAsset(userId, session.asset_id) };
  }
  if (session.status === 'submitting' && session.asset_id) {
    return recoverAmbiguousRealPortraitAssetSubmission(userId, uploadId, provider, now);
  }
  if (!['waiting_upload', 'uploaded'].includes(session.status)) {
    throw conflict('真人素材上传会话当前不能完成', 'REAL_PORTRAIT_UPLOAD_STATE_CONFLICT');
  }
  if (new Date(session.expires_at).getTime() <= now.getTime() && session.status === 'waiting_upload') {
    await withTransaction(async client => {
      await client.query(
        `UPDATE real_portrait_upload_sessions SET status = 'expired', updated_at = now() WHERE id = $1`,
        [uploadId],
      );
      await scheduleObjectDeletion(client, objectKey);
    });
    throw conflict('真人素材上传会话已过期', 'REAL_PORTRAIT_UPLOAD_EXPIRED');
  }
  let prepared = session.status === 'uploaded' && session.asset_id
    ? await readPreparedRealPortraitUpload(userId, uploadId)
    : null;
  if (!prepared) {
    let inspected: Awaited<ReturnType<typeof inspectStoredPortraitImage>>;
    try {
      inspected = await inspectStoredPortraitImage(objectKey);
    } catch (error) {
      await withTransaction(client => scheduleObjectDeletion(client, objectKey));
      throw error;
    }
    if (
      inspected.sizeBytes !== input.sizeBytes
      || (input.width !== undefined && inspected.width !== input.width)
      || (input.height !== undefined && inspected.height !== input.height)
      || inspected.sha256 !== input.sha256
    ) {
      await withTransaction(client => scheduleObjectDeletion(client, objectKey));
      throw badRequest('上传文件的服务端检测结果与声明不一致', 'REAL_PORTRAIT_UPLOAD_METADATA_MISMATCH');
    }
    assertPortraitImageMetadata({ ...inspected, mimeType });
    prepared = await withTransaction(async client => {
      await acquireCapacityLock(client);
      const quota = await reconcileRealPortraitQuotaWithClient(client, userId, now);
      const locked = await lockRealPortraitUploadSubmissionState(client, userId, uploadId);
      if (!locked || locked.session_status !== 'waiting_upload') {
        throw conflict('真人素材上传会话已被处理', 'REAL_PORTRAIT_UPLOAD_STATE_CONFLICT');
      }
      assertUploadSubmissionAccess(locked);
      await assertRealPortraitActorPlanUsableWithClient(
        client,
        userId,
        locked.plan_access_status,
        quota,
      );
      const asset = await client.query<{ id: string }>(
        `INSERT INTO real_portrait_assets (
           actor_id, materialization_id, kind, status, consistency_status
         ) VALUES ($1, $2, $3, 'queued', 'pending')
         RETURNING id`,
        [locked.actor_id, locked.materialization_id, locked.kind],
      );
      await client.query(
        `UPDATE real_portrait_assets pa SET thumbnail_object_key = $2
         FROM real_portrait_materializations m, real_portrait_authorizations auth
         WHERE pa.id = $1 AND m.id = pa.materialization_id AND auth.id = m.authorization_id
           AND auth.thumbnail_storage_allowed`,
        [asset.rows[0].id, `real-portrait-thumbnails/${userId}/${asset.rows[0].id}.webp`],
      );
      const operation = await client.query<{ id: string }>(
        `INSERT INTO real_portrait_remote_operations (
           user_id, actor_id, materialization_id, portrait_asset_id,
           operation_type, status, idempotency_key
         ) VALUES ($1, $2, $3, $4, 'create_asset', 'prepared', $5)
         RETURNING id`,
        [userId, locked.actor_id, locked.materialization_id, asset.rows[0].id, `create-asset:${uploadId}`],
      );
      await client.query(
        `UPDATE real_portrait_upload_sessions
         SET status = 'uploaded', object_key = $2, mime_type = $3,
             size_bytes = $4, width = $5, height = $6,
             sha256 = $7, asset_id = $8, updated_at = now()
         WHERE id = $1 AND status = 'waiting_upload'`,
        [
          uploadId,
          objectKey,
          mimeType,
          inspected.sizeBytes,
          inspected.width,
          inspected.height,
          inspected.sha256,
          asset.rows[0].id,
        ],
      );
      return {
        assetId: asset.rows[0].id,
        operationId: operation.rows[0].id,
        actorId: locked.actor_id,
        materializationId: locked.materialization_id,
        groupId: locked.provider_group_id!,
        projectName: locked.project_name,
        kind: locked.kind,
      };
    });
  }

  await ensureRealPortraitThumbnail(userId, prepared.assetId, objectKey);

  await withTransaction(async client => {
    await acquireCapacityLock(client);
    const quota = await reconcileRealPortraitQuotaWithClient(client, userId, now);
    const locked = await lockRealPortraitUploadSubmissionState(client, userId, uploadId, prepared!.operationId);
    if (!locked || locked.session_status !== 'uploaded'
      || locked.operation_status !== 'prepared' || locked.asset_status !== 'queued') {
      throw conflict('真人素材上传会话已被其他请求处理', 'REAL_PORTRAIT_UPLOAD_STATE_CONFLICT');
    }
    assertUploadSubmissionAccess(locked);
    await assertRealPortraitActorPlanUsableWithClient(client, userId, locked.plan_access_status, quota);
    const uploadClaimed = await client.query(
      `UPDATE real_portrait_upload_sessions SET status = 'submitting', updated_at = now()
       WHERE id = $1 AND status = 'uploaded'`,
      [uploadId],
    );
    const operationClaimed = await client.query(
      `UPDATE real_portrait_remote_operations
       SET status = 'submitting', attempt_count = attempt_count + 1, updated_at = now()
       WHERE id = $1 AND status = 'prepared'`,
      [prepared!.operationId],
    );
    const actorClaimed = await client.query(
      `UPDATE real_portrait_actors SET lifecycle_status = 'processing', updated_at = now()
       WHERE id = $1 AND lifecycle_status IN ('awaiting_upload', 'processing', 'active')`,
      [prepared!.actorId],
    );
    const materializationClaimed = await client.query(
      `UPDATE real_portrait_materializations SET status = 'processing', updated_at = now()
       WHERE id = $1 AND status IN ('awaiting_upload', 'processing', 'active')`,
      [prepared!.materializationId],
    );
    if (!uploadClaimed.rowCount || !operationClaimed.rowCount
      || !actorClaimed.rowCount || !materializationClaimed.rowCount) {
      throw conflict('真人素材上传会话已被其他请求处理', 'REAL_PORTRAIT_UPLOAD_STATE_CONFLICT');
    }
  });

  let sourceUrl: string;
  try {
    sourceUrl = await createObjectReadUrl(objectKey, 20 * 60);
  } catch (error) {
    await failUnsubmittedRealPortraitAsset(prepared, uploadId, objectKey, error);
    throw error;
  }

  let providerInput: {
    groupId: string;
    sourceUrl: string;
    name: string;
    assetType: 'Image';
    projectName: string;
  };
  try {
    providerInput = await withTransaction(async client => {
      await acquireCapacityLock(client);
      const quota = await reconcileRealPortraitQuotaWithClient(client, userId, now);
      const locked = await lockRealPortraitUploadSubmissionState(client, userId, uploadId, prepared!.operationId);
      if (!locked || locked.session_status !== 'submitting'
        || locked.operation_status !== 'submitting' || locked.asset_status !== 'queued') {
        throw conflict('真人素材提交状态已改变', 'REAL_PORTRAIT_UPLOAD_STATE_CONFLICT');
      }
      assertUploadSubmissionAccess(locked);
      await assertRealPortraitActorPlanUsableWithClient(client, userId, locked.plan_access_status, quota);
      await assertGlobalRealPortraitAssetCapacity(client, userId);
      return {
        groupId: locked.provider_group_id!,
        sourceUrl,
        name: deterministicPortraitAssetName(uploadId, locked.kind),
        assetType: 'Image' as const,
        projectName: locked.project_name,
      };
    });
  } catch (error) {
    await failUnsubmittedRealPortraitAsset(prepared, uploadId, objectKey, error);
    throw error;
  }

  let created: Awaited<ReturnType<RealPortraitProvider['createAsset']>>;
  try {
    created = await provider.createAsset(providerInput);
  } catch (error) {
    if (!isSubmissionUnknown(error)) {
      await failUnsubmittedRealPortraitAsset(prepared, uploadId, objectKey, error);
      throw error;
    }
    await pool.query(
      `UPDATE real_portrait_remote_operations
       SET status = 'submission_unknown', last_error_code = $2,
           next_retry_at = NULL, updated_at = now()
       WHERE id = $1 AND status = 'submitting'`,
      [prepared.operationId, safeErrorCode(error)],
    );
    return recoverAmbiguousRealPortraitAssetSubmission(userId, uploadId, provider, now);
  }

  let deliverable: boolean;
  try {
    deliverable = await withTransaction(async client => {
      await acquireCapacityLock(client);
    const quota = await reconcileRealPortraitQuotaWithClient(client, userId, now);
    const locked = await lockRealPortraitUploadSubmissionState(client, userId, uploadId, prepared!.operationId);
    if (!locked) {
      throw Object.assign(new Error('真人素材提交状态不存在，无法保存远端标识'), {
        code: 'REAL_PORTRAIT_CREATE_ASSET_FINALIZE_STATE_MISSING',
      });
    }
    let accessUsable = locked.session_status === 'submitting'
      && locked.operation_status === 'submitting'
      && locked.asset_status === 'queued';
    if (accessUsable) {
      try {
        assertUploadSubmissionAccess(locked);
        await assertRealPortraitActorPlanUsableWithClient(client, userId, locked.plan_access_status, quota);
      } catch {
        accessUsable = false;
      }
    }
    if (accessUsable) {
      const assetUpdated = await client.query(
        `UPDATE real_portrait_assets
         SET provider_asset_id = $2, status = 'processing', updated_at = now()
         WHERE id = $1 AND status = 'queued' AND provider_asset_id IS NULL`,
        [prepared!.assetId, created.assetId],
      );
      const sessionUpdated = await client.query(
        `UPDATE real_portrait_upload_sessions
         SET status = 'processing', updated_at = now()
         WHERE id = $1 AND status = 'submitting'`,
        [uploadId],
      );
      const operationUpdated = await client.query(
        `UPDATE real_portrait_remote_operations
         SET status = 'submitted', next_retry_at = now(), last_error_code = NULL, updated_at = now()
         WHERE id = $1 AND status = 'submitting'`,
        [prepared!.operationId],
      );
      if (!assetUpdated.rowCount || !sessionUpdated.rowCount || !operationUpdated.rowCount) {
        throw Object.assign(new Error('真人素材提交结果无法按预期状态落库'), {
          code: 'REAL_PORTRAIT_CREATE_ASSET_CAS_FAILED',
        });
      }
      return true;
    }

    const assetPersisted = await client.query(
      `UPDATE real_portrait_assets
       SET provider_asset_id = $2, status = 'deleting',
           consistency_status = 'unknown', error_code = NULL, updated_at = now()
       WHERE id = $1
         AND status <> 'deleted'
         AND (provider_asset_id IS NULL OR provider_asset_id = $2)`,
      [prepared!.assetId, created.assetId],
    );
    if (!assetPersisted.rowCount) {
      throw Object.assign(new Error('真人素材远端标识与已保存标识冲突'), {
        code: 'REAL_PORTRAIT_CREATE_ASSET_REMOTE_ID_CONFLICT',
      });
    }
    await client.query(
      `UPDATE real_portrait_upload_sessions
       SET status = 'failed', updated_at = now()
       WHERE id = $1 AND status <> 'active'`,
      [uploadId],
    );
    await client.query(
      `UPDATE real_portrait_remote_operations
       SET status = 'completed', next_retry_at = NULL,
           last_error_code = 'ACCESS_CHANGED_AFTER_SUBMISSION', updated_at = now()
       WHERE id = $1`,
      [prepared!.operationId],
    );
    await client.query(
      `INSERT INTO real_portrait_remote_operations (
         user_id, actor_id, materialization_id, portrait_asset_id,
         operation_type, status, idempotency_key
       ) VALUES ($1, $2, $3, $4, 'late_create_delete_asset', 'prepared', $5)
       ON CONFLICT (idempotency_key) DO UPDATE
       SET status = CASE
             WHEN real_portrait_remote_operations.status = 'completed' THEN 'completed'
             ELSE 'prepared'
           END,
           next_retry_at = CASE
             WHEN real_portrait_remote_operations.status = 'completed' THEN NULL
             ELSE now()
           END,
           updated_at = now()`,
      [
        userId,
        prepared!.actorId,
        prepared!.materializationId,
        prepared!.assetId,
        `late-create-delete:${prepared!.assetId}`,
      ],
    );
    await appendPortraitEvent(client, {
      userId,
      actorId: prepared!.actorId,
      materializationId: prepared!.materializationId,
      eventType: 'asset.discarded_after_access_change',
      initiatorType: 'system',
      metadata: { providerAssetId: created.assetId, requestId: created.requestId },
    });
      return false;
    });
  } catch (error) {
    try {
      deliverable = await persistKnownCreatedRealPortraitAsset({
        userId,
        uploadId,
        prepared,
        providerAssetId: created.assetId,
        providerRequestId: created.requestId,
        now,
      });
    } catch (recoveryError) {
      await pool.query(
        `UPDATE real_portrait_remote_operations
         SET status = 'submission_unknown', next_retry_at = now(),
             last_error_code = $2, updated_at = now()
         WHERE id = $1 AND status = 'submitting'`,
        [prepared.operationId, safeErrorCode(recoveryError)],
      ).catch(() => undefined);
      throw Object.assign(new Error('真人素材远端已创建，但最终状态恢复失败', { cause: error }), {
        code: 'REAL_PORTRAIT_CREATE_ASSET_RECOVERY_PERSIST_FAILED',
      });
    }
  }
  if (!deliverable) {
    throw conflict('真人素材资格已变化，远端素材已隔离并进入清理', 'REAL_PORTRAIT_UPLOAD_NOT_ALLOWED');
  }
  return { asset: await requireOwnedPortraitAsset(userId, prepared.assetId) };
}

interface LockedUploadSubmissionState {
  session_status: string;
  actor_id: string;
  materialization_id: string;
  kind: RealPortraitAssetKind;
  asset_id: string | null;
  actor_lifecycle_status: string;
  plan_access_status: string;
  actor_deleted_at: Date | string | null;
  authorization_status: string;
  authorization_valid_now: boolean;
  materialization_status: string;
  provider_group_id: string | null;
  project_name: string;
  operation_status: string | null;
  asset_status: string | null;
  provider_asset_id: string | null;
}

interface PreparedUploadSubmission {
  assetId: string;
  operationId: string;
  actorId: string;
  materializationId: string;
  groupId: string;
  projectName: string;
  kind: RealPortraitAssetKind;
}

async function lockRealPortraitUploadSubmissionState(
  client: DbClient,
  userId: string,
  uploadId: string,
  operationId?: string,
) {
  const submissionJoins = operationId
    ? `JOIN real_portrait_assets asset ON asset.id = upload_session.asset_id
       JOIN real_portrait_remote_operations operation
         ON operation.id = $3 AND operation.portrait_asset_id = upload_session.asset_id`
    : `LEFT JOIN real_portrait_assets asset ON false
       LEFT JOIN real_portrait_remote_operations operation ON false`;
  const lockedRelations = operationId ? ', asset, operation' : '';
  const result = await client.query<LockedUploadSubmissionState>(
    `SELECT upload_session.status AS session_status, upload_session.actor_id,
            upload_session.materialization_id, upload_session.kind, upload_session.asset_id,
            actor.lifecycle_status AS actor_lifecycle_status, actor.plan_access_status,
            actor.deleted_at AS actor_deleted_at,
            portrait_authorization.status AS authorization_status,
            (portrait_authorization.valid_from <= now()
             AND portrait_authorization.valid_until > now()) AS authorization_valid_now,
            materialization.status AS materialization_status,
            materialization.provider_group_id, materialization.project_name,
            operation.status AS operation_status, asset.status AS asset_status,
            asset.provider_asset_id
     FROM real_portrait_upload_sessions upload_session
     JOIN real_portrait_actors actor ON actor.id = upload_session.actor_id
     JOIN real_portrait_materializations materialization ON materialization.id = upload_session.materialization_id
     JOIN real_portrait_authorizations portrait_authorization
       ON portrait_authorization.id = materialization.authorization_id
     ${submissionJoins}
     WHERE upload_session.id = $1 AND upload_session.user_id = $2
     FOR UPDATE OF upload_session, actor, portrait_authorization, materialization${lockedRelations}`,
    operationId ? [uploadId, userId, operationId] : [uploadId, userId],
  );
  return result.rows[0] ?? null;
}

async function persistKnownCreatedRealPortraitAsset(input: {
  userId: string;
  uploadId: string;
  prepared: PreparedUploadSubmission;
  providerAssetId: string;
  providerRequestId: string | null;
  now: Date;
}) {
  return withTransaction(async client => {
    await acquireCapacityLock(client);
    const quota = await reconcileRealPortraitQuotaWithClient(client, input.userId, input.now);
    const state = await lockRealPortraitUploadSubmissionState(
      client,
      input.userId,
      input.uploadId,
      input.prepared.operationId,
    );
    if (!state) {
      throw Object.assign(new Error('真人素材提交状态不存在，无法恢复远端标识'), {
        code: 'REAL_PORTRAIT_CREATE_ASSET_RECOVERY_STATE_MISSING',
      });
    }
    const awaitingFinalize = state.session_status === 'submitting'
      && state.operation_status === 'submitting'
      && state.asset_status === 'queued';
    const alreadyFinalized = ['processing', 'active'].includes(state.session_status)
      && ['submitted', 'completed'].includes(state.operation_status ?? '')
      && ['processing', 'active'].includes(state.asset_status ?? '')
      && state.provider_asset_id === input.providerAssetId;
    let accessUsable = awaitingFinalize || alreadyFinalized;
    if (accessUsable) {
      try {
        assertUploadSubmissionAccess(state);
        await assertRealPortraitActorPlanUsableWithClient(
          client,
          input.userId,
          state.plan_access_status,
          quota,
        );
      } catch {
        accessUsable = false;
      }
    }
    if (accessUsable && alreadyFinalized) return true;
    if (accessUsable) {
      const assetUpdated = await client.query(
        `UPDATE real_portrait_assets
         SET provider_asset_id = $2, status = 'processing', updated_at = now()
         WHERE id = $1 AND status = 'queued'
           AND (provider_asset_id IS NULL OR provider_asset_id = $2)`,
        [input.prepared.assetId, input.providerAssetId],
      );
      const sessionUpdated = await client.query(
        `UPDATE real_portrait_upload_sessions
         SET status = 'processing', updated_at = now()
         WHERE id = $1 AND status = 'submitting'`,
        [input.uploadId],
      );
      const operationUpdated = await client.query(
        `UPDATE real_portrait_remote_operations
         SET status = 'submitted', next_retry_at = now(),
             last_error_code = NULL, updated_at = now()
         WHERE id = $1 AND status = 'submitting'`,
        [input.prepared.operationId],
      );
      if (!assetUpdated.rowCount || !sessionUpdated.rowCount || !operationUpdated.rowCount) {
        throw Object.assign(new Error('真人素材恢复结果无法按预期状态落库'), {
          code: 'REAL_PORTRAIT_CREATE_ASSET_RECOVERY_CAS_FAILED',
        });
      }
      return true;
    }

    const assetPersisted = await client.query(
      `UPDATE real_portrait_assets
       SET provider_asset_id = $2, status = 'deleting',
           consistency_status = 'unknown', error_code = NULL, updated_at = now()
       WHERE id = $1 AND status <> 'deleted'
         AND (provider_asset_id IS NULL OR provider_asset_id = $2)`,
      [input.prepared.assetId, input.providerAssetId],
    );
    if (!assetPersisted.rowCount) {
      throw Object.assign(new Error('真人素材恢复远端标识与已保存标识冲突'), {
        code: 'REAL_PORTRAIT_CREATE_ASSET_REMOTE_ID_CONFLICT',
      });
    }
    await client.query(
      `UPDATE real_portrait_upload_sessions
       SET status = 'failed', updated_at = now()
       WHERE id = $1 AND status <> 'failed'`,
      [input.uploadId],
    );
    await client.query(
      `UPDATE real_portrait_remote_operations
       SET status = 'completed', next_retry_at = NULL,
           last_error_code = 'ACCESS_CHANGED_AFTER_SUBMISSION', updated_at = now()
       WHERE id = $1`,
      [input.prepared.operationId],
    );
    await client.query(
      `INSERT INTO real_portrait_remote_operations (
         user_id, actor_id, materialization_id, portrait_asset_id,
         operation_type, status, idempotency_key
       ) VALUES ($1, $2, $3, $4, 'late_create_delete_asset', 'prepared', $5)
       ON CONFLICT (idempotency_key) DO UPDATE
       SET status = CASE
             WHEN real_portrait_remote_operations.status = 'completed' THEN 'completed'
             ELSE 'prepared'
           END,
           next_retry_at = CASE
             WHEN real_portrait_remote_operations.status = 'completed' THEN NULL
             ELSE now()
           END,
           updated_at = now()`,
      [
        input.userId,
        input.prepared.actorId,
        input.prepared.materializationId,
        input.prepared.assetId,
        `late-create-delete:${input.prepared.assetId}`,
      ],
    );
    await appendPortraitEvent(client, {
      userId: input.userId,
      actorId: input.prepared.actorId,
      materializationId: input.prepared.materializationId,
      eventType: 'asset.discarded_after_access_change',
      initiatorType: 'system',
      metadata: {
        providerAssetId: input.providerAssetId,
        requestId: input.providerRequestId,
        recoveredAfterFinalizeFailure: true,
      },
    });
    return false;
  });
}

function assertUploadSubmissionAccess(state: LockedUploadSubmissionState) {
  if (state.actor_deleted_at != null) {
    throw conflict('真人档案已删除', 'REAL_PORTRAIT_UPLOAD_NOT_ALLOWED');
  }
  if (state.authorization_status !== 'active'
    || !state.authorization_valid_now) {
    throw conflict('真人授权无效或已过期', 'REAL_PORTRAIT_AUTHORIZATION_INACTIVE');
  }
  if (!['awaiting_upload', 'processing', 'active'].includes(state.actor_lifecycle_status)
    || !['awaiting_upload', 'processing', 'active'].includes(state.materialization_status)
    || !state.provider_group_id) {
    throw conflict('真人档案当前不能提交素材', 'REAL_PORTRAIT_UPLOAD_NOT_ALLOWED');
  }
}

async function readPreparedRealPortraitUpload(userId: string, uploadId: string): Promise<PreparedUploadSubmission> {
  const result = await pool.query<{
    asset_id: string;
    operation_id: string;
    actor_id: string;
    materialization_id: string;
    provider_group_id: string;
    project_name: string;
    kind: RealPortraitAssetKind;
  }>(
    `SELECT upload_session.asset_id, operation.id AS operation_id, upload_session.actor_id,
            upload_session.materialization_id, materialization.provider_group_id,
            materialization.project_name, upload_session.kind
     FROM real_portrait_upload_sessions upload_session
     JOIN real_portrait_materializations materialization
       ON materialization.id = upload_session.materialization_id
     JOIN real_portrait_remote_operations operation
       ON operation.portrait_asset_id = upload_session.asset_id
      AND operation.operation_type = 'create_asset'
     WHERE upload_session.id = $1 AND upload_session.user_id = $2
       AND upload_session.status IN ('uploaded', 'submitting')
     LIMIT 1`,
    [uploadId, userId],
  );
  const row = result.rows[0];
  if (!row?.asset_id || !row.provider_group_id) {
    throw conflict('真人素材上传会话不完整', 'REAL_PORTRAIT_UPLOAD_INVALID');
  }
  return {
    assetId: row.asset_id,
    operationId: row.operation_id,
    actorId: row.actor_id,
    materializationId: row.materialization_id,
    groupId: row.provider_group_id,
    projectName: row.project_name,
    kind: row.kind,
  };
}

function deterministicPortraitAssetName(uploadId: string, kind: RealPortraitAssetKind) {
  return `lindyson-${kind}-${uploadId}`;
}

async function recoverAmbiguousRealPortraitAssetSubmission(
  userId: string,
  uploadId: string,
  provider: RealPortraitProvider,
  now: Date,
) {
  const prepared = await readPreparedRealPortraitUpload(userId, uploadId);
  let listed: Awaited<ReturnType<RealPortraitProvider['listRealPortraitAssets']>>;
  try {
    listed = await provider.listRealPortraitAssets({
      groupId: prepared.groupId,
      name: deterministicPortraitAssetName(uploadId, prepared.kind),
      projectName: prepared.projectName,
      pageSize: 100,
    });
  } catch (error) {
    if (isSubmissionUnknown(error)) {
      await deferCreateAssetLookup(prepared.operationId, error);
      throw conflict('真人素材远端提交结果仍在核对中，请稍后重试', 'REAL_PORTRAIT_CREATE_ASSET_PENDING');
    }
    await markCreateAssetManualReview(prepared.operationId, error);
    throw conflict('真人素材远端提交结果无法自动核对，已转人工复核', 'REAL_PORTRAIT_CREATE_ASSET_MANUAL_REVIEW');
  }
  const expectedName = deterministicPortraitAssetName(uploadId, prepared.kind);
  const matches = listed.items.filter(item => (
    item.name === expectedName
    && item.groupId === prepared.groupId
    && item.projectName === prepared.projectName
    && item.assetType === 'Image'
  ));
  if (listed.totalCount === 0 && matches.length === 0) {
    await deferCreateAssetLookup(prepared.operationId, { code: 'CREATE_ASSET_NOT_VISIBLE_YET' });
    throw conflict('真人素材远端提交结果仍在核对中，请稍后重试', 'REAL_PORTRAIT_CREATE_ASSET_PENDING');
  }
  if (listed.totalCount !== 1 || matches.length !== 1) {
    await markCreateAssetManualReview(prepared.operationId, {
      code: listed.totalCount === 0 ? 'CREATE_ASSET_NOT_FOUND' : 'CREATE_ASSET_AMBIGUOUS',
    });
    throw conflict('真人素材远端提交结果无法唯一确认，已转人工复核', 'REAL_PORTRAIT_CREATE_ASSET_MANUAL_REVIEW');
  }
  const remote = matches[0]!;
  const deliverable = await withTransaction(async client => {
    await acquireCapacityLock(client);
    const quota = await reconcileRealPortraitQuotaWithClient(client, userId, now);
    const state = await lockRealPortraitUploadSubmissionState(client, userId, uploadId, prepared.operationId);
    if (!state || !['submitting', 'uploaded'].includes(state.session_status)
      || !['submitting', 'submission_unknown', 'manual_review', 'prepared'].includes(state.operation_status ?? '')
      || state.asset_status !== 'queued') {
      throw conflict('真人素材恢复状态已改变', 'REAL_PORTRAIT_UPLOAD_STATE_CONFLICT');
    }
    let accessUsable = true;
    try {
      assertUploadSubmissionAccess(state);
      await assertRealPortraitActorPlanUsableWithClient(client, userId, state.plan_access_status, quota);
    } catch {
      accessUsable = false;
    }
    if (accessUsable) {
      await client.query(
        `UPDATE real_portrait_assets
         SET provider_asset_id = $2, status = 'processing', error_code = NULL, updated_at = now()
         WHERE id = $1 AND status = 'queued'`,
        [prepared.assetId, remote.id],
      );
      await client.query(
        `UPDATE real_portrait_upload_sessions SET status = 'processing', updated_at = now()
         WHERE id = $1`,
        [uploadId],
      );
      await client.query(
        `UPDATE real_portrait_remote_operations
         SET status = 'submitted', next_retry_at = now(), last_error_code = NULL, updated_at = now()
         WHERE id = $1`,
        [prepared.operationId],
      );
      return true;
    }
    await client.query(
      `UPDATE real_portrait_assets
       SET provider_asset_id = $2, status = 'deleting', error_code = NULL, updated_at = now()
       WHERE id = $1 AND status = 'queued'`,
      [prepared.assetId, remote.id],
    );
    await client.query(
      `UPDATE real_portrait_upload_sessions SET status = 'failed', updated_at = now() WHERE id = $1`,
      [uploadId],
    );
    await client.query(
      `UPDATE real_portrait_remote_operations
       SET status = 'completed', next_retry_at = NULL,
           last_error_code = 'ACCESS_CHANGED_AFTER_SUBMISSION', updated_at = now()
       WHERE id = $1`,
      [prepared.operationId],
    );
    await client.query(
      `INSERT INTO real_portrait_remote_operations (
         user_id, actor_id, materialization_id, portrait_asset_id,
         operation_type, status, idempotency_key
       ) VALUES ($1, $2, $3, $4, 'late_create_delete_asset', 'prepared', $5)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [userId, prepared.actorId, prepared.materializationId, prepared.assetId, `late-create-delete:${prepared.assetId}`],
    );
    return false;
  });
  if (!deliverable) {
    throw conflict('真人素材资格已变化，远端素材已隔离并进入清理', 'REAL_PORTRAIT_UPLOAD_NOT_ALLOWED');
  }
  return { asset: await requireOwnedPortraitAsset(userId, prepared.assetId) };
}

async function failUnsubmittedRealPortraitAsset(
  prepared: PreparedUploadSubmission,
  uploadId: string,
  objectKey: string,
  error: unknown,
) {
  await withTransaction(async client => {
    await client.query(
      `UPDATE real_portrait_remote_operations
       SET status = 'failed', last_error_code = $2, next_retry_at = NULL, updated_at = now()
       WHERE id = $1`,
      [prepared.operationId, safeErrorCode(error)],
    );
    await client.query(
      `UPDATE real_portrait_assets
       SET status = 'failed', error_code = $2, updated_at = now()
       WHERE id = $1 AND provider_asset_id IS NULL`,
      [prepared.assetId, safeErrorCode(error)],
    );
    await client.query(
      `UPDATE real_portrait_upload_sessions SET status = 'failed', updated_at = now() WHERE id = $1`,
      [uploadId],
    );
    await recomputePortraitLifecycleWithClient(client, prepared.materializationId, prepared.actorId);
    await scheduleObjectDeletion(client, objectKey);
  });
}

async function markCreateAssetManualReview(operationId: string, error: unknown) {
  await withTransaction(async client => {
    const operation = await client.query<{
      user_id: string;
      actor_id: string;
      materialization_id: string | null;
    }>(
      `UPDATE real_portrait_remote_operations
       SET status = 'manual_review', next_retry_at = NULL,
           last_error_code = $2, updated_at = now()
       WHERE id = $1 AND status <> 'completed'
       RETURNING user_id, actor_id, materialization_id`,
      [operationId, safeErrorCode(error)],
    );
    const row = operation.rows[0];
    if (!row?.materialization_id) return;
    const cleanup = await client.query<{ provider_group_id: string }>(
      `SELECT materialization.provider_group_id
       FROM real_portrait_materializations materialization
       JOIN real_portrait_actors actor ON actor.id = materialization.actor_id
       WHERE materialization.id = $1
         AND materialization.status = 'deleting'
         AND materialization.provider_group_id IS NOT NULL
         AND actor.lifecycle_status = 'revoked'
       FOR UPDATE OF materialization, actor`,
      [row.materialization_id],
    );
    if (!cleanup.rows[0]) return;
    await client.query(
      `INSERT INTO real_portrait_remote_operations (
         user_id, actor_id, materialization_id, operation_type,
         status, idempotency_key, attempt_count
       ) VALUES ($1, $2, $3, 'delete_asset_group', 'prepared', $4, 0)
       ON CONFLICT (idempotency_key) DO UPDATE
         SET status = CASE
               WHEN real_portrait_remote_operations.status IN (
                 'submitting', 'submitted', 'submission_unknown'
               ) THEN real_portrait_remote_operations.status
               ELSE 'prepared'
             END,
             next_retry_at = CASE
               WHEN real_portrait_remote_operations.status IN (
                 'submitting', 'submitted', 'submission_unknown'
               ) THEN real_portrait_remote_operations.next_retry_at
               ELSE now()
             END,
             last_error_code = CASE
               WHEN real_portrait_remote_operations.status IN (
                 'submitting', 'submitted', 'submission_unknown'
               ) THEN real_portrait_remote_operations.last_error_code
               ELSE NULL
             END,
             updated_at = now()`,
      [row.user_id, row.actor_id, row.materialization_id, `revoke-group:${row.materialization_id}`],
    );
    await client.query(
      `UPDATE real_portrait_remote_operations
       SET status = 'completed', next_retry_at = NULL,
           last_error_code = 'SUPERSEDED_BY_GROUP_DELETE:' || COALESCE(last_error_code, 'UNKNOWN'),
           updated_at = now()
       WHERE id = $1 AND status = 'manual_review'`,
      [operationId],
    );
  });
}

async function deferCreateAssetLookup(operationId: string, error: unknown) {
  await pool.query(
    `UPDATE real_portrait_remote_operations
     SET status = 'submission_unknown',
         next_retry_at = now() + interval '1 minute',
         last_error_code = $2, updated_at = now()
     WHERE id = $1 AND status <> 'completed'`,
    [operationId, safeErrorCode(error)],
  );
}

export async function processPendingAmbiguousRealPortraitAssetSubmissions(
  limit = 20,
  dependencies: RealPortraitServiceDependencies = {},
) {
  const provider = dependencies.provider ?? getConfiguredRealPortraitProvider();
  const now = dependencies.now?.() ?? new Date();
  await pool.query(
    `UPDATE real_portrait_remote_operations operation
     SET status = 'submission_unknown', next_retry_at = $1,
         last_error_code = COALESCE(operation.last_error_code, 'CREATE_ASSET_FINALIZE_STALE'),
         updated_at = now()
     FROM real_portrait_upload_sessions upload_session,
          real_portrait_assets asset
     WHERE operation.operation_type = 'create_asset'
       AND operation.status = 'submitting'
       AND operation.updated_at < $1::timestamptz - interval '5 minutes'
       AND upload_session.asset_id = operation.portrait_asset_id
       AND upload_session.status = 'submitting'
       AND asset.id = operation.portrait_asset_id
       AND asset.status = 'queued'`,
    [now],
  );
  const candidates = await pool.query<{ user_id: string; upload_id: string }>(
    `SELECT upload_session.user_id, upload_session.id AS upload_id
     FROM real_portrait_remote_operations operation
     JOIN real_portrait_upload_sessions upload_session
       ON upload_session.asset_id = operation.portrait_asset_id
     WHERE operation.operation_type = 'create_asset'
       AND operation.status = 'submission_unknown'
       AND (operation.next_retry_at IS NULL OR operation.next_retry_at <= $1)
       AND upload_session.status = 'submitting'
     ORDER BY operation.next_retry_at ASC NULLS FIRST, operation.created_at, operation.id
     LIMIT $2`,
    [now, limit],
  );
  let recovered = 0;
  for (const candidate of candidates.rows) {
    try {
      await recoverAmbiguousRealPortraitAssetSubmission(
        candidate.user_id,
        candidate.upload_id,
        provider,
        now,
      );
      recovered += 1;
    } catch {
      // helper 已持久化 submission_unknown/manual_review，下一轮只处理可重试状态。
    }
  }
  return { scanned: candidates.rows.length, recovered };
}

export async function deleteRealPortraitAsset(
  userId: string,
  actorId: string,
  portraitAssetId: string,
  dependencies: RealPortraitServiceDependencies = {},
) {
  const prepared = await withTransaction(async client => {
    const result = await client.query<PortraitAssetProviderRow>(
      `SELECT pa.id, pa.provider_asset_id, pa.status, pa.materialization_id,
              m.project_name
       FROM real_portrait_assets pa
       JOIN real_portrait_actors a ON a.id = pa.actor_id
       JOIN real_portrait_materializations m ON m.id = pa.materialization_id
       WHERE pa.id = $1 AND pa.actor_id = $2 AND a.user_id = $3 AND a.deleted_at IS NULL
       FOR UPDATE OF pa`,
      [portraitAssetId, actorId, userId],
    );
    const asset = result.rows[0];
    if (!asset || asset.status === 'deleted') throw notFound('真人素材不存在');
    if (asset.status === 'deleting') {
      return { cleanupPending: true as const };
    }
    if (!asset.provider_asset_id) {
      throw conflict(
        '该素材尚无可核对的供应商标识，必须先完成远端状态核对或撤回整个人像授权',
        'REAL_PORTRAIT_ASSET_REMOTE_STATE_UNKNOWN',
      );
    }
    await client.query(
      `UPDATE real_portrait_assets
       SET status = 'deleting', error_code = NULL, updated_at = now()
       WHERE id = $1`,
      [portraitAssetId],
    );
    const operation = await client.query<{ id: string }>(
      `INSERT INTO real_portrait_remote_operations (
         user_id, actor_id, materialization_id, portrait_asset_id,
         operation_type, status, idempotency_key, attempt_count
       ) VALUES ($1, $2, $3, $4, 'delete_asset', 'submitting', $5, 1)
      RETURNING id`,
      [userId, actorId, asset.materialization_id, portraitAssetId, `delete-asset:${portraitAssetId}`],
    );
    return { ...asset, operationId: operation.rows[0].id, cleanupPending: false as const };
  });
  if (prepared.cleanupPending) {
    return { deleted: true, cleanupPending: true };
  }
  if (prepared.provider_asset_id) {
    try {
      await (dependencies.provider ?? getConfiguredRealPortraitProvider()).deleteAsset(
        prepared.provider_asset_id,
        prepared.project_name,
      );
    } catch (error) {
      await markRemoteOperationFailure(prepared.operationId, error);
      throw error;
    }
  }
  await withTransaction(async client => {
    await client.query(
      `UPDATE real_portrait_assets
       SET status = 'deleted', error_code = NULL,
           remote_deleted_at = now(), updated_at = now()
       WHERE id = $1`,
      [portraitAssetId],
    );
    await client.query(
      `UPDATE real_portrait_remote_operations SET status = 'completed', updated_at = now() WHERE id = $1`,
      [prepared.operationId],
    );
    await recomputePortraitLifecycleWithClient(client, prepared.materialization_id, actorId);
    await appendPortraitEvent(client, {
      userId,
      actorId,
      materializationId: prepared.materialization_id,
      eventType: 'asset.deleted',
      initiatorType: 'user',
      initiatorUserId: userId,
    });
  });
  return { deleted: true, cleanupPending: false };
}

export async function revokeOwnedRealPortraitActor(
  userId: string,
  actorId: string,
  input: { reasonCode?: string },
  dependencies: RealPortraitServiceDependencies = {},
) {
  const cancelled = await cancelUnsubmittedRealPortraitActivation(userId, actorId, input.reasonCode);
  if (cancelled) return { actor: await requireOwnedActor(pool, userId, actorId), cleanupPending: false };
  return revokeRealPortraitAuthorization(userId, actorId, {
    source: 'owner',
    reasonCode: input.reasonCode,
  }, dependencies);
}

async function cancelUnsubmittedRealPortraitActivation(
  userId: string,
  actorId: string,
  reasonCode: string | undefined,
) {
  return withTransaction(async client => {
    const actor = await client.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM real_portrait_actors
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [actorId, userId],
    );
    const lifecycle = actor.rows[0]?.lifecycle_status;
    if (!lifecycle) throw notFound('真人档案不存在');
    if (lifecycle === 'revoked') return true;
    if (lifecycle === 'waiting') {
      await client.query(
        `UPDATE real_portrait_activation_queue SET status = 'cancelled', updated_at = now()
         WHERE actor_id = $1 AND status IN ('waiting', 'promoted')`,
        [actorId],
      );
      await client.query(
        `UPDATE real_portrait_capacity_reservations SET status = 'released', updated_at = now()
         WHERE actor_id = $1 AND status = 'reserved'`,
        [actorId],
      );
      await client.query(
        `UPDATE real_portrait_actors SET lifecycle_status = 'evicted', updated_at = now() WHERE id = $1`,
        [actorId],
      );
      await appendPortraitEvent(client, {
        userId,
        actorId,
        eventType: 'activation.cancelled',
        initiatorType: 'user',
        initiatorUserId: userId,
        metadata: { reasonCode: normalizeReasonCode(reasonCode) },
      });
      return true;
    }
    if (lifecycle !== 'invited') return false;
    const authorization = await client.query<{ id: string; materialization_id: string }>(
      `SELECT portrait_authorization.id, materialization.id AS materialization_id
       FROM real_portrait_authorizations portrait_authorization
       JOIN real_portrait_materializations materialization
         ON materialization.authorization_id = portrait_authorization.id
       WHERE portrait_authorization.actor_id = $1
         AND portrait_authorization.status = 'draft'
       ORDER BY portrait_authorization.version DESC
       LIMIT 1
       FOR UPDATE OF portrait_authorization, materialization`,
      [actorId],
    );
    const row = authorization.rows[0];
    if (!row) return false;
    await client.query(
      `UPDATE real_portrait_authorizations SET status = 'rejected', updated_at = now() WHERE id = $1`,
      [row.id],
    );
    await client.query(
      `UPDATE real_portrait_invites
       SET status = 'cancelled', accepted_at = NULL, updated_at = now()
       WHERE authorization_id = $1 AND status = 'pending'`,
      [row.id],
    );
    await client.query(
      `UPDATE real_portrait_materializations SET status = 'error', updated_at = now() WHERE id = $1`,
      [row.materialization_id],
    );
    await client.query(
      `UPDATE real_portrait_capacity_reservations SET status = 'released', updated_at = now()
       WHERE actor_id = $1 AND status = 'reserved'`,
      [actorId],
    );
    await client.query(
      `UPDATE real_portrait_actors SET lifecycle_status = 'evicted', updated_at = now() WHERE id = $1`,
      [actorId],
    );
    await appendPortraitEvent(client, {
      userId,
      actorId,
      authorizationId: row.id,
      materializationId: row.materialization_id,
      eventType: 'activation.cancelled',
      initiatorType: 'user',
      initiatorUserId: userId,
      metadata: { reasonCode: normalizeReasonCode(reasonCode) },
    });
    return true;
  });
}

async function revokeRealPortraitAuthorization(
  userId: string,
  actorId: string,
  input: { source: 'owner' | 'subject'; reasonCode?: string; manageTokenHash?: string },
  dependencies: RealPortraitServiceDependencies,
) {
  const prepared = await withTransaction(async client => {
    const result = await client.query<{
      authorization_id: string;
      materialization_id: string | null;
      provider_group_id: string | null;
      project_name: string | null;
      has_unsettled_verification: boolean;
      has_unsettled_create_asset: boolean;
      has_manual_review_create_asset: boolean;
    }>(
      `SELECT auth.id AS authorization_id,
              m.id AS materialization_id, m.provider_group_id, m.project_name,
              EXISTS (
                SELECT 1 FROM real_portrait_verification_sessions s
                WHERE s.authorization_id = auth.id
                  AND s.status IN ('submitting', 'submission_unknown', 'invitation_ready', 'waiting')
              ) AS has_unsettled_verification,
              EXISTS (
                SELECT 1 FROM real_portrait_remote_operations operation
                WHERE operation.actor_id = a.id
                  AND operation.operation_type = 'create_asset'
                  AND operation.status IN ('submitting', 'submission_unknown')
              ) AS has_unsettled_create_asset,
              EXISTS (
                SELECT 1 FROM real_portrait_remote_operations operation
                WHERE operation.materialization_id = m.id
                  AND operation.operation_type = 'create_asset'
                  AND operation.status = 'manual_review'
              ) AS has_manual_review_create_asset
       FROM real_portrait_actors a
       JOIN real_portrait_authorizations auth ON auth.actor_id = a.id
       LEFT JOIN real_portrait_materializations m
         ON m.authorization_id = auth.id AND m.status NOT IN ('evicted', 'deleted', 'error')
       WHERE a.id = $1 AND a.user_id = $2 AND a.deleted_at IS NULL
         AND auth.status IN ('pending', 'verified', 'active')
       ORDER BY auth.version DESC, m.generation DESC
       LIMIT 1
       FOR UPDATE OF a, auth`,
      [actorId, userId],
    );
    let row = result.rows[0];
    if (!row) throw notFound('可撤回的真人授权不存在');
    if (row.materialization_id) {
      const materialization = await client.query<{
        id: string;
        provider_group_id: string | null;
        project_name: string;
      }>(
        `SELECT id, provider_group_id, project_name
         FROM real_portrait_materializations
         WHERE id = $1 AND status NOT IN ('evicted', 'deleted', 'error')
         FOR UPDATE`,
        [row.materialization_id],
      );
      const locked = materialization.rows[0];
      row = locked
        ? {
          ...row,
          materialization_id: locked.id,
          provider_group_id: locked.provider_group_id,
          project_name: locked.project_name,
        }
        : {
          ...row,
          materialization_id: null,
          provider_group_id: null,
          project_name: null,
          has_manual_review_create_asset: false,
        };
    }
    const reasonCode = normalizeReasonCode(input.reasonCode);
    await client.query(
      `UPDATE real_portrait_authorizations
       SET status = 'revoked', revoked_at = now(), revoke_source = $2,
           revoke_reason_code = $3, updated_at = now()
       WHERE id = $1`,
      [row.authorization_id, input.source, reasonCode],
    );
    await client.query(
      `UPDATE real_portrait_actors
       SET lifecycle_status = 'revoked', updated_at = now()
       WHERE id = $1`,
      [actorId],
    );
    await client.query(
      `UPDATE real_portrait_invites
       SET status = 'cancelled', accepted_at = NULL, updated_at = now()
       WHERE authorization_id = $1 AND status IN ('pending', 'accepted')`,
      [row.authorization_id],
    );
    await client.query(
      `UPDATE real_portrait_subject_access_tokens
       SET status = 'revoked'
       WHERE authorization_id = $1 AND status = 'active'`,
      [row.authorization_id],
    );
    if (input.manageTokenHash) {
      await client.query(
        `UPDATE real_portrait_subject_access_tokens
         SET last_used_at = now()
         WHERE authorization_id = $1 AND token_hash = $2`,
        [row.authorization_id, input.manageTokenHash],
      );
    }
    const hiddenGeneratedAssetCount = await hideRevokedPortraitGeneratedAssetsWithClient(
      client,
      userId,
      actorId,
    );
    await client.query(
      `UPDATE real_portrait_assets
       SET status = 'deleting', error_code = NULL, updated_at = now()
       WHERE actor_id = $1 AND provider_asset_id IS NOT NULL
         AND status NOT IN ('deleted', 'deleting')`,
      [actorId],
    );
    if (row.materialization_id && row.provider_group_id) {
      await client.query(
        `UPDATE real_portrait_materializations
         SET status = 'deleting', updated_at = now()
         WHERE id = $1`,
        [row.materialization_id],
      );
    } else if (row.materialization_id
        && !row.has_unsettled_verification
        && !row.has_unsettled_create_asset
        && !row.has_manual_review_create_asset) {
      // 数据库要求 deleting/deleted 物化必须已有供应商 Group ID。H5 尚未创建 Group 时
      // 没有远端资源可删除，因此以终态 error 关闭本地预留，保留审计但不继续占用容量。
      await client.query(
        `UPDATE real_portrait_materializations
         SET status = 'error', remote_deleted_at = now(), updated_at = now()
         WHERE id = $1`,
        [row.materialization_id],
      );
    }
    await client.query(
      `UPDATE real_portrait_capacity_reservations
       SET status = 'released', updated_at = now()
       WHERE actor_id = $1 AND status = 'reserved'`,
      [actorId],
    );
    const operation = row.materialization_id && row.provider_group_id && !row.has_unsettled_create_asset
      ? await client.query<{ id: string }>(
        `INSERT INTO real_portrait_remote_operations (
           user_id, actor_id, materialization_id, operation_type,
           status, idempotency_key, attempt_count
         ) VALUES ($1, $2, $3, 'delete_asset_group', 'submitting', $4, 1)
         ON CONFLICT (idempotency_key) DO UPDATE
           SET status = CASE
             WHEN real_portrait_remote_operations.status = 'completed' THEN 'completed'
             ELSE 'submitting'
           END,
               attempt_count = real_portrait_remote_operations.attempt_count + 1,
               updated_at = now()
         RETURNING id`,
        [userId, actorId, row.materialization_id, `revoke-group:${row.materialization_id}`],
      )
      : null;
    if (operation && row.has_manual_review_create_asset) {
      await client.query(
        `UPDATE real_portrait_remote_operations
         SET status = 'completed', next_retry_at = NULL,
             last_error_code = 'SUPERSEDED_BY_GROUP_DELETE:' || COALESCE(last_error_code, 'UNKNOWN'),
             updated_at = now()
         WHERE materialization_id = $1
           AND operation_type = 'create_asset'
           AND status = 'manual_review'`,
        [row.materialization_id],
      );
    }
    await appendPortraitEvent(client, {
      userId,
      actorId,
      authorizationId: row.authorization_id,
      materializationId: row.materialization_id,
      eventType: 'authorization.revoked',
      initiatorType: input.source === 'subject' ? 'subject' : 'user',
      initiatorUserId: input.source === 'owner' ? userId : null,
      metadata: { reasonCode, hiddenGeneratedAssetCount },
    });
    return { ...row, operationId: operation?.rows[0]?.id ?? null };
  });

  let cleanupPending = false;
  if (prepared.materialization_id && prepared.provider_group_id && prepared.project_name && prepared.operationId) {
    try {
      await (dependencies.provider ?? getConfiguredRealPortraitProvider()).deleteAssetGroup(
        prepared.provider_group_id,
        prepared.project_name,
      );
      await withTransaction(async client => {
        await client.query(
          `UPDATE real_portrait_assets
           SET status = 'deleted', error_code = NULL,
               remote_deleted_at = now(), updated_at = now()
           WHERE actor_id = $1 AND provider_asset_id IS NOT NULL AND status = 'deleting'`,
          [actorId],
        );
        await client.query(
          `UPDATE real_portrait_materializations
           SET status = 'deleted', remote_deleted_at = now(), updated_at = now()
           WHERE id = $1`,
          [prepared.materialization_id],
        );
        await client.query(
          `UPDATE real_portrait_remote_operations
           SET status = 'completed', updated_at = now()
           WHERE id = $1`,
          [prepared.operationId],
        );
        await client.query(
          `UPDATE real_portrait_actors
           SET lifecycle_status = 'revoked', updated_at = now()
           WHERE id = $1`,
          [actorId],
        );
      });
    } catch (error) {
      cleanupPending = true;
      await withTransaction(async client => {
        await markRemoteOperationFailureWithClient(client, prepared.operationId!, error);
      });
    }
  } else if (prepared.materialization_id) {
    cleanupPending = prepared.has_unsettled_verification
      || prepared.has_unsettled_create_asset
      || prepared.has_manual_review_create_asset;
  }
  return { actor: await requireOwnedActor(pool, userId, actorId), cleanupPending };
}

/**
 * 本人显式撤回后，Lindyson 可控制的历史成片必须立即 fail closed。
 *
 * 这里不修改生成任务和真人引用快照，它们仍作为不可变审计事实保留；仅把由该演员
 * 生成且仍在站内可用的资产交给现有对象删除 outbox。deletion_status 会在本事务内
 * 变为 deleting，因此资产列表、详情、下载、管理员下载及后续参考复用都会立即拒绝。
 * 第三方已经下载或发布的副本不在本站对象存储范围内，不会被此流程自动召回。
 *
 * 自然到期不会调用本函数，历史成片仍由套餐 assetRetentionDays 统一清理。
 */
async function hideRevokedPortraitGeneratedAssetsWithClient(
  client: DbClient,
  userId: string,
  actorId: string,
) {
  const targets = await client.query<{ id: string; user_id: string }>(
    `SELECT DISTINCT asset.id, asset.user_id
     FROM generation_real_portrait_references reference
     JOIN generation_tasks task
       ON task.id = reference.task_id AND task.user_id = $1
     JOIN assets asset
       ON asset.id = task.asset_id AND asset.user_id = task.user_id
     WHERE reference.actor_id = $2
       AND asset.deletion_status = 'active'
     ORDER BY asset.id`,
    [userId, actorId],
  );
  if (!targets.rowCount) return 0;
  return scheduleSystemAssetDeletion(
    client,
    targets.rows.map(target => ({ id: target.id, userId: target.user_id })),
  );
}

export async function selectRealPortraitQuotaActors(
  userId: string,
  input: { retainedActorIds: string[]; activeActorIds: string[] },
) {
  const retainedActorIds = uniqueIds(input.retainedActorIds);
  const activeActorIds = uniqueIds(input.activeActorIds);
  if (activeActorIds.some(id => !retainedActorIds.includes(id))) {
    throw badRequest('活跃真人必须同时位于保留名单中', 'REAL_PORTRAIT_QUOTA_SELECTION_INVALID');
  }
  return withTransaction(async client => {
    const quota = await reconcileRealPortraitQuotaWithClient(client, userId);
    const quotaState = await client.query<{
      grace_status: string;
      grace_until: Date | string | null;
      selection_open: boolean;
    }>(
      `SELECT grace_status, grace_until,
              (grace_status IN ('active', 'reconciling') AND grace_until > now()) AS selection_open
       FROM user_portrait_quota_states
       WHERE user_id = $1
       FOR UPDATE`,
      [userId],
    );
    const grace = quotaState.rows[0];
    if (!grace?.selection_open) {
      throw conflict(
        '真人档案保留名单仅能在套餐降级宽限期内设置；正常换人请先释放现有真人容量',
        'REAL_PORTRAIT_QUOTA_SELECTION_NOT_ALLOWED',
      );
    }
    const actors = await client.query<{ id: string; active_eligible: boolean }>(
      `SELECT actor.id,
              (
                actor.lifecycle_status IN (
                  'waiting', 'invited', 'verifying', 'awaiting_upload',
                  'processing', 'active', 'eviction_warning'
                )
                OR EXISTS (
                  SELECT 1 FROM real_portrait_materializations materialization
                  WHERE materialization.actor_id = actor.id
                    AND materialization.provider_group_id IS NOT NULL
                    AND materialization.remote_deleted_at IS NULL
                )
                OR EXISTS (
                  SELECT 1 FROM real_portrait_capacity_reservations reservation
                  WHERE reservation.actor_id = actor.id
                    AND reservation.status = 'reserved'
                    AND reservation.expires_at > now()
                )
                OR EXISTS (
                  SELECT 1 FROM real_portrait_activation_queue queue
                  WHERE queue.actor_id = actor.id AND queue.status IN ('waiting', 'promoted')
                )
              )
              AND actor.lifecycle_status NOT IN ('draft', 'revoked', 'expired', 'evicted', 'deleting')
              AS active_eligible
       FROM real_portrait_actors actor
       WHERE actor.user_id = $1 AND actor.deleted_at IS NULL
       FOR UPDATE OF actor`,
      [userId],
    );
    const ownedIds = new Set(actors.rows.map(row => row.id));
    if (retainedActorIds.some(id => !ownedIds.has(id))) {
      throw badRequest('保留名单包含不存在的真人档案', 'REAL_PORTRAIT_QUOTA_SELECTION_INVALID');
    }
    if (quota.profileLimit !== null && retainedActorIds.length > quota.profileLimit) {
      throw conflict('保留名单超过当前套餐档案额度', 'REAL_PORTRAIT_PROFILE_QUOTA_EXCEEDED');
    }
    if (activeActorIds.length > quota.activeLimit) {
      throw conflict('活跃名单超过当前套餐活跃额度', 'REAL_PORTRAIT_ACTIVE_QUOTA_EXCEEDED');
    }
    const activeEligibleIds = new Set(actors.rows.filter(row => row.active_eligible).map(row => row.id));
    if (activeActorIds.some(id => !activeEligibleIds.has(id))) {
      throw badRequest(
        '活跃名单只能包含当前正在排队、认证、处理或仍有远端驻留资源的真人',
        'REAL_PORTRAIT_QUOTA_SELECTION_INVALID',
      );
    }
    const saved = await client.query(
      `UPDATE user_portrait_quota_states
       SET retained_actor_ids = $2::jsonb,
           active_actor_ids = $3::jsonb,
           grace_status = 'reconciling',
           updated_at = now()
       WHERE user_id = $1
         AND grace_status IN ('active', 'reconciling')
         AND grace_until > now()
       RETURNING user_id`,
      [userId, JSON.stringify(retainedActorIds), JSON.stringify(activeActorIds)],
    );
    if (!saved.rowCount) {
      throw conflict('套餐降级宽限期已经结束，请刷新后查看处理结果', 'REAL_PORTRAIT_QUOTA_SELECTION_NOT_ALLOWED');
    }
    await appendPortraitEvent(client, {
      userId,
      eventType: 'quota.selection_saved',
      initiatorType: 'user',
      initiatorUserId: userId,
      metadata: { retainedActorIds, activeActorIds },
    });
    const counts = await readCapacityCounts(client, userId);
    const state = await client.query<QuotaStateRow>(
      `SELECT * FROM user_portrait_quota_states WHERE user_id = $1`,
      [userId],
    );
    return { capacity: mapCapacityDto(quota, counts, state.rows[0] ?? null) };
  });
}

export async function resolveRealPortraitGenerationReferenceWithClient(
  client: DbClient,
  userId: string,
  input: { actorId: string; portraitAssetId?: string; kind?: RealPortraitAssetKind },
): Promise<RealPortraitGenerationReference> {
  await reconcileRealPortraitQuotaWithClient(client, userId);
  const kind = input.kind ?? 'primary';
  const result = await client.query<GenerationReferenceRow>(
    `SELECT a.id AS actor_id, auth.id AS authorization_id, auth.version AS authorization_version,
            m.id AS materialization_id, m.project_name,
            pa.id AS portrait_asset_id, pa.provider_asset_id
     FROM real_portrait_actors a
     JOIN user_portrait_quota_states qs ON qs.user_id = a.user_id
     JOIN real_portrait_authorizations auth ON auth.actor_id = a.id
     JOIN real_portrait_materializations m
       ON m.actor_id = a.id AND m.authorization_id = auth.id
     JOIN real_portrait_assets primary_asset
       ON primary_asset.materialization_id = m.id
      AND primary_asset.actor_id = a.id
      AND primary_asset.kind = 'primary'
      AND primary_asset.status = 'active'
      AND primary_asset.consistency_status = 'passed'
      AND primary_asset.provider_asset_id IS NOT NULL
      AND primary_asset.remote_deleted_at IS NULL
     JOIN real_portrait_assets pa ON pa.materialization_id = m.id AND pa.actor_id = a.id
     WHERE a.id = $1 AND a.user_id = $2 AND a.deleted_at IS NULL
       AND (
         (a.plan_access_status = 'available' AND qs.portrait_enabled)
         OR (
           a.plan_access_status = 'grace'
           AND qs.grace_status IN ('active', 'reconciling')
           AND qs.grace_until > clock_timestamp()
         )
       )
       AND a.lifecycle_status = 'active'
       AND auth.status = 'active'
       AND auth.valid_from <= clock_timestamp() AND auth.valid_until > clock_timestamp()
       AND m.status = 'active' AND m.provider_group_id IS NOT NULL
       AND (($3::uuid IS NOT NULL AND pa.id = $3::uuid) OR ($3::uuid IS NULL AND pa.kind = $4))
       AND pa.status = 'active'
       AND pa.consistency_status = 'passed' AND pa.provider_asset_id IS NOT NULL
     ORDER BY auth.version DESC, m.generation DESC
     LIMIT 1
     FOR SHARE OF a, auth, m, primary_asset, pa`,
    [input.actorId, userId, input.portraitAssetId ?? null, kind],
  );
  const row = result.rows[0];
  if (!row || !row.provider_asset_id) {
    throw conflict('真人素材未就绪、授权已失效或不属于当前账号', 'REAL_PORTRAIT_REFERENCE_UNAVAILABLE');
  }
  return mapGenerationReference(row);
}

export async function bindRealPortraitGenerationReferenceWithClient(
  client: DbClient,
  input: {
    taskId: string;
    taskAttempt: number;
    position: number;
    reference: RealPortraitGenerationReference;
  },
) {
  const result = await client.query(
    `INSERT INTO generation_real_portrait_references (
       task_id, task_attempt, position, actor_id, authorization_id,
       materialization_id, portrait_asset_id, authorization_version,
       provider_asset_id_snapshot
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (task_id, task_attempt, position) DO UPDATE
       SET actor_id = EXCLUDED.actor_id,
           authorization_id = EXCLUDED.authorization_id,
           materialization_id = EXCLUDED.materialization_id,
           portrait_asset_id = EXCLUDED.portrait_asset_id,
           authorization_version = EXCLUDED.authorization_version,
           provider_asset_id_snapshot = EXCLUDED.provider_asset_id_snapshot
     WHERE generation_real_portrait_references.actor_id = EXCLUDED.actor_id
       AND generation_real_portrait_references.authorization_id = EXCLUDED.authorization_id
       AND generation_real_portrait_references.materialization_id = EXCLUDED.materialization_id
       AND generation_real_portrait_references.portrait_asset_id = EXCLUDED.portrait_asset_id
       AND generation_real_portrait_references.authorization_version = EXCLUDED.authorization_version
       AND generation_real_portrait_references.provider_asset_id_snapshot = EXCLUDED.provider_asset_id_snapshot
     RETURNING task_id`,
    [
      input.taskId,
      input.taskAttempt,
      input.position,
      input.reference.actorId,
      input.reference.authorizationId,
      input.reference.materializationId,
      input.reference.portraitAssetId,
      input.reference.authorizationVersion,
      input.reference.providerAssetId,
    ],
  );
  if (!result.rowCount) {
    throw conflict('生成任务真人素材快照与已有记录冲突', 'REAL_PORTRAIT_REFERENCE_BIND_CONFLICT');
  }
}

export async function assertRealPortraitGenerationReferenceStillUsableWithClient(
  client: DbClient,
  taskId: string,
  attempt: number,
) {
  const task = await client.query<{ user_id: string; count: number | string }>(
    `SELECT task.user_id,
            count(ref.*)::integer AS count
     FROM generation_tasks task
     LEFT JOIN generation_real_portrait_references ref
       ON ref.task_id = task.id AND ref.task_attempt = $2
     WHERE task.id = $1
     GROUP BY task.user_id`,
    [taskId, attempt],
  );
  const expectedCount = toInt(task.rows[0]?.count);
  if (expectedCount === 0) return [];
  await reconcileRealPortraitQuotaWithClient(client, task.rows[0].user_id);
  const result = await client.query<GenerationReferenceRow & { position: number | string }>(
    `SELECT ref.position, ref.actor_id, ref.authorization_id,
            ref.authorization_version, ref.materialization_id, ref.portrait_asset_id,
            ref.provider_asset_id_snapshot AS provider_asset_id, m.project_name
     FROM generation_real_portrait_references ref
     JOIN generation_tasks task ON task.id = ref.task_id
     JOIN real_portrait_actors a ON a.id = ref.actor_id AND a.user_id = task.user_id
     JOIN user_portrait_quota_states qs ON qs.user_id = task.user_id
     JOIN real_portrait_authorizations auth
       ON auth.id = ref.authorization_id AND auth.actor_id = ref.actor_id
      AND auth.version = ref.authorization_version
     JOIN real_portrait_materializations m
       ON m.id = ref.materialization_id AND m.actor_id = ref.actor_id
      AND m.authorization_id = ref.authorization_id
     JOIN real_portrait_assets primary_asset
       ON primary_asset.materialization_id = ref.materialization_id
      AND primary_asset.actor_id = ref.actor_id
      AND primary_asset.kind = 'primary'
      AND primary_asset.status = 'active'
      AND primary_asset.consistency_status = 'passed'
      AND primary_asset.provider_asset_id IS NOT NULL
      AND primary_asset.remote_deleted_at IS NULL
     JOIN real_portrait_assets pa
       ON pa.id = ref.portrait_asset_id AND pa.actor_id = ref.actor_id
      AND pa.materialization_id = ref.materialization_id
     WHERE ref.task_id = $1 AND ref.task_attempt = $2
       AND a.deleted_at IS NULL
       AND (
         (a.plan_access_status = 'available' AND qs.portrait_enabled)
         OR (
           a.plan_access_status = 'grace'
           AND qs.grace_status IN ('active', 'reconciling')
           AND qs.grace_until > now()
         )
       )
       AND a.lifecycle_status = 'active'
       AND auth.status = 'active' AND auth.valid_from <= now() AND auth.valid_until > now()
       AND m.status = 'active'
       AND pa.status = 'active' AND pa.consistency_status = 'passed'
       AND pa.provider_asset_id = ref.provider_asset_id_snapshot
     ORDER BY ref.position
     FOR SHARE OF a, auth, m, primary_asset, pa`,
    [taskId, attempt],
  );
  if (result.rows.length !== expectedCount) {
    throw conflict('真人授权或素材在提交前已失效', 'REAL_PORTRAIT_REFERENCE_REVOKED');
  }
  return result.rows.map(mapGenerationReference);
}

/**
 * 供应商任务已经提交后只重验本人授权，不再重验套餐权益或素材容量。
 * 套餐降级只影响新的提交；撤回或到期属于持续有效的隐私交付边界。
 *
 * 对授权行加共享锁，使本次判定与撤回事务形成可线性化顺序：
 * 要么撤回先提交并阻止交付，要么本次交付先完成后撤回生效。
 */
export async function getRealPortraitGenerationDeliveryDecisionWithClient(
  client: DbClient,
  taskId: string,
  attempt: number,
): Promise<RealPortraitGenerationDeliveryDecision> {
  const result = await client.query<{
    authorization_status: string;
    authorization_valid_now: boolean;
    actor_lifecycle_status: string;
    actor_deleted_at: Date | string | null;
  }>(
    `SELECT auth.status AS authorization_status,
            (auth.valid_from <= now() AND auth.valid_until > now()) AS authorization_valid_now,
            actor.lifecycle_status AS actor_lifecycle_status,
            actor.deleted_at AS actor_deleted_at
     FROM generation_real_portrait_references ref
     JOIN generation_tasks task ON task.id = ref.task_id
     JOIN real_portrait_actors actor
       ON actor.id = ref.actor_id AND actor.user_id = task.user_id
     JOIN real_portrait_authorizations auth
       ON auth.id = ref.authorization_id AND auth.actor_id = ref.actor_id
      AND auth.version = ref.authorization_version
     WHERE ref.task_id = $1 AND ref.task_attempt = $2
     ORDER BY ref.position
     FOR SHARE OF auth`,
    [taskId, attempt],
  );
  if (!result.rowCount) return { hasReferences: false, allowed: true, reason: null };

  for (const row of result.rows) {
    if (
      row.authorization_status === 'revoked'
      || row.actor_lifecycle_status === 'revoked'
      || row.actor_deleted_at !== null
    ) {
      return { hasReferences: true, allowed: false, reason: 'authorization-revoked' };
    }
    if (
      !row.authorization_valid_now
      || row.authorization_status === 'expired'
      || row.actor_lifecycle_status === 'expired'
    ) {
      return { hasReferences: true, allowed: false, reason: 'authorization-expired' };
    }
    if (row.authorization_status !== 'active') {
      return { hasReferences: true, allowed: false, reason: 'authorization-inactive' };
    }
  }
  return { hasReferences: true, allowed: true, reason: null };
}

export async function markRealPortraitGenerationSucceededWithClient(
  client: DbClient,
  taskId: string,
  attempt: number,
  usedAt = new Date(),
) {
  await client.query(
    `UPDATE generation_real_portrait_references
     SET use_started_at = COALESCE(use_started_at, $3)
     WHERE task_id = $1 AND task_attempt = $2`,
    [taskId, attempt, usedAt],
  );
  await client.query(
    `UPDATE real_portrait_materializations m
     SET last_used_at = $3, updated_at = now()
     FROM generation_real_portrait_references ref
     WHERE ref.task_id = $1 AND ref.task_attempt = $2 AND ref.materialization_id = m.id`,
    [taskId, attempt, usedAt],
  );
  await client.query(
    `UPDATE real_portrait_actors a
     SET last_successful_generation_at = $3, updated_at = now()
     FROM generation_real_portrait_references ref
     WHERE ref.task_id = $1 AND ref.task_attempt = $2 AND ref.actor_id = a.id`,
    [taskId, attempt, usedAt],
  );
}

export async function reconcileRealPortraitQuota(userId: string, now = new Date()) {
  return withTransaction(client => reconcileRealPortraitQuotaWithClient(client, userId, now));
}

/** 先结算订阅到期，再返回当前真正生效的真人库权益。 */
export async function resolveEffectivePlanEntitlements(userId: string, now = new Date()) {
  return withTransaction(client => reconcileRealPortraitQuotaWithClient(client, userId, now));
}

export async function reconcileRealPortraitQuotaWithClient(
  client: DbClient,
  userId: string,
  now = new Date(),
): Promise<RealPortraitQuota> {
  await reconcileSubscriptionWithClient(client, userId, now);
  const lockedUser = await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
  if (!lockedUser.rowCount) throw notFound('用户不存在');
  const entitlements = await getPortraitEntitlementsForUser(client, userId);
  if (!entitlements) throw notFound('用户不存在');
  const next: RealPortraitQuota = {
    enabled: entitlements.portraitEnabled,
    profileLimit: entitlements.portraitProfileLimit,
    activeLimit: entitlements.portraitActiveLimit,
    assetsPerActor: requireAssetLimit(entitlements.portraitAssetsPerActor),
    sourcePlanId: entitlements.sourcePlanId,
    sourcePlanCode: entitlements.sourcePlanCode,
    sourcePlanName: entitlements.sourcePlanName,
  };
  const stateResult = await client.query<QuotaStateRow>(
    `SELECT * FROM user_portrait_quota_states WHERE user_id = $1 FOR UPDATE`,
    [userId],
  );
  const current = stateResult.rows[0];
  if (!current) {
    await client.query(
      `INSERT INTO user_portrait_quota_states (
         user_id, source_plan_id, portrait_enabled, profile_limit,
         active_limit, assets_per_actor
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        next.sourcePlanId,
        next.enabled,
        next.profileLimit,
        next.activeLimit,
        next.assetsPerActor,
      ],
    );
    return next;
  }
  if (sameQuota(current, next)) return next;

  const usage = await client.query<{ profiles: number | string; active: number | string; max_assets: number | string }>(
    `SELECT
       count(*) FILTER (WHERE actor.deleted_at IS NULL)::integer AS profiles,
       count(*) FILTER (
         WHERE actor.deleted_at IS NULL
           AND (
             actor.lifecycle_status IN ('waiting', 'invited', 'verifying', 'awaiting_upload', 'processing', 'active', 'eviction_warning')
             OR EXISTS (
               SELECT 1 FROM real_portrait_materializations materialization
               WHERE materialization.actor_id = actor.id
                 AND materialization.provider_group_id IS NOT NULL
                 AND materialization.remote_deleted_at IS NULL
             )
             OR EXISTS (
               SELECT 1 FROM real_portrait_capacity_reservations reservation
               WHERE reservation.actor_id = actor.id
                 AND reservation.status = 'reserved' AND reservation.expires_at > now()
             )
             OR EXISTS (
               SELECT 1 FROM real_portrait_activation_queue queue
               WHERE queue.actor_id = actor.id AND queue.status IN ('waiting', 'promoted')
             )
           )
       )::integer AS active,
       COALESCE((
         SELECT max(asset_count)
         FROM (
           SELECT count(*)::integer AS asset_count
           FROM real_portrait_assets asset
           JOIN real_portrait_actors owner ON owner.id = asset.actor_id
           WHERE owner.user_id = $1 AND owner.deleted_at IS NULL
             AND asset.remote_deleted_at IS NULL AND asset.provider_asset_id IS NOT NULL
           GROUP BY asset.actor_id
         ) actor_assets
       ), 0)::integer AS max_assets
     FROM real_portrait_actors actor
     WHERE actor.user_id = $1`,
    [userId],
  );
  const overProfile = next.profileLimit !== null && toInt(usage.rows[0]?.profiles) > next.profileLimit;
  const overActive = toInt(usage.rows[0]?.active) > next.activeLimit;
  const overAssets = toInt(usage.rows[0]?.max_assets) > next.assetsPerActor;
  const entitlementDecreased = portraitEntitlementsDecreased(current, next);
  const graceAlreadyActive = ['active', 'reconciling'].includes(current.grace_status);
  const needsGrace = entitlementDecreased || (graceAlreadyActive && (overProfile || overActive || overAssets));
  const graceUntil = needsGrace
    ? graceAlreadyActive && current.grace_until
      ? new Date(current.grace_until)
      : addDays(now, QUOTA_GRACE_DAYS)
    : null;
  await client.query(
    `UPDATE user_portrait_quota_states
     SET source_plan_id = $2,
         portrait_enabled = $3,
         profile_limit = $4,
         active_limit = $5,
         assets_per_actor = $6,
         grace_status = $7,
         grace_until = $8,
         retained_actor_ids = CASE WHEN $7 = 'active' THEN retained_actor_ids ELSE '[]'::jsonb END,
         active_actor_ids = CASE WHEN $7 = 'active' THEN active_actor_ids ELSE '[]'::jsonb END,
         updated_at = now()
     WHERE user_id = $1`,
    [
      userId,
      next.sourcePlanId,
      next.enabled,
      next.profileLimit,
      next.activeLimit,
      next.assetsPerActor,
      needsGrace ? 'active' : 'none',
      graceUntil,
    ],
  );
  await client.query(
    `UPDATE real_portrait_actors
     SET plan_access_status = $2,
         locked_at = CASE WHEN $2 = 'plan_locked' THEN COALESCE(locked_at, now()) ELSE NULL END,
         updated_at = now()
     WHERE user_id = $1 AND deleted_at IS NULL`,
    [userId, needsGrace ? 'grace' : next.enabled ? 'available' : 'plan_locked'],
  );
  await client.query(
    `INSERT INTO portrait_entitlement_reconcile_outbox (
       user_id, event_key, reason, old_entitlements, new_entitlements, effective_at
     ) VALUES ($1, $2, 'plan-entitlement-changed', $3::jsonb, $4::jsonb, $5)
     ON CONFLICT (event_key) DO NOTHING`,
    [
      userId,
      `portrait-quota:${userId}:${randomUUID()}`,
      JSON.stringify(mapStoredQuota(current)),
      JSON.stringify(next),
      now,
    ],
  );
  return next;
}

function actorSelectSql(where: string, orderBy = 'a.created_at DESC, a.id DESC') {
  return `SELECT a.id, a.alias, a.plan_access_status, a.lifecycle_status,
                 a.last_successful_generation_at, a.created_at, a.updated_at,
                 latest_auth.status AS authorization_status,
                 latest_auth.valid_until AS authorization_expires_at,
                 COALESCE(
                   jsonb_agg(
                     jsonb_build_object(
                       'id', pa.id,
                       'kind', pa.kind,
                       'status', pa.status,
                       'consistencyStatus', pa.consistency_status,
                       'thumbnailAvailable', pa.thumbnail_ready
                     ) ORDER BY CASE pa.kind WHEN 'primary' THEN 0 ELSE 1 END, pa.created_at
                   ) FILTER (WHERE pa.id IS NOT NULL AND pa.status <> 'deleted'),
                   '[]'::jsonb
                 ) AS assets
          FROM real_portrait_actors a
          LEFT JOIN LATERAL (
            SELECT status, valid_until
            FROM real_portrait_authorizations
            WHERE actor_id = a.id
            ORDER BY version DESC
            LIMIT 1
          ) latest_auth ON true
          LEFT JOIN real_portrait_assets pa ON pa.actor_id = a.id
          WHERE ${where}
          GROUP BY a.id, latest_auth.status, latest_auth.valid_until
          ORDER BY ${orderBy}`;
}

async function findOwnedActor(client: DbClient, userId: string, actorId: string) {
  const result = await client.query<ActorRow>(actorSelectSql(
    'a.id = $1 AND a.user_id = $2 AND a.deleted_at IS NULL',
  ), [actorId, userId]);
  return result.rows[0] ? mapActorRow(result.rows[0]) : null;
}

async function requireOwnedActor(client: DbClient, userId: string, actorId: string) {
  const actor = await findOwnedActor(client, userId, actorId);
  if (!actor) throw notFound('真人档案不存在');
  return actor;
}

function mapActorRow(row: ActorRow): RealPortraitActor {
  const assets = Array.isArray(row.assets) ? row.assets : [];
  return {
    id: row.id,
    alias: row.alias,
    planAccessStatus: row.plan_access_status,
    lifecycleStatus: row.lifecycle_status,
    authorizationStatus: row.authorization_status ?? 'none',
    authorizationExpiresAt: toIsoDateTime(row.authorization_expires_at),
    lastSuccessfulGenerationAt: toIsoDateTime(row.last_successful_generation_at),
    createdAt: toIsoDateTime(row.created_at)!,
    updatedAt: toIsoDateTime(row.updated_at)!,
    assets: assets.map(value => {
      const asset = value as Record<string, unknown>;
      return {
        id: String(asset.id),
        kind: asset.kind as RealPortraitAsset['kind'],
        status: asset.status as RealPortraitAsset['status'],
        consistencyStatus: asset.consistencyStatus as RealPortraitAsset['consistencyStatus'],
        thumbnailAvailable: asset.thumbnailAvailable === true,
      };
    }),
  };
}

async function readCapacityCounts(client: DbClient, userId: string): Promise<CapacityCountRow> {
  const result = await client.query<CapacityCountRow>(
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
       (SELECT count(*) FROM real_portrait_actors
        WHERE user_id = $1 AND deleted_at IS NULL)::integer AS profiles,
       (SELECT count(*) FROM real_portrait_actors
        WHERE user_id = $1 AND deleted_at IS NULL
          AND (
            lifecycle_status IN ('waiting', 'invited', 'verifying', 'awaiting_upload', 'processing', 'active', 'eviction_warning')
            OR EXISTS (
              SELECT 1 FROM real_portrait_materializations materialization
              WHERE materialization.actor_id = real_portrait_actors.id
                AND materialization.provider_group_id IS NOT NULL
                AND materialization.remote_deleted_at IS NULL
            )
            OR EXISTS (
              SELECT 1 FROM real_portrait_capacity_reservations reservation
              WHERE reservation.actor_id = real_portrait_actors.id
                AND reservation.status = 'reserved' AND reservation.expires_at > now()
            )
            OR EXISTS (
              SELECT 1 FROM real_portrait_activation_queue queue
              WHERE queue.actor_id = real_portrait_actors.id
                AND queue.status IN ('waiting', 'promoted')
            )
          ))::integer AS active,
       (SELECT count(*) FROM real_portrait_activation_queue
        WHERE user_id = $1 AND status = 'waiting')::integer AS queued,
       COALESCE((SELECT sum(remote.count) FROM remote_group_slots remote), 0)::integer AS groups_used,
       COALESCE((SELECT sum(remote.count) FROM remote_asset_slots remote), 0)::integer AS assets_used,
       (
         COALESCE((SELECT sum(pending.count) FROM pending_group_slots pending), 0)
         + COALESCE((
         SELECT sum(GREATEST(r.group_slots - (
           COALESCE((
             SELECT remote.count FROM remote_group_slots remote
             WHERE remote.actor_id = r.actor_id
           ), 0)
           + COALESCE((
             SELECT pending.count FROM pending_group_slots pending
             WHERE pending.actor_id = r.actor_id
           ), 0)
         ), 0))
         FROM real_portrait_capacity_reservations r
         WHERE r.status = 'reserved' AND r.expires_at > now()
       ), 0)
       )::integer AS groups_reserved,
       (
         COALESCE((SELECT sum(pending.count) FROM pending_asset_slots pending), 0)
         + COALESCE((
         SELECT sum(GREATEST(r.asset_slots - (
           COALESCE((
             SELECT remote.count FROM remote_asset_slots remote
             WHERE remote.actor_id = r.actor_id
           ), 0)
           + COALESCE((
             SELECT pending.count FROM pending_asset_slots pending
             WHERE pending.actor_id = r.actor_id
           ), 0)
         ), 0))
         FROM real_portrait_capacity_reservations r
         WHERE r.status = 'reserved' AND r.expires_at > now()
       ), 0)
       )::integer AS assets_reserved`,
    [userId],
  );
  return result.rows[0] ?? {
    profiles: 0,
    active: 0,
    queued: 0,
    groups_used: 0,
    assets_used: 0,
    groups_reserved: 0,
    assets_reserved: 0,
  };
}

async function assertGlobalRealPortraitAssetCapacity(client: DbClient, userId: string) {
  const counts = await readCapacityCounts(client, userId);
  const snapshot = capacitySnapshot(counts);
  if (snapshot.residentAssets + snapshot.heldAssetSlots > snapshot.assetSoftLimit) {
    throw conflict('真人素材共享容量暂时不足，请稍后重试', 'REAL_PORTRAIT_CAPACITY_WAIT');
  }
}

function capacitySnapshot(counts: CapacityCountRow): RealPortraitCapacitySnapshot {
  return {
    residentGroups: toInt(counts.groups_used),
    residentAssets: toInt(counts.assets_used),
    heldGroupSlots: toInt(counts.groups_reserved),
    heldAssetSlots: toInt(counts.assets_reserved),
    groupSoftLimit: env.REAL_PORTRAIT_GROUP_SOFT_LIMIT,
    assetSoftLimit: env.REAL_PORTRAIT_ASSET_SOFT_LIMIT,
  };
}

function mapCapacityDto(
  quota: RealPortraitQuota,
  counts: CapacityCountRow,
  state: QuotaStateRow | null,
): RealPortraitCapacityDto {
  if (!quota.sourcePlanCode || !quota.sourcePlanName) {
    throw Object.assign(new Error('真人素材库套餐来源信息缺失'), {
      statusCode: 500,
      code: 'REAL_PORTRAIT_ENTITLEMENT_INVALID',
    });
  }
  return {
    sourcePlanCode: quota.sourcePlanCode,
    sourcePlanName: quota.sourcePlanName,
    entitlements: {
      enabled: quota.enabled,
      profileLimit: quota.profileLimit,
      activeLimit: quota.activeLimit,
      assetsPerActor: quota.assetsPerActor,
    },
    usage: {
      profiles: toInt(counts.profiles),
      active: toInt(counts.active),
      queued: toInt(counts.queued),
    },
    global: {
      groupSoftLimit: env.REAL_PORTRAIT_GROUP_SOFT_LIMIT,
      assetSoftLimit: env.REAL_PORTRAIT_ASSET_SOFT_LIMIT,
      groupsUsed: toInt(counts.groups_used),
      assetsUsed: toInt(counts.assets_used),
      groupsReserved: toInt(counts.groups_reserved),
      assetsReserved: toInt(counts.assets_reserved),
    },
    quotaState: state ? {
      graceStatus: state.grace_status,
      graceUntil: toIsoDateTime(state.grace_until),
      retainedActorIds: parseIdArray(state.retained_actor_ids),
      activeActorIds: parseIdArray(state.active_actor_ids),
    } : null,
  };
}

async function findInviteByToken(token: string) {
  const tokenHash = fingerprintRealPortraitSecret(token);
  const result = await pool.query<PublicInviteRow>(publicInviteSql(), [tokenHash]);
  const invite = result.rows[0];
  if (!invite) throw notFound('邀请不存在或已失效');
  return invite;
}

async function lockInviteByToken(client: DbClient, token: string) {
  const tokenHash = fingerprintRealPortraitSecret(token);
  const result = await client.query<PublicInviteRow>(
    `${publicInviteSql('i.token_hash = $1')} FOR UPDATE OF i, auth, a, m`,
    [tokenHash],
  );
  const invite = result.rows[0];
  if (!invite) throw notFound('邀请不存在或已失效');
  return invite;
}

function publicInviteSql(where = 'i.token_hash = $1') {
  return `SELECT i.id AS invite_id, i.status AS invite_status,
                 i.expires_at AS invite_expires_at, i.accepted_at,
                 a.id AS actor_id, a.alias, a.plan_access_status, a.lifecycle_status,
                 a.user_id,
                 auth.id AS authorization_id, auth.status AS authorization_status,
                 auth.valid_until AS authorization_valid_until,
                 auth.purpose, auth.commercial_use, auth.consented_at,
                 auth.controller_name, auth.processor_name, auth.privacy_contact,
                 auth.privacy_policy_url, auth.processing_scope, auth.retention_rule,
                 auth.portrait_notice_version, auth.sensitive_info_notice_version,
                 m.id AS materialization_id, m.status AS materialization_status,
                 latest_session.status AS verification_status
          FROM real_portrait_invites i
          JOIN real_portrait_actors a ON a.id = i.actor_id AND a.deleted_at IS NULL
          JOIN real_portrait_authorizations auth ON auth.id = i.authorization_id
          JOIN real_portrait_materializations m
            ON m.actor_id = i.actor_id AND m.authorization_id = i.authorization_id
           AND m.status NOT IN ('evicted', 'deleted', 'error')
          LEFT JOIN LATERAL (
            SELECT status
            FROM real_portrait_verification_sessions
            WHERE invite_id = i.id
            ORDER BY created_at DESC
            LIMIT 1
          ) latest_session ON true
          WHERE ${where}
          ORDER BY m.generation DESC
          LIMIT 1`;
}

function assertInviteUsable(invite: PublicInviteRow, now: Date, allowAccepted = false) {
  if (new Date(invite.invite_expires_at).getTime() <= now.getTime()) {
    throw conflict('邀请已过期，请联系邀请人重新发起', 'REAL_PORTRAIT_INVITE_EXPIRED');
  }
  const allowed = allowAccepted ? ['pending', 'accepted'] : ['pending'];
  if (!allowed.includes(invite.invite_status)) {
    throw conflict('邀请已使用或已取消', 'REAL_PORTRAIT_INVITE_UNAVAILABLE');
  }
}

function mapPublicInvite(invite: PublicInviteRow) {
  const status = publicInviteResponseStatus(invite);
  return {
    status,
    ...mapRealPortraitLegalDisclosure(invite),
    purpose: invite.purpose,
    commercialUse: Boolean(invite.commercial_use),
    validUntil: toIsoDateTime(invite.authorization_valid_until)!,
    inviteExpiresAt: toIsoDateTime(invite.invite_expires_at)!,
    portraitNoticeVersion: invite.portrait_notice_version,
    sensitiveInfoNoticeVersion: invite.sensitive_info_notice_version,
    canStartVerification: status === 'accepted'
      && invite.authorization_status === 'pending'
      && Boolean(invite.consented_at)
      && !invite.verification_status,
  };
}

function publicInviteResponseStatus(invite: PublicInviteRow) {
  if (new Date(invite.invite_expires_at).getTime() <= Date.now() && invite.invite_status !== 'consumed') {
    return 'expired';
  }
  if (invite.authorization_status === 'revoked' || invite.authorization_status === 'rejected') return 'cancelled';
  return invite.invite_status;
}

function publicVerificationStatus(invite: PublicInviteRow) {
  if (new Date(invite.authorization_valid_until).getTime() <= Date.now()) return 'expired';
  if (invite.verification_status === 'failed' || invite.materialization_status === 'error') return 'failed';
  if (invite.materialization_status === 'active') return 'active';
  if (invite.materialization_status === 'awaiting_upload') return 'awaiting_upload';
  if (invite.materialization_status === 'processing') return 'awaiting_upload';
  if (invite.verification_status === 'verified') return 'verified';
  if (['submitting', 'invitation_ready', 'waiting', 'submission_unknown'].includes(invite.verification_status ?? '')) {
    return 'verifying';
  }
  if (invite.invite_status === 'pending') return 'invited';
  if (invite.invite_status === 'accepted') return 'verifying';
  if (invite.invite_status === 'consumed') return 'verified';
  return 'expired';
}

async function findManageAuthorization(manageToken: string) {
  const tokenHash = fingerprintRealPortraitSecret(manageToken);
  const result = await pool.query<ManagedAuthorizationRow>(
    `SELECT t.id AS token_id, t.status AS token_status, t.expires_at AS token_expires_at,
            a.id AS actor_id, a.alias, a.user_id,
            auth.id AS authorization_id, auth.status AS authorization_status,
            auth.purpose, auth.commercial_use, auth.valid_from, auth.valid_until,
            auth.controller_name, auth.processor_name, auth.privacy_contact,
            auth.privacy_policy_url, auth.processing_scope, auth.retention_rule,
            auth.consented_at, auth.revoked_at,
            CASE
              WHEN auth.status <> 'revoked' THEN 'not-requested'
              WHEN EXISTS (
                SELECT 1 FROM real_portrait_remote_operations op
                WHERE op.actor_id = a.id AND op.status = 'manual_review'
              ) THEN 'manual-review'
              WHEN EXISTS (
                SELECT 1 FROM real_portrait_materializations m
                WHERE m.actor_id = a.id AND m.status IN ('deleting', 'error')
              ) OR EXISTS (
                SELECT 1 FROM real_portrait_remote_operations op
                WHERE op.actor_id = a.id AND op.status <> 'completed'
              ) THEN 'pending'
              ELSE 'completed'
            END AS cleanup_status
     FROM real_portrait_subject_access_tokens t
     JOIN real_portrait_authorizations auth ON auth.id = t.authorization_id
     JOIN real_portrait_actors a ON a.id = auth.actor_id
     WHERE t.token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row || !['active', 'revoked'].includes(row.token_status)
      || new Date(row.token_expires_at).getTime() <= Date.now()) {
    throw notFound('授权管理链接不存在或已失效');
  }
  await pool.query(
    `UPDATE real_portrait_subject_access_tokens SET last_used_at = now() WHERE id = $1`,
    [row.token_id],
  );
  return row;
}

function mapManagedAuthorization(row: ManagedAuthorizationRow) {
  return {
    status: row.authorization_status,
    ...mapRealPortraitLegalDisclosure(row),
    purpose: row.purpose,
    commercialUse: Boolean(row.commercial_use),
    validUntil: toIsoDateTime(row.valid_until)!,
    cleanupStatus: row.cleanup_status,
  };
}

function mapRealPortraitLegalDisclosure(row: {
  controller_name: string;
  processor_name: string;
  privacy_contact: string;
  privacy_policy_url: string;
  processing_scope: string;
  retention_rule: string;
}) {
  return {
    controllerName: row.controller_name,
    processorName: row.processor_name,
    privacyContact: row.privacy_contact,
    privacyPolicyUrl: row.privacy_policy_url,
    processingScope: row.processing_scope,
    retentionRule: row.retention_rule,
  };
}

function requireRealPortraitLegalDisclosure() {
  const controllerName = env.REAL_PORTRAIT_CONTROLLER_NAME?.trim();
  const processorName = env.REAL_PORTRAIT_PROCESSOR_NAME?.trim();
  const privacyContact = env.REAL_PORTRAIT_PRIVACY_CONTACT?.trim();
  const privacyPolicyUrl = env.REAL_PORTRAIT_PRIVACY_POLICY_URL?.trim();
  if (!controllerName || !processorName || !privacyContact || !privacyPolicyUrl) {
    throw Object.assign(new Error('真人素材服务的法律主体与隐私联系信息尚未配置'), {
      statusCode: 503,
      code: 'REAL_PORTRAIT_LEGAL_DISCLOSURE_UNAVAILABLE',
    });
  }
  return {
    controllerName,
    processorName,
    privacyContact,
    privacyPolicyUrl,
    processingScope: REAL_PORTRAIT_PROCESSING_SCOPE,
    retentionRule: REAL_PORTRAIT_RETENTION_RULE,
  };
}

async function recomputePortraitLifecycleWithClient(
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
    `UPDATE real_portrait_materializations m
     SET status = $2,
         activated_at = CASE WHEN $2 = 'active' THEN COALESCE(activated_at, now()) ELSE activated_at END,
         updated_at = now()
     FROM real_portrait_authorizations auth
     WHERE m.id = $1 AND auth.id = m.authorization_id AND auth.status = 'active'
       AND m.status NOT IN ('eviction_warning', 'deleting', 'evicted', 'deleted', 'error')`,
    [materializationId, nextStatus],
  );
  await client.query(
    `UPDATE real_portrait_actors a
     SET lifecycle_status = $2, updated_at = now()
     FROM real_portrait_authorizations auth
     WHERE a.id = $1 AND auth.actor_id = a.id AND auth.status = 'active'
       AND a.lifecycle_status NOT IN (
         'eviction_warning', 'revoked', 'deleting', 'evicted', 'expired', 'sync_error'
       )`,
    [actorId, nextStatus],
  );
}

async function requireOwnedPortraitAsset(userId: string, portraitAssetId: string): Promise<RealPortraitAsset> {
  const result = await pool.query<{
    id: string;
    kind: RealPortraitAsset['kind'];
    status: RealPortraitAsset['status'];
    consistency_status: RealPortraitAsset['consistencyStatus'];
    thumbnail_ready: boolean;
  }>(
    `SELECT pa.id, pa.kind, pa.status, pa.consistency_status, pa.thumbnail_ready
     FROM real_portrait_assets pa
     JOIN real_portrait_actors a ON a.id = pa.actor_id
     WHERE pa.id = $1 AND a.user_id = $2
     LIMIT 1`,
    [portraitAssetId, userId],
  );
  const asset = result.rows[0];
  if (!asset) throw notFound('真人素材不存在');
  return {
    id: asset.id,
    kind: asset.kind,
    status: asset.status,
    consistencyStatus: asset.consistency_status,
    thumbnailAvailable: asset.thumbnail_ready === true,
  };
}

function mapGenerationReference(row: GenerationReferenceRow): RealPortraitGenerationReference {
  if (!row.provider_asset_id) throw conflict('真人素材供应商标识缺失', 'REAL_PORTRAIT_REFERENCE_UNAVAILABLE');
  return {
    actorId: row.actor_id,
    portraitAssetId: row.portrait_asset_id,
    authorizationId: row.authorization_id,
    materializationId: row.materialization_id,
    authorizationVersion: toInt(row.authorization_version),
    providerAssetId: row.provider_asset_id,
    projectName: row.project_name,
    providerUrl: `asset://${row.provider_asset_id}`,
  };
}

async function acquireCapacityLock(client: DbClient) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [CAPACITY_LOCK_KEY]);
}

async function readQueuePosition(client: DbClient, actorId: string) {
  const result = await client.query<{ position: number | string }>(
    `SELECT count(*)::integer AS position
     FROM real_portrait_activation_queue current_item
     JOIN real_portrait_activation_queue queued
       ON queued.user_id = current_item.user_id
      AND queued.status = 'waiting'
      AND (queued.requested_at, queued.id) <= (current_item.requested_at, current_item.id)
     WHERE current_item.actor_id = $1 AND current_item.status = 'waiting'`,
    [actorId],
  );
  return Math.max(1, toInt(result.rows[0]?.position));
}

async function appendPortraitEvent(client: DbClient, input: {
  userId: string;
  actorId?: string | null;
  authorizationId?: string | null;
  materializationId?: string | null;
  eventType: string;
  initiatorType: 'user' | 'subject' | 'admin' | 'system';
  initiatorUserId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await client.query(
    `INSERT INTO real_portrait_events (
       user_id, actor_id, authorization_id, materialization_id,
       event_type, initiator_type, initiator_user_id, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      input.userId,
      input.actorId ?? null,
      input.authorizationId ?? null,
      input.materializationId ?? null,
      input.eventType,
      input.initiatorType,
      input.initiatorUserId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function markRemoteOperationFailure(operationId: string, error: unknown) {
  return withTransaction(client => markRemoteOperationFailureWithClient(client, operationId, error));
}

async function markRemoteOperationFailureWithClient(
  client: DbClient,
  operationId: string,
  error: unknown,
) {
  await client.query(
    `UPDATE real_portrait_remote_operations
     SET status = $2, last_error_code = $3,
         next_retry_at = now() + interval '1 minute', updated_at = now()
     WHERE id = $1`,
    [operationId, isSubmissionUnknown(error) ? 'submission_unknown' : 'failed', safeErrorCode(error)],
  );
}

async function inspectStoredPortraitImage(objectKey: string) {
  const statedSize = await getStoredObjectSize(objectKey);
  assertPortraitUploadSize(statedSize);
  const stream = await openStoredObjectStream(objectKey);
  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  const digest = createHash('sha256');
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += buffer.length;
    assertPortraitUploadSize(sizeBytes);
    digest.update(buffer);
    chunks.push(buffer);
  }
  if (sizeBytes !== statedSize) {
    throw badRequest('对象存储读取长度发生变化，请重新上传', 'REAL_PORTRAIT_UPLOAD_CHANGED');
  }
  let metadata: { width?: number; height?: number; format?: string };
  try {
    metadata = await sharp(Buffer.concat(chunks, sizeBytes)).metadata();
  } catch (error) {
    throw Object.assign(new Error('无法解析真人图片'), {
      statusCode: 400,
      code: 'REAL_PORTRAIT_IMAGE_INVALID',
      exposeMessage: true,
      cause: error,
    });
  }
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw badRequest('真人图片缺少有效尺寸或格式', 'REAL_PORTRAIT_IMAGE_INVALID');
  }
  return {
    sizeBytes,
    width: metadata.width,
    height: metadata.height,
    sha256: digest.digest('hex'),
    detectedFormat: metadata.format,
  };
}

function assertPortraitUploadSize(sizeBytes: number) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > PORTRAIT_MAX_UPLOAD_BYTES) {
    throw badRequest('真人图片必须小于 30 MB', 'REAL_PORTRAIT_UPLOAD_SIZE_INVALID');
  }
}

function assertPortraitImageMetadata(input: {
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  mimeType?: string;
  detectedFormat?: string;
}) {
  assertPortraitUploadSize(input.sizeBytes);
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height)
      || input.width < 300 || input.width > 6000
      || input.height < 300 || input.height > 6000) {
    throw badRequest('真人图片宽高必须在 300–6000 像素之间', 'REAL_PORTRAIT_IMAGE_DIMENSIONS_INVALID');
  }
  const ratio = input.width / input.height;
  if (ratio <= 0.4 || ratio >= 2.5) {
    throw badRequest('真人图片宽高比必须大于 0.4 且小于 2.5', 'REAL_PORTRAIT_IMAGE_RATIO_INVALID');
  }
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw badRequest('真人图片 SHA-256 不正确', 'REAL_PORTRAIT_IMAGE_HASH_INVALID');
  }
  if (input.mimeType && input.detectedFormat && !mimeMatchesFormat(input.mimeType, input.detectedFormat)) {
    throw badRequest('真人图片实际格式与声明格式不一致', 'REAL_PORTRAIT_IMAGE_FORMAT_MISMATCH');
  }
}

function mimeMatchesFormat(mimeType: string, format: string) {
  const aliases: Record<string, string[]> = {
    'image/jpeg': ['jpeg', 'jpg'],
    'image/png': ['png'],
    'image/webp': ['webp'],
    'image/bmp': ['bmp'],
    'image/tiff': ['tiff', 'tif'],
    'image/gif': ['gif'],
    'image/heic': ['heic', 'heif'],
    'image/heif': ['heic', 'heif'],
  };
  return aliases[mimeType]?.includes(format.toLowerCase()) === true;
}

function normalizePortraitMimeType(value: string) {
  const mimeType = value.trim().toLowerCase();
  if (!PORTRAIT_ALLOWED_MIME_TYPES.has(mimeType)) {
    throw badRequest('不支持该真人图片格式', 'REAL_PORTRAIT_IMAGE_TYPE_INVALID');
  }
  return mimeType;
}

function normalizeAlias(value: string) {
  return requireText(value, '真人档案别名', 120);
}

function normalizeReasonCode(value: string | undefined) {
  if (!value) return 'user-requested';
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(normalized)) {
    throw badRequest('撤回原因代码格式不正确', 'REAL_PORTRAIT_REASON_INVALID');
  }
  return normalized;
}

function requireText(value: string, field: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized) throw badRequest(`${field}不能为空`, 'REAL_PORTRAIT_INPUT_INVALID');
  if ([...normalized].length > maxLength) {
    throw badRequest(`${field}不能超过 ${maxLength} 个字符`, 'REAL_PORTRAIT_INPUT_INVALID');
  }
  return normalized;
}

function uniqueIds(values: string[]) {
  return [...new Set(values)];
}

function parseIdArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function mapPlanQuota(row: {
  source_plan_id: string | null;
  portrait_enabled: boolean;
  profile_limit: number | string | null;
  active_limit: number | string;
  assets_per_actor: number | string;
}): RealPortraitQuota {
  return {
    sourcePlanId: row.source_plan_id,
    sourcePlanCode: null,
    sourcePlanName: null,
    enabled: Boolean(row.portrait_enabled),
    profileLimit: row.profile_limit === null ? null : toInt(row.profile_limit),
    activeLimit: toInt(row.active_limit),
    assetsPerActor: requireAssetLimit(toInt(row.assets_per_actor)),
  };
}

function requireAssetLimit(value: number): 0 | 1 | 2 {
  if (value === 0 || value === 1 || value === 2) return value;
  throw Object.assign(new Error('套餐真人素材数量配置无效'), {
    statusCode: 500,
    code: 'REAL_PORTRAIT_ENTITLEMENT_INVALID',
  });
}

function parseEncryptedSecret(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.ciphertext !== 'string'
      || typeof parsed.iv !== 'string'
      || typeof parsed.tag !== 'string'
    ) throw new Error('invalid-shape');
    return { ciphertext: parsed.ciphertext, iv: parsed.iv, tag: parsed.tag };
  } catch (error) {
    throw Object.assign(new Error('真人验证会话密文格式无效', { cause: error }), {
      statusCode: 503,
      code: 'REAL_PORTRAIT_SECRET_DECRYPT_FAILED',
    });
  }
}

function portraitEntitlementsDecreased(current: QuotaStateRow, next: RealPortraitQuota) {
  const currentEnabled = Boolean(current.portrait_enabled);
  if (currentEnabled && !next.enabled) return true;
  if (!currentEnabled) return false;

  const currentProfileLimit = current.profile_limit === null ? null : toInt(current.profile_limit);
  const profileReduced = currentProfileLimit === null
    ? next.profileLimit !== null
    : next.profileLimit !== null && next.profileLimit < currentProfileLimit;
  return profileReduced
    || next.activeLimit < toInt(current.active_limit)
    || next.assetsPerActor < toInt(current.assets_per_actor);
}

function sameQuota(current: QuotaStateRow, next: RealPortraitQuota) {
  return current.source_plan_id === next.sourcePlanId
    && Boolean(current.portrait_enabled) === next.enabled
    && (current.profile_limit === null ? null : toInt(current.profile_limit)) === next.profileLimit
    && toInt(current.active_limit) === next.activeLimit
    && toInt(current.assets_per_actor) === next.assetsPerActor;
}

function mapStoredQuota(current: QuotaStateRow) {
  return mapPlanQuota(current);
}

/**
 * 新增档案和激活新人都会扩大真人库占用，必须先确认当前用量已落回新权益以内。
 * 宽限期只允许用户保留、清理既有资源，不能让某个入口只检查自己即将增加的维度。
 */
async function assertRealPortraitQuotaExpansionAllowedWithClient(
  client: DbClient,
  userId: string,
  quota: RealPortraitQuota,
) {
  const result = await client.query<{
    profiles: number | string;
    active: number | string;
    max_assets: number | string;
  }>(
    `WITH live_asset_slots AS (
       SELECT asset.actor_id, asset.id AS slot_id
       FROM real_portrait_assets asset
       JOIN real_portrait_actors owner ON owner.id = asset.actor_id
       WHERE owner.user_id = $1 AND owner.deleted_at IS NULL
         AND asset.remote_deleted_at IS NULL
         AND (
           asset.provider_asset_id IS NOT NULL
           OR (asset.provider_asset_id IS NULL AND asset.status = 'queued')
         )
       UNION ALL
       SELECT upload.actor_id, upload.id AS slot_id
       FROM real_portrait_upload_sessions upload
       JOIN real_portrait_actors owner ON owner.id = upload.actor_id
       WHERE upload.user_id = $1 AND owner.deleted_at IS NULL
         AND upload.asset_id IS NULL
         AND upload.status IN ('waiting_upload', 'uploaded', 'submitting', 'processing', 'active')
         AND (
           upload.status IN ('submitting', 'processing', 'active')
           OR upload.expires_at > now()
         )
     ),
     actor_asset_usage AS (
       SELECT actor_id, count(*)::integer AS asset_count
       FROM live_asset_slots
       GROUP BY actor_id
     )
     SELECT
       count(*) FILTER (WHERE actor.deleted_at IS NULL)::integer AS profiles,
       count(*) FILTER (
         WHERE actor.deleted_at IS NULL
           AND (
             actor.lifecycle_status IN (
               'waiting', 'invited', 'verifying', 'awaiting_upload',
               'processing', 'active', 'eviction_warning'
             )
             OR EXISTS (
               SELECT 1 FROM real_portrait_materializations materialization
               WHERE materialization.actor_id = actor.id
                 AND materialization.provider_group_id IS NOT NULL
                 AND materialization.remote_deleted_at IS NULL
             )
             OR EXISTS (
               SELECT 1 FROM real_portrait_capacity_reservations reservation
               WHERE reservation.actor_id = actor.id
                 AND reservation.status = 'reserved' AND reservation.expires_at > now()
             )
             OR EXISTS (
               SELECT 1 FROM real_portrait_activation_queue queue
               WHERE queue.actor_id = actor.id AND queue.status IN ('waiting', 'promoted')
             )
           )
       )::integer AS active,
       COALESCE((SELECT max(asset_count) FROM actor_asset_usage), 0)::integer AS max_assets
     FROM real_portrait_actors actor
     WHERE actor.user_id = $1`,
    [userId],
  );
  const usage = {
    profiles: toInt(result.rows[0]?.profiles),
    active: toInt(result.rows[0]?.active),
    maxAssets: toInt(result.rows[0]?.max_assets),
  };
  const overProfile = quota.profileLimit !== null && usage.profiles > quota.profileLimit;
  const overActive = usage.active > quota.activeLimit;
  const overAssets = usage.maxAssets > quota.assetsPerActor;
  if (overProfile || overActive || overAssets) {
    throw conflict(
      '当前真人素材用量超过套餐新权益，请先完成宽限期保留或清理',
      'REAL_PORTRAIT_QUOTA_RECONCILIATION_REQUIRED',
    );
  }
  return usage;
}

function assertPortraitEnabled(quota: RealPortraitQuota) {
  if (quota.enabled && quota.assetsPerActor > 0 && quota.activeLimit > 0) return;
  throw Object.assign(new Error('当前套餐未开通真人素材库'), {
    statusCode: 403,
    code: 'REAL_PORTRAIT_NOT_ENTITLED',
    exposeMessage: true,
  });
}

async function assertRealPortraitActorPlanUsableWithClient(
  client: DbClient,
  userId: string,
  planAccessStatus: string,
  quota: RealPortraitQuota,
) {
  if (planAccessStatus === 'available' && quota.enabled) return;
  if (planAccessStatus === 'grace') {
    const grace = await client.query<{ valid: boolean }>(
      `SELECT (
         grace_status IN ('active', 'reconciling')
         AND grace_until > now()
       ) AS valid
       FROM user_portrait_quota_states
       WHERE user_id = $1`,
      [userId],
    );
    if (grace.rows[0]?.valid) return;
  }
  throw conflict('该真人档案已因套餐额度锁定或宽限期已结束', 'REAL_PORTRAIT_PLAN_LOCKED');
}

function assertProviderConfigured(provider: RealPortraitProvider) {
  if (provider.name !== 'disabled') return;
  throw Object.assign(new Error('真人素材供应商尚未配置，无法发起真人认证或素材入库'), {
    statusCode: 503,
    code: 'REAL_PORTRAIT_PROVIDER_NOT_CONFIGURED',
    exposeMessage: true,
  });
}

function providerAccountKey() {
  const identity = env.VOLC_ARK_ASSET_ACCESS_KEY_ID ?? env.REAL_PORTRAIT_PROVIDER_MODE;
  return `ark-assets:${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

function buildInvitationUrl(token: string) {
  const url = new URL('/portrait-consent/invite', env.APP_BASE_URL);
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

function buildManageUrl(token: string) {
  const url = new URL('/portrait-consent/authorization', env.APP_BASE_URL);
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

function buildProviderCallbackUrl(nonce: string) {
  return new URL(
    `/api/providers/volc/real-portrait-validation/${encodeURIComponent(nonce)}`,
    env.PUBLIC_BASE_URL,
  ).toString();
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1_000);
}

function addHours(value: Date, hours: number) {
  return new Date(value.getTime() + hours * 60 * 60 * 1_000);
}

function isSubmissionUnknown(error: unknown) {
  if (!error || typeof error !== 'object') return true;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode !== 'number' || statusCode >= 500;
}

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number'
    ? String(code).slice(0, 120)
    : error instanceof Error ? error.name.slice(0, 120) : 'UNKNOWN';
}

function notFound(message: string) {
  return Object.assign(new Error(message), { statusCode: 404, code: 'REAL_PORTRAIT_NOT_FOUND', exposeMessage: true });
}

function badRequest(message: string, code: string) {
  return Object.assign(new Error(message), { statusCode: 400, code, exposeMessage: true });
}

function conflict(message: string, code: string) {
  return Object.assign(new Error(message), { statusCode: 409, code, exposeMessage: true });
}
