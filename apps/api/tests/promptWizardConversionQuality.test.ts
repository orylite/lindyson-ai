import { describe, expect, it } from 'vitest';
import type { PromptWizardProductProfile } from '@lindyson/api-contracts';
import {
  assertPromptWizardConversionCta,
  assertPromptWizardMotionDensity,
  assertPromptWizardVoiceoverCoverage,
  promptWizardReadableProductMentionAnchors,
  promptWizardTranscriptNamesProduct,
  type PromptWizardTimedConversionShot,
} from '../src/domain/promptWizardConversionQuality.js';

const PROFILE: PromptWizardProductProfile = {
  productName: '大力神杯造型啤酒杯',
  category: '玻璃饮品杯',
  colors: '',
  materials: '透明玻璃',
  structure: '球形杯口、收束握柄和圆形底座',
  logo: '',
  usage: '倒入饮品后手持饮用',
  suggestedAudience: '观赛和聚会人群',
  suggestedScenarios: '观赛或朋友聚会',
  visibleFacts: ['杯身呈大力神杯轮廓'],
  needsConfirmation: [],
  userConfirmedClaims: '',
  consistencyConstraints: '保持透明玻璃与奖杯轮廓',
};

function englishShots(): PromptWizardTimedConversionShot[] {
  return [
    {
      startSeconds: 0,
      endSeconds: 3,
      role: 'hook',
      location: '观赛桌面',
      subject: '手部与玻璃饮品杯',
      shotSize: '产品近景',
      action: '手部抬起杯子并开始倒入饮品',
      cameraMovement: '镜头沿杯身持续推近',
      lightingAndRealism: '液体流动和气泡上升保持真实',
      voiceover: 'See this trophy glass move now',
      voiceoverZh: '看这款玻璃饮品杯如何让观赛更有仪式感',
      foley: '保留液体流动声',
      editingCue: '在倒入动作点切入杯口近景',
    },
    {
      startSeconds: 3,
      endSeconds: 7,
      role: 'proof',
      location: '观赛桌面',
      subject: '手部与杯身浮雕',
      shotSize: '杯身特写',
      action: '手部继续转动杯子展示奖杯浮雕轮廓',
      cameraMovement: '镜头横移跟随浮雕轮廓',
      lightingAndRealism: '玻璃反光随转动自然移动',
      voiceover: 'This sculpted shape makes every toast feel memorable',
      voiceoverZh: '透明立体奖杯轮廓直接证明举杯时更有辨识度',
      foley: '保留手指接触玻璃的轻响',
      editingCue: '沿转动动作连续切换两个细节',
    },
    {
      startSeconds: 7,
      endSeconds: 12,
      role: 'resolution',
      location: '观赛区',
      subject: '人物手持杯子与观赛桌面',
      shotSize: '人物与产品中景',
      action: '人物举杯走向观赛桌面并与朋友互动',
      cameraMovement: '镜头跟随人物移动后拉远展示场景',
      lightingAndRealism: '杯中泡沫和人物动作保持连续',
      voiceover: 'It fits game night with drinks and atmosphere together',
      voiceoverZh: '观赛时既能盛装饮品又能强化现场氛围',
      foley: '保留脚步和现场环境声',
      editingCue: '在举杯动作点切换到场景全景',
    },
    {
      startSeconds: 12,
      endSeconds: 15,
      role: 'cta',
      location: '观赛桌面',
      subject: '人物手部与商品杯',
      shotSize: '产品中近景',
      action: '人物向镜头举杯并点头',
      cameraMovement: '镜头缓慢横移保持杯型清楚',
      lightingAndRealism: '真实聚会环境光',
      voiceover: 'Tap product card and order',
      voiceoverZh: '现在点击商品卡查看商品并立即下单',
      foley: '保留轻碰杯声',
      editingCue: '碰杯动作发生时快速切换景别',
    },
  ];
}

