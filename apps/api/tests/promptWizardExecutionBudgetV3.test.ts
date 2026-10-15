import { describe, expect, it } from 'vitest';
import type { PromptWizardVideoConfig } from '@lindyson/api-contracts';
import {
  assertPromptWizardExecutionBudget,
  assertPromptWizardShotExecutionBudget,
  assertPromptWizardVoiceoverDuration,
  countPromptWizardVoiceoverUnits,
  estimatePromptWizardShotProductionLoad,
  getPromptWizardExecutionBudget,
  getPromptWizardSegmentVoiceoverBudgets,
  getPromptWizardTotalVoiceoverBudget,
  getPromptWizardVoiceoverWindowDuration,
  validatePromptWizardExecutionBudget,
  validatePromptWizardVoiceoverDuration,
} from '../src/domain/promptWizardExecutionBudget.js';

describe('Prompt Wizard 3.0 Seedance 执行预算', () => {
  it.each([
    ['seedance-2.0', 5, 1, 1, 2],
    ['seedance-2.0', 10, 2, 1, 3],
    ['seedance-2.0', 15, 2, 2, 4],
    ['seedance-2.0-fast', 5, 1, 1, 2],
    ['seedance-2.0-fast', 10, 2, 1, 3],
    ['seedance-2.0-fast', 15, 2, 1, 4],
    ['seedance-2.0-mini', 5, 1, 1, 1],
    ['seedance-2.0-mini', 10, 1, 1, 2],
    ['seedance-2.0-mini', 15, 1, 1, 3],
  ] as const)(
    '%s %ss 返回明确的地点、人物和主要动作上限',
    (model, durationSeconds, locations, people, actions) => {
      expect(getPromptWizardExecutionBudget({ model, durationSeconds })).toEqual(expect.objectContaining({
        maxLocationCount: locations,
        maxPersonCount: people,
        maxMajorActionCount: actions,
        allowMagicTransition: false,
      }));
    },
  );

  it('按字段路径返回所有超预算问题，便于只修复单条路线', () => {
    const issues = validatePromptWizardExecutionBudget({
      productionLoad: {
        locationCount: 2,
        personCount: 2,
        majorActionCount: 3,
        propCount: 2,
        cameraMoveCount: 2,
        hasMagicTransition: true,
      },
      config: { model: 'seedance-2.0-mini', durationSeconds: 5 },
      fieldPathPrefix: 'concepts.3',
    });

    expect(issues.map(issue => issue.fieldPath)).toEqual([
      'concepts.3.productionLoad.locationCount',
      'concepts.3.productionLoad.personCount',
      'concepts.3.productionLoad.majorActionCount',
      'concepts.3.productionLoad.propCount',
      'concepts.3.productionLoad.cameraMoveCount',
      'concepts.3.productionLoad.hasMagicTransition',
    ]);
    expect(() => assertPromptWizardExecutionBudget({
      productionLoad: {
        locationCount: 2,
        personCount: 0,
        majorActionCount: 1,
        propCount: 0,
        cameraMoveCount: 1,
        hasMagicTransition: false,
      },
      config: { model: 'seedance-2.0-mini', durationSeconds: 5 },
    })).toThrowError(expect.objectContaining({
      code: 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED',
    }));
  });

  it('边界内的生产负载正常通过', () => {
    expect(validatePromptWizardExecutionBudget({
      productionLoad: {
        locationCount: 1,
        personCount: 1,
        majorActionCount: 3,
        propCount: 2,
        cameraMoveCount: 3,
        hasMagicTransition: false,
      },
      config: { model: 'seedance-2.0-mini', durationSeconds: 15 },
    })).toEqual([]);
  });

  it('从扩写后的实际分镜重算复杂度，不采用概念阶段自报的 productionLoad', () => {
    const shots = [
      {
        role: 'hook',
        location: '卧室衣柜前',
        subject: '主角与朋友、手机及包装盒',
        action: '主角拿起产品并打开包装盒',
        cameraMovement: '快速推进后环绕产品',
        productionNote: '需要手机和包装盒',
      },
      {
        role: 'proof',
        location: '办公室工位',
        subject: '两人和产品',
        action: '将产品连接电脑后旋转关键部件',
        cameraMovement: '跟拍动作后拉远',
        productionNote: '需要电脑',
      },
      {
        role: 'cta',
        location: '办公室工位',
        subject: '主角和产品',
        action: '主角指向产品自然收束',
        cameraMovement: '固定机位',
        productionNote: '',
      },
    ];
    const estimated = estimatePromptWizardShotProductionLoad(shots);

    expect(estimated.productionLoad).toMatchObject({
      locationCount: 2,
      personCount: 2,
      majorActionCount: 4,
      propCount: 3,
      cameraMoveCount: 4,
      hasMagicTransition: false,
    });
    expect(() => assertPromptWizardShotExecutionBudget({
      shots,
      config: { model: 'seedance-2.0-mini', durationSeconds: 10 },
    })).toThrowError(expect.objectContaining({
      code: 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED',
      fieldPaths: ['segments'],
    }));
  });

  it('分镜中的魔法变化即使概念阶段未申报也会被拒绝', () => {
    expect(() => assertPromptWizardShotExecutionBudget({
      shots: [{
        role: 'hook',
        location: '桌面',
        subject: '产品',
        action: '产品凭空出现并自动变成另一种结构',
        cameraMovement: '固定机位',
        productionNote: '',
      }],
      config: { model: 'seedance-2.0', durationSeconds: 5 },
    })).toThrowError(expect.objectContaining({
      code: 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED',
      fieldPaths: ['segments'],
    }));
  });
});

