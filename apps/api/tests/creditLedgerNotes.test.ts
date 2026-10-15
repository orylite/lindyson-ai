import { describe, expect, it } from 'vitest';
import {
  adminCreditAdjustmentNote,
  creditLedgerNotes,
  orderPaymentCreditNote,
  subscriptionResetCreditNote,
} from '../src/domain/creditLedgerNotes.js';

describe('用户积分流水文案', () => {
  it('生成失败与取消分别说明预扣解除和积分退回结果', () => {
    expect(creditLedgerNotes.generationFailedHoldReleased).toBe('视频生成失败，本次预扣已解除。');
    expect(creditLedgerNotes.generationFailedRefunded).toBe('视频生成失败，本次预扣积分已退回账户。');
    expect(creditLedgerNotes.generationCanceledHoldReleased).toBe('任务已取消，本次预扣已解除。');
    expect(creditLedgerNotes.generationCanceledRefunded).toBe('任务已取消，本次预扣积分已退回账户。');
    expect(creditLedgerNotes.generationCanceledRefundedWithExpiry).toContain('已过期积分未重新计入账户');
    expect(creditLedgerNotes.generationFailedRefundedWithExpiry).toContain('已过期积分未重新计入账户');
  });

  it('支付与套餐重置保留动态套餐名称', () => {
    expect(orderPaymentCreditNote('Pro 专业版')).toBe('购买“Pro 专业版”成功，套餐积分已到账。');
    expect(subscriptionResetCreditNote('Pro 专业版')).toBe('新订阅周期已开始，“Pro 专业版”套餐积分已重置。');
  });

  it('管理员调整按正负生成公开备注', () => {
    expect(adminCreditAdjustmentNote(100)).toBe('账户积分已补发。');
    expect(adminCreditAdjustmentNote(-100)).toBe('账户积分已由管理员调整。');
  });
});
