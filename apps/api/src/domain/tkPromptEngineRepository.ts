import { omitStoredTkPromptField } from './tkPromptEngineLegacy.js';
import { createHash } from 'node:crypto';
import {
  tkPromptCreativeInputSchema,
  tkPromptEvidenceProfileSchema,
  tkPromptEvidenceReviewSchema,
  tkPromptGenerationSchema,
  tkPromptPlanSchema,
  tkPromptStrategyBlueprintSchema,
  tkPromptVideoConfigSchema,
  type TkPromptCreativeInput,
  type TkPromptEngineSettings,
  type TkPromptEvidenceProfile,
  type TkPromptEvidenceReview,
  type TkPromptGeneration,
  type TkPromptPlan,
  type TkPromptRun,
  type TkPromptStrategyBlueprint,
  type TkPromptVideoConfig,
} from '@lindyson/api-contracts';
import { pool, withTransaction, type DbClient } from '../db/pool.js';
import { planGenerationLotAllocationsWithClient } from './generationCredits.js';
import { toInt } from './serialization.js';
import {
  holdTkPromptCreditsWithClient,
  releaseTkPromptCreditsWithClient,
  settleTkPromptCreditsWithClient,
  tkPromptCreditHoldKey,
} from './tkPromptEngineCredits.js';

export type JsonObject = Record<string, unknown>;
type TkPromptSlot = 'safe' | 'native' | 'creative';

export type TkPromptRunWork = TkPromptRun & {
  userId: string;
  attemptCount: number;
  claimToken: string;
};

export type TkPromptGenerationContext = TkPromptGeneration & {
  userId: string;
  attemptCount: number;
  confirmedFactPack: JsonObject;
  creativeInput: TkPromptCreativeInput;
  videoConfig: TkPromptVideoConfig;
};

export type TkPromptGenerationWork = TkPromptGenerationContext & {
  claimToken: string;
};

export type TkPromptOptionWork = TkPromptGeneration['options'][number] & {
  userId: string;
  attemptCount: number;
  claimToken: string;
};

interface TkPromptSettingsRow {
  schema_version: number | string;
  generation_credits: number | string;
  available: boolean;
  v6_retired_at?: Date | string | null;
  updated_at: Date | string;
}

