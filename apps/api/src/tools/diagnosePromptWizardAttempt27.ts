import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { buildPromptWizardEvidenceGraph } from '../domain/promptWizardEvidenceGraph.js';
import { buildPromptWizardProductionBrief } from '../domain/promptWizardCreativePlaybook.js';
import {
  buildPromptWizardRouteSetV6,
  promptWizardRouteContextsV6,
  PROMPT_WIZARD_V6_ROUTE_ROLES,
} from '../domain/promptWizardV6Routes.js';
import { ArkPromptWizardResponsesClient } from '../providers/arkPromptWizardResponsesClient.js';
import {
  ArkPromptWizardProvider,
  type PromptWizardOutputDiagnostic,
  type PromptWizardUseDirectionDraftGenerationContext,
} from '../providers/promptWizardProvider.js';
import { PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES } from './canaryPromptWizardUseDirections.js';
import {
  createPromptWizardAttempt27PhysicalRequestGuard,
  normalizePromptWizardCanaryPhysicalRequestSnapshot,
  PROMPT_WIZARD_ATTEMPT27_CASE_PHYSICAL_REQUEST_LIMIT,
  PROMPT_WIZARD_ATTEMPT27_FORCED_FORMAT_REPAIR_LIMIT,
  PROMPT_WIZARD_ATTEMPT27_GLOBAL_FORMAT_REPAIR_LIMIT,
  PROMPT_WIZARD_ATTEMPT27_GLOBAL_PHYSICAL_REQUEST_LIMIT,
  PROMPT_WIZARD_ATTEMPT27_NATURAL_FORMAT_REPAIR_LIMIT,
  type PromptWizardCanaryPhysicalRequestSnapshot,
} from './promptWizardCanaryV2Infrastructure.js';
import {
  normalizePromptWizardCanaryOutputDiagnostics,
  parsePromptWizardCanarySafeTranscript,
} from './promptWizardCanarySafeEvidence.js';

export const PROMPT_WIZARD_ATTEMPT27_CASE_IDS = [
  '服饰-10s-zh',
  '耳机-15s-en',
  '美妆-10s-ja',
] as const;
export const PROMPT_WIZARD_ATTEMPT27_PHYSICAL_REQUEST_EVENT =
  'prompt-wizard-v6-attempt27-physical-request-counts';

const ATTEMPT27_PROTOCOL_EVENTS = new Set([
  'prompt-wizard-v6-attempt27-initial-provider-identity',
  'prompt-wizard-v6-attempt27-output-diagnostics',
  'prompt-wizard-v6-attempt27-batch',
  'prompt-wizard-v6-attempt27-completed',
  'prompt-wizard-v6-attempt27-aborted',
  PROMPT_WIZARD_ATTEMPT27_PHYSICAL_REQUEST_EVENT,
]);

const ATTEMPT27_CASE_SPECS = [
  { id: '服饰-10s-zh', sourceId: '服饰-10s-zh', targetLanguage: '普通话' },
  // 完整 A28 语言矩阵里的耳机 15 秒原案例是西班牙语；A27 专门覆盖英文
  // 长视频 Wire，因此只复用商品与配置，不改动 A28 的固定案例矩阵。
  { id: '耳机-15s-en', sourceId: '耳机-15s-es', targetLanguage: '英语' },
  { id: '美妆-10s-ja', sourceId: '美妆-10s-ja', targetLanguage: '日语' },
] as const;

const ATTEMPT27_CASES = ATTEMPT27_CASE_SPECS.map((spec) => {
  const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
    item => item.id === spec.sourceId,
  );
  if (!testCase) throw new Error(`Attempt27 固定案例不存在：${spec.sourceId}`);
  return { ...testCase, id: spec.id, targetLanguage: spec.targetLanguage };
});

export function createPromptWizardAttempt27ArkRuntime() {
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
  const physicalRequestGuard = createPromptWizardAttempt27PhysicalRequestGuard(
    responses,
    PROMPT_WIZARD_ATTEMPT27_CASE_IDS,
  );
  return {
    provider: new ArkPromptWizardProvider(physicalRequestGuard),
    physicalRequestGuard,
  };
}

