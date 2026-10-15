import { registerReferralRoutes } from './routes/referralRoutes.js';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import jwt from '@fastify/jwt';
import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { clearAuthSession } from './auth/session.js';
import { registerApiContractRouteHook } from './apiContractRoutes.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { registerAccountRoutes } from './routes/accountRoutes.js';
import { registerAdminRoutes } from './routes/adminRoutes.js';
import { registerAssetsRoutes } from './routes/assetsRoutes.js';
import { registerAuthRoutes } from './routes/authRoutes.js';
import { registerGenerationRoutes } from './routes/generationRoutes.js';
import { registerPromptWizardRoutes } from './routes/promptWizardRoutes.js';
import { registerTkPromptEngineRoutes } from './routes/tkPromptEngineRoutes.js';
import { registerRealPortraitRoutes } from './routes/realPortraitRoutes.js';
import { registerLocalStorageRoutes } from './storage/localStorageRoute.js';
import { registerOrdersRoutes } from './routes/ordersRoutes.js';
import { registerPublicRoutes } from './routes/publicRoutes.js';
import { registerSupportRoutes } from './routes/supportRoutes.js';
import { getGenerationQueue } from './queues/generationQueue.js';
import { getPromptWizardQueue } from './queues/promptWizardQueue.js';
import { getTkPromptEngineQueue } from './queues/tkPromptEngineQueue.js';
import { assertStorageReady } from './storage/storageService.js';
import { registerMcpRoutes, assertMcpReady } from './mcp/routes.js';

export function buildApp() {
  const app = fastify({
    logger: env.NODE_ENV === 'test' ? false : {
      serializers: {
        req(request: {
          method?: string;
          url?: string;
          headers?: { host?: string };
          remoteAddress?: string;
          remotePort?: number;
        }) {
          return {
            method: request.method,
            url: redactSensitiveRequestUrl(request.url ?? ''),
            host: request.headers?.host,
            remoteAddress: request.remoteAddress,
            remotePort: request.remotePort,
          };
        },
      },
    },
    // TRUST_PROXY 可能是布尔、跳数或地址列表，统一收敛到 Fastify 的 trustProxy 类型，避免联合类型让重载选择失败。
    trustProxy: env.TRUST_PROXY as FastifyServerOptions['trustProxy'],
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerApiContractRouteHook(app);

  app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map(origin => origin.trim()),
    credentials: true,
  });
  app.register(jwt, {
    secret: env.JWT_SECRET,
  });
  app.register(formbody);

  const allowedOrigins = new Set(
    env.CORS_ORIGIN.split(',').map(origin => origin.trim().replace(/\/$/, '')).filter(Boolean),
  );
  app.addHook('onRequest', async request => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    const origin = request.headers.origin?.replace(/\/$/, '');
    if (!origin) {
      if (request.headers['sec-fetch-site'] === 'cross-site') {
        throw Object.assign(new Error('请求来源不被允许'), { statusCode: 403, code: 'ORIGIN_NOT_ALLOWED' });
      }
      return;
    }
    if (env.CORS_ORIGIN === '*' || allowedOrigins.has(origin)) return;
    throw Object.assign(new Error('请求来源不被允许'), { statusCode: 403, code: 'ORIGIN_NOT_ALLOWED' });
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const isPortraitProviderCallback = request.url.startsWith(
      '/api/providers/volc/real-portrait-validation/',
    );
    reply
      .header('X-Request-ID', request.id)
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', isPortraitProviderCallback ? 'no-referrer' : 'strict-origin-when-cross-origin')
      .header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isPortraitProviderCallback) {
      reply
        .header('Cache-Control', 'no-store, max-age=0')
        .header('X-Robots-Tag', 'noindex, nofollow');
    }
    return payload;
  });

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/ready', async () => {
    await pool.query('SELECT 1');
    await getGenerationQueue().getJobCounts('waiting');
    await getPromptWizardQueue().getJobCounts('waiting');
    await getTkPromptEngineQueue().getJobCounts('waiting');
    await assertStorageReady();
    await assertMcpReady();
    return { ok: true };
  });

  app.register(registerPublicRoutes);
  app.register(registerAuthRoutes);
  app.register(registerAccountRoutes);
  app.register(registerMcpRoutes);
  app.register(registerReferralRoutes);
  app.register(registerGenerationRoutes);
  app.register(registerPromptWizardRoutes);
  app.register(registerTkPromptEngineRoutes);
  app.register(registerRealPortraitRoutes);
  app.register(registerAssetsRoutes);
  app.register(registerOrdersRoutes);
  app.register(registerSupportRoutes);
  app.register(registerAdminRoutes);
  if (env.STORAGE_DRIVER === 'local') {
    app.register(registerLocalStorageRoutes);
  }

  setApiErrorHandler(app);

  return app;
}

