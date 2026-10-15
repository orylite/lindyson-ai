import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import {
  ArkPromptWizardProvider,
} from '../providers/promptWizardProvider.js';
import { ArkPromptWizardResponsesClient } from '../providers/arkPromptWizardResponsesClient.js';
import {
  buildPromptWizardCanaryAbortEvent,
  parsePromptWizardUseDirectionCanaryNdjson,
  PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES,
  runPromptWizardUseDirectionCanary,
} from './canaryPromptWizardUseDirections.js';
import {
  createPromptWizardAttempt28PhysicalRequestGuard,
  normalizePromptWizardCanaryPhysicalRequestSnapshot,
  PROMPT_WIZARD_ATTEMPT28_CASE_PHYSICAL_REQUEST_LIMIT,
  PROMPT_WIZARD_ATTEMPT28_GLOBAL_PHYSICAL_REQUEST_LIMIT,
  type PromptWizardCanaryPhysicalRequestSnapshot,
} from './promptWizardCanaryV2Infrastructure.js';
import {
  normalizePromptWizardCanaryOutputDiagnostics,
  parsePromptWizardCanarySafeTranscript,
} from './promptWizardCanarySafeEvidence.js';
import {
  observePromptWizardProviderCalls,
  persistPromptWizardOperationalUsage,
  type PromptWizardOperationalUsageObservation,
} from './canaryPromptWizardProvider.js';
import {
  requireProviderOperationalUsageManifestRuntimeConfig,
  type ProviderOperationalUsageManifestRuntimeConfig,
} from './providerOperationalUsageManifestWriter.js';

export const PROMPT_WIZARD_ATTEMPT28_PHYSICAL_REQUEST_EVENT =
  'prompt-wizard-v6-attempt28-physical-request-counts';

export const PROMPT_WIZARD_ATTEMPT28_CANARY_CASES = [
  // 新 Wire 先跑字符计数外语、单词计数外语，再跑普通话；任一高风险
  // 路径失败都会在进入剩余完整矩阵前停止。
  PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(item => item.id === '美妆-10s-ja')!,
  PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(item => item.id === '服饰-15s-en')!,
  PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(item => item.id === '服饰-10s-zh')!,
  ...PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.filter(item => (
    item.id !== '美妆-10s-ja'
    && item.id !== '服饰-15s-en'
    && item.id !== '服饰-10s-zh'
  )),
] as const;

export const PROMPT_WIZARD_ATTEMPT28_CASE_IDS = PROMPT_WIZARD_ATTEMPT28_CANARY_CASES
  .map(item => item.id);

const PROMPT_WIZARD_ATTEMPT28_EVIDENCE_REASON_CODES = [
  'physical-envelope',
  'physical-snapshot',
  'base-transcript',
  'completed-matrix',
  'case-sequence',
  'case-provider-evidence',
  'case-repair-evidence',
  'output-diagnostics',
  'case-output-diagnostics',
] as const;

type PromptWizardAttempt28EvidenceReasonCode =
  typeof PROMPT_WIZARD_ATTEMPT28_EVIDENCE_REASON_CODES[number];

const ATTEMPT28_PROTOCOL_EVENTS = new Set([
  'prompt-wizard-v6-canary-initial-provider-identity',
  'prompt-wizard-v6-canary-output-diagnostics',
  'prompt-wizard-v6-canary-repair-diagnostics',
  'prompt-wizard-v6-canary-batch',
  'prompt-wizard-v6-canary-completed',
  'prompt-wizard-v6-canary-aborted',
  PROMPT_WIZARD_ATTEMPT28_PHYSICAL_REQUEST_EVENT,
]);

const ATTEMPT28_CASE_PROTOCOL_EVENTS = new Set([
  'prompt-wizard-v6-canary-initial-provider-identity',
  'prompt-wizard-v6-canary-output-diagnostics',
  'prompt-wizard-v6-canary-repair-diagnostics',
  'prompt-wizard-v6-canary-batch',
]);

