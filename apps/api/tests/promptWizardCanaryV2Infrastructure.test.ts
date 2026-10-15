import { describe, expect, it, vi } from 'vitest';
import type { ArkPromptWizardResponsesRequest } from '../src/providers/arkPromptWizardResponsesClient.js';
import {
  createPromptWizardAttempt27PhysicalRequestGuard,
  createPromptWizardAttempt28PhysicalRequestGuard,
  PROMPT_WIZARD_ATTEMPT27_GLOBAL_PHYSICAL_REQUEST_LIMIT,
  PROMPT_WIZARD_ATTEMPT28_GLOBAL_PHYSICAL_REQUEST_LIMIT,
} from '../src/tools/promptWizardCanaryV2Infrastructure.js';

function request(
  operation: 'generate-drafts' | 'repair-draft-format' | 'repair-draft-content',
  planIndex: 0 | 1 | 2,
): ArkPromptWizardResponsesRequest {
  return {
    model: 'test-model',
    store: false,
    stream: true,
    service_tier: 'default',
    instructions: '仅测试结构化请求身份',
    input: {},
    max_output_tokens: 8_000,
    text: {
      format: {
        type: 'json_schema',
        name: `prompt_wizard_use_direction_plan_${planIndex + 1}_${operation.replaceAll('-', '_')}`,
        strict: true,
        schema: {},
      },
    },
  };
}

function delegate() {
  const create = vi.fn(async () => ({
    id: 'response-id',
    model: 'test-model',
    service_tier: 'default',
    output_text: '{}',
    usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
    providerRequestId: 'provider-request-id',
    xTtLogId: 'log-id',
    httpStatus: 200,
    receivedBytes: 2,
    receivedEvent: true,
  }));
  return { create };
}

