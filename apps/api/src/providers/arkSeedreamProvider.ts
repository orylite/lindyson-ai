import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ipaddr from 'ipaddr.js';
import { env } from '../config/env.js';
import { compileSeedreamPrompt, isSeedreamModelLabel } from '../domain/seedreamModels.js';
import { SEEDREAM_5_PRO_MODEL_ID } from '../domain/seedreamListPrice.js';
import type { ProviderFailure, ProviderResult } from '../domain/types.js';
import {
  buildPublicUrl,
  copyStoredObject,
  deleteObject,
  getStoredObjectSize,
  resolveObjectProcessingInput,
  uploadObjectStream,
} from '../storage/storageService.js';
import { probeMedia, validateMediaDecoding } from '../storage/mediaProcessor.js';
import type { ProviderTaskInput } from './fakeProvider.js';
import { resolveStrictReferenceImageUrls } from './arkSeedanceProvider.js';

const providerName = 'volcengine-ark';
const responseJsonMaxBytes = 1024 * 1024;
const imageDownloadMaxBytes = 64 * 1024 * 1024;
const providerUrlLifetimeMs = 24 * 60 * 60 * 1000;

interface SeedreamDownloadTarget {
  url: URL;
  hostname: string;
  address: string;
  family: 4 | 6;
}

type SeedreamDnsResolver = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

