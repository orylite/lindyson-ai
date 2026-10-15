import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';
import { PROVIDER_OPERATIONAL_USAGE_MANIFEST_VERSION } from '../src/domain/providerOperationalUsageManifest.js';
import {
  auditProviderBillingAttribution,
  parseProviderBillingAuditArgs,
  scanAuditEvidence,
} from '../src/tools/auditProviderBillingAttribution.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('全产品账单归属只读审计', () => {
  it('输出五类证据清单并保持模糊官方行未归属', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lindyson-billing-audit-'));
    temporaryRoots.push(root);
    const evidenceBytes = Buffer.from('{"providerTaskId":"provider-task-1"}\n');
    const evidenceSha256 = createHash('sha256').update(evidenceBytes).digest('hex');
    await writeFile(join(root, 'canary.evidence.json'), evidenceBytes);
    const manifest = validManifest();
    manifest.records[0]!.evidencePath = '/audit/canary.evidence.json';
    manifest.records[0]!.evidenceSha256 = evidenceSha256;
    manifest.records[0]!.valuation.evidenceSha256 = evidenceSha256;
    await writeFile(join(root, 'provider-operational-usage.json'), JSON.stringify(manifest));
    await writeFile(join(root, 'provider-usage-summary.json'), JSON.stringify({ providerCallCount: 0 }));

    const query = vi.fn(async (sql: string) => {
      if (sql.includes('ranked_bill_revisions')) return rows([
        officialRow({ id: 'bill-business', attribution_status: 'business' }),
        officialRow({
          id: 'bill-account', source_detail_key: 'Detail-tos', product: 'tos',
          product_name: '对象存储', service_type: 'storage', model: null,
          attribution_status: 'account-level',
        }),
        officialRow({
          id: 'bill-unknown', source_detail_key: 'Detail-ai-unknown',
          attribution_status: 'unattributed',
        }),
      ]);
      if (sql.includes('FROM provider_operational_usage_records')) return rows([]);
      if (sql.includes('FROM provider_usage_records')) return rows([{
        id: 'legacy-admin', provider: 'volcengine-ark', provider_task_id: 'provider-task-legacy',
        model: 'Seedance 2.0', estimated_cost_cny: '1.000000',
        occurred_at: '2026-08-10T00:00:00.000Z',
      }]);
      throw new Error(`未预期 SQL：${sql}`);
    });
    const report = await auditProviderBillingAttribution({
      client: { query } as unknown as DbClient,
      auditRoots: [root],
      asOf: '2026-08-12T00:00:00.000Z',
      generatedAt: '2026-08-12T00:01:00.000Z',
    });

    expect(report.summary).toEqual({
      businessAlreadyAttributed: 1,
      adminAlreadyAttributed: 0,
      adminOperationalRecordedUsage: 1,
      accountLevel: 1,
      provableUnattributedTests: 1,
      adminOperationalEstimatedUsage: 0,
      adminOperationalEstimatedCostCny: '0.000000',
      insufficientEvidence: 1,
      confirmedNoProviderCall: 1,
    });
    expect(report.provableUnattributedTests[0]).toMatchObject({
      sourceRunId: 'seedance-shadow-run', sourceItemKey: 'scenario-1',
      provider: 'volcengine-ark', model: 'Seedance 2.5',
    });
    expect(report.adminOperationalRecordedUsage).toEqual([
      expect.objectContaining({
        kind: 'legacy-admin-direct',
        officialAttributionStatus: 'not-evaluated',
      }),
    ]);
    expect(report.insufficientEvidence[0]).toMatchObject({
      path: 'provider-bill-detail:Detail-ai-unknown',
    });
    expect(report.safeguards).toEqual({
      automaticAttributionPerformed: false,
      productionDataWritten: false,
      ambiguousOfficialLinesRemainUnattributed: true,
      adminEstimateDoesNotImplyOfficialAttribution: true,
    });
    expect(report.reportSha256).toMatch(/^[0-9a-f]{64}$/);
    const allSql = query.mock.calls.map(call => String(call[0])).join('\n');
    expect(allSql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/);
    expect(allSql).not.toContain("bills.service_type = 'other' AND bills.bill_line_type = 'other'");
    expect(allSql).toContain(
      'coalesce(provider_terminal_at, completed_at, created_at) <= $1::timestamptz',
    );
    expect(allSql).toContain('fallback_bill_details AS');
    expect(allSql).toContain('details.synced_at <= $1::timestamptz');
    expect(allSql).toContain("last_seen_run.status = 'success'");
    expect(allSql).toContain('NULL::uuid AS revision_id');
    expect(allSql).toContain('WHERE bills.has_immutable_revision');
    expect(allSql.match(/links\.bill_detail_revision_id = bills\.revision_id/gu)).toHaveLength(2);
    expect(allSql).not.toContain('links.bill_detail_revision_id IS NULL');
    const normalizedSql = allSql.replace(/\s+/gu, ' ');
    expect(normalizedSql).toContain(
      "WHEN (operational.id IS NOT NULL OR legacy_admin.id IS NOT NULL) AND business.id IS NOT NULL THEN 'unattributed'",
    );
    expect(normalizedSql).toContain(
      'WHEN (operational.id IS NOT NULL OR legacy_admin.id IS NOT NULL) AND business.id IS NOT NULL THEN NULL',
    );
  });

  it('扫描文本摘要时仅把无矛盾的明确零调用归入未调用，并按 asOf 隐藏未来摘要', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lindyson-billing-audit-text-'));
    temporaryRoots.push(root);
    const confirmedDirectory = join(root, 'release-20260811T010000Z');
    const mixedDirectory = join(root, 'canary-20260811T020000Z');
    const ambiguousDirectory = join(root, 'deploy-20260811T030000Z');
    const futureDirectory = join(root, 'deploy-20260813T010000Z');
    await Promise.all([
      mkdir(confirmedDirectory),
      mkdir(mixedDirectory),
      mkdir(ambiguousDirectory),
      mkdir(futureDirectory),
    ]);
    await writeFile(join(confirmedDirectory, 'execution-summary.txt'), [
      'paid_canary=SKIPPED',
      'runner_executed=0',
      'provider_generation_verified=0',
    ].join('\n'));
    await writeFile(join(mixedDirectory, 'failure-summary.txt'), [
      'provider_call_count=0',
      'provider_request_id=request-real-1',
    ].join('\n'));
    await writeFile(join(ambiguousDirectory, 'execution-summary.txt'), [
      'release_succeeded=0',
      'provider_generation_verified=0',
    ].join('\n'));
    await writeFile(join(futureDirectory, 'execution-summary.txt'), 'provider_call_count=0\n');
    await writeFile(join(root, 'notes.txt'), 'provider_call_count=0\n');

    const evidence = await scanAuditEvidence([root], '2026-08-12T00:00:00.000Z');

    expect(evidence.confirmedNoProviderCall).toEqual([
      expect.objectContaining({
        path: join(confirmedDirectory, 'execution-summary.txt'),
        reason: expect.stringContaining('未发现 Provider ID'),
      }),
    ]);
    expect(evidence.insufficientEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: join(mixedDirectory, 'failure-summary.txt'),
        reason: expect.stringContaining('同时包含零调用'),
      }),
      expect.objectContaining({
        path: join(ambiguousDirectory, 'execution-summary.txt'),
        reason: expect.stringContaining('没有足以判定'),
      }),
    ]));
    expect(evidence.insufficientEvidence).toHaveLength(2);
    expect([
      ...evidence.confirmedNoProviderCall,
      ...evidence.insufficientEvidence,
    ].map(item => item.path)).not.toContain(join(futureDirectory, 'execution-summary.txt'));
  });

  it('无不可变 revision/run_item 的官方投影只能保留账户级或未归属', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lindyson-billing-audit-fallback-'));
    temporaryRoots.push(root);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('ranked_bill_revisions')) return rows([
        officialRow({
          id: 'bill-fallback-tos',
          source_detail_key: 'Detail-fallback-tos',
          revision_id: null,
          product: 'tos',
          product_name: '对象存储',
          service_type: 'storage',
          model: null,
          attribution_status: 'account-level',
          attribution_evidence_id: null,
          has_immutable_revision: false,
        }),
        officialRow({
          id: 'bill-fallback-ai',
          source_detail_key: 'Detail-fallback-ai',
          revision_id: null,
          attribution_status: 'unattributed',
          attribution_evidence_id: null,
          has_immutable_revision: false,
        }),
      ]);
      if (sql.includes('FROM provider_operational_usage_records')) return rows([]);
      if (sql.includes('FROM provider_usage_records')) return rows([]);
      throw new Error(`未预期 SQL：${sql}`);
    });

    const report = await auditProviderBillingAttribution({
      client: { query } as unknown as DbClient,
      auditRoots: [root],
      asOf: '2026-08-12T00:00:00.000Z',
      generatedAt: '2026-08-12T00:01:00.000Z',
    });

    expect(report.businessAlreadyAttributed).toHaveLength(0);
    expect(report.adminAlreadyAttributed).toHaveLength(0);
    expect(report.accountLevel).toEqual([
      expect.objectContaining({
        sourceDetailKey: 'Detail-fallback-tos',
        revisionId: null,
        evidenceBasis: 'projection-without-revision',
      }),
    ]);
    expect(report.insufficientEvidence).toEqual([
      expect.objectContaining({
        path: 'provider-bill-detail:Detail-fallback-ai',
        reason: expect.stringContaining('缺少 asOf 可见的不可变 revision/run_item'),
      }),
    ]);
    const officialSql = String(query.mock.calls[0]?.[0]);
    expect(officialSql).toMatch(/WHERE bills\.has_immutable_revision\s+AND links\.bill_detail_id/g);
    expect(officialSql).not.toContain("bills.service_type = 'other' AND bills.bill_line_type = 'other'");
  });

  it('要求显式审计根目录，并规范化 asOf', () => {
    expect(() => parseProviderBillingAuditArgs([])).toThrow(/ROOT_REQUIRED/);
    expect(parseProviderBillingAuditArgs([
      '--audit-root', '/opt/lindyson/deploy-audits',
      '--audit-root', '/opt/lindyson/canary-audits',
      '--as-of', '2026-08-12T08:00:00+08:00',
      '--output', './audit.json',
    ])).toEqual({
      auditRoots: ['/opt/lindyson/deploy-audits', '/opt/lindyson/canary-audits'],
      asOf: '2026-08-12T00:00:00.000Z',
      outputPath: './audit.json',
    });
    expect(() => parseProviderBillingAuditArgs([
      '--audit-root', '/tmp/audit',
      '--admin-confirmed-manifest-sha256', 'b'.repeat(64),
    ])).toThrow(/ARGUMENT_INVALID/);
  });

  it('同一旧审计文件同时出现零调用阶段和真实 Provider 调用时不误判为明确未调用', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lindyson-billing-audit-mixed-'));
    temporaryRoots.push(root);
    await writeFile(join(root, 'provider-canary.json'), JSON.stringify({
      preflight: { providerCallCount: 0 },
      canary: { providerReached: true, providerRequestId: 'request-real-1' },
    }));

    const query = vi.fn(async (sql: string) => {
      if (sql.includes('ranked_bill_revisions')) return rows([]);
      if (sql.includes('FROM provider_operational_usage_records')) return rows([]);
      if (sql.includes('FROM provider_usage_records')) return rows([]);
      throw new Error(`未预期 SQL：${sql}`);
    });
    const report = await auditProviderBillingAttribution({
      client: { query } as unknown as DbClient,
      auditRoots: [root],
      asOf: '2026-08-12T00:00:00.000Z',
      generatedAt: '2026-08-12T00:01:00.000Z',
    });

    expect(report.confirmedNoProviderCall).toHaveLength(0);
    expect(report.insufficientEvidence).toEqual([
      expect.objectContaining({ path: join(root, 'provider-canary.json') }),
    ]);
  });

  it('asOf 之前不可见未来生成的运营 manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lindyson-billing-audit-future-'));
    temporaryRoots.push(root);
    const futureManifest = validManifest();
    futureManifest.generatedAt = '2026-08-13T01:00:00.000Z';
    futureManifest.records[0]!.occurredAt = '2026-08-13T00:30:00.000Z';
    futureManifest.records[0]!.localAccountingDate = '2026-08-13';
    await writeFile(join(root, 'provider-operational-usage.json'), JSON.stringify(futureManifest));

    const query = vi.fn(async (sql: string) => {
      if (sql.includes('ranked_bill_revisions')) return rows([]);
      if (sql.includes('FROM provider_operational_usage_records')) return rows([]);
      if (sql.includes('FROM provider_usage_records')) return rows([]);
      throw new Error(`未预期 SQL：${sql}`);
    });
    const report = await auditProviderBillingAttribution({
      client: { query } as unknown as DbClient,
      auditRoots: [root],
      asOf: '2026-08-12T00:00:00.000Z',
      generatedAt: '2026-08-12T00:01:00.000Z',
    });

    expect(report.provableUnattributedTests).toHaveLength(0);
  });

  it('manifest 引用的证据文件缺失或哈希不匹配时保持证据不足', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lindyson-billing-audit-evidence-'));
    temporaryRoots.push(root);
    const manifest = validManifest();
    manifest.records[0]!.evidencePath = '/audit/canary.evidence.json';
    await writeFile(join(root, 'canary.evidence.json'), 'tampered evidence\n');
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    await writeFile(join(root, 'provider-operational-usage.json'), manifestBytes);

    const query = vi.fn(async (sql: string) => {
      if (sql.includes('ranked_bill_revisions')) return rows([]);
      if (sql.includes('FROM provider_operational_usage_records')) return rows([]);
      if (sql.includes('FROM provider_usage_records')) return rows([]);
      if (sql.includes('FROM users')) return rows([{
        id: '00000000-0000-4000-8000-000000000001',
      }]);
      throw new Error(`未预期 SQL：${sql}`);
    });
    const report = await auditProviderBillingAttribution({
      client: { query } as unknown as DbClient,
      auditRoots: [root],
      asOf: '2026-08-12T00:00:00.000Z',
      generatedAt: '2026-08-12T00:01:00.000Z',
    });

    expect(report.provableUnattributedTests).toHaveLength(0);
    expect(report.insufficientEvidence).toEqual([
      expect.objectContaining({
        path: '/audit/canary.evidence.json',
        sourceRunId: 'seedance-shadow-run',
        sourceItemKey: 'scenario-1',
        reason: expect.stringContaining('SHA256 不匹配'),
      }),
    ]);

    await rm(join(root, 'canary.evidence.json'));
    const missingReport = await auditProviderBillingAttribution({
      client: { query } as unknown as DbClient,
      auditRoots: [root],
      asOf: '2026-08-12T00:00:00.000Z',
      generatedAt: '2026-08-12T00:01:00.000Z',
    });
    expect(missingReport.provableUnattributedTests).toHaveLength(0);
    expect(missingReport.insufficientEvidence).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('证据文件不可访问') }),
    ]);
  });

  it('内置冻结 Seedance 2.5 清单无原始文件时仍计入 Admin 运营估算且不形成官方归属', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lindyson-billing-audit-frozen-admin-'));
    temporaryRoots.push(root);
    const frozenBytes = await readFile(new URL(
      '../fixtures/provider-operational-usage/seedance-25-shadow-20260811.json',
      import.meta.url,
    ));
    const approvalBytes = await readFile(new URL(
      '../fixtures/provider-operational-usage/seedance-25-shadow-20260811.missing-original-approval.json',
      import.meta.url,
    ));
    await writeFile(join(root, 'seedance-25-shadow-20260811.json'), frozenBytes);
    const approvalPath = join(root, 'seedance-25-shadow-20260811.missing-original-approval.json');
    await writeFile(approvalPath, approvalBytes);
    const query = emptyAuditQuery();

    const report = await auditProviderBillingAttribution({
      client: { query } as unknown as DbClient,
      auditRoots: [root],
      asOf: '2026-08-13T00:00:00.000Z',
      generatedAt: '2026-08-13T00:01:00.000Z',
    });

    expect(report.reportVersion).toBe('lindyson.provider-billing-attribution-audit/v2');
    expect(report.adminOperationalEstimatedUsage).toHaveLength(6);
    expect(report.summary.adminOperationalEstimatedUsage).toBe(6);
    expect(report.summary.adminOperationalEstimatedCostCny).toBe('63.037310');
    expect(report.adminOperationalEstimatedUsage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        confirmationBasis: 'frozen-manifest',
        costOwnerUserId: '00000000-0000-4000-8000-00000000ad01',
        serviceType: 'video',
        model: 'Seedance 2.5',
        originalEvidenceStatus: 'unavailable',
        officialAttributionStatus: 'unattributed',
        confirmationApprovalSha256: '84d299fb94e2798ba52d759be8ee5b77bac00d50076dd73e0e550b9bce22c79c',
        confirmationApprovedByUserId: '00000000-0000-4000-8000-00000000ad01',
        confirmationApprovedAt: '2026-08-12T02:32:09.000Z',
      }),
    ]));
    expect(report.adminAlreadyAttributed).toHaveLength(0);
    expect(report.insufficientEvidence).toHaveLength(0);

    const beforeApproval = await auditProviderBillingAttribution({
      client: { query } as unknown as DbClient,
      auditRoots: [root],
      asOf: '2026-08-12T02:32:08.999Z',
      generatedAt: '2026-08-12T02:33:00.000Z',
    });
    expect(beforeApproval.adminOperationalEstimatedUsage).toHaveLength(0);
    expect(beforeApproval.summary.adminOperationalEstimatedCostCny).toBe('0.000000');
    expect(beforeApproval.insufficientEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: approvalPath,
        reason: expect.stringContaining('审批在 asOf 之后尚不可见'),
      }),
    ]));

    const tamperedApproval = JSON.parse(approvalBytes.toString()) as Record<string, unknown>;
    tamperedApproval.note = `${String(tamperedApproval.note)}（篡改）`;
    await writeFile(approvalPath, JSON.stringify(tamperedApproval));
    const tampered = await auditProviderBillingAttribution({
      client: { query } as unknown as DbClient,
      auditRoots: [root],
      asOf: '2026-08-13T00:00:00.000Z',
      generatedAt: '2026-08-13T00:01:00.000Z',
    });
    expect(tampered.adminOperationalEstimatedUsage).toHaveLength(0);
    expect(tampered.insufficientEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: approvalPath,
        reason: expect.stringContaining('审批原文 SHA256 与固定值不符'),
      }),
    ]));
  });

  it('已写入运营账本的严格证据清单按来源键去重，不再计入待入账清单', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lindyson-billing-audit-estimate-dedupe-'));
    temporaryRoots.push(root);
    const manifest = validManifest();
    const evidenceBytes = Buffer.from('{"providerTaskId":"provider-task-1"}\n');
    const evidenceSha256 = createHash('sha256').update(evidenceBytes).digest('hex');
    manifest.records[0]!.evidencePath = '/audit/evidence.json';
    manifest.records[0]!.evidenceSha256 = evidenceSha256;
    manifest.records[0]!.valuation.evidenceSha256 = evidenceSha256;
    await writeFile(join(root, 'evidence.json'), evidenceBytes);
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
    await writeFile(join(root, 'provider-operational-usage.json'), manifestBytes);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('ranked_bill_revisions')) return rows([]);
      if (sql.includes('FROM provider_operational_usage_records')) return rows([{
        id: 'operational-1',
        provider: 'volcengine-ark',
        source_run_id: 'seedance-shadow-run',
        source_item_key: 'scenario-1',
        manifest_sha256: manifestSha256,
        model: 'Seedance 2.5',
        service_type: 'video',
        occurred_at: '2026-08-11T00:30:00.000Z',
      }]);
      if (sql.includes('FROM provider_usage_records')) return rows([]);
      throw new Error(`未预期 SQL：${sql}`);
    });

    const report = await auditProviderBillingAttribution({
      client: { query } as unknown as DbClient,
      auditRoots: [root],
      asOf: '2026-08-12T00:00:00.000Z',
      generatedAt: '2026-08-12T00:01:00.000Z',
    });

    expect(report.adminOperationalEstimatedUsage).toHaveLength(0);
    expect(report.summary.adminOperationalEstimatedCostCny).toBe('0.000000');
    expect(report.adminAlreadyAttributed).toHaveLength(0);
    expect(report.provableUnattributedTests).toHaveLength(0);
    expect(report.insufficientEvidence).toHaveLength(0);
    expect(report.adminOperationalRecordedUsage).toEqual([
      expect.objectContaining({
        kind: 'operational-usage',
        sourceRunId: 'seedance-shadow-run',
        sourceItemKey: 'scenario-1',
        officialAttributionStatus: 'not-evaluated',
      }),
    ]);
  });
});