export async function runPromptWizardAttempt27Diagnostic(input: {
  provider: ArkPromptWizardProvider;
  physicalRequestGuard: ReturnType<typeof createPromptWizardAttempt27PhysicalRequestGuard>;
}) {
  let completed = 0;
  let naturalFormatRecoveryCount = 0;
  for (const [caseIndex, testCase] of ATTEMPT27_CASES.entries()) {
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: attempt27Uuid(600 + caseIndex),
      runId: attempt27Uuid(500 + caseIndex),
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-08T00:00:00.000Z',
    });
    const contexts = promptWizardRouteContextsV6(routeSet);
    const commonContext = {
      profile: testCase.profile,
      evidenceGraph,
      targetLanguage: testCase.targetLanguage!,
      confirmedOffer: '',
      config: testCase.config,
      imageCount: 1,
      variationKey: 1,
      deadlineAtMs: Date.now() + 240_000,
    } satisfies Omit<PromptWizardUseDirectionDraftGenerationContext, 'planContexts'>;
    input.physicalRequestGuard.enterCase(testCase.id);
    try {
      const naturalDiagnostics: PromptWizardOutputDiagnostic[] = [];
      // Attempt27 的终态和物理计数必须是 transcript 最后两条。三条自然首稿
      // 因此严格逐条 await；任一请求或本地断言失败后，不得留下仍在运行、
      // 可能继续写 Provider 日志的 Promise。
      for (const planIndex of [0, 1, 2] as const) {
        emit({
          event: 'prompt-wizard-v6-attempt27-initial-provider-identity',
          caseId: testCase.id,
          planIndex,
          role: PROMPT_WIZARD_V6_ROUTE_ROLES[planIndex],
        });
        try {
          const result = await input.provider.generateUseDirectionDrafts({
            ...commonContext,
            planContexts: [contexts[planIndex]!],
          });
          const resultSummary = assertNaturalDraftResult(result, planIndex);
          naturalDiagnostics.push(
            ...resultSummary.diagnostics,
          );
          naturalFormatRecoveryCount += resultSummary.formatRecoveryCount;
          if (
            naturalFormatRecoveryCount
              > PROMPT_WIZARD_ATTEMPT27_NATURAL_FORMAT_REPAIR_LIMIT
          ) {
            throw attempt27DiagnosticError(
              'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED',
              naturalDiagnostics,
            );
          }
        } catch (error) {
          // 第 2/3 条自然首稿失败时，错误对象只携带当前请求的安全诊断。
          // 把此前已经成功解码的诊断一并转交给外层，确保 aborted transcript
          // 仍能按请求顺序和物理计数完整对账，且全程只发出一次诊断事件。
          const failedSummary = tryNormalizeAttempt27OutputDiagnosticsFromError(error);
          const mergedDiagnostics = mergeAttempt27OutputDiagnostics(
            naturalDiagnostics,
            failedSummary?.diagnostics ?? [],
          );
          throw attempt27DiagnosticError(
            safeAttempt27ErrorCode(error),
            mergedDiagnostics.length === 0 ? undefined : mergedDiagnostics,
          );
        }
      }
      const naturalSummary = normalizePromptWizardCanaryOutputDiagnostics(naturalDiagnostics);
      if (
        naturalSummary.formatAnomalyCount !== naturalSummary.formatRecoveryCount
        || naturalSummary.formatAnomalyCount
          > PROMPT_WIZARD_ATTEMPT27_NATURAL_FORMAT_REPAIR_LIMIT
      ) {
        throw attempt27DiagnosticError(
          'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
          naturalSummary.diagnostics,
        );
      }

      const naturallyRecoveredPlanIndex = naturalSummary.diagnostics.find(
        diagnostic => diagnostic.stage === 'format-recovery',
      )?.planIndex;
      const probePlanIndex = ([0, 1, 2] as const).find(
        planIndex => planIndex !== naturallyRecoveredPlanIndex,
      ) ?? 0;
      let probeSummary: ReturnType<typeof normalizePromptWizardCanaryOutputDiagnostics>;
      try {
        input.physicalRequestGuard.beginAttempt27FormatRecoveryProbe(probePlanIndex);
        const probe = await input.provider.probeUseDirectionDraftFormatRecovery({
          ...commonContext,
          planContexts: [contexts[probePlanIndex]!],
        }, probePlanIndex);
        probeSummary = normalizePromptWizardCanaryOutputDiagnostics(probe.outputDiagnostics);
      } catch (error) {
        // 三条自然首稿已经全部完成；即使固定恢复探针在 Provider 或本地
        // 后处理阶段失败，也必须把已完成首稿和探针自身已生成的安全
        // 分类交给外层统一发出。不携带探针正文、动态错误消息或 cause。
        const failedProbeSummary = tryNormalizeAttempt27OutputDiagnosticsFromError(error);
        throw attempt27DiagnosticError(
          safeAttempt27ErrorCode(error),
          [
            ...naturalSummary.diagnostics,
            ...(failedProbeSummary?.diagnostics ?? []),
          ],
        );
      }
      if (
        probeSummary.diagnostics.length !== 1
        || probeSummary.formatAnomalyCount !== 0
        || probeSummary.formatRecoveryCount !== 1
        || probeSummary.diagnostics[0]?.operation !== 'repair-draft-format'
        || probeSummary.diagnostics[0]?.stage !== 'format-recovery'
        || probeSummary.diagnostics[0]?.planIndex !== probePlanIndex
        || probeSummary.diagnostics[0]?.phase !== 'decoded'
        || probeSummary.diagnostics[0]?.schemaIssue !== 'not-applicable'
        || probeSummary.diagnostics[0]?.classification !== 'valid-json'
        || probeSummary.diagnostics[0]?.normalizationMode !== 'native'
      ) {
        throw attempt27DiagnosticError(
          'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
          [...naturalSummary.diagnostics, ...probeSummary.diagnostics],
        );
      }
      const outputDiagnostics = [...naturalSummary.diagnostics, ...probeSummary.diagnostics];
      emit({
        event: 'prompt-wizard-v6-attempt27-output-diagnostics',
        caseId: testCase.id,
        formatAnomalyCount: naturalSummary.formatAnomalyCount,
        formatRecoveryCount: naturalSummary.formatRecoveryCount + 1,
        outputDiagnostics,
      });
      completed += 1;
      emit({
        event: 'prompt-wizard-v6-attempt27-batch',
        id: testCase.id,
        ok: true,
        initialDraftCount: 3,
        naturalFormatRecoveryCount: naturalSummary.formatRecoveryCount,
        forcedFormatRecoveryCount: 1,
      });
    } catch (error) {
      emitAttempt27OutputDiagnosticsFromError(testCase.id, error);
      throw error;
    } finally {
      input.physicalRequestGuard.leaveCase(testCase.id);
    }
  }
  emit({
    event: 'prompt-wizard-v6-attempt27-completed',
    ok: true,
    completed,
    deliveredNaturalDraftCount: 9,
    naturalFormatRecoveryCount,
    forcedFormatRecoveryCount: 3,
    diagnosticComplete: true,
    releaseAllowed: false,
  });
}

