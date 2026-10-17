import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PUBLIC_BASE_URL: 'http://localhost:4300',
    STORAGE_DRIVER: 'local',
    LOCAL_STORAGE_DIR: './storage',
    ARK_API_KEY: 'test-ark-key',
    ARK_BASE_URL: 'https://ark.example.test/api/v3',
    ARK_SEEDANCE_MODEL: 'doubao-seedance-2-0-260128',
    ARK_SEEDANCE_FAST_MODEL: 'doubao-seedance-2-0-fast-260128',
    ARK_SEEDANCE_MINI_MODEL: 'doubao-seedance-2-0-mini-260615',
    ARK_SEEDANCE_25_MODEL: 'doubao-seedance-2-5-260628',
    ARK_POLL_INTERVAL_MS: 1,
    ARK_TASK_TIMEOUT_MS: 100,
    ARK_DOWNLOAD_TIMEOUT_MS: 100,
    THUMBNAIL_IMAGE_CONCURRENCY: 2,
    THUMBNAIL_VIDEO_CONCURRENCY: 1,
  },
}));

import type { Readable } from 'node:stream';
import {
  archiveVideoToStorage,
  buildSeedanceProviderFailure,
  buildSeedanceTaskPayload,
  classifyArkSubmissionDisposition,
  isConnectPhaseNetworkError,
  classifySeedanceProviderError,
  extractReferenceAssetUrls,
  extractReferenceImageUrls,
  extractSeedanceUsage,
  extractSeedanceVideoUrl,
  getArkSeedanceModelId,
  inferSeedanceFallbackDimensions,
  notifyArkSeedanceUsageObserved,
  resolveReferenceAssetUrls,
  resolveReferenceImageUrls,
  runArkSeedanceProvider,
  seedanceUsageToProviderUnits,
  tryRequestArkSeedanceTaskCancellation,
  type VideoArchiveOptions,
} from '../src/providers/arkSeedanceProvider.js';
import type { ProviderTaskInput } from '../src/providers/fakeProvider.js';