interface TkPromptRunRow {
  id: string;
  user_id: string;
  schema_version: number | string;
  idempotency_key: string;
  request_hash: string;
  status: 'analyzing' | 'ready' | 'failed' | 'archived';
  image_asset_ids: string[];
  evidence_profile: unknown | null;
  failure_reason: string | null;
  attempt_count: number | string;
  claim_token: string | null;
  content_purged_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TkPromptGenerationRow {
  id: string;
  run_id: string;
  user_id: string;
  schema_version: number | string;
  ordinal: number | string;
  idempotency_key: string;
  request_hash: string;
  status: 'queued' | 'strategizing' | 'expanding' | 'completed' | 'failed';
  confirmed_fact_pack: unknown | null;
  creative_input: unknown | null;
  video_config: unknown | null;
  strategy_set: unknown | null;
  is_free: boolean;
  credits: number | string;
  credit_status: 'none' | 'held' | 'settled' | 'refunded';
  main_credits_used: number | string;
  addon_credits_used: number | string;
  failure_reason: string | null;
  attempt_count: number | string;
  claim_token: string | null;
  content_purged_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TkPromptOptionRow {
  id: string;
  generation_id: string;
  user_id: string;
  slot: TkPromptSlot;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  strategy_blueprint: unknown | null;
  plan: unknown | null;
  failure_reason: string | null;
  attempt_count: number | string;
  claim_token: string | null;
  content_purged_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TkPromptProviderRequestRow {
  id: string;
  request_key: string;
  request_status: 'started' | 'succeeded' | 'failed';
}

export interface TkPromptCreditCallbacks {
  /**
   * generationCredits 的 lot 规划可直接复用；其 hold/settle/release 将归属硬编码为
   * generation_tasks，不能拿 generation id 冒充 task id。因此 TK1 的实际账务写入
   * 必须由调用方在同一事务提供，且归属 related_tk_prompt_generation_id。
   */
  holdWithClient(input: {
    client: DbClient;
    userId: string;
    generationId: string;
    eventKey: string;
    mainAmount: number;
    addonAmount: number;
  }): Promise<void>;
  settleWithClient(input: {
    client: DbClient;
    userId: string;
    generationId: string;
    eventKey: string;
    credits: number;
  }): Promise<void>;
  refundWithClient(input: {
    client: DbClient;
    userId: string;
    generationId: string;
    eventKey: string;
    credits: number;
  }): Promise<void>;
}

export interface TkPromptEngineRepositoryDependencies {
  reader?: DbClient;
  transaction?: <T>(callback: (client: DbClient) => Promise<T>) => Promise<T>;
  planCreditsWithClient?: typeof planGenerationLotAllocationsWithClient;
  creditCallbacks?: TkPromptCreditCallbacks;
}

export interface CreateTkPromptRunInput {
  userId: string;
  idempotencyKey: string;
  imageAssetIds: string[];
}

export interface CreateTkPromptGenerationInput {
  userId: string;
  runId: string;
  idempotencyKey: string;
  expectedGenerationCredits: number;
  confirmedFactPack: JsonObject;
  creativeInput: TkPromptCreativeInput;
  videoConfig: TkPromptVideoConfig;
}

export type TkPromptProviderStage = 'analysis' | 'strategy' | 'option';

export interface BeginTkPromptProviderRequestInput {
  requestKey: string;
  runId: string;
  generationId: string | null;
  optionId: string | null;
  userId: string;
  stage: TkPromptProviderStage;
  action: string;
  jobAttempt: number;
  claimToken: string;
  repairRound: 0 | 1;
  transportAttempt: number;
  provider: string;
  model: string;
  serviceTier: string;
}

export function tkPromptProviderRequestKey(input: Pick<
  BeginTkPromptProviderRequestInput,
  | 'runId'
  | 'generationId'
  | 'optionId'
  | 'stage'
  | 'action'
  | 'jobAttempt'
  | 'claimToken'
  | 'repairRound'
  | 'transportAttempt'
>) {
  return [
    `run:${input.runId}`,
    `generation:${input.generationId ?? 'none'}`,
    `option:${input.optionId ?? 'none'}`,
    `stage:${input.stage}`,
    `action:${input.action}`,
    `job:${input.jobAttempt}`,
    `claim:${input.claimToken}`,
    `repair:${input.repairRound}`,
    `transport:${input.transportAttempt}`,
  ].join(':');
}

interface ProviderTerminalBase {
  status: 'succeeded' | 'failed';
  providerRequestId: string | null;
  providerResponseId: string | null;
  xTtLogId: string | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorClassification: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}

export type CompleteTkPromptProviderRequestInput = ProviderTerminalBase & ({
  costStatus: 'unknown';
} | {
  costStatus: 'known';
  pricingRuleId: string;
  priceVersion: string;
  pricingTier: string;
  inputPricePerMillionCny: string | number;
  cachedInputPricePerMillionCny: string | number;
  outputPricePerMillionCny: string | number;
  costCny: string | number;
});

const TK_PROMPT_SLOTS = ['safe', 'native', 'creative'] as const;

export function tkPromptCreditEventKey(generationId: string) {
  return `tk-prompt-engine-hold:${generationId}`;
}

export async function readTkPromptEngineSettings(
  client: DbClient,
): Promise<TkPromptEngineSettings> {
  const result = await client.query<TkPromptSettingsRow>(
    `SELECT schema_version, generation_credits, available, updated_at
     FROM tk_prompt_engine_settings
     WHERE singleton_id = 1`,
  );
  const row = result.rows[0];
  if (!row) throw repositoryError('TK Prompt Engine 设置不存在', 500, 'TK_PROMPT_SETTINGS_MISSING');
  return mapSettings(row);
}

/** 单向切流事实：首次开启 TK 1.0 后，旧 V6 写入口永久保持退役。 */
export async function readTkPromptEngineV6WritesRetired(
  client: DbClient = pool,
): Promise<boolean> {
  const result = await client.query<{ v6_retired: boolean }>(
    `SELECT v6_retired_at IS NOT NULL AS v6_retired
     FROM tk_prompt_engine_settings
     WHERE singleton_id = 1`,
  );
  const row = result.rows[0];
  if (!row) throw repositoryError('TK Prompt Engine 设置不存在', 500, 'TK_PROMPT_SETTINGS_MISSING');
  return row.v6_retired === true;
}

export async function updateTkPromptEngineSettingsWithClient(input: {
  client: DbClient;
  updatedBy: string;
  generationCredits?: number;
  available?: boolean;
}): Promise<TkPromptEngineSettings> {
  if (input.generationCredits === undefined && input.available === undefined) {
    throw repositoryError('至少更新一项 TK Prompt Engine 设置', 400, 'TK_PROMPT_SETTINGS_EMPTY');
  }
  if (input.generationCredits !== undefined
    && (!Number.isSafeInteger(input.generationCredits) || input.generationCredits < 0)) {
    throw repositoryError('生成积分必须是非负整数', 400, 'TK_PROMPT_SETTINGS_CREDITS_INVALID');
  }
  if (input.available === true) {
    throw repositoryError(
      'TK Prompt Engine 1.0 只能通过完成后端、付费 Canary 与双站静态验收的受审计终结器首次开启',
      409,
      'TK_PROMPT_ENABLE_REQUIRES_FINALIZER',
    );
  }
  const result = await input.client.query<TkPromptSettingsRow>(
    `UPDATE tk_prompt_engine_settings
     SET generation_credits = COALESCE($1, generation_credits),
         available = COALESCE($2, available),
         updated_by = $3,
         updated_at = now()
     WHERE singleton_id = 1
     RETURNING schema_version, generation_credits, available, updated_at`,
    [input.generationCredits ?? null, input.available ?? null, input.updatedBy],
  );
  const row = result.rows[0];
  if (!row) throw repositoryError('TK Prompt Engine 设置不存在', 500, 'TK_PROMPT_SETTINGS_MISSING');
  return mapSettings(row);
}

export function createTkPromptEngineRepository(
  dependencies: TkPromptEngineRepositoryDependencies = {},
) {
  const reader = dependencies.reader ?? pool;
  const transaction = dependencies.transaction ?? (callback => withTransaction(callback));
  const planCredits = dependencies.planCreditsWithClient
    ?? planGenerationLotAllocationsWithClient;
  const creditCallbacks = dependencies.creditCallbacks;

  return {
    async getSettings(): Promise<TkPromptEngineSettings> {
      return readTkPromptEngineSettings(reader);
    },

    async updateSettings(input: {
      updatedBy: string;
      generationCredits?: number;
      available?: boolean;
    }): Promise<TkPromptEngineSettings> {
      return updateTkPromptEngineSettingsWithClient({
        client: reader,
        updatedBy: input.updatedBy,
        ...(input.generationCredits !== undefined
          ? { generationCredits: input.generationCredits }
          : {}),
        ...(input.available !== undefined ? { available: input.available } : {}),
      });
    },

    async createRun(input: CreateTkPromptRunInput): Promise<TkPromptRun> {
      assertImageAssetIds(input.imageAssetIds);
      assertIdempotencyKey(input.idempotencyKey);
      const requestHash = hashRequest({ imageAssetIds: input.imageAssetIds });
      return transaction(async client => {
        await lockIdempotency(client, `tk-prompt-run:${input.userId}:${input.idempotencyKey}`);
        const replay = await client.query<TkPromptRunRow>(
          `SELECT * FROM tk_prompt_runs
           WHERE user_id = $1 AND idempotency_key = $2
           FOR UPDATE`,
          [input.userId, input.idempotencyKey],
        );
        if (replay.rows[0]) {
          assertIdempotencyHash(replay.rows[0].request_hash, requestHash, 'TK_PROMPT_RUN_IDEMPOTENCY_CONFLICT');
          assertRunReadable(replay.rows[0]);
          return mapRun(replay.rows[0]);
        }
        const inserted = await client.query<TkPromptRunRow>(
          `INSERT INTO tk_prompt_runs (
             user_id, idempotency_key, request_hash, image_asset_ids
           ) VALUES ($1, $2, $3, $4::uuid[])
           RETURNING *`,
          [input.userId, input.idempotencyKey, requestHash, input.imageAssetIds],
        );
        return mapRun(requiredRow(inserted.rows[0], 'TK Prompt Engine run 插入失败'));
      });
    },

    async getRun(userId: string, runId: string): Promise<TkPromptRun> {
      const result = await reader.query<TkPromptRunRow>(
        `SELECT * FROM tk_prompt_runs WHERE id = $1 AND user_id = $2`,
        [runId, userId],
      );
      const row = result.rows[0];
      if (!row) throw repositoryError('TK Prompt Engine 任务不存在', 404, 'TK_PROMPT_RUN_NOT_FOUND');
      assertRunReadable(row);
      return mapRun(row);
    },

    async claimRunAnalysis(input: {
      runId: string;
      staleBefore: Date;
      expectedAttempt: number;
    }): Promise<TkPromptRunWork | null> {
      assertExpectedAttempt(input.expectedAttempt);
      const result = await reader.query<TkPromptRunRow>(
        `UPDATE tk_prompt_runs
         SET started_at = clock_timestamp(), claim_token = gen_random_uuid(),
             attempt_count = attempt_count + 1, updated_at = clock_timestamp()
         WHERE id = $1
           AND status = 'analyzing'
           AND content_purged_at IS NULL
           AND expires_at > now()
           AND (started_at IS NULL OR started_at <= $2)
           AND attempt_count + 1 = $3
         RETURNING *`,
        [input.runId, input.staleBefore, input.expectedAttempt],
      );
      return result.rows[0] ? mapRunWork(result.rows[0]) : null;
    },

    async completeRunAnalysis(input: {
      runId: string;
      userId: string;
      claimToken: string;
      evidenceProfile: TkPromptEvidenceProfile;
    }): Promise<TkPromptRun> {
      assertClaimToken(input.claimToken);
      const evidence = tkPromptEvidenceProfileSchema.parse(input.evidenceProfile);
      const result = await reader.query<TkPromptRunRow>(
        `UPDATE tk_prompt_runs
         SET status = 'ready', evidence_profile = $3::jsonb,
             failure_reason = NULL, completed_at = now(),
             claim_token = NULL,
             expires_at = now() + interval '24 hours', updated_at = now()
         WHERE id = $1 AND user_id = $2 AND status = 'analyzing'
           AND claim_token = $4 AND content_purged_at IS NULL
         RETURNING *`,
        [input.runId, input.userId, JSON.stringify(evidence), input.claimToken],
      );
      const row = result.rows[0];
      if (!row) throw repositoryError('事实分析任务状态已变化', 409, 'TK_PROMPT_RUN_STATE_CONFLICT');
      return mapRun(row);
    },

    async failRunAnalysis(input: {
      runId: string;
      userId: string;
      claimToken: string;
      failureReason: string;
    }): Promise<TkPromptRun> {
      assertClaimToken(input.claimToken);
      const reason = normalizeFailureReason(input.failureReason);
      const result = await reader.query<TkPromptRunRow>(
        `UPDATE tk_prompt_runs
         SET status = 'failed', evidence_profile = NULL,
             failure_reason = $3, completed_at = now(), claim_token = NULL,
             expires_at = now() + interval '24 hours', updated_at = now()
         WHERE id = $1 AND user_id = $2 AND status = 'analyzing'
           AND claim_token = $4 AND content_purged_at IS NULL
         RETURNING *`,
        [input.runId, input.userId, reason, input.claimToken],
      );
      const row = result.rows[0];
      if (!row) throw repositoryError('事实分析任务状态已变化', 409, 'TK_PROMPT_RUN_STATE_CONFLICT');
      return mapRun(row);
    },

    async createGeneration(input: CreateTkPromptGenerationInput): Promise<TkPromptGeneration> {
      assertIdempotencyKey(input.idempotencyKey);
      const creativeInput = tkPromptCreativeInputSchema.parse(input.creativeInput);
      const videoConfig = tkPromptVideoConfigSchema.parse(input.videoConfig);
      assertGenerationAudioInput(creativeInput, videoConfig);
      if (!Number.isSafeInteger(input.expectedGenerationCredits)
        || input.expectedGenerationCredits < 0) {
        throw repositoryError('预期生成积分必须是非负整数', 400, 'TK_PROMPT_EXPECTED_CREDITS_INVALID');
      }
      if (!isJsonObject(input.confirmedFactPack)) {
        throw repositoryError('确认事实包必须是 JSON 对象', 400, 'TK_PROMPT_FACT_PACK_INVALID');
      }
      const requestHash = hashRequest({
        runId: input.runId,
        confirmedFactPack: input.confirmedFactPack,
        creativeInput,
        videoConfig,
      });
      return transaction(async client => {
        await lockIdempotency(client, `tk-prompt-generation:${input.userId}:${input.idempotencyKey}`);
        const replay = await client.query<TkPromptGenerationRow>(
          `SELECT generation.*
           FROM tk_prompt_generations generation
           JOIN tk_prompt_runs run ON run.id = generation.run_id
           WHERE generation.user_id = $1 AND generation.idempotency_key = $2
           FOR UPDATE OF generation`,
          [input.userId, input.idempotencyKey],
        );
        if (replay.rows[0]) {
          assertIdempotencyHash(
            replay.rows[0].request_hash,
            requestHash,
            'TK_PROMPT_GENERATION_IDEMPOTENCY_CONFLICT',
          );
          assertGenerationReadable(replay.rows[0]);
          return mapGeneration(replay.rows[0], await readOptions(client, replay.rows[0].id));
        }

        const runResult = await client.query<TkPromptRunRow>(
          `SELECT * FROM tk_prompt_runs
           WHERE id = $1 AND user_id = $2
           FOR UPDATE`,
          [input.runId, input.userId],
        );
        const run = runResult.rows[0];
        if (!run) throw repositoryError('TK Prompt Engine 任务不存在', 404, 'TK_PROMPT_RUN_NOT_FOUND');
        assertRunReadyForGeneration(run);

        const active = await client.query(
          `SELECT 1 FROM tk_prompt_generations
           WHERE run_id = $1 AND status IN ('queued', 'strategizing', 'expanding')
           LIMIT 1`,
          [input.runId],
        );
        if (active.rowCount) {
          throw repositoryError('已有一批 TK 提示词正在生成', 409, 'TK_PROMPT_GENERATION_ACTIVE');
        }

        const settingsResult = await client.query<TkPromptSettingsRow>(
          `SELECT schema_version, generation_credits, available, updated_at
           FROM tk_prompt_engine_settings WHERE singleton_id = 1 FOR UPDATE`,
        );
        const settings = settingsResult.rows[0];
        if (!settings || !settings.available) {
          throw repositoryError('TK Prompt Engine 当前未开放', 409, 'TK_PROMPT_ENGINE_UNAVAILABLE');
        }
        const configuredCredits = toInt(settings.generation_credits);
        if (input.expectedGenerationCredits !== configuredCredits) {
          throw repositoryError('方案生成价格已变化', 409, 'TK_PROMPT_PRICE_CHANGED');
        }

        // 与订阅结算、普通生成及退款保持同一把锁顺序：先 users，再 credit_lots。
        // 否则“新建另一商品批次”与“失败整批退款”可形成 lots ↔ users 死锁。
        const creditUser = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE id = $1 FOR UPDATE`,
          [input.userId],
        );
        if (!creditUser.rows[0]) {
          throw repositoryError('积分用户不存在', 404, 'TK_PROMPT_CREDIT_USER_NOT_FOUND');
        }

        const history = await client.query<{ next_ordinal: number | string; has_completed: boolean }>(
          `SELECT COALESCE(max(ordinal), 0) + 1 AS next_ordinal,
                  bool_or(status = 'completed') AS has_completed
           FROM tk_prompt_generations
           WHERE run_id = $1`,
          [input.runId],
        );
        const ordinal = toInt(history.rows[0]?.next_ordinal ?? 1);
        const isFree = history.rows[0]?.has_completed !== true;
        const credits = isFree ? 0 : configuredCredits;
        let mainCreditsUsed = 0;
        let addonCreditsUsed = 0;
        if (credits > 0) {
          requireCreditCallbacks(creditCallbacks);
          const allocation = (await planCredits(client, input.userId, [credits]))[0];
          if (!allocation || allocation.mainAmount + allocation.addonAmount !== credits) {
            throw repositoryError('TK 提示词积分规划不完整', 409, 'TK_PROMPT_CREDIT_PLAN_INVALID');
          }
          mainCreditsUsed = allocation.mainAmount;
          addonCreditsUsed = allocation.addonAmount;
        }

        const inserted = await client.query<TkPromptGenerationRow>(
          `INSERT INTO tk_prompt_generations (
             run_id, user_id, ordinal, idempotency_key, request_hash,
             confirmed_fact_pack, creative_input, video_config,
             is_free, credits, credit_status, main_credits_used, addon_credits_used
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6::jsonb, $7::jsonb, $8::jsonb,
             $9, $10, $11, $12, $13
           ) RETURNING *`,
          [
            input.runId,
            input.userId,
            ordinal,
            input.idempotencyKey,
            requestHash,
            JSON.stringify(input.confirmedFactPack),
            JSON.stringify(creativeInput),
            JSON.stringify(videoConfig),
            isFree,
            credits,
            credits > 0 ? 'held' : 'none',
            mainCreditsUsed,
            addonCreditsUsed,
          ],
        );
        const generation = requiredRow(inserted.rows[0], 'TK Prompt generation 插入失败');
        if (credits > 0) {
          await creditCallbacks!.holdWithClient({
            client,
            userId: input.userId,
            generationId: generation.id,
            eventKey: tkPromptCreditEventKey(generation.id),
            mainAmount: mainCreditsUsed,
            addonAmount: addonCreditsUsed,
          });
        }
        await client.query(
          `UPDATE tk_prompt_runs
           SET expires_at = now() + interval '24 hours', updated_at = now()
           WHERE id = $1`,
          [input.runId],
        );
        return mapGeneration(generation, []);
      });
    },

    async getGeneration(userId: string, generationId: string): Promise<TkPromptGeneration> {
      const result = await reader.query<TkPromptGenerationRow>(
        `SELECT * FROM tk_prompt_generations WHERE id = $1 AND user_id = $2`,
        [generationId, userId],
      );
      const row = result.rows[0];
      if (!row) {
        throw repositoryError('TK Prompt Engine 生成批次不存在', 404, 'TK_PROMPT_GENERATION_NOT_FOUND');
      }
      assertGenerationReadable(row);
      return mapGeneration(row, await readOptions(reader, row.id));
    },

    async claimGenerationStrategy(input: {
      generationId: string;
      staleBefore: Date;
      expectedAttempt: number;
    }): Promise<TkPromptGenerationWork | null> {
      assertExpectedAttempt(input.expectedAttempt);
      const result = await reader.query<TkPromptGenerationRow>(
        `UPDATE tk_prompt_generations
         SET status = 'strategizing', started_at = clock_timestamp(),
             claim_token = gen_random_uuid(),
             attempt_count = attempt_count + 1, updated_at = clock_timestamp()
         WHERE id = $1
           AND status IN ('queued', 'strategizing')
           AND content_purged_at IS NULL
           AND expires_at > now()
           AND (status = 'queued' OR started_at IS NULL OR started_at <= $2)
           AND attempt_count + 1 = $3
         RETURNING *`,
        [input.generationId, input.staleBefore, input.expectedAttempt],
      );
      return result.rows[0] ? mapGenerationWork(result.rows[0], []) : null;
    },

    async getGenerationWork(userId: string, generationId: string): Promise<TkPromptGenerationContext> {
      const result = await reader.query<TkPromptGenerationRow>(
        `SELECT * FROM tk_prompt_generations WHERE id = $1 AND user_id = $2`,
        [generationId, userId],
      );
      const row = result.rows[0];
      if (!row) {
        throw repositoryError('TK Prompt Engine 生成批次不存在', 404, 'TK_PROMPT_GENERATION_NOT_FOUND');
      }
      assertGenerationReadable(row);
      return mapGenerationContext(row, await readOptions(reader, row.id));
    },

    async saveStrategiesAndCreateOptions(input: {
      generationId: string;
      userId: string;
      claimToken: string;
      strategies: TkPromptStrategyBlueprint[];
    }): Promise<TkPromptGeneration> {
      assertClaimToken(input.claimToken);
      const strategies = validateStrategySet(input.strategies);
      return transaction(async client => {
        const generationResult = await client.query<TkPromptGenerationRow>(
          `SELECT * FROM tk_prompt_generations
           WHERE id = $1 AND user_id = $2
           FOR UPDATE`,
          [input.generationId, input.userId],
        );
        const generation = generationResult.rows[0];
        if (!generation) {
          throw repositoryError('TK Prompt Engine 生成批次不存在', 404, 'TK_PROMPT_GENERATION_NOT_FOUND');
        }
        if (generation.status === 'expanding' && generation.strategy_set !== null) {
          const options = await readOptions(client, generation.id);
          return mapGeneration(generation, options);
        }
        if (generation.status !== 'strategizing') {
          throw repositoryError('策略任务状态已变化', 409, 'TK_PROMPT_GENERATION_STATE_CONFLICT');
        }
        if (generation.claim_token !== input.claimToken) {
          throw repositoryError('策略任务领取凭证已失效', 409, 'TK_PROMPT_GENERATION_CLAIM_STALE');
        }
        const updated = await client.query<TkPromptGenerationRow>(
          `UPDATE tk_prompt_generations
           SET status = 'expanding', strategy_set = $3::jsonb,
               claim_token = NULL,
               expires_at = now() + interval '24 hours', updated_at = now()
           WHERE id = $1 AND user_id = $2 AND status = 'strategizing'
             AND claim_token = $4
           RETURNING *`,
          [input.generationId, input.userId, JSON.stringify(strategies), input.claimToken],
        );
        const next = requiredRow(updated.rows[0], '策略任务状态已变化');
        const inserted = await client.query<TkPromptOptionRow>(
          `INSERT INTO tk_prompt_options (
             generation_id, user_id, slot, strategy_blueprint
           )
           SELECT $1, $2, item ->> 'slot', item
           FROM jsonb_array_elements($3::jsonb) AS item
           ON CONFLICT (generation_id, slot) DO NOTHING
           RETURNING *`,
          [input.generationId, input.userId, JSON.stringify(strategies)],
        );
        const options = inserted.rowCount === 3
          ? inserted.rows
          : await readOptions(client, input.generationId);
        if (options.length !== 3) {
          throw repositoryError('三方案初始化不完整', 409, 'TK_PROMPT_OPTIONS_INCOMPLETE');
        }
        return mapGeneration(next, options);
      });
    },

    async claimOption(input: {
      optionId: string;
      staleBefore: Date;
      expectedAttempt: number;
    }): Promise<TkPromptOptionWork | null> {
      assertExpectedAttempt(input.expectedAttempt);
      const result = await reader.query<TkPromptOptionRow>(
        `UPDATE tk_prompt_options option
         SET status = 'processing', started_at = clock_timestamp(),
             claim_token = gen_random_uuid(),
             attempt_count = option.attempt_count + 1, updated_at = clock_timestamp()
         FROM tk_prompt_generations generation
         WHERE option.id = $1
           AND option.generation_id = generation.id
           AND generation.status = 'expanding'
           AND generation.content_purged_at IS NULL
           AND generation.expires_at > now()
           AND option.status IN ('queued', 'processing')
           AND (option.status = 'queued' OR option.started_at IS NULL OR option.started_at <= $2)
           AND option.attempt_count + 1 = $3
         RETURNING option.*`,
        [input.optionId, input.staleBefore, input.expectedAttempt],
      );
      return result.rows[0] ? mapOptionWork(result.rows[0]) : null;
    },

    async recoverableWork(staleBefore: Date): Promise<{
      runs: Array<{ id: string; attempt: number }>;
      generations: Array<{ id: string; attempt: number }>;
      options: Array<{ id: string; attempt: number }>;
    }> {
      return transaction(async client => {
        const recovered = {
          runs: [] as Array<{ id: string; attempt: number }>,
          generations: [] as Array<{ id: string; attempt: number }>,
          options: [] as Array<{ id: string; attempt: number }>,
        };

        const runCandidates = await client.query<{ id: string }>(
          `SELECT id FROM tk_prompt_runs
           WHERE status = 'analyzing' AND content_purged_at IS NULL
             AND expires_at > clock_timestamp()
             AND (started_at IS NULL OR started_at <= $1)
           ORDER BY created_at ASC, id ASC LIMIT 200`,
          [staleBefore],
        );
        for (const candidate of runCandidates.rows) {
          const locked = await client.query<TkPromptRunRow>(
            `SELECT * FROM tk_prompt_runs
             WHERE id = $1 AND status = 'analyzing'
               AND content_purged_at IS NULL
               AND expires_at > clock_timestamp()
               AND (started_at IS NULL OR started_at <= $2)
             FOR UPDATE`,
            [candidate.id, staleBefore],
          );
          const run = locked.rows[0];
          if (!run) continue;
          if (run.claim_token !== null) {
            const attempted = await hasProviderAttemptForClaim(client, {
              runId: run.id,
              generationId: null,
              optionId: null,
              stage: 'analysis',
              jobAttempt: toInt(run.attempt_count),
              claimToken: run.claim_token,
            });
            if (attempted) {
              await client.query(
                `UPDATE tk_prompt_runs
                 SET status = 'failed', evidence_profile = NULL,
                     failure_reason = 'TK_PROMPT_PROVIDER_ATTEMPT_NOT_REPLAYABLE: Provider 调用事实已存在，禁止恢复后重复付费。',
                     claim_token = NULL, completed_at = clock_timestamp(),
                     expires_at = clock_timestamp() + interval '24 hours',
                     updated_at = clock_timestamp()
                 WHERE id = $1 AND status = 'analyzing' AND claim_token = $2`,
                [run.id, run.claim_token],
              );
              continue;
            }
            await client.query(
              `UPDATE tk_prompt_runs
               SET started_at = NULL, claim_token = NULL, updated_at = clock_timestamp()
               WHERE id = $1 AND status = 'analyzing' AND claim_token = $2`,
              [run.id, run.claim_token],
            );
          }
          recovered.runs.push({ id: run.id, attempt: toInt(run.attempt_count) + 1 });
        }

        const generationCandidates = await client.query<{ id: string }>(
          `SELECT id FROM tk_prompt_generations
           WHERE status IN ('queued', 'strategizing') AND content_purged_at IS NULL
             AND expires_at > clock_timestamp()
             AND (status = 'queued' OR started_at IS NULL OR started_at <= $1)
           ORDER BY created_at ASC, id ASC LIMIT 200`,
          [staleBefore],
        );
        const optionGenerationCandidates = await client.query<{ id: string }>(
          `SELECT DISTINCT generation.id, generation.created_at
           FROM tk_prompt_generations generation
           JOIN tk_prompt_options option ON option.generation_id = generation.id
           WHERE generation.status = 'expanding'
             AND generation.content_purged_at IS NULL
             AND generation.expires_at > clock_timestamp()
             AND option.status IN ('queued', 'processing')
             AND (option.status = 'queued' OR option.started_at IS NULL OR option.started_at <= $1)
           ORDER BY generation.created_at ASC, generation.id ASC LIMIT 200`,
          [staleBefore],
        );
        const orderedGenerationIds = [
          ...generationCandidates.rows.map(row => row.id),
          ...optionGenerationCandidates.rows.map(row => row.id),
        ].filter((id, index, all) => all.indexOf(id) === index);

        for (const candidateId of orderedGenerationIds) {
          const { generation, options } = await lockGenerationAndOptions(
            client,
            candidateId,
            // 候选查询只返回 id；先读取 owner，再由统一锁函数复验 owner。
            await readTkPromptGenerationOwner(client, candidateId),
          );
          const live = await client.query<{ live: boolean }>(
            `SELECT expires_at > clock_timestamp() AS live
             FROM tk_prompt_generations WHERE id = $1`,
            [generation.id],
          );
          if (live.rows[0]?.live !== true) continue;

          if (generation.status === 'queued') {
            recovered.generations.push({
              id: generation.id,
              attempt: toInt(generation.attempt_count) + 1,
            });
            continue;
          }
          if (generation.status === 'strategizing'
            && isStaleClaim(generation.started_at, staleBefore)) {
            const claimToken = requiredClaimToken(generation.claim_token);
            const attempted = await hasProviderAttemptForClaim(client, {
              runId: generation.run_id,
              generationId: generation.id,
              optionId: null,
              stage: 'strategy',
              jobAttempt: toInt(generation.attempt_count),
              claimToken,
            });
            if (attempted) {
              await failGenerationWithClient({
                client,
                generationId: generation.id,
                userId: generation.user_id,
                failureReason: 'TK_PROMPT_PROVIDER_ATTEMPT_NOT_REPLAYABLE: Provider 调用事实已存在，禁止恢复后重复付费。',
                creditCallbacks,
                expectedGenerationClaim: claimToken,
              });
              continue;
            }
            await client.query(
              `UPDATE tk_prompt_generations
               SET status = 'queued', started_at = NULL, claim_token = NULL,
                   updated_at = clock_timestamp()
               WHERE id = $1 AND status = 'strategizing' AND claim_token = $2`,
              [generation.id, claimToken],
            );
            recovered.generations.push({
              id: generation.id,
              attempt: toInt(generation.attempt_count) + 1,
            });
            continue;
          }
          if (generation.status !== 'expanding') continue;

          const recoverableOptions: Array<{ row: TkPromptOptionRow; claimToken: string | null }> = [];
          let attemptedOption: { optionId: string; claimToken: string } | null = null;
          for (const option of options) {
            if (option.status === 'queued') {
              recoverableOptions.push({ row: option, claimToken: null });
              continue;
            }
            if (option.status !== 'processing' || !isStaleClaim(option.started_at, staleBefore)) {
              continue;
            }
            const claimToken = requiredClaimToken(option.claim_token);
            const attempted = await hasProviderAttemptForClaim(client, {
              runId: generation.run_id,
              generationId: generation.id,
              optionId: option.id,
              stage: 'option',
              jobAttempt: toInt(option.attempt_count),
              claimToken,
            });
            if (attempted) {
              attemptedOption = { optionId: option.id, claimToken };
              break;
            }
            recoverableOptions.push({ row: option, claimToken });
          }
          if (attemptedOption) {
            await failGenerationWithClient({
              client,
              generationId: generation.id,
              userId: generation.user_id,
              failureReason: 'TK_PROMPT_PROVIDER_ATTEMPT_NOT_REPLAYABLE: Provider 调用事实已存在，禁止恢复后重复付费。',
              creditCallbacks,
              expectedOptionClaim: attemptedOption,
            });
            continue;
          }
          for (const recoverable of recoverableOptions) {
            if (recoverable.claimToken !== null) {
              await client.query(
                `UPDATE tk_prompt_options
                 SET status = 'queued', started_at = NULL, claim_token = NULL,
                     updated_at = clock_timestamp()
                 WHERE id = $1 AND status = 'processing' AND claim_token = $2`,
                [recoverable.row.id, recoverable.claimToken],
              );
            }
            recovered.options.push({
              id: recoverable.row.id,
              attempt: toInt(recoverable.row.attempt_count) + 1,
            });
          }
        }
        return recovered;
      });
    },

    async completeOption(input: {
      optionId: string;
      userId: string;
      claimToken: string;
      plan: TkPromptPlan;
    }): Promise<{ option: TkPromptGeneration['options'][number]; generationCompleted: boolean }> {
      assertClaimToken(input.claimToken);
      const plan = tkPromptPlanSchema.parse(input.plan);
      return transaction(async client => {
        const identity = await client.query<{ generation_id: string }>(
          `SELECT generation_id FROM tk_prompt_options
           WHERE id = $1 AND user_id = $2`,
          [input.optionId, input.userId],
        );
        const generationId = identity.rows[0]?.generation_id;
        if (!generationId) {
          throw repositoryError('TK 提示词方案不存在', 404, 'TK_PROMPT_OPTION_NOT_FOUND');
        }
        // 所有终态路径固定 generation → safe/native/creative，避免 complete/fail 交叉死锁。
        const { generation, options } = await lockGenerationAndOptions(
          client,
          generationId,
          input.userId,
        );
        const option = options.find(item => item.id === input.optionId);
        if (!option) throw repositoryError('TK 提示词方案不存在', 404, 'TK_PROMPT_OPTION_NOT_FOUND');
        if (option.status === 'completed') {
          return { option: mapOption(option), generationCompleted: false };
        }
        if (!generation || generation.status !== 'expanding') {
          throw repositoryError('生成批次已终止，不能写入方案', 409, 'TK_PROMPT_GENERATION_STATE_CONFLICT');
        }
        if (option.status !== 'processing' || option.claim_token !== input.claimToken) {
          throw repositoryError('方案任务领取凭证已失效', 409, 'TK_PROMPT_OPTION_CLAIM_STALE');
        }
        const completed = await client.query<TkPromptOptionRow>(
          `UPDATE tk_prompt_options
           SET status = 'completed', plan = $3::jsonb,
               failure_reason = NULL, completed_at = now(), claim_token = NULL,
               updated_at = now()
           WHERE id = $1 AND user_id = $2 AND status = 'processing'
             AND claim_token = $4
           RETURNING *`,
          [input.optionId, input.userId, JSON.stringify(plan), input.claimToken],
        );
        const nextOption = requiredRow(completed.rows[0], '方案任务状态已变化');
        const count = await client.query<{ completed_count: number | string }>(
          `SELECT count(*) AS completed_count
           FROM tk_prompt_options
           WHERE generation_id = $1 AND status = 'completed'
             AND content_purged_at IS NULL`,
          [generation.id],
        );
        if (toInt(count.rows[0]?.completed_count ?? 0) !== 3) {
          return { option: mapOption(nextOption), generationCompleted: false };
        }
        if (toInt(generation.credits) > 0) {
          requireCreditCallbacks(creditCallbacks);
          await creditCallbacks!.settleWithClient({
            client,
            userId: generation.user_id,
            generationId: generation.id,
            eventKey: tkPromptCreditEventKey(generation.id),
            credits: toInt(generation.credits),
          });
        }
        const finalized = await client.query<TkPromptGenerationRow>(
          `UPDATE tk_prompt_generations
           SET status = 'completed',
               credit_status = CASE WHEN credits > 0 THEN 'settled' ELSE 'none' END,
               failure_reason = NULL, completed_at = now(), claim_token = NULL,
               expires_at = now() + interval '24 hours', updated_at = now()
           WHERE id = $1 AND status = 'expanding'
           RETURNING *`,
          [generation.id],
        );
        if (!finalized.rows[0]) {
          throw repositoryError('三方案完成收口冲突', 409, 'TK_PROMPT_GENERATION_FINALIZE_CONFLICT');
        }
        await client.query(
          `UPDATE tk_prompt_runs
           SET expires_at = now() + interval '24 hours', updated_at = now()
           WHERE id = $1`,
          [generation.run_id],
        );
        return { option: mapOption(nextOption), generationCompleted: true };
      });
    },

    async failOption(input: {
      optionId: string;
      userId: string;
      claimToken: string;
      failureReason: string;
    }): Promise<void> {
      assertClaimToken(input.claimToken);
      const reason = normalizeFailureReason(input.failureReason);
      await transaction(async client => {
        const identity = await client.query<{ generation_id: string }>(
          `SELECT generation_id FROM tk_prompt_options
           WHERE id = $1 AND user_id = $2`,
          [input.optionId, input.userId],
        );
        const generationId = identity.rows[0]?.generation_id;
        if (!generationId) {
          throw repositoryError('TK 提示词方案不存在', 404, 'TK_PROMPT_OPTION_NOT_FOUND');
        }
        await failGenerationWithClient({
          client,
          generationId,
          userId: input.userId,
          failureReason: reason,
          creditCallbacks,
          expectedOptionClaim: {
            optionId: input.optionId,
            claimToken: input.claimToken,
          },
        });
      });
    },

    async failGeneration(input: {
      generationId: string;
      userId: string;
      claimToken: string;
      failureReason: string;
    }): Promise<void> {
      assertClaimToken(input.claimToken);
      const reason = normalizeFailureReason(input.failureReason);
      await transaction(client => failGenerationWithClient({
        client,
        generationId: input.generationId,
        userId: input.userId,
        failureReason: reason,
        creditCallbacks,
        expectedGenerationClaim: input.claimToken,
      }));
    },

    async expireActive(limit = 100): Promise<{ generations: number; runs: number }> {
      assertMaintenanceLimit(limit);
      return transaction(async client => {
        const candidates = await client.query<{ id: string; user_id: string }>(
          `SELECT id, user_id
           FROM tk_prompt_generations
           WHERE status IN ('queued', 'strategizing', 'expanding')
             AND content_purged_at IS NULL
             AND expires_at <= clock_timestamp()
           ORDER BY expires_at ASC, id ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED`,
          [limit],
        );
        let generations = 0;
        for (const candidate of candidates.rows) {
          await failGenerationWithClient({
            client,
            generationId: candidate.id,
            userId: candidate.user_id,
            failureReason: 'TK_PROMPT_ACTIVE_EXPIRED: 生成批次超过可恢复期限，已终止并解除积分预扣。',
            creditCallbacks,
          });
          generations += 1;
        }
        const expiredRuns = await client.query<{ id: string }>(
          `WITH candidates AS (
             SELECT id
             FROM tk_prompt_runs
             WHERE status = 'analyzing'
               AND content_purged_at IS NULL
               AND expires_at <= clock_timestamp()
             ORDER BY expires_at ASC, id ASC
             LIMIT $1
             FOR UPDATE SKIP LOCKED
           )
           UPDATE tk_prompt_runs run
           SET status = 'failed', evidence_profile = NULL,
               failure_reason = 'TK_PROMPT_ACTIVE_EXPIRED: 事实分析超过可恢复期限，已终止。',
               claim_token = NULL, completed_at = clock_timestamp(),
               expires_at = clock_timestamp() + interval '24 hours',
               updated_at = clock_timestamp()
           FROM candidates
           WHERE run.id = candidates.id AND run.status = 'analyzing'
           RETURNING run.id`,
          [limit],
        );
        return {
          generations,
          runs: expiredRuns.rowCount ?? expiredRuns.rows.length,
        };
      });
    },

    async expireStartedProviderRequests(
      staleBefore: Date,
      limit = 100,
    ): Promise<number> {
      assertMaintenanceLimit(limit);
      if (Number.isNaN(staleBefore.getTime())) {
        throw repositoryError(
          'Provider 账本过期时间无效',
          400,
          'TK_PROMPT_PROVIDER_LEDGER_STALE_BEFORE_INVALID',
        );
      }
      const result = await reader.query<{ id: string }>(
        `WITH candidates AS (
           SELECT id
           FROM tk_prompt_provider_requests
           WHERE request_status = 'started'
             AND started_at <= $1
           ORDER BY started_at ASC, id ASC
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         UPDATE tk_prompt_provider_requests request
         SET request_status = 'failed',
             error_code = 'TK_PROMPT_PROVIDER_OUTCOME_UNKNOWN',
             error_classification = 'provider-outcome-unknown',
             cost_status = 'unknown', cost_cny = NULL,
             completed_at = clock_timestamp()
         FROM candidates
         WHERE request.id = candidates.id
           AND request.request_status = 'started'
         RETURNING request.id`,
        [staleBefore, limit],
      );
      return result.rowCount ?? result.rows.length;
    },

    async resume(userId: string): Promise<{
      run: TkPromptRun | null;
      generation: TkPromptGeneration | null;
    }> {
      const runResult = await reader.query<TkPromptRunRow>(
        `SELECT run.*
         FROM tk_prompt_runs run
         WHERE run.user_id = $1
           AND run.status <> 'archived'
           AND run.content_purged_at IS NULL
           AND (
             run.expires_at > now()
             OR EXISTS (
               SELECT 1 FROM tk_prompt_generations generation
               WHERE generation.run_id = run.id
                 AND generation.content_purged_at IS NULL
                 AND (
                   generation.expires_at > now()
                   OR generation.status IN ('queued', 'strategizing', 'expanding')
                 )
             )
           )
         ORDER BY run.updated_at DESC, run.id DESC
         LIMIT 1`,
        [userId],
      );
      const runRow = runResult.rows[0];
      if (!runRow) return { run: null, generation: null };
      const generationResult = await reader.query<TkPromptGenerationRow>(
        `SELECT * FROM tk_prompt_generations
         WHERE run_id = $1 AND user_id = $2 AND content_purged_at IS NULL
           AND (expires_at > now() OR status IN ('queued', 'strategizing', 'expanding'))
         ORDER BY CASE
           WHEN status IN ('queued', 'strategizing', 'expanding') THEN 0
           WHEN status = 'completed' THEN 1
           ELSE 2
         END ASC, ordinal DESC
         LIMIT 1`,
        [runRow.id, userId],
      );
      const generationRow = generationResult.rows[0];
      return {
        run: mapRun(runRow),
        generation: generationRow
          ? mapGeneration(generationRow, await readOptions(reader, generationRow.id))
          : null,
      };
    },

    async purgeExpired(limit = 100): Promise<{ generations: number; runs: number }> {
      assertMaintenanceLimit(limit);
      return transaction(async client => {
        const purgedGenerations = await client.query<{ id: string }>(
          `WITH candidates AS (
             SELECT id FROM tk_prompt_generations
             WHERE status IN ('completed', 'failed')
               AND content_purged_at IS NULL
               AND expires_at <= now()
             ORDER BY expires_at ASC, id ASC
             LIMIT $1
             FOR UPDATE SKIP LOCKED
           ), purged_options AS (
             UPDATE tk_prompt_options option
             SET strategy_blueprint = NULL, plan = NULL, failure_reason = NULL,
                 content_purged_at = now(), updated_at = now()
             FROM candidates
             WHERE option.generation_id = candidates.id
               AND option.content_purged_at IS NULL
             RETURNING option.id
           )
           UPDATE tk_prompt_generations generation
           SET confirmed_fact_pack = NULL, creative_input = NULL, video_config = NULL,
               strategy_set = NULL, failure_reason = NULL,
               content_purged_at = now(), updated_at = now()
           FROM candidates
           WHERE generation.id = candidates.id
           RETURNING generation.id`,
          [limit],
        );
        const purgedRuns = await client.query<{ id: string }>(
          `WITH candidates AS (
             SELECT run.id FROM tk_prompt_runs run
             WHERE run.status IN ('ready', 'failed')
               AND run.content_purged_at IS NULL
               AND run.expires_at <= now()
               AND NOT EXISTS (
                 SELECT 1 FROM tk_prompt_generations generation
                 WHERE generation.run_id = run.id
                   AND generation.content_purged_at IS NULL
                   AND (
                     generation.expires_at > now()
                     OR generation.status IN ('queued', 'strategizing', 'expanding')
                   )
               )
             ORDER BY run.expires_at ASC, run.id ASC
             LIMIT $1
             FOR UPDATE OF run SKIP LOCKED
           )
           UPDATE tk_prompt_runs run
           SET status = 'archived', image_asset_ids = '{}'::uuid[],
               evidence_profile = NULL, failure_reason = NULL,
               content_purged_at = now(), updated_at = now()
           FROM candidates
           WHERE run.id = candidates.id
           RETURNING run.id`,
          [limit],
        );
        return {
          generations: purgedGenerations.rowCount ?? purgedGenerations.rows.length,
          runs: purgedRuns.rowCount ?? purgedRuns.rows.length,
        };
      });
    },

    async beginProviderRequest(input: BeginTkPromptProviderRequestInput): Promise<string> {
      assertProviderOwnerShape(input);
      assertClaimToken(input.claimToken);
      return transaction(async client => {
        await assertProviderClaimWithClient(client, input);
        const result = await client.query<{ id: string }>(
          `INSERT INTO tk_prompt_provider_requests (
             request_key, run_id, generation_id, option_id, user_id,
             stage, action, job_attempt, claim_token, repair_round, transport_attempt,
             provider, model, service_tier
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10, $11,
             $12, $13, $14
           )
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            input.requestKey,
            input.runId,
            input.generationId,
            input.optionId,
            input.userId,
            input.stage,
            input.action,
            input.jobAttempt,
            input.claimToken,
            input.repairRound,
            input.transportAttempt,
            input.provider,
            input.model,
            input.serviceTier,
          ],
        );
        const id = result.rows[0]?.id;
        if (!id) {
          throw repositoryError(
            'TK Prompt Provider 逻辑请求已存在，拒绝重复付费调用',
            409,
            'TK_PROMPT_PROVIDER_LEDGER_REPLAY',
          );
        }
        return id;
      });
    },

    async completeProviderRequest(
      requestId: string,
      terminal: CompleteTkPromptProviderRequestInput,
    ): Promise<boolean> {
      validateProviderTerminal(terminal);
      return transaction(async client => {
        const existing = await client.query<TkPromptProviderRequestRow>(
          `SELECT id, request_key, request_status
           FROM tk_prompt_provider_requests
           WHERE id = $1
           FOR UPDATE`,
          [requestId],
        );
        const row = existing.rows[0];
        if (!row) {
          throw repositoryError('TK Prompt Provider 请求不存在', 404, 'TK_PROMPT_PROVIDER_LEDGER_MISSING');
        }
        if (row.request_status !== 'started') return false;
        const known = terminal.costStatus === 'known' ? terminal : null;
        const updated = await client.query(
          `UPDATE tk_prompt_provider_requests
           SET request_status = $2,
               provider_request_id = $3, provider_response_id = $4,
               x_tt_log_id = $5, http_status = $6,
               error_code = $7, error_classification = $8,
               input_tokens = $9, cached_input_tokens = $10, output_tokens = $11,
               pricing_rule_id = $12, price_version = $13, pricing_tier = $14,
               input_price_per_million_cny = $15,
               cached_input_price_per_million_cny = $16,
               output_price_per_million_cny = $17,
               cost_cny = $18, cost_status = $19,
               completed_at = now()
           WHERE id = $1 AND request_status = 'started'`,
          [
            requestId,
            terminal.status,
            terminal.providerRequestId,
            terminal.providerResponseId,
            terminal.xTtLogId,
            terminal.httpStatus,
            terminal.errorCode,
            terminal.errorClassification,
            terminal.inputTokens,
            terminal.cachedInputTokens,
            terminal.outputTokens,
            known?.pricingRuleId ?? null,
            known?.priceVersion ?? null,
            known?.pricingTier ?? null,
            known?.inputPricePerMillionCny ?? null,
            known?.cachedInputPricePerMillionCny ?? null,
            known?.outputPricePerMillionCny ?? null,
            known?.costCny ?? null,
            terminal.costStatus,
          ],
        );
        return Boolean(updated.rowCount);
      });
    },
  };
}

export const productionTkPromptCreditCallbacks: TkPromptCreditCallbacks = {
  async holdWithClient(input) {
    assertCreditEventKey(input.generationId, input.eventKey);
    await holdTkPromptCreditsWithClient({
      client: input.client,
      userId: input.userId,
      generationId: input.generationId,
      mainAmount: input.mainAmount,
      addonAmount: input.addonAmount,
    });
    await assertCreditAllocationTotal(
      input.client,
      input.generationId,
      input.eventKey,
      input.mainAmount + input.addonAmount,
    );
  },
  async settleWithClient(input) {
    assertCreditEventKey(input.generationId, input.eventKey);
    await assertCreditAllocationTotal(
      input.client,
      input.generationId,
      input.eventKey,
      input.credits,
    );
    await settleTkPromptCreditsWithClient(input.client, input.generationId);
  },
  async refundWithClient(input) {
    assertCreditEventKey(input.generationId, input.eventKey);
    await assertCreditAllocationTotal(
      input.client,
      input.generationId,
      input.eventKey,
      input.credits,
    );
    const released = await releaseTkPromptCreditsWithClient(
      input.client,
      input.userId,
      input.generationId,
    );
    if (released.returned + released.compensated + (released.revoked ?? 0) !== input.credits) {
      throw repositoryError(
        'TK 提示词退款金额与整批冻结积分不一致',
        409,
        'TK_PROMPT_CREDIT_REFUND_MISMATCH',
      );
    }
  },
};

export const tkPromptEngineRepository = createTkPromptEngineRepository({
  creditCallbacks: productionTkPromptCreditCallbacks,
});
export type TkPromptEngineRepository = ReturnType<typeof createTkPromptEngineRepository>;

async function failGenerationWithClient(input: {
  client: DbClient;
  generationId: string;
  userId: string;
  failureReason: string;
  creditCallbacks?: TkPromptCreditCallbacks;
  expectedGenerationClaim?: string;
  expectedOptionClaim?: { optionId: string; claimToken: string };
}) {
  const { generation, options } = await lockGenerationAndOptions(
    input.client,
    input.generationId,
    input.userId,
  );
  if (generation.status === 'failed') return;
  if (generation.status === 'completed') {
    throw repositoryError('已完成批次不能改为失败', 409, 'TK_PROMPT_GENERATION_STATE_CONFLICT');
  }
  if (input.expectedGenerationClaim !== undefined && (
    generation.status !== 'strategizing'
    || generation.claim_token !== input.expectedGenerationClaim
  )) {
    throw repositoryError('策略任务领取凭证已失效', 409, 'TK_PROMPT_GENERATION_CLAIM_STALE');
  }
  if (input.expectedOptionClaim !== undefined) {
    const target = options.find(option => option.id === input.expectedOptionClaim!.optionId);
    if (
      !target
      || target.status !== 'processing'
      || target.claim_token !== input.expectedOptionClaim.claimToken
    ) {
      throw repositoryError('方案任务领取凭证已失效', 409, 'TK_PROMPT_OPTION_CLAIM_STALE');
    }
  }
  await input.client.query(
    `UPDATE tk_prompt_options
     SET status = 'failed', plan = NULL,
         failure_reason = $2, completed_at = now(), claim_token = NULL,
         updated_at = now()
     WHERE generation_id = $1 AND content_purged_at IS NULL`,
    [generation.id, input.failureReason],
  );
  if (toInt(generation.credits) > 0 && generation.credit_status === 'held') {
    requireCreditCallbacks(input.creditCallbacks);
    await input.creditCallbacks!.refundWithClient({
      client: input.client,
      userId: generation.user_id,
      generationId: generation.id,
      eventKey: tkPromptCreditEventKey(generation.id),
      credits: toInt(generation.credits),
    });
  }
  const failed = await input.client.query(
    `UPDATE tk_prompt_generations
     SET status = 'failed',
         credit_status = CASE WHEN credits > 0 THEN 'refunded' ELSE 'none' END,
         failure_reason = $3, completed_at = now(), claim_token = NULL,
         expires_at = now() + interval '24 hours', updated_at = now()
     WHERE id = $1 AND user_id = $2
       AND status IN ('queued', 'strategizing', 'expanding')`,
    [generation.id, input.userId, input.failureReason],
  );
  if (!failed.rowCount) {
    throw repositoryError('生成批次失败收口冲突', 409, 'TK_PROMPT_GENERATION_FINALIZE_CONFLICT');
  }
  await input.client.query(
    `UPDATE tk_prompt_runs
     SET expires_at = now() + interval '24 hours', updated_at = now()
     WHERE id = $1`,
    [generation.run_id],
  );
}

async function lockGenerationAndOptions(
  client: DbClient,
  generationId: string,
  userId: string,
) {
  const generationResult = await client.query<TkPromptGenerationRow>(
    `SELECT * FROM tk_prompt_generations
     WHERE id = $1 AND user_id = $2
     FOR UPDATE`,
    [generationId, userId],
  );
  const generation = generationResult.rows[0];
  if (!generation) {
    throw repositoryError('TK Prompt Engine 生成批次不存在', 404, 'TK_PROMPT_GENERATION_NOT_FOUND');
  }
  const options = await client.query<TkPromptOptionRow>(
    `SELECT * FROM tk_prompt_options
     WHERE generation_id = $1 AND user_id = $2
       AND content_purged_at IS NULL
     ORDER BY CASE slot WHEN 'safe' THEN 1 WHEN 'native' THEN 2 ELSE 3 END
     FOR UPDATE`,
    [generationId, userId],
  );
  return { generation, options: options.rows };
}

async function readOptions(client: DbClient, generationId: string) {
  const result = await client.query<TkPromptOptionRow>(
    `SELECT * FROM tk_prompt_options
     WHERE generation_id = $1 AND content_purged_at IS NULL
     ORDER BY CASE slot WHEN 'safe' THEN 1 WHEN 'native' THEN 2 ELSE 3 END`,
    [generationId],
  );
  return result.rows;
}

async function readTkPromptGenerationOwner(client: DbClient, generationId: string) {
  const result = await client.query<{ user_id: string }>(
    `SELECT user_id FROM tk_prompt_generations WHERE id = $1`,
    [generationId],
  );
  const userId = result.rows[0]?.user_id;
  if (!userId) {
    throw repositoryError(
      'TK Prompt Engine 生成批次不存在',
      404,
      'TK_PROMPT_GENERATION_NOT_FOUND',
    );
  }
  return userId;
}

async function hasProviderAttemptForClaim(
  client: DbClient,
  input: {
    runId: string;
    generationId: string | null;
    optionId: string | null;
    stage: TkPromptProviderStage;
    jobAttempt: number;
    claimToken: string;
  },
) {
  const result = await client.query(
    `SELECT 1 FROM tk_prompt_provider_requests
     WHERE run_id = $1
       AND generation_id IS NOT DISTINCT FROM $2::uuid
       AND option_id IS NOT DISTINCT FROM $3::uuid
       AND stage = $4 AND job_attempt = $5 AND claim_token = $6
     LIMIT 1`,
    [
      input.runId,
      input.generationId,
      input.optionId,
      input.stage,
      input.jobAttempt,
      input.claimToken,
    ],
  );
  return Boolean(result.rowCount);
}

function isStaleClaim(value: Date | string | null, staleBefore: Date) {
  return value !== null && new Date(value).getTime() <= staleBefore.getTime();
}

async function lockIdempotency(client: DbClient, key: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

function mapSettings(row: TkPromptSettingsRow): TkPromptEngineSettings {
  return {
    schemaVersion: 1,
    generationCredits: toInt(row.generation_credits),
    available: Boolean(row.available),
    updatedAt: isoDate(row.updated_at),
  };
}

function mapRun(row: TkPromptRunRow): TkPromptRun {
  return {
    id: row.id,
    schemaVersion: 1,
    status: row.status,
    imageAssetIds: row.image_asset_ids,
    evidenceProfile: row.evidence_profile === null
      ? null
      : tkPromptEvidenceProfileSchema.parse(row.evidence_profile),
    failureReason: row.failure_reason,
    createdAt: isoDate(row.created_at),
    completedAt: nullableIsoDate(row.completed_at),
  };
}

function mapRunWork(row: TkPromptRunRow): TkPromptRunWork {
  return {
    ...mapRun(row),
    userId: row.user_id,
    attemptCount: toInt(row.attempt_count),
    claimToken: requiredClaimToken(row.claim_token),
  };
}

function mapOption(row: TkPromptOptionRow): TkPromptGeneration['options'][number] {
  return {
    id: row.id,
    generationId: row.generation_id,
    slot: row.slot,
    status: row.status,
    strategyBlueprint: row.strategy_blueprint === null
      ? null
      : tkPromptStrategyBlueprintSchema.parse(row.strategy_blueprint),
    plan: row.plan === null ? null : tkPromptPlanSchema.parse(omitStoredTkPromptField(row.plan, 'publishPack')),
    failureReason: row.failure_reason,
    createdAt: isoDate(row.created_at),
    completedAt: nullableIsoDate(row.completed_at),
  };
}

function mapOptionWork(row: TkPromptOptionRow): TkPromptOptionWork {
  return {
    ...mapOption(row),
    userId: row.user_id,
    attemptCount: toInt(row.attempt_count),
    claimToken: requiredClaimToken(row.claim_token),
  };
}

function mapGeneration(
  row: TkPromptGenerationRow,
  optionRows: TkPromptOptionRow[],
): TkPromptGeneration {
  const exposePlans = row.status === 'completed';
  return tkPromptGenerationSchema.parse({
    id: row.id,
    runId: row.run_id,
    schemaVersion: 1,
    status: row.status,
    evidenceReview: parseStoredEvidenceReview(row.confirmed_fact_pack),
    creativeInput: tkPromptCreativeInputSchema.parse(omitStoredTkPromptField(row.creative_input, 'publishLanguage')),
    videoConfig: tkPromptVideoConfigSchema.parse(row.video_config),
    isFree: Boolean(row.is_free),
    credits: toInt(row.credits),
    creditStatus: row.credit_status,
    strategySet: exposePlans && row.strategy_set !== null ? row.strategy_set : [],
    options: optionRows.map(option => {
      if (exposePlans) return mapOption(option);
      return mapOption({
        ...option,
        status: option.status === 'completed' ? 'processing' : option.status,
        strategy_blueprint: null,
        plan: null,
        completed_at: option.status === 'completed' ? null : option.completed_at,
      });
    }),
    failureReason: row.failure_reason,
    createdAt: isoDate(row.created_at),
    completedAt: nullableIsoDate(row.completed_at),
  });
}

function parseStoredEvidenceReview(value: unknown): TkPromptEvidenceReview {
  if (!isJsonObject(value)) {
    throw repositoryError('确认事实快照不存在或无效', 409, 'TK_PROMPT_FACT_PACK_INVALID');
  }
  return tkPromptEvidenceReviewSchema.parse(value.evidenceReview);
}

function mapGenerationWork(
  row: TkPromptGenerationRow,
  optionRows: TkPromptOptionRow[],
): TkPromptGenerationWork {
  return {
    ...mapGenerationContext(row, optionRows),
    claimToken: requiredClaimToken(row.claim_token),
  };
}

function mapGenerationContext(
  row: TkPromptGenerationRow,
  optionRows: TkPromptOptionRow[],
): TkPromptGenerationContext {
  if (!isJsonObject(row.confirmed_fact_pack)) {
    throw repositoryError('确认事实包不存在或无效', 409, 'TK_PROMPT_FACT_PACK_INVALID');
  }
  return {
    ...mapGeneration(row, optionRows),
    userId: row.user_id,
    attemptCount: toInt(row.attempt_count),
    confirmedFactPack: row.confirmed_fact_pack,
    creativeInput: tkPromptCreativeInputSchema.parse(omitStoredTkPromptField(row.creative_input, 'publishLanguage')),
    videoConfig: tkPromptVideoConfigSchema.parse(row.video_config),
  };
}

function validateStrategySet(input: TkPromptStrategyBlueprint[]) {
  if (input.length !== 3) {
    throw repositoryError('策略集合必须正好包含三套策略', 400, 'TK_PROMPT_STRATEGY_COUNT_INVALID');
  }
  const parsed = input.map(item => tkPromptStrategyBlueprintSchema.parse(item));
  if (TK_PROMPT_SLOTS.some(slot => !parsed.some(strategy => strategy.slot === slot))) {
    throw repositoryError('策略集合必须覆盖 safe/native/creative', 400, 'TK_PROMPT_STRATEGY_SLOTS_INVALID');
  }
  const dimensions = [
    'styleForm',
    'style',
    'hookPatternId',
    'firstFrameId',
    'buyingMotivationId',
    'proofMethodId',
  ] as const;
  for (let left = 0; left < parsed.length; left += 1) {
    for (let right = left + 1; right < parsed.length; right += 1) {
      const differences = dimensions.filter(
        dimension => parsed[left]![dimension] !== parsed[right]![dimension],
      ).length;
      if (differences < 4) {
        throw repositoryError(
          '任意两套策略至少四个受控维度不同',
          400,
          'TK_PROMPT_STRATEGY_DIVERSITY_INVALID',
        );
      }
    }
  }
  return parsed;
}

function assertImageAssetIds(imageAssetIds: string[]) {
  if (imageAssetIds.length < 1 || imageAssetIds.length > 9) {
    throw repositoryError('参考图片数量必须在 1–9', 400, 'TK_PROMPT_IMAGE_COUNT_INVALID');
  }
  for (const assetId of imageAssetIds) {
    if (!isUuid(assetId)) {
      throw repositoryError('参考图片 ID 无效', 400, 'TK_PROMPT_IMAGE_ID_INVALID');
    }
  }
  if (new Set(imageAssetIds).size !== imageAssetIds.length) {
    throw repositoryError('参考图片不能重复', 400, 'TK_PROMPT_IMAGE_DUPLICATE');
  }
}

function assertIdempotencyKey(value: string) {
  if (!value || value !== value.trim() || value.length > 200) {
    throw repositoryError('幂等键无效', 400, 'TK_PROMPT_IDEMPOTENCY_KEY_INVALID');
  }
}

function assertClaimToken(value: string) {
  if (!isUuid(value)) {
    throw repositoryError('任务领取凭证无效', 400, 'TK_PROMPT_CLAIM_TOKEN_INVALID');
  }
}

function assertExpectedAttempt(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw repositoryError(
      '队列 attempt 必须是正整数',
      400,
      'TK_PROMPT_EXPECTED_ATTEMPT_INVALID',
    );
  }
}

function requiredClaimToken(value: string | null) {
  if (!value || !isUuid(value)) {
    throw repositoryError('任务缺少有效领取凭证', 409, 'TK_PROMPT_CLAIM_TOKEN_MISSING');
  }
  return value;
}

function assertMaintenanceLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw repositoryError('TTL 维护数量必须在 1–1000', 400, 'TK_PROMPT_MAINTENANCE_LIMIT_INVALID');
  }
}

