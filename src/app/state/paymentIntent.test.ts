import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { acquirePaymentIntentKey,clearPaymentIntentKey } from './paymentIntent';

describe('支付幂等键持久化', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('同一购买意图跨调用复用相同键，明确终态后才换新键', () => {
    expect(acquirePaymentIntentKey('plan:monthly:pc', { now: 1_000, createKey: () => 'key-1' })).toBe('key-1');
    expect(acquirePaymentIntentKey('plan:monthly:pc', { now: 2_000, createKey: () => 'key-2' })).toBe('key-1');

    clearPaymentIntentKey('plan:monthly:pc', 2_000);
    expect(acquirePaymentIntentKey('plan:monthly:pc', { now: 3_000, createKey: () => 'key-3' })).toBe('key-3');
  });

  it('超过 24 小时的入口键自动过期', () => {
    expect(acquirePaymentIntentKey('plan:yearly:mobile', { now: 0, createKey: () => 'old-key' })).toBe('old-key');
    expect(acquirePaymentIntentKey('plan:yearly:mobile', {
      now: 24 * 60 * 60 * 1_000 + 1,
      createKey: () => 'new-key',
    })).toBe('new-key');
  });
});
