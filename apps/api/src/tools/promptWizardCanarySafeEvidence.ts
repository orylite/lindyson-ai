import {
  PROMPT_WIZARD_CANARY_PHYSICAL_OPERATIONS,
  type PromptWizardCanaryOperationCounts,
  type PromptWizardCanaryPhysicalOperation,
} from './promptWizardCanaryV2Infrastructure.js';
import type {
  PromptWizardOutputDiagnostic,
  PromptWizardOutputDiagnosticClassification,
  PromptWizardOutputNormalizationMode,
  PromptWizardOutputOperation,
  PromptWizardOutputSchemaIssue,
} from '../providers/promptWizardProvider.js';

/**
 * Canary 修复诊断只允许持久化这些结构路径。生产事件生成器和永久审计解析器
 * 必须共用同一个谓词，避免事件已经安全写出、却在离线解析时被另一套白名单
 * 拒绝。这里列出的都是 Prompt Wizard 已知 Schema／Wire 路径，不接受自由文本。
 */
const PROMPT_WIZARD_CANARY_SAFE_FIELD_PATH_PATTERNS = [
  /^(?:name|hook|narrative|primaryScene|cameraAndPacing|prompt|segments|shots|voiceoverSlots|targetLanguage|verifiedOffer)$/u,
  /^(?:differenceTags|productionWarnings)(?:\[\d{1,2}\])?$/u,
  /^planningReview(?:\.(?:targetAudience|surfaceNeed|realPainPoint|nonAdEntry|directionFit|proofPoints\[\d{1,2}\]))?$/u,
  /^segments\[\d{1,2}\]\.(?:role|location|subject|shotSize|action|cameraMovement|lightingAndRealism|voiceover|voiceoverZh|foley|editingCue|productionNote)$/u,
  /^segments\[\d{1,2}\]\.evidenceRefs(?:\[\d{1,2}\])?$/u,
  /^shots(?:\[\d{1,2}\]|\.\d{1,2})\.(?:role|location|subject|shotSize|action|cameraMovement|lightingAndRealism|voiceover|voiceoverZh|foley|editingCue|productionNote)$/u,
  /^shots(?:\[\d{1,2}\]|\.\d{1,2})\.evidenceRefs(?:\[\d{1,2}\])?$/u,
  /^voiceoverSlots\.segment(?:[0-3]|N)(?:(?:\[\d{1,2}\]|\[\])|\.(?:voiceoverText|voiceoverZh)|\.voiceoverWords(?:\[\d{1,2}\]|\[\])?)?$/u,
  // 仅用于读取旧 V6 string V2 与 Attempt24/V5 已生成证据。
  /^segment[0-3]\.voiceoverText$/u,
  /^segment[0-3]\.voiceoverCharacters(?:\[\d{1,2}\])?$/u,
  /^(?:v[0-3]|z[0-3]|s[0-3](?:ShotSize|Action|CameraMovement|LightingAndRealism|Foley|EditingCue))$/u,
] as const;

