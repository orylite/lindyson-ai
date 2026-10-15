import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DbClient } from '../db/pool.js';
import { pool } from '../db/pool.js';
import {
  computeProviderOperationalUsageManifestSha256,
  parseProviderOperationalUsageManifest,
  PROVIDER_OPERATIONAL_USAGE_MANIFEST_VERSION,
  type ProviderOperationalUsageRecordV1,
} from '../domain/providerOperationalUsageManifest.js';
import {
  approvalRecordKey,
  parseProviderOperationalUsageMissingEvidenceApprovalJson,
  PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_VERSION,
  type ProviderOperationalUsageMissingEvidenceApproval,
} from '../domain/providerOperationalUsageMissingEvidenceApproval.js';

const REPORT_VERSION = 'lindyson.provider-billing-attribution-audit/v2' as const;
const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;

// 该清单已由管理员在本地计划中按精确内容哈希冻结。内置条目只赋予
// “Admin 运营列表价估算”资格，不赋予官方账单归属或生产导入资格。
const FROZEN_ADMIN_OPERATIONAL_MANIFESTS = new Map<string, {
  manifestId: string;
  costOwnerUserId: string;
  approvalFileName: string;
  approvalSha256: string;
}>([
  [
    'c15207c28dc03c346468e188c27404dd10001bd78fe920d3b5aaa5434238833a',
    {
      manifestId: 'seedance-25-shadow-historical-20260811-v1',
      costOwnerUserId: '00000000-0000-4000-8000-00000000ad01',
      approvalFileName: 'seedance-25-shadow-20260811.missing-original-approval.json',
      approvalSha256: '84d299fb94e2798ba52d759be8ee5b77bac00d50076dd73e0e550b9bce22c79c',
    },
  ],
]);

interface OfficialAuditRow {
  id: string;
  provider: string;
  source_detail_key: string;
  revision_id: string | null;
  bill_period: string;
  expense_date: Date | string;
  product: string;
  product_name: string | null;
  service_type: 'video' | 'image' | 'multimodal' | 'storage' | 'other';
  model: string | null;
  bill_line_type: string;
  is_final: boolean;
  payable_amount_cny: string | null;
  attribution_status: 'business' | 'admin-operational' | 'account-level' | 'unattributed';
  attribution_evidence_id: string | null;
  has_immutable_revision: boolean;
}

interface ImportedOperationalRow {
  id: string;
  provider: string;
  source_run_id: string;
  source_item_key: string;
  manifest_sha256: string;
  model: string;
  service_type: string;
  occurred_at: Date | string;
}

interface LegacyAdminRow {
  id: string;
  provider: string;
  provider_task_id: string | null;
  model: string;
  estimated_cost_cny: string | null;
  occurred_at: Date | string;
}

interface EvidenceFinding {
  path: string;
  fileSha256: string;
  reason: string;
  sourceRunId?: string;
  sourceItemKey?: string;
  provider?: string;
  model?: string;
  manifestSha256?: string;
}

interface AdminOperationalEstimatedUsageFinding extends EvidenceFinding {
  confirmationBasis: 'frozen-manifest';
  costOwnerUserId: string;
  serviceType: ProviderOperationalUsageRecordV1['serviceType'];
  operation: string;
  purpose: ProviderOperationalUsageRecordV1['purpose'];
  status: ProviderOperationalUsageRecordV1['status'];
  occurredAt: string;
  localAccountingDate: string;
  usageEvidence: ProviderOperationalUsageRecordV1['usageEvidence'];
  pricingStatus: ProviderOperationalUsageRecordV1['valuation']['pricingStatus'];
  priceVersion: string | null;
  estimatedCostCny: string | null;
  currency: 'CNY';
  originalEvidencePath: string;
  originalEvidenceSha256: string;
  originalEvidenceStatus: 'verified' | 'unavailable';
  officialAttributionStatus: 'unattributed';
  confirmationApprovalSha256: string | null;
  confirmationApprovedByUserId: string | null;
  confirmationApprovedAt: string | null;
}

interface AdminOperationalConfirmation {
  basis: AdminOperationalEstimatedUsageFinding['confirmationBasis'];
  approvalSha256: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
}

interface AdminOperationalConfirmationResolution {
  confirmation: AdminOperationalConfirmation | null;
  failureReason: string | null;
  approvalPath: string | null;
}

export interface ProviderBillingAttributionAuditOptions {
  client: DbClient;
  auditRoots: string[];
  asOf: string;
  generatedAt?: string;
}

export interface ProviderBillingAttributionAuditReport {
  reportVersion: typeof REPORT_VERSION;
  generatedAt: string;
  asOf: string;
  scannedAuditRoots: string[];
  summary: {
    businessAlreadyAttributed: number;
    adminAlreadyAttributed: number;
    adminOperationalRecordedUsage: number;
    accountLevel: number;
    provableUnattributedTests: number;
    adminOperationalEstimatedUsage: number;
    adminOperationalEstimatedCostCny: string;
    insufficientEvidence: number;
    confirmedNoProviderCall: number;
  };
  businessAlreadyAttributed: Array<Record<string, unknown>>;
  adminAlreadyAttributed: Array<Record<string, unknown>>;
  adminOperationalRecordedUsage: Array<Record<string, unknown>>;
  accountLevel: Array<Record<string, unknown>>;
  provableUnattributedTests: EvidenceFinding[];
  adminOperationalEstimatedUsage: AdminOperationalEstimatedUsageFinding[];
  insufficientEvidence: EvidenceFinding[];
  confirmedNoProviderCall: EvidenceFinding[];
  safeguards: {
    automaticAttributionPerformed: false;
    productionDataWritten: false;
    ambiguousOfficialLinesRemainUnattributed: true;
    adminEstimateDoesNotImplyOfficialAttribution: true;
  };
  reportSha256: string;
}

/**
 * 只读生成归属候选清单。此函数不会写数据库，也不会把时间邻近当作唯一匹配证据。
 */
