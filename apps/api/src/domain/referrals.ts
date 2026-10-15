import { randomInt } from 'node:crypto';
import type { EndpointRequestQuery } from '@lindyson/api-contracts';
import { pool, withReadOnlyRepeatableRead, type DbClient } from '../db/pool.js';
import { setUserAvailableCreditsWithClient } from './financialCredits.js';
import { toIsoDateTime } from './serialization.js';
import { createExactCursorPage, exactPageMetadataColumns, fourWayCursorCondition, fourWayCursorValues, fourWayPageOrderBy, materializeExactCursorPageQuery, parseExactCursorPageRequest, type ExactPageMetadata } from './cursorPagination.js';

function referralError(message: string) { return Object.assign(new Error(message), { statusCode: 409, code: 'REFERRAL_UNAVAILABLE' }); }
export async function readReferralSettings(client: DbClient = pool) {
  const { rows } = await client.query('SELECT enabled, inviter_credits, invitee_credits FROM referral_settings WHERE id = 1');
  return { enabled: rows[0].enabled as boolean, inviterCredits: rows[0].inviter_credits as number, inviteeCredits: rows[0].invitee_credits as number };
}
export async function checkReferralCode(client: DbClient, code: string) {
  const result = await client.query<{ user_id: string; inviter_credits: number; invitee_credits: number }>(
    `SELECT c.user_id, s.inviter_credits, s.invitee_credits FROM referral_codes c
     JOIN users u ON u.id = c.user_id CROSS JOIN referral_settings s
     WHERE (c.code = $1 OR c.legacy_code = $1 OR c.legacy_short_code = $1) AND u.status <> 'frozen' AND s.enabled`, [code]);
  return result.rows[0] ?? null;
}
export async function bindReferralWithClient(client: DbClient, inviteeId: string, code: string) {
  // 与后台关闭/改价串行化，注册关系保存绑定时的额度。
  await client.query('SELECT id FROM referral_settings WHERE id = 1 FOR SHARE');
  const invitation = await checkReferralCode(client, code);
  if (!invitation || invitation.user_id === inviteeId) throw referralError('邀请已失效或活动已关闭，请取消邀请后重试');
  await client.query(`INSERT INTO referrals(inviter_id, invitee_id, inviter_credits, invitee_credits)
    VALUES ($1, $2, $3, $4)`, [invitation.user_id, inviteeId, invitation.inviter_credits, invitation.invitee_credits]);
}

