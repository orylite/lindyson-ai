// 只用类型导入：首页入口不能把契约包（zod 与全部 schema）打进落地页包。
import type { RegistrationAttribution, VisitAttribution, VisitorVisitBody } from '@lindyson/api-contracts';

const ATTRIBUTION_STORAGE_KEY = 'lindyson:acquisition';
const VISITOR_STORAGE_KEY = 'lindyson:visitor';
const VISIT_REPORTS_STORAGE_KEY = 'lindyson:visit-reports';
const ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VISITOR_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'from'] as const;
const VISIT_ENDPOINT = '/api/public/visits';

interface StoredAttribution extends VisitAttribution {
  expiresAt: string;
}

interface StoredVisitor {
  id: string;
  expiresAt: string;
}

/** 本页面加载期间是否刚生成了访客 ID：落地页与登录页调用顺序不同，也能正确标记新访客。 */
let visitorCreatedThisPage = false;

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

function writeStored(attribution: VisitAttribution, now: number) {
  const stored: StoredAttribution = { ...attribution, expiresAt: new Date(now + ATTRIBUTION_TTL_MS).toISOString() };
  try { window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(stored)); } catch { /* 存储不可用时只在本次页面内生效 */ }
}

function toAttribution(stored: StoredAttribution): VisitAttribution {
  const { expiresAt: _expiresAt, ...attribution } = stored;
  return attribution;
}

function readJson<T>(key: string): Partial<T> | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as Partial<T> : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存储不可用时只在本次页面内生效 */ }
}

function randomUuid() {
  const cryptoApi = typeof crypto === 'undefined' ? undefined : crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 读取或生成匿名访客 ID：随机生成、只存在本浏览器，不含任何个人信息。
 * 每次到站顺延 30 天，30 天没来过的浏览器再来算新访客。
 */
export function ensureVisitorId(now = Date.now()): { id: string; isNew: boolean } {
  const stored = readJson<StoredVisitor>(VISITOR_STORAGE_KEY);
  const valid = stored && typeof stored.id === 'string' && UUID_PATTERN.test(stored.id)
    && typeof stored.expiresAt === 'string' && Date.parse(stored.expiresAt) > now;
  const id = valid ? stored.id! : randomUuid();
  if (!valid) visitorCreatedThisPage = true;
  writeJson(VISITOR_STORAGE_KEY, { id, expiresAt: new Date(now + VISITOR_TTL_MS).toISOString() });
  return { id, isNew: visitorCreatedThisPage };
}

/** 北京时间日期，与服务端去重口径一致（中国无夏令时，固定 +8 小时）。 */
function shanghaiDay(now: number) {
  return new Date(now + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function isInternalNavigation() {
  try {
    const referrer = typeof document === 'undefined' ? '' : document.referrer;
    if (!referrer) return false;
    return new URL(referrer).hostname.toLowerCase() === window.location.hostname.toLowerCase();
  } catch {
    return false;
  }
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
export function detectVisitAttribution(now = Date.now()): VisitAttribution | null {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  const params = Object.fromEntries(UTM_PARAMS.map(key => [key, clip(query.get(key), key === 'utm_source' || key === 'from' ? 64 : 128)]));
  const referrerHost = externalReferrerHost();
  const explicitSource = params.utm_source ?? params.from;
  // 优先级：推广参数 > 邀约链接 > 来源站点域名 > 未知外部站点。
  const invited = query.get('ref')?.trim() ? 'referral' : undefined;
  const source = explicitSource ?? invited ?? classifyReferrerHost(referrerHost) ?? (referrerHost ? 'other' : undefined);
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
  const visitorId = ensureVisitorId(now).id;
  const stored = readStored(now);
  const visit = detectVisitAttribution(now);
  if (stored && stored.source !== 'direct') return { ...toAttribution(stored), visitorId };
  if (visit) {
    writeStored(visit, now);
    return { ...visit, visitorId };
  }
  if (stored) return { ...toAttribution(stored), visitorId };
  const direct: VisitAttribution = {
    source: 'direct',
    landingPath: clip(window.location.pathname, 255) ?? '/',
    firstTouchAt: new Date(now).toISOString(),
  };
  writeStored(direct, now);
  return { ...direct, visitorId };
}

function sendVisit(body: VisitorVisitBody) {
  const baseUrl = (import.meta.env?.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  const url = `${baseUrl}${VISIT_ENDPOINT}`;
  const payload = JSON.stringify(body);
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
      && navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }))) return;
  } catch { /* 回退到 fetch */ }
  try {
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch { /* 上报失败不影响页面 */ }
}

/**
 * 上报一次访客来源。口径：同一访客同一天（北京时间）同一来源只上报一次；
 * 站内跳转（来源是本站）不上报；没有任何来源信号的外部到站记为直接访问。
 * 返回本次是否发出了上报。
 */
export function reportVisit(now = Date.now()): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
  const detected = detectVisitAttribution(now);
  if (!detected && isInternalNavigation()) return false;
  const attribution: VisitAttribution = detected ?? {
    source: 'direct',
    landingPath: clip(window.location.pathname, 255) ?? '/',
    firstTouchAt: new Date(now).toISOString(),
  };
  const day = shanghaiDay(now);
  const reports = readJson<{ day: string; sources: string[] }>(VISIT_REPORTS_STORAGE_KEY);
  const reportedToday = reports?.day === day && Array.isArray(reports.sources) ? reports.sources : [];
  const sourceKey = attribution.source.toLowerCase();
  if (reportedToday.includes(sourceKey)) return false;
  const visitor = ensureVisitorId(now);
  sendVisit({
    visitorId: visitor.id,
    isNewVisitor: visitor.isNew,
    site: clip(window.location.hostname, 255) ?? 'unknown',
    attribution,
  });
  writeJson(VISIT_REPORTS_STORAGE_KEY, { day, sources: [...reportedToday, sourceKey].slice(-20) });
  return true;
}

/** 首页与登录页到站时调用：先上报访客来源，再记录注册归因。 */
export function trackVisit(now = Date.now()) {
  reportVisit(now);
  captureAttribution(now);
}

export function clearAttribution() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY); } catch { /* 存储可能被浏览器禁用 */ }
}
