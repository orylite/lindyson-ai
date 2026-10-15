import { Readable, Transform, pipeline } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { withThumbnailConcurrency } from '../domain/thumbnailConcurrency.js';
import type { SeedanceModelLabel, SeedanceReferenceRole } from '../domain/seedanceModels.js';
import { getSeedanceModelCapability, isSeedanceModelLabel } from '../domain/seedanceModels.js';
import type {
  JobFailureCategory,
  ProviderFailure,
  ProviderResult,
  ProviderSuccess,
  ProviderUsageObservation,
} from '../domain/types.js';
import { createObjectReadUrl, uploadObjectBuffer, uploadObjectStream } from '../storage/storageService.js';
import { createVideoThumbnailBuffer, probeMedia } from '../storage/mediaProcessor.js';
import type { ProviderTaskInput } from './fakeProvider.js';

const providerName = 'volcengine-ark';

type ArkSubmissionDisposition = NonNullable<ProviderFailure['submissionDisposition']>;

interface SeedanceFailureEvidence {
  submissionDisposition?: ArkSubmissionDisposition;
  providerHttpStatus?: number;
  providerErrorCode?: string;
  providerRequestId?: string;
}

class ArkHttpError extends Error {
  readonly status: number;
  readonly providerErrorCode?: string;
  readonly providerRequestId?: string;

  constructor(input: {
    message: string;
    status: number;
    providerErrorCode?: string;
    providerRequestId?: string;
  }) {
    super(input.message);
    this.name = 'ArkHttpError';
    this.status = input.status;
    this.providerErrorCode = input.providerErrorCode;
    this.providerRequestId = input.providerRequestId;
  }
}

export interface ArkTaskStatus {
  id: string;
  status: string;
  videoUrl?: string;
  errorMessage?: string;
  errorCode?: string;
  usage?: ArkTaskUsage;
  terminalAt?: string | null;
}

export interface ArkTaskUsage {
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface ReferenceImageUrlResolverDeps {
  findOwnedObjectKey?: (input: { userId: string; objectKey: string }) => Promise<string | null | undefined>;
  findOwnedObjectKeys?: (input: {
    userId: string;
    objectKeys: string[];
  }) => Promise<ReadonlyMap<string, string>>;
  signObjectReadUrl?: (objectKey: string) => Promise<string>;
  signingConcurrency?: number;
}

type ReferenceAssetKind = 'image' | 'video' | 'audio';

interface ReferenceAssetUrl {
  type: ReferenceAssetKind;
  url: string;
  role?: SeedanceReferenceRole;
}

const referenceUrlSigningConcurrency = 6;

export async function runArkSeedanceProvider(input: ProviderTaskInput): Promise<ProviderResult> {
  if (!env.ARK_API_KEY) {
    return providerFailure('provider-failed', '火山方舟 API Key 未配置，Seedance 任务无法提交。');
  }
  if (input.kind !== 'video' || !isSeedanceModelLabel(input.model)) {
    return providerFailure('provider-failed', '当前模型暂未接入真实供应商。');
  }

  let providerTaskId: string | undefined;
  let providerUsage: ArkTaskUsage | undefined;
  let providerSubmissionStarted = false;

  try {
    const referenceAssetUrls = await resolveReferenceAssetUrls(input);
    const createPayload = buildSeedanceTaskPayload(input, referenceAssetUrls);
    await input.onProviderSubmissionStarted?.();
    providerSubmissionStarted = true;
    const createResponse = await arkJson<Record<string, unknown>>('/contents/generations/tasks', {
      method: 'POST',
      body: JSON.stringify(createPayload),
    });
    providerTaskId = extractTaskId(createResponse);
    if (!providerTaskId) {
      return providerFailure(
        'provider-failed',
        '火山方舟创建接口成功响应中缺少可轮询的任务 ID。',
        undefined,
        undefined,
        { submissionDisposition: 'unknown' },
      );
    }
    await input.onProviderTaskCreated?.(providerTaskId);

    const status = await pollSeedanceTask(providerTaskId, input);
    providerUsage = status.usage;
    await notifyArkSeedanceUsageObserved(input, providerTaskId, status);
    if (status.status === 'expired') {
      return {
        ...buildSeedanceProviderFailure(
          'system-timeout',
          status.errorMessage || 'Seedance 任务已过期。',
          providerTaskId,
          providerUsage,
          status.status,
          { providerErrorCode: status.errorCode },
        ),
        terminal: true,
      };
    }
    if (['failed', 'error', 'cancelled', 'canceled'].includes(status.status)) {
      return {
        ...buildSeedanceProviderFailure(
          classifySeedanceProviderError(status.errorMessage ?? '', status.errorCode),
          status.errorMessage || 'Seedance 任务失败。',
          providerTaskId,
          providerUsage,
          status.status,
          { providerErrorCode: status.errorCode },
        ),
        terminal: true,
      };
    }
    if (!status.videoUrl) {
      return providerFailure(
        'provider-failed',
        status.errorMessage || 'Seedance 任务完成但未返回视频地址。',
        providerTaskId,
        providerUsage,
      );
    }

    return archiveCompletedSeedanceTask(input, providerTaskId, status);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    const causeCode = cause && typeof cause === 'object' ? (cause as { code?: unknown }).code : undefined;
    // 只保留受限格式的错误码，不记录可能包含凭据或签名 URL 的底层错误消息。
    const networkCode = typeof causeCode === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(causeCode)
      ? causeCode : undefined;
    const message = (error instanceof Error ? error.message : 'Seedance 任务执行失败。')
      + (networkCode ? `（网络错误码=${networkCode}）` : '');
    const providerErrorCode = error instanceof ArkHttpError
      ? error.providerErrorCode
      : undefined;
    const evidence: SeedanceFailureEvidence = error instanceof ArkHttpError
      ? {
          submissionDisposition: providerTaskId
            ? 'created'
            : classifyArkSubmissionDisposition(error.status),
          providerHttpStatus: error.status,
          providerErrorCode: error.providerErrorCode,
          providerRequestId: error.providerRequestId,
        }
      : {
          submissionDisposition: providerTaskId
            ? 'created'
            : (providerSubmissionStarted ? 'unknown' : undefined),
    };
    return providerFailure(
      classifySeedanceProviderError(message, providerErrorCode),
      message,
      providerTaskId,
      providerUsage,
      evidence,
    );
  }
}

export async function recoverArkSeedanceTaskResult(
  input: ProviderTaskInput & { providerTaskId: string },
): Promise<ProviderSuccess> {
  if (!env.ARK_API_KEY) {
    throw new Error('火山方舟 API Key 未配置，Seedance 任务无法恢复。');
  }
  if (input.kind !== 'video' || !isSeedanceModelLabel(input.model)) {
    throw new Error('当前任务不是可恢复的 Seedance 视频任务。');
  }

  const status = await readArkSeedanceTask(input.providerTaskId);
  if (!['succeeded', 'success', 'completed', 'done'].includes(status.status)) {
    throw new Error(`方舟任务当前不是成功状态：${status.status}`);
  }
  await notifyArkSeedanceUsageObserved(input, input.providerTaskId, status);
  if (!status.videoUrl) {
    throw new Error('方舟任务已成功但未返回可恢复的视频地址。');
  }

  return archiveCompletedSeedanceTask(input, input.providerTaskId, status);
}

export function buildSeedanceTaskPayload(input: ProviderTaskInput, referenceAssets: Array<string | ReferenceAssetUrl> = []) {
  const model = getArkSeedanceModelId(input.model);
  if (!model) throw new Error('当前模型暂未接入真实供应商。');
  const capability = getSeedanceModelCapability(input.model);
  if (!capability) throw new Error('当前模型暂未接入真实供应商。');

  const content: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }];
  for (const item of referenceAssets) {
    const reference = typeof item === 'string' ? { type: 'image' as const, url: item, role: 'reference_image' as const } : item;
    if (reference.type === 'video') {
      content.push({
        type: 'video_url',
        video_url: { url: reference.url },
        role: reference.role ?? 'reference_video',
      });
    } else if (reference.type === 'audio') {
      content.push({
        type: 'audio_url',
        audio_url: { url: reference.url },
        role: reference.role ?? 'reference_audio',
      });
    } else {
      content.push({
        type: 'image_url',
        image_url: { url: reference.url },
        role: reference.role ?? 'reference_image',
      });
    }
  }

  return {
    model,
    content,
    ratio: normalizeRatio(input.config.aspectRatio),
    duration: normalizeDuration(input.config.durationSeconds ?? input.config.duration),
    resolution: normalizeResolution(input.config.resolution),
    generate_audio: true,
    watermark: false,
    ...(input.model === 'Seedance 2.5' ? { output_format: capability.outputFormat } : {}),
    ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
  };
}