interface SeedreamCheckpoint {
  version: 1;
  model: string;
  created: number | null;
  size: string | null;
  usage: {
    generatedImages: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
}

export async function runArkSeedreamProvider(input: ProviderTaskInput): Promise<ProviderResult> {
  if (!env.ARK_API_KEY) throw new Error('火山方舟 API Key 未配置，Seedream 无法生成。');
  if (input.kind !== 'image' || !isSeedreamModelLabel(input.model)) {
    throw new Error('当前任务不是 Seedream 5.0 Pro 图片任务。');
  }

  const referenceUrls = await resolveStrictReferenceImageUrls(input);
  const configuredReferences = Array.isArray(input.config.referenceAssets)
    ? input.config.referenceAssets.length
    : 0;
  if (referenceUrls.length !== configuredReferences) {
    throw new Error('Seedream 参考图片解析数量与任务配置不一致。');
  }
  const payload = buildSeedreamImagePayload(input, referenceUrls);
  await input.onProviderSubmissionStarted?.();

  // 超时覆盖到响应体读完为止。请求发出后，无论是等响应头、还是读响应体时超时或断开，
  // 图片都可能已经生成计费，因此一律归为提交结果未知，不自动重发。
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ARK_SEEDREAM_TIMEOUT_MS);
  let response: Response;
  let responseText: string;
  try {
    response = await fetch(`${env.ARK_BASE_URL.replace(/\/$/, '')}/images/generations`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${env.ARK_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    responseText = await readResponseTextLimited(response, responseJsonMaxBytes);
  } catch (error) {
    throw isSubmissionUnknownError(error) ? error : submissionUnknownError(error);
  } finally {
    clearTimeout(timeout);
  }

  const providerRequestId = readProviderRequestId(response);
  if (!response.ok) {
    const failure = buildHttpFailure(response.status, responseText, providerRequestId);
    if (failure) return failure;
    throw submissionUnknownError(new Error(`Seedream 创建请求返回 HTTP ${response.status}`));
  }

  const parsed = parseJsonRecord(responseText);
  const parsedResponse = parseSeedreamResponse(parsed);
  const providerOperationId = buildSeedreamOperationId(input.taskId, input.attempt ?? 0);
  const observedAt = new Date().toISOString();
  const responseUrlExpiresAt = new Date(Date.parse(observedAt) + providerUrlLifetimeMs).toISOString();
  const checkpoint: SeedreamCheckpoint = {
    version: 1,
    model: parsedResponse.model,
    created: parsedResponse.created,
    size: parsedResponse.size,
    usage: parsedResponse.usage,
  };
  await input.onProviderResponseCheckpoint?.({
    providerOperationId,
    providerRequestId,
    response: checkpoint as unknown as Record<string, unknown>,
    responseUrl: parsedResponse.imageUrl,
    observedAt,
    responseUrlExpiresAt,
  });
  return archiveSeedreamCheckpointResult({
    input: {
      ...input,
      providerRequestId,
      providerResponseCheckpoint: checkpoint as unknown as Record<string, unknown>,
      providerResponseUrl: parsedResponse.imageUrl,
      providerResponseObservedAt: observedAt,
      providerResponseUrlExpiresAt: responseUrlExpiresAt,
    },
    providerOperationId,
  });
}

export async function resumeArkSeedreamProvider(
  input: ProviderTaskInput,
  providerOperationId: string,
): Promise<ProviderResult> {
  if (input.kind !== 'image' || !isSeedreamModelLabel(input.model)) {
    throw new Error('当前任务不是可恢复的 Seedream 图片任务。');
  }
  if (!isSeedreamOperationId(providerOperationId, input.taskId, input.attempt ?? 0)) {
    throw new Error('Seedream 本地 operation ID 与任务不一致。');
  }
  if (!isSeedreamCheckpoint(input.providerResponseCheckpoint)) {
    return terminalDeliveryFailure(providerOperationId, 'Seedream 同步响应 checkpoint 缺失，无法安全恢复成片。');
  }
  return archiveSeedreamCheckpointResult({ input, providerOperationId });
}

export function buildSeedreamImagePayload(input: ProviderTaskInput, referenceUrls: string[] = []) {
  if (input.kind !== 'image' || !isSeedreamModelLabel(input.model)) {
    throw new Error('当前任务不是 Seedream 5.0 Pro 图片任务。');
  }
  if (referenceUrls.length > 10) throw new Error('Seedream 5.0 Pro 最多支持 10 张参考图片。');
  const outputSize = stringField(input.config.outputSize);
  if (!outputSize || !/^\d+x\d+$/.test(outputSize)) throw new Error('Seedream 图片任务缺少规范化 outputSize。');
  const optimizePromptMode = input.config.optimizePromptMode;
  if (optimizePromptMode !== 'standard' && optimizePromptMode !== 'fast') {
    throw new Error('Seedream 图片任务缺少规范化提示词优化模式。');
  }
  return {
    model: env.ARK_SEEDREAM_MODEL || SEEDREAM_5_PRO_MODEL_ID,
    prompt: compileSeedreamPrompt(input.prompt, input.config),
    size: outputSize,
    optimize_prompt_options: { mode: optimizePromptMode },
    output_format: 'png',
    response_format: 'url',
    watermark: false,
    ...(referenceUrls.length === 0
      ? {}
      : { image: referenceUrls.length === 1 ? referenceUrls[0] : referenceUrls }),
  };
}

async function archiveSeedreamCheckpointResult(input: {
  input: ProviderTaskInput;
  providerOperationId: string;
}): Promise<ProviderResult> {
  const checkpoint = input.input.providerResponseCheckpoint;
  if (!isSeedreamCheckpoint(checkpoint)) {
    return terminalDeliveryFailure(input.providerOperationId, 'Seedream 同步响应 checkpoint 无效，无法恢复成片。');
  }
  const objectKey = requireObjectKey(input.input.outputObjectKey, '成片');
  const stagingObjectKey = requireObjectKey(input.input.stagingObjectKey, '归档 staging');
  const expectedSize = parseExpectedOutputSize(input.input.config.outputSize);
  let validated = await validateExistingSeedreamPng(objectKey, expectedSize);
  if (validated.exists && !validated.valid) {
    return terminalDeliveryFailure(
      input.providerOperationId,
      validated.reason,
      checkpoint,
      input.input,
    );
  }

  if (!validated.exists) {
    const staged = await validateExistingSeedreamPng(stagingObjectKey, expectedSize);
    if (staged.exists && !staged.valid) {
      await deleteObject(stagingObjectKey).catch(() => undefined);
      return terminalDeliveryFailure(
        input.providerOperationId,
        staged.reason,
        checkpoint,
        input.input,
      );
    }

    if (!staged.exists) {
      const sourceUrl = input.input.providerResponseUrl;
      const expiresAt = Date.parse(input.input.providerResponseUrlExpiresAt ?? '');
      if (!sourceUrl || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        return terminalDeliveryFailure(
          input.providerOperationId,
          'Seedream 临时图片地址已失效，且本地未找到已校验原图。',
          checkpoint,
          input.input,
        );
      }
      try {
        await archivePngToStorage({ sourceUrl, objectKey: stagingObjectKey });
      } catch (error) {
        if (isPermanentSeedreamDeliveryError(error)) {
          return terminalDeliveryFailure(
            input.providerOperationId,
            error instanceof Error ? error.message : 'Seedream 临时图片不符合安全归档要求。',
            checkpoint,
            input.input,
          );
        }
        throw error;
      }
      const downloaded = await validateExistingSeedreamPng(stagingObjectKey, expectedSize);
      if (!downloaded.exists || !downloaded.valid) {
        await deleteObject(stagingObjectKey).catch(() => undefined);
        return terminalDeliveryFailure(
          input.providerOperationId,
          downloaded.exists ? downloaded.reason : 'Seedream staging 原图在校验前丢失。',
          checkpoint,
          input.input,
        );
      }
    }

    await copyStoredObject(stagingObjectKey, objectKey);
    validated = await validateExistingSeedreamPng(objectKey, expectedSize);
    if (!validated.exists || !validated.valid) {
      return terminalDeliveryFailure(
        input.providerOperationId,
        validated.exists ? validated.reason : 'Seedream 原图封口后未找到最终对象。',
        checkpoint,
        input.input,
      );
    }
  }

  const observedAt = normalizeIsoDateTime(input.input.providerResponseObservedAt) ?? new Date().toISOString();
  const terminalAt = checkpoint.created === null
    ? null
    : normalizeIsoDateTime(new Date(checkpoint.created * 1000).toISOString());
  return {
    ok: true,
    provider: providerName,
    providerTaskId: input.providerOperationId,
    objectKey,
    thumbnailKey: null,
    publicUrl: buildPublicUrl(objectKey),
    thumbnailUrl: null,
    sizeBytes: validated.sizeBytes,
    width: validated.width,
    height: validated.height,
    durationSeconds: null,
    durationSource: null,
    generatedImages: checkpoint.usage.generatedImages,
    outputTokens: checkpoint.usage.outputTokens,
    totalTokens: checkpoint.usage.totalTokens,
    completionTokens: null,
    billableTokens: null,
    billableBasis: null,
    rawUnits: checkpoint.usage.outputTokens,
    deductedUnits: checkpoint.usage.totalTokens,
    providerTerminalAt: terminalAt,
    usageObservedAt: observedAt,
    usageUnit: 'tokens',
  };
}

async function archivePngToStorage(input: { sourceUrl: string; objectKey: string }) {
  const target = await resolveSeedreamDownloadTarget(input.sourceUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Seedream 图片归档下载超时（${env.ARK_DOWNLOAD_TIMEOUT_MS}ms）`));
  }, env.ARK_DOWNLOAD_TIMEOUT_MS);
  let response: Awaited<ReturnType<typeof requestPinnedSeedreamImage>> | null = null;
  try {
    response = await requestPinnedSeedreamImage(target, controller.signal);
    const status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      throw new Error(`Seedream 图片归档下载失败：HTTP ${status}`);
    }
    const contentType = headerValue(response.headers['content-type'])?.split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'image/png') {
      throw permanentSeedreamDeliveryError('Seedream 图片归档响应不是 image/png。');
    }
    const contentLength = parsePositiveInteger(headerValue(response.headers['content-length']) ?? null);
    if (contentLength !== undefined && contentLength > imageDownloadMaxBytes) {
      throw permanentSeedreamDeliveryError('Seedream 图片归档响应超过 64 MB 上限。');
    }
    return await uploadSeedreamPngStream({
      body: response,
      objectKey: input.objectKey,
      contentLength,
    });
  } finally {
    clearTimeout(timeout);
    response?.destroy();
  }
}

export async function uploadSeedreamPngStream(input: {
  body: Readable;
  objectKey: string;
  contentLength?: number;
}) {
  const limiter = createByteLimitTransform(imageDownloadMaxBytes);
  const passThrough = new PassThrough();
  const uploadPromise = uploadObjectStream({
    objectKey: input.objectKey,
    body: passThrough,
    contentType: 'image/png',
    contentLength: input.contentLength,
  });
  try {
    const [, uploaded] = await Promise.all([
      pipeline(input.body, limiter, passThrough),
      uploadPromise,
    ]);
    return uploaded.sizeBytes;
  } catch (error) {
    input.body.destroy();
    limiter.destroy();
    passThrough.destroy();
    throw error;
  }
}

function parseSeedreamResponse(response: Record<string, unknown>) {
  const data = Array.isArray(response.data) ? response.data : [];
  if (data.length !== 1 || !isRecord(data[0])) {
    throw submissionUnknownError(new Error('Seedream 成功响应必须且只能包含一张图片。'));
  }
  const imageUrl = stringField(data[0].url);
  if (!imageUrl) throw submissionUnknownError(new Error('Seedream 成功响应缺少图片地址。'));
  requireSafeHttpsUrl(imageUrl);
  const usage = isRecord(response.usage) ? response.usage : {};
  return {
    imageUrl,
    model: stringField(response.model) ?? SEEDREAM_5_PRO_MODEL_ID,
    created: optionalNonnegativeInteger(response.created),
    size: stringField(data[0].size),
    usage: {
      generatedImages: optionalNonnegativeInteger(usage.generated_images),
      outputTokens: optionalNonnegativeInteger(usage.output_tokens),
      totalTokens: optionalNonnegativeInteger(usage.total_tokens),
    },
  };
}

function buildHttpFailure(
  status: number,
  responseText: string,
  providerRequestId: string | null,
): ProviderFailure | null {
  if (status < 400 || status >= 500 || [408, 425, 499].includes(status)) return null;
  const parsed = parseJsonRecord(responseText);
  const providerErrorCode = stringField(readPath(parsed, ['error', 'code']))
    ?? stringField(parsed.code)
    ?? 'ARK_CLIENT_REJECTION';
  const providerMessage = stringField(readPath(parsed, ['error', 'message']))
    ?? stringField(parsed.message)
    ?? `Seedream 请求被拒绝：HTTP ${status}`;
  return {
    ok: false,
    provider: providerName,
    category: /moderation|content|sensitive|policy|违规|审核/i.test(`${providerErrorCode} ${providerMessage}`)
      ? 'content-policy'
      : 'provider-failed',
    reason: safeProviderMessage(providerMessage),
    generatedImages: 0,
    outputTokens: null,
    completionTokens: null,
    totalTokens: null,
    billableTokens: null,
    billableBasis: null,
    rawUnits: null,
    deductedUnits: null,
    usageUnit: 'tokens',
    terminal: true,
    providerStatus: 'not-created',
    billingDisposition: 'unbilled',
    submissionDisposition: 'not-created',
    providerHttpStatus: status,
    providerErrorCode,
    providerRequestId: providerRequestId ?? undefined,
  };
}

function terminalDeliveryFailure(
  providerOperationId: string,
  reason: string,
  checkpoint?: SeedreamCheckpoint,
  input?: ProviderTaskInput,
): ProviderFailure {
  const providerTerminalAt = checkpoint?.created === null || checkpoint?.created === undefined
    ? null
    : normalizeIsoDateTime(new Date(checkpoint.created * 1000).toISOString());
  return {
    ok: false,
    provider: providerName,
    providerTaskId: providerOperationId,
    category: 'provider-failed',
    reason,
    terminal: true,
    providerStatus: 'delivery-failed',
    billingDisposition: 'unknown',
    submissionDisposition: 'created',
    generatedImages: checkpoint?.usage.generatedImages ?? null,
    outputTokens: checkpoint?.usage.outputTokens ?? null,
    totalTokens: checkpoint?.usage.totalTokens ?? null,
    rawUnits: checkpoint?.usage.outputTokens ?? null,
    deductedUnits: checkpoint?.usage.totalTokens ?? null,
    providerRequestId: normalizeProviderEvidence(input?.providerRequestId ?? null) ?? undefined,
    providerTerminalAt,
    usageObservedAt: normalizeIsoDateTime(input?.providerResponseObservedAt) ?? undefined,
    usageUnit: 'tokens',
  };
}

function buildSeedreamOperationId(taskId: string, attempt: number) {
  return `seedream-sync:${taskId}:${attempt}`;
}

function isSeedreamOperationId(value: string, taskId: string, attempt: number) {
  return value === buildSeedreamOperationId(taskId, attempt);
}

function isSeedreamCheckpoint(value: unknown): value is SeedreamCheckpoint {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.usage)) return false;
  return typeof value.model === 'string'
    && (value.created === null || optionalNonnegativeInteger(value.created) !== null)
    && (value.size === null || typeof value.size === 'string')
    && isOptionalNonnegativeInteger(value.usage.generatedImages)
    && isOptionalNonnegativeInteger(value.usage.outputTokens)
    && isOptionalNonnegativeInteger(value.usage.totalTokens);
}

function readProviderRequestId(response: Response) {
  return normalizeProviderEvidence(response.headers.get('x-tt-logid'));
}

async function readResponseTextLimited(response: Response, maxBytes: number) {
  if (!response.body) return '';
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw submissionUnknownError(new Error('Seedream 响应体超过安全上限。'));
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function createByteLimitTransform(maxBytes: number) {
  let bytes = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        callback(permanentSeedreamDeliveryError('Seedream 图片归档响应超过 64 MB 上限。'));
        return;
      }
      callback(null, buffer);
    },
  });
}

function requireSafeHttpsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw permanentSeedreamDeliveryError('Seedream 图片地址无效。');
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password
    || (url.port && url.port !== '443') || isPrivateHostname(url.hostname)) {
    throw permanentSeedreamDeliveryError('Seedream 图片地址不符合安全下载要求。');
  }
  return url.toString();
}

function isPrivateHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true;
  if (isIP(normalized)) return normalizePublicIpAddress(normalized) === null;
  return false;
}

export async function resolveSeedreamDownloadTarget(
  sourceUrl: string,
  resolver: SeedreamDnsResolver = defaultSeedreamDnsResolver,
): Promise<SeedreamDownloadTarget> {
  const url = new URL(requireSafeHttpsUrl(sourceUrl));
  const hostname = normalizeHostname(url.hostname);
  const literal = normalizePublicIpAddress(hostname);
  const resolved = literal
    ? [literal]
    : (await resolver(hostname)).map(result => normalizePublicIpAddress(result.address));
  if (resolved.length === 0 || resolved.some(result => result === null)) {
    throw permanentSeedreamDeliveryError('Seedream 图片地址未解析到可信公网地址。');
  }
  const selected = resolved[0];
  if (!selected) {
    throw permanentSeedreamDeliveryError('Seedream 图片地址未解析到可信公网地址。');
  }
  return { url, hostname, ...selected };
}

export function createSeedreamPinnedLookup(target: SeedreamDownloadTarget): LookupFunction {
  return (hostname, options, callback) => {
    if (normalizeHostname(hostname) !== target.hostname) {
      callback(Object.assign(new Error('Seedream 图片下载主机名在连接期间发生变化。'), {
        code: 'SEEDREAM_DOWNLOAD_HOST_CHANGED',
      }), '', undefined);
      return;
    }
    if (options.all) {
      callback(null, [{ address: target.address, family: target.family }]);
      return;
    }
    callback(null, target.address, target.family);
  };
}

async function defaultSeedreamDnsResolver(hostname: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      dnsLookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Seedream 图片地址 DNS 解析超时。')), env.ARK_DOWNLOAD_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizePublicIpAddress(address: string): { address: string; family: 4 | 6 } | null {
  const normalized = address.trim().replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  if (!ipaddr.isValid(normalized)) return null;
  const parsed = ipaddr.parse(normalized);
  const ipv6 = parsed.kind() === 'ipv6' ? parsed as ipaddr.IPv6 : null;
  const candidate = ipv6?.isIPv4MappedAddress() ? ipv6.toIPv4Address() : parsed;
  if (candidate.range() !== 'unicast') return null;
  return {
    address: candidate.toString(),
    family: candidate.kind() === 'ipv4' ? 4 : 6,
  };
}

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function requestPinnedSeedreamImage(target: SeedreamDownloadTarget, signal: AbortSignal) {
  return new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const request = httpsRequest(target.url, {
      method: 'GET',
      headers: { accept: 'image/png' },
      lookup: createSeedreamPinnedLookup(target),
      servername: isIP(target.hostname) ? undefined : target.hostname,
      signal,
    }, resolve);
    request.once('error', reject);
    request.end();
  });
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function readExistingObjectSize(objectKey: string) {
  try {
    return await getStoredObjectSize(objectKey);
  } catch (error) {
    if (isObjectNotFound(error)) return null;
    throw error;
  }
}

async function validateExistingSeedreamPng(
  objectKey: string,
  expected: { width: number; height: number },
): Promise<
  | { exists: false; valid: false; reason: string }
  | { exists: true; valid: false; reason: string }
  | { exists: true; valid: true; reason: ''; sizeBytes: number; width: number; height: number }
> {
  const sizeBytes = await readExistingObjectSize(objectKey);
  if (sizeBytes === null) return { exists: false, valid: false, reason: '对象不存在。' };
  let processingInput: string;
  let metadata: Awaited<ReturnType<typeof probeMedia>>;
  processingInput = await resolveObjectProcessingInput(objectKey);
  try {
    metadata = await probeMedia(processingInput);
  } catch (error) {
    return {
      exists: true,
      valid: false,
      reason: '已下载的 Seedream 原图无法完成媒体探测。',
    };
  }
  if (!metadata.formatName?.toLowerCase().includes('png') || !metadata.hasVideo
    || !isPositiveInteger(metadata.width) || !isPositiveInteger(metadata.height)) {
    return { exists: true, valid: false, reason: '已下载的 Seedream 原图不是可识别的 PNG 图片。' };
  }
  if (metadata.width !== expected.width || metadata.height !== expected.height) {
    return {
      exists: true,
      valid: false,
      reason: `Seedream 实际输出尺寸 ${metadata.width}x${metadata.height} 与任务规格 ${expected.width}x${expected.height} 不一致。`,
    };
  }
  try {
    await validateMediaDecoding(processingInput, 'image');
  } catch (error) {
    return { exists: true, valid: false, reason: '已下载的 Seedream PNG 原图无法完整解码。' };
  }
  return {
    exists: true,
    valid: true,
    reason: '',
    sizeBytes,
    width: metadata.width,
    height: metadata.height,
  };
}

function parseExpectedOutputSize(value: unknown) {
  const normalized = stringField(value);
  const match = normalized?.match(/^(\d+)x(\d+)$/);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    throw new Error('Seedream 图片任务缺少规范化 outputSize。');
  }
  return { width, height };
}

function isObjectNotFound(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.code === 'ENOENT' || candidate.name === 'NoSuchKey' || candidate.name === 'NotFound'
    || candidate.$metadata?.httpStatusCode === 404;
}

function submissionUnknownError(error: unknown) {
  return Object.assign(new Error('Seedream 提交结果无法确认，已停止自动重发。'), {
    code: 'SEEDREAM_SUBMISSION_UNKNOWN',
    cause: error,
  });
}

function isSubmissionUnknownError(error: unknown) {
  return error instanceof Error && (error as { code?: unknown }).code === 'SEEDREAM_SUBMISSION_UNKNOWN';
}

function safeProviderMessage(message: string) {
  return (message.trim() || 'Seedream 请求被供应商拒绝').replace(/https?:\/\/\S+/gi, '[已隐藏地址]').slice(0, 500);
}

function normalizeProviderEvidence(value: string | null) {
  const normalized = value?.trim();
  return normalized && /^[A-Za-z0-9_.:/-]{1,200}$/.test(normalized) ? normalized : null;
}

function requireObjectKey(value: string | undefined, label: string) {
  const objectKey = value?.trim();
  if (objectKey) return objectKey;
  throw new Error(`Seedream provider run 缺少预先持久化的${label}对象 key。`);
}

function permanentSeedreamDeliveryError(message: string) {
  return Object.assign(new Error(message), { code: 'SEEDREAM_PERMANENT_DELIVERY_FAILURE' });
}

function isPermanentSeedreamDeliveryError(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === 'SEEDREAM_PERMANENT_DELIVERY_FAILURE'
    || error.code === 'STORAGE_CONTENT_LENGTH_MISMATCH';
}

function parsePositiveInteger(value: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function optionalNonnegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function isOptionalNonnegativeInteger(value: unknown) {
  return value === null || optionalNonnegativeInteger(value) !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function normalizeIsoDateTime(value: string | null | undefined) {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function parseJsonRecord(text: string) {
  try {
    const value = JSON.parse(text) as unknown;
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function readPath(value: Record<string, unknown>, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
