export const SEEDREAM_5_PRO_MODEL_ID = 'doubao-seedream-5-0-pro-260628';
export const SEEDREAM_5_PRO_MODEL_LABEL = 'Seedream 5.0 Pro';
export const SEEDREAM_LIST_PRICE_SOURCE_URL = 'https://docs.volcengine.com/docs/82379/1544106?lang=zh';
export const SEEDREAM_LIST_PRICE_VERSION = 'volcengine-seedream-5.0-pro-list-2026-07-27';

export const SEEDREAM_SMALL_IMAGE_MAX_PIXELS = 2_360_000;
export const SEEDREAM_SMALL_IMAGE_PRICE_CNY_MICROS = 300_000;
export const SEEDREAM_LARGE_IMAGE_PRICE_CNY_MICROS = 600_000;
export const SEEDREAM_ADDITIONAL_REFERENCE_PRICE_CNY_MICROS = 20_000;

export type SeedreamListPriceEvidenceStatus = 'known' | 'missing-evidence';
export type SeedreamListPriceMissingEvidence = 'reference-image-count' | 'output-dimensions';

export interface SeedreamListPriceEvidence {
  referenceImageCount: number | null;
  outputWidth: number | null;
  outputHeight: number | null;
}

export interface SeedreamListPriceEstimate {
  status: SeedreamListPriceEvidenceStatus;
  referenceImageCount: number | null;
  additionalReferenceImageCount: number | null;
  outputWidth: number | null;
  outputHeight: number | null;
  outputPixels: number | null;
  outputPriceCny: string | null;
  referencePriceCny: string | null;
  estimatedCostCny: string | null;
  missingEvidence: SeedreamListPriceMissingEvidence[];
  priceVersion: typeof SEEDREAM_LIST_PRICE_VERSION;
  pricingSourceUrl: typeof SEEDREAM_LIST_PRICE_SOURCE_URL;
}

/**
 * Seedream 官网列表价估算只用于创建时固化价格证据，不能在报表查询时重算历史任务。
 * 首张参考图免费，后续参考图每张 ¥0.02；实际输出像素不超过 236 万时 ¥0.30，
 * 超过时 ¥0.60。返回金额固定为六位小数，便于写入 numeric(20,6) 快照。
 */
export function estimateSeedreamListPrice(
  evidence: SeedreamListPriceEvidence,
): SeedreamListPriceEstimate {
  const referenceImageCount = normalizeNonnegativeInteger(evidence.referenceImageCount);
  const outputWidth = normalizePositiveInteger(evidence.outputWidth);
  const outputHeight = normalizePositiveInteger(evidence.outputHeight);
  const missingEvidence: SeedreamListPriceMissingEvidence[] = [];
  if (referenceImageCount === null) missingEvidence.push('reference-image-count');
  if (outputWidth === null || outputHeight === null) missingEvidence.push('output-dimensions');

  const additionalReferenceImageCount = referenceImageCount === null
    ? null
    : Math.max(0, referenceImageCount - 1);
  const outputPixels = outputWidth === null || outputHeight === null
    ? null
    : outputWidth * outputHeight;

  if (missingEvidence.length > 0 || additionalReferenceImageCount === null || outputPixels === null) {
    return {
      status: 'missing-evidence',
      referenceImageCount,
      additionalReferenceImageCount,
      outputWidth,
      outputHeight,
      outputPixels,
      outputPriceCny: null,
      referencePriceCny: null,
      estimatedCostCny: null,
      missingEvidence,
      priceVersion: SEEDREAM_LIST_PRICE_VERSION,
      pricingSourceUrl: SEEDREAM_LIST_PRICE_SOURCE_URL,
    };
  }

  const outputPriceMicros = outputPixels <= SEEDREAM_SMALL_IMAGE_MAX_PIXELS
    ? SEEDREAM_SMALL_IMAGE_PRICE_CNY_MICROS
    : SEEDREAM_LARGE_IMAGE_PRICE_CNY_MICROS;
  const referencePriceMicros = additionalReferenceImageCount
    * SEEDREAM_ADDITIONAL_REFERENCE_PRICE_CNY_MICROS;

  return {
    status: 'known',
    referenceImageCount,
    additionalReferenceImageCount,
    outputWidth,
    outputHeight,
    outputPixels,
    outputPriceCny: formatCnyMicros(outputPriceMicros),
    referencePriceCny: formatCnyMicros(referencePriceMicros),
    estimatedCostCny: formatCnyMicros(outputPriceMicros + referencePriceMicros),
    missingEvidence,
    priceVersion: SEEDREAM_LIST_PRICE_VERSION,
    pricingSourceUrl: SEEDREAM_LIST_PRICE_SOURCE_URL,
  };
}

function normalizeNonnegativeInteger(value: number | null) {
  return Number.isSafeInteger(value) && value !== null && value >= 0 ? value : null;
}

function normalizePositiveInteger(value: number | null) {
  return Number.isSafeInteger(value) && value !== null && value > 0 ? value : null;
}

function formatCnyMicros(value: number) {
  return (value / 1_000_000).toFixed(6);
}