export function isPromptWizardCanarySafeFieldPath(value: unknown): value is string {
  return typeof value === 'string'
    && PROMPT_WIZARD_CANARY_SAFE_FIELD_PATH_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * 辅助事件同样来自永久审计输入边界。这里直接以各生产日志构造器的实际
 * 顶层结构为唯一允许集合，并由键集合反向生成事件名集合，避免新增事件后
 * 忘记补字段白名单。字段可以因 JSON.stringify 省略 undefined，但绝不允许
 * 出现构造器未声明的动态字段。
 */
const PROMPT_WIZARD_CANARY_SAFE_AUXILIARY_EVENT_FIELDS: Readonly<
  Record<string, readonly string[]>
> = {
  'prompt-wizard-provider-retry': [
    'event', 'operation', 'model', 'serviceTier', 'attempt', 'nextAttempt', 'status',
    'errorName', 'errorCode', 'providerRequestId', 'responseId', 'xTtLogId',
    'receivedBytes', 'receivedEvent', 'retryable', 'delayMs',
  ],
  'prompt-wizard-provider-completed': [
    'event', 'operation', 'model', 'responseId', 'providerRequestId', 'xTtLogId',
    'status', 'attempts', 'latencyMs', 'inputTokens', 'outputTokens', 'serviceTier',
    'errorClassification',
  ],
  'prompt-wizard-provider-failed': [
    'event', 'operation', 'model', 'responseId', 'providerRequestId', 'xTtLogId',
    'status', 'attempts', 'latencyMs', 'inputTokens', 'outputTokens', 'serviceTier',
    'errorClassification', 'retryable', 'receivedBytes', 'receivedEvent',
  ],
  'prompt-wizard-provider-postprocess-failed': [
    'event', 'operation', 'model', 'responseId', 'providerRequestId', 'xTtLogId',
    'status', 'inputTokens', 'outputTokens', 'errorCode', 'errorClassification',
    'fieldPaths', 'issues',
  ],
  'prompt-wizard-draft-format-repair-triggered': [
    'event', 'operation', 'planIndex', 'model', 'responseId', 'providerRequestId',
    'xTtLogId', 'status', 'inputTokens', 'outputTokens', 'errorCode',
  ],
  'prompt-wizard-safe-camera-move-fallback': [
    'event', 'planIndex', 'actual', 'limit', 'repairRounds',
  ],
  'prompt-wizard-safe-conversion-cta-fallback': [
    'event', 'planIndex', 'targetLanguage', 'mode', 'repairRounds',
  ],
  'prompt-wizard-safe-cta-motion-fallback': [
    'event', 'planIndex', 'appearanceMode', 'repairRounds',
  ],
  'prompt-wizard-safe-difference-tag-fallback': [
    'event', 'planIndex', 'tagIndexes', 'repairRounds',
  ],
  'prompt-wizard-safe-editing-cue-fallback': [
    'event', 'planIndex', 'segmentIndexes', 'repairRounds',
  ],
  'prompt-wizard-safe-execution-combination-fallback': [
    'event', 'planIndex', 'issueCodes', 'actionLimit', 'repairRounds',
  ],
  'prompt-wizard-safe-first-shot-fallback': [
    'event', 'planIndex', 'reasons', 'repairRounds',
  ],
  'prompt-wizard-safe-lighting-motion-fallback': [
    'event', 'planIndex', 'segmentIndexes', 'repairRounds',
  ],
  'prompt-wizard-safe-major-action-fallback': [
    'event', 'planIndex', 'actual', 'limit', 'repairRounds',
  ],
  'prompt-wizard-safe-motion-combination-fallback': [
    'event', 'planIndex', 'repairRounds',
  ],
  'prompt-wizard-safe-production-note-fallback': [
    'event', 'planIndex', 'segmentIndexes', 'repairRounds',
  ],
  'prompt-wizard-safe-prop-fallback': [
    'event', 'planIndex', 'actual', 'limit', 'repairRounds',
  ],
  'prompt-wizard-safe-reference-action-fallback': [
    'event', 'planIndex', 'segmentIndexes', 'repairRounds',
  ],
  'prompt-wizard-safe-reference-metadata-fallback': [
    'event', 'planIndex', 'fieldPaths', 'repairRounds',
  ],
  'prompt-wizard-safe-segment-action-motion-fallback': [
    'event', 'planIndex', 'segmentIndexes', 'repairRounds',
  ],
  'prompt-wizard-safe-segment-camera-motion-fallback': [
    'event', 'planIndex', 'segmentIndexes', 'repairRounds',
  ],
  'prompt-wizard-safe-single-purchase-reason-voiceover-fallback': [
    'event', 'planIndex', 'targetLanguage', 'segmentIndexes', 'repairRounds',
  ],
  'prompt-wizard-safe-use-direction-action-fallback': [
    'event', 'planIndex', 'repairRounds',
  ],
  'prompt-wizard-safe-use-direction-narrative-fallback': [
    'event', 'planIndex', 'repairRounds',
  ],
  'prompt-wizard-safe-voiceover-compression-fallback': [
    'event', 'planIndex', 'repairRounds', 'beforeUnits', 'afterUnits', 'maxUnits',
    'segmentTargets',
  ],
  'prompt-wizard-safe-voiceover-expansion-fallback': [
    'event', 'planIndex', 'repairRounds', 'beforeUnits', 'afterUnits', 'minUnits',
  ],
  'prompt-wizard-safe-voiceover-overage-compressed': [
    'event', 'planIndex', 'overage', 'unit',
  ],
  'prompt-wizard-safe-voiceover-shortfall-filled': [
    'event', 'planIndex', 'shortfall', 'unit',
  ],
  'prompt-wizard-v6-safe-execution-budget-fallback': [
    'event', 'planIndex', 'repairRounds', 'issues',
  ],
  'prompt-wizard-v6-safe-motion-repair-camera-budget-fallback': [
    'event', 'planIndex', 'segmentIndex', 'repairRounds', 'issue',
  ],
  'prompt-wizard-v6-safe-format-recovery-camera-budget-fallback': [
    'event', 'planIndex', 'issue',
  ],
  'prompt-wizard-v6-safe-format-recovery-single-camera-motion-fallback': [
    'event', 'planIndex', 'segmentIndex', 'contentRepairRequestCount',
  ],
  'prompt-wizard-v6-safe-voiceover-cta-compression-fallback': [
    'event', 'planIndex', 'targetLanguage', 'repairRounds', 'beforeUnits', 'afterUnits',
    'maxUnits', 'lastBeforeUnits', 'lastAfterUnits',
  ],
  'prompt-wizard-v6-safe-voiceover-expansion-fallback': [
    'event', 'planIndex', 'targetLanguage', 'repairRounds', 'beforeUnits', 'afterUnits',
    'minUnits', 'segmentIndex', 'addedUnits',
  ],
  'prompt-wizard-v6-terminal-validation-failed': [
    'event', 'repairRounds', 'model', 'durationSeconds', 'failures',
  ],
};

const PROMPT_WIZARD_CANARY_SAFE_AUXILIARY_EVENTS = new Set(
  Object.keys(PROMPT_WIZARD_CANARY_SAFE_AUXILIARY_EVENT_FIELDS),
);

/**
 * 协议事件会被写入永久审计，因此不能仅凭 event 名称放行整条原始记录。
 * 每种事件只允许这里列出的固定字段；即使额外字段使用看似无害的键名，
 * 也必须失败关闭，避免借 `detail` 等动态键把 Provider 正文带入证据目录。
 */
const PROMPT_WIZARD_CANARY_PROTOCOL_EVENT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'prompt-wizard-v6-canary-initial-provider-identity': [
    'event', 'caseId', 'planIndex', 'role',
  ],
  'prompt-wizard-v6-canary-output-diagnostics': [
    'event', 'caseId', 'formatAnomalyCount', 'formatRecoveryCount', 'outputDiagnostics',
  ],
  'prompt-wizard-v6-canary-repair-diagnostics': [
    'event', 'caseId', 'contentRepairRequestCounts', 'terminalCalibrationRequestCounts',
    'repairDiagnostics',
  ],
  'prompt-wizard-v6-canary-batch': [
    'event', 'id', 'ok', 'routeCount', 'planCount', 'repairRounds', 'formatRepairCount',
    'formatAnomalyCount', 'contentRepairRequestCounts', 'terminalCalibrationRequestCounts',
    'routeDurationMs', 'draftDurationMs', 'model', 'draftInputTokens', 'draftOutputTokens',
  ],
  'prompt-wizard-v6-canary-completed': [
    'event', 'ok', 'completed', 'deliveredPlanCount', 'routeP95Ms', 'draftP95Ms',
    'formatRepairCount', 'formatAnomalyCount', 'contentRepairRequestCount',
    'terminalCalibrationRequestCount',
  ],
  'prompt-wizard-v6-canary-aborted': [
    'event', 'ok', 'error', 'errorCode', 'fieldPaths', 'repairRounds', 'planIndexes',
    'executionBudgetIssues', 'voiceoverCoverage', 'contentRepairRequestCounts',
    'terminalCalibrationRequestCounts', 'repairDiagnostics',
  ],
  'prompt-wizard-v6-attempt27-initial-provider-identity': [
    'event', 'caseId', 'planIndex', 'role',
  ],
  'prompt-wizard-v6-attempt27-output-diagnostics': [
    'event', 'caseId', 'formatAnomalyCount', 'formatRecoveryCount', 'outputDiagnostics',
  ],
  'prompt-wizard-v6-attempt27-batch': [
    'event', 'id', 'ok', 'initialDraftCount', 'naturalFormatRecoveryCount',
    'forcedFormatRecoveryCount',
  ],
  'prompt-wizard-v6-attempt27-completed': [
    'event', 'ok', 'completed', 'deliveredNaturalDraftCount',
    'naturalFormatRecoveryCount', 'forcedFormatRecoveryCount', 'diagnosticComplete',
    'releaseAllowed',
  ],
  'prompt-wizard-v6-attempt27-aborted': [
    'event', 'ok', 'error', 'errorCode',
  ],
  'prompt-wizard-v6-attempt27-physical-request-counts': [
    'event', 'physicalRequestSnapshot',
  ],
  'prompt-wizard-v6-attempt28-physical-request-counts': [
    'event', 'physicalRequestSnapshot',
  ],
};

