import { describe, expect, it } from 'vitest';
import {
  promptWizardVideoConfigSchema,
  type PromptWizardConceptPreview,
  type PromptWizardEvidenceGraph,
  type PromptWizardCreativeBrief,
  type PromptWizardPlan,
  type PromptWizardProductProfile,
  type PromptWizardVideoConfig,
} from '@lindyson/api-contracts';
import {
  PROMPT_WIZARD_MAX_JACCARD,
  PROMPT_WIZARD_MIN_SIMHASH_DISTANCE,
  creativeBody,
  simHashHammingDistance,
  trigramJaccard,
  validatePromptWizardPlanDiversity,
  validatePromptWizardPlanHistory,
} from '../src/domain/promptWizardDiversity.js';
import {
  LEGACY_PROMPT_WIZARD_PROHIBITION,
  buildPromptWizardConstraintBlock,
  normalizePromptWizardProductionPrompt,
  promptWizardBeatRoles,
  promptWizardTimeline,
  renderPromptWizardPlan as renderPromptWizardPlanV4,
  type PromptWizardPlanDraft,
} from '../src/domain/promptWizardPrompt.js';
import { buildPromptWizardEvidenceGraph } from '../src/domain/promptWizardEvidenceGraph.js';
import { conceptPreviewToAssignment } from '../src/domain/promptWizardConceptDirector.js';
import {
  allocatePromptWizardStrategies,
  countDifferentStrategyAxes,
  strategySignature,
  type PromptWizardStrategy,
} from '../src/domain/promptWizardStrategy.js';
import { PROMPT_WIZARD_PLAN_COUNT } from '../src/domain/promptWizardPlanCount.js';

const PROFILE: PromptWizardProductProfile = {
  productName: '折叠式降噪耳机',
  category: '头戴式耳机',
  colors: '黑色',
  materials: '哑光塑料与软皮耳罩',
  structure: '可折叠头梁、椭圆耳罩',
  logo: '右侧耳罩有可见 Logo',
  usage: '佩戴于双耳并按下电源键',
  suggestedAudience: '通勤用户',
  suggestedScenarios: '通勤、办公与旅行',
  visibleFacts: ['黑色外观', '头梁可以折叠'],
  needsConfirmation: ['续航时长需由用户确认'],
  userConfirmedClaims: '',
  consistencyConstraints: '所有镜头保持颜色、材质和耳罩结构一致',
};

const BRIEF: PromptWizardCreativeBrief = {
  targetLanguage: '英语',
  direction: 'ugc',
  marketingGoal: 'conversion',
  creativeIntensity: 'balanced',
  confirmedOffer: '',
};

const CONFIG: PromptWizardVideoConfig = {
  model: 'seedance-2.0',
  aspectRatio: '9:16',
  resolution: '720p',
  durationSeconds: 15,
};

type RenderPromptWizardPlanInput = Parameters<typeof renderPromptWizardPlanV4>[0];
type RenderPromptWizardPlanTestInput = Omit<
  RenderPromptWizardPlanInput,
  'conceptAssignment' | 'conceptPreview' | 'evidenceGraph'
> & Partial<Pick<
  RenderPromptWizardPlanInput,
  'conceptAssignment' | 'conceptPreview' | 'evidenceGraph'
>>;

/**
 * 领域测试的旧夹具多数只关心渲染边界。统一在这里补全 3.0
 * 权威上下文，避免测试绕过生产中必须的 Concept Set 和 EvidenceGraph。
 */
function renderPromptWizardPlan(input: RenderPromptWizardPlanTestInput) {
  const evidenceGraph = input.evidenceGraph ?? buildPromptWizardEvidenceGraph(
    input.profile,
    input.imageCount,
  );
  const conceptPreview = input.conceptPreview ?? makeConceptPreview(
    input.id,
    input.strategy,
    evidenceGraph,
  );
  const conceptAssignment = input.conceptAssignment
    ?? conceptPreviewToAssignment(conceptPreview, 0);
  return renderPromptWizardPlanV4({
    ...input,
    evidenceGraph,
    conceptPreview,
    conceptAssignment,
  });
}

function makeConceptPreview(
  id: string,
  strategy: PromptWizardStrategy,
  evidenceGraph: PromptWizardEvidenceGraph,
): PromptWizardConceptPreview {
  return {
    id,
    role: 'reliable-conversion',
    title: '通勤真实操作路线',
    firstSecondEvent: '人物从包中拿出耳机并立即展开头梁',
    viewerQuestion: '这副耳机如何更顺手地融入通勤动作？',
    purchaseReason: '可折叠头梁和清楚结构方便真实展示',
    tension: '拥挤通勤中取放和佩戴动作容易被打断',
    productAction: '人物展开头梁后将耳机佩戴到双耳',
    visibleResult: '头梁和耳罩结构在连续动作中清楚可见',
    evidenceIds: [evidenceGraph.reliableEvidenceIds[0] ?? 'visible:1'],
    scene: '早高峰地铁站台',
    perspective: '手机贴身跟拍',
    cameraGrammar: '手部近景跟随动作推近产品细节',
    ctaCallback: '如果你也在意通勤中的取放节奏，可以再看看这些结构细节。',
    requiredAssets: ['产品参考图片'],
    difficulty: 'low',
    risk: 'low',
    direction: 'ugc',
    strategy,
    productionLoad: {
      locationCount: 1,
      personCount: 1,
      majorActionCount: 1,
      propCount: 0,
      cameraMoveCount: 1,
      hasMagicTransition: false,
    },
    rank: 1,
  };
}

