import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  promptWizardVideoConfigSchema,
  tkPromptEvidenceReviewSchema,
  tkPromptPlanSchema,
  tkPromptStrategyBlueprintSchema,
  tkPromptVideoConfigSchema,
  type PromptWizardSource,
  type PromptWizardVideoConfig,
  type TkPromptPlan,
  type TkPromptSource,
  type TkPromptStrategyBlueprint,
  type TkPromptVideoConfig,
  type SeedreamAnnotation,
} from '@lindyson/api-contracts';
import { withTransaction, type DbClient } from '../db/pool.js';
import { scheduleObjectDeletion } from './assetDeletionService.js';
import { resolveAssetFolderId } from './assetFolders.js';
import { getGenerationCredits } from './consumption.js';
import { bucketForUsage } from './credits.js';
import { creditLedgerNotes } from './creditLedgerNotes.js';
import { setUserAvailableCreditsWithClient } from './financialCredits.js';
import { incrementPromptWizardDailyMetricsWithClient } from './promptWizardMetrics.js';
import {
  generationHoldEventKey,
  holdGenerationLotsWithClient,
  planGenerationLotAllocationsWithClient,
  releaseGenerationLotsWithClient,
  settleGenerationLotsWithClient,
} from './generationCredits.js';
import {
  getSeedanceModelCapability,
  isSeedanceModelLabel,
  sanitizeHistoricalSeedanceVideoConfig,
  sanitizeSeedanceVideoConfig,
  type SeedanceReferenceInput,
} from './seedanceModels.js';
import {
  isSeedreamModelLabel,
  sanitizeHistoricalSeedreamImageConfig,
  sanitizeSeedreamImageConfig,
  type SeedreamImageReferenceInput,
} from './seedreamModels.js';
import {
  estimateSeedreamListPrice,
  SEEDREAM_ADDITIONAL_REFERENCE_PRICE_CNY_MICROS,
  SEEDREAM_LARGE_IMAGE_PRICE_CNY_MICROS,
  SEEDREAM_SMALL_IMAGE_MAX_PIXELS,
  SEEDREAM_SMALL_IMAGE_PRICE_CNY_MICROS,
} from './seedreamListPrice.js';
import { estimateSeedanceCost, findSeedancePricingRule, hasSeedanceVideoInput } from './seedancePricing.js';
import { toIsoDateTime, toInt } from './serialization.js';
import { reconcileSubscriptionWithClient } from './subscriptionLifecycle.js';
import {
  tkPromptDemonstrableActionRegistry,
  tkPromptEvidenceFlagsSchema,
  tkPromptFactPackSchema,
  validateTkPromptFinalExecutionPrompt,
  type TkPromptFactPack,
} from './tkPromptEngine.js';
import {
  assertRealPortraitGenerationReferenceStillUsableWithClient,
  bindRealPortraitGenerationReferenceWithClient,
  getRealPortraitGenerationDeliveryDecisionWithClient,
  markRealPortraitGenerationSucceededWithClient,
  resolveRealPortraitGenerationReferenceWithClient,
} from './realPortraitService.js';
import type {
  RealPortraitGenerationDeliveryBlockReason,
  RealPortraitGenerationReference,
} from './realPortraitTypes.js';
import { selectGenerationProviderName } from '../providers/providerRegistry.js';
import type {
  GenerationKind,
  GenerationStatus,
  JobFailureCategory,
  ProviderFailure,
  ProviderSuccess,
  ProviderUsageObservation,
} from './types.js';

interface GenerationTaskRow {
  id: string;
  user_id: string;
  kind: GenerationKind;
  model: string;
  status: GenerationStatus;
  failure_category: JobFailureCategory | null;
  failure_reason: string | null;
  prompt: string;
  config: Record<string, unknown>;
  provider_task_id: string | null;
  provider_task_attempt: number | null;
  credits: number;
  reserved_credits: number;
  settled_credits: number;
  refunded_credits: number;
  credit_status: string;
  main_credits_used: number;
  addon_credits_used: number;
  asset_id: string | null;
  retry_count: number;
  attempt: number;
  processing_stage: string;
  claim_token: string | null;
  claim_epoch: number;
  cancel_state: string;
  active_provider_run_id: string | null;
  provider_result: ProviderSuccess | null;
  lease_expires_at: Date | string | null;
  heartbeat_at: Date | string | null;
  settlement_error: string | null;
  cancel_requested_at: Date | string | null;
  cancel_requested_by: string | null;
  cancel_origin?: string | null;
  cancel_reason_code?: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
  has_unresolved_provider_run?: boolean;
  prompt_wizard_engine_version?: number | string | null;
}

interface GenerationProviderRunRow {
  id: string;
  task_id: string;
  task_attempt: number;
  provider: string;
  status: string;
  provider_task_id: string | null;
  callback_token: string;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  output_object_key: string;
  thumbnail_object_key: string | null;
  staging_object_key: string;
  provider_result: ProviderSuccess | null;
  recovery_token: string | null;
  provider_request_id: string | null;
  provider_response_checkpoint: Record<string, unknown> | null;
  provider_response_url: string | null;
  provider_response_observed_at: Date | string | null;
  provider_response_url_expires_at: Date | string | null;
}

interface SettlementGenerationTaskRow extends GenerationTaskRow {
  run_output_object_key: string | null;
  run_thumbnail_object_key: string | null;
  run_staging_object_key: string | null;
}

interface GenerationCreditRelease {
  mainReturned: number;
  addonReturned: number;
  returnedCredits: number;
  expiredCredits: number;
  revokedCredits: number;
}

const REAL_PORTRAIT_PRIVACY_WITHHELD_CODE = 'privacy-withheld';

export interface GenerationTaskClaim {
  id: string;
  attempt: number;
  claimToken: string;
  claimEpoch: number;
  providerRunId: string;
  providerRunStatus: string;
  callbackToken: string;
  providerTaskId: string | null;
  providerResult: ProviderSuccess | null;
  providerRequestId: string | null;
  providerResponseCheckpoint: Record<string, unknown> | null;
  providerResponseUrl: string | null;
  providerResponseObservedAt: string | null;
  providerResponseUrlExpiresAt: string | null;
  outputObjectKey: string;
  thumbnailObjectKey: string;
  stagingObjectKey: string;
}

export interface CreateGenerationTaskInput {
  userId: string;
  kind: GenerationKind;
  model: string;
  prompt: string;
  config: Record<string, unknown>;
  references?: SeedanceReferenceInput[];
  realPortrait?: { actorId: string; portraitAssetId?: string };
  annotations?: SeedreamAnnotation[];
  promptWizardSource?: PromptWizardSource;
  tkPromptSource?: TkPromptSource;
}

export interface CreateGenerationBatchInput {
  userId: string;
  idempotencyKey: string;
  maxCredits?: number;
  mcpConnectionId?: string;
  requests: Array<Omit<CreateGenerationTaskInput, 'userId'>>;
}

export function mapGenerationTask(row: GenerationTaskRow) {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    model: row.model,
    status: row.status,
    failureCategory: row.failure_category,
    failureReason: row.failure_reason,
    prompt: row.prompt,
    config: row.config,
    providerTaskId: row.provider_task_id,
    providerTaskAttempt: row.provider_task_attempt == null ? null : toInt(row.provider_task_attempt),
    credits: toInt(row.credits),
    reservedCredits: toInt(row.reserved_credits),
    settledCredits: toInt(row.settled_credits),
    refundedCredits: toInt(row.refunded_credits),
    creditStatus: row.credit_status,
    mainCreditsUsed: toInt(row.main_credits_used),
    addonCreditsUsed: toInt(row.addon_credits_used),
    assetId: row.asset_id,
    retryCount: toInt(row.retry_count),
    attempt: toInt(row.attempt),
    processingStage: row.processing_stage ?? (row.status === 'completed' ? 'completed' : row.status),
    cancelState: row.cancel_state ?? (row.cancel_requested_at ? 'requested' : 'none'),
    providerRunId: row.active_provider_run_id ?? null,
    claimEpoch: toInt(row.claim_epoch),
    leaseExpiresAt: toIsoDateTime(row.lease_expires_at),
    heartbeatAt: toIsoDateTime(row.heartbeat_at),
    settlementError: row.settlement_error ?? null,
    cancelRequestedAt: toIsoDateTime(row.cancel_requested_at),
    createdAt: toIsoDateTime(row.created_at),
    startedAt: toIsoDateTime(row.started_at),
    completedAt: toIsoDateTime(row.completed_at),
    updatedAt: toIsoDateTime(row.updated_at),
  };
}

export async function getGenerationTask(client: DbClient, taskId: string, userId?: string) {
  const result = await client.query<GenerationTaskRow>(
    `SELECT * FROM generation_tasks
     WHERE id = $1 AND ($2::uuid IS NULL OR user_id = $2)
     LIMIT 1`,
    [taskId, userId ?? null],
  );

  return result.rows[0] ? mapGenerationTask(result.rows[0]) : null;
}

/**
 * 方舟回调只用于补齐 provider_task_id 和唤醒官方查单。回调中的 status、URL、用量
 * 都不作为结算事实，worker 必须再次调用供应商查询接口。
 */
export async function wakeGenerationProviderRunByCallback(
  callbackToken: string,
  providerTaskId?: string,
) {
  return withTransaction(async client => {
    const result = await client.query<GenerationProviderRunRow & {
      task_status: GenerationStatus;
      task_provider_task_id: string | null;
      task_claim_epoch: number;
    }>(
      `SELECT run.*, task.status AS task_status,
              task.provider_task_id AS task_provider_task_id,
              task.claim_epoch AS task_claim_epoch
       FROM generation_provider_runs run
       JOIN generation_tasks task ON task.id = run.task_id
       WHERE run.callback_token = $1
       FOR UPDATE OF run, task`,
      [callbackToken],
    );
    const run = result.rows[0];
    if (!run) return null;
    if (['completed', 'failed', 'canceled'].includes(run.task_status)) {
      return {
        taskId: run.task_id,
        attempt: toInt(run.task_attempt),
        claimEpoch: toInt(run.task_claim_epoch),
        enqueue: false,
        conflict: false,
      };
    }

    const normalizedProviderTaskId = providerTaskId?.trim() || run.provider_task_id || run.task_provider_task_id;
    if (!normalizedProviderTaskId) {
      return {
        taskId: run.task_id,
        attempt: toInt(run.task_attempt),
        claimEpoch: toInt(run.task_claim_epoch),
        enqueue: false,
        conflict: false,
      };
    }
    const duplicate = await client.query<{ id: string }>(
      `SELECT id FROM generation_provider_runs
       WHERE provider = $1 AND provider_task_id = $2 AND id <> $3
       LIMIT 1 FOR UPDATE`,
      [run.provider, normalizedProviderTaskId, run.id],
    );
    if (
      duplicate.rowCount
      ||
      (run.provider_task_id && run.provider_task_id !== normalizedProviderTaskId)
      || (run.task_provider_task_id && run.task_provider_task_id !== normalizedProviderTaskId)
    ) {
      await client.query(
        `UPDATE generation_provider_runs
         SET status = 'manual-review', last_error = '供应商回调 task id 与已保存值冲突',
             lease_token = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE id = $1`,
        [run.id],
      );
      await client.query(
        `UPDATE generation_tasks
         SET processing_stage = 'manual-review', settlement_error = '供应商回调 task id 冲突',
             claim_token = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE id = $1 AND attempt = $2`,
        [run.task_id, run.task_attempt],
      );
      return {
        taskId: run.task_id,
        attempt: toInt(run.task_attempt),
        claimEpoch: toInt(run.task_claim_epoch),
        enqueue: false,
        conflict: true,
      };
    }

    const leaseExpiresAt = run.lease_expires_at ? new Date(run.lease_expires_at).getTime() : 0;
    const hasLiveLease = Boolean(run.lease_token) && leaseExpiresAt > Date.now();
    if (hasLiveLease) {
      await client.query(
        `UPDATE generation_provider_runs
         SET provider_task_id = COALESCE(provider_task_id, $2),
             status = CASE WHEN status IN ('prepared', 'submitting') THEN 'submitted' ELSE status END,
             last_error = NULL, updated_at = now()
         WHERE id = $1`,
        [run.id, normalizedProviderTaskId],
      );
      await client.query(
        `UPDATE generation_tasks
         SET provider_task_id = COALESCE(provider_task_id, $3),
             provider_task_attempt = COALESCE(provider_task_attempt, $2),
             processing_stage = CASE WHEN processing_stage IN ('prepared', 'submitting') THEN 'submitted' ELSE processing_stage END,
             updated_at = now()
         WHERE id = $1 AND attempt = $2
           AND (provider_task_id IS NULL OR provider_task_id = $3)
           AND status = 'processing'`,
        [run.task_id, run.task_attempt, normalizedProviderTaskId],
      );
      return {
        taskId: run.task_id,
        attempt: toInt(run.task_attempt),
        claimEpoch: toInt(run.task_claim_epoch),
        enqueue: false,
        conflict: false,
      };
    }

    await client.query(
      `UPDATE generation_provider_runs
       SET provider_task_id = COALESCE(provider_task_id, $2),
           status = CASE
             WHEN status IN ('submitting', 'submission-unknown', 'prepared') THEN 'submitted'
             ELSE status
           END,
           lease_token = NULL, lease_expires_at = NULL,
           last_error = NULL, updated_at = now()
       WHERE id = $1`,
      [run.id, normalizedProviderTaskId],
    );
    await client.query(
      `UPDATE generation_tasks
       SET provider_task_id = COALESCE(provider_task_id, $3),
           provider_task_attempt = COALESCE(provider_task_attempt, $2),
           status = 'queued', processing_stage = 'submitted',
           claim_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
           settlement_error = NULL, updated_at = now()
       WHERE id = $1 AND attempt = $2
         AND (provider_task_id IS NULL OR provider_task_id = $3)
         AND status IN ('queued', 'processing')`,
      [run.task_id, run.task_attempt, normalizedProviderTaskId],
    );
    return {
      taskId: run.task_id,
      attempt: toInt(run.task_attempt),
      claimEpoch: toInt(run.task_claim_epoch),
      enqueue: true,
      conflict: false,
    };
  });
}

export async function beginGenerationTaskRecovery(taskId: string) {
  return withTransaction(async client => {
    const result = await client.query<GenerationProviderRunRow & { recovery_token: string }>(
      `WITH token AS (SELECT gen_random_uuid() AS value)
       UPDATE generation_provider_runs run
       SET recovery_token = token.value,
           lease_token = token.value,
           lease_expires_at = now() + interval '30 minutes',
           status = 'delivery-failed', last_error = NULL, updated_at = now()
       FROM generation_tasks task, token
       WHERE run.id = task.active_provider_run_id
         AND task.id = $1 AND task.status = 'failed' AND task.credit_status = 'refunded'
         AND task.asset_id IS NULL AND task.provider_task_id IS NOT NULL
         AND task.processing_stage <> 'privacy-withheld'
         AND task.cancel_reason_code IS DISTINCT FROM 'privacy-withheld'
         AND NOT EXISTS (
           SELECT 1
           FROM generation_real_portrait_references ref
           JOIN real_portrait_authorizations auth
             ON auth.id = ref.authorization_id AND auth.actor_id = ref.actor_id
            AND auth.version = ref.authorization_version
           WHERE ref.task_id = task.id AND ref.task_attempt = task.attempt
             AND (
               auth.status <> 'active'
               OR auth.valid_from > now()
               OR auth.valid_until <= now()
             )
         )
         AND run.provider_task_id = task.provider_task_id
         AND run.status IN ('refunded', 'provider-failed', 'delivery-failed')
         AND (run.recovery_token IS NULL OR run.lease_expires_at < now())
       RETURNING run.*`,
      [taskId],
    );
    const run = result.rows[0];
    if (!run?.recovery_token) {
      throw Object.assign(new Error('任务存在未完成恢复、未决供应商执行或当前状态不可恢复'), {
        statusCode: 409,
        code: 'GENERATION_RECOVERY_CONFLICT',
      });
    }
    return {
      recoveryToken: run.recovery_token,
      outputObjectKey: run.output_object_key,
      thumbnailObjectKey: run.thumbnail_object_key,
      stagingObjectKey: run.staging_object_key,
    };
  });
}

/**
 * 在任何 staging→final 复制前再次验证 recovery token，并续租到足以完成单次复制的窗口。
 * 旧恢复进程拿不到续租结果，因此不能覆盖新恢复进程的稳定 final key。
 */
