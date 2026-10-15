import {
  SEEDREAM_LIST_PRICE_SOURCE_URL,
  type SeedreamListPriceEstimate,
} from '../domain/seedreamListPrice.js';
import { calculatePromptWizardCostCny } from '../domain/promptWizardCostLedger.js';
import type { ProviderOperationalUsageRecordV1 } from '../domain/providerOperationalUsageManifest.js';
import {
  hashOperationalUsageEvidence,
  hashProviderIdentifier,
} from './providerOperationalUsageManifestWriter.js';

interface CanaryRecordBase {
  costOwnerUserId: string;
  sourceRunId: string;
  sourceItemKey: string;
  occurredAt: string;
  evidencePath: string;
  evidenceSha256: string;
}

export function seedanceShadowCanaryOperationalUsageRecord(input: CanaryRecordBase & {
  scenario: string;
  providerTaskId: string | null;
  model: string;
  completionTokens: number | null;
  billableTokens: number | null;
  hasVideoInput: boolean | null;
  priceVersion: string | null;
  unitPricePerMillionCny: string | null;
  estimatedCostCny: string | null;
  status?: 'success' | 'failed' | 'unknown';
}): ProviderOperationalUsageRecordV1 {
  const structuredEvidence = {
    evidenceKind: 'seedance-shadow-canary/v1',
    scenario: input.scenario,
    completionTokens: input.completionTokens,
    billableTokens: input.billableTokens,
    hasVideoInput: input.hasVideoInput,
    providerTaskIdSha256: hashProviderIdentifier(input.providerTaskId),
  } as const;
  const usageEvidence = {
    ...structuredEvidence,
    usageEvidenceSha256: hashOperationalUsageEvidence(structuredEvidence),
  } as const;
  const hasCompletePricingEvidence = Number.isSafeInteger(input.billableTokens)
    && input.billableTokens !== null
    && input.billableTokens >= 0
    && input.priceVersion !== null
    && input.unitPricePerMillionCny !== null
    && input.estimatedCostCny !== null;
  return baseRecord(input, {
    serviceType: 'video',
    model: input.model,
    operation: 'video-generation-shadow-canary',
    providerTaskId: input.providerTaskId,
    status: input.status ?? 'success',
    usageEvidence,
    evidenceSha256: input.evidenceSha256,
    valuation: hasCompletePricingEvidence
      ? pricedValuation({
        priceVersion: input.priceVersion!,
        pricingSourceUrl: 'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
        quantity: input.billableTokens!,
        unit: 'token',
        unitSize: 1_000_000,
        unitPriceCny: input.unitPricePerMillionCny!,
        estimatedCostCny: input.estimatedCostCny!,
        evidenceSha256: input.evidenceSha256,
      })
      : missingValuation(
        input.priceVersion,
        'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
        input.evidenceSha256,
      ),
  });
}

export function seedreamProviderCanaryOperationalUsageRecord(input: CanaryRecordBase & {
  providerOperationId: string | null;
  localCheckpointOperationId?: string | null;
  providerRequestId: string | null;
  model: string;
  referenceImageCount: number;
  outputWidth: number | null;
  outputHeight: number | null;
  price: SeedreamListPriceEstimate;
  status?: 'success' | 'failed' | 'unknown';
}): ProviderOperationalUsageRecordV1 {
  const outputPixels = input.outputWidth === null || input.outputHeight === null
    ? null
    : input.outputWidth * input.outputHeight;
  const structuredEvidence = {
    evidenceKind: 'seedream-provider-canary/v1',
    referenceImageCount: input.referenceImageCount,
    outputWidth: input.outputWidth,
    outputHeight: input.outputHeight,
    outputPixels,
    providerOperationIdSha256: hashProviderIdentifier(input.providerOperationId),
    localCheckpointOperationId: input.localCheckpointOperationId ?? null,
    providerRequestIdSha256: hashProviderIdentifier(input.providerRequestId),
  } as const;
  const usageEvidence = {
    ...structuredEvidence,
    usageEvidenceSha256: hashOperationalUsageEvidence(structuredEvidence),
  } as const;
  const outputPrice = input.price.outputPriceCny;
  const estimatedCost = input.price.estimatedCostCny;
  return baseRecord(input, {
    serviceType: 'image',
    model: input.model,
    operation: 'image-generation-provider-canary',
    providerOperationId: input.providerOperationId,
    providerRequestId: input.providerRequestId,
    status: input.status ?? 'success',
    usageEvidence,
    evidenceSha256: input.evidenceSha256,
    valuation: input.price.status === 'known' && outputPrice && estimatedCost
      ? pricedValuation({
        priceVersion: input.price.priceVersion,
        pricingSourceUrl: SEEDREAM_LIST_PRICE_SOURCE_URL,
        quantity: 1,
        unit: 'generated-image',
        unitSize: 1,
        unitPriceCny: estimatedCost,
        estimatedCostCny: estimatedCost,
        evidenceSha256: input.evidenceSha256,
      })
      : missingValuation(input.price.priceVersion, SEEDREAM_LIST_PRICE_SOURCE_URL, input.evidenceSha256),
  });
}

