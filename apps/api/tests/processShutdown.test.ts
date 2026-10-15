import { describe, expect, it, vi } from 'vitest';
import {
  installProcessShutdownHandlers,
  PROCESS_SHUTDOWN_DEADLINE_MS,
  type ProcessShutdownFailureCode,
  type ProcessShutdownRuntime,
} from '../src/processShutdown.js';

function createRuntime() {
  const handlers: Partial<Record<'SIGINT' | 'SIGTERM', () => void>> = {};
  const exit = vi.fn<(code: 0 | 1) => void>();
  const logFailure = vi.fn<(line: string) => void>();
  const setDeadline = vi.fn((handler: () => void, timeoutMs: number) => setTimeout(handler, timeoutMs));
  const clearDeadline = vi.fn((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const runtime: ProcessShutdownRuntime = {
    onSignal(signal, handler) {
      handlers[signal] = handler;
    },
    exit,
    logFailure,
    setDeadline,
    clearDeadline,
  };
  return { handlers, exit, logFailure, setDeadline, clearDeadline, runtime };
}

describe('installProcessShutdownHandlers', () => {
  it('默认运行时用持久 process.on 注册两种信号', () => {
    const processOn = vi.spyOn(process, 'on')
      .mockImplementation((() => process) as typeof process.on);
    const processOnce = vi.spyOn(process, 'once');

    try {
      installProcessShutdownHandlers(
        vi.fn(async () => undefined),
        'API_SHUTDOWN_FAILED',
      );

      expect(processOn).toHaveBeenCalledTimes(2);
      expect(processOn).toHaveBeenNthCalledWith(1, 'SIGINT', expect.any(Function));
      expect(processOn).toHaveBeenNthCalledWith(2, 'SIGTERM', expect.any(Function));
      expect(processOnce).not.toHaveBeenCalled();
    } finally {
      processOn.mockRestore();
      processOnce.mockRestore();
    }
  });

  it('成功关闭后只退出一次且固定为 0', async () => {
    let finishShutdown: (() => void) | undefined;
    const shutdown = vi.fn(() => new Promise<void>(resolve => {
      finishShutdown = resolve;
    }));
    const { handlers, exit, logFailure, setDeadline, clearDeadline, runtime } = createRuntime();

    installProcessShutdownHandlers(shutdown, 'API_SHUTDOWN_FAILED', runtime);

    expect(Object.keys(handlers).sort()).toEqual(['SIGINT', 'SIGTERM']);
    handlers.SIGINT?.();
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalledTimes(1));
    handlers.SIGINT?.();
    handlers.SIGTERM?.();
    handlers.SIGINT?.();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    finishShutdown?.();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(logFailure).not.toHaveBeenCalled();
    expect(setDeadline).toHaveBeenCalledWith(expect.any(Function), PROCESS_SHUTDOWN_DEADLINE_MS);
    expect(clearDeadline).toHaveBeenCalledTimes(1);
  });

  it('signal handler 返回前已同步启动 shutdown 协调器', () => {
    const shutdown = vi.fn(async () => undefined);
    const { handlers, runtime } = createRuntime();

    installProcessShutdownHandlers(shutdown, 'API_SHUTDOWN_FAILED', runtime);
    handlers.SIGTERM?.();

    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it.each<ProcessShutdownFailureCode>([
    'API_SHUTDOWN_FAILED',
    'GENERATION_WORKER_SHUTDOWN_FAILED',
    'UPLOAD_WORKER_SHUTDOWN_FAILED',
  ])('异步关闭失败时只输出固定安全码并退出 1：%s', async failureCode => {
    const secret = 'dynamic-secret-must-not-leak';
    const shutdown = vi.fn(async () => {
      throw new Error(secret);
    });
    const { handlers, exit, logFailure, runtime } = createRuntime();

    installProcessShutdownHandlers(shutdown, failureCode, runtime);
    handlers.SIGTERM?.();
    handlers.SIGINT?.();

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(logFailure).toHaveBeenCalledTimes(1);
    expect(logFailure).toHaveBeenCalledWith(JSON.stringify({
      event: 'process-shutdown-failed',
      errorCode: failureCode,
    }));
    expect(logFailure.mock.calls.flat().join('\n')).not.toContain(secret);
  });

  it('同步关闭异常也固定退出 1', async () => {
    const shutdown = vi.fn(() => {
      throw new Error('synchronous-secret');
    });
    const { handlers, exit, logFailure, runtime } = createRuntime();

    installProcessShutdownHandlers(shutdown, 'API_SHUTDOWN_FAILED', runtime);
    handlers.SIGINT?.();

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(logFailure.mock.calls.flat().join('\n')).not.toContain('synchronous-secret');
  });

  it('关闭永久 pending 时由 55 秒 deadline 单次失败退出', async () => {
    vi.useFakeTimers();
    try {
      const shutdown = vi.fn(() => new Promise<void>(() => undefined));
      const { handlers, exit, logFailure, runtime } = createRuntime();

      installProcessShutdownHandlers(shutdown, 'GENERATION_WORKER_SHUTDOWN_FAILED', runtime);
      handlers.SIGTERM?.();
      handlers.SIGTERM?.();
      handlers.SIGINT?.();
      await Promise.resolve();

      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(PROCESS_SHUTDOWN_DEADLINE_MS);

      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
      expect(logFailure).toHaveBeenCalledWith(JSON.stringify({
        event: 'process-shutdown-timeout',
        errorCode: 'GENERATION_WORKER_SHUTDOWN_FAILED',
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('deadline 与关闭完成竞争时只有一个终态', async () => {
    let finishShutdown: (() => void) | undefined;
    const shutdown = vi.fn(() => new Promise<void>(resolve => {
      finishShutdown = resolve;
    }));
    const { handlers, exit, runtime } = createRuntime();

    installProcessShutdownHandlers(shutdown, 'API_SHUTDOWN_FAILED', runtime);
    handlers.SIGTERM?.();
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalledTimes(1));
    const deadlineHandler = vi.mocked(runtime.setDeadline).mock.calls[0]?.[0];
    deadlineHandler?.();
    finishShutdown?.();
    await Promise.resolve();

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('失败日志器抛错时仍固定退出 1', async () => {
    const shutdown = vi.fn(async () => {
      throw new Error('shutdown-secret');
    });
    const { handlers, exit, logFailure, runtime } = createRuntime();
    logFailure.mockImplementation(() => {
      throw new Error('logger-secret');
    });

    installProcessShutdownHandlers(shutdown, 'UPLOAD_WORKER_SHUTDOWN_FAILED', runtime);
    handlers.SIGINT?.();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    expect(exit).toHaveBeenCalledTimes(1);
  });
});