export function buildPromptWizardAttempt27PhysicalRequestEvent(
  snapshot: PromptWizardCanaryPhysicalRequestSnapshot,
) {
  return {
    event: PROMPT_WIZARD_ATTEMPT27_PHYSICAL_REQUEST_EVENT,
    physicalRequestSnapshot: normalizePromptWizardCanaryPhysicalRequestSnapshot(snapshot, {
      attempt: 27,
      caseIds: PROMPT_WIZARD_ATTEMPT27_CASE_IDS,
      globalLimit: PROMPT_WIZARD_ATTEMPT27_GLOBAL_PHYSICAL_REQUEST_LIMIT,
      caseLimit: PROMPT_WIZARD_ATTEMPT27_CASE_PHYSICAL_REQUEST_LIMIT,
      globalFormatRepairLimit: PROMPT_WIZARD_ATTEMPT27_GLOBAL_FORMAT_REPAIR_LIMIT,
    }),
  } as const;
}

export function parsePromptWizardAttempt27DiagnosticNdjson(input: {
  transcript: string;
  processExitCode: number;
}) {
  if (!Number.isSafeInteger(input.processExitCode) || input.processExitCode < 0
    || input.processExitCode > 255) {
    throw attempt27EvidenceError();
  }
  const safe = parsePromptWizardCanarySafeTranscript({
    transcript: input.transcript,
    protocolEvents: ATTEMPT27_PROTOCOL_EVENTS,
  });
  const physicalIndexes = eventIndexes(safe.records, PROMPT_WIZARD_ATTEMPT27_PHYSICAL_REQUEST_EVENT);
  if (physicalIndexes.length !== 1 || physicalIndexes[0] !== safe.records.length - 1) {
    throw attempt27EvidenceError();
  }
  const physicalRecord = safe.records.at(-1)!;
  if (Object.keys(physicalRecord).length !== 2) throw attempt27EvidenceError();
  const physicalRequestSnapshot = normalizePromptWizardCanaryPhysicalRequestSnapshot(
    physicalRecord.physicalRequestSnapshot,
    {
      attempt: 27,
      caseIds: PROMPT_WIZARD_ATTEMPT27_CASE_IDS,
      globalLimit: PROMPT_WIZARD_ATTEMPT27_GLOBAL_PHYSICAL_REQUEST_LIMIT,
      caseLimit: PROMPT_WIZARD_ATTEMPT27_CASE_PHYSICAL_REQUEST_LIMIT,
      globalFormatRepairLimit: PROMPT_WIZARD_ATTEMPT27_GLOBAL_FORMAT_REPAIR_LIMIT,
    },
  );
  const terminalCandidates = safe.records.filter(record => (
    record.event === 'prompt-wizard-v6-attempt27-completed'
    || record.event === 'prompt-wizard-v6-attempt27-aborted'
  ));
  if (terminalCandidates.length !== 1) throw attempt27EvidenceError();
  const terminal = terminalCandidates[0]!;
  if (safe.records.indexOf(terminal) !== safe.records.length - 2) {
    throw attempt27EvidenceError();
  }
  const completed = terminal.event === 'prompt-wizard-v6-attempt27-completed';
  if (completed !== (input.processExitCode === 0)) throw attempt27EvidenceError();

  const identities = safe.records.filter(record => (
    record.event === 'prompt-wizard-v6-attempt27-initial-provider-identity'
  ));
  const outputEvents = safe.records.filter(record => (
    record.event === 'prompt-wizard-v6-attempt27-output-diagnostics'
  ));
  const batches = safe.records.filter(record => (
    record.event === 'prompt-wizard-v6-attempt27-batch'
  ));
  const physicalMatchesProviderLogs = safe.providerUsageSummary.retryEventCount === 0
    && safe.providerUsageSummary.requestEventCount === physicalRequestSnapshot.globalCount
    && safe.providerUsageSummary.attempts === physicalRequestSnapshot.globalCount
    && Object.entries(physicalRequestSnapshot.operationCounts).every(([operation, count]) => (
      safe.providerUsageSummary.operationCounts[
        operation as keyof typeof safe.providerUsageSummary.operationCounts
      ] === count
    ));
  if (!physicalMatchesProviderLogs) throw attempt27EvidenceError();

  let diagnosticComplete = false;
  if (completed) {
    const totalNaturalFormatRecoveryCount = totalAttempt27NaturalFormatRecoveryCount(
      outputEvents,
    );
    if (!isExactAttempt27Completed(terminal, totalNaturalFormatRecoveryCount)) {
      throw attempt27EvidenceError();
    }
    assertAttempt27IdentityEvents(identities);
    assertAttempt27OutputEvents(outputEvents);
    assertAttempt27BatchEvents(batches, outputEvents);
    if (
      physicalRequestSnapshot.globalCount !== 12 + totalNaturalFormatRecoveryCount
      || physicalRequestSnapshot.operationCounts['generate-drafts'] !== 9
      || physicalRequestSnapshot.operationCounts['repair-draft-format']
        !== PROMPT_WIZARD_ATTEMPT27_FORCED_FORMAT_REPAIR_LIMIT
          + totalNaturalFormatRecoveryCount
      || physicalRequestSnapshot.operationCounts['repair-draft-content'] !== 0
      || PROMPT_WIZARD_ATTEMPT27_CASE_IDS.some(caseId => (
        physicalRequestSnapshot.caseCounts[caseId]
          !== 4 + attempt27CaseNaturalFormatRecoveryCount(outputEvents, caseId)
        || physicalRequestSnapshot.caseOperationCounts[caseId]?.['generate-drafts'] !== 3
        || physicalRequestSnapshot.caseOperationCounts[caseId]?.['repair-draft-format']
          !== 1 + attempt27CaseNaturalFormatRecoveryCount(outputEvents, caseId)
      ))
    ) throw attempt27EvidenceError();
    diagnosticComplete = true;
  } else if (!isSafeAttempt27Abort(terminal)) {
    throw attempt27EvidenceError();
  }
  return {
    state: completed ? 'completed' as const : 'aborted' as const,
    ok: completed,
    diagnosticComplete,
    releaseAllowed: false as const,
    processExitCode: input.processExitCode,
    physicalRequestSnapshot,
    providerUsageSummary: safe.providerUsageSummary,
    normalizedEvents: safe.normalizedEvents,
  };
}

