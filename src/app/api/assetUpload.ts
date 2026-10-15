import type { Asset,AssetSource } from '../data/assets';
import * as mutations from './mutations';
import type { UploadSignatureResponse } from './mutations';

export type UploadProgressPhase = 'signing' | 'uploading' | 'completing' | 'sealing' |
  'validating' | 'probing' | 'thumbnailing' | 'persisting';
export type UploadFailureStage = 'signature' | 'storage' | 'complete';
export type RetryUploadCompletion = (signal?: AbortSignal) => Promise<Asset>;

export interface UploadProgressEvent {
  phase: UploadProgressPhase;
  progress: number;
}

export type UploadSignature = UploadSignatureResponse;

export interface AssetUploadDependencies {
  createUploadSignature: typeof mutations.createUploadSignature;
  completeUpload: typeof mutations.completeUpload;
  getUploadSession: typeof mutations.getUploadSession;
  cancelUploadSession: typeof mutations.cancelUploadSession;
  retryUploadSession: typeof mutations.retryUploadSession;
  uploadObject: typeof uploadObjectWithProgress;
}

type UploadSessionView = Awaited<ReturnType<typeof mutations.getUploadSession>>;
type UploadPersistenceRef = { key: string; idempotencyKey: string };

class UploadSessionTerminalError extends Error {
  session: UploadSessionView;

  constructor(session: UploadSessionView) {
    super(session.error?.message ?? `上传会话已${session.status}`);
    this.name = 'UploadSessionTerminalError';
    this.session = session;
  }
}

export interface UploadAssetFileInput {
  file: File;
  folderId?: string | null;
  clientIntentId?: string;
  onProgress?: (event: UploadProgressEvent) => void;
  dependencies?: Partial<AssetUploadDependencies>;
  signal?: AbortSignal;
}

const pendingClientIntents = new WeakMap<File, string[]>();
const defaultClientIntents = new WeakMap<File, string>();

/**
 * 把 UI 队列行的稳定身份绑定到下一次该文件上传调用。
 * 中间的状态 hook 仍可保持原函数签名，不会把上传意图误当成文件元数据。
 */
export function bindUploadClientIntent(file: File, clientIntentId: string) {
  const normalized = clientIntentId.trim();
  if (!normalized) return;
  const queue = pendingClientIntents.get(file) ?? [];
  queue.push(normalized);
  pendingClientIntents.set(file, queue);
}

export class AssetUploadError extends Error {
  stage: UploadFailureStage;
  userMessage: string;
  technicalMessage: string;
  status?: number;
  retryCompletion?: RetryUploadCompletion;

  constructor(
    stage: UploadFailureStage,
    userMessage: string,
    options: { technicalMessage?: string; status?: number; retryCompletion?: RetryUploadCompletion } = {},
  ) {
    super(userMessage);
    this.name = 'AssetUploadError';
    this.stage = stage;
    this.userMessage = userMessage;
    this.technicalMessage = options.technicalMessage ?? userMessage;
    this.status = options.status;
    this.retryCompletion = options.retryCompletion;
  }
}

