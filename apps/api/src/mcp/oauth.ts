import Provider, { errors } from 'oidc-provider';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { PostgresOAuthAdapter } from './oauthAdapter.js';
import {
  enforceMcpRateLimit,
  mcpError,
  mcpIssuerUrl,
  mcpResourceUrl,
  MCP_SCOPES,
  type McpIdentity,
} from './security.js';

export function isChatGptRedirect(value: string) {
  try {
    const url = new URL(value);
    return (
      url.origin === 'https://chatgpt.com' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === '/connector_platform_oauth_redirect' ||
        /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(url.pathname))
    );
  } catch {
    return false;
  }
}

export function isCodexRedirect(value: string) {
  // Codex 本机 OAuth 回调：原样匹配，避免 URL 规范化放行变体地址或路径。
  const match = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})\/callback(?:\/[A-Za-z0-9_-]+)?$/.exec(value);
  return Boolean(match && Number(match[1]) <= 65535);
}

export function mcpClientLabel(redirectUris: readonly string[] = []) {
  if (redirectUris.length && redirectUris.every(isChatGptRedirect)) return 'ChatGPT';
  if (redirectUris.length && redirectUris.every(isCodexRedirect)) return 'Codex';
  return 'MCP 客户端';
}

export function createMcpOAuthProvider() {
  const provider = new Provider(mcpIssuerUrl(), {
    adapter: PostgresOAuthAdapter,
    clients: [],
    jwks: JSON.parse(env.MCP_OAUTH_JWKS_JSON!),
    cookies: {
      keys: [env.MCP_OAUTH_SECRET!],
      names: {
        session: 'lindyson_mcp_session',
        interaction: 'lindyson_mcp_interaction',
        resume: 'lindyson_mcp_resume',
      },
      short: {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: mcpResourceUrl().startsWith('https:'),
      },
      long: { httpOnly: true, sameSite: 'lax', secure: mcpResourceUrl().startsWith('https:') },
    },
    scopes: [...MCP_SCOPES],
    responseTypes: ['code'],
    clientDefaults: {
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    pkce: { required: () => true },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true },
      revocation: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => mcpResourceUrl(),
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, resource) => {
          if (resource !== mcpResourceUrl()) throw new errors.InvalidTarget();
          return {
            scope: MCP_SCOPES.join(' '),
            audience: resource,
            accessTokenFormat: 'opaque',
            accessTokenTTL: 900,
          };
        },
      },
    },
    extraClientMetadata: {
      properties: ['lindyson_client'],
      validator: (_ctx, _key, _value, metadata) => {
        if (
          metadata.jwks_uri ||
          metadata.sector_identifier_uri ||
          (metadata.subject_type && metadata.subject_type !== 'public') ||
          !['none', 'client_secret_post', 'client_secret_basic'].includes(
            metadata.token_endpoint_auth_method ?? 'none',
          ) ||
          !metadata.redirect_uris?.length ||
          mcpClientLabel(metadata.redirect_uris) === 'MCP 客户端' ||
          metadata.grant_types?.some(
            (type) => !['authorization_code', 'refresh_token'].includes(type),
          ) ||
          metadata.response_types?.some((type) => type !== 'code')
        ) {
          throw new errors.InvalidClientMetadata(
            '仅允许 ChatGPT HTTPS 回调或 Codex 本机回调的授权码客户端',
          );
        }
      },
    },
    interactions: {
      url: (_ctx, interaction) =>
        `${env.APP_BASE_URL.replace(/\/$/, '')}/mcp/authorize?interaction=${encodeURIComponent(interaction.uid)}`,
    },
    findAccount: async (_ctx, subject) => {
      const [id, version] = subject.split(':');
      if (!/^[0-9a-f-]{36}$/.test(id ?? '') || !/^\d+$/.test(version ?? '')) return undefined;
      const result = await pool.query(
        "SELECT id FROM users WHERE id=$1 AND auth_version=$2 AND status <> 'frozen'",
        [id, Number(version)],
      );
      return result.rowCount
        ? { accountId: subject, claims: async () => ({ sub: subject }) }
        : undefined;
    },
    issueRefreshToken: (_ctx, client) => client.grantTypeAllowed('refresh_token'),
    rotateRefreshToken: () => true,
    expiresWithSession: () => false,
    ttl: {
      AccessToken: 900,
      AuthorizationCode: 120,
      Interaction: 600,
      // 轮换只继承剩余寿命，不能把授权期限不断延后。
      RefreshToken: (ctx) =>
        Math.min(
          30 * 86400,
          ctx.oidc.entities.RotatedRefreshToken?.remainingTTL ?? 30 * 86400,
          ctx.oidc.entities.Grant?.remainingTTL ?? 30 * 86400,
        ),
      Grant: 30 * 86400,
      Session: 30 * 86400,
    },
    renderError: (ctx) => {
      ctx.type = 'text/plain';
      ctx.body = '授权失败或已过期，请返回 ChatGPT 或 Codex 重新连接。';
    },
  });
  provider.proxy = env.TRUST_PROXY;
  provider.on('server_error', () =>
    console.error(JSON.stringify({ event: 'mcp-oauth-error', code: 'MCP_OAUTH_ERROR' })),
  );
  provider.use(async (ctx, next) => {
    if (['/reg', '/token', '/auth'].includes(ctx.path)) {
      try {
        await enforceMcpRateLimit(`oauth:${ctx.ip}`, 60);
      } catch {
        ctx.status = 429;
        ctx.set('Retry-After', '60');
        ctx.body = { error: 'temporarily_unavailable' };
        return;
      }
    }
    await next();
  });
  return provider;
}

export async function authenticateMcp(
  provider: Provider,
  authorization?: string,
): Promise<McpIdentity> {
  const match = /^Bearer ([^\s]{1,4096})$/i.exec(authorization ?? '');
  if (!match) throw mcpError('MCP_AUTH_INVALID', '请先连接 Lindyson 账号', 401);
  const token = await provider.AccessToken.find(match[1]!);
  if (
    !token ||
    token.isExpired ||
    token.aud !== mcpResourceUrl() ||
    !token.accountId ||
    !token.grantId
  ) {
    throw mcpError('MCP_AUTH_INVALID', '授权令牌无效或已过期', 401);
  }
  const [userId, version] = token.accountId.split(':');
  const result = await pool.query<{ id: string; auth_version: number; scopes: string[] }>(
    `SELECT c.id,c.auth_version,c.scopes FROM mcp_connections c JOIN users u ON u.id=c.user_id
     WHERE c.grant_id=$1 AND c.client_id=$2 AND c.user_id=$3 AND c.auth_version=$4
       AND c.revoked_at IS NULL AND c.created_at > now() - interval '30 days'
       AND u.status <> 'frozen' AND u.auth_version=c.auth_version`,
    [token.grantId, token.clientId, userId, Number(version)],
  );
  const connection = result.rows[0];
  if (!connection) throw mcpError('MCP_AUTH_INVALID', '连接已失效，请重新授权', 401);
  const scopes = (token.scope ?? '')
    .split(' ')
    .filter((scope) => connection.scopes.includes(scope));
  await pool.query(
    "UPDATE mcp_connections SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')",
    [connection.id],
  );
  return {
    userId: userId!,
    authVersion: connection.auth_version,
    connectionId: connection.id,
    scopes,
  };
}
