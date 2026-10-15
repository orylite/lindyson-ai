export interface ApiShutdownResources {
  closeApp(): void | Promise<void>;
  closeGenerationQueue(): void | Promise<void>;
  closePromptWizardQueue(): void | Promise<void>;
  closeUploadQueue(): void | Promise<void>;
  closeTkPromptEngineQueue(): void | Promise<void>;
  closeCostReportingPool(): void | Promise<void>;
  closeMainPool(): void | Promise<void>;
}

export async function closeApiResources(resources: ApiShutdownResources) {
  let failed = false;
  const cleanups = [
    resources.closeApp,
    resources.closeGenerationQueue,
    resources.closePromptWizardQueue,
    resources.closeUploadQueue,
    resources.closeTkPromptEngineQueue,
    resources.closeCostReportingPool,
    resources.closeMainPool,
  ];
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch {
      failed = true;
    }
  }
  if (failed) {
    throw Object.assign(new Error('API shutdown failed'), {
      code: 'API_SHUTDOWN_FAILED',
    });
  }
}
