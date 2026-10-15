import type { SeedanceCostModelLabel } from './seedanceModels.js';
import { isSeedanceCostModelLabel } from './seedanceModels.js';

export const SEEDANCE_PRICE_VERSION = 'volcengine-seedance-2026-08-10';
export const SEEDANCE_PRICE_CURRENCY = 'CNY' as const;

export type SeedancePricingResolution = '480p' | '720p' | '1080p' | '4k';
export type ProviderPricingStatus = 'priced' | 'unpriced' | 'legacy-inferred';

export interface SeedancePricingRule {
  provider: 'volcengine-ark';
  model: SeedanceCostModelLabel;
  resolution: SeedancePricingResolution;
  hasVideoInput: boolean;
  unitPricePerMillion: number;
  currency: typeof SEEDANCE_PRICE_CURRENCY;
  priceVersion: typeof SEEDANCE_PRICE_VERSION;
}

export interface SeedanceCostEstimate {
  pricingStatus: Exclude<ProviderPricingStatus, 'legacy-inferred'>;
  priceVersion: string | null;
  currency: typeof SEEDANCE_PRICE_CURRENCY;
  resolution: SeedancePricingResolution | null;
  hasVideoInput: boolean;
  unitPricePerMillion: string | null;
  estimatedCost: string | null;
}

const PRICE_RULES: readonly SeedancePricingRule[] = [
  // 火山方舟官网刊例价；不采用 2026-08-07 至 2026-09-07 的限时优惠。
  ...pricePair('Seedance 2.5', '480p', 70, 42),
  ...pricePair('Seedance 2.5', '720p', 70, 42),
  ...pricePair('Seedance 2.0', '480p', 46, 28),
  ...pricePair('Seedance 2.0', '720p', 46, 28),
  ...pricePair('Seedance 2.0', '1080p', 51, 31),
  ...pricePair('Seedance 2.0 Fast', '480p', 37, 22),
  ...pricePair('Seedance 2.0 Fast', '720p', 37, 22),
  ...pricePair('Seedance 2.0 Mini', '480p', 23, 14),
  ...pricePair('Seedance 2.0 Mini', '720p', 23, 14),
];

const ruleByKey = new Map(PRICE_RULES.map(rule => [pricingKey(rule.model, rule.resolution, rule.hasVideoInput), rule]));

export function listSeedancePricingRules() {
  return PRICE_RULES;
}

export function hasSeedanceVideoInput(config: Record<string, unknown>) {
  if (!Array.isArray(config.referenceAssets)) return false;
  return config.referenceAssets.some(item => isRecord(item)
    && (normalizeText(item.type) === 'video' || normalizeText(item.role) === 'reference_video'));
}

export function normalizeSeedancePricingResolution(value: unknown): SeedancePricingResolution | null {
  const normalized = normalizeText(value);
  if (normalized === '480p' || normalized === '720p' || normalized === '1080p' || normalized === '4k') {
    return normalized;
  }
  return null;
}

export function findSeedancePricingRule(input: {
  model: string;
  resolution: unknown;
  hasVideoInput: boolean;
}) {
  if (!isSeedanceCostModelLabel(input.model)) return null;
  const resolution = normalizeSeedancePricingResolution(input.resolution);
  if (!resolution) return null;
  return ruleByKey.get(pricingKey(input.model, resolution, input.hasVideoInput)) ?? null;
}

export function estimateSeedanceCost(input: {
  model: string;
  resolution: unknown;
  hasVideoInput: boolean;
  billableTokens: number | null | undefined;
}): SeedanceCostEstimate {
  const resolution = normalizeSeedancePricingResolution(input.resolution);
  const rule = findSeedancePricingRule(input);
  if (!rule || !isTokenCount(input.billableTokens)) {
    return {
      pricingStatus: 'unpriced',
      priceVersion: null,
      currency: SEEDANCE_PRICE_CURRENCY,
      resolution,
      hasVideoInput: input.hasVideoInput,
      unitPricePerMillion: null,
      estimatedCost: null,
    };
  }

  return {
    pricingStatus: 'priced',
    priceVersion: rule.priceVersion,
    currency: rule.currency,
    resolution: rule.resolution,
    hasVideoInput: rule.hasVideoInput,
    unitPricePerMillion: formatSixDecimalInteger(rule.unitPricePerMillion),
    estimatedCost: formatCost(input.billableTokens, rule.unitPricePerMillion),
  };
}

function pricePair(
  model: SeedanceCostModelLabel,
  resolution: SeedancePricingResolution,
  withoutVideo: number,
  withVideo: number,
): SeedancePricingRule[] {
  return [
    priceRule(model, resolution, false, withoutVideo),
    priceRule(model, resolution, true, withVideo),
  ];
}

function priceRule(
  model: SeedanceCostModelLabel,
  resolution: SeedancePricingResolution,
  hasVideoInput: boolean,
  unitPricePerMillion: number,
): SeedancePricingRule {
  return {
    provider: 'volcengine-ark',
    model,
    resolution,
    hasVideoInput,
    unitPricePerMillion,
    currency: SEEDANCE_PRICE_CURRENCY,
    priceVersion: SEEDANCE_PRICE_VERSION,
  };
}

function pricingKey(model: SeedanceCostModelLabel, resolution: SeedancePricingResolution, hasVideoInput: boolean) {
  return `${model}\u0000${resolution}\u0000${hasVideoInput ? 'video' : 'no-video'}`;
}

function formatCost(tokens: number, unitPricePerMillion: number) {
  const micros = BigInt(tokens) * BigInt(unitPricePerMillion);
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}

function formatSixDecimalInteger(value: number) {
  return `${value}.000000`;
}

function isTokenCount(value: number | null | undefined): value is number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0;
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
