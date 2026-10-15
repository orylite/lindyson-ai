import { describe, expect, it } from 'vitest';
import {
  TK_PROMPT_HOOK_IDS,
  TK_PROMPT_HOOK_PATTERNS,
  TK_PROMPT_LANGUAGES,
  TK_PROMPT_LIVE_PRESENTER_BOUNDARY,
  TK_PROMPT_NON_LIVE_PERSON_BOUNDARY,
  TK_PROMPT_STYLES,
  TK_PROMPT_VISUAL_TEXT_BOUNDARY,
  TK_PROMPT_VIDEO_MODES,
  compileTkPromptCandidateBeats,
  deriveTkPromptEvidenceFlags,
  eligibleTkPromptHookIds,
  isTkPromptChineseNarrative,
  isTkPromptTargetLanguageText,
  normalizeTkPromptCandidateBeatInformation,
  normalizeTkPromptCandidateCameraMovements,
  normalizeTkPromptCandidateFreeText,
  normalizeTkPromptCandidateStructure,
  normalizeTkPromptStrategyPromotions,
  normalizeTkPromptStrategyAppearanceMode,
  normalizeTkPromptStrategyDiversity,
  renderTkPromptExecutionPrompt,
  tkPromptEngineRequestSchema,
  validateTkPromptOptionCandidate,
  validateTkPromptFinalExecutionPrompt,
  validateTkPromptStrategySet,
  type TkPromptFactPack,
  type TkPromptOptionCandidate,
  type TkPromptStrategy,
} from '../src/domain/tkPromptEngine.js';

const ids = {
  image: '00000000-0000-4000-8000-000000000101',
  image2: '00000000-0000-4000-8000-000000000103',
  image3: '00000000-0000-4000-8000-000000000104',
};

