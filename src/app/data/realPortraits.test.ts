import { describe,expect,it } from 'vitest';
import { getPortraitPlanBenefits } from './realPortraits';

describe('套餐真人演员库结构化展示', () => {
  it('从结构化权益生成档案、同时可用和每人图片三项', () => {
    expect(getPortraitPlanBenefits({
      kind: 'main',
      portraitEntitlements: {
        enabled: true,
        profileLimit: 5,
        activeLimit: 3,
        assetsPerActor: 2,
      },
    })).toEqual([
      { key: 'profiles',label: '真人演员档案数',value: '5 人',enabled: true },
      { key: 'active',label: '同时可用人数',value: '3 人',enabled: true },
      { key: 'assets',label: '每人图片数',value: '2 张',enabled: true },
    ]);
  });

  it('企业版 null 档案上限显示为不限', () => {
    expect(getPortraitPlanBenefits({
      kind: 'main',
      portraitEntitlements: {
        enabled: true,
        profileLimit: null,
        activeLimit: 10,
        assetsPerActor: 2,
      },
    })[0]?.value).toBe('不限');
  });

  it('不从 features 文案推断权益', () => {
    const plan = {
      kind: 'main' as const,
      portraitEntitlements: {
        enabled: false,
        profileLimit: 0,
        activeLimit: 0,
        assetsPerActor: 0,
      },
      features: [
        { text: '无限真人演员',enabled: true },
        { text: '同时可用 999 人',enabled: true },
      ],
    };

    expect(getPortraitPlanBenefits(plan).map(item => item.value)).toEqual(['0 人','0 人','0 张']);
  });

  it('加购包即使收到异常非零值也不展示真人权益', () => {
    expect(getPortraitPlanBenefits({
      kind: 'addon',
      portraitEntitlements: {
        enabled: true,
        profileLimit: null,
        activeLimit: 99,
        assetsPerActor: 2,
      },
    })).toEqual([]);
  });
});
