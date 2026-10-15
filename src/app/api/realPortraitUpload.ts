import type { RealPortraitAsset, PortraitAssetKind } from '../data/realPortraits';
import { uploadObjectWithProgress } from './assetUpload';
import * as mutations from './mutations';

const MAX_PORTRAIT_BYTES = 30 * 1024 * 1024 - 1;
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
};
const ALLOWED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

export interface UploadRealPortraitFileInput {
  actorId: string;
  kind: PortraitAssetKind;
  file: File;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export async function uploadRealPortraitFile({
  actorId,
  kind,
  file,
  signal,
  onProgress,
}: UploadRealPortraitFileInput): Promise<RealPortraitAsset> {
  const mimeType = resolvePortraitMimeType(file);
  if (!mimeType) throw new Error('仅支持 JPEG、PNG、WebP、BMP、TIFF、GIF、HEIC 或 HEIF 图片');
  if (file.size <= 0 || file.size > MAX_PORTRAIT_BYTES) throw new Error('真人图片必须小于 30 MB');
  const [dimensions, sha256] = await Promise.all([
    readImageDimensions(file).catch(() => null),
    digestFile(file),
  ]);
  if (dimensions) assertPortraitDimensions(dimensions.width, dimensions.height);
  if (signal?.aborted) throw new DOMException('上传已取消', 'AbortError');

  onProgress?.(5);
  const upload = await mutations.createRealPortraitUpload(actorId, {
    kind,
    mimeType: mimeType as Parameters<typeof mutations.createRealPortraitUpload>[1]['mimeType'],
    sizeBytes: file.size,
  });
  const signature = {
    ...upload.signature,
    sessionId: upload.id,
  } as Parameters<typeof uploadObjectWithProgress>[0];
  await uploadObjectWithProgress(signature, file, progress => {
    onProgress?.(10 + Math.round(progress * 0.75));
  }, { signal, timeoutMs: 20 * 60_000, idleTimeoutMs: 45_000 });
  if (signal?.aborted) throw new DOMException('上传已取消', 'AbortError');
  onProgress?.(90);
  const asset = await mutations.completeRealPortraitUpload(upload.id, {
    mimeType: mimeType as Parameters<typeof mutations.completeRealPortraitUpload>[1]['mimeType'],
    sizeBytes: file.size,
    ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
    sha256,
  });
  onProgress?.(100);
  return asset;
}

function resolvePortraitMimeType(file: File) {
  const normalized = file.type.trim().toLowerCase();
  if (ALLOWED_MIME_TYPES.has(normalized)) return normalized;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? null;
}

async function readImageDimensions(file: File) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        return { width: bitmap.width, height: bitmap.height };
      } finally {
        bitmap.close();
      }
    } catch {
      // HEIC/HEIF 在部分浏览器无法解码，最终尺寸仍由服务端 Sharp 权威校验。
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('无法读取图片尺寸，请转换为 JPEG 或 PNG 后重试'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function assertPortraitDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 300 || height < 300 || width > 6000 || height > 6000) {
    throw new Error('真人图片宽高均须在 300 到 6000 像素之间');
  }
  const ratio = width / height;
  if (!(ratio > 0.4 && ratio < 2.5)) throw new Error('真人图片宽高比必须在 0.4 到 2.5 之间');
}

async function digestFile(file: File) {
  if (!globalThis.crypto?.subtle) throw new Error('当前浏览器无法安全校验文件，请升级浏览器后重试');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
