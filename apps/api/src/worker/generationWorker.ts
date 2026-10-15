import { Worker } from 'bullmq';
import type { QueryResult } from 'pg';
import { pathToFileURL } from 'node:url';
import { env } from '../config/env.js';
import { pool, withTransaction } from '../db/pool.js';
import { cleanupExpiredAdminIdempotency } from '../domain/adminIdempotency.js';
import { runDailyAssetRetentionSweep } from '../domain/assetRetentionService.js';
import {
  processObjectDeletionOutbox,
  scheduleObjectDeletion,
  sweepExpiredUploadSessions,
} from '../domain/assetDeletionService.js';
import {
  createStateMachineMonitoringSampler,
  createStateMachineMonitoringLogGate,
  emptyStateMachineMonitoringSnapshot,
} from '../domain/stateMachineMonitoring.js';
import {
  cancelClaimedTaskBeforeSubmission,
  clearProviderResponseUrlAfterArchive,
  failTaskWithRefund,
  finalizeRequestedTaskCancellation,
  heartbeatGenerationTask,
  isClaimedGenerationTaskCancellationRequested,
  markProviderSubmissionStarted,
  markProviderSubmissionUnknown,
  markTaskProcessing,
  markTaskProviderSucceeded,
  recordProviderResponseCheckpoint,
  recordProviderTaskId,
  recordProviderUsageObservation,
  recordTaskSettlementError,
  requeueExpiredGenerationTasks,
  settleTaskSuccess,
} from '../domain/generationService.js';
import { processInvoiceNotificationOutbox, processPaymentNotificationOutbox } from '../domain/notificationOutbox.js';
import { processPendingOrderRefunds } from '../domain/ordersService.js';
import { runProviderBillingRetentionSweep } from '../domain/providerBillingRetention.js';
import { toInt } from '../domain/serialization.js';
import type {
  ProviderResponseCheckpointInput,
  ProviderSuccess,
  ProviderUsageObservation,
} from '../domain/types.js';
import { resumeProviderTask, runProvider } from '../providers/providerRegistry.js';
import {
  processPendingVolcengineBillingSyncRequests,
  runScheduledVolcengineBillingSync,
  syncVolcengineBillingBalance,
} from '../providers/volcengineBillingProvider.js';
import {
  closeGenerationQueue,
  enqueueGenerationTask,
  generationQueueName,
  getRedisConnectionOptions,
} from '../queues/generationQueue.js';
import { sweepExpiredPaymentOrders } from '../payments/paymentLifecycleService.js';
import { enqueueRecoverableUploadSessions } from '../domain/uploadSessionService.js';
import { processDuePaymentAttempts } from '../payments/paymentAttemptService.js';
import { reconcileDueSubscriptions } from '../domain/subscriptionLifecycle.js';
import { createUploadedImageThumbnail } from '../domain/uploadedVideoPreview.js';
import { buildPublicUrl } from '../storage/storageService.js';
import { startUploadWorker } from './uploadWorker.js';
import { startMcpImportWorker } from './mcpImportWorker.js';
import { recoverPendingGeneratedVideoThumbnails } from '../tools/backfillUploadedVideoThumbnails.js';
import {
  processPromptWizardAnalysis,
  processPromptWizardBatch,
  processPromptWizardConceptSet,
  processPromptWizardPlanRefinement,
  processPromptWizardRouteSetV6,
  processPromptWizardUseDirectionSet,
  purgeExpiredPromptWizardContent,
  recoverPromptWizardJobs,
} from '../domain/promptWizardService.js';
import {
  closePromptWizardQueue,
  configurePromptWizardQueueGlobalConcurrency,
  promptWizardQueueName,
} from '../queues/promptWizardQueue.js';
import { enqueueRecoverablePromptWizardJobs } from './promptWizardRecovery.js';
import {
  enqueueRecoverableTkPromptEngineJobs,
  runTkPromptEngineMaintenance,
  startTkPromptEngineWorker,
} from './tkPromptEngineWorker.js';
import {
  closeTkPromptEngineQueue,
  configureTkPromptEngineQueueGlobalConcurrency,
} from '../queues/tkPromptEngineQueue.js';
import {
  runRealPortraitReconciliationMaintenance,
} from '../domain/realPortraitReconciliation.js';
import { installProcessShutdownHandlers } from '../processShutdown.js';
import {
  createTrackedSingleFlightTask,
  createWorkerLifecycleCoordinator,
  registerSafeWorkerErrorListener,
} from './workerLifecycle.js';

interface WorkerTaskRow {
  id: string;
  user_id: string;
  kind: 'video' | 'image';
  model: string;
  prompt: string;
  config: Record<string, unknown>;
  credits: number;
  attempt: number;
  provider_task_id: string | null;
  provider_result: ProviderSuccess | null;
}