export function createPromptWizardAttempt28ArkRuntime(
  operationalObservations: PromptWizardOperationalUsageObservation[] = [],
) {
  const apiKey = env.ARK_PROMPT_WIZARD_API_KEY ?? env.ARK_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('提示词向导未配置火山方舟 API Key'), {
      code: 'PROMPT_WIZARD_PROVIDER_NOT_CONFIGURED',
    });
  }
  const responses = observePromptWizardProviderCalls(new ArkPromptWizardResponsesClient({
    apiKey,
    baseUrl: env.ARK_BASE_URL,
  }), operationalObservations);
  const physicalRequestGuard = createPromptWizardAttempt28PhysicalRequestGuard(
    responses,
    PROMPT_WIZARD_ATTEMPT28_CASE_IDS,
  );
  return {
    provider: new ArkPromptWizardProvider(physicalRequestGuard),
    physicalRequestGuard,
  };
}

export function buildPromptWizardAttempt28PhysicalRequestEvent(
  snapshot: PromptWizardCanaryPhysicalRequestSnapshot,
) {
  return {
    event: PROMPT_WIZARD_ATTEMPT28_PHYSICAL_REQUEST_EVENT,
    physicalRequestSnapshot: normalizePromptWizardCanaryPhysicalRequestSnapshot(snapshot, {
      attempt: 28,
      caseIds: PROMPT_WIZARD_ATTEMPT28_CASE_IDS,
      globalLimit: PROMPT_WIZARD_ATTEMPT28_GLOBAL_PHYSICAL_REQUEST_LIMIT,
      caseLimit: PROMPT_WIZARD_ATTEMPT28_CASE_PHYSICAL_REQUEST_LIMIT,
      globalFormatRepairLimit: 1,
    }),
  } as const;
}