export async function uploadAssetFile({
  file,
  folderId,
  clientIntentId,
  onProgress,
  dependencies = {},
  signal,
}: UploadAssetFileInput): Promise<Asset> {
  const deps: AssetUploadDependencies = {
    createUploadSignature: dependencies.createUploadSignature ?? mutations.createUploadSignature,
    completeUpload: dependencies.completeUpload ?? mutations.completeUpload,
    getUploadSession: dependencies.getUploadSession ?? mutations.getUploadSession,
    cancelUploadSession: dependencies.cancelUploadSession ?? mutations.cancelUploadSession,
    retryUploadSession: dependencies.retryUploadSession ?? mutations.retryUploadSession,
    uploadObject: dependencies.uploadObject ?? uploadObjectWithProgress,
  };
  const source = getUploadSource(file);

  if (!source) {
    throw new AssetUploadError('signature', '仅支持图片、视频或 MP3/WAV 音频文件', {
      technicalMessage: `Unsupported content type: ${file.type || 'unknown'}`,
    });
  }

  const persistenceKey = buildUploadPersistenceKey(file, folderId ?? null);
  const resolvedClientIntentId = resolveUploadClientIntent(file, clientIntentId);
  const persisted = claimPersistedUpload(
    persistenceKey,
    buildLegacyUploadPersistenceKey(file, folderId ?? null),
    resolvedClientIntentId,
  );
  const persistenceRef = { key: persistenceKey, idempotencyKey: persisted.idempotencyKey };

  try {
    let signature: UploadSignature | null;
    let session: Awaited<ReturnType<typeof mutations.getUploadSession>>;
    try {
      onProgress?.({ phase: 'signing', progress: 6 });
      const result = await retryStage(
        () => withTimeoutSignal(signal, 20_000, phaseSignal => deps.createUploadSignature({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          source,
          folderId: folderId ?? null,
          idempotencyKey: persisted.idempotencyKey,
        }, { signal: phaseSignal })),
        2,
        signal,
      );
      signature = result.signature;
      session = result.session;
      persistUpload(persistenceKey, { ...persisted, sessionId: session.id, updatedAt: Date.now() });
    } catch (error) {
      if (isAbortError(error, signal)) throw canceledUploadError('signature');
      throw new AssetUploadError('signature', '获取上传通道失败，请稍后重试。', {
        technicalMessage: getTechnicalMessage(error),
      });
    }

    if (!signature) {
      return await resumeStoredUpload(session, deps, persistenceRef, onProgress, signal);
    }
    if (signature.maxSizeBytes !== undefined && file.size > signature.maxSizeBytes) {
      throw new AssetUploadError('signature', '文件超过上传通道允许的大小，请压缩后重试。', {
        technicalMessage: `File size ${file.size} exceeds ${signature.maxSizeBytes}`,
      });
    }

    try {
      onProgress?.({ phase: 'uploading', progress: 10 });
      await retryStage(
        () => deps.uploadObject(signature, file, progress => {
          onProgress?.({
            phase: 'uploading',
            progress: Math.min(84, 10 + Math.round(progress * 0.74)),
          });
        }, { signal, timeoutMs: 60 * 60_000, idleTimeoutMs: 45_000 }),
        1,
        signal,
      );
    } catch (error) {
      if (isAbortError(error, signal)) {
        await cancelSessionBestEffort(session.id, deps);
        throw canceledUploadError('storage');
      }
      throw normalizeStorageError(error);
    }

    const completionPayload: Parameters<typeof mutations.completeUpload>[0] = {
      uploadSessionId: signature.sessionId,
    };

    async function completeStoredUpload(completionSignal = signal): Promise<Asset> {
      try {
        onProgress?.({ phase: 'completing', progress: 88 });
        const queuedSession = await retryStage(
          () => withTimeoutSignal(completionSignal, 20_000, phaseSignal => deps.completeUpload(completionPayload, { signal: phaseSignal })),
          3,
          completionSignal,
        );
        return await waitForUploadCompletionWithRecovery(
          queuedSession, deps, persistenceRef, onProgress, completionSignal,
        );
      } catch (error) {
        if (isAbortError(error, completionSignal)) {
          await cancelSessionBestEffort(session.id, deps);
          throw canceledUploadError('complete');
        }
        if (error instanceof AssetUploadError) throw error;
        throw new AssetUploadError('complete', '素材已上传，但保存到资产库失败，请重试。', {
          technicalMessage: getTechnicalMessage(error),
          retryCompletion: completeStoredUpload,
        });
      }
    }

    const asset = await completeStoredUpload(signal);
    clearPersistedUpload(persistenceRef);
    return asset;
  } finally {
    releasePersistedUploadClaim(persistenceRef.idempotencyKey);
  }
}

