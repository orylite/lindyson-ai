import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertPromptWizardAttempt24DiagnosticEventContract,
  buildPromptWizardAttempt24AbortEvent,
  parsePromptWizardAttempt24DiagnosticNdjson,
  PROMPT_WIZARD_ATTEMPT24_DIAGNOSTIC_CASES,
  PromptWizardAttempt24PhysicalRequestGuard,
  runPromptWizardAttempt24Diagnostic,
} from '../src/tools/diagnosePromptWizardAttempt24.js';
import { generateValidatedPromptWizardRoutePlansV6 } from '../src/domain/promptWizardService.js';
import { PROMPT_WIZARD_V6_ROUTE_ROLES } from '../src/domain/promptWizardV6Routes.js';
import { FakePromptWizardProvider } from '../src/providers/promptWizardProvider.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function identityEvent(caseId: string, planIndex: 0 | 1 | 2) {
  return {
    event: 'prompt-wizard-attempt24-initial-provider-identity',
    caseId,
    planIndex,
    role: PROMPT_WIZARD_V6_ROUTE_ROLES[planIndex],
  };
}

function diagnosticEvent(caseId: string) {
  return {
    event: 'prompt-wizard-attempt24-repair-diagnostics',
    caseId,
    contentRepairRequestCounts: [0, 0, 0],
    terminalCalibrationRequestCounts: [0, 0, 0],
    repairDiagnostics: [],
  };
}

function batchEvent(testCase: (typeof PROMPT_WIZARD_ATTEMPT24_DIAGNOSTIC_CASES)[number]) {
  return {
    event: 'prompt-wizard-attempt24-batch',
    id: testCase.id,
    ok: true,
    planCount: 3,
    audioMode: testCase.audioMode,
    targetLanguage: testCase.targetLanguage,
    contentRepairRequestCounts: [0, 0, 0],
    terminalCalibrationRequestCounts: [0, 0, 0],
  };
}

function validCompletedEvents(): unknown[] {
  return [
    ...PROMPT_WIZARD_ATTEMPT24_DIAGNOSTIC_CASES.flatMap(testCase => [
      identityEvent(testCase.id, 0),
      identityEvent(testCase.id, 1),
      identityEvent(testCase.id, 2),
      diagnosticEvent(testCase.id),
      batchEvent(testCase),
    ]),
    {
      event: 'prompt-wizard-attempt24-diagnostic-completed',
      ok: true,
      completed: 2,
      deliveredPlanCount: 6,
      diagnosticComplete: true,
      releaseAllowed: false,
      physicalRequestSnapshot: physicalRequestSnapshot(3, 3),
    },
  ];
}

function ndjson(events: readonly unknown[]) {
  return `${events.map(event => JSON.stringify(event)).join('\n')}\n`;
}

function physicalRequestSnapshot(soundOnlyCount: number, englishCount: number) {
  return {
    globalCount: soundOnlyCount + englishCount,
    caseCounts: {
      '服饰-5s-sound-only': soundOnlyCount,
      '服饰-10s-en': englishCount,
    },
  };
}

