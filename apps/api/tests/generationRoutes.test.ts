import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  requireAuth: vi.fn(),
  getGenerationTask: vi.fn(),
  createGenerationTasksBatch: vi.fn(),
  enqueueGenerationTask: vi.fn(),
  wakeGenerationProviderRunByCallback: vi.fn(),
  signOwnedObjectReadUrls: vi.fn(),
  readTkPromptEngineSettings: vi.fn(),
  paginationTotal: 2,
}));

vi.mock('../src/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
  },
  withReadOnlyRepeatableRead: (fn: (client: { query: typeof mocks.poolQuery }) => unknown) => fn({ query: paginationQuery as typeof mocks.poolQuery }),
}));

const paginationQuery = (sql: unknown, values?: unknown[]) => {
  const text = String(sql);
  if (text.includes('user_pagination_versions')) {
    return Promise.resolve({ rows: [{ version: '0', snapshot_at: '2026-07-17T11:00:00.000Z' }], rowCount: 1 });
  }
  if (text.includes('SELECT count(*)::text AS count')) {
    return Promise.resolve({ rows: [{ count: String(mocks.paginationTotal) }], rowCount: 1 });
  }
  return mocks.poolQuery(sql, values);
};

vi.mock('../src/auth/session.js', () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock('../src/domain/generationService.js', () => ({
  createGenerationTask: vi.fn(),
  createGenerationTasksBatch: mocks.createGenerationTasksBatch,
  getGenerationTask: mocks.getGenerationTask,
  wakeGenerationProviderRunByCallback: mocks.wakeGenerationProviderRunByCallback,
  retryGenerationTask: vi.fn(),
}));

vi.mock('../src/queues/generationQueue.js', () => ({
  enqueueGenerationTask: mocks.enqueueGenerationTask,
}));

vi.mock('../src/domain/assetReadUrlSigner.js', () => ({
  signOwnedObjectReadUrls: mocks.signOwnedObjectReadUrls,
}));

vi.mock('../src/domain/tkPromptEngineRepository.js', () => ({
  readTkPromptEngineSettings: mocks.readTkPromptEngineSettings,
}));

import { registerGenerationRoutes } from '../src/routes/generationRoutes.js';

describe('generationRoutes', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.requireAuth.mockReset();
    mocks.getGenerationTask.mockReset();
    mocks.createGenerationTasksBatch.mockReset();
    mocks.enqueueGenerationTask.mockReset();
    mocks.wakeGenerationProviderRunByCallback.mockReset();
    mocks.signOwnedObjectReadUrls.mockReset();
    mocks.readTkPromptEngineSettings.mockReset();
    mocks.paginationTotal = 2;
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', email: 'user@example.com', role: 'user' });
    mocks.signOwnedObjectReadUrls.mockResolvedValue(new Map());
    mocks.readTkPromptEngineSettings.mockResolvedValue({
      schemaVersion: 1,
      generationCredits: 2,
      available: false,
      updatedAt: '2026-08-17T00:00:00.000Z',
    });
  });

  it('方舟回调只补齐任务 ID 并唤醒官方查单', async () => {
    const callbackToken = '00000000-0000-4000-8000-000000000601';
    mocks.wakeGenerationProviderRunByCallback.mockResolvedValue({
      taskId: '11111111-1111-4111-8111-111111111111',
      attempt: 2,
      claimEpoch: 5,
      enqueue: true,
      conflict: false,
    });
    mocks.enqueueGenerationTask.mockResolvedValue(undefined);
    const app = makeGenerationApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/providers/ark/callback/${callbackToken}`,
        payload: { id: 'provider-task-1', status: 'succeeded', video_url: 'https://untrusted.test/video.mp4' },
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ accepted: true });
      expect(mocks.wakeGenerationProviderRunByCallback).toHaveBeenCalledWith(callbackToken, 'provider-task-1');
      expect(mocks.enqueueGenerationTask).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        2,
        5,
      );
    } finally {
      await app.close();
    }
  });

  it('登录用户可以读取 AI Studio 积分消耗配置', async () => {
    mocks.poolQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM prompt_wizard_settings')) {
        return Promise.resolve(queryResult([{
          refresh_credits: 1,
          available: true,
          engine_version: 4,
          updated_at: '2026-07-01T10:00:00.000Z',
        }]));
      }
      return Promise.resolve(queryResult([
        {
          id: 'setting-1',
          kind: 'video',
          model: 'Seedance 2.0',
          model_label: 'Seedance 2.0',
          duration_seconds: 15,
          resolution: '720p',
          credits: 80,
          reference_video_credits: 95,
          available: true,
          updated_at: '2026-07-01T10:00:00.000Z',
        },
        {
          id: 'setting-2',
          kind: 'video',
          model: 'Seedance 2.0 Fast',
          model_label: 'Seedance 2.0 Fast',
          duration_seconds: 15,
          resolution: '1080p',
          credits: 72,
          reference_video_credits: 72,
          available: false,
          updated_at: '2026-07-01T10:00:00.000Z',
        },
      ]));
    });

    const app = makeGenerationApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/ai/consumption-settings',
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.requireAuth).toHaveBeenCalled();
      expect(mocks.poolQuery).toHaveBeenCalledWith(expect.stringContaining('FROM consumption_settings'));
      expect(mocks.readTkPromptEngineSettings).toHaveBeenCalledTimes(1);
      const payload = response.json();
      expect(payload).toEqual({
        items: [
          expect.objectContaining({
            id: 'setting-1',
            modelLabel: 'Seedance 2.0',
            durationSeconds: 15,
            credits: 80,
            referenceVideoCredits: 95,
            available: true,
          }),
          expect.objectContaining({
            id: 'setting-2',
            modelLabel: 'Seedance 2.0 Fast',
            durationSeconds: 15,
            credits: 72,
            referenceVideoCredits: 72,
            available: false,
          }),
        ],
        promptWizard: {
          generationCredits: 1,
          available: true,
          engineVersion: 4,
          updatedAt: '2026-07-01T10:00:00.000Z',
        },
        tkPromptEngine: {
          schemaVersion: 1,
          generationCredits: 2,
          available: false,
          updatedAt: '2026-08-17T00:00:00.000Z',
        },
        videoModels: expect.any(Array),
      });
      expect(payload.videoModels).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'seedance-2.0',
          label: 'Seedance 2.0',
          available: true,
          durationSeconds: [5, 10, 15],
        }),
        expect.objectContaining({
          id: 'seedance-2.5',
          label: 'Seedance 2.5',
          available: false,
          resolutions: ['480p', '720p'],
          durationSeconds: [5, 10, 15, 20, 30],
          aspectRatios: { general: ['9:16', '16:9'], firstLast: ['adaptive'] },
        }),
      ]));
    } finally {
      await app.close();
    }
  });

  it('Seedance 2.5 按 25 秒兼容标记分别以旧 10 档或新 12 档判定可用性', async () => {
    let currentRows = seedance25ConsumptionRows().slice(0, 9);
    mocks.poolQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM prompt_wizard_settings')) {
        return Promise.resolve(queryResult([{
          refresh_credits: 1,
          available: false,
          engine_version: 4,
          updated_at: '2026-08-12T00:00:00.000Z',
        }]));
      }
      return Promise.resolve(queryResult(currentRows));
    });

    const app = makeGenerationApp();
    try {
      const partial = await app.inject({ method: 'GET', url: '/api/ai/consumption-settings' });
      expect(partial.statusCode).toBe(200);
      expect(partial.json().videoModels).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'seedance-2.5', available: false }),
      ]));

      currentRows = seedance25ConsumptionRows();
      const complete = await app.inject({ method: 'GET', url: '/api/ai/consumption-settings' });
      expect(complete.statusCode).toBe(200);
      expect(complete.json().items).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ model: 'Seedance 2.5', durationSeconds: 25 }),
      ]));
      expect(complete.json().videoModels).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'seedance-2.5', available: true, durationSeconds: [5, 10, 15, 20, 30],
        }),
      ]));

      const duration25 = await app.inject({
        method: 'GET', url: '/api/ai/consumption-settings?videoDuration25=1',
      });
      expect(duration25.statusCode).toBe(200);
      expect(duration25.json().items).toEqual(expect.arrayContaining([
        expect.objectContaining({ model: 'Seedance 2.5', durationSeconds: 25 }),
      ]));
      expect(duration25.json().videoModels).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'seedance-2.5', available: true, durationSeconds: [5, 10, 15, 20, 25, 30],
        }),
      ]));

      currentRows = seedance25ConsumptionRows();
      currentRows[4] = { ...currentRows[4]!, available: false };
      const legacyWhile25Paused = await app.inject({ method: 'GET', url: '/api/ai/consumption-settings' });
      expect(legacyWhile25Paused.json().videoModels).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'seedance-2.5', available: true }),
      ]));
      const currentWhile25Paused = await app.inject({
        method: 'GET', url: '/api/ai/consumption-settings?videoDuration25=1',
      });
      expect(currentWhile25Paused.json().videoModels).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'seedance-2.5', available: false }),
      ]));

      currentRows = [
        ...seedance25ConsumptionRows(),
        { ...seedance25ConsumptionRows()[0]!, id: 'extra-row', resolution: '1080p' },
      ];
      const extra = await app.inject({ method: 'GET', url: '/api/ai/consumption-settings' });
      expect(extra.statusCode).toBe(200);
      expect(extra.json().videoModels).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'seedance-2.5', available: false }),
      ]));

      currentRows = seedance25ConsumptionRows();
      currentRows[0] = { ...currentRows[0]!, reference_video_credits: 0 };
      const zeroPriced = await app.inject({ method: 'GET', url: '/api/ai/consumption-settings' });
      expect(zeroPriced.statusCode).toBe(200);
      expect(zeroPriced.json().videoModels).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'seedance-2.5', available: false }),
      ]));
    } finally {
      await app.close();
    }
  });

  it('当前用户任务列表只查询自己的任务并返回关联资产名', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([
      {
        id: 'task-1',
        user_id: 'user-1',
        user_name: '测试用户',
        email: 'user@example.com',
        kind: 'video',
        model: 'Seedance 2.0',
        status: 'completed',
        failure_category: null,
        failure_reason: null,
        config_aspect_ratio: '9:16',
        config_resolution: '720p',
        config_duration_seconds: '5',
        credits: 20,
        reserved_credits: 20,
        settled_credits: 20,
        refunded_credits: 0,
        credit_status: 'settled',
        main_credits_used: 20,
        addon_credits_used: 0,
        asset_id: 'asset-1',
        asset_name: '产品视频',
        asset_source: 'ai-video',
        retry_count: 0,
        created_at: '2026-07-01T10:00:00.000Z',
        started_at: '2026-07-01T10:01:00.000Z',
        completed_at: '2026-07-01T10:02:00.000Z',
      },
    ]));

    const app = makeGenerationApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/ai/tasks?limit=25',
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.poolQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE gt.user_id = $1'),
        ['user-1', null, null, null, null, 26],
      );
      expect(response.json()).toEqual({
        items: [expect.objectContaining({
          id: 'task-1',
          assetName: '产品视频',
          assetSource: 'ai-video',
          credits: 20,
          config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
          createdAt: expect.any(String),
        })],
        pagination: {
          limit: 25,
          hasPrevious: false,
          hasNext: false,
          previousCursor: null,
          nextCursor: null,
          currentPage: 1,
          totalPages: 1,
          totalItems: 2,
          snapshotCursor: expect.any(String),
        },
      });
      expect(response.json().items[0]).not.toHaveProperty('userName');
      expect(response.json().items[0]).not.toHaveProperty('email');
      expect(response.json().items[0]).not.toHaveProperty('userId');
      expect(response.json().items[0]).not.toHaveProperty('prompt');
      const sql = String(mocks.poolQuery.mock.calls[0]?.[0]);
      expect(sql).not.toContain('gt.*');
      expect(sql).not.toContain('gt.prompt');
      expect(sql.match(/gt\.config ->>/g)).toHaveLength(3);
      expect(sql).not.toContain('__pagination_total_count');
      expect(sql).toContain('AS __pagination_cursor_timestamp');
      expect(sql).not.toContain('count(*) OVER()::bigint');
      expect(sql).not.toContain('OFFSET');
    } finally {
      await app.close();
    }
  });

  it('用户任务列表为视频和图片失败返回脱敏中文原因', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([
      {
        ...generationJobRow('00000000-0000-4000-8000-000000000111', '2026-07-27T07:29:00.000Z'),
        status: 'failed',
        failure_category: 'provider-failed',
        failure_reason: 'The request failed because the input video may contain real person. Request id: secret-video-request（HTTP 400，code=InputVideoSensitiveContentDetected.PrivacyInformation，requestId=secret-video-request）',
        refunded_credits: 10,
        credit_status: 'refunded',
        completed_at: '2026-07-27T07:30:00.000Z',
      },
      {
        ...generationJobRow('00000000-0000-4000-8000-000000000112', '2026-07-27T07:28:00.000Z'),
        kind: 'image',
        model: 'Seedream 5.0 Pro',
        status: 'failed',
        failure_category: 'content-policy',
        failure_reason: 'The request failed because the output image may contain sensitive information. requestId=secret-image-request',
        config_duration_seconds: null,
        refunded_credits: 10,
        credit_status: 'refunded',
        completed_at: '2026-07-27T07:29:00.000Z',
      },
    ]));

    const app = makeGenerationApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/ai/tasks?limit=25' });

      expect(response.statusCode).toBe(200);
      expect(response.json().items).toEqual([
        expect.objectContaining({
          kind: 'video',
          failureReason: '参考视频涉及真人或隐私信息，请更换后重试。',
        }),
        expect.objectContaining({
          kind: 'image',
          failureReason: '生成内容未通过内容审核，请调整提示词或参考素材后重试。',
        }),
      ]);
      expect(JSON.stringify(response.json())).not.toMatch(/secret-|Request\s*id|requestId|InputVideoSensitiveContentDetected/i);
    } finally {
      await app.close();
    }
  });

  it('任务列表批量返回已就绪关联视频的签名缩略图地址', async () => {
    const thumbnailKey = 'users/user-1/thumbnails/task-1.webp';
    mocks.poolQuery.mockResolvedValue(queryResult([
      {
        id: '00000000-0000-4000-8000-000000000101',
        kind: 'video',
        model: 'Seedance 2.0',
        status: 'completed',
        failure_category: null,
        failure_reason: null,
        config_aspect_ratio: '9:16',
        config_resolution: '720p',
        config_duration_seconds: '5',
        credits: 20,
        reserved_credits: 20,
        settled_credits: 20,
        refunded_credits: 0,
        credit_status: 'settled',
        main_credits_used: 20,
        addon_credits_used: 0,
        asset_id: '00000000-0000-4000-8000-000000000201',
        asset_name: '产品视频',
        asset_source: 'ai-video',
        asset_object_key: 'users/user-1/videos/task-1.mp4',
        asset_thumbnail_key: thumbnailKey,
        asset_thumbnail_status: 'ready',
        asset_available: true,
        retry_count: 0,
        attempt: 0,
        processing_stage: null,
        cancel_state: 'none',
        cancel_requested_at: null,
        created_at: '2026-07-01T10:00:00.000Z',
        started_at: '2026-07-01T10:01:00.000Z',
        completed_at: '2026-07-01T10:02:00.000Z',
      },
    ]));
    mocks.signOwnedObjectReadUrls.mockResolvedValue(new Map([
      [thumbnailKey, 'https://cdn.example.com/task-1.webp?signature=queue'],
    ]));

    const app = makeGenerationApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/ai/tasks?limit=7' });

      expect(response.statusCode).toBe(200);
      expect(mocks.signOwnedObjectReadUrls).toHaveBeenCalledWith([thumbnailKey]);
      expect(response.json().items[0]).toMatchObject({
        assetThumbnailUrl: 'https://cdn.example.com/task-1.webp?signature=queue',
        assetAvailable: true,
      });
    } finally {
      await app.close();
    }
  });

  it('已删除的关联素材不签发缩略图，并标记为不可用', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([{
      ...generationJobRow('00000000-0000-4000-8000-000000000102', '2026-07-01T10:00:00.000Z'),
      status: 'completed',
      asset_id: '00000000-0000-4000-8000-000000000202',
      asset_available: false,
    }]));

    const app = makeGenerationApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/ai/tasks?limit=7' });

      expect(response.statusCode).toBe(200);
      expect(mocks.signOwnedObjectReadUrls).toHaveBeenCalledWith([]);
      expect(response.json().items[0]).toMatchObject({
        assetAvailable: false,
        assetThumbnailUrl: null,
      });
    } finally {
      await app.close();
    }
  });

  it('任务列表默认 20 条且 limit 最大为 50', async () => {
    const app = makeGenerationApp();
    try {
      mocks.paginationTotal = 0;
      mocks.poolQuery.mockResolvedValueOnce(queryResult([]));
      const defaultPage = await app.inject({ method: 'GET', url: '/api/ai/tasks' });
      expect(defaultPage.statusCode).toBe(200);
      expect(defaultPage.json().pagination.limit).toBe(20);
      expect(mocks.poolQuery.mock.calls[0]?.[1]?.at(-1)).toBe(21);

      const response = await app.inject({
        method: 'GET',
        url: '/api/ai/tasks?limit=51',
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('用户生成任务列表返回可续翻页的复合游标', async () => {
    const firstId = '11111111-1111-4111-8111-111111111111';
    const secondId = '22222222-2222-4222-8222-222222222222';
    const firstAt = '2026-07-11T10:00:00.000Z';
    const secondAt = '2026-07-11T09:00:00.000Z';
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      generationJobRow(firstId, firstAt),
      generationJobRow(secondId, secondAt),
    ]));
    const app = makeGenerationApp();
    try {
      const first = await app.inject({ method: 'GET', url: '/api/ai/tasks?position=first&limit=1' });
      const cursor = first.json().pagination.nextCursor;
      expect(first.json().pagination).toEqual({
        limit: 1,
        hasPrevious: false,
        hasNext: true,
        previousCursor: null,
        nextCursor: expect.any(String),
        currentPage: 1,
        totalPages: 2,
        totalItems: 2,
        snapshotCursor: expect.any(String),
      });
      mocks.poolQuery.mockResolvedValueOnce(queryResult([generationJobRow(secondId, secondAt)]));

      const second = await app.inject({
        method: 'GET',
        url: `/api/ai/tasks?position=next&limit=1&cursor=${encodeURIComponent(cursor)}`,
      });
      expect(second.statusCode).toBe(200);
      expect(mocks.poolQuery.mock.calls.at(-1)?.[1]).toEqual([
        'user-1', firstAt, firstId, null, null, 2,
      ]);
      expect(second.json().pagination).toEqual({
        limit: 1,
        hasPrevious: true,
        hasNext: false,
        previousCursor: expect.any(String),
        nextCursor: null,
        currentPage: 2,
        totalPages: 2,
        totalItems: 2,
        snapshotCursor: first.json().pagination.snapshotCursor,
      });
      mocks.poolQuery.mockClear();
      const mismatch = await app.inject({
        method: 'GET',
        url: `/api/ai/tasks?position=next&limit=1&status=completed&cursor=${encodeURIComponent(cursor)}`,
      });
      expect(mismatch.statusCode).toBe(400);
      expect(mismatch.json().code).toBe('INVALID_CURSOR');
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('用户生成任务尾页只在分页 CTE 内精确计数', async () => {
    const newerId = '11111111-1111-4111-8111-111111111111';
    const olderId = '22222222-2222-4222-8222-222222222222';
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      generationJobRow(olderId, '2026-07-11T09:00:00.123455Z'),
      generationJobRow(newerId, '2026-07-11T10:00:00.123456Z'),
    ], 2));
    const app = makeGenerationApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/ai/tasks?position=last&limit=1' });

      expect(response.statusCode).toBe(200);
      expect(response.json().items.map((item: { id: string }) => item.id)).toEqual([olderId]);
      expect(response.json().pagination).toEqual(expect.objectContaining({
        limit: 1,
        hasPrevious: true,
        hasNext: false,
        nextCursor: null,
      }));
      const sql = String(mocks.poolQuery.mock.calls[0]?.[0]);
      expect(sql).toContain('WITH paged_tasks AS MATERIALIZED');
      expect(sql).not.toContain('count(*) OVER()::bigint');
      expect(sql).not.toContain('OFFSET');
    } finally {
      await app.close();
    }
  });

  it('生成任务取消接口已移除且不会调用任何任务写操作', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const app = makeGenerationApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/ai/tasks/${taskId}/cancel`,
      });

      expect(response.statusCode).toBe(404);
      expect(mocks.getGenerationTask).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('管理员进入用户工作台时也只能读取自己的任务', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    mocks.requireAuth.mockResolvedValueOnce({ id: 'admin-1', email: 'admin@example.com', role: 'admin' });
    mocks.getGenerationTask.mockResolvedValueOnce(null);
    const app = makeGenerationApp();
    try {
      const response = await app.inject({ method: 'GET', url: `/api/ai/tasks/${taskId}` });

      expect(response.statusCode).toBe(404);
      expect(mocks.getGenerationTask).toHaveBeenCalledWith(expect.anything(), taskId, 'admin-1');
    } finally {
      await app.close();
    }
  });

  it('用户任务详情把历史引用统一投影为无 TOS key 的 referenceAssets', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const referenceId = '22222222-2222-4222-8222-222222222222';
    mocks.getGenerationTask.mockResolvedValueOnce({
      id: taskId,
      userId: 'user-1',
      kind: 'video',
      model: 'Seedance 2.0',
      status: 'completed',
      failureCategory: null,
      failureReason: '归档失败：generated/video/user-1/task-1/attempt-0/output.mp4',
      prompt: '生成产品视频',
      config: {
        mode: 'general',
        aspectRatio: '9:16',
        resolution: '720p',
        durationSeconds: 5,
        referenceImages: [{
          id: referenceId,
          name: '历史参考图',
          objectKey: 'users/user-1/private-reference.png',
          thumbnailKey: 'users/user-1/private-reference-thumb.jpg',
          publicUrl: 'https://tos.example.com/private-reference.png?signature=secret',
          thumbnail: 'https://tos.example.com/private-reference-thumb.jpg?signature=secret',
          role: 'reference_image',
        }],
      },
      credits: 20,
      reservedCredits: 20,
      settledCredits: 20,
      refundedCredits: 0,
      creditStatus: 'settled',
      mainCreditsUsed: 20,
      addonCreditsUsed: 0,
      assetId: null,
      retryCount: 0,
      attempt: 0,
      processingStage: 'settled',
      cancelState: 'none',
      cancelRequestedAt: null,
      createdAt: '2026-07-17T10:00:00.000Z',
      startedAt: '2026-07-17T10:00:01.000Z',
      completedAt: '2026-07-17T10:01:00.000Z',
      updatedAt: '2026-07-17T10:01:00.000Z',
    });
    mocks.poolQuery.mockResolvedValueOnce(queryResult([]));
    const app = makeGenerationApp();
    try {
      const response = await app.inject({ method: 'GET', url: `/api/ai/tasks/${taskId}` });

      expect(response.statusCode).toBe(200);
      expect(response.json().task.config).toEqual({
        mode: 'general',
        aspectRatio: '9:16',
        resolution: '720p',
        durationSeconds: 5,
        referenceAssets: [{
          id: referenceId,
          name: '历史参考图',
          type: 'image',
          role: 'reference_image',
          previewUrl: null,
        }],
      });
      const serialized = JSON.stringify(response.json().task);
      expect(serialized).not.toMatch(/objectKey|thumbnailKey|referenceImages/);
      expect(serialized).not.toContain('users/user-1/private-reference');
      expect(serialized).not.toContain('signature=secret');
      expect(response.json().task.failureReason).toBeNull();
      expect(mocks.poolQuery).toHaveBeenCalledWith(
        expect.stringContaining('AND id = ANY($2::uuid[])'),
        ['user-1', [referenceId]],
      );
      expect(mocks.signOwnedObjectReadUrls).toHaveBeenCalledWith([], {
        expiresInSeconds: 10 * 60,
      });
    } finally {
      await app.close();
    }
  });

  it('用户任务详情一次批量校验活动参考素材并按原顺序签发短期预览', async () => {
    const taskId = '11111111-1111-4111-8111-111111111113';
    const imageId = '22222222-2222-4222-8222-222222222221';
    const videoId = '22222222-2222-4222-8222-222222222222';
    const deletedId = '22222222-2222-4222-8222-222222222223';
    mocks.getGenerationTask.mockResolvedValueOnce(generationTaskDetail({
      id: taskId,
      model: 'Seedance 2.5',
      prompt: '按原素材修改后重试',
      config: {
        mode: 'general',
        aspectRatio: '16:9',
        resolution: '720p',
        durationSeconds: 30,
        referenceAssets: [
          { id: imageId, name: '主图.png', type: 'image', role: 'reference_image' },
          { id: videoId, name: '运镜.mp4', type: 'video', role: 'reference_video', durationSeconds: 12 },
          { id: deletedId, name: '已删除.wav', type: 'audio', role: 'reference_audio', durationSeconds: 8 },
        ],
      },
    }));
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      ownedReferenceRow(imageId, 'image', 'users/user-1/images/main.png', 'users/user-1/thumbs/main.webp'),
      ownedReferenceRow(videoId, 'video', 'users/user-1/videos/move.mp4', null),
    ]));
    mocks.signOwnedObjectReadUrls.mockResolvedValueOnce(new Map([
      ['users/user-1/thumbs/main.webp', 'https://cdn.example.com/main.webp?signature=short'],
      ['users/user-1/videos/move.mp4', 'https://cdn.example.com/move.mp4?signature=short'],
    ]));

    const app = makeGenerationApp();
    try {
      const response = await app.inject({ method: 'GET', url: `/api/ai/tasks/${taskId}` });

      expect(response.statusCode).toBe(200);
      expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
      expect(mocks.poolQuery).toHaveBeenCalledWith(
        expect.stringContaining('AND id = ANY($2::uuid[])'),
        ['user-1', [imageId, videoId, deletedId]],
      );
      expect(mocks.signOwnedObjectReadUrls).toHaveBeenCalledWith([
        'users/user-1/thumbs/main.webp',
        'users/user-1/videos/move.mp4',
      ], { expiresInSeconds: 10 * 60 });
      expect(response.json().task.config.referenceAssets).toEqual([
        expect.objectContaining({ id: imageId, previewUrl: 'https://cdn.example.com/main.webp?signature=short' }),
        expect.objectContaining({ id: videoId, previewUrl: 'https://cdn.example.com/move.mp4?signature=short' }),
        expect.objectContaining({ id: deletedId, previewUrl: null }),
      ]);
      expect(JSON.stringify(response.json())).not.toContain('users/user-1/');
    } finally {
      await app.close();
    }
  });

  it('用户任务详情与列表使用同一中文失败映射', async () => {
    const taskId = '11111111-1111-4111-8111-111111111112';
    mocks.getGenerationTask.mockResolvedValueOnce(generationTaskDetail({
      id: taskId,
      status: 'failed',
      failureCategory: 'provider-failed',
      failureReason: 'The request failed because the output video may be related to copyright restrictions. Request id: secret-copyright-request',
      processingStage: 'failed',
      creditStatus: 'refunded',
      refundedCredits: 20,
      completedAt: '2026-07-27T07:36:00.000Z',
    }));
    const app = makeGenerationApp();
    try {
      const response = await app.inject({ method: 'GET', url: `/api/ai/tasks/${taskId}` });

      expect(response.statusCode).toBe(200);
      expect(response.json().task.failureReason)
        .toBe('生成内容可能涉及版权限制，请调整提示词或参考素材后重试。');
      expect(JSON.stringify(response.json())).not.toMatch(/secret-|Request\s*id|copyright restrictions/i);
    } finally {
      await app.close();
    }
  });

  it('批量视频生成将幂等键和全部请求交给原子服务并按 attempt 入队', async () => {
    mocks.createGenerationTasksBatch.mockResolvedValue([
      { id: 'task-1', attempt: 0 },
      { id: 'task-2', attempt: 0 },
    ]);
    mocks.enqueueGenerationTask.mockResolvedValue(undefined);
    const app = makeGenerationApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ai/video-tasks/batch',
        payload: {
          idempotencyKey: 'batch-request-0001',
          requests: [
            {
              model: 'Seedance 2.0',
              prompt: '视频一',
              config: {
                mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5,
              },
              references: [],
            },
            {
              model: 'Seedance 2.0',
              prompt: '视频二',
              config: {
                mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5,
              },
              references: [],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.createGenerationTasksBatch).toHaveBeenCalledWith({
        userId: 'user-1',
        idempotencyKey: 'batch-request-0001',
        requests: [
          {
            kind: 'video', model: 'Seedance 2.0', prompt: '视频一',
            config: {
              mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5,
            },
            references: [],
          },
          {
            kind: 'video', model: 'Seedance 2.0', prompt: '视频二',
            config: {
              mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5,
            },
            references: [],
          },
        ],
      });
      expect(mocks.enqueueGenerationTask).toHaveBeenNthCalledWith(1, 'task-1', 0, 0);
      expect(mocks.enqueueGenerationTask).toHaveBeenNthCalledWith(2, 'task-2', 0, 0);
      expect(response.json()).toEqual({
        tasks: [
          { id: 'task-1', attempt: 0, config: {}, failureReason: null },
          { id: 'task-2', attempt: 0, config: {}, failureReason: null },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('Seedance 2.5 恶意直调携带提示词向导来源时返回明确 400 且不入队', async () => {
    mocks.createGenerationTasksBatch.mockRejectedValue(Object.assign(
      new Error('Seedance 2.5 暂不支持提示词向导来源，请移除 promptWizardSource 后重试。'),
      { statusCode: 400, code: 'PROMPT_WIZARD_MODEL_UNSUPPORTED' },
    ));
    const app = makeGenerationApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ai/video-tasks/batch',
        payload: {
          idempotencyKey: 'seedance-25-forged-prompt-wizard-source',
          requests: [{
            model: 'Seedance 2.5',
            prompt: '恶意直调伪造向导来源',
            config: {
              mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5,
            },
            references: [],
            promptWizardSource: {
              runId: '00000000-0000-4000-8000-000000000801',
              batchId: '00000000-0000-4000-8000-000000000802',
              planId: '00000000-0000-4000-8000-000000000803',
              engineVersion: 3,
              editBucket: 'none',
            },
          }],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        code: 'PROMPT_WIZARD_MODEL_UNSUPPORTED',
        message: 'Seedance 2.5 暂不支持提示词向导来源，请移除 promptWizardSource 后重试。',
      });
      expect(mocks.createGenerationTasksBatch).toHaveBeenCalledOnce();
      expect(mocks.enqueueGenerationTask).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('批量 Seedream 图片生成传递结构化标注并按 claimEpoch 入队', async () => {
    mocks.createGenerationTasksBatch.mockResolvedValue([
      { id: 'task-image-1', attempt: 0, claimEpoch: 4 },
    ]);
    mocks.enqueueGenerationTask.mockResolvedValue(undefined);
    const app = makeGenerationApp();
    const assetId = '11111111-1111-4111-8111-111111111111';
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ai/image-tasks/batch',
        payload: {
          idempotencyKey: 'seedream-image-batch-0001',
          requests: [{
            model: 'Seedream 5.0 Pro',
            prompt: '把 @标记1 换成皇冠',
            config: { resolution: '1K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
            references: [{ assetId, role: 'reference_image' }],
            annotations: [{ token: '@标记1', assetId, type: 'point', x: 520, y: 460 }],
          }],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.createGenerationTasksBatch).toHaveBeenCalledWith({
        userId: 'user-1',
        idempotencyKey: 'seedream-image-batch-0001',
        requests: [{
          kind: 'image',
          model: 'Seedream 5.0 Pro',
          prompt: '把 @标记1 换成皇冠',
          config: { resolution: '1K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
          references: [{ assetId, role: 'reference_image' }],
          annotations: [{ token: '@标记1', assetId, type: 'point', x: 520, y: 460 }],
        }],
      });
      expect(mocks.enqueueGenerationTask).toHaveBeenCalledWith('task-image-1', 0, 4);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['config.referenceImages', {
      config: {
        mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5,
        referenceImages: [],
      },
    }],
    ['request.referenceAssets', {
      config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
      referenceAssets: [],
    }],
    ['references.objectKey', {
      config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
      references: [{
        assetId: '11111111-1111-4111-8111-111111111111', role: 'reference_image',
        objectKey: 'users/user-1/ref.png',
      }],
    }],
    ['references.thumbnailKey', {
      config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
      references: [{
        assetId: '11111111-1111-4111-8111-111111111111', role: 'reference_image',
        thumbnailKey: 'users/user-1/ref-thumb.jpg',
      }],
    }],
    ['references.url', {
      config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
      references: [{
        assetId: '11111111-1111-4111-8111-111111111111', role: 'reference_image',
        url: 'https://legacy.example.com/ref.png',
      }],
    }],
    ['任意深层 publicUrl', {
      config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
      legacy: { nested: { publicUrl: 'https://legacy.example.com/ref.png' } },
    }],
  ])('批量生成在创建或冻结积分前拒绝旧引用字段：%s', async (_label, legacyRequest) => {
    const app = makeGenerationApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ai/video-tasks/batch',
        payload: {
          idempotencyKey: 'batch-request-legacy-0001',
          requests: [{
            model: 'Seedance 2.0',
            prompt: '旧引用载荷',
            ...legacyRequest,
          }],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'INVALID_REFERENCE_PAYLOAD' });
      expect(mocks.createGenerationTasksBatch).not.toHaveBeenCalled();
      expect(mocks.requireAuth).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('GPT Image 未开放时图片任务入口不存在', async () => {
    const app = makeGenerationApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ai/image-tasks',
        payload: { model: 'GPT Image 2.0', prompt: '图片', config: {} },
      });
      expect(response.statusCode).toBe(404);
      expect(mocks.createGenerationTasksBatch).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

function makeGenerationApp() {
  const app = fastify({ logger: false });
  app.register(registerGenerationRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const fastifyError = error as { statusCode?: number; message?: string; code?: string };
    const statusCode = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 400;
    return reply.code(statusCode).send({ message: fastifyError.message, code: fastifyError.code });
  });
  return app;
}

function queryResult(rows: unknown[], totalCount: number | null = null) {
  const enrichedRows = rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const value = row as Record<string, unknown>;
    const timestamp = value.__pagination_cursor_timestamp ?? value.created_at;
    if (typeof timestamp !== 'string') return row;
    return {
      __pagination_total_count: totalCount,
      __pagination_cursor_timestamp: timestamp,
      ...value,
    };
  });
  return {
    rowCount: enrichedRows.length,
    rows: enrichedRows,
  };
}

function generationJobRow(id: string, createdAt: string) {
  return {
    id,
    user_id: 'user-1',
    user_name: '测试用户',
    email: 'user@example.com',
    kind: 'video',
    model: 'Seedance 2.0',
    status: 'queued',
    failure_category: null,
    failure_reason: null,
    config_aspect_ratio: '9:16',
    config_resolution: '720p',
    config_duration_seconds: '5',
    credits: 10,
    reserved_credits: 10,
    settled_credits: 0,
    refunded_credits: 0,
    credit_status: 'held',
    main_credits_used: 10,
    addon_credits_used: 0,
    asset_id: null,
    asset_name: null,
    asset_source: null,
    retry_count: 0,
    created_at: createdAt,
    started_at: null,
    completed_at: null,
  };
}

function generationTaskDetail(patch: Record<string, unknown>) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
    kind: 'video',
    model: 'Seedance 2.0',
    status: 'failed',
    failureCategory: 'provider-failed',
    failureReason: '供应商失败',
    prompt: '生成产品视频',
    config: { aspectRatio: '9:16', resolution: '480p', durationSeconds: 15 },
    credits: 20,
    reservedCredits: 20,
    settledCredits: 0,
    refundedCredits: 20,
    creditStatus: 'refunded',
    mainCreditsUsed: 20,
    addonCreditsUsed: 0,
    assetId: null,
    retryCount: 0,
    attempt: 0,
    processingStage: 'failed',
    cancelState: 'none',
    cancelRequestedAt: null,
    createdAt: '2026-07-27T07:32:00.000Z',
    startedAt: '2026-07-27T07:33:00.000Z',
    completedAt: '2026-07-27T07:36:00.000Z',
    updatedAt: '2026-07-27T07:36:00.000Z',
    ...patch,
  };
}

function ownedReferenceRow(
  id: string,
  type: 'image' | 'video' | 'audio',
  objectKey: string,
  thumbnailKey: string | null,
) {
  return {
    id,
    user_id: 'user-1',
    name: id,
    object_key: objectKey,
    thumbnail_key: thumbnailKey,
    thumbnail_status: thumbnailKey ? 'ready' : null,
    type,
    duration_seconds: type === 'image' ? null : 12,
    size_bytes: 1024,
    width: type === 'image' || type === 'video' ? 1280 : null,
    height: type === 'image' || type === 'video' ? 720 : null,
  };
}

function seedance25ConsumptionRows() {
  const combinations: Array<[number, string, number, number]> = [
    [5, '480p', 49, 30], [10, '480p', 86, 52], [15, '480p', 86, 52],
    [20, '480p', 115, 69], [25, '480p', 144, 87], [30, '480p', 172, 104],
    [5, '720p', 61, 37], [10, '720p', 107, 65], [15, '720p', 122, 74],
    [20, '720p', 163, 98], [25, '720p', 204, 123], [30, '720p', 244, 147],
  ];
  return combinations.map(([duration, resolution, credits, referenceVideoCredits], index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    kind: 'video',
    model: 'Seedance 2.5',
    model_label: 'Seedance 2.5',
    duration_seconds: duration,
    resolution,
    credits,
    reference_video_credits: referenceVideoCredits,
    available: true,
    updated_at: '2026-08-12T00:00:00.000Z',
  }));
}
