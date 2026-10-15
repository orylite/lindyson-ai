import { existsSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';

export const DEFAULT_BAIDU_SITE_URL = 'https://www.lindyson.com';
const BAIDU_ENDPOINT = 'http://data.zz.baidu.com/urls';

export function parseSitemapUrls(xml) {
  const urls = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map(match => decodeXmlEntities(match[1].trim()));
  return [...new Set(urls)];
}

export function validateSubmissionUrls(siteUrl, urls) {
  const site = new URL(siteUrl);
  if (site.protocol !== 'https:' || (site.pathname !== '/' && site.pathname !== '')) {
    throw new Error('BAIDU_SITE_URL 必须是无路径的 HTTPS 站点来源');
  }
  if (urls.length === 0) throw new Error('sitemap 中没有可提交的 URL');
  if (urls.length > 2_000) throw new Error('单次提交 URL 不能超过 2000 条');

  return urls.map(value => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== site.origin) {
      throw new Error(`sitemap 包含非本站 HTTPS URL：${value}`);
    }
    return url.toString();
  });
}

export function validateBaiduResponse(value) {
  if (!value || typeof value !== 'object') throw new Error('百度普通收录返回了无效响应');
  const response = value;
  if (!Number.isInteger(response.success) || !Number.isInteger(response.remain)) {
    throw new Error('百度普通收录响应缺少 success 或 remain');
  }
  const notSameSite = Array.isArray(response.not_same_site) ? response.not_same_site : [];
  const notValid = Array.isArray(response.not_valid) ? response.not_valid : [];
  return { success: response.success,remain: response.remain,notSameSite,notValid };
}

export async function submitBaiduUrls({
  env = process.env,
  args = process.argv.slice(2),
  fetchImpl = globalThis.fetch,
  write = message => console.log(message),
} = {}) {
  const siteUrl = (env.BAIDU_SITE_URL || DEFAULT_BAIDU_SITE_URL).replace(/\/$/, '');
  const sitemapPath = resolveSitemapPath(env.BAIDU_SITEMAP_PATH);
  const sitemap = readFileSync(sitemapPath, 'utf8');
  const urls = validateSubmissionUrls(siteUrl, parseSitemapUrls(sitemap));
  const dryRun = args.includes('--dry-run');

  if (dryRun) {
    write(`百度普通收录 dry-run：已校验 ${urls.length} 条 URL，站点 ${siteUrl}`);
    urls.forEach(url => write(url));
    return { dryRun: true,urls };
  }

  const token = env.BAIDU_PUSH_TOKEN?.trim();
  if (!token) throw new Error('缺少 BAIDU_PUSH_TOKEN，未执行百度普通收录提交');
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 环境不支持 fetch');

  const endpoint = new URL(BAIDU_ENDPOINT);
  endpoint.searchParams.set('site', siteUrl);
  endpoint.searchParams.set('token', token);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: urls.join('\n'),
  });
  if (!response.ok) throw new Error(`百度普通收录请求失败，状态码 ${response.status}`);

  let rawResponse;
  try {
    rawResponse = await response.json();
  } catch {
    throw new Error('百度普通收录返回了无法解析的 JSON');
  }
  const result = validateBaiduResponse(rawResponse);
  write(`百度普通收录完成：成功 ${result.success} 条，今日剩余 ${result.remain} 条`);
  if (result.notSameSite.length > 0 || result.notValid.length > 0) {
    throw new Error(`百度拒绝了 ${result.notSameSite.length + result.notValid.length} 条 URL，请检查站点归属和 URL 格式`);
  }
  return { dryRun: false,urls,...result };
}

function resolveSitemapPath(configuredPath) {
  if (configuredPath?.trim()) return resolve(configuredPath.trim());
  const built = resolve('dist/sitemap.xml');
  return existsSync(built) ? built : resolve('public/sitemap.xml');
}

function decodeXmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function loadLocalEnv() {
  const envPath = resolve('.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

const currentFile = fileURLToPath(import.meta.url);
const launchedFile = process.argv[1] ? fileURLToPath(pathToFileURL(resolve(process.argv[1]))) : '';
if (currentFile === launchedFile) {
  loadLocalEnv();
  submitBaiduUrls().catch(error => {
    console.error(error instanceof Error ? error.message : '百度普通收录提交失败');
    process.exitCode = 1;
  });
}
