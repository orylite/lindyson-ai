import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const SSE_CONTENT_TYPE = 'text/event-stream';
const MAX_PROVIDER_ERROR_BODY_BYTES = 64 * 1024;
const MAX_PROVIDER_ERROR_CODE_LENGTH = 64;
const DNS_PREFLIGHT_MAX_ATTEMPTS = 3;
const DNS_PREFLIGHT_TIMEOUT_MS = 1_500;
const DNS_PREFLIGHT_BACKOFF_MS = [0, 150, 350] as const;

export interface ArkPromptWizardResponsesRequest {
  model: string;
  store: false;
  stream: true;
  service_tier: 'default';
  /**
   * 脚本扩写关闭深度思考以控制时延；创意导演省略该字段，使用模型默认思考能力。
   */
  thinking?: { type: 'disabled' };
  instructions: string;
  input: unknown;
  max_output_tokens: number;
  text: {
    format: {
      type: 'json_schema';
      name: string;
      strict: true;
      schema: Record<string, unknown>;
    };
  };
}

export interface ArkPromptWizardResponsesResult {
  id: string;
  model: string;
  service_tier: string | null;
  output_text: string;
  /**
   * completed 是 response.completed 中唯一结构化正文；仅当该快照缺失时，
   * streamed-fallback 才表示使用 output_text.done/delta 聚合结果。
   * 设为可选以兼容现有测试替身与历史内部调用方。
   */
  outputTextSource?: 'completed' | 'streamed-fallback';
  usage: {
    input_tokens: number | null;
    cached_input_tokens: number | null;
    output_tokens: number | null;
  };
  providerRequestId: string | null;
  xTtLogId: string | null;
  httpStatus: number;
  receivedBytes: number;
  receivedEvent: boolean;
}

export class ArkPromptWizardResponsesError extends Error {
  readonly providerRequestAttempted = true;
  readonly code: string;
  readonly status: number | null;
  readonly headers?: Headers;
  readonly providerErrorCode: string | null;
  readonly errorClassification: string | null;
  readonly providerRequestId: string | null;
  readonly responseId: string | null;
  readonly model: string | null;
  readonly xTtLogId: string | null;
  readonly httpStatus: number | null;
  readonly usage: {
    input_tokens: number | null;
    cached_input_tokens: number | null;
    output_tokens: number | null;
  };
  readonly receivedBytes: number;
  readonly receivedEvent: boolean;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(input: {
    name?: string;
    message: string;
    code: string;
    status?: number | null;
    headers?: Headers;
    providerErrorCode?: string | null;
    errorClassification?: string | null;
    providerRequestId?: string | null;
    responseId?: string | null;
    model?: string | null;
    xTtLogId?: string | null;
    httpStatus?: number | null;
    usage?: {
      input_tokens: number | null;
      cached_input_tokens: number | null;
      output_tokens: number | null;
    };
    receivedBytes?: number;
    receivedEvent?: boolean;
    retryable: boolean;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = input.name ?? 'ArkPromptWizardResponsesError';
    this.code = input.code;
    this.status = input.status ?? null;
    this.headers = input.headers;
    this.providerErrorCode = input.providerErrorCode ?? null;
    this.errorClassification = input.errorClassification ?? null;
    this.providerRequestId = input.providerRequestId ?? null;
    this.responseId = input.responseId ?? null;
    this.model = input.model ?? null;
    this.xTtLogId = input.xTtLogId ?? null;
    this.httpStatus = input.httpStatus ?? input.status ?? null;
    this.usage = input.usage ?? {
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
    };
    this.receivedBytes = input.receivedBytes ?? 0;
    this.receivedEvent = input.receivedEvent ?? false;
    this.retryable = input.retryable;
    this.cause = input.cause;
  }
}

interface ArkPromptWizardResponsesClientOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  lookupImpl?: (hostname: string) => Promise<unknown>;
  sleepImpl?: (delayMs: number) => Promise<void>;
}

