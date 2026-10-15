import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PromptWizardAudioMode,
  PromptWizardPlanV6,
  PromptWizardProductFamily,
  PromptWizardProductProfile,
  PromptWizardRouteSetV6,
  PromptWizardVideoConfig,
} from '@lindyson/api-contracts';
import { env } from '../config/env.js';
import { buildPromptWizardEvidenceGraph } from '../domain/promptWizardEvidenceGraph.js';
import {
  assertPromptWizardConversionCta,
  assertPromptWizardMotionDensity,
  assertPromptWizardSoundDesignOnlyVisualClosure,
  assertPromptWizardVoiceoverCoverage,
  promptWizardContainsStaticInstruction,
} from '../domain/promptWizardConversionQuality.js';
import {
  assertPromptWizardExecutionPromptIsolation,
  PROMPT_WIZARD_SOUND_DESIGN_ONLY_INSTRUCTION,
} from '../domain/promptWizardPrompt.js';
import {
  ArkPromptWizardProvider,
  type PromptWizardProvider,
  type PromptWizardOutputDiagnostic,
} from '../providers/promptWizardProvider.js';
import { ArkPromptWizardResponsesClient } from '../providers/arkPromptWizardResponsesClient.js';
import {
  generateValidatedPromptWizardRoutePlansV6,
  type PromptWizardV6PlanRequestCounts,
} from '../domain/promptWizardService.js';
import { buildPromptWizardProductionBrief } from '../domain/promptWizardCreativePlaybook.js';
import {
  buildPromptWizardRouteSetV6,
  PROMPT_WIZARD_V6_ROUTE_ROLES,
} from '../domain/promptWizardV6Routes.js';
import {
  isPromptWizardCanarySafeFieldPath,
  normalizePromptWizardCanaryOutputDiagnostics,
} from './promptWizardCanarySafeEvidence.js';

const MAX_DIRECTION_P95_MS = 30_000;
const MAX_DRAFT_P95_MS = 180_000;
const MAX_CONTENT_REPAIR_REQUESTS_PER_BATCH = 6;
const MAX_CONTENT_REPAIR_REQUESTS_PER_PLAN = 2;
const PROMPT_WIZARD_CANARY_EXPECTED_PLAN_COUNT = 45;
export const PROMPT_WIZARD_ATTEMPT26_GLOBAL_PHYSICAL_REQUEST_LIMIT = 210;
const PROMPT_WIZARD_ATTEMPT26_PHYSICAL_REQUEST_EVENT =
  'prompt-wizard-attempt26-physical-request-counts';

const PROMPT_WIZARD_CANARY_PROTOCOL_EVENTS = new Set([
  'prompt-wizard-v6-canary-initial-provider-identity',
  'prompt-wizard-v6-canary-output-diagnostics',
  'prompt-wizard-v6-canary-repair-diagnostics',
  'prompt-wizard-v6-canary-batch',
  'prompt-wizard-v6-canary-completed',
  'prompt-wizard-v6-canary-aborted',
]);

export type PromptWizardRepairDiagnosticOrigin =
  | 'initial-schema'
  | 'domain-validation'
  | 'terminal-calibration';

export interface PromptWizardRepairDiagnostic {
  planIndex: 0 | 1 | 2;
  origin: PromptWizardRepairDiagnosticOrigin;
  repairRound: 1 | 2 | 3;
  errorCode: string;
  fieldPaths: string[];
}

export interface UseDirectionCanaryCase {
  id: string;
  expectedFamily: PromptWizardProductFamily;
  profile: PromptWizardProductProfile;
  audioMode: PromptWizardAudioMode;
  targetLanguage: string | null;
  config: PromptWizardVideoConfig;
}

interface UseDirectionCanaryObservation {
  id: string;
  audioMode: PromptWizardAudioMode;
  targetLanguage: string | null;
  routeDurationMs: number;
  draftDurationMs: number;
  formatRepairCount: number;
  formatAnomalyCount: number;
  releaseBlockingFormatAnomalyCount?: number;
  outputDiagnostics?: PromptWizardOutputDiagnostic[];
  contentRepairRequestCounts: PromptWizardV6PlanRequestCounts;
  terminalCalibrationRequestCounts: PromptWizardV6PlanRequestCounts;
  repairDiagnostics: PromptWizardRepairDiagnostic[];
  routeSet: PromptWizardRouteSetV6;
  plans: PromptWizardPlanV6[];
}

interface PromptWizardUseDirectionCanaryDependencies {
  generateRoutePlans?: typeof generateValidatedPromptWizardRoutePlansV6;
  now?: () => number;
  physicalRequestGuard?: {
    enterCase(caseId: string): void;
    leaveCase(caseId: string): void;
  };
  cases?: readonly UseDirectionCanaryCase[];
  requireOutputDiagnostics?: boolean;
}

function assertPromptWizardUseDirectionCanaryBatch(
  observation: UseDirectionCanaryObservation,
) {
  if (
    !Number.isFinite(observation.routeDurationMs)
    || observation.routeDurationMs < 0
    || observation.routeDurationMs > MAX_DIRECTION_P95_MS
  ) {
    throw new Error(
      `${observation.id} 路线规划耗时 ${Math.round(observation.routeDurationMs)}ms 超过 30000ms 门禁`,
    );
  }
  if (
    !Number.isFinite(observation.draftDurationMs)
    || observation.draftDurationMs < 0
    || observation.draftDurationMs > MAX_DRAFT_P95_MS
  ) {
    throw new Error(
      `${observation.id} 三方向扩写耗时 ${Math.round(observation.draftDurationMs)}ms 超过 180000ms 门禁`,
    );
  }
  if (
    observation.routeSet.routes.length !== 3
    || observation.routeSet.routes.some((route, index) => (
      route.role !== PROMPT_WIZARD_V6_ROUTE_ROLES[index]
      || route.evidenceRefs.length === 0
      || !route.proofActionZh.trim()
    ))
  ) {
    throw new Error(`${observation.id} 未交付三个完整可追溯商业路线`);
  }
  if (new Set(observation.routeSet.routes.map(route => route.titleZh)).size !== 3) {
    throw new Error(`${observation.id} 的三个动态路线标题重复`);
  }
  if (
    observation.plans.length !== 3
    || observation.plans.some((plan, index) => (
      plan.deliveryVersion !== 6
      || plan.audioMode !== observation.audioMode
      || plan.role !== PROMPT_WIZARD_V6_ROUTE_ROLES[index]
    ))
  ) {
    throw new Error(`${observation.id} 未交付完整的 V6 产品自证/痛点钩子/场景种草三方向`);
  }
  assertPromptWizardCanaryAudioDelivery(observation);
  if (
    !Number.isSafeInteger(observation.formatRepairCount)
    || observation.formatRepairCount < 0
    || observation.formatRepairCount > 3
  ) {
    throw new Error(`${observation.id} 的 V6 首轮自然格式恢复计数无效`);
  }
  if (observation.outputDiagnostics) {
    const normalizedOutputDiagnostics = normalizePromptWizardCanaryOutputDiagnostics(
      observation.outputDiagnostics,
    );
    if (normalizedOutputDiagnostics.formatAnomalyCount !== observation.formatAnomalyCount) {
      throw new Error(`${observation.id} 的 V6 输出格式异常计数无法与安全诊断对账`);
    }
    if (
      normalizedOutputDiagnostics.releaseBlockingFormatAnomalyCount
      !== observation.releaseBlockingFormatAnomalyCount
    ) {
      throw new Error(`${observation.id} 的 V6 发布阻断格式异常计数无法与安全诊断对账`);
    }
  }
  if (!isPromptWizardV6PlanRequestCounts(observation.contentRepairRequestCounts, 3)) {
    throw new Error(`${observation.id} 的 V6 内容修复物理调用计数无效`);
  }
  if (!isPromptWizardV6PlanRequestCounts(observation.terminalCalibrationRequestCounts, 1)) {
    throw new Error(`${observation.id} 的 V6 终局口播校准物理调用计数无效`);
  }
  assertPromptWizardCanaryRepairState({
    contentRepairRequestCounts: observation.contentRepairRequestCounts,
    terminalCalibrationRequestCounts: observation.terminalCalibrationRequestCounts,
    repairDiagnostics: observation.repairDiagnostics,
  });
  const batchContentRepairRequestCount = observation.contentRepairRequestCounts.reduce(
    (total, count) => total + count,
    0,
  );
  const overLimitPlanIndexes = observation.contentRepairRequestCounts.flatMap(
    (count, planIndex) => (
      count > MAX_CONTENT_REPAIR_REQUESTS_PER_PLAN && isPromptWizardPlanIndex(planIndex)
        ? [planIndex]
        : []
    ),
  );
  if (
    batchContentRepairRequestCount > MAX_CONTENT_REPAIR_REQUESTS_PER_BATCH
    || overLimitPlanIndexes.length > 0
  ) {
    const overLimitDescription = batchContentRepairRequestCount
      > MAX_CONTENT_REPAIR_REQUESTS_PER_BATCH
      ? `单批内容修复请求 ${batchContentRepairRequestCount} 次，超过发布门禁 ${MAX_CONTENT_REPAIR_REQUESTS_PER_BATCH} 次`
      : `方案${overLimitPlanIndexes[0]! + 1}内容修复请求 `
        + `${observation.contentRepairRequestCounts[overLimitPlanIndexes[0]!]} 次，超过发布门禁 ${MAX_CONTENT_REPAIR_REQUESTS_PER_PLAN} 次`;
    throw promptWizardCanaryRepairBudgetError(
      observation,
      overLimitDescription,
      overLimitPlanIndexes,
    );
  }
  const batchTerminalCalibrationRequestCount = observation.terminalCalibrationRequestCounts
    .reduce((total, count) => total + count, 0);
  if (batchTerminalCalibrationRequestCount > 0) {
    const terminalPlanIndexes = observation.terminalCalibrationRequestCounts.flatMap(
      (count, planIndex) => count > 0 && isPromptWizardPlanIndex(planIndex) ? [planIndex] : [],
    );
    throw promptWizardCanaryRepairBudgetError(
      observation,
      `终局口播校准请求 ${batchTerminalCalibrationRequestCount} 次，发布门禁要求 0 次`,
      terminalPlanIndexes,
    );
  }
  return {
    batchContentRepairRequestCount,
    batchTerminalCalibrationRequestCount,
  };
}

