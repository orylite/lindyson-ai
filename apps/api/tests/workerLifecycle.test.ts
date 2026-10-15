import { describe, expect, it, vi } from 'vitest';
import {
  createTrackedSingleFlightTask,
  createWorkerLifecycleCoordinator,
  registerSafeWorkerErrorListener,
  WorkerStartupStopRequestedError,
} from '../src/worker/workerLifecycle.js';

describe('worker lifecycle helpers', () => {
  it('single-flight 复用当前 Promise 并保留失败状态', async () => {
    let resolveTask: (() => void) | undefined;
    const task = vi.fn(() => new Promise<void>(resolve => {
      resolveTask = resolve;
    }));
    const onFailure = vi.fn();
    const tracked = createTrackedSingleFlightTask(task, onFailure);

    const first = tracked.run();
    const second = tracked.run();
    expect(first).toBe(second);
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);
    resolveTask?.();
    await expect(first).resolves.toBe(false);
    await expect(tracked.waitForCurrent()).resolves.toBe(false);
  });

  it('single-flight 失败只归属于当次 run，settled 后不会污染未来关闭', async () => {
    let shouldFail = true;
    const onFailure = vi.fn();
    const tracked = createTrackedSingleFlightTask(async () => {
      if (shouldFail) throw new Error('maintenance-secret');
    }, onFailure);

    await expect(tracked.run()).resolves.toBe(true);
    expect(onFailure).toHaveBeenCalledTimes(1);
    await expect(tracked.waitForCurrent()).resolves.toBe(false);

    shouldFail = false;
    await expect(tracked.run()).resolves.toBe(false);
    await expect(tracked.waitForCurrent()).resolves.toBe(false);
  });

  it('安全 error listener 不记录动态 message 或 stack', () => {
    let listener: ((error: unknown) => void) | undefined;
    const worker = {
      on: vi.fn((_event: 'error', handler: (error: unknown) => void) => {
        listener = handler;
      }),
    };
    const log = vi.fn();
    registerSafeWorkerErrorListener(worker, 'generation-worker-error', log);

    listener?.(new Error('dynamic-secret-must-not-leak'));

    expect(worker.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(log).toHaveBeenCalledWith(JSON.stringify({
      event: 'generation-worker-error',
      errorCode: 'BULLMQ_WORKER_ERROR',
    }));
    expect(log.mock.calls.flat().join('\n')).not.toContain('dynamic-secret-must-not-leak');
    expect(log.mock.calls.flat().join('\n')).not.toContain('Error:');
  });

  it('early signal 等 acquisition 落地登记后逆序清理且不互等', async () => {
    const lifecycle = createWorkerLifecycleCoordinator();
    const events: string[] = [];
    const acquireAfterSignal = vi.fn(() => 'resource-b');
    let resolveAcquire: ((value: string) => void) | undefined;
    let startupError: unknown;
    const startup = (async () => {
      try {
        await lifecycle.acquire(
          () => new Promise<string>(resolve => {
            resolveAcquire = resolve;
          }),
          async resource => {
            events.push(`close:${resource}`);
          },
        );
        lifecycle.acquireSync(acquireAfterSignal, async resource => {
          events.push(`close:${resource}`);
        });
      } catch (error) {
        startupError = error;
        lifecycle.finishStartup();
        await lifecycle.requestSignalShutdown();
      }
    })();
    await Promise.resolve();
    const shutdown = lifecycle.requestSignalShutdown();
    resolveAcquire?.('resource-a');

    await startup;
    await expect(shutdown).resolves.toBeUndefined();
    expect(startupError).toBeInstanceOf(WorkerStartupStopRequestedError);
    expect(acquireAfterSignal).not.toHaveBeenCalled();
    expect(events).toEqual(['close:resource-a']);
  });

  it('startup 失败逆序尽力清理全部资源并固定 reject', async () => {
    const lifecycle = createWorkerLifecycleCoordinator();
    const events: string[] = [];
    lifecycle.acquireSync(() => 'a', async value => {
      events.push(`close:${value}`);
      throw new Error('cleanup-secret');
    });
    lifecycle.acquireSync(() => 'b', async value => {
      events.push(`close:${value}`);
    });
    lifecycle.registerStopScheduling(() => {
      events.push('stop:timer');
    });

    await expect(lifecycle.abortStartup()).rejects.toMatchObject({
      code: 'WORKER_LIFECYCLE_SHUTDOWN_FAILED',
    });
    expect(events).toEqual(['stop:timer', 'close:b', 'close:a']);
  });

  it('首个 admission stop pending 时仍同步触发后续 stop，全部完成后才 cleanup', async () => {
    const lifecycle = createWorkerLifecycleCoordinator();
    const events: string[] = [];
    let resolveFirstStop: (() => void) | undefined;
    lifecycle.registerCleanup(() => {
      events.push('cleanup:queue');
    });
    lifecycle.registerStopScheduling(() => {
      events.push('stop:later-registered-last-called');
    });
    lifecycle.registerStopScheduling(() => {
      events.push('stop:first-deferred');
      return new Promise<void>(resolve => {
        resolveFirstStop = resolve;
      });
    });
    lifecycle.finishStartup();

    const shutdown = lifecycle.requestSignalShutdown();
    expect(events).toEqual([
      'stop:first-deferred',
      'stop:later-registered-last-called',
    ]);
    resolveFirstStop?.();
    await shutdown;
    expect(events).toEqual([
      'stop:first-deferred',
      'stop:later-registered-last-called',
      'cleanup:queue',
    ]);
  });

  it('signal 请求后新登记的 stop 会同步执行且全程只执行一次', async () => {
    const lifecycle = createWorkerLifecycleCoordinator();
    const stop = vi.fn();

    const shutdown = lifecycle.requestSignalShutdown();
    lifecycle.registerStopScheduling(stop);
    expect(stop).toHaveBeenCalledTimes(1);

    lifecycle.finishStartup();
    await shutdown;
    lifecycle.requestSignalShutdown();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stop gate 在所有 Worker/timer stopper 之前同步执行', async () => {
    const lifecycle = createWorkerLifecycleCoordinator();
    const events: string[] = [];
    lifecycle.registerStopScheduling(() => {
      events.push('stop:worker');
    });
    lifecycle.registerStopGate(() => {
      events.push('gate:maintenance');
    });
    lifecycle.finishStartup();

    const shutdown = lifecycle.requestSignalShutdown();
    expect(events).toEqual(['gate:maintenance', 'stop:worker']);
    await shutdown;
  });

  it('无 signal 的 startup rollback cleanup 永久 pending 时由 55 秒 deadline 固定 reject', async () => {
    vi.useFakeTimers();
    try {
      const lifecycle = createWorkerLifecycleCoordinator();
      const pendingCleanup = vi.fn(() => new Promise<void>(() => undefined));
      lifecycle.registerCleanup(pendingCleanup);

      const rollback = lifecycle.abortStartup();
      const rejection = expect(rollback).rejects.toMatchObject({
        code: 'WORKER_STARTUP_ROLLBACK_TIMEOUT',
      });
      await vi.advanceTimersByTimeAsync(54_999);
      expect(pendingCleanup).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
