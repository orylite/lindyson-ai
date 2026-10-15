import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockClient = { query: ReturnType<typeof vi.fn> };

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  withTransaction: vi.fn(),
  createRefundOrder: vi.fn(),
  queryRefundOrder: vi.fn(),
  getPaymentChannelCredentialsByRevision: vi.fn(),
  creditPaidOrderWithClient: vi.fn(),
  holdOrderCreditsForRefundWithClient: vi.fn(),
  releaseOrderRefundHoldWithClient: vi.fn(),
  reverseOrderRefundHoldWithClient: vi.fn(),
  enqueuePortraitEntitlementReconcileWithClient: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: mocks.withTransaction,
}));
vi.mock('../src/domain/referrals.js', () => ({
  lockReferralUsersWithClient: vi.fn(), rewardReferralForOrderWithClient: vi.fn(), revokeReferralForOrderWithClient: vi.fn(),
}));
vi.mock('../src/domain/subscriptionLifecycle.js', () => ({ reconcileSubscription: vi.fn() }));
vi.mock('../src/domain/billingClock.js', () => ({ getBillingDate: () => '2026-07-10' }));
vi.mock('../src/payments/paymentChannelService.js', () => ({
  getPaymentChannelCredentialsByRevision: mocks.getPaymentChannelCredentialsByRevision,
}));
vi.mock('../src/payments/jeepayService.js', () => ({
  createRefundOrder: mocks.createRefundOrder,
  isDefinitiveMissingRefundOrder: (error: unknown) => Boolean(
    error instanceof Error
    && (error as { definitive?: unknown }).definitive === true
    && String((error as { providerMessage?: unknown }).providerMessage).includes('退款订单不存在'),
  ),
  queryRefundOrder: mocks.queryRefundOrder,
}));
vi.mock('../src/domain/financialCredits.js', () => ({
  creditPaidOrderWithClient: mocks.creditPaidOrderWithClient,
  holdOrderCreditsForRefundWithClient: mocks.holdOrderCreditsForRefundWithClient,
  releaseOrderRefundHoldWithClient: mocks.releaseOrderRefundHoldWithClient,
  reverseOrderRefundHoldWithClient: mocks.reverseOrderRefundHoldWithClient,
}));
vi.mock('../src/domain/realPortraitReconciliation.js', () => ({
  enqueuePortraitEntitlementReconcileWithClient: mocks.enqueuePortraitEntitlementReconcileWithClient,
}));

import { rewardReferralForOrderWithClient } from '../src/domain/referrals.js';
import {
  applyRefundResult,
  createMerchantOrderNo,
  createOrder,
  mapOrder,
  listUserOrdersPage,
  markOrderPaid,
  markOrderPaymentFailedFromProviderEvent,
  markOrderPaymentTerminalFromClaim,
  markRefundAttemptManualReview,
  processPendingOrderRefunds,
  queueOrderRefundWithClient,
  syncOrderRefund,
} from '../src/domain/ordersService.js';
import {
  materializeExactCursorPageQuery,
  parseExactCursorPageRequest,
} from '../src/domain/cursorPagination.js';

