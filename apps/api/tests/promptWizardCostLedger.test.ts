import { describe, expect, it, vi } from 'vitest';
import {
  calculatePromptWizardCostCny,
  createPromptWizardProviderRequestRecorder,
  promptWizardProviderRequestKey,
  selectPromptWizardPricingRule,
  type PromptWizardPricingRule,
} from '../src/domain/promptWizardCostLedger.js';

const BASE_RULE = {
  provider: 'volcengine-ark',
  model: 'doubao-seed-2-0-lite-260428',
  service_tier: 'default',
  price_version: 'volcengine-list-2026-07-23',
  effective_from: '2026-07-23T18:06:05+08:00',
  effective_to: null,
} as const;

const RULES: PromptWizardPricingRule[] = [
  pricingRule('low', '0-32k', 0, 32_000, 0.6, 0.12, 3.6),
  pricingRule('middle', '32k-128k', 32_001, 128_000, 0.9, 0.18, 5.4),
  pricingRule('high', '128k-256k', 128_001, 256_000, 1.8, 0.36, 10.8),
];

describe('Doubao Seed 2.0 Lite 逐请求列表价', () => {
  it.each([
    [0, 'low'],
    [32_000, 'low'],
    [32_001, 'middle'],
    [128_000, 'middle'],
    [128_001, 'high'],
    [256_000, 'high'],
  ])('输入 Token %s 独立命中正确阶梯', (inputTokens, expectedRuleId) => {
    expect(selectPromptWizardPricingRule(
      RULES,
      inputTokens,
      '2026-07-24T00:00:00+08:00',
    )?.id).toBe(expectedRuleId);
  });

  it('超出 256K 或规则生效前不猜测价格，并从官方更新时间精确生效', () => {
    expect(selectPromptWizardPricingRule(
      RULES,
      256_001,
      '2026-07-24T00:00:00+08:00',
    )).toBeNull();
    expect(selectPromptWizardPricingRule(
      RULES,
      1,
      '2026-07-23T18:06:04+08:00',
    )).toBeNull();
    expect(selectPromptWizardPricingRule(
      RULES,
      1,
      '2026-07-23T18:06:05+08:00',
    )?.id).toBe('low');
  });

  it('按普通输入、缓存命中输入和输出分别计价，最后统一舍入到六位人民币', () => {
    expect(calculatePromptWizardCostCny({
      usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 10 },
      pricingRule: RULES[0]!,
    })).toBe('0.000077');
  });

  it('价格使用 BigInt 定点计算，并在半微元边界执行 half-up', () => {
    const usage = { inputTokens: 1, cachedInputTokens: 0, outputTokens: 0 };
    expect(calculatePromptWizardCostCny({
      usage,
      pricingRule: {
        input_price_per_million_cny: '0.499999',
        cached_input_price_per_million_cny: '0.000000',
        output_price_per_million_cny: '0.000000',
      },
    })).toBe('0.000000');
    expect(calculatePromptWizardCostCny({
      usage,
      pricingRule: {
        input_price_per_million_cny: '0.500000',
        cached_input_price_per_million_cny: '0.000000',
        output_price_per_million_cny: '0.000000',
      },
    })).toBe('0.000001');
  });

  it('六位小数单价与最大安全 Token 整数计算不经过浮点数', () => {
    expect(calculatePromptWizardCostCny({
      usage: {
        inputTokens: Number.MAX_SAFE_INTEGER,
        cachedInputTokens: 0,
        outputTokens: 0,
      },
      pricingRule: {
        input_price_per_million_cny: '0.123456',
        cached_input_price_per_million_cny: '0.000000',
        output_price_per_million_cny: '0.000000',
      },
    })).toBe('1111992791.193304');
  });

  it('超过 numeric(18,6) 精度的单价拒绝隐式浮点舍入', () => {
    expect(calculatePromptWizardCostCny({
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 0 },
      pricingRule: {
        input_price_per_million_cny: '0.1234567',
        cached_input_price_per_million_cny: '0.000000',
        output_price_per_million_cny: '0.000000',
      },
    })).toBeNull();
  });

  it('缺失 Token 或缓存 Token 大于总输入时保持未知，不变成零成本', () => {
    expect(calculatePromptWizardCostCny({
      usage: { inputTokens: 100, cachedInputTokens: null, outputTokens: 10 },
      pricingRule: RULES[0]!,
    })).toBeNull();
    expect(calculatePromptWizardCostCny({
      usage: { inputTokens: 100, cachedInputTokens: 101, outputTokens: 10 },
      pricingRule: RULES[0]!,
    })).toBeNull();
  });

  it('按请求时间选择价格版本，旧版本不会被新版本覆盖', () => {
    const oldRule = {
      ...RULES[0]!,
      id: 'old-low',
      price_version: 'old',
      effective_from: '2026-04-28T00:00:00+08:00',
      effective_to: '2026-08-01T00:00:00+08:00',
    };
    const newRule = {
      ...RULES[0]!,
      id: 'new-low',
      price_version: 'new',
      effective_from: '2026-08-01T00:00:00+08:00',
    };
    expect(selectPromptWizardPricingRule(
      [oldRule, newRule],
      10,
      '2026-07-31T23:59:59+08:00',
    )?.id).toBe('old-low');
    expect(selectPromptWizardPricingRule(
      [oldRule, newRule],
      10,
      '2026-08-01T00:00:00+08:00',
    )?.id).toBe('new-low');
  });

  it('同一时点命中重叠价格版本时保持未知，不任意挑选规则', () => {
    expect(selectPromptWizardPricingRule(
      [RULES[0]!, { ...RULES[0]!, id: 'overlap-low' }],
      10,
      '2026-07-24T00:00:00+08:00',
    )).toBeNull();
  });
});

