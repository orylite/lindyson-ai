import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const EXPECTED_ROWS = [
  [5, '480p', 49, 30],
  [10, '480p', 86, 52],
  [15, '480p', 86, 52],
  [20, '480p', 115, 69],
  [30, '480p', 172, 104],
  [5, '720p', 61, 37],
  [10, '720p', 107, 65],
  [15, '720p', 122, 74],
  [20, '720p', 163, 98],
  [30, '720p', 244, 147],
] as const;

describe('073 Seedance 2.5 生成积分迁移', () => {
  it('已有生产基准必须恰有 6 条，并按官网价格比例推导双档积分', async () => {
    const sql = await readFile(new URL('../migrations/073_seedance_25_generation.sql', import.meta.url), 'utf8');
    expect(sql).toContain('baseline_count NOT IN (0, 6)');
    expect(sql).toContain("model = 'Seedance 2.0'");
    expect(sql).toContain("duration_seconds IN (5, 10, 15)");
    expect(sql).toContain("resolution IN ('480p', '720p')");
    expect(sql).toContain('CEIL(credits * 70::numeric / 46)::integer AS credits');
    expect(sql).toContain('SELECT 20, resolution, CEIL(credits * 20::numeric / 15)::integer');
    expect(sql).toContain('SELECT 30, resolution, credits * 2');
    expect(sql).toContain('CEIL(credits * 42::numeric / 70)::integer AS reference_video_credits');
    expect(sql).toMatch(/reference_video_credits,\s+false\s+FROM seedance_25_pricing/);
    expect(sql).not.toContain("'1080p'");
  });

  it('全新数据库没有 Seedance 2.0 行时使用相同默认基准，迁移后必须恰有 10 行', async () => {
    const sql = await readFile(new URL('../migrations/073_seedance_25_generation.sql', import.meta.url), 'utf8');
    const normalized = normalizeWhitespace(sql);
    for (const [duration, resolution, credits] of [
      [5, '480p', 32], [10, '480p', 56], [15, '480p', 56],
      [5, '720p', 40], [10, '720p', 70], [15, '720p', 80],
    ] as const) {
      expect(normalized).toContain(`(${duration}, '${resolution}', ${credits})`);
    }
    expect(sql).toContain('WHERE NOT EXISTS (SELECT 1 FROM seedance_20_existing_baseline)');
    expect(sql).toContain('IF seedance_25_count <> 10 THEN');
  });

  it('只插入缺失行，不覆盖人工积分或开放状态', async () => {
    const sql = await readFile(new URL('../migrations/073_seedance_25_generation.sql', import.meta.url), 'utf8');
    expect(sql).toContain('ON CONFLICT (kind, model, duration_seconds, resolution) DO NOTHING');
    expect(sql).not.toMatch(/DO\s+UPDATE/i);
    expect(sql).not.toMatch(/UPDATE\s+consumption_settings/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+consumption_settings/i);
    expect(sql).not.toMatch(/UPDATE\s+generation_tasks/i);
    expect(sql).not.toMatch(/UPDATE\s+credit_ledger/i);
  });

  it('新环境 seed 与迁移使用相同基准且保持冲突不覆盖', async () => {
    const seed = await readFile(new URL('../src/db/seed.ts', import.meta.url), 'utf8');
    for (const [duration, resolution, credits, referenceVideoCredits] of EXPECTED_ROWS) {
      expect(normalizeWhitespace(seed)).toContain(normalizeWhitespace(
        `['video', 'Seedance 2.5', 'Seedance 2.5', ${duration}, '${resolution}', ${credits}, ${referenceVideoCredits}, false]`,
      ));
    }
    expect(seed).toContain('ON CONFLICT (kind, model, duration_seconds, resolution) DO NOTHING');
  });
});

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