export class ArkPromptWizardDnsPreflightError extends Error {
  readonly code = 'TK_PROMPT_PROVIDER_DNS_UNAVAILABLE';
  readonly providerRequestAttempted = false;
  readonly retryable = false;
  override readonly cause?: unknown;

  constructor(cause?: unknown) {
    super('火山方舟域名解析暂时不可用，请稍后重新生成');
    this.name = 'ArkPromptWizardDnsPreflightError';
    this.cause = cause;
  }
}

export interface ArkPromptWizardResponsesCreateOptions {
  timeoutMs: number;
  /**
   * 仅由需要主动收敛在途请求的调用方传入。省略时保持生产调用的既有超时与
   * 重试行为；外部中止一律视为 Provider 终态未知，绝不允许传输重试。
   */
  signal?: AbortSignal;
}

interface SseState {
  outputText: string;
  completedResponse: Record<string, unknown> | null;
  receivedEvent: boolean;
  sawDone: boolean;
  invalidJsonFrameCount: number;
}

export class ArkPromptWizardResponsesClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly hostname: string;
  private readonly fetchImpl: typeof fetch;
  private readonly lookupImpl: (hostname: string) => Promise<unknown>;
  private readonly sleepImpl: (delayMs: number) => Promise<void>;

  constructor(options: ArkPromptWizardResponsesClientOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = `${options.baseUrl.replace(/\/$/, '')}/responses`;
    this.hostname = new URL(this.endpoint).hostname;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.lookupImpl = options.lookupImpl ?? (hostname => dnsLookup(hostname));
    this.sleepImpl = options.sleepImpl ?? sleep;
  }

  /**
   * 在任何物理请求记账或 Provider 调用前完成有界 DNS 预解析。
   * 此步骤只访问宿主解析器，不携带请求正文，也不代表 Provider 请求已发生。
   */
  async prepareDns(): Promise<void> {
    if (isIP(this.hostname) !== 0) return;
    let lastError: unknown;
    for (let attempt = 0; attempt < DNS_PREFLIGHT_MAX_ATTEMPTS; attempt += 1) {
      const delayMs = DNS_PREFLIGHT_BACKOFF_MS[attempt] ?? 0;
      if (delayMs > 0) await this.sleepImpl(delayMs);
      try {
        await withDnsTimeout(this.lookupImpl(this.hostname));
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw new ArkPromptWizardDnsPreflightError(lastError);
  }

  async create(
    request: ArkPromptWizardResponsesRequest,
    options: ArkPromptWizardResponsesCreateOptions,
  ): Promise<ArkPromptWizardResponsesResult> {
    const controller = new AbortController();
    let didTimeout = false;
    let didExternalAbort = false;
    let receivedBytes = 0;
    let receivedEvent = false;
    let providerRequestId: string | null = null;
    let xTtLogId: string | null = null;
    const abortFromExternalSignal = () => {
      didExternalAbort = true;
      controller.abort();
    };
    if (options.signal?.aborted) abortFromExternalSignal();
    else options.signal?.addEventListener('abort', abortFromExternalSignal, { once: true });
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, options.timeoutMs);

    try {
      if (didExternalAbort) throw new Error('external abort before Provider fetch');
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          accept: SSE_CONTENT_TYPE,
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      providerRequestId = providerRequestIdFromHeaders(response.headers);
      xTtLogId = response.headers.get('x-tt-logid');

      if (!response.ok) {
        const { text } = await readResponseTextLimited(response);
        throw arkHttpError(response, text, request.model, providerRequestId, xTtLogId);
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.includes(SSE_CONTENT_TYPE)) {
        const limitedBody = await readResponseTextLimited(response);
        receivedBytes = limitedBody.receivedBytes;
        throw new ArkPromptWizardResponsesError({
          message: '火山方舟 Responses API 未返回 SSE 数据流',
          code: 'PROMPT_WIZARD_PROVIDER_INVALID_CONTENT_TYPE',
          status: response.status,
          headers: response.headers,
          providerRequestId,
          model: request.model,
          xTtLogId,
          httpStatus: response.status,
          receivedBytes,
          retryable: false,
        });
      }
      if (!response.body) {
        throw new ArkPromptWizardResponsesError({
          message: '火山方舟 Responses API 返回了空数据流',
          code: 'PROMPT_WIZARD_PROVIDER_EMPTY_STREAM',
          status: response.status,
          headers: response.headers,
          providerRequestId,
          model: request.model,
          xTtLogId,
          httpStatus: response.status,
          retryable: true,
        });
      }

      const state: SseState = {
        outputText: '',
        completedResponse: null,
        receivedEvent: false,
        sawDone: false,
        invalidJsonFrameCount: 0,
      };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        receivedBytes += chunk.value.byteLength;
        pending += decoder.decode(chunk.value, { stream: true });
        pending = consumeSseFrames(
          pending,
          state,
          providerRequestId,
          xTtLogId,
          response.status,
          receivedBytes,
        );
        receivedEvent = state.receivedEvent;
        // response.completed 是 Responses SSE 的权威终态。不要等待代理关闭
        // TCP 流，否则完整结果可能在空闲连接上被误判为超时。
        if (state.completedResponse) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
      pending += decoder.decode();
      if (pending.trim()) {
        consumeSseFrame(
          pending,
          state,
          providerRequestId,
          xTtLogId,
          response.status,
          receivedBytes,
        );
        receivedEvent = state.receivedEvent;
      }

      if (!state.completedResponse) {
        if (state.invalidJsonFrameCount > 0) {
          throw new ArkPromptWizardResponsesError({
            message: '火山方舟 SSE 事件不是有效 JSON',
            code: 'PROMPT_WIZARD_PROVIDER_INVALID_SSE_JSON',
            status: response.status,
            headers: response.headers,
            providerRequestId,
            xTtLogId,
            httpStatus: response.status,
            receivedBytes,
            receivedEvent,
            retryable: false,
          });
        }
        throw new ArkPromptWizardResponsesError({
          message: state.sawDone
            ? '火山方舟 SSE 已结束但缺少 response.completed 事件'
            : '火山方舟 SSE 在响应完成前意外结束',
          code: 'PROMPT_WIZARD_PROVIDER_INCOMPLETE_STREAM',
          status: response.status,
          headers: response.headers,
          providerRequestId,
          xTtLogId,
          httpStatus: response.status,
          receivedBytes,
          receivedEvent,
          retryable: receivedBytes === 0 && !receivedEvent,
        });
      }

      return normalizeCompletedResponse({
        response: state.completedResponse,
        streamedOutputText: state.outputText,
        providerRequestId,
        xTtLogId,
        httpStatus: response.status,
        receivedBytes,
        receivedEvent,
      });
    } catch (error) {
      // Canary 的 SIGTERM/SIGINT 会通过外部 signal 到达这里。此时上游可能已经
      // 接受请求，不能按普通 AbortError/网络错误重试，也不能伪造失败终态；固定
      // 记录为 interrupted/unknown，让账本以未知成本封存。
      if (didExternalAbort || options.signal?.aborted) {
        throw new ArkPromptWizardResponsesError({
          name: 'RequestInterruptedError',
          message: '火山方舟 Responses API 请求被受控中止，Provider 终态未知',
          code: 'PROMPT_WIZARD_PROVIDER_INTERRUPTED_UNKNOWN',
          errorClassification: 'interrupted:unknown',
          providerRequestId,
          model: request.model,
          xTtLogId,
          receivedBytes,
          receivedEvent,
          retryable: false,
          cause: error,
        });
      }
      // 绝对超时优先于 HTTP、Content-Type 等派生分类。错误体读取会为了
      // 限制内存而吞掉 reader.read 的 Abort；若此处不优先判断，5xx 可能
      // 被误标为可重试并造成重复推理与重复成本。
      if (didTimeout) {
        throw new ArkPromptWizardResponsesError({
          name: 'RequestTimeoutError',
          message: '火山方舟 Responses API 单次请求超时',
          code: 'PROMPT_WIZARD_PROVIDER_ATTEMPT_TIMEOUT',
          providerRequestId,
          model: request.model,
          xTtLogId,
          receivedBytes,
          receivedEvent,
          // 超时意味着上游是否已接受请求无法确认，绝不自动重发。
          retryable: false,
          cause: error,
        });
      }
      if (error instanceof ArkPromptWizardResponsesError) throw error;
      throw new ArkPromptWizardResponsesError({
        name: 'ConnectionError',
        message: '火山方舟 Responses API 连接失败',
        code: networkErrorCode(error) ?? 'PROMPT_WIZARD_PROVIDER_CONNECTION_ERROR',
        providerErrorCode: networkErrorCode(error),
        errorClassification: networkErrorCode(error),
        providerRequestId,
        model: request.model,
        xTtLogId,
        receivedBytes,
        receivedEvent,
        retryable: receivedBytes === 0 && !receivedEvent,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromExternalSignal);
    }
  }
}

function consumeSseFrames(
  pending: string,
  state: SseState,
  providerRequestId: string | null,
  xTtLogId: string | null,
  httpStatus: number,
  receivedBytes: number,
) {
  let remaining = pending;
  while (true) {
    const boundary = /\r?\n\r?\n/u.exec(remaining);
    if (!boundary || boundary.index === undefined) return remaining;
    const frame = remaining.slice(0, boundary.index);
    remaining = remaining.slice(boundary.index + boundary[0].length);
    consumeSseFrame(frame, state, providerRequestId, xTtLogId, httpStatus, receivedBytes);
  }
}

function consumeSseFrame(
  frame: string,
  state: SseState,
  providerRequestId: string | null,
  xTtLogId: string | null,
  httpStatus: number,
  receivedBytes: number,
) {
  const lines = frame.replace(/\r\n/g, '\n').split('\n');
  const eventName = lines.find(line => line.startsWith('event:'))?.slice('event:'.length).trim();
  const data = lines
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).trimStart())
    .join('\n');
  if (!data) return;

  state.receivedEvent = true;
  if (data === '[DONE]') {
    state.sawDone = true;
    return;
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(data) as unknown;
    if (!isRecord(parsed)) throw new Error('SSE data 不是对象');
    payload = parsed;
  } catch {
    // response.completed 携带完整权威快照。上游偶发损坏单个 delta/done
    // 帧时先记录而不立刻终止；只有随后收到可解析的 completed 才允许交付。
    // 若流结束仍没有 completed，create() 会保持 INVALID_SSE_JSON 失败，
    // 不会把残缺 delta 当结果，也不会自动重发产生重复推理成本。
    state.invalidJsonFrameCount += 1;
    return;
  }

  const eventType = typeof payload.type === 'string' ? payload.type : eventName;
  if (eventType === 'response.output_text.delta') {
    if (typeof payload.delta === 'string') state.outputText += payload.delta;
    return;
  }
  if (eventType === 'response.output_text.done') {
    const finalText = typeof payload.text === 'string'
      ? payload.text
      : typeof payload.delta === 'string'
        ? payload.delta
        : null;
    // done.text 是当前 output_text 内容块的权威快照。即使此前已经收到 delta，
    // 也必须用快照覆盖，避免代理或上游省略/合并 delta 时把残缺文本交给 JSON 解析。
    if (finalText !== null) state.outputText = finalText;
    return;
  }
  if (eventType === 'response.completed') {
    if (isRecord(payload.response)) state.completedResponse = payload.response;
    return;
  }
  if (eventType === 'response.incomplete') {
    const response = isRecord(payload.response) ? payload.response : payload;
    const incomplete = classifyIncompleteResponse(response);
    throw new ArkPromptWizardResponsesError({
      message: incomplete.message,
      code: incomplete.code,
      providerErrorCode: incomplete.providerErrorCode,
      errorClassification: incomplete.errorClassification,
      providerRequestId: providerRequestId ?? stringValue(response.request_id),
      responseId: stringValue(response.id),
      model: stringValue(response.model),
      xTtLogId,
      httpStatus,
      usage: responseUsage(response),
      receivedBytes,
      receivedEvent: true,
      retryable: false,
    });
  }
  if (eventType === 'response.failed' || eventType === 'error') {
    const response = isRecord(payload.response) ? payload.response : payload;
    const error = isRecord(response.error) ? response.error : response;
    const providerErrorCode = normalizeProviderErrorCode(error.code);
    throw new ArkPromptWizardResponsesError({
      message: stringValue(error.message) ?? '火山方舟 Responses API 返回失败事件',
      code: providerErrorCode ?? 'PROMPT_WIZARD_PROVIDER_RESPONSE_FAILED',
      providerErrorCode,
      providerRequestId: providerRequestId ?? stringValue(response.request_id),
      responseId: stringValue(response.id),
      model: stringValue(response.model),
      xTtLogId,
      httpStatus,
      usage: responseUsage(response),
      receivedBytes,
      receivedEvent: true,
      retryable: false,
    });
  }
}