function assertIdempotencyHash(actual: string, expected: string, code: string) {
  if (actual.trim() !== expected) {
    throw repositoryError('幂等键已用于其他请求', 409, code);
  }
}

function assertRunReadable(row: TkPromptRunRow) {
  if (row.content_purged_at !== null || row.status === 'archived') {
    throw repositoryError('TK Prompt Engine 任务已过期', 410, 'TK_PROMPT_RUN_EXPIRED');
  }
  if (timestampExpired(row.expires_at) && row.status !== 'analyzing') {
    throw repositoryError('TK Prompt Engine 任务已过期', 410, 'TK_PROMPT_RUN_EXPIRED');
  }
}

function assertRunReadyForGeneration(row: TkPromptRunRow) {
  assertRunReadable(row);
  if (row.status !== 'ready' || row.evidence_profile === null) {
    throw repositoryError('TK Prompt Engine 事实分析尚未就绪', 409, 'TK_PROMPT_RUN_NOT_READY');
  }
  if (timestampExpired(row.expires_at)) {
    throw repositoryError('TK Prompt Engine 任务已过期', 410, 'TK_PROMPT_RUN_EXPIRED');
  }
}

function assertGenerationReadable(row: TkPromptGenerationRow) {
  if (row.content_purged_at !== null) {
    throw repositoryError('TK Prompt Engine 生成批次已过期', 410, 'TK_PROMPT_GENERATION_EXPIRED');
  }
  if (timestampExpired(row.expires_at)
    && !['queued', 'strategizing', 'expanding'].includes(row.status)) {
    throw repositoryError('TK Prompt Engine 生成批次已过期', 410, 'TK_PROMPT_GENERATION_EXPIRED');
  }
}

