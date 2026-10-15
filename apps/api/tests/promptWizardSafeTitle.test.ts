import { describe, expect, it } from 'vitest';
import { assertPromptWizardProductInputClaims } from '../src/domain/promptWizardPrompt.js';
import {
  buildPromptWizardSafeHook,
  buildPromptWizardSafeTitle,
} from '../src/domain/promptWizardSafeTitle.js';

const STRATEGY = {
  hookType: '真实疑问',
  narrativeArc: '困扰到解决',
  sceneFamily: '通勤现场',
  cameraGrammar: '手持跟拍',
  pacing: '高密度快切',
  proofMechanism: '真实操作过程',
  ctaStyle: '自然收束',
} as const;

const PROFILE = {
  productName: 'MEXICO 运动短袖',
  category: '运动短袖',
  colors: '',
  materials: '纺织面料',
  structure: '圆领、短袖、直筒版型',
  logo: '胸前保留 MEXICO 可见印花',
  usage: '套头穿着',
  suggestedAudience: '体育爱好者',
  suggestedScenarios: '日常休闲与观赛',
  visibleFacts: ['正面有 MEXICO 印花'],
  needsConfirmation: [],
  userConfirmedClaims: '',
  consistencyConstraints: '保持参考图片中的版型与印花位置',
};

describe('提示词向导安全标题', () => {
  it('只使用服务端方向与创意轴标签生成中性中文标题', () => {
    expect(buildPromptWizardSafeTitle({
      direction: 'ugc',
      strategy: STRATEGY,
      planIndex: 0,
    })).toBe('真实 UGC · 真实疑问 · 通勤现场 · 手持跟拍');
  });

  it('标题冲突时按方案索引确定性追加唯一后缀', () => {
    const base = '真实 UGC · 真实疑问 · 通勤现场 · 手持跟拍';
    expect(buildPromptWizardSafeTitle({
      direction: 'ugc',
      strategy: STRATEGY,
      planIndex: 1,
      reservedNames: [base],
    })).toBe(`${base} · 方案二`);
  });
});

describe('提示词向导安全 Hook', () => {
  it('只使用服务端创意轴生成不含产品商业事实的中性切口', () => {
    const hook = buildPromptWizardSafeHook({ strategy: STRATEGY });

    expect(hook).toBe('以真实疑问切入通勤现场，通过手持跟拍呈现人物与产品的真实互动');
    expect(hook).not.toMatch(/价格|折扣|认证|防水|降噪|保证|评价|\d/u);
  });
});

describe('提示词向导产品输入商业事实预检', () => {
  it('识别一致性块中的未经确认商业主张并返回字段路径', () => {
    expect(() => assertPromptWizardProductInputClaims({
      ...PROFILE,
      materials: '100% 纯棉面料',
      usage: '穿着后保证提升效率',
    })).toThrow(expect.objectContaining({
      code: 'PROMPT_WIZARD_PRODUCT_INPUT_CLAIM_INVALID',
      fieldPaths: ['materials', 'usage'],
    }));
  });

  it('用户已确认的同一事实可以进入一致性块', () => {
    expect(() => assertPromptWizardProductInputClaims({
      ...PROFILE,
      materials: '100% 纯棉面料',
      userConfirmedClaims: '材质为 100% 纯棉面料',
    })).not.toThrow();
  });

  it.each(['不防水', '尚未支持防水', '可能防水', 'waterproof is unsupported'])(
    '否定或不确定确认不能授权产品档案中的正向防水主张：%s',
    userConfirmedClaims => {
      expect(() => assertPromptWizardProductInputClaims({
        ...PROFILE,
        materials: '防水材质',
        userConfirmedClaims,
      })).toThrow(expect.objectContaining({
        code: 'PROMPT_WIZARD_PRODUCT_INPUT_CLAIM_INVALID',
        fieldPaths: ['materials'],
      }));
    },
  );
});
