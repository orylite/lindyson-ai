import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileTypeFromFile } from 'file-type';
import { env } from '../config/env.js';
import { pool, withTransaction } from '../db/pool.js';
import {
  createOrReplayUploadSession,
  queueUploadCompletion,
} from '../domain/uploadSessionService.js';
import { uploadObjectStream } from '../storage/storageService.js';
import { enqueueMcpImport } from '../queues/mcpImportQueue.js';
import { assertPublicHttpsUrl, downloadPublicFile } from './fileDownload.js';
import {
  assertMcpConnection,
  hashSecret,
  mcpError,
  requireMcpScope,
  seal,
  unseal,
  type McpIdentity,
} from './security.js';

export interface ChatGptFile {
  download_url: string;
  file_id: string;
  file_name?: string;
  mime_type?: string;
}
interface ImportRow {
  id: string;
  user_id: string;
  connection_id: string;
  file_id: string;
  filename: string | null;
  declared_type: string | null;
  source_encrypted: string | null;
  status: string;
  attempt: number;
  upload_session_id: string | null;
  asset_id: string | null;
  error_code: string | null;
}
const retryableErrors = new Set([
  'MCP_FILE_SOURCE_EXPIRED',
  'MCP_FILE_DOWNLOAD_FAILED',
  'MCP_FILE_TIMEOUT',
]);
const sourceContext = (userId: string, fileId: string) => `mcp-file:${userId}:${fileId}`;

export async function importChatGptFiles(
  identity: McpIdentity,
  idempotencyKey: string,
  files: ChatGptFile[],
) {
  requireMcpScope(identity, 'assets:write');
  files.forEach((file) => assertPublicHttpsUrl(file.download_url));
  const requestHash = hashSecret(
    JSON.stringify(
      files.map((file) => [file.file_id, file.file_name ?? null, file.mime_type ?? null]),
    ),
  );
  const rows = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `mcp-import:${identity.userId}`,
    ]);
    const batch = await client.query<{ request_hash: string; import_ids: string[] }>(
      'SELECT request_hash,import_ids FROM mcp_import_batches WHERE user_id=$1 AND idempotency_key=$2',
      [identity.userId, idempotencyKey],
    );
    if (batch.rows[0] && batch.rows[0].request_hash !== requestHash)
      throw mcpError('MCP_IMPORT_CONFLICT', '此幂等键已用于其他附件', 409);
    if (!batch.rows[0]) {
      const pending = await client.query<{ count: string }>(
        "SELECT count(*) FROM mcp_file_imports WHERE user_id=$1 AND status IN ('queued','downloading','processing')",
        [identity.userId],
      );
      if (Number(pending.rows[0]!.count) + files.length > 20)
        throw mcpError('MCP_IMPORT_QUEUE_FULL', '待处理附件过多，请等待已有导入完成', 429);
    }
    const items: ImportRow[] = [];
    for (const [index, file] of files.entries()) {
      const encrypted = seal(
        file.download_url,
        env.MCP_FILE_ENCRYPTION_KEY!,
        sourceContext(identity.userId, file.file_id),
      );
      const key = hashSecret(`${idempotencyKey}:${index}`);
      const result = await client.query<ImportRow>(
        `INSERT INTO mcp_file_imports (user_id,connection_id,idempotency_key,file_id,filename,declared_type,source_encrypted)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id,idempotency_key) DO UPDATE SET
           source_encrypted=CASE WHEN mcp_file_imports.status='failed' AND mcp_file_imports.error_code=ANY($8::text[]) THEN EXCLUDED.source_encrypted ELSE mcp_file_imports.source_encrypted END,
           connection_id=CASE WHEN mcp_file_imports.status='failed' THEN EXCLUDED.connection_id ELSE mcp_file_imports.connection_id END,
           source_expires_at=CASE WHEN mcp_file_imports.status='failed' THEN now()+interval '10 minutes' ELSE mcp_file_imports.source_expires_at END,
           error_code=CASE WHEN mcp_file_imports.status='failed' AND mcp_file_imports.error_code=ANY($8::text[]) THEN NULL ELSE mcp_file_imports.error_code END,
           attempt=mcp_file_imports.attempt + CASE WHEN mcp_file_imports.status='failed' AND mcp_file_imports.error_code=ANY($8::text[]) THEN 1 ELSE 0 END,
           status=CASE WHEN mcp_file_imports.status='failed' AND mcp_file_imports.error_code=ANY($8::text[]) THEN 'queued' ELSE mcp_file_imports.status END
         RETURNING *`,
        [
          identity.userId,
          identity.connectionId,
          key,
          file.file_id,
          file.file_name ?? null,
          file.mime_type ?? null,
          encrypted,
          [...retryableErrors],
        ],
      );
      items.push(result.rows[0]!);
    }
    if (!batch.rows[0])
      await client.query(
        'INSERT INTO mcp_import_batches (user_id,idempotency_key,request_hash,import_ids) VALUES ($1,$2,$3,$4)',
        [identity.userId, idempotencyKey, requestHash, items.map((item) => item.id)],
      );
    return items;
  });
  for (const row of rows)
    if (row.status === 'queued')
      await enqueueMcpImport(row.id, row.attempt).catch(logEnqueueFailure);
  return { imports: rows.map(toImportResult), pollAfterSeconds: 5 };
}
function logEnqueueFailure() {
  console.error(
    JSON.stringify({ event: 'mcp-import-enqueue-deferred', code: 'MCP_IMPORT_ENQUEUE_DEFERRED' }),
  );
}
function toImportResult(row: ImportRow) {
  return {
    importId: row.id,
    status: row.status,
    assetId: row.asset_id,
    errorCode: row.error_code,
    retryable: row.status === 'failed' && retryableErrors.has(row.error_code ?? ''),
  };
}
export async function getMcpImport(userId: string, id: string) {
  const result = await pool.query<ImportRow>(
    `SELECT i.*,COALESCE(u.asset_id,i.asset_id) AS asset_id,
       CASE WHEN u.status='completed' THEN 'completed' WHEN u.status IN ('failed','expired','canceled') THEN 'failed' ELSE i.status END AS status,
       COALESCE(u.error_code,i.error_code) AS error_code
     FROM mcp_file_imports i LEFT JOIN upload_sessions u ON u.id=i.upload_session_id
     WHERE i.id=$1 AND i.user_id=$2`,
    [id, userId],
  );
  if (!result.rows[0]) throw mcpError('MCP_IMPORT_NOT_FOUND', '导入任务不存在', 404);
  return { ...toImportResult(result.rows[0]), pollAfterSeconds: 5 };
}