function normalizeCompletedResponse(input: {
  response: Record<string, unknown>;
  streamedOutputText: string;
  providerRequestId: string | null;
  xTtLogId: string | null;
  httpStatus: number;
  receivedBytes: number;
  receivedEvent: boolean;
}): ArkPromptWizardResponsesResult {
  const completedError = isRecord(input.response.error) ? input.response.error : null;
  if (completedError) {
    const providerErrorCode = normalizeProviderErrorCode(completedError.code);
    throw new ArkPromptWizardResponsesError({
      message: stringValue(completedError.message) ?? '火山方舟已完成响应包含错误',
      code: providerErrorCode ?? 'PROMPT_WIZARD_PROVIDER_RESPONSE_FAILED',
      providerErrorCode,
      providerRequestId: input.providerRequestId,
      responseId: stringValue(input.response.id),
      model: stringValue(input.response.model),
      xTtLogId: input.xTtLogId,
      httpStatus: input.httpStatus,
      usage: responseUsage(input.response),
      receivedBytes: input.receivedBytes,
      receivedEvent: input.receivedEvent,
      retryable: false,
    });
  }

  const status = stringValue(input.response.status);
  if (status !== 'completed') {
    const incomplete = classifyIncompleteResponse(input.response);
    throw new ArkPromptWizardResponsesError({
      message: incomplete.message,
      code: incomplete.code,
      providerErrorCode: incomplete.providerErrorCode,
      errorClassification: incomplete.errorClassification,
      providerRequestId: input.providerRequestId,
      responseId: stringValue(input.response.id),
      model: stringValue(input.response.model),
      xTtLogId: input.xTtLogId,
      httpStatus: input.httpStatus,
      usage: responseUsage(input.response),
      receivedBytes: input.receivedBytes,
      receivedEvent: input.receivedEvent,
      retryable: false,
    });
  }

  const completedOutputTexts = extractResponseOutputTexts(input.response);
  if (completedOutputTexts.length > 1) {
    throw new ArkPromptWizardResponsesError({
      message: '火山方舟完成响应包含多个结构化正文',
      code: 'PROMPT_WIZARD_PROVIDER_MULTIPLE_OUTPUT_TEXT',
      errorClassification: 'multiple_output_text',
      providerRequestId: input.providerRequestId,
      responseId: stringValue(input.response.id),
      model: stringValue(input.response.model),
      xTtLogId: input.xTtLogId,
      httpStatus: input.httpStatus,
      usage: responseUsage(input.response),
      receivedBytes: input.receivedBytes,
      receivedEvent: input.receivedEvent,
      retryable: false,
    });
  }

  // strict json_schema 应只产生一个结构化正文。completed 快照是权威来源；
  // 仅当快照没有非空正文时，才使用此前聚合的 done/delta 文本回退。
  const outputText = completedOutputTexts[0] ?? input.streamedOutputText;
  const outputTextSource = completedOutputTexts[0] === undefined
    ? 'streamed-fallback' as const
    : 'completed' as const;
  if (!outputText.trim()) {
    throw new ArkPromptWizardResponsesError({
      message: '火山方舟没有返回结构化内容',
      code: 'PROMPT_WIZARD_PROVIDER_EMPTY',
      providerRequestId: input.providerRequestId,
      responseId: stringValue(input.response.id),
      model: stringValue(input.response.model),
      xTtLogId: input.xTtLogId,
      httpStatus: input.httpStatus,
      usage: responseUsage(input.response),
      receivedBytes: input.receivedBytes,
      receivedEvent: input.receivedEvent,
      retryable: false,
    });
  }

  const usage = responseUsage(input.response);
  const id = stringValue(input.response.id);
  const model = stringValue(input.response.model);
  if (!id || !model) {
    throw new ArkPromptWizardResponsesError({
      message: '火山方舟完成响应缺少 id 或 model',
      code: 'PROMPT_WIZARD_PROVIDER_MALFORMED_RESPONSE',
      providerRequestId: input.providerRequestId,
      responseId: id,
      model,
      xTtLogId: input.xTtLogId,
      httpStatus: input.httpStatus,
      usage,
      receivedBytes: input.receivedBytes,
      receivedEvent: input.receivedEvent,
      retryable: false,
    });
  }
  return {
    id,
    model,
    service_tier: stringValue(input.response.service_tier),
    output_text: outputText,
    outputTextSource,
    usage: {
      input_tokens: usage.input_tokens,
      cached_input_tokens: usage.cached_input_tokens,
      output_tokens: usage.output_tokens,
    },
    providerRequestId: input.providerRequestId ?? stringValue(input.response.request_id),
    xTtLogId: input.xTtLogId,
    httpStatus: input.httpStatus,
    receivedBytes: input.receivedBytes,
    receivedEvent: input.receivedEvent,
  };
}