describe('提示词向导视频配置契约', () => {
  it.each(['seedance-2.0-fast', 'seedance-2.0-mini'] as const)(
    '%s 禁止使用 1080p',
    model => {
      const result = promptWizardVideoConfigSchema.safeParse({
        ...CONFIG,
        model,
        resolution: '1080p',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(expect.arrayContaining([
          expect.objectContaining({
            path: ['resolution'],
            message: 'Seedance Fast 和 Mini 不支持 1080p',
          }),
        ]));
      }
    },
  );

  it('普通版允许 1080p，且配置边界不接受参考模式字段', () => {
    expect(promptWizardVideoConfigSchema.safeParse({
      ...CONFIG,
      resolution: '1080p',
    }).success).toBe(true);

    expect(promptWizardVideoConfigSchema.safeParse({
      ...CONFIG,
      mode: 'first-last',
    }).success).toBe(false);
  });
});

describe('提示词向导时间轴与渲染边界', () => {
  it('为 5、10、15 秒生成连续且完整覆盖时长的固定时间轴', () => {
    expect(promptWizardTimeline(5)).toEqual([
      [0, 1.2],
      [1.2, 3.5],
      [3.5, 5],
    ]);
    expect(promptWizardTimeline(10)).toEqual([
      [0, 2],
      [2, 5],
      [5, 8],
      [8, 10],
    ]);
    expect(promptWizardTimeline(15)).toEqual([
      [0, 3],
      [3, 7],
      [7, 12],
      [12, 15],
    ]);
  });

  it.each([5, 10, 15] as const)('%s 秒提示词按固定时间轴渲染且不超过 3800 字符', durationSeconds => {
    const strategy = allocatePromptWizardStrategies({
      runId: `timeline-${durationSeconds}`,
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(promptWizardTimeline(durationSeconds).length);
    const plan = renderPromptWizardPlan({
      id: `00000000-0000-4000-8000-0000000000${String(durationSeconds).padStart(2, '0')}`,
      draft,
      strategy,
      profile: PROFILE,
      brief: BRIEF,
      config: { ...CONFIG, durationSeconds },
      imageCount: 1,
    });

    const timeline = promptWizardTimeline(durationSeconds);
    for (const [start, end] of timeline) {
      expect(plan.prompt).toContain(`【${formatSecond(start)}-${formatSecond(end)}s｜`);
    }
    expect(plan.deliveryVersion).toBe(4);
    expect(plan.shots.map(shot => shot.role)).toEqual(promptWizardBeatRoles(durationSeconds));
    expect(plan.prompt.length).toBeLessThanOrEqual(3_800);
  });

  it('镜头数量错误将整个 segments 数组作为真实可修复路径', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'timeline-repair-path',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;

    expect(() => renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000084',
      draft: makeDraft(3),
      strategy,
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    })).toThrow(expect.objectContaining({
      code: 'PROMPT_WIZARD_TIMELINE_INVALID',
      fieldPaths: ['segments'],
    }));
  });

  it('最终提示词超过 3800 字符时整套方案失败', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'over-limit',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;

    expect(() => renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000099',
      draft: makeDraft(4),
      strategy,
      profile: {
        ...PROFILE,
        userConfirmedClaims: '用户确认事实'.repeat(350),
        consistencyConstraints: '产品一致性要求'.repeat(350),
      },
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    })).toThrow(expect.objectContaining({
      code: 'PROMPT_WIZARD_PROMPT_TOO_LONG',
      fieldPaths: ['prompt'],
    }));
  });

  it('Draft 镜头正文导致超长时只允许压缩 segments，不把最终 prompt 交给 Provider', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'over-limit-draft-segments',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(4);
    draft.segments = draft.segments.map(segment => ({
      ...segment,
      location: '真实室内环境'.repeat(25),
      subject: '人物与参考产品'.repeat(22),
      action: '连续展示真实操作过程'.repeat(25),
      cameraMovement: '手持贴身跟拍'.repeat(25),
      lightingAndRealism: '自然光线与手机实拍质感'.repeat(18),
      // 本用例只验证镜头正文导致的生产稿超长；口播保持可在镜头时长内说完，
      // 避免被 3.0 口播时长门禁更早拦截。
      voiceover: segment.voiceover,
      voiceoverZh: '自然展示产品操作。'.repeat(12),
      foley: '真实环境声与操作声'.repeat(18),
      editingCue: '跟随动作节点自然切换'.repeat(16),
    }));

    expect(() => renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000083',
      draft,
      strategy,
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    })).toThrow(expect.objectContaining({
      code: 'PROMPT_WIZARD_PROMPT_TOO_LONG',
      fieldPaths: ['segments'],
    }));
  });

  it('V4 生产提示词不包含视频规格、译文、花字、产品名称/品类行或历史禁止事项尾段', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'production-copy-boundary',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(4);
    draft.segments[0] = {
      ...draft.segments[0]!,
      voiceover: 'Hear every detail.',
      voiceoverZh: '听见每一个细节。',
      foley: '清楚记录耳机转轴的真实开合声',
      productionNote: '后期检查小尺寸 Logo 的边缘是否完整',
    };

    const plan = renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000091',
      draft,
      strategy,
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    });

    expect(plan.prompt).toContain('Hear every detail.');
    expect(plan.prompt).toContain('声音：清楚记录耳机转轴的真实开合声');
    expect(plan.prompt).not.toContain('听见每一个细节。');
    expect(plan.prompt).not.toContain('后期检查小尺寸 Logo 的边缘是否完整');
    expect(plan.prompt).not.toContain(draft.planningReview.realPainPoint);
    expect(plan.prompt).not.toContain('【创意主线】');
    expect(plan.prompt).not.toContain('【视频规格】');
    expect(plan.prompt).not.toMatch(/^产品名称：/mu);
    expect(plan.prompt).not.toMatch(/^品类：/mu);
    expect(plan.prompt).not.toContain('画面文字');
    expect(plan.prompt).not.toContain('后期花字');
    expect(plan.prompt).not.toMatch(/^颜色：/mu);
    expect(plan.prompt).not.toContain('【禁止事项】');
    expect(plan.deliveryVersion).toBe(4);
    expect(plan.shots[0]).toEqual(expect.objectContaining({
      startSeconds: 0,
      endSeconds: 3,
      voiceover: 'Hear every detail.',
      voiceoverZh: '听见每一个细节。',
    }));
    expect('translationSegments' in plan).toBe(false);
    expect('alternativeHooks' in plan).toBe(false);
  });

  it('口播译文不计入 3800 字符生产稿限制，普通话方案不重复返回译文', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'translation-length-boundary',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const translatedDraft = makeDraft(4);
    translatedDraft.segments = translatedDraft.segments.map(segment => ({
      ...segment,
      voiceoverZh: '译'.repeat(300),
    }));
    const translatedPlan = renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000092',
      draft: translatedDraft,
      strategy,
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    });
    expect(translatedPlan.prompt.length).toBeLessThanOrEqual(3_800);
    expect(translatedPlan.prompt).not.toContain('译'.repeat(20));
    expect(translatedPlan.shots).toHaveLength(4);
    expect(translatedPlan.shots.every(shot => shot.voiceoverZh.length === 300)).toBe(true);

    const mandarinDraft = makeDraft(4);
    mandarinDraft.segments = mandarinDraft.segments.map(segment => ({
      ...segment,
      voiceover: segment.voiceoverZh,
      voiceoverZh: '',
    }));
    const mandarinPlan = renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000093',
      draft: mandarinDraft,
      strategy,
      profile: PROFILE,
      brief: { ...BRIEF, targetLanguage: '普通话' },
      config: CONFIG,
      imageCount: 1,
    });
    expect(mandarinPlan.shots.every(shot => shot.voiceoverZh === '')).toBe(true);
    expect('translationSegments' in mandarinPlan).toBe(false);
  });

  it.each([
    ['套头穿着', '正确使用方式：套头穿着。'],
    ['套头穿着。', '正确使用方式：套头穿着。'],
    ['套头穿着。。', '正确使用方式：套头穿着。'],
    ['套头穿着.', '正确使用方式：套头穿着。'],
    ['套头穿着；', '正确使用方式：套头穿着。'],
    ['是否套头穿着？', '正确使用方式：是否套头穿着？'],
    ['请套头穿着！', '正确使用方式：请套头穿着！'],
  ])('动态一致性字段统一句末标点：%s', (usage, expectedLine) => {
    const block = buildPromptWizardConstraintBlock({
      ...PROFILE,
      materials: '哑光塑料。。',
      structure: '可折叠头梁；',
      logo: '右侧耳罩有 Logo.',
      usage,
      consistencyConstraints: '',
      userConfirmedClaims: '',
    }, 1);

    expect(block).toContain('材质：哑光塑料；结构：可折叠头梁；Logo：右侧耳罩有 Logo。');
    expect(block).toContain(expectedLine);
    expect(block).not.toMatch(/(?:。。|\.。|；。)/u);
  });

  it('外语原文存在时必须提供简体中文译文，译文也参与商业事实安全校验', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'translation-validation',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const missingTranslation = makeDraft(4);
    missingTranslation.segments[0] = {
      ...missingTranslation.segments[0]!,
      voiceoverZh: '',
    };
    const baseInput = {
      id: '00000000-0000-4000-8000-000000000094',
      strategy,
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    };

    expect(() => renderPromptWizardPlan({ ...baseInput, draft: missingTranslation }))
      .toThrow(expect.objectContaining({
        code: 'PROMPT_WIZARD_TRANSLATION_INVALID',
        fieldPaths: ['segments[0].voiceoverZh'],
      }));

    const unsafeTranslation = makeDraft(4);
    unsafeTranslation.segments[0] = {
      ...unsafeTranslation.segments[0]!,
      voiceover: 'A quieter commute.',
      voiceoverZh: '支持 40dB 主动降噪。',
    };
    expect(() => renderPromptWizardPlan({ ...baseInput, draft: unsafeTranslation }))
      .toThrow(expect.objectContaining({ code: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM' }));
  });

  it('拒绝英文、西班牙语及少量中文包裹的大段外语方案字段', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'content-language-invalid',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(4);
    draft.name = 'Express Product Challenge';
    draft.hook = 'Reto de tiempo limitado enfocado en detalles';
    draft.narrative = '中文 This narrative remains overwhelmingly in English';
    draft.differenceTags[0] = 'Minimalist studio';
    draft.segments[0] = {
      ...draft.segments[0]!,
      action: 'Vista cenital de la playera sobre un fondo neutro',
    };

    expect(() => renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000090',
      draft,
      strategy,
      profile: PROFILE,
      brief: { ...BRIEF, targetLanguage: '西班牙语' },
      config: CONFIG,
      imageCount: 1,
    })).toThrow(expect.objectContaining({
      code: 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
      fieldPaths: expect.arrayContaining([
        'name',
        'hook',
        'narrative',
        'differenceTags[0]',
        'segments[0].action',
      ]),
    }));
  });

  it('允许 NFKC 归一化缩写、图片引用和产品档案中的品牌型号混排', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'content-language-allowed-tokens',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const profile = {
      ...PROFILE,
      productName: 'iPhone 16 Pro 手机',
      logo: '机身印有 Apple Logo 与 MEXICO 字样',
    };
    const draft = makeDraft(4);
    draft.name = 'iPhone 16 Pro 开箱';
    draft.hook = '真实 ＵＧＣ 展示 MEXICO 印花';
    draft.narrative = '通过 ASMR 细节推进产品开箱';
    draft.primaryScene = 'TikTok 风格桌面';
    draft.cameraAndPacing = 'POV 近景配合 Seedance 运镜';
    draft.differenceTags = ['UGC实拍', 'CTA收束'];
    draft.segments[0] = {
      ...draft.segments[0]!,
      action: '近景展示 @图片1 的 iPhone 16 Pro 与 MEXICO 印花',
      voiceover: '¿Listo para verlo?',
      voiceoverZh: '准备好看看它了吗？',
    };

    const plan = renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000089',
      draft,
      strategy,
      profile,
      brief: { ...BRIEF, targetLanguage: '西班牙语' },
      config: CONFIG,
      imageCount: 1,
    });

    expect(plan.name).toBe('iPhone 16 Pro 开箱');
    expect(plan.prompt).toContain('动作：近景展示 @图片1 的 iPhone 16 Pro 与 MEXICO 印花');
    expect(plan.prompt).toContain('旁白（西班牙语）：¿Listo para verlo?');
    expect(plan.prompt).not.toContain('准备好看看它了吗？');
  });

  it('读取旧方案时只精确删除固定禁止事项尾段', () => {
    expect(normalizePromptWizardProductionPrompt(
      `生产正文\n\n${LEGACY_PROMPT_WIZARD_PROHIBITION}`,
    )).toBe('生产正文');
    expect(normalizePromptWizardProductionPrompt(
      `正文中提到${LEGACY_PROMPT_WIZARD_PROHIBITION}\n但后面还有用户内容`,
    )).toContain(LEGACY_PROMPT_WIZARD_PROHIBITION);
    expect(normalizePromptWizardProductionPrompt('用户自己写的【禁止事项】不得改变外观。'))
      .toBe('用户自己写的【禁止事项】不得改变外观。');
  });

  it('拒绝引用当前全能参考图片集合以外的图片', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'invalid-image-reference',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(4);
    draft.segments[0] = {
      ...draft.segments[0]!,
      action: '近景展示 @图片2 的外观',
    };

    expect(() => renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000098',
      draft,
      strategy,
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    })).toThrow(expect.objectContaining({
      code: 'PROMPT_WIZARD_REFERENCE_INVALID',
      fieldPaths: ['segments[0].action'],
    }));
  });

  it.each(['使用 @图片x 展示外观', '加入 @视频1 的镜头', '跟随 @音频1 的节拍'])(
    '拒绝非当前图片集合的引用：%s',
    visual => {
      const strategy = allocatePromptWizardStrategies({
        runId: `invalid-reference-${visual}`,
        ordinal: 0,
        previousSignatures: [],
      })[0]!;
      const draft = makeDraft(4);
      draft.segments[0] = { ...draft.segments[0]!, action: visual };

      expect(() => renderPromptWizardPlan({
        id: '00000000-0000-4000-8000-000000000096',
        draft,
        strategy,
        profile: PROFILE,
        brief: BRIEF,
        config: CONFIG,
        imageCount: 1,
      })).toThrow(expect.objectContaining({
        code: 'PROMPT_WIZARD_REFERENCE_INVALID',
        fieldPaths: ['segments[0].action'],
      }));
    },
  );

  it.each([
    '首帧固定产品正面',
    '尾 帧展示购买按钮',
    '将第一_帧作为参考',
    'Use the first frame as reference',
    'Use first_frame as reference',
    'Use firstFrame as reference',
    'Ｕｓｅ ｌａｓｔ－ｆｒａｍｅ as reference',
  ])(
    '拒绝全能参考提示词中的首尾帧语义：%s',
    visual => {
      const strategy = allocatePromptWizardStrategies({
        runId: `first-last-${visual}`,
        ordinal: 0,
        previousSignatures: [],
      })[0]!;
      const draft = makeDraft(4);
      draft.segments[0] = { ...draft.segments[0]!, action: visual };

      expect(() => renderPromptWizardPlan({
        id: '00000000-0000-4000-8000-000000000097',
        draft,
        strategy,
        profile: PROFILE,
        brief: BRIEF,
        config: CONFIG,
        imageCount: 1,
      })).toThrow(expect.objectContaining({
        code: 'PROMPT_WIZARD_REFERENCE_MODE_INVALID',
        fieldPaths: ['segments[0].action'],
      }));
    },
  );

  it('允许不涉及参考帧的首尾呼应叙事表达', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'first-last-narrative-safe',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(4);
    draft.segments[0] = { ...draft.segments[0]!, editingCue: '首尾呼应并自然收束' };

    expect(() => renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000098',
      draft,
      strategy,
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    })).not.toThrow();
  });

  it('拒绝未经用户确认的数字卖点，并允许已确认事实', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'commercial-claim-check',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(4);
    draft.segments[0] = {
      ...draft.segments[0]!,
      voiceover: '40dB active noise cancellation',
    };
    const input = {
      id: '00000000-0000-4000-8000-000000000095',
      draft,
      strategy,
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    };

    let rejected: unknown;
    try {
      renderPromptWizardPlan(input);
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toEqual(expect.objectContaining({
      code: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
      fieldPaths: expect.arrayContaining(['segments[0].voiceover']),
    }));
    expect((rejected as Error).message).not.toContain('40dB active noise cancellation');
    expect(() => renderPromptWizardPlan({
      ...input,
      profile: { ...PROFILE, userConfirmedClaims: '40dB 主动降噪' },
    })).not.toThrow();
  });

  it.each([
    ['防水材质', '不防水'],
    ['防水材质', '未实现防水'],
    ['防水材质', '无防水能力'],
    ['防水材质', '不能防水'],
    ['防水材质', '不支持防水'],
    ['防水材质', '尚未实现防水'],
    ['支持 40dB 主动降噪', 'not support 40dB 主动降噪'],
    ['支持 40dB 主动降噪', 'no 40dB 主动降噪 capability'],
    ['支持 40dB 主动降噪', 'without 40dB 主动降噪'],
    ['支持 40dB 主动降噪', 'cannot support 40dB 主动降噪'],
    ['支持 40dB 主动降噪', "can't support 40dB 主动降噪"],
    ['支持 40dB 主动降噪', "doesn't support 40dB 主动降噪"],
    ['支持 40dB 主动降噪', '40dB 主动降噪 is unsupported'],
  ])('否定确认不能授权正向 Draft 主张：“%s” ← “%s”', (hook, confirmedClaims) => {
    const strategy = allocatePromptWizardStrategies({
      runId: `commercial-polarity-${confirmedClaims}`,
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(4);
    draft.hook = hook;

    expect(() => renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000081',
      draft,
      strategy,
      profile: { ...PROFILE, userConfirmedClaims: confirmedClaims },
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    })).toThrow(expect.objectContaining({
      code: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
      fieldPaths: expect.arrayContaining(['hook']),
    }));
  });

  it.each([
    ['防水材质', '可能防水'],
    ['防水材质', '防水能力待确认'],
    ['防水材质', '尚未确认防水'],
    ['支持 40dB 主动降噪', 'possibly 40dB 主动降噪'],
    ['支持 40dB 主动降噪', '40dB 主动降噪 unconfirmed'],
    ['支持 40dB 主动降噪', 'may be 40dB 主动降噪'],
  ])('不确定确认不能授权正向 Draft 主张：“%s” ← “%s”', (hook, confirmedClaims) => {
    const strategy = allocatePromptWizardStrategies({
      runId: `commercial-uncertain-${confirmedClaims}`,
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(4);
    draft.hook = hook;

    expect(() => renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000080',
      draft,
      strategy,
      profile: { ...PROFILE, userConfirmedClaims: confirmedClaims },
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    })).toThrow(expect.objectContaining({
      code: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
      fieldPaths: expect.arrayContaining(['hook']),
    }));
  });

  it.each([
    ['防水材质', '确认防水材质'],
    ['防水材质', '确认材质非常防水'],
    ['防水材质', '确认采用无缝防水设计'],
    ['防水材质', '确认具有非凡防水表现'],
    ['防水材质', '确认不锈钢机身采用防水设计'],
    ['这款材质不防水', '确认这款材质不防水'],
  ])('极性一致且语义相同的事实继续放行：“%s” ← “%s”', (hook, confirmedClaims) => {
    const strategy = allocatePromptWizardStrategies({
      runId: `commercial-same-polarity-${confirmedClaims}`,
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(4);
    draft.hook = hook;

    expect(() => renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000079',
      draft,
      strategy,
      profile: { ...PROFILE, userConfirmedClaims: confirmedClaims },
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    })).not.toThrow();
  });

  it('否定确认不能授权正向数字主张，相同负向数字事实仍可放行', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'commercial-numeric-polarity',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const positiveDraft = makeDraft(4);
    positiveDraft.hook = '支持 40dB 主动降噪';
    const input = {
      id: '00000000-0000-4000-8000-000000000078',
      strategy,
      profile: { ...PROFILE, userConfirmedClaims: '不支持 40dB 主动降噪' },
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    };

    expect(() => renderPromptWizardPlan({ ...input, draft: positiveDraft }))
      .toThrow(expect.objectContaining({
        code: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
        fieldPaths: expect.arrayContaining(['hook']),
      }));

    const negativeDraft = makeDraft(4);
    negativeDraft.hook = '不支持 40dB 主动降噪';
    expect(() => renderPromptWizardPlan({ ...input, draft: negativeDraft })).not.toThrow();
  });

  it('商业事实门禁遍历 Draft 字符串叶子并返回全部安全字段路径', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'commercial-claim-field-paths',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(4);
    draft.hook = '支持 40dB 主动降噪';
    draft.segments[0] = {
      ...draft.segments[0]!,
      voiceover: '30 hours battery life',
      voiceoverZh: '支持 30 小时续航',
    };

    let rejected: unknown;
    try {
      renderPromptWizardPlan({
        id: '00000000-0000-4000-8000-000000000085',
        draft,
        strategy,
        profile: PROFILE,
        brief: BRIEF,
        config: CONFIG,
        imageCount: 1,
      });
    } catch (error) {
      rejected = error;
    }

    expect(rejected).toEqual(expect.objectContaining({
      code: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
      fieldPaths: expect.arrayContaining([
        'hook',
        'segments[0].voiceover',
        'segments[0].voiceoverZh',
      ]),
    }));
    expect((rejected as Error).message).not.toContain('40dB');
    expect((rejected as Error).message).not.toContain('30 hours');
    expect((rejected as Error).message).not.toContain('30 小时');
  });

  it.each([
    ['100% cotton', '100% satisfaction guaranteed'],
    ['100%棉', '100%防水'],
    ['30小时续航', '30小时防褪色'],
  ])('确认“%s”不会放行语义不同但数值相同的“%s”', (confirmedClaims, voiceover) => {
    const strategy = allocatePromptWizardStrategies({
      runId: `commercial-context-${confirmedClaims}`,
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(4);
    draft.segments[0] = { ...draft.segments[0]!, voiceover };

    expect(() => renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000084',
      draft,
      strategy,
      profile: { ...PROFILE, userConfirmedClaims: confirmedClaims },
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    })).toThrow(expect.objectContaining({
      code: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
      fieldPaths: expect.arrayContaining(['segments[0].voiceover']),
    }));
  });

  it.each([
    ['100% cotton', '100% cotton'],
    ['100%棉', '100% cotton'],
    ['30小时续航', '30 hours battery life'],
  ])('相同商业语义仍可跨中英文白名单放行：“%s” → “%s”', (confirmedClaims, voiceover) => {
    const strategy = allocatePromptWizardStrategies({
      runId: `commercial-context-allowed-${confirmedClaims}`,
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(4);
    draft.segments[0] = { ...draft.segments[0]!, voiceover };

    expect(() => renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000083',
      draft,
      strategy,
      profile: { ...PROFILE, userConfirmedClaims: confirmedClaims },
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    })).not.toThrow();
  });

  it('渲染一致性块后再次执行商业事实门禁，同时不误拒用户确认字段本身', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'commercial-final-prompt-check',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const input = {
      id: '00000000-0000-4000-8000-000000000082',
      draft: makeDraft(4),
      strategy,
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    };

    expect(() => renderPromptWizardPlan({
      ...input,
      profile: { ...PROFILE, consistencyConstraints: '产品支持 30 小时防褪色' },
    })).toThrow(expect.objectContaining({
      code: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
      fieldPaths: ['prompt'],
    }));

    expect(() => renderPromptWizardPlan({
      ...input,
      profile: { ...PROFILE, userConfirmedClaims: '100%棉' },
    })).not.toThrow();
  });

  it('拒绝错误镜头职责和无法追溯或待确认的产品自证', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'beat-and-evidence-check',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const input = {
      id: '00000000-0000-4000-8000-000000000087',
      strategy,
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    };

    const wrongBeat = makeDraft(4);
    wrongBeat.segments[1] = { ...wrongBeat.segments[1]!, role: 'resolution' };
    expect(() => renderPromptWizardPlan({ ...input, draft: wrongBeat })).toThrow(
      expect.objectContaining({
        code: 'PROMPT_WIZARD_BEAT_INVALID',
        fieldPaths: ['segments[1].role'],
      }),
    );

    const unknownEvidence = makeDraft(4);
    unknownEvidence.segments[1] = {
      ...unknownEvidence.segments[1]!,
      evidenceRefs: ['needsConfirmation:1'],
    };
    expect(() => renderPromptWizardPlan({ ...input, draft: unknownEvidence })).toThrow(
      expect.objectContaining({
        code: 'PROMPT_WIZARD_EVIDENCE_INVALID',
        fieldPaths: expect.arrayContaining(['segments[1].evidenceRefs[0]']),
      }),
    );

    const pendingProof = makeDraft(4);
    pendingProof.planningReview.proofPoints = ['续航时长需由用户确认'];
    expect(() => renderPromptWizardPlan({ ...input, draft: pendingProof })).toThrow(
      expect.objectContaining({
        code: 'PROMPT_WIZARD_EVIDENCE_INVALID',
        fieldPaths: expect.arrayContaining(['planningReview.proofPoints[0]']),
      }),
    );

    const uncertainMaterial = makeDraft(4);
    uncertainMaterial.planningReview.proofPoints = ['无法仅凭图片确定，可能为聚酯纤维'];
    expect(() => renderPromptWizardPlan({
      ...input,
      draft: uncertainMaterial,
      profile: { ...PROFILE, materials: '无法仅凭图片确定，可能为聚酯纤维' },
    })).toThrow(expect.objectContaining({ code: 'PROMPT_WIZARD_EVIDENCE_INVALID' }));
  });

  it('传入证据图谱后以图谱为 V4 权威事实源，不再被 profile 目录放宽', () => {
    const strategy = allocatePromptWizardStrategies({
      runId: 'authoritative-evidence-graph',
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const imageAssetId = '00000000-0000-4000-8000-000000000088';
    const evidenceGraph = buildPromptWizardEvidenceGraph({
      profile: PROFILE,
      imageAssetIds: [imageAssetId],
      detectedEvidenceSources: [{
        fieldPath: 'visibleFacts[0]',
        imageAssetIds: [imageAssetId],
        visibleRegion: '产品主体',
        confidence: 'high',
        proofActions: ['稳定近景展示黑色外观'],
      }],
    });
    const input = {
      id: '00000000-0000-4000-8000-000000000089',
      strategy,
      profile: PROFILE,
      evidenceGraph,
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    };
    const validDraft = makeDraft(4);
    validDraft.planningReview.proofPoints = ['黑色外观'];
    expect(() => renderPromptWizardPlan({ ...input, draft: validDraft })).not.toThrow();

    const profileOnlyEvidence = makeDraft(4);
    profileOnlyEvidence.planningReview.proofPoints = ['黑色外观'];
    profileOnlyEvidence.segments[1] = {
      ...profileOnlyEvidence.segments[1]!,
      evidenceRefs: ['profile:structure'],
    };
    expect(() => renderPromptWizardPlan({ ...input, draft: profileOnlyEvidence })).toThrow(
      expect.objectContaining({
        code: 'PROMPT_WIZARD_EVIDENCE_INVALID',
        fieldPaths: expect.arrayContaining(['segments[1].evidenceRefs[0]']),
      }),
    );
  });

  it.each([
    '全网都在买这款产品',
    '只剩 3 件，马上售罄',
    '把产品放到明火燃烧中测试',
    '产品会凭空变出并瞬间自我修复',
    '效果碾压竞品',
  ])('拒绝高风险脚本指令：%s', unsafeAction => {
    const strategy = allocatePromptWizardStrategies({
      runId: `unsafe-content-${unsafeAction}`,
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(4);
    draft.segments[0] = { ...draft.segments[0]!, action: unsafeAction };

    const expectedError = unsafeAction.includes('凭空变出')
      ? {
          code: 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED',
          fieldPaths: ['segments'],
        }
      : {
          code: 'PROMPT_WIZARD_UNSAFE_CONTENT',
          fieldPaths: ['segments[0].action'],
        };

    expect(() => renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000086',
      draft,
      strategy,
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    })).toThrow(expect.objectContaining(expectedError));
  });

  it.each([
    ['图片引用', '产品外观需继续参考 @图片2', 'PROMPT_WIZARD_REFERENCE_INVALID'],
    ['首尾帧语义', '尾帧固定展示产品正面', 'PROMPT_WIZARD_REFERENCE_MODE_INVALID'],
    ['高风险内容', '只剩 3 件，马上售罄', 'PROMPT_WIZARD_UNSAFE_CONTENT'],
  ])('最终产品约束中的%s标记为 prompt，不能伪装修复 Draft', (_, constraint, code) => {
    const strategy = allocatePromptWizardStrategies({
      runId: `final-prompt-${code}`,
      ordinal: 0,
      previousSignatures: [],
    })[0]!;

    expect(() => renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000085',
      draft: makeDraft(4),
      strategy,
      profile: { ...PROFILE, consistencyConstraints: constraint },
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    })).toThrow(expect.objectContaining({
      code,
      fieldPaths: ['prompt'],
    }));
  });

  it.each([
    ['UL 认证', ''],
    ['支持快充，续航表现出色', ''],
    ['40dB active noise cancellation', '140dB 主动降噪'],
  ])('拒绝未确认或仅被更长数字片段覆盖的商业事实：%s', (voiceover, confirmedClaims) => {
    const strategy = allocatePromptWizardStrategies({
      runId: `commercial-claim-${voiceover}`,
      ordinal: 0,
      previousSignatures: [],
    })[0]!;
    const draft = makeDraft(4);
    draft.segments[0] = { ...draft.segments[0]!, voiceover };

    expect(() => renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000094',
      draft,
      strategy,
      profile: { ...PROFILE, userConfirmedClaims: confirmedClaims },
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    })).toThrow(expect.objectContaining({
      code: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
    }));
  });
});

