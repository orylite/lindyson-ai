import { env } from './config/env.js';
import { costReportingPool, pool } from './db/pool.js';
import { buildApp } from './app.js';
import { closeGenerationQueue } from './queues/generationQueue.js';
import { closePromptWizardQueue } from './queues/promptWizardQueue.js';
import { closeUploadQueue } from './queues/uploadQueue.js';
import { closeTkPromptEngineQueue } from './queues/tkPromptEngineQueue.js';
import { installProcessShutdownHandlers } from './processShutdown.js';
import { closeApiResources } from './apiShutdown.js';

const app = buildApp();

const shutdown = () => closeApiResources({
  closeApp: () => app.close(),
  closeGenerationQueue,
  closePromptWizardQueue,
  closeUploadQueue,
  closeTkPromptEngineQueue,
  closeCostReportingPool: () => costReportingPool.end(),
  closeMainPool: () => pool.end(),
});

installProcessShutdownHandlers(shutdown, 'API_SHUTDOWN_FAILED');

await app.listen({ host: env.HOST, port: env.PORT });
