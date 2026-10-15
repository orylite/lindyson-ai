import type { DbClient } from '../db/pool.js';
import { toInt } from './serialization.js';

export interface PortraitEntitlementValues {
  portraitEnabled: boolean;
  /** NULL 表示可建档人数不设套餐上限。 */
  portraitProfileLimit: number | null;
  portraitActiveLimit: number;
  portraitAssetsPerActor: number;
}

export interface ResolvedPortraitEntitlements extends PortraitEntitlementValues {
  sourcePlanId: string;
  sourcePlanCode: string;
  sourcePlanName: string;
}

export type PortraitPlanKind = 'main' | 'addon';

interface PortraitEntitlementRow {
  user_id: string;
  assigned_plan_id: string | null;
  source_plan_id: string | null;
  source_plan_code: string | null;
  source_plan_name: string | null;
  source_plan_kind: string | null;
  portrait_enabled: boolean | null;
  portrait_profile_limit: unknown;
  portrait_active_limit: unknown;
  portrait_assets_per_actor: unknown;
}

/**
 * 套餐权益的领域不变量。数据库约束和后台写接口都复用同一套含义：
 * 加购包始终关闭；主套餐可以显式关闭，启用时每个真人最多两份素材。
 */
export function validatePortraitEntitlements(
  kind: PortraitPlanKind,
  values: PortraitEntitlementValues,
): string | null {
  if (kind === 'addon') {
    return values.portraitEnabled === false
      && values.portraitProfileLimit === 0
      && values.portraitActiveLimit === 0
      && values.portraitAssetsPerActor === 0
      ? null
      : '加购包不能包含真人人像素材库权益';
  }

  if (!values.portraitEnabled) {
    return values.portraitProfileLimit === 0
      && values.portraitActiveLimit === 0
      && values.portraitAssetsPerActor === 0
      ? null
      : '关闭真人人像素材库时，建档、激活和单人素材额度必须全部为 0';
  }

  if (values.portraitProfileLimit !== null
    && (!Number.isInteger(values.portraitProfileLimit) || values.portraitProfileLimit <= 0)) {
    return '真人建档额度必须为正整数或 null（不设上限）';
  }
  if (!Number.isInteger(values.portraitActiveLimit) || values.portraitActiveLimit <= 0) {
    return '真人同时激活额度必须为正整数';
  }
  if (!Number.isInteger(values.portraitAssetsPerActor)
    || values.portraitAssetsPerActor < 1
    || values.portraitAssetsPerActor > 2) {
    return '每位真人素材数量必须为 1 或 2';
  }
  if (values.portraitProfileLimit !== null
    && values.portraitActiveLimit > values.portraitProfileLimit) {
    return '真人同时激活额度不能超过建档额度';
  }
  return null;
}

export function assertPortraitEntitlements(
  kind: PortraitPlanKind,
  values: PortraitEntitlementValues,
): void {
  const message = validatePortraitEntitlements(kind, values);
  if (!message) return;
  throw Object.assign(new Error(message), {
    statusCode: 400,
    code: 'INVALID_PORTRAIT_ENTITLEMENTS',
    exposeMessage: true,
  });
}

/**
 * 读取用户当前主套餐的真人权益。未显式绑定套餐的用户严格回落到 free；
 * 不使用 COALESCE(profile_limit)，避免把企业版的 NULL（不设上限）误判为免费额度。
 */
export async function getPortraitEntitlementsForUser(
  client: DbClient,
  userId: string,
): Promise<ResolvedPortraitEntitlements | null> {
  const result = await client.query<PortraitEntitlementRow>(
    `SELECT u.id AS user_id,
            u.plan_id AS assigned_plan_id,
            CASE WHEN u.plan_id IS NULL THEN free_plan.id ELSE assigned_plan.id END AS source_plan_id,
            CASE WHEN u.plan_id IS NULL THEN free_plan.code ELSE assigned_plan.code END AS source_plan_code,
            CASE WHEN u.plan_id IS NULL THEN free_plan.name ELSE assigned_plan.name END AS source_plan_name,
            CASE WHEN u.plan_id IS NULL THEN free_plan.kind ELSE assigned_plan.kind END AS source_plan_kind,
            CASE WHEN u.plan_id IS NULL THEN free_plan.portrait_enabled ELSE assigned_plan.portrait_enabled END AS portrait_enabled,
            CASE WHEN u.plan_id IS NULL THEN free_plan.portrait_profile_limit ELSE assigned_plan.portrait_profile_limit END AS portrait_profile_limit,
            CASE WHEN u.plan_id IS NULL THEN free_plan.portrait_active_limit ELSE assigned_plan.portrait_active_limit END AS portrait_active_limit,
            CASE WHEN u.plan_id IS NULL THEN free_plan.portrait_assets_per_actor ELSE assigned_plan.portrait_assets_per_actor END AS portrait_assets_per_actor
     FROM users u
     LEFT JOIN plans assigned_plan ON assigned_plan.id = u.plan_id
     LEFT JOIN LATERAL (
       SELECT id, code, name, kind, portrait_enabled, portrait_profile_limit,
              portrait_active_limit, portrait_assets_per_actor
       FROM plans
       WHERE code = 'free' AND kind = 'main'
       LIMIT 1
     ) free_plan ON true
     WHERE u.id = $1
     LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (!row.source_plan_id || !row.source_plan_code || !row.source_plan_name) {
    throw Object.assign(new Error('免费版真人人像权益配置不存在'), {
      code: 'FREE_PORTRAIT_PLAN_MISSING',
    });
  }
  if (row.source_plan_kind !== 'main') {
    throw Object.assign(new Error('用户绑定的套餐不是主套餐'), {
      code: 'PORTRAIT_MAIN_PLAN_REQUIRED',
    });
  }

  const values: PortraitEntitlementValues = {
    portraitEnabled: Boolean(row.portrait_enabled),
    portraitProfileLimit: row.portrait_profile_limit === null
      ? null
      : toInt(row.portrait_profile_limit),
    portraitActiveLimit: toInt(row.portrait_active_limit),
    portraitAssetsPerActor: toInt(row.portrait_assets_per_actor),
  };
  assertPortraitEntitlements('main', values);
  return {
    sourcePlanId: row.source_plan_id,
    sourcePlanCode: row.source_plan_code,
    sourcePlanName: row.source_plan_name,
    ...values,
  };
}