describe('Prompt Wizard Attempt27/28 物理请求门禁', () => {
  it('Attempt27 允许一次自然格式恢复，且固定探针使用独立预算', async () => {
    const target = delegate();
    const guard = createPromptWizardAttempt27PhysicalRequestGuard(target, ['服饰-10s-zh']);
    guard.enterCase('服饰-10s-zh');
    await guard.create(request('generate-drafts', 0), { timeoutMs: 1_000 });
    await guard.create(request('repair-draft-format', 0), { timeoutMs: 1_000 });
    await guard.create(request('generate-drafts', 1), { timeoutMs: 1_000 });
    await expect(guard.create(request('repair-draft-format', 1), { timeoutMs: 1_000 }))
      .rejects.toMatchObject({ code: 'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED' });
    await guard.create(request('generate-drafts', 2), { timeoutMs: 1_000 });
    guard.beginAttempt27FormatRecoveryProbe(1);
    await expect(guard.create(
      request('repair-draft-format', 0),
      { timeoutMs: 1_000 },
    )).rejects.toMatchObject({ code: 'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED' });
    await guard.create(request('repair-draft-format', 1), { timeoutMs: 1_000 });
    await expect(guard.create(
      request('repair-draft-format', 1),
      { timeoutMs: 1_000 },
    )).rejects.toMatchObject({ code: 'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED' });

    expect(target.create).toHaveBeenCalledTimes(5);
    expect(guard.snapshot()).toEqual({
      globalCount: 5,
      caseCounts: { '服饰-10s-zh': 5 },
      operationCounts: {
        'generate-drafts': 3,
        'repair-draft-format': 2,
        'repair-draft-content': 0,
      },
      caseOperationCounts: {
        '服饰-10s-zh': {
          'generate-drafts': 3,
          'repair-draft-format': 2,
          'repair-draft-content': 0,
        },
      },
      casePlanContentRepairCounts: { '服饰-10s-zh': [0, 0, 0] },
    });
  });

  it('Attempt27 自然阶段拒绝无首稿来源的格式修复和所有内容修复', async () => {
    const target = delegate();
    const guard = createPromptWizardAttempt27PhysicalRequestGuard(target, ['家居-15s-zh']);
    guard.enterCase('家居-15s-zh');
    await expect(guard.create(
      request('repair-draft-format', 0),
      { timeoutMs: 1_000 },
    )).rejects.toMatchObject({ code: 'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED' });
    await expect(guard.create(
      request('repair-draft-content', 0),
      { timeoutMs: 1_000 },
    )).rejects.toMatchObject({ code: 'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED' });
    expect(target.create).not.toHaveBeenCalled();
  });

  it('Attempt27 无自然异常时三批仍精确为12次物理请求', async () => {
    const caseIds = ['服饰-10s-zh', '耳机-15s-en', '美妆-10s-ja'];
    const target = delegate();
    const guard = createPromptWizardAttempt27PhysicalRequestGuard(target, caseIds);

    for (const caseId of caseIds) {
      guard.enterCase(caseId);
      await Promise.all([0, 1, 2].map(planIndex => guard.create(
        request('generate-drafts', planIndex as 0 | 1 | 2),
        { timeoutMs: 1_000 },
      )));
      guard.beginAttempt27FormatRecoveryProbe(0);
      await guard.create(request('repair-draft-format', 0), { timeoutMs: 1_000 });
      guard.leaveCase(caseId);
    }

    expect(target.create).toHaveBeenCalledTimes(12);
    expect(guard.snapshot()).toMatchObject({
      globalCount: 12,
      operationCounts: {
        'generate-drafts': 9,
        'repair-draft-format': 3,
        'repair-draft-content': 0,
      },
    });
  });

  it('Attempt27 一次自然恢复加三次固定探针可到13次，第二次自然恢复在委托前拒绝', async () => {
    const caseIds = ['服饰-10s-zh', '耳机-15s-en', '美妆-10s-ja'];
    const target = delegate();
    const guard = createPromptWizardAttempt27PhysicalRequestGuard(target, caseIds);

    for (const [caseIndex, caseId] of caseIds.entries()) {
      guard.enterCase(caseId);
      for (const planIndex of [0, 1, 2] as const) {
        await guard.create(request('generate-drafts', planIndex), { timeoutMs: 1_000 });
        if (caseIndex === 0 && planIndex === 2) {
          await guard.create(request('repair-draft-format', planIndex), { timeoutMs: 1_000 });
        }
        if (caseIndex === 1 && planIndex === 1) {
          await expect(guard.create(request('repair-draft-format', planIndex), {
            timeoutMs: 1_000,
          })).rejects.toMatchObject({
            code: 'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED',
          });
        }
      }
      guard.beginAttempt27FormatRecoveryProbe(0);
      await guard.create(request('repair-draft-format', 0), { timeoutMs: 1_000 });
      guard.leaveCase(caseId);
    }

    expect(target.create).toHaveBeenCalledTimes(
      PROMPT_WIZARD_ATTEMPT27_GLOBAL_PHYSICAL_REQUEST_LIMIT,
    );
    expect(guard.snapshot()).toMatchObject({
      globalCount: 13,
      operationCounts: {
        'generate-drafts': 9,
        'repair-draft-format': 4,
        'repair-draft-content': 0,
      },
      caseCounts: {
        '服饰-10s-zh': 5,
        '耳机-15s-en': 4,
        '美妆-10s-ja': 4,
      },
    });
  });

  it('Attempt28 允许每方案两次，并在委托前阻止第三次内容修复', async () => {
    const target = delegate();
    const guard = createPromptWizardAttempt28PhysicalRequestGuard(target, ['批次']);
    guard.enterCase('批次');
    for (const planIndex of [0, 1, 2] as const) {
      await guard.create(request('generate-drafts', planIndex), { timeoutMs: 1_000 });
    }
    await guard.create(request('repair-draft-content', 0), { timeoutMs: 1_000 });
    await guard.create(request('repair-draft-content', 0), { timeoutMs: 1_000 });
    await expect(guard.create(
      request('repair-draft-content', 0),
      { timeoutMs: 1_000 },
    )).rejects.toMatchObject({ code: 'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED' });
    expect(target.create).toHaveBeenCalledTimes(5);
    expect(guard.snapshot().caseOperationCounts['批次']).toEqual({
      'generate-drafts': 3,
      'repair-draft-format': 0,
      'repair-draft-content': 2,
    });
  });

  it('Attempt28 每批允许六次，并在委托前阻止第七次内容修复', async () => {
    const target = delegate();
    const guard = createPromptWizardAttempt28PhysicalRequestGuard(target, ['批次']);
    guard.enterCase('批次');
    for (const planIndex of [0, 1, 2] as const) {
      await guard.create(request('generate-drafts', planIndex), { timeoutMs: 1_000 });
      await guard.create(request('repair-draft-content', planIndex), { timeoutMs: 1_000 });
      await guard.create(request('repair-draft-content', planIndex), { timeoutMs: 1_000 });
    }
    await expect(guard.create(
      request('repair-draft-content', 0),
      { timeoutMs: 1_000 },
    )).rejects.toMatchObject({ code: 'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED' });
    expect(target.create).toHaveBeenCalledTimes(9);
    expect(guard.snapshot().casePlanContentRepairCounts['批次']).toEqual([2, 2, 2]);
  });

  it('Attempt28 同步执行每批10次和全局136次硬帽并保留 operation 快照', async () => {
    const caseIds = Array.from({ length: 15 }, (_, index) => `批次${index}`);
    const target = delegate();
    const guard = createPromptWizardAttempt28PhysicalRequestGuard(target, caseIds);
    for (const [caseIndex, caseId] of caseIds.entries()) {
      guard.enterCase(caseId);
      for (const planIndex of [0, 1, 2] as const) {
        await guard.create(request('generate-drafts', planIndex), { timeoutMs: 1_000 });
        await guard.create(request('repair-draft-content', planIndex), { timeoutMs: 1_000 });
        await guard.create(request('repair-draft-content', planIndex), { timeoutMs: 1_000 });
      }
      if (caseIndex === 0) {
        await guard.create(request('repair-draft-format', 0), { timeoutMs: 1_000 });
      }
      guard.leaveCase(caseId);
    }
    expect(target.create).toHaveBeenCalledTimes(PROMPT_WIZARD_ATTEMPT28_GLOBAL_PHYSICAL_REQUEST_LIMIT);
    expect(guard.snapshot().operationCounts).toEqual({
      'generate-drafts': 45,
      'repair-draft-format': 1,
      'repair-draft-content': 90,
    });
  });

  it('拒绝未知 schema 操作且不把它记为物理请求', async () => {
    const target = delegate();
    const guard = createPromptWizardAttempt28PhysicalRequestGuard(target, ['批次']);
    guard.enterCase('批次');
    const unknown = request('generate-drafts', 0);
    unknown.text.format.name = 'prompt_wizard_use_direction_plan_1_refine_plan';
    await expect(guard.create(unknown, { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED',
    });
    expect(target.create).not.toHaveBeenCalled();
    expect(guard.snapshot().globalCount).toBe(0);
  });
});
