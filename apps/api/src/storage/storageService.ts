import fs from 'node:fs/promises';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MAX_UPLOAD_SIZE_BYTES } from '@lindyson/api-contracts';
import { env } from '../config/env.js';

export interface UploadSignatureInput {
  objectKey: string;
  contentType: string;
  maxSizeBytes?: number;
}

interface UploadSignatureBase {
  uploadUrl: string;
  headers: Record<string, string>;
  objectKey: string;
  expiresAt: string;
  maxSizeBytes: number;
}

export interface LocalUploadSignature extends UploadSignatureBase {
  driver: 'local';
  method: 'PUT';
}

export interface TosUploadSignature extends UploadSignatureBase {
  driver: 'tos';
  method: 'POST';
  fields: Record<string, string>;
}

export type UploadSignature = LocalUploadSignature | TosUploadSignature;

export const UPLOAD_MAX_BYTES = MAX_UPLOAD_SIZE_BYTES;
// 新鲜期内直接放行；过期后的宽限期内也直接放行，同时在后台重新查询（同一 bucket 只保留
// 一个后台查询），避免用户请求等待跨境往返。宽限期过后或从未查询过时，才同步等待查询。
// 宽限期长短不影响发现状态变化的速度：新鲜期后的每次使用都会触发后台查询，发现不安全立即清除缓存。
const TOS_VERSIONING_SAFE_CACHE_TTL_MS = 30_000;
const TOS_VERSIONING_SAFE_STALE_TTL_MS = 24 * 60 * 60_000;
const TOS_SHA256_METADATA_KEY = 'lindyson-sha256';

let s3Client: S3Client | null = null;
const tosUnversionedBucketCache = new Map<string, { freshUntil: number; staleUntil: number }>();
const tosVersioningRefreshesInFlight = new Map<string, Promise<void>>();

/** 就绪探针使用与真实写入相同的 fail-closed 前置检查。 */
export async function assertStorageReady() {
  if (env.STORAGE_DRIVER !== 'tos') return;
  const bucket = requiredEnv(env.TOS_BUCKET, 'TOS_BUCKET');
  await assertTosBucketSupportsImmutableWrites(getS3Client(), bucket);
}

export async function createUploadSignature(input: UploadSignatureInput): Promise<UploadSignature> {
  const objectKey = requireObjectKey(input.objectKey);
  const expiresAtDate = new Date(Date.now() + 10 * 60 * 1000);
  const expiresAt = expiresAtDate.toISOString();
  const contentType = input.contentType.trim().toLowerCase();
  const maxSizeBytes = Math.min(
    Math.max(1, Math.trunc(input.maxSizeBytes ?? UPLOAD_MAX_BYTES)),
    UPLOAD_MAX_BYTES,
  );

  if (env.STORAGE_DRIVER === 'tos') {
    const bucket = requiredEnv(env.TOS_BUCKET, 'TOS_BUCKET');
    await assertTosBucketSupportsImmutableWrites(getS3Client(), bucket);
    const fields = createTosPostPolicyFields({
      bucket,
      key: objectKey,
      contentType,
      maxSizeBytes,
      expiresAt: expiresAtDate,
    });

    return {
      driver: 'tos',
      method: 'POST',
      uploadUrl: buildTosPostUploadUrl(bucket),
      headers: {},
      fields,
      objectKey,
      expiresAt,
      maxSizeBytes,
    };
  }

  await fs.mkdir(path.resolve(env.LOCAL_STORAGE_DIR, path.dirname(objectKey)), { recursive: true });

  const uploadUrl = createLocalStorageSignedUrl({
    method: 'PUT',
    objectKey,
    contentType,
    maxSizeBytes,
    expiresAtSeconds: Math.floor(expiresAtDate.getTime() / 1000),
  });

  return {
    driver: 'local',
    method: 'PUT',
    uploadUrl,
    headers: { 'content-type': contentType },
    objectKey,
    expiresAt,
    maxSizeBytes,
  };
}

