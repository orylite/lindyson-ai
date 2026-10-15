import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
  end: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: {
    connect: mocks.connect,
    end: mocks.end,
  },
}));

import {
  computeProviderOperationalUsageManifestSha256,
  parseProviderOperationalUsageManifest,
  parseProviderOperationalUsageManifestJson,
  PROVIDER_OPERATIONAL_USAGE_MANIFEST_VERSION,
  type ProviderOperationalUsageManifest,
} from '../src/domain/providerOperationalUsageManifest.js';
import {
  computeProviderOperationalUsageMissingEvidenceApprovalSha256,
  parseProviderOperationalUsageMissingEvidenceApprovalJson,
  PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_VERSION,
  type ProviderOperationalUsageMissingEvidenceApproval,
} from '../src/domain/providerOperationalUsageMissingEvidenceApproval.js';
import {
  importProviderOperationalUsage,
  parseProviderOperationalUsageImportArgs,
} from '../src/tools/importProviderOperationalUsage.js';

const ownerUserId = '00000000-0000-4000-8000-000000000001';
const initiatorUserId = '00000000-0000-4000-8000-000000000002';
const insertedRecordId = '00000000-0000-4000-8000-000000000003';
const testEvidenceBytes = Buffer.from('{"kind":"provider-operational-usage-test/v1"}\n');
const evidenceSha256 = createHash('sha256').update(testEvidenceBytes).digest('hex');
let testDirectory = '';
let evidencePath = '/tmp/provider-operational-usage-test-not-initialized';

beforeAll(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), 'provider-operational-usage-import-'));
  evidencePath = join(testDirectory, 'evidence.json');
  await writeFile(evidencePath, testEvidenceBytes, { flag: 'wx' });
});

afterAll(async () => {
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
});

