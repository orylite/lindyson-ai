import fs from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import {
  UPLOAD_MAX_BYTES,
  localStoragePath,
  verifyLocalStorageSignature,
} from './storageService.js';

interface LocalStorageQuery {
  exp?: string;
  maxBytes?: string;
  contentType?: string;
  signature?: string;
  download?: string;
  filename?: string;
}

export async function registerLocalStorageRoutes(app: FastifyInstance) {
  // Fastify 默认不解析媒体 body。这里保留原始流，由路由在签名验证后有界写盘。
  app.addContentTypeParser(
    /^(?:image|video|audio)\/.+|^application\/octet-stream$/i,
    (_request, payload, done) => done(null, payload),
  );

  app.put('/api/storage/local/*', async (request, reply) => {
    const { '*': objectKeyParam } = request.params as { '*': string };
    const objectKey = decodeURIComponent(objectKeyParam);
    const query = request.query as LocalStorageQuery;
    const contentType = normalizeContentType(request.headers['content-type']);
    const expiresAtSeconds = parseSafeInteger(query.exp);
    const maxSizeBytes = parseSafeInteger(query.maxBytes);

    if (!verifyLocalStorageSignature({
      method: 'PUT',
      objectKey,
      contentType,
      maxSizeBytes,
      expiresAtSeconds,
      signature: query.signature ?? '',
    })) {
      return reply.code(403).send({ message: '上传签名无效或已过期' });
    }
    if (!contentType || contentType !== normalizeContentType(query.contentType)) {
      return reply.code(400).send({ message: '上传文件类型与签名不一致' });
    }
    if (maxSizeBytes <= 0 || maxSizeBytes > UPLOAD_MAX_BYTES) {
      return reply.code(413).send({ message: '上传文件超出允许大小' });
    }

    const declaredLength = parseSafeInteger(request.headers['content-length']);
    if (declaredLength > maxSizeBytes) {
      return reply.code(413).send({ message: '上传文件超出允许大小' });
    }

    const targetPath = localStoragePath(objectKey);
    await mkdir(path.dirname(targetPath), { recursive: true });
    try {
      await pipeline(
        request.body as Readable,
        createSizeLimiter(maxSizeBytes),
        fs.createWriteStream(targetPath, { flags: 'wx' }),
      );
    } catch (error) {
      if (isFileExistsError(error)) {
        return reply.code(409).send({ message: '上传对象已存在' });
      }
      await rm(targetPath, { force: true });
      throw error;
    }

    return reply.code(204).send();
  });

  app.get('/api/storage/local/*', async (request, reply) => {
    const { '*': objectKeyParam } = request.params as { '*': string };
    const objectKey = decodeURIComponent(objectKeyParam);
    const query = request.query as LocalStorageQuery;
    if (!verifyLocalStorageSignature({
      method: 'GET',
      objectKey,
      contentType: '',
      maxSizeBytes: parseSafeInteger(query.maxBytes),
      expiresAtSeconds: parseSafeInteger(query.exp),
      signature: query.signature ?? '',
    })) {
      return reply.code(403).send({ message: '读取签名无效或已过期' });
    }

    const targetPath = localStoragePath(objectKey);
    if (!fs.existsSync(targetPath)) {
      return reply.code(404).send({ message: '文件不存在' });
    }

    reply
      .header('Cache-Control', 'private, no-store')
      .type(contentTypeForObjectKey(objectKey));
    if (query.download === '1') {
      reply.header('Content-Disposition', contentDispositionAttachment(query.filename ?? path.basename(objectKey)));
    }
    return reply.send(fs.createReadStream(targetPath));
  });
}

function createSizeLimiter(maxSizeBytes: number) {
  let received = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      received += Buffer.byteLength(chunk);
      if (received > maxSizeBytes) {
        callback(Object.assign(new Error('上传文件超出允许大小'), {
          statusCode: 413,
          exposeMessage: true,
        }));
        return;
      }
      callback(null, chunk);
    },
  });
}

function parseSafeInteger(value: string | string[] | number | undefined) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
}

function normalizeContentType(value: string | undefined) {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function contentTypeForObjectKey(objectKey: string) {
  const extension = path.extname(objectKey).toLowerCase();
  return ({
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
  } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

function isFileExistsError(error: unknown) {
  return Boolean(error) && typeof error === 'object' && (error as { code?: string }).code === 'EEXIST';
}

function contentDispositionAttachment(filename: string) {
  const encoded = encodeURIComponent(filename.slice(0, 255)).replace(/['()]/g, character => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  return `attachment; filename*=UTF-8''${encoded}`;
}