export function getArkSeedanceModelId(model: string) {
  if (!isSeedanceModelLabel(model)) return null;

  const models: Record<SeedanceModelLabel, string> = {
    'Seedance 2.0': env.ARK_SEEDANCE_MODEL,
    'Seedance 2.0 Fast': env.ARK_SEEDANCE_FAST_MODEL,
    'Seedance 2.0 Mini': env.ARK_SEEDANCE_MINI_MODEL,
    'Seedance 2.5': env.ARK_SEEDANCE_25_MODEL,
  };

  return models[model];
}

export async function resolveReferenceImageUrls(
  input: ProviderTaskInput,
  deps: ReferenceImageUrlResolverDeps = {},
) {
  const assets = await resolveReferenceAssetUrls(input, deps);
  return assets.filter(asset => asset.type === 'image').map(asset => asset.url);
}

/**
 * Seedream 新任务只接受创建边界固化的 canonical referenceAssets。这里不读取
 * referenceImages，也不接受 publicUrl/thumbnail 等历史 fallback，且在提交前再次
 * 确认对象仍属于当前用户的活动图片资产。
 */
export async function resolveStrictReferenceImageUrls(
  input: ProviderTaskInput,
  deps: ReferenceImageUrlResolverDeps = {},
) {
  const references = input.config.referenceAssets;
  if (references === undefined) return [];
  if (!Array.isArray(references)) throw unavailableReference();
  const findOwnedObjectKey = deps.findOwnedObjectKey ?? findOwnedImageObjectKey;
  const signObjectReadUrl = deps.signObjectReadUrl ?? createObjectReadUrl;
  const objectKeys = new Set<string>();
  const urls: string[] = [];

  for (const item of references) {
    if (!isRecord(item)
      || firstString(item.type) !== 'image'
      || firstString(item.role) !== 'reference_image') {
      throw unavailableReference();
    }
    const objectKey = firstString(item.objectKey);
    if (!objectKey || objectKeys.has(objectKey)) throw unavailableReference();
    objectKeys.add(objectKey);
    const ownedObjectKey = await findOwnedObjectKey({ userId: input.userId, objectKey });
    if (!ownedObjectKey) throw unavailableReference();
    urls.push(await signObjectReadUrl(ownedObjectKey));
  }
  if (urls.length !== references.length) throw unavailableReference();
  return urls;
}

