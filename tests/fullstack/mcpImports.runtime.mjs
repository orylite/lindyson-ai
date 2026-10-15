// 只在隔离测试容器的独立进程替换外部网络；生产下载器和 worker 不含测试后门。
import assert from 'node:assert/strict';
import https from 'node:https';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
const media = await sharp({
  create: { width: 512, height: 512, channels: 3, background: '#3266ab' },
})
  .webp()
  .toBuffer();
let expired = true;
dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }];
https.request = (url, options, callback) => {
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.headers.Cookie, undefined);
  const pathname = url.pathname;
  const response = Object.assign(
    Readable.from([
      pathname === '/corrupt' ? Buffer.from('RIFF\x00\x00\x00\x00WEBPbroken') : media,
    ]),
    {
      statusCode: pathname === '/expired' && expired ? 403 : pathname === '/redirect' ? 302 : 200,
      headers:
        pathname === '/oversize'
          ? { 'content-length': String(2 ** 31) }
          : pathname === '/redirect'
            ? { location: 'https://127.0.0.1/private' }
            : {},
    },
  );
  return Object.assign(new EventEmitter(), {
    setTimeout() {},
    end() {
      queueMicrotask(() => callback(response));
    },
    destroy() {
      response.destroy();
    },
  });
};
syncBuiltinESMExports();
const { pool } = await import('./apps/api/dist/db/pool.js');
const { getMcpImportQueue, closeMcpImportQueue } = await import(
  './apps/api/dist/queues/mcpImportQueue.js'
);
const { closeUploadQueue } = await import('./apps/api/dist/queues/uploadQueue.js');
const { importChatGptFiles, processMcpImport, getMcpImport, maintainMcpImports } = await import(
  './apps/api/dist/mcp/fileImports.js'
);
const { assertMcpConnection } = await import('./apps/api/dist/mcp/security.js');
const queue = getMcpImportQueue();
await queue.pause();
try {
  const connection = (
    await pool.query(
      "SELECT c.id FROM mcp_connections c JOIN users u ON u.id=c.user_id WHERE u.email='integration-admin@lindyson.test' AND c.revoked_at IS NULL ORDER BY c.created_at DESC LIMIT 1",
    )
  ).rows[0];
  const identity = await assertMcpConnection(connection.id);
  const file = (path, mime = 'image/webp') => ({
    file_id: path,
    file_name: '测试附件.webp',
    mime_type: mime,
    download_url: `https://files.example${path}?signature=private`,
  });
  const key = randomUUID();
  const files = [file('/valid')];
  const first = await importChatGptFiles(identity, key, files);
  const id = first.imports[0].importId;
  assert.equal(first.imports[0].status, 'queued');
  assert.equal(first.imports[0].assetId, null);
  assert.equal(
    (
      await importChatGptFiles(identity, key, [
        { ...files[0], download_url: 'https://files.example/valid?signature=rotated' },
      ])
    ).imports[0].importId,
    id,
  );
  await assert.rejects(() => importChatGptFiles(identity, key, [file('/different')]), {
    code: 'MCP_IMPORT_CONFLICT',
  });
  const row = (await pool.query('SELECT source_encrypted FROM mcp_file_imports WHERE id=$1', [id]))
    .rows[0];
  assert.ok(!row.source_encrypted.includes('signature'));
  await assert.rejects(() => getMcpImport(randomUUID(), id), { code: 'MCP_IMPORT_NOT_FOUND' });
  await processMcpImport(id, AbortSignal.timeout(20_000));
  const until = Date.now() + 40_000;
  let result;
  do {
    result = await getMcpImport(identity.userId, id);
    if (result.status === 'completed' || result.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < until);
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.ok(result.assetId);
  for (const [path, mime, error] of [
    ['/expired', 'image/webp', 'MCP_FILE_SOURCE_EXPIRED'],
    ['/oversize', 'image/webp', 'MCP_FILE_TOO_LARGE'],
    ['/redirect', 'image/webp', 'MCP_FILE_HOST_BLOCKED'],
    ['/mismatch', 'image/png', 'MCP_FILE_TYPE_MISMATCH'],
  ]) {
    const batchKey = randomUUID();
    const imported = (await importChatGptFiles(identity, batchKey, [file(path, mime)])).imports[0];
    await processMcpImport(imported.importId, AbortSignal.timeout(20_000));
    const failed = await getMcpImport(identity.userId, imported.importId);
    assert.equal(failed.errorCode, error);
    assert.equal(failed.status, 'failed');
    assert.equal(
      (
        await pool.query('SELECT source_encrypted FROM mcp_file_imports WHERE id=$1', [
          imported.importId,
        ])
      ).rows[0].source_encrypted,
      null,
    );
    if (path === '/expired') {
      assert.equal(failed.retryable, true);
      expired = false;
      const retry = (await importChatGptFiles(identity, batchKey, [file(path, mime)])).imports[0];
      assert.equal(retry.importId, imported.importId);
      assert.equal(retry.status, 'queued');
      await processMcpImport(retry.importId, AbortSignal.timeout(20_000));
    }
  }
  await maintainMcpImports();
  assert.equal(
    (await pool.query('SELECT source_encrypted FROM mcp_file_imports WHERE id=$1', [id])).rows[0]
      .source_encrypted,
    null,
  );
  console.log(JSON.stringify({ assetId: result.assetId, importId: id }));
} finally {
  await queue.resume();
  await closeMcpImportQueue();
  await closeUploadQueue();
  await pool.end();
}
