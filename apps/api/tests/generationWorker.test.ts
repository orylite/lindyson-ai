import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  withTransaction: vi.fn(),
  cancelClaimedTaskBeforeSubmission: vi.fn(),
  markTaskProcessing: vi.fn(),
  markProviderSubmissionStarted: vi.fn(),
  markProviderSubmissionUnknown: vi.fn(),
  heartbeatGenerationTask: vi.fn(),
  isClaimedGenerationTaskCancellationRequested: vi.fn(),
  recordProviderTaskId: vi.fn(),
  recordProviderResponseCheckpoint: vi.fn(),
  clearProviderResponseUrlAfterArchive: vi.fn(),
  recordProviderUsageObservation: vi.fn(),
  markTaskProviderSucceeded: vi.fn(),
  settleTaskSuccess: vi.fn(),
  recordTaskSettlementError: vi.fn(),
  failTaskWithRefund: vi.fn(),
  finalizeRequestedTaskCancellation: vi.fn(),
  requeueExpiredGenerationTasks: vi.fn(),
  runProvider: vi.fn(),
  resumeProviderTask: vi.fn(),
  enqueueGenerationTask: vi.fn(),
  processObjectDeletionOutbox: vi.fn(),
  sweepExpiredUploadSessions: vi.fn(),
  scheduleObjectDeletion: vi.fn(),
  createUploadedImageThumbnail: vi.fn(),
  processInvoiceNotificationOutbox: vi.fn(),
  processPendingOrderRefunds: vi.fn(),
  cleanupExpiredAdminIdempotency: vi.fn(),
  collectStateMachineMonitoringSnapshot: vi.fn(),
  recoverPendingGeneratedVideoThumbnails: vi.fn(),
  runDailyAssetRetentionSweep: vi.fn(),
  runRealPortraitReconciliationMaintenance: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery, end: vi.fn() },
  withTransaction: mocks.withTransaction,
}));
vi.mock('../src/domain/assetDeletionService.js', () => ({
  processObjectDeletionOutbox: mocks.processObjectDeletionOutbox,
  scheduleObjectDeletion: mocks.scheduleObjectDeletion,
  sweepExpiredUploadSessions: mocks.sweepExpiredUploadSessions,
}));
vi.mock('../src/domain/assetRetentionService.js', () => ({
  runDailyAssetRetentionSweep: mocks.runDailyAssetRetentionSweep,
}));
vi.mock('../src/domain/uploadedVideoPreview.js', () => ({
  createUploadedImageThumbnail: mocks.createUploadedImageThumbnail,
}));
vi.mock('../src/storage/storageService.js', () => ({
  buildPublicUrl: (key: string) => `http://storage.test/${key}`,
}));
vi.mock('../src/domain/notificationOutbox.js', () => ({
  processInvoiceNotificationOutbox: mocks.processInvoiceNotificationOutbox,
}));
vi.mock('../src/domain/ordersService.js', () => ({
  processPendingOrderRefunds: mocks.processPendingOrderRefunds,
}));
vi.mock('../src/domain/adminIdempotency.js', () => ({
  cleanupExpiredAdminIdempotency: mocks.cleanupExpiredAdminIdempotency,
}));
vi.mock('../src/domain/stateMachineMonitoring.js', () => ({
  createStateMachineMonitoringSampler: vi.fn(() => mocks.collectStateMachineMonitoringSnapshot),
  createStateMachineMonitoringLogGate: vi.fn(() => vi.fn()),
  emptyStateMachineMonitoringSnapshot: vi.fn(() => monitoringSnapshot(false)),
}));
vi.mock('../src/domain/generationService.js', () => ({
  cancelClaimedTaskBeforeSubmission: mocks.cancelClaimedTaskBeforeSubmission,
  markTaskProcessing: mocks.markTaskProcessing,
  markProviderSubmissionStarted: mocks.markProviderSubmissionStarted,
  markProviderSubmissionUnknown: mocks.markProviderSubmissionUnknown,
  heartbeatGenerationTask: mocks.heartbeatGenerationTask,
  isClaimedGenerationTaskCancellationRequested: mocks.isClaimedGenerationTaskCancellationRequested,
  recordProviderTaskId: mocks.recordProviderTaskId,
  recordProviderResponseCheckpoint: mocks.recordProviderResponseCheckpoint,
  clearProviderResponseUrlAfterArchive: mocks.clearProviderResponseUrlAfterArchive,
  recordProviderUsageObservation: mocks.recordProviderUsageObservation,
  markTaskProviderSucceeded: mocks.markTaskProviderSucceeded,
  settleTaskSuccess: mocks.settleTaskSuccess,
  recordTaskSettlementError: mocks.recordTaskSettlementError,
  failTaskWithRefund: mocks.failTaskWithRefund,
  finalizeRequestedTaskCancellation: mocks.finalizeRequestedTaskCancellation,
  requeueExpiredGenerationTasks: mocks.requeueExpiredGenerationTasks,
}));
vi.mock('../src/providers/providerRegistry.js', () => ({
  runProvider: mocks.runProvider,
  resumeProviderTask: mocks.resumeProviderTask,
}));
vi.mock('../src/providers/volcengineBillingProvider.js', () => ({
  processPendingVolcengineBillingSyncRequests: vi.fn(),
  runScheduledVolcengineBillingSync: vi.fn(),
  syncVolcengineBillingBalance: vi.fn(),
}));
vi.mock('../src/queues/generationQueue.js', () => ({
  closeGenerationQueue: vi.fn(),
  enqueueGenerationTask: mocks.enqueueGenerationTask,
  generationQueueName: 'generation-tasks',
  getRedisConnectionOptions: vi.fn(() => ({})),
}));
vi.mock('../src/payments/paymentLifecycleService.js', () => ({
  sweepExpiredPaymentOrders: vi.fn(),
}));
vi.mock('../src/tools/backfillUploadedVideoThumbnails.js', () => ({
  recoverPendingGeneratedVideoThumbnails: mocks.recoverPendingGeneratedVideoThumbnails,
}));
vi.mock('../src/domain/realPortraitReconciliation.js', () => ({
  runRealPortraitReconciliationMaintenance: mocks.runRealPortraitReconciliationMaintenance,
}));

