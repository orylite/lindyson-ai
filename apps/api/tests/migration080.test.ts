import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function migrationSql() {
  return readFile(new URL('../migrations/080_exact_admin_cost_pagination.sql', import.meta.url), 'utf8');
}

describe('Migration 080 成本报表精准分页版本', () => {
  it('建立四个粗粒度报表族的全局单调版本', async () => {
    const sql = await migrationSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS admin_cost_pagination_versions');
    for (const resource of [
      'admin:cost-video', 'admin:cost-image',
      'admin:cost-multimodal', 'admin:provider-billing',
    ]) expect(sql).toContain(`'${resource}'`);
    expect(sql).toContain('FOR EACH STATEMENT');
    expect(sql).not.toContain('FOR EACH ROW');
    expect(sql).not.toContain('OFFSET');
  });

  it('覆盖任务、逐请求、官方账单、运营账本与资源包影响表', async () => {
    const sql = await migrationSql();
    for (const table of [
      'generation_tasks', 'generation_provider_runs', 'provider_usage_records',
      'image_provider_usage_records', 'prompt_wizard_runs', 'prompt_wizard_batches',
      'prompt_wizard_provider_requests', 'provider_operational_usage_records',
      'provider_operational_usage_valuations', 'provider_bill_details',
      'provider_bill_detail_revisions', 'provider_bill_sync_run_items',
      'provider_reconciliation_buckets', 'provider_reconciliation_cases',
      'provider_resource_package_acquisitions', 'provider_resource_package_snapshots',
      'provider_resource_package_cost_events',
    ]) expect(sql, table).toContain(`'${table}'`);
  });

  it('账单明细归属依赖的用户、旧用量与资源包购置也会使账单快照失效', async () => {
    const sql = await migrationSql();
    for (const triggerTarget of [
      "'users', 'users_admin_cost_pagination_version'",
      "'provider_usage_records', 'provider_usage_records_admin_cost_pagination_version'",
      "'provider_resource_package_acquisitions', 'provider_package_acquisitions_admin_cost_pagination_version'",
    ]) {
      const start = sql.indexOf(triggerTarget);
      expect(start, triggerTarget).toBeGreaterThanOrEqual(0);
      expect(sql.slice(start, start + 360), triggerTarget).toContain("'admin:provider-billing'");
    }
    expect(sql).toContain('AFTER UPDATE OF user_name, email ON users');
    expect(sql).not.toContain('AFTER UPDATE ON users');
  });

  it('任务心跳和提示词过期续租不会造成成本快照持续抖动', async () => {
    const sql = await migrationSql();
    expect(sql).toContain('AFTER UPDATE OF task_id, created_at ON generation_provider_runs');
    expect(sql).toContain('AFTER UPDATE OF kind, model, user_id, status, config, credits');
    expect(sql).toContain('AFTER UPDATE OF user_id, status, provider_model, provider_input_tokens');
    for (const irrelevant of ['heartbeat_at', 'lease_expires_at', 'expires_at']) {
      const updateClauses = sql.match(/AFTER UPDATE OF[\s\S]*? ON [a-z_]+/g) ?? [];
      expect(updateClauses.join('\n')).not.toContain(irrelevant);
    }
    expect(sql).not.toContain("'provider_pricing_rules', 'provider_pricing_rules_admin_cost_pagination_version'");
  });
});
