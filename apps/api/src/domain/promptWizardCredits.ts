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

export function promptWizardHoldEventKey(batchId: string) {
  return `prompt-wizard-hold:${batchId}`;
}

export async function holdPromptWizardCreditsWithClient(input: {
  client: DbClient;
  userId: string;
  batchId: string;
  mainAmount: number;
  addonAmount: number;
}) {
  const eventKey = promptWizardHoldEventKey(input.batchId);
  const total = toInt(input.mainAmount) + toInt(input.addonAmount);
  if (total <= 0) return { eventKey, balance: null as number | null };

  const existing = await input.client.query<{ amount: number | string }>(
    `SELECT amount
     FROM credit_allocations
     WHERE business_event_key = $1 AND related_prompt_batch_id = $2
     FOR UPDATE`,
    [eventKey, input.batchId],
  );
  if (existing.rowCount) {
    const amount = existing.rows.reduce((sum, row) => sum + toInt(row.amount), 0);
    if (amount !== total) throw creditError('提示词向导积分冻结事件金额冲突');
    const synced = await setUserAvailableCreditsWithClient(input.client, input.userId);
    return { eventKey, balance: synced.balance };
  }

  await allocateBucket(input, 'main', toInt(input.mainAmount), eventKey);
  await allocateBucket(input, 'addon', toInt(input.addonAmount), eventKey);
  const synced = await setUserAvailableCreditsWithClient(input.client, input.userId);
  await input.client.query(
    `INSERT INTO credit_ledger (
       user_id, type, bucket, settlement_status, amount, balance, source,
       operator, note, related_prompt_batch_id, business_event_key
     )
     VALUES ($1, 'hold', $2, 'held', $3, $4, '提示词方案生成预扣',
             'system', '正在生成提示词方案，本次生成积分已暂时冻结。', $5, $6)
     ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO NOTHING`,
    [
      input.userId,
      bucketForUsage(input.mainAmount, input.addonAmount),
      -total,
      synced.balance,
      input.batchId,
      eventKey,
    ],
  );
  return { eventKey, balance: synced.balance };
}

export async function settlePromptWizardCreditsWithClient(
  client: DbClient,
  batchId: string,
) {
  const eventKey = promptWizardHoldEventKey(batchId);
  const allocations = await client.query<{
    id: string;
    lot_id: string;
    amount: number | string;
    status: string;
  }>(
    `SELECT id, lot_id, amount, status
     FROM credit_allocations
     WHERE business_event_key = $1 AND related_prompt_batch_id = $2
     ORDER BY id
     FOR UPDATE`,
    [eventKey, batchId],
  );
  if (!allocations.rowCount) throw creditError('提示词向导批次缺少可结算的积分分配');

  for (const allocation of allocations.rows) {
    if (allocation.status === 'settled') continue;
    if (allocation.status !== 'held') throw creditError('提示词向导积分结算状态冲突');
    const amount = toInt(allocation.amount);
    const lot = await client.query(
      `UPDATE credit_lots
       SET held_amount = held_amount - $2,
           consumed_amount = consumed_amount + $2,
           updated_at = now()
       WHERE id = $1 AND held_amount >= $2`,
      [allocation.lot_id, amount],
    );
    if (!lot.rowCount) throw creditError('提示词向导冻结积分不足');
    await client.query(
      `UPDATE credit_allocations
       SET status = 'settled', updated_at = now()
       WHERE id = $1 AND status = 'held'`,
      [allocation.id],
    );
  }
  await client.query(
    `UPDATE credit_ledger
     SET type = 'spend', settlement_status = 'settled',
         source = '提示词方案生成消耗',
         note = '提示词方案已生成，本次生成积分已扣除。'
     WHERE related_prompt_batch_id = $1 AND type = 'hold' AND settlement_status = 'held'`,
    [batchId],
  );
}

