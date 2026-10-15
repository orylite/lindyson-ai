import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import {
  computeProviderOperationalUsageManifestSha256,
  parseProviderOperationalUsageManifestJson,
  PROVIDER_OPERATIONAL_USAGE_MANIFEST_VERSION,
  type ProviderOperationalUsageManifest,
  type ProviderOperationalUsageRecordV1,
} from '../domain/providerOperationalUsageManifest.js';
import {
  approvalRecordKey,
  computeProviderOperationalUsageMissingEvidenceApprovalSha256,
  parseProviderOperationalUsageMissingEvidenceApprovalJson,
  PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_HISTORICAL_CUTOFF,
  type ProviderOperationalUsageMissingEvidenceApproval,
} from '../domain/providerOperationalUsageMissingEvidenceApproval.js';
import { pool } from '../db/pool.js';

const sha256Pattern = /^[0-9a-f]{64}$/;

export interface ProviderOperationalUsageImportArgs {
  manifestPath: string;
  evidenceRoot: string | null;
  adminConfirmMissingOriginalEvidencePath: string | null;
  approvedAdminConfirmMissingOriginalEvidenceSha256: string | null;
  apply: boolean;
  approvedManifestSha256: string | null;
}

export interface ProviderOperationalUsageImportOptions {
  rawManifest: Buffer | string;
  apply?: boolean;
  approvedManifestSha256?: string | null;
  /**
   * 离线审计导出根目录。manifest 中的绝对 evidencePath 会按去掉开头 `/`
   * 后的完整规范路径映射到该目录；不做 basename 搜索或任何模糊回退。
   */
  evidenceRoot?: string | null;
  rawAdminConfirmMissingOriginalEvidence?: Buffer | string | null;
  approvedAdminConfirmMissingOriginalEvidenceSha256?: string | null;
  database?: Pick<Pool, 'connect'>;
  /** 由 root-only 审核/运行环境绑定的唯一成本承担 UUID；apply 时必填。 */
  expectedCostOwnerUserId?: string | null;
}

export interface ProviderOperationalUsageImportResult {
  dryRun: boolean;
  manifestVersion: typeof PROVIDER_OPERATIONAL_USAGE_MANIFEST_VERSION;
  manifestId: string;
  manifestSha256: string;
  recordCount: number;
  pricedRecordCount: number;
  verifiedEvidenceRecordCount: number;
  adminConfirmedMissingOriginalRecordCount: number;
  adminConfirmationSha256: string | null;
  costOwnerUserIds: string[];
  insertedRecordCount: number;
  unchangedRecordCount: number;
}

type EvidenceStatus = 'verified' | 'admin-confirmed-missing-original';

interface RecordEvidenceResolution {
  evidenceStatus: EvidenceStatus;
  evidenceAttestation: Record<string, unknown> | null;
  historicalCallFingerprintSha256: string | null;
}

interface ManifestEvidenceVerification {
  recordResolutions: Map<string, RecordEvidenceResolution>;
  approval: ProviderOperationalUsageMissingEvidenceApproval | null;
  approvalSha256: string | null;
  verifiedEvidenceRecordCount: number;
  adminConfirmedMissingOriginalRecordCount: number;
}

export function parseProviderOperationalUsageImportArgs(args: string[]): ProviderOperationalUsageImportArgs {
  let manifestPath: string | null = null;
  let evidenceRoot: string | null = null;
  let adminConfirmMissingOriginalEvidencePath: string | null = null;
  let approvedAdminConfirmMissingOriginalEvidenceSha256: string | null = null;
  let apply = false;
  let approvedManifestSha256: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--manifest') {
      const value = args[index + 1];
      if (!value || value.startsWith('--') || manifestPath !== null) {
        throw importError('PROVIDER_OPERATIONAL_USAGE_ARGUMENT_INVALID');
      }
      manifestPath = value;
      index += 1;
      continue;
    }
    if (argument === '--apply') {
      if (apply) throw importError('PROVIDER_OPERATIONAL_USAGE_ARGUMENT_INVALID');
      apply = true;
      continue;
    }
    if (argument === '--evidence-root') {
      const value = args[index + 1];
      if (!value || value.startsWith('--') || evidenceRoot !== null) {
        throw importError('PROVIDER_OPERATIONAL_USAGE_ARGUMENT_INVALID');
      }
      evidenceRoot = value;
      index += 1;
      continue;
    }
    if (argument === '--admin-confirm-missing-original-evidence') {
      const value = args[index + 1];
      if (!value || value.startsWith('--') || adminConfirmMissingOriginalEvidencePath !== null) {
        throw importError('PROVIDER_OPERATIONAL_USAGE_ARGUMENT_INVALID');
      }
      adminConfirmMissingOriginalEvidencePath = value;
      index += 1;
      continue;
    }
    if (argument === '--admin-confirm-missing-original-evidence-sha256') {
      const value = args[index + 1];
      if (
        !value
        || value.startsWith('--')
        || approvedAdminConfirmMissingOriginalEvidenceSha256 !== null
        || !sha256Pattern.test(value)
      ) {
        throw importError('PROVIDER_OPERATIONAL_USAGE_ARGUMENT_INVALID');
      }
      approvedAdminConfirmMissingOriginalEvidenceSha256 = value;
      index += 1;
      continue;
    }
    if (argument === '--manifest-sha256') {
      const value = args[index + 1];
      if (!value || value.startsWith('--') || approvedManifestSha256 !== null || !sha256Pattern.test(value)) {
        throw importError('PROVIDER_OPERATIONAL_USAGE_ARGUMENT_INVALID');
      }
      approvedManifestSha256 = value;
      index += 1;
      continue;
    }
    throw importError('PROVIDER_OPERATIONAL_USAGE_ARGUMENT_INVALID');
  }

  if (!manifestPath) throw importError('PROVIDER_OPERATIONAL_USAGE_MANIFEST_REQUIRED');
  if (apply && !approvedManifestSha256) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_APPLY_REQUIRES_MANIFEST_SHA256');
  }
  if (
    (adminConfirmMissingOriginalEvidencePath === null)
    !== (approvedAdminConfirmMissingOriginalEvidenceSha256 === null)
  ) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_ARGUMENTS_INCOMPLETE');
  }
  return {
    manifestPath,
    evidenceRoot,
    adminConfirmMissingOriginalEvidencePath,
    approvedAdminConfirmMissingOriginalEvidenceSha256,
    apply,
    approvedManifestSha256,
  };
}

