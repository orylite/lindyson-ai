import { pool } from '../db/pool.js';
import {
  getOrderById,
  markOrderPaid,
  markOrderPaymentTerminalFromClaim,
  recordPaymentUncertain,
} from '../domain/ordersService.js';
import { getPaymentChannelCredentialsByRevision, type PaymentChannelCredentials } from './paymentChannelService.js';
import { closePaymentOrder, queryPaymentOrder, type PaymentQueryData } from './jeepayService.js';
import {
  claimCurrentPaymentAttemptForReconciliation,
  getCurrentPaymentAttemptRecord,
  markPaymentAttemptManualReviewFromClaim,
  markPaymentAttemptUncertain,
  releasePaymentAttemptAfterPendingQuery,
  type PaymentAttemptClaim,
  type PaymentAttemptRow,
} from './paymentAttemptService.js';

type PaymentOrder = NonNullable<Awaited<ReturnType<typeof getOrderById>>>;

export async function syncPaymentOrder(
  orderId: string,
  userId?: string,
  suppliedClaim?: PaymentAttemptClaim,
) {
  const order = await getOrderById(pool, orderId, userId);
  if (!order) throw publicError('订单不存在', 404);
  if (order.status !== 'pending') return order;
  assertOnlinePaymentOrder(order);

  const authority = await acquirePaymentReconciliation(order.id, userId, suppliedClaim);
  if (!authority) return order;
  const { attempt, claim } = authority;
  const config = await getPaymentChannelCredentialsByRevision(attempt.channel_revision_id);
  let result: PaymentQueryData;
  try {
    result = await queryPaymentOrder(config, attempt.merchant_order_no);
  } catch (error) {
    await markPaymentAttemptUncertain(claim, '支付状态暂时无法确认');
    throw error;
  }
  const terminal = await applyClaimedPaymentQueryResult(
    order,
    attempt,
    claim,
    config,
    result,
    '支付未完成',
  );
  if (terminal) return terminal;
  await releasePaymentAttemptAfterPendingQuery(claim);
  return getRequiredOrder(order.id, userId);
}

export async function closeAndReconcilePaymentOrder(
  orderId: string,
  failureMessage: string,
  userId?: string,
  suppliedClaim?: PaymentAttemptClaim,
) {
  const order = await getOrderById(pool, orderId, userId);
  if (!order) {
    if (userId) throw publicError('订单不存在', 404);
    return undefined;
  }
  if (order.status !== 'pending') return order;
  assertOnlinePaymentOrder(order);
  const authority = await acquirePaymentReconciliation(order.id, userId, suppliedClaim);
  if (!authority) return order;
  const { attempt, claim } = authority;
  const config = await getPaymentChannelCredentialsByRevision(attempt.channel_revision_id);
  let closeConfirmed = false;

  try {
    await closePaymentOrder(config, attempt.merchant_order_no, attempt.provider_order_id);
    closeConfirmed = true;
  } catch {
    // 无论关单接口是否返回成功，都再查询一次，避免支付与关单并发时误判。
  }

  try {
    const result = await queryPaymentOrder(config, attempt.merchant_order_no);
    const reconciled = await applyClaimedPaymentQueryResult(
      order,
      attempt,
      claim,
      config,
      result,
      failureMessage,
    );
    if (reconciled) return reconciled;
  } catch (error) {
    if (isProviderResultMismatch(error)) throw error;
    // 关单未得到确定结果且查询失败时，保持待支付并交给下轮重试。
  }

  if (closeConfirmed) {
    await markOrderPaymentTerminalFromClaim(order.id, claim, 'closed', failureMessage, attempt.provider_order_id);
    return getRequiredOrder(order.id, userId);
  }

  await markPaymentAttemptUncertain(claim, '支付订单关单状态暂时无法确认');
  return recordPaymentUncertain(order.id, '支付订单关单状态暂时无法确认');
}

