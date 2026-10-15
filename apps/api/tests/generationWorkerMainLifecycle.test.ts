import { describe, expect, it, vi } from 'vitest';
import {
  assertBalanceSyncSucceeded,
  assertBillingRequestProcessingSucceeded,
  assertScheduledBillingSyncSucceeded,
  createGenerationMaintenanceGate,
  main,
} from '../src/worker/generationWorker.js';
import {
  createTrackedSingleFlightTask,
  createWorkerLifecycleCoordinator,
} from '../src/worker/workerLifecycle.js';

describe('generation worker main lifecycle wiring', () => {
  it('首个异步步骤 pending 时 signal 阻止后续 acquisition，main 与 shutdown 均收敛', async () => {
    const lifecycle = createWorkerLifecycleCoordinator();
    const events: string[] = [];
    const acquireAfterSignal = vi.fn();
    let signalShutdown: (() => Promise<void>) | undefined;
    let resolveFirstStep: (() => void) | undefined;

    const mainPromise = main({
      lifecycle,
      installShutdown(shutdown) {
        signalShutdown = shutdown;
      },
      async start(activeLifecycle) {
        activeLifecycle.registerCleanup(() => {
          events.push('close:pool');
        });
        activeLifecycle.registerCleanup(() => {
          events.push('close:first-queue');
        });
        await activeLifecycle.runStartupStep(() => new Promise<void>(resolve => {
          resolveFirstStep = resolve;
        }));
        acquireAfterSignal();
        activeLifecycle.finishStartup();
      },
    });
    await Promise.resolve();

    const shutdownPromise = signalShutdown?.();
    resolveFirstStep?.();

    await expect(mainPromise).resolves.toBeUndefined();
    await expect(shutdownPromise).resolves.toBeUndefined();
    expect(acquireAfterSignal).not.toHaveBeenCalled();
    expect(events).toEqual(['close:first-queue', 'close:pool']);
  });

  it('upload 已取得且下一 startup step pending 时，signal 返回前已同步 stop upload', async () => {
    const lifecycle = createWorkerLifecycleCoordinator();
    const stopUpload = vi.fn(async () => undefined);
    let signalShutdown: (() => Promise<void>) | undefined;
    let resolveNextStep: (() => void) | undefined;

    const mainPromise = main({
      lifecycle,
      installShutdown(shutdown) {
        signalShutdown = shutdown;
      },
      async start(activeLifecycle) {
        activeLifecycle.acquireStopSync(() => 'upload-worker', stopUpload);
        await activeLifecycle.runStartupStep(() => new Promise<void>(resolve => {
          resolveNextStep = resolve;
        }));
        activeLifecycle.finishStartup();
      },
    });
    await Promise.resolve();

    const shutdownPromise = signalShutdown?.();
    expect(stopUpload).toHaveBeenCalledTimes(1);
    resolveNextStep?.();

    await expect(mainPromise).resolves.toBeUndefined();
    await expect(shutdownPromise).resolves.toBeUndefined();
    expect(stopUpload).toHaveBeenCalledTimes(1);
  });

  it('同步 factory 内重入 signal 时先登记已取得资源且不继续启动', async () => {
    const lifecycle = createWorkerLifecycleCoordinator();
    const events: string[] = [];
    const acquireAfterSignal = vi.fn();
    let signalShutdown: (() => Promise<void>) | undefined;
    let shutdownPromise: Promise<void> | undefined;

    const mainPromise = main({
      lifecycle,
      installShutdown(shutdown) {
        signalShutdown = shutdown;
      },
      async start(activeLifecycle) {
        activeLifecycle.acquireStopSync(
          () => {
            shutdownPromise = signalShutdown?.();
            return 'worker-a';
          },
          resource => {
            events.push(`stop:${resource}`);
          },
        );
        acquireAfterSignal();
        activeLifecycle.finishStartup();
      },
    });

    expect(events).toEqual(['stop:worker-a']);

    await expect(mainPromise).resolves.toBeUndefined();
    await expect(shutdownPromise).resolves.toBeUndefined();
    expect(acquireAfterSignal).not.toHaveBeenCalled();
    expect(events).toEqual(['stop:worker-a']);
  });

  it.each([
    [
      'scheduled billing',
      'VOLCENGINE_BILLING_SCHEDULE_FAILED',
      () => assertScheduledBillingSyncSucceeded([{ ok: false, skipped: false }]),
    ],
    [
      'balance sync',
      'VOLCENGINE_BALANCE_SYNC_FAILED',
      () => assertBalanceSyncSucceeded({ ok: false, skipped: false }),
    ],
    [
      'billing request',
      'VOLCENGINE_BILLING_REQUEST_FAILED',
      () => assertBillingRequestProcessingSucceeded({ failed: 1 }),
    ],
  ])('active %s 业务失败会使本次 shutdown reject，stop 后 runner 不新建 epoch', async (
    _name,
    errorCode,
    fail,
  ) => {
    const lifecycle = createWorkerLifecycleCoordinator();
    const gate = createGenerationMaintenanceGate(lifecycle);
    const taskBody = vi.fn(() => new Promise<void>((resolve, reject) => {
      queueMicrotask(() => {
        try {
          fail();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    }));
    const onFailure = vi.fn();
    const tracked = createTrackedSingleFlightTask(taskBody, onFailure);
    const run = gate.track(tracked);
    const active = run();
    lifecycle.finishStartup();

    const shutdown = lifecycle.requestSignalShutdown();
    await expect(run()).resolves.toBe(false);
    await expect(active).resolves.toBe(true);
    await expect(shutdown).rejects.toMatchObject({ code: 'WORKER_LIFECYCLE_SHUTDOWN_FAILED' });
    expect(taskBody).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ code: errorCode }));
  });

  it('generation maintenance 历史失败 settled 后不污染未来 clean shutdown', async () => {
    const lifecycle = createWorkerLifecycleCoordinator();
    const gate = createGenerationMaintenanceGate(lifecycle);
    const taskBody = vi.fn(async () => {
      throw Object.assign(new Error('historical-secret'), { code: 'HISTORICAL_FAILURE' });
    });
    const tracked = createTrackedSingleFlightTask(taskBody, vi.fn());
    const run = gate.track(tracked);

    await expect(run()).resolves.toBe(true);
    lifecycle.finishStartup();
    await expect(lifecycle.requestSignalShutdown()).resolves.toBeUndefined();
    expect(taskBody).toHaveBeenCalledTimes(1);
  });

  it('无 signal 的 main startup failure 在 rollback cleanup pending 时 55 秒后固定 reject', async () => {
    vi.useFakeTimers();
    try {
      const pendingCleanup = vi.fn(() => new Promise<void>(() => undefined));
      const mainPromise = main({
        installShutdown: vi.fn(),
        async start(lifecycle) {
          lifecycle.registerCleanup(pendingCleanup);
          throw new Error('startup-secret');
        },
      });
      const rejection = expect(mainPromise).rejects.toMatchObject({
        code: 'GENERATION_WORKER_STARTUP_FAILED',
      });

      await vi.advanceTimersByTimeAsync(55_000);
      await rejection;
      expect(pendingCleanup).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