export function setApiErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const issues = error.validation.map(normalizeRequestValidationIssue);
      request.log.info({
        validationIssues: error.validation,
        method: request.method,
        url: request.routeOptions.url ?? redactSensitiveRequestUrl(request.url),
      }, 'API 请求不符合契约');
      return reply.code(400).send({
        message: '请求参数不正确',
        code: 'VALIDATION_ERROR',
        requestId: request.id,
        issues,
      });
    }

    if (isResponseSerializationError(error)) {
      request.log.error({
        validationIssues: error.cause.issues,
        method: error.method,
        url: request.routeOptions.url ?? redactSensitiveRequestUrl(error.url),
      }, 'API 成功响应不符合契约');
      return reply.code(500).send({
        message: '服务器响应格式错误',
        code: 'API_RESPONSE_SCHEMA_MISMATCH',
        requestId: request.id,
      });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: '请求参数不正确',
        code: 'VALIDATION_ERROR',
        requestId: request.id,
        issues: error.issues.map(issue => ({
          code: issue.code,
          path: issue.path,
          message: issue.message,
        })),
      });
    }

    const fastifyError = error as { statusCode?: number; message?: string; exposeMessage?: boolean; code?: string };
    const errorCode = safeErrorCode(error);
    const databaseConflict = fastifyError.code === '23505' || fastifyError.code === '23503';
    const invalidDatabaseInput = fastifyError.code === '22P02';
    const statusCode = typeof fastifyError.statusCode === 'number'
      ? fastifyError.statusCode
      : databaseConflict ? 409 : invalidDatabaseInput ? 400 : 500;
    const shouldExposeMessage = statusCode < 500 || env.NODE_ENV !== 'production' || fastifyError.exposeMessage === true;
    const message = databaseConflict
      ? '相同请求已处理，请勿重复提交'
      : invalidDatabaseInput ? '请求参数格式不正确'
      : errorCode === 'API_RESPONSE_SCHEMA_MISMATCH' ? '服务器响应格式错误'
      : shouldExposeMessage ? fastifyError.message : '服务器错误';
    if (statusCode >= 500) {
      request.log.error({
        errorCode,
        errorMessage: error instanceof Error ? error.message.trim().slice(0, 256) : 'Unknown error',
        ...responseValidationLogContext(error),
      }, '请求处理失败');
    }
    if (statusCode === 401 && errorCode === 'AUTH_SESSION_INVALID') {
      clearAuthSession(reply);
    }
    return reply.code(statusCode).send({
      message,
      code: errorCode,
      requestId: request.id,
    });
  });
}

/**
 * 公开邀请、本人管理与供应商 callback 仍以 path bearer 兼容 V1；任何日志都只能看到占位符。
 * 前端邀请/管理页的新链接使用 fragment，fragment 本身不会进入 HTTP 请求。
 */
export function redactSensitiveRequestUrl(value: string) {
  if (/^\/(?:oauth(?:\/|\?)|mcp\/authorize|api\/mcp\/interaction)/.test(value)) {
    return value.split('?')[0]!.replace(/(\/interaction\/)[^/]+/, '$1[REDACTED]');
  }
  return value.replace(
    /(\/api\/(?:public\/real-portrait-(?:invites|authorizations)|providers\/volc\/real-portrait-validation)\/)[^/?#]+/g,
    '$1[REDACTED]',
  ).replace(
    /(\/portrait-consent\/(?:invite|authorization)\/)[^/?#]+/g,
    '$1[REDACTED]',
  ).replace(
    /([?&]bytedToken=)[^&#]*/gi,
    '$1[REDACTED]',
  );
}

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const value = (error as { code?: unknown }).code;
  if (typeof value === 'string' || typeof value === 'number') return String(value).slice(0, 64);
  return error instanceof Error ? error.name.slice(0, 64) : 'UNKNOWN';
}

function responseValidationLogContext(error: unknown) {
  if (!error || typeof error !== 'object') return {};
  const candidate = error as {
    code?: unknown;
    responseValidationPhase?: unknown;
    validationIssues?: unknown;
  };
  if (candidate.code !== 'API_RESPONSE_SCHEMA_MISMATCH') return {};
  return {
    responseValidationPhase: candidate.responseValidationPhase,
    validationIssues: candidate.validationIssues,
  };
}

function normalizeRequestValidationIssue(value: unknown) {
  const item = isRecord(value) ? value : {};
  const params = isRecord(item.params) ? item.params : {};
  const issue = isRecord(params.issue) ? params.issue : {};
  return {
    code: typeof issue.code === 'string' ? issue.code : 'custom',
    path: Array.isArray(issue.path)
      ? issue.path.filter(segment => typeof segment === 'string' || typeof segment === 'number')
      : [],
    message: typeof issue.message === 'string'
      ? issue.message
      : typeof item.message === 'string' ? item.message : '请求参数不正确',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
