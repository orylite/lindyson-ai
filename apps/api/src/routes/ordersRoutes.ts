import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { endpointContracts, idempotencyKeySchema } from '@lindyson/api-contracts';
import type { z } from 'zod';
import { requireAuth } from '../auth/session.js';
import { resolveTrustedRequestAppOrigin } from '../config/requestOrigin.js';
import { pool, withReadOnlyRepeatableRead } from '../db/pool.js';
import { estimateMainPlanDates } from '../domain/billingClock.js';
import {
  materializeExactCursorPageQuery,
  parseExactCursorPageRequest,
  readUserPaginationVersion,
} from '../domain/cursorPagination.js';
import {
  applyRefundResult,
  createOrder,
  getOrderById,
  getOrderByIdempotencyKey,
  getOrderByMerchantOrderNo,
  getOrderByMerchantRefundNo,
  getRefundAttemptByMerchantRefundNo,
  listUserOrdersPage,
  markOrderPaid,
  markOrderPaymentFailedFromProviderEvent,
  markOrderPaymentTerminalFromClaim,
  markRefundAttemptManualReview,
  recordPaymentUncertain,
  setPaymentOrderCreated,
} from '../domain/ordersService.js';
import {
  createPaymentOrder,
  normalizePaymentNotifyPayload,
  normalizePaymentLaunch,
  verifyPaymentSign,
} from '../payments/jeepayService.js';
import { getPaymentChannelCredentials } from '../payments/paymentChannelService.js';
import { getPaymentChannelCredentialsByRevision } from '../payments/paymentChannelService.js';
import {
  claimPaymentAttempt,
  createPaymentRetryAttempt,
  ensurePaymentAttempt,
  getCurrentPaymentAttempt,
  getPaymentAttemptByMerchantOrderNo,
  getPaymentAttemptByIdempotencyKey,
  hashPaymentRequest,
  isPaymentAttemptStaleClaim,
  markPaymentAttemptManualReviewFromClaim,
  markPaymentAttemptManualReviewFromProviderEvent,
  markPaymentAttemptReady,
  markPaymentAttemptUncertain,
} from '../payments/paymentAttemptService.js';
import {
  closeAndReconcilePaymentOrder,
  syncPaymentOrder,
} from '../payments/paymentLifecycleService.js';

