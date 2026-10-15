import { Worker } from 'bullmq';
import { pathToFileURL } from 'node:url';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { enqueueRecoverableUploadSessions, processUploadSession } from '../domain/uploadSessionService.js';
import { processObjectDeletionOutbox, sweepExpiredUploadSessions } from '../domain/assetDeletionService.js';
import { sweepOrphanThumbnailTempDirectories } from '../domain/thumbnailTempStorage.js';
import { closeUploadQueue, getUploadQueueConnectionOptions, uploadQueueName } from '../queues/uploadQueue.js';
import { installProcessShutdownHandlers } from '../processShutdown.js';
import { createTrackedSingleFlightTask, registerSafeWorkerErrorListener } from './workerLifecycle.js';

export function startUploadWorker(options: { manageProcessSignals?: boolean; manageMaintenance?: boolean } = {}) {
  const worker = new Worker(
    uploadQueueName,
    async job => processUploadSession(String(job.data.sessionId)),
    { connection: getUploadQueueConnectionOptions(), concurrency: 3 },
  );
  registerSafeWorkerErrorListener(worker, 'upload-worker-error');

  let closing = false;
  const maintenanceTask = createTrackedSingleFlightTask(
    async () => {
      const results = await Promise.allSettled([
        enqueueRecoverableUploadSessions(100),
        sweepExpiredUploadSessions(100),
        processObjectDeletionOutbox(20),
      ]);
      if (results.some(result => result.status === 'rejected')) {
        throw Object.assign(new Error('Upload maintenance task failed'), {
          code: 'UPLOAD_MAINTENANCE_TASK_FAILED',
        });
      }
    },
    error => {
      console.error(JSON.stringify({
        event: 'upload-maintenance-failed',
        errorCode: safeWorkerErrorCode(error),
      }));
    },
  );

  const thumbnailTask = createTrackedSingleFlightTask(
    async () => {
      const result = await sweepOrphanThumbnailTempDirectories();
      if (result.scanned > 0 || result.removed > 0) {
        console.log(`缩略图临时目录扫描：${JSON.stringify(result)}`);
      }
    },
    error => {
      console.error(JSON.stringify({
        event: 'thumbnail-temp-sweep-failed',
        errorCode: safeWorkerErrorCode(error),
      }));
    },
  );

  const runMaintenance = () => {
    if (!closing) void maintenanceTask.run();
  };
  const sweepThumbnailTemp = () => {
    if (!closing) void thumbnailTask.run();
  };

  const maintenanceEnabled = options.manageMaintenance !== false;
  const maintenance = maintenanceEnabled ? setInterval(runMaintenance, 30_000) : null;
  maintenance?.unref();
  if (maintenanceEnabled) sweepThumbnailTemp();
  const thumbnailTempSweep = maintenanceEnabled
    ? setInterval(sweepThumbnailTemp, env.THUMBNAIL_SWEEP_INTERVAL_MS)
    : null;
  thumbnailTempSweep?.unref();

  let stopPromise: Promise<void> | null = null;
  const stop = () => {
    if (stopPromise) return stopPromise;
    closing = true;
    if (maintenance) clearInterval(maintenance);
    if (thumbnailTempSweep) clearInterval(thumbnailTempSweep);
    let workerCloseFailed = false;
    let workerClosePromise: Promise<void>;
    try {
      // BullMQ close() 在调用时即切入 closing，必须先封 admission，再等待其他在途任务。
      workerClosePromise = worker.close();
    } catch {
      workerCloseFailed = true;
      workerClosePromise = Promise.resolve();
    }
    stopPromise = (async () => {
      const results = await Promise.allSettled([
        workerClosePromise,
        maintenanceTask.waitForCurrent(),
        thumbnailTask.waitForCurrent(),
      ]);
      const failed = workerCloseFailed
        || results.some(result => result.status === 'rejected')
        || results.slice(1).some(result => result.status === 'fulfilled' && result.value);
      if (failed) {
        throw Object.assign(new Error('Upload worker stop failed'), {
          code: 'UPLOAD_WORKER_SHUTDOWN_FAILED',
        });
      }
    })();
    return stopPromise;
  };

  let dependenciesPromise: Promise<void> | null = null;
  const closeDependencies = () => {
    if (dependenciesPromise) return dependenciesPromise;
    dependenciesPromise = (async () => {
      let failed = false;
      const cleanups = [
        () => closeUploadQueue(),
        ...(options.manageProcessSignals === false ? [] : [() => pool.end()]),
      ];
      for (const cleanup of cleanups) {
        try {
          await cleanup();
        } catch {
          failed = true;
        }
      }
      if (failed) {
        throw Object.assign(new Error('Upload worker dependency shutdown failed'), {
          code: 'UPLOAD_WORKER_SHUTDOWN_FAILED',
        });
      }
    })();
    return dependenciesPromise;
  };

  let closePromise: Promise<void> | null = null;
  const close = () => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      let failed = false;
      try {
        await stop();
      } catch {
        failed = true;
      }
      try {
        await closeDependencies();
      } catch {
        failed = true;
      }
      if (failed) {
        throw Object.assign(new Error('Upload worker shutdown failed'), {
          code: 'UPLOAD_WORKER_SHUTDOWN_FAILED',
        });
      }
    })();
    return closePromise;
  };
  if (options.manageProcessSignals !== false) {
    installProcessShutdownHandlers(close, 'UPLOAD_WORKER_SHUTDOWN_FAILED');
  }
  return { worker, stop, closeDependencies, close };
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectExecution) startUploadWorker();

function safeWorkerErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(code)) return code;
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z0-9_.-]{1,100}$/.test(name) ? name : 'UNKNOWN';
}
