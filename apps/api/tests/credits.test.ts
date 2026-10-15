import { describe, expect, it } from 'vitest';
import { bucketForUsage } from '../src/domain/credits.js';

describe('积分账本规则', () => {
  it('能识别混合积分来源', () => {
    expect(bucketForUsage(10, 5)).toBe('mixed');
    expect(bucketForUsage(10, 0)).toBe('main');
    expect(bucketForUsage(0, 5)).toBe('addon');
  });
});
