import type { FastifyRequest } from 'fastify';
import { env } from './env.js';

interface RequestOriginConfiguration {
  CORS_ORIGIN: string;
  APP_BASE_URL: string;
}

export function resolveTrustedRequestAppOrigin(
  request: Pick<FastifyRequest, 'headers'>,
  configuration: RequestOriginConfiguration = env,
) {
  return resolveTrustedAppOrigin(request.headers.origin, configuration);
}

export function resolveTrustedAppOrigin(
  originHeader: string | undefined,
  configuration: RequestOriginConfiguration = env,
) {
  const fallbackOrigin = new URL(configuration.APP_BASE_URL).origin;
  const candidate = normalizeOrigin(originHeader);
  if (!candidate) return fallbackOrigin;

  const allowedOrigins = new Set(
    configuration.CORS_ORIGIN
      .split(',')
      .map(origin => normalizeOrigin(origin))
      .filter((origin): origin is string => origin !== null),
  );
  return allowedOrigins.has(candidate) ? candidate : fallbackOrigin;
}

function normalizeOrigin(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '*') return null;
  try {
    const url = new URL(trimmed);
    return url.origin === trimmed.replace(/\/$/, '') ? url.origin : null;
  } catch {
    return null;
  }
}
