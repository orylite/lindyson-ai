import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../migrations/059_prompt_wizard_two_plan_batches.sql',
  import.meta.url,
);

describe('059 提示词向导双方案批次迁移', () => {
  it('替换已完成批次约束并同时兼容新双方案与历史三方案', async () => {
    const sql = await readFile(migrationUrl, 'utf8');

    expect(sql).toContain(
      'DROP CONSTRAINT IF EXISTS prompt_wizard_batches_completed_shape_check',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT prompt_wizard_batches_completed_shape_check CHECK',
    );
    expect(sql).toContain("status <> 'completed'");
    expect(sql).toContain('content_purged_at IS NOT NULL');
    expect(sql).toContain("jsonb_typeof(plans) = 'array'");
    expect(sql).toContain('jsonb_array_length(plans) IN (2, 3)');
    expect(sql).not.toMatch(/UPDATE\s+prompt_wizard_batches/iu);
  });
});