describe('供应商运营调用 manifest', () => {
  it('冻结六条 Seedance 2.5 影子调用，精确合计 939123 Token / ¥63.037310', async () => {
    const rawManifest = await readFile(new URL(
      '../fixtures/provider-operational-usage/seedance-25-shadow-20260811.json',
      import.meta.url,
    ));
    const manifest = parseProviderOperationalUsageManifestJson(rawManifest);

    expect(computeProviderOperationalUsageManifestSha256(rawManifest))
      .toBe('c15207c28dc03c346468e188c27404dd10001bd78fe920d3b5aaa5434238833a');
    expect(manifest.records).toHaveLength(6);
    expect(manifest.records.filter(record => record.sourceRunId.endsWith('T212900Z'))).toHaveLength(1);
    expect(manifest.records.filter(record => record.sourceRunId.endsWith('T213300Z'))).toHaveLength(5);
    expect(manifest.records.every(record => record.providerTaskId === null)).toBe(true);
    expect(manifest.records.every(record => (
      /^[0-9a-f]{16}$/.test(String(record.usageEvidence.providerTaskIdSha256Prefix ?? ''))
    ))).toBe(true);
    expect(manifest.records.every(record => (
      record.evidencePath === `/root/lindyson-api/releases/${record.sourceRunId}/canary.ndjson`
    ))).toBe(true);
    expect(manifest.records.reduce(
      (sum, record) => sum + Number(record.usageEvidence.billableTokens),
      0,
    )).toBe(939_123);
    expect(manifest.records.reduce(
      (sum, record) => sum + cnyMicros(record.valuation.estimatedCostCny!),
      0n,
    )).toBe(63_037_310n);
    expect(rawManifest.toString()).not.toMatch(/"(?:taskId|assetId|creditLedgerId|providerRunId)"/);

    await expect(importProviderOperationalUsage({ rawManifest }))
      .rejects.toThrow(/PROVIDER_OPERATIONAL_USAGE_EVIDENCE_FILE_UNREADABLE/);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('冻结的管理员确认精确绑定六条缺原始文件调用，且不会声明 Provider 外部 ID 或官方账单归属', async () => {
    const rawManifest = await readFile(new URL(
      '../fixtures/provider-operational-usage/seedance-25-shadow-20260811.json',
      import.meta.url,
    ));
    const rawApproval = await readFile(new URL(
      '../fixtures/provider-operational-usage/seedance-25-shadow-20260811.missing-original-approval.json',
      import.meta.url,
    ));
    const approval = parseProviderOperationalUsageMissingEvidenceApprovalJson(rawApproval);
    const approvalSha256 = computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawApproval);

    expect(approvalSha256)
      .toBe('84d299fb94e2798ba52d759be8ee5b77bac00d50076dd73e0e550b9bce22c79c');
    expect(approval.manifestSha256)
      .toBe(computeProviderOperationalUsageManifestSha256(rawManifest));
    expect(approval.records).toHaveLength(6);
    expect(approval.decision).toEqual({
      countAsAdminOperationalCost: true,
      allowProviderExternalIdClaims: false,
      allowOfficialBillAttribution: false,
    });

    await expect(importProviderOperationalUsage({
      rawManifest,
      rawAdminConfirmMissingOriginalEvidence: rawApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256: approvalSha256,
    })).resolves.toMatchObject({
      dryRun: true,
      recordCount: 6,
      pricedRecordCount: 6,
      verifiedEvidenceRecordCount: 0,
      adminConfirmedMissingOriginalRecordCount: 6,
      adminConfirmationSha256: approvalSha256,
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('解析版本化 manifest，并保留明确的管理员成本归属和六位小数估值', () => {
    const manifest = parseProviderOperationalUsageManifest(validManifest());

    expect(manifest.manifestVersion).toBe(PROVIDER_OPERATIONAL_USAGE_MANIFEST_VERSION);
    expect(manifest.records[0]).toMatchObject({
      costOwnerUserId: ownerUserId,
      purpose: 'deployment-canary',
      providerReached: true,
      localAccountingDate: '2026-08-11',
      valuation: {
        pricingStatus: 'priced',
        estimatedCostCny: '2.504700',
      },
    });
  });

  it('拒绝重复来源键、错误北京时间归属和不完整的已估值证据', () => {
    const duplicate = validManifest();
    duplicate.records.push(clone(duplicate.records[0]!));
    expect(() => parseProviderOperationalUsageManifest(duplicate)).toThrow();

    const mixedOwners = validManifest();
    const secondOwnerRecord = clone(mixedOwners.records[0]!);
    secondOwnerRecord.sourceItemKey = 'scenario-2';
    secondOwnerRecord.costOwnerUserId = '00000000-0000-4000-8000-000000000099';
    mixedOwners.records.push(secondOwnerRecord);
    expect(() => parseProviderOperationalUsageManifest(mixedOwners)).toThrow(/只能归属一个成本承担用户/);

    const wrongDate = validManifest();
    wrongDate.records[0]!.localAccountingDate = '2026-08-10';
    expect(() => parseProviderOperationalUsageManifest(wrongDate)).toThrow(/2026-08-11/);

    const missingPriceVersion = validManifest();
    missingPriceVersion.records[0]!.valuation.priceVersion = null;
    expect(() => parseProviderOperationalUsageManifest(missingPriceVersion)).toThrow(/价格版本/);

    const wrongArithmetic = validManifest();
    wrongArithmetic.records[0]!.valuation.unitPriceSnapshot!.components[0]!.estimatedCostCny = '2.504701';
    expect(() => parseProviderOperationalUsageManifest(wrongArithmetic)).toThrow(/分项估值应为 2.504700/);
  });

  it('未触达供应商的 pre-provider 尝试完全不得进入运营成本 manifest', () => {
    const manifest = validManifest();
    const record = manifest.records[0]!;
    record.status = 'failed';
    record.providerReached = false;
    record.providerTaskId = null;
    record.providerRequestId = null;
    record.valuation.pricingStatus = 'unpriced';
    record.valuation.estimatedCostCny = null;
    record.valuation.priceVersion = null;
    record.valuation.pricingSourceUrl = null;
    record.valuation.unitPriceSnapshot = null;
    expect(() => parseProviderOperationalUsageManifest(manifest)).toThrow(/不得写入运营成本账本/);
  });

  it('拒绝把 SHA256 指纹冒充真实 Provider 外部 ID', () => {
    const manifest = validManifest();
    manifest.records[0]!.providerTaskId = `sha256:${'a'.repeat(16)}`;
    expect(() => parseProviderOperationalUsageManifest(manifest))
      .toThrow(/不得使用 SHA256 指纹冒充原值/);
  });

  it('同一 Provider 外部 ID 即使落在不同记录或不同 ID 槽也拒绝', () => {
    const sameRecord = validManifest();
    sameRecord.records[0]!.providerOperationId = sameRecord.records[0]!.providerTaskId;
    expect(() => parseProviderOperationalUsageManifest(sameRecord))
      .toThrow(/不得跨 task\/operation\/request 字段重复/);

    const differentRecord = validManifest();
    const second = clone(differentRecord.records[0]!);
    second.sourceItemKey = 'scenario-2';
    second.providerTaskId = null;
    second.providerOperationId = differentRecord.records[0]!.providerRequestId;
    second.providerRequestId = null;
    differentRecord.records.push(second);
    expect(() => parseProviderOperationalUsageManifest(differentRecord))
      .toThrow(/不得跨 task\/operation\/request 字段重复/);
  });

  it('按原始文件字节计算 SHA256，并拒绝非法 JSON', () => {
    const compact = JSON.stringify(validManifest());
    const formatted = JSON.stringify(validManifest(), null, 2);
    expect(computeProviderOperationalUsageManifestSha256(compact)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeProviderOperationalUsageManifestSha256(compact))
      .not.toBe(computeProviderOperationalUsageManifestSha256(formatted));
    expect(() => parseProviderOperationalUsageManifestJson('{')).toThrow(
      /PROVIDER_OPERATIONAL_USAGE_MANIFEST_JSON_INVALID/,
    );
  });
});

describe('供应商运营调用导入 CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROVIDER_OPERATIONAL_USAGE_COST_OWNER_USER_ID = ownerUserId;
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  });

  it('默认 dry-run；--apply 必须与 manifest SHA256 同时提供', () => {
    expect(parseProviderOperationalUsageImportArgs(['--manifest', './usage.json'])).toEqual({
      manifestPath: './usage.json',
      evidenceRoot: null,
      adminConfirmMissingOriginalEvidencePath: null,
      approvedAdminConfirmMissingOriginalEvidenceSha256: null,
      apply: false,
      approvedManifestSha256: null,
    });
    expect(() => parseProviderOperationalUsageImportArgs([
      '--manifest', './usage.json', '--apply',
    ])).toThrow(/APPLY_REQUIRES_MANIFEST_SHA256/);
    expect(parseProviderOperationalUsageImportArgs([
      '--apply',
      '--manifest-sha256', 'a'.repeat(64),
      '--manifest', './usage.json',
    ])).toEqual({
      manifestPath: './usage.json',
      evidenceRoot: null,
      adminConfirmMissingOriginalEvidencePath: null,
      approvedAdminConfirmMissingOriginalEvidenceSha256: null,
      apply: true,
      approvedManifestSha256: 'a'.repeat(64),
    });
    expect(parseProviderOperationalUsageImportArgs([
      '--manifest', './usage.json', '--evidence-root', '/audit-export',
    ])).toEqual({
      manifestPath: './usage.json',
      evidenceRoot: '/audit-export',
      adminConfirmMissingOriginalEvidencePath: null,
      approvedAdminConfirmMissingOriginalEvidenceSha256: null,
      apply: false,
      approvedManifestSha256: null,
    });

    expect(() => parseProviderOperationalUsageImportArgs([
      '--manifest', './usage.json',
      '--admin-confirm-missing-original-evidence', './approval.json',
    ])).toThrow(/MISSING_EVIDENCE_APPROVAL_ARGUMENTS_INCOMPLETE/);
    expect(parseProviderOperationalUsageImportArgs([
      '--manifest', './usage.json',
      '--admin-confirm-missing-original-evidence', './approval.json',
      '--admin-confirm-missing-original-evidence-sha256', 'b'.repeat(64),
    ])).toMatchObject({
      adminConfirmMissingOriginalEvidencePath: './approval.json',
      approvedAdminConfirmMissingOriginalEvidenceSha256: 'b'.repeat(64),
    });
  });

  it('dry-run 只校验和汇总，完全不连接数据库', async () => {
    const rawManifest = JSON.stringify(validManifest());
    const result = await importProviderOperationalUsage({ rawManifest });

    expect(result).toMatchObject({
      dryRun: true,
      recordCount: 1,
      pricedRecordCount: 1,
      verifiedEvidenceRecordCount: 1,
      adminConfirmedMissingOriginalRecordCount: 0,
      adminConfirmationSha256: null,
      costOwnerUserIds: [ownerUserId],
      insertedRecordCount: 0,
      unchangedRecordCount: 0,
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('dry-run 与 apply 都逐字校验证据文件，缺失或篡改时在数据库连接前失败', async () => {
    const missing = validManifest();
    missing.records[0]!.evidencePath = join(testDirectory, 'missing.json');
    await expect(importProviderOperationalUsage({ rawManifest: JSON.stringify(missing) }))
      .rejects.toThrow(/EVIDENCE_FILE_UNREADABLE/);

    const tamperedPath = join(testDirectory, 'tampered.json');
    await writeFile(tamperedPath, 'tampered\n', { flag: 'wx' });
    const tampered = validManifest();
    tampered.records[0]!.evidencePath = tamperedPath;
    await expect(importProviderOperationalUsage({ rawManifest: JSON.stringify(tampered) }))
      .rejects.toThrow(/EVIDENCE_FILE_HASH_MISMATCH/);

    const rawManifest = JSON.stringify(tampered);
    await expect(importProviderOperationalUsage({
      rawManifest,
      apply: true,
      approvedManifestSha256: computeProviderOperationalUsageManifestSha256(rawManifest),
    })).rejects.toThrow(/EVIDENCE_FILE_HASH_MISMATCH/);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('管理员确认只能降级不可读的历史文件；现存文件哈希不符永远失败', async () => {
    const tamperedPath = join(testDirectory, 'tampered-with-approval.json');
    await writeFile(tamperedPath, 'tampered despite approval\n', { flag: 'wx' });
    const manifest = missingOriginalManifest();
    manifest.records[0]!.evidencePath = tamperedPath;
    const rawManifest = JSON.stringify(manifest);
    const rawApproval = JSON.stringify(validMissingOriginalApproval(manifest, rawManifest));

    await expect(importProviderOperationalUsage({
      rawManifest,
      rawAdminConfirmMissingOriginalEvidence: rawApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256:
        computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawApproval),
    })).rejects.toThrow(/EVIDENCE_FILE_HASH_MISMATCH/);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('管理员确认必须绑定审批原文 SHA、manifest SHA 和缺文件记录的精确覆盖范围', async () => {
    const manifest = missingOriginalManifest();
    const rawManifest = JSON.stringify(manifest);
    const approval = validMissingOriginalApproval(manifest, rawManifest);
    const rawApproval = JSON.stringify(approval);

    await expect(importProviderOperationalUsage({
      rawManifest,
      rawAdminConfirmMissingOriginalEvidence: rawApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256: 'f'.repeat(64),
    })).rejects.toThrow(/MISSING_EVIDENCE_APPROVAL_SHA256_MISMATCH/);

    const wrongManifestApproval = clone(approval);
    wrongManifestApproval.manifestSha256 = 'e'.repeat(64);
    const rawWrongManifestApproval = JSON.stringify(wrongManifestApproval);
    await expect(importProviderOperationalUsage({
      rawManifest,
      rawAdminConfirmMissingOriginalEvidence: rawWrongManifestApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256:
        computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawWrongManifestApproval),
    })).rejects.toThrow(/MISSING_EVIDENCE_APPROVAL_MANIFEST_MISMATCH/);

    const wrongCoverageApproval = clone(approval);
    wrongCoverageApproval.records[0]!.evidenceSha256 = 'd'.repeat(64);
    const rawWrongCoverageApproval = JSON.stringify(wrongCoverageApproval);
    await expect(importProviderOperationalUsage({
      rawManifest,
      rawAdminConfirmMissingOriginalEvidence: rawWrongCoverageApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256:
        computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawWrongCoverageApproval),
    })).rejects.toThrow(/MISSING_EVIDENCE_APPROVAL_COVERAGE_MISMATCH/);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('缺原始文件审批不得声明 Provider 外部 ID，也不得用于证据已核验的记录', async () => {
    const withProviderId = missingOriginalManifest();
    withProviderId.records[0]!.providerTaskId = 'real-but-unverifiable-provider-id';
    const rawWithProviderId = JSON.stringify(withProviderId);
    const rawProviderIdApproval = JSON.stringify(
      validMissingOriginalApproval(withProviderId, rawWithProviderId),
    );
    await expect(importProviderOperationalUsage({
      rawManifest: rawWithProviderId,
      rawAdminConfirmMissingOriginalEvidence: rawProviderIdApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256:
        computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawProviderIdApproval),
    })).rejects.toThrow(/MISSING_EVIDENCE_PROVIDER_IDS_FORBIDDEN/);

    const verified = validManifest();
    const rawVerified = JSON.stringify(verified);
    const rawUnneededApproval = JSON.stringify(validMissingOriginalApproval(verified, rawVerified));
    await expect(importProviderOperationalUsage({
      rawManifest: rawVerified,
      rawAdminConfirmMissingOriginalEvidence: rawUnneededApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256:
        computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawUnneededApproval),
    })).rejects.toThrow(/MISSING_EVIDENCE_APPROVAL_NOT_REQUIRED/);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('缺文件审批只允许冻结截止点前的历史事实，并以稳定事实指纹拒绝仅换来源键的重复计费', async () => {
    const futureManifest = missingOriginalManifest();
    const rawFutureManifest = JSON.stringify(futureManifest);
    const futureApproval = validMissingOriginalApproval(futureManifest, rawFutureManifest);
    futureApproval.approvedAt = '2026-08-12T02:32:10.000Z';
    const rawFutureApproval = JSON.stringify(futureApproval);
    await expect(importProviderOperationalUsage({
      rawManifest: rawFutureManifest,
      rawAdminConfirmMissingOriginalEvidence: rawFutureApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256:
        computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawFutureApproval),
    })).rejects.toThrow(/MISSING_EVIDENCE_NOT_HISTORICAL/);

    const duplicateManifest = missingOriginalManifest();
    const duplicate = clone(duplicateManifest.records[0]!);
    duplicate.sourceItemKey = 'same-fact-different-source-key';
    duplicateManifest.records.push(duplicate);
    const rawDuplicateManifest = JSON.stringify(duplicateManifest);
    const rawDuplicateApproval = JSON.stringify(
      validMissingOriginalApproval(duplicateManifest, rawDuplicateManifest),
    );
    await expect(importProviderOperationalUsage({
      rawManifest: rawDuplicateManifest,
      rawAdminConfirmMissingOriginalEvidence: rawDuplicateApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256:
        computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawDuplicateApproval),
    })).rejects.toThrow(/MISSING_EVIDENCE_FINGERPRINT_DUPLICATE/);
  });

  it('缺文件调用仅换证据路径、证据哈希、来源键和价格快照仍命中同一稳定事实指纹', async () => {
    const manifest = missingOriginalManifest();
    const duplicate = clone(manifest.records[0]!);
    duplicate.sourceRunId = 'repacked-source-run';
    duplicate.sourceItemKey = 'repacked-source-item';
    duplicate.purpose = 'provider-diagnostic';
    duplicate.initiatorType = 'release-automation';
    duplicate.usageEvidence = {
      ...duplicate.usageEvidence,
      evidenceKind: 'repacked-evidence/v2',
      sourceAuditSha256: 'b'.repeat(64),
      occurredAtBasis: 'recovered-audit-timestamp',
    };
    duplicate.evidencePath = '/unavailable/repacked-evidence.ndjson';
    duplicate.evidenceSha256 = 'a'.repeat(64);
    duplicate.valuation = {
      ...duplicate.valuation,
      priceVersion: 'corrected-price-version',
      pricingSourceUrl: 'https://example.test/corrected-list-price',
      evidenceSha256: duplicate.evidenceSha256,
    };
    manifest.records.push(duplicate);
    const rawManifest = JSON.stringify(manifest);
    const rawApproval = JSON.stringify(validMissingOriginalApproval(manifest, rawManifest));

    await expect(importProviderOperationalUsage({
      rawManifest,
      rawAdminConfirmMissingOriginalEvidence: rawApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256:
        computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawApproval),
    })).rejects.toThrow(/MISSING_EVIDENCE_FINGERPRINT_DUPLICATE/);
  });

  it('同一 manifest 可混合逐字核验与管理员确认缺文件记录，审批范围只能覆盖后者', async () => {
    const manifest = validManifest();
    const missing = clone(manifest.records[0]!);
    missing.sourceItemKey = 'missing-original';
    missing.providerTaskId = null;
    missing.providerRequestId = null;
    missing.evidencePath = join(testDirectory, 'mixed-missing-original.json');
    manifest.records.push(missing);
    const rawManifest = JSON.stringify(manifest);
    const approval = validMissingOriginalApproval(manifest, rawManifest);
    approval.records = [approval.records[1]!];
    const rawApproval = JSON.stringify(approval);

    await expect(importProviderOperationalUsage({
      rawManifest,
      rawAdminConfirmMissingOriginalEvidence: rawApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256:
        computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawApproval),
    })).resolves.toMatchObject({
      verifiedEvidenceRecordCount: 1,
      adminConfirmedMissingOriginalRecordCount: 1,
    });
  });

  it('--evidence-root 只按声明绝对路径的完整相对映射读取离线导出，不做 basename 回退', async () => {
    const evidenceRoot = join(testDirectory, 'offline-export');
    const declaredPath = '/root/lindyson-api/releases/test-run/canary.ndjson';
    const mappedPath = join(evidenceRoot, 'root/lindyson-api/releases/test-run/canary.ndjson');
    await mkdir(join(evidenceRoot, 'root/lindyson-api/releases/test-run'), { recursive: true });
    await writeFile(mappedPath, testEvidenceBytes, { flag: 'wx' });
    const manifest = validManifest();
    manifest.records[0]!.evidencePath = declaredPath;

    await expect(importProviderOperationalUsage({
      rawManifest: JSON.stringify(manifest),
      evidenceRoot,
    })).resolves.toMatchObject({ dryRun: true, recordCount: 1 });

    const wrongLayoutRoot = join(testDirectory, 'wrong-layout');
    await mkdir(wrongLayoutRoot);
    await writeFile(join(wrongLayoutRoot, 'canary.ndjson'), testEvidenceBytes, { flag: 'wx' });
    await expect(importProviderOperationalUsage({
      rawManifest: JSON.stringify(manifest),
      evidenceRoot: wrongLayoutRoot,
    })).rejects.toThrow(/EVIDENCE_FILE_UNREADABLE/);

    const escapeRoot = join(testDirectory, 'escape-root');
    const escapeDirectory = join(escapeRoot, 'root/lindyson-api/releases/test-run');
    const outsideEvidence = join(testDirectory, 'outside-evidence.ndjson');
    await mkdir(escapeDirectory, { recursive: true });
    await writeFile(outsideEvidence, testEvidenceBytes, { flag: 'wx' });
    await symlink(outsideEvidence, join(escapeDirectory, 'canary.ndjson'));
    await expect(importProviderOperationalUsage({
      rawManifest: JSON.stringify(manifest),
      evidenceRoot: escapeRoot,
    })).rejects.toThrow(/EVIDENCE_PATH_ESCAPES_ROOT/);
  });

  it('拒绝相对、含折叠段或非规范的 evidencePath', async () => {
    for (const invalidPath of [
      'relative/evidence.json',
      '/audit/../evidence.json',
      '/audit//evidence.json',
    ]) {
      const manifest = validManifest();
      manifest.records[0]!.evidencePath = invalidPath;
      await expect(importProviderOperationalUsage({ rawManifest: JSON.stringify(manifest) }))
        .rejects.toThrow(/EVIDENCE_PATH_NOT_CANONICAL_ABSOLUTE/);
    }
  });

  it('批准 SHA256 不匹配时在解析和数据库连接前中止', async () => {
    await expect(importProviderOperationalUsage({
      rawManifest: JSON.stringify(validManifest()),
      apply: true,
      approvedManifestSha256: 'a'.repeat(64),
    })).rejects.toThrow(/MANIFEST_SHA256_MISMATCH/);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('apply 必须由运行环境精确绑定审核成本承担 UUID，不能只信 manifest 自报', async () => {
    const rawManifest = JSON.stringify(validManifest());
    const approvedManifestSha256 = computeProviderOperationalUsageManifestSha256(rawManifest);
    delete process.env.PROVIDER_OPERATIONAL_USAGE_COST_OWNER_USER_ID;
    mocks.query.mockResolvedValue(queryResult([]));
    await expect(importProviderOperationalUsage({
      rawManifest,
      apply: true,
      approvedManifestSha256,
    })).rejects.toThrow(/COST_OWNER_BINDING_REQUIRED/);
    expect(mocks.query.mock.calls.some(call => String(call[0]).includes(
      'INSERT INTO provider_operational_usage_records',
    ))).toBe(false);
  });

  it('apply 在串行化事务内只插入运营事实与初始估值，不生成任务或积分流水', async () => {
    const rawManifest = JSON.stringify(validManifest());
    const manifestSha256 = computeProviderOperationalUsageManifestSha256(rawManifest);
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("lower(email) = 'admin@lindyson.com'")) {
        return queryResult([{ id: ownerUserId }]);
      }
      if (sql.includes('id = ANY($1::uuid[])')) {
        return queryResult((values?.[0] as string[]).map(id => ({
          id, role: 'admin', status: 'active',
        })));
      }
      if (sql.includes('INSERT INTO provider_operational_usage_records')) {
        return queryResult([{ id: insertedRecordId }], 1);
      }
      if (sql.includes('INSERT INTO audit_logs')) return queryResult([{ id: 'audit-1' }], 1);
      return queryResult([]);
    });

    const result = await importProviderOperationalUsage({
      rawManifest,
      apply: true,
      approvedManifestSha256: manifestSha256,
    });

    expect(result).toMatchObject({
      dryRun: false,
      insertedRecordCount: 1,
      unchangedRecordCount: 0,
    });
    const sql = mocks.query.mock.calls.map(call => String(call[0])).join('\n');
    expect(sql).toContain('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    expect(sql).toContain('INSERT INTO provider_operational_usage_records');
    expect(sql).toContain('INSERT INTO provider_operational_usage_valuations');
    expect(sql).toContain('INSERT INTO audit_logs');
    expect(sql).toContain("'high'");
    expect(sql).not.toContain('generation_tasks');
    expect(sql).not.toContain('credit_ledger');
    expect(sql).not.toContain('assets');
    const auditCall = mocks.query.mock.calls.find(call => String(call[0]).includes('INSERT INTO audit_logs'));
    expect(auditCall?.[1]?.[1]).toBe(`manifest-sha256:${manifestSha256}`);
    expect(JSON.parse(String(auditCall?.[1]?.[2]))).toMatchObject({
      manifestSha256,
      businessObjectsCreated: {
        generationTask: false,
        asset: false,
        creditLedgerEntry: false,
        providerRun: false,
      },
    });
    expect(mocks.query).toHaveBeenCalledWith('COMMIT');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('管理员确认的缺文件调用可写入 Admin 列表价成本，但导入后官方账单归属事件仍为 0', async () => {
    const manifest = missingOriginalManifest();
    const rawManifest = JSON.stringify(manifest);
    const manifestSha256 = computeProviderOperationalUsageManifestSha256(rawManifest);
    const rawApproval = JSON.stringify(validMissingOriginalApproval(manifest, rawManifest));
    const approvalSha256 = computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawApproval);
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("lower(email) = 'admin@lindyson.com'")) {
        return queryResult([{ id: ownerUserId }]);
      }
      if (sql.includes('id = ANY($1::uuid[])')) {
        return queryResult((values?.[0] as string[]).map(id => ({
          id, role: 'admin', status: 'active',
        })));
      }
      if (sql.includes('INSERT INTO provider_operational_usage_records')) {
        return queryResult([{ id: insertedRecordId }], 1);
      }
      if (sql.includes('INSERT INTO audit_logs')) return queryResult([{ id: 'audit-2' }], 1);
      if (sql.includes('AS attribution_count')) {
        return queryResult([{ attribution_count: 0 }]);
      }
      if (sql.includes('SELECT clock_timestamp() AS database_now')) {
        return queryResult([{ database_now: '2026-08-12T03:00:00.000Z' }]);
      }
      return queryResult([]);
    });

    const result = await importProviderOperationalUsage({
      rawManifest,
      rawAdminConfirmMissingOriginalEvidence: rawApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256: approvalSha256,
      apply: true,
      approvedManifestSha256: manifestSha256,
    });

    expect(result).toMatchObject({
      dryRun: false,
      insertedRecordCount: 1,
      verifiedEvidenceRecordCount: 0,
      adminConfirmedMissingOriginalRecordCount: 1,
      adminConfirmationSha256: approvalSha256,
    });
    const recordInsert = mocks.query.mock.calls.find(call => String(call[0]).includes(
      'INSERT INTO provider_operational_usage_records',
    ));
    expect(recordInsert?.[1]?.[23]).toBe('admin-confirmed-missing-original');
    expect(JSON.parse(String(recordInsert?.[1]?.[24]))).toMatchObject({
      approvalSha256,
      approvedByUserId: ownerUserId,
      reason: 'historical-original-evidence-unavailable',
      decision: {
        countAsAdminOperationalCost: true,
        allowProviderExternalIdClaims: false,
        allowOfficialBillAttribution: false,
      },
    });

    const auditCall = mocks.query.mock.calls.find(call => String(call[0]).includes(
      'INSERT INTO audit_logs',
    ));
    expect(JSON.parse(String(auditCall?.[1]?.[2]))).toMatchObject({
      version: 'provider-operational-usage-import/v2',
      adminConfirmedMissingOriginalRecordCount: 1,
      adminConfirmationSha256: approvalSha256,
      adminConfirmationDecision: {
        countAsAdminOperationalCost: true,
        allowProviderExternalIdClaims: false,
        allowOfficialBillAttribution: false,
      },
      businessObjectsCreated: {
        officialBillAttribution: false,
      },
    });
    const sql = mocks.query.mock.calls.map(call => String(call[0])).join('\n');
    expect(sql).not.toContain('INSERT INTO provider_bill_attribution_events');
    expect(sql).toContain('FROM provider_bill_attribution_events attribution');
    const attributionCountCall = mocks.query.mock.calls.find(call => String(call[0]).includes(
      'AS attribution_count',
    ));
    expect(attributionCountCall?.[1]).toEqual([manifestSha256]);
    expect(mocks.query).toHaveBeenCalledWith('COMMIT');
  });

  it('若缺文件历史记录已存在任何官方账单归属，整批导入回滚且不写确认审计', async () => {
    const manifest = missingOriginalManifest();
    const rawManifest = JSON.stringify(manifest);
    const manifestSha256 = computeProviderOperationalUsageManifestSha256(rawManifest);
    const rawApproval = JSON.stringify(validMissingOriginalApproval(manifest, rawManifest));
    const approvalSha256 = computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawApproval);
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("lower(email) = 'admin@lindyson.com'")) {
        return queryResult([{ id: ownerUserId }]);
      }
      if (sql.includes('id = ANY($1::uuid[])')) {
        return queryResult((values?.[0] as string[]).map(id => ({
          id, role: 'admin', status: 'active',
        })));
      }
      if (sql.includes('INSERT INTO provider_operational_usage_records')) {
        return queryResult([{ id: insertedRecordId }], 1);
      }
      if (sql.includes('AS attribution_count')) {
        return queryResult([{ attribution_count: 1 }]);
      }
      if (sql.includes('SELECT clock_timestamp() AS database_now')) {
        return queryResult([{ database_now: '2026-08-12T03:00:00.000Z' }]);
      }
      return queryResult([]);
    });

    await expect(importProviderOperationalUsage({
      rawManifest,
      rawAdminConfirmMissingOriginalEvidence: rawApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256: approvalSha256,
      apply: true,
      approvedManifestSha256: manifestSha256,
    })).rejects.toThrow(/MISSING_EVIDENCE_OFFICIAL_ATTRIBUTION_FORBIDDEN/);
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.query.mock.calls.some(call => String(call[0]).includes('INSERT INTO audit_logs')))
      .toBe(false);
  });

  it('相同 manifest 重复 apply 时保持幂等且不追加重复估值', async () => {
    const manifest = validManifest();
    const rawManifest = JSON.stringify(manifest);
    const manifestSha256 = computeProviderOperationalUsageManifestSha256(rawManifest);
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("lower(email) = 'admin@lindyson.com'")) {
        return queryResult([{ id: ownerUserId }]);
      }
      if (sql.includes('id = ANY($1::uuid[])')) {
        return queryResult((values?.[0] as string[]).map(id => ({
          id, role: 'admin', status: 'active',
        })));
      }
      if (sql.includes('INSERT INTO provider_operational_usage_records')) return queryResult([]);
      if (sql.includes('INSERT INTO audit_logs')) return queryResult([{ id: 'audit-3' }], 1);
      if (sql.includes('FROM provider_operational_usage_records')) {
        return queryResult([{
          id: insertedRecordId,
          manifest_version: manifest.manifestVersion,
          manifest_id: manifest.manifestId,
          manifest_sha256: manifestSha256,
          evidence_status: 'verified',
          evidence_attestation: null,
        }]);
      }
      if (sql.includes('FROM provider_operational_usage_valuations')) {
        return queryResult([{ id: '00000000-0000-4000-8000-000000000004' }]);
      }
      return queryResult([]);
    });

    const result = await importProviderOperationalUsage({
      rawManifest,
      apply: true,
      approvedManifestSha256: manifestSha256,
    });

    expect(result).toMatchObject({ insertedRecordCount: 0, unchangedRecordCount: 1 });
    expect(mocks.query.mock.calls.some(call => String(call[0]).includes(
      'INSERT INTO provider_operational_usage_valuations',
    ))).toBe(false);
    expect(mocks.query).toHaveBeenCalledWith('COMMIT');
  });

  it('管理员确认缺文件 manifest 重复 apply 保持同一事实指纹与审批快照，不重复估值或归属', async () => {
    const manifest = missingOriginalManifest();
    const rawManifest = JSON.stringify(manifest);
    const manifestSha256 = computeProviderOperationalUsageManifestSha256(rawManifest);
    const rawApproval = JSON.stringify(validMissingOriginalApproval(manifest, rawManifest));
    const approvalSha256 = computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawApproval);
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("lower(email) = 'admin@lindyson.com'")) {
        return queryResult([{ id: ownerUserId }]);
      }
      if (sql.includes('id = ANY($1::uuid[])')) {
        return queryResult((values?.[0] as string[]).map(id => ({
          id, role: 'admin', status: 'active',
        })));
      }
      if (sql.includes('SELECT clock_timestamp() AS database_now')) {
        return queryResult([{ database_now: '2026-08-12T03:00:00.000Z' }]);
      }
      if (sql.includes('INSERT INTO provider_operational_usage_records')) return queryResult([]);
      if (sql.includes('INSERT INTO audit_logs')) return queryResult([{ id: 'audit-4' }], 1);
      if (sql.includes('FROM provider_operational_usage_records')) {
        expect(values?.[25]).toMatch(/^[0-9a-f]{64}$/);
        return queryResult([{ id: insertedRecordId }]);
      }
      if (sql.includes('FROM provider_operational_usage_valuations')) {
        return queryResult([{ id: '00000000-0000-4000-8000-000000000004' }]);
      }
      if (sql.includes('AS attribution_count')) {
        return queryResult([{ attribution_count: 0 }]);
      }
      return queryResult([]);
    });

    const result = await importProviderOperationalUsage({
      rawManifest,
      rawAdminConfirmMissingOriginalEvidence: rawApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256: approvalSha256,
      apply: true,
      approvedManifestSha256: manifestSha256,
    });

    expect(result).toMatchObject({ insertedRecordCount: 0, unchangedRecordCount: 1 });
    expect(mocks.query.mock.calls.some(call => String(call[0]).includes(
      'INSERT INTO provider_operational_usage_valuations',
    ))).toBe(false);
    expect(mocks.query.mock.calls.some(call => String(call[0]).includes(
      'INSERT INTO provider_bill_attribution_events',
    ))).toBe(false);
    expect(mocks.query).toHaveBeenCalledWith('COMMIT');
  });

  it('来源键已被不同 manifest 占用时整批回滚', async () => {
    const rawManifest = JSON.stringify(validManifest());
    const manifestSha256 = computeProviderOperationalUsageManifestSha256(rawManifest);
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("lower(email) = 'admin@lindyson.com'")) {
        return queryResult([{ id: ownerUserId }]);
      }
      if (sql.includes('id = ANY($1::uuid[])')) {
        return queryResult((values?.[0] as string[]).map(id => ({
          id, role: 'admin', status: 'active',
        })));
      }
      if (sql.includes('INSERT INTO provider_operational_usage_records')) return queryResult([]);
      if (sql.includes('FROM provider_operational_usage_records')) {
        return queryResult([]);
      }
      return queryResult([]);
    });

    await expect(importProviderOperationalUsage({
      rawManifest,
      apply: true,
      approvedManifestSha256: manifestSha256,
    })).rejects.toThrow(/SOURCE_CONFLICT/);
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.query).not.toHaveBeenCalledWith('COMMIT');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('同 manifest SHA 已存在异构高风险审计时 fail closed 并整批回滚', async () => {
    const rawManifest = JSON.stringify(validManifest());
    const manifestSha256 = computeProviderOperationalUsageManifestSha256(rawManifest);
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM audit_logs')) {
        return queryResult([{
          admin_user_id: ownerUserId,
          admin_email: 'admin@lindyson.com',
          risk: 'high',
          detail: '{"conflicting":true}',
        }]);
      }
      if (sql.includes("lower(email) = 'admin@lindyson.com'")) {
        return queryResult([{ id: ownerUserId }]);
      }
      if (sql.includes('id = ANY($1::uuid[])')) {
        return queryResult((values?.[0] as string[]).map(id => ({
          id, role: 'admin', status: 'active',
        })));
      }
      if (sql.includes('INSERT INTO provider_operational_usage_records')) {
        return queryResult([{ id: insertedRecordId }], 1);
      }
      return queryResult([]);
    });

    await expect(importProviderOperationalUsage({
      rawManifest,
      apply: true,
      approvedManifestSha256: manifestSha256,
    })).rejects.toThrow(/PROVIDER_OPERATIONAL_USAGE_AUDIT_CONFLICT/);
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.query).not.toHaveBeenCalledWith('COMMIT');
    expect(mocks.query.mock.calls.some(call => String(call[0]).includes('INSERT INTO audit_logs')))
      .toBe(false);
  });

  it('审核绑定的成本承担 UUID 不是 active admin 时在写账本前中止', async () => {
    const rawManifest = JSON.stringify(validManifest());
    const manifestSha256 = computeProviderOperationalUsageManifestSha256(rawManifest);
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('id = ANY($1::uuid[])')) {
        return queryResult((values?.[0] as string[]).map(id => ({
          id, role: 'user', status: 'active',
        })));
      }
      return queryResult([]);
    });

    await expect(importProviderOperationalUsage({
      rawManifest,
      apply: true,
      approvedManifestSha256: manifestSha256,
    })).rejects.toThrow(/COST_OWNER_MUST_BE_ACTIVE_ADMIN/);
    expect(mocks.query.mock.calls.some(call => String(call[0]).includes(
      'INSERT INTO provider_operational_usage_records',
    ))).toBe(false);
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('admin-user 发起者必须也是 active admin，不能只因用户存在就通过', async () => {
    const manifest = validManifest();
    manifest.records[0]!.initiatorType = 'admin-user';
    manifest.records[0]!.initiatedByUserId = initiatorUserId;
    const rawManifest = JSON.stringify(manifest);
    const manifestSha256 = computeProviderOperationalUsageManifestSha256(rawManifest);
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("lower(email) = 'admin@lindyson.com'")) {
        return queryResult([{ id: ownerUserId }]);
      }
      if (sql.includes('id = ANY($1::uuid[])')) {
        return queryResult((values?.[0] as string[]).map(id => id === initiatorUserId
          ? { id, role: 'user', status: 'active' }
          : { id, role: 'admin', status: 'active' }));
      }
      return queryResult([]);
    });

    await expect(importProviderOperationalUsage({
      rawManifest,
      apply: true,
      approvedManifestSha256: manifestSha256,
    })).rejects.toThrow(/INITIATOR_MUST_BE_ACTIVE_ADMIN/);
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.query.mock.calls.some(call => String(call[0]).includes(
      'INSERT INTO provider_operational_usage_records',
    ))).toBe(false);
  });

  it('apply 以数据库时钟拒绝尚未发生的管理员确认', async () => {
    const manifest = missingOriginalManifest();
    const rawManifest = JSON.stringify(manifest);
    const manifestSha256 = computeProviderOperationalUsageManifestSha256(rawManifest);
    const rawApproval = JSON.stringify(validMissingOriginalApproval(manifest, rawManifest));
    const approvalSha256 = computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawApproval);
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("lower(email) = 'admin@lindyson.com'")) {
        return queryResult([{ id: ownerUserId }]);
      }
      if (sql.includes('id = ANY($1::uuid[])')) {
        return queryResult((values?.[0] as string[]).map(id => ({
          id, role: 'admin', status: 'active',
        })));
      }
      if (sql.includes('SELECT clock_timestamp() AS database_now')) {
        return queryResult([{ database_now: '2026-08-12T02:32:08.999Z' }]);
      }
      return queryResult([]);
    });

    await expect(importProviderOperationalUsage({
      rawManifest,
      rawAdminConfirmMissingOriginalEvidence: rawApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256: approvalSha256,
      apply: true,
      approvedManifestSha256: manifestSha256,
    })).rejects.toThrow(/MISSING_EVIDENCE_APPROVAL_FROM_FUTURE/);
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('真实 Provider 外部 ID 已存在于 legacy 业务账本时拒绝跨表重复计费', async () => {
    const rawManifest = JSON.stringify(validManifest());
    const manifestSha256 = computeProviderOperationalUsageManifestSha256(rawManifest);
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("lower(email) = 'admin@lindyson.com'")) {
        return queryResult([{ id: ownerUserId }]);
      }
      if (sql.includes('id = ANY($1::uuid[])')) {
        return queryResult((values?.[0] as string[]).map(id => ({
          id, role: 'admin', status: 'active',
        })));
      }
      if (sql.includes('jsonb_to_recordset')) {
        expect(JSON.parse(String(values?.[0]))).toEqual([{
          provider: 'volcengine-ark',
          external_id: 'task-provider-1',
        }, {
          provider: 'volcengine-ark',
          external_id: 'req-provider-1',
        }]);
        expect(sql).toContain('ids.external_id IN (legacy.provider_operation_id, legacy.provider_request_id)');
        expect(sql).toContain('legacy.provider_response_id');
        return queryResult([{ already_accounted: true }]);
      }
      return queryResult([]);
    });

    await expect(importProviderOperationalUsage({
      rawManifest,
      apply: true,
      approvedManifestSha256: manifestSha256,
    })).rejects.toThrow(/PROVIDER_OPERATIONAL_USAGE_ALREADY_ACCOUNTED/);
    const sql = mocks.query.mock.calls.map(call => String(call[0])).join('\n');
    expect(sql).toContain('provider_usage_records');
    expect(sql).toContain('generation_provider_runs');
    expect(sql).toContain('image_provider_usage_records');
    expect(sql).toContain('prompt_wizard_provider_requests');
    expect(sql).not.toContain('INSERT INTO provider_operational_usage_records');
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('缺 Provider ID 的历史视频若与 legacy 模型、时点及 token 或成本相近则 fail closed', async () => {
    const manifest = missingOriginalManifest();
    const rawManifest = JSON.stringify(manifest);
    const manifestSha256 = computeProviderOperationalUsageManifestSha256(rawManifest);
    const rawApproval = JSON.stringify(validMissingOriginalApproval(manifest, rawManifest));
    const approvalSha256 = computeProviderOperationalUsageMissingEvidenceApprovalSha256(rawApproval);
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("lower(email) = 'admin@lindyson.com'")) {
        return queryResult([{ id: ownerUserId }]);
      }
      if (sql.includes('id = ANY($1::uuid[])')) {
        return queryResult((values?.[0] as string[]).map(id => ({ id, role: 'admin', status: 'active' })));
      }
      if (sql.includes('SELECT clock_timestamp() AS database_now')) {
        return queryResult([{ database_now: '2026-08-12T03:00:00.000Z' }]);
      }
      if (sql.includes('AS already_accounted')) return queryResult([{ already_accounted: false }]);
      if (sql.includes('AS fuzzy_candidate')) {
        expect(JSON.parse(String(values?.[0]))).toEqual([{
          provider: 'volcengine-ark',
          model: 'Seedance 2.5',
          occurred_at: '2026-08-10T16:30:00.000Z',
          billable_tokens: '108900',
          estimated_cost_cny: '2.504700',
        }]);
        expect(sql).toContain('abs(extract(epoch FROM');
        expect(sql).toContain('legacy.billable_tokens = candidate.billable_tokens');
        expect(sql).toContain('abs(legacy.estimated_cost - candidate.estimated_cost_cny) <= 0.000001');
        return queryResult([{ fuzzy_candidate: true }]);
      }
      return queryResult([]);
    });

    await expect(importProviderOperationalUsage({
      rawManifest,
      rawAdminConfirmMissingOriginalEvidence: rawApproval,
      approvedAdminConfirmMissingOriginalEvidenceSha256: approvalSha256,
      apply: true,
      approvedManifestSha256: manifestSha256,
    })).rejects.toThrow(/LEGACY_FUZZY_CANDIDATE_REQUIRES_REVIEW/);
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.query.mock.calls.some(call => String(call[0]).includes(
      'INSERT INTO provider_operational_usage_records',
    ))).toBe(false);
  });
});