export async function importProviderOperationalUsage(
  options: ProviderOperationalUsageImportOptions,
): Promise<ProviderOperationalUsageImportResult> {
  const apply = options.apply === true;
  const manifestSha256 = computeProviderOperationalUsageManifestSha256(options.rawManifest);
  const approvedManifestSha256 = options.approvedManifestSha256 ?? null;
  if (approvedManifestSha256 && approvedManifestSha256 !== manifestSha256) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_MANIFEST_SHA256_MISMATCH');
  }
  if (apply && !approvedManifestSha256) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_APPLY_REQUIRES_MANIFEST_SHA256');
  }

  const manifest = parseProviderOperationalUsageManifestJson(options.rawManifest);
  const evidenceVerification = await verifyManifestEvidenceFiles(
    manifest,
    manifestSha256,
    options.evidenceRoot ?? null,
    options.rawAdminConfirmMissingOriginalEvidence ?? null,
    options.approvedAdminConfirmMissingOriginalEvidenceSha256 ?? null,
  );
  const summary = summarizeManifest(manifest, manifestSha256, !apply, evidenceVerification);
  if (!apply) return summary;

  const database = options.database ?? pool;
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `provider-operational-usage:${manifestSha256}`,
    ]);
    await lockManifestExternalIds(client, manifest);
    const expectedCostOwnerUserId = options.expectedCostOwnerUserId
      ?? process.env.PROVIDER_OPERATIONAL_USAGE_COST_OWNER_USER_ID
      ?? null;
    const adminUserId = await assertReferencedUsersExist(
      client,
      manifest,
      expectedCostOwnerUserId,
    );
    assertMissingEvidenceApprovalAdmin(evidenceVerification.approval, adminUserId);
    await assertMissingEvidenceApprovalNotAfterDatabaseClock(
      client,
      evidenceVerification.approval,
    );
    await assertNotAlreadyAccountedInLegacyLedgers(
      client,
      manifest,
      evidenceVerification.recordResolutions,
    );

    for (const record of manifest.records) {
      const evidenceResolution = evidenceVerification.recordResolutions.get(
        approvalRecordKey(record),
      );
      if (!evidenceResolution) {
        throw importError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_RESOLUTION_MISSING');
      }
      const insertion = await insertOperationalUsageRecord(
        client,
        manifest,
        manifestSha256,
        record,
        evidenceResolution,
      );
      if (!insertion.inserted) {
        await assertInitialValuationMatches(client, insertion.id, record);
        summary.unchangedRecordCount += 1;
        continue;
      }
      await insertInitialValuation(client, insertion.id, record);
      summary.insertedRecordCount += 1;
    }

    if (summary.adminConfirmedMissingOriginalRecordCount > 0) {
      await assertAdminConfirmedRecordsHaveNoOfficialAttribution(client, manifestSha256);
    }

    await appendOperationalUsageImportAudit(
      client,
      adminUserId,
      manifest,
      manifestSha256,
      summary,
    );

    await client.query('COMMIT');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function assertAdminConfirmedRecordsHaveNoOfficialAttribution(
  client: PoolClient,
  manifestSha256: string,
) {
  const result = await client.query<{ attribution_count: number }>(
    `SELECT count(*)::int AS attribution_count
     FROM provider_bill_attribution_events attribution
     JOIN provider_operational_usage_records usage
       ON usage.id = attribution.operational_usage_record_id
     WHERE usage.manifest_sha256 = $1
       AND usage.evidence_status = 'admin-confirmed-missing-original'`,
    [manifestSha256],
  );
  if (result.rows.length !== 1 || result.rows[0]?.attribution_count !== 0) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_OFFICIAL_ATTRIBUTION_FORBIDDEN');
  }
}

