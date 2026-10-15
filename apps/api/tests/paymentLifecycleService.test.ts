import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  connect: vi.fn(),
  getOrderById: vi.fn(),
  markOrderPaid: vi.fn(),
  markOrderPaymentTerminalFromClaim: vi.fn(),
  recordPaymentUncertain: vi.fn(),
  getPaymentChannelCredentialsByRevision: vi.fn(),
  getCurrentPaymentAttemptRecord: vi.fn(),
  claimCurrentPaymentAttemptForReconciliation: vi.fn(),
  markPaymentAttemptManualReviewFromClaim: vi.fn(),
  markPaymentAttemptUncertain: vi.fn(),
  releasePaymentAttemptAfterPendingQuery: vi.fn(),
  closePaymentOrder: vi.fn(),
  queryPaymentOrder: vi.fn(),
  sendPaymentSuccessEmail: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery, connect: mocks.connect },
}));
vi.mock('../src/domain/ordersService.js', () => ({
  getOrderById: mocks.getOrderById,
  markOrderPaid: mocks.markOrderPaid,
  markOrderPaymentTerminalFromClaim: mocks.markOrderPaymentTerminalFromClaim,
  recordPaymentUncertain: mocks.recordPaymentUncertain,
}));
vi.mock('../src/payments/paymentChannelService.js', () => ({
  getPaymentChannelCredentialsByRevision: mocks.getPaymentChannelCredentialsByRevision,
}));
vi.mock('../src/payments/paymentAttemptService.js', () => ({
  claimCurrentPaymentAttemptForReconciliation: mocks.claimCurrentPaymentAttemptForReconciliation,
  getCurrentPaymentAttemptRecord: mocks.getCurrentPaymentAttemptRecord,
  markPaymentAttemptManualReviewFromClaim: mocks.markPaymentAttemptManualReviewFromClaim,
  markPaymentAttemptUncertain: mocks.markPaymentAttemptUncertain,
  releasePaymentAttemptAfterPendingQuery: mocks.releasePaymentAttemptAfterPendingQuery,
}));
vi.mock('../src/payments/jeepayService.js', () => ({
  closePaymentOrder: mocks.closePaymentOrder,
  queryPaymentOrder: mocks.queryPaymentOrder,
}));
vi.mock('../src/notifications/emailService.js', () => ({
  sendPaymentSuccessEmail: mocks.sendPaymentSuccessEmail,
}));

import { closeAndReconcilePaymentOrder, sweepExpiredPaymentOrders, syncPaymentOrder } from '../src/payments/paymentLifecycleService.js';
import { endpointContracts } from '@lindyson/api-contracts';

const pendingOrder = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  userName: '测试用户',
  email: 'user@example.com',
  planId: '33333333-3333-4333-8333-333333333333',
  kind: 'addon' as const,
  planName: '积分包',
  amount: 5900,
  billing: 'one-time' as const,
  status: 'pending' as const,
  invoiceStatus: 'unissued',
  invoiceRequestStatus: null,
  creditStatus: 'none',
  creditAmount: 30_000,
  creditBucket: 'addon',
  paymentMethod: '支付宝',
  paymentMethodLabel: '支付宝',
  paymentWayLabel: '支付宝扫码支付',
  paymentProvider: 'jeepay',
  paymentWayCode: 'ALI_WAP',
  paymentSurface: 'pc',
  merchantOrderNo: 'ord_123456789012345678901234',
  paymentOrderNo: 'P100',
  paymentError: null,
  paymentAttemptStatus: 'ready',
  paymentAttemptId: '55555555-5555-4555-8555-555555555555',
  paymentAttemptError: null,
  paymentRetryAfterMs: null,
  paymentExpiresAt: '2026-07-10T07:00:00.000Z',
  refundStatus: 'none',
  merchantRefundNo: null,
  refundOrderNo: null,
  refundError: null,
  refundAttemptStatus: null,
  refundAttemptId: null,
  refundManualReviewReason: null,
  refundRetryAfterMs: null,
  createdAt: '2026-07-10T05:00:00.000Z',
  paidAt: null,
  failedAt: null,
  refundedAt: null,
};