function extractResponseOutputTexts(response: Record<string, unknown>) {
  const output = Array.isArray(response.output) ? response.output : [];
  return output.flatMap(item => {
    if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) return [];
    return item.content.flatMap(content => (
      isRecord(content)
        && content.type === 'output_text'
        && typeof content.text === 'string'
        && content.text.trim()
        ? [content.text]
        : []
    ));
  });
}

function responseUsage(response: Record<string, unknown>) {
  const usage = isRecord(response.usage) ? response.usage : {};
  const inputTokens = nonNegativeInteger(usage.input_tokens);
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const explicitCachedTokens = nonNegativeInteger(inputDetails.cached_tokens);
  const cachedInputTokens = inputTokens === null
    ? null
    : explicitCachedTokens ?? 0;
  return {
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens !== null && cachedInputTokens <= inputTokens!
      ? cachedInputTokens
      : null,
    output_tokens: nonNegativeInteger(usage.output_tokens),
  };
}

function classifyIncompleteResponse(response: Record<string, unknown>) {
  const details = isRecord(response.incomplete_details) ? response.incomplete_details : {};
  const reason = normalizeProviderErrorCode(details.reason)?.toLowerCase() ?? null;
  const contentFilter = details.content_filter;
  if (reason === 'content_filter' || contentFilter === true || isRecord(contentFilter)) {
    const filterDetails = isRecord(contentFilter) ? contentFilter : {};
    const type = normalizeProviderErrorCode(filterDetails.type);
    const category = normalizeProviderErrorCode(filterDetails.category);
    const safeDetails = [
      type ? `type:${type}` : null,
      category ? `category:${category}` : null,
    ].filter((value): value is string => Boolean(value));
    return {
      message: `火山方舟响应因内容安全策略未完成${safeDetails.length ? `（${safeDetails.join('，')}）` : ''}`,
      code: 'PROMPT_WIZARD_PROVIDER_CONTENT_FILTER',
      providerErrorCode: 'content_filter',
      errorClassification: ['content_filter', ...safeDetails].join(':'),
    };
  }
  if (reason === 'max_output_tokens') {
    return {
      message: '火山方舟响应因达到最大输出 Token 数未完成',
      code: 'PROMPT_WIZARD_PROVIDER_MAX_OUTPUT_TOKENS',
      providerErrorCode: 'max_output_tokens',
      errorClassification: 'max_output_tokens',
    };
  }
  return {
    message: reason ? `火山方舟响应未完成：${reason}` : '火山方舟响应未完成',
    code: 'PROMPT_WIZARD_PROVIDER_RESPONSE_INCOMPLETE',
    providerErrorCode: reason,
    errorClassification: reason ? `incomplete:${reason}` : 'incomplete',
  };
}

