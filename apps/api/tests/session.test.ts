import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthToken } from '../src/domain/types.js';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
}));

import { requireAdmin, requireAuth } from '../src/auth/session.js';

describe('后端会话鉴权', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
  });

  it('Cookie 声明与数据库状态、角色和版本一致时通过鉴权', async () => {
    const admin: AuthToken = {
      id: 'admin-1',
      email: 'admin@lindyson.ai',
      role: 'admin',
      authVersion: 3,
    };
    mocks.poolQuery.mockResolvedValue(queryResult([{
      email: admin.email,
      role: admin.role,
      status: 'active',
      auth_version: admin.authVersion,
    }]));
    const { request, verify } = requestFor(admin);

    await expect(requireAdmin(request)).resolves.toEqual(admin);
    expect(verify).toHaveBeenCalledWith('signed-jwt');
    expect(mocks.poolQuery).toHaveBeenCalledWith(expect.stringContaining('auth_version'), [admin.id]);
  });

  it.each([
    ['frozen', 3, 'admin'],
    ['active', 4, 'admin'],
    ['active', 3, 'user'],
  ] as const)('数据库状态为 %s、版本为 %s、角色为 %s 时撤销旧会话', async (status, authVersion, role) => {
    const token: AuthToken = {
      id: 'admin-1',
      email: 'admin@lindyson.ai',
      role: 'admin',
      authVersion: 3,
    };
    mocks.poolQuery.mockResolvedValue(queryResult([{
      email: token.email,
      role,
      status,
      auth_version: authVersion,
    }]));

    await expect(requireAuth(requestFor(token).request)).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTH_SESSION_INVALID',
    });
  });

  it('普通用户访问后台接口返回 403', async () => {
    const user: AuthToken = {
      id: 'user-1',
      email: 'member@lindyson.ai',
      role: 'user',
      authVersion: 1,
    };
    mocks.poolQuery.mockResolvedValue(queryResult([{
      email: user.email,
      role: user.role,
      status: 'trial',
      auth_version: user.authVersion,
    }]));

    await expect(requireAdmin(requestFor(user).request)).rejects.toMatchObject({
      message: '需要管理员权限',
      statusCode: 403,
    });
  });

  it('不再接受缺少 HttpOnly Cookie 的 Bearer 会话', async () => {
    const request = {
      headers: { authorization: 'Bearer legacy-token' },
      server: { jwt: { verify: vi.fn() } },
    } as unknown as FastifyRequest;

    await expect(requireAuth(request)).rejects.toMatchObject({ statusCode: 401 });
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });
});

function requestFor(user: AuthToken) {
  const verify = vi.fn(() => user);
  const request = {
    headers: { cookie: 'other=value; lindyson_session=signed-jwt' },
    server: { jwt: { verify } },
  } as unknown as FastifyRequest;

  return { request, verify };
}

function queryResult(rows: unknown[]) {
  return { rows, rowCount: rows.length };
}
