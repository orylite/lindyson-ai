import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('067 真人套餐历史素材保留迁移', () => {
  it('只更新已存在的标准代码并写入 7/15/30/60/90 天', async () => {
    const sql = await migrationSql();

    expect(sql).not.toContain('INSERT INTO plans');
    expect(sql).toMatch(/WHEN 'free' THEN 7/);
    expect(sql).toMatch(/WHEN 'basic' THEN 15/);
    expect(sql).toMatch(/WHEN 'pro' THEN 30/);
    expect(sql).toMatch(/WHEN 'ultra' THEN 60/);
    expect(sql).toMatch(/WHEN 'enterprise' THEN 90/);
    expect(sql).toContain("lower(code) IN ('free', 'basic', 'pro', 'ultra', 'enterprise')");
  });

  it('重放不覆盖管理员配置，并拒绝真人库启用时永久保留', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('IF portrait_retention_policy_was_missing THEN');
    expect(sql).toContain('plans_portrait_asset_retention_check');
    expect(sql).toContain('portrait_enabled = false');
    expect(sql).toContain('asset_retention_days BETWEEN 1 AND 3650');
    expect(sql).toMatch(/kind = 'addon'[\s\S]*asset_retention_days = 0/);
  });

  it('基础 seed 保持免费、专业、企业档位并在写入前执行保留期校验', async () => {
    const seed = await readFile(new URL('../src/db/seed.ts', import.meta.url), 'utf8');

    expect(planSeedBlock(seed, 'free')).toContain('assetRetentionDays: 7');
    expect(planSeedBlock(seed, 'pro')).toContain('assetRetentionDays: 30');
    expect(planSeedBlock(seed, 'enterprise')).toContain('assetRetentionDays: 90');
    expect(planSeedBlock(seed, 'addon-30000')).toContain('assetRetentionDays: 0');
    expect(seed).toContain('assertSeedPlanRetention(plan);');
    expect(seed).toContain("plan.kind === 'main' && plan.portraitEnabled && plan.assetRetentionDays < 1");
  });
});

function migrationSql() {
  return readFile(new URL('../migrations/067_portrait_plan_asset_retention.sql', import.meta.url), 'utf8');
}

function planSeedBlock(seed: string, code: string) {
  const match = seed.match(new RegExp(`code: '${code}',[\\s\\S]*?\\n    \\}\\);`));
  if (!match) throw new Error(`未找到套餐种子：${code}`);
  return match[0];
}
