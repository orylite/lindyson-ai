import { describe, it, expect, vi } from 'vitest';
import { releaseGenerationLotsWithClient } from '../src/domain/generationCredits.js';
import { releaseTkPromptCreditsWithClient } from '../src/domain/tkPromptEngineCredits.js';
import { releasePromptWizardCreditsWithClient } from '../src/domain/promptWizardCredits.js';
import { maskReferralEmail } from '../src/domain/referrals.js';

function clientForRelease(kind: string, status = 'held') {
  const allocation = { id: 'allocation', lot_id: 'lot', amount: 120, status, bucket: 'addon', referral_revoked_at: new Date(), expires_at: null, is_expired: false, allocation_user_id: 'user', lot_user_id: 'user' };
  return { query: vi.fn(async (sql: string) => {
    if (sql.includes('FROM tk_prompt_generations generation')) return { rows: [{ credits: 120 }], rowCount: 1 };
    if (sql.includes('FROM prompt_wizard_batches')) return { rows: [{ credits: 120, engine_version: 4 }], rowCount: 1 };
    if (sql.includes('FROM credit_allocations allocation')) return { rows: [allocation], rowCount: 1 };
    if (sql.includes('FROM referral_rewards reward')) return { rows: [{ user_id: 'user', order_id: 'order' }], rowCount: 1 };
    if (sql.includes('COALESCE(sum(available_amount)')) return { rows: [{ main_credits: 0, addon_credits: 0 }], rowCount: 1 };
    if (sql.includes('INSERT INTO credit_lots')) throw new Error(`${kind}不允许补偿已撤销奖励`);
    return { rows: [], rowCount: 1 };
  }) };
}
describe('已撤销邀约奖励的预扣释放', () => {
  it('视频/图片失败不恢复奖励，并记录冲销而非过期', async () => {
    const client = clientForRelease('generation');
    expect(await releaseGenerationLotsWithClient(client as never, 'task', 0)).toEqual({ mainReturned: 0, addonReturned: 0, expiredAmount: 0, revokedAmount: 120 });
    expect(client.query.mock.calls.some(([sql]) => sql.includes('reversed_amount = reversed_amount +'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('available_amount = available_amount +'))).toBe(false);
  });
  it('TK 批次区分退回与追回，幂等重放不创建补偿积分', async () => {
    for (const status of ['held', 'reversed']) {
      const client = clientForRelease('tk', status);
      expect(await releaseTkPromptCreditsWithClient(client as never, 'user', 'batch')).toEqual({ returned: 0, compensated: 0, revoked: 120 });
      expect(client.query.mock.calls.some(([sql]) => sql.includes('available_amount = available_amount +'))).toBe(false);
    }
  });
  it('旧提示词批次不会把已撤销奖励当作到期积分补偿', async () => {
    const client = clientForRelease('v6');
    expect(await releasePromptWizardCreditsWithClient(client as never, 'user', 'batch')).toEqual({ returnedCredits: 0, expiredCredits: 0, reissuedCredits: 0 });
  });
  it('用户端邮箱不暴露完整本地部分', () => { expect(maskReferralEmail('alice@example.com')).toBe('a***@example.com'); });
});