describe('提示词 Provider 请求成本账本', () => {
  it('请求键包含业务作业、修复轮次、方案和传输尝试，且不包含提示词内容', () => {
    const baseInput = {
      owner: {
        runId: 'run-safe',
        batchId: 'batch-safe',
        userId: 'user-safe',
        jobAttempt: 2,
        repairRound: 1,
      },
      operation: 'generate-drafts',
      planIndex: 1,
      transportAttempt: 2,
      model: BASE_RULE.model,
      serviceTier: 'default',
    } as const;
    const key = promptWizardProviderRequestKey(baseInput);
    expect(key).toBe(
      'batch:batch-safe:job:2:operation:generate-drafts:repair:1:plan:1:transport:2',
    );
    expect(promptWizardProviderRequestKey({
      ...baseInput,
      operation: 'repair-draft-format',
    })).toBe(
      'batch:batch-safe:job:2:operation:repair-draft-format:repair:1:plan:1:transport:2',
    );
    expect(promptWizardProviderRequestKey({
      ...baseInput,
      operation: 'repair-draft-content',
    })).toBe(
      'batch:batch-safe:job:2:operation:repair-draft-content:repair:1:plan:1:transport:2',
    );
    expect(promptWizardProviderRequestKey({
      ...baseInput,
      owner: { ...baseInput.owner, batchId: null },
      operation: 'repair-product-format',
      planIndex: null,
    })).toBe(
      'run:run-safe:job:2:operation:repair-product-format:repair:1:plan:none:transport:2',
    );
    expect(key).not.toMatch(/prompt|https|图片/u);
  });

  it('单方案格式修复必须归属于批次和具体方案', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'repair-attempt-1' }], rowCount: 1 });
    const recorder = createPromptWizardProviderRequestRecorder({ query } as never);
    const valid = {
      owner: {
        runId: '00000000-0000-4000-8000-000000000001',
        batchId: '00000000-0000-4000-8000-000000000002',
        userId: '00000000-0000-4000-8000-000000000003',
        jobAttempt: 1,
        repairRound: 0,
      },
      operation: 'repair-draft-format' as const,
      planIndex: 1,
      transportAttempt: 1,
      model: BASE_RULE.model,
      serviceTier: 'default',
    };

    await expect(recorder.beginAttempt(valid)).resolves.toBe('repair-attempt-1');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      'batch:00000000-0000-4000-8000-000000000002:job:1:operation:repair-draft-format:repair:0:plan:1:transport:1',
      'repair-draft-format',
      1,
    ]));

    await expect(recorder.beginAttempt({
      ...valid,
      owner: { ...valid.owner, batchId: null },
    })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID',
    });
    await expect(recorder.beginAttempt({
      ...valid,
      planIndex: null,
    })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('产品格式恢复只归属于 run，内容修复必须归属于批次和具体方案', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'product-format-attempt' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'draft-content-attempt' }], rowCount: 1 });
    const recorder = createPromptWizardProviderRequestRecorder({ query } as never);
    const runOwner = {
      runId: '00000000-0000-4000-8000-000000000011',
      batchId: null,
      userId: '00000000-0000-4000-8000-000000000012',
      jobAttempt: 1,
      repairRound: 1,
    };
    const productFormat = {
      owner: runOwner,
      operation: 'repair-product-format' as const,
      planIndex: null,
      transportAttempt: 1,
      model: BASE_RULE.model,
      serviceTier: 'default',
    };

    await expect(recorder.beginAttempt(productFormat)).resolves.toBe('product-format-attempt');
    await expect(recorder.beginAttempt({
      ...productFormat,
      owner: { ...runOwner, batchId: '00000000-0000-4000-8000-000000000013' },
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID' });
    await expect(recorder.beginAttempt({
      ...productFormat,
      planIndex: 0,
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID' });

    const draftContent = {
      ...productFormat,
      owner: { ...runOwner, batchId: '00000000-0000-4000-8000-000000000013' },
      operation: 'repair-draft-content' as const,
      planIndex: 1,
    };
    await expect(recorder.beginAttempt(draftContent)).resolves.toBe('draft-content-attempt');
    await expect(recorder.beginAttempt({
      ...draftContent,
      planIndex: 2,
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID' });
    await expect(recorder.beginAttempt({
      ...draftContent,
      owner: runOwner,
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID' });
    await expect(recorder.beginAttempt({
      ...draftContent,
      planIndex: null,
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID' });
    await expect(recorder.beginAttempt({
      ...draftContent,
      planIndex: 3,
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID' });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      'run:00000000-0000-4000-8000-000000000011:job:1:operation:repair-product-format:repair:1:plan:none:transport:1',
      'repair-product-format',
      null,
    ]));
    expect(query.mock.calls[1]?.[1]).toEqual(expect.arrayContaining([
      'batch:00000000-0000-4000-8000-000000000013:job:1:operation:repair-draft-content:repair:1:plan:1:transport:1',
      'repair-draft-content',
      1,
    ]));
  });

  it('V6 成本归属显式允许第三个方案，但不放宽历史边界', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'v6-plan-2-attempt' }], rowCount: 1 });
    const recorder = createPromptWizardProviderRequestRecorder({ query } as never);
    const v6Attempt = {
      owner: {
        runId: '00000000-0000-4000-8000-000000000021',
        batchId: '00000000-0000-4000-8000-000000000022',
        deliveryVersion: 6 as const,
        userId: '00000000-0000-4000-8000-000000000023',
        jobAttempt: 1,
        repairRound: 0,
      },
      operation: 'generate-drafts' as const,
      planIndex: 2,
      transportAttempt: 1,
      model: BASE_RULE.model,
      serviceTier: 'default',
    };

    await expect(recorder.beginAttempt(v6Attempt)).resolves.toBe('v6-plan-2-attempt');
    await expect(recorder.beginAttempt({
      ...v6Attempt,
      owner: { ...v6Attempt.owner, deliveryVersion: 5 },
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID' });
    await expect(recorder.beginAttempt({
      ...v6Attempt,
      planIndex: 3,
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID' });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      'batch:00000000-0000-4000-8000-000000000022:job:1:operation:generate-drafts:repair:0:plan:2:transport:1',
      'generate-drafts',
      2,
    ]));
  });

  it('V6 只允许终局内容校准使用第三轮成本身份', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'v6-terminal-voiceover-calibration' }], rowCount: 1 });
    const recorder = createPromptWizardProviderRequestRecorder({ query } as never);
    const calibration = {
      owner: {
        runId: '00000000-0000-4000-8000-000000000024',
        batchId: '00000000-0000-4000-8000-000000000025',
        deliveryVersion: 6 as const,
        userId: '00000000-0000-4000-8000-000000000026',
        jobAttempt: 1,
        repairRound: 3,
      },
      operation: 'repair-draft-content' as const,
      planIndex: 1,
      transportAttempt: 1,
      model: BASE_RULE.model,
      serviceTier: 'default',
    };

    await expect(recorder.beginAttempt(calibration))
      .resolves.toBe('v6-terminal-voiceover-calibration');
    await expect(recorder.beginAttempt({
      ...calibration,
      operation: 'repair-draft-format',
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID' });
    await expect(recorder.beginAttempt({
      ...calibration,
      owner: { ...calibration.owner, deliveryVersion: 5 },
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID' });
    await expect(recorder.beginAttempt({
      ...calibration,
      operation: 'generate-drafts',
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID' });
    await expect(recorder.beginAttempt({
      ...calibration,
      owner: { ...calibration.owner, repairRound: 4 },
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID' });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      'batch:00000000-0000-4000-8000-000000000025:job:1:operation:repair-draft-content:repair:3:plan:1:transport:1',
      'repair-draft-content',
      3,
      1,
    ]));
  });

  it('终态更新保存价格快照与缓存成本，并允许幂等重放而不覆盖', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'attempt-1' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          id: 'attempt-1',
          request_status: 'started',
          service_tier: 'default',
          started_at: '2026-07-24T00:00:00+08:00',
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: RULES, rowCount: RULES.length })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          id: 'attempt-1',
          request_status: 'succeeded',
          service_tier: 'default',
          started_at: '2026-07-24T00:00:00+08:00',
        }],
        rowCount: 1,
      });
    const recorder = createPromptWizardProviderRequestRecorder({ query } as never);
    const owner = {
      runId: '00000000-0000-4000-8000-000000000001',
      batchId: null,
      userId: '00000000-0000-4000-8000-000000000002',
      jobAttempt: 1,
      repairRound: 0,
    };
    const attemptId = await recorder.beginAttempt({
      owner,
      operation: 'analyze-product',
      planIndex: null,
      transportAttempt: 1,
      model: BASE_RULE.model,
      serviceTier: 'default',
    });
    const terminal = {
      status: 'succeeded' as const,
      serviceTier: null,
      providerRequestId: 'request-1',
      providerResponseId: 'response-1',
      xTtLogId: 'log-1',
      httpStatus: 200,
      errorCode: null,
      errorClassification: null,
      usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 10 },
    };
    await recorder.completeAttempt(attemptId, terminal);
    await recorder.completeAttempt(attemptId, terminal);

    const update = query.mock.calls.find(([sql]) => String(sql).includes('SET request_status'));
    expect(update?.[1]).toEqual(expect.arrayContaining([
      'attempt-1',
      'succeeded',
      'default',
      'request-1',
      'response-1',
      'log-1',
      200,
      'low',
      BASE_RULE.price_version,
      '0-32k',
      '0.000077',
      'known',
    ]));
    expect(query.mock.calls.filter(([sql]) => String(sql).includes('SET request_status'))).toHaveLength(1);
  });

  it('相同请求键拒绝再次开始，阻断幂等重放造成的重复付费调用', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const recorder = createPromptWizardProviderRequestRecorder({ query } as never);
    await expect(recorder.beginAttempt({
      owner: {
        runId: '00000000-0000-4000-8000-000000000001',
        batchId: null,
        userId: '00000000-0000-4000-8000-000000000002',
        jobAttempt: 1,
        repairRound: 0,
      },
      operation: 'analyze-product',
      planIndex: null,
      transportAttempt: 1,
      model: BASE_RULE.model,
      serviceTier: 'default',
    })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_LEDGER_REPLAY',
      retryable: false,
    });
  });
});

function pricingRule(
  id: string,
  pricingTier: string,
  minInputTokens: number,
  maxInputTokens: number,
  inputPrice: number,
  cachedInputPrice: number,
  outputPrice: number,
): PromptWizardPricingRule {
  return {
    id,
    ...BASE_RULE,
    pricing_tier: pricingTier,
    min_input_tokens: minInputTokens,
    max_input_tokens: maxInputTokens,
    input_price_per_million_cny: inputPrice,
    cached_input_price_per_million_cny: cachedInputPrice,
    output_price_per_million_cny: outputPrice,
  };
}
