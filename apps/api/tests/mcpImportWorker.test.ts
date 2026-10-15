import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processor: undefined as undefined | ((job: { data: { id: unknown } }) => Promise<unknown>),
  workerOptions: undefined as undefined | { concurrency: number; connection: unknown },
  listeners: new Map<string, (error: unknown) => void>(),
  activeJobs: new Set<Promise<unknown>>(),
  workerClose: vi.fn(),
  maintainMcpImports: vi.fn(),
  processMcpImport: vi.fn(),
  closeMcpImportQueue: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(
      _name: string,
      processor: (job: { data: { id: unknown } }) => Promise<unknown>,
      options: { concurrency: number; connection: unknown },
    ) {
      mocks.processor = job => {
        const running = processor(job);
        mocks.activeJobs.add(running);
        void running.then(
          () => mocks.activeJobs.delete(running),
          () => mocks.activeJobs.delete(running),
        );
        return running;
      };
      mocks.workerOptions = options;
    }

    close = mocks.workerClose;

    on(event: string, listener: (error: unknown) => void) {
      mocks.listeners.set(event, listener);
      return this;
    }
  },
}));
vi.mock('../src/config/env.js', () => ({
  env: { MCP_IMPORT_GLOBAL_CONCURRENCY: 4 },
}));
vi.mock('../src/mcp/fileImports.js', () => ({
  maintainMcpImports: mocks.maintainMcpImports,
  processMcpImport: mocks.processMcpImport,
}));
vi.mock('../src/queues/mcpImportQueue.js', () => ({
  closeMcpImportQueue: mocks.closeMcpImportQueue,
  mcpImportQueueName: 'mcp-imports',
}));
vi.mock('../src/queues/uploadQueue.js', () => ({
  getUploadQueueConnectionOptions: () => ({ host: 'test-redis' }),
}));

import { startMcpImportWorker } from '../src/worker/mcpImportWorker.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('MCP 导入 worker 超时与退出', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.processor = undefined;
    mocks.workerOptions = undefined;
    mocks.listeners.clear();
    mocks.activeJobs.clear();
    mocks.workerClose.mockReset().mockImplementation(async () => {
      await Promise.allSettled([...mocks.activeJobs]);
    });
    mocks.maintainMcpImports.mockReset().mockResolvedValue(undefined);
    mocks.processMcpImport.mockReset().mockResolvedValue(undefined);
    mocks.closeMcpImportQueue.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('为每个任务传入独立的 8 分钟超时信号，并保留全局并发限制', async () => {
    // Node 原生 AbortSignal.timeout 不使用 Vitest 假时钟；仅替换其计时来源。
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), milliseconds);
      return controller.signal;
    });
    const aborted: string[] = [];
    mocks.processMcpImport.mockImplementation((id: string, signal: AbortSignal) => (
      new Promise<void>(resolve => {
        signal.addEventListener('abort', () => {
          aborted.push(id);
          resolve();
        }, { once: true });
      })
    ));
    const runtime = startMcpImportWorker();
    const first = mocks.processor!({ data: { id: 123 } });
    const firstSignal = mocks.processMcpImport.mock.calls[0]![1] as AbortSignal;
    await vi.advanceTimersByTimeAsync(60_000);
    const second = mocks.processor!({ data: { id: 'second' } });
    const secondSignal = mocks.processMcpImport.mock.calls[1]![1] as AbortSignal;

    expect(timeout.mock.calls).toEqual([[8 * 60_000], [8 * 60_000]]);
    expect(mocks.workerOptions).toEqual({
      concurrency: 4,
      connection: { host: 'test-redis' },
    });
    expect(mocks.processMcpImport).toHaveBeenNthCalledWith(1, '123', firstSignal);
    expect(firstSignal).not.toBe(secondSignal);
    await vi.advanceTimersByTimeAsync(7 * 60_000 - 1);
    expect(firstSignal.aborted).toBe(false);
    expect(secondSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(firstSignal.reason).toMatchObject({ name: 'TimeoutError' });
    expect(secondSignal.aborted).toBe(false);
    expect(aborted).toEqual(['123']);
    await vi.advanceTimersByTimeAsync(60_000);
    await second;
    expect(aborted).toEqual(['123', 'second']);
    await runtime.stop();
  });

  it('重复 stop 只关闭一次，立即取消任务并等待任务清理及维护结束', async () => {
    const cleanup = deferred();
    const maintenance = deferred();
    const abortObserved = vi.fn();
    mocks.maintainMcpImports.mockReturnValue(maintenance.promise);
    mocks.processMcpImport.mockImplementation((_id: string, signal: AbortSignal) => {
      signal.addEventListener('abort', abortObserved, { once: true });
      return cleanup.promise;
    });
    const runtime = startMcpImportWorker();
    const job = mocks.processor!({ data: { id: 'active-import' } });
    await vi.advanceTimersByTimeAsync(0);
    const signal = mocks.processMcpImport.mock.calls[0]![1] as AbortSignal;
    const stopping = runtime.stop();
    const stopped = vi.fn();
    void stopping.then(stopped);

    expect(runtime.stop()).toBe(stopping);
    expect(signal.aborted).toBe(true);
    expect(abortObserved).toHaveBeenCalledTimes(1);
    expect(mocks.workerClose).toHaveBeenCalledTimes(1);
    expect(mocks.closeMcpImportQueue).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(mocks.maintainMcpImports).toHaveBeenCalledTimes(1);
    expect(stopped).not.toHaveBeenCalled();

    cleanup.resolve();
    await job;
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).not.toHaveBeenCalled();
    maintenance.resolve();
    await stopping;
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(mocks.workerClose).toHaveBeenCalledTimes(1);
    expect(mocks.closeMcpImportQueue).not.toHaveBeenCalled();
    await runtime.closeDependencies();
    expect(mocks.closeMcpImportQueue).toHaveBeenCalledTimes(1);
  });

  it('维护任务尚未完成时不重复启动，退出后不再启动新的维护', async () => {
    const maintenance = deferred();
    mocks.maintainMcpImports.mockReturnValueOnce(maintenance.promise);
    const runtime = startMcpImportWorker();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(mocks.maintainMcpImports).toHaveBeenCalledTimes(1);
    maintenance.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.maintainMcpImports).toHaveBeenCalledTimes(2);
    await runtime.stop();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(mocks.maintainMcpImports).toHaveBeenCalledTimes(2);
  });

  it('关闭失败仍等待维护清理，返回固定错误且日志不泄露动态内容', async () => {
    const maintenance = deferred();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.maintainMcpImports.mockReturnValue(maintenance.promise);
    mocks.workerClose.mockRejectedValue(new Error('private-storage-url'));
    const runtime = startMcpImportWorker();
    await vi.advanceTimersByTimeAsync(0);
    const stopping = runtime.stop();
    const outcome = stopping.then(() => 'resolved', error => error as Error);
    const settled = vi.fn();
    void outcome.then(settled);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    maintenance.reject(new Error('private-download-url'));
    expect(await outcome).toEqual(new Error('MCP_WORKER_SHUTDOWN_FAILED'));
    expect(consoleError).toHaveBeenCalledWith(JSON.stringify({
      event: 'mcp-maintenance-failed',
      code: 'MCP_MAINTENANCE_FAILED',
    }));
    expect(consoleError.mock.calls.flat().join('\n')).not.toContain('private-');
    expect(runtime.stop()).toBe(stopping);
    expect(mocks.workerClose).toHaveBeenCalledTimes(1);
  });
});