export async function renewGenerationTaskRecoveryLease(taskId: string, recoveryToken: string) {
  return withTransaction(async client => {
    const result = await client.query<GenerationProviderRunRow>(
      `UPDATE generation_provider_runs run
       SET lease_expires_at = now() + interval '30 minutes', heartbeat_at = now(), updated_at = now()
       FROM generation_tasks task
       WHERE run.task_id = $1 AND run.recovery_token = $2 AND run.lease_token = $2
         AND run.status = 'delivery-failed'
         AND task.id = run.task_id AND task.attempt = run.task_attempt
         AND task.processing_stage <> 'privacy-withheld'
         AND task.cancel_reason_code IS DISTINCT FROM 'privacy-withheld'
         AND NOT EXISTS (
           SELECT 1
           FROM generation_real_portrait_references ref
           JOIN real_portrait_authorizations auth
             ON auth.id = ref.authorization_id AND auth.actor_id = ref.actor_id
            AND auth.version = ref.authorization_version
           WHERE ref.task_id = task.id AND ref.task_attempt = task.attempt
             AND (
               auth.status <> 'active'
               OR auth.valid_from > now()
               OR auth.valid_until <= now()
             )
         )
       RETURNING run.*`,
      [taskId, recoveryToken],
    );
    const run = result.rows[0];
    if (!run) return null;
    return {
      outputObjectKey: run.output_object_key,
      thumbnailObjectKey: run.thumbnail_object_key,
      stagingObjectKey: run.staging_object_key,
    };
  });
}

export async function failGenerationTaskRecovery(
  taskId: string,
  recoveryToken: string,
  objectKeys: Array<string | null | undefined>,
  error: unknown,
) {
  return withTransaction(async client => {
    const runResult = await client.query<GenerationProviderRunRow>(
      `SELECT run.*
       FROM generation_tasks task
       JOIN generation_provider_runs run ON run.id = task.active_provider_run_id
       WHERE task.id = $1
       FOR UPDATE OF run`,
      [taskId],
    );
    const run = runResult.rows[0];
    if (!run) return false;
    const ownsRecovery = run.recovery_token === recoveryToken && run.lease_token === recoveryToken;
    const keys = Array.from(new Set(objectKeys.map(key => key?.trim()).filter((key): key is string => Boolean(key))));
    for (const objectKey of [...keys].sort()) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`asset-object:${objectKey}`]);
      const referenced = await client.query(
        `SELECT 1
         WHERE EXISTS (
           SELECT 1 FROM assets
           WHERE deletion_status <> 'deleted'
             AND (object_key = $1 OR thumbnail_key = $1)
         ) OR EXISTS (
           SELECT 1 FROM generation_provider_runs
           WHERE id <> $2
             AND status NOT IN ('refunded', 'provider-failed', 'delivery-failed')
             AND (output_object_key = $1 OR thumbnail_object_key = $1 OR staging_object_key = $1)
         )`,
        [objectKey, run.id],
      );
      if (referenced.rowCount) continue;
      await client.query(
        `INSERT INTO object_deletion_outbox (object_key, asset_ids)
         VALUES ($1, '{}'::uuid[])
         ON CONFLICT (object_key) DO UPDATE
         SET status = CASE WHEN object_deletion_outbox.status = 'completed' THEN 'completed' ELSE 'pending' END,
             available_at = LEAST(object_deletion_outbox.available_at, now()), updated_at = now()`,
        [objectKey],
      );
    }
    if (ownsRecovery) {
      await client.query(
        `UPDATE generation_provider_runs
         SET status = 'refunded', recovery_token = NULL, lease_token = NULL,
             lease_expires_at = NULL, last_error = $3, updated_at = now()
         WHERE id = $1 AND recovery_token = $2 AND lease_token = $2`,
        [run.id, recoveryToken, safeErrorMessage(error)],
      );
    }
    return ownsRecovery;
  });
}

interface PromptWizardSourceBatchRow {
  id: string;
  run_id: string;
  user_id: string;
  status: string;
  plans: unknown;
  video_config: unknown;
  image_asset_ids: string[];
  content_purged_at: Date | string | null;
  run_status: string;
  run_expires_at: Date | string;
}

interface PromptWizardSourceRevisionRow {
  id: string;
  batch_id: string;
  user_id: string;
  status: string;
  plan: unknown;
  content_purged_at: Date | string | null;
}

interface PromptWizardSourceContext {
  plan: Record<string, unknown>;
  videoConfig: PromptWizardVideoConfig;
  imageAssetIds: string[];
}

interface TkPromptSourceRow {
  run_status: string;
  run_image_asset_ids: string[];
  run_content_purged_at: Date | string | null;
  run_expires_at: Date | string;
  generation_status: string;
  generation_video_config: unknown;
  generation_confirmed_fact_pack: unknown;
  generation_content_purged_at: Date | string | null;
  generation_expires_at: Date | string;
  option_status: string;
  option_strategy_blueprint: unknown;
  option_plan: unknown;
  option_content_purged_at: Date | string | null;
}

interface TkPromptSourceContext {
  plan: TkPromptPlan;
  strategy: TkPromptStrategyBlueprint;
  videoConfig: TkPromptVideoConfig;
  imageAssetIds: string[];
  factPack: TkPromptFactPack;
}

const tkPromptSourceFactEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  factPack: tkPromptFactPackSchema,
  evidenceReview: tkPromptEvidenceReviewSchema,
  evidenceFlags: tkPromptEvidenceFlagsSchema,
}).strict();

function promptWizardSourceInvalidError() {
  return Object.assign(new Error('提示词方案来源已失效，请重新应用方案。'), {
    statusCode: 400,
    code: 'PROMPT_WIZARD_SOURCE_INVALID',
  });
}

function tkPromptSourceInvalidError() {
  return Object.assign(new Error('TK 方案来源已失效，请重新应用方案。'), {
    statusCode: 400,
    code: 'TK_PROMPT_SOURCE_INVALID',
  });
}

function assertPromptWizardSourceModelSupported(
  request: CreateGenerationBatchInput['requests'][number],
) {
  if (!request.promptWizardSource || request.kind !== 'video') return;
  const capability = getSeedanceModelCapability(request.model);
  if (!capability || capability.supportsPromptWizard) return;
  throw Object.assign(
    new Error(`${capability.label} 暂不支持提示词向导来源，请移除 promptWizardSource 后重试。`),
    {
      statusCode: 400,
      code: 'PROMPT_WIZARD_MODEL_UNSUPPORTED',
    },
  );
}

function assertTkPromptSourceModelSupported(
  request: CreateGenerationBatchInput['requests'][number],
) {
  if (!request.tkPromptSource || request.kind !== 'video') return;
  if (request.realPortrait) {
    throw Object.assign(
      new Error('TK Prompt Engine 的人物由 Seedance 自动生成，不能同时绑定真人演员素材。'),
      {
        statusCode: 400,
        code: 'TK_PROMPT_REAL_PORTRAIT_FORBIDDEN',
      },
    );
  }
  const capability = getSeedanceModelCapability(request.model);
  if (!capability || capability.supportsPromptWizard) return;
  throw Object.assign(
    new Error(`${capability.label} 暂不支持 TK Prompt Engine 来源，请移除 tkPromptSource 后重试。`),
    {
      statusCode: 400,
      code: 'TK_PROMPT_MODEL_UNSUPPORTED',
    },
  );
}

async function readTkPromptSourceContextWithClient(
  client: DbClient,
  userId: string,
  kind: GenerationKind,
  source: TkPromptSource,
): Promise<TkPromptSourceContext> {
  if (kind !== 'video') throw tkPromptSourceInvalidError();
  const result = await client.query<TkPromptSourceRow>(
    `SELECT run.status AS run_status,
            run.image_asset_ids AS run_image_asset_ids,
            run.content_purged_at AS run_content_purged_at,
            run.expires_at AS run_expires_at,
            generation.status AS generation_status,
            generation.video_config AS generation_video_config,
            generation.confirmed_fact_pack AS generation_confirmed_fact_pack,
            generation.content_purged_at AS generation_content_purged_at,
            generation.expires_at AS generation_expires_at,
            option.status AS option_status,
            option.strategy_blueprint AS option_strategy_blueprint,
            option.plan AS option_plan,
            option.content_purged_at AS option_content_purged_at
     FROM tk_prompt_runs run
     JOIN tk_prompt_generations generation
       ON generation.run_id = run.id AND generation.user_id = run.user_id
     JOIN tk_prompt_options option
       ON option.generation_id = generation.id AND option.user_id = run.user_id
     WHERE run.id = $1
       AND generation.id = $2
       AND option.id = $3
       AND run.user_id = $4
     LIMIT 1
     FOR SHARE OF run, generation, option`,
    [source.runId, source.generationId, source.optionId, userId],
  );
  const row = result.rows[0];
  const runExpiresAt = row ? new Date(row.run_expires_at).getTime() : Number.NaN;
  const generationExpiresAt = row
    ? new Date(row.generation_expires_at).getTime()
    : Number.NaN;
  const plan = tkPromptPlanSchema.safeParse(row?.option_plan);
  const strategy = tkPromptStrategyBlueprintSchema.safeParse(row?.option_strategy_blueprint);
  const videoConfig = tkPromptVideoConfigSchema.safeParse(row?.generation_video_config);
  const factEnvelope = tkPromptSourceFactEnvelopeSchema.safeParse(
    row?.generation_confirmed_fact_pack,
  );
  if (
    !row
    || source.schemaVersion !== 1
    || row.run_status !== 'ready'
    || row.generation_status !== 'completed'
    || row.option_status !== 'completed'
    || row.run_content_purged_at !== null
    || row.generation_content_purged_at !== null
    || row.option_content_purged_at !== null
    || !Number.isFinite(runExpiresAt)
    || !Number.isFinite(generationExpiresAt)
    || runExpiresAt <= Date.now()
    || generationExpiresAt <= Date.now()
    || !Array.isArray(row.run_image_asset_ids)
    || row.run_image_asset_ids.length < 1
    || row.run_image_asset_ids.length > 9
    || row.run_image_asset_ids.some(id => typeof id !== 'string')
    || !plan.success
    || !strategy.success
    || !videoConfig.success
    || !factEnvelope.success
  ) {
    throw tkPromptSourceInvalidError();
  }
  return {
    plan: plan.data,
    strategy: strategy.data,
    videoConfig: videoConfig.data,
    imageAssetIds: [...row.run_image_asset_ids],
    factPack: factEnvelope.data.factPack,
  };
}