import {
  enqueuePendingTasks,
  processTask,
  reconcileGenerationTasks,
  runWorkerMaintenance,
} from '../src/worker/generationWorker.js';

describe('generationWorker', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.markTaskProcessing.mockResolvedValue({
      id: 'task-1',
      claimToken: '00000000-0000-4000-8000-000000000301',
      callbackToken: '00000000-0000-4000-8000-000000000601',
      providerTaskId: null,
      providerResult: null,
      outputObjectKey: 'generated/video/user-1/task-1/attempt-2/output.mp4',
      thumbnailObjectKey: 'generated/video/user-1/task-1/attempt-2/thumbnail.jpg',
    });
    mocks.markProviderSubmissionStarted.mockResolvedValue(true);
    mocks.markProviderSubmissionUnknown.mockResolvedValue(true);
    mocks.cancelClaimedTaskBeforeSubmission.mockResolvedValue(null);
    mocks.heartbeatGenerationTask.mockResolvedValue(true);
    mocks.isClaimedGenerationTaskCancellationRequested.mockResolvedValue(false);
    mocks.recordProviderTaskId.mockResolvedValue({ id: 'task-1' });
    mocks.recordProviderResponseCheckpoint.mockResolvedValue({ id: 'task-1' });
    mocks.clearProviderResponseUrlAfterArchive.mockResolvedValue(true);
    mocks.recordProviderUsageObservation.mockResolvedValue(true);
    mocks.markTaskProviderSucceeded.mockResolvedValue({ id: 'task-1' });
    mocks.settleTaskSuccess.mockResolvedValue({ id: 'task-1', status: 'completed' });
    mocks.recoverPendingGeneratedVideoThumbnails.mockResolvedValue({
      scanned: 0, updated: 0, skipped: 0, permanentFailed: 0, retryableFailed: 0,
    });
    mocks.withTransaction.mockImplementation(async run => run({ query: vi.fn() }));
    mocks.scheduleObjectDeletion.mockResolvedValue(undefined);
    mocks.createUploadedImageThumbnail.mockResolvedValue(
      'generated/image/user-1/task-1/attempt-2/thumbnail.webp',
    );
    mocks.failTaskWithRefund.mockResolvedValue(null);
    mocks.finalizeRequestedTaskCancellation.mockResolvedValue(null);
    mocks.enqueueGenerationTask.mockResolvedValue(undefined);
    mocks.sweepExpiredUploadSessions.mockResolvedValue({ scanned: 0 });
    mocks.processObjectDeletionOutbox.mockResolvedValue({ scanned: 0 });
    mocks.processInvoiceNotificationOutbox.mockResolvedValue({
      scanned: 0,
      completed: 0,
      skipped: 0,
      retried: 0,
      failed: 0,
    });
    mocks.processPendingOrderRefunds.mockResolvedValue({
      scanned: 0,
      completed: 0,
      retried: 0,
      failed: 0,
    });
    mocks.cleanupExpiredAdminIdempotency.mockResolvedValue(0);
    mocks.collectStateMachineMonitoringSnapshot.mockResolvedValue(monitoringSnapshot(true));
    mocks.runDailyAssetRetentionSweep.mockResolvedValue({
      businessDate: '2026-07-17', status: 'already-completed', scanned: 0, scheduled: 0,
    });
    mocks.runRealPortraitReconciliationMaintenance.mockResolvedValue({
      entitlements: { claimed: 0, completed: 0, failed: 0 },
      grace: { scanned: 0, completed: 0, failed: 0 },
      expiredSessions: { scanned: 0, expired: 0, failed: 0 },
      uploadObjects: { scanned: 0, scheduled: 0 },
      remoteDeletions: { claimed: 0, completed: 0, failed: 0 },
      capacityQueue: { scanned: 0, promoted: 0, cancelled: 0, waiting: 0 },
    });
  });

  it('外部 providerTaskId 持久化后即使供应商抛错也不得退款', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([workerTask({ provider_task_id: null })]));
    mocks.runProvider.mockImplementation(async input => {
      await input.onProviderTaskCreated('provider-task-1');
      throw new Error('轮询连接中断');
    });

    await processTask('task-1', 2);

    expect(mocks.recordProviderTaskId).toHaveBeenCalledWith(
      'task-1',
      2,
      '00000000-0000-4000-8000-000000000301',
      'provider-task-1',
    );
    expect(mocks.failTaskWithRefund).not.toHaveBeenCalled();
  });

  it('已有 providerTaskId 的任务恢复时不重新创建供应商任务', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([workerTask({ provider_task_id: 'provider-task-1' })]));
    mocks.resumeProviderTask.mockResolvedValue(null);

    await processTask('task-1', 2);

    expect(mocks.resumeProviderTask).toHaveBeenCalledWith(expect.any(Object), 'provider-task-1');
    expect(mocks.runProvider).not.toHaveBeenCalled();
    expect(mocks.failTaskWithRefund).not.toHaveBeenCalled();
  });

  it('供应商轮询通过当前 claim 读取取消请求', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([workerTask({ provider_task_id: 'provider-task-1' })]));
    mocks.isClaimedGenerationTaskCancellationRequested.mockResolvedValue(true);
    mocks.resumeProviderTask.mockImplementation(async input => {
      await expect(input.isCancellationRequested()).resolves.toBe(true);
      return null;
    });

    await processTask('task-1', 2);

    expect(mocks.isClaimedGenerationTaskCancellationRequested).toHaveBeenCalledWith(
      'task-1',
      2,
      '00000000-0000-4000-8000-000000000301',
    );
  });

  it('供应商终态回调先按真实 attempt 持久化用量', async () => {
    const observation = {
      provider: 'volcengine-ark',
      providerTaskId: 'provider-task-1',
      status: 'success',
      error: null,
      completionTokens: 605700,
      totalTokens: 700000,
      billableTokens: 605700,
      billableBasis: 'completion_tokens',
    };
    mocks.poolQuery.mockResolvedValue(queryResult([workerTask({ provider_task_id: null })]));
    mocks.runProvider.mockImplementation(async input => {
      await input.onProviderTaskCreated('provider-task-1');
      await input.onProviderUsageObserved(observation);
      return null;
    });

    await processTask('task-1', 2);

    expect(mocks.recordProviderUsageObservation).toHaveBeenCalledWith(
      'task-1',
      2,
      observation,
      '00000000-0000-4000-8000-000000000301',
    );
    expect(mocks.failTaskWithRefund).not.toHaveBeenCalled();
  });

  it('取消请求在供应商终态后先收口成本，不再进入普通成功结算', async () => {
    const providerResult = {
      ok: true,
      provider: 'volcengine-ark',
      providerTaskId: 'provider-task-1',
      objectKey: 'generated/video.mp4',
      thumbnailKey: null,
      publicUrl: null,
      thumbnailUrl: null,
      sizeBytes: 100,
      width: 720,
      height: 1280,
      durationSeconds: 5,
      rawUnits: 605700,
      deductedUnits: 606000,
      completionTokens: 605700,
      totalTokens: 606000,
      billableTokens: 605700,
      billableBasis: 'completion_tokens',
      usageUnit: 'tokens',
    } as const;
    mocks.poolQuery.mockResolvedValue(queryResult([workerTask({ provider_task_id: 'provider-task-1' })]));
    mocks.resumeProviderTask.mockResolvedValue(providerResult);
    mocks.finalizeRequestedTaskCancellation.mockResolvedValue({ id: 'task-1', status: 'canceled' });

    await processTask('task-1', 2);

    expect(mocks.finalizeRequestedTaskCancellation).toHaveBeenCalledWith(
      'task-1',
      2,
      '00000000-0000-4000-8000-000000000301',
      providerResult,
    );
    expect(mocks.markTaskProviderSucceeded).not.toHaveBeenCalled();
    expect(mocks.settleTaskSuccess).not.toHaveBeenCalled();
  });

  it('生成图片在结算前由 worker 写入稳定 WebP 缩略图', async () => {
    mocks.markTaskProcessing.mockResolvedValue({
      id: 'task-1',
      claimToken: '00000000-0000-4000-8000-000000000301',
      callbackToken: '00000000-0000-4000-8000-000000000601',
      providerTaskId: 'fake-task-1',
      providerResult: null,
      outputObjectKey: 'generated/image/user-1/task-1/attempt-2/output.png',
      thumbnailObjectKey: 'generated/image/user-1/task-1/attempt-2/thumbnail.webp',
    });
    const result = providerSuccess({ thumbnailKey: null, thumbnailUrl: null });
    mocks.poolQuery.mockResolvedValue(queryResult([workerTask({
      kind: 'image',
      provider_task_id: 'fake-task-1',
    })]));
    mocks.resumeProviderTask.mockResolvedValue(result);

    await processTask('task-1', 2);

    expect(mocks.createUploadedImageThumbnail).toHaveBeenCalledWith({
      objectKey: result.objectKey,
      thumbnailKey: 'generated/image/user-1/task-1/attempt-2/thumbnail.webp',
    });
    expect(mocks.markTaskProviderSucceeded).toHaveBeenCalledWith(
      'task-1',
      2,
      '00000000-0000-4000-8000-000000000301',
      expect.objectContaining({
        thumbnailKey: 'generated/image/user-1/task-1/attempt-2/thumbnail.webp',
        thumbnailUrl: 'http://storage.test/generated/image/user-1/task-1/attempt-2/thumbnail.webp',
      }),
    );
  });

  it('Seedream 成功响应先固化 checkpoint，再清临时 URL、生成缩略图并结算', async () => {
    mocks.markTaskProcessing.mockResolvedValue(seedreamClaim());
    mocks.poolQuery.mockResolvedValue(queryResult([seedreamWorkerTask()]));
    const checkpoint = seedreamCheckpointInput();
    const result = providerSuccess({
      provider: 'volcengine-ark',
      providerTaskId: 'seedream-sync:task-1:2',
    });
    mocks.runProvider.mockImplementation(async input => {
      await input.onProviderSubmissionStarted();
      await input.onProviderResponseCheckpoint(checkpoint);
      return result;
    });

    await processTask('task-1', 2);

    expect(mocks.recordProviderResponseCheckpoint).toHaveBeenCalledWith(
      'task-1', 2, '00000000-0000-4000-8000-000000000301', checkpoint,
    );
    expect(mocks.clearProviderResponseUrlAfterArchive).toHaveBeenCalledWith(
      'task-1', 2, '00000000-0000-4000-8000-000000000301', 'seedream-sync:task-1:2',
    );
    expect(mocks.recordProviderResponseCheckpoint.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.clearProviderResponseUrlAfterArchive.mock.invocationCallOrder[0]!);
    expect(mocks.clearProviderResponseUrlAfterArchive.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.createUploadedImageThumbnail.mock.invocationCallOrder[0]!);
    expect(mocks.createUploadedImageThumbnail.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.markTaskProviderSucceeded.mock.invocationCallOrder[0]!);
    expect(mocks.failTaskWithRefund).not.toHaveBeenCalled();
  });

  it('Seedream checkpoint 落库失败时记录安全事件并进入待核对，不退款也不继续归档', async () => {
    const providerRunId = '00000000-0000-4000-8000-000000000701';
    const checkpointError = Object.assign(
      new Error('column reference "provider_task_id" is ambiguous'),
      { code: '42702' },
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.markTaskProcessing.mockResolvedValue(seedreamClaim({ providerRunId }));
    mocks.poolQuery.mockResolvedValue(queryResult([seedreamWorkerTask()]));
    mocks.recordProviderResponseCheckpoint.mockRejectedValue(checkpointError);
    mocks.runProvider.mockImplementation(async input => {
      await input.onProviderSubmissionStarted();
      await input.onProviderResponseCheckpoint(seedreamCheckpointInput());
      return providerSuccess({
        provider: 'volcengine-ark',
        providerTaskId: 'seedream-sync:task-1:2',
      });
    });

    try {
      await processTask('task-1', 2);

      expect(mocks.runProvider).toHaveBeenCalledOnce();
      expect(mocks.recordProviderResponseCheckpoint).toHaveBeenCalledOnce();
      expect(mocks.markProviderSubmissionUnknown).toHaveBeenCalledWith(
        'task-1',
        2,
        '00000000-0000-4000-8000-000000000301',
        checkpointError,
      );
      expect(mocks.clearProviderResponseUrlAfterArchive).not.toHaveBeenCalled();
      expect(mocks.createUploadedImageThumbnail).not.toHaveBeenCalled();
      expect(mocks.markTaskProviderSucceeded).not.toHaveBeenCalled();
      expect(mocks.settleTaskSuccess).not.toHaveBeenCalled();
      expect(mocks.failTaskWithRefund).not.toHaveBeenCalled();

      const serializedEvents = errorSpy.mock.calls.map(([message]) => String(message));
      const checkpointEvent = serializedEvents.find(message => (
        message.includes('generation.provider_checkpoint_persist_failed')
      ));
      expect(checkpointEvent).toBeDefined();
      expect(JSON.parse(checkpointEvent!)).toEqual({
        event: 'generation.provider_checkpoint_persist_failed',
        taskId: 'task-1',
        providerRunId,
        phase: 'provider-response-checkpoint',
        errorCode: '42702',
      });
      expect(checkpointEvent).not.toContain('temporary.example.test');
      expect(checkpointEvent).not.toContain('生成图片');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('Seedream checkpoint 后归档失败时不退款、不标 unknown，并等待本地恢复', async () => {
    mocks.markTaskProcessing.mockResolvedValue(seedreamClaim());
    mocks.poolQuery.mockResolvedValue(queryResult([seedreamWorkerTask()]));
    mocks.runProvider.mockImplementation(async input => {
      await input.onProviderSubmissionStarted();
      await input.onProviderResponseCheckpoint(seedreamCheckpointInput());
      throw new Error('归档下载连接中断');
    });

    await processTask('task-1', 2);

    expect(mocks.recordProviderResponseCheckpoint).toHaveBeenCalledOnce();
    expect(mocks.markProviderSubmissionUnknown).not.toHaveBeenCalled();
    expect(mocks.failTaskWithRefund).not.toHaveBeenCalled();
    expect(mocks.clearProviderResponseUrlAfterArchive).not.toHaveBeenCalled();
  });

  it('已有 Seedream checkpoint 时只走 resume，不再 POST，归档后继续清 URL 和结算', async () => {
    const response = seedreamCheckpointInput();
    mocks.markTaskProcessing.mockResolvedValue(seedreamClaim({
      providerTaskId: response.providerOperationId,
      providerRequestId: response.providerRequestId,
      providerResponseCheckpoint: response.response,
      providerResponseUrl: response.responseUrl,
      providerResponseObservedAt: response.observedAt,
      providerResponseUrlExpiresAt: response.responseUrlExpiresAt,
    }));
    mocks.poolQuery.mockResolvedValue(queryResult([seedreamWorkerTask({
      provider_task_id: response.providerOperationId,
    })]));
    mocks.resumeProviderTask.mockResolvedValue(providerSuccess({
      provider: 'volcengine-ark',
      providerTaskId: response.providerOperationId,
    }));

    await processTask('task-1', 2);

    expect(mocks.runProvider).not.toHaveBeenCalled();
    expect(mocks.resumeProviderTask).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 2,
        providerRequestId: response.providerRequestId,
        providerResponseCheckpoint: response.response,
        providerResponseUrl: response.responseUrl,
      }),
      response.providerOperationId,
    );
    expect(mocks.clearProviderResponseUrlAfterArchive).toHaveBeenCalledOnce();
    expect(mocks.markTaskProviderSucceeded).toHaveBeenCalledOnce();
    expect(mocks.failTaskWithRefund).not.toHaveBeenCalled();
  });

  it('Seedream checkpoint 即使缺少 provider_task_id 也用稳定 operation ID 恢复，绝不重新 POST', async () => {
    const response = seedreamCheckpointInput();
    mocks.markTaskProcessing.mockResolvedValue(seedreamClaim({
      providerTaskId: null,
      providerRequestId: response.providerRequestId,
      providerResponseCheckpoint: response.response,
      providerResponseUrl: response.responseUrl,
      providerResponseObservedAt: response.observedAt,
      providerResponseUrlExpiresAt: response.responseUrlExpiresAt,
    }));
    mocks.poolQuery.mockResolvedValue(queryResult([seedreamWorkerTask({ provider_task_id: null })]));
    mocks.resumeProviderTask.mockResolvedValue(null);

    await processTask('task-1', 2);

    expect(mocks.resumeProviderTask).toHaveBeenCalledWith(
      expect.objectContaining({
        stagingObjectKey: 'generated-staging/image/user-1/task-1/attempt-2',
        providerResponseCheckpoint: response.response,
      }),
      'seedream-sync:task-1:2',
    );
    expect(mocks.runProvider).not.toHaveBeenCalled();
    expect(mocks.failTaskWithRefund).not.toHaveBeenCalled();
  });

  it('Seedream URL 过期等终态交付失败保留 created/unknown 证据语义并退分', async () => {
    const response = seedreamCheckpointInput();
    mocks.markTaskProcessing.mockResolvedValue(seedreamClaim({
      providerTaskId: response.providerOperationId,
      providerResponseCheckpoint: response.response,
      providerResponseUrl: response.responseUrl,
      providerResponseObservedAt: response.observedAt,
      providerResponseUrlExpiresAt: response.responseUrlExpiresAt,
    }));
    mocks.poolQuery.mockResolvedValue(queryResult([seedreamWorkerTask({
      provider_task_id: response.providerOperationId,
    })]));
    mocks.resumeProviderTask.mockResolvedValue({
      ok: false,
      provider: 'volcengine-ark',
      providerTaskId: response.providerOperationId,
      category: 'provider-failed',
      reason: 'Seedream 临时图片地址已失效',
      terminal: true,
      providerStatus: 'delivery-failed',
      billingDisposition: 'unknown',
      submissionDisposition: 'created',
      generatedImages: 1,
      outputTokens: 12,
      totalTokens: 12,
    });

    await processTask('task-1', 2);

    expect(mocks.failTaskWithRefund).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        providerStatus: 'delivery-failed',
        billingDisposition: 'unknown',
        submissionDisposition: 'created',
        generatedImages: 1,
        outputTokens: 12,
      }),
      2,
      undefined,
      '00000000-0000-4000-8000-000000000301',
    );
  });

  it('生成图片缩略图上传后 claim CAS 失败会进入删除 Outbox', async () => {
    mocks.markTaskProcessing.mockResolvedValue({
      id: 'task-1',
      claimToken: '00000000-0000-4000-8000-000000000301',
      callbackToken: '00000000-0000-4000-8000-000000000601',
      providerTaskId: 'fake-task-1',
      providerResult: null,
      outputObjectKey: 'generated/image/user-1/task-1/attempt-2/output.png',
      thumbnailObjectKey: 'generated/image/user-1/task-1/attempt-2/thumbnail.webp',
    });
    mocks.poolQuery.mockResolvedValue(queryResult([workerTask({
      kind: 'image',
      provider_task_id: 'fake-task-1',
    })]));
    mocks.resumeProviderTask.mockResolvedValue(providerSuccess({ thumbnailKey: null, thumbnailUrl: null }));
    mocks.markTaskProviderSucceeded.mockResolvedValue(null);

    await processTask('task-1', 2);

    expect(mocks.scheduleObjectDeletion).toHaveBeenCalledWith(
      expect.any(Object),
      'generated/image/user-1/task-1/attempt-2/thumbnail.webp',
      [],
      expect.any(Date),
    );
    expect(mocks.settleTaskSuccess).not.toHaveBeenCalled();
  });

  it('reconciler 为过期租约按原业务 attempt 入队', async () => {
    mocks.requeueExpiredGenerationTasks.mockResolvedValue([{
      id: 'task-stale',
      attempt: 4,
      claimEpoch: 9,
    }]);
    mocks.poolQuery.mockResolvedValue(queryResult([]));

    await expect(reconcileGenerationTasks()).resolves.toEqual({ expired: 1, queued: 0 });
    expect(mocks.enqueueGenerationTask).toHaveBeenCalledWith('task-stale', 4, 9);
  });

  it('启动扫描用数据库 claim epoch 投递，不会命中上一次已完成 job', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([{
      id: 'task-settlement-pending',
      attempt: 2,
      claim_epoch: 6,
      created_at: '2026-07-17T00:00:00.000Z',
    }]));

    await expect(enqueuePendingTasks()).resolves.toBe(1);
    expect(mocks.enqueueGenerationTask).toHaveBeenCalledWith(
      'task-settlement-pending',
      2,
      6,
    );
  });

  it('供应商 POST 已开始但响应丢失时进入 submission-unknown 且不退款', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([workerTask({ provider_task_id: null })]));
    mocks.runProvider.mockImplementation(async input => {
      await input.onProviderSubmissionStarted();
      throw new Error('POST 响应连接中断');
    });

    await processTask('task-1', 2);

    expect(mocks.markProviderSubmissionUnknown).toHaveBeenCalledWith(
      'task-1',
      2,
      '00000000-0000-4000-8000-000000000301',
      expect.any(Error),
    );
    expect(mocks.failTaskWithRefund).not.toHaveBeenCalled();
  });

  it('供应商创建接口明确拒绝且确认未计费时立即失败并退回积分', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([workerTask({ provider_task_id: null })]));
    mocks.runProvider.mockImplementation(async input => {
      await input.onProviderSubmissionStarted();
      return {
        ok: false,
        provider: 'volcengine-ark',
        category: 'provider-failed',
        reason: '参考素材不符合接口约束（HTTP 400，code=InvalidParameter）',
        submissionDisposition: 'not-created',
        providerHttpStatus: 400,
        providerErrorCode: 'InvalidParameter',
        providerStatus: 'not-created',
        billingDisposition: 'unbilled',
      };
    });

    await processTask('task-1', 2);

    expect(mocks.markProviderSubmissionUnknown).not.toHaveBeenCalled();
    expect(mocks.failTaskWithRefund).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        reason: '参考素材不符合接口约束（HTTP 400，code=InvalidParameter）',
        submissionDisposition: 'not-created',
        providerHttpStatus: 400,
        terminal: true,
        providerStatus: 'not-created',
        billingDisposition: 'unbilled',
      }),
      2,
      undefined,
      '00000000-0000-4000-8000-000000000301',
    );
  });

  it('即使标记未创建但计费结论不明确也不得自动退款', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([workerTask({ provider_task_id: null })]));
    mocks.runProvider.mockImplementation(async input => {
      await input.onProviderSubmissionStarted();
      return {
        ok: false,
        provider: 'volcengine-ark',
        category: 'provider-failed',
        reason: '供应商结论矛盾',
        submissionDisposition: 'not-created',
        billingDisposition: 'unknown',
      };
    });

    await processTask('task-1', 2);

    expect(mocks.markProviderSubmissionUnknown).toHaveBeenCalledWith(
      'task-1',
      2,
      '00000000-0000-4000-8000-000000000301',
      '供应商结论矛盾',
    );
    expect(mocks.failTaskWithRefund).not.toHaveBeenCalled();
  });

  it('供应商已返回 task id 但本地持久化失败时仍不得退款', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([workerTask({ provider_task_id: null })]));
    mocks.recordProviderTaskId.mockResolvedValue(null);
    mocks.runProvider.mockImplementation(async input => {
      await input.onProviderSubmissionStarted();
      try {
        await input.onProviderTaskCreated('provider-task-accepted');
      } catch {
        return {
          ok: false,
          provider: 'volcengine-ark',
          providerTaskId: 'provider-task-accepted',
          category: 'provider-failed',
          reason: '本地 task id 持久化失败',
        };
      }
      return null;
    });

    await processTask('task-1', 2);

    expect(mocks.markProviderSubmissionUnknown).toHaveBeenCalledWith(
      'task-1',
      2,
      '00000000-0000-4000-8000-000000000301',
      '供应商已返回 task id，但本地持久化失败',
    );
    expect(mocks.failTaskWithRefund).not.toHaveBeenCalled();
  });

  it('供应商 POST 前观察到取消请求时只走安全取消退款', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([workerTask({ provider_task_id: null })]));
    mocks.markProviderSubmissionStarted.mockResolvedValue(false);
    mocks.cancelClaimedTaskBeforeSubmission.mockResolvedValue({ id: 'task-1', status: 'canceled' });
    mocks.runProvider.mockImplementation(async input => {
      await input.onProviderSubmissionStarted();
      return null;
    });

    await processTask('task-1', 2);

    expect(mocks.cancelClaimedTaskBeforeSubmission).toHaveBeenCalled();
    expect(mocks.failTaskWithRefund).not.toHaveBeenCalled();
    expect(mocks.markProviderSubmissionUnknown).not.toHaveBeenCalled();
  });

  it('维护循环处理发票通知、待投递退款并清理过期后台幂等记录', async () => {
    mocks.requeueExpiredGenerationTasks.mockResolvedValue([]);
    mocks.poolQuery.mockResolvedValue(queryResult([]));

    await runWorkerMaintenance();

    expect(mocks.processInvoiceNotificationOutbox).toHaveBeenCalledWith(20);
    expect(mocks.processPendingOrderRefunds).toHaveBeenCalledWith(20);
    expect(mocks.runRealPortraitReconciliationMaintenance).toHaveBeenCalledOnce();
    expect(mocks.cleanupExpiredAdminIdempotency).toHaveBeenCalledWith(undefined, 500);
    expect(mocks.recoverPendingGeneratedVideoThumbnails).toHaveBeenCalledWith({ limit: 10 });
    expect(mocks.collectStateMachineMonitoringSnapshot).toHaveBeenCalledOnce();
    expect(mocks.runDailyAssetRetentionSweep).toHaveBeenCalledOnce();
  });

  it('15 秒维护入口在 engine 3 下跳过 V6 恢复与清理且不查询 071 表', async () => {
    mocks.requeueExpiredGenerationTasks.mockResolvedValue([]);
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM prompt_wizard_settings')) {
        return queryResult([{ engine_version: 3 }]);
      }
      return queryResult([]);
    });

    const result = await runWorkerMaintenance({
      recoverGeneratedVideoThumbnails: false,
      runAssetRetentionSweep: false,
    });

    expect(result.promptWizard).toEqual({
      runs: 0,
      conceptSets: 0,
      useDirectionSets: 0,
      routeSets: 0,
      batches: 0,
      planRevisions: 0,
      purged: 0,
    });
    const promptWizardSql = mocks.poolQuery.mock.calls
      .map(([sql]) => String(sql))
      .filter(sql => sql.includes('prompt_wizard'))
      .join('\n');
    expect(promptWizardSql).toContain('FROM prompt_wizard_settings');
    expect(promptWizardSql).not.toContain('prompt_wizard_route_sets');
    expect(promptWizardSql).not.toContain('UPDATE prompt_wizard');
  });

  it('启动前的首轮维护可跳过大视频缩略图恢复，避免延迟生成队列消费', async () => {
    mocks.requeueExpiredGenerationTasks.mockResolvedValue([]);
    mocks.poolQuery.mockResolvedValue(queryResult([]));

    const result = await runWorkerMaintenance({ recoverGeneratedVideoThumbnails: false });

    expect(mocks.recoverPendingGeneratedVideoThumbnails).not.toHaveBeenCalled();
    expect(result.generatedVideoThumbnails).toEqual({
      scanned: 0, updated: 0, skipped: 0, permanentFailed: 0, retryableFailed: 0,
    });
  });

  it('预启动维护可跳过历史素材扫描，避免阻塞生成队列建立', async () => {
    mocks.requeueExpiredGenerationTasks.mockResolvedValue([]);
    mocks.poolQuery.mockResolvedValue(queryResult([]));

    const result = await runWorkerMaintenance({ runAssetRetentionSweep: false });

    expect(mocks.runDailyAssetRetentionSweep).not.toHaveBeenCalled();
    expect(result.assetRetention).toEqual({
      businessDate: '', status: 'not-due', scanned: 0, scheduled: 0,
    });
  });

  it('历史素材扫描失败不阻断对象删除及其他维护步骤', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.runDailyAssetRetentionSweep.mockRejectedValue(Object.assign(new Error('database unavailable'), {
      code: 'RETENTION_SWEEP_FAILED',
    }));
    mocks.requeueExpiredGenerationTasks.mockResolvedValue([]);
    mocks.poolQuery.mockResolvedValue(queryResult([]));

    const result = await runWorkerMaintenance();

    expect(result.assetRetention).toEqual({
      businessDate: '', status: 'deferred', scanned: 0, scheduled: 0,
    });
    expect(mocks.processObjectDeletionOutbox).toHaveBeenCalledWith(20);
    expect(mocks.processInvoiceNotificationOutbox).toHaveBeenCalledWith(20);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(
      '"label":"AI 历史素材保留期扫描","errorCode":"RETENTION_SWEEP_FAILED"',
    ));
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('database unavailable');
    errorLog.mockRestore();
  });

  it('worker tracker 口径在全部维护步骤完成后聚合任一步骤异常', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mocks.runDailyAssetRetentionSweep.mockRejectedValue(Object.assign(new Error('database unavailable'), {
        code: 'RETENTION_SWEEP_FAILED',
      }));
      mocks.requeueExpiredGenerationTasks.mockResolvedValue([]);
      mocks.poolQuery.mockResolvedValue(queryResult([]));

      await expect(runWorkerMaintenance({ failOnStepError: true })).rejects.toMatchObject({
        code: 'WORKER_MAINTENANCE_STEP_FAILED',
      });
      expect(mocks.processObjectDeletionOutbox).toHaveBeenCalledWith(20);
      expect(mocks.processInvoiceNotificationOutbox).toHaveBeenCalledWith(20);
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain('database unavailable');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('生成任务恢复失败时不阻断发票通知和退款 Outbox', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.requeueExpiredGenerationTasks.mockRejectedValue(new Error('redis unavailable'));

    const result = await runWorkerMaintenance();

    expect(result.generation).toEqual({ expired: 0, queued: 0 });
    expect(mocks.processInvoiceNotificationOutbox).toHaveBeenCalledWith(20);
    expect(mocks.processPendingOrderRefunds).toHaveBeenCalledWith(20);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(
      '"event":"worker-maintenance-step-failed","label":"生成任务恢复","errorCode":"Error"',
    ));
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('redis unavailable');
    errorLog.mockRestore();
  });
});

