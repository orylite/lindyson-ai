import { apiErrorSchema } from '@lindyson/api-contracts';
import type { z,ZodTypeAny } from 'zod';

const LEGACY_TOKEN_KEY = 'lindyson_api_token';
const SESSION_EVENT = 'lindyson:session-change';
const SESSION_CHANNEL = 'lindyson-session';

export type SessionChangeReason = 'logout' | 'expired' | 'authenticated';

let sessionEpoch = 0;
let sessionController = new AbortController();
let sessionChannel: BroadcastChannel | null = null;

export class ApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;

  constructor(message: string, status: number, code?: string, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function isPaginationSnapshotChanged(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === 'PAGINATION_SNAPSHOT_CHANGED';
}

/** 快照失效需要立即回首页建立新快照；其他查询错误沿用 React Query 的三次重试上限。 */
export function retryUnlessPaginationSnapshotChanged(failureCount: number, error: unknown) {
  return !isPaginationSnapshotChanged(error) && failureCount < 3;
}

export interface ApiRequestInit extends RequestInit {
  /** 登录、注册等会建立新会话的请求不应绑定到旧会话信号。 */
  sessionScoped?: boolean;
  /** 默认 15 秒；传 0 可由调用方自行控制超时。 */
  timeoutMs?: number;
}

if (typeof window !== 'undefined') {
  // 旧版本曾把 bearer token 放在 localStorage。cookie 会话启用后立即清除残留，
  // 防止扩展或旧代码继续读取长期凭据。
  window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  ensureSessionChannel();
}

export function getApiUrl(path: string) {
  const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  return `${baseUrl}${path}`;
}

export function getSessionEpoch() {
  return sessionEpoch;
}

/** 登录或注册成功后隔离登录前仍在飞行中的请求。 */
export function beginAuthenticatedSession() {
  rotateController();
  // BroadcastChannel 不会把消息回送发送方，因此只让其他标签页清空并换到新账号。
  ensureSessionChannel()?.postMessage({ reason: 'authenticated' satisfies SessionChangeReason });
}

/** 统一失效当前会话，并通知同源的其他标签页。 */
export function clearApiSession(reason: SessionChangeReason = 'logout') {
  rotateSession(reason, true);
}

/**
 * 第一方 JSON API 的统一入口。响应 Schema 必填，禁止把未知 JSON 直接断言为业务类型。
 */
export async function apiRequest<Schema extends ZodTypeAny>(
  path: string,
  responseSchema: Schema,
  init: ApiRequestInit = {},
): Promise<z.output<Schema>> {
  const { sessionScoped = true, timeoutMs = 15_000, ...requestInit } = init;
  const requestEpoch = sessionEpoch;
  const headers = new Headers(requestInit.headers);

  if (!(requestInit.body instanceof FormData) && requestInit.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const timeoutController = new AbortController();
  const timeout = timeoutMs > 0
    ? globalThis.setTimeout(() => timeoutController.abort(new DOMException('请求超时，请稍后重试', 'TimeoutError')), timeoutMs)
    : undefined;
  const combinedSignal = combineSignals([
    requestInit.signal,
    sessionScoped ? sessionController.signal : undefined,
    timeoutMs > 0 ? timeoutController.signal : undefined,
  ]);

  try {
    const response = await fetch(getApiUrl(path), {
      ...requestInit,
      credentials: 'include',
      headers,
      signal: combinedSignal.signal,
    });

    if (sessionScoped && requestEpoch !== sessionEpoch) throw createAbortError();

    if (response.status === 401 && shouldExpireSession(path)) {
      clearApiSession('expired');
    }

    const contentType = response.headers.get('content-type') ?? '';
    let payload: unknown = null;
    if (contentType.includes('application/json')) {
      try {
        payload = await response.json() as unknown;
      } catch {
        throw new ApiError('服务器响应不是有效 JSON', 502, 'INVALID_API_RESPONSE', response.headers.get('x-request-id') ?? undefined);
      }
    }

    if (sessionScoped && requestEpoch !== sessionEpoch) throw createAbortError();
    if (!response.ok) {
      const parsedError = apiErrorSchema.safeParse(payload);
      if (!parsedError.success) {
        throw new ApiError(
          '服务器错误响应格式无效',
          502,
          'INVALID_API_RESPONSE',
          response.headers.get('x-request-id') ?? undefined,
        );
      }
      throw new ApiError(
        parsedError.data.message,
        response.status,
        parsedError.data.code,
        parsedError.data.requestId || response.headers.get('x-request-id') || undefined,
      );
    }

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError(
        '服务器响应格式无效',
        502,
        'INVALID_API_RESPONSE',
        response.headers.get('x-request-id') ?? undefined,
      );
    }
    return parsed.data as z.output<Schema>;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiError(error.message, 0, 'REQUEST_TIMEOUT');
    }
    throw error;
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
    combinedSignal.cleanup();
  }
}

export function jsonBody(payload: unknown) {
  return JSON.stringify(payload);
}

function rotateSession(reason: SessionChangeReason, broadcast: boolean) {
  rotateController();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { reason, epoch: sessionEpoch } }));
  }
  if (broadcast) ensureSessionChannel()?.postMessage({ reason });
}

function ensureSessionChannel() {
  if (sessionChannel || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return sessionChannel;
  sessionChannel = new BroadcastChannel(SESSION_CHANNEL);
  sessionChannel.addEventListener('message', event => {
    const payload = isRecord(event.data) ? event.data : {};
    const reason = payload.reason;
    if (reason === 'logout' || reason === 'expired' || reason === 'authenticated') rotateSession(reason, false);
  });
  return sessionChannel;
}

function rotateController() {
  sessionController.abort(createAbortError());
  sessionController = new AbortController();
  sessionEpoch += 1;
}

function shouldExpireSession(path: string) {
  return !(
    path === '/api/auth/login'
    || path === '/api/auth/register'
    || path === '/api/auth/register-code'
    || path === '/api/auth/forgot-password'
    || path === '/api/auth/reset-password'
  );
}

function combineSignals(values: Array<AbortSignal | null | undefined>) {
  const signals = values.filter((signal): signal is AbortSignal => Boolean(signal));
  if (signals.length === 0) return { signal: undefined, cleanup: () => undefined };
  const aborted = signals.find(signal => signal.aborted);
  if (aborted) return { signal: aborted, cleanup: () => undefined };
  if (signals.length === 1) return { signal: signals[0], cleanup: () => undefined };
  const controller = new AbortController();
  const cleanup = () => {
    signals.forEach(signal => signal.removeEventListener('abort', abort));
  };
  const abort = (event: Event) => {
    const source = event.target as AbortSignal;
    cleanup();
    controller.abort(source.reason ?? createAbortError());
  };
  signals.forEach(signal => signal.addEventListener('abort', abort, { once: true }));
  return { signal: controller.signal, cleanup };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createAbortError() {
  return new DOMException('会话已切换，请求已取消', 'AbortError');
}
