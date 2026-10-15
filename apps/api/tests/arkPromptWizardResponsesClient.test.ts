import { describe, expect, it, vi } from 'vitest';
import {
  ArkPromptWizardResponsesClient,
  type ArkPromptWizardResponsesRequest,
} from '../src/providers/arkPromptWizardResponsesClient.js';

const REQUEST: ArkPromptWizardResponsesRequest = {
  model: 'doubao-seed-2-0-lite-260428',
  store: false,
  stream: true,
  service_tier: 'default',
  thinking: { type: 'disabled' },
  instructions: '只输出 JSON',
  input: '生成方案',
  max_output_tokens: 8_000,
  text: {
    format: {
      type: 'json_schema',
      name: 'test_schema',
      strict: true,
      schema: { type: 'object', additionalProperties: false, properties: {} },
    },
  },
};

describe('火山方舟 Responses SSE 客户端', () => {
  it('解析分片 SSE，并独立保留 response id、x-request-id 与 x-tt-logid', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"{\\"partial\\":true}"}\n\n',
      completedEvent('{"authoritative":true}'),
    ], {
      'x-request-id': 'request-123',
      'x-tt-logid': 'log-456',
    }));
    const client = new ArkPromptWizardResponsesClient({
      apiKey: 'secret-key',
      baseUrl: 'https://ark.example.test/api/v3/',
      fetchImpl,
    });

    const result = await client.create(REQUEST, { timeoutMs: 1_000 });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://ark.example.test/api/v3/responses');
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({
      accept: 'text/event-stream',
      authorization: 'Bearer secret-key',
      'content-type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
    expect(result).toMatchObject({
      id: 'response-789',
      model: 'doubao-seed-2-0-lite-260428',
      output_text: '{"authoritative":true}',
      outputTextSource: 'completed',
      providerRequestId: 'request-123',
      xTtLogId: 'log-456',
      httpStatus: 200,
      usage: { input_tokens: 12, cached_input_tokens: 3, output_tokens: 8 },
      receivedEvent: true,
    });
  });

  it('兼容 CRLF、多条 data 行及没有尾部空行的 completed 事件', async () => {
    const response = {
      id: 'response-crlf',
      model: 'doubao-seed-2-0-lite-260428',
      status: 'completed',
      usage: { input_tokens: 3, output_tokens: 2 },
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: '{"ok":true}' }],
      }],
    };
    const serialized = JSON.stringify({ type: 'response.completed', response });
    const splitAt = serialized.indexOf(',"response"');
    const frame = `event: response.completed\r\ndata: ${serialized.slice(0, splitAt + 1)}\r\ndata: ${serialized.slice(splitAt + 1)}`;
    const client = clientFor(sseResponse([frame]));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).resolves.toMatchObject({
      id: 'response-crlf',
      output_text: '{"ok":true}',
      usage: { input_tokens: 3, cached_input_tokens: 0, output_tokens: 2 },
    });
  });

  it('按任意字节切块解析 SSE，中文 UTF-8 跨块不损坏', async () => {
    const outputText = '{"产品":"墨西哥球衣","说明":"中文跨字节切块"}';
    const bytes = new TextEncoder().encode(completedEvent(outputText));
    const chunks = Array.from(bytes, byte => Uint8Array.of(byte));
    const client = clientFor(sseByteResponse(chunks));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).resolves.toMatchObject({
      output_text: outputText,
    });
  });

  it('completed 是权威终态，连接保持打开且 cancel 拒绝也能立即交付', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(completedEvent('{"done":true}')));
      },
      cancel() {
        return Promise.reject(new Error('上游拒绝 cancel'));
      },
    });
    const client = clientFor(new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));

    await expect(client.create(REQUEST, { timeoutMs: 100 })).resolves.toMatchObject({
      id: 'response-789',
      output_text: '{"done":true}',
    });
  });

  it('response.failed 终态携带元数据且不可重试', async () => {
    const type = 'response.failed';
    const response = {
      id: 'response-failed',
      model: 'doubao-seed-2-0-lite-260428',
      status: 'failed',
      usage: { input_tokens: 7, output_tokens: 2 },
      error: { code: 'content_filter', message: 'blocked' },
    };
    const client = clientFor(sseResponse([
      `event: ${type}\ndata: ${JSON.stringify({ type, response })}\n\n`,
    ], { 'x-tt-logid': 'log-failed' }));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'content_filter',
      responseId: 'response-failed',
      model: 'doubao-seed-2-0-lite-260428',
      xTtLogId: 'log-failed',
      httpStatus: 200,
      usage: { input_tokens: 7, output_tokens: 2 },
      receivedEvent: true,
      retryable: false,
    });
  });

  it('安全分类 incomplete_details.content_filter，仅保留 type/category', async () => {
    const response = {
      id: 'response-filtered',
      model: 'doubao-seed-2-0-lite-260428',
      status: 'incomplete',
      usage: { input_tokens: 9, output_tokens: 1 },
      incomplete_details: {
        reason: 'content_filter',
        content_filter: {
          type: 'safety_policy',
          category: 'regulated_content',
          details: '不得进入错误、日志或分类的原始敏感详情',
        },
      },
    };
    const client = clientFor(sseResponse([
      `event: response.incomplete\ndata: ${JSON.stringify({ type: 'response.incomplete', response })}\n\n`,
    ]));

    const error = await client.create(REQUEST, { timeoutMs: 1_000 }).catch(value => value);
    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_CONTENT_FILTER',
      providerErrorCode: 'content_filter',
      errorClassification: 'content_filter:type:safety_policy:category:regulated_content',
      responseId: 'response-filtered',
      retryable: false,
    });
    expect(error.message).not.toContain('原始敏感详情');
    expect(error.errorClassification).not.toContain('原始敏感详情');
  });

  it('max_output_tokens 与内容过滤使用不同错误分类，且不可重试', async () => {
    const response = {
      id: 'response-truncated',
      model: 'doubao-seed-2-0-lite-260428',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    };
    const client = clientFor(sseResponse([
      `event: response.incomplete\ndata: ${JSON.stringify({ type: 'response.incomplete', response })}\n\n`,
    ]));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_MAX_OUTPUT_TOKENS',
      providerErrorCode: 'max_output_tokens',
      errorClassification: 'max_output_tokens',
      retryable: false,
    });
  });

  it.each([
    ['text', '{"from":"text"}'],
    ['delta', '{"from":"delta"}'],
  ])('response.output_text.done 支持 %s 字段作为完成响应的文本回退', async (field, outputText) => {
    const completedResponse = {
      id: 'response-done-fallback',
      model: 'doubao-seed-2-0-lite-260428',
      status: 'completed',
      output: [],
    };
    const client = clientFor(sseResponse([
      `event: response.output_text.done\ndata: ${JSON.stringify({
        type: 'response.output_text.done',
        [field]: outputText,
      })}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify({
        type: 'response.completed',
        response: completedResponse,
      })}\n\n`,
    ]));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).resolves.toMatchObject({
      id: 'response-done-fallback',
      output_text: outputText,
      outputTextSource: 'streamed-fallback',
    });
  });

  it('completed 快照缺少正文时，以 output_text.done 完整快照覆盖已聚合的残缺 delta', async () => {
    const completedResponse = {
      id: 'response-done-authoritative-fallback',
      model: 'doubao-seed-2-0-lite-260428',
      status: 'completed',
      output: [],
    };
    const client = clientFor(sseResponse([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"{\\"partial\\":"}\n\n',
      `event: response.output_text.done\ndata: ${JSON.stringify({
        type: 'response.output_text.done',
        text: '{"complete":true}',
      })}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify({
        type: 'response.completed',
        response: completedResponse,
      })}\n\n`,
    ]));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).resolves.toMatchObject({
      output_text: '{"complete":true}',
    });
  });

  it('单个损坏的流式事件不会遮断随后可解析的权威 completed 快照', async () => {
    const client = clientFor(sseResponse([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"损坏的未闭合事件"\n\n',
      completedEvent('{"recovered":true}'),
    ]));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).resolves.toMatchObject({
      id: 'response-789',
      output_text: '{"recovered":true}',
      receivedEvent: true,
    });
  });

  it('strict json_schema 的 completed 包含多个非空 output_text 时明确拒绝且不可重试', async () => {
    const response = {
      id: 'response-multiple-output-text',
      model: 'doubao-seed-2-0-lite-260428',
      status: 'completed',
      usage: { input_tokens: 20, output_tokens: 10 },
      output: [
        {
          type: 'message',
          content: [
            { type: 'output_text', text: '{"first":true}' },
            { type: 'output_text', text: '{"second":true}' },
          ],
        },
      ],
    };
    const client = clientFor(sseResponse([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"{\\"streamed\\":true}"}\n\n',
      `event: response.completed\ndata: ${JSON.stringify({
        type: 'response.completed',
        response,
      })}\n\n`,
    ], { 'x-tt-logid': 'log-multiple-output-text' }));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_MULTIPLE_OUTPUT_TEXT',
      errorClassification: 'multiple_output_text',
      responseId: 'response-multiple-output-text',
      model: 'doubao-seed-2-0-lite-260428',
      xTtLogId: 'log-multiple-output-text',
      usage: { input_tokens: 20, output_tokens: 10 },
      receivedEvent: true,
      retryable: false,
    });
  });

  it('completed 忽略空 output_text，并以唯一非空正文覆盖 streamed fallback', async () => {
    const response = {
      id: 'response-single-non-empty-output-text',
      model: 'doubao-seed-2-0-lite-260428',
      status: 'completed',
      output: [{
        type: 'message',
        content: [
          { type: 'output_text', text: '   ' },
          { type: 'output_text', text: '{"authoritative":true}' },
          { type: 'output_text', text: '\n' },
        ],
      }],
    };
    const client = clientFor(sseResponse([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"{\\"streamed\\":true}"}\n\n',
      `event: response.completed\ndata: ${JSON.stringify({
        type: 'response.completed',
        response,
      })}\n\n`,
    ]));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).resolves.toMatchObject({
      id: 'response-single-non-empty-output-text',
      output_text: '{"authoritative":true}',
    });
  });

  it('顶层 error 事件拒绝不安全的上游错误码，不把潜在敏感内容带入分类', async () => {
    const unsafeCode = ` rate limit/<script>/中文/${'x'.repeat(100)} `;
    const client = clientFor(sseResponse([
      `event: error\ndata: ${JSON.stringify({
        type: 'error',
        error: { code: unsafeCode, message: '请求被拒绝' },
      })}\n\n`,
    ]));

    const error = await client.create(REQUEST, { timeoutMs: 1_000 }).catch(value => value);
    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_RESPONSE_FAILED',
      providerErrorCode: null,
      receivedEvent: true,
      retryable: false,
    });
    expect(JSON.stringify(error)).not.toMatch(/script|中文|x{20}/u);
  });

  it('[DONE] 没有 response.completed 时拒绝交付且不可重试', async () => {
    const client = clientFor(sseResponse(['data: [DONE]\n\n']));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_INCOMPLETE_STREAM',
      receivedEvent: true,
      retryable: false,
    });
  });

  it('已有 delta 后流截断不可重试', async () => {
    const client = clientFor(sseResponse([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"{\\"x\\":"}\n\n',
    ]));
    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_INCOMPLETE_STREAM',
      receivedEvent: true,
      retryable: false,
    });
  });

  it('收到首个 SSE 字节后读取流失败，不按连接前失败重试', async () => {
    const encoder = new TextEncoder();
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(encoder.encode(
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"部分"}\n\n',
          ));
          return;
        }
        controller.error(Object.assign(new Error('stream reset'), { code: 'ECONNRESET' }));
      },
    });
    const client = clientFor(new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).rejects.toMatchObject({
      name: 'ConnectionError',
      code: 'ECONNRESET',
      receivedEvent: true,
      retryable: false,
    });
  });

  it('无效 SSE JSON 与缺少 id/model 的完成响应都拒绝交付', async () => {
    const invalidJson = clientFor(sseResponse([
      'event: response.output_text.delta\ndata: {invalid}\n\n',
    ]));
    await expect(invalidJson.create(REQUEST, { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_INVALID_SSE_JSON',
      retryable: false,
    });

    const malformed = clientFor(sseResponse([
      `event: response.completed\ndata: ${JSON.stringify({
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }],
        },
      })}\n\n`,
    ]));
    await expect(malformed.create(REQUEST, { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_MALFORMED_RESPONSE',
      retryable: false,
    });
  });

  it('空 SSE 流可作为快速连接失败重试，绝对超时则不可重试', async () => {
    const empty = clientFor(new Response(null, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    await expect(empty.create(REQUEST, { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_EMPTY_STREAM',
      retryable: true,
    });

    const timeoutClient = new ArkPromptWizardResponsesClient({
      apiKey: 'key',
      baseUrl: 'https://ark.example.test/api/v3',
      fetchImpl: ((_url: string | URL | Request, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {
          name: 'AbortError',
        })));
      })) as typeof fetch,
    });
    await expect(timeoutClient.create(REQUEST, { timeoutMs: 5 })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_ATTEMPT_TIMEOUT',
      retryable: false,
      receivedBytes: 0,
      receivedEvent: false,
    });
  });

  it('外部 AbortSignal 固定收敛为 interrupted/unknown，且不可重试', async () => {
    const external = new AbortController();
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(
          new Error('provider transport aborted'),
          { name: 'AbortError' },
        )), { once: true });
      })
    )) as typeof fetch;
    const client = new ArkPromptWizardResponsesClient({
      apiKey: 'key',
      baseUrl: 'https://ark.example.test/api/v3',
      fetchImpl,
    });

    const request = client.create(REQUEST, {
      timeoutMs: 60_000,
      signal: external.signal,
    });
    external.abort(new Error('不得进入证据的运维原因'));

    await expect(request).rejects.toMatchObject({
      name: 'RequestInterruptedError',
      code: 'PROMPT_WIZARD_PROVIDER_INTERRUPTED_UNKNOWN',
      errorClassification: 'interrupted:unknown',
      retryable: false,
      receivedBytes: 0,
      receivedEvent: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    await expect(request.catch(error => JSON.stringify(error)))
      .resolves.not.toContain('不得进入证据');
  });

  it.each([200, 500])('HTTP %s 慢响应体触发绝对超时后不会被内容类型或 5xx 重试分类覆盖', async status => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(Object.assign(
            new Error('body read aborted'),
            { name: 'AbortError' },
          )));
        },
      });
      return Promise.resolve(new Response(body, {
        status,
        headers: { 'content-type': 'application/json' },
      }));
    }) as typeof fetch;
    const client = new ArkPromptWizardResponsesClient({
      apiKey: 'key',
      baseUrl: 'https://ark.example.test/api/v3',
      fetchImpl,
    });

    await expect(client.create(REQUEST, { timeoutMs: 5 })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_ATTEMPT_TIMEOUT',
      model: 'doubao-seed-2-0-lite-260428',
      receivedEvent: false,
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('HTTP 200 非 SSE 响应拒绝交付且不可重试', async () => {
    const body = JSON.stringify({ id: 'not-an-sse-response' });
    const client = clientFor(new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_INVALID_CONTENT_TYPE',
      receivedBytes: new TextEncoder().encode(body).byteLength,
      retryable: false,
    });
  });

  it.each([408, 500, 503])('HTTP %s 在尚未进入 SSE 时可重试', async status => {
    const client = clientFor(new Response(JSON.stringify({
      error: { code: 'transient_error', message: 'temporary failure' },
    }), { status }));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'transient_error',
      status,
      usage: {
        input_tokens: null,
        cached_input_tokens: null,
        output_tokens: null,
      },
      retryable: true,
      receivedBytes: 0,
      receivedEvent: false,
    });
  });

  it('非 2xx 错误体返回 usage 时完整保留 Token，失败调用仍可进入成本账本', async () => {
    const client = clientFor(new Response(JSON.stringify({
      error: { code: 'request_rejected', message: 'rejected after inference' },
      usage: {
        input_tokens: 17,
        input_tokens_details: { cached_tokens: 5 },
        output_tokens: 3,
      },
    }), { status: 422 }));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'request_rejected',
      status: 422,
      usage: {
        input_tokens: 17,
        cached_input_tokens: 5,
        output_tokens: 3,
      },
      retryable: false,
    });
  });

  it('HTTP 错误体最多读取 64 KiB 并主动取消剩余数据', async () => {
    let pullCount = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        controller.enqueue(new Uint8Array(4 * 1024).fill(65));
      },
      cancel() {
        cancelled = true;
      },
    });
    const client = clientFor(new Response(body, { status: 500 }));

    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_HTTP_ERROR',
      status: 500,
      retryable: true,
    });
    expect(cancelled).toBe(true);
    expect(pullCount).toBeLessThan(100);
  });

  it('HTTP 429 在尚未收到 SSE 时保留 Retry-After 并可重试', async () => {
    const client = clientFor(new Response(JSON.stringify({
      error: { code: 'rate_limit', message: 'too many requests' },
    }), {
      status: 429,
      headers: { 'retry-after': '2', 'x-tt-logid': 'log-429' },
    }));
    await expect(client.create(REQUEST, { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'rate_limit',
      status: 429,
      xTtLogId: 'log-429',
      retryable: true,
    });
  });

  it('DNS预解析最多三次短时尝试，成功后不产生HTTP请求', async () => {
    const lookupImpl = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('temporary dns'), { code: 'EAI_AGAIN' }))
      .mockRejectedValueOnce(Object.assign(new Error('temporary dns'), { code: 'EAI_AGAIN' }))
      .mockResolvedValueOnce({ address: '203.0.113.1', family: 4 });
    const sleepImpl = vi.fn(async (_delayMs: number) => undefined);
    const fetchImpl = vi.fn();
    const client = new ArkPromptWizardResponsesClient({
      apiKey: 'key',
      baseUrl: 'https://ark.example.test/api/v3',
      lookupImpl,
      sleepImpl,
      fetchImpl,
    });

    await expect(client.prepareDns()).resolves.toBeUndefined();
    expect(lookupImpl).toHaveBeenCalledTimes(3);
    expect(lookupImpl).toHaveBeenCalledWith('ark.example.test');
    expect(sleepImpl.mock.calls.map(call => call[0])).toEqual([150, 350]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('DNS预解析持续失败时保留内部分类并明确标记未请求Provider', async () => {
    const lookupImpl = vi.fn(async () => {
      throw Object.assign(new Error('temporary dns'), { code: 'EAI_AGAIN' });
    });
    const client = new ArkPromptWizardResponsesClient({
      apiKey: 'key',
      baseUrl: 'https://ark.example.test/api/v3',
      lookupImpl,
      sleepImpl: vi.fn(async () => undefined),
      fetchImpl: vi.fn(),
    });

    await expect(client.prepareDns()).rejects.toMatchObject({
      code: 'TK_PROMPT_PROVIDER_DNS_UNAVAILABLE',
      providerRequestAttempted: false,
      retryable: false,
      message: '火山方舟域名解析暂时不可用，请稍后重新生成',
    });
    expect(lookupImpl).toHaveBeenCalledTimes(3);
  });

  it('Provider地址为IP时跳过DNS预解析', async () => {
    const lookupImpl = vi.fn();
    const client = new ArkPromptWizardResponsesClient({
      apiKey: 'key',
      baseUrl: 'https://203.0.113.7/api/v3',
      lookupImpl,
      fetchImpl: vi.fn(),
    });

    await expect(client.prepareDns()).resolves.toBeUndefined();
    expect(lookupImpl).not.toHaveBeenCalled();
  });
});

function clientFor(response: Response) {
  return new ArkPromptWizardResponsesClient({
    apiKey: 'key',
    baseUrl: 'https://ark.example.test/api/v3',
    fetchImpl: vi.fn().mockResolvedValue(response),
  });
}

function sseResponse(chunks: string[], headers: Record<string, string> = {}) {
  const encoder = new TextEncoder();
  return sseByteResponse(chunks.map(chunk => encoder.encode(chunk)), headers);
}

function sseByteResponse(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(chunk));
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', ...headers },
  });
}

function completedEvent(outputText: string) {
  const response = {
    id: 'response-789',
    model: 'doubao-seed-2-0-lite-260428',
    status: 'completed',
    service_tier: 'default',
    usage: {
      input_tokens: 12,
      input_tokens_details: { cached_tokens: 3 },
      output_tokens: 8,
    },
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: outputText }],
    }],
  };
  return `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response })}\n\n`;
}