function validManifest(): ProviderOperationalUsageManifest {
  return {
    manifestVersion: PROVIDER_OPERATIONAL_USAGE_MANIFEST_VERSION,
    manifestId: 'deploy-2026-08-11-seedance-shadow',
    generatedAt: '2026-08-11T00:35:00.000Z',
    records: [{
      provider: 'volcengine-ark',
      serviceType: 'video' as const,
      model: 'Seedance 2.5',
      operation: 'video-generation',
      costOwnerUserId: ownerUserId,
      purpose: 'deployment-canary' as const,
      initiatorType: 'maintenance-script' as const,
      initiatedByUserId: null,
      sourceRunId: 'shadow-2026-08-11T00:30:00Z',
      sourceItemKey: 'scenario-1',
      providerTaskId: 'task-provider-1',
      providerOperationId: null,
      providerRequestId: 'req-provider-1',
      status: 'success' as const,
      providerReached: true,
      occurredAt: '2026-08-10T16:30:00.000Z',
      localAccountingDate: '2026-08-11',
      usageEvidence: {
        completionTokens: 108_900,
        billableTokens: 108_900,
        resolution: '720p',
        hasVideoInput: false,
      },
      evidencePath,
      evidenceSha256,
      valuation: {
        pricingStatus: 'priced' as const,
        priceVersion: 'volcengine-seedance-2026-08-10',
        pricingSourceUrl: 'https://www.volcengine.com/docs/82379/1544106',
        unitPriceSnapshot: {
          calculationMethod: 'sum-of-rounded-components/v1' as const,
          components: [{
            key: 'completion-tokens',
            quantity: '108900',
            unit: 'token',
            unitSize: '1000000',
            unitPriceCny: '23.000000',
            estimatedCostCny: '2.504700',
          }],
        },
        estimatedCostCny: '2.504700',
        currency: 'CNY' as const,
        evidenceSha256,
      },
    }],
  };
}