export function parsePromptWizardAttempt28CanaryNdjson(input: {
  transcript: string;
  processExitCode: number;
}) {
  const safe = parsePromptWizardCanarySafeTranscript({
    transcript: input.transcript,
    protocolEvents: ATTEMPT28_PROTOCOL_EVENTS,
  });
  const physicalIndexes = safe.records.flatMap((record, index) => (
    record.event === PROMPT_WIZARD_ATTEMPT28_PHYSICAL_REQUEST_EVENT ? [index] : []
  ));
  if (physicalIndexes.length !== 1 || physicalIndexes[0] !== safe.records.length - 1) {
    throw promptWizardAttempt28EvidenceError('physical-envelope');
  }
  const physicalRecord = safe.records.at(-1)!;
  if (
    Object.keys(physicalRecord).length !== 2
    || !Object.hasOwn(physicalRecord, 'physicalRequestSnapshot')
  ) {
    throw promptWizardAttempt28EvidenceError('physical-envelope');
  }
  const physicalRequestSnapshot = promptWizardAttempt28EvidenceStage(
    'physical-snapshot',
    () => normalizePromptWizardCanaryPhysicalRequestSnapshot(
      physicalRecord.physicalRequestSnapshot,
      {
        attempt: 28,
        caseIds: PROMPT_WIZARD_ATTEMPT28_CASE_IDS,
        globalLimit: PROMPT_WIZARD_ATTEMPT28_GLOBAL_PHYSICAL_REQUEST_LIMIT,
        caseLimit: PROMPT_WIZARD_ATTEMPT28_CASE_PHYSICAL_REQUEST_LIMIT,
        globalFormatRepairLimit: 1,
      },
    ),
  );
  const baseLines = input.transcript.split(/\r?\n/u).filter(line => line.trim());
  const baseSummary = promptWizardAttempt28EvidenceStage(
    'base-transcript',
    () => parsePromptWizardUseDirectionCanaryNdjson({
      transcript: baseLines.slice(0, -1).join('\n'),
      processExitCode: input.processExitCode,
    }),
  );
  const outputEvents = safe.records.filter(record => (
    record.event === 'prompt-wizard-v6-canary-output-diagnostics'
  ));
  const outputCaseIds = outputEvents.map(record => record.caseId);
  const completed = baseSummary.state === 'completed';
  if (completed && (
    outputEvents.length !== PROMPT_WIZARD_ATTEMPT28_CASE_IDS.length
    || outputCaseIds.some(caseId => typeof caseId !== 'string')
    || new Set(outputCaseIds).size !== PROMPT_WIZARD_ATTEMPT28_CASE_IDS.length
    || PROMPT_WIZARD_ATTEMPT28_CASE_IDS.some(caseId => !outputCaseIds.includes(caseId))
    || physicalRequestSnapshot.operationCounts['generate-drafts'] !== 45
  )) throw promptWizardAttempt28EvidenceError('completed-matrix');
  if (completed) {
    assertAttempt28CompletedCaseSequence({
      records: safe.records,
      physicalRequestSnapshot,
    });
  }
  const outputSummaries = outputEvents.map((record) => {
    const summary = promptWizardAttempt28EvidenceStage(
      'output-diagnostics',
      () => normalizePromptWizardCanaryOutputDiagnostics(record.outputDiagnostics),
    );
    if (
      safeCount(record.formatAnomalyCount, 192, 'output-diagnostics')
        !== summary.formatAnomalyCount
      || safeCount(record.formatRecoveryCount, 192, 'output-diagnostics')
        !== summary.formatRecoveryCount
    ) throw promptWizardAttempt28EvidenceError('output-diagnostics');
    if (completed) {
      assertAttempt28CaseOutputDiagnostics({
        caseId: record.caseId as string,
        diagnostics: summary.diagnostics,
        physicalRequestSnapshot,
      });
    }
    return summary;
  });
  const formatAnomalyCount = outputSummaries.reduce((total, summary) => (
    total + summary.formatAnomalyCount
  ), 0);
  const formatRecoveryCount = outputSummaries.reduce((total, summary) => (
    total + summary.formatRecoveryCount
  ), 0);
  const releaseBlockingFormatAnomalyCount = outputSummaries.reduce((total, summary) => (
    total + summary.releaseBlockingFormatAnomalyCount
  ), 0);
  const allCasesHaveThreeInitialCalls = PROMPT_WIZARD_ATTEMPT28_CASE_IDS.every(caseId => (
    physicalRequestSnapshot.caseOperationCounts[caseId]?.['generate-drafts'] === 3
  ));
  const physicalMatchesProviderLogs = (
    safe.providerUsageSummary.retryEventCount === 0
    && safe.providerUsageSummary.failedCount === 0
    && safe.providerUsageSummary.completedCount === physicalRequestSnapshot.globalCount
    && safe.providerUsageSummary.unknownInputTokenCount === 0
    && safe.providerUsageSummary.unknownOutputTokenCount === 0
    && safe.providerUsageSummary.requestEventCount === physicalRequestSnapshot.globalCount
    && safe.providerUsageSummary.attempts === physicalRequestSnapshot.globalCount
    && Object.entries(physicalRequestSnapshot.operationCounts).every(([operation, count]) => (
      safe.providerUsageSummary.operationCounts[
        operation as keyof typeof safe.providerUsageSummary.operationCounts
      ] === count
    ))
  );
  const releaseAllowed = baseSummary.releaseAllowed
    && baseSummary.completedBatchCount === 15
    && releaseBlockingFormatAnomalyCount <= 1
    && formatRecoveryCount === physicalRequestSnapshot.operationCounts['repair-draft-format']
    && allCasesHaveThreeInitialCalls
    && physicalMatchesProviderLogs;
  return {
    ...baseSummary,
    physicalRequestSnapshot,
    formatAnomalyCount,
    releaseBlockingFormatAnomalyCount,
    formatRecoveryCount,
    providerUsageSummary: safe.providerUsageSummary,
    normalizedEvents: safe.normalizedEvents,
    releaseAllowed,
  };
}

