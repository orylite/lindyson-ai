import { createHash } from 'node:crypto';
import { z } from 'zod';

export const PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_VERSION =
  'lindyson.provider-operational-usage-missing-evidence-approval/v1' as const;

export const PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_HISTORICAL_CUTOFF =
  '2026-08-12T02:32:09.000Z' as const;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const identifierSchema = z.string().trim().min(1).max(1024);

export const providerOperationalUsageMissingEvidenceApprovalRecordSchema = z.object({
  provider: z.string().trim().min(1).max(256),
  sourceRunId: identifierSchema,
  sourceItemKey: identifierSchema,
  evidencePath: z.string().trim().min(1).max(2048),
  evidenceSha256: sha256Schema,
}).strict();

export const providerOperationalUsageMissingEvidenceApprovalSchema = z.object({
  approvalVersion: z.literal(PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_VERSION),
  approvalId: z.string().trim().min(1).max(256),
  manifestSha256: sha256Schema,
  approvedByUserId: z.string().uuid(),
  approvedAt: z.string().datetime({ offset: true }),
  reason: z.literal('historical-original-evidence-unavailable'),
  note: z.string().trim().min(10).max(2000),
  decision: z.object({
    countAsAdminOperationalCost: z.literal(true),
    allowProviderExternalIdClaims: z.literal(false),
    allowOfficialBillAttribution: z.literal(false),
  }).strict(),
  records: z.array(providerOperationalUsageMissingEvidenceApprovalRecordSchema).min(1).max(10_000),
}).strict().superRefine((approval, context) => {
  const seen = new Set<string>();
  approval.records.forEach((record, index) => {
    const key = approvalRecordKey(record);
    if (seen.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['records', index],
        message: '缺文件审批不得重复覆盖同一运营调用来源键',
      });
    }
    seen.add(key);
  });
});

export type ProviderOperationalUsageMissingEvidenceApproval = z.infer<
  typeof providerOperationalUsageMissingEvidenceApprovalSchema
>;
export type ProviderOperationalUsageMissingEvidenceApprovalRecord = z.infer<
  typeof providerOperationalUsageMissingEvidenceApprovalRecordSchema
>;

export function parseProviderOperationalUsageMissingEvidenceApprovalJson(raw: Buffer | string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    throw missingEvidenceApprovalError(
      'PROVIDER_OPERATIONAL_USAGE_MISSING_EVIDENCE_APPROVAL_JSON_INVALID',
    );
  }
  return providerOperationalUsageMissingEvidenceApprovalSchema.parse(parsed);
}

export function computeProviderOperationalUsageMissingEvidenceApprovalSha256(raw: Buffer | string) {
  return createHash('sha256').update(raw).digest('hex');
}

export function approvalRecordKey(record: {
  provider: string;
  sourceRunId: string;
  sourceItemKey: string;
}) {
  return JSON.stringify([record.provider, record.sourceRunId, record.sourceItemKey]);
}

function missingEvidenceApprovalError(code: string) {
  return Object.assign(new Error(code), { code });
}
