import { describe, expect, it } from 'vitest';
import {
  buildPromptWizardAttempt28PhysicalRequestEvent,
  parsePromptWizardAttempt28CanaryNdjson,
  PROMPT_WIZARD_ATTEMPT28_CASE_IDS,
} from '../src/tools/canaryPromptWizardAttempt28.js';

const roles = ['proof-conversion', 'problem-hook', 'lifestyle-seeding'] as const;

function diagnostic(
  planIndex: 0 | 1 | 2,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    planIndex,
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
    ...overrides,
  };
}

function formatRecoveryDiagnostic(planIndex: 0 | 1 | 2) {
  return diagnostic(planIndex, {
    operation: 'repair-draft-format',
    stage: 'format-recovery',
  });
}

function contentRepairDiagnostic(planIndex: 0 | 1 | 2) {
  return diagnostic(planIndex, {
    operation: 'repair-draft-content',
    stage: 'content-repair',
  });
}

function physicalSnapshot() {
  return {
    globalCount: 45,
    caseCounts: Object.fromEntries(PROMPT_WIZARD_ATTEMPT28_CASE_IDS.map(id => [id, 3])),
    operationCounts: {
      'generate-drafts': 45,
      'repair-draft-format': 0,
      'repair-draft-content': 0,
    },
    caseOperationCounts: Object.fromEntries(PROMPT_WIZARD_ATTEMPT28_CASE_IDS.map(id => [id, {
      'generate-drafts': 3,
      'repair-draft-format': 0,
      'repair-draft-content': 0,
    }])),
    casePlanContentRepairCounts: Object.fromEntries(
      PROMPT_WIZARD_ATTEMPT28_CASE_IDS.map(id => [id, [0, 0, 0] as [number, number, number]]),
    ),
  };
}

function providerCompletion(
  operation: 'generate-drafts' | 'repair-draft-format' | 'repair-draft-content' = 'generate-drafts',
) {
  return {
    event: 'prompt-wizard-provider-completed',
    operation,
    model: 'model',
    responseId: 'response-id',
    providerRequestId: 'request-id',
    xTtLogId: 'log-id',
    status: 200,
    attempts: 1,
    latencyMs: 10,
    inputTokens: 100,
    outputTokens: 20,
    serviceTier: 'default',
    errorClassification: null,
  };
}

function completedTranscript() {
  const events: Record<string, unknown>[] = [];
  for (const caseId of PROMPT_WIZARD_ATTEMPT28_CASE_IDS) {
    for (const planIndex of [0, 1, 2] as const) {
      events.push({
        event: 'prompt-wizard-v6-canary-initial-provider-identity',
        caseId,
        planIndex,
        role: roles[planIndex],
      });
      events.push(providerCompletion());
    }
    events.push({
      event: 'prompt-wizard-v6-canary-output-diagnostics',
      caseId,
      formatAnomalyCount: 0,
      formatRecoveryCount: 0,
      outputDiagnostics: [diagnostic(0), diagnostic(1), diagnostic(2)],
    });
    events.push({
      event: 'prompt-wizard-v6-canary-repair-diagnostics',
      caseId,
      contentRepairRequestCounts: [0, 0, 0],
      terminalCalibrationRequestCounts: [0, 0, 0],
      repairDiagnostics: [],
    });
    events.push({
      event: 'prompt-wizard-v6-canary-batch',
      id: caseId,
      ok: true,
      contentRepairRequestCounts: [0, 0, 0],
      terminalCalibrationRequestCounts: [0, 0, 0],
    });
  }
  events.push({
    event: 'prompt-wizard-v6-canary-completed',
    ok: true,
    completed: 15,
    deliveredPlanCount: 45,
  });
  events.push(buildPromptWizardAttempt28PhysicalRequestEvent(physicalSnapshot()));
  return events.map(event => JSON.stringify(event)).join('\n');
}

