import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../migrations/069_prompt_wizard_v3_only.sql',
  import.meta.url,
);

describe('069 提示词向导 3.0 独占运行迁移', () => {
  it('只对未标记历史任务推断版本，并保持重放后的版本稳定', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS engine_version smallint');
    expect(sql).toContain('WHERE run.engine_version IS NULL');
    expect(sql).toContain('run.evidence_graph IS NOT NULL');
    expect(sql).toContain('FROM prompt_wizard_concept_sets concept_set');
    expect(sql).toContain('@.deliveryVersion == 4');
    expect(sql).toContain('FROM prompt_wizard_plan_revisions revision');
    expect(sql).toContain('ALTER COLUMN engine_version SET DEFAULT 3');
    expect(sql).toContain('ALTER COLUMN engine_version SET NOT NULL');
  });

  it('在清理前阻断仍运行或仍冻结积分的 2.0 任务', async () => {
    const sql = await migrationSql();
    const guardStart = sql.indexOf('DO $prompt_wizard_v3_cutover_guard$');
    const firstPurge = sql.indexOf('UPDATE prompt_wizard_concept_sets concept_set');
    const guardSql = sql.slice(guardStart, firstPurge);

    expect(guardStart).toBeGreaterThan(-1);
    expect(firstPurge).toBeGreaterThan(guardStart);
    expect(guardSql).toContain("run.status = 'analyzing'");
    expect(guardSql).toContain("batch.status IN ('queued', 'processing')");
    expect(guardSql).toContain("provider_request.request_status = 'started'");
    expect(guardSql).toContain("batch.credit_status = 'held'");
    expect(guardSql).toContain("allocation.status = 'held'");
    expect(guardSql).toContain('Migration 069 拒绝归档仍在运行的 2.0 任务');
    expect(guardSql).toContain('Migration 069 拒绝归档仍有冻结积分的 2.0 批次');
  });

  it('归档 2.0 并清除产品、素材、方案和失败正文', async () => {
    const sql = await migrationSql();

    expect(sql).toMatch(/UPDATE prompt_wizard_runs run[\s\S]*status = 'archived'/u);
    expect(sql).toContain("image_asset_ids = '{}'::uuid[]");
    for (const field of [
      'product_profile = NULL',
      'creative_brief = NULL',
      'video_config = NULL',
      'production_brief = NULL',
      'evidence_graph = NULL',
      'candidates = NULL',
      'recommended_concept_ids = \'{}\'::uuid[]',
      'plan = NULL',
      'replacement_scene = NULL',
      'plans = NULL',
      "strategy_signatures = '[]'::jsonb",
      'failure_reason = NULL',
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql.match(/content_purged_at = COALESCE/g)?.length).toBe(3);
  });

  it('固定全局版本并对新增任务和历史版本建立数据库保护', async () => {
    const sql = await migrationSql();

    expect(sql).toMatch(/UPDATE prompt_wizard_settings[\s\S]*engine_version = 3/u);
    expect(sql).toContain('CHECK (engine_version = 3)');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION enforce_prompt_wizard_run_engine_version()');
    expect(sql).toContain("TG_OP = 'INSERT' AND NEW.engine_version <> 3");
    expect(sql).toContain('NEW.engine_version IS DISTINCT FROM OLD.engine_version');
  });

  it('非清理完成批次必须关联创意集合、两个选择和两个 V4 方案', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('prompt_wizard_batches_v3_only_completed_shape_check');
    expect(sql).toContain("status <> 'completed'");
    expect(sql).toContain('content_purged_at IS NOT NULL');
    expect(sql).toContain('concept_set_id IS NOT NULL');
    expect(sql).toContain('cardinality(selected_concept_ids) = 2');
    expect(sql).toContain('selected_concept_ids[1] IS NOT NULL');
    expect(sql).toContain('selected_concept_ids[2] IS NOT NULL');
    expect(sql).toContain('selected_concept_ids[1] <> selected_concept_ids[2]');
    expect(sql).toContain('jsonb_array_length(plans) = 2');
    expect(sql).toContain("jsonb_path_exists(plans, '$[0] ? (@.deliveryVersion == 4)')");
    expect(sql).toContain("jsonb_path_exists(plans, '$[1] ? (@.deliveryVersion == 4)')");
  });

  it('不删除或改写财务账本、Provider 成本、审计和匿名指标', async () => {
    const sql = await migrationSql();

    for (const table of [
      'credit_allocations',
      'credit_ledger',
      'prompt_wizard_provider_requests',
      'prompt_wizard_historical_operation_cost_evidence',
      'prompt_wizard_daily_metrics',
    ]) {
      expect(sql).not.toMatch(new RegExp(`(?:UPDATE|DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?)\\s+${table}\\b`, 'iu'));
    }
  });
});

function migrationSql() {
  return readFile(migrationUrl, 'utf8');
}