export async function releasePromptWizardCreditsWithClient(
  client: DbClient,
  userId: string,
  batchId: string,
) {
  const eventKey = promptWizardHoldEventKey(batchId);
  const batchContext = await client.query<{
    credits: number | string;
    engine_version: number | string;
    replacement_main_expires_at: Date | string | null;
  }>(
    `SELECT batch.credits, run.engine_version,
            CASE
              WHEN credit_user.plan_reset_at::timestamptz > now()
                THEN credit_user.plan_reset_at::timestamptz
              ELSE NULL
            END AS replacement_main_expires_at
     FROM prompt_wizard_batches batch
     JOIN prompt_wizard_runs run ON run.id = batch.run_id
     JOIN users credit_user ON credit_user.id = batch.user_id
     WHERE batch.id = $1 AND batch.user_id = $2
     LIMIT 1
     FOR UPDATE OF batch, credit_user`,
    [batchId, userId],
  );
  const context = batchContext.rows[0];
  const restoreExpiredCredits = toInt(context?.engine_version) === 4;
  const replacementMainExpiresAt = context?.replacement_main_expires_at ?? null;
  const allocations = await client.query<{
    id: string;
    lot_id: string;
    amount: number | string;
    status: string;
    bucket: Bucket;
    expires_at: Date | string | null;
    referral_revoked_at?: Date | string | null;
  }>(
    `SELECT allocation.id, allocation.lot_id, allocation.amount, allocation.status,
            lot.bucket, lot.expires_at, lot.referral_revoked_at
     FROM credit_allocations allocation
     JOIN credit_lots lot ON lot.id = allocation.lot_id
     WHERE allocation.business_event_key = $1
       AND allocation.related_prompt_batch_id = $2
     ORDER BY allocation.id
     FOR UPDATE OF allocation, lot`,
    [eventKey, batchId],
  );
  if (!allocations.rowCount) {
    if (restoreExpiredCredits && toInt(context?.credits) > 0) {
      throw creditError('V6 提示词向导批次缺少可全额退回的积分分配');
    }
    return { returnedCredits: 0, expiredCredits: 0, reissuedCredits: 0 };
  }
  if (restoreExpiredCredits) {
    const allocatedCredits = allocations.rows.reduce((sum, allocation) => sum + toInt(allocation.amount), 0);
    if (allocatedCredits !== toInt(context?.credits)) {
      throw creditError('V6 提示词向导积分分配金额与批次预扣不一致');
    }
  }

  let revokedCredits = 0;
  let mainReturned = 0;
  let addonReturned = 0;
  let expiredCredits = 0;
  let reissuedCredits = 0;
  for (const allocation of allocations.rows) {
    const amount = toInt(allocation.amount);
    if (allocation.status === 'reversed') { revokedCredits += amount; continue; }
    if (allocation.status === 'held' && allocation.referral_revoked_at) {
      await releaseRevokedReferralAllocation(client, allocation);
      revokedCredits += amount;
      continue;
    }
    if (allocation.status === 'released') {
      if (allocation.bucket === 'main') mainReturned += amount;
      else addonReturned += amount;
      continue;
    }
    if (allocation.status === 'expired') {
      if (!restoreExpiredCredits) {
        expiredCredits += amount;
        continue;
      }
      const replacementEventKey = `prompt-wizard-refund-replacement:${batchId}:${allocation.id}`;
      const replacement = await client.query<{
        user_id: string;
        bucket: Bucket;
        original_amount: number | string;
      }>(
        `SELECT user_id, bucket, original_amount
         FROM credit_lots
         WHERE source_event_key = $1
         LIMIT 1
         FOR UPDATE`,
        [replacementEventKey],
      );
      const restored = replacement.rows[0];
      if (
        !restored
        || restored.user_id !== userId
        || restored.bucket !== allocation.bucket
        || toInt(restored.original_amount) !== amount
      ) {
        throw creditError('V6 提示词向导到期积分缺少等额补偿批次');
      }
      reissuedCredits += amount;
      if (allocation.bucket === 'main') mainReturned += amount;
      else addonReturned += amount;
      continue;
    }
    if (allocation.status !== 'held') throw creditError('提示词向导积分释放状态冲突');
    const expired = allocation.expires_at !== null
      && new Date(allocation.expires_at).getTime() <= Date.now();
    const result = await client.query(
      expired
        ? `UPDATE credit_lots
           SET held_amount = held_amount - $2, expired_amount = expired_amount + $2, updated_at = now()
           WHERE id = $1 AND held_amount >= $2`
        : `UPDATE credit_lots
           SET held_amount = held_amount - $2, available_amount = available_amount + $2, updated_at = now()
           WHERE id = $1 AND held_amount >= $2`,
      [allocation.lot_id, amount],
    );
    if (!result.rowCount) throw creditError('提示词向导冻结积分不足');
    await client.query(
      `UPDATE credit_allocations SET status = $2, updated_at = now()
       WHERE id = $1 AND status = 'held'`,
      [allocation.id, expired ? 'expired' : 'released'],
    );
    if (expired && restoreExpiredCredits) {
      const replacementEventKey = `prompt-wizard-refund-replacement:${batchId}:${allocation.id}`;
      const replacement = await client.query<{ id: string }>(
        `INSERT INTO credit_lots (
           user_id, bucket, source_type, source_event_key,
           original_amount, available_amount, expires_at
         )
         VALUES ($1, $2, 'admin-adjustment', $3, $4, $4, $5)
         ON CONFLICT (source_event_key) DO NOTHING
         RETURNING id`,
        [
          userId,
          allocation.bucket,
          replacementEventKey,
          amount,
          allocation.bucket === 'main' ? replacementMainExpiresAt : null,
        ],
      );
      if (!replacement.rowCount) {
        throw creditError('V6 提示词向导到期积分补偿批次冲突');
      }
      reissuedCredits += amount;
      if (allocation.bucket === 'main') mainReturned += amount;
      else addonReturned += amount;
    } else if (expired) {
      expiredCredits += amount;
    } else if (allocation.bucket === 'main') {
      mainReturned += amount;
    } else {
      addonReturned += amount;
    }
  }

  const synced = await setUserAvailableCreditsWithClient(client, userId);
  const returnedCredits = mainReturned + addonReturned;
  if (
    restoreExpiredCredits
    && (returnedCredits + revokedCredits !== toInt(context?.credits) || expiredCredits !== 0)
  ) {
    throw creditError('V6 提示词向导失败批次未能全额恢复冻结积分');
  }
  await client.query(
    `UPDATE credit_ledger
     SET settlement_status = 'refunded',
         note = $2
     WHERE related_prompt_batch_id = $1 AND type = 'hold' AND settlement_status = 'held'`,
    [
      batchId,
      revokedCredits > 0 ? '预扣已解除，其中已撤销的邀约奖励已追回，其余积分已退回。' : reissuedCredits > 0
        ? '提示词方案生成失败，预扣已解除；生成期间到期的积分已通过等额补偿批次恢复。'
        : expiredCredits > 0
        ? '提示词方案生成失败，预扣已解除；原批次中已过期的积分未恢复。'
        : '提示词方案生成失败，本次预扣已解除。',
    ],
  );
  await client.query(
    `INSERT INTO credit_ledger (
       user_id, type, bucket, settlement_status, amount, balance,
       source, operator, note, related_prompt_batch_id, business_event_key
     )
     VALUES ($1, 'refund', $2, 'refunded', $3, $4,
             '提示词方案生成退回', 'system', $5, $6, $7)
     ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO NOTHING`,
    [
      userId,
      bucketForUsage(mainReturned, addonReturned),
      returnedCredits,
      synced.balance,
      revokedCredits > 0 ? '预扣已解除，其中已撤销的邀约奖励已追回，其余积分已退回。' : reissuedCredits > 0
        ? '提示词方案生成失败，本次预扣积分已全额退回；生成期间到期的积分已通过等额补偿批次恢复。'
        : expiredCredits > 0
        ? '提示词方案生成失败，未过期的预扣积分已退回；已过期积分未重新计入账户。'
        : '提示词方案生成失败，本次预扣积分已退回账户。',
      batchId,
      `prompt-wizard-refund:${batchId}`,
    ],
  );
  return { returnedCredits, expiredCredits, reissuedCredits };
}

