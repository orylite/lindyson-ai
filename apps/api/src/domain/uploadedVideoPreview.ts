import type { MediaMetadata } from '../storage/mediaProcessor.js';
import {
  openStoredObjectStream,
  resolveObjectProcessingInput,
  uploadObjectBuffer,
} from '../storage/storageService.js';
import { withThumbnailConcurrency } from './thumbnailConcurrency.js';

export interface UploadedVideoPreviewResult {
  thumbnailKey: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export async function createUploadedVideoPreview(input: {
  userId: string;
  objectKey: string;
  existingThumbnailKey?: string | null;
  thumbnailKey: string;
  metadata?: MediaMetadata;
}): Promise<UploadedVideoPreviewResult> {
  const sourceUrl = await resolveObjectProcessingInput(input.objectKey);
  const metadata = input.metadata ?? await readUploadedMediaMetadata({ sourceUrl, objectKey: input.objectKey });
  const existingThumbnailKey = normalizeExistingThumbnailKey(input.existingThumbnailKey, input.objectKey);
  const thumbnailKey = existingThumbnailKey ?? await createUploadedVideoThumbnail({
    sourceUrl,
    thumbnailKey: input.thumbnailKey,
  });

  return {
    thumbnailKey,
    width: metadata.width,
    height: metadata.height,
    durationSeconds: metadata.durationSeconds,
  };
}

export async function readUploadedMediaMetadata(input: {
  objectKey: string;
  sourceUrl?: string;
}) {
  const sourceUrl = input.sourceUrl ?? await resolveObjectProcessingInput(input.objectKey);
  const { probeMedia } = await import('../storage/mediaProcessor.js');
  return probeMedia(sourceUrl);
}

export async function validateUploadedMediaDecoding(input: {
  objectKey: string;
  assetType: 'video' | 'image' | 'audio';
}) {
  const sourceUrl = await resolveObjectProcessingInput(input.objectKey);
  try {
    const { validateMediaDecoding } = await import('../storage/mediaProcessor.js');
    await validateMediaDecoding(sourceUrl, input.assetType);
  } catch (error) {
    const message = error instanceof Error ? error.message : '媒体完整解码失败';
    // ffmpeg 常会把输入 URL 附在解码错误末尾，不能因文本包含 http/https
    // 就把损坏文件当成临时网络故障。只有明确的连接、DNS、超时或 5xx 信号才重试。
    if (/(connection (?:refused|reset|timed out)|network (?:is )?unreachable|timed?\s*out|timeout|超时|could not resolve|temporary failure|server returned 5\d\d|http error 5\d\d|\b50[234]\b)/i.test(message)) {
      throw error;
    }
    throw Object.assign(new Error('上传文件无法完整解码'), {
      code: 'UPLOAD_MEDIA_DETECTION_FAILED',
      cause: error,
    });
  }
}

export function isUserUploadedObjectKey(userId: string, objectKey: string) {
  const prefix = `users/${userId}/`;
  const safeKey = objectKey.trim();
  if (!safeKey.startsWith(prefix)) return false;

  return safeKey.split('/').every(segment => segment && segment !== '.' && segment !== '..');
}

export function buildUploadedVideoThumbnailKey(userId: string, sessionId: string) {
  return `users/${userId}/upload-thumbnails/${sessionId}.jpg`;
}

export function buildUploadedImageThumbnailKey(userId: string, sessionId: string) {
  return `users/${userId}/upload-thumbnails/${sessionId}.webp`;
}

export function buildHistoricalImageThumbnailKey(userId: string, assetId: string) {
  return `users/${userId}/asset-thumbnails/${assetId}.webp`;
}

export function buildHistoricalVideoThumbnailKey(userId: string, assetId: string) {
  return `users/${userId}/asset-thumbnails/${assetId}.jpg`;
}

/**
 * 只有明确的媒体损坏、缺少视频流或无法解码才转为永久失败；网络、TOS、鉴权、
 * 超时和未知基础设施错误必须保持可重试，避免一次短暂故障永久留下占位图。
 */
export function isPermanentVideoPreviewFailure(error: unknown) {
  for (const item of errorChain(error)) {
    const code = item && typeof item === 'object' && typeof (item as { code?: unknown }).code === 'string'
      ? String((item as { code: string }).code)
      : '';
    if (code === 'VIDEO_PREVIEW_INCOMPLETE' || code === 'UPLOAD_MEDIA_DETECTION_FAILED') return true;

    const message = item instanceof Error
      ? item.message
      : typeof item === 'object' && item && typeof (item as { message?: unknown }).message === 'string'
        ? String((item as { message: string }).message)
        : '';
    if (
      /invalid data|moov atom not found|could not find codec|unsupported codec|no video stream|ffmpeg.*(?:no frames|未输出)|error while decoding|corrupt(?:ed)? (?:file|input|header)/i.test(message)
    ) return true;
  }
  return false;
}

export async function createUploadedImageThumbnail(input: {
  objectKey: string;
  thumbnailKey: string;
}) {
  return withThumbnailConcurrency('image', async () => {
    try {
      const source = await openStoredObjectStream(input.objectKey);
      const { createImageThumbnailBuffer } = await import('../storage/mediaProcessor.js');
      const body = await createImageThumbnailBuffer(source);
      const uploaded = await uploadObjectBuffer({
        objectKey: input.thumbnailKey,
        body,
        contentType: 'image/webp',
      });
      return uploaded.objectKey;
    } catch (error) {
      throw Object.assign(new Error('上传图片缩略图生成失败'), {
        code: 'UPLOAD_THUMBNAIL_FAILED',
        cause: error,
      });
    }
  });
}

async function createUploadedVideoThumbnail(input: {
  sourceUrl: string;
  thumbnailKey: string;
}) {
  return withThumbnailConcurrency('video', async () => {
    try {
      const { createVideoThumbnailBuffer } = await import('../storage/mediaProcessor.js');
      const body = await createVideoThumbnailBuffer(input.sourceUrl);
      if (body.length === 0) throw new Error('ffmpeg 未输出缩略图。');

      const uploaded = await uploadObjectBuffer({
        objectKey: input.thumbnailKey,
        body,
        contentType: 'image/jpeg',
      });

      return uploaded.objectKey;
    } catch (error) {
      throw Object.assign(new Error('上传视频缩略图生成失败'), {
        code: 'UPLOAD_THUMBNAIL_FAILED',
        cause: error,
      });
    }
  });
}

function normalizeExistingThumbnailKey(thumbnailKey: string | null | undefined, objectKey: string) {
  const safeKey = thumbnailKey?.trim();
  if (!safeKey || safeKey === objectKey) return null;
  return safeKey;
}

function errorChain(error: unknown) {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current) && chain.length < 8) {
    chain.push(current);
    seen.add(current);
    current = typeof current === 'object' && current
      ? (current as { cause?: unknown }).cause
      : undefined;
  }
  return chain;
}
