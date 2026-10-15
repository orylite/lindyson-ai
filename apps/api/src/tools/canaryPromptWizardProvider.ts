import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type {
  PromptWizardConceptPreview,
  PromptWizardCreativeBrief,
  PromptWizardEvidenceGraph,
  PromptWizardPlan,
  PromptWizardProductProfile,
  PromptWizardProductionBrief,
  PromptWizardVideoConfig,
} from '@lindyson/api-contracts';
import {
  PROMPT_WIZARD_CONCEPT_PREVIEW_COUNT,
  PROMPT_WIZARD_CONCEPT_ROLE_COUNT,
  assertPromptWizardConceptSet,
  conceptPreviewToAssignment,
  selectPromptWizardConceptPair,
  type PromptWizardConceptSetValidationError,
} from '../domain/promptWizardConceptDirector.js';
import { buildPromptWizardEvidenceGraph } from '../domain/promptWizardEvidenceGraph.js';
import {
  assessPromptWizardDirection,
  buildPromptWizardProductionBrief,
} from '../domain/promptWizardCreativePlaybook.js';
import {
  PROMPT_WIZARD_PLAN_COUNT,
  PROMPT_WIZARD_LEGACY_PLAN_INDEXES,
} from '../domain/promptWizardPlanCount.js';
import { generateValidatedPromptWizardPlans } from '../domain/promptWizardService.js';
import { env } from '../config/env.js';
import {
  ArkPromptWizardProvider,
  PROMPT_WIZARD_SERVICE_TIER,
  validatePromptWizardImages,
  type PromptWizardImageInput,
  type PromptWizardProvider,
  type PromptWizardProviderUsage,
} from '../providers/promptWizardProvider.js';
import {
  ArkPromptWizardResponsesClient,
  ArkPromptWizardResponsesError,
  type ArkPromptWizardResponsesRequest,
  type ArkPromptWizardResponsesResult,
} from '../providers/arkPromptWizardResponsesClient.js';
import type { PromptWizardProviderRequestRecorder } from '../domain/promptWizardCostLedger.js';
import { promptWizardProviderCanaryOperationalUsageRecord } from './providerOperationalUsageCanaryAdapters.js';
import {
  requireProviderOperationalUsageManifestRuntimeConfig,
  writeProviderOperationalUsageCanaryBundle,
  type ProviderOperationalUsageManifestRuntimeConfig,
} from './providerOperationalUsageManifestWriter.js';

const CANARY_IMAGES_ENV = 'ARK_PROMPT_WIZARD_CANARY_IMAGES_JSON';
const CANARY_IMAGE_COUNT = 9;
const IMAGE_PREFLIGHT_TIMEOUT_MS = 15_000;
const IMAGE_PREFLIGHT_CONCURRENCY = 3;
const MAX_REDIRECTS = 5;
const CANARY_PROFILE_VERSION = 'prompt-wizard-canary-profile-v2-2026-08-01';
const MAX_NATURAL_DRAFT_FORMAT_REPAIRS = 1;
const MIN_CONCEPT_REPAIR_BUDGET_MS = 60_000;

const canaryImageSchema = z.object({
  name: z.string().trim().min(1).max(120)
    .refine(value => !/[\u0000-\u001f\u007f]/u.test(value), '文件名不能包含控制字符'),
  url: z.string().trim().url().max(8_192),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
}).strict();

const canaryImagesSchema = z.array(canaryImageSchema).length(CANARY_IMAGE_COUNT);

export interface PromptWizardCanaryCase {
  id: string;
  imageCount: 1 | 9;
  brief: PromptWizardCreativeBrief;
  config: PromptWizardVideoConfig;
}

/**
 * 固定案例矩阵是发布门禁的一部分。它不根据当前日期、随机数或模型输出改变，
 * 以便每次发布都覆盖相同的图片数、时长、语言与八个主创作方向。
 */
export const PROMPT_WIZARD_CANARY_CASES: readonly PromptWizardCanaryCase[] = [
  canaryCase('C01', 1, 5, '英语', 'ugc', 'conversion', 'steady'),
  canaryCase('C02', 9, 10, '西班牙语', 'problem-solution', 'consideration', 'balanced'),
  canaryCase('C03', 1, 15, '普通话', 'unboxing-review', 'awareness', 'bold'),
  canaryCase('C04', 9, 5, '英语', 'feature-test', 'conversion', 'balanced'),
  canaryCase('C05', 1, 10, '西班牙语', 'pain-comparison', 'consideration', 'bold'),
  canaryCase('C06', 9, 15, '普通话', 'lifestyle', 'awareness', 'steady'),
  canaryCase('C07', 1, 5, '英语', 'cinematic-brand', 'conversion', 'bold'),
  canaryCase('C08', 9, 10, '西班牙语', 'asmr-detail', 'consideration', 'steady'),
  canaryCase('C09', 1, 15, '普通话', 'ugc', 'awareness', 'balanced'),
  canaryCase('C10', 9, 5, '西班牙语', 'problem-solution', 'conversion', 'bold'),
  canaryCase('C11', 1, 10, '英语', 'feature-test', 'consideration', 'steady'),
  canaryCase('C12', 9, 15, '西班牙语', 'lifestyle', 'awareness', 'balanced'),
] as const;

/**
 * 十二组脚本矩阵固定使用同一份已经过人工审阅的安全产品档案。版本号与内容一起
 * 写在代码中，避免模型识别结果的偶发波动污染脚本门禁，也避免每个案例重复付费
 * 识别图片。图片数量仍按案例传给脚本 Provider，用来覆盖 @图片1–9 引用边界。
 */
export const PROMPT_WIZARD_CANARY_FIXED_PROFILE: Readonly<PromptWizardProductProfile> = {
  productName: '短袖T恤 MEXICO',
  category: '短袖T恤',
  colors: '',
  materials: '纺织面料',
  structure: '圆领、短袖、直筒版型，衣身带有印花',
  logo: '衣身可见 MEXICO 原文印花',
  usage: '套头穿着',
  suggestedAudience: '喜欢休闲穿搭与体育文化元素的人群',
  suggestedScenarios: '日常休闲、朋友聚会与观看体育活动',
  visibleFacts: [
    '参考图片中可见短袖上衣的正面与背面',
    '衣身可见 MEXICO 原文印花',
    '领口、袖口与衣身印花属于需要保持一致的可见结构',
  ],
  needsConfirmation: [
    '具体纤维成分与面料克重需要用户确认',
    '尺码范围与洗涤方式需要用户确认',
  ],
  userConfirmedClaims: '用户确认可通过常规套头穿着动作展示产品',
  consistencyConstraints: '保持参考图片中的版型、领口、袖口、Logo 与印花位置一致',
};

export { CANARY_PROFILE_VERSION as PROMPT_WIZARD_CANARY_PROFILE_VERSION };

interface UsageAccumulator {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  serviceTier: PromptWizardProviderUsage['serviceTier'];
  requestAttempts: number;
}

interface DirectionHistory {
  plans: PromptWizardPlan[];
  concepts: PromptWizardConceptPreview[];
  nextOrdinal: number;
}

export type PromptWizardCanaryMatrixAttemptKind =
  | 'generate-concepts'
  | 'repair-concept-set'
  | 'initial-draft'
  | 'draft-format-repair'
  | 'initial-content-repair'
  | 'content-repair'
  | 'content-format-repair'
  | 'other';

export type PromptWizardCanaryMatrixAttemptOutcome =
  | 'succeeded'
  | 'transport-failed'
  | 'non-transport-failed';

export interface PromptWizardCanaryMatrixAttemptObservation {
  caseId: string;
  kind: PromptWizardCanaryMatrixAttemptKind;
  planIndex: number | null;
  repairRound: number | null;
  outcome: PromptWizardCanaryMatrixAttemptOutcome;
}

export interface PromptWizardCanaryRepairObservation {
  source: 'initial-schema' | 'domain-validation' | 'domain-format-recovery';
  planIndex: number;
  repairRound: number;
  outcome: PromptWizardCanaryMatrixAttemptOutcome;
}

export interface PromptWizardCanaryMatrixCaseResult {
  id: string;
  ok: boolean;
  transportFailure: boolean;
  conceptDirector: PromptWizardCanaryConceptDirectorObservation | null;
}

export interface PromptWizardCanaryConceptDirectorObservation {
  candidateCount: number;
  reliableCandidateCount: number;
  breakthroughCandidateCount: number;
  selectedConceptCount: number;
  complementaryDimensions: number;
  valid: boolean;
}

export interface PromptWizardCanaryMatrixGateResult {
  ok: boolean;
  passed: number;
  conceptGenerationBusinessItemCount: number;
  conceptRepairBusinessItemCount: number;
  initialDraftBusinessItemCount: number;
  initialDraftTransportAttemptCount: number;
  internalConceptCandidateCount: number;
  selectedConceptCount: number;
  conceptDirectorGatePassed: boolean;
  naturalFormatRepairCount: number;
  formatRepairTransportAttemptCount: number;
  transportFailureObserved: boolean;
  nonTransportFailureObserved: boolean;
  unexplainedPhysicalAttemptObserved: boolean;
  fullCandidateRerunAllowed: boolean;
}

type PromptWizardCanaryResponsesClient = Pick<ArkPromptWizardResponsesClient, 'create'>;

export interface PromptWizardOperationalUsageObservation {
  operation: string;
  occurredAt: string;
  model: string;
  status: 'success' | 'failed' | 'unknown';
  providerRequestId: string | null;
  providerResponseId: string | null;
  xTtLogId: string | null;
  serviceTier: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
}

export interface PromptWizardProductAnalysisCanaryResult {
  oneImageUsage: PromptWizardProviderUsage;
  nineImageUsage: PromptWizardProviderUsage;
  profileRepairUsage: PromptWizardProviderUsage;
  formatRepairUsage: PromptWizardProviderUsage;
  oneImageProviderCalls: number;
  nineImageProviderCalls: number;
  profileRepairProviderCalls: number;
  formatRepairProviderCalls: number;
}

export interface PromptWizardDraftFormatCanaryResult {
  plans: PromptWizardPlan[];
  usage: PromptWizardProviderUsage;
  initialPlanIndexes: number[];
  repairedPlanIndexes: number[];
}

