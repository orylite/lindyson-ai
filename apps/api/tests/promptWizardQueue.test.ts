import { afterEach, describe, expect, it, vi } from 'vitest';

const queueMock = vi.hoisted(() => ({
  add: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  setGlobalConcurrency: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/config/env.js', () => ({
  env: {
    REDIS_URL: 'redis://localhost:6379',
    PROMPT_WIZARD_QUEUE_CONCURRENCY: 10,
  },
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn(function Queue() {
    return queueMock;
  }),
}));

import {
  closePromptWizardQueue,
  configurePromptWizardQueueGlobalConcurrency,
} from '../src/queues/promptWizardQueue.js';

afterEach(async () => {
  await closePromptWizardQueue();
  vi.clearAllMocks();
});

describe('提示词向导 BullMQ 全局并发', () => {
  it('默认把所有 worker 共享的全局并发上限设置为 10', async () => {
    await configurePromptWizardQueueGlobalConcurrency();

    expect(queueMock.setGlobalConcurrency).toHaveBeenCalledOnce();
    expect(queueMock.setGlobalConcurrency).toHaveBeenCalledWith(10);
  });
});
