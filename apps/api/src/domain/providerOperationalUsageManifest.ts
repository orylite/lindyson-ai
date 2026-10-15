import { createHash } from 'node:crypto';
import { z } from 'zod';

export const PROVIDER_OPERATIONAL_USAGE_MANIFEST_VERSION = 'lindyson.provider-operational-usage/v1' as const;

export const PROVIDER_OPERATIONAL_SERVICE_TYPES = ['video', 'image', 'multimodal'] as const;
export const PROVIDER_OPERATIONAL_PURPOSES = [
  'deployment-canary',
  'api-smoke-test',
  'provider-diagnostic',
  'admin-direct',
] as const;
export const PROVIDER_OPERATIONAL_INITIATOR_TYPES = [
  'admin-user',
  'release-automation',
  'maintenance-script',
] as const;
export const PROVIDER_OPERATIONAL_STATUSES = ['success', 'failed', 'unknown'] as const;
export const PROVIDER_OPERATIONAL_PRICING_STATUSES = [
  'priced',
  'unpriced',
  'missing-evidence',
] as const;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(jsonValueSchema),
  z.record(jsonValueSchema),
]));

const jsonObjectSchema = z.record(jsonValueSchema).refine(
  value => Object.keys(value).length > 0,
  '证据对象不能为空',
);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'SHA256 必须是 64 位小写十六进制');
const identifierSchema = z.string().trim().min(1).max(256);
const longIdentifierSchema = z.string().trim().min(1).max(1024);
const nullableProviderIdentifierSchema = z.string().trim().min(1).max(1024)
  .refine(
    value => !/^sha256:[0-9a-f]{16,64}$/.test(value),
    '供应商外部 ID 不得使用 SHA256 指纹冒充原值',
  )
  .nullable();
const cnyAmountSchema = z.string().regex(
  /^(?:0|[1-9]\d{0,13})\.\d{6}$/,
  '人民币金额必须是非负、六位小数的字符串',
);
const nonnegativeIntegerStringSchema = z.string().regex(/^(?:0|[1-9]\d{0,17})$/);
const positiveIntegerStringSchema = z.string().regex(/^[1-9]\d{0,17}$/);
const accountingDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  value => isCalendarDate(value),
  '本地记账日期无效',
);

export const providerOperationalUnitPriceComponentV1Schema = z.object({
  key: identifierSchema,
  quantity: nonnegativeIntegerStringSchema,
  unit: identifierSchema,
  unitSize: positiveIntegerStringSchema,
  unitPriceCny: cnyAmountSchema,
  estimatedCostCny: cnyAmountSchema,
}).strict().superRefine((component, context) => {
  const expectedCost = multiplyAndRoundCny(
    component.quantity,
    component.unitPriceCny,
    component.unitSize,
  );
  if (component.estimatedCostCny !== expectedCost) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['estimatedCostCny'],
      message: `分项估值应为 ${expectedCost}`,
    });
  }
});

export const providerOperationalUnitPriceSnapshotV1Schema = z.object({
  calculationMethod: z.literal('sum-of-rounded-components/v1'),
  components: z.array(providerOperationalUnitPriceComponentV1Schema).min(1).max(50),
}).strict().superRefine((snapshot, context) => {
  const seen = new Set<string>();
  snapshot.components.forEach((component, index) => {
    if (seen.has(component.key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['components', index, 'key'],
        message: '估值分项键不能重复',
      });
    }
    seen.add(component.key);
  });
});