export async function uploadObjectBuffer(input: {
  objectKey: string;
  body: Buffer | Uint8Array;
  contentType: string;
}) {
  const body = Buffer.from(input.body.buffer, input.body.byteOffset, input.body.byteLength);
  if (env.STORAGE_DRIVER === 'tos') {
    const client = getS3Client();
    const bucket = requiredEnv(env.TOS_BUCKET, 'TOS_BUCKET');
    await assertTosBucketSupportsImmutableWrites(client, bucket);
    const identity = digestBuffer(body);
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: input.objectKey,
      Body: body,
      ContentType: input.contentType,
      ContentLength: identity.sizeBytes,
      ContentMD5: identity.md5Base64,
      Metadata: { [TOS_SHA256_METADATA_KEY]: identity.sha256 },
      IfNoneMatch: '*',
    });
    addTosImmutablePutHeaders(command);
    try {
      await client.send(command);
    } catch (error) {
      if (!isImmutableWriteConflict(error)) throw error;
      await assertTosPutReplayMatches(client, bucket, input.objectKey, identity, error);
    }
    return { objectKey: input.objectKey, publicUrl: buildPublicUrl(input.objectKey) };
  }

  const targetPath = localStoragePath(input.objectKey);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.writeFile(targetPath, body, { flag: 'wx' });
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
    const target = await readLocalObjectIdentity(targetPath);
    const source = digestBuffer(body);
    if (target.sizeBytes !== source.sizeBytes || target.sha256 !== source.sha256) {
      throw immutableWriteConflict('目标文件已存在且与本次写入内容不一致', error);
    }
  }
  return { objectKey: input.objectKey, publicUrl: buildPublicUrl(input.objectKey) };
}

export async function uploadObjectStream(input: {
  objectKey: string;
  body: Readable;
  contentType: string;
  contentLength?: number;
  signal?: AbortSignal;
}) {
  if (input.contentLength !== undefined
    && (!Number.isSafeInteger(input.contentLength) || input.contentLength < 0 || input.contentLength > UPLOAD_MAX_BYTES)) {
    throw Object.assign(new Error('对象流声明大小无效或超出上限'), {
      code: 'STORAGE_OBJECT_SIZE_INVALID',
      statusCode: 413,
    });
  }
  const staged = await stageObjectStream(input.body, input.signal);
  try {
    input.signal?.throwIfAborted();
    if (input.contentLength !== undefined && input.contentLength !== staged.identity.sizeBytes) {
      throw Object.assign(new Error('对象流实际大小与 Content-Length 不一致'), {
        code: 'STORAGE_CONTENT_LENGTH_MISMATCH',
        statusCode: 400,
      });
    }

    if (env.STORAGE_DRIVER === 'tos') {
      const client = getS3Client();
      const bucket = requiredEnv(env.TOS_BUCKET, 'TOS_BUCKET');
      await assertTosBucketSupportsImmutableWrites(client, bucket, input.signal);
      input.signal?.throwIfAborted();
      const body = createReadStream(staged.filePath, { signal: input.signal });
      // SDK 的请求结束不保证 Body 已关闭；先注册完成监听，避免取消时遗漏流错误。
      const bodyClosed = finished(body, { cleanup: true }).catch(() => undefined);
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: input.objectKey,
        Body: body,
        ContentType: input.contentType,
        ContentLength: staged.identity.sizeBytes,
        ContentMD5: staged.identity.md5Base64,
        Metadata: { [TOS_SHA256_METADATA_KEY]: staged.identity.sha256 },
        IfNoneMatch: '*',
      });
      addTosImmutablePutHeaders(command);
      try {
        await client.send(command, { abortSignal: input.signal });
        input.signal?.throwIfAborted();
      } catch (error) {
        input.signal?.throwIfAborted();
        if (!isImmutableWriteConflict(error)) throw error;
        await assertTosPutReplayMatches(client, bucket, input.objectKey, staged.identity, error, input.signal);
      } finally {
        body.destroy();
        await bodyClosed;
      }
    } else {
      const targetPath = localStoragePath(input.objectKey);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      input.signal?.throwIfAborted();
      try {
        await fs.copyFile(staged.filePath, targetPath, fsConstants.COPYFILE_EXCL);
      } catch (error) {
        input.signal?.throwIfAborted();
        if (!isFileExistsError(error)) throw error;
        const target = await readLocalObjectIdentity(targetPath, input.signal);
        if (target.sizeBytes !== staged.identity.sizeBytes || target.sha256 !== staged.identity.sha256) {
          throw immutableWriteConflict('目标文件已存在且与本次流内容不一致', error);
        }
      }
    }
  } finally {
    await fs.rm(staged.directory, { recursive: true, force: true });
  }
  input.signal?.throwIfAborted();
  return {
    objectKey: input.objectKey,
    publicUrl: buildPublicUrl(input.objectKey),
    sizeBytes: staged.identity.sizeBytes,
  };
}

