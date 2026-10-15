import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('049 套餐素材保留期迁移', () => {
  it('建立套餐保留天数、免费策略、扫描索引和可恢复运行记录', async () => {
    const sql = await readFile(
      new URL('../migrations/049_plan_asset_retention.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain('asset_retention_days integer NOT NULL DEFAULT 0');
    expect(sql).toContain('asset_retention_days BETWEEN 0 AND 3650');
    expect(sql).toContain("kind = 'main' OR asset_retention_days = 0");
    expect(sql).toMatch(/'free'[\s\S]*asset_retention_days[\s\S]*WHEN 'free' THEN 7/);
    expect(sql).toContain("WHEN 'pro' THEN 30");
    expect(sql).toContain("WHEN 'enterprise' THEN 90");
    expect(sql).toMatch(/idx_assets_retention_sweep[\s\S]*source IN \('ai-video', 'ai-image'\)/);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS asset_retention_sweep_runs');
    expect(sql).toContain('business_date date PRIMARY KEY');
    expect(sql).toContain('claim_token uuid');
    expect(sql).toContain('lease_expires_at timestamptz');
    expect(sql).toContain('attempt_count integer NOT NULL DEFAULT 1');
    expect(sql).toContain('asset_retention_sweep_runs_state_check');
  });

  it('SQL 直接重放不会覆盖管理员已经修改的保留天数', async () => {
    const sql = await readFile(
      new URL('../migrations/049_plan_asset_retention.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain('retention_column_was_missing');
    expect(sql).toContain('IF retention_column_was_missing THEN');
    expect(sql).toContain('ON CONFLICT (code) DO NOTHING');
    expect(sql).not.toContain('ON CONFLICT (code) DO UPDATE');
  });
});