/** 订单已加锁后、任何用户行加锁之前调用；两人始终按 UUID 升序锁定。 */
export async function lockReferralUsersWithClient(client: DbClient, userId: string) {
  const relation = await client.query<{ inviter_id: string }>('SELECT inviter_id FROM referrals WHERE invitee_id = $1', [userId]);
  const inviter = relation.rows[0]?.inviter_id;
  if (inviter) await client.query('SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[userId, inviter]]);
}
interface ReferralRow { id: string; inviter_id: string; invitee_id: string; inviter_credits: number; invitee_credits: number; order_id: string | null; refunded_at: Date | null }
export async function rewardReferralForOrderWithClient(client: DbClient, order: { id: string; user_id: string; kind: string; amount: unknown }) {
  if (order.kind !== 'main' || Number(order.amount) <= 0) return;
  const result = await client.query<ReferralRow>('SELECT * FROM referrals WHERE invitee_id = $1 FOR UPDATE', [order.user_id]);
  const referral = result.rows[0];
  if (!referral || referral.order_id) return;
  const prior = await client.query(`SELECT id FROM orders WHERE user_id = $1 AND id <> $2
    AND kind = 'main' AND amount > 0 AND paid_at IS NOT NULL LIMIT 1`, [order.user_id, order.id]);
  if (prior.rowCount) return;
  await client.query('UPDATE referrals SET order_id = $2 WHERE id = $1', [referral.id, order.id]);
  referral.order_id = order.id;
  await client.query(`INSERT INTO referral_rewards(referral_id, user_id, role, amount) VALUES
    ($1, $2, 'inviter', $4), ($1, $3, 'invitee', $5) ON CONFLICT DO NOTHING`,
    [referral.id, referral.inviter_id, referral.invitee_id, referral.inviter_credits, referral.invitee_credits]);
  await grantReferralRewardsWithClient(client, referral);
}
async function grantReferralRewardsWithClient(client: DbClient, referral: ReferralRow) {
  const frozen = await client.query(`SELECT id FROM users WHERE id = ANY($1::uuid[]) AND status = 'frozen'`, [[referral.inviter_id, referral.invitee_id]]);
  if (frozen.rowCount || referral.refunded_at) return false;
  const rewards = await client.query<{ id: string; user_id: string; amount: number; lot_id: string | null }>(
    'SELECT * FROM referral_rewards WHERE referral_id = $1 ORDER BY user_id FOR UPDATE', [referral.id]);
  for (const reward of rewards.rows) {
    if (reward.lot_id) continue;
    const eventKey = `referral-reward:${reward.id}`;
    const lot = await client.query<{ id: string }>(`INSERT INTO credit_lots(user_id, bucket, source_type, source_event_key, original_amount, available_amount)
      VALUES ($1, 'addon', 'referral-reward', $2, $3, $3) RETURNING id`, [reward.user_id, eventKey, reward.amount]);
    await client.query('UPDATE referral_rewards SET lot_id = $2 WHERE id = $1', [reward.id, lot.rows[0]!.id]);
    const balance = await setUserAvailableCreditsWithClient(client, reward.user_id);
    await client.query(`INSERT INTO credit_ledger(user_id, type, bucket, settlement_status, amount, balance, source, operator, note, related_order_id, business_event_key)
      VALUES ($1, 'earn', 'addon', 'settled', $2, $3, '邀约奖励', 'system', '邀请新用户首次购买付费主套餐，奖励已到账。', $4, $5)`,
      [reward.user_id, reward.amount, balance.balance, referral.order_id, eventKey]);
  }
  return true;
}
export async function revokeReferralForOrderWithClient(client: DbClient, orderId: string) {
  const result = await client.query<ReferralRow>('SELECT * FROM referrals WHERE order_id = $1 FOR UPDATE', [orderId]);
  const referral = result.rows[0];
  if (!referral || referral.refunded_at) return;
  await client.query('UPDATE referrals SET refunded_at = now() WHERE id = $1', [referral.id]);
  const lots = await client.query<{ id: string; user_id: string; available_amount: number }>(`SELECT lot.id, lot.user_id, lot.available_amount
    FROM referral_rewards reward JOIN credit_lots lot ON lot.id = reward.lot_id
    WHERE reward.referral_id = $1 ORDER BY lot.user_id, lot.id FOR UPDATE OF lot`, [referral.id]);
  for (const lot of lots.rows) {
    await client.query(`UPDATE credit_lots SET referral_revoked_at = now(), reversed_amount = reversed_amount + available_amount,
      available_amount = 0, updated_at = now() WHERE id = $1`, [lot.id]);
    if (lot.available_amount > 0) await client.query(`INSERT INTO credit_allocations(user_id, lot_id, business_event_key, purpose, status, amount)
      VALUES ($1, $2, $3, 'adjustment', 'reversed', $4)`, [lot.user_id, lot.id, `referral-revoke:${lot.id}`, lot.available_amount]);
    await appendReferralReversalWithClient(client, lot.id, lot.available_amount, `referral-revoke:${lot.id}`);
  }
}
export async function appendReferralReversalWithClient(client: DbClient, lotId: string, amount: number, eventKey: string) {
  const result = await client.query<{ user_id: string; order_id: string }>(`SELECT reward.user_id, referral.order_id FROM referral_rewards reward
    JOIN referrals referral ON referral.id = reward.referral_id WHERE reward.lot_id = $1`, [lotId]);
  const reward = result.rows[0];
  if (!reward) throw referralError('奖励批次关联缺失');
  const balance = await setUserAvailableCreditsWithClient(client, reward.user_id);
  if (amount <= 0) return;
  await client.query(`INSERT INTO credit_ledger(user_id, type, bucket, settlement_status, amount, balance, source, operator, note, related_order_id, business_event_key)
    VALUES ($1, 'void', 'addon', 'reversed', $2, $3, '邀约奖励追回', 'system', '触发奖励的订单已退款，此部分奖励已追回。', $4, $5)
    ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO NOTHING`,
    [reward.user_id, -amount, balance.balance, reward.order_id, eventKey]);
}
/** 被撤销奖励的冻结释放只能冲销，不能产生到期补偿或恢复可用余额。 */
export async function releaseRevokedReferralAllocation(client: DbClient, allocation: { id: string; lot_id: string; amount: unknown }) {
  const amount = Number(allocation.amount);
  const updated = await client.query(`UPDATE credit_lots SET held_amount = held_amount - $2,
    reversed_amount = reversed_amount + $2, updated_at = now()
    WHERE id = $1 AND held_amount >= $2 AND referral_revoked_at IS NOT NULL`, [allocation.lot_id, amount]);
  if (!updated.rowCount) throw referralError('奖励冻结金额不一致');
  await client.query("UPDATE credit_allocations SET status = 'reversed', updated_at = now() WHERE id = $1 AND status = 'held'", [allocation.id]);
  await appendReferralReversalWithClient(client, allocation.lot_id, amount, `referral-release:${allocation.id}`);
}
export async function resolveReferralWithClient(client: DbClient, id: string, action: 'grant' | 'close', reason: string) {
  const existing = await client.query<ReferralRow>('SELECT * FROM referrals WHERE id = $1', [id]);
  const row = existing.rows[0];
  if (!row?.order_id) throw referralError('此邀请尚未触发奖励');
  await client.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [row.order_id]);
  await lockReferralUsersWithClient(client, row.invitee_id);
  const locked = await client.query<ReferralRow>('SELECT * FROM referrals WHERE id = $1 FOR UPDATE', [id]);
  const referral = locked.rows[0]!;
  if (action === 'grant') {
    if (!await grantReferralRewardsWithClient(client, referral)) throw referralError('双方账号须正常且订单未退款，才能补发');
    await client.query('UPDATE referral_rewards SET review_note = $2 WHERE referral_id = $1', [id, reason]);
  } else {
    if (!referral.refunded_at) throw referralError('未退款奖励应使用补发操作，不得免除应发奖励');
    await client.query(`UPDATE referral_rewards r SET reviewed_consumed = l.consumed_amount, review_note = $2
      FROM credit_lots l WHERE r.lot_id = l.id AND r.referral_id = $1`, [id, reason]);
  }
}
/** 唯一约束处理并发建码；随机碰撞重试，不改变已有邀请码。 */
export async function ensureReferralCodeWithClient(client: DbClient, userId: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const inserted = await client.query(`INSERT INTO referral_codes(user_id, code) VALUES ($1, $2)
      ON CONFLICT DO NOTHING RETURNING user_id`, [userId, Array.from({ length: 8 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[randomInt(36)]).join('')]);
    if (inserted.rowCount) return;
    const existing = await client.query('SELECT user_id FROM referral_codes WHERE user_id = $1', [userId]);
    if (existing.rowCount) return;
  }
  throw Object.assign(new Error('暂时无法生成邀请码，请刷新重试'), { statusCode: 503 });
}
export async function getReferralSummary(userId: string) {
  await ensureReferralCodeWithClient(pool, userId);
  const result = await pool.query(`SELECT c.code,
    (SELECT count(*)::integer FROM referrals WHERE inviter_id = $1) AS invited,
    (SELECT COALESCE(sum(l.original_amount - l.reversed_amount), 0)::integer FROM referral_rewards r JOIN credit_lots l ON l.id = r.lot_id WHERE r.user_id = $1) AS earned
    FROM referral_codes c WHERE c.user_id = $1`, [userId]);
  return { ...result.rows[0], settings: await readReferralSettings() };
}