export async function deleteObject(objectKey: string) {
  const safeKey = objectKey.trim();
  if (!safeKey) return;

  if (env.STORAGE_DRIVER === 'tos') {
    await getS3Client().send(new DeleteObjectCommand({
      Bucket: requiredEnv(env.TOS_BUCKET, 'TOS_BUCKET'),
      Key: safeKey,
    }));
    return;
  }

  await fs.rm(localStoragePath(safeKey), { force: true });
}

/** 将不可再写的 staging 对象封口为稳定 final key。重复复制相同源对象是幂等的。 */
export async function copyStoredObject(sourceObjectKey: string, targetObjectKey: string) {
  if (sourceObjectKey === targetObjectKey) return;
  if (env.STORAGE_DRIVER === 'tos') {
    const bucket = requiredEnv(env.TOS_BUCKET, 'TOS_BUCKET');
    const client = getS3Client();
    await assertTosBucketSupportsImmutableWrites(client, bucket);
    const sourceIdentity = await readTosObjectIdentity(client, bucket, sourceObjectKey);
    const command = new CopyObjectCommand({
      Bucket: bucket,
      Key: targetObjectKey,
      CopySource: `${bucket}/${encodeObjectPath(sourceObjectKey)}`,
      CopySourceIfMatch: sourceIdentity.rawEtag,
      IfNoneMatch: '*',
    });
    addTosImmutableCopyHeaders(command, {
      'x-tos-forbid-overwrite': 'true',
    });
    try {
      await client.send(command);
    } catch (error) {
      if (!isImmutableWriteConflict(error)) throw error;
      let replaySource: StoredObjectIdentity;
      let replayTarget: StoredObjectIdentity;
      try {
        [replaySource, replayTarget] = await Promise.all([
          readTosObjectIdentity(client, bucket, sourceObjectKey),
          readTosObjectIdentity(client, bucket, targetObjectKey),
        ]);
      } catch (verificationError) {
        throw Object.assign(new Error('对象已存在，但无法验证是否为相同内容的幂等重放'), {
          code: 'STORAGE_IMMUTABLE_REPLAY_UNVERIFIED',
          statusCode: 503,
          cause: verificationError,
        });
      }
      if (sameStoredObjectIdentity(sourceIdentity, replaySource)
        && sameStoredObjectIdentity(sourceIdentity, replayTarget)) return;
      throw immutableWriteConflict('目标对象已存在且与源对象内容不一致', error);
    }
    return;
  }

  const sourcePath = localStoragePath(sourceObjectKey);
  const targetPath = localStoragePath(targetObjectKey);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
    if (await sameLocalObjectContent(sourcePath, targetPath)) return;
    throw immutableWriteConflict('目标文件已存在且与源文件内容不一致', error);
  }
}

export async function createObjectReadUrl(objectKey: string, expiresInSeconds?: number) {
  return createObjectGetUrl(objectKey, undefined, expiresInSeconds);
}

/**
 * 在把对象地址交给外部多模态模型前读取真实字节数。缩略图大小不写入 assets
 * 表，因此不能用原图的 size_bytes 代替；TOS 使用 HEAD，本地驱动使用 stat。
 */
export async function getStoredObjectSize(objectKey: string) {
  const safeKey = requireObjectKey(objectKey);
  const sizeBytes = env.STORAGE_DRIVER === 'tos'
    ? Number((await getS3Client().send(new HeadObjectCommand({
      Bucket: requiredEnv(env.TOS_BUCKET, 'TOS_BUCKET'),
      Key: safeKey,
    }))).ContentLength)
    : (await fs.stat(localStoragePath(safeKey))).size;

  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw Object.assign(new Error('对象存储未返回有效的文件大小'), {
      code: 'STORAGE_OBJECT_SIZE_INVALID',
      statusCode: 503,
    });
  }
  return sizeBytes;
}