function emptyAuditQuery() {
  return vi.fn(async (sql: string) => {
    if (sql.includes('ranked_bill_revisions')) return rows([]);
    if (sql.includes('FROM provider_operational_usage_records')) return rows([]);
    if (sql.includes('FROM provider_usage_records')) return rows([]);
    if (sql.includes('FROM users')) return rows([{
      id: '00000000-0000-4000-8000-00000000ad01',
    }]);
    throw new Error(`未预期 SQL：${sql}`);
  });
}

function validManifest() {
  const sha = 'a'.repeat(64);
  return {
    manifestVersion: PROVIDER_OPERATIONAL_USAGE_MANIFEST_VERSION,
    manifestId: 'seedance-shadow-run',
    generatedAt: '2026-08-11T01:00:00.000Z',
    records: [{
      provider: 'volcengine-ark',
      serviceType: 'video',
      model: 'Seedance 2.5',
      operation: 'video-generation',
      costOwnerUserId: '00000000-0000-4000-8000-000000000001',
      purpose: 'deployment-canary',
      initiatorType: 'release-automation',
      initiatedByUserId: null,
      sourceRunId: 'seedance-shadow-run',
      sourceItemKey: 'scenario-1',
      providerTaskId: 'provider-task-1',
      providerOperationId: null,
      providerRequestId: 'provider-request-1',
      status: 'success',
      providerReached: true,
      occurredAt: '2026-08-11T00:30:00.000Z',
      localAccountingDate: '2026-08-11',
      usageEvidence: { billableTokens: 48_437 },
      evidencePath: '/opt/lindyson/deploy-audits/seedance-shadow-run/canary.ndjson',
      evidenceSha256: sha,
      valuation: {
        pricingStatus: 'priced',
        priceVersion: 'volcengine-seedance-2026-08-10',
        pricingSourceUrl: 'https://www.volcengine.com/docs/82379/1544106',
        unitPriceSnapshot: {
          calculationMethod: 'sum-of-rounded-components/v1',
          components: [{
            key: 'completion-tokens', quantity: '48437', unit: 'token', unitSize: '1000000',
            unitPriceCny: '70.000000', estimatedCostCny: '3.390590',
          }],
        },
        estimatedCostCny: '3.390590',
        currency: 'CNY',
        evidenceSha256: sha,
      },
    }],
  };
}

function officialRow(patch: Record<string, unknown>) {
  return {
    id: 'bill-business', provider: 'volcengine-ark', source_detail_key: 'Detail-business',
    revision_id: 'revision-1', bill_period: '2026-08', expense_date: '2026-08-11',
    product: 'ark_bd', product_name: '豆包大模型', service_type: 'video',
    model: 'Seedance 2.5', bill_line_type: 'usage', is_final: true,
    payable_amount_cny: '3.390590', attribution_status: 'business',
    attribution_evidence_id: 'evidence-1', has_immutable_revision: true, ...patch,
  };
}

function rows<T>(items: T[]) {
  return { rows: items, rowCount: items.length };
}
