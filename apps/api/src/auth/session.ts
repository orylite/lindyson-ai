import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import type { AuthToken } from '../domain/types.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthToken;
    user: AuthToken;
  }
}

export async function requireAuth(request: FastifyRequest) {
  const rawToken = readCookie(request.headers.cookie, AUTH_COOKIE_NAME);
  if (!rawToken) throw unauthorized();

  let token: AuthToken;
  try {
    token = await request.server.jwt.verify<AuthToken>(rawToken);
  } catch {
    throw unauthorized();
  }

  if (!isAuthToken(token)) throw unauthorized();

  const result = await pool.query<{
    email: string;
    role: 'user' | 'admin';
    status: 'active' | 'frozen' | 'trial';
    auth_version: number;
  }>(
    `SELECT email, role, status, auth_version
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [token.id],
  );
  const current = result.rows[0];
  if (
    !current
    || current.status === 'frozen'
    || current.email.toLowerCase() !== token.email.toLowerCase()
    || current.role !== token.role
    || current.auth_version !== token.authVersion
  ) {
    throw unauthorized();
  }

  return {
    id: token.id,
    email: current.email,
    role: current.role,
    authVersion: current.auth_version,
  } satisfies AuthToken;
}

export async function requireAdmin(request: FastifyRequest) {
  const user = await requireAuth(request);
  if (user.role !== 'admin') {
    const error = new Error('需要管理员权限');
    Object.assign(error, { statusCode: 403 });
    throw error;
  }

  return user;
}

export function signAuthToken(app: FastifyInstance, token: AuthToken) {
  return app.jwt.sign(token, { expiresIn: '14d' });
}

export const AUTH_COOKIE_NAME = 'lindyson_session';
const AUTH_COOKIE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

export function issueAuthSession(app: FastifyInstance, reply: FastifyReply, token: AuthToken) {
  const signedToken = signAuthToken(app, token);
  reply.header('Cache-Control', 'no-store');
  reply.header('Set-Cookie', serializeAuthCookie(signedToken, AUTH_COOKIE_MAX_AGE_SECONDS));
}

export function clearAuthSession(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store');
  reply.header('Set-Cookie', serializeAuthCookie('', 0));
}

function serializeAuthCookie(value: string, maxAge: number) {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readCookie(header: string | undefined, name: string) {
  if (!header) return null;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function isAuthToken(value: unknown): value is AuthToken {
  if (!value || typeof value !== 'object') return false;
  const token = value as Partial<AuthToken>;
  return typeof token.id === 'string'
    && typeof token.email === 'string'
    && (token.role === 'user' || token.role === 'admin')
    && Number.isInteger(token.authVersion)
    && Number(token.authVersion) > 0;
}

function unauthorized() {
  return Object.assign(new Error('登录状态已失效，请重新登录'), {
    statusCode: 401,
    code: 'AUTH_SESSION_INVALID',
  });
}
