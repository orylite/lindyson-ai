import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../migrations/071_prompt_wizard_v6_three_routes.sql',
  import.meta.url,
);

describe('071 提示词向导 V6 三路线迁移', () => {
  it('使用有限超时、唯一设置单例与三态门禁 fail-closed', async () => {
    const sql = await migrationSql();

    expect(sql).toContain("SET LOCAL lock_timeout = '5s'");
    expect(sql).toContain("SET LOCAL statement_timeout = '120s'");
    expect(sql).toContain('LOCK TABLE prompt_wizard_settings IN SHARE ROW EXCLUSIVE MODE');
    expect(sql).toContain('settings_count <> 1');
    expect(sql).toContain('settings_engine = 3 AND settings_available = false');
    expect(sql).toContain('AND NOT EXISTS (SELECT 1 FROM users)');
    expect(sql).toContain('AND NOT EXISTS (SELECT 1 FROM prompt_wizard_runs)');
    expect(sql).toContain('AND NOT EXISTS (SELECT 1 FROM prompt_wizard_batches)');
    expect(sql).toContain('AND NOT EXISTS (SELECT 1 FROM prompt_wizard_provider_requests)');
    expect(sql).toContain('replay_complete := settings_engine = 4');
    expect(sql).toContain('AND settings_available = false');
    expect(sql).toContain("to_regclass('public.prompt_wizard_route_sets') IS NOT NULL");
    expect(sql).toContain('SELECT count(*) = 20');
    expect(sql).toContain("('prompt_wizard_route_sets_pkey', 'prompt_wizard_route_sets', 'p'");
    expect(sql).toContain("('prompt_wizard_route_sets_run_id_fkey', 'prompt_wizard_route_sets', 'f', 'prompt_wizard_runs'");
    expect(sql).toContain("('prompt_wizard_route_sets_user_id_fkey', 'prompt_wizard_route_sets', 'f', 'users'");
    expect(sql).toContain("('prompt_wizard_route_sets_user_id_idempotency_key_key', 'prompt_wizard_route_sets', 'u'");
    expect(sql).toContain("('prompt_wizard_route_sets_completed_shape_check', 'prompt_wizard_route_sets', 'c'");
    expect(sql).toContain("('prompt_wizard_route_sets_pending_shape_check', 'prompt_wizard_route_sets', 'c'");
    expect(sql).toContain("('prompt_wizard_route_sets_failed_shape_check', 'prompt_wizard_route_sets', 'c'");
    expect(sql).toContain("('prompt_wizard_route_sets_purge_shape_check', 'prompt_wizard_route_sets', 'c'");
    expect(sql).toContain('SELECT count(*) = 13\n      FROM pg_constraint constraint_definition');
    expect(sql).toContain('SELECT count(*) = 5\n      FROM pg_index index_definition');
    expect(sql).toContain('SELECT count(*) = 1\n      FROM pg_trigger trigger_definition');
    expect(sql).toContain('AND NOT trigger_definition.tgisinternal');
    expect(sql).toContain("constraint_definition.conrelid = to_regclass('public.' || required.relation_name)");
    expect(sql).toContain("constraint_definition.confdeltype = 'r'");
    expect(sql).toContain("trigger_definition.tgrelid = to_regclass('public.' || required.relation_name)");
    expect(sql).toContain("index_definition.indrelid = to_regclass('public.' || required.relation_name)");
    expect(sql).toContain("obj_description(constraint_definition.oid, 'pg_constraint') =");
    expect(sql).toContain("obj_description(trigger_definition.oid, 'pg_trigger') =");
    expect(sql).toContain("obj_description(index_relation.oid, 'pg_class') =");
    expect(sql).toContain("obj_description(function_definition.oid, 'pg_proc') =");
    expect(sql).toContain("'migration071-definition:' || md5(");
    expect(sql).toContain("function_definition.prorettype = 'trigger'::regtype");
    expect(sql).toContain("AND data_type = 'uuid'\n        AND is_nullable = 'YES'");
    expect(sql).toContain('SELECT count(*) = 6');
    expect(sql).toContain("('id', ARRAY['gen_random_uuid']::text[])");
    expect(sql).toContain("('expires_at', ARRAY[");
    expect(sql).toContain("attribute.atttypid = 'smallint'::regtype");
    expect(sql).toContain("IN ('4', '4::smallint', '''4''::smallint')");
    expect(sql).toContain("('generation_tasks_prompt_wizard_source_check', 'generation_tasks'");
    expect(sql).toContain("('trg_validate_prompt_wizard_provider_route_owner', 'prompt_wizard_provider_requests')");
    expect(sql).toContain("('idx_prompt_wizard_provider_requests_route_set_created', 'prompt_wizard_provider_requests'");
    expect(sql).toContain('Migration 071 拒绝配置或结构漂移');

    const guardIndex = sql.indexOf('DO $prompt_wizard_v6_cutover_guard$');
    const firstAlterIndex = sql.indexOf('ALTER TABLE prompt_wizard_runs');
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(firstAlterIndex).toBeGreaterThan(guardIndex);
  });

  it('将新任务固定为引擎 4，同时保留历史 2/3 标记', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('CHECK (engine_version IN (2, 3, 4))');
    expect(sql).toContain('CHECK (engine_version = 4)');
    expect(sql).toContain('prompt_wizard_daily_metrics_engine_version_check');
    expect(sql).toContain("TG_OP = 'INSERT' AND NEW.engine_version <> 4");
    expect(sql).toContain('引擎版本不可修改');
    expect(sql).not.toMatch(/UPDATE\s+prompt_wizard_runs\b/iu);

    const dropLegacySettingsConstraint = sql.indexOf(
      'DROP CONSTRAINT IF EXISTS prompt_wizard_settings_engine_version_check',
    );
    const promoteSettingsToV6 = sql.indexOf(
      'UPDATE prompt_wizard_settings\nSET engine_version = 4',
    );
    expect(dropLegacySettingsConstraint).toBeGreaterThanOrEqual(0);
    expect(promoteSettingsToV6).toBeGreaterThan(dropLegacySettingsConstraint);
    expect(sql).toContain('SET engine_version = 4,\n    available = false');
    expect(sql).toContain('WHERE engine_version <> 4 OR available <> false');
  });

  it('重放门禁精确限制 route_sets 对象总数并绑定约束、索引和触发器到预期关系', async () => {
    const sql = await migrationSql();

    for (const constraintName of [
      'prompt_wizard_route_sets_pkey',
      'prompt_wizard_route_sets_run_id_fkey',
      'prompt_wizard_route_sets_user_id_fkey',
      'prompt_wizard_route_sets_user_id_idempotency_key_key',
      'prompt_wizard_route_sets_run_revision_check',
      'prompt_wizard_route_sets_status_check',
      'prompt_wizard_route_sets_provider_input_tokens_check',
      'prompt_wizard_route_sets_provider_output_tokens_check',
      'prompt_wizard_route_sets_attempt_count_check',
      'prompt_wizard_route_sets_completed_shape_check',
      'prompt_wizard_route_sets_pending_shape_check',
      'prompt_wizard_route_sets_failed_shape_check',
      'prompt_wizard_route_sets_purge_shape_check',
    ]) {
      expect(sql).toContain(`('${constraintName}', 'prompt_wizard_route_sets'`);
    }
    for (const indexName of [
      'idx_prompt_wizard_route_sets_one_active',
      'idx_prompt_wizard_route_sets_run_created',
      'idx_prompt_wizard_route_sets_expiry',
      'idx_prompt_wizard_batches_route_set',
      'idx_prompt_wizard_provider_requests_route_set_created',
    ]) {
      expect(sql).toContain(`('${indexName}',`);
    }
    for (const [triggerName, relationName] of [
      ['trg_enforce_prompt_wizard_run_engine_version', 'prompt_wizard_runs'],
      ['trg_validate_prompt_wizard_route_set', 'prompt_wizard_route_sets'],
      ['trg_validate_prompt_wizard_batch_route_set', 'prompt_wizard_batches'],
      ['trg_validate_prompt_wizard_provider_terminal_calibration_owner', 'prompt_wizard_provider_requests'],
      ['trg_validate_prompt_wizard_provider_route_owner', 'prompt_wizard_provider_requests'],
    ]) {
      expect(sql).toContain(`('${triggerName}', '${relationName}')`);
    }
    for (const functionName of [
      'enforce_prompt_wizard_run_engine_version',
      'validate_prompt_wizard_route_set',
      'validate_prompt_wizard_batch_route_set',
      'validate_prompt_wizard_provider_terminal_calibration_owner',
      'validate_prompt_wizard_provider_route_owner',
      'preserve_prompt_wizard_provider_request_ledger',
      'sync_generation_task_prompt_wizard_source',
    ]) {
      expect(sql).toContain(`('${functionName}')`);
    }
    expect(sql).toContain('DO $prompt_wizard_v6_definition_signatures$');
    expect(sql).toContain('md5(pg_get_constraintdef(constraint_definition.oid, true))');
    expect(sql).toContain('md5(pg_get_triggerdef(trigger_definition.oid, true))');
    expect(sql).toContain('md5(pg_get_indexdef(index_relation.oid, 0, true))');
    expect(sql).toContain('md5(pg_get_functiondef(function_definition.oid))');
  });

  it('建立内部三路线集合并按固定索引交付三个商业角色', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS prompt_wizard_route_sets');
    expect(sql).toContain("status IN ('queued', 'processing', 'completed', 'failed')");
    expect(sql).toContain('jsonb_array_length(routes) = 3');
    expect(sql).toContain("routes -> 0 ->> 'role' = 'proof-conversion'");
    expect(sql).toContain("routes -> 1 ->> 'role' = 'problem-hook'");
    expect(sql).toContain("routes -> 2 ->> 'role' = 'lifestyle-seeding'");
    expect(sql).toContain('必须按索引 0 产品自证、1 痛点钩子、2 场景种草交付');
    expect(sql).toContain('run_record.engine_version <> 4');
    expect(sql).toContain("expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')");
  });

  it('V6 批次关联 route_set_id 并严格包含三个 deliveryVersion 6 方案', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS route_set_id uuid');
    expect(sql).toContain('prompt_wizard_batches_route_set_fk');
    expect(sql).toContain('prompt_wizard_batches_source_selection_check');
    expect(sql).toContain('prompt_wizard_batches 三路线集合不可用于当前批次');
    expect(sql).toContain('jsonb_array_length(plans) = 3');
    for (const index of [0, 1, 2]) {
      expect(sql).toContain(`jsonb_path_exists(plans, '$[${index}] ? (@.deliveryVersion == 6)')`);
    }
    expect(sql).toContain("plans -> 0 ->> 'role' = 'proof-conversion'");
    expect(sql).toContain("plans -> 1 ->> 'role' = 'problem-hook'");
    expect(sql).toContain("plans -> 2 ->> 'role' = 'lifestyle-seeding'");
    expect(sql).not.toContain("jsonb_path_exists(plans, '$[*] ? (@.role");
  });

  it('Provider 三路线调用使用 route-set 作用域并纳入不可变成本身份', async () => {
    const sql = await migrationSql();

    expect(sql).toContain("'generate-routes'");
    expect(sql).toContain("'repair-routes'");
    expect(sql).toContain("request_key LIKE ('route-set:' || route_set_id::text || ':%')");
    expect(sql).toContain('NEW.route_set_id, NEW.user_id, NEW.operation');
    expect(sql).toContain('OLD.route_set_id, OLD.user_id, OLD.operation');
    expect(sql).toContain('prompt_wizard_provider_requests 与三路线集合归属不一致');
  });

  it('只为引擎 4 的 V6 批次终局口播校准增加第三轮成本身份且不改写历史账本', async () => {
    const sql = await migrationSql();

    expect(sql).toContain(
      'DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_repair_round_check',
    );
    expect(sql).toContain('repair_round BETWEEN 0 AND 2');
    expect(sql).toContain("repair_round = 3 AND operation = 'repair-draft-content'");
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION validate_prompt_wizard_provider_terminal_calibration_owner()',
    );
    expect(sql).toContain('batch_record.route_set_id IS NULL');
    expect(sql).toContain('batch_record.run_id <> NEW.run_id');
    expect(sql).toContain('batch_record.user_id <> NEW.user_id');
    expect(sql).toContain('run_record.user_id <> NEW.user_id');
    expect(sql).toContain('run_record.engine_version <> 4');
    expect(sql).toContain(
      'DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_provider_terminal_calibration_owner',
    );
    expect(sql).not.toMatch(/UPDATE\s+prompt_wizard_provider_requests\b/iu);
  });

  it('视频任务来源将 delivery 6 固定映射到引擎 4', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('source_delivery_version IN (4, 5)');
    expect(sql).toContain('source_delivery_version = 6 AND NEW.prompt_wizard_engine_version <> 4');
    expect(sql).toContain('source_delivery_version BETWEEN 1 AND 3');
    expect(sql).toContain('prompt_wizard_engine_version IN (2, 3, 4)');
    expect(sql).toContain('generation_tasks 提示词版本与来源方案不一致');
  });

  it('不改写历史方案、积分流水或 Provider 成本流水', async () => {
    const sql = await migrationSql();

    expect(sql).not.toMatch(/UPDATE\s+prompt_wizard_batches\b/iu);
    expect(sql).not.toMatch(/UPDATE\s+prompt_wizard_(?:concept_sets|use_direction_sets|plan_revisions)\b/iu);
    expect(sql).not.toMatch(/UPDATE\s+prompt_wizard_provider_requests\b/iu);
    expect(sql).not.toMatch(/UPDATE\s+(?:credit_allocations|credit_ledger)\b/iu);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+prompt_wizard_/iu);
  });

  it('可重复执行命名对象定义，不依赖覆盖历史业务数据', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS prompt_wizard_route_sets');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS route_set_id uuid');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_wizard_route_sets_one_active');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION validate_prompt_wizard_route_set()');
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_route_set');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS prompt_wizard_batches_v3_only_completed_shape_check');
  });
});

function migrationSql() {
  return readFile(migrationUrl, 'utf8');
}