function requireCreditCallbacks(
  callbacks: TkPromptCreditCallbacks | undefined,
): asserts callbacks is TkPromptCreditCallbacks {
  if (!callbacks) {
    throw repositoryError(
      '付费 TK 提示词必须注入同事务积分回调',
      500,
      'TK_PROMPT_CREDIT_CALLBACK_REQUIRED',
    );
  }
}

function assertCreditEventKey(generationId: string, eventKey: string) {
  const expected = tkPromptCreditHoldKey(generationId);
  if (eventKey !== expected || eventKey !== tkPromptCreditEventKey(generationId)) {
    throw repositoryError(
      'TK 提示词积分事件键不一致',
      409,
      'TK_PROMPT_CREDIT_EVENT_KEY_MISMATCH',
    );
  }
}

async function assertCreditAllocationTotal(
  client: DbClient,
  generationId: string,
  eventKey: string,
  expectedCredits: number,
) {
  const result = await client.query<{ amount: number | string }>(
    `SELECT amount
     FROM credit_allocations
     WHERE related_tk_prompt_generation_id = $1
       AND business_event_key = $2
     ORDER BY id
     FOR UPDATE`,
    [generationId, eventKey],
  );
  const actual = result.rows.reduce((sum, allocation) => sum + toInt(allocation.amount), 0);
  if (actual !== expectedCredits) {
    throw repositoryError(
      'TK 提示词积分分配与整批价格不一致',
      409,
      'TK_PROMPT_CREDIT_ALLOCATION_MISMATCH',
    );
  }
}