async function lockManifestExternalIds(
  client: PoolClient,
  manifest: ProviderOperationalUsageManifest,
) {
  const lockKeys = manifest.records.flatMap(record => [
    record.providerTaskId,
    record.providerOperationId,
    record.providerRequestId,
  ].flatMap(externalId => externalId === null
    ? []
    : [`provider-operational-external-id:${record.provider.length}:${record.provider}:${externalId}`]));
  for (const lockKey of [...new Set(lockKeys)].sort()) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
  }
}

async function verifyManifestEvidenceFiles(
  manifest: ProviderOperationalUsageManifest,
  manifestSha256: string,
  evidenceRoot: string | null,
  rawMissingEvidenceApproval: Buffer | string | null,
  approvedMissingEvidenceApprovalSha256: string | null,
): Promise<ManifestEvidenceVerification> {
  const approval = parseAndBindMissingEvidenceApproval(
    rawMissingEvidenceApproval,
    approvedMissingEvidenceApprovalSha256,
    manifestSha256,
  );
  const normalizedEvidenceRoot = evidenceRoot === null
    ? null
    : await resolveExistingEvidenceRoot(evidenceRoot);
  const evidenceFiles = new Map<string, string>();

  for (const record of manifest.records) {
    const declaredPath = record.evidencePath;
    if (!isAbsolute(declaredPath) || normalize(declaredPath) !== declaredPath) {
      throw importError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_PATH_NOT_CANONICAL_ABSOLUTE');
    }
    const previousSha256 = evidenceFiles.get(declaredPath);
    if (previousSha256 && previousSha256 !== record.evidenceSha256) {
      throw importError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_PATH_CONFLICT');
    }
    evidenceFiles.set(declaredPath, record.evidenceSha256);
  }

  const unavailablePaths = new Set<string>();
  const verifiedPaths = new Set<string>();
  for (const [declaredPath, expectedSha256] of evidenceFiles) {
    let evidencePath: string;
    try {
      evidencePath = normalizedEvidenceRoot === null
        ? declaredPath
        : await resolveMappedEvidencePath(normalizedEvidenceRoot, declaredPath);
    } catch (error) {
      if (safeErrorCode(error) !== 'PROVIDER_OPERATIONAL_USAGE_EVIDENCE_FILE_UNREADABLE') {
        throw error;
      }
      unavailablePaths.add(declaredPath);
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(evidencePath);
    } catch {
      unavailablePaths.add(declaredPath);
      continue;
    }
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== expectedSha256) {
      throw importError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_FILE_HASH_MISMATCH');
    }
    verifiedPaths.add(declaredPath);
  }

  const missingRecords = manifest.records.filter(record => unavailablePaths.has(record.evidencePath));
  if (missingRecords.length === 0 && approval) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_NOT_REQUIRED');
  }
  if (missingRecords.length > 0 && !approval) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_FILE_UNREADABLE');
  }
  if (approval) {
    assertMissingEvidenceApprovalCoversExactly(approval, manifest, missingRecords);
  }

  const recordResolutions = new Map<string, RecordEvidenceResolution>();
  for (const record of manifest.records) {
    const key = approvalRecordKey(record);
    if (verifiedPaths.has(record.evidencePath)) {
      recordResolutions.set(key, {
        evidenceStatus: 'verified',
        evidenceAttestation: null,
        historicalCallFingerprintSha256: null,
      });
      continue;
    }
    if (!approval || !approvedMissingEvidenceApprovalSha256) {
      throw importError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_RESOLUTION_MISSING');
    }
    const callFingerprintSha256 = missingEvidenceCallFingerprintSha256(record);
    recordResolutions.set(key, {
      evidenceStatus: 'admin-confirmed-missing-original',
      evidenceAttestation: missingEvidenceAttestation(
        approval,
        approvedMissingEvidenceApprovalSha256,
        manifest,
        callFingerprintSha256,
      ),
      historicalCallFingerprintSha256: callFingerprintSha256,
    });
  }

  return {
    recordResolutions,
    approval,
    approvalSha256: approval ? approvedMissingEvidenceApprovalSha256 : null,
    verifiedEvidenceRecordCount: manifest.records.length - missingRecords.length,
    adminConfirmedMissingOriginalRecordCount: missingRecords.length,
  };
}

function parseAndBindMissingEvidenceApproval(
  rawApproval: Buffer | string | null,
  approvedApprovalSha256: string | null,
  manifestSha256: string,
) {
  if ((rawApproval === null) !== (approvedApprovalSha256 === null)) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_ARGUMENTS_INCOMPLETE');
  }
  if (rawApproval === null || approvedApprovalSha256 === null) return null;
  const actualApprovalSha256 = computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawApproval);
  if (actualApprovalSha256 !== approvedApprovalSha256) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_SHA256_MISMATCH');
  }
  const approval = parseProviderOperationalUsageMissingEvidenceApprovalJson(rawApproval);
  if (approval.manifestSha256 !== manifestSha256) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_MANIFEST_MISMATCH');
  }
  return approval;
}