export function promptWizardProviderCanaryOperationalUsageRecord(input: CanaryRecordBase & {
  operation: string;
  providerRequestId: string | null;
  providerResponseId: string | null;
  xTtLogId: string | null;
  model: string;
  status: 'success' | 'failed' | 'unknown';
  serviceTier: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}): ProviderOperationalUsageRecordV1 {
  const structuredEvidence = {
    evidenceKind: 'prompt-wizard-provider-canary/v1',
    inputTokens: input.inputTokens,
    cachedInputTokens: input.cachedInputTokens,
    outputTokens: input.outputTokens,
    serviceTier: input.serviceTier,
    providerOperationIdSha256: hashProviderIdentifier(input.providerResponseId ?? input.xTtLogId),
    providerRequestIdSha256: hashProviderIdentifier(input.providerRequestId),
  } as const;
  const usageEvidence = {
    ...structuredEvidence,
    usageEvidenceSha256: hashOperationalUsageEvidence(structuredEvidence),
  } as const;
  const pricing = promptWizardPricing(input);
  return baseRecord(input, {
    serviceType: 'multimodal',
    model: input.model,
    operation: input.operation,
    providerOperationId: input.providerResponseId ?? input.xTtLogId,
    providerRequestId: input.providerRequestId,
    status: input.status,
    usageEvidence,
    evidenceSha256: input.evidenceSha256,
    valuation: pricing
      ? pricedValuation({
        priceVersion: 'volcengine-list-2026-07-23',
        pricingSourceUrl: 'https://www.volcengine.com/docs/82379/1544106',
        quantity: 1,
        unit: 'priced-provider-request',
        unitSize: 1,
        unitPriceCny: pricing.costCny,
        estimatedCostCny: pricing.costCny,
        evidenceSha256: input.evidenceSha256,
      })
      : missingValuation(
        'volcengine-list-2026-07-23',
        'https://www.volcengine.com/docs/82379/1544106',
        input.evidenceSha256,
      ),
  });
}

/**
 * TK Prompt Engine 影子库 Canary 的逐请求运营记录。
 *
 * run / generation / option 等业务 UUID 只存在影子库，不进入证据；sourceItemKey
 * 由调用方使用稳定案例键构造。Provider 外部 ID 仍按运营账本协议保留在 manifest
 * 的专用字段中，安全证据只记录其 SHA256。
 */
export function tkPromptEngineProviderCanaryOperationalUsageRecord(input: CanaryRecordBase & {
  stage: 'analysis' | 'strategy' | 'option';
  action: 'analyze-facts' | 'plan-strategies' | 'generate-option' | 'repair-option';
  repairRound: 0 | 1;
  transportAttempt: number;
  providerRequestId: string | null;
  providerResponseId: string | null;
  xTtLogId: string | null;
  model: string;
  status: 'success' | 'failed' | 'unknown';
  serviceTier: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  ledgerCostCny: string | null;
}): ProviderOperationalUsageRecordV1 {
  if (!Number.isSafeInteger(input.transportAttempt) || input.transportAttempt < 1) {
    throw operationalUsageAdapterError('TK_PROMPT_CANARY_TRANSPORT_ATTEMPT_INVALID');
  }
  if ((input.action === 'repair-option') !== (input.repairRound === 1)) {
    throw operationalUsageAdapterError('TK_PROMPT_CANARY_REPAIR_ROUND_INVALID');
  }
  const structuredEvidence = {
    evidenceKind: 'tk-prompt-engine-shadow-provider-canary/v1',
    stage: input.stage,
    action: input.action,
    repairRound: input.repairRound,
    transportAttempt: input.transportAttempt,
    inputTokens: input.inputTokens,
    cachedInputTokens: input.cachedInputTokens,
    outputTokens: input.outputTokens,
    serviceTier: input.serviceTier,
    providerOperationIdSha256: hashProviderIdentifier(
      input.providerResponseId ?? input.xTtLogId,
    ),
    providerRequestIdSha256: hashProviderIdentifier(input.providerRequestId),
  } as const;
  const usageEvidence = {
    ...structuredEvidence,
    usageEvidenceSha256: hashOperationalUsageEvidence(structuredEvidence),
  } as const;
  // 影子库账本是这次 Canary 的权威成本源。失败/unknown 请求即使返回了
  // 不完整 token，也不能凭本地推算伪装成已知成本；仍要保留 missing-evidence
  // 运营记录，供人工账单对账。
  const pricing = input.ledgerCostCny === null ? null : promptWizardPricing(input);
  if (input.ledgerCostCny !== null && pricing?.costCny !== input.ledgerCostCny) {
    throw operationalUsageAdapterError('TK_PROMPT_CANARY_LEDGER_COST_MISMATCH');
  }
  return baseRecord(input, {
    serviceType: 'multimodal',
    model: input.model,
    operation: `tk-prompt-engine-${input.action}`,
    providerOperationId: input.providerResponseId ?? input.xTtLogId,
    providerRequestId: input.providerRequestId,
    status: input.status,
    usageEvidence,
    evidenceSha256: input.evidenceSha256,
    valuation: pricing
      ? pricedValuation({
        priceVersion: 'volcengine-list-2026-07-23',
        pricingSourceUrl: 'https://www.volcengine.com/docs/82379/1544106',
        quantity: 1,
        unit: 'priced-provider-request',
        unitSize: 1,
        unitPriceCny: pricing.costCny,
        estimatedCostCny: pricing.costCny,
        evidenceSha256: input.evidenceSha256,
      })
      : missingValuation(
        'volcengine-list-2026-07-23',
        'https://www.volcengine.com/docs/82379/1544106',
        input.evidenceSha256,
      ),
  });
}

