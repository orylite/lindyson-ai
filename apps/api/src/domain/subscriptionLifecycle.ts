import { pool, withTransaction, type DbClient } from '../db/pool.js';
import { getBillingDate } from './billingClock.js';
import { creditLedgerNotes, subscriptionResetCreditNote } from './creditLedgerNotes.js';
import {
  replaceSubscriptionMainLotWithClient,
  setUserAvailableCreditsWithClient,
} from './financialCredits.js';
import { toInt } from './serialization.js';
import { enqueuePortraitEntitlementReconcileWithClient } from './realPortraitReconciliation.js';

interface SubscriptionUserRow {
  id: string;
  plan_id: string | null;
  plan_code: string | null;
  plan_name: string | null;
  plan_credits: number | null;
  billing_cycle: 'monthly' | 'yearly';
  main_credits: number;
  addon_credits: number;
  plan_reset_at: Date | string | null;
  plan_expires_at: Date | string | null;
}

export async function reconcileSubscription(userId: string) {
  return withTransaction(client => reconcileSubscriptionWithClient(client, userId));
}

export async function reconcileSubscriptionWithClient(client: DbClient, userId: string, now = new Date()) {
  const result = await client.query<SubscriptionUserRow>(
    `SELECT u.id, u.plan_id, u.billing_cycle, u.main_credits, u.addon_credits,
            u.plan_reset_at, u.plan_expires_at,
            p.code AS plan_code, p.name AS plan_name, p.credits AS plan_credits
     FROM users u
     LEFT JOIN plans p ON p.id = u.plan_id
     WHERE u.id = $1
     FOR UPDATE OF u`,
    [userId],
  );
  const user = result.rows[0];
  if (!user) return false;

  const billingDate = getBillingDate(now);
  const today = parseDate(billingDate)!;
  const expiresAt = parseDate(user.plan_expires_at);
  const resetAt = parseDate(user.plan_reset_at);

  if (expiresAt && expiresAt.getTime() <= today.getTime()) {
    return resetToDefaultAccount(client, user, billingDate);
  }

  if (resetAt && resetAt.getTime() <= today.getTime()) {
    const nextMain = toInt(user.plan_credits);
    const eventKey = `subscription-cycle:${user.id}:${billingDate}`;
    await replaceSubscriptionMainLotWithClient(client, {
      userId: user.id,
      expectedAvailable: toInt(user.main_credits),
      nextAmount: nextMain,
      cycleEventKey: eventKey,
      nextExpiresAt: addDays(billingDate, 30),
    });
    const synced = await setUserAvailableCreditsWithClient(client, user.id);
    assertSyncedMainCredits(synced, nextMain, user.addon_credits);
    await client.query(
      `UPDATE users
       SET plan_cycle_started_at = $2::date,
           plan_reset_at = $2::date + 30,
           updated_at = now()
       WHERE id = $1`,
      [user.id, billingDate],
    );
    await appendLifecycleLedger(
      client,
      user,
      nextMain,
      '套餐周期重置',
      subscriptionResetCreditNote(user.plan_name ?? '当前套餐'),
      eventKey,
    );
    return true;
  }

  return false;
}

export async function reconcileDueSubscriptions(limit = 300) {
  const billingDate = getBillingDate();
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM users
     WHERE (plan_reset_at IS NOT NULL AND plan_reset_at <= $1::date)
        OR (plan_expires_at IS NOT NULL AND plan_expires_at <= $1::date)
     ORDER BY updated_at ASC
     LIMIT $2`,
    [billingDate, limit],
  );
  for (const row of result.rows) await reconcileSubscription(row.id);
  return result.rowCount ?? 0;
}

async function resetToDefaultAccount(client: DbClient, user: SubscriptionUserRow, billingDate: string) {
  const eventKey = `subscription-expired:${user.id}:${billingDate}`;
  await replaceSubscriptionMainLotWithClient(client, {
    userId: user.id,
    expectedAvailable: toInt(user.main_credits),
    nextAmount: 0,
    cycleEventKey: eventKey,
  });
  const synced = await setUserAvailableCreditsWithClient(client, user.id);
  assertSyncedMainCredits(synced, 0, user.addon_credits);
  await client.query(
    `UPDATE users
     SET plan_id = NULL,
         billing_cycle = 'monthly',
         plan_cycle_started_at = $2::date,
         plan_reset_at = NULL,
         plan_expires_at = NULL,
         active_subscription_order_id = NULL,
         updated_at = now()
     WHERE id = $1`,
    [user.id, billingDate],
  );
  await enqueuePortraitEntitlementReconcileWithClient(client, {
    userId: user.id,
    eventKey: `portrait-${eventKey}`,
    reason: 'subscription-expired',
    oldPlanId: user.plan_id,
    newPlanId: null,
  });
  await appendLifecycleLedger(
    client,
    user,
    0,
    '套餐到期回退',
    creditLedgerNotes.subscriptionExpired,
    eventKey,
  );
  return true;
}

async function appendLifecycleLedger(
  client: DbClient,
  user: SubscriptionUserRow,
  nextMain: number,
  source: string,
  note: string,
  businessEventKey: string,
) {
  const delta = nextMain - toInt(user.main_credits);
  if (delta === 0) return;
  await client.query(
    `INSERT INTO credit_ledger (
       user_id, type, bucket, settlement_status, amount, balance,
       source, operator, note, business_event_key
     )
     VALUES ($1, 'adjust', 'main', 'settled', $2, $3, $4, 'system', $5, $6)
     ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO NOTHING`,
    [user.id, delta, nextMain + toInt(user.addon_credits), source, note, businessEventKey],
  );
}

function parseDate(value: Date | string | null) {
  if (!value) return null;
  if (value instanceof Date) return startOfUtcDay(value);
  const text = String(value).slice(0, 10);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

function assertSyncedMainCredits(
  synced: { mainCredits: number; addonCredits: number },
  expectedMain: number,
  expectedAddon: number,
) {
  if (synced.mainCredits !== expectedMain || synced.addonCredits !== toInt(expectedAddon)) {
    throw Object.assign(new Error('订阅周期积分批次与用户缓存不一致'), {
      statusCode: 409,
      code: 'FINANCIAL_MANUAL_REVIEW_REQUIRED',
    });
  }
}