function assertPromptWizardCanaryAudioDelivery(
  observation: UseDirectionCanaryObservation,
) {
  if (observation.audioMode === 'voiceover') {
    if (!observation.targetLanguage?.trim()) {
      throw Object.assign(new Error(`${observation.id} 口播方案缺少目标语言`), {
        code: 'PROMPT_WIZARD_TARGET_LANGUAGE_REQUIRED',
        fieldPaths: ['targetLanguage'],
      });
    }
    return;
  }

  if (observation.targetLanguage !== null) {
    throw promptWizardCanarySoundDesignError(
      observation.id,
      '5 秒纯视觉方案不得携带口播语言',
      ['targetLanguage'],
    );
  }
  for (const plan of observation.plans) {
    assertPromptWizardSoundDesignOnlyVisualClosure({ shots: plan.shots });
    const emptyFoleyPaths = plan.shots.flatMap((shot, index) => (
      !shot.foley.trim()
        ? [`segments[${index}].foley`]
        : []
    ));
    if (
      emptyFoleyPaths.length > 0
      || !plan.prompt.includes(PROMPT_WIZARD_SOUND_DESIGN_ONLY_INSTRUCTION)
      || /^旁白（[^\n]+）：/mu.test(plan.prompt)
      || /(?:字幕|花字|价格文字|价格标签|按钮|商品卡|购物车|TikTok\s*(?:UI|界面)|平台\s*(?:UI|界面)|虚构\s*UI)/iu.test(plan.prompt)
    ) {
      throw promptWizardCanarySoundDesignError(
        observation.id,
        '5 秒方案必须只保留音乐、环境声与真实商品操作拟音',
        emptyFoleyPaths.length > 0 ? emptyFoleyPaths : ['prompt'],
      );
    }
  }
}

function promptWizardCanarySoundDesignError(
  caseId: string,
  reason: string,
  fieldPaths: string[],
) {
  return Object.assign(new Error(`${caseId} ${reason}`), {
    code: 'PROMPT_WIZARD_SOUND_DESIGN_VISUAL_CLOSURE_INVALID',
    fieldPaths,
  });
}

function promptWizardCanaryRepairBudgetError(
  observation: UseDirectionCanaryObservation,
  reason: string,
  planIndexes: readonly (0 | 1 | 2)[],
) {
  return Object.assign(new Error(`${observation.id} ${reason}`), {
    code: 'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED',
    planIndexes: [...planIndexes],
    repairRounds: Math.max(0, ...observation.repairDiagnostics.map(item => item.repairRound)),
    contentRepairRequestCounts: [...observation.contentRepairRequestCounts],
    terminalCalibrationRequestCounts: [...observation.terminalCalibrationRequestCounts],
    repairDiagnostics: observation.repairDiagnostics.map(item => ({
      planIndex: item.planIndex,
      origin: item.origin,
      repairRound: item.repairRound,
      errorCode: item.errorCode,
      fieldPaths: [...item.fieldPaths],
    })),
  });
}

const PROMPT_WIZARD_USE_DIRECTION_CANARY_PRODUCTS = [
  {
    id: '服饰',
    expectedFamily: 'apparel-accessories' as const,
    profile: {
    productName: '短袖运动上衣',
    category: '服饰',
    materials: '纺织面料',
    structure: '圆领、短袖、直筒版型',
    logo: '胸前有可见字母印花',
    usage: '套头穿着',
    visibleFacts: ['参考图片中可见短袖上衣正面、圆领与胸前印花'],
    consistencyConstraints: '保持圆领、短袖、版型和胸前印花位置一致',
    },
  },
  {
    id: '家居',
    expectedFamily: 'home-living' as const,
    profile: {
    productName: '奖杯造型玻璃饮品杯',
    category: '玻璃饮品杯',
    materials: '透明玻璃',
    structure: '上部为敞口杯体，中部为浮雕握柄，下部为圆形底座',
    logo: '',
    usage: '向杯内倒入饮品后手持饮用',
    visibleFacts: ['杯身呈奖杯浮雕轮廓', '透明杯体中可以看到盛装的饮品'],
    consistencyConstraints: '保持透明玻璃材质、奖杯轮廓和圆形底座一致',
    },
  },
  {
    id: '美妆',
    expectedFamily: 'beauty-personal-care' as const,
    profile: {
    productName: '按压式护肤乳液瓶',
    category: '美妆个护容器',
    materials: '不透明瓶身与塑料按压泵头',
    structure: '圆柱瓶身、按压泵头和透明保护盖',
    logo: '瓶身保留原有品牌文字',
    usage: '取下保护盖并按压泵头取用乳液',
    visibleFacts: ['参考图片中可见按压泵头、保护盖和圆柱瓶身'],
    consistencyConstraints: '保持泵头、保护盖、瓶身比例和原有品牌文字一致',
    },
  },
  {
    id: '耳机',
    expectedFamily: 'consumer-electronics' as const,
    profile: {
    productName: '折叠式头戴耳机',
    category: '消费电子',
    materials: '哑光外壳和软质耳罩',
    structure: '可折叠头梁、左右耳罩和实体按键',
    logo: '耳罩外侧保留原有 Logo',
    usage: '展开头梁后佩戴于双耳，并按下实体按键',
    visibleFacts: ['参考图片中可见可折叠头梁、软质耳罩和实体按键'],
    consistencyConstraints: '保持头梁、耳罩、按键和 Logo 位置一致',
    },
  },
  {
    id: '宠物用品',
    expectedFamily: 'general' as const,
    profile: {
    productName: '二合一宠物喂食与饮水器',
    category: '宠物用品',
    materials: '',
    structure: '储粮仓、透明水瓶、双碗底座和出料口',
    logo: '',
    usage: '将宠物干粮放入储粮仓，将饮用水瓶稳固放入底座',
    visibleFacts: ['参考图片中可见储粮仓、透明水瓶与双碗底座'],
    consistencyConstraints: '保持储粮仓、水瓶、双碗底座和出料口的外观一致',
    },
  },
] as const;

const PROMPT_WIZARD_USE_DIRECTION_CANARY_VARIANTS = [
  {
    id: '5s-sound-only',
    audioMode: 'sound-design-only',
    config: { model: 'seedance-2.0-mini', aspectRatio: '9:16', resolution: '480p', durationSeconds: 5 },
  },
  {
    id: '10s',
    audioMode: 'voiceover',
    config: { model: 'seedance-2.0-fast', aspectRatio: '9:16', resolution: '720p', durationSeconds: 10 },
  },
  {
    id: '15s',
    audioMode: 'voiceover',
    config: { model: 'seedance-2.0', aspectRatio: '16:9', resolution: '1080p', durationSeconds: 15 },
  },
] as const satisfies ReadonlyArray<{
  id: string;
  audioMode: PromptWizardAudioMode;
  config: PromptWizardVideoConfig;
}>;

/**
 * 十个口播案例的固定语言表。索引 0 与 3 分别钉住 Attempt27/28 的两个
 * 普通话高风险案例；其余位置让同一轮 15 批 Canary 同时覆盖两种字符计量
 * 语言和三种词计量语言，不增加批次、方案或物理请求预算。
 */
const PROMPT_WIZARD_CANARY_VOICEOVER_LANGUAGES = [
  '普通话',
  '英语',
  '西班牙语',
  '普通话',
  '日语',
  '泰语',
  '英语',
  '西班牙语',
  '日语',
  '泰语',
] as const;

const PROMPT_WIZARD_CANARY_LANGUAGE_IDS = {
  '普通话': 'zh',
  '英语': 'en',
  '西班牙语': 'es',
  '日语': 'ja',
  '泰语': 'th',
} as const;

export const PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES: readonly UseDirectionCanaryCase[] =
  PROMPT_WIZARD_USE_DIRECTION_CANARY_PRODUCTS.flatMap((product, productIndex) => (
    PROMPT_WIZARD_USE_DIRECTION_CANARY_VARIANTS.map((variant, variantIndex) => {
      const targetLanguage = variant.audioMode === 'voiceover'
        ? PROMPT_WIZARD_CANARY_VOICEOVER_LANGUAGES[
          productIndex * 2 + variantIndex - 1
        ]!
        : null;
      const languageSuffix = targetLanguage
        ? `-${PROMPT_WIZARD_CANARY_LANGUAGE_IDS[targetLanguage]}`
        : '';
      return canaryCase(
        `${product.id}-${variant.id}${languageSuffix}`,
        product.expectedFamily,
        variant.audioMode,
        targetLanguage,
        variant.config,
        { ...product.profile, visibleFacts: [...product.profile.visibleFacts] },
      );
    })
  ));

