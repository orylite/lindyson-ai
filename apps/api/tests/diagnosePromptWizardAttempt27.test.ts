import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArkPromptWizardResponsesError } from '../src/providers/arkPromptWizardResponsesClient.js';
import { ArkPromptWizardProvider } from '../src/providers/promptWizardProvider.js';
import { env } from '../src/config/env.js';
import {
  buildPromptWizardAttempt27PhysicalRequestEvent,
  parsePromptWizardAttempt27DiagnosticNdjson,
  PROMPT_WIZARD_ATTEMPT27_CASE_IDS,
  runPromptWizardAttempt27Diagnostic,
  runPromptWizardAttempt27DiagnosticProcess,
} from '../src/tools/diagnosePromptWizardAttempt27.js';
import {
  createPromptWizardAttempt27PhysicalRequestGuard,
  type PromptWizardCanaryResponsesClient,
} from '../src/tools/promptWizardCanaryV2Infrastructure.js';

const outputDiagnostic = (
  planIndex: 0 | 1 | 2,
  operation: 'generate-drafts' | 'repair-draft-format',
) => ({
  planIndex,
  operation,
  stage: operation === 'generate-drafts' ? 'initial' as const : 'format-recovery' as const,
  phase: 'decoded' as const,
  classification: 'valid-json' as const,
  normalizationMode: 'native' as const,
  schemaIssue: 'not-applicable' as const,
  outputLengthBucket: '2049-8192' as const,
  containerDepthBucket: '1-4' as const,
  outputTextSource: 'completed' as const,
  fieldPaths: [],
});

function physicalSnapshot() {
  return {
    globalCount: 12,
    caseCounts: Object.fromEntries(PROMPT_WIZARD_ATTEMPT27_CASE_IDS.map(id => [id, 4])),
    operationCounts: {
      'generate-drafts': 9,
      'repair-draft-format': 3,
      'repair-draft-content': 0,
    },
    caseOperationCounts: Object.fromEntries(PROMPT_WIZARD_ATTEMPT27_CASE_IDS.map(id => [id, {
      'generate-drafts': 3,
      'repair-draft-format': 1,
      'repair-draft-content': 0,
    }])),
    casePlanContentRepairCounts: Object.fromEntries(
      PROMPT_WIZARD_ATTEMPT27_CASE_IDS.map(id => [id, [0, 0, 0] as [number, number, number]]),
    ),
  };
}

function naturalRecoveryDiagnostic(planIndex: 0 | 1 | 2) {
  return {
    ...outputDiagnostic(planIndex, 'generate-drafts'),
    phase: 'parse' as const,
    classification: 'invalid-token' as const,
    normalizationMode: 'none' as const,
  };
}

function completedTranscript() {
  const events: Record<string, unknown>[] = [];
  for (const caseId of PROMPT_WIZARD_ATTEMPT27_CASE_IDS) {
    for (const planIndex of [0, 1, 2] as const) {
      events.push({
        event: 'prompt-wizard-v6-attempt27-initial-provider-identity',
        caseId,
        planIndex,
        role: ['proof-conversion', 'problem-hook', 'lifestyle-seeding'][planIndex],
      });
      events.push(providerCompletion('generate-drafts'));
    }
    events.push(providerCompletion('repair-draft-format'));
    events.push({
      event: 'prompt-wizard-v6-attempt27-output-diagnostics',
      caseId,
      formatAnomalyCount: 0,
      formatRecoveryCount: 1,
      outputDiagnostics: [
        outputDiagnostic(0, 'generate-drafts'),
        outputDiagnostic(1, 'generate-drafts'),
        outputDiagnostic(2, 'generate-drafts'),
        outputDiagnostic(0, 'repair-draft-format'),
      ],
    });
    events.push({
      event: 'prompt-wizard-v6-attempt27-batch',
      id: caseId,
      ok: true,
      initialDraftCount: 3,
      naturalFormatRecoveryCount: 0,
      forcedFormatRecoveryCount: 1,
    });
  }
  events.push({
    event: 'prompt-wizard-v6-attempt27-completed',
    ok: true,
    completed: 3,
    deliveredNaturalDraftCount: 9,
    naturalFormatRecoveryCount: 0,
    forcedFormatRecoveryCount: 3,
    diagnosticComplete: true,
    releaseAllowed: false,
  });
  events.push(buildPromptWizardAttempt27PhysicalRequestEvent(physicalSnapshot()));
  return events.map(event => JSON.stringify(event)).join('\n');
}

function completedTranscriptWithNaturalRecovery() {
  const events = completedTranscript().split('\n').map(line => JSON.parse(line));
  const caseId = PROMPT_WIZARD_ATTEMPT27_CASE_IDS[1];
  const outputEvent = events.find(event => (
    event.event === 'prompt-wizard-v6-attempt27-output-diagnostics'
    && event.caseId === caseId
  ));
  outputEvent.formatAnomalyCount = 1;
  outputEvent.formatRecoveryCount = 2;
  outputEvent.outputDiagnostics = [
    outputDiagnostic(0, 'generate-drafts'),
    outputDiagnostic(1, 'generate-drafts'),
    naturalRecoveryDiagnostic(2),
    outputDiagnostic(2, 'repair-draft-format'),
    outputDiagnostic(0, 'repair-draft-format'),
  ];
  const batch = events.find(event => (
    event.event === 'prompt-wizard-v6-attempt27-batch' && event.id === caseId
  ));
  batch.naturalFormatRecoveryCount = 1;
  const completed = events.find(event => event.event === 'prompt-wizard-v6-attempt27-completed');
  completed.naturalFormatRecoveryCount = 1;
  events.splice(events.findIndex(event => (
    event.event === 'prompt-wizard-v6-attempt27-output-diagnostics'
    && event.caseId === caseId
  )) - 1, 0, providerCompletion('repair-draft-format'));
  const physical = events.at(-1).physicalRequestSnapshot;
  physical.globalCount = 13;
  physical.caseCounts[caseId] = 5;
  physical.operationCounts['repair-draft-format'] = 4;
  physical.caseOperationCounts[caseId]['repair-draft-format'] = 2;
  return events.map(event => JSON.stringify(event)).join('\n');
}

