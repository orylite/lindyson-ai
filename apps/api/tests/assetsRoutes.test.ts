import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  requireAuth: vi.fn(),
  withTransaction: vi.fn(),
  createObjectReadUrl: vi.fn(),
  createObjectDownloadUrl: vi.fn(),
  deleteObjects: vi.fn(),
  deleteObject: vi.fn(),
  readStoredObjectSize: vi.fn(),
  scheduleAssetDeletion: vi.fn(),
  createOrReplayUploadSession: vi.fn(),
  queueUploadCompletion: vi.fn(),
  getOwnedUploadSession: vi.fn(),
  cancelOwnedUploadSession: vi.fn(),
  retryOwnedUploadSession: vi.fn(),
  paginationTotal: 2,
}));

vi.mock('../src/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
  },
  withTransaction: mocks.withTransaction,
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

vi.mock('../src/domain/assetDeletionService.js', () => ({
  scheduleAssetDeletion: mocks.scheduleAssetDeletion,
}));

vi.mock('../src/domain/uploadSessionService.js', () => ({
  createOrReplayUploadSession: mocks.createOrReplayUploadSession,
  queueUploadCompletion: mocks.queueUploadCompletion,
  getOwnedUploadSession: mocks.getOwnedUploadSession,
  cancelOwnedUploadSession: mocks.cancelOwnedUploadSession,
  retryOwnedUploadSession: mocks.retryOwnedUploadSession,
}));

vi.mock('../src/storage/storageService.js', () => ({
  UPLOAD_MAX_BYTES: 1024 * 1024 * 1024,
  buildPublicUrl: (objectKey: string) => `https://storage.example.com/${objectKey}`,
  createObjectReadUrl: mocks.createObjectReadUrl,
  createObjectDownloadUrl: mocks.createObjectDownloadUrl,
  deleteObjects: mocks.deleteObjects,
  deleteObject: mocks.deleteObject,
  readStoredObjectSize: mocks.readStoredObjectSize,
}));

import { resetAssetReadUrlSignerForTests } from '../src/domain/assetReadUrlSigner.js';
import { buildAssetDownloadFilename } from '../src/domain/assetDownloadService.js';
import { registerAssetsRoutes } from '../src/routes/assetsRoutes.js';

const TEST_ASSET_ID = '11111111-1111-4111-8111-111111111111';
const TEST_SECOND_ASSET_ID = '55555555-5555-4555-8555-555555555555';
const TEST_MISSING_ASSET_ID = '33333333-3333-4333-8333-333333333333';
const TEST_FOLDER_ID = '22222222-2222-4222-8222-222222222222';
const TEST_OTHER_FOLDER_ID = '44444444-4444-4444-8444-444444444444';

