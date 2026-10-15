import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analysis: vi.fn(),
  strategy: vi.fn(),
  option: vi.fn(),
  recover: vi.fn(),
  enqueueAnalysis: vi.fn(),
  enqueueStrategy: vi.fn(),
  enqueueOption: vi.fn(),
  expireProviderRequests: vi.fn(),
  expireActive: vi.fn(),
  purgeExpired: vi.fn(),
}));

vi.mock('../src/domain/tkPromptEngineService.js', () => ({
  TK_PROMPT_STALE_CLAIM_AFTER_MS: 20 * 60_000,
  processTkPromptAnalysis: mocks.analysis,
  processTkPromptStrategy: mocks.strategy,
  processTkPromptOption: mocks.option,
  recoverTkPromptEngineWork: mocks.recover,
}));
vi.mock('../src/queues/tkPromptEngineQueue.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/queues/tkPromptEngineQueue.js')>();
  return {
    ...actual,
    enqueueTkPromptAnalysis: mocks.enqueueAnalysis,
    enqueueTkPromptStrategy: mocks.enqueueStrategy,
    enqueueTkPromptOption: mocks.enqueueOption,
  };
});
vi.mock('../src/domain/tkPromptEngineRepository.js', () => ({
  tkPromptEngineRepository: {
    expireStartedProviderRequests: mocks.expireProviderRequests,
    expireActive: mocks.expireActive,
    purgeExpired: mocks.purgeExpired,
  },
}));

import {
  enqueueRecoverableTkPromptEngineJobs,
  processTkPromptEngineQueueJob,
  runTkPromptEngineMaintenance,
} from '../src/worker/tkPromptEngineWorker.js';
import { tkPromptEngineQueueName } from '../src/queues/tkPromptEngineQueue.js';

const ids = {
  run: '00000000-0000-4000-8000-000000000911',
  generation: '00000000-0000-4000-8000-000000000912',
  options: [
    '00000000-0000-4000-8000-000000000913',
    '00000000-0000-4000-8000-000000000914',
    '00000000-0000-4000-8000-000000000915',
  ],
};

describe('TK Prompt Engine 1→1→3 队列编排', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.analysis.mockResolvedValue(true);
    mocks.strategy.mockResolvedValue(ids.options);
    mocks.option.mockResolvedValue(true);
    mocks.enqueueAnalysis.mockResolvedValue(undefined);
    mocks.enqueueStrategy.mockResolvedValue(undefined);
    mocks.enqueueOption.mockResolvedValue(undefined);
    mocks.expireProviderRequests.mockResolvedValue(0);
    mocks.expireActive.mockResolvedValue({ generations: 0, runs: 0 });
    mocks.purgeExpired.mockResolvedValue({ generations: 0, runs: 0 });
  });

  it('使用精确队列名，并由 strategy 结果并行投递三个 option 实体 ID', async () => {
    expect(tkPromptEngineQueueName).toBe('tk-prompt-engine-tasks-v1');
    await processTkPromptEngineQueueJob({ kind: 'analysis', runId: ids.run, attempt: 1 });
    await processTkPromptEngineQueueJob({
      kind: 'strategy',
      generationId: ids.generation,
      attempt: 2,
    });
    await processTkPromptEngineQueueJob({ kind: 'option', optionId: ids.options[0], attempt: 3 });
    expect(mocks.analysis).toHaveBeenCalledWith(ids.run, 1, {});
    expect(mocks.strategy).toHaveBeenCalledWith(ids.generation, 2, {});
    expect(mocks.option).toHaveBeenCalledWith(ids.options[0], 3, {});
    expect(mocks.enqueueOption.mock.calls).toEqual(ids.options.map(id => [id, 1]));
  });

  it('恢复只按 repository 返回的实体与 attempt 重新投递', async () => {
    mocks.recover.mockResolvedValue({
      runs: [{ id: ids.run, attempt: 2 }],
      generations: [{ id: ids.generation, attempt: 3 }],
      options: [{ id: ids.options[0], attempt: 2 }],
    });
    await expect(enqueueRecoverableTkPromptEngineJobs()).resolves.toEqual({
      runs: 1,
      generations: 1,
      options: 1,
    });
    expect(mocks.enqueueAnalysis).toHaveBeenCalledWith(ids.run, 2);
    expect(mocks.enqueueStrategy).toHaveBeenCalledWith(ids.generation, 3);
    expect(mocks.enqueueOption).toHaveBeenCalledWith(ids.options[0], 2);
  });

  it('部分投递失败后不丢状态，下一轮从 repository 重新投递同一 attempt', async () => {
    const recoverable = {
      runs: [{ id: ids.run, attempt: 2 }],
      generations: [{ id: ids.generation, attempt: 3 }],
      options: [{ id: ids.options[0], attempt: 2 }],
    };
    mocks.recover.mockResolvedValue(recoverable);
    mocks.enqueueStrategy.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(enqueueRecoverableTkPromptEngineJobs()).rejects.toThrow('redis unavailable');
    await expect(enqueueRecoverableTkPromptEngineJobs()).resolves.toEqual({
      runs: 1,
      generations: 1,
      options: 1,
    });
    expect(mocks.recover).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueAnalysis).toHaveBeenNthCalledWith(2, ids.run, 2);
    expect(mocks.enqueueStrategy).toHaveBeenNthCalledWith(2, ids.generation, 3);
    expect(mocks.enqueueOption).toHaveBeenNthCalledWith(2, ids.options[0], 2);
  });

  it('周期维护先终态化超预算 started 账本，再处理 TTL 并恢复队列', async () => {
    mocks.expireProviderRequests.mockResolvedValue(2);
    mocks.expireActive.mockResolvedValue({ generations: 1, runs: 1 });
    mocks.purgeExpired.mockResolvedValue({ generations: 3, runs: 4 });
    mocks.recover.mockResolvedValue({ runs: [], generations: [], options: [] });

    const maintenanceStartedAt = Date.now();
    await expect(runTkPromptEngineMaintenance()).resolves.toEqual({
      providerRequests: 2,
      expired: { generations: 1, runs: 1 },
      purged: { generations: 3, runs: 4 },
      recovered: { runs: 0, generations: 0, options: 0 },
    });
    expect(mocks.expireProviderRequests).toHaveBeenCalledWith(expect.any(Date), 100);
    const staleBefore = mocks.expireProviderRequests.mock.calls[0]?.[0] as Date;
    const staleAgeMs = maintenanceStartedAt - staleBefore.getTime();
    expect(staleAgeMs).toBeGreaterThanOrEqual(20 * 60_000 - 100);
    expect(staleAgeMs).toBeGreaterThan(180_000);
    expect(mocks.expireActive).toHaveBeenCalledWith(100);
    expect(mocks.purgeExpired).toHaveBeenCalledWith(100);
  });
});