/** 服务端媒体工具在本地驱动下直接读取共享卷，TOS 下使用短期签名 URL。 */
export async function resolveObjectProcessingInput(objectKey: string) {
  return env.STORAGE_DRIVER === 'local'
    ? localStoragePath(objectKey)
    : createObjectReadUrl(objectKey);
}

/**
 * 为 worker 提供对象原始字节流。调用方必须消费或销毁返回流；这里不创建本地
 * 临时文件，图片缩略图可以直接从 TOS 流入 libvips。
 */
export async function openStoredObjectStream(objectKey: string): Promise<Readable> {
  const safeKey = requireObjectKey(objectKey);
  if (env.STORAGE_DRIVER !== 'tos') return createReadStream(localStoragePath(safeKey));

  const result = await getS3Client().send(new GetObjectCommand({
    Bucket: requiredEnv(env.TOS_BUCKET, 'TOS_BUCKET'),
    Key: safeKey,
  }));
  if (!result.Body) {
    throw Object.assign(new Error('对象存储未返回文件内容'), {
      code: 'STORAGE_OBJECT_BODY_MISSING',
      statusCode: 503,
    });
  }

  if (result.Body instanceof Readable) return result.Body;
  const body = result.Body as AsyncIterable<Uint8Array>;
  if (typeof body[Symbol.asyncIterator] === 'function') return Readable.from(body);
  throw Object.assign(new Error('对象存储返回了不支持的文件流'), {
    code: 'STORAGE_OBJECT_STREAM_UNSUPPORTED',
    statusCode: 503,
  });
}

export async function createObjectDownloadUrl(objectKey: string, filename: string) {
  return createObjectGetUrl(objectKey, filename);
}

async function createObjectGetUrl(
  objectKey: string,
  downloadFilename?: string,
  requestedExpiresInSeconds?: number,
) {
  const configuredExpiresInSeconds = requestedExpiresInSeconds === undefined
    ? env.TOS_READ_URL_EXPIRES_SECONDS
    : Math.max(1, Math.min(
      env.TOS_READ_URL_EXPIRES_SECONDS,
      Math.trunc(requestedExpiresInSeconds),
    ));
  const expiresInSeconds = downloadFilename
    ? Math.min(configuredExpiresInSeconds, 5 * 60)
    : configuredExpiresInSeconds;
  if (env.STORAGE_DRIVER === 'tos') {
    const command = new GetObjectCommand({
      Bucket: requiredEnv(env.TOS_BUCKET, 'TOS_BUCKET'),
      Key: objectKey,
      ResponseCacheControl: 'private, no-store',
      ResponseContentDisposition: downloadFilename
        ? contentDispositionAttachment(downloadFilename)
        : undefined,
    });
    return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });
  }

  const signedUrl = createLocalStorageSignedUrl({
    method: 'GET',
    objectKey,
    contentType: '',
    maxSizeBytes: 0,
    expiresAtSeconds: Math.floor(Date.now() / 1000) + expiresInSeconds,
  });
  if (!downloadFilename) return signedUrl;
  const url = new URL(signedUrl);
  url.searchParams.set('download', '1');
  url.searchParams.set('filename', downloadFilename.slice(0, 255));
  return url.toString();
}

export function verifyLocalStorageSignature(input: {
  method: 'GET' | 'PUT';
  objectKey: string;
  contentType: string;
  maxSizeBytes: number;
  expiresAtSeconds: number;
  signature: string;
}) {
  if (!Number.isSafeInteger(input.expiresAtSeconds) || input.expiresAtSeconds < Math.floor(Date.now() / 1000)) {
    return false;
  }
  if (!Number.isSafeInteger(input.maxSizeBytes) || input.maxSizeBytes < 0 || input.maxSizeBytes > UPLOAD_MAX_BYTES) {
    return false;
  }

  const expected = signLocalStorageRequest(input);
  const supplied = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);
  return supplied.length === expectedBuffer.length && timingSafeEqual(supplied, expectedBuffer);
}

