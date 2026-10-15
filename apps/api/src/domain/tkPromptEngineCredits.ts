import { releaseRevokedReferralAllocation } from './referrals.js';
import type { DbClient } from '../db/pool.js';
import { setUserAvailableCreditsWithClient } from './financialCredits.js';
import { toInt } from './serialization.js';

type Bucket = 'main' | 'addon';

interface LotRow {
  id: string;
  bucket: Bucket;
  available_amount: number | string;
  expires_at: Date | string | null;
}

interface RefundAllocationRow {
  id: string;
  lot_id: string;
  amount: number | string;
  status: string;
  allocation_user_id: string;
  lot_user_id: string;
  bucket: Bucket;
  is_expired: boolean;
  referral_revoked_at?: Date | string | null;
}

export function tkPromptCreditHoldKey(generationId: string) {
  return `tk-prompt-engine-hold:${generationId}`;
}

export async function holdTkPromptCreditsWithClient(input: {
  client: DbClient;
  userId: string;
  generationId: string;
  mainAmount: number;
  addonAmount: number;
}) {
  const total = toInt(input.mainAmount) + toInt(input.addonAmount);
  if (total <= 0) return;
  const eventKey = tkPromptCreditHoldKey(input.generationId);
  await allocate(input, 'main', toInt(input.mainAmount), eventKey);
  await allocate(input, 'addon', toInt(input.addonAmount), eventKey);
  const synced = await setUserAvailableCreditsWithClient(input.client, input.userId);
  await input.client.query(
    `INSERT INTO credit_ledger (
       user_id, type, bucket, settlement_status, amount, balance, source,
       operator, note, related_tk_prompt_generation_id, business_event_key
     ) VALUES ($1, 'hold', $2, 'held', $3, $4, 'TK Prompt Engine方案生成预扣',
               'system', '正在生成三套方案，本次积分已暂时冻结。', $5, $6)
     ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO NOTHING`,
    [
      input.userId,
      bucketForUsage(input.mainAmount, input.addonAmount),
      -total,
      synced.balance,
      input.generationId,
      eventKey,
    ],
  );
}

export async function settleTkPromptCreditsWithClient(
  client: DbClient,
  generationId: string,
) {
  const allocations = await client.query<{
    id: string;
    lot_id: string;
    amount: number | string;
    status: string;
  }>(
    `SELECT id, lot_id, amount, status
     FROM credit_allocations
     WHERE business_event_key = $1 AND related_tk_prompt_generation_id = $2
     ORDER BY id FOR UPDATE`,
    [tkPromptCreditHoldKey(generationId), generationId],
  );
  if (!allocations.rowCount) throw creditError('TK Prompt Engine缺少可结算积分分配');
  for (const allocation of allocations.rows) {
    if (allocation.status === 'settled') continue;
    if (allocation.status !== 'held') throw creditError('TK Prompt Engine积分结算状态冲突');
    const amount = toInt(allocation.amount);
    const updated = await client.query(
      `UPDATE credit_lots
       SET held_amount = held_amount - $2, consumed_amount = consumed_amount + $2,
           updated_at = now()
       WHERE id = $1 AND held_amount >= $2`,
      [allocation.lot_id, amount],
    );
    if (!updated.rowCount) throw creditError('TK Prompt Engine冻结积分不足');
    await client.query(
      `UPDATE credit_allocations SET status = 'settled', updated_at = now()
       WHERE id = $1 AND status = 'held'`,
      [allocation.id],
    );
  }
  await client.query(
    `UPDATE credit_ledger
     SET type = 'spend', settlement_status = 'settled',
         source = 'TK Prompt Engine方案生成消耗',
         note = '三套方案已原子生成，本次积分已扣除。'
     WHERE related_tk_prompt_generation_id = $1
       AND type = 'hold' AND settlement_status = 'held'`,
    [generationId],
  );
}