function assertMissingEvidenceApprovalCoversExactly(
  approval: ProviderOperationalUsageMissingEvidenceApproval,
  manifest: ProviderOperationalUsageManifest,
  missingRecords: ProviderOperationalUsageRecordV1[],
) {
  const approvalRecords = new Map(approval.records.map(record => [approvalRecordKey(record), record]));
  const missingRecordKeys = new Set(missingRecords.map(approvalRecordKey));
  if (approvalRecords.size !== missingRecordKeys.size) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_COVERAGE_MISMATCH');
  }
  for (const record of missingRecords) {
    const approvedRecord = approvalRecords.get(approvalRecordKey(record));
    if (
      !approvedRecord
      || approvedRecord.evidencePath !== record.evidencePath
      || approvedRecord.evidenceSha256 !== record.evidenceSha256
    ) {
      throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_COVERAGE_MISMATCH');
    }
    if ([
      record.providerTaskId,
      record.providerOperationId,
      record.providerRequestId,
    ].some(value => value !== null)) {
      throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_PROVIDER_IDS_FORBIDDEN');
    }
    if (record.costOwnerUserId !== approval.approvedByUserId) {
      throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVER_OWNER_MISMATCH');
    }
  }
  for (const key of approvalRecords.keys()) {
    if (!missingRecordKeys.has(key)) {
      throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_COVERAGE_MISMATCH');
    }
  }
  const fingerprints = missingRecords.map(missingEvidenceCallFingerprintSha256);
  if (new Set(fingerprints).size !== fingerprints.length) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_FINGERPRINT_DUPLICATE');
  }
  const approvalTime = Date.parse(approval.approvedAt);
  const historicalCutoff = Date.parse(
    PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_HISTORICAL_CUTOFF,
  );
  if (
    approvalTime < Date.parse(manifest.generatedAt)
    || missingRecords.some(record => approvalTime < Date.parse(record.occurredAt))
  ) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_TIME_INVALID');
  }
  if (
    approvalTime > historicalCutoff
    || Date.parse(manifest.generatedAt) > historicalCutoff
    || missingRecords.some(record => Date.parse(record.occurredAt) > historicalCutoff)
  ) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_NOT_HISTORICAL');
  }
}

function missingEvidenceAttestation(
  approval: ProviderOperationalUsageMissingEvidenceApproval,
  approvalSha256: string,
  manifest: ProviderOperationalUsageManifest,
  callFingerprintSha256: string,
) {
  return {
    approvalVersion: approval.approvalVersion,
    approvalId: approval.approvalId,
    approvalSha256,
    manifestSha256: approval.manifestSha256,
    manifestGeneratedAt: manifest.generatedAt,
    callFingerprintSha256,
    approvedByUserId: approval.approvedByUserId,
    approvedAt: approval.approvedAt,
    reason: approval.reason,
    decision: approval.decision,
  };
}

function missingEvidenceCallFingerprintSha256(record: ProviderOperationalUsageRecordV1) {
  // 这个键表达的是“供应商调用事实”，不是证据文件或当时的计价快照。
  // evidencePath/SHA、manifest 来源键和 valuation 都可能在补档、搬迁或改价时变化；
  // 把它们放进指纹会让同一次真实调用仅换包装后被重复计费。
  const stableFact = {
    provider: record.provider,
    serviceType: record.serviceType,
    model: record.model,
    operation: record.operation,
    occurredAt: record.occurredAt,
    usageFacts: withoutEvidenceProvenance(record.usageEvidence),
  };
  return createHash('sha256')
    .update(JSON.stringify(canonicalJson(stableFact)))
    .digest('hex');
}

function withoutEvidenceProvenance(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEvidenceProvenance);
  if (!value || typeof value !== 'object') return value;
  const provenanceKeys = new Set([
    'evidencekind',
    'evidencepath',
    'evidencesha256',
    'sourceauditsha256',
    'occurredatbasis',
  ]);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !provenanceKeys.has(key.toLowerCase()))
    .map(([key, nested]) => [key, withoutEvidenceProvenance(nested)]));
}

function assertMissingEvidenceApprovalAdmin(
  approval: ProviderOperationalUsageMissingEvidenceApproval | null,
  adminUserId: string,
) {
  if (approval && approval.approvedByUserId !== adminUserId) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVER_MUST_BE_LINDYSON_ADMIN');
  }
}

async function assertMissingEvidenceApprovalNotAfterDatabaseClock(
  client: PoolClient,
  approval: ProviderOperationalUsageMissingEvidenceApproval | null,
) {
  if (!approval) return;
  const result = await client.query<{ database_now: Date | string }>(
    'SELECT clock_timestamp() AS database_now',
  );
  const databaseNow = result.rows.length === 1
    ? Date.parse(String(result.rows[0]?.database_now))
    : Number.NaN;
  if (!Number.isFinite(databaseNow) || Date.parse(approval.approvedAt) > databaseNow) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_FROM_FUTURE');
  }
}