async function resumeStoredUpload(
  session: Awaited<ReturnType<typeof mutations.getUploadSession>>,
  deps: AssetUploadDependencies,
  persistenceRef: UploadPersistenceRef,
  onProgress?: (event: UploadProgressEvent) => void,
  signal?: AbortSignal,
) {
  if (session.status === 'completed') {
    clearPersistedUpload(persistenceRef);
    if (session.asset) {
      onProgress?.({ phase: 'persisting', progress: 100 });
      return session.asset;
    }
    throw new AssetUploadError('complete', '上传处理已结束，但素材不可用，请重新上传。', {
      technicalMessage: session.error?.message ?? 'Completed upload session has no deliverable asset',
    });
  }

  async function resume(completionSignal = signal): Promise<Asset> {
    let current = await deps.getUploadSession(session.id, { signal: completionSignal });
    if (current.status === 'failed' && current.canRetry) {
      current = await deps.retryUploadSession(current.id, { signal: completionSignal });
    } else if (current.status === 'pending' && current.processingStage === 'waiting-upload') {
      throw new AssetUploadError('storage', '原上传尚未完成，请重新选择文件继续上传。', {
        technicalMessage: 'Upload session has no sealed object',
      });
    }
    return waitForUploadCompletionWithRecovery(
      current, deps, persistenceRef, onProgress, completionSignal,
    );
  }

  try {
    const asset = await resume(signal);
    clearPersistedUpload(persistenceRef);
    return asset;
  } catch (error) {
    if (isAbortError(error, signal)) {
      await cancelSessionBestEffort(session.id, deps);
      throw canceledUploadError('complete');
    }
    if (error instanceof AssetUploadError) throw error;
    throw new AssetUploadError('complete', '素材已上传，后台处理尚未完成，请重试查询。', {
      technicalMessage: getTechnicalMessage(error),
      retryCompletion: resume,
    });
  }
}

async function waitForUploadCompletion(
  initial: UploadSessionView,
  deps: AssetUploadDependencies,
  onProgress?: (event: UploadProgressEvent) => void,
  signal?: AbortSignal,
) {
  let current = initial;
  const deadline = Date.now() + 60 * 60_000;
  while (Date.now() < deadline) {
    emitSessionProgress(current, onProgress);
    if (current.status === 'completed') {
      if (current.asset) return current.asset;
      throw new UploadSessionTerminalError({
        ...current,
        error: current.error ?? {
          code: 'UPLOAD_ASSET_UNAVAILABLE',
          message: '上传处理已完成，但资产记录不可用',
        },
      });
    }
    if (['failed', 'canceled', 'expired'].includes(current.status)) {
      throw new UploadSessionTerminalError(current);
    }
    await delay(1_200, signal);
    current = await deps.getUploadSession(current.id, { signal });
  }
  throw new Error('上传后台处理超时');
}

async function waitForUploadCompletionWithRecovery(
  initial: UploadSessionView,
  deps: AssetUploadDependencies,
  persistenceRef: UploadPersistenceRef,
  onProgress?: (event: UploadProgressEvent) => void,
  signal?: AbortSignal,
): Promise<Asset> {
  try {
    return await waitForUploadCompletion(initial, deps, onProgress, signal);
  } catch (error) {
    if (!(error instanceof UploadSessionTerminalError)) throw error;
    const terminal = error.session;
    if (terminal.status === 'failed' && terminal.canRetry) {
      const retry: RetryUploadCompletion = async retrySignal => {
        const retried = await deps.retryUploadSession(terminal.id, { signal: retrySignal });
        const asset = await waitForUploadCompletionWithRecovery(
          retried, deps, persistenceRef, onProgress, retrySignal,
        );
        clearPersistedUpload(persistenceRef);
        return asset;
      };
      throw new AssetUploadError('complete', '素材校验或保存暂时失败，可重试后台处理。', {
        technicalMessage: terminal.error?.message ?? error.message,
        retryCompletion: retry,
      });
    }

    clearPersistedUpload(persistenceRef);
    const message = terminal.status === 'completed'
      ? '上传处理已结束，但素材不可用，请重新上传。'
      : terminal.status === 'canceled'
      ? '上传会话已取消，可重新上传。'
      : terminal.status === 'expired'
        ? '上传会话已过期，请重新上传。'
        : '文件校验未通过，请修正文件后重新上传。';
    throw new AssetUploadError('complete', message, {
      technicalMessage: terminal.error?.message ?? error.message,
    });
  }
}

function emitSessionProgress(
  session: Awaited<ReturnType<typeof mutations.getUploadSession>>,
  onProgress?: (event: UploadProgressEvent) => void,
) {
  const phase = session.processingStage === 'sealing'
    ? 'sealing'
    : session.processingStage === 'validating'
      ? 'validating'
      : session.processingStage === 'probing'
        ? 'probing'
        : session.processingStage === 'thumbnailing'
          ? 'thumbnailing'
          : session.processingStage === 'persisting' || session.processingStage === 'completed'
            ? 'persisting'
            : 'completing';
  onProgress?.({ phase, progress: session.progress });
}