const config = {
  revisionId: '44444444-4444-4444-8444-444444444444',
  enabled: true,
  apiBase: 'https://pay.example.com',
  mchNo: 'M100',
  appId: 'APP100',
  apiKey: 'secret',
  hasApiKey: true,
  desktopWayCode: 'ALI_WAP' as const,
  mobileWayCode: 'ALI_WAP' as const,
};

function queryResult(state: number) {
  return {
    payOrderId: 'P100',
    mchOrderNo: pendingOrder.merchantOrderNo,
    mchNo: config.mchNo,
    appId: config.appId,
    wayCode: 'ALI_WAP',
    amount: pendingOrder.amount,
    currency: 'CNY',
    state,
  };
}

describe('支付订单生命周期', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrderById.mockResolvedValue(pendingOrder);
    mocks.getPaymentChannelCredentialsByRevision.mockResolvedValue(config);
    const attempt = {
      id: '55555555-5555-4555-8555-555555555555',
      order_id: pendingOrder.id,
      channel_revision_id: config.revisionId,
      merchant_order_no: pendingOrder.merchantOrderNo,
      return_origin: 'https://www.lindyson.com',
      provider_order_id: pendingOrder.paymentOrderNo,
      amount: pendingOrder.amount,
      currency: 'CNY',
      status: 'ready',
      lease_token: null,
    };
    const claim = {
      id: attempt.id,
      orderId: pendingOrder.id,
      merchantOrderNo: pendingOrder.merchantOrderNo,
      channelRevisionId: config.revisionId,
      returnOrigin: 'https://www.lindyson.com',
      leaseToken: '66666666-6666-4666-8666-666666666666',
      previousStatus: 'ready',
      status: 'processing',
    };
    mocks.getCurrentPaymentAttemptRecord.mockResolvedValue(attempt);
    mocks.claimCurrentPaymentAttemptForReconciliation.mockResolvedValue({
      attempt: { ...attempt, status: 'processing', lease_token: claim.leaseToken },
      claim,
    });
    mocks.markPaymentAttemptUncertain.mockResolvedValue(undefined);
    mocks.markPaymentAttemptManualReviewFromClaim.mockResolvedValue(undefined);
    mocks.releasePaymentAttemptAfterPendingQuery.mockResolvedValue(undefined);
    mocks.markOrderPaid.mockImplementation(async () => {
      const saved = { ...pendingOrder, status: 'paid', paymentAttemptStatus: 'paid' };
      mocks.getOrderById.mockResolvedValue(saved);
      return { ...saved, email: '', userName: '', paymentTransitioned: true };
    });
    mocks.markOrderPaymentTerminalFromClaim.mockImplementation(async (_id, _claim, attemptStatus) => {
      const saved = { ...pendingOrder, status: 'failed', paymentAttemptStatus: attemptStatus };
      mocks.getOrderById.mockResolvedValue(saved);
      return { ...saved, email: '', userName: '', paymentAttemptStatus: 'ready' };
    });
    mocks.recordPaymentUncertain.mockResolvedValue(pendingOrder);
    mocks.closePaymentOrder.mockResolvedValue({ errCode: '', errMsg: '' });
    const lockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ locked: true }] })
        .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(lockClient);
  });

  it('查询到已支付时只执行一次幂等到账', async () => {
    mocks.queryPaymentOrder.mockResolvedValue(queryResult(2));
    const order = await syncPaymentOrder(pendingOrder.id, pendingOrder.userId);
    expect(order.status).toBe('paid');
    expect(mocks.markOrderPaid).toHaveBeenCalledOnce();
    expect(mocks.markOrderPaymentTerminalFromClaim).not.toHaveBeenCalled();
  });

  it.each([2, 3, 4, 6])('查单进入渠道终态 %s 后返回符合契约的完整订单', async state => {
    mocks.queryPaymentOrder.mockResolvedValue(queryResult(state));
    const order = await syncPaymentOrder(pendingOrder.id, pendingOrder.userId);
    expect(endpointContracts.paymentSync.response.safeParse({ order }).success).toBe(true);
    expect(order).toMatchObject({ email: pendingOrder.email, userName: pendingOrder.userName,
      paymentAttemptStatus: state === 2 ? 'paid' : 'failed' });
  });

  it.each([2, 6, null])('首次取消后渠道状态 %s 返回完整订单，不因缺少邮箱而失败', async state => {
    if (state === null) mocks.queryPaymentOrder.mockRejectedValue(new Error('查询暂不可用'));
    else mocks.queryPaymentOrder.mockResolvedValue(queryResult(state));
    const order = await closeAndReconcilePaymentOrder(pendingOrder.id, '用户取消支付', pendingOrder.userId);
    expect(endpointContracts.paymentCancel.response.safeParse({ order }).success).toBe(true);
    expect(order).toMatchObject({ email: pendingOrder.email,
      paymentAttemptStatus: state === 2 ? 'paid' : state === null ? 'closed' : 'failed' });
  });

  it('当前 attempt 存在活动租约时主动查单只返回 pending，不抢 lease', async () => {
    mocks.getCurrentPaymentAttemptRecord.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      order_id: pendingOrder.id,
      status: 'processing',
      lease_token: '77777777-7777-4777-8777-777777777777',
      lease_until: '2099-07-10T07:00:00.000Z',
    });
    mocks.claimCurrentPaymentAttemptForReconciliation.mockResolvedValue(null);

    await expect(syncPaymentOrder(pendingOrder.id, pendingOrder.userId)).resolves.toMatchObject({ status: 'pending' });
    expect(mocks.queryPaymentOrder).not.toHaveBeenCalled();
    expect(mocks.markPaymentAttemptUncertain).not.toHaveBeenCalled();
  });

  it('到期仍支付中时关单并确认关闭后标记支付超时', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ id: pendingOrder.id }] });
    mocks.queryPaymentOrder
      .mockResolvedValueOnce(queryResult(1))
      .mockResolvedValueOnce(queryResult(6));
    const summary = await sweepExpiredPaymentOrders();
    expect(mocks.closePaymentOrder).toHaveBeenCalledWith(
      config,
      pendingOrder.merchantOrderNo,
      pendingOrder.paymentOrderNo,
    );
    expect(mocks.markOrderPaymentTerminalFromClaim).toHaveBeenCalledWith(
      pendingOrder.id,
      expect.objectContaining({ leaseToken: expect.any(String) }),
      'failed',
      '支付超时',
      'P100',
    );
    expect(summary).toEqual({ scanned: 1, paid: 0, failed: 1, pending: 0, skipped: 0 });
  });

  it('到期查询暂时失败时保持待支付等待下轮重试', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ id: pendingOrder.id }] });
    mocks.queryPaymentOrder.mockRejectedValue(new Error('network'));
    const summary = await sweepExpiredPaymentOrders();
    expect(mocks.closePaymentOrder).not.toHaveBeenCalled();
    expect(mocks.recordPaymentUncertain).toHaveBeenCalledWith(pendingOrder.id, '支付超时状态暂时无法确认');
    expect(summary.pending).toBe(1);
  });

  it('关单已确认但 Jeepay 查单短暂仍为支付中时也标记失败', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ id: pendingOrder.id }] });
    mocks.queryPaymentOrder
      .mockResolvedValueOnce(queryResult(1))
      .mockResolvedValueOnce(queryResult(1));
    const summary = await sweepExpiredPaymentOrders();
    expect(mocks.markOrderPaymentTerminalFromClaim).toHaveBeenCalledWith(
      pendingOrder.id,
      expect.objectContaining({ leaseToken: expect.any(String) }),
      'closed',
      '支付超时',
      'P100',
    );
    expect(summary.failed).toBe(1);
  });
});