export async function auditProviderBillingAttribution(
  options: ProviderBillingAttributionAuditOptions,
): Promise<ProviderBillingAttributionAuditReport> {
  const asOf = parseAsOf(options.asOf);
  const generatedAt = options.generatedAt ? parseAsOf(options.generatedAt) : new Date().toISOString();
  const roots = [...new Set(options.auditRoots.map(root => resolve(root)))].sort();
  const [officialResult, operationalResult, legacyResult, evidence] = await Promise.all([
    readOfficialAttributionRows(options.client, asOf),
    readImportedOperationalRows(options.client, asOf),
    readLegacyAdminRows(options.client, asOf),
    scanAuditEvidence(roots, asOf),
  ]);

  const importedKeys = new Set(operationalResult.map(row => operationalSourceKey(
    row.provider,
    row.source_run_id,
    row.source_item_key,
  )));
  const businessAlreadyAttributed = officialResult
    .filter(row => row.attribution_status === 'business')
    .map(mapOfficialRow);
  const accountLevel = officialResult
    .filter(row => row.attribution_status === 'account-level')
    .map(mapOfficialRow);
  const adminAlreadyAttributed: Array<Record<string, unknown>> = officialResult
    .filter(row => row.attribution_status === 'admin-operational')
    .map(mapOfficialRow);
  const adminOperationalRecordedUsage: Array<Record<string, unknown>> = [
    ...operationalResult.map(row => ({
      kind: 'operational-usage',
      id: row.id,
      provider: row.provider,
      serviceType: row.service_type,
      model: row.model,
      sourceRunId: row.source_run_id,
      sourceItemKey: row.source_item_key,
      manifestSha256: row.manifest_sha256.trim(),
      occurredAt: toIso(row.occurred_at),
      officialAttributionStatus: 'not-evaluated',
    })),
    ...legacyResult.map(row => ({
      kind: 'legacy-admin-direct',
      id: row.id,
      provider: row.provider,
      model: row.model,
      providerTaskId: row.provider_task_id,
      estimatedCostCny: row.estimated_cost_cny,
      occurredAt: toIso(row.occurred_at),
      officialAttributionStatus: 'not-evaluated',
    })),
  ];

  const provableUnattributedTests = evidence.validManifestRecords
    .filter(item => !importedKeys.has(operationalSourceKey(
      item.record.provider,
      item.record.sourceRunId,
      item.record.sourceItemKey,
    )))
    .map(item => ({
      path: item.path,
      fileSha256: item.fileSha256,
      manifestSha256: item.manifestSha256,
      reason: '版本化 manifest 通过严格校验，但来源键尚未写入运营调用账本',
      provider: item.record.provider,
      model: item.record.model,
      sourceRunId: item.record.sourceRunId,
      sourceItemKey: item.record.sourceItemKey,
    }));

  const validManifestKeys = new Set(evidence.validManifestRecords.map(item => operationalSourceKey(
    item.record.provider,
    item.record.sourceRunId,
    item.record.sourceItemKey,
  )));
  const unrecordedEstimatedCandidates = evidence.adminOperationalEstimatedRecords.filter(item => {
      const key = operationalSourceKey(
        item.record.provider,
        item.record.sourceRunId,
        item.record.sourceItemKey,
      );
      return !importedKeys.has(key) && !validManifestKeys.has(key);
    });
  const ownerValidation = await validateAdminConfirmedManifestOwners(
    options.client,
    unrecordedEstimatedCandidates,
  );
  const estimatedClassification = classifyAdminOperationalEstimatedUsage(
    ownerValidation.records,
  );
  const adminOperationalEstimatedUsage = estimatedClassification.usage;

  const officialUnattributed: EvidenceFinding[] = officialResult
    .filter(row => row.attribution_status === 'unattributed')
    .map(row => ({
      path: `provider-bill-detail:${row.source_detail_key}`,
      fileSha256: '',
      reason: row.has_immutable_revision
        ? '官方 AI 用量行没有可唯一闭环的业务或 Admin 运营调用证据，保持未归属'
        : '官方账单投影行缺少 asOf 可见的不可变 revision/run_item，只能保守保持未归属',
      provider: row.provider,
      model: row.model ?? undefined,
    }));
  const insufficientEvidence = [
    ...officialUnattributed,
    ...evidence.insufficientEvidence,
    ...ownerValidation.conflicts,
    ...estimatedClassification.conflicts,
  ]
    .sort(compareFinding);
  const confirmedNoProviderCall = evidence.confirmedNoProviderCall.sort(compareFinding);
  const body = {
    reportVersion: REPORT_VERSION,
    generatedAt,
    asOf,
    scannedAuditRoots: roots,
    summary: {
      businessAlreadyAttributed: businessAlreadyAttributed.length,
      adminAlreadyAttributed: adminAlreadyAttributed.length,
      adminOperationalRecordedUsage: adminOperationalRecordedUsage.length,
      accountLevel: accountLevel.length,
      provableUnattributedTests: provableUnattributedTests.length,
      adminOperationalEstimatedUsage: adminOperationalEstimatedUsage.length,
      adminOperationalEstimatedCostCny: sumEstimatedCostCny(adminOperationalEstimatedUsage),
      insufficientEvidence: insufficientEvidence.length,
      confirmedNoProviderCall: confirmedNoProviderCall.length,
    },
    businessAlreadyAttributed,
    adminAlreadyAttributed,
    adminOperationalRecordedUsage,
    accountLevel,
    provableUnattributedTests: provableUnattributedTests.sort(compareFinding),
    adminOperationalEstimatedUsage,
    insufficientEvidence,
    confirmedNoProviderCall,
    safeguards: {
      automaticAttributionPerformed: false as const,
      productionDataWritten: false as const,
      ambiguousOfficialLinesRemainUnattributed: true as const,
      adminEstimateDoesNotImplyOfficialAttribution: true as const,
    },
  };
  return {
    ...body,
    reportSha256: sha256(JSON.stringify(body)),
  };
}

