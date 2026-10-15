import { afterEach,describe,expect,it,vi } from 'vitest';
import { createImageGenerationBatch,createPayment,createTkPromptGeneration,createTkPromptRun,createUploadSignature,createVideoGenerationBatch,deleteFolder,login,requestAdminAssetDownload,requestAssetDownload,savePaymentChannel,syncPaymentOrder,updateTkPromptEngineSettings,updateVideoConsumptionModelAvailability } from './mutations';

describe('TK Prompt Engine 1.0 写入端点', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('使用独立路径建立商品事实任务', async () => {
    const run = {
      id: '00000000-0000-4000-8000-000000000101',
      schemaVersion: 1,
      status: 'analyzing',
      imageAssetIds: ['00000000-0000-4000-8000-000000000102'],
      evidenceProfile: null,
      failureReason: null,
      createdAt: '2026-08-17T00:00:00.000Z',
      completedAt: null,
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ run }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createTkPromptRun({
      idempotencyKey: 'tk-run-idempotency-key',
      imageAssetIds: run.imageAssetIds,
    })).resolves.toEqual(run);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/ai/tk-prompt-engine/runs');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      idempotencyKey: 'tk-run-idempotency-key',
      imageAssetIds: run.imageAssetIds,
    });
  });

  it('按一次整批请求提交事实与5秒无口播配置', async () => {
    const payload = {
      idempotencyKey: 'tk-generation-idempotency-key',
      expectedGenerationCredits: 2,
      evidenceReview: {
        productName: '自动喂食器',
        category: '宠物用品',
        rejectedVisibleFactIds: [],
        userConfirmedFacts: [],
        forbiddenClaims: [],
      },
      creativeInput: {
        targetMarket: '日本',
        targetAudience: '',
        verifiedOffer: '',
        appearance: { mode: 'product_closeup' as const },
        availableScenes: [],
        availableAssets: ['商品参考图片1'],
      },
      videoConfig: {
        model: 'seedance-2.0' as const,
        aspectRatio: '9:16' as const,
        resolution: '720p' as const,
        durationSeconds: 5 as const,
      },
    };
    const generation = {
      id: '00000000-0000-4000-8000-000000000111',
      runId: '00000000-0000-4000-8000-000000000112',
      schemaVersion: 1,
      status: 'queued',
      evidenceReview: payload.evidenceReview,
      creativeInput: payload.creativeInput,
      videoConfig: payload.videoConfig,
      isFree: true,
      credits: 0,
      creditStatus: 'none',
      strategySet: [],
      options: [],
      failureReason: null,
      createdAt: '2026-08-17T00:00:00.000Z',
      completedAt: null,
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ generation }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createTkPromptGeneration('run/id', payload)).resolves.toEqual(generation);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/ai/tk-prompt-engine/runs/run%2Fid/generations');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual(payload);
    expect(body.creativeInput).not.toHaveProperty('spokenLanguage');
  });

  it('管理端使用TK1.0独立设置路径', async () => {
    const settings = {
      schemaVersion: 1,
      generationCredits: 3,
      available: true,
      updatedAt: '2026-08-17T00:00:00.000Z',
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ settings }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(updateTkPromptEngineSettings({ generationCredits: 3 }, 'tk-settings-key')).resolves.toEqual(settings);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/tk-prompt-engine-settings');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ generationCredits: 3 });
  });
});

describe('素材文件夹删除', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('发送内容处置动作并返回服务端实际执行结果', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: true,
      contentAction: 'move-to-root',
      affectedAssetCount: 3,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteFolder('folder/id', 'delete-assets')).resolves.toEqual({
      ok: true,
      contentAction: 'move-to-root',
      affectedAssetCount: 3,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/folders/folder%2Fid?contentAction=delete-assets', expect.objectContaining({
      method: 'DELETE',
    }));
  });
});

describe('Seedance 2.5 模型级开放滚动兼容', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('模型级开放请求显式声明支持 25 秒档位', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse({
      items: [],
      videoModels: [],
      promptWizard: {
        generationCredits: 1,
        available: false,
        engineVersion: 4,
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await updateVideoConsumptionModelAvailability('Seedance 2.5', false, 'seedance-25-availability-key');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/admin/consumption-settings/video-models/Seedance%202.5/availability?videoDuration25=1',
    );
  });
});