const PROMPT_WIZARD_CANARY_SENSITIVE_KEYS = new Set([
  'body',
  'candidate',
  'cause',
  'draft',
  'drafts',
  'dynamicKey',
  'errorMessage',
  'hash',
  'input',
  'message',
  'output',
  'outputText',
  'output_text',
  'previousDraft',
  'product',
  'productName',
  'profile',
  'prompt',
  'providerBody',
  'raw',
  'repairAction',
  'responseBody',
  'stack',
  'summary',
  'voiceover',
  'voiceoverZh',
  'provider_body',
  'providerOutput',
  'providerRequest',
  'providerResponse',
  'providerResponseText',
  'requestBody',
  'requestInput',
  'response_body',
  'response',
  'responseText',
  'rawOutput',
  'rawResponse',
  'rawText',
  'request',
  'instructions',
  'systemprompt',
  'repairfeedback',
].map(canonicalAuditKey));

export interface PromptWizardCanaryProviderUsageSummary {
  requestEventCount: number;
  completedCount: number;
  failedCount: number;
  retryEventCount: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  unknownInputTokenCount: number;
  unknownOutputTokenCount: number;
  operationCounts: PromptWizardCanaryOperationCounts;
}

export interface PromptWizardCanarySafeTranscript {
  records: Record<string, unknown>[];
  normalizedEvents: Record<string, unknown>[];
  providerUsageSummary: PromptWizardCanaryProviderUsageSummary;
}

export type PromptWizardCanarySafeEvidenceParserStage =
  | 'transcript'
  | 'event'
  | 'protocol'
  | 'auxiliary'
  | 'security'
  | 'normalization';

export type PromptWizardCanarySafeEvidenceReasonCode =
  | 'invalid-json'
  | 'event-shape'
  | 'unknown-event'
  | 'protocol-shape'
  | 'protocol-value'
  | 'auxiliary-shape'
  | 'auxiliary-value'
  | 'sensitive-key'
  | 'validation-failed';

const OUTPUT_OPERATIONS = new Set<PromptWizardOutputOperation>([
  'generate-drafts',
  'repair-draft-format',
  'repair-draft-content',
  'refine-plan',
]);
const OUTPUT_STAGES = new Set<PromptWizardOutputDiagnostic['stage']>([
  'initial',
  'format-recovery',
  'content-repair',
  'refinement',
]);
const OUTPUT_PHASES = new Set<PromptWizardOutputDiagnostic['phase']>([
  'parse',
  'schema',
  'decoded',
]);
const OUTPUT_CLASSIFICATIONS = new Set<PromptWizardOutputDiagnosticClassification>([
  'valid-json',
  'non-json',
  'string-truncated',
  'escape-truncated',
  'container-truncated',
  'bracket-mismatch',
  'multiple-root-values',
  'invalid-token',
  'unknown',
]);
const OUTPUT_NORMALIZATION_MODES = new Set<PromptWizardOutputNormalizationMode>([
  'native',
  'fence-removed',
  'control-character-escaped',
  'single-object-extracted',
  'lexical-repair',
  'append-closing-delimiters',
  'none',
]);
const OUTPUT_SCHEMA_ISSUES = new Set<PromptWizardOutputSchemaIssue>([
  'not-applicable',
  'keyset',
  'count',
  'unit',
  'secondary-source',
  'translation',
  'wire-shape',
]);
const OUTPUT_LENGTH_BUCKETS = new Set<PromptWizardOutputDiagnostic['outputLengthBucket']>([
  'empty',
  '1-2048',
  '2049-8192',
  '8193-32768',
  '32769-64000',
  'over-64000',
]);
const OUTPUT_DEPTH_BUCKETS = new Set<PromptWizardOutputDiagnostic['containerDepthBucket']>([
  '0',
  '1-4',
  '5-8',
  '9-16',
  'over-16',
]);
const OUTPUT_TEXT_SOURCES = new Set<PromptWizardOutputDiagnostic['outputTextSource']>([
  'completed',
  'streamed-fallback',
]);

export interface PromptWizardCanaryOutputDiagnosticSummary {
  diagnostics: PromptWizardOutputDiagnostic[];
  formatAnomalyCount: number;
  releaseBlockingFormatAnomalyCount: number;
  formatRecoveryCount: number;
}

