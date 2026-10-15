import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  promptWizardBatchSchema,
  promptWizardConceptSetSchema,
  promptWizardConceptPreviewSchema,
  promptWizardEvidenceGraphSchema,
  promptWizardPlanSchema,
  promptWizardPlanRevisionSchema,
  promptWizardProductProfileSchema,
  promptWizardProductionBriefSchema,
  promptWizardRouteSetV6Schema,
  promptWizardRunSchema,
  promptWizardSettingsSchema,
  promptWizardUseDirectionSchema,
  promptWizardUseDirectionSetSchema,
  promptWizardVideoConfigSchema,
  type PromptWizardBatch,
  type PromptWizardConceptPreview,
  type PromptWizardConceptSet,
  type PromptWizardCustomScene,
  type PromptWizardCreativeBrief,
  type PromptWizardCreativeBriefV6,
  type PromptWizardEvidenceGraph,
  type PromptWizardPlan,
  type PromptWizardPlanV4,
  type PromptWizardPlanV5,
  type PromptWizardPlanV6,
  type PromptWizardPlanRevision,
  type PromptWizardProductionBrief,
  type PromptWizardRefinementAction,
  type PromptWizardProductProfile,
  type PromptWizardRun,
  type PromptWizardRunCreativeBrief,
  type PromptWizardRouteSetV6,
  type PromptWizardUseDirection,
  type PromptWizardUseDirectionPlanContext,
  type PromptWizardUseDirectionSet,
  type PromptWizardVideoConfig,
} from '@lindyson/api-contracts';
import type { DbClient } from '../db/pool.js';
import { pool, withTransaction } from '../db/pool.js';
import { readOwnedAssetReferencesByIds, type OwnedAssetReferenceRow } from './assetReferences.js';
import { signOwnedObjectReadUrls } from './assetReadUrlSigner.js';
import { planGenerationLotAllocationsWithClient } from './generationCredits.js';
import {
  holdPromptWizardCreditsWithClient,
  releasePromptWizardCreditsWithClient,
  settlePromptWizardCreditsWithClient,
} from './promptWizardCredits.js';
import {
  analyzePromptWizardUseDirectionPlanDifferences,
  validatePromptWizardPlanDiversity,
  validatePromptWizardPlanHistory,
  type PromptWizardUseDirectionDifferenceAnalysis,
} from './promptWizardDiversity.js';
import {
  assertPromptWizardProductInputClaims,
  assertPromptWizardNoFirstLastSemantics,
  assertPromptWizardUseDirectionDraftBoundary,
  buildPromptWizardSafeHookDiversityCandidates,
  buildPromptWizardConstraintBlock,
  normalizePromptWizardProductionPrompt,
  omitPromptWizardConfirmedOffer,
  renderPromptWizardPlan,
  renderPromptWizardUseDirectionPlan,
  renderPromptWizardRoutePlanV6,
  normalizePromptWizardRouteDraftV6,
  promptWizardBeatRolesV6,
  promptWizardPlanDraftSchema,
  promptWizardSingleFamilyAction,
  promptWizardStringLeaves,
  promptWizardTimeline,
  promptWizardTimelineV6,
  stabilizePromptWizardUseDirectionMajorActions,
  stabilizePromptWizardUseDirectionFirstShot,
  type PromptWizardSafeDiversityDimension,
  type PromptWizardPlanDraft,
} from './promptWizardPrompt.js';
import {
  buildPromptWizardSafeHook,
  buildPromptWizardSafeTitle,
} from './promptWizardSafeTitle.js';
import {
  strategySignature,
  type PromptWizardStrategy,
} from './promptWizardStrategy.js';
import {
  isPromptWizardPlanIndex,
  PROMPT_WIZARD_PLAN_COUNT,
  PROMPT_WIZARD_LEGACY_PLAN_INDEXES,
  PROMPT_WIZARD_V6_PLAN_INDEXES,
  PROMPT_WIZARD_V6_PLAN_COUNT,
  type PromptWizardPlanIndex,
} from './promptWizardPlanCount.js';
import { toInt, toIsoDateTime } from './serialization.js';
import { reconcileSubscriptionWithClient } from './subscriptionLifecycle.js';
import { env } from '../config/env.js';
import { getStoredObjectSize } from '../storage/storageService.js';
import {
  getPromptWizardProvider,
  type PromptWizardProductEvidenceSource,
  type PromptWizardOutputDiagnostic,
  type PromptWizardOutputSchemaIssue,
  type PromptWizardProvider,
  type PromptWizardRepairDiagnostic,
  type PromptWizardProviderUsage,
} from '../providers/promptWizardProvider.js';
import {
  buildPromptWizardEvidenceGraph,
  mergePromptWizardProductionBriefEvidence,
  reconcilePromptWizardEvidenceGraphForProfileUpdate,
} from './promptWizardEvidenceGraph.js';
import {
  buildAllPromptWizardDirectionAssessments,
  buildPromptWizardProductionBrief,
} from './promptWizardCreativePlaybook.js';
import {
  assertPromptWizardConceptSet,
  assertPromptWizardConceptExpansion,
  conceptPreviewToAssignment,
  selectPromptWizardConceptPair,
} from './promptWizardConceptDirector.js';
import type { PromptWizardCostOwner } from './promptWizardCostLedger.js';
import {
  type PromptWizardConceptAssignment,
} from './promptWizardConceptContext.js';
import { incrementPromptWizardDailyMetricsWithClient } from './promptWizardMetrics.js';
import {
  assertPromptWizardUseDirections,
  orderPromptWizardUseDirectionsForDefaultSelection,
  validatePromptWizardUseDirectionSelection,
  PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION,
} from './promptWizardUseDirections.js';
import {
  assertPromptWizardMotionDensity,
  assertPromptWizardVoiceoverCoverage,
  promptWizardContainsStaticInstruction,
  PromptWizardMotionDensityError,
  PromptWizardVoiceoverCoverageError,
} from './promptWizardConversionQuality.js';
import {
  assertPromptWizardShotExecutionBudget,
  countPromptWizardVoiceoverUnits,
  getPromptWizardV6ExecutionBudget,
  getPromptWizardSegmentVoiceoverBudgets,
  getPromptWizardTotalVoiceoverBudget,
  PromptWizardExecutionBudgetError,
  type PromptWizardExecutionBudgetIssue,
} from './promptWizardExecutionBudget.js';
import {
  buildPromptWizardRouteSetV6,
  inferPromptWizardOrdinaryCategoryFunctions,
  promptWizardRouteContextsV6,
  promptWizardRoutePlanContextsV6,
} from './promptWizardV6Routes.js';
import { enqueuePromptWizardRouteSetV6 } from '../queues/promptWizardQueue.js';

interface PromptWizardRunRow {
  id: string;
  user_id: string;
  engine_version: number | string;
  status: string;
  revision: number | string;
  image_asset_ids: string[];
  product_profile: unknown;
  evidence_graph: unknown;
  production_brief: unknown;
  creative_brief: unknown;
  video_config: unknown;
  failure_reason: string | null;
  attempt_count: number | string;
  started_at: Date | string | null;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PromptWizardBatchRow {
  id: string;
  run_id: string;
  user_id: string;
  ordinal: number | string;
  request_hash: string;
  run_revision: number | string;
  status: string;
  is_free: boolean;
  credits: number | string;
  credit_status: string;
  main_credits_used: number | string;
  addon_credits_used: number | string;
  image_asset_ids: string[];
  product_profile: unknown;
  creative_brief: unknown;
  video_config: unknown;
  concept_set_id: string | null;
  selected_concept_ids: string[];
  use_direction_set_id: string | null;
  selected_use_direction_id: string | null;
  selected_scene_id: string | null;
  custom_scene: unknown;
  route_set_id: string | null;
  plans: unknown;
  strategy_signatures: unknown;
  failure_reason: string | null;
  attempt_count: number | string;
  content_purged_at: Date | string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  run_status?: string;
  run_expires_at?: Date | string;
  run_engine_version?: number | string;
}

interface PromptWizardSettingsRow {
  refresh_credits: number | string;
  available: boolean;
  engine_version: number | string;
  updated_at: Date | string;
}

interface PromptWizardConceptSetRow {
  id: string;
  run_id: string;
  user_id: string;
  run_revision: number | string;
  idempotency_key: string;
  request_hash: string;
  status: string;
  candidates: unknown;
  recommended_concept_ids: string[];
  failure_reason: string | null;
  attempt_count: number | string;
  started_at: Date | string | null;
  provider_model: string | null;
  provider_interaction_id: string | null;
  provider_input_tokens: number | string | null;
  provider_output_tokens: number | string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  updated_at: Date | string;
  content_purged_at: Date | string | null;
  expires_at: Date | string;
  run_status?: string;
  run_expires_at?: Date | string;
  run_engine_version?: number | string;
}

interface PromptWizardUseDirectionSetRow {
  id: string;
  run_id: string;
  user_id: string;
  run_revision: number | string;
  idempotency_key: string;
  request_hash: string;
  status: string;
  directions: unknown;
  clarification_question: string | null;
  clarification_count: number | string;
  failure_reason: string | null;
  attempt_count: number | string;
  started_at: Date | string | null;
  provider_model: string | null;
  provider_interaction_id: string | null;
  provider_input_tokens: number | string | null;
  provider_output_tokens: number | string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  updated_at: Date | string;
  content_purged_at: Date | string | null;
  expires_at: Date | string;
  run_status?: string;
  run_expires_at?: Date | string;
  run_engine_version?: number | string;
}

interface PromptWizardPlanRevisionRow {
  id: string;
  batch_id: string;
  run_id: string;
  user_id: string;
  source_plan_id: string;
  concept_id: string | null;
  use_direction_id: string | null;
  plan_index: number | string;
  idempotency_key: string;
  request_hash: string;
  action: string;
  replacement_scene: string | null;
  status: string;
  is_free: boolean;
  plan: unknown;
  failure_reason: string | null;
  attempt_count: number | string;
  started_at: Date | string | null;
  provider_model: string | null;
  provider_interaction_id: string | null;
  provider_input_tokens: number | string | null;
  provider_output_tokens: number | string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  updated_at: Date | string;
  content_purged_at: Date | string | null;
  expires_at: Date | string;
  run_engine_version?: number | string;
}

interface PromptWizardRouteSetV6Row {
  id: string;
  run_id: string;
  user_id: string;
  run_revision: number | string;
  status: string;
  routes: unknown;
  failure_reason: string | null;
  attempt_count: number | string;
  started_at: Date | string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  updated_at: Date | string;
  expires_at: Date | string;
}

const VIDEO_MODEL_LABELS: Record<PromptWizardVideoConfig['model'], string> = {
  'seedance-2.0': 'Seedance 2.0',
  'seedance-2.0-fast': 'Seedance 2.0 Fast',
  'seedance-2.0-mini': 'Seedance 2.0 Mini',
};

const PROMPT_WIZARD_REPAIRABLE_ERROR_CODES = new Set([
  'PROMPT_WIZARD_TIMELINE_INVALID',
  'PROMPT_WIZARD_BEAT_INVALID',
  'PROMPT_WIZARD_EVIDENCE_INVALID',
  'PROMPT_WIZARD_REFERENCE_INVALID',
  'PROMPT_WIZARD_REFERENCE_MODE_INVALID',
  'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
  'PROMPT_WIZARD_UNSAFE_CONTENT',
  'PROMPT_WIZARD_PROMPT_TOO_LONG',
  'PROMPT_WIZARD_TRANSLATION_INVALID',
  'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
  'PROMPT_WIZARD_VOICEOVER_TOO_LONG',
  'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
  'PROMPT_WIZARD_CONVERSION_CTA_INVALID',
  'PROMPT_WIZARD_SOUND_DESIGN_VISUAL_CLOSURE_INVALID',
  'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
  'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED',
  'PROMPT_WIZARD_CONCEPT_DRIFT',
  'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID',
]);

// 诊断是可被 Canary 持久化的审计边界。这里使用有限集合，不能因为字符串
// “长得像错误码”就把 Provider 或异常对象的任意字段带入证据事件。
const PROMPT_WIZARD_REPAIR_DIAGNOSTIC_ERROR_CODES = new Set([
  ...PROMPT_WIZARD_REPAIRABLE_ERROR_CODES,
  'PROMPT_WIZARD_DIVERSITY_FAILED',
  'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
]);

const PROMPT_WIZARD_MIN_CONTENT_REPAIR_BUDGET_MS = 60_000;
const PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS = 2;
// 以下确定性收口只在该方案已经成功消费至少一次物理内容修复后启用；
// 它们不会增加 Provider 请求，也不会放宽任何后续领域校验。当前 V6/A28
// 允许每方案最多两次 Provider 内容修复，第三次必须在 HTTP 委托前拒绝。
const PROMPT_WIZARD_V6_SAFE_FALLBACK_MIN_CONTENT_REPAIR_REQUESTS = 1;
const PROMPT_WIZARD_USE_DIRECTION_BUDGET_MS = 120_000;

function promptWizardTimestampExpired(value: Date | string | undefined) {
  const timestamp = value === undefined ? Number.NaN : new Date(value).getTime();
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

function promptWizardRunIsActivelyAnalyzing(run: PromptWizardRunRow) {
  return run.status === 'analyzing' && run.started_at !== null;
}

function promptWizardChildIsActive(status: string) {
  return status === 'queued' || status === 'processing';
}

const PROMPT_WIZARD_LEGACY_RUN_MESSAGE = '旧版提示词任务已退役，请重新识别产品。';

function assertPromptWizardV3Run(run: Pick<PromptWizardRunRow, 'engine_version'>) {
  if (toInt(run.engine_version) !== 3) {
    throw serviceError(
      PROMPT_WIZARD_LEGACY_RUN_MESSAGE,
      410,
      'PROMPT_WIZARD_LEGACY_RUN_RETIRED',
    );
  }
}

function assertPromptWizardV3JoinedRun(row: {
  run_engine_version?: number | string;
}) {
  if (toInt(row.run_engine_version) !== 3) {
    throw serviceError(
      PROMPT_WIZARD_LEGACY_RUN_MESSAGE,
      410,
      'PROMPT_WIZARD_LEGACY_RUN_RETIRED',
    );
  }
}

function assertPromptWizardReadableRun(run: Pick<PromptWizardRunRow, 'engine_version'>) {
  const engineVersion = toInt(run.engine_version);
  if (engineVersion !== 3 && engineVersion !== 4) {
    throw serviceError(
      PROMPT_WIZARD_LEGACY_RUN_MESSAGE,
      410,
      'PROMPT_WIZARD_LEGACY_RUN_RETIRED',
    );
  }
}

function assertPromptWizardReadableJoinedRun(row: { run_engine_version?: number | string }) {
  const engineVersion = toInt(row.run_engine_version);
  if (engineVersion !== 3 && engineVersion !== 4) {
    throw serviceError(
      PROMPT_WIZARD_LEGACY_RUN_MESSAGE,
      410,
      'PROMPT_WIZARD_LEGACY_RUN_RETIRED',
    );
  }
}

function assertPromptWizardV6Run(run: Pick<PromptWizardRunRow, 'engine_version'>) {
  const engineVersion = toInt(run.engine_version);
  if (engineVersion === 3) {
    throw serviceError(
      '历史提示词任务仅支持查看，请重新识别商品后生成三方向方案。',
      410,
      'PROMPT_WIZARD_LEGACY_RUN_READ_ONLY',
    );
  }
  if (engineVersion !== 4) {
    throw serviceError(
      PROMPT_WIZARD_LEGACY_RUN_MESSAGE,
      410,
      'PROMPT_WIZARD_LEGACY_RUN_RETIRED',
    );
  }
}

function assertPromptWizardRunContentReady(run: PromptWizardRunRow) {
  if (
    run.status === 'ready'
    && (!run.product_profile || !run.evidence_graph || !run.production_brief)
  ) {
    const v6 = toInt(run.engine_version) === 4;
    throw serviceError(
      v6
        ? 'V6 产品证据尚未完整生成，请重新识别商品。'
        : '3.0 产品证据尚未完整生成，请重新识别产品。',
      409,
      v6 ? 'PROMPT_WIZARD_V6_RUN_INCOMPLETE' : 'PROMPT_WIZARD_V3_RUN_INCOMPLETE',
    );
  }
}

export async function readPromptWizardSettings(client: DbClient = pool) {
  const result = await client.query<PromptWizardSettingsRow>(
    `SELECT refresh_credits, available, engine_version, updated_at
     FROM prompt_wizard_settings WHERE singleton_id = 1`,
  );
  const row = result.rows[0];
  if (!row) throw serviceError('提示词向导配置不存在', 503, 'PROMPT_WIZARD_SETTINGS_MISSING');
  return mapPromptWizardSettings(row);
}

async function readPromptWizardRuntimeEngineVersion(client: DbClient = pool) {
  const result = await client.query<Pick<PromptWizardSettingsRow, 'engine_version'>>(
    `SELECT engine_version
     FROM prompt_wizard_settings WHERE singleton_id = 1`,
  );
  const row = result.rows[0];
  if (!row) throw serviceError('提示词向导配置不存在', 503, 'PROMPT_WIZARD_SETTINGS_MISSING');
  const engineVersion = toInt(row.engine_version);
  if (engineVersion !== 3 && engineVersion !== 4) {
    throw serviceError(
      '提示词向导运行时版本不受支持',
      503,
      'PROMPT_WIZARD_ENGINE_VERSION_UNSUPPORTED',
    );
  }
  return engineVersion;
}

function promptWizardV6EngineNotReadyError() {
  return serviceError(
    '提示词向导新版尚未完成数据库迁移，当前不可开启或创建任务。',
    409,
    'PROMPT_WIZARD_V6_ENGINE_NOT_READY',
  );
}

export async function updatePromptWizardSettingsWithClient(input: {
  client: DbClient;
  adminUserId: string;
  generationCredits?: number;
  available?: boolean;
}) {
  const currentResult = await input.client.query<PromptWizardSettingsRow>(
    `SELECT refresh_credits, available, engine_version, updated_at
     FROM prompt_wizard_settings
     WHERE singleton_id = 1
     FOR UPDATE`,
  );
  const current = currentResult.rows[0];
  if (!current) {
    throw serviceError('提示词向导配置不存在', 503, 'PROMPT_WIZARD_SETTINGS_MISSING');
  }
  const engineVersion = toInt(current.engine_version);
  if (engineVersion !== 3 && engineVersion !== 4) {
    throw serviceError(
      '提示词向导运行时版本不受支持',
      503,
      'PROMPT_WIZARD_ENGINE_VERSION_UNSUPPORTED',
    );
  }
  // Migration 071 会在同一事务中把设置引擎切到 4 并创建 V6 路线表。
  // 在此之前不能让管理接口单独打开向导，更不能借设置更新绕过迁移约束。
  if (engineVersion === 3 && input.available === true) {
    throw promptWizardV6EngineNotReadyError();
  }
  const result = await input.client.query<PromptWizardSettingsRow>(
    `UPDATE prompt_wizard_settings
     SET refresh_credits = COALESCE($2, refresh_credits),
         available = COALESCE($3, available),
         updated_by = $1,
         updated_at = now()
     WHERE singleton_id = 1
     RETURNING refresh_credits, available, engine_version, updated_at`,
    [
      input.adminUserId,
      input.generationCredits ?? null,
      input.available ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw serviceError('提示词向导配置不存在', 503, 'PROMPT_WIZARD_SETTINGS_MISSING');
  return mapPromptWizardSettings(row);
}

export async function createPromptWizardRun(input: {
  userId: string;
  imageAssetIds: string[];
}) {
  const imageAssetIds = Array.from(new Set(input.imageAssetIds));
  if (imageAssetIds.length < 1 || imageAssetIds.length > 9) {
    throw serviceError('请选择 1–9 张产品图片', 400, 'PROMPT_WIZARD_IMAGE_COUNT_INVALID');
  }
  return withTransaction(async client => {
    const settings = await readPromptWizardSettings(client);
    if (settings.engineVersion !== 4) {
      throw promptWizardV6EngineNotReadyError();
    }
    if (!settings.available) {
      throw serviceError('提示词向导当前未开放', 409, 'PROMPT_WIZARD_UNAVAILABLE');
    }
    const user = await client.query<{ status: string }>(
      'SELECT status FROM users WHERE id = $1 FOR UPDATE',
      [input.userId],
    );
    if (!user.rows[0]) throw serviceError('未找到用户', 404, 'USER_NOT_FOUND');
    if (user.rows[0].status === 'frozen') {
      throw serviceError('账号已冻结，无法使用提示词向导', 403, 'ACCOUNT_FROZEN');
    }
    await requireOwnedImageAssets(client, input.userId, imageAssetIds);
    const result = await client.query<PromptWizardRunRow>(
      `INSERT INTO prompt_wizard_runs (user_id, image_asset_ids, engine_version)
       VALUES ($1, $2::uuid[], 4)
       RETURNING *`,
      [input.userId, imageAssetIds],
    );
    return mapPromptWizardRun(result.rows[0]!);
  });
}

export async function getPromptWizardRun(userId: string, runId: string) {
  const result = await pool.query<PromptWizardRunRow>(
    'SELECT * FROM prompt_wizard_runs WHERE id = $1 AND user_id = $2',
    [runId, userId],
  );
  const row = result.rows[0];
  if (!row) throw serviceError('提示词向导任务不存在', 404, 'PROMPT_WIZARD_RUN_NOT_FOUND');
  assertPromptWizardReadableRun(row);
  assertPromptWizardRunContentReady(row);
  if (
    row.status === 'archived'
    || (promptWizardTimestampExpired(row.expires_at) && !promptWizardRunIsActivelyAnalyzing(row))
  ) {
    throw serviceError('该提示词向导任务已过期', 410, 'PROMPT_WIZARD_RUN_EXPIRED');
  }
  return mapPromptWizardRun(row);
}

/**
 * 在解析只属于 V6 的请求体前执行轻量版本预检。
 *
 * engine 3 历史任务只读，更早版本已退役；两者都不能绕过
 * V6 Schema 创建新写任务。真正的状态、revision 与并发校验仍由
 * 后续事务方法负责。
 */
export async function assertPromptWizardRunAcceptsV6Requests(userId: string, runId: string) {
  const result = await pool.query<Pick<PromptWizardRunRow, 'engine_version'>>(
    'SELECT engine_version FROM prompt_wizard_runs WHERE id = $1 AND user_id = $2',
    [runId, userId],
  );
  const run = result.rows[0];
  if (!run) throw serviceError('提示词向导任务不存在', 404, 'PROMPT_WIZARD_RUN_NOT_FOUND');
  assertPromptWizardV6Run(run);
}

export async function updatePromptWizardRun(input: {
  userId: string;
  runId: string;
  revision: number;
  productProfile: PromptWizardProductProfile;
}) {
  const updated = await withTransaction(async client => {
    const current = await client.query<PromptWizardRunRow>(
      `SELECT * FROM prompt_wizard_runs
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [input.runId, input.userId],
    );
    const run = current.rows[0];
    if (!run) throw serviceError('提示词向导任务不存在', 404, 'PROMPT_WIZARD_RUN_NOT_FOUND');
    assertPromptWizardV6Run(run);
    assertPromptWizardRunContentReady(run);
    if (promptWizardTimestampExpired(run.expires_at)) {
      throw serviceError('该提示词向导任务已过期', 410, 'PROMPT_WIZARD_RUN_EXPIRED');
    }
    if (run.status !== 'ready') {
      throw serviceError('产品识别尚未完成', 409, 'PROMPT_WIZARD_RUN_NOT_READY');
    }
    if (toInt(run.revision) !== input.revision) {
      throw serviceError('向导内容已变化，请刷新后重试', 409, 'PROMPT_WIZARD_REVISION_CONFLICT');
    }
    const serverRecognizedProfile = requireProductProfile(run.product_profile);
    const normalizedProductProfile = normalizePromptWizardProductProfile({
      ...input.productProfile,
      // V6 不提供受众、场景或营销目标选择。字段为 V4/V5 历史读取和产品
      // 识别 Provider 输出继续保留，但修正请求不能借完整 productProfile
      // 契约篡改路线规划；权威值始终来自本次服务端识别结果。
      suggestedAudience: serverRecognizedProfile.suggestedAudience,
      suggestedScenarios: serverRecognizedProfile.suggestedScenarios,
    });
    const active = await client.query(
      `SELECT 1
       WHERE EXISTS (
         SELECT 1 FROM prompt_wizard_batches
         WHERE run_id = $1 AND status IN ('queued', 'processing')
       )`,
      [input.runId],
    );
    if (active.rowCount) {
      throw serviceError('方案正在生成，暂时不能修改配置', 409, 'PROMPT_WIZARD_BATCH_ACTIVE');
    }

    const constraintLength = buildPromptWizardConstraintBlock(
      normalizedProductProfile,
      run.image_asset_ids.length,
    ).length;
    if (constraintLength > 1_600) {
      throw serviceError(
        '产品一致性与已确认卖点内容过长，请精简到 1600 字符以内',
        400,
        'PROMPT_WIZARD_PRODUCT_CONSTRAINT_TOO_LONG',
      );
    }

    // V6 PATCH 只修正识别结果。生产简报和证据图谱必须由服务端根据
    // 修正后的商品档案重新派生，客户端不能再写入旧方向/场景/参数状态。
    const currentProfile = normalizedProductProfile;
    const currentProductionBrief = buildPromptWizardProductionBrief(currentProfile);
    const baseEvidenceGraph = reconcilePromptWizardEvidenceGraphForProfileUpdate({
      profile: currentProfile,
      imageAssetIds: run.image_asset_ids,
      previousGraph: requireEvidenceGraph(run.evidence_graph),
    });
    const briefEvidenceGraph = mergePromptWizardProductionBriefEvidence(
      baseEvidenceGraph,
      currentProductionBrief,
    );
    const nextEvidenceGraph = promptWizardEvidenceGraphSchema.parse({
      ...briefEvidenceGraph,
      directionAssessments: buildAllPromptWizardDirectionAssessments({
        graph: briefEvidenceGraph,
        productionBrief: currentProductionBrief,
      }),
    });
    const profileWithCategoryInference = promptWizardProductProfileSchema.parse({
      ...currentProfile,
      categoryInferredFunctions: inferPromptWizardOrdinaryCategoryFunctions(
        currentProfile,
        nextEvidenceGraph,
      ),
    });

    // 内部三路线会在商品识别完成后后台预生成。用户修正识别结果后，
    // 旧 route set 的 run_revision 已失效，必须先显式终止再为新 revision
    // 创建一组路线。engine 3 旧方向任务由 worker 恢复链路独立收尾，V6
    // 修正入口不写历史方向表。
    await client.query(
      `UPDATE prompt_wizard_route_sets
       SET status = 'failed', routes = NULL,
           failure_reason = '向导配置已更新，内部三路线将重新规划。',
           completed_at = now(), updated_at = now()
       WHERE run_id = $1 AND status IN ('queued', 'processing')`,
      [input.runId],
    );

    const result = await client.query<PromptWizardRunRow>(
      `UPDATE prompt_wizard_runs
       SET product_profile = $4::jsonb,
           production_brief = $5::jsonb,
           evidence_graph = $6::jsonb,
           revision = revision + 1,
           expires_at = now() + interval '24 hours',
           updated_at = now()
       WHERE id = $1 AND user_id = $2 AND revision = $3
       RETURNING *`,
      [
        input.runId,
        input.userId,
        input.revision,
        JSON.stringify(profileWithCategoryInference),
        JSON.stringify(currentProductionBrief),
        JSON.stringify(nextEvidenceGraph),
      ],
    );
    if (!result.rows[0]) {
      throw serviceError('向导内容已变化，请刷新后重试', 409, 'PROMPT_WIZARD_REVISION_CONFLICT');
    }
    const routeSet = await createQueuedPromptWizardRouteSetV6WithClient(client, result.rows[0]!);
    return { run: mapPromptWizardRun(result.rows[0]), routeSetId: routeSet.id };
  });
  if (updated.routeSetId) {
    void enqueuePromptWizardRouteSetV6(updated.routeSetId).catch(error => {
      console.error(JSON.stringify({
        event: 'prompt-wizard-route-set-enqueue-failed',
        routeSetId: updated.routeSetId,
        reason: error instanceof Error ? error.message : String(error),
      }));
    });
  }
  return updated.run;
}

export async function getPromptWizardConceptSet(userId: string, conceptSetId: string) {
  const result = await pool.query<PromptWizardConceptSetRow>(
    `SELECT concept_set.*, run.engine_version AS run_engine_version,
            run.status AS run_status, run.expires_at AS run_expires_at
     FROM prompt_wizard_concept_sets concept_set
     JOIN prompt_wizard_runs run ON run.id = concept_set.run_id
     WHERE concept_set.id = $1 AND concept_set.user_id = $2`,
    [conceptSetId, userId],
  );
  const row = result.rows[0];
  if (!row) throw serviceError('创意路线任务不存在', 404, 'PROMPT_WIZARD_CONCEPT_SET_NOT_FOUND');
  assertPromptWizardV3JoinedRun(row);
  if (
    row.content_purged_at
    || (promptWizardTimestampExpired(row.expires_at) && !promptWizardChildIsActive(row.status))
  ) {
    throw serviceError('该创意路线任务已过期', 410, 'PROMPT_WIZARD_CONCEPT_SET_EXPIRED');
  }
  return mapPromptWizardConceptSet(row);
}

export async function getPromptWizardUseDirectionSet(
  userId: string,
  useDirectionSetId: string,
) {
  const result = await pool.query<PromptWizardUseDirectionSetRow>(
    `SELECT direction_set.*, run.engine_version AS run_engine_version,
            run.status AS run_status, run.expires_at AS run_expires_at
     FROM prompt_wizard_use_direction_sets direction_set
     JOIN prompt_wizard_runs run ON run.id = direction_set.run_id
     WHERE direction_set.id = $1 AND direction_set.user_id = $2`,
    [useDirectionSetId, userId],
  );
  const row = result.rows[0];
  if (!row) throw serviceError('使用方向任务不存在', 404, 'PROMPT_WIZARD_USE_DIRECTION_SET_NOT_FOUND');
  assertPromptWizardV3JoinedRun(row);
  if (
    row.content_purged_at
    || (promptWizardTimestampExpired(row.expires_at) && !promptWizardChildIsActive(row.status))
  ) {
    throw serviceError('该使用方向任务已过期', 410, 'PROMPT_WIZARD_USE_DIRECTION_SET_EXPIRED');
  }
  return mapPromptWizardUseDirectionSet(row);
}

export async function processPromptWizardUseDirectionSet(useDirectionSetId: string) {
  const claimed = await pool.query<PromptWizardUseDirectionSetRow>(
    `UPDATE prompt_wizard_use_direction_sets
     SET status = 'processing', started_at = now(),
         attempt_count = attempt_count + 1, updated_at = now()
     WHERE id = $1 AND status = 'queued'
     RETURNING *`,
    [useDirectionSetId],
  );
  const directionSet = claimed.rows[0];
  if (!directionSet) return;

  let usage: PromptWizardProviderUsage | null = null;
  try {
    const runResult = await pool.query<PromptWizardRunRow>(
      'SELECT * FROM prompt_wizard_runs WHERE id = $1 AND user_id = $2',
      [directionSet.run_id, directionSet.user_id],
    );
    const run = runResult.rows[0];
    if (run) assertPromptWizardV3Run(run);
    if (
      !run
      || run.status !== 'ready'
      || toInt(run.revision) !== toInt(directionSet.run_revision)
    ) {
      throw Object.assign(new Error('产品信息已变化，使用方向任务已失效'), {
        code: 'PROMPT_WIZARD_USE_DIRECTION_SET_STALE',
      });
    }
    assertPromptWizardRunContentReady(run);
    const profile = requireProductProfile(run.product_profile);
    const evidenceGraph = requireEvidenceGraph(run.evidence_graph);
    const historicalRows = await pool.query<{ directions: unknown }>(
      `SELECT directions FROM prompt_wizard_use_direction_sets
       WHERE run_id = $1 AND id <> $2 AND status = 'completed'
         AND content_purged_at IS NULL
       ORDER BY created_at ASC`,
      [directionSet.run_id, directionSet.id],
    );
    const historicalDirections = historicalRows.rows.flatMap(row => (
      parsePromptWizardUseDirections(row.directions)
    ));
    const clarificationHistory = await pool.query<{ count: number | string }>(
      `SELECT count(*) AS count
       FROM prompt_wizard_use_direction_sets
       WHERE run_id = $1 AND id <> $2 AND status = 'needs-input'`,
      [directionSet.run_id, directionSet.id],
    );
    const generated = await getPromptWizardProvider()!.generateUseDirections({
      profile,
      evidenceGraph,
      historicalDirections,
      deadlineAtMs: Date.now() + PROMPT_WIZARD_USE_DIRECTION_BUDGET_MS,
      costOwner: {
        runId: run.id,
        batchId: null,
        useDirectionSetId: directionSet.id,
        userId: run.user_id,
        jobAttempt: toInt(directionSet.attempt_count),
        repairRound: 0,
      },
    });
    usage = generated.usage;
    const needsInput = generated.directions.length === 0
      && generated.clarificationQuestion === PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION;
    if (needsInput && toInt(clarificationHistory.rows[0]?.count ?? 0) > 0) {
      throw Object.assign(new Error('产品证据补充后仍不足以形成两个使用方向'), {
        code: 'PROMPT_WIZARD_USE_DIRECTION_EVIDENCE_INSUFFICIENT',
      });
    }
    const directions = needsInput
      ? []
      : orderPromptWizardUseDirectionsForDefaultSelection(
          assertPromptWizardUseDirections({
            directions: generated.directions,
            evidenceGraph,
            historicalDirections,
          }),
        );
    await pool.query(
      `UPDATE prompt_wizard_use_direction_sets
       SET status = $2, directions = $3::jsonb, clarification_question = $4,
           clarification_count = $5,
           failure_reason = NULL, provider_model = $6, provider_interaction_id = $7,
           provider_input_tokens = $8, provider_output_tokens = $9,
           completed_at = now(), expires_at = now() + interval '24 hours', updated_at = now()
       WHERE id = $1 AND status = 'processing'`,
      [
        directionSet.id,
        needsInput ? 'needs-input' : 'completed',
        JSON.stringify(directions),
        needsInput ? PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION : null,
        needsInput ? 1 : 0,
        usage.model,
        usage.interactionId,
        usage.inputTokens,
        usage.outputTokens,
      ],
    );
    await pool.query(
      `UPDATE prompt_wizard_runs
       SET expires_at = now() + interval '24 hours', updated_at = now()
       WHERE id = $1`,
      [directionSet.run_id],
    );
  } catch (error) {
    await failPromptWizardUseDirectionSet(
      directionSet,
      error,
      mergePromptWizardProviderFailureUsage(usage, error),
    );
  }
}

export async function processPromptWizardConceptSet(conceptSetId: string) {
  const claimed = await pool.query<PromptWizardConceptSetRow>(
    `UPDATE prompt_wizard_concept_sets
     SET status = 'processing', started_at = now(),
         attempt_count = attempt_count + 1, updated_at = now()
     WHERE id = $1 AND status = 'queued'
     RETURNING *`,
    [conceptSetId],
  );
  const conceptSet = claimed.rows[0];
  if (!conceptSet) return;

  // 新写入口已经退役，但滚动发布前入队的 V4 任务必须继续由旧 worker
  // 完成，不能把一条合法的在途任务改写成迁移失败。
  let usage: PromptWizardProviderUsage | null = null;
  try {
    const runResult = await pool.query<PromptWizardRunRow>(
      `SELECT * FROM prompt_wizard_runs
       WHERE id = $1 AND user_id = $2`,
      [conceptSet.run_id, conceptSet.user_id],
    );
    const run = runResult.rows[0];
    if (!run) {
      throw Object.assign(new Error('创意路线引用的向导任务不存在'), {
        code: 'PROMPT_WIZARD_RUN_NOT_FOUND',
      });
    }
    assertPromptWizardV3Run(run);
    if (
      run.status !== 'ready'
      || toInt(run.revision) !== toInt(conceptSet.run_revision)
    ) {
      throw Object.assign(new Error('创作设定已变化'), {
        code: 'PROMPT_WIZARD_CONCEPT_SET_STALE',
      });
    }
    assertPromptWizardRunContentReady(run);
    const profile = requireProductProfile(run.product_profile);
    const evidenceGraph = requireEvidenceGraph(run.evidence_graph);
    const productionBrief = requireProductionBrief(run.production_brief);
    const brief = requirePromptWizardLegacyCreativeBrief(
      requireCreativeBrief(run.creative_brief),
    );
    const config = requireVideoConfig(run.video_config);
    const historyResult = await pool.query<{ candidates: unknown }>(
      `SELECT candidates
       FROM prompt_wizard_concept_sets
       WHERE run_id = $1 AND id <> $2
         AND status = 'completed' AND content_purged_at IS NULL
       ORDER BY created_at ASC`,
      [run.id, conceptSet.id],
    );
    const historicalConcepts = historyResult.rows.flatMap(row => (
      parsePromptWizardConcepts(row.candidates)
    ));
    const deadlineAtMs = Date.now() + env.PROMPT_WIZARD_REQUEST_BUDGET_MS;
    const provider = getPromptWizardProvider()!;
    const providerInput = {
      profile,
      evidenceGraph,
      productionBrief,
      brief,
      config,
      imageCount: run.image_asset_ids.length,
      historicalConcepts,
      deadlineAtMs,
      costOwner: {
        runId: run.id,
        batchId: null,
        userId: run.user_id,
        jobAttempt: toInt(conceptSet.attempt_count),
        repairRound: 0,
      },
    } satisfies Parameters<PromptWizardProvider['generateConcepts']>[0];

    const generated = await provider.generateConcepts(providerInput);
    usage = generated.usage;
    let concepts: PromptWizardConceptPreview[];
    try {
      concepts = assertPromptWizardConceptSet({
        concepts: generated.concepts,
        evidenceGraph,
        brief,
        config,
        productionBrief,
        historicalConcepts,
      });
    } catch (initialError) {
      const feedback = promptWizardLegacyConceptRepairFeedback(initialError);
      if (feedback.length === 0) throw initialError;
      const repaired = await provider.generateConcepts({
        ...providerInput,
        repairFeedback: feedback,
        costOwner: { ...providerInput.costOwner, repairRound: 1 },
      });
      usage = mergePromptWizardProviderUsage(usage, repaired.usage);
      concepts = assertPromptWizardConceptSet({
        concepts: repaired.concepts,
        evidenceGraph,
        brief,
        config,
        productionBrief,
        historicalConcepts,
      });
    }
    const selected = selectPromptWizardConceptPair(concepts);
    await pool.query(
      `UPDATE prompt_wizard_concept_sets
       SET status = 'completed', candidates = $2::jsonb,
           recommended_concept_ids = $3::uuid[], failure_reason = NULL,
           provider_model = $4, provider_interaction_id = $5,
           provider_input_tokens = $6, provider_output_tokens = $7,
           completed_at = now(), expires_at = now() + interval '24 hours', updated_at = now()
       WHERE id = $1 AND status = 'processing'`,
      [
        conceptSet.id,
        JSON.stringify(concepts),
        [selected.primaryConceptId, selected.secondaryConceptId],
        usage.model,
        usage.interactionId,
        usage.inputTokens,
        usage.outputTokens,
      ],
    );
    await pool.query(
      `UPDATE prompt_wizard_runs
       SET expires_at = now() + interval '24 hours', updated_at = now()
       WHERE id = $1`,
      [run.id],
    );
  } catch (error) {
    await failPromptWizardConceptSet(
      conceptSet,
      error,
      mergePromptWizardProviderFailureUsage(usage, error),
    );
  }
}

function promptWizardLegacyConceptRepairFeedback(error: unknown) {
  if (!error || typeof error !== 'object') return [];
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap(issue => {
    if (!issue || typeof issue !== 'object') return [];
    const value = issue as { fieldPath?: unknown; message?: unknown };
    if (typeof value.fieldPath !== 'string' || typeof value.message !== 'string') return [];
    return [`${value.fieldPath}：${value.message}`];
  }).slice(0, 24);
}

export async function createPromptWizardBatch(input: {
  userId: string;
  runId: string;
  revision: number;
  idempotencyKey: string;
  expectedGenerationCredits: number;
  voiceoverLanguage?: string;
  verifiedOffer?: string;
  videoConfig: PromptWizardVideoConfig;
}) {
  const videoConfig = promptWizardVideoConfigSchema.parse(input.videoConfig);
  const soundDesignOnly = videoConfig.durationSeconds === 5;
  const voiceoverLanguage = input.voiceoverLanguage?.trim();
  if (soundDesignOnly && input.voiceoverLanguage !== undefined) {
    throw serviceError(
      '5 秒纯视觉方案不得提交口播语言',
      400,
      'PROMPT_WIZARD_VOICEOVER_LANGUAGE_FORBIDDEN',
    );
  }
  if (!soundDesignOnly && !voiceoverLanguage) {
    throw serviceError(
      '10/15 秒方案必须选择口播语言',
      400,
      'PROMPT_WIZARD_VOICEOVER_LANGUAGE_REQUIRED',
    );
  }
  const verifiedOffer = input.verifiedOffer?.trim() ?? '';
  const requestHash = createHash('sha256').update(canonicalJson({
    runId: input.runId,
    revision: input.revision,
    expectedGenerationCredits: input.expectedGenerationCredits,
    audioMode: soundDesignOnly ? 'sound-design-only' : 'voiceover',
    voiceoverLanguage: soundDesignOnly ? null : voiceoverLanguage,
    verifiedOffer,
    videoConfig,
  })).digest('hex');

  return withTransaction(async client => {
    // 先按“用户 + 幂等键”串行化，再查询幂等记录。仅依赖唯一索引时，两个并发请求
    // 可能同时读到空结果，后到者最终以唯一约束异常失败，而不是稳定复用首个批次。
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`prompt-wizard-idem:${input.userId}:${input.idempotencyKey}`],
    );
    const replay = await client.query<PromptWizardBatchRow>(
      `SELECT batch.*, run.status AS run_status, run.expires_at AS run_expires_at,
              run.engine_version AS run_engine_version
       FROM prompt_wizard_batches batch
       JOIN prompt_wizard_runs run ON run.id = batch.run_id
       WHERE batch.user_id = $1 AND batch.idempotency_key = $2
       FOR UPDATE OF batch`,
      [input.userId, input.idempotencyKey],
    );
    if (replay.rows[0]) {
      assertPromptWizardReadableJoinedRun(replay.rows[0]);
      if (replay.rows[0].request_hash !== requestHash) {
        throw serviceError('幂等键已用于其他提示词批次', 409, 'PROMPT_WIZARD_IDEMPOTENCY_CONFLICT');
      }
      if (
        replay.rows[0].content_purged_at
        || replay.rows[0].run_status === 'archived'
        || (
          promptWizardTimestampExpired(replay.rows[0].run_expires_at)
          && !promptWizardChildIsActive(replay.rows[0].status)
        )
      ) {
        throw serviceError('该提示词方案批次已过期', 410, 'PROMPT_WIZARD_BATCH_EXPIRED');
      }
      return mapPromptWizardBatch(replay.rows[0]);
    }

    const runResult = await client.query<PromptWizardRunRow>(
      `SELECT * FROM prompt_wizard_runs
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [input.runId, input.userId],
    );
    const run = runResult.rows[0];
    if (!run) throw serviceError('提示词向导任务不存在', 404, 'PROMPT_WIZARD_RUN_NOT_FOUND');
    assertPromptWizardV6Run(run);
    assertPromptWizardRunContentReady(run);
    if (promptWizardTimestampExpired(run.expires_at)) {
      throw serviceError('该提示词向导任务已过期', 410, 'PROMPT_WIZARD_RUN_EXPIRED');
    }
    if (run.status !== 'ready') {
      throw serviceError('提示词向导任务尚未就绪', 409, 'PROMPT_WIZARD_RUN_NOT_READY');
    }
    if (toInt(run.revision) !== input.revision) {
      throw serviceError('向导内容已变化，请刷新后重试', 409, 'PROMPT_WIZARD_REVISION_CONFLICT');
    }
    const profile = requireProductProfile(run.product_profile);
    const batchProfile = promptWizardProductProfileSchema.parse({
      ...profile,
      userConfirmedClaims: [profile.userConfirmedClaims.trim(), verifiedOffer]
        .filter(Boolean)
        .join('\n'),
    });
    assertPromptWizardBatchProductInputClaims(batchProfile);
    await assertVideoConfigAvailable(client, videoConfig);

    const active = await client.query(
      `SELECT 1 FROM prompt_wizard_batches
       WHERE run_id = $1 AND status IN ('queued', 'processing') LIMIT 1`,
      [input.runId],
    );
    if (active.rowCount) {
      throw serviceError('已有一批方案正在生成', 409, 'PROMPT_WIZARD_BATCH_ACTIVE');
    }
    const history = await client.query<{ next_ordinal: number | string }>(
      `SELECT COALESCE(max(ordinal), 0) + 1 AS next_ordinal
       FROM prompt_wizard_batches
       WHERE run_id = $1`,
      [input.runId],
    );
    const ordinal = toInt(history.rows[0]?.next_ordinal || 1);
    const settingsResult = await client.query<PromptWizardSettingsRow>(
      `SELECT refresh_credits, available, engine_version, updated_at
       FROM prompt_wizard_settings WHERE singleton_id = 1 FOR UPDATE`,
    );
    const settingsRow = settingsResult.rows[0];
    if (!settingsRow || !settingsRow.available) {
      throw serviceError('提示词向导当前未开放', 409, 'PROMPT_WIZARD_UNAVAILABLE');
    }
    const configuredCredits = toInt(settingsRow.refresh_credits);
    if (input.expectedGenerationCredits !== configuredCredits) {
      throw serviceError('方案生成价格已变化，请确认最新价格后重试', 409, 'PROMPT_WIZARD_PRICE_CHANGED');
    }
    const routeSetResult = await client.query<PromptWizardRouteSetV6Row>(
      `SELECT * FROM prompt_wizard_route_sets
       WHERE run_id = $1 AND user_id = $2 AND run_revision = $3
         AND status = 'completed' AND content_purged_at IS NULL
       ORDER BY completed_at DESC LIMIT 1
       FOR UPDATE`,
      [input.runId, input.userId, input.revision],
    );
    const routeSet = routeSetResult.rows[0];
    if (!routeSet) {
      throw serviceError(
        '三个内部创意方向仍在准备，请稍后重试。',
        409,
        'PROMPT_WIZARD_ROUTE_SET_NOT_READY',
      );
    }
    parsePromptWizardRouteSetV6(routeSet);
    const brief: PromptWizardRunCreativeBrief = soundDesignOnly
      ? {
          audioMode: 'sound-design-only',
          verifiedOffer,
        }
      : {
          audioMode: 'voiceover',
          voiceoverLanguage: voiceoverLanguage!,
          verifiedOffer,
        };

    const completedResult = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM prompt_wizard_batches
         WHERE run_id = $1 AND status = 'completed'
       ) AS exists`,
      [input.runId],
    );
    const isFree = completedResult.rows[0]?.exists !== true;
    const credits = isFree ? 0 : configuredCredits;

    let mainCreditsUsed = 0;
    let addonCreditsUsed = 0;
    if (credits > 0) await reconcileSubscriptionWithClient(client, input.userId);
    const userResult = await client.query<{
      status: string;
      main_credits: number | string;
      addon_credits: number | string;
    }>(
      `SELECT status, main_credits, addon_credits
       FROM users WHERE id = $1 FOR UPDATE`,
      [input.userId],
    );
    const user = userResult.rows[0];
    if (!user) throw serviceError('未找到用户', 404, 'USER_NOT_FOUND');
    if (user.status === 'frozen') {
      throw serviceError('账号已冻结，无法生成提示词方案', 403, 'ACCOUNT_FROZEN');
    }
    if (credits > 0) {
      if (toInt(user.main_credits) + toInt(user.addon_credits) < credits) {
        throw serviceError('积分不足，无法生成方案', 400, 'INSUFFICIENT_CREDITS');
      }
      const allocation = (await planGenerationLotAllocationsWithClient(
        client,
        input.userId,
        [credits],
      ))[0]!;
      mainCreditsUsed = allocation.mainAmount;
      addonCreditsUsed = allocation.addonAmount;
    }

    const inserted = await client.query<PromptWizardBatchRow>(
      `INSERT INTO prompt_wizard_batches (
         run_id, user_id, ordinal, idempotency_key, request_hash, run_revision,
         status, is_free, credits, credit_status, main_credits_used, addon_credits_used,
         image_asset_ids, product_profile, creative_brief, video_config,
         concept_set_id, selected_concept_ids,
         use_direction_set_id, selected_use_direction_id, selected_scene_id, custom_scene,
         route_set_id
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         'queued', $7, $8, $9, $10, $11,
         $12::uuid[], $13::jsonb, $14::jsonb, $15::jsonb,
         NULL, '{}'::uuid[],
         NULL, NULL, NULL, NULL,
         $16::uuid
       )
       RETURNING *`,
      [
        input.runId,
        input.userId,
        ordinal,
        input.idempotencyKey,
        requestHash,
        input.revision,
        isFree,
        credits,
        credits > 0 ? 'held' : 'none',
        mainCreditsUsed,
        addonCreditsUsed,
        run.image_asset_ids,
        JSON.stringify(batchProfile),
        JSON.stringify(brief),
        JSON.stringify(videoConfig),
        routeSet.id,
      ],
    );
    const batch = inserted.rows[0]!;
    if (credits > 0) {
      await holdPromptWizardCreditsWithClient({
        client,
        userId: input.userId,
        batchId: batch.id,
        mainAmount: mainCreditsUsed,
        addonAmount: addonCreditsUsed,
      });
    }
    await client.query(
      `UPDATE prompt_wizard_runs
       SET creative_brief = $2::jsonb, video_config = $3::jsonb,
           expires_at = now() + interval '24 hours', updated_at = now()
       WHERE id = $1`,
      [input.runId, JSON.stringify(brief), JSON.stringify(videoConfig)],
    );
    return mapPromptWizardBatch(batch);
  });
}

export async function getPromptWizardBatch(userId: string, batchId: string) {
  const result = await pool.query<PromptWizardBatchRow>(
    `SELECT batch.*, run.status AS run_status, run.expires_at AS run_expires_at,
            run.engine_version AS run_engine_version
     FROM prompt_wizard_batches batch
     JOIN prompt_wizard_runs run ON run.id = batch.run_id
     WHERE batch.id = $1 AND batch.user_id = $2`,
    [batchId, userId],
  );
  const row = result.rows[0];
  if (!row) throw serviceError('提示词方案批次不存在', 404, 'PROMPT_WIZARD_BATCH_NOT_FOUND');
  assertPromptWizardReadableJoinedRun(row);
  if (
    row.content_purged_at
    || row.run_status === 'archived'
    || (
      promptWizardTimestampExpired(row.run_expires_at)
      && !promptWizardChildIsActive(row.status)
    )
  ) {
    throw serviceError('该提示词方案批次已过期', 410, 'PROMPT_WIZARD_BATCH_EXPIRED');
  }
  return mapPromptWizardBatch(row);
}

export async function getPromptWizardPlanRevision(userId: string, revisionId: string) {
  const result = await pool.query<PromptWizardPlanRevisionRow>(
    `SELECT revision.*, run.engine_version AS run_engine_version
     FROM prompt_wizard_plan_revisions revision
     JOIN prompt_wizard_runs run ON run.id = revision.run_id
     WHERE revision.id = $1 AND revision.user_id = $2`,
    [revisionId, userId],
  );
  const row = result.rows[0];
  if (!row) throw serviceError('单方案微调任务不存在', 404, 'PROMPT_WIZARD_PLAN_REVISION_NOT_FOUND');
  assertPromptWizardV3JoinedRun(row);
  if (
    row.content_purged_at
    || (promptWizardTimestampExpired(row.expires_at) && !promptWizardChildIsActive(row.status))
  ) {
    throw serviceError('该单方案微调已过期', 410, 'PROMPT_WIZARD_PLAN_REVISION_EXPIRED');
  }
  return mapPromptWizardPlanRevision(row);
}

export async function processPromptWizardPlanRefinement(revisionId: string) {
  const claimed = await pool.query<PromptWizardPlanRevisionRow>(
    `UPDATE prompt_wizard_plan_revisions
     SET status = 'processing', started_at = now(),
         attempt_count = attempt_count + 1, updated_at = now()
     WHERE id = $1 AND status = 'queued'
     RETURNING *`,
    [revisionId],
  );
  const revision = claimed.rows[0];
  if (!revision) return;

  let usage: PromptWizardProviderUsage | null = null;
  try {
    const [batchResult, runResult] = await Promise.all([
      pool.query<PromptWizardBatchRow>(
        `SELECT * FROM prompt_wizard_batches
         WHERE id = $1 AND user_id = $2`,
        [revision.batch_id, revision.user_id],
      ),
      pool.query<PromptWizardRunRow>(
        `SELECT * FROM prompt_wizard_runs
         WHERE id = $1 AND user_id = $2`,
        [revision.run_id, revision.user_id],
      ),
    ]);
    const batch = batchResult.rows[0];
    const run = runResult.rows[0];
    if (run) assertPromptWizardV3Run(run);
    if (!batch || batch.status !== 'completed' || batch.content_purged_at || !run) {
      throw Object.assign(new Error('原始方案已失效'), {
        code: 'PROMPT_WIZARD_REFINEMENT_SOURCE_STALE',
      });
    }
    if (toInt(run.revision) !== toInt(batch.run_revision)) {
      throw Object.assign(new Error('原始方案基于旧版产品证据，不能继续微调'), {
        code: 'PROMPT_WIZARD_REFINEMENT_SOURCE_STALE',
      });
    }
    const evidenceGraph = requireEvidenceGraph(run.evidence_graph);
    const plans = parsePlans(batch.plans);
    if (plans.length === PROMPT_WIZARD_PLAN_COUNT && plans.every(isPromptWizardPlanV4)) {
      const v4Plans = plans;
      const rawPlanIndex = toInt(revision.plan_index);
      if (rawPlanIndex !== 0 && rawPlanIndex !== 1) {
        throw Object.assign(new Error('历史 V4 方案索引必须是 0 或 1'), {
          code: 'PROMPT_WIZARD_REFINEMENT_SOURCE_STALE',
        });
      }
      const planIndex = rawPlanIndex as 0 | 1;
      const sourcePlan = v4Plans[planIndex];
      if (
        !sourcePlan
        || sourcePlan.id !== revision.source_plan_id
        || !revision.concept_id
        || sourcePlan.concept.id !== revision.concept_id
      ) {
        throw Object.assign(new Error('原始 V4 方案索引或创意路线已变化'), {
          code: 'PROMPT_WIZARD_REFINEMENT_SOURCE_STALE',
        });
      }
      const conceptSetResult = await pool.query<PromptWizardConceptSetRow>(
        `SELECT * FROM prompt_wizard_concept_sets
         WHERE id = $1 AND run_id = $2 AND status = 'completed'
           AND content_purged_at IS NULL`,
        [batch.concept_set_id, batch.run_id],
      );
      const conceptSet = conceptSetResult.rows[0];
      const candidates = conceptSet
        ? parsePromptWizardConcepts(conceptSet.candidates)
        : [];
      const conceptPreviews = batch.selected_concept_ids.map(conceptId => (
        candidates.find(candidate => candidate.id === conceptId)
      ));
      if (
        !conceptSet
        || conceptPreviews.length !== PROMPT_WIZARD_PLAN_COUNT
        || conceptPreviews.some(concept => !concept)
      ) {
        throw Object.assign(new Error('原始 V4 创意路线已失效'), {
          code: 'PROMPT_WIZARD_CONCEPT_SET_STALE',
        });
      }
      const selectedConcepts = conceptPreviews as PromptWizardConceptPreview[];
      if (selectedConcepts[planIndex]?.id !== revision.concept_id) {
        throw Object.assign(new Error('原始 V4 创意路线顺序已变化'), {
          code: 'PROMPT_WIZARD_REFINEMENT_SOURCE_STALE',
        });
      }
      const profile = requireProductProfile(batch.product_profile);
      const legacyBrief = requirePromptWizardLegacyCreativeBrief(
        requireCreativeBrief(batch.creative_brief),
      );
      const config = requireVideoConfig(batch.video_config);
      const strategies = v4Plans.map(plan => plan.strategy);
      const conceptAssignments = selectedConcepts.map((concept, index) => (
        conceptPreviewToAssignment(
          concept,
          PROMPT_WIZARD_LEGACY_PLAN_INDEXES[index]!,
        )
      ));
      const previousDrafts = v4Plans.map(plan => promptWizardPlanToDraft(plan, {
        profile,
        evidenceGraph,
      }));
      const productionBrief = requireProductionBrief(run.production_brief);
      if (
        revision.action === 'change-scene'
        && (
          !revision.replacement_scene
          || !productionBrief.availableScenes.includes(revision.replacement_scene)
        )
      ) {
        throw Object.assign(new Error('替换场景不属于原任务可用场景'), {
          code: 'PROMPT_WIZARD_REFINEMENT_SCENE_INVALID',
        });
      }
      const refinementIssue = promptWizardRefinementIssue({
        planIndex,
        action: revision.action as PromptWizardRefinementAction,
        replacementScene: revision.replacement_scene,
        shotCount: previousDrafts[planIndex]!.segments.length,
      });
      const repaired = await getPromptWizardProvider()!.repairDrafts({
        profile,
        evidenceGraph,
        brief: legacyBrief,
        config,
        strategies,
        conceptAssignments,
        imageCount: batch.image_asset_ids.length,
        variationKey: toInt(batch.ordinal),
        previousDrafts,
        issues: [refinementIssue],
        operation: 'refine-plan',
        deadlineAtMs: Date.now() + env.PROMPT_WIZARD_REQUEST_BUDGET_MS,
        costOwner: {
          runId: batch.run_id,
          batchId: batch.id,
          userId: batch.user_id,
          jobAttempt: toInt(revision.attempt_count),
          repairRound: 0,
        },
      });
      usage = repaired.usage;
      const revised = repaired.drafts.find(item => item.planIndex === planIndex);
      if (!revised || repaired.drafts.length !== 1) {
        throw Object.assign(new Error('模型没有返回指定的 V4 单方案微调结果'), {
          code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
        });
      }
      assertPromptWizardRefinementOutcome({
        draft: revised.draft,
        action: revision.action as PromptWizardRefinementAction,
        replacementScene: revision.replacement_scene,
      });
      const revisedPlan = renderPromptWizardPlan({
        id: randomUUID(),
        draft: revised.draft,
        strategy: strategies[planIndex]!,
        conceptAssignment: conceptAssignments[planIndex]!,
        conceptPreview: selectedConcepts[planIndex]!,
        evidenceGraph,
        profile,
        brief: legacyBrief,
        config,
        imageCount: batch.image_asset_ids.length,
      });
      if (revisedPlan.deliveryVersion !== 4) {
        throw Object.assign(new Error('V4 微调意外生成了其他交付版本'), {
          code: 'PROMPT_WIZARD_REFINEMENT_INVALID',
        });
      }
      const candidatePlans = [...v4Plans];
      candidatePlans[planIndex] = revisedPlan;
      if (validatePromptWizardPlanDiversity(candidatePlans).length > 0) {
        throw Object.assign(new Error('微调后两个 V4 方案的表现方式差异不足'), {
          code: 'PROMPT_WIZARD_REFINEMENT_INVALID',
        });
      }
      await completePromptWizardPlanRevision(revision, revisedPlan, usage);
      return;
    }
    if (plans.length !== PROMPT_WIZARD_PLAN_COUNT || !plans.every(isPromptWizardPlanV5)) {
      throw Object.assign(new Error('旧版提示词方案仅支持查看和应用'), {
        code: 'PROMPT_WIZARD_REFINEMENT_LEGACY_READ_ONLY',
      });
    }
    if (plans.length === PROMPT_WIZARD_PLAN_COUNT && plans.every(isPromptWizardPlanV5)) {
      const v5Plans = plans;
      const rawPlanIndex = toInt(revision.plan_index);
      if (rawPlanIndex !== 0 && rawPlanIndex !== 1) {
        throw Object.assign(new Error('历史 V5 方案索引必须是 0 或 1'), {
          code: 'PROMPT_WIZARD_REFINEMENT_SOURCE_STALE',
        });
      }
      const planIndex = rawPlanIndex as 0 | 1;
      const sourcePlan = v5Plans[planIndex];
      if (!sourcePlan || sourcePlan.id !== revision.source_plan_id) {
        throw Object.assign(new Error('原始 V5 方案索引已变化'), {
          code: 'PROMPT_WIZARD_REFINEMENT_SOURCE_STALE',
        });
      }
      const directionSetResult = await pool.query<PromptWizardUseDirectionSetRow>(
        `SELECT * FROM prompt_wizard_use_direction_sets
         WHERE id = $1 AND run_id = $2 AND status = 'completed'
           AND content_purged_at IS NULL`,
        [batch.use_direction_set_id, batch.run_id],
      );
      const directionSet = directionSetResult.rows[0];
      const selectedDirection = parsePromptWizardUseDirections(
        directionSet?.directions,
      ).find(direction => direction.id === sourcePlan.useDirection.id);
      if (!directionSet || !selectedDirection) {
        throw Object.assign(new Error('原始产品使用方向已失效'), {
          code: 'PROMPT_WIZARD_USE_DIRECTION_SET_STALE',
        });
      }
      const replacementScene = revision.action === 'change-scene'
        ? selectedDirection.sceneOptions.find(scene => scene.title === revision.replacement_scene)
        : null;
      if (revision.action === 'change-scene' && !replacementScene) {
        throw Object.assign(new Error('替换场景已不属于当前使用方向'), {
          code: 'PROMPT_WIZARD_REFINEMENT_SCENE_INVALID',
        });
      }
      const planContexts: PromptWizardUseDirectionPlanContext[] = v5Plans.map((plan, index) => ({
        planIndex: index as 0 | 1,
        variant: plan.variant,
        useDirection: plan.useDirection,
        // Provider 的 V5 上下文始终要求两项共享同一方向和场景。单方案“更换场景”
        // 只会真正重生 planIndex；另一项上下文仅用于守住双方案契约，不会改写
        // 已交付的另一套方案。因此这里统一使用新场景，保存时仍只写入目标方案。
        selectedScene: replacementScene ?? plan.selectedScene,
      }));
      const previousDrafts = v5Plans.map((plan) => promptWizardPlanToDraft(plan, {
        profile: requireProductProfile(batch.product_profile),
        evidenceGraph,
      }));
      const refinementIssue = promptWizardRefinementIssue({
        planIndex,
        action: revision.action as PromptWizardRefinementAction,
        replacementScene: revision.replacement_scene,
        shotCount: previousDrafts[planIndex]!.segments.length,
      });
      const legacyBrief = requirePromptWizardLegacyCreativeBrief(
        requireCreativeBrief(batch.creative_brief),
      );
      const repaired = await getPromptWizardProvider()!.repairUseDirectionDrafts({
        profile: requireProductProfile(batch.product_profile),
        evidenceGraph,
        targetLanguage: legacyBrief.targetLanguage,
        confirmedOffer: legacyBrief.confirmedOffer,
        config: requireVideoConfig(batch.video_config),
        planContexts,
        imageCount: batch.image_asset_ids.length,
        variationKey: toInt(batch.ordinal),
        previousDrafts,
        issues: [refinementIssue],
        operation: 'refine-plan',
        deadlineAtMs: Date.now() + env.PROMPT_WIZARD_REQUEST_BUDGET_MS,
        costOwner: {
          runId: batch.run_id,
          batchId: batch.id,
          userId: batch.user_id,
          jobAttempt: toInt(revision.attempt_count),
          repairRound: 0,
        },
      });
      usage = repaired.usage;
      const revised = repaired.drafts.find(item => item.planIndex === planIndex);
      if (!revised || repaired.drafts.length !== 1) {
        throw Object.assign(new Error('模型没有返回指定的 V5 单方案微调结果'), {
          code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
        });
      }
      assertPromptWizardRefinementOutcome({
        draft: revised.draft,
        action: revision.action as PromptWizardRefinementAction,
        replacementScene: revision.replacement_scene,
        replacementSceneEnvironment: replacementScene?.environment ?? null,
        replacementSceneMainAction: replacementScene?.mainAction ?? null,
      });
      const revisedPlan = renderPromptWizardUseDirectionPlan({
        id: randomUUID(),
        draft: revised.draft,
        planContext: planContexts[planIndex]!,
        evidenceGraph,
        profile: requireProductProfile(batch.product_profile),
        targetLanguage: legacyBrief.targetLanguage,
        confirmedOffer: legacyBrief.confirmedOffer,
        config: requireVideoConfig(batch.video_config),
        imageCount: batch.image_asset_ids.length,
      });
      const candidatePlans = [...v5Plans];
      candidatePlans[planIndex] = revisedPlan;
      if (validatePromptWizardPlanDiversity(candidatePlans).length > 0) {
        throw Object.assign(new Error('微调后两个方案的表现方式差异不足'), {
          code: 'PROMPT_WIZARD_REFINEMENT_INVALID',
        });
      }
      await completePromptWizardPlanRevision(revision, revisedPlan, usage);
      return;
    }
    throw Object.assign(new Error('旧版提示词方案仅支持查看和应用'), {
      code: 'PROMPT_WIZARD_REFINEMENT_LEGACY_READ_ONLY',
    });
  } catch (error) {
    await failPromptWizardPlanRevision(
      revision,
      error,
      mergePromptWizardProviderFailureUsage(usage, error),
    );
  }
}

async function completePromptWizardPlanRevision(
  revision: PromptWizardPlanRevisionRow,
  revisedPlan: PromptWizardPlan,
  usage: PromptWizardProviderUsage,
) {
  await withTransaction(async client => {
    const updated = await client.query(
      `UPDATE prompt_wizard_plan_revisions
       SET status = 'completed', plan = $2::jsonb, failure_reason = NULL,
           provider_model = $3, provider_interaction_id = $4,
           provider_input_tokens = $5, provider_output_tokens = $6,
           completed_at = now(), expires_at = now() + interval '24 hours', updated_at = now()
       WHERE id = $1 AND status = 'processing'
       RETURNING id`,
      [
        revision.id,
        JSON.stringify(revisedPlan),
        usage.model,
        usage.interactionId,
        usage.inputTokens,
        usage.outputTokens,
      ],
    );
    if (!updated.rowCount) return;
    await client.query(
      `UPDATE prompt_wizard_runs
       SET expires_at = now() + interval '24 hours', updated_at = now()
       WHERE id = $1`,
      [revision.run_id],
    );
    await incrementPromptWizardDailyMetricsWithClient(client, 3, { refinements: 1 });
  });
}

async function emptyPromptWizardResumeSnapshot(userId: string) {
  // 恢复入口只恢复 V6。历史 V4/V5 仍可按 id 只读，但绝不能被旧草稿
  // 自动带回新版向导；只返回清理信号，不返回任何旧正文。
  const latestVersionResult = await pool.query<{
    engine_version: number;
    status: PromptWizardRunRow['status'];
    has_product_profile: boolean;
    has_evidence_graph: boolean;
    has_production_brief: boolean;
  }>(
    `SELECT engine_version,
            status,
            product_profile IS NOT NULL AS has_product_profile,
            evidence_graph IS NOT NULL AS has_evidence_graph,
            production_brief IS NOT NULL AS has_production_brief
     FROM prompt_wizard_runs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  const latest = latestVersionResult.rows[0];
  const incompleteV6Ready = Boolean(
    latest?.engine_version === 4
    && latest.status === 'ready'
    && (!latest.has_product_profile || !latest.has_evidence_graph || !latest.has_production_brief),
  );
  return {
    run: null,
    conceptSet: null,
    useDirectionSet: null,
    batch: null,
    planRevision: null,
    legacyTaskRetired: Boolean(
      (latest && latest.engine_version !== 4)
      || incompleteV6Ready,
    ),
  };
}

export async function resumePromptWizard(userId: string) {
  // engine_version=4 由 Migration 071 与 route_sets 在同一事务中落地。
  // 生产仍停留在 070/engine 3 时必须在任何 071 表查询之前返回。
  if (await readPromptWizardRuntimeEngineVersion() !== 4) {
    return emptyPromptWizardResumeSnapshot(userId);
  }
  const runResult = await pool.query<PromptWizardRunRow>(
    `SELECT * FROM prompt_wizard_runs
     WHERE user_id = $1 AND engine_version = 4 AND status <> 'archived'
       AND (
         (
           status = 'analyzing'
           AND (expires_at > now() OR started_at IS NOT NULL)
         )
         OR (
           status = 'ready'
           AND product_profile IS NOT NULL
           AND evidence_graph IS NOT NULL
           AND production_brief IS NOT NULL
           AND (
             expires_at > now()
             OR EXISTS (
               SELECT 1 FROM prompt_wizard_route_sets route_set
               WHERE route_set.run_id = prompt_wizard_runs.id
                 AND route_set.status IN ('queued', 'processing')
             )
             OR EXISTS (
               SELECT 1 FROM prompt_wizard_batches batch
               WHERE batch.run_id = prompt_wizard_runs.id
                 AND batch.status IN ('queued', 'processing')
             )
           )
         )
       )
     ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  );
  const run = runResult.rows[0];
  if (!run) {
    return emptyPromptWizardResumeSnapshot(userId);
  }
  assertPromptWizardV6Run(run);
  assertPromptWizardRunContentReady(run);
  // 活动批次优先；没有活动批次时恢复最近一次成功结果。失败的“换一批”
  // 不得覆盖上一批成功方案，因此明确排除 failed。
  const batchResult = await pool.query<PromptWizardBatchRow>(
    `SELECT * FROM prompt_wizard_batches
     WHERE run_id = $1 AND user_id = $2 AND content_purged_at IS NULL
       AND status IN ('queued', 'processing', 'completed')
     ORDER BY CASE WHEN status IN ('queued', 'processing') THEN 0 ELSE 1 END,
              created_at DESC
     LIMIT 1`,
    [run.id, userId],
  );
  return {
    run: mapPromptWizardRun(run),
    conceptSet: null,
    useDirectionSet: null,
    batch: batchResult.rows[0] ? mapPromptWizardBatch(batchResult.rows[0]) : null,
    planRevision: null,
    legacyTaskRetired: false,
  };
}

async function createQueuedPromptWizardRouteSetV6WithClient(
  client: DbClient,
  run: PromptWizardRunRow,
) {
  assertPromptWizardV6Run(run);
  const runRevision = toInt(run.revision);
  const idempotencyKey = `route-v6:${run.id}:${runRevision}`;
  const requestHash = createHash('sha256').update(canonicalJson({
    runId: run.id,
    runRevision,
    productProfile: run.product_profile,
    evidenceGraph: run.evidence_graph,
    productionBrief: run.production_brief,
  })).digest('hex');
  const inserted = await client.query<PromptWizardRouteSetV6Row>(
    `INSERT INTO prompt_wizard_route_sets (
       run_id, user_id, idempotency_key, request_hash, run_revision, status
     ) VALUES ($1, $2, $3, $4, $5, 'queued')
     ON CONFLICT (user_id, idempotency_key) DO UPDATE
       SET expires_at = now() + interval '24 hours', updated_at = now()
     RETURNING *`,
    [run.id, run.user_id, idempotencyKey, requestHash, runRevision],
  );
  return inserted.rows[0]!;
}

export async function processPromptWizardRouteSetV6(routeSetId: string) {
  if (await readPromptWizardRuntimeEngineVersion() !== 4) return;
  const claimed = await pool.query<PromptWizardRouteSetV6Row>(
    `UPDATE prompt_wizard_route_sets
     SET status = 'processing', started_at = now(),
         attempt_count = attempt_count + 1, updated_at = now()
     WHERE id = $1 AND status = 'queued'
     RETURNING *`,
    [routeSetId],
  );
  const routeSet = claimed.rows[0];
  if (!routeSet) return;
  try {
    const runResult = await pool.query<PromptWizardRunRow>(
      'SELECT * FROM prompt_wizard_runs WHERE id = $1 AND user_id = $2',
      [routeSet.run_id, routeSet.user_id],
    );
    const run = runResult.rows[0];
    if (
      !run
      || toInt(run.engine_version) !== 4
      || run.status !== 'ready'
      || toInt(run.revision) !== toInt(routeSet.run_revision)
    ) {
      throw Object.assign(new Error('内部三路线所引用的商品识别版本已失效'), {
        code: 'PROMPT_WIZARD_ROUTE_SET_STALE',
      });
    }
    const completed = buildPromptWizardRouteSetV6({
      id: routeSet.id,
      runId: run.id,
      runRevision: toInt(run.revision),
      profile: requireProductProfile(run.product_profile),
      evidenceGraph: requireEvidenceGraph(run.evidence_graph),
      productionBrief: requireProductionBrief(run.production_brief),
      createdAt: toIsoDateTime(routeSet.created_at) ?? new Date().toISOString(),
    });
    await pool.query(
      `UPDATE prompt_wizard_route_sets
       SET status = 'completed', routes = $2::jsonb, failure_reason = NULL,
           completed_at = now(), expires_at = now() + interval '24 hours', updated_at = now()
       WHERE id = $1 AND status = 'processing'`,
      [routeSet.id, JSON.stringify(completed.routes)],
    );
  } catch (error) {
    await pool.query(
      `UPDATE prompt_wizard_route_sets
       SET status = 'failed', routes = NULL, failure_reason = $2,
           completed_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'processing'`,
      [
        routeSet.id,
        error instanceof Error ? error.message.slice(0, 500) : '内部三路线规划失败',
      ],
    );
  }
}

export async function processPromptWizardAnalysis(runId: string) {
  const claimed = await pool.query<PromptWizardRunRow>(
    `UPDATE prompt_wizard_runs
     SET started_at = now(), attempt_count = attempt_count + 1, updated_at = now()
     WHERE id = $1 AND engine_version IN (3, 4)
       AND status = 'analyzing' AND started_at IS NULL
     RETURNING *`,
    [runId],
  );
  const run = claimed.rows[0];
  if (!run) return;

  try {
    const assets = await requireOwnedImageAssets(pool, run.user_id, run.image_asset_ids);
    const orderedAssets = run.image_asset_ids.map(id => assets.get(id)!);
    const objectKeys = orderedAssets.map(asset => promptWizardThumbnailObjectKey(asset));
    const [urls, sizeBytes] = await Promise.all([
      signOwnedObjectReadUrls(objectKeys, { expiresInSeconds: 10 * 60 }),
      Promise.all(objectKeys.map(getStoredObjectSize)),
    ]);
    const result = await getPromptWizardProvider()!.analyzeProduct(
      orderedAssets.map((asset, index) => ({
        name: asset.name,
        url: urls.get(objectKeys[index]!)!,
        mimeType: imageMimeType(objectKeys[index]!),
        sizeBytes: sizeBytes[index]!,
      })),
      {
        runId: run.id,
        batchId: null,
        userId: run.user_id,
        jobAttempt: toInt(run.attempt_count),
        repairRound: 0,
      },
    );
    const normalizedProfile = normalizePromptWizardProductProfile(result.profile);
    const productionBrief = buildPromptWizardProductionBrief(normalizedProfile);
    const baseEvidenceGraph = buildPromptWizardEvidenceGraph({
      profile: normalizedProfile,
      imageAssetIds: run.image_asset_ids,
      detectedEvidenceSources: mapPromptWizardProductEvidenceSources(
        result.evidenceSources ?? [],
        run.image_asset_ids,
      ),
    });
    const briefEvidenceGraph = mergePromptWizardProductionBriefEvidence(
      baseEvidenceGraph,
      productionBrief,
    );
    const evidenceGraph = promptWizardEvidenceGraphSchema.parse({
      ...briefEvidenceGraph,
      directionAssessments: buildAllPromptWizardDirectionAssessments({
        graph: briefEvidenceGraph,
        productionBrief,
      }),
    });
    const profileWithCategoryInference = promptWizardProductProfileSchema.parse({
      ...normalizedProfile,
      categoryInferredFunctions: inferPromptWizardOrdinaryCategoryFunctions(
        normalizedProfile,
        evidenceGraph,
      ),
    });
    const ready = await withTransaction(async client => {
      const updated = await client.query<PromptWizardRunRow>(
      `UPDATE prompt_wizard_runs
       SET status = 'ready', product_profile = $2::jsonb,
           evidence_graph = $3::jsonb, production_brief = $4::jsonb,
           provider_model = $5, provider_interaction_id = $6,
           provider_input_tokens = $7, provider_output_tokens = $8,
           revision = revision + 1, failure_reason = NULL,
           completed_at = now(), expires_at = now() + interval '24 hours', updated_at = now()
       WHERE id = $1 AND status = 'analyzing'
       RETURNING *`,
      [
        run.id,
        JSON.stringify(profileWithCategoryInference),
        JSON.stringify(evidenceGraph),
        JSON.stringify(productionBrief),
        result.usage.model,
        result.usage.interactionId,
        result.usage.inputTokens,
        result.usage.outputTokens,
      ],
      );
      const updatedRun = updated.rows[0];
      if (!updatedRun) return null;
      if (toInt(updatedRun.engine_version) !== 4) return { routeSetId: null };
      const routeSet = await createQueuedPromptWizardRouteSetV6WithClient(client, updatedRun);
      return { routeSetId: routeSet.id };
    });
    if (ready?.routeSetId) {
      void enqueuePromptWizardRouteSetV6(ready.routeSetId).catch(error => {
        console.error(JSON.stringify({
          event: 'prompt-wizard-route-set-enqueue-failed',
          routeSetId: ready.routeSetId,
          reason: error instanceof Error ? error.message : String(error),
        }));
      });
    }
  } catch (error) {
    const failureUsage = mergePromptWizardProviderFailureUsage(null, error);
    logPromptWizardProductRecognitionFailure(run.id, error, failureUsage);
    await pool.query(
      `UPDATE prompt_wizard_runs
       SET status = 'failed', failure_reason = $2,
           provider_model = COALESCE($3, provider_model),
           provider_interaction_id = COALESCE($4, provider_interaction_id),
           provider_input_tokens = COALESCE($5, provider_input_tokens),
           provider_output_tokens = COALESCE($6, provider_output_tokens),
           completed_at = now(), expires_at = now() + interval '24 hours', updated_at = now()
       WHERE id = $1 AND status = 'analyzing'`,
      [
        run.id,
        promptWizardProductRecognitionFailureMessage(error),
        failureUsage?.model ?? null,
        failureUsage?.interactionId ?? null,
        failureUsage?.inputTokens ?? null,
        failureUsage?.outputTokens ?? null,
      ],
    );
  }
}

function mapPromptWizardProductEvidenceSources(
  sources: readonly PromptWizardProductEvidenceSource[],
  imageAssetIds: readonly string[],
) {
  return sources.map(source => ({
    fieldPath: source.fieldPath,
    imageAssetIds: source.sourceImageIndexes
      .map(index => imageAssetIds[index - 1])
      .filter((id): id is string => Boolean(id)),
    visibleRegion: source.visibleRegion,
    confidence: source.confidence,
    proofActions: source.proofActions,
  }));
}

export interface PromptWizardContentRepairIssue {
  planIndex: PromptWizardPlanIndex;
  /** 同批差异冲突的精确只读对照；历史碰撞没有同批对照，必须省略。 */
  referencePlanIndex?: PromptWizardPlanIndex;
  errorCode: string;
  fieldPaths: string[];
  action: string;
}

export interface GenerateValidatedPromptWizardPlansInput {
  provider: PromptWizardProvider;
  profile: PromptWizardProductProfile;
  /** 3.0 的权威证据图谱。 */
  evidenceGraph: PromptWizardEvidenceGraph;
  brief: PromptWizardCreativeBrief;
  config: PromptWizardVideoConfig;
  strategies: PromptWizardStrategy[];
  conceptAssignments: PromptWizardConceptAssignment[];
  /** 3.0 入选路线。 */
  conceptPreviews: PromptWizardConceptPreview[];
  imageCount: number;
  variationKey: number;
  deadlineAtMs: number;
  historicalPlans: PromptWizardPlan[];
  costOwner?: PromptWizardCostOwner;
}

export interface GenerateValidatedPromptWizardPlansResult {
  plans: PromptWizardPlan[];
  drafts: PromptWizardPlanDraft[];
  usage: PromptWizardProviderUsage;
  repairRounds: number;
  /** V5 首轮双方案自然 JSON 格式恢复次数；旧版编排可以省略。 */
  formatRepairCount?: number;
}

/**
 * V6 三个固定商业角色各自发起的逻辑修复请求数，顺序严格对应
 * proof-conversion / problem-hook / lifestyle-seeding。真实传输尝试数继续由
 * Provider completed 日志与成本账本独立记录。
 */
export type PromptWizardV6PlanRequestCounts = [
  proofConversion: number,
  problemHook: number,
  lifestyleSeeding: number,
];

export interface GenerateValidatedPromptWizardRoutePlansV6Result
  extends GenerateValidatedPromptWizardPlansResult {
  /** 普通内容修复请求；包含首轮 Schema/Zod 定向修复，不含格式恢复。 */
  contentRepairRequestCounts: PromptWizardV6PlanRequestCounts;
  /** 两轮普通内容修复耗尽后发起的终局口播校准请求。 */
  terminalCalibrationRequestCounts: PromptWizardV6PlanRequestCounts;
  /** 不含业务正文的修复来源、轮次、错误码与安全字段路径。 */
  repairDiagnostics: PromptWizardRepairDiagnostic[];
  /** 不含 Provider 正文、动态错误消息或字节位置的结构化输出诊断。 */
  outputDiagnostics: PromptWizardOutputDiagnostic[];
}

export interface GenerateValidatedPromptWizardUseDirectionPlansInput {
  provider: PromptWizardProvider;
  profile: PromptWizardProductProfile;
  evidenceGraph: PromptWizardEvidenceGraph;
  targetLanguage: PromptWizardCreativeBrief['targetLanguage'];
  confirmedOffer?: string;
  config: PromptWizardVideoConfig;
  planContexts: PromptWizardUseDirectionPlanContext[];
  imageCount: number;
  variationKey: number;
  deadlineAtMs: number;
  historicalPlans: PromptWizardPlan[];
  costOwner?: PromptWizardCostOwner;
}

/**
 * V5 的权威编排器。两个方案共享购买理由、方向、场景和证据，只允许改变
 * 第一秒事件、视角、节奏/剪辑及 CTA 回扣；任何修复都按索引执行。
 */
export async function generateValidatedPromptWizardUseDirectionPlans(
  input: GenerateValidatedPromptWizardUseDirectionPlansInput,
): Promise<GenerateValidatedPromptWizardPlansResult> {
  if (
    input.planContexts.length !== PROMPT_WIZARD_PLAN_COUNT
    || input.planContexts.some((context, index) => context.planIndex !== index)
    || input.planContexts[0]?.variant !== 'reliable'
    || input.planContexts[1]?.variant !== 'hook'
    || input.planContexts.some(context => (
      context.useDirection.id !== input.planContexts[0]?.useDirection.id
      || context.selectedScene.id !== input.planContexts[0]?.selectedScene.id
      || context.selectedScene.title !== input.planContexts[0]?.selectedScene.title
      || context.selectedScene.environment !== input.planContexts[0]?.selectedScene.environment
      || context.selectedScene.mainAction !== input.planContexts[0]?.selectedScene.mainAction
    ))
  ) {
    throw Object.assign(new Error('V5 扩写必须提供同一方向和场景的易落地/强钩子上下文'), {
      code: 'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID',
    });
  }

  const planIds = PROMPT_WIZARD_LEGACY_PLAN_INDEXES.map(() => randomUUID());
  let usage: PromptWizardProviderUsage | null = null;
  let drafts: PromptWizardPlanDraft[];
  let repairRounds = 0;
  let formatRepairCount = 0;
  try {
    const generated = await input.provider.generateUseDirectionDrafts({
      profile: input.profile,
      evidenceGraph: input.evidenceGraph,
      targetLanguage: input.targetLanguage,
      confirmedOffer: input.confirmedOffer ?? '',
      config: input.config,
      planContexts: input.planContexts,
      imageCount: input.imageCount,
      variationKey: input.variationKey,
      deadlineAtMs: input.deadlineAtMs,
      ...(input.costOwner ? { costOwner: { ...input.costOwner, repairRound: 0 } } : {}),
    });
    usage = generated.usage;
    if (generated.drafts.length !== PROMPT_WIZARD_PLAN_COUNT) {
      throw Object.assign(new Error('Provider 必须返回易落地和强钩子两个方案'), {
        code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      });
    }
    if (
      generated.formatRepairCount !== undefined
      && (
        !Number.isSafeInteger(generated.formatRepairCount)
        || generated.formatRepairCount < 0
        || generated.formatRepairCount > PROMPT_WIZARD_PLAN_COUNT
      )
    ) {
      throw Object.assign(new Error('Provider 返回的首轮格式恢复次数无效'), {
        code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      });
    }
    drafts = [...generated.drafts];
    repairRounds = generated.repairRounds ?? 0;
    formatRepairCount = generated.formatRepairCount ?? 0;
  } catch (error) {
    throw attachPromptWizardOrchestrationUsage(
      error,
      mergePromptWizardProviderFailureUsage(usage, error),
      repairRounds,
    );
  }

  while (true) {
    const validation = validatePromptWizardUseDirectionDraftSet({
      drafts,
      planIds,
      planContexts: input.planContexts,
      evidenceGraph: input.evidenceGraph,
      profile: input.profile,
      targetLanguage: input.targetLanguage,
      confirmedOffer: input.confirmedOffer ?? '',
      config: input.config,
      imageCount: input.imageCount,
      historicalPlans: input.historicalPlans,
      repairRounds,
    });
    drafts = validation.drafts;
    if (validation.plans) {
      return {
        plans: validation.plans,
        drafts,
        usage: usage!,
        repairRounds,
        formatRepairCount,
      };
    }
    if (
      repairRounds >= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
      || input.deadlineAtMs - Date.now() < PROMPT_WIZARD_MIN_CONTENT_REPAIR_BUDGET_MS
    ) {
      throw attachPromptWizardOrchestrationUsage(
        validation.terminalError ?? Object.assign(new Error('V5 方案未通过最终校验'), {
          code: 'PROMPT_WIZARD_DIVERSITY_FAILED',
        }),
        usage,
        repairRounds,
        validation.issues.map(issue => issue.planIndex),
      );
    }
    repairRounds += 1;
    try {
      const repaired = await input.provider.repairUseDirectionDrafts({
        profile: input.profile,
        evidenceGraph: input.evidenceGraph,
        targetLanguage: input.targetLanguage,
        confirmedOffer: input.confirmedOffer ?? '',
        config: input.config,
        planContexts: input.planContexts,
        imageCount: input.imageCount,
        variationKey: input.variationKey,
        previousDrafts: [...drafts],
        issues: validation.issues,
        deadlineAtMs: input.deadlineAtMs,
        ...(input.costOwner ? { costOwner: { ...input.costOwner, repairRound: repairRounds } } : {}),
      });
      usage = mergePromptWizardProviderUsage(usage, repaired.usage);
      const requested = new Set(validation.issues.map(issue => issue.planIndex));
      const returned = new Set<PromptWizardPlanIndex>();
      for (const item of repaired.drafts) {
        const planIndex = toPromptWizardPlanIndex(item.planIndex);
        if (!requested.has(planIndex) || returned.has(planIndex)) {
          throw Object.assign(new Error('Provider 返回了未请求或重复的 V5 方案索引'), {
            code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
          });
        }
        returned.add(planIndex);
        drafts[planIndex] = item.draft;
      }
      if (returned.size !== requested.size) {
        throw Object.assign(new Error('Provider 未返回全部待修复 V5 方案'), {
          code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
        });
      }
    } catch (error) {
      throw attachPromptWizardOrchestrationUsage(
        error,
        mergePromptWizardProviderFailureUsage(usage, error) ?? usage,
        repairRounds,
        validation.issues.map(issue => issue.planIndex),
      );
    }
  }
}

function validatePromptWizardUseDirectionDraftSet(input: {
  drafts: PromptWizardPlanDraft[];
  planIds: string[];
  planContexts: PromptWizardUseDirectionPlanContext[];
  evidenceGraph: PromptWizardEvidenceGraph;
  profile: PromptWizardProductProfile;
  targetLanguage: PromptWizardCreativeBrief['targetLanguage'];
  confirmedOffer: string;
  config: PromptWizardVideoConfig;
  imageCount: number;
  historicalPlans: PromptWizardPlan[];
  repairRounds: number;
}): PromptWizardDraftSetValidation {
  const drafts = [...input.drafts];
  const plans: PromptWizardPlanV5[] = [];
  const issues = new Map<PromptWizardPlanIndex, PromptWizardContentRepairIssue>();
  let terminalError: unknown = null;
  const reservedNames = new Set(drafts.map(draft => draft.name.normalize('NFKC').trim()));

  const render = (planIndex: PromptWizardPlanIndex, draft: PromptWizardPlanDraft) => (
    renderPromptWizardUseDirectionPlan({
      id: input.planIds[planIndex]!,
      draft,
      planContext: input.planContexts[planIndex]!,
      evidenceGraph: input.evidenceGraph,
      profile: input.profile,
      targetLanguage: input.targetLanguage,
      confirmedOffer: input.confirmedOffer,
      config: input.config,
      imageCount: input.imageCount,
    })
  );

  for (const planIndex of PROMPT_WIZARD_LEGACY_PLAN_INDEXES) {
    let draft = drafts[planIndex]!;
    const firstShot = stabilizePromptWizardUseDirectionFirstShot({
      draft,
      context: input.planContexts[planIndex]!,
      evidenceGraph: input.evidenceGraph,
    });
    if (firstShot.reasons.length > 0) {
      draft = firstShot.draft;
      drafts[planIndex] = draft;
      logPromptWizardSafeFirstShotFallback(
        planIndex,
        firstShot.reasons,
        input.repairRounds,
      );
    }
    let voiceoverCoverageError: unknown = null;
    let useDirectionBoundaryError: unknown = null;
    try {
      assertPromptWizardUseDirectionDraftBoundary(
        draft,
        input.planContexts[planIndex]!,
        input.evidenceGraph,
      );
    } catch (error) {
      if (errorCode(error) !== 'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID') throw error;
      useDirectionBoundaryError = error;
    }
    try {
      const timeline = promptWizardTimeline(input.config.durationSeconds);
      assertPromptWizardVoiceoverCoverage({
        shots: timeline.map(([startSeconds, endSeconds], segmentIndex) => ({
          startSeconds,
          endSeconds,
          ...draft.segments[segmentIndex]!,
        })),
        targetLanguage: input.targetLanguage,
        durationSeconds: input.config.durationSeconds,
        profile: input.profile,
      });
    } catch (error) {
      if (errorCode(error) !== 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID') throw error;
      voiceoverCoverageError = error;
    }
    reservedNames.delete(draft.name.normalize('NFKC').trim());
    try {
      plans[planIndex] = render(planIndex, draft);
      reservedNames.add(draft.name.normalize('NFKC').trim());
      continue;
    } catch (initialError) {
      if (isUnrepairableFinalPromptError(initialError)) throw initialError;
      let currentError = initialError;
      let fieldPaths = promptWizardRawFieldPaths(currentError);
      const safeCtaMotionDraft = promptWizardSafeCtaMotionFallback({
        error: currentError,
        draft,
        appearanceMode: input.planContexts[planIndex]!.useDirection.appearanceMode,
      });
      if (safeCtaMotionDraft) {
        draft = safeCtaMotionDraft;
        drafts[planIndex] = draft;
        logPromptWizardSafeCtaMotionFallback(
          planIndex,
          input.planContexts[planIndex]!.useDirection.appearanceMode,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const safeSegmentActionMotion = promptWizardSafeSegmentActionMotionFallback({
        error: currentError,
        draft,
        context: input.planContexts[planIndex]!,
        repairRounds: input.repairRounds,
      });
      if (safeSegmentActionMotion) {
        draft = safeSegmentActionMotion.draft;
        drafts[planIndex] = draft;
        logPromptWizardSafeSegmentActionMotionFallback(
          planIndex,
          safeSegmentActionMotion.segmentIndexes,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const safeLightingMotion = promptWizardSafeLightingMotionFallback({
        error: currentError,
        draft,
        repairRounds: input.repairRounds,
      });
      if (safeLightingMotion) {
        draft = safeLightingMotion.draft;
        drafts[planIndex] = draft;
        logPromptWizardSafeLightingMotionFallback(
          planIndex,
          safeLightingMotion.segmentIndexes,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const safeEditingCueIndexes = promptWizardSafeEditingCueIndexes(
        currentError,
        fieldPaths,
        draft.segments.length,
      );
      if (safeEditingCueIndexes) {
        const affected = new Set(safeEditingCueIndexes);
        draft = {
          ...draft,
          segments: draft.segments.map((segment, index) => affected.has(index)
            ? { ...segment, editingCue: PROMPT_WIZARD_SAFE_EDITING_CUE }
            : segment),
        };
        drafts[planIndex] = draft;
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const safeProductionNoteIndexes = promptWizardSafeProductionNoteIndexes(
        currentError,
        fieldPaths,
        draft.segments.length,
      );
      if (safeProductionNoteIndexes) {
        const affected = new Set(safeProductionNoteIndexes);
        logPromptWizardSafeProductionNoteFallback(
          planIndex,
          safeProductionNoteIndexes,
          input.repairRounds,
        );
        draft = {
          ...draft,
          segments: draft.segments.map((segment, index) => affected.has(index)
            ? { ...segment, productionNote: '' }
            : segment),
        };
        drafts[planIndex] = draft;
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const safeReferenceActionIndexes = promptWizardSafeReferenceActionIndexes(
        currentError,
        fieldPaths,
        draft.segments.length,
        input.repairRounds,
      );
      if (safeReferenceActionIndexes) {
        const affected = new Set(safeReferenceActionIndexes);
        draft = {
          ...draft,
          segments: draft.segments.map((segment, segmentIndex) => affected.has(segmentIndex)
            ? {
                ...segment,
                action: normalizePromptWizardReferenceAction(segment.action),
              }
            : segment),
        };
        drafts[planIndex] = draft;
        logPromptWizardSafeReferenceActionFallback(
          planIndex,
          safeReferenceActionIndexes,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      if (promptWizardSafeUseDirectionNarrativeFallback(
        currentError,
        fieldPaths,
        input.repairRounds,
      )) {
        const planContext = input.planContexts[planIndex]!;
        draft = stabilizePromptWizardUseDirectionNarrative({
          draft,
          context: planContext,
        });
        drafts[planIndex] = draft;
        logPromptWizardSafeUseDirectionNarrativeFallback(planIndex, input.repairRounds);
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const safeUseDirectionActionFallback = promptWizardSafeUseDirectionActionFallback(
        currentError,
        fieldPaths,
        input.repairRounds,
      );
      if (safeUseDirectionActionFallback) {
        const planContext = input.planContexts[planIndex]!;
        draft = stabilizePromptWizardUseDirectionSceneContext({
          draft,
          context: planContext,
        });
        drafts[planIndex] = draft;
        logPromptWizardSafeUseDirectionActionFallback(
          planIndex,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const safeMajorActionDetails = promptWizardSafeMajorActionFallbackDetails(
        currentError,
        input.repairRounds,
      );
      if (safeMajorActionDetails) {
        draft = stabilizePromptWizardUseDirectionMajorActions({
          draft,
          context: input.planContexts[planIndex]!,
          maxActionFamilies: safeMajorActionDetails.limit,
        });
        drafts[planIndex] = draft;
        logPromptWizardSafeMajorActionFallback(
          planIndex,
          safeMajorActionDetails,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const safePropDetails = promptWizardSafePropFallbackDetails(
        currentError,
        input.repairRounds,
      );
      if (safePropDetails) {
        draft = stabilizePromptWizardUseDirectionMajorActions({
          draft,
          context: input.planContexts[planIndex]!,
        });
        const appearanceMode = input.planContexts[planIndex]!.useDirection.appearanceMode;
        const safeSubject = appearanceMode === 'product-only'
          ? `@图片1中的${input.profile.productName}`
          : appearanceMode === 'hands-only'
            ? `@图片1中的${input.profile.productName}与操作手部`
            : `@图片1中的${input.profile.productName}与单一使用者`;
        draft = {
          ...draft,
          segments: draft.segments.map(segment => ({
            ...segment,
            subject: safeSubject,
            productionNote: '保持产品外观、结构、Logo 与参考图片一致，不新增场景道具',
          })),
        };
        drafts[planIndex] = draft;
        logPromptWizardSafePropFallback(
          planIndex,
          safePropDetails,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const safeCameraMoveDetails = promptWizardSafeCameraMoveFallbackDetails(
        currentError,
        input.repairRounds,
      );
      if (safeCameraMoveDetails) {
        draft = {
          ...draft,
          segments: draft.segments.map(segment => ({
            ...segment,
            cameraMovement: PROMPT_WIZARD_SAFE_CAMERA_MOVEMENT,
          })),
        };
        drafts[planIndex] = draft;
        logPromptWizardSafeCameraMoveFallback(
          planIndex,
          safeCameraMoveDetails,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const safeExecutionCombination = promptWizardSafeExecutionCombinationFallback({
        error: currentError,
        draft,
        context: input.planContexts[planIndex]!,
        repairRounds: input.repairRounds,
      });
      if (safeExecutionCombination) {
        draft = safeExecutionCombination.draft;
        drafts[planIndex] = draft;
        logPromptWizardSafeExecutionCombinationFallback(
          planIndex,
          safeExecutionCombination,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const safeConversionCta = promptWizardSafeConversionCtaFallback({
        error: currentError,
        draft,
        targetLanguage: input.targetLanguage,
        config: input.config,
        repairRounds: input.repairRounds,
      });
      if (safeConversionCta) {
        draft = safeConversionCta.draft;
        drafts[planIndex] = draft;
        logPromptWizardSafeConversionCtaFallback(
          planIndex,
          input.targetLanguage,
          safeConversionCta.mode,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const safeVoiceoverCompression = promptWizardSafeVoiceoverCompressionFallback({
        error: currentError,
        draft,
        repairRounds: input.repairRounds,
      });
      if (safeVoiceoverCompression) {
        draft = safeVoiceoverCompression.draft;
        drafts[planIndex] = draft;
        logPromptWizardSafeVoiceoverCompressionFallback(
          planIndex,
          safeVoiceoverCompression,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const safeVoiceoverExpansion = promptWizardSafeVoiceoverExpansionFallback({
        error: currentError,
        draft,
        targetLanguage: input.targetLanguage,
        repairRounds: input.repairRounds,
      });
      if (safeVoiceoverExpansion) {
        draft = safeVoiceoverExpansion.draft;
        drafts[planIndex] = draft;
        logPromptWizardSafeVoiceoverExpansionFallback(
          planIndex,
          safeVoiceoverExpansion,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      // 口播压缩可能从末段尾部裁掉原有购买动作；补足也可能让 CTA 问题
      // 首次显现。所有口播容量收口之后再执行一次同样的短 CTA 兜底，
      // 并继续要求末段与全片预算同时通过。
      const finalSafeConversionCta = promptWizardSafeConversionCtaFallback({
        error: currentError,
        draft,
        targetLanguage: input.targetLanguage,
        config: input.config,
        repairRounds: input.repairRounds,
      });
      if (finalSafeConversionCta) {
        draft = finalSafeConversionCta.draft;
        drafts[planIndex] = draft;
        logPromptWizardSafeConversionCtaFallback(
          planIndex,
          input.targetLanguage,
          finalSafeConversionCta.mode,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const finalSafeEditingCueIndexes = promptWizardSafeEditingCueIndexes(
        currentError,
        fieldPaths,
        draft.segments.length,
      );
      if (finalSafeEditingCueIndexes) {
        const affected = new Set(finalSafeEditingCueIndexes);
        draft = {
          ...draft,
          segments: draft.segments.map((segment, index) => affected.has(index)
            ? { ...segment, editingCue: PROMPT_WIZARD_SAFE_EDITING_CUE }
            : segment),
        };
        drafts[planIndex] = draft;
        logPromptWizardSafeEditingCueFallback(
          planIndex,
          finalSafeEditingCueIndexes,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      // 执行预算与剪辑收口可能让口播覆盖错误到这一阶段才首次暴露。
      // 重新执行一次同一套有界口播收口，不改变最低/最高容量；补足只使用
      // 中性观看引导，压缩只裁剪原文，并在之后继续经过全部权威门禁。
      const finalSafeVoiceoverCompression = promptWizardSafeVoiceoverCompressionFallback({
        error: currentError,
        draft,
        repairRounds: input.repairRounds,
      });
      if (finalSafeVoiceoverCompression) {
        draft = finalSafeVoiceoverCompression.draft;
        drafts[planIndex] = draft;
        logPromptWizardSafeVoiceoverCompressionFallback(
          planIndex,
          finalSafeVoiceoverCompression,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const finalSafeVoiceoverExpansion = promptWizardSafeVoiceoverExpansionFallback({
        error: currentError,
        draft,
        targetLanguage: input.targetLanguage,
        repairRounds: input.repairRounds,
      });
      if (finalSafeVoiceoverExpansion) {
        draft = finalSafeVoiceoverExpansion.draft;
        drafts[planIndex] = draft;
        logPromptWizardSafeVoiceoverExpansionFallback(
          planIndex,
          finalSafeVoiceoverExpansion,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      // 前面的执行预算、动作或运镜收口可能让后续门禁首次暴露出原 Draft
      // 中已经存在的首尾帧语义。这里在所有结构性收口之后再做一次精确、
      // 幂等的参考语义清理，避免安全回退顺序本身成为失败原因。
      const finalSafeProductionNoteIndexes = promptWizardSafeProductionNoteIndexes(
        currentError,
        fieldPaths,
        draft.segments.length,
      );
      if (finalSafeProductionNoteIndexes) {
        const affected = new Set(finalSafeProductionNoteIndexes);
        draft = {
          ...draft,
          segments: draft.segments.map((segment, index) => affected.has(index)
            ? { ...segment, productionNote: '' }
            : segment),
        };
        drafts[planIndex] = draft;
        logPromptWizardSafeProductionNoteFallback(
          planIndex,
          finalSafeProductionNoteIndexes,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const finalSafeReferenceActionIndexes = promptWizardSafeReferenceActionIndexes(
        currentError,
        fieldPaths,
        draft.segments.length,
        input.repairRounds,
      );
      if (finalSafeReferenceActionIndexes) {
        const affected = new Set(finalSafeReferenceActionIndexes);
        draft = {
          ...draft,
          segments: draft.segments.map((segment, index) => affected.has(index)
            ? { ...segment, action: normalizePromptWizardReferenceAction(segment.action) }
            : segment),
        };
        drafts[planIndex] = draft;
        logPromptWizardSafeReferenceActionFallback(
          planIndex,
          finalSafeReferenceActionIndexes,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const finalSafeReferenceMetadata = promptWizardSafeReferenceMetadataFallback({
        error: currentError,
        fieldPaths,
        draft,
        variant: input.planContexts[planIndex]!.variant,
        repairRounds: input.repairRounds,
      });
      if (finalSafeReferenceMetadata) {
        draft = finalSafeReferenceMetadata;
        drafts[planIndex] = draft;
        logPromptWizardSafeReferenceMetadataFallback(
          planIndex,
          fieldPaths,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const finalSafeMotionCombination = promptWizardSafeMotionCombinationFallback({
        error: currentError,
        draft,
        context: input.planContexts[planIndex]!,
        repairRounds: input.repairRounds,
      });
      if (finalSafeMotionCombination) {
        draft = finalSafeMotionCombination;
        drafts[planIndex] = draft;
        logPromptWizardSafeMotionCombinationFallback(planIndex, input.repairRounds);
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      const safeDifferenceTagIndexes = promptWizardSafeDifferenceTagIndexes(
        currentError,
        fieldPaths,
        draft.differenceTags.length,
        input.repairRounds,
      );
      if (safeDifferenceTagIndexes) {
        const affected = new Set(safeDifferenceTagIndexes);
        const controlledTags = promptWizardControlledDifferenceTags(
          input.planContexts[planIndex]!.variant,
        );
        const usedTags = new Set(draft.differenceTags
          .filter((_, index) => !affected.has(index))
          .map(tag => tag.normalize('NFKC').trim()));
        draft = {
          ...draft,
          differenceTags: draft.differenceTags.map((tag, index) => {
            if (!affected.has(index)) return tag;
            const candidates = [
              controlledTags[index],
              ...controlledTags,
            ].filter((candidate): candidate is string => Boolean(candidate));
            const replacement = candidates.find(candidate => (
              !usedTags.has(candidate.normalize('NFKC').trim())
            )) ?? controlledTags.at(-1)!;
            usedTags.add(replacement.normalize('NFKC').trim());
            return replacement;
          }),
        };
        drafts[planIndex] = draft;
        logPromptWizardSafeDifferenceTagFallback(
          planIndex,
          safeDifferenceTagIndexes,
          input.repairRounds,
        );
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      if (
        errorCode(currentError) === 'PROMPT_WIZARD_UNCONFIRMED_CLAIM'
        && fieldPaths.length === 1
        && fieldPaths[0] === 'name'
      ) {
        const base = `${input.planContexts[planIndex]!.useDirection.title} · ${
          input.planContexts[planIndex]!.variant === 'reliable' ? '易落地方案' : '强钩子方案'
        }`;
        let safeName = base;
        if (reservedNames.has(safeName.normalize('NFKC').trim())) {
          safeName = `${base}${planIndex + 1}`;
        }
        draft = { ...draft, name: safeName };
        drafts[planIndex] = draft;
        try {
          plans[planIndex] = render(planIndex, draft);
          reservedNames.add(safeName.normalize('NFKC').trim());
          continue;
        } catch (fallbackError) {
          currentError = fallbackError;
        }
      }
      if (!isPromptWizardRepairableError(currentError)) throw currentError;
      const repairFieldPaths = promptWizardSafeFieldPaths(currentError);
      if (repairFieldPaths.length === 0) throw currentError;
      terminalError = preferPromptWizardTerminalContentError(terminalError, currentError);
      mergePromptWizardContentRepairIssue(issues, {
        planIndex,
        errorCode: errorCode(currentError),
        fieldPaths: repairFieldPaths,
        action: promptWizardRepairFeedback(currentError),
      });
      if (
        voiceoverCoverageError
        && errorCode(currentError) !== 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID'
      ) {
        const voiceoverFieldPaths = promptWizardSafeFieldPaths(voiceoverCoverageError);
        if (voiceoverFieldPaths.length > 0) {
          terminalError = preferPromptWizardTerminalContentError(
            terminalError,
            voiceoverCoverageError,
          );
          mergePromptWizardContentRepairIssue(issues, {
            planIndex,
            errorCode: 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
            fieldPaths: voiceoverFieldPaths,
            action: promptWizardRepairFeedback(voiceoverCoverageError),
          });
        }
      }
      if (
        useDirectionBoundaryError
        && errorCode(currentError) !== 'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID'
      ) {
        const boundaryFieldPaths = promptWizardSafeFieldPaths(useDirectionBoundaryError);
        if (boundaryFieldPaths.length > 0) {
          terminalError = preferPromptWizardTerminalContentError(
            terminalError,
            useDirectionBoundaryError,
          );
          mergePromptWizardContentRepairIssue(issues, {
            planIndex,
            errorCode: 'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID',
            fieldPaths: boundaryFieldPaths,
            action: promptWizardRepairFeedback(useDirectionBoundaryError),
          });
        }
      }
    }
  }

  if (issues.size > 0) {
    return { drafts, plans: null, issues: [...issues.values()], terminalError };
  }
  let batchDiversityIssues = validatePromptWizardPlanDiversity(plans);
  let historyDiversityIssues = validatePromptWizardPlanHistory(
    plans,
    input.historicalPlans,
  );
  const differenceAnalysis = analyzePromptWizardUseDirectionPlanDifferences(
    plans[0]!,
    plans[1]!,
  );
  if (
    input.repairRounds >= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    && differenceAnalysis.count < 3
    && batchDiversityIssues.length === 1
    && batchDiversityIssues[0]?.planIndexes[0] === 0
    && batchDiversityIssues[0]?.planIndexes[1] === 1
    && historyDiversityIssues.length === 0
  ) {
    const safeFallback = findPromptWizardSafeV5DiversityFallback({
      hookDraft: drafts[1]!,
      reliablePlan: plans[0]!,
      hookContext: input.planContexts[1]!,
      config: input.config,
      historicalPlans: input.historicalPlans,
      renderHook: candidate => render(1, candidate),
      before: differenceAnalysis,
    });
    if (safeFallback) {
      drafts[1] = safeFallback.draft;
      plans[1] = safeFallback.plan;
      batchDiversityIssues = validatePromptWizardPlanDiversity(plans);
      historyDiversityIssues = validatePromptWizardPlanHistory(
        plans,
        input.historicalPlans,
      );
      logPromptWizardSafeV5DiversityFallback({
        dimensions: safeFallback.dimensions,
        candidateOrdinals: safeFallback.candidateOrdinals,
        before: differenceAnalysis,
        after: safeFallback.after,
        repairRounds: input.repairRounds,
      });
    }
  }
  const diversityIssues = [...batchDiversityIssues, ...historyDiversityIssues];
  for (const diversityIssue of diversityIssues) {
    const planIndex = toPromptWizardPlanIndex(Math.max(...diversityIssue.planIndexes));
    const isCurrentPairIssue = diversityIssue.planIndexes[0] === 0
      && diversityIssue.planIndexes[1] === 1
      && batchDiversityIssues.includes(diversityIssue);
    const pairAnalysis = isCurrentPairIssue
      ? analyzePromptWizardUseDirectionPlanDifferences(plans[0]!, plans[1]!)
      : null;
    const fieldPaths = pairAnalysis
      ? promptWizardUseDirectionDiversityRepairFieldPaths(
          drafts[planIndex]!,
          promptWizardMissingUseDirectionDifferenceDimensions(pairAnalysis),
        )
      : promptWizardDiversityRepairFieldPaths(drafts[planIndex]!);
    const error = Object.assign(new Error(diversityIssue.reason), {
      code: 'PROMPT_WIZARD_DIVERSITY_FAILED',
      fieldPaths,
    });
    terminalError = preferPromptWizardTerminalContentError(terminalError, error);
    mergePromptWizardContentRepairIssue(issues, {
      planIndex,
      errorCode: 'PROMPT_WIZARD_DIVERSITY_FAILED',
      fieldPaths: promptWizardSafeFieldPaths(error),
      action: pairAnalysis
        ? `${diversityIssue.reason}；当前未形成差异的维度：${promptWizardDifferenceDimensionLabels(pairAnalysis).join('、')}；以 diversityReferenceDraft 为只读对照，保持同一购买理由、场景和证据不变；只改写列出的当前方案字段，确保四项中至少三项形成可观察差异；不能只替换同义词`
        : `${diversityIssue.reason}；保持同一购买理由、场景和证据不变，只改写列出的当前方案表达字段，并避开当前 run 历史方案`,
    });
  }
  return diversityIssues.length === 0
    ? { drafts, plans, issues: [], terminalError: null }
    : { drafts, plans: null, issues: [...issues.values()], terminalError };
}

function assertPromptWizardConceptAssignments(input: GenerateValidatedPromptWizardPlansInput) {
  if (input.conceptAssignments.length !== PROMPT_WIZARD_PLAN_COUNT) {
    throw Object.assign(new Error('提示词向导必须提供两份入选创意上下文'), {
      code: 'PROMPT_WIZARD_CONCEPT_ASSIGNMENT_INVALID',
    });
  }
  const allowedFactIds = new Set(input.evidenceGraph.evidences
    .filter(evidence => (
      input.evidenceGraph.reliableEvidenceIds.includes(evidence.id)
      && (evidence.status === 'visible' || evidence.status === 'user-confirmed')
    ))
    .map(evidence => evidence.id));
  const candidateIds = new Set<string>();
  if (
    input.conceptPreviews.length !== PROMPT_WIZARD_PLAN_COUNT
  ) {
    throw Object.assign(new Error('提示词向导必须提供两份入选的 3.0 创意路线'), {
      code: 'PROMPT_WIZARD_CONCEPT_ASSIGNMENT_INVALID',
    });
  }
  for (const planIndex of PROMPT_WIZARD_LEGACY_PLAN_INDEXES) {
    const assignment = input.conceptAssignments[planIndex];
    const strategy = input.strategies[planIndex];
    const preview = input.conceptPreviews[planIndex];
    if (
      !assignment
      || assignment.planIndex !== planIndex
      || assignment.direction !== input.brief.direction
      || !strategy
      || strategySignature(assignment.strategy) !== strategySignature(strategy)
      || candidateIds.has(assignment.candidateId)
      || assignment.evidenceIds.length === 0
      || assignment.evidenceIds.some(factId => !allowedFactIds.has(factId))
      || !preview
      || preview.id !== assignment.candidateId
      || preview.direction !== input.brief.direction
      || strategySignature(preview.strategy) !== strategySignature(strategy)
      || preview.evidenceIds.length !== assignment.evidenceIds.length
      || preview.evidenceIds.some((evidenceId, index) => (
        evidenceId !== assignment.evidenceIds[index]
      ))
    ) {
      throw Object.assign(new Error(`方案 ${planIndex + 1} 的入选创意上下文无效`), {
        code: 'PROMPT_WIZARD_CONCEPT_ASSIGNMENT_INVALID',
      });
    }
    const chineseFields = [
      assignment.targetAudience,
      assignment.openingAction,
      assignment.progression,
      assignment.scene,
      assignment.perspective,
      assignment.painExpression,
      assignment.proofAction,
      assignment.midpointEscalation,
      assignment.visibleResult,
      assignment.cameraSoundGrammar,
      assignment.cta,
    ];
    if (chineseFields.some(value => !/[\u3400-\u9fff]/u.test(value.normalize('NFKC')))) {
      throw Object.assign(new Error(`方案 ${planIndex + 1} 的创意上下文必须使用简体中文`), {
        code: 'PROMPT_WIZARD_CONCEPT_ASSIGNMENT_INVALID',
      });
    }
    candidateIds.add(assignment.candidateId);
  }
  const v3DifferenceCount = countPromptWizardV3ConceptDifferences(
    input.conceptPreviews[0]!,
    input.conceptPreviews[1]!,
  );
  if (v3DifferenceCount < 4) {
    throw Object.assign(new Error('两份入选创意的开场、证据和创意指纹差异不足'), {
      code: 'PROMPT_WIZARD_CONCEPT_ASSIGNMENT_INVALID',
    });
  }
}

function countPromptWizardV3ConceptDifferences(
  left: PromptWizardConceptPreview,
  right: PromptWizardConceptPreview,
) {
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
  return [
    normalize(left.firstSecondEvent) !== normalize(right.firstSecondEvent),
    normalize(left.tension) !== normalize(right.tension),
    left.evidenceIds[0] !== right.evidenceIds[0],
    normalize(`${left.scene}${left.perspective}`) !== normalize(`${right.scene}${right.perspective}`),
    normalize(left.ctaCallback) !== normalize(right.ctaCallback),
  ].filter(Boolean).length;
}

/**
 * 生产与正式 Canary 共用的方案编排边界。Provider 只负责产生结构化 Draft；
 * 此函数负责安全标题、确定性渲染、事实/语言/差异门禁以及按索引内容修复。
 * 固定 planId 使未被修复的方案在其他索引修复期间保持字节级不变。
 */
export async function generateValidatedPromptWizardPlans(
  input: GenerateValidatedPromptWizardPlansInput,
): Promise<GenerateValidatedPromptWizardPlansResult> {
  const planIndexes = PROMPT_WIZARD_LEGACY_PLAN_INDEXES;
  if (input.strategies.length !== planIndexes.length) {
    throw Object.assign(new Error('提示词向导必须分配两套创意策略'), {
      code: 'PROMPT_WIZARD_STRATEGY_COUNT_INVALID',
    });
  }
  assertPromptWizardConceptAssignments(input);

  const planIds = planIndexes.map(() => randomUUID());
  let usage: PromptWizardProviderUsage | null = null;
  let drafts: PromptWizardPlanDraft[];
  let repairRounds = 0;
  try {
    const generated = await input.provider.generateDrafts({
      profile: input.profile,
      evidenceGraph: input.evidenceGraph,
      brief: input.brief,
      config: input.config,
      strategies: input.strategies,
      conceptAssignments: input.conceptAssignments,
      imageCount: input.imageCount,
      variationKey: input.variationKey,
      deadlineAtMs: input.deadlineAtMs,
      ...(input.costOwner ? {
        costOwner: { ...input.costOwner, repairRound: 0 },
      } : {}),
    });
    usage = generated.usage;
    if (generated.drafts.length !== PROMPT_WIZARD_PLAN_COUNT) {
      throw Object.assign(new Error('Provider 必须返回两套方案'), {
        code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      });
    }
    if (
      generated.repairRounds !== undefined
      && (
        !Number.isSafeInteger(generated.repairRounds)
        || generated.repairRounds < 0
        || generated.repairRounds > PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
      )
    ) {
      throw Object.assign(new Error('Provider 返回的内容修复轮次无效'), {
        code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      });
    }
    drafts = [...generated.drafts];
    repairRounds = generated.repairRounds ?? 0;
  } catch (error) {
    throw attachPromptWizardOrchestrationUsage(
      error,
      mergePromptWizardProviderFailureUsage(usage, error),
      repairRounds,
    );
  }

  let terminalContentError: unknown = null;
  while (true) {
    let validation: PromptWizardDraftSetValidation;
    try {
      validation = validatePromptWizardDraftSet({
        drafts,
        planIds,
        strategies: input.strategies,
        conceptAssignments: input.conceptAssignments,
        conceptPreviews: input.conceptPreviews,
        evidenceGraph: input.evidenceGraph,
        profile: input.profile,
        brief: input.brief,
        config: input.config,
        imageCount: input.imageCount,
        historicalPlans: input.historicalPlans,
        repairRounds,
        allowSafeHookFallback: repairRounds >= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS,
      });
    } catch (error) {
      throw attachPromptWizardOrchestrationUsage(error, usage, repairRounds);
    }
    drafts = validation.drafts;
    if (validation.plans) {
      return {
        plans: validation.plans,
        drafts,
        usage,
        repairRounds,
      };
    }

    terminalContentError = validation.terminalError;
    if (
      repairRounds >= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
      || input.deadlineAtMs - Date.now() < PROMPT_WIZARD_MIN_CONTENT_REPAIR_BUDGET_MS
    ) {
      throw attachPromptWizardOrchestrationUsage(
        terminalContentError ?? Object.assign(new Error('方案内容修复未通过最终校验'), {
          code: 'PROMPT_WIZARD_DIVERSITY_FAILED',
        }),
        usage,
        repairRounds,
        validation.issues.map(issue => issue.planIndex),
      );
    }

    repairRounds += 1;
    try {
      const repaired = await input.provider.repairDrafts({
        profile: input.profile,
        evidenceGraph: input.evidenceGraph,
        brief: input.brief,
        config: input.config,
        strategies: input.strategies,
        conceptAssignments: input.conceptAssignments,
        imageCount: input.imageCount,
        variationKey: input.variationKey,
        previousDrafts: [...drafts],
        issues: validation.issues,
        deadlineAtMs: input.deadlineAtMs,
        ...(input.costOwner ? {
          costOwner: { ...input.costOwner, repairRound: repairRounds },
        } : {}),
      });
      usage = mergePromptWizardProviderUsage(usage, repaired.usage);
      const requestedIndexes = new Set(validation.issues.map(issue => issue.planIndex));
      const returnedIndexes = new Set<PromptWizardPlanIndex>();
      for (const repairedDraft of repaired.drafts) {
        const planIndex = toPromptWizardPlanIndex(repairedDraft.planIndex);
        if (!requestedIndexes.has(planIndex) || returnedIndexes.has(planIndex)) {
          throw Object.assign(new Error('Provider 返回了未请求或重复的方案索引'), {
            code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
          });
        }
        returnedIndexes.add(planIndex);
        drafts[planIndex] = repairedDraft.draft;
      }
      if (
        returnedIndexes.size !== requestedIndexes.size
        || [...requestedIndexes].some(planIndex => !returnedIndexes.has(planIndex))
      ) {
        throw Object.assign(new Error('Provider 未返回全部待修复方案'), {
          code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
        });
      }
    } catch (error) {
      const combinedUsage = mergePromptWizardProviderFailureUsage(usage, error);
      throw attachPromptWizardOrchestrationUsage(
        error,
        combinedUsage ?? usage,
        repairRounds,
        validation.issues.map(issue => issue.planIndex),
      );
    }
  }
}

interface PromptWizardDraftSetValidation {
  drafts: PromptWizardPlanDraft[];
  plans: PromptWizardPlan[] | null;
  issues: PromptWizardContentRepairIssue[];
  terminalError: unknown;
}

function validatePromptWizardDraftSet(input: {
  drafts: PromptWizardPlanDraft[];
  planIds: string[];
  strategies: PromptWizardStrategy[];
  conceptAssignments: PromptWizardConceptAssignment[];
  conceptPreviews: PromptWizardConceptPreview[];
  evidenceGraph: PromptWizardEvidenceGraph;
  profile: PromptWizardProductProfile;
  brief: PromptWizardCreativeBrief;
  config: PromptWizardVideoConfig;
  imageCount: number;
  historicalPlans: PromptWizardPlan[];
  repairRounds: number;
  allowSafeHookFallback: boolean;
}): PromptWizardDraftSetValidation {
  const drafts = [...input.drafts];
  const plans: PromptWizardPlan[] = [];
  const issues = new Map<PromptWizardPlanIndex, PromptWizardContentRepairIssue>();
  let terminalError: unknown = null;
  const reservedNames = new Set(
    drafts.map(draft => draft.name.normalize('NFKC').trim()),
  );

  const renderDraftPlan = (
    planIndex: PromptWizardPlanIndex,
    draft: PromptWizardPlanDraft,
  ) => {
    const conceptPreview = input.conceptPreviews[planIndex]!;
    assertPromptWizardConceptExpansion({
      draft,
      concept: conceptPreview,
      evidenceGraph: input.evidenceGraph,
    });
    return renderPromptWizardPlan({
      id: input.planIds[planIndex]!,
      draft,
      strategy: input.strategies[planIndex]!,
      conceptAssignment: input.conceptAssignments[planIndex]!,
      conceptPreview,
      evidenceGraph: input.evidenceGraph,
      profile: input.profile,
      brief: input.brief,
      config: input.config,
      imageCount: input.imageCount,
    });
  };

  for (const planIndex of PROMPT_WIZARD_LEGACY_PLAN_INDEXES) {
    let draft = drafts[planIndex]!;
    reservedNames.delete(draft.name.normalize('NFKC').trim());
    try {
      plans[planIndex] = renderDraftPlan(planIndex, draft);
      reservedNames.add(draft.name.normalize('NFKC').trim());
      continue;
    } catch (initialError) {
      if (isUnrepairableFinalPromptError(initialError)) throw initialError;
      let currentError = initialError;
      let fieldPaths = promptWizardRawFieldPaths(currentError);
      const safeEditingCueIndexes = promptWizardSafeEditingCueIndexes(
        currentError,
        fieldPaths,
        draft.segments.length,
      );
      if (safeEditingCueIndexes) {
        const affectedIndexes = new Set(safeEditingCueIndexes);
        logPromptWizardSafeEditingCueFallback(
          planIndex,
          safeEditingCueIndexes,
          input.repairRounds,
        );
        draft = {
          ...draft,
          segments: draft.segments.map((segment, segmentIndex) => (
            affectedIndexes.has(segmentIndex)
              ? {
                  ...segment,
                  editingCue: PROMPT_WIZARD_SAFE_EDITING_CUE,
                }
              : segment
          )),
        };
        drafts[planIndex] = draft;
        try {
          plans[planIndex] = renderDraftPlan(planIndex, draft);
          reservedNames.add(draft.name.normalize('NFKC').trim());
          continue;
        } catch (safeEditingCueError) {
          if (isUnrepairableFinalPromptError(safeEditingCueError)) throw safeEditingCueError;
          currentError = safeEditingCueError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      }
      if (
        errorCode(currentError) === 'PROMPT_WIZARD_UNCONFIRMED_CLAIM'
        && fieldPaths.includes('name')
      ) {
        const safeName = buildPromptWizardSafeTitle({
          direction: input.brief.direction,
          strategy: input.strategies[planIndex]!,
          planIndex,
          reservedNames,
        });
        draft = { ...draft, name: safeName };
        drafts[planIndex] = draft;
        reservedNames.add(safeName.normalize('NFKC').trim());
        try {
          plans[planIndex] = renderDraftPlan(planIndex, draft);
          continue;
        } catch (safeTitleError) {
          if (isUnrepairableFinalPromptError(safeTitleError)) throw safeTitleError;
          currentError = safeTitleError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      } else if (
        input.allowSafeHookFallback
        && errorCode(currentError) === 'PROMPT_WIZARD_UNCONFIRMED_CLAIM'
        && fieldPaths.length === 1
        && fieldPaths[0] === 'hook'
      ) {
        draft = {
          ...draft,
          hook: buildPromptWizardSafeHook({
            strategy: input.strategies[planIndex]!,
            conceptAssignment: input.conceptAssignments[planIndex]!,
          }),
        };
        drafts[planIndex] = draft;
        reservedNames.add(draft.name.normalize('NFKC').trim());
        try {
          plans[planIndex] = renderDraftPlan(planIndex, draft);
          continue;
        } catch (safeHookError) {
          if (isUnrepairableFinalPromptError(safeHookError)) throw safeHookError;
          currentError = safeHookError;
          fieldPaths = promptWizardRawFieldPaths(currentError);
        }
      } else {
        reservedNames.add(draft.name.normalize('NFKC').trim());
      }

      if (!isPromptWizardRepairableError(currentError)) throw currentError;
      const repairFieldPaths = promptWizardSafeFieldPaths(currentError);
      if (repairFieldPaths.length === 0) {
        throw Object.assign(new Error('方案内容错误缺少可安全修复的字段路径'), {
          code: 'PROMPT_WIZARD_CONTENT_REPAIR_CONTEXT_INVALID',
          cause: currentError,
        });
      }
      terminalError = preferPromptWizardTerminalContentError(terminalError, currentError);
      mergePromptWizardContentRepairIssue(issues, {
        planIndex,
        errorCode: errorCode(currentError),
        fieldPaths: repairFieldPaths,
        action: promptWizardRepairFeedback(currentError),
      });
    }
  }

  if (issues.size > 0) {
    return {
      drafts,
      plans: null,
      issues: [...issues.values()],
      terminalError,
    };
  }

  const diversityIssues = [
    ...validatePromptWizardPlanDiversity(plans),
    ...validatePromptWizardPlanHistory(plans, input.historicalPlans),
  ];
  for (const issue of diversityIssues) {
    const planIndex = toPromptWizardPlanIndex(Math.max(...issue.planIndexes));
    const fieldPaths = promptWizardDiversityRepairFieldPaths(drafts[planIndex]!);
    const diversityError = Object.assign(new Error(issue.reason), {
      code: 'PROMPT_WIZARD_DIVERSITY_FAILED',
      fieldPaths,
    });
    terminalError = preferPromptWizardTerminalContentError(terminalError, diversityError);
    mergePromptWizardContentRepairIssue(issues, {
      planIndex,
      errorCode: 'PROMPT_WIZARD_DIVERSITY_FAILED',
      fieldPaths,
      action: `${issue.reason}；只在列出的创意字段范围内改写当前 assignedConcept 的镜头表达，不得更换其开场事件、场景、视角、痛点、证据形式或收束方式；不得改变产品事实、证据引用、目标语言或视频配置`,
    });
  }
  return diversityIssues.length === 0
    ? { drafts, plans, issues: [], terminalError: null }
    : { drafts, plans: null, issues: [...issues.values()], terminalError };
}

const PROMPT_WIZARD_SAFE_EDITING_CUE = '在动作完成点自然剪切，保持画面连续';
const PROMPT_WIZARD_V6_SAFE_EDITING_CUE = '沿当前镜头动作点切换景别，保持画面连续';

function promptWizardSafeCtaMotionFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  appearanceMode: PromptWizardUseDirectionPlanContext['useDirection']['appearanceMode'];
}) {
  if (
    errorCode(input.error) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
    || input.draft.segments.length === 0
  ) {
    return null;
  }
  const lastSegmentIndex = input.draft.segments.length - 1;
  const fieldPaths = promptWizardSafeFieldPaths(input.error);
  if (
    fieldPaths.length === 0
    || fieldPaths.some(path => path !== `segments[${lastSegmentIndex}].action`)
  ) {
    return null;
  }
  const action = input.appearanceMode === 'person'
    ? '人物持续走近镜头并点头，用手势引导点击商品卡'
    : input.appearanceMode === 'hands-only'
      ? '手部持续移动到镜头中央，并指向商品卡区域'
      : '镜头沿产品轮廓持续推进，呈现前段动作完成后的可见状态';
  return {
    ...input.draft,
    segments: input.draft.segments.map((segment, index) => index === lastSegmentIndex
      ? { ...segment, action }
      : segment),
  };
}

function promptWizardSafeV6CtaMotionFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  appearanceMode: PromptWizardUseDirectionPlanContext['useDirection']['appearanceMode'];
  contentRepairRequestCount: number;
}) {
  if (
    input.contentRepairRequestCount !== PROMPT_WIZARD_V6_SAFE_FALLBACK_MIN_CONTENT_REPAIR_REQUESTS
    || !(input.error instanceof PromptWizardMotionDensityError)
    || errorCode(input.error) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
    || input.draft.segments.length === 0
  ) return null;
  const lastSegmentIndex = input.draft.segments.length - 1;
  const lastSegment = input.draft.segments[lastSegmentIndex]!;
  const fieldPaths = promptWizardRawFieldPaths(input.error);
  if (
    fieldPaths.length !== 1
    || fieldPaths[0] !== `segments[${lastSegmentIndex}].action`
    || lastSegment.role !== 'cta'
    || !promptWizardContainsStaticInstruction(lastSegment.action)
  ) return null;
  const action = promptWizardSafeV6CtaMotionAction(input.appearanceMode);
  return {
    ...input.draft,
    segments: input.draft.segments.map((segment, index) => index === lastSegmentIndex
      ? { ...segment, action }
      : segment),
  };
}

function promptWizardSafeV6CtaMotionAction(
  appearanceMode: PromptWizardUseDirectionPlanContext['useDirection']['appearanceMode'],
) {
  return appearanceMode === 'person'
    ? '人物持续走近镜头并自然收束'
    : appearanceMode === 'hands-only'
      ? '手部持续移向镜头中央并自然收束'
      : '产品在持续运镜中自然收束';
}

function promptWizardV6CtaActionMotionFallbackScope(error: unknown) {
  return error instanceof PromptWizardMotionDensityError
    && errorCode(error) === 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
    && promptWizardRawFieldPaths(error).some(path => (
      /^segments\[\d{1,2}\]\.action$/u.test(path)
    ));
}

function logPromptWizardSafeCtaMotionFallback(
  planIndex: PromptWizardPlanIndex,
  appearanceMode: string,
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-cta-motion-fallback',
    planIndex,
    appearanceMode,
    repairRounds,
  }));
}

function promptWizardSafeSegmentActionMotionFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  context: PromptWizardUseDirectionPlanContext;
  repairRounds: number;
}) {
  if (
    input.repairRounds < PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    || errorCode(input.error) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
    || input.draft.segments.length === 0
  ) {
    return null;
  }
  const lastSegmentIndex = input.draft.segments.length - 1;
  const fieldPaths = promptWizardSafeFieldPaths(input.error);
  if (fieldPaths.length === 0) return null;
  const segmentIndexes = fieldPaths.map(fieldPath => {
    const match = /^segments\[(\d{1,2})\]\.action$/u.exec(fieldPath);
    if (!match) return null;
    const segmentIndex = Number(match[1]);
    return Number.isSafeInteger(segmentIndex)
      && segmentIndex >= 0
      && segmentIndex < lastSegmentIndex
      ? segmentIndex
      : null;
  });
  if (segmentIndexes.some(segmentIndex => segmentIndex === null)) return null;
  const affected = new Set(segmentIndexes as number[]);
  const verifiedAction = input.context.selectedScene.mainAction
    .normalize('NFKC')
    .trim()
    .replace(/[。；;.]+$/u, '');
  return {
    segmentIndexes: [...affected],
    draft: {
      ...input.draft,
      segments: input.draft.segments.map((segment, segmentIndex) => affected.has(segmentIndex)
        ? {
            ...segment,
            action: `在真实场景中持续执行${verifiedAction}，动作过程与可见结果连续呈现`,
          }
        : segment),
    },
  };
}

function logPromptWizardSafeSegmentActionMotionFallback(
  planIndex: PromptWizardPlanIndex,
  segmentIndexes: number[],
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-segment-action-motion-fallback',
    planIndex,
    segmentIndexes,
    repairRounds,
  }));
}

const PROMPT_WIZARD_SAFE_LIGHTING_AND_REALISM =
  '真实环境光与反光随主体和镜头运动自然变化，材质表现保持连续';

function promptWizardSafeLightingMotionFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  repairRounds: number;
}) {
  if (
    input.repairRounds < PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    || errorCode(input.error) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
  ) {
    return null;
  }
  const fieldPaths = promptWizardSafeFieldPaths(input.error);
  if (fieldPaths.length === 0) return null;
  const segmentIndexes = fieldPaths.map(fieldPath => {
    const match = /^segments\[(\d{1,2})\]\.lightingAndRealism$/u.exec(fieldPath);
    if (!match) return null;
    const segmentIndex = Number(match[1]);
    return Number.isSafeInteger(segmentIndex)
      && segmentIndex >= 0
      && segmentIndex < input.draft.segments.length
      ? segmentIndex
      : null;
  });
  if (segmentIndexes.some(segmentIndex => segmentIndex === null)) return null;
  const affected = new Set(segmentIndexes as number[]);
  return {
    segmentIndexes: [...affected],
    draft: {
      ...input.draft,
      segments: input.draft.segments.map((segment, segmentIndex) => affected.has(segmentIndex)
        ? { ...segment, lightingAndRealism: PROMPT_WIZARD_SAFE_LIGHTING_AND_REALISM }
        : segment),
    },
  };
}

function logPromptWizardSafeLightingMotionFallback(
  planIndex: PromptWizardPlanIndex,
  segmentIndexes: number[],
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-lighting-motion-fallback',
    planIndex,
    segmentIndexes,
    repairRounds,
  }));
}

const PROMPT_WIZARD_V6_SAFE_LIGHTING_AND_REALISM =
  '真实环境光与反光移动随主体和镜头运动自然变化，材质表现保持连续';

/**
 * V6 某一方案已恰好消费一次真实内容修复后，若权威动态门禁仍只指向
 * 一个规范且在界内的 lightingAndRealism 叶子，则用带有可识别环境动态
 * 的受控句原子替换该叶子。旧 V4/V5 的两轮 lighting 收口保持不变。
 *
 * 传入 error 只作入口证据；实时 Draft 还必须重新通过 Schema、V6 时间轴、
 * 镜头职责、口播结构和执行预算检查，并由权威 motion validator 复现完全
 * 相同的 singleton。候选也必须再次通过 motion validator，防止替换时丢失
 * 全片唯一环境动态来源。
 */
export function promptWizardSafeV6LightingMotionFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  config: PromptWizardVideoConfig;
  targetLanguage?: string;
  contentRepairRequestCount: number;
  deliveryVersion: 4 | 5 | 6;
}) {
  if (
    input.deliveryVersion !== 6
    || input.contentRepairRequestCount
      !== PROMPT_WIZARD_V6_SAFE_FALLBACK_MIN_CONTENT_REPAIR_REQUESTS
    || !(input.error instanceof PromptWizardMotionDensityError)
    || errorCode(input.error) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
  ) return null;

  const fieldPaths = promptWizardRawFieldPaths(input.error);
  if (fieldPaths.length !== 1) return null;
  const fieldPath = fieldPaths[0]!;
  const match = /^segments\[(\d{1,2})\]\.lightingAndRealism$/u.exec(fieldPath);
  if (!match) return null;
  const segmentIndex = Number(match[1]);
  if (
    !Number.isSafeInteger(segmentIndex)
    || segmentIndex < 0
    || segmentIndex >= input.draft.segments.length
    || fieldPath !== `segments[${segmentIndex}].lightingAndRealism`
  ) return null;

  let configSnapshot: PromptWizardVideoConfig;
  let draftSnapshot: PromptWizardPlanDraft;
  try {
    const parsedConfig = promptWizardVideoConfigSchema.parse(structuredClone(input.config));
    const parsedDraft = promptWizardPlanDraftSchema.parse(structuredClone(input.draft));
    // Zod 的 trim 转换不能在本地 fallback 中顺带改写其他字段。
    if (
      JSON.stringify(parsedConfig) !== JSON.stringify(input.config)
      || JSON.stringify(parsedDraft) !== JSON.stringify(input.draft)
    ) return null;
    configSnapshot = parsedConfig;
    draftSnapshot = parsedDraft;
  } catch {
    return null;
  }

  const timeline = promptWizardTimelineV6(configSnapshot.durationSeconds);
  const expectedRoles = promptWizardBeatRolesV6(configSnapshot.durationSeconds);
  if (
    draftSnapshot.segments.length !== timeline.length
    || draftSnapshot.segments.length !== expectedRoles.length
    || draftSnapshot.segments.some((segment, index) => segment.role !== expectedRoles[index])
  ) return null;

  const targetLanguage = input.targetLanguage?.normalize('NFKC').trim();
  if (configSnapshot.durationSeconds === 5) {
    if (draftSnapshot.segments.some(segment => (
      segment.voiceover.trim().length > 0 || segment.voiceoverZh.trim().length > 0
    ))) return null;
  } else {
    if (!targetLanguage || targetLanguage !== input.targetLanguage) return null;
    if (draftSnapshot.segments.some(segment => (
      !segment.voiceover.trim()
      || /\p{C}|\p{Extended_Pictographic}/u.test(segment.voiceover)
    ))) return null;
  }

  try {
    assertPromptWizardShotExecutionBudget({
      shots: draftSnapshot.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
  } catch {
    return null;
  }

  try {
    assertPromptWizardMotionDensity({
      shots: draftSnapshot.segments,
      durationSeconds: configSnapshot.durationSeconds,
    });
    return null;
  } catch (liveError) {
    const livePaths = promptWizardRawFieldPaths(liveError);
    if (
      !(liveError instanceof PromptWizardMotionDensityError)
      || errorCode(liveError) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
      || livePaths.length !== 1
      || livePaths[0] !== fieldPath
    ) return null;
  }

  const candidate: PromptWizardPlanDraft = {
    ...draftSnapshot,
    segments: draftSnapshot.segments.map((segment, index) => index === segmentIndex
      ? {
          ...segment,
          lightingAndRealism: PROMPT_WIZARD_V6_SAFE_LIGHTING_AND_REALISM,
        }
      : segment),
  };
  try {
    const parsedCandidate = promptWizardPlanDraftSchema.parse(structuredClone(candidate));
    if (JSON.stringify(parsedCandidate) !== JSON.stringify(candidate)) return null;
    assertPromptWizardMotionDensity({
      shots: candidate.segments,
      durationSeconds: configSnapshot.durationSeconds,
    });
    assertPromptWizardShotExecutionBudget({
      shots: candidate.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
  } catch {
    return null;
  }
  return { draft: candidate, segmentIndex };
}

function promptWizardV6LightingMotionFallbackScope(error: unknown) {
  return errorCode(error) === 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
    && promptWizardRawFieldPaths(error).some(path => (
      /^segments\[[^\]\r\n]+\]\.lightingAndRealism$/u.test(path)
    ));
}

/**
 * 该方案已恰好完成一次内容修复后，若动态密度错误只指向明确镜头的运镜
 * 字段，就仅把这些字段收口为持续缓慢推近。该动作不改变产品、人物、
 * 证据、口播、CTA 或其他镜头；任何混合路径、越界索引或其他错误码都继续失败。
 */
function promptWizardSafeSegmentCameraMotionFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  contentRepairRequestCount: number;
}) {
  if (
    input.contentRepairRequestCount
      !== PROMPT_WIZARD_V6_SAFE_FALLBACK_MIN_CONTENT_REPAIR_REQUESTS
    || !(input.error instanceof PromptWizardMotionDensityError)
    || errorCode(input.error) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
    || input.draft.segments.length === 0
  ) return null;
  const fieldPaths = promptWizardRawFieldPaths(input.error);
  if (fieldPaths.length !== 1) return null;
  const segmentIndexes = fieldPaths.map(fieldPath => {
    const match = /^segments\[(\d{1,2})\]\.cameraMovement$/u.exec(fieldPath);
    if (!match) return null;
    const segmentIndex = Number(match[1]);
    return Number.isSafeInteger(segmentIndex)
      && segmentIndex >= 0
      && segmentIndex < input.draft.segments.length
      && fieldPath === `segments[${segmentIndex}].cameraMovement`
      ? segmentIndex
      : null;
  });
  if (segmentIndexes.some(segmentIndex => segmentIndex === null)) return null;
  const affected = new Set(segmentIndexes as number[]);
  return {
    segmentIndexes: [...affected],
    draft: {
      ...input.draft,
      segments: input.draft.segments.map((segment, segmentIndex) => affected.has(segmentIndex)
        ? { ...segment, cameraMovement: PROMPT_WIZARD_SAFE_CAMERA_MOVEMENT }
        : segment),
    },
  };
}

function promptWizardV6CameraMotionFallbackScope(error: unknown) {
  return errorCode(error) === 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
    && promptWizardRawFieldPaths(error).some(path => (
      /^segments\[\d{1,2}\]\.cameraMovement$/u.test(path)
    ));
}

/**
 * V6 某一方案已恰好消费一次真实内容修复后，若权威动态门禁仍只指向
 * 一个规范且在界内的 editingCue 叶子，则用不含静态指令、并明确沿
 * 当前镜头动作点切换景别的受控句原子替换该叶子。
 *
 * 入口错误、实时 Draft 和候选 Draft 都必须分别通过类型、规范快照、
 * V6 时间轴、口播结构、执行预算与权威 motion validator 校验。任何
 * 伪造、重复、混合、非规范或越界路径都返回 null；第一次修复后可把
 * 当前权威路径交给第二轮，第二轮后由调用方在第三次 Provider 内容请求前
 * 失败关闭。V4/V5 不进入本分支。
 */
export function promptWizardSafeV6EditingCueMotionFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  config: PromptWizardVideoConfig;
  targetLanguage?: string;
  contentRepairRequestCount: number;
  deliveryVersion: 4 | 5 | 6;
}) {
  if (
    input.deliveryVersion !== 6
    || input.contentRepairRequestCount
      !== PROMPT_WIZARD_V6_SAFE_FALLBACK_MIN_CONTENT_REPAIR_REQUESTS
    || !(input.error instanceof PromptWizardMotionDensityError)
    || errorCode(input.error) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
  ) return null;

  const fieldPaths = promptWizardRawFieldPaths(input.error);
  if (fieldPaths.length !== 1) return null;
  const fieldPath = fieldPaths[0]!;
  const match = /^segments\[(\d{1,2})\]\.editingCue$/u.exec(fieldPath);
  if (!match) return null;
  const segmentIndex = Number(match[1]);
  if (
    !Number.isSafeInteger(segmentIndex)
    || segmentIndex < 0
    || segmentIndex >= input.draft.segments.length
    || fieldPath !== `segments[${segmentIndex}].editingCue`
  ) return null;

  let configSnapshot: PromptWizardVideoConfig;
  let draftSnapshot: PromptWizardPlanDraft;
  try {
    const parsedConfig = promptWizardVideoConfigSchema.parse(structuredClone(input.config));
    const parsedDraft = promptWizardPlanDraftSchema.parse(structuredClone(input.draft));
    // Zod 的 trim 转换不能在本地 fallback 中顺带改写其他字段。
    if (
      JSON.stringify(parsedConfig) !== JSON.stringify(input.config)
      || JSON.stringify(parsedDraft) !== JSON.stringify(input.draft)
    ) return null;
    configSnapshot = parsedConfig;
    draftSnapshot = parsedDraft;
  } catch {
    return null;
  }

  const timeline = promptWizardTimelineV6(configSnapshot.durationSeconds);
  const expectedRoles = promptWizardBeatRolesV6(configSnapshot.durationSeconds);
  if (
    draftSnapshot.segments.length !== timeline.length
    || draftSnapshot.segments.length !== expectedRoles.length
    || draftSnapshot.segments.some((segment, index) => segment.role !== expectedRoles[index])
  ) return null;

  const targetLanguage = input.targetLanguage?.normalize('NFKC').trim();
  if (configSnapshot.durationSeconds === 5) {
    if (draftSnapshot.segments.some(segment => (
      segment.voiceover.trim().length > 0 || segment.voiceoverZh.trim().length > 0
    ))) return null;
  } else {
    if (!targetLanguage || targetLanguage !== input.targetLanguage) return null;
    if (draftSnapshot.segments.some(segment => (
      !segment.voiceover.trim()
      || /\p{C}|\p{Extended_Pictographic}/u.test(segment.voiceover)
    ))) return null;
  }

  try {
    assertPromptWizardShotExecutionBudget({
      shots: draftSnapshot.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
  } catch {
    return null;
  }

  try {
    assertPromptWizardMotionDensity({
      shots: draftSnapshot.segments,
      durationSeconds: configSnapshot.durationSeconds,
    });
    return null;
  } catch (liveError) {
    const livePaths = promptWizardRawFieldPaths(liveError);
    if (
      !(liveError instanceof PromptWizardMotionDensityError)
      || errorCode(liveError) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
      || livePaths.length !== 1
      || livePaths[0] !== fieldPath
    ) return null;
  }

  const candidate: PromptWizardPlanDraft = {
    ...draftSnapshot,
    segments: draftSnapshot.segments.map((segment, index) => index === segmentIndex
      ? { ...segment, editingCue: PROMPT_WIZARD_V6_SAFE_EDITING_CUE }
      : segment),
  };
  try {
    const parsedCandidate = promptWizardPlanDraftSchema.parse(structuredClone(candidate));
    if (JSON.stringify(parsedCandidate) !== JSON.stringify(candidate)) return null;
    assertPromptWizardMotionDensity({
      shots: candidate.segments,
      durationSeconds: configSnapshot.durationSeconds,
    });
    assertPromptWizardShotExecutionBudget({
      shots: candidate.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
  } catch {
    return null;
  }
  return { draft: candidate, segmentIndex };
}

function assertPromptWizardV6ReferenceModeAuthority(draft: PromptWizardPlanDraft) {
  assertPromptWizardNoFirstLastSemantics(promptWizardStringLeaves(draft));
}

/**
 * V6 某一方案恰好消费两次内容修复后，若权威首尾帧语义门禁
 * 仍只指向一个规范且在界内的 editingCue 叶子，则只把该叶子
 * 替换为既有 V6 安全剪辑句。入口错误必须由当前 Draft 经同一
 * 权威检查实时精确复现；格式恢复稿、其他路径、非规范快照、
 * 原稿预算或动态密度不合格均失败关闭。
 *
 * 这是两轮 Provider 内容修复耗尽后的终态原子收口；调用方仍须
 * 立即完整 renderRoutePlan，候选稿失败时原位抛出且不得第三次外呼。
 */
export function promptWizardSafeV6ReferenceEditingCueFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  config: PromptWizardVideoConfig;
  targetLanguage?: string;
  contentRepairRequestCount: number;
  formatRecovered: boolean;
  deliveryVersion: 4 | 5 | 6;
}) {
  if (
    input.deliveryVersion !== 6
    || input.contentRepairRequestCount !== PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    || input.formatRecovered
    || !(input.error instanceof Error)
    || errorCode(input.error) !== 'PROMPT_WIZARD_REFERENCE_MODE_INVALID'
  ) return null;

  const rawFieldPaths = (input.error as { fieldPaths?: unknown }).fieldPaths;
  if (
    !Array.isArray(rawFieldPaths)
    || rawFieldPaths.length !== 1
    || typeof rawFieldPaths[0] !== 'string'
  ) return null;
  const fieldPath = rawFieldPaths[0];
  const match = /^segments\[(\d{1,2})\]\.editingCue$/u.exec(fieldPath);
  if (!match) return null;
  const segmentIndex = Number(match[1]);
  if (
    !Number.isSafeInteger(segmentIndex)
    || segmentIndex < 0
    || segmentIndex >= input.draft.segments.length
    || fieldPath !== `segments[${segmentIndex}].editingCue`
  ) return null;

  let configSnapshot: PromptWizardVideoConfig;
  let draftSnapshot: PromptWizardPlanDraft;
  try {
    const parsedConfig = promptWizardVideoConfigSchema.parse(structuredClone(input.config));
    const parsedDraft = promptWizardPlanDraftSchema.parse(structuredClone(input.draft));
    // Zod 的 trim 转换不能在本地 fallback 中顺带改写任何非目标叶子。
    if (
      JSON.stringify(parsedConfig) !== JSON.stringify(input.config)
      || JSON.stringify(parsedDraft) !== JSON.stringify(input.draft)
    ) return null;
    configSnapshot = parsedConfig;
    draftSnapshot = parsedDraft;
  } catch {
    return null;
  }

  const timeline = promptWizardTimelineV6(configSnapshot.durationSeconds);
  const expectedRoles = promptWizardBeatRolesV6(configSnapshot.durationSeconds);
  if (
    draftSnapshot.segments.length !== timeline.length
    || draftSnapshot.segments.length !== expectedRoles.length
    || draftSnapshot.segments.some((segment, index) => segment.role !== expectedRoles[index])
    || !promptWizardSafeV6ActionEditingCueVoiceoverShape({
      draft: draftSnapshot,
      config: configSnapshot,
      ...input.targetLanguage === undefined ? {} : { targetLanguage: input.targetLanguage },
    })
  ) return null;

  try {
    assertPromptWizardShotExecutionBudget({
      shots: draftSnapshot.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
    assertPromptWizardMotionDensity({
      shots: draftSnapshot.segments,
      durationSeconds: configSnapshot.durationSeconds,
    });
  } catch {
    return null;
  }

  try {
    assertPromptWizardV6ReferenceModeAuthority(draftSnapshot);
    return null;
  } catch (liveError) {
    const livePaths = promptWizardRawFieldPaths(liveError);
    if (
      errorCode(liveError) !== 'PROMPT_WIZARD_REFERENCE_MODE_INVALID'
      || livePaths.length !== 1
      || livePaths[0] !== fieldPath
    ) return null;
  }

  const candidate: PromptWizardPlanDraft = {
    ...draftSnapshot,
    segments: draftSnapshot.segments.map((segment, index) => index === segmentIndex
      ? { ...segment, editingCue: PROMPT_WIZARD_V6_SAFE_EDITING_CUE }
      : segment),
  };
  try {
    const parsedCandidate = promptWizardPlanDraftSchema.parse(structuredClone(candidate));
    if (JSON.stringify(parsedCandidate) !== JSON.stringify(candidate)) return null;
    assertPromptWizardV6ReferenceModeAuthority(candidate);
    assertPromptWizardMotionDensity({
      shots: candidate.segments,
      durationSeconds: configSnapshot.durationSeconds,
    });
    assertPromptWizardShotExecutionBudget({
      shots: candidate.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
  } catch {
    return null;
  }
  return { draft: candidate, segmentIndex };
}

function promptWizardV6ReferenceEditingCueFallbackScope(error: unknown) {
  return errorCode(error) === 'PROMPT_WIZARD_REFERENCE_MODE_INVALID'
    && promptWizardRawFieldPaths(error).some(path => (
      /^segments\[[^\]\r\n]+\]\.editingCue$/u.test(path)
    ));
}

function promptWizardSafeV6ContinuousLockedAction(value: string) {
  const lockedAction = promptWizardSingleFamilyAction(value).normalize('NFKC').trim();
  const withoutTerminalPunctuation = lockedAction.replace(/[。.!！?？；;]+$/u, '');
  const continuousAction = `持续${withoutTerminalPunctuation}，动作过程连续呈现`;
  // 锁定动作已经由既有 helper 收口到 Draft action 的安全长度。只有追加
  // “持续”语义仍在同一 Schema 边界内时才使用扩展句，否则原样复用锁定动作，
  // 不通过机械截断制造新的半句或商品事实。
  return continuousAction.length <= 300 ? continuousAction : lockedAction;
}

function promptWizardSafeV6ActionForRole(
  role: PromptWizardPlanDraft['segments'][number]['role'],
  context: PromptWizardUseDirectionPlanContext,
) {
  if (role === 'hook') {
    return promptWizardSafeV6ContinuousLockedAction(context.selectedScene.mainAction);
  }
  if (role === 'proof' || role === 'proof-resolution') {
    return promptWizardSafeV6ContinuousLockedAction(context.useDirection.proofAction);
  }
  if (role === 'resolution') {
    return '镜头持续跟随产品自证完成后的可见结果并自然转入下一镜';
  }
  return promptWizardSafeV6CtaMotionAction(context.useDirection.appearanceMode);
}

function promptWizardSafeV6ActionEditingCueVoiceoverShape(input: {
  draft: PromptWizardPlanDraft;
  config: PromptWizardVideoConfig;
  targetLanguage?: string;
}) {
  if (!promptWizardV6DraftHasSafeVoiceoverShape(input)) return false;
  if (input.config.durationSeconds === 5) return true;
  if (input.targetLanguage === '普通话') {
    return input.draft.segments.every(segment => segment.voiceoverZh.length === 0);
  }
  return input.draft.segments.every(segment => (
    segment.voiceoverZh.length > 0
    && /[\u3400-\u9fff]/u.test(segment.voiceoverZh)
    && !/\p{C}|\p{Extended_Pictographic}/u.test(segment.voiceoverZh)
  ));
}

/**
 * V6 某一方案已恰好消费两次内容修复后，Provider 偶尔仍会同时留下 action
 * 与 editingCue 两类动态密度错误。既有 singleton 收口会因为混合路径拒绝，
 * 而 action 终态守卫又会先于 editingCue 分支失败，导致已锁定的路线动作没有
 * 机会做最后一次本地原子收口。
 *
 * 本 helper 只接受实时权威 validator 精确复现的 action + editingCue 路径，
 * 只改这些获授权叶子；不发送第三次 Provider 请求。调用方仍须立即执行完整
 * renderRoutePlan，重新验证事实、证据、CTA、翻译与最终生产提示词。
 */
export function promptWizardSafeV6ActionEditingCueMotionFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  context: PromptWizardUseDirectionPlanContext;
  config: PromptWizardVideoConfig;
  targetLanguage?: string;
  contentRepairRequestCount: number;
  formatRecovered: boolean;
  deliveryVersion: 4 | 5 | 6;
}) {
  if (
    input.deliveryVersion !== 6
    || input.contentRepairRequestCount !== PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    || input.formatRecovered
    || !(input.error instanceof PromptWizardMotionDensityError)
    || errorCode(input.error) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
  ) return null;

  const fieldPaths = promptWizardRawFieldPaths(input.error);
  if (fieldPaths.length < 2 || new Set(fieldPaths).size !== fieldPaths.length) return null;
  const actionSegmentIndexes: number[] = [];
  const editingCueSegmentIndexes: number[] = [];
  for (const fieldPath of fieldPaths) {
    const match = /^segments\[(\d{1,2})\]\.(action|editingCue)$/u.exec(fieldPath);
    if (!match) return null;
    const segmentIndex = Number(match[1]);
    const field = match[2];
    if (
      !Number.isSafeInteger(segmentIndex)
      || segmentIndex < 0
      || segmentIndex >= input.draft.segments.length
      || fieldPath !== `segments[${segmentIndex}].${field}`
    ) return null;
    if (field === 'action') actionSegmentIndexes.push(segmentIndex);
    else editingCueSegmentIndexes.push(segmentIndex);
  }
  if (actionSegmentIndexes.length === 0 || editingCueSegmentIndexes.length === 0) return null;

  let configSnapshot: PromptWizardVideoConfig;
  let draftSnapshot: PromptWizardPlanDraft;
  try {
    const parsedConfig = promptWizardVideoConfigSchema.parse(structuredClone(input.config));
    const parsedDraft = promptWizardPlanDraftSchema.parse(structuredClone(input.draft));
    if (
      JSON.stringify(parsedConfig) !== JSON.stringify(input.config)
      || JSON.stringify(parsedDraft) !== JSON.stringify(input.draft)
    ) return null;
    configSnapshot = parsedConfig;
    draftSnapshot = parsedDraft;
  } catch {
    return null;
  }

  const timeline = promptWizardTimelineV6(configSnapshot.durationSeconds);
  const expectedRoles = promptWizardBeatRolesV6(configSnapshot.durationSeconds);
  if (
    draftSnapshot.segments.length !== timeline.length
    || draftSnapshot.segments.length !== expectedRoles.length
    || draftSnapshot.segments.some((segment, index) => segment.role !== expectedRoles[index])
    || !promptWizardSafeV6ActionEditingCueVoiceoverShape({
      draft: draftSnapshot,
      config: configSnapshot,
      ...input.targetLanguage === undefined ? {} : { targetLanguage: input.targetLanguage },
    })
  ) return null;

  try {
    assertPromptWizardShotExecutionBudget({
      shots: draftSnapshot.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
  } catch {
    return null;
  }

  try {
    assertPromptWizardMotionDensity({
      shots: draftSnapshot.segments,
      durationSeconds: configSnapshot.durationSeconds,
    });
    return null;
  } catch (liveError) {
    const livePaths = promptWizardRawFieldPaths(liveError);
    if (
      !(liveError instanceof PromptWizardMotionDensityError)
      || errorCode(liveError) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
      || JSON.stringify(livePaths) !== JSON.stringify(fieldPaths)
    ) return null;
  }

  const actionIndexes = new Set(actionSegmentIndexes);
  const editingCueIndexes = new Set(editingCueSegmentIndexes);
  const candidate: PromptWizardPlanDraft = {
    ...draftSnapshot,
    segments: draftSnapshot.segments.map((segment, segmentIndex) => ({
      ...segment,
      ...(actionIndexes.has(segmentIndex) ? {
        action: promptWizardSafeV6ActionForRole(segment.role, input.context),
      } : {}),
      ...(editingCueIndexes.has(segmentIndex) ? {
        editingCue: PROMPT_WIZARD_V6_SAFE_EDITING_CUE,
      } : {}),
    })),
  };
  try {
    const parsedCandidate = promptWizardPlanDraftSchema.parse(structuredClone(candidate));
    if (JSON.stringify(parsedCandidate) !== JSON.stringify(candidate)) return null;
    assertPromptWizardMotionDensity({
      shots: candidate.segments,
      durationSeconds: configSnapshot.durationSeconds,
    });
    assertPromptWizardShotExecutionBudget({
      shots: candidate.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
  } catch {
    return null;
  }
  return {
    draft: candidate,
    actionSegmentIndexes: [...actionSegmentIndexes],
    editingCueSegmentIndexes: [...editingCueSegmentIndexes],
  };
}

/**
 * V6 某一方案恰好完成两次内容修复后，Provider 偶尔仍会在同一稿件中
 * 留下一到多个 cameraMovement 动态密度错误，包括第二轮只修掉部分叶子后
 * 剩余的 singleton。继续委托会形成第三次 Provider 请求。
 *
 * 本 helper 只接受实时权威 validator 精确复现的 1..N 个规范运镜叶子，并
 * 只把这些获授权叶子替换为既有安全持续运镜。候选通过 Schema、时间轴、
 * 职责、口播结构、动态密度和执行预算后才交还调用方；完整商业门禁仍由
 * 调用方立即重渲染，失败时原位关闭。V4/V5 不进入本分支。
 */
export function promptWizardSafeV6MultiCameraMovementMotionFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  config: PromptWizardVideoConfig;
  targetLanguage?: string;
  contentRepairRequestCount: number;
  formatRecovered: boolean;
  deliveryVersion: 4 | 5 | 6;
}) {
  if (
    input.deliveryVersion !== 6
    || input.contentRepairRequestCount !== PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    || input.formatRecovered
    || !(input.error instanceof PromptWizardMotionDensityError)
    || errorCode(input.error) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
  ) return null;

  const rawFieldPaths = (input.error as { fieldPaths?: unknown }).fieldPaths;
  if (
    !Array.isArray(rawFieldPaths)
    || rawFieldPaths.length < 1
    || rawFieldPaths.some(fieldPath => typeof fieldPath !== 'string')
  ) return null;
  const fieldPaths = rawFieldPaths as string[];
  if (new Set(fieldPaths).size !== fieldPaths.length) return null;
  const segmentIndexes: number[] = [];
  for (const fieldPath of fieldPaths) {
    const match = /^segments\[(\d{1,2})\]\.cameraMovement$/u.exec(fieldPath);
    if (!match) return null;
    const segmentIndex = Number(match[1]);
    if (
      !Number.isSafeInteger(segmentIndex)
      || segmentIndex < 0
      || segmentIndex >= input.draft.segments.length
      || fieldPath !== `segments[${segmentIndex}].cameraMovement`
    ) return null;
    segmentIndexes.push(segmentIndex);
  }

  let configSnapshot: PromptWizardVideoConfig;
  let draftSnapshot: PromptWizardPlanDraft;
  try {
    const parsedConfig = promptWizardVideoConfigSchema.parse(structuredClone(input.config));
    const parsedDraft = promptWizardPlanDraftSchema.parse(structuredClone(input.draft));
    // Zod 的 trim 等转换不能在本地 fallback 中顺带改写未获授权字段。
    if (
      JSON.stringify(parsedConfig) !== JSON.stringify(input.config)
      || JSON.stringify(parsedDraft) !== JSON.stringify(input.draft)
    ) return null;
    configSnapshot = parsedConfig;
    draftSnapshot = parsedDraft;
  } catch {
    return null;
  }

  const timeline = promptWizardTimelineV6(configSnapshot.durationSeconds);
  const expectedRoles = promptWizardBeatRolesV6(configSnapshot.durationSeconds);
  if (
    draftSnapshot.segments.length !== timeline.length
    || draftSnapshot.segments.length !== expectedRoles.length
    || draftSnapshot.segments.some((segment, index) => segment.role !== expectedRoles[index])
    || !promptWizardSafeV6ActionEditingCueVoiceoverShape({
      draft: draftSnapshot,
      config: configSnapshot,
      ...input.targetLanguage === undefined ? {} : { targetLanguage: input.targetLanguage },
    })
  ) return null;

  try {
    assertPromptWizardShotExecutionBudget({
      shots: draftSnapshot.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
  } catch {
    return null;
  }

  try {
    assertPromptWizardMotionDensity({
      shots: draftSnapshot.segments,
      durationSeconds: configSnapshot.durationSeconds,
    });
    return null;
  } catch (liveError) {
    const livePaths = promptWizardRawFieldPaths(liveError);
    if (
      !(liveError instanceof PromptWizardMotionDensityError)
      || errorCode(liveError) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
      || JSON.stringify(livePaths) !== JSON.stringify(fieldPaths)
    ) return null;
  }

  const affected = new Set(segmentIndexes);
  const candidate: PromptWizardPlanDraft = {
    ...draftSnapshot,
    segments: draftSnapshot.segments.map((segment, segmentIndex) => (
      affected.has(segmentIndex)
        ? { ...segment, cameraMovement: PROMPT_WIZARD_SAFE_CAMERA_MOVEMENT }
        : segment
    )),
  };
  try {
    const parsedCandidate = promptWizardPlanDraftSchema.parse(structuredClone(candidate));
    if (JSON.stringify(parsedCandidate) !== JSON.stringify(candidate)) return null;
    assertPromptWizardMotionDensity({
      shots: candidate.segments,
      durationSeconds: configSnapshot.durationSeconds,
    });
    assertPromptWizardShotExecutionBudget({
      shots: candidate.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
  } catch {
    return null;
  }
  return { draft: candidate, segmentIndexes: [...segmentIndexes] };
}

/**
 * V6 首稿已经使用唯一一次格式恢复后，不得再把同一方案送去做内容修复。
 * 若恢复稿的完整领域校验只留下一个权威 cameraMovement 动态密度错误，
 * 就仅把该获授权叶子替换为既有安全持续运镜，再由调用方完整重渲染。
 *
 * 该分支不接受普通首稿、内容修复稿、多路径或混合路径，也不放宽事实、
 * 证据、口播、CTA、执行预算及最终提示词门禁。任何不规范或无法由实时
 * validator 精确复现的输入都返回 null。
 */
export function promptWizardSafeV6FormatRecoverySingleCameraMotionFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  config: PromptWizardVideoConfig;
  targetLanguage?: string;
  contentRepairRequestCount: number;
  formatRecovered: boolean;
  deliveryVersion: 4 | 5 | 6;
}) {
  if (
    input.deliveryVersion !== 6
    || !input.formatRecovered
    || input.contentRepairRequestCount !== 0
    || !(input.error instanceof PromptWizardMotionDensityError)
    || errorCode(input.error) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
  ) return null;

  const rawFieldPaths = (input.error as { fieldPaths?: unknown }).fieldPaths;
  if (
    !Array.isArray(rawFieldPaths)
    || rawFieldPaths.length !== 1
    || typeof rawFieldPaths[0] !== 'string'
  ) return null;
  const fieldPath = rawFieldPaths[0];
  const match = /^segments\[(\d{1,2})\]\.cameraMovement$/u.exec(fieldPath);
  if (!match) return null;
  const segmentIndex = Number(match[1]);
  if (
    !Number.isSafeInteger(segmentIndex)
    || segmentIndex < 0
    || segmentIndex >= input.draft.segments.length
    || fieldPath !== `segments[${segmentIndex}].cameraMovement`
  ) return null;

  let configSnapshot: PromptWizardVideoConfig;
  let draftSnapshot: PromptWizardPlanDraft;
  try {
    const parsedConfig = promptWizardVideoConfigSchema.parse(structuredClone(input.config));
    const parsedDraft = promptWizardPlanDraftSchema.parse(structuredClone(input.draft));
    if (
      JSON.stringify(parsedConfig) !== JSON.stringify(input.config)
      || JSON.stringify(parsedDraft) !== JSON.stringify(input.draft)
    ) return null;
    configSnapshot = parsedConfig;
    draftSnapshot = parsedDraft;
  } catch {
    return null;
  }

  const timeline = promptWizardTimelineV6(configSnapshot.durationSeconds);
  const expectedRoles = promptWizardBeatRolesV6(configSnapshot.durationSeconds);
  if (
    draftSnapshot.segments.length !== timeline.length
    || draftSnapshot.segments.length !== expectedRoles.length
    || draftSnapshot.segments.some((segment, index) => segment.role !== expectedRoles[index])
    || !promptWizardSafeV6ActionEditingCueVoiceoverShape({
      draft: draftSnapshot,
      config: configSnapshot,
      ...input.targetLanguage === undefined ? {} : { targetLanguage: input.targetLanguage },
    })
  ) return null;

  try {
    assertPromptWizardShotExecutionBudget({
      shots: draftSnapshot.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
  } catch {
    return null;
  }

  try {
    assertPromptWizardMotionDensity({
      shots: draftSnapshot.segments,
      durationSeconds: configSnapshot.durationSeconds,
    });
    return null;
  } catch (liveError) {
    const livePaths = promptWizardRawFieldPaths(liveError);
    if (
      !(liveError instanceof PromptWizardMotionDensityError)
      || errorCode(liveError) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
      || livePaths.length !== 1
      || livePaths[0] !== fieldPath
    ) return null;
  }

  const candidate: PromptWizardPlanDraft = {
    ...draftSnapshot,
    segments: draftSnapshot.segments.map((segment, index) => index === segmentIndex
      ? { ...segment, cameraMovement: PROMPT_WIZARD_SAFE_CAMERA_MOVEMENT }
      : segment),
  };
  try {
    const parsedCandidate = promptWizardPlanDraftSchema.parse(structuredClone(candidate));
    if (JSON.stringify(parsedCandidate) !== JSON.stringify(candidate)) return null;
    assertPromptWizardMotionDensity({
      shots: candidate.segments,
      durationSeconds: configSnapshot.durationSeconds,
    });
    assertPromptWizardShotExecutionBudget({
      shots: candidate.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
  } catch {
    return null;
  }
  return { draft: candidate, segmentIndex };
}

function promptWizardV6EditingCueMotionFallbackScope(error: unknown) {
  return errorCode(error) === 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
    && promptWizardRawFieldPaths(error).some(path => (
      /^segments\[[^\]\r\n]+\]\.editingCue$/u.test(path)
    ));
}

function logPromptWizardSafeSegmentCameraMotionFallback(
  planIndex: PromptWizardPlanIndex,
  segmentIndexes: number[],
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-segment-camera-motion-fallback',
    planIndex,
    segmentIndexes,
    repairRounds,
  }));
}

function logPromptWizardSafeV6FormatRecoverySingleCameraMotionFallback(
  planIndex: PromptWizardPlanIndex,
  segmentIndex: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-v6-safe-format-recovery-single-camera-motion-fallback',
    planIndex,
    segmentIndex,
    contentRepairRequestCount: 0,
  }));
}

const PROMPT_WIZARD_SAFE_MOTION_SHOT_SIZES = [
  '产品微距特写',
  '产品中近景',
  '产品侧面近景',
  '产品中景',
] as const;

/**
 * 两轮修复后，若动态错误同时命中景别、运镜、动作或剪辑，单字段回退无法
 * 安全处理。最终组合收口只复用已验证的场景动作，使用单一持续运镜、交替
 * 景别与动作点剪辑；不改变证据、购买理由、地点、口播或产品能力。
 */
function promptWizardSafeMotionCombinationFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  context: PromptWizardUseDirectionPlanContext;
  repairRounds: number;
}) {
  if (
    input.repairRounds < PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    || errorCode(input.error) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
    || input.draft.segments.length === 0
  ) return null;
  const fieldPaths = promptWizardRawFieldPaths(input.error);
  if (
    fieldPaths.length === 0
    || fieldPaths.some(path => (
      path !== 'segments'
      && !/^segments\[\d{1,2}\]\.(?:shotSize|cameraMovement|action|editingCue)$/u.test(path)
    ))
  ) return null;
  const stabilized = stabilizePromptWizardUseDirectionMajorActions({
    draft: input.draft,
    context: input.context,
  });
  return {
    ...stabilized,
    segments: stabilized.segments.map((segment, index) => ({
      ...segment,
      shotSize: PROMPT_WIZARD_SAFE_MOTION_SHOT_SIZES[
        index % PROMPT_WIZARD_SAFE_MOTION_SHOT_SIZES.length
      ]!,
      cameraMovement: PROMPT_WIZARD_SAFE_CAMERA_MOVEMENT,
      lightingAndRealism: '真实环境光与反光移动随主体和镜头运动自然变化，材质表现保持连续',
      editingCue: '在产品或手部动作落点快切到下一景别，保持画面连续',
    })),
  };
}

function logPromptWizardSafeMotionCombinationFallback(
  planIndex: PromptWizardPlanIndex,
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-motion-combination-fallback',
    planIndex,
    repairRounds,
  }));
}

function logPromptWizardSafeFirstShotFallback(
  planIndex: PromptWizardPlanIndex,
  reasons: ('observable-action' | 'product-anchor')[],
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-first-shot-fallback',
    planIndex,
    reasons,
    repairRounds,
  }));
}

function promptWizardSafeEditingCueIndexes(
  error: unknown,
  fieldPaths: string[],
  segmentCount: number,
) {
  if (
    ![
      'PROMPT_WIZARD_REFERENCE_MODE_INVALID',
      'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
    ].includes(errorCode(error))
    || fieldPaths.length === 0
  ) {
    return null;
  }
  const indexes = fieldPaths.map(fieldPath => {
    const match = /^segments\[(\d{1,2})\]\.editingCue$/u.exec(fieldPath);
    if (!match) return null;
    const segmentIndex = Number(match[1]);
    return Number.isSafeInteger(segmentIndex) && segmentIndex >= 0 && segmentIndex < segmentCount
      ? segmentIndex
      : null;
  });
  if (indexes.some(index => index === null)) return null;
  return [...new Set(indexes as number[])];
}

function promptWizardSafeProductionNoteIndexes(
  error: unknown,
  fieldPaths: string[],
  segmentCount: number,
) {
  if (
    errorCode(error) !== 'PROMPT_WIZARD_REFERENCE_MODE_INVALID'
    || fieldPaths.length === 0
  ) {
    return null;
  }
  const indexes = fieldPaths.map(fieldPath => {
    const match = /^segments\[(\d{1,2})\]\.productionNote$/u.exec(fieldPath);
    if (!match) return null;
    const segmentIndex = Number(match[1]);
    return Number.isSafeInteger(segmentIndex) && segmentIndex >= 0 && segmentIndex < segmentCount
      ? segmentIndex
      : null;
  });
  if (indexes.some(index => index === null)) return null;
  return [...new Set(indexes as number[])];
}

function logPromptWizardSafeEditingCueFallback(
  planIndex: PromptWizardPlanIndex,
  segmentIndexes: number[],
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-editing-cue-fallback',
    planIndex,
    segmentIndexes,
    repairRounds,
  }));
}

function logPromptWizardSafeProductionNoteFallback(
  planIndex: PromptWizardPlanIndex,
  segmentIndexes: number[],
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-production-note-fallback',
    planIndex,
    segmentIndexes,
    repairRounds,
  }));
}

function promptWizardSafeReferenceActionIndexes(
  error: unknown,
  fieldPaths: string[],
  segmentCount: number,
  repairRounds: number,
) {
  if (
    repairRounds < PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    || errorCode(error) !== 'PROMPT_WIZARD_REFERENCE_MODE_INVALID'
    || fieldPaths.length === 0
  ) {
    return null;
  }
  const indexes = fieldPaths.map(fieldPath => {
    const match = /^segments\[(\d{1,2})\]\.action$/u.exec(fieldPath);
    if (!match) return null;
    const segmentIndex = Number(match[1]);
    return Number.isSafeInteger(segmentIndex)
      && segmentIndex >= 0
      && segmentIndex < segmentCount
      ? segmentIndex
      : null;
  });
  if (indexes.some(index => index === null)) return null;
  return [...new Set(indexes as number[])];
}

function normalizePromptWizardReferenceAction(value: string) {
  return value.normalize('NFKC')
    .replace(/@(?=(?:首\s*[_-]?\s*帧|尾\s*[_-]?\s*帧|首\s*尾\s*[_-]?\s*帧|起始\s*[_-]?\s*帧|结束\s*[_-]?\s*帧|第一\s*[_-]?\s*帧|最后一\s*[_-]?\s*帧|(?:first|last|start|end)[\s_-]*frame))/giu, '')
    .replace(/首\s*尾\s*[_-]?\s*帧/gu, '开场与收尾画面')
    .replace(/(?:首|起始|第一)\s*[_-]?\s*帧/gu, '开场画面')
    .replace(/(?:尾|结束|最后一)\s*[_-]?\s*帧/gu, '收尾画面')
    .replace(/(?:first|start)[\s_-]*frame/giu, 'opening shot')
    .replace(/(?:last|end)[\s_-]*frame/giu, 'closing shot');
}

function normalizePromptWizardReferenceDraftValue<T>(value: T): T {
  if (typeof value === 'string') {
    return normalizePromptWizardReferenceAction(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => normalizePromptWizardReferenceDraftValue(item)) as T;
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      normalizePromptWizardReferenceDraftValue(item),
    ]),
  ) as T;
}

function logPromptWizardSafeReferenceActionFallback(
  planIndex: PromptWizardPlanIndex,
  segmentIndexes: number[],
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-reference-action-fallback',
    planIndex,
    segmentIndexes,
    repairRounds,
  }));
}

interface PromptWizardSafeMajorActionDetails {
  actual: number;
  limit: number;
}

function promptWizardSafeMajorActionFallbackDetails(
  error: unknown,
  repairRounds: number,
): PromptWizardSafeMajorActionDetails | null {
  if (
    repairRounds < PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    || errorCode(error) !== 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED'
    || !error
    || typeof error !== 'object'
  ) {
    return null;
  }
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const safeIssues = issues.map(issue => {
    if (!issue || typeof issue !== 'object') return null;
    const candidate = issue as Record<string, unknown>;
    if (
      candidate.code !== 'TOO_MANY_ACTIONS'
      || candidate.fieldPath !== 'segments'
      || !Number.isSafeInteger(candidate.actual)
      || !Number.isSafeInteger(candidate.limit)
      || (candidate.actual as number) <= (candidate.limit as number)
      || (candidate.limit as number) < 1
    ) {
      return null;
    }
    return {
      actual: candidate.actual as number,
      limit: candidate.limit as number,
    };
  });
  if (safeIssues.some(issue => issue === null)) return null;
  return {
    actual: Math.max(...safeIssues.map(issue => issue!.actual)),
    limit: Math.min(...safeIssues.map(issue => issue!.limit)),
  };
}

function logPromptWizardSafeMajorActionFallback(
  planIndex: PromptWizardPlanIndex,
  details: PromptWizardSafeMajorActionDetails,
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-major-action-fallback',
    planIndex,
    actual: details.actual,
    limit: details.limit,
    repairRounds,
  }));
}

function promptWizardSafePropFallbackDetails(
  error: unknown,
  repairRounds: number,
): PromptWizardSafeMajorActionDetails | null {
  if (repairRounds < PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS) return null;
  return promptWizardSafePropRepairDetails(error);
}

function logPromptWizardSafePropFallback(
  planIndex: PromptWizardPlanIndex,
  details: PromptWizardSafeMajorActionDetails,
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-prop-fallback',
    planIndex,
    actual: details.actual,
    limit: details.limit,
    repairRounds,
  }));
}

const PROMPT_WIZARD_SAFE_CAMERA_MOVEMENT = '镜头持续缓慢推近，产品证据始终保持清晰';

function promptWizardSafeCameraMoveFallbackDetails(
  error: unknown,
  repairRounds: number,
): PromptWizardSafeMajorActionDetails | null {
  if (repairRounds < PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS) return null;
  return promptWizardSafeCameraMoveRepairDetails(error);
}

function logPromptWizardSafeCameraMoveFallback(
  planIndex: PromptWizardPlanIndex,
  details: PromptWizardSafeMajorActionDetails,
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-camera-move-fallback',
    planIndex,
    actual: details.actual,
    limit: details.limit,
    repairRounds,
  }));
}

export interface PromptWizardV6MotionRepairSourceSnapshot {
  issue: {
    errorCode: string;
    fieldPaths: string[];
  };
  previousDraft: PromptWizardPlanDraft;
}

interface PromptWizardV6MotionRepairCameraBudgetFallbackResult {
  draft: PromptWizardPlanDraft;
  segmentIndex: number;
  issue: Pick<PromptWizardExecutionBudgetIssue,
    'code' | 'fieldPath' | 'actual' | 'limit'>;
}

function promptWizardSingleCameraBudgetIssue(
  error: unknown,
): PromptWizardV6MotionRepairCameraBudgetFallbackResult['issue'] | null {
  if (
    !(error instanceof PromptWizardExecutionBudgetError)
    || error.issues.length !== 1
  ) return null;
  const issue = error.issues[0]!;
  if (
    issue.code !== 'TOO_MANY_CAMERA_MOVES'
    || issue.fieldPath !== 'segments'
    || typeof issue.actual !== 'number'
    || typeof issue.limit !== 'number'
    || !Number.isSafeInteger(issue.actual)
    || !Number.isSafeInteger(issue.limit)
    || issue.actual <= issue.limit
    || issue.limit < 1
  ) return null;
  return {
    code: issue.code,
    fieldPath: issue.fieldPath,
    actual: issue.actual,
    limit: issue.limit,
  };
}

function promptWizardV6MotionRepairSourceSegmentIndex(
  source: PromptWizardV6MotionRepairSourceSnapshot | null,
  segmentCount: number,
) {
  if (
    !source
    || source.issue.errorCode !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
    || source.issue.fieldPaths.length !== 1
  ) return null;
  const fieldPath = source.issue.fieldPaths[0]!;
  const match = /^segments\[(\d{1,2})\]\.cameraMovement$/u.exec(fieldPath);
  if (!match) return null;
  const segmentIndex = Number(match[1]);
  return Number.isSafeInteger(segmentIndex)
    && segmentIndex >= 0
    && segmentIndex < segmentCount
    && fieldPath === `segments[${segmentIndex}].cameraMovement`
    ? segmentIndex
    : null;
}

function promptWizardV6DraftHasSafeVoiceoverShape(input: {
  draft: PromptWizardPlanDraft;
  config: PromptWizardVideoConfig;
  targetLanguage?: string;
}) {
  if (input.config.durationSeconds === 5) {
    return input.draft.segments.every(segment => (
      segment.voiceover.trim().length === 0
      && segment.voiceoverZh.trim().length === 0
    ));
  }
  const targetLanguage = input.targetLanguage?.normalize('NFKC').trim();
  return Boolean(
    targetLanguage
    && targetLanguage === input.targetLanguage
    && input.draft.segments.every(segment => (
      segment.voiceover.trim().length > 0
      && !/\p{C}|\p{Extended_Pictographic}/u.test(segment.voiceover)
    )),
  );
}

function promptWizardMaskV6MotionRepairTarget(
  draft: PromptWizardPlanDraft,
  segmentIndex: number,
) {
  return {
    ...draft,
    segments: draft.segments.map((segment, index) => index === segmentIndex
      ? { ...segment, cameraMovement: '__cameraMovement__' }
      : segment),
  };
}

/**
 * V6 的第一次领域内容修复若只拥有一个 cameraMovement 叶子，Provider 的
 * ownership 投影会保持其余 Draft 字段不变。该叶子从静态改成动态后可能
 * 新增运镜族，使校验从 singleton motion 错误转为整案 camera budget 错误。
 *
 * 本收口不凭 `segments` 猜测：修复前快照必须复现原始 singleton motion
 * 错误并通过执行预算，修复后稿件只能漂移该叶子，实时预算必须复现唯一的
 * TOO_MANY_CAMERA_MOVES。候选统一为单一持续推近后还要重新通过 motion 与
 * execution validator；完整商业门禁由调用方立即重渲染。V4/V5 不进入。
 */
export function promptWizardSafeV6MotionRepairCameraBudgetFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  source: PromptWizardV6MotionRepairSourceSnapshot | null;
  config: PromptWizardVideoConfig;
  targetLanguage?: string;
  contentRepairRequestCount: number;
  formatRecovered: boolean;
  deliveryVersion: 4 | 5 | 6;
}): PromptWizardV6MotionRepairCameraBudgetFallbackResult | null {
  if (
    input.deliveryVersion !== 6
    || input.contentRepairRequestCount
      !== PROMPT_WIZARD_V6_SAFE_FALLBACK_MIN_CONTENT_REPAIR_REQUESTS
    || input.formatRecovered
  ) return null;
  const currentIssue = promptWizardSingleCameraBudgetIssue(input.error);
  if (!currentIssue || !input.source) return null;

  let configSnapshot: PromptWizardVideoConfig;
  let previousDraftSnapshot: PromptWizardPlanDraft;
  let draftSnapshot: PromptWizardPlanDraft;
  try {
    const parsedConfig = promptWizardVideoConfigSchema.parse(structuredClone(input.config));
    const parsedPreviousDraft = promptWizardPlanDraftSchema.parse(
      structuredClone(input.source.previousDraft),
    );
    const parsedDraft = promptWizardPlanDraftSchema.parse(structuredClone(input.draft));
    if (
      JSON.stringify(parsedConfig) !== JSON.stringify(input.config)
      || JSON.stringify(parsedPreviousDraft) !== JSON.stringify(input.source.previousDraft)
      || JSON.stringify(parsedDraft) !== JSON.stringify(input.draft)
    ) return null;
    configSnapshot = parsedConfig;
    previousDraftSnapshot = parsedPreviousDraft;
    draftSnapshot = parsedDraft;
  } catch {
    return null;
  }

  const segmentIndex = promptWizardV6MotionRepairSourceSegmentIndex(
    input.source,
    previousDraftSnapshot.segments.length,
  );
  if (segmentIndex === null) return null;
  const timeline = promptWizardTimelineV6(configSnapshot.durationSeconds);
  const expectedRoles = promptWizardBeatRolesV6(configSnapshot.durationSeconds);
  if (
    previousDraftSnapshot.segments.length !== timeline.length
    || draftSnapshot.segments.length !== timeline.length
    || expectedRoles.length !== timeline.length
    || previousDraftSnapshot.segments.some(
      (segment, index) => segment.role !== expectedRoles[index],
    )
    || draftSnapshot.segments.some((segment, index) => segment.role !== expectedRoles[index])
    || !promptWizardV6DraftHasSafeVoiceoverShape({
      draft: previousDraftSnapshot,
      config: configSnapshot,
      ...input.targetLanguage === undefined ? {} : { targetLanguage: input.targetLanguage },
    })
    || !promptWizardV6DraftHasSafeVoiceoverShape({
      draft: draftSnapshot,
      config: configSnapshot,
      ...input.targetLanguage === undefined ? {} : { targetLanguage: input.targetLanguage },
    })
    || JSON.stringify(promptWizardMaskV6MotionRepairTarget(
      previousDraftSnapshot,
      segmentIndex,
    )) !== JSON.stringify(promptWizardMaskV6MotionRepairTarget(draftSnapshot, segmentIndex))
    || previousDraftSnapshot.segments[segmentIndex]!.cameraMovement
      === draftSnapshot.segments[segmentIndex]!.cameraMovement
  ) return null;

  try {
    assertPromptWizardShotExecutionBudget({
      shots: previousDraftSnapshot.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
  } catch {
    return null;
  }
  try {
    assertPromptWizardMotionDensity({
      shots: previousDraftSnapshot.segments,
      durationSeconds: configSnapshot.durationSeconds,
    });
    return null;
  } catch (sourceError) {
    const sourcePaths = promptWizardRawFieldPaths(sourceError);
    if (
      !(sourceError instanceof PromptWizardMotionDensityError)
      || errorCode(sourceError) !== 'PROMPT_WIZARD_MOTION_DENSITY_INVALID'
      || sourcePaths.length !== 1
      || sourcePaths[0] !== `segments[${segmentIndex}].cameraMovement`
    ) return null;
  }

  let liveIssue: ReturnType<typeof promptWizardSingleCameraBudgetIssue> = null;
  try {
    assertPromptWizardShotExecutionBudget({
      shots: draftSnapshot.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
    return null;
  } catch (liveError) {
    liveIssue = promptWizardSingleCameraBudgetIssue(liveError);
  }
  if (
    !liveIssue
    || liveIssue.code !== currentIssue.code
    || liveIssue.fieldPath !== currentIssue.fieldPath
    || liveIssue.actual !== currentIssue.actual
    || liveIssue.limit !== currentIssue.limit
  ) return null;

  const candidate: PromptWizardPlanDraft = {
    ...draftSnapshot,
    segments: draftSnapshot.segments.map(segment => ({
      ...segment,
      cameraMovement: PROMPT_WIZARD_SAFE_CAMERA_MOVEMENT,
    })),
  };
  try {
    const parsedCandidate = promptWizardPlanDraftSchema.parse(structuredClone(candidate));
    if (JSON.stringify(parsedCandidate) !== JSON.stringify(candidate)) return null;
    assertPromptWizardMotionDensity({
      shots: candidate.segments,
      durationSeconds: configSnapshot.durationSeconds,
    });
    assertPromptWizardShotExecutionBudget({
      shots: candidate.segments,
      config: configSnapshot,
      deliveryVersion: 6,
    });
  } catch {
    return null;
  }
  return {
    draft: candidate,
    segmentIndex,
    issue: currentIssue,
  };
}

function promptWizardV6MotionRepairCameraBudgetFallbackScope(input: {
  error: unknown;
  source: PromptWizardV6MotionRepairSourceSnapshot | null;
  contentRepairRequestCount: number;
}) {
  return input.contentRepairRequestCount
      === PROMPT_WIZARD_V6_SAFE_FALLBACK_MIN_CONTENT_REPAIR_REQUESTS
    && input.error instanceof PromptWizardExecutionBudgetError
    && Boolean(input.source)
    && promptWizardV6MotionRepairSourceSegmentIndex(
      input.source,
      input.source?.previousDraft.segments.length ?? 0,
    ) !== null;
}

function logPromptWizardSafeV6MotionRepairCameraBudgetFallback(
  planIndex: PromptWizardPlanIndex,
  result: PromptWizardV6MotionRepairCameraBudgetFallbackResult,
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-v6-safe-motion-repair-camera-budget-fallback',
    planIndex,
    segmentIndex: result.segmentIndex,
    repairRounds,
    issue: result.issue,
  }));
}

interface PromptWizardV6SafeFormatRecoveryCameraBudgetFallbackResult {
  draft: PromptWizardPlanDraft;
  issue: Pick<PromptWizardExecutionBudgetIssue,
    'code' | 'fieldPath' | 'actual' | 'limit'>;
}

/**
 * T174019Z 的真实 A28 只暴露一个格式恢复后领域错误：西班牙语 10 秒稿件
 * 已成功恢复为合法 Flat JSON，但三个镜头内被识别出四种运镜。格式恢复稿
 * 不得再消耗内容修复请求，因此这里只允许该完整证据形状，把纯运镜字段
 * 原子统一为既有安全缓慢推近；商品事实、动作、口播、译文和 CTA 均不改。
 * 任一身份、时长、语言、计数、路径或预算值不一致都继续失败关闭。
 */
function promptWizardSafeV6Spanish10sFormatRecoveryCameraBudgetFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  targetLanguage: string;
  config: PromptWizardVideoConfig;
  formatRecovered: boolean;
  contentRepairRequestCount: number;
}): PromptWizardV6SafeFormatRecoveryCameraBudgetFallbackResult | null {
  if (
    !input.formatRecovered
    || input.contentRepairRequestCount !== 0
    || input.targetLanguage !== '西班牙语'
    || input.config.model !== 'seedance-2.0-fast'
    || input.config.aspectRatio !== '9:16'
    || input.config.resolution !== '720p'
    || input.config.durationSeconds !== 10
    || input.draft.segments.length !== 3
    || !(input.error instanceof PromptWizardExecutionBudgetError)
    || input.error.issues.length !== 1
  ) return null;
  const issue = input.error.issues[0]!;
  if (
    issue.code !== 'TOO_MANY_CAMERA_MOVES'
    || issue.fieldPath !== 'segments'
    || issue.actual !== 4
    || issue.limit !== 3
  ) return null;
  return {
    issue: {
      code: issue.code,
      fieldPath: issue.fieldPath,
      actual: issue.actual,
      limit: issue.limit,
    },
    draft: {
      ...input.draft,
      segments: input.draft.segments.map(segment => ({
        ...segment,
        cameraMovement: PROMPT_WIZARD_SAFE_CAMERA_MOVEMENT,
      })),
    },
  };
}

function logPromptWizardSafeV6Spanish10sFormatRecoveryCameraBudgetFallback(
  planIndex: PromptWizardPlanIndex,
  result: PromptWizardV6SafeFormatRecoveryCameraBudgetFallbackResult,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-v6-safe-format-recovery-camera-budget-fallback',
    planIndex,
    issue: result.issue,
  }));
}

interface PromptWizardSafeExecutionCombinationResult {
  draft: PromptWizardPlanDraft;
  actionLimit: number;
  issueCodes: Array<'TOO_MANY_ACTIONS' | 'TOO_MANY_CAMERA_MOVES'>;
}

/**
 * 两轮模型修复后，动作族与运镜族可能同时超限。单项回退会因为错误中还含
 * 另一类问题而拒绝执行，因此这里仅对这两个已知预算错误做组合收口：动作
 * 复用已确认的场景动作与自证动作，运镜统一为持续推近。其他预算问题仍然
 * 失败，避免把人物、地点或道具风险静默吞掉。
 */
function promptWizardSafeExecutionCombinationFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  context: PromptWizardUseDirectionPlanContext;
  repairRounds: number;
}): PromptWizardSafeExecutionCombinationResult | null {
  if (
    input.repairRounds < PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    || errorCode(input.error) !== 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED'
    || !input.error
    || typeof input.error !== 'object'
  ) return null;
  const issues = (input.error as { issues?: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const safeIssues = issues.map(issue => {
    if (!issue || typeof issue !== 'object') return null;
    const candidate = issue as Record<string, unknown>;
    if (
      !['TOO_MANY_ACTIONS', 'TOO_MANY_CAMERA_MOVES'].includes(String(candidate.code))
      || candidate.fieldPath !== 'segments'
      || !Number.isSafeInteger(candidate.actual)
      || !Number.isSafeInteger(candidate.limit)
      || (candidate.actual as number) <= (candidate.limit as number)
      || (candidate.limit as number) < 1
    ) return null;
    return {
      code: candidate.code as 'TOO_MANY_ACTIONS' | 'TOO_MANY_CAMERA_MOVES',
      limit: candidate.limit as number,
    };
  });
  if (safeIssues.some(issue => issue === null)) return null;
  const issueCodes = [...new Set(safeIssues.map(issue => issue!.code))];
  if (
    !issueCodes.includes('TOO_MANY_ACTIONS')
    || !issueCodes.includes('TOO_MANY_CAMERA_MOVES')
  ) return null;
  const actionLimit = Math.min(...safeIssues
    .filter(issue => issue!.code === 'TOO_MANY_ACTIONS')
    .map(issue => issue!.limit));
  const stabilized = stabilizePromptWizardUseDirectionMajorActions({
    draft: input.draft,
    context: input.context,
    maxActionFamilies: actionLimit,
  });
  return {
    actionLimit,
    issueCodes,
    draft: {
      ...stabilized,
      segments: stabilized.segments.map(segment => ({
        ...segment,
        cameraMovement: PROMPT_WIZARD_SAFE_CAMERA_MOVEMENT,
      })),
    },
  };
}

function logPromptWizardSafeExecutionCombinationFallback(
  planIndex: PromptWizardPlanIndex,
  result: PromptWizardSafeExecutionCombinationResult,
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-execution-combination-fallback',
    planIndex,
    issueCodes: result.issueCodes,
    actionLimit: result.actionLimit,
    repairRounds,
  }));
}

type PromptWizardV6SafeExecutionBudgetIssueCode =
  | 'TOO_MANY_LOCATIONS'
  | 'TOO_MANY_PROPS'
  | 'TOO_MANY_CAMERA_MOVES';

interface PromptWizardV6SafeExecutionBudgetFallbackResult {
  draft: PromptWizardPlanDraft;
  issues: Array<Pick<PromptWizardExecutionBudgetIssue,
    'code' | 'fieldPath' | 'actual' | 'limit'>>;
  issueCodes: PromptWizardV6SafeExecutionBudgetIssueCode[];
}

const PROMPT_WIZARD_V6_SAFE_EXECUTION_BUDGET_ISSUE_CODES = new Set<
  PromptWizardV6SafeExecutionBudgetIssueCode
>([
  'TOO_MANY_LOCATIONS',
  'TOO_MANY_PROPS',
  'TOO_MANY_CAMERA_MOVES',
]);

/**
 * V6 两轮定向修复耗尽后，只对不改变商业语义的执行预算漂移做终态收口：
 * 地点统一到已锁定场景，道具仅删除 Provider 新增的辅助物，运镜统一为单一
 * 缓慢推近。人物、主要动作、魔法变化或未知问题一律失败关闭，不能仅凭
 * `code + segments` 猜测并吞掉风险。口播、译文、证据、CTA 与叙事均不改写，
 * 收口结果仍必须重新通过完整 V6 编译门禁。
 */
function promptWizardSafeV6ExecutionBudgetFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  context: PromptWizardUseDirectionPlanContext;
  profile: PromptWizardProductProfile;
  repairRounds: number;
}): PromptWizardV6SafeExecutionBudgetFallbackResult | null {
  if (
    input.repairRounds < PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    || !(input.error instanceof PromptWizardExecutionBudgetError)
    || input.error.issues.length === 0
  ) return null;

  const safeIssues = input.error.issues.map(issue => {
    if (
      !PROMPT_WIZARD_V6_SAFE_EXECUTION_BUDGET_ISSUE_CODES.has(
        issue.code as PromptWizardV6SafeExecutionBudgetIssueCode,
      )
      || issue.fieldPath !== 'segments'
      || !Number.isSafeInteger(issue.actual)
      || !Number.isSafeInteger(issue.limit)
      || (issue.actual as number) <= (issue.limit as number)
      || (issue.limit as number) < 1
    ) return null;
    return {
      code: issue.code as PromptWizardV6SafeExecutionBudgetIssueCode,
      fieldPath: issue.fieldPath,
      actual: issue.actual as number,
      limit: issue.limit as number,
    };
  });
  if (safeIssues.some(issue => issue === null)) return null;

  const issueCodes = [...new Set(safeIssues.map(issue => issue!.code))];
  let draft = input.draft;
  if (issueCodes.includes('TOO_MANY_LOCATIONS')) {
    draft = {
      ...draft,
      primaryScene: `${input.context.selectedScene.title}｜${input.context.selectedScene.environment}`,
      segments: draft.segments.map(segment => ({
        ...segment,
        location: input.context.selectedScene.environment,
      })),
    };
  }
  if (issueCodes.includes('TOO_MANY_PROPS')) {
    const appearanceMode = input.context.useDirection.appearanceMode;
    const safeSubject = appearanceMode === 'product-only'
      ? `@图片1中的${input.profile.productName}`
      : appearanceMode === 'hands-only'
        ? `@图片1中的${input.profile.productName}与操作手部`
        : `@图片1中的${input.profile.productName}与单一使用者`;
    draft = {
      ...draft,
      segments: draft.segments.map(segment => ({
        ...segment,
        subject: safeSubject,
        productionNote: '保持产品外观、结构、Logo 与参考图片一致，不新增场景道具',
      })),
    };
  }
  if (issueCodes.includes('TOO_MANY_CAMERA_MOVES')) {
    draft = {
      ...draft,
      segments: draft.segments.map(segment => ({
        ...segment,
        cameraMovement: PROMPT_WIZARD_SAFE_CAMERA_MOVEMENT,
      })),
    };
  }

  return {
    draft,
    issues: safeIssues.map(issue => ({ ...issue! })),
    issueCodes,
  };
}

function logPromptWizardSafeV6ExecutionBudgetFallback(
  planIndex: PromptWizardPlanIndex,
  result: PromptWizardV6SafeExecutionBudgetFallbackResult,
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-v6-safe-execution-budget-fallback',
    planIndex,
    repairRounds,
    issues: result.issues,
  }));
}

function promptWizardExecutionBudgetIssues(error: unknown) {
  if (!(error instanceof PromptWizardExecutionBudgetError)) return [];
  return error.issues.map(issue => ({
    code: issue.code,
    fieldPath: issue.fieldPath,
    actual: issue.actual,
    limit: issue.limit,
  }));
}

function logPromptWizardV6TerminalValidationFailure(input: {
  errorsByPlan: ReadonlyMap<PromptWizardPlanIndex, unknown>;
  repairRounds: number;
  config: PromptWizardVideoConfig;
}) {
  if (env.NODE_ENV !== 'production') return;
  const failures = [...input.errorsByPlan.entries()].map(([planIndex, error]) => ({
    planIndex,
    code: errorCode(error),
    fieldPaths: promptWizardSafeFieldPaths(error),
    executionBudgetIssues: promptWizardExecutionBudgetIssues(error),
  }));
  console.warn(JSON.stringify({
    event: 'prompt-wizard-v6-terminal-validation-failed',
    repairRounds: input.repairRounds,
    model: input.config.model,
    durationSeconds: input.config.durationSeconds,
    failures,
  }));
}

function promptWizardSafeUseDirectionActionFallback(
  error: unknown,
  fieldPaths: string[],
  repairRounds: number,
) {
  const allowed = new Set(['primaryScene', 'segments']);
  return repairRounds >= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    && errorCode(error) === 'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID'
    && fieldPaths.length > 0
    && fieldPaths.includes('segments')
    && fieldPaths.every(fieldPath => allowed.has(fieldPath));
}

/**
 * V5/V6 共用的场景一致性终态收口。这里只复用路线集合中已经确认的场景
 * 标题、环境和主动作，不生成新事实，也不改写口播、证据或商业理由。调用方
 * 必须在模型修复额度耗尽且错误路径仅为 primaryScene/segments 时使用，并在
 * 写回后重新运行完整编译门禁。
 */
function stabilizePromptWizardUseDirectionSceneContext(input: {
  draft: PromptWizardPlanDraft;
  context: PromptWizardUseDirectionPlanContext;
  maxActionFamilies?: number;
}) {
  const stabilized = stabilizePromptWizardUseDirectionMajorActions({
    draft: input.draft,
    context: input.context,
    ...(input.maxActionFamilies === undefined
      ? {}
      : { maxActionFamilies: input.maxActionFamilies }),
  });
  return {
    ...stabilized,
    primaryScene: `${input.context.selectedScene.title}｜${input.context.selectedScene.environment}`,
    segments: stabilized.segments.map(segment => ({
      ...segment,
      location: input.context.selectedScene.environment,
    })),
  };
}

function promptWizardSafeUseDirectionNarrativeFallback(
  error: unknown,
  fieldPaths: string[],
  repairRounds: number,
  options: { allowImmediateServerOwnedFallback?: boolean } = {},
) {
  return (
    options.allowImmediateServerOwnedFallback
    || repairRounds >= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
  )
    && errorCode(error) === 'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID'
    && fieldPaths.length === 1
    && fieldPaths[0] === 'narrative';
}

function stabilizePromptWizardUseDirectionNarrative(input: {
  draft: PromptWizardPlanDraft;
  context: PromptWizardUseDirectionPlanContext;
}) {
  return {
    ...input.draft,
    narrative: `围绕“${input.context.useDirection.purchaseReason}”展开，在${
      input.context.selectedScene.title
    }通过${input.context.useDirection.proofAction}完成产品自证，最后引导点击商品卡。`,
  };
}

function logPromptWizardSafeUseDirectionNarrativeFallback(
  planIndex: PromptWizardPlanIndex,
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-use-direction-narrative-fallback',
    planIndex,
    repairRounds,
  }));
}

function logPromptWizardSafeUseDirectionActionFallback(
  planIndex: PromptWizardPlanIndex,
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-use-direction-action-fallback',
    planIndex,
    repairRounds,
  }));
}

function promptWizardSafeDifferenceTagIndexes(
  error: unknown,
  fieldPaths: string[],
  tagCount: number,
  repairRounds: number,
  options: { allowImmediateContentLanguageFallback?: boolean } = {},
) {
  const code = errorCode(error);
  const canRunImmediately = Boolean(
    options.allowImmediateContentLanguageFallback
    && code === 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
  );
  if (
    (!canRunImmediately && repairRounds < PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS)
    || ![
      'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
      'PROMPT_WIZARD_REFERENCE_MODE_INVALID',
    ].includes(code)
    || fieldPaths.length === 0
  ) {
    return null;
  }
  const indexes = fieldPaths.map(fieldPath => {
    const match = /^differenceTags\[(\d)\]$/u.exec(fieldPath);
    if (!match) return null;
    const index = Number(match[1]);
    return Number.isSafeInteger(index) && index >= 0 && index < tagCount && index < 6
      ? index
      : null;
  });
  if (indexes.some(index => index === null)) return null;
  return [...new Set(indexes as number[])];
}

function promptWizardControlledDifferenceTags(
  variant: PromptWizardUseDirectionPlanContext['variant'],
) {
  return variant === 'reliable'
    ? ['持续动作演示', '稳定跟随视角', '动作点剪辑', '直接购买收束', '直接证据自证', '真实场景成交']
    : ['第一秒状态揭晓', '动态近景视角', '快速揭晓', '购买行动回扣', '直接证据自证', '真实场景成交'];
}

/**
 * 两轮模型修复后，参考模式门禁可能同时命中任意多个展示或执行字段。
 * 对整个结构化 Draft 只做“首帧/尾帧 → 开场/收尾画面”的精确、幂等替换；
 * 不删除或新增产品事实，随后仍须重新经过完整渲染与全部门禁。
 */
function promptWizardSafeReferenceMetadataFallback(input: {
  error: unknown;
  fieldPaths: string[];
  draft: PromptWizardPlanDraft;
  variant: PromptWizardUseDirectionPlanContext['variant'];
  repairRounds: number;
}) {
  if (
    input.repairRounds < PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    || errorCode(input.error) !== 'PROMPT_WIZARD_REFERENCE_MODE_INVALID'
    || input.fieldPaths.length === 0
  ) return null;
  const normalizedDraft = normalizePromptWizardReferenceDraftValue(input.draft);
  const tagIndexes = new Set(input.fieldPaths.flatMap(fieldPath => {
    const match = /^differenceTags\[(\d{1,2})\]$/u.exec(fieldPath);
    if (!match) return [];
    const index = Number(match[1]);
    return Number.isSafeInteger(index)
      && index >= 0
      && index < normalizedDraft.differenceTags.length
      ? [index]
      : [];
  }));
  if (tagIndexes.size === 0) return normalizedDraft;

  const controlledTags = promptWizardControlledDifferenceTags(input.variant);
  const usedTags = new Set(normalizedDraft.differenceTags
    .filter((_, index) => !tagIndexes.has(index))
    .map(tag => tag.normalize('NFKC').trim()));
  return {
    ...normalizedDraft,
    differenceTags: normalizedDraft.differenceTags.map((tag, index) => {
      if (!tagIndexes.has(index)) return tag;
      const candidates = [controlledTags[index], ...controlledTags]
        .filter((candidate): candidate is string => Boolean(candidate));
      const replacement = candidates.find(candidate => (
        !usedTags.has(candidate.normalize('NFKC').trim())
      )) ?? controlledTags.at(-1)!;
      usedTags.add(replacement.normalize('NFKC').trim());
      return replacement;
    }),
  };
}

function logPromptWizardSafeReferenceMetadataFallback(
  planIndex: PromptWizardPlanIndex,
  fieldPaths: string[],
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-reference-metadata-fallback',
    planIndex,
    fieldPaths,
    repairRounds,
  }));
}

function logPromptWizardSafeDifferenceTagFallback(
  planIndex: PromptWizardPlanIndex,
  tagIndexes: number[],
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-difference-tag-fallback',
    planIndex,
    tagIndexes,
    repairRounds,
  }));
}

function mergePromptWizardContentRepairIssue(
  issues: Map<PromptWizardPlanIndex, PromptWizardContentRepairIssue>,
  issue: PromptWizardContentRepairIssue,
) {
  const current = issues.get(issue.planIndex);
  if (!current) {
    issues.set(issue.planIndex, issue);
    return;
  }
  issues.set(issue.planIndex, {
    planIndex: issue.planIndex,
    ...(current.referencePlanIndex !== undefined
      ? { referencePlanIndex: current.referencePlanIndex }
      : issue.referencePlanIndex !== undefined
        ? { referencePlanIndex: issue.referencePlanIndex }
        : {}),
    errorCode: current.errorCode === issue.errorCode
      ? current.errorCode
      : 'PROMPT_WIZARD_CONTENT_REPAIR_REQUIRED',
    fieldPaths: Array.from(new Set([...current.fieldPaths, ...issue.fieldPaths])).slice(0, 24),
    action: Array.from(new Set([current.action, issue.action])).join('；'),
  });
}

function preferPromptWizardTerminalContentError(current: unknown, next: unknown) {
  if (!current) return next;
  if (errorCode(next) === 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID') return next;
  return current;
}

function isUnrepairableFinalPromptError(error: unknown) {
  // prompt 是服务端确定性渲染后的最终产物，通常由历史产品档案或固定约束触发。
  // Draft 修复无法改变这部分内容，因此任何命中 prompt 的错误都必须直接终态失败。
  return promptWizardRawFieldPaths(error).includes('prompt');
}

function promptWizardDiversityRepairFieldPaths(draft: PromptWizardPlanDraft) {
  return [
    'name',
    'hook',
    'narrative',
    'primaryScene',
    'cameraAndPacing',
    ...draft.differenceTags.map((_, index) => `differenceTags[${index}]`),
    'planningReview.realPainPoint',
    'planningReview.nonAdEntry',
    'planningReview.directionFit',
    ...draft.segments.flatMap((_, index) => [
      `segments[${index}].location`,
      `segments[${index}].action`,
    ]),
  ].slice(0, 24);
}

/**
 * V6 的名称、摘要、场景、节奏摘要、标签、预审和镜头结构元数据均由服务端
 * 锁定。集合/历史差异修复只允许改写模型真正拥有的表达轴；主要产品动作也
 * 由路线动作预算收口，所以只有 CTA 镜头的 action 可以进入修复范围。
 */
function promptWizardV6DiversityRepairFieldPaths(draft: PromptWizardPlanDraft) {
  const fieldPaths = [
    ...draft.segments.flatMap((_, index) => [
      `segments[${index}].shotSize`,
      `segments[${index}].cameraMovement`,
      `segments[${index}].lightingAndRealism`,
      `segments[${index}].foley`,
      `segments[${index}].editingCue`,
    ]),
  ];
  const ctaIndex = draft.segments.findIndex(segment => segment.role === 'cta');
  if (ctaIndex >= 0) {
    fieldPaths.push(
      `segments[${ctaIndex}].action`,
      `segments[${ctaIndex}].voiceover`,
      `segments[${ctaIndex}].voiceoverZh`,
    );
  }
  return [...new Set(fieldPaths)].slice(0, 24);
}

function promptWizardMissingUseDirectionDifferenceDimensions(
  analysis: PromptWizardUseDirectionDifferenceAnalysis,
): PromptWizardSafeDiversityDimension[] {
  return (['openingEvent', 'perspective', 'pacing', 'cta'] as const)
    .filter(dimension => !analysis[dimension]);
}

function promptWizardDifferenceDimensionLabels(
  analysis: PromptWizardUseDirectionDifferenceAnalysis,
) {
  const labels: Record<PromptWizardSafeDiversityDimension, string> = {
    openingEvent: '第一秒物理事件',
    perspective: '首镜头观看视角',
    pacing: '节奏与剪辑类别',
    cta: '结尾 CTA 动作与口播回扣',
  };
  return promptWizardMissingUseDirectionDifferenceDimensions(analysis)
    .map(dimension => labels[dimension]);
}

function findPromptWizardSafeV5DiversityFallback(input: {
  hookDraft: PromptWizardPlanDraft;
  reliablePlan: PromptWizardPlanV5;
  hookContext: PromptWizardUseDirectionPlanContext;
  config: PromptWizardVideoConfig;
  historicalPlans: PromptWizardPlan[];
  renderHook: (draft: PromptWizardPlanDraft) => PromptWizardPlanV5;
  before: PromptWizardUseDirectionDifferenceAnalysis;
}) {
  const preferredOrder: PromptWizardSafeDiversityDimension[] = [
    'pacing',
    'perspective',
    'cta',
    'openingEvent',
  ];
  interface SearchState {
    draft: PromptWizardPlanDraft;
    analysis: PromptWizardUseDirectionDifferenceAnalysis;
    dimensions: PromptWizardSafeDiversityDimension[];
    candidateOrdinals: number[];
  }
  let states: SearchState[] = [{
    draft: input.hookDraft,
    analysis: input.before,
    dimensions: [],
    candidateOrdinals: [],
  }];
  const visited = new Set<string>();
  for (let depth = 0; depth < preferredOrder.length; depth += 1) {
    const nextStates: SearchState[] = [];
    for (const state of states) {
      const missing = new Set(
        promptWizardMissingUseDirectionDifferenceDimensions(state.analysis),
      );
      for (const dimension of preferredOrder) {
        if (!missing.has(dimension) || state.dimensions.includes(dimension)) continue;
        const candidates = buildPromptWizardSafeHookDiversityCandidates({
          draft: state.draft,
          dimension,
          context: input.hookContext,
          config: input.config,
        });
        for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
          const candidate = candidates[candidateIndex]!;
          try {
            const plan = input.renderHook(candidate);
            const after = analyzePromptWizardUseDirectionPlanDifferences(
              input.reliablePlan,
              plan,
            );
            if (after.count <= state.analysis.count) continue;
            const dimensions = [...state.dimensions, dimension];
            const candidateOrdinals = [...state.candidateOrdinals, candidateIndex + 1];
            if (after.count >= 3) {
              const candidatePlans: PromptWizardPlan[] = [input.reliablePlan, plan];
              if (
                validatePromptWizardPlanDiversity(candidatePlans).length === 0
                && validatePromptWizardPlanHistory(candidatePlans, input.historicalPlans).length === 0
              ) {
                return {
                  draft: candidate,
                  plan,
                  dimensions,
                  candidateOrdinals,
                  after,
                };
              }
              continue;
            }
            const signature = JSON.stringify({
              dimensions,
              cameraAndPacing: candidate.cameraAndPacing,
              first: candidate.segments[0],
              last: candidate.segments.at(-1),
              editingCues: candidate.segments.map(segment => segment.editingCue),
            });
            if (visited.has(signature)) continue;
            visited.add(signature);
            nextStates.push({
              draft: candidate,
              analysis: after,
              dimensions,
              candidateOrdinals,
            });
          } catch {
            // 每个中间候选也必须通过完整单稿门禁；失败时只尝试下一受控候选。
          }
        }
      }
    }
    states = nextStates
      .sort((left, right) => right.analysis.count - left.analysis.count)
      .slice(0, 24);
    if (states.length === 0) break;
  }
  return null;
}

function logPromptWizardSafeV5DiversityFallback(input: {
  dimensions: PromptWizardSafeDiversityDimension[];
  candidateOrdinals: number[];
  before: PromptWizardUseDirectionDifferenceAnalysis;
  after: PromptWizardUseDirectionDifferenceAnalysis;
  repairRounds: number;
}) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-v5-diversity-fallback',
    planIndex: 1,
    repairRounds: input.repairRounds,
    dimensions: input.dimensions,
    beforeCount: input.before.count,
    afterCount: input.after.count,
    candidateOrdinals: input.candidateOrdinals,
    outcome: 'accepted',
  }));
}

function promptWizardUseDirectionDiversityRepairFieldPaths(
  draft: PromptWizardPlanDraft,
  missingDimensions: PromptWizardSafeDiversityDimension[],
) {
  const lastSegmentIndex = Math.max(0, draft.segments.length - 1);
  const fieldPaths = missingDimensions.flatMap(dimension => {
    if (dimension === 'openingEvent') return ['segments[0].action'];
    if (dimension === 'perspective') {
      return [
        'segments[0].subject',
        'segments[0].shotSize',
        'segments[0].cameraMovement',
      ];
    }
    if (dimension === 'pacing') {
      return [
        'cameraAndPacing',
        ...draft.segments.map((_, index) => `segments[${index}].editingCue`),
      ];
    }
    return [
      `segments[${lastSegmentIndex}].action`,
      `segments[${lastSegmentIndex}].voiceover`,
      `segments[${lastSegmentIndex}].voiceoverZh`,
    ];
  });
  return [...new Set(fieldPaths)].slice(0, 24);
}

function promptWizardRawFieldPaths(error: unknown) {
  if (!error || typeof error !== 'object') return [];
  const value = (error as { fieldPaths?: unknown }).fieldPaths;
  return Array.isArray(value)
    ? value.filter((fieldPath): fieldPath is string => typeof fieldPath === 'string')
    : [];
}

function toPromptWizardPlanIndex(value: number): PromptWizardPlanIndex {
  if (isPromptWizardPlanIndex(value)) return value;
  throw Object.assign(new Error('方案索引必须是 0、1 或 2'), {
    code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
  });
}

function mergePromptWizardProviderUsage(
  current: PromptWizardProviderUsage | null,
  next: PromptWizardProviderUsage,
): PromptWizardProviderUsage {
  if (!current) return next;
  return {
    ...next,
    inputTokens: mergeCompletePromptWizardTokenCount(
      current.inputTokens,
      next.inputTokens,
    ),
    outputTokens: mergeCompletePromptWizardTokenCount(
      current.outputTokens,
      next.outputTokens,
    ),
    requestAttempts: current.requestAttempts + next.requestAttempts,
    serviceTier: mergePromptWizardServiceTier(current.serviceTier, next.serviceTier),
  };
}

interface PromptWizardV6RepairState {
  contentRepairRequestCounts: PromptWizardV6PlanRequestCounts;
  terminalCalibrationRequestCounts: PromptWizardV6PlanRequestCounts;
  repairDiagnostics: PromptWizardRepairDiagnostic[];
  outputDiagnostics: PromptWizardOutputDiagnostic[];
}

function promptWizardSafeRepairDiagnosticFieldPath(value: string) {
  return /^(?:name|hook|narrative|primaryScene|cameraAndPacing|prompt|verifiedOffer|differenceTags(?:\[\d{1,2}\])?|planningReview(?:\.(?:targetAudience|surfaceNeed|realPainPoint|nonAdEntry|directionFit|proofPoints\[\d{1,2}\]))?|segments|segments\[\d{1,2}\]\.(?:role|location|subject|shotSize|action|cameraMovement|lightingAndRealism|voiceover|voiceoverZh|foley|editingCue|evidenceRefs(?:\[\d{1,2}\])?|productionNote)|productionWarnings(?:\[\d{1,2}\])?)$/u.test(value);
}

function promptWizardSafeRepairDiagnostics(value: unknown): PromptWizardRepairDiagnostic[] {
  if (!Array.isArray(value)) return [];
  const diagnostics: PromptWizardRepairDiagnostic[] = [];
  const identities = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const diagnostic = candidate as Record<string, unknown>;
    const planIndex = diagnostic.planIndex;
    const origin = diagnostic.origin;
    const repairRound = diagnostic.repairRound;
    const errorCodeValue = diagnostic.errorCode;
    const fieldPathsValue = diagnostic.fieldPaths;
    if (
      typeof planIndex !== 'number'
      || !isPromptWizardPlanIndex(planIndex)
      || (
        origin !== 'initial-schema'
        && origin !== 'domain-validation'
        && origin !== 'terminal-calibration'
      )
      || (repairRound !== 1 && repairRound !== 2 && repairRound !== 3)
      || typeof errorCodeValue !== 'string'
      || !PROMPT_WIZARD_REPAIR_DIAGNOSTIC_ERROR_CODES.has(errorCodeValue)
      || !Array.isArray(fieldPathsValue)
      || fieldPathsValue.length > 24
    ) continue;
    const fieldPaths = Array.from(new Set(fieldPathsValue.filter(
      (fieldPath): fieldPath is string => (
        typeof fieldPath === 'string'
        && promptWizardSafeRepairDiagnosticFieldPath(fieldPath)
      ),
    )));
    if (fieldPaths.length !== fieldPathsValue.length) continue;
    const identity = `${planIndex}#${origin}#${repairRound}`;
    if (identities.has(identity)) continue;
    identities.add(identity);
    diagnostics.push({
      planIndex,
      origin,
      repairRound,
      errorCode: errorCodeValue,
      fieldPaths,
    });
    if (diagnostics.length >= 12) break;
  }
  return diagnostics;
}

const PROMPT_WIZARD_OUTPUT_DIAGNOSTIC_KEYS = [
  'classification',
  'containerDepthBucket',
  'fieldPaths',
  'normalizationMode',
  'operation',
  'outputLengthBucket',
  'outputTextSource',
  'phase',
  'planIndex',
  'schemaIssue',
  'stage',
] as const;

const PROMPT_WIZARD_OUTPUT_SCHEMA_ISSUES = new Set<PromptWizardOutputSchemaIssue>([
  'not-applicable',
  'keyset',
  'count',
  'unit',
  'secondary-source',
  'translation',
  'wire-shape',
]);

function promptWizardOutputDiagnosticStageMatchesOperation(
  operation: PromptWizardOutputDiagnostic['operation'],
  stage: PromptWizardOutputDiagnostic['stage'],
) {
  return (
    (operation === 'generate-drafts' && stage === 'initial')
    || (operation === 'repair-draft-format' && stage === 'format-recovery')
    || (operation === 'repair-draft-content' && stage === 'content-repair')
    || (operation === 'refine-plan' && stage === 'refinement')
  );
}

/**
 * Provider 输出诊断只能穿过固定枚举与既有逻辑字段路径。任何额外键都会让
 * 整组诊断失败关闭，避免未来把正文、动态错误、哈希或字节位置误带进审计。
 */
function promptWizardSafeOutputDiagnostics(value: unknown): {
  diagnostics: PromptWizardOutputDiagnostic[];
  valid: boolean;
} {
  if (value === undefined) return { diagnostics: [], valid: true };
  if (!Array.isArray(value) || value.length > 24) {
    return { diagnostics: [], valid: false };
  }
  const diagnostics: PromptWizardOutputDiagnostic[] = [];
  const identityCounts = new Map<string, number>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return { diagnostics: [], valid: false };
    }
    const diagnostic = candidate as Record<string, unknown>;
    const keys = Object.keys(diagnostic).sort();
    if (
      keys.length !== PROMPT_WIZARD_OUTPUT_DIAGNOSTIC_KEYS.length
      || keys.some((key, index) => key !== PROMPT_WIZARD_OUTPUT_DIAGNOSTIC_KEYS[index])
    ) {
      return { diagnostics: [], valid: false };
    }
    const planIndex = diagnostic.planIndex;
    const operation = diagnostic.operation;
    const stage = diagnostic.stage;
    const phase = diagnostic.phase;
    const classification = diagnostic.classification;
    const normalizationMode = diagnostic.normalizationMode;
    const outputLengthBucket = diagnostic.outputLengthBucket;
    const containerDepthBucket = diagnostic.containerDepthBucket;
    const outputTextSource = diagnostic.outputTextSource;
    const schemaIssue = diagnostic.schemaIssue;
    const fieldPathsValue = diagnostic.fieldPaths;
    if (
      typeof planIndex !== 'number'
      || !isPromptWizardPlanIndex(planIndex)
      || (
        operation !== 'generate-drafts'
        && operation !== 'repair-draft-format'
        && operation !== 'repair-draft-content'
        && operation !== 'refine-plan'
      )
      || (
        stage !== 'initial'
        && stage !== 'format-recovery'
        && stage !== 'content-repair'
        && stage !== 'refinement'
      )
      || !promptWizardOutputDiagnosticStageMatchesOperation(operation, stage)
      || (phase !== 'parse' && phase !== 'schema' && phase !== 'decoded')
      || typeof schemaIssue !== 'string'
      || !PROMPT_WIZARD_OUTPUT_SCHEMA_ISSUES.has(
        schemaIssue as PromptWizardOutputSchemaIssue,
      )
      || (phase === 'schema') === (schemaIssue === 'not-applicable')
      || (
        classification !== 'valid-json'
        && classification !== 'non-json'
        && classification !== 'string-truncated'
        && classification !== 'escape-truncated'
        && classification !== 'container-truncated'
        && classification !== 'bracket-mismatch'
        && classification !== 'multiple-root-values'
        && classification !== 'invalid-token'
        && classification !== 'unknown'
      )
      || (
        normalizationMode !== 'native'
        && normalizationMode !== 'fence-removed'
        && normalizationMode !== 'control-character-escaped'
        && normalizationMode !== 'single-object-extracted'
        && normalizationMode !== 'lexical-repair'
        && normalizationMode !== 'append-closing-delimiters'
        && normalizationMode !== 'none'
      )
      || (
        outputLengthBucket !== 'empty'
        && outputLengthBucket !== '1-2048'
        && outputLengthBucket !== '2049-8192'
        && outputLengthBucket !== '8193-32768'
        && outputLengthBucket !== '32769-64000'
        && outputLengthBucket !== 'over-64000'
      )
      || (
        containerDepthBucket !== '0'
        && containerDepthBucket !== '1-4'
        && containerDepthBucket !== '5-8'
        && containerDepthBucket !== '9-16'
        && containerDepthBucket !== 'over-16'
      )
      || (
        outputTextSource !== 'completed'
        && outputTextSource !== 'streamed-fallback'
        && outputTextSource !== 'existing-compatible'
      )
      || !Array.isArray(fieldPathsValue)
      || fieldPathsValue.length > 24
    ) {
      return { diagnostics: [], valid: false };
    }
    const fieldPaths = fieldPathsValue.filter((fieldPath): fieldPath is string => (
      typeof fieldPath === 'string'
      && promptWizardSafeRepairDiagnosticFieldPath(fieldPath)
    ));
    if (fieldPaths.length !== fieldPathsValue.length || new Set(fieldPaths).size !== fieldPaths.length) {
      return { diagnostics: [], valid: false };
    }
    const identity = JSON.stringify([
      planIndex,
      operation,
      stage,
      phase,
      classification,
      normalizationMode,
      outputLengthBucket,
      containerDepthBucket,
      outputTextSource,
      schemaIssue,
      fieldPaths,
    ]);
    const identityCount = identityCounts.get(identity) ?? 0;
    const identityLimit = operation === 'repair-draft-content' ? 2 : 1;
    if (identityCount >= identityLimit) return { diagnostics: [], valid: false };
    identityCounts.set(identity, identityCount + 1);
    diagnostics.push({
      planIndex,
      operation,
      stage,
      phase,
      classification,
      normalizationMode,
      outputLengthBucket,
      containerDepthBucket,
      outputTextSource,
      schemaIssue: schemaIssue as PromptWizardOutputSchemaIssue,
      fieldPaths,
    });
  }
  return { diagnostics, valid: true };
}

function promptWizardOutputFormatAnomalyCount(
  diagnostics: readonly PromptWizardOutputDiagnostic[],
) {
  return diagnostics.filter(diagnostic => (
    diagnostic.classification !== 'valid-json'
    || diagnostic.normalizationMode !== 'native'
  )).length;
}

function promptWizardReconciledFormatAnomalyCount(input: {
  declared: unknown;
  diagnosticsWereProvided: boolean;
  diagnostics: readonly PromptWizardOutputDiagnostic[];
}) {
  const calculated = promptWizardOutputFormatAnomalyCount(input.diagnostics);
  if (
    input.declared !== undefined
    && (
      !Number.isSafeInteger(input.declared)
      || typeof input.declared !== 'number'
      || input.declared < 0
      || input.declared > 2
      || (input.diagnosticsWereProvided && input.declared !== calculated)
    )
  ) return null;
  return input.declared === undefined ? calculated : input.declared;
}

function promptWizardInitialRepairDiagnostics(input: {
  planIndex: PromptWizardPlanIndex;
  repairRounds: number;
  value: unknown;
}) {
  const diagnostics = promptWizardSafeRepairDiagnostics(input.value);
  const reconciles = (
    diagnostics.length === input.repairRounds
    && diagnostics.every((diagnostic, index) => (
      diagnostic.planIndex === input.planIndex
      && diagnostic.origin === 'initial-schema'
      && diagnostic.repairRound === index + 1
    ))
  );
  if (reconciles) return { diagnostics, reconciles: true } as const;
  // Provider 声称发生过物理 Schema 修复但诊断缺失或越过白名单时，不能
  // 返回正文或任意错误字段，也不能把计数改成 0。使用无字段路径的受控
  // 占位诊断保持失败事件逐索引可对账，调用方仍会以 Schema 错误失败关闭。
  return {
    diagnostics: Array.from({ length: input.repairRounds }, (_, index) => ({
      planIndex: input.planIndex,
      origin: 'initial-schema' as const,
      repairRound: (index + 1) as 1 | 2,
      errorCode: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      fieldPaths: [],
    })),
    reconciles: false,
  } as const;
}

function promptWizardCloneV6RepairState(
  state: PromptWizardV6RepairState,
): PromptWizardV6RepairState {
  return {
    contentRepairRequestCounts: [...state.contentRepairRequestCounts],
    terminalCalibrationRequestCounts: [...state.terminalCalibrationRequestCounts],
    repairDiagnostics: state.repairDiagnostics.map(diagnostic => ({
      ...diagnostic,
      fieldPaths: [...diagnostic.fieldPaths],
    })),
    outputDiagnostics: state.outputDiagnostics.map(diagnostic => ({
      ...diagnostic,
      fieldPaths: [...diagnostic.fieldPaths],
    })),
  };
}

function promptWizardDeepFreezeV6Snapshot<T>(
  value: T,
  seen = new WeakSet<object>(),
): T {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) {
    promptWizardDeepFreezeV6Snapshot(child, seen);
  }
  return Object.freeze(value);
}

const promptWizardV6CostOwnerSnapshotSchema = z.object({
  runId: z.string().min(1).max(200).refine(value => value.trim() === value),
  batchId: z.string().min(1).max(200).refine(value => value.trim() === value).nullable(),
  deliveryVersion: z.union([z.literal(4), z.literal(5), z.literal(6)]).optional(),
  useDirectionSetId: z.string().min(1).max(200)
    .refine(value => value.trim() === value)
    .nullable()
    .optional(),
  userId: z.string().min(1).max(200).refine(value => value.trim() === value),
  jobAttempt: z.number().int().nonnegative(),
  repairRound: z.number().int().min(0).max(3),
}).strict();

function promptWizardStrictV6IntegerSnapshot(
  value: number,
  fieldPath: 'imageCount' | 'variationKey' | 'deadlineAtMs',
  minimum: number,
  maximum: number,
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw Object.assign(new Error(`V6 ${fieldPath} 不是安全整数`), {
      code: 'PROMPT_WIZARD_PROVIDER_INPUT_INVALID',
      fieldPaths: [fieldPath],
    });
  }
  return value;
}

function attachPromptWizardOrchestrationUsage(
  error: unknown,
  usage: PromptWizardProviderUsage | null,
  repairRounds = 0,
  planIndexes: readonly number[] = [],
  v6RepairState?: PromptWizardV6RepairState,
) {
  const target = error instanceof Error ? error : new Error('提示词方案生成失败');
  const inheritedRepairRounds = promptWizardSafeRepairRounds(
    (target as { repairRounds?: unknown }).repairRounds,
  );
  const requestedRepairRounds = Number.isSafeInteger(repairRounds)
    && repairRounds >= 0
    && repairRounds <= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    ? repairRounds
    : 0;
  // Provider 内部的初始 Schema/Zod 定向修复与领域内容修复共享同一轮次预算。
  // generateDrafts 抛错时，本地变量尚未来得及接收返回值，因此必须保留错误
  // 已携带的合法轮次，不能被编排层默认值 0 覆盖。
  const safeRepairRounds = Math.max(
    inheritedRepairRounds ?? 0,
    requestedRepairRounds,
  );
  const inheritedPlanIndexesValue = (
    target as Error & { planIndexes?: unknown }
  ).planIndexes;
  const inheritedPlanIndexes = Array.isArray(inheritedPlanIndexesValue)
    ? inheritedPlanIndexesValue
    : [];
  const safePlanIndexes = Array.from(new Set(
    [...inheritedPlanIndexes, ...planIndexes].filter((value): value is PromptWizardPlanIndex => (
      typeof value === 'number' && isPromptWizardPlanIndex(value)
    )),
  ));
  const orchestrationMetadata = {
    repairRounds: safeRepairRounds,
    ...(safePlanIndexes.length > 0 ? { planIndexes: safePlanIndexes } : {}),
    ...(v6RepairState ? promptWizardCloneV6RepairState(v6RepairState) : {}),
  };
  if (!usage) return Object.assign(target, orchestrationMetadata);
  return Object.assign(target, {
    model: usage.model,
    responseId: usage.interactionId,
    providerRequestAttempted: true,
    usage: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
    },
    ...orchestrationMetadata,
  });
}

function promptWizardSafeRepairRounds(value: unknown): number | null {
  return Number.isSafeInteger(value)
    && typeof value === 'number'
    && value >= 0
    && value <= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    ? value
    : null;
}

export async function generateValidatedPromptWizardRoutePlansV6(input: {
  provider: PromptWizardProvider;
  profile: PromptWizardProductProfile;
  evidenceGraph: PromptWizardEvidenceGraph;
  voiceoverLanguage?: string;
  verifiedOffer: string;
  config: PromptWizardVideoConfig;
  routeSet: PromptWizardRouteSetV6;
  imageCount: number;
  variationKey: number;
  deadlineAtMs: number;
  historicalPlans: PromptWizardPlan[];
  /** 生产批次必传；Canary 直连 Provider 时可不写成本账本。 */
  costOwner?: PromptWizardCostOwner;
}): Promise<GenerateValidatedPromptWizardRoutePlansV6Result> {
  // Provider test doubles run across await boundaries. Keep one strict, immutable
  // canonical snapshot for every authority used by local validation and give each
  // dispatch its own clone, so in-flight mutation cannot split prompt input from
  // deterministic rerendering or the local fallback's appearance/config decision.
  const profileSnapshot = promptWizardDeepFreezeV6Snapshot(
    promptWizardProductProfileSchema.parse(structuredClone(input.profile)),
  );
  const configSnapshot = promptWizardDeepFreezeV6Snapshot(
    promptWizardVideoConfigSchema.parse(structuredClone(input.config)),
  );
  const evidenceGraphSnapshot = promptWizardDeepFreezeV6Snapshot(
    promptWizardEvidenceGraphSchema.parse(structuredClone(input.evidenceGraph)),
  );
  const routeSetSnapshot = promptWizardDeepFreezeV6Snapshot(
    promptWizardRouteSetV6Schema.parse(structuredClone(input.routeSet)),
  );
  const verifiedOfferSnapshot = z.string().max(300)
    .refine(value => value.trim() === value)
    .parse(input.verifiedOffer);
  const historicalPlansSnapshot = promptWizardDeepFreezeV6Snapshot(
    input.historicalPlans.map(plan => (
      promptWizardPlanSchema.parse(structuredClone(plan))
    )),
  );
  const imageCountSnapshot = promptWizardStrictV6IntegerSnapshot(
    input.imageCount,
    'imageCount',
    1,
    9,
  );
  const variationKeySnapshot = promptWizardStrictV6IntegerSnapshot(
    input.variationKey,
    'variationKey',
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const deadlineAtMsSnapshot = promptWizardStrictV6IntegerSnapshot(
    input.deadlineAtMs,
    'deadlineAtMs',
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const costOwnerSnapshot = input.costOwner
    ? promptWizardDeepFreezeV6Snapshot(promptWizardV6CostOwnerSnapshotSchema.parse(
        structuredClone(input.costOwner),
      ))
    : undefined;
  const soundDesignOnly = configSnapshot.durationSeconds === 5;
  const voiceoverLanguage = input.voiceoverLanguage?.normalize('NFKC').trim();
  if (!soundDesignOnly && !voiceoverLanguage) {
    throw Object.assign(new Error('10/15 秒 V6 方案必须提供口播语言'), {
      code: 'PROMPT_WIZARD_TARGET_LANGUAGE_REQUIRED',
      fieldPaths: ['targetLanguage'],
    });
  }
  const providerVoiceoverContext = soundDesignOnly
    ? {}
    : {
        targetLanguage: voiceoverLanguage!,
        confirmedOffer: verifiedOfferSnapshot,
      };
  const draftContexts = promptWizardDeepFreezeV6Snapshot(
    structuredClone(promptWizardRouteContextsV6(routeSetSnapshot)),
  );
  const planContexts = promptWizardDeepFreezeV6Snapshot(
    structuredClone(promptWizardRoutePlanContextsV6(routeSetSnapshot)),
  );
  if (
    draftContexts.length !== PROMPT_WIZARD_V6_PLAN_COUNT
    || planContexts.length !== PROMPT_WIZARD_V6_PLAN_COUNT
  ) {
    throw Object.assign(new Error('V6 内部路线集合必须包含三个商业角色'), {
      code: 'PROMPT_WIZARD_ROUTE_SET_INVALID',
    });
  }
  const planIds = PROMPT_WIZARD_V6_PLAN_INDEXES.map(() => randomUUID());
  const executionBudget = getPromptWizardV6ExecutionBudget(configSnapshot);
  // V6 的第三个全局索引不能直接传给只读保留的 V5 编译边界；这里仅
  // 复用其成熟的动作预算收口，路线角色与全局索引仍由 V6 结构持有。
  const legacyRuntimeContexts = promptWizardDeepFreezeV6Snapshot(draftContexts.map(context => ({
    planIndex: (context.planIndex === 0 ? 0 : 1) as 0 | 1,
    variant: context.variant,
    useDirection: context.useDirection,
    selectedScene: context.selectedScene,
  } satisfies PromptWizardUseDirectionPlanContext)));
  const appearanceModes = promptWizardDeepFreezeV6Snapshot(
    planContexts.map(context => context.route.appearanceMode),
  );
  let usage: PromptWizardProviderUsage | null = null;
  let repairRounds = 0;
  let formatRepairCount = 0;
  // 任一阶段只要已经真实发起过格式恢复，该索引随后就必须一次性通过完整
  // Schema/事实/安全/动作/语言/CTA/集合差异门禁。格式恢复不是新的内容
  // 修复预算，恢复稿仍非法时不得再发起下一次内容修复或终局校准。
  const formatRecoveredPlanIndexes = new Set<PromptWizardPlanIndex>();
  const contentRepairRequestCounts: PromptWizardV6PlanRequestCounts = [0, 0, 0];
  const terminalCalibrationRequestCounts: PromptWizardV6PlanRequestCounts = [0, 0, 0];
  const repairDiagnostics: PromptWizardRepairDiagnostic[] = [];
  const outputDiagnostics: PromptWizardOutputDiagnostic[] = [];
  const motionRepairSourceSnapshots: Array<
    PromptWizardV6MotionRepairSourceSnapshot | null
  > = [null, null, null];
  const currentRepairState = (): PromptWizardV6RepairState => ({
    contentRepairRequestCounts,
    terminalCalibrationRequestCounts,
    repairDiagnostics,
    outputDiagnostics,
  });
  const drafts: PromptWizardPlanDraft[] = [];
  const initialResults = await Promise.allSettled(PROMPT_WIZARD_V6_PLAN_INDEXES.map(
    planIndex => input.provider.generateUseDirectionDrafts({
      profile: structuredClone(profileSnapshot),
      evidenceGraph: structuredClone(evidenceGraphSnapshot),
      ...providerVoiceoverContext,
      config: structuredClone(configSnapshot),
      // 每次外呼只携带当前路线；Provider 成本账本继续使用全局 planIndex。
      planContexts: [structuredClone(draftContexts[planIndex]!)],
      imageCount: imageCountSnapshot,
      variationKey: variationKeySnapshot,
      deadlineAtMs: deadlineAtMsSnapshot,
      ...(costOwnerSnapshot ? {
        costOwner: { ...structuredClone(costOwnerSnapshot), repairRound: 0 },
      } : {}),
    }),
  ));
  const initialFailures: { planIndex: PromptWizardPlanIndex; error: unknown }[] = [];
  for (const planIndex of PROMPT_WIZARD_V6_PLAN_INDEXES) {
    const result = initialResults[planIndex]!;
    if (result.status === 'rejected') {
      usage = mergePromptWizardProviderFailureUsage(usage, result.reason);
      const inheritedRepairRounds = promptWizardSafeRepairRounds(
        result.reason && typeof result.reason === 'object'
          ? (result.reason as { repairRounds?: unknown }).repairRounds
          : undefined,
      ) ?? 0;
      repairRounds = Math.max(repairRounds, inheritedRepairRounds);
      contentRepairRequestCounts[planIndex] += inheritedRepairRounds;
      const inheritedDiagnostics = promptWizardInitialRepairDiagnostics({
        planIndex,
        repairRounds: inheritedRepairRounds,
        value: result.reason && typeof result.reason === 'object'
          ? (result.reason as { repairDiagnostics?: unknown }).repairDiagnostics
          : undefined,
      });
      repairDiagnostics.push(...inheritedDiagnostics.diagnostics);
      const inheritedOutputDiagnostics = promptWizardSafeOutputDiagnostics(
        result.reason && typeof result.reason === 'object'
          ? (result.reason as { outputDiagnostics?: unknown }).outputDiagnostics
          : undefined,
      );
      const outputDiagnosticsReconcile = (
        inheritedOutputDiagnostics.valid
        && inheritedOutputDiagnostics.diagnostics.every(diagnostic => (
          diagnostic.planIndex === planIndex
        ))
      );
      if (outputDiagnosticsReconcile) {
        outputDiagnostics.push(...inheritedOutputDiagnostics.diagnostics);
      }
      initialFailures.push({
        planIndex,
        error: inheritedDiagnostics.reconciles && outputDiagnosticsReconcile
          ? result.reason
          : Object.assign(new Error('Provider 返回的 V6 首轮失败诊断不安全或无法与计数对账'), {
              code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
            }),
      });
      continue;
    }
    usage = mergePromptWizardProviderUsage(usage, result.value.usage);
    const initialContentRepairRounds = result.value.repairRounds ?? 0;
    if (
      !Number.isSafeInteger(initialContentRepairRounds)
      || initialContentRepairRounds < 0
      || initialContentRepairRounds > 1
    ) {
      initialFailures.push({
        planIndex,
        error: Object.assign(new Error('Provider 返回的 V6 首轮修复计数无效'), {
          code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
        }),
      });
      continue;
    }
    const initialDiagnostics = promptWizardInitialRepairDiagnostics({
      planIndex,
      repairRounds: initialContentRepairRounds,
      value: result.value.repairDiagnostics,
    });
    const initialOutputDiagnostics = promptWizardSafeOutputDiagnostics(
      result.value.outputDiagnostics,
    );
    const outputDiagnosticsReconcile = (
      initialOutputDiagnostics.valid
      && initialOutputDiagnostics.diagnostics.every(diagnostic => (
        diagnostic.planIndex === planIndex
      ))
    );
    const initialFormatAnomalyCount = promptWizardReconciledFormatAnomalyCount({
      declared: result.value.formatRepairCount,
      diagnosticsWereProvided: result.value.outputDiagnostics !== undefined,
      diagnostics: initialOutputDiagnostics.diagnostics,
    });
    if (
      !initialDiagnostics.reconciles
      || !outputDiagnosticsReconcile
      || initialFormatAnomalyCount === null
      // 单方案首轮只允许一次自然修复选择：JSON 格式恢复与 Schema 内容
      // 修复不能在同一 generateUseDirectionDrafts 调用里同时发生。
      || (initialContentRepairRounds > 0 && initialFormatAnomalyCount > 0)
    ) {
      initialFailures.push({
        planIndex,
        error: Object.assign(new Error('Provider 返回的 V6 首轮诊断不安全或无法与计数对账'), {
          code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
        }),
      });
      continue;
    }
    repairRounds = Math.max(repairRounds, initialContentRepairRounds);
    contentRepairRequestCounts[planIndex] += initialContentRepairRounds;
    repairDiagnostics.push(...initialDiagnostics.diagnostics);
    outputDiagnostics.push(...initialOutputDiagnostics.diagnostics);
    formatRepairCount += initialFormatAnomalyCount;
    const usedInitialFormatRecovery = initialOutputDiagnostics.diagnostics.some(diagnostic => (
      diagnostic.operation === 'repair-draft-format'
    ));
    if (
      usedInitialFormatRecovery
      // 兼容没有输出诊断的既有 Provider 实现时必须按更严格边界处理：它既然
      // 声明发生了格式异常，却无法证明只做了本地解析，就视为已发起恢复。
      || (result.value.outputDiagnostics === undefined && initialFormatAnomalyCount > 0)
    ) {
      formatRecoveredPlanIndexes.add(planIndex);
    }
    if (result.value.drafts.length !== 1 || !result.value.drafts[0]) {
      initialFailures.push({
        planIndex,
        error: Object.assign(new Error('Provider 必须为当前商业角色返回一个方案'), {
          code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
        }),
      });
      continue;
    }
    drafts[planIndex] = normalizePromptWizardRouteDraftV6({
      draft: result.value.drafts[0],
      planContext: planContexts[planIndex]!,
      evidenceGraph: evidenceGraphSnapshot,
      profile: profileSnapshot,
      config: configSnapshot,
    });
  }
  if (initialFailures.length > 0) {
    const firstFailure = initialFailures[0]!;
    throw attachPromptWizardOrchestrationUsage(
      firstFailure.error,
      usage,
      repairRounds,
      initialFailures.map(failure => failure.planIndex),
      currentRepairState(),
    );
  }

  const renderRoutePlan = (
    planIndex: PromptWizardPlanIndex,
    draft: PromptWizardPlanDraft,
  ) => renderPromptWizardRoutePlanV6({
    id: planIds[planIndex]!,
    draft,
    planContext: planContexts[planIndex]!,
    evidenceGraph: evidenceGraphSnapshot,
    profile: profileSnapshot,
    ...(!soundDesignOnly ? { targetLanguage: voiceoverLanguage! } : {}),
    verifiedOffer: verifiedOfferSnapshot,
    config: configSnapshot,
    imageCount: imageCountSnapshot,
  });

  while (true) {
    const issues = new Map<PromptWizardPlanIndex, PromptWizardContentRepairIssue>();
    const validationErrors = new Map<PromptWizardPlanIndex, unknown>();
    const plans: PromptWizardPlanV6[] = [];
    for (const planIndex of PROMPT_WIZARD_V6_PLAN_INDEXES) {
      // V6 完整编译器按执行预算、动态密度、口播覆盖的顺序失败关闭。若首稿
      // 同时存在运镜和前三秒产品首提问题，只观察首个异常会把唯一一次内容
      // 修复全部花在运镜上，重渲染后才暴露原稿中已经存在的口播问题。
      //
      // 口播覆盖与画面动态相互独立，因此在花费 Provider 修复预算前先用同一
      // 权威 V6 时间轴做一次纯诊断。它不修改 Draft；若编译器随后抛出其他
      // 可修错误，下方会把两组安全字段路径合并成一次原子修复。
      let supplementalVoiceoverCoverageError: PromptWizardVoiceoverCoverageError | null = null;
      if (!soundDesignOnly) {
        try {
          const timeline = promptWizardTimelineV6(configSnapshot.durationSeconds);
          assertPromptWizardVoiceoverCoverage({
            shots: timeline.map(([startSeconds, endSeconds], segmentIndex) => ({
              startSeconds,
              endSeconds,
              ...drafts[planIndex]!.segments[segmentIndex]!,
            })),
            targetLanguage: voiceoverLanguage!,
            durationSeconds: configSnapshot.durationSeconds,
            profile: profileSnapshot,
            v6SemanticOnly: true,
          });
        } catch (error) {
          if (!(error instanceof PromptWizardVoiceoverCoverageError)) throw error;
          supplementalVoiceoverCoverageError = error;
        }
      }
      try {
        plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
      } catch (error) {
        let currentError = error;
        let fieldPaths = promptWizardSafeFieldPaths(currentError);
        if (promptWizardSafeUseDirectionActionFallback(
          currentError,
          fieldPaths,
          repairRounds,
        )) {
          drafts[planIndex] = stabilizePromptWizardUseDirectionSceneContext({
            draft: drafts[planIndex]!,
            context: legacyRuntimeContexts[planIndex]!,
            maxActionFamilies: executionBudget.maxMajorActionCount,
          });
          logPromptWizardSafeUseDirectionActionFallback(planIndex, repairRounds);
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
            continue;
          } catch (fallbackError) {
            currentError = fallbackError;
            fieldPaths = promptWizardSafeFieldPaths(currentError);
          }
        }
        if (promptWizardSafeUseDirectionNarrativeFallback(
          currentError,
          fieldPaths,
          repairRounds,
          // V6 narrative 由 Flat Wire 展开阶段按锁定路线确定生成，Provider
          // 没有该字段的所有权。唯一 narrative 错误直接确定性重建并完整
          // 重渲染；混合路径仍先修真正可写字段。V4/V5 继续沿用两轮阈值。
          { allowImmediateServerOwnedFallback: true },
        )) {
          drafts[planIndex] = stabilizePromptWizardUseDirectionNarrative({
            draft: drafts[planIndex]!,
            context: legacyRuntimeContexts[planIndex]!,
          });
          logPromptWizardSafeUseDirectionNarrativeFallback(planIndex, repairRounds);
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
            continue;
          } catch (fallbackError) {
            currentError = fallbackError;
            fieldPaths = promptWizardSafeFieldPaths(currentError);
          }
        }
        // V6 口播只允许由 Provider 按分镜时间整镜重写。服务端不再用
        // 字词预算拼接产品锚点、替换 CTA、机械截断或补字。
        if (
          contentRepairRequestCounts[planIndex]
            >= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
          && promptWizardV6SingleReasonVoiceoverFallbackScope(currentError)
        ) {
          throw attachPromptWizardOrchestrationUsage(
            currentError,
            usage,
            repairRounds,
            [planIndex],
            currentRepairState(),
          );
        }
        const safeFormatRecoveryCameraBudget = voiceoverLanguage
          ? promptWizardSafeV6Spanish10sFormatRecoveryCameraBudgetFallback({
              error: currentError,
              draft: drafts[planIndex]!,
              targetLanguage: voiceoverLanguage,
              config: configSnapshot,
              formatRecovered: formatRecoveredPlanIndexes.has(planIndex),
              contentRepairRequestCount: contentRepairRequestCounts[planIndex],
            })
          : null;
        if (safeFormatRecoveryCameraBudget) {
          drafts[planIndex] = safeFormatRecoveryCameraBudget.draft;
          logPromptWizardSafeV6Spanish10sFormatRecoveryCameraBudgetFallback(
            planIndex,
            safeFormatRecoveryCameraBudget,
          );
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
            continue;
          } catch (fallbackError) {
            // 格式恢复已经是该索引唯一一次恢复机会；安全运镜收口后的完整
            // 重渲染若仍失败，必须保留真实错误并停止，不能落回内容修复。
            throw attachPromptWizardOrchestrationUsage(
              fallbackError,
              usage,
              repairRounds,
              [planIndex],
              currentRepairState(),
            );
          }
        }
        const safeFormatRecoverySingleCameraMotion =
          promptWizardSafeV6FormatRecoverySingleCameraMotionFallback({
            error: currentError,
            draft: drafts[planIndex]!,
            config: configSnapshot,
            ...(!soundDesignOnly ? { targetLanguage: voiceoverLanguage! } : {}),
            contentRepairRequestCount: contentRepairRequestCounts[planIndex],
            formatRecovered: formatRecoveredPlanIndexes.has(planIndex),
            deliveryVersion: 6,
          });
        if (safeFormatRecoverySingleCameraMotion) {
          drafts[planIndex] = safeFormatRecoverySingleCameraMotion.draft;
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
          } catch (fallbackError) {
            // 格式恢复已经消费该方案唯一的恢复机会。单运镜候选若在完整商业
            // 重渲染中暴露任何真实错误，必须原位失败，不能改发内容修复。
            throw attachPromptWizardOrchestrationUsage(
              fallbackError,
              usage,
              repairRounds,
              [planIndex],
              currentRepairState(),
            );
          }
          logPromptWizardSafeV6FormatRecoverySingleCameraMotionFallback(
            planIndex,
            safeFormatRecoverySingleCameraMotion.segmentIndex,
          );
          continue;
        }
        const motionRepairSource = motionRepairSourceSnapshots[planIndex] ?? null;
        const safeMotionRepairCameraBudget =
          promptWizardSafeV6MotionRepairCameraBudgetFallback({
            error: currentError,
            draft: drafts[planIndex]!,
            source: motionRepairSource,
            config: configSnapshot,
            ...(!soundDesignOnly ? { targetLanguage: voiceoverLanguage! } : {}),
            contentRepairRequestCount: contentRepairRequestCounts[planIndex],
            formatRecovered: formatRecoveredPlanIndexes.has(planIndex),
            deliveryVersion: 6,
          });
        if (safeMotionRepairCameraBudget) {
          drafts[planIndex] = safeMotionRepairCameraBudget.draft;
          logPromptWizardSafeV6MotionRepairCameraBudgetFallback(
            planIndex,
            safeMotionRepairCameraBudget,
            repairRounds,
          );
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
            continue;
          } catch (fallbackError) {
            // 第一次修复后的确定性运镜候选仍要完整重渲染。若它暴露新的
            // 权威可修错误，保留该真实错误进入第二轮；两轮耗尽后下方仍会
            // 在第三次 HTTP 委托前失败关闭。
            currentError = fallbackError;
            fieldPaths = promptWizardSafeFieldPaths(currentError);
          }
        }
        if (!safeMotionRepairCameraBudget && promptWizardV6MotionRepairCameraBudgetFallbackScope({
          error: currentError,
          source: motionRepairSource,
          contentRepairRequestCount: contentRepairRequestCounts[planIndex],
        })) {
          // 来源链证明这是 singleton 运镜修复后的预算错误，但当前稿件不能
          // 通过严格来源所有权生成安全候选；这通常意味着非目标字段漂移，
          // 必须保留真实预算错误并失败关闭，不能用第二轮掩盖越权改写。
          throw attachPromptWizardOrchestrationUsage(
            currentError,
            usage,
            repairRounds,
            [planIndex],
            currentRepairState(),
          );
        }
        const safeExecutionBudget = promptWizardSafeV6ExecutionBudgetFallback({
          error: currentError,
          draft: drafts[planIndex]!,
          context: legacyRuntimeContexts[planIndex]!,
          profile: profileSnapshot,
          repairRounds,
        });
        if (safeExecutionBudget) {
          drafts[planIndex] = safeExecutionBudget.draft;
          logPromptWizardSafeV6ExecutionBudgetFallback(
            planIndex,
            safeExecutionBudget,
            repairRounds,
          );
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
            continue;
          } catch (fallbackError) {
            currentError = fallbackError;
            fieldPaths = promptWizardSafeFieldPaths(currentError);
          }
        }
        const safeActionEditingCueMotion = promptWizardSafeV6ActionEditingCueMotionFallback({
          error: currentError,
          draft: drafts[planIndex]!,
          context: legacyRuntimeContexts[planIndex]!,
          config: configSnapshot,
          ...(!soundDesignOnly ? { targetLanguage: voiceoverLanguage! } : {}),
          contentRepairRequestCount: contentRepairRequestCounts[planIndex],
          formatRecovered: formatRecoveredPlanIndexes.has(planIndex),
          deliveryVersion: 6,
        });
        if (safeActionEditingCueMotion) {
          drafts[planIndex] = safeActionEditingCueMotion.draft;
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
          } catch (fallbackError) {
            // 两轮 Provider 内容修复已经耗尽。联合叶子候选若在完整商业重渲染
            // 中暴露任何真实错误，必须原位失败，不能再进入第三次内容请求。
            throw attachPromptWizardOrchestrationUsage(
              fallbackError,
              usage,
              repairRounds,
              [planIndex],
              currentRepairState(),
            );
          }
          logPromptWizardSafeMotionCombinationFallback(planIndex, repairRounds);
          continue;
        }
        const safeMultiCameraMovementMotion =
          promptWizardSafeV6MultiCameraMovementMotionFallback({
            error: currentError,
            draft: drafts[planIndex]!,
            config: configSnapshot,
            ...(!soundDesignOnly ? { targetLanguage: voiceoverLanguage! } : {}),
            contentRepairRequestCount: contentRepairRequestCounts[planIndex],
            formatRecovered: formatRecoveredPlanIndexes.has(planIndex),
            deliveryVersion: 6,
          });
        if (safeMultiCameraMovementMotion) {
          drafts[planIndex] = safeMultiCameraMovementMotion.draft;
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
          } catch (fallbackError) {
            // 两轮 Provider 内容修复已经耗尽。一到多个运镜叶子的确定性候选若在
            // 完整商业重渲染中暴露任何真实错误，必须保留该错误原位关闭。
            throw attachPromptWizardOrchestrationUsage(
              fallbackError,
              usage,
              repairRounds,
              [planIndex],
              currentRepairState(),
            );
          }
          logPromptWizardSafeSegmentCameraMotionFallback(
            planIndex,
            safeMultiCameraMovementMotion.segmentIndexes,
            repairRounds,
          );
          continue;
        }
        const safeCtaActionMotion = promptWizardSafeV6CtaMotionFallback({
          error: currentError,
          draft: drafts[planIndex]!,
          appearanceMode: appearanceModes[planIndex]!,
          contentRepairRequestCount: contentRepairRequestCounts[planIndex],
        });
        if (safeCtaActionMotion) {
          drafts[planIndex] = safeCtaActionMotion;
          logPromptWizardSafeCtaMotionFallback(
            planIndex,
            appearanceModes[planIndex]!,
            repairRounds,
          );
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
            continue;
          } catch (fallbackError) {
            currentError = fallbackError;
            fieldPaths = promptWizardSafeFieldPaths(currentError);
          }
        }
        if (
          contentRepairRequestCounts[planIndex]
            >= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
          && promptWizardV6CtaActionMotionFallbackScope(currentError)
        ) {
          throw attachPromptWizardOrchestrationUsage(
            currentError,
            usage,
            repairRounds,
            [planIndex],
            currentRepairState(),
          );
        }
        const safeV6LightingMotion = promptWizardSafeV6LightingMotionFallback({
          error: currentError,
          draft: drafts[planIndex]!,
          config: configSnapshot,
          ...(!soundDesignOnly ? { targetLanguage: voiceoverLanguage! } : {}),
          contentRepairRequestCount: contentRepairRequestCounts[planIndex],
          deliveryVersion: 6,
        });
        if (safeV6LightingMotion) {
          drafts[planIndex] = safeV6LightingMotion.draft;
          logPromptWizardSafeLightingMotionFallback(
            planIndex,
            [safeV6LightingMotion.segmentIndex],
            repairRounds,
          );
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
            continue;
          } catch (fallbackError) {
            currentError = fallbackError;
            fieldPaths = promptWizardSafeFieldPaths(currentError);
          }
        }
        // 两轮耗尽后，任何 lighting 动态路径只能进入上面的严格 singleton
        // 收口；伪造、混合、重复、非规范或越界路径均原位失败，不能落回
        // issues 后再发起第三次 Provider 内容请求。
        if (
          contentRepairRequestCounts[planIndex]
            >= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
          && promptWizardV6LightingMotionFallbackScope(currentError)
        ) {
          throw attachPromptWizardOrchestrationUsage(
            currentError,
            usage,
            repairRounds,
            [planIndex],
            currentRepairState(),
          );
        }
        const safeSegmentCameraMotion = promptWizardSafeSegmentCameraMotionFallback({
          error: currentError,
          draft: drafts[planIndex]!,
          contentRepairRequestCount: contentRepairRequestCounts[planIndex],
        });
        if (safeSegmentCameraMotion) {
          drafts[planIndex] = safeSegmentCameraMotion.draft;
          logPromptWizardSafeSegmentCameraMotionFallback(
            planIndex,
            safeSegmentCameraMotion.segmentIndexes,
            repairRounds,
          );
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
            continue;
          } catch (fallbackError) {
            currentError = fallbackError;
            fieldPaths = promptWizardSafeFieldPaths(currentError);
          }
        }
        // 两轮耗尽后，命中运镜路径但不满足“仅明确且在界内的
        // cameraMovement”时，包括混合字段或伪造索引，都必须在第三次
        // Provider 外呼前失败关闭。
        if (
          contentRepairRequestCounts[planIndex]
            >= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
          && promptWizardV6CameraMotionFallbackScope(currentError)
        ) {
          throw attachPromptWizardOrchestrationUsage(
            currentError,
            usage,
            repairRounds,
            [planIndex],
            currentRepairState(),
          );
        }
        const safeV6EditingCueMotion = promptWizardSafeV6EditingCueMotionFallback({
          error: currentError,
          draft: drafts[planIndex]!,
          config: configSnapshot,
          ...(!soundDesignOnly ? { targetLanguage: voiceoverLanguage! } : {}),
          contentRepairRequestCount: contentRepairRequestCounts[planIndex],
          deliveryVersion: 6,
        });
        if (safeV6EditingCueMotion) {
          drafts[planIndex] = safeV6EditingCueMotion.draft;
          logPromptWizardSafeEditingCueFallback(
            planIndex,
            [safeV6EditingCueMotion.segmentIndex],
            repairRounds,
          );
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
            continue;
          } catch (fallbackError) {
            currentError = fallbackError;
            fieldPaths = promptWizardSafeFieldPaths(currentError);
          }
        }
        // editingCue 单字段优先进入上面的严格 V6 singleton 收口。两轮内容
        // 修复耗尽后，任何伪造、混合、重复、非规范或越界剪辑路径都必须在
        // 第三次 Provider 内容请求前原位失败关闭。
        if (
          contentRepairRequestCounts[planIndex]
            >= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
          && promptWizardV6EditingCueMotionFallbackScope(currentError)
        ) {
          throw attachPromptWizardOrchestrationUsage(
            currentError,
            usage,
            repairRounds,
            [planIndex],
            currentRepairState(),
          );
        }
        const safeReferenceEditingCue = promptWizardSafeV6ReferenceEditingCueFallback({
          error: currentError,
          draft: drafts[planIndex]!,
          config: configSnapshot,
          ...(!soundDesignOnly ? { targetLanguage: voiceoverLanguage! } : {}),
          contentRepairRequestCount: contentRepairRequestCounts[planIndex],
          formatRecovered: formatRecoveredPlanIndexes.has(planIndex),
          deliveryVersion: 6,
        });
        if (safeReferenceEditingCue) {
          drafts[planIndex] = safeReferenceEditingCue.draft;
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
          } catch (fallbackError) {
            // 两轮 Provider 内容修复已耗尽。首尾帧剪辑叶子候选
            // 必须通过完整商业重渲染；任一隐藏错误原位关闭。
            throw attachPromptWizardOrchestrationUsage(
              fallbackError,
              usage,
              repairRounds,
              [planIndex],
              currentRepairState(),
            );
          }
          logPromptWizardSafeEditingCueFallback(
            planIndex,
            [safeReferenceEditingCue.segmentIndex],
            repairRounds,
          );
          continue;
        }
        // 两轮耗尽后，只要首尾帧错误涉及 editingCue，就必须在
        // 上面的严格终态收口中成功；混合、重复、越界、伪造、
        // 格式恢复或非规范 Draft 均不得落回 issues 形成第三次 HTTP。
        if (
          contentRepairRequestCounts[planIndex]
            >= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
          && promptWizardV6ReferenceEditingCueFallbackScope(currentError)
        ) {
          throw attachPromptWizardOrchestrationUsage(
            currentError,
            usage,
            repairRounds,
            [planIndex],
            currentRepairState(),
          );
        }
        // productionNote 不是商品事实或用户可见文案；当它单独误用首尾帧
        // 定位表达时，继续请求 Provider 只会浪费修复预算。V5 已使用同一
        // 精确白名单安全清空，V6 也在完整重渲染前执行相同的确定性收口。
        const safeProductionNoteIndexes = promptWizardSafeProductionNoteIndexes(
          currentError,
          fieldPaths,
          drafts[planIndex]!.segments.length,
        );
        if (safeProductionNoteIndexes) {
          const affected = new Set(safeProductionNoteIndexes);
          drafts[planIndex] = {
            ...drafts[planIndex]!,
            segments: drafts[planIndex]!.segments.map((segment, index) => affected.has(index)
              ? { ...segment, productionNote: '' }
              : segment),
          };
          logPromptWizardSafeProductionNoteFallback(
            planIndex,
            safeProductionNoteIndexes,
            repairRounds,
          );
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
            continue;
          } catch (fallbackError) {
            currentError = fallbackError;
            fieldPaths = promptWizardSafeFieldPaths(currentError);
          }
        }
        const safeDifferenceTagIndexes = promptWizardSafeDifferenceTagIndexes(
          currentError,
          fieldPaths,
          drafts[planIndex]!.differenceTags.length,
          repairRounds,
          // V6 的 differenceTags 只是中文方案摘要元数据，不会进入口播、
          // 事实或执行动作。若它是唯一语言错误，5/10/15 秒都立即使用
          // 服务端受控中文标签并重跑完整门禁，避免为一个展示标签消耗
          // 真实 Provider 修复；任何其他字段混入时仍严格进入原有修复链路。
          { allowImmediateContentLanguageFallback: true },
        );
        if (safeDifferenceTagIndexes) {
          const affected = new Set(safeDifferenceTagIndexes);
          const controlledTags = promptWizardControlledDifferenceTags(
            legacyRuntimeContexts[planIndex]!.variant,
          );
          const usedTags = new Set(drafts[planIndex]!.differenceTags
            .filter((_, index) => !affected.has(index))
            .map(tag => tag.normalize('NFKC').trim()));
          drafts[planIndex] = {
            ...drafts[planIndex]!,
            differenceTags: drafts[planIndex]!.differenceTags.map((tag, index) => {
              if (!affected.has(index)) return tag;
              const candidates = [controlledTags[index], ...controlledTags]
                .filter((candidate): candidate is string => Boolean(candidate));
              const replacement = candidates.find(candidate => (
                !usedTags.has(candidate.normalize('NFKC').trim())
              )) ?? controlledTags.at(-1)!;
              usedTags.add(replacement.normalize('NFKC').trim());
              return replacement;
            }),
          };
          logPromptWizardSafeDifferenceTagFallback(
            planIndex,
            safeDifferenceTagIndexes,
            repairRounds,
          );
          try {
            plans[planIndex] = renderRoutePlan(planIndex, drafts[planIndex]!);
            continue;
          } catch (fallbackError) {
            currentError = fallbackError;
            fieldPaths = promptWizardSafeFieldPaths(currentError);
          }
        }
        // 编译器错误可能指向最终 prompt、verifiedOffer，或不携带可编辑路径。
        // 这些都不是 Provider 能修改的 Draft 字段，不能把原始上下文继续下发，
        // 否则只会被 Provider 的输入门禁覆盖成泛化的 INPUT_INVALID，丢失真正
        // 的失败原因。V6 与成熟 V5 链路保持同一边界：仅允许明确列入白名单、
        // 且错误类型本身可修复的结构化 Draft 字段进入定向修复。
        if (
          isUnrepairableFinalPromptError(currentError)
          || !isPromptWizardRepairableError(currentError)
        ) {
          throw attachPromptWizardOrchestrationUsage(
            currentError,
            usage,
            repairRounds,
            [planIndex],
            currentRepairState(),
          );
        }
        if (fieldPaths.length === 0) {
          throw attachPromptWizardOrchestrationUsage(
            currentError,
            usage,
            repairRounds,
            [planIndex],
            currentRepairState(),
          );
        }
        const repairAction = promptWizardRepairFeedback(
          currentError,
          voiceoverLanguage,
        ).trim();
        if (!repairAction || repairAction.length > 1_000) {
          throw attachPromptWizardOrchestrationUsage(
            currentError,
            usage,
            repairRounds,
            [planIndex],
            currentRepairState(),
          );
        }
        const primaryIssue: PromptWizardContentRepairIssue = {
          planIndex,
          errorCode: errorCode(currentError),
          fieldPaths,
          action: repairAction,
        };
        issues.set(planIndex, primaryIssue);
        validationErrors.set(planIndex, currentError);
        if (
          supplementalVoiceoverCoverageError
          && errorCode(currentError) !== 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID'
        ) {
          const voiceoverFieldPaths = promptWizardSafeFieldPaths(
            supplementalVoiceoverCoverageError,
          );
          const voiceoverRepairAction = promptWizardRepairFeedback(
            supplementalVoiceoverCoverageError,
            voiceoverLanguage,
          ).trim();
          if (
            voiceoverFieldPaths.length === 0
            || !voiceoverRepairAction
            || voiceoverRepairAction.length > 1_000
          ) {
            throw attachPromptWizardOrchestrationUsage(
              supplementalVoiceoverCoverageError,
              usage,
              repairRounds,
              [planIndex],
              currentRepairState(),
            );
          }
          mergePromptWizardContentRepairIssue(issues, {
            planIndex,
            errorCode: 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
            fieldPaths: voiceoverFieldPaths,
            action: voiceoverRepairAction,
          });
        }
      }
    }
    if (issues.size === 0) {
      const batchDiversityIssues = validatePromptWizardPlanDiversity(plans);
      const historyDiversityIssues = validatePromptWizardPlanHistory(
        plans,
        historicalPlansSnapshot,
      );
      for (const issue of [...batchDiversityIssues, ...historyDiversityIssues]) {
        // 已经消耗过一次格式恢复的稿件必须直接通过完整集合门禁；
        // 若它仍参与差异或历史冲突，必须定位到该恢复索引并失败
        // 关闭，不能再把同一索引送入内容修复。未发生格式恢复时，
        // 仍沿用原规则只重做较后的索引。
        const recoveredPlanIndex = issue.planIndexes
          .map(toPromptWizardPlanIndex)
          .find(index => formatRecoveredPlanIndexes.has(index));
        const planIndex = recoveredPlanIndex
          ?? toPromptWizardPlanIndex(Math.max(...issue.planIndexes));
        const isBatchIssue = batchDiversityIssues.includes(issue);
        const rawReferencePlanIndex = isBatchIssue
          ? issue.planIndexes.find(index => index !== planIndex)
          : undefined;
        const referencePlanIndex = rawReferencePlanIndex === undefined
          ? undefined
          : toPromptWizardPlanIndex(rawReferencePlanIndex);
        const fieldPaths = promptWizardV6DiversityRepairFieldPaths(drafts[planIndex]!);
        mergePromptWizardContentRepairIssue(issues, {
          planIndex,
          ...(referencePlanIndex !== undefined ? { referencePlanIndex } : {}),
          errorCode: 'PROMPT_WIZARD_DIVERSITY_FAILED',
          // Provider 只接受 Draft 内可安全编辑的字段路径。集合级校验的
          // `plans[n]` 是服务端定位信息，不能直接下发给单方案修复。
          fieldPaths,
          action: referencePlanIndex !== undefined
            ? `${issue.reason}；以 diversityReferenceDraft 为只读对照，只改写列出的真实创意表达字段；保持商品事实、路线角色、证据与其他两个方案不变`
            : `${issue.reason}；只改写列出的真实创意表达字段并避开当前 run 历史方案；保持商品事实、路线角色、证据与其他两个方案不变`,
        });
        if (recoveredPlanIndex !== undefined) {
          validationErrors.set(planIndex, Object.assign(
            new Error('V6 格式恢复稿未通过完整集合领域校验'),
            {
              code: 'PROMPT_WIZARD_DIVERSITY_FAILED',
              fieldPaths,
            },
          ));
        }
      }
    }
    const invalidRecoveredPlanIndex = PROMPT_WIZARD_V6_PLAN_INDEXES.find(planIndex => (
      formatRecoveredPlanIndexes.has(planIndex) && issues.has(planIndex)
    ));
    if (invalidRecoveredPlanIndex !== undefined) {
      const recoveryIssue = issues.get(invalidRecoveredPlanIndex)!;
      const recoveryError = validationErrors.get(invalidRecoveredPlanIndex)
        ?? Object.assign(new Error('V6 格式恢复稿未通过完整领域校验'), {
          code: recoveryIssue.errorCode,
          fieldPaths: [...recoveryIssue.fieldPaths],
        });
      throw attachPromptWizardOrchestrationUsage(
        recoveryError,
        usage,
        repairRounds,
        [invalidRecoveredPlanIndex],
        currentRepairState(),
      );
    }
    if (issues.size === 0) {
      return {
        plans,
        drafts,
        usage: usage!,
        repairRounds,
        formatRepairCount,
        contentRepairRequestCounts,
        terminalCalibrationRequestCounts,
        repairDiagnostics,
        outputDiagnostics,
      };
    }
    if (
      repairRounds >= PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
      || deadlineAtMsSnapshot - Date.now() < PROMPT_WIZARD_MIN_CONTENT_REPAIR_BUDGET_MS
    ) {
      const terminalIssues = [...issues.values()];
      logPromptWizardV6TerminalValidationFailure({
        errorsByPlan: validationErrors,
        repairRounds,
        config: configSnapshot,
      });
      if (terminalIssues.length === 1) {
        const originalError = validationErrors.get(terminalIssues[0]!.planIndex);
        if (originalError) {
          throw attachPromptWizardOrchestrationUsage(
            originalError,
            usage,
            repairRounds,
            [terminalIssues[0]!.planIndex],
            currentRepairState(),
          );
        }
      }
      const terminalCode = terminalIssues.length === 1
        ? terminalIssues[0]!.errorCode
        : 'PROMPT_WIZARD_DIVERSITY_FAILED';
      throw attachPromptWizardOrchestrationUsage(
        Object.assign(new Error(
          `V6 三方向方案未通过最终校验：${terminalIssues
            .map(issue => `方案${issue.planIndex + 1} ${issue.action}`)
            .join('；')}`,
        ), {
          code: terminalCode,
          fieldPaths: Array.from(new Set(
            terminalIssues.flatMap(issue => issue.fieldPaths),
          )),
        }),
        usage,
        repairRounds,
        [...issues.keys()],
        currentRepairState(),
      );
    }
    repairRounds += 1;
    const requestedIssues = [...issues.values()];
    requestedIssues.forEach(issue => {
      if (contentRepairRequestCounts[issue.planIndex] === 0) {
        motionRepairSourceSnapshots[issue.planIndex] = promptWizardDeepFreezeV6Snapshot({
          issue: {
            errorCode: issue.errorCode,
            fieldPaths: [...issue.fieldPaths],
          },
          previousDraft: promptWizardPlanDraftSchema.parse(
            structuredClone(drafts[issue.planIndex]!),
          ),
        });
      }
      contentRepairRequestCounts[issue.planIndex] += 1;
      repairDiagnostics.push({
        planIndex: issue.planIndex,
        origin: 'domain-validation',
        repairRound: repairRounds === 1 ? 1 : 2,
        errorCode: issue.errorCode,
        fieldPaths: [...issue.fieldPaths],
      });
    });
    const repairResults = await Promise.allSettled(requestedIssues.map(issue => (
      input.provider.repairUseDirectionDrafts({
        profile: structuredClone(profileSnapshot),
        evidenceGraph: structuredClone(evidenceGraphSnapshot),
        ...providerVoiceoverContext,
        config: structuredClone(configSnapshot),
        // 只把失败索引的路线和 issue 发给修复外呼，已通过方案不重写。
        planContexts: [structuredClone(draftContexts[issue.planIndex]!)],
        imageCount: imageCountSnapshot,
        variationKey: variationKeySnapshot,
        previousDrafts: structuredClone(drafts),
        issues: [structuredClone(issue)],
        deadlineAtMs: deadlineAtMsSnapshot,
        ...(costOwnerSnapshot ? {
          costOwner: { ...structuredClone(costOwnerSnapshot), repairRound: repairRounds },
        } : {}),
      })
    )));
    const repairFailures: { planIndex: PromptWizardPlanIndex; error: unknown }[] = [];
    requestedIssues.forEach((issue, resultIndex) => {
      const result = repairResults[resultIndex]!;
      if (result.status === 'rejected') {
        usage = mergePromptWizardProviderFailureUsage(usage, result.reason);
        const failedOutputDiagnostics = promptWizardSafeOutputDiagnostics(
          result.reason && typeof result.reason === 'object'
            ? (result.reason as { outputDiagnostics?: unknown }).outputDiagnostics
            : undefined,
        );
        const outputDiagnosticsReconcile = (
          failedOutputDiagnostics.valid
          && failedOutputDiagnostics.diagnostics.every(diagnostic => (
            diagnostic.planIndex === issue.planIndex
          ))
        );
        if (outputDiagnosticsReconcile) {
          outputDiagnostics.push(...failedOutputDiagnostics.diagnostics);
        }
        repairFailures.push({
          planIndex: issue.planIndex,
          error: outputDiagnosticsReconcile
            ? result.reason
            : Object.assign(new Error('Provider 返回的内容修复输出诊断不安全'), {
                code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
              }),
        });
        return;
      }
      usage = mergePromptWizardProviderUsage(usage, result.value.usage);
      const returnedOutputDiagnostics = promptWizardSafeOutputDiagnostics(
        result.value.outputDiagnostics,
      );
      const outputDiagnosticsReconcile = (
        returnedOutputDiagnostics.valid
        && returnedOutputDiagnostics.diagnostics.every(diagnostic => (
          diagnostic.planIndex === issue.planIndex
        ))
      );
      const returnedFormatAnomalyCount = promptWizardReconciledFormatAnomalyCount({
        declared: result.value.formatRepairCount,
        diagnosticsWereProvided: result.value.outputDiagnostics !== undefined,
        diagnostics: returnedOutputDiagnostics.diagnostics,
      });
      if (!outputDiagnosticsReconcile || returnedFormatAnomalyCount === null) {
        repairFailures.push({
          planIndex: issue.planIndex,
          error: Object.assign(new Error('Provider 返回的内容修复输出诊断或计数不安全'), {
            code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
          }),
        });
        return;
      }
      outputDiagnostics.push(...returnedOutputDiagnostics.diagnostics);
      formatRepairCount += returnedFormatAnomalyCount;
      if (
        returnedOutputDiagnostics.diagnostics.some(diagnostic => (
          diagnostic.operation === 'repair-draft-format'
        ))
        || (result.value.outputDiagnostics === undefined && returnedFormatAnomalyCount > 0)
      ) {
        formatRecoveredPlanIndexes.add(issue.planIndex);
      }
      const returned = result.value.drafts;
      if (
        returned.length !== 1
        || returned[0]?.planIndex !== issue.planIndex
      ) {
        repairFailures.push({
          planIndex: issue.planIndex,
          error: Object.assign(new Error('Provider 未返回当前待修复 V6 方案'), {
            code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
          }),
        });
        return;
      }
      drafts[issue.planIndex] = normalizePromptWizardRouteDraftV6({
        draft: returned[0].draft,
        planContext: planContexts[issue.planIndex]!,
        evidenceGraph: evidenceGraphSnapshot,
        profile: profileSnapshot,
        config: configSnapshot,
      });
    });
    if (repairFailures.length > 0) {
      const firstFailure = repairFailures[0]!;
      throw attachPromptWizardOrchestrationUsage(
        firstFailure.error,
        usage,
        repairRounds,
        repairFailures.map(failure => failure.planIndex),
        currentRepairState(),
      );
    }
  }
}

async function completePromptWizardBatch(input: {
  batch: PromptWizardBatchRow;
  plans: PromptWizardPlan[];
  usage: PromptWizardProviderUsage | null;
  engineVersion: 3 | 4;
  strategySignatures?: string[];
}) {
  await withTransaction(async client => {
    const current = await client.query<PromptWizardBatchRow>(
      'SELECT * FROM prompt_wizard_batches WHERE id = $1 FOR UPDATE',
      [input.batch.id],
    );
    const locked = current.rows[0];
    if (!locked || locked.status !== 'processing') return;
    if (locked.credit_status === 'held' && toInt(locked.credits) > 0) {
      await settlePromptWizardCreditsWithClient(client, locked.id);
    }
    await client.query(
      `UPDATE prompt_wizard_batches
       SET status = 'completed', plans = $2::jsonb, strategy_signatures = $3::jsonb,
           credit_status = CASE WHEN credit_status = 'held' THEN 'settled' ELSE credit_status END,
           provider_model = $4, provider_interaction_id = $5,
           provider_input_tokens = $6, provider_output_tokens = $7,
           failure_reason = NULL, completed_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'processing'`,
      [
        locked.id,
        JSON.stringify(input.plans),
        JSON.stringify(input.strategySignatures ?? []),
        input.usage?.model ?? null,
        input.usage?.interactionId ?? null,
        input.usage?.inputTokens ?? null,
        input.usage?.outputTokens ?? null,
      ],
    );
    await client.query(
      `UPDATE prompt_wizard_runs
       SET expires_at = now() + interval '24 hours', updated_at = now()
       WHERE id = $1`,
      [locked.run_id],
    );
    await incrementPromptWizardDailyMetricsWithClient(client, input.engineVersion, {
      completedBatches: 1,
      ...(!locked.is_free ? { refreshes: 1 } : {}),
    });
  });
}

export async function processPromptWizardBatch(batchId: string) {
  const claimed = await pool.query<PromptWizardBatchRow>(
    `UPDATE prompt_wizard_batches
     SET status = 'processing', started_at = now(),
         attempt_count = attempt_count + 1, updated_at = now()
     WHERE id = $1 AND status = 'queued'
     RETURNING *`,
    [batchId],
  );
  const batch = claimed.rows[0];
  if (!batch) return;

  let usage: PromptWizardProviderUsage | null = null;
  const batchDeadlineAtMs = Date.now() + env.PROMPT_WIZARD_BATCH_BUDGET_MS;
  try {
    const profile = requireProductProfile(batch.product_profile);
    const runBrief = requireCreativeBrief(batch.creative_brief);
    const config = requireVideoConfig(batch.video_config);
    const historicalRows = await pool.query<{
      plans: unknown;
      strategy_signatures: unknown;
    }>(
      `SELECT plans, strategy_signatures
       FROM prompt_wizard_batches
       WHERE run_id = $1 AND ordinal < $2
         AND status = 'completed' AND content_purged_at IS NULL
       ORDER BY ordinal ASC`,
      [batch.run_id, toInt(batch.ordinal)],
    );
    const historicalPlans = historicalRows.rows.flatMap(row => parsePlans(row.plans));
    // 对历史排队数据再次执行同一输入门禁。若旧批次的确定性产品约束含有
    // 未确认商业主张，直接进入失败退款，避免把不可由 Draft 修复的内容发给模型。
    assertPromptWizardBatchProductInputClaims(profile);
    const runResult = await pool.query<PromptWizardRunRow>(
      `SELECT * FROM prompt_wizard_runs
       WHERE id = $1 AND user_id = $2`,
      [batch.run_id, batch.user_id],
    );
    const run = runResult.rows[0];
    if (!run) {
      throw Object.assign(new Error('当前批次引用的向导任务不存在'), {
        code: 'PROMPT_WIZARD_RUN_NOT_FOUND',
      });
    }
    if (batch.route_set_id) {
      assertPromptWizardV6Run(run);
      if (
        run.status !== 'ready'
        || toInt(run.revision) !== toInt(batch.run_revision)
      ) {
        throw Object.assign(new Error('当前批次的商品识别版本已失效'), {
          code: 'PROMPT_WIZARD_ROUTE_SET_STALE',
        });
      }
      assertPromptWizardRunContentReady(run);
      const routeSetResult = await pool.query<PromptWizardRouteSetV6Row>(
        `SELECT * FROM prompt_wizard_route_sets
         WHERE id = $1 AND run_id = $2 AND user_id = $3`,
        [batch.route_set_id, batch.run_id, batch.user_id],
      );
      const routeSetRow = routeSetResult.rows[0];
      if (
        !routeSetRow
        || routeSetRow.status !== 'completed'
        || toInt(routeSetRow.run_revision) !== toInt(batch.run_revision)
      ) {
        throw Object.assign(new Error('当前批次的内部三路线已失效'), {
          code: 'PROMPT_WIZARD_ROUTE_SET_STALE',
        });
      }
      const routeSet = parsePromptWizardRouteSetV6(routeSetRow);
      const brief = requirePromptWizardV6CreativeBrief(runBrief);
      const soundDesignOnly = config.durationSeconds === 5;
      if (
        (soundDesignOnly && brief.audioMode !== 'sound-design-only')
        || (!soundDesignOnly && brief.audioMode !== 'voiceover')
      ) {
        throw Object.assign(new Error('V6 批次声音模式与视频时长不匹配'), {
          code: 'PROMPT_WIZARD_BRIEF_VERSION_INVALID',
        });
      }
      // 5 秒仍持久化真实优惠供发布标题、商品卡或文案承接，但生成上下文必须
      // 完全移除该文本，避免它经产品确认声明或证据图谱回流到 Provider 与执行提示词。
      const generationProfile = soundDesignOnly
        ? omitPromptWizardConfirmedOffer(profile, brief.verifiedOffer)
        : profile;
      // verifiedOffer 只在创建批次时由用户填写，因此 run 级预生成证据图谱
      // 不可能包含它。基于批次快照重新对账，既保留图片溯源，又为优惠新增
      // user-confirmed 证据，供 Provider 安全门禁和 V6 卡片标签共同引用。
      const batchEvidenceGraph = reconcilePromptWizardEvidenceGraphForProfileUpdate({
        profile: generationProfile,
        imageAssetIds: batch.image_asset_ids,
        previousGraph: requireEvidenceGraph(run.evidence_graph),
      });
      const generated = await generateValidatedPromptWizardRoutePlansV6({
        provider: getPromptWizardProvider()!,
        profile: generationProfile,
        evidenceGraph: batchEvidenceGraph,
        ...(brief.audioMode === 'voiceover'
          ? { voiceoverLanguage: brief.voiceoverLanguage }
          : {}),
        verifiedOffer: brief.verifiedOffer,
        config,
        routeSet,
        imageCount: batch.image_asset_ids.length,
        variationKey: toInt(batch.ordinal),
        deadlineAtMs: batchDeadlineAtMs,
        historicalPlans,
        costOwner: {
          runId: batch.run_id,
          batchId: batch.id,
          deliveryVersion: 6,
          userId: batch.user_id,
          jobAttempt: toInt(batch.attempt_count),
          repairRound: 0,
        },
      });
      usage = generated.usage;
      await completePromptWizardBatch({
        batch,
        plans: generated.plans,
        usage,
        engineVersion: 4,
      });
      return;
    }
    if (batch.concept_set_id) {
      // V4 新建入口已经退役；这里只完成滚动发布前已持久化的旧批次。
      assertPromptWizardV3Run(run);
      if (
        run.status !== 'ready'
        || toInt(run.revision) !== toInt(batch.run_revision)
      ) {
        throw Object.assign(new Error('当前批次的创意路线版本已失效'), {
          code: 'PROMPT_WIZARD_CONCEPT_SET_STALE',
        });
      }
      assertPromptWizardRunContentReady(run);
      const conceptSetResult = await pool.query<PromptWizardConceptSetRow>(
        `SELECT * FROM prompt_wizard_concept_sets
         WHERE id = $1 AND run_id = $2 AND user_id = $3`,
        [batch.concept_set_id, batch.run_id, batch.user_id],
      );
      const conceptSet = conceptSetResult.rows[0];
      if (
        !conceptSet
        || conceptSet.status !== 'completed'
        || conceptSet.content_purged_at
        || toInt(conceptSet.run_revision) !== toInt(batch.run_revision)
        || batch.selected_concept_ids.length !== PROMPT_WIZARD_PLAN_COUNT
        || new Set(batch.selected_concept_ids).size !== PROMPT_WIZARD_PLAN_COUNT
      ) {
        throw Object.assign(new Error('当前批次的创意路线已失效'), {
          code: 'PROMPT_WIZARD_CONCEPT_SET_STALE',
        });
      }
      const candidates = parsePromptWizardConcepts(conceptSet.candidates);
      const conceptPreviews = batch.selected_concept_ids.map(conceptId => (
        candidates.find(candidate => candidate.id === conceptId)
      ));
      if (conceptPreviews.some((concept): concept is undefined => !concept)) {
        throw Object.assign(new Error('当前批次引用了不存在的创意路线'), {
          code: 'PROMPT_WIZARD_CONCEPT_SELECTION_INVALID',
        });
      }
      const selectedConcepts = conceptPreviews as PromptWizardConceptPreview[];
      const strategies = selectedConcepts.map(concept => concept.strategy);
      const conceptAssignments = selectedConcepts.map((concept, planIndex) => (
        conceptPreviewToAssignment(
          concept,
          PROMPT_WIZARD_LEGACY_PLAN_INDEXES[planIndex]!,
        )
      ));
      const legacyBrief = requirePromptWizardLegacyCreativeBrief(runBrief);
      const generated = await generateValidatedPromptWizardPlans({
        provider: getPromptWizardProvider()!,
        profile,
        evidenceGraph: requireEvidenceGraph(run.evidence_graph),
        brief: legacyBrief,
        config,
        strategies,
        conceptAssignments,
        conceptPreviews: selectedConcepts,
        imageCount: batch.image_asset_ids.length,
        variationKey: toInt(batch.ordinal),
        deadlineAtMs: batchDeadlineAtMs,
        historicalPlans,
        costOwner: {
          runId: batch.run_id,
          batchId: batch.id,
          userId: batch.user_id,
          jobAttempt: toInt(batch.attempt_count),
          repairRound: 0,
        },
      });
      usage = generated.usage;
      await completePromptWizardBatch({
        batch,
        plans: generated.plans,
        usage,
        engineVersion: 3,
        strategySignatures: strategies.map(strategySignature),
      });
      return;
    }
    const brief = requirePromptWizardLegacyCreativeBrief(runBrief);
    if (!batch.use_direction_set_id || !batch.selected_use_direction_id) {
      throw Object.assign(new Error('当前批次缺少产品使用方向'), {
        code: 'PROMPT_WIZARD_USE_DIRECTION_SELECTION_REQUIRED',
      });
    }
    const useDirectionSetResult = await pool.query<PromptWizardUseDirectionSetRow>(
      `SELECT * FROM prompt_wizard_use_direction_sets
       WHERE id = $1 AND run_id = $2 AND user_id = $3`,
      [batch.use_direction_set_id, batch.run_id, batch.user_id],
    );
    const useDirectionSet = useDirectionSetResult.rows[0];
    const legacyRun = run;
    if (legacyRun) assertPromptWizardV3Run(legacyRun);
    if (
      !useDirectionSet
      || !legacyRun
      || legacyRun.status !== 'ready'
      || toInt(legacyRun.revision) !== toInt(batch.run_revision)
      || useDirectionSet.status !== 'completed'
      || useDirectionSet.content_purged_at
      || toInt(useDirectionSet.run_revision) !== toInt(batch.run_revision)
    ) {
      throw Object.assign(new Error('当前批次的产品使用方向已失效'), {
        code: 'PROMPT_WIZARD_USE_DIRECTION_SET_STALE',
      });
    }
    assertPromptWizardRunContentReady(legacyRun);
    const evidenceGraph = requireEvidenceGraph(legacyRun.evidence_graph);
    const directions = parsePromptWizardUseDirections(useDirectionSet.directions);
    const selectedUseDirection = directions.find(
      direction => direction.id === batch.selected_use_direction_id,
    );
    if (!selectedUseDirection) {
      throw Object.assign(new Error('当前批次引用了不存在的产品使用方向'), {
        code: 'PROMPT_WIZARD_USE_DIRECTION_SELECTION_INVALID',
      });
    }
    const selectedScene = validatePromptWizardUseDirectionSelection({
      direction: selectedUseDirection,
      selectedSceneId: batch.selected_scene_id,
      customScene: batch.custom_scene as PromptWizardCustomScene | null,
      evidenceGraph,
      userConfirmedClaims: profile.userConfirmedClaims,
    });
    const useDirectionSnapshot = {
      id: selectedUseDirection.id,
      title: selectedUseDirection.title,
      useMoment: selectedUseDirection.useMoment,
      audienceNeed: selectedUseDirection.audienceNeed,
      purchaseReason: selectedUseDirection.purchaseReason,
      proofAction: selectedUseDirection.proofAction,
      evidenceIds: selectedUseDirection.evidenceIds,
      appearanceMode: selectedUseDirection.appearanceMode,
      internalDirection: selectedUseDirection.internalDirection,
      requiredAssets: selectedUseDirection.requiredAssets,
    };
    const planContexts: PromptWizardUseDirectionPlanContext[] = [
      {
        planIndex: 0,
        variant: 'reliable',
        useDirection: useDirectionSnapshot,
        selectedScene,
      },
      {
        planIndex: 1,
        variant: 'hook',
        useDirection: useDirectionSnapshot,
        selectedScene,
      },
    ];
    console.info(JSON.stringify({
      event: 'prompt-wizard-use-direction-selected',
      runId: batch.run_id,
      batchId: batch.id,
      useDirectionSetId: useDirectionSet.id,
      selectedUseDirectionId: selectedUseDirection.id,
      selectedSceneId: selectedScene.id,
    }));
    const generated = await generateValidatedPromptWizardUseDirectionPlans({
      provider: getPromptWizardProvider()!,
      profile,
      targetLanguage: brief.targetLanguage,
      confirmedOffer: brief.confirmedOffer,
      config,
      planContexts,
      evidenceGraph,
      imageCount: batch.image_asset_ids.length,
      variationKey: toInt(batch.ordinal),
      deadlineAtMs: batchDeadlineAtMs,
      historicalPlans,
      costOwner: {
        runId: batch.run_id,
        batchId: batch.id,
        userId: batch.user_id,
        jobAttempt: toInt(batch.attempt_count),
        repairRound: 0,
      },
    });
    const plans = generated.plans;
    usage = generated.usage;

    await withTransaction(async client => {
      const current = await client.query<PromptWizardBatchRow>(
        'SELECT * FROM prompt_wizard_batches WHERE id = $1 FOR UPDATE',
        [batch.id],
      );
      const locked = current.rows[0];
      if (!locked || locked.status !== 'processing') return;
      if (locked.credit_status === 'held' && toInt(locked.credits) > 0) {
        await settlePromptWizardCreditsWithClient(client, locked.id);
      }
      await client.query(
        `UPDATE prompt_wizard_batches
         SET status = 'completed', plans = $2::jsonb, strategy_signatures = $3::jsonb,
             credit_status = CASE WHEN credit_status = 'held' THEN 'settled' ELSE credit_status END,
             provider_model = $4, provider_interaction_id = $5,
             provider_input_tokens = $6, provider_output_tokens = $7,
             failure_reason = NULL, completed_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'processing'`,
        [
          locked.id,
          JSON.stringify(plans),
          '[]',
          usage?.model ?? null,
          usage?.interactionId ?? null,
          usage?.inputTokens ?? null,
          usage?.outputTokens ?? null,
        ],
      );
      await client.query(
        `UPDATE prompt_wizard_runs
         SET expires_at = now() + interval '24 hours', updated_at = now()
         WHERE id = $1`,
        [locked.run_id],
      );
      await incrementPromptWizardDailyMetricsWithClient(
        client,
        3,
        {
        completedBatches: 1,
        // 失败的免费首批会占用 ordinal，但不会占用“首个成功批次免费”资格。
        // 换批指标必须以服务端最终计费事实为准，不能把免费失败重试误算成刷新。
        ...(!locked.is_free ? { refreshes: 1 } : {}),
        },
      );
    });
  } catch (error) {
    const failureUsage = mergePromptWizardProviderFailureUsage(usage, error);
    logPromptWizardBatchFailure(batch, error, failureUsage);
    await failPromptWizardBatch(
      batch,
      error,
      failureUsage,
    );
  }
}

export async function recoverPromptWizardJobs() {
  // Migration 070 没有 route_sets。引擎 3 代表 V6 数据结构尚未原子落地，
  // 此时恢复器保持完全只读，既不触碰缺失表，也不领取已退役任务。
  if (await readPromptWizardRuntimeEngineVersion() !== 4) {
    return {
      runs: [],
      conceptSets: [],
      useDirectionSets: [],
      routeSets: [],
      batches: [],
      planRevisions: [],
    };
  }
  await pool.query(
    `UPDATE prompt_wizard_use_direction_sets direction_set
     SET status = 'queued', started_at = NULL, updated_at = now()
     WHERE direction_set.status = 'processing'
       AND direction_set.started_at < now() - interval '5 minutes'
       AND EXISTS (
         SELECT 1 FROM prompt_wizard_runs run
         WHERE run.id = direction_set.run_id AND run.engine_version = 3
       )`,
  );
  await pool.query(
    `UPDATE prompt_wizard_runs
     SET started_at = NULL, updated_at = now()
     WHERE engine_version IN (3, 4)
       AND status = 'analyzing' AND started_at < now() - interval '5 minutes'`,
  );
  await pool.query(
    `UPDATE prompt_wizard_route_sets route_set
     SET status = 'queued', started_at = NULL, updated_at = now()
     WHERE route_set.status = 'processing'
       AND route_set.started_at < now() - interval '5 minutes'
       AND EXISTS (
         SELECT 1 FROM prompt_wizard_runs run
         WHERE run.id = route_set.run_id AND run.engine_version = 4
       )`,
  );
  await pool.query(
    `UPDATE prompt_wizard_concept_sets concept_set
     SET status = 'queued', started_at = NULL, updated_at = now()
     WHERE concept_set.status = 'processing'
       AND concept_set.started_at < now() - interval '5 minutes'
       AND EXISTS (
         SELECT 1 FROM prompt_wizard_runs run
         WHERE run.id = concept_set.run_id AND run.engine_version = 3
       )`,
  );
  await pool.query(
    `UPDATE prompt_wizard_batches batch
     SET status = 'queued', started_at = NULL, updated_at = now()
     WHERE batch.status = 'processing'
       AND batch.started_at < now() - interval '5 minutes'
       AND EXISTS (
         SELECT 1 FROM prompt_wizard_runs run
         WHERE run.id = batch.run_id AND run.engine_version IN (3, 4)
       )`,
  );
  await pool.query(
    `UPDATE prompt_wizard_plan_revisions revision
     SET status = 'queued', started_at = NULL, updated_at = now()
     WHERE revision.status = 'processing'
       AND revision.started_at < now() - interval '5 minutes'
       AND EXISTS (
         SELECT 1 FROM prompt_wizard_runs run
         WHERE run.id = revision.run_id AND run.engine_version = 3
       )`,
  );
  const [runs, conceptSets, useDirectionSets, routeSets, batches, planRevisions] = await Promise.all([
    pool.query<{ id: string; attempt_count: number | string }>(
      `SELECT id, attempt_count FROM prompt_wizard_runs
       WHERE engine_version IN (3, 4) AND status = 'analyzing' AND started_at IS NULL
       ORDER BY created_at ASC LIMIT 200`,
    ),
    pool.query<{ id: string; attempt_count: number | string }>(
      `SELECT concept_set.id, concept_set.attempt_count
       FROM prompt_wizard_concept_sets concept_set
       JOIN prompt_wizard_runs run
         ON run.id = concept_set.run_id AND run.engine_version = 3
       WHERE concept_set.status = 'queued'
       ORDER BY concept_set.created_at ASC LIMIT 200`,
    ),
    pool.query<{ id: string; attempt_count: number | string }>(
      `SELECT direction_set.id, direction_set.attempt_count
       FROM prompt_wizard_use_direction_sets direction_set
       JOIN prompt_wizard_runs run
         ON run.id = direction_set.run_id AND run.engine_version = 3
      WHERE direction_set.status = 'queued'
      ORDER BY direction_set.created_at ASC LIMIT 200`,
    ),
    pool.query<{ id: string; attempt_count: number | string }>(
      `SELECT route_set.id, route_set.attempt_count
       FROM prompt_wizard_route_sets route_set
       JOIN prompt_wizard_runs run
         ON run.id = route_set.run_id AND run.engine_version = 4
       WHERE route_set.status = 'queued'
       ORDER BY route_set.created_at ASC LIMIT 200`,
    ),
    pool.query<{ id: string; attempt_count: number | string }>(
      `SELECT batch.id, batch.attempt_count
       FROM prompt_wizard_batches batch
       JOIN prompt_wizard_runs run
         ON run.id = batch.run_id AND run.engine_version IN (3, 4)
       WHERE batch.status = 'queued'
       ORDER BY batch.created_at ASC LIMIT 200`,
    ),
    pool.query<{ id: string; attempt_count: number | string }>(
      `SELECT revision.id, revision.attempt_count
       FROM prompt_wizard_plan_revisions revision
       JOIN prompt_wizard_runs run
         ON run.id = revision.run_id AND run.engine_version = 3
       WHERE revision.status = 'queued'
       ORDER BY revision.created_at ASC LIMIT 200`,
    ),
  ]);
  return {
    runs: runs.rows.map(row => ({ id: row.id, attempt: toInt(row.attempt_count) })),
    conceptSets: conceptSets.rows.map(row => ({
      id: row.id,
      attempt: toInt(row.attempt_count),
    })),
    useDirectionSets: useDirectionSets.rows.map(row => ({
      id: row.id,
      attempt: toInt(row.attempt_count),
    })),
    routeSets: routeSets.rows.map(row => ({
      id: row.id,
      attempt: toInt(row.attempt_count),
    })),
    batches: batches.rows.map(row => ({ id: row.id, attempt: toInt(row.attempt_count) })),
    planRevisions: planRevisions.rows.map(row => ({ id: row.id, attempt: toInt(row.attempt_count) })),
  };
}

export async function purgeExpiredPromptWizardContent() {
  // 071 之前的清理 SQL 同样不能引用 route_sets。等待引擎迁移完成后再统一清理，
  // 比在旧结构上做部分清理更安全，也避免正文与任务状态出现半清理状态。
  if (await readPromptWizardRuntimeEngineVersion() !== 4) return 0;
  return withTransaction(async client => {
    const runs = await client.query<{ id: string }>(
      `UPDATE prompt_wizard_runs run
       SET status = 'archived', image_asset_ids = '{}'::uuid[],
           product_profile = NULL, creative_brief = NULL, video_config = NULL,
           production_brief = NULL, evidence_graph = NULL,
           failure_reason = NULL, updated_at = now()
       WHERE run.expires_at <= now() AND run.status <> 'archived'
         -- 产品识别本身没有子任务表；started_at 非空表示 worker 正持有该任务。
         -- 先保护真实运行中的识别，避免清理与 Provider 回写竞争。
         AND NOT (run.status = 'analyzing' AND run.started_at IS NOT NULL)
         AND NOT EXISTS (
           SELECT 1 FROM prompt_wizard_batches batch
         WHERE batch.run_id = run.id AND batch.status IN ('queued', 'processing')
         )
         AND NOT EXISTS (
           SELECT 1 FROM prompt_wizard_concept_sets concept_set
           WHERE concept_set.run_id = run.id AND concept_set.status IN ('queued', 'processing')
         )
         AND NOT EXISTS (
           SELECT 1 FROM prompt_wizard_use_direction_sets direction_set
           WHERE direction_set.run_id = run.id AND direction_set.status IN ('queued', 'processing')
         )
         AND NOT EXISTS (
           SELECT 1 FROM prompt_wizard_route_sets route_set
           WHERE route_set.run_id = run.id AND route_set.status IN ('queued', 'processing')
         )
         AND NOT EXISTS (
           SELECT 1 FROM prompt_wizard_plan_revisions revision
           WHERE revision.run_id = run.id AND revision.status IN ('queued', 'processing')
         )
       RETURNING id`,
    );
    if (!runs.rowCount) return 0;
    const runIds = runs.rows.map(row => row.id);
    await client.query(
      `UPDATE prompt_wizard_concept_sets
       SET candidates = NULL, recommended_concept_ids = '{}'::uuid[],
           failure_reason = NULL, content_purged_at = now(), updated_at = now()
       WHERE run_id = ANY($1::uuid[]) AND content_purged_at IS NULL`,
      [runIds],
    );
    await client.query(
      `UPDATE prompt_wizard_use_direction_sets
       SET directions = NULL, clarification_question = NULL,
           failure_reason = NULL, content_purged_at = now(), updated_at = now()
       WHERE run_id = ANY($1::uuid[]) AND content_purged_at IS NULL`,
      [runIds],
    );
    await client.query(
      `UPDATE prompt_wizard_route_sets
       SET routes = NULL, failure_reason = NULL,
           content_purged_at = now(), updated_at = now()
       WHERE run_id = ANY($1::uuid[]) AND content_purged_at IS NULL`,
      [runIds],
    );
    await client.query(
      `UPDATE prompt_wizard_plan_revisions
       SET plan = NULL, failure_reason = NULL,
           content_purged_at = now(), updated_at = now()
       WHERE run_id = ANY($1::uuid[]) AND content_purged_at IS NULL`,
      [runIds],
    );
    await client.query(
      `UPDATE prompt_wizard_batches
       SET image_asset_ids = '{}'::uuid[], plans = NULL,
           product_profile = '{}'::jsonb, creative_brief = '{}'::jsonb, video_config = '{}'::jsonb,
           strategy_signatures = '[]'::jsonb, custom_scene = NULL,
           content_purged_at = now(), updated_at = now()
       WHERE run_id = ANY($1::uuid[]) AND content_purged_at IS NULL`,
      [runIds],
    );
    return runs.rowCount;
  });
}

async function failPromptWizardBatch(
  batch: PromptWizardBatchRow,
  error: unknown,
  usage: PromptWizardProviderUsage | null,
) {
  await withTransaction(async client => {
    const current = await client.query<PromptWizardBatchRow>(
      'SELECT * FROM prompt_wizard_batches WHERE id = $1 FOR UPDATE',
      [batch.id],
    );
    const locked = current.rows[0];
    if (!locked || !['queued', 'processing'].includes(locked.status)) return;
    if (locked.credit_status === 'held' && toInt(locked.credits) > 0) {
      await releasePromptWizardCreditsWithClient(client, locked.user_id, locked.id);
    }
    await client.query(
      `UPDATE prompt_wizard_batches
       SET status = 'failed', plans = NULL,
           credit_status = CASE WHEN credit_status = 'held' THEN 'refunded' ELSE credit_status END,
           provider_model = COALESCE($3, provider_model),
           provider_interaction_id = COALESCE($4, provider_interaction_id),
           provider_input_tokens = COALESCE($5, provider_input_tokens),
           provider_output_tokens = COALESCE($6, provider_output_tokens),
           failure_reason = $2, completed_at = now(), updated_at = now()
       WHERE id = $1 AND status IN ('queued', 'processing')`,
      [
        locked.id,
        promptWizardFailureMessage(error),
        usage?.model ?? null,
        usage?.interactionId ?? null,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
      ],
    );
    await client.query(
      `UPDATE prompt_wizard_runs
       SET expires_at = now() + interval '24 hours', updated_at = now()
       WHERE id = $1`,
      [locked.run_id],
    );
  });
}

async function failPromptWizardConceptSet(
  conceptSet: PromptWizardConceptSetRow,
  error: unknown,
  usage: PromptWizardProviderUsage | null,
) {
  await pool.query(
    `UPDATE prompt_wizard_concept_sets
     SET status = 'failed', candidates = NULL,
         recommended_concept_ids = '{}'::uuid[],
         failure_reason = $2,
         provider_model = COALESCE($3, provider_model),
         provider_interaction_id = COALESCE($4, provider_interaction_id),
         provider_input_tokens = COALESCE($5, provider_input_tokens),
         provider_output_tokens = COALESCE($6, provider_output_tokens),
         completed_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'processing'`,
    [
      conceptSet.id,
      promptWizardConceptFailureMessage(error),
      usage?.model ?? null,
      usage?.interactionId ?? null,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
    ],
  );
}

async function failPromptWizardUseDirectionSet(
  directionSet: PromptWizardUseDirectionSetRow,
  error: unknown,
  usage: PromptWizardProviderUsage | null,
) {
  await pool.query(
    `UPDATE prompt_wizard_use_direction_sets
     SET status = 'failed', directions = NULL,
         clarification_question = NULL,
         failure_reason = $2,
         provider_model = COALESCE($3, provider_model),
         provider_interaction_id = COALESCE($4, provider_interaction_id),
         provider_input_tokens = COALESCE($5, provider_input_tokens),
         provider_output_tokens = COALESCE($6, provider_output_tokens),
         completed_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'processing'`,
    [
      directionSet.id,
      promptWizardUseDirectionFailureMessage(error),
      usage?.model ?? null,
      usage?.interactionId ?? null,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
    ],
  );
}

async function failPromptWizardPlanRevision(
  revision: PromptWizardPlanRevisionRow,
  error: unknown,
  usage: PromptWizardProviderUsage | null,
) {
  await pool.query(
    `UPDATE prompt_wizard_plan_revisions
     SET status = 'failed', plan = NULL, failure_reason = $2,
         provider_model = COALESCE($3, provider_model),
         provider_interaction_id = COALESCE($4, provider_interaction_id),
         provider_input_tokens = COALESCE($5, provider_input_tokens),
         provider_output_tokens = COALESCE($6, provider_output_tokens),
         completed_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'processing'`,
    [
      revision.id,
      promptWizardRefinementFailureMessage(error),
      usage?.model ?? null,
      usage?.interactionId ?? null,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
    ],
  );
}

async function requireOwnedImageAssets(client: DbClient, userId: string, assetIds: string[]) {
  const assets = await readOwnedAssetReferencesByIds(client, userId, assetIds);
  if (assets.size !== assetIds.length || assetIds.some(id => assets.get(id)?.type !== 'image')) {
    throw serviceError(
      '向导只接受当前账号中仍可用的图片资产',
      400,
      'PROMPT_WIZARD_IMAGE_ASSET_INVALID',
    );
  }
  return assets;
}

async function assertVideoConfigAvailable(client: DbClient, rawConfig: PromptWizardVideoConfig) {
  const config = promptWizardVideoConfigSchema.parse(rawConfig);
  const result = await client.query(
    `SELECT 1 FROM consumption_settings
     WHERE kind = 'video' AND model = $1 AND duration_seconds = $2
       AND resolution = $3 AND available = true
     LIMIT 1`,
    [VIDEO_MODEL_LABELS[config.model], config.durationSeconds, config.resolution],
  );
  if (!result.rowCount) {
    throw serviceError('所选视频模型或规格当前不可用', 400, 'PROMPT_WIZARD_VIDEO_CONFIG_UNAVAILABLE');
  }
}

export function promptWizardThumbnailObjectKey(asset: OwnedAssetReferenceRow) {
  if (
    asset.thumbnail_status === 'ready'
    && asset.thumbnail_key
    && asset.thumbnail_key !== asset.object_key
    && /\.webp(?:$|\?)/i.test(asset.thumbnail_key)
  ) return asset.thumbnail_key;
  throw serviceError(
    '产品图片缩略图尚未就绪，请稍后重新识别',
    409,
    'PROMPT_WIZARD_IMAGE_THUMBNAIL_NOT_READY',
  );
}

function imageMimeType(objectKey: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (/\.png(?:$|\?)/i.test(objectKey)) return 'image/png';
  if (/\.webp(?:$|\?)/i.test(objectKey)) return 'image/webp';
  return 'image/jpeg';
}

function requireProductProfile(value: unknown) {
  if (!value) throw serviceError('请先确认产品信息', 400, 'PROMPT_WIZARD_PRODUCT_REQUIRED');
  return normalizePromptWizardProductProfile(
    promptWizardRunSchema.shape.productProfile.unwrap().parse(value),
  );
}

function requireEvidenceGraph(value: unknown): PromptWizardEvidenceGraph {
  if (!value) {
    throw serviceError('产品证据图谱尚未就绪', 409, 'PROMPT_WIZARD_EVIDENCE_GRAPH_REQUIRED');
  }
  return promptWizardEvidenceGraphSchema.parse(value);
}

function requireProductionBrief(value: unknown): PromptWizardProductionBrief {
  if (!value) {
    throw serviceError('请先确认购买理由和可用生产条件', 400, 'PROMPT_WIZARD_PRODUCTION_BRIEF_REQUIRED');
  }
  return promptWizardProductionBriefSchema.parse(value);
}

function normalizePromptWizardProductProfile(profile: PromptWizardProductProfile) {
  const normalized = { ...profile, colors: '' };
  return {
    ...normalized,
    // 不信任模型直接给出的“普通功能”；识别与用户修正均按同一封闭白名单重算。
    categoryInferredFunctions: inferPromptWizardOrdinaryCategoryFunctions(normalized),
  };
}

export function assertPromptWizardBatchProductInputClaims(
  profile: PromptWizardProductProfile,
) {
  try {
    assertPromptWizardProductInputClaims(profile);
  } catch (error) {
    if (errorCode(error) !== 'PROMPT_WIZARD_PRODUCT_INPUT_CLAIM_INVALID') throw error;
    const labels: Record<string, string> = {
      materials: '材质',
      structure: '结构与关键部件',
      logo: 'Logo / 品牌标识',
      usage: '使用方式',
      consistencyConstraints: '产品一致性约束',
    };
    const fields = promptWizardRawFieldPaths(error)
      .map(fieldPath => labels[fieldPath] ?? fieldPath)
      .join('、');
    throw serviceError(
      `产品信息中的${fields || '一致性内容'}包含未确认的商业主张，请删除相关内容，或移入“您确认的卖点、数字、价格或认证”后重试。`,
      400,
      'PROMPT_WIZARD_PRODUCT_INPUT_CLAIM_INVALID',
    );
  }
}

function requireCreativeBrief(value: unknown) {
  if (!value) throw serviceError('请先选择创作方向', 400, 'PROMPT_WIZARD_BRIEF_REQUIRED');
  return promptWizardRunSchema.shape.creativeBrief.unwrap().parse(value);
}

function requirePromptWizardLegacyCreativeBrief(
  brief: PromptWizardRunCreativeBrief,
): PromptWizardCreativeBrief {
  if ('targetLanguage' in brief) return brief;
  throw Object.assign(new Error('历史 V5 批次缺少旧版创意配置'), {
    code: 'PROMPT_WIZARD_BRIEF_VERSION_INVALID',
  });
}

function requirePromptWizardV6CreativeBrief(
  brief: PromptWizardRunCreativeBrief,
): PromptWizardCreativeBriefV6 {
  if ('audioMode' in brief) return brief;
  throw Object.assign(new Error('V6 批次缺少声音模式与真实优惠信息'), {
    code: 'PROMPT_WIZARD_BRIEF_VERSION_INVALID',
  });
}

function requireVideoConfig(value: unknown) {
  if (!value) throw serviceError('请先确认视频配置', 400, 'PROMPT_WIZARD_VIDEO_CONFIG_REQUIRED');
  return promptWizardVideoConfigSchema.parse(value);
}

function mapPromptWizardRun(row: PromptWizardRunRow): PromptWizardRun {
  const productProfile = row.product_profile
    ? normalizePromptWizardProductProfile(
        promptWizardRunSchema.shape.productProfile.unwrap().parse(row.product_profile),
      )
    : row.product_profile;
  return promptWizardRunSchema.parse({
    id: row.id,
    engineVersion: toInt(row.engine_version),
    status: row.status,
    revision: toInt(row.revision),
    imageAssetIds: row.image_asset_ids,
    productProfile,
    creativeBrief: row.creative_brief,
    videoConfig: row.video_config,
    productionBrief: row.production_brief
      ? promptWizardProductionBriefSchema.parse(row.production_brief)
      : null,
    evidenceGraph: row.evidence_graph
      ? promptWizardEvidenceGraphSchema.parse(row.evidence_graph)
      : null,
    failureReason: row.failure_reason,
    createdAt: toIsoDateTime(row.created_at),
    updatedAt: toIsoDateTime(row.updated_at),
  });
}

function mapPromptWizardBatch(row: PromptWizardBatchRow): PromptWizardBatch {
  return promptWizardBatchSchema.parse({
    id: row.id,
    runId: row.run_id,
    status: row.status,
    isFree: Boolean(row.is_free),
    credits: toInt(row.credits),
    creditStatus: row.credit_status,
    plans: row.plans ? parsePlans(row.plans) : [],
    conceptSetId: row.concept_set_id ?? null,
    selectedConceptIds: Array.isArray(row.selected_concept_ids)
      ? row.selected_concept_ids
      : [],
    useDirectionSetId: row.use_direction_set_id ?? null,
    selectedUseDirectionId: row.selected_use_direction_id ?? null,
    selectedSceneId: row.selected_scene_id ?? null,
    customScene: row.custom_scene ?? null,
    routeSetId: row.route_set_id ?? null,
    failureReason: row.failure_reason,
    createdAt: toIsoDateTime(row.created_at),
    completedAt: row.completed_at ? toIsoDateTime(row.completed_at) : null,
  });
}

function mapPromptWizardConceptSet(row: PromptWizardConceptSetRow): PromptWizardConceptSet {
  return promptWizardConceptSetSchema.parse({
    id: row.id,
    runId: row.run_id,
    status: row.status,
    runRevision: toInt(row.run_revision),
    candidates: row.candidates ? parsePromptWizardConcepts(row.candidates) : [],
    recommendedConceptIds: Array.isArray(row.recommended_concept_ids)
      ? row.recommended_concept_ids
      : [],
    failureReason: row.failure_reason,
    createdAt: toIsoDateTime(row.created_at),
    completedAt: row.completed_at ? toIsoDateTime(row.completed_at) : null,
  });
}

function mapPromptWizardUseDirectionSet(
  row: PromptWizardUseDirectionSetRow,
): PromptWizardUseDirectionSet {
  return promptWizardUseDirectionSetSchema.parse({
    id: row.id,
    runId: row.run_id,
    status: row.status,
    runRevision: toInt(row.run_revision),
    directions: row.directions ? parsePromptWizardUseDirections(row.directions) : [],
    clarificationQuestion: row.clarification_question,
    failureReason: row.failure_reason,
    createdAt: toIsoDateTime(row.created_at),
    completedAt: row.completed_at ? toIsoDateTime(row.completed_at) : null,
  });
}

function mapPromptWizardPlanRevision(row: PromptWizardPlanRevisionRow): PromptWizardPlanRevision {
  return promptWizardPlanRevisionSchema.parse({
    id: row.id,
    batchId: row.batch_id,
    sourcePlanId: row.source_plan_id,
    conceptId: row.concept_id,
    useDirectionId: row.use_direction_id,
    planIndex: toPromptWizardPlanIndex(toInt(row.plan_index)),
    action: row.action,
    status: row.status,
    isFree: Boolean(row.is_free),
    plan: row.plan ? promptWizardPlanSchema.parse(row.plan) : null,
    failureReason: row.failure_reason,
    createdAt: toIsoDateTime(row.created_at),
    completedAt: row.completed_at ? toIsoDateTime(row.completed_at) : null,
  });
}

function mapPromptWizardSettings(row: PromptWizardSettingsRow) {
  return promptWizardSettingsSchema.parse({
    generationCredits: toInt(row.refresh_credits),
    available: Boolean(row.available),
    engineVersion: toInt(row.engine_version),
    updatedAt: toIsoDateTime(row.updated_at),
  });
}

function parsePlans(value: unknown) {
  const parsed = Array.isArray(value) ? value : [];
  return promptWizardPlanSchema.array().parse(parsed).map(plan => ({
    ...plan,
    prompt: normalizePromptWizardProductionPrompt(plan.prompt),
  }));
}

function parsePromptWizardConcepts(value: unknown): PromptWizardConceptPreview[] {
  return promptWizardConceptPreviewSchema.array().max(8).parse(
    Array.isArray(value) ? value : [],
  );
}

function parsePromptWizardUseDirections(value: unknown): PromptWizardUseDirection[] {
  return promptWizardUseDirectionSchema.array().max(3).parse(Array.isArray(value) ? value : []);
}

function parsePromptWizardRouteSetV6(row: PromptWizardRouteSetV6Row): PromptWizardRouteSetV6 {
  return promptWizardRouteSetV6Schema.parse({
    id: row.id,
    runId: row.run_id,
    status: row.status,
    runRevision: toInt(row.run_revision),
    routes: row.routes ?? [],
    failureReason: row.failure_reason,
    createdAt: toIsoDateTime(row.created_at),
    completedAt: row.completed_at ? toIsoDateTime(row.completed_at) : null,
  });
}

function isPromptWizardPlanV5(plan: PromptWizardPlan): plan is PromptWizardPlanV5 {
  return plan.deliveryVersion === 5;
}

function isPromptWizardPlanV4(plan: PromptWizardPlan): plan is PromptWizardPlanV4 {
  return plan.deliveryVersion === 4;
}

function promptWizardPlanToDraft(
  plan: PromptWizardPlan,
  context: {
    profile: PromptWizardProductProfile;
    evidenceGraph: PromptWizardEvidenceGraph;
  },
): PromptWizardPlanDraft {
  if (plan.deliveryVersion === 6) {
    return {
      name: plan.name,
      hook: plan.hookZh,
      narrative: plan.narrative,
      primaryScene: plan.primaryScene,
      cameraAndPacing: plan.cameraAndPacing,
      differenceTags: [...plan.differenceTags],
      planningReview: {
        targetAudience: plan.audienceZh,
        surfaceNeed: plan.purchaseReasonZh,
        realPainPoint: plan.purchaseReasonZh,
        nonAdEntry: plan.hookZh,
        proofPoints: plan.claimBasisTags.map(tag => tag.labelZh),
        directionFit: plan.directionExplanationZh,
      },
      segments: plan.shots.map(shot => ({
        role: shot.role,
        location: shot.location,
        subject: shot.subject,
        shotSize: shot.shotSize,
        action: shot.action,
        cameraMovement: shot.cameraMovement,
        lightingAndRealism: shot.lightingAndRealism,
        foley: shot.foley,
        editingCue: shot.editingCue,
        voiceover: shot.voiceover,
        voiceoverZh: shot.voiceoverZh,
        evidenceRefs: [...shot.evidenceRefs],
        productionNote: shot.productionNote,
      })),
      productionWarnings: [...plan.productionWarnings],
    };
  }
  const proofPoints = plan.deliveryVersion === 4
    ? [...plan.planningReview.proofPoints]
    : plan.useDirection.evidenceIds.map(evidenceId => (
        context.evidenceGraph.evidences.find(evidence => evidence.id === evidenceId)?.text
          ?? plan.useDirection.purchaseReason
      ));
  const planningReview = plan.deliveryVersion === 4
    ? {
        ...plan.planningReview,
        proofPoints,
      }
    : {
        targetAudience: context.profile.suggestedAudience || '正在判断产品是否适合自己的人',
        surfaceNeed: plan.useDirection.audienceNeed,
        realPainPoint: plan.useDirection.audienceNeed,
        nonAdEntry: plan.hook,
        proofPoints,
        directionFit: `围绕“${plan.useDirection.useMoment}”完成产品自证`,
      };
  return {
    name: plan.name,
    hook: plan.hook,
    narrative: plan.narrative,
    primaryScene: plan.primaryScene,
    cameraAndPacing: plan.cameraAndPacing,
    differenceTags: [...plan.differenceTags],
    planningReview,
    segments: plan.shots.map(shot => ({
      role: shot.role,
      location: shot.location,
      subject: shot.subject,
      shotSize: shot.shotSize,
      action: shot.action,
      cameraMovement: shot.cameraMovement,
      lightingAndRealism: shot.lightingAndRealism,
      voiceover: shot.voiceover,
      voiceoverZh: shot.voiceoverZh,
      foley: shot.foley,
      editingCue: shot.editingCue,
      evidenceRefs: [...shot.evidenceRefs],
      productionNote: shot.productionNote,
    })),
    productionWarnings: [...plan.productionWarnings],
  };
}

function promptWizardRefinementIssue(input: {
  planIndex: PromptWizardPlanIndex;
  action: PromptWizardRefinementAction;
  replacementScene: string | null;
  shotCount: number;
}): PromptWizardContentRepairIssue {
  const voiceoverPaths = Array.from({ length: input.shotCount }, (_, index) => [
    `segments[${index}].voiceover`,
    `segments[${index}].voiceoverZh`,
  ]).flat();
  const definitions: Record<PromptWizardRefinementAction, {
    fieldPaths: string[];
    action: string;
  }> = {
    'stronger-hook': {
      fieldPaths: ['hook', 'narrative', 'cameraAndPacing', 'segments'],
      action: '强化第一秒的物理事件和前三秒悬念，但保留原购买理由、证据、场景和产品状态连续性；不得靠夸张宣称或不可执行变化制造钩子',
    },
    'less-ad-like': {
      fieldPaths: ['hook', 'narrative', 'cameraAndPacing', 'segments'],
      action: '降低广告腔，把表达改为真实观察、自然操作和克制口播；保留原证据链、购买理由和 CTA 回扣',
    },
    'no-face': {
      fieldPaths: ['primaryScene', 'cameraAndPacing', 'segments'],
      action: '改为不露脸执行：允许手部、背影或局部身体，但不得出现正脸、面部特写或对镜口播；保留原购买理由与证据链',
    },
    'product-only': {
      fieldPaths: ['primaryScene', 'cameraAndPacing', 'segments'],
      action: '改为纯产品展示，不出现人物、手部或虚构体验者；只用产品真实结构动作、机位、光线和环境声推进，保留原购买理由与证据链',
    },
    'change-scene': {
      fieldPaths: ['primaryScene', 'cameraAndPacing', 'segments'],
      action: `把全部镜头迁移到已确认可用场景“${input.replacementScene ?? ''}”，不得引入其他新场景、人物或道具；保留原购买理由与证据链`,
    },
    'simplify-production': {
      fieldPaths: ['cameraAndPacing', 'segments', 'productionWarnings'],
      action: '减少地点、人物、道具、主要动作和复杂运镜，改为当前时长与模型更容易稳定生成的连续镜头；保留原购买理由与证据链',
    },
    'natural-voiceover': {
      fieldPaths: voiceoverPaths,
      action: '只改写各段目标语言口播及其忠实中文译文，使表达更口语、更自然并能在对应秒数内说完；不得修改画面、事实、购买理由或 CTA 含义',
    },
  };
  const definition = definitions[input.action];
  return {
    planIndex: input.planIndex,
    errorCode: 'PROMPT_WIZARD_USER_REFINEMENT',
    fieldPaths: definition.fieldPaths,
    action: definition.action,
  };
}

function assertPromptWizardRefinementOutcome(input: {
  draft: PromptWizardPlanDraft;
  action: PromptWizardRefinementAction;
  replacementScene: string | null;
  replacementSceneEnvironment?: string | null;
  replacementSceneMainAction?: string | null;
}) {
  const executionText = [
    input.draft.primaryScene,
    ...input.draft.segments.flatMap(segment => [
      segment.location,
      segment.subject,
      segment.action,
      segment.cameraMovement,
      segment.productionNote,
    ]),
  ].join('\n');
  if (input.action === 'no-face' && /(?:正脸|面部特写|露脸|对镜口播)/u.test(executionText)) {
    throw Object.assign(new Error('不露脸微调仍要求出现面部'), {
      code: 'PROMPT_WIZARD_REFINEMENT_INVALID',
    });
  }
  if (input.action === 'product-only' && /(?:人物|主角|模特|用户|手部|双手|单手|真人)/u.test(executionText)) {
    throw Object.assign(new Error('纯产品微调仍要求人物或手部出镜'), {
      code: 'PROMPT_WIZARD_REFINEMENT_INVALID',
    });
  }
  if (
    input.action === 'change-scene'
    && input.replacementScene
  ) {
    const primarySceneMatches = input.draft.primaryScene.includes(input.replacementScene);
    const expectedEnvironment = input.replacementSceneEnvironment?.trim();
    const locationsMatch = expectedEnvironment
      ? input.draft.segments.every(segment => segment.location.includes(expectedEnvironment))
      : input.draft.segments.every(segment => segment.location.includes(input.replacementScene!));
    const expectedAction = input.replacementSceneMainAction?.trim();
    const actionMatches = expectedAction
      ? input.draft.segments.some(segment => promptWizardTextSharesAction(
        segment.action,
        expectedAction,
      ))
      : true;
    if (!primarySceneMatches || !locationsMatch || !actionMatches) {
      throw Object.assign(new Error('更换场景微调没有统一使用指定场景与产品动作'), {
        code: 'PROMPT_WIZARD_REFINEMENT_INVALID',
      });
    }
  }
}

function promptWizardTextSharesAction(left: string, right: string) {
  const terms = (value: string) => {
    const normalized = value.normalize('NFKC').replace(/[^㐀-鿿]+/gu, '');
    const result = new Set<string>();
    for (let index = 0; index < normalized.length - 1; index += 1) {
      result.add(normalized.slice(index, index + 2));
    }
    return result;
  };
  const leftTerms = terms(left);
  return [...terms(right)].some(term => leftTerms.has(term));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function promptWizardRepairFeedback(error: unknown, targetLanguage?: string) {
  const isMandarin = targetLanguage === '普通话';
  const code = errorCode(error);
  if (code === 'PROMPT_WIZARD_TIMELINE_INVALID') return '镜头数量与固定时长不匹配，请严格按 requiredSegmentCount 返回';
  if (code === 'PROMPT_WIZARD_BEAT_INVALID') return '镜头职责与固定脚本结构不匹配，请严格按 requiredShotRoles 的顺序返回';
  if (code === 'PROMPT_WIZARD_EVIDENCE_INVALID') return '产品自证引用无法追溯；proofPoints 必须逐字取自 evidenceCatalog.text，proof、proof-resolution、resolution 镜头只能引用 evidenceCatalog.id';
  if (code === 'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID') {
    const fieldPaths = promptWizardSafeFieldPaths(error);
    if (fieldPaths.some(path => (
      path === 'segments[0].subject' || path === 'segments[0].action'
    ))) {
      return '只修复首镜头：segments[0].subject 必须明确是当前产品；segments[0].action 直接使用 selectedScene.mainAction 中已验证的可拍产品动作；不得修改其他字段';
    }
    if (fieldPaths.some(path => (
      path === 'hook' || /segments\[\d+\]\.voiceover(?:Zh)?$/u.test(path)
    ))) {
      return '只删除被指出字段中所选证据之外的第二购买理由；保留 selectedUseDirection.purchaseReason、产品主体名称、场景、动作和原有语气；不得新增事实';
    }
    if (fieldPaths.includes('primaryScene')) {
      return '只修复场景字段：primaryScene 必须使用 selectedScene.title 与 selectedScene.environment，各镜头 location 保持同一环境，至少一个 action 执行 selectedScene.mainAction';
    }
    if (fieldPaths.includes('narrative')) {
      return '只修复叙事字段：全文只围绕 selectedUseDirection.purchaseReason，用 selectedUseDirection.proofAction 形成自证闭环，不得增加第二购买理由';
    }
    return '只修复被指出的字段：全文只围绕 selectedUseDirection.purchaseReason；自证镜头必须执行 selectedUseDirection.proofAction；全部地点和主动作必须属于 selectedScene；不得改变方向、购买理由、证据或场景';
  }
  if (code === 'PROMPT_WIZARD_REFERENCE_INVALID') return '出现了不存在的图片编号，只能使用 imageReferences 中的编号';
  if (code === 'PROMPT_WIZARD_REFERENCE_MODE_INVALID') {
    return '全能参考模式中出现禁用的参考定位表达；只改写所列字段为普通镜头或画面描述，不要复述规则或禁用表达，其他内容保持不变';
  }
  if (code === 'PROMPT_WIZARD_UNCONFIRMED_CLAIM') {
    const fieldPaths = promptWizardSafeFieldPaths(error);
    const fields = fieldPaths.length > 0
      ? fieldPaths.join('、')
      : '未提供可安全定位的字段路径，请检查方案中的商业事实字段';
    return `以下安全字段路径包含未经用户确认的商业事实：${fields}；必须删除所有未经用户确认的金额、百分比、带单位数字、认证、性能、功效、绝对保证、竞品结论或用户评价；不得替换为其他数字或更强结论；不要新增事实`;
  }
  if (code === 'PROMPT_WIZARD_UNSAFE_CONTENT') return '出现虚假社会证明、虚假稀缺、危险测试、魔法变化或无依据竞品结论，必须删除并改为可观察的真实动作';
  if (code === 'PROMPT_WIZARD_PROMPT_TOO_LONG') return '镜头描述过长，请压缩内容但保留两套差异';
  if (code === 'PROMPT_WIZARD_TRANSLATION_INVALID') {
    if (isMandarin) {
      return '普通话口播不生成中文译文；只将被指出字段的 voiceoverZh 清空并保持空字符串，不修改 voiceover、画面或事实';
    }
    return '口播缺少忠实的简体中文翻译，请只补齐译文，不新增事实';
  }
  if (code === 'PROMPT_WIZARD_VOICEOVER_TOO_LONG') {
    const details = promptWizardSafeVoiceoverRepairDetails(error);
    if (details) {
      const unitLabel = details.unit === 'words' ? '词' : '字';
      if (details.unit === 'words' && details.maxUnits <= 3) {
        return `只修复 ${details.fieldPath}：当前 ${details.actualUnits} 词，该镜头最多 ${details.maxUnits} 词；使用目标语言中不超过 ${details.maxUnits} 词的直接购买 CTA。英语可直接写“Tap to shop”，对应中文译文写“点击商品卡下单”；不得改变画面或新增事实`;
      }
      if (isMandarin) {
        return `只修复 ${details.fieldPath}：当前 ${details.actualUnits} ${unitLabel}，该镜头最多 ${details.maxUnits} ${unitLabel}；把该段重写为不超过上限的完整自然句，voiceoverZh 必须保持空字符串，不改变画面、事实或 CTA 含义`;
      }
      return `只修复 ${details.fieldPath}：当前 ${details.actualUnits} ${unitLabel}，该镜头最多 ${details.maxUnits} ${unitLabel}；把该段及其忠实中文译文原子重写为完整自然句，不改变画面、事实或 CTA 含义`;
    }
    if (isMandarin) {
      return '口播超过对应镜头可自然说完的长度；只压缩该段口播，voiceoverZh 必须保持空字符串，不改变画面、事实或 CTA 含义';
    }
    return '口播超过对应镜头可自然说完的长度；只压缩该段口播及其忠实中文译文，不改变画面、事实或 CTA 含义';
  }
  if (code === 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID') {
    const fieldPaths = promptWizardSafeFieldPaths(error);
    const fields = fieldPaths.length > 0 ? fieldPaths.join('、') : 'segments[].voiceover';
    const details = promptWizardSafeVoiceoverCoverageRepairDetails(error);
    if (details) {
      if (details.minUnits === 0) {
        return `只修复口播字段 ${fields}：每个镜头都返回一条完整、自然、非空的口播句；前三秒明确产品名称或品类，自证段连接可见证据与唯一购买理由，末段保留直接购买 CTA；非普通话同时原子更新忠实中文译文，不得新增事实或修改画面`;
      }
      const unitLabel = details.unit === 'words' ? '词' : '字';
      if (details.actualUnits > details.maxUnits) {
        // 分段 targetUnits 已由权威全片预算按时间轴分配，合计处于全片
        // min/max 之间。再次乘折扣会让“逐段压缩目标”低于同一条错误里
        // 声明的全片最低信息量，造成 Provider 同时收到互相矛盾的硬约束。
        const compressionTargets = details.segmentTargetUnits
          ?? details.segmentMinUnits?.map(minimum => Math.max(1, minimum));
        const countingInstruction = details.unit === 'words'
          ? '按空格分词逐段计数后再返回'
          : '按可朗读汉字、字母和数字逐字计数后再返回，标点不计入字数';
        const segmentInstruction = details.segmentActualUnits
          ? `；各段当前数量依次为 [${details.segmentActualUnits.join(', ')}] ${unitLabel}，本次各段压缩目标必须依次为 [${compressionTargets!.join(', ')}] ${unitLabel}，各段绝对上限依次为 [${details.segmentMaxUnits!.join(', ')}] ${unitLabel}；宁可精确达到压缩目标，也不得向目标之外增加口播单位；${countingInstruction}`
          : '';
        const translationInstruction = isMandarin
          ? 'voiceoverZh 必须保持空字符串'
          : '同步忠实压缩 voiceoverZh';
        return `只修复口播字段 ${fields}：当前全片合计 ${details.actualUnits} ${unitLabel}，必须压缩到 ${details.minUnits}–${details.maxUnits} ${unitLabel}，且合计绝对不得超过 ${details.maxUnits} ${unitLabel}${segmentInstruction}；每段 voiceover 仍必须非空，只删减重复修饰和广告套话，保留前三秒产品名称或品类、唯一购买理由、可见证据与末段直接购买 CTA；${translationInstruction}，不得新增事实`;
      }
      if (details.actualUnits < details.minUnits) {
        const countingInstruction = details.unit === 'words'
          ? '按空格分词逐段计数后再返回'
          : '按可朗读汉字、字母和数字逐字计数后再返回，标点不计入字数';
        const segmentInstruction = details.segmentActualUnits
          ? `；各段当前数量依次为 [${details.segmentActualUnits.join(', ')}] ${unitLabel}，各段扩充目标必须依次为 [${details.segmentTargetUnits!.join(', ')}] ${unitLabel}，各段绝对上限依次为 [${details.segmentMaxUnits!.join(', ')}] ${unitLabel}；${countingInstruction}`
          : '';
        const translationInstruction = isMandarin
          ? 'voiceoverZh 必须保持空字符串'
          : '同步忠实扩充 voiceoverZh';
        return `只修复口播字段 ${fields}：当前全片合计 ${details.actualUnits} ${unitLabel}，必须扩充到 ${details.minUnits}–${details.maxUnits} ${unitLabel}${segmentInstruction}；每段 voiceover 必须非空，仅补充已选购买理由、可见证据和当前使用时刻的表达，前三秒明确产品名称或品类，末段保留直接购买 CTA；${translationInstruction}，不得新增事实`;
      }
    }
    return `只修复口播字段 ${fields}：每个镜头都必须有一条完整自然句；前三秒明确产品名称或品类，自证段连接可见证据与唯一购买理由，场景段解释当前使用价值，末段保留直接购买 CTA；不得删除口播或新增事实`;
  }
  if (code === 'PROMPT_WIZARD_CONVERSION_CTA_INVALID') {
    const fieldPaths = promptWizardSafeFieldPaths(error);
    const fields = fieldPaths.length > 0 ? fieldPaths.join('、') : '末段 voiceover 与 voiceoverZh';
    return `只修复 ${fields}：末段必须明确引导用户点击商品卡、查看商品或立即下单；如有 confirmedOffer，只保持原意使用一次；不得编造限时、库存、最低价或其他促销信息`;
  }
  if (code === 'PROMPT_WIZARD_SOUND_DESIGN_VISUAL_CLOSURE_INVALID') {
    const fieldPaths = promptWizardSafeFieldPaths(error);
    const fields = fieldPaths.length > 0 ? fieldPaths.join('、') : '两个分镜的画面与声音字段';
    return `只修复 5 秒纯视觉字段 ${fields}：两个镜头的 voiceover 与 voiceoverZh 必须为空；移除字幕、价格文字、按钮、商品卡、购物车或虚构平台 UI；末镜必须让商品清晰可见，逐字复用首镜唯一商品动作，并把 cameraMovement 改为包含“持续”的推近、横移、跟随或环绕运镜，不得静止；只保留音乐、环境声与真实商品操作拟音，不得新增事实`;
  }
  if (code === 'PROMPT_WIZARD_MOTION_DENSITY_INVALID') {
    const fieldPaths = promptWizardSafeFieldPaths(error);
    const fields = fieldPaths.length > 0 ? fieldPaths.join('、') : 'segments';
    if (
      fieldPaths.length > 0
      && fieldPaths.every(path => /segments\[\d+\]\.editingCue$/u.test(path))
    ) {
      return `只修复剪辑字段 ${fields}：逐项改为“在产品或手部动作落点快切到下一景别”；末段改为“在手部或镜头运动中动作点快切收尾”。不得出现停顿、停留、定格、静止、保持画面或等待口播；不得修改产品动作、证据、画面和口播`;
    }
    return `只修复动态不足字段 ${fields}：每个镜头至少加入产品动作、人物/手部运动、缓慢推近/横移/跟随、动作点剪辑或合法环境运动中的一类；5 秒至少两类、10/15 秒至少三类；删除静止、固定机位、定格、长时间停留、保持不动和连续少切；不得新增产品功能动作或事实`;
  }
  if (code === 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED') {
    const cameraDetails = promptWizardSafeCameraMoveRepairDetails(error);
    if (cameraDetails) {
      return `运镜当前 ${cameraDetails.actual} 类，上限 ${cameraDetails.limit} 类；全片所有 segments[].cameraMovement 只保留一种可识别运镜，统一改为“持续缓慢推近”；删除横移、跟随、拉远、摇镜、环绕、升降和焦点切换；动态密度改由产品动作、手部运动和动作点剪辑满足，不得新增产品功能动作或事实`;
    }
    const details = promptWizardSafeMajorActionRepairDetails(error);
    if (details) {
      return `主要动作当前 ${details.actual} 类，上限 ${details.limit} 类；只保留 selectedScene.mainAction 与 selectedUseDirection.proofAction 所需操作；从 segments 删除额外取用、放置、取下、打开等前置或收尾操作；resolution 和 cta 不新增产品功能动作，但必须通过人物、手部、镜头或动作点剪辑保持动态`;
    }
    const propDetails = promptWizardSafePropRepairDetails(error);
    if (propDetails) {
      return `道具当前 ${propDetails.actual} 类，上限 ${propDetails.limit} 类；只保留 selectedScene.mainAction 与 selectedUseDirection.proofAction 真正需要的物品；从 segments[].subject、action 和 productionNote 删除手机、电脑、包装、桌面装饰等非必要辅助道具；不得删除产品、证据或正确使用对象`;
    }
    return '扩写后的实际分镜超出当前 Seedance 型号与时长预算；只在 segments 内合并地点、人物、道具、主要动作或运镜，删除魔法变化，并保持证据、购买理由、时间轴和口播含义不变';
  }
  if (code === 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID') {
    const fieldPaths = promptWizardSafeFieldPaths(error);
    const fields = fieldPaths.length > 0 ? fieldPaths.join('、') : '方案元数据、脚本预审或结构化画面';
    return `以下字段必须改为以简体中文为主：${fields}；targetLanguage 只适用于 voiceover；保留品牌、型号、Logo、可见印花与 @图片N，不新增事实`;
  }
  return '结构或差异校验失败，请重写被指出的方案，不要只替换同义词';
}

function promptWizardSafeFieldPaths(error: unknown) {
  if (!error || typeof error !== 'object') return [];
  const paths = (error as { fieldPaths?: unknown }).fieldPaths;
  if (!Array.isArray(paths)) return [];
  const result: string[] = [];
  paths.forEach(path => {
    if (
      typeof path === 'string'
      && isPromptWizardRepairFieldPath(path)
      && !result.includes(path)
      && result.length < 24
    ) {
      result.push(path);
    }
  });
  return result;
}

function promptWizardSafeVoiceoverRepairDetails(error: unknown): {
  fieldPath: string;
  actualUnits: number;
  maxUnits: number;
  unit: 'words' | 'characters';
} | null {
  if (!error || typeof error !== 'object') return null;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const candidate = details as Record<string, unknown>;
  const fieldPaths = promptWizardSafeFieldPaths(error);
  const fieldPath = typeof candidate.fieldPath === 'string'
    && fieldPaths.includes(candidate.fieldPath)
    ? candidate.fieldPath
    : null;
  const actualUnits = candidate.actualUnits;
  const maxUnits = candidate.maxUnits;
  const unit = candidate.unit;
  if (
    !fieldPath
    || !Number.isSafeInteger(actualUnits)
    || !Number.isSafeInteger(maxUnits)
    || (actualUnits as number) < 0
    || (maxUnits as number) < 1
    || (actualUnits as number) <= (maxUnits as number)
    || (unit !== 'words' && unit !== 'characters')
  ) {
    return null;
  }
  return {
    fieldPath,
    actualUnits: actualUnits as number,
    maxUnits: maxUnits as number,
    unit,
  };
}

function promptWizardSafeVoiceoverCoverageRepairDetails(error: unknown): {
  actualUnits: number;
  minUnits: number;
  maxUnits: number;
  unit: 'words' | 'characters';
  segmentActualUnits?: number[];
  segmentMinUnits?: number[];
  segmentTargetUnits?: number[];
  segmentMaxUnits?: number[];
} | null {
  if (!error || typeof error !== 'object') return null;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const candidate = details as Record<string, unknown>;
  const actualUnits = candidate.actualUnits;
  const minUnits = candidate.minUnits;
  const maxUnits = candidate.maxUnits;
  const unit = candidate.unit;
  if (
    !Number.isSafeInteger(actualUnits)
    || !Number.isSafeInteger(minUnits)
    || !Number.isSafeInteger(maxUnits)
    || (actualUnits as number) < 0
    || (minUnits as number) < 1
    || (maxUnits as number) < (minUnits as number)
    || (unit !== 'words' && unit !== 'characters')
  ) {
    return null;
  }
  const readSafeUnitArray = (key: string) => {
    const value = candidate[key];
    if (
      !Array.isArray(value)
      || value.length < 1
      || value.length > 8
      || value.some(item => !Number.isSafeInteger(item) || (item as number) < 0 || (item as number) > 1000)
    ) return null;
    return value as number[];
  };
  const segmentActualUnits = readSafeUnitArray('segmentActualUnits');
  const segmentMinUnits = readSafeUnitArray('segmentMinUnits');
  const segmentTargetUnits = readSafeUnitArray('segmentTargetUnits');
  const segmentMaxUnits = readSafeUnitArray('segmentMaxUnits');
  const hasCompleteSegmentDetails = Boolean(
    segmentActualUnits
    && segmentMinUnits
    && segmentTargetUnits
    && segmentMaxUnits
    && segmentActualUnits.length === segmentMinUnits.length
    && segmentActualUnits.length === segmentTargetUnits.length
    && segmentActualUnits.length === segmentMaxUnits.length
    && segmentMinUnits.every((minimum, index) => (
      minimum >= 1
      && minimum <= segmentTargetUnits[index]!
      && segmentTargetUnits[index]! <= segmentMaxUnits[index]!
    ))
    && segmentMinUnits.reduce((sum, value) => sum + value, 0) === minUnits
    && segmentMaxUnits.reduce((sum, value) => sum + value, 0) === maxUnits
    && segmentActualUnits.reduce((sum, value) => sum + value, 0) === actualUnits
  );
  return {
    actualUnits: actualUnits as number,
    minUnits: minUnits as number,
    maxUnits: maxUnits as number,
    unit,
    ...(hasCompleteSegmentDetails ? {
      segmentActualUnits: segmentActualUnits!,
      segmentMinUnits: segmentMinUnits!,
      segmentTargetUnits: segmentTargetUnits!,
      segmentMaxUnits: segmentMaxUnits!,
    } : {}),
  };
}

interface PromptWizardSafeVoiceoverCompressionResult {
  draft: PromptWizardPlanDraft;
  beforeUnits: number;
  afterUnits: number;
  maxUnits: number;
  segmentTargets: number[];
}

interface PromptWizardSafeVoiceoverExpansionResult {
  draft: PromptWizardPlanDraft;
  beforeUnits: number;
  afterUnits: number;
  minUnits: number;
}

interface PromptWizardSafeConversionCtaResult {
  draft: PromptWizardPlanDraft;
  mode: 'append' | 'replace';
}

const PROMPT_WIZARD_SAFE_CONVERSION_CTAS: Record<
  PromptWizardCreativeBrief['targetLanguage'],
  { voiceover: string; voiceoverZh: string }
> = {
  英语: { voiceover: 'Tap to shop.', voiceoverZh: '点击商品卡下单。' },
  西班牙语: { voiceover: 'Compra ahora.', voiceoverZh: '点击商品卡下单。' },
  葡萄牙语: { voiceover: 'Compre agora.', voiceoverZh: '点击商品卡下单。' },
  法语: { voiceover: 'Achetez maintenant.', voiceoverZh: '点击商品卡下单。' },
  印尼语: { voiceover: 'Pesan sekarang.', voiceoverZh: '点击商品卡下单。' },
  意大利语: { voiceover: 'Compra ora.', voiceoverZh: '点击商品卡下单。' },
  日语: { voiceover: '今すぐ購入。', voiceoverZh: '点击商品卡下单。' },
  马来语: { voiceover: 'Beli sekarang.', voiceoverZh: '点击商品卡下单。' },
  泰语: { voiceover: 'สั่งซื้อตอนนี้', voiceoverZh: '点击商品卡下单。' },
  越南语: { voiceover: 'Mua ngay.', voiceoverZh: '点击商品卡下单。' },
  普通话: { voiceover: '点击商品卡下单。', voiceoverZh: '' },
  德语: { voiceover: 'Jetzt bestellen.', voiceoverZh: '点击商品卡下单。' },
  荷兰语: { voiceover: 'Bestel nu.', voiceoverZh: '点击商品卡下单。' },
  波兰语: { voiceover: 'Kup teraz.', voiceoverZh: '点击商品卡下单。' },
};

/**
 * 两轮定向修复后，若唯一剩余问题是末段没有直接购买 CTA，则使用目标语言
 * 的受控短句收口。优先完整保留原口播并追加；只有容量不允许时才替换末段。
 * 两种结果都必须同时满足末段和全片口播预算，之后仍由完整事实、翻译、语言、
 * 时长、动态和 CTA 门禁重新验证。
 */
function promptWizardSafeConversionCtaFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  targetLanguage: PromptWizardCreativeBrief['targetLanguage'];
  config: PromptWizardVideoConfig;
  repairRounds: number;
}): PromptWizardSafeConversionCtaResult | null {
  if (
    input.repairRounds < PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    || errorCode(input.error) !== 'PROMPT_WIZARD_CONVERSION_CTA_INVALID'
    || input.draft.segments.length === 0
  ) return null;
  const lastIndex = input.draft.segments.length - 1;
  const allowedPaths = new Set([
    `segments[${lastIndex}].voiceover`,
    `segments[${lastIndex}].voiceoverZh`,
  ]);
  const fieldPaths = promptWizardRawFieldPaths(input.error);
  if (fieldPaths.length === 0 || fieldPaths.some(path => !allowedPaths.has(path))) return null;

  const cta = PROMPT_WIZARD_SAFE_CONVERSION_CTAS[input.targetLanguage];
  const totalBudget = getPromptWizardTotalVoiceoverBudget({
    targetLanguage: input.targetLanguage,
    durationSeconds: input.config.durationSeconds,
  });
  const timeline = promptWizardTimeline(input.config.durationSeconds);
  const segmentBudgets = getPromptWizardSegmentVoiceoverBudgets({
    targetLanguage: input.targetLanguage,
    durationSeconds: input.config.durationSeconds,
    segmentDurations: timeline.map(([startSeconds, endSeconds]) => endSeconds - startSeconds),
  });
  const lastBudget = segmentBudgets[lastIndex];
  if (!lastBudget) return null;
  const count = (value: string) => countPromptWizardVoiceoverUnits(value, totalBudget.unit);
  const beforeTotal = input.draft.segments.reduce((sum, segment) => sum + count(segment.voiceover), 0);
  const last = input.draft.segments[lastIndex]!;
  const candidates: Array<{
    mode: PromptWizardSafeConversionCtaResult['mode'];
    voiceover: string;
    voiceoverZh: string;
  }> = [{
    mode: 'append',
    voiceover: `${last.voiceover.replace(/[。.!?！？]+$/u, '').trim()} ${cta.voiceover}`.trim(),
    voiceoverZh: input.targetLanguage === '普通话'
      ? ''
      : `${last.voiceoverZh.replace(/[。.!?！？]+$/u, '').trim()} ${cta.voiceoverZh}`.trim(),
  }, {
    mode: 'replace',
    voiceover: cta.voiceover,
    voiceoverZh: cta.voiceoverZh,
  }];

  for (const candidate of candidates) {
    const candidateUnits = count(candidate.voiceover);
    const afterTotal = beforeTotal - count(last.voiceover) + candidateUnits;
    if (
      candidateUnits < 1
      || candidateUnits > lastBudget.maxUnits
      || afterTotal < totalBudget.minUnits
      || afterTotal > totalBudget.maxUnits
    ) continue;
    return {
      mode: candidate.mode,
      draft: {
        ...input.draft,
        segments: input.draft.segments.map((segment, index) => index === lastIndex
          ? {
              ...segment,
              voiceover: candidate.voiceover,
              voiceoverZh: input.targetLanguage === '普通话' ? '' : candidate.voiceoverZh,
            }
          : segment),
      },
    };
  }
  return null;
}

function logPromptWizardSafeConversionCtaFallback(
  planIndex: PromptWizardPlanIndex,
  targetLanguage: PromptWizardCreativeBrief['targetLanguage'],
  mode: PromptWizardSafeConversionCtaResult['mode'],
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-conversion-cta-fallback',
    planIndex,
    targetLanguage,
    mode,
    repairRounds,
  }));
}

const PROMPT_WIZARD_SAFE_VOICEOVER_EXPANSIONS: Partial<Record<
  PromptWizardCreativeBrief['targetLanguage'],
  ReadonlyArray<{ voiceover: string; voiceoverZh: string }>
>> = {
  英语: [
    { voiceover: 'Watch closely.', voiceoverZh: '仔细看。' },
    { voiceover: 'See this detail.', voiceoverZh: '看清这个细节。' },
  ],
  西班牙语: [
    { voiceover: 'Mira atentamente.', voiceoverZh: '仔细看。' },
    { voiceover: 'Observa este detalle.', voiceoverZh: '看清这个细节。' },
  ],
  葡萄牙语: [
    { voiceover: 'Observe atentamente.', voiceoverZh: '仔细看。' },
    { voiceover: 'Veja este detalhe.', voiceoverZh: '看清这个细节。' },
  ],
  法语: [
    { voiceover: 'Regardez attentivement.', voiceoverZh: '仔细看。' },
    { voiceover: 'Observez ce détail.', voiceoverZh: '看清这个细节。' },
  ],
  印尼语: [
    { voiceover: 'Perhatikan baik-baik.', voiceoverZh: '仔细看。' },
    { voiceover: 'Lihat detail ini.', voiceoverZh: '看清这个细节。' },
  ],
  意大利语: [
    { voiceover: 'Guarda attentamente.', voiceoverZh: '仔细看。' },
    { voiceover: 'Osserva questo dettaglio.', voiceoverZh: '看清这个细节。' },
  ],
  日语: [
    { voiceover: 'よく見て。', voiceoverZh: '仔细看。' },
    { voiceover: '細部に注目。', voiceoverZh: '看清这个细节。' },
  ],
  马来语: [
    { voiceover: 'Perhatikan betul-betul.', voiceoverZh: '仔细看。' },
    { voiceover: 'Lihat butiran ini.', voiceoverZh: '看清这个细节。' },
  ],
  泰语: [
    { voiceover: 'ดูให้ชัด。', voiceoverZh: '仔细看。' },
    { voiceover: 'ดูรายละเอียดนี้。', voiceoverZh: '看清这个细节。' },
  ],
  越南语: [
    { voiceover: 'Hãy nhìn kỹ.', voiceoverZh: '仔细看。' },
    { voiceover: 'Xem chi tiết này.', voiceoverZh: '看清这个细节。' },
  ],
  普通话: [
    { voiceover: '仔细看。', voiceoverZh: '' },
    { voiceover: '看清这个细节。', voiceoverZh: '' },
  ],
  德语: [
    { voiceover: 'Schau genau hin.', voiceoverZh: '仔细看。' },
    { voiceover: 'Sieh dieses Detail.', voiceoverZh: '看清这个细节。' },
  ],
  荷兰语: [
    { voiceover: 'Kijk goed.', voiceoverZh: '仔细看。' },
    { voiceover: 'Bekijk dit detail.', voiceoverZh: '看清这个细节。' },
  ],
  波兰语: [
    { voiceover: 'Przyjrzyj się.', voiceoverZh: '仔细看。' },
    { voiceover: 'Zobacz ten detal.', voiceoverZh: '看清这个细节。' },
  ],
};

function promptWizardV6SingleReasonVoiceoverFallbackScope(error: unknown) {
  return errorCode(error) === 'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID'
    && promptWizardRawFieldPaths(error).some(path => (
      /^segments\[\d{1,2}\]\.voiceover(?:Zh)?$/u.test(path)
    ));
}

/**
 * 方舟偶尔会在两轮定向修复后仍比全片口播硬上限多出少量词或字。这里仅在：
 *
 * - 已用尽两轮修复；
 * - 错误只涉及口播字段；
 * - 超额不超过全片容量的 25%，且不超过 6 个口播单位；
 * - 权威错误携带完整、彼此自洽的分段预算；
 *
 * 时收口目标语言口播。压缩只保留每段原文的前缀，不翻译、不改写、不新增
 * 事实；中文对照保持初始完整语义，产品首提和末段 CTA 继续由完整门禁复核。
 */
function promptWizardSafeVoiceoverCompressionFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  repairRounds: number;
}): PromptWizardSafeVoiceoverCompressionResult | null {
  if (
    input.repairRounds < PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    || errorCode(input.error) !== 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID'
  ) return null;
  const fieldPaths = promptWizardRawFieldPaths(input.error);
  if (
    fieldPaths.length === 0
    || fieldPaths.some(path => !/^segments\[\d{1,2}\]\.voiceover(?:Zh)?$/u.test(path))
  ) return null;
  const details = promptWizardSafeVoiceoverCoverageRepairDetails(input.error);
  if (
    !details
    || details.actualUnits <= details.maxUnits
    || !details.segmentActualUnits
    || !details.segmentMinUnits
    || !details.segmentMaxUnits
    || details.segmentActualUnits.length !== input.draft.segments.length
  ) return null;
  const overage = details.actualUnits - details.maxUnits;
  const safeLimit = Math.min(7, Math.max(2, Math.ceil(details.maxUnits * 0.25)));
  if (overage > safeLimit) return null;

  const segmentTargets = details.segmentActualUnits.map((actual, index) => (
    Math.max(1, Math.min(actual, details.segmentMaxUnits![index]!))
  ));
  let targetTotal = segmentTargets.reduce((sum, value) => sum + value, 0);
  const trimOrder = [
    ...segmentTargets.map((_, index) => index).filter(index => (
      index > 0 && index < segmentTargets.length - 1
    )),
    0,
    segmentTargets.length - 1,
  ];
  while (targetTotal > details.maxUnits) {
    const selected = trimOrder
      .map(index => ({
        index,
        slack: segmentTargets[index]! - Math.max(1, details.segmentMinUnits![index]!),
      }))
      .sort((left, right) => right.slack - left.slack)[0];
    if (!selected || selected.slack <= 0) return null;
    segmentTargets[selected.index] = segmentTargets[selected.index]! - 1;
    targetTotal -= 1;
  }
  if (targetTotal < details.minUnits) return null;

  const draft = {
    ...input.draft,
    segments: input.draft.segments.map((segment, index) => ({
      ...segment,
      voiceover: details.unit === 'words'
        ? truncatePromptWizardVoiceoverWords(segment.voiceover, segmentTargets[index]!)
        : truncatePromptWizardVoiceoverCharacters(segment.voiceover, segmentTargets[index]!),
    })),
  };
  const afterUnits = draft.segments.reduce((sum, segment) => (
    sum + countPromptWizardVoiceoverUnits(segment.voiceover, details.unit)
  ), 0);
  if (afterUnits < details.minUnits || afterUnits > details.maxUnits) return null;
  return {
    draft,
    beforeUnits: details.actualUnits,
    afterUnits,
    maxUnits: details.maxUnits,
    segmentTargets,
  };
}

/**
 * 两轮修复后若只差少量口播单位才达到成交密度下限，补入目标语言的中性
 * 观看引导。词库只表达“仔细看/看清细节”，不包含产品事实或商业主张；
 * 插入后仍由完整产品首提、事实、CTA、时长和语言门禁决定能否交付。
 */
function promptWizardSafeVoiceoverExpansionFallback(input: {
  error: unknown;
  draft: PromptWizardPlanDraft;
  targetLanguage: PromptWizardCreativeBrief['targetLanguage'];
  repairRounds: number;
}): PromptWizardSafeVoiceoverExpansionResult | null {
  if (
    input.repairRounds < PROMPT_WIZARD_MAX_CONTENT_REPAIR_ROUNDS
    || errorCode(input.error) !== 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID'
  ) return null;
  const fieldPaths = promptWizardRawFieldPaths(input.error);
  if (
    fieldPaths.length === 0
    || fieldPaths.some(path => !/^segments\[\d{1,2}\]\.voiceover(?:Zh)?$/u.test(path))
  ) return null;
  const details = promptWizardSafeVoiceoverCoverageRepairDetails(input.error);
  if (!details || details.actualUnits >= details.minUnits || input.draft.segments.length === 0) {
    return null;
  }
  const shortage = details.minUnits - details.actualUnits;
  const safeLimit = Math.min(6, Math.max(2, Math.floor(details.maxUnits * 0.25)));
  if (shortage > safeLimit) return null;
  const expansions = PROMPT_WIZARD_SAFE_VOICEOVER_EXPANSIONS[input.targetLanguage];
  if (!expansions || expansions.length === 0) return null;

  const draft = structuredClone(input.draft);
  const insertionOrder = [
    ...draft.segments.map((_, index) => index).filter(index => (
      index > 0 && index < draft.segments.length - 1
    )),
    0,
    draft.segments.length - 1,
  ];
  let actualUnits = details.actualUnits;
  let expansionIndex = 0;
  while (actualUnits < details.minUnits && expansionIndex < expansions.length * 2) {
    const phrase = expansions[expansionIndex % expansions.length]!;
    const phraseUnits = countPromptWizardVoiceoverUnits(phrase.voiceover, details.unit);
    if (phraseUnits < 1 || actualUnits + phraseUnits > details.maxUnits) {
      expansionIndex += 1;
      continue;
    }
    const segmentIndex = insertionOrder[expansionIndex % insertionOrder.length]!;
    const segment = draft.segments[segmentIndex]!;
    draft.segments[segmentIndex] = {
      ...segment,
      voiceover: `${phrase.voiceover} ${segment.voiceover}`.trim(),
      voiceoverZh: input.targetLanguage === '普通话'
        ? ''
        : `${phrase.voiceoverZh} ${segment.voiceoverZh}`.trim(),
    };
    actualUnits += phraseUnits;
    expansionIndex += 1;
  }
  if (actualUnits < details.minUnits || actualUnits > details.maxUnits) return null;
  return {
    draft,
    beforeUnits: details.actualUnits,
    afterUnits: actualUnits,
    minUnits: details.minUnits,
  };
}

function truncatePromptWizardVoiceoverWords(value: string, maxWords: number) {
  const tokens = value.normalize('NFKC').trim().split(/\s+/u);
  const kept: string[] = [];
  let words = 0;
  for (const token of tokens) {
    if (/[\p{L}\p{N}]/u.test(token)) {
      if (words >= maxWords) break;
      words += 1;
    }
    kept.push(token);
  }
  return kept.join(' ').replace(/[,;:]$/u, '').trim();
}

function truncatePromptWizardVoiceoverCharacters(value: string, maxCharacters: number) {
  const kept: string[] = [];
  let characters = 0;
  for (const character of value.normalize('NFKC').trim()) {
    const isSpeechCharacter = /[\p{L}\p{N}]/u.test(character);
    if (isSpeechCharacter && characters >= maxCharacters) break;
    if (isSpeechCharacter) characters += 1;
    kept.push(character);
  }
  return kept.join('').replace(/[，、；：,;:\s]+$/u, '').trim();
}

function logPromptWizardSafeVoiceoverCompressionFallback(
  planIndex: PromptWizardPlanIndex,
  result: PromptWizardSafeVoiceoverCompressionResult,
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-voiceover-compression-fallback',
    planIndex,
    repairRounds,
    beforeUnits: result.beforeUnits,
    afterUnits: result.afterUnits,
    maxUnits: result.maxUnits,
    segmentTargets: result.segmentTargets,
  }));
}

function logPromptWizardSafeVoiceoverExpansionFallback(
  planIndex: PromptWizardPlanIndex,
  result: PromptWizardSafeVoiceoverExpansionResult,
  repairRounds: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-safe-voiceover-expansion-fallback',
    planIndex,
    repairRounds,
    beforeUnits: result.beforeUnits,
    afterUnits: result.afterUnits,
    minUnits: result.minUnits,
  }));
}

function promptWizardSafeCameraMoveRepairDetails(
  error: unknown,
): PromptWizardSafeMajorActionDetails | null {
  return promptWizardSafeSingleBudgetIssueDetails(error, 'TOO_MANY_CAMERA_MOVES');
}

function promptWizardSafeMajorActionRepairDetails(
  error: unknown,
): PromptWizardSafeMajorActionDetails | null {
  return promptWizardSafeSingleBudgetIssueDetails(error, 'TOO_MANY_ACTIONS');
}

function promptWizardSafePropRepairDetails(
  error: unknown,
): PromptWizardSafeMajorActionDetails | null {
  return promptWizardSafeSingleBudgetIssueDetails(error, 'TOO_MANY_PROPS');
}

function promptWizardSafeSingleBudgetIssueDetails(
  error: unknown,
  expectedCode: 'TOO_MANY_ACTIONS' | 'TOO_MANY_CAMERA_MOVES' | 'TOO_MANY_PROPS',
): PromptWizardSafeMajorActionDetails | null {
  if (
    errorCode(error) !== 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED'
    || !error
    || typeof error !== 'object'
  ) {
    return null;
  }
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const safeIssues = issues.map(issue => {
    if (!issue || typeof issue !== 'object') return null;
    const candidate = issue as Record<string, unknown>;
    if (
      candidate.code !== expectedCode
      || candidate.fieldPath !== 'segments'
      || !Number.isSafeInteger(candidate.actual)
      || !Number.isSafeInteger(candidate.limit)
      || (candidate.actual as number) <= (candidate.limit as number)
      || (candidate.limit as number) < 1
    ) {
      return null;
    }
    return {
      actual: candidate.actual as number,
      limit: candidate.limit as number,
    };
  });
  if (safeIssues.some(issue => issue === null)) return null;
  return {
    actual: Math.max(...safeIssues.map(issue => issue!.actual)),
    limit: Math.min(...safeIssues.map(issue => issue!.limit)),
  };
}

function isPromptWizardRepairFieldPath(value: string) {
  return /^(?:name|hook|narrative|primaryScene|cameraAndPacing|differenceTags\[\d{1,2}\]|planningReview\.(?:targetAudience|surfaceNeed|realPainPoint|nonAdEntry|directionFit|proofPoints\[\d{1,2}\])|segments|segments\[\d{1,2}\]\.(?:role|location|subject|shotSize|action|cameraMovement|lightingAndRealism|voiceover|voiceoverZh|foley|editingCue|evidenceRefs(?:\[\d{1,2}\])?|productionNote)|productionWarnings\[\d{1,2}\])$/u.test(value);
}

function isPromptWizardRepairableError(error: unknown) {
  return PROMPT_WIZARD_REPAIRABLE_ERROR_CODES.has(errorCode(error));
}

function promptWizardFailureMessage(error: unknown) {
  const code = errorCode(error);
  if (code === 'PROMPT_WIZARD_PROVIDER_NOT_CONFIGURED') return '提示词服务尚未配置，请联系管理员。';
  if (code === 'PROMPT_WIZARD_PRODUCT_INPUT_CLAIM_INVALID') {
    return '产品信息包含未经确认的商业主张，请修改产品信息后重新生成。';
  }
  if (code === 'PROMPT_WIZARD_PRODUCT_LANGUAGE_INVALID') return '产品信息未能统一为简体中文，请重新识别。';
  if (code === 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID') {
    return 'AI 未能生成符合中文描述要求的方案，本批次未交付。';
  }
  if (
    code === 'PROMPT_WIZARD_BEAT_INVALID'
    || code === 'PROMPT_WIZARD_EVIDENCE_INVALID'
    || code === 'PROMPT_WIZARD_UNCONFIRMED_CLAIM'
    || code === 'PROMPT_WIZARD_UNSAFE_CONTENT'
    || code === 'PROMPT_WIZARD_TRANSLATION_INVALID'
    || code === 'PROMPT_WIZARD_SOUND_DESIGN_VISUAL_CLOSURE_INVALID'
    || code === 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED'
    || code === 'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID'
  ) {
    return 'AI 返回内容未通过脚本结构与事实校验，本批次未交付。';
  }
  if (code.includes('DIVERSITY') || code.includes('INVALID_JSON') || code.includes('ZOD')) {
    return 'AI 返回内容未通过结构与差异校验，本批次未交付。';
  }
  if (code.includes('TIMEOUT') || code === 'AbortError') {
    return '提示词服务响应超时，请稍后重试。';
  }
  return '提示词服务暂时不可用，本批次未交付。';
}

function promptWizardConceptFailureMessage(error: unknown) {
  const code = errorCode(error);
  if (code === 'PROMPT_WIZARD_CONCEPT_FLOW_RETIRED') {
    return '提示词流程已升级，请按新版流程重新识别并生成三个方向。';
  }
  if (code === 'PROMPT_WIZARD_CONCEPT_SET_STALE') return '创作设定已变化，请重新生成创意路线。';
  if (code === 'PROMPT_WIZARD_DIRECTION_UNAVAILABLE') return '当前素材不足以支持所选创作方向。';
  if (code.includes('TIMEOUT') || code === 'ABORTERROR' || code === 'ABORT_ERR') {
    return '创意导演响应超时，请稍后重试。';
  }
  if (
    code === 'PROMPT_WIZARD_CONCEPT_SET_INVALID'
    || code === 'PROMPT_WIZARD_PROVIDER_INVALID_JSON'
    || code === 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID'
  ) {
    return '创意路线未通过事实、素材或可执行性校验，请重新生成。';
  }
  return '创意导演暂时不可用，请稍后重试。';
}

function promptWizardUseDirectionFailureMessage(error: unknown) {
  const code = errorCode(error);
  if (code === 'PROMPT_WIZARD_USE_DIRECTION_SET_STALE') {
    return '产品信息已变化，请重新规划使用方向。';
  }
  if (code === 'PROMPT_WIZARD_USE_DIRECTION_EVIDENCE_INSUFFICIENT') {
    return '现有可靠证据不足以形成两个可用方向，请补充一个确认真实的用途或卖点。';
  }
  if (code.includes('TIMEOUT') || code === 'ABORTERROR' || code === 'ABORT_ERR') {
    return '产品使用方向规划响应超时，请稍后重试。';
  }
  if (
    code === 'PROMPT_WIZARD_USE_DIRECTIONS_INVALID'
    || code === 'PROMPT_WIZARD_PROVIDER_INVALID_JSON'
    || code === 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID'
  ) {
    return '产品使用方向未通过证据或可执行性校验，请重新规划。';
  }
  return '产品使用方向规划暂时不可用，请稍后重试。';
}

function promptWizardRefinementFailureMessage(error: unknown) {
  const code = errorCode(error);
  if (code === 'PROMPT_WIZARD_REFINEMENT_LEGACY_READ_ONLY') {
    return '旧版提示词方案仅支持查看和应用。';
  }
  if (code.includes('TIMEOUT') || code === 'ABORTERROR' || code === 'ABORT_ERR') {
    return '单方案微调响应超时，请重新尝试。';
  }
  if (code.includes('STALE')) return '原始方案或创意路线已过期。';
  return '微调结果未通过事实与可执行性校验，请调整要求后重试。';
}

function promptWizardProductRecognitionFailureMessage(error: unknown) {
  const code = errorCode(error);
  if (code === 'PROMPT_WIZARD_PRODUCT_REPAIR_FAILED') {
    return '产品识别结果格式异常，自动修复未成功，请重新识别。';
  }
  if (
    code === 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID'
    || code === 'PROMPT_WIZARD_PROVIDER_INVALID_JSON'
    || code === 'PROMPT_WIZARD_PRODUCT_LANGUAGE_INVALID'
  ) {
    return '产品识别结果格式异常，请重新识别。';
  }
  if (code.includes('TIMEOUT') || code === 'ABORTERROR' || code === 'ABORT_ERR') {
    return '产品识别响应超时，请重新识别。';
  }
  return '产品识别服务暂时不可用，请稍后重试。';
}

function logPromptWizardProductRecognitionFailure(
  runId: string,
  error: unknown,
  usage: PromptWizardProviderUsage | null,
) {
  if (env.NODE_ENV !== 'production') return;
  const provider = promptWizardSafeProviderErrorMetadata(error);
  const rawCode = errorCode(error);
  console.warn(JSON.stringify({
    event: 'prompt-wizard-product-recognition-failed',
    runId,
    errorCode: /^[A-Z0-9_.-]{1,100}$/u.test(rawCode) ? rawCode : 'UNKNOWN',
    model: provider.model
      ?? (usage?.model === env.ARK_PROMPT_WIZARD_MODEL ? usage.model : null),
    responseId: provider.responseId
      ?? safePromptWizardProviderIdentifier(usage?.interactionId),
    inputTokens: provider.inputTokens
      ?? safePromptWizardTokenCount(usage?.inputTokens),
    outputTokens: provider.outputTokens
      ?? safePromptWizardTokenCount(usage?.outputTokens),
  }));
}

function logPromptWizardBatchFailure(
  batch: PromptWizardBatchRow,
  error: unknown,
  usage: PromptWizardProviderUsage | null,
) {
  const provider = promptWizardSafeProviderErrorMetadata(error);
  const rawCode = errorCode(error);
  console.warn(JSON.stringify({
    event: 'prompt-wizard-batch-processing-failed',
    runId: batch.run_id,
    batchId: batch.id,
    errorCode: /^[A-Z0-9_.-]{1,100}$/u.test(rawCode) ? rawCode : 'UNKNOWN',
    constraint: promptWizardSafeDatabaseConstraint(error),
    fieldPaths: promptWizardSafeFieldPaths(error),
    model: provider.model
      ?? (usage?.model === env.ARK_PROMPT_WIZARD_MODEL ? usage.model : null),
    responseId: provider.responseId
      ?? safePromptWizardProviderIdentifier(usage?.interactionId),
    inputTokens: provider.inputTokens
      ?? safePromptWizardTokenCount(usage?.inputTokens),
    outputTokens: provider.outputTokens
      ?? safePromptWizardTokenCount(usage?.outputTokens),
  }));
}

function promptWizardSafeDatabaseConstraint(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === 'string' && /^[a-z0-9_]{1,100}$/u.test(constraint)
    ? constraint
    : null;
}

function mergePromptWizardServiceTier(
  current: PromptWizardProviderUsage['serviceTier'],
  next: PromptWizardProviderUsage['serviceTier'],
) {
  if (current === 'default' || next === 'default') return 'default';
  return current ?? next;
}

function mergeCompletePromptWizardTokenCount(
  current: number | null,
  next: number | null,
) {
  return current === null || next === null ? null : current + next;
}

interface PromptWizardSafeProviderErrorMetadata {
  code: string | null;
  model: string | null;
  responseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  providerRequestAttempted: boolean;
}

/**
 * 仅从 Provider Error 及 cause 链读取可安全入库的标识和用量字段。
 * 不读取 message、请求体、图片 URL、提示词或响应正文，避免失败诊断把业务内容带入财务列。
 */
function promptWizardSafeProviderErrorMetadata(error: unknown): PromptWizardSafeProviderErrorMetadata {
  const metadata: PromptWizardSafeProviderErrorMetadata = {
    code: null,
    model: null,
    responseId: null,
    inputTokens: null,
    outputTokens: null,
    providerRequestAttempted: false,
  };
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== 'object') break;
    const candidate = current as {
      code?: unknown;
      model?: unknown;
      responseId?: unknown;
      interactionId?: unknown;
      usage?: unknown;
      providerRequestAttempted?: unknown;
      cause?: unknown;
    };
    if (metadata.code === null && typeof candidate.code === 'string') {
      metadata.code = candidate.code.toUpperCase();
    }
    if (metadata.model === null && candidate.model === env.ARK_PROMPT_WIZARD_MODEL) {
      metadata.model = env.ARK_PROMPT_WIZARD_MODEL;
    }
    if (metadata.responseId === null) {
      metadata.responseId = safePromptWizardProviderIdentifier(candidate.responseId)
        ?? safePromptWizardProviderIdentifier(candidate.interactionId);
    }
    if (candidate.usage && typeof candidate.usage === 'object') {
      const usage = candidate.usage as {
        input_tokens?: unknown;
        output_tokens?: unknown;
        inputTokens?: unknown;
        outputTokens?: unknown;
      };
      if (metadata.inputTokens === null) {
        metadata.inputTokens = safePromptWizardTokenCount(
          usage.input_tokens ?? usage.inputTokens,
        );
      }
      if (metadata.outputTokens === null) {
        metadata.outputTokens = safePromptWizardTokenCount(
          usage.output_tokens ?? usage.outputTokens,
        );
      }
    }
    if (candidate.providerRequestAttempted === true) {
      metadata.providerRequestAttempted = true;
    }
    current = candidate.cause;
  }
  return metadata;
}

function mergePromptWizardProviderFailureUsage(
  current: PromptWizardProviderUsage | null,
  error: unknown,
): PromptWizardProviderUsage | null {
  const failure = promptWizardSafeProviderErrorMetadata(error);
  // Provider 前置校验、未配置或成本账本 begin 失败都可能使用 PROMPT_WIZARD_PROVIDER_*
  // 错误码，但尚未产生真实外呼；只有明确尝试或已有安全响应/usage 证据才写 legacy 用量。
  const isProviderFailure = failure.providerRequestAttempted
    || failure.model !== null
    || failure.responseId !== null
    || failure.inputTokens !== null
    || failure.outputTokens !== null;
  if (!current && !isProviderFailure) return null;

  return {
    interactionId: failure.responseId ?? current?.interactionId ?? null,
    model: failure.model ?? current?.model ?? env.ARK_PROMPT_WIZARD_MODEL,
    inputTokens: mergePromptWizardFailureTokenCount(
      current?.inputTokens,
      failure.inputTokens,
      current !== null,
      failure.providerRequestAttempted,
    ),
    outputTokens: mergePromptWizardFailureTokenCount(
      current?.outputTokens,
      failure.outputTokens,
      current !== null,
      failure.providerRequestAttempted,
    ),
    serviceTier: current?.serviceTier ?? null,
    requestAttempts: current?.requestAttempts ?? 0,
  };
}

function mergePromptWizardFailureTokenCount(
  current: number | null | undefined,
  terminal: number | null,
  hasCurrentUsage: boolean,
  terminalProviderRequestAttempted: boolean,
) {
  if (!hasCurrentUsage) return terminal;
  if (current === null) return null;
  if (terminal === null) {
    return terminalProviderRequestAttempted ? null : current ?? null;
  }
  return (current ?? 0) + terminal;
}

function safePromptWizardProviderIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized) ? normalized : null;
}

function safePromptWizardTokenCount(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') return code.toUpperCase();
  return error instanceof Error ? error.name.toUpperCase() : 'UNKNOWN';
}

function serviceError(message: string, statusCode: number, code: string) {
  return Object.assign(new Error(message), { statusCode, code, exposeMessage: true });
}