describe('订单财务状态机', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPaymentChannelCredentialsByRevision.mockResolvedValue({
      revisionId: CHANNEL_REVISION_ID,
      apiKey: 'secret',
      mchNo: 'M100',
      appId: 'APP100',
    });
    mocks.creditPaidOrderWithClient.mockResolvedValue({ transitioned: true });
    mocks.holdOrderCreditsForRefundWithClient.mockResolvedValue({
      ledgerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    mocks.releaseOrderRefundHoldWithClient.mockResolvedValue(true);
    mocks.reverseOrderRefundHoldWithClient.mockResolvedValue(true);
    mocks.enqueuePortraitEntitlementReconcileWithClient.mockResolvedValue(true);
  });

  it('用户订单按状态绑定四向复合游标且不再返回 hasMore', async () => {
    const userId = '22222222-2222-4222-8222-222222222222';
    const firstAt = '2026-07-17T10:00:00.123456Z';
    const secondAt = '2026-07-17T09:00:00.123455Z';
    const secondId = '44444444-4444-4444-8444-444444444444';
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(queryResult([
          orderRow({ status: 'paid', created_at: firstAt }),
          orderRow({ id: secondId, status: 'paid', created_at: secondAt }),
        ]))
        .mockResolvedValueOnce(queryResult([
          orderRow({ id: secondId, status: 'paid', created_at: secondAt }),
        ])),
    };
    const firstQuery = {
      ...materializeExactCursorPageQuery(parseExactCursorPageRequest({
        position: 'first',
        limit: 1,
        filters: { userId, status: 'paid', invoiceable: false },
        resource: 'user-orders',
        defaultLimit: 20,
        maxLimit: 50,
      }), { resourceVersion: '0', totalItems: 2, snapshotAt: SNAPSHOT_AT }),
      status: 'paid' as const,
      invoiceable: false,
    };
    const first = await listUserOrdersPage(client as never, userId, firstQuery);

    expect(first.pagination).toEqual({
      limit: 1,
      hasPrevious: false,
      hasNext: true,
      previousCursor: null,
      nextCursor: expect.any(String),
      currentPage: 1,
      totalPages: 2,
      totalItems: 2,
      snapshotCursor: expect.any(String),
    });
    expect(first.pagination).not.toHaveProperty('hasMore');
    expect(client.query.mock.calls[0]?.[1]).toEqual([userId, null, null, 'paid', false, 2]);
    const firstSql = String(client.query.mock.calls[0]?.[0]);
    expect(firstSql).toContain('WITH paged_orders AS MATERIALIZED');
    expect(firstSql).toContain('ORDER BY o.created_at DESC, o.id DESC');
    expect(firstSql).not.toContain('__pagination_total_count');
    expect(firstSql).not.toContain('count(*) OVER()::bigint');
    expect(firstSql).not.toContain('OFFSET');

    const nextQuery = {
      ...materializeExactCursorPageQuery(parseExactCursorPageRequest({
        position: 'next',
        cursor: first.pagination.nextCursor!,
        snapshotCursor: first.pagination.snapshotCursor,
        limit: 1,
        filters: { userId, status: 'paid', invoiceable: false },
        resource: 'user-orders',
        defaultLimit: 20,
        maxLimit: 50,
      }), { resourceVersion: '0', snapshotAt: SNAPSHOT_AT }),
      status: 'paid' as const,
      invoiceable: false,
    };
    const next = await listUserOrdersPage(client as never, userId, nextQuery);
    expect(next.pagination).toEqual({
      limit: 1,
      hasPrevious: true,
      hasNext: false,
      previousCursor: expect.any(String),
      nextCursor: null,
      currentPage: 2,
      totalPages: 2,
      totalItems: 2,
      snapshotCursor: first.pagination.snapshotCursor,
    });
    expect(client.query.mock.calls[1]?.[1]).toEqual([
      userId,
      firstAt,
      '11111111-1111-4111-8111-111111111111',
      'paid',
      false,
      2,
    ]);
  });

  it('用户订单尾页先精确计数再关联支付和退款状态', async () => {
    const userId = '22222222-2222-4222-8222-222222222222';
    const newerId = '11111111-1111-4111-8111-111111111111';
    const olderId = '44444444-4444-4444-8444-444444444444';
    const client = {
      query: vi.fn().mockResolvedValueOnce(queryResult([
        orderRow({
          id: olderId,
          created_at: '2026-07-17T09:00:00.123455Z',
          __pagination_total_count: 2,
        }),
        orderRow({
          id: newerId,
          created_at: '2026-07-17T10:00:00.123456Z',
          __pagination_total_count: 2,
        }),
      ])),
    };
    const query = materializeExactCursorPageQuery(parseExactCursorPageRequest({
      position: 'last',
      limit: 1,
      filters: { userId, status: null, invoiceable: false },
      resource: 'user-orders',
      defaultLimit: 20,
      maxLimit: 50,
    }), { resourceVersion: '0', totalItems: 2, snapshotAt: SNAPSHOT_AT });

    const page = await listUserOrdersPage(client as never, userId, query);

    expect(page.items.map(item => item.id)).toEqual([olderId]);
    expect(page.pagination).toEqual(expect.objectContaining({
      limit: 1,
      hasPrevious: true,
      hasNext: false,
      nextCursor: null,
    }));
    const sql = String(client.query.mock.calls[0]?.[0]);
    expect(sql).not.toContain('count(*) OVER()::bigint');
    expect(sql).not.toContain('OFFSET');
  });

  it('可开票订单筛选在键集分页 SQL 内执行，不再由客户端二次过滤', async () => {
    const userId = '22222222-2222-4222-8222-222222222222';
    const client = {
      query: vi.fn().mockResolvedValueOnce(queryResult([
        orderRow({ status: 'paid', invoice_status: 'unissued' }),
      ])),
    };
    const query = {
      ...materializeExactCursorPageQuery(parseExactCursorPageRequest({
        position: 'first',
        limit: 20,
        filters: { userId, status: null, invoiceable: true },
        resource: 'user-orders',
        defaultLimit: 20,
        maxLimit: 50,
      }), { resourceVersion: '3', totalItems: 1, snapshotAt: SNAPSHOT_AT }),
      invoiceable: true,
    };

    await listUserOrdersPage(client as never, userId, query);

    const sql = String(client.query.mock.calls[0]?.[0]);
    expect(sql).toContain("o.status = 'paid'");
    expect(sql).toContain("o.invoice_status = 'unissued'");
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM invoice_requests');
    expect(sql).not.toContain('OFFSET');
    expect(client.query.mock.calls[0]?.[1]?.[4]).toBe(true);
  });

  it('支付与退款商户单号满足供应商长度限制', () => {
    expect(createMerchantOrderNo('ord')).toMatch(/^ord_[0-9A-Z]{24}$/);
    expect(createMerchantOrderNo('ref')).toMatch(/^ref_[0-9A-Z]{24}$/);
    expect(createMerchantOrderNo('ord').length).toBeLessThanOrEqual(30);
  });

  it('下架套餐不能创建订单', async () => {
    const client = { query: vi.fn().mockResolvedValue(queryResult([])) };
    useTransaction(client);
    await expect(createOrder('user-1', 'plan-disabled', 'monthly')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('相同幂等键复用匹配订单，不匹配请求返回 409', async () => {
    const existing = orderRow({ idempotency_key: 'payment-key', payment_surface: 'pc', payment_way_code: 'ALI_WAP' });
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(queryResult([]))
        .mockResolvedValueOnce(queryResult([existing])),
    };
    useTransaction(client);
    await expect(createOrder(
      existing.user_id,
      existing.plan_id!,
      'monthly',
      'jeepay',
      'ALI_WAP',
      'pc',
      'payment-key',
    )).resolves.toMatchObject({ id: existing.id });

    const conflictClient = {
      query: vi.fn()
        .mockResolvedValueOnce(queryResult([]))
        .mockResolvedValueOnce(queryResult([existing])),
    };
    useTransaction(conflictClient);
    await expect(createOrder(
      existing.user_id,
      '99999999-9999-4999-8999-999999999999',
      'monthly',
      'jeepay',
      'ALI_WAP',
      'pc',
      'payment-key',
    )).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('WAP 通道按终端映射为扫码或手机网页', () => {
    expect(mapOrder(orderRow({ payment_way_code: 'ALI_WAP', payment_surface: 'pc' })).paymentWayLabel)
      .toBe('支付宝扫码支付');
    expect(mapOrder(orderRow({ payment_way_code: 'ALI_WAP', payment_surface: 'mobile' })).paymentWayLabel)
      .toBe('支付宝手机网页');
  });

  it('退款重试倒计时优先读取权威 refund attempt，旧订单字段只作回退', () => {
    const now = Date.now();
    const authoritative = mapOrder(orderRow({
      refund_attempt_next_at: new Date(now + 5_000).toISOString(),
      refund_dispatch_next_at: new Date(now + 60_000).toISOString(),
    }));
    expect(authoritative.refundRetryAfterMs).toBeGreaterThan(0);
    expect(authoritative.refundRetryAfterMs).toBeLessThanOrEqual(5_000);

    const legacy = mapOrder(orderRow({
      refund_attempt_next_at: null,
      refund_dispatch_next_at: new Date(now + 60_000).toISOString(),
    }));
    expect(legacy.refundRetryAfterMs).toBeGreaterThan(50_000);
  });

  it('确认支付通过统一 lot 服务到账，并写 attempt 终态和通知 Outbox', async () => {
    const order = orderRow({ provider_order_id: null, current_payment_attempt_id: PAYMENT_ATTEMPT_ID });
    const client: MockClient = { query: vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.startsWith('SELECT * FROM orders')) return queryResult([order]);
      if (text.includes('SELECT id, provider_order_id, status')) {
        return queryResult([{ id: PAYMENT_ATTEMPT_ID, provider_order_id: null, status: 'processing' }]);
      }
      if (text.includes('SELECT plan_id')) return queryResult([userCreditRow()]);
      if (text.includes('UPDATE users')) return queryResult([]);
      if (text.includes("SET status = 'paid'")) return queryResult([{ ...order, status: 'paid', paid_at: NOW }]);
      if (text.includes('UPDATE payment_attempts')) return queryResult([]);
      if (text.includes('INSERT INTO payment_notification_outbox')) return queryResult([]);
      throw new Error(`未预期查询：${text}`);
    }) };
    useTransaction(client);

    await expect(markOrderPaid(order.id, 'PAY-100', PAYMENT_ATTEMPT_ID)).resolves.toMatchObject({
      status: 'paid', paymentTransitioned: true,
    });
    expect(rewardReferralForOrderWithClient).toHaveBeenCalledWith(client, order);
    expect(mocks.creditPaidOrderWithClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ id: order.id, creditAmount: order.credit_amount }),
      expect.objectContaining({ main_credits: 100 }),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'paid'"),
      expect.arrayContaining([order.id, 'PAY-100', PAYMENT_ATTEMPT_ID]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO payment_notification_outbox'),
      expect.arrayContaining([`payment-succeeded:${order.id}`]),
    );
    const notificationInsert = client.query.mock.calls.find(
      ([sql]) => String(sql).includes('INSERT INTO payment_notification_outbox'),
    );
    expect(String(notificationInsert?.[0])).toContain('VALUES ($1, $2::uuid');
    expect(String(notificationInsert?.[0])).toContain("'orderId', $2::uuid");
    expect(String(notificationInsert?.[0])).not.toContain('$2::text');
    expect(mocks.enqueuePortraitEntitlementReconcileWithClient).toHaveBeenCalledWith(
      client,
      {
        userId: order.user_id,
        eventKey: `portrait-payment:${order.id}`,
        reason: 'main-plan-purchased',
        oldPlanId: null,
        newPlanId: order.plan_id,
      },
    );
  });

  it('同一订单出现不同供应商支付号时转人工核对且不发积分', async () => {
    const order = orderRow({ provider_order_id: 'PAY-OLD', current_payment_attempt_id: PAYMENT_ATTEMPT_ID });
    const client: MockClient = { query: vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.startsWith('SELECT * FROM orders')) return queryResult([order]);
      if (text.includes('SELECT id, provider_order_id, status')) {
        return queryResult([{ id: PAYMENT_ATTEMPT_ID, provider_order_id: 'PAY-OLD', status: 'ready' }]);
      }
      if (text.includes("status = 'manual-review'")) return queryResult([]);
      throw new Error(`未预期查询：${text}`);
    }) };
    useTransaction(client);
    await expect(markOrderPaid(order.id, 'PAY-OTHER')).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_PROVIDER_ID_CONFLICT',
    });
    expect(mocks.creditPaidOrderWithClient).not.toHaveBeenCalled();
  });

  it('支付 worker 的旧 lease 不能到账、改订单或发积分', async () => {
    const order = orderRow({ current_payment_attempt_id: PAYMENT_ATTEMPT_ID });
    const client: MockClient = { query: vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.startsWith('SELECT * FROM orders')) return queryResult([order]);
      if (text.includes('SELECT id FROM payment_attempts')) return queryResult([]);
      throw new Error(`旧 lease 不应继续查询：${text}`);
    }) };
    useTransaction(client);

    await expect(markOrderPaid(
      order.id,
      'PAY-100',
      PAYMENT_ATTEMPT_ID,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    )).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_STALE_CLAIM', statusCode: 409 });
    expect(mocks.creditPaidOrderWithClient).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'paid'"))).toBe(false);
  });

  it('支付 worker 的旧 lease 不能写 failed 或 closed 终态', async () => {
    const order = orderRow({ current_payment_attempt_id: PAYMENT_ATTEMPT_ID });
    const client: MockClient = { query: vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.startsWith('SELECT * FROM orders')) return queryResult([order]);
      if (text.includes('SELECT id FROM payment_attempts')) return queryResult([]);
      throw new Error(`旧 lease 不应继续查询：${text}`);
    }) };
    useTransaction(client);

    await expect(markOrderPaymentTerminalFromClaim(order.id, {
      id: PAYMENT_ATTEMPT_ID,
      orderId: order.id,
      leaseToken: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    }, 'failed', '支付未完成')).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_STALE_CLAIM' });
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE orders'))).toBe(false);
  });

  it('旧支付 attempt 的延迟失败回调只终结自身，不得打断当前 retry', async () => {
    const retryAttemptId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const order = orderRow({ current_payment_attempt_id: retryAttemptId, provider_order_id: 'PAY-NEW' });
    const client: MockClient = { query: vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.startsWith('SELECT * FROM orders')) return queryResult([order]);
      if (text.includes('UPDATE payment_attempts')) return queryResult([{ id: PAYMENT_ATTEMPT_ID }]);
      throw new Error(`延迟失败回调不应修改当前订单：${text}`);
    }) };
    useTransaction(client);

    await expect(markOrderPaymentFailedFromProviderEvent(
      order.id,
      PAYMENT_ATTEMPT_ID,
      '支付未完成',
      'PAY-OLD',
    )).resolves.toMatchObject({ status: 'pending' });
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE orders'))).toBe(false);
  });

  it('旧支付 attempt 的严格已支付结果仍可到账并关闭当前 retry', async () => {
    const retryAttemptId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const order = orderRow({ current_payment_attempt_id: retryAttemptId, provider_order_id: 'PAY-NEW' });
    const client: MockClient = { query: vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.startsWith('SELECT * FROM orders')) return queryResult([order]);
      if (text.includes('SELECT id, provider_order_id, status')) {
        return queryResult([{ id: PAYMENT_ATTEMPT_ID, provider_order_id: 'PAY-OLD', status: 'ready' }]);
      }
      if (text.includes('SELECT plan_id')) return queryResult([userCreditRow()]);
      if (text.includes('UPDATE users')) return queryResult([]);
      if (text.includes("SET status = 'paid'")) {
        if (text.includes('UPDATE orders')) {
          return queryResult([{ ...order, status: 'paid', current_payment_attempt_id: PAYMENT_ATTEMPT_ID }]);
        }
        return queryResult([{ id: PAYMENT_ATTEMPT_ID }]);
      }
      if (text.includes("SET status = 'closed'")) return queryResult([]);
      if (text.includes('INSERT INTO payment_notification_outbox')) return queryResult([]);
      throw new Error(`未预期查询：${text}`);
    }) };
    useTransaction(client);

    await expect(markOrderPaid(order.id, 'PAY-OLD', PAYMENT_ATTEMPT_ID)).resolves.toMatchObject({
      status: 'paid', paymentTransitioned: true,
    });
    expect(mocks.creditPaidOrderWithClient).toHaveBeenCalledOnce();
  });

  it('发起退款冻结订单专属 lot，并创建绑定原通道 revision 的 attempt', async () => {
    const order = orderRow({
      status: 'paid',
      provider_order_id: 'PAY-100',
      current_payment_attempt_id: PAYMENT_ATTEMPT_ID,
    });
    const client: MockClient = { query: vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.startsWith('SELECT * FROM orders')) return queryResult([order]);
      if (text.includes('SELECT main_credits')) return queryResult([{
        main_credits: 500, addon_credits: 0, active_subscription_order_id: order.id,
      }]);
      if (text.includes('SELECT attempt.channel_revision_id')) {
        return queryResult([{ channel_revision_id: CHANNEL_REVISION_ID }]);
      }
      if (text.includes('COALESCE(max(attempt)')) return queryResult([{ next_attempt: 1 }]);
      if (text.includes('INSERT INTO order_refund_attempts')) return queryResult([{ id: REFUND_ATTEMPT_ID }]);
      if (text.includes('UPDATE orders')) {
        return queryResult([{ ...order, refund_status: 'pending', current_refund_attempt_id: REFUND_ATTEMPT_ID }]);
      }
      if (text.includes('INSERT INTO audit_logs')) return queryResult([]);
      if (text.includes('SELECT o.*')) return queryResult([{ ...order, refund_status: 'pending' }]);
      throw new Error(`未预期查询：${text}`);
    }) };

    await queueOrderRefundWithClient(client as never, order.id, 'admin-1', '127.0.0.1');
    expect(mocks.holdOrderCreditsForRefundWithClient).toHaveBeenCalledOnce();
    const attemptInsert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO order_refund_attempts'))!;
    expect(attemptInsert[1]).toEqual(expect.arrayContaining([order.id, CHANNEL_REVISION_ID, 'PAY-100']));
  });

  it('退款创建和查单异常只转 uncertain，不释放积分', async () => {
    const claim = claimedRefundRow({ previous_status: 'queued' });
    mocks.withTransaction
      .mockImplementationOnce(async (callback: (client: MockClient) => unknown) => callback({
        query: vi.fn().mockResolvedValue(queryResult([claim])),
      }))
      .mockImplementationOnce(async (callback: (client: MockClient) => unknown) => callback({
        query: vi.fn()
          .mockResolvedValueOnce(queryResult([{ id: claim.refund_attempt_id }]))
          .mockResolvedValueOnce(queryResult([])),
      }));
    mocks.createRefundOrder.mockRejectedValue(new Error('network'));
    mocks.queryRefundOrder.mockRejectedValue(new Error('not found'));

    await expect(processPendingOrderRefunds(1)).resolves.toEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(mocks.releaseOrderRefundHoldWithClient).not.toHaveBeenCalled();
    expect(mocks.queryRefundOrder).toHaveBeenCalledWith(
      expect.objectContaining({ revisionId: CHANNEL_REVISION_ID }),
      claim.merchant_refund_no,
    );
  });

  it('退款主动同步遇到 processing 租约时不查单也不清租约', async () => {
    const stored = orderRow({
      status: 'paid',
      refund_status: 'pending',
      merchant_refund_no: 'ref_123456789012345678901234',
      current_refund_attempt_id: REFUND_ATTEMPT_ID,
    });
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([stored]))
      .mockResolvedValueOnce(queryResult([{
        id: REFUND_ATTEMPT_ID,
        order_id: stored.id,
        merchant_order_no: stored.merchant_order_no,
        merchant_refund_no: stored.merchant_refund_no,
        channel_revision_id: CHANNEL_REVISION_ID,
        provider_refund_id: null,
        provider_order_id: 'PAY-100',
        amount: stored.amount,
        currency: 'CNY',
        status: 'processing',
        lease_token: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        lease_until: '2099-07-10T07:00:00.000Z',
      }]));

    await expect(syncOrderRefund(stored.id)).resolves.toMatchObject({ refundStatus: 'pending' });
    expect(mocks.queryRefundOrder).not.toHaveBeenCalled();
    expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
  });

  it('退款创建响应即使声称成功也只进入 submitted，等待完整字段查单', async () => {
    const claim = claimedRefundRow({ previous_status: 'queued' });
    mocks.withTransaction
      .mockImplementationOnce(async (callback: (client: MockClient) => unknown) => callback({
        query: vi.fn().mockResolvedValue(queryResult([claim])),
      }))
      .mockImplementationOnce(async (callback: (client: MockClient) => unknown) => callback({
        query: vi.fn()
          .mockResolvedValueOnce(queryResult([{ current_refund_attempt_id: claim.refund_attempt_id }]))
          .mockResolvedValueOnce({ rows: [], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
      }));
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([{
        id: REFUND_ATTEMPT_ID,
        order_id: claim.id,
        merchant_order_no: claim.merchant_order_no,
        merchant_refund_no: claim.merchant_refund_no,
        channel_revision_id: CHANNEL_REVISION_ID,
        provider_refund_id: null,
        provider_order_id: 'PAY-100',
        amount: claim.amount,
        currency: 'CNY',
        status: 'processing',
      }]))
      .mockResolvedValueOnce(queryResult([orderRow({
        refund_status: 'pending',
        merchant_refund_no: claim.merchant_refund_no,
        current_refund_attempt_id: REFUND_ATTEMPT_ID,
      })]));
    mocks.createRefundOrder.mockResolvedValue({
      refundOrderId: 'REFUND-100',
      mchRefundNo: claim.merchant_refund_no,
      state: 2,
    });

    await expect(processPendingOrderRefunds(1)).resolves.toEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(mocks.queryRefundOrder).not.toHaveBeenCalled();
    expect(mocks.releaseOrderRefundHoldWithClient).not.toHaveBeenCalled();
    expect(mocks.reverseOrderRefundHoldWithClient).not.toHaveBeenCalled();
  });

  it('恢复 attempt 只有先查到明确不存在，才用同一商户退款号补建', async () => {
    const claim = claimedRefundRow({ previous_status: 'uncertain' });
    mocks.withTransaction
      .mockImplementationOnce(async (callback: (client: MockClient) => unknown) => callback({
        query: vi.fn().mockResolvedValue(queryResult([claim])),
      }))
      .mockImplementationOnce(async (callback: (client: MockClient) => unknown) => callback({
        query: vi.fn()
          .mockResolvedValueOnce(queryResult([{ current_refund_attempt_id: claim.refund_attempt_id }]))
          .mockResolvedValueOnce({ rows: [], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
      }));
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([{
        id: REFUND_ATTEMPT_ID,
        order_id: claim.id,
        merchant_order_no: claim.merchant_order_no,
        merchant_refund_no: claim.merchant_refund_no,
        channel_revision_id: CHANNEL_REVISION_ID,
        provider_refund_id: null,
        provider_order_id: 'PAY-100',
        amount: claim.amount,
        currency: 'CNY',
        status: 'processing',
      }]))
      .mockResolvedValueOnce(queryResult([orderRow({
        refund_status: 'pending',
        merchant_refund_no: claim.merchant_refund_no,
        current_refund_attempt_id: REFUND_ATTEMPT_ID,
      })]));
    mocks.queryRefundOrder.mockRejectedValue(Object.assign(new Error('not found'), {
      definitive: true,
      providerMessage: '退款订单不存在',
    }));
    mocks.createRefundOrder.mockResolvedValue({
      refundOrderId: 'REFUND-100',
      mchRefundNo: claim.merchant_refund_no,
      state: 1,
    });

    await expect(processPendingOrderRefunds(1)).resolves.toEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(mocks.queryRefundOrder).toHaveBeenCalledOnce();
    expect(mocks.createRefundOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ merchantRefundNo: claim.merchant_refund_no }),
    );
    expect(mocks.queryRefundOrder.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.createRefundOrder.mock.invocationCallOrder[0]!);
    expect(mocks.releaseOrderRefundHoldWithClient).not.toHaveBeenCalled();
  });

  it('严格匹配的终态退款失败才释放冻结 lot', async () => {
    const order = mapOrder(orderRow({
      status: 'paid',
      refund_status: 'pending',
      merchant_refund_no: 'ref_123456789012345678901234',
      current_refund_attempt_id: REFUND_ATTEMPT_ID,
    }));
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([{
        id: REFUND_ATTEMPT_ID,
        order_id: order.id,
        merchant_order_no: order.merchantOrderNo,
        merchant_refund_no: order.merchantRefundNo,
        channel_revision_id: CHANNEL_REVISION_ID,
        provider_refund_id: null,
        provider_order_id: order.paymentOrderNo,
        amount: order.amount,
        currency: 'CNY',
        status: 'submitted',
      }]));
    const stored = orderRow({
      status: 'paid', refund_status: 'pending', merchant_refund_no: order.merchantRefundNo,
      current_refund_attempt_id: REFUND_ATTEMPT_ID,
    });
    const client: MockClient = { query: vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.startsWith('SELECT * FROM orders')) return queryResult([stored]);
      if (text.includes('SELECT id FROM order_refund_attempts')) return queryResult([{ id: REFUND_ATTEMPT_ID }]);
      if (text.includes('UPDATE credit_ledger')) return queryResult([]);
      if (text.includes('UPDATE orders')) return queryResult([{ ...stored, refund_status: 'failed' }]);
      if (text.includes('UPDATE order_refund_attempts')) return queryResult([]);
      throw new Error(`未预期查询：${text}`);
    }) };
    useTransaction(client);

    await applyRefundResult(order.id, {
      refundOrderId: 'REFUND-100',
      mchRefundNo: order.merchantRefundNo!,
      state: 3,
    });
    expect(mocks.releaseOrderRefundHoldWithClient).toHaveBeenCalledOnce();
  });

  it('退款 mismatch 的旧 lease 不能改写新 owner 的 attempt', async () => {
    const claim = claimedRefundRow();
    mocks.poolQuery.mockResolvedValueOnce(queryResult([]));
    await expect(markRefundAttemptManualReview(
      claim.refund_attempt_id,
      '字段冲突',
      { claim },
    )).rejects.toMatchObject({ code: 'REFUND_ATTEMPT_STALE_CLAIM', statusCode: 409 });
  });

  it('旧退款 callback 晚到时只隔离原 attempt，不改当前 attempt、订单或 lot', async () => {
    const currentAttemptId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const stored = orderRow({
      status: 'paid',
      refund_status: 'pending',
      merchant_refund_no: 'ref_CURRENT123456789012345678',
      current_refund_attempt_id: currentAttemptId,
    });
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([{
        id: REFUND_ATTEMPT_ID,
        order_id: stored.id,
        merchant_order_no: stored.merchant_order_no,
        merchant_refund_no: 'ref_123456789012345678901234',
        channel_revision_id: CHANNEL_REVISION_ID,
        provider_refund_id: 'REFUND-OLD',
        provider_order_id: 'PAY-100',
        amount: stored.amount,
        currency: 'CNY',
        status: 'submitted',
        lease_token: null,
        lease_until: null,
        is_current: false,
      }]))
      .mockResolvedValueOnce(queryResult([{ id: REFUND_ATTEMPT_ID }]))
      .mockResolvedValueOnce(queryResult([stored]));

    await expect(applyRefundResult(stored.id, {
      refundOrderId: 'REFUND-OLD',
      mchRefundNo: 'ref_123456789012345678901234',
      state: 2,
    }, undefined, REFUND_ATTEMPT_ID)).resolves.toMatchObject({ refundStatus: 'pending' });
    expect(mocks.reverseOrderRefundHoldWithClient).not.toHaveBeenCalled();
    expect(mocks.releaseOrderRefundHoldWithClient).not.toHaveBeenCalled();
    expect(mocks.withTransaction).not.toHaveBeenCalled();
    const manualReviewSql = String(mocks.poolQuery.mock.calls[1]?.[0]);
    expect(manualReviewSql).toContain('UPDATE order_refund_attempts attempt');
    expect(mocks.poolQuery.mock.calls[1]?.[1]?.[0]).toBe(REFUND_ATTEMPT_ID);
  });
});

