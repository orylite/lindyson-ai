import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  poolQuery: vi.fn(),
  createOrder: vi.fn(),
  getOrderById: vi.fn(),
  getOrderByIdempotencyKey: vi.fn(),
  createPaymentOrder: vi.fn(),
  setPaymentOrderCreated: vi.fn(),
  getPaymentChannelCredentials: vi.fn(),
  listUserOrdersPage: vi.fn(),
  closeAndReconcilePaymentOrder: vi.fn(),
  syncPaymentOrder: vi.fn(),
  normalizePaymentNotifyPayload: vi.fn(),
  verifyPaymentSign: vi.fn(),
  getOrderByMerchantOrderNo: vi.fn(),
  getOrderByMerchantRefundNo: vi.fn(),
  getRefundAttemptByMerchantRefundNo: vi.fn(),
  markOrderPaid: vi.fn(),
  markOrderPaymentFailedFromProviderEvent: vi.fn(),
  markOrderPaymentTerminalFromClaim: vi.fn(),
  markRefundAttemptManualReview: vi.fn(),
  applyRefundResult: vi.fn(),
  ensurePaymentAttempt: vi.fn(),
  claimPaymentAttempt: vi.fn(),
  getCurrentPaymentAttempt: vi.fn(),
  getPaymentAttemptByMerchantOrderNo: vi.fn(),
  getPaymentAttemptByIdempotencyKey: vi.fn(),
  hashPaymentRequest: vi.fn(),
  markPaymentAttemptManualReviewFromClaim: vi.fn(),
  markPaymentAttemptReady: vi.fn(),
  markPaymentAttemptUncertain: vi.fn(),
  markPaymentAttemptManualReviewFromProviderEvent: vi.fn(),
  createPaymentRetryAttempt: vi.fn(),
  getPaymentChannelCredentialsByRevision: vi.fn(),
  resolveTrustedRequestAppOrigin: vi.fn(),
  paginationTotal: 2,
}));

vi.mock('../src/auth/session.js', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('../src/config/requestOrigin.js', () => ({
  resolveTrustedRequestAppOrigin: mocks.resolveTrustedRequestAppOrigin,
}));
vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withReadOnlyRepeatableRead: (fn: (client: { query: typeof mocks.poolQuery }) => unknown) => fn({ query: paginationQuery as typeof mocks.poolQuery }),
}));

const paginationQuery = (sql: unknown, values?: unknown[]) => {
  const text = String(sql);
  if (text.includes('user_pagination_versions')) {
    return Promise.resolve({ rows: [{ version: '0', snapshot_at: '2026-07-17T11:00:00.000Z' }], rowCount: 1 });
  }
  if (text.includes('SELECT count(*)::text AS count')) {
    return Promise.resolve({ rows: [{ count: String(mocks.paginationTotal) }], rowCount: 1 });
  }
  return mocks.poolQuery(sql, values);
};
vi.mock('../src/domain/ordersService.js', () => ({
  applyRefundResult: mocks.applyRefundResult,
  createOrder: mocks.createOrder,
  getOrderById: mocks.getOrderById,
  getOrderByIdempotencyKey: mocks.getOrderByIdempotencyKey,
  getOrderByMerchantOrderNo: mocks.getOrderByMerchantOrderNo,
  getOrderByMerchantRefundNo: mocks.getOrderByMerchantRefundNo,
  getRefundAttemptByMerchantRefundNo: mocks.getRefundAttemptByMerchantRefundNo,
  listOrders: vi.fn(),
  listUserOrdersPage: mocks.listUserOrdersPage,
  markOrderPaymentFailedFromProviderEvent: mocks.markOrderPaymentFailedFromProviderEvent,
  markOrderPaid: mocks.markOrderPaid,
  markOrderPaymentTerminalFromClaim: mocks.markOrderPaymentTerminalFromClaim,
  markRefundAttemptManualReview: mocks.markRefundAttemptManualReview,
  recordPaymentUncertain: vi.fn(),
  setPaymentOrderCreated: mocks.setPaymentOrderCreated,
}));
vi.mock('../src/payments/jeepayService.js', async () => ({
  ...(await vi.importActual<typeof import('../src/payments/jeepayService.js')>('../src/payments/jeepayService.js')),
  createPaymentOrder: mocks.createPaymentOrder,
  normalizePaymentNotifyPayload: mocks.normalizePaymentNotifyPayload,
  verifyPaymentSign: mocks.verifyPaymentSign,
}));
vi.mock('../src/payments/paymentChannelService.js', () => ({
  getPaymentChannelCredentials: mocks.getPaymentChannelCredentials,
  getPaymentChannelCredentialsByRevision: mocks.getPaymentChannelCredentialsByRevision,
}));
vi.mock('../src/payments/paymentAttemptService.js', () => ({
  claimPaymentAttempt: mocks.claimPaymentAttempt,
  createPaymentRetryAttempt: mocks.createPaymentRetryAttempt,
  ensurePaymentAttempt: mocks.ensurePaymentAttempt,
  getCurrentPaymentAttempt: mocks.getCurrentPaymentAttempt,
  getPaymentAttemptByMerchantOrderNo: mocks.getPaymentAttemptByMerchantOrderNo,
  getPaymentAttemptByIdempotencyKey: mocks.getPaymentAttemptByIdempotencyKey,
  hashPaymentRequest: mocks.hashPaymentRequest,
  isPaymentAttemptStaleClaim: (error: unknown) => Boolean(
    error && typeof error === 'object'
    && (error as { code?: unknown }).code === 'PAYMENT_ATTEMPT_STALE_CLAIM'
  ),
  markPaymentAttemptManualReviewFromClaim: mocks.markPaymentAttemptManualReviewFromClaim,
  markPaymentAttemptReady: mocks.markPaymentAttemptReady,
  markPaymentAttemptUncertain: mocks.markPaymentAttemptUncertain,
  markPaymentAttemptManualReviewFromProviderEvent: mocks.markPaymentAttemptManualReviewFromProviderEvent,
}));
vi.mock('../src/notifications/emailService.js', () => ({ sendPaymentSuccessEmail: vi.fn() }));
vi.mock('../src/payments/paymentLifecycleService.js', () => ({
  closeAndReconcilePaymentOrder: mocks.closeAndReconcilePaymentOrder,
  sendPaymentEmailIfNeeded: vi.fn(),
  syncPaymentOrder: mocks.syncPaymentOrder,
}));

