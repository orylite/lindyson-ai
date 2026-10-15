import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (error: unknown) => void>(),
  workerClose: vi.fn(),
  enqueueRecoverableUploadSessions: vi.fn(),
  processUploadSession: vi.fn(),
  processObjectDeletionOutbox: vi.fn(),
  sweepExpiredUploadSessions: vi.fn(),
  sweepOrphanThumbnailTempDirectories: vi.fn(),
  closeUploadQueue: vi.fn(),
  poolEnd: vi.fn(),
  installProcessShutdownHandlers: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Worker: class {
    close = mocks.workerClose;

    on(event: string, listener: (error: unknown) => void) {
      mocks.listeners.set(event, listener);
      return this;
    }
  },
}));
vi.mock('../src/config/env.js', () => ({
  env: { THUMBNAIL_SWEEP_INTERVAL_MS: 60_000 },
}));
vi.mock('../src/db/pool.js', () => ({
  pool: { end: mocks.poolEnd },
}));
vi.mock('../src/domain/uploadSessionService.js', () => ({
  enqueueRecoverableUploadSessions: mocks.enqueueRecoverableUploadSessions,
  processUploadSession: mocks.processUploadSession,
}));
vi.mock('../src/domain/assetDeletionService.js', () => ({
  processObjectDeletionOutbox: mocks.processObjectDeletionOutbox,
  sweepExpiredUploadSessions: mocks.sweepExpiredUploadSessions,
}));
vi.mock('../src/domain/thumbnailTempStorage.js', () => ({
  sweepOrphanThumbnailTempDirectories: mocks.sweepOrphanThumbnailTempDirectories,
}));
vi.mock('../src/queues/uploadQueue.js', () => ({
  closeUploadQueue: mocks.closeUploadQueue,
  getUploadQueueConnectionOptions: vi.fn(() => ({})),
  uploadQueueName: 'upload-sessions',
}));
vi.mock('../src/processShutdown.js', () => ({
  installProcessShutdownHandlers: mocks.installProcessShutdownHandlers,
}));

import { startUploadWorker } from '../src/worker/uploadWorker.js';