export async function registerOrdersRoutes(app: FastifyInstance) {
  app.get('/api/orders', async request => {
    const user = await requireAuth(request);
    const rawQuery = endpointContracts.orders.query.parse(request.query);
    const pageRequest = parseExactCursorPageRequest({
        ...rawQuery,
        resource: 'user-orders',
        filters: {
          userId: user.id,
          status: rawQuery.status ?? null,
          invoiceable: rawQuery.invoiceable === '1',
        },
        defaultLimit: 20,
        maxLimit: 50,
      });
    return withReadOnlyRepeatableRead(async client => {
      const invoiceable = rawQuery.invoiceable === '1';
      const versionScope = invoiceable
        ? 'orders:invoiceable'
        : rawQuery.status
          ? `orders:status:${rawQuery.status}`
          : 'orders:all';
      const version = await readUserPaginationVersion(client, user.id, versionScope);
      const totalItems = pageRequest.snapshot
        ? undefined
        : (await client.query<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM orders o
             WHERE o.user_id = $1
               AND ($2::text IS NULL OR o.status = $2)
               AND ($3::boolean IS NOT TRUE OR (
                 o.status = 'paid'
                 AND o.invoice_status = 'unissued'
                 AND NOT EXISTS (SELECT 1 FROM invoice_requests ir WHERE ir.order_id = o.id)
               ))`,
            [user.id, rawQuery.status ?? null, invoiceable],
          )).rows[0]?.count;
      const query = {
        ...materializeExactCursorPageQuery(pageRequest, {
          resourceVersion: version.version,
          snapshotAt: version.snapshotAt,
          totalItems,
        }),
        status: rawQuery.status,
        invoiceable,
      };
      return listUserOrdersPage(client, user.id, query);
    });
  });

  app.post('/api/payments/create', async (request, reply) => {
    reply
      .header('Cache-Control', 'no-store, max-age=0')
      .header('Pragma', 'no-cache');
    const user = await requireAuth(request);
    const payload = endpointContracts.paymentCreate.body.parse(request.body);
    const returnOrigin = resolveTrustedRequestAppOrigin(request);
    const suppliedIdempotencyKey = payload.idempotencyKey
      ?? firstHeader(request.headers['idempotency-key']);
    if (!suppliedIdempotencyKey) {
      throw Object.assign(new Error('创建支付订单必须提供幂等键'), {
        statusCode: 400,
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      });
    }
    const idempotencyKey = idempotencyKeySchema.parse(suppliedIdempotencyKey);
    const existingOrder = await getOrderByIdempotencyKey(pool, user.id, idempotencyKey);
    if (existingOrder) {
      assertMatchingPaymentRequest(existingOrder, payload);
      const replayedAttempt = await getPaymentAttemptByIdempotencyKey(
        existingOrder.id,
        user.id,
        idempotencyKey,
      );
      if (replayedAttempt) {
        return {
          order: existingOrder,
          paymentAttempt: replayedAttempt,
          payment: replayedAttempt.launch,
          reused: true,
        };
      }
      // 兼容 044 之前已存在但尚未回填 attempt 的订单；仅此路径读取当前通道。
      const config = await getPaymentChannelCredentials({ requireEnabled: true });
      await ensurePaymentAttempt(
        existingOrder,
        idempotencyKey,
        hashPaymentRequest({
          planId: payload.planId,
          billing: payload.billing,
          surface: payload.surface,
          amount: existingOrder.amount,
        }),
        config,
        returnOrigin,
      );
      const paymentAttempt = await getCurrentPaymentAttempt(existingOrder.id, user.id);
      if (!paymentAttempt) throw providerError('支付 attempt 数据不完整', false);
      return {
        order: existingOrder,
        paymentAttempt,
        payment: paymentAttempt.launch,
        reused: true,
      };
    }
    const config = await getPaymentChannelCredentials({ requireEnabled: true });
    const wayCode = payload.surface === 'mobile' ? config.mobileWayCode : config.desktopWayCode;
    const order = await createOrder(
      user.id,
      payload.planId,
      payload.billing,
      'jeepay',
      wayCode,
      payload.surface,
      idempotencyKey,
    );
    const requestHash = hashPaymentRequest({
      planId: payload.planId,
      billing: payload.billing,
      surface: payload.surface,
      amount: order.amount,
    });
    await ensurePaymentAttempt(order, idempotencyKey, requestHash, config, returnOrigin);
    const claimed = await claimPaymentAttempt(order.id);
    if (!claimed) {
      const paymentAttempt = await getCurrentPaymentAttempt(order.id, user.id);
      if (!paymentAttempt) throw providerError('支付 attempt 数据不完整', false);
      return { order, paymentAttempt, payment: paymentAttempt.launch, reused: true };
    }
    const estimatedPlanDates = order.kind === 'main' && order.billing !== 'one-time'
      ? estimateMainPlanDates(order.billing, new Date(required(order.createdAt)))
      : {};
    const launchFailureMessage = payload.surface === 'pc' ? '支付二维码创建失败' : '支付页面创建失败';

    try {
      const payment = await createPaymentOrder(config, {
        merchantOrderNo: claimed.merchantOrderNo,
        wayCode,
        amount: order.amount,
        subject: order.planName,
        body: `${order.planName} ${billingLabel(order.billing)}`,
        clientIp: request.ip,
        localOrderId: order.id,
        surface: payload.surface,
        returnOrigin: claimed.returnOrigin,
      });
      request.log.info({
        merchantOrderNo: order.merchantOrderNo,
        providerOrderId: payment.payOrderId,
        wayCode,
        orderState: payment.orderState,
        payDataType: payment.payDataType,
        hasPayData: Boolean(payment.payData),
        errCode: payment.errCode,
        errMsg: safeLogText(payment.errMsg),
      }, '支付统一下单响应');
      if (payment.mchOrderNo !== claimed.merchantOrderNo || !payment.payOrderId) {
        await markPaymentAttemptManualReviewFromClaim(
          claimed,
          '支付创建响应的商户单号或供应商单号不匹配',
        );
        throw Object.assign(providerError('支付服务响应与订单不匹配', false), { attemptFinalized: true });
      }
      if (payment.orderState === 2) {
        const synced = await syncPaymentOrder(order.id, user.id, claimed);
        const paymentAttempt = await getCurrentPaymentAttempt(order.id, user.id);
        if (!paymentAttempt) throw providerError('支付 attempt 数据不完整', false);
        return { order: { ...synced, ...estimatedPlanDates }, paymentAttempt, payment: null, reused: false };
      }
      try {
        const launch = normalizePaymentLaunch(payment, config, payload.surface);
        const paymentAttempt = await markPaymentAttemptReady(claimed, payment.payOrderId, {
          surface: payload.surface,
          ...launch,
        });
        const updatedOrder = {
          ...await setPaymentOrderCreated(order.id, payment.payOrderId),
          ...estimatedPlanDates,
        };
        return {
          order: updatedOrder,
          paymentAttempt,
          payment: paymentAttempt.launch,
          reused: false,
        };
      } catch (launchError) {
        if (isPaymentAttemptStaleClaim(launchError)) throw launchError;
        request.log.warn({
          merchantOrderNo: order.merchantOrderNo,
          providerOrderId: payment.payOrderId,
          payDataType: payment.payDataType,
          hasPayData: Boolean(payment.payData),
          reason: safeLogText(launchError instanceof Error ? launchError.message : undefined),
        }, '支付启动数据不可用，尝试关闭平台订单');
        try {
          const reconciled = await closeAndReconcilePaymentOrder(
            order.id,
            launchFailureMessage,
            undefined,
            claimed,
          );
          if (reconciled?.status === 'paid') {
            const paymentAttempt = await getCurrentPaymentAttempt(order.id, user.id);
            if (!paymentAttempt) throw providerError('支付 attempt 数据不完整', false);
            return { order: reconciled, paymentAttempt, payment: null, reused: false };
          }
          throw providerError(launchFailureMessage, reconciled?.status === 'failed');
        } catch (closeError) {
          if (isDefinitiveProviderError(closeError)) throw closeError;
          throw providerError(launchFailureMessage, false);
        }
      }
    } catch (error) {
      request.log.warn({
        merchantOrderNo: order.merchantOrderNo,
        providerCode: providerDetail(error, 'providerCode'),
        providerMessage: safeLogText(providerDetail(error, 'providerMessage')),
        reason: safeLogText(error instanceof Error ? error.message : undefined),
        definitive: isDefinitiveProviderError(error),
      }, '支付订单创建未完成');
      if (isDefinitiveProviderError(error)) {
        await finishPaymentClaimSafely(
          () => markOrderPaymentTerminalFromClaim(
            order.id,
            claimed,
            'failed',
            safeProviderMessage(error),
          ),
          error,
        );
      } else if (!isAttemptFinalized(error)) {
        await finishPaymentClaimSafely(() => markPaymentAttemptUncertain(claimed, '支付状态暂时无法确认'), error);
        await recordPaymentUncertain(order.id, '支付状态暂时无法确认');
      }
      throw error;
    }
  });

  app.post('/api/payments/orders/:id/sync', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.paymentSync.params.parse(request.params);
    return { order: await syncPaymentOrder(id, user.id) };
  });

  app.post('/api/payments/orders/:id/retry', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.paymentRetry.params.parse(request.params);
    const { idempotencyKey } = endpointContracts.paymentRetry.body.parse(request.body);
    const config = await getPaymentChannelCredentials({ requireEnabled: true });
    const paymentAttempt = await createPaymentRetryAttempt(
      id,
      user.id,
      idempotencyKey,
      config,
      resolveTrustedRequestAppOrigin(request),
    );
    const order = await getOrderById(pool, id, user.id);
    if (!order) throw Object.assign(new Error('订单不存在'), { statusCode: 404 });
    return { order, paymentAttempt };
  });

  app.post('/api/payments/orders/:id/cancel', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.paymentCancel.params.parse(request.params);
    return { order: await closeAndReconcilePaymentOrder(id, '用户取消支付', user.id) };
  });

  app.post('/api/payments/notify', async (request, reply) => {
    const payload = normalizePaymentNotifyPayload(request.body);
    let order: Awaited<ReturnType<typeof getOrderByMerchantOrderNo>>;
    let attempt: Awaited<ReturnType<typeof getPaymentAttemptByMerchantOrderNo>> = null;
    let providerEventId: string;
    try {
      attempt = await getPaymentAttemptByMerchantOrderNo(pool, required(payload.mchOrderNo));
      if (!attempt) throw new Error('attempt not found');
      if (attempt.status === 'manual-review') {
        throw providerMismatchError('支付 attempt 已进入人工核对，禁止自动结算');
      }
      const config = await getPaymentChannelCredentialsByRevision(attempt.channel_revision_id);
      if (!verifyPaymentSign(payload, config.apiKey)) throw new Error('invalid sign');
      if (payload.mchNo !== config.mchNo || payload.appId !== config.appId) throw new Error('invalid merchant');
      order = await getOrderByMerchantOrderNo(pool, required(payload.mchOrderNo));
      if (!order || order.paymentProvider !== 'jeepay') throw new Error('order not found');
      if (
        toCents(payload.amount) !== attempt.amount
        || payload.currency?.toUpperCase() !== 'CNY'
        || (attempt.provider_order_id && payload.payOrderId !== attempt.provider_order_id)
      ) throw providerMismatchError('支付通知字段与 attempt 不匹配');
      providerEventId = await recordProviderEvent({
        eventType: 'payment-notify',
        eventKey: `payment:${required(payload.payOrderId)}:${required(payload.state)}`,
        payload,
        orderId: order.id,
        paymentAttemptId: attempt.id,
      });
    } catch (error) {
      if (attempt && isProviderManualReviewError(error)) {
        await markPaymentAttemptManualReviewFromProviderEvent(pool, attempt.id, error.message);
      }
      request.log.warn({
        merchantOrderNo: payload.mchOrderNo,
        stage: 'validation',
        errorCode: safeErrorCode(error),
      }, '支付通知校验失败');
      return reply.type('text/plain').send('fail');
    }

    if (!attempt) return reply.type('text/plain').send('fail');
    try {
      if (payload.state === '2') {
        await markOrderPaid(order.id, required(payload.payOrderId), attempt.id);
      } else if (['3', '4', '6'].includes(payload.state)) {
        await markOrderPaymentFailedFromProviderEvent(
          order.id,
          attempt.id,
          '支付未完成',
          payload.payOrderId,
        );
      }
      await markProviderEventProcessed(providerEventId);
      return reply.type('text/plain').send('success');
    } catch (error) {
      request.log.error({
        merchantOrderNo: payload.mchOrderNo,
        stage: 'processing',
        errorCode: safeErrorCode(error),
        errorMessage: safeLogText(error instanceof Error ? error.message : undefined),
      }, '支付通知处理失败');
      return reply.type('text/plain').send('fail');
    }
  });

  app.post('/api/payments/refunds/notify', async (request, reply) => {
    const payload = normalizePaymentNotifyPayload(request.body);
    let order: Awaited<ReturnType<typeof getOrderByMerchantRefundNo>>;
    let attempt: Awaited<ReturnType<typeof getRefundAttemptByMerchantRefundNo>> = null;
    let providerEventId: string;
    try {
      attempt = await getRefundAttemptByMerchantRefundNo(pool, required(payload.mchRefundNo));
      if (!attempt) throw new Error('refund attempt not found');
      if (attempt.status === 'manual-review') {
        throw providerMismatchError('退款 attempt 已进入人工核对，禁止自动结算');
      }
      const config = await getPaymentChannelCredentialsByRevision(attempt.channel_revision_id);
      if (!verifyPaymentSign(payload, config.apiKey)) throw new Error('invalid sign');
      if (payload.mchNo !== config.mchNo || payload.appId !== config.appId) throw new Error('invalid merchant');
      order = await getOrderByMerchantRefundNo(pool, required(payload.mchRefundNo));
      if (!order || order.paymentProvider !== 'jeepay') throw new Error('order not found');
      if (
        payload.mchOrderNo !== attempt.merchant_order_no
        || toCents(payload.payAmount) !== order.amount
        || toCents(payload.refundAmount) !== attempt.amount
        || payload.currency?.toUpperCase() !== 'CNY'
        || (attempt.provider_order_id && payload.payOrderId !== attempt.provider_order_id)
        || (attempt.provider_refund_id && payload.refundOrderId !== attempt.provider_refund_id)
      ) throw providerMismatchError('退款通知字段与 attempt 不匹配');
      providerEventId = await recordProviderEvent({
        eventType: 'refund-notify',
        eventKey: `refund:${required(payload.refundOrderId)}:${required(payload.state)}`,
        payload,
        orderId: order.id,
        refundAttemptId: attempt.id,
      });
    } catch (error) {
      if (attempt && isProviderManualReviewError(error)) {
        await markRefundAttemptManualReview(attempt.id, error.message, { providerEvent: true });
      }
      request.log.warn({
        merchantRefundNo: payload.mchRefundNo,
        stage: 'validation',
        errorCode: safeErrorCode(error),
      }, '退款通知校验失败');
      return reply.type('text/plain').send('fail');
    }

    if (!attempt) return reply.type('text/plain').send('fail');
    try {
      await applyRefundResult(order.id, {
        refundOrderId: payload.refundOrderId ?? '',
        mchRefundNo: payload.mchRefundNo,
        state: Number(payload.state),
      }, undefined, attempt.id);
      await markProviderEventProcessed(providerEventId);
      return reply.type('text/plain').send('success');
    } catch (error) {
      request.log.error({
        merchantRefundNo: payload.mchRefundNo,
        stage: 'processing',
        errorCode: safeErrorCode(error),
        errorMessage: safeLogText(error instanceof Error ? error.message : undefined),
      }, '退款通知处理失败');
      return reply.type('text/plain').send('fail');
    }
  });

}

function toCents(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value);
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function recordProviderEvent(input: {
  eventType: 'payment-notify' | 'refund-notify';
  eventKey: string;
  payload: Record<string, string>;
  orderId: string;
  paymentAttemptId?: string;
  refundAttemptId?: string;
}) {
  const payloadJson = JSON.stringify(Object.fromEntries(
    Object.entries(input.payload).sort(([left], [right]) => left.localeCompare(right)),
  ));
  const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
  const result = await pool.query<{ id: string; payload_hash: string }>(
    `INSERT INTO provider_events (
       provider, event_type, event_key, payload_hash, payload,
       order_id, payment_attempt_id, refund_attempt_id
     )
     VALUES ('jeepay', $1, $2, $3, $4::jsonb, $5, $6, $7)
     ON CONFLICT (provider, event_type, event_key) DO UPDATE
     SET event_key = EXCLUDED.event_key
     RETURNING id, payload_hash`,
    [
      input.eventType,
      input.eventKey,
      payloadHash,
      payloadJson,
      input.orderId,
      input.paymentAttemptId ?? null,
      input.refundAttemptId ?? null,
    ],
  );
  if (result.rows[0]?.payload_hash !== payloadHash) {
    throw Object.assign(new Error('供应商事件键对应的载荷发生冲突'), {
      statusCode: 409,
      code: 'PROVIDER_EVENT_CONFLICT',
    });
  }
  return result.rows[0]!.id;
}

async function markProviderEventProcessed(eventId: string) {
  await pool.query(
    `UPDATE provider_events
     SET status = 'processed', processed_at = COALESCE(processed_at, now()), error = NULL
     WHERE id = $1`,
    [eventId],
  );
}

function assertMatchingPaymentRequest(
  order: {
    planId?: string | null;
    billing?: string;
    paymentProvider?: string;
    paymentSurface?: string | null;
  },
  payload: z.infer<typeof endpointContracts.paymentCreate.body>,
) {
  if (
    order.planId !== payload.planId
    || order.billing !== payload.billing
    || order.paymentProvider !== 'jeepay'
    || order.paymentSurface !== payload.surface
  ) {
    throw Object.assign(new Error('该幂等键已用于不同的支付请求'), {
      statusCode: 409,
      code: 'IDEMPOTENCY_CONFLICT',
      exposeMessage: true,
    });
  }
}

function required(value: string | null | undefined) {
  if (!value) throw new Error('missing field');
  return value;
}

function billingLabel(value: 'monthly' | 'yearly' | 'one-time') {
  return value === 'yearly' ? '年付' : value === 'monthly' ? '月付' : '一次性购买';
}

function providerError(message: string, definitive: boolean) {
  return Object.assign(new Error(message), { statusCode: 502, exposeMessage: true, definitive });
}

function isDefinitiveProviderError(error: unknown) {
  return error instanceof Error && (error as { definitive?: boolean }).definitive === true;
}

function isAttemptFinalized(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { attemptFinalized?: unknown }).attemptFinalized === true);
}

async function finishPaymentClaimSafely(run: () => Promise<unknown>, originalError: unknown) {
  try {
    await run();
  } catch (error) {
    if (safeErrorCode(error) !== 'PAYMENT_ATTEMPT_STALE_CLAIM') throw error;
    // 关单/回调可能已经用同一 attempt 进入终态；保留原始供应商错误，不让陈旧 claim 覆盖它。
    void originalError;
  }
}

function safeProviderMessage(error: unknown) {
  return error instanceof Error ? error.message : '支付页面创建失败';
}

function providerDetail(error: unknown, key: 'providerCode' | 'providerMessage') {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function safeLogText(value: string | undefined) {
  return value?.trim().slice(0, 256) || undefined;
}

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const value = (error as { code?: unknown }).code;
  if (typeof value === 'string' || typeof value === 'number') return String(value).slice(0, 64);
  return error instanceof Error ? error.name.slice(0, 64) : 'UNKNOWN';
}

function providerMismatchError(message: string) {
  return Object.assign(new Error(message), { code: 'PROVIDER_RESULT_MISMATCH' });
}

function isProviderManualReviewError(error: unknown): error is Error {
  return error instanceof Error
    && ['PROVIDER_RESULT_MISMATCH', 'PROVIDER_EVENT_CONFLICT']
      .includes(String((error as { code?: unknown }).code));
}