export function uploadObjectWithProgress(
  signature: UploadSignature,
  file: File,
  onProgress?: (progress: number) => void,
  options: { signal?: AbortSignal; timeoutMs?: number; idleTimeoutMs?: number } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(signature.method, signature.uploadUrl, true);
    xhr.timeout = options.timeoutMs ?? 60 * 60_000;
    const idleTimeoutMs = options.idleTimeoutMs ?? 45_000;
    let idleTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let idleTimedOut = false;
    const resetIdleTimer = () => {
      if (idleTimer !== undefined) globalThis.clearTimeout(idleTimer);
      idleTimer = globalThis.setTimeout(() => {
        idleTimedOut = true;
        xhr.abort();
      }, idleTimeoutMs);
    };

    let body: File | FormData = file;
    if (signature.method === 'POST') {
      const formData = new FormData();
      Object.entries(signature.fields).forEach(([key, value]) => {
        if (key.toLowerCase() === 'file') {
          throw new AssetUploadError('storage', '上传通道返回了无效的表单字段。', {
            technicalMessage: 'Reserved TOS POST field: file',
          });
        }
        formData.append(key, value);
      });
      formData.append('file', file, file.name);
      body = formData;
    } else {
      Object.entries(signature.headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });
    }

    xhr.upload.onprogress = event => {
      resetIdleTimer();
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress?.(event.loaded / event.total);
    };

    const cleanup = () => {
      if (idleTimer !== undefined) globalThis.clearTimeout(idleTimer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => xhr.abort();

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      if (isImmutableUploadReplay(signature, xhr.status)) {
        // 不可覆盖直传可能已成功，仅是首次响应丢失。继续 complete
        // 让服务端核对稳定 session、大小与真实媒体，不再尝试覆盖对象。
        onProgress?.(1);
        resolve();
        return;
      }

      reject(new AssetUploadError('storage', getStorageStatusMessage(xhr.status), {
        status: xhr.status,
        technicalMessage: xhr.responseText || xhr.statusText || `HTTP ${xhr.status}`,
      }));
    };

    xhr.onerror = () => {
      cleanup();
      reject(new AssetUploadError('storage', '上传通道连接失败，可能是网络或对象存储跨域配置问题。', {
        technicalMessage: 'XMLHttpRequest network error',
      }));
    };

    xhr.ontimeout = () => {
      cleanup();
      reject(new AssetUploadError('storage', '上传超时，请检查网络后重试。', {
        technicalMessage: 'XMLHttpRequest timeout',
      }));
    };

    xhr.onabort = () => {
      cleanup();
      if (idleTimedOut) {
        reject(new AssetUploadError('storage', '上传长时间没有进度，请检查网络后重试。', {
          technicalMessage: `No upload progress for ${idleTimeoutMs}ms`,
        }));
      } else {
        reject(createAbortError());
      }
    };
    if (options.signal?.aborted) {
      reject(options.signal.reason ?? createAbortError());
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    resetIdleTimer();
    xhr.send(body);
  });
}

function isImmutableUploadReplay(signature: UploadSignature, status: number) {
  if (status !== 409 && status !== 412) return false;
  if (signature.driver === 'local') return true;
  return Object.entries(signature.fields).some(([key, value]) => (
    key.toLowerCase() === 'x-tos-forbid-overwrite' && value.trim().toLowerCase() === 'true'
  ));
}

export function getUploadSource(file: File): Extract<AssetSource, 'uploaded-video' | 'uploaded-image' | 'uploaded-audio'> | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'mp3' || extension === 'wav') return 'uploaded-audio';
  if (file.type.startsWith('audio/')) return null;
  if (file.type.startsWith('video/')) return 'uploaded-video';
  if (file.type.startsWith('image/')) return 'uploaded-image';
  if (['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'].includes(extension)) return 'uploaded-video';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'heic'].includes(extension)) return 'uploaded-image';
  return null;
}

