import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  tkPromptCreativeInputSchema,
  tkPromptEvidenceReviewSchema,
  tkPromptVideoConfigSchema,
  type TkPromptCreativeInput,
  type TkPromptGeneration,
  type TkPromptLanguage,
  type TkPromptRun,
  type TkPromptVideoConfig,
} from '@lindyson/api-contracts';
import { z } from 'zod';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import {
  processTkPromptAnalysis,
  processTkPromptOption,
  processTkPromptStrategy,
  readTkPromptGeneration,
  readTkPromptRun,
  resolveTkPromptEngineImages,
  createTkPromptGeneration,
  createTkPromptRun,
} from '../domain/tkPromptEngineService.js';
import { tkPromptEngineRepository } from '../domain/tkPromptEngineRepository.js';
import { ArkTkPromptEngineProvider } from '../providers/tkPromptEngineProvider.js';
import {
  ArkPromptWizardResponsesClient,
  type ArkPromptWizardResponsesRequest,
  type ArkPromptWizardResponsesResult,
} from '../providers/arkPromptWizardResponsesClient.js';
import { tkPromptEngineProviderCanaryOperationalUsageRecord } from './providerOperationalUsageCanaryAdapters.js';
import {
  isTkPromptChineseNarrative,
  isTkPromptTargetLanguageText,
} from '../domain/tkPromptEngine.js';
import {
  hashProviderIdentifier,
  requireProviderOperationalUsageManifestRuntimeConfig,
  writeProviderOperationalUsageCanaryBundle,
  type ProviderOperationalUsageManifestRuntimeConfig,
} from './providerOperationalUsageManifestWriter.js';
import type { JsonValue } from '../domain/providerOperationalUsageManifest.js';

export const TK_PROMPT_CANARY_VERSION = 'tk-prompt-engine-shadow-canary/v1';
export const TK_PROMPT_CANARY_MAX_PHYSICAL_REQUESTS = 38;
export const TK_PROMPT_CANARY_MAX_SUCCESS_REPAIRS = 3;
export const TK_PROMPT_CANARY_MAX_SUCCESS_COST_MICRO_CNY = 1_000_000n;
export const TK_PROMPT_CANARY_MAX_INPUT_TOKENS_PER_REQUEST = 256_000;
export const TK_PROMPT_CANARY_MAX_OUTPUT_TOKENS_PER_REQUEST = 8_000;
export const TK_PROMPT_CANARY_HOST_FLOOR_KB = 458_752;
// 付费 Canary 审计目录，由运维环境通过 TK_PROMPT_CANARY_AUDIT_ROOT 指定。
export const TK_PROMPT_CANARY_AUDIT_ROOT = (process.env.TK_PROMPT_CANARY_AUDIT_ROOT ?? '').trim() || '/var/lib/lindyson/deploy-audits/tk-prompt-engine-v1-canary';
export const TK_PROMPT_CANARY_PROVIDER_ATTEMPT_TIMEOUT_MS = 300_000;
export const TK_PROMPT_CANARY_PROVIDER_REQUEST_BUDGET_MS = 330_000;
export const TK_PROMPT_CANARY_PROVIDER_BATCH_BUDGET_MS = 360_000;

export interface TkPromptCanaryHostHardBaseline {
  pswpin: bigint | null;
  pswpout: bigint | null;
  oomKill: bigint | null;
}

export interface TkPromptCanaryHostResourcePolicy {
  memPsiMode: 'enforce' | 'observe';
  pswpinMode: 'enforce' | 'observe';
  hardBaseline: TkPromptCanaryHostHardBaseline;
}

const TK_PROMPT_CANARY_MODEL = 'doubao-seed-2-0-lite-260428';
const TK_PROMPT_CANARY_RID_PATTERN =
  /^tk-prompt-engine-v1-canary-\d{8}T\d{6}Z(?:-[a-z0-9]{6,16})?$/u;
const TK_PROMPT_CANARY_PRODUCT_KEYS = [
  'apparel',
  'home',
  'beauty',
  'electronics',
  'pet',
] as const;
type TkPromptCanaryProductKey = typeof TK_PROMPT_CANARY_PRODUCT_KEYS[number];

export const TK_PROMPT_CANARY_LANGUAGES = [
  '英语',
  '西班牙语',
  '葡萄牙语',
  '法语',
  '印尼语',
  '意大利语',
  '日语',
  '马来语',
  '泰语',
  '越南语',
  '普通话',
  '德语',
  '荷兰语',
  '波兰语',
] as const satisfies readonly TkPromptLanguage[];

const MARKET_BY_LANGUAGE: Record<TkPromptLanguage, string> = {
  英语: 'United States',
  西班牙语: 'Mexico',
  葡萄牙语: 'Brazil',
  法语: 'France',
  印尼语: 'Indonesia',
  意大利语: 'Italy',
  日语: 'Japan',
  马来语: 'Malaysia',
  泰语: 'Thailand',
  越南语: 'Vietnam',
  普通话: 'Singapore',
  德语: 'Germany',
  荷兰语: 'Netherlands',
  波兰语: 'Poland',
};

type TkPromptCanaryAppearance = 'product_closeup' | 'scene_demo' | 'live_presenter';

export interface TkPromptCanaryCase {
  id: string;
  productKey: TkPromptCanaryProductKey;
  spokenLanguage: TkPromptLanguage | null;
  appearance: TkPromptCanaryAppearance;
  imageCount: 1 | 2 | 3;
  videoConfig: TkPromptVideoConfig;
}

const VIDEO_5S = tkPromptVideoConfigSchema.parse({
  model: 'seedance-2.0-mini',
  aspectRatio: '9:16',
  resolution: '480p',
  durationSeconds: 5,
});
const VIDEO_10S = tkPromptVideoConfigSchema.parse({
  model: 'seedance-2.0-fast',
  aspectRatio: '9:16',
  resolution: '720p',
  durationSeconds: 10,
});
const VIDEO_15S = tkPromptVideoConfigSchema.parse({
  model: 'seedance-2.0',
  aspectRatio: '16:9',
  resolution: '1080p',
  durationSeconds: 15,
});

/**
 * 最短生产矩阵：五款已审核商品各跑一次，并对 beauty 的同一不可变原图在影子库
 * 生成记录副本，增加 2 图和 3 图各一次。14 种语言由无费用单元测试全覆盖；付费
 * Canary 聚焦 1/2/3 图、墨西哥西班牙语和三种画面模式。
 */
export const TK_PROMPT_CANARY_CASES: readonly TkPromptCanaryCase[] = [
  canaryCase('apparel-15s-en-live', 'apparel', '英语', 15, 'live_presenter'),
  canaryCase('beauty-15s-es-scene', 'beauty', '西班牙语', 15, 'scene_demo'),
  canaryCase('home-15s-fr-scene', 'home', '法语', 15, 'scene_demo'),
  canaryCase('electronics-10s-zh-product', 'electronics', '普通话', 10, 'product_closeup'),
  canaryCase('pet-15s-de-scene', 'pet', '德语', 15, 'scene_demo'),
  canaryCase('beauty-10s-es-product-2img', 'beauty', '西班牙语', 10, 'product_closeup', 2),
  canaryCase('beauty-15s-es-live-3img', 'beauty', '西班牙语', 15, 'live_presenter', 3),
] as const;

const rootApprovalSchema = z.object({
  approved: z.literal(true),
  approvalRef: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u),
  approvedAt: z.string().datetime({ offset: true }),
}).strict();

const canaryProductSchema = z.object({
  key: z.enum(TK_PROMPT_CANARY_PRODUCT_KEYS),
  imageAssetIds: z.array(z.string().uuid()).min(1).max(9),
  humanReview: rootApprovalSchema,
}).strict();

export const tkPromptCanaryConfigSchema = z.object({
  schemaVersion: z.literal(1),
  rid: z.string().regex(TK_PROMPT_CANARY_RID_PATTERN),
  shadowDatabaseName: z.string().regex(/^lindyson_tk1_canary_[0-9a-f]{16}$/u),
  candidateImageSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  canaryUserId: z.string().uuid(),
  products: z.array(canaryProductSchema).length(5),
  executionMarkerPath: z.string().min(1),
}).strict().superRefine((config, context) => {
  const keys = config.products.map(product => product.key);
  if (
    new Set(keys).size !== TK_PROMPT_CANARY_PRODUCT_KEYS.length
    || TK_PROMPT_CANARY_PRODUCT_KEYS.some(key => !keys.includes(key))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['products'],
      message: '必须精确提供五个不同的 Canary 商品组',
    });
  }
  const productAssetIds = config.products.flatMap(product => product.imageAssetIds);
  if (new Set(productAssetIds).size !== productAssetIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['products'],
      message: '五组商品素材不得复用同一资产',
    });
  }
});

export type TkPromptCanaryConfig = z.infer<typeof tkPromptCanaryConfigSchema>;

interface TkPromptCanaryConfigFile {
  config: TkPromptCanaryConfig;
  sha256: string;
}

interface TkPromptCanaryPhysicalCounts {
  facts: number;
  strategies: number;
  options: number;
  repairs: number;
}

export interface TkPromptCanaryPhysicalSnapshot {
  globalCount: number;
  counts: TkPromptCanaryPhysicalCounts;
  locallyRejectedCount: number;
  activeCount: number;
  maximumActiveCount: number;
}