function workerTask(overrides: Record<string, unknown>) {
  return {
    id: 'task-1', user_id: 'user-1', kind: 'video', model: 'Seedance 2.0',
    prompt: '生成视频', config: {}, credits: 10, attempt: 2,
    provider_task_id: null, provider_result: null, ...overrides,
  };
}

function providerSuccess(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    provider: 'fake-provider',
    providerTaskId: 'fake-task-1',
    objectKey: 'generated/image/user-1/task-1/attempt-2/output.png',
    thumbnailKey: null,
    publicUrl: 'http://storage.test/generated/image/user-1/task-1/attempt-2/output.png',
    thumbnailUrl: null,
    sizeBytes: 100,
    width: 1024,
    height: 1024,
    durationSeconds: null,
    rawUnits: 10,
    deductedUnits: 10,
    usageUnit: 'credits',
    ...overrides,
  } as const;
}

function seedreamClaim(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    claimToken: '00000000-0000-4000-8000-000000000301',
    callbackToken: '00000000-0000-4000-8000-000000000601',
    providerTaskId: null,
    providerResult: null,
    providerRequestId: null,
    providerResponseCheckpoint: null,
    providerResponseUrl: null,
    providerResponseObservedAt: null,
    providerResponseUrlExpiresAt: null,
    outputObjectKey: 'generated/image/user-1/task-1/attempt-2/output.png',
    thumbnailObjectKey: 'generated/image/user-1/task-1/attempt-2/thumbnail.webp',
    stagingObjectKey: 'generated-staging/image/user-1/task-1/attempt-2',
    ...overrides,
  };
}

