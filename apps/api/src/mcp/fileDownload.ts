import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ipaddr from 'ipaddr.js';
import { MAX_UPLOAD_SIZE_BYTES } from '@lindyson/api-contracts';
import { mcpError } from './security.js';

export function assertPublicHttpsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw mcpError('MCP_FILE_URL_INVALID', '附件下载地址无效');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443')
  ) {
    throw mcpError('MCP_FILE_URL_INVALID', '附件必须使用公网 HTTPS 地址');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(hostname)) assertPublicAddress(hostname);
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw mcpError('MCP_FILE_HOST_BLOCKED', '附件地址不可访问');
  }
  return url;
}
export function assertPublicAddress(address: string) {
  if (!ipaddr.isValid(address) || ipaddr.process(address).range() !== 'unicast') {
    throw mcpError('MCP_FILE_HOST_BLOCKED', '附件地址不可访问');
  }
}

/** 验证 DNS 返回的全部地址，并将连接固定到已验证地址；不向源站传递 OAuth 或 Cookie。 */
export async function openPublicFile(
  value: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<IncomingMessage> {
  if (redirects > 3) throw mcpError('MCP_FILE_REDIRECT_LIMIT', '附件地址重定向过多');
  const url = assertPublicHttpsUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(mcpError('MCP_FILE_TIMEOUT', '附件下载超时', 504));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }),
  ]);
  if (!addresses.length) throw mcpError('MCP_FILE_HOST_BLOCKED', '附件地址不可访问');
  addresses.forEach((item) => assertPublicAddress(item.address));
  const selected = addresses[0]!;
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: 'GET',
        signal,
        agent: false,
        headers: {
          'accept-encoding': 'identity',
          accept: 'image/*,video/*,audio/*,application/octet-stream',
        },
        lookup: (_host, options, callback) => {
          if (options.all) callback(null, [selected]);
          else callback(null, selected.address, selected.family);
        },
      },
      resolve,
    );
    request.on('error', () =>
      reject(mcpError('MCP_FILE_DOWNLOAD_FAILED', '附件下载失败，请重新选择文件', 502)),
    );
    request.setTimeout(30_000, () => request.destroy());
    request.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
    response.destroy();
    if (!response.headers.location)
      throw mcpError('MCP_FILE_DOWNLOAD_FAILED', '附件重定向无效', 502);
    return openPublicFile(new URL(response.headers.location, url).href, signal, redirects + 1);
  }
  if (response.statusCode !== 200) {
    response.destroy();
    throw mcpError('MCP_FILE_SOURCE_EXPIRED', '附件地址已失效，请重新选择文件后重试', 422);
  }
  if ((response.headers['content-encoding'] ?? 'identity') !== 'identity') {
    response.destroy();
    throw mcpError('MCP_FILE_ENCODING_UNSUPPORTED', '附件编码不受支持');
  }
  if (Number(response.headers['content-length'] ?? 0) > MAX_UPLOAD_SIZE_BYTES) {
    response.destroy();
    throw mcpError('MCP_FILE_TOO_LARGE', '附件超过网站上传大小限制', 413);
  }
  return response;
}

export async function downloadPublicFile(value: string, filePath: string, signal: AbortSignal) {
  const response = await openPublicFile(value, signal);
  let sizeBytes = 0;
  const bounded = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length;
      callback(
        sizeBytes > MAX_UPLOAD_SIZE_BYTES
          ? mcpError('MCP_FILE_TOO_LARGE', '附件超过网站上传大小限制', 413)
          : null,
        chunk,
      );
    },
  });
  await pipeline(response, bounded, createWriteStream(filePath, { flags: 'wx', mode: 0o600 }), {
    signal,
  });
  if (sizeBytes === 0) throw mcpError('MCP_FILE_EMPTY', '附件内容为空');
  return { sizeBytes };
}