describe('登录身份恢复', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('直接采用登录响应用户，不额外请求 /me', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      user: validUserProfile(),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(login('user@example.com', 'password-123')).resolves.toMatchObject({
      email: 'user@example.com',
      userName: '测试用户',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/login');
  });
});

describe('生成参考素材请求', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('只提交规范化配置以及 assetId 和 role', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ tasks: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createVideoGenerationBatch([{
      kind: 'video',
      model: 'seedance-1.5-pro',
      prompt: '生成测试视频',
      config: {
        mode: 'general',
        aspectRatio: '9:16',
        resolution: '720p',
        durationSeconds: 5,
      },
      references: [{
        assetId: '00000000-0000-4000-8000-000000000001',
        role: 'reference_image',
      }],
      promptWizardSource: {
        runId: '00000000-0000-4000-8000-000000000002',
        batchId: '00000000-0000-4000-8000-000000000003',
        planId: '00000000-0000-4000-8000-000000000004',
        engineVersion: 3,
        editBucket: 'minor',
      },
    }], 'generation-idempotency-key')).resolves.toEqual([]);

    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error('生成请求未携带 RequestInit');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      idempotencyKey: 'generation-idempotency-key',
      requests: [{
        model: 'seedance-1.5-pro',
        prompt: '生成测试视频',
        config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        references: [{
          assetId: '00000000-0000-4000-8000-000000000001',
          role: 'reference_image',
        }],
        promptWizardSource: {
          runId: '00000000-0000-4000-8000-000000000002',
          batchId: '00000000-0000-4000-8000-000000000003',
          planId: '00000000-0000-4000-8000-000000000004',
          engineVersion: 3,
          editBucket: 'minor',
        },
      }],
    });
    expect(JSON.stringify(body)).not.toContain('objectKey');
    expect(JSON.stringify(body)).not.toContain('thumbnailKey');
  });

  it('新方案只传tkPromptSource，不混入历史V6来源', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ tasks: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await createVideoGenerationBatch([{
      kind: 'video',
      model: 'Seedance 2.0',
      prompt: 'TK 1.0 执行提示词',
      config: {
        mode: 'general',
        aspectRatio: '9:16',
        resolution: '720p',
        durationSeconds: 10,
      },
      references: [{
        assetId: '00000000-0000-4000-8000-000000000121',
        role: 'reference_image',
      }],
      tkPromptSource: {
        runId: '00000000-0000-4000-8000-000000000122',
        generationId: '00000000-0000-4000-8000-000000000123',
        optionId: '00000000-0000-4000-8000-000000000124',
        schemaVersion: 1,
        editBucket: 'none',
      },
    }], 'tk-video-generation-key');

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.requests[0].tkPromptSource).toEqual({
      runId: '00000000-0000-4000-8000-000000000122',
      generationId: '00000000-0000-4000-8000-000000000123',
      optionId: '00000000-0000-4000-8000-000000000124',
      schemaVersion: 1,
      editBucket: 'none',
    });
    expect(body.requests[0]).not.toHaveProperty('promptWizardSource');
  });

  it('图片批次独立提交配置、参考图和坐标标记', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ tasks: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createImageGenerationBatch([{
      kind: 'image',
      model: 'Seedream 5.0 Pro',
      prompt: '替换@标记1的主体',
      config: { resolution: '2K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
      references: [{ assetId: '00000000-0000-4000-8000-000000000001', role: 'reference_image' }],
      annotations: [{
        token: '@标记1',
        assetId: '00000000-0000-4000-8000-000000000001',
        type: 'point',
        x: 500,
        y: 500,
      }],
    }], 'image-generation-key')).resolves.toEqual([]);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/ai/image-tasks/batch');
    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error('图片生成请求未携带 RequestInit');
    expect(JSON.parse(String(init.body))).toEqual({
      idempotencyKey: 'image-generation-key',
      requests: [{
        model: 'Seedream 5.0 Pro',
        prompt: '替换@标记1的主体',
        config: { resolution: '2K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
        references: [{ assetId: '00000000-0000-4000-8000-000000000001', role: 'reference_image' }],
        annotations: [{ token: '@标记1', assetId: '00000000-0000-4000-8000-000000000001', type: 'point', x: 500, y: 500 }],
      }],
    });
  });
});

