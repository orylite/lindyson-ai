import { PROCESS_SHUTDOWN_DEADLINE_MS } from '../processShutdown.js';
import { registerSafeEmitterErrorListener } from '../safeEmitterError.js';

export type WorkerCleanup = () => void | Promise<void>;

interface WorkerErrorEmitter {
  on(event: 'error', listener: (error: unknown) => void): unknown;
}

export function registerSafeWorkerErrorListener(
  worker: WorkerErrorEmitter,
  event: string,
  log: (line: string) => void = line => console.error(line),
) {
  registerSafeEmitterErrorListener(worker, event, 'BULLMQ_WORKER_ERROR', log);
}

export function createTrackedSingleFlightTask<Args extends unknown[] = []>(
  task: (...args: Args) => Promise<void>,
  onFailure: (error: unknown) => void,
) {
  let current: Promise<boolean> | null = null;

  return {
    run(...args: Args) {
      if (current) return current;
      current = Promise.resolve()
        .then(() => task(...args))
        .then(
          () => false,
          error => {
            try {
              onFailure(error);
            } catch {
              // 记录失败不能改变任务跟踪器可等待、可关闭的语义。
            }
            return true;
          },
        )
        .finally(() => {
          current = null;
        });
      return current;
    },
    waitForCurrent() {
      const pending = current;
      return pending ?? Promise.resolve(false);
    },
  };
}

export class WorkerStartupStopRequestedError extends Error {
  readonly code = 'WORKER_STARTUP_STOP_REQUESTED';

  constructor() {
    super('Worker startup stop requested');
    this.name = 'WorkerStartupStopRequestedError';
  }
}

export function createWorkerLifecycleCoordinator() {
  type StopEntry = {
    stop: WorkerCleanup;
    started: boolean;
    outcome: Promise<boolean> | null;
  };
  const cleanups: WorkerCleanup[] = [];
  const stopGates: StopEntry[] = [];
  const stopScheduling: StopEntry[] = [];
  let stopRequested = false;
  let stopPhaseStarted = false;
  let signalRequested = false;
  let startupFailed = false;
  let startupSettled = false;
  let settleStartup!: () => void;
  const startupGate = new Promise<void>(resolve => {
    settleStartup = resolve;
  });
  let shutdownPromise: Promise<void> | null = null;

  const finishStartup = () => {
    if (startupSettled) return;
    startupSettled = true;
    settleStartup();
  };

  const checkpoint = () => {
    if (stopRequested) throw new WorkerStartupStopRequestedError();
  };

  const startStopEntry = (entry: StopEntry) => {
    if (entry.started) return;
    entry.started = true;
    try {
      // rejection 立即转成 fulfilled boolean，gate 未完成前也不会产生 unhandled rejection。
      entry.outcome = Promise.resolve(entry.stop()).then(
        () => false,
        () => true,
      );
    } catch {
      entry.outcome = Promise.resolve(true);
    }
  };

  const startRegisteredStops = () => {
    stopPhaseStarted = true;
    for (const entry of [...stopGates].reverse()) {
      startStopEntry(entry);
    }
    for (const entry of [...stopScheduling].reverse()) {
      startStopEntry(entry);
    }
  };

  const addStop = (entries: StopEntry[], stop: WorkerCleanup) => {
    const entry = { stop, started: false, outcome: null as Promise<boolean> | null };
    entries.push(entry);
    if (stopPhaseStarted) startStopEntry(entry);
  };

  const runCleanups = async (stopFailed: boolean) => {
    let failed = startupFailed || stopFailed;
    for (const cleanup of [...cleanups].reverse()) {
      try {
        await cleanup();
      } catch {
        failed = true;
      }
    }
    if (failed) {
      throw Object.assign(new Error('Worker lifecycle shutdown failed'), {
        code: 'WORKER_LIFECYCLE_SHUTDOWN_FAILED',
      });
    }
  };

  const ensureShutdown = () => {
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        await startupGate;
        startRegisteredStops();
        const stopResults = await Promise.all([...stopGates, ...stopScheduling].map(
          entry => entry.outcome ?? Promise.resolve(false),
        ));
        await runCleanups(stopResults.some(Boolean));
      })();
    }
    return shutdownPromise;
  };

  return {
    checkpoint,
    registerCleanup(cleanup: WorkerCleanup) {
      if (startupSettled) throw new Error('Cannot register cleanup after startup settled');
      cleanups.push(cleanup);
    },
    registerStopScheduling(stop: WorkerCleanup) {
      if (startupSettled) throw new Error('Cannot register scheduler after startup settled');
      addStop(stopScheduling, stop);
    },
    registerStopGate(stop: WorkerCleanup) {
      if (startupSettled) throw new Error('Cannot register stop gate after startup settled');
      addStop(stopGates, stop);
    },
    async acquire<T>(factory: () => Promise<T>, cleanup: (resource: T) => void | Promise<void>) {
      checkpoint();
      const resource = await factory();
      cleanups.push(() => cleanup(resource));
      checkpoint();
      return resource;
    },
    acquireSync<T>(factory: () => T, cleanup: (resource: T) => void | Promise<void>) {
      checkpoint();
      const resource = factory();
      cleanups.push(() => cleanup(resource));
      checkpoint();
      return resource;
    },
    acquireStopSync<T>(factory: () => T, stop: (resource: T) => void | Promise<void>) {
      checkpoint();
      const resource = factory();
      addStop(stopScheduling, () => stop(resource));
      checkpoint();
      return resource;
    },
    async runStartupStep<T>(step: () => Promise<T>) {
      checkpoint();
      const result = await step();
      checkpoint();
      return result;
    },
    finishStartup,
    requestSignalShutdown() {
      signalRequested = true;
      stopRequested = true;
      startRegisteredStops();
      return ensureShutdown();
    },
    async abortStartup() {
      startupFailed = true;
      stopRequested = true;
      startRegisteredStops();
      finishStartup();
      const cleanup = ensureShutdown();
      // 显式把原 cleanup 收敛为 fulfilled 分支，rollback deadline 胜出后也不会留下未处理 rejection。
      const handledCleanup = cleanup.then(
        () => ({ kind: 'cleanup' as const, failed: false }),
        () => ({ kind: 'cleanup' as const, failed: true }),
      );
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const deadlineReached = new Promise<{ kind: 'deadline' }>(resolve => {
        deadline = setTimeout(
          () => resolve({ kind: 'deadline' }),
          PROCESS_SHUTDOWN_DEADLINE_MS,
        );
      });
      const outcome = await Promise.race([handledCleanup, deadlineReached]);
      if (deadline) clearTimeout(deadline);
      if (outcome.kind === 'deadline') {
        throw Object.assign(new Error('Worker startup rollback timed out'), {
          code: 'WORKER_STARTUP_ROLLBACK_TIMEOUT',
        });
      }
      if (outcome.failed) {
        throw Object.assign(new Error('Worker lifecycle shutdown failed'), {
          code: 'WORKER_LIFECYCLE_SHUTDOWN_FAILED',
        });
      }
    },
    isGracefulStartupStop(error: unknown) {
      return signalRequested && error instanceof WorkerStartupStopRequestedError;
    },
  };
}
