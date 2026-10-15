import { describe, expect, it } from 'vitest';
import {
  buildPromptWizardProductionBrief,
} from '../src/domain/promptWizardCreativePlaybook.js';
import {
  assertPromptWizardExecutionPromptIsolation,
  normalizePromptWizardRouteDraftV6,
  omitPromptWizardConfirmedOffer,
  PROMPT_WIZARD_AUDIO_LANGUAGE_ENGLISH_NAMES,
  promptWizardAudioLanguageLock,
  promptWizardBeatRolesV6,
  promptWizardPlanDraftSchema,
  promptWizardRouteClaimBasisTags,
  promptWizardRoutePromptHeader,
  promptWizardTimelineV6,
  renderPromptWizardRoutePlanV6,
  type PromptWizardPlanDraft,
} from '../src/domain/promptWizardPrompt.js';
import {
  assertPromptWizardSoundDesignOnlyVisualClosure,
} from '../src/domain/promptWizardConversionQuality.js';
import {
  reconcilePromptWizardEvidenceGraphForProfileUpdate,
} from '../src/domain/promptWizardEvidenceGraph.js';
import {
  buildPromptWizardRouteSetV6,
  PROMPT_WIZARD_V6_ROUTE_ROLES,
  promptWizardRouteContextsV6,
  promptWizardRoutePlanContextsV6,
} from '../src/domain/promptWizardV6Routes.js';
import {
  buildPromptWizardUseDirectionDraftInput,
  FakePromptWizardProvider,
} from '../src/providers/promptWizardProvider.js';
import {
  planCreativeComparisonBody,
  validatePromptWizardPlanDiversity,
  validatePromptWizardPlanHistory,
} from '../src/domain/promptWizardDiversity.js';
import { makePromptWizardV4Selection } from './promptWizardV4Fixtures.js';

const PROFILE = {
  productName: '折叠式蓝牙耳机',
  category: '消费电子 > 耳机',
  colors: '黑色',
  materials: '',
  structure: '可折叠头梁和椭圆耳罩',
  logo: '右侧耳罩有可见 Logo',
  usage: '佩戴于双耳并按下电源键',
  suggestedAudience: '日常通勤用户',
  suggestedScenarios: '通勤出发前\n办公桌\n周末散步',
  visibleFacts: ['黑色外观', '头梁可折叠'],
  needsConfirmation: ['续航时长待确认'],
  userConfirmedClaims: '',
  consistencyConstraints: '所有镜头保持颜色、Logo 和耳罩结构一致',
};

const BRIEF = {
  targetLanguage: '英语',
  direction: 'ugc',
  marketingGoal: 'conversion',
  creativeIntensity: 'balanced',
  confirmedOffer: '',
} as const;

const CONFIG = {
  model: 'seedance-2.0',
  aspectRatio: '9:16',
  resolution: '720p',
  durationSeconds: 10,
} as const;

const AUDIO_LANGUAGE_CASES = Object.entries(
  PROMPT_WIZARD_AUDIO_LANGUAGE_ENGLISH_NAMES,
) as Array<[
  keyof typeof PROMPT_WIZARD_AUDIO_LANGUAGE_ENGLISH_NAMES,
  typeof PROMPT_WIZARD_AUDIO_LANGUAGE_ENGLISH_NAMES[keyof typeof PROMPT_WIZARD_AUDIO_LANGUAGE_ENGLISH_NAMES],
]>;

function makeEvidenceGraph() {
  return makePromptWizardV4Selection({
    runId: '00000000-0000-4000-8000-000000000201',
    ordinal: 1,
    profile: PROFILE,
    brief: BRIEF,
    config: CONFIG,
  }).evidenceGraph;
}

function makeRouteSet() {
  const evidenceGraph = makeEvidenceGraph();
  return buildPromptWizardRouteSetV6({
    id: '00000000-0000-4000-8000-000000000202',
    runId: '00000000-0000-4000-8000-000000000201',
    runRevision: 1,
    profile: PROFILE,
    evidenceGraph,
    productionBrief: buildPromptWizardProductionBrief(PROFILE),
    createdAt: '2026-08-05T00:00:00.000Z',
  });
}

