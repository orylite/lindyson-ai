import { z } from 'zod';
import { hashPassword, passwordSchema } from '../auth/password.js';
import { creditLedgerNotes } from '../domain/creditLedgerNotes.js';
import {
  adjustCreditLotsWithClient,
  setUserAvailableCreditsWithClient,
} from '../domain/financialCredits.js';
import { ensureDefaultAssetFolders } from '../domain/users.js';
import { pool, withTransaction, type DbClient } from './pool.js';

const email = z.string().trim().email().toLowerCase().parse(process.env.BOOTSTRAP_ADMIN_EMAIL);
const password = passwordSchema.parse(process.env.BOOTSTRAP_ADMIN_PASSWORD);
const shouldResetPassword = process.env.BOOTSTRAP_RESET_ADMIN_PASSWORD === 'true';

async function run() {
  const result = await withTransaction(async client => {
    const planResult = await client.query<{ id: string; credits: number }>(
      `SELECT id, credits
       FROM plans
       WHERE code = 'pro' AND kind = 'main' AND status = 'active'
       LIMIT 1`,
    );
    const plan = planResult.rows[0];
    if (!plan) {
      throw new Error('管理员初始化前必须先写入启用中的 pro 基础套餐。');
    }

    const admin = await ensureAdminUser(client, plan.id, Number(plan.credits), email, password);
    await ensureDefaultAssetFolders(client, admin.id);
    return admin;
  });

  console.log(result.created
    ? `管理员已创建：${email}`
    : shouldResetPassword
      ? `既有管理员密码已显式重置：${email}`
      : `管理员已存在，未修改账号：${email}`);
}

async function ensureAdminUser(
  client: DbClient,
  planId: string,
  planCredits: number,
  adminEmail: string,
  adminPassword: string,
) {
  const existing = await client.query<{ id: string; role: 'user' | 'admin' }>(
    'SELECT id, role FROM users WHERE email = $1 LIMIT 1 FOR UPDATE',
    [adminEmail],
  );
  const current = existing.rows[0];
  if (current) {
    if (current.role !== 'admin') {
      throw new Error(`拒绝将已有普通用户 ${adminEmail} 自动提升为管理员，请使用专用管理流程。`);
    }
    if (shouldResetPassword) {
      const passwordHash = await hashPassword(adminPassword);
      await client.query(
        `UPDATE users
         SET password_hash = $2,
             auth_version = auth_version + 1,
             updated_at = now()
         WHERE id = $1`,
        [current.id, passwordHash],
      );
    }
    return { id: current.id, created: false };
  }

  const passwordHash = await hashPassword(adminPassword);
  const credits = Math.max(0, Math.trunc(planCredits));
  const created = await client.query<{ id: string }>(
    `INSERT INTO users (
       email, password_hash, user_name, role, status, plan_id,
       main_credits, addon_credits, total_credits,
       plan_cycle_started_at, plan_reset_at, plan_expires_at
     )
     VALUES (
       $1, $2, 'Lindyson Admin', 'admin', 'active', $3,
       0, 0, 0,
       (now() AT TIME ZONE 'Asia/Shanghai')::date,
       (now() AT TIME ZONE 'Asia/Shanghai')::date + 30,
       (now() AT TIME ZONE 'Asia/Shanghai')::date + interval '1 year'
     )
     RETURNING id`,
    [adminEmail, passwordHash, planId],
  );
  const adminId = created.rows[0]!.id;
  if (credits > 0) {
    const eventKey = `admin-bootstrap:${adminId}`;
    await adjustCreditLotsWithClient(client, {
      userId: adminId,
      bucket: 'main',
      delta: credits,
      eventKey,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
    });
    const synced = await setUserAvailableCreditsWithClient(client, adminId);
    if (synced.mainCredits !== credits || synced.addonCredits !== 0) {
      throw new Error('管理员初始化积分批次与用户缓存不一致。');
    }
    await client.query(
      `INSERT INTO credit_ledger (
         user_id, type, bucket, settlement_status, amount, balance,
         source, operator, note, business_event_key
       )
       VALUES ($1, 'earn', 'main', 'settled', $2, $2,
               '管理员初始化套餐', 'system', $3, $4)`,
      [adminId, credits, creditLedgerNotes.adminBootstrap, eventKey],
    );
  }
  return { id: adminId, created: true };
}

run()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
