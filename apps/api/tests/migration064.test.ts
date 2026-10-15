import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('064 私域真人人像素材库迁移', () => {
  it('建立完整领域表、套餐权益和生成引用快照', async () => {
    const sql = await migrationSql();
    for (const table of [
      'real_portrait_actors',
      'real_portrait_authorizations',
      'real_portrait_invites',
      'real_portrait_verification_sessions',
      'real_portrait_materializations',
      'real_portrait_assets',
      'real_portrait_capacity_reservations',
      'real_portrait_activation_queue',
      'user_portrait_quota_states',
      'portrait_entitlement_reconcile_outbox',
      'real_portrait_upload_sessions',
      'real_portrait_remote_operations',
      'generation_real_portrait_references',
      'real_portrait_events',
      'real_portrait_subject_access_tokens',
      'ai_clean_export_audits',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    for (const column of [
      'portrait_enabled',
      'portrait_profile_limit',
      'portrait_active_limit',
      'portrait_assets_per_actor',
      'cancel_origin',
      'cancel_reason_code',
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
  });

  it('锁定套餐上限、从零开始的任务尝试与并发容量唯一性', async () => {
    const sql = await migrationSql();
    expect(sql).toContain('portrait_assets_per_actor <= 2');
    expect(sql).toContain('task_attempt integer NOT NULL DEFAULT 0 CHECK (task_attempt >= 0)');
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_real_portrait_capacity_actor_reserved[\s\S]*WHERE status = 'reserved'/);
    expect(sql).toMatch(/FOREIGN KEY \(reservation_id, user_id, actor_id\)[\s\S]*REFERENCES real_portrait_capacity_reservations\(id, user_id, actor_id\)/);
    expect(sql).toMatch(/FOREIGN KEY \(asset_id, actor_id, materialization_id\)[\s\S]*REFERENCES real_portrait_assets\(id, actor_id, materialization_id\)/);
  });

  it('审计证据不级联删除且不可更新或删除', async () => {
    const sql = await migrationSql();
    expect(sql).not.toContain('ON DELETE CASCADE');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION reject_real_portrait_audit_mutation()');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON real_portrait_events');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON ai_clean_export_audits');
  });

  it('重复执行不会覆盖管理员后来修改的套餐权益', async () => {
    const sql = await migrationSql();
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS portrait_enabled');
    expect(sql).toContain('IF portrait_columns_were_missing THEN');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS plans_portrait_entitlements_check');
  });

  it('系统套餐种子锁定 free、pro、enterprise 与 addon 默认权益', async () => {
    const seed = await readFile(new URL('../src/db/seed.ts', import.meta.url), 'utf8');
    expect(planSeedBlock(seed, 'free')).toMatch(/portraitEnabled: true,[\s\S]*portraitProfileLimit: 1,[\s\S]*portraitActiveLimit: 1,[\s\S]*portraitAssetsPerActor: 1/);
    expect(planSeedBlock(seed, 'pro')).toMatch(/portraitEnabled: true,[\s\S]*portraitProfileLimit: 5,[\s\S]*portraitActiveLimit: 3,[\s\S]*portraitAssetsPerActor: 2/);
    expect(planSeedBlock(seed, 'enterprise')).toMatch(/portraitEnabled: true,[\s\S]*portraitProfileLimit: null,[\s\S]*portraitActiveLimit: 10,[\s\S]*portraitAssetsPerActor: 2/);
    expect(planSeedBlock(seed, 'addon-30000')).toMatch(/portraitEnabled: false,[\s\S]*portraitProfileLimit: 0,[\s\S]*portraitActiveLimit: 0,[\s\S]*portraitAssetsPerActor: 0/);
  });
});

function migrationSql() {
  return readFile(new URL('../migrations/064_real_portrait_library.sql', import.meta.url), 'utf8');
}

function planSeedBlock(seed: string, code: string) {
  const match = seed.match(new RegExp(`code: '${code}',[\\s\\S]*?\\n    \\}\\);`));
  if (!match) throw new Error(`未找到套餐种子：${code}`);
  return match[0];
}
