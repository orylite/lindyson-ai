import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', () => ({
  env: { REDIS_URL: 'redis://test.invalid:6379' },
}));

vi.mock('bullmq', () => ({
  Queue: class {
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    on(event: string, listener: (...args: unknown[]) => void) {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
      return true;
    }

    add() {
      return Promise.resolve();
    }

    setGlobalConcurrency() {
      return Promise.resolve();
    }

    close() {
      return Promise.resolve();
    }
  },
}));

import { closeGenerationQueue, getGenerationQueue } from '../src/queues/generationQueue.js';
import { closePromptWizardQueue, getPromptWizardQueue } from '../src/queues/promptWizardQueue.js';
import { closeTkPromptEngineQueue, getTkPromptEngineQueue } from '../src/queues/tkPromptEngineQueue.js';
import { closeUploadQueue, getUploadQueue } from '../src/queues/uploadQueue.js';
import { registerSafeEmitterErrorListener } from '../src/safeEmitterError.js';

describe('singleton BullMQ Queue safe error listeners', () => {
  it('logger 自身抛错不会把 error 事件升级为未捕获异常', () => {
    let listener: ((...args: unknown[]) => void) | undefined;
    const emitter = {
      on: vi.fn((_event: 'error', next: (...args: unknown[]) => void) => {
        listener = next;
      }),
    };
    registerSafeEmitterErrorListener(emitter, 'test-emitter-error', 'FIXED_ERROR', () => {
      throw new Error('logger-secret');
    });

    expect(() => listener?.(new Error('source-secret'))).not.toThrow();
  });

  it.each([
    ['generation-queue-error', getGenerationQueue, closeGenerationQueue],
    ['prompt-wizard-queue-error', getPromptWizardQueue, closePromptWizardQueue],
    ['tk-prompt-engine-queue-error', getTkPromptEngineQueue, closeTkPromptEngineQueue],
    ['upload-queue-error', getUploadQueue, closeUploadQueue],
  ] as const)('%s 构造与 close 后重建均不泄漏原 Error', async (event, getQueue, closeQueue) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const first = getQueue();
      first.emit('error', new Error('first-dynamic-secret'));
      await closeQueue();
      const rebuilt = getQueue();
      expect(rebuilt).not.toBe(first);
      rebuilt.emit('error', new Error('rebuilt-dynamic-secret'));

      expect(consoleError).toHaveBeenCalledTimes(2);
      expect(consoleError).toHaveBeenNthCalledWith(1, JSON.stringify({
        event,
        errorCode: 'BULLMQ_QUEUE_ERROR',
      }));
      expect(consoleError).toHaveBeenNthCalledWith(2, JSON.stringify({
        event,
        errorCode: 'BULLMQ_QUEUE_ERROR',
      }));
      const output = consoleError.mock.calls.flat().join('\n');
      expect(output).not.toContain('first-dynamic-secret');
      expect(output).not.toContain('rebuilt-dynamic-secret');
      expect(output).not.toContain('Error:');
      await closeQueue();
    } finally {
      consoleError.mockRestore();
    }
  });
});
