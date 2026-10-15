import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ApiError,
  apiRequest,
  beginAuthenticatedSession,
  retryUnlessPaginationSnapshotChanged,
} from './client';

const okResponseSchema = z.object({ ok: z.boolean() });

describe('API cookie 会话客户端', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('所有请求携带 cookie 且不会发送 bearer authorization', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/probe', okResponseSchema, { method: 'POST', body: JSON.stringify({ value: 1 }), sessionScoped: false });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toBeDefined();
    if (!init) throw new Error('请求配置缺失');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
  });

  it('结构化错误保留状态、错误码与请求编号', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      message: '相同请求已处理',
      code: '23505',
      requestId: 'req-42',
    }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })));

    const request = apiRequest('/api/probe', okResponseSchema, { sessionScoped: false });

    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      message: '相同请求已处理',
      status: 409,
      code: '23505',
      requestId: 'req-42',
    });
  });

  it('快照失效不重试，普通查询错误仍保留三次重试上限', () => {
    expect(retryUnlessPaginationSnapshotChanged(
      0,
      new ApiError('列表已更新', 409, 'PAGINATION_SNAPSHOT_CHANGED'),
    )).toBe(false);
    expect(retryUnlessPaginationSnapshotChanged(0, new ApiError('暂时不可用', 503, 'UNAVAILABLE'))).toBe(true);
    expect(retryUnlessPaginationSnapshotChanged(3, new ApiError('暂时不可用', 503, 'UNAVAILABLE'))).toBe(false);
  });

  it('错误响应也必须符合共享契约，否则转为带请求编号的 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      message: '缺少错误码和请求编号',
    }), {
      status: 409,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req-invalid-error',
      },
    })));

    await expect(apiRequest('/api/probe', okResponseSchema, {
      sessionScoped: false,
    })).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_API_RESPONSE',
      requestId: 'req-invalid-error',
    });
  });

  it('在映射前执行响应结构校验', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(apiRequest('/api/probe', okResponseSchema, {
      sessionScoped: false,
    })).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_API_RESPONSE',
    });
  });

  it('响应结构校验失败时保留请求编号', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: 'yes' }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req-invalid-payload',
      },
    })));

    await expect(apiRequest('/api/probe', okResponseSchema, {
      sessionScoped: false,
    })).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_API_RESPONSE',
      requestId: 'req-invalid-payload',
    });
  });

  it('响应 Schema 会过滤未声明字段，避免内部数据泄漏到业务层', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      internalSecret: '不应到达前端状态',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(apiRequest('/api/probe', okResponseSchema, {
      sessionScoped: false,
    })).resolves.toEqual({ ok: true });
  });

  it('统一超时会取消未完成请求', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })));

    await expect(apiRequest('/api/slow', okResponseSchema, {
      sessionScoped: false,
      timeoutMs: 1,
    })).rejects.toMatchObject({
      status: 0,
      code: 'REQUEST_TIMEOUT',
    });
  });

  it('新会话只广播给其他标签，并在收到远端广播时派发本地事件', () => {
    const messages: unknown[] = [];
    let messageListener: ((event: MessageEvent) => void) | undefined;
    const dispatchEvent = vi.fn();

    class FakeBroadcastChannel {
      constructor(public readonly name: string) {}
      addEventListener(_type: string, listener: (event: MessageEvent) => void) {
        messageListener = listener;
      }
      postMessage(message: unknown) {
        messages.push(message);
      }
    }
    class FakeCustomEvent {
      readonly detail: unknown;
      constructor(public readonly type: string, init?: { detail?: unknown }) {
        this.detail = init?.detail;
      }
    }

    vi.stubGlobal('window', {
      localStorage: { removeItem: vi.fn() },
      dispatchEvent,
    });
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    vi.stubGlobal('CustomEvent', FakeCustomEvent);

    beginAuthenticatedSession();
    expect(messages).toEqual([{ reason: 'authenticated' }]);
    expect(dispatchEvent).not.toHaveBeenCalled();

    messageListener?.({ data: { reason: 'authenticated' } } as MessageEvent);
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'lindyson:session-change',
      detail: expect.objectContaining({ reason: 'authenticated' }),
    }));
  });
});
