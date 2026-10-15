import { releaseRevokedReferralAllocation } from './referrals.js';
import type { DbClient } from '../db/pool.js';
import { toInt } from './serialization.js';

type Bucket = 'main' | 'addon';

interface LotRow {
  id: string;
  bucket: Bucket;
  available_amount: number;
  held_amount: number;
  expires_at: Date | string | null;
}

/** 在同一事务锁定可用 lot，并按主积分 FEFO、加购积分 FIFO 规划一批任务。 */
export async function planGenerationLotAllocationsWithClient(
  client: DbClient,
  userId: string,
  amounts: number[],
) {
  const lots = await client.query<LotRow>(
    `SELECT id, bucket, available_amount, held_amount, expires_at
     FROM credit_lots
     WHERE user_id = $1 AND available_amount > 0
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY CASE WHEN bucket = 'main' THEN 0 ELSE 1 END,
              CASE WHEN bucket = 'main' THEN expires_at END ASC NULLS LAST,
              created_at ASC, id ASC
     FOR UPDATE`,
    [userId],
  );
  const remainingByLot = new Map(lots.rows.map(lot => [lot.id, toInt(lot.available_amount)]));
  return amounts.map(rawAmount => {
    let remaining = toInt(rawAmount);
    let mainAmount = 0;
    let addonAmount = 0;
    for (const lot of lots.rows) {
      if (remaining <= 0) break;
      const available = remainingByLot.get(lot.id) ?? 0;
      const allocated = Math.min(available, remaining);
      if (allocated <= 0) continue;
      remainingByLot.set(lot.id, available - allocated);
      if (lot.bucket === 'main') mainAmount += allocated;
      else addonAmount += allocated;
      remaining -= allocated;
    }
    if (remaining > 0) throw creditInvariantError(`当前可用积分不足，还差 ${remaining} 积分`);
    return { mainAmount, addonAmount };
  });
}

export function generationHoldEventKey(taskId: string, attempt: number) {
  return `generation-hold:${taskId}:${attempt}`;
}

/**
 * 按主积分最早到期、加购积分最早取得的顺序冻结 lot。users 的可用桶由调用方在
 * 同一事务扣减；这里负责可审计的批次归属和重复事件校验。
 */
export async function holdGenerationLotsWithClient(input: {
  client: DbClient;
  userId: string;
  taskId: string;
  attempt: number;
  mainAmount: number;
  addonAmount: number;
  eventKey?: string;
}) {
  const eventKey = input.eventKey ?? generationHoldEventKey(input.taskId, input.attempt);
  const expected = toInt(input.mainAmount) + toInt(input.addonAmount);
  const existing = await input.client.query<{ amount: number }>(
    `SELECT amount
     FROM credit_allocations
     WHERE business_event_key = $1 AND related_job_id = $2
     FOR UPDATE`,
    [eventKey, input.taskId],
  );
  if (existing.rowCount) {
    const actual = existing.rows.reduce((sum, row) => sum + toInt(row.amount), 0);
    if (actual !== expected) throw creditInvariantError('生成积分冻结事件金额冲突');
    return { eventKey, amount: actual, transitioned: false };
  }

  await allocateBucket(input, 'main', toInt(input.mainAmount), eventKey);
  await allocateBucket(input, 'addon', toInt(input.addonAmount), eventKey);
  return { eventKey, amount: expected, transitioned: true };
}

export async function settleGenerationLotsWithClient(
  client: DbClient,
  taskId: string,
  attempt: number,
  eventKey = generationHoldEventKey(taskId, attempt),
) {
  const allocations = await client.query<{ id: string; lot_id: string; amount: number; status: string }>(
    `SELECT id, lot_id, amount, status
     FROM credit_allocations
     WHERE business_event_key = $1 AND related_job_id = $2
     ORDER BY id
     FOR UPDATE`,
    [eventKey, taskId],
  );
  if (!allocations.rowCount) throw creditInvariantError('生成任务缺少可结算的积分批次');
  for (const allocation of allocations.rows) {
    if (allocation.status === 'settled') continue;
    if (allocation.status !== 'held') throw creditInvariantError('生成积分结算状态冲突');
    const updated = await client.query(
      `UPDATE credit_lots
       SET held_amount = held_amount - $2,
           consumed_amount = consumed_amount + $2,
           updated_at = now()
       WHERE id = $1 AND held_amount >= $2`,
      [allocation.lot_id, toInt(allocation.amount)],
    );
    if (!updated.rowCount) throw creditInvariantError('生成积分批次冻结金额不足');
    await client.query(
      `UPDATE credit_allocations SET status = 'settled', updated_at = now()
       WHERE id = $1 AND status = 'held'`,
      [allocation.id],
    );
  }
  return true;
}