export async function runPromptWizardProviderCanary() {
  // 配置缺失时必须在第一笔真实 Provider 请求前失败，不能产生无归属费用。
  const operationalUsage = requireProviderOperationalUsageManifestRuntimeConfig();
  const operationalObservations: PromptWizardOperationalUsageObservation[] = [];
  const responses = observePromptWizardProviderCalls(
    createPromptWizardCanaryResponsesClient(),
    operationalObservations,
  );

  try {
    const images = parsePromptWizardCanaryImages(process.env[CANARY_IMAGES_ENV]);
    await assertCanaryImagesReachable(images);

    const productAnalysis = await runPromptWizardProductAnalysisCanary(images, responses);
  emitCanaryEvent({
    event: 'prompt-wizard-provider-canary-stage',
    stage: 'product-analysis',
    ok: true,
    oneImageProviderCalls: productAnalysis.oneImageProviderCalls,
    nineImageProviderCalls: productAnalysis.nineImageProviderCalls,
    profileRepairProviderCalls: productAnalysis.profileRepairProviderCalls,
    formatRepairProviderCalls: productAnalysis.formatRepairProviderCalls,
    oneImageUsage: safeCanaryUsage(productAnalysis.oneImageUsage),
    nineImageUsage: safeCanaryUsage(productAnalysis.nineImageUsage),
    profileRepairUsage: safeCanaryUsage(productAnalysis.profileRepairUsage),
    formatRepairUsage: safeCanaryUsage(productAnalysis.formatRepairUsage),
  });

  const formatRepairProbe = await runPromptWizardDraftFormatRepairCanary(responses);
  emitCanaryEvent({
    event: 'prompt-wizard-provider-canary-stage',
    stage: 'single-plan-format-repair',
    ok: true,
    initialPlanIndexes: formatRepairProbe.initialPlanIndexes,
    repairedPlanIndexes: formatRepairProbe.repairedPlanIndexes,
    usage: safeCanaryUsage(formatRepairProbe.usage),
  });

  const matrixAttemptObservations: PromptWizardCanaryMatrixAttemptObservation[] = [];
  let activeMatrixCaseId: string | null = null;
  let matrixAttemptSequence = 0;
  const pendingMatrixAttempts = new Map<string, Array<{ repairRound: number }>>();
  const matrixRequestRecorder: PromptWizardProviderRequestRecorder = {
    async beginAttempt(input) {
      const caseId = activeMatrixCaseId;
      if (!caseId) {
        throw canaryError(
          'PROMPT_WIZARD_CANARY_MATRIX_CASE_MISSING',
          '脚本矩阵成本观测缺少当前案例标识',
        );
      }
      const key = canaryMatrixPendingAttemptKey(caseId, input.operation, input.planIndex);
      pendingMatrixAttempts.set(key, [
        ...(pendingMatrixAttempts.get(key) ?? []),
        { repairRound: input.owner.repairRound },
      ]);
      matrixAttemptSequence += 1;
      return `prompt-wizard-canary-attempt-${matrixAttemptSequence}`;
    },
    async completeAttempt() {
      // Provider-only canary 只在内存中观察归属，不写数据库或成本流水。
    },
  };
  const matrixResponses: PromptWizardCanaryResponsesClient = {
    async create(request, options) {
      const caseId = activeMatrixCaseId;
      if (!caseId) {
        throw canaryError(
          'PROMPT_WIZARD_CANARY_MATRIX_CASE_MISSING',
          '脚本矩阵 Provider 请求缺少当前案例标识',
        );
      }
      const kind = canaryMatrixAttemptKind(request);
      const planIndex = isCanaryConceptAttemptKind(kind) || kind === 'other'
        ? null
        : draftRequestPlanIndex(request);
      const operation = canaryMatrixOperation(kind);
      const repairRound = operation
        ? consumeCanaryMatrixRepairRound(
          pendingMatrixAttempts,
          canaryMatrixPendingAttemptKey(caseId, operation, planIndex),
        )
        : null;
      try {
        const result = await responses.create(request, options);
        matrixAttemptObservations.push({
          caseId,
          kind,
          planIndex,
          repairRound,
          outcome: 'succeeded',
        });
        return result;
      } catch (error) {
        matrixAttemptObservations.push({
          caseId,
          kind,
          planIndex,
          repairRound,
          outcome: isCanaryTransportFailure(error)
            ? 'transport-failed'
            : 'non-transport-failed',
        });
        throw error;
      }
    },
  };
  const provider = new ArkPromptWizardProvider(
    matrixResponses,
    matrixRequestRecorder,
  );
  const historyByDirection = new Map<PromptWizardCreativeBrief['direction'], DirectionHistory>();
  const caseResults: PromptWizardCanaryMatrixCaseResult[] = [];

  for (const testCase of PROMPT_WIZARD_CANARY_CASES) {
    const startedAt = Date.now();
    const usage = emptyUsage();
    let repairRounds = 0;
    let conceptDirector: PromptWizardCanaryConceptDirectorObservation | null = null;
    activeMatrixCaseId = testCase.id;
    try {
      const directionHistory = historyByDirection.get(testCase.brief.direction) ?? {
        plans: [],
        concepts: [],
        nextOrdinal: 1,
      };
      const ordinal = directionHistory.nextOrdinal;
      const evidenceGraph = buildPromptWizardCanaryEvidenceGraph(testCase.imageCount);
      const productionBrief = buildPromptWizardCanaryProductionBrief();
      assertPromptWizardCanaryDirectionAvailable({
        evidenceGraph,
        productionBrief,
        brief: testCase.brief,
      });
      const deadlineAtMs = Date.now() + env.PROMPT_WIZARD_BATCH_BUDGET_MS;
      const generatedConcepts = await generateValidatedPromptWizardCanaryConcepts({
        provider,
        profile: PROMPT_WIZARD_CANARY_FIXED_PROFILE,
        evidenceGraph,
        productionBrief,
        brief: testCase.brief,
        config: testCase.config,
        imageCount: testCase.imageCount,
        historicalConcepts: directionHistory.concepts,
        deadlineAtMs,
        costOwner: {
          runId: `provider-canary-run-${testCase.id}`,
          batchId: null,
          userId: 'provider-canary-user',
          jobAttempt: 1,
          repairRound: 0,
        },
      });
      appendUsage(usage, generatedConcepts.usage);
      conceptDirector = assertPromptWizardCanaryConceptDirector({
        concepts: generatedConcepts.concepts,
        selected: generatedConcepts.selected,
      });
      const conceptPreviews = [
        generatedConcepts.selected.primary,
        generatedConcepts.selected.secondary,
      ];
      const strategies = conceptPreviews.map(concept => concept.strategy);
      const conceptAssignments = conceptPreviews.map((concept, planIndex) => (
        conceptPreviewToAssignment(
          concept,
          PROMPT_WIZARD_LEGACY_PLAN_INDEXES[planIndex]!,
        )
      ));
      const generated = await generateValidatedPromptWizardPlans({
        provider,
        profile: PROMPT_WIZARD_CANARY_FIXED_PROFILE,
        evidenceGraph,
        brief: testCase.brief,
        config: testCase.config,
        strategies,
        conceptAssignments,
        conceptPreviews,
        imageCount: testCase.imageCount,
        variationKey: ordinal,
        deadlineAtMs,
        historicalPlans: directionHistory.plans,
        costOwner: {
          runId: `provider-canary-run-${testCase.id}`,
          batchId: `provider-canary-batch-${testCase.id}`,
          userId: 'provider-canary-user',
          jobAttempt: 1,
          repairRound: 0,
        },
      });
      appendUsage(usage, generated.usage);
      repairRounds = generated.repairRounds;
      const plans = generated.plans;

      directionHistory.plans.push(...plans);
      directionHistory.concepts.push(...generatedConcepts.concepts);
      directionHistory.nextOrdinal += 1;
      historyByDirection.set(testCase.brief.direction, directionHistory);
      caseResults.push({
        id: testCase.id,
        ok: true,
        transportFailure: false,
        conceptDirector,
      });
      const transportFailureObserved = matrixAttemptObservations.some(observation => (
        observation.caseId === testCase.id
        && observation.outcome === 'transport-failed'
      ));
      emitCanaryEvent({
        event: 'prompt-wizard-provider-canary-case',
        caseId: testCase.id,
        ok: true,
        transportFailureObserved,
        imageCount: testCase.imageCount,
        durationSeconds: testCase.config.durationSeconds,
        targetLanguage: testCase.brief.targetLanguage,
        direction: testCase.brief.direction,
        conceptDirector,
        repairRounds,
        repairObservations: safeCanaryRepairObservations(
          matrixAttemptObservations,
          testCase.id,
        ),
        latencyMs: Date.now() - startedAt,
        usage,
      });
    } catch (error) {
      appendFailureUsage(usage, error);
      repairRounds = promptWizardCanaryObservedRepairRounds(error, repairRounds);
      const transportFailure = isCanaryTransportFailure(error);
      caseResults.push({
        id: testCase.id,
        ok: false,
        transportFailure,
        conceptDirector,
      });
      emitCanaryEvent({
        event: 'prompt-wizard-provider-canary-case',
        caseId: testCase.id,
        ok: false,
        imageCount: testCase.imageCount,
        durationSeconds: testCase.config.durationSeconds,
        targetLanguage: testCase.brief.targetLanguage,
        direction: testCase.brief.direction,
        repairRounds,
        repairObservations: safeCanaryRepairObservations(
          matrixAttemptObservations,
          testCase.id,
        ),
        latencyMs: Date.now() - startedAt,
        usage,
        fullCandidateRerunAllowed: transportFailure,
        error: redactCanaryError(error),
      });
    } finally {
      activeMatrixCaseId = null;
    }

    const naturalFormatRepairCount = countCanaryMatrixBusinessItems(
      matrixAttemptObservations,
      'draft-format-repair',
    );
    if (naturalFormatRepairCount > MAX_NATURAL_DRAFT_FORMAT_REPAIRS) {
      emitCanaryEvent({
        event: 'prompt-wizard-provider-canary-matrix-blocked',
        ok: false,
        reason: 'natural-format-repair-limit-exceeded',
        naturalFormatRepairCount,
        limit: MAX_NATURAL_DRAFT_FORMAT_REPAIRS,
      });
      break;
    }
  }

  const gate = evaluatePromptWizardCanaryMatrixGate({
    caseResults,
    attempts: matrixAttemptObservations,
  });
  emitCanaryEvent({
    event: 'prompt-wizard-provider-canary-summary',
    stage: 'script-matrix',
    ok: gate.ok,
    profileVersion: CANARY_PROFILE_VERSION,
    total: PROMPT_WIZARD_CANARY_CASES.length,
    passed: gate.passed,
    failed: PROMPT_WIZARD_CANARY_CASES.length - gate.passed,
    conceptGenerationBusinessItemCount: gate.conceptGenerationBusinessItemCount,
    conceptRepairBusinessItemCount: gate.conceptRepairBusinessItemCount,
    // 兼容旧日志字段，但语义已收口为 24 个首轮方案业务项，不再统计物理重试。
    initialDraftCount: gate.initialDraftBusinessItemCount,
    initialDraftBusinessItemCount: gate.initialDraftBusinessItemCount,
    initialDraftTransportAttemptCount: gate.initialDraftTransportAttemptCount,
    internalConceptCandidateCount: gate.internalConceptCandidateCount,
    selectedConceptCount: gate.selectedConceptCount,
    conceptDirectorGatePassed: gate.conceptDirectorGatePassed,
    naturalFormatRepairCount: gate.naturalFormatRepairCount,
    formatRepairTransportAttemptCount: gate.formatRepairTransportAttemptCount,
    naturalFormatRepairLimit: MAX_NATURAL_DRAFT_FORMAT_REPAIRS,
    transportFailureObserved: gate.transportFailureObserved,
    nonTransportFailureObserved: gate.nonTransportFailureObserved,
    unexplainedPhysicalAttemptObserved: gate.unexplainedPhysicalAttemptObserved,
    fullCandidateRerunAllowed: gate.fullCandidateRerunAllowed,
    repairAttemptCounts: canaryRepairAttemptCounts(matrixAttemptObservations),
  });
    return gate.ok;
  } finally {
    if (operationalObservations.length > 0) {
      const manifest = await persistPromptWizardOperationalUsage(
        operationalUsage,
        operationalObservations,
      );
      emitCanaryEvent({
        event: 'prompt-wizard-provider-canary-operational-usage',
        ok: true,
        recordCount: manifest.recordCount,
        manifestPath: manifest.manifestPath,
        manifestSha256: manifest.manifestSha256,
        evidencePath: manifest.evidencePath,
        evidenceSha256: manifest.evidenceSha256,
      });
    }
  }
}