describe('arkSeedanceProvider', () => {
  it('创建接口明确 4xx 拒绝时返回未创建、未计费和供应商诊断证据', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'InvalidParameter',
        message: '参考素材不符合接口约束',
      },
    }), {
      status: 400,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'ark-request-400',
      },
    }));
    const onProviderSubmissionStarted = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await runArkSeedanceProvider({
        taskId: 'task-rejected',
        userId: 'user-1',
        kind: 'video',
        model: 'Seedance 2.0',
        prompt: '生成产品展示视频',
        credits: 40,
        config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        onProviderSubmissionStarted,
      });

      expect(onProviderSubmissionStarted).toHaveBeenCalledOnce();
      expect(result).toMatchObject({
        ok: false,
        provider: 'volcengine-ark',
        reason: '参考素材不符合接口约束（HTTP 400，code=InvalidParameter，requestId=ark-request-400）',
        submissionDisposition: 'not-created',
        providerHttpStatus: 400,
        providerErrorCode: 'InvalidParameter',
        providerRequestId: 'ark-request-400',
        providerStatus: 'not-created',
        billingDisposition: 'unbilled',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('创建接口文本审核拒绝时归类为内容规范且保持未创建退款证据', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'InputTextSensitiveContentDetected',
        message: "The request failed because the input text 'content[0]' may contain sensitive information.",
      },
    }), {
      status: 400,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'ark-sensitive-text-400',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await runArkSeedanceProvider({
        taskId: 'task-sensitive-text',
        userId: 'user-1',
        kind: 'video',
        model: 'Seedance 2.0',
        prompt: '生成产品展示视频',
        credits: 40,
        config: { aspectRatio: '9:16', resolution: '480p', durationSeconds: 15 },
        onProviderSubmissionStarted: async () => undefined,
      });

      expect(result).toMatchObject({
        ok: false,
        category: 'content-policy',
        submissionDisposition: 'not-created',
        providerHttpStatus: 400,
        providerErrorCode: 'InputTextSensitiveContentDetected',
        providerRequestId: 'ark-sensitive-text-400',
        providerStatus: 'not-created',
        billingDisposition: 'unbilled',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('终态查询提取带后缀的审核错误码并保留内部证据', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'cgt-privacy-video' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'cgt-privacy-video',
        status: 'failed',
        error: {
          code: 'InputVideoSensitiveContentDetected.PrivacyInformation',
          message: 'The request failed because the input video may contain real person.',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await runArkSeedanceProvider({
        taskId: 'task-terminal-privacy',
        userId: 'user-1',
        kind: 'video',
        model: 'Seedance 2.0 Fast',
        prompt: '生成产品展示视频',
        credits: 34,
        config: { aspectRatio: '9:16', resolution: '480p', durationSeconds: 10 },
      });

      expect(result).toMatchObject({
        ok: false,
        category: 'content-policy',
        providerTaskId: 'cgt-privacy-video',
        providerStatus: 'failed',
        providerErrorCode: 'InputVideoSensitiveContentDetected.PrivacyInformation',
        terminal: true,
      });
      if (result.ok) throw new Error('预期供应商返回失败终态');
      expect(result.reason).toContain('code=InputVideoSensitiveContentDetected.PrivacyInformation');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('创建接口 5xx 时保守返回提交结果未知且不声称未计费', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'InternalServiceError', message: 'upstream unavailable' },
    }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await runArkSeedanceProvider({
        taskId: 'task-unknown',
        userId: 'user-1',
        kind: 'video',
        model: 'Seedance 2.0',
        prompt: '生成产品展示视频',
        credits: 40,
        config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        onProviderSubmissionStarted: async () => undefined,
      });

      expect(result).toMatchObject({
        ok: false,
        reason: 'upstream unavailable（HTTP 503，code=InternalServiceError）',
        submissionDisposition: 'unknown',
        providerHttpStatus: 503,
        billingDisposition: 'unknown',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('方舟接口响应头到达后响应体停滞时，在请求超时内中止且不重复提交', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":"cgt-'));
        init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason), { once: true });
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const startedAt = Date.now();
      const result = await runArkSeedanceProvider({
        taskId: 'task-body-stall', userId: 'user-1', kind: 'video',
        model: 'Seedance 2.5', prompt: '生成产品展示视频', credits: 320,
        config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        onProviderSubmissionStarted: async () => undefined,
      });
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(result).toMatchObject({ ok: false, submissionDisposition: 'unknown', billingDisposition: 'unknown' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'secret=https://example.test?token=private'])('提交网络异常保留安全诊断且不重复提交：%s', async code => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed', {
      cause: Object.assign(new Error('private signed URL'), { code }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await runArkSeedanceProvider({
        taskId: 'task-network-unknown', userId: 'user-1', kind: 'video',
        model: 'Seedance 2.5', prompt: '生成产品展示视频', credits: 320,
        config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        onProviderSubmissionStarted: async () => undefined,
      });
      expect(result).toMatchObject({ ok: false, submissionDisposition: 'unknown', billingDisposition: 'unknown' });
      if (result.ok) throw new Error('预期网络失败');
      expect(result.reason).toContain('fetch failed');
      expect(result.reason).not.toContain('private');
      if (!code.startsWith('secret=')) expect(result.reason).toContain(code);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['UND_ERR_CONNECT_TIMEOUT', Object.assign(new Error('connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' })],
    ['ENOTFOUND', Object.assign(new Error('dns'), { code: 'ENOTFOUND', syscall: 'getaddrinfo' })],
    ['ECONNREFUSED', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })],
    ['ETIMEDOUT connect', Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT', syscall: 'connect' })],
    ['双栈自动选择全部失败', Object.assign(new AggregateError([
      Object.assign(new Error('v4'), { code: 'ETIMEDOUT', syscall: 'connect' }),
      Object.assign(new Error('v6'), { code: 'ENETUNREACH', syscall: 'connect' }),
    ]), { code: 'ETIMEDOUT' })],
  ])('建连前网络失败判为未创建且不计费，可直接退款：%s', async (_label, cause) => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await runArkSeedanceProvider({
        taskId: 'task-connect-failed', userId: 'user-1', kind: 'video',
        model: 'Seedance 2.5', prompt: '生成产品展示视频', credits: 320,
        config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        onProviderSubmissionStarted: async () => undefined,
      });
      expect(result).toMatchObject({
        ok: false,
        submissionDisposition: 'not-created',
        billingDisposition: 'unbilled',
        providerStatus: 'not-created',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('只有部分地址在建连阶段失败时不能判为未创建', () => {
    expect(isConnectPhaseNetworkError(new TypeError('fetch failed', {
      cause: new AggregateError([
        Object.assign(new Error('v4'), { code: 'ECONNRESET', syscall: 'read' }),
        Object.assign(new Error('v6'), { code: 'ENETUNREACH', syscall: 'connect' }),
      ]),
    }))).toBe(false);
    expect(isConnectPhaseNetworkError(new TypeError('fetch failed', {
      cause: Object.assign(new Error('reset'), { code: 'ECONNRESET', syscall: 'read' }),
    }))).toBe(false);
    expect(isConnectPhaseNetworkError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(false);
  });

  it('创建接口成功响应缺少 task id 时仍保守进入提交结果未知', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'accepted' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await runArkSeedanceProvider({
        taskId: 'task-missing-id',
        userId: 'user-1',
        kind: 'video',
        model: 'Seedance 2.0',
        prompt: '生成产品展示视频',
        credits: 40,
        config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        onProviderSubmissionStarted: async () => undefined,
      });

      expect(result).toMatchObject({
        ok: false,
        reason: '火山方舟创建接口成功响应中缺少可轮询的任务 ID。',
        submissionDisposition: 'unknown',
        billingDisposition: 'unknown',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('只有可证明未创建的 4xx 才允许按明确拒绝处理', () => {
    expect(classifyArkSubmissionDisposition(400)).toBe('not-created');
    expect(classifyArkSubmissionDisposition(403)).toBe('not-created');
    expect(classifyArkSubmissionDisposition(422)).toBe('not-created');
    expect(classifyArkSubmissionDisposition(429)).toBe('not-created');
    expect(classifyArkSubmissionDisposition(408)).toBe('unknown');
    expect(classifyArkSubmissionDisposition(425)).toBe('unknown');
    expect(classifyArkSubmissionDisposition(499)).toBe('unknown');
    expect(classifyArkSubmissionDisposition(500)).toBe('unknown');
  });

  it('优先使用公开参考图 URL，忽略本地 blob 预览地址', () => {
    const urls = extractReferenceImageUrls({
      referenceImages: [
        { publicUrl: 'https://cdn.example.com/first.png', thumbnail: 'blob:http://localhost/preview-a' },
        { thumbnailUrl: 'https://cdn.example.com/second.jpg' },
        { publicUrl: 'blob:http://localhost/preview-b', thumbnail: 'blob:http://localhost/preview-c' },
      ],
    });

    expect(urls).toEqual([
      'https://cdn.example.com/first.png',
      'https://cdn.example.com/second.jpg',
    ]);
  });

  it('组装 Seedance 任务 payload 时包含文本、参考图、比例、时长和分辨率', () => {
    const input: ProviderTaskInput = {
      taskId: 'task-1',
      userId: 'user-1',
      kind: 'video',
      model: 'Seedance 2.0',
      prompt: '生成产品展示视频',
      credits: 40,
      callbackUrl: 'https://app.example.com/api/providers/ark/callback/callback-token',
      config: {
        aspectRatio: '16:9',
        resolution: '720p',
        durationSeconds: 10,
        referenceImages: [
          { publicUrl: 'https://cdn.example.com/ref.png' },
        ],
      },
    };

    expect(buildSeedanceTaskPayload(input, ['https://cdn.example.com/ref.png'])).toMatchObject({
      model: 'doubao-seedance-2-0-260128',
      ratio: '16:9',
      resolution: '720p',
      duration: 10,
      generate_audio: true,
      watermark: false,
      callback_url: 'https://app.example.com/api/providers/ark/callback/callback-token',
      content: [
        { type: 'text', text: '生成产品展示视频' },
        { type: 'image_url', image_url: { url: 'https://cdn.example.com/ref.png' }, role: 'reference_image' },
      ],
    });
  });

  it('取消供应商任务使用官方 DELETE 接口且不把响应当成退款事实', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(tryRequestArkSeedanceTaskCancellation('cgt-task-1')).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/contents/generations/tasks/cgt-task-1'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('供应商失败日志不输出签名 URL 或原始错误内容', async () => {
    const signedUrl = 'https://tos.example.com/private/video.mp4?X-Tos-Signature=do-not-log';
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: `upstream rejected ${signedUrl}` }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    ));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(tryRequestArkSeedanceTaskCancellation('cgt-task-secret-log')).resolves.toBe(false);

      expect(warn).toHaveBeenCalledTimes(1);
      const serializedLog = warn.mock.calls.flat().join(' ');
      expect(serializedLog).toContain('seedance-cancel-request-failed');
      expect(serializedLog).toContain('continue-polling');
      expect(serializedLog).not.toContain(signedUrl);
      expect(serializedLog).not.toContain('X-Tos-Signature');
      expect(serializedLog).not.toContain('do-not-log');
      expect(serializedLog).not.toContain('upstream rejected');
    } finally {
      vi.unstubAllGlobals();
      warn.mockRestore();
    }
  });

  it('组装 Seedance 任务 payload 时同时包含参考图片、参考视频和参考音频', () => {
    const input: ProviderTaskInput = {
      taskId: 'task-1',
      userId: 'user-1',
      kind: 'video',
      model: 'Seedance 2.0',
      prompt: '生成混合参考视频',
      credits: 40,
      config: {
        aspectRatio: '9:16',
        resolution: '720p',
        durationSeconds: 5,
        referenceAssets: [
          { type: 'image', publicUrl: 'https://cdn.example.com/ref.png' },
          { type: 'video', publicUrl: 'https://cdn.example.com/ref.mp4' },
          { type: 'audio', publicUrl: 'https://cdn.example.com/ref.mp3' },
        ],
      },
    };

    expect(buildSeedanceTaskPayload(input, [
      { type: 'image', url: 'https://cdn.example.com/ref.png', role: 'reference_image' },
      { type: 'video', url: 'https://cdn.example.com/ref.mp4', role: 'reference_video' },
      { type: 'audio', url: 'https://cdn.example.com/ref.mp3', role: 'reference_audio' },
    ])).toMatchObject({
      generate_audio: true,
      watermark: false,
      content: [
        { type: 'text', text: '生成混合参考视频' },
        { type: 'image_url', image_url: { url: 'https://cdn.example.com/ref.png' }, role: 'reference_image' },
        { type: 'video_url', video_url: { url: 'https://cdn.example.com/ref.mp4' }, role: 'reference_video' },
        { type: 'audio_url', audio_url: { url: 'https://cdn.example.com/ref.mp3' }, role: 'reference_audio' },
      ],
    });
  });

  it('首尾帧模式按官方 role 组装 first_frame 和 last_frame', () => {
    const input: ProviderTaskInput = {
      taskId: 'task-1',
      userId: 'user-1',
      kind: 'video',
      model: 'Seedance 2.0',
      prompt: '生成首尾帧视频',
      credits: 40,
      config: {
        mode: 'first-last',
        aspectRatio: '16:9',
        resolution: '720p',
        durationSeconds: 5,
        referenceAssets: [
          { type: 'image', publicUrl: 'https://cdn.example.com/first.png', role: 'first_frame' },
          { type: 'image', publicUrl: 'https://cdn.example.com/last.png', role: 'last_frame' },
        ],
      },
    };

    expect(buildSeedanceTaskPayload(input, [
      { type: 'image', url: 'https://cdn.example.com/first.png', role: 'first_frame' },
      { type: 'image', url: 'https://cdn.example.com/last.png', role: 'last_frame' },
    ])).toMatchObject({
      content: [
        { type: 'text', text: '生成首尾帧视频' },
        { type: 'image_url', image_url: { url: 'https://cdn.example.com/first.png' }, role: 'first_frame' },
        { type: 'image_url', image_url: { url: 'https://cdn.example.com/last.png' }, role: 'last_frame' },
      ],
    });
  });

  it('按产品模型选择对应的方舟 Model ID', () => {
    expect(getArkSeedanceModelId('Seedance 2.0')).toBe('doubao-seedance-2-0-260128');
    expect(getArkSeedanceModelId('Seedance 2.0 Fast')).toBe('doubao-seedance-2-0-fast-260128');
    expect(getArkSeedanceModelId('Seedance 2.0 Mini')).toBe('doubao-seedance-2-0-mini-260615');
    expect(getArkSeedanceModelId('Seedance 2.5')).toBe('doubao-seedance-2-5-260628');
    expect(getArkSeedanceModelId('GPT Image 2.0')).toBeNull();
  });

  it('Seedance 2.5 payload 固定有声 MP4 且不透传编辑或延长字段', () => {
    const payload = buildSeedanceTaskPayload({
      taskId: 'task-25',
      userId: 'user-1',
      kind: 'video',
      model: 'Seedance 2.5',
      prompt: '生成首尾帧视频',
      credits: 100,
      config: {
        mode: 'first-last',
        aspectRatio: 'adaptive',
        resolution: '720p',
        durationSeconds: 30,
        generateAudio: false,
        omniReferenceTaskType: 'extend',
        outputFormat: 'mov',
      },
    }, [
      { type: 'image', url: 'https://cdn.example.com/first.png', role: 'first_frame' },
      { type: 'image', url: 'https://cdn.example.com/last.png', role: 'last_frame' },
    ]);

    expect(payload).toMatchObject({
      model: 'doubao-seedance-2-5-260628',
      ratio: 'adaptive',
      resolution: '720p',
      duration: 30,
      generate_audio: true,
      output_format: 'mp4',
      watermark: false,
    });
    expect(payload).not.toHaveProperty('omni_reference_task_type');
    expect(payload).not.toHaveProperty('omniReferenceTaskType');
    expect(payload).not.toHaveProperty('operation');
  });

  it('Seedance 2.5 payload 原样传递 25 秒固定时长', () => {
    const payload = buildSeedanceTaskPayload({
      taskId: 'task-25-seconds',
      userId: 'user-1',
      kind: 'video',
      model: 'Seedance 2.5',
      prompt: '生成二十五秒有声视频',
      credits: 179,
      config: {
        mode: 'general',
        aspectRatio: '16:9',
        resolution: '480p',
        durationSeconds: 25,
        generateAudio: true,
      },
    }, []);

    expect(payload).toMatchObject({
      model: 'doubao-seedance-2-5-260628',
      duration: 25,
      generate_audio: true,
      output_format: 'mp4',
    });
  });

  it('参考图优先按当前用户自有 objectKey 重新签名', async () => {
    const input: ProviderTaskInput = {
      taskId: 'task-1',
      userId: 'user-1',
      kind: 'video',
      model: 'Seedance 2.0',
      prompt: '生成产品展示视频',
      credits: 40,
      config: {
        referenceImages: [
          {
            objectKey: 'users/user-1/ref.png',
            publicUrl: 'https://expired.example.com/ref.png',
          },
        ],
      },
    };

    await expect(resolveReferenceImageUrls(input, {
      findOwnedObjectKey: async ({ objectKey }) => objectKey,
      signObjectReadUrl: async objectKey => `https://signed.example.com/${objectKey}`,
    })).resolves.toEqual(['https://signed.example.com/users/user-1/ref.png']);
  });

  it('参考素材同时包含图片和视频时按当前用户自有 objectKey 重新签名', async () => {
    const input: ProviderTaskInput = {
      taskId: 'task-1',
      userId: 'user-1',
      kind: 'video',
      model: 'Seedance 2.0',
      prompt: '生成混合参考视频',
      credits: 40,
      config: {
        referenceAssets: [
          { type: 'image', objectKey: 'users/user-1/ref.png' },
          { type: 'video', objectKey: 'users/user-1/ref.mp4' },
        ],
      },
    };

    await expect(resolveReferenceAssetUrls(input, {
      findOwnedObjectKey: async ({ objectKey }) => objectKey,
      signObjectReadUrl: async objectKey => `https://signed.example.com/${objectKey}`,
    })).resolves.toEqual([
      { type: 'image', role: 'reference_image', url: 'https://signed.example.com/users/user-1/ref.png' },
      { type: 'video', role: 'reference_video', url: 'https://signed.example.com/users/user-1/ref.mp4' },
    ]);
  });

  it('批量校验 50 个素材归属，受控并发签名且保持输入顺序', async () => {
    const objectKeys = Array.from({ length: 50 }, (_, index) => `users/user-1/ref-${index}.png`);
    const findOwnedObjectKeys = vi.fn().mockResolvedValue(new Map(
      objectKeys.map(objectKey => [objectKey, objectKey]),
    ));
    let active = 0;
    let maxActive = 0;
    const signObjectReadUrl = vi.fn(async (objectKey: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active -= 1;
      return `https://signed.example.com/${objectKey}`;
    });
    const input: ProviderTaskInput = {
      taskId: 'task-25-refs',
      userId: 'user-1',
      kind: 'video',
      model: 'Seedance 2.5',
      prompt: '生成多素材视频',
      credits: 100,
      config: {
        referenceAssets: objectKeys.map(objectKey => ({
          type: 'image', role: 'reference_image', objectKey,
        })),
      },
    };

    const resolved = await resolveReferenceAssetUrls(input, {
      findOwnedObjectKeys,
      signObjectReadUrl,
      signingConcurrency: 3,
    });

    expect(findOwnedObjectKeys).toHaveBeenCalledOnce();
    expect(findOwnedObjectKeys).toHaveBeenCalledWith({ userId: 'user-1', objectKeys });
    expect(signObjectReadUrl).toHaveBeenCalledTimes(50);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(resolved.map(reference => reference.url)).toEqual(
      objectKeys.map(objectKey => `https://signed.example.com/${objectKey}`),
    );
  });

  it('adaptive 探测兜底沿用首帧尺寸，缺少尺寸时拒绝伪造元数据', () => {
    expect(inferSeedanceFallbackDimensions({
      aspectRatio: 'adaptive',
      referenceAssets: [
        { role: 'first_frame', type: 'image', width: 1500, height: 1000 },
      ],
    })).toEqual({ width: 1500, height: 1000 });
    expect(() => inferSeedanceFallbackDimensions({ aspectRatio: 'adaptive' }))
      .toThrow('自适应视频缺少首帧尺寸信息，无法安全写入输出元数据');
    expect(inferSeedanceFallbackDimensions({ aspectRatio: '9:16' }))
      .toEqual({ width: 1080, height: 1920 });
  });

  it('objectKey 不属于当前用户时拒绝生成且不透传客户端旧 URL', async () => {
    const input: ProviderTaskInput = {
      taskId: 'task-1',
      userId: 'user-1',
      kind: 'video',
      model: 'Seedance 2.0',
      prompt: '生成产品展示视频',
      credits: 40,
      config: {
        referenceImages: [
          {
            objectKey: 'users/other/ref.png',
            publicUrl: 'https://client.example.com/should-not-use.png',
          },
        ],
      },
    };

    const signObjectReadUrl = async (objectKey: string) => `https://signed.example.com/${objectKey}`;
    await expect(resolveReferenceImageUrls(input, {
      findOwnedObjectKey: async () => null,
      signObjectReadUrl,
    })).rejects.toMatchObject({
      code: 'REFERENCE_ASSET_UNAVAILABLE',
      message: '参考素材已删除或不可访问，请重新选择后再生成',
    });
  });

  it('没有 objectKey 的旧参考图继续兼容 HTTPS URL', async () => {
    const input: ProviderTaskInput = {
      taskId: 'task-1',
      userId: 'user-1',
      kind: 'video',
      model: 'Seedance 2.0',
      prompt: '生成产品展示视频',
      credits: 40,
      config: {
        referenceImages: [
          { publicUrl: 'https://cdn.example.com/legacy.png' },
        ],
      },
    };

    await expect(resolveReferenceImageUrls(input, {
      findOwnedObjectKey: async () => {
        throw new Error('不应查询 objectKey');
      },
      signObjectReadUrl: async objectKey => `https://signed.example.com/${objectKey}`,
    })).resolves.toEqual(['https://cdn.example.com/legacy.png']);
  });

  it('提取 referenceAssets 时保留图片和视频类型，并让旧参考图接口只返回图片', () => {
    const config = {
      referenceAssets: [
        { type: 'image', publicUrl: 'https://cdn.example.com/ref.png' },
        { type: 'video', publicUrl: 'https://cdn.example.com/ref.mp4', thumbnail: 'https://cdn.example.com/thumb.jpg' },
      ],
    };

    expect(extractReferenceAssetUrls(config)).toEqual([
      { type: 'image', role: 'reference_image', url: 'https://cdn.example.com/ref.png' },
      { type: 'video', role: 'reference_video', url: 'https://cdn.example.com/ref.mp4' },
    ]);
    expect(extractReferenceImageUrls(config)).toEqual(['https://cdn.example.com/ref.png']);
  });

  it('解析官方 usage token，并将 expired 归类为系统超时', () => {
    expect(extractSeedanceUsage({
      usage: {
        completion_tokens: 108900,
        total_tokens: 109200,
      },
    })).toEqual({
      completionTokens: 108900,
      totalTokens: 109200,
    });

    expect(extractSeedanceUsage({
      data: {
        usage: {
          completionTokens: 120,
          totalTokens: 140,
        },
      },
    })).toEqual({
      completionTokens: 120,
      totalTokens: 140,
    });

    expect(classifySeedanceProviderError('Seedance 任务已过期。')).toBe('system-timeout');
    expect(classifySeedanceProviderError(
      "The input text 'content[0]' may contain sensitive information.",
      'InputTextSensitiveContentDetected',
    )).toBe('content-policy');
    expect(classifySeedanceProviderError(
      'The request failed because the input video may contain real person.',
      'InputVideoSensitiveContentDetected.PrivacyInformation',
    )).toBe('content-policy');
    expect(classifySeedanceProviderError(
      'The request failed because the output video may be related to copyright restrictions.',
    )).toBe('content-policy');
  });

  it('官方已返回 usage 后本地归档失败时，失败结果仍携带官方 token', () => {
    expect(seedanceUsageToProviderUnits({
      completionTokens: 50638,
      totalTokens: 50638,
    })).toEqual({
      rawUnits: 50638,
      deductedUnits: 50638,
      completionTokens: 50638,
      totalTokens: 50638,
      billableTokens: 50638,
      billableBasis: 'completion_tokens',
    });

    expect(buildSeedanceProviderFailure(
      'provider-failed',
      'Unable to calculate hash for flowing readable stream',
      'cgt-20260701231431-ssx7t',
      { completionTokens: 50638, totalTokens: 50638 },
    )).toMatchObject({
      ok: false,
      provider: 'volcengine-ark',
      providerTaskId: 'cgt-20260701231431-ssx7t',
      rawUnits: 50638,
      deductedUnits: 50638,
      completionTokens: 50638,
      totalTokens: 50638,
      billableTokens: 50638,
      billableBasis: 'completion_tokens',
      usageUnit: 'tokens',
      billingDisposition: 'billable',
    });
  });

  it('只有明确 canceled 且无用量时标记为未计费', () => {
    expect(buildSeedanceProviderFailure(
      'provider-failed',
      'canceled',
      'provider-task-1',
      { completionTokens: null, totalTokens: null },
      'canceled',
    )).toMatchObject({
      providerStatus: 'canceled',
      billingDisposition: 'unbilled',
    });
    expect(buildSeedanceProviderFailure(
      'provider-failed',
      'failed',
      'provider-task-2',
      { completionTokens: null, totalTokens: null },
      'failed',
    )).toMatchObject({ billingDisposition: 'unknown' });
  });

  it('供应商终态在本地归档前上报 completion token', async () => {
    const observations: unknown[] = [];
    const input: ProviderTaskInput = {
      taskId: 'task-1',
      userId: 'user-1',
      kind: 'video',
      model: 'Seedance 2.0',
      prompt: '生成产品展示视频',
      credits: 40,
      config: { resolution: '720p' },
      onProviderUsageObserved: async observation => {
        observations.push(observation);
      },
    };

    await notifyArkSeedanceUsageObserved(input, 'provider-task-1', {
      id: 'provider-task-1',
      status: 'succeeded',
      videoUrl: 'https://tos.example.com/video.mp4',
      usage: { completionTokens: 605_700, totalTokens: 606_000 },
    });

    expect(observations).toEqual([expect.objectContaining({
      provider: 'volcengine-ark',
      providerTaskId: 'provider-task-1',
      status: 'success',
      error: null,
      completionTokens: 605_700,
      totalTokens: 606_000,
      billableTokens: 605_700,
      billableBasis: 'completion_tokens',
      providerTerminalAt: null,
      usageObservedAt: expect.any(String),
    })]);
  });

  it('兼容多种 Seedance 成片 URL 返回位置', () => {
    expect(extractSeedanceVideoUrl({
      data: {
        result: {
          video_url: 'https://tos.example.com/generated/video.mp4',
        },
      },
    })).toBe('https://tos.example.com/generated/video.mp4');

    expect(extractSeedanceVideoUrl({
      output: {
        videoUrl: 'https://tos.example.com/output.mp4',
      },
    })).toBe('https://tos.example.com/output.mp4');

    expect(extractSeedanceVideoUrl({
      data: {
        content: [
          { type: 'text', text: 'done' },
          { type: 'video_url', video_url: { url: 'https://tos.example.com/nested.mp4' } },
        ],
      },
    })).toBe('https://tos.example.com/nested.mp4');
  });

  it('仅接受服务端固化的 asset URI 作为真人演员参考', async () => {
    const input: ProviderTaskInput = {
      taskId: 'task-real-portrait',
      userId: 'user-1',
      kind: 'video',
      model: 'Seedance 2.0',
      prompt: '真人演员演示产品',
      credits: 40,
      config: {
        mode: 'general',
        realPortraitReference: {
          actorId: '10000000-0000-4000-8000-000000000001',
          portraitAssetId: '10000000-0000-4000-8000-000000000002',
          providerAssetUri: 'asset://ark-private-asset-id',
        },
      },
    };

    await expect(resolveReferenceAssetUrls(input)).resolves.toEqual([
      { type: 'image', role: 'reference_image', url: 'asset://ark-private-asset-id' },
    ]);
    expect(buildSeedanceTaskPayload(input, await resolveReferenceAssetUrls(input)).content).toContainEqual({
      type: 'image_url',
      image_url: { url: 'asset://ark-private-asset-id' },
      role: 'reference_image',
    });

    await expect(resolveReferenceAssetUrls({
      ...input,
      config: { realPortraitReference: { providerAssetUri: 'https://attacker.example/face.png' } },
    })).rejects.toMatchObject({ code: 'REAL_PORTRAIT_REFERENCE_UNAVAILABLE' });

    await expect(resolveReferenceAssetUrls({
      ...input,
      model: 'Seedance 2.5',
    })).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_MODEL_UNSUPPORTED',
      message: 'Seedance 2.5 暂不支持真人演员',
    });
  });

  describe('成片归档下载', () => {
    const videoBytes = new TextEncoder().encode('seedance-video-bytes');

    function archiveOptions(overrides: Partial<VideoArchiveOptions> = {}) {
      const uploads: string[] = [];
      const upload = vi.fn(async (input: { objectKey: string; body: Readable; contentLength?: number }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
        const text = Buffer.concat(chunks).toString('utf8');
        uploads.push(text);
        return { objectKey: input.objectKey, publicUrl: `https://cdn.example.test/${input.objectKey}`, sizeBytes: text.length };
      });
      const options: VideoArchiveOptions = {
        headersTimeoutMs: 50,
        stallTimeoutMs: 50,
        totalTimeoutMs: 2_000,
        maxAttempts: 3,
        retryDelayMs: 1,
        upload: upload as unknown as VideoArchiveOptions['upload'],
        ...overrides,
      };
      return { options, upload, uploads };
    }

    /** 模拟成片响应：先发出 sent 字节；hang 为 true 时之后不再发数据，直到请求被中止。 */
    function videoResponse(signal: AbortSignal | undefined, input: { sent: Uint8Array; hang?: boolean; contentLength?: number }) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(input.sent);
          if (!input.hang) {
            controller.close();
            return;
          }
          signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(input.contentLength ?? input.sent.length),
        },
      });
    }

    const input = { sourceUrl: 'https://ark-cdn.example.test/video.mp4', objectKey: 'generated/video/u/t/attempt-0/output.mp4' };

    it('正常下载一次完成并上传完整内容', async () => {
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => videoResponse(init?.signal ?? undefined, { sent: videoBytes }));
      vi.stubGlobal('fetch', fetchMock);
      try {
        const { options, upload, uploads } = archiveOptions();
        await expect(archiveVideoToStorage(input, options)).resolves.toMatchObject({ sizeBytes: videoBytes.length });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(upload).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'video/mp4', contentLength: videoBytes.length }));
        expect(uploads).toEqual(['seedance-video-bytes']);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('下载中途停滞时按停滞超时中止，并从头重试成功', async () => {
      let calls = 0;
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        calls += 1;
        return calls === 1
          ? videoResponse(init?.signal ?? undefined, { sent: videoBytes.slice(0, 5), hang: true, contentLength: videoBytes.length })
          : videoResponse(init?.signal ?? undefined, { sent: videoBytes });
      });
      vi.stubGlobal('fetch', fetchMock);
      try {
        const { options, uploads } = archiveOptions();
        await expect(archiveVideoToStorage(input, options)).resolves.toMatchObject({ sizeBytes: videoBytes.length });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(uploads).toEqual(['seedance-video-bytes']);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('连接提前关闭导致字节数不足时视为下载不完整并重试', async () => {
      let calls = 0;
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        calls += 1;
        return calls === 1
          ? videoResponse(init?.signal ?? undefined, { sent: videoBytes.slice(0, 5), contentLength: videoBytes.length })
          : videoResponse(init?.signal ?? undefined, { sent: videoBytes });
      });
      vi.stubGlobal('fetch', fetchMock);
      try {
        const { options, uploads } = archiveOptions();
        await expect(archiveVideoToStorage(input, options)).resolves.toMatchObject({ sizeBytes: videoBytes.length });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(uploads).toEqual(['seedance-video-bytes']);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('等不到响应头时按响应超时中止并重试', async () => {
      let calls = 0;
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        calls += 1;
        if (calls > 1) return Promise.resolve(videoResponse(init?.signal ?? undefined, { sent: videoBytes }));
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      try {
        const { options } = archiveOptions();
        await expect(archiveVideoToStorage(input, options)).resolves.toMatchObject({ sizeBytes: videoBytes.length });
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('成片链接返回 4xx 时不重试', async () => {
      const fetchMock = vi.fn(async () => new Response('expired', { status: 403 }));
      vi.stubGlobal('fetch', fetchMock);
      try {
        const { options, upload } = archiveOptions();
        await expect(archiveVideoToStorage(input, options)).rejects.toThrow('下载 Seedance 成片失败：HTTP 403');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(upload).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('每次都停滞时重试用尽后以超时失败，并归类为系统超时', async () => {
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => videoResponse(
        init?.signal ?? undefined,
        { sent: videoBytes.slice(0, 5), hang: true, contentLength: videoBytes.length },
      ));
      vi.stubGlobal('fetch', fetchMock);
      try {
        const { options } = archiveOptions();
        const error = await archiveVideoToStorage(input, options).then(
          () => { throw new Error('预期归档失败'); },
          (caught: unknown) => caught as Error,
        );
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('未收到数据');
        expect(error.message).toContain('已尝试 3 次');
        expect(classifySeedanceProviderError(error.message)).toBe('system-timeout');
        expect(fetchMock).toHaveBeenCalledTimes(3);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('成片已完整下载后上传失败时不重试', async () => {
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => videoResponse(init?.signal ?? undefined, { sent: videoBytes }));
      vi.stubGlobal('fetch', fetchMock);
      try {
        const upload = vi.fn(async (uploadInput: { body: Readable }) => {
          for await (const _chunk of uploadInput.body) { /* 读完成片 */ }
          throw new Error('TOS 写入失败');
        });
        const { options } = archiveOptions({ upload: upload as unknown as VideoArchiveOptions['upload'] });
        await expect(archiveVideoToStorage(input, options)).rejects.toThrow('TOS 写入失败');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(upload).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