import { registerOrdersRoutes } from '../src/routes/ordersRoutes.js';

const UPSTREAM_PAY_URL = 'https://openapi.alipay.com/gateway.do?order=P100';
const PAYMENT_ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const REFUND_ATTEMPT_ID = '55555555-5555-4555-8555-555555555555';
const CHANNEL_REVISION_ID = '66666666-6666-4666-8666-666666666666';

describe('支付路由', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', email: 'user@example.com', role: 'user' });
    mocks.getPaymentChannelCredentials.mockResolvedValue({
      revisionId: CHANNEL_REVISION_ID,
      enabled: true,
      apiBase: 'https://pay.example.com',
      mchNo: 'M100',
      appId: 'APP100',
      apiKey: 'secret',
      hasApiKey: true,
      desktopWayCode: 'ALI_WAP',
      mobileWayCode: 'ALI_WAP',
    });
    mocks.getPaymentChannelCredentialsByRevision.mockResolvedValue({
      revisionId: CHANNEL_REVISION_ID,
      enabled: true,
      apiBase: 'https://pay.example.com',
      mchNo: 'M100',
      appId: 'APP100',
      apiKey: 'secret',
      hasApiKey: true,
      desktopWayCode: 'ALI_WAP',
      mobileWayCode: 'ALI_WAP',
    });
    mocks.getOrderByIdempotencyKey.mockResolvedValue(null);
    mocks.resolveTrustedRequestAppOrigin.mockReturnValue('https://www.lindyson.com');
    mocks.ensurePaymentAttempt.mockResolvedValue(paymentAttemptRecord());
    mocks.claimPaymentAttempt.mockResolvedValue(paymentAttemptClaim());
    mocks.getCurrentPaymentAttempt.mockResolvedValue(paymentAttemptView({
      surface: 'pc', type: 'qr', codeUrl: UPSTREAM_PAY_URL,
    }));
    mocks.getPaymentAttemptByMerchantOrderNo.mockResolvedValue(paymentAttemptRecord());
    mocks.getPaymentAttemptByIdempotencyKey.mockResolvedValue(paymentAttemptView());
    mocks.getRefundAttemptByMerchantRefundNo.mockResolvedValue(refundAttemptRecord());
    mocks.hashPaymentRequest.mockReturnValue('request-hash');
    mocks.markPaymentAttemptReady.mockImplementation(async (_claim, _providerOrderId, launch) => paymentAttemptView(
      launch as ReturnType<typeof paymentLaunch>,
      { status: 'ready' },
    ));
    mocks.markPaymentAttemptManualReviewFromClaim.mockResolvedValue(paymentAttemptView(null, { status: 'manual-review' }));
    mocks.markPaymentAttemptUncertain.mockResolvedValue(paymentAttemptView(null, { status: 'uncertain' }));
    mocks.markPaymentAttemptManualReviewFromProviderEvent.mockResolvedValue(paymentAttemptRecord());
    mocks.markRefundAttemptManualReview.mockResolvedValue(undefined);
    mocks.poolQuery.mockImplementation(async (sql: unknown, values?: unknown[]) => {
      const text = String(sql);
      if (text.includes('INSERT INTO provider_events')) {
        return { rows: [{ id: '77777777-7777-4777-8777-777777777777', payload_hash: values?.[2] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    mocks.listUserOrdersPage.mockResolvedValue({
      items: [],
      pagination: {
        limit: 20, hasPrevious: false, hasNext: false, previousCursor: null, nextCursor: null,
      },
    });
    const order = {
      id: '11111111-1111-4111-8111-111111111111',
      merchantOrderNo: 'ord_123456789012345678901234',
      kind: 'main',
      planName: '专业版',
      billing: 'yearly',
      amount: 22800,
      status: 'pending',
      createdAt: '2026-07-10T06:00:00.000Z',
      paymentExpiresAt: '2026-07-11T04:00:00.000Z',
    };
    mocks.markOrderPaymentTerminalFromClaim.mockResolvedValue({ ...order, status: 'failed' });
    mocks.markOrderPaymentFailedFromProviderEvent.mockResolvedValue({ ...order, status: 'failed' });
    mocks.createOrder.mockResolvedValue(order);
    mocks.createPaymentOrder.mockResolvedValue({
      payOrderId: 'P100',
      mchOrderNo: order.merchantOrderNo,
      orderState: 1,
      payDataType: 'payurl',
      payData: UPSTREAM_PAY_URL,
    });
    mocks.setPaymentOrderCreated.mockResolvedValue({ ...order, paymentOrderNo: 'P100' });
    mocks.normalizePaymentNotifyPayload.mockReturnValue({});
    mocks.verifyPaymentSign.mockReturnValue(false);
    mocks.applyRefundResult.mockResolvedValue(undefined);
  });

  it('桌面订单使用 WAP 上游通道并直接返回支付宝二维码地址', async () => {
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/create',
        payload: {
          planId: '22222222-2222-4222-8222-222222222222',
          billing: 'yearly',
          surface: 'pc',
          idempotencyKey: 'payment-desktop-100',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(mocks.createOrder).toHaveBeenCalledWith(
        'user-1',
        '22222222-2222-4222-8222-222222222222',
        'yearly',
        'jeepay',
        'ALI_WAP',
        'pc',
        expect.any(String),
      );
      expect(mocks.createPaymentOrder).toHaveBeenCalledWith(
        expect.objectContaining({ desktopWayCode: 'ALI_WAP', mobileWayCode: 'ALI_WAP' }),
        expect.objectContaining({ wayCode: 'ALI_WAP', surface: 'pc' }),
      );
      expect(response.json()).toEqual({
        order: {
          id: '11111111-1111-4111-8111-111111111111',
          merchantOrderNo: 'ord_123456789012345678901234',
          kind: 'main',
          planName: '专业版',
          billing: 'yearly',
          amount: 22800,
          status: 'pending',
          createdAt: '2026-07-10T06:00:00.000Z',
          paymentExpiresAt: '2026-07-11T04:00:00.000Z',
          paymentOrderNo: 'P100',
          estimatedPlanResetAt: '2026-08-09',
          estimatedPlanExpiresAt: '2027-07-10',
        },
        payment: {
          surface: 'pc',
          type: 'qr',
          codeUrl: UPSTREAM_PAY_URL,
        },
        paymentAttempt: paymentAttemptView(),
        reused: false,
      });
      const publicResponse = JSON.stringify(response.json()).toLowerCase();
      expect(publicResponse).not.toContain('jeepay');
      expect(publicResponse).toContain('openapi.alipay.com');
      expect(publicResponse).not.toContain('<form');
      expect(response.headers['cache-control']).toBe('no-store, max-age=0');
      expect(response.headers.pragma).toBe('no-cache');
      expect(mocks.markPaymentAttemptReady.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.setPaymentOrderCreated.mock.invocationCallOrder[0]!);
    } finally {
      await app.close();
    }
  });

  it('相同幂等键返回既有订单且不会再次向支付渠道下单', async () => {
    const existingOrder = {
      id: '11111111-1111-4111-8111-111111111111',
      planId: '22222222-2222-4222-8222-222222222222',
      billing: 'yearly',
      status: 'pending',
      paymentProvider: 'jeepay',
      paymentSurface: 'pc',
      paymentOrderNo: 'P100',
    };
    mocks.getOrderByIdempotencyKey.mockResolvedValue(existingOrder);
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/create',
        payload: {
          planId: '22222222-2222-4222-8222-222222222222',
          billing: 'yearly',
          surface: 'pc',
          idempotencyKey: 'payment-attempt-100',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        order: existingOrder,
        paymentAttempt: paymentAttemptView(),
        payment: paymentLaunch(),
        reused: true,
      });
      expect(mocks.createOrder).not.toHaveBeenCalled();
      expect(mocks.getPaymentAttemptByIdempotencyKey).toHaveBeenCalledWith(
        existingOrder.id,
        'user-1',
        'payment-attempt-100',
      );
      expect(mocks.ensurePaymentAttempt).not.toHaveBeenCalled();
      expect(mocks.claimPaymentAttempt).not.toHaveBeenCalled();
      expect(mocks.createPaymentOrder).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('原幂等键重放使用原 attempt，支付通道停用后也不阻断结果读取', async () => {
    const existingOrder = {
      id: '11111111-1111-4111-8111-111111111111',
      planId: '22222222-2222-4222-8222-222222222222',
      billing: 'yearly',
      status: 'pending',
      paymentProvider: 'jeepay',
      paymentSurface: 'pc',
    };
    mocks.getOrderByIdempotencyKey.mockResolvedValue(existingOrder);
    mocks.getPaymentChannelCredentials.mockRejectedValue(new Error('channel disabled'));
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/create',
        payload: {
          planId: existingOrder.planId,
          billing: 'yearly',
          surface: 'pc',
          idempotencyKey: 'payment-replay-disabled-channel',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ reused: true, paymentAttempt: { id: PAYMENT_ATTEMPT_ID } });
      expect(mocks.getPaymentChannelCredentials).not.toHaveBeenCalled();
      expect(mocks.createPaymentOrder).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('并发请求只允许成功认领者调用支付渠道', async () => {
    mocks.claimPaymentAttempt
      .mockResolvedValueOnce(paymentAttemptClaim())
      .mockResolvedValueOnce(null);
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const payload = {
        planId: '22222222-2222-4222-8222-222222222222',
        billing: 'yearly',
        surface: 'pc',
        idempotencyKey: 'payment-attempt-concurrent',
      };
      const [first, second] = await Promise.all([
        app.inject({ method: 'POST', url: '/api/payments/create', payload }),
        app.inject({ method: 'POST', url: '/api/payments/create', payload }),
      ]);

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(mocks.createOrder).toHaveBeenCalledTimes(2);
      expect(mocks.claimPaymentAttempt).toHaveBeenCalledTimes(2);
      expect(mocks.createPaymentOrder).toHaveBeenCalledOnce();
      expect([first.json(), second.json()]).toContainEqual(expect.objectContaining({
        payment: paymentLaunch(),
        reused: true,
      }));
    } finally {
      await app.close();
    }
  });

  it('markReady 发现旧 lease 时不得写订单或发起外部关单', async () => {
    mocks.markPaymentAttemptReady.mockRejectedValue(Object.assign(new Error('支付 attempt 租约已失效'), {
      statusCode: 409,
      code: 'PAYMENT_ATTEMPT_STALE_CLAIM',
      exposeMessage: true,
    }));
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/create',
        payload: {
          planId: '22222222-2222-4222-8222-222222222222',
          billing: 'yearly',
          surface: 'pc',
          idempotencyKey: 'payment-stale-ready-100',
        },
      });
      expect(response.statusCode).toBe(409);
      expect(mocks.setPaymentOrderCreated).not.toHaveBeenCalled();
      expect(mocks.closeAndReconcilePaymentOrder).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('相同幂等键不能改用其他套餐或支付终端', async () => {
    mocks.getOrderByIdempotencyKey.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      planId: '33333333-3333-4333-8333-333333333333',
      billing: 'monthly',
      paymentProvider: 'jeepay',
      paymentSurface: 'mobile',
      status: 'pending',
    });
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/create',
        payload: {
          planId: '22222222-2222-4222-8222-222222222222',
          billing: 'yearly',
          surface: 'pc',
          idempotencyKey: 'payment-attempt-conflict',
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toBe('该幂等键已用于不同的支付请求');
      expect(mocks.createOrder).not.toHaveBeenCalled();
      expect(mocks.createPaymentOrder).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('旧手工订单端点已删除，不能绕过在线支付幂等流程', async () => {
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/orders',
        payload: {
          planId: '22222222-2222-4222-8222-222222222222',
          billing: 'yearly',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(mocks.createOrder).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('旧开发支付 webhook 已删除，不能无认证标记订单已支付', async () => {
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/webhook',
        payload: {
          orderId: '11111111-1111-4111-8111-111111111111',
          event: 'paid',
          paymentOrderNo: 'manual-paid',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(mocks.markOrderPaid).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('积分加购订单不返回预计套餐日期', async () => {
    const addonOrder = {
      id: '11111111-1111-4111-8111-111111111111',
      merchantOrderNo: 'ord_123456789012345678901234',
      kind: 'addon',
      planName: '30,000 积分加购包',
      billing: 'one-time',
      amount: 5900,
      status: 'pending',
      createdAt: '2026-07-10T06:00:00.000Z',
      paymentExpiresAt: '2026-07-11T04:00:00.000Z',
    };
    mocks.createOrder.mockResolvedValue(addonOrder);
    mocks.setPaymentOrderCreated.mockResolvedValue({ ...addonOrder, paymentOrderNo: 'P100' });
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/create',
        payload: {
          planId: '22222222-2222-4222-8222-222222222222',
          billing: 'one-time',
          surface: 'pc',
          idempotencyKey: 'payment-addon-100',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().order).toEqual({ ...addonOrder, paymentOrderNo: 'P100' });
      expect(response.json().order).not.toHaveProperty('estimatedPlanResetAt');
      expect(response.json().order).not.toHaveProperty('estimatedPlanExpiresAt');
    } finally {
      await app.close();
    }
  });

  it('统一下单立即已支付时仍保留主套餐预计日期', async () => {
    mocks.createPaymentOrder.mockResolvedValue({
      payOrderId: 'P100',
      mchOrderNo: 'ord_123456789012345678901234',
      orderState: 2,
    });
    mocks.syncPaymentOrder.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'main',
      planName: '专业版',
      billing: 'yearly',
      status: 'paid',
      paymentOrderNo: 'P100',
    });
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/create',
        payload: {
          planId: '22222222-2222-4222-8222-222222222222',
          billing: 'yearly',
          surface: 'pc',
          idempotencyKey: 'payment-immediate-paid-100',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        order: {
          id: '11111111-1111-4111-8111-111111111111',
          kind: 'main',
          planName: '专业版',
          billing: 'yearly',
          status: 'paid',
          paymentOrderNo: 'P100',
          estimatedPlanResetAt: '2026-08-09',
          estimatedPlanExpiresAt: '2027-07-10',
        },
        paymentAttempt: paymentAttemptView(),
        payment: null,
        reused: false,
      });
      expect(mocks.syncPaymentOrder).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        'user-1',
        paymentAttemptClaim(),
      );
      expect(mocks.setPaymentOrderCreated).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('已删除的支付短链接端点返回 404', async () => {
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/payments/qr/AQEBAQEBAQEBAQEBAQEBAQ',
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('移动端保留 Jeepay 表单支付字段', async () => {
    mocks.createPaymentOrder.mockResolvedValue({
      payOrderId: 'P101',
      mchOrderNo: 'ord_123456789012345678901234',
      orderState: 1,
      payDataType: 'form',
      payData: '<form action="https://openapi.alipay.com/gateway.do" method="post"><input type="hidden" name="biz_content" value="signed-value"></form>',
    });
    mocks.setPaymentOrderCreated.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      merchantOrderNo: 'ord_123456789012345678901234',
      planName: '专业版',
      billing: 'yearly',
      amount: 22800,
      status: 'pending',
      paymentOrderNo: 'P101',
    });
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/create',
        payload: {
          planId: '22222222-2222-4222-8222-222222222222',
          billing: 'yearly',
          surface: 'mobile',
          idempotencyKey: 'payment-mobile-form-100',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().payment).toEqual({
        surface: 'mobile',
        type: 'form',
        action: 'https://openapi.alipay.com/gateway.do',
        method: 'POST',
        fields: [{ name: 'biz_content', value: 'signed-value' }],
      });
      expect(mocks.createOrder).toHaveBeenCalledWith(
        'user-1',
        '22222222-2222-4222-8222-222222222222',
        'yearly',
        'jeepay',
        'ALI_WAP',
        'mobile',
        expect.any(String),
      );
    } finally {
      await app.close();
    }
  });

  it('移动端首次支付持久化并使用发起请求的可信 cn 来源', async () => {
    mocks.resolveTrustedRequestAppOrigin.mockReturnValue('https://www.lindyson.cn');
    mocks.claimPaymentAttempt.mockResolvedValue(paymentAttemptClaim({
      returnOrigin: 'https://www.lindyson.cn',
    }));
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/create',
        headers: { origin: 'https://www.lindyson.cn' },
        payload: {
          planId: '22222222-2222-4222-8222-222222222222',
          billing: 'yearly',
          surface: 'mobile',
          idempotencyKey: 'payment-mobile-cn-origin',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.ensurePaymentAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ id: '11111111-1111-4111-8111-111111111111' }),
        'payment-mobile-cn-origin',
        'request-hash',
        expect.objectContaining({ revisionId: CHANNEL_REVISION_ID }),
        'https://www.lindyson.cn',
      );
      expect(mocks.createPaymentOrder).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ returnOrigin: 'https://www.lindyson.cn' }),
      );
    } finally {
      await app.close();
    }
  });

  it('支付重试把本次可信 cn 来源传给新 attempt', async () => {
    mocks.resolveTrustedRequestAppOrigin.mockReturnValue('https://www.lindyson.cn');
    mocks.createPaymentRetryAttempt.mockResolvedValue(paymentAttemptView(null, { status: 'queued' }));
    mocks.getOrderById.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'pending',
    });
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/orders/11111111-1111-4111-8111-111111111111/retry',
        headers: { origin: 'https://www.lindyson.cn' },
        payload: { idempotencyKey: 'payment-retry-cn-origin' },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.createPaymentRetryAttempt).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        'user-1',
        'payment-retry-cn-origin',
        expect.objectContaining({ revisionId: CHANNEL_REVISION_ID }),
        'https://www.lindyson.cn',
      );
    } finally {
      await app.close();
    }
  });

  it('桌面端收到表单时安全关单且不返回原始 HTML', async () => {
    mocks.createPaymentOrder.mockResolvedValue({
      payOrderId: 'P102',
      mchOrderNo: 'ord_123456789012345678901234',
      orderState: 1,
      payDataType: 'form',
      payData: '<form action="https://openapi.alipay.com/gateway.do" method="post"><input name="biz_content" value="signed-value"></form>',
    });
    mocks.closeAndReconcilePaymentOrder.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'failed',
    });
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/create',
        payload: {
          planId: '22222222-2222-4222-8222-222222222222',
          billing: 'yearly',
          surface: 'pc',
          idempotencyKey: 'payment-invalid-form-100',
        },
      });
      expect(response.statusCode).toBe(502);
      expect(response.body).not.toContain('<form');
      expect(response.body).not.toContain('signed-value');
      expect(mocks.closeAndReconcilePaymentOrder).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        '支付二维码创建失败',
        undefined,
        paymentAttemptClaim(),
      );
    } finally {
      await app.close();
    }
  });

  it('支付启动数据异常但关单核对发现已支付时返回完整 attempt 契约', async () => {
    mocks.createPaymentOrder.mockResolvedValue({
      payOrderId: 'P105',
      mchOrderNo: 'ord_123456789012345678901234',
      orderState: 1,
      payDataType: 'form',
      payData: '<form action="https://openapi.alipay.com/gateway.do" method="post"><input name="biz_content" value="signed-value"></form>',
    });
    const paidOrder = {
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'main',
      billing: 'yearly',
      status: 'paid',
    };
    const paidAttempt = paymentAttemptView(null, { status: 'paid' });
    mocks.closeAndReconcilePaymentOrder.mockResolvedValue(paidOrder);
    mocks.getCurrentPaymentAttempt.mockResolvedValue(paidAttempt);
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/create',
        payload: {
          planId: '22222222-2222-4222-8222-222222222222',
          billing: 'yearly',
          surface: 'pc',
          idempotencyKey: 'payment-launch-reconciled-paid',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        order: paidOrder,
        paymentAttempt: paidAttempt,
        payment: null,
        reused: false,
      });
    } finally {
      await app.close();
    }
  });

  it('桌面端收到支付网关首跳地址时安全关单', async () => {
    const gatewayUrl = 'https://pay.example.com/cashier?order=P103';
    mocks.createPaymentOrder.mockResolvedValue({
      payOrderId: 'P103',
      mchOrderNo: 'ord_123456789012345678901234',
      orderState: 1,
      payDataType: 'payurl',
      payData: gatewayUrl,
    });
    mocks.closeAndReconcilePaymentOrder.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'failed',
    });
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/create',
        payload: {
          planId: '22222222-2222-4222-8222-222222222222',
          billing: 'yearly',
          surface: 'pc',
          idempotencyKey: 'payment-invalid-gateway-100',
        },
      });
      expect(response.statusCode).toBe(502);
      expect(response.body).not.toContain(gatewayUrl);
      expect(mocks.closeAndReconcilePaymentOrder).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        '支付二维码创建失败',
        undefined,
        paymentAttemptClaim(),
      );
      expect(mocks.markOrderPaymentTerminalFromClaim).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        paymentAttemptClaim(),
        'failed',
        '支付二维码创建失败',
      );
    } finally {
      await app.close();
    }
  });

  it('桌面端收到超过 2048 字节的支付宝地址时安全关单', async () => {
    const oversizedUrl = `https://openapi.alipay.com/gateway.do?token=${'a'.repeat(2_100)}`;
    mocks.createPaymentOrder.mockResolvedValue({
      payOrderId: 'P104',
      mchOrderNo: 'ord_123456789012345678901234',
      orderState: 1,
      payDataType: 'payurl',
      payData: oversizedUrl,
    });
    mocks.closeAndReconcilePaymentOrder.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'failed',
    });
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/create',
        payload: {
          planId: '22222222-2222-4222-8222-222222222222',
          billing: 'yearly',
          surface: 'pc',
          idempotencyKey: 'payment-oversized-url-100',
        },
      });
      expect(response.statusCode).toBe(502);
      expect(response.body).not.toContain(oversizedUrl);
      expect(mocks.closeAndReconcilePaymentOrder).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        '支付二维码创建失败',
        undefined,
        paymentAttemptClaim(),
      );
    } finally {
      await app.close();
    }
  });

  it('用户取消二维码支付时按当前用户安全关单', async () => {
    mocks.closeAndReconcilePaymentOrder.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'failed',
    });
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/orders/11111111-1111-4111-8111-111111111111/cancel',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        order: { id: '11111111-1111-4111-8111-111111111111', status: 'failed' },
      });
      expect(mocks.closeAndReconcilePaymentOrder).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        '用户取消支付',
        'user-1',
      );
    } finally {
      await app.close();
    }
  });

  it('取消过程中发现已支付时仍返回已支付订单', async () => {
    mocks.closeAndReconcilePaymentOrder.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'paid',
    });
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/orders/11111111-1111-4111-8111-111111111111/cancel',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().order.status).toBe('paid');
    } finally {
      await app.close();
    }
  });

  it('关单状态不确定时保留待支付订单，不虚报取消成功', async () => {
    mocks.closeAndReconcilePaymentOrder.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'pending',
      paymentError: '支付订单关单状态暂时无法确认',
    });
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/orders/11111111-1111-4111-8111-111111111111/cancel',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().order.status).toBe('pending');
    } finally {
      await app.close();
    }
  });

  it('用户订单只接受四向 cursor/limit，并拒绝旧页码参数', async () => {
    mocks.listUserOrdersPage.mockResolvedValue({
      items: [],
      pagination: {
        limit: 25, hasPrevious: false, hasNext: false, previousCursor: null, nextCursor: null,
      },
    });
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/orders?limit=25&status=paid' });
      expect(response.statusCode).toBe(200);
      expect(mocks.listUserOrdersPage).toHaveBeenCalledWith(
        expect.anything(),
        'user-1',
        expect.objectContaining({
          limit: 25,
          position: 'first',
          cursor: null,
          status: 'paid',
          reverseQuery: false,
          resource: 'user-orders',
          fingerprint: expect.any(String),
        }),
      );

      const legacy = await app.inject({ method: 'GET', url: '/api/orders?page=1&pageSize=25' });
      expect(legacy.statusCode).toBeGreaterThanOrEqual(400);
      expect(mocks.listUserOrdersPage).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('创建在线支付订单缺少幂等键时拒绝调用本地订单和支付渠道', async () => {
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/create',
        payload: {
          planId: '22222222-2222-4222-8222-222222222222',
          billing: 'yearly',
          surface: 'pc',
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().message).toBe('创建支付订单必须提供幂等键');
      expect(mocks.createOrder).not.toHaveBeenCalled();
      expect(mocks.createPaymentOrder).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('合法支付通知完成幂等到账并返回 success', async () => {
    const payload = paymentNotifyPayload();
    mocks.normalizePaymentNotifyPayload.mockReturnValue(payload);
    mocks.verifyPaymentSign.mockReturnValue(true);
    mocks.getOrderByMerchantOrderNo.mockResolvedValue(paymentOrder());
    mocks.markOrderPaid.mockResolvedValue({ ...paymentOrder(), status: 'paid', paymentTransitioned: true });
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({ method: 'POST', url: '/api/payments/notify', payload });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('success');
      expect(mocks.markOrderPaid).toHaveBeenCalledWith(paymentOrder().id, 'P100', PAYMENT_ATTEMPT_ID);
    } finally {
      await app.close();
    }
  });

  it('支付失败通知按指定 attempt 交给事务服务，避免旧 attempt 打断 retry', async () => {
    const payload = { ...paymentNotifyPayload(), state: '3' };
    mocks.normalizePaymentNotifyPayload.mockReturnValue(payload);
    mocks.verifyPaymentSign.mockReturnValue(true);
    mocks.getOrderByMerchantOrderNo.mockResolvedValue(paymentOrder());
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({ method: 'POST', url: '/api/payments/notify', payload });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('success');
      expect(mocks.markOrderPaymentFailedFromProviderEvent).toHaveBeenCalledWith(
        paymentOrder().id,
        PAYMENT_ATTEMPT_ID,
        '支付未完成',
        'P100',
      );
      expect(mocks.markOrderPaid).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('支付通知到账处理失败时返回 fail 供 Jeepay 重试', async () => {
    const payload = paymentNotifyPayload();
    mocks.normalizePaymentNotifyPayload.mockReturnValue(payload);
    mocks.verifyPaymentSign.mockReturnValue(true);
    mocks.getOrderByMerchantOrderNo.mockResolvedValue(paymentOrder());
    mocks.markOrderPaid.mockRejectedValue(Object.assign(new Error('operator is not unique'), { code: '42725' }));
    const logEntries: Array<Record<string, unknown>> = [];
    const app = fastify({
      logger: {
        level: 'error',
        stream: {
          write(line: string) {
            logEntries.push(JSON.parse(line) as Record<string, unknown>);
          },
        },
      },
    });
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({ method: 'POST', url: '/api/payments/notify', payload });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('fail');
      expect(mocks.markOrderPaid).toHaveBeenCalledOnce();
      expect(logEntries).toContainEqual(expect.objectContaining({
        stage: 'processing',
        errorCode: '42725',
        merchantOrderNo: payload.mchOrderNo,
      }));
    } finally {
      await app.close();
    }
  });

  it('合法退款通知确认退款并返回 success', async () => {
    const payload = refundNotifyPayload();
    mocks.normalizePaymentNotifyPayload.mockReturnValue(payload);
    mocks.verifyPaymentSign.mockReturnValue(true);
    mocks.getOrderByMerchantRefundNo.mockResolvedValue(refundOrder());
    const app = fastify();
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({ method: 'POST', url: '/api/payments/refunds/notify', payload });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('success');
      expect(mocks.applyRefundResult).toHaveBeenCalledWith(refundOrder().id, {
        refundOrderId: 'R100',
        mchRefundNo: payload.mchRefundNo,
        state: 2,
      }, undefined, REFUND_ATTEMPT_ID);
    } finally {
      await app.close();
    }
  });

  it('退款通知业务处理失败时返回 fail 并记录 processing 阶段', async () => {
    const payload = refundNotifyPayload();
    mocks.normalizePaymentNotifyPayload.mockReturnValue(payload);
    mocks.verifyPaymentSign.mockReturnValue(true);
    mocks.getOrderByMerchantRefundNo.mockResolvedValue(refundOrder());
    mocks.applyRefundResult.mockRejectedValue(Object.assign(new Error('退款积分回滚失败'), { code: 'REFUND_SETTLEMENT_FAILED' }));
    const logEntries: Array<Record<string, unknown>> = [];
    const app = fastify({
      logger: {
        level: 'error',
        stream: {
          write(line: string) {
            logEntries.push(JSON.parse(line) as Record<string, unknown>);
          },
        },
      },
    });
    await app.register(registerOrdersRoutes);
    try {
      const response = await app.inject({ method: 'POST', url: '/api/payments/refunds/notify', payload });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('fail');
      expect(mocks.applyRefundResult).toHaveBeenCalledOnce();
      expect(logEntries).toContainEqual(expect.objectContaining({
        stage: 'processing',
        errorCode: 'REFUND_SETTLEMENT_FAILED',
        merchantRefundNo: payload.mchRefundNo,
      }));
    } finally {
      await app.close();
    }
  });
});

function paymentNotifyPayload() {
  return {
    mchNo: 'M100',
    appId: 'APP100',
    mchOrderNo: 'ord_123456789012345678901234',
    payOrderId: 'P100',
    amount: '100',
    currency: 'CNY',
    state: '2',
    sign: 'VALID',
  };
}

function paymentOrder() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    paymentProvider: 'jeepay',
    amount: 100,
    userId: 'user-1',
    email: 'user@example.com',
    planName: '企业版',
    creditAmount: 50000,
  };
}