function assertNaturalDraftResult(
  result: Awaited<ReturnType<ArkPromptWizardProvider['generateUseDirectionDrafts']>>,
  planIndex: 0 | 1 | 2,
) {
  const summary = normalizePromptWizardCanaryOutputDiagnostics(result.outputDiagnostics);
  const initialDiagnostics = summary.diagnostics.filter(
    diagnostic => diagnostic.stage === 'initial',
  );
  const recoveryDiagnostics = summary.diagnostics.filter(
    diagnostic => diagnostic.stage === 'format-recovery',
  );
  const isNativeDraft = summary.formatAnomalyCount === 0
    && summary.formatRecoveryCount === 0
    && (result.formatRepairCount ?? 0) === 0
    && summary.diagnostics.length === 1;
  const isRecoveredDraft = summary.formatAnomalyCount === 1
    && summary.formatRecoveryCount === 1
    && (result.formatRepairCount ?? 0) === 1
    && summary.diagnostics.length === 2
    && initialDiagnostics[0]?.classification !== 'valid-json'
    && initialDiagnostics[0]?.normalizationMode !== 'native'
    && recoveryDiagnostics[0]?.planIndex === planIndex
    && recoveryDiagnostics[0]?.phase === 'decoded'
    && recoveryDiagnostics[0]?.classification === 'valid-json'
    && recoveryDiagnostics[0]?.normalizationMode === 'native'
    && recoveryDiagnostics[0]?.schemaIssue === 'not-applicable';
  if (
    result.drafts.length !== 1
    || (result.repairRounds ?? 0) !== 0
    || (result.repairDiagnostics?.length ?? 0) !== 0
    || initialDiagnostics.length !== 1
    || initialDiagnostics[0]?.planIndex !== planIndex
    || initialDiagnostics[0]?.operation !== 'generate-drafts'
    || (!isNativeDraft && !isRecoveredDraft)
    || (isNativeDraft && (
      initialDiagnostics[0]?.phase !== 'decoded'
      || initialDiagnostics[0]?.schemaIssue !== 'not-applicable'
      || initialDiagnostics[0]?.classification !== 'valid-json'
      || initialDiagnostics[0]?.normalizationMode !== 'native'
    ))
  ) {
    throw attempt27DiagnosticError(
      'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
      summary.diagnostics,
    );
  }
  return summary;
}