async function readOfficialAttributionRows(client: DbClient, asOf: string) {
  const result = await client.query<OfficialAuditRow>(
    `WITH ranked_bill_revisions AS (
       SELECT details.id,
              revisions.provider,
              revisions.source_detail_key,
              revisions.id AS revision_id,
              revisions.normalized_payload AS payload,
              runs.is_final,
              row_number() OVER (
                PARTITION BY revisions.provider, revisions.source_detail_key
                ORDER BY runs.completed_at DESC, revisions.observed_at DESC, revisions.id DESC
              ) AS run_rank
       FROM provider_bill_detail_revisions revisions
       JOIN provider_bill_sync_run_items items
         ON items.bill_detail_revision_id = revisions.id
       JOIN provider_billing_sync_runs runs
         ON runs.id = items.sync_run_id
        AND runs.status = 'success'
        AND runs.completed_at <= $1::timestamptz
       JOIN provider_bill_details details
         ON details.provider = revisions.provider
        AND details.source_detail_key = revisions.source_detail_key
       WHERE revisions.observed_at <= $1::timestamptz
         AND items.created_at <= $1::timestamptz
     ), revision_bill_details AS (
       SELECT id, provider, source_detail_key, revision_id,
              payload->>'billPeriod' AS bill_period,
              (payload->>'expenseDate')::date AS expense_date,
              payload->>'product' AS product,
              nullif(payload->>'productZh', '') AS product_name,
              nullif(payload->>'recognizedModel', '') AS model,
              nullif(payload->>'configName', '') AS config_name,
              coalesce(nullif(payload->>'billLineType', ''), 'other') AS bill_line_type,
              is_final,
              nullif(payload->>'payableAmountCny', '') AS payable_amount_cny,
              true AS has_immutable_revision
       FROM ranked_bill_revisions
       WHERE run_rank = 1
     ), fallback_bill_details AS (
       -- 历史投影或中断同步可能没有 asOf 可见的不可变 revision/run_item。
       -- 这些行仍需出现在全产品扫描中，但 mutable projection 永远不能作为
       -- 业务/Admin 唯一归属证据，后续关联由 has_immutable_revision 失败关闭。
       SELECT details.id, details.provider, details.source_detail_key,
              NULL::uuid AS revision_id,
              details.bill_period, details.expense_date, details.product,
              details.product_zh AS product_name,
              details.recognized_model AS model,
              details.config_name,
              coalesce(nullif(details.bill_line_type, ''), 'other') AS bill_line_type,
              details.is_final,
              details.payable_amount_cny::text AS payable_amount_cny,
              false AS has_immutable_revision
       FROM provider_bill_details details
       LEFT JOIN provider_billing_sync_runs last_seen_run
         ON last_seen_run.id = details.last_seen_run_id
       WHERE details.synced_at <= $1::timestamptz
         AND details.expense_date
           <= ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::date
         AND (
           last_seen_run.id IS NULL
           OR (
             last_seen_run.kind = 'bill'
             AND last_seen_run.status = 'success'
             AND last_seen_run.completed_at <= $1::timestamptz
           )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM ranked_bill_revisions visible_revision
           WHERE visible_revision.id = details.id
             AND visible_revision.run_rank = 1
         )
     ), bill_details AS (
       SELECT * FROM revision_bill_details
       UNION ALL
       SELECT * FROM fallback_bill_details
     ), as_of_bills AS (
       SELECT bills.*,
              CASE
                WHEN lower(concat_ws(' ', bills.product, bills.product_name, bills.config_name))
                  ~ '(对象存储|object[ -]?storage|(^|[^a-z])tos([^a-z]|$))' THEN 'storage'
                WHEN lower(concat_ws(' ', bills.model, bills.config_name, bills.product_name))
                  ~ '(seedance|视频生成|video[ -]?generation)' THEN 'video'
                WHEN lower(concat_ws(' ', bills.model, bills.config_name, bills.product_name))
                  ~ '(seedream|图片生成|图像生成|image[ -]?generation)' THEN 'image'
                WHEN bills.product = 'ark_bd'
                  OR lower(concat_ws(' ', bills.product_name, bills.config_name))
                    ~ '(豆包大模型|方舟|multimodal|大模型)' THEN 'multimodal'
                ELSE 'other'
              END AS service_type
       FROM bill_details bills
     ), current_events AS (
       SELECT event.*
       FROM provider_bill_attribution_events event
       WHERE event.recorded_at <= $1::timestamptz
         AND event.event_type IN ('link', 'supersede')
         AND NOT EXISTS (
           SELECT 1 FROM provider_bill_attribution_events successor
           WHERE successor.supersedes_event_id = event.id
             AND successor.recorded_at <= $1::timestamptz
         )
     )
     SELECT bills.id, bills.provider, bills.source_detail_key, bills.revision_id,
            bills.bill_period, bills.expense_date, bills.product, bills.product_name,
            bills.service_type, bills.model, bills.bill_line_type, bills.is_final,
            bills.payable_amount_cny,
            CASE
              WHEN bills.service_type = 'storage'
                OR bills.bill_line_type IN ('package-purchase', 'refund', 'adjustment')
                THEN 'account-level'
              WHEN (operational.id IS NOT NULL OR legacy_admin.id IS NOT NULL)
                AND business.id IS NOT NULL THEN 'unattributed'
              WHEN operational.id IS NOT NULL OR legacy_admin.id IS NOT NULL THEN 'admin-operational'
              WHEN business.id IS NOT NULL THEN 'business'
              ELSE 'unattributed'
            END AS attribution_status,
            CASE
              WHEN (operational.id IS NOT NULL OR legacy_admin.id IS NOT NULL)
                AND business.id IS NOT NULL THEN NULL
              ELSE coalesce(operational.id, legacy_admin.id, business.id)
            END AS attribution_evidence_id,
            bills.has_immutable_revision
     FROM as_of_bills bills
     LEFT JOIN LATERAL (
       SELECT event.id
       FROM current_events event
       WHERE bills.has_immutable_revision
         AND event.provider_bill_detail_id = bills.id
         AND event.provider_bill_detail_revision_id = bills.revision_id
       ORDER BY event.recorded_at DESC, event.id DESC
       LIMIT 1
     ) operational ON true
     LEFT JOIN LATERAL (
       SELECT links.id
       FROM provider_reconciliation_case_links links
       JOIN provider_reconciliation_cases reconciliation_case
         ON reconciliation_case.id = links.case_id
       JOIN provider_usage_records usage ON usage.id = links.usage_record_id
       WHERE bills.has_immutable_revision
         AND links.bill_detail_id = bills.id
         AND links.created_at <= $1::timestamptz
         AND links.bill_detail_revision_id = bills.revision_id
         AND reconciliation_case.status IN ('approved', 'superseded')
         AND reconciliation_case.created_at <= $1::timestamptz
         AND NOT EXISTS (
           SELECT 1 FROM provider_reconciliation_cases successor_case
           WHERE successor_case.supersedes_case_id = reconciliation_case.id
             AND successor_case.created_at <= $1::timestamptz
         )
         AND usage.task_id IS NULL
         AND usage.initiated_by_admin_user_id IS NOT NULL
       ORDER BY links.created_at DESC, links.id DESC
       LIMIT 1
     ) legacy_admin ON true
     LEFT JOIN LATERAL (
       SELECT links.id
       FROM provider_reconciliation_case_links links
       JOIN provider_reconciliation_cases reconciliation_case
         ON reconciliation_case.id = links.case_id
       JOIN provider_usage_records usage ON usage.id = links.usage_record_id
       WHERE bills.has_immutable_revision
         AND links.bill_detail_id = bills.id
         AND links.created_at <= $1::timestamptz
         AND links.bill_detail_revision_id = bills.revision_id
         AND reconciliation_case.status IN ('approved', 'superseded')
         AND reconciliation_case.created_at <= $1::timestamptz
         AND NOT EXISTS (
           SELECT 1 FROM provider_reconciliation_cases successor_case
           WHERE successor_case.supersedes_case_id = reconciliation_case.id
             AND successor_case.created_at <= $1::timestamptz
         )
         AND usage.task_id IS NOT NULL
       ORDER BY links.created_at DESC, links.id DESC
       LIMIT 1
     ) business ON true
     ORDER BY bills.expense_date, bills.provider, bills.source_detail_key`,
    [asOf],
  );
  return result.rows;
}

async function readImportedOperationalRows(client: DbClient, asOf: string) {
  const result = await client.query<ImportedOperationalRow>(
    `SELECT id::text, provider, source_run_id, source_item_key, manifest_sha256,
            model, service_type, occurred_at
     FROM provider_operational_usage_records
     WHERE recorded_at <= $1::timestamptz
     ORDER BY occurred_at, id`,
    [asOf],
  );
  return result.rows;
}

