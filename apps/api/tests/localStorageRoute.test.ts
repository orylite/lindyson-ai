import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('localStorageRoute', () => {
  it('真实 image/png PUT 通过签名验证后流式落盘并可用签名 GET 读取', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lindyson-storage-'));
    temporaryDirectories.push(directory);
    vi.stubEnv('STORAGE_DRIVER', 'local');
    vi.stubEnv('LOCAL_STORAGE_DIR', directory);
    vi.stubEnv('PUBLIC_BASE_URL', 'http://localhost:4300');
    vi.stubEnv('JWT_SECRET', 'test-local-storage-signing-secret');

    const [{ registerLocalStorageRoutes }, { createObjectDownloadUrl, createObjectReadUrl, createUploadSignature }] = await Promise.all([
      import('../src/storage/localStorageRoute.js'),
      import('../src/storage/storageService.js'),
    ]);
    const app = fastify({ logger: false });
    await app.register(registerLocalStorageRoutes);
    const signature = await createUploadSignature({
      objectKey: 'users/00000000-0000-4000-8000-000000000001/upload-staging/session-1/image.png',
      contentType: 'image/png',
      maxSizeBytes: 1024,
    });
    const uploadUrl = new URL(signature.uploadUrl);
    const body = Buffer.from('\x89PNG\r\n\x1a\nreal-image-body', 'binary');

    try {
      const upload = await app.inject({
        method: 'PUT',
        url: `${uploadUrl.pathname}${uploadUrl.search}`,
        headers: { 'content-type': 'image/png' },
        payload: body,
      });
      expect(upload.statusCode).toBe(204);
      await expect(readFile(path.join(directory, signature.objectKey))).resolves.toEqual(body);

      const repeated = await app.inject({
        method: 'PUT',
        url: `${uploadUrl.pathname}${uploadUrl.search}`,
        headers: { 'content-type': 'image/png' },
        payload: Buffer.from('replacement'),
      });
      expect(repeated.statusCode).toBe(409);
      await expect(readFile(path.join(directory, signature.objectKey))).resolves.toEqual(body);

      const readUrl = new URL(await createObjectReadUrl(signature.objectKey));
      const download = await app.inject({
        method: 'GET',
        url: `${readUrl.pathname}${readUrl.search}`,
      });
      expect(download.statusCode).toBe(200);
      expect(download.headers['content-type']).toContain('image/png');
      expect(download.headers['cache-control']).toBe('private, no-store');
      expect(download.rawPayload).toEqual(body);

      const attachmentUrl = new URL(await createObjectDownloadUrl(signature.objectKey, '测试图片.png'));
      const attachment = await app.inject({
        method: 'GET',
        url: `${attachmentUrl.pathname}${attachmentUrl.search}`,
      });
      expect(attachment.statusCode).toBe(200);
      expect(attachment.headers['content-disposition']).toContain("attachment; filename*=UTF-8''");
    } finally {
      await app.close();
    }
  });

  it('拒绝篡改 MIME 或超过签名上限的 PUT', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lindyson-storage-'));
    temporaryDirectories.push(directory);
    vi.stubEnv('STORAGE_DRIVER', 'local');
    vi.stubEnv('LOCAL_STORAGE_DIR', directory);
    vi.stubEnv('PUBLIC_BASE_URL', 'http://localhost:4300');
    vi.stubEnv('JWT_SECRET', 'test-local-storage-signing-secret');

    const [{ registerLocalStorageRoutes }, { createUploadSignature }] = await Promise.all([
      import('../src/storage/localStorageRoute.js'),
      import('../src/storage/storageService.js'),
    ]);
    const app = fastify({ logger: false });
    await app.register(registerLocalStorageRoutes);
    const signature = await createUploadSignature({
      objectKey: 'users/00000000-0000-4000-8000-000000000001/upload-staging/session-2/small.png',
      contentType: 'image/png',
      maxSizeBytes: 4,
    });
    const uploadUrl = new URL(signature.uploadUrl);

    try {
      const wrongMime = await app.inject({
        method: 'PUT',
        url: `${uploadUrl.pathname}${uploadUrl.search}`,
        headers: { 'content-type': 'image/jpeg' },
        payload: Buffer.from('1234'),
      });
      expect(wrongMime.statusCode).toBe(403);

      const tooLarge = await app.inject({
        method: 'PUT',
        url: `${uploadUrl.pathname}${uploadUrl.search}`,
        headers: { 'content-type': 'image/png' },
        payload: Buffer.from('12345'),
      });
      expect(tooLarge.statusCode).toBe(413);
    } finally {
      await app.close();
    }
  });
});
