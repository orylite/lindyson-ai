import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  requireAuth: vi.fn(),
  issueAuthSession: vi.fn(),
  getUserProfile: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: vi.fn(async (callback: (client: { query: typeof mocks.clientQuery }) => Promise<unknown>) => (
    callback({ query: mocks.clientQuery })
  )),
}));

vi.mock('../src/auth/session.js', () => ({
  requireAuth: mocks.requireAuth,
  issueAuthSession: mocks.issueAuthSession,
}));

vi.mock('../src/domain/users.js', () => ({
  getUserProfile: mocks.getUserProfile,
}));

vi.mock('../src/domain/subscriptionLifecycle.js', () => ({
  reconcileSubscription: vi.fn(),
}));

vi.mock('../src/domain/featureFlags.js', () => ({
  readFeatureFlags: vi.fn(),
}));

import { hashPassword } from '../src/auth/password.js';
import { registerAccountRoutes } from '../src/routes/accountRoutes.js';

describe('账户密码接口', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.clientQuery.mockReset();
    mocks.requireAuth.mockReset();
    mocks.issueAuthSession.mockReset();
    mocks.getUserProfile.mockReset();
    mocks.requireAuth.mockResolvedValue({
      id: 'user-1',
      email: 'member@example.com',
      role: 'user',
      authVersion: 2,
    });
  });

  it('验证当前密码、递增会话版本并覆盖当前 Cookie', async () => {
    const currentHash = await hashPassword('Current123');
    const profile = {
      id: 'user-1',
      email: 'member@example.com',
      userName: '测试用户',
      role: 'user',
      status: 'active',
    };
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT email, role, status')) {
        return queryResult([{
          email: profile.email,
          role: profile.role,
          status: 'active',
          auth_version: 2,
          password_hash: currentHash,
        }]);
      }
      if (query.includes('UPDATE users')) {
        return queryResult([{ email: profile.email, role: profile.role, auth_version: 3 }]);
      }
      if (query.includes('UPDATE password_reset_tokens')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });
    mocks.getUserProfile.mockResolvedValue(profile);

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/account/password',
        payload: { currentPassword: 'Current123', newPassword: 'NewPassword456' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ user: profile });
      expect(mocks.issueAuthSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        authVersion: 3,
      });
      expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining('auth_version = auth_version + 1'), expect.anything());
      expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE password_reset_tokens'), [profile.id]);
    } finally {
      await app.close();
    }
  });

  it('当前密码错误时不更新密码或签发新会话', async () => {
    const currentHash = await hashPassword('Current123');
    mocks.clientQuery.mockResolvedValue(queryResult([{
      email: 'member@example.com',
      role: 'user',
      status: 'active',
      auth_version: 2,
      password_hash: currentHash,
    }]));

    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/account/password',
        payload: { currentPassword: 'WrongPassword1', newPassword: 'NewPassword456' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ message: '当前密码不正确' });
      expect(mocks.issueAuthSession).not.toHaveBeenCalled();
      expect(mocks.clientQuery).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('请求进入后会话版本发生变化时不允许覆盖新密码', async () => {
    const currentHash = await hashPassword('Current123');
    mocks.clientQuery.mockResolvedValueOnce(queryResult([{
      email: 'member@example.com',
      role: 'user',
      status: 'active',
      auth_version: 3,
      password_hash: currentHash,
    }]));
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/account/password',
        payload: { currentPassword: 'Current123', newPassword: 'NewPassword456' },
      });

      expect(response.statusCode).toBe(401);
      expect(mocks.clientQuery).toHaveBeenCalledTimes(1);
      expect(mocks.issueAuthSession).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

function makeApp() {
  const app = fastify({ logger: false });
  app.register(registerAccountRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const fastifyError = error as { statusCode?: number; message?: string };
    return reply.code(fastifyError.statusCode ?? 400).send({ message: fastifyError.message });
  });
  return app;
}

function queryResult(rows: unknown[]) {
  return { rows, rowCount: rows.length };
}
