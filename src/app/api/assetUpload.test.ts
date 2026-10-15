import { afterEach,describe, expect, it, vi } from 'vitest';
import type { Asset } from '../data/assets';
import { AssetUploadError,bindUploadClientIntent,formatUploadError,uploadAssetFile,uploadObjectWithProgress,type AssetUploadDependencies } from './assetUpload';

const signature = {
  driver: 'local' as const,
  method: 'PUT' as const,
  uploadUrl: 'http://localhost:4300/api/storage/local/upload',
  headers: { 'content-type': 'image/png' },
  objectKey: 'users/user-1/cover.png',
  expiresAt: '2026-07-11T12:00:00.000Z',
  sessionId: 'upload-session-1',
  maxSizeBytes: 1024 * 1024,
};

const tosSignature = {
  ...signature,
  driver: 'tos' as const,
  method: 'POST' as const,
  uploadUrl: 'https://bucket-1.tos-cn-guangzhou.volces.com',
  headers: {},
  fields: {
    key: signature.objectKey,
    policy: 'signed-policy',
    'x-tos-signature': 'signed-value',
    'x-tos-forbid-overwrite': 'true',
  },
};

describe('assetUpload', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('签名成功、直传完成、入库成功后以 null 请求后端解析系统主目录', async () => {
    const completeUpload = vi.fn(async () => completedSession());
    const progress: number[] = [];

    const result = await uploadAssetFile({
      file: file('cover.png', 'image/png'),
      folderId: null,
      onProgress: event => progress.push(event.progress),
      dependencies: {
        createUploadSignature: vi.fn(async () => signatureResult()),
        uploadObject: vi.fn(async (_signature, _file, onProgress) => onProgress?.(1)),
        completeUpload,
      },
    });

    expect(result.id).toBe('asset-uploaded');
    expect(progress).toContain(100);
    expect(completeUpload).toHaveBeenCalledWith(
      { uploadSessionId: signature.sessionId },
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('视频完成请求只提交会话 ID', async () => {
    const completeUpload = vi.fn(async () => completedSession(asset({ type: 'video', source: 'uploaded-video' })));

    await uploadAssetFile({
      file: file('clip.mp4', 'video/mp4'),
      dependencies: {
        createUploadSignature: vi.fn(async () => signatureResult({ objectKey: 'users/user-1/clip.mp4' }, 'uploaded-video')),
        uploadObject: vi.fn(async (_signature, _file, onProgress) => onProgress?.(1)),
        completeUpload,
      },
    });

    expect(completeUpload).toHaveBeenCalledWith(
      { uploadSessionId: signature.sessionId },
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('MP3 音频按已上传音频会话完成', async () => {
    const completeUpload = vi.fn(async () => completedSession(asset({ type: 'audio', source: 'uploaded-audio' })));

    await uploadAssetFile({
      file: file('music.mp3', 'audio/mpeg'),
      dependencies: {
        createUploadSignature: vi.fn(async () => signatureResult({ objectKey: 'users/user-1/music.mp3' }, 'uploaded-audio')),
        uploadObject: vi.fn(async (_signature, _file, onProgress) => onProgress?.(1)),
        completeUpload,
      },
    });

    expect(completeUpload).toHaveBeenCalledWith(
      { uploadSessionId: signature.sessionId },
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('拒绝 MP3/WAV 之外的音频格式', async () => {
    await expect(uploadAssetFile({
      file: file('music.aac', 'audio/aac'),
    })).rejects.toMatchObject({
      userMessage: '仅支持图片、视频或 MP3/WAV 音频文件',
      stage: 'signature',
    });
  });

  it('签名 POST 前持久化空 session 的幂等记录，响应丢失重试复用同一幂等键', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const uploadFile = file('response-lost.png', 'image/png', 1_726_000_000_000);
    const observedKeys: string[] = [];
    const createUploadSignature = vi.fn(async (input: Parameters<AssetUploadDependencies['createUploadSignature']>[0]) => {
      observedKeys.push(input.idempotencyKey);
      const records = storage.values().flatMap(raw => JSON.parse(raw) as Array<{ idempotencyKey: string; sessionId: string | null }>);
      expect(records).toContainEqual(expect.objectContaining({
        idempotencyKey: input.idempotencyKey,
        sessionId: null,
      }));
      if (observedKeys.length <= 2) throw new Error('signature response lost');
      return signatureResult();
    });

    await expect(uploadAssetFile({
      file: uploadFile,
      clientIntentId: 'queue-row-response-lost',
      dependencies: { createUploadSignature },
    })).rejects.toMatchObject({ stage: 'signature' });

    await expect(uploadAssetFile({
      file: uploadFile,
      clientIntentId: 'queue-row-response-lost',
      dependencies: {
        createUploadSignature,
        uploadObject: vi.fn(async () => undefined),
        completeUpload: vi.fn(async () => completedSession()),
      },
    })).resolves.toMatchObject({ id: 'asset-uploaded' });

    expect(new Set(observedKeys).size).toBe(1);
    expect(storage.length).toBe(0);
  });

  it('页面恢复时认领上一页面的空 session 记录，不生成新幂等键', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const uploadFile = file('page-recovery.png', 'image/png', 1_726_000_000_001);
    const fingerprint = [
      uploadFile.name,
      uploadFile.size,
      uploadFile.type,
      uploadFile.lastModified,
      '',
    ].join('\u001f');
    storage.setItem(`lindyson:upload:v2:${encodeURIComponent(fingerprint)}`, JSON.stringify([{
      clientIntentId: 'previous-page-row',
      idempotencyKey: 'persisted-before-response',
      sessionId: null,
      pageInstanceId: 'previous-page-instance',
      updatedAt: 1,
    }]));
    const createUploadSignature = vi.fn(async () => signatureResult());

    await uploadAssetFile({
      file: uploadFile,
      clientIntentId: 'restored-page-row',
      dependencies: {
        createUploadSignature,
        uploadObject: vi.fn(async () => undefined),
        completeUpload: vi.fn(async () => completedSession()),
      },
    });

    expect(createUploadSignature).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'persisted-before-response' }),
      expect.anything(),
    );
    expect(storage.length).toBe(0);
  });

  it('同元数据队列项使用各自 client intent，不共享上传会话', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const firstFile = file('duplicate.png', 'image/png', 1_726_000_000_002);
    const secondFile = file('duplicate.png', 'image/png', 1_726_000_000_002);
    const observedKeys: string[] = [];
    const createUploadSignature = vi.fn(async (input: Parameters<AssetUploadDependencies['createUploadSignature']>[0]) => {
      observedKeys.push(input.idempotencyKey);
      return signatureResult({ sessionId: `session-${observedKeys.length}` });
    });
    const dependencies = {
      createUploadSignature,
      uploadObject: vi.fn(async () => undefined),
      completeUpload: vi.fn(async () => completedSession()),
    };
    bindUploadClientIntent(firstFile, 'queue-row-a');
    bindUploadClientIntent(secondFile, 'queue-row-b');

    await Promise.all([
      uploadAssetFile({ file: firstFile, dependencies }),
      uploadAssetFile({ file: secondFile, dependencies }),
    ]);

    expect(observedKeys).toHaveLength(2);
    expect(new Set(observedKeys).size).toBe(2);
    expect(storage.length).toBe(0);
  });

  it('completed 但资产为空时立即终止并清理恢复记录', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const getUploadSession = vi.fn();

    await expect(uploadAssetFile({
      file: file('missing-asset.png', 'image/png', 1_726_000_000_003),
      clientIntentId: 'queue-row-missing-asset',
      dependencies: {
        createUploadSignature: vi.fn(async () => signatureResult()),
        uploadObject: vi.fn(async () => undefined),
        completeUpload: vi.fn(async () => uploadSession({
          status: 'completed',
          processingStage: 'completed',
          progress: 100,
          asset: null,
        })),
        getUploadSession,
      },
    })).rejects.toMatchObject({
      stage: 'complete',
      userMessage: '上传处理已结束，但素材不可用，请重新上传。',
    });

    expect(getUploadSession).not.toHaveBeenCalled();
    expect(storage.length).toBe(0);
  });

  it('直传网络失败时返回可读的上传通道错误', async () => {
    await expect(uploadAssetFile({
      file: file('cover.png', 'image/png'),
      dependencies: {
        createUploadSignature: vi.fn(async () => signatureResult()),
        uploadObject: vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
        completeUpload: vi.fn(async () => completedSession()),
      },
    })).rejects.toMatchObject({
      userMessage: '上传通道连接失败，可能是网络或对象存储跨域配置问题。',
      stage: 'storage',
    });
  });

  it('对象存储拒绝上传时不调用入库接口', async () => {
    const completeUpload = vi.fn(async () => completedSession());

    await expect(uploadAssetFile({
      file: file('cover.png', 'image/png'),
      dependencies: {
        createUploadSignature: vi.fn(async () => signatureResult()),
        uploadObject: vi.fn(async () => {
          throw new AssetUploadError('storage', '对象存储拒绝上传（HTTP 403），请检查存储权限或签名是否过期。', { status: 403 });
        }),
        completeUpload,
      },
    })).rejects.toMatchObject({
      userMessage: '对象存储拒绝上传（HTTP 403），请检查存储权限或签名是否过期。',
      status: 403,
    });

    expect(completeUpload).not.toHaveBeenCalled();
  });

  it('入库失败时保留素材已上传但保存失败的语义', async () => {
    await expect(uploadAssetFile({
      file: file('clip.mp4', 'video/mp4'),
      folderId: 'folder-real-video',
      dependencies: {
        createUploadSignature: vi.fn(async () => signatureResult()),
        uploadObject: vi.fn(async (_signature, _file, onProgress) => onProgress?.(1)),
        completeUpload: vi.fn(async () => {
          throw new Error('请求参数不正确');
        }),
      },
    })).rejects.toMatchObject({
      userMessage: '素材已上传，但保存到资产库失败，请重试。',
      technicalMessage: '请求参数不正确',
      stage: 'complete',
    });
  });

  it('入库失败后的续传只重试完成步骤，不会再次直传对象', async () => {
    const uploadObject = vi.fn(async () => undefined);
    const completeUpload = vi.fn()
      .mockRejectedValueOnce(new Error('complete 1'))
      .mockRejectedValueOnce(new Error('complete 2'))
      .mockRejectedValueOnce(new Error('complete 3'))
      .mockResolvedValueOnce(completedSession());

    const firstAttempt = uploadAssetFile({
      file: file('cover.png', 'image/png'),
      dependencies: {
        createUploadSignature: vi.fn(async () => signatureResult()),
        uploadObject,
        completeUpload,
      },
    });
    let error: AssetUploadError | undefined;
    try {
      await firstAttempt;
    } catch (reason) {
      if (reason instanceof AssetUploadError) error = reason;
    }

    expect(error).toMatchObject({ stage: 'complete' });
    if (!error) throw new Error('预期完成步骤失败');
    expect(error.retryCompletion).toBeTypeOf('function');
    await expect(error.retryCompletion?.()).resolves.toMatchObject({ id: 'asset-uploaded' });
    expect(uploadObject).toHaveBeenCalledTimes(1);
    expect(completeUpload).toHaveBeenCalledTimes(4);
  });

  it('worker 终态失败后的重试调用 session retry，不重复 complete 或直传', async () => {
    const uploadObject = vi.fn(async () => undefined);
    const completeUpload = vi.fn(async () => uploadSession({
      status: 'failed', processingStage: 'failed', progress: 100, canRetry: true,
      error: { code: 'UPLOAD_FINALIZATION_FAILED', message: '临时读取失败' },
    }));
    const retryUploadSession = vi.fn(async () => completedSession());
    let failure: AssetUploadError | undefined;

    try {
      await uploadAssetFile({
        file: file('cover.png', 'image/png'),
        dependencies: {
          createUploadSignature: vi.fn(async () => signatureResult()),
          uploadObject,
          completeUpload,
          retryUploadSession,
        },
      });
    } catch (error) {
      if (error instanceof AssetUploadError) failure = error;
    }

    expect(failure).toMatchObject({ stage: 'complete' });
    await expect(failure?.retryCompletion?.()).resolves.toMatchObject({ id: 'asset-uploaded' });
    expect(retryUploadSession).toHaveBeenCalledWith(signature.sessionId, { signal: undefined });
    expect(uploadObject).toHaveBeenCalledTimes(1);
    expect(completeUpload).toHaveBeenCalledTimes(1);
  });

  it('用户中止后台轮询时请求服务端取消，不虚报已完成取消', async () => {
    const controller = new AbortController();
    const cancelUploadSession = vi.fn(async () => uploadSession({
      status: 'processing', processingStage: 'probing', progress: 58,
    }));
    const pending = uploadSession({ status: 'processing', processingStage: 'probing', progress: 58 });

    const operation = uploadAssetFile({
      file: file('cover.png', 'image/png'),
      signal: controller.signal,
      dependencies: {
        createUploadSignature: vi.fn(async () => signatureResult()),
        uploadObject: vi.fn(async () => undefined),
        completeUpload: vi.fn(async () => pending),
        cancelUploadSession,
      },
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();

    await expect(operation).rejects.toMatchObject({
      stage: 'complete',
      userMessage: '已停止当前上传并请求服务端取消。',
    });
    expect(cancelUploadSession).toHaveBeenCalledWith(signature.sessionId, {
      signal: expect.any(AbortSignal),
    });
  });

  it('XHR 完成后移除外部取消监听器', async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');

    class SuccessfulXhr {
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      status = 200;
      statusText = 'OK';
      responseText = '';
      timeout = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      abort() { this.onabort?.(); }
      send() { this.onload?.(); }
    }
    vi.stubGlobal('XMLHttpRequest', SuccessfulXhr);

    await uploadObjectWithProgress(signature, file('cover.png', 'image/png'), undefined, {
      signal: controller.signal,
    });

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('本地上传继续使用 PUT 原始文件和签名请求头', async () => {
    const uploadFile = file('cover.png', 'image/png');
    const observed = { method: '', headers: [] as Array<[string, string]>, body: undefined as unknown };

    class SuccessfulXhr {
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      status = 204;
      statusText = 'No Content';
      responseText = '';
      timeout = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open(method: string) { observed.method = method; }
      setRequestHeader(key: string, value: string) { observed.headers.push([key, value]); }
      abort() { this.onabort?.(); }
      send(body: unknown) {
        observed.body = body;
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', SuccessfulXhr);

    await uploadObjectWithProgress(signature, uploadFile);

    expect(observed.method).toBe('PUT');
    expect(observed.headers).toEqual([['content-type', 'image/png']]);
    expect(observed.body).toBe(uploadFile);
  });

  it('TOS 上传使用 POST FormData、签名字段在前且不手动设置 multipart 请求头', async () => {
    const uploadFile = file('cover.png', 'image/png');
    const observed = { method: '', headers: [] as Array<[string, string]>, body: undefined as unknown };

    class SuccessfulXhr {
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      status = 204;
      statusText = 'No Content';
      responseText = '';
      timeout = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open(method: string) { observed.method = method; }
      setRequestHeader(key: string, value: string) { observed.headers.push([key, value]); }
      abort() { this.onabort?.(); }
      send(body: unknown) {
        observed.body = body;
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', SuccessfulXhr);

    await uploadObjectWithProgress(tosSignature, uploadFile);

    expect(observed.method).toBe('POST');
    expect(observed.headers).toEqual([]);
    expect(observed.body).toBeInstanceOf(FormData);
    const entries = Array.from((observed.body as FormData).entries());
    expect(entries.map(([key]) => key)).toEqual([
      'key', 'policy', 'x-tos-signature', 'x-tos-forbid-overwrite', 'file',
    ]);
    expect(entries.slice(0, -1).map(([, value]) => value)).toEqual([
      signature.objectKey,
      'signed-policy',
      'signed-value',
      'true',
    ]);
    expect(entries[entries.length - 1]?.[1]).toStrictEqual(uploadFile);
  });

  it.each([
    ['local 409', signature, 409],
    ['TOS forbid-overwrite 412', tosSignature, 412],
  ] as const)('%s 视为首次上传响应丢失并继续 complete', async (_label, replaySignature, status) => {
    class ImmutableReplayXhr {
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      status = status;
      statusText = 'Conflict';
      responseText = '';
      timeout = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      abort() { this.onabort?.(); }
      send() { this.onload?.(); }
    }
    vi.stubGlobal('XMLHttpRequest', ImmutableReplayXhr);

    await expect(uploadObjectWithProgress(
      replaySignature,
      file('cover.png', 'image/png'),
    )).resolves.toBeUndefined();
  });

  it('TOS 签名未明确开启 forbid-overwrite 时 409 仍按真实冲突报错', async () => {
    class ConflictXhr {
      upload = { onprogress: null };
      status = 409;
      statusText = 'Conflict';
      responseText = '对象已存在';
      timeout = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      abort() { this.onabort?.(); }
      send() { this.onload?.(); }
    }
    vi.stubGlobal('XMLHttpRequest', ConflictXhr);
    const unsafeSignature = {
      ...tosSignature,
      fields: Object.fromEntries(
        Object.entries(tosSignature.fields).filter(([key]) => key !== 'x-tos-forbid-overwrite'),
      ),
    };

    await expect(uploadObjectWithProgress(
      unsafeSignature,
      file('cover.png', 'image/png'),
    )).rejects.toMatchObject({ stage: 'storage', status: 409 });
  });

  it('拒绝 TOS 签名字段伪造保留的 file 表单项', async () => {
    class IdleXhr {
      upload = { onprogress: null };
      timeout = 0;
      open() {}
      setRequestHeader() {}
    }
    vi.stubGlobal('XMLHttpRequest', IdleXhr);

    await expect(uploadObjectWithProgress({
      ...tosSignature,
      fields: { ...tosSignature.fields, file: 'forged-file' },
    }, file('cover.png', 'image/png'))).rejects.toMatchObject({
      stage: 'storage',
      userMessage: '上传通道返回了无效的表单字段。',
    });
  });

  it('格式化 Failed to fetch 为对象存储跨域或网络提示', () => {
    expect(formatUploadError(new TypeError('Failed to fetch'))).toEqual({
      message: '上传通道连接失败，可能是网络或对象存储跨域配置问题。',
      technicalMessage: 'Failed to fetch',
    });
  });
});

function file(name: string, type: string, lastModified?: number) {
  return new File(['asset'], name, { type, lastModified });
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    },
    values() {
      return Array.from(values.values());
    },
  } satisfies Storage & { values: () => string[] };
}

function signatureResult(
  patch: Partial<typeof signature> = {},
  source: 'uploaded-image' | 'uploaded-video' | 'uploaded-audio' = 'uploaded-image',
) {
  const nextSignature = { ...signature, ...patch };
  return {
    signature: nextSignature,
    session: uploadSession({ id: nextSignature.sessionId, source }),
  };
}

function completedSession(uploadedAsset: Asset = asset()) {
  const source = uploadedAsset.source === 'uploaded-video' || uploadedAsset.source === 'uploaded-audio'
    ? uploadedAsset.source
    : 'uploaded-image';
  return uploadSession({
    status: 'completed',
    processingStage: 'completed',
    progress: 100,
    source,
    asset: uploadedAsset,
  });
}

function uploadSession(patch: Partial<{
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired';
  processingStage: 'waiting-upload' | 'queued' | 'sealing' | 'validating' | 'probing' | 'thumbnailing' | 'persisting' | 'completed' | 'failed' | 'canceled' | 'expired';
  progress: number;
  attempt: number;
  filename: string;
  source: 'uploaded-image' | 'uploaded-video' | 'uploaded-audio';
  asset: Asset | null;
  error: { code: string; message: string } | null;
  canRetry: boolean;
  expiresAt: string;
  updatedAt: string;
}> = {}) {
  return {
    id: signature.sessionId,
    status: 'pending' as const,
    processingStage: 'waiting-upload' as const,
    progress: 5,
    attempt: 0,
    filename: 'cover.png',
    source: 'uploaded-image' as const,
    asset: null,
    error: null,
    canRetry: false,
    expiresAt: '2026-07-11T12:00:00.000Z',
    updatedAt: '2026-07-11T11:50:00.000Z',
    ...patch,
  };
}

function asset(patch: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-uploaded',
    name: 'cover',
    type: 'image',
    source: 'uploaded-image',
    folderId: 'folder-uploaded-image',
    size: '5 B',
    createdAt: '2026-07-01 10:00',
    updatedAt: '2026-07-01',
    thumbnail: 'https://storage.example.com/cover.png',
    publicUrl: 'https://storage.example.com/cover.png',
    views: 0,
    ...patch,
  };
}