function promptWizardStoredPlanId(plan: unknown) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  const id = (plan as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

function promptWizardStoredPlanEngineVersion(plan: unknown): 2 | 3 | 4 | null {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  const deliveryVersion = Number((plan as { deliveryVersion?: unknown }).deliveryVersion ?? 1);
  if (!Number.isFinite(deliveryVersion)) return null;
  return deliveryVersion === 6
    ? 4
    : deliveryVersion === 4 || deliveryVersion === 5
    ? 3
    : deliveryVersion >= 1 && deliveryVersion <= 3
      ? 2
      : null;
}

function promptWizardStoredPlan(plan: unknown): Record<string, unknown> | null {
  return plan && typeof plan === 'object' && !Array.isArray(plan)
    ? plan as Record<string, unknown>
    : null;
}

async function readPromptWizardSourceContextWithClient(
  client: DbClient,
  userId: string,
  kind: GenerationKind,
  source: PromptWizardSource,
): Promise<PromptWizardSourceContext> {
  if (kind !== 'video') throw promptWizardSourceInvalidError();

  const batchResult = await client.query<PromptWizardSourceBatchRow>(
    `SELECT batch.id, batch.run_id, batch.user_id, batch.status,
            batch.plans, batch.video_config, batch.image_asset_ids, batch.content_purged_at,
            run.status AS run_status, run.expires_at AS run_expires_at
     FROM prompt_wizard_batches batch
     JOIN prompt_wizard_runs run ON run.id = batch.run_id
     WHERE batch.id = $1 AND batch.run_id = $2 AND batch.user_id = $3
     LIMIT 1`,
    [source.batchId, source.runId, userId],
  );
  const batch = batchResult.rows[0];
  const runExpiresAt = batch ? new Date(batch.run_expires_at).getTime() : Number.NaN;
  if (
    !batch
    || batch.status !== 'completed'
    || batch.content_purged_at !== null
    || batch.run_status === 'archived'
    || !Number.isFinite(runExpiresAt)
    || runExpiresAt <= Date.now()
  ) {
    throw promptWizardSourceInvalidError();
  }

  let storedPlan: unknown = null;
  if (source.planRevisionId) {
    const revisionResult = await client.query<PromptWizardSourceRevisionRow>(
      `SELECT id, batch_id, user_id, status, plan, content_purged_at
       FROM prompt_wizard_plan_revisions
       WHERE id = $1 AND batch_id = $2 AND user_id = $3
       LIMIT 1`,
      [source.planRevisionId, source.batchId, userId],
    );
    const revision = revisionResult.rows[0];
    if (!revision || revision.status !== 'completed' || revision.content_purged_at !== null) {
      throw promptWizardSourceInvalidError();
    }
    storedPlan = revision.plan;
  } else if (Array.isArray(batch.plans)) {
    storedPlan = batch.plans.find(plan => promptWizardStoredPlanId(plan) === source.planId) ?? null;
  }

  if (
    promptWizardStoredPlanId(storedPlan) !== source.planId
    || promptWizardStoredPlanEngineVersion(storedPlan) !== source.engineVersion
  ) {
    throw promptWizardSourceInvalidError();
  }

  const plan = promptWizardStoredPlan(storedPlan);
  const videoConfig = promptWizardVideoConfigSchema.safeParse(batch.video_config);
  if (
    !plan
    || typeof plan.prompt !== 'string'
    || !videoConfig.success
    || !Array.isArray(batch.image_asset_ids)
    || batch.image_asset_ids.some(id => typeof id !== 'string')
  ) {
    throw promptWizardSourceInvalidError();
  }
  return { plan, videoConfig: videoConfig.data, imageAssetIds: [...batch.image_asset_ids] };
}

const PROMPT_WIZARD_VIDEO_MODEL_LABELS: Record<PromptWizardVideoConfig['model'], string> = {
  'seedance-2.0': 'Seedance 2.0',
  'seedance-2.0-fast': 'Seedance 2.0 Fast',
  'seedance-2.0-mini': 'Seedance 2.0 Mini',
};

function calculatePromptWizardPromptEditBucket(
  original: string,
  edited: string,
): PromptWizardSource['editBucket'] {
  const left = original.trim().replace(/\s+/gu, ' ');
  const right = edited.trim().replace(/\s+/gu, ' ');
  if (left === right) return 'none';
  let prefixLength = 0;
  const sharedLength = Math.min(left.length, right.length);
  while (prefixLength < sharedLength && left[prefixLength] === right[prefixLength]) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < sharedLength - prefixLength
    && left[left.length - 1 - suffixLength] === right[right.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }
  const changedSpan = Math.max(left.length, right.length) - prefixLength - suffixLength;
  const roughChangeRatio = changedSpan / Math.max(1, left.length);
  return roughChangeRatio <= 0.12 ? 'minor' : 'material';
}

function canonicalPromptWizardSource(input: {
  requested: PromptWizardSource;
  context: PromptWizardSourceContext;
  model: string;
  prompt: string;
  config: Record<string, unknown>;
}): PromptWizardSource {
  const expectedConfig = input.context.videoConfig;
  const actualImageAssetIds = Array.isArray(input.config.referenceAssets)
    ? input.config.referenceAssets.flatMap((reference) => {
        if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return [];
        const item = reference as Record<string, unknown>;
        return item.type === 'image' && typeof item.id === 'string' ? [item.id] : [];
      })
    : [];
  const imageReferencesChanged = actualImageAssetIds.length !== input.context.imageAssetIds.length
    || actualImageAssetIds.some((id, index) => id !== input.context.imageAssetIds[index]);
  const configChanged = input.model !== PROMPT_WIZARD_VIDEO_MODEL_LABELS[expectedConfig.model]
    || input.config.mode !== 'general'
    || input.config.aspectRatio !== expectedConfig.aspectRatio
    || input.config.resolution !== expectedConfig.resolution
    || Number(input.config.durationSeconds) !== expectedConfig.durationSeconds
    || imageReferencesChanged;
  const editBucket = configChanged
    ? 'material'
    : calculatePromptWizardPromptEditBucket(String(input.context.plan.prompt), input.prompt);
  return { ...input.requested, editBucket };
}

function canonicalTkPromptSource(input: {
  requested: TkPromptSource;
  context: TkPromptSourceContext;
  model: string;
  prompt: string;
  config: Record<string, unknown>;
}): TkPromptSource {
  const expectedConfig = input.context.videoConfig;
  const allowedFactIds = new Set(input.context.strategy.allowedFactIds);
  const supportedFacts = input.context.factPack.facts
    .filter(fact => allowedFactIds.has(fact.factId))
    .map(fact => fact.text);
  validateTkPromptFinalExecutionPrompt({
    prompt: input.prompt,
    imageCount: input.context.imageAssetIds.length,
    videoMode: input.context.strategy.videoMode,
    durationSeconds: input.context.videoConfig.durationSeconds,
    internalIdentifiers: [
      ...input.context.imageAssetIds,
      ...input.context.factPack.facts.flatMap(fact => [fact.factId, ...fact.sourceImageIds]),
      ...tkPromptDemonstrableActionRegistry(input.context.factPack)
        .map(action => action.actionId),
    ],
    forbiddenClaims: input.context.factPack.forbiddenClaims,
    verifiedOffer: input.context.factPack.verifiedOffer,
    // 必须与方案首次编译时的语言白名单完全一致，否则目标市场、品牌或型号
    // 会在“应用到视频”阶段被误判为英文叙述漂移。
    supportedFacts: [
      input.context.factPack.productName,
      input.context.factPack.category,
      input.context.factPack.targetMarket,
      ...supportedFacts,
    ],
  });
  const actualReferenceAssets = Array.isArray(input.config.referenceAssets)
    ? input.config.referenceAssets
    : [];
  const actualImageAssetIds = actualReferenceAssets
    .flatMap((reference) => {
        if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return [];
        const item = reference as Record<string, unknown>;
        return item.type === 'image' && typeof item.id === 'string' ? [item.id] : [];
      });
  // TK 方案只授权事实分析时绑定的商品图片。旧视频、音频或畸形素材不能借由
  // “图片子集相同”夹带进入 Seedance，也不能被误记为未编辑来源。
  const hasUnexpectedReference = actualReferenceAssets.length !== actualImageAssetIds.length;
  const imageReferencesChanged = actualImageAssetIds.length !== input.context.imageAssetIds.length
    || actualImageAssetIds.some((id, index) => id !== input.context.imageAssetIds[index]);
  const configChanged = input.model !== PROMPT_WIZARD_VIDEO_MODEL_LABELS[expectedConfig.model]
    || input.config.mode !== 'general'
    || input.config.aspectRatio !== expectedConfig.aspectRatio
    || input.config.resolution !== expectedConfig.resolution
    || Number(input.config.durationSeconds) !== expectedConfig.durationSeconds;
  if (
    configChanged
    || hasUnexpectedReference
    || imageReferencesChanged
  ) {
    throw tkPromptSourceInvalidError();
  }
  return {
    ...input.requested,
    editBucket: calculatePromptWizardPromptEditBucket(
      input.context.plan.executionPrompt,
      input.prompt,
    ),
  };
}

function promptWizardEngineVersionFromTask(task: GenerationTaskRow): 2 | 3 | 4 | null {
  const version = toInt(task.prompt_wizard_engine_version);
  return version === 2 || version === 3 || version === 4 ? version : null;
}

function promptWizardEditBucketRank(bucket: PromptWizardSource['editBucket']) {
  return bucket === 'material' ? 2 : bucket === 'minor' ? 1 : 0;
}

export async function createGenerationTasksBatch(input: CreateGenerationBatchInput) {
  if (input.maxCredits !== undefined && (!Number.isSafeInteger(input.maxCredits) || input.maxCredits < 0)) {
    throw Object.assign(new Error('积分上限必须为非负整数'), { statusCode: 400, code: 'GENERATION_INVALID_CREDIT_LIMIT' });
  }
  for (const request of input.requests) {
    if (request.promptWizardSource && request.tkPromptSource) {
      throw Object.assign(new Error('同一视频任务不能同时关联两个提示词来源。'), {
        statusCode: 400,
        code: 'PROMPT_SOURCE_CONFLICT',
      });
    }
    assertPromptWizardSourceModelSupported(request);
    assertTkPromptSourceModelSupported(request);
  }

  const requestHash = createHash('sha256')
    .update(canonicalJson(input.maxCredits === undefined ? input.requests : { requests: input.requests, maxCredits: input.maxCredits }))
    .digest('hex');

  return withTransaction(async client => {
    if (input.mcpConnectionId) {
      const authorization = await client.query(
        `SELECT c.id FROM mcp_connections c JOIN users u ON u.id=c.user_id
         WHERE c.id=$1 AND c.user_id=$2 AND c.revoked_at IS NULL
           AND c.created_at > now() - interval '30 days' AND u.auth_version=c.auth_version
           AND u.status <> 'frozen' AND 'generation:write'=ANY(c.scopes) FOR SHARE OF c`,
        [input.mcpConnectionId, input.userId],
      );
      if (!authorization.rowCount) throw Object.assign(new Error('MCP 授权已失效'), { statusCode: 401, code: 'MCP_AUTH_INVALID' });
    }
    const insertedBatch = await client.query<{ id: string }>(
      `INSERT INTO generation_batches (user_id, idempotency_key, request_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [input.userId, input.idempotencyKey, requestHash],
    );

    if (!insertedBatch.rowCount) {
      const existing = await client.query<{ request_hash: string; task_ids: string[] }>(
        `SELECT request_hash, task_ids
         FROM generation_batches
         WHERE user_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [input.userId, input.idempotencyKey],
      );
      const batch = existing.rows[0];
      if (!batch || batch.request_hash !== requestHash) {
        throw Object.assign(new Error('幂等键已用于其他批量请求'), {
          statusCode: 409,
          code: 'GENERATION_IDEMPOTENCY_CONFLICT',
        });
      }
      const tasks = batch.task_ids.length > 0
        ? await client.query<GenerationTaskRow>(
          `SELECT * FROM generation_tasks
           WHERE id = ANY($1::uuid[])
           ORDER BY array_position($1::uuid[], id)`,
          [batch.task_ids],
        )
        : { rows: [] };
      return tasks.rows.map(mapGenerationTask);
    }

    await reconcileSubscriptionWithClient(client, input.userId);
    const userResult = await client.query<{
      id: string;
      status: string;
      main_credits: number;
      addon_credits: number;
    }>(
      `SELECT id, status, main_credits, addon_credits
       FROM users WHERE id = $1 FOR UPDATE`,
      [input.userId],
    );
    const user = userResult.rows[0];
    if (!user) throw Object.assign(new Error('未找到用户'), { statusCode: 404 });
    if (user.status === 'frozen') throw Object.assign(new Error('账号已冻结，无法创建生成任务'), { statusCode: 403 });

    const prepared: Array<{
      request: CreateGenerationBatchInput['requests'][number];
      config: Record<string, unknown>;
      credits: number;
      realPortraitReference: RealPortraitGenerationReference | null;
      promptWizardSource?: PromptWizardSource;
      tkPromptSource?: TkPromptSource;
    }> = [];
    const promptWizardSourceContexts = new Map<string, PromptWizardSourceContext>();
    const tkPromptSourceContexts = new Map<string, TkPromptSourceContext>();
    for (const request of input.requests) {
      let promptWizardSourceContext: PromptWizardSourceContext | undefined;
      if (request.promptWizardSource) {
        const sourceKey = canonicalJson({
          runId: request.promptWizardSource.runId,
          batchId: request.promptWizardSource.batchId,
          planId: request.promptWizardSource.planId,
          planRevisionId: request.promptWizardSource.planRevisionId ?? null,
          engineVersion: request.promptWizardSource.engineVersion,
        });
        promptWizardSourceContext = promptWizardSourceContexts.get(sourceKey);
        if (!promptWizardSourceContext) {
          promptWizardSourceContext = await readPromptWizardSourceContextWithClient(
            client,
            input.userId,
            request.kind,
            request.promptWizardSource,
          );
          promptWizardSourceContexts.set(sourceKey, promptWizardSourceContext);
        }
      }
      let tkPromptSourceContext: TkPromptSourceContext | undefined;
      if (request.tkPromptSource) {
        const sourceKey = canonicalJson({
          runId: request.tkPromptSource.runId,
          generationId: request.tkPromptSource.generationId,
          optionId: request.tkPromptSource.optionId,
          schemaVersion: request.tkPromptSource.schemaVersion,
        });
        tkPromptSourceContext = tkPromptSourceContexts.get(sourceKey);
        if (!tkPromptSourceContext) {
          tkPromptSourceContext = await readTkPromptSourceContextWithClient(
            client,
            input.userId,
            request.kind,
            request.tkPromptSource,
          );
          tkPromptSourceContexts.set(sourceKey, tkPromptSourceContext);
        }
      }
      const realPortraitReference = request.kind === 'video' && request.realPortrait
        ? await resolveRealPortraitGenerationReferenceWithClient(client, input.userId, request.realPortrait)
        : null;
      const config = await sanitizeGenerationConfig(client, {
        ...request,
        userId: input.userId,
      }, realPortraitReference);
      const credits = await getGenerationCredits(client, {
        kind: request.kind,
        model: request.model,
        durationSeconds: toOptionalNumber(config.durationSeconds ?? config.duration),
        resolution: toOptionalString(config.resolution),
        hasReferenceVideo: hasSeedanceVideoInput(config),
      });
      if (credits <= 0) {
        throw Object.assign(new Error('当前模型或配置暂不开放'), { statusCode: 400 });
      }
      prepared.push({
        request,
        config,
        credits,
        realPortraitReference,
        ...(request.promptWizardSource && promptWizardSourceContext ? {
          // 来源标识由客户端提交，但编辑幅度必须由服务端以持久化原稿和最终生产
          // 配置重新计算，防止伪造“未实质编辑”污染核心质量指标。
          promptWizardSource: canonicalPromptWizardSource({
            requested: request.promptWizardSource,
            context: promptWizardSourceContext,
            model: request.model,
            prompt: request.prompt,
            config,
          }),
        } : {}),
        ...(request.tkPromptSource && tkPromptSourceContext ? {
          // TK 来源允许用户在 AI Studio 编辑提示词，但视频配置、商品图片顺序和
          // 只含商品参考图；live_presenter 由 Seedance 自动生成同一虚构主持人。
          // editBucket 始终由服务端重算。
          tkPromptSource: canonicalTkPromptSource({
            requested: request.tkPromptSource,
            context: tkPromptSourceContext,
            model: request.model,
            prompt: request.prompt,
            config,
          }),
        } : {}),
      });
    }

    // 用户确认到积分批次规划之间可能跨过演员授权或套餐宽限期。再次以墙上时钟
    // 解析并核对同一服务端绑定，保证任何失效都发生在积分预扣之前。
    for (const item of prepared) {
      if (!item.realPortraitReference || !item.request.realPortrait) continue;
      const refreshed = await resolveRealPortraitGenerationReferenceWithClient(
        client,
        input.userId,
        item.request.realPortrait,
      );
      const original = item.realPortraitReference;
      if (
        refreshed.actorId !== original.actorId
        || refreshed.portraitAssetId !== original.portraitAssetId
        || refreshed.authorizationId !== original.authorizationId
        || refreshed.materializationId !== original.materializationId
        || refreshed.authorizationVersion !== original.authorizationVersion
        || refreshed.providerAssetId !== original.providerAssetId
      ) {
        throw tkPromptSourceInvalidError();
      }
    }

    const totalCredits = prepared.reduce((sum, item) => sum + item.credits, 0);
    if (input.maxCredits !== undefined && totalCredits > input.maxCredits) {
      throw Object.assign(new Error(`当前需要 ${totalCredits} 积分，超过本次允许的 ${input.maxCredits} 积分，请重新估价`), {
        statusCode: 409, code: 'GENERATION_CREDIT_LIMIT_EXCEEDED',
      });
    }
    let mainBalance = toInt(user.main_credits);
    let addonBalance = toInt(user.addon_credits);
    const lotPlans = await planGenerationLotAllocationsWithClient(
      client,
      input.userId,
      prepared.map(item => item.credits),
    );
    const allocations = lotPlans.map(plan => {
      if (mainBalance < plan.mainAmount || addonBalance < plan.addonAmount) {
        throw generationCreditCacheMismatchError(input.userId);
      }
      mainBalance -= plan.mainAmount;
      addonBalance -= plan.addonAmount;
      return {
        mainCreditsUsed: plan.mainAmount,
        addonCreditsUsed: plan.addonAmount,
        balance: mainBalance + addonBalance,
      };
    });

    const tasks: GenerationTaskRow[] = [];
    for (let index = 0; index < prepared.length; index += 1) {
      const item = prepared[index]!;
      const allocation = allocations[index]!;
      const taskResult = await client.query<GenerationTaskRow>(
        `INSERT INTO generation_tasks (
           user_id, kind, model, status, processing_stage, prompt, config, credits,
           reserved_credits, credit_status, main_credits_used, addon_credits_used,
           prompt_wizard_source, tk_prompt_source
         )
         VALUES ($1, $2, $3, 'queued', 'queued', $4, $5, $6, $6, 'held', $7, $8, $9::jsonb, $10::jsonb)
         RETURNING *`,
        [
          input.userId,
          item.request.kind,
          item.request.model,
          item.request.prompt,
          item.config,
          item.credits,
          allocation.mainCreditsUsed,
          allocation.addonCreditsUsed,
          item.promptWizardSource ?? null,
          item.tkPromptSource ?? null,
        ],
      );
      const task = taskResult.rows[0]!;
      tasks.push(task);
      if (item.realPortraitReference) {
        await bindRealPortraitGenerationReferenceWithClient(client, {
          taskId: task.id,
          taskAttempt: toInt(task.attempt),
          position: 0,
          reference: item.realPortraitReference,
        });
      }
      const holdEventKey = generationHoldEventKey(task.id, toInt(task.attempt));
      await holdGenerationLotsWithClient({
        client,
        userId: input.userId,
        taskId: task.id,
        attempt: toInt(task.attempt),
        mainAmount: allocation.mainCreditsUsed,
        addonAmount: allocation.addonCreditsUsed,
        eventKey: holdEventKey,
      });
      await client.query(
        `INSERT INTO credit_ledger (
           user_id, type, bucket, settlement_status, amount, balance, source,
           operator, note, related_job_id, business_event_key
         )
         VALUES ($1, 'hold', $2, 'held', $3, $4, $5, 'system', $6, $7, $8)
         ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO NOTHING`,
        [
          input.userId,
          bucketForUsage(allocation.mainCreditsUsed, allocation.addonCreditsUsed),
          -item.credits,
          allocation.balance,
          `${item.request.model} 生成预扣`,
          creditLedgerNotes.generationHeld,
          task.id,
          holdEventKey,
        ],
      );
    }

    const appliedSources = new Map<string, PromptWizardSource>();
    for (const item of prepared) {
      const source = item.promptWizardSource;
      if (!source) continue;
      const sourceKey = [
        source.runId,
        source.batchId,
        source.planId,
        source.planRevisionId ?? '',
        source.engineVersion,
      ].join(':');
      const existing = appliedSources.get(sourceKey);
      if (!existing || promptWizardEditBucketRank(source.editBucket) > promptWizardEditBucketRank(existing.editBucket)) {
        appliedSources.set(sourceKey, source);
      }
    }
    for (const engineVersion of [2, 3, 4] as const) {
      const sources = [...appliedSources.values()].filter(source => source.engineVersion === engineVersion);
      if (sources.length === 0) continue;
      await incrementPromptWizardDailyMetricsWithClient(client, engineVersion, {
        appliedPlans: sources.length,
        noMaterialEditApplies: sources.filter(source => source.editBucket !== 'material').length,
      });
    }

    await setUserAvailableCreditsWithClient(client, input.userId);

    await client.query(
      `UPDATE generation_batches SET task_ids = $3::uuid[]
       WHERE user_id = $1 AND idempotency_key = $2`,
      [input.userId, input.idempotencyKey, tasks.map(task => task.id)],
    );

    return tasks.map(mapGenerationTask);
  });
}

export async function retryGenerationTask(taskId: string, operatorUserId: string) {
  return withTransaction(client => retryGenerationTaskWithClient(client, taskId, operatorUserId));
}

