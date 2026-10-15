import type { AdminOrder,PaymentAttemptStatus,RefundAttemptStatus } from './admin';

export function paymentAttemptStatusLabel(status: PaymentAttemptStatus) {
  return {
    queued: '等待创建支付入口',
    processing: '正在创建支付入口',
    ready: '等待付款',
    uncertain: '支付结果确认中',
    paid: '已支付',
    closed: '已关闭',
    failed: '支付失败',
    'manual-review': '需人工核对',
  }[status];
}

export function refundAttemptStatusLabel(status: RefundAttemptStatus | null | undefined) {
  if (!status) return '未退款';
  return {
    queued: '退款排队中',
    processing: '退款处理中',
    submitted: '退款已提交，等待确认',
    uncertain: '退款结果暂不确定',
    succeeded: '已退款',
    failed: '退款失败',
    'manual-review': '需人工核对',
  }[status];
}

export function formatRetryAfterMs(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (value <= 0) return '可立即重试';
  const seconds = Math.max(1, Math.ceil(value / 1_000));
  if (seconds < 60) return `约 ${seconds} 秒后重试`;
  return `约 ${Math.ceil(seconds / 60)} 分钟后重试`;
}

export function isPaymentAttemptDefinitivelyFailed(order: AdminOrder) {
  return order.status === 'failed'
    || order.paymentAttemptStatus === 'failed'
    || order.paymentAttemptStatus === 'closed';
}

export function paymentFailureMessage(order: AdminOrder) {
  if (order.paymentAttemptStatus === 'manual-review') {
    return order.paymentAttemptError || '支付信息需要人工核对，请勿重复付款并联系客户支持';
  }
  if (order.status === 'refunded') return '该订单已退款';
  return order.paymentAttemptError || order.paymentError || '支付未完成，请重新发起支付';
}

export type RefundFeedback = {
  tone: 'success' | 'info' | 'warning' | 'error';
  message: string;
};

export function refundFeedback(order: AdminOrder): RefundFeedback {
  switch (order.refundAttemptStatus) {
    case 'succeeded':
      return { tone: 'success', message: '订单已退款，相关积分状态已同步' };
    case 'failed':
      return { tone: 'error', message: order.refundError || '退款失败，请核对支付状态后重试' };
    case 'manual-review':
      return {
        tone: 'warning',
        message: order.refundManualReviewReason || '退款信息存在冲突，已转人工核对；积分将继续保持冻结',
      };
    case 'uncertain':
      return { tone: 'warning', message: '退款结果暂时无法确认，系统会继续自动查询；积分将继续保持冻结' };
    case 'submitted':
      return { tone: 'info', message: '退款已提交，系统会继续自动查询支付服务结果' };
    case 'processing':
      return { tone: 'info', message: '退款正在处理，系统会自动查询结果' };
    case 'queued':
      return { tone: 'info', message: '退款已进入队列，尚未确认退款成功' };
    default:
      if (order.refundStatus === 'succeeded') {
        return { tone: 'success', message: '订单已退款，相关积分状态已同步' };
      }
      if (order.refundStatus === 'failed') {
        return { tone: 'error', message: order.refundError || '退款失败，请核对支付状态后重试' };
      }
      return { tone: 'info', message: '退款状态已刷新' };
  }
}
