// 只用类型导入：首页入口不能把契约包（zod 与全部 schema）打进落地页包。
import type { RegistrationAttribution } from '@lindyson/api-contracts';

const ATTRIBUTION_STORAGE_KEY = 'lindyson:acquisition';
const ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'from'] as const;

interface StoredAttribution extends RegistrationAttribution {
  expiresAt: string;
}

function clip(value: string | null | undefined, max: number) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function readStored(now: number): StoredAttribution | null {
  try {
    const raw = window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAttribution>;
    if (typeof parsed.source !== 'string' || typeof parsed.expiresAt !== 'string') return null;
    if (Date.parse(parsed.expiresAt) <= now) return null;
    return parsed as StoredAttribution;
  } catch {
    return null;
  }
}

function writeStored(attribution: RegistrationAttribution, now: number) {
  const stored: StoredAttribution = { ...attribution, expiresAt: new Date(now + ATTRIBUTION_TTL_MS).toISOString() };
  try { window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(stored)); } catch { /* 存储不可用时只在本次页面内生效 */ }
}

function toAttribution(stored: StoredAttribution): RegistrationAttribution {
  const { expiresAt: _expiresAt, ...attribution } = stored;
  return attribution;
}

/** 没有 utm 参数时按来源站点域名归类；未知域名返回 null，由调用方归 other。 */
export function classifyReferrerHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const normalized = host.trim().toLowerCase();
  const matches = (...domains: string[]) => domains.some(domain => normalized === domain || normalized.endsWith(`.${domain}`));
  if (matches('xiaohongshu.com', 'xhslink.com')) return 'xiaohongshu';
  if (matches('douyin.com', 'iesdouyin.com', 'tiktok.com')) return 'douyin';
  if (matches('bilibili.com', 'b23.tv')) return 'bilibili';
  if (matches('zhihu.com')) return 'zhihu';
  if (matches('weixin.qq.com', 'wechat.com')) return 'wechat';
  if (matches('weibo.com', 'weibo.cn')) return 'weibo';
  if (matches('github.com', 'github.io')) return 'github';
  if (matches('baidu.com')) return 'search-baidu';
  if (matches('google.com', 'google.com.hk', 'googleusercontent.com')) return 'search-google';
  if (matches('bing.com')) return 'search-bing';
  return null;
}

function externalReferrerHost(): string | undefined {
  try {
    const referrer = typeof document === 'undefined' ? '' : document.referrer;
    if (!referrer) return undefined;
    const host = new URL(referrer).hostname.toLowerCase();
    return host && host !== window.location.hostname.toLowerCase() ? host : undefined;
  } catch {
    return undefined;
  }
}

/** 从当前链接读取 utm / from 参数与外部来源站点，推导本次访问的来源。没有任何信号时返回 null。 */
export function detectVisitAttribution(now = Date.now()): RegistrationAttribution | null {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  const params = Object.fromEntries(UTM_PARAMS.map(key => [key, clip(query.get(key), key === 'utm_source' || key === 'from' ? 64 : 128)]));
  const referrerHost = externalReferrerHost();
  const explicitSource = params.utm_source ?? params.from;
  const source = explicitSource ?? classifyReferrerHost(referrerHost) ?? (referrerHost ? 'other' : undefined);
  if (!source) return null;
  return {
    source,
    ...(params.utm_medium ? { medium: clip(params.utm_medium, 64) } : {}),
    ...(params.utm_campaign ? { campaign: params.utm_campaign } : {}),
    ...(params.utm_content ? { content: params.utm_content } : {}),
    ...(params.utm_term ? { term: params.utm_term } : {}),
    ...(referrerHost ? { referrerHost: clip(referrerHost, 255) } : {}),
    landingPath: clip(window.location.pathname, 255) ?? '/',
    firstTouchAt: new Date(now).toISOString(),
  };
}

/**
 * 记录并返回注册来源。采用 first-touch：30 天内已有带信号的记录不被覆盖；
 * 只有「直接访问」这种弱记录会被后来的推广链接或外部来源替换。
 */
export function captureAttribution(now = Date.now()): RegistrationAttribution | null {
  if (typeof window === 'undefined') return null;
  const stored = readStored(now);
  const visit = detectVisitAttribution(now);
  if (stored && stored.source !== 'direct') return toAttribution(stored);
  if (visit) {
    writeStored(visit, now);
    return visit;
  }
  if (stored) return toAttribution(stored);
  const direct: RegistrationAttribution = {
    source: 'direct',
    landingPath: clip(window.location.pathname, 255) ?? '/',
    firstTouchAt: new Date(now).toISOString(),
  };
  writeStored(direct, now);
  return direct;
}

export function clearAttribution() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY); } catch { /* 存储可能被浏览器禁用 */ }
}
