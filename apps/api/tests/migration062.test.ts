import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('062 支付返回来源迁移', () => {
  it('可重放地加列、回填历史记录并保留滚动发布默认值', async () => {
    const sql = await readFile(
      new URL('../migrations/062_payment_attempt_return_origin.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS return_origin text DEFAULT 'https:\/\/www\.lindyson\.com'/,
    );
    expect(sql).toMatch(
      /ALTER COLUMN return_origin SET DEFAULT 'https:\/\/www\.lindyson\.com'/,
    );
    expect(sql).toMatch(
      /UPDATE payment_attempts[\s\S]*SET return_origin = 'https:\/\/www\.lindyson\.com'[\s\S]*WHERE return_origin IS NULL/,
    );
    expect(sql).toContain('ALTER COLUMN return_origin SET NOT NULL');
    expect(sql).not.toMatch(/DROP DEFAULT/);
  });

  it('在加列后升级 047 的身份触发器并禁止修改 return_origin', async () => {
    const [migration047, migration062] = await Promise.all([
      readFile(new URL('../migrations/047_state_machine_invariants.sql', import.meta.url), 'utf8'),
      readFile(new URL('../migrations/062_payment_attempt_return_origin.sql', import.meta.url), 'utf8'),
    ]);

    expect(migration047).not.toContain('return_origin');
    expect(migration062.indexOf('ADD COLUMN IF NOT EXISTS return_origin'))
      .toBeLessThan(migration062.indexOf('CREATE OR REPLACE FUNCTION preserve_payment_attempt_identity()'));
    expect(migration062).toMatch(
      /NEW\.surface, NEW\.way_code, NEW\.return_origin[\s\S]*OLD\.surface, OLD\.way_code, OLD\.return_origin/,
    );
    expect(migration062).toContain('DROP TRIGGER IF EXISTS payment_attempts_preserve_identity');
    expect(migration062).toContain('CREATE TRIGGER payment_attempts_preserve_identity');
  });
});