function assertAttempt28CaseOutputDiagnostics(input: {
  caseId: string;
  diagnostics: ReturnType<typeof normalizePromptWizardCanaryOutputDiagnostics>['diagnostics'];
  physicalRequestSnapshot: PromptWizardCanaryPhysicalRequestSnapshot;
}) {
  const caseOperations = input.physicalRequestSnapshot.caseOperationCounts[input.caseId];
  const casePlanContentRepairCounts = input.physicalRequestSnapshot
    .casePlanContentRepairCounts[input.caseId];
  if (!caseOperations || !casePlanContentRepairCounts) {
    throw promptWizardAttempt28EvidenceError('case-output-diagnostics');
  }

  const initialDiagnostics = input.diagnostics.filter(item => item.stage === 'initial');
  const formatRecoveryDiagnostics = input.diagnostics.filter(
    item => item.stage === 'format-recovery',
  );
  const contentRepairDiagnostics = input.diagnostics.filter(
    item => item.stage === 'content-repair',
  );
  if (
    caseOperations['generate-drafts'] !== 3
    || input.diagnostics.some(item => item.stage === 'refinement')
    || initialDiagnostics.length !== 3
    || new Set(initialDiagnostics.map(item => item.planIndex)).size !== 3
    || [0, 1, 2].some(planIndex => (
      !initialDiagnostics.some(item => item.planIndex === planIndex)
    ))
    || input.diagnostics.some(item => item.outputTextSource !== 'completed')
    || formatRecoveryDiagnostics.some(diagnostic => (
      diagnostic.classification !== 'valid-json'
      || diagnostic.normalizationMode !== 'native'
      || diagnostic.phase !== 'decoded'
      || diagnostic.schemaIssue !== 'not-applicable'
    ))
    || formatRecoveryDiagnostics.length !== caseOperations['repair-draft-format']
    || contentRepairDiagnostics.length !== caseOperations['repair-draft-content']
    || input.diagnostics.length !== (
      3
      + caseOperations['repair-draft-format']
      + caseOperations['repair-draft-content']
    )
  ) throw promptWizardAttempt28EvidenceError('case-output-diagnostics');

  for (const planIndex of [0, 1, 2] as const) {
    const recoveries = formatRecoveryDiagnostics.filter(item => item.planIndex === planIndex);
    const contentRepairs = contentRepairDiagnostics.filter(item => item.planIndex === planIndex);
    if (
      recoveries.length > 1
      || contentRepairs.length !== casePlanContentRepairCounts[planIndex]
    ) throw promptWizardAttempt28EvidenceError('case-output-diagnostics');

    let pendingAbnormalDiagnostic = false;
    for (const diagnostic of input.diagnostics.filter(item => item.planIndex === planIndex)) {
      if (diagnostic.stage === 'format-recovery') {
        if (!pendingAbnormalDiagnostic) {
          throw promptWizardAttempt28EvidenceError('case-output-diagnostics');
        }
        pendingAbnormalDiagnostic = false;
        continue;
      }
      if (
        (diagnostic.stage === 'initial' || diagnostic.stage === 'content-repair')
        && diagnostic.classification !== 'valid-json'
      ) {
        if (pendingAbnormalDiagnostic) {
          throw promptWizardAttempt28EvidenceError('case-output-diagnostics');
        }
        pendingAbnormalDiagnostic = true;
      }
    }
    if (pendingAbnormalDiagnostic) {
      throw promptWizardAttempt28EvidenceError('case-output-diagnostics');
    }
  }
}

