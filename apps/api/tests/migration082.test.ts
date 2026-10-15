import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function migrationSql() {
  return readFile(
    new URL('../migrations/082_tk_prompt_engine.sql', import.meta.url),
    'utf8',
  );
}

describe('082 TK Prompt Engine 1.0 独立迁移', () => {
  it('只新增独立领域表，不扩写历史 V6 业务表和固定路线约束', async () => {
    const sql = await migrationSql();
    for (const table of [
      'tk_prompt_engine_settings',
      'tk_prompt_runs',
      'tk_prompt_generations',
      'tk_prompt_options',
      'tk_prompt_provider_requests',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).not.toMatch(/ALTER TABLE prompt_wizard_(?:runs|batches|route_sets|provider_requests)/u);
    expect(sql).not.toContain("deliveryVersion == 6");
    expect(sql).not.toContain("role' = 'proof-conversion");
    expect(sql).toContain('available boolean NOT NULL DEFAULT false');
    expect(sql).toContain('v6_retired_at timestamptz');
    expect(sql).toContain('tk_prompt_engine_settings_cutover_shape_check');
    expect(sql).toContain('tk_prompt_engine_preserve_v6_retirement()');
    expect(sql).toContain('NEW.v6_retired_at IS DISTINCT FROM OLD.v6_retired_at');
    expect(sql).toContain('cardinality(image_asset_ids) BETWEEN 1 AND 9');
    expect(sql).toContain('tk_prompt_uuid_array_is_unique(image_asset_ids)');
  });

  it('三方案并行表锁定槽位、可执行模式、授权演员和完成收口', async () => {
    const sql = await migrationSql();
    expect(sql).toContain("slot IN ('safe', 'native', 'creative')");
    expect(sql).toContain('UNIQUE (generation_id, slot)');
    expect(sql).toContain("'product_closeup', 'scene_demo', 'live_presenter'");
    expect(sql).toContain("strategy_blueprint ->> 'authorizedActorAssetId'");
    expect(sql).toContain("strategy_blueprint ->> 'videoMode' <> 'graphic_montage'");
    expect(sql).toContain('validate_tk_prompt_generation_completion()');
    expect(sql).toContain('completed_options <> 3 OR completed_slots <> 3');
    expect(sql).toContain('tk_prompt_runs_claim_shape_check');
    expect(sql).toContain('tk_prompt_generations_claim_shape_check');
    expect(sql).toContain('tk_prompt_options_claim_shape_check');
    expect(sql).toContain('claim_token uuid');
    expect(sql).toContain('validate_tk_prompt_claim_transition()');
    expect(sql).toContain('attempt_count > OLD.attempt_count + 1');
    expect(sql).toContain('NEW.started_at <= OLD.started_at');
    expect(sql).toContain('已有 Provider 调用事实的 claim 不可重置');
    expect(sql).toContain("WHEN 'completed' THEN NEW.status = 'completed'");
    expect(sql).toContain("parent_generation_status IS DISTINCT FROM 'expanding'");
  });

  it('Provider成本账本按 analysis/strategy/option 归属且最多一次定向修复', async () => {
    const sql = await migrationSql();
    expect(sql).toContain("stage IN ('analysis', 'strategy', 'option')");
    expect(sql).toContain('repair_round BETWEEN 0 AND 1');
    expect(sql).toContain('tk_prompt_provider_requests_claim_token_check');
    expect(sql).toContain('idx_tk_prompt_provider_requests_logical_attempt');
    expect(sql).toContain('NULLS NOT DISTINCT');
    expect(sql).toContain("action = 'repair-option' AND repair_round = 1");
    expect(sql).toContain('source_option.claim_token IS DISTINCT FROM NEW.claim_token');
    expect(sql).toContain('source_option.attempt_count <> NEW.job_attempt');
    expect(sql).toContain('expected_request_key');
    const logicalAttemptIndex = sql.slice(
      sql.indexOf('CREATE UNIQUE INDEX idx_tk_prompt_provider_requests_logical_attempt'),
      sql.indexOf('CREATE OR REPLACE FUNCTION validate_tk_prompt_provider_request_owner()'),
    );
    expect(logicalAttemptIndex).not.toContain('job_attempt');
    expect(logicalAttemptIndex).not.toContain('claim_token');
    expect(sql).toContain("stage = 'analysis' AND generation_id IS NULL AND option_id IS NULL");
    expect(sql).toContain("stage = 'strategy' AND generation_id IS NOT NULL AND option_id IS NULL");
    expect(sql).toContain("stage = 'option' AND generation_id IS NOT NULL AND option_id IS NOT NULL");
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON tk_prompt_provider_requests');
  });

  it('积分和Seedance来源使用新关联并与旧来源互斥', async () => {
    const sql = await migrationSql();
    expect(sql).toContain('related_tk_prompt_generation_id');
    expect(sql).toContain('FOREIGN KEY (related_tk_prompt_generation_id, user_id)');
    expect(sql).toContain('REFERENCES tk_prompt_generations(id, user_id)');
    expect(sql).toContain("'tk-prompt-engine'");
    expect(sql).toContain("'tk-prompt-engine-refund'");
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS tk_prompt_source jsonb');
    expect(sql).toContain('sync_generation_task_tk_prompt_source()');
    expect(sql).toContain('generation_tasks_prompt_source_exclusive_check');
    expect(sql).toContain('NOT (prompt_wizard_source IS NOT NULL AND tk_prompt_source IS NOT NULL)');
    expect(sql).toContain('source_run.expires_at <= clock_timestamp()');
    expect(sql).toContain('source_generation.expires_at <= clock_timestamp()');
    expect(sql).toContain('NEW.tk_prompt_schema_version IS DISTINCT FROM 1');
    expect(sql).toContain('AND tk_prompt_schema_version IS NOT NULL');
    expect(sql).toContain('AND tk_prompt_edit_bucket IS NOT NULL');
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF\s+user_id,/u);
    expect(sql).toContain("source_run.status <> 'ready'");
    expect(sql).toContain('FOR SHARE');
    expect(sql).not.toContain('source_option.expires_at');

    const triggerBody = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION sync_generation_task_tk_prompt_source()'),
      sql.indexOf('DROP TRIGGER IF EXISTS trg_sync_generation_task_tk_prompt_source'),
    );
    const generationLock = triggerBody.indexOf('INTO source_generation');
    const optionLock = triggerBody.indexOf('INTO source_option');
    const runLock = triggerBody.indexOf('INTO source_run');
    expect(generationLock).toBeGreaterThanOrEqual(0);
    expect(optionLock).toBeGreaterThan(generationLock);
    expect(runLock).toBeGreaterThan(optionLock);
  });
});
