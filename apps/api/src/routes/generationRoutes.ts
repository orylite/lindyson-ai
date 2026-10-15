import type { FastifyInstance } from 'fastify';
import { endpointContracts } from '@lindyson/api-contracts';
import { requireAuth } from '../auth/session.js';
import { pool, withReadOnlyRepeatableRead } from '../db/pool.js';
import { listConsumptionSettings } from '../domain/consumption.js';
import { readPromptWizardSettings } from '../domain/promptWizardService.js';
import { readTkPromptEngineSettings } from '../domain/tkPromptEngineRepository.js';
import {
  createExactCursorPage,
  exactPageMetadataColumns,
  fourWayCursorCondition,
  fourWayCursorValues,
  fourWayPageOrderBy,
  materializeExactCursorPageQuery,
  parseExactCursorPageRequest,
  readUserPaginationVersion,
  selectExactCursorPageRows,
  type ExactPageMetadata,
} from '../domain/cursorPagination.js';
import {
  createGenerationTasksBatch,
  getGenerationTask,
  wakeGenerationProviderRunByCallback,
} from '../domain/generationService.js';
import { mapSafeGenerationTaskConfig } from '../domain/generationTaskResponse.js';
import { toInt, toIsoDateTime } from '../domain/serialization.js';
import { signOwnedObjectReadUrls } from '../domain/assetReadUrlSigner.js';
import { readOwnedAssetReferencesByIds } from '../domain/assetReferences.js';
import { getUserVisibleGenerationFailureReason } from '../domain/generationFailureMessage.js';
import {
  hasExactSeedanceConsumptionCombinations,
  SEEDANCE_MODEL_CAPABILITIES,
  type SeedanceModelCapability,
} from '../domain/seedanceModels.js';
import { enqueueGenerationTask } from '../queues/generationQueue.js';

interface UserGenerationJobRow {
  id: string;
  kind: string;
  model: string;
  status: string;
  failure_category: string | null;
  failure_reason: string | null;
  config_aspect_ratio: string | null;
  config_resolution: string | null;
  config_duration_seconds: string | null;
  credits: number | string;
  reserved_credits: number | string;
  settled_credits: number | string;
  refunded_credits: number | string;
  credit_status: string;
  main_credits_used: number | string;
  addon_credits_used: number | string;
  asset_id: string | null;
  asset_name: string | null;
  asset_source: string | null;
  asset_object_key: string | null;
  asset_thumbnail_key: string | null;
  asset_thumbnail_status: string | null;
  asset_available: boolean | null;
  retry_count: number | string;
  attempt?: number | string;
  processing_stage?: string | null;
  cancel_state?: string | null;
  cancel_requested_at?: Date | string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

export async function registerGenerationRoutes(app: FastifyInstance) {
  app.post('/api/providers/ark/callback/:token', async (request, reply) => {
    const token = typeof (request.params as { token?: unknown })?.token === 'string'
      ? String((request.params as { token: string }).token).trim()
      : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
      return reply.code(202).send({ accepted: true });
    }
    const providerTaskId = extractCallbackProviderTaskId(request.body);
    const wake = await wakeGenerationProviderRunByCallback(token, providerTaskId);
    if (wake?.enqueue) await tryEnqueue(wake.taskId, wake.attempt, wake.claimEpoch);
    return reply.code(202).send({ accepted: true });
  });

  app.get('/api/ai/consumption-settings', async request => {
    await requireAuth(request);
    const { videoDuration25 } = endpointContracts.generationConsumptionSettings.query.parse(request.query);
    const includeDuration25 = videoDuration25 === '1';
    const [items, promptWizard, tkPromptEngine] = await Promise.all([
      listConsumptionSettings(pool),
      readPromptWizardSettings(pool),
      readTkPromptEngineSettings(pool),
    ]);
    const visibleItems = includeDuration25
      ? items
      : items.filter(item => !isSeedance25Duration25Setting(item));
    const videoModels = SEEDANCE_MODEL_CAPABILITIES.map(capability => {
      const visibleCapability: SeedanceModelCapability = capability.label === 'Seedance 2.5' && !includeDuration25
        ? { ...capability, durationSeconds: capability.durationSeconds.filter(duration => duration !== 25) }
        : capability;
      return {
        ...visibleCapability,
        available: isVideoModelCapabilityAvailable(visibleItems, visibleCapability),
        resolutions: [...visibleCapability.resolutions],
        durationSeconds: [...visibleCapability.durationSeconds],
        modes: [...visibleCapability.modes],
        aspectRatios: {
          general: [...visibleCapability.aspectRatios.general],
          firstLast: [...visibleCapability.aspectRatios.firstLast],
        },
        references: { ...visibleCapability.references },
      };
    });
    return { items: visibleItems, promptWizard, tkPromptEngine, videoModels };
  });

