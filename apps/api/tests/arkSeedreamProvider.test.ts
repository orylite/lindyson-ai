import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const mocks = vi.hoisted(() => ({
  getStoredObjectSize: vi.fn(),
  resolveObjectProcessingInput: vi.fn(),
  uploadObjectStream: vi.fn(),
  copyStoredObject: vi.fn(),
  deleteObject: vi.fn(),
  probeMedia: vi.fn(),
  validateMediaDecoding: vi.fn(),
}));

vi.mock('../src/config/env.js', () => ({
  env: {
    ARK_API_KEY: 'test-ark-key',
    ARK_BASE_URL: 'https://ark.example.test/api/v3',
    ARK_SEEDREAM_MODEL: 'doubao-seedream-5-0-pro-260628',
    ARK_SEEDREAM_TIMEOUT_MS: 100,
    ARK_DOWNLOAD_TIMEOUT_MS: 100,
    THUMBNAIL_IMAGE_CONCURRENCY: 2,
    THUMBNAIL_VIDEO_CONCURRENCY: 1,
  },
}));
vi.mock('../src/storage/storageService.js', () => ({
  buildPublicUrl: (key: string) => `https://app.example.test/storage/${key}`,
  getStoredObjectSize: mocks.getStoredObjectSize,
  resolveObjectProcessingInput: mocks.resolveObjectProcessingInput,
  uploadObjectStream: mocks.uploadObjectStream,
  copyStoredObject: mocks.copyStoredObject,
  deleteObject: mocks.deleteObject,
  createObjectReadUrl: vi.fn(async (key: string) => `https://signed.example.test/${key}`),
}));
vi.mock('../src/storage/mediaProcessor.js', () => ({
  probeMedia: mocks.probeMedia,
  validateMediaDecoding: mocks.validateMediaDecoding,
  createVideoThumbnailBuffer: vi.fn(),
}));

import {
  buildSeedreamImagePayload,
  createSeedreamPinnedLookup,
  resolveSeedreamDownloadTarget,
  resumeArkSeedreamProvider,
  runArkSeedreamProvider,
  uploadSeedreamPngStream,
} from '../src/providers/arkSeedreamProvider.js';
import { resolveStrictReferenceImageUrls } from '../src/providers/arkSeedanceProvider.js';
import type { ProviderTaskInput } from '../src/providers/fakeProvider.js';