async function resolveExistingEvidenceRoot(evidenceRoot: string) {
  const lexicalRoot = resolve(evidenceRoot);
  try {
    return await realpath(lexicalRoot);
  } catch {
    throw importError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_ROOT_UNREADABLE');
  }
}

async function resolveMappedEvidencePath(evidenceRoot: string, declaredPath: string) {
  const relativeDeclaredPath = relative('/', declaredPath);
  if (
    relativeDeclaredPath === ''
    || relativeDeclaredPath === '..'
    || relativeDeclaredPath.startsWith(`..${sep}`)
    || isAbsolute(relativeDeclaredPath)
  ) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_PATH_MAPPING_INVALID');
  }
  const lexicalTarget = resolve(evidenceRoot, relativeDeclaredPath);
  if (!isWithinDirectory(evidenceRoot, lexicalTarget)) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_PATH_MAPPING_INVALID');
  }
  let physicalTarget: string;
  try {
    physicalTarget = await realpath(lexicalTarget);
  } catch {
    throw importError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_FILE_UNREADABLE');
  }
  if (!isWithinDirectory(evidenceRoot, physicalTarget)) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_PATH_ESCAPES_ROOT');
  }
  return physicalTarget;
}

function isWithinDirectory(root: string, target: string) {
  const pathFromRoot = relative(root, target);
  return pathFromRoot !== '..'
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot);
}

async function assertNotAlreadyAccountedInLegacyLedgers(
  client: PoolClient,
  manifest: ProviderOperationalUsageManifest,
  recordResolutions: Map<string, RecordEvidenceResolution>,
) {
  const externalIds = manifest.records.flatMap(record => [
    record.providerTaskId,
    record.providerOperationId,
    record.providerRequestId,
  ].flatMap(externalId => externalId === null
    ? []
    : [{ provider: record.provider, external_id: externalId }]));
  const result = await client.query<{ already_accounted: boolean }>(
    `WITH external_ids AS (
       SELECT DISTINCT provider, external_id
       FROM jsonb_to_recordset($1::jsonb) AS item(provider text, external_id text)
     )
     SELECT (
       EXISTS (
         SELECT 1 FROM provider_usage_records legacy
         JOIN external_ids ids
           ON ids.provider = legacy.provider AND ids.external_id = legacy.provider_task_id
       )
       OR EXISTS (
         SELECT 1 FROM generation_provider_runs legacy
         JOIN external_ids ids
           ON ids.provider = legacy.provider
          AND ids.external_id IN (legacy.provider_task_id, legacy.provider_request_id)
       )
       OR EXISTS (
         SELECT 1 FROM image_provider_usage_records legacy
         JOIN external_ids ids
           ON ids.provider = legacy.provider
          AND ids.external_id IN (legacy.provider_operation_id, legacy.provider_request_id)
       )
       OR EXISTS (
         SELECT 1 FROM prompt_wizard_provider_requests legacy
         JOIN external_ids ids
           ON ids.provider = legacy.provider
          AND ids.external_id IN (
            legacy.provider_request_id,
            legacy.provider_response_id,
            legacy.x_tt_log_id
          )
       )
     ) AS already_accounted`,
    [JSON.stringify(externalIds)],
  );
  if (result.rows[0]?.already_accounted) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_ALREADY_ACCOUNTED');
  }

  // 缺少 Provider ID 的历史视频只能做保守候选排重：相同 Provider/模型、
  // 五分钟内发生，且 token 或六位小数成本一致，就必须人工核验后再导入。
  // 这里绝不自动关联 legacy 行；SERIALIZABLE 的谓词读也覆盖并发写入。
  const missingVideoCandidates = manifest.records.flatMap(record => {
    const resolution = recordResolutions.get(approvalRecordKey(record));
    if (resolution?.evidenceStatus !== 'admin-confirmed-missing-original'
      || record.serviceType !== 'video') return [];
    const usage = record.usageEvidence;
    const tokenValue = usage.billableTokens ?? usage.completionTokens ?? usage.totalTokens ?? null;
    const billableTokens = typeof tokenValue === 'number' && Number.isSafeInteger(tokenValue)
      && tokenValue >= 0
      ? String(tokenValue)
      : null;
    return [{
      provider: record.provider,
      model: record.model,
      occurred_at: record.occurredAt,
      billable_tokens: billableTokens,
      estimated_cost_cny: record.valuation.estimatedCostCny,
    }];
  });
  if (missingVideoCandidates.length === 0) return;

  const fuzzyResult = await client.query<{ fuzzy_candidate: boolean }>(
    `WITH candidates AS (
       SELECT provider, model, occurred_at, billable_tokens, estimated_cost_cny
       FROM jsonb_to_recordset($1::jsonb) AS item(
         provider text,
         model text,
         occurred_at timestamptz,
         billable_tokens numeric,
         estimated_cost_cny numeric
       )
     )
     SELECT EXISTS (
       SELECT 1
       FROM candidates candidate
       JOIN provider_usage_records legacy
         ON legacy.provider = candidate.provider
        AND legacy.model = candidate.model
       WHERE abs(extract(epoch FROM (
         coalesce(
           legacy.provider_terminal_at,
           legacy.usage_observed_at,
           legacy.completed_at,
           legacy.created_at
         ) - candidate.occurred_at
       ))) <= 300
         AND (
           (candidate.billable_tokens IS NOT NULL
             AND legacy.billable_tokens = candidate.billable_tokens)
           OR
           (candidate.estimated_cost_cny IS NOT NULL
             AND legacy.estimated_cost IS NOT NULL
             AND abs(legacy.estimated_cost - candidate.estimated_cost_cny) <= 0.000001)
         )
     ) AS fuzzy_candidate`,
    [JSON.stringify(missingVideoCandidates)],
  );
  if (fuzzyResult.rows[0]?.fuzzy_candidate) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_LEGACY_FUZZY_CANDIDATE_REQUIRES_REVIEW');
  }
}