// 用户端只读自己邀请的记录；公共查询不返回邀请人身份。
const recordView = `SELECT r.*, u.email AS inviter_email, v.email AS invitee_email,
  COALESCE(a.granted,0)::integer AS granted, COALESCE(a.reversed,0)::integer AS reversed,
  COALESCE(a.held,0)::integer AS held, COALESCE(a.consumed,0)::integer AS consumed, a.review_note,
  CASE WHEN r.order_id IS NULL THEN 'waiting'
    WHEN r.refunded_at IS NULL THEN CASE WHEN a.pending THEN 'review' ELSE 'rewarded' END
    WHEN a.unreviewed THEN 'review' WHEN a.held > 0 THEN 'reversing'
    WHEN a.consumed > 0 THEN 'closed' ELSE 'reversed' END AS status
  FROM referrals r JOIN users u ON u.id = r.inviter_id JOIN users v ON v.id = r.invitee_id
  LEFT JOIN LATERAL (SELECT sum(l.original_amount) AS granted, sum(l.reversed_amount) AS reversed,
    sum(l.held_amount) AS held, sum(l.consumed_amount) AS consumed,
    bool_or(w.lot_id IS NULL) AS pending, bool_or(l.consumed_amount > w.reviewed_consumed) AS unreviewed,
    string_agg(DISTINCT w.review_note, '；') AS review_note
    FROM referral_rewards w LEFT JOIN credit_lots l ON l.id = w.lot_id WHERE w.referral_id = r.id) a ON true`;