export async function readStoredObjectSize(objectKey: string) {
  if (env.STORAGE_DRIVER === 'tos') {
    const result = await getS3Client().send(new HeadObjectCommand({
      Bucket: requiredEnv(env.TOS_BUCKET, 'TOS_BUCKET'),
      Key: objectKey,
    }));
    if (!Number.isFinite(result.ContentLength) || result.ContentLength === undefined || result.ContentLength < 0) {
      throw new Error('对象存储未返回有效的文件大小');
    }
    return result.ContentLength;
  }

  const stats = await fs.stat(localStoragePath(objectKey));
  return stats.size;
}

export function buildUploadStagingObjectKey(input: { userId: string; sessionId: string; filename: string }) {
  return `users/${input.userId}/upload-staging/${input.sessionId}/${safeUploadFilename(input.filename)}`;
}

export function buildUploadFinalObjectKey(input: { userId: string; sessionId: string; filename: string }) {
  return `users/${input.userId}/uploads/${input.sessionId}/${safeUploadFilename(input.filename)}`;
}

export function buildPublicUrl(objectKey: string) {
  // TOS 对象始终保持私有：数据库只保存 object_key，读取时再即时签名。
  // 即使开发环境误配了公开 CDN，也不为 TOS 生成或持久化 direct URL。
  if (env.STORAGE_DRIVER === 'tos' || env.NODE_ENV === 'production') return null;

  if (env.STORAGE_PUBLIC_BASE_URL) {
    return `${env.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, '')}/${objectKey}`;
  }

  return `${env.PUBLIC_BASE_URL}/api/storage/local/${encodeObjectPath(objectKey)}`;
}

export function localStoragePath(objectKey: string) {
  const baseDir = path.resolve(env.LOCAL_STORAGE_DIR);
  const targetPath = path.resolve(baseDir, objectKey);

  if (!targetPath.startsWith(`${baseDir}${path.sep}`)) {
    throw new Error('非法存储路径');
  }

  return targetPath;
}

function getS3Client() {
  if (s3Client) return s3Client;

  s3Client = new S3Client({
    endpoint: requiredEnv(env.TOS_ENDPOINT, 'TOS_ENDPOINT'),
    region: env.TOS_REGION,
    forcePathStyle: env.TOS_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: requiredEnv(env.TOS_ACCESS_KEY_ID, 'TOS_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv(env.TOS_SECRET_ACCESS_KEY, 'TOS_SECRET_ACCESS_KEY'),
    },
  });

  return s3Client;
}

function buildTosPostUploadUrl(bucket: string) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('TOS_BUCKET 不是有效的存储桶名称');
  }
  return `https://${bucket}.${buildTosNativeEndpoint()}`;
}

function buildTosNativeEndpoint() {
  if (!/^[a-z0-9-]+$/.test(env.TOS_REGION)) {
    throw new Error('TOS_REGION 不是有效的地域名称');
  }
  return `tos-${env.TOS_REGION}.volces.com`;
}

function createTosPostPolicyFields(input: {
  bucket: string;
  key: string;
  contentType: string;
  maxSizeBytes: number;
  expiresAt: Date;
}) {
  const accessKeyId = requiredEnv(env.TOS_ACCESS_KEY_ID, 'TOS_ACCESS_KEY_ID');
  const accessKeySecret = requiredEnv(env.TOS_SECRET_ACCESS_KEY, 'TOS_SECRET_ACCESS_KEY');
  const region = env.TOS_REGION;
  const signedAt = formatTosSignatureDate(new Date());
  const shortDate = signedAt.slice(0, 8);
  const credential = `${accessKeyId}/${shortDate}/${region}/tos/request`;
  const fields: Record<string, string> = {
    'content-type': input.contentType,
    key: input.key,
    'x-tos-forbid-overwrite': 'true',
    'x-tos-algorithm': 'TOS4-HMAC-SHA256',
    'x-tos-date': signedAt,
    'x-tos-credential': credential,
  };
  const policy = Buffer.from(JSON.stringify({
    expiration: input.expiresAt.toISOString(),
    conditions: [
      ['content-length-range', 1, input.maxSizeBytes],
      { bucket: input.bucket },
      ...Object.entries(fields).map(([key, value]) => ({ [key]: value })),
    ],
  }), 'utf8').toString('base64');
  const dateKey = hmacSha256(accessKeySecret, shortDate);
  const regionKey = hmacSha256(dateKey, region);
  const serviceKey = hmacSha256(regionKey, 'tos');
  const signingKey = hmacSha256(serviceKey, 'request');

  fields.policy = policy;
  fields['x-tos-signature'] = createHmac('sha256', signingKey).update(policy).digest('hex');
  return fields;
}