/** 释放预扣；已过期的主积分直接转 expired，不重新计入用户可用余额。 */
export async function releaseGenerationLotsWithClient(
  client: DbClient,
  taskId: string,
  attempt: number,
  eventKey = generationHoldEventKey(taskId, attempt),
) {
  const allocations = await client.query<{
    id: string;
    lot_id: string;
    amount: number;
    status: string;
    bucket: Bucket;
    expires_at: Date | string | null;
    referral_revoked_at?: Date | string | null;
  }>(
    `SELECT allocation.id, allocation.lot_id, allocation.amount, allocation.status,
            lot.bucket, lot.expires_at, lot.referral_revoked_at
     FROM credit_allocations allocation
     JOIN credit_lots lot ON lot.id = allocation.lot_id
     WHERE allocation.business_event_key = $1 AND allocation.related_job_id = $2
     ORDER BY allocation.id
     FOR UPDATE OF allocation, lot`,
    [eventKey, taskId],
  );
  if (!allocations.rowCount) return null;

  let mainReturned = 0;
  let addonReturned = 0;
  let expiredAmount = 0;
  let revokedAmount = 0;
  for (const allocation of allocations.rows) {
    if (allocation.status === 'reversed') {
      revokedAmount += toInt(allocation.amount);
      continue;
    }
    if (allocation.status === 'held' && allocation.referral_revoked_at) {
      await releaseRevokedReferralAllocation(client, allocation);
      revokedAmount += toInt(allocation.amount);
      continue;
    }
    if (allocation.status === 'released' || allocation.status === 'expired') continue;
    if (allocation.status !== 'held') throw creditInvariantError('生成积分释放状态冲突');
    const amount = toInt(allocation.amount);
    const expired = allocation.expires_at !== null && new Date(allocation.expires_at).getTime() <= Date.now();
    const lotUpdate = expired
      ? `UPDATE credit_lots
         SET held_amount = held_amount - $2, expired_amount = expired_amount + $2, updated_at = now()
         WHERE id = $1 AND held_amount >= $2`
      : `UPDATE credit_lots
         SET held_amount = held_amount - $2, available_amount = available_amount + $2, updated_at = now()
         WHERE id = $1 AND held_amount >= $2`;
    const updated = await client.query(lotUpdate, [allocation.lot_id, amount]);
    if (!updated.rowCount) throw creditInvariantError('生成积分批次冻结金额不足');
    await client.query(
      `UPDATE credit_allocations SET status = $2, updated_at = now()
       WHERE id = $1 AND status = 'held'`,
      [allocation.id, expired ? 'expired' : 'released'],
    );
    if (!expired && allocation.bucket === 'main') mainReturned += amount;
    if (!expired && allocation.bucket === 'addon') addonReturned += amount;
    if (expired) expiredAmount += amount;
  }

  return { mainReturned, addonReturned, expiredAmount, ...(revokedAmount > 0 ? { revokedAmount } : {}) };
}

async function allocateBucket(
  input: Parameters<typeof holdGenerationLotsWithClient>[0],
  bucket: Bucket,
  amount: number,
  eventKey: string,
) {
  if (amount <= 0) return;
  const lots = await input.client.query<LotRow>(
    `SELECT id, bucket, available_amount, held_amount, expires_at
     FROM credit_lots
     WHERE user_id = $1 AND bucket = $2 AND available_amount > 0
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY
       CASE WHEN $2 = 'main' THEN expires_at END ASC NULLS LAST,
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
    if (!updated.rowCount) throw creditInvariantError('生成积分批次可用金额被并发修改');
    await input.client.query(
      `INSERT INTO credit_allocations (
         user_id, lot_id, business_event_key, purpose, status, amount, related_job_id
       ) VALUES ($1, $2, $3, 'generation', 'held', $4, $5)`,
      [input.userId, lot.id, eventKey, allocated, input.taskId],
    );
    remaining -= allocated;
  }
  if (remaining > 0) throw creditInvariantError(`积分批次余额不足：${bucket} 缺少 ${remaining}`);
}

function creditInvariantError(message: string) {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code: 'CREDIT_LOT_INVARIANT_VIOLATION',
  });
}
