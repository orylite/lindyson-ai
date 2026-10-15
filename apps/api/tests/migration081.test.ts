import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function migrationSql() {
  return readFile(
    new URL('../migrations/081_ignore_empty_admin_pagination_writes.sql', import.meta.url),
    'utf8',
  );
}

describe('Migration 081 后台空写入不再使精准分页失效', () => {
  it('用事务级 tuple 计数和事务内 GUC 比较本语句前后差值', async () => {
    const sql = await migrationSql();
    for (const counter of ['inserted', 'updated', 'deleted']) {
      expect(sql).toContain(`pg_stat_get_xact_tuples_${counter}`);
      expect(sql).toContain(`setting_prefix || '${counter}'`);
    }
    expect(sql).toContain('admin_pagination_capture_statement_counters()');
    expect(sql).toContain('admin_pagination_statement_changed(');
    expect(sql).toContain('set_config(setting_prefix');
    expect(sql).toContain('true');
    expect(sql).not.toContain('OFFSET');
    expect(sql).not.toContain('FOR EACH ROW');
  });

  it('核心与成本版本函数都在无实际 tuple 变化时提前返回', async () => {
    const sql = await migrationSql();
    for (const [functionName, namespace] of [
      ['admin_pagination_bump_trigger', 'admin_pagination'],
      ['bump_admin_cost_pagination_versions', 'admin_cost_pagination'],
    ] as const) {
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${functionName}()`);
      const end = sql.indexOf('CREATE OR REPLACE FUNCTION', start + 1);
      const block = sql.slice(start, end < 0 ? undefined : end);
      expect(start, functionName).toBeGreaterThanOrEqual(0);
      expect(block).toContain(`admin_pagination_statement_changed('${namespace}', TG_RELID)`);
      expect(block).toContain('RETURN NULL');
      expect(block).toContain('FOREACH');
    }
  });

  it('从原 AFTER 触发器复制事件和 UPDATE OF 列，不重写资源参数', async () => {
    const sql = await migrationSql();
    expect(sql).toContain("'admin_pagination_bump_trigger()'::regprocedure");
    expect(sql).toContain("'bump_admin_cost_pagination_versions()'::regprocedure");
    expect(sql).toContain('installed_trigger.tgattr::smallint[]');
    expect(sql).toContain("array_to_string(event_parts, ' OR ')");
    expect(sql).toContain('BEFORE %s ON %s FOR EACH STATEMENT');
    expect(sql).not.toMatch(/admin:(?:cost|provider)/);
    expect(sql).not.toMatch(/'admin-(?:users|orders|tickets|jobs)'/);
  });

  it('比较后立即推进计数基线，使同一 SQL 的多个事件最多递增一次', async () => {
    const sql = await migrationSql();
    const helperStart = sql.indexOf('CREATE OR REPLACE FUNCTION admin_pagination_statement_changed(');
    const helperEnd = sql.indexOf('CREATE OR REPLACE FUNCTION admin_pagination_bump_trigger()', helperStart);
    const helper = sql.slice(helperStart, helperEnd);
    const setBaseline = helper.indexOf("set_config(setting_prefix || 'inserted'");
    const returnComparison = helper.indexOf('RETURN inserted_after > inserted_before');
    expect(setBaseline).toBeGreaterThanOrEqual(0);
    expect(returnComparison).toBeGreaterThan(setBaseline);
  });
});
