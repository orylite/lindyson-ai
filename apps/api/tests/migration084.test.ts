import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';

async function migrationSql() {
  return readFile(
    new URL('../migrations/084_provider_billing_report_indexes.sql', import.meta.url),
    'utf8',
  );
}

describe('Migration 084 成本报表账单证据索引', () => {
  it('为官方同步证据与最新对账状态提供同一前缀索引', async () => {
    const sql = await migrationSql();
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_provider_reconciliation_runs_official_latest');
    expect(sql).toContain('official_sync_run_id, created_at DESC, id DESC');
    expect(sql).toContain('INCLUDE (bill_state)');
    expect(sql).toContain('WHERE official_sync_run_id IS NOT NULL');
    expect(sql).not.toContain('CONCURRENTLY');
  });
});