const collectWorkerStateMachineMonitoringSnapshot = createStateMachineMonitoringSampler();

export async function enqueuePendingTasks() {
  let recovered = 0;
  let cursorCreatedAt: Date | string | null = null;
  let cursorId: string | null = null;

  while (true) {
    const pending: QueryResult<{
      id: string;
      attempt: number;
      claim_epoch: number;
      created_at: Date | string;
    }> = await pool.query(
      `SELECT id, attempt, claim_epoch, created_at
       FROM generation_tasks
       WHERE status = 'queued'
         AND (
           $1::timestamptz IS NULL
           OR (created_at, id) > ($1::timestamptz, $2::uuid)
         )
       ORDER BY created_at ASC, id ASC
       LIMIT 200`,
      [cursorCreatedAt, cursorId],
    );
    for (const task of pending.rows) {
      await enqueueGenerationTask(task.id, task.attempt, toInt(task.claim_epoch));
      recovered += 1;
    }
    if (pending.rows.length < 200) break;
    const last: { id: string; attempt: number; created_at: Date | string } = pending.rows.at(-1)!;
    cursorCreatedAt = last.created_at;
    cursorId = last.id;
  }

  return recovered;
}

export async function reconcileGenerationTasks() {
  const expired = await requeueExpiredGenerationTasks(200);
  for (const task of expired) {
    await enqueueGenerationTask(task.id, task.attempt, task.claimEpoch);
  }
  const queued = await enqueuePendingTasks();
  return { expired: expired.length, queued };
}

export async function reconcilePromptWizardTasks() {
  const recoverable = await recoverPromptWizardJobs();
  await enqueueRecoverablePromptWizardJobs(recoverable);
  const purged = await purgeExpiredPromptWizardContent();
  return {
    runs: recoverable.runs.length,
    conceptSets: recoverable.conceptSets.length,
    useDirectionSets: recoverable.useDirectionSets.length,
    routeSets: recoverable.routeSets.length,
    batches: recoverable.batches.length,
    planRevisions: recoverable.planRevisions.length,
    purged,
  };
}

export async function runWorkerMaintenance(options: {
  recoverGeneratedVideoThumbnails?: boolean;
  runAssetRetentionSweep?: boolean;
  failOnStepError?: boolean;
} = {}) {
  let stepFailed = false;
  const runStep = <T>(label: string, run: () => Promise<T>, fallback: T) => runMaintenanceStep(
    label,
    run,
    fallback,
    () => {
      stepFailed = true;
    },
  );
  const assetRetention = options.runAssetRetentionSweep === false
    ? { businessDate: '', status: 'not-due' as const, scanned: 0, scheduled: 0 }
    : await runStep(
        'AI 历史素材保留期扫描',
        () => runDailyAssetRetentionSweep(),
        { businessDate: '', status: 'deferred' as const, scanned: 0, scheduled: 0 },
      );
  const [
    generation,
    promptWizard,
    tkPromptEngine,
    recoverableUploads,
    expiredUploads,
    objectDeletions,
    invoiceNotifications,
    paymentNotifications,
    paymentAttempts,
    orderRefunds,
    realPortraitReconciliation,
    expiredAdminIdempotency,
    generatedVideoThumbnails,
    stateMachineMonitoring,
  ] = await Promise.all([
    runStep('生成任务恢复', reconcileGenerationTasks, { expired: 0, queued: 0 }),
    runStep(
      '提示词向导任务恢复',
      reconcilePromptWizardTasks,
      { runs: 0, conceptSets: 0, useDirectionSets: 0, routeSets: 0, batches: 0, planRevisions: 0, purged: 0 },
    ),
    runStep(
      'TK Prompt Engine任务恢复与TTL清理',
      runTkPromptEngineMaintenance,
      {
        providerRequests: 0,
        expired: { generations: 0, runs: 0 },
        purged: { generations: 0, runs: 0 },
        recovered: { runs: 0, generations: 0, options: 0 },
      },
    ),
    runStep('上传任务恢复', () => enqueueRecoverableUploadSessions(100), 0),
    runStep('上传会话清理', () => sweepExpiredUploadSessions(100), 0),
    runStep('对象删除 Outbox', () => processObjectDeletionOutbox(20), { completed: 0, skipped: 0, failed: 0 }),
    runStep('发票管理员通知 Outbox', () => processInvoiceNotificationOutbox(20), {
      scanned: 0,
      completed: 0,
      skipped: 0,
      retried: 0,
      failed: 0,
    }),
    runStep('支付成功通知 Outbox', () => processPaymentNotificationOutbox(20), {
      scanned: 0,
      completed: 0,
      skipped: 0,
      retried: 0,
      failed: 0,
    }),
    runStep('支付 attempt 恢复', () => processDuePaymentAttempts(20), {
      claimed: 0,
      ready: 0,
      paid: 0,
      failed: 0,
      uncertain: 0,
    }),
    runStep('订单退款投递', () => processPendingOrderRefunds(20), {
      claimed: 0,
      processed: 0,
      failed: 0,
    }),
    runStep('真人人像异步协调', runRealPortraitReconciliationMaintenance, {
      entitlements: { claimed: 0, completed: 0, failed: 0 },
      grace: { scanned: 0, completed: 0, failed: 0 },
      expiredSessions: { scanned: 0, expired: 0, failed: 0 },
      uploadObjects: { scanned: 0, scheduled: 0 },
      remoteDeletions: { claimed: 0, completed: 0, failed: 0 },
      capacityQueue: { scanned: 0, promoted: 0, cancelled: 0, waiting: 0 },
    }),
    runStep('后台幂等记录清理', () => cleanupExpiredAdminIdempotency(undefined, 500), {
      responsesPurged: 0,
      tombstonesDeleted: 0,
    }),
    options.recoverGeneratedVideoThumbnails === false
      ? Promise.resolve({ scanned: 0, updated: 0, skipped: 0, permanentFailed: 0, retryableFailed: 0 })
      : runStep(
          '生成视频缩略图恢复',
          () => recoverPendingGeneratedVideoThumbnails({ limit: 10 }),
          { scanned: 0, updated: 0, skipped: 0, permanentFailed: 0, retryableFailed: 0 },
        ),
    runStep(
      '状态机监控',
      collectWorkerStateMachineMonitoringSnapshot,
      emptyStateMachineMonitoringSnapshot(),
    ),
  ]);
  const result = {
    assetRetention,
    generation,
    promptWizard,
    tkPromptEngine,
    recoverableUploads,
    expiredUploads,
    objectDeletions,
    invoiceNotifications,
    paymentNotifications,
    paymentAttempts,
    orderRefunds,
    realPortraitReconciliation,
    expiredAdminIdempotency,
    generatedVideoThumbnails,
    stateMachineMonitoring,
  };
  if (options.failOnStepError && stepFailed) {
    throw Object.assign(new Error('Worker maintenance step failed'), {
      code: 'WORKER_MAINTENANCE_STEP_FAILED',
    });
  }
  return result;
}

