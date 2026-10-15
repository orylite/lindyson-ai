import { describe, expect, it } from 'vitest';
import {
  normalizePromptWizardCanaryOutputDiagnostics,
  parsePromptWizardCanarySafeTranscript,
} from '../src/tools/promptWizardCanarySafeEvidence.js';

const protocolEvents = new Set([
  'prompt-wizard-v6-canary-completed',
  'prompt-wizard-v6-canary-output-diagnostics',
  'prompt-wizard-v6-canary-repair-diagnostics',
  'prompt-wizard-v6-canary-batch',
  'prompt-wizard-v6-attempt27-physical-request-counts',
]);

function line(value: unknown) {
  return JSON.stringify(value);
}

function parseFailure(value: unknown) {
  try {
    parsePromptWizardCanarySafeTranscript({
      protocolEvents,
      transcript: line(value),
    });
  } catch (error) {
    return error;
  }
  throw new Error('预期安全证据解析失败');
}

/**
 * 与 Provider／领域服务中的生产 JSON 日志构造器保持同形。Attempt27/28 会从
 * 同一进程 stderr 捕获这些事件，因此测试必须同时证明真实字段不会被误拒绝，
 * 以及每一种辅助事件都不能夹带日志构造器之外的字段。
 */
const auxiliaryEventSamples: Record<string, unknown>[] = [
  {
    event: 'prompt-wizard-provider-retry',
    operation: 'generate-drafts',
    model: 'doubao-seed-2-0-lite-260428',
    serviceTier: 'default',
    attempt: 1,
    nextAttempt: 2,
    status: 429,
    errorName: 'ProviderError',
    errorCode: 'RATE_LIMITED',
    providerRequestId: 'provider-request-id',
    responseId: 'response-id',
    xTtLogId: 'log-id',
    receivedBytes: 128,
    receivedEvent: true,
    retryable: true,
    delayMs: 250,
  },
  {
    event: 'prompt-wizard-provider-completed',
    operation: 'generate-drafts',
    model: 'doubao-seed-2-0-lite-260428',
    responseId: 'response-id',
    providerRequestId: 'provider-request-id',
    xTtLogId: 'log-id',
    status: 200,
    attempts: 1,
    latencyMs: 10,
    inputTokens: 120,
    outputTokens: 30,
    serviceTier: 'default',
    errorClassification: null,
  },
  {
    event: 'prompt-wizard-provider-failed',
    operation: 'repair-draft-format',
    model: 'doubao-seed-2-0-lite-260428',
    responseId: null,
    providerRequestId: 'provider-request-id',
    xTtLogId: 'log-id',
    status: 500,
    attempts: 1,
    latencyMs: 10,
    inputTokens: null,
    outputTokens: null,
    serviceTier: 'default',
    errorClassification: 'PROVIDER_ERROR',
    retryable: false,
    receivedBytes: 0,
    receivedEvent: false,
  },
  {
    event: 'prompt-wizard-provider-postprocess-failed',
    operation: 'generate-drafts',
    model: 'doubao-seed-2-0-lite-260428',
    responseId: 'response-id',
    providerRequestId: 'provider-request-id',
    xTtLogId: 'log-id',
    status: 200,
    inputTokens: 120,
    outputTokens: 30,
    errorCode: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
    errorClassification: null,
    fieldPaths: ['shots[0].action'],
    issues: [{ path: 'shots[0].action', kind: 'schema', limit: null, actual: null }],
  },
  {
    event: 'prompt-wizard-draft-format-repair-triggered',
    operation: 'repair-draft-format',
    planIndex: 0,
    model: 'doubao-seed-2-0-lite-260428',
    responseId: 'response-id',
    providerRequestId: 'provider-request-id',
    xTtLogId: 'log-id',
    status: 200,
    inputTokens: 120,
    outputTokens: 30,
    errorCode: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
  },
  {
    event: 'prompt-wizard-safe-camera-move-fallback',
    planIndex: 0,
    actual: 2,
    limit: 1,
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-conversion-cta-fallback',
    planIndex: 0,
    targetLanguage: '英语',
    mode: 'compact',
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-cta-motion-fallback',
    planIndex: 0,
    appearanceMode: 'product-only',
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-difference-tag-fallback',
    planIndex: 0,
    tagIndexes: [0],
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-editing-cue-fallback',
    planIndex: 0,
    segmentIndexes: [0],
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-execution-combination-fallback',
    planIndex: 0,
    issueCodes: ['TOO_MANY_ACTIONS'],
    actionLimit: 1,
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-first-shot-fallback',
    planIndex: 0,
    reasons: ['observable-action'],
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-lighting-motion-fallback',
    planIndex: 0,
    segmentIndexes: [0],
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-major-action-fallback',
    planIndex: 0,
    actual: 2,
    limit: 1,
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-motion-combination-fallback',
    planIndex: 0,
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-production-note-fallback',
    planIndex: 0,
    segmentIndexes: [0],
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-prop-fallback',
    planIndex: 0,
    actual: 2,
    limit: 1,
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-reference-action-fallback',
    planIndex: 0,
    segmentIndexes: [0],
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-reference-metadata-fallback',
    planIndex: 0,
    fieldPaths: ['shots[0].action'],
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-segment-action-motion-fallback',
    planIndex: 0,
    segmentIndexes: [0],
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-segment-camera-motion-fallback',
    planIndex: 0,
    segmentIndexes: [0, 3],
    repairRounds: 2,
  },
  {
    event: 'prompt-wizard-v6-safe-format-recovery-single-camera-motion-fallback',
    planIndex: 1,
    segmentIndex: 2,
    contentRepairRequestCount: 0,
  },
  {
    event: 'prompt-wizard-safe-single-purchase-reason-voiceover-fallback',
    planIndex: 0,
    targetLanguage: '英语',
    segmentIndexes: [1],
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-use-direction-action-fallback',
    planIndex: 0,
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-use-direction-narrative-fallback',
    planIndex: 0,
    repairRounds: 1,
  },
  {
    event: 'prompt-wizard-safe-voiceover-compression-fallback',
    planIndex: 0,
    repairRounds: 1,
    beforeUnits: 40,
    afterUnits: 38,
    maxUnits: 38,
    segmentTargets: [10, 18, 10],
  },
  {
    event: 'prompt-wizard-safe-voiceover-expansion-fallback',
    planIndex: 0,
    repairRounds: 1,
    beforeUnits: 30,
    afterUnits: 32,
    minUnits: 32,
  },
  {
    event: 'prompt-wizard-safe-voiceover-overage-compressed',
    planIndex: 0,
    overage: 2,
    unit: 'words',
  },
  {
    event: 'prompt-wizard-safe-voiceover-shortfall-filled',
    planIndex: 0,
    shortfall: 2,
    unit: 'words',
  },
  {
    event: 'prompt-wizard-v6-safe-execution-budget-fallback',
    planIndex: 0,
    repairRounds: 1,
    issues: [{ code: 'TOO_MANY_PROPS', fieldPath: 'segments[0]', actual: 2, limit: 1 }],
  },
  {
    event: 'prompt-wizard-v6-safe-motion-repair-camera-budget-fallback',
    planIndex: 1,
    segmentIndex: 2,
    repairRounds: 1,
    issue: {
      code: 'TOO_MANY_CAMERA_MOVES',
      fieldPath: 'segments',
      actual: 4,
      limit: 3,
    },
  },
  {
    event: 'prompt-wizard-v6-safe-format-recovery-camera-budget-fallback',
    planIndex: 2,
    issue: {
      code: 'TOO_MANY_CAMERA_MOVES',
      fieldPath: 'segments',
      actual: 4,
      limit: 3,
    },
  },
  {
    event: 'prompt-wizard-v6-safe-voiceover-cta-compression-fallback',
    planIndex: 0,
    targetLanguage: '英语',
    repairRounds: 1,
    beforeUnits: 40,
    afterUnits: 38,
    maxUnits: 38,
    lastBeforeUnits: 12,
    lastAfterUnits: 10,
  },
  {
    event: 'prompt-wizard-v6-safe-voiceover-expansion-fallback',
    planIndex: 0,
    targetLanguage: '英语',
    repairRounds: 1,
    beforeUnits: 30,
    afterUnits: 32,
    minUnits: 32,
    segmentIndex: 1,
    addedUnits: 2,
  },
  {
    event: 'prompt-wizard-v6-terminal-validation-failed',
    repairRounds: 1,
    model: 'seedance-1-5-pro',
    durationSeconds: 10,
    failures: [{
      planIndex: 0,
      code: 'PROMPT_WIZARD_EXECUTION_BUDGET_INVALID',
      fieldPaths: ['shots[0].action'],
      executionBudgetIssues: [{
        code: 'TOO_MANY_ACTIONS',
        fieldPath: 'segments[0]',
        actual: 2,
        limit: 1,
      }],
    }],
  },
];

