import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  createUpload: vi.fn(),
  queueUpload: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  connection: vi.fn(),
}));
vi.mock('../src/config/env.js', () => ({ env: {
  MCP_FILE_ENCRYPTION_KEY: 'test-import-encryption-key',
  MCP_IMPORT_GLOBAL_CONCURRENCY: 4,
  MCP_IMPORT_USER_CONCURRENCY: 2,
} }));
vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.query },
  withTransaction: async (callback: (client: unknown) => unknown) => callback({ query: mocks.query }),
}));
vi.mock('../src/domain/uploadSessionService.js', () => ({
  createOrReplayUploadSession: mocks.createUpload,
  queueUploadCompletion: mocks.queueUpload,
}));
vi.mock('../src/storage/storageService.js', () => ({ uploadObjectStream: mocks.upload }));
vi.mock('../src/queues/mcpImportQueue.js', () => ({ enqueueMcpImport: vi.fn() }));
vi.mock('../src/mcp/fileDownload.js', () => ({
  downloadPublicFile: mocks.download,
  assertPublicHttpsUrl: vi.fn(),
}));
vi.mock('file-type', () => ({ fileTypeFromFile: async () => ({ mime: 'image/png', ext: 'png' }) }));
vi.mock('../src/mcp/security.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertMcpConnection: mocks.connection,
}));

import { processMcpImport } from '../src/mcp/fileImports.js';
import { seal } from '../src/mcp/security.js';