type PromptWizardResponsesClient = NonNullable<
  ConstructorParameters<typeof ArkPromptWizardProvider>[0]
>;

export interface PromptWizardAttempt26PhysicalRequestSnapshot {
  globalCount: number;
  caseCounts: Record<string, number>;
}

const PROMPT_WIZARD_ATTEMPT26_CASE_BY_ID = new Map(
  PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.map(testCase => [testCase.id, testCase]),
);

function promptWizardAttempt26CasePhysicalRequestLimit(testCase: UseDirectionCanaryCase) {
  return testCase.config.durationSeconds === 5 ? 12 : 15;
}

/**
 * Attempt26 的物理请求硬帽位于 Ark `responses.create` 的最内层边界。
 * 计数在委托调用前同步递增，因此三路并发与 Provider 内部格式恢复都无法越帽。
 */
export class PromptWizardAttempt26PhysicalRequestGuard implements PromptWizardResponsesClient {
  private activeCaseId: string | null = null;
  private readonly caseCounts = new Map<string, number>();
  private globalCount = 0;

  constructor(private readonly delegate: PromptWizardResponsesClient) {}

  enterCase(caseId: string) {
    if (!PROMPT_WIZARD_ATTEMPT26_CASE_BY_ID.has(caseId) || this.activeCaseId !== null) {
      throw promptWizardAttempt26RequestLimitError();
    }
    this.activeCaseId = caseId;
  }

  leaveCase(caseId: string) {
    if (this.activeCaseId === caseId) this.activeCaseId = null;
  }

  snapshot(): PromptWizardAttempt26PhysicalRequestSnapshot {
    return {
      globalCount: this.globalCount,
      caseCounts: Object.fromEntries(
        PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.map(testCase => [
          testCase.id,
          this.caseCounts.get(testCase.id) ?? 0,
        ]),
      ),
    };
  }

  create(
    request: Parameters<PromptWizardResponsesClient['create']>[0],
    options: Parameters<PromptWizardResponsesClient['create']>[1],
  ): ReturnType<PromptWizardResponsesClient['create']> {
    const caseId = this.activeCaseId;
    const testCase = caseId ? PROMPT_WIZARD_ATTEMPT26_CASE_BY_ID.get(caseId) : null;
    if (!caseId || !testCase) {
      return Promise.reject(promptWizardAttempt26RequestLimitError()) as ReturnType<
        PromptWizardResponsesClient['create']
      >;
    }
    const caseCount = this.caseCounts.get(caseId) ?? 0;
    if (
      caseCount >= promptWizardAttempt26CasePhysicalRequestLimit(testCase)
      || this.globalCount >= PROMPT_WIZARD_ATTEMPT26_GLOBAL_PHYSICAL_REQUEST_LIMIT
    ) {
      return Promise.reject(promptWizardAttempt26RequestLimitError()) as ReturnType<
        PromptWizardResponsesClient['create']
      >;
    }
    this.caseCounts.set(caseId, caseCount + 1);
    this.globalCount += 1;
    return this.delegate.create(request, options);
  }
}

function promptWizardAttempt26RequestLimitError() {
  return Object.assign(new Error('Attempt26 Provider 物理请求预算已耗尽'), {
    code: 'PROMPT_WIZARD_PROVIDER_REQUEST_FAILED',
    retryable: false,
  });
}

export function createPromptWizardAttempt26ArkRuntime() {
  const apiKey = env.ARK_PROMPT_WIZARD_API_KEY ?? env.ARK_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('提示词向导未配置火山方舟 API Key'), {
      code: 'PROMPT_WIZARD_PROVIDER_NOT_CONFIGURED',
    });
  }
  const responses = new ArkPromptWizardResponsesClient({
    apiKey,
    baseUrl: env.ARK_BASE_URL,
  });
  const physicalRequestGuard = new PromptWizardAttempt26PhysicalRequestGuard(responses);
  return {
    provider: new ArkPromptWizardProvider(physicalRequestGuard),
    physicalRequestGuard,
  };
}

export function assertPromptWizardUseDirectionCanary(
  observations: readonly UseDirectionCanaryObservation[],
) {
  if (observations.length !== PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.length) {
    throw new Error(`V6 三方向 Canary 必须完整执行 15 个批次，实际 ${observations.length} 个`);
  }
  const routeDurations = observations
    .map(item => item.routeDurationMs)
    .sort((a, b) => a - b);
  const draftDurations = observations
    .map(item => item.draftDurationMs)
    .sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(observations.length * 0.95) - 1);
  const routeP95Ms = routeDurations[p95Index] ?? Number.POSITIVE_INFINITY;
  const draftP95Ms = draftDurations[p95Index] ?? Number.POSITIVE_INFINITY;
  const formatRepairCount = observations.reduce((total, observation) => (
    total + observation.formatRepairCount
  ), 0);
  const hasOutputDiagnostics = observations.some(observation => (
    Boolean(observation.outputDiagnostics?.length)
  ));
  const formatAnomalyCount = hasOutputDiagnostics
    ? observations.reduce((total, observation) => (
        total + (observation.formatAnomalyCount ?? 0)
      ), 0)
    : formatRepairCount;
  const releaseBlockingFormatAnomalyCount = hasOutputDiagnostics
    ? observations.reduce((total, observation) => (
        total + (observation.releaseBlockingFormatAnomalyCount ?? 0)
      ), 0)
    : formatRepairCount;
  let contentRepairRequestCount = 0;
  let terminalCalibrationRequestCount = 0;
  for (const observation of observations) {
    const {
      batchContentRepairRequestCount,
      batchTerminalCalibrationRequestCount,
    } = assertPromptWizardUseDirectionCanaryBatch(observation);
    contentRepairRequestCount += batchContentRepairRequestCount;
    terminalCalibrationRequestCount += batchTerminalCalibrationRequestCount;
  }
  if (routeP95Ms > MAX_DIRECTION_P95_MS) {
    throw new Error(`V6 路线规划 P95 ${Math.round(routeP95Ms)}ms 超过 30000ms 门禁`);
  }
  if (draftP95Ms > MAX_DRAFT_P95_MS) {
    throw new Error(`V6 三方向扩写 P95 ${Math.round(draftP95Ms)}ms 超过 180000ms 门禁`);
  }
  if (releaseBlockingFormatAnomalyCount > 1) {
    throw new Error(hasOutputDiagnostics
      ? `V6 45 个方案发布阻断格式异常 ${releaseBlockingFormatAnomalyCount} 次，超过发布门禁 1 次`
      : `V6 45 个方案首轮自然格式恢复 ${formatRepairCount} 次，超过发布门禁 1 次`);
  }
  const deliveredPlanCount = observations.reduce((total, observation) => total + observation.plans.length, 0);
  if (deliveredPlanCount !== 45) {
    throw new Error(`V6 三方向 Canary 必须交付 45 个方案，实际 ${deliveredPlanCount} 个`);
  }
  for (const observation of observations) {
    for (const plan of observation.plans) {
      assertPromptWizardExecutionPromptIsolation({
        prompt: plan.prompt,
        ...(observation.targetLanguage
          ? { targetLanguage: observation.targetLanguage }
          : {}),
        shots: plan.shots,
      });
    }
  }
  return {
    completed: observations.length,
    deliveredPlanCount,
    // 永久 Canary 协议只接受非负安全整数。门禁仍以上面的原始高精度值判断，
    // 这里只在事件边界确定性取整，避免 performance.now() 小数破坏离线审计。
    routeP95Ms: Math.round(routeP95Ms),
    draftP95Ms: Math.round(draftP95Ms),
    formatRepairCount,
    ...(hasOutputDiagnostics ? { formatAnomalyCount } : {}),
    contentRepairRequestCount,
    terminalCalibrationRequestCount,
  };
}