describe('提示词向导创意策略与历史隔离', () => {
  it('同批两个方案任意两者至少有四个创意轴不同', () => {
    for (let ordinal = 0; ordinal < 20; ordinal += 1) {
      const strategies = allocatePromptWizardStrategies({
        runId: 'strategy-axis-run',
        ordinal,
        previousSignatures: [],
      });

      expect(new Set(strategies.map(strategySignature)).size).toBe(PROMPT_WIZARD_PLAN_COUNT);
      forEachPair(strategies, (left, right) => {
        expect(countDifferentStrategyAxes(left, right)).toBeGreaterThanOrEqual(4);
      });
    }
  });

  it.each([
    'ugc',
    'problem-solution',
    'unboxing-review',
    'feature-test',
    'pain-comparison',
    'lifestyle',
    'cinematic-brand',
    'asmr-detail',
  ] as const)('%s 在方向内部仍生成两套至少四轴不同的策略', direction => {
    for (let ordinal = 0; ordinal < 8; ordinal += 1) {
      const strategies = allocatePromptWizardStrategies({
        runId: `direction-strategy-${direction}`,
        ordinal,
        previousSignatures: [],
        direction,
      });
      forEachPair(strategies, (left, right) => {
        expect(countDifferentStrategyAxes(left, right)).toBeGreaterThanOrEqual(4);
      });
    }
  });

  it('同一 run 避开已使用签名，新 run 由调用方传入空历史独立开始', () => {
    const firstBatch = allocatePromptWizardStrategies({
      runId: 'same-run',
      ordinal: 0,
      previousSignatures: [],
    });
    const usedSignatures = new Set(firstBatch.map(strategySignature));
    const refreshBatch = allocatePromptWizardStrategies({
      runId: 'same-run',
      ordinal: 1,
      previousSignatures: usedSignatures,
    });

    expect(refreshBatch.every(strategy => !usedSignatures.has(strategySignature(strategy)))).toBe(true);

    const historicalPlans = firstBatch.map((strategy, index) => makePlan(
      strategy,
      `当前任务历史正文 ${index}`,
      index,
    ));
    expect(validatePromptWizardPlanHistory(historicalPlans, historicalPlans))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ reason: '策略签名与当前任务历史批次重复' }),
      ]));

    const newRunBatch = allocatePromptWizardStrategies({
      runId: 'new-run',
      ordinal: 0,
      previousSignatures: [],
    }).map((strategy, index) => makePlan(strategy, `新任务正文 ${index}`, index));
    expect(validatePromptWizardPlanHistory(newRunBatch, [])).toEqual([]);
  });
});

