import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readMigration() {
  return readFile(new URL('../migrations/078_exact_user_pagination.sql', import.meta.url), 'utf8');
}

describe('078 用户端精准分页资源版本迁移', () => {
  it('创建按用户和资源唯一的单调版本表', async () => {
    const sql = await readMigration();

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS user_pagination_versions');
    expect(sql).toContain('PRIMARY KEY (user_id, resource)');
    expect(sql).toContain('version = user_pagination_versions.version + 1');
  });

  it('五类用户列表使用语句级 transition table 触发器', async () => {
    const sql = await readMigration();

    for (const table of ['assets', 'generation_tasks', 'credit_ledger', 'orders', 'tickets']) {
      expect(sql).toMatch(new RegExp(`AFTER (?:INSERT|DELETE|UPDATE) ON ${table}`));
    }
    expect(sql).toContain('REFERENCING NEW TABLE AS pagination_new_rows');
    expect(sql).toContain('REFERENCING OLD TABLE AS pagination_old_rows');
    expect(sql).toContain('FOR EACH STATEMENT');
    expect(sql).not.toContain('FOR EACH ROW');
  });

  it('订单状态与开票申请都会使对应快照失效', async () => {
    const sql = await readMigration();
    const orderUpdate = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION pagination_bump_orders_update()'),
      sql.indexOf('DROP TRIGGER IF EXISTS pagination_orders_insert'),
    );

    expect(orderUpdate).toMatch(
      /ROW\(old_row\.id, old_row\.user_id, old_row\.status, old_row\.created_at\)[\s\S]*ROW\(new_row\.id, new_row\.user_id, new_row\.status, new_row\.created_at\)/,
    );
    expect(orderUpdate).toContain("'orders:all'");
    expect(orderUpdate).toContain("'orders:invoiceable'");
    expect(sql).toMatch(/AFTER (?:INSERT|DELETE|UPDATE) ON invoice_requests/);
  });

  it('生成任务普通状态轮询不使未按状态筛选的队列版本失效', async () => {
    const sql = await readMigration();
    const generationUpdate = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION pagination_bump_generation_update()'),
      sql.indexOf('DROP TRIGGER IF EXISTS pagination_generation_insert'),
    );

    expect(generationUpdate).toContain('membership_changed');
    expect(generationUpdate).toContain('status_membership_changed');
    expect(generationUpdate).toMatch(/ROW\(old_row\.id, old_row\.user_id, old_row\.kind, old_row\.created_at\)/);
    expect(generationUpdate).toContain("'generation:' || old_kind || ':all'");
  });
});