async function assertProviderClaimWithClient(
  client: DbClient,
  input: BeginTkPromptProviderRequestInput,
) {
  if (input.stage !== 'analysis') {
    const generationId = input.generationId;
    if (!generationId) throw providerClaimStale();
    const generation = input.stage === 'strategy'
      ? await client.query<TkPromptGenerationRow>(
          `SELECT * FROM tk_prompt_generations
           WHERE id = $1 AND user_id = $2 AND run_id = $3
             AND status = 'strategizing'
             AND claim_token = $4 AND attempt_count = $5
             AND content_purged_at IS NULL
             AND expires_at > clock_timestamp()
           FOR UPDATE`,
          [generationId, input.userId, input.runId, input.claimToken, input.jobAttempt],
        )
      : await client.query<TkPromptGenerationRow>(
          `SELECT * FROM tk_prompt_generations
           WHERE id = $1 AND user_id = $2 AND run_id = $3
             AND status = 'expanding'
             AND content_purged_at IS NULL
             AND expires_at > clock_timestamp()
           FOR UPDATE`,
          [generationId, input.userId, input.runId],
        );
    if (!generation.rows[0]) throw providerClaimStale();
  }

  if (input.stage === 'option') {
    const optionId = input.optionId;
    const generationId = input.generationId;
    if (!optionId || !generationId) throw providerClaimStale();
    const option = await client.query<TkPromptOptionRow>(
      `SELECT * FROM tk_prompt_options
       WHERE id = $1 AND generation_id = $2 AND user_id = $3
         AND status = 'processing'
         AND claim_token = $4 AND attempt_count = $5
         AND content_purged_at IS NULL
       FOR UPDATE`,
      [optionId, generationId, input.userId, input.claimToken, input.jobAttempt],
    );
    if (!option.rows[0]) throw providerClaimStale();
  }

  const run = input.stage === 'analysis'
    ? await client.query<TkPromptRunRow>(
        `SELECT * FROM tk_prompt_runs
         WHERE id = $1 AND user_id = $2
           AND status = 'analyzing'
           AND claim_token = $3 AND attempt_count = $4
           AND content_purged_at IS NULL
           AND expires_at > clock_timestamp()
         FOR UPDATE`,
        [input.runId, input.userId, input.claimToken, input.jobAttempt],
      )
    : await client.query<TkPromptRunRow>(
        `SELECT * FROM tk_prompt_runs
         WHERE id = $1 AND user_id = $2
           AND status = 'ready'
           AND content_purged_at IS NULL
           AND expires_at > clock_timestamp()
         FOR UPDATE`,
        [input.runId, input.userId],
      );
  if (!run.rows[0]) throw providerClaimStale();
}