function emitAttempt27OutputDiagnosticsFromError(caseId: string, error: unknown) {
  const summary = tryNormalizeAttempt27OutputDiagnosticsFromError(error);
  if (!summary) return;
  emit({
    event: 'prompt-wizard-v6-attempt27-output-diagnostics',
    caseId,
    formatAnomalyCount: summary.formatAnomalyCount,
    formatRecoveryCount: summary.formatRecoveryCount,
    outputDiagnostics: summary.diagnostics,
  });
}

function tryNormalizeAttempt27OutputDiagnosticsFromError(error: unknown) {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== 'object') return null;
    const candidate = current as { outputDiagnostics?: unknown; cause?: unknown };
    if (Object.hasOwn(candidate, 'outputDiagnostics')) {
      try {
        return normalizePromptWizardCanaryOutputDiagnostics(candidate.outputDiagnostics);
      } catch {
        // 不可把非白名单诊断带入永久证据；继续检查安全 cause链。
      }
    }
    current = candidate.cause;
  }
  return null;
}

function mergeAttempt27OutputDiagnostics(
  ...groups: ReadonlyArray<readonly PromptWizardOutputDiagnostic[]>
) {
  const merged: PromptWizardOutputDiagnostic[] = [];
  const identities = new Set<string>();
  for (const diagnostic of groups.flat()) {
    // 与永久安全证据规范使用同一身份；groups 的先后顺序确保此前已成功
    // 解码的自然首稿优先于错误链中同身份但字段略有差异的安全副本。
    const identity = `${diagnostic.planIndex}#${diagnostic.operation}#${diagnostic.stage}`;
    if (identities.has(identity)) continue;
    identities.add(identity);
    merged.push(diagnostic);
  }
  return merged;
}

