import type { DbClient } from '../db/pool.js';
import { toIsoDate, toIsoDateTime, toInt } from './serialization.js';

export { ensureDefaultAssetFolders } from './assetFolders.js';

export interface UserRow {
  id: string;
  email: string;
  user_name: string;
  role: 'user' | 'admin';
  status: 'active' | 'frozen' | 'trial';
  billing_cycle: 'monthly' | 'yearly';
  plan_code: string | null;
  plan_name: string | null;
  portrait_enabled: boolean;
  portrait_profile_limit: number | null;
  portrait_active_limit: number;
  portrait_assets_per_actor: number;
  main_credits: number;
  addon_credits: number;
  total_credits: number;
  plan_reset_at: Date | string | null;
  plan_expires_at: Date | string | null;
  registered_at: Date | string;
  last_active_at: Date | string;
}

export function mapUserProfile(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    userName: row.user_name,
    role: row.role,
    status: row.status,
    planCode: row.plan_code,
    planName: row.plan_name,
    portraitEntitlements: {
      enabled: Boolean(row.portrait_enabled),
      profileLimit: row.portrait_profile_limit === null ? null : toInt(row.portrait_profile_limit),
      activeLimit: toInt(row.portrait_active_limit),
      assetsPerActor: toInt(row.portrait_assets_per_actor),
    },
    billingCycle: row.billing_cycle,
    mainCredits: toInt(row.main_credits),
    addonCredits: toInt(row.addon_credits),
    credits: toInt(row.main_credits) + toInt(row.addon_credits),
    totalCredits: toInt(row.total_credits),
    planResetAt: toIsoDate(row.plan_reset_at),
    planExpiresAt: toIsoDate(row.plan_expires_at),
    registeredAt: toIsoDateTime(row.registered_at),
    lastActiveAt: toIsoDateTime(row.last_active_at),
  };
}

export async function getUserProfile(client: DbClient, userId: string) {
  const result = await client.query<UserRow>(
    `SELECT u.*, p.code AS plan_code, p.name AS plan_name,
            CASE WHEN u.plan_id IS NULL THEN free_plan.portrait_enabled ELSE p.portrait_enabled END AS portrait_enabled,
            CASE WHEN u.plan_id IS NULL THEN free_plan.portrait_profile_limit ELSE p.portrait_profile_limit END AS portrait_profile_limit,
            CASE WHEN u.plan_id IS NULL THEN free_plan.portrait_active_limit ELSE p.portrait_active_limit END AS portrait_active_limit,
            CASE WHEN u.plan_id IS NULL THEN free_plan.portrait_assets_per_actor ELSE p.portrait_assets_per_actor END AS portrait_assets_per_actor
     FROM users u
     LEFT JOIN plans p ON p.id = u.plan_id
     LEFT JOIN LATERAL (
       SELECT portrait_enabled, portrait_profile_limit, portrait_active_limit, portrait_assets_per_actor
       FROM plans
       WHERE code = 'free' AND kind = 'main'
       LIMIT 1
     ) free_plan ON true
     WHERE u.id = $1`,
    [userId],
  );

  const user = result.rows[0];
  return user ? mapUserProfile(user) : null;
}
