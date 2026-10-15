import { Readable } from 'node:stream';
import fs, { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockS3Command {
  kind: string;
  input: Record<string, unknown>;
  buildMiddlewares: Array<{
    middleware: (next: (args: unknown) => Promise<unknown>) => (args: unknown) => Promise<unknown>;
    options: Record<string, unknown>;
  }>;
}

const s3MockState = vi.hoisted(() => ({
  send: vi.fn(),
  commands: [] as Array<{ kind: string; input: Record<string, unknown> }>,
  requestHeaders: undefined as Record<string, string> | undefined,
  middlewareOptions: [] as Array<Record<string, unknown>>,
  commandInput: undefined as Record<string, unknown> | undefined,
  bodyFlowingState: undefined as boolean | null | undefined,
  uploadedBody: undefined as string | undefined,
}));

vi.mock('@aws-sdk/client-s3', () => ({
  CopyObjectCommand: createMockCommand('CopyObject'),
  DeleteObjectCommand: createMockCommand('DeleteObject'),
  GetBucketVersioningCommand: createMockCommand('GetBucketVersioning'),
  GetObjectCommand: createMockCommand('GetObject'),
  HeadObjectCommand: createMockCommand('HeadObject'),
  PutObjectCommand: createMockCommand('PutObject'),
  S3Client: vi.fn(function S3Client() {
    return { send: s3MockState.send };
  }),
}));

function createMockCommand(kind: string) {
  return vi.fn(function MockCommand(
    this: MockS3Command & { middlewareStack: { add: (middleware: unknown, options: Record<string, unknown>) => void } },
    input: Record<string, unknown>,
  ) {
    this.kind = kind;
    this.input = input;
    this.buildMiddlewares = [];
    this.middlewareStack = {
      add: (middleware, options) => {
        this.buildMiddlewares.push({
          middleware: middleware as MockS3Command['buildMiddlewares'][number]['middleware'],
          options,
        });
      },
    };
  });
}

const temporaryDirectories: string[] = [];

describe('storageService', () => {
  beforeEach(() => {
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      return {};
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
    s3MockState.send.mockReset();
    s3MockState.commands = [];
    s3MockState.requestHeaders = undefined;
    s3MockState.middlewareOptions = [];
    s3MockState.commandInput = undefined;
    s3MockState.bodyFlowingState = undefined;
    s3MockState.uploadedBody = undefined;
    return Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  });

  it('本地存储读取 URL 会按对象路径逐段编码', async () => {
    vi.stubEnv('STORAGE_DRIVER', 'local');
    vi.stubEnv('PUBLIC_BASE_URL', 'http://localhost:4300');
    const { createObjectReadUrl } = await import('../src/storage/storageService.js');

    const signedUrl = await createObjectReadUrl('users/user-1/素材 A.mp4');
    const parsed = new URL(signedUrl);
    expect(`${parsed.origin}${parsed.pathname}`)
      .toBe('http://localhost:4300/api/storage/local/users/user-1/%E7%B4%A0%E6%9D%90%20A.mp4');
    expect(parsed.searchParams.get('exp')).toMatch(/^\d+$/);
    expect(parsed.searchParams.get('maxBytes')).toBe('0');
    expect(parsed.searchParams.get('signature')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('本地存储能在外发前读取对象真实字节数', async () => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'lindyson-object-size-'));
    temporaryDirectories.push(storageRoot);
    vi.stubEnv('STORAGE_DRIVER', 'local');
    vi.stubEnv('LOCAL_STORAGE_DIR', storageRoot);
    const objectKey = 'users/user-1/product-thumb.webp';
    await mkdir(path.join(storageRoot, 'users/user-1'), { recursive: true });
    await writeFile(path.join(storageRoot, objectKey), Buffer.alloc(321));

    const { getStoredObjectSize } = await import('../src/storage/storageService.js');

    await expect(getStoredObjectSize(objectKey)).resolves.toBe(321);
  });

  it('TOS 存储通过 HEAD 获取缩略图真实字节数', async () => {
    vi.stubEnv('STORAGE_DRIVER', 'tos');
    vi.stubEnv('TOS_ENDPOINT', 'https://tos-cn-beijing.volces.com');
    vi.stubEnv('TOS_BUCKET', 'private-bucket');
    vi.stubEnv('TOS_ACCESS_KEY_ID', 'access-key');
    vi.stubEnv('TOS_SECRET_ACCESS_KEY', 'secret-key');
    s3MockState.send.mockImplementationOnce(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      return { ContentLength: 654_321 };
    });

    const { getStoredObjectSize } = await import('../src/storage/storageService.js');

    await expect(getStoredObjectSize('users/user-1/product-thumb.webp'))
      .resolves.toBe(654_321);
    expect(s3MockState.commands).toContainEqual({
      kind: 'HeadObject',
      input: {
        Bucket: 'private-bucket',
        Key: 'users/user-1/product-thumb.webp',
      },
    });
  });

  it('本地媒体处理直接使用共享卷文件路径，不回连公开地址', async () => {
    vi.stubEnv('STORAGE_DRIVER', 'local');
    vi.stubEnv('LOCAL_STORAGE_DIR', '/tmp/lindyson-processing-storage');
    vi.stubEnv('PUBLIC_BASE_URL', 'http://127.0.0.1:8080');
    const { resolveObjectProcessingInput } = await import('../src/storage/storageService.js');

    await expect(resolveObjectProcessingInput('users/user-1/video.mp4')).resolves.toBe(
      path.resolve('/tmp/lindyson-processing-storage/users/user-1/video.mp4'),
    );
  });

  it('TOS 上传签名使用带大小范围的 PostObject Policy', async () => {
    vi.stubEnv('STORAGE_DRIVER', 'tos');
    vi.stubEnv('TOS_ENDPOINT', 'https://tos-s3-cn-guangzhou.volces.com');
    vi.stubEnv('TOS_REGION', 'cn-guangzhou');
    vi.stubEnv('TOS_BUCKET', 'bucket-1');
    vi.stubEnv('TOS_ACCESS_KEY_ID', 'test-access-key');
    vi.stubEnv('TOS_SECRET_ACCESS_KEY', 'test-secret-key-never-return');
    const { createUploadSignature } = await import('../src/storage/storageService.js');

    const signature = await createUploadSignature({
      objectKey: 'users/00000000-0000-4000-8000-000000000001/upload-staging/session-1/material.png',
      contentType: 'Image/PNG',
      maxSizeBytes: 4096,
    });

    expect(signature).toMatchObject({
      driver: 'tos',
      method: 'POST',
      uploadUrl: 'https://bucket-1.tos-cn-guangzhou.volces.com',
      headers: {},
      maxSizeBytes: 4096,
    });
    if (signature.driver !== 'tos') throw new Error('预期返回 TOS POST 签名');
    expect(signature.fields).toMatchObject({
      key: signature.objectKey,
      'content-type': 'image/png',
      'x-tos-forbid-overwrite': 'true',
      'x-tos-algorithm': 'TOS4-HMAC-SHA256',
    });

    const policy = JSON.parse(Buffer.from(signature.fields.policy!, 'base64').toString('utf8')) as {
      expiration: string;
      conditions: unknown[];
    };
    expect(policy.conditions).toContainEqual({ bucket: 'bucket-1' });
    expect(policy.conditions).toContainEqual({ key: signature.objectKey });
    expect(policy.conditions).toContainEqual({ 'content-type': 'image/png' });
    expect(policy.conditions).toContainEqual({ 'x-tos-forbid-overwrite': 'true' });
    expect(policy.conditions).toContainEqual(['content-length-range', 1, 4096]);
    expect(Math.abs(new Date(policy.expiration).getTime() - new Date(signature.expiresAt).getTime())).toBeLessThan(1000);
    const shortDate = signature.fields['x-tos-date']!.slice(0, 8);
    const dateKey = createHmac('sha256', 'test-secret-key-never-return').update(shortDate).digest();
    const regionKey = createHmac('sha256', dateKey).update('cn-guangzhou').digest();
    const serviceKey = createHmac('sha256', regionKey).update('tos').digest();
    const signingKey = createHmac('sha256', serviceKey).update('request').digest();
    expect(signature.fields['x-tos-signature']).toBe(
      createHmac('sha256', signingKey).update(signature.fields.policy!).digest('hex'),
    );
    expect(JSON.stringify(signature)).not.toContain('test-secret-key-never-return');
    expect(s3MockState.commands).toEqual([{
      kind: 'GetBucketVersioning',
      input: { Bucket: 'bucket-1' },
    }]);
  });

  it('上传签名必须由业务层传入稳定 object key，不再生成日期或随机 fallback', async () => {
    vi.stubEnv('STORAGE_DRIVER', 'local');
    const { createUploadSignature } = await import('../src/storage/storageService.js');

    await expect(createUploadSignature({
      objectKey: '',
      contentType: 'image/png',
    })).rejects.toThrow('上传对象 key 不能为空');
  });

  it('本地存储 readiness 不访问 TOS，TOS readiness 复用版本状态 fail-closed 检查', async () => {
    vi.stubEnv('STORAGE_DRIVER', 'local');
    let storage = await import('../src/storage/storageService.js');
    await expect(storage.assertStorageReady()).resolves.toBeUndefined();
    expect(s3MockState.commands).toEqual([]);

    vi.resetModules();
    stubTosEnv();
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      return command.kind === 'GetBucketVersioning' ? { Status: 'Suspended' } : {};
    });
    storage = await import('../src/storage/storageService.js');
    await expect(storage.assertStorageReady()).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_VERSIONING_UNSAFE',
      statusCode: 503,
    });
    expect(s3MockState.commands.map(command => command.kind)).toEqual(['GetBucketVersioning']);
  });

  it.each(['Enabled', 'Suspended'] as const)('TOS 版本控制为 %s 时阻止签发不可覆盖上传表单', async status => {
    stubTosEnv();
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      return command.kind === 'GetBucketVersioning' ? { Status: status } : {};
    });
    const { createUploadSignature } = await import('../src/storage/storageService.js');

    await expect(createUploadSignature({
      objectKey: 'users/user-1/upload-staging/session-1/cover.png',
      contentType: 'image/png',
    })).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_VERSIONING_UNSAFE',
      statusCode: 503,
    });
    expect(s3MockState.commands.map(command => command.kind)).toEqual(['GetBucketVersioning']);
  });

  it('TOS 未启用版本控制的安全结果按 bucket 短期缓存', async () => {
    stubTosEnv();
    const { createUploadSignature } = await import('../src/storage/storageService.js');

    await createUploadSignature({
      objectKey: 'users/user-1/upload-staging/session-1/first.png',
      contentType: 'image/png',
    });
    await createUploadSignature({
      objectKey: 'users/user-1/upload-staging/session-2/second.png',
      contentType: 'image/png',
    });

    expect(s3MockState.commands.filter(command => command.kind === 'GetBucketVersioning')).toHaveLength(1);
  });

  it('TOS 安全缓存过了新鲜期后直接放行，只在后台发起一次重新查询', async () => {
    stubTosEnv();
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const pendingCheck = deferred();
    let checks = 0;
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      if (command.kind !== 'GetBucketVersioning') return {};
      checks += 1;
      if (checks === 2) await pendingCheck.promise;
      return {};
    });
    const { createUploadSignature } = await import('../src/storage/storageService.js');

    await createUploadSignature({ objectKey: 'users/user-1/upload-staging/session-1/a.png', contentType: 'image/png' });
    now += 31_000;
    // 后台查询挂起时，两次签发都不等待它。
    await expect(createUploadSignature({
      objectKey: 'users/user-1/upload-staging/session-1/b.png',
      contentType: 'image/png',
    })).resolves.toMatchObject({ driver: 'tos' });
    await expect(createUploadSignature({
      objectKey: 'users/user-1/upload-staging/session-1/c.png',
      contentType: 'image/png',
    })).resolves.toMatchObject({ driver: 'tos' });
    expect(checks).toBe(2);

    pendingCheck.resolve();
    await flushBackgroundTasks();
    await createUploadSignature({ objectKey: 'users/user-1/upload-staging/session-1/d.png', contentType: 'image/png' });
    expect(checks).toBe(2);
  });

  it('TOS 后台查询发现版本控制已开启后，后续写入重新同步检查并 fail-closed', async () => {
    stubTosEnv();
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let checks = 0;
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      if (command.kind !== 'GetBucketVersioning') return {};
      checks += 1;
      return checks === 1 ? {} : { Status: 'Enabled' };
    });
    const { createUploadSignature } = await import('../src/storage/storageService.js');

    await createUploadSignature({ objectKey: 'users/user-1/upload-staging/session-1/a.png', contentType: 'image/png' });
    now += 31_000;
    await createUploadSignature({ objectKey: 'users/user-1/upload-staging/session-1/b.png', contentType: 'image/png' });
    await flushBackgroundTasks();

    await expect(createUploadSignature({
      objectKey: 'users/user-1/upload-staging/session-1/c.png',
      contentType: 'image/png',
    })).rejects.toMatchObject({ code: 'STORAGE_BUCKET_VERSIONING_UNSAFE' });
    expect(checks).toBe(3);
  });

  it('TOS 安全缓存超过宽限期后重新同步检查', async () => {
    stubTosEnv();
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let checks = 0;
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      if (command.kind !== 'GetBucketVersioning') return {};
      checks += 1;
      return checks === 1 ? {} : { Status: 'Suspended' };
    });
    const { createUploadSignature } = await import('../src/storage/storageService.js');

    await createUploadSignature({ objectKey: 'users/user-1/upload-staging/session-1/a.png', contentType: 'image/png' });
    now += 24 * 60 * 60_000 + 1;

    await expect(createUploadSignature({
      objectKey: 'users/user-1/upload-staging/session-1/b.png',
      contentType: 'image/png',
    })).rejects.toMatchObject({ code: 'STORAGE_BUCKET_VERSIONING_UNSAFE' });
    expect(checks).toBe(2);
  });

  it('TOS S3 兼容接口以空字符串表示从未启用版本控制时允许不可覆盖写入', async () => {
    stubTosEnv();
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      return command.kind === 'GetBucketVersioning' ? { Status: '' } : {};
    });
    const { assertStorageReady } = await import('../src/storage/storageService.js');

    await expect(assertStorageReady()).resolves.toBeUndefined();
    expect(s3MockState.commands.map(command => command.kind)).toEqual(['GetBucketVersioning']);
  });

  it('TOS 返回未知非空版本状态时仍 fail-closed', async () => {
    stubTosEnv();
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      return command.kind === 'GetBucketVersioning' ? { Status: 'Unknown' } : {};
    });
    const { assertStorageReady } = await import('../src/storage/storageService.js');

    await expect(assertStorageReady()).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_VERSIONING_UNSAFE',
      statusCode: 503,
    });
    expect(s3MockState.commands.map(command => command.kind)).toEqual(['GetBucketVersioning']);
  });

  it('TOS 不安全状态不进入正向缓存，修正配置后下一次会重新查询', async () => {
    stubTosEnv();
    let checks = 0;
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      if (command.kind !== 'GetBucketVersioning') return {};
      checks += 1;
      return checks === 1 ? { Status: 'Enabled' } : {};
    });
    const { createUploadSignature } = await import('../src/storage/storageService.js');

    await expect(createUploadSignature({
      objectKey: 'users/user-1/upload-staging/session-1/blocked.png',
      contentType: 'image/png',
    })).rejects.toMatchObject({ code: 'STORAGE_BUCKET_VERSIONING_UNSAFE' });
    await expect(createUploadSignature({
      objectKey: 'users/user-1/upload-staging/session-1/recovered.png',
      contentType: 'image/png',
    })).resolves.toMatchObject({ driver: 'tos' });
    expect(checks).toBe(2);
  });

  it('TOS 版本状态查询失败不进入正向缓存，权限恢复后下一次会重新查询', async () => {
    stubTosEnv();
    let checks = 0;
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      if (command.kind !== 'GetBucketVersioning') return {};
      checks += 1;
      if (checks === 1) throw new Error('AccessDenied');
      return {};
    });
    const { createUploadSignature } = await import('../src/storage/storageService.js');

    await expect(createUploadSignature({
      objectKey: 'users/user-1/upload-staging/session-1/blocked.png',
      contentType: 'image/png',
    })).rejects.toMatchObject({ code: 'STORAGE_BUCKET_VERSIONING_UNVERIFIED' });
    await expect(createUploadSignature({
      objectKey: 'users/user-1/upload-staging/session-1/recovered.png',
      contentType: 'image/png',
    })).resolves.toMatchObject({ driver: 'tos' });
    expect(checks).toBe(2);
  });

  it('本地封口使用 COPYFILE_EXCL：相同内容重放成功，不同内容冲突且不覆盖目标', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lindyson-storage-copy-'));
    temporaryDirectories.push(directory);
    vi.stubEnv('STORAGE_DRIVER', 'local');
    vi.stubEnv('LOCAL_STORAGE_DIR', directory);
    const { copyStoredObject, localStoragePath } = await import('../src/storage/storageService.js');
    const sourceKey = 'users/user-1/upload-staging/session-1/video.mp4';
    const targetKey = 'users/user-1/uploads/session-1/video.mp4';
    const sourcePath = localStoragePath(sourceKey);
    const targetPath = localStoragePath(targetKey);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, 'winner-content');

    await expect(copyStoredObject(sourceKey, targetKey)).resolves.toBeUndefined();
    await expect(copyStoredObject(sourceKey, targetKey)).resolves.toBeUndefined();
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('winner-content');

    await writeFile(sourcePath, 'loser--content');
    await expect(copyStoredObject(sourceKey, targetKey)).rejects.toMatchObject({
      code: 'STORAGE_IMMUTABLE_CONFLICT',
      statusCode: 409,
    });
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('winner-content');
  });

  it('本地 Buffer 和 Stream 写入均不覆盖：相同内容重放成功，不同内容冲突', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lindyson-storage-put-'));
    temporaryDirectories.push(directory);
    vi.stubEnv('STORAGE_DRIVER', 'local');
    vi.stubEnv('LOCAL_STORAGE_DIR', directory);
    const { localStoragePath, uploadObjectBuffer, uploadObjectStream } = await import('../src/storage/storageService.js');
    const bufferKey = 'generated/image/user-1/run-1.png';
    const streamKey = 'generated/video/user-1/run-1.mp4';

    await expect(uploadObjectBuffer({
      objectKey: bufferKey,
      body: Buffer.from('buffer-winner'),
      contentType: 'image/png',
    })).resolves.toMatchObject({ objectKey: bufferKey });
    await expect(uploadObjectBuffer({
      objectKey: bufferKey,
      body: Buffer.from('buffer-winner'),
      contentType: 'image/png',
    })).resolves.toMatchObject({ objectKey: bufferKey });
    await expect(uploadObjectBuffer({
      objectKey: bufferKey,
      body: Buffer.from('buffer--loser'),
      contentType: 'image/png',
    })).rejects.toMatchObject({ code: 'STORAGE_IMMUTABLE_CONFLICT' });
    await expect(readFile(localStoragePath(bufferKey), 'utf8')).resolves.toBe('buffer-winner');

    await expect(uploadObjectStream({
      objectKey: streamKey,
      body: Readable.from(['stream-winner']),
      contentType: 'video/mp4',
      contentLength: 13,
    })).resolves.toMatchObject({ objectKey: streamKey, sizeBytes: 13 });
    await expect(uploadObjectStream({
      objectKey: streamKey,
      body: Readable.from(['stream-winner']),
      contentType: 'video/mp4',
      contentLength: 13,
    })).resolves.toMatchObject({ objectKey: streamKey, sizeBytes: 13 });
    await expect(uploadObjectStream({
      objectKey: streamKey,
      body: Readable.from(['stream--loser']),
      contentType: 'video/mp4',
      contentLength: 13,
    })).rejects.toMatchObject({ code: 'STORAGE_IMMUTABLE_CONFLICT' });
    await expect(readFile(localStoragePath(streamKey), 'utf8')).resolves.toBe('stream-winner');
  });

  it('TOS 封口使用 SDK 源 ETag/目标不存在条件，并在 build 阶段只注入禁止覆盖头', async () => {
    stubTosEnv();
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      if (command.kind === 'HeadObject') {
        return { ContentLength: 14, ETag: '"etag-source"' };
      }
      if (command.kind === 'CopyObject') {
        await runBuildMiddlewares(command, {
          'x-amz-copy-source-if-match': String(command.input.CopySourceIfMatch),
        });
      }
      return {};
    });
    const { copyStoredObject } = await import('../src/storage/storageService.js');

    await copyStoredObject(
      'users/user-1/upload-staging/session-1/video.mp4',
      'users/user-1/uploads/session-1/video.mp4',
    );

    const copy = s3MockState.commands.find(command => command.kind === 'CopyObject');
    expect(copy?.input).toMatchObject({
      Bucket: 'bucket-1',
      Key: 'users/user-1/uploads/session-1/video.mp4',
      CopySource: 'bucket-1/users/user-1/upload-staging/session-1/video.mp4',
      CopySourceIfMatch: '"etag-source"',
      IfNoneMatch: '*',
    });
    expect(s3MockState.requestHeaders).toMatchObject({
      'x-amz-copy-source-if-match': '"etag-source"',
      'x-tos-forbid-overwrite': 'true',
    });
    expect(s3MockState.requestHeaders).not.toHaveProperty('x-tos-copy-source-if-match');
    expect(s3MockState.middlewareOptions).toContainEqual(expect.objectContaining({
      step: 'build',
      priority: 'low',
    }));
  });

  it('TOS Buffer 写入使用 Content-MD5 与不可覆盖条件，仅相同目标视为重放', async () => {
    stubTosEnv();
    const body = Buffer.from('buffer-winner');
    const differentBody = Buffer.from('buffer--loser');
    const md5Base64 = createHash('md5').update(body).digest('base64');
    const sha256 = createHash('sha256').update(body).digest('hex');
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      if (command.kind === 'PutObject') {
        await runBuildMiddlewares(command, {
          'content-md5': String(command.input.ContentMD5),
          'if-none-match': String(command.input.IfNoneMatch),
        });
        throw Object.assign(new Error('对象已存在'), { $metadata: { httpStatusCode: 412 } });
      }
      if (command.kind === 'HeadObject') {
        return {
          ContentLength: body.length,
          ETag: '"provider-etag-is-not-assumed-to-be-md5"',
          Metadata: { 'lindyson-sha256': sha256 },
        };
      }
      return {};
    });
    const { uploadObjectBuffer } = await import('../src/storage/storageService.js');
    const objectKey = 'generated/image/user-1/run-1.png';

    await expect(uploadObjectBuffer({ objectKey, body, contentType: 'image/png' }))
      .resolves.toMatchObject({ objectKey });
    const put = s3MockState.commands.find(command => command.kind === 'PutObject');
    expect(put?.input).toMatchObject({
      Bucket: 'bucket-1',
      Key: objectKey,
      ContentLength: body.length,
      ContentMD5: md5Base64,
      Metadata: { 'lindyson-sha256': sha256 },
      IfNoneMatch: '*',
    });
    expect(s3MockState.requestHeaders).toMatchObject({
      'content-md5': md5Base64,
      'if-none-match': '*',
      'x-tos-forbid-overwrite': 'true',
    });

    await expect(uploadObjectBuffer({ objectKey, body: differentBody, contentType: 'image/png' }))
      .rejects.toMatchObject({ code: 'STORAGE_IMMUTABLE_CONFLICT', statusCode: 409 });
  });

  it('TOS 复制返回 409/412 时只有源和目标的大小、ETag 都一致才视为幂等重放', async () => {
    stubTosEnv();
    let copyAttempts = 0;
    let targetEtag = '"etag-source"';
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      if (command.kind === 'HeadObject') {
        return {
          ContentLength: 14,
          ETag: command.input.Key === 'users/user-1/uploads/session-1/video.mp4'
            ? targetEtag
            : '"etag-source"',
        };
      }
      if (command.kind === 'CopyObject') {
        copyAttempts += 1;
        throw Object.assign(new Error('对象已存在'), { $metadata: { httpStatusCode: 409 } });
      }
      return {};
    });
    const { copyStoredObject } = await import('../src/storage/storageService.js');
    const sourceKey = 'users/user-1/upload-staging/session-1/video.mp4';
    const targetKey = 'users/user-1/uploads/session-1/video.mp4';

    await expect(copyStoredObject(sourceKey, targetKey)).resolves.toBeUndefined();
    expect(copyAttempts).toBe(1);

    targetEtag = '"different-target"';
    await expect(copyStoredObject(sourceKey, targetKey)).rejects.toMatchObject({
      code: 'STORAGE_IMMUTABLE_CONFLICT',
      statusCode: 409,
    });
    expect(copyAttempts).toBe(2);
  });

  it('TOS 复制冲突后即使目标追上了新源，也不能冒充最初源对象的幂等结果', async () => {
    stubTosEnv();
    let sourceHeadCount = 0;
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      if (command.kind === 'HeadObject') {
        if (command.input.Key === 'target.mp4') {
          return { ContentLength: 15, ETag: '"mutated-source"' };
        }
        sourceHeadCount += 1;
        return sourceHeadCount === 1
          ? { ContentLength: 14, ETag: '"original-source"' }
          : { ContentLength: 15, ETag: '"mutated-source"' };
      }
      if (command.kind === 'CopyObject') {
        throw Object.assign(new Error('前置条件失败'), { $metadata: { httpStatusCode: 412 } });
      }
      return {};
    });
    const { copyStoredObject } = await import('../src/storage/storageService.js');

    await expect(copyStoredObject('source.mp4', 'target.mp4')).rejects.toMatchObject({
      code: 'STORAGE_IMMUTABLE_CONFLICT',
      statusCode: 409,
    });
    expect(sourceHeadCount).toBe(2);
  });

  it('TOS 存储桶已暂停版本控制时同样阻止服务端不可覆盖复制', async () => {
    stubTosEnv();
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      return command.kind === 'GetBucketVersioning' ? { Status: 'Suspended' } : {};
    });
    const { copyStoredObject } = await import('../src/storage/storageService.js');

    await expect(copyStoredObject('source.mp4', 'target.mp4')).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_VERSIONING_UNSAFE',
    });
    expect(s3MockState.commands.map(command => command.kind)).toEqual(['GetBucketVersioning']);
  });

  it('TOS 流式上传不会在 SDK 读取前把 Body 置为 flowing，并保留元数据和字节统计', async () => {
    stubTosEnv();
    vi.stubEnv('STORAGE_PUBLIC_BASE_URL', 'https://cdn.example.com');
    let stagedPath = '';
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      if (command.kind === 'GetBucketVersioning') return {};
      if (command.kind !== 'PutObject') throw new Error(`未预期的命令 ${command.kind}`);
      s3MockState.commandInput = command.input;
      await runBuildMiddlewares(command, {
        'content-md5': String(command.input.ContentMD5),
        'if-none-match': String(command.input.IfNoneMatch),
      });

      const body = command.input.Body;
      if (!(body instanceof Readable)) {
        throw new Error('PutObjectCommand Body 不是 Node.js Readable。');
      }

      stagedPath = String((body as Readable & { path?: string }).path ?? '');
      s3MockState.bodyFlowingState = body.readableFlowing;
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      s3MockState.uploadedBody = Buffer.concat(chunks).toString('utf8');
      return {};
    });
    const { uploadObjectStream } = await import('../src/storage/storageService.js');
    const expectedBody = Buffer.from('hello seedance');
    const expectedMd5 = createHash('md5').update(expectedBody).digest('base64');
    const expectedSha256 = createHash('sha256').update(expectedBody).digest('hex');

    const result = await uploadObjectStream({
      objectKey: 'generated/video/user-1/task-1.mp4',
      body: Readable.from(['hello ', 'seedance']),
      contentType: 'video/mp4',
      contentLength: 14,
    });

    expect(s3MockState.commandInput).toMatchObject({
      Bucket: 'bucket-1',
      Key: 'generated/video/user-1/task-1.mp4',
      ContentType: 'video/mp4',
      ContentLength: 14,
      ContentMD5: expectedMd5,
      Metadata: { 'lindyson-sha256': expectedSha256 },
      IfNoneMatch: '*',
    });
    expect(s3MockState.requestHeaders).toMatchObject({
      'content-md5': expectedMd5,
      'if-none-match': '*',
      'x-tos-forbid-overwrite': 'true',
    });
    expect(s3MockState.bodyFlowingState).not.toBe(true);
    expect(s3MockState.uploadedBody).toBe('hello seedance');
    expect(result).toEqual({
      objectKey: 'generated/video/user-1/task-1.mp4',
      publicUrl: null,
      sizeBytes: 14,
    });
    expect(stagedPath).not.toBe('');
    await expect(access(stagedPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('TOS Stream 冲突仅接受相同内容重放，不同内容保持冲突且两次都清理临时文件', async () => {
    stubTosEnv();
    const winner = Buffer.from('stream-winner');
    const loser = Buffer.from('stream--loser');
    const winnerSha256 = createHash('sha256').update(winner).digest('hex');
    const stagedPaths: string[] = [];
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      s3MockState.commands.push({ kind: command.kind, input: command.input });
      if (command.kind === 'GetBucketVersioning') return {};
      if (command.kind === 'PutObject') {
        const body = command.input.Body;
        if (!(body instanceof Readable)) throw new Error('PutObjectCommand Body 不是 Node.js Readable。');
        stagedPaths.push(String((body as Readable & { path?: string }).path ?? ''));
        body.destroy();
        throw Object.assign(new Error('对象已存在'), { $metadata: { httpStatusCode: 412 } });
      }
      if (command.kind === 'HeadObject') {
        return {
          ContentLength: winner.length,
          ETag: '"provider-etag-is-not-assumed-to-be-md5"',
          Metadata: { 'lindyson-sha256': winnerSha256 },
        };
      }
      throw new Error(`未预期的命令 ${command.kind}`);
    });
    const { uploadObjectStream } = await import('../src/storage/storageService.js');
    const objectKey = 'generated/video/user-1/task-replay.mp4';

    await expect(uploadObjectStream({
      objectKey,
      body: Readable.from(winner),
      contentType: 'video/mp4',
      contentLength: winner.length,
    })).resolves.toMatchObject({ objectKey, sizeBytes: winner.length });
    await expect(uploadObjectStream({
      objectKey,
      body: Readable.from(loser),
      contentType: 'video/mp4',
      contentLength: loser.length,
    })).rejects.toMatchObject({ code: 'STORAGE_IMMUTABLE_CONFLICT', statusCode: 409 });

    expect(stagedPaths).toHaveLength(2);
    await Promise.all(stagedPaths.map(stagedPath => (
      expect(access(stagedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    )));
  });

  it('流暂存阶段取消会关闭输入并清理临时文件，不发送存储请求', async () => {
    stubTosEnv();
    const stagingRoot = await mockUploadTemporaryRoot();
    const controller = new AbortController();
    const reason = new Error('导入已超时');
    const reading = deferred();
    const body = new Readable({ read() { reading.resolve(); } });
    const { uploadObjectStream } = await import('../src/storage/storageService.js');
    const result = uploadObjectStream({
      objectKey: 'users/user-1/imports/cancel-stage.png',
      body,
      contentType: 'image/png',
      signal: controller.signal,
    });
    const rejected = expect(result).rejects.toBe(reason);
    await reading.promise;
    controller.abort(reason);

    await rejected;
    expect(body.destroyed).toBe(true);
    expect(s3MockState.send).not.toHaveBeenCalled();
    expect(await readdir(stagingRoot)).toEqual([]);
  });

  it('调用前已取消的流不产生存储写入，并释放输入与暂存目录', async () => {
    stubTosEnv();
    const stagingRoot = await mockUploadTemporaryRoot();
    const controller = new AbortController();
    const reason = new Error('worker 已退出');
    controller.abort(reason);
    const body = Readable.from('image-content');
    const { uploadObjectStream } = await import('../src/storage/storageService.js');

    await expect(uploadObjectStream({
      objectKey: 'users/user-1/imports/already-cancelled.png',
      body,
      contentType: 'image/png',
      signal: controller.signal,
    })).rejects.toBe(reason);

    expect(body.destroyed).toBe(true);
    expect(s3MockState.send).not.toHaveBeenCalled();
    expect(await readdir(stagingRoot)).toEqual([]);
  });

  it.each(['GetBucketVersioning', 'PutObject', 'HeadObject'])(
    'TOS %s 阶段收到同一取消信号，取消后关闭文件流并清理暂存目录',
    async cancelledCommand => {
      stubTosEnv();
      const stagingRoot = await mockUploadTemporaryRoot();
      const controller = new AbortController();
      const reason = new Error('导入任务已取消');
      const reached = deferred();
      let uploadBody: (Readable & { closed: boolean }) | undefined;
      s3MockState.send.mockImplementation(async (
        command: MockS3Command,
        options?: { abortSignal?: AbortSignal },
      ) => {
        s3MockState.commands.push({ kind: command.kind, input: command.input });
        expect(options?.abortSignal).toBe(controller.signal);
        if (command.kind === 'PutObject') {
          uploadBody = command.input.Body as typeof uploadBody;
        }
        if (command.kind === cancelledCommand) {
          reached.resolve();
          return new Promise((_resolve, reject) => {
            options!.abortSignal!.addEventListener('abort', () => reject(new Error('SDK 请求已中止')), { once: true });
          });
        }
        if (command.kind === 'PutObject') {
          throw Object.assign(new Error('对象已存在'), { $metadata: { httpStatusCode: 412 } });
        }
        return {};
      });
      const { uploadObjectStream } = await import('../src/storage/storageService.js');
      const result = uploadObjectStream({
        objectKey: 'users/user-1/imports/cancel-tos.png',
        body: Readable.from('image-content'),
        contentType: 'image/png',
        signal: controller.signal,
      });
      const rejected = expect(result).rejects.toBe(reason);
      await reached.promise;
      controller.abort(reason);

      await rejected;
      const expectedCommands = ['GetBucketVersioning', 'PutObject', 'HeadObject'];
      expect(s3MockState.commands.map(command => command.kind))
        .toEqual(expectedCommands.slice(0, expectedCommands.indexOf(cancelledCommand) + 1));
      if (uploadBody) expect(uploadBody.closed).toBe(true);
      expect(await readdir(stagingRoot)).toEqual([]);
    },
  );

  it('TOS 写入成功响应与取消同时到达时，仍返回取消而非上传成功', async () => {
    stubTosEnv();
    const stagingRoot = await mockUploadTemporaryRoot();
    const controller = new AbortController();
    const reason = new Error('任务租约失效');
    s3MockState.send.mockImplementation(async (command: MockS3Command) => {
      if (command.kind === 'PutObject') controller.abort(reason);
      return {};
    });
    const { uploadObjectStream } = await import('../src/storage/storageService.js');

    await expect(uploadObjectStream({
      objectKey: 'users/user-1/imports/cancel-after-put.png',
      body: Readable.from('image-content'),
      contentType: 'image/png',
      signal: controller.signal,
    })).rejects.toBe(reason);

    expect(await readdir(stagingRoot)).toEqual([]);
  });

  it('本地复制完成前发生取消，不将已取消的上传报告为成功', async () => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'lindyson-cancel-local-'));
    temporaryDirectories.push(storageRoot);
    vi.stubEnv('STORAGE_DRIVER', 'local');
    vi.stubEnv('LOCAL_STORAGE_DIR', storageRoot);
    const stagingRoot = await mockUploadTemporaryRoot();
    const controller = new AbortController();
    const reason = new Error('导入超时');
    const originalCopyFile = fs.copyFile;
    vi.spyOn(fs, 'copyFile').mockImplementation(async (...args) => {
      await originalCopyFile(...args);
      controller.abort(reason);
    });
    const { uploadObjectStream } = await import('../src/storage/storageService.js');

    await expect(uploadObjectStream({
      objectKey: 'users/user-1/imports/cancel-local.png',
      body: Readable.from('image-content'),
      contentType: 'image/png',
      signal: controller.signal,
    })).rejects.toBe(reason);

    expect(await readdir(stagingRoot)).toEqual([]);
  });
});