/**
 * Canary 的业务门禁必须按“案例 + 方案索引”计算首轮方案与格式恢复数量；
 * 同一业务项的 408/429/5xx 或连接故障重试只是物理传输尝试，不能把 24
 * 误计成 25。只要本轮观察到传输故障，即使内部重试后 12/12 成功，也不把
 * 当前结果拼接为通过，而是允许对同一候选完整重跑一次。
 */
export function evaluatePromptWizardCanaryMatrixGate(input: {
  caseResults: readonly PromptWizardCanaryMatrixCaseResult[];
  attempts: readonly PromptWizardCanaryMatrixAttemptObservation[];
}): PromptWizardCanaryMatrixGateResult {
  const expectedCaseIds = new Set(PROMPT_WIZARD_CANARY_CASES.map(testCase => testCase.id));
  const passedCaseIds = new Set(input.caseResults
    .filter(result => result.ok && expectedCaseIds.has(result.id))
    .map(result => result.id));
  const passed = passedCaseIds.size;
  const conceptGenerationBusinessItemCount = countCanaryConceptBusinessItems(
    input.attempts,
    'generate-concepts',
  );
  const conceptRepairBusinessItemCount = countCanaryConceptBusinessItems(
    input.attempts,
    'repair-concept-set',
  );
  const initialDraftBusinessItemCount = countCanaryMatrixBusinessItems(
    input.attempts,
    'initial-draft',
  );
  const initialDraftTransportAttemptCount = input.attempts
    .filter(attempt => attempt.kind === 'initial-draft')
    .length;
  const internalConceptCandidateCount = input.caseResults.reduce((sum, result) => (
    sum + (result.conceptDirector?.candidateCount ?? 0)
  ), 0);
  const selectedConceptCount = input.caseResults.reduce((sum, result) => (
    sum + (result.conceptDirector?.selectedConceptCount ?? 0)
  ), 0);
  const conceptDirectorGatePassed = input.caseResults.length === PROMPT_WIZARD_CANARY_CASES.length
    && input.caseResults.every(result => (
      result.conceptDirector?.valid === true
      && result.conceptDirector.candidateCount === PROMPT_WIZARD_CONCEPT_PREVIEW_COUNT
      && result.conceptDirector.reliableCandidateCount === PROMPT_WIZARD_CONCEPT_ROLE_COUNT
      && result.conceptDirector.breakthroughCandidateCount === PROMPT_WIZARD_CONCEPT_ROLE_COUNT
      && result.conceptDirector.selectedConceptCount === PROMPT_WIZARD_PLAN_COUNT
      && result.conceptDirector.complementaryDimensions >= 4
    ))
    && internalConceptCandidateCount
      === PROMPT_WIZARD_CANARY_CASES.length * PROMPT_WIZARD_CONCEPT_PREVIEW_COUNT
    && selectedConceptCount
      === PROMPT_WIZARD_CANARY_CASES.length * PROMPT_WIZARD_PLAN_COUNT;
  const naturalFormatRepairCount = countCanaryMatrixBusinessItems(
    input.attempts,
    'draft-format-repair',
  );
  const formatRepairTransportAttemptCount = input.attempts
    .filter(attempt => attempt.kind === 'draft-format-repair')
    .length;
  const transportFailureObserved = input.attempts.some(attempt => (
    attempt.outcome === 'transport-failed'
  )) || input.caseResults.some(result => !result.ok && result.transportFailure);
  const unexplainedPhysicalAttemptObserved = hasUnexplainedCanaryPhysicalAttempts(
    input.attempts,
  );
  const nonTransportFailureObserved = unexplainedPhysicalAttemptObserved
    || input.attempts.some(attempt => (
      attempt.outcome === 'non-transport-failed'
    ))
    || input.caseResults.some(result => !result.ok && !result.transportFailure);
  const caseSetComplete = input.caseResults.length === PROMPT_WIZARD_CANARY_CASES.length
    && input.caseResults.every(result => expectedCaseIds.has(result.id))
    && new Set(input.caseResults.map(result => result.id)).size === expectedCaseIds.size
    && passed === expectedCaseIds.size;
  const businessCountsValid = initialDraftBusinessItemCount
    === PROMPT_WIZARD_CANARY_CASES.length * PROMPT_WIZARD_PLAN_COUNT
    && conceptGenerationBusinessItemCount === PROMPT_WIZARD_CANARY_CASES.length
    && conceptRepairBusinessItemCount <= PROMPT_WIZARD_CANARY_CASES.length
    && naturalFormatRepairCount <= MAX_NATURAL_DRAFT_FORMAT_REPAIRS;
  const ok = caseSetComplete
    && businessCountsValid
    && conceptDirectorGatePassed
    && !transportFailureObserved
    && !nonTransportFailureObserved;
  const fullCandidateRerunAllowed = !ok
    && transportFailureObserved
    && !nonTransportFailureObserved
    && naturalFormatRepairCount <= MAX_NATURAL_DRAFT_FORMAT_REPAIRS;

  return {
    ok,
    passed,
    conceptGenerationBusinessItemCount,
    conceptRepairBusinessItemCount,
    initialDraftBusinessItemCount,
    initialDraftTransportAttemptCount,
    internalConceptCandidateCount,
    selectedConceptCount,
    conceptDirectorGatePassed,
    naturalFormatRepairCount,
    formatRepairTransportAttemptCount,
    transportFailureObserved,
    nonTransportFailureObserved,
    unexplainedPhysicalAttemptObserved,
    fullCandidateRerunAllowed,
  };
}

export function assertPromptWizardCanaryConceptDirector(input: {
  concepts: readonly PromptWizardConceptPreview[];
  selected: ReturnType<typeof selectPromptWizardConceptPair>;
}): PromptWizardCanaryConceptDirectorObservation {
  const reliableCandidateCount = input.concepts.filter(
    concept => concept.role === 'reliable-conversion',
  ).length;
  const breakthroughCandidateCount = input.concepts.filter(
    concept => concept.role === 'creative-breakthrough',
  ).length;
  const selectedIds = new Set([
    input.selected.primaryConceptId,
    input.selected.secondaryConceptId,
  ]);
  const observation = {
    candidateCount: input.concepts.length,
    reliableCandidateCount,
    breakthroughCandidateCount,
    selectedConceptCount: selectedIds.size,
    complementaryDimensions: input.selected.complementaryDimensions,
    valid: input.concepts.length === PROMPT_WIZARD_CONCEPT_PREVIEW_COUNT
      && reliableCandidateCount === PROMPT_WIZARD_CONCEPT_ROLE_COUNT
      && breakthroughCandidateCount === PROMPT_WIZARD_CONCEPT_ROLE_COUNT
      && selectedIds.size === PROMPT_WIZARD_PLAN_COUNT
      && input.selected.primary.role === 'reliable-conversion'
      && input.selected.secondary.role === 'creative-breakthrough'
      && input.selected.complementaryDimensions >= 4,
  };
  if (!observation.valid) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_CONCEPT_DIRECTOR_INVALID',
      '创意导演未满足八条路线、双角色平衡或可信/突破互补门禁',
    );
  }
  return observation;
}

interface GenerateValidatedCanaryConceptsInput {
  provider: PromptWizardProvider;
  profile: PromptWizardProductProfile;
  evidenceGraph: PromptWizardEvidenceGraph;
  productionBrief: PromptWizardProductionBrief;
  brief: PromptWizardCreativeBrief;
  config: PromptWizardVideoConfig;
  imageCount: number;
  historicalConcepts: PromptWizardConceptPreview[];
  deadlineAtMs: number;
  costOwner?: Parameters<PromptWizardProvider['generateConcepts']>[0]['costOwner'];
}