describe('arkSeedreamProvider', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getStoredObjectSize.mockResolvedValue(1234);
    mocks.resolveObjectProcessingInput.mockResolvedValue('/tmp/seedream.png');
    mocks.probeMedia.mockResolvedValue({ formatName: 'png_pipe', hasVideo: true, width: 1024, height: 1024 });
    mocks.validateMediaDecoding.mockResolvedValue(undefined);
    mocks.copyStoredObject.mockResolvedValue(undefined);
    mocks.deleteObject.mockResolvedValue(undefined);
  });

  it('固定单图 PNG 请求参数，并只在边界把图片引用与结构化标注编译为供应商语法', () => {
    const payload = buildSeedreamImagePayload(baseInput({
      prompt: '保持 @图片1 的主体，把 @标记1 换成皇冠',
      config: {
        resolution: '1K', aspectRatio: '1:1', outputSize: '1024x1024', optimizePromptMode: 'fast',
        referenceAssets: [{ id: 'asset-1', objectKey: 'users/u/ref.png', type: 'image', role: 'reference_image' }],
        annotations: [{ token: '@标记1', assetId: 'asset-1', type: 'point', x: 520, y: 460 }],
      },
    }), ['https://signed.example.test/ref.png']);

    expect(payload).toEqual({
      model: 'doubao-seedream-5-0-pro-260628',
      prompt: '保持 图 1 的主体，把 图 1 <point>520 460</point> 换成皇冠',
      size: '1024x1024',
      optimize_prompt_options: { mode: 'fast' },
      output_format: 'png',
      response_format: 'url',
      watermark: false,
      image: 'https://signed.example.test/ref.png',
    });
    expect(payload).not.toHaveProperty('stream');
    expect(payload).not.toHaveProperty('sequential_image_generation');
    expect(payload).not.toHaveProperty('tools');
  });

  it('严格解析 canonical 当前用户图片，不接受历史 URL fallback 或角色伪造', async () => {
    const findOwnedObjectKey = vi.fn(async ({ objectKey }) => objectKey);
    const signObjectReadUrl = vi.fn(async key => `https://signed.example.test/${key}`);
    await expect(resolveStrictReferenceImageUrls(baseInput({
      config: { referenceAssets: [{ type: 'image', role: 'reference_image', objectKey: 'users/u/ref.png' }] },
    }), { findOwnedObjectKey, signObjectReadUrl })).resolves.toEqual([
      'https://signed.example.test/users/u/ref.png',
    ]);
    await expect(resolveStrictReferenceImageUrls(baseInput({
      config: { referenceAssets: [{ type: 'image', role: 'reference_image', publicUrl: 'https://evil.test/ref.png' }] },
    }), { findOwnedObjectKey, signObjectReadUrl })).rejects.toMatchObject({ code: 'REFERENCE_ASSET_UNAVAILABLE' });
    await expect(resolveStrictReferenceImageUrls(baseInput({
      config: { referenceAssets: [{ type: 'video', role: 'reference_image', objectKey: 'users/u/ref.png' }] },
    }), { findOwnedObjectKey, signObjectReadUrl })).rejects.toMatchObject({ code: 'REFERENCE_ASSET_UNAVAILABLE' });
  });

  it('429 明确按未创建且未计费返回，并保留 x-tt-logid 证据', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'RateLimitExceeded', message: '请求过于频繁' },
    }), { status: 429, headers: { 'x-tt-logid': 'logid-429' } })));
    try {
      const result = await runArkSeedreamProvider(baseInput());
      expect(result).toMatchObject({
        ok: false,
        providerHttpStatus: 429,
        providerErrorCode: 'RateLimitExceeded',
        providerRequestId: 'logid-429',
        submissionDisposition: 'not-created',
        billingDisposition: 'unbilled',
        providerStatus: 'not-created',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('5xx 与成功响应解析失败都只报提交未知且不泄露临时 URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await expect(runArkSeedreamProvider(baseInput())).rejects.toMatchObject({
      code: 'SEEDREAM_SUBMISSION_UNKNOWN',
      message: 'Seedream 提交结果无法确认，已停止自动重发。',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ url: 'https://127.0.0.1/private.png' }],
    }), { status: 200 })));
    await expect(runArkSeedreamProvider(baseInput())).rejects.not.toThrow('https://127.0.0.1/private.png');
    vi.unstubAllGlobals();
  });

  it('同步 POST 超时归类为 submission-unknown，既不写 checkpoint 也不自动重发', async () => {
    const submissionStarted = vi.fn(async () => undefined);
    const checkpointSaved = vi.fn(async () => undefined);
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(runArkSeedreamProvider(baseInput({
        onProviderSubmissionStarted: submissionStarted,
        onProviderResponseCheckpoint: checkpointSaved,
      }))).rejects.toMatchObject({
        code: 'SEEDREAM_SUBMISSION_UNKNOWN',
        message: 'Seedream 提交结果无法确认，已停止自动重发。',
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(submissionStarted).toHaveBeenCalledOnce();
      expect(checkpointSaved).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['响应头到达后响应体停滞', 'stall'],
    ['响应体读到一半连接断开', 'reset'],
  ] as const)('同步 POST %s时归类为 submission-unknown，既不写 checkpoint 也不自动重发', async (_label, mode) => {
    const submissionStarted = vi.fn(async () => undefined);
    const checkpointSaved = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":[{"url":"https://'));
        if (mode === 'reset') {
          controller.error(new TypeError('terminated'));
          return;
        }
        init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason), { once: true });
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const startedAt = Date.now();
      await expect(runArkSeedreamProvider(baseInput({
        onProviderSubmissionStarted: submissionStarted,
        onProviderResponseCheckpoint: checkpointSaved,
      }))).rejects.toMatchObject({
        code: 'SEEDREAM_SUBMISSION_UNKNOWN',
        message: 'Seedream 提交结果无法确认，已停止自动重发。',
      });
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(submissionStarted).toHaveBeenCalledOnce();
      expect(checkpointSaved).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('有 checkpoint 和本地归档对象时恢复不再 POST，并以解码后尺寸为准', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await resumeArkSeedreamProvider(baseInput({
        providerResponseCheckpoint: {
          version: 1,
          model: 'doubao-seedream-5-0-pro-260628',
          created: null,
          size: '1024x1024',
          usage: { generatedImages: 1, outputTokens: 12, totalTokens: 12 },
        },
        providerResponseUrl: null,
        providerResponseObservedAt: '2026-07-27T00:00:00.000Z',
        providerResponseUrlExpiresAt: '2026-07-28T00:00:00.000Z',
      }), 'seedream-sync:task-1:0');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: true,
        providerTaskId: 'seedream-sync:task-1:0',
        width: 1024,
        height: 1024,
        sizeBytes: 1234,
        generatedImages: 1,
      });
      expect(mocks.validateMediaDecoding).toHaveBeenCalledWith('/tmp/seedream.png', 'image');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('最终成片必须与任务 outputSize 完全一致', async () => {
    mocks.probeMedia.mockResolvedValue({
      formatName: 'png_pipe', hasVideo: true, width: 1023, height: 1024,
    });

    await expect(resumeArkSeedreamProvider(baseInput(checkpointOverrides()), 'seedream-sync:task-1:0'))
      .resolves.toMatchObject({
        ok: false,
        terminal: true,
        providerStatus: 'delivery-failed',
        reason: expect.stringContaining('1023x1024 与任务规格 1024x1024 不一致'),
      });
    expect(mocks.copyStoredObject).not.toHaveBeenCalled();
  });

  it('最终 key 缺失时优先校验 staging，通过后才不可变封口', async () => {
    let copied = false;
    mocks.copyStoredObject.mockImplementation(async () => {
      copied = true;
    });
    mocks.getStoredObjectSize.mockImplementation(async (key: string) => {
      if (key.endsWith('/output.png') && !copied) {
        throw Object.assign(new Error('不存在'), { code: 'ENOENT' });
      }
      return 4321;
    });
    mocks.resolveObjectProcessingInput.mockImplementation(async key => `/tmp/${String(key).split('/').at(-1)}`);

    const result = await resumeArkSeedreamProvider(
      baseInput(checkpointOverrides({ providerResponseUrl: null })),
      'seedream-sync:task-1:0',
    );

    expect(mocks.copyStoredObject).toHaveBeenCalledWith(
      'generated-staging/image/user-1/task-1/attempt-0',
      'generated/image/user-1/task-1/attempt-0/output.png',
    );
    expect(result).toMatchObject({ ok: true, sizeBytes: 4321, width: 1024, height: 1024 });
  });

  it('损坏 staging 会终态失败并清理，绝不复制到最终不可变 key', async () => {
    mocks.getStoredObjectSize.mockImplementation(async (key: string) => {
      if (key.endsWith('/output.png')) throw Object.assign(new Error('不存在'), { code: 'ENOENT' });
      return 99;
    });
    mocks.probeMedia.mockResolvedValue({
      formatName: 'data', hasVideo: false, width: null, height: null,
    });

    const result = await resumeArkSeedreamProvider(
      baseInput(checkpointOverrides()),
      'seedream-sync:task-1:0',
    );

    expect(result).toMatchObject({ ok: false, terminal: true, providerStatus: 'delivery-failed' });
    expect(mocks.deleteObject).toHaveBeenCalledWith(
      'generated-staging/image/user-1/task-1/attempt-0',
    );
    expect(mocks.copyStoredObject).not.toHaveBeenCalled();
  });

  it('SSRF 防护拒绝 IPv4-mapped IPv6 和混合公私网 DNS 结果', async () => {
    const resolver = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    await expect(resolveSeedreamDownloadTarget(
      'https://[::ffff:127.0.0.1]/image.png',
      resolver,
    )).rejects.toMatchObject({ code: 'SEEDREAM_PERMANENT_DELIVERY_FAILURE' });
    expect(resolver).not.toHaveBeenCalled();

    await expect(resolveSeedreamDownloadTarget(
      'https://images.example.test/image.png',
      async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.8', family: 4 },
      ],
    )).rejects.toMatchObject({ code: 'SEEDREAM_PERMANENT_DELIVERY_FAILURE' });
  });

  it('连接 lookup 只返回预先审核的地址，不会再次 DNS 解析', async () => {
    const resolver = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const target = await resolveSeedreamDownloadTarget(
      'https://images.example.test/image.png',
      resolver,
    );
    const callback = vi.fn();

    createSeedreamPinnedLookup(target)(
      'images.example.test',
      { all: true },
      callback,
    );

    expect(resolver).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
  });

  it('下载流中途报错会通过 pipeline 传播，不会形成未处理 source error', async () => {
    mocks.uploadObjectStream.mockImplementation(async ({ body }) => {
      for await (const _chunk of body) {
        // 消费到 EOF，确保实际验证上游错误传播。
      }
      return { sizeBytes: 8 };
    });
    const body = Readable.from((async function* () {
      yield Buffer.from('\u0089PNG\r\n\u001a\n', 'latin1');
      throw new Error('socket reset');
    })());

    await expect(uploadSeedreamPngStream({
      body,
      objectKey: 'generated-staging/image/user-1/task-1/attempt-0',
    })).rejects.toThrow('socket reset');
  });
});