async function readLegacyAdminRows(client: DbClient, asOf: string) {
  const result = await client.query<LegacyAdminRow>(
    `SELECT id::text, provider, provider_task_id, model,
            estimated_cost::text AS estimated_cost_cny,
            coalesce(provider_terminal_at, completed_at, created_at) AS occurred_at
     FROM provider_usage_records
     WHERE task_id IS NULL
       AND initiated_by_admin_user_id IS NOT NULL
       AND created_at <= $1::timestamptz
       AND coalesce(provider_terminal_at, completed_at, created_at) <= $1::timestamptz
     ORDER BY occurred_at, id`,
    [asOf],
  );
  return result.rows;
}

interface ScannedEvidence {
  validManifestRecords: Array<{
    path: string;
    fileSha256: string;
    manifestSha256: string;
    record: ProviderOperationalUsageRecordV1;
  }>;
  adminOperationalEstimatedRecords: Array<{
    path: string;
    fileSha256: string;
    manifestSha256: string;
    record: ProviderOperationalUsageRecordV1;
    confirmationBasis: AdminOperationalEstimatedUsageFinding['confirmationBasis'];
    confirmationApprovalSha256: string | null;
    confirmationApprovedByUserId: string | null;
    confirmationApprovedAt: string | null;
    originalEvidenceStatus: 'verified' | 'unavailable';
    evidenceReason: string;
  }>;
  insufficientEvidence: EvidenceFinding[];
  confirmedNoProviderCall: EvidenceFinding[];
}

export async function scanAuditEvidence(
  roots: string[],
  asOf?: string,
): Promise<ScannedEvidence> {
  const evidenceCutoff = asOf ? Date.parse(parseAsOf(asOf)) : null;
  const findings: ScannedEvidence = {
    validManifestRecords: [],
    adminOperationalEstimatedRecords: [],
    insufficientEvidence: [],
    confirmedNoProviderCall: [],
  };
  for (const root of roots) {
    let files: string[];
    try {
      files = await walkEvidenceFiles(root);
    } catch (error) {
      findings.insufficientEvidence.push({
        path: root,
        fileSha256: '',
        reason: `无法读取审计根目录：${safeErrorMessage(error)}`,
      });
      continue;
    }
    const referencedEvidenceFiles = await discoverReferencedEvidenceFiles(files);
    for (const path of files) {
      if (referencedEvidenceFiles.has(resolve(path))) continue;
      await inspectEvidenceFile(
        path,
        findings,
        evidenceCutoff,
      );
    }
  }
  return findings;
}

async function discoverReferencedEvidenceFiles(files: string[]) {
  const referenced = new Set<string>();
  for (const manifestPath of files.filter(path => path.toLowerCase().endsWith('.json'))) {
    try {
      const raw = await readFile(manifestPath);
      if (raw.byteLength > MAX_EVIDENCE_BYTES) continue;
      const parsed: unknown = JSON.parse(raw.toString('utf8'));
      if (!isRecord(parsed) || parsed.manifestVersion !== PROVIDER_OPERATIONAL_USAGE_MANIFEST_VERSION) continue;
      const manifest = parseProviderOperationalUsageManifest(parsed);
      manifest.records.forEach(record => {
        evidenceCandidates(manifestPath, record.evidencePath)
          .forEach(candidate => referenced.add(candidate));
      });
    } catch {
      // 无效 manifest 仍由正式扫描阶段归入证据不足，不能据此隐藏其他文件。
    }
  }
  return referenced;
}

async function walkEvidenceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && isEvidenceFilename(entry.name)) files.push(path);
    }
  }
  return files.sort();
}

function isEvidenceFilename(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith('.json') || lower.endsWith('.ndjson') || lower.endsWith('.jsonl')
    || isTextAuditSummaryFilename(lower);
}

function isTextAuditSummaryFilename(name: string) {
  const lower = basename(name).toLowerCase();
  return lower.endsWith('summary.txt')
    || lower.includes('execution-summary.')
    || lower.includes('failure-summary.');
}

async function inspectEvidenceFile(
  path: string,
  findings: ScannedEvidence,
  evidenceCutoff: number | null,
) {
  let raw: Buffer;
  try {
    raw = await readFile(path);
  } catch (error) {
    findings.insufficientEvidence.push({
      path,
      fileSha256: '',
      reason: `无法读取证据文件：${safeErrorMessage(error)}`,
    });
    return;
  }
  const fileSha256 = sha256(raw);
  if (raw.byteLength > MAX_EVIDENCE_BYTES) {
    findings.insufficientEvidence.push({ path, fileSha256, reason: '证据文件超过 20 MiB 安全上限，未解析' });
    return;
  }
  const text = raw.toString('utf8').trim();
  if (isTextAuditSummaryFilename(path)) {
    if (!text) {
      findings.insufficientEvidence.push({ path, fileSha256, reason: '文本审计摘要为空，无法判断 Provider 是否触达' });
      return;
    }
    const recordedAt = inferTextEvidenceRecordedAt(path, text);
    if (evidenceCutoff !== null) {
      if (recordedAt === null) {
        findings.insufficientEvidence.push({
          path,
          fileSha256,
          reason: '文本审计摘要缺少可验证的记录时间，无法满足 asOf 可见性，保持证据不足',
        });
        return;
      }
      if (recordedAt > evidenceCutoff) return;
    }
    classifyTextAuditSummary(path, fileSha256, text, findings);
    return;
  }
  if (!text) return;
  if (path.endsWith('.ndjson') || path.endsWith('.jsonl')) {
    inspectNdjson(path, fileSha256, text, findings);
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    findings.insufficientEvidence.push({ path, fileSha256, reason: 'JSON 无法解析' });
    return;
  }
  if (isRecord(parsed) && parsed.manifestVersion === PROVIDER_OPERATIONAL_USAGE_MANIFEST_VERSION) {
    try {
      const manifest = parseProviderOperationalUsageManifest(parsed);
      if (evidenceCutoff !== null && Date.parse(manifest.generatedAt) > evidenceCutoff) return;
      const manifestSha256 = computeProviderOperationalUsageManifestSha256(raw);
      const confirmationResolution = await resolveAdminOperationalConfirmation(
        path,
        manifest,
        manifestSha256,
        evidenceCutoff,
      );
      const confirmation = confirmationResolution.confirmation;
      if (confirmationResolution.failureReason) {
        findings.insufficientEvidence.push({
          path: confirmationResolution.approvalPath ?? path,
          fileSha256: '',
          manifestSha256,
          reason: confirmationResolution.failureReason,
        });
      }
      const evidenceHashes = new Map<string, string | null>();
      for (const record of manifest.records) {
        if (evidenceCutoff !== null && Date.parse(record.occurredAt) > evidenceCutoff) continue;
        const verification = await verifyManifestRecordEvidence(path, record, evidenceHashes);
        if (!verification.matched) {
          if (verification.actualSha256 === null && confirmation !== null) {
            findings.adminOperationalEstimatedRecords.push({
              path,
              fileSha256,
              manifestSha256,
              record,
              confirmationBasis: confirmation.basis,
              confirmationApprovalSha256: confirmation.approvalSha256,
              confirmationApprovedByUserId: confirmation.approvedByUserId,
              confirmationApprovedAt: confirmation.approvedAt,
              originalEvidenceStatus: 'unavailable',
              evidenceReason: verification.reason,
            });
            continue;
          }
          findings.insufficientEvidence.push({
            path: record.evidencePath,
            fileSha256: verification.actualSha256 ?? '',
            reason: `${verification.reason}；manifest=${path}`,
            provider: record.provider,
            model: record.model,
            sourceRunId: record.sourceRunId,
            sourceItemKey: record.sourceItemKey,
            manifestSha256,
          });
          continue;
        }
        if (confirmation !== null) {
          findings.adminOperationalEstimatedRecords.push({
            path,
            fileSha256,
            manifestSha256,
            record,
            confirmationBasis: confirmation.basis,
            confirmationApprovalSha256: confirmation.approvalSha256,
            confirmationApprovedByUserId: confirmation.approvedByUserId,
            confirmationApprovedAt: confirmation.approvedAt,
            originalEvidenceStatus: 'verified',
            evidenceReason: '运营调用 manifest 引用的原始证据文件 SHA256 已通过校验',
          });
          continue;
        }
        findings.validManifestRecords.push({ path, fileSha256, manifestSha256, record });
      }
    } catch (error) {
      findings.insufficientEvidence.push({
        path,
        fileSha256,
        reason: `运营调用 manifest 校验失败：${safeErrorMessage(error)}`,
      });
    }
    return;
  }
  if (
    isRecord(parsed)
    && parsed.approvalVersion === PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_VERSION
  ) {
    try {
      parseProviderOperationalUsageMissingEvidenceApprovalJson(raw);
    } catch (error) {
      findings.insufficientEvidence.push({
        path,
        fileSha256,
        reason: `缺原始证据审批文件校验失败：${safeErrorMessage(error)}`,
      });
    }
    return;
  }
  classifyLegacyEvidence(path, fileSha256, parsed, findings);
}