async function assertReferencedUsersExist(
  client: PoolClient,
  manifest: ProviderOperationalUsageManifest,
  expectedCostOwnerUserId: string | null,
) {
  if (!expectedCostOwnerUserId
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(expectedCostOwnerUserId)) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_COST_OWNER_BINDING_REQUIRED');
  }
  const ownerIds = [...new Set(manifest.records.map(record => record.costOwnerUserId))];
  if (ownerIds.length !== 1 || ownerIds[0] !== expectedCostOwnerUserId) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_COST_OWNER_BINDING_MISMATCH');
  }
  const adminId = ownerIds[0]!;

  const expectedUserIds = new Set<string>();
  manifest.records.forEach(record => {
    expectedUserIds.add(record.costOwnerUserId);
    if (record.initiatedByUserId) expectedUserIds.add(record.initiatedByUserId);
  });
  const ids = [...expectedUserIds].sort();
  const result = await client.query<{ id: string; role: string; status: string }>(
    'SELECT id::text AS id, role, status FROM users WHERE id = ANY($1::uuid[])',
    [ids],
  );
  const found = new Set(result.rows.map(row => row.id));
  const missing = ids.filter(id => !found.has(id));
  if (missing.length > 0) throw importError('PROVIDER_OPERATIONAL_USAGE_USER_NOT_FOUND');
  const activeAdminIds = new Set(result.rows
    .filter(row => row.role === 'admin' && row.status === 'active')
    .map(row => row.id));
  if (!activeAdminIds.has(adminId)) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_COST_OWNER_MUST_BE_ACTIVE_ADMIN');
  }
  const invalidAdminInitiator = manifest.records.some(record => (
    record.initiatorType === 'admin-user'
    && (!record.initiatedByUserId || !activeAdminIds.has(record.initiatedByUserId))
  ));
  if (invalidAdminInitiator) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_INITIATOR_MUST_BE_ACTIVE_ADMIN');
  }
  return adminId;
}