describe('TK Prompt Engine 1.0 冻结合同', () => {
  it('精确冻结 10 个 Style、16 个 Hook 和 3 个 Video Mode', () => {
    expect(TK_PROMPT_STYLES).toEqual([
      'drama',
      'reversal',
      'interview',
      'story',
      'unboxing',
      'product_pov',
      'comparison',
      'talking_head',
      'pain_point',
      'scene',
    ]);
    expect(TK_PROMPT_HOOK_IDS).toEqual([
      'visual_shock',
      'suspense_question',
      'contrast',
      'pain_strike',
      'before_after',
      'sound_hook',
      'challenge_doubt',
      'identity',
      'number_benefit',
      'unexpected',
      'confession',
      'honest_flaw',
      'elimination_haul',
      'cost_math',
      'comment_reply',
      'hype_confirm',
    ]);
    expect(TK_PROMPT_HOOK_PATTERNS).toHaveLength(16);
    expect(new Set(TK_PROMPT_HOOK_PATTERNS.map(item => item.internalExample)).size).toBe(16);
    expect(TK_PROMPT_VIDEO_MODES).toEqual([
      'product_closeup',
      'scene_demo',
      'live_presenter',
    ]);
    expect(TK_PROMPT_VIDEO_MODES).not.toContain('graphic_montage');
  });

  it('5 秒只允许纯声音且图片硬上限是 9', () => {
    expect(tkPromptEngineRequestSchema.safeParse({
      ...baseRequest(),
      durationSeconds: 5,
      spokenLanguage: null,
      imageAssetIds: [ids.image, ids.image2],
    }).success).toBe(true);
    expect(tkPromptEngineRequestSchema.safeParse({
      ...baseRequest(),
      durationSeconds: 5,
      spokenLanguage: '英语',
    }).success).toBe(false);
    expect(tkPromptEngineRequestSchema.safeParse({
      ...baseRequest(),
      durationSeconds: 5,
      spokenLanguage: null,
      verifiedOffer: { condition: '折扣10%' },
    }).success).toBe(false);
    expect(tkPromptEngineRequestSchema.safeParse({
      ...baseRequest(),
      imageAssetIds: Array.from({ length: 10 }, (_, index) => (
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      )),
    }).success).toBe(false);
    expect(tkPromptEngineRequestSchema.parse(baseRequest()))
      .not.toHaveProperty('authorizedActorAssetId');
    expect(tkPromptEngineRequestSchema.safeParse({
      ...baseRequest(),
      authorizedActorAssetId: '00000000-0000-4000-8000-000000000102',
    }).success).toBe(false);
  });

  it('Hook 资格在策略前进行硬排除', () => {
    const eligible = eligibleTkPromptHookIds({
      durationSeconds: 5,
      evidenceFlags: evidenceFlags(),
    });
    expect(eligible).toContain('visual_shock');
    expect(eligible).toContain('sound_hook');
    expect(eligible).not.toContain('suspense_question');
    expect(eligible).not.toContain('before_after');
    expect(eligible).not.toContain('number_benefit');
    expect(eligible).not.toContain('comment_reply');
  });

  it('场景/素材自由文本不能升级为 Hook 事实证据', () => {
    const flags = deriveTkPromptEvidenceFlags({
      userConfirmedFacts: [],
      verifiedOffer: '',
      availableScenes: ['前后对比场景'],
      availableAssets: ['真实评论、竞品和未拆封包装'],
    });
    expect(flags).toEqual(evidenceFlags());
    expect(eligibleTkPromptHookIds({
      durationSeconds: 10,
      evidenceFlags: flags,
    })).not.toContain('comment_reply');

    expect(deriveTkPromptEvidenceFlags({
      userConfirmedFacts: ['用户确认这是真实评论问题'],
      verifiedOffer: '已验证折扣 10%',
    })).toMatchObject({ realComment: true, numeric: true });
  });

  it('Hook 需要的证据事实必须与当前策略 allowedFactIds 相交', () => {
    const factPack = makeFactPack({
      facts: [...makeFactPack().facts, {
        factId: 'confirmed-003',
        status: 'user-confirmed',
        text: '用户已提供真实评论原文问题',
        sourceImageIds: [],
      }],
    });
    const strategies = makeStrategies();
    strategies[0] = { ...strategies[0]!, hookPatternId: 'comment_reply' };
    expect(() => validateTkPromptStrategySet({
      strategySet: { strategies },
      factPack,
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), realComment: true, sealedPackage: true },
    })).toThrow(/证据事实/u);
    strategies[0] = {
      ...strategies[0]!,
      allowedFactIds: [...strategies[0]!.allowedFactIds, 'confirmed-003'],
    };
    expect(validateTkPromptStrategySet({
      strategySet: { strategies },
      factPack,
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), realComment: true, sealedPackage: true },
    })).toHaveLength(3);
  });

  it('三案每对六维差异至少四项，live_presenter 无需演员素材即可参与', () => {
    const factPack = makeFactPack();
    const valid = makeStrategies();
    expect(validateTkPromptStrategySet({
      strategySet: { strategies: valid },
      factPack,
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toHaveLength(3);

    expect(validateTkPromptStrategySet({
      strategySet: {
        strategies: valid.map((strategy, index) => index === 0
          ? { ...strategy, styleForm: 'presenter', style: 'talking_head', videoMode: 'live_presenter' }
          : strategy),
      },
      factPack,
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })[0]).toMatchObject({ style: 'talking_head', videoMode: 'live_presenter' });

    expect(validateTkPromptStrategySet({
      strategySet: {
        strategies: valid.map((strategy, index) => index === 0
          ? { ...strategy, styleForm: 'drama', style: 'drama', videoMode: 'scene_demo' }
          : strategy),
      },
      factPack,
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })[0]).toMatchObject({ style: 'drama', videoMode: 'scene_demo' });
  });

  it.each(TK_PROMPT_LANGUAGES)('%s 的英文漂移会在生产侧收口为所选目标语言', language => {
    const candidate = makeCandidate(10);
    const driftText = language === '英语'
      ? 'Mira los detalles del producto en acción.'
      : 'See the product details in action.';
    candidate.beats.forEach(beat => {
      beat.voiceoverTarget = driftText;
      beat.voiceoverZh = language === '普通话' ? '' : '查看商品细节与操作方式。';
    });
    const factPack = makeFactPack({
      spokenLanguage: language,
    });
    const normalized = normalizeTkPromptCandidateFreeText({
      candidate,
      strategy: makeStrategies()[0]!,
      factPack,
      durationSeconds: 10,
      spokenLanguage: language,
    });
    const allowed = [factPack.productName, factPack.category, ...factPack.facts.map(fact => fact.text)];
    expect(normalized.beats.every(beat => (
      isTkPromptTargetLanguageText(beat.voiceoverTarget, language, allowed)
    ))).toBe(true);

  });

  it('服务端确定性锁定三策略槽多样性，保留 Provider Hook 与出镜模式', () => {
    const collapsed = makeStrategies().map(strategy => ({
      ...strategy,
      styleForm: 'scene' as const,
      style: 'scene' as const,
      firstFrameId: 'pain_reveal' as const,
      buyingMotivationId: 'problem_relief' as const,
      proofMethodId: 'visible_operation' as const,
      videoMode: 'live_presenter' as const,
    }));
    expect(() => validateTkPromptStrategySet({
      strategySet: { strategies: collapsed },
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
      requireLivePresenter: true,
    })).toThrow(/DIVERSITY|差异/u);

    const normalized = normalizeTkPromptStrategyDiversity({
      strategySet: { strategies: collapsed },
    });
    expect(normalized.strategies.map(strategy => strategy.hookPatternId)).toEqual(
      collapsed.map(strategy => strategy.hookPatternId),
    );
    expect(normalized.strategies.every(strategy => (
      strategy.videoMode === 'live_presenter'
    ))).toBe(true);
    expect(validateTkPromptStrategySet({
      strategySet: normalized,
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
      requireLivePresenter: true,
    })).toHaveLength(3);
  });

  it('显式选择人物出镜后允许 1/2/3 案使用 live_presenter，但至少使用一案', () => {
    const base = makeStrategies();
    for (const liveCount of [1, 2, 3]) {
      const strategies = base.map((strategy, index) => index < liveCount
        ? {
            ...strategy,
            videoMode: 'live_presenter' as const,
          }
        : strategy);
      expect(validateTkPromptStrategySet({
        strategySet: { strategies },
        factPack: makeFactPack(),
        durationSeconds: 10,
        evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
        requireLivePresenter: true,
      }).filter(strategy => strategy.videoMode === 'live_presenter')).toHaveLength(liveCount);
    }

    expect(() => validateTkPromptStrategySet({
      strategySet: { strategies: base },
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
      requireLivePresenter: true,
    })).toThrow(/至少一案|人物/u);
  });

  it('显式非主持人出镜方式由服务端锁定，主持人专属风格确定性回落', () => {
    const strategies = makeStrategies();
    strategies[0] = {
      ...strategies[0]!,
      styleForm: 'presenter',
      style: 'talking_head',
      videoMode: 'live_presenter',
      proofMethodId: 'presenter_delivery',
    };
    strategies[1] = { ...strategies[1]!, videoMode: 'scene_demo' };
    const normalized = normalizeTkPromptStrategyAppearanceMode({
      strategySet: { strategies },
      appearanceMode: 'product_closeup',
      durationSeconds: 10,
    });
    expect(normalized.strategies.every(strategy => (
      strategy.videoMode === 'product_closeup'
    ))).toBe(true);
    expect(normalized.strategies[0]).toMatchObject({
      styleForm: 'scene',
      style: 'scene',
      proofMethodId: 'visible_operation',
    });
    expect(validateTkPromptStrategySet({
      strategySet: normalized,
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toHaveLength(3);

    const mismatched = makeStrategies();
    mismatched[0] = {
      ...mismatched[0]!,
      slot: 'creative',
      objective: 'attention',
      styleForm: 'drama',
      style: 'scene',
    };
    const structurallyLocked = normalizeTkPromptStrategyAppearanceMode({
      strategySet: { strategies: mismatched },
      appearanceMode: 'auto',
      durationSeconds: 10,
    });
    expect(structurallyLocked.strategies[0]).toMatchObject({
      slot: 'safe',
      objective: 'conversion',
      styleForm: 'scene',
      style: 'scene',
    });
  });

  it('主持人风格/证明只能使用 live_presenter，策略不得携带旧演员 ID', () => {
    const talkingHead = makeStrategies();
    talkingHead[0] = {
      ...talkingHead[0]!,
      styleForm: 'presenter',
      style: 'talking_head',
      videoMode: 'scene_demo',
    };
    expect(() => validateTkPromptStrategySet({
      strategySet: { strategies: talkingHead },
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toThrow(/live_presenter|真人/u);

    const presenterProof = makeStrategies();
    presenterProof[0] = {
      ...presenterProof[0]!,
      proofMethodId: 'presenter_delivery',
      proofMethod: '主持人现场演示',
    };
    expect(() => validateTkPromptStrategySet({
      strategySet: { strategies: presenterProof },
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toThrow(/live_presenter|真人/u);

    const actorOnProduct = makeStrategies().map((strategy, index) => index === 0
      ? {
          ...strategy,
          authorizedActorAssetId: '00000000-0000-4000-8000-000000000102',
        }
      : strategy);
    expect(() => validateTkPromptStrategySet({
      strategySet: { strategies: actorOnProduct },
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toThrow();
  });

  it('5 秒策略 openingLine 必须为空', () => {
    const withSpeech = makeStrategies();
    expect(() => validateTkPromptStrategySet({
      strategySet: { strategies: withSpeech },
      factPack: makeFactPack({ spokenLanguage: null }),
      durationSeconds: 5,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toThrow(/openingLine|纯声音/u);

    const soundOnly = withSpeech.map(strategy => ({ ...strategy, openingLine: '' }));
    expect(validateTkPromptStrategySet({
      strategySet: { strategies: soundOnly },
      factPack: makeFactPack({ spokenLanguage: null }),
      durationSeconds: 5,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toHaveLength(3);
  });

  it('Hook 内部案例不得泄漏到策略或方案', () => {
    const strategies = makeStrategies();
    strategies[0] = {
      ...strategies[0]!,
      productBridge: TK_PROMPT_HOOK_PATTERNS[0]!.internalExample,
    };
    expect(() => validateTkPromptStrategySet({
      strategySet: { strategies },
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toThrow(/Hook/u);

    const normalizedLeak = makeStrategies();
    normalizedLeak[0] = {
      ...normalizedLeak[0]!,
      productBridge: TK_PROMPT_HOOK_PATTERNS[0]!.internalExample.split('').join(' '),
    };
    expect(() => validateTkPromptStrategySet({
      strategySet: { strategies: normalizedLeak },
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toThrow(/Hook/u);

    for (const leakedHistory of [
      '作为累计十亿 GMV 的顶级专家给出背书',
      '拥有10年电商经验的专家推荐',
      '创造十亿销售额的顶级策略师',
      'world-class e-commerce expert with 10 years of experience and billions in sales',
    ]) {
      const personaLeak = makeStrategies();
      personaLeak[0] = { ...personaLeak[0]!, productBridge: leakedHistory };
      expect(() => validateTkPromptStrategySet({
        strategySet: { strategies: personaLeak },
        factPack: makeFactPack(),
        durationSeconds: 10,
        evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
      })).toThrow(/履历|专家/u);
    }

    const ordinaryProductAge = makeStrategies();
    ordinaryProductAge[0] = { ...ordinaryProductAge[0]!, productBridge: '商品标注保质期10年' };
    expect(validateTkPromptStrategySet({
      strategySet: { strategies: ordinaryProductAge },
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toHaveLength(3);

    for (const disclosure of ['#AIGC', 'AI创作', '人工智能生成', 'AI-generated']) {
      const aiLeak = makeStrategies();
      aiLeak[0] = { ...aiLeak[0]!, productBridge: disclosure };
      expect(() => validateTkPromptStrategySet({
        strategySet: { strategies: aiLeak },
        factPack: makeFactPack(),
        durationSeconds: 10,
        evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
      })).toThrow(/AI/u);
    }

    for (const disclosure of [
      '#AIGC', 'AIGC', 'AI制作', 'AI创作', '人工智能生成',
      'AI-generated content', 'created by AI',
    ]) {
      const candidate = makeCandidate(10);
      candidate.whyItFits = disclosure;
      expect(() => validateTkPromptOptionCandidate({
        candidate,
        strategy: makeStrategies()[0]!,
        factPack: makeFactPack(),
        durationSeconds: 10,
        spokenLanguage: '英语',
      })).toThrow(/AI/u);
    }
    const ordinaryModelName = makeCandidate(10);
    ordinaryModelName.whyItFits = 'AIGCLEAN-200 product detail';
    expect(validateTkPromptOptionCandidate({
      candidate: ordinaryModelName,
      strategy: makeStrategies()[0]!,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toBeTruthy();

    const candidatePersonaLeak = makeCandidate(10);
    candidatePersonaLeak.whyItFits = 'world-class e-commerce expert with 10 years of experience';
    expect(() => validateTkPromptOptionCandidate({
      candidate: candidatePersonaLeak,
      strategy: makeStrategies()[0]!,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toThrow(/履历|专家/u);
  });

  it('证明方法不能绕过竞品与前后素材证据门禁', () => {
    const comparison = makeStrategies();
    comparison[0] = {
      ...comparison[0]!,
      proofMethodId: 'verified_comparison',
      proofMethod: '使用已确认竞品做同条件对比',
    };
    expect(() => validateTkPromptStrategySet({
      strategySet: { strategies: comparison },
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toThrow(/竞品|对比/u);
    comparison[0] = {
      ...comparison[0]!,
      allowedFactIds: [...comparison[0]!.allowedFactIds, 'confirmed-003'],
    };
    const competitorFactPack = makeFactPack({
      facts: [...makeFactPack().facts, {
        factId: 'confirmed-003',
        status: 'user-confirmed',
        text: '用户确认已提供竞品对比素材',
        sourceImageIds: [],
      }],
    });
    expect(validateTkPromptStrategySet({
      strategySet: { strategies: comparison },
      factPack: competitorFactPack,
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true, competitor: true },
    })).toHaveLength(3);

    const beforeAfter = makeStrategies();
    beforeAfter[0] = {
      ...beforeAfter[0]!,
      proofMethodId: 'verified_before_after',
      proofMethod: '使用同场景前后素材证明',
    };
    expect(() => validateTkPromptStrategySet({
      strategySet: { strategies: beforeAfter },
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toThrow(/前后/u);
  });

  it('无真实优惠时拒绝促销 CTA/发布文案，并零泄漏 forbiddenClaims', () => {
    const promotionalStrategies = makeStrategies();
    promotionalStrategies[0] = {
      ...promotionalStrategies[0]!,
      ctaStrategy: '限时折扣，仅剩3件',
    };
    expect(() => validateTkPromptStrategySet({
      strategySet: { strategies: promotionalStrategies },
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toThrow(/未验证|价格|折扣|库存|限时/u);

    const strategy = makeStrategies()[0]!;
    const candidate = makeCandidate(10);
    candidate.whyItFits = 'Limited time discount — only 3 left.';
    expect(() => validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toThrow(/未验证|折扣|库存|限时/u);

    candidate.whyItFits = 'A closer look at the product in action.';
    candidate.beats[0]!.environment = '限时折扣活动现场';
    expect(() => validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toThrow(/未验证|折扣|限时/u);

    candidate.beats[0]!.environment = '真实家居台面';
    candidate.beats[0]!.voiceoverZh = '保证有效';
    expect(() => validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack: makeFactPack({ forbiddenClaims: ['保证有效'] }),
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toThrow(/禁止声明/u);

    const verifiedOfferPack = makeFactPack({
      verifiedOffer: { condition: '折扣10%' },
    });
    const verifiedCandidate = makeCandidate(10);
    verifiedCandidate.whyItFits = '折扣10%';
    expect(validateTkPromptOptionCandidate({
      candidate: verifiedCandidate,
      strategy,
      factPack: verifiedOfferPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toBeTruthy();
    verifiedCandidate.whyItFits = '折扣10%，仅剩3件';
    expect(() => validateTkPromptOptionCandidate({
      candidate: verifiedCandidate,
      strategy,
      factPack: verifiedOfferPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toThrow(/增强|不存在/u);

    for (const unsupported of ['折扣10%，同时包邮', '折扣10%，另送赠品']) {
      verifiedCandidate.whyItFits = unsupported;
      expect(() => validateTkPromptOptionCandidate({
        candidate: verifiedCandidate,
        strategy,
        factPack: verifiedOfferPack,
        durationSeconds: 10,
        spokenLanguage: '英语',
      })).toThrow(/增强|促销语义/u);
    }

    const freeShippingPack = makeFactPack({
      verifiedOffer: { condition: '包邮' },
    });
    const freeShippingCandidate = makeCandidate(10);
    freeShippingCandidate.whyItFits = '当前商品包邮';
    expect(validateTkPromptOptionCandidate({
      candidate: freeShippingCandidate,
      strategy,
      factPack: freeShippingPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toBeTruthy();
    freeShippingCandidate.whyItFits = '当前商品包邮并折扣10%';
    expect(() => validateTkPromptOptionCandidate({
      candidate: freeShippingCandidate,
      strategy,
      factPack: freeShippingPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toThrow(/增强|促销语义/u);

    for (const [offer, allowed, enhanced] of [
      ['满100减10', '满100减10', '满100减50'],
      ['立减10', '立减10', '立减50'],
    ] as const) {
      const amountBoundPack = makeFactPack({ verifiedOffer: { condition: offer } });
      const amountBoundCandidate = makeCandidate(10);
      amountBoundCandidate.whyItFits = allowed;
      expect(validateTkPromptOptionCandidate({
        candidate: amountBoundCandidate,
        strategy,
        factPack: amountBoundPack,
        durationSeconds: 10,
        spokenLanguage: '英语',
      })).toBeTruthy();
      amountBoundCandidate.whyItFits = enhanced;
      expect(() => validateTkPromptOptionCandidate({
        candidate: amountBoundCandidate,
        strategy,
        factPack: amountBoundPack,
        durationSeconds: 10,
        spokenLanguage: '英语',
      })).toThrow(/不存在的数值/u);
    }

    for (const unsupportedPromotion of [
      '半价', '五折', '第二件半价', '特价', '买二送一',
      'half price', 'buy two get one free',
    ]) {
      const unsupportedCandidate = makeCandidate(10);
      unsupportedCandidate.whyItFits = unsupportedPromotion;
      expect(() => validateTkPromptOptionCandidate({
        candidate: unsupportedCandidate,
        strategy,
        factPack: makeFactPack(),
        durationSeconds: 10,
        spokenLanguage: '英语',
      })).toThrow(/未验证|促销/u);
    }

    const tenPercentPack = makeFactPack({ verifiedOffer: { condition: '10% off' } });
    const halfPriceRewrite = makeCandidate(10);
    halfPriceRewrite.whyItFits = '第二件半价';
    expect(() => validateTkPromptOptionCandidate({
      candidate: halfPriceRewrite,
      strategy,
      factPack: tenPercentPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toThrow(/不存在的数值|增强/u);

    const bundlePack = makeFactPack({ verifiedOffer: { condition: '买一送一' } });
    const bundleCandidate = makeCandidate(10);
    bundleCandidate.whyItFits = '买一送一';
    expect(validateTkPromptOptionCandidate({
      candidate: bundleCandidate,
      strategy,
      factPack: bundlePack,
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toBeTruthy();
    bundleCandidate.whyItFits = '买二送一';
    expect(() => validateTkPromptOptionCandidate({
      candidate: bundleCandidate,
      strategy,
      factPack: bundlePack,
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toThrow(/不存在的数值/u);

    for (const [offer, enhanced] of [
      ['第二件半价', '半价'],
      ['第二件5折', '5折'],
    ] as const) {
      const contextualPack = makeFactPack({ verifiedOffer: { condition: offer } });
      const contextualCandidate = makeCandidate(10);
      contextualCandidate.whyItFits = offer;
      expect(validateTkPromptOptionCandidate({
        candidate: contextualCandidate,
        strategy,
        factPack: contextualPack,
        durationSeconds: 10,
        spokenLanguage: '英语',
      })).toBeTruthy();
      contextualCandidate.whyItFits = enhanced;
      expect(() => validateTkPromptOptionCandidate({
        candidate: contextualCandidate,
        strategy,
        factPack: contextualPack,
        durationSeconds: 10,
        spokenLanguage: '英语',
      })).toThrow(/不存在的数值/u);
    }
  });

  it('策略 Provider 偶发扩写促销时本地确定性删除，原真实性门禁仍然生效', () => {
    const promotionalStrategies = makeStrategies();
    promotionalStrategies[0] = {
      ...promotionalStrategies[0]!,
      firstFrame: '一个顾客拿起商品进行演示',
      productBridge: '女性模特造型',
      relevanceBeat: ids.image.split('').join(' '),
      openingLine: 'Limited time discount — only 3 left.',
      ctaStrategy: '限时折扣，仅剩3件，立即购买',
      requiredMaterials: ['商品参考图', '优惠券截图'],
    };
    const factPack = makeFactPack();
    const normalized = normalizeTkPromptStrategyPromotions({
      strategySet: { strategies: promotionalStrategies },
      factPack,
    });

    expect(normalized.strategies[0]).toMatchObject({
      firstFrame: '首帧立即展示商品的可见结构或操作动作',
      productBridge: '沿同一动作进入商品结构与操作细节',
      relevanceBeat: '沿同一商品动作展示它与使用场景的关系',
      openingLine: '',
      ctaStrategy: '引导观众点击商品卡查看商品详情',
      requiredMaterials: ['商品参考图'],
    });
    expect(validateTkPromptStrategySet({
      strategySet: normalized,
      factPack,
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toHaveLength(3);

    const verifiedFactPack = makeFactPack({
      verifiedOffer: { condition: '已验证折扣 10%' },
    });
    promotionalStrategies[0] = {
      ...promotionalStrategies[0]!,
      openingLine: '已验证折扣 10%',
      ctaStrategy: '查看已验证折扣 10%',
      requiredMaterials: [],
    };
    const retained = normalizeTkPromptStrategyPromotions({
      strategySet: { strategies: promotionalStrategies },
      factPack: verifiedFactPack,
    });
    expect(retained.strategies[0]?.openingLine).toBe('已验证折扣 10%');
    expect(retained.strategies[0]?.ctaStrategy).toBe('查看已验证折扣 10%');
  });

  it('商品事实百分比不被当作促销，但不能授权新的折扣数值', () => {
    const strategy = makeStrategies()[0]!;
    for (const factualNumber of ['过滤99%颗粒', '含50%成分']) {
      const factPack = makeFactPack({
        facts: [{
          factId: 'visible-001',
          status: 'visible',
          text: factualNumber,
          sourceImageIds: [ids.image],
        }],
      });
      const candidate = makeCandidate(10);
      candidate.coreInformationPoints[0]!.message = factualNumber;
      candidate.beats[0]!.voiceoverTarget = factualNumber;
      expect(validateTkPromptOptionCandidate({
        candidate,
        strategy,
        factPack,
        durationSeconds: 10,
        spokenLanguage: '英语',
      })).toBeTruthy();
    }

    const numericFact = '过滤99%颗粒';
    const discountedPack = makeFactPack({
      facts: [{
        factId: 'visible-001',
        status: 'visible',
        text: numericFact,
        sourceImageIds: [ids.image],
      }],
      verifiedOffer: { condition: '10% off' },
    });
    const valid = makeCandidate(10);
    valid.coreInformationPoints[0]!.message = numericFact;
    valid.beats[0]!.voiceoverTarget = `${numericFact}. 10% off.`;
    expect(validateTkPromptOptionCandidate({
      candidate: valid,
      strategy,
      factPack: discountedPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toBeTruthy();

    const promotionRewrite = makeCandidate(10);
    promotionRewrite.coreInformationPoints[0]!.message = numericFact;
    promotionRewrite.beats[0]!.voiceoverTarget = '99% off.';
    expect(() => validateTkPromptOptionCandidate({
      candidate: promotionRewrite,
      strategy,
      factPack: discountedPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toThrow(/不存在的数值/u);
  });

  it('单方案 Provider 偶发扩写促销时逐字段中和，原真实性门禁保持', () => {
    const strategy = makeStrategies()[0]!;
    const factPack = makeFactPack();
    const candidate = makeCandidate(10);
    candidate.title = 'Limited time sale';
    candidate.whyItFits = ids.image.split('').join(' ');
    candidate.coreInformationPoints[0]!.message = '50% off';
    candidate.beats[0]!.environment = 'Sale price display';
    candidate.beats[0]!.editingCue = 'Add an on-screen text overlay';
    candidate.beats[0]!.shotSize = '女性模特面部特写';
    candidate.beats[0]!.lighting = '女性模特轮廓光';
    candidate.beats[1]!.subject = '成年女性';
    candidate.beats[1]!.action = '拿起商品进行演示';
    candidate.beats[2]!.editingCue = '成年女性';
    candidate.beats[3]!.environment = '拿起商品';
    candidate.beats[3]!.subject = '女性模特造型';
    candidate.beats[0]!.voiceoverTarget = 'Get 50% off today.';
    candidate.beats[0]!.voiceoverZh = '今天五折优惠';
    candidate.requiredMaterials = ['商品参考图', '优惠券截图'];

    expect(() => validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toThrow(/未验证|文字浮层|真人/u);

    const normalized = normalizeTkPromptCandidateFreeText({
      candidate,
      strategy,
      factPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
    });
    expect(normalized.requiredMaterials).toEqual(['商品参考图']);
    expect(normalized.coreInformationPoints[0]?.message)
      .toBe('展示已确认商品事实：商品表面有可见网格结构');
    expect(normalized.whyItFits).toBe('围绕已验证商品事实展示结构与操作方式');
    expect(normalized.beats[0]?.editingCue).toBe('保持动作连续');
    expect(normalized.beats[0]?.shotSize).toBe('商品中近景');
    expect(normalized.beats[0]?.lighting).toBe('自然清晰光线');
    expect(normalized.beats[1]).toMatchObject({
      subject: '商品主体及其可见结构',
      action: '连续展示商品结构与操作方式',
    });
    expect(normalized.beats[2]?.editingCue).toBe('保持动作连续');
    expect(normalized.beats[3]?.environment).toBe('清晰、简洁的商品展示场景');
    expect(validateTkPromptOptionCandidate({
      candidate: normalized,
      strategy,
      factPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toBeTruthy();
  });

  it('英文镜头叙述确定性正规化为中文，同时保留目标语言和合法品牌型号', () => {
    const candidate = makeCandidate(10);
    candidate.title = 'The ultimate product demonstration';
    candidate.whyItFits = 'This strategy shows why the product is useful';
    candidate.coreInformationPoints[0]!.message = 'Show the ACME X200 Logo clearly';
    candidate.beats.forEach(beat => {
      beat.environment = 'A clean modern kitchen counter';
      beat.subject = 'The ACME X200 product and its visible Logo';
      beat.action = 'Push the button and show the mechanism';
      beat.shotSize = 'Extreme close up product shot';
      beat.lighting = 'Soft cinematic studio lighting';
      beat.editingCue = 'Cut quickly when the button moves';
      beat.soundDesign = 'Natural click sound and room ambience';
      beat.voiceoverTarget = 'Mira los detalles del ACME X200 en acción.';
      beat.voiceoverZh = '查看 ACME X200 的商品细节与操作方式。';
    });
    candidate.requiredMaterials = ['ACME X200 product images'];
    const factPack = makeFactPack({
      productName: 'ACME X200',
      targetMarket: '墨西哥',
      spokenLanguage: '西班牙语',
      facts: [{
        factId: 'visible-001',
        status: 'visible',
        text: 'ACME X200 正面可见 Logo 和网格结构',
        sourceImageIds: [ids.image],
      }, {
        factId: 'confirmed-002',
        status: 'user-confirmed',
        text: '用户确认已提供未拆封包装素材',
        sourceImageIds: [],
      }],
    });
    const normalized = normalizeTkPromptCandidateFreeText({
      candidate,
      strategy: makeStrategies()[0]!,
      factPack,
      durationSeconds: 10,
      spokenLanguage: '西班牙语',
    });

    const nonVoiceoverFields = [
      normalized.title,
      normalized.whyItFits,
      ...normalized.coreInformationPoints.map(point => point.message),
      ...normalized.beats.flatMap(beat => [
        beat.environment,
        beat.subject,
        beat.action,
        beat.shotSize,
        beat.lighting,
        beat.editingCue,
        beat.soundDesign,
        beat.voiceoverZh,
      ]),
      ...normalized.requiredMaterials,
    ].filter(Boolean);
    expect(nonVoiceoverFields.every(value => (
      isTkPromptChineseNarrative(value, ['ACME X200'])
    ))).toBe(true);
    expect(normalized.beats.every(beat => beat.voiceoverTarget.includes('Mira los detalles')))
      .toBe(true);
    expect(JSON.stringify(normalized)).toContain('ACME X200');
  });

  it('服务端确定性锁定时长、事实、时间轴、人物、图片与口播结构', () => {
    const strategy = makeStrategies()[0]!;
    const factPack = makeFactPack();
    const candidate = makeCandidate(10);
    candidate.coreInformationPoints = [{
      messageId: 'message-003',
      message: '包含越权事实的描述',
      factIds: ['visible-999', 'visible-001', 'visible-001'],
    }, {
      messageId: 'message-003',
      message: '只有越权事实的描述',
      factIds: ['visible-999'],
    }, {
      messageId: 'message-002',
      message: '超出 10 秒上限的第三点',
      factIds: ['visible-001'],
    }];
    candidate.primaryActionId = 'action-999';
    candidate.beats.forEach((beat, index) => {
      beat.startSeconds = index + 0.25;
      beat.endSeconds = index + 0.75;
      beat.actionPhase = 'start';
      beat.productImageIndex = 9;
      beat.presenterVisible = true;
      beat.voiceoverTarget = '';
      beat.voiceoverZh = '';
    });

    const structured = normalizeTkPromptCandidateStructure({
      candidate,
      strategy,
      factPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageCount: 1,
    });
    expect(structured.coreInformationPoints).toEqual([{
      messageId: 'message-001',
      message: '商品表面有可见网格结构',
      factIds: ['visible-001'],
    }, {
      messageId: 'message-002',
      message: '商品表面有可见网格结构',
      factIds: ['visible-001'],
    }]);
    expect(structured.primaryActionId).toBeNull();
    expect(structured.beats.map(beat => [
      beat.startSeconds,
      beat.endSeconds,
      beat.actionPhase,
      beat.productImageIndex,
      beat.presenterVisible,
    ])).toEqual([
      [0, 1, null, 1, false],
      [1, 3, null, 1, false],
      [3, 7, null, 1, false],
      [7, 10, null, 1, false],
    ]);
    expect(structured.beats.every(beat => beat.voiceoverTarget.length > 0)).toBe(true);
    expect(structured.beats.every(beat => /[\u3400-\u9fff]/u.test(beat.voiceoverZh))).toBe(true);

    const closed = normalizeTkPromptCandidateBeatInformation({
      candidate: structured,
      durationSeconds: 10,
    });
    expect(validateTkPromptOptionCandidate({
      candidate: closed,
      strategy,
      factPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toBeTruthy();

    const five = makeCandidate(5);
    five.primaryActionId = 'action-999';
    five.beats.forEach(beat => {
      beat.actionPhase = null;
      beat.voiceoverTarget = 'Forbidden voice';
      beat.voiceoverZh = '禁止口播';
    });
    const fiveStructured = normalizeTkPromptCandidateStructure({
      candidate: five,
      strategy,
      factPack: makeFactPack({ spokenLanguage: null }),
      durationSeconds: 5,
      spokenLanguage: null,
      imageCount: 1,
    });
    expect(fiveStructured.primaryActionId).toBe('action-001');
    expect(fiveStructured.beats.map(beat => beat.actionPhase))
      .toEqual(['start', 'progress', 'complete']);
    expect(fiveStructured.beats.every(beat => (
      beat.voiceoverTarget === '' && beat.voiceoverZh === ''
    ))).toBe(true);
  });

  it('forbiddenClaims 会剥离中英文禁止前缀后匹配核心禁词', () => {
    const strategy = makeStrategies()[0]!;
    for (const [forbiddenClaim, leakedText] of [
      ['不要提医疗功效', '医疗功效'],
      ['禁止出现治愈焦虑', '治愈焦虑'],
      ['不得声称永久有效', '永久有效'],
      ['avoid medical claims', 'medical claims'],
      ['never say cures anxiety', 'cures anxiety'],
      ['do not mention permanent results', 'permanent results'],
    ] as const) {
      const candidate = makeCandidate(10);
      candidate.beats[0]!.voiceoverTarget = `Product detail: ${leakedText}`;
      expect(() => validateTkPromptOptionCandidate({
        candidate,
        strategy,
        factPack: makeFactPack({ forbiddenClaims: [forbiddenClaim] }),
        durationSeconds: 10,
        spokenLanguage: '英语',
      })).toThrow(/禁止声明/u);
    }

    expect(validateTkPromptOptionCandidate({
      candidate: makeCandidate(10),
      strategy,
      factPack: makeFactPack({ forbiddenClaims: ['不要提医疗功效'] }),
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toBeTruthy();
  });

  it('5 秒执行 Prompt 没有口播、中文译文和全局语言硬约束', () => {
    const strategy = makeStrategies()[0]!;
    const candidate = makeCandidate(5);
    const validated = validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack: makeFactPack({ spokenLanguage: null }),
      durationSeconds: 5,
      spokenLanguage: null,
    });
    const prompt = renderTkPromptExecutionPrompt({
      candidate: validated,
      strategy,
      factPack: makeFactPack({ spokenLanguage: null }),
      durationSeconds: 5,
      spokenLanguage: null,
      imageAssetIds: [ids.image, ids.image2],
    });
    expect(prompt).not.toContain('旁白（');
    expect(prompt).not.toContain('仅供审核');
    expect(prompt).toContain('@图片1=上传顺序第1张');
    expect(prompt).toContain('@图片2=上传顺序第2张');
    expect(prompt).not.toContain(ids.image);
    expect(prompt).not.toContain(ids.image2);
    expect(prompt).not.toMatch(/AUDIO LANGUAGE LOCK|音频语言硬约束/iu);
    expect(prompt.length).toBeLessThanOrEqual(3_800);
  });

  it('5 秒 live_presenter 只生成同一虚构主持人的无声动作，不附演员素材', () => {
    const strategy: TkPromptStrategy = {
      ...makeStrategies()[0]!,
      videoMode: 'live_presenter',
    };
    const candidate = makeCandidate(5);
    candidate.beats[0]!.presenterVisible = true;
    const factPack = makeFactPack({ targetMarket: 'Japan', spokenLanguage: null });
    const validated = validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack,
      durationSeconds: 5,
      spokenLanguage: null,
    });
    const prompt = renderTkPromptExecutionPrompt({
      candidate: validated,
      strategy,
      factPack,
      durationSeconds: 5,
      spokenLanguage: null,
      imageAssetIds: [ids.image],
    });
    expect(prompt).toContain(TK_PROMPT_LIVE_PRESENTER_BOUNDARY);
    expect(prompt).toContain('主持人仅作无声动作演示');
    expect(prompt).not.toContain('旁白（');
    expect(prompt).not.toMatch(/authorizedActorAssetId|已绑定授权演员|@演员/u);
  });

  it('最终 renderer 拒绝事实包注入的素材 ID、禁用声明和未验证促销', () => {
    const strategy = makeStrategies()[0]!;
    const fiveCandidate = makeCandidate(5);
    const renderFiveSeconds = (factPack: TkPromptFactPack) => renderTkPromptExecutionPrompt({
      candidate: fiveCandidate,
      strategy,
      factPack,
      durationSeconds: 5,
      spokenLanguage: null,
      imageAssetIds: [ids.image],
    });

    expect(() => renderFiveSeconds(makeFactPack({
      spokenLanguage: null,
      productName: `参考商品 ${ids.image}`,
    }))).toThrow(/素材 UUID|内部标识/u);
    expect(() => renderFiveSeconds(makeFactPack({
      spokenLanguage: null,
      demonstrableActions: [makeDemonstrableAction(`手部按下结构 ${ids.image}`)],
    }))).toThrow(/素材 UUID|内部标识/u);
    expect(() => renderFiveSeconds(makeFactPack({
      spokenLanguage: null,
      demonstrableActions: [makeDemonstrableAction('手部按下 action-001 对应结构')],
    }))).toThrow(/内部标识/u);
    expect(() => renderFiveSeconds(makeFactPack({
      spokenLanguage: null,
      productName: '治愈焦虑参考商品',
      forbiddenClaims: ['治愈焦虑'],
    }))).toThrow(/禁止声明/u);
    expect(() => renderFiveSeconds(makeFactPack({
      spokenLanguage: null,
      demonstrableActions: [makeDemonstrableAction('手部按下结构并宣称治愈焦虑')],
      forbiddenClaims: ['治愈焦虑'],
    }))).toThrow(/禁止声明/u);
    for (const productName of [
      '拥有10年经验与十亿 GMV 的专家推荐商品',
      TK_PROMPT_HOOK_PATTERNS[0]!.internalExample,
      '参考 @图片1 商品',
    ]) {
      expect(() => renderFiveSeconds(makeFactPack({
        spokenLanguage: null,
        productName,
      }))).toThrow(/履历|专家|Hook|图片引用/u);
    }
    for (const action of [
      '专家用10年经验和 GMV 背书并按下结构',
      TK_PROMPT_HOOK_PATTERNS[1]!.internalExample,
      '手部按下 @图片1 中的结构',
    ]) {
      expect(() => renderFiveSeconds(makeFactPack({
        spokenLanguage: null,
        demonstrableActions: [makeDemonstrableAction(action)],
      }))).toThrow(/履历|专家|Hook|图片引用/u);
    }

    expect(() => renderTkPromptExecutionPrompt({
      candidate: makeCandidate(10),
      strategy: { ...strategy, productBridge: '继续 @图片1 中的操作' },
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toThrow(/图片引用/u);

    const tenCandidate = makeCandidate(10);
    expect(() => renderTkPromptExecutionPrompt({
      candidate: tenCandidate,
      strategy,
      factPack: makeFactPack({ productName: '限时折扣10%参考商品' }),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toThrow(/未验证/u);

    const verifiedOfferPack = makeFactPack({
      productName: '折扣10%参考商品',
      verifiedOffer: { condition: '折扣10%' },
    });
    expect(renderTkPromptExecutionPrompt({
      candidate: tenCandidate,
      strategy,
      factPack: verifiedOfferPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toContain('【商品】折扣10%参考商品');

    for (const productName of ['折扣10%并包邮参考商品', '折扣10%并送赠品参考商品']) {
      expect(() => renderTkPromptExecutionPrompt({
        candidate: tenCandidate,
        strategy,
        factPack: makeFactPack({
          productName,
          verifiedOffer: { condition: '折扣10%' },
        }),
        durationSeconds: 10,
        spokenLanguage: '英语',
        imageAssetIds: [ids.image],
      })).toThrow(/增强|促销语义/u);
    }
    expect(() => renderTkPromptExecutionPrompt({
      candidate: tenCandidate,
      strategy,
      factPack: makeFactPack({
        productName: '包邮并折扣10%参考商品',
        verifiedOffer: { condition: '包邮' },
      }),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toThrow(/增强|促销语义/u);
    expect(renderTkPromptExecutionPrompt({
      candidate: tenCandidate,
      strategy,
      factPack: makeFactPack({ productName: '含50%成分参考商品' }),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toContain('【商品】含50%成分参考商品');
    expect(renderTkPromptExecutionPrompt({
      candidate: tenCandidate,
      strategy,
      factPack: makeFactPack({ productName: '标注保质期10年的参考商品' }),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toContain('【商品】标注保质期10年的参考商品');
  });

  it('5 秒只能选择并编译审核后仍有事实支撑的稳定 actionId', () => {
    const strategy = makeStrategies()[0]!;
    const candidate = makeCandidate(5);
    const factPack = makeFactPack({
      spokenLanguage: null,
      demonstrableActions: [makeDemonstrableAction('手部旋转可见结构', 'action-002')],
    });
    expect(() => validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack,
      durationSeconds: 5,
      spokenLanguage: null,
    })).toThrow(/主商品动作/u);
    expect(() => compileTkPromptCandidateBeats({
      candidate,
      strategy,
      factPack,
      durationSeconds: 5,
    })).toThrow(/失效|事实支撑/u);

    candidate.primaryActionId = 'action-002';
    const validated = validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack,
      durationSeconds: 5,
      spokenLanguage: null,
    });
    expect(renderTkPromptExecutionPrompt({
      candidate: validated,
      strategy,
      factPack,
      durationSeconds: 5,
      spokenLanguage: null,
      imageAssetIds: [ids.image],
    })).toContain('主商品动作：手部旋转可见结构');
  });

  it('5 秒非人物模式不把事实包中的模特动作重新注入最终 Prompt', () => {
    const strategy = makeStrategies()[0]!;
    const candidate = makeCandidate(5);
    const factPack = makeFactPack({
      spokenLanguage: null,
      demonstrableActions: [makeDemonstrableAction('女性模特穿上商品并展示')],
    });
    const validated = validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack,
      durationSeconds: 5,
      spokenLanguage: null,
      imageAssetIds: [ids.image],
    });
    const prompt = renderTkPromptExecutionPrompt({
      candidate: validated,
      strategy,
      factPack,
      durationSeconds: 5,
      spokenLanguage: null,
      imageAssetIds: [ids.image],
    });

    expect(prompt).toContain('主商品动作：手部指向并展示图片中可见的商品特征');
    expect(prompt).not.toMatch(/女性|模特/u);
  });

  it('5 秒允许否定式无人声说明，但拒绝正向人声；否定字幕规则不误伤', () => {
    const strategy = makeStrategies()[0]!;
    const candidate = makeCandidate(5);
    candidate.beats[0]!.soundDesign = '真实卡扣声，无人声、无旁白';
    candidate.warnings = ['禁止生成字幕'];
    expect(validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack: makeFactPack({ spokenLanguage: null }),
      durationSeconds: 5,
      spokenLanguage: null,
    })).toBeTruthy();

    candidate.beats[0]!.soundDesign = 'Product click only; do not add voiceover.';
    candidate.warnings = ['Do not show subtitles.'];
    expect(validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack: makeFactPack({ spokenLanguage: null }),
      durationSeconds: 5,
      spokenLanguage: null,
    })).toBeTruthy();

    for (const safeSilence of [
      '卡扣声；无解说、无配音、无语音',
      'Product click only; no narration or vocals.',
      '仅拟音，禁止加入旁白或对白',
    ]) {
      candidate.beats[0]!.soundDesign = safeSilence;
      expect(validateTkPromptOptionCandidate({
        candidate,
        strategy,
        factPack: makeFactPack({ spokenLanguage: null }),
        durationSeconds: 5,
        spokenLanguage: null,
      })).toBeTruthy();
    }

    for (const humanVoice of [
      '加入人声旁白和真实卡扣声',
      '加入解说',
      '使用配音',
      '主持人讲话',
      'add narration',
      'include vocals',
      'use spoken words',
    ]) {
      candidate.beats[0]!.soundDesign = humanVoice;
      expect(() => validateTkPromptOptionCandidate({
        candidate,
        strategy,
        factPack: makeFactPack({ spokenLanguage: null }),
        durationSeconds: 5,
        spokenLanguage: null,
      })).toThrow(/人声/u);
    }

    candidate.beats[0]!.soundDesign = '真实卡扣声，无人声';
    for (const overlay of [
      '显示字幕并指向商品结构',
      '屏幕显示一句文字',
      '展示文案',
      '出现贴纸',
      '添加标签',
      'show screen text',
      'add a sticker',
    ]) {
      candidate.beats[0]!.action = overlay;
      expect(() => validateTkPromptOptionCandidate({
        candidate,
        strategy,
        factPack: makeFactPack({ spokenLanguage: null }),
        durationSeconds: 5,
        spokenLanguage: null,
      })).toThrow(/字幕|文字浮层/u);
    }
    candidate.beats[0]!.action = '展示商品包装原有文字和 Logo';
    expect(validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack: makeFactPack({ spokenLanguage: null }),
      durationSeconds: 5,
      spokenLanguage: null,
    })).toBeTruthy();

    const crossField = makeCandidate(5);
    crossField.title = 'Show';
    crossField.whyItFits = 'Title-led product detail';
    expect(JSON.stringify(crossField)).toMatch(/show.{0,32}title/iu);
    expect(validateTkPromptOptionCandidate({
      candidate: crossField,
      strategy,
      factPack: makeFactPack({ spokenLanguage: null }),
      durationSeconds: 5,
      spokenLanguage: null,
    })).toBeTruthy();
  });

  it('10 秒保留目标口播，但中文审核译文绝不进入执行 Prompt', () => {
    const strategy = makeStrategies()[0]!;
    const candidate = makeCandidate(10);
    const validated = validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
    });
    const prompt = renderTkPromptExecutionPrompt({
      candidate: validated,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
    });
    expect(prompt).toContain('旁白（English）：See this detail.');
    expect(prompt).not.toContain('看清这个细节。');
    expect(prompt).not.toMatch(/AUDIO LANGUAGE LOCK|音频语言硬约束/iu);
  });

  it.each(TK_PROMPT_LANGUAGES.flatMap(language => ([10, 15] as const).flatMap(duration => (
    ([1, 2, 3] as const).map(imageCount => ({ language, duration, imageCount }))
  ))))('$language / $duration 秒 / $imageCount 图执行 Prompt 只保留目标语言口播', ({ language, duration, imageCount }) => {
    const sample = LANGUAGE_SAMPLES[language];
    const candidate = makeCandidate(duration);
    candidate.beats.forEach((beat, index) => {
      beat.voiceoverTarget = `${sample.voiceover} ${index + 1}`;
      beat.voiceoverZh = language === '普通话' ? '' : `审核译文${index + 1}`;
    });
    const factPack = makeFactPack({
      targetMarket: '墨西哥',
      spokenLanguage: language,
    });
    const strategy = makeStrategies()[0]!;
    const imageAssetIds = [ids.image, ids.image2, ids.image3].slice(0, imageCount);
    const validated = validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack,
      durationSeconds: duration,
      spokenLanguage: language,
    });
    const prompt = renderTkPromptExecutionPrompt({
      candidate: validated,
      strategy,
      factPack,
      durationSeconds: duration,
      spokenLanguage: language,
      imageAssetIds,
    });
    expect(prompt).toContain(`旁白（${sample.label}）：${sample.voiceover} 1`);
    for (const beat of candidate.beats) {
      expect(prompt).toContain(beat.voiceoverTarget);
      if (beat.voiceoverZh) expect(prompt).not.toContain(beat.voiceoverZh);
    }
    for (let index = 1; index <= imageCount; index += 1) {
      expect(prompt).toContain(`@图片${index}=上传顺序第${index}张`);
    }
    const nonVoiceoverPrompt = prompt
      .split('\n')
      .filter(line => !line.startsWith('旁白（'))
      .join('\n');
    expect(isTkPromptChineseNarrative(nonVoiceoverPrompt)).toBe(true);
    expect(prompt).not.toMatch(/AUDIO LANGUAGE LOCK|音频语言硬约束/iu);
    expect(prompt.length).toBeLessThanOrEqual(3_800);
  });

  it.each(TK_PROMPT_LANGUAGES)('%s 的 live_presenter 使用目标市场虚构非名人并保持同一人物', language => {
    const sample = LANGUAGE_SAMPLES[language];
    const candidate = makeCandidate(10);
    candidate.beats[0]!.presenterVisible = true;
    candidate.beats.forEach((beat, index) => {
      beat.voiceoverTarget = `${sample.voiceover} ${index + 1}`;
      beat.voiceoverZh = language === '普通话' ? '' : `审核译文${index + 1}`;
    });
    const targetMarket = `${language}目标市场`;
    const factPack = makeFactPack({ targetMarket, spokenLanguage: language });
    const strategy: TkPromptStrategy = {
      ...makeStrategies()[0]!,
      videoMode: 'live_presenter',
    };
    const validated = validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack,
      durationSeconds: 10,
      spokenLanguage: language,
    });
    const prompt = renderTkPromptExecutionPrompt({
      candidate: validated,
      strategy,
      factPack,
      durationSeconds: 10,
      spokenLanguage: language,
      imageAssetIds: [ids.image],
    });
    expect(prompt).toContain(`【目标市场】${targetMarket}`);
    expect(prompt).toContain(TK_PROMPT_LIVE_PRESENTER_BOUNDARY);
    expect(prompt).toContain(`口型与各镜头的${language}旁白自然对应`);
    expect(prompt).toContain(`旁白（${sample.label}）`);
    expect(prompt).not.toMatch(/authorizedActorAssetId|已绑定授权演员|@演员/u);
  });

  it('策略、分镜和执行 Prompt 均拒绝虚构主持人的使用经历或测评身份', () => {
    const strategies = makeStrategies();
    strategies[0] = {
      ...strategies[0]!,
      videoMode: 'live_presenter',
      productBridge: '我亲自用了三个月后推荐给大家',
    };
    expect(() => validateTkPromptStrategySet({
      strategySet: { strategies },
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toThrow(/个人使用经历|测评身份/u);

    const candidate = makeCandidate(10);
    candidate.beats[0]!.presenterVisible = true;
    candidate.beats[0]!.voiceoverTarget = 'I personally tested this product for weeks.';
    candidate.beats[0]!.voiceoverZh = '我亲自测试了这个商品数周。';
    expect(() => validateTkPromptOptionCandidate({
      candidate,
      strategy: { ...makeStrategies()[0]!, videoMode: 'live_presenter' },
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toThrow(/个人使用经历|测评身份/u);
  });

  it('10/15 秒核心信息点上限、顺序和事实闭包是硬门禁', () => {
    const strategy = makeStrategies()[0]!;
    const tenSeconds = makeCandidate(10);
    tenSeconds.coreInformationPoints.push({
      messageId: 'message-002',
      message: '同一结构可通过操作直接展示',
      factIds: ['visible-001'],
    });
    tenSeconds.beats[1]!.coreInformationPointIds = ['message-002'];
    expect(validateTkPromptOptionCandidate({
      candidate: tenSeconds,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    }).coreInformationPoints).toHaveLength(2);

    tenSeconds.coreInformationPoints.push({
      messageId: 'message-003',
      message: '第三个卖点',
      factIds: ['visible-001'],
    });
    expect(() => validateTkPromptOptionCandidate({
      candidate: tenSeconds,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toThrow(/核心信息点|上限/u);

    const fifteenSeconds = makeCandidate(15);
    fifteenSeconds.coreInformationPoints.push(
      { messageId: 'message-002', message: '第二个信息点', factIds: ['visible-001'] },
      { messageId: 'message-003', message: '第三个信息点', factIds: ['visible-001'] },
    );
    fifteenSeconds.beats[1]!.coreInformationPointIds = ['message-002'];
    fifteenSeconds.beats[2]!.coreInformationPointIds = ['message-003'];
    expect(validateTkPromptOptionCandidate({
      candidate: fifteenSeconds,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 15,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    }).coreInformationPoints).toHaveLength(3);

    fifteenSeconds.beats[0]!.factIds = [];
    expect(() => validateTkPromptOptionCandidate({
      candidate: fifteenSeconds,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 15,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toThrow(/闭合/u);
  });

  it('5 秒唯一主动作和三阶段由编译器注入公共 beats', () => {
    const candidate = makeCandidate(5);
    const strategy = makeStrategies()[0]!;
    const factPack = makeFactPack({ spokenLanguage: null });
    const validated = validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack,
      durationSeconds: 5,
      spokenLanguage: null,
      imageAssetIds: [ids.image],
    });
    const beats = compileTkPromptCandidateBeats({
      candidate: validated,
      strategy,
      factPack,
      durationSeconds: 5,
    });
    expect(beats.map(beat => beat.action)).toEqual([
      expect.stringContaining('主商品动作：手部指向并按下可见结构；阶段：启动'),
      expect.stringContaining('阶段：连续推进'),
      expect.stringContaining('阶段：完成'),
    ]);
    expect(beats[0]!.subject).toContain('@图片1中的同一主商品');
    expect(beats[0]).not.toHaveProperty('primaryActionId');

    candidate.beats[1]!.actionPhase = 'complete';
    expect(() => validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack,
      durationSeconds: 5,
      spokenLanguage: null,
      imageAssetIds: [ids.image],
    })).toThrow(/actionPhase|阶段/u);
  });

  it('live_presenter 至少一拍使用同一虚构主持人，内部布尔值不泄漏到公共 beat', () => {
    const strategy: TkPromptStrategy = {
      ...makeStrategies()[0]!,
      videoMode: 'live_presenter',
    };
    const candidate = makeCandidate(10);
    expect(() => validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toThrow(/live_presenter|主持人/u);
    candidate.beats[0]!.presenterVisible = true;
    const validated = validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    });
    const beats = compileTkPromptCandidateBeats({
      candidate: validated,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
    });
    expect(beats[0]!.subject).toContain('同一位成年虚构非名人主持人');
    expect(beats[0]).not.toHaveProperty('presenterVisible');
  });

  it('参考图整数索引和运镜连续段预算不可由自由文本绕过', () => {
    const strategy = makeStrategies()[0]!;
    const candidate = makeCandidate(10);
    candidate.beats[0]!.productImageIndex = 2;
    expect(() => validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toThrow(/参考图/u);

    candidate.beats[0]!.productImageIndex = 1;
    candidate.beats[0]!.subject = '自由伪造 @图片1 引用';
    expect(() => validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toThrow(/自由文本|素材编号/u);

    for (const personInstruction of [
      '随机女孩出镜并拿起商品',
      '一个顾客出镜拿起商品',
      '店员出现并演示商品',
      '妈妈露脸口播',
      '学生手持商品出镜',
      'a customer appears and holds the product',
      'feature a shopper who demonstrates the product',
      'a creator speaks to camera',
    ]) {
      const unauthorizedPerson = makeCandidate(10);
      unauthorizedPerson.beats[0]!.subject = personInstruction;
      expect(() => validateTkPromptOptionCandidate({
        candidate: unauthorizedPerson,
        strategy,
        factPack: makeFactPack(),
        durationSeconds: 10,
        spokenLanguage: '英语',
        imageAssetIds: [ids.image],
      })).toThrow(/真人|人物/u);
    }

    for (const facelessInstruction of [
      '仅用户手部操作商品',
      '无脸手部特写',
      '第一视角 POV 操作商品',
      'faceless POV product operation',
    ]) {
      const faceless = makeCandidate(10);
      faceless.beats[0]!.subject = facelessInstruction;
      expect(validateTkPromptOptionCandidate({
        candidate: faceless,
        strategy,
        factPack: makeFactPack(),
        durationSeconds: 10,
        spokenLanguage: '英语',
        imageAssetIds: [ids.image],
      })).toBeTruthy();
    }

    const dense = makeCandidate(10);
    dense.beats.map((beat, index) => {
      beat.movementId = (['locked_off', 'slow_push_in', 'locked_off', 'locked_off'] as const)[index]!;
      return beat;
    });
    expect(() => validateTkPromptOptionCandidate({
      candidate: dense,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toThrow(/运镜|连续段/u);
    const normalizedDense = normalizeTkPromptCandidateCameraMovements({
      candidate: dense,
      durationSeconds: 10,
    });
    expect(normalizedDense.beats.map(beat => beat.movementId)).toEqual([
      'locked_off',
      'slow_push_in',
      'slow_push_in',
      'slow_push_in',
    ]);
    expect(validateTkPromptOptionCandidate({
      candidate: normalizedDense,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toBeTruthy();

    const brokenInformationReference = makeCandidate(10);
    brokenInformationReference.beats[0]!.coreInformationPointIds = [];
    brokenInformationReference.beats[0]!.factIds = [];
    brokenInformationReference.beats[3]!.coreInformationPointIds = ['message-001'];
    brokenInformationReference.beats[3]!.factIds = ['visible-001'];
    expect(() => validateTkPromptOptionCandidate({
      candidate: brokenInformationReference,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toThrow(/核心信息点|引用数量/u);
    const normalizedInformation = normalizeTkPromptCandidateBeatInformation({
      candidate: brokenInformationReference,
      durationSeconds: 10,
    });
    expect(normalizedInformation.beats.map(beat => ({
      points: beat.coreInformationPointIds,
      facts: beat.factIds,
    }))).toEqual([
      { points: ['message-001'], facts: ['visible-001'] },
      { points: ['message-001'], facts: ['visible-001'] },
      { points: ['message-001'], facts: ['visible-001'] },
      { points: [], facts: [] },
    ]);
    expect(validateTkPromptOptionCandidate({
      candidate: normalizedInformation,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toBeTruthy();

    const fiveDense = makeCandidate(5);
    fiveDense.beats[1]!.movementId = 'locked_off';
    expect(() => validateTkPromptOptionCandidate({
      candidate: fiveDense,
      strategy,
      factPack: makeFactPack({ spokenLanguage: null }),
      durationSeconds: 5,
      spokenLanguage: null,
      imageAssetIds: [ids.image],
    })).toThrow(/运镜|连续段/u);

    const fifteenAtBudget = makeCandidate(15);
    (['locked_off', 'locked_off', 'slow_push_in', 'slow_push_in', 'macro_follow'] as const)
      .forEach((movementId, index) => { fifteenAtBudget.beats[index]!.movementId = movementId; });
    expect(validateTkPromptOptionCandidate({
      candidate: fifteenAtBudget,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 15,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toBeTruthy();
    fifteenAtBudget.beats[3]!.movementId = 'lateral_track';
    expect(() => validateTkPromptOptionCandidate({
      candidate: fifteenAtBudget,
      strategy,
      factPack: makeFactPack(),
      durationSeconds: 15,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    })).toThrow(/运镜|连续段/u);
  });

  it('最终 Prompt 门禁拒绝越界引用和中英文正向文字层指令', () => {
    const valid = [
      '【参考图固定映射】@图片1=上传顺序第1张',
      '0–1秒：@图片1中的同一主商品。',
      '1–3秒：@图片1中的同一主商品。',
      '3–7秒：@图片1中的同一主商品。',
      '7–10秒：@图片1中的同一主商品。',
      TK_PROMPT_NON_LIVE_PERSON_BOUNDARY,
      TK_PROMPT_VISUAL_TEXT_BOUNDARY,
    ].join('\n');
    expect(validateTkPromptFinalExecutionPrompt({
      prompt: valid,
      imageCount: 1,
      videoMode: 'product_closeup',
      durationSeconds: 10,
    })).toBe(valid);
    for (const violation of [
      '@图片2中的商品',
      '@图片1.5中的商品',
      '@视频1',
      'show a $9 price sticker',
      'add a speech bubble',
      '显示字幕',
      '屏幕显示一句文字',
      '展示文案',
      '出现贴纸',
      '添加标签',
      '随机女孩出镜并演示商品',
      '一个顾客出镜拿起商品',
      'a shopper appears and holds the product',
      'AUDIO LANGUAGE LOCK: English only',
      'generated by AI',
      '#AIGC',
      'AI创作',
      '人工智能制作',
      '拥有10年经验和十亿 GMV 的专家推荐',
      TK_PROMPT_HOOK_PATTERNS[0]!.internalExample,
      '@图片1中的额外自由引用',
    ]) {
      expect(() => validateTkPromptFinalExecutionPrompt({
        prompt: `${valid}\n${violation}`,
        imageCount: 1,
        videoMode: 'product_closeup',
        durationSeconds: 10,
      })).toThrow();
    }
    for (const safeSuffix of [
      '展示商品包装原有文字和 Logo',
      '仅手部操作与第一视角 POV',
      '展示商品型号 AIGCLEAN-200',
    ]) {
      expect(validateTkPromptFinalExecutionPrompt({
        prompt: `${valid}\n${safeSuffix}`,
        imageCount: 1,
        videoMode: 'product_closeup',
        durationSeconds: 10,
      })).toContain(safeSuffix);
    }
    const soundOnlyValid = [
      '【参考图固定映射】@图片1=上传顺序第1张',
      '0–1秒：@图片1中的商品。',
      '1–3秒：@图片1中的商品。',
      '3–5秒：@图片1中的商品。',
      TK_PROMPT_NON_LIVE_PERSON_BOUNDARY,
      TK_PROMPT_VISUAL_TEXT_BOUNDARY,
    ].join('\n');
    expect(validateTkPromptFinalExecutionPrompt({
      prompt: `${soundOnlyValid}\n无解说、无配音、无人声`,
      imageCount: 1,
      videoMode: 'product_closeup',
      durationSeconds: 5,
    })).toContain('无解说、无配音、无人声');
    for (const soundOnlyViolation of [
      '加入人声旁白', '加入解说', '使用配音',
      'add narration', 'include vocals', 'spoken words', '限时优惠10%',
    ]) {
      expect(() => validateTkPromptFinalExecutionPrompt({
        prompt: `${soundOnlyValid}\n${soundOnlyViolation}`,
        imageCount: 1,
        videoMode: 'product_closeup',
        durationSeconds: 5,
      })).toThrow();
    }
  });

  it('非真人模式的人物门禁只检查视觉指令，不误伤音频中的声音特征', () => {
    const candidate = makeCandidate(10);
    candidate.beats[0]!.soundDesign = '女性旁白自然口播，配合轻微环境声';
    const strategy = makeStrategies()[0]!;
    const factPack = makeFactPack();
    const validated = validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    });
    const prompt = renderTkPromptExecutionPrompt({
      candidate: validated,
      strategy,
      factPack,
      durationSeconds: 10,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    });
    expect(prompt).toContain('声音：女性旁白自然口播');

    expect(() => validateTkPromptFinalExecutionPrompt({
      prompt: prompt.replace('画面：', '画面：女性模特出镜展示商品；'),
      imageCount: 1,
      videoMode: 'scene_demo',
      durationSeconds: 10,
    })).toThrow(/Prompt 不得生成真人/u);
  });

  it('新方案不再接受发布文案产物', () => {
    const candidate = { ...makeCandidate(10), publishPack: { title: '旧发布标题' } };
    expect(() => validateTkPromptOptionCandidate({
      candidate,
      strategy: makeStrategies()[0]!,
      factPack: makeFactPack(),
      durationSeconds: 10,
      spokenLanguage: '英语',
    })).toThrow();
  });

  it('15 秒长字段只在总长超限时由编译器渐进压缩并保留全部硬边界', () => {
    const candidate = makeCandidate(15);
    candidate.title = '商品方案'.repeat(20);
    candidate.beats.forEach(beat => {
      beat.environment = '真实连续场景'.repeat(70);
      beat.subject = '同一商品主体'.repeat(55);
      beat.action = '连续展示商品动作'.repeat(45);
      beat.shotSize = '商品近景'.repeat(25);
      beat.lighting = '自然清晰光线'.repeat(40);
      beat.editingCue = '保持动作连续'.repeat(40);
      beat.soundDesign = '自然环境声与商品操作声'.repeat(35);
      beat.voiceoverTarget = 'See the product detail in action. '.repeat(20);
      beat.voiceoverZh = '查看商品细节与操作方式。'.repeat(30);
    });
    const strategy = makeStrategies()[0]!;
    const factPack = makeFactPack();
    const validated = validateTkPromptOptionCandidate({
      candidate,
      strategy,
      factPack,
      durationSeconds: 15,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    });
    const prompt = renderTkPromptExecutionPrompt({
      candidate: validated,
      strategy,
      factPack,
      durationSeconds: 15,
      spokenLanguage: '英语',
      imageAssetIds: [ids.image],
    });
    expect(prompt.length).toBeLessThanOrEqual(3_800);
    expect(prompt.match(/@图片1/gu)).toHaveLength(6);
    expect(prompt).toContain(TK_PROMPT_NON_LIVE_PERSON_BOUNDARY);
    expect(prompt).toContain(TK_PROMPT_VISUAL_TEXT_BOUNDARY);
  });

  it('Hook 证据推导逐条感知否定且不把方位“前后”当前后对比', () => {
    expect(deriveTkPromptEvidenceFlags({
      userConfirmedFacts: [
        '没有竞品对比素材',
        '无真实评论原文',
        '禁止虚构真实经历',
        '产品前后有两个按钮',
        '无10%折扣证据',
      ],
      verifiedOffer: '',
    })).toEqual(evidenceFlags());
  });

  it('三案任意一对只有三维不同时硬拒绝', () => {
    const strategies = makeStrategies();
    strategies[1] = {
      ...strategies[1]!,
      styleForm: strategies[0]!.styleForm,
      style: strategies[0]!.style,
      hookPatternId: strategies[0]!.hookPatternId,
    };
    expect(() => validateTkPromptStrategySet({
      strategySet: { strategies },
      factPack: makeFactPack(),
      durationSeconds: 10,
      evidenceFlags: { ...evidenceFlags(), sealedPackage: true },
    })).toThrow(/六维|差异/u);
  });
});

const LANGUAGE_SAMPLES = {
  '英语': { label: 'English', voiceover: 'See this detail.' },
  '西班牙语': { label: 'Spanish', voiceover: 'Mira este detalle.' },
  '葡萄牙语': { label: 'Portuguese', voiceover: 'Veja este detalhe.' },
  '法语': { label: 'French', voiceover: 'Regardez ce détail.' },
  '印尼语': { label: 'Indonesian', voiceover: 'Lihat detail ini.' },
  '意大利语': { label: 'Italian', voiceover: 'Guarda questo dettaglio.' },
  '日语': { label: 'Japanese', voiceover: 'この細部を見てください。' },
  '马来语': { label: 'Malay', voiceover: 'Lihat butiran ini.' },
  '泰语': { label: 'Thai', voiceover: 'ดูรายละเอียดนี้' },
  '越南语': { label: 'Vietnamese', voiceover: 'Hãy xem chi tiết này.' },
  '普通话': { label: 'Mandarin Chinese', voiceover: '看看这个细节。' },
  '德语': { label: 'German', voiceover: 'Sieh dir dieses Detail an.' },
  '荷兰语': { label: 'Dutch', voiceover: 'Bekijk dit detail.' },
  '波兰语': { label: 'Polish', voiceover: 'Spójrz na ten szczegół.' },
} as const;

function baseRequest() {
  return {
    imageAssetIds: [ids.image],
    durationSeconds: 10,
    targetMarket: 'United States',
    spokenLanguage: '英语',
    userConfirmedFacts: [],
    forbiddenClaims: [],
    evidenceFlags: evidenceFlags(),
    verifiedOffer: null,
  };
}

function evidenceFlags() {
  return {
    beforeAfter: false,
    competitor: false,
    numeric: false,
    realComment: false,
    popularity: false,
    honestExperience: false,
    sealedPackage: false,
  };
}

function makeFactPack(
  overrides: Partial<TkPromptFactPack> = {},
): TkPromptFactPack {
  return {
    productName: '参考商品',
    category: '家居用品',
    confidence: 'high',
    facts: [{
      factId: 'visible-001',
      status: 'visible',
      text: '商品表面有可见网格结构',
      sourceImageIds: [ids.image],
    }, {
      factId: 'confirmed-002',
      status: 'user-confirmed',
      text: '用户确认已提供未拆封包装素材',
      sourceImageIds: [],
    }],
    internalHypotheses: [],
    demonstrableActions: [makeDemonstrableAction('手部指向并按下可见结构')],
    forbiddenClaims: [],
    availableMaterials: ['product-images'],
    targetMarket: 'United States',
    spokenLanguage: '英语',
    verifiedOffer: null,
    ...overrides,
  };
}

function makeDemonstrableAction(text: string, actionId = 'action-001') {
  return {
    actionId,
    text,
    supportingFactIds: ['visible-001'],
    sourceImageAssetIds: [ids.image],
  };
}

function makeStrategies(): TkPromptStrategy[] {
  return [
    {
      slot: 'safe',
      labelZh: '最稳',
      objective: 'conversion',
      styleForm: 'scene',
      style: 'scene',
      videoMode: 'scene_demo',
      hookPatternId: 'pain_strike',
      firstFrameId: 'pain_reveal',
      firstFrame: '首帧呈现真实不便',
      openingAction: '手部立即指向可见结构',
      openingLine: 'This detail fixes the awkward moment.',
      relevanceBeat: '真实台面中的不便与商品动作连续发生',
      productBridge: '沿同一动作进入商品结构自证',
      buyingMotivationId: 'problem_relief',
      buyingMotivation: '缓解真实使用不便',
      proofMethodId: 'visible_operation',
      proofMethod: '现场完成一次可见操作',
      ctaStrategy: '邀请查看当前商品详情',
      allowedFactIds: ['visible-001', 'confirmed-002'],
      requiredMaterials: [],
    },
    {
      slot: 'native',
      labelZh: '最原生',
      objective: 'trust',
      styleForm: 'product',
      style: 'product_pov',
      videoMode: 'product_closeup',
      hookPatternId: 'sound_hook',
      firstFrameId: 'sound_sync',
      firstFrame: '商品操作拟音与微距动作同步',
      openingAction: '手部按下可见结构并触发卡扣声',
      openingLine: 'Listen to this tiny detail.',
      relevanceBeat: '熟悉的操作声音对应真实使用瞬间',
      productBridge: '音画同步落到结构特写',
      buyingMotivationId: 'confidence',
      buyingMotivation: '通过可见细节建立使用信心',
      proofMethodId: 'structure_closeup',
      proofMethod: '微距展示结构和操作关系',
      ctaStrategy: '邀请用户近看商品细节',
      allowedFactIds: ['visible-001'],
      requiredMaterials: [],
    },
    {
      slot: 'creative',
      labelZh: '最抓眼',
      objective: 'attention',
      styleForm: 'product',
      style: 'unboxing',
      videoMode: 'product_closeup',
      hookPatternId: 'visual_shock',
      firstFrameId: 'unboxing_reveal',
      firstFrame: '首帧以开启动作揭晓商品结构',
      openingAction: '手部打开完整封装并连续移向结构',
      openingLine: 'Wait until you see this part.',
      relevanceBeat: '揭晓动作立刻说明结构与使用场景的关系',
      productBridge: '继续同一开启动作完成场景证明',
      buyingMotivationId: 'curiosity',
      buyingMotivation: '通过结构揭晓满足好奇心',
      proofMethodId: 'context_demo',
      proofMethod: '在真实台面完成场景演示',
      ctaStrategy: '邀请查看商品完整结构',
      allowedFactIds: ['visible-001', 'confirmed-002'],
      requiredMaterials: ['已确认封装'],
    },
  ];
}

function makeCandidate(duration: 5 | 10 | 15): TkPromptOptionCandidate {
  const timeline = duration === 5
    ? [[0, 1, 'stop'], [1, 3, 'relevance'], [3, 5, 'proof']] as const
    : duration === 10
      ? [[0, 1, 'stop'], [1, 3, 'relevance'], [3, 7, 'proof'], [7, 10, 'cta']] as const
      : [[0, 1, 'stop'], [1, 3, 'relevance'], [3, 7, 'proof'], [7, 11, 'resolution'], [11, 15, 'cta']] as const;
  return {
    title: '商品结构自证',
    whyItFits: '使用可见结构和真实操作建立信任',
    coreInformationPoints: [{
      messageId: 'message-001',
      message: '商品表面有可见网格结构',
      factIds: ['visible-001'],
    }],
    primaryActionId: duration === 5 ? 'action-001' : null,
    beats: timeline.map(([startSeconds, endSeconds], index) => ({
      startSeconds,
      endSeconds,
      environment: '真实家居台面',
      subject: '商品可见结构与操作手部',
      action: '手部指向并按下可见结构',
      shotSize: '微距特写',
      coreInformationPointIds: ['message-001'],
      actionPhase: duration === 5 ? (['start', 'progress', 'complete'] as const)[index]! : null,
      productImageIndex: 1,
      presenterVisible: false,
      movementId: 'slow_push_in',
      lighting: '柔和真实室内光',
      editingCue: '在手指按下时切镜',
      soundDesign: '真实按键卡扣声与轻微环境声',
      voiceoverTarget: duration === 5 ? '' : 'See this detail.',
      voiceoverZh: duration === 5 ? '' : '看清这个细节。',
      factIds: ['visible-001'],
    })),
    assumptions: [],
    requiredMaterials: [],
    warnings: [],
  };
}