export async function resolveReferenceAssetUrls(
  input: ProviderTaskInput,
  deps: ReferenceImageUrlResolverDeps = {},
): Promise<ReferenceAssetUrl[]> {
  const referenceAssets = getReferenceAssetRecords(input.config);
  const signObjectReadUrl = deps.signObjectReadUrl ?? createObjectReadUrl;
  const entries: Array<{
    type: ReferenceAssetKind;
    role: SeedanceReferenceRole;
    objectKey: string | null;
    fallbackUrl: string | null;
  }> = [];
  for (const { item, type, role } of referenceAssets) {
    if (!isRecord(item)) continue;
    const objectKey = firstString(item.objectKey);
    if (objectKey) {
      entries.push({ type, role, objectKey, fallbackUrl: null });
      continue;
    }
    const fallbackUrl = getReferenceFallbackUrl(item, type);
    if (fallbackUrl) entries.push({ type, role, objectKey: null, fallbackUrl });
  }
  const requestedObjectKeys = Array.from(new Set(entries.flatMap(entry => entry.objectKey ? [entry.objectKey] : [])));
  const ownedObjectKeys = await resolveOwnedAssetObjectKeys(input.userId, requestedObjectKeys, deps);
  const uniqueOwnedObjectKeys = Array.from(new Set(requestedObjectKeys.map(objectKey => {
    const ownedObjectKey = ownedObjectKeys.get(objectKey);
    if (!ownedObjectKey) throw unavailableAssetReference();
    return ownedObjectKey;
  })));
  const concurrency = normalizeSigningConcurrency(deps.signingConcurrency);
  const signedEntries = await mapWithConcurrency(uniqueOwnedObjectKeys, concurrency, async objectKey => (
    [objectKey, await signObjectReadUrl(objectKey)] as const
  ));
  const signedUrlByObjectKey = new Map(signedEntries);
  const urls: ReferenceAssetUrl[] = entries.map(entry => {
    if (entry.objectKey) {
      const ownedObjectKey = ownedObjectKeys.get(entry.objectKey);
      const url = ownedObjectKey ? signedUrlByObjectKey.get(ownedObjectKey) : null;
      if (!url) throw unavailableAssetReference();
      return { type: entry.type, role: entry.role, url };
    }
    if (!entry.fallbackUrl) throw unavailableAssetReference();
    return { type: entry.type, role: entry.role, url: entry.fallbackUrl };
  });

  const portraitReference = input.config.realPortraitReference;
  if (portraitReference !== undefined) {
    if (input.model === 'Seedance 2.5') {
      throw Object.assign(new Error('Seedance 2.5 暂不支持真人演员'), {
        code: 'REAL_PORTRAIT_MODEL_UNSUPPORTED',
      });
    }
    if (!isRecord(portraitReference)) throw unavailableRealPortraitReference();
    const providerAssetUri = firstString(portraitReference.providerAssetUri);
    if (!providerAssetUri || !/^asset:\/\/[A-Za-z0-9._:-]{1,256}$/.test(providerAssetUri)) {
      throw unavailableRealPortraitReference();
    }
    urls.push({ type: 'image', role: 'reference_image', url: providerAssetUri });
  }

  return urls;
}

async function resolveOwnedAssetObjectKeys(
  userId: string,
  objectKeys: string[],
  deps: ReferenceImageUrlResolverDeps,
) {
  if (objectKeys.length === 0) return new Map<string, string>();
  if (deps.findOwnedObjectKeys) {
    return deps.findOwnedObjectKeys({ userId, objectKeys });
  }
  if (!deps.findOwnedObjectKey) {
    return findOwnedAssetObjectKeys({ userId, objectKeys });
  }

  const entries = await mapWithConcurrency(
    objectKeys,
    normalizeSigningConcurrency(deps.signingConcurrency),
    async objectKey => [
      objectKey,
      await deps.findOwnedObjectKey!({ userId, objectKey }),
    ] as const,
  );
  return new Map(entries.flatMap(([objectKey, ownedObjectKey]) => (
    ownedObjectKey ? [[objectKey, ownedObjectKey] as const] : []
  )));
}

export function extractReferenceImageUrls(config: Record<string, unknown>) {
  const references = getReferenceAssetRecords(config).filter(reference => reference.type === 'image');
  const urls: string[] = [];

  for (const { item, type } of references) {
    if (!isRecord(item)) continue;
    const url = getReferenceFallbackUrl(item, type);
    if (url) urls.push(url);
  }

  return urls;
}

export function extractReferenceAssetUrls(config: Record<string, unknown>) {
  const references = getReferenceAssetRecords(config);
  const urls: ReferenceAssetUrl[] = [];

  for (const { item, type, role } of references) {
    if (!isRecord(item)) continue;
    const url = getReferenceFallbackUrl(item, type);
    if (url) urls.push({ type, role, url });
  }

  return urls;
}

