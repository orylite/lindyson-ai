import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('076 供应商运营调用账本迁移', () => {
  it('把运营调用、估值和官方账单归属拆成三层追加事实', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS provider_operational_usage_records');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS provider_operational_usage_valuations');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS provider_bill_attribution_events');
    expect(sql).toContain('cost_owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT');
    expect(sql).toContain("service_type IN ('video', 'image', 'multimodal')");
    expect(sql).toContain("purpose IN ('deployment-canary', 'api-smoke-test', 'provider-diagnostic', 'admin-direct')");
    expect(sql).toContain("initiator_type IN ('admin-user', 'release-automation', 'maintenance-script')");
    expect(sql).toContain('UNIQUE (provider, source_run_id, source_item_key)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS provider_operational_usage_external_id_registry');
    expect(sql).toContain('UNIQUE (provider, external_id)');
    expect(sql).toContain('provider_operational_usage_external_ids_guard');
    expect(sql).toContain('AFTER INSERT ON provider_operational_usage_records');
    expect(sql).toContain("provider_task_id !~ '^sha256:[0-9a-f]{16,64}$'");
    expect(sql).toContain("local_accounting_date = (occurred_at AT TIME ZONE 'Asia/Shanghai')::date");
    expect(sql).toContain('CHECK (recorded_at >= occurred_at)');
    expect(sql).toContain("evidence_status text NOT NULL DEFAULT 'verified'");
    expect(sql).toContain('ALTER COLUMN evidence_status DROP DEFAULT');
    expect(sql).toContain("evidence_status = 'admin-confirmed-missing-original'");
    expect(sql).toContain('provider_operational_usage_evidence_status_check');
    expect(sql).toContain('evidence_attestation IS NOT NULL');
    expect(sql).toContain('historical_call_fingerprint_sha256');
    expect(sql).toContain('idx_provider_operational_usage_historical_fingerprint');
    expect(sql).toContain("evidence_attestation->>'manifestSha256'");
    expect(sql).toContain("evidence_attestation->>'callFingerprintSha256'");
    expect(sql).toContain("evidence_attestation->>'manifestGeneratedAt'");
    expect(sql).toContain("recorded_at >= (evidence_attestation->>'approvedAt')::timestamptz");
    expect(sql).toContain("coalesce(evidence_attestation->>'approvalSha256' ~ '^[0-9a-f]{64}$', false)");
    expect(sql).toContain("evidence_attestation#>>'{decision,countAsAdminOperationalCost}'");
    expect(sql).toContain("evidence_attestation#>>'{decision,allowProviderExternalIdClaims}'");
    expect(sql).toContain("evidence_attestation#>>'{decision,allowOfficialBillAttribution}'");
    expect(sql.match(/IS NOT DISTINCT FROM/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it('估值和官方账单归属只能通过有序 supersedes 链修订', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('supersedes_valuation_id uuid');
    expect(sql).toContain('idx_provider_operational_valuation_root');
    expect(sql).toContain('idx_provider_operational_valuation_successor');
    expect(sql).toContain("event_type IN ('link', 'supersede', 'void')");
    expect(sql).toContain("confidence IN ('direct', 'high')");
    expect(sql).not.toContain("confidence IN ('direct', 'high', 'medium', 'low')");
    expect(sql).toContain('supersedes_event_id uuid');
    expect(sql).toContain('idx_provider_bill_attribution_event_root');
    expect(sql).toContain('idx_provider_bill_attribution_event_successor');
    expect(sql).toContain('provider_bill_detail_revision_id uuid NOT NULL');
    expect(sql).toContain('validate_provider_operational_valuation_insert');
    expect(sql).toContain('validate_provider_bill_attribution_event_insert');
    expect(sql).toContain("previous.event_type = 'void'");
    expect(sql).toContain("NEW.event_type = 'void'");
    expect(sql).toContain('NEW.recorded_at < usage_recorded_at');
    expect(sql).toContain('NEW.recorded_at < revision_observed_at');
    expect(sql).toContain('估值记录时间不得早于运营用量事实');
    expect(sql).toContain("usage_evidence_status = 'admin-confirmed-missing-original'");
    expect(sql).toContain('管理员确认的缺文件历史运营调用只能计入列表价成本，不得归属官方账单');
    expect(sql).toContain('CHECK (allocated_cost_cny >= 0)');
    expect(sql).toContain('idx_audit_logs_provider_operational_usage_manifest');
  });

  it('三层账本、外部 ID 注册表与官方 revision 都拒绝 UPDATE/DELETE，且迁移不伪造业务任务或积分', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('provider_operational_usage_records_immutable');
    expect(sql).toContain('provider_operational_usage_valuations_immutable');
    expect(sql).toContain('provider_bill_attribution_events_immutable');
    expect(sql).toContain('provider_operational_usage_external_id_registry_immutable');
    expect(sql).toContain('provider_bill_detail_revisions_immutable');
    expect(sql.match(/BEFORE UPDATE OR DELETE/g)).toHaveLength(5);
    expect(sql).not.toMatch(/UPDATE\s+provider_operational_usage_/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+provider_operational_usage_/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+generation_tasks/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+credit_ledger/i);
  });
});

function migrationSql() {
  return readFile(new URL('../migrations/076_provider_operational_usage_ledger.sql', import.meta.url), 'utf8');
}
