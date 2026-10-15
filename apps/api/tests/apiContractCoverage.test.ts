import fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import {
  nonJsonApiRouteExemptions,
  registerApiContractRouteHook,
} from '../src/apiContractRoutes.js';
import { setApiErrorHandler } from '../src/app.js';

describe('API 路由契约覆盖', () => {
  it('第一方 JSON 路由缺失共享契约时在注册阶段失败', async () => {
    const app = fastify({ logger: false });
    registerApiContractRouteHook(app);
    try {
      expect(() => {
        app.get('/api/contract-was-forgotten', async () => ({ ok: true }));
      }).toThrow(/\u7f3a\u5c11\u5171\u4eab API \u5951\u7ea6/);
    } finally {
      await app.close();
    }
  });

  it('只豁免明确的 Provider 回调、原始对象流和 302 下载', () => {
    expect([...nonJsonApiRouteExemptions.keys()]).toEqual([
      'POST /api/payments/notify',
      'POST /api/payments/refunds/notify',
      'POST /api/providers/ark/callback/:token',
      'GET /api/providers/volc/real-portrait-validation/:opaqueNonce',
      'GET /api/assets/:id/download',
      'PUT /api/storage/local/*',
      'GET /api/storage/local/*',
    ]);
  });

  it('自动注入的成功响应 Schema 会过滤未声明字段', async () => {
    const app = contractApp();
    app.get('/api/health', async () => ({ ok: true, internalState: 'hidden' }));
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it('自动注入的成功响应 Schema 不匹配时返回统一 500', async () => {
    const app = contractApp();
    app.get('/api/health', async () => ({ ok: false }));
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        message: '服务器响应格式错误',
        code: 'API_RESPONSE_SCHEMA_MISMATCH',
        requestId: expect.any(String),
      });
    } finally {
      await app.close();
    }
  });

  it('自动注入的公共错误 Schema 会过滤未声明的服务端字段', async () => {
    const app = contractApp();
    app.get('/api/health', async (request, reply) => reply.code(418).send({
      message: '测试错误',
      code: 'TEST_ERROR',
      requestId: request.id,
      databaseDebug: '不得发送',
    }));
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(418);
      expect(response.json()).toEqual({
        message: '测试错误',
        code: 'TEST_ERROR',
        requestId: expect.any(String),
      });
    } finally {
      await app.close();
    }
  });
});

function contractApp() {
  const app = fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerApiContractRouteHook(app);
  setApiErrorHandler(app);
  return app;
}
