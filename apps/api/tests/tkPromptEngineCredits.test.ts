import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setUserAvailableCreditsWithClient: vi.fn(),
}));

vi.mock('../src/domain/financialCredits.js', () => ({
  setUserAvailableCreditsWithClient: mocks.setUserAvailableCreditsWithClient,
}));

import { releaseTkPromptCreditsWithClient } from '../src/domain/tkPromptEngineCredits.js';

const userId = '10000000-0000-4000-8000-000000000001';
const generationId = '30000000-0000-4000-8000-000000000001';

describe('TK Prompt Engine 失败全额退款', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setUserAvailableCreditsWithClient.mockResolvedValue({
      mainCredits: 54,
      addonCredits: 46,
      balance: 100,
    });
  });

  it('冻结期间主积分到期时补发等额 lot，returned + compensated 等于整批积分', async () => {
    const client = scriptedClient((sql, params) => {
      if (sql.includes('FROM tk_prompt_generations generation')) {
        return rows([{
          credits: 7,
          replacement_main_expires_at: '2026-09-01T00:00:00.000Z',
        }]);
      }
      if (sql.includes('FROM credit_allocations allocation')) {
        expect(sql).toContain('lot.expires_at <= clock_timestamp() AS is_expired');
        expect(sql).toContain('allocation.user_id = $3');
        expect(sql).toContain('lot.user_id = $3');
        expect(params).toEqual([
          `tk-prompt-engine-hold:${generationId}`,
          generationId,
          userId,
        ]);
        return rows([
          // 即使 Node 进程认为 2099 尚未到期，也只服从数据库锁定时返回的 is_expired。
          allocation('allocation-main', 'lot-main', 'main', 4, 'held', true),
          allocation('allocation-addon', 'lot-addon', 'addon', 3, 'held', false),
        ]);
      }
      if (sql.includes('expired_amount = expired_amount + $2')) return rows([{}]);
      if (sql.includes('available_amount = available_amount + $2')) return rows([{}]);
      if (sql.includes('UPDATE credit_allocations SET status')) return rows([{}]);
      if (sql.includes('INSERT INTO credit_lots')) {
        expect(sql).toContain("'tk-prompt-engine-refund'");
        expect(params).toEqual([
          userId,
          'main',
          `tk-prompt-engine-refund-replacement:${generationId}:allocation-main`,
          4,
          '2026-09-01T00:00:00.000Z',
        ]);
        return rows([{ id: 'replacement-main' }]);
      }
      if (sql.includes('UPDATE credit_ledger')) return rows([{}]);
      if (sql.includes('INSERT INTO credit_ledger')) {
        expect(params?.[1]).toBe('mixed');
        expect(params?.[2]).toBe(7);
        expect(params?.[4]).toContain('全额恢复');
        return rows([{}]);
      }
      throw new Error(`未处理 SQL: ${sql}`);
    });

    await expect(releaseTkPromptCreditsWithClient(
      client as any,
      userId,
      generationId,
    )).resolves.toEqual({ returned: 3, compensated: 4 });
    expect(mocks.setUserAvailableCreditsWithClient).toHaveBeenCalledWith(client, userId);
    expect(client.calls.some(call => call.sql.includes('tk_prompt_provider_requests'))).toBe(false);
  });

  it('退款重放复用既有补偿 lot，不重复补发也不改变 Provider 成本账本', async () => {
    const client = scriptedClient((sql, params) => {
      if (sql.includes('FROM tk_prompt_generations generation')) {
        return rows([{ credits: 7, replacement_main_expires_at: null }]);
      }
      if (sql.includes('FROM credit_allocations allocation')) {
        return rows([
          allocation('allocation-main', 'lot-main', 'main', 4, 'expired', true),
          allocation('allocation-addon', 'lot-addon', 'addon', 3, 'released', false),
        ]);
      }
      if (sql.includes('FROM credit_lots') && sql.includes('source_event_key')) {
        expect(params).toEqual([
          `tk-prompt-engine-refund-replacement:${generationId}:allocation-main`,
        ]);
        return rows([{
          user_id: userId,
          bucket: 'main',
          source_type: 'tk-prompt-engine-refund',
          original_amount: 4,
          available_amount: 1,
        }]);
      }
      if (sql.includes('UPDATE credit_ledger')) return rows([{}]);
      if (sql.includes('INSERT INTO credit_ledger')) return rows([], 0);
      throw new Error(`未处理 SQL: ${sql}`);
    });

    await expect(releaseTkPromptCreditsWithClient(
      client as any,
      userId,
      generationId,
    )).resolves.toEqual({ returned: 3, compensated: 4 });
    expect(client.calls.some(call => call.sql.includes('INSERT INTO credit_lots'))).toBe(false);
    expect(client.calls.some(call => call.sql.includes('tk_prompt_provider_requests'))).toBe(false);
  });

  it('allocation 总额不是整批价格时整笔事务失败，不生成部分退款', async () => {
    const client = scriptedClient((sql) => {
      if (sql.includes('FROM tk_prompt_generations generation')) {
        return rows([{ credits: 7, replacement_main_expires_at: null }]);
      }
      if (sql.includes('FROM credit_allocations allocation')) {
        return rows([
          allocation('allocation-main', 'lot-main', 'main', 6, 'held', false),
        ]);
      }
      throw new Error(`未处理 SQL: ${sql}`);
    });

    await expect(releaseTkPromptCreditsWithClient(
      client as any,
      userId,
      generationId,
    )).rejects.toMatchObject({ code: 'TK_PROMPT_CREDIT_INVARIANT_VIOLATION' });
    expect(mocks.setUserAvailableCreditsWithClient).not.toHaveBeenCalled();
    expect(client.calls).toHaveLength(2);
  });

  it('allocation 已标记 expired 但缺少补偿 lot 时拒绝伪造已退款结果', async () => {
    const client = scriptedClient((sql) => {
      if (sql.includes('FROM tk_prompt_generations generation')) {
        return rows([{ credits: 4, replacement_main_expires_at: null }]);
      }
      if (sql.includes('FROM credit_allocations allocation')) {
        return rows([
          allocation('allocation-main', 'lot-main', 'main', 4, 'expired', true),
        ]);
      }
      if (sql.includes('FROM credit_lots') && sql.includes('source_event_key')) return rows([]);
      throw new Error(`未处理 SQL: ${sql}`);
    });

    await expect(releaseTkPromptCreditsWithClient(
      client as any,
      userId,
      generationId,
    )).rejects.toMatchObject({
      code: 'TK_PROMPT_CREDIT_INVARIANT_VIOLATION',
      message: 'TK Prompt Engine到期积分缺少等额补偿批次',
    });
    expect(mocks.setUserAvailableCreditsWithClient).not.toHaveBeenCalled();
  });

  it('跨用户 allocation/lot 即使被伪造进查询结果也在写 lot 前拒绝', async () => {
    const client = scriptedClient((sql) => {
      if (sql.includes('FROM tk_prompt_generations generation')) {
        return rows([{ credits: 4, replacement_main_expires_at: null }]);
      }
      if (sql.includes('FROM credit_allocations allocation')) {
        return rows([{
          ...allocation('allocation-main', 'lot-main', 'main', 4, 'held', false),
          allocation_user_id: '10000000-0000-4000-8000-000000000002',
          lot_user_id: '10000000-0000-4000-8000-000000000002',
        }]);
      }
      throw new Error(`跨用户退款不应执行写 SQL: ${sql}`);
    });

    await expect(releaseTkPromptCreditsWithClient(
      client as any,
      userId,
      generationId,
    )).rejects.toMatchObject({
      code: 'TK_PROMPT_CREDIT_INVARIANT_VIOLATION',
      message: 'TK Prompt Engine积分分配用户归属不一致',
    });
    expect(mocks.setUserAvailableCreditsWithClient).not.toHaveBeenCalled();
    expect(client.calls).toHaveLength(2);
  });
});

function allocation(
  id: string,
  lotId: string,
  bucket: 'main' | 'addon',
  amount: number,
  status: string,
  isExpired: boolean,
) {
  return {
    id,
    lot_id: lotId,
    amount,
    status,
    allocation_user_id: userId,
    lot_user_id: userId,
    bucket,
    is_expired: isExpired,
  };
}

function scriptedClient(handler: (sql: string, params?: unknown[]) => ReturnType<typeof rows>) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    calls,
    async query(sql: string, params?: unknown[]) {
      const normalized = sql.replace(/\s+/gu, ' ').trim();
      calls.push({ sql: normalized, params });
      return handler(normalized, params);
    },
  };
}

function rows<T>(items: T[], rowCount = items.length) {
  return { rows: items, rowCount };
}