export function normalizePromptWizardCanaryOutputDiagnostics(
  value: unknown,
): PromptWizardCanaryOutputDiagnosticSummary {
  if (!Array.isArray(value) || value.length < 1 || value.length > 192) {
    throw promptWizardCanarySafeEvidenceError();
  }
  const diagnostics: PromptWizardOutputDiagnostic[] = [];
  const diagnosticIdentityCounts = new Map<string, number>();
  for (const raw of value) {
    if (
      !isRecord(raw)
      || !hasExactKeys(raw, [
        'planIndex',
        'operation',
        'stage',
        'phase',
        'classification',
        'normalizationMode',
        'outputLengthBucket',
        'containerDepthBucket',
        'outputTextSource',
        'schemaIssue',
        'fieldPaths',
      ])
      || boundedInteger(raw.planIndex, 0, 2) === null
      || typeof raw.operation !== 'string'
      || !OUTPUT_OPERATIONS.has(raw.operation as PromptWizardOutputOperation)
      || typeof raw.stage !== 'string'
      || !OUTPUT_STAGES.has(raw.stage as PromptWizardOutputDiagnostic['stage'])
      || typeof raw.phase !== 'string'
      || !OUTPUT_PHASES.has(raw.phase as PromptWizardOutputDiagnostic['phase'])
      || typeof raw.classification !== 'string'
      || !OUTPUT_CLASSIFICATIONS.has(
        raw.classification as PromptWizardOutputDiagnosticClassification,
      )
      || typeof raw.normalizationMode !== 'string'
      || !OUTPUT_NORMALIZATION_MODES.has(
        raw.normalizationMode as PromptWizardOutputNormalizationMode,
      )
      || typeof raw.schemaIssue !== 'string'
      || !OUTPUT_SCHEMA_ISSUES.has(
        raw.schemaIssue as PromptWizardOutputSchemaIssue,
      )
      || typeof raw.outputLengthBucket !== 'string'
      || !OUTPUT_LENGTH_BUCKETS.has(
        raw.outputLengthBucket as PromptWizardOutputDiagnostic['outputLengthBucket'],
      )
      || typeof raw.containerDepthBucket !== 'string'
      || !OUTPUT_DEPTH_BUCKETS.has(
        raw.containerDepthBucket as PromptWizardOutputDiagnostic['containerDepthBucket'],
      )
      || typeof raw.outputTextSource !== 'string'
      || !OUTPUT_TEXT_SOURCES.has(
        raw.outputTextSource as PromptWizardOutputDiagnostic['outputTextSource'],
      )
    ) {
      throw promptWizardCanarySafeEvidenceError();
    }
    const fieldPaths = normalizeFieldPaths(raw.fieldPaths);
    const expectedOperation = raw.stage === 'initial'
      ? 'generate-drafts'
      : raw.stage === 'format-recovery'
        ? 'repair-draft-format'
        : raw.stage === 'content-repair'
          ? 'repair-draft-content'
          : 'refine-plan';
    const diagnosticIdentity = `${raw.planIndex}#${raw.operation}#${raw.stage}`;
    const diagnosticIdentityCount = diagnosticIdentityCounts.get(diagnosticIdentity) ?? 0;
    const diagnosticIdentityLimit = raw.stage === 'content-repair' ? 2 : 1;
    if (
      raw.operation !== expectedOperation
      || diagnosticIdentityCount >= diagnosticIdentityLimit
      || (raw.phase === 'schema') === (raw.schemaIssue === 'not-applicable')
      || (raw.classification === 'valid-json' && raw.normalizationMode === 'none')
      || raw.classification !== 'valid-json' && raw.normalizationMode === 'native'
      || ((raw.phase === 'schema' || raw.phase === 'decoded')
        && raw.classification !== 'valid-json')
    ) {
      throw promptWizardCanarySafeEvidenceError();
    }
    diagnosticIdentityCounts.set(diagnosticIdentity, diagnosticIdentityCount + 1);
    diagnostics.push({
      planIndex: raw.planIndex as 0 | 1 | 2,
      operation: raw.operation as PromptWizardOutputOperation,
      stage: raw.stage as PromptWizardOutputDiagnostic['stage'],
      phase: raw.phase as PromptWizardOutputDiagnostic['phase'],
      classification: raw.classification as PromptWizardOutputDiagnosticClassification,
      normalizationMode: raw.normalizationMode as PromptWizardOutputNormalizationMode,
      schemaIssue: raw.schemaIssue as PromptWizardOutputSchemaIssue,
      outputLengthBucket: raw.outputLengthBucket as PromptWizardOutputDiagnostic['outputLengthBucket'],
      containerDepthBucket: raw.containerDepthBucket as PromptWizardOutputDiagnostic['containerDepthBucket'],
      outputTextSource: raw.outputTextSource as 'completed' | 'streamed-fallback',
      fieldPaths,
    });
  }
  return {
    diagnostics,
    formatAnomalyCount: diagnostics.filter(diagnostic => (
      diagnostic.classification !== 'valid-json'
      || diagnostic.normalizationMode !== 'native'
    )).length,
    // Flat Scalar 的 append-closing-delimiters 只能给深度 1、最后一个标量值
    // 已完整的根对象补唯一末尾 `}`，随后仍须通过 JSON、Schema 与完整领域门禁。
    // 它保留为格式异常诊断，但不占用 A28 的 Provider 格式恢复发布额度。
    releaseBlockingFormatAnomalyCount: diagnostics.filter(diagnostic => (
      diagnostic.classification !== 'valid-json'
      || (
        diagnostic.normalizationMode !== 'native'
        && diagnostic.normalizationMode !== 'append-closing-delimiters'
      )
    )).length,
    formatRecoveryCount: diagnostics.filter(diagnostic => (
      diagnostic.stage === 'format-recovery'
    )).length,
  };
}

/**
 * 原始 NDJSON 只允许在临时文件中进入此边界。每行必须是已知事件；任意层级出现
 * 正文、口播、错误 message/stack/cause、哈希或动态内容键都会失败关闭。返回值
 * 只含固定白名单字段，可安全写入永久审计目录。
 */