function assertAttempt27IdentityEvents(events: Record<string, unknown>[]) {
  if (events.length !== 9) throw attempt27EvidenceError();
  const identities = new Set<string>();
  for (const event of events) {
    if (!hasExactKeys(event, ['event', 'caseId', 'planIndex', 'role'])) {
      throw attempt27EvidenceError();
    }
    const caseId = event.caseId;
    const planIndex = event.planIndex;
    if (
      typeof caseId !== 'string'
      || !PROMPT_WIZARD_ATTEMPT27_CASE_IDS.includes(caseId as never)
      || (planIndex !== 0 && planIndex !== 1 && planIndex !== 2)
      || event.role !== PROMPT_WIZARD_V6_ROUTE_ROLES[planIndex]
    ) throw attempt27EvidenceError();
    identities.add(`${caseId}#${planIndex}`);
  }
  if (identities.size !== 9) throw attempt27EvidenceError();
}

function assertAttempt27OutputEvents(events: Record<string, unknown>[]) {
  if (events.length !== 3) throw attempt27EvidenceError();
  const caseIds = new Set<string>();
  let totalNaturalFormatRecoveryCount = 0;
  for (const event of events) {
    if (!hasExactKeys(event, [
      'event',
      'caseId',
      'formatAnomalyCount',
      'formatRecoveryCount',
      'outputDiagnostics',
    ])) throw attempt27EvidenceError();
    const summary = normalizePromptWizardCanaryOutputDiagnostics(event.outputDiagnostics);
    const initialDiagnostics = summary.diagnostics.filter(
      diagnostic => diagnostic.stage === 'initial',
    );
    const recoveryDiagnostics = summary.diagnostics.filter(
      diagnostic => diagnostic.stage === 'format-recovery',
    );
    const anomalyDiagnostics = initialDiagnostics.filter(diagnostic => (
      diagnostic.classification !== 'valid-json'
      || diagnostic.normalizationMode !== 'native'
    ));
    const naturalFormatRecoveryCount = Number(event.formatAnomalyCount);
    const naturallyRecoveredPlanIndex = anomalyDiagnostics[0]?.planIndex;
    const recoveryPlanIndexes = recoveryDiagnostics.map(diagnostic => diagnostic.planIndex);
    if (
      typeof event.caseId !== 'string'
      || !PROMPT_WIZARD_ATTEMPT27_CASE_IDS.includes(event.caseId as never)
      || (event.formatAnomalyCount !== 0 && event.formatAnomalyCount !== 1)
      || event.formatRecoveryCount !== 1 + naturalFormatRecoveryCount
      || summary.diagnostics.length !== 4 + naturalFormatRecoveryCount
      || summary.formatAnomalyCount !== naturalFormatRecoveryCount
      || summary.formatRecoveryCount !== 1 + naturalFormatRecoveryCount
      || initialDiagnostics.length !== 3
      || new Set(initialDiagnostics.map(diagnostic => diagnostic.planIndex)).size !== 3
      || anomalyDiagnostics.length !== naturalFormatRecoveryCount
      || initialDiagnostics.filter(diagnostic => !anomalyDiagnostics.includes(diagnostic)).some(
        diagnostic => (
          diagnostic.phase !== 'decoded'
          || diagnostic.classification !== 'valid-json'
          || diagnostic.normalizationMode !== 'native'
          || diagnostic.schemaIssue !== 'not-applicable'
        ),
      )
      || anomalyDiagnostics.some(diagnostic => (
        diagnostic.phase !== 'parse'
        || diagnostic.schemaIssue !== 'not-applicable'
      ))
      || recoveryDiagnostics.length !== 1 + naturalFormatRecoveryCount
      || recoveryDiagnostics.some(diagnostic => (
        diagnostic.operation !== 'repair-draft-format'
        || diagnostic.phase !== 'decoded'
        || diagnostic.classification !== 'valid-json'
        || diagnostic.normalizationMode !== 'native'
        || diagnostic.schemaIssue !== 'not-applicable'
      ))
      || new Set(recoveryPlanIndexes).size !== recoveryPlanIndexes.length
      || (naturalFormatRecoveryCount === 0 && recoveryPlanIndexes[0] !== 0)
      || (naturalFormatRecoveryCount === 1 && (
        naturallyRecoveredPlanIndex === undefined
        || !recoveryPlanIndexes.includes(naturallyRecoveredPlanIndex)
        || recoveryPlanIndexes.every(planIndex => planIndex === naturallyRecoveredPlanIndex)
      ))
    ) throw attempt27EvidenceError();
    totalNaturalFormatRecoveryCount += naturalFormatRecoveryCount;
    caseIds.add(event.caseId);
  }
  if (
    caseIds.size !== 3
    || totalNaturalFormatRecoveryCount > PROMPT_WIZARD_ATTEMPT27_NATURAL_FORMAT_REPAIR_LIMIT
  ) throw attempt27EvidenceError();
}