async function generateValidatedPromptWizardCanaryConcepts(
  input: GenerateValidatedCanaryConceptsInput,
) {
  const providerInput = {
    profile: input.profile,
    evidenceGraph: input.evidenceGraph,
    productionBrief: input.productionBrief,
    brief: input.brief,
    config: input.config,
    imageCount: input.imageCount,
    historicalConcepts: input.historicalConcepts,
    deadlineAtMs: input.deadlineAtMs,
    ...(input.costOwner ? { costOwner: input.costOwner } : {}),
  } satisfies Parameters<PromptWizardProvider['generateConcepts']>[0];

  let usage: PromptWizardProviderUsage | null = null;
  try {
    const generated = await input.provider.generateConcepts(providerInput);
    usage = generated.usage;
    const concepts = assertPromptWizardConceptSet({
      concepts: generated.concepts,
      evidenceGraph: input.evidenceGraph,
      brief: input.brief,
      config: input.config,
      productionBrief: input.productionBrief,
    });
    return {
      concepts,
      selected: selectPromptWizardConceptPair(concepts),
      usage,
    };
  } catch (error) {
    usage = usage ?? promptWizardCanaryProviderUsageFromFailure(error);
    if (
      !isPromptWizardCanaryConceptRepairable(error)
      || input.deadlineAtMs - Date.now() < MIN_CONCEPT_REPAIR_BUDGET_MS
    ) throw error;

    const repaired = await input.provider.generateConcepts({
      ...providerInput,
      repairFeedback: promptWizardCanaryConceptRepairFeedback(error),
      ...(providerInput.costOwner ? {
        costOwner: { ...providerInput.costOwner, repairRound: 1 },
      } : {}),
    });
    const concepts = assertPromptWizardConceptSet({
      concepts: repaired.concepts,
      evidenceGraph: input.evidenceGraph,
      brief: input.brief,
      config: input.config,
      productionBrief: input.productionBrief,
    });
    return {
      concepts,
      selected: selectPromptWizardConceptPair(concepts),
      usage: mergeCanaryProviderUsage(usage, repaired.usage),
    };
  }
}

/**
 * Canary 固定档案必须像真实识别结果一样带字段级图片溯源。若仅传 profile 和
 * 图片数量，旧兼容逻辑会把全部档案字段都当成“可见事实”，掩盖 3.0 对证据
 * 来源、可信度和自证动作的真实约束。
 */
export function buildPromptWizardCanaryEvidenceGraph(imageCount: number) {
  const imageAssetIds = Array.from({ length: imageCount }, (_, index) => (
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
  ));
  return buildPromptWizardEvidenceGraph({
    profile: PROMPT_WIZARD_CANARY_FIXED_PROFILE,
    imageAssetIds,
    detectedEvidenceSources: [
      {
        fieldPath: 'productName',
        imageAssetIds: [imageAssetIds[0]!],
        visibleRegion: '产品主体与衣身可见文字',
        confidence: 'high',
        proofActions: ['展开短袖T恤，让完整衣身与 MEXICO 原文印花同时进入画面'],
      },
      {
        fieldPath: 'category',
        imageAssetIds: [imageAssetIds[0]!],
        visibleRegion: '产品整体轮廓',
        confidence: 'high',
        proofActions: ['用稳定全景展示短袖T恤的完整轮廓'],
      },
      {
        fieldPath: 'materials',
        imageAssetIds: [imageAssetIds[0]!],
        visibleRegion: '衣身表面',
        confidence: 'medium',
        proofActions: ['在自然光下触碰并轻弯衣身，展示纺织面料的表面状态'],
      },
      {
        fieldPath: 'structure',
        imageAssetIds: [imageAssetIds[0]!],
        visibleRegion: '领口、袖口与衣身轮廓',
        confidence: 'high',
        proofActions: ['拉开圆领并展开衣身，近景展示圆领与短袖结构'],
      },
      {
        fieldPath: 'logo',
        imageAssetIds: [imageAssetIds[0]!],
        visibleRegion: '衣身印花区域',
        confidence: 'high',
        proofActions: ['稳定特写展示衣身 MEXICO 原文印花'],
      },
      {
        fieldPath: 'usage',
        imageAssetIds: [imageAssetIds[0]!],
        visibleRegion: '产品整体版型',
        confidence: 'high',
        proofActions: ['完整拍摄一次套头穿着并拉平衣角的动作'],
      },
      ...PROMPT_WIZARD_CANARY_FIXED_PROFILE.visibleFacts.map((_, index) => ({
        fieldPath: `visibleFacts[${index}]`,
        imageAssetIds: [imageAssetIds[index % imageAssetIds.length]!],
        visibleRegion: index === 0
          ? '短袖T恤正面与背面'
          : index === 1
            ? '衣身 MEXICO 印花'
            : '领口、袖口与衣身印花',
        confidence: 'high' as const,
        proofActions: [index === 0
          ? '展开并翻转同一件短袖T恤，连续展示正面与背面'
          : index === 1
            ? '稳定近景展示衣身 MEXICO 原文印花'
            : '依次拉开领口、转动袖口并保持衣身印花在画面中'],
      })),
    ],
  });
}

function buildPromptWizardCanaryProductionBrief() {
  return buildPromptWizardProductionBrief(PROMPT_WIZARD_CANARY_FIXED_PROFILE, {
    primaryPurchaseReason: '通过可见版型、领口、袖口与 MEXICO 印花判断是否适合当前穿搭需求',
    appearanceMode: 'person',
    availableScenes: [
      '日常室内空间',
      '桌面产品展示区',
      '自然光休闲空间',
      '普通户外步行空间',
    ],
    availableAssets: [
      '产品参考图片',
      '真人出镜素材',
      '手部操作素材',
      '产品包装素材',
    ],
  });
}

function assertPromptWizardCanaryDirectionAvailable(input: {
  evidenceGraph: PromptWizardEvidenceGraph;
  productionBrief: PromptWizardProductionBrief;
  brief: PromptWizardCreativeBrief;
}) {
  const assessment = assessPromptWizardDirection({
    graph: input.evidenceGraph,
    productionBrief: input.productionBrief,
    direction: input.brief.direction,
  });
  if (assessment.availability === 'unavailable') {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_DIRECTION_UNAVAILABLE',
      `固定安全产品档案无法覆盖 ${input.brief.direction}：${assessment.reason}`,
    );
  }
}

function isPromptWizardCanaryConceptRepairable(error: unknown) {
  const code = canaryErrorCode(error);
  return code === 'PROMPT_WIZARD_CONCEPT_SET_INVALID'
    || code === 'PROMPT_WIZARD_PROVIDER_INVALID_JSON'
    || code === 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID';
}

function promptWizardCanaryConceptRepairFeedback(error: unknown) {
  const rawIssues = error && typeof error === 'object'
    ? (error as PromptWizardConceptSetValidationError).issues
    : null;
  if (Array.isArray(rawIssues) && rawIssues.length > 0) {
    return rawIssues.slice(0, 32).map(issue => (
      `${issue.fieldPath} [${issue.code}]：${promptWizardCanaryConceptRepairAction(issue.code)}`
    ));
  }
  if (canaryErrorCode(error) === 'PROMPT_WIZARD_PROVIDER_INVALID_JSON') {
    return ['上一轮不是可解析 JSON；重新生成完整八条路线，只返回严格 JSON 对象。'];
  }
  return ['上一轮未通过创意路线 Schema；重新生成完整八条路线并满足全部本地硬门禁。'];
}

function promptWizardCanaryConceptRepairAction(code: string) {
  if (code === 'ROLE_BALANCE_INVALID') return '恢复四条可信转化型与四条强钩子记忆型';
  if (code === 'FIRST_SECOND_EVENT_NOT_PHYSICAL') return '改为第一秒可拍摄的产品物理事件';
  if (code === 'FIRST_SECOND_EVENT_PRODUCT_UNCLEAR') return '让第一秒明确出现产品或具体产品问题';
  if (code === 'EVIDENCE_INVALID' || code === 'PURCHASE_REASON_EVIDENCE_MISSING') {
    return '只引用可靠 evidence ID，并让唯一购买理由连接可自证事实';
  }
  if (code === 'CTA_NOT_CALLBACK') return 'CTA 回扣开场问题或唯一购买理由';
  if (code === 'EXECUTION_BUDGET_EXCEEDED') return '压缩地点、人物、动作、道具和运镜复杂度';
  if (code === 'SCENE_UNAVAILABLE' || code === 'REQUIRED_ASSET_UNAVAILABLE') {
    return '只使用 productionBrief 已确认的场景与素材';
  }
  if (code === 'TALENT_MODE_MISMATCH') return '严格服从当前出镜方式';
  return '保持产品事实与方向不变，修复字段并返回完整八条路线';
}

function countCanaryMatrixBusinessItems(
  attempts: readonly PromptWizardCanaryMatrixAttemptObservation[],
  kind: 'initial-draft' | 'draft-format-repair',
) {
  return new Set(attempts
    .filter(attempt => attempt.kind === kind && attempt.planIndex !== null)
    .map(attempt => `${attempt.caseId}:${attempt.planIndex}`))
    .size;
}

function countCanaryConceptBusinessItems(
  attempts: readonly PromptWizardCanaryMatrixAttemptObservation[],
  kind: 'generate-concepts' | 'repair-concept-set',
) {
  return new Set(attempts
    .filter(attempt => attempt.kind === kind && attempt.planIndex === null)
    .map(attempt => attempt.caseId))
    .size;
}

function hasUnexplainedCanaryPhysicalAttempts(
  attempts: readonly PromptWizardCanaryMatrixAttemptObservation[],
) {
  if (attempts.some(attempt => (
    attempt.kind === 'other'
    || attempt.repairRound === null
    || (isCanaryConceptAttemptKind(attempt.kind)
      ? attempt.planIndex !== null
      : attempt.planIndex === null)
  ))) {
    return true;
  }
  const grouped = new Map<string, PromptWizardCanaryMatrixAttemptObservation[]>();
  attempts
    .forEach(attempt => {
      const key = `${attempt.caseId}:${attempt.kind}:${attempt.planIndex}:${attempt.repairRound ?? 'unknown'}`;
      grouped.set(key, [...(grouped.get(key) ?? []), attempt]);
    });
  return [...grouped.values()].some(entries => {
    if (entries.length <= 1) return false;
    const succeeded = entries.filter(entry => entry.outcome === 'succeeded').length;
    const transportFailed = entries.filter(entry => (
      entry.outcome === 'transport-failed'
    )).length;
    // 生产传输策略最多重试一次，因此同一业务项唯一合法的重复形状是：
    // 一次传输失败后一次成功。多于两次物理尝试、重复成功、重复传输失败，
    // 或夹杂非传输失败，都属于编排异常，不能获得“完整重跑一次”的资格。
    return entries.length !== 2
      || succeeded !== 1
      || transportFailed !== 1
      || entries.some(entry => entry.outcome === 'non-transport-failed');
  });
}

function canaryMatrixAttemptKind(
  request: ArkPromptWizardResponsesRequest,
): PromptWizardCanaryMatrixAttemptKind {
  if (
    request.text.format.name === 'prompt_wizard_concept_set'
    && isPromptWizardConceptRepairRequest(request)
  ) return 'repair-concept-set';
  return promptWizardCanaryAttemptKindForSchemaName(request.text.format.name);
}