export async function listReferrals(query: EndpointRequestQuery<'adminReferrals'>, userId?: string) {
  const { search, status, from, to } = query;
  const request = parseExactCursorPageRequest({ ...query, resource: 'referrals', filters: { userId: userId ?? null, search: search ?? null, status: status ?? null, from: from ?? null, to: to ?? null }, defaultLimit: 20, maxLimit: 50 });
  return withReadOnlyRepeatableRead(async client => {
    const version = await client.query('SELECT COALESCE(sum(revision),0)::text AS version, now() AS snapshot_at FROM referrals');
    const predicate = `($1::uuid IS NULL OR inviter_id = $1) AND ($2::text IS NULL OR inviter_email ILIKE '%' || $2 || '%' OR invitee_email ILIKE '%' || $2 || '%')
      AND ($3::text IS NULL OR status = $3) AND ($4::date IS NULL OR created_at >= ($4::date::timestamp AT TIME ZONE 'Asia/Shanghai'))
      AND ($5::date IS NULL OR created_at < (($5::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai'))`;
    const params = [userId ?? null, search ?? null, status ?? null, from ?? null, to ?? null];
    const count = await client.query(`SELECT count(*)::text AS count FROM (${recordView}) records WHERE ${predicate}`, params);
    const pageQuery = materializeExactCursorPageQuery(request, { resourceVersion: version.rows[0].version, snapshotAt: toIsoDateTime(version.rows[0].snapshot_at)!, totalItems: count.rows[0].count });
    const rows = await client.query<ReferralRow & ExactPageMetadata & { inviter_email: string; invitee_email: string; status: string; granted: number; reversed: number; held: number; consumed: number; review_note: string | null; created_at: Date }>(
      `SELECT records.*, ${exactPageMetadataColumns('created_at')} FROM (${recordView}) records WHERE ${predicate}
      AND ${fourWayCursorCondition(pageQuery, 'created_at', 'id', 6, 7)} ORDER BY ${fourWayPageOrderBy(pageQuery, 'created_at', 'id')} LIMIT $8`,
      [...params, ...fourWayCursorValues(pageQuery), pageQuery.limit + 1]);
    return createExactCursorPage({ rows: rows.rows, query: pageQuery, getId: row => row.id, map: row => ({
      id: row.id, inviter: userId ? '我' : row.inviter_email, invitee: userId ? maskReferralEmail(row.invitee_email) : row.invitee_email,
      createdAt: toIsoDateTime(row.created_at)!, orderId: row.order_id, refundedAt: toIsoDateTime(row.refunded_at), status: row.status,
      inviterCredits: row.inviter_credits, inviteeCredits: row.invitee_credits, granted: row.granted, reversed: row.reversed,
      held: row.held, consumed: row.consumed, reviewNote: userId ? null : row.review_note,
    }) });
  });
}
export function maskReferralEmail(email: string) { const [local, domain] = email.split('@'); return `${local?.slice(0, 1) ?? ''}***@${domain ?? '***'}`; }
