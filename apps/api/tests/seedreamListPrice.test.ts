import { describe, expect, it } from 'vitest';
import {
  SEEDREAM_LIST_PRICE_SOURCE_URL,
  SEEDREAM_SMALL_IMAGE_MAX_PIXELS,
  estimateSeedreamListPrice,
} from '../src/domain/seedreamListPrice.js';

describe('Seedream 5.0 Pro 官网列表价估算', () => {
  it('首张参考图免费，236 万像素以内按 0.30 元估算', () => {
    const estimate = estimateSeedreamListPrice({
      referenceImageCount: 1,
      outputWidth: 1_024,
      outputHeight: 1_024,
    });

    expect(estimate).toMatchObject({
      status: 'known',
      additionalReferenceImageCount: 0,
      outputPixels: 1_048_576,
      outputPriceCny: '0.300000',
      referencePriceCny: '0.000000',
      estimatedCostCny: '0.300000',
      pricingSourceUrl: SEEDREAM_LIST_PRICE_SOURCE_URL,
    });
  });

  it('阈值本身仍按 0.30 元，超过一个像素即按 0.60 元', () => {
    expect(estimateSeedreamListPrice({
      referenceImageCount: 0,
      outputWidth: SEEDREAM_SMALL_IMAGE_MAX_PIXELS,
      outputHeight: 1,
    }).estimatedCostCny).toBe('0.300000');

    expect(estimateSeedreamListPrice({
      referenceImageCount: 0,
      outputWidth: SEEDREAM_SMALL_IMAGE_MAX_PIXELS + 1,
      outputHeight: 1,
    }).estimatedCostCny).toBe('0.600000');
  });

  it('第二张起每张参考图增加 0.02 元', () => {
    const estimate = estimateSeedreamListPrice({
      referenceImageCount: 4,
      outputWidth: 2_048,
      outputHeight: 2_048,
    });

    expect(estimate).toMatchObject({
      status: 'known',
      additionalReferenceImageCount: 3,
      outputPriceCny: '0.600000',
      referencePriceCny: '0.060000',
      estimatedCostCny: '0.660000',
    });
  });

  it('缺少真实输出尺寸或参考图计数时保持缺证据，不追溯推算成本', () => {
    const estimate = estimateSeedreamListPrice({
      referenceImageCount: null,
      outputWidth: 2_048,
      outputHeight: null,
    });

    expect(estimate).toMatchObject({
      status: 'missing-evidence',
      estimatedCostCny: null,
      missingEvidence: ['reference-image-count', 'output-dimensions'],
    });
  });
});
