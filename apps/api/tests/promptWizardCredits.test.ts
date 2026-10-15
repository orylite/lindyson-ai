import { describe, expect, it, vi } from 'vitest';
import { releasePromptWizardCreditsWithClient } from '../src/domain/promptWizardCredits.js';

describe('提示词向导失败积分释放', () => {
  it('V6 冻结积分在生成期间到期时原 lot 记为过期，并通过等额新 lot 全额恢复', async () => {
    const futureResetAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT batch.credits')) {
        return result([{
          credits: 2,
          engine_version: 4,
          replacement_main_expires_at: futureResetAt,
        }]);
      }
      if (sql.includes('FROM credit_allocations allocation')) {
        return result([{
          id: 'allocation-v6-expired',
          lot_id: 'lot-v6-expired',
          amount: 2,
          status: 'held',
          bucket: 'main',
          expires_at: '2020-01-01T00:00:00.000Z',
        }]);
      }
      if (sql.includes('UPDATE credit_lots')) return changed();
      if (sql.includes('UPDATE credit_allocations')) return changed();
      if (sql.includes('INSERT INTO credit_lots')) return result([{ id: 'lot-v6-replacement' }]);
      if (sql.includes('COALESCE(sum(available_amount)')) {
        return result([{ main_credits: 2, addon_credits: 0 }]);
      }
      if (sql.includes('UPDATE users')) return changed();
      if (sql.includes('UPDATE credit_ledger')) return changed();
      if (sql.includes('INSERT INTO credit_ledger')) return changed();
      throw new Error(`未处理的 SQL：${sql}`);
    });

    await expect(releasePromptWizardCreditsWithClient(
      { query } as never,
      'user-v6',
      'batch-v6',
    )).resolves.toEqual({
      returnedCredits: 2,
      expiredCredits: 0,
      reissuedCredits: 2,
    });

    const originalLotUpdate = findCall(query, sql => (
      sql.includes('UPDATE credit_lots') && sql.includes('expired_amount = expired_amount + $2')
    ));
    expect(originalLotUpdate?.[1]).toEqual(['lot-v6-expired', 2]);
    expect(findCall(query, sql => sql.includes('UPDATE credit_allocations'))?.[1])
      .toEqual(['allocation-v6-expired', 'expired']);

    const replacementInsert = findCall(query, sql => sql.includes('INSERT INTO credit_lots'));
    expect(replacementInsert?.[0]).toContain("'admin-adjustment'");
    expect(replacementInsert?.[1]).toEqual([
      'user-v6',
      'main',
      'prompt-wizard-refund-replacement:batch-v6:allocation-v6-expired',
      2,
      futureResetAt,
    ]);

    const refundLedger = findCall(query, sql => sql.includes('INSERT INTO credit_ledger'));
    expect(refundLedger?.[1]).toEqual([
      'user-v6',
      'main',
      2,
      2,
      expect.stringContaining('已全额退回'),
      'batch-v6',
      'prompt-wizard-refund:batch-v6',
    ]);
  });

  it('V6 当前没有未来主积分重置日时创建无到期日补偿 lot，避免退款成为不可用余额', async () => {
    const query = releaseQuery({
      engineVersion: 4,
      credits: 1,
      replacementMainExpiresAt: null,
      syncedMainCredits: 1,
    });

    await releasePromptWizardCreditsWithClient({ query } as never, 'user-v6', 'batch-v6-no-expiry');

    expect(findCall(query, sql => sql.includes('INSERT INTO credit_lots'))?.[1]).toEqual([
      'user-v6',
      'main',
      'prompt-wizard-refund-replacement:batch-v6-no-expiry:allocation-expired',
      1,
      null,
    ]);
  });

  it('V6 重复释放会复核既有到期 allocation 与补偿 lot，不新增账本并返回相同全额结果', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT batch.credits')) {
        return result([{
          credits: 2,
          engine_version: 4,
          replacement_main_expires_at: null,
        }]);
      }
      if (sql.includes('FROM credit_allocations allocation')) {
        return result([{
          id: 'allocation-v6-expired',
          lot_id: 'lot-v6-expired',
          amount: 2,
          status: 'expired',
          bucket: 'main',
          expires_at: '2020-01-01T00:00:00.000Z',
        }]);
      }
      if (sql.includes('WHERE source_event_key = $1')) {
        return result([{
          user_id: 'user-v6',
          bucket: 'main',
          original_amount: 2,
        }]);
      }
      if (sql.includes('COALESCE(sum(available_amount)')) {
        return result([{ main_credits: 2, addon_credits: 0 }]);
      }
      if (sql.includes('UPDATE users')) return changed();
      if (sql.includes('UPDATE credit_ledger')) return changed();
      if (sql.includes('INSERT INTO credit_ledger')) return { rows: [], rowCount: 0 };
      throw new Error(`重复释放不应执行此 SQL：${sql}`);
    });

    await expect(releasePromptWizardCreditsWithClient(
      { query } as never,
      'user-v6',
      'batch-v6',
    )).resolves.toEqual({
      returnedCredits: 2,
      expiredCredits: 0,
      reissuedCredits: 2,
    });

    expect(findCall(query, sql => sql.includes('UPDATE credit_lots'))).toBeUndefined();
    expect(findCall(query, sql => sql.includes('UPDATE credit_allocations'))).toBeUndefined();
    expect(findCall(query, sql => sql.includes('INSERT INTO credit_lots'))).toBeUndefined();
  });

  it('V6 已标记到期但缺少等额补偿 lot 时拒绝把历史状态误判为已退款', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT batch.credits')) {
        return result([{
          credits: 1,
          engine_version: 4,
          replacement_main_expires_at: null,
        }]);
      }
      if (sql.includes('FROM credit_allocations allocation')) {
        return result([{
          id: 'allocation-v6-expired',
          lot_id: 'lot-v6-expired',
          amount: 1,
          status: 'expired',
          bucket: 'main',
          expires_at: '2020-01-01T00:00:00.000Z',
        }]);
      }
      if (sql.includes('WHERE source_event_key = $1')) return result([]);
      throw new Error(`缺少补偿 lot 后不应执行此 SQL：${sql}`);
    });

    await expect(releasePromptWizardCreditsWithClient(
      { query } as never,
      'user-v6',
      'batch-v6',
    )).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_CREDIT_INVARIANT_VIOLATION',
      message: 'V6 提示词向导到期积分缺少等额补偿批次',
    });
    expect(findCall(query, sql => sql.includes('INSERT INTO credit_ledger'))).toBeUndefined();
  });

  it('V4/V5 到期冻结积分保持历史语义，不创建补偿 lot 也不恢复可用余额', async () => {
    const query = releaseQuery({
      engineVersion: 3,
      credits: 1,
      replacementMainExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      syncedMainCredits: 0,
    });

    await expect(releasePromptWizardCreditsWithClient(
      { query } as never,
      'user-v5',
      'batch-v5',
    )).resolves.toEqual({
      returnedCredits: 0,
      expiredCredits: 1,
      reissuedCredits: 0,
    });

    expect(findCall(query, sql => sql.includes('INSERT INTO credit_lots'))).toBeUndefined();
    expect(findCall(query, sql => sql.includes('UPDATE credit_allocations'))?.[1])
      .toEqual(['allocation-expired', 'expired']);
    expect(findCall(query, sql => sql.includes('INSERT INTO credit_ledger'))?.[1]).toEqual([
      'user-v5',
      'system',
      0,
      0,
      '提示词方案生成失败，未过期的预扣积分已退回；已过期积分未重新计入账户。',
      'batch-v5',
      'prompt-wizard-refund:batch-v5',
    ]);
  });

  it('V6 分配总额不等于批次预扣时在改写 lot 前拒绝伪造全额退款', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT batch.credits')) {
        return result([{
          credits: 2,
          engine_version: 4,
          replacement_main_expires_at: null,
        }]);
      }
      if (sql.includes('FROM credit_allocations allocation')) {
        return result([{
          id: 'allocation-short',
          lot_id: 'lot-short',
          amount: 1,
          status: 'held',
          bucket: 'main',
          expires_at: null,
        }]);
      }
      throw new Error(`不应执行写 SQL：${sql}`);
    });

    await expect(releasePromptWizardCreditsWithClient(
      { query } as never,
      'user-v6',
      'batch-v6-short',
    )).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_CREDIT_INVARIANT_VIOLATION',
      message: 'V6 提示词向导积分分配金额与批次预扣不一致',
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
});

