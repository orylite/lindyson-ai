import { Queue } from 'bullmq';
import { getUploadQueueConnectionOptions } from './uploadQueue.js';
import { registerSafeEmitterErrorListener } from '../safeEmitterError.js';

export const mcpImportQueueName = 'mcp-file-imports';
let queue: Queue | null = null;
export function getMcpImportQueue() {
  if (!queue) {
    queue = new Queue(mcpImportQueueName, {
      connection: getUploadQueueConnectionOptions(),
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    });
    registerSafeEmitterErrorListener(queue, 'mcp-import-queue-error', 'BULLMQ_QUEUE_ERROR');
  }
  return queue;
}
export async function enqueueMcpImport(id: string, attempt: number) {
  await getMcpImportQueue().add('import', { id }, { jobId: `${id}-${attempt}` });
}
export async function closeMcpImportQueue() {
  const current = queue;
  queue = null;
  if (current) await current.close();
}