function makeRouteDraft(evidenceRefs: string[]): PromptWizardPlanDraft {
  const roles: PromptWizardPlanDraft['segments'][number]['role'][] = [
    'hook',
    'proof-resolution',
    'cta',
  ];
  return {
    name: '商品自证方案',
    hook: '直接看商品如何使用。',
    narrative: '围绕可见结构完成一次真实自证。',
    primaryScene: '桌面',
    cameraAndPacing: '稳定近景，按动作落点切换。',
    differenceTags: ['首秒商品', '连续自证'],
    planningReview: {
      targetAudience: '通勤用户',
      surfaceNeed: '看清使用方式',
      realPainPoint: '缺少可见使用证据',
      nonAdEntry: '直接看动作',
      proofPoints: ['头梁可折叠'],
      directionFit: '以连续动作完成自证',
    },
    segments: roles.map((role, index) => ({
      role,
      location: '桌面',
      subject: index === 0 ? '人物手部与商品' : '商品主体',
      shotSize: '近景',
      action: '以单一连续动作展示商品。',
      cameraMovement: '稳定跟随',
      lightingAndRealism: '自然光与真实环境质感',
      voiceover: ['See the product.', 'Watch the action.', 'Tap to shop.'][index]!,
      voiceoverZh: ['看清商品', '看完动作', '点击商品卡'][index]!,
      foley: '真实环境声',
      editingCue: '动作落点切换',
      evidenceRefs: [...evidenceRefs],
      productionNote: '保持外观一致',
    })),
    productionWarnings: [],
  };
}