function getReferenceAssetRecords(config: Record<string, unknown>) {
  const mode = firstString(config.mode) === 'first-last' ? 'first-last' : 'general';
  if (Array.isArray(config.referenceAssets)) {
    return config.referenceAssets.map((item, index) => {
      const type = getReferenceAssetType(item);
      return {
        item,
        type,
        role: isRecord(item) ? getReferenceAssetRole(item, type, index, mode) : getDefaultReferenceAssetRole(type, index, mode),
      };
    });
  }

  const legacyImages = Array.isArray(config.referenceImages) ? config.referenceImages : [];
  return legacyImages.map((item, index) => ({
    item,
    type: 'image' as ReferenceAssetKind,
    role: isRecord(item) ? getReferenceAssetRole(item, 'image', index, mode) : getDefaultReferenceAssetRole('image', index, mode),
  }));
}

function getReferenceAssetType(item: unknown): ReferenceAssetKind {
  if (!isRecord(item)) return 'image';
  const type = firstString(item.type);
  if (type === 'video' || type === 'audio') return type;
  return 'image';
}

function getReferenceAssetRole(
  item: Record<string, unknown>,
  type: ReferenceAssetKind,
  index: number,
  mode: 'general' | 'first-last',
): SeedanceReferenceRole {
  const role = firstString(item.role);
  if (
    role === 'reference_image'
    || role === 'reference_video'
    || role === 'reference_audio'
    || role === 'first_frame'
    || role === 'last_frame'
  ) {
    return role;
  }
  return getDefaultReferenceAssetRole(type, index, mode);
}

function getDefaultReferenceAssetRole(type: ReferenceAssetKind, index: number, mode: 'general' | 'first-last'): SeedanceReferenceRole {
  if (mode === 'first-last') return index === 0 ? 'first_frame' : 'last_frame';
  if (type === 'video') return 'reference_video';
  if (type === 'audio') return 'reference_audio';
  return 'reference_image';
}

function getReferenceFallbackUrl(item: Record<string, unknown>, type: ReferenceAssetKind) {
  if (type === 'video' || type === 'audio') return firstHttpUrl(item.publicUrl, item.url);
  return firstHttpUrl(item.publicUrl, item.url, item.thumbnailUrl, item.thumbnail);
}

async function findOwnedAssetObjectKeys(input: { userId: string; objectKeys: string[] }) {
  const result = await pool.query<{ object_key: string }>(
    `SELECT object_key
     FROM assets
     WHERE user_id = $1
       AND object_key = ANY($2::text[])
       AND deletion_status = 'active'`,
    [input.userId, input.objectKeys],
  );
  return new Map(result.rows.map(row => [row.object_key, row.object_key]));
}

async function findOwnedImageObjectKey(input: { userId: string; objectKey: string }) {
  const result = await pool.query<{ object_key: string }>(
    `SELECT object_key
     FROM assets
     WHERE user_id = $1 AND object_key = $2
       AND type = 'image' AND deletion_status = 'active'
     LIMIT 1`,
    [input.userId, input.objectKey],
  );
  return result.rows[0]?.object_key ?? null;
}

function unavailableReference() {
  return Object.assign(
    new Error('参考图片已删除、类型不符或不可访问，请重新选择后再生成'),
    { code: 'REFERENCE_ASSET_UNAVAILABLE' },
  );
}

function unavailableAssetReference() {
  return Object.assign(
    new Error('参考素材已删除或不可访问，请重新选择后再生成'),
    { code: 'REFERENCE_ASSET_UNAVAILABLE' },
  );
}

function unavailableRealPortraitReference() {
  return Object.assign(
    new Error('真人演员素材已失效，请重新选择或完成本人认证'),
    { code: 'REAL_PORTRAIT_REFERENCE_UNAVAILABLE' },
  );
}

export async function readArkSeedanceTask(providerTaskId: string): Promise<ArkTaskStatus> {
  const response = await arkJson<Record<string, unknown>>(`/contents/generations/tasks/${providerTaskId}`, {
    method: 'GET',
  });

  return normalizeArkTaskStatus(providerTaskId, response);
}

/**
 * 官方 DELETE 接口只保证 queued 任务可被取消。失败或 running 不代表任务失败，
 * 调用方仍必须继续 GET 查证终态，不能据此释放积分。
 */
export async function tryRequestArkSeedanceTaskCancellation(providerTaskId: string) {
  try {
    await arkJson<Record<string, unknown>>(`/contents/generations/tasks/${providerTaskId}`, {
      method: 'DELETE',
    });
    return true;
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'seedance-cancel-request-failed',
      providerTaskId,
      errorCode: safeProviderLogErrorCode(error),
      action: 'continue-polling',
    }));
    return false;
  }
}

async function pollSeedanceTask(
  providerTaskId: string,
  input: Pick<ProviderTaskInput, 'onHeartbeat' | 'isCancellationRequested'>,
): Promise<ArkTaskStatus> {
  const startedAt = Date.now();
  let cancellationAttempted = false;

  while (Date.now() - startedAt < env.ARK_TASK_TIMEOUT_MS) {
    await input.onHeartbeat?.();
    if (!cancellationAttempted && await input.isCancellationRequested?.()) {
      cancellationAttempted = true;
      await tryRequestArkSeedanceTaskCancellation(providerTaskId);
    }
    const task = await readArkSeedanceTask(providerTaskId);

    if (['succeeded', 'success', 'completed', 'done'].includes(task.status)) {
      return task;
    }
    if (task.status === 'expired' || ['failed', 'error', 'cancelled', 'canceled'].includes(task.status)) return task;

    await delay(env.ARK_POLL_INTERVAL_MS);
  }

  throw new Error('Seedance 任务轮询超时。');
}