function baseRecord(
  input: CanaryRecordBase,
  specific: Partial<ProviderOperationalUsageRecordV1> & Pick<
    ProviderOperationalUsageRecordV1,
    'serviceType' | 'model' | 'operation' | 'status' | 'usageEvidence' | 'evidenceSha256' | 'valuation'
  >,
): ProviderOperationalUsageRecordV1 {
  if (!/^[0-9a-f]{64}$/.test(input.evidenceSha256)) {
    throw operationalUsageAdapterError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_SHA256_INVALID');
  }
  return {
    provider: 'volcengine-ark',
    costOwnerUserId: input.costOwnerUserId,
    purpose: 'deployment-canary',
    initiatorType: 'release-automation',
    initiatedByUserId: null,
    sourceRunId: input.sourceRunId,
    sourceItemKey: input.sourceItemKey,
    providerTaskId: null,
    providerOperationId: null,
    providerRequestId: null,
    providerReached: true,
    occurredAt: input.occurredAt,
    localAccountingDate: shanghaiDate(input.occurredAt),
    evidencePath: input.evidencePath,
    ...specific,
  };
}

function operationalUsageAdapterError(code: string) {
  return Object.assign(new Error(code), { code });
}

function pricedValuation(input: {
  priceVersion: string;
  pricingSourceUrl: string;
  quantity: number;
  unit: string;
  unitSize: number;
  unitPriceCny: string;
  estimatedCostCny: string;
  evidenceSha256: string;
}): ProviderOperationalUsageRecordV1['valuation'] {
  return {
    pricingStatus: 'priced',
    priceVersion: input.priceVersion,
    pricingSourceUrl: input.pricingSourceUrl,
    unitPriceSnapshot: {
      calculationMethod: 'sum-of-rounded-components/v1',
      components: [{
        key: 'provider-list-price',
        quantity: String(input.quantity),
        unit: input.unit,
        unitSize: String(input.unitSize),
        unitPriceCny: input.unitPriceCny,
        estimatedCostCny: input.estimatedCostCny,
      }],
    },
    estimatedCostCny: input.estimatedCostCny,
    currency: 'CNY',
    evidenceSha256: input.evidenceSha256,
  };
}

function missingValuation(
  priceVersion: string | null,
  pricingSourceUrl: string,
  evidenceSha256: string,
): ProviderOperationalUsageRecordV1['valuation'] {
  return {
    pricingStatus: 'missing-evidence',
    priceVersion,
    pricingSourceUrl,
    unitPriceSnapshot: null,
    estimatedCostCny: null,
    currency: 'CNY',
    evidenceSha256,
  };
}

function promptWizardPricing(input: {
  serviceTier: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}) {
  if (input.serviceTier !== 'default'
      || !validToken(input.inputTokens)
      || !validToken(input.cachedInputTokens)
      || !validToken(input.outputTokens)
      || input.cachedInputTokens > input.inputTokens) return null;
  const rates = input.inputTokens <= 32_000
    ? ['0.600000', '0.120000', '3.600000'] as const
    : input.inputTokens <= 128_000
      ? ['0.900000', '0.180000', '5.400000'] as const
      : input.inputTokens <= 256_000
        ? ['1.800000', '0.360000', '10.800000'] as const
        : null;
  if (!rates) return null;
  const costCny = calculatePromptWizardCostCny({
    usage: {
      inputTokens: input.inputTokens,
      cachedInputTokens: input.cachedInputTokens,
      outputTokens: input.outputTokens,
    },
    pricingRule: {
      input_price_per_million_cny: rates[0],
      cached_input_price_per_million_cny: rates[1],
      output_price_per_million_cny: rates[2],
    },
  });
  return costCny ? { costCny } : null;
}

function validToken(value: number | null): value is number {
  return Number.isSafeInteger(value) && value !== null && value >= 0;
}

function shanghaiDate(instant: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
