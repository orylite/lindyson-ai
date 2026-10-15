import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('074 生成积分流水快照迁移', () => {
  it('按流水事件键固化 attempt、规格与三类积分事实', async () => {
    const sql = await readMigration();
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS generation_snapshot jsonb');
    expect(sql).toContain("NEW.business_event_key ~ ':[0-9]+$'");
    expect(sql).toContain("'generation-hold:', NEW.related_job_id::text, ':', snapshot_attempt::text");
    expect(sql).toContain("'hasReferenceVideo', has_reference_video");
    expect(sql).toContain("'reservedCredits', reserved_credits");
    expect(sql).toContain("'settledCredits', settled_credits");
    expect(sql).toContain("'refundedCredits', refunded_credits");
    expect(sql).toContain("'taskStatus', task_status");
    expect(sql).toContain("'creditStatus', NEW.settlement_status");
  });

  it('回填只触发快照同步，不改任务、金额、余额或订单退款', async () => {
    const sql = await readMigration();
    expect(sql).toMatch(/UPDATE credit_ledger\s+SET type = type\s+WHERE related_job_id IS NOT NULL/);
    expect(sql).not.toMatch(/UPDATE\s+generation_tasks/i);
    expect(sql).not.toMatch(/UPDATE\s+orders/i);
    expect(sql).not.toMatch(/related_order_id\s+IS\s+NOT\s+NULL/i);
  });

  it('允许账务生命周期触发器收口当前 attempt，但禁止直接篡改已落库快照', async () => {
    const sql = await readMigration();
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF type, settlement_status, amount, related_job_id, business_event_key');
    expect(sql).toContain('BEFORE UPDATE OF generation_snapshot ON credit_ledger');
    expect(sql).toContain('credit_ledger.generation_snapshot 不允许直接修改');
    expect(sql).toContain('生成积分流水只允许从预扣收口为实扣或退回');
    expect(sql).toContain("NEW.type = 'spend' AND NEW.settlement_status = 'settled'");
    expect(sql).toContain("NEW.type = 'hold' AND NEW.settlement_status = 'refunded'");
    expect(sql).toContain('VALIDATE CONSTRAINT credit_ledger_generation_snapshot_check');
    expect(sql).toMatch(/related_job_id IS NOT NULL\s+AND generation_snapshot IS NOT NULL/);
  });

  it('遇到关联任务缺失的孤儿流水时明确中止，不制造空快照', async () => {
    const sql = await readMigration();
    expect(sql).toContain('LEFT JOIN generation_tasks task ON task.id = ledger.related_job_id');
    expect(sql).toContain('credit_ledger 存在关联任务缺失的孤儿流水');
    expect(sql).toContain('生成积分流水关联任务不存在');
  });
});

function readMigration() {
  return readFile(new URL('../migrations/074_credit_ledger_generation_snapshots.sql', import.meta.url), 'utf8');
}