export function promptWizardCanaryAttemptKindForSchemaName(
  schemaName: string,
): PromptWizardCanaryMatrixAttemptKind {
  if (schemaName === 'prompt_wizard_concept_set') return 'generate-concepts';
  if (/^prompt_wizard_plan_[12]$/u.test(schemaName)) return 'initial-draft';
  if (/^prompt_wizard_plan_[12]_format_repair$/u.test(schemaName)) {
    return 'draft-format-repair';
  }
  if (/^prompt_wizard_plan_[12]_initial_content_repair$/u.test(schemaName)) {
    return 'initial-content-repair';
  }
  if (/^prompt_wizard_plan_[12]_content_repair$/u.test(schemaName)) {
    return 'content-repair';
  }
  if (/^prompt_wizard_plan_[12]_content_format_repair$/u.test(schemaName)) {
    return 'content-format-repair';
  }
  return 'other';
}

function canaryMatrixOperation(
  kind: PromptWizardCanaryMatrixAttemptKind,
) {
  if (kind === 'generate-concepts') return 'generate-concepts' as const;
  if (kind === 'repair-concept-set') return 'repair-concept-set' as const;
  if (kind === 'initial-draft') return 'generate-drafts' as const;
  if (kind === 'initial-content-repair' || kind === 'content-repair') {
    return 'repair-draft-content' as const;
  }
  if (kind === 'draft-format-repair' || kind === 'content-format-repair') {
    return 'repair-draft-format' as const;
  }
  return null;
}

function isCanaryConceptAttemptKind(kind: PromptWizardCanaryMatrixAttemptKind) {
  return kind === 'generate-concepts' || kind === 'repair-concept-set';
}

function isPromptWizardConceptRepairRequest(request: ArkPromptWizardResponsesRequest) {
  if (typeof request.input !== 'string') return false;
  try {
    const parsed = JSON.parse(request.input) as { repairFeedback?: unknown };
    return Array.isArray(parsed.repairFeedback) && parsed.repairFeedback.length > 0;
  } catch {
    return false;
  }
}

function canaryMatrixPendingAttemptKey(
  caseId: string,
  operation: string,
  planIndex: number | null,
) {
  return `${caseId}:${operation}:${planIndex ?? 'null'}`;
}

function consumeCanaryMatrixRepairRound(
  pending: Map<string, Array<{ repairRound: number }>>,
  key: string,
) {
  const queue = pending.get(key) ?? [];
  const next = queue.shift();
  if (queue.length > 0) pending.set(key, queue);
  else pending.delete(key);
  if (!next || !Number.isSafeInteger(next.repairRound) || next.repairRound < 0) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_ATTEMPT_METADATA_MISSING',
      '脚本矩阵请求缺少可审计的修复轮次',
    );
  }
  return next.repairRound;
}

function safeCanaryRepairObservations(
  attempts: readonly PromptWizardCanaryMatrixAttemptObservation[],
  caseId: string,
): PromptWizardCanaryRepairObservation[] {
  return attempts.flatMap(attempt => {
    if (
      attempt.caseId !== caseId
      || attempt.planIndex === null
      || attempt.repairRound === null
    ) return [];
    const source = attempt.kind === 'initial-content-repair'
      ? 'initial-schema' as const
      : attempt.kind === 'content-repair'
        ? 'domain-validation' as const
        : attempt.kind === 'content-format-repair'
          ? 'domain-format-recovery' as const
          : null;
    return source ? [{
      source,
      planIndex: attempt.planIndex,
      repairRound: attempt.repairRound,
      outcome: attempt.outcome,
    }] : [];
  });
}

function canaryRepairAttemptCounts(
  attempts: readonly PromptWizardCanaryMatrixAttemptObservation[],
) {
  return {
    conceptSet: attempts.filter(attempt => attempt.kind === 'repair-concept-set').length,
    initialSchema: attempts.filter(attempt => attempt.kind === 'initial-content-repair').length,
    domainValidation: attempts.filter(attempt => attempt.kind === 'content-repair').length,
    domainFormatRecovery: attempts.filter(
      attempt => attempt.kind === 'content-format-repair',
    ).length,
  };
}

/**
 * 产品阶段独立覆盖一图、九图、可解析档案修复与不可解析 JSON 格式恢复。
 * 产品分析阶段不传 costOwner，并注入禁止写入的 recorder；因此探针不会访问
 * 数据库、创建 run/batch 或产生用户积分流水。脚本矩阵另用纯内存合成归属观测修复轮次。
 */
export async function runPromptWizardProductAnalysisCanary(
  images: PromptWizardImageInput[],
  responses: PromptWizardCanaryResponsesClient,
): Promise<PromptWizardProductAnalysisCanaryResult> {
  validatePromptWizardImages(images);
  if (images.length !== CANARY_IMAGE_COUNT) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_IMAGES_MISSING',
      '产品识别 canary 必须提供九张图片以覆盖一图与九图边界',
    );
  }

  const oneImage = await runNaturalProductAnalysisCanary(images.slice(0, 1), responses);
  const nineImages = await runNaturalProductAnalysisCanary(images, responses);

  const forcedInvalidCandidate = {
    ...PROMPT_WIZARD_CANARY_FIXED_PROFILE,
    colors: 'canary-must-be-cleared',
    // 产品识别边界禁止模型自行产生用户确认卖点；脚本矩阵中的人工确认事实
    // 只属于固定生产简报，不得混入识别修复探针。
    userConfirmedClaims: '',
  };
  let forcedCalls = 0;
  let delegatedRepairCalls = 0;
  const forcedRepairResponses: PromptWizardCanaryResponsesClient = {
    async create(request, options) {
      forcedCalls += 1;
      if (forcedCalls === 1) {
        if (!isProductAnalysisRequest(request)) {
          throw canaryError(
            'PROMPT_WIZARD_CANARY_REPAIR_TRIGGER_INVALID',
            '强制修复探针的首次请求不是产品识别请求',
          );
        }
        return syntheticCanaryResponse(
          request.model,
          JSON.stringify(forcedInvalidCandidate),
        );
      }

      if (!isProductRepairRequest(request) || delegatedRepairCalls > 0) {
        throw canaryError(
          'PROMPT_WIZARD_CANARY_REPAIR_CALL_INVALID',
          '强制修复探针只能执行一次产品档案修复',
        );
      }
      assertCanaryRepairRequestContainsNoImages(request, images);
      delegatedRepairCalls += 1;
      return responses.create(request, options);
    },
  };
  const repairProvider = new ArkPromptWizardProvider(
    forcedRepairResponses,
    forbiddenCanaryRequestRecorder(),
  );
  const repairResult = await repairProvider.analyzeProduct(images);
  if (
    forcedCalls !== 2
    || delegatedRepairCalls !== 1
    || repairResult.profile.colors !== ''
    || repairResult.profile.userConfirmedClaims !== ''
  ) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_REPAIR_RESULT_INVALID',
      '产品档案修复未按一次调用完成或未保持识别边界',
    );
  }

  let formatCalls = 0;
  let delegatedFormatRepairCalls = 0;
  const invalidJson = '{"productName":';
  const forcedFormatResponses: PromptWizardCanaryResponsesClient = {
    async create(request, options) {
      formatCalls += 1;
      if (formatCalls === 1) {
        if (!isProductAnalysisRequest(request)) {
          throw canaryError(
            'PROMPT_WIZARD_CANARY_FORMAT_TRIGGER_INVALID',
            '产品格式恢复探针的首次请求不是产品识别请求',
          );
        }
        return syntheticCanaryResponse(request.model, invalidJson);
      }
      if (!isProductFormatRepairRequest(request) || delegatedFormatRepairCalls > 0) {
        throw canaryError(
          'PROMPT_WIZARD_CANARY_FORMAT_REPAIR_CALL_INVALID',
          '产品格式恢复探针只能重新识别一次',
        );
      }
      assertCanaryFormatRepairResendsImages(request, images, invalidJson);
      delegatedFormatRepairCalls += 1;
      return responses.create(request, options);
    },
  };
  const formatProvider = new ArkPromptWizardProvider(
    forcedFormatResponses,
    forbiddenCanaryRequestRecorder(),
  );
  const formatResult = await formatProvider.analyzeProduct(images);
  if (formatCalls !== 2 || delegatedFormatRepairCalls !== 1) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_FORMAT_REPAIR_RESULT_INVALID',
      '产品 JSON 格式恢复未按一次重新识别完成',
    );
  }

  return {
    oneImageUsage: oneImage.result.usage,
    nineImageUsage: nineImages.result.usage,
    profileRepairUsage: repairResult.usage,
    formatRepairUsage: formatResult.usage,
    oneImageProviderCalls: oneImage.requests.length,
    nineImageProviderCalls: nineImages.requests.length,
    profileRepairProviderCalls: delegatedRepairCalls,
    formatRepairProviderCalls: delegatedFormatRepairCalls,
  };
}