async function runMaintenanceStep<T>(
  label: string,
  run: () => Promise<T>,
  fallback: T,
  onFailure?: () => void,
) {
  try {
    return await run();
  } catch (error) {
    onFailure?.();
    logWorkerFailure('worker-maintenance-step-failed', error, { label });
    return fallback;
  }
}

export async function processTask(taskId: string, expectedAttempt: number) {
  const lockedTask = await markTaskProcessing(taskId, expectedAttempt);
  if (!lockedTask) return;
  const claimToken = lockedTask.claimToken;
  if (!claimToken) return;

  const taskResult = await pool.query<WorkerTaskRow>(
    `SELECT id, user_id, kind, model, prompt, config, credits, attempt,
            provider_task_id, provider_result
     FROM generation_tasks
     WHERE id = $1`,
    [taskId],
  );
  const task = taskResult.rows[0];
  if (!task || task.attempt !== expectedAttempt) return;

  const providerTaskId = lockedTask.providerTaskId ?? task.provider_task_id;
  const providerResult = lockedTask.providerResult ?? task.provider_result;
  let hasProviderCheckpoint = Boolean(lockedTask.providerResponseCheckpoint);
  let hasExternalProviderTask = hasProviderCheckpoint
    || Boolean(providerTaskId && !isSeedreamLocalOperationId(providerTaskId));
  let providerSubmissionStarted = false;
  let canceledBeforeSubmission = false;
  const providerInput = {
    taskId: task.id,
    userId: task.user_id,
    kind: task.kind,
    model: task.model,
    prompt: task.prompt,
    config: task.config,
    credits: toInt(task.credits),
    attempt: expectedAttempt,
    outputObjectKey: lockedTask.outputObjectKey,
    thumbnailObjectKey: lockedTask.thumbnailObjectKey,
    stagingObjectKey: lockedTask.stagingObjectKey,
    providerRequestId: lockedTask.providerRequestId,
    providerResponseCheckpoint: lockedTask.providerResponseCheckpoint,
    providerResponseUrl: lockedTask.providerResponseUrl,
    providerResponseObservedAt: lockedTask.providerResponseObservedAt,
    providerResponseUrlExpiresAt: lockedTask.providerResponseUrlExpiresAt,
    callbackUrl: `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/providers/ark/callback/${lockedTask.callbackToken}`,
    onProviderSubmissionStarted: async () => {
      const started = await markProviderSubmissionStarted(task.id, expectedAttempt, claimToken);
      if (!started) {
        const canceled = await cancelClaimedTaskBeforeSubmission(task.id, expectedAttempt, claimToken);
        if (canceled) {
          canceledBeforeSubmission = true;
          throw Object.assign(new Error('生成任务已在供应商提交前取消'), {
            code: 'GENERATION_CANCELED_BEFORE_SUBMISSION',
          });
        }
        throw new Error('生成任务租约已失效');
      }
      providerSubmissionStarted = true;
    },
    onProviderTaskCreated: async (providerTaskId: string) => {
      const updated = await recordProviderTaskId(task.id, expectedAttempt, claimToken, providerTaskId);
      if (!updated) throw new Error('生成任务租约已失效');
      hasExternalProviderTask = true;
    },
    onProviderResponseCheckpoint: async (checkpoint: ProviderResponseCheckpointInput) => {
      try {
        const saved = await recordProviderResponseCheckpoint(
          task.id,
          expectedAttempt,
          claimToken,
          checkpoint,
        );
        if (!saved) throw new Error('生成任务租约已失效');
      } catch (error) {
        logWorkerFailure('generation.provider_checkpoint_persist_failed', error, {
          taskId: task.id,
          providerRunId: lockedTask.providerRunId,
          phase: 'provider-response-checkpoint',
        });
        throw error;
      }
      hasProviderCheckpoint = true;
      // 对同步 Seedream 来说，checkpoint 就是“上游已经完成且可能已计费”的不可重提边界。
      hasExternalProviderTask = true;
    },
    onProviderUsageObserved: async (observation: ProviderUsageObservation) => {
      const saved = await recordProviderUsageObservation(task.id, expectedAttempt, observation, claimToken);
      if (!saved) throw new Error('生成任务租约已失效');
    },
    onHeartbeat: async () => {
      const alive = await heartbeatGenerationTask(task.id, expectedAttempt, claimToken);
      if (!alive) throw new Error('生成任务租约已失效');
    },
    isCancellationRequested: () => isClaimedGenerationTaskCancellationRequested(
      task.id,
      expectedAttempt,
      claimToken,
    ),
  };
  const leaseTimer = setInterval(() => {
    void heartbeatGenerationTask(task.id, expectedAttempt, claimToken).catch(() => undefined);
  }, 10_000);

  try {
    const resumeOperationId = providerTaskId
      ?? (hasProviderCheckpoint ? buildSeedreamLocalOperationId(task.id, expectedAttempt) : null);
    const result = providerResult
      ?? (resumeOperationId
        ? await resumeProviderTask(providerInput, resumeOperationId)
        : await runProvider(providerInput));

    // 供应商任务仍在运行；租约过期后 reconciler 会以新 attempt 继续轮询。
    if (!result) return;

    if (!result.ok) {
      if (canceledBeforeSubmission) return;
      if (providerSubmissionStarted && result.providerTaskId && !hasExternalProviderTask) {
        const persisted = await recordProviderTaskId(
          task.id,
          expectedAttempt,
          claimToken,
          result.providerTaskId,
        ).catch(() => null);
        if (!persisted) {
          await markProviderSubmissionUnknown(
            taskId,
            expectedAttempt,
            claimToken,
            '供应商已返回 task id，但本地持久化失败',
          );
          return;
        }
        hasExternalProviderTask = true;
      }
      const submissionDefinitelyRejected = result.submissionDisposition === 'not-created'
        && result.billingDisposition === 'unbilled';
      if (providerSubmissionStarted && !result.providerTaskId && !submissionDefinitelyRejected) {
        await markProviderSubmissionUnknown(taskId, expectedAttempt, claimToken, result.reason);
        return;
      }
      if (hasExternalProviderTask && result.providerTaskId && result.terminal !== true) {
        // 网络/轮询异常并不代表外部任务失败，继续由 reconciler 查证。
        return;
      }
      const canceled = await finalizeRequestedTaskCancellation(taskId, expectedAttempt, claimToken, result);
      if (canceled) return;
      await failTaskWithRefund(
        taskId,
        submissionDefinitelyRejected
          ? { ...result, terminal: true, providerStatus: 'not-created', billingDisposition: 'unbilled' }
          : providerSubmissionStarted || hasExternalProviderTask || Boolean(providerResult)
          ? result
          : { ...result, providerStatus: 'not-submitted', billingDisposition: 'unbilled' },
        expectedAttempt,
        undefined,
        claimToken,
      );
      return;
    }

    if (task.kind === 'image' && hasProviderCheckpoint && isSeedreamLocalOperationId(result.providerTaskId)) {
      const cleared = await clearProviderResponseUrlAfterArchive(
        taskId,
        expectedAttempt,
        claimToken,
        result.providerTaskId,
      );
      if (!cleared) throw new Error('Seedream 原图已归档，但临时地址清理未能持久化');
    }

    // 同步图片结果已成功归档时，应先清除仅用于恢复的上游临时 URL。
    // 即使用户恰好在归档后请求取消，也不能让取消分支绕过这项敏感数据清理。
    const canceled = await finalizeRequestedTaskCancellation(taskId, expectedAttempt, claimToken, result);
    if (canceled) return;

    const prepared = await prepareProviderResultForSettlement(
      task,
      lockedTask.thumbnailObjectKey,
      result,
    );
    const orphanCandidateThumbnailKey = prepared.generatedThumbnailKey
      ?? (prepared.providerResult.thumbnailKey === lockedTask.thumbnailObjectKey
        ? lockedTask.thumbnailObjectKey
        : null);
    let persisted;
    try {
      persisted = await markTaskProviderSucceeded(taskId, expectedAttempt, claimToken, prepared.providerResult);
    } catch (error) {
      if (orphanCandidateThumbnailKey) {
        await scheduleUnreferencedGenerationThumbnail(orphanCandidateThumbnailKey).catch(() => undefined);
      }
      throw error;
    }
    if (!persisted) {
      if (orphanCandidateThumbnailKey) {
        await scheduleUnreferencedGenerationThumbnail(orphanCandidateThumbnailKey).catch(() => undefined);
      }
      return;
    }
    try {
      const settled = await settleTaskSuccess(taskId, expectedAttempt, claimToken);
      if (settled && task.kind === 'image' && lockedTask.stagingObjectKey) {
        await scheduleSettledGenerationStaging(lockedTask.stagingObjectKey).catch(() => undefined);
      }
    } catch (error) {
      // 成片已成功时绝不走供应商失败退款，只重试本地结算。
      await recordTaskSettlementError(taskId, expectedAttempt, claimToken, error);
    }
  } catch (error) {
    if (canceledBeforeSubmission) return;
    if (providerSubmissionStarted && !hasExternalProviderTask) {
      await markProviderSubmissionUnknown(taskId, expectedAttempt, claimToken, error);
      return;
    }
    if (hasExternalProviderTask || providerResult) {
      // 已知外部任务时不能冒险重复提交或退款，留给 reconciler 恢复。
      return;
    }
    await failTaskWithRefund(taskId, {
      ok: false,
      provider: 'worker',
      category: 'provider-failed',
      reason: error instanceof Error ? error.message : '供应商适配层执行失败',
      providerStatus: 'not-submitted',
      billingDisposition: 'unbilled',
    }, expectedAttempt, undefined, claimToken);
  } finally {
    clearInterval(leaseTimer);
  }
}

