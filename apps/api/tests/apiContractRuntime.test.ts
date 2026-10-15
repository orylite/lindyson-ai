import fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { setApiErrorHandler } from '../src/app.js';

function contractTestApp() {
  const app = fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  setApiErrorHandler(app);
  return app;
}

describe('API 契约运行时', () => {
  it('严格请求 Schema 拒绝未声明字段并返回统一 400', async () => {
    const app = contractTestApp();
    app.post('/strict-request', {
      schema: {
        body: z.object({ name: z.string() }).strict(),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    }, async () => ({ ok: true as const }));

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/strict-request',
        payload: { name: 'Lindyson', legacyName: 'old' },
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
    } finally {
      await app.close();
    }
  });

  it('成功响应不符合 Schema 时返回不泄露字段细节的统一 500', async () => {
    const app = contractTestApp();
    app.get('/invalid-response', {
      schema: {
        response: { 200: z.object({ item: z.object({ id: z.string().uuid() }) }) },
      },
    }, async () => ({ item: { id: 123 } }));

    try {
      const response = await app.inject({ method: 'GET', url: '/invalid-response' });
      const body = response.json();

      expect(response.statusCode).toBe(500);
      expect(body).toEqual({
        message: '服务器响应格式错误',
        code: 'API_RESPONSE_SCHEMA_MISMATCH',
        requestId: expect.any(String),
      });
      expect(body).not.toHaveProperty('issues');
    } finally {
      await app.close();
    }
  });

  it('响应 Schema 会过滤未声明字段', async () => {
    const app = contractTestApp();
    app.get('/filtered-response', {
      schema: {
        response: { 200: z.object({ user: z.object({ id: z.string() }) }) },
      },
    }, async () => ({
      user: { id: 'user-1', passwordHash: 'must-not-leak' },
      databaseDebug: true,
    }));

    try {
      const response = await app.inject({ method: 'GET', url: '/filtered-response' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ user: { id: 'user-1' } });
    } finally {
      await app.close();
    }
  });
});