function assertAttempt27BatchEvents(
  events: Record<string, unknown>[],
  outputEvents: Record<string, unknown>[],
) {
  if (events.length !== 3) throw attempt27EvidenceError();
  const ids = new Set<string>();
  for (const event of events) {
    if (
      !hasExactKeys(event, [
        'event', 'id', 'ok', 'initialDraftCount', 'naturalFormatRecoveryCount',
        'forcedFormatRecoveryCount',
      ])
      || typeof event.id !== 'string'
      || !PROMPT_WIZARD_ATTEMPT27_CASE_IDS.includes(event.id as never)
      || event.ok !== true
      || event.initialDraftCount !== 3
      || event.naturalFormatRecoveryCount
        !== attempt27CaseNaturalFormatRecoveryCount(outputEvents, event.id)
      || event.forcedFormatRecoveryCount !== 1
    ) throw attempt27EvidenceError();
    ids.add(event.id);
  }
  if (ids.size !== 3) throw attempt27EvidenceError();
}

function isExactAttempt27Completed(
  event: Record<string, unknown>,
  naturalFormatRecoveryCount: number,
) {
  return hasExactKeys(event, [
    'event',
    'ok',
    'completed',
    'deliveredNaturalDraftCount',
    'naturalFormatRecoveryCount',
    'forcedFormatRecoveryCount',
    'diagnosticComplete',
    'releaseAllowed',
  ])
    && event.ok === true
    && event.completed === 3
    && event.deliveredNaturalDraftCount === 9
    && event.naturalFormatRecoveryCount === naturalFormatRecoveryCount
    && event.forcedFormatRecoveryCount === 3
    && event.diagnosticComplete === true
    && event.releaseAllowed === false;
}