export async function runPromptWizardDraftFormatRepairCanary(
  responses: PromptWizardCanaryResponsesClient,
): Promise<PromptWizardDraftFormatCanaryResult> {
  const testCase = PROMPT_WIZARD_CANARY_CASES[0]!;
  const requests: ArkPromptWizardResponsesRequest[] = [];
  const transportFailures: unknown[] = [];
  let injected = false;
  const invalidJson = '{"name":';
  const injectedResponses: PromptWizardCanaryResponsesClient = {
    async create(request, options) {
      requests.push(request);
      if (request.text.format.name === 'prompt_wizard_plan_2' && !injected) {
        injected = true;
        return syntheticCanaryResponse(request.model, invalidJson);
      }
      try {
        return await responses.create(request, options);
      } catch (error) {
        if (isCanaryTransportFailure(error)) transportFailures.push(error);
        throw error;
      }
    },
  };
  const provider = new ArkPromptWizardProvider(
    injectedResponses,
    forbiddenCanaryRequestRecorder(),
  );
  const evidenceGraph = buildPromptWizardCanaryEvidenceGraph(testCase.imageCount);
  const productionBrief = buildPromptWizardCanaryProductionBrief();
  const deadlineAtMs = Date.now() + env.PROMPT_WIZARD_BATCH_BUDGET_MS;
  assertPromptWizardCanaryDirectionAvailable({
    evidenceGraph,
    productionBrief,
    brief: testCase.brief,
  });
  const generatedConcepts = await generateValidatedPromptWizardCanaryConcepts({
    provider,
    profile: PROMPT_WIZARD_CANARY_FIXED_PROFILE,
    evidenceGraph,
    productionBrief,
    brief: testCase.brief,
    config: testCase.config,
    imageCount: testCase.imageCount,
    historicalConcepts: [],
    deadlineAtMs,
  });
  const conceptPreviews = [
    generatedConcepts.selected.primary,
    generatedConcepts.selected.secondary,
  ];
  assertPromptWizardCanaryConceptDirector({
    concepts: generatedConcepts.concepts,
    selected: generatedConcepts.selected,
  });
  const strategies = conceptPreviews.map(concept => concept.strategy);
  const conceptAssignments = conceptPreviews.map((concept, planIndex) => (
    conceptPreviewToAssignment(concept, PROMPT_WIZARD_LEGACY_PLAN_INDEXES[planIndex]!)
  ));
  const generated = await generateValidatedPromptWizardPlans({
    provider,
    profile: PROMPT_WIZARD_CANARY_FIXED_PROFILE,
    evidenceGraph,
    brief: testCase.brief,
    config: testCase.config,
    strategies,
    conceptAssignments,
    conceptPreviews,
    imageCount: testCase.imageCount,
    variationKey: 1,
    deadlineAtMs,
    historicalPlans: [],
  });

  if (transportFailures.length > 0) {
    throw canaryTransportRetryObservedError(
      '单方案格式恢复阶段',
      transportFailures[0],
    );
  }

  const initialPlanIndexes = requests
    .filter(isDraftGenerationRequest)
    .map(draftRequestPlanIndex)
    .sort((left, right) => left - right);
  const repairedPlanIndexes = requests
    .filter(isDraftFormatRepairRequest)
    .map(draftRequestPlanIndex)
    .sort((left, right) => left - right);
  const allPlanRequestCounts = PROMPT_WIZARD_LEGACY_PLAN_INDEXES.map(planIndex => requests.filter(request => (
    /^prompt_wizard_plan_[12](?:_.+)?$/u.test(request.text.format.name)
      && draftRequestPlanIndex(request) === planIndex
  )).length);
  if (
    !injected
    || initialPlanIndexes.join(',') !== PROMPT_WIZARD_LEGACY_PLAN_INDEXES.join(',')
    || repairedPlanIndexes.join(',') !== '1'
    || allPlanRequestCounts.join(',') !== '1,2'
  ) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_DRAFT_FORMAT_TARGET_INVALID',
      '单方案坏 JSON 探针没有只重发方案 2，或合格方案发生了额外重发',
    );
  }
  assertDraftFormatRepairKeepsAssignment(requests, 1, invalidJson);

  return {
    plans: generated.plans,
    usage: mergeCanaryProviderUsage(generatedConcepts.usage, generated.usage),
    initialPlanIndexes,
    repairedPlanIndexes,
  };
}

async function runNaturalProductAnalysisCanary(
  images: PromptWizardImageInput[],
  responses: PromptWizardCanaryResponsesClient,
) {
  const requests: ArkPromptWizardResponsesRequest[] = [];
  const transportFailures: unknown[] = [];
  const recordingResponses: PromptWizardCanaryResponsesClient = {
    async create(request, options) {
      requests.push(request);
      try {
        return await responses.create(request, options);
      } catch (error) {
        if (isCanaryTransportFailure(error)) transportFailures.push(error);
        throw error;
      }
    },
  };
  const result = await new ArkPromptWizardProvider(
    recordingResponses,
    forbiddenCanaryRequestRecorder(),
  ).analyzeProduct(images);
  if (transportFailures.length > 0) {
    throw canaryTransportRetryObservedError(
      images.length === 1 ? '一图产品识别阶段' : '九图产品识别阶段',
      transportFailures[0],
    );
  }
  if (requests.length < 1 || !isProductAnalysisRequest(requests[0]!)) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_PRODUCT_ANALYSIS_INVALID',
      '真实产品识别未按产品分析协议发起',
    );
  }
  return { result, requests };
}

export function observePromptWizardProviderCalls(
  responses: PromptWizardCanaryResponsesClient,
  observations: PromptWizardOperationalUsageObservation[],
): PromptWizardCanaryResponsesClient {
  return {
    async create(request, options) {
      const occurredAt = new Date().toISOString();
      const operation = request.text.format.name;
      try {
        const result = await responses.create(request, options);
        observations.push({
          operation,
          occurredAt,
          model: result.model || request.model,
          status: 'success',
          providerRequestId: result.providerRequestId,
          providerResponseId: result.id,
          xTtLogId: result.xTtLogId,
          serviceTier: result.service_tier ?? request.service_tier,
          inputTokens: result.usage.input_tokens,
          cachedInputTokens: result.usage.cached_input_tokens,
          outputTokens: result.usage.output_tokens,
          errorCode: null,
        });
        return result;
      } catch (error) {
        // 该 observer 必须紧贴 Ark Responses client、位于费用预算 guard 内侧。
        // 一旦进入 delegate.create，就已经越过 Provider 前本地门禁；即使 DNS、
        // TCP 或流读取异常导致拿不到上游 ID，也要留下 missing-evidence 事实，
        // 不能让“提交状态未知”的真实网络尝试从运营账本消失。
        if (error instanceof ArkPromptWizardResponsesError) {
          const providerError = error as ArkPromptWizardResponsesError;
          observations.push({
            operation,
            occurredAt,
            model: providerError.model ?? request.model,
            status: promptWizardErrorProvesProviderReached(providerError)
              ? 'failed'
              : 'unknown',
            providerRequestId: providerError.providerRequestId,
            providerResponseId: providerError.responseId,
            xTtLogId: providerError.xTtLogId,
            serviceTier: request.service_tier,
            inputTokens: providerError.usage.input_tokens,
            cachedInputTokens: providerError.usage.cached_input_tokens,
            outputTokens: providerError.usage.output_tokens,
            errorCode: providerError.code,
          });
        }
        throw error;
      }
    },
  };
}

function promptWizardErrorProvesProviderReached(error: unknown): error is ArkPromptWizardResponsesError {
  return error instanceof ArkPromptWizardResponsesError && (
    error.providerRequestId !== null
    || error.xTtLogId !== null
    || error.httpStatus !== null
    || error.receivedBytes > 0
    || error.receivedEvent
  );
}

export async function persistPromptWizardOperationalUsage(
  config: ProviderOperationalUsageManifestRuntimeConfig,
  observations: PromptWizardOperationalUsageObservation[],
) {
  return writeProviderOperationalUsageCanaryBundle({
    manifestPath: config.outputPath,
    manifestId: `${config.sourceRunId}-provider-operational-usage-v1`,
    evidence: {
      evidenceKind: 'prompt-wizard-provider-canary-observations/v1',
      sourceRunId: config.sourceRunId,
      observations: observations.map((observation, index) => ({
        sequence: index + 1,
        ...observation,
      })),
    },
    buildRecords: evidence => observations.map((observation, index) => (
      promptWizardProviderCanaryOperationalUsageRecord({
        costOwnerUserId: config.costOwnerUserId,
        sourceRunId: config.sourceRunId,
        sourceItemKey: `request-${String(index + 1).padStart(4, '0')}`,
        occurredAt: observation.occurredAt,
        evidencePath: evidence.evidencePath,
        evidenceSha256: evidence.evidenceSha256,
        operation: observation.operation,
        providerRequestId: observation.providerRequestId,
        providerResponseId: observation.providerResponseId,
        xTtLogId: observation.xTtLogId,
        model: observation.model,
        status: observation.status,
        serviceTier: observation.serviceTier,
        inputTokens: observation.inputTokens,
        cachedInputTokens: observation.cachedInputTokens,
        outputTokens: observation.outputTokens,
      })
    )),
  });
}

function createPromptWizardCanaryResponsesClient(): ArkPromptWizardResponsesClient {
  const apiKey = env.ARK_PROMPT_WIZARD_API_KEY ?? env.ARK_API_KEY;
  if (!apiKey) {
    throw canaryError(
      'PROMPT_WIZARD_PROVIDER_NOT_CONFIGURED',
      '提示词向导未配置火山方舟 API Key',
    );
  }
  return new ArkPromptWizardResponsesClient({
    apiKey,
    baseUrl: env.ARK_BASE_URL,
  });
}

function forbiddenCanaryRequestRecorder(): PromptWizardProviderRequestRecorder {
  return {
    async beginAttempt() {
      throw canaryError(
        'PROMPT_WIZARD_CANARY_DATABASE_ACCESS_FORBIDDEN',
        'Provider-only canary 禁止写入数据库',
      );
    },
    async completeAttempt() {
      throw canaryError(
        'PROMPT_WIZARD_CANARY_DATABASE_ACCESS_FORBIDDEN',
        'Provider-only canary 禁止写入数据库',
      );
    },
  };
}

function isProductAnalysisRequest(request: ArkPromptWizardResponsesRequest) {
  return request.text.format.name === 'prompt_wizard_product_profile';
}

function isProductRepairRequest(request: ArkPromptWizardResponsesRequest) {
  return request.text.format.name === 'prompt_wizard_product_profile_repair';
}

function isProductFormatRepairRequest(request: ArkPromptWizardResponsesRequest) {
  return request.text.format.name === 'prompt_wizard_product_profile_format_repair';
}

function isDraftGenerationRequest(request: ArkPromptWizardResponsesRequest) {
  return /^prompt_wizard_plan_[12]$/u.test(request.text.format.name);
}

function isDraftFormatRepairRequest(request: ArkPromptWizardResponsesRequest) {
  return /^prompt_wizard_plan_[12]_format_repair$/u.test(request.text.format.name);
}

function draftRequestPlanIndex(request: ArkPromptWizardResponsesRequest) {
  const match = request.text.format.name.match(/^prompt_wizard_plan_([12])/u);
  if (!match) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_DRAFT_REQUEST_INVALID',
      '脚本请求缺少可识别的方案索引',
    );
  }
  return Number(match[1]) - 1;
}

function assertCanaryRepairRequestContainsNoImages(
  request: ArkPromptWizardResponsesRequest,
  images: PromptWizardImageInput[],
) {
  const serializedInput = JSON.stringify(request.input);
  if (
    serializedInput.includes('"input_image"')
    || images.some(image => serializedInput.includes(image.url))
  ) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_REPAIR_CONTAINS_IMAGE',
      '产品档案修复请求不得携带图片或临时读取地址',
    );
  }
}

function assertCanaryFormatRepairResendsImages(
  request: ArkPromptWizardResponsesRequest,
  images: PromptWizardImageInput[],
  invalidJson: string,
) {
  const serializedInput = JSON.stringify(request.input);
  if (
    !serializedInput.includes('"input_image"')
    || images.some(image => !serializedInput.includes(image.url))
    || serializedInput.includes(invalidJson)
  ) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_FORMAT_REPAIR_INPUT_INVALID',
      '产品格式恢复必须重发原图且不得携带无法解析的正文',
    );
  }
}

