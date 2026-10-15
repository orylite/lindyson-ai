import { describe, expect, it } from 'vitest';
import { imageTaskCostLabel, knownImageCostLabel } from './ImageCostView';

describe('图片成本展示', () => {
  it('缺少不可变价格证据时保持未知，不推成零成本', () => {
    expect(knownImageCostLabel(null, 'unavailable')).toBe('未知 / 缺证据');
    expect(imageTaskCostLabel({ estimatedCostCny: null, evidenceStatus: 'missing-evidence' }))
      .toBe('未知 / 缺证据');
  });

  it('部分证据只展示已知小计并明确仍有缺口', () => {
    expect(knownImageCostLabel('0.320000', 'partial')).toBe('¥0.320000 已知小计 + 缺证据');
    expect(imageTaskCostLabel({ estimatedCostCny: '0.320000', evidenceStatus: 'missing-evidence' }))
      .toBe('¥0.320000 已知小计 + 缺证据');
  });
});