function isSeedreamLocalOperationId(value: string) {
  return value.startsWith('seedream-sync:');
}

function buildSeedreamLocalOperationId(taskId: string, attempt: number) {
  return `seedream-sync:${taskId}:${attempt}`;
}

async function prepareProviderResultForSettlement(
  task: Pick<WorkerTaskRow, 'id' | 'kind'>,
  thumbnailObjectKey: string,
  result: ProviderSuccess,
): Promise<{ providerResult: ProviderSuccess; generatedThumbnailKey: string | null }> {
  if (task.kind !== 'image') {
    return { providerResult: result, generatedThumbnailKey: null };
  }

  const thumbnailKey = await createUploadedImageThumbnail({
    objectKey: result.objectKey,
    thumbnailKey: thumbnailObjectKey,
  });
  if (!thumbnailKey) {
    throw Object.assign(new Error('生成图片缩略图结果为空'), {
      code: 'GENERATION_THUMBNAIL_FAILED',
    });
  }

  return {
    generatedThumbnailKey: thumbnailKey,
    providerResult: {
      ...result,
      thumbnailKey,
      thumbnailUrl: buildPublicUrl(thumbnailKey),
    },
  };
}

async function scheduleUnreferencedGenerationThumbnail(objectKey: string) {
  const availableAt = new Date(Date.now() + 5 * 60_000);
  await withTransaction(client => scheduleObjectDeletion(client, objectKey, [], availableAt));
}