export async function sweepExpiredPaymentOrders(limit = 100) {
  const candidates = await pool.query<{ id: string }>(
    `SELECT id
     FROM orders
     WHERE payment_provider = 'jeepay'
       AND status = 'pending'
       AND payment_expires_at IS NOT NULL
       AND payment_expires_at <= now()
     ORDER BY payment_expires_at ASC
     LIMIT $1`,
    [limit],
  );
  const summary = { scanned: candidates.rows.length, paid: 0, failed: 0, pending: 0, skipped: 0 };

  for (const candidate of candidates.rows) {
    const client = await pool.connect();
    let locked = false;
    try {
      const lockResult = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [candidate.id],
      );
      locked = lockResult.rows[0]?.locked === true;
      if (!locked) {
        summary.skipped += 1;
        continue;
      }

      const order = await getOrderById(pool, candidate.id);
      if (!order || order.status !== 'pending') {
        summary.skipped += 1;
        continue;
      }

      let reconciled: PaymentOrder;
      try {
        reconciled = await syncPaymentOrder(order.id);
      } catch {
        await recordPaymentUncertain(order.id, '支付超时状态暂时无法确认');
        summary.pending += 1;
        continue;
      }

      if (reconciled.status === 'pending') {
        const closed = await closeAndReconcilePaymentOrder(order.id, '支付超时');
        if (closed) reconciled = closed;
      }

      if (reconciled?.status === 'paid') summary.paid += 1;
      else if (reconciled?.status === 'failed') summary.failed += 1;
      else summary.pending += 1;
    } finally {
      if (locked) {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [candidate.id]);
      }
      client.release();
    }
  }

  return summary;
}

async function applyClaimedPaymentQueryResult(
  order: PaymentOrder,
  attempt: PaymentAttemptRow,
  claim: PaymentAttemptClaim,
  config: PaymentChannelCredentials,
  result: PaymentQueryData,
  failureMessage: string,
) {
  try {
    validatePaymentQueryResult(order, attempt, config, result);
  } catch (error) {
    if (isProviderResultMismatch(error)) {
      await markPaymentAttemptManualReviewFromClaim(claim, error.message);
    }
    throw error;
  }
  if (result.state === 2) {
    await markOrderPaid(order.id, result.payOrderId, attempt.id, claim.leaseToken);
    return getRequiredOrder(order.id, order.userId);
  }
  if ([3, 4, 6].includes(result.state)) {
    await markOrderPaymentTerminalFromClaim(
      order.id,
      claim,
      'failed',
      failureMessage,
      result.payOrderId,
    );
    return getRequiredOrder(order.id, order.userId);
  }
  return null;
}

function validatePaymentQueryResult(
  order: PaymentOrder,
  attempt: PaymentAttemptRow,
  config: PaymentChannelCredentials,
  result: PaymentQueryData,
) {
  if (
    result.mchOrderNo !== attempt.merchant_order_no
    || result.mchNo !== config.mchNo
    || result.appId !== config.appId
    || Number(result.amount) !== order.amount
    || result.currency.toUpperCase() !== 'CNY'
    || (attempt.provider_order_id && result.payOrderId !== attempt.provider_order_id)
  ) {
    throw Object.assign(publicError('支付状态校验失败', 502), {
      code: 'PROVIDER_RESULT_MISMATCH',
    });
  }
}

async function acquirePaymentReconciliation(
  orderId: string,
  userId?: string,
  suppliedClaim?: PaymentAttemptClaim,
) {
  if (suppliedClaim) {
    const attempt = await getCurrentPaymentAttemptRecord(orderId, userId);
    if (
      !attempt
      || suppliedClaim.orderId !== orderId
      || attempt.id !== suppliedClaim.id
      || attempt.status !== 'processing'
      || attempt.lease_token !== suppliedClaim.leaseToken
    ) {
      throw stalePaymentClaimError();
    }
    return { attempt, claim: suppliedClaim };
  }
  const current = await getCurrentPaymentAttemptRecord(orderId, userId);
  if (!current) throw publicError('支付 attempt 不存在', 409);
  if (current.status === 'manual-review') {
    throw Object.assign(publicError('支付 attempt 正在人工核对，不能自动处理', 409), {
      code: 'PAYMENT_ATTEMPT_MANUAL_REVIEW',
    });
  }
  return claimCurrentPaymentAttemptForReconciliation(orderId);
}

async function getRequiredOrder(orderId: string, userId?: string) {
  const order = await getOrderById(pool, orderId, userId);
  if (!order) throw publicError('订单不存在', 404);
  return order;
}

function isProviderResultMismatch(error: unknown): error is Error {
  return error instanceof Error
    && (error as { code?: unknown }).code === 'PROVIDER_RESULT_MISMATCH';
}

function assertOnlinePaymentOrder(order: PaymentOrder) {
  if (order.paymentProvider !== 'jeepay' || !order.merchantOrderNo) {
    throw publicError('该订单不支持在线同步', 400);
  }
}

function publicError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode, exposeMessage: true });
}

function stalePaymentClaimError() {
  return Object.assign(publicError('支付 attempt 租约已失效', 409), {
    code: 'PAYMENT_ATTEMPT_STALE_CLAIM',
  });
}
