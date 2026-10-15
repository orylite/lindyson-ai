import { lockReferralUsersWithClient, rewardReferralForOrderWithClient, revokeReferralForOrderWithClient } from './referrals.js';
import { customAlphabet } from 'nanoid';
import { createHash, randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { pool, withTransaction, type DbClient } from '../db/pool.js';
import {
  createRefundOrder,
  isDefinitiveMissingRefundOrder,
  queryRefundOrder,
  type RefundOrderData,
  type RefundQueryData,
} from '../payments/jeepayService.js';
import {
  getPaymentChannelCredentialsByRevision,
  type PaymentSurface,
  type PaymentWayCode,
} from '../payments/paymentChannelService.js';
import { getBillingDate } from './billingClock.js';
import {
  creditPaidOrderWithClient,
  holdOrderCreditsForRefundWithClient,
  releaseOrderRefundHoldWithClient,
  reverseOrderRefundHoldWithClient,
} from './financialCredits.js';
import { creditLedgerNotes } from './creditLedgerNotes.js';
import { toIsoDateTime, toInt } from './serialization.js';
import { reconcileSubscription } from './subscriptionLifecycle.js';
import {
  fourWayCursorCondition,
  fourWayCursorValues,
  fourWayPageOrderBy,
  exactPageMetadataColumns,
  createExactCursorPage,
  type ExactCursorPageQuery,
  type ExactPageMetadata,
} from './cursorPagination.js';
import { enqueuePortraitEntitlementReconcileWithClient } from './realPortraitReconciliation.js';

interface OrderRow {
  id: string;
  user_id: string;
  user_name?: string;
  email?: string;
  plan_id: string | null;
  kind: 'main' | 'addon';
  plan_name: string;
  amount: number;
  billing: 'monthly' | 'yearly' | 'one-time';
  status: 'paid' | 'pending' | 'refunded' | 'failed';
  invoice_status: 'unissued' | 'issued';
  invoice_request_status?: 'unissued' | 'issued' | null;
  idempotency_key?: string | null;
  current_payment_attempt_id?: string | null;
  payment_attempt_status?: 'queued' | 'processing' | 'ready' | 'uncertain' | 'paid' | 'closed' | 'failed' | 'manual-review' | null;
  payment_attempt_error?: string | null;
  payment_attempt_next_at?: Date | string | null;
  credit_status: string;
  credit_amount: number;
  credit_bucket: 'main' | 'addon' | 'mixed' | 'system';
  payment_method: string;
  payment_provider: string;
  payment_way_code: string | null;
  payment_surface: PaymentSurface | null;
  merchant_order_no: string | null;
  provider_order_id: string | null;
  provider_trade_id: string | null;
  payment_error: string | null;
  payment_expires_at: Date | string | null;
  refund_status: 'none' | 'pending' | 'succeeded' | 'failed';
  merchant_refund_no: string | null;
  provider_refund_id: string | null;
  refund_error: string | null;
  refund_credit_ledger_id: string | null;
  refund_dispatch_status?: 'idle' | 'queued' | 'processing' | 'uncertain' | 'submitted' | 'completed' | 'failed';
  refund_dispatch_attempts?: number;
  refund_dispatch_next_at?: Date | string | null;
  refund_dispatch_lease_until?: Date | string | null;
  refund_client_ip?: string | null;
  current_refund_attempt_id?: string | null;
  refund_attempt_status?: 'queued' | 'processing' | 'submitted' | 'uncertain' | 'succeeded' | 'failed' | 'manual-review' | null;
  refund_attempt_next_at?: Date | string | null;
  refund_manual_review_reason?: string | null;
  previous_plan_id: string | null;
  previous_billing_cycle: 'monthly' | 'yearly' | null;
  previous_plan_cycle_started_at: Date | string | null;
  previous_plan_reset_at: Date | string | null;
  previous_plan_expires_at: Date | string | null;
  previous_subscription_order_id: string | null;
  created_at: Date | string;
  paid_at: Date | string | null;
  failed_at: Date | string | null;
  refunded_at: Date | string | null;
}

interface ClaimedRefundDispatch {
  id: string;
  refund_attempt_id: string;
  lease_token: string;
  channel_revision_id: string;
  merchant_order_no: string;
  merchant_refund_no: string;
  amount: number;
  refund_client_ip: string | null;
  refund_dispatch_attempts: number;
  previous_status: 'queued' | 'processing' | 'submitted' | 'uncertain';
}

export type OrderStatus = 'paid' | 'pending' | 'refunded' | 'failed';

interface PaymentAttemptLeaseClaim {
  id: string;
  orderId: string;
  leaseToken: string;
}

export interface OrderHistoryQuery extends ExactCursorPageQuery {
  status?: OrderStatus;
  invoiceable?: boolean;
}

const shortId = customAlphabet('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 24);

export function createMerchantOrderNo(prefix: 'ord' | 'ref' = 'ord') {
  return `${prefix}_${shortId()}`;
}

export function mapOrder(row: OrderRow) {
  const labels = paymentLabels(row.payment_provider, row.payment_way_code, row.payment_method, row.payment_surface);
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name ?? '',
    email: row.email ?? '',
    planId: row.plan_id,
    kind: row.kind,
    planName: row.plan_name,
    amount: toInt(row.amount),
    billing: row.billing,
    status: row.status,
    invoiceStatus: row.invoice_status,
    invoiceRequestStatus: row.invoice_request_status ?? null,
    creditStatus: row.credit_status,
    creditAmount: toInt(row.credit_amount),
    creditBucket: row.credit_bucket,
    paymentMethod: labels.method,
    paymentMethodLabel: labels.method,
    paymentWayLabel: labels.way,
    paymentProvider: row.payment_provider,
    paymentWayCode: row.payment_way_code,
    paymentSurface: row.payment_surface,
    merchantOrderNo: row.merchant_order_no,
    paymentOrderNo: row.provider_order_id ?? row.provider_trade_id,
    paymentError: row.payment_error,
    paymentAttemptStatus: row.payment_attempt_status ?? legacyPaymentAttemptStatus(row),
    paymentAttemptId: row.current_payment_attempt_id ?? null,
    paymentAttemptError: row.payment_attempt_error ?? row.payment_error,
    paymentRetryAfterMs: retryAfterMs(row.payment_attempt_next_at),
    paymentExpiresAt: toIsoDateTime(row.payment_expires_at),
    refundStatus: row.refund_status,
    merchantRefundNo: row.merchant_refund_no,
    refundOrderNo: row.provider_refund_id,
    refundError: row.refund_error,
    refundAttemptStatus: row.refund_attempt_status ?? legacyRefundAttemptStatus(row),
    refundAttemptId: row.current_refund_attempt_id ?? null,
    refundManualReviewReason: row.refund_manual_review_reason ?? null,
    refundRetryAfterMs: retryAfterMs(row.refund_attempt_next_at ?? row.refund_dispatch_next_at),
    createdAt: toIsoDateTime(row.created_at),
    paidAt: toIsoDateTime(row.paid_at),
    failedAt: toIsoDateTime(row.failed_at),
    refundedAt: toIsoDateTime(row.refunded_at),
  };
}

interface AdminOrdersPageFilters {
  search?: string;
  status?: string;
  userId?: string;
  from?: string;
  to?: string;
}

export async function countAdminOrders(client: DbClient, query: AdminOrdersPageFilters) {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE ($1::text IS NULL OR o.status = $1)
       AND ($2::uuid IS NULL OR o.user_id = $2)
       AND ($3::date IS NULL OR o.created_at >= $3::date)
       AND ($4::date IS NULL OR o.created_at < $4::date + interval '1 day')
       AND ($5::text IS NULL OR (
         o.id::text ILIKE '%' || $5 || '%'
         OR o.plan_name ILIKE '%' || $5 || '%'
         OR o.merchant_order_no ILIKE '%' || $5 || '%'
         OR o.provider_order_id ILIKE '%' || $5 || '%'
         OR o.provider_trade_id ILIKE '%' || $5 || '%'
         OR u.user_name ILIKE '%' || $5 || '%'
         OR u.email::text ILIKE '%' || $5 || '%'
       ))`,
    [query.status ?? null, query.userId ?? null, query.from ?? null, query.to ?? null, query.search || null],
  );
  return result.rows[0]?.count ?? '0';
}

export async function listAdminOrdersPage(client: DbClient, query: ExactCursorPageQuery & AdminOrdersPageFilters) {
  const result = await client.query<OrderRow & ExactPageMetadata>(
    `WITH paged_orders AS MATERIALIZED (
       SELECT o.*,
              ${exactPageMetadataColumns('o.created_at')}
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE ${fourWayCursorCondition(query, 'o.created_at', 'o.id')}
         AND ($3::text IS NULL OR o.status = $3)
         AND ($4::uuid IS NULL OR o.user_id = $4)
         AND ($5::date IS NULL OR o.created_at >= $5::date)
         AND ($6::date IS NULL OR o.created_at < $6::date + interval '1 day')
         AND ($7::text IS NULL OR (
           o.id::text ILIKE '%' || $7 || '%'
           OR o.plan_name ILIKE '%' || $7 || '%'
           OR o.merchant_order_no ILIKE '%' || $7 || '%'
           OR o.provider_order_id ILIKE '%' || $7 || '%'
           OR o.provider_trade_id ILIKE '%' || $7 || '%'
           OR u.user_name ILIKE '%' || $7 || '%'
           OR u.email::text ILIKE '%' || $7 || '%'
         ))
       ORDER BY ${fourWayPageOrderBy(query, 'o.created_at', 'o.id')}
       LIMIT $8
     )
     SELECT o.*, u.user_name, u.email,
            pa.status AS payment_attempt_status, pa.error AS payment_attempt_error, pa.next_at AS payment_attempt_next_at,
            ra.status AS refund_attempt_status, ra.next_at AS refund_attempt_next_at,
            ra.manual_review_reason AS refund_manual_review_reason,
            (SELECT ir.status FROM invoice_requests ir WHERE ir.order_id = o.id LIMIT 1) AS invoice_request_status
     FROM paged_orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN payment_attempts pa ON pa.id = o.current_payment_attempt_id
     LEFT JOIN order_refund_attempts ra ON ra.id = o.current_refund_attempt_id
     ORDER BY ${fourWayPageOrderBy(query, 'o.created_at', 'o.id')}`,
    [
      ...fourWayCursorValues(query),
      query.status ?? null,
      query.userId ?? null,
      query.from ?? null,
      query.to ?? null,
      query.search || null,
      query.limit + 1,
    ],
  );

  return createExactCursorPage({
    rows: result.rows,
    query,
    getId: row => row.id,
    map: mapOrder,
  });
}

export async function listUserOrdersPage(
  client: DbClient,
  userId: string,
  query: OrderHistoryQuery,
) {
  const result = await client.query<OrderRow & ExactPageMetadata>(
    `WITH paged_orders AS MATERIALIZED (
       SELECT o.*,
              ${exactPageMetadataColumns('o.created_at')}
       FROM orders o
       WHERE o.user_id = $1
         AND ${fourWayCursorCondition(query, 'o.created_at', 'o.id', 2, 3)}
         AND ($4::text IS NULL OR o.status = $4)
         AND ($5::boolean IS NOT TRUE OR (
           o.status = 'paid'
           AND o.invoice_status = 'unissued'
           AND NOT EXISTS (SELECT 1 FROM invoice_requests ir WHERE ir.order_id = o.id)
         ))
       ORDER BY ${fourWayPageOrderBy(query, 'o.created_at', 'o.id')}
       LIMIT $6
     )
     SELECT o.*, u.user_name, u.email,
            pa.status AS payment_attempt_status, pa.error AS payment_attempt_error, pa.next_at AS payment_attempt_next_at,
            ra.status AS refund_attempt_status, ra.next_at AS refund_attempt_next_at,
            ra.manual_review_reason AS refund_manual_review_reason,
            (SELECT ir.status FROM invoice_requests ir WHERE ir.order_id = o.id LIMIT 1) AS invoice_request_status
     FROM paged_orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN payment_attempts pa ON pa.id = o.current_payment_attempt_id
     LEFT JOIN order_refund_attempts ra ON ra.id = o.current_refund_attempt_id
     ORDER BY ${fourWayPageOrderBy(query, 'o.created_at', 'o.id')}`,
    [
      userId,
      ...fourWayCursorValues(query),
      query.status ?? null,
      query.invoiceable ?? false,
      query.limit + 1,
    ],
  );
  return createExactCursorPage({
    rows: result.rows,
    query,
    getId: row => row.id,
    map: mapOrder,
  });
}

export async function createOrder(
  userId: string,
  planId: string,
  billing: 'monthly' | 'yearly' | 'one-time',
  paymentProvider = 'manual',
  paymentWayCode?: PaymentWayCode,
  paymentSurface?: PaymentSurface,
  idempotencyKey?: string,
) {
  await reconcileSubscription(userId);
  return withTransaction(async client => {
    if (idempotencyKey) {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`payment-order:${userId}:${idempotencyKey}`],
      );
      const existing = await client.query<OrderRow>(
        `SELECT * FROM orders WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1 FOR UPDATE`,
        [userId, idempotencyKey],
      );
      if (existing.rows[0]) {
        assertIdempotentOrderMatches(existing.rows[0], {
          planId,
          billing,
          paymentProvider,
          paymentWayCode: paymentWayCode ?? null,
          paymentSurface: paymentSurface ?? null,
        });
        return mapOrder(existing.rows[0]);
      }
    }

    const planResult = await client.query<{
      id: string;
      name: string;
      kind: 'main' | 'addon';
      billing: 'monthly' | 'yearly' | 'both' | 'one-time';
      monthly_price: number;
      yearly_price: number;
      credits: number;
    }>(
      `SELECT * FROM plans WHERE id = $1 AND status = 'active' LIMIT 1`,
      [planId],
    );
    const plan = planResult.rows[0];
    if (!plan) throw publicError('套餐不存在或未启用', 404);
    assertBillingAllowed(plan, billing);

    const amount = billing === 'yearly' ? toInt(plan.yearly_price) : toInt(plan.monthly_price);
    if (amount <= 0) throw publicError('免费套餐不能创建支付订单', 400);
    const merchantOrderNo = paymentProvider === 'jeepay' ? createMerchantOrderNo('ord') : null;
    const paymentMethod = paymentProvider === 'jeepay' ? '支付宝' : '在线支付';

    const orderResult = await client.query<OrderRow>(
      `INSERT INTO orders (
         user_id, plan_id, kind, plan_name, amount, billing, status,
         credit_status, credit_amount, credit_bucket, payment_method,
         payment_provider, payment_way_code, payment_surface, merchant_order_no, idempotency_key, payment_expires_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, 'pending', 'none', $7, $8, $9, $10, $11, $12, $13,
         $14, CASE WHEN $10 = 'jeepay' THEN now() + ($15 * interval '1 second') ELSE NULL END
       )
       RETURNING *`,
      [
        userId,
        plan.id,
        plan.kind,
        plan.name,
        amount,
        billing,
        toInt(plan.credits),
        plan.kind === 'main' ? 'main' : 'addon',
        paymentMethod,
        paymentProvider,
        paymentWayCode ?? null,
        paymentSurface ?? null,
        merchantOrderNo,
        idempotencyKey ?? null,
        env.PAYMENT_ORDER_EXPIRES_SECONDS,
      ],
    );
    return mapOrder(orderResult.rows[0]!);
  });
}

export async function getOrderById(client: DbClient, orderId: string, userId?: string) {
  const result = await client.query<OrderRow>(
    `SELECT o.*, u.user_name, u.email,
            pa.status AS payment_attempt_status, pa.error AS payment_attempt_error, pa.next_at AS payment_attempt_next_at,
            ra.status AS refund_attempt_status, ra.next_at AS refund_attempt_next_at,
            ra.manual_review_reason AS refund_manual_review_reason,
            (SELECT ir.status FROM invoice_requests ir WHERE ir.order_id = o.id LIMIT 1) AS invoice_request_status
     FROM orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN payment_attempts pa ON pa.id = o.current_payment_attempt_id
     LEFT JOIN order_refund_attempts ra ON ra.id = o.current_refund_attempt_id
     WHERE o.id = $1 AND ($2::uuid IS NULL OR o.user_id = $2)
     LIMIT 1`,
    [orderId, userId ?? null],
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

export async function getOrderByMerchantOrderNo(client: DbClient, merchantOrderNo: string) {
  const result = await client.query<OrderRow>(
    `SELECT o.*, u.user_name, u.email,
            pa.status AS payment_attempt_status, pa.error AS payment_attempt_error, pa.next_at AS payment_attempt_next_at,
            ra.status AS refund_attempt_status, ra.next_at AS refund_attempt_next_at,
            ra.manual_review_reason AS refund_manual_review_reason
     FROM orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN payment_attempts pa ON pa.id = o.current_payment_attempt_id
     LEFT JOIN order_refund_attempts ra ON ra.id = o.current_refund_attempt_id
     LEFT JOIN payment_attempts lookup_attempt ON lookup_attempt.order_id = o.id
     WHERE lookup_attempt.merchant_order_no = $1 OR (lookup_attempt.id IS NULL AND o.merchant_order_no = $1)
     LIMIT 1`,
    [merchantOrderNo],
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

export async function getOrderByIdempotencyKey(client: DbClient, userId: string, idempotencyKey: string) {
  const result = await client.query<OrderRow>(
    `SELECT o.*, u.user_name, u.email,
            pa.status AS payment_attempt_status, pa.error AS payment_attempt_error, pa.next_at AS payment_attempt_next_at,
            ra.status AS refund_attempt_status, ra.next_at AS refund_attempt_next_at,
            ra.manual_review_reason AS refund_manual_review_reason,
            (SELECT ir.status FROM invoice_requests ir WHERE ir.order_id = o.id LIMIT 1) AS invoice_request_status
     FROM orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN payment_attempts pa ON pa.id = o.current_payment_attempt_id
     LEFT JOIN order_refund_attempts ra ON ra.id = o.current_refund_attempt_id
     WHERE o.user_id = $1 AND o.idempotency_key = $2
     LIMIT 1`,
    [userId, idempotencyKey],
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

export async function getOrderByMerchantRefundNo(client: DbClient, merchantRefundNo: string) {
  const result = await client.query<OrderRow>(
    `SELECT o.*, u.user_name, u.email,
            pa.status AS payment_attempt_status, pa.error AS payment_attempt_error, pa.next_at AS payment_attempt_next_at,
            ra.status AS refund_attempt_status, ra.next_at AS refund_attempt_next_at,
            ra.manual_review_reason AS refund_manual_review_reason
     FROM orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN payment_attempts pa ON pa.id = o.current_payment_attempt_id
     LEFT JOIN order_refund_attempts ra ON ra.id = o.current_refund_attempt_id
     LEFT JOIN order_refund_attempts lookup_attempt ON lookup_attempt.order_id = o.id
     WHERE lookup_attempt.merchant_refund_no = $1 OR (lookup_attempt.id IS NULL AND o.merchant_refund_no = $1)
     LIMIT 1`,
    [merchantRefundNo],
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

export async function getRefundAttemptByMerchantRefundNo(
  client: DbClient,
  merchantRefundNo: string,
): Promise<CurrentRefundAttemptRow | null> {
  const result = await client.query<CurrentRefundAttemptRow>(
    `SELECT * FROM order_refund_attempts WHERE merchant_refund_no = $1 LIMIT 1`,
    [merchantRefundNo],
  );
  return result.rows[0] ?? null;
}

export async function setPaymentOrderCreated(orderId: string, paymentOrderNo: string) {
  return updateAndReadOrder(
    `UPDATE orders SET provider_order_id = $2, payment_error = NULL WHERE id = $1`,
    [orderId, paymentOrderNo],
  );
}

export async function recordPaymentUncertain(orderId: string, message: string) {
  return updateAndReadOrder(
    `UPDATE orders SET payment_error = $2 WHERE id = $1 AND status = 'pending'`,
    [orderId, message],
  );
}

export async function markOrderPaid(
  orderId: string,
  paymentOrderNo: string,
  paymentAttemptId?: string,
  leaseToken?: string,
) {
  const outcome = await withTransaction(async client => {
    const orderResult = await client.query<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw publicError('订单不存在', 404);
    await assertPaymentClaimWithClient(client, order, paymentAttemptId, leaseToken);
    const winningAttemptId = paymentAttemptId ?? order.current_payment_attempt_id;
    if (!winningAttemptId) throw publicError('支付 attempt 不存在', 409);
    const winningAttemptResult = await client.query<{
      id: string;
      provider_order_id: string | null;
      status: string;
    }>(
      `SELECT id, provider_order_id, status
       FROM payment_attempts
       WHERE id = $1 AND order_id = $2
       LIMIT 1 FOR UPDATE`,
      [winningAttemptId, order.id],
    );
    const winningAttempt = winningAttemptResult.rows[0];
    if (!winningAttempt) throw publicError('支付 attempt 不存在', 409);
    const knownProviderOrderId = winningAttempt.provider_order_id
      ?? (order.current_payment_attempt_id === winningAttemptId ? order.provider_order_id : null);
    if (knownProviderOrderId && knownProviderOrderId !== paymentOrderNo) {
      const conflicted = await client.query(
        `UPDATE payment_attempts
         SET status = 'manual-review',
             manual_review_reason = '同一订单收到不同的供应商支付单号',
             terminal_at = COALESCE(terminal_at, now()),
             next_at = NULL,
             lease_token = NULL,
             lease_until = NULL,
             launch_ciphertext = NULL,
             launch_iv = NULL,
             launch_tag = NULL,
             updated_at = now()
         WHERE id = $1
           AND ($2::uuid IS NULL OR (status = 'processing' AND lease_token = $2::uuid))`,
        [winningAttemptId, leaseToken ?? null],
      );
      if (leaseToken && !conflicted.rowCount) throw stalePaymentClaimError();
      return { conflict: true as const };
    }
    if (order.status === 'paid' || order.status === 'refunded') {
      return { conflict: false as const, value: { ...mapOrder(order), paymentTransitioned: false } };
    }
    // 经过签名、商户号、金额和币种校验的供应商“已支付”结果优先于本地超时/
    // 关单失败标记。允许 failed -> paid，避免支付与超时扫描竞态造成已收款未到账。
    if (order.status !== 'pending' && order.status !== 'failed') {
      throw publicError('当前订单不能确认支付', 400);
    }

    await lockReferralUsersWithClient(client, order.user_id);
    const userResult = await client.query<{
      plan_id: string | null;
      billing_cycle: 'monthly' | 'yearly';
      main_credits: number;
      addon_credits: number;
      total_credits: number;
      plan_cycle_started_at: Date | string;
      plan_reset_at: Date | string | null;
      plan_expires_at: Date | string | null;
      active_subscription_order_id: string | null;
      email: string;
      user_name: string;
    }>(
      `SELECT plan_id, billing_cycle, main_credits, addon_credits, total_credits,
              plan_cycle_started_at, plan_reset_at, plan_expires_at,
              active_subscription_order_id, email, user_name
       FROM users WHERE id = $1 FOR UPDATE`,
      [order.user_id],
    );
    const user = userResult.rows[0];
    if (!user) throw publicError('用户不存在', 404);

    const billingDate = getBillingDate();

    if (order.kind === 'main') {
      await client.query(
        `UPDATE users
         SET plan_id = $2,
             billing_cycle = $3,
             plan_cycle_started_at = $4::date,
             plan_reset_at = $4::date + 30,
             plan_expires_at = CASE
               WHEN $3 = 'yearly' THEN ($4::date + interval '1 year')::date
               ELSE $4::date + 30
             END,
             active_subscription_order_id = $5,
             updated_at = now()
         WHERE id = $1`,
        [order.user_id, order.plan_id, order.billing, billingDate, order.id],
      );
      await enqueuePortraitEntitlementReconcileWithClient(client, {
        userId: order.user_id,
        eventKey: `portrait-payment:${order.id}`,
        reason: 'main-plan-purchased',
        oldPlanId: user.plan_id,
        newPlanId: order.plan_id,
      });
    }

    await creditPaidOrderWithClient(client, {
      id: order.id,
      userId: order.user_id,
      kind: order.kind,
      planName: order.plan_name,
      creditAmount: toInt(order.credit_amount),
      creditBucket: order.credit_bucket,
      lotExpiresAt: order.kind === 'main' ? addDaysToBillingDate(billingDate, 30) : null,
    }, user);

    const updated = await client.query<OrderRow>(
      `UPDATE orders
       SET status = 'paid',
           credit_status = 'settled',
           provider_order_id = $2,
           provider_trade_id = $2,
           payment_error = NULL,
           failed_at = NULL,
           previous_plan_id = CASE WHEN kind = 'main' THEN $3 ELSE previous_plan_id END,
           previous_billing_cycle = CASE WHEN kind = 'main' THEN $4 ELSE previous_billing_cycle END,
           previous_plan_cycle_started_at = CASE WHEN kind = 'main' THEN $5 ELSE previous_plan_cycle_started_at END,
           previous_plan_reset_at = CASE WHEN kind = 'main' THEN $6 ELSE previous_plan_reset_at END,
           previous_plan_expires_at = CASE WHEN kind = 'main' THEN $7 ELSE previous_plan_expires_at END,
           previous_subscription_order_id = CASE WHEN kind = 'main' THEN $8 ELSE previous_subscription_order_id END,
           paid_at = now(),
           current_payment_attempt_id = COALESCE($9::uuid, current_payment_attempt_id)
       WHERE id = $1
       RETURNING *`,
      [
        order.id,
        paymentOrderNo,
        user.plan_id,
        user.billing_cycle,
        user.plan_cycle_started_at,
        user.plan_reset_at,
        user.plan_expires_at,
        user.active_subscription_order_id,
        paymentAttemptId ?? null,
      ],
    );
    if (winningAttemptId) {
      const paidAttempt = await client.query(
        `UPDATE payment_attempts
         SET status = 'paid',
             provider_order_id = $2,
             provider_trade_id = $2,
             paid_at = COALESCE(paid_at, now()),
             terminal_at = COALESCE(terminal_at, now()),
             next_at = NULL,
             lease_token = NULL,
             lease_until = NULL,
             launch_ciphertext = NULL,
             launch_iv = NULL,
             launch_tag = NULL,
             error = NULL,
             updated_at = now()
         WHERE id = $1 AND status <> 'manual-review'
           AND ($3::uuid IS NULL OR (status = 'processing' AND lease_token = $3::uuid))
         RETURNING id`,
        [winningAttemptId, paymentOrderNo, leaseToken ?? null],
      );
      if (!paidAttempt.rowCount) {
        if (leaseToken) throw stalePaymentClaimError();
        throw publicError('支付 attempt 正在人工核对，不能自动到账', 409);
      }
      await client.query(
        `UPDATE payment_attempts
         SET status = 'closed', error = '同一订单的其他支付 attempt 已完成',
             terminal_at = COALESCE(terminal_at, now()), next_at = NULL,
             lease_token = NULL, lease_until = NULL, updated_at = now()
         WHERE order_id = $1 AND id <> $2
           AND status IN ('queued', 'processing', 'ready', 'uncertain')`,
        [order.id, winningAttemptId],
      );
    }
    await rewardReferralForOrderWithClient(client, order);
    await client.query(
      `INSERT INTO payment_notification_outbox (event_key, order_id, payload)
       VALUES ($1, $2::uuid, jsonb_build_object(
         'userId', $3::text,
         'email', $4::text,
         'orderId', $2::uuid,
         'planName', $5::text,
         'amount', $6::integer,
         'credits', $7::integer
       ))
       ON CONFLICT (event_key) DO NOTHING`,
      [
        `payment-succeeded:${order.id}`,
        order.id,
        order.user_id,
        user.email,
        order.plan_name,
        toInt(order.amount),
        toInt(order.credit_amount),
      ],
    );
    return {
      conflict: false as const,
      value: { ...mapOrder(updated.rows[0]!), paymentTransitioned: true },
    };
  });
  if (outcome.conflict) {
    throw Object.assign(publicError('支付单号冲突，请人工核对', 409), {
      code: 'PAYMENT_PROVIDER_ID_CONFLICT',
    });
  }
  return outcome.value;
}

export async function markOrderPaymentTerminalFromClaim(
  orderId: string,
  claim: PaymentAttemptLeaseClaim,
  attemptStatus: 'closed' | 'failed',
  message: string,
  providerOrderId?: string | null,
) {
  return withTransaction(async client => {
    const orderResult = await client.query<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw publicError('订单不存在', 404);
    await assertPaymentClaimWithClient(client, order, claim.id, claim.leaseToken);
    if (order.status !== 'pending') throw stalePaymentClaimError();

    const attempt = await client.query(
      `UPDATE payment_attempts
       SET status = $3,
           provider_order_id = COALESCE($4, provider_order_id),
           error = $5,
           manual_review_reason = NULL,
           next_at = NULL,
           lease_token = NULL,
           lease_until = NULL,
           terminal_at = COALESCE(terminal_at, now()),
           launch_ciphertext = NULL,
           launch_iv = NULL,
           launch_tag = NULL,
           updated_at = now()
       WHERE id = $1 AND status = 'processing' AND lease_token = $2::uuid
       RETURNING id`,
      [claim.id, claim.leaseToken, attemptStatus, providerOrderId ?? null, message],
    );
    if (!attempt.rowCount) throw stalePaymentClaimError();

    const updated = await client.query<OrderRow>(
      `UPDATE orders
       SET status = 'failed',
           failed_at = now(),
           payment_error = $3,
           provider_order_id = COALESCE($4, provider_order_id)
       WHERE id = $1
         AND status = 'pending'
         AND current_payment_attempt_id = $2
       RETURNING *`,
      [order.id, claim.id, message, providerOrderId ?? null],
    );
    if (!updated.rows[0]) throw stalePaymentClaimError();
    return mapOrder(updated.rows[0]);
  });
}

export async function markOrderPaymentFailedFromProviderEvent(
  orderId: string,
  paymentAttemptId: string,
  message: string,
  providerOrderId?: string | null,
) {
  return withTransaction(async client => {
    const orderResult = await client.query<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw publicError('订单不存在', 404);
    const attempt = await client.query(
      `UPDATE payment_attempts
       SET status = 'failed',
           provider_order_id = COALESCE($3, provider_order_id),
           error = $4,
           manual_review_reason = NULL,
           next_at = NULL,
           lease_token = NULL,
           lease_until = NULL,
           terminal_at = COALESCE(terminal_at, now()),
           launch_ciphertext = NULL,
           launch_iv = NULL,
           launch_tag = NULL,
           updated_at = now()
       WHERE id = $1 AND order_id = $2
         AND status NOT IN ('paid', 'manual-review')
       RETURNING id`,
      [paymentAttemptId, order.id, providerOrderId ?? null, message],
    );
    if (!attempt.rowCount) return mapOrder(order);
    if (order.current_payment_attempt_id !== paymentAttemptId || order.status !== 'pending') {
      return mapOrder(order);
    }
    const updated = await client.query<OrderRow>(
      `UPDATE orders
       SET status = 'failed', failed_at = now(), payment_error = $3,
           provider_order_id = COALESCE($4, provider_order_id)
       WHERE id = $1 AND current_payment_attempt_id = $2 AND status = 'pending'
       RETURNING *`,
      [order.id, paymentAttemptId, message, providerOrderId ?? null],
    );
    return mapOrder(updated.rows[0] ?? order);
  });
}

export async function queueOrderRefundWithClient(
  client: DbClient,
  orderId: string,
  operatorUserId: string,
  clientIp?: string,
) {
  await prepareOrderRefundWithClient(client, orderId, operatorUserId, clientIp);
  const order = await getOrderById(client, orderId);
  if (!order) throw publicError('订单不存在', 404);
  return order;
}

export async function processPendingOrderRefunds(limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  let claimed = 0;
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < safeLimit; index += 1) {
    const row = await claimNextOrderRefundDispatch();
    if (!row) break;
    claimed += 1;
    try {
      await dispatchClaimedOrderRefund(row);
      processed += 1;
    } catch (error) {
      failed += 1;
      console.error('退款投递处理失败', {
        orderId: row.id,
        merchantRefundNo: row.merchant_refund_no,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
  return { claimed, processed, failed };
}

async function claimNextOrderRefundDispatch() {
  const leaseToken = randomUUID();
  const claimed = await withTransaction(async client => client.query<ClaimedRefundDispatch>(
    `WITH due AS (
       SELECT attempt.id, attempt.status AS previous_status
       FROM order_refund_attempts attempt
       JOIN orders item ON item.current_refund_attempt_id = attempt.id
       WHERE item.refund_status = 'pending'
         AND (
           attempt.status IN ('queued', 'uncertain', 'submitted')
           OR (attempt.status = 'processing' AND attempt.lease_until <= now())
         )
         AND COALESCE(attempt.next_at, now()) <= now()
       ORDER BY COALESCE(attempt.next_at, attempt.created_at), attempt.created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     ), claimed AS (
       UPDATE order_refund_attempts attempt
       SET status = 'processing',
           attempts = attempt.attempts + 1,
           lease_token = $1,
           lease_until = now() + interval '60 seconds',
           next_at = NULL,
           updated_at = now()
       FROM due
       WHERE attempt.id = due.id
       RETURNING attempt.*, due.previous_status
     )
     UPDATE orders item
     SET refund_dispatch_status = 'processing',
         refund_dispatch_attempts = claimed.attempts,
         refund_dispatch_lease_until = claimed.lease_until
     FROM claimed
     WHERE item.id = claimed.order_id
     RETURNING item.id,
               claimed.id AS refund_attempt_id,
               claimed.lease_token::text AS lease_token,
               claimed.channel_revision_id::text AS channel_revision_id,
               claimed.merchant_order_no, claimed.merchant_refund_no, claimed.amount,
               host(claimed.client_ip) AS refund_client_ip,
               claimed.attempts AS refund_dispatch_attempts,
               claimed.previous_status`,
    [leaseToken],
  ));
  return claimed.rows[0] ?? null;
}

export async function syncOrderRefund(orderId: string) {
  const order = await getRequiredOrder(orderId);
  if (order.refundStatus !== 'pending' || !order.merchantRefundNo) return order;
  const attempt = await getCurrentRefundAttempt(orderId);
  if (!attempt) return order;
  // 主动同步不能抢占 worker 的活动租约。未知结果保持冻结，等待当前 owner
  // 或租约恢复扫描继续推进。
  if (attempt.status === 'processing') return order;
  try {
    const config = await getPaymentChannelCredentialsByRevision(attempt.channel_revision_id);
    const result = await queryRefundOrder(config, order.merchantRefundNo);
    validateRefundQueryResult(order, attempt, result);
    return applyRefundResult(orderId, result);
  } catch (error) {
    if (isProviderResultMismatch(error)) {
      await markRefundAttemptManualReview(attempt.id, error.message);
    } else {
      await markRefundAttemptUncertain(attempt.id, null, '退款状态暂时无法确认');
    }
    return getRequiredOrder(orderId);
  }
}

export async function applyRefundResult(
  orderId: string,
  result: RefundOrderData,
  claim?: ClaimedRefundDispatch,
  providerEventAttemptId?: string,
) {
  const providerEventAttempt = providerEventAttemptId
    ? await getRefundAttemptForProviderEvent(orderId, providerEventAttemptId)
    : null;
  if (providerEventAttempt && !providerEventAttempt.is_current) {
    await markRefundAttemptManualReview(
      providerEventAttempt.id,
      '收到已非当前退款 attempt 的延迟回调，已隔离等待人工核对',
      { providerEvent: true },
    );
    return getRequiredOrder(orderId);
  }
  const attempt = claim
    ? await getRefundAttemptForClaim(orderId, claim)
    : providerEventAttempt ?? await getCurrentRefundAttempt(orderId);
  if (!attempt) throw publicError('退款 attempt 不存在', 409);
  if (result.mchRefundNo !== attempt.merchant_refund_no) {
    await markRefundAttemptManualReview(
      attempt.id,
      '供应商返回的商户退款号不匹配',
      claim ? { claim } : { providerEvent: Boolean(providerEventAttemptId) },
    );
    throw publicError('退款响应与本地 attempt 不匹配', 502);
  }
  if (attempt.provider_refund_id && result.refundOrderId && attempt.provider_refund_id !== result.refundOrderId) {
    await markRefundAttemptManualReview(
      attempt.id,
      '同一退款 attempt 收到不同的供应商退款单号',
      claim ? { claim } : { providerEvent: Boolean(providerEventAttemptId) },
    );
    throw publicError('供应商退款单号冲突', 409);
  }
  if (result.state === 2) {
    return finalizeOrderRefund(orderId, result.refundOrderId, claim, attempt.id);
  }
  if (result.state === 3 || result.state === 4) {
    return failOrderRefund(
      orderId,
      '退款失败，请核对支付状态后重试',
      claim,
      attempt.id,
    );
  }
  const transitioned = await withTransaction(async client => {
    const pointer = await client.query<{ current_refund_attempt_id: string | null }>(
      'SELECT current_refund_attempt_id FROM orders WHERE id = $1 FOR UPDATE',
      [orderId],
    );
    if (pointer.rows[0]?.current_refund_attempt_id !== attempt.id) {
      if (claim) throw staleRefundClaimError();
      return false;
    }
    const updated = await client.query(
      `UPDATE order_refund_attempts attempt
       SET provider_refund_id = COALESCE($2, attempt.provider_refund_id),
           status = 'submitted',
           submitted_at = COALESCE(submitted_at, now()),
           next_at = now() + interval '30 seconds',
           lease_token = NULL,
           lease_until = NULL,
           error = NULL,
           updated_at = now()
       FROM orders item
       WHERE attempt.id = $1
         AND item.id = attempt.order_id
         AND ($3::uuid IS NULL OR attempt.lease_token = $3::uuid)
         AND ($4::uuid IS NULL OR item.current_refund_attempt_id = $4::uuid)
         AND attempt.status IN ('processing', 'submitted', 'uncertain')`,
      [
        attempt.id,
        result.refundOrderId || null,
        claim?.lease_token ?? null,
        attempt.id,
      ],
    );
    if (claim && !updated.rowCount) throw staleRefundClaimError();
    if (!updated.rowCount) return false;
    await client.query(
      `UPDATE orders
       SET provider_refund_id = COALESCE($2, provider_refund_id),
           refund_error = NULL,
           refund_dispatch_status = 'submitted',
           refund_dispatch_next_at = now() + interval '30 seconds',
           refund_dispatch_lease_until = NULL
       WHERE id = $1 AND refund_status = 'pending' AND current_refund_attempt_id = $3`,
      [orderId, result.refundOrderId || null, attempt.id],
    );
    return true;
  });
  if (!transitioned && providerEventAttemptId) {
    await markRefundAttemptManualReview(
      providerEventAttemptId,
      '退款回调处理时 attempt 已不再是当前项，已隔离等待人工核对',
      { providerEvent: true },
    );
  }
  return getRequiredOrder(orderId);
}

export async function finalizeOrderRefund(
  orderId: string,
  refundOrderNo: string,
  claim?: ClaimedRefundDispatch,
  providerEventAttemptId?: string,
) {
  const outcome = await withTransaction(async client => {
    const orderResult = await client.query<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw publicError('订单不存在', 404);
    if (!await assertRefundClaimWithClient(client, order, claim, providerEventAttemptId)) {
      return { conflict: false as const, value: mapOrder(order) };
    }
    if (order.status === 'refunded' || order.refund_status === 'succeeded') {
      return { conflict: false as const, value: mapOrder(order) };
    }
    if (order.refund_status !== 'pending') throw publicError('当前退款状态不能确认成功', 400);
    if (!order.merchant_refund_no) throw publicError('退款 attempt 数据不完整', 409);
    if (order.provider_refund_id && refundOrderNo && order.provider_refund_id !== refundOrderNo) {
      if (order.current_refund_attempt_id) {
        await client.query(
          `UPDATE order_refund_attempts
           SET status = 'manual-review', manual_review_reason = $2,
               terminal_at = COALESCE(terminal_at, now()),
               next_at = NULL, lease_token = NULL, lease_until = NULL,
               updated_at = now()
           WHERE id = $1`,
          [order.current_refund_attempt_id, '退款成功结果的供应商退款单号冲突'],
        );
      }
      return { conflict: true as const };
    }

    await lockReferralUsersWithClient(client, order.user_id);
    await reverseOrderRefundHoldWithClient(client, order.id, order.merchant_refund_no);
    await revokeReferralForOrderWithClient(client, order.id);

    if (order.refund_credit_ledger_id) {
      await client.query(
        `UPDATE credit_ledger
         SET type = 'void', settlement_status = 'reversed', source = '退款冲销',
             note = $2
         WHERE id = $1`,
        [order.refund_credit_ledger_id, creditLedgerNotes.orderRefundSucceeded],
      );
    }

    if (order.kind === 'main') {
      const restored = await client.query<{ id: string }>(
        `UPDATE users
         SET plan_id = $2,
             billing_cycle = COALESCE($3, billing_cycle),
             plan_cycle_started_at = COALESCE($4, plan_cycle_started_at),
             plan_reset_at = $5,
             plan_expires_at = $6,
             active_subscription_order_id = $7,
             updated_at = now()
         WHERE id = $1 AND active_subscription_order_id = $8
         RETURNING id`,
        [
          order.user_id,
          order.previous_plan_id,
          order.previous_billing_cycle,
          order.previous_plan_cycle_started_at,
          order.previous_plan_reset_at,
          order.previous_plan_expires_at,
          order.previous_subscription_order_id,
          order.id,
        ],
      );
      if (restored.rowCount) {
        await enqueuePortraitEntitlementReconcileWithClient(client, {
          userId: order.user_id,
          eventKey: `portrait-refund:${order.id}`,
          reason: 'main-plan-refunded',
          oldPlanId: order.plan_id,
          newPlanId: order.previous_plan_id,
        });
      }
    }

    const updated = await client.query<OrderRow>(
      `UPDATE orders
       SET status = 'refunded',
           credit_status = 'reversed',
           refund_status = 'succeeded',
           provider_refund_id = $2,
           refund_error = NULL,
           refund_dispatch_status = 'completed',
           refund_dispatch_next_at = NULL,
           refund_dispatch_lease_until = NULL,
           refunded_at = now()
       WHERE id = $1
       RETURNING *`,
      [order.id, refundOrderNo],
    );
    if (order.current_refund_attempt_id) {
      await client.query(
        `UPDATE order_refund_attempts
         SET status = 'succeeded',
             provider_refund_id = COALESCE($2, provider_refund_id),
             terminal_at = COALESCE(terminal_at, now()),
             next_at = NULL, lease_token = NULL, lease_until = NULL,
             error = NULL, updated_at = now()
         WHERE id = $1 AND status <> 'manual-review'`,
        [order.current_refund_attempt_id, refundOrderNo || null],
      );
    }
    return { conflict: false as const, value: mapOrder(updated.rows[0]!) };
  });
  if (outcome.conflict) throw publicError('供应商退款单号冲突，请人工核对', 409);
  return outcome.value;
}

export async function failOrderRefund(
  orderId: string,
  reason: string,
  claim?: ClaimedRefundDispatch,
  providerEventAttemptId?: string,
) {
  return withTransaction(async client => {
    const orderResult = await client.query<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw publicError('订单不存在', 404);
    if (!await assertRefundClaimWithClient(client, order, claim, providerEventAttemptId)) {
      return mapOrder(order);
    }
    if (order.refund_status !== 'pending') return mapOrder(order);

    if (!order.merchant_refund_no) throw publicError('退款 attempt 数据不完整', 409);
    await releaseOrderRefundHoldWithClient(client, {
      id: order.id,
      userId: order.user_id,
      kind: order.kind,
      planName: order.plan_name,
      creditAmount: toInt(order.credit_amount),
      creditBucket: order.credit_bucket,
    }, order.merchant_refund_no);
    if (order.refund_credit_ledger_id) {
      await client.query(
        `UPDATE credit_ledger SET settlement_status = 'refunded', note = $2 WHERE id = $1`,
        [order.refund_credit_ledger_id, creditLedgerNotes.orderRefundFailedHoldReleased],
      );
    }
    const updated = await client.query<OrderRow>(
      `UPDATE orders
       SET refund_status = 'failed', refund_error = $2,
           refund_dispatch_status = 'failed',
           refund_dispatch_next_at = NULL,
           refund_dispatch_lease_until = NULL
       WHERE id = $1
       RETURNING *`,
      [order.id, reason],
    );
    if (order.current_refund_attempt_id) {
      await client.query(
        `UPDATE order_refund_attempts
         SET status = 'failed', error = $2,
             terminal_at = COALESCE(terminal_at, now()),
             next_at = NULL, lease_token = NULL, lease_until = NULL,
             updated_at = now()
         WHERE id = $1 AND status <> 'manual-review'`,
        [order.current_refund_attempt_id, reason],
      );
    }
    return mapOrder(updated.rows[0]!);
  });
}

async function prepareOrderRefundWithClient(
  client: DbClient,
  orderId: string,
  operatorUserId: string,
  clientIp?: string,
): Promise<void> {
    const orderResult = await client.query<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw publicError('订单不存在', 404);
    if (order.payment_provider !== 'jeepay' || !order.merchant_order_no) {
      throw publicError('该订单不支持自动退款', 400);
    }
    if (order.refund_status === 'pending') {
      return;
    }
    if (order.status !== 'paid' || order.refund_status === 'succeeded') {
      throw publicError('只有已支付订单可以退款', 400);
    }

    const userResult = await client.query<{
      main_credits: number;
      addon_credits: number;
      active_subscription_order_id: string | null;
    }>(
      `SELECT main_credits, addon_credits, active_subscription_order_id
       FROM users WHERE id = $1 FOR UPDATE`,
      [order.user_id],
    );
    const user = userResult.rows[0]!;
    const merchantRefundNo = createMerchantOrderNo('ref');
    const hold = await holdOrderCreditsForRefundWithClient(client, {
      id: order.id,
      userId: order.user_id,
      kind: order.kind,
      planName: order.plan_name,
      creditAmount: toInt(order.credit_amount),
      creditBucket: order.credit_bucket,
    }, user, merchantRefundNo, operatorUserId);

    const channelRevision = await client.query<{ channel_revision_id: string | null }>(
      `SELECT attempt.channel_revision_id
       FROM orders item
       JOIN payment_attempts attempt ON attempt.id = item.current_payment_attempt_id
       WHERE item.id = $1`,
      [order.id],
    );
    const channelRevisionId = channelRevision.rows[0]?.channel_revision_id;
    if (!channelRevisionId) throw publicError('订单支付通道版本不存在，不能自动退款', 409);
    const attemptNumber = await client.query<{ next_attempt: number }>(
      `SELECT COALESCE(max(attempt), 0) + 1 AS next_attempt
       FROM order_refund_attempts WHERE order_id = $1`,
      [order.id],
    );
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ orderId: order.id, amount: toInt(order.amount), currency: 'CNY' }))
      .digest('hex');
    const attempt = await client.query<{ id: string }>(
      `INSERT INTO order_refund_attempts (
         order_id, attempt, request_hash, merchant_refund_no, merchant_order_no,
         channel_revision_id, provider_order_id, amount, status, next_at, client_ip
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', now(), $9)
       RETURNING id`,
      [
        order.id,
        toInt(attemptNumber.rows[0]?.next_attempt),
        requestHash,
        merchantRefundNo,
        order.merchant_order_no,
        channelRevisionId,
        order.provider_order_id,
        toInt(order.amount),
        clientIp ?? null,
      ],
    );
    await client.query(
      `UPDATE orders
       SET refund_status = 'pending', merchant_refund_no = $2,
           provider_refund_id = NULL, refund_error = NULL,
           refund_credit_ledger_id = $3,
           current_refund_attempt_id = $4,
           refund_dispatch_status = 'queued',
           refund_dispatch_attempts = 0,
           refund_dispatch_next_at = now(),
           refund_dispatch_lease_until = NULL,
           refund_client_ip = $5
       WHERE id = $1`,
      [order.id, merchantRefundNo, hold.ledgerId, attempt.rows[0]!.id, clientIp ?? null],
    );
    await client.query(
      `INSERT INTO audit_logs (admin_user_id, admin_email, module, action, target, risk, detail)
       SELECT $1, email, '订单管理', '发起退款', $2, 'high', $3
       FROM users WHERE id = $1`,
      [operatorUserId, order.id, `订单 ${order.id} 已发起全额退款。`],
    );
}

async function dispatchClaimedOrderRefund(row: ClaimedRefundDispatch) {
  let config: Awaited<ReturnType<typeof getPaymentChannelCredentialsByRevision>>;
  try {
    config = await getPaymentChannelCredentialsByRevision(row.channel_revision_id);
  } catch {
    await rescheduleOrderRefundDispatch(row);
    return;
  }

  // 只有从未投递过的 queued attempt 才能调用创建接口。任何 uncertain/submitted/
  // 过期 processing 都只能查固定退款号，避免响应丢失后重复发起。
  if (row.previous_status === 'queued') {
    try {
      const result = await createRefundOrder(config, {
        merchantOrderNo: row.merchant_order_no,
        merchantRefundNo: row.merchant_refund_no,
        amount: toInt(row.amount),
        clientIp: row.refund_client_ip ?? undefined,
      });
      validateRefundCreateResult(row, result);
      // 创建响应不含原支付金额、退款金额和币种，不能据此释放或冲销积分。
      // 这里只记录供应商退款号；终态必须由严格查单或已完整校验的回调确认。
      await applyRefundResult(row.id, { ...result, state: 1 }, row);
      return;
    } catch (error) {
      if (isProviderResultMismatch(error)) {
        await markRefundAttemptManualReview(row.refund_attempt_id, error.message, { claim: row });
        return;
      }
      // 创建失败可能是网络中断、供应商已受理但响应丢失或重复商户号；统一先查单。
    }
  }

  try {
    const result = await queryRefundOrder(config, row.merchant_refund_no);
    const order = await getRequiredOrder(row.id);
    const attempt = await getRefundAttemptForClaim(row.id, row);
    if (!attempt) throw publicError('退款 attempt 不存在', 409);
    validateRefundQueryResult(order, attempt, result);
    await applyRefundResult(row.id, result, row);
  } catch (error) {
    if (isProviderResultMismatch(error)) {
      await markRefundAttemptManualReview(row.refund_attempt_id, error.message, { claim: row });
      return;
    }
    if (row.previous_status !== 'queued' && isDefinitiveMissingRefundOrder(error)) {
      // 已经先查到供应商明确“退款单不存在”时，才允许用同一稳定商户退款号补建；
      // 即使创建响应声称终态，也仍只进入 submitted，绝不据此释放积分。
      try {
        const created = await createRefundOrder(config, {
          merchantOrderNo: row.merchant_order_no,
          merchantRefundNo: row.merchant_refund_no,
          amount: toInt(row.amount),
          clientIp: row.refund_client_ip ?? undefined,
        });
        validateRefundCreateResult(row, created);
        await applyRefundResult(row.id, { ...created, state: 1 }, row);
        return;
      } catch (createError) {
        if (isProviderResultMismatch(createError)) {
          await markRefundAttemptManualReview(row.refund_attempt_id, createError.message, { claim: row });
          return;
        }
      }
    }
    // 网络错误、5xx、签名错误和“暂时查无”都不是终态失败，绝不能释放积分。
    await rescheduleOrderRefundDispatch(row);
  }
}

async function rescheduleOrderRefundDispatch(row: ClaimedRefundDispatch) {
  const delaySeconds = refundDispatchRetryDelaySeconds(row.refund_dispatch_attempts);
  await withTransaction(async client => {
    const updated = await client.query(
      `UPDATE order_refund_attempts
       SET status = 'uncertain',
           next_at = now() + ($3::integer * interval '1 second'),
           lease_token = NULL,
           lease_until = NULL,
           error = '退款状态暂时无法确认',
           updated_at = now()
       WHERE id = $1 AND status = 'processing' AND lease_token = $2::uuid`,
      [row.refund_attempt_id, row.lease_token, delaySeconds],
    );
    if (!updated.rowCount) return;
    await client.query(
      `UPDATE orders
       SET refund_dispatch_status = 'uncertain',
           refund_dispatch_next_at = now() + ($2::integer * interval '1 second'),
           refund_dispatch_lease_until = NULL,
           refund_error = '退款状态暂时无法确认'
       WHERE id = $1 AND current_refund_attempt_id = $3
         AND refund_status = 'pending'`,
      [row.id, delaySeconds, row.refund_attempt_id],
    );
  });
}

function refundDispatchRetryDelaySeconds(attempts: number) {
  const exponent = Math.max(0, Math.min(10, toInt(attempts) - 1));
  return Math.min(6 * 60 * 60, 30 * (2 ** exponent));
}

async function getRequiredOrder(orderId: string) {
  const order = await getOrderById(pool, orderId);
  if (!order) throw publicError('订单不存在', 404);
  return order;
}

async function updateAndReadOrder(sql: string, params: unknown[]) {
  return withTransaction(async client => {
    await client.query(sql, params);
    const result = await client.query<OrderRow>(
      `SELECT o.*, u.user_name, u.email,
              pa.status AS payment_attempt_status, pa.error AS payment_attempt_error, pa.next_at AS payment_attempt_next_at,
              ra.status AS refund_attempt_status, ra.next_at AS refund_attempt_next_at,
              ra.manual_review_reason AS refund_manual_review_reason
       FROM orders o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN payment_attempts pa ON pa.id = o.current_payment_attempt_id
       LEFT JOIN order_refund_attempts ra ON ra.id = o.current_refund_attempt_id
       WHERE o.id = $1`,
      [params[0]],
    );
    if (!result.rows[0]) throw publicError('订单不存在', 404);
    return mapOrder(result.rows[0]);
  });
}

function assertBillingAllowed(
  plan: { kind: 'main' | 'addon'; billing: 'monthly' | 'yearly' | 'both' | 'one-time' },
  billing: 'monthly' | 'yearly' | 'one-time',
) {
  if (plan.kind === 'addon') {
    if (billing !== 'one-time' || plan.billing !== 'one-time') throw publicError('加购包只能一次性购买', 400);
    return;
  }
  if (billing === 'one-time' || !['both', billing].includes(plan.billing)) {
    throw publicError('套餐不支持所选计费周期', 400);
  }
}

function assertIdempotentOrderMatches(
  order: OrderRow,
  expected: {
    planId: string;
    billing: 'monthly' | 'yearly' | 'one-time';
    paymentProvider: string;
    paymentWayCode: PaymentWayCode | null;
    paymentSurface: PaymentSurface | null;
  },
) {
  if (
    order.plan_id !== expected.planId
    || order.billing !== expected.billing
    || order.payment_provider !== expected.paymentProvider
    || order.payment_way_code !== expected.paymentWayCode
    || order.payment_surface !== expected.paymentSurface
  ) {
    throw Object.assign(publicError('该幂等键已用于不同的支付请求', 409), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
  }
}

function paymentLabels(
  provider: string,
  wayCode: string | null,
  legacyMethod: string,
  surface: PaymentSurface | null,
) {
  if (provider === 'jeepay' || provider === 'alipay-direct' || legacyMethod.toLowerCase() === 'alipay') {
    return {
      method: '支付宝',
      way: wayCode === 'ALI_QR' || (wayCode === 'ALI_WAP' && surface === 'pc')
        ? '支付宝扫码支付'
        : wayCode === 'ALI_PC'
          ? '支付宝电脑网站'
          : wayCode === 'ALI_WAP'
            ? '支付宝手机网页'
            : '支付宝',
    };
  }
  return { method: '在线支付', way: '在线支付' };
}

interface CurrentRefundAttemptRow {
  id: string;
  order_id: string;
  merchant_order_no: string;
  merchant_refund_no: string;
  channel_revision_id: string;
  provider_refund_id: string | null;
  provider_order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  lease_token: string | null;
  lease_until: Date | string | null;
}

async function assertPaymentClaimWithClient(
  client: DbClient,
  order: OrderRow,
  paymentAttemptId?: string,
  leaseToken?: string,
) {
  if (!leaseToken) return;
  if (!paymentAttemptId || order.current_payment_attempt_id !== paymentAttemptId) {
    throw stalePaymentClaimError();
  }
  const result = await client.query<{ id: string }>(
    `SELECT id FROM payment_attempts
     WHERE id = $1 AND order_id = $2
       AND status = 'processing' AND lease_token = $3::uuid
     LIMIT 1 FOR UPDATE`,
    [paymentAttemptId, order.id, leaseToken],
  );
  if (!result.rowCount) throw stalePaymentClaimError();
}

async function assertRefundClaimWithClient(
  client: DbClient,
  order: OrderRow,
  claim?: ClaimedRefundDispatch,
  expectedAttemptId?: string,
) {
  if (expectedAttemptId && order.current_refund_attempt_id !== expectedAttemptId) {
    if (claim) throw staleRefundClaimError();
    await client.query(
      `UPDATE order_refund_attempts
       SET status = 'manual-review',
           manual_review_reason = '退款终态回调对应的 attempt 已非当前项，已隔离等待人工核对',
           terminal_at = COALESCE(terminal_at, now()),
           next_at = NULL, lease_token = NULL, lease_until = NULL,
           updated_at = now()
       WHERE id = $1 AND order_id = $2`,
      [expectedAttemptId, order.id],
    );
    return false;
  }
  if (!claim) {
    if (expectedAttemptId) {
      const locked = await client.query<{ id: string }>(
        `SELECT id FROM order_refund_attempts
         WHERE id = $1 AND order_id = $2
         LIMIT 1 FOR UPDATE`,
        [expectedAttemptId, order.id],
      );
      if (!locked.rowCount) throw publicError('退款 attempt 不存在', 409);
    }
    return true;
  }
  if (order.current_refund_attempt_id !== claim.refund_attempt_id) throw staleRefundClaimError();
  const result = await client.query<{ id: string }>(
    `SELECT id FROM order_refund_attempts
     WHERE id = $1 AND order_id = $2
       AND status = 'processing' AND lease_token = $3::uuid
     LIMIT 1 FOR UPDATE`,
    [claim.refund_attempt_id, order.id, claim.lease_token],
  );
  if (!result.rowCount) throw staleRefundClaimError();
  return true;
}

async function getCurrentRefundAttempt(orderId: string) {
  const result = await pool.query<CurrentRefundAttemptRow>(
    `SELECT attempt.*
     FROM orders item
     JOIN order_refund_attempts attempt ON attempt.id = item.current_refund_attempt_id
     WHERE item.id = $1
     LIMIT 1`,
    [orderId],
  );
  return result.rows[0] ?? null;
}

async function getRefundAttemptForClaim(
  orderId: string,
  claim: ClaimedRefundDispatch,
) {
  const result = await pool.query<CurrentRefundAttemptRow>(
    `SELECT attempt.*
     FROM orders item
     JOIN order_refund_attempts attempt ON attempt.id = item.current_refund_attempt_id
     WHERE item.id = $1
       AND attempt.id = $2
       AND attempt.status = 'processing'
       AND attempt.lease_token = $3::uuid
     LIMIT 1`,
    [orderId, claim.refund_attempt_id, claim.lease_token],
  );
  if (!result.rows[0]) throw staleRefundClaimError();
  return result.rows[0];
}

async function getRefundAttemptForProviderEvent(orderId: string, attemptId: string) {
  const result = await pool.query<CurrentRefundAttemptRow & { is_current: boolean }>(
    `SELECT attempt.*, (item.current_refund_attempt_id = attempt.id) AS is_current
     FROM orders item
     JOIN order_refund_attempts attempt ON attempt.order_id = item.id
     WHERE item.id = $1 AND attempt.id = $2
     LIMIT 1`,
    [orderId, attemptId],
  );
  if (!result.rows[0]) throw publicError('退款 attempt 不存在', 409);
  return result.rows[0];
}

function validateRefundCreateResult(row: ClaimedRefundDispatch, result: RefundOrderData) {
  if (result.mchRefundNo !== row.merchant_refund_no || !result.refundOrderId) {
    throw providerResultMismatch('退款创建响应与本地 attempt 不匹配');
  }
}

function validateRefundQueryResult(
  order: {
    merchantOrderNo?: string | null;
    paymentOrderNo?: string | null;
    amount: number;
  },
  attempt: CurrentRefundAttemptRow,
  result: RefundQueryData,
) {
  if (
    result.mchRefundNo !== attempt.merchant_refund_no
    || result.mchOrderNo !== attempt.merchant_order_no
    || result.payOrderId !== (attempt.provider_order_id ?? order.paymentOrderNo)
    || toInt(result.payAmount) !== toInt(order.amount)
    || toInt(result.refundAmount) !== toInt(attempt.amount)
    || result.currency?.toUpperCase() !== 'CNY'
  ) {
    throw providerResultMismatch('退款查单结果与本地 attempt 不匹配');
  }
}

async function markRefundAttemptUncertain(attemptId: string, leaseToken: string | null, reason: string) {
  await pool.query(
    `UPDATE order_refund_attempts
     SET status = 'uncertain',
         next_at = now() + interval '30 seconds',
         lease_token = NULL,
         lease_until = NULL,
         error = $3,
         updated_at = now()
     WHERE id = $1
       AND (
         ($2::uuid IS NOT NULL AND status = 'processing' AND lease_token = $2::uuid)
         OR ($2::uuid IS NULL AND status IN ('submitted', 'uncertain'))
       )`,
    [attemptId, leaseToken, reason],
  );
}

export async function markRefundAttemptManualReview(
  attemptId: string,
  reason: string,
  options: { claim?: ClaimedRefundDispatch; providerEvent?: boolean } = {},
) {
  const result = await pool.query(
    `UPDATE order_refund_attempts attempt
     SET status = 'manual-review',
         manual_review_reason = $2,
         terminal_at = COALESCE(terminal_at, now()),
         next_at = NULL,
         lease_token = NULL,
         lease_until = NULL,
         updated_at = now()
     FROM orders item
     WHERE attempt.id = $1
       AND item.id = attempt.order_id
       AND (
         (
           $3::uuid IS NOT NULL
           AND attempt.status = 'processing'
           AND attempt.lease_token = $3::uuid
           AND item.id = $4::uuid
           AND item.current_refund_attempt_id = attempt.id
         )
         OR ($3::uuid IS NULL AND $5::boolean)
         OR (
           $3::uuid IS NULL
           AND NOT $5::boolean
           AND attempt.status IN ('queued', 'submitted', 'uncertain')
         )
       )
     RETURNING attempt.id`,
    [
      attemptId,
      reason,
      options.claim?.lease_token ?? null,
      options.claim?.id ?? null,
      options.providerEvent === true,
    ],
  );
  if (options.claim && !result.rowCount) throw staleRefundClaimError();
}

function staleRefundClaimError() {
  return Object.assign(new Error('退款 attempt 租约已失效'), {
    statusCode: 409,
    code: 'REFUND_ATTEMPT_STALE_CLAIM',
    exposeMessage: true,
  });
}

function stalePaymentClaimError() {
  return Object.assign(new Error('支付 attempt 租约已失效'), {
    statusCode: 409,
    code: 'PAYMENT_ATTEMPT_STALE_CLAIM',
    exposeMessage: true,
  });
}

function providerResultMismatch(message: string) {
  return Object.assign(publicError(message, 502), { code: 'PROVIDER_RESULT_MISMATCH' });
}

function isProviderResultMismatch(error: unknown): error is Error {
  return error instanceof Error
    && (error as { code?: unknown }).code === 'PROVIDER_RESULT_MISMATCH';
}

function legacyPaymentAttemptStatus(row: OrderRow) {
  if (row.status === 'paid' || row.status === 'refunded') return 'paid' as const;
  if (row.status === 'failed') return 'failed' as const;
  if (row.provider_order_id) return 'uncertain' as const;
  return 'queued' as const;
}

function legacyRefundAttemptStatus(row: OrderRow) {
  if (row.refund_status === 'succeeded') return 'succeeded' as const;
  if (row.refund_status === 'failed') return 'failed' as const;
  if (row.refund_dispatch_status === 'submitted') return 'submitted' as const;
  if (row.refund_dispatch_status === 'processing') return 'processing' as const;
  if (row.refund_dispatch_status === 'uncertain') return 'uncertain' as const;
  if (row.refund_status === 'pending') return 'queued' as const;
  return null;
}

function addDaysToBillingDate(billingDate: string, days: number) {
  const value = new Date(`${billingDate}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

function retryAfterMs(value: Date | string | null | undefined) {
  if (!value) return null;
  return Math.max(0, new Date(value).getTime() - Date.now());
}

function publicError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode, exposeMessage: true });
}