function normalizeArkTaskStatus(providerTaskId: string, response: Record<string, unknown>): ArkTaskStatus {
  return {
    id: providerTaskId,
    status: normalizeStatus(extractString(response, ['status', 'data.status', 'task.status'])),
    videoUrl: extractSeedanceVideoUrl(response),
    errorMessage: extractString(response, [
      'error.message',
      'message',
      'data.error.message',
      'data.message',
    ]),
    errorCode: normalizeProviderEvidence(extractString(response, [
      'error.code',
      'code',
      'data.error.code',
      'data.code',
    ])),
    usage: extractSeedanceUsage(response),
    terminalAt: normalizeOptionalDateTime(extractString(response, [
      'completed_at',
      'completedAt',
      'data.completed_at',
      'data.completedAt',
      'updated_at',
      'updatedAt',
      'data.updated_at',
      'data.updatedAt',
    ])),
  };
}

async function archiveCompletedSeedanceTask(
  input: ProviderTaskInput,
  providerTaskId: string,
  status: ArkTaskStatus,
): Promise<ProviderSuccess> {
  if (!status.videoUrl) {
    throw new Error(status.errorMessage || 'Seedance 任务完成但未返回视频地址。');
  }

  const objectKey = requirePersistedProviderObjectKey(input.outputObjectKey, '成片');
  const uploadedVideo = await archiveVideoToStorage({
    sourceUrl: status.videoUrl,
    objectKey,
  });

  const uploadedVideoReadUrl = await createObjectReadUrl(objectKey);
  const metadata = await safeProbe([status.videoUrl, uploadedVideoReadUrl], input);
  const thumbnailKey = requirePersistedProviderObjectKey(input.thumbnailObjectKey, '缩略图');
  const thumbnail = await buildAndUploadThumbnail({
    sourceUrls: [status.videoUrl, uploadedVideoReadUrl],
    thumbnailKey,
  });
  const units = seedanceUsageToProviderUnits(status.usage);

  return {
    ok: true,
    provider: providerName,
    providerTaskId,
    objectKey,
    thumbnailKey: thumbnail?.objectKey ?? null,
    publicUrl: uploadedVideo.publicUrl,
    thumbnailUrl: thumbnail?.publicUrl ?? null,
    sizeBytes: uploadedVideo.sizeBytes,
    width: metadata.width,
    height: metadata.height,
    durationSeconds: metadata.durationSeconds,
    durationSource: metadata.durationSource,
    rawUnits: units.rawUnits,
    deductedUnits: units.deductedUnits,
    completionTokens: units.completionTokens,
    totalTokens: units.totalTokens,
    billableTokens: units.billableTokens,
    billableBasis: units.billableBasis,
    providerTerminalAt: status.terminalAt ?? null,
    usageObservedAt: new Date().toISOString(),
    usageUnit: 'tokens',
  };
}