function assertAttempt28CompletedCaseSequence(input: {
  records: Record<string, unknown>[];
  physicalRequestSnapshot: PromptWizardCanaryPhysicalRequestSnapshot;
}) {
  const caseEvents = input.records.filter(record => (
    typeof record.event === 'string'
    && ATTEMPT28_CASE_PROTOCOL_EVENTS.has(record.event)
  ));
  let eventIndex = 0;
  let matchedProviderTerminalCount = 0;

  for (const caseId of PROMPT_WIZARD_ATTEMPT28_CASE_IDS) {
    const firstIdentityRecord = caseEvents[eventIndex];
    const observedPlanIndexes = new Set<number>();
    for (let identityIndex = 0; identityIndex < 3; identityIndex += 1) {
      const record = caseEvents[eventIndex];
      if (
        record?.event !== 'prompt-wizard-v6-canary-initial-provider-identity'
        || record.caseId !== caseId
        || (record.planIndex !== 0 && record.planIndex !== 1 && record.planIndex !== 2)
        || observedPlanIndexes.has(record.planIndex)
      ) throw promptWizardAttempt28EvidenceError('case-sequence');
      observedPlanIndexes.add(record.planIndex);
      eventIndex += 1;
    }

    const outputRecord = caseEvents[eventIndex];
    const repairRecord = caseEvents[eventIndex + 1];
    const batchRecord = caseEvents[eventIndex + 2];
    if (
      outputRecord?.event !== 'prompt-wizard-v6-canary-output-diagnostics'
      || outputRecord.caseId !== caseId
      || repairRecord?.event !== 'prompt-wizard-v6-canary-repair-diagnostics'
      || repairRecord.caseId !== caseId
      || batchRecord?.event !== 'prompt-wizard-v6-canary-batch'
      || batchRecord.id !== caseId
    ) throw promptWizardAttempt28EvidenceError('case-sequence');

    assertAttempt28CaseRepairEvidence({
      caseId,
      repairRecord,
      physicalRequestSnapshot: input.physicalRequestSnapshot,
    });
    matchedProviderTerminalCount += assertAttempt28CaseProviderEvidence({
      caseId,
      records: input.records,
      firstIdentityRecord: firstIdentityRecord!,
      outputRecord,
      physicalRequestSnapshot: input.physicalRequestSnapshot,
    });
    eventIndex += 3;
  }

  if (
    eventIndex !== caseEvents.length
    || matchedProviderTerminalCount !== input.physicalRequestSnapshot.globalCount
  ) throw promptWizardAttempt28EvidenceError('case-sequence');
}

function assertAttempt28CaseProviderEvidence(input: {
  caseId: string;
  records: Record<string, unknown>[];
  firstIdentityRecord: Record<string, unknown>;
  outputRecord: Record<string, unknown>;
  physicalRequestSnapshot: PromptWizardCanaryPhysicalRequestSnapshot;
}) {
  const firstIdentityIndex = input.records.indexOf(input.firstIdentityRecord);
  const outputIndex = input.records.indexOf(input.outputRecord);
  const expectedOperations = input.physicalRequestSnapshot.caseOperationCounts[input.caseId];
  if (
    firstIdentityIndex < 0
    || outputIndex <= firstIdentityIndex
    || !expectedOperations
  ) throw promptWizardAttempt28EvidenceError('case-provider-evidence');

  const providerTerminalRecords = input.records
    .slice(firstIdentityIndex, outputIndex)
    .filter(record => (
      record.event === 'prompt-wizard-provider-completed'
      || record.event === 'prompt-wizard-provider-failed'
    ));
  const observedOperations = {
    'generate-drafts': 0,
    'repair-draft-format': 0,
    'repair-draft-content': 0,
  };
  for (const record of providerTerminalRecords) {
    const operation = record.operation;
    if (
      operation !== 'generate-drafts'
      && operation !== 'repair-draft-format'
      && operation !== 'repair-draft-content'
    ) throw promptWizardAttempt28EvidenceError('case-provider-evidence');
    observedOperations[operation] += 1;
  }
  if (
    providerTerminalRecords.length !== input.physicalRequestSnapshot.caseCounts[input.caseId]
    || Object.entries(expectedOperations).some(([operation, count]) => (
      observedOperations[operation as keyof typeof observedOperations] !== count
    ))
  ) throw promptWizardAttempt28EvidenceError('case-provider-evidence');
  return providerTerminalRecords.length;
}