export async function retryGenerationTaskWithClient(client: DbClient, taskId: string, operatorUserId: string) {
    const taskResult = await client.query<GenerationTaskRow>(
      `SELECT task.*,
              EXISTS (
                SELECT 1
                FROM generation_provider_runs run
                WHERE run.task_id = task.id
                  AND run.status IN (
                    'prepared', 'submitting', 'submitted', 'submission-unknown',
                    'provider-running', 'provider-succeeded', 'archiving',
                    'settlement-pending', 'delivery-failed', 'manual-review'
                  )
              ) AS has_unresolved_provider_run
       FROM generation_tasks task
       WHERE task.id = $1
       FOR UPDATE`,
      [taskId],
    );
    const task = taskResult.rows[0];
    if (!task) throw Object.assign(new Error('未找到生成任务'), { statusCode: 404 });
    if (task.status !== 'failed' || task.credit_status !== 'refunded') {
      throw Object.assign(new Error('只有失败且积分已退回的任务可以重试'), {
        statusCode: 409,
        code: 'GENERATION_RETRY_STATE_CONFLICT',
      });
    }
    if (task.asset_id) {
      throw Object.assign(new Error('任务已生成数字资产，不能重试'), {
        statusCode: 409,
        code: 'GENERATION_RETRY_ASSET_CONFLICT',
      });
    }
    if (task.has_unresolved_provider_run) {
      throw Object.assign(new Error('任务仍有未决供应商执行，不能重试'), {
        statusCode: 409,
        code: 'GENERATION_PROVIDER_RUN_UNRESOLVED',
      });
    }

    // 历史任务可能引用已删除素材，或来自漏洞修复前的非规范配置。重试必须和新建任务
    // 使用同一条资产归属边界，并且要在任何积分扣减之前失败。
    const retryPortraitReference = task.kind === 'video'
      ? await resolveHistoricalRealPortraitReferenceWithClient(client, task)
      : null;
    const sanitizedConfig: Record<string, unknown> = task.kind === 'video'
      ? await sanitizeHistoricalSeedanceVideoConfig({
        client,
        userId: task.user_id,
        model: task.model,
        config: task.config,
        realPortraitReference: retryPortraitReference,
      })
      : await sanitizeHistoricalSeedreamImageConfig({
        client,
        userId: task.user_id,
        model: task.model,
        prompt: task.prompt,
        config: task.config,
      });
    const retryCredits = await getGenerationCredits(client, {
      kind: task.kind,
      model: task.model,
      durationSeconds: toOptionalNumber(sanitizedConfig.durationSeconds ?? sanitizedConfig.duration),
      resolution: toOptionalString(sanitizedConfig.resolution),
      hasReferenceVideo: hasSeedanceVideoInput(sanitizedConfig),
    });
    if (retryCredits <= 0) {
      throw Object.assign(new Error('当前模型或配置暂不开放，无法重试'), { statusCode: 400 });
    }

    const userResult = await client.query<{
      main_credits: number;
      addon_credits: number;
    }>(
      `SELECT main_credits, addon_credits FROM users WHERE id = $1 FOR UPDATE`,
      [task.user_id],
    );
    const user = userResult.rows[0];
    if (!user) throw Object.assign(new Error('未找到用户积分账户'), { statusCode: 404 });

    const [lotPlan] = await planGenerationLotAllocationsWithClient(client, task.user_id, [retryCredits]);
    const mainCreditsUsed = lotPlan!.mainAmount;
    const addonCreditsUsed = lotPlan!.addonAmount;
    if (
      toInt(user.main_credits) < mainCreditsUsed
      || toInt(user.addon_credits) < addonCreditsUsed
    ) throw generationCreditCacheMismatchError(task.user_id);
    const updated = await client.query<GenerationTaskRow>(
      `UPDATE generation_tasks
       SET status = 'queued',
           processing_stage = 'queued',
           failure_category = NULL,
           failure_reason = NULL,
           provider_task_id = NULL,
           provider_task_attempt = NULL,
           provider_result = NULL,
           settlement_error = NULL,
           claim_token = NULL,
           active_provider_run_id = NULL,
           lease_expires_at = NULL,
           heartbeat_at = NULL,
           cancel_requested_at = NULL,
           cancel_requested_by = NULL,
           cancel_state = 'none',
           credits = $5,
           reserved_credits = $5,
           settled_credits = 0,
           refunded_credits = 0,
           credit_status = 'held',
           main_credits_used = $2,
           addon_credits_used = $3,
           config = $4,
           retry_count = retry_count + 1,
           attempt = attempt + 1,
           started_at = NULL,
           completed_at = NULL,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [taskId, mainCreditsUsed, addonCreditsUsed, sanitizedConfig, retryCredits],
    );

    const nextAttempt = toInt(task.attempt) + 1;
    if (retryPortraitReference) {
      await bindRealPortraitGenerationReferenceWithClient(client, {
        taskId: task.id,
        taskAttempt: nextAttempt,
        position: 0,
        reference: retryPortraitReference,
      });
    }
    const holdEventKey = generationHoldEventKey(task.id, nextAttempt);
    await holdGenerationLotsWithClient({
      client,
      userId: task.user_id,
      taskId: task.id,
      attempt: nextAttempt,
      mainAmount: mainCreditsUsed,
      addonAmount: addonCreditsUsed,
      eventKey: holdEventKey,
    });
    const syncedCredits = await setUserAvailableCreditsWithClient(client, task.user_id);

    await client.query(
      `INSERT INTO credit_ledger (
         user_id, type, bucket, settlement_status, amount, balance, source,
         operator, note, related_job_id, business_event_key
       )
       VALUES ($1, 'hold', $2, 'held', $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO NOTHING`,
      [
        task.user_id,
        bucketForUsage(mainCreditsUsed, addonCreditsUsed),
        -retryCredits,
        syncedCredits.balance,
        `${task.model} 失败重试预扣`,
        operatorUserId,
        creditLedgerNotes.generationRetryHeld,
        task.id,
        holdEventKey,
      ],
    );

    await client.query(
      `INSERT INTO audit_logs (admin_user_id, admin_email, module, action, target, risk, detail)
       SELECT $1, email, '生成任务', '失败重试', $2, 'medium', $3
       FROM users WHERE id = $1`,
      [operatorUserId, task.id, `按当前配置重新预扣 ${retryCredits} 积分并将任务放回队列。`],
    );

  return mapGenerationTask(updated.rows[0]!);
}

/** 供应商终态已确认后收口待取消任务；调用前的 observation 仍是成本主记录。 */
export async function finalizeRequestedTaskCancellation(
  taskId: string,
  expectedAttempt: number,
  claimToken: string,
  result: ProviderSuccess | ProviderFailure,
) {
  // 成片成功即代表供应商已经完成工作；取消来得太晚，继续走普通资产交付和结算。
  if (result.ok) return null;
  if (result.terminal !== true) return null;
  return withTransaction(async client => {
    const taskResult = await client.query<GenerationTaskRow>(
      `SELECT * FROM generation_tasks
       WHERE id = $1
         AND attempt = $2
         AND claim_token = $3
         AND cancel_requested_at IS NOT NULL
       FOR UPDATE`,
      [taskId, expectedAttempt, claimToken],
    );
    const task = taskResult.rows[0];
    if (!task) return null;
    if (task.status === 'canceled') return mapGenerationTask(task);

    await upsertProviderUsageRecord(
      client,
      task,
      result,
      'failed',
      result.reason,
    );

    const creditRelease = task.credit_status === 'held'
      ? await refundHeldCreditsForCancellation(client, task)
      : null;
    const providerStatus = result.providerStatus?.trim().toLowerCase() ?? 'unknown';
    const providerRunStatus = result.billingDisposition === 'unbilled'
      && ['cancelled', 'canceled'].includes(providerStatus)
      ? 'refunded'
      : 'provider-failed';

    const updated = await client.query<GenerationTaskRow>(
      `UPDATE generation_tasks
       SET status = 'canceled',
           processing_stage = 'canceled',
           cancel_state = 'canceled',
           provider_task_id = COALESCE($4, provider_task_id),
           provider_result = NULL,
           settlement_error = NULL,
           claim_token = NULL,
           lease_expires_at = NULL,
           heartbeat_at = now(),
           failure_category = 'user-canceled',
           failure_reason = $5,
           settled_credits = CASE
             WHEN credit_status = 'held' THEN 0
             ELSE settled_credits
           END,
           refunded_credits = CASE
             WHEN credit_status = 'held' THEN $6
             ELSE refunded_credits
           END,
           credit_status = CASE
             WHEN credit_status = 'held' THEN 'refunded'
             ELSE credit_status
           END,
           completed_at = now(),
           updated_at = now()
       WHERE id = $1 AND attempt = $2 AND claim_token = $3
       RETURNING *`,
      [
        task.id,
        expectedAttempt,
        claimToken,
        result.providerTaskId ?? null,
        describeTerminalCancellationRelease(creditRelease),
        creditRelease?.returnedCredits ?? 0,
      ],
    );
    if (updated.rowCount && task.active_provider_run_id) {
      await client.query(
        `UPDATE generation_provider_runs
         SET status = $4, lease_token = NULL, lease_expires_at = NULL,
             heartbeat_at = now(), completed_at = now(), updated_at = now()
         WHERE id = $1 AND task_attempt = $2 AND lease_token = $3`,
        [
          task.active_provider_run_id,
          expectedAttempt,
          claimToken,
          providerRunStatus,
        ],
      );
    }
    return updated.rows[0] ? mapGenerationTask(updated.rows[0]) : null;
  });
}

export async function markTaskProcessing(taskId: string, attempt?: number) {
  return withTransaction(async client => {
    const claimed = await client.query<GenerationTaskRow>(
      `UPDATE generation_tasks
       SET status = 'processing',
           processing_stage = CASE
             WHEN provider_result IS NOT NULL THEN 'settlement-pending'
             WHEN provider_task_id IS NOT NULL THEN 'provider-running'
             ELSE 'prepared'
           END,
           claim_token = gen_random_uuid(),
           claim_epoch = claim_epoch + 1,
           started_at = COALESCE(started_at, now()),
           heartbeat_at = now(),
           lease_expires_at = now() + interval '25 seconds',
           updated_at = now()
       WHERE id = $1
         AND attempt = COALESCE($2, attempt)
         AND processing_stage NOT IN ('submission-unknown', 'manual-review')
         AND (
           status = 'queued'
           OR (status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at < now())
         )
       RETURNING *`,
      [taskId, attempt ?? null],
    );
    const task = claimed.rows[0];
    if (!task?.claim_token) return null;

    const requestHash = createHash('sha256')
      .update(canonicalJson({ kind: task.kind, model: task.model, prompt: task.prompt, config: task.config }))
      .digest('hex');
    const objectKeys = buildProviderRunObjectKeys(task);
    const runResult = await client.query<GenerationProviderRunRow>(
      `INSERT INTO generation_provider_runs (
         task_id, task_attempt, provider, request_hash, submission_key, status,
         provider_task_id, lease_token, lease_expires_at, heartbeat_at,
         output_object_key, thumbnail_object_key, staging_object_key, provider_result
       )
       VALUES (
         $1, $2, $3, $4, $5,
         CASE WHEN $6::jsonb IS NOT NULL THEN 'settlement-pending'
              WHEN $7::text IS NOT NULL THEN 'provider-running'
              ELSE 'prepared' END,
         $7, $8, now() + interval '25 seconds', now(), $9, $10, $11, $6
       )
       ON CONFLICT (task_id, task_attempt) DO UPDATE
       SET lease_token = EXCLUDED.lease_token,
           lease_expires_at = EXCLUDED.lease_expires_at,
           heartbeat_at = now(),
           updated_at = now()
       WHERE generation_provider_runs.status NOT IN (
         'submission-unknown', 'settled', 'refunded', 'manual-review'
       )
       RETURNING *`,
      [
        task.id,
        task.attempt,
        selectGenerationProviderName({
          kind: task.kind,
          model: task.model,
          providerTaskId: task.provider_task_id,
        }),
        requestHash,
        `${task.id}:${task.attempt}`,
        task.provider_result,
        task.provider_task_id,
        task.claim_token,
        objectKeys.outputObjectKey,
        objectKeys.thumbnailObjectKey,
        objectKeys.stagingObjectKey,
      ],
    );
    const run = runResult.rows[0];
    if (!run) return null;

    await client.query(
      `UPDATE generation_tasks
       SET active_provider_run_id = $3
       WHERE id = $1 AND attempt = $2 AND claim_token = $4`,
      [task.id, task.attempt, run.id, task.claim_token],
    );

    return {
      id: task.id,
      attempt: toInt(task.attempt),
      claimToken: task.claim_token,
      claimEpoch: toInt(task.claim_epoch),
      providerRunId: run.id,
      providerRunStatus: run.status,
      callbackToken: run.callback_token,
      providerTaskId: run.provider_task_id,
      providerResult: run.provider_result,
      providerRequestId: run.provider_request_id,
      providerResponseCheckpoint: run.provider_response_checkpoint,
      providerResponseUrl: run.provider_response_url,
      providerResponseObservedAt: toIsoDateTime(run.provider_response_observed_at),
      providerResponseUrlExpiresAt: toIsoDateTime(run.provider_response_url_expires_at),
      outputObjectKey: run.output_object_key,
      thumbnailObjectKey: run.thumbnail_object_key ?? objectKeys.thumbnailObjectKey,
      stagingObjectKey: run.staging_object_key,
    } satisfies GenerationTaskClaim;
  });
}

export async function markProviderSubmissionStarted(taskId: string, attempt: number, claimToken: string) {
  return withTransaction(async client => {
    await assertRealPortraitGenerationReferenceStillUsableWithClient(client, taskId, attempt);
    const run = await client.query<{ id: string }>(
      `UPDATE generation_provider_runs run
       SET status = 'submitting', submitted_at = COALESCE(submitted_at, now()),
           heartbeat_at = now(), lease_expires_at = now() + interval '25 seconds', updated_at = now()
       FROM generation_tasks task
       WHERE run.id = task.active_provider_run_id
         AND task.id = $1 AND task.attempt = $2
         AND task.claim_token = $3 AND run.lease_token = $3
         AND task.status = 'processing' AND task.cancel_requested_at IS NULL
         AND run.status = 'prepared'
       RETURNING run.id`,
      [taskId, attempt, claimToken],
    );
    if (!run.rowCount) return false;
    await client.query(
      `UPDATE generation_tasks
       SET processing_stage = 'submitting', updated_at = now()
       WHERE id = $1 AND attempt = $2 AND claim_token = $3`,
      [taskId, attempt, claimToken],
    );
    return true;
  });
}

export async function recordProviderResponseCheckpoint(
  taskId: string,
  attempt: number,
  claimToken: string,
  checkpoint: {
    providerOperationId: string;
    providerRequestId: string | null;
    response: Record<string, unknown>;
    responseUrl: string;
    observedAt: string;
    responseUrlExpiresAt: string;
  },
) {
  return withTransaction(async client => {
    const runResult = await client.query<GenerationProviderRunRow>(
      `UPDATE generation_provider_runs run
       SET provider_task_id = COALESCE(run.provider_task_id, $4),
           provider_request_id = COALESCE(run.provider_request_id, $5),
           provider_response_checkpoint = COALESCE(run.provider_response_checkpoint, $6::jsonb),
           provider_response_url = COALESCE(run.provider_response_url, $7),
           provider_response_observed_at = COALESCE(run.provider_response_observed_at, $8::timestamptz),
           provider_response_url_expires_at = COALESCE(run.provider_response_url_expires_at, $9::timestamptz),
           status = 'provider-succeeded', heartbeat_at = now(),
           lease_expires_at = now() + interval '25 seconds', last_error = NULL, updated_at = now()
       FROM generation_tasks task
       WHERE run.task_id = $1 AND run.task_attempt = $2 AND run.lease_token = $3
         AND task.id = run.task_id AND task.attempt = run.task_attempt AND task.claim_token = $3
         AND run.status IN ('submitting', 'submitted', 'provider-running', 'provider-succeeded', 'archiving')
         AND (run.provider_task_id IS NULL OR run.provider_task_id = $4)
         AND (run.provider_request_id IS NULL OR run.provider_request_id IS NOT DISTINCT FROM $5)
         AND (run.provider_response_checkpoint IS NULL OR run.provider_response_checkpoint = $6::jsonb)
       RETURNING run.*`,
      [
        taskId,
        attempt,
        claimToken,
        checkpoint.providerOperationId,
        checkpoint.providerRequestId,
        checkpoint.response,
        checkpoint.responseUrl,
        checkpoint.observedAt,
        checkpoint.responseUrlExpiresAt,
      ],
    );
    const run = runResult.rows[0];
    if (!run) return null;

    const taskResult = await client.query<GenerationTaskRow>(
      `UPDATE generation_tasks
       SET provider_task_id = COALESCE(provider_task_id, $4),
           provider_task_attempt = COALESCE(provider_task_attempt, $2),
           processing_stage = 'provider-succeeded', heartbeat_at = now(),
           lease_expires_at = now() + interval '25 seconds', updated_at = now()
       WHERE id = $1 AND attempt = $2 AND claim_token = $3 AND status = 'processing'
         AND (provider_task_id IS NULL OR provider_task_id = $4)
       RETURNING *`,
      [taskId, attempt, claimToken, checkpoint.providerOperationId],
    );
    return taskResult.rows[0] ? mapGenerationTask(taskResult.rows[0]) : null;
  });
}

/** Seedream 临时 URL 只允许在原图成功归档后清除，清除后数据库触发器禁止恢复。 */
export async function clearProviderResponseUrlAfterArchive(
  taskId: string,
  attempt: number,
  claimToken: string,
  providerOperationId: string,
) {
  return withTransaction(async client => {
    const run = await client.query<{ id: string }>(
      `UPDATE generation_provider_runs
       SET provider_response_url = NULL, status = 'archiving',
           heartbeat_at = now(), lease_expires_at = now() + interval '25 seconds', updated_at = now()
       WHERE task_id = $1 AND task_attempt = $2 AND lease_token = $3
         AND provider_task_id = $4 AND provider_response_checkpoint IS NOT NULL
         AND status IN ('provider-succeeded', 'archiving')
       RETURNING id`,
      [taskId, attempt, claimToken, providerOperationId],
    );
    if (!run.rowCount) return false;
    await client.query(
      `UPDATE generation_tasks
       SET processing_stage = 'archiving', heartbeat_at = now(),
           lease_expires_at = now() + interval '25 seconds', updated_at = now()
       WHERE id = $1 AND attempt = $2 AND claim_token = $3 AND provider_task_id = $4`,
      [taskId, attempt, claimToken, providerOperationId],
    );
    return true;
  });
}

export async function markProviderSubmissionUnknown(
  taskId: string,
  attempt: number,
  claimToken: string,
  error: unknown,
) {
  return withTransaction(async client => {
    const message = safeErrorMessage(error);
    const run = await client.query<{ id: string }>(
      `UPDATE generation_provider_runs
       SET status = 'submission-unknown', last_error = $4,
           lease_token = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE task_id = $1 AND task_attempt = $2 AND lease_token = $3
         AND status = 'submitting'
       RETURNING id`,
      [taskId, attempt, claimToken, message],
    );
    if (!run.rowCount) return false;
    await client.query(
      `UPDATE generation_tasks
       SET processing_stage = 'submission-unknown', settlement_error = $4,
           claim_token = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND attempt = $2 AND claim_token = $3`,
      [taskId, attempt, claimToken, message],
    );
    return true;
  });
}

/** worker 已认领任务，但在供应商 POST 前观察到取消请求时，安全释放预扣。 */
export async function cancelClaimedTaskBeforeSubmission(
  taskId: string,
  attempt: number,
  claimToken: string,
) {
  return withTransaction(async client => {
    const taskResult = await client.query<GenerationTaskRow>(
      `SELECT task.*
       FROM generation_tasks task
       JOIN generation_provider_runs run ON run.id = task.active_provider_run_id
       WHERE task.id = $1 AND task.attempt = $2 AND task.claim_token = $3
         AND task.status = 'processing' AND task.cancel_requested_at IS NOT NULL
         AND run.lease_token = $3 AND run.status = 'prepared'
       FOR UPDATE OF task`,
      [taskId, attempt, claimToken],
    );
    const task = taskResult.rows[0];
    if (!task) return null;

    const creditRelease = task.credit_status === 'held'
      ? await refundHeldCreditsForCancellation(client, task)
      : null;
    const updated = await client.query<GenerationTaskRow>(
      `UPDATE generation_tasks
       SET status = 'canceled', processing_stage = 'canceled', cancel_state = 'canceled',
           failure_category = 'user-canceled',
           failure_reason = $4,
           refunded_credits = CASE WHEN credit_status = 'held' THEN $5 ELSE refunded_credits END,
           credit_status = CASE WHEN credit_status = 'held' THEN 'refunded' ELSE credit_status END,
           claim_token = NULL, lease_expires_at = NULL, completed_at = now(), updated_at = now()
       WHERE id = $1 AND attempt = $2 AND claim_token = $3
       RETURNING *`,
      [
        taskId,
        attempt,
        claimToken,
        describePreSubmissionCancellationRelease(creditRelease),
        creditRelease?.returnedCredits ?? 0,
      ],
    );
    if (updated.rowCount) {
      await client.query(
        `UPDATE generation_provider_runs
         SET status = 'refunded', lease_token = NULL, lease_expires_at = NULL,
             completed_at = now(), updated_at = now()
         WHERE id = $1 AND task_attempt = $2 AND lease_token = $3`,
        [task.active_provider_run_id, attempt, claimToken],
      );
    }
    return updated.rows[0] ? mapGenerationTask(updated.rows[0]) : null;
  });
}

export async function recordProviderTaskId(
  taskId: string,
  attempt: number,
  claimToken: string,
  providerTaskId: string,
) {
  const result = await withTransaction(async client => {
    const provider = inferProviderName(providerTaskId);
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`generation-provider-task:${provider}:${providerTaskId}`],
    );
    const duplicate = await client.query<{ id: string }>(
      `SELECT id FROM generation_provider_runs
       WHERE provider = $1 AND provider_task_id = $2
         AND NOT (task_id = $3 AND task_attempt = $4)
       LIMIT 1`,
      [provider, providerTaskId, taskId, attempt],
    );
    if (duplicate.rowCount) {
      await client.query(
        `UPDATE generation_provider_runs
         SET status = 'manual-review', last_error = 'provider_task_id 已绑定其他生成 run',
             lease_token = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE task_id = $1 AND task_attempt = $2 AND lease_token = $3`,
        [taskId, attempt, claimToken],
      );
      await client.query(
        `UPDATE generation_tasks
         SET processing_stage = 'manual-review', settlement_error = 'provider_task_id 绑定冲突',
             claim_token = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE id = $1 AND attempt = $2 AND claim_token = $3`,
        [taskId, attempt, claimToken],
      );
      return { rows: [] as GenerationTaskRow[] };
    }
    const run = await client.query<{ id: string }>(
      `UPDATE generation_provider_runs
       SET provider = $5, provider_task_id = COALESCE(provider_task_id, $4),
           status = 'submitted', heartbeat_at = now(),
           lease_expires_at = now() + interval '25 seconds', updated_at = now()
       WHERE task_id = $1 AND task_attempt = $2 AND lease_token = $3
         AND status IN ('submitting', 'submitted', 'provider-running')
         AND (provider_task_id IS NULL OR provider_task_id = $4)
       RETURNING id`,
      [taskId, attempt, claimToken, providerTaskId, provider],
    );
    if (!run.rowCount) return { rows: [] as GenerationTaskRow[] };
    return client.query<GenerationTaskRow>(
      `UPDATE generation_tasks
       SET provider_task_id = COALESCE(provider_task_id, $4),
           provider_task_attempt = COALESCE(provider_task_attempt, $2),
           processing_stage = 'submitted', heartbeat_at = now(),
           lease_expires_at = now() + interval '25 seconds', updated_at = now()
       WHERE id = $1 AND attempt = $2 AND claim_token = $3 AND status = 'processing'
         AND (provider_task_id IS NULL OR provider_task_id = $4)
       RETURNING *`,
      [taskId, attempt, claimToken, providerTaskId],
    );
  });
  return result.rows[0] ? mapGenerationTask(result.rows[0]) : null;
}

export async function heartbeatGenerationTask(taskId: string, attempt: number, claimToken: string) {
  const result = await withTransaction(async client => client.query<{ id: string }>(
    `WITH live_run AS (
       UPDATE generation_provider_runs
       SET heartbeat_at = now(), lease_expires_at = now() + interval '25 seconds', updated_at = now()
       WHERE task_id = $1 AND task_attempt = $2 AND lease_token = $3
         AND status NOT IN ('submission-unknown', 'settled', 'refunded', 'manual-review')
       RETURNING id
     )
     UPDATE generation_tasks task
     SET heartbeat_at = now(), lease_expires_at = now() + interval '25 seconds', updated_at = now()
     FROM live_run
     WHERE task.id = $1 AND task.attempt = $2 AND task.claim_token = $3
       AND task.active_provider_run_id = live_run.id AND task.status = 'processing'
     RETURNING task.id`,
    [taskId, attempt, claimToken],
  ));
  return Boolean(result.rowCount);
}

/** 仅当前 claim 可以读取取消标记，避免旧 worker 代替新 attempt 请求上游取消。 */
export async function isClaimedGenerationTaskCancellationRequested(
  taskId: string,
  attempt: number,
  claimToken: string,
) {
  const result = await withTransaction(async client => client.query<{ requested: boolean }>(
    `SELECT task.cancel_requested_at IS NOT NULL AS requested
     FROM generation_tasks task
     JOIN generation_provider_runs run ON run.id = task.active_provider_run_id
     WHERE task.id = $1 AND task.attempt = $2 AND task.claim_token = $3
       AND task.status = 'processing' AND run.lease_token = $3
     LIMIT 1`,
    [taskId, attempt, claimToken],
  ));
  return result.rows[0]?.requested === true;
}

export async function markTaskProviderSucceeded(
  taskId: string,
  attempt: number,
  claimToken: string,
  providerResult: ProviderSuccess,
) {
  const result = await withTransaction(async client => {
    const run = await client.query<{ id: string }>(
      `UPDATE generation_provider_runs
       SET status = 'settlement-pending', provider_result = $5,
           provider_terminal_at = COALESCE($6::timestamptz, now()),
           heartbeat_at = now(), lease_expires_at = now() + interval '25 seconds',
           last_error = NULL, updated_at = now()
       WHERE task_id = $1 AND task_attempt = $2 AND lease_token = $3
         AND provider_task_id = $4
         AND status IN ('submitted', 'provider-running', 'provider-succeeded', 'archiving', 'settlement-pending')
       RETURNING id`,
      [taskId, attempt, claimToken, providerResult.providerTaskId, providerResult, providerResult.providerTerminalAt ?? null],
    );
    if (!run.rowCount) return { rows: [] as GenerationTaskRow[] };
    const updated = await client.query<GenerationTaskRow>(
      `UPDATE generation_tasks
       SET provider_task_id = $4,
           provider_task_attempt = COALESCE(provider_task_attempt, $2),
           provider_result = $5,
           processing_stage = 'settlement-pending',
           settlement_error = NULL,
           heartbeat_at = now(),
           lease_expires_at = now() + interval '25 seconds',
           updated_at = now()
       WHERE id = $1 AND attempt = $2 AND claim_token = $3 AND status = 'processing'
         AND (provider_task_id IS NULL OR provider_task_id = $4)
       RETURNING *`,
      [taskId, attempt, claimToken, providerResult.providerTaskId, providerResult],
    );
    const task = updated.rows[0];
    if (task) await upsertProviderUsageRecord(client, task, providerResult, 'success', null);
    return updated;
  });
  return result.rows[0] ? mapGenerationTask(result.rows[0]) : null;
}

export async function recordProviderUsageObservation(
  taskId: string,
  expectedAttempt: number,
  observation: ProviderUsageObservation,
  claimToken?: string,
) {
  return withTransaction(async client => {
    const taskResult = await client.query<GenerationTaskRow>(
      `SELECT * FROM generation_tasks
       WHERE id = $1
         AND attempt = $2
         AND provider_task_id = $3
         AND ($4::uuid IS NULL OR claim_token = $4)
       FOR UPDATE`,
      [taskId, expectedAttempt, observation.providerTaskId, claimToken ?? null],
    );
    const task = taskResult.rows[0];
    if (!task) return false;
    await upsertProviderUsageRecord(
      client,
      task,
      observation,
      observation.status,
      observation.error ?? null,
    );
    return true;
  });
}

export async function recordTaskSettlementError(taskId: string, attempt: number, claimToken: string, error: unknown) {
  await withTransaction(async client => {
    const message = safeErrorMessage(error);
    await client.query(
      `UPDATE generation_provider_runs
       SET status = 'settlement-pending', last_error = $4,
           lease_expires_at = now() - interval '1 second', updated_at = now()
       WHERE task_id = $1 AND task_attempt = $2 AND lease_token = $3`,
      [taskId, attempt, claimToken, message],
    );
    await client.query(
      `UPDATE generation_tasks
       SET processing_stage = 'settlement-pending', settlement_error = $4,
           lease_expires_at = now() - interval '1 second', updated_at = now()
       WHERE id = $1 AND attempt = $2 AND claim_token = $3 AND status = 'processing'`,
      [taskId, attempt, claimToken, message],
    );
  });
}

export async function requeueExpiredGenerationTasks(limit = 200) {
  return withTransaction(async client => {
    const result = await client.query<{ id: string; attempt: number; claimEpoch: number }>(
      `WITH expired AS (
         SELECT task.id, task.attempt, task.active_provider_run_id, task.claim_token,
                task.provider_task_id, task.provider_result,
                run.status AS provider_run_status,
                run.provider_task_id AS run_provider_task_id
         FROM generation_tasks task
         LEFT JOIN generation_provider_runs run ON run.id = task.active_provider_run_id
         WHERE task.status = 'processing'
           AND task.lease_expires_at IS NOT NULL
           AND task.lease_expires_at < now()
           AND task.processing_stage NOT IN ('submission-unknown', 'manual-review')
         ORDER BY task.updated_at ASC
         FOR UPDATE OF task SKIP LOCKED
         LIMIT $1
       ), released_runs AS (
         UPDATE generation_provider_runs run
         SET status = CASE
               WHEN expired.provider_run_status = 'submitting'
                 AND expired.run_provider_task_id IS NULL
                 AND expired.provider_task_id IS NULL
                 AND expired.provider_result IS NULL
               THEN 'submission-unknown'
               ELSE run.status
             END,
             last_error = CASE
               WHEN expired.provider_run_status = 'submitting'
                 AND expired.run_provider_task_id IS NULL
                 AND expired.provider_task_id IS NULL
                 AND expired.provider_result IS NULL
               THEN 'worker 租约在供应商提交开始后过期，无法确认创建结果'
               ELSE run.last_error
             END,
             lease_token = NULL, lease_expires_at = NULL, updated_at = now()
         FROM expired
         WHERE run.id = expired.active_provider_run_id
           AND run.lease_token IS NOT DISTINCT FROM expired.claim_token
         RETURNING run.id
       ), updated_tasks AS (
         UPDATE generation_tasks task
         SET status = CASE
               WHEN expired.provider_run_status = 'submitting'
                 AND expired.run_provider_task_id IS NULL
                 AND expired.provider_task_id IS NULL
                 AND expired.provider_result IS NULL
               THEN 'processing'
               ELSE 'queued'
             END,
           processing_stage = CASE
             WHEN expired.provider_run_status = 'submitting'
               AND expired.run_provider_task_id IS NULL
               AND expired.provider_task_id IS NULL
               AND expired.provider_result IS NULL
             THEN 'submission-unknown'
             WHEN task.provider_result IS NOT NULL THEN 'settlement-pending'
             WHEN task.provider_task_id IS NOT NULL OR expired.run_provider_task_id IS NOT NULL THEN 'provider-running'
             ELSE 'prepared'
           END,
           settlement_error = CASE
             WHEN expired.provider_run_status = 'submitting'
               AND expired.run_provider_task_id IS NULL
               AND expired.provider_task_id IS NULL
               AND expired.provider_result IS NULL
             THEN 'worker 租约在供应商提交开始后过期，无法确认创建结果'
             ELSE task.settlement_error
           END,
           claim_token = NULL,
           lease_expires_at = NULL,
           heartbeat_at = NULL,
           updated_at = now()
         FROM expired
         WHERE task.id = expired.id
         RETURNING task.id, task.attempt, task.claim_epoch, task.status
       )
       SELECT id, attempt, claim_epoch AS "claimEpoch"
       FROM updated_tasks
       WHERE status = 'queued'`,
      [limit],
    );
    return result.rows;
  });
}

export async function settleTaskSuccess(taskId: string, expectedAttempt: number, claimToken: string) {
  return withTransaction(async client => {
    const taskResult = await client.query<SettlementGenerationTaskRow>(
      `SELECT task.*,
              run.output_object_key AS run_output_object_key,
              run.thumbnail_object_key AS run_thumbnail_object_key,
              run.staging_object_key AS run_staging_object_key
       FROM generation_tasks task
       JOIN generation_provider_runs run ON run.id = task.active_provider_run_id
       WHERE task.id = $1 AND task.attempt = $2 AND task.claim_token = $3
         AND task.status = 'processing' AND task.credit_status = 'held'
         AND task.provider_result IS NOT NULL
         AND run.lease_token = $3 AND run.status = 'settlement-pending'
         AND run.provider_result IS NOT NULL
       FOR UPDATE OF task`,
      [taskId, expectedAttempt, claimToken],
    );
    const task = taskResult.rows[0];
    if (!task?.provider_result) return null;
    const providerResult = task.provider_result;

    const deliveryDecision = await getRealPortraitGenerationDeliveryDecisionWithClient(
      client,
      task.id,
      expectedAttempt,
    );
    if (!deliveryDecision.allowed) {
      return withholdRealPortraitGenerationDeliveryWithClient(
        client,
        task,
        providerResult,
        deliveryDecision.reason,
        expectedAttempt,
        claimToken,
      );
    }

    const assetId = await createGeneratedAsset(client, task, providerResult);

    await settleGenerationLotsWithClient(client, task.id, expectedAttempt);

    await client.query(
      `UPDATE credit_ledger
       SET type = 'spend',
           settlement_status = 'settled',
           source = replace(source, '生成预扣', '生成消耗'),
           note = $3,
           related_asset_id = $2
       WHERE related_job_id = $1 AND type = 'hold' AND settlement_status = 'held'`,
      [task.id, assetId, creditLedgerNotes.generationSucceeded],
    );

    await upsertProviderUsageRecord(client, task, providerResult, 'success', null);

    const updated = await client.query<GenerationTaskRow>(
      `UPDATE generation_tasks
       SET status = 'completed',
           processing_stage = 'completed',
           cancel_state = CASE WHEN cancel_requested_at IS NOT NULL THEN 'settled' ELSE cancel_state END,
           provider_task_id = $2,
           provider_result = NULL,
           settlement_error = NULL,
           failure_category = NULL,
           failure_reason = NULL,
           claim_token = NULL,
           lease_expires_at = NULL,
           settled_credits = reserved_credits,
           refunded_credits = 0,
           credit_status = 'settled',
           asset_id = $3,
           completed_at = now(),
           updated_at = now()
       WHERE id = $1 AND attempt = $4 AND claim_token = $5
       RETURNING *`,
      [task.id, providerResult.providerTaskId, assetId, expectedAttempt, claimToken],
    );

    if (updated.rowCount) {
      await markRealPortraitGenerationSucceededWithClient(client, task.id, expectedAttempt);
      const promptWizardEngineVersion = promptWizardEngineVersionFromTask(updated.rows[0]!);
      if (promptWizardEngineVersion) {
        await incrementPromptWizardDailyMetricsWithClient(client, promptWizardEngineVersion, {
          videoSuccesses: 1,
        });
      }
      await client.query(
        `UPDATE generation_provider_runs
         SET status = 'settled', lease_token = NULL, lease_expires_at = NULL,
             last_error = NULL, completed_at = now(), updated_at = now()
         WHERE id = $1 AND task_attempt = $2 AND lease_token = $3`,
        [task.active_provider_run_id, expectedAttempt, claimToken],
      );
    }

    return updated.rows[0] ? mapGenerationTask(updated.rows[0]) : null;
  });
}

async function withholdRealPortraitGenerationDeliveryWithClient(
  client: DbClient,
  task: SettlementGenerationTaskRow,
  providerResult: ProviderSuccess,
  blockReason: RealPortraitGenerationDeliveryBlockReason,
  expectedAttempt: number,
  claimToken: string,
) {
  const failureReason = describeRealPortraitDeliveryWithheld(blockReason);

  // 供应商已经完成，成本事实必须先幂等落账；随后只退本地预扣，不伪造“未调用供应商”。
  await upsertProviderUsageRecord(client, task, providerResult, 'success', null);
  const creditRelease = await refundHeldCreditsForFailure(client, task);
  await scheduleUnreferencedGeneratedObjectsForDeletionWithClient(
    client,
    task.active_provider_run_id,
    [
      providerResult.objectKey,
      providerResult.thumbnailKey,
      task.run_output_object_key,
      task.run_thumbnail_object_key,
    ],
  );

  const updated = await client.query<GenerationTaskRow>(
    `UPDATE generation_tasks
     SET status = 'failed',
         processing_stage = 'privacy-withheld',
         provider_task_id = $2,
         provider_result = NULL,
         settlement_error = NULL,
         failure_category = 'content-policy',
         failure_reason = $3,
         cancel_reason_code = 'privacy-withheld',
         claim_token = NULL,
         lease_expires_at = NULL,
         heartbeat_at = NULL,
         settled_credits = 0,
         refunded_credits = $4,
         credit_status = 'refunded',
         asset_id = NULL,
         completed_at = now(),
         updated_at = now()
     WHERE id = $1 AND attempt = $5 AND claim_token = $6
       AND status = 'processing' AND credit_status = 'held'
     RETURNING *`,
    [
      task.id,
      providerResult.providerTaskId,
      failureReason,
      creditRelease.returnedCredits,
      expectedAttempt,
      claimToken,
    ],
  );
  if (!updated.rowCount) {
    throw Object.assign(new Error('真人授权撤回结算时任务租约已失效'), {
      statusCode: 409,
      code: 'GENERATION_SETTLEMENT_LEASE_LOST',
    });
  }

  const providerRun = await client.query(
    `UPDATE generation_provider_runs
     SET status = 'refunded',
         provider_task_id = COALESCE(provider_task_id, $4),
         provider_result = CASE
           WHEN provider_result IS NULL THEN NULL
           ELSE provider_result - ARRAY[
             'objectKey', 'thumbnailKey', 'publicUrl', 'thumbnailUrl'
           ]::text[]
         END,
         provider_response_checkpoint = NULL,
         provider_response_url = NULL,
         recovery_token = NULL,
         last_error = $5,
         lease_token = NULL,
         lease_expires_at = NULL,
         heartbeat_at = NULL,
         completed_at = now(),
         updated_at = now()
     WHERE id = $1 AND task_attempt = $2 AND lease_token = $3
       AND status = 'settlement-pending'
     RETURNING id`,
    [
      task.active_provider_run_id,
      expectedAttempt,
      claimToken,
      providerResult.providerTaskId,
      failureReason,
    ],
  );
  if (!providerRun.rowCount) {
    throw Object.assign(new Error('真人授权撤回结算时供应商运行租约已失效'), {
      statusCode: 409,
      code: 'GENERATION_SETTLEMENT_LEASE_LOST',
    });
  }

  const promptWizardEngineVersion = promptWizardEngineVersionFromTask(updated.rows[0]!);
  if (promptWizardEngineVersion) {
    await incrementPromptWizardDailyMetricsWithClient(client, promptWizardEngineVersion, {
      videoFailures: 1,
      moderationFailures: 1,
    });
  }

  return mapGenerationTask(updated.rows[0]!);
}

async function scheduleUnreferencedGeneratedObjectsForDeletionWithClient(
  client: DbClient,
  providerRunId: string | null,
  objectKeys: Array<string | null | undefined>,
) {
  if (!providerRunId) {
    throw Object.assign(new Error('真人授权撤回结算缺少供应商运行记录'), {
      statusCode: 409,
      code: 'GENERATION_PROVIDER_RUN_MISSING',
    });
  }
  const keys = Array.from(new Set(
    objectKeys
      .map(key => key?.trim())
      .filter((key): key is string => Boolean(key)),
  )).sort();
  for (const objectKey of keys) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`asset-object:${objectKey}`],
    );
    const referenced = await client.query(
      `SELECT 1
       WHERE EXISTS (
         SELECT 1 FROM assets
         WHERE deletion_status <> 'deleted'
           AND (object_key = $1 OR thumbnail_key = $1)
       ) OR EXISTS (
         SELECT 1 FROM generation_provider_runs
         WHERE id <> $2
           AND status NOT IN ('refunded', 'provider-failed', 'delivery-failed')
           AND (output_object_key = $1 OR thumbnail_object_key = $1 OR staging_object_key = $1)
       )`,
      [objectKey, providerRunId],
    );
    if (!referenced.rowCount) await scheduleObjectDeletion(client, objectKey);
  }
}

function describeRealPortraitDeliveryWithheld(reason: RealPortraitGenerationDeliveryBlockReason) {
  if (reason === 'authorization-expired') {
    return `${REAL_PORTRAIT_PRIVACY_WITHHELD_CODE}: 真人授权已过期，生成结果未保存或交付。`;
  }
  return `${REAL_PORTRAIT_PRIVACY_WITHHELD_CODE}: 真人授权已撤回，生成结果未保存或交付。`;
}

export async function recoverRefundedTaskSuccess(
  taskId: string,
  providerResult: ProviderSuccess,
  recoveryToken: string,
  stagingObjectKeys: string[] = [],
) {
  const outcome = await withTransaction(async client => {
    const taskResult = await client.query<SettlementGenerationTaskRow>(
      `SELECT task.*,
              run.output_object_key AS run_output_object_key,
              run.thumbnail_object_key AS run_thumbnail_object_key,
              run.staging_object_key AS run_staging_object_key
       FROM generation_tasks task
       JOIN generation_provider_runs run ON run.id = task.active_provider_run_id
       WHERE task.id = $1 AND run.recovery_token = $2 AND run.lease_token = $2
         AND run.status = 'delivery-failed'
         AND run.provider_task_id = $3
       FOR UPDATE OF task`,
      [taskId, recoveryToken, providerResult.providerTaskId],
    );
    const task = taskResult.rows[0];
    if (!task) throw Object.assign(new Error('未找到生成任务'), { statusCode: 404 });
    if (task.kind !== 'video' || !isSeedanceModelLabel(task.model)) {
      throw Object.assign(new Error('只有 Seedance 视频任务可以执行恢复'), { statusCode: 400 });
    }
    if (task.status !== 'failed' || task.credit_status !== 'refunded') {
      throw Object.assign(new Error('只有失败且已退款的任务可以恢复'), { statusCode: 400 });
    }
    if (task.asset_id) {
      throw Object.assign(new Error('任务已绑定数字资产，不能重复恢复'), { statusCode: 400 });
    }

    const deliveryDecision = task.processing_stage === REAL_PORTRAIT_PRIVACY_WITHHELD_CODE
      || task.cancel_reason_code === REAL_PORTRAIT_PRIVACY_WITHHELD_CODE
      ? { hasReferences: true as const, allowed: false as const, reason: 'authorization-revoked' as const }
      : await getRealPortraitGenerationDeliveryDecisionWithClient(
        client,
        task.id,
        toInt(task.attempt),
      );
    if (!deliveryDecision.allowed) {
      const failureReason = describeRealPortraitDeliveryWithheld(deliveryDecision.reason);
      await upsertProviderUsageRecord(client, task, providerResult, 'success', null);
      await scheduleUnreferencedGeneratedObjectsForDeletionWithClient(
        client,
        task.active_provider_run_id,
        [
          providerResult.objectKey,
          providerResult.thumbnailKey,
          task.run_output_object_key,
          task.run_thumbnail_object_key,
          ...stagingObjectKeys,
        ],
      );
      await client.query(
        `UPDATE generation_tasks
         SET processing_stage = 'privacy-withheld',
             failure_category = 'content-policy',
             failure_reason = $2,
             cancel_reason_code = 'privacy-withheld',
             provider_result = NULL,
             settlement_error = NULL,
             asset_id = NULL,
             updated_at = now()
         WHERE id = $1 AND status = 'failed' AND credit_status = 'refunded'`,
        [task.id, failureReason],
      );
      const terminalized = await client.query(
        `UPDATE generation_provider_runs
         SET status = 'refunded',
             provider_result = CASE
               WHEN provider_result IS NULL THEN NULL
               ELSE provider_result - ARRAY[
                 'objectKey', 'thumbnailKey', 'publicUrl', 'thumbnailUrl'
               ]::text[]
             END,
             provider_response_checkpoint = NULL,
             provider_response_url = NULL,
             recovery_token = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             heartbeat_at = NULL,
             last_error = $3,
             completed_at = COALESCE(completed_at, now()),
             updated_at = now()
         WHERE id = $1 AND recovery_token = $2 AND lease_token = $2
           AND status = 'delivery-failed'
         RETURNING id`,
        [task.active_provider_run_id, recoveryToken, failureReason],
      );
      if (!terminalized.rowCount) {
        throw Object.assign(new Error('真人授权撤回时恢复租约已失效'), {
          statusCode: 409,
          code: 'GENERATION_RECOVERY_LEASE_LOST',
        });
      }
      return { privacyWithheld: true as const, reason: failureReason };
    }

    const userResult = await client.query<{
      main_credits: number;
      addon_credits: number;
    }>(
      `SELECT main_credits, addon_credits
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [task.user_id],
    );
    const user = userResult.rows[0];
    if (!user) throw Object.assign(new Error('未找到用户积分账户'), { statusCode: 404 });

    const mainCreditsUsed = toInt(task.main_credits_used);
    const addonCreditsUsed = toInt(task.addon_credits_used);
    if (toInt(user.main_credits) < mainCreditsUsed || toInt(user.addon_credits) < addonCreditsUsed) {
      throw Object.assign(new Error('用户当前积分不足，无法补扣恢复成片'), { statusCode: 400 });
    }

    const assetId = await createGeneratedAsset(client, task, providerResult);
    const recoveryEventKey = `generation-recovery-hold:${task.id}:${toInt(task.attempt)}`;
    await holdGenerationLotsWithClient({
      client,
      userId: task.user_id,
      taskId: task.id,
      attempt: toInt(task.attempt),
      mainAmount: mainCreditsUsed,
      addonAmount: addonCreditsUsed,
      eventKey: recoveryEventKey,
    });
    await settleGenerationLotsWithClient(
      client,
      task.id,
      toInt(task.attempt),
      recoveryEventKey,
    );

    const syncedCredits = await setUserAvailableCreditsWithClient(client, task.user_id);

    await client.query(
      `INSERT INTO credit_ledger (
         user_id, type, bucket, settlement_status, amount, balance,
         source, operator, note, related_job_id, related_asset_id, business_event_key
       )
       VALUES ($1, 'spend', $2, 'settled', $3, $4, $5, 'system', $6, $7, $8, $9)
       ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO NOTHING`,
      [
        task.user_id,
        bucketForUsage(mainCreditsUsed, addonCreditsUsed),
        -toInt(task.reserved_credits || task.credits),
        syncedCredits.balance,
        `${task.model} 恢复成片补扣`,
        creditLedgerNotes.generationRecovered,
        task.id,
        assetId,
        `generation-recovery-settle:${task.id}:${toInt(task.attempt)}`,
      ],
    );

    await upsertProviderUsageRecord(client, task, providerResult, 'success', null);

    const updated = await client.query<GenerationTaskRow>(
      `UPDATE generation_tasks
       SET status = 'completed',
           processing_stage = 'completed',
           provider_task_id = $2,
           provider_result = NULL,
           settlement_error = NULL,
           lease_expires_at = NULL,
           failure_category = NULL,
           failure_reason = NULL,
           settled_credits = reserved_credits,
           refunded_credits = 0,
           credit_status = 'settled',
           asset_id = $3,
           completed_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [task.id, providerResult.providerTaskId, assetId],
    );

    await client.query(
      `UPDATE generation_provider_runs
       SET status = 'settled', recovery_token = NULL, lease_token = NULL,
           lease_expires_at = NULL, provider_result = $3,
           last_error = NULL, completed_at = now(), updated_at = now()
       WHERE id = $1 AND recovery_token = $2 AND lease_token = $2`,
      [task.active_provider_run_id, recoveryToken, providerResult],
    );

    for (const objectKey of Array.from(new Set(stagingObjectKeys.map(key => key.trim()).filter(Boolean)))) {
      await client.query(
        `INSERT INTO object_deletion_outbox (object_key, asset_ids, available_at)
         VALUES ($1, '{}'::uuid[], now())
         ON CONFLICT (object_key) DO UPDATE
         SET status = CASE
               WHEN object_deletion_outbox.status = 'completed' THEN 'completed'
               ELSE 'pending'
             END,
             available_at = LEAST(object_deletion_outbox.available_at, now()),
             updated_at = now()`,
        [objectKey],
      );
    }

    return { privacyWithheld: false as const, task: mapGenerationTask(updated.rows[0]!) };
  });
  if (outcome.privacyWithheld) {
    throw Object.assign(new Error(outcome.reason), {
      statusCode: 409,
      code: 'REAL_PORTRAIT_DELIVERY_WITHHELD',
    });
  }
  return outcome.task;
}

async function refundHeldCreditsForCancellation(client: DbClient, task: GenerationTaskRow) {
  const userResult = await client.query<{ main_credits: number; addon_credits: number }>(
    `SELECT main_credits, addon_credits FROM users WHERE id = $1 FOR UPDATE`,
    [task.user_id],
  );
  const user = userResult.rows[0];
  if (!user) throw Object.assign(new Error('未找到用户积分账户'), { statusCode: 404 });
  const lotRelease = await releaseGenerationLotsWithClient(client, task.id, toInt(task.attempt));
  if (!lotRelease) throw generationCreditLotMissingError(task.id);
  const creditRelease = requireCompleteGenerationCreditRelease(task, lotRelease);
  const { returnedCredits, expiredCredits, revokedCredits } = creditRelease;
  const syncedCredits = await setUserAvailableCreditsWithClient(client, task.user_id);
  await client.query(
    `UPDATE credit_ledger
     SET settlement_status = 'refunded',
         note = $2
     WHERE related_job_id = $1 AND type = 'hold' AND settlement_status = 'held'`,
    [
      task.id,
      revokedCredits > 0
        ? '本次预扣已解除；已撤销的邀约奖励已追回，已过期积分不恢复，其余积分已退回。'
        : expiredCredits > 0
        ? creditLedgerNotes.generationCanceledHoldReleasedWithExpiry
        : creditLedgerNotes.generationCanceledHoldReleased,
    ],
  );
  await client.query(
    `INSERT INTO credit_ledger (
       user_id, type, bucket, settlement_status, amount, balance,
       source, operator, note, related_job_id, business_event_key
     )
     VALUES ($1, 'refund', $2, 'refunded', $3, $4,
             '生成任务取消退回', 'system', $5, $6, $7)
     ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO NOTHING`,
    [
      task.user_id,
      bucketForUsage(toInt(task.main_credits_used), toInt(task.addon_credits_used)),
      returnedCredits,
      syncedCredits.balance,
      revokedCredits > 0
        ? '本次预扣已解除；已撤销的邀约奖励已追回，已过期积分不恢复，其余积分已退回。'
        : expiredCredits > 0
        ? creditLedgerNotes.generationCanceledRefundedWithExpiry
        : creditLedgerNotes.generationCanceledRefunded,
      task.id,
      `generation-cancel-refund:${task.id}:${toInt(task.attempt)}`,
    ],
  );
  return creditRelease;
}

async function refundHeldCreditsForFailure(client: DbClient, task: GenerationTaskRow) {
  const userResult = await client.query<{ main_credits: number; addon_credits: number }>(
    `SELECT main_credits, addon_credits FROM users WHERE id = $1 FOR UPDATE`,
    [task.user_id],
  );
  if (!userResult.rowCount) {
    throw Object.assign(new Error('未找到用户积分账户'), { statusCode: 404 });
  }
  const lotRelease = await releaseGenerationLotsWithClient(client, task.id, toInt(task.attempt));
  if (!lotRelease) throw generationCreditLotMissingError(task.id);
  const creditRelease = requireCompleteGenerationCreditRelease(task, lotRelease);
  const { returnedCredits, expiredCredits, revokedCredits } = creditRelease;
  const syncedCredits = await setUserAvailableCreditsWithClient(client, task.user_id);

  await client.query(
    `UPDATE credit_ledger
     SET settlement_status = 'refunded',
         note = $2
     WHERE related_job_id = $1 AND type = 'hold' AND settlement_status = 'held'`,
    [
      task.id,
      revokedCredits > 0
        ? '本次预扣已解除；已撤销的邀约奖励已追回，已过期积分不恢复，其余积分已退回。'
        : expiredCredits > 0
        ? creditLedgerNotes.generationFailedHoldReleasedWithExpiry
        : creditLedgerNotes.generationFailedHoldReleased,
    ],
  );

  await client.query(
    `INSERT INTO credit_ledger (
       user_id, type, bucket, settlement_status, amount, balance,
       source, operator, note, related_job_id, business_event_key
     )
     VALUES ($1, 'refund', $2, 'refunded', $3, $4, '生成任务退回', 'system', $5, $6, $7)
     ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO NOTHING`,
    [
      task.user_id,
      bucketForUsage(toInt(task.main_credits_used), toInt(task.addon_credits_used)),
      returnedCredits,
      syncedCredits.balance,
      revokedCredits > 0
        ? '本次预扣已解除；已撤销的邀约奖励已追回，已过期积分不恢复，其余积分已退回。'
        : expiredCredits > 0
        ? creditLedgerNotes.generationFailedRefundedWithExpiry
        : creditLedgerNotes.generationFailedRefunded,
      task.id,
      `generation-failure-refund:${task.id}:${toInt(task.attempt)}`,
    ],
  );
  return creditRelease;
}

function requireCompleteGenerationCreditRelease(
  task: GenerationTaskRow,
  release: { mainReturned: number; addonReturned: number; expiredAmount: number; revokedAmount?: number },
): GenerationCreditRelease {
  const mainReturned = toInt(release.mainReturned);
  const addonReturned = toInt(release.addonReturned);
  const returnedCredits = mainReturned + addonReturned;
  const expiredCredits = toInt(release.expiredAmount);
  const revokedCredits = toInt(release.revokedAmount ?? 0);
  if (returnedCredits + expiredCredits + revokedCredits !== toInt(task.reserved_credits)) {
    throw Object.assign(new Error('生成积分释放金额与任务预扣不一致'), {
      statusCode: 409,
      code: 'GENERATION_CREDIT_LOT_INVARIANT_VIOLATION',
    });
  }
  return { mainReturned, addonReturned, returnedCredits, expiredCredits, revokedCredits };
}

function describePreSubmissionCancellationRelease(release: GenerationCreditRelease | null) {
  if (release && release.revokedCredits > 0) {
    return '任务已取消；预扣已解除，已撤销的邀约奖励已追回，已过期积分不恢复，其余积分已退回。';
  }
  if (!release || release.expiredCredits === 0) {
    return '用户在供应商任务提交前取消，预扣积分已退回。';
  }
  if (release.returnedCredits === 0) {
    return '用户在供应商任务提交前取消；预扣已解除，但原积分批次已过期，未重新计入可用余额。';
  }
  return '用户在供应商任务提交前取消；未过期积分已退回，已过期积分未重新计入可用余额。';
}

function describeTerminalCancellationRelease(release: GenerationCreditRelease | null) {
  if (release && release.revokedCredits > 0) {
    return '任务已取消；预扣已解除，已撤销的邀约奖励已追回，已过期积分不恢复，其余积分已退回。';
  }
  if (!release || release.expiredCredits === 0) {
    return '历史取消请求已收口；任务未生成可用成片，预扣积分已退回。';
  }
  if (release.returnedCredits === 0) {
    return '历史取消请求已收口；预扣已解除，但原积分批次已过期，未重新计入可用余额。';
  }
  return '历史取消请求已收口；未过期积分已退回，已过期积分未重新计入可用余额。';
}

export async function failTaskWithRefund(
  taskId: string,
  failure: ProviderFailure,
  expectedAttempt?: number,
  audit?: { adminUserId: string; ip?: string; detail: string },
  expectedClaimToken?: string,
) {
  return withTransaction(client => failTaskWithRefundWithClient(
    client,
    taskId,
    failure,
    expectedAttempt,
    audit,
    expectedClaimToken,
  ));
}

export async function failTaskWithRefundWithClient(
  client: DbClient,
  taskId: string,
  failure: ProviderFailure,
  expectedAttempt?: number,
  audit?: { adminUserId: string; ip?: string; detail: string },
  expectedClaimToken?: string,
) {
    const taskResult = await client.query<GenerationTaskRow>(
      `SELECT * FROM generation_tasks
       WHERE id = $1
         AND ($2::integer IS NULL OR attempt = $2)
         AND ($3::uuid IS NULL OR claim_token = $3)
       FOR UPDATE`,
      [taskId, expectedAttempt ?? null, expectedClaimToken ?? null],
    );
    const task = taskResult.rows[0];
    if (!task) return null;

    if (task.status === 'completed' || task.credit_status === 'settled') {
      return mapGenerationTask(task);
    }
    if (task.status === 'failed' && task.credit_status === 'refunded') {
      return mapGenerationTask(task);
    }
    if (task.credit_status !== 'held') {
      return mapGenerationTask(task);
    }
    const isAuditedUnknownSubmission = task.status === 'processing'
      && ['submission-unknown', 'manual-review'].includes(task.processing_stage)
      && task.asset_id === null
      && task.provider_result === null;
    if (audit && !(['failed', 'canceled'].includes(task.status)) && !isAuditedUnknownSubmission) {
      throw Object.assign(new Error('只有失败、已取消或待人工核验且仍冻结积分、无成片的任务可以人工退款'), {
        statusCode: 409,
        code: 'GENERATION_REFUND_STATE_CONFLICT',
      });
    }
    if (!audit && task.provider_task_id && failure.terminal !== true) {
      return null;
    }

    const usageRecord = await upsertProviderUsageRecord(client, task, failure, 'failed', failure.reason);
    await createZeroCostCandidateForDeterministicRejection(client, task, failure, usageRecord);
    const creditRelease = await refundHeldCreditsForFailure(client, task);

    if (audit) {
      await client.query(
        `INSERT INTO audit_logs (
           admin_user_id, admin_email, module, action, target, risk, ip, detail
         )
         SELECT $1, email, '生成任务', '人工退回积分', $2, 'high', $3, $4
         FROM users WHERE id = $1`,
        [audit.adminUserId, task.id, audit.ip ?? null, audit.detail],
      );
    }

    const updated = await client.query<GenerationTaskRow>(
      `UPDATE generation_tasks
       SET status = CASE WHEN status = 'canceled' THEN 'canceled' ELSE 'failed' END,
           processing_stage = CASE WHEN status = 'canceled' THEN 'canceled' ELSE 'failed' END,
           provider_task_id = COALESCE($2, provider_task_id),
           failure_category = CASE
             WHEN status = 'canceled' THEN COALESCE(failure_category, 'user-canceled')
             ELSE $3
           END,
           failure_reason = CASE
             WHEN status = 'canceled' THEN COALESCE(failure_reason, $4)
             ELSE $4
           END,
           settled_credits = 0,
           refunded_credits = $5,
           credit_status = 'refunded',
           provider_result = NULL,
           settlement_error = NULL,
           claim_token = NULL,
           lease_expires_at = NULL,
           completed_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        task.id,
        failure.providerTaskId ?? null,
        failure.category,
        failure.reason,
        creditRelease?.returnedCredits ?? 0,
      ],
    );

    if (updated.rowCount && task.active_provider_run_id) {
      const providerRunStatus = audit
        ? 'refunded'
        : failure.providerTaskId || task.provider_task_id || failure.terminal === true
          ? 'provider-failed'
          : 'refunded';
      await client.query(
        `UPDATE generation_provider_runs
         SET status = $5,
             provider_task_id = COALESCE(provider_task_id, $2),
             provider_response_url = CASE
               WHEN provider_response_checkpoint IS NOT NULL THEN NULL
               ELSE provider_response_url
             END,
             last_error = $3, lease_token = NULL, lease_expires_at = NULL,
             completed_at = now(), updated_at = now()
         WHERE id = $1
           AND ($4::uuid IS NULL OR lease_token = $4)`,
        [
          task.active_provider_run_id,
          failure.providerTaskId ?? null,
          failure.reason,
          expectedClaimToken ?? null,
          providerRunStatus,
        ],
      );
    }

    const updatedTask = updated.rows[0];
    const promptWizardEngineVersion = updatedTask
      ? promptWizardEngineVersionFromTask(updatedTask)
      : null;
    if (updatedTask?.status === 'failed' && promptWizardEngineVersion) {
      await incrementPromptWizardDailyMetricsWithClient(client, promptWizardEngineVersion, {
        videoFailures: 1,
        moderationFailures: updatedTask.failure_category === 'content-policy' ? 1 : 0,
      });
    }

  return mapGenerationTask(updated.rows[0]!);
}

function toOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toOptionalNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function inferProviderName(providerTaskId: string | null) {
  return providerTaskId?.startsWith('fake-') ? 'fake-provider' : 'volcengine-ark';
}

function buildProviderRunObjectKeys(task: Pick<GenerationTaskRow, 'id' | 'user_id' | 'kind' | 'attempt'>) {
  const base = `generated/${task.kind}/${task.user_id}/${task.id}/attempt-${toInt(task.attempt)}`;
  return {
    outputObjectKey: `${base}/output.${task.kind === 'video' ? 'mp4' : 'png'}`,
    thumbnailObjectKey: `${base}/thumbnail.${task.kind === 'video' ? 'jpg' : 'webp'}`,
    stagingObjectKey: `generated-staging/${task.kind}/${task.user_id}/${task.id}/attempt-${toInt(task.attempt)}`,
  };
}

function safeErrorMessage(error: unknown) {
  const message = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : error && typeof error === 'object' && typeof (error as { reason?: unknown }).reason === 'string'
        ? (error as { reason: string }).reason
        : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : '未知结算错误';
  return (message.trim() || '未知结算错误').slice(0, 500);
}

function generationCreditLotMissingError(taskId: string) {
  return Object.assign(new Error(`生成任务 ${taskId} 缺少积分批次，已停止自动修账`), {
    statusCode: 409,
    code: 'GENERATION_CREDIT_LOT_MISSING',
  });
}