async function appendOperationalUsageImportAudit(
  client: PoolClient,
  adminUserId: string,
  manifest: ProviderOperationalUsageManifest,
  manifestSha256: string,
  summary: ProviderOperationalUsageImportResult,
) {
  const detail = JSON.stringify({
    version: 'provider-operational-usage-import/v2',
    manifestId: manifest.manifestId,
    manifestSha256,
    recordCount: summary.recordCount,
    pricedRecordCount: summary.pricedRecordCount,
    verifiedEvidenceRecordCount: summary.verifiedEvidenceRecordCount,
    adminConfirmedMissingOriginalRecordCount: summary.adminConfirmedMissingOriginalRecordCount,
    adminConfirmationSha256: summary.adminConfirmationSha256,
    adminConfirmationDecision: summary.adminConfirmationSha256
      ? {
          countAsAdminOperationalCost: true,
          allowProviderExternalIdClaims: false,
          allowOfficialBillAttribution: false,
        }
      : null,
    costOwnerUserId: adminUserId,
    appendOnlyTables: [
      'provider_operational_usage_records',
      'provider_operational_usage_valuations',
    ],
    businessObjectsCreated: {
      generationTask: false,
      asset: false,
      creditLedgerEntry: false,
      providerRun: false,
      officialBillAttribution: false,
    },
  });
  const target = `manifest-sha256:${manifestSha256}`;
  const existing = await client.query<{
    admin_user_id: string | null;
    admin_email: string;
    risk: string;
    detail: string;
  }>(
    `SELECT admin_user_id::text, admin_email::text, risk, detail
     FROM audit_logs
     WHERE module = 'API成本与用量'
       AND action = '导入供应商运营调用证据'
       AND target = $1
     ORDER BY id
     FOR KEY SHARE`,
    [target],
  );
  if (existing.rows.length > 1) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_AUDIT_CONFLICT');
  }
  const existingAudit = existing.rows[0];
  if (existingAudit) {
    if (
      existingAudit.admin_user_id !== adminUserId
      || existingAudit.risk !== 'high'
      || existingAudit.detail !== detail
    ) {
      throw importError('PROVIDER_OPERATIONAL_USAGE_AUDIT_CONFLICT');
    }
    return;
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO audit_logs (
       admin_user_id, admin_email, module, action, target, risk, detail
     )
     SELECT id, email, 'API成本与用量', '导入供应商运营调用证据', $2, 'high', $3
     FROM users
     WHERE id = $1::uuid
       AND role = 'admin'
       AND status = 'active'
     RETURNING id`,
    [adminUserId, target, detail],
  );
  if (inserted.rows.length !== 1) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_AUDIT_CONFLICT');
  }
}

async function insertOperationalUsageRecord(
  client: PoolClient,
  manifest: ProviderOperationalUsageManifest,
  manifestSha256: string,
  record: ProviderOperationalUsageRecordV1,
  evidenceResolution: RecordEvidenceResolution,
) {
  const values = operationalUsageRecordValues(
    manifest,
    manifestSha256,
    record,
    evidenceResolution,
  );
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO provider_operational_usage_records (
       manifest_version, manifest_id, manifest_sha256,
       provider, service_type, model, operation,
       cost_owner_user_id, purpose, initiator_type, initiated_by_user_id,
       source_run_id, source_item_key,
       provider_task_id, provider_operation_id, provider_request_id,
       status, provider_reached, occurred_at, local_accounting_date,
       usage_evidence, evidence_path, evidence_sha256,
       evidence_status, evidence_attestation, historical_call_fingerprint_sha256
     ) VALUES (
       $1, $2, $3,
       $4, $5, $6, $7,
       $8, $9, $10, $11,
       $12, $13,
       $14, $15, $16,
       $17, $18, $19, $20,
       $21::jsonb, $22, $23,
       $24, $25::jsonb, $26
     )
     ON CONFLICT (provider, source_run_id, source_item_key) DO NOTHING
     RETURNING id`,
    values,
  );
  const insertedId = inserted.rows[0]?.id;
  if (insertedId) return { id: insertedId, inserted: true } as const;

  const existing = await client.query<{ id: string }>(
    `SELECT id
     FROM provider_operational_usage_records
     WHERE manifest_version = $1
       AND manifest_id = $2
       AND manifest_sha256 = $3
       AND provider = $4
       AND service_type = $5
       AND model = $6
       AND operation = $7
       AND cost_owner_user_id = $8::uuid
       AND purpose = $9
       AND initiator_type = $10
       AND initiated_by_user_id IS NOT DISTINCT FROM $11::uuid
       AND source_run_id = $12
       AND source_item_key = $13
       AND provider_task_id IS NOT DISTINCT FROM $14::text
       AND provider_operation_id IS NOT DISTINCT FROM $15::text
       AND provider_request_id IS NOT DISTINCT FROM $16::text
       AND status = $17
       AND provider_reached = $18
       AND occurred_at = $19::timestamptz
       AND local_accounting_date = $20::date
       AND usage_evidence = $21::jsonb
       AND evidence_path = $22
       AND evidence_sha256 = $23
       AND evidence_status = $24
       AND evidence_attestation IS NOT DISTINCT FROM $25::jsonb
       AND historical_call_fingerprint_sha256 IS NOT DISTINCT FROM $26::text
     FOR KEY SHARE`,
    values,
  );
  const row = existing.rows[0];
  if (!row) {
    throw importError('PROVIDER_OPERATIONAL_USAGE_SOURCE_CONFLICT');
  }
  return { id: row.id, inserted: false } as const;
}

function operationalUsageRecordValues(
  manifest: ProviderOperationalUsageManifest,
  manifestSha256: string,
  record: ProviderOperationalUsageRecordV1,
  evidenceResolution: RecordEvidenceResolution,
) {
  return [
    manifest.manifestVersion,
    manifest.manifestId,
    manifestSha256,
    record.provider,
    record.serviceType,
    record.model,
    record.operation,
    record.costOwnerUserId,
    record.purpose,
    record.initiatorType,
    record.initiatedByUserId,
    record.sourceRunId,
    record.sourceItemKey,
    record.providerTaskId,
    record.providerOperationId,
    record.providerRequestId,
    record.status,
    record.providerReached,
    record.occurredAt,
    record.localAccountingDate,
    JSON.stringify(record.usageEvidence),
    record.evidencePath,
    record.evidenceSha256,
    evidenceResolution.evidenceStatus,
    evidenceResolution.evidenceAttestation === null
      ? null
      : JSON.stringify(evidenceResolution.evidenceAttestation),
    evidenceResolution.historicalCallFingerprintSha256,
  ];
}