describe('V6 三方向路线', () => {
  it.each(AUDIO_LANGUAGE_CASES)(
    '%s 口播使用固定英文语言名并锁定逐字朗读、静默中文与无字幕边界',
    (targetLanguage, englishLanguage) => {
      const constraint = promptWizardAudioLanguageLock(targetLanguage);

      expect(constraint).toContain(`所有人声、旁白和对白仅限${targetLanguage}`);
      expect(constraint).toContain(`逐字朗读每段“旁白（${targetLanguage}）”后的原文`);
      expect(constraint).toContain('其余中文是无声制作说明，不得朗读');
      expect(constraint).toContain(`must be ${englishLanguage} only`);
      expect(constraint).toContain(`exact text after each "旁白（${targetLanguage}）" label`);
      expect(constraint).toContain('never translate, paraphrase, or add speech');
      expect(constraint).toContain('No subtitles, captions, titles, text overlays, speech bubbles, or fictional UI');
      expect(constraint).toContain('preserve only brand, model, logo, and printed text already visible on the reference product');
    },
  );

  it('10 秒 V6 执行提示词把英语音频锁放在首部，逐字保留口播并隔离中文译文', () => {
    const routeSet = makeRouteSet();
    const evidenceGraph = makeEvidenceGraph();
    const planContext = promptWizardRoutePlanContextsV6(routeSet)[0]!;
    const sourceDraft = makeRouteDraft(planContext.route.evidenceRefs);
    sourceDraft.segments[0]!.voiceoverZh = '看看这款折叠式蓝牙耳机。';
    const draft = normalizePromptWizardRouteDraftV6({
      draft: sourceDraft,
      planContext,
      evidenceGraph,
      profile: PROFILE,
      config: CONFIG,
    });
    const expectedVoiceovers = draft.segments.map(segment => segment.voiceover);
    const chineseTranslations = draft.segments.map(segment => segment.voiceoverZh);
    const plan = renderPromptWizardRoutePlanV6({
      id: '00000000-0000-4000-8000-000000000298',
      draft,
      planContext,
      evidenceGraph,
      profile: PROFILE,
      targetLanguage: '英语',
      verifiedOffer: '',
      config: CONFIG,
      imageCount: 1,
    });

    expect(plan.prompt.startsWith('【音频语言硬约束 / AUDIO LANGUAGE LOCK】\n\n')).toBe(true);
    expect(plan.prompt.indexOf('【音频语言硬约束 / AUDIO LANGUAGE LOCK】'))
      .toBeLessThan(plan.prompt.indexOf('【商业路线】'));
    expectedVoiceovers.forEach(voiceover => {
      expect(plan.prompt).toContain(`旁白（英语）：${voiceover}`);
    });
    chineseTranslations.forEach(translation => {
      expect(plan.prompt).not.toContain(translation);
    });
    expect(plan.prompt).toContain('No subtitles, captions, titles, text overlays, speech bubbles, or fictional UI');
    expect(plan.prompt).toContain('右侧耳罩有可见 Logo');
    expect(() => assertPromptWizardExecutionPromptIsolation({
      prompt: plan.prompt,
      targetLanguage: '英语',
      shots: plan.shots,
    })).not.toThrow();
  });

  it('5 秒生成快照可完整移除多行真实优惠，同时保留其他用户确认事实', () => {
    const verifiedOffer = '当前满 100 元减 10 元\n并享受包邮';
    const sanitized = omitPromptWizardConfirmedOffer({
      ...PROFILE,
      userConfirmedClaims: `用户确认按键用于开机\n${verifiedOffer}`,
    }, verifiedOffer);

    expect(sanitized.userConfirmedClaims).toBe('用户确认按键用于开机');
    expect(JSON.stringify(sanitized)).not.toContain('当前满 100 元减 10 元');
    expect(JSON.stringify(sanitized)).not.toContain('并享受包邮');
  });

  it('5 秒固定为两镜纯视觉时间轴，Provider 输入不携带语言、口播预算或优惠', () => {
    const routeSet = makeRouteSet();
    const evidenceGraph = makeEvidenceGraph();
    const config = { ...CONFIG, durationSeconds: 5 as const };
    const providerInput = JSON.parse(buildPromptWizardUseDirectionDraftInput({
      profile: { ...PROFILE, userConfirmedClaims: '当前满 100 元减 10 元' },
      evidenceGraph,
      config,
      planContexts: [promptWizardRouteContextsV6(routeSet)[0]!],
      imageCount: 1,
      variationKey: 1,
    }, 0));

    expect(promptWizardTimelineV6(5)).toEqual([[0, 1.2], [1.2, 5]]);
    expect(promptWizardBeatRolesV6(5)).toEqual(['hook', 'proof-resolution']);
    expect(providerInput).toMatchObject({
      requiredSegmentCount: 2,
      requiredShotRoles: ['hook', 'proof-resolution'],
      audioPolicy: {
        audioMode: 'sound-design-only',
        requiredEmptyFields: [],
        rules: expect.arrayContaining([
          expect.stringContaining('紧凑 Wire V2 不得返回 voiceoverSlots 或任何口播字段'),
        ]),
      },
      executionBudget: { maxMajorActionCount: 1 },
    });
    expect(providerInput).not.toHaveProperty('languagePolicy');
    expect(providerInput).not.toHaveProperty('voiceoverTiming');
    expect(providerInput).not.toHaveProperty('voiceoverBudget');
    expect(providerInput).not.toHaveProperty('totalVoiceoverBudget');
    expect(JSON.stringify(providerInput)).not.toContain('当前满 100 元减 10 元');
    expect(JSON.stringify(providerInput)).not.toContain('confirmedOffer');
    expect(JSON.stringify(providerInput)).not.toContain('targetLanguage');
  });

  it('5 秒视觉收口要求商品可见、唯一动作、持续运镜，并拒绝文字或平台 UI', () => {
    const shots = [
      {
        role: 'hook',
        location: '整洁办公桌',
        subject: '@图片1中的耳机快速进入画面',
        shotSize: '中景',
        action: '手指持续按压耳机电源键',
        cameraMovement: '持续跟随手部动作',
        lightingAndRealism: '自然光与真实质感',
        voiceover: '',
        voiceoverZh: '',
        foley: '按键轻响与环境声',
        editingCue: '动作点快切',
      },
      {
        role: 'proof-resolution',
        location: '整洁办公桌',
        subject: '清晰可见的@图片1中的耳机主体',
        shotSize: '产品特写',
        action: '手指持续按压耳机电源键',
        cameraMovement: '持续缓慢推近商品主体',
        lightingAndRealism: '自然光与真实质感',
        voiceover: '',
        voiceoverZh: '',
        foley: '按键轻响与音乐',
        editingCue: '节奏剪辑收尾',
      },
    ];

    expect(() => assertPromptWizardSoundDesignOnlyVisualClosure({ shots })).not.toThrow();
    for (const foley of ['女声旁白讲解商品', '人物对白与环境声', '口播配音叠加音乐']) {
      expect(() => assertPromptWizardSoundDesignOnlyVisualClosure({
        shots: shots.map((shot, index) => index === 0 ? { ...shot, foley } : shot),
      })).toThrowError(expect.objectContaining({
        code: 'PROMPT_WIZARD_SOUND_DESIGN_VISUAL_CLOSURE_INVALID',
        fieldPaths: ['segments[0].foley'],
      }));
    }
    const generatedTextOrUiCases = [
      ['location', '显示价格标签的直播间', 'segments[1].location'],
      ['subject', '商品主体旁浮现字幕', 'segments[1].subject'],
      ['shotSize', '弹出购物车按钮时的产品特写', 'segments[1].shotSize'],
      ['action', '商品旁弹出购买按钮', 'segments[1].action'],
      ['cameraMovement', '持续缓慢推近商品主体并叠加价格文字', 'segments[1].cameraMovement'],
      ['lightingAndRealism', '自然光下显示字幕并保持真实', 'segments[1].lightingAndRealism'],
      ['foley', '环境声，同时用语音提示显示商品卡', 'segments[1].foley'],
      ['editingCue', '节奏剪辑后弹出 TikTok UI', 'segments[1].editingCue'],
    ] as const;
    for (const [field, value, fieldPath] of generatedTextOrUiCases) {
      expect(() => assertPromptWizardSoundDesignOnlyVisualClosure({
        shots: shots.map((shot, index) => index === 1
          ? { ...shot, [field]: value }
          : shot),
      })).toThrowError(expect.objectContaining({
        code: 'PROMPT_WIZARD_SOUND_DESIGN_VISUAL_CLOSURE_INVALID',
        fieldPaths: field === 'action'
          ? expect.arrayContaining([fieldPath])
          : [fieldPath],
      }));
    }
    expect(() => assertPromptWizardSoundDesignOnlyVisualClosure({
      shots: shots.map((shot, index) => index === 1
        ? { ...shot, editingCue: '叠加价格文字并弹出购物车按钮' }
        : shot),
    })).toThrow(/无生成文字或平台 UI/u);
    expect(() => assertPromptWizardSoundDesignOnlyVisualClosure({
      shots: shots.map((shot, index) => index === 1
        ? { ...shot, action: '手拿起耳机' }
        : shot),
    })).toThrow(/延续唯一商品动作/u);
    expect(() => assertPromptWizardSoundDesignOnlyVisualClosure({
      shots: shots.map((shot, index) => index === 1
        ? { ...shot, cameraMovement: '固定镜头保持不动' }
        : shot),
    })).toThrow(/持续运镜/u);
  });

  it('5 秒编译结果无旁白与优惠，只有固定声音说明并以 sound-design-only 交付', () => {
    const routeSet = makeRouteSet();
    const evidenceGraph = makeEvidenceGraph();
    const planContext = promptWizardRoutePlanContextsV6(routeSet)[0]!;
    const config = { ...CONFIG, durationSeconds: 5 as const };
    const draft = makeRouteDraft(planContext.route.evidenceRefs);
    draft.segments = draft.segments.slice(0, 2).map((segment, index) => ({
      ...segment,
      role: index === 0 ? 'hook' : 'proof-resolution',
      subject: index === 0
        ? '@图片1中的折叠式蓝牙耳机进入画面'
        : '清晰可见的@图片1中的折叠式蓝牙耳机主体',
      shotSize: index === 0 ? '中景' : '产品特写',
      action: '手指持续按压耳机电源键',
      cameraMovement: index === 0 ? '持续跟随手部动作' : '持续缓慢推近商品主体',
      voiceover: '',
      voiceoverZh: '',
      editingCue: index === 0 ? '动作点快切' : '节奏剪辑收尾',
    }));
    const normalized = normalizePromptWizardRouteDraftV6({
      draft,
      planContext,
      evidenceGraph,
      profile: PROFILE,
      config,
    });
    const plan = renderPromptWizardRoutePlanV6({
      id: '00000000-0000-4000-8000-000000000299',
      draft: normalized,
      planContext,
      evidenceGraph,
      profile: PROFILE,
      verifiedOffer: '当前满 100 元减 10 元',
      config,
      imageCount: 1,
    });

    expect(plan.audioMode).toBe('sound-design-only');
    expect(plan.shots).toHaveLength(2);
    expect(plan.shots.every(shot => shot.voiceover === '' && shot.voiceoverZh === '')).toBe(true);
    expect(plan.prompt).toContain('无对白、无人声、无旁白；仅使用音乐、环境声和真实商品操作拟音。');
    expect(plan.prompt).not.toContain('【音频语言硬约束 / AUDIO LANGUAGE LOCK】');
    expect(plan.prompt).not.toContain('旁白（');
    expect(plan.prompt).not.toContain('当前满 100 元减 10 元');
    expect(() => assertPromptWizardExecutionPromptIsolation({
      prompt: plan.prompt,
      shots: plan.shots,
    })).not.toThrow();
  });

  it('固定三个商业角色，但标题按商品、场景和购买理由动态生成', () => {
    const routeSet = makeRouteSet();

    expect(routeSet.routes.map(route => route.role)).toEqual(PROMPT_WIZARD_V6_ROUTE_ROLES);
    expect(new Set(routeSet.routes.map(route => route.titleZh)).size).toBe(3);
    routeSet.routes.forEach(route => {
      expect(route.titleZh).toContain(PROFILE.productName);
      expect(route.titleZh).not.toMatch(/^(?:产品自证型|痛点钩子型|场景种草型)$/u);
      expect(route.claimBasisTags).toContainEqual(expect.objectContaining({
        labelZh: '可用于日常聆听音频',
        basis: 'category-inferred',
      }));
    });
  });

  it('三角色使用受控且互异的服务端节奏摘要，换批仍由真实镜头表达通过历史门禁', async () => {
    const routeSet = makeRouteSet();
    const evidenceGraph = makeEvidenceGraph();
    const draftContexts = promptWizardRouteContextsV6(routeSet);
    expect(draftContexts.map(context => context.lockedHookZh)).toEqual(
      routeSet.routes.map(route => route.hookZh),
    );
    const provider = new FakePromptWizardProvider();
    const generate = (variationKey: number) => provider.generateUseDirectionDrafts({
      profile: PROFILE,
      evidenceGraph,
      targetLanguage: '英语',
      confirmedOffer: '',
      config: CONFIG,
      planContexts: draftContexts,
      imageCount: 1,
      variationKey,
    });
    const firstDrafts = (await generate(1)).drafts;
    const refreshDrafts = (await generate(2)).drafts;

    expect(new Set(firstDrafts.map(draft => draft.cameraAndPacing)).size).toBe(3);
    expect(firstDrafts.map(draft => draft.differenceTags)).toEqual([
      ['产品自证', '证据演示'],
      ['痛点钩子', '反差揭晓'],
      ['场景种草', '自然转化'],
    ]);
    const projectForDiversity = (drafts: typeof firstDrafts) => drafts.map(
      (draft, planIndex) => {
        const route = routeSet.routes[planIndex]!;
        const timeline = promptWizardTimelineV6(CONFIG.durationSeconds);
        return {
          id: `00000000-0000-4000-8000-00000000000${planIndex + 1}`,
          deliveryVersion: 6 as const,
          audioMode: 'voiceover' as const,
          role: route.role,
          directionExplanationZh: route.directionExplanationZh,
          audienceZh: route.audienceZh,
          purchaseReasonZh: route.purchaseReasonZh,
          hookZh: route.hookZh,
          selectedScene: route.recommendedScene,
          claimBasisTags: route.claimBasisTags,
          name: draft.name,
          narrative: draft.narrative,
          primaryScene: draft.primaryScene,
          cameraAndPacing: draft.cameraAndPacing,
          differenceTags: draft.differenceTags,
          shots: draft.segments.map((segment, segmentIndex) => ({
            ...segment,
            startSeconds: timeline[segmentIndex]![0],
            endSeconds: timeline[segmentIndex]![1],
          })),
          productionWarnings: draft.productionWarnings,
          prompt: `【商业路线】${route.titleZh}`,
        };
      },
    );
    const firstPlans = projectForDiversity(firstDrafts);
    const refreshPlans = projectForDiversity(refreshDrafts);

    expect(validatePromptWizardPlanDiversity(firstPlans as never)).toEqual([]);
    expect(validatePromptWizardPlanDiversity(refreshPlans as never)).toEqual([]);
    expect(validatePromptWizardPlanHistory(refreshPlans as never, firstPlans as never)).toEqual([]);
    refreshPlans.forEach((plan, index) => {
      expect(planCreativeComparisonBody(plan)).not.toBe(
        planCreativeComparisonBody(firstPlans[index]!),
      );
    });
    const metadataOnlyChange = {
      ...firstPlans[0]!,
      name: '服务端新标题',
      narrative: '服务端新叙事摘要',
      primaryScene: '服务端新场景摘要',
      cameraAndPacing: '服务端新节奏摘要',
      differenceTags: ['服务端标签一', '服务端标签二'],
      hookZh: '服务端新路线钩子',
    };
    expect(planCreativeComparisonBody(metadataOnlyChange)).toBe(
      planCreativeComparisonBody(firstPlans[0]!),
    );
    expect(validatePromptWizardPlanHistory(
      [metadataOnlyChange] as never,
      [firstPlans[0]!] as never,
    )).not.toEqual([]);
    expect(validatePromptWizardPlanHistory(
      [firstPlans[0]!] as never,
      [firstPlans[0]!] as never,
    )).not.toEqual([]);
    const middleShotChange = structuredClone(firstPlans[0]!);
    middleShotChange.shots[1]!.editingCue = '中段改为动作前停顿后直接硬切';
    expect(planCreativeComparisonBody(middleShotChange)).not.toBe(
      planCreativeComparisonBody(firstPlans[0]!),
    );
  });

  it('执行提示词标题不暴露机器角色枚举', () => {
    const route = makeRouteSet().routes[1]!;
    const header = promptWizardRoutePromptHeader(route);

    expect(header).toBe(`【商业路线】${route.titleZh}`);
    expect(header).not.toContain(route.role);
    expect(header).not.toMatch(/proof-conversion|problem-hook|lifestyle-seeding/u);
  });

  it('执行提示词按旁白结构隔离译文，不把合法中文短句碰撞误判为泄漏', () => {
    const valid = {
      prompt: [
        '【商业路线】耳机通勤展示',
        '画面：手指向商品卡，商品主体保持清楚可见。',
        '旁白（英语）：Tap to shop.',
      ].join('\n'),
      targetLanguage: '英语',
      shots: [{ voiceover: 'Tap to shop.', voiceoverZh: '点击商品卡' }],
    };

    expect(() => assertPromptWizardExecutionPromptIsolation(valid)).not.toThrow();
    expect(() => assertPromptWizardExecutionPromptIsolation({
      ...valid,
      prompt: `${valid.prompt}\n【中文口播译文】\n点击商品卡`,
    })).toThrow(/中文口播译文区块/u);
    expect(() => assertPromptWizardExecutionPromptIsolation({
      ...valid,
      prompt: valid.prompt.replace('Tap to shop.', 'Buy it now.'),
    })).toThrow(/口播结构无效/u);
  });

  it('真实优惠追加 user-confirmed 证据标签，留空时不添加', () => {
    const route = makeRouteSet().routes[0]!;
    const verifiedOffer = '当前订单满 100 元减 10 元';
    const evidenceGraph = reconcilePromptWizardEvidenceGraphForProfileUpdate({
      profile: { ...PROFILE, userConfirmedClaims: verifiedOffer },
      previousGraph: makeEvidenceGraph(),
      imageAssetIds: [],
    });

    expect(promptWizardRouteClaimBasisTags({
      route,
      evidenceGraph,
      verifiedOffer,
    })).toContainEqual({
      labelZh: verifiedOffer,
      basis: 'user-confirmed',
      evidenceRefs: [expect.stringMatching(/^confirmed:/u)],
    });
    expect(promptWizardRouteClaimBasisTags({
      route,
      evidenceGraph,
      verifiedOffer: '',
    })).toEqual(route.claimBasisTags);
  });

  it('每次 Provider 返回后仅确定性收口 V6 结构，不改写创意正文与双语口播', () => {
    const evidenceGraph = makeEvidenceGraph();
    const routeSet = makeRouteSet();
    const planContext = promptWizardRoutePlanContextsV6(routeSet)[1]!;
    const voiceovers = ['Keep this line one.', 'Keep this line two.', 'Keep this line three.'];
    const voiceoversZh = ['保留第一句译文', '保留第二句译文', '保留第三句译文'];
    const draft: PromptWizardPlanDraft = {
      name: 'Provider 原始名称',
      hook: 'Provider 原始开场事件，不由结构收口改写。',
      narrative: 'Provider 原始叙事与购买理由保持不变。',
      primaryScene: '错误场景',
      cameraAndPacing: '错误运镜',
      differenceTags: ['伪差异一', '伪差异二'],
      planningReview: {
        targetAudience: 'Provider 原始目标人群',
        surfaceNeed: 'Provider 原始表层需求',
        realPainPoint: 'Provider 原始真实痛点',
        nonAdEntry: 'Provider 原始非广告入口',
        proofPoints: ['Provider 错误证据正文'],
        directionFit: 'Provider 原始方向解释',
      },
      segments: voiceovers.map((voiceover, index) => ({
        role: 'proof',
        location: '错误地点',
        subject: index === 0 ? '人物手部与商品' : '商品主体',
        shotSize: index === 0 ? '近景' : '特写',
        action: '拿起、打开并旋转商品。',
        cameraMovement: '环绕、推近并变焦',
        lightingAndRealism: `Provider 原始光线 ${index + 1}`,
        voiceover,
        voiceoverZh: voiceoversZh[index]!,
        foley: `Provider 原始拟音 ${index + 1}`,
        editingCue: '错误剪辑',
        evidenceRefs: ['不存在的证据'],
        productionNote: `Provider 原始生产说明 ${index + 1}`,
      })),
      productionWarnings: ['Provider 错误生产警告'],
    };

    const normalized = normalizePromptWizardRouteDraftV6({
      draft,
      planContext,
      evidenceGraph,
      profile: PROFILE,
      config: CONFIG,
    });

    expect(normalized.name).toBe(draft.name);
    expect(normalized.hook).toBe(draft.hook);
    expect(normalized.narrative).toBe(draft.narrative);
    expect(normalized.planningReview).toEqual(expect.objectContaining({
      targetAudience: draft.planningReview.targetAudience,
      surfaceNeed: draft.planningReview.surfaceNeed,
      realPainPoint: draft.planningReview.realPainPoint,
      nonAdEntry: draft.planningReview.nonAdEntry,
      directionFit: draft.planningReview.directionFit,
    }));
    expect(normalized.planningReview.proofPoints).toEqual(
      planContext.route.evidenceRefs.map(evidenceId => (
        evidenceGraph.evidences.find(evidence => evidence.id === evidenceId)!.text
      )),
    );
    expect(normalized.primaryScene).toBe(
      `${planContext.route.recommendedScene.title}｜${planContext.route.recommendedScene.environment}`,
    );
    expect(normalized.cameraAndPacing).toBe(draft.cameraAndPacing);
    expect(normalized.differenceTags).toEqual(draft.differenceTags);
    expect(normalized.segments.map(segment => segment.role)).toEqual([
      'hook',
      'proof-resolution',
      'cta',
    ]);
    normalized.segments.forEach((segment, index) => {
      expect(segment.location).toBe(planContext.route.recommendedScene.environment);
      expect(segment.evidenceRefs).toEqual(planContext.route.evidenceRefs);
      expect(segment.voiceover).toBe(voiceovers[index]);
      expect(segment.voiceoverZh).toBe(voiceoversZh[index]);
      expect(segment.cameraMovement).toBe('环绕、推近并变焦');
      expect(segment.editingCue).toBe('错误剪辑');
      expect(segment.lightingAndRealism).toBe(`Provider 原始光线 ${index + 1}`);
      expect(segment.foley).toBe(`Provider 原始拟音 ${index + 1}`);
      expect(segment.productionNote).toBe(`Provider 原始生产说明 ${index + 1}`);
    });
    expect(normalized.segments[0]!.subject).toContain(`@图片1中的${PROFILE.productName}`);
    expect(normalized.productionWarnings).toEqual(draft.productionWarnings);
    expect(normalizePromptWizardRouteDraftV6({
      draft: normalized,
      planContext,
      evidenceGraph,
      profile: PROFILE,
      config: CONFIG,
    })).toEqual(normalized);
  });

  it('V6 商品图锚点不重复，且超长商品名不会破坏 Unicode 主体', () => {
    const evidenceGraph = makeEvidenceGraph();
    const planContext = promptWizardRoutePlanContextsV6(makeRouteSet())[0]!;
    const roles: PromptWizardPlanDraft['segments'][number]['role'][] = [
      'hook',
      'proof-resolution',
      'cta',
    ];
    const baseDraft: PromptWizardPlanDraft = {
      name: '商品自证方案',
      hook: '直接看商品如何使用。',
      narrative: '围绕可见结构完成一次真实自证。',
      primaryScene: '桌面',
      cameraAndPacing: '稳定近景，按动作落点切换。',
      differenceTags: ['首秒商品', '连续自证'],
      planningReview: {
        targetAudience: '通勤用户',
        surfaceNeed: '看清使用方式',
        realPainPoint: '缺少可见使用证据',
        nonAdEntry: '直接看动作',
        proofPoints: ['头梁可折叠'],
        directionFit: '以连续动作完成自证',
      },
      segments: roles.map((role, index) => ({
        role,
        location: '桌面',
        subject: index === 0 ? '@图片1 对应的黑色耳机与 @图片1 的耳罩' : '商品主体',
        shotSize: '近景',
        action: '以单一连续动作展示商品。',
        cameraMovement: '稳定跟随',
        lightingAndRealism: '自然光与真实环境质感',
        voiceover: ['See the product.', 'Watch the action.', 'Tap to shop.'][index]!,
        voiceoverZh: ['看清商品', '看完动作', '点击商品卡'][index]!,
        foley: '真实环境声',
        editingCue: '动作落点切换',
        evidenceRefs: [...planContext.route.evidenceRefs],
        productionNote: '保持外观一致',
      })),
      productionWarnings: [],
    };

    const alreadyAnchored = normalizePromptWizardRouteDraftV6({
      draft: baseDraft,
      planContext,
      evidenceGraph,
      profile: PROFILE,
      config: CONFIG,
    });
    expect(alreadyAnchored.segments[0]!.subject.match(/@图片1(?!\d)/gu)).toHaveLength(1);

    const longNameDraft = structuredClone(baseDraft);
    longNameDraft.segments[0]!.subject = '人物手部与商品';
    const bounded = normalizePromptWizardRouteDraftV6({
      draft: longNameDraft,
      planContext,
      evidenceGraph,
      profile: { ...PROFILE, productName: `${'甲'.repeat(173)}😀` },
      config: CONFIG,
    });
    expect(bounded.segments[0]!.subject).toMatch(/^@图片1中的商品，/u);
    expect(Array.from(bounded.segments[0]!.subject).length).toBeLessThanOrEqual(180);
    expect(bounded.segments[0]!.subject).not.toMatch(/[\uD800-\uDFFF]/u);

    const astralName = normalizePromptWizardRouteDraftV6({
      draft: longNameDraft,
      planContext,
      evidenceGraph,
      profile: { ...PROFILE, productName: '😀'.repeat(35) },
      config: CONFIG,
    });
    expect(astralName.segments[0]!.subject).toContain('😀'.repeat(35));
    expect(astralName.segments[0]!.subject.length).toBeLessThanOrEqual(180);
    expect(astralName.segments[0]!.subject).not.toMatch(/[\uD800-\uDFFF]/u);

    const nameWithImageMarkup = normalizePromptWizardRouteDraftV6({
      draft: longNameDraft,
      planContext,
      evidenceGraph,
      profile: { ...PROFILE, productName: '@图片1耳机' },
      config: CONFIG,
    });
    expect(nameWithImageMarkup.segments[0]!.subject.match(/@图片1(?!\d)/gu))
      .toHaveLength(1);
    expect(nameWithImageMarkup.segments[0]!.subject).toContain('@图片1中的耳机');
  });

  it('V6 首镜动作回退始终闭合到 Draft 上限且不拆 Unicode 代理对', () => {
    const evidenceGraph = makeEvidenceGraph();
    const planContext = promptWizardRoutePlanContextsV6(makeRouteSet())[0]!;
    const draft = makeRouteDraft(planContext.route.evidenceRefs);
    draft.segments[0]!.action = '人物很开心，氛围很有仪式感';
    planContext.route.recommendedScene.mainAction = `${'氛'.repeat(315)}展示`;

    const bounded = normalizePromptWizardRouteDraftV6({
      draft,
      planContext,
      evidenceGraph,
      profile: PROFILE,
      config: CONFIG,
    });
    expect(bounded.segments[0]!.action.length).toBeLessThanOrEqual(300);
    expect(bounded.segments[0]!.action).toMatch(/^手部操作产品并动态呈现/u);
    expect(promptWizardPlanDraftSchema.safeParse(bounded).success).toBe(true);

    planContext.route.recommendedScene.mainAction = `${'😀'.repeat(150)}展示`;
    const unicodeSafe = normalizePromptWizardRouteDraftV6({
      draft,
      planContext,
      evidenceGraph,
      profile: PROFILE,
      config: CONFIG,
    });
    expect(unicodeSafe.segments[0]!.action.length).toBeLessThanOrEqual(300);
    expect(unicodeSafe.segments[0]!.action).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(promptWizardPlanDraftSchema.safeParse(unicodeSafe).success).toBe(true);
  });

  it('V6 按 UTF-16 Schema 上限收口场景，并拒绝不适合 Draft 的证据 id 与正文', () => {
    const evidenceGraph = makeEvidenceGraph();
    const routeSet = makeRouteSet();
    const planContext = promptWizardRoutePlanContextsV6(routeSet)[0]!;
    planContext.route.recommendedScene.environment = '😀'.repeat(100);
    const draft = makeRouteDraft(planContext.route.evidenceRefs);
    const normalized = normalizePromptWizardRouteDraftV6({
      draft,
      planContext,
      evidenceGraph,
      profile: PROFILE,
      config: CONFIG,
    });
    expect(normalized.segments.every(segment => segment.location.length <= 180)).toBe(true);
    expect(normalized.primaryScene.length).toBeLessThanOrEqual(300);
    expect(normalized.primaryScene).not.toMatch(/[\uD800-\uDFFF]/u);

    const graphWithOversizedDraftEvidence = structuredClone(evidenceGraph);
    graphWithOversizedDraftEvidence.evidences.unshift(
      {
        id: 'e'.repeat(81),
        type: 'usage',
        text: '拿起商品完成一次可见使用动作',
        sourceImageAssetIds: [],
        visibleRegion: '',
        status: 'visible',
        confidence: 'high',
        proofActions: ['拿起商品完成一次可见使用动作'],
      },
      {
        id: 'visible:emoji-evidence',
        type: 'usage',
        text: '😀'.repeat(151),
        sourceImageAssetIds: [],
        visibleRegion: '',
        status: 'visible',
        confidence: 'high',
        proofActions: ['拿起商品完成一次可见使用动作'],
      },
    );
    graphWithOversizedDraftEvidence.reliableEvidenceIds.unshift(
      'e'.repeat(81),
      'visible:emoji-evidence',
    );
    const filteredRouteSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000302',
      runId: '00000000-0000-4000-8000-000000000301',
      runRevision: 1,
      profile: PROFILE,
      evidenceGraph: graphWithOversizedDraftEvidence,
      productionBrief: buildPromptWizardProductionBrief(PROFILE),
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    expect(filteredRouteSet.routes.flatMap(route => route.evidenceRefs)).not.toContain('e'.repeat(81));
    expect(filteredRouteSet.routes.flatMap(route => route.evidenceRefs))
      .not.toContain('visible:emoji-evidence');
  });

  it('V6 长商品名、受众和场景仍能生成满足 Route Schema 的三路线', () => {
    const longProfile = {
      ...PROFILE,
      productName: '😀'.repeat(41),
      suggestedAudience: '😀'.repeat(251),
      suggestedScenarios: '😀'.repeat(100),
    };
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000402',
      runId: '00000000-0000-4000-8000-000000000401',
      runRevision: 1,
      profile: longProfile,
      evidenceGraph: makeEvidenceGraph(),
      productionBrief: buildPromptWizardProductionBrief(longProfile),
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    routeSet.routes.forEach(route => {
      expect(route.titleZh.length).toBeLessThanOrEqual(80);
      expect(route.directionExplanationZh.length).toBeLessThanOrEqual(500);
      expect(route.audienceZh.length).toBeLessThanOrEqual(500);
      expect(route.hookZh.length).toBeLessThanOrEqual(300);
      expect(route.proofActionZh.length).toBeLessThanOrEqual(500);
      expect(route.recommendedScene.title.length).toBeLessThanOrEqual(80);
      expect(route.recommendedScene.environment.length).toBeLessThanOrEqual(300);
      expect(route.recommendedScene.mainAction.length).toBeLessThanOrEqual(500);
      expect(JSON.stringify(route)).not.toMatch(/[\uD800-\uDFFF]/u);
    });
  });
});
