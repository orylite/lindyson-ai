import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PromptWizardAudioMode,
  PromptWizardPlanV6,
  PromptWizardProductProfile,
  PromptWizardRouteSetV6,
  PromptWizardVideoConfig,
} from '@lindyson/api-contracts';
import { env } from '../config/env.js';
import {
  assertPromptWizardConversionCta,
  assertPromptWizardMotionDensity,
  assertPromptWizardSoundDesignOnlyVisualClosure,
  assertPromptWizardVoiceoverCoverage,
  promptWizardContainsStaticInstruction,
} from '../domain/promptWizardConversionQuality.js';
import { buildPromptWizardProductionBrief } from '../domain/promptWizardCreativePlaybook.js';
import { buildPromptWizardEvidenceGraph } from '../domain/promptWizardEvidenceGraph.js';
import {
  assertPromptWizardExecutionPromptIsolation,
  PROMPT_WIZARD_SOUND_DESIGN_ONLY_INSTRUCTION,
} from '../domain/promptWizardPrompt.js';
import {
  generateValidatedPromptWizardRoutePlansV6,
  type PromptWizardV6PlanRequestCounts,
} from '../domain/promptWizardService.js';
import {
  buildPromptWizardRouteSetV6,
  PROMPT_WIZARD_V6_ROUTE_ROLES,
} from '../domain/promptWizardV6Routes.js';
import { ArkPromptWizardResponsesClient } from '../providers/arkPromptWizardResponsesClient.js';
import {
  ArkPromptWizardProvider,
  type PromptWizardProvider,
} from '../providers/promptWizardProvider.js';
import {
  buildPromptWizardCanaryAbortEvent,
  buildPromptWizardCanaryRepairDiagnosticsEvent,
} from './canaryPromptWizardUseDirections.js';

type PromptWizardAttempt24PlanIndex = 0 | 1 | 2;
type PromptWizardResponsesClient = NonNullable<
  ConstructorParameters<typeof ArkPromptWizardProvider>[0]
>;

const ATTEMPT24_EXPECTED_BATCH_COUNT = 2;
const ATTEMPT24_EXPECTED_PLAN_COUNT = 6;
const ATTEMPT24_MAX_CONTENT_REPAIRS_PER_PLAN = 2;
const ATTEMPT24_MAX_TERMINAL_CALIBRATIONS_PER_PLAN = 1;
const ATTEMPT24_GLOBAL_PHYSICAL_REQUEST_LIMIT = 27;
const ATTEMPT24_ABORT_MESSAGE = 'Prompt Wizard Attempt24 诊断未通过';

const ATTEMPT24_PROTOCOL_EVENTS = new Set([
  'prompt-wizard-attempt24-initial-provider-identity',
  'prompt-wizard-attempt24-repair-diagnostics',
  'prompt-wizard-attempt24-batch',
  'prompt-wizard-attempt24-diagnostic-completed',
  'prompt-wizard-attempt24-diagnostic-aborted',
]);

const ATTEMPT24_APPAREL_PROFILE: PromptWizardProductProfile = {
  productName: '短袖运动上衣',
  category: '服饰',
  materials: '纺织面料',
  colors: '',
  structure: '圆领、短袖、直筒版型',
  logo: '胸前有可见字母印花',
  usage: '套头穿着',
  visibleFacts: ['参考图片中可见短袖上衣正面、圆领与胸前印花'],
  suggestedAudience: '适合希望在真实使用场景中看清产品的人群',
  suggestedScenarios: '真实穿着场景与产品细节展示',
  consistencyConstraints: '保持圆领、短袖、版型和胸前印花位置一致',
  needsConfirmation: [],
  userConfirmedClaims: '',
};

export interface PromptWizardAttempt24DiagnosticCase {
  id: '服饰-5s-sound-only' | '服饰-10s-en';
  audioMode: PromptWizardAudioMode;
  targetLanguage: string | null;
  config: PromptWizardVideoConfig;
  physicalRequestLimit: 12 | 15;
}

export interface PromptWizardAttempt24PhysicalRequestSnapshot {
  globalCount: number;
  caseCounts: {
    '服饰-5s-sound-only': number;
    '服饰-10s-en': number;
  };
}

