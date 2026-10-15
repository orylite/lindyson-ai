import { env } from '../config/env.js';

interface PermitWaiter {
  resolve: () => void;
}

/**
 * 限制单个进程内同时进行的提示词 Provider 请求数。
 * permit 覆盖完整 HTTP/SSE 生命周期，并按先进先出顺序交给等待请求。
 */
export function createPromptWizardProviderConcurrencyController(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('提示词 Provider 并发数必须是正整数');
  }

  let active = 0;
  const waiters: PermitWaiter[] = [];

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquirePermit();
      try {
        return await task();
      } finally {
        releasePermit();
      }
    },
    snapshot() {
      return { active, waiting: waiters.length, limit };
    },
  };

  async function acquirePermit() {
    if (active < limit) {
      active += 1;
      return;
    }
    await new Promise<void>(resolve => waiters.push({ resolve }));
  }

  function releasePermit() {
    const next = waiters.shift();
    if (next) {
      // permit 直接交给队首等待者，active 保持不变，避免被后来请求抢占。
      next.resolve();
      return;
    }
    active -= 1;
  }
}

const providerConcurrency = createPromptWizardProviderConcurrencyController(
  env.PROMPT_WIZARD_PROVIDER_CONCURRENCY,
);

export function withPromptWizardProviderConcurrency<T>(task: () => Promise<T>) {
  return providerConcurrency.run(task);
}

export const promptWizardProviderConcurrencyLimits = {
  maxConcurrency: env.PROMPT_WIZARD_PROVIDER_CONCURRENCY,
} as const;