export async function runPromptWizardUseDirectionCanary(
  provider: PromptWizardProvider,
  dependencies: PromptWizardUseDirectionCanaryDependencies = {},
) {
  const generateRoutePlans = dependencies.generateRoutePlans
    ?? generateValidatedPromptWizardRoutePlansV6;
  const now = dependencies.now ?? (() => performance.now());
  const observations: UseDirectionCanaryObservation[] = [];
  const testCases = dependencies.cases ?? PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES;
  for (const [caseIndex, testCase] of testCases.entries()) {
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    if (evidenceGraph.productFamily !== testCase.expectedFamily) {
      throw new Error(
        `${testCase.id} 产品族识别错误：${evidenceGraph.productFamily}，预期 ${testCase.expectedFamily}`,
      );
    }
    const routeStartedAt = now();
    const routeSet = buildPromptWizardRouteSetV6({
      id: canaryUuid(600 + caseIndex),
      runId: canaryUuid(500 + caseIndex),
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const routeDurationMs = now() - routeStartedAt;
    const draftStartedAt = now();
    let expanded: Awaited<ReturnType<typeof generateRoutePlans>>;
    dependencies.physicalRequestGuard?.enterCase(testCase.id);
    try {
      expanded = await generateRoutePlans({
        provider: promptWizardCanaryProviderWithIdentityEvent(provider, testCase.id),
        profile: testCase.profile,
        evidenceGraph,
        ...(testCase.targetLanguage
          ? { voiceoverLanguage: testCase.targetLanguage }
          : {}),
        verifiedOffer: '',
        config: testCase.config,
        routeSet,
        imageCount: 1,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });
    } catch (error) {
      const outputDiagnosticEvent = tryBuildPromptWizardCanaryOutputDiagnosticsEvent({
        caseId: testCase.id,
        value: error,
      });
      if (outputDiagnosticEvent) emit(outputDiagnosticEvent);
      const diagnosticEvent = tryBuildPromptWizardCanaryRepairDiagnosticsEvent({
        caseId: testCase.id,
        value: error,
      });
      if (diagnosticEvent) emit(diagnosticEvent);
      throw error;
    } finally {
      dependencies.physicalRequestGuard?.leaveCase(testCase.id);
    }
    const diagnosticEvent = buildPromptWizardCanaryRepairDiagnosticsEvent({
      caseId: testCase.id,
      value: expanded,
    });
    const hasOutputDiagnostics = Boolean(expanded.outputDiagnostics?.length);
    if (dependencies.requireOutputDiagnostics && !hasOutputDiagnostics) {
      throw Object.assign(new Error('V6 Canary 缺少输出格式诊断'), {
        code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
      });
    }
    const outputDiagnosticSummary = hasOutputDiagnostics
      ? normalizePromptWizardCanaryOutputDiagnostics(expanded.outputDiagnostics!)
      : {
          diagnostics: [],
          formatAnomalyCount: 0,
          releaseBlockingFormatAnomalyCount: 0,
          formatRecoveryCount: 0,
        };
    if (hasOutputDiagnostics) {
      emit({
        event: 'prompt-wizard-v6-canary-output-diagnostics',
        caseId: testCase.id,
        formatAnomalyCount: outputDiagnosticSummary.formatAnomalyCount,
        formatRecoveryCount: outputDiagnosticSummary.formatRecoveryCount,
        outputDiagnostics: outputDiagnosticSummary.diagnostics,
      });
    }
    // 任何后续质量或费用门禁抛错前，先留下不含业务正文且可逐索引对账的
    // 修复来源证据，避免再次出现“只知道调用次数、不知道修复原因”的盲区。
    emit(diagnosticEvent);
    for (const plan of expanded.plans) {
      assertPromptWizardMotionDensity({
        shots: plan.shots,
        durationSeconds: testCase.config.durationSeconds,
      });
      if (testCase.audioMode === 'sound-design-only') {
        assertPromptWizardSoundDesignOnlyVisualClosure({ shots: plan.shots });
      } else {
        assertPromptWizardVoiceoverCoverage({
          shots: plan.shots,
          targetLanguage: testCase.targetLanguage!,
          durationSeconds: testCase.config.durationSeconds,
          profile: testCase.profile,
          v6SemanticOnly: true,
        });
        assertPromptWizardConversionCta({
          shots: plan.shots,
          targetLanguage: testCase.targetLanguage!,
        });
      }
      if (promptWizardContainsStaticInstruction(plan.prompt)) {
        throw new Error(`${testCase.id} 生产提示词仍包含静态禁用词`);
      }
    }
    const draftDurationMs = now() - draftStartedAt;
    const observation: UseDirectionCanaryObservation = {
      id: testCase.id,
      audioMode: testCase.audioMode,
      targetLanguage: testCase.targetLanguage,
      routeDurationMs,
      draftDurationMs,
      formatRepairCount: expanded.formatRepairCount ?? 0,
      formatAnomalyCount: outputDiagnosticSummary.formatAnomalyCount,
      releaseBlockingFormatAnomalyCount:
        outputDiagnosticSummary.releaseBlockingFormatAnomalyCount,
      ...(hasOutputDiagnostics
        ? { outputDiagnostics: outputDiagnosticSummary.diagnostics }
        : {}),
      contentRepairRequestCounts: expanded.contentRepairRequestCounts,
      terminalCalibrationRequestCounts: expanded.terminalCalibrationRequestCounts,
      repairDiagnostics: diagnosticEvent.repairDiagnostics,
      routeSet,
      plans: expanded.plans as PromptWizardPlanV6[],
    };
    // 单批一旦已经超过发布调用预算，继续运行剩余矩阵只会产生无效费用。
    // 诊断已经在所有质量门禁前写入；这里再执行与最终汇总完全相同的
    // 单批费用门禁，即使失败也不会丢失修复阶段证据。
    assertPromptWizardUseDirectionCanaryBatch(observation);
    const nextFormatRepairCount = observations.reduce((total, item) => (
      total + item.formatRepairCount
    ), observation.formatRepairCount);
    const nextReleaseBlockingFormatAnomalyCount = hasOutputDiagnostics
      ? observations.reduce((total, item) => (
          total + (item.releaseBlockingFormatAnomalyCount ?? 0)
        ), observation.releaseBlockingFormatAnomalyCount ?? 0)
      : nextFormatRepairCount;
    if (
      (!hasOutputDiagnostics && nextFormatRepairCount > 1)
      || (hasOutputDiagnostics && nextReleaseBlockingFormatAnomalyCount > 1)
    ) {
      throw new Error(
        hasOutputDiagnostics
          ? `V6 已完成方案发布阻断格式异常 ${nextReleaseBlockingFormatAnomalyCount} 次，超过发布门禁 1 次`
          : `V6 已完成方案首轮自然格式恢复 ${nextFormatRepairCount} 次，超过发布门禁 1 次`,
      );
    }
    observations.push(observation);
    emit({
      event: 'prompt-wizard-v6-canary-batch',
      id: testCase.id,
      ok: true,
      routeCount: routeSet.routes.length,
      planCount: expanded.plans.length,
      repairRounds: expanded.repairRounds,
      formatRepairCount: expanded.formatRepairCount ?? 0,
      formatAnomalyCount: outputDiagnosticSummary.formatAnomalyCount,
      contentRepairRequestCounts: expanded.contentRepairRequestCounts,
      terminalCalibrationRequestCounts: expanded.terminalCalibrationRequestCounts,
      routeDurationMs: Math.round(routeDurationMs),
      draftDurationMs: Math.round(draftDurationMs),
      model: expanded.usage.model,
      draftInputTokens: expanded.usage.inputTokens,
      draftOutputTokens: expanded.usage.outputTokens,
    });
  }
  const summary = assertPromptWizardUseDirectionCanary(observations);
  emit({ event: 'prompt-wizard-v6-canary-completed', ok: true, ...summary });
  return true;
}

/**
 * Canary 的 stdout 是发布证据，而不是普通调试日志。每个初始单方案调用都先
 * 发出不含商品或 Provider 正文的身份事件，使发布解析器在中途失败时仍能
 * 验证“已经观察到的身份完整且唯一”，而不错误要求失败批次也凑齐 45 个。
 */
function promptWizardCanaryProviderWithIdentityEvent(
  provider: PromptWizardProvider,
  caseId: string,
) {
  return new Proxy(provider, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === 'generateUseDirectionDrafts') {
        return (input: Parameters<PromptWizardProvider['generateUseDirectionDrafts']>[0]) => {
          const context = input.planContexts.length === 1 ? input.planContexts[0] : null;
          if (
            !context
            || !('routeRole' in context)
            || !isPromptWizardPlanIndex(context.planIndex)
            || context.routeRole !== PROMPT_WIZARD_V6_ROUTE_ROLES[context.planIndex]
          ) {
            throw Object.assign(new Error('V6 Canary 初始 Provider 身份无效'), {
              code: 'PROMPT_WIZARD_PROVIDER_INPUT_INVALID',
            });
          }
          emit({
            event: 'prompt-wizard-v6-canary-initial-provider-identity',
            caseId,
            planIndex: context.planIndex,
            role: context.routeRole,
          });
          return Reflect.apply(value, target, [input]);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as PromptWizardProvider;
}

/**
 * 校验已解析的 Canary NDJSON 事件。Provider 自身日志可以在终态前和协议事件
 * 交错；未知 V6 Canary 协议事件失败关闭。一旦出现终态，后续任何带 event 的
 * 记录都视为证据损坏，避免迟到外呼被发布解析器忽略。
 *
 * completed 与 aborted 必须严格二选一：
 * - completed：15 个批次、45 个初始身份必须全部完整且唯一；
 * - aborted：允许 0–45 个部分身份，但每个已观察身份仍须完整、属于矩阵且唯一。
 *
 * 合法 aborted 会返回失败摘要而不会抛出，从而保证发布外壳保留原始 Provider
 * 失败；只有转录本身损坏时才抛出“证据契约无效”。
 */
export function assertPromptWizardUseDirectionCanaryEventContract(
  events: readonly unknown[],
) {
  const expectedCaseIds = new Set(
    PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.map(testCase => testCase.id),
  );
  const expectedIdentities = new Set(
    PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.flatMap(testCase => (
      PROMPT_WIZARD_V6_ROUTE_ROLES.map((_, planIndex) => `${testCase.id}#${planIndex}`)
    )),
  );
  const identities = new Set<string>();
  const completedBatchIds = new Set<string>();
  const repairStatesByCaseId = new Map<string, PromptWizardCanaryRepairState>();
  const outputDiagnosticsByCaseId = new Map<string, PromptWizardOutputDiagnostic[]>();
  let lastRepairDiagnosticCaseId: string | null = null;
  let terminal: Record<string, unknown> | null = null;

  for (const candidate of events) {
    if (!isPromptWizardCanaryRecord(candidate)) continue;
    if (terminal) {
      throw promptWizardCanaryEvidenceContractError('Canary 终态后仍出现事件');
    }
    const eventName = candidate.event;
    if (typeof eventName !== 'string') continue;
    if (
      eventName.startsWith('prompt-wizard-v6-canary-')
      && !PROMPT_WIZARD_CANARY_PROTOCOL_EVENTS.has(eventName)
    ) {
      throw promptWizardCanaryEvidenceContractError('Canary 出现未知协议事件');
    }
    if (!PROMPT_WIZARD_CANARY_PROTOCOL_EVENTS.has(eventName)) {
      continue;
    }

    if (eventName === 'prompt-wizard-v6-canary-initial-provider-identity') {
      const caseId = candidate.caseId;
      const planIndex = candidate.planIndex;
      const role = candidate.role;
      if (
        typeof caseId !== 'string'
        || !expectedCaseIds.has(caseId)
        || !isPromptWizardPlanIndex(planIndex)
        || role !== PROMPT_WIZARD_V6_ROUTE_ROLES[planIndex]
      ) {
        throw promptWizardCanaryEvidenceContractError('Canary 初始 Provider 身份不完整');
      }
      const identity = `${caseId}#${planIndex}`;
      if (identities.has(identity)) {
        throw promptWizardCanaryEvidenceContractError('Canary 初始 Provider 身份重复');
      }
      identities.add(identity);
      continue;
    }

    if (eventName === 'prompt-wizard-v6-canary-output-diagnostics') {
      const caseId = candidate.caseId;
      if (
        typeof caseId !== 'string'
        || !expectedCaseIds.has(caseId)
        || outputDiagnosticsByCaseId.has(caseId)
        || Object.keys(candidate).some(key => ![
          'event',
          'caseId',
          'formatAnomalyCount',
          'formatRecoveryCount',
          'outputDiagnostics',
        ].includes(key))
        || PROMPT_WIZARD_V6_ROUTE_ROLES.some((_, planIndex) => (
          !identities.has(`${caseId}#${planIndex}`)
        ))
      ) {
        throw promptWizardCanaryEvidenceContractError('Canary 输出格式诊断事件身份或字段无效');
      }
      const outputSummary = normalizePromptWizardCanaryOutputDiagnostics(
        candidate.outputDiagnostics,
      );
      if (
        candidate.formatAnomalyCount !== outputSummary.formatAnomalyCount
        || candidate.formatRecoveryCount !== outputSummary.formatRecoveryCount
      ) {
        throw promptWizardCanaryEvidenceContractError('Canary 输出格式诊断事件计数无法对账');
      }
      outputDiagnosticsByCaseId.set(caseId, outputSummary.diagnostics);
      continue;
    }

    if (eventName === 'prompt-wizard-v6-canary-repair-diagnostics') {
      const caseId = candidate.caseId;
      const allowedKeys = new Set([
        'event',
        'caseId',
        'contentRepairRequestCounts',
        'terminalCalibrationRequestCounts',
        'repairDiagnostics',
      ]);
      if (
        typeof caseId !== 'string'
        || !expectedCaseIds.has(caseId)
        || repairStatesByCaseId.has(caseId)
        || Object.keys(candidate).some(key => !allowedKeys.has(key))
        || PROMPT_WIZARD_V6_ROUTE_ROLES.some((_, planIndex) => (
          !identities.has(`${caseId}#${planIndex}`)
        ))
      ) {
        throw promptWizardCanaryEvidenceContractError('Canary 修复诊断事件身份或字段无效');
      }
      const repairState = promptWizardCanaryRepairState(candidate);
      if (!repairState) {
        throw promptWizardCanaryEvidenceContractError('Canary 修复诊断事件无法与调用计数对账');
      }
      repairStatesByCaseId.set(caseId, repairState);
      lastRepairDiagnosticCaseId = caseId;
      continue;
    }

    if (eventName === 'prompt-wizard-v6-canary-batch') {
      const caseId = candidate.id;
      const repairState = typeof caseId === 'string'
        ? repairStatesByCaseId.get(caseId)
        : null;
      if (
        candidate.ok !== true
        || typeof caseId !== 'string'
        || !expectedCaseIds.has(caseId)
        || completedBatchIds.has(caseId)
        || !repairState
        || !promptWizardCanaryRequestCountsEqual(
          candidate.contentRepairRequestCounts,
          repairState.contentRepairRequestCounts,
        )
        || !promptWizardCanaryRequestCountsEqual(
          candidate.terminalCalibrationRequestCounts,
          repairState.terminalCalibrationRequestCounts,
        )
        || PROMPT_WIZARD_V6_ROUTE_ROLES.some((_, planIndex) => (
          !identities.has(`${caseId}#${planIndex}`)
        ))
      ) {
        throw promptWizardCanaryEvidenceContractError('Canary 批次事件与初始身份不一致');
      }
      completedBatchIds.add(caseId);
      continue;
    }

    terminal = candidate;
  }

  if (!terminal) {
    throw promptWizardCanaryEvidenceContractError('Canary 缺少唯一终态');
  }
  if (identities.size > PROMPT_WIZARD_CANARY_EXPECTED_PLAN_COUNT) {
    throw promptWizardCanaryEvidenceContractError('Canary 初始 Provider 身份超过矩阵上限');
  }
  if ([...identities].some(identity => !expectedIdentities.has(identity))) {
    throw promptWizardCanaryEvidenceContractError('Canary 初始 Provider 身份不属于发布矩阵');
  }

  if (terminal.event === 'prompt-wizard-v6-canary-completed') {
    if (
      terminal.ok !== true
      || terminal.completed !== PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.length
      || terminal.deliveredPlanCount !== PROMPT_WIZARD_CANARY_EXPECTED_PLAN_COUNT
      || identities.size !== PROMPT_WIZARD_CANARY_EXPECTED_PLAN_COUNT
      || completedBatchIds.size !== PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.length
      || expectedIdentities.size !== identities.size
      || [...expectedIdentities].some(identity => !identities.has(identity))
      || [...expectedCaseIds].some(caseId => !completedBatchIds.has(caseId))
    ) {
      throw promptWizardCanaryEvidenceContractError('Canary completed 终态证据不完整');
    }
    return {
      state: 'completed' as const,
      ok: true as const,
      observedIdentityCount: identities.size,
      completedBatchCount: completedBatchIds.size,
    };
  }

  if (
    terminal.event !== 'prompt-wizard-v6-canary-aborted'
    || terminal.ok !== false
    || terminal.error !== PROMPT_WIZARD_CANARY_ABORT_MESSAGE
  ) {
    throw promptWizardCanaryEvidenceContractError('Canary aborted 终态 envelope 无效');
  }
  const allowedAbortKeys = new Set([
    'event',
    'ok',
    'error',
    'errorCode',
    'fieldPaths',
    'repairRounds',
    'planIndexes',
    'executionBudgetIssues',
    'voiceoverCoverage',
    'contentRepairRequestCounts',
    'terminalCalibrationRequestCounts',
    'repairDiagnostics',
  ]);
  if (Object.keys(terminal).some(key => !allowedAbortKeys.has(key))) {
    throw promptWizardCanaryEvidenceContractError('Canary aborted 包含非白名单字段');
  }
  const errorCode = typeof terminal.errorCode === 'string'
    && CANARY_ERROR_CODES.has(terminal.errorCode)
    ? terminal.errorCode
    : null;
  if (
    Object.hasOwn(terminal, 'errorCode')
    && !errorCode
  ) {
    throw promptWizardCanaryEvidenceContractError('Canary aborted 错误码不在安全白名单');
  }
  if (
    Object.hasOwn(terminal, 'fieldPaths')
    && (
      !Array.isArray(terminal.fieldPaths)
      || terminal.fieldPaths.length > 24
      || terminal.fieldPaths.some(value => !isPromptWizardCanarySafeFieldPath(value))
    )
  ) {
    throw promptWizardCanaryEvidenceContractError('Canary aborted 字段路径不在安全白名单');
  }
  if (
    Object.hasOwn(terminal, 'repairRounds')
    && (
      !Number.isSafeInteger(terminal.repairRounds)
      || Number(terminal.repairRounds) < 0
      || Number(terminal.repairRounds) > 3
    )
  ) {
    throw promptWizardCanaryEvidenceContractError('Canary aborted 修复轮次无效');
  }
  if (
    Object.hasOwn(terminal, 'planIndexes')
    && (
      !Array.isArray(terminal.planIndexes)
      || terminal.planIndexes.some(value => !isPromptWizardPlanIndex(value))
      || new Set(terminal.planIndexes).size !== terminal.planIndexes.length
    )
  ) {
    throw promptWizardCanaryEvidenceContractError('Canary aborted 方案索引无效');
  }
  if (Object.hasOwn(terminal, 'executionBudgetIssues')) {
    const safeIssues = promptWizardCanaryExecutionBudgetIssues({
      issues: terminal.executionBudgetIssues,
    });
    if (JSON.stringify(safeIssues) !== JSON.stringify(terminal.executionBudgetIssues)) {
      throw promptWizardCanaryEvidenceContractError('Canary aborted 执行预算诊断无效');
    }
  }
  if (Object.hasOwn(terminal, 'voiceoverCoverage')) {
    const safeCoverage = promptWizardCanaryVoiceoverCoverageDetails({
      code: 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
      details: terminal.voiceoverCoverage,
    });
    if (JSON.stringify(safeCoverage) !== JSON.stringify(terminal.voiceoverCoverage)) {
      throw promptWizardCanaryEvidenceContractError('Canary aborted 口播诊断无效');
    }
  }
  const terminalHasRepairState = Object.hasOwn(terminal, 'contentRepairRequestCounts')
    || Object.hasOwn(terminal, 'terminalCalibrationRequestCounts')
    || Object.hasOwn(terminal, 'repairDiagnostics');
  const terminalRepairState = terminalHasRepairState
    ? promptWizardCanaryRepairState(terminal)
    : null;
  if (terminalHasRepairState && !terminalRepairState) {
    throw promptWizardCanaryEvidenceContractError('Canary aborted 修复诊断结构无效');
  }
  if (errorCode === 'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED') {
    const emittedRepairState = lastRepairDiagnosticCaseId
      ? repairStatesByCaseId.get(lastRepairDiagnosticCaseId)
      : null;
    if (
      !terminalRepairState
      || !emittedRepairState
      || !promptWizardCanaryRepairStatesEqual(terminalRepairState, emittedRepairState)
    ) {
      throw promptWizardCanaryEvidenceContractError('Canary 修复预算终态缺少可对账诊断');
    }
  }
  return {
    state: 'aborted' as const,
    ok: false as const,
    observedIdentityCount: identities.size,
    completedBatchCount: completedBatchIds.size,
    ...(errorCode ? { errorCode } : {}),
  };
}

/**
 * 发布外壳使用的唯一原始转录解析入口。每个非空行都必须是含字符串 event 的
 * JSON 对象；completed 必须对应进程 rc=0，aborted 必须对应非零 rc。任何
 * malformed 行或进程状态矛盾都属于证据损坏，且错误中不回显原始行。
 */
export function parsePromptWizardUseDirectionCanaryNdjson(input: {
  transcript: string;
  processExitCode: number;
}) {
  if (
    !Number.isSafeInteger(input.processExitCode)
    || input.processExitCode < 0
    || input.processExitCode > 255
  ) {
    throw promptWizardCanaryEvidenceContractError('Canary 进程退出码无效');
  }
  const events = input.transcript.split(/\r?\n/u).flatMap((line) => {
    if (!line.trim()) return [];
    let candidate: unknown;
    try {
      candidate = JSON.parse(line);
    } catch {
      throw promptWizardCanaryEvidenceContractError('Canary NDJSON 包含无法解析的行');
    }
    if (!isPromptWizardCanaryRecord(candidate) || typeof candidate.event !== 'string') {
      throw promptWizardCanaryEvidenceContractError('Canary NDJSON 行缺少 event');
    }
    return [candidate];
  });
  const summary = assertPromptWizardUseDirectionCanaryEventContract(events);
  const processSucceeded = input.processExitCode === 0;
  if (
    (summary.state === 'completed' && !processSucceeded)
    || (summary.state === 'aborted' && processSucceeded)
  ) {
    throw promptWizardCanaryEvidenceContractError('Canary 终态与进程退出码矛盾');
  }
  return {
    ...summary,
    processExitCode: input.processExitCode,
    releaseAllowed: summary.state === 'completed' && processSucceeded,
  };
}

export function buildPromptWizardAttempt26PhysicalRequestEvent(
  physicalRequestSnapshot: PromptWizardAttempt26PhysicalRequestSnapshot,
) {
  return {
    event: PROMPT_WIZARD_ATTEMPT26_PHYSICAL_REQUEST_EVENT,
    physicalRequestSnapshot: normalizePromptWizardAttempt26PhysicalRequestSnapshot(
      physicalRequestSnapshot,
    ),
  } as const;
}

/**
 * Attempt26 的最后一个 NDJSON 事件只承载 Ark 最内层物理调用计数。先独立验证
 * 固定字段、15 个固定 case、总分、连续执行前缀和硬帽，再把此前的原始转录交回
 * 既有 15/45 严格解析器；因此新增证据不能弱化任何原发布门禁。
 */
export function parsePromptWizardAttempt26CanaryNdjson(input: {
  transcript: string;
  processExitCode: number;
}) {
  const lines = input.transcript.split(/\r?\n/u).filter(line => line.trim());
  const records = lines.map((line) => {
    let candidate: unknown;
    try {
      candidate = JSON.parse(line);
    } catch {
      throw promptWizardCanaryEvidenceContractError('Attempt26 NDJSON 包含无法解析的行');
    }
    if (!isPromptWizardCanaryRecord(candidate) || typeof candidate.event !== 'string') {
      throw promptWizardCanaryEvidenceContractError('Attempt26 NDJSON 行缺少 event');
    }
    return candidate;
  });
  const physicalEventIndexes = records.flatMap((record, index) => (
    record.event === PROMPT_WIZARD_ATTEMPT26_PHYSICAL_REQUEST_EVENT ? [index] : []
  ));
  if (
    physicalEventIndexes.length !== 1
    || physicalEventIndexes[0] !== records.length - 1
  ) {
    throw promptWizardCanaryEvidenceContractError('Attempt26 缺少唯一末尾物理请求计数事件');
  }
  const physicalEvent = records.at(-1)!;
  if (
    Object.keys(physicalEvent).length !== 2
    || !Object.hasOwn(physicalEvent, 'event')
    || !Object.hasOwn(physicalEvent, 'physicalRequestSnapshot')
  ) {
    throw promptWizardCanaryEvidenceContractError('Attempt26 物理请求计数事件字段无效');
  }
  const physicalRequestSnapshot = normalizePromptWizardAttempt26PhysicalRequestSnapshot(
    physicalEvent.physicalRequestSnapshot,
  );
  const baseTranscript = lines.slice(0, -1).join('\n');
  const summary = parsePromptWizardUseDirectionCanaryNdjson({
    transcript: baseTranscript,
    processExitCode: input.processExitCode,
  });
  const orderedCounts = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.map(
    testCase => physicalRequestSnapshot.caseCounts[testCase.id]!,
  );
  const completedCasesHaveInitialCalls = orderedCounts
    .slice(0, summary.completedBatchCount)
    .every(count => count >= PROMPT_WIZARD_V6_ROUTE_ROLES.length);
  const allCasesHaveInitialCalls = orderedCounts.every(
    count => count >= PROMPT_WIZARD_V6_ROUTE_ROLES.length,
  );
  return {
    ...summary,
    physicalRequestSnapshot,
    releaseAllowed: summary.releaseAllowed
      && summary.completedBatchCount === PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.length
      && completedCasesHaveInitialCalls
      && allCasesHaveInitialCalls,
  };
}

function emptyPromptWizardAttempt26PhysicalRequestSnapshot(): PromptWizardAttempt26PhysicalRequestSnapshot {
  return {
    globalCount: 0,
    caseCounts: Object.fromEntries(
      PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.map(testCase => [testCase.id, 0]),
    ),
  };
}

function normalizePromptWizardAttempt26PhysicalRequestSnapshot(
  value: unknown,
): PromptWizardAttempt26PhysicalRequestSnapshot {
  if (
    !isPromptWizardCanaryRecord(value)
    || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'globalCount')
    || !Object.hasOwn(value, 'caseCounts')
    || !Number.isSafeInteger(value.globalCount)
    || Number(value.globalCount) < 0
    || Number(value.globalCount) > PROMPT_WIZARD_ATTEMPT26_GLOBAL_PHYSICAL_REQUEST_LIMIT
    || !isPromptWizardCanaryRecord(value.caseCounts)
  ) {
    throw promptWizardCanaryEvidenceContractError('Attempt26 物理请求总计结构无效');
  }
  const expectedCaseIds = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.map(testCase => testCase.id);
  const caseCounts = value.caseCounts;
  const actualCaseIds = Object.keys(caseCounts);
  if (
    actualCaseIds.length !== expectedCaseIds.length
    || actualCaseIds.some(caseId => !PROMPT_WIZARD_ATTEMPT26_CASE_BY_ID.has(caseId))
    || expectedCaseIds.some(caseId => !Object.hasOwn(caseCounts, caseId))
  ) {
    throw promptWizardCanaryEvidenceContractError('Attempt26 物理请求 case 键集合无效');
  }
  const normalizedCaseCounts: Record<string, number> = {};
  let sum = 0;
  let zeroPrefixReached = false;
  for (const testCase of PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES) {
    const count = caseCounts[testCase.id];
    if (
      !Number.isSafeInteger(count)
      || typeof count !== 'number'
      || count < 0
      || count > promptWizardAttempt26CasePhysicalRequestLimit(testCase)
      || (zeroPrefixReached && count > 0)
    ) {
      throw promptWizardCanaryEvidenceContractError('Attempt26 物理请求 case 计数或执行前缀无效');
    }
    if (count === 0) zeroPrefixReached = true;
    normalizedCaseCounts[testCase.id] = count;
    sum += count;
  }
  if (sum !== value.globalCount) {
    throw promptWizardCanaryEvidenceContractError('Attempt26 物理请求总计与分项不一致');
  }
  return {
    globalCount: Number(value.globalCount),
    caseCounts: normalizedCaseCounts,
  };
}

function isPromptWizardCanaryRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPromptWizardPlanIndex(value: unknown): value is 0 | 1 | 2 {
  return value === 0 || value === 1 || value === 2;
}

function promptWizardCanaryEvidenceContractError(reason: string) {
  return Object.assign(new Error(reason), {
    code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
  });
}

function isPromptWizardV6PlanRequestCounts(
  value: unknown,
  maxPerPlan: number,
): value is PromptWizardV6PlanRequestCounts {
  return Array.isArray(value)
    && value.length === 3
    && value.every(count => (
      Number.isSafeInteger(count)
      && typeof count === 'number'
      && count >= 0
      && count <= maxPerPlan
    ));
}

interface PromptWizardCanaryRepairState {
  contentRepairRequestCounts: PromptWizardV6PlanRequestCounts;
  terminalCalibrationRequestCounts: PromptWizardV6PlanRequestCounts;
  repairDiagnostics: PromptWizardRepairDiagnostic[];
}

const PROMPT_WIZARD_REPAIR_DIAGNOSTIC_ORIGINS = new Set<PromptWizardRepairDiagnosticOrigin>([
  'initial-schema',
  'domain-validation',
  'terminal-calibration',
]);

function promptWizardCanaryRepairState(value: unknown): PromptWizardCanaryRepairState | null {
  if (!isPromptWizardCanaryRecord(value)) return null;
  const contentRepairRequestCounts = value.contentRepairRequestCounts;
  const terminalCalibrationRequestCounts = value.terminalCalibrationRequestCounts;
  if (
    !isPromptWizardV6PlanRequestCounts(contentRepairRequestCounts, 3)
    || !isPromptWizardV6PlanRequestCounts(terminalCalibrationRequestCounts, 1)
  ) return null;
  const rawDiagnostics = value.repairDiagnostics;
  if (rawDiagnostics === undefined) {
    if (
      contentRepairRequestCounts.some(count => count > 0)
      || terminalCalibrationRequestCounts.some(count => count > 0)
    ) return null;
    return {
      contentRepairRequestCounts: [...contentRepairRequestCounts],
      terminalCalibrationRequestCounts: [...terminalCalibrationRequestCounts],
      repairDiagnostics: [],
    };
  }
  if (!Array.isArray(rawDiagnostics) || rawDiagnostics.length > 12) return null;
  const repairDiagnostics: PromptWizardRepairDiagnostic[] = [];
  const identities = new Set<string>();
  for (const rawDiagnostic of rawDiagnostics) {
    if (!isPromptWizardCanaryRecord(rawDiagnostic)) return null;
    const {
      planIndex,
      origin,
      repairRound,
      errorCode,
      fieldPaths,
    } = rawDiagnostic;
    if (
      !isPromptWizardPlanIndex(planIndex)
      || typeof origin !== 'string'
      || !PROMPT_WIZARD_REPAIR_DIAGNOSTIC_ORIGINS.has(
        origin as PromptWizardRepairDiagnosticOrigin,
      )
      || (repairRound !== 1 && repairRound !== 2 && repairRound !== 3)
      || typeof errorCode !== 'string'
      || !CANARY_ERROR_CODES.has(errorCode)
      || !Array.isArray(fieldPaths)
      || fieldPaths.length > 24
      || fieldPaths.some(fieldPath => !isPromptWizardCanarySafeFieldPath(fieldPath))
    ) return null;
    const identity = `${planIndex}#${origin}#${repairRound}`;
    if (identities.has(identity)) return null;
    identities.add(identity);
    repairDiagnostics.push({
      planIndex,
      origin: origin as PromptWizardRepairDiagnosticOrigin,
      repairRound,
      errorCode,
      fieldPaths: Array.from(new Set(fieldPaths as string[])),
    });
  }
  const repairState = {
    contentRepairRequestCounts: [...contentRepairRequestCounts] as PromptWizardV6PlanRequestCounts,
    terminalCalibrationRequestCounts: [
      ...terminalCalibrationRequestCounts,
    ] as PromptWizardV6PlanRequestCounts,
    repairDiagnostics,
  };
  return promptWizardCanaryRepairStateReconciles(repairState) ? repairState : null;
}

function promptWizardCanaryRepairStateReconciles(state: PromptWizardCanaryRepairState) {
  return ([0, 1, 2] as const).every(planIndex => {
    const contentDiagnosticCount = state.repairDiagnostics.filter(diagnostic => (
      diagnostic.planIndex === planIndex
      && diagnostic.origin !== 'terminal-calibration'
    )).length;
    const terminalDiagnosticCount = state.repairDiagnostics.filter(diagnostic => (
      diagnostic.planIndex === planIndex
      && diagnostic.origin === 'terminal-calibration'
    )).length;
    return contentDiagnosticCount === state.contentRepairRequestCounts[planIndex]
      && terminalDiagnosticCount === state.terminalCalibrationRequestCounts[planIndex];
  });
}

function promptWizardCanaryRequestCountsEqual(
  value: unknown,
  expected: PromptWizardV6PlanRequestCounts,
) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((count, index) => count === expected[index]);
}

function promptWizardCanaryRepairStatesEqual(
  left: PromptWizardCanaryRepairState,
  right: PromptWizardCanaryRepairState,
) {
  return promptWizardCanaryRequestCountsEqual(
    left.contentRepairRequestCounts,
    right.contentRepairRequestCounts,
  )
    && promptWizardCanaryRequestCountsEqual(
      left.terminalCalibrationRequestCounts,
      right.terminalCalibrationRequestCounts,
    )
    && JSON.stringify(left.repairDiagnostics) === JSON.stringify(right.repairDiagnostics);
}

function assertPromptWizardCanaryRepairState(value: unknown): asserts value is PromptWizardCanaryRepairState {
  if (!promptWizardCanaryRepairState(value)) {
    throw promptWizardCanaryEvidenceContractError('Canary 修复诊断与物理调用计数不一致');
  }
}

export function buildPromptWizardCanaryRepairDiagnosticsEvent(input: {
  caseId: string;
  value: unknown;
}) {
  const repairState = promptWizardCanaryRepairState(input.value);
  if (!repairState) {
    throw promptWizardCanaryEvidenceContractError('Canary 修复诊断结构无效');
  }
  return {
    event: 'prompt-wizard-v6-canary-repair-diagnostics',
    caseId: input.caseId,
    contentRepairRequestCounts: repairState.contentRepairRequestCounts,
    terminalCalibrationRequestCounts: repairState.terminalCalibrationRequestCounts,
    repairDiagnostics: repairState.repairDiagnostics,
  } as const;
}

function tryBuildPromptWizardCanaryRepairDiagnosticsEvent(input: {
  caseId: string;
  value: unknown;
}) {
  if (!isPromptWizardCanaryRecord(input.value)) return null;
  if (
    !Object.hasOwn(input.value, 'contentRepairRequestCounts')
    && !Object.hasOwn(input.value, 'terminalCalibrationRequestCounts')
    && !Object.hasOwn(input.value, 'repairDiagnostics')
  ) return null;
  return buildPromptWizardCanaryRepairDiagnosticsEvent(input);
}

function tryBuildPromptWizardCanaryOutputDiagnosticsEvent(input: {
  caseId: string;
  value: unknown;
}) {
  if (
    !isPromptWizardCanaryRecord(input.value)
    || !Object.hasOwn(input.value, 'outputDiagnostics')
    || (Array.isArray(input.value.outputDiagnostics)
      && input.value.outputDiagnostics.length === 0)
  ) return null;
  const summary = normalizePromptWizardCanaryOutputDiagnostics(
    input.value.outputDiagnostics,
  );
  return {
    event: 'prompt-wizard-v6-canary-output-diagnostics',
    caseId: input.caseId,
    formatAnomalyCount: summary.formatAnomalyCount,
    formatRecoveryCount: summary.formatRecoveryCount,
    outputDiagnostics: summary.diagnostics,
  } as const;
}

function canaryUuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function canaryCase(
  id: string,
  expectedFamily: PromptWizardProductFamily,
  audioMode: PromptWizardAudioMode,
  targetLanguage: string | null,
  config: PromptWizardVideoConfig,
  profile: Partial<PromptWizardProductProfile> & Pick<PromptWizardProductProfile,
    'productName' | 'category' | 'materials' | 'structure' | 'logo' | 'usage'
    | 'visibleFacts' | 'consistencyConstraints'>,
): UseDirectionCanaryCase {
  return {
    id,
    expectedFamily,
    audioMode,
    targetLanguage,
    config,
    profile: {
      colors: '',
      suggestedAudience: '适合希望在真实使用场景中看清产品的人群',
      suggestedScenarios: '真实使用场景与产品细节展示',
      needsConfirmation: [],
      userConfirmedClaims: '',
      ...profile,
    },
  };
}

function emit(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main() {
  let physicalRequestGuard: PromptWizardAttempt26PhysicalRequestGuard | null = null;
  try {
    const runtime = createPromptWizardAttempt26ArkRuntime();
    physicalRequestGuard = runtime.physicalRequestGuard;
    await runPromptWizardUseDirectionCanary(runtime.provider, { physicalRequestGuard });
  } catch (error) {
    emit(buildPromptWizardCanaryAbortEvent(error));
    process.exitCode = 1;
  } finally {
    emit(buildPromptWizardAttempt26PhysicalRequestEvent(
      physicalRequestGuard?.snapshot()
        ?? emptyPromptWizardAttempt26PhysicalRequestSnapshot(),
    ));
  }
}

const PROMPT_WIZARD_CANARY_ABORT_MESSAGE = 'V6 Provider Canary 未通过';

const CANARY_ERROR_CODES = new Set([
  'PROMPT_WIZARD_BEAT_INVALID',
  'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED',
  'PROMPT_WIZARD_CONCEPT_DRIFT',
  'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
  'PROMPT_WIZARD_CONTENT_REPAIR_REQUIRED',
  'PROMPT_WIZARD_CONVERSION_CTA_INVALID',
  'PROMPT_WIZARD_DIVERSITY_FAILED',
  'PROMPT_WIZARD_EVIDENCE_INVALID',
  'PROMPT_WIZARD_EVIDENCE_UNAVAILABLE',
  'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED',
  'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
  'PROMPT_WIZARD_PRODUCT_INPUT_CLAIM_INVALID',
  'PROMPT_WIZARD_PROMPT_TOO_LONG',
  'PROMPT_WIZARD_PROVIDER_ATTEMPT_TIMEOUT',
  'PROMPT_WIZARD_PROVIDER_CONNECTION_ERROR',
  'PROMPT_WIZARD_PROVIDER_CONTENT_FILTER',
  'PROMPT_WIZARD_PROVIDER_EMPTY',
  'PROMPT_WIZARD_PROVIDER_EMPTY_STREAM',
  'PROMPT_WIZARD_PROVIDER_HTTP_ERROR',
  'PROMPT_WIZARD_PROVIDER_INCOMPLETE_STREAM',
  'PROMPT_WIZARD_PROVIDER_INPUT_INVALID',
  'PROMPT_WIZARD_PROVIDER_INVALID_CONTENT_TYPE',
  'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
  'PROMPT_WIZARD_PROVIDER_INVALID_SSE_JSON',
  'PROMPT_WIZARD_PROVIDER_LEDGER_WRITE_FAILED',
  'PROMPT_WIZARD_PROVIDER_MALFORMED_RESPONSE',
  'PROMPT_WIZARD_PROVIDER_MAX_OUTPUT_TOKENS',
  'PROMPT_WIZARD_PROVIDER_MULTIPLE_OUTPUT_TEXT',
  'PROMPT_WIZARD_PROVIDER_NOT_CONFIGURED',
  'PROMPT_WIZARD_PROVIDER_POSTPROCESSING_FAILED',
  'PROMPT_WIZARD_PROVIDER_REQUEST_FAILED',
  'PROMPT_WIZARD_PROVIDER_RESPONSE_FAILED',
  'PROMPT_WIZARD_PROVIDER_RESPONSE_INCOMPLETE',
  'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
  'PROMPT_WIZARD_REFERENCE_INVALID',
  'PROMPT_WIZARD_REFERENCE_MODE_INVALID',
  'PROMPT_WIZARD_ROUTE_SET_INVALID',
  'PROMPT_WIZARD_SOUND_DESIGN_VISUAL_CLOSURE_INVALID',
  'PROMPT_WIZARD_TARGET_LANGUAGE_REQUIRED',
  'PROMPT_WIZARD_TIMELINE_INVALID',
  'PROMPT_WIZARD_TRANSLATION_INVALID',
  'PROMPT_WIZARD_TRANSLATION_LEAK',
  'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
  'PROMPT_WIZARD_UNSAFE_CONTENT',
  'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID',
  'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
]);

/**
 * Canary 失败事件是可持久审计边界：不得直接写入 Error.message、Provider
 * 错误正文、商品或口播内容，只保留本地白名单中的结构化诊断字段。
 */
export function buildPromptWizardCanaryAbortEvent(error: unknown) {
  return {
    event: 'prompt-wizard-v6-canary-aborted',
    ok: false,
    error: PROMPT_WIZARD_CANARY_ABORT_MESSAGE,
    ...promptWizardCanaryErrorDetails(error),
  } as const;
}

const CANARY_EXECUTION_BUDGET_ISSUE_CODES = new Set([
  'TOO_MANY_LOCATIONS',
  'TOO_MANY_PEOPLE',
  'TOO_MANY_ACTIONS',
  'TOO_MANY_PROPS',
  'TOO_MANY_CAMERA_MOVES',
  'MAGIC_TRANSITION_FORBIDDEN',
]);

/**
 * Canary 只记录预算代码、路径和数值，不记录商品、口播或 Provider 原文。
 * 终态编排会尽量保留原始 ExecutionBudgetError；cause 链兼容聚合错误。
 */
export function promptWizardCanaryErrorDetails(error: unknown) {
  if (!error || typeof error !== 'object') return {};
  const candidate = error as {
    code?: unknown;
    fieldPaths?: unknown;
    repairRounds?: unknown;
    planIndexes?: unknown;
  };
  const executionBudgetIssues = promptWizardCanaryExecutionBudgetIssues(error);
  const voiceoverCoverage = promptWizardCanaryVoiceoverCoverageDetails(error);
  const repairState = promptWizardCanaryRepairState(error);
  const errorCode = typeof candidate.code === 'string' && CANARY_ERROR_CODES.has(candidate.code)
    ? candidate.code
    : null;
  const fieldPaths = Array.isArray(candidate.fieldPaths)
    ? Array.from(new Set(candidate.fieldPaths.filter(isPromptWizardCanarySafeFieldPath))).slice(0, 24)
    : [];
  return {
    ...(errorCode ? { errorCode } : {}),
    ...(fieldPaths.length > 0 ? { fieldPaths } : {}),
    ...(Number.isSafeInteger(candidate.repairRounds)
      && Number(candidate.repairRounds) >= 0
      && Number(candidate.repairRounds) <= 3
      ? { repairRounds: candidate.repairRounds }
      : {}),
    ...(Array.isArray(candidate.planIndexes)
      ? {
          planIndexes: Array.from(new Set(
            candidate.planIndexes.filter(value => value === 0 || value === 1 || value === 2),
          )),
        }
      : {}),
    ...(executionBudgetIssues.length > 0 ? { executionBudgetIssues } : {}),
    ...(voiceoverCoverage ? { voiceoverCoverage } : {}),
    ...(repairState ? {
      contentRepairRequestCounts: repairState.contentRepairRequestCounts,
      terminalCalibrationRequestCounts: repairState.terminalCalibrationRequestCounts,
      repairDiagnostics: repairState.repairDiagnostics,
    } : {}),
  };
}

function promptWizardCanaryVoiceoverCoverageDetails(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { code?: unknown; details?: unknown };
  if (
    candidate.code !== 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID'
    || !candidate.details
    || typeof candidate.details !== 'object'
  ) return null;
  const details = candidate.details as Record<string, unknown>;
  const actualUnits = details.actualUnits;
  const minUnits = details.minUnits;
  const maxUnits = details.maxUnits;
  const unit = details.unit;
  if (
    !Number.isSafeInteger(actualUnits)
    || !Number.isSafeInteger(minUnits)
    || !Number.isSafeInteger(maxUnits)
    || Number(actualUnits) < 0
    || Number(minUnits) < 1
    || Number(maxUnits) < Number(minUnits)
    || (unit !== 'words' && unit !== 'characters')
  ) return null;

  const readUnits = (key: string) => {
    const value = details[key];
    if (
      !Array.isArray(value)
      || value.length < 1
      || value.length > 8
      || value.some(item => !Number.isSafeInteger(item) || Number(item) < 0 || Number(item) > 1_000)
    ) return null;
    return value.map(Number);
  };
  const segmentActualUnits = readUnits('segmentActualUnits');
  const segmentMinUnits = readUnits('segmentMinUnits');
  const segmentTargetUnits = readUnits('segmentTargetUnits');
  const segmentMaxUnits = readUnits('segmentMaxUnits');
  if (
    !segmentActualUnits
    || !segmentMinUnits
    || !segmentTargetUnits
    || !segmentMaxUnits
    || new Set([
      segmentActualUnits.length,
      segmentMinUnits.length,
      segmentTargetUnits.length,
      segmentMaxUnits.length,
    ]).size !== 1
    || segmentMinUnits.some((minimum, index) => (
      minimum < 1
      || minimum > segmentTargetUnits[index]!
      || segmentTargetUnits[index]! > segmentMaxUnits[index]!
    ))
    || segmentActualUnits.reduce((sum, value) => sum + value, 0) !== actualUnits
    || segmentMinUnits.reduce((sum, value) => sum + value, 0) !== minUnits
    || segmentMaxUnits.reduce((sum, value) => sum + value, 0) !== maxUnits
  ) return null;
  const targetUnits = segmentTargetUnits.reduce((sum, value) => sum + value, 0);
  if (targetUnits < Number(minUnits) || targetUnits > Number(maxUnits)) return null;
  return {
    actualUnits: Number(actualUnits),
    minUnits: Number(minUnits),
    targetUnits,
    maxUnits: Number(maxUnits),
    unit,
    segmentActualUnits,
    segmentMinUnits,
    segmentTargetUnits,
    segmentMaxUnits,
  };
}

function promptWizardCanaryExecutionBudgetIssues(error: unknown) {
  const result: Array<{
    code: string;
    fieldPath: string;
    actual: number | boolean;
    limit: number | boolean;
  }> = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== 'object') break;
    const candidate = current as { issues?: unknown; cause?: unknown };
    if (Array.isArray(candidate.issues)) {
      candidate.issues.forEach(issue => {
        if (!issue || typeof issue !== 'object' || result.length >= 12) return;
        const value = issue as Record<string, unknown>;
        const code = value.code;
        const fieldPath = value.fieldPath;
        const actual = value.actual;
        const limit = value.limit;
        if (
          typeof code !== 'string'
          || !CANARY_EXECUTION_BUDGET_ISSUE_CODES.has(code)
          || typeof fieldPath !== 'string'
          || !/^segments(?:\[\d{1,2}\])?$/u.test(fieldPath)
          || !(
            (typeof actual === 'number' && Number.isSafeInteger(actual))
            || typeof actual === 'boolean'
          )
          || !(
            (typeof limit === 'number' && Number.isSafeInteger(limit))
            || typeof limit === 'boolean'
          )
          || typeof actual !== typeof limit
        ) return;
        result.push({ code, fieldPath, actual, limit });
      });
    }
    current = candidate.cause;
  }
  return result;
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry!) === fileURLToPath(import.meta.url);
}

if (isMainModule()) void main();
