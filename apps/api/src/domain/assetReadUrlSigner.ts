import { createObjectReadUrl } from '../storage/storageService.js';

const MAX_CONCURRENCY = 16;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 5_000;

interface CachedReadUrl {
  url: string;
  expiresAt: number;
}

interface SignOwnedObjectReadUrlOptions {
  expiresInSeconds?: number;
}

const successfulCache = new Map<string, CachedReadUrl>();
const inFlight = new Map<string, Promise<string>>();
const permitWaiters: Array<() => void> = [];
let activeSignatures = 0;

/**
 * 对一批已完成所有权校验的对象 key 签发读取地址。这里只负责去重、限流和短期缓存，
 * 不能代替调用方的资产归属校验。
 */
export async function signOwnedObjectReadUrls(
  objectKeys: Iterable<string>,
  options: SignOwnedObjectReadUrlOptions = {},
) {
  const uniqueKeys = Array.from(new Set(
    Array.from(objectKeys, key => key.trim()).filter(Boolean),
  ));
  const entries = await Promise.all(uniqueKeys.map(async key => [
    key,
    await signOwnedObjectReadUrl(key, options),
  ] as const));
  return new Map(entries);
}

export async function signOwnedObjectReadUrl(
  objectKey: string,
  options: SignOwnedObjectReadUrlOptions = {},
) {
  const normalizedKey = objectKey.trim();
  if (!normalizedKey) throw new Error('对象 key 不能为空');

  const signatureKey = cacheKey(normalizedKey, options.expiresInSeconds);

  const cached = readCached(signatureKey);
  if (cached) return cached;

  const existing = inFlight.get(signatureKey);
  if (existing) return existing;

  const pending = withSignaturePermit(() => (
    options.expiresInSeconds === undefined
      ? createObjectReadUrl(normalizedKey)
      : createObjectReadUrl(normalizedKey, options.expiresInSeconds)
  ))
    .then(url => {
      writeCached(signatureKey, url, options.expiresInSeconds);
      return url;
    })
    .finally(() => {
      inFlight.delete(signatureKey);
    });
  inFlight.set(signatureKey, pending);
  return pending;
}

function cacheKey(objectKey: string, expiresInSeconds: number | undefined) {
  return `${expiresInSeconds ?? 'default'}\u0000${objectKey}`;
}

function readCached(objectKey: string) {
  const cached = successfulCache.get(objectKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    successfulCache.delete(objectKey);
    return null;
  }

  // Map 的插入顺序即 LRU 顺序；命中后移到末尾。
  successfulCache.delete(objectKey);
  successfulCache.set(objectKey, cached);
  return cached.url;
}

function writeCached(objectKey: string, url: string, expiresInSeconds?: number) {
  const signatureLifetimeMs = expiresInSeconds === undefined
    ? CACHE_TTL_MS
    : Math.max(1_000, expiresInSeconds * 1_000 - 5_000);
  successfulCache.delete(objectKey);
  successfulCache.set(objectKey, {
    url,
    expiresAt: Date.now() + Math.min(CACHE_TTL_MS, signatureLifetimeMs),
  });
  while (successfulCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = successfulCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    successfulCache.delete(oldestKey);
  }
}

async function withSignaturePermit<T>(run: () => Promise<T>) {
  await acquireSignaturePermit();
  try {
    return await run();
  } finally {
    releaseSignaturePermit();
  }
}

async function acquireSignaturePermit() {
  if (activeSignatures < MAX_CONCURRENCY) {
    activeSignatures += 1;
    return;
  }
  await new Promise<void>(resolve => permitWaiters.push(resolve));
}

function releaseSignaturePermit() {
  const next = permitWaiters.shift();
  if (next) {
    // 当前 permit 直接移交给队首等待者，避免释放与唤醒之间的新请求抢占后超限。
    next();
    return;
  }
  activeSignatures -= 1;
}

/** 仅供单元测试隔离模块级缓存和并发状态。 */
export function resetAssetReadUrlSignerForTests() {
  successfulCache.clear();
  inFlight.clear();
  permitWaiters.splice(0);
  activeSignatures = 0;
}

export const assetReadUrlSignerLimits = {
  maxConcurrency: MAX_CONCURRENCY,
  cacheTtlMs: CACHE_TTL_MS,
  cacheMaxEntries: CACHE_MAX_ENTRIES,
} as const;