export const providerOperationalUsageValuationV1Schema = z.object({
  pricingStatus: z.enum(PROVIDER_OPERATIONAL_PRICING_STATUSES),
  priceVersion: z.string().trim().min(1).max(256).nullable(),
  pricingSourceUrl: z.string().url().max(2048).nullable(),
  unitPriceSnapshot: providerOperationalUnitPriceSnapshotV1Schema.nullable(),
  estimatedCostCny: cnyAmountSchema.nullable(),
  currency: z.literal('CNY'),
  evidenceSha256: sha256Schema,
}).strict().superRefine((valuation, context) => {
  if (valuation.pricingStatus === 'priced') {
    if (!valuation.priceVersion) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['priceVersion'], message: '已估值记录必须提供价格版本' });
    }
    if (!valuation.pricingSourceUrl) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['pricingSourceUrl'], message: '已估值记录必须提供价格来源' });
    }
    if (!valuation.unitPriceSnapshot) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['unitPriceSnapshot'], message: '已估值记录必须固化单价快照' });
    }
    if (!valuation.estimatedCostCny) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['estimatedCostCny'], message: '已估值记录必须提供估算成本' });
    }
    if (valuation.unitPriceSnapshot && valuation.estimatedCostCny) {
      const componentTotal = formatCnyMicros(valuation.unitPriceSnapshot.components.reduce(
        (sum, component) => sum + parseCnyMicros(component.estimatedCostCny),
        0n,
      ));
      if (valuation.estimatedCostCny !== componentTotal) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['estimatedCostCny'],
          message: `总估值必须等于分项之和 ${componentTotal}`,
        });
      }
    }
  } else if (valuation.estimatedCostCny !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['estimatedCostCny'],
      message: '未估值或缺少证据时不得填写估算成本',
    });
  }
});

export const providerOperationalUsageRecordV1Schema = z.object({
  provider: identifierSchema,
  serviceType: z.enum(PROVIDER_OPERATIONAL_SERVICE_TYPES),
  model: identifierSchema,
  operation: identifierSchema,
  costOwnerUserId: z.string().uuid(),
  purpose: z.enum(PROVIDER_OPERATIONAL_PURPOSES),
  initiatorType: z.enum(PROVIDER_OPERATIONAL_INITIATOR_TYPES),
  initiatedByUserId: z.string().uuid().nullable(),
  sourceRunId: longIdentifierSchema,
  sourceItemKey: longIdentifierSchema,
  providerTaskId: nullableProviderIdentifierSchema,
  providerOperationId: nullableProviderIdentifierSchema,
  providerRequestId: nullableProviderIdentifierSchema,
  status: z.enum(PROVIDER_OPERATIONAL_STATUSES),
  providerReached: z.boolean(),
  occurredAt: z.string().datetime({ offset: true }),
  localAccountingDate: accountingDateSchema,
  usageEvidence: jsonObjectSchema,
  evidencePath: z.string().trim().min(1).max(2048),
  evidenceSha256: sha256Schema,
  valuation: providerOperationalUsageValuationV1Schema,
}).strict().superRefine((record, context) => {
  if (!record.providerReached) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['providerReached'],
      message: '未触达供应商的尝试不得写入运营成本账本',
    });
  }
  if (record.initiatorType === 'admin-user' && !record.initiatedByUserId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['initiatedByUserId'],
      message: '管理员发起的调用必须记录管理员用户 ID',
    });
  }
  if (record.status === 'success' && !record.providerReached) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['providerReached'],
      message: '成功调用必须已触达供应商',
    });
  }
  if (!record.providerReached && [
    record.providerTaskId,
    record.providerOperationId,
    record.providerRequestId,
  ].some(value => value !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['providerReached'],
      message: '未触达供应商的记录不得包含供应商标识',
    });
  }
  if (!record.providerReached && record.valuation.pricingStatus === 'priced') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['valuation', 'pricingStatus'],
      message: '未触达供应商的记录不得估值',
    });
  }
  if (record.valuation.evidenceSha256 !== record.evidenceSha256) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['valuation', 'evidenceSha256'],
      message: '估值证据 SHA256 必须与运营调用证据文件一致',
    });
  }
  const expectedAccountingDate = shanghaiAccountingDate(record.occurredAt);
  if (expectedAccountingDate !== record.localAccountingDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['localAccountingDate'],
      message: `记账日期必须按北京时间归属为 ${expectedAccountingDate}`,
    });
  }
});