async function scheduleSettledGenerationStaging(objectKey: string) {
  await withTransaction(client => scheduleObjectDeletion(client, objectKey, [], new Date()));
}

type GenerationWorkerLifecycle = ReturnType<typeof createWorkerLifecycleCoordinator>;

interface GenerationWorkerMainRuntime {
  lifecycle?: GenerationWorkerLifecycle;
  installShutdown?: (shutdown: () => Promise<void>) => void;
  start?: (lifecycle: GenerationWorkerLifecycle) => Promise<void>;
}

export function createGenerationMaintenanceGate(lifecycle: GenerationWorkerLifecycle) {
  const tasks: Array<{ waitForCurrent(): Promise<boolean> }> = [];
  let stopping = false;
  let drainSnapshot: Promise<boolean>[] | null = null;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    drainSnapshot = tasks.map(task => task.waitForCurrent());
  };
  lifecycle.registerStopGate(stop);
  lifecycle.registerCleanup(async () => {
    const results = await Promise.allSettled(drainSnapshot ?? []);
    if (results.some(
      result => result.status === 'rejected' || (result.status === 'fulfilled' && result.value),
    )) {
      throw Object.assign(new Error('Worker maintenance shutdown failed'), {
        code: 'WORKER_MAINTENANCE_SHUTDOWN_FAILED',
      });
    }
  });

  return {
    track<Args extends unknown[]>(task: {
      run(...args: Args): Promise<boolean>;
      waitForCurrent(): Promise<boolean>;
    }) {
      tasks.push(task);
      return (...args: Args) => stopping ? Promise.resolve(false) : task.run(...args);
    },
  };
}

