import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_MODEL_CAPABILITIES, type VideoConsumptionSetting } from '../../data/consumption';
import { getSeedance25RolloutState } from './ConsumptionSettingsPage';

describe('后台 Seedance 2.5 消费设置', () => {
  it('只有能力表声明的 12 个组合完整时才允许一次性开放', () => {
    const settings = seedance25Settings(false);
    expect(getSeedance25RolloutState(settings)).toEqual({
      total: 12,
      expectedCount: 12,
      availableCount: 0,
      structureComplete: true,
      validPrices: true,
      complete: true,
      allAvailable: false,
    });
    expect(getSeedance25RolloutState(settings.slice(0, 11))).toMatchObject({
      total: 11,
      complete: false,
      allAvailable: false,
    });
  });

  it('区分部分开放与全部开放', () => {
    const partial = seedance25Settings(false).map((item, index) => ({ ...item, available: index < 3 }));
    expect(getSeedance25RolloutState(partial)).toMatchObject({
      availableCount: 3,
      complete: true,
      allAvailable: false,
    });
    expect(getSeedance25RolloutState(seedance25Settings(true))).toMatchObject({
      availableCount: 12,
      complete: true,
      allAvailable: true,
    });
  });

  it('完整组合数量由远端能力表派生并兼容旧 10 档响应', () => {
    const legacyCapability = {
      ...DEFAULT_VIDEO_MODEL_CAPABILITIES['seedance-2.5'],
      durationSeconds: [5, 10, 15, 20, 30] as Array<5 | 10 | 15 | 20 | 30>,
    };
    const legacySettings = seedance25Settings(true).filter(item => item.duration !== '25');

    expect(getSeedance25RolloutState(legacySettings, legacyCapability)).toMatchObject({
      total: 10,
      expectedCount: 10,
      structureComplete: true,
      complete: true,
      allAvailable: true,
    });
  });

  it('普通或参考视频积分为 0 时即使 12 个组合齐全或已开放也不算完整', () => {
    const invalidRegular = seedance25Settings(true);
    invalidRegular[0] = { ...invalidRegular[0]!, credits: 0 };
    expect(getSeedance25RolloutState(invalidRegular)).toMatchObject({
      structureComplete: true,
      validPrices: false,
      complete: false,
      allAvailable: false,
    });

    const invalidReference = seedance25Settings(false);
    invalidReference[11] = { ...invalidReference[11]!, referenceVideoCredits: 0 };
    expect(getSeedance25RolloutState(invalidReference)).toMatchObject({
      structureComplete: true,
      validPrices: false,
      complete: false,
    });
  });

  it('页面提供双档积分、其他模型单组合开关和 2.5 模型级原子开关', async () => {
    const source = await readFile(new URL('./ConsumptionSettingsPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('无参考视频');
    expect(source).toContain('含参考视频');
    expect(source).toContain('一次性开放');
    expect(source).toContain("onConsumptionCreditsChange(item.id, { available: !item.available })");
    expect(source).toContain('item.model !== SEEDANCE_25_MODEL_ID');
    expect(source).toContain('同一事务中开放');
  });
});

function seedance25Settings(available: boolean): VideoConsumptionSetting[] {
  const combinations: Array<[VideoConsumptionSetting['duration'], VideoConsumptionSetting['resolution']]> = [
    ['5', '480p'], ['10', '480p'], ['15', '480p'], ['20', '480p'], ['25', '480p'], ['30', '480p'],
    ['5', '720p'], ['10', '720p'], ['15', '720p'], ['20', '720p'], ['25', '720p'], ['30', '720p'],
  ];
  return combinations.map(([duration, resolution], index) => ({
    id: `setting-${index + 1}`,
    model: 'seedance-2.5',
    modelLabel: 'Seedance 2.5',
    duration,
    resolution,
    credits: index + 1,
    referenceVideoCredits: index + 1,
    available,
  }));
}