export async function releaseTkPromptCreditsWithClient(
  client: DbClient,
  userId: string,
  generationId: string,
) {
  const generationContext = await client.query<{
    credits: number | string;
    replacement_main_expires_at: Date | string | null;
  }>(
    `SELECT generation.credits,
            CASE
              WHEN credit_user.plan_reset_at::timestamptz > clock_timestamp()
                THEN credit_user.plan_reset_at::timestamptz
              ELSE NULL
            END AS replacement_main_expires_at
     FROM tk_prompt_generations generation
     JOIN users credit_user ON credit_user.id = generation.user_id
     WHERE generation.id = $1 AND generation.user_id = $2
     LIMIT 1
     FOR UPDATE OF generation, credit_user`,
    [generationId, userId],
  );
  const context = generationContext.rows[0];
  if (!context) throw creditError('TK Prompt Engine退款批次不存在');
  const expectedCredits = toInt(context.credits);
  const allocations = await client.query<RefundAllocationRow>(
    `SELECT allocation.id, allocation.lot_id, allocation.amount, allocation.status,
            allocation.user_id AS allocation_user_id,
            lot.user_id AS lot_user_id,
            lot.bucket, lot.referral_revoked_at,
            lot.expires_at IS NOT NULL
              AND lot.expires_at <= clock_timestamp() AS is_expired
     FROM credit_allocations allocation
     JOIN credit_lots lot ON lot.id = allocation.lot_id
     WHERE allocation.business_event_key = $1
       AND allocation.related_tk_prompt_generation_id = $2
       AND allocation.user_id = $3
       AND lot.user_id = $3
     ORDER BY allocation.id FOR UPDATE OF allocation, lot`,
    [tkPromptCreditHoldKey(generationId), generationId, userId],
  );
  const allocatedCredits = allocations.rows.reduce(
    (sum, allocation) => sum + toInt(allocation.amount),
    0,
  );
  if (allocatedCredits !== expectedCredits) {
    throw creditError('TK Prompt Engine积分分配金额与整批冻结积分不一致');
  }

  let revoked = 0;
  let returned = 0;
  let compensated = 0;
  let mainRestored = 0;
  let addonRestored = 0;
  for (const allocation of allocations.rows) {
    if (allocation.allocation_user_id !== userId || allocation.lot_user_id !== userId) {
      throw creditError('TK Prompt Engine积分分配用户归属不一致');
    }
    const amount = toInt(allocation.amount);
    if (allocation.status === 'reversed') { revoked += amount; continue; }
    if (allocation.status === 'held' && allocation.referral_revoked_at) {
      await releaseRevokedReferralAllocation(client, allocation);
      revoked += amount;
      continue;
    }
    if (allocation.status === 'released') {
      returned += amount;
      if (allocation.bucket === 'main') mainRestored += amount;
      else addonRestored += amount;
      continue;
    }
    if (allocation.status === 'expired') {
      await assertReplacementLot({
        client,
        userId,
        generationId,
        allocationId: allocation.id,
        bucket: allocation.bucket,
        amount,
      });
      compensated += amount;
      if (allocation.bucket === 'main') mainRestored += amount;
      else addonRestored += amount;
      continue;
    }
    if (allocation.status !== 'held') throw creditError('TK Prompt Engine积分退回状态冲突');
    const updated = await client.query(
      allocation.is_expired
        ? `UPDATE credit_lots
           SET held_amount = held_amount - $2, expired_amount = expired_amount + $2,
               updated_at = now()
           WHERE id = $1 AND held_amount >= $2`
        : `UPDATE credit_lots
           SET held_amount = held_amount - $2, available_amount = available_amount + $2,
               updated_at = now()
           WHERE id = $1 AND held_amount >= $2`,
      [allocation.lot_id, amount],
    );
    if (!updated.rowCount) throw creditError('TK Prompt Engine冻结积分不足');
    await client.query(
      `UPDATE credit_allocations SET status = $2, updated_at = now()
       WHERE id = $1 AND status = 'held'`,
      [allocation.id, allocation.is_expired ? 'expired' : 'released'],
    );
    if (allocation.is_expired) {
      const replacementEventKey = replacementLotEventKey(generationId, allocation.id);
      const replacement = await client.query<{ id: string }>(
        `INSERT INTO credit_lots (
           user_id, bucket, source_type, source_event_key,
           original_amount, available_amount, expires_at
         ) VALUES ($1, $2, 'tk-prompt-engine-refund', $3, $4, $4, $5)
         ON CONFLICT (source_event_key) DO NOTHING
         RETURNING id`,
        [
          userId,
          allocation.bucket,
          replacementEventKey,
          amount,
          allocation.bucket === 'main' ? context.replacement_main_expires_at : null,
        ],
      );
      if (!replacement.rowCount) {
        await assertReplacementLot({
          client,
          userId,
          generationId,
          allocationId: allocation.id,
          bucket: allocation.bucket,
          amount,
        });
      }
      compensated += amount;
    } else {
      returned += amount;
    }
    if (allocation.bucket === 'main') mainRestored += amount;
    else addonRestored += amount;
  }
  if (returned + compensated + revoked !== expectedCredits) {
    throw creditError('TK Prompt Engine失败批次未能全额恢复冻结积分');
  }
  const synced = await setUserAvailableCreditsWithClient(client, userId);
  await client.query(
    `UPDATE credit_ledger
     SET settlement_status = 'refunded',
         note = $2
     WHERE related_tk_prompt_generation_id = $1
       AND type = 'hold' AND settlement_status = 'held'`,
    [
      generationId,
      revoked > 0 ? '预扣已解除，其中已撤销的邀约奖励已追回，其余积分已退回。' : compensated > 0
        ? '三套方案未完整生成，预扣已解除；生成期间到期的积分已通过等额补偿批次恢复。'
        : '三套方案未完整生成，预扣已全额解除。',
    ],
  );
  await client.query(
    `INSERT INTO credit_ledger (
       user_id, type, bucket, settlement_status, amount, balance, source,
       operator, note, related_tk_prompt_generation_id, business_event_key
     ) VALUES ($1, 'refund', $2, 'refunded', $3, $4,
               'TK Prompt Engine方案生成退回', 'system',
               $5, $6, $7)
     ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO NOTHING`,
    [
      userId,
      bucketForUsage(mainRestored, addonRestored),
      returned + compensated,
      synced.balance,
      revoked > 0 ? '预扣已解除，其中已撤销的邀约奖励已追回，其余积分已退回。' : compensated > 0
        ? '三套方案未完整生成，预扣积分已全额恢复；生成期间到期部分已通过等额补偿批次恢复。'
        : '三套方案未完整生成，预扣积分已全额退回账户。',
      generationId,
      `tk-prompt-engine-refund:${generationId}`,
    ],
  );
  return { returned, compensated, ...(revoked > 0 ? { revoked } : {}) };
}

