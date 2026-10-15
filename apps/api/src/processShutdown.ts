export type ProcessShutdownFailureCode =
  | 'API_SHUTDOWN_FAILED'
  | 'GENERATION_WORKER_SHUTDOWN_FAILED'
  | 'UPLOAD_WORKER_SHUTDOWN_FAILED';

type ShutdownSignal = 'SIGINT' | 'SIGTERM';

export interface ProcessShutdownRuntime {
  onSignal(signal: ShutdownSignal, handler: () => void): void;
  exit(code: 0 | 1): void;
  logFailure(line: string): void;
  setDeadline(handler: () => void, timeoutMs: number): unknown;
  clearDeadline(handle: unknown): void;
}

export const PROCESS_SHUTDOWN_DEADLINE_MS = 55_000;

const defaultRuntime: ProcessShutdownRuntime = {
  onSignal(signal, handler) {
    process.on(signal, handler);
  },
  exit(code) {
    process.exit(code);
  },
  logFailure(line) {
    console.error(line);
  },
  setDeadline(handler, timeoutMs) {
    return setTimeout(handler, timeoutMs);
  },
  clearDeadline(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export function installProcessShutdownHandlers(
  shutdown: () => Promise<void>,
  failureCode: ProcessShutdownFailureCode,
  runtime: ProcessShutdownRuntime = defaultRuntime,
) {
  let shutdownStarted = false;
  let terminal = false;
  let deadline: unknown;

  const finish = (code: 0 | 1, event?: 'process-shutdown-failed' | 'process-shutdown-timeout') => {
    if (terminal) return;
    terminal = true;
    if (deadline !== undefined) runtime.clearDeadline(deadline);
    if (code === 1 && event) {
      try {
        runtime.logFailure(JSON.stringify({ event, errorCode: failureCode }));
      } catch {
        // 日志实现本身不能阻止失败终态退出。
      }
    }
    runtime.exit(code);
  };

  const handleSignal = () => {
    if (shutdownStarted) return;
    shutdownStarted = true;

    deadline = runtime.setDeadline(() => {
      finish(1, 'process-shutdown-timeout');
    }, PROCESS_SHUTDOWN_DEADLINE_MS);

    let shutdownResult: Promise<void>;
    try {
      // 必须在 signal handler 返回前同步启动协调器，封住继续取得新资源的窗口。
      shutdownResult = shutdown();
    } catch {
      finish(1, 'process-shutdown-failed');
      return;
    }
    void Promise.resolve(shutdownResult).then(
      () => finish(0),
      () => finish(1, 'process-shutdown-failed'),
    );
  };

  runtime.onSignal('SIGINT', handleSignal);
  runtime.onSignal('SIGTERM', handleSignal);
}