async function verifyManifestRecordEvidence(
  manifestPath: string,
  record: ProviderOperationalUsageRecordV1,
  cache: Map<string, string | null>,
) {
  let readableEvidenceFound = false;
  let actualSha256: string | null = null;
  for (const candidate of evidenceCandidates(manifestPath, record.evidencePath)) {
    let candidateSha256 = cache.get(candidate);
    if (candidateSha256 === undefined) {
      try {
        candidateSha256 = sha256(await readFile(candidate));
      } catch {
        candidateSha256 = null;
      }
      cache.set(candidate, candidateSha256);
    }
    if (!candidateSha256) continue;
    readableEvidenceFound = true;
    actualSha256 ??= candidateSha256;
    if (candidateSha256 === record.evidenceSha256) {
      return { matched: true as const, actualSha256: candidateSha256, reason: null };
    }
  }
  return readableEvidenceFound
    ? {
        matched: false as const,
        actualSha256,
        reason: '运营调用 manifest 引用的证据文件原始字节 SHA256 不匹配',
      }
    : {
        matched: false as const,
        actualSha256: null,
        reason: '运营调用 manifest 引用的证据文件不可访问',
      };
}

function evidenceCandidates(manifestPath: string, evidencePath: string) {
  const candidates = new Set<string>();
  if (isAbsolute(evidencePath)) candidates.add(resolve(evidencePath));
  else candidates.add(resolve(dirname(manifestPath), evidencePath));
  // canary 在容器内通常写入 /audit，宿主机扫描时挂载点已经迁移；只允许回退到
  // manifest 同目录的同名证据文件，不能在审计树里模糊搜索同名文件。
  candidates.add(resolve(dirname(manifestPath), basename(evidencePath)));
  return candidates;
}

async function resolveAdminOperationalConfirmation(
  manifestPath: string,
  manifest: ReturnType<typeof parseProviderOperationalUsageManifest>,
  manifestSha256: string,
  evidenceCutoff: number | null,
): Promise<AdminOperationalConfirmationResolution> {
  const frozen = FROZEN_ADMIN_OPERATIONAL_MANIFESTS.get(manifestSha256);
  if (frozen) {
    const approvalPath = resolve(dirname(manifestPath), frozen.approvalFileName);
    if (
      manifest.manifestId !== frozen.manifestId
      || !manifest.records.every(record => record.costOwnerUserId === frozen.costOwnerUserId)
    ) {
      return confirmationFailure(
        approvalPath,
        '冻结运营清单的标识或成本承担者与固定审批边界不一致，拒绝计入 Admin 估算消耗',
      );
    }
    let rawApproval: Buffer;
    try {
      rawApproval = await readFile(approvalPath);
    } catch {
      return confirmationFailure(
        approvalPath,
        '冻结运营清单缺少同目录管理员审批原文，拒绝计入 Admin 估算消耗',
      );
    }
    if (rawApproval.byteLength > MAX_EVIDENCE_BYTES) {
      return confirmationFailure(
        approvalPath,
        '冻结运营清单的管理员审批原文超过 20 MiB 安全上限，拒绝计入 Admin 估算消耗',
      );
    }
    const approvalSha256 = sha256(rawApproval);
    if (approvalSha256 !== frozen.approvalSha256) {
      return confirmationFailure(
        approvalPath,
        '冻结运营清单的管理员审批原文 SHA256 与固定值不符，拒绝计入 Admin 估算消耗',
      );
    }
    let approval: ProviderOperationalUsageMissingEvidenceApproval;
    try {
      approval = parseProviderOperationalUsageMissingEvidenceApprovalJson(rawApproval);
    } catch (error) {
      return confirmationFailure(
        approvalPath,
        `冻结运营清单的管理员审批原文校验失败：${safeErrorMessage(error)}`,
      );
    }
    const approvalFailure = validateFrozenMissingEvidenceApproval(
      manifest,
      manifestSha256,
      frozen.costOwnerUserId,
      approval,
      evidenceCutoff,
    );
    if (approvalFailure) return confirmationFailure(approvalPath, approvalFailure);
    return {
      confirmation: {
        basis: 'frozen-manifest',
        approvalSha256,
        approvedByUserId: approval.approvedByUserId,
        approvedAt: approval.approvedAt,
      },
      failureReason: null,
      approvalPath,
    };
  }
  return { confirmation: null, failureReason: null, approvalPath: null };
}