describe('Prompt Wizard V4/V5 历史口播时长门禁', () => {
  it('泰语组合标记与 Wire V2 Schema 一致按 Unicode 码点计入字符预算', () => {
    const thaiWithCombiningMark = 'ก้';

    expect(Array.from(thaiWithCombiningMark)).toHaveLength(2);
    expect(countPromptWizardVoiceoverUnits(thaiWithCombiningMark, 'characters')).toBe(2);
    expect(validatePromptWizardVoiceoverDuration({
      voiceover: thaiWithCombiningMark,
      targetLanguage: '泰语',
      durationSeconds: 1,
    })).toMatchObject({
      unit: 'characters',
      actualUnits: 2,
    });
  });

  it.each([
    ['英语', 5, [1.2, 2.3, 1.5]],
    ['西班牙语', 10, [2, 3, 3, 2]],
    ['普通话', 15, [3, 4, 5, 3]],
  ] as const)('%s %s 秒分段预算与全片预算严格一致', (targetLanguage, durationSeconds, segmentDurations) => {
    const segmentBudgets = getPromptWizardSegmentVoiceoverBudgets({
      targetLanguage,
      durationSeconds,
      segmentDurations: [...segmentDurations],
    });
    const totalBudget = getPromptWizardTotalVoiceoverBudget({
      targetLanguage,
      durationSeconds,
    });

    expect(segmentBudgets.reduce((sum, item) => sum + item.minUnits, 0)).toBe(totalBudget.minUnits);
    expect(segmentBudgets.reduce((sum, item) => sum + item.targetUnits, 0)).toBe(totalBudget.targetUnits);
    expect(segmentBudgets.reduce((sum, item) => sum + item.maxUnits, 0)).toBe(totalBudget.maxUnits);
    expect(segmentBudgets.every(item => (
      item.minUnits >= 1
      && item.minUnits <= item.targetUnits
      && item.targetUnits <= item.maxUnits
      && item.unit === totalBudget.unit
    ))).toBe(true);
  });

  it('5 秒英语按画面时长稳定分配口播容量', () => {
    expect(getPromptWizardSegmentVoiceoverBudgets({
      targetLanguage: '英语',
      durationSeconds: 5,
      segmentDurations: [1.2, 2.3, 1.5],
    })).toEqual([
      { unit: 'words', minUnits: 2, targetUnits: 2, maxUnits: 3 },
      { unit: 'words', minUnits: 4, targetUnits: 5, maxUnits: 5 },
      { unit: 'words', minUnits: 2, targetUnits: 3, maxUnits: 4 },
    ]);
  });

  it.each([
    ['英语', 'This foldable headset fits neatly inside my small commute bag'],
    ['西班牙语', 'Este auricular plegable cabe fácilmente en mi bolso diario'],
    ['葡萄牙语', 'Este fone dobrável cabe facilmente na minha bolsa diária'],
    ['法语', 'Ce casque pliable tient facilement dans mon sac quotidien'],
    ['印尼语', 'Headset lipat ini mudah masuk ke tas harian saya'],
    ['意大利语', 'Queste cuffie pieghevoli entrano facilmente nella mia borsa'],
    ['马来语', 'Fon kepala lipat ini mudah dimuatkan dalam beg harian'],
    ['越南语', 'Tai nghe gập này dễ dàng nằm gọn trong túi'],
    ['德语', 'Dieser faltbare Kopfhörer passt leicht in meine tägliche Tasche'],
    ['荷兰语', 'Deze opvouwbare koptelefoon past makkelijk in mijn dagelijkse tas'],
    ['波兰语', 'Te składane słuchawki łatwo mieszczą się w codziennej torbie'],
    ['普通话', '折叠后轻松放进通勤包'],
    ['日语', '折りたたんで通勤バッグに収納'],
    ['泰语', 'พับเก็บลงกระเป๋าได้ง่าย'],
  ])('%s 短口播可在 5 秒镜头中自然说完', (targetLanguage, voiceover) => {
    expect(validatePromptWizardVoiceoverDuration({
      voiceover,
      targetLanguage,
      durationSeconds: 5,
    }).valid).toBe(true);
  });

  it('旧版过长口播仍抛出稳定错误码和精确字段路径', () => {
    expect(() => assertPromptWizardVoiceoverDuration({
      voiceover: 'one two three four five six seven eight nine',
      targetLanguage: '英语',
      durationSeconds: 3,
      fieldPath: 'shots.2.voiceover',
    })).toThrowError(expect.objectContaining({
      code: 'PROMPT_WIZARD_VOICEOVER_TOO_LONG',
      fieldPaths: ['shots.2.voiceover'],
    }));
  });

  it('自然标点不计入口播单位，数字和品牌名正常计数', () => {
    expect(countPromptWizardVoiceoverUnits('一，二！Seedance 2.0。', 'characters')).toBe(12);
    expect(countPromptWizardVoiceoverUnits('Buy Lindyson 2.0 now!', 'words')).toBe(4);
    expect(countPromptWizardVoiceoverUnits('，。！？', 'characters')).toBe(0);
  });

  it('10 秒前三个内容段可跨相邻剪辑点，CTA 仍使用末段时长', () => {
    expect(getPromptWizardVoiceoverWindowDuration({
      segmentIndex: 0,
      startSeconds: 0,
      endSeconds: 2,
      totalDurationSeconds: 10,
    })).toBe(4);
    expect(getPromptWizardVoiceoverWindowDuration({
      segmentIndex: 1,
      startSeconds: 2,
      endSeconds: 5,
      totalDurationSeconds: 10,
    })).toBe(4);
    expect(getPromptWizardVoiceoverWindowDuration({
      segmentIndex: 2,
      startSeconds: 5,
      endSeconds: 8,
      totalDurationSeconds: 10,
    })).toBe(4);
    expect(getPromptWizardVoiceoverWindowDuration({
      segmentIndex: 3,
      startSeconds: 8,
      endSeconds: 10,
      totalDurationSeconds: 10,
    })).toBe(2);
    expect(getPromptWizardVoiceoverWindowDuration({
      segmentIndex: 0,
      startSeconds: 0,
      endSeconds: 3,
      totalDurationSeconds: 15,
    })).toBe(3);
  });

  it('视频配置类型仍覆盖正式三种模型和三种时长', () => {
    const configs: Array<Pick<PromptWizardVideoConfig, 'model' | 'durationSeconds'>> = [
      { model: 'seedance-2.0', durationSeconds: 5 },
      { model: 'seedance-2.0-fast', durationSeconds: 10 },
      { model: 'seedance-2.0-mini', durationSeconds: 15 },
    ];
    expect(configs.map(getPromptWizardExecutionBudget)).toHaveLength(3);
  });
});