function transcriptWithSingleFormatRecovery() {
  const events = completedTranscript().split('\n').map(line => JSON.parse(line));
  const caseId = PROMPT_WIZARD_ATTEMPT28_CASE_IDS[0]!;
  const output = events.find(event => (
    event.event === 'prompt-wizard-v6-canary-output-diagnostics' && event.caseId === caseId
  ));
  const initial = output.outputDiagnostics.find((item: Record<string, unknown>) => (
    item.planIndex === 0 && item.stage === 'initial'
  ));
  Object.assign(initial, {
    phase: 'parse',
    classification: 'non-json',
    normalizationMode: 'none',
  });
  output.outputDiagnostics.push(formatRecoveryDiagnostic(0));
  output.formatAnomalyCount = 1;
  output.formatRecoveryCount = 1;

  const outputIndex = events.findIndex(event => (
    event.event === 'prompt-wizard-v6-canary-output-diagnostics'
    && event.caseId === caseId
  ));
  events.splice(outputIndex, 0, providerCompletion('repair-draft-format'));
  const physical = events.at(-1).physicalRequestSnapshot;
  physical.globalCount += 1;
  physical.caseCounts[caseId] += 1;
  physical.operationCounts['repair-draft-format'] += 1;
  physical.caseOperationCounts[caseId]['repair-draft-format'] += 1;
  return events;
}

function transcriptWithContentRepairFormatRecovery() {
  const events = completedTranscript().split('\n').map(line => JSON.parse(line));
  const caseId = PROMPT_WIZARD_ATTEMPT28_CASE_IDS[0]!;
  const output = events.find(event => (
    event.event === 'prompt-wizard-v6-canary-output-diagnostics' && event.caseId === caseId
  ));
  output.outputDiagnostics.push(contentRepairDiagnostic(0), formatRecoveryDiagnostic(0));
  Object.assign(output.outputDiagnostics.at(-2), {
    phase: 'parse',
    classification: 'non-json',
    normalizationMode: 'none',
  });
  output.formatAnomalyCount = 1;
  output.formatRecoveryCount = 1;

  const repair = events.find(event => (
    event.event === 'prompt-wizard-v6-canary-repair-diagnostics' && event.caseId === caseId
  ));
  repair.contentRepairRequestCounts = [1, 0, 0];
  repair.repairDiagnostics = [{
    planIndex: 0,
    origin: 'domain-validation',
    repairRound: 1,
    errorCode: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
    fieldPaths: ['segments[0].action'],
  }];
  const batch = events.find(event => (
    event.event === 'prompt-wizard-v6-canary-batch' && event.id === caseId
  ));
  batch.contentRepairRequestCounts = [1, 0, 0];

  const outputIndex = events.findIndex(event => (
    event.event === 'prompt-wizard-v6-canary-output-diagnostics'
    && event.caseId === caseId
  ));
  events.splice(
    outputIndex,
    0,
    providerCompletion('repair-draft-content'),
    providerCompletion('repair-draft-format'),
  );
  const physical = events.at(-1).physicalRequestSnapshot;
  physical.globalCount += 2;
  physical.caseCounts[caseId] += 2;
  physical.operationCounts['repair-draft-content'] += 1;
  physical.operationCounts['repair-draft-format'] += 1;
  physical.caseOperationCounts[caseId]['repair-draft-content'] += 1;
  physical.caseOperationCounts[caseId]['repair-draft-format'] += 1;
  physical.casePlanContentRepairCounts[caseId][0] += 1;
  return events;
}

function transcriptWithFormatRecoveryAndSafeRootClosure() {
  const events = transcriptWithSingleFormatRecovery();
  const caseId = PROMPT_WIZARD_ATTEMPT28_CASE_IDS[1]!;
  const output = events.find(event => (
    event.event === 'prompt-wizard-v6-canary-output-diagnostics' && event.caseId === caseId
  ));
  Object.assign(output.outputDiagnostics.find((item: Record<string, unknown>) => (
    item.planIndex === 1 && item.stage === 'initial'
  )), {
    phase: 'decoded',
    classification: 'valid-json',
    normalizationMode: 'append-closing-delimiters',
  });
  output.formatAnomalyCount = 1;
  return events;
}