function providerClaimStale() {
  return repositoryError(
    'Provider 调用对应的任务领取凭证已失效',
    409,
    'TK_PROMPT_PROVIDER_CLAIM_STALE',
  );
}

function assertProviderOwnerShape(input: BeginTkPromptProviderRequestInput) {
  const valid = input.stage === 'analysis'
    ? input.generationId === null && input.optionId === null
    : input.stage === 'strategy'
      ? input.generationId !== null && input.optionId === null
      : input.generationId !== null && input.optionId !== null;
  if (!valid) {
    throw repositoryError('Provider 请求归属与阶段不匹配', 400, 'TK_PROMPT_PROVIDER_OWNER_INVALID');
  }
  const actionValid = input.stage === 'analysis'
    ? input.action === 'analyze-facts' && input.repairRound === 0
    : input.stage === 'strategy'
      ? input.action === 'plan-strategies' && input.repairRound === 0
      : (
          (input.action === 'generate-option' && input.repairRound === 0)
          || (input.action === 'repair-option' && input.repairRound === 1)
        );
  if (!actionValid) {
    throw repositoryError('Provider action 无效', 400, 'TK_PROMPT_PROVIDER_ACTION_INVALID');
  }
  if (!Number.isSafeInteger(input.jobAttempt) || input.jobAttempt < 1
    || !Number.isSafeInteger(input.transportAttempt) || input.transportAttempt < 1) {
    throw repositoryError('Provider 尝试次数无效', 400, 'TK_PROMPT_PROVIDER_ATTEMPT_INVALID');
  }
  if (input.requestKey !== tkPromptProviderRequestKey(input)) {
    throw repositoryError(
      'Provider 请求键与逻辑 attempt 不一致',
      400,
      'TK_PROMPT_PROVIDER_REQUEST_KEY_INVALID',
    );
  }
}

