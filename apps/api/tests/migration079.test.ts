import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function migrationSql() {
  return readFile(new URL('../migrations/079_exact_admin_pagination.sql', import.meta.url), 'utf8');
}

describe('Migration 079 后台精准分页版本', () => {
  it('使用独立全局资源版本，不伪造业务用户 UUID', async () => {
    const sql = await migrationSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS admin_pagination_versions');
    expect(sql).toContain('resource text PRIMARY KEY');
    expect(sql).toContain('version = admin_pagination_versions.version + 1');
    expect(sql).not.toContain('user_id uuid');
    expect(sql).not.toContain('OFFSET');
  });

  it('核心八个后台资源都由语句级触发器失效', async () => {
    const sql = await migrationSql();
    for (const resource of [
      'admin-users',
      'admin-orders',
      'admin-invoices',
      'admin-tickets',
      'admin-jobs',
      'admin-credit-ledger',
      'admin-audit-logs',
      'admin-announcements-v1-published-desc',
    ]) {
      expect(sql, resource).toContain(`'${resource}'`);
    }
    expect(sql).toContain('FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger');
    expect(sql).not.toContain('FOR EACH ROW');
  });

  it('用户多列更新只有一个语句级触发器，且使联表搜索资源一起失效', async () => {
    const sql = await migrationSql();
    const start = sql.indexOf('CREATE TRIGGER admin_pagination_users_update');
    const end = sql.indexOf('DROP TRIGGER IF EXISTS admin_pagination_plans_user_list_update');
    const identityTrigger = sql.slice(start, end);
    const functionStart = sql.indexOf('CREATE OR REPLACE FUNCTION admin_pagination_bump_users_update()');
    const functionEnd = sql.indexOf('DROP TRIGGER IF EXISTS admin_pagination_users_identity_update');
    const identityFunction = sql.slice(functionStart, functionEnd);
    expect(identityTrigger).toContain('AFTER UPDATE ON users');
    expect(identityTrigger).toContain(
      'REFERENCING OLD TABLE AS admin_pagination_old_rows NEW TABLE AS admin_pagination_new_rows',
    );
    expect(sql.match(/CREATE TRIGGER admin_pagination_users_update/g)).toHaveLength(1);
    expect(sql).not.toContain('CREATE TRIGGER admin_pagination_users_identity_update');
    expect(sql).not.toContain('CREATE TRIGGER admin_pagination_users_list_update');
    for (const resource of [
      'admin-users', 'admin-orders', 'admin-invoices',
      'admin-tickets', 'admin-jobs', 'admin-credit-ledger',
    ]) {
      expect(identityFunction).toContain(`'${resource}'`);
    }
    expect(identityFunction).toContain('SELECT resource, 1, now() FROM resources');
    expect(identityFunction).toContain('UNION');
  });

  it('发票申请变化同时刷新发票列表和订单的开票状态', async () => {
    const sql = await migrationSql();
    for (const operation of ['insert', 'delete', 'update']) {
      const trigger = `admin_pagination_invoice_requests_${operation}`;
      const start = sql.indexOf(`CREATE TRIGGER ${trigger}`);
      const next = sql.indexOf('DROP TRIGGER IF EXISTS', start);
      const block = sql.slice(start, next < 0 ? undefined : next);
      expect(block).toContain("'admin-invoices', 'admin-orders'");
    }
  });
});