export function parsePromptWizardCanarySafeTranscript(input: {
  transcript: string;
  protocolEvents: ReadonlySet<string>;
}): PromptWizardCanarySafeTranscript {
  const records = input.transcript.split(/\r?\n/u).flatMap((line) => {
    if (!line.trim()) return [];
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw promptWizardCanarySafeEvidenceError('transcript', 'invalid-json');
    }
    if (!isRecord(value) || typeof value.event !== 'string') {
      throw promptWizardCanarySafeEvidenceError('event', 'event-shape');
    }
    const isProtocolEvent = input.protocolEvents.has(value.event);
    const isAuxiliaryEvent = PROMPT_WIZARD_CANARY_SAFE_AUXILIARY_EVENTS.has(value.event);
    if (!isProtocolEvent && !isAuxiliaryEvent) {
      throw promptWizardCanarySafeEvidenceError('event', 'unknown-event');
    }
    if (!isProtocolEvent) {
      const allowedFields = PROMPT_WIZARD_CANARY_SAFE_AUXILIARY_EVENT_FIELDS[value.event];
      if (
        !allowedFields
        || Object.keys(value).some(key => !allowedFields.includes(key))
      ) {
        throw promptWizardCanarySafeEvidenceError('auxiliary', 'auxiliary-shape');
      }
    }
    assertNoSensitiveKeys(value);
    return [value];
  });

  const operationCounts = emptyOperationCounts();
  let completedCount = 0;
  let failedCount = 0;
  let retryEventCount = 0;
  let attempts = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let unknownInputTokenCount = 0;
  let unknownOutputTokenCount = 0;
  const normalizedEvents: Record<string, unknown>[] = [];
  for (const record of records) {
    const event = record.event as string;
    if (input.protocolEvents.has(event)) {
      normalizedEvents.push(normalizeProtocolEvent(record));
      continue;
    }
    if (event === 'prompt-wizard-provider-retry') {
      retryEventCount += 1;
      normalizedEvents.push({ event });
      continue;
    }
    if (event === 'prompt-wizard-provider-completed' || event === 'prompt-wizard-provider-failed') {
      const operation = normalizeOperation(record.operation);
      const attemptCount = boundedInteger(record.attempts, 1, 1);
      const safeInputTokens = nullableBoundedInteger(record.inputTokens, 100_000_000);
      const safeOutputTokens = nullableBoundedInteger(record.outputTokens, 100_000_000);
      if (!operation || attemptCount === null || safeInputTokens === undefined
        || safeOutputTokens === undefined) {
        throw promptWizardCanarySafeEvidenceError();
      }
      operationCounts[operation] += 1;
      attempts += attemptCount;
      if (safeInputTokens === null) unknownInputTokenCount += 1;
      else inputTokens += safeInputTokens;
      if (safeOutputTokens === null) unknownOutputTokenCount += 1;
      else outputTokens += safeOutputTokens;
      if (event === 'prompt-wizard-provider-completed') completedCount += 1;
      else failedCount += 1;
      normalizedEvents.push({
        event,
        operation,
        status: nullableBoundedInteger(record.status, 599),
        attempts: attemptCount,
        inputTokens: safeInputTokens,
        outputTokens: safeOutputTokens,
        ...(event === 'prompt-wizard-provider-failed'
          ? { errorClassification: normalizeClassification(record.errorClassification) }
          : {}),
      });
      continue;
    }
    if (event === 'prompt-wizard-provider-postprocess-failed') {
      const operation = normalizeOperation(record.operation);
      if (!operation) throw promptWizardCanarySafeEvidenceError();
      normalizedEvents.push({
        event,
        operation,
        errorCode: normalizeClassification(record.errorCode),
        fieldPaths: normalizeFieldPaths(record.fieldPaths),
      });
      continue;
    }
    if (event === 'prompt-wizard-draft-format-repair-triggered') {
      const planIndex = boundedInteger(record.planIndex, 0, 2);
      if (planIndex === null || record.operation !== 'repair-draft-format') {
        throw promptWizardCanarySafeEvidenceError();
      }
      normalizedEvents.push({
        event,
        operation: 'repair-draft-format',
        planIndex,
        errorCode: normalizeClassification(record.errorCode),
      });
      continue;
    }
    normalizedEvents.push(normalizeFallbackEvent(record));
  }
  return {
    records,
    normalizedEvents,
    providerUsageSummary: {
      requestEventCount: completedCount + failedCount,
      completedCount,
      failedCount,
      retryEventCount,
      attempts,
      inputTokens,
      outputTokens,
      unknownInputTokenCount,
      unknownOutputTokenCount,
      operationCounts,
    },
  };
}

function normalizeProtocolEvent(record: Record<string, unknown>) {
  const event = record.event;
  const allowedFields = typeof event === 'string'
    ? PROMPT_WIZARD_CANARY_PROTOCOL_EVENT_FIELDS[event]
    : undefined;
  if (
    !allowedFields
    || Object.keys(record).some(key => !allowedFields.includes(key))
  ) {
    throw promptWizardCanarySafeEvidenceError();
  }
  return Object.fromEntries(allowedFields.flatMap(field => (
    Object.hasOwn(record, field)
      ? [[field, normalizeProtocolEventField(field, record[field])]]
      : []
  )));
}

