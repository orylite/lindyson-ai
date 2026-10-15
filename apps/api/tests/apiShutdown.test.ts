import { describe, expect, it, vi } from 'vitest';
import { closeApiResources, type ApiShutdownResources } from '../src/apiShutdown.js';

function createResources() {
  const order: string[] = [];
  const close = (name: string) => vi.fn(async () => {
    order.push(name);
  });
  const resources: ApiShutdownResources = {
    closeApp: close('app'),
    closeGenerationQueue: close('generation'),
    closePromptWizardQueue: close('prompt-wizard'),
    closeUploadQueue: close('upload'),
    closeTkPromptEngineQueue: close('tk-prompt-engine'),
    closeCostReportingPool: close('cost-pool'),
    closeMainPool: close('main-pool'),
  };
  return { order, resources };
}

describe('API shutdown resources', () => {
  it('先封 HTTP admission，再关闭四个 Queue 与两个 Pool', async () => {
    const { order, resources } = createResources();

    await closeApiResources(resources);

    expect(order).toEqual([
      'app',
      'generation',
      'prompt-wizard',
      'upload',
      'tk-prompt-engine',
      'cost-pool',
      'main-pool',
    ]);
  });

  it('前项失败仍逐项尝试全部资源，最终只以固定错误 reject', async () => {
    const { order, resources } = createResources();
    vi.mocked(resources.closeApp).mockImplementation(async () => {
      order.push('app');
      throw new Error('app-close-secret');
    });
    vi.mocked(resources.closeGenerationQueue).mockImplementation(async () => {
      order.push('generation');
      throw new Error('queue-close-secret');
    });

    await expect(closeApiResources(resources)).rejects.toMatchObject({
      code: 'API_SHUTDOWN_FAILED',
      message: 'API shutdown failed',
    });
    expect(order).toEqual([
      'app',
      'generation',
      'prompt-wizard',
      'upload',
      'tk-prompt-engine',
      'cost-pool',
      'main-pool',
    ]);
  });
});