function baseInput(overrides: Partial<ProviderTaskInput> = {}): ProviderTaskInput {
  return {
    taskId: 'task-1',
    userId: 'user-1',
    kind: 'image',
    model: 'Seedream 5.0 Pro',
    prompt: '生成一张图片',
    credits: 14,
    attempt: 0,
    outputObjectKey: 'generated/image/user-1/task-1/attempt-0/output.png',
    stagingObjectKey: 'generated-staging/image/user-1/task-1/attempt-0',
    config: {
      resolution: '1K', aspectRatio: '1:1', outputSize: '1024x1024',
      optimizePromptMode: 'standard', referenceAssets: [], annotations: [],
    },
    onProviderSubmissionStarted: async () => undefined,
    ...overrides,
  };
}

function checkpointOverrides(overrides: Partial<ProviderTaskInput> = {}): Partial<ProviderTaskInput> {
  return {
    providerRequestId: 'seedream-logid-1',
    providerResponseCheckpoint: {
      version: 1,
      model: 'doubao-seedream-5-0-pro-260628',
      created: null,
      size: '1024x1024',
      usage: { generatedImages: 1, outputTokens: 12, totalTokens: 12 },
    },
    providerResponseUrl: 'https://images.example.test/image.png',
    providerResponseObservedAt: '2026-07-27T00:00:00.000Z',
    providerResponseUrlExpiresAt: '2099-07-28T00:00:00.000Z',
    ...overrides,
  };
}
