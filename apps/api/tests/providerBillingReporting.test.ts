import { endpointContracts } from '@lindyson/api-contracts';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';
import {
  getAdminProviderBillingOverview,
  listAdminProviderBillingDetails,
  listAdminProviderOperationalUsage,
} from '../src/domain/providerBillingReporting.js';

const AS_OF = '2026-08-11T12:00:00.000Z';
const RANGE = {
  range: 'custom' as const,
  from: '2026-08-01',
  to: '2026-08-11',
  asOf: AS_OF,
};

describe('全产品官方账单只读报表', () => {
  it('汇总读取所有产品，并只按显式证据区分业务、运营、账户级和未归因', async () => {
    const query = vi.fn().mockResolvedValue(rows([
      overviewRow({
        kind: 'summary', line_count: '4', product_count: '2', final_line_count: '3',
        provisional_line_count: '1', payable_amount_cny: '12.500000',
        paid_amount_cny: '10.000000', unpaid_amount_cny: '2.500000',
      }),
      overviewRow({
        kind: 'product', product: 'ark_bd', product_name: '豆包大模型', service_type: 'video',
        line_count: '3', final_line_count: '2', provisional_line_count: '1',
        payable_amount_cny: '11.500000', paid_amount_cny: '9.000000', unpaid_amount_cny: '2.500000',
      }),
      overviewRow({
        kind: 'product', product: 'tos', product_name: '对象存储', service_type: 'storage',
        line_count: '1', final_line_count: '1', payable_amount_cny: '1.000000',
        paid_amount_cny: '1.000000', unpaid_amount_cny: '0.000000',
      }),
      overviewRow({
        kind: 'service', service_type: 'video', line_count: '3', payable_amount_cny: '11.500000',
        paid_amount_cny: '9.000000', unpaid_amount_cny: '2.500000',
      }),
      overviewRow({
        kind: 'attribution', attribution_status: 'unattributed', line_count: '1',
        payable_amount_cny: '2.000000', paid_amount_cny: '0.000000', unpaid_amount_cny: '2.000000',
      }),
    ]));
    const result = await getAdminProviderBillingOverview(client(query), {
      ...RANGE,
      search: 'Detail',
    });

    expect(result.summary).toEqual({
      lineCount: 4,
      productCount: 2,
      finalLineCount: 3,
      provisionalLineCount: 1,
      originalBillAmountCny: '0.000000',
      preferentialBillAmountCny: '0.000000',
      discountBillAmountCny: '0.000000',
      couponAmountCny: '0.000000',
      payableAmountCny: '12.500000',
      paidAmountCny: '10.000000',
      unpaidAmountCny: '2.500000',
    });
    expect(result.products.map(item => item.product)).toEqual(['ark_bd', 'tos']);
    expect(result.byAttribution).toEqual([{
      attributionStatus: 'unattributed', lineCount: 1,
      originalBillAmountCny: '0.000000', preferentialBillAmountCny: '0.000000',
      discountBillAmountCny: '0.000000', couponAmountCny: '0.000000',
      payableAmountCny: '2.000000', paidAmountCny: '0.000000', unpaidAmountCny: '2.000000',
    }]);

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM provider_bill_details details');
    expect(sql).not.toMatch(/WHERE\s+details\.product = 'ark_bd'/);
    expect(sql).toContain("THEN 'storage'");
    expect(sql).toContain("details.bill_line_type IN ('package-purchase', 'refund', 'adjustment')");
    expect(sql).not.toContain("details.bill_line_type = 'other'");
    expect(sql).toContain("THEN 'admin-operational'");
    expect(sql).toContain("THEN 'business'");
    expect(sql).toContain("ELSE 'unattributed'");
    expect(sql).toContain('legacy_admin_evidence.id IS NOT NULL');
    expect(sql).toContain('links.bill_detail_revision_id = details.current_revision_id');
    expect(sql).toContain('usage.task_id IS NULL');
    expect(sql).toContain('usage.initiated_by_admin_user_id IS NOT NULL');
    expect(sql).toContain('usage.task_id IS NOT NULL');
    expect((sql.match(/\) legacy_admin_evidence ON true/g) ?? [])).toHaveLength(1);
    expect(sql).toContain('provider_bill_attribution_events');
    expect(sql).toContain('provider_reconciliation_case_links');
    expect(sql).toContain('provider_bill_sync_run_items');
    expect(sql).toContain('provider_bill_detail_revisions');
    expect(sql).toContain('runs.completed_at <= $1::timestamptz');
    expect(sql).toContain("revisions.normalized_payload AS payload");
    expect(sql).toContain('WHERE run_rank = 1');
    expect(values).toEqual([AS_OF, '2026-08-01', '2026-08-11', '%Detail%']);
    expect(endpointContracts.adminProviderBillingOverview.response.parse(result)).toEqual(result);
  });

  it('同一官方行同时命中 Admin 与业务证据时失败关闭为未归属且不返回证据 ID', async () => {
    const query = vi.fn().mockResolvedValue(rows([overviewRow({
      kind: 'attribution', attribution_status: 'unattributed', line_count: '1',
    })]));

    await getAdminProviderBillingOverview(client(query), RANGE);

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    const normalizedSql = sql.replace(/\s+/g, ' ');
    const conflictPredicate = [
      '( operational_evidence.id IS NOT NULL OR legacy_admin_evidence.id IS NOT NULL )',
      'AND business_evidence.id IS NOT NULL',
    ].join(' ');
    const conflictStatus = `${conflictPredicate} THEN 'unattributed'`;
    const conflictEvidence = `${conflictPredicate} THEN NULL`;
    const adminOnlyStatus = [
      'WHEN operational_evidence.id IS NOT NULL',
      "OR legacy_admin_evidence.id IS NOT NULL THEN 'admin-operational'",
    ].join(' ');

    expect(normalizedSql).toContain(`WHEN ${conflictStatus}`);
    expect(normalizedSql).toContain(`WHEN ${conflictEvidence}`);
    expect(normalizedSql.indexOf(`WHEN ${conflictStatus}`))
      .toBeLessThan(normalizedSql.indexOf(adminOnlyStatus));
  });

  it('官方明细使用带筛选指纹的四向游标并精确保留小数抵扣量', async () => {
    const detailId = '00000000-0000-4000-8000-000000000001';
    const evidenceId = '00000000-0000-4000-8000-000000000002';
    const revisionId = '00000000-0000-4000-8000-000000000003';
    const query = vi.fn().mockResolvedValue(rows([{
      id: detailId,
      provider: 'volcengine-ark',
      source_detail_key: 'Detail-all-product-1',
      bill_period: '2026-08',
      expense_date: '2026-08-11',
      product: 'ark_bd',
      product_name: '豆包大模型',
      service_type: 'video',
      model: 'Seedance 2.5',
      bill_line_type: 'usage',
      finality: 'final',
      attribution_status: 'admin-operational',
      attribution_evidence_id: evidenceId,
      billing_mode: '后付费',
      bill_category: '消费',
      instance_no: null,
      config_name: 'Seedance 2.5 1080P',
      usage_count: '624.000000',
      usage_unit: 'tokens',
      deduction_count: '72664.544077',
      original_bill_amount_cny: '0.043680',
      preferential_bill_amount_cny: null,
      discount_bill_amount_cny: '0.000000',
      coupon_amount_cny: '0.000000',
      payable_amount_cny: '0.043680',
      paid_amount_cny: '0.043680',
      unpaid_amount_cny: '0.000000',
      round_amount_cny: '0.000000',
      currency: 'CNY',
      current_revision_id: revisionId,
      synced_at: '2026-08-11T13:00:00.000Z',
      __pagination_total_count: null,
      __pagination_cursor_timestamp: '2026-08-10T16:00:00.000000Z',
    }]));
    const result = await listAdminProviderBillingDetails(client(query), {
      ...RANGE,
      product: 'ark_bd',
      serviceType: 'video',
      model: 'Seedance 2.5',
      finality: 'final',
      attributionStatus: 'admin-operational',
      limit: 20,
    });

    expect(result.items[0]).toMatchObject({
      id: detailId,
      sourceDetailKey: 'Detail-all-product-1',
      serviceType: 'video',
      attributionStatus: 'admin-operational',
      usageCount: '624.000000',
      deductionCount: '72664.544077',
      payableAmountCny: '0.043680',
    });
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('details.product = $4');
    expect(sql).toContain('details.service_type = $5');
    expect(sql).toContain('details.reporting_model = $6');
    expect(sql).toContain('details.finality = $7');
    expect(sql).toContain('details.attribution_status = $8');
    expect(sql).toContain('ORDER BY');
    expect(values.slice(0, 8)).toEqual([
      AS_OF, '2026-08-01', '2026-08-11', 'ark_bd', 'video', 'Seedance 2.5',
      'final', 'admin-operational',
    ]);
    expect(endpointContracts.adminProviderBillingDetails.response.parse(result)).toEqual(result);
  });

  it('运营用量按不可变后继链读取当前估值和官方归属，不把它伪装成业务任务', async () => {
    const usageId = '00000000-0000-4000-8000-000000000010';
    const ownerId = '00000000-0000-4000-8000-000000000011';
    const billId = '00000000-0000-4000-8000-000000000012';
    const sha = 'a'.repeat(64);
    const approvalSha = 'b'.repeat(64);
    const query = vi.fn().mockResolvedValue(rows([{
      id: usageId,
      origin: 'manifest-v1',
      manifest_version: 'lindyson.provider-operational-usage/v1',
      manifest_id: 'seedance-25-shadow-20260811T213300Z',
      manifest_sha256: sha,
      provider: 'volcengine-ark',
      service_type: 'video',
      model: 'Seedance 2.5',
      operation: 'reference-video-generation',
      operation_key: 'seedance-25-shadow-20260811T213300Z:scenario-5',
      cost_owner_user_id: ownerId,
      cost_owner_user_name: 'Lindyson Admin',
      cost_owner_email: 'admin@lindyson.com',
      purpose: 'deployment-canary',
      initiator_type: 'release-automation',
      initiated_by_user_id: null,
      source_run_id: 'seedance-25-shadow-20260811T213300Z',
      source_item_key: 'scenario-5',
      provider_task_id: 'provider-task-25',
      provider_operation_id: null,
      provider_request_id: 'request-25',
      status: 'success',
      provider_reached: true,
      occurred_at: '2026-08-11T13:33:00.000Z',
      local_accounting_date: '2026-08-11',
      usage_evidence: { billableTokens: 458 },
      evidence_status: 'admin-confirmed-missing-original',
      approval_sha256: approvalSha,
      approved_at: '2026-08-12T02:32:09.000Z',
      evidence_path: '/opt/lindyson/deploy-audits/seedance-25/task-summary.csv',
      evidence_sha256: sha,
      pricing_status: 'priced',
      price_version: 'volcengine-seedance-25-2026-08-11',
      pricing_source_url: 'https://www.volcengine.com/docs/82379/1544106',
      unit_price_snapshot: { cnyPerMillionTokens: 42 },
      estimated_cost_cny: '10.000000',
      valuation_evidence_sha256: sha,
      valuation_recorded_at: '2026-08-11T14:00:00.000Z',
      official_attribution_count: '1',
      official_bill_detail_id: billId,
      official_source_detail_key: 'Detail-seedance-25',
      official_finality: 'final',
      official_attributed_amount_cny: '8.000000',
      reconciliation_status: 'matched',
      recorded_at: '2026-08-11T14:00:00.000Z',
      __pagination_total_count: null,
      __pagination_cursor_timestamp: '2026-08-11T13:33:00.000000Z',
    }]));
    const result = await listAdminProviderOperationalUsage(client(query), {
      ...RANGE,
      serviceType: 'video',
      model: 'Seedance 2.5',
      finality: 'final',
      attributionStatus: 'admin-operational',
      search: 'scenario-5',
    });

    expect(result.items[0]).toMatchObject({
      id: usageId,
      origin: 'manifest-v1',
      operationKey: 'seedance-25-shadow-20260811T213300Z:scenario-5',
      costOwnerEmail: 'admin@lindyson.com',
      purpose: 'deployment-canary',
      providerReached: true,
      evidenceStatus: 'admin-confirmed-missing-original',
      approvalSha256: approvalSha,
      approvedAt: '2026-08-12T02:32:09.000Z',
      estimatedCostCny: '10.000000',
      officialAttributionCount: 1,
      officialAttributedAmountCny: '8.000000',
      reconciliationStatus: 'matched',
    });
    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('provider_operational_usage_records');
    expect(sql).toContain("usage.evidence_attestation->>'approvalSha256'");
    expect(sql).toContain("usage.evidence_attestation->>'approvedAt'");
    expect(sql).toContain("usage.evidence_status = 'admin-confirmed-missing-original'");
    expect(sql).toContain('successor.supersedes_valuation_id = valuation.id');
    expect(sql).toContain('successor.supersedes_event_id = attribution.id');
    expect(sql).toContain("attribution.event_type IN ('link', 'supersede')");
    expect(sql).toContain("attribution.confidence IN ('direct', 'high')");
    expect(sql).toContain('revision.normalized_payload->>\'product\'');
    expect(sql).toContain('selected_bill_run_candidates AS');
    expect(sql.match(/JOIN selected_bill_runs selected_bill_run/g)).toHaveLength(2);
    const normalizedSql = sql.replace(/\s+/g, ' ');
    expect(normalizedSql).not.toMatch(
      /coalesce\(attributions\.allocated_cost_cny, 0\) < (?:valuation|usage)\.estimated_cost/,
    );
    expect(normalizedSql.match(
      /WHEN coalesce\(attributions\.attribution_count, 0\) = 0 THEN 'unmatched' ELSE 'matched'/g,
    )).toHaveLength(2);
    expect(sql).not.toContain('generation_tasks');
    expect(sql).not.toContain('credit_ledger');
    expect(endpointContracts.adminProviderBillingOperationalUsage.response.parse(result)).toEqual(result);
  });

  it('运营用量联合 legacy admin-direct，显式标记来源且不伪造 manifest 或 SHA', async () => {
    const usageId = '00000000-0000-4000-8000-000000000020';
    const ownerId = '00000000-0000-4000-8000-000000000021';
    const billId = '00000000-0000-4000-8000-000000000022';
    const query = vi.fn().mockResolvedValue(rows([{
      id: usageId,
      origin: 'legacy-admin-direct',
      manifest_version: null,
      manifest_id: null,
      manifest_sha256: null,
      provider: 'volcengine-ark',
      service_type: 'video',
      model: 'Seedance 2.0',
      operation: 'legacy-admin-direct',
      operation_key: `provider-usage-record:${usageId}`,
      cost_owner_user_id: ownerId,
      cost_owner_user_name: 'Lindyson Admin',
      cost_owner_email: 'admin@lindyson.com',
      purpose: 'admin-direct',
      initiator_type: 'admin-user',
      initiated_by_user_id: ownerId,
      source_run_id: null,
      source_item_key: null,
      provider_task_id: 'legacy-provider-task-1',
      provider_operation_id: null,
      provider_request_id: null,
      status: 'success',
      provider_reached: null,
      occurred_at: '2026-08-11T13:30:00.000Z',
      local_accounting_date: '2026-08-11',
      usage_evidence: null,
      evidence_status: null,
      approval_sha256: null,
      approved_at: null,
      evidence_path: null,
      evidence_sha256: null,
      pricing_status: 'priced',
      price_version: 'volcengine-seedance-2026-07-10',
      pricing_source_url: null,
      unit_price_snapshot: null,
      estimated_cost_cny: '12.496275',
      valuation_evidence_sha256: null,
      valuation_recorded_at: null,
      official_attribution_count: '1',
      official_bill_detail_id: billId,
      official_source_detail_key: 'Detail-legacy-admin-1',
      official_finality: 'final',
      official_attributed_amount_cny: '12.496275',
      reconciliation_status: 'matched',
      recorded_at: '2026-08-11T13:31:00.000Z',
      __pagination_total_count: null,
      __pagination_cursor_timestamp: '2026-08-11T13:30:00.000000Z',
    }]));

    const result = await listAdminProviderOperationalUsage(client(query), {
      ...RANGE,
      attributionStatus: 'admin-operational',
      search: 'legacy-provider-task-1',
    });

    expect(result.items[0]).toMatchObject({
      id: usageId,
      origin: 'legacy-admin-direct',
      operationKey: `provider-usage-record:${usageId}`,
      sourceRunId: null,
      sourceItemKey: null,
      providerReached: null,
      usageEvidence: null,
      evidenceStatus: null,
      approvalSha256: null,
      approvedAt: null,
      evidencePath: null,
      evidenceSha256: null,
      manifestVersion: null,
      manifestId: null,
      manifestSha256: null,
      estimatedCostCny: '12.496275',
      officialAttributionCount: 1,
      reconciliationStatus: 'matched',
    });
    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('legacy_operational_rows AS');
    expect(sql).toContain("'legacy-admin-direct'::text AS origin");
    expect(sql).toContain('usage.task_id IS NULL');
    expect(sql).toContain('usage.initiated_by_admin_user_id IS NOT NULL');
    expect(sql).toContain('SELECT * FROM manifest_operational_rows');
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain('manifest_usage.provider_task_id = usage.provider_task_id');
    expect(sql).toContain('NULL::text AS evidence_sha256');
    expect(sql).toContain('NULL::text AS manifest_sha256');
    expect(sql).toContain('NULL::text AS approval_sha256');
    expect(sql).toContain('NULL::timestamptz AS approved_at');
    expect(sql).toContain("reconciliation_case.confidence IN ('direct', 'high')");
    expect(endpointContracts.adminProviderBillingOperationalUsage.response.parse(result)).toEqual(result);
  });

  it('all 范围使用实际观测边界，而不是把缺失账单扩成虚假覆盖', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(rows([{ start_date: '2026-07-01', end_date: '2026-08-10' }]))
      .mockResolvedValueOnce(rows([overviewRow({ kind: 'summary' })]));
    const result = await getAdminProviderBillingOverview(client(query), { range: 'all', asOf: AS_OF });

    expect(result.selection).toMatchObject({
      range: 'all', rangeStart: '2026-07-01', rangeEnd: '2026-08-10', grain: 'month',
    });
    expect(query.mock.calls[0]?.[0]).toContain('min(expense_date)');
    expect((query.mock.calls[1]?.[1] as unknown[]).slice(1, 3)).toEqual(['2026-07-01', '2026-08-10']);
  });

  it('next/previous 必须携带同一筛选条件签名的游标', async () => {
    const query = vi.fn();
    await expect(listAdminProviderBillingDetails(client(query), {
      ...RANGE,
      position: 'next',
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(query).not.toHaveBeenCalled();
  });
});

function client(query: ReturnType<typeof vi.fn>) {
  return { query } as unknown as DbClient;
}

function rows<T>(items: T[]) {
  return { rows: items, rowCount: items.length };
}

function overviewRow(patch: Partial<Record<keyof ReturnType<typeof overviewDefaults>, unknown>>) {
  return { ...overviewDefaults(), ...patch };
}

function overviewDefaults() {
  return {
    kind: 'summary',
    product: null,
    product_name: null,
    service_type: null,
    attribution_status: null,
    line_count: '0',
    product_count: '0',
    final_line_count: '0',
    provisional_line_count: '0',
    original_bill_amount_cny: '0.000000',
    preferential_bill_amount_cny: '0.000000',
    discount_bill_amount_cny: '0.000000',
    coupon_amount_cny: '0.000000',
    payable_amount_cny: '0.000000',
    paid_amount_cny: '0.000000',
    unpaid_amount_cny: '0.000000',
  };
}