function normalizeProtocolEventField(field: string, value: unknown): unknown {
  if (field === 'outputDiagnostics') {
    return normalizePromptWizardCanaryOutputDiagnostics(value).diagnostics;
  }
  if (field === 'repairDiagnostics') {
    return normalizeProtocolRepairDiagnostics(value);
  }
  if (field === 'physicalRequestSnapshot') {
    return normalizeProtocolPhysicalRequestSnapshot(value);
  }
  if (field === 'executionBudgetIssues') {
    return normalizeProtocolExecutionBudgetIssues(value);
  }
  if (field === 'voiceoverCoverage') {
    return normalizeProtocolVoiceoverCoverage(value);
  }
  if (field === 'contentRepairRequestCounts') {
    return normalizeProtocolPlanRequestCounts(value, 2);
  }
  if (field === 'terminalCalibrationRequestCounts') {
    return normalizeProtocolPlanRequestCounts(value, 1);
  }
  if (field === 'fieldPaths') return normalizeFieldPaths(value);
  if (field === 'planIndexes') {
    if (
      !Array.isArray(value)
      || value.length > 3
      || value.some(item => boundedInteger(item, 0, 2) === null)
      || new Set(value).size !== value.length
    ) throw promptWizardCanarySafeEvidenceError();
    return [...value] as number[];
  }
  if (field === 'model') {
    if (value !== 'doubao-seed-2-0-lite-260428') {
      throw promptWizardCanarySafeEvidenceError();
    }
    return value;
  }
  if (field === 'role') {
    if (
      value !== 'proof-conversion'
      && value !== 'problem-hook'
      && value !== 'lifestyle-seeding'
    ) throw promptWizardCanarySafeEvidenceError();
    return value;
  }
  if (field === 'caseId' || field === 'id') {
    if (typeof value !== 'string' || !/^[\p{L}\p{N}._:-]{1,96}$/u.test(value)) {
      throw promptWizardCanarySafeEvidenceError();
    }
    return value;
  }
  if (field === 'errorCode') {
    const errorCode = normalizeClassification(value);
    if (!errorCode) throw promptWizardCanarySafeEvidenceError();
    return errorCode;
  }
  if (field === 'error') {
    if (
      value !== 'V6 Provider Canary 未通过'
      && value !== 'Attempt27 不可发布诊断未通过'
    ) throw promptWizardCanarySafeEvidenceError();
    return value;
  }
  if (field === 'planIndex') {
    const planIndex = boundedInteger(value, 0, 2);
    if (planIndex === null) throw promptWizardCanarySafeEvidenceError();
    return planIndex;
  }
  if (field === 'repairRounds') {
    const repairRounds = boundedInteger(value, 0, 3);
    if (repairRounds === null) throw promptWizardCanarySafeEvidenceError();
    return repairRounds;
  }
  if (
    value === null
    || typeof value === 'boolean'
    || (typeof value === 'number'
      && Number.isSafeInteger(value)
      && value >= 0
      && value <= 1_000_000_000_000)
  ) return value;
  if (
    typeof value === 'string'
    && value.length <= 256
    && !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)
  ) return value;
  throw promptWizardCanarySafeEvidenceError();
}

function normalizeProtocolRepairDiagnostics(value: unknown) {
  if (!Array.isArray(value) || value.length > 12) {
    throw promptWizardCanarySafeEvidenceError();
  }
  const identities = new Set<string>();
  return value.map((candidate) => {
    if (
      !isRecord(candidate)
      || !hasExactKeys(candidate, [
        'planIndex', 'origin', 'repairRound', 'errorCode', 'fieldPaths',
      ])
    ) throw promptWizardCanarySafeEvidenceError();
    const planIndex = boundedInteger(candidate.planIndex, 0, 2);
    const repairRound = boundedInteger(candidate.repairRound, 1, 3);
    const origin = candidate.origin;
    const errorCode = normalizeClassification(candidate.errorCode);
    const fieldPaths = normalizeFieldPaths(candidate.fieldPaths);
    if (
      planIndex === null
      || repairRound === null
      || (origin !== 'initial-schema'
        && origin !== 'domain-validation'
        && origin !== 'terminal-calibration')
      || !errorCode
    ) throw promptWizardCanarySafeEvidenceError();
    const identity = `${planIndex}#${origin}#${repairRound}`;
    if (identities.has(identity)) throw promptWizardCanarySafeEvidenceError();
    identities.add(identity);
    return { planIndex, origin, repairRound, errorCode, fieldPaths };
  });
}

function normalizeProtocolPlanRequestCounts(value: unknown, maximum: number) {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some(item => boundedInteger(item, 0, maximum) === null)
  ) throw promptWizardCanarySafeEvidenceError();
  return value.map(Number) as [number, number, number];
}

function normalizeProtocolPhysicalRequestSnapshot(value: unknown) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'globalCount', 'caseCounts', 'operationCounts', 'caseOperationCounts',
      'casePlanContentRepairCounts',
    ])
    || boundedInteger(value.globalCount, 0, 1_000) === null
  ) throw promptWizardCanarySafeEvidenceError();
  const rawCaseCounts = value.caseCounts;
  const rawOperationCounts = value.operationCounts;
  const rawCaseOperationCounts = value.caseOperationCounts;
  const rawCasePlanContentRepairCounts = value.casePlanContentRepairCounts;
  if (
    !isRecord(rawCaseCounts)
    || !isRecord(rawOperationCounts)
    || !isRecord(rawCaseOperationCounts)
    || !isRecord(rawCasePlanContentRepairCounts)
  ) throw promptWizardCanarySafeEvidenceError();
  const caseIds = Object.keys(rawCaseCounts);
  if (
    caseIds.length < 1
    || caseIds.length > 32
    || caseIds.some(caseId => (
      !/^[\p{L}\p{N}._:-]{1,96}$/u.test(caseId)
      || !Object.hasOwn(rawCaseOperationCounts, caseId)
      || !Object.hasOwn(rawCasePlanContentRepairCounts, caseId)
    ))
    || !hasExactKeys(rawCaseOperationCounts, caseIds)
    || !hasExactKeys(rawCasePlanContentRepairCounts, caseIds)
  ) throw promptWizardCanarySafeEvidenceError();

  const caseCounts = Object.fromEntries(caseIds.map((caseId) => {
    const count = boundedInteger(rawCaseCounts[caseId], 0, 1_000);
    if (count === null) throw promptWizardCanarySafeEvidenceError();
    return [caseId, count];
  }));
  const operationCounts = normalizeProtocolOperationCounts(rawOperationCounts);
  const caseOperationCounts = Object.fromEntries(caseIds.map((caseId) => [
    caseId,
    normalizeProtocolOperationCounts(rawCaseOperationCounts[caseId]),
  ]));
  const casePlanContentRepairCounts = Object.fromEntries(caseIds.map((caseId) => [
    caseId,
    normalizeProtocolPlanRequestCounts(rawCasePlanContentRepairCounts[caseId], 2),
  ]));
  return {
    globalCount: Number(value.globalCount),
    caseCounts,
    operationCounts,
    caseOperationCounts,
    casePlanContentRepairCounts,
  };
}