function transcriptWithTwoContentRepairs() {
  const events = completedTranscript().split('\n').map(line => JSON.parse(line));
  const caseId = PROMPT_WIZARD_ATTEMPT28_CASE_IDS[0]!;
  const output = events.find(event => (
    event.event === 'prompt-wizard-v6-canary-output-diagnostics' && event.caseId === caseId
  ));
  output.outputDiagnostics.push(contentRepairDiagnostic(0), contentRepairDiagnostic(0));

  const repair = events.find(event => (
    event.event === 'prompt-wizard-v6-canary-repair-diagnostics' && event.caseId === caseId
  ));
  repair.contentRepairRequestCounts = [2, 0, 0];
  repair.repairDiagnostics = [
    {
      planIndex: 0,
      origin: 'domain-validation',
      repairRound: 1,
      errorCode: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
      fieldPaths: ['segments[2].cameraMovement'],
    },
    {
      planIndex: 0,
      origin: 'domain-validation',
      repairRound: 2,
      errorCode: 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
      fieldPaths: ['segments[0].voiceover', 'segments[0].voiceoverZh'],
    },
  ];
  const batch = events.find(event => (
    event.event === 'prompt-wizard-v6-canary-batch' && event.id === caseId
  ));
  batch.contentRepairRequestCounts = [2, 0, 0];

  const outputIndex = events.findIndex(event => (
    event.event === 'prompt-wizard-v6-canary-output-diagnostics'
    && event.caseId === caseId
  ));
  events.splice(
    outputIndex,
    0,
    providerCompletion('repair-draft-content'),
    providerCompletion('repair-draft-content'),
  );
  const physical = events.at(-1).physicalRequestSnapshot;
  physical.globalCount += 2;
  physical.caseCounts[caseId] += 2;
  physical.operationCounts['repair-draft-content'] += 2;
  physical.caseOperationCounts[caseId]['repair-draft-content'] += 2;
  physical.casePlanContentRepairCounts[caseId][0] += 2;
  return events;
}