export function formatUploadError(error: unknown) {
  const uploadError = error as Partial<AssetUploadError>;
  if (typeof uploadError.userMessage === 'string') {
    return {
      message: uploadError.userMessage,
      technicalMessage: uploadError.technicalMessage ?? uploadError.userMessage,
    };
  }

  const message = getTechnicalMessage(error);
  if (message === 'Failed to fetch' || message.includes('NetworkError')) {
    return {
      message: '上传通道连接失败，可能是网络或对象存储跨域配置问题。',
      technicalMessage: message,
    };
  }

  return {
    message: message || '素材上传失败，请稍后重试。',
    technicalMessage: message || 'Unknown upload error',
  };
}

function normalizeStorageError(error: unknown) {
  if (error instanceof AssetUploadError) return error;

  const formatted = formatUploadError(error);
  return new AssetUploadError('storage', formatted.message, {
    technicalMessage: formatted.technicalMessage,
  });
}

function getStorageStatusMessage(status: number) {
  if (status === 0) return '上传通道连接失败，可能是网络或对象存储跨域配置问题。';
  if (status === 401 || status === 403) return `对象存储拒绝上传（HTTP ${status}），请检查存储权限或签名是否过期。`;
  if (status === 413) return '文件超过对象存储允许的大小，请压缩后重试。';
  if (status >= 500) return `对象存储服务暂时不可用（HTTP ${status}），请稍后重试。`;
  return `对象存储上传失败（HTTP ${status}），请稍后重试。`;
}

async function retryStage<T>(task: () => Promise<T>, maxAttempts: number, signal?: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) throw signal.reason ?? createAbortError();
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      const retryableStatus = status === undefined || status === 408 || status === 429 || status >= 500;
      if (attempt >= maxAttempts || !retryableStatus || signal?.aborted) throw error;
    }
  }
  throw lastError;
}

async function withTimeoutSignal<T>(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
) {
  if (parentSignal?.aborted) throw parentSignal.reason ?? createAbortError();
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason ?? createAbortError());
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeoutError = new DOMException('请求超时', 'TimeoutError');
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = globalThis.setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([task(controller.signal), timeoutPromise]);
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  return Boolean(signal?.aborted) || (error instanceof DOMException && error.name === 'AbortError');
}

function canceledUploadError(stage: UploadFailureStage) {
  return new AssetUploadError(stage, '已停止当前上传并请求服务端取消。', {
    technicalMessage: 'Upload aborted and server cancellation requested',
  });
}

async function cancelSessionBestEffort(sessionId: string, deps: AssetUploadDependencies) {
  try {
    await withTimeoutSignal(undefined, 10_000, signal => deps.cancelUploadSession(sessionId, { signal }));
  } catch {
    // 取消请求失败时不能把未知后台状态伪装成已取消；用户仍可用持久化 session 继续查询。
  }
}

function createAbortError() {
  return new DOMException('上传已取消', 'AbortError');
}

function getTechnicalMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

interface PersistedUpload {
  clientIntentId: string;
  idempotencyKey: string;
  sessionId: string | null;
  pageInstanceId: string;
  updatedAt: number;
}

const uploadPageInstanceId = createUploadIdempotencyKey();
const activePersistedUploadClaims = new Set<string>();
const volatilePersistedUploads = new Map<string, PersistedUpload[]>();

function buildUploadPersistenceKey(file: File, folderId: string | null) {
  const fingerprint = [file.name, file.size, file.type, file.lastModified, folderId ?? ''].join('\u001f');
  return `lindyson:upload:v2:${encodeURIComponent(fingerprint)}`;
}

function buildLegacyUploadPersistenceKey(file: File, folderId: string | null) {
  const fingerprint = [file.name, file.size, file.type, file.lastModified, folderId ?? ''].join('\u001f');
  let hash = 2166136261;
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash ^= fingerprint.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `lindyson:upload:${(hash >>> 0).toString(16)}`;
}

function createUploadIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-upload`;
}

function resolveUploadClientIntent(file: File, explicitIntent?: string) {
  const normalized = explicitIntent?.trim();
  if (normalized) return normalized;

  const pending = pendingClientIntents.get(file);
  const bound = pending?.shift();
  if (pending?.length === 0) pendingClientIntents.delete(file);
  if (bound) return bound;

  const existing = defaultClientIntents.get(file);
  if (existing) return existing;
  const created = createUploadIdempotencyKey();
  defaultClientIntents.set(file, created);
  return created;
}

function claimPersistedUpload(key: string, legacyKey: string, clientIntentId: string): PersistedUpload {
  const current = readPersistedUploads(key);
  let claimed = current.find(item => item.clientIntentId === clientIntentId);

  if (!claimed) {
    claimed = current
      .filter(item => item.pageInstanceId !== uploadPageInstanceId)
      .filter(item => !activePersistedUploadClaims.has(item.idempotencyKey))
      .sort((left, right) => left.updatedAt - right.updatedAt)[0];
  }

  if (!claimed) {
    const legacy = readLegacyPersistedUpload(legacyKey);
    if (legacy) {
      claimed = {
        clientIntentId,
        idempotencyKey: legacy.idempotencyKey,
        sessionId: legacy.sessionId,
        pageInstanceId: uploadPageInstanceId,
        updatedAt: Date.now(),
      };
      removeStorageItem(legacyKey);
    }
  }

  const next: PersistedUpload = claimed
    ? {
        ...claimed,
        clientIntentId,
        pageInstanceId: uploadPageInstanceId,
        updatedAt: Date.now(),
      }
    : {
        clientIntentId,
        idempotencyKey: createUploadIdempotencyKey(),
        sessionId: null,
        pageInstanceId: uploadPageInstanceId,
        updatedAt: Date.now(),
      };

  // 必须先落盘再发起签名 POST；即使响应丢失，重放仍使用同一个幂等键。
  persistUpload(key, next);
  activePersistedUploadClaims.add(next.idempotencyKey);
  return next;
}

function readPersistedUploads(key: string): PersistedUpload[] {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      const records = Array.isArray(parsed) ? parsed.filter(isPersistedUpload) : [];
      volatilePersistedUploads.set(key, records);
      return records;
    }
  } catch {
    // localStorage 不可用时退回页内内存记录，同一 UI 行重试仍保持幂等键。
  }
  return volatilePersistedUploads.get(key) ?? [];
}

function persistUpload(key: string, value: PersistedUpload) {
  const next = [
    ...readPersistedUploads(key).filter(item => (
      item.idempotencyKey !== value.idempotencyKey && item.clientIntentId !== value.clientIntentId
    )),
    value,
  ];
  volatilePersistedUploads.set(key, next);
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(next));
  } catch {
    // 隐私模式或配额不足时继续使用页内内存记录。
  }
}

function clearPersistedUpload(ref: UploadPersistenceRef) {
  const next = readPersistedUploads(ref.key).filter(item => item.idempotencyKey !== ref.idempotencyKey);
  activePersistedUploadClaims.delete(ref.idempotencyKey);
  if (next.length > 0) {
    volatilePersistedUploads.set(ref.key, next);
  } else {
    volatilePersistedUploads.delete(ref.key);
  }
  try {
    if (next.length > 0) globalThis.localStorage?.setItem(ref.key, JSON.stringify(next));
    else globalThis.localStorage?.removeItem(ref.key);
  } catch {
    // 清理失败不会影响服务端幂等性。
  }
}

function releasePersistedUploadClaim(idempotencyKey: string) {
  activePersistedUploadClaims.delete(idempotencyKey);
}

function readLegacyPersistedUpload(key: string): { idempotencyKey: string; sessionId: string } | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { idempotencyKey?: unknown; sessionId?: unknown };
    return typeof parsed.idempotencyKey === 'string' && typeof parsed.sessionId === 'string'
      ? { idempotencyKey: parsed.idempotencyKey, sessionId: parsed.sessionId }
      : null;
  } catch {
    return null;
  }
}

function isPersistedUpload(value: unknown): value is PersistedUpload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedUpload>;
  return typeof candidate.clientIntentId === 'string'
    && typeof candidate.idempotencyKey === 'string'
    && (candidate.sessionId === null || typeof candidate.sessionId === 'string')
    && typeof candidate.pageInstanceId === 'string'
    && typeof candidate.updatedAt === 'number';
}

function removeStorageItem(key: string) {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // 旧记录清理失败不会影响已迁移到 v2 的页内状态。
  }
}

function delay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? createAbortError());
  return new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(signal?.reason ?? createAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