function validateFrozenMissingEvidenceApproval(
  manifest: ReturnType<typeof parseProviderOperationalUsageManifest>,
  manifestSha256: string,
  costOwnerUserId: string,
  approval: ProviderOperationalUsageMissingEvidenceApproval,
  evidenceCutoff: number | null,
) {
  if (
    approval.manifestSha256 !== manifestSha256
    || approval.approvedByUserId !== costOwnerUserId
  ) {
    return '冻结运营清单的管理员审批未精确绑定 manifest 或成本承担者，拒绝计入 Admin 估算消耗';
  }
  const approvalAt = Date.parse(approval.approvedAt);
  if (
    approvalAt < Date.parse(manifest.generatedAt)
    || manifest.records.some(record => approvalAt < Date.parse(record.occurredAt))
  ) {
    return '冻结运营清单的管理员审批早于清单生成或调用发生时间，拒绝计入 Admin 估算消耗';
  }
  if (evidenceCutoff !== null && approvalAt > evidenceCutoff) {
    return '冻结运营清单的管理员审批在 asOf 之后尚不可见，拒绝计入 Admin 估算消耗';
  }
  const approvedRecords = new Map(approval.records.map(record => [approvalRecordKey(record), record]));
  if (approvedRecords.size !== manifest.records.length) {
    return '冻结运营清单的管理员审批未精确覆盖全部记录，拒绝计入 Admin 估算消耗';
  }
  for (const record of manifest.records) {
    const approved = approvedRecords.get(approvalRecordKey(record));
    if (
      !approved
      || approved.evidencePath !== record.evidencePath
      || approved.evidenceSha256 !== record.evidenceSha256
    ) {
      return '冻结运营清单的管理员审批记录范围或证据引用不一致，拒绝计入 Admin 估算消耗';
    }
  }
  return null;
}

function confirmationFailure(
  approvalPath: string,
  failureReason: string,
): AdminOperationalConfirmationResolution {
  return { confirmation: null, failureReason, approvalPath };
}

// 承担官网运营用量成本的管理员账号，可通过 PROVIDER_BILLING_ADMIN_EMAIL 覆盖。
const ADMIN_COST_OWNER_EMAIL = (process.env.PROVIDER_BILLING_ADMIN_EMAIL ?? 'admin@lindyson.com').trim().toLowerCase();

async function validateAdminConfirmedManifestOwners(
  client: DbClient,
  records: ScannedEvidence['adminOperationalEstimatedRecords'],
) {
  if (records.length === 0) return { records, conflicts: [] as EvidenceFinding[] };
  const result = await client.query<{ id: string }>(
    `SELECT id::text AS id
     FROM users
     WHERE lower(email) = lower($1)
       AND role = 'admin'
       AND status = 'active'
     ORDER BY id`,
    [ADMIN_COST_OWNER_EMAIL],
  );
  const uniqueAdminId = result.rows.length === 1 ? result.rows[0]!.id : null;
  const conflicts: EvidenceFinding[] = [];
  const approvedRecords = records.filter(item => {
    const frozenApprovalOwnerMatches = item.confirmationBasis !== 'frozen-manifest'
      || item.confirmationApprovedByUserId === uniqueAdminId;
    if (
      uniqueAdminId !== null
      && item.record.costOwnerUserId === uniqueAdminId
      && frozenApprovalOwnerMatches
    ) return true;
    conflicts.push({
      path: item.path,
      fileSha256: item.fileSha256,
      manifestSha256: item.manifestSha256,
      provider: item.record.provider,
      model: item.record.model,
      sourceRunId: item.record.sourceRunId,
      sourceItemKey: item.record.sourceItemKey,
      reason: uniqueAdminId === null
        ? '管理员确认/冻结 manifest 无法解析到唯一、有效的管理员成本承担者，拒绝计入 Admin 估算消耗'
        : '管理员确认/冻结 manifest 的成本承担者不是唯一、有效的管理员账号，或冻结审批人不匹配，拒绝计入 Admin 估算消耗',
    });
    return false;
  });
  return { records: approvedRecords, conflicts: conflicts.sort(compareFinding) };
}

function classifyAdminOperationalEstimatedUsage(
  records: ScannedEvidence['adminOperationalEstimatedRecords'],
) {
  const grouped = new Map<string, typeof records>();
  [...records].sort(compareScannedManifestRecord).forEach(item => {
    const key = operationalSourceKey(
      item.record.provider,
      item.record.sourceRunId,
      item.record.sourceItemKey,
    );
    const group = grouped.get(key) ?? [];
    group.push(item);
    grouped.set(key, group);
  });
  const usage: AdminOperationalEstimatedUsageFinding[] = [];
  const conflicts: EvidenceFinding[] = [];
  for (const group of grouped.values()) {
    const signatures = new Set(group.map(item => JSON.stringify(item.record)));
    if (signatures.size > 1) {
      const first = group[0]!;
      conflicts.push({
        path: first.path,
        fileSha256: first.fileSha256,
        manifestSha256: first.manifestSha256,
        provider: first.record.provider,
        model: first.record.model,
        sourceRunId: first.record.sourceRunId,
        sourceItemKey: first.record.sourceItemKey,
        reason: '多个管理员确认/冻结 manifest 对同一运营来源键给出冲突事实，已拒绝计入 Admin 估算消耗',
      });
      continue;
    }
    const item = group[0]!;
    usage.push({
      path: item.path,
      fileSha256: item.fileSha256,
      manifestSha256: item.manifestSha256,
      reason: item.originalEvidenceStatus === 'verified'
        ? '管理员确认/冻结 manifest 已通过原始证据哈希校验；仅计入 Admin 运营列表价估算，不改变官方账单归属'
        : `管理员确认/冻结 manifest 可计入 Admin 运营列表价估算；${item.evidenceReason}；不改变官方账单归属`,
      provider: item.record.provider,
      model: item.record.model,
      sourceRunId: item.record.sourceRunId,
      sourceItemKey: item.record.sourceItemKey,
      confirmationBasis: item.confirmationBasis,
      costOwnerUserId: item.record.costOwnerUserId,
      serviceType: item.record.serviceType,
      operation: item.record.operation,
      purpose: item.record.purpose,
      status: item.record.status,
      occurredAt: item.record.occurredAt,
      localAccountingDate: item.record.localAccountingDate,
      usageEvidence: item.record.usageEvidence,
      pricingStatus: item.record.valuation.pricingStatus,
      priceVersion: item.record.valuation.priceVersion,
      estimatedCostCny: item.record.valuation.estimatedCostCny,
      currency: item.record.valuation.currency,
      originalEvidencePath: item.record.evidencePath,
      originalEvidenceSha256: item.record.evidenceSha256,
      originalEvidenceStatus: item.originalEvidenceStatus,
      officialAttributionStatus: 'unattributed',
      confirmationApprovalSha256: item.confirmationApprovalSha256,
      confirmationApprovedByUserId: item.confirmationApprovedByUserId,
      confirmationApprovedAt: item.confirmationApprovedAt,
    });
  }
  return {
    usage: usage.sort(compareFinding),
    conflicts: conflicts.sort(compareFinding),
  };
}

function compareScannedManifestRecord(
  left: ScannedEvidence['adminOperationalEstimatedRecords'][number],
  right: ScannedEvidence['adminOperationalEstimatedRecords'][number],
) {
  return left.path.localeCompare(right.path)
    || left.record.sourceRunId.localeCompare(right.record.sourceRunId)
    || left.record.sourceItemKey.localeCompare(right.record.sourceItemKey);
}