function assertDraftFormatRepairKeepsAssignment(
  requests: ArkPromptWizardResponsesRequest[],
  planIndex: number,
  invalidJson: string,
) {
  const initial = requests.find(request => (
    request.text.format.name === `prompt_wizard_plan_${planIndex + 1}`
  ));
  const repaired = requests.find(request => (
    request.text.format.name === `prompt_wizard_plan_${planIndex + 1}_format_repair`
  ));
  if (!initial || !repaired) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_DRAFT_FORMAT_ASSIGNMENT_MISSING',
      '缺少方案格式恢复前后的请求',
    );
  }
  const initialInput = parseCanaryRequestInput(initial.input);
  const repairedInput = parseCanaryRequestInput(repaired.input);
  const stableFields = [
    'planIndex',
    'assignedStrategy',
    'assignedConcept',
    'assignedEvidence',
    'fixedVideoConfig',
    'imageReferences',
  ] as const;
  if (
    stableFields.some(field => (
      JSON.stringify(initialInput[field]) !== JSON.stringify(repairedInput[field])
    ))
    || JSON.stringify(repaired.input).includes(invalidJson)
  ) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_DRAFT_FORMAT_ASSIGNMENT_CHANGED',
      '单方案格式恢复改变了策略、事实、配置、图片引用或携带了坏正文',
    );
  }
}

function parseCanaryRequestInput(input: unknown): Record<string, unknown> {
  if (typeof input !== 'string') {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_REQUEST_INPUT_INVALID',
      '脚本请求必须使用结构化文本输入',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_REQUEST_INPUT_INVALID',
      '脚本请求输入不是有效 JSON',
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_REQUEST_INPUT_INVALID',
      '脚本请求输入必须是 JSON 对象',
    );
  }
  return parsed as Record<string, unknown>;
}

function syntheticCanaryResponse(
  model: string,
  outputText: string,
): ArkPromptWizardResponsesResult {
  return {
    id: 'provider-canary-synthetic-invalid-product',
    model,
    service_tier: PROMPT_WIZARD_SERVICE_TIER,
    output_text: outputText,
    usage: {
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
    },
    providerRequestId: null,
    xTtLogId: null,
    httpStatus: 200,
    receivedBytes: Buffer.byteLength(outputText, 'utf8'),
    receivedEvent: true,
  };
}

function safeCanaryUsage(usage: PromptWizardProviderUsage) {
  return {
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    serviceTier: usage.serviceTier,
    requestAttempts: usage.requestAttempts,
  };
}

export function parsePromptWizardCanaryImages(rawValue: string | undefined): PromptWizardImageInput[] {
  if (!rawValue?.trim()) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_IMAGES_MISSING',
      `${CANARY_IMAGES_ENV} 必须提供九张临时可访问的产品图片`,
    );
  }
  if (Buffer.byteLength(rawValue, 'utf8') > 128 * 1024) {
    throw canaryError('PROMPT_WIZARD_CANARY_IMAGES_INVALID', '图片输入 JSON 过长');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw canaryError('PROMPT_WIZARD_CANARY_IMAGES_INVALID', '图片输入不是有效 JSON');
  }

  const result = canaryImagesSchema.safeParse(parsed);
  if (!result.success) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_IMAGES_INVALID',
      '图片输入必须是九个严格的 name/url/mimeType/sizeBytes 对象',
    );
  }
  const duplicateUrls = new Set(result.data.map(image => image.url)).size !== result.data.length;
  if (duplicateUrls) {
    throw canaryError('PROMPT_WIZARD_CANARY_IMAGES_INVALID', '九张图片必须使用不同读取地址');
  }
  const normalizedImages = result.data.map((image, index) => ({
    ...image,
    // 文件名只用于区分图片；统一改为不可注入指令的内部名称。
    name: `canary-image-${index + 1}.${canaryImageExtension(image.mimeType)}`,
  }));
  validatePromptWizardImages(normalizedImages);
  normalizedImages.forEach((image, index) => assertSafeCanaryUrl(image.url, index));
  return normalizedImages;
}

export function redactCanaryError(error: unknown) {
  let current = error;
  const seen = new Set<unknown>();
  let errorCode = 'UNKNOWN';
  let errorClass = 'UnknownError';
  let httpStatus: number | null = null;
  const fieldPaths: string[] = [];
  const planIndexes: number[] = [];
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof Error && errorClass === 'UnknownError') {
      errorClass = sanitizeMetadata(current.name, 'UnknownError');
    }
    if (typeof current !== 'object' || current === null) break;
    const candidate = current as {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
      httpStatus?: unknown;
      fieldPaths?: unknown;
      planIndexes?: unknown;
      cause?: unknown;
    };
    if (errorCode === 'UNKNOWN' && typeof candidate.code === 'string') {
      errorCode = sanitizeMetadata(candidate.code, 'UNKNOWN').toUpperCase();
    }
    const status = [candidate.httpStatus, candidate.status, candidate.statusCode]
      .find(value => typeof value === 'number' && Number.isInteger(value));
    if (httpStatus === null && typeof status === 'number') httpStatus = status;
    if (Array.isArray(candidate.fieldPaths)) {
      candidate.fieldPaths.forEach(value => {
        if (
          typeof value === 'string'
          && isCanaryLogFieldPath(value)
          && !fieldPaths.includes(value)
          && fieldPaths.length < 20
        ) {
          fieldPaths.push(value);
        }
      });
    }
    if (Array.isArray(candidate.planIndexes)) {
      candidate.planIndexes.forEach(value => {
        if (
          (value === 0 || value === 1 || value === 2)
          && !planIndexes.includes(value)
        ) {
          planIndexes.push(value);
        }
      });
    }
    current = candidate.cause;
  }
  return {
    errorCode,
    errorClass,
    httpStatus,
    ...(fieldPaths.length > 0 ? { fieldPaths } : {}),
    ...(planIndexes.length > 0 ? { planIndexes } : {}),
  };
}

async function assertCanaryImagesReachable(images: PromptWizardImageInput[]) {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(IMAGE_PREFLIGHT_CONCURRENCY, images.length) },
    async () => {
      while (cursor < images.length) {
        const index = cursor;
        cursor += 1;
        await assertCanaryImageReachable(images[index]!.url, index);
      }
    },
  );
  await Promise.all(workers);
}

async function assertCanaryImageReachable(initialUrl: string, imageIndex: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_PREFLIGHT_TIMEOUT_MS);
  let currentUrl = initialUrl;
  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      assertSafeCanaryUrl(currentUrl, imageIndex);
      await assertPublicCanaryHost(currentUrl, imageIndex);
      const response = await fetch(currentUrl, {
        method: 'GET',
        headers: { range: 'bytes=0-0' },
        redirect: 'manual',
        signal: controller.signal,
      });
      await response.body?.cancel().catch(() => undefined);
      if (response.status >= 200 && response.status < 300) return;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirectCount === MAX_REDIRECTS) break;
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      break;
    }
  } catch (cause) {
    if (canaryErrorCode(cause) === 'PROMPT_WIZARD_CANARY_IMAGE_URL_UNSAFE') throw cause;
    throw Object.assign(
      canaryError(
        'PROMPT_WIZARD_CANARY_IMAGE_UNREACHABLE',
        `图片 ${imageIndex + 1} 的临时读取地址不可访问`,
      ),
      { cause },
    );
  } finally {
    clearTimeout(timeout);
  }
  throw canaryError(
    'PROMPT_WIZARD_CANARY_IMAGE_UNREACHABLE',
    `图片 ${imageIndex + 1} 的临时读取地址不可访问`,
  );
}

async function assertPublicCanaryHost(rawUrl: string, imageIndex: number) {
  const url = new URL(rawUrl);
  const literalVersion = isIP(url.hostname);
  if (literalVersion > 0 && isPrivateAddress(url.hostname)) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_IMAGE_URL_UNSAFE',
      `图片 ${imageIndex + 1} 不能使用私有网络地址`,
    );
  }
  if (literalVersion > 0) return;

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch (cause) {
    throw Object.assign(
      canaryError(
        'PROMPT_WIZARD_CANARY_IMAGE_UNREACHABLE',
        `图片 ${imageIndex + 1} 的域名无法解析`,
      ),
      { cause },
    );
  }
  if (addresses.length === 0 || addresses.some(address => isPrivateAddress(address.address))) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_IMAGE_URL_UNSAFE',
      `图片 ${imageIndex + 1} 不能解析到私有网络地址`,
    );
  }
}

function assertSafeCanaryUrl(rawUrl: string, imageIndex: number) {
  const url = new URL(rawUrl);
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.hostname === 'localhost'
    || url.hostname.endsWith('.localhost')
    || url.hostname.endsWith('.local')
  ) {
    throw canaryError(
      'PROMPT_WIZARD_CANARY_IMAGE_URL_UNSAFE',
      `图片 ${imageIndex + 1} 必须使用无用户信息的公网 HTTPS 地址`,
    );
  }
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/gu, '');
  if (normalized.includes(':')) {
    if (normalized === '::' || normalized === '::1') return true;
    if (/^(?:fc|fd)/u.test(normalized)) return true;
    if (/^fe[89ab]/u.test(normalized)) return true;
    const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
    return mappedIpv4 ? isPrivateAddress(mappedIpv4) : false;
  }

  const octets = normalized.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    return true;
  }
  const [first, second] = octets as [number, number, number, number];
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function canaryImageExtension(mimeType: PromptWizardImageInput['mimeType']) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  return 'webp';
}

function canaryCase(
  id: string,
  imageCount: 1 | 9,
  durationSeconds: 5 | 10 | 15,
  targetLanguage: string,
  direction: PromptWizardCreativeBrief['direction'],
  marketingGoal: PromptWizardCreativeBrief['marketingGoal'],
  creativeIntensity: PromptWizardCreativeBrief['creativeIntensity'],
): PromptWizardCanaryCase {
  return {
    id,
    imageCount,
    brief: { targetLanguage, direction, marketingGoal, creativeIntensity, confirmedOffer: '' },
    config: {
      model: 'seedance-2.0',
      aspectRatio: '9:16',
      resolution: '720p',
      durationSeconds,
    },
  };
}

function emptyUsage(): UsageAccumulator {
  return {
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    serviceTier: null,
    requestAttempts: 0,
  };
}

