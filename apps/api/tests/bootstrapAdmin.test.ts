import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('显式管理员初始化脚本', () => {
  it('与基础 seed 分离且按北京时间初始化套餐日期', async () => {
    const [bootstrapSource, seedSource] = await Promise.all([
      readFile(new URL('../src/db/bootstrapAdmin.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/db/seed.ts', import.meta.url), 'utf8'),
    ]);

    expect(bootstrapSource).toContain("now() AT TIME ZONE 'Asia/Shanghai'");
    expect(bootstrapSource).not.toContain('current_date');
    expect(bootstrapSource).toContain('BOOTSTRAP_ADMIN_EMAIL');
    expect(seedSource).not.toContain('BOOTSTRAP_ADMIN_EMAIL');
    expect(seedSource).not.toContain('SEED_ADMIN_EMAIL');
    expect(seedSource).not.toContain('DO UPDATE');
    expect(seedSource.match(/DO NOTHING/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