const SNAPSHOT_AT = '2026-07-17T11:00:00.000000Z';

const NOW = '2026-07-10T06:00:00.000Z';
const PAYMENT_ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REFUND_ATTEMPT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHANNEL_REVISION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function useTransaction(client: MockClient) {
  mocks.withTransaction.mockImplementation(async (callback: (value: MockClient) => unknown) => callback(client));
}

function queryResult<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}

function userCreditRow() {
  return {
    plan_id: null,
    billing_cycle: 'monthly',
    main_credits: 100,
    addon_credits: 20,
    total_credits: 120,
    plan_cycle_started_at: '2026-07-01',
    plan_reset_at: null,
    plan_expires_at: null,
    active_subscription_order_id: null,
    email: 'user@example.com',
    user_name: '用户',
  };
}

type TestOrderRow = Parameters<typeof mapOrder>[0] & {
  __pagination_total_count: string | number | bigint | null;
  __pagination_cursor_timestamp: string;
};

function orderRow(
  overrides: Partial<TestOrderRow> = {},
): TestOrderRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: '22222222-2222-4222-8222-222222222222',
    plan_id: '33333333-3333-4333-8333-333333333333',
    kind: 'main',
    plan_name: '专业版',
    amount: 22800,
    billing: 'monthly',
    status: 'pending',
    invoice_status: 'unissued',
    credit_status: 'none',
    credit_amount: 500,
    credit_bucket: 'main',
    payment_method: '支付宝',
    payment_provider: 'jeepay',
    payment_way_code: 'ALI_WAP',
    payment_surface: 'pc',
    merchant_order_no: 'ord_123456789012345678901234',
    provider_order_id: null,
    provider_trade_id: null,
    payment_error: null,
    payment_expires_at: '2026-07-10T08:00:00.000Z',
    refund_status: 'none',
    merchant_refund_no: null,
    provider_refund_id: null,
    refund_error: null,
    refund_credit_ledger_id: null,
    refund_dispatch_status: 'idle',
    refund_dispatch_attempts: 0,
    refund_dispatch_next_at: null,
    refund_dispatch_lease_until: null,
    previous_plan_id: null,
    previous_billing_cycle: null,
    previous_plan_cycle_started_at: null,
    previous_plan_reset_at: null,
    previous_plan_expires_at: null,
    previous_subscription_order_id: null,
    current_payment_attempt_id: null,
    current_refund_attempt_id: null,
    created_at: NOW,
    paid_at: null,
    failed_at: null,
    refunded_at: null,
    __pagination_total_count: null,
    __pagination_cursor_timestamp: String(overrides.created_at ?? NOW),
    ...overrides,
  };
}

function claimedRefundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    refund_attempt_id: REFUND_ATTEMPT_ID,
    lease_token: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    channel_revision_id: CHANNEL_REVISION_ID,
    merchant_order_no: 'ord_123456789012345678901234',
    merchant_refund_no: 'ref_123456789012345678901234',
    amount: 22800,
    refund_client_ip: '127.0.0.1',
    refund_dispatch_attempts: 1,
    previous_status: 'queued' as const,
    ...overrides,
  };
}
