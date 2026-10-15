import type { DbClient } from '../db/pool.js';
import { creditLedgerNotes, orderPaymentCreditNote } from './creditLedgerNotes.js';
import { toInt } from './serialization.js';

export type FinancialCreditBucket = 'main' | 'addon';

interface CreditUserRow {
  main_credits: number;
  addon_credits: number;
  active_subscription_order_id?: string | null;
}

interface OrderCreditInput {
  id: string;
  userId: string;
  kind: 'main' | 'addon';
  planName: string;
  creditAmount: number;
  creditBucket: 'main' | 'addon' | 'mixed' | 'system';
  lotExpiresAt?: Date | string | null;
}

interface CreditLotRow {
  id: string;
  bucket: FinancialCreditBucket;
  source_type: 'order' | 'subscription-cycle' | 'admin-adjustment' | 'legacy' | 'tk-prompt-engine-refund' | 'referral-reward';
  original_amount: number;
  available_amount: number;
  held_amount: number;
  consumed_amount: number;
  expired_amount: number;
  reversed_amount: number;
}

/** 从批次真相重建用户可用积分缓存；调用方不得自行写三个缓存字段。 */
export async function setUserAvailableCreditsWithClient(client: DbClient, userId: string) {
  const lots = await client.query<{ main_credits: number; addon_credits: number }>(
    `SELECT
       COALESCE(sum(available_amount) FILTER (WHERE bucket = 'main'), 0)::integer AS main_credits,
       COALESCE(sum(available_amount) FILTER (WHERE bucket = 'addon'), 0)::integer AS addon_credits
     FROM credit_lots
     WHERE user_id = $1`,
    [userId],
  );
  const mainCredits = toInt(lots.rows[0]?.main_credits);
  const addonCredits = toInt(lots.rows[0]?.addon_credits);
  const balance = mainCredits + addonCredits;
  const updated = await client.query(
    `UPDATE users
     SET main_credits = $2, addon_credits = $3, total_credits = $4, updated_at = now()
     WHERE id = $1`,
    [userId, mainCredits, addonCredits, balance],
  );
  if (!updated.rowCount) throw manualReviewError('积分用户不存在，拒绝写入孤立批次');
  return { mainCredits, addonCredits, balance };
}

/**
 * 为已支付订单创建可追踪积分批次。source_event_key 和流水事件键共同保证重复通知不会重复到账。
 * 调用方必须已经锁定订单和用户行。
 */
