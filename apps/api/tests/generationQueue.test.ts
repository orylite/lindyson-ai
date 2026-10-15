import { describe, expect, it, vi } from 'vitest';

const add = vi.hoisted(() => vi.fn());
vi.mock('../src/config/env.js', () => ({ env: { REDIS_URL: 'redis://localhost:6379' } }));
vi.mock('bullmq', () => ({
  Queue: vi.fn(function Queue() {
    return { add, close: vi.fn(), on: vi.fn() };
  }),
}));

import { enqueueGenerationTask } from '../src/queues/generationQueue.js';

describe('generationQueue', () => {
  it('同一业务 attempt 用 claim epoch 生成新 jobId，租约接管可真正恢复', async () => {
    add.mockClear();
    add.mockResolvedValue(undefined);
    const taskId = '11111111-1111-4111-8111-111111111111';
    await enqueueGenerationTask(taskId, 3, 7);
    await enqueueGenerationTask(taskId, 3, 8);

    expect(add).toHaveBeenNthCalledWith(
      1,
      'process-generation',
      { taskId, attempt: 3, claimEpoch: 7 },
      { jobId: `${taskId}-attempt-3-claim-7` },
    );
    expect(add).toHaveBeenNthCalledWith(
      2,
      'process-generation',
      { taskId, attempt: 3, claimEpoch: 8 },
      { jobId: `${taskId}-attempt-3-claim-8` },
    );
  });
});
