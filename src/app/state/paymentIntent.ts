import { createIdempotencyKey } from '../api/idempotency';

const PAYMENT_INTENT_STORAGE_KEY = 'lindyson:payment-intents:v1';
const PAYMENT_INTENT_TTL_MS = 24 * 60 * 60 * 1_000;

type PaymentIntentEntry = { key: string; createdAt: number };
type PaymentIntentStore = Record<string, PaymentIntentEntry>;

/** 支付入口在明确终态前必须能以同一幂等键重放，页面跳转不能创建第二张订单。 */
export function acquirePaymentIntentKey(
  fingerprint: string,
  options: { now?: number; createKey?: () => string } = {},
) {
  const now = options.now ?? Date.now();
  const store = readPaymentIntentStore(now);
  const existing = store[fingerprint];
  if (existing) return existing.key;
  const key = (options.createKey ?? (() => createIdempotencyKey('payment')))();
  store[fingerprint] = { key, createdAt: now };
  writePaymentIntentStore(store);
  return key;
}

export function clearPaymentIntentKey(fingerprint: string, now = Date.now()) {
  const store = readPaymentIntentStore(now);
  if (!(fingerprint in store)) return;
  delete store[fingerprint];
  writePaymentIntentStore(store);
}

function readPaymentIntentStore(now: number): PaymentIntentStore {
  try {
    const raw = globalThis.localStorage?.getItem(PAYMENT_INTENT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as PaymentIntentStore : {};
    const store: PaymentIntentStore = {};
    for (const [fingerprint, entry] of Object.entries(parsed)) {
      if (
        entry
        && typeof entry.key === 'string'
        && typeof entry.createdAt === 'number'
        && now - entry.createdAt < PAYMENT_INTENT_TTL_MS
      ) {
        store[fingerprint] = entry;
      }
    }
    return store;
  } catch {
    return {};
  }
}

function writePaymentIntentStore(store: PaymentIntentStore) {
  try {
    globalThis.localStorage?.setItem(PAYMENT_INTENT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 隐私模式或配额不足时仍由当前组件内存保留本轮幂等键。
  }
}