async function arkJson<T>(pathname: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${env.ARK_API_KEY}`);
  headers.set('content-type', 'application/json');

  // 超时覆盖到响应体读完为止：响应头到达后连接停滞，也会在 ARK_DOWNLOAD_TIMEOUT_MS 内中止。
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ARK_DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${env.ARK_BASE_URL.replace(/\/$/, '')}${pathname}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    text = await response.text();
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw buildArkHttpError(response, text);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

function requirePersistedProviderObjectKey(value: string | undefined, label: string) {
  const objectKey = value?.trim();
  if (objectKey) return objectKey;
  throw Object.assign(new Error(`生成 provider run 缺少预先持久化的${label}对象 key`), {
    code: 'GENERATION_OBJECT_KEY_MISSING',
  });
}

const SEEDANCE_ARCHIVE_MAX_ATTEMPTS = 3;
const SEEDANCE_ARCHIVE_RETRY_DELAY_MS = 2_000;

export interface VideoArchiveOptions {
  headersTimeoutMs: number;
  stallTimeoutMs: number;
  totalTimeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  upload: typeof uploadObjectStream;
}

function defaultVideoArchiveOptions(): VideoArchiveOptions {
  return {
    headersTimeoutMs: env.ARK_DOWNLOAD_TIMEOUT_MS,
    stallTimeoutMs: env.ARK_ARCHIVE_STALL_TIMEOUT_MS,
    totalTimeoutMs: env.ARK_ARCHIVE_TOTAL_TIMEOUT_MS,
    maxAttempts: SEEDANCE_ARCHIVE_MAX_ATTEMPTS,
    retryDelayMs: SEEDANCE_ARCHIVE_RETRY_DELAY_MS,
    upload: uploadObjectStream,
  };
}

type VideoArchiveAttempt =
  | { ok: true; uploaded: Awaited<ReturnType<typeof uploadObjectStream>> }
  | { ok: false; retryable: boolean; error: unknown };

/**
 * 下载 Seedance 成片并归档到对象存储。方舟成片地址在国内，跨境下载偶尔会长时间停滞或中途断开，
 * 因此等待响应头、两次收到数据之间、整个下载过程分别限时。成片完整读完之前出的错都从头重试；
 * 读完之后才开始上传，上传失败不重试（对象不可覆盖写入，重试可能撞上已写入的对象）。
 */
export async function archiveVideoToStorage(
  input: { sourceUrl: string; objectKey: string },
  options: VideoArchiveOptions = defaultVideoArchiveOptions(),
) {
  let lastError: unknown;
  let attempts = 0;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    attempts = attempt;
    const result = await archiveVideoAttempt(input, options);
    if (result.ok) return result.uploaded;
    lastError = result.error;
    if (!result.retryable || attempt === options.maxAttempts) break;
    await delay(options.retryDelayMs * attempt);
  }
  if (attempts <= 1) throw lastError;
  const message = lastError instanceof Error ? lastError.message : '下载 Seedance 成片失败。';
  throw new Error(`${message}（已尝试 ${attempts} 次）`, { cause: lastError });
}

async function archiveVideoAttempt(
  input: { sourceUrl: string; objectKey: string },
  options: VideoArchiveOptions,
): Promise<VideoArchiveAttempt> {
  const controller = new AbortController();
  const abortWith = (message: string) => controller.abort(new Error(message));
  const totalTimer = setTimeout(
    () => abortWith(`下载 Seedance 成片超时（${options.totalTimeoutMs}ms 内未完成）`),
    options.totalTimeoutMs,
  );
  let stallTimer = setTimeout(
    () => abortWith(`下载 Seedance 成片超时（${options.headersTimeoutMs}ms 内未收到响应）`),
    options.headersTimeoutMs,
  );
  const restartStallTimer = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(
      () => abortWith(`下载 Seedance 成片超时（${options.stallTimeoutMs}ms 未收到数据）`),
      options.stallTimeoutMs,
    );
  };
  const abortReasonOr = (error: unknown) => (controller.signal.aborted ? controller.signal.reason : error);
  let downloadComplete = false;

  try {
    let response: Response;
    try {
      response = await fetch(input.sourceUrl, { method: 'GET', signal: controller.signal });
    } catch (error) {
      return { ok: false, retryable: true, error: abortReasonOr(error) };
    }
    if (!response.ok) {
      // 5xx 和 429 多为临时故障；其余 4xx（如签名链接过期）重试也不会成功。
      return {
        ok: false,
        retryable: response.status >= 500 || response.status === 429,
        error: new Error(`下载 Seedance 成片失败：HTTP ${response.status}`),
      };
    }
    if (!response.body) {
      return { ok: false, retryable: true, error: new Error('下载 Seedance 成片失败：响应体为空。') };
    }

    const contentLength = parsePositiveInteger(response.headers.get('content-length'));
    const contentType = normalizeContentType(response.headers.get('content-type'), 'video/mp4');
    let receivedBytes = 0;
    restartStallTimer();
    const watchdog = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length;
        restartStallTimer();
        callback(null, chunk);
      },
      flush(callback) {
        clearTimeout(stallTimer);
        // 连接被提前关闭时流也会正常结束，需要按 Content-Length 判断是否下载完整。
        if (contentLength !== undefined && receivedBytes !== contentLength) {
          callback(new Error(`下载 Seedance 成片不完整：收到 ${receivedBytes} / ${contentLength} 字节`));
          return;
        }
        downloadComplete = true;
        callback();
      },
    });
    const body = pipeline(Readable.fromWeb(response.body), watchdog, () => undefined);

    try {
      const uploaded = await options.upload({
        objectKey: input.objectKey,
        body,
        contentType,
        contentLength,
      });
      return { ok: true, uploaded };
    } catch (error) {
      return { ok: false, retryable: !downloadComplete, error: abortReasonOr(error) };
    }
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(stallTimer);
  }
}

async function buildAndUploadThumbnail(input: {
  sourceUrls: string[];
  thumbnailKey: string;
}) {
  return withThumbnailConcurrency('video', async () => {
    for (const [sourceIndex, sourceUrl] of input.sourceUrls.entries()) {
      try {
        const body = await createVideoThumbnailBuffer(sourceUrl);
        if (body.length === 0) throw new Error('ffmpeg 未输出缩略图。');

        return uploadObjectBuffer({
          objectKey: input.thumbnailKey,
          body,
          contentType: 'image/jpeg',
        });
      } catch (error) {
        console.warn(JSON.stringify({
          event: 'seedance-thumbnail-attempt-failed',
          sourceIndex,
          errorCode: safeProviderLogErrorCode(error),
          action: 'try-next-source',
        }));
      }
    }

    console.warn('Seedance 缩略图生成失败，将以无缩略图状态保存成片。');
    return null;
  });
}

async function safeProbe(urls: string[], input: ProviderTaskInput) {
  for (const [sourceIndex, url] of urls.entries()) {
    try {
      const metadata = await probeMedia(url);
      const fallback = metadata.width && metadata.height
        ? null
        : inferSeedanceFallbackDimensions(input.config);
      return {
        width: metadata.width ?? fallback!.width,
        height: metadata.height ?? fallback!.height,
        durationSeconds: metadata.durationSeconds ?? normalizeDuration(input.config.durationSeconds ?? input.config.duration),
        durationSource: metadata.durationSeconds === null || metadata.durationSeconds === undefined
          ? 'planned-fallback' as const
          : 'media-probe' as const,
      };
    } catch (error) {
      console.warn(JSON.stringify({
        event: 'seedance-probe-attempt-failed',
        sourceIndex,
        errorCode: safeProviderLogErrorCode(error),
        action: 'try-next-source',
      }));
    }
  }

  const fallback = inferSeedanceFallbackDimensions(input.config);
  return {
    ...fallback,
    durationSeconds: normalizeDuration(input.config.durationSeconds ?? input.config.duration),
    durationSource: 'planned-fallback' as const,
  };
}

function parsePositiveInteger(value: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function safeProviderLogErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const raw = (error as { code?: unknown }).code;
  if (typeof raw === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(raw)) return raw;
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z0-9_.-]{1,100}$/.test(name) ? name : 'UNKNOWN';
}

function normalizeContentType(value: string | null, fallback: string) {
  const contentType = value?.split(';')[0]?.trim();
  if (contentType) return contentType;
  return fallback;
}

export function extractSeedanceVideoUrl(response: Record<string, unknown>) {
  return extractString(response, [
    'content.video_url',
    'content.videoUrl',
    'data.content.video_url',
    'data.content.videoUrl',
    'result.video_url',
    'result.videoUrl',
    'data.result.video_url',
    'data.result.videoUrl',
    'output.video_url',
    'output.videoUrl',
    'video_url',
    'videoUrl',
  ]) ?? findNestedVideoUrl(response);
}

export function extractSeedanceUsage(response: Record<string, unknown>): ArkTaskUsage {
  const completionTokens = extractNumber(response, [
    'usage.completion_tokens',
    'usage.completionTokens',
    'data.usage.completion_tokens',
    'data.usage.completionTokens',
    'result.usage.completion_tokens',
    'result.usage.completionTokens',
  ]);
  const totalTokens = extractNumber(response, [
    'usage.total_tokens',
    'usage.totalTokens',
    'data.usage.total_tokens',
    'data.usage.totalTokens',
    'result.usage.total_tokens',
    'result.usage.totalTokens',
  ]);

  return { completionTokens, totalTokens };
}

function extractTaskId(response: Record<string, unknown>) {
  return extractString(response, ['id', 'task_id', 'taskId', 'data.id', 'data.task_id', 'data.taskId']);
}

export function seedanceUsageToProviderUnits(usage?: ArkTaskUsage | null) {
  const completionTokens = usage?.completionTokens ?? null;
  const totalTokens = usage?.totalTokens ?? null;
  return {
    rawUnits: completionTokens,
    deductedUnits: totalTokens,
    completionTokens,
    totalTokens,
    billableTokens: completionTokens,
    billableBasis: completionTokens === null ? null : 'completion_tokens' as const,
  };
}

export function buildSeedanceProviderFailure(
  category: JobFailureCategory,
  reason: string,
  providerTaskId?: string,
  usage?: ArkTaskUsage | null,
  providerStatus?: string,
  evidence: SeedanceFailureEvidence = {},
): ProviderFailure {
  const units = seedanceUsageToProviderUnits(usage);
  const hasBillableUsage = (units.completionTokens ?? 0) > 0 || (units.totalTokens ?? 0) > 0;
  const submissionRejected = evidence.submissionDisposition === 'not-created' && !hasBillableUsage;
  const normalizedProviderStatus = normalizeStatus(submissionRejected ? 'not-created' : providerStatus);
  const billingDisposition = hasBillableUsage
    ? 'billable' as const
    : (submissionRejected || ['cancelled', 'canceled'].includes(normalizedProviderStatus)
        ? 'unbilled' as const
        : 'unknown' as const);

  return {
    ok: false,
    provider: providerName,
    providerTaskId,
    category,
    reason: appendProviderErrorCode(reason, evidence.providerErrorCode),
    rawUnits: units.rawUnits,
    deductedUnits: units.deductedUnits,
    completionTokens: units.completionTokens,
    totalTokens: units.totalTokens,
    billableTokens: units.billableTokens,
    billableBasis: units.billableBasis,
    usageUnit: 'tokens',
    providerStatus: normalizedProviderStatus,
    billingDisposition,
    ...evidence,
  };
}

export async function notifyArkSeedanceUsageObserved(
  input: ProviderTaskInput,
  providerTaskId: string,
  status: ArkTaskStatus,
) {
  if (!input.onProviderUsageObserved) return;
  const success = ['succeeded', 'success', 'completed', 'done'].includes(status.status);
  const units = seedanceUsageToProviderUnits(status.usage);
  const observation: ProviderUsageObservation = {
    provider: providerName,
    providerTaskId,
    status: success ? 'success' : 'failed',
    error: success
      ? null
      : appendProviderErrorCode(
          status.errorMessage ?? `Seedance 任务终态：${status.status}`,
          status.errorCode,
        ),
    completionTokens: units.completionTokens,
    totalTokens: units.totalTokens,
    billableTokens: units.billableTokens,
    billableBasis: units.billableBasis,
    providerTerminalAt: status.terminalAt ?? null,
    usageObservedAt: new Date().toISOString(),
  };
  await input.onProviderUsageObserved(observation);
}

function providerFailure(
  category: JobFailureCategory,
  reason: string,
  providerTaskId?: string,
  usage?: ArkTaskUsage | null,
  evidence?: SeedanceFailureEvidence,
): ProviderResult {
  return buildSeedanceProviderFailure(category, reason, providerTaskId, usage, undefined, evidence);
}

/**
 * 4xx 通常是创建请求被权威拒绝，但 408、425 和代理常用的 499 不能证明上游
 * 没有创建任务。所有 5xx、网络中断和超时也必须保守地视为结果未知。
 */
export function classifyArkSubmissionDisposition(status: number): ArkSubmissionDisposition {
  if (status >= 400 && status < 500 && ![408, 425, 499].includes(status)) return 'not-created';
  return 'unknown';
}

export function classifySeedanceProviderError(
  message: string,
  providerErrorCode?: string,
): JobFailureCategory {
  if (/SensitiveContentDetected(?:\.[A-Za-z0-9_-]+)*$/i.test(providerErrorCode ?? '')) return 'content-policy';
  if (/超时|过期|timeout|timed out|expired/i.test(message)) return 'system-timeout';
  if (/违规|安全|审核|敏感|sensitive\s+(?:content|information)|content\s+moderation|policy|violation|blocked|real\s+person|privacy\s+information|copyright\s+restrictions?/i.test(message)) {
    return 'content-policy';
  }
  return 'provider-failed';
}

function appendProviderErrorCode(reason: string, providerErrorCode?: string) {
  const code = providerErrorCode?.trim();
  if (!code || reason.includes(code)) return reason;
  return `${reason}（code=${code}）`;
}

function normalizeStatus(status: string | undefined) {
  return (status ?? 'unknown').trim().toLowerCase();
}

function normalizeOptionalDateTime(value: string | undefined) {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function normalizeRatio(value: unknown) {
  if (value === '16:9' || value === '9:16' || value === '1:1' || value === '4:3' || value === '3:4' || value === 'adaptive') {
    return value;
  }
  return '9:16';
}

function normalizeResolution(value: unknown) {
  if (value === '480p' || value === '720p' || value === '1080p') return value;
  return '720p';
}

function normalizeDuration(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

export function inferSeedanceFallbackDimensions(config: Record<string, unknown>) {
  const value = config.aspectRatio;
  if (value === '16:9') return { width: 1280, height: 720 };
  if (value === '1:1') return { width: 1080, height: 1080 };
  if (value === '4:3') return { width: 960, height: 720 };
  if (value === '3:4') return { width: 720, height: 960 };
  if (value === 'adaptive') {
    const references = Array.isArray(config.referenceAssets) ? config.referenceAssets : [];
    const firstFrame = references.find(reference => isRecord(reference) && firstString(reference.role) === 'first_frame');
    if (isRecord(firstFrame)) {
      const width = normalizePositiveInteger(firstFrame.width);
      const height = normalizePositiveInteger(firstFrame.height);
      if (width && height) return { width, height };
    }
    throw Object.assign(new Error('自适应视频缺少首帧尺寸信息，无法安全写入输出元数据'), {
      code: 'SEEDANCE_ADAPTIVE_METADATA_MISSING',
    });
  }
  return { width: 1080, height: 1920 };
}

function normalizePositiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeSigningConcurrency(value: number | undefined) {
  if (!Number.isSafeInteger(value) || (value ?? 0) <= 0) return referenceUrlSigningConcurrency;
  return Math.min(value!, 12);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>,
) {
  if (items.length === 0) return [] as R[];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await run(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function extractApiError(text: string) {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return extractString(parsed, ['error.message', 'message', 'data.message']);
  } catch {
    return text.slice(0, 500);
  }
}

function buildArkHttpError(response: Response, text: string) {
  const parsed = parseJsonRecord(text);
  const providerErrorCode = normalizeProviderEvidence(extractString(parsed, [
    'error.code',
    'code',
    'data.error.code',
    'data.code',
  ]));
  const providerRequestId = normalizeProviderEvidence(firstString(
    response.headers.get('x-request-id'),
    response.headers.get('x-tt-logid'),
    response.headers.get('x-bce-request-id'),
    extractString(parsed, [
      'request_id',
      'requestId',
      'error.request_id',
      'error.requestId',
      'data.request_id',
      'data.requestId',
      'ResponseMetadata.RequestId',
    ]),
  ));
  const evidence = [
    `HTTP ${response.status}`,
    providerErrorCode ? `code=${providerErrorCode}` : null,
    providerRequestId ? `requestId=${providerRequestId}` : null,
  ].filter((item): item is string => Boolean(item));
  const providerMessage = extractApiError(text) || '火山方舟请求失败';

  return new ArkHttpError({
    message: `${providerMessage}（${evidence.join('，')}）`,
    status: response.status,
    providerErrorCode,
    providerRequestId,
  });
}

function parseJsonRecord(text: string) {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeProviderEvidence(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9_.:/-]{1,200}$/.test(normalized) ? normalized : undefined;
}

function extractString(source: Record<string, unknown>, paths: string[]) {
  for (const keyPath of paths) {
    const value = getByPath(source, keyPath);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function extractNumber(source: Record<string, unknown>, paths: string[]) {
  for (const keyPath of paths) {
    const value = getByPath(source, keyPath);
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function getByPath(source: Record<string, unknown>, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((value, key) => {
    if (!isRecord(value)) return undefined;
    return value[key];
  }, source);
}

function findNestedVideoUrl(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findNestedVideoUrl(item);
      if (nested) return nested;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  const direct = firstHttpUrl(value.video_url, value.videoUrl);
  if (direct) return direct;

  for (const key of ['video_url', 'videoUrl']) {
    const child = value[key];
    if (isRecord(child)) {
      const childUrl = firstHttpUrl(child.url, child.URL);
      if (childUrl) return childUrl;
    }
  }

  if (typeof value.type === 'string' && /video/i.test(value.type)) {
    const typedUrl = firstHttpUrl(value.url, value.URL);
    if (typedUrl) return typedUrl;
  }

  for (const child of Object.values(value)) {
    const nested = findNestedVideoUrl(child);
    if (nested) return nested;
  }
  return undefined;
}

function firstHttpUrl(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  }
  return undefined;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