describe('MCP 附件上传取消与租约交接', () => {
  const userId = randomUUID();
  const importId = randomUUID();
  const connectionId = randomUUID();
  let currentLease: string | null;
  let status: string;
  let leaseActive: boolean;
  let downloadPath: string;
  let queued: boolean;

  beforeEach(() => {
    vi.resetAllMocks();
    currentLease = null;
    status = 'queued';
    leaseActive = true;
    downloadPath = '';
    queued = false;
    mocks.connection.mockResolvedValue({ userId, connectionId, authVersion: 1, scopes: ['assets:write'] });
    mocks.query.mockImplementation(async (sql: string, values: string[] = []) => {
      if (sql.includes('pg_advisory')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('SELECT * FROM mcp_file_imports')) return { rows: [{
        id: importId, user_id: userId, connection_id: connectionId, file_id: 'chat-image',
        filename: 'image.png', declared_type: 'image/png',
        source_encrypted: seal('https://files.example/image', 'test-import-encryption-key', `mcp-file:${userId}:chat-image`),
      }] };
      if (sql.includes('count(*) AS total')) return { rows: [{ total: '0', owned: '0' }] };
      if (sql.includes("SET status='downloading'")) {
        currentLease = values[1]!;
        status = 'downloading';
        return { rowCount: 1 };
      }
      if (sql.includes('SET upload_session_id=')) {
        expect(sql).toContain('lease_until>clock_timestamp()');
        return { rowCount: leaseActive && currentLease === values[1] ? 1 : 0 };
      }
      if (sql.includes("SET status='processing'")) {
        expect(sql).toContain("status='downloading' AND lease_until>clock_timestamp()");
        if (!leaseActive || status !== 'downloading' || currentLease !== values[1]) return { rowCount: 0 };
        status = 'processing';
        currentLease = null;
        return { rowCount: 1 };
      }
      if (sql.includes("SET status='failed'")) {
        if (currentLease !== values[1]) return { rowCount: 0 };
        status = 'failed';
        currentLease = null;
        return { rowCount: 1 };
      }
      throw new Error(`意外查询：${sql}`);
    });
    mocks.download.mockImplementation(async (_source, filename) => {
      downloadPath = filename;
      await fs.writeFile(filename, 'media');
      return { sizeBytes: 5 };
    });
    mocks.createUpload.mockResolvedValue({ session: { id: 'upload-session' }, signature: { objectKey: 'staging/image.png' } });
    mocks.upload.mockImplementation(async ({ body }) => {
      for await (const _chunk of body) { /* 消费真实文件流，验证清理时流已经关闭。 */ }
    });
    mocks.queueUpload.mockImplementation(async (_user, _session, options) => {
      options.signal.throwIfAborted();
      await options.beforeQueue({ query: mocks.query });
      options.signal.throwIfAborted();
      queued = true;
    });
  });

  async function expectTempRemoved() {
    expect(downloadPath).not.toBe('');
    await expect(fs.stat(path.dirname(downloadPath))).rejects.toMatchObject({ code: 'ENOENT' });
  }

  it('下载和存储上传共用信号，并在同一上传交接事务内核验租约', async () => {
    const signal = new AbortController().signal;
    await processMcpImport(importId, signal);
    expect(mocks.download.mock.calls[0]![2]).toBe(signal);
    expect(mocks.upload.mock.calls[0]![0].signal).toBe(signal);
    expect(mocks.queueUpload.mock.calls[0]![2].signal).toBe(signal);
    expect(status).toBe('processing');
    expect(queued).toBe(true);
    await expectTempRemoved();
  });

  it('退出信号已到达时不领取新任务', async () => {
    await processMcpImport(importId, AbortSignal.abort());
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('存储上传中止后清理临时文件、清除源地址并保留可重试错误，不再入队', async () => {
    const controller = new AbortController();
    mocks.upload.mockImplementation(async ({ body, signal }) => {
      for await (const _chunk of body) { /* 先读取完本地文件，再模拟存储等待。 */ }
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        controller.abort(new Error('worker stopping'));
      });
    });
    await processMcpImport(importId, controller.signal);
    expect(status).toBe('failed');
    expect(mocks.queueUpload).not.toHaveBeenCalled();
    const failed = mocks.query.mock.calls.find(([sql]) => sql.includes("SET status='failed'"))!;
    expect(failed[0]).toContain('source_encrypted=NULL');
    expect(failed[1][2]).toBe('MCP_FILE_TIMEOUT');
    await expectTempRemoved();
  });

  it('上传即将返回时收到超时，即使上传函数返回成功也不交接', async () => {
    const controller = new AbortController();
    const upload = mocks.upload.getMockImplementation()!;
    mocks.upload.mockImplementation(async (input) => {
      await upload(input);
      controller.abort();
    });
    await processMcpImport(importId, controller.signal);
    expect(status).toBe('failed');
    expect(mocks.queueUpload).not.toHaveBeenCalled();
    await expectTempRemoved();
  });

  it('上传前发现租约已过期则不写入存储', async () => {
    mocks.createUpload.mockImplementation(async () => {
      leaseActive = false;
      return { session: { id: 'upload-session' }, signature: { objectKey: 'staging/image.png' } };
    });
    await processMcpImport(importId, new AbortController().signal);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(queued).toBe(false);
    await expectTempRemoved();
  });

  it('上传后租约失效或被新执行接管，旧执行不能入队或覆盖新状态', async () => {
    const upload = mocks.upload.getMockImplementation()!;
    mocks.upload.mockImplementation(async (input) => {
      await upload(input);
      currentLease = 'new-worker-lease';
    });
    await processMcpImport(importId, new AbortController().signal);
    expect(queued).toBe(false);
    expect(status).toBe('downloading');
    expect(currentLease).toBe('new-worker-lease');
    await expectTempRemoved();
  });

  it('事务交接后队列报错仍保留 processing，交由现有上传恢复器补投', async () => {
    mocks.queueUpload.mockImplementation(async (_user, _session, options) => {
      await options.beforeQueue({ query: mocks.query });
      throw new Error('Redis unavailable');
    });
    await processMcpImport(importId, new AbortController().signal);
    expect(status).toBe('processing');
    expect(currentLease).toBeNull();
    expect(queued).toBe(false);
    await expectTempRemoved();
  });
});
