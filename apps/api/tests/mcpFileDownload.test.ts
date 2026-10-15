import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
vi.mock('@lindyson/api-contracts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MAX_UPLOAD_SIZE_BYTES: 16,
}));
vi.mock('../src/db/pool.js', () => ({ pool: { query: vi.fn() } }));
import {
  assertPublicAddress,
  assertPublicHttpsUrl,
  downloadPublicFile,
  openPublicFile,
} from '../src/mcp/fileDownload.js';
function response(status: number, headers: Record<string, string> = {}, chunks: Buffer[] = []) {
  return Object.assign(Readable.from(chunks), { statusCode: status, headers });
}
function queueResponse(value: ReturnType<typeof response>) {
  mocks.request.mockImplementationOnce((_url, _options, callback) => {
    const req = Object.assign(new EventEmitter(), {
      setTimeout: vi.fn(),
      destroy: vi.fn(),
      end: () => queueMicrotask(() => callback(value)),
    });
    return req;
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
});
describe('MCP 附件公网下载边界', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.1.1',
    '192.168.2.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
  ])('阻止内网或保留地址 %s', (address) => expect(() => assertPublicAddress(address)).toThrow());
  it.each([
    'http://example.com/a',
    'https://localhost/a',
    'https://example.local/a',
    'https://example.com:444/a',
    'https://user:pw@example.com/a',
    'file:///etc/passwd',
  ])('阻止不允许的地址 %s', (url) => expect(() => assertPublicHttpsUrl(url)).toThrow());
  it('DNS 包含任何内网地址即拒绝，不发起网络连接', async () => {
    mocks.lookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(
      openPublicFile('https://files.example/a', AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: 'MCP_FILE_HOST_BLOCKED' });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('连接固定到已验证 DNS，流式写入，不传凭据', async () => {
    queueResponse(response(200, {}, [Buffer.from('media-bytes')]));
    const dir = await mkdtemp(join(tmpdir(), 'mcp-download-test-'));
    try {
      const file = join(dir, 'media');
      expect(
        await downloadPublicFile(
          'https://files.example/a?signature=private',
          file,
          AbortSignal.timeout(1000),
        ),
      ).toEqual({ sizeBytes: 11 });
      expect(await readFile(file, 'utf8')).toBe('media-bytes');
      const options = mocks.request.mock.calls[0]![1];
      const callback = vi.fn();
      options.lookup('rebound.example', { all: true }, callback);
      expect(callback).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
      expect(options.headers.Authorization).toBeUndefined();
      expect(options.headers.Cookie).toBeUndefined();
      expect(mocks.lookup).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('即使没有 Content-Length，实际流量也不能超过上限', async () => {
    queueResponse(response(200, {}, [Buffer.alloc(10), Buffer.alloc(10)]));
    const dir = await mkdtemp(join(tmpdir(), 'mcp-download-test-'));
    try {
      await expect(
        downloadPublicFile(
          'https://files.example/a',
          join(dir, 'media'),
          AbortSignal.timeout(1000),
        ),
      ).rejects.toMatchObject({ code: 'MCP_FILE_TOO_LARGE' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('重定向每跳校验，拒绝到元数据服务的跳转', async () => {
    queueResponse(response(302, { location: 'https://169.254.169.254/latest' }));
    await expect(
      openPublicFile('https://files.example/a', AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: 'MCP_FILE_HOST_BLOCKED' });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('重定向域名的 DNS 必须重新校验', async () => {
    queueResponse(response(302, { location: 'https://private.example/a' }));
    mocks.lookup
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);
    await expect(
      openPublicFile('https://files.example/a', AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: 'MCP_FILE_HOST_BLOCKED' });
  });
  it('过期链接返回可重试错误，拒绝压缩与超限声明', async () => {
    for (const [status, headers, code] of [
      [403, {}, 'MCP_FILE_SOURCE_EXPIRED'],
      [200, { 'content-encoding': 'gzip' }, 'MCP_FILE_ENCODING_UNSUPPORTED'],
      [200, { 'content-length': String(2 ** 31) }, 'MCP_FILE_TOO_LARGE'],
    ] as const) {
      queueResponse(response(status, headers));
      await expect(
        openPublicFile('https://files.example/a', AbortSignal.timeout(1000)),
      ).rejects.toMatchObject({ code });
    }
  });
});
