import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('051 视频生成失败退款策略迁移', () => {
  it('只约束新写入的失败任务必须已退款且未结算', async () => {
    const sql = await readFile(
      new URL('../migrations/051_generation_failure_refund_policy.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain('generation_tasks_failed_refund_policy_check');
    expect(sql).toMatch(/status\s*<>\s*'failed'/);
    expect(sql).toMatch(/credit_status\s*=\s*'refunded'/);
    expect(sql).toMatch(/settled_credits\s*=\s*0/);
    expect(sql).toMatch(/\)\s+NOT VALID\s*;/);
  });

  it('不扫描或改写历史终态任务账务', async () => {
    const sql = await readFile(
      new URL('../migrations/051_generation_failure_refund_policy.sql', import.meta.url),
      'utf8',
    );

    expect(sql).not.toMatch(/\bUPDATE\s+generation_tasks\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+generation_tasks\b/i);
    expect(sql).not.toMatch(/\bVALIDATE\s+CONSTRAINT\b/i);
  });
});