async function mockUploadTemporaryRoot() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lindyson-upload-cancellation-'));
  temporaryDirectories.push(directory);
  vi.spyOn(os, 'tmpdir').mockReturnValue(directory);
  return directory;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(settle => { resolve = settle; });
  return { promise, resolve };
}

async function flushBackgroundTasks() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise(settle => setImmediate(settle));
  }
}

function stubTosEnv() {
  vi.stubEnv('STORAGE_DRIVER', 'tos');
  vi.stubEnv('TOS_ENDPOINT', 'https://tos-s3-cn-guangzhou.volces.com');
  vi.stubEnv('TOS_REGION', 'cn-guangzhou');
  vi.stubEnv('TOS_BUCKET', 'bucket-1');
  vi.stubEnv('TOS_ACCESS_KEY_ID', 'test-access-key');
  vi.stubEnv('TOS_SECRET_ACCESS_KEY', 'test-secret-key');
}

async function runBuildMiddlewares(command: MockS3Command, initialHeaders: Record<string, string> = {}) {
  let next: (args: unknown) => Promise<unknown> = async (args: unknown) => {
    const request = (args as { request: { headers: Record<string, string> } }).request;
    s3MockState.requestHeaders = { ...request.headers };
    return {};
  };
  for (const entry of [...command.buildMiddlewares].reverse()) {
    s3MockState.middlewareOptions.push(entry.options);
    next = entry.middleware(next);
  }
  await next({ request: { headers: { ...initialHeaders } } });
}