describe('素材下载响应契约', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('使用 POST 请求并解析短期下载凭证', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      download: {
        url: 'https://storage.example.com/video.mp4?signature=test',
        filename: 'Seedance 视频.mp4',
        downloadRequestedAt: '2026-07-11T15:40:00.000Z',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestAssetDownload('asset/video 1')).resolves.toEqual({
      url: 'https://storage.example.com/video.mp4?signature=test',
      filename: 'Seedance 视频.mp4',
      downloadRequestedAt: '2026-07-11T15:40:00.000Z',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/asset%2Fvideo%201/download', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
  });

  it('拒绝危险下载地址', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      download: {
        url: 'javascript:alert(1)',
        filename: 'video.mp4',
        downloadRequestedAt: '2026-07-11T15:40:00.000Z',
      },
    })));

    await expect(requestAssetDownload('asset-1')).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_API_RESPONSE',
    });
  });
});

describe('管理员素材下载响应契约', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('编码资产 ID 并向管理员下载入口发送 POST 请求', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      download: {
        url: 'https://storage.example.com/admin-video.mp4?signature=test',
        filename: '用户成片.mp4',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestAdminAssetDownload('asset/video 1')).resolves.toEqual({
      url: 'https://storage.example.com/admin-video.mp4?signature=test',
      filename: '用户成片.mp4',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/assets/asset%2Fvideo%201/download', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
  });

  it('拒绝管理员接口返回的危险下载地址', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      download: {
        url: 'javascript:alert(1)',
        filename: 'video.mp4',
      },
    })));

    await expect(requestAdminAssetDownload('asset-1')).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_API_RESPONSE',
    });
  });
});

describe('上传签名响应契约', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['本地 PUT', validUploadSignature()],
    ['TOS POST Policy', validTosUploadSignature()],
  ])('解析%s签名并保留服务端限制', async (_name, signature) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ signature, session: validUploadSession() })));

    await expect(createUploadSignature(uploadSignaturePayload())).resolves.toEqual({
      signature,
      session: validUploadSession(),
    });
  });

  it.each([
    ['本地签名使用 POST', { method: 'POST' }],
    ['非字符串 header', { headers: { 'content-type': 42 } }],
    ['非整数大小', { maxSizeBytes: 1.5 }],
    ['危险上传协议', { uploadUrl: 'javascript:alert(1)' }],
  ])('拒绝%s', async (_name, patch) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      signature: { ...validUploadSignature(), ...patch },
      session: validUploadSession(),
    })));

    await expect(createUploadSignature(uploadSignaturePayload()))
      .rejects.toMatchObject({ status: 502, code: 'INVALID_API_RESPONSE' });
  });

  it.each([
    ['改成 PUT', { method: 'PUT' }],
    ['缺少 Policy 字段', { fields: undefined }],
    ['包含非字符串 Policy 字段', { fields: { policy: 42 } }],
    ['携带自定义请求头', { headers: { 'content-type': 'multipart/form-data' } }],
  ])('拒绝 TOS POST 签名%s', async (_name, patch) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      signature: { ...validTosUploadSignature(), ...patch },
      session: validUploadSession(),
    })));

    await expect(createUploadSignature(uploadSignaturePayload()))
      .rejects.toMatchObject({ status: 502, code: 'INVALID_API_RESPONSE' });
  });
});