function hmacSha256(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

function formatTosSignatureDate(date: Date) {
  return `${date.toISOString().replace(/\.\d{3}Z$/, '').replaceAll('-', '').replaceAll(':', '')}Z`;
}

function safeUploadFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
}

function encodeObjectPath(objectKey: string) {
  return objectKey.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

interface StoredObjectIdentity {
  sizeBytes: number;
  etag: string;
  rawEtag: string;
  sha256: string | null;
}

interface ObjectDigestIdentity {
  sizeBytes: number;
  md5Hex: string;
  md5Base64: string;
  sha256: string;
}

async function assertTosBucketSupportsImmutableWrites(client: S3Client, bucket: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const cacheKey = `${env.TOS_ENDPOINT}\u0000${env.TOS_REGION}\u0000${bucket}`;
  const cached = tosUnversionedBucketCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.freshUntil > now) return;
  if (cached && cached.staleUntil > now) {
    // 宽限期只在后台刷新：查询失败或状态不安全会立即移除缓存，之后的写入重新同步检查并 fail-closed。
    // 因此状态变化最多在一次后台查询的往返时间内未被发现。
    refreshTosBucketVersioningInBackground(client, bucket, cacheKey);
    return;
  }
  tosUnversionedBucketCache.delete(cacheKey);
  await queryTosBucketVersioning(client, bucket, cacheKey, signal);
}

function refreshTosBucketVersioningInBackground(client: S3Client, bucket: string, cacheKey: string) {
  if (tosVersioningRefreshesInFlight.has(cacheKey)) return;
  const refresh = queryTosBucketVersioning(client, bucket, cacheKey)
    .catch(() => undefined)
    .finally(() => tosVersioningRefreshesInFlight.delete(cacheKey));
  tosVersioningRefreshesInFlight.set(cacheKey, refresh);
}

async function queryTosBucketVersioning(
  client: S3Client,
  bucket: string,
  cacheKey: string,
  signal?: AbortSignal,
) {
  let versioning;
  try {
    versioning = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }), { abortSignal: signal });
    signal?.throwIfAborted();
  } catch (error) {
    tosUnversionedBucketCache.delete(cacheKey);
    signal?.throwIfAborted();
    throw Object.assign(new Error('无法确认 TOS 存储桶的版本控制状态，已阻止不可覆盖写入'), {
      code: 'STORAGE_BUCKET_VERSIONING_UNVERIFIED',
      statusCode: 503,
      cause: error,
    });
  }
  // AWS S3 对从未启用版本控制的桶反序列化为 undefined；TOS 的 S3 兼容
  // GetBucketVersioning 会返回空字符串。TOS 官方 GetBucketInfo 同样定义“空”为
  // 未开启。只接受这两个明确值，Enabled、Suspended 和任何未知非空值仍 fail-closed。
  const versioningStatus = versioning.Status as string | undefined;
  if (versioningStatus !== undefined && versioningStatus !== '') {
    tosUnversionedBucketCache.delete(cacheKey);
    throw Object.assign(new Error(
      `TOS 存储桶版本控制状态为 ${versioningStatus}，x-tos-forbid-overwrite 无法保证不可覆盖写入`,
    ), {
      code: 'STORAGE_BUCKET_VERSIONING_UNSAFE',
      statusCode: 503,
    });
  }
  // 只缓存明确安全的未启用状态；查询失败或任何非空状态都不进入缓存。
  const checkedAt = Date.now();
  tosUnversionedBucketCache.set(cacheKey, {
    freshUntil: checkedAt + TOS_VERSIONING_SAFE_CACHE_TTL_MS,
    staleUntil: checkedAt + TOS_VERSIONING_SAFE_STALE_TTL_MS,
  });
}