export const PROMPT_WIZARD_ATTEMPT24_DIAGNOSTIC_CASES = [
  {
    id: '服饰-5s-sound-only',
    audioMode: 'sound-design-only',
    targetLanguage: null,
    config: {
      model: 'seedance-2.0-mini',
      aspectRatio: '9:16',
      resolution: '480p',
      durationSeconds: 5,
    },
    physicalRequestLimit: 12,
  },
  {
    id: '服饰-10s-en',
    audioMode: 'voiceover',
    targetLanguage: '英语',
    config: {
      model: 'seedance-2.0-fast',
      aspectRatio: '9:16',
      resolution: '720p',
      durationSeconds: 10,
    },
    physicalRequestLimit: 15,
  },
] as const satisfies readonly PromptWizardAttempt24DiagnosticCase[];

const ATTEMPT24_CASE_BY_ID = new Map(
  PROMPT_WIZARD_ATTEMPT24_DIAGNOSTIC_CASES.map(testCase => [testCase.id, testCase]),
);

/**
 * 物理请求硬帽位于 Ark responses.create 的最内层边界。计数先于底层调用
 * 同步递增，因此同一事件循环内并发启动的三路请求也不能越过上限。
 */
export class PromptWizardAttempt24PhysicalRequestGuard
implements PromptWizardResponsesClient {
  private activeCaseId: PromptWizardAttempt24DiagnosticCase['id'] | null = null;
  private readonly caseCounts = new Map<PromptWizardAttempt24DiagnosticCase['id'], number>();
  private globalCount = 0;

  constructor(private readonly delegate: PromptWizardResponsesClient) {}

  enterCase(caseId: PromptWizardAttempt24DiagnosticCase['id']) {
    if (!ATTEMPT24_CASE_BY_ID.has(caseId)) {
      throw attempt24RequestLimitError();
    }
    this.activeCaseId = caseId;
  }

  leaveCase(caseId: PromptWizardAttempt24DiagnosticCase['id']) {
    if (this.activeCaseId === caseId) this.activeCaseId = null;
  }

  snapshot(): PromptWizardAttempt24PhysicalRequestSnapshot {
    return {
      globalCount: this.globalCount,
      caseCounts: {
        '服饰-5s-sound-only': this.caseCounts.get('服饰-5s-sound-only') ?? 0,
        '服饰-10s-en': this.caseCounts.get('服饰-10s-en') ?? 0,
      },
    };
  }

  create(
    request: Parameters<PromptWizardResponsesClient['create']>[0],
    options: Parameters<PromptWizardResponsesClient['create']>[1],
  ): ReturnType<PromptWizardResponsesClient['create']> {
    const caseId = this.activeCaseId;
    const testCase = caseId ? ATTEMPT24_CASE_BY_ID.get(caseId) : null;
    if (!caseId || !testCase) {
      return Promise.reject(attempt24RequestLimitError()) as ReturnType<
        PromptWizardResponsesClient['create']
      >;
    }
    const caseCount = this.caseCounts.get(caseId) ?? 0;
    if (
      caseCount >= testCase.physicalRequestLimit
      || this.globalCount >= ATTEMPT24_GLOBAL_PHYSICAL_REQUEST_LIMIT
    ) {
      return Promise.reject(attempt24RequestLimitError()) as ReturnType<
        PromptWizardResponsesClient['create']
      >;
    }
    this.caseCounts.set(caseId, caseCount + 1);
    this.globalCount += 1;
    return this.delegate.create(request, options);
  }
}

function attempt24RequestLimitError() {
  return Object.assign(new Error('Attempt24 Provider 物理请求预算已耗尽'), {
    code: 'PROMPT_WIZARD_PROVIDER_REQUEST_FAILED',
    retryable: false,
  });
}

export function createPromptWizardAttempt24ArkRuntime() {
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
  const physicalRequestGuard = new PromptWizardAttempt24PhysicalRequestGuard(responses);
  return {
    provider: new ArkPromptWizardProvider(physicalRequestGuard),
    physicalRequestGuard,
  };
}

function emptyAttempt24PhysicalRequestSnapshot(): PromptWizardAttempt24PhysicalRequestSnapshot {
  return {
    globalCount: 0,
    caseCounts: {
      '服饰-5s-sound-only': 0,
      '服饰-10s-en': 0,
    },
  };
}

function readAttempt24PhysicalRequestSnapshot(
  runtime: PromptWizardAttempt24Runtime,
): PromptWizardAttempt24PhysicalRequestSnapshot {
  const snapshot = runtime.physicalRequestGuard?.snapshot()
    ?? runtime.physicalRequestSnapshot?.();
  if (!snapshot) {
    throw attempt24EvidenceError('Attempt24 缺少物理请求计数来源');
  }
  return normalizeAttempt24PhysicalRequestSnapshot(snapshot);
}

