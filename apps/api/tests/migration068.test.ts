import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL('../migrations/068_prompt_wizard_v3.sql', import.meta.url);

describe('068 提示词向导 3.0 迁移', () => {
  it('历史设置行升级为 2.0，迁移后的新行默认 3.0', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    const addColumn = 'ADD COLUMN IF NOT EXISTS engine_version smallint NOT NULL DEFAULT 2';
    const switchDefault = 'ALTER COLUMN engine_version SET DEFAULT 3';
    const addColumnAt = sql.indexOf(addColumn);
    const switchDefaultAt = sql.indexOf(switchDefault);

    expect(addColumnAt).toBeGreaterThan(-1);
    expect(switchDefaultAt).toBeGreaterThan(addColumnAt);
    expect(sql).not.toMatch(/UPDATE\s+prompt_wizard_settings\s+SET\s+engine_version\s*=\s*3/i);
  });

  it('建立创意集合、方案修订、来源追踪和匿名日聚合边界', async () => {
    const sql = await readFile(migrationUrl, 'utf8');

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS engine_version');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS production_brief jsonb');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS evidence_graph jsonb');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS prompt_wizard_concept_sets');
    expect(sql).toContain('jsonb_array_length(candidates) = 8');
    expect(sql).toContain('cardinality(recommended_concept_ids) = 2');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS prompt_wizard_plan_revisions');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS concept_set_id uuid');
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS selected_concept_ids uuid[]");
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS prompt_wizard_source jsonb');
    expect(sql).toContain('source_delivery_version = 4 AND NEW.prompt_wizard_engine_version <> 3');
    expect(sql.match(/source_(?:batch|revision)\.content_purged_at IS NOT NULL/g)?.length).toBe(2);
    expect(sql).toContain('source_run.expires_at <= now()');
    expect(sql).toContain("source_run.status = 'archived'");
    expect(sql).toContain('source_run.user_id <> NEW.user_id');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS prompt_wizard_daily_metrics');
    expect(sql).toContain("WHERE is_free AND status <> 'failed'");
    expect(sql).toContain('必须各选择一条可信转化型与强钩子型路线');
  });

  it('保留历史 Provider operation 并加入 3.0 成本操作', async () => {
    const sql = await readFile(migrationUrl, 'utf8');

    for (const operation of [
      'analyze-product',
      'repair-product-chinese',
      'repair-product-profile',
      'repair-product-format',
      'generate-drafts',
      'repair-draft-format',
      'repair-draft-content',
      'generate-concepts',
      'repair-concept-set',
      'refine-plan',
    ]) {
      expect(sql).toContain(`'${operation}'`);
    }
  });

  it('24 小时内容表具备到期和清理字段，匿名指标不关联业务实体', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    const metricsStart = sql.indexOf('CREATE TABLE IF NOT EXISTS prompt_wizard_daily_metrics');
    const metricsSql = sql.slice(metricsStart, sql.indexOf('COMMENT ON TABLE', metricsStart));

    expect(sql.match(/now\(\) \+ interval '24 hours'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql.match(/content_purged_at timestamptz/g)?.length).toBeGreaterThanOrEqual(2);
    expect(metricsSql).not.toMatch(/\b(user_id|run_id|batch_id|asset_id|prompt|content)\b/i);
    expect(metricsSql).not.toContain('REFERENCES');
  });
});