function arkHttpError(
  response: Response,
  text: string,
  model: string,
  providerRequestId: string | null,
  xTtLogId: string | null,
) {
  const parsed = parseJsonRecord(text);
  const error = isRecord(parsed.error) ? parsed.error : parsed;
  const providerErrorCode = normalizeProviderErrorCode(error.code);
  const retryable = response.status === 408
    || response.status === 429
    || (response.status >= 500 && response.status <= 599);
  return new ArkPromptWizardResponsesError({
    name: 'ArkResponsesHttpError',
    message: stringValue(error.message) ?? `火山方舟请求失败：HTTP ${response.status}`,
    code: providerErrorCode ?? 'PROMPT_WIZARD_PROVIDER_HTTP_ERROR',
    status: response.status,
    headers: response.headers,
    providerErrorCode,
    errorClassification: providerErrorCode,
    providerRequestId,
    model,
    xTtLogId,
    httpStatus: response.status,
    // 某些非 2xx 终态仍会返回已产生的安全 usage；失败不代表免费。
    usage: responseUsage(parsed),
    retryable,
  });
}

function providerRequestIdFromHeaders(headers: Headers) {
  return headers.get('x-request-id')
    ?? headers.get('x-bce-request-id');
}

function parseJsonRecord(text: string) {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function readResponseTextLimited(response: Response) {
  if (!response.body) return { text: '', receivedBytes: 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (receivedBytes < MAX_PROVIDER_ERROR_BODY_BYTES) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const remainingBytes = MAX_PROVIDER_ERROR_BODY_BYTES - receivedBytes;
      const accepted = chunk.value.subarray(0, remainingBytes);
      if (accepted.byteLength) {
        // slice() 解除对上游大块 ArrayBuffer 的引用，确保内存占用也受上限约束。
        chunks.push(accepted.slice());
        receivedBytes += accepted.byteLength;
      }
      if (accepted.byteLength < chunk.value.byteLength || receivedBytes >= MAX_PROVIDER_ERROR_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } catch {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    text: new TextDecoder().decode(bytes),
    receivedBytes,
  };
}

function networkErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') return normalizeProviderErrorCode(code);
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return null;
  const causeCode = (cause as { code?: unknown }).code;
  return typeof causeCode === 'string' ? normalizeProviderErrorCode(causeCode) : null;
}

function normalizeProviderErrorCode(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized.length > MAX_PROVIDER_ERROR_CODE_LENGTH) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized) ? normalized : null;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function withDnsTimeout(lookup: Promise<unknown>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      lookup,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(Object.assign(new Error('DNS preflight timed out'), { code: 'ETIMEDOUT' }));
        }, DNS_PREFLIGHT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function sleep(delayMs: number) {
  if (delayMs <= 0) return;
  await new Promise(resolve => setTimeout(resolve, delayMs));
}
