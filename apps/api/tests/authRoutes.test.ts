import fastify from 'fastify';
import jwt from '@fastify/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  sendRegisterCodeEmail: vi.fn(),
  getUserProfile: vi.fn(),
  reconcileSubscription: vi.fn(),
  enforceAuthRateLimit: vi.fn(),
  clearAuthAccountRateLimit: vi.fn(),
  withTransaction: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  resolveTrustedRequestAppOrigin: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
  },
  withTransaction: mocks.withTransaction,
}));

vi.mock('../src/notifications/emailService.js', () => ({
  sendRegisterCodeEmail: mocks.sendRegisterCodeEmail,
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
  sendWelcomeEmail: vi.fn(),
}));

vi.mock('../src/config/requestOrigin.js', () => ({
  resolveTrustedRequestAppOrigin: mocks.resolveTrustedRequestAppOrigin,
}));

vi.mock('../src/domain/users.js', () => ({
  ensureDefaultAssetFolders: vi.fn(),
  getUserProfile: mocks.getUserProfile,
}));

vi.mock('../src/domain/subscriptionLifecycle.js', () => ({
  reconcileSubscription: mocks.reconcileSubscription,
}));

vi.mock('../src/auth/rateLimit.js', () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
  clearAuthAccountRateLimit: mocks.clearAuthAccountRateLimit,
}));

import { registerAuthRoutes } from '../src/routes/authRoutes.js';
import { hashVerificationCode } from '../src/auth/verificationTokens.js';