export async function processMcpImport(id: string, signal: AbortSignal) {
  if (signal.aborted) return;
  const lease = randomUUID();
  const row = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mcp-import-capacity',0))");
    const candidate = (
      await client.query<ImportRow>(
        "SELECT * FROM mcp_file_imports WHERE id=$1 AND status='queued' AND source_expires_at > now() FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!candidate) return null;
    const counts = (
      await client.query<{ total: string; owned: string }>(
        "SELECT count(*) AS total,count(*) FILTER (WHERE user_id=$1) AS owned FROM mcp_file_imports WHERE status='downloading' AND lease_until>now()",
        [candidate.user_id],
      )
    ).rows[0]!;
    if (
      Number(counts.total) >= env.MCP_IMPORT_GLOBAL_CONCURRENCY ||
      Number(counts.owned) >= env.MCP_IMPORT_USER_CONCURRENCY
    )
      return null;
    await client.query(
      "UPDATE mcp_file_imports SET status='downloading',lease_token=$2,lease_until=now()+interval '10 minutes',updated_at=now(),error_code=NULL WHERE id=$1",
      [id, lease],
    );
    return candidate;
  });
  if (!row) return;
  let directory: string | undefined;
  try {
    signal.throwIfAborted();
    const identity = await assertMcpConnection(row.connection_id);
    requireMcpScope(identity, 'assets:write');
    if (!row.source_encrypted) throw mcpError('MCP_FILE_SOURCE_EXPIRED', '附件地址已失效');
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lindyson-mcp-import-'));
    await fs.chmod(directory, 0o700);
    const localPath = path.join(directory, 'source');
    const source = unseal(
      row.source_encrypted,
      env.MCP_FILE_ENCRYPTION_KEY!,
      sourceContext(row.user_id, row.file_id),
    );
    const { sizeBytes } = await downloadPublicFile(source, localPath, signal);
    signal.throwIfAborted();
    const type = await fileTypeFromFile(localPath);
    signal.throwIfAborted();
    if (!type || !/^(image|video|audio)\//.test(type.mime))
      throw mcpError('MCP_FILE_TYPE_UNSUPPORTED', '仅支持网站支持的图片、视频和音频');
    if (
      row.declared_type &&
      row.declared_type !== 'application/octet-stream' &&
      row.declared_type !== type.mime
    ) {
      throw mcpError('MCP_FILE_TYPE_MISMATCH', '附件内容与声明类型不一致');
    }
    const kind = type.mime.split('/')[0] as 'image' | 'video' | 'audio';
    const basename =
      path
        .basename(row.filename ?? 'ChatGPT 附件')
        .replace(/\.[^.]+$/, '')
        .replace(/[\x00-\x1f/\\]/g, '')
        .slice(0, 160) || 'ChatGPT 附件';
    const filename = `${basename}.${type.ext}`;
    await assertMcpConnection(row.connection_id);
    signal.throwIfAborted();
    const upload = await createOrReplayUploadSession(row.user_id, {
      filename,
      contentType: type.mime,
      sizeBytes,
      source: `uploaded-${kind}`,
      idempotencyKey: `mcp-import-${id}`,
    });
    signal.throwIfAborted();
    const bound = await pool.query(
      "UPDATE mcp_file_imports SET upload_session_id=$3,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='downloading' AND lease_until>clock_timestamp() RETURNING id",
      [id, lease, upload.session.id],
    );
    if (!bound.rowCount) throw mcpError('MCP_FILE_TIMEOUT', '附件导入租约已失效，请重试', 504);
    signal.throwIfAborted();
    if (upload.signature)
      await uploadObjectStream({
        objectKey: upload.signature.objectKey,
        body: createReadStream(localPath),
        contentType: type.mime,
        contentLength: sizeBytes,
        signal,
      });
    signal.throwIfAborted();
    await assertMcpConnection(row.connection_id);
    await queueUploadCompletion(row.user_id, upload.session.id, {
      signal,
      beforeQueue: async (client) => {
        // 交接与上传会话入队一起提交；过期租约和旧执行不能继续发布素材。
        const handedOff = await client.query(
          "UPDATE mcp_file_imports SET status='processing',source_encrypted=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='downloading' AND lease_until>clock_timestamp() RETURNING id",
          [id, lease],
        );
        if (!handedOff.rowCount)
          throw mcpError('MCP_FILE_TIMEOUT', '附件导入租约已失效，请重试', 504);
      },
    });
  } catch (error) {
    const rawCode =
      error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
    const code = signal.aborted
      ? 'MCP_FILE_TIMEOUT'
      : rawCode && /^(MCP_|UPLOAD_)[A-Z_]+$/.test(rawCode)
        ? rawCode
        : 'MCP_FILE_DOWNLOAD_FAILED';
    const failed = await pool.query(
      "UPDATE mcp_file_imports SET status='failed',error_code=$3,source_encrypted=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",
      [id, lease, code],
    );
    // 已交接或已被其他执行接管的任务不再改写状态；上传队列会恢复已提交任务。
    if (failed.rowCount)
      console.error(JSON.stringify({ event: 'mcp-import-failed', importId: id, errorCode: code }));
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function maintainMcpImports() {
  // 异常退出遗留文件最多保留一小时；下载及存储上传共用八分钟截止信号。
  for (const entry of await fs.readdir(os.tmpdir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('lindyson-mcp-import-')) continue;
    const directory = path.join(os.tmpdir(), entry.name);
    const stat = await fs.stat(directory).catch(() => null);
    if (stat && stat.mtimeMs < Date.now() - 3600_000)
      await fs.rm(directory, { recursive: true, force: true });
  }
  await pool.query(
    'UPDATE mcp_file_imports SET source_encrypted=NULL WHERE source_encrypted IS NOT NULL AND source_expires_at<=now()',
  );
  await pool.query('DELETE FROM mcp_oauth_states WHERE expires_at < now()');
  await pool.query("DELETE FROM mcp_rate_limits WHERE window_start < now()-interval '1 hour'");
  await pool.query(
    `UPDATE mcp_file_imports i SET status=CASE WHEN u.status='completed' THEN 'completed' ELSE 'failed' END,
       asset_id=u.asset_id,error_code=u.error_code,source_encrypted=NULL,updated_at=now()
     FROM upload_sessions u WHERE i.upload_session_id=u.id AND i.status NOT IN ('completed')
       AND u.status IN ('completed','failed','expired','canceled')`,
  );
  await pool.query(
    `UPDATE mcp_file_imports SET status='failed',error_code='MCP_FILE_SOURCE_EXPIRED',source_encrypted=NULL,lease_token=NULL,lease_until=NULL,updated_at=now()
     WHERE (status='queued' AND source_expires_at<=now()) OR (status='downloading' AND lease_until<=now())`,
  );
  const pending = await pool.query<Pick<ImportRow, 'id' | 'attempt'>>(
    "SELECT id,attempt FROM mcp_file_imports WHERE status='queued' ORDER BY created_at LIMIT 100",
  );
  for (const row of pending.rows) await enqueueMcpImport(row.id, row.attempt);
}