type ResponsesDelegate = {
  prepareDns?(): Promise<void>;
  create(
    request: ArkPromptWizardResponsesRequest,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<ArkPromptWizardResponsesResult>;
};

/** 最内层真实出网守卫；所有计数在 delegate 之前同步完成。 */
export class TkPromptCanaryPhysicalRequestGuard implements ResponsesDelegate {
  private readonly delegatedFingerprints = new Set<string>();
  private readonly counts: TkPromptCanaryPhysicalCounts = {
    facts: 0,
    strategies: 0,
    options: 0,
    repairs: 0,
  };
  private globalCount = 0;
  private locallyRejectedCount = 0;
  private activeCount = 0;
  private maximumActiveCount = 0;
  private preparedAttempt: {
    fingerprint: string;
    operation: keyof TkPromptCanaryPhysicalCounts;
  } | null = null;

  constructor(
    private readonly delegate: ResponsesDelegate,
    private readonly externalSignal?: AbortSignal,
    private readonly hostResourcePolicy = strictTkPromptCanaryHostResourcePolicy(),
    private readonly verifyPreRequestBudget?: (
      request: ArkPromptWizardResponsesRequest,
      physical: TkPromptCanaryPhysicalSnapshot,
    ) => Promise<void>,
  ) {}

  async prepareDns(): Promise<void> {
    await this.delegate.prepareDns?.();
  }

  async prepareAttempt(request: ArkPromptWizardResponsesRequest): Promise<void> {
    assertTkPromptCanaryNotInterrupted(this.externalSignal);
    if (this.activeCount !== 0 || this.preparedAttempt !== null) {
      this.locallyRejectedCount += 1;
      throw canaryError('TK_PROMPT_CANARY_PHYSICAL_REQUEST_REJECTED');
    }
    if (process.env.TK_PROMPT_CANARY_LOW_MEMORY_SERIAL_MODE === '1') {
      await assertTkPromptCanaryPhysicalHostGate({ policy: this.hostResourcePolicy });
    }
    assertTkPromptCanaryNotInterrupted(this.externalSignal);
    await this.verifyPreRequestBudget?.(request, this.snapshot());
    assertTkPromptCanaryNotInterrupted(this.externalSignal);
    const operation = classifyPhysicalRequest(request);
    const fingerprint = hashPhysicalRequest(request);
    const limits: TkPromptCanaryPhysicalCounts = {
      facts: 7,
      strategies: 7,
      options: 21,
      repairs: TK_PROMPT_CANARY_MAX_SUCCESS_REPAIRS,
    };
    if (
      request.model !== TK_PROMPT_CANARY_MODEL
      || request.store !== false
      || request.service_tier !== 'default'
      || this.activeCount !== 0
      || this.delegatedFingerprints.has(fingerprint)
      || this.globalCount >= TK_PROMPT_CANARY_MAX_PHYSICAL_REQUESTS
      || this.counts[operation] >= limits[operation]
    ) {
      this.locallyRejectedCount += 1;
      throw canaryError('TK_PROMPT_CANARY_PHYSICAL_REQUEST_REJECTED');
    }
    this.delegatedFingerprints.add(fingerprint);
    this.globalCount += 1;
    this.counts[operation] += 1;
    this.activeCount += 1;
    this.maximumActiveCount = Math.max(this.maximumActiveCount, this.activeCount);
    this.preparedAttempt = { fingerprint, operation };
  }

  async cancelPreparedAttempt(request: ArkPromptWizardResponsesRequest): Promise<void> {
    const fingerprint = hashPhysicalRequest(request);
    const prepared = this.preparedAttempt;
    if (!prepared || prepared.fingerprint !== fingerprint || this.activeCount !== 1) {
      throw canaryError('TK_PROMPT_CANARY_PHYSICAL_REQUEST_STATE_INVALID');
    }
    this.preparedAttempt = null;
    this.activeCount -= 1;
    this.globalCount -= 1;
    this.counts[prepared.operation] -= 1;
    this.delegatedFingerprints.delete(prepared.fingerprint);
  }

  async create(
    request: ArkPromptWizardResponsesRequest,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<ArkPromptWizardResponsesResult> {
    const fingerprint = hashPhysicalRequest(request);
    if (this.preparedAttempt === null) {
      // Direct callers retain the old single-method contract. ArkTkPromptEngineProvider uses
      // prepareAttempt first, which is what guarantees the paid ledger ordering.
      await this.prepareAttempt(request);
    }
    if (this.preparedAttempt?.fingerprint !== fingerprint || this.activeCount !== 1) {
      this.locallyRejectedCount += 1;
      throw canaryError('TK_PROMPT_CANARY_PHYSICAL_REQUEST_REJECTED');
    }
    try {
      return await this.delegate.create(request, {
        ...options,
        signal: options.signal ?? this.externalSignal,
      });
    } finally {
      this.activeCount -= 1;
      this.preparedAttempt = null;
    }
  }

  snapshot(): TkPromptCanaryPhysicalSnapshot {
    return {
      globalCount: this.globalCount,
      counts: { ...this.counts },
      locallyRejectedCount: this.locallyRejectedCount,
      activeCount: this.activeCount,
      maximumActiveCount: this.maximumActiveCount,
    };
  }
}

interface MatrixCaseResult {
  caseId: string;
  cardCount: number;
  modeCounts: Record<TkPromptCanaryAppearance, number>;
}

export async function runTkPromptCanarySchedule<T>(dependencies: {
  prepareProduct(productKey: TkPromptCanaryProductKey, imageCount: 1 | 2 | 3): Promise<T>;
  executeCase(product: T, testCase: TkPromptCanaryCase): Promise<MatrixCaseResult>;
}) {
  const products = new Map<string, T>();
  const results: MatrixCaseResult[] = [];
  for (const testCase of TK_PROMPT_CANARY_CASES) {
    const productVariant = `${testCase.productKey}:${testCase.imageCount}`;
    let product = products.get(productVariant);
    if (!product) {
      product = await dependencies.prepareProduct(testCase.productKey, testCase.imageCount);
      products.set(productVariant, product);
    }
    // 故意不捕获后继续：任何一批失败都会立即停止剩余付费矩阵，且没有整轮重试。
    results.push(await dependencies.executeCase(product, testCase));
  }
  return {
    productCount: new Set(TK_PROMPT_CANARY_CASES.map(item => item.productKey)).size,
    productVariantCount: products.size,
    results,
  };
}

export async function runTkPromptCanaryOptionsSerially(
  optionIds: readonly string[],
  executeOption: (optionId: string) => Promise<unknown>,
) {
  for (const optionId of optionIds) {
    try {
      await executeOption(optionId);
    } catch (error) {
      const underlyingCode = safeCanaryErrorCode(error);
      throw canaryError(underlyingCode !== 'TK_PROMPT_CANARY_FAILED'
        && underlyingCode.startsWith('TK_PROMPT_')
        ? `TK_PROMPT_CANARY_OPTION_FAILED:${underlyingCode}`
        : 'TK_PROMPT_CANARY_OPTION_FAILED');
    }
  }
}

interface CanaryExecutionState {
  runIds: string[];
  runProductKeys: Map<string, string>;
  generationCaseIds: Map<string, string>;
  optionCases: Map<string, { caseId: string; slot: string }>;
  completedCases: MatrixCaseResult[];
}

interface TkPromptCanaryLedgerRow {
  run_id: string;
  generation_id: string | null;
  option_id: string | null;
  stage: 'analysis' | 'strategy' | 'option';
  action: 'analyze-facts' | 'plan-strategies' | 'generate-option' | 'repair-option';
  repair_round: number;
  transport_attempt: number;
  provider: string;
  model: string;
  service_tier: string;
  request_status: 'started' | 'succeeded' | 'failed';
  provider_request_id: string | null;
  provider_response_id: string | null;
  x_tt_log_id: string | null;
  http_status: number | null;
  error_code: string | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  cost_status: 'pending' | 'known' | 'unknown';
  cost_cny: string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
}

interface SafeLedgerObservation {
  sourceItemKey: string;
  stage: TkPromptCanaryLedgerRow['stage'];
  action: TkPromptCanaryLedgerRow['action'];
  repairRound: 0 | 1;
  transportAttempt: number;
  model: string;
  serviceTier: string;
  status: 'success' | 'failed' | 'unknown';
  providerRequestId: string | null;
  providerResponseId: string | null;
  xTtLogId: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  ledgerCostCny: string | null;
  costStatus: TkPromptCanaryLedgerRow['cost_status'];
  occurredAt: string;
  errorCode: string | null;
}

interface CanarySafeEvidenceInput {
  rid: string;
  configSha256: string;
  candidateImageSha256: string;
  physical: TkPromptCanaryPhysicalSnapshot;
  completedCases: MatrixCaseResult[];
  ledger: SafeLedgerObservation[];
  releaseAllowed: boolean;
  failureCode: string | null;
}

export function buildTkPromptCanarySafeEvidence(input: CanarySafeEvidenceInput): JsonValue {
  const modeCounts = emptyModeCounts();
  const providerOutcomes = { succeeded: 0, failed: 0, unknown: 0 };
  let knownCostMicroCny = 0n;
  let unknownTokenCount = 0;
  for (const result of input.completedCases) {
    for (const mode of Object.keys(modeCounts) as TkPromptCanaryAppearance[]) {
      modeCounts[mode] += result.modeCounts[mode];
    }
  }
  for (const observation of input.ledger) {
    if (observation.status === 'success') providerOutcomes.succeeded += 1;
    else if (observation.status === 'failed') providerOutcomes.failed += 1;
    else providerOutcomes.unknown += 1;
    if (observation.ledgerCostCny !== null) {
      knownCostMicroCny += parseCnyMicros(observation.ledgerCostCny);
    }
    if (observation.inputTokens === null || observation.outputTokens === null) {
      unknownTokenCount += 1;
    }
  }
  const evidence = {
    evidenceKind: TK_PROMPT_CANARY_VERSION,
    rid: input.rid,
    configSha256: input.configSha256,
    candidateImageSha256: input.candidateImageSha256,
    matrix: {
      expectedProductCount: 5,
      expectedGenerationCount: 7,
      expectedCardCount: 21,
      coveredLanguageCount: new Set(TK_PROMPT_CANARY_CASES.map(
        item => item.spokenLanguage,
      ).filter(Boolean)).size,
      coveredImageCounts: [...new Set(TK_PROMPT_CANARY_CASES.map(
        item => item.imageCount,
      ))].sort(),
      fiveSecondBatchCount: TK_PROMPT_CANARY_CASES.filter(
        item => item.videoConfig.durationSeconds === 5,
      ).length,
      completedGenerationCount: input.completedCases.length,
      completedCardCount: input.completedCases.reduce((sum, item) => sum + item.cardCount, 0),
      completedCaseIds: input.completedCases.map(item => item.caseId),
      modeCounts,
      maximumLiveCardsInOneGeneration: Math.max(
        0,
        ...input.completedCases.map(item => item.modeCounts.live_presenter),
      ),
    },
    physicalRequests: {
      globalCount: input.physical.globalCount,
      counts: {
        facts: input.physical.counts.facts,
        strategies: input.physical.counts.strategies,
        options: input.physical.counts.options,
        repairs: input.physical.counts.repairs,
      },
      locallyRejectedCount: input.physical.locallyRejectedCount,
      activeCount: input.physical.activeCount,
      maximumActiveCount: input.physical.maximumActiveCount,
    },
    callContract: {
      expectedBaseLogicalCalls: 35,
      maximumSuccessLogicalCalls: 38,
      absoluteMaximumPhysicalCalls: TK_PROMPT_CANARY_MAX_PHYSICAL_REQUESTS,
      logicalCalls: input.physical.globalCount,
      physicalCalls: input.physical.globalCount,
      terminalCalls: providerOutcomes.succeeded + providerOutcomes.failed,
      providerOutcomes,
      unknownTokenCount,
      knownCostCny: formatCnyMicros(knownCostMicroCny),
      costCapScope: 'post-response-cumulative-release-gate',
      localPreRequestWorstCaseReservation: true,
      providerSidePrepaidCap: false,
    },
    ledger: input.ledger.map(item => ({
      sourceItemKey: item.sourceItemKey,
      stage: item.stage,
      action: item.action,
      repairRound: item.repairRound,
      transportAttempt: item.transportAttempt,
      model: item.model,
      serviceTier: item.serviceTier,
      status: item.status,
      inputTokens: item.inputTokens,
      cachedInputTokens: item.cachedInputTokens,
      outputTokens: item.outputTokens,
      costStatus: item.costStatus,
      costCny: item.ledgerCostCny,
      occurredAt: item.occurredAt,
      errorCode: item.errorCode,
      providerOperationIdSha256: hashProviderIdentifier(
        item.providerResponseId ?? item.xTtLogId,
      ),
      providerRequestIdSha256: hashProviderIdentifier(item.providerRequestId),
    })),
    release: {
      allowed: input.releaseAllowed,
      failureCode: input.failureCode,
      maximumRepairs: TK_PROMPT_CANARY_MAX_SUCCESS_REPAIRS,
      maximumKnownCostCny: '1.000000',
    },
  } satisfies JsonValue;
  assertTkPromptCanarySafeEvidence(evidence);
  return evidence;
}

export function expectedTkPromptCanaryShadowDatabaseName(rid: string) {
  return `lindyson_tk1_canary_${createHash('sha256').update(rid).digest('hex').slice(0, 16)}`;
}

export function assertTkPromptCanaryRuntimeIsolation(input: {
  config: TkPromptCanaryConfig;
  databaseUrl: string;
  operationalDatabaseUrl: string;
  candidateImageSha256: string;
  manifest: ProviderOperationalUsageManifestRuntimeConfig;
  maxRetries: number;
}) {
  const expectedShadowName = expectedTkPromptCanaryShadowDatabaseName(input.config.rid);
  const shadowName = databaseName(input.databaseUrl);
  const operationalName = databaseName(input.operationalDatabaseUrl);
  const expectedAuditDirectory = path.join(TK_PROMPT_CANARY_AUDIT_ROOT, input.config.rid);
  const expectedMarker = path.join(expectedAuditDirectory, '.execution-started');
  if (
    input.config.shadowDatabaseName !== expectedShadowName
    || shadowName !== expectedShadowName
    || operationalName === expectedShadowName
    || createHash('sha256').update(input.databaseUrl).digest('hex')
      === createHash('sha256').update(input.operationalDatabaseUrl).digest('hex')
    || input.candidateImageSha256 !== input.config.candidateImageSha256
    || input.maxRetries !== 0
    || input.manifest.sourceRunId !== input.config.rid
    || input.manifest.costOwnerUserId !== input.config.canaryUserId
    || path.resolve(input.config.executionMarkerPath) !== expectedMarker
    || path.dirname(path.resolve(input.manifest.outputPath)) !== expectedAuditDirectory
  ) {
    throw canaryError('TK_PROMPT_CANARY_RUNTIME_ISOLATION_INVALID');
  }
}

/**
 * 仅在已核验的隔离影子库中复制同一不可变对象的资产记录。生产库的唯一索引和
 * 数据均不触碰；影子库允许相同 object_key，是为了验证 2/3 图有序输入协议。
 */
export async function createTkPromptCanaryShadowImageMatrix(
  config: TkPromptCanaryConfig,
) {
  const expectedDatabase = expectedTkPromptCanaryShadowDatabaseName(config.rid);
  const beauty = config.products.find(product => product.key === 'beauty');
  if (!beauty || config.products.some(product => product.imageAssetIds.length !== 1)) {
    throw canaryError('TK_PROMPT_CANARY_SHADOW_IMAGE_SOURCE_INVALID');
  }
  const client = await pool.connect();
  const cloneIds: string[] = [];
  try {
    await client.query('BEGIN');
    const identity = await client.query<{ database_name: string; index_count: string }>(
      `SELECT current_database() AS database_name,
              (SELECT count(*) FROM pg_indexes
               WHERE schemaname = 'public'
                 AND tablename = 'assets'
                 AND indexname = 'idx_assets_user_object_key')::text AS index_count`,
    );
    if (
      identity.rows[0]?.database_name !== expectedDatabase
      || identity.rows[0]?.index_count !== '1'
    ) {
      throw canaryError('TK_PROMPT_CANARY_SHADOW_IMAGE_ISOLATION_INVALID');
    }
    await client.query('DROP INDEX public.idx_assets_user_object_key');
    for (const ordinal of [2, 3]) {
      const cloned = await client.query<{ id: string; object_key: string }>(
        `INSERT INTO assets
         SELECT clone.*
         FROM assets source
         CROSS JOIN LATERAL jsonb_populate_record(
           NULL::assets,
           to_jsonb(source.*) || jsonb_build_object(
             'id', gen_random_uuid(),
             'name', source.name || $3::text,
             'created_at', clock_timestamp(),
             'updated_at', clock_timestamp()
           )
         ) AS clone
         WHERE source.id = $1
           AND source.user_id = $2
           AND source.type = 'image'
           AND source.deletion_status = 'active'
         RETURNING id::text, object_key`,
        [beauty.imageAssetIds[0], config.canaryUserId, `（Canary影子副本${ordinal}）`],
      );
      const row = cloned.rows[0];
      if (!row || cloned.rows.length !== 1 || !/^[0-9a-f-]{36}$/u.test(row.id)) {
        throw canaryError('TK_PROMPT_CANARY_SHADOW_IMAGE_COPY_INVALID');
      }
      cloneIds.push(row.id);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  if (new Set(cloneIds).size !== 2) {
    throw canaryError('TK_PROMPT_CANARY_SHADOW_IMAGE_COPY_INVALID');
  }
  return new Map<TkPromptCanaryProductKey, string[]>(config.products.map(product => [
    product.key,
    product.key === 'beauty'
      ? [product.imageAssetIds[0]!, ...cloneIds]
      : [...product.imageAssetIds],
  ]));
}

export async function executePaidCanary(input: {
  configFile: TkPromptCanaryConfigFile;
  manifest: ProviderOperationalUsageManifestRuntimeConfig;
  signal?: AbortSignal;
}) {
  const { config } = input.configFile;
  const state: CanaryExecutionState = {
    runIds: [],
    runProductKeys: new Map(),
    generationCaseIds: new Map(),
    optionCases: new Map(),
    completedCases: [],
  };
  let guard: TkPromptCanaryPhysicalRequestGuard | null = null;
  let failureCode: string | null = null;
  let releaseAllowed = false;
  let evidenceWritten = false;

  try {
    assertTkPromptCanaryNotInterrupted(input.signal);
    const hostResourcePolicy = resolveTkPromptCanaryHostResourcePolicy(config.rid);
    await assertPreProviderCanaryState(config, input.manifest);
    assertTkPromptCanaryNotInterrupted(input.signal);
    await claimTkPromptCanaryRid(config, input.manifest.outputPath);
    assertTkPromptCanaryNotInterrupted(input.signal);
    const productImages = await createTkPromptCanaryShadowImageMatrix(config);
    for (const testCase of TK_PROMPT_CANARY_CASES) {
      const imageAssetIds = productImages.get(testCase.productKey)?.slice(0, testCase.imageCount);
      if (!imageAssetIds || imageAssetIds.length !== testCase.imageCount) {
        throw canaryError('TK_PROMPT_CANARY_SHADOW_IMAGE_MATRIX_INVALID');
      }
      await resolveTkPromptEngineImages(config.canaryUserId, imageAssetIds);
    }
    assertTkPromptCanaryNotInterrupted(input.signal);
    const apiKey = env.ARK_PROMPT_WIZARD_API_KEY ?? env.ARK_API_KEY;
    if (!apiKey) throw canaryError('TK_PROMPT_CANARY_PROVIDER_KEY_MISSING');
    guard = new TkPromptCanaryPhysicalRequestGuard(new ArkPromptWizardResponsesClient({
      apiKey,
      baseUrl: env.ARK_BASE_URL,
    }), input.signal, hostResourcePolicy, async (request, physical) => {
      const ledger = await readCanaryLedger(state.runIds);
      assertCanaryLedgerBudgetBeforeNextPhysicalRequest(ledger, physical, request);
    });
    const provider = new ArkTkPromptEngineProvider(guard);
    const productConfig = new Map(config.products.map(product => [product.key, product]));

    const matrix = await runTkPromptCanarySchedule<{ run: TkPromptRun }>({
      prepareProduct: async (productKey, imageCount) => {
        const product = productConfig.get(productKey);
        if (!product) throw canaryError('TK_PROMPT_CANARY_PRODUCT_CONFIG_MISSING');
        const imageAssetIds = productImages.get(productKey)?.slice(0, imageCount);
        if (!imageAssetIds || imageAssetIds.length !== imageCount) {
          throw canaryError('TK_PROMPT_CANARY_SHADOW_IMAGE_MATRIX_INVALID');
        }
        const idempotencyKey = canaryIdempotencyKey(
          config.rid,
          `run:${productKey}:${imageCount}img`,
        );
        const run = await createTkPromptRun({
          userId: config.canaryUserId,
          idempotencyKey,
          imageAssetIds,
        });
        const replay = await createTkPromptRun({
          userId: config.canaryUserId,
          idempotencyKey,
          imageAssetIds,
        });
        if (replay.id !== run.id) throw canaryError('TK_PROMPT_CANARY_RUN_IDEMPOTENCY_FAILED');
        state.runIds.push(run.id);
        state.runProductKeys.set(run.id, `${productKey}:${imageCount}img`);
        try {
          await processTkPromptAnalysis(run.id, 1, { provider });
        } catch (error) {
          if (safeCanaryErrorCode(error) !== 'TK_PROMPT_CANARY_FAILED') throw error;
          throw canaryError('TK_PROMPT_CANARY_ANALYSIS_FAILED');
        }
        const completed = await readTkPromptRun(config.canaryUserId, run.id);
        if (completed.status !== 'ready' || !completed.evidenceProfile) {
          throw canaryError('TK_PROMPT_CANARY_ANALYSIS_INCOMPLETE');
        }
        return { run: completed };
      },
      executeCase: async (prepared, testCase) => {
        const evidenceProfile = prepared.run.evidenceProfile;
        if (!evidenceProfile) throw canaryError('TK_PROMPT_CANARY_EVIDENCE_MISSING');
        const evidenceReview = tkPromptEvidenceReviewSchema.parse({
          productName: evidenceProfile.productIdentity.name,
          category: evidenceProfile.productIdentity.category,
          rejectedVisibleFactIds: [],
          userConfirmedFacts: [],
          forbiddenClaims: [],
        });
        const creativeInput = canaryCreativeInput(testCase);
        const idempotencyKey = canaryIdempotencyKey(config.rid, `generation:${testCase.id}`);
        const settings = await tkPromptEngineRepository.getSettings();
        const generation = await createTkPromptGeneration({
          userId: config.canaryUserId,
          runId: prepared.run.id,
          idempotencyKey,
          expectedGenerationCredits: settings.generationCredits,
          evidenceReview,
          creativeInput,
          videoConfig: testCase.videoConfig,
        });
        const replay = await createTkPromptGeneration({
          userId: config.canaryUserId,
          runId: prepared.run.id,
          idempotencyKey,
          expectedGenerationCredits: settings.generationCredits,
          evidenceReview,
          creativeInput,
          videoConfig: testCase.videoConfig,
        });
        if (replay.id !== generation.id) {
          throw canaryError('TK_PROMPT_CANARY_GENERATION_IDEMPOTENCY_FAILED');
        }
        state.generationCaseIds.set(generation.id, testCase.id);
        const optionIds = await processTkPromptStrategy(generation.id, 1, { provider });
        if (optionIds.length !== 3) throw canaryError('TK_PROMPT_CANARY_OPTION_COUNT_INVALID');
        const work = await tkPromptEngineRepository.getGenerationWork(
          config.canaryUserId,
          generation.id,
        );
        for (const option of work.options) {
          state.optionCases.set(option.id, { caseId: testCase.id, slot: option.slot });
        }
        // 低内存付费 Canary 固定单物理请求：三个 option 必须逐个完成，任一失败
        // 立即停止，不能让 Promise.all 在同一进程内制造 Provider 并发。
        await runTkPromptCanaryOptionsSerially(
          optionIds,
          optionId => processTkPromptOption(optionId, 1, { provider }),
        );
        const completed = await readTkPromptGeneration(config.canaryUserId, generation.id);
        const result = summarizeCompletedGeneration(completed, testCase, evidenceProfile);
        const ledger = await readCanaryLedger(state.runIds);
        assertCanaryLedgerBudget(ledger, guard!.snapshot());
        state.completedCases.push({ caseId: testCase.id, ...result });
        return { caseId: testCase.id, ...result };
      },
    });
    if (
      matrix.productCount !== 5
      || matrix.productVariantCount !== 7
      || matrix.results.length !== 7
    ) {
      throw canaryError('TK_PROMPT_CANARY_MATRIX_INCOMPLETE');
    }
    assertTkPromptCanaryNotInterrupted(input.signal);
    assertCanaryModeCoverage(matrix.results);
    const ledger = await readCanaryLedger(state.runIds);
    assertCanaryLedgerBudget(ledger, guard.snapshot());
    assertCanarySuccessfulCallContract(guard.snapshot());
    releaseAllowed = true;
  } catch (error) {
    failureCode = safeCanaryErrorCode(error);
  } finally {
    if (input.signal?.aborted) {
      releaseAllowed = false;
      failureCode ??= 'TK_PROMPT_CANARY_SIGNAL_INTERRUPTED';
    }
    const rows = state.runIds.length > 0 ? await readCanaryLedger(state.runIds).catch(() => []) : [];
    const observations = materializeSafeLedger(rows, state);
    const physical = guard?.snapshot() ?? emptyPhysicalSnapshot();
    if (observations.length > 0) {
      try {
        if (observations.length !== physical.globalCount) {
          releaseAllowed = false;
          failureCode ??= 'TK_PROMPT_CANARY_LEDGER_PHYSICAL_MISMATCH';
        }
        await persistCanaryEvidence({
          configFile: input.configFile,
          manifest: input.manifest,
          state,
          observations,
          physical,
          releaseAllowed,
          failureCode,
        });
        evidenceWritten = true;
      } catch (error) {
        releaseAllowed = false;
        failureCode = safeCanaryErrorCode(error);
      }
    }
    emitSafeEvent({
      event: physical.globalCount === 0
        ? 'tk-prompt-engine-shadow-canary-preprovider'
        : 'tk-prompt-engine-shadow-canary',
      ok: releaseAllowed,
      failureCode,
      completedGenerations: state.completedCases.length,
      completedCards: state.completedCases.reduce((sum, item) => sum + item.cardCount, 0),
      physicalRequests: physical.globalCount,
      repairs: physical.counts.repairs,
      evidenceWritten,
    });
  }
  return releaseAllowed;
}

export async function assertPreProviderCanaryState(
  config: TkPromptCanaryConfig,
  manifest: ProviderOperationalUsageManifestRuntimeConfig,
) {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
  const operationalDatabaseUrl = process.env.PROVIDER_OPERATIONAL_USAGE_DATABASE_URL?.trim() ?? '';
  const candidateImageSha256 = process.env.TK_PROMPT_CANARY_CANDIDATE_IMAGE_SHA256?.trim() ?? '';
  assertTkPromptCanaryRuntimeIsolation({
    config,
    databaseUrl,
    operationalDatabaseUrl,
    candidateImageSha256,
    manifest,
    maxRetries: env.PROMPT_WIZARD_MAX_RETRIES,
  });
  if (env.ARK_PROMPT_WIZARD_MODEL !== TK_PROMPT_CANARY_MODEL) {
    throw canaryError('TK_PROMPT_CANARY_MODEL_INVALID');
  }
  if (
    process.env.TK_PROMPT_CANARY_LOW_MEMORY_SERIAL_MODE !== '1'
    || env.PROMPT_WIZARD_PROVIDER_CONCURRENCY !== 1
  ) {
    throw canaryError('TK_PROMPT_CANARY_SERIAL_RUNTIME_REQUIRED');
  }
  const settings = await tkPromptEngineRepository.getSettings();
  if (!settings.available || settings.generationCredits <= 0) {
    throw canaryError('TK_PROMPT_CANARY_SHADOW_SETTINGS_INVALID');
  }
  const canaryRunIdempotencyKeys = [...new Set(TK_PROMPT_CANARY_CASES.map(testCase => (
    canaryIdempotencyKey(
      config.rid,
      `run:${testCase.productKey}:${testCase.imageCount}img`,
    )
  )))];
  const canaryGenerationIdempotencyKeys = TK_PROMPT_CANARY_CASES.map(testCase => (
    canaryIdempotencyKey(config.rid, `generation:${testCase.id}`)
  ));
  const capacity = await pool.query<{
    database_name: string;
    available_credits: string;
    existing_canary_runs: string;
    existing_canary_generations: string;
    existing_canary_options: string;
    existing_canary_provider_requests: string;
    canary_identity_valid: boolean;
  }>(
    `SELECT current_database() AS database_name,
            COALESCE((
              SELECT sum(available_amount)
              FROM credit_lots
              WHERE user_id = $1 AND available_amount > 0
                AND (expires_at IS NULL OR expires_at > clock_timestamp())
            ), 0)::text AS available_credits,
            (SELECT count(*) FROM tk_prompt_runs
             WHERE user_id = $1 AND idempotency_key = ANY($2::text[]))::text
              AS existing_canary_runs,
            (SELECT count(*) FROM tk_prompt_generations
             WHERE user_id = $1 AND idempotency_key = ANY($3::text[]))::text
              AS existing_canary_generations,
            (SELECT count(*) FROM tk_prompt_options option
             JOIN tk_prompt_generations generation ON generation.id = option.generation_id
             WHERE option.user_id = $1
               AND generation.idempotency_key = ANY($3::text[]))::text
              AS existing_canary_options,
            (SELECT count(*) FROM tk_prompt_provider_requests request
             JOIN tk_prompt_runs run ON run.id = request.run_id
             WHERE request.user_id = $1
               AND run.idempotency_key = ANY($2::text[]))::text
              AS existing_canary_provider_requests,
            EXISTS (
              SELECT 1 FROM users
              WHERE id = $1 AND role = 'admin' AND status = 'active'
            ) AS canary_identity_valid`,
    [config.canaryUserId, canaryRunIdempotencyKeys, canaryGenerationIdempotencyKeys],
  );
  const snapshot = capacity.rows[0];
  const requiredCredits = BigInt(settings.generationCredits)
    * BigInt(Math.max(0, TK_PROMPT_CANARY_CASES.length - canaryRunIdempotencyKeys.length));
  if (
    !snapshot
    || snapshot.database_name !== config.shadowDatabaseName
    || parseUnsignedBigInt(snapshot.available_credits) < requiredCredits
    || parseUnsignedBigInt(snapshot.existing_canary_runs) !== 0n
    || parseUnsignedBigInt(snapshot.existing_canary_generations) !== 0n
    || parseUnsignedBigInt(snapshot.existing_canary_options) !== 0n
    || parseUnsignedBigInt(snapshot.existing_canary_provider_requests) !== 0n
    || snapshot.canary_identity_valid !== true
  ) {
    throw canaryError('TK_PROMPT_CANARY_SHADOW_CAPACITY_INVALID');
  }
  // 五组商品必须在第一笔 Provider 调用之前逐组通过正式生产解析边界。这里故意
  // 串行，既限制图片下载/解析峰值，也让首个失败立即停止且物理调用仍为零。
  for (const product of config.products) {
    if (!product.humanReview.approved) {
      throw canaryError('TK_PROMPT_CANARY_PRODUCT_REVIEW_REQUIRED');
    }
    await resolveTkPromptEngineImages(config.canaryUserId, product.imageAssetIds);
  }
  await assertAuditOutputAbsent(manifest.outputPath);
}

function strictTkPromptCanaryHostResourcePolicy(): TkPromptCanaryHostResourcePolicy {
  return {
    memPsiMode: 'enforce',
    pswpinMode: 'enforce',
    hardBaseline: { pswpin: null, pswpout: null, oomKill: null },
  };
}

export function expectedTkPromptCanaryHostResourceAuthorizationSha256(rid: string) {
  if (!TK_PROMPT_CANARY_RID_PATTERN.test(rid)) {
    throw canaryError('TK_PROMPT_CANARY_HOST_RESOURCE_AUTHORIZATION_INVALID');
  }
  return createHash('sha256').update([
    'tk-prompt-canary-resource-policy/v3',
    `rid=${rid}`,
    'memPsi=observe',
    'hostPswpin=observe',
    'hostPswpout=zero-delta',
    'oom=zero-delta',
    'containerSwap=zero',
    'maximumKnownCostCny=1.000000',
    'transportRetry=0',
  ].join('\n')).digest('hex');
}

function parseAuthorizedHostCounter(value: string | undefined) {
  if (!value || !/^\d+$/u.test(value)) {
    throw canaryError('TK_PROMPT_CANARY_HOST_RESOURCE_AUTHORIZATION_INVALID');
  }
  return BigInt(value);
}

/**
 * 默认不接受任何资源降级。只有候选代码中冻结的 RID、授权摘要、策略 token 和
 * runner 在零 Provider soak 前取得的计数基线同时匹配，才把 Mem/PSI 与宿主
 * pswpin 降为观测；宿主 pswpout/OOM 始终使用固定基线，容器 swap 另由 cgroup
 * 硬证据约束，所有基线都不能在物理请求之间重新取样。
 */
export function resolveTkPromptCanaryHostResourcePolicy(
  rid: string,
  environment: NodeJS.ProcessEnv = process.env,
): TkPromptCanaryHostResourcePolicy {
  const policy = environment.TK_PROMPT_CANARY_HOST_RESOURCE_POLICY?.trim();
  const authorization = environment.TK_PROMPT_CANARY_HOST_RESOURCE_AUTHORIZATION_SHA256?.trim();
  const pswpin = environment.TK_PROMPT_CANARY_HOST_PSWPIN_BASELINE?.trim();
  const pswpout = environment.TK_PROMPT_CANARY_HOST_PSWPOUT_BASELINE?.trim();
  const oomKill = environment.TK_PROMPT_CANARY_HOST_OOM_KILL_BASELINE?.trim();
  const values = [policy, authorization, pswpin, pswpout, oomKill];
  if (values.every(value => !value)) return strictTkPromptCanaryHostResourcePolicy();
  if (values.some(value => !value)
    || !TK_PROMPT_CANARY_RID_PATTERN.test(rid)
    || policy !== `observe-mem-psi:${rid}`
    || authorization !== expectedTkPromptCanaryHostResourceAuthorizationSha256(rid)) {
    throw canaryError('TK_PROMPT_CANARY_HOST_RESOURCE_AUTHORIZATION_INVALID');
  }
  return {
    memPsiMode: 'observe',
    pswpinMode: 'observe',
    hardBaseline: {
      pswpin: parseAuthorizedHostCounter(pswpin),
      pswpout: parseAuthorizedHostCounter(pswpout),
      oomKill: parseAuthorizedHostCounter(oomKill),
    },
  };
}

/**
 * 只为当前冻结 RID 延长单次 Provider 等待窗口。生产 env 的 120 秒默认值和
 * 硬上限均不修改；重试次数仍由 runner 固定为 0，超时后绝不重发。
 */
export function resolveTkPromptCanaryProviderTimeoutPolicy(
  rid: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const policy = environment.TK_PROMPT_CANARY_PROVIDER_TIMEOUT_POLICY?.trim();
  if (
    !TK_PROMPT_CANARY_RID_PATTERN.test(rid)
    || policy !== `single-attempt-300s:${rid}`
  ) {
    throw canaryError('TK_PROMPT_CANARY_PROVIDER_TIMEOUT_AUTHORIZATION_INVALID');
  }
  return {
    PROMPT_WIZARD_TIMEOUT_MS: TK_PROMPT_CANARY_PROVIDER_ATTEMPT_TIMEOUT_MS,
    PROMPT_WIZARD_REQUEST_BUDGET_MS: TK_PROMPT_CANARY_PROVIDER_REQUEST_BUDGET_MS,
    PROMPT_WIZARD_BATCH_BUDGET_MS: TK_PROMPT_CANARY_PROVIDER_BATCH_BUDGET_MS,
  };
}

export async function assertTkPromptCanaryPhysicalHostGate(input: {
  readText?: (path: string) => Promise<string>;
  wait?: () => Promise<void>;
  samples?: number;
  policy?: TkPromptCanaryHostResourcePolicy;
} = {}) {
  const readText = input.readText ?? (async file => readFile(file, 'utf8'));
  const wait = input.wait ?? (() => new Promise<void>(resolve => setTimeout(resolve, 1_000)));
  const samples = input.samples ?? 5;
  const policy = input.policy ?? strictTkPromptCanaryHostResourcePolicy();
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 60
    || !policy
    || !['enforce', 'observe'].includes(policy.memPsiMode)
    || !['enforce', 'observe'].includes(policy.pswpinMode)) {
    throw canaryError('TK_PROMPT_CANARY_HOST_GATE_CONFIG_INVALID');
  }

  type HostSnapshot = {
    memAvailableKb: number;
    psiSome: number;
    psiFull: number;
    pswpin: bigint;
    pswpout: bigint;
    oomKill: bigint;
    psiSomeTotal: bigint;
    psiFullTotal: bigint;
  };
  const readSnapshot = async (): Promise<HostSnapshot> => {
    const meminfo = await readText('/proc/meminfo');
    const pressure = await readText('/proc/pressure/memory');
    const vmstat = await readText('/proc/vmstat');
    return {
      memAvailableKb: parseProcInteger(meminfo, 'MemAvailable:'),
      psiSome: parsePressureAvg10(pressure, 'some'),
      psiFull: parsePressureAvg10(pressure, 'full'),
      pswpin: parseProcBigInt(vmstat, 'pswpin'),
      pswpout: parseProcBigInt(vmstat, 'pswpout'),
      oomKill: parseProcBigInt(vmstat, 'oom_kill'),
      psiSomeTotal: parsePressureTotal(pressure, 'some'),
      psiFullTotal: parsePressureTotal(pressure, 'full'),
    };
  };
  const hard = policy.hardBaseline;
  const populated = [hard.pswpin, hard.pswpout, hard.oomKill]
    .filter(value => value !== null).length;
  if (populated !== 0 && populated !== 3) {
    throw canaryError('TK_PROMPT_CANARY_HOST_GATE_CONFIG_INVALID');
  }
  const baseline = await readSnapshot();
  if (populated === 0) {
    hard.pswpin = baseline.pswpin;
    hard.pswpout = baseline.pswpout;
    hard.oomKill = baseline.oomKill;
  }
  const pressureIsSafe = (snapshot: HostSnapshot) => policy.memPsiMode === 'observe' || (
    snapshot.memAvailableKb >= TK_PROMPT_CANARY_HOST_FLOOR_KB
    && snapshot.psiSome <= 0.10
    && snapshot.psiFull === 0
  );
  // pswpin 只是访问历史换出页时的回读计数；在一次性授权模式中只观测它。
  // pswpout 表示新增换出，oom_kill 表示宿主失败，二者始终保持硬零增量。
  const hardCountersMatch = (snapshot: HostSnapshot) => (
    (policy.pswpinMode === 'observe' || snapshot.pswpin === hard.pswpin)
    && snapshot.pswpout === hard.pswpout
    && snapshot.oomKill === hard.oomKill
  );
  if (!pressureIsSafe(baseline) || !hardCountersMatch(baseline)) {
    throw canaryError('TK_PROMPT_CANARY_HOST_PRESSURE_REJECTED');
  }
  for (let sample = 1; sample <= samples; sample += 1) {
    await wait();
    const current = await readSnapshot();
    const strictPsiTotalsMatch = policy.memPsiMode === 'observe' || (
      current.psiSomeTotal === baseline.psiSomeTotal
      && current.psiFullTotal === baseline.psiFullTotal
    );
    if (!pressureIsSafe(current) || !hardCountersMatch(current) || !strictPsiTotalsMatch) {
      throw canaryError('TK_PROMPT_CANARY_HOST_PRESSURE_REJECTED');
    }
  }
}

function canaryCreativeInput(
  testCase: TkPromptCanaryCase,
): TkPromptCreativeInput {
  const appearance = { mode: testCase.appearance };
  return tkPromptCreativeInputSchema.parse({
    targetMarket: MARKET_BY_LANGUAGE[(testCase.spokenLanguage ?? '英语')],
    targetAudience: 'TikTok Shop 短视频购物用户',
    ...(testCase.spokenLanguage ? { spokenLanguage: testCase.spokenLanguage } : {}),
    verifiedOffer: '',
    appearance,
    availableScenes: testCase.appearance === 'scene_demo'
      ? ['已人工审核的连续真实室内商品演示场景']
      : [],
    availableAssets: ['已人工审核的商品图片与操作手部'],
  });
}

function summarizeCompletedGeneration(
  generation: TkPromptGeneration,
  testCase: TkPromptCanaryCase,
  evidenceProfile: NonNullable<TkPromptRun['evidenceProfile']>,
) {
  if (generation.status !== 'completed' || generation.options.length !== 3) {
    throw canaryError('TK_PROMPT_CANARY_GENERATION_INCOMPLETE');
  }
  const modeCounts = emptyModeCounts();
  let cardCount = 0;
  for (const option of generation.options) {
    if (option.status !== 'completed' || !option.plan || !option.strategyBlueprint) {
      throw canaryError('TK_PROMPT_CANARY_CARD_INCOMPLETE');
    }
    cardCount += 1;
    const mode = option.strategyBlueprint.videoMode;
    modeCounts[mode] += 1;
    assertTkPromptCanaryLanguageContract(
      option.plan,
      option.strategyBlueprint,
      testCase,
      evidenceProfile,
    );
  }
  return { cardCount, modeCounts };
}

export function assertTkPromptCanaryLanguageContract(
  plan: NonNullable<TkPromptGeneration['options'][number]['plan']>,
  strategy: NonNullable<TkPromptGeneration['options'][number]['strategyBlueprint']>,
  testCase: TkPromptCanaryCase,
  evidenceProfile: NonNullable<TkPromptRun['evidenceProfile']>,
) {
  const allowedLatinTexts = [
    evidenceProfile.productIdentity.name,
    evidenceProfile.productIdentity.category,
    MARKET_BY_LANGUAGE[(testCase.spokenLanguage ?? '英语')],
    ...evidenceProfile.visibleFacts.map(fact => fact.text),
    ...evidenceProfile.demonstrableActions.map(action => action.text),
  ];
  const nonVoiceoverExecutionPrompt = plan.executionPrompt
    .split('\n')
    .filter(line => !line.startsWith('旁白（'))
    .join('\n');
  const chineseNarratives = [
    strategy.labelZh,
    strategy.firstFrame,
    strategy.openingAction,
    strategy.relevanceBeat,
    strategy.productBridge,
    strategy.buyingMotivation,
    strategy.proofMethod,
    strategy.ctaStrategy,
    ...strategy.requiredMaterials,
    plan.title,
    plan.whyItFits,
    nonVoiceoverExecutionPrompt,
    ...plan.beats.flatMap(beat => [
      beat.environment,
      beat.subject,
      beat.action,
      beat.shotSize,
      beat.cameraMovement,
      beat.lighting,
      beat.editingCue,
      beat.soundDesign,
      ...(beat.voiceoverZh ? [beat.voiceoverZh] : []),
    ]),
    ...plan.assumptions,
    ...plan.requiredMaterials,
    ...plan.warnings,
  ];
  if (chineseNarratives.some(value => (
    !isTkPromptChineseNarrative(value, allowedLatinTexts)
  ))) {
    throw canaryError('TK_PROMPT_CANARY_NON_VOICEOVER_LANGUAGE_INVALID');
  }
  if (
    (testCase.spokenLanguage ?? '英语') === '西班牙语'
    && MARKET_BY_LANGUAGE[(testCase.spokenLanguage ?? '英语')] !== 'Mexico'
  ) {
    throw canaryError('TK_PROMPT_CANARY_MEXICO_MARKET_INVALID');
  }
  const voiceoverTexts = plan.beats.map(beat => beat.voiceoverTarget).filter(Boolean);
  if (
    testCase.spokenLanguage !== null
    && (
      voiceoverTexts.length !== plan.beats.length
      || voiceoverTexts.some(value => !isTkPromptTargetLanguageText(
        value,
        testCase.spokenLanguage!,
        allowedLatinTexts,
      ))
    )
  ) {
    throw canaryError('TK_PROMPT_CANARY_TARGET_LANGUAGE_INVALID');
  }

}

export function assertCanaryModeCoverage(results: MatrixCaseResult[]) {
  const aggregate = emptyModeCounts();
  for (const result of results) {
    for (const mode of Object.keys(aggregate) as TkPromptCanaryAppearance[]) {
      aggregate[mode] += result.modeCounts[mode];
    }
  }
  if (
    aggregate.product_closeup < 1
    || aggregate.scene_demo < 1
    || aggregate.live_presenter < 1
  ) {
    throw canaryError('TK_PROMPT_CANARY_VIDEO_MODE_COVERAGE_INVALID');
  }
}

async function readCanaryLedger(runIds: string[]): Promise<TkPromptCanaryLedgerRow[]> {
  if (runIds.length === 0) return [];
  const result = await pool.query<TkPromptCanaryLedgerRow>(
    `SELECT run_id, generation_id, option_id, stage, action,
            repair_round, transport_attempt, provider, model, service_tier,
            request_status, provider_request_id, provider_response_id, x_tt_log_id,
            http_status, error_code, input_tokens, cached_input_tokens, output_tokens,
            cost_status, cost_cny::text, started_at, completed_at
     FROM tk_prompt_provider_requests
     WHERE run_id = ANY($1::uuid[])
     ORDER BY started_at ASC, id ASC`,
    [runIds],
  );
  return result.rows;
}

export function assertTkPromptCanaryPreRequestCostReserve(input: {
  priorKnownCostCny: string[];
  maxOutputTokens: number;
}) {
  if (!Number.isSafeInteger(input.maxOutputTokens)
    || input.maxOutputTokens < 1
    || input.maxOutputTokens > TK_PROMPT_CANARY_MAX_OUTPUT_TOKENS_PER_REQUEST) {
    throw canaryError('TK_PROMPT_CANARY_PRE_REQUEST_COST_RESERVE_INVALID');
  }
  const priorKnownCost = input.priorKnownCostCny.reduce(
    (sum, value) => sum + parseCnyMicros(value),
    0n,
  );
  // 冻结最高档：256k input × 1.8 CNY/M + 本请求 max output × 10.8 CNY/M。
  // 换算到 micro-CNY 后对小数向上取整，避免本地预留低估一微元。
  const worstInputMicroCny = BigInt(TK_PROMPT_CANARY_MAX_INPUT_TOKENS_PER_REQUEST) * 18n / 10n;
  const worstOutputMicroCny = (BigInt(input.maxOutputTokens) * 108n + 9n) / 10n;
  if (priorKnownCost + worstInputMicroCny + worstOutputMicroCny
    > TK_PROMPT_CANARY_MAX_SUCCESS_COST_MICRO_CNY) {
    throw canaryError('TK_PROMPT_CANARY_PRE_REQUEST_COST_RESERVE_EXCEEDED');
  }
}

function assertCanaryLedgerBudgetBeforeNextPhysicalRequest(
  rows: TkPromptCanaryLedgerRow[],
  physical: TkPromptCanaryPhysicalSnapshot,
  request: ArkPromptWizardResponsesRequest,
) {
  const providerRows = rows.filter(row => !isLocallyRejectedLedgerRow(row));
  if (
    rows.length !== providerRows.length
    || providerRows.length !== physical.globalCount
    || physical.locallyRejectedCount !== 0
    || physical.activeCount !== 0
    || (physical.globalCount > 0 && physical.maximumActiveCount !== 1)
    || providerRows.some(row => (
      row.provider !== 'volcengine-ark'
      || row.model !== TK_PROMPT_CANARY_MODEL
      || row.service_tier !== 'default'
      || row.transport_attempt !== 1
      || row.request_status !== 'succeeded'
      || row.cost_status !== 'known'
      || row.cost_cny === null
      || row.completed_at === null
    ))
  ) {
    throw canaryError('TK_PROMPT_CANARY_PRE_REQUEST_LEDGER_INVALID');
  }
  assertTkPromptCanaryPreRequestCostReserve({
    priorKnownCostCny: providerRows.map(row => row.cost_cny!),
    maxOutputTokens: request.max_output_tokens,
  });
}

function assertCanaryLedgerBudget(
  rows: TkPromptCanaryLedgerRow[],
  physical: TkPromptCanaryPhysicalSnapshot,
) {
  const providerRows = rows.filter(row => !isLocallyRejectedLedgerRow(row));
  const repairCount = providerRows.filter(row => row.action === 'repair-option').length;
  const totalCost = providerRows.reduce((sum, row) => (
    row.cost_status === 'known' && row.cost_cny !== null
      ? sum + parseCnyMicros(row.cost_cny)
      : sum
  ), 0n);
  if (
    providerRows.length !== physical.globalCount
    || physical.locallyRejectedCount !== 0
    || physical.activeCount !== 0
    || (physical.globalCount > 0 && physical.maximumActiveCount !== 1)
    || providerRows.some(row => (
      row.provider !== 'volcengine-ark'
      || row.model !== TK_PROMPT_CANARY_MODEL
      || row.service_tier !== 'default'
      || row.transport_attempt !== 1
      || row.request_status !== 'succeeded'
      || row.cost_status !== 'known'
      || row.cost_cny === null
      || row.completed_at === null
    ))
    || repairCount > TK_PROMPT_CANARY_MAX_SUCCESS_REPAIRS
    || totalCost > TK_PROMPT_CANARY_MAX_SUCCESS_COST_MICRO_CNY
  ) {
    throw canaryError('TK_PROMPT_CANARY_LEDGER_BUDGET_INVALID');
  }
}

function assertCanarySuccessfulCallContract(physical: TkPromptCanaryPhysicalSnapshot) {
  if (
    physical.counts.facts !== 7
    || physical.counts.strategies !== 7
    || physical.counts.options !== 21
    || physical.counts.repairs > TK_PROMPT_CANARY_MAX_SUCCESS_REPAIRS
    || physical.globalCount !== 35 + physical.counts.repairs
    || physical.globalCount < 35
    || physical.globalCount > 38
    || physical.locallyRejectedCount !== 0
    || physical.activeCount !== 0
    || physical.maximumActiveCount !== 1
  ) {
    throw canaryError('TK_PROMPT_CANARY_SUCCESS_CALL_CONTRACT_INVALID');
  }
}

function materializeSafeLedger(
  rows: TkPromptCanaryLedgerRow[],
  state: CanaryExecutionState,
): SafeLedgerObservation[] {
  return rows.filter(row => !isLocallyRejectedLedgerRow(row)).map((row, index) => {
    const identity = row.stage === 'analysis'
      ? `product:${state.runProductKeys.get(row.run_id) ?? 'unknown'}:facts`
      : row.stage === 'strategy'
        ? `case:${row.generation_id ? state.generationCaseIds.get(row.generation_id) : null}`
        : `case:${row.option_id ? state.optionCases.get(row.option_id)?.caseId : null}`
          + `:slot:${row.option_id ? state.optionCases.get(row.option_id)?.slot : null}`;
    const status = classifyTkPromptCanaryLedgerOutcome({
      requestStatus: row.request_status,
      errorCode: row.error_code,
    });
    return {
      sourceItemKey: `${identity}:${row.action}:r${row.repair_round}:t${row.transport_attempt}:n${index + 1}`,
      stage: row.stage,
      action: row.action,
      repairRound: row.repair_round === 1 ? 1 : 0,
      transportAttempt: row.transport_attempt,
      model: row.model,
      serviceTier: row.service_tier,
      status,
      providerRequestId: row.provider_request_id,
      providerResponseId: row.provider_response_id,
      xTtLogId: row.x_tt_log_id,
      inputTokens: nullableSafeInteger(row.input_tokens),
      cachedInputTokens: nullableSafeInteger(row.cached_input_tokens),
      outputTokens: nullableSafeInteger(row.output_tokens),
      ledgerCostCny: row.cost_status === 'known' ? row.cost_cny : null,
      costStatus: row.cost_status,
      occurredAt: toIso(row.completed_at ?? row.started_at),
      errorCode: safeLedgerErrorCode(row.error_code),
    };
  });
}

/**
 * 数据库 request_status 只能表示本地收敛是否完成；外部中止后的 Provider 远端
 * 终态仍不可知，因此在运营证据中必须明确归类为 unknown，而不是伪装成失败。
 */
export function classifyTkPromptCanaryLedgerOutcome(input: {
  requestStatus: 'started' | 'succeeded' | 'failed';
  errorCode: string | null;
}): SafeLedgerObservation['status'] {
  if (input.requestStatus === 'succeeded') return 'success';
  if (
    input.requestStatus === 'failed'
    && input.errorCode !== 'PROMPT_WIZARD_PROVIDER_INTERRUPTED_UNKNOWN'
  ) return 'failed';
  return 'unknown';
}

async function persistCanaryEvidence(input: {
  configFile: TkPromptCanaryConfigFile;
  manifest: ProviderOperationalUsageManifestRuntimeConfig;
  state: CanaryExecutionState;
  observations: SafeLedgerObservation[];
  physical: TkPromptCanaryPhysicalSnapshot;
  releaseAllowed: boolean;
  failureCode: string | null;
}) {
  const evidence = buildTkPromptCanarySafeEvidence({
    rid: input.configFile.config.rid,
    configSha256: input.configFile.sha256,
    candidateImageSha256: input.configFile.config.candidateImageSha256,
    physical: input.physical,
    completedCases: input.state.completedCases,
    ledger: input.observations,
    releaseAllowed: input.releaseAllowed,
    failureCode: input.failureCode,
  });
  return writeProviderOperationalUsageCanaryBundle({
    manifestPath: input.manifest.outputPath,
    manifestId: `${input.configFile.config.rid}-tk1-operational-v1`,
    evidence,
    buildRecords: writtenEvidence => input.observations.map(observation => (
      tkPromptEngineProviderCanaryOperationalUsageRecord({
        costOwnerUserId: input.manifest.costOwnerUserId,
        sourceRunId: input.manifest.sourceRunId,
        sourceItemKey: observation.sourceItemKey,
        occurredAt: observation.occurredAt,
        evidencePath: writtenEvidence.evidencePath,
        evidenceSha256: writtenEvidence.evidenceSha256,
        stage: observation.stage,
        action: observation.action,
        repairRound: observation.repairRound,
        transportAttempt: observation.transportAttempt,
        providerRequestId: observation.providerRequestId,
        providerResponseId: observation.providerResponseId,
        xTtLogId: observation.xTtLogId,
        model: observation.model,
        status: observation.status,
        serviceTier: observation.serviceTier,
        inputTokens: observation.inputTokens,
        cachedInputTokens: observation.cachedInputTokens,
        outputTokens: observation.outputTokens,
        ledgerCostCny: observation.ledgerCostCny,
      })
    )),
  });
}

export async function readRootOnlyTkPromptCanaryConfig(
  configPath: string,
): Promise<TkPromptCanaryConfigFile> {
  const absolutePath = path.resolve(configPath);
  if (!path.isAbsolute(configPath) || absolutePath !== configPath) {
    throw canaryError('TK_PROMPT_CANARY_CONFIG_PATH_INVALID');
  }
  const handle = await open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (
      !before.isFile()
      || before.uid !== 0
      || before.nlink !== 1
      || (before.mode & 0o077) !== 0
      || (before.mode & 0o400) === 0
      || before.size < 2
      || before.size > 64 * 1024
    ) {
      throw canaryError('TK_PROMPT_CANARY_CONFIG_FILE_UNSAFE');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
    ) {
      throw canaryError('TK_PROMPT_CANARY_CONFIG_FILE_CHANGED');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw canaryError('TK_PROMPT_CANARY_CONFIG_JSON_INVALID');
    }
    return {
      config: tkPromptCanaryConfigSchema.parse(parsed),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } finally {
    await handle.close();
  }
}

async function claimTkPromptCanaryRid(config: TkPromptCanaryConfig, manifestPath: string) {
  const markerPath = path.resolve(config.executionMarkerPath);
  const auditDirectory = path.dirname(markerPath);
  const directoryStat = await lstat(auditDirectory);
  const physicalDirectory = await realpath(auditDirectory);
  if (
    !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || directoryStat.uid !== 0
    || (directoryStat.mode & 0o777) !== 0o700
    || physicalDirectory !== auditDirectory
    || path.dirname(path.resolve(manifestPath)) !== auditDirectory
  ) {
    throw canaryError('TK_PROMPT_CANARY_AUDIT_DIRECTORY_UNSAFE');
  }
  const handle = await open(markerPath, 'wx', 0o400);
  try {
    await handle.writeFile(`${JSON.stringify({
      version: TK_PROMPT_CANARY_VERSION,
      rid: config.rid,
      candidateImageSha256: config.candidateImageSha256,
    })}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const marker = await lstat(markerPath);
  if (!marker.isFile() || marker.isSymbolicLink() || marker.uid !== 0 || marker.nlink !== 1) {
    throw canaryError('TK_PROMPT_CANARY_EXECUTION_MARKER_UNSAFE');
  }
}

function assertTkPromptCanarySafeEvidence(value: JsonValue) {
  const serialized = JSON.stringify(value);
  if (
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu.test(serialized)
    || /(?:Bearer\s+|api[-_]?key|secret[-_]?key|X-Amz-(?:Credential|Signature)|executionPrompt|rawPrompt|rawResponse)/iu.test(serialized)
  ) {
    throw canaryError('TK_PROMPT_CANARY_EVIDENCE_SENSITIVE_DATA');
  }
}

function classifyPhysicalRequest(request: ArkPromptWizardResponsesRequest): keyof TkPromptCanaryPhysicalCounts {
  const schemaName = request.text?.format?.name;
  if (schemaName === 'tk_prompt_engine_fact_analysis_v1') return 'facts';
  if (schemaName === 'tk_prompt_engine_strategy_set_v1') return 'strategies';
  if (/^tk_prompt_engine_option_(?:safe|native|creative)_v1$/u.test(schemaName)) return 'options';
  if (/^tk_prompt_engine_option_(?:safe|native|creative)_repair_v1$/u.test(schemaName)) return 'repairs';
  throw canaryError('TK_PROMPT_CANARY_PROVIDER_SCHEMA_INVALID');
}

function hashPhysicalRequest(request: ArkPromptWizardResponsesRequest) {
  return createHash('sha256').update(JSON.stringify({
    model: request.model,
    instructions: request.instructions,
    input: request.input,
    text: request.text,
    maxOutputTokens: request.max_output_tokens,
  })).digest('hex');
}

function canaryCase(
  id: string,
  productKey: TkPromptCanaryProductKey,
  language: TkPromptLanguage | null,
  durationSeconds: 5 | 10 | 15,
  appearance: TkPromptCanaryAppearance,
  imageCount: 1 | 2 | 3 = 1,
): TkPromptCanaryCase {
  return {
    id,
    productKey,
    spokenLanguage: language,
    appearance,
    imageCount,
    videoConfig: durationSeconds === 5 ? VIDEO_5S : durationSeconds === 10 ? VIDEO_10S : VIDEO_15S,
  };
}

function databaseName(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
    if (!name || name.includes('/')) throw new Error('invalid database name');
    return name;
  } catch {
    throw canaryError('TK_PROMPT_CANARY_DATABASE_URL_INVALID');
  }
}

function parseProcInteger(source: string, key: string) {
  const line = source.split('\n').find(candidate => candidate.startsWith(key));
  const value = line?.slice(key.length).trim().split(/\s+/u)[0] ?? '';
  if (!/^\d+$/u.test(value)) throw canaryError('TK_PROMPT_CANARY_HOST_METRICS_INVALID');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw canaryError('TK_PROMPT_CANARY_HOST_METRICS_INVALID');
  return parsed;
}

function parseProcBigInt(source: string, key: string) {
  const line = source.split('\n').find(candidate => candidate.startsWith(`${key} `));
  const value = line?.slice(key.length).trim() ?? '';
  if (!/^\d+$/u.test(value)) throw canaryError('TK_PROMPT_CANARY_HOST_METRICS_INVALID');
  return BigInt(value);
}

function parsePressureAvg10(source: string, key: 'some' | 'full') {
  const line = source.split('\n').find(candidate => candidate.startsWith(`${key} `));
  const match = line?.match(/(?:^|\s)avg10=([0-9]+(?:\.[0-9]+)?)(?:\s|$)/u);
  if (!match) throw canaryError('TK_PROMPT_CANARY_HOST_METRICS_INVALID');
  const value = Number(match[1]);
  if (!Number.isFinite(value)) throw canaryError('TK_PROMPT_CANARY_HOST_METRICS_INVALID');
  return value;
}

function parsePressureTotal(source: string, key: 'some' | 'full') {
  const line = source.split('\n').find(candidate => candidate.startsWith(`${key} `));
  const match = line?.match(/(?:^|\s)total=(\d+)(?:\s|$)/u);
  if (!match) throw canaryError('TK_PROMPT_CANARY_HOST_METRICS_INVALID');
  return BigInt(match[1]);
}

function canaryIdempotencyKey(rid: string, scope: string) {
  return `tk1-canary-${createHash('sha256').update(`${rid}:${scope}`).digest('hex')}`;
}

function emptyModeCounts(): Record<TkPromptCanaryAppearance, number> {
  return { product_closeup: 0, scene_demo: 0, live_presenter: 0 };
}

function emptyPhysicalSnapshot(): TkPromptCanaryPhysicalSnapshot {
  return {
    globalCount: 0,
    counts: { facts: 0, strategies: 0, options: 0, repairs: 0 },
    locallyRejectedCount: 0,
    activeCount: 0,
    maximumActiveCount: 0,
  };
}

function isLocallyRejectedLedgerRow(row: TkPromptCanaryLedgerRow) {
  return row.error_code?.startsWith('TK_PROMPT_CANARY_PHYSICAL_') === true;
}

function nullableSafeInteger(value: number | null) {
  return Number.isSafeInteger(value) && value !== null && value >= 0 ? value : null;
}

function safeLedgerErrorCode(value: string | null) {
  return value && /^[A-Z][A-Z0-9_:-]{0,99}$/u.test(value) ? value : null;
}

function parseCnyMicros(value: string) {
  if (!/^(?:0|[1-9]\d{0,13})\.\d{6}$/u.test(value)) {
    throw canaryError('TK_PROMPT_CANARY_COST_INVALID');
  }
  const [integer, fraction] = value.split('.');
  return BigInt(integer!) * 1_000_000n + BigInt(fraction!);
}

function parseUnsignedBigInt(value: string) {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw canaryError('TK_PROMPT_CANARY_INTEGER_INVALID');
  }
  return BigInt(value);
}

function formatCnyMicros(value: bigint) {
  const integer = value / 1_000_000n;
  const fraction = String(value % 1_000_000n).padStart(6, '0');
  return `${integer}.${fraction}`;
}

function toIso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw canaryError('TK_PROMPT_CANARY_TIMESTAMP_INVALID');
  return date.toISOString();
}

async function assertAuditOutputAbsent(manifestPath: string) {
  const paths = [
    path.resolve(manifestPath),
    path.resolve(manifestPath).endsWith('.json')
      ? `${path.resolve(manifestPath).slice(0, -5)}.evidence.json`
      : `${path.resolve(manifestPath)}.evidence.json`,
  ];
  for (const target of paths) {
    try {
      await lstat(target);
      throw canaryError('TK_PROMPT_CANARY_AUDIT_OUTPUT_EXISTS');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function safeCanaryErrorCode(error: unknown) {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_:-]{0,99}$/u.test(code)
    ? code
    : 'TK_PROMPT_CANARY_FAILED';
}

function canaryError(code: string) {
  return Object.assign(new Error('TK Prompt Engine shadow Canary 失败'), {
    code,
    retryable: false,
  });
}

function assertTkPromptCanaryNotInterrupted(signal?: AbortSignal) {
  if (signal?.aborted) throw canaryError('TK_PROMPT_CANARY_SIGNAL_INTERRUPTED');
}

function emitSafeEvent(event: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

type TkPromptCanaryShutdownSignal = 'SIGINT' | 'SIGTERM';

export const TK_PROMPT_CANARY_SIGNAL_CLOSE_DEADLINE_MS = 18_000;

export interface TkPromptCanarySignalRuntime {
  onSignal(signal: TkPromptCanaryShutdownSignal, handler: () => void): void;
  offSignal(signal: TkPromptCanaryShutdownSignal, handler: () => void): void;
  setDeadline(handler: () => void, timeoutMs: number): unknown;
  clearDeadline(handle: unknown): void;
  setExitCode(code: 1): void;
  forceExit(code: 1): void;
}

const defaultSignalRuntime: TkPromptCanarySignalRuntime = {
  onSignal(signal, handler) {
    process.on(signal, handler);
  },
  offSignal(signal, handler) {
    process.off(signal, handler);
  },
  setDeadline(handler, timeoutMs) {
    return setTimeout(handler, timeoutMs);
  },
  clearDeadline(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  setExitCode(code) {
    process.exitCode = code;
  },
  forceExit(code) {
    process.exit(code);
  },
};

/**
 * Node 作为容器 PID1 时不能依赖 SIGTERM 的默认动作。这里只安装一组处理器：
 * 首个信号中止在途 Provider，随后让正常 async finally 写账本/证据；重复信号
 * 不重入。18 秒硬截止早于 docker stop 的 20 秒 SIGKILL 窗口。
 */
export function installTkPromptCanarySignalClosure(
  runtime: TkPromptCanarySignalRuntime = defaultSignalRuntime,
) {
  const controller = new AbortController();
  let interrupted = false;
  let completed = false;
  let deadline: unknown;

  const handleSignal = () => {
    if (interrupted || completed) return;
    interrupted = true;
    runtime.setExitCode(1);
    deadline = runtime.setDeadline(() => runtime.forceExit(1),
      TK_PROMPT_CANARY_SIGNAL_CLOSE_DEADLINE_MS);
    controller.abort(canaryError('TK_PROMPT_CANARY_SIGNAL_INTERRUPTED'));
  };

  runtime.onSignal('SIGINT', handleSignal);
  runtime.onSignal('SIGTERM', handleSignal);

  return {
    signal: controller.signal,
    wasInterrupted: () => interrupted,
    complete() {
      if (completed) return;
      completed = true;
      runtime.offSignal('SIGINT', handleSignal);
      runtime.offSignal('SIGTERM', handleSignal);
      if (deadline !== undefined) runtime.clearDeadline(deadline);
      if (interrupted) runtime.setExitCode(1);
    },
  };
}

async function main() {
  const signalClosure = installTkPromptCanarySignalClosure();
  try {
    const configPath = process.env.TK_PROMPT_CANARY_CONFIG_PATH?.trim();
    if (!configPath) throw canaryError('TK_PROMPT_CANARY_CONFIG_REQUIRED');
    assertTkPromptCanaryNotInterrupted(signalClosure.signal);
    const configFile = await readRootOnlyTkPromptCanaryConfig(configPath);
    Object.assign(
      env,
      resolveTkPromptCanaryProviderTimeoutPolicy(configFile.config.rid),
    );
    assertTkPromptCanaryNotInterrupted(signalClosure.signal);
    const manifest = requireProviderOperationalUsageManifestRuntimeConfig();
    const releaseAllowed = await executePaidCanary({
      configFile,
      manifest,
      signal: signalClosure.signal,
    });
    if (!releaseAllowed) process.exitCode = 1;
  } catch (error) {
    emitSafeEvent({
      event: 'tk-prompt-engine-shadow-canary-preprovider',
      ok: false,
      failureCode: safeCanaryErrorCode(error),
      providerRequests: 0,
    });
    process.exitCode = 1;
  } finally {
    try {
      await captureCanaryCgroupMemoryEvents();
    } catch (error) {
      emitSafeEvent({
        event: 'tk-prompt-engine-shadow-canary-memory-events',
        ok: false,
        failureCode: safeCanaryErrorCode(error),
      });
      process.exitCode = 1;
    }
    await pool.end().catch(() => undefined);
    signalClosure.complete();
  }
}

function parseTkPromptCanaryCgroupCounters(
  payload: string,
  requiredKeys: readonly string[],
) {
  const counters: Record<string, bigint> = {};
  for (const line of payload.trim().split('\n')) {
    const match = /^([a-z_]+) (\d+)$/u.exec(line);
    if (!match || Object.hasOwn(counters, match[1]!)) {
      throw canaryError('TK_PROMPT_CANARY_MEMORY_EVENTS_INVALID');
    }
    counters[match[1]!] = BigInt(match[2]!);
  }
  if (requiredKeys.some(key => counters[key] === undefined)) {
    throw canaryError('TK_PROMPT_CANARY_MEMORY_EVENTS_INVALID');
  }
  return counters;
}

function parseTkPromptCanaryCgroupCounter(payload: string) {
  const normalized = payload.trim();
  if (!/^\d+$/u.test(normalized)) {
    throw canaryError('TK_PROMPT_CANARY_MEMORY_EVENTS_INVALID');
  }
  return BigInt(normalized);
}

export async function readTkPromptCanaryCgroupMemoryEvidence(
  readText: (path: string) => Promise<string> = file => readFile(file, 'utf8'),
) {
  const [memoryPayload, swapCurrentPayload, swapPeakPayload, swapEventsPayload] =
    await Promise.all([
      readText('/sys/fs/cgroup/memory.events'),
      readText('/sys/fs/cgroup/memory.swap.current'),
      readText('/sys/fs/cgroup/memory.swap.peak'),
      readText('/sys/fs/cgroup/memory.swap.events'),
    ]);
  const memory = parseTkPromptCanaryCgroupCounters(memoryPayload, [
    'low',
    'high',
    'max',
    'oom',
    'oom_kill',
    'oom_group_kill',
  ]);
  const swap = parseTkPromptCanaryCgroupCounters(swapEventsPayload, [
    'high',
    'max',
    'fail',
  ]);
  const lines = [
    `low ${memory.low}`,
    `high ${memory.high}`,
    `max ${memory.max}`,
    `oom ${memory.oom}`,
    `oom_kill ${memory.oom_kill}`,
    `oom_group_kill ${memory.oom_group_kill}`,
    `swap_current ${parseTkPromptCanaryCgroupCounter(swapCurrentPayload)}`,
    `swap_peak ${parseTkPromptCanaryCgroupCounter(swapPeakPayload)}`,
    `swap_high ${swap.high}`,
    `swap_max ${swap.max}`,
    `swap_fail ${swap.fail}`,
  ];
  return `${lines.join('\n')}\n`;
}

async function captureCanaryCgroupMemoryEvents() {
  const target = process.env.TK_PROMPT_CANARY_MEMORY_EVENTS_PATH?.trim();
  if (!target) return;
  const rid = process.env.PROVIDER_OPERATIONAL_USAGE_SOURCE_RUN_ID?.trim() ?? '';
  const expected = path.join(TK_PROMPT_CANARY_AUDIT_ROOT, rid, 'paid-memory.events');
  if (!/^tk-prompt-engine-v1-canary-[0-9]{8}T[0-9]{6}Z$/u.test(rid)
    || path.resolve(target) !== expected) {
    throw canaryError('TK_PROMPT_CANARY_MEMORY_EVENTS_PATH_INVALID');
  }
  const events = await readTkPromptCanaryCgroupMemoryEvidence();
  const handle = await open(expected, 'wx', 0o600);
  try {
    await handle.writeFile(events, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry!) === fileURLToPath(import.meta.url);
}

if (isMainModule()) void main();