describe('V5 动态成交与口播密度门禁', () => {
  it('固定字符槽产品锚点优先使用锁定商品名并与权威首提判定保持同源', () => {
    const profile = {
      ...PROFILE,
      productName: '短袖运动上衣',
      category: '服饰',
    };
    const anchors = promptWizardReadableProductMentionAnchors(profile, 7);

    expect(anchors[0]).toBe('短袖运动上衣');
    expect(anchors).toContain('服饰');
    expect(anchors.every(anchor => (
      Array.from(anchor).length >= 2
      && Array.from(anchor).length <= 7
      && anchor.normalize('NFKC') === anchor
      && Array.from(anchor).every(character => /^[\p{L}\p{N}]$/u.test(character))
      && promptWizardTranscriptNamesProduct(anchor, profile)
    ))).toBe(true);
  });

  it('固定字符槽产品锚点拒绝泛化词、NFKC 变化、单字符和非法容量', () => {
    const profile = {
      ...PROFILE,
      productName: 'Ａ',
      category: '产品',
    };

    expect(promptWizardReadableProductMentionAnchors(profile, 7)).toEqual([]);
    expect(promptWizardReadableProductMentionAnchors(PROFILE, 1)).toEqual([]);
    expect(promptWizardReadableProductMentionAnchors(PROFILE, 81)).toEqual([]);
  });

  it('固定字符槽产品锚点不截断长锁定字段，也不接受价格、功效或 CTA 语言', () => {
    expect(promptWizardReadableProductMentionAnchors({
      ...PROFILE,
      productName: '超长锁定商品名称不得截断',
      category: '头戴式耳机',
    }, 7)).toEqual(['头戴式耳机']);
    expect(promptWizardReadableProductMentionAnchors({
      ...PROFILE,
      productName: '特价运动上衣',
      category: '点击购买',
    }, 7)).toEqual([]);
  });

  it.each([
    '立即入手耳机',
    '查看商品耳机',
    '马上选购上衣',
    '免费包邮耳机',
    '购买耳机',
    '下单耳机',
    '点开耳机',
    '加购耳机',
  ])('固定字符槽产品锚点拒绝同源 CTA 或未确认促销风险“%s”', productName => {
    expect(promptWizardReadableProductMentionAnchors({
      ...PROFILE,
      productName,
      category: productName,
    }, 7)).toEqual([]);
  });

  it.each(['静止', '固定机位', '定格', '长时间停留', '保持不动', '连续少切'])(
    '拒绝静态指令“%s”并返回精确镜头路径',
    keyword => {
      const shots = englishShots();
      shots[1]!.cameraMovement = `${keyword}核对杯身`;
      expect(() => assertPromptWizardMotionDensity({ shots, durationSeconds: 15 }))
        .toThrowError(expect.objectContaining({
          code: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
          fieldPaths: expect.arrayContaining(['segments[1].cameraMovement']),
        }));
    },
  );

  it('允许跨镜头重复同一合法产品动作，并让 CTA 通过镜头与剪辑保持动态', () => {
    const shots = englishShots().map((shot, index) => ({
      ...shot,
      action: index === 3 ? '人物向镜头点头' : '手部继续转动杯子展示浮雕轮廓',
    }));
    expect(() => assertPromptWizardMotionDensity({ shots, durationSeconds: 15 })).not.toThrow();
  });

  it('15 秒英语口播达到安全覆盖率、前三秒明确产品且末段直接成交', () => {
    const shots = englishShots();
    expect(() => assertPromptWizardVoiceoverCoverage({
      shots,
      targetLanguage: '英语',
      durationSeconds: 15,
      profile: PROFILE,
    })).not.toThrow();
    expect(() => assertPromptWizardConversionCta({ shots, targetLanguage: '英语' })).not.toThrow();
  });

  it('接受产品名称中自然倒装的核心品类词，避免把“头戴式耳机”误判为未说明产品', () => {
    const shots = englishShots();
    shots[0]!.voiceoverZh = '看看这款头戴式耳机如何快速展开';
    expect(() => assertPromptWizardVoiceoverCoverage({
      shots,
      targetLanguage: '英语',
      durationSeconds: 15,
      profile: {
        ...PROFILE,
        productName: '折叠式头戴耳机',
        category: '消费电子',
      },
    })).not.toThrow();
  });

  it('前三秒确实未说明产品时同时要求修复目标语言口播和中文译文', () => {
    const shots = englishShots();
    shots[0]!.voiceoverZh = '看看这个如何快速展开';
    shots[0]!.voiceover = 'Watch how this opens quickly';
    expect(() => assertPromptWizardVoiceoverCoverage({
      shots,
      targetLanguage: '英语',
      durationSeconds: 15,
      profile: {
        ...PROFILE,
        productName: '折叠式头戴耳机',
        category: '消费电子',
      },
    })).toThrowError(expect.objectContaining({
      code: 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
      message: '前三秒口播必须明确说明当前产品名称或品类。',
      fieldPaths: expect.arrayContaining([
        'segments[0].voiceover',
        'segments[0].voiceoverZh',
      ]),
      details: expect.objectContaining({
        namesProduct: false,
        emptySegmentIndexes: [],
        invalidSegmentIndexes: [],
      }),
    }));
  });

  it('允许口播跨过画面剪辑点连续，但全片总容量仍必须在安全范围', () => {
    const shots = englishShots();
    shots[0]!.voiceover = 'See this trophy shaped glass start moving right now';
    shots[1]!.voiceover = 'Watch the sculpted shape turn';

    expect(() => assertPromptWizardVoiceoverCoverage({
      shots,
      targetLanguage: '英语',
      durationSeconds: 15,
      profile: PROFILE,
    })).not.toThrow();

    shots[1]!.voiceover = 'Watch this sculpted trophy glass shape turn clearly in every single close detail';
    expect(() => assertPromptWizardVoiceoverCoverage({
      shots,
      targetLanguage: '英语',
      durationSeconds: 15,
      profile: PROFILE,
    })).toThrowError(expect.objectContaining({
      code: 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
      fieldPaths: expect.arrayContaining([
        'segments[0].voiceover',
        'segments[0].voiceoverZh',
        'segments[1].voiceover',
        'segments[1].voiceoverZh',
      ]),
    }));
  });

  it('V6 只做语义门禁，超过旧数值上限的完整句不再触发超长错误', () => {
    const shots = englishShots().slice(0, 3).map((shot, index) => ({
      ...shot,
      startSeconds: [0, 2, 7][index]!,
      endSeconds: [2, 7, 10][index]!,
      voiceover: [
        'See this trophy shaped glass move right now',
        'The sculpted shape stays visible in use',
        'Tap the product card to order',
      ][index]!,
    }));

    expect(() => assertPromptWizardVoiceoverCoverage({
      shots,
      targetLanguage: '英语',
      durationSeconds: 10,
      profile: PROFILE,
      v6SemanticOnly: true,
    })).not.toThrow();

    shots[1]!.voiceover = `${'Complete natural product proof sentence '.repeat(5)}with a clear result.`;
    expect(shots[1]!.voiceover.length).toBeLessThan(300);
    expect(() => assertPromptWizardVoiceoverCoverage({
      shots,
      targetLanguage: '英语',
      durationSeconds: 10,
      profile: PROFILE,
      v6SemanticOnly: true,
    })).not.toThrow();
  });

  it('拒绝空段、低信息量口播和不明确的软 CTA', () => {
    const shots = englishShots();
    shots[1]!.voiceover = '';
    shots[2]!.voiceover = 'Nice product';
    expect(() => assertPromptWizardVoiceoverCoverage({
      shots,
      targetLanguage: '英语',
      durationSeconds: 15,
      profile: PROFILE,
    })).toThrowError(expect.objectContaining({
      code: 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
      fieldPaths: expect.arrayContaining(['segments[1].voiceover']),
      details: expect.objectContaining({
        namesProduct: true,
        emptySegmentIndexes: [1],
      }),
    }));

    shots[3]!.voiceoverZh = '喜欢的话可以考虑看看';
    expect(() => assertPromptWizardConversionCta({ shots, targetLanguage: '英语' }))
      .toThrowError(expect.objectContaining({ code: 'PROMPT_WIZARD_CONVERSION_CTA_INVALID' }));

    // 历史 V4/V5 CTA 合同不把泛化的“点击购买”视为商品卡/购物车/商品
    // 的明确成交落点；anchor 专用保守过滤不能反向放宽公开 validator。
    shots[3]!.voiceoverZh = '点击购买';
    expect(() => assertPromptWizardConversionCta({ shots, targetLanguage: '英语' }))
      .toThrowError(expect.objectContaining({ code: 'PROMPT_WIZARD_CONVERSION_CTA_INVALID' }));
  });
});
