import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { maintainMcpImports, processMcpImport } from '../mcp/fileImports.js';
import { closeMcpImportQueue, mcpImportQueueName } from '../queues/mcpImportQueue.js';
import { getUploadQueueConnectionOptions } from '../queues/uploadQueue.js';
import {
  createTrackedSingleFlightTask,
  registerSafeWorkerErrorListener,
} from './workerLifecycle.js';

export function startMcpImportWorker() {
  const shutdown = new AbortController();
  const worker = new Worker(
    mcpImportQueueName,
    (job) =>
      processMcpImport(
        String(job.data.id),
        AbortSignal.any([shutdown.signal, AbortSignal.timeout(8 * 60_000)]),
      ),
    {
      connection: getUploadQueueConnectionOptions(),
      concurrency: env.MCP_IMPORT_GLOBAL_CONCURRENCY,
    },
  );
  registerSafeWorkerErrorListener(worker, 'mcp-import-worker-error');
  const maintenance = createTrackedSingleFlightTask(maintainMcpImports, () => {
    console.error(
      JSON.stringify({ event: 'mcp-maintenance-failed', code: 'MCP_MAINTENANCE_FAILED' }),
    );
  });
  void maintenance.run();
  const timer = setInterval(() => {
    void maintenance.run();
  }, 30_000);
  timer.unref();
  let stopped: Promise<void> | undefined;
  return {
    stop() {
      if (!stopped) {
        clearInterval(timer);
        shutdown.abort();
        stopped = (async () => {
          const results = await Promise.allSettled([worker.close(), maintenance.waitForCurrent()]);
          if (
            results.some((result) => result.status === 'rejected') ||
            (results[1]!.status === 'fulfilled' && results[1]!.value)
          )
            throw new Error('MCP_WORKER_SHUTDOWN_FAILED');
        })();
      }
      return stopped;
    },
    closeDependencies: closeMcpImportQueue,
  };
}
