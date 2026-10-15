import { env } from '../config/env.js';
import { buildPublicUrl, uploadObjectBuffer } from '../storage/storageService.js';
import type {
  ProviderResponseCheckpointInput,
  ProviderResult,
  ProviderUsageObservation,
} from '../domain/types.js';

export interface ProviderTaskInput {
  taskId: string;
  userId: string;
  kind: 'video' | 'image';
  model: string;
  prompt: string;
  config: Record<string, unknown>;
  credits: number;
  attempt?: number;
  /** 由 generation_provider_runs 预先固定，供应商重放不得重新计算对象路径。 */
  outputObjectKey?: string;
  thumbnailObjectKey?: string;
  stagingObjectKey?: string;
  callbackUrl?: string;
  providerRequestId?: string | null;
  providerResponseCheckpoint?: Record<string, unknown> | null;
  providerResponseUrl?: string | null;
  providerResponseObservedAt?: string | null;
  providerResponseUrlExpiresAt?: string | null;
  /** 只在真正发起供应商创建请求前触发。 */
  onProviderSubmissionStarted?: () => Promise<void>;
  onProviderTaskCreated?: (providerTaskId: string) => Promise<void>;
  onProviderResponseCheckpoint?: (checkpoint: ProviderResponseCheckpointInput) => Promise<void>;
  onProviderUsageObserved?: (usage: ProviderUsageObservation) => Promise<void>;
  onHeartbeat?: () => Promise<void>;
  /** 供应商任务已创建后读取当前 claim 的取消请求。 */
  isCancellationRequested?: () => Promise<boolean>;
}

export async function runFakeProvider(input: ProviderTaskInput): Promise<ProviderResult> {
  await input.onProviderSubmissionStarted?.();
  // 同一业务 task 的每次管理员重试，在真实供应商侧都会创建新的任务标识。
  // attempt 0 保留原格式以兼容既有恢复测试，后续 attempt 必须避免命中跨 run 唯一约束。
  const providerTaskId = input.attempt && input.attempt > 0
    ? `fake-${input.taskId}-attempt-${input.attempt}`
    : `fake-${input.taskId}`;
  await input.onProviderTaskCreated?.(providerTaskId);
  if (env.FAKE_PROVIDER_DELAY_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, env.FAKE_PROVIDER_DELAY_MS));
  }
  await input.onHeartbeat?.();
  if (input.prompt.includes('违规')) {
    return {
      ok: false,
      provider: 'fake-provider',
      providerTaskId,
      category: 'content-policy',
      reason: '供应商判定内容违规，任务生成失败。',
      rawUnits: 0,
      deductedUnits: 0,
      completionTokens: null,
      totalTokens: null,
      billableTokens: null,
      billableBasis: null,
      usageUnit: 'credits',
      terminal: true,
      providerStatus: 'failed',
      billingDisposition: 'unbilled',
    };
  }

  if (input.prompt.includes('超时')) {
    return {
      ok: false,
      provider: 'fake-provider',
      providerTaskId,
      category: 'system-timeout',
      reason: '供应商处理超时，任务生成失败。',
      rawUnits: 0,
      deductedUnits: 0,
      completionTokens: null,
      totalTokens: null,
      billableTokens: null,
      billableBasis: null,
      usageUnit: 'credits',
      terminal: true,
      providerStatus: 'expired',
      billingDisposition: 'unbilled',
    };
  }

  if (input.prompt.includes('失败')) {
    return {
      ok: false,
      provider: 'fake-provider',
      providerTaskId,
      category: 'provider-failed',
      reason: '供应商返回失败。',
      rawUnits: 0,
      deductedUnits: 0,
      completionTokens: null,
      totalTokens: null,
      billableTokens: null,
      billableBasis: null,
      usageUnit: 'credits',
      terminal: true,
      providerStatus: 'failed',
      billingDisposition: 'unbilled',
    };
  }

  const objectKey = requirePersistedObjectKey(input.outputObjectKey, '成片');
  const thumbnailKey = requirePersistedObjectKey(input.thumbnailObjectKey, '缩略图');
  const width = input.kind === 'video' && input.config.aspectRatio === '16:9' ? 1280 : 1080;
  const height = input.kind === 'video' && input.config.aspectRatio === '16:9' ? 720 : 1920;

  const body = input.kind === 'image'
    ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    : Buffer.from(`LINDYSON_FAKE_MP4:${input.taskId}\n`, 'utf8');
  const thumbnailBody = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  await uploadObjectBuffer({
    objectKey,
    body,
    contentType: input.kind === 'video' ? 'video/mp4' : 'image/png',
  });
  // 图片缩略图统一由 generation worker 从已归档原图生成 512px WebP。
  // Fake provider 只为视频写入其本身能够确定格式的 JPEG，避免把伪 JPEG 写入 .webp key。
  if (input.kind === 'video') {
    await uploadObjectBuffer({ objectKey: thumbnailKey, body: thumbnailBody, contentType: 'image/jpeg' });
  }

  return {
    ok: true,
    provider: 'fake-provider',
    providerTaskId,
    objectKey,
    thumbnailKey: input.kind === 'video' ? thumbnailKey : null,
    publicUrl: buildPublicUrl(objectKey),
    thumbnailUrl: input.kind === 'video' ? buildPublicUrl(thumbnailKey) : null,
    sizeBytes: body.length,
    width,
    height,
    durationSeconds: input.kind === 'video' ? Number(input.config.durationSeconds ?? input.config.duration ?? 5) : null,
    durationSource: input.kind === 'video' ? 'planned-fallback' : null,
    rawUnits: input.credits,
    deductedUnits: input.credits,
    completionTokens: null,
    totalTokens: null,
    billableTokens: null,
    billableBasis: null,
    usageUnit: 'credits',
  };
}

function requirePersistedObjectKey(value: string | undefined, label: string) {
  const objectKey = value?.trim();
  if (objectKey) return objectKey;
  throw Object.assign(new Error(`生成 provider run 缺少预先持久化的${label}对象 key`), {
    code: 'GENERATION_OBJECT_KEY_MISSING',
  });
}
