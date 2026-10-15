export interface PromptWizardRetryPolicy {
  attemptTimeoutMs: number;
  requestBudgetMs: number;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  deadlineAtMs?: number;
  minimumAttemptBudgetMs?: number;
}

export interface PromptWizardRetryEvent {
  attempt: number;
  nextAttempt: number;
  status: number | null;
  errorName: string;
  errorCode: string | null;
  providerRequestId: string | null;
  responseId: string | null;
  xTtLogId: string | null;
  receivedBytes: number;
  receivedEvent: boolean;
  retryable: boolean | null;
  delayMs: number;
}

interface PromptWizardRetryRuntime {
  now?: () => number;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (event: PromptWizardRetryEvent) => void;
  runAttempt?: <T>(attempt: () => Promise<T>) => Promise<T>;
}

export interface PromptWizardRetryResult<T> {
  value: T;
  attempts: number;
}

const RETRYABLE_NETWORK_ERROR_NAMES = new Set([
  'APICONNECTIONERROR',
  'CONNECTIONERROR',
]);

const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETDOWN',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const ABORT_ERROR_NAMES = new Set([
  'ABORTERROR',
  'APIUSERABORTERROR',
  'REQUESTABORTEDERROR',
]);

const PROMPT_WIZARD_MIN_RETRY_ATTEMPT_MS = 60_000;

/**
 * 提示词 Provider 的传输重试边界。JSON/Zod 校验在此函数返回后执行，
 * 因此只有明确的瞬态 HTTP 或首字节前连接失败会进入重试；
 * 单次绝对超时因上游是否已接受请求不可确认，必须直接失败。
 */
export async function runPromptWizardProviderRequest<T>(
  request: (attemptTimeoutMs: number) => Promise<T>,
  policy: PromptWizardRetryPolicy,
  runtime: PromptWizardRetryRuntime = {},
): Promise<PromptWizardRetryResult<T>> {
  if (!Number.isInteger(policy.maxRetries) || policy.maxRetries < 0 || policy.maxRetries > 1) {
    throw Object.assign(new Error('提示词 Provider 最多只能传输重试一次'), {
      code: 'PROMPT_WIZARD_RETRY_POLICY_INVALID',
    });
  }
  const now = runtime.now ?? Date.now;
  const random = runtime.random ?? Math.random;
  const sleep = runtime.sleep ?? defaultSleep;
  const runAttempt = runtime.runAttempt ?? runAttemptDirectly;
  const startedAt = now();
  const requestDeadline = startedAt + policy.requestBudgetMs;
  const deadlineAt = Math.min(requestDeadline, policy.deadlineAtMs ?? requestDeadline);
  let lastError: unknown;

  for (let attemptIndex = 0; attemptIndex <= policy.maxRetries; attemptIndex += 1) {
    try {
      return {
        value: await runAttempt(async () => {
          // 生产执行器会先取得 Provider permit。排队时间属于共享预算，
          // 因此必须在 permit 到手后才计算本次 HTTP 的绝对超时。
          const remainingMs = deadlineAt - now();
          const minimumAttemptBudgetMs = Math.max(
            policy.minimumAttemptBudgetMs ?? 1,
            attemptIndex > 0 ? PROMPT_WIZARD_MIN_RETRY_ATTEMPT_MS : 1,
          );
          if (remainingMs < minimumAttemptBudgetMs) {
            throw retryDeadlineError(lastError);
          }
          const attemptTimeoutMs = Math.max(
            1,
            Math.min(policy.attemptTimeoutMs, remainingMs),
          );
          return request(attemptTimeoutMs);
        }),
        attempts: attemptIndex + 1,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryablePromptWizardProviderError(error) || attemptIndex >= policy.maxRetries) {
        throw error;
      }

      const retryAfterMs = promptWizardRetryAfterMs(error, now());
      const exponentialCeiling = Math.min(
        policy.maxDelayMs,
        policy.baseDelayMs * (2 ** attemptIndex),
      );
      const jitteredDelayMs = Math.floor(exponentialCeiling * (0.75 + random() * 0.25));
      const delayMs = retryAfterMs ?? jitteredDelayMs;
      if (deadlineAt - now() - delayMs < PROMPT_WIZARD_MIN_RETRY_ATTEMPT_MS) {
        throw retryDeadlineError(error);
      }

      runtime.onRetry?.({
        attempt: attemptIndex + 1,
        nextAttempt: attemptIndex + 2,
        status: promptWizardProviderStatus(error),
        errorName: promptWizardProviderErrorName(error),
        errorCode: promptWizardProviderErrorCode(error),
        providerRequestId: promptWizardProviderString(error, 'providerRequestId'),
        responseId: promptWizardProviderString(error, 'responseId'),
        xTtLogId: promptWizardProviderString(error, 'xTtLogId'),
        receivedBytes: promptWizardProviderReceivedBytes(error),
        receivedEvent: promptWizardProviderReceivedEvent(error),
        retryable: promptWizardProviderRetryable(error),
        delayMs,
      });
      await sleep(delayMs);
    }
  }

  throw retryDeadlineError(lastError);
}