function providerCompletion(operation: 'generate-drafts' | 'repair-draft-format') {
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

function naturalResult(planIndex: 0 | 1 | 2) {
  return {
    drafts: [{ planIndex }],
    usage: {
      interactionId: null,
      model: 'm',
      inputTokens: 1,
      outputTokens: 1,
      serviceTier: 'default',
      requestAttempts: 1,
    },
    formatRepairCount: 0,
    repairRounds: 0,
    repairDiagnostics: [],
    outputDiagnostics: [outputDiagnostic(planIndex, 'generate-drafts')],
  };
}

function naturallyRecoveredResult(planIndex: 0 | 1 | 2) {
  return {
    ...naturalResult(planIndex),
    formatRepairCount: 1,
    outputDiagnostics: [
      naturalRecoveryDiagnostic(planIndex),
      outputDiagnostic(planIndex, 'repair-draft-format'),
    ],
  };
}

function partialPhysicalSnapshot(generateDraftCount: number) {
  const firstCaseId = PROMPT_WIZARD_ATTEMPT27_CASE_IDS[0];
  return {
    globalCount: generateDraftCount,
    caseCounts: Object.fromEntries(PROMPT_WIZARD_ATTEMPT27_CASE_IDS.map(
      caseId => [caseId, caseId === firstCaseId ? generateDraftCount : 0],
    )),
    operationCounts: {
      'generate-drafts': generateDraftCount,
      'repair-draft-format': 0,
      'repair-draft-content': 0,
    },
    caseOperationCounts: Object.fromEntries(PROMPT_WIZARD_ATTEMPT27_CASE_IDS.map(
      caseId => [caseId, {
        'generate-drafts': caseId === firstCaseId ? generateDraftCount : 0,
        'repair-draft-format': 0,
        'repair-draft-content': 0,
      }],
    )),
    casePlanContentRepairCounts: Object.fromEntries(PROMPT_WIZARD_ATTEMPT27_CASE_IDS.map(
      caseId => [caseId, [0, 0, 0] as [number, number, number]],
    )),
  };
}

function firstCaseProbePhysicalSnapshot() {
  const firstCaseId = PROMPT_WIZARD_ATTEMPT27_CASE_IDS[0];
  return {
    globalCount: 4,
    caseCounts: Object.fromEntries(PROMPT_WIZARD_ATTEMPT27_CASE_IDS.map(
      caseId => [caseId, caseId === firstCaseId ? 4 : 0],
    )),
    operationCounts: {
      'generate-drafts': 3,
      'repair-draft-format': 1,
      'repair-draft-content': 0,
    },
    caseOperationCounts: Object.fromEntries(PROMPT_WIZARD_ATTEMPT27_CASE_IDS.map(
      caseId => [caseId, {
        'generate-drafts': caseId === firstCaseId ? 3 : 0,
        'repair-draft-format': caseId === firstCaseId ? 1 : 0,
        'repair-draft-content': 0,
      }],
    )),
    casePlanContentRepairCounts: Object.fromEntries(PROMPT_WIZARD_ATTEMPT27_CASE_IDS.map(
      caseId => [caseId, [0, 0, 0] as [number, number, number]],
    )),
  };
}

function capturedEvents(
  stdout: { mock: { calls: unknown[][] } },
): Record<string, unknown>[] {
  return stdout.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .join('')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((value: string) => JSON.parse(value) as Record<string, unknown>);
}

async function captureAttempt27ArkTranscript(
  create: PromptWizardCanaryResponsesClient['create'],
) {
  const originalNodeEnv = env.NODE_ENV;
  const transcriptLines: string[] = [];
  const appendLine = (value: unknown) => {
    transcriptLines.push(String(value).replace(/\r?\n$/u, ''));
  };
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((value) => {
    appendLine(value);
    return true;
  });
  const log = vi.spyOn(console, 'log').mockImplementation(appendLine);
  const warn = vi.spyOn(console, 'warn').mockImplementation(appendLine);
  const error = vi.spyOn(console, 'error').mockImplementation(appendLine);
  const physicalRequestGuard = createPromptWizardAttempt27PhysicalRequestGuard(
    { create },
    PROMPT_WIZARD_ATTEMPT27_CASE_IDS,
  );

  env.NODE_ENV = 'production';
  try {
    const succeeded = await runPromptWizardAttempt27DiagnosticProcess((() => ({
      provider: new ArkPromptWizardProvider(physicalRequestGuard),
      physicalRequestGuard,
    })) as never);
    return {
      succeeded,
      transcript: transcriptLines.filter(Boolean).join('\n'),
      physicalRequestSnapshot: physicalRequestGuard.snapshot(),
    };
  } finally {
    env.NODE_ENV = originalNodeEnv;
    stdout.mockRestore();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  }
}

describe('Attempt27 不可发布诊断', () => {
  afterEach(() => vi.restoreAllMocks());

  it('固定先生成每批三条原生首稿，再调用一次不接收正文的恢复探针', async () => {
    const calls: string[] = [];
    let activeNaturalRequests = 0;
    let maximumActiveNaturalRequests = 0;
    const generateUseDirectionDrafts = vi.fn(async (input: { planContexts: Array<{ planIndex: 0 | 1 | 2 }> }) => {
      const planIndex = input.planContexts[0]!.planIndex;
      calls.push(`initial-${planIndex}`);
      activeNaturalRequests += 1;
      maximumActiveNaturalRequests = Math.max(
        maximumActiveNaturalRequests,
        activeNaturalRequests,
      );
      await new Promise(resolve => setTimeout(resolve, 1));
      activeNaturalRequests -= 1;
      return naturalResult(planIndex);
    });
    const probeUseDirectionDraftFormatRecovery = vi.fn(async (_input, planIndex: 0 | 1 | 2) => {
      calls.push(`probe-${planIndex}`);
      return {
        draft: { planIndex },
        usage: { interactionId: null, model: 'm', inputTokens: 1, outputTokens: 1, serviceTier: 'default', requestAttempts: 1 },
        outputDiagnostics: [outputDiagnostic(planIndex, 'repair-draft-format')],
      };
    });
    const enterCase = vi.fn();
    const beginAttempt27FormatRecoveryProbe = vi.fn();
    const leaveCase = vi.fn();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await runPromptWizardAttempt27Diagnostic({
      provider: {
        generateUseDirectionDrafts,
        probeUseDirectionDraftFormatRecovery,
      } as unknown as ArkPromptWizardProvider,
      physicalRequestGuard: {
        enterCase,
        beginAttempt27FormatRecoveryProbe,
        leaveCase,
      } as never,
    });

    expect(generateUseDirectionDrafts).toHaveBeenCalledTimes(9);
    expect(probeUseDirectionDraftFormatRecovery).toHaveBeenCalledTimes(3);
    expect(probeUseDirectionDraftFormatRecovery.mock.calls.every(call => call.length === 2)).toBe(true);
    expect(calls).toEqual([
      'initial-0', 'initial-1', 'initial-2', 'probe-0',
      'initial-0', 'initial-1', 'initial-2', 'probe-0',
      'initial-0', 'initial-1', 'initial-2', 'probe-0',
    ]);
    expect(maximumActiveNaturalRequests).toBe(1);
    expect(beginAttempt27FormatRecoveryProbe).toHaveBeenNthCalledWith(1, 0);
    expect(beginAttempt27FormatRecoveryProbe).toHaveBeenNthCalledWith(2, 0);
    expect(beginAttempt27FormatRecoveryProbe).toHaveBeenNthCalledWith(3, 0);
    expect(stdout.mock.calls.map(call => String(call[0])).join('')).toContain('"diagnosticComplete":true');
    expect(stdout.mock.calls.map(call => String(call[0])).join('')).toContain('"releaseAllowed":false');
  });

  it('一次自然格式恢复不会占用三类固定探针，且探针避开同一诊断身份', async () => {
    let generateCallCount = 0;
    const probePlanIndexes: number[] = [];
    const generateUseDirectionDrafts = vi.fn(async (
      input: { planContexts: Array<{ planIndex: 0 | 1 | 2 }> },
    ) => {
      const planIndex = input.planContexts[0]!.planIndex;
      const shouldRecover = generateCallCount === 2;
      generateCallCount += 1;
      return shouldRecover ? naturallyRecoveredResult(planIndex) : naturalResult(planIndex);
    });
    const probeUseDirectionDraftFormatRecovery = vi.fn(async (_input, planIndex: 0 | 1 | 2) => {
      probePlanIndexes.push(planIndex);
      return {
        draft: { planIndex },
        usage: {
          interactionId: null,
          model: 'm',
          inputTokens: 1,
          outputTokens: 1,
          serviceTier: 'default' as const,
          requestAttempts: 1,
        },
        outputDiagnostics: [outputDiagnostic(planIndex, 'repair-draft-format')],
      };
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await runPromptWizardAttempt27Diagnostic({
      provider: {
        generateUseDirectionDrafts,
        probeUseDirectionDraftFormatRecovery,
      } as unknown as ArkPromptWizardProvider,
      physicalRequestGuard: {
        enterCase: vi.fn(),
        beginAttempt27FormatRecoveryProbe: vi.fn(),
        leaveCase: vi.fn(),
      } as never,
    });

    const events = capturedEvents(stdout);
    expect(generateUseDirectionDrafts).toHaveBeenCalledTimes(9);
    expect(probeUseDirectionDraftFormatRecovery).toHaveBeenCalledTimes(3);
    expect(probePlanIndexes).toEqual([0, 0, 0]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'prompt-wizard-v6-attempt27-output-diagnostics',
        caseId: '服饰-10s-zh',
        formatAnomalyCount: 1,
        formatRecoveryCount: 2,
      }),
      expect.objectContaining({
        event: 'prompt-wizard-v6-attempt27-completed',
        naturalFormatRecoveryCount: 1,
        forcedFormatRecoveryCount: 3,
      }),
    ]));
  });

  it.each([0, 1] as const)(
    '第 %i 条自然首稿异步失败后不启动后续首稿或恢复，终态与 physical 始终最后',
    async (failedPlanIndex) => {
      const calls: number[] = [];
      const probeUseDirectionDraftFormatRecovery = vi.fn();
      const generateUseDirectionDrafts = vi.fn(async (
        input: { planContexts: Array<{ planIndex: 0 | 1 | 2 }> },
      ) => {
        const planIndex = input.planContexts[0]!.planIndex;
        calls.push(planIndex);
        await new Promise(resolve => setTimeout(resolve, planIndex === failedPlanIndex ? 8 : 2));
        if (planIndex === failedPlanIndex) {
          throw Object.assign(new Error('异步 Provider 失败'), {
            code: 'PROMPT_WIZARD_PROVIDER_REQUEST_FAILED',
          });
        }
        return naturalResult(planIndex);
      });
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const succeeded = await runPromptWizardAttempt27DiagnosticProcess((() => ({
        provider: {
          generateUseDirectionDrafts,
          probeUseDirectionDraftFormatRecovery,
        } as unknown as ArkPromptWizardProvider,
        physicalRequestGuard: {
          enterCase: vi.fn(),
          beginAttempt27FormatRecoveryProbe: vi.fn(),
          leaveCase: vi.fn(),
          snapshot: () => partialPhysicalSnapshot(calls.length),
        },
      })) as never);
      const outputAfterTerminal = stdout.mock.calls
        .map((call: unknown[]) => String(call[0]))
        .join('');

      expect(succeeded).toBe(false);
      expect(calls).toEqual(failedPlanIndex === 0 ? [0] : [0, 1]);
      expect(probeUseDirectionDraftFormatRecovery).not.toHaveBeenCalled();
      expect(capturedEvents(stdout).slice(-2).map(event => event.event)).toEqual([
        'prompt-wizard-v6-attempt27-aborted',
        'prompt-wizard-v6-attempt27-physical-request-counts',
      ]);

      await new Promise(resolve => setTimeout(resolve, 15));
      expect(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join(''))
        .toBe(outputAfterTerminal);
    },
  );

  it('T221902：plan0 成功而 plan1 括号错配时合并既有诊断、去重并与两次物理请求对账', async () => {
    const nearDuplicatePlan0Diagnostic = {
      ...outputDiagnostic(0, 'generate-drafts'),
      outputLengthBucket: '1-2048' as const,
      outputTextSource: 'streamed-fallback' as const,
      fieldPaths: ['hook'],
    };
    const invalidPlan1Diagnostic = {
      ...outputDiagnostic(1, 'generate-drafts'),
      phase: 'parse' as const,
      classification: 'bracket-mismatch' as const,
      normalizationMode: 'none' as const,
      outputLengthBucket: '1-2048' as const,
    };
    const calls: number[] = [];
    const generateUseDirectionDrafts = vi.fn(async (
      input: { planContexts: Array<{ planIndex: 0 | 1 | 2 }> },
    ) => {
      const planIndex = input.planContexts[0]!.planIndex;
      calls.push(planIndex);
      if (planIndex === 0) return naturalResult(0);
      throw Object.assign(new Error('不得进入永久证据的 Provider 正文'), {
        code: 'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED',
        // 模拟 error 链带回同一永久身份、但安全桶/来源/路径均不同的 plan0
        // 副本；合并器必须保留先前成功解码的 plan0，并保留新的 plan1 异常。
        outputDiagnostics: [
          nearDuplicatePlan0Diagnostic,
          invalidPlan1Diagnostic,
        ],
      });
    });
    const probeUseDirectionDraftFormatRecovery = vi.fn();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const succeeded = await runPromptWizardAttempt27DiagnosticProcess((() => ({
      provider: {
        generateUseDirectionDrafts,
        probeUseDirectionDraftFormatRecovery,
      } as unknown as ArkPromptWizardProvider,
      physicalRequestGuard: {
        enterCase: vi.fn(),
        beginAttempt27FormatRecoveryProbe: vi.fn(),
        leaveCase: vi.fn(),
        snapshot: () => partialPhysicalSnapshot(2),
      },
    })) as never);
    const events = capturedEvents(stdout);
    const identities = events.filter(event => (
      event.event === 'prompt-wizard-v6-attempt27-initial-provider-identity'
    ));
    const outputEvents = events.filter(event => (
      event.event === 'prompt-wizard-v6-attempt27-output-diagnostics'
    ));

    expect(succeeded).toBe(false);
    expect(calls).toEqual([0, 1]);
    expect(probeUseDirectionDraftFormatRecovery).not.toHaveBeenCalled();
    expect(identities.map(event => event.planIndex)).toEqual([0, 1]);
    expect(outputEvents).toEqual([expect.objectContaining({
      caseId: '服饰-10s-zh',
      formatAnomalyCount: 1,
      formatRecoveryCount: 0,
      outputDiagnostics: [
        outputDiagnostic(0, 'generate-drafts'),
        invalidPlan1Diagnostic,
      ],
    })]);
    expect(events.slice(-3).map(event => event.event)).toEqual([
      'prompt-wizard-v6-attempt27-output-diagnostics',
      'prompt-wizard-v6-attempt27-aborted',
      'prompt-wizard-v6-attempt27-physical-request-counts',
    ]);
    expect(JSON.stringify(events)).not.toContain('不得进入永久证据');

    const transcript = [
      identities[0]!,
      providerCompletion('generate-drafts'),
      identities[1]!,
      providerCompletion('generate-drafts'),
      outputEvents[0]!,
      events.at(-2)!,
      events.at(-1)!,
    ].map(event => JSON.stringify(event)).join('\n');
    const parsed = parsePromptWizardAttempt27DiagnosticNdjson({
      transcript,
      processExitCode: 1,
    });
    expect(parsed).toMatchObject({
      state: 'aborted',
      diagnosticComplete: false,
      releaseAllowed: false,
      physicalRequestSnapshot: {
        globalCount: 2,
        operationCounts: {
          'generate-drafts': 2,
          'repair-draft-format': 0,
          'repair-draft-content': 0,
        },
      },
      providerUsageSummary: {
        requestEventCount: 2,
        completedCount: 2,
        failedCount: 0,
        attempts: 2,
        operationCounts: {
          'generate-drafts': 2,
          'repair-draft-format': 0,
          'repair-draft-content': 0,
        },
      },
    });
  });

  it('自然结果本地断言失败时只持久化其安全输出诊断，再写 aborted/physical', async () => {
    const generateUseDirectionDrafts = vi.fn(async () => ({
      ...naturalResult(0),
      drafts: [],
    }));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const succeeded = await runPromptWizardAttempt27DiagnosticProcess((() => ({
      provider: {
        generateUseDirectionDrafts,
        probeUseDirectionDraftFormatRecovery: vi.fn(),
      } as unknown as ArkPromptWizardProvider,
      physicalRequestGuard: {
        enterCase: vi.fn(),
        beginAttempt27FormatRecoveryProbe: vi.fn(),
        leaveCase: vi.fn(),
        snapshot: () => partialPhysicalSnapshot(1),
      },
    })) as never);
    const events = capturedEvents(stdout);

    expect(succeeded).toBe(false);
    expect(generateUseDirectionDrafts).toHaveBeenCalledTimes(1);
    expect(events.slice(-3).map(event => event.event)).toEqual([
      'prompt-wizard-v6-attempt27-output-diagnostics',
      'prompt-wizard-v6-attempt27-aborted',
      'prompt-wizard-v6-attempt27-physical-request-counts',
    ]);
    expect(events.at(-3)).toMatchObject({
      caseId: '服饰-10s-zh',
      formatAnomalyCount: 0,
      formatRecoveryCount: 0,
      outputDiagnostics: [outputDiagnostic(0, 'generate-drafts')],
    });
  });

  it('自然首稿为原生 JSON 但仍处于 Schema count 失败时立即停止', async () => {
    const schemaDiagnostic = {
      ...outputDiagnostic(0, 'generate-drafts'),
      phase: 'schema' as const,
      schemaIssue: 'count' as const,
      fieldPaths: ['segments[0].voiceover'],
    };
    const generateUseDirectionDrafts = vi.fn(async () => ({
      ...naturalResult(0),
      outputDiagnostics: [schemaDiagnostic],
    }));
    const probeUseDirectionDraftFormatRecovery = vi.fn();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const succeeded = await runPromptWizardAttempt27DiagnosticProcess((() => ({
      provider: {
        generateUseDirectionDrafts,
        probeUseDirectionDraftFormatRecovery,
      } as unknown as ArkPromptWizardProvider,
      physicalRequestGuard: {
        enterCase: vi.fn(),
        beginAttempt27FormatRecoveryProbe: vi.fn(),
        leaveCase: vi.fn(),
        snapshot: () => partialPhysicalSnapshot(1),
      },
    })) as never);

    expect(succeeded).toBe(false);
    expect(generateUseDirectionDrafts).toHaveBeenCalledOnce();
    expect(probeUseDirectionDraftFormatRecovery).not.toHaveBeenCalled();
    expect(capturedEvents(stdout)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'prompt-wizard-v6-attempt27-output-diagnostics',
        outputDiagnostics: [schemaDiagnostic],
      }),
    ]));
  });

  it('固定 plan0 恢复探针返回 Schema count 失败结果时不得写完成态', async () => {
    const schemaDiagnostic = {
      ...outputDiagnostic(0, 'repair-draft-format'),
      phase: 'schema' as const,
      schemaIssue: 'count' as const,
      fieldPaths: ['segments[0].voiceover'],
    };
    const generateUseDirectionDrafts = vi.fn(async (
      input: { planContexts: Array<{ planIndex: 0 | 1 | 2 }> },
    ) => naturalResult(input.planContexts[0]!.planIndex));
    const probeUseDirectionDraftFormatRecovery = vi.fn(async () => ({
      draft: { planIndex: 0 },
      usage: {
        interactionId: null,
        model: 'm',
        inputTokens: 1,
        outputTokens: 1,
        serviceTier: 'default' as const,
        requestAttempts: 1,
      },
      outputDiagnostics: [schemaDiagnostic],
    }));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const succeeded = await runPromptWizardAttempt27DiagnosticProcess((() => ({
      provider: {
        generateUseDirectionDrafts,
        probeUseDirectionDraftFormatRecovery,
      } as unknown as ArkPromptWizardProvider,
      physicalRequestGuard: {
        enterCase: vi.fn(),
        beginAttempt27FormatRecoveryProbe: vi.fn(),
        leaveCase: vi.fn(),
        snapshot: firstCaseProbePhysicalSnapshot,
      },
    })) as never);
    const events = capturedEvents(stdout);

    expect(succeeded).toBe(false);
    expect(generateUseDirectionDrafts).toHaveBeenCalledTimes(3);
    expect(probeUseDirectionDraftFormatRecovery).toHaveBeenCalledOnce();
    expect(events.some(event => (
      event.event === 'prompt-wizard-v6-attempt27-completed'
    ))).toBe(false);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'prompt-wizard-v6-attempt27-output-diagnostics',
        outputDiagnostics: expect.arrayContaining([schemaDiagnostic]),
      }),
    ]));
  });

  it('固定恢复探针即使原生成功但诊断 planIndex 不是 0 也立即失败关闭', async () => {
    const generateUseDirectionDrafts = vi.fn(async (
      input: { planContexts: Array<{ planIndex: 0 | 1 | 2 }> },
    ) => naturalResult(input.planContexts[0]!.planIndex));
    const probeUseDirectionDraftFormatRecovery = vi.fn(async () => ({
      draft: { planIndex: 0 },
      usage: {
        interactionId: null,
        model: 'm',
        inputTokens: 1,
        outputTokens: 1,
        serviceTier: 'default' as const,
        requestAttempts: 1,
      },
      outputDiagnostics: [outputDiagnostic(1, 'repair-draft-format')],
    }));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const succeeded = await runPromptWizardAttempt27DiagnosticProcess((() => ({
      provider: {
        generateUseDirectionDrafts,
        probeUseDirectionDraftFormatRecovery,
      } as unknown as ArkPromptWizardProvider,
      physicalRequestGuard: {
        enterCase: vi.fn(),
        beginAttempt27FormatRecoveryProbe: vi.fn(),
        leaveCase: vi.fn(),
        snapshot: firstCaseProbePhysicalSnapshot,
      },
    })) as never);

    expect(succeeded).toBe(false);
    expect(probeUseDirectionDraftFormatRecovery).toHaveBeenCalledOnce();
    expect(capturedEvents(stdout).some(event => (
      event.event === 'prompt-wizard-v6-attempt27-completed'
    ))).toBe(false);
  });

  it('无自然异常时完整12次物理请求只得到 diagnosticComplete=true，永远不可发布', () => {
    expect(parsePromptWizardAttempt27DiagnosticNdjson({
      transcript: completedTranscript(),
      processExitCode: 0,
    })).toMatchObject({
      state: 'completed',
      ok: true,
      diagnosticComplete: true,
      releaseAllowed: false,
      physicalRequestSnapshot: {
        globalCount: 12,
        operationCounts: {
          'generate-drafts': 9,
          'repair-draft-format': 3,
          'repair-draft-content': 0,
        },
      },
    });
  });

  it('一次自然异常恢复与三次固定探针可形成13次完整诊断证据', () => {
    expect(parsePromptWizardAttempt27DiagnosticNdjson({
      transcript: completedTranscriptWithNaturalRecovery(),
      processExitCode: 0,
    })).toMatchObject({
      state: 'completed',
      diagnosticComplete: true,
      releaseAllowed: false,
      physicalRequestSnapshot: {
        globalCount: 13,
        operationCounts: {
          'generate-drafts': 9,
          'repair-draft-format': 4,
          'repair-draft-content': 0,
        },
      },
    });
  });

  it.each([
    { stage: 'initial', planIndex: 0 },
    { stage: 'format-recovery', planIndex: 0 },
  ] as const)('完成 transcript 中 $stage 仍为 Schema count 失败时失败关闭', ({
    stage,
    planIndex,
  }) => {
    const events = completedTranscript().split('\n').map(line => JSON.parse(line));
    const outputEvent = events.find(event => (
      event.event === 'prompt-wizard-v6-attempt27-output-diagnostics'
    ));
    Object.assign(outputEvent.outputDiagnostics.find((diagnostic: Record<string, unknown>) => (
      diagnostic.stage === stage && diagnostic.planIndex === planIndex
    )), {
      phase: 'schema',
      schemaIssue: 'count',
      fieldPaths: ['segments[0].voiceover'],
    });
    expect(() => parsePromptWizardAttempt27DiagnosticNdjson({
      transcript: events.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toThrow(/证据无效/u);
  });

  it('完成 transcript 的固定恢复探针不是 plan0 时失败关闭', () => {
    const events = completedTranscript().split('\n').map(line => JSON.parse(line));
    const outputEvent = events.find(event => (
      event.event === 'prompt-wizard-v6-attempt27-output-diagnostics'
    ));
    outputEvent.outputDiagnostics.find((diagnostic: Record<string, unknown>) => (
      diagnostic.stage === 'format-recovery'
    )).planIndex = 1;
    expect(() => parsePromptWizardAttempt27DiagnosticNdjson({
      transcript: events.map(event => JSON.stringify(event)).join('\n'),
      processExitCode: 0,
    })).toThrow(/证据无效/u);
  });

  it('Provider 用量、operation、输出来源或事件字段被篡改均失败关闭', () => {
    const cases = [
      completedTranscript().replace('"attempts":1', '"attempts":2'),
      completedTranscript().replace('"repair-draft-format":3', '"repair-draft-format":2'),
      completedTranscript().replace('"outputTextSource":"completed"', '"outputTextSource":"existing-compatible"'),
      completedTranscript().replace('"diagnosticComplete":true', '"diagnosticComplete":true,"prompt":"泄漏"'),
      completedTranscript().replace(
        '"role":"proof-conversion"',
        '"role":"proof-conversion","detail":"秘密 Provider 正文"',
      ),
    ];
    cases.forEach((transcript) => {
      expect(() => parsePromptWizardAttempt27DiagnosticNdjson({
        transcript,
        processExitCode: 0,
      })).toThrow();
    });
  });

  it('自然首稿非法时放行一次自动恢复，恢复稿仍非法则安全停止', async () => {
    const originalNodeEnv = env.NODE_ENV;
    const transcriptLines: string[] = [];
    const appendLine = (value: unknown) => {
      transcriptLines.push(String(value).replace(/\r?\n$/u, ''));
    };
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((value) => {
      appendLine(value);
      return true;
    });
    const log = vi.spyOn(console, 'log').mockImplementation(appendLine);
    const warn = vi.spyOn(console, 'warn').mockImplementation(appendLine);
    const error = vi.spyOn(console, 'error').mockImplementation(appendLine);
    const create = vi.fn(async () => ({
      id: 'response-attempt27-invalid-json',
      model: 'doubao-seed-2-0-lite-260428',
      service_tier: 'default',
      output_text: '{"hook":',
      outputTextSource: 'completed' as const,
      usage: {
        input_tokens: 101,
        cached_input_tokens: 0,
        output_tokens: 9,
      },
      providerRequestId: 'provider-request-attempt27-invalid-json',
      xTtLogId: 'log-attempt27-invalid-json',
      httpStatus: 200,
      receivedBytes: 9,
      receivedEvent: true,
    }));
    const physicalRequestGuard = createPromptWizardAttempt27PhysicalRequestGuard(
      { create },
      PROMPT_WIZARD_ATTEMPT27_CASE_IDS,
    );

    env.NODE_ENV = 'production';
    try {
      const succeeded = await runPromptWizardAttempt27DiagnosticProcess((() => ({
        provider: new ArkPromptWizardProvider(physicalRequestGuard),
        physicalRequestGuard,
      })) as never);
      const transcript = transcriptLines.filter(Boolean).join('\n');
      const parsed = parsePromptWizardAttempt27DiagnosticNdjson({
        transcript,
        processExitCode: succeeded ? 0 : 1,
      });

      expect(succeeded).toBe(false);
      expect(create).toHaveBeenCalledTimes(2);
      expect(physicalRequestGuard.snapshot()).toMatchObject({
        globalCount: 2,
        operationCounts: {
          'generate-drafts': 1,
          'repair-draft-format': 1,
          'repair-draft-content': 0,
        },
      });
      expect(parsed).toMatchObject({
        state: 'aborted',
        diagnosticComplete: false,
        releaseAllowed: false,
        providerUsageSummary: {
          requestEventCount: 2,
          completedCount: 2,
          failedCount: 0,
          attempts: 2,
          inputTokens: 202,
          outputTokens: 18,
          operationCounts: {
            'generate-drafts': 1,
            'repair-draft-format': 1,
            'repair-draft-content': 0,
          },
        },
      });
      expect(parsed.normalizedEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'prompt-wizard-v6-attempt27-output-diagnostics',
          caseId: '服饰-10s-zh',
          formatAnomalyCount: 2,
          formatRecoveryCount: 1,
        }),
        expect.objectContaining({
          event: 'prompt-wizard-v6-attempt27-aborted',
          errorCode: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
        }),
      ]));
      expect(transcript).not.toContain('"event":"prompt-wizard-provider-failed"');
    } finally {
      env.NODE_ENV = originalNodeEnv;
      stdout.mockRestore();
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('physical guard 放行后delegate真实拒绝，仍恰好记录一次 Provider failed 并可解析 aborted', async () => {
    const create = vi.fn(async () => {
      throw new ArkPromptWizardResponsesError({
        message: 'Provider 返回终态错误',
        code: 'PROMPT_WIZARD_PROVIDER_REQUEST_FAILED',
        status: 503,
        errorClassification: 'UPSTREAM_UNAVAILABLE',
        providerRequestId: 'provider-request-attempt27-failed',
        responseId: 'response-attempt27-failed',
        xTtLogId: 'log-attempt27-failed',
        usage: {
          input_tokens: null,
          cached_input_tokens: null,
          output_tokens: null,
        },
        receivedBytes: 42,
        receivedEvent: true,
        retryable: false,
      });
    });
    const captured = await captureAttempt27ArkTranscript(create);
    const records = captured.transcript.split('\n').map(
      line => JSON.parse(line) as Record<string, unknown>,
    );
    const failedEvents = records.filter(record => (
      record.event === 'prompt-wizard-provider-failed'
    ));
    const parsed = parsePromptWizardAttempt27DiagnosticNdjson({
      transcript: captured.transcript,
      processExitCode: captured.succeeded ? 0 : 1,
    });

    expect(captured.succeeded).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    expect(captured.physicalRequestSnapshot).toMatchObject({
      globalCount: 1,
      operationCounts: {
        'generate-drafts': 1,
        'repair-draft-format': 0,
        'repair-draft-content': 0,
      },
    });
    expect(failedEvents).toEqual([
      expect.objectContaining({
        event: 'prompt-wizard-provider-failed',
        operation: 'generate-drafts',
        status: 503,
        attempts: 1,
        errorClassification: 'UPSTREAM_UNAVAILABLE',
      }),
    ]);
    expect(parsed).toMatchObject({
      state: 'aborted',
      providerUsageSummary: {
        requestEventCount: 1,
        completedCount: 0,
        failedCount: 1,
        attempts: 1,
        unknownInputTokenCount: 1,
        unknownOutputTokenCount: 1,
        operationCounts: {
          'generate-drafts': 1,
          'repair-draft-format': 0,
          'repair-draft-content': 0,
        },
      },
    });
  });

  it('仅伪造 providerRequestAttempted=false 但缺少专用 preflight triple 时仍标记并记录真实请求', async () => {
    const spoofed = Object.assign(new Error('不可抑制的 delegate 失败'), {
      code: 'PROMPT_WIZARD_PROVIDER_REQUEST_FAILED',
      retryable: false,
      providerRequestAttempted: false,
    });
    const create = vi.fn(async () => { throw spoofed; });
    const captured = await captureAttempt27ArkTranscript(create);
    const records = captured.transcript.split('\n').map(
      line => JSON.parse(line) as Record<string, unknown>,
    );
    const failedEvents = records.filter(record => (
      record.event === 'prompt-wizard-provider-failed'
    ));
    const parsed = parsePromptWizardAttempt27DiagnosticNdjson({
      transcript: captured.transcript,
      processExitCode: captured.succeeded ? 0 : 1,
    });

    expect(spoofed.providerRequestAttempted).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(captured.physicalRequestSnapshot.globalCount).toBe(1);
    expect(failedEvents).toEqual([
      expect.objectContaining({
        event: 'prompt-wizard-provider-failed',
        operation: 'generate-drafts',
        attempts: 1,
      }),
    ]);
    expect(parsed.providerUsageSummary).toMatchObject({
      requestEventCount: 1,
      failedCount: 1,
      attempts: 1,
      operationCounts: {
        'generate-drafts': 1,
        'repair-draft-format': 0,
        'repair-draft-content': 0,
      },
    });
  });

  it('三条自然首稿完成后恢复探针失败，只发一次已完成首稿的安全输出诊断', async () => {
    const generateUseDirectionDrafts = vi.fn(async (
      input: { planContexts: Array<{ planIndex: 0 | 1 | 2 }> },
    ) => naturalResult(input.planContexts[0]!.planIndex));
    const probeUseDirectionDraftFormatRecovery = vi.fn(async () => {
      throw Object.assign(new Error('恢复探针 Provider 失败'), {
        code: 'PROMPT_WIZARD_PROVIDER_REQUEST_FAILED',
      });
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const succeeded = await runPromptWizardAttempt27DiagnosticProcess((() => ({
      provider: {
        generateUseDirectionDrafts,
        probeUseDirectionDraftFormatRecovery,
      } as unknown as ArkPromptWizardProvider,
      physicalRequestGuard: {
        enterCase: vi.fn(),
        beginAttempt27FormatRecoveryProbe: vi.fn(),
        leaveCase: vi.fn(),
        snapshot: firstCaseProbePhysicalSnapshot,
      },
    })) as never);
    const events = capturedEvents(stdout);
    const outputEvents = events.filter(event => (
      event.event === 'prompt-wizard-v6-attempt27-output-diagnostics'
    ));

    expect(succeeded).toBe(false);
    expect(generateUseDirectionDrafts).toHaveBeenCalledTimes(3);
    expect(probeUseDirectionDraftFormatRecovery).toHaveBeenCalledTimes(1);
    expect(outputEvents).toEqual([
      expect.objectContaining({
        caseId: '服饰-10s-zh',
        formatAnomalyCount: 0,
        formatRecoveryCount: 0,
        outputDiagnostics: [
          outputDiagnostic(0, 'generate-drafts'),
          outputDiagnostic(1, 'generate-drafts'),
          outputDiagnostic(2, 'generate-drafts'),
        ],
      }),
    ]);
    expect(events.slice(-3).map(event => event.event)).toEqual([
      'prompt-wizard-v6-attempt27-output-diagnostics',
      'prompt-wizard-v6-attempt27-aborted',
      'prompt-wizard-v6-attempt27-physical-request-counts',
    ]);
  });

  it('恢复响应通过 JSON 但字符数 Schema 非法时保留固定 count 分类并可规范化 aborted 证据', async () => {
    const invalidRecoveryDiagnostic = {
      ...outputDiagnostic(0, 'repair-draft-format'),
      phase: 'schema' as const,
      schemaIssue: 'count' as const,
      fieldPaths: ['segments[0].voiceover'],
    };
    const generateUseDirectionDrafts = vi.fn(async (
      input: { planContexts: Array<{ planIndex: 0 | 1 | 2 }> },
    ) => naturalResult(input.planContexts[0]!.planIndex));
    const probeUseDirectionDraftFormatRecovery = vi.fn(async () => {
      throw Object.assign(new Error('恢复响应未通过固定结构校验'), {
        code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
        outputDiagnostics: [invalidRecoveryDiagnostic],
      });
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const succeeded = await runPromptWizardAttempt27DiagnosticProcess((() => ({
      provider: {
        generateUseDirectionDrafts,
        probeUseDirectionDraftFormatRecovery,
      } as unknown as ArkPromptWizardProvider,
      physicalRequestGuard: {
        enterCase: vi.fn(),
        beginAttempt27FormatRecoveryProbe: vi.fn(),
        leaveCase: vi.fn(),
        snapshot: firstCaseProbePhysicalSnapshot,
      },
    })) as never);
    const events = capturedEvents(stdout);
    const identities = events.filter(event => (
      event.event === 'prompt-wizard-v6-attempt27-initial-provider-identity'
    ));
    const outputEvent = events.find(event => (
      event.event === 'prompt-wizard-v6-attempt27-output-diagnostics'
    ))!;
    const aborted = events.find(event => (
      event.event === 'prompt-wizard-v6-attempt27-aborted'
    ))!;
    const physical = events.find(event => (
      event.event === 'prompt-wizard-v6-attempt27-physical-request-counts'
    ))!;
    const transcript = [
      ...identities.flatMap(identity => [
        identity,
        providerCompletion('generate-drafts'),
      ]),
      providerCompletion('repair-draft-format'),
      outputEvent,
      aborted,
      physical,
    ].map(event => JSON.stringify(event)).join('\n');
    const parsed = parsePromptWizardAttempt27DiagnosticNdjson({
      transcript,
      processExitCode: succeeded ? 0 : 1,
    });
    const normalizedOutputEvent = parsed.normalizedEvents.find(event => (
      event.event === 'prompt-wizard-v6-attempt27-output-diagnostics'
    ));

    expect(succeeded).toBe(false);
    expect(outputEvent).toMatchObject({
      caseId: '服饰-10s-zh',
      formatAnomalyCount: 0,
      formatRecoveryCount: 1,
      outputDiagnostics: [
        outputDiagnostic(0, 'generate-drafts'),
        outputDiagnostic(1, 'generate-drafts'),
        outputDiagnostic(2, 'generate-drafts'),
        invalidRecoveryDiagnostic,
      ],
    });
    expect(events.slice(-3).map(event => event.event)).toEqual([
      'prompt-wizard-v6-attempt27-output-diagnostics',
      'prompt-wizard-v6-attempt27-aborted',
      'prompt-wizard-v6-attempt27-physical-request-counts',
    ]);
    expect(parsed).toMatchObject({
      state: 'aborted',
      diagnosticComplete: false,
      providerUsageSummary: {
        requestEventCount: 4,
        completedCount: 4,
        failedCount: 0,
        attempts: 4,
        operationCounts: {
          'generate-drafts': 3,
          'repair-draft-format': 1,
          'repair-draft-content': 0,
        },
      },
    });
    expect(normalizedOutputEvent).toMatchObject({
      formatAnomalyCount: 0,
      formatRecoveryCount: 1,
      outputDiagnostics: expect.arrayContaining([
        expect.objectContaining({
          operation: 'repair-draft-format',
          stage: 'format-recovery',
          phase: 'schema',
          classification: 'valid-json',
          normalizationMode: 'native',
          schemaIssue: 'count',
          fieldPaths: ['segments[0].voiceover'],
        }),
      ]),
    });
  });
});
