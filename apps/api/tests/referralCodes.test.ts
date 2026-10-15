import { describe, expect, it, vi } from 'vitest';
import { ensureReferralCodeWithClient } from '../src/domain/referrals.js';

describe('8 位邀请码唯一性', () => {
  it('生成仅包含大写英文字母和数字的随机 8 位码', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await ensureReferralCodeWithClient({ query } as never, 'user');
    expect(query.mock.calls[0]?.[1]).toEqual(['user', expect.stringMatching(/^[A-Z0-9]{8}$/)]);
  });
  it('碰撞时重试，不把唯一冲突作为注册邀请错误', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await ensureReferralCodeWithClient({ query } as never, 'user');
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2]?.[1]?.[1]).toMatch(/^[A-Z0-9]{8}$/);
  });
  it('用户已有邀请码时保持稳定，不执行更新', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: 'user' }] });
    await ensureReferralCodeWithClient({ query } as never, 'user');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.every(([sql]) => !sql.includes('UPDATE'))).toBe(true);
  });
  it('连续碰撞达到上限时返回可重试错误', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(ensureReferralCodeWithClient({ query } as never, 'user')).rejects.toMatchObject({ statusCode: 503 });
    expect(query).toHaveBeenCalledTimes(16);
  });
});