function refundNotifyPayload() {
  return {
    mchNo: 'M100',
    appId: 'APP100',
    mchOrderNo: 'ord_123456789012345678901234',
    mchRefundNo: 'ref_123456789012345678901234',
    payOrderId: 'P100',
    refundOrderId: 'R100',
    payAmount: '100',
    refundAmount: '100',
    currency: 'CNY',
    state: '2',
    sign: 'VALID',
  };
}

function refundOrder() {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    paymentProvider: 'jeepay',
    amount: 100,
    merchantOrderNo: 'ord_123456789012345678901234',
    paymentOrderNo: 'P100',
    status: 'paid',
    refundStatus: 'pending',
  };
}

function paymentLaunch() {
  return { surface: 'pc' as const, type: 'qr' as const, codeUrl: UPSTREAM_PAY_URL };
}

function paymentAttemptView(
  launch: ReturnType<typeof paymentLaunch> | Record<string, unknown> | null = paymentLaunch(),
  overrides: Record<string, unknown> = {},
) {
  return {
    id: PAYMENT_ATTEMPT_ID,
    attempt: 1,
    status: 'ready',
    launch,
    retryAfterMs: null,
    error: null,
    manualReviewReason: null,
    createdAt: '2026-07-10T06:00:00.000Z',
    updatedAt: '2026-07-10T06:00:00.000Z',
    ...overrides,
  };
}