export function assertScheduledBillingSyncSucceeded(
  results: ReadonlyArray<{ ok: boolean; skipped: boolean }>,
) {
  if (results.some(result => !result.ok && !result.skipped)) {
    throw Object.assign(new Error('Scheduled billing sync failed'), {
      code: 'VOLCENGINE_BILLING_SCHEDULE_FAILED',
    });
  }
}

export function assertBalanceSyncSucceeded(result: { ok: boolean; skipped: boolean }) {
  if (!result.ok && !result.skipped) {
    throw Object.assign(new Error('Balance sync failed'), {
      code: 'VOLCENGINE_BALANCE_SYNC_FAILED',
    });
  }
}

export function assertBillingRequestProcessingSucceeded(result: { failed: number }) {
  if (result.failed > 0) {
    throw Object.assign(new Error('Billing request processing failed'), {
      code: 'VOLCENGINE_BILLING_REQUEST_FAILED',
    });
  }
}

const BILLING_RETENTION_STARTUP_DELAY_MS = 2 * 60_000;

async function startGenerationWorker(lifecycle: GenerationWorkerLifecycle) {
  // pool 是模块级资源；所有队列 closer 紧邻本次首次副作用登记。
  lifecycle.registerCleanup(() => pool.end());
  lifecycle.registerCleanup(() => closePromptWizardQueue());
  await lifecycle.runStartupStep(() => configurePromptWizardQueueGlobalConcurrency());
  lifecycle.registerCleanup(() => closeTkPromptEngineQueue());
  await lifecycle.runStartupStep(() => configureTkPromptEngineQueueGlobalConcurrency());
  // 生产 compose 只启动 worker:start；在同一进程消费上传队列，避免状态机无人执行。
  const uploadRuntime = lifecycle.acquireStopSync(
    () => startUploadWorker({ manageProcessSignals: false, manageMaintenance: false }),
    runtime => runtime.stop(),
  );
  lifecycle.registerCleanup(() => uploadRuntime.closeDependencies());
  if (env.MCP_ENABLED) {
    const mcpRuntime = lifecycle.acquireStopSync(startMcpImportWorker, runtime => runtime.stop());
    lifecycle.registerCleanup(() => mcpRuntime.closeDependencies());
  }
  lifecycle.registerCleanup(() => closeGenerationQueue());
  const recoveredCount = await lifecycle.runStartupStep(() => enqueuePendingTasks());
  console.log(`已恢复 ${recoveredCount} 个等待中的生成任务`);
  const recoveredTkPromptEngine = await lifecycle.runStartupStep(
    () => enqueueRecoverableTkPromptEngineJobs(),
  );
  console.log(`已恢复 TK Prompt Engine 任务：${JSON.stringify(recoveredTkPromptEngine)}`);

  const maintenanceGate = createGenerationMaintenanceGate(lifecycle);
  const paymentSweepTask = createTrackedSingleFlightTask(
    async () => {
      const result = await sweepExpiredPaymentOrders();
      if (result.scanned > 0) console.log(`支付到期扫描：${JSON.stringify(result)}`);
    },
    error => logWorkerFailure('payment-expiry-sweep-failed', error),
  );
  const runPaymentExpirySweep = maintenanceGate.track(paymentSweepTask);

  const stateMachineMonitoringLogGate = createStateMachineMonitoringLogGate();
  type ReconcilerOptions = {
    recoverGeneratedVideoThumbnails?: boolean;
    runAssetRetentionSweep?: boolean;
  };
  const reconcileTask = createTrackedSingleFlightTask<[ReconcilerOptions]>(
    async options => {
      const result = await runWorkerMaintenance({ ...options, failOnStepError: true });
      if (result.assetRetention.scheduled > 0) {
        console.log(`AI 历史素材保留期扫描：${JSON.stringify(result.assetRetention)}`);
      }
      if (result.invoiceNotifications.scanned > 0) {
        console.log(`发票管理员通知扫描：${JSON.stringify(result.invoiceNotifications)}`);
      }
      if (result.orderRefunds.claimed > 0) {
        console.log(`订单退款投递扫描：${JSON.stringify(result.orderRefunds)}`);
      }
      const monitoringLog = stateMachineMonitoringLogGate(result.stateMachineMonitoring);
      if (monitoringLog) {
        const payload = JSON.stringify(monitoringLog);
        if (monitoringLog.level === 'warn') console.warn(payload);
        else console.log(payload);
      }
    },
    error => logWorkerFailure('worker-reconciliation-failed', error),
  );
  const trackedReconciler = maintenanceGate.track(reconcileTask);
  const runReconciler = (options: ReconcilerOptions = {}) => trackedReconciler(options);

  await lifecycle.runStartupStep(() => runPaymentExpirySweep());
  // 先完成轻量状态恢复再创建 Bull Worker；缩略图需要下载 TOS 大视频并运行 FFmpeg，
  // 首轮延后到生成队列启动后的定时维护，不能阻塞正常生成消费。
  await lifecycle.runStartupStep(() => runReconciler({
    recoverGeneratedVideoThumbnails: false,
    runAssetRetentionSweep: false,
  }));
  const subscriptionSweepTask = createTrackedSingleFlightTask(
    async () => {
      const reconciled = await reconcileDueSubscriptions(300);
      if (reconciled > 0) console.log(`订阅周期扫描：已处理 ${reconciled} 个账户`);
    },
    error => logWorkerFailure('subscription-sweep-failed', error),
  );
  const runSubscriptionSweep = maintenanceGate.track(subscriptionSweepTask);
  await lifecycle.runStartupStep(() => runSubscriptionSweep());
  const billingScheduleTask = createTrackedSingleFlightTask(
    async () => {
      const results = await runScheduledVolcengineBillingSync();
      assertScheduledBillingSyncSucceeded(results);
    },
    error => logWorkerFailure('volcengine-billing-scheduled-sync-failed', error),
  );
  const runBillingSchedule = maintenanceGate.track(billingScheduleTask);

  const balanceSyncTask = createTrackedSingleFlightTask(
    async () => {
      const result = await syncVolcengineBillingBalance();
      assertBalanceSyncSucceeded(result);
    },
    error => logWorkerFailure('volcengine-balance-sync-failed', error),
  );
  const runBalanceSync = maintenanceGate.track(balanceSyncTask);

  const billingRequestTask = createTrackedSingleFlightTask(
    async () => {
      const result = await processPendingVolcengineBillingSyncRequests(5);
      assertBillingRequestProcessingSucceeded(result);
      if (result.claimed > 0) console.log(`火山账务手动同步：${JSON.stringify(result)}`);
    },
    error => logWorkerFailure('volcengine-billing-request-queue-failed', error),
  );
  const runBillingRequests = maintenanceGate.track(billingRequestTask);

  let billingRetentionStopRequested = false;
  lifecycle.registerStopScheduling(() => {
    billingRetentionStopRequested = true;
  });
  const billingRetentionTask = createTrackedSingleFlightTask(
    async () => {
      const result = await runProviderBillingRetentionSweep({
        shouldContinue: () => !billingRetentionStopRequested,
      });
      if (result.status === 'already-running') return;
      const deleted = result.runItems + result.packageSnapshots + result.syncRuns;
      if (deleted > 0 || result.status !== 'completed') {
        console.log(`火山账务数据保留清理：${JSON.stringify(result)}`);
      }
    },
    error => logWorkerFailure('volcengine-billing-retention-sweep-failed', error),
  );
  const runBillingRetentionSweep = maintenanceGate.track(billingRetentionTask);

  // 账务同步不能阻塞生成 worker 启动；事务锁与运行记录负责后台幂等。
  void runBillingSchedule();
  void runBillingRequests();
  const paymentTimer = setInterval(() => void runPaymentExpirySweep(), env.PAYMENT_EXPIRY_SWEEP_INTERVAL_MS);
  lifecycle.registerStopScheduling(() => clearInterval(paymentTimer));
  const reconcileTimer = setInterval(() => void runReconciler(), 15_000);
  lifecycle.registerStopScheduling(() => clearInterval(reconcileTimer));
  const subscriptionTimer = setInterval(() => void runSubscriptionSweep(), 60_000);
  lifecycle.registerStopScheduling(() => clearInterval(subscriptionTimer));
  const billingScheduleTimer = setInterval(
    () => void runBillingSchedule(),
    env.VOLC_BILLING_BILL_SYNC_INTERVAL_MS,
  );
  lifecycle.registerStopScheduling(() => clearInterval(billingScheduleTimer));
  const balanceSyncTimer = setInterval(
    () => void runBalanceSync(),
    env.VOLC_BILLING_BALANCE_SYNC_INTERVAL_MS,
  );
  lifecycle.registerStopScheduling(() => clearInterval(balanceSyncTimer));
  const billingRequestTimer = setInterval(
    () => void runBillingRequests(),
    env.VOLC_BILLING_REQUEST_POLL_INTERVAL_MS,
  );
  lifecycle.registerStopScheduling(() => clearInterval(billingRequestTimer));
  // 保留清理不进入启动路径：启动后延迟首次执行，之后按天运行；每批自动提交，可随时被停止。
  const billingRetentionStartupTimer = setTimeout(
    () => void runBillingRetentionSweep(),
    BILLING_RETENTION_STARTUP_DELAY_MS,
  );
  lifecycle.registerStopScheduling(() => clearTimeout(billingRetentionStartupTimer));
  const billingRetentionTimer = setInterval(
    () => void runBillingRetentionSweep(),
    env.VOLC_BILLING_RETENTION_SWEEP_INTERVAL_MS,
  );
  lifecycle.registerStopScheduling(() => clearInterval(billingRetentionTimer));

  const worker = lifecycle.acquireStopSync(
    () => {
      const instance = new Worker(
        generationQueueName,
        async job => processTask(job.data.taskId, Number(job.data.attempt ?? 0)),
        {
          connection: getRedisConnectionOptions(),
          concurrency: env.QUEUE_CONCURRENCY,
          lockDuration: 30_000,
        },
      );
      registerSafeWorkerErrorListener(instance, 'generation-worker-error');
      return instance;
    },
    instance => instance.close(),
  );

  worker.on('completed', job => console.log(`生成任务已处理：${job.data.taskId}`));
  worker.on('failed', (job, error) => logWorkerFailure('generation-job-failed', error, {
    taskId: job?.data.taskId ?? null,
  }));

  const promptWizardWorker = lifecycle.acquireStopSync(
    () => {
      const instance = new Worker(
        promptWizardQueueName,
        async job => {
          if (job.data.kind === 'analyze') {
            await processPromptWizardAnalysis(job.data.runId);
            return;
          }
          if (job.data.kind === 'concept') {
            await processPromptWizardConceptSet(job.data.conceptSetId);
            return;
          }
          if (job.data.kind === 'use-direction') {
            await processPromptWizardUseDirectionSet(job.data.useDirectionSetId);
            return;
          }
          if (job.data.kind === 'route-set-v6') {
            await processPromptWizardRouteSetV6(job.data.routeSetId);
            return;
          }
          if (job.data.kind === 'refine') {
            await processPromptWizardPlanRefinement(job.data.revisionId);
            return;
          }
          await processPromptWizardBatch(job.data.batchId);
        },
        {
          connection: getRedisConnectionOptions(),
          concurrency: env.PROMPT_WIZARD_QUEUE_CONCURRENCY,
          lockDuration: 120_000,
        },
      );
      registerSafeWorkerErrorListener(instance, 'prompt-wizard-worker-error');
      return instance;
    },
    instance => instance.close(),
  );
  promptWizardWorker.on('completed', job => console.log(`提示词向导任务已处理：${job.id}`));
  promptWizardWorker.on('failed', (job, error) => logWorkerFailure('prompt-wizard-job-failed', error, {
    jobId: job?.id ?? null,
  }));
  lifecycle.acquireStopSync(
    () => startTkPromptEngineWorker(),
    instance => instance.close(),
  );
  // 生成队列已经开始消费后再补跑每日保留期扫描，避免首次历史清理阻塞正常生成。
  void runReconciler();

  lifecycle.finishStartup();
}