function generationCreditCacheMismatchError(userId: string) {
  return Object.assign(new Error(`用户 ${userId} 的积分批次与缓存余额不一致，已停止扣减`), {
    statusCode: 409,
    code: 'GENERATION_CREDIT_CACHE_MISMATCH',
  });
}

interface UpsertedProviderUsageRecord {
  id: string;
  local_accounting_date: Date | string;
  billable_tokens: unknown;
  estimated_cost: unknown;
}

async function upsertProviderUsageRecord(
  client: DbClient,
  task: GenerationTaskRow,
  usage: ProviderSuccess | ProviderFailure | ProviderUsageObservation,
  status: 'success' | 'failed',
  error: string | null,
) {
  if (task.kind === 'image' && isSeedreamModelLabel(task.model)) {
    await insertSeedreamProviderUsageRecord(client, task, usage, status, error);
    return null;
  }

  const provider = usage.provider ?? 'unknown-provider';
  const usageUnit = 'usageUnit' in usage ? usage.usageUnit ?? 'tokens' : 'tokens';
  const completionTokens = usageUnit === 'tokens' ? toOptionalTokenCount(usage.completionTokens) : null;
  const totalTokens = usageUnit === 'tokens' ? toOptionalTokenCount(usage.totalTokens) : null;
  // 方舟只以 completion_tokens 计价。这里有意不从 total_tokens、deducted_units 或 raw_units 回退。
  const billableTokens = completionTokens;
  const billableBasis = billableTokens === null ? null : 'completion_tokens';
  const hasVideoInput = hasSeedanceVideoInput(task.config);
  const estimate = estimateSeedanceCost({
    model: task.model,
    resolution: task.config.resolution,
    hasVideoInput,
    billableTokens,
  });
  const pricingRule = findSeedancePricingRule({
    model: task.model,
    resolution: task.config.resolution,
    hasVideoInput,
  });
  const providerTaskId = usage.providerTaskId ?? task.provider_task_id;
  const providerAttempt = toInt(task.provider_task_attempt ?? task.attempt);
  const rawUnits = usageUnit === 'tokens'
    ? completionTokens
    : ('rawUnits' in usage ? usage.rawUnits ?? null : null);
  const deductedUnits = usageUnit === 'tokens'
    ? totalTokens
    : ('deductedUnits' in usage ? usage.deductedUnits ?? null : null);
  const usageObservedAt = normalizeUsageDateTime(usage.usageObservedAt) ?? new Date().toISOString();
  const providerTerminalAt = normalizeUsageDateTime(usage.providerTerminalAt);
  const localAccountingDate = beijingDate(providerTerminalAt ?? usageObservedAt);
  const usageEvidenceOrigin = completionTokens === null ? 'unavailable' : 'provider-reported';
  const attributionConfidence = completionTokens === null ? 'unallocated' : 'direct';
  const pricingRuleStatus = pricingRule
    ? 'priced'
    : estimate.resolution ? 'unsupported' : 'rule-missing';
  const pricingInputClass = hasVideoInput ? 'with-video' : 'without-video';
  const pricingResolutionBand = estimate.resolution === '480p' || estimate.resolution === '720p'
    ? '480p-720p'
    : estimate.resolution ?? 'unknown';

  const result = await client.query<UpsertedProviderUsageRecord>(
    `WITH existing AS (
       SELECT attempt
       FROM provider_usage_records
       WHERE provider = $1
         AND task_id = $3
         AND provider_task_id = $5
       ORDER BY attempt ASC
       LIMIT 1
     )
     INSERT INTO provider_usage_records (
       provider, model, task_id, attempt, provider_task_id, status,
       raw_units, deducted_units, usage_unit, error, completed_at,
       completion_tokens, total_tokens, billable_tokens, billable_basis,
       resolution, has_video_input, price_version, unit_price_per_million,
       estimated_cost, currency, pricing_status,
       usage_evidence_origin, pricing_rule_status, pricing_input_class,
       pricing_resolution_band, attribution_confidence, provider_terminal_at,
       usage_observed_at, local_accounting_date, accounting_date_origin
     )
     VALUES (
       $1, $2, $3, coalesce((SELECT attempt FROM existing), $4), $5, $6,
       $7, $8, $9, $10, now(),
       $11, $12, $13, $14,
       $15, $16, $17, $18,
       $19, $20, $21,
       $22, $23, $24,
       $25, $26, $27,
       $28, $29, $30
     )
     ON CONFLICT (provider, task_id, attempt) WHERE task_id IS NOT NULL
     DO UPDATE SET
       -- 同一供应商 attempt 的终态用量是成本凭证。后续归档、恢复或 worker
       -- 重放只能补齐首次缺失值，不能重写已经观察到的 Token、单价、成本和
       -- 排序时间；否则同一个 asOf 游标在翻页期间会发生跳项或重复。
       model = provider_usage_records.model,
       provider_task_id = coalesce(provider_usage_records.provider_task_id, EXCLUDED.provider_task_id),
       status = provider_usage_records.status,
       raw_units = coalesce(provider_usage_records.raw_units, EXCLUDED.raw_units),
       deducted_units = coalesce(provider_usage_records.deducted_units, EXCLUDED.deducted_units),
       usage_unit = provider_usage_records.usage_unit,
       error = coalesce(provider_usage_records.error, EXCLUDED.error),
       completed_at = provider_usage_records.completed_at,
       completion_tokens = coalesce(provider_usage_records.completion_tokens, EXCLUDED.completion_tokens),
       total_tokens = coalesce(provider_usage_records.total_tokens, EXCLUDED.total_tokens),
       billable_tokens = coalesce(provider_usage_records.billable_tokens, EXCLUDED.billable_tokens),
       billable_basis = coalesce(provider_usage_records.billable_basis, EXCLUDED.billable_basis),
       resolution = coalesce(provider_usage_records.resolution, EXCLUDED.resolution),
       has_video_input = provider_usage_records.has_video_input,
       price_version = coalesce(provider_usage_records.price_version, EXCLUDED.price_version),
       unit_price_per_million = coalesce(provider_usage_records.unit_price_per_million, EXCLUDED.unit_price_per_million),
       estimated_cost = coalesce(provider_usage_records.estimated_cost, EXCLUDED.estimated_cost),
       currency = provider_usage_records.currency,
       pricing_status = CASE
         WHEN provider_usage_records.estimated_cost IS NOT NULL THEN provider_usage_records.pricing_status
         ELSE EXCLUDED.pricing_status
       END,
       usage_evidence_origin = CASE
         WHEN provider_usage_records.billable_tokens IS NOT NULL THEN provider_usage_records.usage_evidence_origin
         ELSE EXCLUDED.usage_evidence_origin
       END,
       pricing_rule_status = CASE
         WHEN provider_usage_records.estimated_cost IS NOT NULL THEN provider_usage_records.pricing_rule_status
         ELSE EXCLUDED.pricing_rule_status
       END,
       pricing_input_class = CASE
         WHEN provider_usage_records.resolution IS NOT NULL THEN provider_usage_records.pricing_input_class
         ELSE EXCLUDED.pricing_input_class
       END,
       pricing_resolution_band = CASE
         WHEN provider_usage_records.resolution IS NOT NULL THEN provider_usage_records.pricing_resolution_band
         ELSE EXCLUDED.pricing_resolution_band
       END,
       attribution_confidence = CASE
         WHEN provider_usage_records.billable_tokens IS NOT NULL THEN provider_usage_records.attribution_confidence
         ELSE EXCLUDED.attribution_confidence
       END,
       provider_terminal_at = coalesce(provider_usage_records.provider_terminal_at, EXCLUDED.provider_terminal_at),
       usage_observed_at = coalesce(provider_usage_records.usage_observed_at, EXCLUDED.usage_observed_at),
       local_accounting_date = coalesce(provider_usage_records.local_accounting_date, EXCLUDED.local_accounting_date),
       accounting_date_origin = CASE
         WHEN provider_usage_records.accounting_date_origin = 'official-bill-inferred'
           THEN provider_usage_records.accounting_date_origin
         WHEN provider_usage_records.accounting_date_origin = 'unavailable'
           THEN EXCLUDED.accounting_date_origin
         ELSE provider_usage_records.accounting_date_origin
       END
     RETURNING id::text, local_accounting_date, billable_tokens, estimated_cost`,
    [
      provider,
      task.model,
      task.id,
      providerAttempt,
      providerTaskId,
      status,
      rawUnits,
      deductedUnits,
      usageUnit,
      error,
      completionTokens,
      totalTokens,
      billableTokens,
      billableBasis,
      estimate.resolution,
      hasVideoInput,
      estimate.priceVersion,
      estimate.unitPricePerMillion,
      estimate.estimatedCost,
      estimate.currency,
      estimate.pricingStatus,
      usageEvidenceOrigin,
      pricingRuleStatus,
      pricingInputClass,
      pricingResolutionBand,
      attributionConfidence,
      providerTerminalAt,
      usageObservedAt,
      localAccountingDate,
      providerTerminalAt ? 'provider-terminal' : 'usage-observed',
    ],
  );
  const record = result.rows[0];
  return record ?? null;
}

