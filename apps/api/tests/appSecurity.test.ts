import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, redactSensitiveRequestUrl } from '../src/app.js';
import { pool } from '../src/db/pool.js';

describe('API 全局响应安全边界', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('成功响应携带 request ID 和安全响应头', async () => {
    const app = buildApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-request-id']).toBeTruthy();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    } finally {
      await app.close();
    }
  });

  it('缺少 Origin 但浏览器声明 cross-site 的写请求会被拒绝', async () => {
    const app = buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { 'sec-fetch-site': 'cross-site' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual(expect.objectContaining({
        code: 'ORIGIN_NOT_ALLOWED',
        requestId: expect.any(String),
      }));
      expect(response.headers['x-request-id']).toBe(response.json().requestId);
    } finally {
      await app.close();
    }
  });

  it('火山真人回跳即使校验失败也禁止引用、缓存和索引', async () => {
    const app = buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/providers/volc/real-portrait-validation/invalid?bytedToken=face-secret',
      });

      expect(response.statusCode).toBe(400);
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['cache-control']).toBe('no-store, max-age=0');
      expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    } finally {
      await app.close();
    }
  });

  it('真实路由使用共享严格 Schema 拒绝遗留字段', async () => {
    const app = buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'member@example.com',
          password: 'Password123',
          legacyToken: 'must-be-rejected-before-handler',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        message: '请求参数不正确',
        code: 'VALIDATION_ERROR',
        requestId: expect.any(String),
        issues: [expect.objectContaining({
          code: 'unrecognized_keys',
          path: [],
        })],
      });
      expect(response.headers['x-request-id']).toBe(response.json().requestId);
    } finally {
      await app.close();
    }
  });

  it.each([
    [
      '/api/public/real-portrait-invites/invite-secret',
      '/api/public/real-portrait-invites/[REDACTED]',
    ],
    [
      '/api/public/real-portrait-invites/invite-secret/status?poll=1',
      '/api/public/real-portrait-invites/[REDACTED]/status?poll=1',
    ],
    [
      '/api/public/real-portrait-invites/invite-secret/start-verification',
      '/api/public/real-portrait-invites/[REDACTED]/start-verification',
    ],
    [
      '/api/public/real-portrait-authorizations/manage-secret',
      '/api/public/real-portrait-authorizations/[REDACTED]',
    ],
    [
      '/api/public/real-portrait-authorizations/manage-secret/revoke',
      '/api/public/real-portrait-authorizations/[REDACTED]/revoke',
    ],
    [
      '/api/providers/volc/real-portrait-validation/callback-secret?source=volc',
      '/api/providers/volc/real-portrait-validation/[REDACTED]?source=volc',
    ],
    [
      '/api/providers/volc/real-portrait-validation/callback-secret?bytedToken=face-secret&resultCode=10000&verify_type=real_time',
      '/api/providers/volc/real-portrait-validation/[REDACTED]?bytedToken=[REDACTED]&resultCode=10000&verify_type=real_time',
    ],
    [
      '/portrait-consent/invite/invite-secret',
      '/portrait-consent/invite/[REDACTED]',
    ],
    [
      '/portrait-consent/authorization/manage-secret?view=status',
      '/portrait-consent/authorization/[REDACTED]?view=status',
    ],
  ])('日志 URL 会移除真人 bearer，同时保留路由后缀：%s', (value, expected) => {
    expect(redactSensitiveRequestUrl(value)).toBe(expected);
  });

  it('日志 URL 不改写普通 API 路径与查询参数', () => {
    const value = '/api/real-portrait-actors/11111111-1111-4111-8111-111111111111?include=assets';
    expect(redactSensitiveRequestUrl(value)).toBe(value);
  });
});