function normalizeProtocolOperationCounts(value: unknown): PromptWizardCanaryOperationCounts {
  if (
    !isRecord(value)
    || !hasExactKeys(value, PROMPT_WIZARD_CANARY_PHYSICAL_OPERATIONS)
  ) throw promptWizardCanarySafeEvidenceError();
  const result = emptyOperationCounts();
  for (const operation of PROMPT_WIZARD_CANARY_PHYSICAL_OPERATIONS) {
    const count = boundedInteger(value[operation], 0, 1_000);
    if (count === null) throw promptWizardCanarySafeEvidenceError();
    result[operation] = count;
  }
  return result;
}

function normalizeProtocolExecutionBudgetIssues(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw promptWizardCanarySafeEvidenceError();
  }
  return value.map((candidate) => {
    if (
      !isRecord(candidate)
      || !hasExactKeys(candidate, ['code', 'fieldPath', 'actual', 'limit'])
      || typeof candidate.code !== 'string'
      || !/^(?:TOO_MANY_(?:LOCATIONS|PEOPLE|ACTIONS|PROPS|CAMERA_MOVES)|MAGIC_TRANSITION_FORBIDDEN)$/u
        .test(candidate.code)
      || typeof candidate.fieldPath !== 'string'
      || !/^segments(?:\[\d{1,2}\])?$/u.test(candidate.fieldPath)
      || !((typeof candidate.actual === 'number' && Number.isSafeInteger(candidate.actual))
        || typeof candidate.actual === 'boolean')
      || !((typeof candidate.limit === 'number' && Number.isSafeInteger(candidate.limit))
        || typeof candidate.limit === 'boolean')
      || typeof candidate.actual !== typeof candidate.limit
    ) throw promptWizardCanarySafeEvidenceError();
    return {
      code: candidate.code,
      fieldPath: candidate.fieldPath,
      actual: candidate.actual,
      limit: candidate.limit,
    };
  });
}

function normalizeProtocolVoiceoverCoverage(value: unknown) {
  const fields = [
    'actualUnits', 'minUnits', 'targetUnits', 'maxUnits', 'unit',
    'segmentActualUnits', 'segmentMinUnits', 'segmentTargetUnits', 'segmentMaxUnits',
  ] as const;
  if (!isRecord(value) || !hasExactKeys(value, fields)) {
    throw promptWizardCanarySafeEvidenceError();
  }
  const actualUnits = boundedInteger(value.actualUnits, 0, 10_000);
  const minUnits = boundedInteger(value.minUnits, 1, 10_000);
  const targetUnits = boundedInteger(value.targetUnits, 1, 10_000);
  const maxUnits = boundedInteger(value.maxUnits, 1, 10_000);
  const readUnits = (field: typeof fields[number]) => {
    const items = value[field];
    if (
      !Array.isArray(items)
      || items.length < 1
      || items.length > 8
      || items.some(item => boundedInteger(item, 0, 1_000) === null)
    ) throw promptWizardCanarySafeEvidenceError();
    return items.map(Number);
  };
  const segmentActualUnits = readUnits('segmentActualUnits');
  const segmentMinUnits = readUnits('segmentMinUnits');
  const segmentTargetUnits = readUnits('segmentTargetUnits');
  const segmentMaxUnits = readUnits('segmentMaxUnits');
  if (
    actualUnits === null
    || minUnits === null
    || targetUnits === null
    || maxUnits === null
    || (value.unit !== 'words' && value.unit !== 'characters')
    || new Set([
      segmentActualUnits.length,
      segmentMinUnits.length,
      segmentTargetUnits.length,
      segmentMaxUnits.length,
    ]).size !== 1
  ) throw promptWizardCanarySafeEvidenceError();
  return {
    actualUnits,
    minUnits,
    targetUnits,
    maxUnits,
    unit: value.unit,
    segmentActualUnits,
    segmentMinUnits,
    segmentTargetUnits,
    segmentMaxUnits,
  };
}

function normalizeFallbackEvent(record: Record<string, unknown>) {
  if (record.event === 'prompt-wizard-safe-segment-camera-motion-fallback') {
    return normalizeSafeSegmentCameraMotionFallback(record);
  }
  if (record.event === 'prompt-wizard-v6-safe-motion-repair-camera-budget-fallback') {
    return normalizeSafeMotionRepairCameraBudgetFallback(record);
  }
  if (record.event === 'prompt-wizard-v6-safe-format-recovery-camera-budget-fallback') {
    return normalizeSafeFormatRecoveryCameraBudgetFallback(record);
  }
  if (
    record.event
      === 'prompt-wizard-v6-safe-format-recovery-single-camera-motion-fallback'
  ) {
    return normalizeSafeFormatRecoverySingleCameraMotionFallback(record);
  }
  const planIndex = boundedInteger(record.planIndex, 0, 2);
  const repairRounds = boundedInteger(record.repairRounds, 0, 3);
  return {
    event: record.event,
    ...(planIndex === null ? {} : { planIndex }),
    ...(repairRounds === null ? {} : { repairRounds }),
  };
}

function normalizeSafeFormatRecoverySingleCameraMotionFallback(
  record: Record<string, unknown>,
) {
  if (!hasExactKeys(record, [
    'event', 'planIndex', 'segmentIndex', 'contentRepairRequestCount',
  ])) {
    throw promptWizardCanarySafeEvidenceError('auxiliary', 'auxiliary-shape');
  }
  const planIndex = boundedInteger(record.planIndex, 0, 2);
  const segmentIndex = boundedInteger(record.segmentIndex, 0, 3);
  if (
    planIndex === null
    || segmentIndex === null
    || record.contentRepairRequestCount !== 0
  ) {
    throw promptWizardCanarySafeEvidenceError('auxiliary', 'auxiliary-value');
  }
  return {
    event: record.event,
    planIndex,
    segmentIndex,
    contentRepairRequestCount: 0,
  };
}