async function insertSeedreamProviderUsageRecord(
  client: DbClient,
  task: GenerationTaskRow,
  usage: ProviderSuccess | ProviderFailure | ProviderUsageObservation,
  status: 'success' | 'failed',
  error: string | null,
) {
  const provider = usage.provider ?? 'unknown-provider';
  const providerOperationId = usage.providerTaskId ?? task.provider_task_id;
  const reportedProviderRequestId = 'providerRequestId' in usage
    && typeof usage.providerRequestId === 'string'
    && usage.providerRequestId.trim()
    ? usage.providerRequestId.trim()
    : null;
  const referenceImageCount = Array.isArray(task.config.referenceAssets)
    ? task.config.referenceAssets.length
    : null;
  const successfulResult = 'ok' in usage && usage.ok === true ? usage : null;
  const outputWidth = successfulResult?.width ?? null;
  const outputHeight = successfulResult?.height ?? null;
  const estimate = estimateSeedreamListPrice({
    referenceImageCount,
    outputWidth,
    outputHeight,
  });
  const usageObservedAt = normalizeUsageDateTime(usage.usageObservedAt) ?? new Date().toISOString();
  const providerTerminalAt = normalizeUsageDateTime(usage.providerTerminalAt);

  const providerRunResult = await client.query<{
    id: string;
    provider_request_id: string | null;
  }>(
    `UPDATE generation_provider_runs run
     SET provider_request_id = COALESCE(run.provider_request_id, $3),
         updated_at = CASE WHEN run.provider_request_id IS NULL AND $3 IS NOT NULL THEN now() ELSE run.updated_at END
     WHERE run.id = $1
       AND run.task_id = $2
       AND ($3::text IS NULL OR run.provider_request_id IS NULL OR run.provider_request_id = $3)
     RETURNING run.id::text, run.provider_request_id`,
    [task.active_provider_run_id, task.id, reportedProviderRequestId],
  );
  const providerRun = providerRunResult.rows[0];
  if (!providerRun) {
    throw new Error(`Seedream 任务 ${task.id} 缺少可归属的 provider run，无法固化成本证据`);
  }
  const providerRequestId = providerRun.provider_request_id ?? reportedProviderRequestId;
  const requestEvidenceStatus = providerRequestId
    ? 'provider-id'
    : providerOperationId
      ? 'local-only'
      : 'missing';
  const outputTier = estimate.outputPixels === null
    ? null
    : estimate.outputPixels <= SEEDREAM_SMALL_IMAGE_MAX_PIXELS
      ? 'small'
      : 'large';
  const generatedImages = toOptionalTokenCount(usage.generatedImages);
  const outputTokens = toOptionalTokenCount(usage.outputTokens);
  const totalTokens = toOptionalTokenCount(usage.totalTokens);

  await client.query(
    `INSERT INTO image_provider_usage_records (
       task_id, provider_run_id, attempt, provider, model,
       provider_operation_id, provider_request_id, status,
       request_evidence_status, evidence_status,
       reference_image_count, additional_reference_image_count,
       output_width, output_height, output_pixels, output_tier,
       reference_unit_price_cny, reference_price_cny,
       output_pixel_threshold, small_output_price_cny, large_output_price_cny,
       output_price_cny, estimated_cost_cny, currency, pricing_status,
       price_version, pricing_source_url,
       generated_images, output_tokens, total_tokens,
       provider_terminal_at, usage_observed_at, error
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8,
       $9, $10,
       $11, $12,
       $13, $14, $15, $16,
       $17, $18,
       $19, $20, $21,
       $22, $23, 'CNY', $24,
       $25, $26,
       $27, $28, $29,
       $30, $31, $32
     )
     ON CONFLICT (provider_run_id) DO NOTHING`,
    [
      task.id,
      providerRun.id,
      toInt(task.provider_task_attempt ?? task.attempt),
      provider,
      task.model,
      providerOperationId,
      providerRequestId,
      status,
      requestEvidenceStatus,
      estimate.status,
      estimate.referenceImageCount,
      estimate.additionalReferenceImageCount,
      estimate.outputWidth,
      estimate.outputHeight,
      estimate.outputPixels,
      outputTier,
      formatCnyMicros(SEEDREAM_ADDITIONAL_REFERENCE_PRICE_CNY_MICROS),
      estimate.referencePriceCny,
      SEEDREAM_SMALL_IMAGE_MAX_PIXELS,
      formatCnyMicros(SEEDREAM_SMALL_IMAGE_PRICE_CNY_MICROS),
      formatCnyMicros(SEEDREAM_LARGE_IMAGE_PRICE_CNY_MICROS),
      estimate.outputPriceCny,
      estimate.estimatedCostCny,
      estimate.status === 'known' ? 'priced' : 'missing-evidence',
      estimate.priceVersion,
      estimate.pricingSourceUrl,
      generatedImages,
      outputTokens,
      totalTokens,
      providerTerminalAt,
      usageObservedAt,
      error ? safeErrorMessage(error) : null,
    ],
  );
}

