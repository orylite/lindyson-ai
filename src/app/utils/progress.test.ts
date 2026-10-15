import { describe,expect,it } from 'vitest';
import { getSafePercent } from './progress';

describe('进度百分比', () => {
  it('接近满额但未满时不会显示为 100%', () => {
    expect(getSafePercent(39929, 40000)).toBe(99);
  });

  it('总量为 0 时返回 0%', () => {
    expect(getSafePercent(100, 0)).toBe(0);
  });

  it('超出总量时限制为 100%', () => {
    expect(getSafePercent(45000, 40000)).toBe(100);
  });

  it('负值时限制为 0%', () => {
    expect(getSafePercent(-10, 40000)).toBe(0);
  });
});