function attempt27CaseNaturalFormatRecoveryCount(
  outputEvents: Record<string, unknown>[],
  caseId: unknown,
) {
  const outputEvent = outputEvents.find(event => event.caseId === caseId);
  return outputEvent?.formatAnomalyCount === 1 ? 1 : 0;
}

function totalAttempt27NaturalFormatRecoveryCount(outputEvents: Record<string, unknown>[]) {
  return outputEvents.reduce((total, event) => (
    total + attempt27CaseNaturalFormatRecoveryCount(outputEvents, event.caseId)
  ), 0);
}

function isSafeAttempt27Abort(event: Record<string, unknown>) {
  return hasExactKeys(event, ['event', 'ok', 'error', 'errorCode'])
    && event.ok === false
    && event.error === 'Attempt27 不可发布诊断未通过'
    && typeof event.errorCode === 'string'
    && /^PROMPT_WIZARD_[A-Z0-9_]{1,80}$/u.test(event.errorCode);
}

function eventIndexes(events: Record<string, unknown>[], eventName: string) {
  return events.flatMap((event, index) => event.event === eventName ? [index] : []);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && keys.every(key => expected.includes(key))
    && expected.every(key => Object.hasOwn(value, key));
}

function attempt27Uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function attempt27DiagnosticError(code: string, outputDiagnostics?: unknown) {
  return Object.assign(new Error('Attempt27 不可发布诊断未通过'), {
    code,
    ...(outputDiagnostics === undefined ? {} : { outputDiagnostics }),
  });
}

function attempt27EvidenceError() {
  return Object.assign(new Error('Attempt27 不可发布诊断证据无效'), {
    code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
  });
}

function safeAttempt27ErrorCode(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : '';
  return /^PROMPT_WIZARD_[A-Z0-9_]{1,80}$/u.test(code)
    ? code
    : 'PROMPT_WIZARD_PROVIDER_REQUEST_FAILED';
}

function emptyAttempt27Snapshot(): PromptWizardCanaryPhysicalRequestSnapshot {
  const operations = () => ({
    'generate-drafts': 0,
    'repair-draft-format': 0,
    'repair-draft-content': 0,
  });
  return {
    globalCount: 0,
    caseCounts: Object.fromEntries(PROMPT_WIZARD_ATTEMPT27_CASE_IDS.map(id => [id, 0])),
    operationCounts: operations(),
    caseOperationCounts: Object.fromEntries(
      PROMPT_WIZARD_ATTEMPT27_CASE_IDS.map(id => [id, operations()]),
    ),
    casePlanContentRepairCounts: Object.fromEntries(
      PROMPT_WIZARD_ATTEMPT27_CASE_IDS.map(id => [id, [0, 0, 0]]),
    ),
  };
}

function emit(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export async function runPromptWizardAttempt27DiagnosticProcess(
  runtimeFactory: typeof createPromptWizardAttempt27ArkRuntime = createPromptWizardAttempt27ArkRuntime,
) {
  let guard: ReturnType<typeof createPromptWizardAttempt27PhysicalRequestGuard> | null = null;
  try {
    const runtime = runtimeFactory();
    guard = runtime.physicalRequestGuard;
    await runPromptWizardAttempt27Diagnostic(runtime);
    return true;
  } catch (error) {
    emit({
      event: 'prompt-wizard-v6-attempt27-aborted',
      ok: false,
      error: 'Attempt27 不可发布诊断未通过',
      errorCode: safeAttempt27ErrorCode(error),
    });
    return false;
  } finally {
    emit(buildPromptWizardAttempt27PhysicalRequestEvent(
      guard?.snapshot() ?? emptyAttempt27Snapshot(),
    ));
  }
}

async function main() {
  if (!await runPromptWizardAttempt27DiagnosticProcess()) process.exitCode = 1;
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry!) === fileURLToPath(import.meta.url);
}

if (isMainModule()) void main();