function formatCnyMicros(value: number) {
  return (value / 1_000_000).toFixed(6);
}

async function createZeroCostCandidateForDeterministicRejection(
  client: DbClient,
  task: GenerationTaskRow,
  failure: ProviderFailure,
  usageRecord: UpsertedProviderUsageRecord | null,
) {
  const httpStatus = failure.providerHttpStatus;
  const deterministicClientRejection = Number.isInteger(httpStatus)
    && Number(httpStatus) >= 400
    && Number(httpStatus) < 500
    && ![408, 425, 499].includes(Number(httpStatus));
  const hasPositiveUsage = usageRecord !== null && (
    usageRecord.billable_tokens !== null || usageRecord.estimated_cost !== null
  );
  const pricingRule = findSeedancePricingRule({
    model: task.model,
    resolution: task.config.resolution,
    hasVideoInput: hasSeedanceVideoInput(task.config),
  });
  if (
    failure.provider !== 'volcengine-ark'
    || failure.submissionDisposition !== 'not-created'
    || failure.billingDisposition !== 'unbilled'
    || failure.providerTaskId
    || task.provider_task_id
    || !deterministicClientRejection
    || !failure.providerErrorCode?.trim()
    || !failure.providerRequestId?.trim()
    || !usageRecord
    || hasPositiveUsage
    || !pricingRule
  ) return;

  const expenseDate = beijingDate(String(usageRecord.local_accounting_date));
  const billPeriod = expenseDate.slice(0, 7);
  const pricingResolutionBand = pricingRule.resolution === '480p' || pricingRule.resolution === '720p'
    ? '480p-720p'
    : pricingRule.resolution;
  const pricingInputClass = pricingRule.hasVideoInput ? 'with-video' : 'without-video';
  const unitPricePerMillion = `${pricingRule.unitPricePerMillion}.000000`;
  const review = {
    status: 'pending-final-bill',
    reason: `${billPeriod} 官方账单尚未形成稳定 final 快照`,
    reconciliationRunId: null,
    billState: 'provisional',
    coverageState: 'partial',
    residualTokens: '0',
    residualCostCny: '0.000000',
    reviewedAt: null,
  };
  const evidenceCore = {
    resolutionKind: 'zero-cost',
    resolutionVersion: '2026-07-26-v1',
    evidenceType: 'deterministic-provider-rejection',
    taskId: task.id,
    usageRecordId: usageRecord.id,
    requestId: failure.providerRequestId.trim(),
    providerTaskId: null,
    providerHttpStatus: Number(httpStatus),
    providerErrorCode: failure.providerErrorCode.trim(),
    submissionDisposition: failure.submissionDisposition,
    billingDisposition: failure.billingDisposition,
    failureReason: failure.reason,
    billPeriod,
    expenseDate,
    localAccountingDate: expenseDate,
    model: task.model,
    pricingResolutionBand,
    pricingInputClass,
    unitPricePerMillion,
    providerLookup: {
      attempted: false,
      outcome: 'provider-task-not-created',
      note: '供应商在创建阶段确定性拒绝，未生成供应商任务 ID',
    },
    note: '账户账单桶级零成本候选；不代表供应商返回了逐任务零 Token 回执',
  };
  const evidence = { ...evidenceCore, review };
  const evidenceHash = createHash('sha256').update(canonicalJson(evidenceCore)).digest('hex');
  const caseKey = `zero-cost:${usageRecord.id}`;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO provider_reconciliation_cases (
       provider, case_key, bill_period, case_type, status, root_cause,
       confidence, token_adjustment, cost_adjustment_cny,
       official_expense_date, local_accounting_date, evidence, evidence_hash
     ) VALUES (
       'volcengine-ark', $1, $2, 'missing-local-usage', 'open',
       'provider-rejected-before-billing', 'high', 0, 0,
       $3::date, $3::date, $4::jsonb, $5
     )
     ON CONFLICT (provider, case_key) DO NOTHING
     RETURNING id::text`,
    [caseKey, billPeriod, expenseDate, JSON.stringify(evidence), evidenceHash],
  );
  const existing = inserted.rows[0] ?? (await client.query<{ id: string }>(
    `SELECT id::text
     FROM provider_reconciliation_cases
     WHERE provider = 'volcengine-ark' AND case_key = $1`,
    [caseKey],
  )).rows[0];
  if (!existing) throw new Error(`零成本候选写入失败：${caseKey}`);

  await client.query(
    `INSERT INTO provider_reconciliation_case_links (
       case_id, usage_record_id, bill_detail_id, bill_detail_revision_id,
       allocated_tokens, allocated_cost_cny
     )
     SELECT $1::uuid, $2::uuid, NULL, NULL, 0, 0
     WHERE NOT EXISTS (
       SELECT 1 FROM provider_reconciliation_case_links
       WHERE case_id = $1::uuid AND usage_record_id = $2::uuid
     )`,
    [existing.id, usageRecord.id],
  );
  const auditDetail = canonicalJson({
    version: '2026-07-26-v1',
    caseId: existing.id,
    caseKey,
    taskId: task.id,
    usageRecordId: usageRecord.id,
    providerHttpStatus: Number(httpStatus),
    providerErrorCode: failure.providerErrorCode.trim(),
    requestId: failure.providerRequestId.trim(),
    initialStatus: 'open',
    protectedFields: [
      'completion_tokens', 'total_tokens', 'billable_tokens',
      'estimated_cost', 'task_status', 'credit_status',
    ],
  });
  await client.query(
    `INSERT INTO audit_logs (
       admin_user_id, admin_email, module, action, target, risk, detail
     )
     SELECT NULL, 'system@lindyson.local', 'API成本与用量',
            '建立确定性拒绝零成本候选', $1, 'high', $2
     WHERE NOT EXISTS (
       SELECT 1 FROM audit_logs
       WHERE module = 'API成本与用量'
         AND action = '建立确定性拒绝零成本候选'
         AND target = $1 AND risk = 'high' AND detail = $2
     )`,
    [caseKey, auditDetail],
  );
}

function normalizeUsageDateTime(value: string | null | undefined) {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function beijingDate(value: string) {
  return new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function toOptionalTokenCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

export async function sanitizeGenerationConfig(
  client: DbClient,
  input: CreateGenerationTaskInput,
  realPortraitReference: RealPortraitGenerationReference | null = null,
): Promise<Record<string, unknown>> {
  if (input.kind === 'video') {
    return sanitizeSeedanceVideoConfig({
      client,
      userId: input.userId,
      model: input.model,
      config: input.config,
      references: input.references,
      realPortraitReference,
    });
  }
  return sanitizeSeedreamImageConfig({
    client,
    userId: input.userId,
    model: input.model,
    prompt: input.prompt,
    config: input.config,
    references: (input.references ?? []) as SeedreamImageReferenceInput[],
    annotations: input.annotations,
  });
}

async function resolveHistoricalRealPortraitReferenceWithClient(
  client: DbClient,
  task: Pick<GenerationTaskRow, 'id' | 'attempt' | 'user_id' | 'config'>,
) {
  const result = await client.query<{ actor_id: string; portrait_asset_id: string }>(
    `SELECT actor_id, portrait_asset_id
     FROM generation_real_portrait_references
     WHERE task_id = $1 AND task_attempt = $2
     ORDER BY position
     LIMIT 2`,
    [task.id, task.attempt],
  );
  if (result.rows.length > 1) {
    throw Object.assign(new Error('一次生成最多只能引用一位真人演员'), {
      statusCode: 409,
      code: 'REAL_PORTRAIT_REFERENCE_COUNT_INVALID',
    });
  }
  const stored = result.rows[0];
  if (!stored) {
    if (task.config.realPortraitReference !== undefined) {
      throw Object.assign(new Error('真人演员引用缺少服务端绑定记录，无法安全重试'), {
        statusCode: 409,
        code: 'REAL_PORTRAIT_BINDING_MISSING',
      });
    }
    return null;
  }
  return resolveRealPortraitGenerationReferenceWithClient(client, task.user_id, {
    actorId: stored.actor_id,
    portraitAssetId: stored.portrait_asset_id,
  });
}

async function createGeneratedAsset(
  client: DbClient,
  task: GenerationTaskRow,
  providerResult: ProviderSuccess,
) {
  const source = task.kind === 'video' ? 'ai-video' : 'ai-image';
  const type = task.kind === 'video' ? 'video' : 'image';
  const folderId = await resolveAssetFolderId(client, {
    userId: task.user_id,
    source,
    folderId: null,
  });

  const assetResult = await client.query<{ id: string }>(
    `INSERT INTO assets (
       user_id, folder_id, name, type, source, object_key, thumbnail_key,
       public_url, thumbnail_url, size_bytes, duration_seconds, width, height, generation_meta,
       thumbnail_status, thumbnail_error_code, thumbnail_error_message, thumbnail_updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       CASE WHEN $7::text IS NULL THEN 'pending' ELSE 'ready' END,
       NULL, NULL, CASE WHEN $7::text IS NULL THEN NULL ELSE now() END
     )
     ON CONFLICT (user_id, object_key) DO UPDATE
     SET updated_at = assets.updated_at
     WHERE assets.type = EXCLUDED.type AND assets.source = EXCLUDED.source
     RETURNING id`,
    [
      task.user_id,
      folderId,
      `${task.model} ${task.kind === 'video' ? '视频' : '图片'} ${new Date().toISOString().slice(0, 10)}`,
      type,
      source,
      providerResult.objectKey,
      providerResult.thumbnailKey,
      providerResult.publicUrl,
      providerResult.thumbnailUrl,
      providerResult.sizeBytes,
      providerResult.durationSeconds,
      providerResult.width,
      providerResult.height,
      {
        kind: task.kind,
        model: task.model,
        prompt: task.prompt,
        config: task.config,
        credits: task.credits,
        durationSource: providerResult.durationSource ?? 'unknown',
      },
    ],
  );

  const asset = assetResult.rows[0];
  if (!asset) {
    throw new Error('生成对象已被同用户的不同类型资产占用');
  }
  return asset.id;
}
