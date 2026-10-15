import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
  },
  withTransaction: vi.fn(),
}));

vi.mock('../src/auth/session.js', () => ({
  requireAuth: mocks.requireAuth,
  requireAdmin: mocks.requireAdmin,
}));

import { registerAccountRoutes } from '../src/routes/accountRoutes.js';
import { registerAdminRoutes } from '../src/routes/adminRoutes.js';

describe('功能开关接口', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.requireAuth.mockReset();
    mocks.requireAdmin.mockReset();
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', email: 'member@lindyson.ai', role: 'user' });
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@lindyson.ai', role: 'admin' });
  });

  it('普通登录用户可以读取用户端功能开关', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([
      { key: 'tiktokAccounts', enabled: false },
      { key: 'tiktokPublish', enabled: true },
    ]));

    const app = makeAccountApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/account/feature-flags',
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.requireAuth).toHaveBeenCalledTimes(1);
      expect(mocks.requireAdmin).not.toHaveBeenCalled();
      expect(response.json()).toEqual({
        flags: {
          tiktokAccounts: false,
          tiktokPublish: true,
        },
      });
    } finally {
      await app.close();
    }
  });

  it('功能开关缺少数据库记录时默认开启', async () => {
    mocks.poolQuery.mockResolvedValue(queryResult([]));

    const app = makeAccountApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/account/feature-flags',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        flags: {
          tiktokAccounts: true,
          tiktokPublish: true,
        },
      });
    } finally {
      await app.close();
    }
  });

  it('后台功能开关读取接口仍要求管理员权限', async () => {
    mocks.requireAdmin.mockRejectedValue(Object.assign(new Error('需要管理员权限'), { statusCode: 403 }));

    const app = makeAdminApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/feature-flags',
      });

      expect(response.statusCode).toBe(403);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
      expect(response.json()).toEqual({ message: '需要管理员权限' });
    } finally {
      await app.close();
    }
  });
});

function makeAccountApp() {
  const app = fastify({ logger: false });
  app.register(registerAccountRoutes);
  return app;
}

function makeAdminApp() {
  const app = fastify({ logger: false });
  app.register(registerAdminRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const fastifyError = error as { statusCode?: number; message?: string };
    const statusCode = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 400;
    return reply.code(statusCode).send({ message: fastifyError.message });
  });
  return app;
}

function queryResult(rows: unknown[]) {
  return { rows, rowCount: rows.length };
}