function sumEstimatedCostCny(records: AdminOperationalEstimatedUsageFinding[]) {
  const micros = records.reduce((sum, record) => (
    sum + (record.estimatedCostCny ? parseCnyMicros(record.estimatedCostCny) : 0n)
  ), 0n);
  return formatCnyMicros(micros);
}

function parseCnyMicros(value: string) {
  const [whole, fraction] = value.split('.');
  return BigInt(whole!) * 1_000_000n + BigInt(fraction!);
}

function formatCnyMicros(value: bigint) {
  return `${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, '0')}`;
}

function inspectNdjson(path: string, fileSha256: string, text: string, findings: ScannedEvidence) {
  const records: unknown[] = [];
  let invalidLines = 0;
  text.split(/\r?\n/).filter(Boolean).forEach(line => {
    try { records.push(JSON.parse(line)); } catch { invalidLines += 1; }
  });
  if (invalidLines > 0) {
    findings.insufficientEvidence.push({
      path, fileSha256, reason: `NDJSON 有 ${invalidLines} 行无法解析，不能据此定价`,
    });
  }
  classifyLegacyEvidence(path, fileSha256, records, findings);
}

function classifyLegacyEvidence(
  path: string,
  fileSha256: string,
  value: unknown,
  findings: ScannedEvidence,
) {
  const reachability = summarizeProviderReachability(value);
  if (reachability.explicitNo && !reachability.explicitYes) {
    findings.confirmedNoProviderCall.push({
      path,
      fileSha256,
      reason: '审计摘要明确记录 Provider 调用数为 0 或 providerReached=false',
    });
    return;
  }
  if (containsProviderEvidence(value) || looksLikeProviderAuditFile(path)) {
    findings.insufficientEvidence.push({
      path,
      fileSha256,
      reason: '旧版供应商证据未形成通过严格校验的运营调用 manifest；不得猜测缓存 Token、价格或调用次数',
    });
  }
}

function classifyTextAuditSummary(
  path: string,
  fileSha256: string,
  text: string,
  findings: ScannedEvidence,
) {
  const reachability = summarizeTextProviderReachability(text);
  if (reachability.explicitNo && !reachability.explicitYes) {
    findings.confirmedNoProviderCall.push({
      path,
      fileSha256,
      reason: '文本审计摘要明确记录 Provider 零调用/未触达，且未发现 Provider ID、正调用数或正 Token 证据',
    });
    return;
  }
  findings.insufficientEvidence.push({
    path,
    fileSha256,
    reason: reachability.explicitNo && reachability.explicitYes
      ? '文本审计摘要同时包含零调用与 Provider 触达、ID 或正计数证据，禁止误归为明确未调用'
      : reachability.explicitYes
        ? '文本审计摘要包含 Provider 触达、ID 或正计数证据，但没有通过严格校验的运营调用 manifest'
        : '文本审计摘要没有足以判定 Provider 零调用或唯一闭环调用的证据，保持证据不足',
  });
}

function summarizeTextProviderReachability(text: string) {
  let explicitNo = false;
  let explicitYes = false;
  let phaseIsPreprovider = false;
  let executionNotStarted = false;
  let providerContainerNotStarted = false;
  let paidCanarySkipped = false;
  let runnerNotExecuted = false;

  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z][A-Za-z0-9_.-]{0,100})\s*[:=]\s*(.*?)\s*$/u.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase().replace(/[^a-z0-9]/gu, '');
    const value = match[2]!.trim();
    const marker = booleanMarker(value);
    const count = numericCount(value);

    if (key === 'phase' && value.toLowerCase() === 'preprovider') phaseIsPreprovider = true;
    if (key === 'executionstarted' && marker === false) executionNotStarted = true;
    if (key === 'providercontainerstarted') {
      if (marker === false) providerContainerNotStarted = true;
      if (marker === true) explicitYes = true;
    }
    if (key === 'paidcanary' && value.toLowerCase() === 'skipped') paidCanarySkipped = true;
    if (key === 'runnerexecuted') {
      if (marker === false) runnerNotExecuted = true;
      if (marker === true) explicitYes = true;
    }

    if (PROVIDER_ZERO_OR_POSITIVE_COUNT_KEYS.has(key)) {
      if (count === 0) explicitNo = true;
      else if (count !== null && count > 0) explicitYes = true;
    }
    if (PROVIDER_REACHABILITY_BOOLEAN_KEYS.has(key)) {
      if (marker === false) explicitNo = true;
      else if (marker === true) explicitYes = true;
    }
    if (PROVIDER_EXECUTION_EVIDENCE_BOOLEAN_KEYS.has(key) && marker === true) {
      explicitYes = true;
    }
    if (isPositiveProviderIdentifier(key, value)) explicitYes = true;
    if (isUsageCountKey(key) && count !== null && count > 0) explicitYes = true;
  }

  if (phaseIsPreprovider && executionNotStarted && providerContainerNotStarted) explicitNo = true;
  if (paidCanarySkipped && runnerNotExecuted) explicitNo = true;

  const normalized = text.normalize('NFKC');
  if (
    /(?:provider|供应商)\s*(?:调用|请求|call|request)(?:数|s|[ _-]*count)?\s*(?:=|:|为|is)\s*0\b/iu.test(normalized)
    || /(?:未|没有|从未)\s*(?:执行|发生|触达|调用|发送)[^\n]{0,20}(?:provider|供应商)\s*(?:调用|请求)?/iu.test(normalized)
    || /(?:没有|无)\s*(?:任何\s*)?(?:provider|供应商)\s*(?:调用|请求)/iu.test(normalized)
    || /(?:no|zero)\s+(?:real\s+)?provider\s+(?:call|request)s?\b/iu.test(normalized)
    || /(?:provider|供应商)[^\n]{0,20}(?:未触达|未调用|未请求)/iu.test(normalized)
  ) explicitNo = true;
  if (
    /(?:provider|供应商)\s*(?:调用|请求|call|request)(?:数|s|[ _-]*count)?\s*(?:=|:|为|is)\s*[1-9]\d*\b/iu.test(normalized)
    || /(?:已|成功)\s*(?:触达|调用|请求)[^\n]{0,20}(?:provider|供应商)/iu.test(normalized)
    || /(?:provider|供应商)[^\n]{0,20}(?:已触达|已调用|调用成功)/iu.test(normalized)
  ) explicitYes = true;

  return { explicitNo, explicitYes };
}

const PROVIDER_ZERO_OR_POSITIVE_COUNT_KEYS = new Set([
  'providercallcount',
  'providercalls',
  'providerrequestcount',
  'providerrequests',
  'providergenerationcount',
  'providergenerations',
  'realprovidercallcount',
]);

const PROVIDER_REACHABILITY_BOOLEAN_KEYS = new Set([
  'providerreached',
  'realprovidercalled',
]);