describe('Prompt Wizard Attempt24 两批诊断入口', () => {
  it('矩阵固定为服饰 5 秒无口播与 10 秒英语，且物理请求上限合计 27', () => {
    expect(PROMPT_WIZARD_ATTEMPT24_DIAGNOSTIC_CASES).toEqual([
      expect.objectContaining({
        id: '服饰-5s-sound-only',
        audioMode: 'sound-design-only',
        targetLanguage: null,
        physicalRequestLimit: 12,
        config: expect.objectContaining({ durationSeconds: 5 }),
      }),
      expect.objectContaining({
        id: '服饰-10s-en',
        audioMode: 'voiceover',
        targetLanguage: '英语',
        physicalRequestLimit: 15,
        config: expect.objectContaining({ durationSeconds: 10 }),
      }),
    ]);
  });

  it('复用生产生成器且恰好执行两批六路，完成态永远不可发布', async () => {
    vi.useFakeTimers();
    const provider = new FakePromptWizardProvider();
    const draftSpy = vi.spyOn(provider, 'generateUseDirectionDrafts');
    const generateRoutePlans = vi.fn(generateValidatedPromptWizardRoutePlansV6);
    const events: Record<string, unknown>[] = [];

    const run = runPromptWizardAttempt24Diagnostic(
      { provider, physicalRequestSnapshot: () => physicalRequestSnapshot(3, 3) },
      { generateRoutePlans, emit: event => events.push(event) },
    );
    await vi.runAllTimersAsync();
    await expect(run).resolves.toEqual(expect.objectContaining({
      diagnosticComplete: true,
      releaseAllowed: false,
      completed: 2,
      deliveredPlanCount: 6,
    }));

    expect(generateRoutePlans).toHaveBeenCalledTimes(2);
    expect(draftSpy).toHaveBeenCalledTimes(6);
    expect(generateRoutePlans.mock.calls[0]![0]).not.toHaveProperty('voiceoverLanguage');
    expect(generateRoutePlans.mock.calls[1]![0]).toMatchObject({ voiceoverLanguage: '英语' });
    expect(events.filter(event => (
      event.event === 'prompt-wizard-attempt24-initial-provider-identity'
    ))).toHaveLength(6);
    expect(parsePromptWizardAttempt24DiagnosticNdjson({
      transcript: ndjson(events),
      processExitCode: 0,
    })).toEqual({
      state: 'diagnostic-completed',
      ok: true,
      diagnosticComplete: true,
      releaseAllowed: false,
      observedIdentityCount: 6,
      completedBatchCount: 2,
      physicalRequestSnapshot: physicalRequestSnapshot(3, 3),
      processExitCode: 0,
    });
  });

  it('无 Ark guard 的 Fake runtime 缺少显式快照时在 Provider 调用前失败', async () => {
    const provider = new FakePromptWizardProvider();
    const draftSpy = vi.spyOn(provider, 'generateUseDirectionDrafts');
    await expect(runPromptWizardAttempt24Diagnostic({ provider })).rejects.toThrow(
      /缺少物理请求计数来源/u,
    );
    expect(draftSpy).not.toHaveBeenCalled();
  });

  it('接受每方案两次内容修复及一次终局校准，并完整保留安全诊断', async () => {
    vi.useFakeTimers();
    const provider = new FakePromptWizardProvider();
    const events: Record<string, unknown>[] = [];
    const generateRoutePlans = vi.fn(async (
      input: Parameters<typeof generateValidatedPromptWizardRoutePlansV6>[0],
    ) => {
      const result = await generateValidatedPromptWizardRoutePlansV6(input);
      if (input.config.durationSeconds !== 10) return result;
      return {
        ...result,
        contentRepairRequestCounts: [2, 0, 0] as [number, number, number],
        terminalCalibrationRequestCounts: [0, 1, 0] as [number, number, number],
        repairDiagnostics: [
          {
            planIndex: 0 as const,
            origin: 'initial-schema' as const,
            repairRound: 1 as const,
            errorCode: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
            fieldPaths: ['segments[0].action'],
          },
          {
            planIndex: 0 as const,
            origin: 'domain-validation' as const,
            repairRound: 2 as const,
            errorCode: 'PROMPT_WIZARD_CONTENT_REPAIR_REQUIRED',
            fieldPaths: ['segments[1].action'],
          },
          {
            planIndex: 1 as const,
            origin: 'terminal-calibration' as const,
            repairRound: 3 as const,
            errorCode: 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
            fieldPaths: ['segment0.voiceoverCharacters'],
          },
        ],
      };
    });

    const run = runPromptWizardAttempt24Diagnostic(
      { provider, physicalRequestSnapshot: () => physicalRequestSnapshot(3, 3) },
      { generateRoutePlans, emit: event => events.push(event) },
    );
    await vi.runAllTimersAsync();
    await expect(run).resolves.toMatchObject({ diagnosticComplete: true });

    expect(events).toContainEqual(expect.objectContaining({
      event: 'prompt-wizard-attempt24-repair-diagnostics',
      caseId: '服饰-10s-en',
      contentRepairRequestCounts: [2, 0, 0],
      terminalCalibrationRequestCounts: [0, 1, 0],
      repairDiagnostics: [
        expect.objectContaining({ origin: 'initial-schema', repairRound: 1 }),
        expect.objectContaining({ origin: 'domain-validation', repairRound: 2 }),
        expect.objectContaining({ origin: 'terminal-calibration', repairRound: 3 }),
      ],
    }));
    expect(() => assertPromptWizardAttempt24DiagnosticEventContract(events)).not.toThrow();
  });

  it('首批诊断超出两次内容修复时立即停止且不开始第二批', async () => {
    vi.useFakeTimers();
    const provider = new FakePromptWizardProvider();
    const draftSpy = vi.spyOn(provider, 'generateUseDirectionDrafts');
    const events: Record<string, unknown>[] = [];
    const generateRoutePlans = vi.fn(async (
      input: Parameters<typeof generateValidatedPromptWizardRoutePlansV6>[0],
    ) => {
      const result = await generateValidatedPromptWizardRoutePlansV6(input);
      return {
        ...result,
        contentRepairRequestCounts: [3, 0, 0] as [number, number, number],
        repairDiagnostics: [1, 2, 3].map(round => ({
          planIndex: 0 as const,
          origin: round === 1 ? 'initial-schema' as const : 'domain-validation' as const,
          repairRound: round as 1 | 2 | 3,
          errorCode: 'PROMPT_WIZARD_CONTENT_REPAIR_REQUIRED',
          fieldPaths: ['segments[0].action'],
        })),
      };
    });

    const run = runPromptWizardAttempt24Diagnostic(
      { provider, physicalRequestSnapshot: () => physicalRequestSnapshot(3, 0) },
      { generateRoutePlans, emit: event => events.push(event) },
    );
    const assertion = expect(run).rejects.toThrow(/修复计数超过生产预算/u);
    await vi.runAllTimersAsync();
    await assertion;

    expect(generateRoutePlans).toHaveBeenCalledTimes(1);
    expect(draftSpy).toHaveBeenCalledTimes(3);
    expect(events.some(event => event.caseId === '服饰-10s-en')).toBe(false);
  });

  it('responses.create 在 12/15/27 上限前放行，越限时不调用底层 client', async () => {
    const create = vi.fn(async () => ({ ok: true } as never));
    const guard = new PromptWizardAttempt24PhysicalRequestGuard({ create });
    const invoke = () => guard.create({} as never, { timeoutMs: 1 });

    guard.enterCase('服饰-5s-sound-only');
    await Promise.all(Array.from({ length: 12 }, invoke));
    await expect(invoke()).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_REQUEST_FAILED',
    });
    expect(create).toHaveBeenCalledTimes(12);
    guard.leaveCase('服饰-5s-sound-only');

    guard.enterCase('服饰-10s-en');
    await Promise.all(Array.from({ length: 15 }, invoke));
    await expect(invoke()).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_REQUEST_FAILED',
    });
    expect(create).toHaveBeenCalledTimes(27);
    expect(guard.snapshot()).toEqual({
      globalCount: 27,
      caseCounts: {
        '服饰-5s-sound-only': 12,
        '服饰-10s-en': 15,
      },
    });
  });
});

