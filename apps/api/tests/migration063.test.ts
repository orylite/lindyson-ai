import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('063 Seedream 图片生成迁移', () => {
  it('增加同步 checkpoint 字段，并锁定请求证据与临时 URL 单向清除', async () => {
    const sql = await migrationSql();
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS provider_request_id text');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS provider_response_checkpoint jsonb');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS provider_response_url text');
    expect(sql).toMatch(/provider_response_checkpoint IS NULL[\s\S]*provider_task_id IS NOT NULL/);
    expect(sql).toMatch(/provider_response_url = NULL, status = 'archiving'|provider_response_url 清除后不可恢复/);
    expect(sql).toMatch(/OLD\.provider_request_id IS NOT NULL[\s\S]*NEW\.provider_request_id IS DISTINCT FROM OLD\.provider_request_id/);
    expect(sql).toMatch(/OLD\.provider_response_checkpoint IS NOT NULL[\s\S]*NEW\.provider_response_checkpoint IS DISTINCT FROM OLD\.provider_response_checkpoint/);
    expect(sql).toMatch(/OLD\.provider_response_url IS NULL[\s\S]*NEW\.provider_response_url IS NOT NULL[\s\S]*清除后不可恢复/);
  });

  it('价格规则和逐 provider run 证据不可更新或删除，缺证据时金额必须为空', async () => {
    const sql = await migrationSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS image_provider_pricing_rules');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS image_provider_usage_records');
    expect(sql).toContain('UNIQUE (provider_run_id)');
    expect(sql).toMatch(/evidence_status = 'missing-evidence'[\s\S]*reference_price_cny IS NULL[\s\S]*output_price_cny IS NULL[\s\S]*estimated_cost_cny IS NULL/);
    expect(sql).toMatch(/CREATE TRIGGER image_provider_usage_records_immutable[\s\S]*BEFORE UPDATE OR DELETE/);
    expect(sql).toMatch(/CREATE TRIGGER image_provider_pricing_rules_immutable[\s\S]*BEFORE UPDATE OR DELETE/);
  });

  it('确定替换禁用 GPT 占位，固化两档积分且重跑不关闭管理员已开放档', async () => {
    const sql = await migrationSql();
    expect(sql).toContain("model = 'GPT Image 2.0' AND available = true");
    expect(sql).toContain("DELETE FROM consumption_settings\nWHERE kind = 'image' AND model = 'GPT Image 2.0' AND available = false");
    expect(sql).toContain("('image', 'Seedream 5.0 Pro', 'Seedream 5.0 Pro', 0, '1K', 14, NULL, false)");
    expect(sql).toContain("('image', 'Seedream 5.0 Pro', 'Seedream 5.0 Pro', 0, '2K', 28, NULL, false)");
    expect(sql).toContain('available = consumption_settings.available');
    expect(sql).not.toMatch(/available\s*=\s*EXCLUDED\.available/);
    expect(sql).not.toMatch(/UPDATE\s+generation_tasks/i);
    expect(sql).not.toMatch(/UPDATE\s+assets/i);
    expect(sql).not.toMatch(/UPDATE\s+credit_ledger/i);
  });
});

function migrationSql() {
  return readFile(new URL('../migrations/063_seedream_image_generation.sql', import.meta.url), 'utf8');
}