  app.post('/api/ai/video-tasks/batch', {
    preValidation: async request => rejectLegacyReferencePayload(request.body),
  }, async request => {
    const user = await requireAuth(request);
    const payload = endpointContracts.generationBatchCreate.body.parse(request.body);
    const tasks = await createGenerationTasksBatch({
      userId: user.id,
      idempotencyKey: payload.idempotencyKey,
      requests: payload.requests.map(item => ({ ...item, kind: 'video' as const })),
    });

    await Promise.all(tasks.map(task => tryEnqueue(task.id, task.attempt, task.claimEpoch)));
    return { tasks: tasks.map(toUserGenerationTask) };
  });

  app.post('/api/ai/image-tasks/batch', {
    preValidation: async request => rejectLegacyReferencePayload(request.body),
  }, async request => {
    const user = await requireAuth(request);
    const payload = endpointContracts.imageGenerationBatchCreate.body.parse(request.body);
    const tasks = await createGenerationTasksBatch({
      userId: user.id,
      idempotencyKey: payload.idempotencyKey,
      requests: payload.requests.map(item => ({ ...item, kind: 'image' as const })),
    });

    await Promise.all(tasks.map(task => tryEnqueue(task.id, task.attempt, task.claimEpoch)));
    return { tasks: tasks.map(toUserGenerationTask) };
  });