function releaseQuery(input: {
  engineVersion: number;
  credits: number;
  replacementMainExpiresAt: Date | string | null;
  syncedMainCredits: number;
}) {
  return vi.fn(async (sql: string) => {
    if (sql.includes('SELECT batch.credits')) {
      return result([{
        credits: input.credits,
        engine_version: input.engineVersion,
        replacement_main_expires_at: input.replacementMainExpiresAt,
      }]);
    }
    if (sql.includes('FROM credit_allocations allocation')) {
      return result([{
        id: 'allocation-expired',
        lot_id: 'lot-expired',
        amount: input.credits,
        status: 'held',
        bucket: 'main',
        expires_at: '2020-01-01T00:00:00.000Z',
      }]);
    }
    if (sql.includes('UPDATE credit_lots')) return changed();
    if (sql.includes('UPDATE credit_allocations')) return changed();
    if (sql.includes('INSERT INTO credit_lots')) return result([{ id: 'lot-replacement' }]);
    if (sql.includes('COALESCE(sum(available_amount)')) {
      return result([{ main_credits: input.syncedMainCredits, addon_credits: 0 }]);
    }
    if (sql.includes('UPDATE users')) return changed();
    if (sql.includes('UPDATE credit_ledger')) return changed();
    if (sql.includes('INSERT INTO credit_ledger')) return changed();
    throw new Error(`未处理的 SQL：${sql}`);
  });
}

function findCall(
  query: ReturnType<typeof vi.fn>,
  predicate: (sql: string) => boolean,
) {
  return query.mock.calls.find(([sql]) => predicate(String(sql))) as [string, unknown[]] | undefined;
}

function result<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}

function changed() {
  return { rows: [], rowCount: 1 };
}