function assertAttempt28CaseRepairEvidence(input: {
  caseId: string;
  repairRecord: Record<string, unknown>;
  physicalRequestSnapshot: PromptWizardCanaryPhysicalRequestSnapshot;
}) {
  const contentCounts = input.repairRecord.contentRepairRequestCounts;
  const terminalCounts = input.repairRecord.terminalCalibrationRequestCounts;
  const diagnostics = input.repairRecord.repairDiagnostics;
  const physicalContentCounts = input.physicalRequestSnapshot
    .casePlanContentRepairCounts[input.caseId];
  if (
    !physicalContentCounts
    || !Array.isArray(contentCounts)
    || contentCounts.length !== 3
    || !Array.isArray(terminalCounts)
    || terminalCounts.length !== 3
    || !Array.isArray(diagnostics)
  ) throw promptWizardAttempt28EvidenceError('case-repair-evidence');

  for (const planIndex of [0, 1, 2] as const) {
    const contentDiagnosticCount = diagnostics.filter(diagnostic => (
      isRecord(diagnostic)
      && diagnostic.planIndex === planIndex
      && diagnostic.origin !== 'terminal-calibration'
    )).length;
    const terminalDiagnosticCount = diagnostics.filter(diagnostic => (
      isRecord(diagnostic)
      && diagnostic.planIndex === planIndex
      && diagnostic.origin === 'terminal-calibration'
    )).length;
    if (
      contentCounts[planIndex] !== physicalContentCounts[planIndex]
      || contentDiagnosticCount !== physicalContentCounts[planIndex]
      || terminalCounts[planIndex] !== 0
      || terminalDiagnosticCount !== 0
    ) throw promptWizardAttempt28EvidenceError('case-repair-evidence');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeCount(
  value: unknown,
  maximum: number,
  reasonCode: PromptWizardAttempt28EvidenceReasonCode,
) {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
    || value > maximum
  ) throw promptWizardAttempt28EvidenceError(reasonCode);
  return value;
}

function emptyAttempt28Snapshot(): PromptWizardCanaryPhysicalRequestSnapshot {
  const emptyOperations = () => ({
    'generate-drafts': 0,
    'repair-draft-format': 0,
    'repair-draft-content': 0,
  });
  return {
    globalCount: 0,
    caseCounts: Object.fromEntries(PROMPT_WIZARD_ATTEMPT28_CASE_IDS.map(id => [id, 0])),
    operationCounts: emptyOperations(),
    caseOperationCounts: Object.fromEntries(
      PROMPT_WIZARD_ATTEMPT28_CASE_IDS.map(id => [id, emptyOperations()]),
    ),
    casePlanContentRepairCounts: Object.fromEntries(
      PROMPT_WIZARD_ATTEMPT28_CASE_IDS.map(id => [id, [0, 0, 0]]),
    ),
  };
}

function emit(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main() {
  let guard: ReturnType<typeof createPromptWizardAttempt28PhysicalRequestGuard> | null = null;
  let operationalUsage: ProviderOperationalUsageManifestRuntimeConfig | null = null;
  const operationalObservations: PromptWizardOperationalUsageObservation[] = [];
  try {
    // 运营留证配置先于 Ark client 和第一笔付费请求锁定；缺失时安全停止。
    operationalUsage = requireProviderOperationalUsageManifestRuntimeConfig();
    const runtime = createPromptWizardAttempt28ArkRuntime(operationalObservations);
    guard = runtime.physicalRequestGuard;
    await runPromptWizardUseDirectionCanary(runtime.provider, {
      physicalRequestGuard: guard,
      cases: PROMPT_WIZARD_ATTEMPT28_CANARY_CASES,
      requireOutputDiagnostics: true,
    });
  } catch (error) {
    emit(buildPromptWizardCanaryAbortEvent(error));
    process.exitCode = 1;
  } finally {
    if (operationalUsage && operationalObservations.length > 0) {
      try {
        await persistPromptWizardOperationalUsage(
          operationalUsage,
          operationalObservations,
        );
      } catch (error) {
        emit(buildPromptWizardCanaryAbortEvent(error));
        process.exitCode = 1;
      }
    }
    emit(buildPromptWizardAttempt28PhysicalRequestEvent(
      guard?.snapshot() ?? emptyAttempt28Snapshot(),
    ));
  }
}

function promptWizardAttempt28EvidenceStage<T>(
  reasonCode: PromptWizardAttempt28EvidenceReasonCode,
  operation: () => T,
) {
  try {
    return operation();
  } catch {
    throw promptWizardAttempt28EvidenceError(reasonCode);
  }
}

function promptWizardAttempt28EvidenceError(
  reasonCode: PromptWizardAttempt28EvidenceReasonCode,
) {
  return Object.assign(new Error('Attempt28 Canary 证据无效'), {
    code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
    parserStage: 'attempt28-contract',
    reasonCode,
  });
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry!) === fileURLToPath(import.meta.url);
}

if (isMainModule()) void main();
