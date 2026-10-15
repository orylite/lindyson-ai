import { describe, expect, it } from 'vitest';
import {
  estimateSeedanceCost,
  findSeedancePricingRule,
  hasSeedanceVideoInput,
  listSeedancePricingRules,
  SEEDANCE_PRICE_VERSION,
} from '../src/domain/seedancePricing.js';

describe('Seedance 人民币计价', () => {
  it('保存当前产品分辨率、模型和视频输入的官网刊例价档', () => {
    const actual = listSeedancePricingRules().map(rule => [
      rule.model, rule.resolution, rule.hasVideoInput, rule.unitPricePerMillion,
    ]);
    expect(actual).toEqual([
      ['Seedance 2.5', '480p', false, 70],
      ['Seedance 2.5', '480p', true, 42],
      ['Seedance 2.5', '720p', false, 70],
      ['Seedance 2.5', '720p', true, 42],
      ['Seedance 2.0', '480p', false, 46],
      ['Seedance 2.0', '480p', true, 28],
      ['Seedance 2.0', '720p', false, 46],
      ['Seedance 2.0', '720p', true, 28],
      ['Seedance 2.0', '1080p', false, 51],
      ['Seedance 2.0', '1080p', true, 31],
      ['Seedance 2.0 Fast', '480p', false, 37],
      ['Seedance 2.0 Fast', '480p', true, 22],
      ['Seedance 2.0 Fast', '720p', false, 37],
      ['Seedance 2.0 Fast', '720p', true, 22],
      ['Seedance 2.0 Mini', '480p', false, 23],
      ['Seedance 2.0 Mini', '480p', true, 14],
      ['Seedance 2.0 Mini', '720p', false, 23],
      ['Seedance 2.0 Mini', '720p', true, 14],
    ]);
    expect(findSeedancePricingRule({
      model: 'Seedance 2.0 Fast',
      resolution: '1080p',
      hasVideoInput: false,
    })).toBeNull();
    expect(findSeedancePricingRule({
      model: 'Seedance 2.0',
      resolution: '4k',
      hasVideoInput: false,
    })).toBeNull();
    expect(findSeedancePricingRule({
      model: 'Seedance 2.5',
      resolution: '720p',
      hasVideoInput: true,
    })?.unitPricePerMillion).toBe(42);
    expect(actual.some(([, , , price]) => price === 27.75 || price === 9.2)).toBe(false);
  });

  it('严格用 completion token 对应的 billableTokens 计算六位人民币金额', () => {
    expect(estimateSeedanceCost({
      model: 'Seedance 2.5',
      resolution: '480p',
      hasVideoInput: true,
      billableTokens: 1_000_000,
    })).toMatchObject({
      pricingStatus: 'priced',
      priceVersion: 'volcengine-seedance-2026-08-10',
      unitPricePerMillion: '42.000000',
      estimatedCost: '42.000000',
    });

    expect(estimateSeedanceCost({
      model: 'Seedance 2.0',
      resolution: '720p',
      hasVideoInput: true,
      billableTokens: 605_700,
    })).toEqual({
      pricingStatus: 'priced',
      priceVersion: SEEDANCE_PRICE_VERSION,
      currency: 'CNY',
      resolution: '720p',
      hasVideoInput: true,
      unitPricePerMillion: '28.000000',
      estimatedCost: '16.959600',
    });

    expect(estimateSeedanceCost({
      model: 'Seedance 2.0 Fast',
      resolution: '480p',
      hasVideoInput: false,
      billableTokens: 324_900,
    }).estimatedCost).toBe('12.021300');

    expect(estimateSeedanceCost({
      model: 'Seedance 2.0',
      resolution: '720p',
      hasVideoInput: false,
      billableTokens: 0,
    })).toMatchObject({ pricingStatus: 'priced', estimatedCost: '0.000000' });
  });

  it('只有参考视频类型或 reference_video 角色会进入视频输入价格档', () => {
    expect(hasSeedanceVideoInput({
      referenceAssets: [
        { type: 'image', role: 'reference_image' },
        { type: 'audio', role: 'reference_audio' },
      ],
    })).toBe(false);
    expect(hasSeedanceVideoInput({ referenceAssets: [{ type: 'video' }] })).toBe(true);
    expect(hasSeedanceVideoInput({ referenceAssets: [{ type: 'image', role: 'reference_video' }] })).toBe(true);
    expect(hasSeedanceVideoInput({ referenceImages: [{ type: 'video' }] })).toBe(false);
  });

  it('缺少 completion token 或没有官方价格档时不估算成本', () => {
    expect(estimateSeedanceCost({
      model: 'Seedance 2.0 Mini',
      resolution: '720p',
      hasVideoInput: false,
      billableTokens: null,
    })).toMatchObject({ pricingStatus: 'unpriced', estimatedCost: null, priceVersion: null });
    expect(estimateSeedanceCost({
      model: 'Seedance 2.0 Mini',
      resolution: '1080p',
      hasVideoInput: false,
      billableTokens: 100,
    })).toMatchObject({ pricingStatus: 'unpriced', estimatedCost: null, priceVersion: null });
  });
});