interface PromptWizardAttempt24Runtime {
  provider: PromptWizardProvider;
  physicalRequestGuard?: PromptWizardAttempt24PhysicalRequestGuard;
  /** Fake/定向测试不构造 Ark guard 时必须显式注入确定性纯数字快照。 */
  physicalRequestSnapshot?: () => PromptWizardAttempt24PhysicalRequestSnapshot;
}

interface PromptWizardAttempt24Dependencies {
  generateRoutePlans?: typeof generateValidatedPromptWizardRoutePlansV6;
  emit?: (event: Record<string, unknown>) => void;
}

interface PromptWizardAttempt24RepairState {
  contentRepairRequestCounts: PromptWizardV6PlanRequestCounts;
  terminalCalibrationRequestCounts: PromptWizardV6PlanRequestCounts;
  repairDiagnostics: Array<{
    planIndex: PromptWizardAttempt24PlanIndex;
    origin: 'initial-schema' | 'domain-validation' | 'terminal-calibration';
    repairRound: 1 | 2 | 3;
    errorCode: string;
    fieldPaths: string[];
  }>;
}

export async function runPromptWizardAttempt24Diagnostic(
  runtime: PromptWizardAttempt24Runtime = createPromptWizardAttempt24ArkRuntime(),
  dependencies: PromptWizardAttempt24Dependencies = {},
) {
  const emitEvent = dependencies.emit ?? emit;
  const generateRoutePlans = dependencies.generateRoutePlans
    ?? generateValidatedPromptWizardRoutePlansV6;
  // 在任何 Provider 调用前确认存在可审计的物理计数来源；Fake 测试必须显式
  // 注入确定性快照，生产入口则始终读取 responses.create guard。
  readAttempt24PhysicalRequestSnapshot(runtime);
  let deliveredPlanCount = 0;

  for (const [caseIndex, testCase] of PROMPT_WIZARD_ATTEMPT24_DIAGNOSTIC_CASES.entries()) {
    const profile = cloneAttempt24Profile();
    const evidenceGraph = buildPromptWizardEvidenceGraph(profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: attempt24Uuid(600 + caseIndex),
      runId: attempt24Uuid(500 + caseIndex),
      runRevision: 1,
      profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(profile),
      createdAt: '2026-08-08T00:00:00.000Z',
    });
    runtime.physicalRequestGuard?.enterCase(testCase.id);
    let expanded: Awaited<ReturnType<typeof generateRoutePlans>>;
    try {
      expanded = await generateRoutePlans({
        provider: attempt24ProviderWithIdentityEvent(
          runtime.provider,
          testCase.id,
          emitEvent,
        ),
        profile,
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
      const diagnosticEvent = tryBuildAttempt24RepairDiagnosticsEvent({
        caseId: testCase.id,
        value: error,
      });
      if (diagnosticEvent) emitEvent(diagnosticEvent);
      throw error;
    } finally {
      runtime.physicalRequestGuard?.leaveCase(testCase.id);
    }

    const diagnosticEvent = buildPromptWizardAttempt24RepairDiagnosticsEvent({
      caseId: testCase.id,
      value: expanded,
    });
    emitEvent(diagnosticEvent);
    assertAttempt24Batch({
      testCase,
      routeSet,
      plans: expanded.plans as PromptWizardPlanV6[],
      repairState: diagnosticEvent,
    });
    deliveredPlanCount += expanded.plans.length;
    emitEvent({
      event: 'prompt-wizard-attempt24-batch',
      id: testCase.id,
      ok: true,
      planCount: expanded.plans.length,
      audioMode: testCase.audioMode,
      targetLanguage: testCase.targetLanguage,
      contentRepairRequestCounts: [...diagnosticEvent.contentRepairRequestCounts],
      terminalCalibrationRequestCounts: [
        ...diagnosticEvent.terminalCalibrationRequestCounts,
      ],
    });
  }

  const completedEvent = {
    event: 'prompt-wizard-attempt24-diagnostic-completed',
    ok: true,
    completed: ATTEMPT24_EXPECTED_BATCH_COUNT,
    deliveredPlanCount,
    diagnosticComplete: true,
    releaseAllowed: false,
    physicalRequestSnapshot: readAttempt24PhysicalRequestSnapshot(runtime),
  } as const;
  emitEvent(completedEvent);
  return completedEvent;
}

function cloneAttempt24Profile(): PromptWizardProductProfile {
  return {
    ...ATTEMPT24_APPAREL_PROFILE,
    visibleFacts: [...ATTEMPT24_APPAREL_PROFILE.visibleFacts],
    needsConfirmation: [...ATTEMPT24_APPAREL_PROFILE.needsConfirmation],
  };
}

function assertAttempt24Batch(input: {
  testCase: PromptWizardAttempt24DiagnosticCase;
  routeSet: PromptWizardRouteSetV6;
  plans: PromptWizardPlanV6[];
  repairState: PromptWizardAttempt24RepairState;
}) {
  if (
    input.routeSet.routes.length !== 3
    || input.routeSet.routes.some((route, index) => (
      route.role !== PROMPT_WIZARD_V6_ROUTE_ROLES[index]
      || route.evidenceRefs.length === 0
      || !route.proofActionZh.trim()
    ))
    || new Set(input.routeSet.routes.map(route => route.titleZh)).size !== 3
  ) {
    throw Object.assign(new Error('Attempt24 未交付三个完整可追溯商业路线'), {
      code: 'PROMPT_WIZARD_ROUTE_SET_INVALID',
    });
  }
  if (
    input.plans.length !== 3
    || input.plans.some((plan, index) => (
      plan.deliveryVersion !== 6
      || plan.audioMode !== input.testCase.audioMode
      || plan.role !== PROMPT_WIZARD_V6_ROUTE_ROLES[index]
    ))
  ) {
    throw Object.assign(new Error('Attempt24 未交付完整 V6 三方向'), {
      code: 'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID',
    });
  }
  assertAttempt24RepairState(input.repairState);
  for (const plan of input.plans) {
    assertPromptWizardMotionDensity({
      shots: plan.shots,
      durationSeconds: input.testCase.config.durationSeconds,
    });
    if (input.testCase.audioMode === 'sound-design-only') {
      assertPromptWizardSoundDesignOnlyVisualClosure({ shots: plan.shots });
      if (
        input.testCase.targetLanguage !== null
        || !plan.prompt.includes(PROMPT_WIZARD_SOUND_DESIGN_ONLY_INSTRUCTION)
      ) {
        throw Object.assign(new Error('Attempt24 5 秒声音模式无效'), {
          code: 'PROMPT_WIZARD_SOUND_DESIGN_VISUAL_CLOSURE_INVALID',
          fieldPaths: ['prompt'],
        });
      }
    } else {
      if (input.testCase.targetLanguage !== '英语') {
        throw Object.assign(new Error('Attempt24 10 秒必须使用英语口播'), {
          code: 'PROMPT_WIZARD_TARGET_LANGUAGE_REQUIRED',
          fieldPaths: ['targetLanguage'],
        });
      }
      assertPromptWizardVoiceoverCoverage({
        shots: plan.shots,
        targetLanguage: input.testCase.targetLanguage,
        durationSeconds: input.testCase.config.durationSeconds,
        profile: cloneAttempt24Profile(),
      });
      assertPromptWizardConversionCta({
        shots: plan.shots,
        targetLanguage: input.testCase.targetLanguage,
      });
    }
    if (promptWizardContainsStaticInstruction(plan.prompt)) {
      throw Object.assign(new Error('Attempt24 生产提示词仍包含静态禁用词'), {
        code: 'PROMPT_WIZARD_UNSAFE_CONTENT',
        fieldPaths: ['prompt'],
      });
    }
    assertPromptWizardExecutionPromptIsolation({
      prompt: plan.prompt,
      ...(input.testCase.targetLanguage
        ? { targetLanguage: input.testCase.targetLanguage }
        : {}),
      shots: plan.shots,
    });
  }
}

function attempt24ProviderWithIdentityEvent(
  provider: PromptWizardProvider,
  caseId: PromptWizardAttempt24DiagnosticCase['id'],
  emitEvent: (event: Record<string, unknown>) => void,
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
            || !isAttempt24PlanIndex(context.planIndex)
            || context.routeRole !== PROMPT_WIZARD_V6_ROUTE_ROLES[context.planIndex]
          ) {
            throw Object.assign(new Error('Attempt24 初始 Provider 身份无效'), {
              code: 'PROMPT_WIZARD_PROVIDER_INPUT_INVALID',
            });
          }
          emitEvent({
            event: 'prompt-wizard-attempt24-initial-provider-identity',
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

export function buildPromptWizardAttempt24RepairDiagnosticsEvent(input: {
  caseId: PromptWizardAttempt24DiagnosticCase['id'];
  value: unknown;
}) {
  const safe = buildPromptWizardCanaryRepairDiagnosticsEvent(input);
  const event = {
    event: 'prompt-wizard-attempt24-repair-diagnostics',
    caseId: input.caseId,
    contentRepairRequestCounts: [...safe.contentRepairRequestCounts] as PromptWizardV6PlanRequestCounts,
    terminalCalibrationRequestCounts: [
      ...safe.terminalCalibrationRequestCounts,
    ] as PromptWizardV6PlanRequestCounts,
    repairDiagnostics: safe.repairDiagnostics.map(diagnostic => ({
      planIndex: diagnostic.planIndex,
      origin: diagnostic.origin,
      repairRound: diagnostic.repairRound,
      errorCode: diagnostic.errorCode,
      fieldPaths: [...diagnostic.fieldPaths],
    })),
  };
  assertAttempt24RepairState(event);
  return event;
}

function tryBuildAttempt24RepairDiagnosticsEvent(input: {
  caseId: PromptWizardAttempt24DiagnosticCase['id'];
  value: unknown;
}) {
  if (!isRecord(input.value)) return null;
  if (
    !Object.hasOwn(input.value, 'contentRepairRequestCounts')
    && !Object.hasOwn(input.value, 'terminalCalibrationRequestCounts')
    && !Object.hasOwn(input.value, 'repairDiagnostics')
  ) return null;
  return buildPromptWizardAttempt24RepairDiagnosticsEvent(input);
}

function assertAttempt24RepairState(
  value: PromptWizardAttempt24RepairState,
): asserts value is PromptWizardAttempt24RepairState {
  if (
    !isRequestCounts(value.contentRepairRequestCounts, ATTEMPT24_MAX_CONTENT_REPAIRS_PER_PLAN)
    || !isRequestCounts(
      value.terminalCalibrationRequestCounts,
      ATTEMPT24_MAX_TERMINAL_CALIBRATIONS_PER_PLAN,
    )
    || value.repairDiagnostics.some(diagnostic => (
      diagnostic.origin === 'terminal-calibration'
        ? diagnostic.repairRound !== 3
        : diagnostic.repairRound > 2
    ))
  ) {
    throw attempt24EvidenceError('Attempt24 修复计数超过生产预算');
  }
}

function isRequestCounts(value: unknown, maximum: number): value is PromptWizardV6PlanRequestCounts {
  return Array.isArray(value)
    && value.length === 3
    && value.every(count => (
      typeof count === 'number'
      && Number.isSafeInteger(count)
      && count >= 0
      && count <= maximum
    ));
}

export function buildPromptWizardAttempt24AbortEvent(
  error: unknown,
  physicalRequestSnapshot: PromptWizardAttempt24PhysicalRequestSnapshot,
) {
  const safe = buildPromptWizardCanaryAbortEvent(error);
  const { event: _event, ok: _ok, error: _error, ...details } = safe;
  return {
    event: 'prompt-wizard-attempt24-diagnostic-aborted',
    ok: false,
    error: ATTEMPT24_ABORT_MESSAGE,
    diagnosticComplete: false,
    releaseAllowed: false,
    physicalRequestSnapshot: normalizeAttempt24PhysicalRequestSnapshot(
      physicalRequestSnapshot,
    ),
    ...details,
  } as const;
}

export function assertPromptWizardAttempt24DiagnosticEventContract(
  events: readonly unknown[],
) {
  const states = PROMPT_WIZARD_ATTEMPT24_DIAGNOSTIC_CASES.map(testCase => ({
    testCase,
    identities: new Set<PromptWizardAttempt24PlanIndex>(),
    repairState: null as PromptWizardAttempt24RepairState | null,
    completed: false,
  }));
  let activeCaseIndex = 0;
  let terminal: Record<string, unknown> | null = null;

  for (const candidate of events) {
    if (!isRecord(candidate)) continue;
    if (terminal) throw attempt24EvidenceError('Attempt24 终态后仍出现事件');
    const eventName = candidate.event;
    if (typeof eventName !== 'string') continue;
    if (
      eventName.startsWith('prompt-wizard-attempt24-')
      && !ATTEMPT24_PROTOCOL_EVENTS.has(eventName)
    ) {
      throw attempt24EvidenceError('Attempt24 出现未知协议事件');
    }
    if (!ATTEMPT24_PROTOCOL_EVENTS.has(eventName)) continue;

    if (
      eventName === 'prompt-wizard-attempt24-diagnostic-completed'
      || eventName === 'prompt-wizard-attempt24-diagnostic-aborted'
    ) {
      terminal = candidate;
      continue;
    }

    const state = states[activeCaseIndex];
    if (!state) throw attempt24EvidenceError('Attempt24 出现超出两批的协议事件');
    if (eventName === 'prompt-wizard-attempt24-initial-provider-identity') {
      assertExactKeys(candidate, ['event', 'caseId', 'planIndex', 'role']);
      if (
        candidate.caseId !== state.testCase.id
        || !isAttempt24PlanIndex(candidate.planIndex)
        || candidate.role !== PROMPT_WIZARD_V6_ROUTE_ROLES[candidate.planIndex]
        || state.repairState
        || state.identities.has(candidate.planIndex)
      ) {
        throw attempt24EvidenceError('Attempt24 初始 Provider 身份无效或重复');
      }
      state.identities.add(candidate.planIndex);
      continue;
    }
    if (eventName === 'prompt-wizard-attempt24-repair-diagnostics') {
      assertExactKeys(candidate, [
        'event',
        'caseId',
        'contentRepairRequestCounts',
        'terminalCalibrationRequestCounts',
        'repairDiagnostics',
      ]);
      if (
        candidate.caseId !== state.testCase.id
        || state.identities.size !== 3
        || state.repairState
      ) {
        throw attempt24EvidenceError('Attempt24 修复诊断批次身份无效');
      }
      state.repairState = repairStateFromProtocolEvent(candidate, state.testCase.id);
      continue;
    }
    if (eventName === 'prompt-wizard-attempt24-batch') {
      assertExactKeys(candidate, [
        'event',
        'id',
        'ok',
        'planCount',
        'audioMode',
        'targetLanguage',
        'contentRepairRequestCounts',
        'terminalCalibrationRequestCounts',
      ]);
      if (
        candidate.id !== state.testCase.id
        || candidate.ok !== true
        || candidate.planCount !== 3
        || candidate.audioMode !== state.testCase.audioMode
        || candidate.targetLanguage !== state.testCase.targetLanguage
        || state.identities.size !== 3
        || !state.repairState
        || !sameJson(candidate.contentRepairRequestCounts, state.repairState.contentRepairRequestCounts)
        || !sameJson(
          candidate.terminalCalibrationRequestCounts,
          state.repairState.terminalCalibrationRequestCounts,
        )
      ) {
        throw attempt24EvidenceError('Attempt24 批次事件与修复诊断不一致');
      }
      state.completed = true;
      activeCaseIndex += 1;
    }
  }

  if (!terminal) throw attempt24EvidenceError('Attempt24 缺少唯一终态');
  if (terminal.event === 'prompt-wizard-attempt24-diagnostic-completed') {
    assertExactKeys(terminal, [
      'event',
      'ok',
      'completed',
      'deliveredPlanCount',
      'diagnosticComplete',
      'releaseAllowed',
      'physicalRequestSnapshot',
    ]);
    const physicalRequestSnapshot = normalizeAttempt24PhysicalRequestSnapshot(
      terminal.physicalRequestSnapshot,
    );
    if (
      terminal.ok !== true
      || terminal.completed !== ATTEMPT24_EXPECTED_BATCH_COUNT
      || terminal.deliveredPlanCount !== ATTEMPT24_EXPECTED_PLAN_COUNT
      || terminal.diagnosticComplete !== true
      || terminal.releaseAllowed !== false
      || activeCaseIndex !== ATTEMPT24_EXPECTED_BATCH_COUNT
      || states.some(state => !state.completed || state.identities.size !== 3 || !state.repairState)
    ) {
      throw attempt24EvidenceError('Attempt24 completed 终态证据不完整');
    }
    return {
      state: 'diagnostic-completed' as const,
      ok: true as const,
      diagnosticComplete: true as const,
      releaseAllowed: false as const,
      observedIdentityCount: ATTEMPT24_EXPECTED_PLAN_COUNT,
      completedBatchCount: ATTEMPT24_EXPECTED_BATCH_COUNT,
      physicalRequestSnapshot,
    };
  }

  assertAttempt24AbortEnvelope(terminal, states[activeCaseIndex] ?? null);
  return {
    state: 'diagnostic-aborted' as const,
    ok: false as const,
    diagnosticComplete: false as const,
    releaseAllowed: false as const,
    observedIdentityCount: states.reduce((total, state) => total + state.identities.size, 0),
    completedBatchCount: states.filter(state => state.completed).length,
    physicalRequestSnapshot: normalizeAttempt24PhysicalRequestSnapshot(
      terminal.physicalRequestSnapshot,
    ),
    ...(typeof terminal.errorCode === 'string' ? { errorCode: terminal.errorCode } : {}),
  };
}

export function parsePromptWizardAttempt24DiagnosticNdjson(input: {
  transcript: string;
  processExitCode: number;
}) {
  if (
    !Number.isSafeInteger(input.processExitCode)
    || input.processExitCode < 0
    || input.processExitCode > 255
  ) {
    throw attempt24EvidenceError('Attempt24 进程退出码无效');
  }
  const events = input.transcript.split(/\r?\n/u).flatMap(line => {
    if (!line.trim()) return [];
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw attempt24EvidenceError('Attempt24 NDJSON 包含无法解析的行');
    }
    if (!isRecord(value) || typeof value.event !== 'string') {
      throw attempt24EvidenceError('Attempt24 NDJSON 行缺少 event');
    }
    return [value];
  });
  const result = assertPromptWizardAttempt24DiagnosticEventContract(events);
  const processSucceeded = input.processExitCode === 0;
  if (
    (result.state === 'diagnostic-completed' && !processSucceeded)
    || (result.state === 'diagnostic-aborted' && processSucceeded)
  ) {
    throw attempt24EvidenceError('Attempt24 终态与进程退出码矛盾');
  }
  return {
    ...result,
    processExitCode: input.processExitCode,
  };
}

function repairStateFromProtocolEvent(
  candidate: Record<string, unknown>,
  caseId: PromptWizardAttempt24DiagnosticCase['id'],
) {
  const safe = buildPromptWizardAttempt24RepairDiagnosticsEvent({
    caseId,
    value: candidate,
  });
  if (
    !sameJson(candidate.contentRepairRequestCounts, safe.contentRepairRequestCounts)
    || !sameJson(candidate.terminalCalibrationRequestCounts, safe.terminalCalibrationRequestCounts)
    || !sameJson(candidate.repairDiagnostics, safe.repairDiagnostics)
    || (
      caseId === '服饰-5s-sound-only'
      && safe.terminalCalibrationRequestCounts.some(count => count > 0)
    )
  ) {
    throw attempt24EvidenceError('Attempt24 修复诊断包含非安全字段');
  }
  return {
    contentRepairRequestCounts: safe.contentRepairRequestCounts,
    terminalCalibrationRequestCounts: safe.terminalCalibrationRequestCounts,
    repairDiagnostics: safe.repairDiagnostics,
  };
}

function assertAttempt24AbortEnvelope(
  terminal: Record<string, unknown>,
  activeState: {
    testCase: PromptWizardAttempt24DiagnosticCase;
    repairState: PromptWizardAttempt24RepairState | null;
  } | null,
) {
  const allowedKeys = [
    'event',
    'ok',
    'error',
    'diagnosticComplete',
    'releaseAllowed',
    'physicalRequestSnapshot',
    'errorCode',
    'fieldPaths',
    'repairRounds',
    'planIndexes',
    'executionBudgetIssues',
    'voiceoverCoverage',
    'contentRepairRequestCounts',
    'terminalCalibrationRequestCounts',
    'repairDiagnostics',
  ];
  if (Object.keys(terminal).some(key => !allowedKeys.includes(key))) {
    throw attempt24EvidenceError('Attempt24 aborted 包含非白名单字段');
  }
  if (
    terminal.event !== 'prompt-wizard-attempt24-diagnostic-aborted'
    || terminal.ok !== false
    || terminal.error !== ATTEMPT24_ABORT_MESSAGE
    || terminal.diagnosticComplete !== false
    || terminal.releaseAllowed !== false
  ) {
    throw attempt24EvidenceError('Attempt24 aborted envelope 无效');
  }
  const sanitized = buildPromptWizardAttempt24AbortEvent({
    ...(typeof terminal.errorCode === 'string' ? { code: terminal.errorCode } : {}),
    ...(Object.hasOwn(terminal, 'fieldPaths') ? { fieldPaths: terminal.fieldPaths } : {}),
    ...(Object.hasOwn(terminal, 'repairRounds') ? { repairRounds: terminal.repairRounds } : {}),
    ...(Object.hasOwn(terminal, 'planIndexes') ? { planIndexes: terminal.planIndexes } : {}),
    ...(Object.hasOwn(terminal, 'executionBudgetIssues')
      ? { issues: terminal.executionBudgetIssues }
      : {}),
    ...(Object.hasOwn(terminal, 'voiceoverCoverage')
      ? { details: terminal.voiceoverCoverage }
      : {}),
    ...(Object.hasOwn(terminal, 'contentRepairRequestCounts')
      ? { contentRepairRequestCounts: terminal.contentRepairRequestCounts }
      : {}),
    ...(Object.hasOwn(terminal, 'terminalCalibrationRequestCounts')
      ? { terminalCalibrationRequestCounts: terminal.terminalCalibrationRequestCounts }
      : {}),
    ...(Object.hasOwn(terminal, 'repairDiagnostics')
      ? { repairDiagnostics: terminal.repairDiagnostics }
      : {}),
  }, normalizeAttempt24PhysicalRequestSnapshot(terminal.physicalRequestSnapshot));
  if (!sameJson(terminal, sanitized)) {
    throw attempt24EvidenceError('Attempt24 aborted 安全诊断无效');
  }
  const terminalHasRepairState = Object.hasOwn(terminal, 'contentRepairRequestCounts')
    || Object.hasOwn(terminal, 'terminalCalibrationRequestCounts')
    || Object.hasOwn(terminal, 'repairDiagnostics');
  if (terminalHasRepairState) {
    if (!activeState?.repairState) {
      throw attempt24EvidenceError('Attempt24 aborted 缺少已发修复诊断');
    }
    const terminalRepairState = repairStateFromProtocolEvent(terminal, activeState.testCase.id);
    if (!sameJson(terminalRepairState, activeState.repairState)) {
      throw attempt24EvidenceError('Attempt24 aborted 修复诊断与已发事件不一致');
    }
  }
}

function assertExactKeys(candidate: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(candidate).sort();
  const sortedExpected = [...expected].sort();
  if (!sameJson(actual, sortedExpected)) {
    throw attempt24EvidenceError('Attempt24 协议事件字段无效');
  }
}

function normalizeAttempt24PhysicalRequestSnapshot(
  value: unknown,
): PromptWizardAttempt24PhysicalRequestSnapshot {
  if (!isRecord(value)) {
    throw attempt24EvidenceError('Attempt24 物理请求计数结构无效');
  }
  assertExactKeys(value, ['globalCount', 'caseCounts']);
  if (!isRecord(value.caseCounts)) {
    throw attempt24EvidenceError('Attempt24 分批物理请求计数结构无效');
  }
  assertExactKeys(value.caseCounts, ['服饰-5s-sound-only', '服饰-10s-en']);
  const soundOnlyCount = value.caseCounts['服饰-5s-sound-only'];
  const englishCount = value.caseCounts['服饰-10s-en'];
  const globalCount = value.globalCount;
  if (
    !Number.isSafeInteger(soundOnlyCount)
    || typeof soundOnlyCount !== 'number'
    || soundOnlyCount < 0
    || soundOnlyCount > 12
    || !Number.isSafeInteger(englishCount)
    || typeof englishCount !== 'number'
    || englishCount < 0
    || englishCount > 15
    || !Number.isSafeInteger(globalCount)
    || typeof globalCount !== 'number'
    || globalCount < 0
    || globalCount > ATTEMPT24_GLOBAL_PHYSICAL_REQUEST_LIMIT
    || globalCount !== soundOnlyCount + englishCount
  ) {
    throw attempt24EvidenceError('Attempt24 物理请求计数超过硬帽或总分不一致');
  }
  return {
    globalCount,
    caseCounts: {
      '服饰-5s-sound-only': soundOnlyCount,
      '服饰-10s-en': englishCount,
    },
  };
}

function isAttempt24PlanIndex(value: unknown): value is PromptWizardAttempt24PlanIndex {
  return value === 0 || value === 1 || value === 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function attempt24EvidenceError(reason: string) {
  return Object.assign(new Error(reason), {
    code: 'PROMPT_WIZARD_ATTEMPT24_EVIDENCE_INVALID',
  });
}

function attempt24Uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function emit(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main() {
  let runtime: PromptWizardAttempt24Runtime | null = null;
  try {
    runtime = createPromptWizardAttempt24ArkRuntime();
    await runPromptWizardAttempt24Diagnostic(runtime);
  } catch (error) {
    let physicalRequestSnapshot = emptyAttempt24PhysicalRequestSnapshot();
    if (runtime) {
      try {
        physicalRequestSnapshot = readAttempt24PhysicalRequestSnapshot(runtime);
      } catch {
        // 诊断失败终态仍必须保持固定、无正文的零值计数结构。
      }
    }
    emit(buildPromptWizardAttempt24AbortEvent(error, physicalRequestSnapshot));
    process.exitCode = 1;
  }
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry!) === fileURLToPath(import.meta.url);
}

if (isMainModule()) void main();