export function isRetryablePromptWizardProviderError(error: unknown) {
  if (hasNonRetryablePromptWizardBoundary(error)) return false;
  return inspectErrorChain(error, current => {
    if (promptWizardProviderRetryable(current) === true) return true;
    const name = promptWizardProviderErrorName(current).toUpperCase();
    if (ABORT_ERROR_NAMES.has(name)) return false;
    const status = promptWizardProviderStatus(current);
    if (status !== null) return status === 408 || status === 429 || (status >= 500 && status <= 599);
    const code = promptWizardProviderErrorCode(current);
    return RETRYABLE_NETWORK_ERROR_NAMES.has(name)
      || (code !== null && RETRYABLE_NETWORK_ERROR_CODES.has(code));
  });
}

function hasNonRetryablePromptWizardBoundary(error: unknown) {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    const name = promptWizardProviderErrorName(current).toUpperCase();
    if (
      ABORT_ERROR_NAMES.has(name)
      || promptWizardProviderRetryable(current) === false
      || promptWizardProviderReceivedBytes(current) > 0
      || promptWizardProviderReceivedEvent(current)
    ) return true;
    current = typeof current === 'object' && current !== null
      ? (current as { cause?: unknown }).cause
      : null;
  }
  return false;
}

export function promptWizardRetryAfterMs(error: unknown, nowMs = Date.now()) {
  const retryAfterMilliseconds = readErrorHeader(error, 'retry-after-ms');
  if (retryAfterMilliseconds !== null) {
    const parsed = Number(retryAfterMilliseconds);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.ceil(parsed);
  }

  const retryAfter = readErrorHeader(error, 'retry-after');
  if (retryAfter === null) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(retryAfter);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, Math.ceil(date - nowMs));
}

function inspectErrorChain(error: unknown, inspect: (error: unknown) => boolean) {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    const name = promptWizardProviderErrorName(current).toUpperCase();
    if (ABORT_ERROR_NAMES.has(name)) return false;
    if (inspect(current)) return true;
    current = typeof current === 'object' && current !== null
      ? (current as { cause?: unknown }).cause
      : null;
  }
  return false;
}

function promptWizardProviderStatus(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const value = typeof candidate.status === 'number' ? candidate.status : candidate.statusCode;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function promptWizardProviderErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code.toUpperCase() : null;
}

function promptWizardProviderErrorName(error: unknown) {
  if (error instanceof Error && error.name) return error.name;
  if (!error || typeof error !== 'object') return 'UnknownError';
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' && name ? name : 'UnknownError';
}

function promptWizardProviderRetryable(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const value = (error as { retryable?: unknown }).retryable;
  return typeof value === 'boolean' ? value : null;
}

function promptWizardProviderReceivedBytes(error: unknown) {
  if (!error || typeof error !== 'object') return 0;
  const value = (error as { receivedBytes?: unknown }).receivedBytes;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function promptWizardProviderReceivedEvent(error: unknown) {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { receivedEvent?: unknown }).receivedEvent === true,
  );
}

function promptWizardProviderString(
  error: unknown,
  field: 'providerRequestId' | 'responseId' | 'xTtLogId',
) {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== 'object' || current === null) break;
    const candidate = current as Record<string, unknown> & { cause?: unknown };
    const value = candidate[field];
    if (typeof value === 'string' && value) return value;
    current = candidate.cause;
  }
  return null;
}

function readErrorHeader(error: unknown, headerName: string): string | null {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current === 'object' && current !== null) {
      const candidate = current as {
        headers?: Headers | Record<string, unknown>;
        rawResponse?: { headers?: Headers };
        cause?: unknown;
      };
      const direct = readHeader(candidate.headers, headerName);
      if (direct !== null) return direct;
      const raw = readHeader(candidate.rawResponse?.headers, headerName);
      if (raw !== null) return raw;
      current = candidate.cause;
      continue;
    }
    break;
  }
  return null;
}

function readHeader(headers: Headers | Record<string, unknown> | undefined, headerName: string) {
  if (!headers) return null;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(headerName);
  }
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === headerName);
  return typeof entry?.[1] === 'string' ? entry[1] : null;
}

function retryDeadlineError(cause: unknown) {
  return Object.assign(new Error('提示词服务有界重试已达到总时间上限'), {
    code: 'PROMPT_WIZARD_PROVIDER_TIMEOUT',
    providerRequestId: promptWizardProviderString(cause, 'providerRequestId'),
    receivedBytes: promptWizardProviderReceivedBytes(cause),
    receivedEvent: promptWizardProviderReceivedEvent(cause),
    retryable: false,
    cause,
  });
}

async function defaultSleep(delayMs: number) {
  if (delayMs <= 0) return;
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

function runAttemptDirectly<T>(attempt: () => Promise<T>) {
  return attempt();
}