describe('提示词向导文本相似度阈值', () => {
  it('固定使用 Jaccard 0.45 与 SimHash 汉明距离 10 的判定阈值', () => {
    expect(PROMPT_WIZARD_MAX_JACCARD).toBe(0.45);
    expect(PROMPT_WIZARD_MIN_SIMHASH_DISTANCE).toBe(10);

    const left = '地铁通勤中先呈现噪声困扰，再近景展示佩戴耳机的操作。\n【产品一致性硬约束】黑色耳机';
    const right = '地铁通勤中先呈现噪声困扰，再近景展示佩戴耳机的操作。\n【产品一致性硬约束】白色耳机';
    expect(creativeBody(left)).toBe(creativeBody(right));
    expect(trigramJaccard(creativeBody(left), creativeBody(right))).toBe(1);
    expect(simHashHammingDistance(creativeBody(left), creativeBody(right))).toBe(0);
  });

  it('相同创意正文即使产品约束不同，仍同时触发两种相似度拒绝', () => {
    const strategies = allocatePromptWizardStrategies({
      runId: 'similar-copy',
      ordinal: 0,
      previousSignatures: [],
    });
    const plans = strategies.map((strategy, index) => makePlan(
      strategy,
      `完全相同的创意正文。\n【产品一致性硬约束】约束版本 ${index}`,
      index,
    ));
    const issues = validatePromptWizardPlanDiversity(plans);

    expect(issues.some(issue => issue.reason.includes('Jaccard 相似度'))).toBe(true);
    expect(issues.some(issue => issue.reason.includes('SimHash 汉明距离'))).toBe(true);
  });

  it('V4 不依赖备选 Hook，方案摘要与分镜近似时仍被多样性门禁拒绝', () => {
    const strategies = allocatePromptWizardStrategies({
      runId: 'v3-similar-without-hooks',
      ordinal: 0,
      previousSignatures: [],
    });
    const plans = strategies.map((strategy, index) => renderPromptWizardPlan({
      id: `00000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`,
      draft: makeDraft(4),
      strategy,
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      imageCount: 1,
    }));

    expect(plans.every(plan => plan.deliveryVersion === 4 && !('alternativeHooks' in plan))).toBe(true);
    const issues = validatePromptWizardPlanDiversity(plans);
    expect(issues.some(issue => issue.reason.includes('Jaccard 相似度'))).toBe(true);
    expect(issues.some(issue => issue.reason.includes('SimHash 汉明距离'))).toBe(true);
  });
});