function missingOriginalManifest(): ProviderOperationalUsageManifest {
  const manifest = validManifest();
  const record = manifest.records[0]!;
  record.evidencePath = join(testDirectory, 'historical-original-does-not-exist.json');
  record.providerTaskId = null;
  record.providerOperationId = null;
  record.providerRequestId = null;
  return manifest;
}

function validMissingOriginalApproval(
  manifest: ProviderOperationalUsageManifest,
  rawManifest: Buffer | string,
): ProviderOperationalUsageMissingEvidenceApproval {
  return {
    approvalVersion: PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_VERSION,
    approvalId: `${manifest.manifestId}-admin-cost-confirmation-v1`,
    manifestSha256: computeProviderOperationalUsageManifestSha256(rawManifest),
    approvedByUserId: manifest.records[0]!.costOwnerUserId,
    approvedAt: '2026-08-12T02:32:09.000Z',
    reason: 'historical-original-evidence-unavailable',
    note: '管理员明确确认缺失的历史原始证据，并仅允许计入 Admin 官网列表价运营成本。',
    decision: {
      countAsAdminOperationalCost: true,
      allowProviderExternalIdClaims: false,
      allowOfficialBillAttribution: false,
    },
    records: manifest.records.map(record => ({
      provider: record.provider,
      sourceRunId: record.sourceRunId,
      sourceItemKey: record.sourceItemKey,
      evidencePath: record.evidencePath,
      evidenceSha256: record.evidenceSha256,
    })),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function queryResult<T>(rows: T[], rowCount = rows.length) {
  return { rows, rowCount };
}

function cnyMicros(value: string) {
  const [whole, fraction] = value.split('.');
  return BigInt(whole!) * 1_000_000n + BigInt(fraction!);
}