describe('assetsRoutes', () => {
  beforeEach(() => {
    resetAssetReadUrlSignerForTests();
    mocks.poolQuery.mockReset();
    mocks.requireAuth.mockReset();
    mocks.withTransaction.mockReset();
    mocks.createObjectReadUrl.mockReset();
    mocks.createObjectDownloadUrl.mockReset();
    mocks.deleteObjects.mockReset();
    mocks.deleteObject.mockReset();
    mocks.readStoredObjectSize.mockReset();
    mocks.scheduleAssetDeletion.mockReset();
    mocks.createOrReplayUploadSession.mockReset();
    mocks.queueUploadCompletion.mockReset();
    mocks.getOwnedUploadSession.mockReset();
    mocks.cancelOwnedUploadSession.mockReset();
    mocks.retryOwnedUploadSession.mockReset();
    mocks.paginationTotal = 2;

    mocks.requireAuth.mockResolvedValue({ id: 'user-1', email: 'user@example.com', role: 'user' });
    mocks.createObjectReadUrl.mockImplementation(async (objectKey: string) => `https://read.example.com/${objectKey}`);
    mocks.createObjectDownloadUrl.mockImplementation(async (objectKey: string) => `https://download.example.com/${objectKey}`);
    mocks.deleteObjects.mockResolvedValue(undefined);
    mocks.readStoredObjectSize.mockResolvedValue(20 * 1024 * 1024);
    mocks.scheduleAssetDeletion.mockImplementation(async (_client: unknown, _userId: string, assetIds: string[]) => assetIds.length);
    const session = uploadSessionDto();
    mocks.createOrReplayUploadSession.mockResolvedValue({
      signature: {
        driver: 'local', method: 'PUT', uploadUrl: 'http://localhost/upload', headers: { 'content-type': 'image/png' },
        objectKey: 'users/user-1/upload-staging/session/image.png', expiresAt: session.expiresAt,
        maxSizeBytes: 2048, sessionId: session.id,
      },
      session,
    });
    mocks.queueUploadCompletion.mockResolvedValue({ ...session, processingStage: 'queued', progress: 10 });
    mocks.getOwnedUploadSession.mockResolvedValue(session);
    mocks.cancelOwnedUploadSession.mockResolvedValue({ ...session, status: 'canceled', processingStage: 'canceled', progress: 100 });
    mocks.retryOwnedUploadSession.mockResolvedValue({ ...session, processingStage: 'queued', progress: 10 });
  });

  it('文件夹列表固定系统目录在前并按创建时间和 ID 倒序', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      folderRow({ id: 'folder-main', name: '主目录', is_system: true, created_at: '2026-06-01T00:00:00.000Z' }),
      folderRow({ id: 'folder-new-b', name: '最新目录 B', created_at: '2026-07-12T10:00:00.000Z' }),
      folderRow({ id: 'folder-new-a', name: '最新目录 A', created_at: '2026-07-12T10:00:00.000Z' }),
      folderRow({ id: 'folder-old', name: '旧目录', created_at: '2026-07-01T10:00:00.000Z' }),
    ]));
    const app = makeAssetsApp(transactionClient(() => queryResult([])));

    try {
      const response = await app.inject({ method: 'GET', url: '/api/assets/folders?source=uploaded-image' });

      expect(response.statusCode).toBe(200);
      expect(response.json().items.map((folder: { name: string }) => folder.name)).toEqual([
        '主目录',
        '最新目录 B',
        '最新目录 A',
        '旧目录',
      ]);
      expect(mocks.poolQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY is_system DESC, created_at DESC, id DESC'),
        ['user-1', 'uploaded-image'],
      );
    } finally {
      await app.close();
    }
  });

  it('上传签名只接受幂等会话契约并返回会话视图', async () => {
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const payload = {
        filename: 'image.png', contentType: 'image/png', sizeBytes: 2048,
        source: 'uploaded-image', folderId: null, idempotencyKey: 'upload-image-stable-key',
      };
      const response = await app.inject({ method: 'POST', url: '/api/assets/upload-signature', payload });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(expect.objectContaining({
        signature: expect.objectContaining({ sessionId: uploadSessionDto().id }),
        session: expect.objectContaining({ id: uploadSessionDto().id, status: 'pending' }),
      }));
      expect(mocks.createOrReplayUploadSession).toHaveBeenCalledWith('user-1', payload);
    } finally {
      await app.close();
    }
  });

  it('complete 只接收 uploadSessionId 并返回排队后的同一会话', async () => {
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/assets/complete-upload', payload: { uploadSessionId: uploadSessionDto().id },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().session).toEqual(expect.objectContaining({ processingStage: 'queued' }));
      expect(mocks.queueUploadCompletion).toHaveBeenCalledWith('user-1', uploadSessionDto().id);
    } finally {
      await app.close();
    }
  });

  it('签名接口拒绝缺少来源或幂等键的旧请求', async () => {
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/assets/upload-signature',
        payload: { filename: 'image.png', contentType: 'image/png', sizeBytes: 2048 },
      });
      expect(response.statusCode).toBe(400);
      expect(mocks.createOrReplayUploadSession).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('complete 拒绝客户端对象路径和媒体事实', async () => {
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/assets/complete-upload',
        payload: {
          uploadSessionId: uploadSessionDto().id,
          objectKey: 'users/user-1/legacy/image.png',
          type: 'image',
          sizeBytes: 2048,
        },
      });
      expect(response.statusCode).toBe(400);
      expect(mocks.queueUploadCompletion).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('会话查询、取消和重试始终按当前登录用户隔离', async () => {
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    const id = uploadSessionDto().id;
    try {
      const [read, cancel, retry] = await Promise.all([
        app.inject({ method: 'GET', url: `/api/assets/upload-sessions/${id}` }),
        app.inject({ method: 'POST', url: `/api/assets/upload-sessions/${id}/cancel` }),
        app.inject({ method: 'POST', url: `/api/assets/upload-sessions/${id}/retry` }),
      ]);
      expect([read.statusCode, cancel.statusCode, retry.statusCode]).toEqual([200, 200, 200]);
      expect(mocks.getOwnedUploadSession).toHaveBeenCalledWith('user-1', id);
      expect(mocks.cancelOwnedUploadSession).toHaveBeenCalledWith('user-1', id);
      expect(mocks.retryOwnedUploadSession).toHaveBeenCalledWith('user-1', id);
    } finally {
      await app.close();
    }
  });

  it('素材更新传入 null 时移动到对应来源的真实系统主目录', async () => {
    const lockOrder: string[] = [];
    const client = transactionClient(async (sql: unknown, params?: unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT id, source FROM assets') && !query.includes('FOR UPDATE')) {
        lockOrder.push('observe-asset');
        return queryResult([{ id: TEST_ASSET_ID, source: 'uploaded-image' }]);
      }
      if (query.includes('FROM assets') && query.includes('FOR UPDATE')) {
        lockOrder.push('lock-asset');
        return queryResult([assetRow({ id: TEST_ASSET_ID, source: 'uploaded-image', folder_id: TEST_FOLDER_ID })]);
      }
      if (query.includes('FROM asset_folders')) {
        lockOrder.push('lock-folder');
        expect(params).toEqual(['user-1', 'uploaded-image']);
        return queryResult([{ id: 'system-root-uploaded-image' }]);
      }
      if (query.includes('UPDATE assets')) {
        expect(params?.[3]).toBe('system-root-uploaded-image');
        return queryResult([assetRow({
          id: TEST_ASSET_ID,
          type: 'image',
          source: 'uploaded-image',
          folder_id: 'system-root-uploaded-image',
        })]);
      }
      throw new Error(`未预期的查询：${query}`);
    });
    const app = makeAssetsApp(client);

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/assets/${TEST_ASSET_ID}`,
        payload: { folderId: null },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().asset.folderId).toBe('system-root-uploaded-image');
      expect(response.json().asset).not.toHaveProperty('objectKey');
      expect(response.json().asset).not.toHaveProperty('thumbnailKey');
      expect(response.json().asset).not.toHaveProperty('generation');
      expect(lockOrder).toEqual(['observe-asset', 'lock-folder', 'lock-asset']);
    } finally {
      await app.close();
    }
  });

  it('素材只重命名时直接锁素材且不获取目录锁', async () => {
    const queries: string[] = [];
    const client = transactionClient(async (sql: unknown, params?: unknown[]) => {
      const query = String(sql);
      queries.push(query);
      if (query.includes('FROM assets') && query.includes('FOR UPDATE')) {
        return queryResult([assetRow({ id: TEST_ASSET_ID, name: '旧名称' })]);
      }
      if (query.includes('UPDATE assets')) {
        expect(params).toEqual([TEST_ASSET_ID, 'user-1', '新名称']);
        return queryResult([assetRow({ id: TEST_ASSET_ID, name: '新名称' })]);
      }
      throw new Error(`未预期的查询：${query}`);
    });
    const app = makeAssetsApp(client);

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/assets/${TEST_ASSET_ID}`,
        payload: { name: '新名称' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().asset.name).toBe('新名称');
      expect(queries.some(query => query.includes('FROM asset_folders'))).toBe(false);
      expect(queries.filter(query => query.includes('FROM assets'))).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('素材移动锁定后来源与观察值不一致时回滚并返回 409', async () => {
    let assetReadCount = 0;
    const client = transactionClient(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM assets') && query.includes('SELECT')) {
        assetReadCount += 1;
        return queryResult([assetReadCount === 1
          ? { id: TEST_ASSET_ID, source: 'uploaded-image' }
          : assetRow({ id: TEST_ASSET_ID, source: 'ai-image' })]);
      }
      if (query.includes('FROM asset_folders')) return queryResult([{ id: 'system-root-uploaded-image' }]);
      if (query.includes('UPDATE assets')) throw new Error('竞态重验失败后不得更新素材');
      throw new Error(`未预期的查询：${query}`);
    });
    const app = makeAssetsApp(client);

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/assets/${TEST_ASSET_ID}`,
        payload: { folderId: null },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        message: '素材位置已变化，请刷新后重试',
        code: 'ASSET_MOVE_RACE_CONFLICT',
      });
      expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE assets'))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('批量移动传入 null 时统一落到素材来源的真实系统主目录', async () => {
    const client = transactionClient(async (sql: unknown, params?: unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT id, source FROM assets')) {
        return queryResult([{ id: TEST_ASSET_ID, source: 'ai-video' }]);
      }
      if (query.includes('FROM asset_folders')) {
        expect(params).toEqual(['user-1', 'ai-video']);
        return queryResult([{ id: 'system-root-ai-video' }]);
      }
      if (query.includes('UPDATE assets')) {
        expect(params?.[2]).toBe('system-root-ai-video');
        return queryResult([assetRow({ id: TEST_ASSET_ID, folder_id: 'system-root-ai-video' })]);
      }
      throw new Error(`未预期的查询：${query}`);
    });
    const app = makeAssetsApp(client);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/assets/bulk-move',
        payload: { assetIds: [TEST_ASSET_ID], folderId: null },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().items[0].folderId).toBe('system-root-ai-video');
      expect(JSON.stringify(response.json())).not.toMatch(/objectKey|thumbnailKey|generation/);
    } finally {
      await app.close();
    }
  });

  it('不同来源素材批量移动到主目录时分别解析各自真实系统目录', async () => {
    const resolvedSources: string[] = [];
    const updatedFolders = new Map<string, string>();
    const lockOrder: string[] = [];
    const client = transactionClient(async (sql: unknown, params?: unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT id, source FROM assets')) {
        lockOrder.push(query.includes('FOR UPDATE') ? 'lock-assets' : 'observe-assets');
        return queryResult([
          { id: TEST_ASSET_ID, source: 'ai-video' },
          { id: TEST_SECOND_ASSET_ID, source: 'uploaded-image' },
        ]);
      }
      if (query.includes('FROM asset_folders')) {
        const source = String(params?.[1]);
        resolvedSources.push(source);
        lockOrder.push(`lock-folder:${source}`);
        return queryResult([{ id: `system-root-${source}` }]);
      }
      if (query.includes('UPDATE assets')) {
        const assetIds = params?.[1] as string[];
        const folderId = String(params?.[2]);
        for (const assetId of assetIds) updatedFolders.set(assetId, folderId);
        return queryResult(assetIds.map(assetId => assetRow({
          id: assetId,
          type: assetId === TEST_ASSET_ID ? 'video' : 'image',
          source: assetId === TEST_ASSET_ID ? 'ai-video' : 'uploaded-image',
          folder_id: folderId,
        })));
      }
      throw new Error(`未预期的查询：${query}`);
    });
    const app = makeAssetsApp(client);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/assets/bulk-move',
        payload: { assetIds: [TEST_ASSET_ID, TEST_SECOND_ASSET_ID], folderId: null },
      });

      expect(response.statusCode).toBe(200);
      expect(resolvedSources).toEqual(['ai-video', 'uploaded-image']);
      expect(lockOrder).toEqual([
        'observe-assets',
        'lock-folder:ai-video',
        'lock-folder:uploaded-image',
        'lock-assets',
      ]);
      expect(updatedFolders).toEqual(new Map([
        [TEST_ASSET_ID, 'system-root-ai-video'],
        [TEST_SECOND_ASSET_ID, 'system-root-uploaded-image'],
      ]));
      expect(response.json().items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: TEST_ASSET_ID, folderId: 'system-root-ai-video' }),
        expect.objectContaining({ id: TEST_SECOND_ASSET_ID, folderId: 'system-root-uploaded-image' }),
      ]));
    } finally {
      await app.close();
    }
  });

  it('批量移动在目录锁后重验素材集合，竞态变化时不执行任何更新', async () => {
    let assetReadCount = 0;
    const client = transactionClient(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT id, source FROM assets')) {
        assetReadCount += 1;
        return assetReadCount === 1
          ? queryResult([{ id: TEST_ASSET_ID, source: 'ai-video' }])
          : queryResult([]);
      }
      if (query.includes('FROM asset_folders')) return queryResult([{ id: 'system-root-ai-video' }]);
      if (query.includes('UPDATE assets')) throw new Error('素材集合变化后不得执行更新');
      throw new Error(`未预期的查询：${query}`);
    });
    const app = makeAssetsApp(client);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/assets/bulk-move',
        payload: { assetIds: [TEST_ASSET_ID], folderId: null },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('ASSET_MOVE_RACE_CONFLICT');
      expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE assets'))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('素材卡片只查询当前用户、只签 ready 缩略图且不返回对象 key 或生成配置', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      assetRow({
        id: TEST_ASSET_ID,
        user_id: 'user-1',
        source: 'ai-video',
        object_key: 'users/user-1/video.mp4',
        thumbnail_key: 'users/user-1/video-thumb.jpg',
        thumbnail_status: 'ready',
      }),
    ]));
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({ method: 'GET', url: '/api/assets/cards?source=ai-video&type=video' });

      expect(response.statusCode).toBe(200);
      expect(mocks.poolQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1'),
        ['user-1', 'ai-video', 'video', 25],
      );
      const sql = String(mocks.poolQuery.mock.calls[0]?.[0]);
      expect(sql).not.toContain('SELECT *');
      expect(sql).not.toContain('generation_meta');
      expect(response.json().items[0]).toEqual(expect.objectContaining({
        id: TEST_ASSET_ID,
        previewUrl: 'https://read.example.com/users/user-1/video-thumb.jpg',
        firstDownloadAt: null,
      }));
      expect(response.json().items[0]).not.toHaveProperty('objectKey');
      expect(response.json().items[0]).not.toHaveProperty('publicUrl');
      expect(response.json().items[0]).not.toHaveProperty('generation');
      expect(mocks.createObjectReadUrl).toHaveBeenCalledTimes(1);
      expect(mocks.createObjectReadUrl).toHaveBeenCalledWith('users/user-1/video-thumb.jpg');
    } finally {
      await app.close();
    }
  });

  it('旧 GET /api/assets 全量入口已移除并精确返回 404', async () => {
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({ method: 'GET', url: '/api/assets' });

      expect(response.statusCode).toBe(404);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
      expect(mocks.createObjectReadUrl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('素材卡片映射首次下载时间，非 ready 或等于原图的缩略图固定返回空预览', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      assetRow({
        id: TEST_ASSET_ID,
        downloaded_at: new Date('2026-07-08T09:10:11.000Z'),
        thumbnail_key: 'users/user-1/video-thumb.jpg',
        thumbnail_status: 'pending',
      }),
      assetRow({
        id: TEST_SECOND_ASSET_ID,
        object_key: 'users/user-1/image.png',
        thumbnail_key: 'users/user-1/image.png',
        thumbnail_status: 'ready',
      }),
    ]));
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({ method: 'GET', url: '/api/assets/cards' });

      expect(response.statusCode).toBe(200);
      expect(response.json().items[0]).toEqual(expect.objectContaining({
        id: TEST_ASSET_ID,
        firstDownloadAt: '2026-07-08T09:10:11.000Z',
        previewUrl: null,
      }));
      expect(response.json().items[1].previewUrl).toBeNull();
      expect(mocks.createObjectReadUrl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('素材卡片支持 first/next/previous/last 四向复合游标且始终按最新在前展示', async () => {
    mocks.paginationTotal = 3;
    const firstId = '11111111-1111-4111-8111-111111111111';
    const secondId = '22222222-2222-4222-8222-222222222222';
    const thirdId = '33333333-3333-4333-8333-333333333333';
    const firstAt = '2026-07-11T10:00:00.000Z';
    const secondAt = '2026-07-11T09:00:00.000Z';
    const thirdAt = '2026-07-11T08:00:00.000Z';
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      assetRow({ id: firstId, created_at: firstAt }),
      assetRow({ id: secondId, created_at: secondAt }),
    ]));
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const first = await app.inject({ method: 'GET', url: '/api/assets/cards?position=first&limit=1' });
      expect(first.statusCode).toBe(200);
      expect(String(mocks.poolQuery.mock.calls.at(-1)?.[0])).not.toContain('__pagination_total_count');
      expect(first.json().pagination).toEqual({
        limit: 1,
        position: 'first',
        hasPrevious: false,
        hasNext: true,
        previousCursor: null,
        nextCursor: expect.any(String),
        currentPage: 1,
        totalPages: 3,
        totalItems: 3,
        snapshotCursor: expect.any(String),
      });
      const cursor = first.json().pagination.nextCursor;
      mocks.poolQuery.mockResolvedValueOnce(queryResult([
        assetRow({ id: secondId, created_at: secondAt }),
        assetRow({ id: thirdId, created_at: thirdAt }),
      ]));

      const next = await app.inject({
        method: 'GET',
        url: `/api/assets/cards?position=next&limit=1&cursor=${encodeURIComponent(cursor)}`,
      });
      expect(next.statusCode).toBe(200);
      expect(mocks.poolQuery.mock.calls.at(-1)?.[1]).toEqual(['user-1', firstAt, firstId, 2]);
      expect(next.json().items[0].id).toBe(secondId);
      expect(next.json().pagination).toEqual(expect.objectContaining({
        position: 'next', hasPrevious: true, hasNext: true,
        previousCursor: expect.any(String), nextCursor: expect.any(String),
      }));

      mocks.poolQuery.mockResolvedValueOnce(queryResult([assetRow({ id: firstId, created_at: firstAt })]));
      const previous = await app.inject({
        method: 'GET',
        url: `/api/assets/cards?position=previous&limit=1&cursor=${encodeURIComponent(next.json().pagination.previousCursor)}`,
      });
      expect(previous.statusCode).toBe(200);
      expect(previous.json().items[0].id).toBe(firstId);
      expect(String(mocks.poolQuery.mock.calls.at(-1)?.[0])).toContain('(created_at, id) >');
      expect(String(mocks.poolQuery.mock.calls.at(-1)?.[0])).toContain('ORDER BY created_at ASC, id ASC');

      mocks.poolQuery.mockResolvedValueOnce(queryResult([
        assetRow({ id: thirdId, created_at: thirdAt, __pagination_total_count: '3' }),
        assetRow({ id: secondId, created_at: secondAt, __pagination_total_count: '3' }),
      ]));
      const last = await app.inject({ method: 'GET', url: '/api/assets/cards?position=last&limit=1' });
      expect(last.statusCode).toBe(200);
      const lastSql = String(mocks.poolQuery.mock.calls.at(-1)?.[0]);
      expect(lastSql).not.toContain('count(*) OVER()::bigint');
      expect(lastSql).not.toContain('OFFSET');
      expect(last.json().items[0].id).toBe(thirdId);
      expect(last.json().pagination).toEqual(expect.objectContaining({
        position: 'last', hasPrevious: true, hasNext: false,
      }));
    } finally {
      await app.close();
    }
  });

  it('素材卡片按最早在前时四向游标同步翻转比较符和查询顺序', async () => {
    const oldestId = '11111111-1111-4111-8111-111111111111';
    const middleId = '22222222-2222-4222-8222-222222222222';
    const newestId = '33333333-3333-4333-8333-333333333333';
    const oldestAt = '2026-07-11T08:00:00.000Z';
    const middleAt = '2026-07-11T09:00:00.000Z';
    const newestAt = '2026-07-11T10:00:00.000Z';
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      assetRow({ id: oldestId, created_at: oldestAt }),
      assetRow({ id: middleId, created_at: middleAt }),
    ]));
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const first = await app.inject({
        method: 'GET',
        url: '/api/assets/cards?position=first&limit=1&sort=created-asc',
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().items[0].id).toBe(oldestId);
      expect(String(mocks.poolQuery.mock.calls.at(-1)?.[0]))
        .toContain('ORDER BY created_at ASC, id ASC');

      mocks.poolQuery.mockResolvedValueOnce(queryResult([
        assetRow({ id: middleId, created_at: middleAt }),
        assetRow({ id: newestId, created_at: newestAt }),
      ]));
      const next = await app.inject({
        method: 'GET',
        url: `/api/assets/cards?position=next&limit=1&sort=created-asc&cursor=${encodeURIComponent(first.json().pagination.nextCursor)}`,
      });
      expect(next.statusCode).toBe(200);
      expect(next.json().items[0].id).toBe(middleId);
      expect(String(mocks.poolQuery.mock.calls.at(-1)?.[0])).toContain('(created_at, id) >');
      expect(String(mocks.poolQuery.mock.calls.at(-1)?.[0]))
        .toContain('ORDER BY created_at ASC, id ASC');

      mocks.poolQuery.mockResolvedValueOnce(queryResult([
        assetRow({ id: oldestId, created_at: oldestAt }),
      ]));
      const previous = await app.inject({
        method: 'GET',
        url: `/api/assets/cards?position=previous&limit=1&sort=created-asc&cursor=${encodeURIComponent(next.json().pagination.previousCursor)}`,
      });
      expect(previous.statusCode).toBe(200);
      expect(previous.json().items[0].id).toBe(oldestId);
      expect(String(mocks.poolQuery.mock.calls.at(-1)?.[0])).toContain('(created_at, id) <');
      expect(String(mocks.poolQuery.mock.calls.at(-1)?.[0]))
        .toContain('ORDER BY created_at DESC, id DESC');

      mocks.poolQuery.mockResolvedValueOnce(queryResult([
        assetRow({ id: newestId, created_at: newestAt, __pagination_total_count: '3' }),
        assetRow({ id: middleId, created_at: middleAt, __pagination_total_count: '3' }),
      ]));
      const last = await app.inject({
        method: 'GET',
        url: '/api/assets/cards?position=last&limit=1&sort=created-asc',
      });
      expect(last.statusCode).toBe(200);
      expect(last.json().items[0].id).toBe(newestId);
      expect(last.json().pagination).toEqual(expect.objectContaining({
        position: 'last', hasPrevious: true, hasNext: false,
      }));
      expect(String(mocks.poolQuery.mock.calls.at(-1)?.[0]))
        .toContain('ORDER BY created_at DESC, id DESC');
    } finally {
      await app.close();
    }
  });

  it('素材游标不能跨筛选重放，错误码统一为 INVALID_CURSOR', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      assetRow({ id: TEST_ASSET_ID }),
      assetRow({ id: TEST_SECOND_ASSET_ID }),
    ]));
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const first = await app.inject({
        method: 'GET',
        url: '/api/assets/cards?position=first&source=ai-video&limit=1',
      });
      const cursor = first.json().pagination.nextCursor;
      mocks.poolQuery.mockClear();

      const mismatch = await app.inject({
        method: 'GET',
        url: `/api/assets/cards?position=next&source=uploaded-video&limit=1&cursor=${encodeURIComponent(cursor)}`,
      });
      expect(mismatch.statusCode).toBe(400);
      expect(mismatch.json().code).toBe('INVALID_CURSOR');
      expect(mocks.poolQuery).not.toHaveBeenCalled();

      const sortMismatch = await app.inject({
        method: 'GET',
        url: `/api/assets/cards?position=next&source=ai-video&sort=created-asc&limit=1&cursor=${encodeURIComponent(cursor)}`,
      });
      expect(sortMismatch.statusCode).toBe(400);
      expect(sortMismatch.json().code).toBe('INVALID_CURSOR');
      expect(mocks.poolQuery).not.toHaveBeenCalled();

      const tampered = `x${String(cursor).slice(1)}`;
      const damaged = await app.inject({
        method: 'GET',
        url: `/api/assets/cards?position=next&source=ai-video&limit=1&cursor=${encodeURIComponent(tampered)}`,
      });
      expect(damaged.statusCode).toBe(400);
      expect(damaged.json().code).toBe('INVALID_CURSOR');
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('素材汇总一次返回全局类型、来源、下载和文件夹计数', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([{
        total: 8, video_count: 4, image_count: 3, audio_count: 1,
        ai_video_count: 2, ai_image_count: 1, uploaded_video_count: 2,
        uploaded_image_count: 2, uploaded_audio_count: 1, downloaded_count: 3,
      }]))
      .mockResolvedValueOnce(queryResult([
        { folder_id: null, count: 2 },
        { folder_id: TEST_FOLDER_ID, count: 6 },
      ]));
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({ method: 'GET', url: '/api/assets/summary' });
      expect(response.statusCode).toBe(200);
      expect(response.json().summary).toEqual({
        total: 8,
        byType: { video: 4, image: 3, audio: 1 },
        bySource: {
          'ai-video': 2, 'ai-image': 1, 'uploaded-video': 2,
          'uploaded-image': 2, 'uploaded-audio': 1,
        },
        downloaded: 3,
        notDownloaded: 5,
        folderCounts: [
          { folderId: null, count: 2 },
          { folderId: TEST_FOLDER_ID, count: 6 },
        ],
      });
      expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it('即时下载只重定向到原始对象并记录 downloadRequestedAt', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([{ object_key: 'users/user-1/video.mp4', name: '成片.mp4' }]))
      .mockResolvedValueOnce(queryResult([{ object_key: 'users/user-1/video.mp4' }]));
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({ method: 'GET', url: `/api/assets/${TEST_ASSET_ID}/download` });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('https://download.example.com/users/user-1/video.mp4');
      expect(mocks.poolQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('SET download_requested_at = COALESCE(download_requested_at, now())'),
        [TEST_ASSET_ID, 'user-1'],
      );
      expect(mocks.readStoredObjectSize).toHaveBeenCalledWith('users/user-1/video.mp4');
      expect(mocks.createObjectDownloadUrl).toHaveBeenCalledWith('users/user-1/video.mp4', '成片.mp4');
    } finally {
      await app.close();
    }
  });

  it('POST 下载会返回规范文件名、短期地址和首次下载时间', async () => {
    const firstRequestedAt = new Date('2026-07-11T15:40:00.000Z');
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([{ object_key: 'generated/video/asset-1.mp4', name: 'Seedance 2.0 视频 2026-07-11' }]))
      .mockResolvedValueOnce(queryResult([{ download_requested_at: firstRequestedAt }]));
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({ method: 'POST', url: `/api/assets/${TEST_ASSET_ID}/download` });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        download: {
          url: 'https://download.example.com/generated/video/asset-1.mp4',
          filename: 'Seedance 2.0 视频 2026-07-11.mp4',
          downloadRequestedAt: '2026-07-11T15:40:00.000Z',
        },
      });
      expect(mocks.createObjectDownloadUrl).toHaveBeenCalledWith(
        'generated/video/asset-1.mp4',
        'Seedance 2.0 视频 2026-07-11.mp4',
      );
      expect(mocks.poolQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('RETURNING download_requested_at'),
        [TEST_ASSET_ID, 'user-1'],
      );
    } finally {
      await app.close();
    }
  });

  it('POST 下载在原文件缺失时不会记录状态或签发地址', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([{
      object_key: 'generated/video/missing.mp4',
      name: '缺失原文件',
    }]));
    mocks.readStoredObjectSize.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({ method: 'POST', url: `/api/assets/${TEST_ASSET_ID}/download` });

      expect(response.statusCode).toBe(404);
      expect(response.json().message).toBe('素材原始文件不存在');
      expect(response.json().code).toBe('ASSET_ORIGINAL_MISSING');
      expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
      expect(mocks.createObjectDownloadUrl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('用户下载他人或不存在的资产仍统一返回 404', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([]));
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({ method: 'POST', url: `/api/assets/${TEST_ASSET_ID}/download` });

      expect(response.statusCode).toBe(404);
      expect(response.json().message).toBe('素材不存在');
      expect(mocks.poolQuery).toHaveBeenCalledWith(
        expect.stringMatching(/id = \$1 AND user_id = \$2 AND deletion_status = 'active'/),
        [TEST_ASSET_ID, 'user-1'],
      );
      expect(mocks.readStoredObjectSize).not.toHaveBeenCalled();
      expect(mocks.createObjectDownloadUrl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    ['video', 'users/user-1/missing.mp4'],
    ['audio', 'users/user-1/missing.mp3'],
  ])('%s 素材缺少原文件时不回退缩略图且不记录下载请求', async (_type, objectKey) => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([{ object_key: objectKey, name: '缺失原文件' }]));
    mocks.readStoredObjectSize.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({ method: 'GET', url: `/api/assets/${TEST_ASSET_ID}/download` });

      expect(response.statusCode).toBe(404);
      expect(response.json().message).toBe('素材原始文件不存在');
      expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
      expect(mocks.createObjectDownloadUrl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('素材详情只返回主资产短期 URL 和去 key 的参考素材预览', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([
        assetRow({
        generation_meta: {
          kind: 'video',
          model: 'Seedance 2.0',
          prompt: '生成提示词',
          config: {
            aspectRatio: '16:9',
            resolution: '720p',
            durationSeconds: 6,
            referenceImages: [
              {
                id: 'ref-image',
                name: '参考图',
                objectKey: 'users/user-1/ref.png',
                thumbnailKey: 'users/victim/private-image.jpg',
                thumbnail: 'https://expired.example.com/ref-thumb.jpg',
              },
              {
                id: '00000000-0000-4000-8000-000000000209',
                name: '旧外链参考图',
                thumbnail: 'https://legacy.example.com/ref.jpg',
                publicUrl: 'https://legacy.example.com/original.jpg',
              },
            ],
            referenceAssets: [
              {
                id: 'ref-video',
                name: '参考视频',
                type: 'video',
                objectKey: 'users/user-1/ref.mp4',
                thumbnailKey: 'users/victim/private-video.jpg',
                thumbnail: 'https://expired.example.com/ref-video.jpg',
              },
            ],
          },
          credits: 20,
        },
        }),
      ]))
      .mockResolvedValueOnce(queryResult([
        {
          id: '00000000-0000-4000-8000-000000000201',
          user_id: 'user-1',
          name: '数据库参考图',
          object_key: 'users/user-1/ref.png',
          thumbnail_key: 'users/user-1/ref-thumb.jpg',
          thumbnail_status: 'ready',
          type: 'image',
          duration_seconds: null,
          size_bytes: 1024,
        },
        {
          id: '00000000-0000-4000-8000-000000000202',
          user_id: 'user-1',
          name: '数据库参考视频',
          object_key: 'users/user-1/ref.mp4',
          thumbnail_key: 'users/user-1/ref-video.jpg',
          thumbnail_status: 'ready',
          type: 'video',
          duration_seconds: 6,
          size_bytes: 2048,
        },
      ]));

    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/assets/${TEST_ASSET_ID}`,
      });

      expect(response.statusCode).toBe(200);
      const asset = response.json().asset;
      expect(asset.publicUrl).toBe('https://read.example.com/users/user-1/video.mp4');
      expect(asset).not.toHaveProperty('objectKey');
      expect(asset).not.toHaveProperty('thumbnailKey');
      expect(asset.generation.config.referenceImages[0]).toEqual(expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000201',
        name: '数据库参考图',
        type: 'image',
        previewUrl: 'https://read.example.com/users/user-1/ref-thumb.jpg',
      }));
      expect(asset.generation.config.referenceImages).toHaveLength(2);
      expect(asset.generation.config.referenceImages[1]).toEqual(expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000209',
        name: '旧外链参考图',
        type: 'image',
        previewUrl: null,
      }));
      expect(asset.generation.config.referenceAssets[0]).toEqual(expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000202',
        name: '数据库参考视频',
        type: 'video',
        previewUrl: 'https://read.example.com/users/user-1/ref-video.jpg',
      }));
      expect(mocks.createObjectReadUrl).toHaveBeenCalledWith('users/user-1/ref-thumb.jpg');
      expect(mocks.createObjectReadUrl).toHaveBeenCalledWith('users/user-1/ref-video.jpg');
      expect(mocks.createObjectReadUrl).not.toHaveBeenCalledWith('users/user-1/ref.png');
      expect(mocks.createObjectReadUrl).not.toHaveBeenCalledWith('users/user-1/ref.mp4');
      expect(mocks.createObjectReadUrl).not.toHaveBeenCalledWith('users/victim/private-image.jpg');
      expect(mocks.createObjectReadUrl).not.toHaveBeenCalledWith('users/victim/private-video.jpg');
      expect(JSON.stringify(asset.generation)).not.toMatch(/objectKey|thumbnailKey|publicUrl/);
      expect(JSON.stringify(asset.generation)).not.toContain('legacy.example.com');
    } finally {
      await app.close();
    }
  });

  it('Seedream 图片详情保留安全的提示词模式与交互标记供沿用生成恢复', async () => {
    const referenceId = '00000000-0000-4000-8000-000000000201';
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([
        assetRow({
          type: 'image',
          source: 'ai-image',
          object_key: 'users/user-1/generated.png',
          generation_meta: {
            kind: 'image',
            model: 'Seedream 5.0 Pro',
            prompt: '把 @标记1 附近的主体移到 @标记2 区域',
            config: {
              resolution: '2K',
              aspectRatio: '3:4',
              optimizePromptMode: 'fast',
              annotations: [
                { token: '@标记1', assetId: referenceId, type: 'point', x: 0, y: 999 },
                { token: '@标记2', assetId: referenceId, type: 'bbox', x1: 120, y1: 180, x2: 640, y2: 760 },
                { token: '@非法', assetId: referenceId, type: 'point', x: 500, y: 500 },
                { token: '@标记3', assetId: referenceId, type: 'point', x: -1, y: 1000 },
              ],
              referenceAssets: [{
                id: referenceId,
                name: '参考图',
                type: 'image',
                role: 'reference_image',
                objectKey: 'users/user-1/ref.png',
                thumbnailKey: 'users/user-1/ref-thumb.jpg',
              }],
            },
            credits: 28,
          },
        }),
      ]))
      .mockResolvedValueOnce(queryResult([{
        id: referenceId,
        user_id: 'user-1',
        name: '参考图',
        object_key: 'users/user-1/ref.png',
        thumbnail_key: 'users/user-1/ref-thumb.jpg',
        thumbnail_status: 'ready',
        type: 'image',
        duration_seconds: null,
        size_bytes: 1024,
      }]));

    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({ method: 'GET', url: `/api/assets/${TEST_ASSET_ID}` });

      expect(response.statusCode).toBe(200);
      expect(response.json().asset.generation).toMatchObject({
        kind: 'image',
        model: 'Seedream 5.0 Pro',
        config: {
          resolution: '2K',
          aspectRatio: '3:4',
          optimizePromptMode: 'fast',
          annotations: [
            { token: '@标记1', assetId: referenceId, type: 'point', x: 0, y: 999 },
            { token: '@标记2', assetId: referenceId, type: 'bbox', x1: 120, y1: 180, x2: 640, y2: 760 },
          ],
        },
      });
      expect(JSON.stringify(response.json().asset.generation)).not.toMatch(/objectKey|thumbnailKey|@非法|@标记3/);
    } finally {
      await app.close();
    }
  });

  it('图片详情在缩略图未就绪时只签原文件访问地址，不把原图回退为缩略图', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([assetRow({
      id: TEST_ASSET_ID,
      type: 'image',
      source: 'uploaded-image',
      object_key: 'users/user-1/source.png',
      thumbnail_key: 'users/user-1/source-thumb.webp',
      thumbnail_status: 'pending',
      generation_meta: null,
    })]));
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({ method: 'GET', url: `/api/assets/${TEST_ASSET_ID}` });

      expect(response.statusCode).toBe(200);
      expect(response.json().asset).toEqual(expect.objectContaining({
        publicUrl: 'https://read.example.com/users/user-1/source.png',
        thumbnailUrl: null,
      }));
      expect(mocks.createObjectReadUrl).toHaveBeenCalledTimes(1);
      expect(mocks.createObjectReadUrl).toHaveBeenCalledWith('users/user-1/source.png');
      expect(mocks.createObjectReadUrl).not.toHaveBeenCalledWith('users/user-1/source-thumb.webp');
    } finally {
      await app.close();
    }
  });

  it('素材详情不会为跨用户或失效参考素材签名或回显历史私有 URL', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([
        assetRow({
          generation_meta: {
            kind: 'video',
            model: 'Seedance 2.0',
            prompt: '生成提示词',
            config: {
              aspectRatio: '16:9',
              resolution: '720p',
              durationSeconds: 6,
              referenceImages: [],
              referenceAssets: [{
                id: '00000000-0000-4000-8000-000000000203',
                name: '不可访问参考视频',
                thumbnail: 'https://victim.example.com/private.jpg',
                publicUrl: 'https://victim.example.com/private.mp4',
                objectKey: 'users/victim/private.mp4',
                thumbnailKey: 'users/victim/private.jpg',
                type: 'video',
                role: 'reference_video',
              }],
            },
          },
        }),
      ]))
      .mockResolvedValueOnce(queryResult([]));

    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({ method: 'GET', url: `/api/assets/${TEST_ASSET_ID}` });

      expect(response.statusCode).toBe(200);
      expect(response.json().asset.generation.config.referenceAssets[0]).toEqual({
        id: '00000000-0000-4000-8000-000000000203',
        name: '不可访问参考视频',
        type: 'video',
        role: 'reference_video',
        previewUrl: null,
      });
      expect(mocks.createObjectReadUrl).not.toHaveBeenCalledWith('users/victim/private.mp4');
      expect(mocks.createObjectReadUrl).not.toHaveBeenCalledWith('users/victim/private.jpg');
      expect(JSON.stringify(response.json().asset.generation)).not.toContain('victim.example.com');
    } finally {
      await app.close();
    }
  });

  it('访问他人或不存在的素材详情统一返回 404，且不签发任何 URL', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([]));
    const app = makeAssetsApp(transactionClient(() => queryResult([])));
    try {
      const response = await app.inject({ method: 'GET', url: `/api/assets/${TEST_ASSET_ID}` });

      expect(response.statusCode).toBe(404);
      expect(mocks.poolQuery).toHaveBeenCalledWith(
        expect.stringContaining('id = $1 AND user_id = $2'),
        [TEST_ASSET_ID, 'user-1'],
      );
      expect(mocks.createObjectReadUrl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('单个素材删除会在事务中调度对象删除 outbox', async () => {
    const client = transactionClient(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('WHERE id = $1') && query.includes('FOR UPDATE')) {
        return queryResult([
          assetObjectRow({
            id: 'asset-1',
            object_key: 'objects/video.mp4',
            thumbnail_key: 'thumbs/video.jpg',
          }),
        ]);
      }
      if (query.includes('id <> ALL')) return queryResult([]);
      if (query.includes('DELETE FROM assets WHERE id = $1')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAssetsApp(client);
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/assets/${TEST_ASSET_ID}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(mocks.scheduleAssetDeletion).toHaveBeenCalledWith(client, 'user-1', [TEST_ASSET_ID]);
      expect(mocks.deleteObjects).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('thumbnail_key 与 object_key 相同时只删除一次', async () => {
    const client = transactionClient(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('WHERE id = $1') && query.includes('FOR UPDATE')) {
        return queryResult([
          assetObjectRow({
            id: 'asset-1',
            object_key: 'objects/image.png',
            thumbnail_key: 'objects/image.png',
          }),
        ]);
      }
      if (query.includes('id <> ALL')) return queryResult([]);
      if (query.includes('DELETE FROM assets WHERE id = $1')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAssetsApp(client);
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/assets/${TEST_ASSET_ID}`,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.scheduleAssetDeletion).toHaveBeenCalledWith(client, 'user-1', [TEST_ASSET_ID]);
    } finally {
      await app.close();
    }
  });

  it('仍被其他资产引用的对象 key 不会被删除', async () => {
    const client = transactionClient(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('WHERE id = $1') && query.includes('FOR UPDATE')) {
        return queryResult([
          assetObjectRow({
            id: 'asset-1',
            object_key: 'objects/shared.mp4',
            thumbnail_key: 'thumbs/private.jpg',
          }),
        ]);
      }
      if (query.includes('id <> ALL')) {
        return queryResult([
          { object_key: 'objects/shared.mp4', thumbnail_key: null },
        ]);
      }
      if (query.includes('DELETE FROM assets WHERE id = $1')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAssetsApp(client);
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/assets/${TEST_ASSET_ID}`,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.scheduleAssetDeletion).toHaveBeenCalledWith(client, 'user-1', [TEST_ASSET_ID]);
    } finally {
      await app.close();
    }
  });

  it('请求线程不直接删除对象，存储短暂失败不阻塞软删除', async () => {
    mocks.deleteObjects.mockRejectedValueOnce(new Error('TOS AccessDenied'));
    const client = transactionClient(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('WHERE id = $1') && query.includes('FOR UPDATE')) {
        return queryResult([
          assetObjectRow({ id: 'asset-1', object_key: 'objects/video.mp4' }),
        ]);
      }
      if (query.includes('id <> ALL')) return queryResult([]);
      if (query.includes('DELETE FROM assets WHERE id = $1')) {
        throw new Error('不应执行数据库删除');
      }
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAssetsApp(client);
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/assets/${TEST_ASSET_ID}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(client.query).not.toHaveBeenCalledWith(
        'DELETE FROM assets WHERE id = $1 AND user_id = $2',
        expect.anything(),
      );
    } finally {
      await app.close();
    }
  });

  it('批量删除会收集所有目标素材对象并去重删除', async () => {
    const assetIds = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ];
    const client = transactionClient(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('id = ANY($2::uuid[])') && query.includes('FOR UPDATE')) {
        return queryResult([
          assetObjectRow({ id: assetIds[0], object_key: 'objects/a.png', thumbnail_key: 'thumbs/a.jpg' }),
          assetObjectRow({ id: assetIds[1], object_key: 'objects/b.png', thumbnail_key: 'thumbs/a.jpg' }),
        ]);
      }
      if (query.includes('id <> ALL')) return queryResult([]);
      if (query.includes('DELETE FROM assets WHERE user_id = $1')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAssetsApp(client);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/assets/bulk-delete',
        payload: { assetIds },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.scheduleAssetDeletion).toHaveBeenCalledWith(client, 'user-1', assetIds);
      expect(mocks.deleteObjects).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('显式 delete-assets 会调统一删除服务、迁移可恢复会话并脱钩终态会话', async () => {
    const client = transactionClient(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM asset_folders') && query.includes('FOR UPDATE')) {
        return queryResult([{ id: TEST_FOLDER_ID, source: 'uploaded-image' }]);
      }
      if (query.includes('is_system = true') && query.includes('FOR KEY SHARE')) {
        return queryResult([{ id: 'root-folder-id' }]);
      }
      if (query.includes('FROM upload_sessions') && query.includes('FOR UPDATE')) return queryResult([{ id: 'upload-1' }]);
      if (query.includes('WHERE folder_id = $1') && query.includes('FOR UPDATE')) {
        return queryResult([{ id: 'asset-1' }]);
      }
      if (query.includes('UPDATE upload_sessions')) return queryResult([]);
      if (query.includes('UPDATE assets SET folder_id = NULL')) return queryResult([]);
      if (query.includes('INSERT INTO asset_folder_deletion_records')) return queryResult([]);
      if (query.includes('DELETE FROM asset_folders')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAssetsApp(client);
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/assets/folders/${TEST_FOLDER_ID}?contentAction=delete-assets`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ok: true,
        contentAction: 'delete-assets',
        affectedAssetCount: 1,
      });
      expect(mocks.scheduleAssetDeletion).toHaveBeenCalledWith(client, 'user-1', ['asset-1']);
      expect(client.query).toHaveBeenCalledWith(
        expect.stringMatching(/FROM upload_sessions[\s\S]*ORDER BY id[\s\S]*FOR UPDATE/),
        [TEST_FOLDER_ID, 'user-1'],
      );
      expect(client.query).toHaveBeenCalledWith(
        expect.stringMatching(/UPDATE upload_sessions[\s\S]*status IN \('pending', 'processing'\)[\s\S]*retryable = true/),
        [TEST_FOLDER_ID, 'user-1', 'root-folder-id'],
      );
      expect(client.query).toHaveBeenCalledWith(
        expect.stringMatching(
          /UPDATE upload_sessions[\s\S]*SET folder_id = NULL[\s\S]*status IN \('completed', 'canceled', 'expired'\)[\s\S]*retryable = true/,
        ),
        [TEST_FOLDER_ID, 'user-1'],
      );
      expect(client.query).toHaveBeenCalledWith(
        'DELETE FROM asset_folders WHERE id = $1 AND user_id = $2',
        [TEST_FOLDER_ID, 'user-1'],
      );
      const sqlCalls = client.query.mock.calls.map(([sql]) => String(sql));
      expect(sqlCalls.findIndex(sql => sql.includes('FROM upload_sessions') && sql.includes('FOR UPDATE')))
        .toBeLessThan(sqlCalls.findIndex(sql => sql.includes('UPDATE upload_sessions')));
      expect(sqlCalls.findIndex(sql => sql.includes('UPDATE upload_sessions') && sql.includes('SET folder_id = NULL')))
        .toBeLessThan(sqlCalls.findIndex(sql => sql.includes('DELETE FROM asset_folders')));
    } finally {
      await app.close();
    }
  });

  it('不带动作删除尚存目录默认把活动素材移入同来源主目录', async () => {
    const client = transactionClient(async (sql: unknown, params?: unknown[]) => {
      const query = String(sql);
      if (query.includes('FROM asset_folders') && query.includes('FOR UPDATE')) {
        return queryResult([{ id: TEST_FOLDER_ID, source: 'ai-video' }]);
      }
      if (query.includes('is_system = true') && query.includes('FOR KEY SHARE')) {
        expect(params).toEqual(['user-1', 'ai-video']);
        return queryResult([{ id: 'ai-video-root-id' }]);
      }
      if (query.includes('FROM upload_sessions') && query.includes('FOR UPDATE')) return queryResult([]);
      if (query.includes('UPDATE assets') && query.includes("deletion_status = 'active'")) {
        expect(params).toEqual([TEST_FOLDER_ID, 'user-1', 'ai-video-root-id']);
        return queryResult([{ id: 'asset-1' }, { id: 'asset-2' }]);
      }
      if (query.includes('UPDATE upload_sessions')) return queryResult([]);
      if (query.includes('UPDATE assets SET folder_id = NULL')) return queryResult([]);
      if (query.includes('INSERT INTO asset_folder_deletion_records')) {
        expect(params).toEqual(['user-1', TEST_FOLDER_ID, 'move-to-root', 2]);
        return queryResult([]);
      }
      if (query.includes('DELETE FROM asset_folders')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAssetsApp(client);
    try {
      const response = await app.inject({ method: 'DELETE', url: `/api/assets/folders/${TEST_FOLDER_ID}` });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ok: true,
        contentAction: 'move-to-root',
        affectedAssetCount: 2,
      });
      expect(mocks.scheduleAssetDeletion).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('同来源系统主目录缺失时中止整笔文件夹删除', async () => {
    const client = transactionClient(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM asset_folders') && query.includes('FOR UPDATE')) {
        return queryResult([{ id: TEST_FOLDER_ID, source: 'uploaded-audio' }]);
      }
      if (query.includes('is_system = true') && query.includes('FOR KEY SHARE')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAssetsApp(client);
    try {
      const response = await app.inject({ method: 'DELETE', url: `/api/assets/folders/${TEST_FOLDER_ID}` });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        message: '素材系统主目录缺失，请联系管理员',
        code: 'ASSET_ROOT_FOLDER_MISSING',
      });
      expect(mocks.scheduleAssetDeletion).not.toHaveBeenCalled();
      expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE assets'))).toBe(false);
      expect(client.query.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM asset_folders'))).toBe(false);
      expect(client.query.mock.calls.some(([sql]) => String(sql).includes('asset_folder_deletion_records'))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('已删除文件夹的重复 DELETE 根据当前用户 tombstone 幂等返回成功', async () => {
    const client = transactionClient(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM asset_folders') && query.includes('FOR UPDATE')) return queryResult([]);
      if (query.includes('FROM asset_folder_deletion_records')) {
        return queryResult([{ content_action: 'delete-assets', affected_asset_count: null }]);
      }
      throw new Error(`未预期的查询：${query}`);
    });
    const app = makeAssetsApp(client);
    try {
      const response = await app.inject({ method: 'DELETE', url: `/api/assets/folders/${TEST_FOLDER_ID}` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ok: true,
        contentAction: 'delete-assets',
        affectedAssetCount: null,
      });
      expect(mocks.scheduleAssetDeletion).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('已删除文件夹只允许幂等重放原内容动作，不同显式动作返回 409', async () => {
    const client = transactionClient(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM asset_folders') && query.includes('FOR UPDATE')) return queryResult([]);
      if (query.includes('FROM asset_folder_deletion_records')) {
        return queryResult([{ content_action: 'move-to-root', affected_asset_count: 3 }]);
      }
      throw new Error(`未预期的查询：${query}`);
    });
    const app = makeAssetsApp(client);
    try {
      const replay = await app.inject({
        method: 'DELETE',
        url: `/api/assets/folders/${TEST_FOLDER_ID}?contentAction=move-to-root`,
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual({
        ok: true,
        contentAction: 'move-to-root',
        affectedAssetCount: 3,
      });

      const conflict = await app.inject({
        method: 'DELETE',
        url: `/api/assets/folders/${TEST_FOLDER_ID}?contentAction=delete-assets`,
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toEqual({
        message: '文件夹已按不同的内容处理方式删除',
        code: 'ASSET_FOLDER_DELETE_ACTION_CONFLICT',
      });
      expect(mocks.scheduleAssetDeletion).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('不存在或属于其他用户的文件夹没有 tombstone 时仍返回 404', async () => {
    const client = transactionClient(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM asset_folders') && query.includes('FOR UPDATE')) return queryResult([]);
      if (query.includes('FROM asset_folder_deletion_records')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });
    const app = makeAssetsApp(client);
    try {
      const response = await app.inject({ method: 'DELETE', url: `/api/assets/folders/${TEST_OTHER_FOLDER_ID}` });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ message: '文件夹不存在或不可删除' });
    } finally {
      await app.close();
    }
  });

  it('素材不存在时返回 404 且不调度对象删除', async () => {
    mocks.scheduleAssetDeletion.mockResolvedValueOnce(0);
    const client = transactionClient(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT count(*)')) return queryResult([{ count: 0 }]);
      if (query.includes('DELETE FROM assets WHERE id = $1')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const app = makeAssetsApp(client);
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/assets/${TEST_MISSING_ASSET_ID}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ message: '素材不存在' });
      expect(mocks.deleteObjects).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('素材已处于 deleting/deleted 时重复删除仍返回成功', async () => {
    mocks.scheduleAssetDeletion.mockResolvedValueOnce(0);
    const client = transactionClient(async (sql: unknown) => {
      if (String(sql).includes('SELECT count(*)')) return queryResult([{ count: 1 }]);
      throw new Error(`未预期的查询：${String(sql)}`);
    });
    const app = makeAssetsApp(client);
    try {
      const response = await app.inject({ method: 'DELETE', url: `/api/assets/${TEST_ASSET_ID}` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });
});

describe('下载文件名', () => {
  it.each([
    ['缺少视频后缀', 'Seedance 视频', 'generated/video/task.mp4', 'Seedance 视频.mp4'],
    ['保留正确图片后缀', '商品图.PNG', 'users/user-1/image.png', '商品图.png'],
    ['替换错误媒体后缀', '配乐.wav', 'users/user-1/audio.mp3', '配乐.mp3'],
    ['补充音频后缀', '参考配乐', 'users/user-1/audio.wav', '参考配乐.wav'],
    ['不把名称中的小数当作后缀', 'Seedance 2.0 Mini 视频', 'generated/video/task.mp4', 'Seedance 2.0 Mini 视频.mp4'],
  ])('%s', (_label, name, objectKey, expected) => {
    expect(buildAssetDownloadFilename(name, objectKey)).toBe(expected);
  });
});

function makeAssetsApp(client: MockDbClient) {
  mocks.withTransaction.mockImplementation(async (callback: (client: MockDbClient) => unknown) => callback(client));
  const app = fastify({ logger: false });
  app.register(registerAssetsRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const fastifyError = error as { statusCode?: number; message?: string; code?: string };
    const statusCode = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 400;
    return reply.code(statusCode).send({ message: fastifyError.message, code: fastifyError.code });
  });
  return app;
}

function transactionClient(handler: (sql: unknown, params?: unknown[]) => Promise<unknown> | unknown) {
  return {
    query: vi.fn(handler),
  };
}

type MockDbClient = ReturnType<typeof transactionClient>;

function queryResult(rows: unknown[]) {
  return {
    rowCount: rows.length,
    rows,
  };
}

function uploadSessionDto() {
  return {
    id: '00000000-0000-4000-8000-000000000077',
    status: 'pending',
    processingStage: 'waiting-upload',
    progress: 5,
    attempt: 0,
    filename: 'image.png',
    source: 'uploaded-image',
    asset: null,
    error: null,
    canRetry: false,
    expiresAt: '2099-01-01T00:00:00.000Z',
    updatedAt: '2026-07-16T10:00:00.000Z',
  };
}

function assetObjectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    object_key: 'objects/default.png',
    thumbnail_key: null,
    ...overrides,
  };
}

function folderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'folder-1',
    name: '普通目录',
    source: 'uploaded-image',
    is_system: false,
    created_at: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

function assetRow(overrides: Record<string, unknown> = {}) {
  const row = {
    id: 'asset-1',
    user_id: 'user-1',
    folder_id: 'folder-1',
    name: '生成视频',
    type: 'video',
    source: 'ai-video',
    object_key: 'users/user-1/video.mp4',
    thumbnail_key: null,
    thumbnail_status: 'not-required',
    size_bytes: 1024,
    duration_seconds: 6,
    width: 1280,
    height: 720,
    generation_meta: {
      kind: 'video',
      model: 'Seedance 2.0',
      prompt: '生成提示词',
      config: { aspectRatio: '16:9', resolution: '720p', durationSeconds: 6 },
      credits: 20,
    },
    views: 0,
    downloaded_at: null,
    download_requested_at: null,
    created_at: '2026-07-01T10:00:00.000Z',
    updated_at: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
  return {
    ...row,
    __pagination_total_count: overrides.__pagination_total_count ?? null,
    __pagination_cursor_timestamp:
      overrides.__pagination_cursor_timestamp ?? String(row.created_at),
  };
}
