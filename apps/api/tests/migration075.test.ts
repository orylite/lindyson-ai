import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('075 Seedance 2.5 25 秒积分迁移', () => {
  it('从每个分辨率现存 15 秒普通档动态推导双档积分', async () => {
    const sql = await readMigration();

    expect(sql).toContain("duration_seconds = 15");
    expect(sql).toContain("resolution IN ('480p', '720p')");
    expect(sql).toContain('CEIL(credits * 25::numeric / 15)::integer AS credits');
    expect(sql).toContain('CEIL(credits * 42::numeric / 70)::integer AS reference_video_credits');
    expect(sql).not.toMatch(/VALUES\s*\(\s*25\s*,\s*'480p'\s*,\s*179/i);

    expect(Math.ceil(107 * 25 / 15)).toBe(179);
    expect(Math.ceil(179 * 42 / 70)).toBe(108);
    expect(Math.ceil(229 * 25 / 15)).toBe(382);
    expect(Math.ceil(382 * 42 / 70)).toBe(230);
  });

  it('锁定旧档且只接受完整的全开或全关状态', async () => {
    const sql = await readMigration();

    expect(sql).toMatch(/FROM consumption_settings[\s\S]*model = 'Seedance 2\.5'[\s\S]*FOR UPDATE/);
    expect(sql).toContain('IF legacy_count <> 10 OR unexpected_count <> 0 THEN');
    expect(sql).toContain('legacy_available_count NOT IN (0, 10)');
    expect(sql).toContain('desired_available := legacy_available_count = 10');
    expect(sql).toContain('available IS DISTINCT FROM desired_available');
    expect(sql).toContain('invalid_existing_price_count <> 0');
    expect(sql).toContain('final_count <> 12');
    expect(sql).toContain('CASE WHEN desired_available THEN 12 ELSE 0 END');
    expect(sql).toMatch(/WHERE credits <= 0 OR reference_video_credits IS NULL OR reference_video_credits <= 0/);
  });

  it('仅插入缺失行，重复执行不覆盖人工价格或开放状态', async () => {
    const sql = await readMigration();

    expect(sql).toContain('ON CONFLICT (kind, model, duration_seconds, resolution) DO NOTHING');
    expect(sql).not.toMatch(/DO\s+UPDATE/i);
    expect(sql).not.toMatch(/UPDATE\s+consumption_settings/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+consumption_settings/i);
    expect(sql).not.toMatch(/UPDATE\s+generation_tasks/i);
    expect(sql).not.toMatch(/UPDATE\s+credit_ledger/i);
  });

  it('只在实际插入时记录一条幂等 high 审计', async () => {
    const sql = await readMigration();

    expect(sql).toContain('GET DIAGNOSTICS inserted_count = ROW_COUNT');
    expect(sql).toContain('IF inserted_count > 0 THEN');
    expect(sql).toContain("'system@lindyson.local'");
    expect(sql).toContain("'积分消耗'");
    expect(sql).toContain("'新增 Seedance 2.5 25秒档'");
    expect(sql).toContain("'high'");
    expect(sql).toContain("'previousAvailableCount', initial_available_count");
    expect(sql).toContain("'newAvailableCount', final_available_count");
    expect(sql).toContain("'prices', pricing_snapshot");
    expect(sql).toContain("'preservedExistingPricesAndAvailability', true");
    expect(sql).toContain('WHERE NOT EXISTS');
  });

  it('空库 seed 使用自身 15 秒基准的推导价，不冒用生产人工调价', async () => {
    const seed = normalizeWhitespace(await readFile(new URL('../src/db/seed.ts', import.meta.url), 'utf8'));

    expect(seed).toContain(normalizeWhitespace(
      "['video', 'Seedance 2.5', 'Seedance 2.5', 25, '480p', 144, 87, false]",
    ));
    expect(seed).toContain(normalizeWhitespace(
      "['video', 'Seedance 2.5', 'Seedance 2.5', 25, '720p', 204, 123, false]",
    ));
    expect(seed).not.toContain(normalizeWhitespace(
      "['video', 'Seedance 2.5', 'Seedance 2.5', 25, '480p', 179, 108, false]",
    ));
  });
});

function readMigration() {
  return readFile(new URL('../migrations/075_seedance_25_duration_25.sql', import.meta.url), 'utf8');
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