function seedreamWorkerTask(overrides: Record<string, unknown> = {}) {
  return workerTask({
    kind: 'image',
    model: 'Seedream 5.0 Pro',
    prompt: '生成图片',
    config: {
      resolution: '1K', aspectRatio: '1:1', outputSize: '1024x1024',
      optimizePromptMode: 'standard', referenceAssets: [], annotations: [],
    },
    credits: 14,
    ...overrides,
  });
}

function seedreamCheckpointInput() {
  return {
    providerOperationId: 'seedream-sync:task-1:2',
    providerRequestId: 'seedream-logid-1',
    response: {
      version: 1,
      model: 'doubao-seedream-5-0-pro-260628',
      created: 1_785_107_200,
      size: '1024x1024',
      usage: { generatedImages: 1, outputTokens: 12, totalTokens: 12 },
    },
    responseUrl: 'https://temporary.example.test/output.png',
    observedAt: '2026-07-27T00:00:00.000Z',
    responseUrlExpiresAt: '2026-07-28T00:00:00.000Z',
  };
}

function queryResult(rows: unknown[]) {
  return { rowCount: rows.length, rows };
}

function monitoringSnapshot(available: boolean) {
  return {
    available,
    checkedAt: '2026-07-16T10:00:00.000Z',
    nonTerminal: {
      payment: { count: 0, maxAgeSeconds: null },
      refund: { count: 0, maxAgeSeconds: null },
      generation: { count: 0, maxAgeSeconds: null },
      upload: { count: 0, maxAgeSeconds: null },
    },
    expiredLeases: {
      payment: 0, refund: 0, generation: 0, upload: 0,
      objectDeletion: 0, paymentNotification: 0, total: 0,
    },
    manualReview: { payment: 0, refund: 0, generation: 0, total: 0 },
    providerIntegrity: { fieldConflicts: 0, rejectedEvents: 0, rejectedEventsLast24Hours: 0 },
    creditBalanceMismatchUsers: 0,
    uploadStagingOrphans: 0,
    assetThumbnails: { pending: 0, failed: 0 },
    objectDeletionOutbox: {
      backlog: 0,
      dueBacklog: 0,
      maxAgeSeconds: null,
      maxDueAgeSeconds: null,
    },
  };
}
