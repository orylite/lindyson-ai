import { describe,expect,it } from 'vitest';
import { capacityTone } from './RealPortraitCapacityPage';

describe('后台真人容量预警色', () => {
  it('低占用、八成占用和满额使用不同风险色', () => {
    expect(capacityTone(20, 45)).toBe('green');
    expect(capacityTone(36, 45)).toBe('orange');
    expect(capacityTone(45, 45)).toBe('pink');
  });

  it('无效上限按满额处理，避免误报健康', () => {
    expect(capacityTone(0, 0)).toBe('pink');
  });
});
