import { describe, expect, it } from 'vitest';
import { mapUserCreditLedgerRow, type CreditLedgerRow } from '../src/domain/creditLedger.js';

const BASE_ROW: CreditLedgerRow = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  type: 'refund',
  bucket: 'main',
  settlement_status: 'refunded',
  amount: 122,
  balance: 500,
  source: '生成任务退回',
  operator: 'system',
  note: '首次执行失败',
  related_order_id: null,
  related_job_id: '33333333-3333-4333-8333-333333333333',
  related_asset_id: null,
  created_at: '2026-08-12T02:00:00.000Z',
};

describe('用户生成积分流水快照映射', () => {
  it('返回该笔流水的 attempt 与结算事实，不需要读取任务当前行', () => {
    const entry = mapUserCreditLedgerRow({
      ...BASE_ROW,
      generation_snapshot: {
        attempt: 0,
        model: 'Seedance 2.5',
        durationSeconds: 15,
        resolution: '720p',
        hasReferenceVideo: false,
        reservedCredits: 122,
        settledCredits: 0,
        refundedCredits: 122,
        taskStatus: 'failed',
        creditStatus: 'refunded',
      },
    });
    expect(entry.generationSnapshot).toEqual(expect.objectContaining({
      attempt: 0,
      model: 'Seedance 2.5',
      taskStatus: 'failed',
      refundedCredits: 122,
    }));
  });

  it('非生成流水或迁移前兼容行显式返回 null', () => {
    expect(mapUserCreditLedgerRow({ ...BASE_ROW, related_job_id: null }).generationSnapshot).toBeNull();
    expect(mapUserCreditLedgerRow({ ...BASE_ROW, generation_snapshot: { attempt: '伪造' } }).generationSnapshot).toBeNull();
  });
});