async function readTosObjectIdentity(
  client: S3Client,
  bucket: string,
  objectKey: string,
  signal?: AbortSignal,
): Promise<StoredObjectIdentity> {
  signal?.throwIfAborted();
  const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }), { abortSignal: signal });
  signal?.throwIfAborted();
  const sizeBytes = Number(result.ContentLength);
  const rawEtag = result.ETag?.trim() ?? '';
  const etag = normalizeEtag(rawEtag);
  const sha256 = readTosSha256Metadata(result.Metadata);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || !etag) {
    throw Object.assign(new Error(`TOS 对象 ${objectKey} 缺少可验证的大小或 ETag`), {
      code: 'STORAGE_OBJECT_IDENTITY_UNAVAILABLE',
      statusCode: 503,
    });
  }
  return { sizeBytes, etag, rawEtag, sha256 };
}

function addTosImmutableCopyHeaders(command: CopyObjectCommand, headers: Record<string, string>) {
  command.middlewareStack.add(
    next => async args => {
      const request = args.request as { headers?: Record<string, string> } | undefined;
      if (!request?.headers) {
        throw new Error('TOS 复制请求尚未序列化，无法注入不可覆盖头域');
      }
      Object.assign(request.headers, headers);
      return next(args);
    },
    {
      step: 'build',
      name: 'addTosImmutableCopyHeaders',
      priority: 'low',
    },
  );
}

function addTosImmutablePutHeaders(command: PutObjectCommand) {
  command.middlewareStack.add(
    next => async args => {
      const request = args.request as { headers?: Record<string, string> } | undefined;
      if (!request?.headers) {
        throw new Error('TOS 写入请求尚未序列化，无法注入不可覆盖头域');
      }
      request.headers['x-tos-forbid-overwrite'] = 'true';
      return next(args);
    },
    {
      step: 'build',
      name: 'addTosImmutablePutHeaders',
      priority: 'low',
    },
  );
}

async function assertTosPutReplayMatches(
  client: S3Client,
  bucket: string,
  objectKey: string,
  expected: ObjectDigestIdentity,
  conflictCause: unknown,
  signal?: AbortSignal,
) {
  let target: StoredObjectIdentity;
  try {
    target = await readTosObjectIdentity(client, bucket, objectKey, signal);
  } catch (verificationError) {
    signal?.throwIfAborted();
    throw Object.assign(new Error('对象已存在，但无法验证是否为本次写入的幂等重放'), {
      code: 'STORAGE_IMMUTABLE_REPLAY_UNVERIFIED',
      statusCode: 503,
      cause: verificationError,
    });
  }
  if (target.sizeBytes === expected.sizeBytes && target.sha256 === expected.sha256) return;
  throw immutableWriteConflict('目标对象已存在且与本次写入内容不一致', conflictCause);
}

async function stageObjectStream(body: Readable, signal?: AbortSignal) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lindyson-object-upload-'));
  const filePath = path.join(directory, 'body');
  const digester = createDigestLimiter(UPLOAD_MAX_BYTES);
  try {
    await pipeline(body, digester.stream, createWriteStream(filePath, { flags: 'wx' }), { signal });
    signal?.throwIfAborted();
    return { directory, filePath, identity: digester.finish() };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    signal?.throwIfAborted();
    throw error;
  }
}

function createDigestLimiter(maxSizeBytes: number) {
  let sizeBytes = 0;
  const md5 = createHash('md5');
  const sha256 = createHash('sha256');
  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += buffer.length;
      if (sizeBytes > maxSizeBytes) {
        callback(Object.assign(new Error('对象流超出允许大小'), {
          code: 'STORAGE_OBJECT_TOO_LARGE',
          statusCode: 413,
        }));
        return;
      }
      md5.update(buffer);
      sha256.update(buffer);
      callback(null, buffer);
    },
  });

  return {
    stream,
    finish(): ObjectDigestIdentity {
      const md5Digest = md5.digest();
      return {
        sizeBytes,
        md5Hex: md5Digest.toString('hex'),
        md5Base64: md5Digest.toString('base64'),
        sha256: sha256.digest('hex'),
      };
    },
  };
}

