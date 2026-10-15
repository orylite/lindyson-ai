import { createHmac, timingSafeEqual } from 'node:crypto';
import middie from '@fastify/middie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { endpointContracts } from '@lindyson/api-contracts';
import { env } from '../config/env.js';
import { pool, withTransaction } from '../db/pool.js';
import { requireAuth } from '../auth/session.js';
import { getMcpImportQueue, closeMcpImportQueue } from '../queues/mcpImportQueue.js';
import { createMcpOAuthProvider, authenticateMcp, mcpClientLabel } from './oauth.js';
import {
  mcpIssuerUrl,
  mcpResourceUrl,
  MCP_SCOPES,
  mcpError,
  enforceMcpRateLimit,
} from './security.js';
import { createMcpNodeHandler } from './tools.js';
import { PostgresOAuthAdapter } from './oauthAdapter.js';

export async function registerMcpRoutes(app: FastifyInstance) {
  app.get('/api/account/mcp', async (request) => {
    const user = await requireAuth(request);
    if (!env.MCP_ENABLED) return { enabled: false, url: null, connections: [] };
    const result = await pool.query<{
      id: string;
      scopes: string[];
      created_at: Date;
      last_used_at: Date | null;
      revoked_at: Date | null;
      auth_version: number;
      client_id: string;
    }>(
      'SELECT id,scopes,created_at,last_used_at,revoked_at,auth_version,client_id FROM mcp_connections WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',
      [user.id],
    );
    return {
      enabled: true,
      url: mcpResourceUrl(),
      connections: await Promise.all(result.rows.map(async (row) => ({
        id: row.id,
        clientName: mcpClientLabel((await provider.Client.find(row.client_id))?.redirectUris),
        scopes: row.scopes,
        createdAt: new Date(row.created_at).toISOString(),
        lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
        revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
        active:
          !row.revoked_at &&
          row.auth_version === user.authVersion &&
          Date.now() - new Date(row.created_at).getTime() < 30 * 86400_000,
      }))),
    };
  });
  app.delete('/api/account/mcp/:id', async (request) => {
    const user = await requireAuth(request);
    if (!env.MCP_ENABLED) throw mcpError('MCP_DISABLED', 'MCP 连接尚未开放', 404);
    const { id } = endpointContracts.mcpConnectionRevoke.params.parse(request.params);
    const result = await withTransaction(async (client) => {
      const connection = await client.query<{ grant_id: string }>(
        'UPDATE mcp_connections SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND user_id=$2 RETURNING grant_id',
        [id, user.id],
      );
      if (!connection.rows[0]) throw mcpError('MCP_CONNECTION_NOT_FOUND', '连接不存在', 404);
      await client.query(
        "UPDATE mcp_file_imports SET status='failed',error_code='MCP_AUTH_INVALID',source_encrypted=NULL WHERE connection_id=$1 AND status='queued'",
        [id],
      );
      return connection.rows[0];
    });
    await new PostgresOAuthAdapter('Grant').destroy(result.grant_id);
    await new PostgresOAuthAdapter('AccessToken').revokeByGrantId(result.grant_id);
    return { ok: true };
  });
  if (!env.MCP_ENABLED) return;
  const provider = createMcpOAuthProvider();
  // 动态客户端注册不需要认证，按来源 IP 限流，避免被批量注册撑大 mcp_oauth_states。
  app.addHook('onRequest', async (request) => {
    if (request.method === 'POST' && request.url.split('?')[0] === '/oauth/reg')
      await enforceMcpRateLimit(`oauth-reg:${request.ip}`, 10);
  });
  await app.register(middie);
  app.use('/oauth', provider.callback());
  // 为封装插件建立路由归属，确保 middie 也处理 OAuth 路径而非进入根级 404。
  app.all('/oauth/*', async (_request, reply) => reply.callNotFound());
  const resourceMetadata = () => ({
    resource: mcpResourceUrl(),
    authorization_servers: [mcpIssuerUrl()],
    scopes_supported: [...MCP_SCOPES],
    resource_name: 'Lindyson AI',
    resource_documentation: new URL('/app/account-center', env.APP_BASE_URL).href,
  });
  app.get('/.well-known/oauth-protected-resource/mcp', async () => resourceMetadata());
  app.get('/.well-known/oauth-protected-resource', async () => resourceMetadata());
  // 兼容按 RFC 8414 在路径前插入 well-known 的客户端。
  app.get('/.well-known/oauth-authorization-server/oauth', async (_request, reply) =>
    reply.redirect(`${mcpIssuerUrl()}/.well-known/openid-configuration`),
  );

  async function interactionDetails(request: FastifyRequest, reply: FastifyReply) {
    const { id } = endpointContracts.mcpInteraction.params.parse(request.params);
    const details = await provider.interactionDetails(request.raw, reply.raw);
    if (details.uid !== id)
      throw mcpError('MCP_INTERACTION_INVALID', '授权页面已过期，请从 ChatGPT 或 Codex 重新连接', 400);
    return details;
  }
  app.get('/api/mcp/interaction/:id', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const details = await interactionDetails(request, reply);
    const user = await requireAuth(request).catch((error) => {
      if ((error as { statusCode?: number }).statusCode === 401) return null;
      throw error;
    });
    const scopes = String(details.params.scope ?? '')
      .split(' ')
      .filter((scope) => MCP_SCOPES.includes(scope as (typeof MCP_SCOPES)[number]));
    return {
      id: details.uid,
      clientName: mcpClientLabel((await provider.Client.find(String(details.params.client_id)))?.redirectUris),
      loginRequired: !user,
      email: user?.email ?? null,
      scopes,
      csrfToken: user ? consentToken(details.uid, user.id, user.authVersion) : null,
    };
  });
  app.post('/api/mcp/interaction/:id', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const user = await requireAuth(request);
    const details = await interactionDetails(request, reply);
    const payload = endpointContracts.mcpInteractionSubmit.body.parse(request.body);
    const expected = Buffer.from(consentToken(details.uid, user.id, user.authVersion));
    const supplied = Buffer.from(payload.csrfToken);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      throw mcpError('MCP_CSRF_INVALID', '授权请求无效', 403);
    if (!payload.allow)
      return {
        redirectUrl: await provider.interactionResult(
          request.raw,
          reply.raw,
          { error: 'access_denied', error_description: '用户拒绝授权' },
          { mergeWithLastSubmission: false },
        ),
      };
    const clientId = String(details.params.client_id);
    const scopes = String(details.params.scope ?? '')
      .split(' ')
      .filter((scope) => MCP_SCOPES.includes(scope as (typeof MCP_SCOPES)[number]));
    if (!scopes.length) throw mcpError('MCP_SCOPE_REQUIRED', '没有可授权的权限');
    const accountId = `${user.id}:${user.authVersion}`;
    const grant = new provider.Grant({ accountId, clientId });
    grant.addOIDCScope(scopes.join(' '));
    grant.addResourceScope(mcpResourceUrl(), scopes.join(' '));
    const grantId = await grant.save();
    await pool.query(
      'INSERT INTO mcp_connections (grant_id,user_id,auth_version,client_id,scopes) VALUES ($1,$2,$3,$4,$5)',
      [grantId, user.id, user.authVersion, clientId, scopes],
    );
    return {
      redirectUrl: await provider.interactionResult(
        request.raw,
        reply.raw,
        { login: { accountId, remember: false }, consent: { grantId } },
        { mergeWithLastSubmission: false },
      ),
    };
  });
  app.all('/mcp', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const expected = new URL(mcpResourceUrl());
    if (
      request.host !== expected.host ||
      (request.headers.origin && request.headers.origin !== expected.origin)
    ) {
      return reply.code(403).send({ error: 'MCP_ORIGIN_INVALID' });
    }
    try {
      // 未认证流量按地址限流；身份确认后各工具再按用户限流。
      const identity = await authenticateMcp(provider, request.headers.authorization).catch(
        async (error) => {
          if ((error as { statusCode?: number }).statusCode === 401)
            await enforceMcpRateLimit(`http:${request.ip}`, 180);
          throw error;
        },
      );
      const handler = createMcpNodeHandler(identity);
      reply.raw.setHeader('Cache-Control', 'no-store');
      reply.raw.setHeader('X-Content-Type-Options', 'nosniff');
      reply.hijack();
      await handler(request.raw, reply.raw, request.body);
    } catch (error) {
      if (reply.raw.headersSent) {
        reply.raw.end();
        return;
      }
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 401)
        reply.header(
          'WWW-Authenticate',
          `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', mcpResourceUrl()).href}", scope="${MCP_SCOPES.join(' ')}"`,
        );
      if (status === 429) reply.header('Retry-After', '60');
      const code = status === 401 ? 401 : status === 429 ? 429 : 503;
      const body = {
        error:
          status === 401
            ? 'MCP_AUTH_REQUIRED'
            : status === 429
              ? 'MCP_RATE_LIMITED'
              : 'MCP_UNAVAILABLE',
      };
      if (reply.sent) {
        reply.raw.writeHead(code, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        reply.raw.end(JSON.stringify(body));
        return;
      }
      return reply.code(code).send(body);
    }
  });
  app.addHook('onClose', async () => closeMcpImportQueue());
}
export async function assertMcpReady() {
  if (!env.MCP_ENABLED) return;
  await pool.query('SELECT 1 FROM mcp_connections LIMIT 1');
  await getMcpImportQueue().getJobCounts('waiting', 'active', 'failed');
}
function consentToken(interactionId: string, userId: string, version: number) {
  return createHmac('sha256', env.MCP_OAUTH_SECRET!)
    .update(`consent:${interactionId}:${userId}:${version}`)
    .digest('base64url');
}
