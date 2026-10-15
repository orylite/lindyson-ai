import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  requireAdmin: vi.fn(),
  createObjectReadUrl: vi.fn(),
  createObjectDownloadUrl: vi.fn(),
  readStoredObjectSize: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
  },
  withTransaction: vi.fn(),
}));

vi.mock('../src/auth/session.js', () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock('../src/storage/storageService.js', () => ({
  createObjectReadUrl: mocks.createObjectReadUrl,
  createObjectDownloadUrl: mocks.createObjectDownloadUrl,
  readStoredObjectSize: mocks.readStoredObjectSize,
}));

vi.mock('../src/providers/volcengineBillingProvider.js', () => ({
  maybeSyncVolcengineBillingPackages: vi.fn(),
}));

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';

describe('后台资产预览接口', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.requireAdmin.mockReset();
    mocks.createObjectReadUrl.mockReset();
    mocks.createObjectDownloadUrl.mockReset();
    mocks.readStoredObjectSize.mockReset();

    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@lindyson.ai', role: 'admin' });
    mocks.createObjectReadUrl.mockImplementation(async (objectKey: string) => `https://read.example.com/${objectKey}`);
    mocks.createObjectDownloadUrl.mockImplementation(async (objectKey: string) => `https://download.example.com/${objectKey}`);
    mocks.readStoredObjectSize.mockResolvedValue(1024);
  });

  it('管理员可读取任意用户资产并拿到短期签名地址', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([
      assetRow({
        id: 'asset-other-user',
        user_id: 'user-other',
        object_key: 'users/other/video.mp4',
        thumbnail_key: 'users/other/video.jpg',
        thumbnail_status: 'ready',
      }),
    ]));

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/assets/11111111-1111-4111-8111-111111111111',
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.poolQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM assets'),
        ['11111111-1111-4111-8111-111111111111'],
      );
      expect(mocks.createObjectReadUrl).toHaveBeenCalledWith('users/other/video.mp4');
      expect(mocks.createObjectReadUrl).toHaveBeenCalledWith('users/other/video.jpg');
      expect(response.json().asset).toEqual(expect.objectContaining({
        id: 'asset-other-user',
        publicUrl: 'https://read.example.com/users/other/video.mp4',
        thumbnailUrl: 'https://read.example.com/users/other/video.jpg',
      }));
    } finally {
      await app.close();
    }
  });

  it('管理员资产预览会为原始参考素材重新签名', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([
        assetRow({
          id: 'asset-other-user',
          user_id: 'user-other',
          object_key: 'users/other/video.mp4',
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
                  name: '客户端名称',
                  objectKey: 'users/other/ref.png',
                  thumbnailKey: 'users/victim/private.jpg',
                  thumbnail: 'https://expired.example.com/ref-thumb.jpg',
                },
              ],
            },
            credits: 20,
          },
        }),
      ]))
      .mockResolvedValueOnce(queryResult([{
        id: '00000000-0000-4000-8000-000000000301',
        user_id: 'user-other',
        name: '数据库参考图',
        object_key: 'users/other/ref.png',
        thumbnail_key: 'users/other/ref-thumb.jpg',
        thumbnail_status: 'ready',
        type: 'image',
        duration_seconds: null,
        size_bytes: 1024,
      }]));

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/assets/11111111-1111-4111-8111-111111111111',
      });

      expect(response.statusCode).toBe(200);
      const reference = response.json().asset.generation.config.referenceImages[0];
      expect(reference).toEqual(expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000301',
        name: '数据库参考图',
        previewUrl: 'https://read.example.com/users/other/ref-thumb.jpg',
      }));
      expect(reference).not.toHaveProperty('objectKey');
      expect(reference).not.toHaveProperty('thumbnailKey');
      expect(reference).not.toHaveProperty('publicUrl');
      expect(mocks.createObjectReadUrl).not.toHaveBeenCalledWith('users/other/ref.png');
      expect(mocks.createObjectReadUrl).toHaveBeenCalledWith('users/other/ref-thumb.jpg');
      expect(mocks.createObjectReadUrl).not.toHaveBeenCalledWith('users/victim/private.jpg');
    } finally {
      await app.close();
    }
  });

  it('普通用户不能读取后台资产预览接口', async () => {
    const error = Object.assign(new Error('需要管理员权限'), { statusCode: 403 });
    mocks.requireAdmin.mockRejectedValueOnce(error);

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/assets/11111111-1111-4111-8111-111111111111',
      });

      expect(response.statusCode).toBe(403);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('资产不存在时返回 404', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([]));

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/assets/99999999-9999-4999-8999-999999999999',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ message: '素材不存在' });
    } finally {
      await app.close();
    }
  });

  it('管理员可下载其他用户活动资产且不修改用户下载状态', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([{
      object_key: 'users/other/video.mp4',
      name: 'Seedance 成片',
    }]));

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/assets/11111111-1111-4111-8111-111111111111/download',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        download: {
          url: 'https://download.example.com/users/other/video.mp4',
          filename: 'Seedance 成片.mp4',
        },
      });
      expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
      expect(mocks.poolQuery).toHaveBeenCalledWith(
        expect.stringMatching(/WHERE id = \$1 AND deletion_status = 'active'/),
        ['11111111-1111-4111-8111-111111111111'],
      );
      expect(String(mocks.poolQuery.mock.calls[0]?.[0])).not.toContain('user_id =');
      expect(String(mocks.poolQuery.mock.calls[0]?.[0])).not.toContain('UPDATE assets');
      expect(mocks.readStoredObjectSize).toHaveBeenCalledWith('users/other/video.mp4');
      expect(mocks.createObjectDownloadUrl).toHaveBeenCalledWith(
        'users/other/video.mp4',
        'Seedance 成片.mp4',
      );
    } finally {
      await app.close();
    }
  });

  it('普通用户不能调用管理员下载接口', async () => {
    mocks.requireAdmin.mockRejectedValueOnce(Object.assign(new Error('需要管理员权限'), { statusCode: 403 }));

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/assets/11111111-1111-4111-8111-111111111111/download',
      });

      expect(response.statusCode).toBe(403);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
      expect(mocks.readStoredObjectSize).not.toHaveBeenCalled();
      expect(mocks.createObjectDownloadUrl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('不存在或非活动资产不能通过管理员接口下载', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([]));

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/assets/99999999-9999-4999-8999-999999999999/download',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().message).toBe('素材不存在');
      expect(mocks.poolQuery).toHaveBeenCalledWith(
        expect.stringContaining("deletion_status = 'active'"),
        ['99999999-9999-4999-8999-999999999999'],
      );
      expect(mocks.createObjectDownloadUrl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('管理员下载在原文件缺失时返回专用错误且不回退预览地址', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([{
      object_key: 'users/other/missing.mp4',
      name: '缺失成片',
    }]));
    mocks.readStoredObjectSize.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/assets/11111111-1111-4111-8111-111111111111/download',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        message: '素材原始文件不存在',
        code: 'ASSET_ORIGINAL_MISSING',
      });
      expect(mocks.createObjectDownloadUrl).not.toHaveBeenCalled();
      expect(mocks.createObjectReadUrl).not.toHaveBeenCalled();
      expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});

function makeApp() {
  const app = fastify({ logger: false });
  app.register(registerAdminRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const fastifyError = error as { statusCode?: number; message?: string; code?: string };
    return reply.code(fastifyError.statusCode ?? 400).send({
      message: fastifyError.message,
      ...(fastifyError.code ? { code: fastifyError.code } : {}),
    });
  });
  return app;
}

function queryResult(rows: unknown[]) {
  return {
    rowCount: rows.length,
    rows,
  };
}

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    user_id: 'user-1',
    folder_id: 'folder-1',
    name: '生成视频',
    type: 'video',
    source: 'ai-video',
    object_key: 'users/user-1/video.mp4',
    thumbnail_key: null,
    thumbnail_status: 'pending',
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
    created_at: '2026-07-01T10:00:00.000Z',
    updated_at: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}