describe('upload worker lifecycle', () => {
  beforeEach(() => {
    mocks.listeners.clear();
    mocks.workerClose.mockReset().mockResolvedValue(undefined);
    mocks.enqueueRecoverableUploadSessions.mockReset().mockResolvedValue(0);
    mocks.processUploadSession.mockReset().mockResolvedValue(undefined);
    mocks.processObjectDeletionOutbox.mockReset().mockResolvedValue({ scanned: 0 });
    mocks.sweepExpiredUploadSessions.mockReset().mockResolvedValue({ scanned: 0 });
    mocks.sweepOrphanThumbnailTempDirectories.mockReset().mockResolvedValue({ scanned: 0, removed: 0 });
    mocks.closeUploadQueue.mockReset().mockResolvedValue(undefined);
    mocks.poolEnd.mockReset().mockResolvedValue(undefined);
    mocks.installProcessShutdownHandlers.mockReset();
  });

  it('manageMaintenance=false 不启动任何 maintenance，仍注册安全 error listener', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const runtime = startUploadWorker({ manageProcessSignals: false, manageMaintenance: false });
      await Promise.resolve();

      expect(mocks.enqueueRecoverableUploadSessions).not.toHaveBeenCalled();
      expect(mocks.sweepExpiredUploadSessions).not.toHaveBeenCalled();
      expect(mocks.processObjectDeletionOutbox).not.toHaveBeenCalled();
      expect(mocks.sweepOrphanThumbnailTempDirectories).not.toHaveBeenCalled();
      expect(mocks.listeners.has('error')).toBe(true);
      mocks.listeners.get('error')?.(new Error('dynamic-secret-must-not-leak'));
      expect(consoleError).toHaveBeenCalledWith(JSON.stringify({
        event: 'upload-worker-error',
        errorCode: 'BULLMQ_WORKER_ERROR',
      }));
      expect(consoleError.mock.calls.flat().join('\n')).not.toContain('dynamic-secret-must-not-leak');

      await runtime.close();
      expect(mocks.workerClose).toHaveBeenCalledTimes(1);
      expect(mocks.closeUploadQueue).toHaveBeenCalledTimes(1);
      expect(mocks.poolEnd).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('close 先等待已开始的 thumbnail sweep，再关闭资源', async () => {
    let resolveSweep: ((value: { scanned: number; removed: number }) => void) | undefined;
    mocks.sweepOrphanThumbnailTempDirectories.mockReturnValue(new Promise(resolve => {
      resolveSweep = resolve;
    }));
    const runtime = startUploadWorker({ manageProcessSignals: false });
    await vi.waitFor(() => expect(mocks.sweepOrphanThumbnailTempDirectories).toHaveBeenCalledTimes(1));

    const closing = runtime.close();
    expect(mocks.workerClose).toHaveBeenCalledTimes(1);
    expect(mocks.closeUploadQueue).not.toHaveBeenCalled();

    resolveSweep?.({ scanned: 0, removed: 0 });
    await closing;
    expect(mocks.workerClose).toHaveBeenCalledTimes(1);
    expect(mocks.closeUploadQueue).toHaveBeenCalledTimes(1);
  });

  it('admission stop 不提前关闭 Queue，dependency closer 可在主 drain 后单独执行', async () => {
    const runtime = startUploadWorker({ manageProcessSignals: false, manageMaintenance: false });

    const stopping = runtime.stop();
    expect(mocks.workerClose).toHaveBeenCalledTimes(1);
    expect(mocks.closeUploadQueue).not.toHaveBeenCalled();
    await stopping;

    await runtime.closeDependencies();
    expect(mocks.closeUploadQueue).toHaveBeenCalledTimes(1);
    expect(mocks.poolEnd).not.toHaveBeenCalled();
  });

  it('历史 maintenance 失败 fully settled 后，未来无在途任务的 clean stop 成功', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mocks.sweepOrphanThumbnailTempDirectories.mockRejectedValue(new Error('thumbnail-secret'));
      const runtime = startUploadWorker({ manageProcessSignals: false });
      await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(
        'thumbnail-temp-sweep-failed',
      )));
      await Promise.resolve();

      await expect(runtime.stop()).resolves.toBeUndefined();
      await expect(runtime.closeDependencies()).resolves.toBeUndefined();
      expect(mocks.workerClose).toHaveBeenCalledTimes(1);
      expect(mocks.closeUploadQueue).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('资源关闭失败仍逐项尽力关闭，最终以固定错误 reject', async () => {
    mocks.workerClose.mockRejectedValue(new Error('worker-close-secret'));
    mocks.closeUploadQueue.mockRejectedValue(new Error('queue-close-secret'));
    const runtime = startUploadWorker({ manageMaintenance: false });

    await expect(runtime.close()).rejects.toMatchObject({
      code: 'UPLOAD_WORKER_SHUTDOWN_FAILED',
    });
    expect(mocks.workerClose).toHaveBeenCalledTimes(1);
    expect(mocks.closeUploadQueue).toHaveBeenCalledTimes(1);
    expect(mocks.poolEnd).toHaveBeenCalledTimes(1);
  });

  it('maintenance 某分支失败后仍等待其余已开始分支再关闭资源', async () => {
    vi.useFakeTimers();
    try {
      let resolveExpiry: ((value: { scanned: number }) => void) | undefined;
      mocks.enqueueRecoverableUploadSessions.mockRejectedValue(new Error('maintenance-secret'));
      mocks.sweepExpiredUploadSessions.mockReturnValue(new Promise(resolve => {
        resolveExpiry = resolve;
      }));
      const runtime = startUploadWorker({ manageProcessSignals: false });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(mocks.enqueueRecoverableUploadSessions).toHaveBeenCalledTimes(1);
      expect(mocks.sweepExpiredUploadSessions).toHaveBeenCalledTimes(1);
      expect(mocks.processObjectDeletionOutbox).toHaveBeenCalledTimes(1);
      const closing = runtime.close();
      expect(mocks.workerClose).toHaveBeenCalledTimes(1);
      expect(mocks.closeUploadQueue).not.toHaveBeenCalled();

      resolveExpiry?.({ scanned: 1 });
      await expect(closing).rejects.toMatchObject({
        code: 'UPLOAD_WORKER_SHUTDOWN_FAILED',
      });
      expect(mocks.workerClose).toHaveBeenCalledTimes(1);
      expect(mocks.closeUploadQueue).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