describe('Attempt28 完整发布 Canary 解析器', () => {
  it('风险顺序固定先跑日语、英语、普通话新版路径，再运行其余12批', () => {
    expect(PROMPT_WIZARD_ATTEMPT28_CASE_IDS.slice(0, 3)).toEqual([
      '美妆-10s-ja',
      '服饰-15s-en',
      '服饰-10s-zh',
    ]);
    expect(PROMPT_WIZARD_ATTEMPT28_CASE_IDS).toHaveLength(15);
    expect(PROMPT_WIZARD_ATTEMPT28_CASE_IDS).toContain('家居-15s-zh');
    expect(new Set(PROMPT_WIZARD_ATTEMPT28_CASE_IDS)).toHaveProperty('size', 15);
  });

  it('完整15批45案、原生输出诊断和operation用量对账后才允许发布', () => {
    expect(parsePromptWizardAttempt28CanaryNdjson({
      transcript: completedTranscript(),
      processExitCode: 0,
    })).toMatchObject({
      state: 'completed',
      ok: true,
      completedBatchCount: 15,
      formatAnomalyCount: 0,
      releaseBlockingFormatAnomalyCount: 0,
      formatRecoveryCount: 0,
      releaseAllowed: true,
      physicalRequestSnapshot: {
        globalCount: 45,
        operationCounts: {
          'generate-drafts': 45,
          'repair-draft-format': 0,
          'repair-draft-content': 0,
        },
      },
    });
  });

  it('完成态接受两类严格运镜 fallback 安全事件且不改变物理请求对账', () => {
    const events = completedTranscript().split('\n').map(line => JSON.parse(line));
    const outputIndex = events.findIndex(event => (
      event.event === 'prompt-wizard-v6-canary-output-diagnostics'
    ));
    events.splice(outputIndex, 0, {
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
    }, {
      event: 'prompt-wizard-v6-safe-format-recovery-camera-budget-fallback',
      planIndex: 2,
      issue: {
        code: 'TOO_MANY_CAMERA_MOVES',
        fieldPath: 'segments',
        actual: 4,
        limit: 3,
      },
    });

    const result = parsePromptWizardAttempt28CanaryNdjson({
      transcript: events.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    });
    expect(result).toMatchObject({
      releaseAllowed: true,
      physicalRequestSnapshot: { globalCount: 45 },
      providerUsageSummary: { requestEventCount: 45 },
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

  it('异常 initial 与同方案原生 format-recovery 成对出现时允许发布', () => {
    const events = transcriptWithSingleFormatRecovery();
    expect(parsePromptWizardAttempt28CanaryNdjson({
      transcript: events.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toMatchObject({
      releaseAllowed: true,
      formatAnomalyCount: 1,
      releaseBlockingFormatAnomalyCount: 1,
      formatRecoveryCount: 1,
      physicalRequestSnapshot: {
        globalCount: 46,
        operationCounts: { 'repair-draft-format': 1 },
      },
    });
  });

  it('一次真实格式恢复后允许额外的 Flat Scalar 根对象安全补闭合符', () => {
    const events = transcriptWithFormatRecoveryAndSafeRootClosure();
    expect(parsePromptWizardAttempt28CanaryNdjson({
      transcript: events.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toMatchObject({
      releaseAllowed: true,
      formatAnomalyCount: 2,
      releaseBlockingFormatAnomalyCount: 1,
      formatRecoveryCount: 1,
      physicalRequestSnapshot: {
        globalCount: 46,
        operationCounts: { 'repair-draft-format': 1 },
      },
    });
  });

  it('内容修复 JSON 异常与同方案原生 format-recovery 成对出现时允许发布', () => {
    const events = transcriptWithContentRepairFormatRecovery();
    expect(parsePromptWizardAttempt28CanaryNdjson({
      transcript: events.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toMatchObject({
      releaseAllowed: true,
      formatAnomalyCount: 1,
      formatRecoveryCount: 1,
      physicalRequestSnapshot: {
        globalCount: 47,
        operationCounts: {
          'repair-draft-content': 1,
          'repair-draft-format': 1,
        },
      },
    });
  });

  it('同一方案两次内容修复与物理调用逐项对账后允许发布', () => {
    const events = transcriptWithTwoContentRepairs();
    expect(parsePromptWizardAttempt28CanaryNdjson({
      transcript: events.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toMatchObject({
      releaseAllowed: true,
      physicalRequestSnapshot: {
        globalCount: 47,
        operationCounts: { 'repair-draft-content': 2 },
        casePlanContentRepairCounts: {
          [PROMPT_WIZARD_ATTEMPT28_CASE_IDS[0]!]: [2, 0, 0],
        },
      },
    });
  });

  it('完成态中的非原生 format-recovery 必须失败关闭，不得仅降级 releaseAllowed', () => {
    const events = transcriptWithSingleFormatRecovery();
    const output = events.find(event => (
      event.event === 'prompt-wizard-v6-canary-output-diagnostics'
    ));
    Object.assign(output.outputDiagnostics.find((item: Record<string, unknown>) => (
      item.stage === 'format-recovery'
    )), {
      phase: 'decoded',
      classification: 'valid-json',
      normalizationMode: 'fence-removed',
    });
    output.formatAnomalyCount = 2;

    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: events.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toThrow(/证据无效/u);
  });

  it('format-recovery 虽为原生 JSON 但仍处于 Schema count 失败时不得发布', () => {
    const events = transcriptWithSingleFormatRecovery();
    const output = events.find(event => (
      event.event === 'prompt-wizard-v6-canary-output-diagnostics'
    ));
    Object.assign(output.outputDiagnostics.find((item: Record<string, unknown>) => (
      item.stage === 'format-recovery'
    )), {
      phase: 'schema',
      schemaIssue: 'count',
      fieldPaths: ['segments[0].voiceover'],
    });

    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: events.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toThrow(/证据无效/u);
  });

  it('缺少任一 plan initial 或混入 refinement/content-repair 额外诊断均失败关闭', () => {
    const missingInitial = completedTranscript().split('\n').map(line => JSON.parse(line));
    const firstOutput = missingInitial.find(event => (
      event.event === 'prompt-wizard-v6-canary-output-diagnostics'
    ));
    firstOutput.outputDiagnostics.pop();
    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: missingInitial.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toThrow(/证据无效/u);

    for (const extra of [
      diagnostic(0, { operation: 'refine-plan', stage: 'refinement' }),
      contentRepairDiagnostic(0),
    ]) {
      const events = completedTranscript().split('\n').map(line => JSON.parse(line));
      events.find(event => (
        event.event === 'prompt-wizard-v6-canary-output-diagnostics'
      )).outputDiagnostics.push(extra);
      expect(() => parsePromptWizardAttempt28CanaryNdjson({
        transcript: events.map(event => JSON.stringify(event)).join('\n'),
        processExitCode: 0,
      })).toThrow(/证据无效/u);
    }
  });

  it('孤立 recovery、native initial 的伪 recovery 和缺失 recovery 均失败关闭', () => {
    const nativeInitialRecovery = transcriptWithSingleFormatRecovery();
    const output = nativeInitialRecovery.find(event => (
      event.event === 'prompt-wizard-v6-canary-output-diagnostics'
    ));
    Object.assign(output.outputDiagnostics.find((item: Record<string, unknown>) => (
      item.stage === 'initial' && item.planIndex === 0
    )), {
      phase: 'decoded',
      classification: 'valid-json',
      normalizationMode: 'native',
    });
    output.formatAnomalyCount = 0;
    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: nativeInitialRecovery.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toThrow(/证据无效/u);

    const missingRecovery = completedTranscript().split('\n').map(line => JSON.parse(line));
    const missingOutput = missingRecovery.find(event => (
      event.event === 'prompt-wizard-v6-canary-output-diagnostics'
    ));
    Object.assign(missingOutput.outputDiagnostics[0], {
      phase: 'parse',
      classification: 'non-json',
      normalizationMode: 'none',
    });
    missingOutput.formatAnomalyCount = 1;
    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: missingRecovery.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toThrow(/证据无效/u);

    const wrongPlanRecovery = transcriptWithSingleFormatRecovery();
    const wrongPlanOutput = wrongPlanRecovery.find(event => (
      event.event === 'prompt-wizard-v6-canary-output-diagnostics'
    ));
    wrongPlanOutput.outputDiagnostics.find((item: Record<string, unknown>) => (
      item.stage === 'format-recovery'
    )).planIndex = 1;
    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: wrongPlanRecovery.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toThrow(/证据无效/u);
  });

  it('第二个发布阻断格式异常、Provider用量不一致和敏感键均失败关闭', () => {
    const twoAnomalies = completedTranscript()
      .replace('"normalizationMode":"native"', '"normalizationMode":"fence-removed"')
      .replace('"normalizationMode":"native"', '"normalizationMode":"fence-removed"')
      .replace('"formatAnomalyCount":0', '"formatAnomalyCount":2');
    expect(parsePromptWizardAttempt28CanaryNdjson({
      transcript: twoAnomalies,
      processExitCode: 0,
    })).toMatchObject({
      formatAnomalyCount: 2,
      releaseBlockingFormatAnomalyCount: 2,
      releaseAllowed: false,
    });

    const usageMismatch = completedTranscript().replace('"attempts":1', '"attempts":2');
    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: usageMismatch,
      processExitCode: 0,
    })).toThrow(/安全白名单/u);

    const leaked = completedTranscript().replace(
      '"formatAnomalyCount":0',
      '"formatAnomalyCount":0,"outputText":"秘密正文"',
    );
    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: leaked,
      processExitCode: 0,
    })).toThrow(/安全白名单/u);

    const normalizedKeyLeak = completedTranscript().replace(
      '"formatAnomalyCount":0',
      '"formatAnomalyCount":0,"provider／response text":"秘密正文"',
    );
    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: normalizedKeyLeak,
      processExitCode: 0,
    })).toThrow(/安全白名单/u);

    const innocuousKeyLeak = completedTranscript().replace(
      '"role":"proof-conversion"',
      '"role":"proof-conversion","detail":"秘密 Provider 正文"',
    );
    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: innocuousKeyLeak,
      processExitCode: 0,
    })).toThrow(/安全白名单/u);
  });

  it('completed 必须拒绝 Provider 失败事件和未知 token 用量', () => {
    const providerFailed = completedTranscript().replace(
      '"event":"prompt-wizard-provider-completed"',
      '"event":"prompt-wizard-provider-failed"',
    );
    expect(parsePromptWizardAttempt28CanaryNdjson({
      transcript: providerFailed,
      processExitCode: 0,
    }).releaseAllowed).toBe(false);

    for (const [field, value] of [
      ['inputTokens', 100],
      ['outputTokens', 20],
    ] as const) {
      const unknownToken = completedTranscript().replace(
        `"${field}":${value}`,
        `"${field}":null`,
      );
      expect(parsePromptWizardAttempt28CanaryNdjson({
        transcript: unknownToken,
        processExitCode: 0,
      }).releaseAllowed).toBe(false);
    }
  });

  it('completed 的每条输出诊断都必须来自 completed 快照', () => {
    const streamedFallback = completedTranscript().replace(
      '"outputTextSource":"completed"',
      '"outputTextSource":"streamed-fallback"',
    );
    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: streamedFallback,
      processExitCode: 0,
    })).toThrow(/证据无效/u);
  });

  it('completed 的逻辑内容修复必须逐 case/plan 与物理调用精确对账', () => {
    const events = transcriptWithContentRepairFormatRecovery();
    const caseId = PROMPT_WIZARD_ATTEMPT28_CASE_IDS[0]!;
    const repair = events.find(event => (
      event.event === 'prompt-wizard-v6-canary-repair-diagnostics'
      && event.caseId === caseId
    ));
    const batch = events.find(event => (
      event.event === 'prompt-wizard-v6-canary-batch' && event.id === caseId
    ));
    repair.contentRepairRequestCounts = [0, 0, 0];
    repair.repairDiagnostics = [];
    batch.contentRepairRequestCounts = [0, 0, 0];

    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: events.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toThrow(/证据无效/u);
  });

  it('completed 必须拒绝任一逻辑终局校准调用及诊断', () => {
    const events = completedTranscript().split('\n').map(line => JSON.parse(line));
    const caseId = PROMPT_WIZARD_ATTEMPT28_CASE_IDS[0]!;
    const repair = events.find(event => (
      event.event === 'prompt-wizard-v6-canary-repair-diagnostics'
      && event.caseId === caseId
    ));
    const batch = events.find(event => (
      event.event === 'prompt-wizard-v6-canary-batch' && event.id === caseId
    ));
    repair.terminalCalibrationRequestCounts = [1, 0, 0];
    repair.repairDiagnostics = [{
      planIndex: 0,
      origin: 'terminal-calibration',
      repairRound: 1,
      errorCode: 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
      fieldPaths: ['segments[0].voiceover'],
    }];
    batch.terminalCalibrationRequestCounts = [1, 0, 0];

    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: events.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toThrow(/证据无效/u);
  });

  it('completed 的 case 块必须严格遵循冻结的15批风险顺序', () => {
    const events = completedTranscript().split('\n').map(line => JSON.parse(line));
    const [firstCaseId, secondCaseId] = PROMPT_WIZARD_ATTEMPT28_CASE_IDS;
    for (const event of events) {
      for (const field of ['caseId', 'id'] as const) {
        if (event[field] === firstCaseId) event[field] = '__first_case__';
        else if (event[field] === secondCaseId) event[field] = firstCaseId;
      }
    }
    for (const event of events) {
      for (const field of ['caseId', 'id'] as const) {
        if (event[field] === '__first_case__') event[field] = secondCaseId;
      }
    }

    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: events.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toThrow(/证据无效/u);
  });

  it('同一 case 的并发 Provider 终态可乱序，但不得跨越 case 边界', () => {
    const sameCaseReordered = completedTranscript().split('\n').map(line => JSON.parse(line));
    const firstOutputIndex = sameCaseReordered.findIndex(event => (
      event.event === 'prompt-wizard-v6-canary-output-diagnostics'
      && event.caseId === PROMPT_WIZARD_ATTEMPT28_CASE_IDS[0]
    ));
    const firstProviderIndex = sameCaseReordered.findIndex(event => (
      event.event === 'prompt-wizard-provider-completed'
    ));
    const [reorderedProvider] = sameCaseReordered.splice(firstProviderIndex, 1);
    sameCaseReordered.splice(firstOutputIndex - 1, 0, reorderedProvider);
    expect(parsePromptWizardAttempt28CanaryNdjson({
      transcript: sameCaseReordered.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    }).releaseAllowed).toBe(true);

    const crossCaseReordered = completedTranscript().split('\n').map(line => JSON.parse(line));
    const providerIndex = crossCaseReordered.findIndex(event => (
      event.event === 'prompt-wizard-provider-completed'
    ));
    const [crossedProvider] = crossCaseReordered.splice(providerIndex, 1);
    const secondOutputIndex = crossCaseReordered.findIndex(event => (
      event.event === 'prompt-wizard-v6-canary-output-diagnostics'
      && event.caseId === PROMPT_WIZARD_ATTEMPT28_CASE_IDS[1]
    ));
    crossCaseReordered.splice(secondOutputIndex, 0, crossedProvider);
    expect(() => parsePromptWizardAttempt28CanaryNdjson({
      transcript: crossCaseReordered.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toThrow(/证据无效/u);
  });

  it('Attempt28 契约失败只返回固定解析阶段，不回显原始证据', () => {
    const readFailure = (transcript: string) => {
      try {
        parsePromptWizardAttempt28CanaryNdjson({ transcript, processExitCode: 0 });
      } catch (error) {
        return error;
      }
      throw new Error('测试数据应被 Attempt28 证据契约拒绝');
    };

    const duplicatePhysical = completedTranscript().split('\n');
    duplicatePhysical.push(duplicatePhysical.at(-1)!);
    expect(readFailure(duplicatePhysical.join('\n'))).toMatchObject({
      code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
      parserStage: 'attempt28-contract',
      reasonCode: 'physical-envelope',
      message: 'Attempt28 Canary 证据无效',
    });

    const invalidTerminal = completedTranscript().replace(
      '"completed":15',
      '"completed":14',
    );
    expect(readFailure(invalidTerminal)).toMatchObject({
      parserStage: 'attempt28-contract',
      reasonCode: 'base-transcript',
    });

    const invalidOutput = completedTranscript().replace(
      '"outputTextSource":"completed"',
      '"outputTextSource":"streamed-fallback"',
    );
    expect(readFailure(invalidOutput)).toMatchObject({
      parserStage: 'attempt28-contract',
      reasonCode: 'case-output-diagnostics',
    });

    const invalidSequence = completedTranscript().split('\n').map(line => JSON.parse(line));
    const firstCaseId = PROMPT_WIZARD_ATTEMPT28_CASE_IDS[0]!;
    const secondCaseId = PROMPT_WIZARD_ATTEMPT28_CASE_IDS[1]!;
    const firstIdentity = invalidSequence.find(event => (
      event.event === 'prompt-wizard-v6-canary-initial-provider-identity'
      && event.caseId === firstCaseId
    ));
    firstIdentity.caseId = secondCaseId;
    expect(readFailure(invalidSequence.map(event => JSON.stringify(event)).join('\n')))
      .toMatchObject({
        parserStage: 'attempt28-contract',
        reasonCode: 'base-transcript',
      });
  });

  it('completed 的耗时证据必须先由生产者取整，浮点值不得进入永久证据', () => {
    const events = completedTranscript().split('\n').map(line => JSON.parse(line));
    const completed = events.find(event => (
      event.event === 'prompt-wizard-v6-canary-completed'
    ));
    completed.routeP95Ms = 123.5;
    completed.draftP95Ms = 456.25;

    try {
      parsePromptWizardAttempt28CanaryNdjson({
        transcript: events.map(event => JSON.stringify(event)).join('\n'),
        processExitCode: 0,
      });
      throw new Error('浮点耗时证据应被安全边界拒绝');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
        parserStage: 'normalization',
        reasonCode: 'validation-failed',
      });
    }
  });
});