async function allocateBucket(
  input: Parameters<typeof holdPromptWizardCreditsWithClient>[0],
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
    const allocated = Math.min(remaining, toInt(lot.available_amount));
    if (allocated <= 0) continue;
    const updated = await input.client.query(
      `UPDATE credit_lots
       SET available_amount = available_amount - $2,
           held_amount = held_amount + $2,
           updated_at = now()
       WHERE id = $1 AND available_amount >= $2`,
      [lot.id, allocated],
    );
    if (!updated.rowCount) throw creditError('提示词向导积分批次被并发修改');
    await input.client.query(
      `INSERT INTO credit_allocations (
         user_id, lot_id, business_event_key, purpose, status, amount, related_prompt_batch_id
       ) VALUES ($1, $2, $3, 'prompt-wizard', 'held', $4, $5)`,
      [input.userId, lot.id, eventKey, allocated, input.batchId],
    );
    remaining -= allocated;
  }
  if (remaining > 0) throw insufficientCreditsError(remaining);
}

export function bucketForUsage(mainAmount: number, addonAmount: number) {
  if (mainAmount > 0 && addonAmount > 0) return 'mixed';
  if (mainAmount > 0) return 'main';
  if (addonAmount > 0) return 'addon';
  return 'system';
}

function insufficientCreditsError(missing: number) {
  return Object.assign(new Error(`积分不足，还差 ${missing} 积分`), {
    statusCode: 400,
    code: 'INSUFFICIENT_CREDITS',
  });
}

function creditError(message: string) {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code: 'PROMPT_WIZARD_CREDIT_INVARIANT_VIOLATION',
  });
}