function digestBuffer(body: Buffer): ObjectDigestIdentity {
  if (body.byteLength > UPLOAD_MAX_BYTES) {
    throw Object.assign(new Error('对象超出允许大小'), {
      code: 'STORAGE_OBJECT_TOO_LARGE',
      statusCode: 413,
    });
  }
  const md5 = createHash('md5').update(body).digest();
  return {
    sizeBytes: body.byteLength,
    md5Hex: md5.toString('hex'),
    md5Base64: md5.toString('base64'),
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}

async function sameLocalObjectContent(sourcePath: string, targetPath: string) {
  const [source, target] = await Promise.all([
    readLocalObjectIdentity(sourcePath),
    readLocalObjectIdentity(targetPath),
  ]);
  return source.sizeBytes === target.sizeBytes && source.sha256 === target.sha256;
}

async function readLocalObjectIdentity(filePath: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const stats = await fs.stat(filePath);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath, { signal })) hash.update(chunk as Buffer);
  signal?.throwIfAborted();
  return { sizeBytes: stats.size, sha256: hash.digest('hex') };
}

function sameStoredObjectIdentity(left: StoredObjectIdentity, right: StoredObjectIdentity) {
  return left.sizeBytes === right.sizeBytes && left.etag === right.etag;
}

function normalizeEtag(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^W\//.test(trimmed)) return '';
  if (trimmed.startsWith('"') !== trimmed.endsWith('"')) return '';
  return trimmed.startsWith('"') ? trimmed.slice(1, -1) : trimmed;
}

function readTosSha256Metadata(metadata: Record<string, string> | undefined) {
  const value = Object.entries(metadata ?? {}).find(([key]) => (
    key.toLowerCase() === TOS_SHA256_METADATA_KEY
  ))?.[1]?.trim().toLowerCase() ?? '';
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function isImmutableWriteConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as { statusCode?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const status = value.$metadata?.httpStatusCode ?? value.statusCode;
  return status === 409 || status === 412;
}

function isFileExistsError(error: unknown) {
  return Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === 'EEXIST';
}

function immutableWriteConflict(message: string, cause: unknown) {
  return Object.assign(new Error(message), {
    code: 'STORAGE_IMMUTABLE_CONFLICT',
    statusCode: 409,
    cause,
  });
}

function requireObjectKey(objectKey: string) {
  const safeKey = objectKey?.trim();
  if (!safeKey) throw new Error('上传对象 key 不能为空');
  return safeKey;
}

function createLocalStorageSignedUrl(input: {
  method: 'GET' | 'PUT';
  objectKey: string;
  contentType: string;
  maxSizeBytes: number;
  expiresAtSeconds: number;
}) {
  const signature = signLocalStorageRequest({ ...input, signature: '' });
  const query = new URLSearchParams({
    exp: String(input.expiresAtSeconds),
    maxBytes: String(input.maxSizeBytes),
    contentType: input.contentType,
    signature,
  });
  return `${env.PUBLIC_BASE_URL}/api/storage/local/${encodeObjectPath(input.objectKey)}?${query.toString()}`;
}

function signLocalStorageRequest(input: {
  method: 'GET' | 'PUT';
  objectKey: string;
  contentType: string;
  maxSizeBytes: number;
  expiresAtSeconds: number;
  signature: string;
}) {
  const payload = [
    input.method,
    input.objectKey,
    input.contentType.trim().toLowerCase(),
    String(input.maxSizeBytes),
    String(input.expiresAtSeconds),
  ].join('\n');
  return createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url');
}

function requiredEnv(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} 未配置`);
  return value;
}

function contentDispositionAttachment(filename: string) {
  const encoded = encodeURIComponent(filename.slice(0, 255)).replace(/['()]/g, character => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  return `attachment; filename*=UTF-8''${encoded}`;
}