function appendUsage(accumulator: UsageAccumulator, usage: PromptWizardProviderUsage) {
  accumulator.model = usage.model;
  accumulator.inputTokens = sumNullableUsage(accumulator.inputTokens, usage.inputTokens);
  accumulator.outputTokens = sumNullableUsage(accumulator.outputTokens, usage.outputTokens);
  accumulator.serviceTier = accumulator.serviceTier === 'fast' || usage.serviceTier === 'fast'
    ? 'fast'
    : accumulator.serviceTier ?? usage.serviceTier;
  accumulator.requestAttempts += usage.requestAttempts;
}

function appendFailureUsage(accumulator: UsageAccumulator, error: unknown) {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== 'object') break;
    const candidate = current as {
      model?: unknown;
      serviceTier?: unknown;
      requestAttempts?: unknown;
      usage?: unknown;
      cause?: unknown;
    };
    if (candidate.usage && typeof candidate.usage === 'object') {
      const failureUsage = candidate.usage as {
        input_tokens?: unknown;
        output_tokens?: unknown;
      };
      const inputTokens = typeof failureUsage.input_tokens === 'number'
        ? failureUsage.input_tokens
        : null;
      const outputTokens = typeof failureUsage.output_tokens === 'number'
        ? failureUsage.output_tokens
        : null;
      accumulator.model = candidate.model === env.ARK_PROMPT_WIZARD_MODEL
        ? env.ARK_PROMPT_WIZARD_MODEL
        : accumulator.model;
      accumulator.inputTokens = sumNullableUsage(accumulator.inputTokens, inputTokens);
      accumulator.outputTokens = sumNullableUsage(accumulator.outputTokens, outputTokens);
      if (candidate.serviceTier === 'default' || candidate.serviceTier === 'fast') {
        accumulator.serviceTier = accumulator.serviceTier === 'fast' || candidate.serviceTier === 'fast'
          ? 'fast'
          : accumulator.serviceTier ?? candidate.serviceTier;
      }
      if (typeof candidate.requestAttempts === 'number' && Number.isInteger(candidate.requestAttempts)) {
        accumulator.requestAttempts += Math.max(0, candidate.requestAttempts);
      }
      return;
    }
    current = candidate.cause;
  }
}

function promptWizardCanaryProviderUsageFromFailure(
  error: unknown,
): PromptWizardProviderUsage | null {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== 'object') break;
    const candidate = current as {
      model?: unknown;
      responseId?: unknown;
      serviceTier?: unknown;
      requestAttempts?: unknown;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
      cause?: unknown;
    };
    if (candidate.usage && typeof candidate.usage === 'object') {
      return {
        interactionId: typeof candidate.responseId === 'string' ? candidate.responseId : null,
        model: typeof candidate.model === 'string'
          ? candidate.model
          : env.ARK_PROMPT_WIZARD_MODEL,
        inputTokens: typeof candidate.usage.input_tokens === 'number'
          ? candidate.usage.input_tokens
          : null,
        outputTokens: typeof candidate.usage.output_tokens === 'number'
          ? candidate.usage.output_tokens
          : null,
        serviceTier: candidate.serviceTier === 'fast' ? 'fast' : 'default',
        requestAttempts: typeof candidate.requestAttempts === 'number'
          && Number.isSafeInteger(candidate.requestAttempts)
          ? Math.max(0, candidate.requestAttempts)
          : 1,
      };
    }
    current = candidate.cause;
  }
  return null;
}

function mergeCanaryProviderUsage(
  left: PromptWizardProviderUsage | null,
  right: PromptWizardProviderUsage,
): PromptWizardProviderUsage {
  if (!left) return right;
  return {
    interactionId: right.interactionId ?? left.interactionId,
    model: right.model,
    inputTokens: sumNullableUsage(left.inputTokens, right.inputTokens),
    outputTokens: sumNullableUsage(left.outputTokens, right.outputTokens),
    serviceTier: left.serviceTier === 'fast' || right.serviceTier === 'fast'
      ? 'fast'
      : right.serviceTier ?? left.serviceTier,
    requestAttempts: left.requestAttempts + right.requestAttempts,
  };
}

function sumNullableUsage(current: number | null, next: number | null) {
  return current === null || next === null ? null : current + next;
}

export function promptWizardCanaryRepairFeedback(error: unknown) {
  const code = canaryErrorCode(error);
  if (code === 'PROMPT_WIZARD_TIMELINE_INVALID') return '镜头数量与固定时长不匹配，请严格按 requiredSegmentCount 返回';
  if (code === 'PROMPT_WIZARD_BEAT_INVALID') return '镜头职责与固定脚本结构不匹配，请严格按 requiredShotRoles 的顺序返回';
  if (code === 'PROMPT_WIZARD_EVIDENCE_INVALID') return '产品自证引用无法追溯；proofPoints 必须逐字取自 evidenceCatalog.text，相关镜头只能引用 evidenceCatalog.id';
  if (code === 'PROMPT_WIZARD_REFERENCE_INVALID') return '出现不存在的图片编号，只能使用 imageReferences 中的编号';
  if (code === 'PROMPT_WIZARD_REFERENCE_MODE_INVALID') return '出现首尾帧语义，必须全部删除';
  if (code === 'PROMPT_WIZARD_UNCONFIRMED_CLAIM') {
    const fieldPaths = canarySafeFieldPaths(error);
    const fields = fieldPaths.length > 0
      ? fieldPaths.join('、')
      : '未提供可安全定位的字段路径，请检查方案中的商业事实字段';
    return `以下安全字段路径包含未经用户确认的商业事实：${fields}；必须删除所有未经用户确认的金额、百分比、带单位数字、认证、性能、功效、绝对保证、竞品结论或用户评价；不得替换为其他数字或更强结论；不要新增事实`;
  }
  if (code === 'PROMPT_WIZARD_UNSAFE_CONTENT') return '出现不安全或无依据内容，必须改为可观察的真实动作';
  if (code === 'PROMPT_WIZARD_PROMPT_TOO_LONG') return '镜头描述过长，请压缩内容但保留两套差异';
  if (code === 'PROMPT_WIZARD_TRANSLATION_INVALID') return '口播缺少忠实的简体中文翻译，请只补齐译文，不新增事实';
  if (code === 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID') {
    const fieldPaths = canarySafeFieldPaths(error);
    const fields = fieldPaths.length > 0 ? fieldPaths.join('、') : '方案元数据、脚本预审或结构化画面';
    return `以下字段必须改为以简体中文为主：${fields}；targetLanguage 只适用于 voiceover；保留产品事实和图片引用`;
  }
  return '结构或差异校验失败，请定向重写被指出的方案，不要只替换同义词';
}

function canarySafeFieldPaths(error: unknown) {
  if (!error || typeof error !== 'object') return [];
  const paths = (error as { fieldPaths?: unknown }).fieldPaths;
  if (!Array.isArray(paths)) return [];
  const result: string[] = [];
  paths.forEach(fieldPath => {
    if (
      typeof fieldPath === 'string'
      && isCanaryRepairFieldPath(fieldPath)
      && !result.includes(fieldPath)
      && result.length < 20
    ) {
      result.push(fieldPath);
    }
  });
  return result;
}

function isCanaryRepairFieldPath(value: string) {
  return /^(?:name|hook|narrative|primaryScene|cameraAndPacing|differenceTags\[\d{1,2}\]|planningReview\.(?:targetAudience|surfaceNeed|realPainPoint|nonAdEntry|directionFit|proofPoints\[\d{1,2}\])|segments\[\d{1,2}\]\.(?:role|location|subject|shotSize|action|cameraMovement|lightingAndRealism|voiceover|voiceoverZh|foley|editingCue|evidenceRefs(?:\[\d{1,2}\])?|productionNote)|productionWarnings\[\d{1,2}\])$/u.test(value);
}

function isCanaryLogFieldPath(value: string) {
  return isCanaryRepairFieldPath(value)
    || /^(?:productName|category|colors|materials|structure|logo|usage|suggestedAudience|suggestedScenarios|userConfirmedClaims|consistencyConstraints|visibleFacts\[\d{1,2}\]|needsConfirmation\[\d{1,2}\]|planningReview|segments|productionWarnings)$/u.test(value);
}

function canaryErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') return code.toUpperCase();
  return error instanceof Error ? error.name.toUpperCase() : 'UNKNOWN';
}

export function promptWizardCanaryObservedRepairRounds(error: unknown, fallback: number) {
  if (!error || typeof error !== 'object') return fallback;
  const value = (error as { repairRounds?: unknown }).repairRounds;
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 2
    ? value
    : fallback;
}

function isCanaryTransportFailure(error: unknown) {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 6 && !seen.has(current); depth += 1) {
    seen.add(current);
    const code = canaryErrorCode(current);
    if (
      code === 'PROMPT_WIZARD_PROVIDER_CONNECTION_ERROR'
      || code === 'ECONNRESET'
      || code === 'ECONNREFUSED'
      || code === 'ENOTFOUND'
      || code === 'EAI_AGAIN'
    ) return true;
    if (typeof current !== 'object' || current === null) break;
    const candidate = current as {
      httpStatus?: unknown;
      status?: unknown;
      statusCode?: unknown;
      cause?: unknown;
    };
    const status = [candidate.httpStatus, candidate.status, candidate.statusCode]
      .find(value => typeof value === 'number' && Number.isInteger(value));
    if (
      status === 408
      || status === 429
      || (typeof status === 'number' && status >= 500 && status <= 599)
    ) return true;
    current = candidate.cause;
  }
  return false;
}

function sanitizeMetadata(value: string, fallback: string) {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/gu, '').slice(0, 80);
  return sanitized || fallback;
}

function canaryError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function canaryTransportRetryObservedError(stage: string, cause: unknown) {
  return Object.assign(
    canaryError(
      'PROMPT_WIZARD_CANARY_TRANSPORT_RETRY_OBSERVED',
      `${stage}发生了 Provider 传输故障；当前运行不追认为通过，只允许冷却后完整重跑一次`,
    ),
    { cause },
  );
}

function emitCanaryEvent(event: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main() {
  try {
    const success = await runPromptWizardProviderCanary();
    if (!success) process.exitCode = 1;
  } catch (error) {
    emitCanaryEvent({
      event: 'prompt-wizard-provider-canary-aborted',
      ok: false,
      fullCandidateRerunAllowed: isCanaryTransportFailure(error),
      error: redactCanaryError(error),
    });
    process.exitCode = 1;
  }
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry!) === fileURLToPath(import.meta.url);
}

if (isMainModule()) void main();