export async function main(runtime: GenerationWorkerMainRuntime = {}) {
  const lifecycle = runtime.lifecycle ?? createWorkerLifecycleCoordinator();
  const installShutdown = runtime.installShutdown ?? (shutdown => {
    installProcessShutdownHandlers(shutdown, 'GENERATION_WORKER_SHUTDOWN_FAILED');
  });
  installShutdown(() => lifecycle.requestSignalShutdown());

  try {
    await (runtime.start ?? startGenerationWorker)(lifecycle);
  } catch (error) {
    if (lifecycle.isGracefulStartupStop(error)) {
      lifecycle.finishStartup();
      await lifecycle.requestSignalShutdown();
      return;
    }
    try {
      await lifecycle.abortStartup();
    } catch {
      // abortStartup 已尽力回收全部已登记资源；入口统一输出固定启动失败码。
    }
    throw Object.assign(new Error('Generation worker startup failed'), {
      code: 'GENERATION_WORKER_STARTUP_FAILED',
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    try {
      logWorkerFailure('generation-worker-aborted', error);
    } finally {
      process.exit(1);
    }
  });
}

function logWorkerFailure(event: string, error: unknown, details: Record<string, unknown> = {}) {
  console.error(JSON.stringify({
    event,
    ...details,
    errorCode: safeWorkerErrorCode(error),
  }));
}

function safeWorkerErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(code)) return code;
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z0-9_.-]{1,100}$/.test(name) ? name : 'UNKNOWN';
}
