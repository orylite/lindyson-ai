import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('数据库迁移执行器', () => {
  it('只接收标准编号迁移文件并排除 AppleDouble 元数据', async () => {
    const source = await readFile(
      new URL('../src/db/migrate.ts', import.meta.url),
      'utf8',
    );
    const dockerignore = await readFile(
      new URL('../../../.dockerignore', import.meta.url),
      'utf8',
    );

    expect(source).toContain(".filter(file => /^\\d{3}_[a-z0-9_]+\\.sql$/.test(file))");
    expect(source).not.toContain(".filter(file => file.endsWith('.sql'))");
    expect(dockerignore).toContain('._*');
    expect(dockerignore).toContain('**/._*');
  });
});
