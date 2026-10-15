import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', () => ({
  env: { PROMPT_WIZARD_PROVIDER_CONCURRENCY: 30 },
}));

import {
  createPromptWizardProviderConcurrencyController,
  promptWizardProviderConcurrencyLimits,
} from '../src/providers/promptWizardConcurrency.js';

describe('提示词向导 Provider 并发限制', () => {
  it('运行时默认把方舟 HTTP/SSE 在途请求限制为 30', () => {
    expect(promptWizardProviderConcurrencyLimits.maxConcurrency).toBe(30);
  });

  it('严格限制并发上限，并按进入等待队列的顺序交接 permit', async () => {
    const controller = createPromptWizardProviderConcurrencyController(2);
    const gates = Array.from({ length: 4 }, deferred);
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const tasks = gates.map((gate, index) => controller.run(async () => {
      started.push(index);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active -= 1;
      return index;
    }));

    await waitUntil(() => started.length === 2);
    expect(started).toEqual([0, 1]);
    expect(controller.snapshot()).toEqual({ active: 2, waiting: 2, limit: 2 });

    gates[1]!.resolve();
    await waitUntil(() => started.length === 3);
    expect(started).toEqual([0, 1, 2]);
    expect(controller.snapshot()).toEqual({ active: 2, waiting: 1, limit: 2 });

    gates[0]!.resolve();
    await waitUntil(() => started.length === 4);
    expect(started).toEqual([0, 1, 2, 3]);

    gates[2]!.resolve();
    gates[3]!.resolve();
    await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2, 3]);
    expect(maxActive).toBe(2);
    expect(controller.snapshot()).toEqual({ active: 0, waiting: 0, limit: 2 });
  });

  it('任务异常时释放 permit，并让队首等待任务继续执行', async () => {
    const controller = createPromptWizardProviderConcurrencyController(1);
    const firstGate = deferred();
    const started: string[] = [];

    const failedTask = controller.run(async () => {
      started.push('failed');
      await firstGate.promise;
      throw new Error('provider failed');
    });
    const recoveredTask = controller.run(async () => {
      started.push('recovered');
      return 'ok';
    });

    await waitUntil(() => controller.snapshot().waiting === 1);
    expect(started).toEqual(['failed']);
    firstGate.resolve();

    await expect(failedTask).rejects.toThrow('provider failed');
    await expect(recoveredTask).resolves.toBe('ok');
    expect(started).toEqual(['failed', 'recovered']);
    expect(controller.snapshot()).toEqual({ active: 0, waiting: 0, limit: 1 });
  });
});

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
  throw new Error('等待提示词向导并发任务进入目标状态超时');
}