async function assertInitialValuationMatches(
  client: PoolClient,
  operationalUsageRecordId: string,
  record: ProviderOperationalUsageRecordV1,
) {
  const valuation = record.valuation;
  const result = await client.query<{ id: string }>(
    `SELECT id
     FROM provider_operational_usage_valuations
     WHERE operational_usage_record_id = $1
       AND supersedes_valuation_id IS NULL
       AND pricing_status = $2
       AND price_version IS NOT DISTINCT FROM $3::text
       AND pricing_source_url IS NOT DISTINCT FROM $4::text
       AND unit_price_snapshot IS NOT DISTINCT FROM $5::jsonb
       AND estimated_cost_cny IS NOT DISTINCT FROM $6::numeric
       AND currency = $7
       AND evidence_sha256 = $8`,
    [
      operationalUsageRecordId,
      valuation.pricingStatus,
      valuation.priceVersion,
      valuation.pricingSourceUrl,
      valuation.unitPriceSnapshot === null ? null : JSON.stringify(valuation.unitPriceSnapshot),
      valuation.estimatedCostCny,
      valuation.currency,
      valuation.evidenceSha256,
    ],
  );
  if (!result.rows[0]) throw importError('PROVIDER_OPERATIONAL_USAGE_VALUATION_CONFLICT');
}

async function insertInitialValuation(
  client: PoolClient,
  operationalUsageRecordId: string,
  record: ProviderOperationalUsageRecordV1,
) {
  const valuation = record.valuation;
  await client.query(
    `INSERT INTO provider_operational_usage_valuations (
       operational_usage_record_id, pricing_status, price_version,
       pricing_source_url, unit_price_snapshot, estimated_cost_cny,
       currency, evidence_sha256
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::numeric, $7, $8)`,
    [
      operationalUsageRecordId,
      valuation.pricingStatus,
      valuation.priceVersion,
      valuation.pricingSourceUrl,
      valuation.unitPriceSnapshot === null ? null : JSON.stringify(valuation.unitPriceSnapshot),
      valuation.estimatedCostCny,
      valuation.currency,
      valuation.evidenceSha256,
    ],
  );
}

function summarizeManifest(
  manifest: ProviderOperationalUsageManifest,
  manifestSha256: string,
  dryRun: boolean,
  evidenceVerification: ManifestEvidenceVerification,
): ProviderOperationalUsageImportResult {
  return {
    dryRun,
    manifestVersion: manifest.manifestVersion,
    manifestId: manifest.manifestId,
    manifestSha256,
    recordCount: manifest.records.length,
    pricedRecordCount: manifest.records.filter(record => record.valuation.pricingStatus === 'priced').length,
    verifiedEvidenceRecordCount: evidenceVerification.verifiedEvidenceRecordCount,
    adminConfirmedMissingOriginalRecordCount:
      evidenceVerification.adminConfirmedMissingOriginalRecordCount,
    adminConfirmationSha256: evidenceVerification.approvalSha256,
    costOwnerUserIds: [...new Set(manifest.records.map(record => record.costOwnerUserId))].sort(),
    insertedRecordCount: 0,
    unchangedRecordCount: 0,
  };
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]),
  );
}

function importError(code: string) {
  return Object.assign(new Error(code), { code });
}

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'PROVIDER_OPERATIONAL_USAGE_IMPORT_FAILED';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.length <= 128
    ? code
    : 'PROVIDER_OPERATIONAL_USAGE_IMPORT_FAILED';
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (isDirectExecution) {
  let args: ProviderOperationalUsageImportArgs | null = null;
  try {
    args = parseProviderOperationalUsageImportArgs(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({
      event: 'provider-operational-usage-import-arguments-invalid',
      errorCode: safeErrorCode(error),
    }));
    process.exitCode = 1;
  }

  if (args) {
    Promise.all([
      readFile(resolve(args.manifestPath)),
      args.adminConfirmMissingOriginalEvidencePath
        ? readFile(resolve(args.adminConfirmMissingOriginalEvidencePath))
        : Promise.resolve(null),
    ])
      .then(([rawManifest, rawAdminConfirmMissingOriginalEvidence]) => importProviderOperationalUsage({
        rawManifest,
        evidenceRoot: args!.evidenceRoot,
        rawAdminConfirmMissingOriginalEvidence,
        approvedAdminConfirmMissingOriginalEvidenceSha256:
          args!.approvedAdminConfirmMissingOriginalEvidenceSha256,
        apply: args!.apply,
        approvedManifestSha256: args!.approvedManifestSha256,
      }))
      .then(result => {
        console.log(JSON.stringify({
          event: result.dryRun
            ? 'provider-operational-usage-import-dry-run'
            : 'provider-operational-usage-import-applied',
          ...result,
        }));
      })
      .catch(error => {
        console.error(JSON.stringify({
          event: 'provider-operational-usage-import-aborted',
          errorCode: safeErrorCode(error),
        }));
        process.exitCode = 1;
      })
      .finally(() => pool.end());
  } else {
    void pool.end();
  }
}