function makeDraft(segmentCount: number): PromptWizardPlanDraft {
  const roles = segmentCount === 3
    ? ['hook', 'proof-resolution', 'cta'] as const
    : ['hook', 'proof', 'resolution', 'cta'] as const;
  return {
    name: '通勤反差实测',
    hook: '嘈杂环境突然安静',
    narrative: '从通勤困扰进入真实佩戴和操作展示',
    primaryScene: '早高峰地铁车厢',
    cameraAndPacing: '手持近景配合节拍点切换',
    differenceTags: ['真实通勤', '操作闭环'],
    planningReview: {
      targetAudience: '需要在通勤途中使用耳机的人群',
      surfaceNeed: '希望随身设备容易佩戴和收纳',
      realPainPoint: '拥挤通勤中操作步骤复杂会打断行动节奏',
      nonAdEntry: '从早高峰拿取和佩戴动作自然切入，不先讲卖点',
      proofPoints: ['黑色外观', '头梁可以折叠'],
      directionFit: '以真实人物和连续操作体现真实 UGC 的自然感',
    },
    segments: Array.from({ length: segmentCount }, (_, index) => ({
      role: roles[index]!,
      location: index === 0 ? '早高峰地铁站台' : '连续的地铁通勤空间',
      subject: index === 0 ? '人物手持 @图片1 对应耳机' : '人物与同一耳机',
      shotSize: index === 0 ? '手部近景' : '中近景',
      action: index === 0
        ? '人物从包中拿出耳机并准备佩戴'
        : `第 ${index + 1} 段展示产品真实操作与场景反馈`,
      cameraMovement: '手持贴身跟拍并保持产品结构清楚',
      lightingAndRealism: '使用站台自然环境光，保留轻微手机实拍呼吸感',
      voiceover: `Voiceover ${index + 1}`,
      voiceoverZh: `口播翻译 ${index + 1}`,
      foley: '环境脚步声、布料摩擦声与真实按键声',
      editingCue: '跟随动作节点切换，不跳过关键使用步骤',
      evidenceRefs: roles[index] === 'cta' ? [] : ['visible:1'],
      productionNote: '确保耳机外观与参考图片一致',
    })),
    productionWarnings: ['复杂 Logo 和可读印花必须严格参考原图，不新增文字'],
  };
}

function makePlan(
  strategy: PromptWizardStrategy,
  prompt: string,
  index: number,
): PromptWizardPlan {
  const plan = renderPromptWizardPlan({
    id: `00000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
    draft: makeDraft(4),
    strategy,
    profile: PROFILE,
    brief: BRIEF,
    config: CONFIG,
    imageCount: 1,
  });
  return {
    ...plan,
    prompt,
  };
}

function forEachPair<T>(items: T[], assertion: (left: T, right: T) => void) {
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      assertion(items[leftIndex]!, items[rightIndex]!);
    }
  }
}

function formatSecond(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
