import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function migrationSql() {
  return readFile(
    new URL('../migrations/090_provider_billing_retention.sql', import.meta.url),
    'utf8',
  );
}

describe('Migration 090 账单保留清理与 pg_stat_statements', () => {
  it('创建 pg_stat_statements 扩展，权限不足时只告警不阻断迁移', async () => {
    const sql = await migrationSql();
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
    expect(sql).toContain('WHEN insufficient_privilege THEN');
    expect(sql).toContain('RAISE WARNING');
  });

  it('为删除 sync_runs 与快照时的外键检查和扫描顺序补索引', async () => {
    const sql = await migrationSql();
    expect(sql).toContain('idx_provider_bill_detail_revisions_sync_run');
    expect(sql).toContain('ON provider_bill_detail_revisions(sync_run_id)');
    expect(sql).toContain('idx_provider_bill_details_last_seen_run');
    expect(sql).toContain('ON provider_bill_details(last_seen_run_id)');
    expect(sql).toContain('idx_provider_resource_package_cost_events_source_snapshot');
    expect(sql).toContain('ON provider_resource_package_cost_events(source_snapshot_id)');
    expect(sql).toContain('idx_provider_resource_package_snapshots_captured_at');
    expect(sql).toContain('ON provider_resource_package_snapshots(captured_at, id)');
    expect(sql).not.toContain('CONCURRENTLY');
  });
});