function normalizeSafeSegmentCameraMotionFallback(record: Record<string, unknown>) {
  if (!hasExactKeys(record, [
    'event', 'planIndex', 'segmentIndexes', 'repairRounds',
  ])) {
    throw promptWizardCanarySafeEvidenceError('auxiliary', 'auxiliary-shape');
  }
  const planIndex = boundedInteger(record.planIndex, 0, 2);
  const repairRounds = boundedInteger(record.repairRounds, 1, 2);
  const segmentIndexes = record.segmentIndexes;
  if (
    planIndex === null
    || repairRounds === null
    || !Array.isArray(segmentIndexes)
    || segmentIndexes.length < 1
    || segmentIndexes.length > 4
    || segmentIndexes.some(segmentIndex => boundedInteger(segmentIndex, 0, 3) === null)
    || new Set(segmentIndexes).size !== segmentIndexes.length
  ) {
    throw promptWizardCanarySafeEvidenceError('auxiliary', 'auxiliary-value');
  }
  return {
    event: record.event,
    planIndex,
    segmentIndexes: segmentIndexes.map(Number),
    repairRounds,
  };
}

function normalizeSafeMotionRepairCameraBudgetFallback(record: Record<string, unknown>) {
  if (!hasExactKeys(record, [
    'event', 'planIndex', 'segmentIndex', 'repairRounds', 'issue',
  ])) {
    throw promptWizardCanarySafeEvidenceError('auxiliary', 'auxiliary-shape');
  }
  const planIndex = boundedInteger(record.planIndex, 0, 2);
  const segmentIndex = boundedInteger(record.segmentIndex, 0, 3);
  const repairRounds = boundedInteger(record.repairRounds, 1, 2);
  if (planIndex === null || segmentIndex === null || repairRounds === null) {
    throw promptWizardCanarySafeEvidenceError('auxiliary', 'auxiliary-value');
  }
  return {
    event: record.event,
    planIndex,
    segmentIndex,
    repairRounds,
    issue: normalizeSafeCameraBudgetIssue(record.issue),
  };
}

function normalizeSafeFormatRecoveryCameraBudgetFallback(record: Record<string, unknown>) {
  if (!hasExactKeys(record, ['event', 'planIndex', 'issue'])) {
    throw promptWizardCanarySafeEvidenceError('auxiliary', 'auxiliary-shape');
  }
  const planIndex = boundedInteger(record.planIndex, 0, 2);
  if (planIndex === null) {
    throw promptWizardCanarySafeEvidenceError('auxiliary', 'auxiliary-value');
  }
  const issue = normalizeSafeCameraBudgetIssue(record.issue);
  // 该 fallback 的生产谓词只允许西班牙语 10 秒格式恢复的唯一 4 / 3 运镜预算。
  if (issue.actual !== 4 || issue.limit !== 3) {
    throw promptWizardCanarySafeEvidenceError('auxiliary', 'auxiliary-value');
  }
  return {
    event: record.event,
    planIndex,
    issue,
  };
}

function normalizeSafeCameraBudgetIssue(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, [
    'code', 'fieldPath', 'actual', 'limit',
  ])) {
    throw promptWizardCanarySafeEvidenceError('auxiliary', 'auxiliary-shape');
  }
  const actual = boundedInteger(value.actual, 1, 1_000);
  const limit = boundedInteger(value.limit, 1, 1_000);
  if (
    value.code !== 'TOO_MANY_CAMERA_MOVES'
    || value.fieldPath !== 'segments'
    || actual === null
    || limit === null
    || actual <= limit
  ) {
    throw promptWizardCanarySafeEvidenceError('auxiliary', 'auxiliary-value');
  }
  return {
    code: 'TOO_MANY_CAMERA_MOVES',
    fieldPath: 'segments',
    actual,
    limit,
  };
}

function assertNoSensitiveKeys(value: unknown, depth = 0) {
  if (depth > 12) {
    throw promptWizardCanarySafeEvidenceError('security', 'sensitive-key');
  }
  if (Array.isArray(value)) {
    if (value.length > 128) {
      throw promptWizardCanarySafeEvidenceError('security', 'sensitive-key');
    }
    value.forEach(item => assertNoSensitiveKeys(item, depth + 1));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (PROMPT_WIZARD_CANARY_SENSITIVE_KEYS.has(canonicalAuditKey(key))) {
      throw promptWizardCanarySafeEvidenceError('security', 'sensitive-key');
    }
    assertNoSensitiveKeys(child, depth + 1);
  }
}

function canonicalAuditKey(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function normalizeOperation(value: unknown): PromptWizardCanaryPhysicalOperation | null {
  return typeof value === 'string'
    && PROMPT_WIZARD_CANARY_PHYSICAL_OPERATIONS.includes(
      value as PromptWizardCanaryPhysicalOperation,
    )
    ? value as PromptWizardCanaryPhysicalOperation
    : null;
}

function normalizeClassification(value: unknown) {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(value)
    ? value
    : null;
}

function normalizeFieldPaths(value: unknown) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value)
    || value.length > 24
    || value.some(path => !isPromptWizardCanarySafeFieldPath(path))
  ) {
    throw promptWizardCanarySafeEvidenceError();
  }
  return Array.from(new Set(value as string[]));
}

function nullableBoundedInteger(value: unknown, maximum: number): number | null | undefined {
  if (value === null) return null;
  return boundedInteger(value, 0, maximum) ?? undefined;
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function emptyOperationCounts(): PromptWizardCanaryOperationCounts {
  return {
    'generate-drafts': 0,
    'repair-draft-format': 0,
    'repair-draft-content': 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === expected.length
    && actual.every(key => expected.includes(key))
    && expected.every(key => Object.hasOwn(value, key));
}

function promptWizardCanarySafeEvidenceError(
  parserStage: PromptWizardCanarySafeEvidenceParserStage = 'normalization',
  reasonCode: PromptWizardCanarySafeEvidenceReasonCode = 'validation-failed',
) {
  return Object.assign(new Error('Prompt Wizard Canary NDJSON 证据不在安全白名单'), {
    code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
    parserStage,
    reasonCode,
  });
}
