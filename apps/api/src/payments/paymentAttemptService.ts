import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  createPaymentOrder,
  normalizePaymentLaunch,
  queryPaymentOrder,
  type PaymentLaunch,
  type PaymentQueryData,
} from './jeepayService.js';
import {
  getPaymentChannelCredentialsByRevision,
  type PaymentChannelCredentials,
  type PaymentSurface,
  type PaymentWayCode,
} from './paymentChannelService.js';
import { env } from '../config/env.js';
import { pool, withTransaction, type DbClient } from '../db/pool.js';
import { toIsoDateTime, toInt } from '../domain/serialization.js';
import { markOrderPaid, markOrderPaymentTerminalFromClaim } from '../domain/ordersService.js';

export type PaymentAttemptStatus =
  | 'queued'
  | 'processing'
  | 'ready'
  | 'uncertain'
  | 'paid'
  | 'closed'
  | 'failed'
  | 'manual-review';

export interface PaymentAttemptRow {
  id: string;
  order_id: string;
  attempt: number;
  idempotency_key: string;
  request_hash: string;
  merchant_order_no: string;
  channel_revision_id: string;
  provider_order_id: string | null;
  amount: number;
  currency: 'CNY';
  surface: PaymentSurface;
  way_code: PaymentWayCode;
  return_origin: string;
  status: PaymentAttemptStatus;
  launch_ciphertext: string | null;
  launch_iv: string | null;
  launch_tag: string | null;
  attempts: number;
  next_at: Date | string | null;
  lease_token: string | null;
  lease_until: Date | string | null;
  error: string | null;
  manual_review_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DuePaymentAttemptRow extends PaymentAttemptRow {
  previous_status: 'queued' | 'processing' | 'uncertain';
  plan_name: string;
  billing: 'monthly' | 'yearly' | 'one-time';
  order_status: string;
}

export interface PaymentAttemptClaim {
  id: string;
  orderId: string;
  merchantOrderNo: string;
  channelRevisionId: string;
  returnOrigin: string;
  leaseToken: string;
  previousStatus: 'queued' | 'processing' | 'ready' | 'uncertain';
  status: 'processing';
}

export function hashPaymentRequest(input: {
  planId: string;
  billing: string;
  surface: PaymentSurface;
  amount?: number;
}) {
  return createHash('sha256')
    .update(JSON.stringify({
      planId: input.planId,
      billing: input.billing,
      surface: input.surface,
      amount: input.amount ?? null,
    }))
    .digest('hex');
}

export async function ensurePaymentAttempt(
  order: {
    id: string;
    amount: number;
    merchantOrderNo?: string | null;
    paymentSurface?: PaymentSurface | null;
    paymentWayCode?: string | null;
  },
  idempotencyKey: string,
  requestHash: string,
  config: PaymentChannelCredentials,
  returnOrigin: string,
) {
  return withTransaction(async client => {
    if (!config.revisionId) throw publicError('支付通道版本未初始化', 503);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payment-attempt:${order.id}`]);
    const existing = await client.query<PaymentAttemptRow>(
      `SELECT attempt.*
       FROM orders item
       JOIN payment_attempts attempt ON attempt.id = item.current_payment_attempt_id
       WHERE item.id = $1
       LIMIT 1 FOR UPDATE OF attempt`,
      [order.id],
    );
    const current = existing.rows[0];
    if (current) {
      if (
        current.idempotency_key !== idempotencyKey
        || (current.request_hash !== requestHash && !current.request_hash.startsWith('legacy:'))
      ) {
        throw conflictError('该幂等键已用于不同的支付请求');
      }
      // 历史 attempt 的请求摘要只能表达迁移时已知事实。047 将 attempt 身份设为
      // 不可变，因此这里保留 legacy 摘要；订单字段匹配仍由路由层单独校验。
      return current;
    }
    const merchantOrderNo = order.merchantOrderNo || createPaymentMerchantOrderNo();
    const created = await client.query<PaymentAttemptRow>(
      `INSERT INTO payment_attempts (
         order_id, attempt, idempotency_key, request_hash, merchant_order_no,
         channel_revision_id, amount, surface, way_code, return_origin, status, next_at
       )
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', now())
       RETURNING *`,
      [
        order.id,
        idempotencyKey,
        requestHash,
        merchantOrderNo,
        config.revisionId,
        order.amount,
        order.paymentSurface ?? 'pc',
        order.paymentWayCode ?? config.desktopWayCode,
        returnOrigin,
      ],
    );
    await client.query(
      `UPDATE orders
       SET current_payment_attempt_id = $2,
           merchant_order_no = $3
       WHERE id = $1`,
      [order.id, created.rows[0]!.id, merchantOrderNo],
    );
    return created.rows[0]!;
  });
}

export async function claimPaymentAttempt(orderId: string): Promise<PaymentAttemptClaim | null> {
  const leaseToken = randomUUID();
  const result = await pool.query<PaymentAttemptRow>(
    `UPDATE payment_attempts attempt
     SET status = 'processing',
         attempts = attempts + 1,
         lease_token = $2,
         lease_until = now() + interval '60 seconds',
         next_at = NULL,
         updated_at = now()
     FROM orders item
     WHERE item.id = $1
       AND item.current_payment_attempt_id = attempt.id
       AND attempt.status = 'queued'
       AND item.status = 'pending'
     RETURNING attempt.*`,
    [orderId, leaseToken],
  );
  const row = result.rows[0];
  return row ? {
    id: row.id,
    orderId: row.order_id,
    merchantOrderNo: row.merchant_order_no,
    channelRevisionId: row.channel_revision_id,
    returnOrigin: row.return_origin,
    leaseToken,
    previousStatus: 'queued',
    status: 'processing',
  } : null;
}

export async function claimCurrentPaymentAttemptForReconciliation(
  orderId: string,
): Promise<{ claim: PaymentAttemptClaim; attempt: PaymentAttemptRow } | null> {
  const leaseToken = randomUUID();
  const result = await pool.query<PaymentAttemptRow & {
    previous_status: 'processing' | 'ready' | 'uncertain';
  }>(
    `WITH candidate AS (
       SELECT attempt.id, attempt.status AS previous_status
       FROM payment_attempts attempt
       JOIN orders item ON item.current_payment_attempt_id = attempt.id
       WHERE item.id = $1
         AND item.status = 'pending'
         AND (
           attempt.status IN ('ready', 'uncertain')
           OR (attempt.status = 'processing' AND attempt.lease_until <= now())
         )
       FOR UPDATE OF attempt SKIP LOCKED
       LIMIT 1
     ), claimed AS (
       UPDATE payment_attempts attempt
       SET status = 'processing', attempts = attempts + 1,
           lease_token = $2, lease_until = now() + interval '60 seconds',
           next_at = NULL, updated_at = now()
       FROM candidate
       WHERE attempt.id = candidate.id
       RETURNING attempt.*, candidate.previous_status
     )
     SELECT * FROM claimed`,
    [orderId, leaseToken],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    attempt: row,
    claim: {
      id: row.id,
      orderId: row.order_id,
      merchantOrderNo: row.merchant_order_no,
      channelRevisionId: row.channel_revision_id,
      returnOrigin: row.return_origin,
      leaseToken,
      previousStatus: row.previous_status,
      status: 'processing',
    },
  };
}

export async function markPaymentAttemptReady(
  claim: PaymentAttemptClaim,
  providerOrderId: string,
  launch: PaymentLaunch & { surface: PaymentSurface },
) {
  const encrypted = encryptAttemptLaunch(claim.id, launch);
  const result = await pool.query<PaymentAttemptRow>(
    `UPDATE payment_attempts
     SET status = 'ready',
         provider_order_id = $3,
         launch_ciphertext = $4,
         launch_iv = $5,
         launch_tag = $6,
         ready_at = now(),
         lease_token = NULL,
         lease_until = NULL,
         error = NULL,
         updated_at = now()
     WHERE id = $1 AND status = 'processing' AND lease_token = $2
     RETURNING *`,
    [claim.id, claim.leaseToken, providerOrderId, encrypted.ciphertext, encrypted.iv, encrypted.tag],
  );
  if (!result.rows[0]) throw staleClaimError();
  return mapPaymentAttempt(result.rows[0], launch);
}

export async function markPaymentAttemptUncertain(claim: PaymentAttemptClaim, message: string) {
  return finishClaim(claim, 'uncertain', message, new Date(Date.now() + 30_000));
}

export async function releasePaymentAttemptAfterPendingQuery(claim: PaymentAttemptClaim) {
  const status = claim.previousStatus === 'ready' ? 'ready' : 'uncertain';
  const result = await pool.query<PaymentAttemptRow>(
    `UPDATE payment_attempts
     SET status = $3,
         error = CASE WHEN $3 = 'ready' THEN NULL ELSE '支付状态尚未完成' END,
         next_at = CASE WHEN $3 = 'uncertain' THEN now() + interval '30 seconds' ELSE NULL END,
         lease_token = NULL,
         lease_until = NULL,
         updated_at = now()
     WHERE id = $1 AND status = 'processing' AND lease_token = $2
     RETURNING *`,
    [claim.id, claim.leaseToken, status],
  );
  if (!result.rows[0]) throw staleClaimError();
  return mapPaymentAttempt(result.rows[0]);
}

export async function markPaymentAttemptManualReviewFromClaim(
  claim: PaymentAttemptClaim,
  reason: string,
) {
  const result = await pool.query<PaymentAttemptRow>(
    `UPDATE payment_attempts attempt
     SET status = 'manual-review',
         manual_review_reason = $3,
         error = NULL,
         next_at = NULL,
         lease_token = NULL,
         lease_until = NULL,
         terminal_at = COALESCE(terminal_at, now()),
         launch_ciphertext = NULL,
         launch_iv = NULL,
         launch_tag = NULL,
         updated_at = now()
     FROM orders item
     WHERE attempt.id = $1
       AND attempt.status = 'processing'
       AND attempt.lease_token = $2
       AND item.id = attempt.order_id
       AND item.current_payment_attempt_id = attempt.id
     RETURNING attempt.*`,
    [claim.id, claim.leaseToken, reason],
  );
  if (!result.rows[0]) throw staleClaimError();
  return mapPaymentAttempt(result.rows[0]);
}

export async function getCurrentPaymentAttempt(orderId: string, userId?: string) {
  const row = await getCurrentPaymentAttemptRecord(orderId, userId);
  return row ? mapPaymentAttempt(row) : null;
}

export async function getPaymentAttemptByIdempotencyKey(
  orderId: string,
  userId: string,
  idempotencyKey: string,
) {
  const result = await pool.query<PaymentAttemptRow>(
    `SELECT attempt.*
     FROM payment_attempts attempt
     JOIN orders item ON item.id = attempt.order_id
     WHERE attempt.order_id = $1
       AND item.user_id = $2
       AND attempt.idempotency_key = $3
     LIMIT 1`,
    [orderId, userId, idempotencyKey],
  );
  return result.rows[0] ? mapPaymentAttempt(result.rows[0]) : null;
}

export async function getCurrentPaymentAttemptRecord(orderId: string, userId?: string) {
  const result = await pool.query<PaymentAttemptRow>(
    `SELECT attempt.*
     FROM orders item
     JOIN payment_attempts attempt ON attempt.id = item.current_payment_attempt_id
     WHERE item.id = $1 AND ($2::uuid IS NULL OR item.user_id = $2)
     LIMIT 1`,
    [orderId, userId ?? null],
  );
  return result.rows[0] ?? null;
}

export async function getPaymentAttemptByMerchantOrderNo(
  client: DbClient,
  merchantOrderNo: string,
): Promise<PaymentAttemptRow | null> {
  const result = await client.query<PaymentAttemptRow>(
    `SELECT * FROM payment_attempts WHERE merchant_order_no = $1 LIMIT 1`,
    [merchantOrderNo],
  );
  return result.rows[0] ?? null;
}

export async function markPaymentAttemptManualReviewFromProviderEvent(
  client: DbClient,
  attemptId: string,
  reason: string,
) {
  const result = await client.query<PaymentAttemptRow>(
    `UPDATE payment_attempts
     SET status = 'manual-review',
         error = NULL,
         manual_review_reason = $2,
         next_at = NULL,
         lease_token = NULL,
         lease_until = NULL,
         terminal_at = COALESCE(terminal_at, now()),
         launch_ciphertext = NULL,
         launch_iv = NULL,
         launch_tag = NULL,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [attemptId, reason],
  );
  return result.rows[0] ?? null;
}

export async function createPaymentRetryAttempt(
  orderId: string,
  userId: string,
  idempotencyKey: string,
  config: PaymentChannelCredentials,
  returnOrigin: string,
) {
  return withTransaction(async client => {
    if (!config.revisionId) throw publicError('支付通道版本未初始化', 503);
    const orderResult = await client.query<{
      id: string;
      user_id: string;
      amount: number;
      payment_surface: PaymentSurface;
      payment_way_code: PaymentWayCode;
      status: string;
      current_payment_attempt_id: string | null;
    }>('SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE', [orderId, userId]);
    const order = orderResult.rows[0];
    if (!order) throw publicError('订单不存在', 404);
    const duplicate = await client.query<PaymentAttemptRow>(
      'SELECT * FROM payment_attempts WHERE order_id = $1 AND idempotency_key = $2 LIMIT 1',
      [orderId, idempotencyKey],
    );
    if (duplicate.rows[0]) return mapPaymentAttempt(duplicate.rows[0]);
    if (order.status !== 'failed') {
      throw conflictError('只有已确认失败或关闭的订单可以重试支付');
    }
    const current = order.current_payment_attempt_id
      ? await client.query<PaymentAttemptRow>('SELECT * FROM payment_attempts WHERE id = $1 FOR UPDATE', [order.current_payment_attempt_id])
      : null;
    const currentRow = current?.rows[0];
    if (!currentRow || !['closed', 'failed'].includes(currentRow.status)) {
      throw conflictError('当前支付 attempt 不能重试');
    }
    const merchantOrderNo = createPaymentMerchantOrderNo();
    const result = await client.query<PaymentAttemptRow>(
      `INSERT INTO payment_attempts (
         order_id, attempt, idempotency_key, request_hash, merchant_order_no,
         channel_revision_id, amount, surface, way_code, return_origin, status, next_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'queued', now())
       RETURNING *`,
      [
        orderId,
        toInt(currentRow.attempt) + 1,
        idempotencyKey,
        currentRow.request_hash,
        merchantOrderNo,
        config.revisionId,
        order.amount,
        order.payment_surface,
        order.payment_way_code,
        returnOrigin,
      ],
    );
    await client.query(
      `UPDATE orders
       SET status = 'pending', failed_at = NULL, payment_error = NULL,
           merchant_order_no = $2, provider_order_id = NULL,
           current_payment_attempt_id = $3,
           payment_expires_at = now() + ($4 * interval '1 second')
       WHERE id = $1`,
      [orderId, merchantOrderNo, result.rows[0]!.id, env.PAYMENT_ORDER_EXPIRES_SECONDS],
    );
    return mapPaymentAttempt(result.rows[0]!);
  });
}

export async function processDuePaymentAttempts(limit = 20) {
  await pool.query(
    `UPDATE payment_attempts
     SET launch_ciphertext = NULL, launch_iv = NULL, launch_tag = NULL, updated_at = now()
     WHERE terminal_at < now() - interval '24 hours'
       AND (launch_ciphertext IS NOT NULL OR launch_iv IS NOT NULL OR launch_tag IS NOT NULL)`,
  );
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const summary = { claimed: 0, ready: 0, paid: 0, failed: 0, uncertain: 0 };
  for (let index = 0; index < safeLimit; index += 1) {
    const row = await claimNextDuePaymentAttempt();
    if (!row) break;
    summary.claimed += 1;
    const claim: PaymentAttemptClaim = {
      id: row.id,
      orderId: row.order_id,
      merchantOrderNo: row.merchant_order_no,
      channelRevisionId: row.channel_revision_id,
      returnOrigin: row.return_origin,
      leaseToken: row.lease_token!,
      previousStatus: row.previous_status,
      status: 'processing',
    };
    let config: PaymentChannelCredentials;
    try {
      config = await getPaymentChannelCredentialsByRevision(row.channel_revision_id);
    } catch (error) {
      if (isProviderResultMismatch(error)) {
        if (await finishCurrentPaymentClaim(() => markPaymentAttemptManualReviewFromClaim(claim, error.message))) {
          summary.failed += 1;
        }
      } else {
        if (await finishCurrentPaymentClaim(() => markPaymentAttemptUncertain(claim, safeMessage(error)))) {
          summary.uncertain += 1;
        }
      }
      continue;
    }

    if (row.previous_status === 'queued') {
      try {
        const payment = await createPaymentOrder(config, {
          merchantOrderNo: row.merchant_order_no,
          wayCode: row.way_code,
          amount: toInt(row.amount),
          subject: row.plan_name,
          body: `${row.plan_name} ${billingLabel(row.billing)}`,
          localOrderId: row.order_id,
          surface: row.surface,
          returnOrigin: row.return_origin,
        });
        if (payment.mchOrderNo !== row.merchant_order_no || !payment.payOrderId) {
          throw Object.assign(publicError('支付创建响应与本地 attempt 不匹配', 502), {
            code: 'PROVIDER_RESULT_MISMATCH',
          });
        }
        if (payment.orderState !== 2) {
          const launch = normalizePaymentLaunch(payment, config, row.surface);
          await markPaymentAttemptReady(claim, payment.payOrderId, { surface: row.surface, ...launch });
          await pool.query(
            `UPDATE orders SET provider_order_id = $2, payment_error = NULL WHERE id = $1`,
            [row.order_id, payment.payOrderId],
          );
          summary.ready += 1;
          continue;
        }
        // 创建响应声称已支付时仍查单并校验金额/商户字段，不能直接到账。
      } catch (error) {
        if (isProviderResultMismatch(error)) {
          if (await finishCurrentPaymentClaim(() => markPaymentAttemptManualReviewFromClaim(claim, error.message))) {
            summary.failed += 1;
          }
          continue;
        }
        // POST 可能已经被供应商受理；下面始终 query-before-create，不再次 POST。
      }
    }

    try {
      const result = await queryPaymentOrder(config, row.merchant_order_no);
      validatePaymentQuery(row, config, result);
      if (result.state === 2) {
        await markOrderPaid(row.order_id, result.payOrderId, row.id, claim.leaseToken);
        summary.paid += 1;
      } else if ([3, 4, 6].includes(result.state)) {
        await markOrderPaymentTerminalFromClaim(
          row.order_id,
          claim,
          'failed',
          '支付未完成',
          result.payOrderId,
        );
        summary.failed += 1;
      } else {
        await markPaymentAttemptUncertain(claim, '支付状态尚未完成');
        summary.uncertain += 1;
      }
    } catch (error) {
      if (isProviderResultMismatch(error)) {
        if (await finishCurrentPaymentClaim(() => markPaymentAttemptManualReviewFromClaim(claim, error.message))) {
          summary.failed += 1;
        }
      } else if (isPaymentAttemptStaleClaim(error)) {
        continue;
      } else {
        if (await finishCurrentPaymentClaim(() => markPaymentAttemptUncertain(claim, safeMessage(error)))) {
          summary.uncertain += 1;
        }
      }
    }
  }
  return summary;
}

async function claimNextDuePaymentAttempt() {
  const leaseToken = randomUUID();
  const result = await pool.query<DuePaymentAttemptRow>(
    `WITH due AS (
       SELECT attempt.id, attempt.status AS previous_status
       FROM payment_attempts attempt
       JOIN orders item ON item.current_payment_attempt_id = attempt.id
       WHERE item.status = 'pending'
         AND (
           attempt.status IN ('queued', 'uncertain')
           OR (attempt.status = 'processing' AND attempt.lease_until <= now())
         )
         AND COALESCE(attempt.next_at, now()) <= now()
       ORDER BY COALESCE(attempt.next_at, attempt.created_at), attempt.created_at
       FOR UPDATE SKIP LOCKED LIMIT 1
     ), claimed AS (
       UPDATE payment_attempts attempt
       SET status = 'processing', attempts = attempts + 1,
           lease_token = $1, lease_until = now() + interval '60 seconds',
           next_at = NULL, updated_at = now()
       FROM due WHERE attempt.id = due.id
       RETURNING attempt.*, due.previous_status
     )
     SELECT claimed.*, item.plan_name, item.billing, item.status AS order_status
     FROM claimed JOIN orders item ON item.id = claimed.order_id`,
    [leaseToken],
  );
  return result.rows[0] ?? null;
}

function validatePaymentQuery(row: PaymentAttemptRow, config: PaymentChannelCredentials, result: PaymentQueryData) {
  if (
    result.mchOrderNo !== row.merchant_order_no
    || result.mchNo !== config.mchNo
    || result.appId !== config.appId
    || toInt(result.amount) !== toInt(row.amount)
    || result.currency?.toUpperCase() !== 'CNY'
    || (row.provider_order_id && result.payOrderId !== row.provider_order_id)
  ) {
    throw Object.assign(publicError('支付查单结果与本地 attempt 不匹配', 502), {
      code: 'PROVIDER_RESULT_MISMATCH',
    });
  }
}

function billingLabel(value: 'monthly' | 'yearly' | 'one-time') {
  return value === 'yearly' ? '年付' : value === 'monthly' ? '月付' : '一次性购买';
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '支付状态暂时无法确认';
  return message.slice(0, 500);
}

function isProviderResultMismatch(error: unknown): error is Error {
  return error instanceof Error
    && (error as { code?: unknown }).code === 'PROVIDER_RESULT_MISMATCH';
}

export function isPaymentAttemptStaleClaim(error: unknown) {
  return error instanceof Error
    && (error as { code?: unknown }).code === 'PAYMENT_ATTEMPT_STALE_CLAIM';
}

async function finishCurrentPaymentClaim(run: () => Promise<unknown>) {
  try {
    await run();
    return true;
  } catch (error) {
    if (isPaymentAttemptStaleClaim(error)) return false;
    throw error;
  }
}

export function mapPaymentAttempt(row: PaymentAttemptRow, knownLaunch?: PaymentLaunch & { surface: PaymentSurface }) {
  const launch = knownLaunch ?? decryptAttemptLaunch(row);
  return {
    id: row.id,
    attempt: toInt(row.attempt),
    status: row.status,
    launch,
    retryAfterMs: row.next_at ? Math.max(0, new Date(row.next_at).getTime() - Date.now()) : null,
    error: row.error,
    manualReviewReason: row.manual_review_reason,
    createdAt: toIsoDateTime(row.created_at)!,
    updatedAt: toIsoDateTime(row.updated_at)!,
  };
}

async function finishClaim(
  claim: PaymentAttemptClaim,
  status: 'uncertain',
  message: string,
  nextAt: Date | null,
) {
  const result = await pool.query<PaymentAttemptRow>(
    `UPDATE payment_attempts
     SET status = $3,
         error = $4,
         next_at = $5,
         lease_token = NULL,
         lease_until = NULL,
         updated_at = now()
     WHERE id = $1 AND status = 'processing' AND lease_token = $2
     RETURNING *`,
    [claim.id, claim.leaseToken, status, message, nextAt],
  );
  if (!result.rows[0]) throw staleClaimError();
  return mapPaymentAttempt(result.rows[0]);
}

function encryptAttemptLaunch(attemptId: string, launch: PaymentLaunch & { surface: PaymentSurface }) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(attemptId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(launch), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptAttemptLaunch(row: PaymentAttemptRow) {
  if (!row.launch_ciphertext || !row.launch_iv || !row.launch_tag || row.status !== 'ready') return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(row.launch_iv, 'base64'));
    decipher.setAAD(Buffer.from(row.id, 'utf8'));
    decipher.setAuthTag(Buffer.from(row.launch_tag, 'base64'));
    const json = Buffer.concat([
      decipher.update(Buffer.from(row.launch_ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(json) as PaymentLaunch & { surface: PaymentSurface };
  } catch {
    return null;
  }
}

function encryptionKey() {
  if (!env.PAYMENT_CONFIG_ENCRYPTION_KEY) throw publicError('支付通道加密主密钥未配置', 503);
  const key = Buffer.from(env.PAYMENT_CONFIG_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) throw publicError('支付通道加密主密钥格式不正确', 503);
  return key;
}

function staleClaimError() {
  return Object.assign(new Error('支付 attempt 租约已失效'), {
    statusCode: 409,
    code: 'PAYMENT_ATTEMPT_STALE_CLAIM',
    exposeMessage: true,
  });
}

function conflictError(message: string) {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code: 'IDEMPOTENCY_CONFLICT',
    exposeMessage: true,
  });
}

function publicError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode, exposeMessage: true });
}

function createPaymentMerchantOrderNo() {
  return `ord_${randomUUID().replaceAll('-', '').slice(0, 24).toUpperCase()}`;
}
