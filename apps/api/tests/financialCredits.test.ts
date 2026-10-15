import { describe, expect, it, vi } from 'vitest';
import {
  adjustCreditLotsWithClient,
  replaceSubscriptionMainLotWithClient,
  setUserAvailableCreditsWithClient,
} from '../src/domain/financialCredits.js';

describe('积分批次领域服务', () => {
  it('用户积分缓存只从 lot 可用余额派生并强制 total 相加', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(result([{ main_credits: 120, addon_credits: 30 }]))
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(setUserAvailableCreditsWithClient({ query } as never, 'user-1')).resolves.toEqual({
      mainCredits: 120,
      addonCredits: 30,
      balance: 150,
    });
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('total_credits = $4'),
      ['user-1', 120, 30, 150],
    );
  });

  it('负数调整重放同一事件时只读取既有 allocation，不再次扣 lot', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce(result([{
        amount: 25,
        status: 'settled',
        user_id: 'user-1',
        bucket: 'main',
      }]));

    await adjustCreditLotsWithClient({ query } as never, {
      userId: 'user-1',
      bucket: 'main',
      delta: -25,
      eventKey: 'admin-credit-adjust:action-1:main',
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE credit_lots'))).toBe(false);
  });

  it('负数调整按查询顺序拆分 allocation，且每个 lot 只扣一次', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([
        { id: 'lot-expiring-first', available_amount: 20 },
        { id: 'lot-later', available_amount: 50 },
      ]))
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await adjustCreditLotsWithClient({ query } as never, {
      userId: 'user-1',
      bucket: 'main',
      delta: -45,
      eventKey: 'admin-credit-adjust:action-2:main',
    });
    const updates = query.mock.calls.filter(([sql]) => String(sql).includes('UPDATE credit_lots'));
    expect(updates.map(([, values]) => values)).toEqual([
      ['lot-expiring-first', 20],
      ['lot-later', 25],
    ]);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO credit_allocations')))
      .toHaveLength(2);
  });

  it('零积分订阅周期也写 marker lot，防止同事件重放再次过期余额', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ available_amount: 100 }]))
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await replaceSubscriptionMainLotWithClient({ query } as never, {
      userId: 'user-1',
      expectedAvailable: 100,
      nextAmount: 0,
      cycleEventKey: 'subscription-expired:user-1:2026-07-10',
    });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("'subscription-cycle'"),
      ['user-1', 'subscription-expired:user-1:2026-07-10', 0, null],
    );
  });

  it('订阅周期 marker 已存在时直接幂等返回', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce(result([{
        id: 'lot-marker',
        user_id: 'user-1',
        bucket: 'main',
        source_type: 'subscription-cycle',
        source_event_key: 'subscription-cycle:user-1:2026-08-01',
        original_amount: 1000,
        available_amount: 1000,
        held_amount: 0,
        consumed_amount: 0,
        expired_amount: 0,
        reversed_amount: 0,
      }]));

    await replaceSubscriptionMainLotWithClient({ query } as never, {
      userId: 'user-1',
      expectedAvailable: 1000,
      nextAmount: 1000,
      cycleEventKey: 'subscription-cycle:user-1:2026-08-01',
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
});

function result<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}