const PROVIDER_EXECUTION_EVIDENCE_BOOLEAN_KEYS = new Set([
  'providergenerationverified',
  'providerrequestsubmitted',
  'providersubmissionstarted',
]);

function booleanMarker(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function isPositiveProviderIdentifier(key: string, value: string) {
  const isProviderId = /^(?:provider(?:task|operation|request|run|trace)id|xttlogid)$/u.test(key);
  if (!isProviderId) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== ''
    && !['null', 'none', 'unknown', 'unavailable', 'not-created', 'notcreated', '-'].includes(normalized);
}

function isUsageCountKey(key: string) {
  return /(?:input|output|completion|billable|cachedinput|cached|total)tokens$/u.test(key)
    || /^(?:physical)?requests?(?:count)?$/u.test(key);
}

function inferTextEvidenceRecordedAt(path: string, text: string): number | null {
  const timestamps: number[] = [];
  const isoPattern = /\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})\b/gu;
  for (const match of `${path}\n${text}`.matchAll(isoPattern)) {
    const parsed = Date.parse(match[0]);
    if (Number.isFinite(parsed)) timestamps.push(parsed);
  }
  const compactPattern = /\b(20\d{2})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\d*Z\b/gu;
  for (const match of `${path}\n${text}`.matchAll(compactPattern)) {
    const parsed = Date.UTC(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]),
      Number(match[4]), Number(match[5]), Number(match[6]),
    );
    if (Number.isFinite(parsed)) timestamps.push(parsed);
  }
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function summarizeProviderReachability(value: unknown): { explicitNo: boolean; explicitYes: boolean } {
  if (Array.isArray(value)) {
    return value.reduce((summary, item) => mergeReachability(
      summary,
      summarizeProviderReachability(item),
    ), { explicitNo: false, explicitYes: false });
  }
  if (!isRecord(value)) return { explicitNo: false, explicitYes: false };

  let explicitNo = value.providerReached === false;
  let explicitYes = value.providerReached === true;
  for (const key of ['providerCallCount', 'providerCalls', 'providerRequestCount', 'providerRequests']) {
    const count = numericCount(value[key]);
    if (count === 0) explicitNo = true;
    else if (count !== null && count > 0) explicitYes = true;
  }
  for (const key of ['providerTaskId', 'providerOperationId', 'providerRequestId']) {
    if (typeof value[key] === 'string' && value[key].trim() !== '') explicitYes = true;
  }
  return Object.values(value).reduce<{ explicitNo: boolean; explicitYes: boolean }>((summary, item) => mergeReachability(
    summary,
    summarizeProviderReachability(item),
  ), { explicitNo, explicitYes });
}

function mergeReachability(
  left: { explicitNo: boolean; explicitYes: boolean },
  right: { explicitNo: boolean; explicitYes: boolean },
) {
  return {
    explicitNo: left.explicitNo || right.explicitNo,
    explicitYes: left.explicitYes || right.explicitYes,
  };
}

function numericCount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/u.test(value.trim())) return Number(value);
  return null;
}

function containsProviderEvidence(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsProviderEvidence);
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).map(key => key.toLowerCase());
  if (keys.some(key => (
    key.includes('providertask') || key.includes('providerrequest')
      || key.includes('provideroperation') || key.includes('completiontoken')
      || key.includes('cachedinputtoken')
  ))) return true;
  return Object.values(value).some(containsProviderEvidence);
}

function looksLikeProviderAuditFile(path: string) {
  const name = basename(path).toLowerCase();
  return name.includes('provider') || name.includes('canary') || name.includes('usage-summary');
}

function mapOfficialRow(row: OfficialAuditRow) {
  return {
    kind: 'official-bill-detail',
    id: row.id,
    provider: row.provider,
    sourceDetailKey: row.source_detail_key,
    revisionId: row.revision_id,
    billPeriod: row.bill_period,
    expenseDate: dateOnly(row.expense_date),
    product: row.product,
    productName: row.product_name,
    serviceType: row.service_type,
    model: row.model,
    billLineType: row.bill_line_type,
    finality: row.is_final ? 'final' : 'provisional',
    payableAmountCny: row.payable_amount_cny,
    attributionStatus: row.attribution_status,
    attributionEvidenceId: row.attribution_evidence_id,
    evidenceBasis: row.has_immutable_revision
      ? 'immutable-revision'
      : 'projection-without-revision',
  };
}

function operationalSourceKey(provider: string, sourceRunId: string, sourceItemKey: string) {
  return `${provider}\u0000${sourceRunId}\u0000${sourceItemKey}`;
}

function compareFinding(left: EvidenceFinding, right: EvidenceFinding) {
  return left.path.localeCompare(right.path)
    || (left.sourceRunId ?? '').localeCompare(right.sourceRunId ?? '')
    || (left.sourceItemKey ?? '').localeCompare(right.sourceItemKey ?? '');
}

function parseAsOf(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw cliError('PROVIDER_BILLING_AUDIT_AS_OF_INVALID');
  return date.toISOString();
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dateOnly(value: Date | string) {
  return toIso(value).slice(0, 10);
}

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  return 'unknown-error';
}

interface AuditCliArgs {
  auditRoots: string[];
  asOf: string;
  outputPath: string | null;
}

export function parseProviderBillingAuditArgs(args: string[], now = new Date()): AuditCliArgs {
  const auditRoots: string[] = [];
  let asOf = now.toISOString();
  let outputPath: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--audit-root' && value && !value.startsWith('--')) {
      auditRoots.push(value); index += 1; continue;
    }
    if (argument === '--as-of' && value && !value.startsWith('--')) {
      asOf = parseAsOf(value); index += 1; continue;
    }
    if (argument === '--output' && value && !value.startsWith('--') && outputPath === null) {
      outputPath = value; index += 1; continue;
    }
    throw cliError('PROVIDER_BILLING_AUDIT_ARGUMENT_INVALID');
  }
  if (auditRoots.length === 0) throw cliError('PROVIDER_BILLING_AUDIT_ROOT_REQUIRED');
  return {
    auditRoots,
    asOf,
    outputPath,
  };
}

function cliError(code: string) {
  return Object.assign(new Error(code), { code });
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (isDirectExecution) {
  Promise.resolve()
    .then(() => parseProviderBillingAuditArgs(process.argv.slice(2)))
    .then(async args => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        const report = await auditProviderBillingAttribution({
          client,
          auditRoots: args.auditRoots,
          asOf: args.asOf,
        });
        await client.query('COMMIT');
        const output = `${JSON.stringify(report, null, 2)}\n`;
        if (args.outputPath) await writeFile(resolve(args.outputPath), output, { flag: 'wx' });
        else process.stdout.write(output);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    })
    .catch(error => {
      process.stderr.write(`${JSON.stringify({
        event: 'provider-billing-attribution-audit-failed',
        errorCode: error && typeof error === 'object' && 'code' in error
          ? String(error.code) : 'PROVIDER_BILLING_AUDIT_FAILED',
      })}\n`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