  app.get('/api/ai/tasks', async request => {
    const user = await requireAuth(request);
    const rawQuery = endpointContracts.generationTasks.query.parse(request.query);
    const pageRequest = parseExactCursorPageRequest({
      ...rawQuery,
      resource: 'user-generation-tasks',
      filters: { userId: user.id, status: rawQuery.status ?? null, kind: rawQuery.kind ?? null },
      defaultLimit: 20,
      maxLimit: 50,
    });
    return withReadOnlyRepeatableRead(async client => {
      const resourceScope = rawQuery.kind
        ? rawQuery.status
          ? `generation:${rawQuery.kind}:status:${rawQuery.status}`
          : `generation:${rawQuery.kind}:all`
        : rawQuery.status
          ? `generation:status:${rawQuery.status}`
          : 'generation:all';
      const version = await readUserPaginationVersion(client, user.id, resourceScope);
      const totalItems = pageRequest.snapshot
        ? undefined
        : (await client.query<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM generation_tasks gt
             WHERE gt.user_id = $1
               AND ($2::text IS NULL OR gt.status = $2)
               AND ($3::text IS NULL OR gt.kind = $3)`,
            [user.id, rawQuery.status ?? null, rawQuery.kind ?? null],
          )).rows[0]?.count;
      const query = materializeExactCursorPageQuery(pageRequest, {
        resourceVersion: version.version,
        snapshotAt: version.snapshotAt,
        totalItems,
      });
      const result = await client.query<UserGenerationJobRow & ExactPageMetadata>(
      `WITH paged_tasks AS MATERIALIZED (
         SELECT gt.id, gt.kind, gt.model, gt.status,
                gt.failure_category, gt.failure_reason,
                gt.config ->> 'aspectRatio' AS config_aspect_ratio,
                gt.config ->> 'resolution' AS config_resolution,
                gt.config ->> 'durationSeconds' AS config_duration_seconds,
                gt.credits, gt.reserved_credits, gt.settled_credits, gt.refunded_credits,
                gt.credit_status, gt.main_credits_used, gt.addon_credits_used,
                gt.asset_id, gt.retry_count, gt.attempt, gt.processing_stage,
                gt.cancel_state, gt.cancel_requested_at,
                gt.created_at, gt.started_at, gt.completed_at,
                ${exactPageMetadataColumns('gt.created_at')}
         FROM generation_tasks gt
         WHERE gt.user_id = $1
           AND ${fourWayCursorCondition(query, 'gt.created_at', 'gt.id', 2, 3)}
           AND ($4::text IS NULL OR gt.status = $4)
           AND ($5::text IS NULL OR gt.kind = $5)
         ORDER BY ${fourWayPageOrderBy(query, 'gt.created_at', 'gt.id')}
         LIMIT $6
       )
       SELECT gt.id, gt.kind, gt.model, gt.status,
              gt.failure_category, gt.failure_reason,
              gt.config_aspect_ratio, gt.config_resolution, gt.config_duration_seconds,
              gt.credits, gt.reserved_credits, gt.settled_credits, gt.refunded_credits,
              gt.credit_status, gt.main_credits_used, gt.addon_credits_used,
              gt.asset_id, gt.retry_count, gt.attempt, gt.processing_stage,
              gt.cancel_state, gt.cancel_requested_at,
              gt.created_at, gt.started_at, gt.completed_at,
              gt.__pagination_cursor_timestamp,
              a.name AS asset_name, a.source AS asset_source,
              a.object_key AS asset_object_key, a.thumbnail_key AS asset_thumbnail_key,
              a.thumbnail_status AS asset_thumbnail_status,
              CASE WHEN gt.asset_id IS NULL THEN NULL ELSE a.id IS NOT NULL END AS asset_available
       FROM paged_tasks gt
       LEFT JOIN assets a ON a.id = gt.asset_id AND a.deletion_status = 'active'
       ORDER BY ${fourWayPageOrderBy(query, 'gt.created_at', 'gt.id')}`,
      [
        user.id,
        ...fourWayCursorValues(query),
        rawQuery.status ?? null,
        rawQuery.kind ?? null,
        query.limit + 1,
      ],
    );
      const pageRows = selectExactCursorPageRows(result.rows, query);
      const assetThumbnails = await signGenerationTaskAssetThumbnails(pageRows);
      return createExactCursorPage({
        rows: result.rows,
        query,
        getId: row => row.id,
        map: row => mapUserJob(row, assetThumbnails),
      });
    });
  });

  app.get('/api/ai/tasks/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.generationTask.params.parse(request.params);
    // 用户工作台永远只读取当前账号；管理员跨用户查看必须走独立后台接口。
    const task = await getGenerationTask(pool, id, user.id);
    if (!task) throw Object.assign(new Error('任务不存在'), { statusCode: 404 });

    const responseTask = toUserGenerationTask(task);
    return {
      task: {
        ...responseTask,
        config: await attachGenerationReferencePreviewUrls(
          responseTask.config,
          user.id,
        ),
      },
    };
  });

}

export function isVideoModelCapabilityAvailable(
  items: Awaited<ReturnType<typeof listConsumptionSettings>>,
  capability: SeedanceModelCapability,
) {
  const rows = items.filter(item => item.kind === 'video' && item.model === capability.label);
  const isValid = (row: (typeof rows)[number]) => (
    row.available
    && row.credits > 0
    && (row.referenceVideoCredits ?? 0) > 0
  );
  if (capability.label !== 'Seedance 2.5') return rows.some(isValid);

  // 2.5 是一次性全量发布：缺失、重复、额外档位、停用或零价都会使模型整体不可选。
  return hasExactSeedanceConsumptionCombinations(
    capability,
    rows.map(row => ({
      durationSeconds: row.durationSeconds ?? 0,
      resolution: row.resolution,
    })),
  ) && rows.every(isValid);
}

function isSeedance25Duration25Setting(
  item: Awaited<ReturnType<typeof listConsumptionSettings>>[number],
) {
  return item.kind === 'video'
    && item.model === 'Seedance 2.5'
    && item.durationSeconds === 25;
}

/**
 * 失败任务再次编辑需要恢复原参考素材。任务 JSON 只保留资产 ID；这里一次性
 * 校验当前用户仍拥有的活动资产，再批量签发短期预览地址。已删除或越权资产
 * 继续保留为 previewUrl=null，浏览器据此提示用户重新选择。
 */
async function attachGenerationReferencePreviewUrls(
  config: Record<string, unknown>,
  userId: string,
) {
  const references = Array.isArray(config.referenceAssets)
    ? config.referenceAssets.filter(isRecord)
    : [];
  const assetIds = references.flatMap(reference => (
    typeof reference.id === 'string' && reference.id.trim()
      ? [reference.id.trim()]
      : []
  ));
  if (assetIds.length === 0) return config;

  const ownedAssets = await readOwnedAssetReferencesByIds(pool, userId, assetIds);
  const previewKeyByAssetId = new Map<string, string>();
  for (const assetId of assetIds) {
    const asset = ownedAssets.get(assetId);
    if (!asset) continue;
    const thumbnailReady = asset.thumbnail_status === 'ready'
      && Boolean(asset.thumbnail_key)
      && asset.thumbnail_key !== asset.object_key;
    previewKeyByAssetId.set(
      assetId,
      thumbnailReady ? asset.thumbnail_key! : asset.object_key,
    );
  }
  const signedUrls = await signOwnedObjectReadUrls([...previewKeyByAssetId.values()], {
    expiresInSeconds: 10 * 60,
  });

  return {
    ...config,
    referenceAssets: references.map(reference => {
      const assetId = typeof reference.id === 'string' ? reference.id : '';
      const previewKey = previewKeyByAssetId.get(assetId);
      return {
        ...reference,
        previewUrl: previewKey ? signedUrls.get(previewKey) ?? null : null,
      };
    }),
  };
}

function rejectLegacyReferencePayload(body: unknown) {
  if (containsLegacyReferenceField(body)) throw invalidReferencePayload();
}

function containsLegacyReferenceField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsLegacyReferenceField);
  if (!isRecord(value)) return false;
  for (const [key, nested] of Object.entries(value)) {
    if (
      key === 'referenceImages'
      || key === 'referenceAssets'
      || key === 'objectKey'
      || key === 'thumbnailKey'
      || key === 'publicUrl'
      || key === 'url'
    ) return true;
    if (containsLegacyReferenceField(nested)) return true;
  }
  return false;
}

function invalidReferencePayload() {
  return Object.assign(new Error('参考素材必须通过 references 中的 assetId 和 role 提交'), {
    statusCode: 400,
    code: 'INVALID_REFERENCE_PAYLOAD',
  });
}

function extractCallbackProviderTaskId(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : null;
  for (const value of [record.id, record.task_id, record.taskId, data?.id, data?.task_id, data?.taskId]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function tryEnqueue(taskId: string, attempt = 0, claimEpoch = 0) {
  try {
    await enqueueGenerationTask(taskId, attempt, claimEpoch);
  } catch (error) {
    console.error('生成任务已写入数据库，但暂未进入 Redis 队列。worker 启动时会恢复。', error);
  }
}

async function signGenerationTaskAssetThumbnails(rows: UserGenerationJobRow[]) {
  return signOwnedObjectReadUrls(rows.flatMap(row => {
    const key = generationTaskThumbnailKey(row);
    return key ? [key] : [];
  }));
}

function generationTaskThumbnailKey(row: UserGenerationJobRow) {
  if (row.asset_available !== true) return null;
  if (row.asset_thumbnail_status !== 'ready') return null;
  if (!row.asset_thumbnail_key || row.asset_thumbnail_key === row.asset_object_key) return null;
  return row.asset_thumbnail_key;
}

function mapUserJob(row: UserGenerationJobRow, assetThumbnails = new Map<string, string>()) {
  const thumbnailKey = generationTaskThumbnailKey(row);
  return {
    id: row.id,
    kind: row.kind,
    model: row.model,
    status: row.status,
    failureCategory: row.failure_category,
    failureReason: getUserVisibleGenerationFailureReason(row.failure_category, row.failure_reason, row.status),
    config: compactUserTaskConfig(row),
    credits: toInt(row.credits),
    reservedCredits: toInt(row.reserved_credits),
    settledCredits: toInt(row.settled_credits),
    refundedCredits: toInt(row.refunded_credits),
    creditStatus: row.credit_status,
    mainCreditsUsed: toInt(row.main_credits_used),
    addonCreditsUsed: toInt(row.addon_credits_used),
    assetId: row.asset_id,
    assetName: row.asset_name,
    assetSource: row.asset_source,
    assetThumbnailUrl: thumbnailKey ? assetThumbnails.get(thumbnailKey) ?? null : null,
    assetAvailable: row.asset_available ?? undefined,
    retryCount: toInt(row.retry_count),
    attempt: toInt(row.attempt),
    processingStage: row.processing_stage ?? null,
    cancelState: row.cancel_state ?? (row.cancel_requested_at ? 'requested' : 'none'),
    cancelRequestedAt: row.cancel_requested_at ? toIsoDateTime(row.cancel_requested_at) : null,
    createdAt: toIsoDateTime(row.created_at),
    startedAt: toIsoDateTime(row.started_at),
    completedAt: toIsoDateTime(row.completed_at),
  };
}

function compactUserTaskConfig(row: UserGenerationJobRow) {
  const config: Record<string, string | number> = {};
  if (row.config_aspect_ratio) config.aspectRatio = row.config_aspect_ratio;
  if (row.config_resolution) config.resolution = row.config_resolution;
  const durationSeconds = row.config_duration_seconds === null
    ? Number.NaN
    : Number(row.config_duration_seconds);
  if (Number.isFinite(durationSeconds) && durationSeconds >= 0) {
    config.durationSeconds = durationSeconds;
  }
  return config;
}

export function toUserGenerationTask(task: Awaited<ReturnType<typeof getGenerationTask>> & {}) {
  return {
    id: task.id,
    kind: task.kind,
    model: task.model,
    status: task.status,
    failureCategory: task.failureCategory,
    failureReason: getUserVisibleGenerationFailureReason(task.failureCategory, task.failureReason, task.status),
    prompt: task.prompt,
    config: mapSafeGenerationTaskConfig(task.config),
    credits: task.credits,
    reservedCredits: task.reservedCredits,
    settledCredits: task.settledCredits,
    refundedCredits: task.refundedCredits,
    creditStatus: task.creditStatus,
    mainCreditsUsed: task.mainCreditsUsed,
    addonCreditsUsed: task.addonCreditsUsed,
    assetId: task.assetId,
    retryCount: task.retryCount,
    attempt: task.attempt,
    processingStage: task.processingStage,
    cancelState: task.cancelState,
    cancelRequestedAt: task.cancelRequestedAt,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    updatedAt: task.updatedAt,
  };
}