export const providerOperationalUsageManifestV1Schema = z.object({
  manifestVersion: z.literal(PROVIDER_OPERATIONAL_USAGE_MANIFEST_VERSION),
  manifestId: identifierSchema,
  generatedAt: z.string().datetime({ offset: true }),
  records: z.array(providerOperationalUsageRecordV1Schema).min(1).max(10_000),
}).strict().superRefine((manifest, context) => {
  const seen = new Set<string>();
  const seenProviderExternalIds = new Map<string, {
    recordIndex: number;
    field: 'providerTaskId' | 'providerOperationId' | 'providerRequestId';
  }>();
  const costOwnerUserIds = new Set(manifest.records.map(record => record.costOwnerUserId));
  if (costOwnerUserIds.size !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['records'],
      message: '同一 manifest 只能归属一个成本承担用户；不同用户必须拆分 manifest',
    });
  }
  const generatedAt = Date.parse(manifest.generatedAt);
  manifest.records.forEach((record, index) => {
    const key = `${record.provider}\u0000${record.sourceRunId}\u0000${record.sourceItemKey}`;
    if (seen.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['records', index, 'sourceItemKey'],
        message: '同一 manifest 内存在重复的供应商、运行和条目键',
      });
    }
    seen.add(key);
    const providerExternalIds = [
      ['providerTaskId', record.providerTaskId],
      ['providerOperationId', record.providerOperationId],
      ['providerRequestId', record.providerRequestId],
    ] as const;
    providerExternalIds.forEach(([field, externalId]) => {
      if (externalId === null) return;
      const externalIdKey = `${record.provider}\u0000${externalId}`;
      const previous = seenProviderExternalIds.get(externalIdKey);
      if (previous) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['records', index, field],
          message: `同一 Provider 外部 ID 已在第 ${previous.recordIndex + 1} 条记录的 ${previous.field} 使用；不得跨 task/operation/request 字段重复`,
        });
        return;
      }
      seenProviderExternalIds.set(externalIdKey, { recordIndex: index, field });
    });
    if (Date.parse(record.occurredAt) > generatedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['records', index, 'occurredAt'],
        message: '调用发生时间不得晚于 manifest 生成时间',
      });
    }
  });
});

export type ProviderOperationalUsageValuationV1 = z.infer<typeof providerOperationalUsageValuationV1Schema>;
export type ProviderOperationalUnitPriceSnapshotV1 = z.infer<typeof providerOperationalUnitPriceSnapshotV1Schema>;
export type ProviderOperationalUsageRecordV1 = z.infer<typeof providerOperationalUsageRecordV1Schema>;
export type ProviderOperationalUsageManifestV1 = z.infer<typeof providerOperationalUsageManifestV1Schema>;
export type ProviderOperationalUsageManifest = ProviderOperationalUsageManifestV1;

export function parseProviderOperationalUsageManifest(value: unknown): ProviderOperationalUsageManifest {
  return providerOperationalUsageManifestV1Schema.parse(value);
}

export function parseProviderOperationalUsageManifestJson(rawManifest: Buffer | string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifest.toString());
  } catch {
    throw operationalUsageManifestError('PROVIDER_OPERATIONAL_USAGE_MANIFEST_JSON_INVALID');
  }
  return parseProviderOperationalUsageManifest(parsed);
}

export function computeProviderOperationalUsageManifestSha256(rawManifest: Buffer | string) {
  return createHash('sha256').update(rawManifest).digest('hex');
}

function shanghaiAccountingDate(instant: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month! - 1
    && date.getUTCDate() === day;
}

function multiplyAndRoundCny(quantity: string, unitPriceCny: string, unitSize: string) {
  const divisor = BigInt(unitSize);
  const numerator = BigInt(quantity) * parseCnyMicros(unitPriceCny);
  const wholeMicros = numerator / divisor;
  const remainder = numerator % divisor;
  const roundedMicros = remainder * 2n >= divisor ? wholeMicros + 1n : wholeMicros;
  return formatCnyMicros(roundedMicros);
}

function parseCnyMicros(value: string) {
  const [whole, fraction] = value.split('.');
  return BigInt(whole!) * 1_000_000n + BigInt(fraction!);
}

function formatCnyMicros(value: bigint) {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}

function operationalUsageManifestError(code: string) {
  return Object.assign(new Error(code), { code });
}