function validateProviderTerminal(input: CompleteTkPromptProviderRequestInput) {
  for (const count of [input.inputTokens, input.cachedInputTokens, input.outputTokens]) {
    if (count !== null && (!Number.isSafeInteger(count) || count < 0)) {
      throw repositoryError('Provider Token 数无效', 400, 'TK_PROMPT_PROVIDER_USAGE_INVALID');
    }
  }
  if (input.cachedInputTokens !== null
    && (input.inputTokens === null || input.cachedInputTokens > input.inputTokens)) {
    throw repositoryError('缓存 Token 不能超过输入 Token', 400, 'TK_PROMPT_PROVIDER_USAGE_INVALID');
  }
  if (input.costStatus === 'known'
    && (input.inputTokens === null || input.cachedInputTokens === null || input.outputTokens === null)) {
    throw repositoryError('已知成本必须包含完整 Token', 400, 'TK_PROMPT_PROVIDER_COST_INVALID');
  }
}

function normalizeFailureReason(value: string) {
  const reason = value.trim();
  if (!reason || reason.length > 1_000) {
    throw repositoryError('失败原因无效', 400, 'TK_PROMPT_FAILURE_REASON_INVALID');
  }
  return reason;
}

function assertGenerationAudioInput(
  creativeInput: TkPromptCreativeInput,
  videoConfig: TkPromptVideoConfig,
) {
  if (videoConfig.durationSeconds === 5 && creativeInput.spokenLanguage !== undefined) {
    throw repositoryError(
      '5 秒纯声音方案不能包含口播语言',
      400,
      'TK_PROMPT_SPOKEN_LANGUAGE_FORBIDDEN',
    );
  }
  if (videoConfig.durationSeconds !== 5 && creativeInput.spokenLanguage === undefined) {
    throw repositoryError(
      '10/15 秒方案必须包含口播语言',
      400,
      'TK_PROMPT_SPOKEN_LANGUAGE_REQUIRED',
    );
  }
  if (videoConfig.durationSeconds === 5 && creativeInput.verifiedOffer.trim() !== '') {
    throw repositoryError(
      '5 秒纯声音方案不能包含优惠信息',
      400,
      'TK_PROMPT_OFFER_FORBIDDEN',
    );
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hashRequest(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => (
    `${JSON.stringify(key)}:${canonicalJson(object[key])}`
  )).join(',')}}`;
}

function isoDate(value: Date | string) {
  return new Date(value).toISOString();
}

function nullableIsoDate(value: Date | string | null) {
  return value === null ? null : isoDate(value);
}

function timestampExpired(value: Date | string) {
  return new Date(value).getTime() <= Date.now();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function requiredRow<T>(row: T | undefined, message: string): T {
  if (!row) throw repositoryError(message, 409, 'TK_PROMPT_WRITE_CONFLICT');
  return row;
}

function repositoryError(message: string, statusCode: number, code: string) {
  return Object.assign(new Error(message), { statusCode, code, exposeMessage: true });
}