describe('Prompt Wizard Canary 安全 NDJSON 边界', () => {
  it('统一统计非原生解析和失败解析，并保留格式恢复的安全异常分类', () => {
    const result = normalizePromptWizardCanaryOutputDiagnostics([
      {
        planIndex: 0,
        operation: 'generate-drafts',
        stage: 'initial',
        phase: 'decoded',
        classification: 'valid-json',
        normalizationMode: 'native',
        schemaIssue: 'not-applicable',
        outputLengthBucket: '2049-8192',
        containerDepthBucket: '1-4',
        outputTextSource: 'completed',
        fieldPaths: [],
      },
      {
        planIndex: 1,
        operation: 'generate-drafts',
        stage: 'initial',
        phase: 'parse',
        classification: 'container-truncated',
        normalizationMode: 'none',
        schemaIssue: 'not-applicable',
        outputLengthBucket: '2049-8192',
        containerDepthBucket: '1-4',
        outputTextSource: 'streamed-fallback',
        fieldPaths: [],
      },
      {
        planIndex: 1,
        operation: 'repair-draft-format',
        stage: 'format-recovery',
        phase: 'decoded',
        classification: 'valid-json',
        normalizationMode: 'native',
        schemaIssue: 'not-applicable',
        outputLengthBucket: '2049-8192',
        containerDepthBucket: '1-4',
        outputTextSource: 'completed',
        fieldPaths: [],
      },
    ]);
    expect(result.formatAnomalyCount).toBe(1);
    expect(result.releaseBlockingFormatAnomalyCount).toBe(1);
    expect(result.formatRecoveryCount).toBe(1);
    const abnormalRecovery = normalizePromptWizardCanaryOutputDiagnostics([{
      ...result.diagnostics[2],
      normalizationMode: 'fence-removed',
    }]);
    expect(abnormalRecovery).toMatchObject({
      formatAnomalyCount: 1,
      releaseBlockingFormatAnomalyCount: 1,
      formatRecoveryCount: 1,
    });

    const safeRootClosure = normalizePromptWizardCanaryOutputDiagnostics([{
      ...result.diagnostics[0],
      normalizationMode: 'append-closing-delimiters',
    }]);
    expect(safeRootClosure).toMatchObject({
      formatAnomalyCount: 1,
      releaseBlockingFormatAnomalyCount: 0,
      formatRecoveryCount: 0,
    });
  });

  it('V6 审计拒绝 existing-compatible 来源、额外字段和动态字段路径', () => {
    const diagnostic = {
      planIndex: 0,
      operation: 'generate-drafts',
      stage: 'initial',
      phase: 'decoded',
      classification: 'valid-json',
      normalizationMode: 'native',
      schemaIssue: 'not-applicable',
      outputLengthBucket: '1-2048',
      containerDepthBucket: '1-4',
      outputTextSource: 'completed',
      fieldPaths: [],
    };
    expect(() => normalizePromptWizardCanaryOutputDiagnostics([{
      ...diagnostic,
      outputTextSource: 'existing-compatible',
    }])).toThrow(/安全白名单/u);
    expect(() => normalizePromptWizardCanaryOutputDiagnostics([{
      ...diagnostic,
      summary: '正文摘要',
    }])).toThrow(/安全白名单/u);
    expect(() => normalizePromptWizardCanaryOutputDiagnostics([{
      ...diagnostic,
      fieldPaths: ['unknown.dynamic.key'],
    }])).toThrow(/安全白名单/u);
    expect(() => normalizePromptWizardCanaryOutputDiagnostics([{
      ...diagnostic,
      operation: 'repair-draft-format',
    }])).toThrow(/安全白名单/u);
    expect(() => normalizePromptWizardCanaryOutputDiagnostics([
      diagnostic,
      { ...diagnostic },
    ])).toThrow(/安全白名单/u);
    expect(() => normalizePromptWizardCanaryOutputDiagnostics([{
      ...diagnostic,
      phase: 'schema',
      classification: 'invalid-token',
      normalizationMode: 'none',
    }])).toThrow(/安全白名单/u);

    const safeSchemaDiagnostic = {
      ...diagnostic,
      phase: 'schema',
      schemaIssue: 'count',
      fieldPaths: ['segments[0].voiceover'],
    };
    expect(normalizePromptWizardCanaryOutputDiagnostics([
      safeSchemaDiagnostic,
    ]).diagnostics).toEqual([safeSchemaDiagnostic]);
    expect(() => normalizePromptWizardCanaryOutputDiagnostics([{
      ...safeSchemaDiagnostic,
      schemaIssue: 'count: secret-provider-body',
    }])).toThrow(/安全白名单/u);
    expect(() => normalizePromptWizardCanaryOutputDiagnostics([{
      ...safeSchemaDiagnostic,
      detail: 'secret-provider-body',
    }])).toThrow(/安全白名单/u);
    expect(() => normalizePromptWizardCanaryOutputDiagnostics([{
      ...diagnostic,
      schemaIssue: 'count',
    }])).toThrow(/安全白名单/u);
  });

  it('只保留规范化协议事件和 operation 级 Provider 用量', () => {
    const result = parsePromptWizardCanarySafeTranscript({
      protocolEvents,
      transcript: [
        line({
          event: 'prompt-wizard-provider-completed',
          operation: 'generate-drafts',
          model: 'model',
          responseId: 'response-id',
          providerRequestId: 'request-id',
          xTtLogId: 'log-id',
          status: 200,
          attempts: 1,
          latencyMs: 10,
          inputTokens: 120,
          outputTokens: 30,
          serviceTier: 'default',
          errorClassification: null,
        }),
        line({
          event: 'prompt-wizard-draft-format-repair-triggered',
          operation: 'repair-draft-format',
          planIndex: 2,
          errorCode: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
        }),
        line({
          event: 'prompt-wizard-provider-failed',
          operation: 'repair-draft-format',
          status: 200,
          attempts: 1,
          inputTokens: null,
          outputTokens: null,
          errorClassification: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
        }),
        line({
          event: 'prompt-wizard-v6-canary-completed',
          ok: true,
          completed: 15,
          deliveredPlanCount: 45,
          routeP95Ms: 1,
          draftP95Ms: 1,
          formatRepairCount: 0,
          formatAnomalyCount: 0,
          contentRepairRequestCount: 0,
          terminalCalibrationRequestCount: 0,
        }),
      ].join('\n'),
    });
    expect(result.providerUsageSummary).toEqual({
      requestEventCount: 2,
      completedCount: 1,
      failedCount: 1,
      retryEventCount: 0,
      attempts: 2,
      inputTokens: 120,
      outputTokens: 30,
      unknownInputTokenCount: 1,
      unknownOutputTokenCount: 1,
      operationCounts: {
        'generate-drafts': 1,
        'repair-draft-format': 1,
        'repair-draft-content': 0,
      },
    });
    expect(JSON.stringify(result.normalizedEvents)).not.toContain('response-id');
    expect(result.normalizedEvents.at(-1)).toEqual({
      event: 'prompt-wizard-v6-canary-completed',
      ok: true,
      completed: 15,
      deliveredPlanCount: 45,
      routeP95Ms: 1,
      draftP95Ms: 1,
      formatRepairCount: 0,
      formatAnomalyCount: 0,
      contentRepairRequestCount: 0,
      terminalCalibrationRequestCount: 0,
    });
  });

  it('接受 Attempt27/28 捕获的全部真实 Provider 与 fallback 辅助事件字段集', () => {
    const result = parsePromptWizardCanarySafeTranscript({
      protocolEvents,
      transcript: auxiliaryEventSamples.map(line).join('\n'),
    });
    expect(result.records).toHaveLength(auxiliaryEventSamples.length);
    expect(result.normalizedEvents.map(event => event.event)).toEqual(
      auxiliaryEventSamples.map(event => event.event),
    );
    expect(result.providerUsageSummary).toMatchObject({
      requestEventCount: 2,
      completedCount: 1,
      failedCount: 1,
      retryEventCount: 1,
      attempts: 2,
    });
    expect(result.normalizedEvents).toContainEqual({
      event: 'prompt-wizard-safe-segment-camera-motion-fallback',
      planIndex: 0,
      segmentIndexes: [0, 3],
      repairRounds: 2,
    });
    expect(result.normalizedEvents).toContainEqual({
      event: 'prompt-wizard-v6-safe-format-recovery-single-camera-motion-fallback',
      planIndex: 1,
      segmentIndex: 2,
      contentRepairRequestCount: 0,
    });
    expect(result.normalizedEvents).toContainEqual({
      event: 'prompt-wizard-v6-safe-motion-repair-camera-budget-fallback',
      planIndex: 1,
      segmentIndex: 2,
      repairRounds: 1,
      issue: {
        code: 'TOO_MANY_CAMERA_MOVES',
        fieldPath: 'segments',
        actual: 4,
        limit: 3,
      },
    });
    expect(result.normalizedEvents).toContainEqual({
      event: 'prompt-wizard-v6-safe-format-recovery-camera-budget-fallback',
      planIndex: 2,
      issue: {
        code: 'TOO_MANY_CAMERA_MOVES',
        fieldPath: 'segments',
        actual: 4,
        limit: 3,
      },
    });
  });

  it('运镜字段收口事件继续接受既有单镜格式', () => {
    expect(parsePromptWizardCanarySafeTranscript({
      protocolEvents,
      transcript: line({
        event: 'prompt-wizard-safe-segment-camera-motion-fallback',
        planIndex: 2,
        segmentIndexes: [1],
        repairRounds: 1,
      }),
    }).normalizedEvents).toEqual([{
      event: 'prompt-wizard-safe-segment-camera-motion-fallback',
      planIndex: 2,
      segmentIndexes: [1],
      repairRounds: 1,
    }]);
  });

  it.each([
    { caseName: '空索引', patch: { segmentIndexes: [] } },
    { caseName: '重复索引', patch: { segmentIndexes: [0, 0] } },
    { caseName: '索引越界', patch: { segmentIndexes: [0, 4] } },
    { caseName: '修复轮次为零', patch: { repairRounds: 0 } },
    { caseName: '修复轮次超过两轮', patch: { repairRounds: 3 } },
  ])('运镜字段收口事件拒绝$caseName', ({ patch }) => {
    expect(parseFailure({
      event: 'prompt-wizard-safe-segment-camera-motion-fallback',
      planIndex: 0,
      segmentIndexes: [0, 3],
      repairRounds: 2,
      ...patch,
    })).toMatchObject({
      code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
      parserStage: 'auxiliary',
      reasonCode: 'auxiliary-value',
    });
  });

  it('运镜字段收口事件拒绝额外字段', () => {
    expect(parseFailure({
      event: 'prompt-wizard-safe-segment-camera-motion-fallback',
      planIndex: 0,
      segmentIndexes: [0, 3],
      repairRounds: 2,
      detail: '不可持久化内容',
    })).toMatchObject({
      code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
      parserStage: 'auxiliary',
      reasonCode: 'auxiliary-shape',
    });
  });

  it.each([
    { caseName: '方案索引越界', patch: { planIndex: 3 } },
    { caseName: '镜头索引越界', patch: { segmentIndex: 4 } },
    { caseName: '伪造内容修复计数', patch: { contentRepairRequestCount: 1 } },
  ])('格式恢复单运镜收口事件拒绝$caseName', ({ patch }) => {
    expect(parseFailure({
      event: 'prompt-wizard-v6-safe-format-recovery-single-camera-motion-fallback',
      planIndex: 1,
      segmentIndex: 2,
      contentRepairRequestCount: 0,
      ...patch,
    })).toMatchObject({
      code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
      parserStage: 'auxiliary',
      reasonCode: 'auxiliary-value',
    });
  });

  it('格式恢复单运镜收口事件拒绝额外字段', () => {
    expect(parseFailure({
      event: 'prompt-wizard-v6-safe-format-recovery-single-camera-motion-fallback',
      planIndex: 1,
      segmentIndex: 2,
      contentRepairRequestCount: 0,
      detail: '不可持久化内容',
    })).toMatchObject({
      code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
      parserStage: 'auxiliary',
      reasonCode: 'auxiliary-shape',
    });
  });

  it.each([
    {
      event: 'prompt-wizard-v6-safe-motion-repair-camera-budget-fallback',
      planIndex: 0,
      segmentIndex: 1,
      repairRounds: 1,
    },
    {
      event: 'prompt-wizard-v6-safe-motion-repair-camera-budget-fallback',
      planIndex: 0,
      segmentIndex: 1,
      repairRounds: 1,
      issue: {
        code: 'TOO_MANY_CAMERA_MOVES',
        fieldPath: 'segments',
        actual: 4,
        limit: 3,
        detail: '不可持久化内容',
      },
    },
    {
      event: 'prompt-wizard-v6-safe-format-recovery-camera-budget-fallback',
      planIndex: 0,
    },
  ])('$event 对缺失键或嵌套额外键失败关闭', (sample) => {
    expect(parseFailure(sample)).toMatchObject({
      code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
      parserStage: 'auxiliary',
      reasonCode: 'auxiliary-shape',
    });
  });

  it.each([
    { field: 'planIndex', value: 3 },
    { field: 'segmentIndex', value: 4 },
    { field: 'repairRounds', value: 0 },
    { field: 'repairRounds', value: 3 },
    { field: 'issue.code', value: 'TOO_MANY_ACTIONS' },
    { field: 'issue.fieldPath', value: 'segments[2]' },
    { field: 'issue.actual', value: 3 },
    { field: 'issue.actual', value: true },
    { field: 'issue.limit', value: 0 },
  ])('运镜修复事件拒绝非法 $field=$value', ({ field, value }) => {
    const sample = structuredClone(auxiliaryEventSamples.find(candidate => (
      candidate.event === 'prompt-wizard-v6-safe-motion-repair-camera-budget-fallback'
    ))!);
    if (field.startsWith('issue.')) {
      (sample.issue as Record<string, unknown>)[field.slice('issue.'.length)] = value;
    } else {
      sample[field] = value;
    }
    expect(parseFailure(sample)).toMatchObject({
      code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
      parserStage: 'auxiliary',
      reasonCode: 'auxiliary-value',
    });
  });

  it.each([
    { actual: 5, limit: 3 },
    { actual: 4, limit: 2 },
  ])('格式恢复运镜事件只接受生产谓词 4/3：$actual/$limit', ({ actual, limit }) => {
    expect(parseFailure({
      event: 'prompt-wizard-v6-safe-format-recovery-camera-budget-fallback',
      planIndex: 0,
      issue: {
        code: 'TOO_MANY_CAMERA_MOVES',
        fieldPath: 'segments',
        actual,
        limit,
      },
    })).toMatchObject({
      code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
      parserStage: 'auxiliary',
      reasonCode: 'auxiliary-value',
    });
  });

  it('解析失败只携带固定阶段与原因码，不回显输入内容', () => {
    const unknown = parseFailure({ event: 'unknown-provider-event' });
    expect(unknown).toMatchObject({
      code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
      parserStage: 'event',
      reasonCode: 'unknown-event',
    });
    expect(JSON.stringify(unknown)).not.toContain('unknown-provider-event');

    const extraField = parseFailure({
      event: 'prompt-wizard-v6-safe-format-recovery-camera-budget-fallback',
      planIndex: 0,
      issue: {
        code: 'TOO_MANY_CAMERA_MOVES',
        fieldPath: 'segments',
        actual: 4,
        limit: 3,
      },
      providerExcerpt: '秘密 Provider 正文',
    });
    expect(extraField).toMatchObject({
      parserStage: 'auxiliary',
      reasonCode: 'auxiliary-shape',
    });
    expect(JSON.stringify(extraField)).not.toContain('秘密 Provider 正文');
  });

  it.each(auxiliaryEventSamples)(
    '$event 拒绝 detail/providerExcerpt 等非敏感未知顶层字段',
    (sample) => {
      for (const field of ['detail', 'providerExcerpt']) {
        expect(() => parsePromptWizardCanarySafeTranscript({
          protocolEvents,
          transcript: line({ ...sample, [field]: '秘密 Provider 正文' }),
        })).toThrow(/安全白名单/u);
      }
    },
  );

  it.each([
    { detail: '秘密 Provider 正文' },
    { providerExcerpt: '秘密 Provider 正文' },
    { diagnosticsNote: { text: '秘密 Provider 正文' } },
  ])('已知协议事件也拒绝非白名单字段', (extra) => {
    expect(() => parsePromptWizardCanarySafeTranscript({
      protocolEvents,
      transcript: line({
        event: 'prompt-wizard-v6-canary-completed',
        ok: true,
        completed: 15,
        deliveredPlanCount: 45,
        routeP95Ms: 1,
        draftP95Ms: 1,
        formatRepairCount: 0,
        formatAnomalyCount: 0,
        contentRepairRequestCount: 0,
        terminalCalibrationRequestCount: 0,
        ...extra,
      }),
    })).toThrow(/安全白名单/u);
  });

  it('协议事件对允许字段的嵌套结构也执行 exact-key 投影', () => {
    const repairDiagnostic = {
      planIndex: 0,
      origin: 'domain-validation',
      repairRound: 1,
      errorCode: 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
      fieldPaths: ['segment0.voiceoverText'],
    };
    const valid = parsePromptWizardCanarySafeTranscript({
      protocolEvents,
      transcript: line({
        event: 'prompt-wizard-v6-canary-repair-diagnostics',
        caseId: '服饰-10s-zh',
        contentRepairRequestCounts: [1, 0, 0],
        terminalCalibrationRequestCounts: [0, 0, 0],
        repairDiagnostics: [repairDiagnostic],
      }),
    });
    expect(valid.normalizedEvents).toEqual([{
      event: 'prompt-wizard-v6-canary-repair-diagnostics',
      caseId: '服饰-10s-zh',
      contentRepairRequestCounts: [1, 0, 0],
      terminalCalibrationRequestCounts: [0, 0, 0],
      repairDiagnostics: [repairDiagnostic],
    }]);

    expect(() => parsePromptWizardCanarySafeTranscript({
      protocolEvents,
      transcript: line({
        event: 'prompt-wizard-v6-canary-repair-diagnostics',
        caseId: '服饰-10s-zh',
        contentRepairRequestCounts: [1, 0, 0],
        terminalCalibrationRequestCounts: [0, 0, 0],
        repairDiagnostics: [{
          ...repairDiagnostic,
          detail: '秘密 Provider 正文',
        }],
      }),
    })).toThrow(/安全白名单/u);
  });

  it('嵌套输出诊断、物理请求快照和 model 值均不能承载 Provider 正文', () => {
    const diagnostic = {
      planIndex: 0,
      operation: 'generate-drafts',
      stage: 'initial',
      phase: 'decoded',
      classification: 'valid-json',
      normalizationMode: 'native',
      schemaIssue: 'not-applicable',
      outputLengthBucket: '1-2048',
      containerDepthBucket: '1-4',
      outputTextSource: 'completed',
      fieldPaths: [],
    };
    expect(() => parsePromptWizardCanarySafeTranscript({
      protocolEvents,
      transcript: line({
        event: 'prompt-wizard-v6-canary-output-diagnostics',
        caseId: '服饰-10s-zh',
        formatAnomalyCount: 0,
        formatRecoveryCount: 0,
        outputDiagnostics: [{ ...diagnostic, detail: '秘密 Provider 正文' }],
      }),
    })).toThrow(/安全白名单/u);

    expect(() => parsePromptWizardCanarySafeTranscript({
      protocolEvents,
      transcript: line({
        event: 'prompt-wizard-v6-attempt27-physical-request-counts',
        physicalRequestSnapshot: {
          globalCount: 1,
          caseCounts: { '服饰-10s-zh': 1 },
          operationCounts: {
            'generate-drafts': 1,
            'repair-draft-format': 0,
            'repair-draft-content': 0,
            detail: '秘密 Provider 正文',
          },
          caseOperationCounts: {
            '服饰-10s-zh': {
              'generate-drafts': 1,
              'repair-draft-format': 0,
              'repair-draft-content': 0,
            },
          },
          casePlanContentRepairCounts: { '服饰-10s-zh': [0, 0, 0] },
        },
      }),
    })).toThrow(/安全白名单/u);

    expect(() => parsePromptWizardCanarySafeTranscript({
      protocolEvents,
      transcript: line({
        event: 'prompt-wizard-v6-canary-batch',
        id: '服饰-10s-zh',
        ok: true,
        model: '秘密 Provider 正文',
      }),
    })).toThrow(/安全白名单/u);
  });

  it.each([
    { event: 'unknown-provider-event' },
    { event: 'prompt-wizard-provider-completed', operation: 'generate-drafts', prompt: '秘密' },
    { event: 'prompt-wizard-provider-completed', operation: 'generate-drafts', cause: {} },
    { event: 'prompt-wizard-provider-completed', operation: 'generate-drafts', nested: { voiceover: '秘密' } },
    { event: 'prompt-wizard-provider-completed', operation: 'generate-drafts', Provider_Body: '秘密' },
    { event: 'prompt-wizard-provider-completed', operation: 'generate-drafts', response_body: '秘密' },
    { event: 'prompt-wizard-provider-completed', operation: 'generate-drafts', repair_feedback: '秘密' },
  ])('未知事件或任意深度敏感键均失败关闭', (unsafe) => {
    expect(() => parsePromptWizardCanarySafeTranscript({
      protocolEvents,
      transcript: line(unsafe),
    })).toThrow(/安全白名单/u);
  });

  it('拒绝非 JSON、无 event 和不受控 operation', () => {
    expect(() => parsePromptWizardCanarySafeTranscript({
      protocolEvents,
      transcript: '{',
    })).toThrow(/安全白名单/u);
    expect(() => parsePromptWizardCanarySafeTranscript({
      protocolEvents,
      transcript: line({ ok: true }),
    })).toThrow(/安全白名单/u);
    expect(() => parsePromptWizardCanarySafeTranscript({
      protocolEvents,
      transcript: line({
        event: 'prompt-wizard-provider-completed',
        operation: 'analyze-product',
        attempts: 1,
        inputTokens: 1,
        outputTokens: 1,
      }),
    })).toThrow(/安全白名单/u);
  });
});