describe('authRoutes', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.sendRegisterCodeEmail.mockReset();
    mocks.getUserProfile.mockReset();
    mocks.reconcileSubscription.mockReset();
    mocks.enforceAuthRateLimit.mockReset();
    mocks.clearAuthAccountRateLimit.mockReset();
    mocks.withTransaction.mockReset();
    mocks.sendPasswordResetEmail.mockReset();
    mocks.resolveTrustedRequestAppOrigin.mockReset();
    mocks.enforceAuthRateLimit.mockResolvedValue(undefined);
    mocks.clearAuthAccountRateLimit.mockResolvedValue(undefined);
    mocks.sendPasswordResetEmail.mockResolvedValue({ status: 'sent' });
    mocks.resolveTrustedRequestAppOrigin.mockReturnValue('https://www.lindyson.com');
  });

  it('注册验证码邮件发送失败时返回安全业务文案并消费验证码', async () => {
    const verificationId = '00000000-0000-4000-8000-000000000001';
    const consumedIds: unknown[] = [];
    mocks.poolQuery.mockImplementation(async (sql: unknown, params: unknown[] = []) => {
      const query = String(sql);
      if (query.includes('SELECT id FROM users')) return queryResult([]);
      if (query.includes('SELECT sent_at FROM registration_verification_codes')) return queryResult([]);
      if (query.includes('INSERT INTO registration_verification_codes')) {
        return queryResult([{
          id: verificationId,
          expires_at: '2030-01-01T00:00:00.000Z',
        }]);
      }
      if (query.includes('UPDATE registration_verification_codes SET consumed_at')) {
        consumedIds.push(params[0]);
        return queryResult([]);
      }
      throw new Error(`未预期的查询：${query}`);
    });
    mocks.sendRegisterCodeEmail.mockResolvedValue({
      status: 'failed',
      error: 'Resend failed',
    });

    const app = makeAuthApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register-code',
        payload: {
          userName: '测试用户',
          email: 'new.user@example.com',
        },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ message: '验证码邮件发送失败，请稍后重试' });
      expect(mocks.sendRegisterCodeEmail).toHaveBeenCalledWith(expect.objectContaining({
        email: 'new.user@example.com',
        userName: '测试用户',
        idempotencyKey: verificationId,
      }));
      expect(consumedIds).toEqual([verificationId]);
    } finally {
      await app.close();
    }
  });

  it('没有任何套餐配置时仍创建零积分免费账户且不写积分流水', async () => {
    const verificationId = '00000000-0000-4000-8000-000000000001';
    const userId = '00000000-0000-4000-8000-000000000002';
    const verificationCode = '135790';
    const verificationSalt = 'registration-test-salt';
    const queries: string[] = [];
    const profile = {
      id: userId,
      email: 'new.user@example.com',
      userName: '新用户',
      role: 'user' as const,
      status: 'active' as const,
      planCode: null,
      planName: null,
      billingCycle: 'monthly' as const,
      mainCredits: 0,
      addonCredits: 0,
      credits: 0,
      totalCredits: 0,
      planResetAt: null,
      planExpiresAt: null,
      registeredAt: '2026-07-15T00:00:00.000Z',
      lastActiveAt: '2026-07-15T00:00:00.000Z',
    };
    const clientQuery = vi.fn(async (sql: unknown, _params: unknown[] = []) => {
      const query = String(sql);
      queries.push(query);
      if (query.includes('FROM registration_verification_codes')) {
        return queryResult([{
          id: verificationId,
          email: profile.email,
          user_name: profile.userName,
          code_hash: hashVerificationCode(verificationCode, verificationSalt),
          code_salt: verificationSalt,
          attempt_count: 0,
          expires_at: '2030-01-01T00:00:00.000Z',
          consumed_at: null,
        }]);
      }
      if (query.includes('SELECT id FROM users')) return queryResult([]);
      if (query.includes('INSERT INTO users')) return queryResult([{ id: userId, auth_version: 1 }]);
      if (query.includes('UPDATE registration_verification_codes SET consumed_at')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });
    mocks.withTransaction.mockImplementationOnce(async callback => callback({ query: clientQuery }));
    mocks.getUserProfile.mockResolvedValue(profile);

    const app = makeAuthApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          userName: profile.userName,
          email: profile.email,
          password: 'Password123',
          verificationId,
          verificationCode,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ user: profile });
      expect(queries.some(query => query.includes('FROM plans'))).toBe(false);
      expect(queries.some(query => query.includes('credit_ledger'))).toBe(false);
      const insertCall = clientQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO users'));
      expect(String(insertCall?.[0])).toMatch(/NULL, 0, 0, 0,[\s\S]*NULL, NULL/);
      expect(insertCall?.[1]).toEqual([
        profile.email,
        expect.any(String),
        profile.userName,
      ]);
    } finally {
      await app.close();
    }
  });

  it('登录只通过 HttpOnly Cookie 建立会话，不再返回 token', async () => {
    const { hashPassword } = await import('../src/auth/password.js');
    const passwordHash = await hashPassword('Password123');
    const profile = {
      id: 'user-1',
      email: 'member@example.com',
      userName: '测试用户',
      role: 'user',
      status: 'active',
    };
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([{
        id: profile.id,
        email: profile.email,
        role: profile.role,
        status: profile.status,
        password_hash: passwordHash,
        auth_version: 4,
      }]))
      .mockResolvedValueOnce(queryResult([]));
    mocks.getUserProfile.mockResolvedValue(profile);

    const app = makeAuthApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: profile.email, password: 'Password123' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ user: profile });
      expect(response.json()).not.toHaveProperty('token');
      expect(response.headers['set-cookie']).toContain('lindyson_session=');
      expect(response.headers['set-cookie']).toContain('HttpOnly');
      expect(response.headers['set-cookie']).toContain('SameSite=Lax');
      expect(mocks.enforceAuthRateLimit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        scope: 'login',
        identity: profile.email,
      }));
    } finally {
      await app.close();
    }
  });

  it('登录成功响应不允许缺少用户 DTO', async () => {
    const { hashPassword } = await import('../src/auth/password.js');
    const passwordHash = await hashPassword('Password123');
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([{
        id: 'user-1',
        email: 'member@example.com',
        role: 'user',
        status: 'active',
        password_hash: passwordHash,
        auth_version: 4,
      }]))
      .mockResolvedValueOnce(queryResult([]));
    mocks.getUserProfile.mockResolvedValue(null);

    const app = makeAuthApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'member@example.com', password: 'Password123' },
      });

      expect(response.statusCode).toBe(500);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.json()).toEqual({ message: '服务器错误' });
    } finally {
      await app.close();
    }
  });

  it('登出会清除会话 Cookie', async () => {
    const app = makeAuthApp();
    try {
      const response = await app.inject({ method: 'POST', url: '/api/auth/logout' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(response.headers['set-cookie']).toContain('lindyson_session=');
      expect(response.headers['set-cookie']).toContain('Max-Age=0');
    } finally {
      await app.close();
    }
  });

  it('从 cn 站发起忘记密码时邮件返回 cn 站重置页面', async () => {
    const userId = '00000000-0000-4000-8000-000000000002';
    const resetTokenId = '00000000-0000-4000-8000-000000000003';
    mocks.resolveTrustedRequestAppOrigin.mockReturnValue('https://www.lindyson.cn');
    mocks.poolQuery.mockResolvedValueOnce(queryResult([{
      id: userId,
      email: 'member@example.com',
      user_name: '测试用户',
      status: 'active',
    }]));
    const clientQuery = vi.fn(async (sql: unknown) => {
      if (String(sql).includes('INSERT INTO password_reset_tokens')) {
        return queryResult([{ id: resetTokenId }]);
      }
      return queryResult([]);
    });
    mocks.withTransaction.mockImplementationOnce(async callback => callback({ query: clientQuery }));

    const app = makeAuthApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        headers: { origin: 'https://www.lindyson.cn' },
        payload: { email: 'member@example.com' },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.sendPasswordResetEmail).toHaveBeenCalledWith(expect.objectContaining({
        userId,
        idempotencyKey: resetTokenId,
        resetUrl: expect.stringMatching(
          /^https:\/\/www\.lindyson\.cn\/reset-password\?token=[A-Za-z0-9_-]+$/,
        ),
      }));
    } finally {
      await app.close();
    }
  });

  it('重置密码成功后立即清除当前浏览器的旧会话 Cookie', async () => {
    const resetId = '00000000-0000-4000-8000-000000000001';
    const userId = '00000000-0000-4000-8000-000000000002';
    mocks.poolQuery.mockResolvedValueOnce(queryResult([{ user_id: userId, status: 'active' }]));
    const clientQuery = vi.fn(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT reset.id')) {
        return queryResult([{ id: resetId, user_id: userId, status: 'active' }]);
      }
      if (query.includes('UPDATE users') || query.includes('UPDATE password_reset_tokens')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });
    mocks.withTransaction.mockImplementationOnce(async callback => callback({ query: clientQuery }));

    const app = makeAuthApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        payload: { token: 'a'.repeat(48), password: 'NewPassword2026' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['set-cookie']).toContain('lindyson_session=');
      expect(response.headers['set-cookie']).toContain('Max-Age=0');
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringMatching(/auth_version = auth_version \+ 1/),
        expect.arrayContaining([expect.any(String), userId]),
      );
    } finally {
      await app.close();
    }
  });
});

function makeAuthApp() {
  const app = fastify({ logger: false });
  app.register(jwt, { secret: 'test-auth-secret-at-least-32-characters-long' });
  app.register(registerAuthRoutes);
  app.setErrorHandler((error, _request, reply) => {
    const fastifyError = error as { statusCode?: number; message?: string; exposeMessage?: boolean };
    const statusCode = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 500;
    const message = statusCode >= 500 && fastifyError.exposeMessage !== true ? '服务器错误' : fastifyError.message;
    return reply.code(statusCode).send({ message });
  });
  return app;
}

function queryResult(rows: unknown[]) {
  return {
    rowCount: rows.length,
    rows,
  };
}
