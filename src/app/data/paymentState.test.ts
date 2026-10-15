import { describe,expect,it } from 'vitest';
import type { AdminOrder } from './admin';
import {
  formatRetryAfterMs,
  isPaymentAttemptDefinitivelyFailed,
  paymentAttemptStatusLabel,
  refundAttemptStatusLabel,
  refundFeedback,
} from './paymentState';

describe('支付与退款状态文案', () => {
  it('明确区分支付关闭、人工核对与退款未知状态', () => {
    expect(paymentAttemptStatusLabel('closed')).toBe('已关闭');
    expect(paymentAttemptStatusLabel('manual-review')).toBe('需人工核对');
    expect(refundAttemptStatusLabel('uncertain')).toBe('退款结果暂不确定');
    expect(isPaymentAttemptDefinitivelyFailed(order({ paymentAttemptStatus: 'closed' }))).toBe(true);
    expect(isPaymentAttemptDefinitivelyFailed(order({ paymentAttemptStatus: 'manual-review' }))).toBe(false);
  });

  it('退款未知和人工核对不得使用成功语义或宣称积分已释放', () => {
    expect(refundFeedback(order({ refundStatus: 'pending', refundAttemptStatus: 'uncertain' }))).toEqual({
      tone: 'warning',
      message: '退款结果暂时无法确认，系统会继续自动查询；积分将继续保持冻结',
    });
    expect(refundFeedback(order({
      refundStatus: 'pending',
      refundAttemptStatus: 'manual-review',
      refundManualReviewReason: '供应商退款号冲突',
    }))).toEqual({
      tone: 'warning',
      message: '供应商退款号冲突',
    });
  });

  it('格式化服务端重试等待时间', () => {
    expect(formatRetryAfterMs(null)).toBeNull();
    expect(formatRetryAfterMs(0)).toBe('可立即重试');
    expect(formatRetryAfterMs(1_500)).toBe('约 2 秒后重试');
    expect(formatRetryAfterMs(61_000)).toBe('约 2 分钟后重试');
  });
});

function order(patch: Partial<AdminOrder>): AdminOrder {
  return {
    id: 'order-1',
    userId: 'user-1',
    userName: '用户',
    email: 'user@example.com',
    kind: 'main',
    planName: '专业版',
    amount: 100,
    billing: 'monthly',
    status: 'pending',
    invoiceStatus: 'unissued',
    creditStatus: 'none',
    creditAmount: 100,
    creditBucket: 'main',
    paymentMethod: '支付宝',
    createdAt: '2026-07-17 10:00',
    refundStatus: 'none',
    ...patch,
  };
}