function replacementLotEventKey(generationId: string, allocationId: string) {
  return `tk-prompt-engine-refund-replacement:${generationId}:${allocationId}`;
}

async function assertReplacementLot(input: {
  client: DbClient;
  userId: string;
  generationId: string;
  allocationId: string;
  bucket: Bucket;
  amount: number;
}) {
  const replacement = await input.client.query<{
    user_id: string;
    bucket: Bucket;
    source_type: string;
    original_amount: number | string;
    available_amount: number | string;
  }>(
    `SELECT user_id, bucket, source_type, original_amount, available_amount
     FROM credit_lots
     WHERE source_event_key = $1
     LIMIT 1
     FOR UPDATE`,
    [replacementLotEventKey(input.generationId, input.allocationId)],
  );
  const row = replacement.rows[0];
  if (
    !row
    || row.user_id !== input.userId
    || row.bucket !== input.bucket
    || row.source_type !== 'tk-prompt-engine-refund'
    || toInt(row.original_amount) !== input.amount
    || toInt(row.available_amount) > input.amount
  ) {
    throw creditError('TK Prompt Engine到期积分缺少等额补偿批次');
  }
}

async function allocate(
  input: Parameters<typeof holdTkPromptCreditsWithClient>[0],
  bucket: Bucket,
  amount: number,
  eventKey: string,
) {
  if (amount <= 0) return;
  const lots = await input.client.query<LotRow>(
    `SELECT id, bucket, available_amount, expires_at
     FROM credit_lots
     WHERE user_id = $1 AND bucket = $2 AND available_amount > 0
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY CASE WHEN $2 = 'main' THEN expires_at END ASC NULLS LAST,
              created_at ASC, id ASC
     FOR UPDATE`,
    [input.userId, bucket],
  );
  let remaining = amount;
  for (const lot of lots.rows) {
    if (remaining <= 0) break;
    const used = Math.min(remaining, toInt(lot.available_amount));
    if (used <= 0) continue;
    const updated = await input.client.query(
      `UPDATE credit_lots
       SET available_amount = available_amount - $2, held_amount = held_amount + $2,
           updated_at = now()
       WHERE id = $1 AND available_amount >= $2`,
      [lot.id, used],
    );
    if (!updated.rowCount) throw creditError('TK Prompt Engine积分批次被并发修改');
    await input.client.query(
      `INSERT INTO credit_allocations (
         user_id, lot_id, business_event_key, purpose, status, amount,
         related_tk_prompt_generation_id
       ) VALUES ($1, $2, $3, 'tk-prompt-engine', 'held', $4, $5)`,
      [input.userId, lot.id, eventKey, used, input.generationId],
    );
    remaining -= used;
  }
  if (remaining > 0) {
    throw Object.assign(new Error(`积分不足，还差 ${remaining} 积分`), {
      statusCode: 400,
      code: 'INSUFFICIENT_CREDITS',
    });
  }
}

function bucketForUsage(main: number, addon: number) {
  if (main > 0 && addon > 0) return 'mixed';
  if (main > 0) return 'main';
  if (addon > 0) return 'addon';
  return 'system';
}

function creditError(message: string) {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code: 'TK_PROMPT_CREDIT_INVARIANT_VIOLATION',
  });
}