describe('支付启动响应契约', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['pc' as const, { surface: 'pc', type: 'qr', codeUrl: 'https://openapi.alipay.com/pay?id=1' }],
    ['mobile' as const, { surface: 'mobile', type: 'url', url: 'https://openapi.alipay.com/pay?id=1' }],
    ['mobile' as const, {
      surface: 'mobile',
      type: 'form',
      action: 'https://openapi.alipay.com/gateway.do',
      method: 'POST',
      fields: [{ name: 'order', value: 'order-1' }],
    }],
  ])('解析 %s 启动数据', async (surface, payment) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      order: validOrder(),
      paymentAttempt: validPaymentAttempt(payment),
      payment,
      reused: false,
    })));

    await expect(createPayment({
      planId: 'plan-1',
      billing: 'monthly',
      surface,
      idempotencyKey: 'payment-test-key',
    })).resolves.toMatchObject({ payment });
  });

  it('payment 为空且 attempt 仍在处理时保留非终态，不把它解释为支付完成', async () => {
    const paymentAttempt = {
      ...validPaymentAttempt(null),
      status: 'processing',
      retryAfterMs: 3_000,
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      order: {
        ...validOrder(),
        paymentAttemptStatus: 'processing',
        paymentRetryAfterMs: 3_000,
      },
      paymentAttempt,
      payment: null,
      reused: true,
    })));

    await expect(createPayment({
      planId: 'plan-1',
      billing: 'monthly',
      surface: 'pc',
      idempotencyKey: 'payment-processing-key',
    })).resolves.toMatchObject({
      paymentAttempt: {
        status: 'processing',
        launch: null,
        retryAfterMs: 3_000,
      },
      payment: null,
      reused: true,
    });
  });

  it('保留较长的 HTTPS 二维码地址，交由渲染边界安全降级', async () => {
    const payment = {
      surface: 'pc' as const,
      type: 'qr' as const,
      codeUrl: `https://openapi.alipay.com/gateway.do?token=${'a'.repeat(3_000)}`,
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      order: validOrder(),
      paymentAttempt: validPaymentAttempt(payment),
      payment,
      reused: false,
    })));

    await expect(createPayment({
      planId: 'plan-1',
      billing: 'monthly',
      surface: 'pc',
      idempotencyKey: 'payment-long-qr-key',
    })).resolves.toMatchObject({ payment });
  });

  it.each([
    ['危险 URL', 'mobile' as const, { surface: 'mobile', type: 'url', url: 'javascript:alert(1)' }],
    ['账号 surface 不一致', 'mobile' as const, { surface: 'pc', type: 'qr', codeUrl: 'https://openapi.alipay.com/pay' }],
    ['二维码非 HTTPS', 'pc' as const, { surface: 'pc', type: 'qr', codeUrl: 'http://openapi.alipay.com/pay' }],
    ['桌面端返回非二维码', 'pc' as const, { surface: 'pc', type: 'url', url: 'https://openapi.alipay.com/pay' }],
    ['表单方法越界', 'mobile' as const, {
      surface: 'mobile',
      type: 'form',
      action: 'https://openapi.alipay.com/pay',
      method: 'DELETE',
      fields: [{ name: 'order', value: 'order-1' }],
    }],
    ['旧版缺少 type', 'mobile' as const, { surface: 'mobile', url: 'https://openapi.alipay.com/pay' }],
  ])('拒绝%s', async (_name, surface, payment) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      order: validOrder(),
      paymentAttempt: validPaymentAttempt(payment),
      payment,
      reused: false,
    })));

    await expect(createPayment({
      planId: 'plan-1',
      billing: 'monthly',
      surface,
      idempotencyKey: 'payment-test-key',
    })).rejects.toMatchObject({ status: 502, code: 'INVALID_API_RESPONSE' });
  });
});

describe('支付状态同步', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('调用方取消时中止正在进行的查单请求', async () => {
    const observed: { signal: AbortSignal | null } = { signal: null };
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      observed.signal = init?.signal ?? null;
      observed.signal?.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')), { once: true });
    })));

    const controller = new AbortController();
    const request = syncPaymentOrder('00000000-0000-4000-8000-000000000001', { signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(observed.signal?.aborted).toBe(true);
  });
});

describe('支付通道保存响应契约', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('保存后逐字段解析支付通道', async () => {
    const channel = validPaymentChannel();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ channel }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(savePaymentChannel({
      enabled: false,
      apiBase: '',
      mchNo: '',
      appId: '',
      desktopWayCode: 'ALI_WAP',
      mobileWayCode: 'ALI_WAP',
    }, 'admin-payment-channel-test-key')).resolves.toEqual({ ...channel, updatedAt: undefined });

    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(requestHeaders.get('Idempotency-Key')).toBe('admin-payment-channel-test-key');
  });

  it('拒绝服务端返回未知支付方式', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      channel: { ...validPaymentChannel(), mobileWayCode: 'ALI_PC' },
    })));

    await expect(savePaymentChannel({
      enabled: false,
      apiBase: '',
      mchNo: '',
      appId: '',
      desktopWayCode: 'ALI_WAP',
      mobileWayCode: 'ALI_WAP',
    }, 'admin-payment-channel-invalid-response')).rejects.toMatchObject({ status: 502, code: 'INVALID_API_RESPONSE' });
  });
});