function paymentAttemptClaim(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ATTEMPT_ID,
    orderId: '11111111-1111-4111-8111-111111111111',
    merchantOrderNo: 'ord_123456789012345678901234',
    channelRevisionId: CHANNEL_REVISION_ID,
    returnOrigin: 'https://www.lindyson.com',
    leaseToken: '88888888-8888-4888-8888-888888888888',
    previousStatus: 'queued' as const,
    status: 'processing' as const,
    ...overrides,
  };
}

function paymentAttemptRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ATTEMPT_ID,
    order_id: '11111111-1111-4111-8111-111111111111',
    attempt: 1,
    merchant_order_no: 'ord_123456789012345678901234',
    channel_revision_id: CHANNEL_REVISION_ID,
    provider_order_id: 'P100',
    amount: 100,
    currency: 'CNY',
    return_origin: 'https://www.lindyson.com',
    status: 'ready',
    ...overrides,
  };
}

function refundAttemptRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: REFUND_ATTEMPT_ID,
    order_id: '22222222-2222-4222-8222-222222222222',
    merchant_order_no: 'ord_123456789012345678901234',
    merchant_refund_no: 'ref_123456789012345678901234',
    channel_revision_id: CHANNEL_REVISION_ID,
    provider_refund_id: 'R100',
    provider_order_id: 'P100',
    amount: 100,
    currency: 'CNY',
    status: 'submitted',
    ...overrides,
  };
}
