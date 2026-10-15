import { describe, expect, it, vi } from 'vitest';
import {
  isRetryablePromptWizardProviderError,
  promptWizardRetryAfterMs,
  runPromptWizardProviderRequest,
  type PromptWizardRetryPolicy,
} from '../src/providers/promptWizardRetry.js';
import { createPromptWizardProviderConcurrencyController } from '../src/providers/promptWizardConcurrency.js';

const POLICY: PromptWizardRetryPolicy = {
  attemptTimeoutMs: 120_000,
  requestBudgetMs: 180_000,
  maxRetries: 1,
  baseDelayMs: 100,
  maxDelayMs: 400,
};

describe('提示词向导 Provider 有界重试', () => {
  it('500 后按指数退避重试并在第二次成功', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(providerError(500))
      .mockResolvedValueOnce('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();

    const result = await runPromptWizardProviderRequest(request, POLICY, {
      random: () => 0,
      sleep,
      onRetry,
    });

    expect(result).toEqual({ value: 'ok', attempts: 2 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, 120_000);
    expect(sleep).toHaveBeenCalledWith(75);
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      nextAttempt: 2,
      status: 500,
      errorName: 'Error',
      errorCode: null,
      providerRequestId: null,
      responseId: null,
      xTtLogId: null,
      receivedBytes: 0,
      receivedEvent: false,
      retryable: null,
      delayMs: 75,
    });
  });

  it.each([408, 429, 500, 502, 503, 504, 599])('HTTP %s 属于可重试瞬态错误', status => {
    expect(isRetryablePromptWizardProviderError(providerError(status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422, 600])('HTTP %s 不进入传输重试', status => {
    expect(isRetryablePromptWizardProviderError(providerError(status))).toBe(false);
  });

  it.each([
    Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
    Object.assign(new Error('connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
    Object.assign(new Error('connection failed'), { name: 'ConnectionError' }),
    Object.assign(new Error('wrapper'), {
      cause: Object.assign(new Error('dns retry'), { code: 'EAI_AGAIN' }),
    }),
  ])('明确的首字节前网络或连接错误会重试', error => {
    expect(isRetryablePromptWizardProviderError(error)).toBe(true);
  });

  it.each([
    Object.assign(new Error('cancelled'), { name: 'AbortError' }),
    Object.assign(new Error('cancelled'), { name: 'RequestAbortedError' }),
    Object.assign(new Error('absolute timeout'), { name: 'RequestTimeoutError' }),
    Object.assign(new Error('invalid json'), { code: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON' }),
    Object.assign(new Error('zod'), { name: 'ZodError' }),
  ])('用户中止和内容结构错误不会重试', error => {
    expect(isRetryablePromptWizardProviderError(error)).toBe(false);
  });

  it('显式 retryable=false 或已收到 SSE 内容时绝不重试', () => {
    expect(isRetryablePromptWizardProviderError(Object.assign(providerError(503), {
      retryable: false,
    }))).toBe(false);
    expect(isRetryablePromptWizardProviderError(Object.assign(new Error('partial'), {
      name: 'ConnectionError',
      retryable: true,
      receivedBytes: 16,
    }))).toBe(false);
    expect(isRetryablePromptWizardProviderError(Object.assign(new Error('event'), {
      name: 'ConnectionError',
      retryable: true,
      receivedEvent: true,
    }))).toBe(false);
  });

  it('client 明确标记的快速连接错误可以重试', () => {
    expect(isRetryablePromptWizardProviderError(Object.assign(new Error('connect'), {
      retryable: true,
      receivedBytes: 0,
      receivedEvent: false,
    }))).toBe(true);
  });

  it('支持 Retry-After-Ms、秒数和 HTTP 日期', () => {
    expect(promptWizardRetryAfterMs(providerError(429, { 'retry-after-ms': '1250' }), 0)).toBe(1_250);
    expect(promptWizardRetryAfterMs(providerError(429, { 'retry-after': '2' }), 0)).toBe(2_000);
    expect(promptWizardRetryAfterMs(
      providerError(503, { 'retry-after': 'Thu, 01 Jan 1970 00:00:05 GMT' }),
      1_000,
    )).toBe(4_000);
  });

  it('Retry-After 会突破总预算时立即停止，不继续请求', async () => {
    const request = vi.fn().mockRejectedValue(providerError(503, { 'retry-after': '2' }));
    await expect(runPromptWizardProviderRequest(request, {
      ...POLICY,
      requestBudgetMs: 61_000,
    }, {
      now: () => 0,
      sleep: vi.fn().mockResolvedValue(undefined),
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_TIMEOUT' });
    expect(request).toHaveBeenCalledOnce();
  });

  it('无论持续 5xx 还是连接错误，总尝试次数都不超过首次加一次重试', async () => {
    const request = vi.fn().mockRejectedValue(providerError(503));
    await expect(runPromptWizardProviderRequest(request, POLICY, {
      random: () => 0,
      sleep: vi.fn().mockResolvedValue(undefined),
    })).rejects.toMatchObject({ status: 503 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('拒绝绕过生产配置直接传入超过一次的传输重试', async () => {
    const request = vi.fn();
    await expect(runPromptWizardProviderRequest(request, {
      ...POLICY,
      maxRetries: 2,
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_RETRY_POLICY_INVALID' });
    expect(request).not.toHaveBeenCalled();
  });

  it('重试事件保留首次失败尝试的 response id 与 x-tt-logid', async () => {
    const onRetry = vi.fn();
    const firstError = Object.assign(providerError(429), {
      providerRequestId: 'request-first',
      responseId: 'resp_first',
      xTtLogId: 'log-first',
    });
    const request = vi.fn()
      .mockRejectedValueOnce(firstError)
      .mockResolvedValueOnce('ok');

    await runPromptWizardProviderRequest(request, POLICY, {
      random: () => 0,
      sleep: vi.fn().mockResolvedValue(undefined),
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
      providerRequestId: 'request-first',
      responseId: 'resp_first',
      xTtLogId: 'log-first',
    }));
  });

  it('共享批次截止时间会压缩最后一次尝试的 timeout', async () => {
    let nowMs = 1_000;
    const request = vi.fn(async (_attemptTimeoutMs: number) => {
      const firstAttempt = request.mock.calls.length < 2;
      nowMs += firstAttempt ? 40_000 : 100;
      if (firstAttempt) throw providerError(500);
      return 'ok';
    });
    const result = await runPromptWizardProviderRequest(request, {
      ...POLICY,
      deadlineAtMs: 121_500,
    }, {
      now: () => nowMs,
      random: () => 0,
      sleep: async delayMs => { nowMs += delayMs; },
    });

    expect(result.attempts).toBe(2);
    expect(request.mock.calls.map(call => call[0])).toEqual([120_000, 80_425]);
  });

  it('permit 排队耗尽共享预算后不执行 HTTP 尝试', async () => {
    const controller = createPromptWizardProviderConcurrencyController(1);
    const blockerGate = deferred();
    const blocker = controller.run(async () => blockerGate.promise);
    let nowMs = 0;
    const request = vi.fn().mockResolvedValue('unexpected');
    const queued = runPromptWizardProviderRequest(request, POLICY, {
      now: () => nowMs,
      runAttempt: attempt => controller.run(attempt),
    });

    await waitUntil(() => controller.snapshot().waiting === 1);
    nowMs = POLICY.requestBudgetMs + 1;
    blockerGate.resolve();

    const error = await queued.catch(cause => cause);
    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_TIMEOUT',
      retryable: false,
    });
    expect(error.providerRequestAttempted).not.toBe(true);
    expect(request).not.toHaveBeenCalled();
    await blocker;
    expect(controller.snapshot()).toEqual({ active: 0, waiting: 0, limit: 1 });
  });

  it('permit 排队时间会缩短取得 permit 后传给 HTTP 的 timeout', async () => {
    const controller = createPromptWizardProviderConcurrencyController(1);
    const blockerGate = deferred();
    const blocker = controller.run(async () => blockerGate.promise);
    let nowMs = 0;
    const request = vi.fn().mockResolvedValue('ok');
    const queued = runPromptWizardProviderRequest(request, POLICY, {
      now: () => nowMs,
      runAttempt: attempt => controller.run(attempt),
    });

    await waitUntil(() => controller.snapshot().waiting === 1);
    nowMs = 70_000;
    blockerGate.resolve();

    await expect(queued).resolves.toEqual({ value: 'ok', attempts: 1 });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(110_000);
    await blocker;
    expect(controller.snapshot()).toEqual({ active: 0, waiting: 0, limit: 1 });
  });

  it('业务修复在 permit 队列中跌破 60 秒启动预算后不会外呼', async () => {
    const controller = createPromptWizardProviderConcurrencyController(1);
    const blockerGate = deferred();
    const blocker = controller.run(async () => blockerGate.promise);
    let nowMs = 0;
    const request = vi.fn().mockResolvedValue('unexpected');
    const queuedRepair = runPromptWizardProviderRequest(request, {
      ...POLICY,
      maxRetries: 0,
      minimumAttemptBudgetMs: 60_000,
    }, {
      now: () => nowMs,
      runAttempt: attempt => controller.run(attempt),
    });

    await waitUntil(() => controller.snapshot().waiting === 1);
    nowMs = 120_001;
    blockerGate.resolve();

    await expect(queuedRepair).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_TIMEOUT',
      retryable: false,
    });
    expect(request).not.toHaveBeenCalled();
    await blocker;
    expect(controller.snapshot()).toEqual({ active: 0, waiting: 0, limit: 1 });
  });

  it('重试在 permit 队列中跌破 60 秒启动预算后不会穿透门禁', async () => {
    const controller = createPromptWizardProviderConcurrencyController(1);
    const blockerGate = deferred();
    let blocker: Promise<void> | undefined;
    let nowMs = 0;
    const request = vi.fn().mockRejectedValue(providerError(503));
    const queuedRetry = runPromptWizardProviderRequest(request, POLICY, {
      now: () => nowMs,
      random: () => 0,
      sleep: async delayMs => {
        nowMs += delayMs;
        blocker = controller.run(async () => blockerGate.promise);
      },
      runAttempt: attempt => controller.run(attempt),
    });

    await waitUntil(() => controller.snapshot().waiting === 1);
    nowMs = 120_001;
    blockerGate.resolve();

    await expect(queuedRetry).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_TIMEOUT',
      retryable: false,
    });
    expect(request).toHaveBeenCalledOnce();
    await blocker;
    expect(controller.snapshot()).toEqual({ active: 0, waiting: 0, limit: 1 });
  });
});

function providerError(status: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`provider ${status}`), {
    status,
    statusCode: status,
    headers,
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('等待提示词向导重试进入 permit 队列超时');
}