function validUploadSignature() {
  return {
    driver: 'local',
    method: 'PUT',
    uploadUrl: 'http://127.0.0.1:4300/api/storage/object?signature=test',
    headers: { 'content-type': 'video/mp4' },
    objectKey: 'users/user-1/video.mp4',
    expiresAt: '2026-07-11T12:00:00.000Z',
    sessionId: '00000000-0000-4000-8000-000000000004',
    maxSizeBytes: 1024 * 1024,
  };
}

function uploadSignaturePayload() {
  return {
    filename: 'video.mp4',
    contentType: 'video/mp4',
    sizeBytes: 1024,
    source: 'uploaded-video' as const,
    folderId: null,
    idempotencyKey: 'upload-signature-test-key',
  };
}

function validUploadSession() {
  return {
    id: '00000000-0000-4000-8000-000000000004',
    status: 'pending',
    processingStage: 'waiting-upload',
    progress: 5,
    attempt: 0,
    filename: 'video.mp4',
    source: 'uploaded-video',
    asset: null,
    error: null,
    canRetry: false,
    expiresAt: '2026-07-11T12:00:00.000Z',
    updatedAt: '2026-07-11T11:50:00.000Z',
  };
}

function validTosUploadSignature() {
  return {
    driver: 'tos',
    method: 'POST',
    uploadUrl: 'https://bucket-1.tos-cn-guangzhou.volces.com',
    headers: {},
    fields: {
      key: 'users/user-1/video.mp4',
      policy: 'signed-policy',
      'x-tos-signature': 'signed-value',
    },
    objectKey: 'users/user-1/video.mp4',
    expiresAt: '2026-07-11T12:00:00.000Z',
    sessionId: '00000000-0000-4000-8000-000000000004',
    maxSizeBytes: 1024 * 1024,
  };
}

function validPaymentChannel() {
  return {
    enabled: false,
    apiBase: '',
    mchNo: '',
    appId: '',
    hasApiKey: false,
    desktopWayCode: 'ALI_WAP',
    mobileWayCode: 'ALI_WAP',
    updatedAt: null,
  };
}

function validOrder() {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    userName: '测试用户',
    email: 'user@example.com',
    planId: '00000000-0000-4000-8000-000000000003',
    kind: 'main',
    planName: '基础套餐',
    amount: 100,
    billing: 'monthly',
    status: 'pending',
    invoiceStatus: 'unissued',
    invoiceRequestStatus: null,
    creditStatus: 'none',
    creditAmount: 100,
    creditBucket: 'main',
    paymentMethod: '支付宝',
    paymentMethodLabel: '支付宝',
    paymentWayLabel: '支付宝',
    paymentProvider: 'pay-channel',
    paymentWayCode: 'ALI_WAP',
    paymentSurface: 'mobile',
    merchantOrderNo: 'merchant-order-1',
    paymentOrderNo: null,
    paymentError: null,
    paymentAttemptStatus: 'ready',
    paymentAttemptId: '00000000-0000-4000-8000-000000000005',
    paymentAttemptError: null,
    paymentRetryAfterMs: null,
    paymentExpiresAt: '2026-07-11T10:15:00.000Z',
    refundStatus: 'none',
    merchantRefundNo: null,
    refundOrderNo: null,
    refundError: null,
    refundAttemptStatus: null,
    refundAttemptId: null,
    refundManualReviewReason: null,
    refundRetryAfterMs: null,
    createdAt: '2026-07-11T10:00:00.000Z',
    paidAt: null,
    failedAt: null,
    refundedAt: null,
  };
}

function validUserProfile() {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'user@example.com',
    userName: '测试用户',
    role: 'user',
    status: 'active',
    planCode: null,
    planName: null,
    portraitEntitlements: {
      enabled: true,
      profileLimit: 1,
      activeLimit: 1,
      assetsPerActor: 1,
    },
    billingCycle: 'monthly',
    mainCredits: 0,
    addonCredits: 0,
    credits: 0,
    totalCredits: 0,
    planResetAt: null,
    planExpiresAt: null,
    registeredAt: '2026-07-01T00:00:00.000Z',
    lastActiveAt: '2026-07-08T10:00:00.000Z',
  };
}

function validPaymentAttempt(payment: unknown) {
  return {
    id: '00000000-0000-4000-8000-000000000005',
    attempt: 1,
    status: 'ready',
    launch: payment,
    retryAfterMs: null,
    error: null,
    manualReviewReason: null,
    createdAt: '2026-07-11T10:00:00.000Z',
    updatedAt: '2026-07-11T10:00:00.000Z',
  };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
