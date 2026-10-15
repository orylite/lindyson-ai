import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../migrations/070_prompt_wizard_use_directions.sql',
  import.meta.url,
);

describe('070 产品使用方向优先迁移', () => {
  it('建立 2–3 个方向、固定补充问题和 24 小时清理边界', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS prompt_wizard_use_direction_sets');
    expect(sql).toContain("status IN ('queued', 'processing', 'needs-input', 'completed', 'failed')");
    expect(sql).toContain('jsonb_array_length(directions) BETWEEN 2 AND 3');
    expect(sql).toContain('请补充一个您确认真实、希望重点展示的用途或卖点。');
    expect(sql).toContain('clarification_count BETWEEN 0 AND 1');
    expect(sql).toContain("expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')");
    expect(sql).toContain('content_purged_at IS NULL');
    expect(sql).toContain('推荐场景不属于当前方向');
  });

  it('批次严格区分历史 V4 Concept 与新版 V5 使用方向来源', async () => {
    const sql = await migrationSql();

    for (const column of [
      'ADD COLUMN IF NOT EXISTS use_direction_set_id uuid',
      'ADD COLUMN IF NOT EXISTS selected_use_direction_id uuid',
      'ADD COLUMN IF NOT EXISTS selected_scene_id uuid',
      'ADD COLUMN IF NOT EXISTS custom_scene jsonb',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain('prompt_wizard_batches_source_selection_check');
    expect(sql).toContain('((selected_scene_id IS NULL) <> (custom_scene IS NULL))');
    expect(sql).toContain("custom_scene ->> 'environment'");
    expect(sql).toContain('prompt_wizard_batches_use_direction_purge_check');
    expect(sql).toContain('selected_concept_ids[1] <> selected_concept_ids[2]');
    expect(sql).toContain('IF NEW.content_purged_at IS NOT NULL THEN');
    expect(sql).toContain('IF NEW.use_direction_set_id IS NULL THEN');
    expect(sql).toMatch(/IF NEW\.content_purged_at IS NOT NULL THEN\s+RETURN NEW;/u);
    expect(sql).toContain("jsonb_path_exists(plans, '$[0] ? (@.deliveryVersion == 4)')");
    expect(sql).toContain("jsonb_path_exists(plans, '$[1] ? (@.deliveryVersion == 4)')");
    expect(sql).toContain("jsonb_path_exists(plans, '$[0] ? (@.deliveryVersion == 5)')");
    expect(sql).toContain("jsonb_path_exists(plans, '$[1] ? (@.deliveryVersion == 5)')");
  });

  it('单方案微调按 V4/V5 使用互斥且语义正确的来源 id', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('ALTER COLUMN concept_id DROP NOT NULL');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS use_direction_id uuid');
    expect(sql).toContain('(concept_id IS NULL) <> (use_direction_id IS NULL)');
    expect(sql).toContain("concept_id IS NOT NULL AND plan ->> 'deliveryVersion' = '4'");
    expect(sql).toContain("use_direction_id IS NOT NULL AND plan ->> 'deliveryVersion' = '5'");
    expect(sql).toContain('V5 使用方向不属于原批次');
  });

  it('Provider 新操作归属于 use-direction-set 作用域并纳入不可变身份', async () => {
    const sql = await migrationSql();

    expect(sql).toContain("'generate-use-directions'");
    expect(sql).toContain("'repair-use-directions'");
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS use_direction_set_id uuid');
    expect(sql).toContain("request_key LIKE ('use-direction-set:' || use_direction_set_id::text || ':%')");
    expect(sql).toContain('NEW.batch_id, NEW.use_direction_set_id, NEW.user_id');
    expect(sql).toContain('OLD.batch_id, OLD.use_direction_set_id, OLD.user_id');
    expect(sql).toContain('prompt_wizard_provider_requests 与使用方向集合归属不一致');
  });

  it('视频任务来源版本兼容历史方案，并把 V4/V5 固定归属 3.0', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('source_delivery_version IN (4, 5)');
    expect(sql).toContain('NEW.prompt_wizard_engine_version <> 3');
    expect(sql).toContain('source_delivery_version BETWEEN 1 AND 3');
    expect(sql).toContain('NEW.prompt_wizard_engine_version <> 2');
    expect(sql).toContain('generation_tasks 提示词版本与来源方案不一致');
  });

  it('可重复执行且不改写历史 Concept、V4 或成本流水', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS prompt_wizard_use_direction_sets');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION validate_prompt_wizard_use_direction_set()');
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_use_direction_set');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS prompt_wizard_batches_source_selection_check');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_operation_check');
    expect(sql).not.toMatch(/UPDATE\s+prompt_wizard_(?:concept_sets|batches|provider_requests)\b/iu);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+prompt_wizard_/iu);
  });
});

function migrationSql() {
  return readFile(migrationUrl, 'utf8');
}