describe('Prompt Wizard Attempt24 严格 NDJSON 解析器', () => {
  it('完整两批只产生 diagnosticComplete=true 与 releaseAllowed=false', () => {
    expect(parsePromptWizardAttempt24DiagnosticNdjson({
      transcript: ndjson(validCompletedEvents()),
      processExitCode: 0,
    })).toMatchObject({
      state: 'diagnostic-completed',
      diagnosticComplete: true,
      releaseAllowed: false,
      observedIdentityCount: 6,
      completedBatchCount: 2,
    });
  });

  it('允许终态前交错白名单外 Provider 日志，但拒绝未知 Attempt24 协议事件', () => {
    const providerLog = validCompletedEvents();
    providerLog.splice(1, 0, {
      event: 'prompt-wizard-provider-completed',
      requestId: '安全日志身份',
    });
    expect(() => parsePromptWizardAttempt24DiagnosticNdjson({
      transcript: ndjson(providerLog),
      processExitCode: 0,
    })).not.toThrow();

    const unknown = validCompletedEvents();
    unknown.splice(1, 0, { event: 'prompt-wizard-attempt24-future-protocol' });
    expect(() => parsePromptWizardAttempt24DiagnosticNdjson({
      transcript: ndjson(unknown),
      processExitCode: 0,
    })).toThrow(/未知协议事件/u);
  });

  it('修复计数、字段路径或完成态可发布标记被篡改时失败关闭', () => {
    const countMismatch = validCompletedEvents() as Record<string, unknown>[];
    const firstBatch = countMismatch.find(event => event.event === 'prompt-wizard-attempt24-batch')!;
    firstBatch.contentRepairRequestCounts = [1, 0, 0];
    expect(() => parsePromptWizardAttempt24DiagnosticNdjson({
      transcript: ndjson(countMismatch),
      processExitCode: 0,
    })).toThrow(/批次事件与修复诊断不一致/u);

    const unsafePath = validCompletedEvents() as Record<string, unknown>[];
    const firstDiagnostic = unsafePath.find(event => (
      event.event === 'prompt-wizard-attempt24-repair-diagnostics'
    ))!;
    firstDiagnostic.contentRepairRequestCounts = [1, 0, 0];
    firstDiagnostic.repairDiagnostics = [{
      planIndex: 0,
      origin: 'domain-validation',
      repairRound: 1,
      errorCode: 'PROMPT_WIZARD_CONTENT_REPAIR_REQUIRED',
      fieldPaths: ['segments[0].action：秘密正文'],
    }];
    expect(() => parsePromptWizardAttempt24DiagnosticNdjson({
      transcript: ndjson(unsafePath),
      processExitCode: 0,
    })).toThrow();

    const publishable = validCompletedEvents() as Record<string, unknown>[];
    publishable.at(-1)!.releaseAllowed = true;
    expect(() => parsePromptWizardAttempt24DiagnosticNdjson({
      transcript: ndjson(publishable),
      processExitCode: 0,
    })).toThrow(/completed 终态证据不完整/u);
  });

  it('物理请求快照严格校验分批硬帽、全局总和及固定无正文结构', () => {
    const overCaseLimit = validCompletedEvents() as Record<string, unknown>[];
    overCaseLimit.at(-1)!.physicalRequestSnapshot = physicalRequestSnapshot(13, 3);
    expect(() => parsePromptWizardAttempt24DiagnosticNdjson({
      transcript: ndjson(overCaseLimit),
      processExitCode: 0,
    })).toThrow(/超过硬帽或总分不一致/u);

    const mismatchedTotal = validCompletedEvents() as Record<string, unknown>[];
    mismatchedTotal.at(-1)!.physicalRequestSnapshot = {
      ...physicalRequestSnapshot(3, 3),
      globalCount: 5,
    };
    expect(() => parsePromptWizardAttempt24DiagnosticNdjson({
      transcript: ndjson(mismatchedTotal),
      processExitCode: 0,
    })).toThrow(/超过硬帽或总分不一致/u);

    const leakedBody = validCompletedEvents() as Record<string, unknown>[];
    leakedBody.at(-1)!.physicalRequestSnapshot = {
      ...physicalRequestSnapshot(3, 3),
      requestBody: '不得进入审计证据',
    };
    let failure: unknown;
    try {
      parsePromptWizardAttempt24DiagnosticNdjson({
        transcript: ndjson(leakedBody),
        processExitCode: 0,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'PROMPT_WIZARD_ATTEMPT24_EVIDENCE_INVALID' });
    expect(String(failure)).not.toContain('不得进入审计证据');
  });

  it('malformed、终态与进程 rc 矛盾时失败关闭且不回显恶意正文', () => {
    const secret = 'Provider秘密正文{not-json';
    let failure: unknown;
    try {
      parsePromptWizardAttempt24DiagnosticNdjson({
        transcript: `${ndjson(validCompletedEvents())}${secret}\n`,
        processExitCode: 0,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'PROMPT_WIZARD_ATTEMPT24_EVIDENCE_INVALID' });
    expect(String(failure)).not.toContain(secret);
    expect(() => parsePromptWizardAttempt24DiagnosticNdjson({
      transcript: ndjson(validCompletedEvents()),
      processExitCode: 1,
    })).toThrow(/终态与进程退出码矛盾/u);
  });

  it('安全 aborted 保留错误码但永远不可发布', () => {
    const events = [
      identityEvent('服饰-5s-sound-only', 0),
      buildPromptWizardAttempt24AbortEvent(Object.assign(new Error('不得泄漏的正文'), {
        code: 'PROMPT_WIZARD_PROVIDER_REQUEST_FAILED',
      }), physicalRequestSnapshot(1, 0)),
    ];
    const transcript = ndjson(events);
    expect(transcript).not.toContain('不得泄漏');
    expect(parsePromptWizardAttempt24DiagnosticNdjson({
      transcript,
      processExitCode: 1,
    })).toEqual({
      state: 'diagnostic-aborted',
      ok: false,
      diagnosticComplete: false,
      releaseAllowed: false,
      observedIdentityCount: 1,
      completedBatchCount: 0,
      errorCode: 'PROMPT_WIZARD_PROVIDER_REQUEST_FAILED',
      physicalRequestSnapshot: physicalRequestSnapshot(1, 0),
      processExitCode: 1,
    });
  });
});