export async function creditPaidOrderWithClient(
  client: DbClient,
  order: OrderCreditInput,
  user: CreditUserRow,
) {
  const bucket = requireOrderBucket(order.creditBucket);
  const amount = toInt(order.creditAmount);
  const eventKey = `order-credit:${order.id}`;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO credit_lots (
       user_id, bucket, source_type, source_order_id, source_event_key,
       original_amount, available_amount, expires_at
     )
     VALUES ($1, $2, 'order', $3, $4, $5, $5,
       CASE WHEN $2 = 'main' THEN $6::timestamptz ELSE NULL END)
     ON CONFLICT (source_event_key) DO NOTHING
     RETURNING id`,
    [order.userId, bucket, order.id, eventKey, amount, order.lotExpiresAt ?? null],
  );
  if (!inserted.rowCount) {
    return {
      mainCredits: toInt(user.main_credits),
      addonCredits: toInt(user.addon_credits),
      balance: toInt(user.main_credits) + toInt(user.addon_credits),
      transitioned: false,
    };
  }

  const { mainCredits, addonCredits, balance } = await setUserAvailableCreditsWithClient(client, order.userId);
  await client.query(
    `INSERT INTO credit_ledger (
       user_id, type, bucket, settlement_status, amount, balance,
       source, operator, note, related_order_id, business_event_key
     )
     VALUES ($1, 'earn', $2, 'settled', $3, $4,
             '订单支付到账', 'system', $5, $6, $7)
     ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO NOTHING`,
    [order.userId, bucket, amount, balance, orderPaymentCreditNote(order.planName), order.id, eventKey],
  );
  return { mainCredits, addonCredits, balance, transitioned: true };
}

/**
 * 退款前冻结“该订单实际到账的 lot”。历史 legacy lot 或已经发生消费/过期的 lot 不允许自动退款。
 */
export async function holdOrderCreditsForRefundWithClient(
  client: DbClient,
  order: OrderCreditInput,
  user: CreditUserRow,
  merchantRefundNo: string,
  operator: string,
) {
  const bucket = requireOrderBucket(order.creditBucket);
  const amount = toInt(order.creditAmount);
  if (order.kind === 'main' && user.active_subscription_order_id !== order.id) {
    throw manualReviewError('主套餐已发生后续变更，不能自动回滚，请人工核对');
  }
  const lotResult = await client.query<CreditLotRow>(
    `SELECT id, bucket, source_type, original_amount, available_amount, held_amount,
            consumed_amount, expired_amount, reversed_amount
     FROM credit_lots
     WHERE source_order_id = $1 AND user_id = $2
     LIMIT 1
     FOR UPDATE`,
    [order.id, order.userId],
  );
  const lot = lotResult.rows[0];
  if (
    !lot
    || lot.source_type !== 'order'
    || lot.bucket !== bucket
    || toInt(lot.original_amount) !== amount
    || toInt(lot.available_amount) !== amount
    || toInt(lot.held_amount) !== 0
    || toInt(lot.consumed_amount) !== 0
    || toInt(lot.expired_amount) !== 0
    || toInt(lot.reversed_amount) !== 0
  ) {
    throw manualReviewError('该订单积分已被消费、冻结、过期或无法可靠归属，请人工核对');
  }

  const eventKey = `order-refund-hold:${merchantRefundNo}`;
  await client.query(
    `UPDATE credit_lots
     SET available_amount = available_amount - $2,
         held_amount = held_amount + $2,
         updated_at = now()
     WHERE id = $1`,
    [lot.id, amount],
  );
  await client.query(
    `INSERT INTO credit_allocations (
       user_id, lot_id, business_event_key, purpose, status, amount, related_order_id
     )
     VALUES ($1, $2, $3, 'refund', 'held', $4, $5)`,
    [order.userId, lot.id, eventKey, amount, order.id],
  );

  const mainCredits = toInt(user.main_credits) - (bucket === 'main' ? amount : 0);
  const addonCredits = toInt(user.addon_credits) - (bucket === 'addon' ? amount : 0);
  if (mainCredits < 0 || addonCredits < 0) {
    throw manualReviewError('账户积分汇总与订单批次不一致，请人工核对');
  }
  const balance = mainCredits + addonCredits;
  const synced = await setUserAvailableCreditsWithClient(client, order.userId);
  if (synced.mainCredits !== mainCredits || synced.addonCredits !== addonCredits) {
    throw manualReviewError('账户积分汇总与订单批次不一致，请人工核对');
  }
  const ledger = await client.query<{ id: string }>(
    `INSERT INTO credit_ledger (
       user_id, type, bucket, settlement_status, amount, balance,
       source, operator, note, related_order_id, business_event_key
     )
     VALUES ($1, 'hold', $2, 'held', $3, $4,
             '退款积分预留', $5, $6, $7, $8)
     ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL
     DO UPDATE SET business_event_key = EXCLUDED.business_event_key
     RETURNING id`,
    [
      order.userId,
      bucket,
      -amount,
      balance,
      operator,
      creditLedgerNotes.orderRefundPending,
      order.id,
      eventKey,
    ],
  );
  return { ledgerId: ledger.rows[0]!.id, allocationEventKey: eventKey, ...synced };
}

export async function releaseOrderRefundHoldWithClient(
  client: DbClient,
  order: OrderCreditInput,
  merchantRefundNo: string,
) {
  const eventKey = `order-refund-hold:${merchantRefundNo}`;
  const allocation = await client.query<{ id: string; lot_id: string; amount: number; status: string }>(
    `SELECT id, lot_id, amount, status
     FROM credit_allocations
     WHERE business_event_key = $1 AND related_order_id = $2
     LIMIT 1 FOR UPDATE`,
    [eventKey, order.id],
  );
  const row = allocation.rows[0];
  if (!row || row.status === 'released') return false;
  if (row.status !== 'held') throw manualReviewError('退款积分冻结状态冲突，请人工核对');

  const amount = toInt(row.amount);
  const bucket = requireOrderBucket(order.creditBucket);
  const lotUpdate = await client.query(
    `UPDATE credit_lots
     SET held_amount = held_amount - $2,
         available_amount = available_amount + $2,
         updated_at = now()
     WHERE id = $1 AND held_amount >= $2`,
    [row.lot_id, amount],
  );
  if (!lotUpdate.rowCount) throw manualReviewError('退款积分批次冻结余额冲突，请人工核对');
  await client.query(
    `UPDATE credit_allocations SET status = 'released', updated_at = now() WHERE id = $1 AND status = 'held'`,
    [row.id],
  );
  const { balance } = await setUserAvailableCreditsWithClient(client, order.userId);
  await client.query(
    `INSERT INTO credit_ledger (
       user_id, type, bucket, settlement_status, amount, balance,
       source, operator, note, related_order_id, business_event_key
     ) VALUES ($1, 'refund', $2, 'refunded', $3, $4,
               '退款失败退回', 'system', $5, $6, $7)
     ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO NOTHING`,
    [
      order.userId,
      bucket,
      amount,
      balance,
      creditLedgerNotes.orderRefundFailedCreditsReturned,
      order.id,
      `order-refund-release:${merchantRefundNo}`,
    ],
  );
  return true;
}

export async function reverseOrderRefundHoldWithClient(
  client: DbClient,
  orderId: string,
  merchantRefundNo: string,
) {
  const eventKey = `order-refund-hold:${merchantRefundNo}`;
  const allocation = await client.query<{ id: string; lot_id: string; amount: number; status: string }>(
    `SELECT id, lot_id, amount, status
     FROM credit_allocations
     WHERE business_event_key = $1 AND related_order_id = $2
     LIMIT 1 FOR UPDATE`,
    [eventKey, orderId],
  );
  const row = allocation.rows[0];
  if (!row || row.status === 'reversed') return false;
  if (row.status !== 'held') throw manualReviewError('退款成功但积分冻结状态冲突，请人工核对');
  const lotUpdate = await client.query(
    `UPDATE credit_lots
     SET held_amount = held_amount - $2,
         reversed_amount = reversed_amount + $2,
         updated_at = now()
     WHERE id = $1 AND held_amount >= $2`,
    [row.lot_id, toInt(row.amount)],
  );
  if (!lotUpdate.rowCount) throw manualReviewError('退款成功但积分批次冻结余额冲突，请人工核对');
  await client.query(
    `UPDATE credit_allocations SET status = 'reversed', updated_at = now() WHERE id = $1 AND status = 'held'`,
    [row.id],
  );
  return true;
}

/** 按主积分最早到期、加购积分最早获得的顺序调整批次。 */
export async function adjustCreditLotsWithClient(
  client: DbClient,
  input: {
    userId: string;
    bucket: FinancialCreditBucket;
    delta: number;
    eventKey: string;
    expiresAt?: Date | string | null;
  },
) {
  const delta = Math.trunc(input.delta);
  if (delta === 0) return;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`credit-adjust:${input.eventKey}`]);
  if (delta > 0) {
    await client.query(
      `INSERT INTO credit_lots (
         user_id, bucket, source_type, source_event_key,
         original_amount, available_amount, expires_at
       )
       VALUES ($1, $2, 'admin-adjustment', $3, $4, $4, $5)
       ON CONFLICT (source_event_key) DO NOTHING`,
      [input.userId, input.bucket, input.eventKey, delta, input.expiresAt ?? null],
    );
    return;
  }

  const replay = await client.query<{
    amount: number;
    status: string;
    user_id: string;
    bucket: FinancialCreditBucket;
  }>(
    `SELECT allocation.amount, allocation.status, allocation.user_id, lot.bucket
     FROM credit_allocations allocation
     JOIN credit_lots lot ON lot.id = allocation.lot_id
     WHERE allocation.business_event_key = $1
       AND allocation.purpose = 'adjustment'
     FOR UPDATE OF allocation`,
    [input.eventKey],
  );
  if (replay.rows.length > 0) {
    const replayedAmount = replay.rows.reduce((sum, row) => sum + toInt(row.amount), 0);
    const validReplay = replay.rows.every(row => (
      row.user_id === input.userId
      && row.bucket === input.bucket
      && row.status === 'settled'
    ));
    if (!validReplay || replayedAmount !== Math.abs(delta)) {
      throw manualReviewError('积分调整幂等键对应的历史分配与本次请求不一致');
    }
    return;
  }

  let remaining = Math.abs(delta);
  const lots = await client.query<{ id: string; available_amount: number }>(
    `SELECT id, available_amount
     FROM credit_lots
     WHERE user_id = $1 AND bucket = $2 AND available_amount > 0
     ORDER BY
       CASE WHEN $2 = 'main' THEN expires_at END ASC NULLS LAST,
       created_at ASC, id ASC
     FOR UPDATE`,
    [input.userId, input.bucket],
  );
  for (const lot of lots.rows) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, toInt(lot.available_amount));
    const changed = await client.query(
      `UPDATE credit_lots
       SET available_amount = available_amount - $2,
           consumed_amount = consumed_amount + $2,
           updated_at = now()
       WHERE id = $1 AND available_amount >= $2`,
      [lot.id, amount],
    );
    if (!changed.rowCount) throw manualReviewError('积分批次并发变更，请重试');
    await client.query(
      `INSERT INTO credit_allocations (
         user_id, lot_id, business_event_key, purpose, status, amount
       ) VALUES ($1, $2, $3, 'adjustment', 'settled', $4)`,
      [input.userId, lot.id, input.eventKey, amount],
    );
    remaining -= amount;
  }
  if (remaining > 0) throw manualReviewError('积分批次余额不足，拒绝产生缓存与批次不一致');
}

/**
 * 周期边界只过期可用主积分；仍由任务冻结的额度保持原 lot 归属，后续释放时由生成服务判定为过期。
 */
export async function replaceSubscriptionMainLotWithClient(
  client: DbClient,
  input: {
    userId: string;
    expectedAvailable: number;
    nextAmount: number;
    cycleEventKey: string;
    nextExpiresAt?: Date | string | null;
  },
) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`subscription-lot:${input.cycleEventKey}`]);
  const replay = await client.query<CreditLotRow & { user_id: string; source_event_key: string }>(
    `SELECT id, user_id, bucket, source_type, source_event_key,
            original_amount, available_amount, held_amount,
            consumed_amount, expired_amount, reversed_amount
     FROM credit_lots
     WHERE source_event_key = $1
     LIMIT 1 FOR UPDATE`,
    [input.cycleEventKey],
  );
  const replayedLot = replay.rows[0];
  if (replayedLot) {
    if (
      replayedLot.user_id !== input.userId
      || replayedLot.bucket !== 'main'
      || replayedLot.source_type !== 'subscription-cycle'
      || toInt(replayedLot.original_amount) !== toInt(input.nextAmount)
    ) {
      throw manualReviewError('订阅周期幂等键对应的积分批次与本次请求不一致');
    }
    return;
  }

  const lots = await client.query<{ available_amount: number }>(
    `SELECT available_amount
     FROM credit_lots
     WHERE user_id = $1 AND bucket = 'main'
     FOR UPDATE`,
    [input.userId],
  );
  const available = lots.rows.reduce((sum, lot) => sum + toInt(lot.available_amount), 0);
  if (available !== toInt(input.expectedAvailable)) {
    throw manualReviewError('主积分缓存与批次不一致，暂停周期重置');
  }
  await client.query(
    `UPDATE credit_lots
     SET expired_amount = expired_amount + available_amount,
         available_amount = 0,
         updated_at = now()
     WHERE user_id = $1 AND bucket = 'main' AND available_amount > 0`,
    [input.userId],
  );
  await client.query(
    `INSERT INTO credit_lots (
       user_id, bucket, source_type, source_event_key,
       original_amount, available_amount, expires_at
     ) VALUES ($1, 'main', 'subscription-cycle', $2, $3, $3, $4)`,
    [input.userId, input.cycleEventKey, input.nextAmount, input.nextExpiresAt ?? null],
  );
}

function requireOrderBucket(bucket: OrderCreditInput['creditBucket']): FinancialCreditBucket {
  if (bucket !== 'main' && bucket !== 'addon') {
    throw manualReviewError('订单积分桶无法自动处理，请人工核对');
  }
  return bucket;
}

function manualReviewError(message: string) {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code: 'FINANCIAL_MANUAL_REVIEW_REQUIRED',
    exposeMessage: true,
  });
}
