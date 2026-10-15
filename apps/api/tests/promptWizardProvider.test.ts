import { describe, expect, it, vi } from 'vitest';
import type {
  PromptWizardCreativeBrief,
  PromptWizardProductProfile,
  PromptWizardVideoConfig,
} from '@lindyson/api-contracts';
import {
  buildPromptWizardDraftContentRepairInput,
  buildPromptWizardDraftFormatRepairInput,
  buildPromptWizardDraftInput,
  buildPromptWizardConceptDirectorInput,
  buildPromptWizardProductAnalysisInput,
  buildPromptWizardProductRepairInput,
  buildPromptWizardProviderCompletionLog,
  buildPromptWizardProviderFailureLog,
  buildPromptWizardProviderRetryLog,
  ArkPromptWizardProvider,
  FakePromptWizardProvider,
  isPromptWizardFakeProviderEnabled,
  PROMPT_WIZARD_DRAFT_MAX_OUTPUT_TOKENS,
  PROMPT_WIZARD_PRODUCT_MAX_OUTPUT_TOKENS,
  PROMPT_WIZARD_SERVICE_TIER,
  PROMPT_WIZARD_THINKING_TYPE,
  validatePromptWizardImages,
} from '../src/providers/promptWizardProvider.js';
import { allocatePromptWizardStrategies } from '../src/domain/promptWizardStrategy.js';
import {
  PROMPT_WIZARD_PLAN_COUNT,
  PROMPT_WIZARD_PLAN_INDEXES,
} from '../src/domain/promptWizardPlanCount.js';
import {
  assertPromptWizardNoFirstLastSemantics,
  normalizePromptWizardRouteDraftV6,
  promptWizardStringLeaves,
  renderPromptWizardPlan,
  type PromptWizardPlanDraft,
} from '../src/domain/promptWizardPrompt.js';
import { allocatePromptWizardEvidence } from '../src/domain/promptWizardEvidence.js';
import {
  generateValidatedPromptWizardPlans,
  generateValidatedPromptWizardRoutePlansV6,
  promptWizardSafeV6ActionEditingCueMotionFallback,
  promptWizardSafeV6EditingCueMotionFallback,
  promptWizardSafeV6FormatRecoverySingleCameraMotionFallback,
  promptWizardSafeV6LightingMotionFallback,
  promptWizardSafeV6MultiCameraMovementMotionFallback,
  promptWizardSafeV6MotionRepairCameraBudgetFallback,
  promptWizardSafeV6ReferenceEditingCueFallback,
} from '../src/domain/promptWizardService.js';
import {
  assertPromptWizardMotionDensity,
  assertPromptWizardVoiceoverCoverage,
  PromptWizardMotionDensityError,
} from '../src/domain/promptWizardConversionQuality.js';
import { buildPromptWizardEvidenceGraph } from '../src/domain/promptWizardEvidenceGraph.js';
import { buildPromptWizardProductionBrief } from '../src/domain/promptWizardCreativePlaybook.js';
import {
  buildPromptWizardRouteSetV6,
  promptWizardRouteContextsV6,
  promptWizardRoutePlanContextsV6,
} from '../src/domain/promptWizardV6Routes.js';
import {
  PromptWizardExecutionBudgetError,
  validatePromptWizardShotExecutionBudget,
} from '../src/domain/promptWizardExecutionBudget.js';
import { validatePromptWizardPlanHistory } from '../src/domain/promptWizardDiversity.js';
import {
  conceptPreviewToAssignment,
  selectPromptWizardConceptPair,
  validatePromptWizardConceptSet,
} from '../src/domain/promptWizardConceptDirector.js';
import { env } from '../src/config/env.js';
import { PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES } from '../src/tools/canaryPromptWizardUseDirections.js';
import { parsePromptWizardCanarySafeTranscript } from '../src/tools/promptWizardCanarySafeEvidence.js';
import { makePromptWizardV4Selection } from './promptWizardV4Fixtures.js';

const PROFILE: PromptWizardProductProfile = {
  productName: '折叠式耳机',
  category: '头戴式耳机',
  colors: '',
  materials: '哑光塑料与软皮',
  structure: '可折叠头梁与椭圆耳罩',
  logo: '右侧耳罩有 Logo',
  usage: '佩戴于双耳',
  suggestedAudience: '通勤用户',
  suggestedScenarios: '通勤与办公',
  visibleFacts: ['黑色外观'],
  needsConfirmation: ['性能参数需用户确认'],
  userConfirmedClaims: '',
  consistencyConstraints: '保持颜色、材质和结构一致',
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

function makeProviderV4Context(
  strategies: ReturnType<typeof allocatePromptWizardStrategies>,
) {
  const selection = makePromptWizardV4Selection({
    runId: 'provider-v4-context',
    ordinal: 1,
    profile: PROFILE,
    brief: BRIEF,
    config: CONFIG,
    strategies,
  });
  return {
    evidenceGraph: selection.evidenceGraph,
    conceptAssignments: selection.conceptAssignments,
  };
}

function makeConceptGenerationContext() {
  const evidenceGraph = buildPromptWizardEvidenceGraph({
    profile: {
      ...PROFILE,
      visibleFacts: ['头梁可以向内折叠', '右侧耳罩有可见按键'],
      userConfirmedClaims: '用户确认按键用于开机',
    },
    imageAssetIds: ['00000000-0000-4000-8000-000000000091'],
  });
  return {
    profile: PROFILE,
    evidenceGraph,
    productionBrief: buildPromptWizardProductionBrief(PROFILE, {
      primaryPurchaseReason: '折叠结构便于收纳',
      appearanceMode: 'hands-only',
      availableScenes: ['办公桌', '通勤座位'],
      availableAssets: ['产品参考图片', '手部素材'],
    }),
    brief: BRIEF,
    config: CONFIG,
    imageCount: 1,
    historicalConcepts: [],
  };
}

describe('提示词向导火山方舟 Responses 输入', () => {
  it('Fake Provider 即使被误配也不能在生产环境启用', () => {
    expect(isPromptWizardFakeProviderEnabled('production', true)).toBe(false);
    expect(isPromptWizardFakeProviderEnabled('development', true)).toBe(true);
    expect(isPromptWizardFakeProviderEnabled('test', false)).toBe(false);
  });

  it('Fake Provider 在手部模式下生成的八条路线通过与生产一致的创意硬门禁', async () => {
    const context = {
      ...makeConceptGenerationContext(),
      config: {
        model: 'seedance-2.0-mini',
        aspectRatio: '9:16',
        resolution: '480p',
        durationSeconds: 5,
      } as const,
    };
    const result = await new FakePromptWizardProvider().generateConcepts(context);
    const validation = validatePromptWizardConceptSet({
      concepts: result.concepts,
      evidenceGraph: context.evidenceGraph,
      brief: context.brief,
      config: context.config,
      productionBrief: context.productionBrief,
    });

    expect(validation.issues).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(result.concepts.every(concept => concept.productionLoad.personCount === 0)).toBe(true);
    expect(selectPromptWizardConceptPair(result.concepts).complementaryDimensions)
      .toBeGreaterThanOrEqual(4);
  });

  it('Fake Provider 的 3.0 入选路线能直接扩写为通过中文门禁的两套 V4 方案', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = {
      ...makeConceptGenerationContext(),
      config: {
        model: 'seedance-2.0-mini',
        aspectRatio: '9:16',
        resolution: '480p',
        durationSeconds: 5,
      } as const,
    };
    try {
      const provider = new FakePromptWizardProvider();
      const conceptResult = await provider.generateConcepts(context);
      const selected = selectPromptWizardConceptPair(conceptResult.concepts);
      const conceptPreviews = [selected.primary, selected.secondary];
      const result = await generateValidatedPromptWizardPlans({
        provider,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        brief: context.brief,
        config: context.config,
        strategies: conceptPreviews.map(concept => concept.strategy),
        conceptAssignments: conceptPreviews.map((concept, index) => (
          conceptPreviewToAssignment(concept, PROMPT_WIZARD_PLAN_INDEXES[index]!)
        )),
        conceptPreviews,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(result.plans).toHaveLength(2);
      expect(result.plans.every(plan => plan.deliveryVersion === 4)).toBe(true);
      expect(result.plans.every(plan => !plan.prompt.includes('profile:'))).toBe(true);

      const refreshConceptResult = await provider.generateConcepts({
        ...context,
        historicalConcepts: conceptResult.concepts,
      });
      const refreshConceptValidation = validatePromptWizardConceptSet({
        concepts: refreshConceptResult.concepts,
        evidenceGraph: context.evidenceGraph,
        brief: context.brief,
        config: context.config,
        productionBrief: context.productionBrief,
        historicalConcepts: conceptResult.concepts,
      });
      expect(refreshConceptValidation.issues).toEqual([]);
      expect(new Set([
        ...conceptResult.concepts.map(concept => concept.firstSecondEvent),
        ...refreshConceptResult.concepts.map(concept => concept.firstSecondEvent),
      ])).toHaveLength(16);
      const refreshSelected = selectPromptWizardConceptPair(refreshConceptResult.concepts);
      const refreshPreviews = [refreshSelected.primary, refreshSelected.secondary];
      const refreshResult = await generateValidatedPromptWizardPlans({
        provider,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        brief: context.brief,
        config: context.config,
        strategies: refreshPreviews.map(concept => concept.strategy),
        conceptAssignments: refreshPreviews.map((concept, index) => (
          conceptPreviewToAssignment(concept, PROMPT_WIZARD_PLAN_INDEXES[index]!)
        )),
        conceptPreviews: refreshPreviews,
        imageCount: context.imageCount,
        variationKey: 2,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: result.plans,
      });
      expect(refreshResult.plans).toHaveLength(2);
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('Fake Provider 的 V6 付费换批会保留三角色并产出通过历史差异门禁的新表达', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000301',
      runId: '00000000-0000-4000-8000-000000000302',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const common = {
      provider: new FakePromptWizardProvider(),
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      voiceoverLanguage: context.brief.targetLanguage,
      verifiedOffer: '',
      config: context.config,
      routeSet,
      imageCount: context.imageCount,
      deadlineAtMs: Date.now() + 240_000,
    };
    try {
      const first = await generateValidatedPromptWizardRoutePlansV6({
        ...common,
        variationKey: 1,
        historicalPlans: [],
      });
      const refresh = await generateValidatedPromptWizardRoutePlansV6({
        ...common,
        variationKey: 2,
        historicalPlans: first.plans,
      });

      expect(first.plans.map(plan => plan.deliveryVersion === 6 ? plan.role : null))
        .toEqual(['proof-conversion', 'problem-hook', 'lifestyle-seeding']);
      expect(refresh.plans.map(plan => plan.deliveryVersion === 6 ? plan.role : null))
        .toEqual(['proof-conversion', 'problem-hook', 'lifestyle-seeding']);
      expect(validatePromptWizardPlanHistory(refresh.plans, first.plans)).toEqual([]);
      const duplicateIssues = validatePromptWizardPlanHistory(first.plans, first.plans);
      expect(duplicateIssues).toHaveLength(3);
      expect(new Set(duplicateIssues.map(issue => issue.planIndexes[0])))
        .toEqual(new Set([0, 1, 2]));
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 plan2 与 plan1 冲突时只引用精确冲突方案且仅请求真实创意字段', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000305',
      runId: '00000000-0000-4000-8000-000000000306',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const collapsedRouteSet = structuredClone(routeSet);
    const problemRoute = collapsedRouteSet.routes[1]!;
    const lifestyleRoute = collapsedRouteSet.routes[2]!;
    collapsedRouteSet.routes[2] = {
      ...problemRoute,
      id: lifestyleRoute.id,
      role: 'lifestyle-seeding',
      titleZh: lifestyleRoute.titleZh,
      directionExplanationZh: lifestyleRoute.directionExplanationZh,
      hookZh: lifestyleRoute.hookZh,
    };
    const draftContexts = promptWizardRouteContextsV6(collapsedRouteSet);
    const fakeProvider = new FakePromptWizardProvider();
    const generated = await fakeProvider.generateUseDirectionDrafts({
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      targetLanguage: context.brief.targetLanguage,
      confirmedOffer: '',
      config: context.config,
      planContexts: draftContexts,
      imageCount: context.imageCount,
      variationKey: 1,
    });
    const preparedDrafts = generated.drafts.map(draft => structuredClone(draft));
    preparedDrafts[1] = {
      ...preparedDrafts[1]!,
      segments: preparedDrafts[1]!.segments.map(segment => ({
        ...segment,
        cameraMovement: '镜头持续横移并跟随产品动作',
        lightingAndRealism: `${segment.lightingAndRealism}，真实环境光影持续移动`,
      })),
    };
    const plan1 = preparedDrafts[1]!;
    const plan2 = preparedDrafts[2]!;
    preparedDrafts[2] = {
      ...plan2,
      hook: plan1.hook,
      segments: plan2.segments.map((segment, segmentIndex) => {
        const reference = plan1.segments[segmentIndex]!;
        return {
          ...segment,
          shotSize: reference.shotSize,
          action: reference.action,
          cameraMovement: '镜头持续横移并跟随产品动作',
          lightingAndRealism: `${reference.lightingAndRealism}，真实环境光影持续移动`,
          voiceover: reference.voiceover,
          voiceoverZh: reference.voiceoverZh,
          foley: reference.foley,
          editingCue: reference.editingCue,
        };
      }),
    };
    const generateSpy = vi.fn(async (input: Parameters<typeof fakeProvider.generateUseDirectionDrafts>[0]) => {
      const planIndex = input.planContexts[0]!.planIndex;
      return {
        drafts: [structuredClone(preparedDrafts[planIndex]!)],
        usage: generated.usage,
        repairRounds: 0,
        formatRepairCount: 0,
      };
    });
    const repairSpy = vi.fn(async (
      _input: Parameters<typeof fakeProvider.repairUseDirectionDrafts>[0],
    ) => {
      throw Object.assign(new Error('测试在捕获精确差异修复上下文后停止'), {
        code: 'PROMPT_WIZARD_TEST_STOP',
      });
    });

    try {
      await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        voiceoverLanguage: context.brief.targetLanguage,
        verifiedOffer: '',
        config: context.config,
        routeSet: collapsedRouteSet,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      }).catch(cause => cause);

      const plan2Repair = repairSpy.mock.calls
        .map(([input]) => input)
        .find(input => input.issues[0]?.planIndex === 2);
      expect(plan2Repair?.issues).toEqual([
        expect.objectContaining({
          planIndex: 2,
          referencePlanIndex: 1,
          errorCode: 'PROMPT_WIZARD_DIVERSITY_FAILED',
        }),
      ]);
      expect(plan2Repair?.issues[0]?.fieldPaths).toEqual(expect.arrayContaining([
        'segments[0].shotSize',
        'segments[0].cameraMovement',
        'segments[0].editingCue',
        'segments[3].action',
        'segments[3].voiceover',
        'segments[3].voiceoverZh',
      ]));
      expect(plan2Repair?.issues[0]?.fieldPaths).not.toEqual(expect.arrayContaining([
        'hook',
        'name',
        'narrative',
        'primaryScene',
        'cameraAndPacing',
        'planningReview.realPainPoint',
        'segments[0].location',
        'segments[0].action',
      ]));
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 不把 verifiedOffer 等编译层字段误交给单方案 Provider 修复', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000311',
      runId: '00000000-0000-4000-8000-000000000312',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const provider = new FakePromptWizardProvider();
    const generateDrafts = provider.generateUseDirectionDrafts.bind(provider);
    vi.spyOn(provider, 'generateUseDirectionDrafts').mockImplementation(input => (
      generateDrafts({ ...input, confirmedOffer: '' })
    ));
    const repairSpy = vi.spyOn(provider, 'repairUseDirectionDrafts');
    try {
      await expect(generateValidatedPromptWizardRoutePlansV6({
        provider,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        voiceoverLanguage: context.brief.targetLanguage,
        // 故意不把优惠写入证据图谱，验证编译层证据错误保持原始语义。
        verifiedOffer: '当前订单满 100 元减 10 元',
        config: context.config,
        routeSet,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      })).rejects.toMatchObject({
        code: 'PROMPT_WIZARD_EVIDENCE_UNAVAILABLE',
        fieldPaths: ['verifiedOffer'],
      });
      expect(repairSpy).not.toHaveBeenCalled();
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 服务拒绝单方案同时返回内容修复轮次与格式修复计数', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-00000000030a',
      runId: '00000000-0000-4000-8000-00000000030b',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 1 as const;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      if (input.planContexts[0]?.planIndex !== targetPlanIndex) return result;
      return {
        ...result,
        repairRounds: 1,
        formatRepairCount: 1,
      };
    });
    const repairSpy = vi.fn((input: Parameters<typeof repairDrafts>[0]) => (
      repairDrafts(input)
    ));

    try {
      await expect(generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        voiceoverLanguage: context.brief.targetLanguage,
        verifiedOffer: '',
        config: context.config,
        routeSet,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      })).rejects.toMatchObject({
        code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
        repairRounds: 0,
        planIndexes: [targetPlanIndex],
      });
      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).not.toHaveBeenCalled();
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 首轮内部修复的安全诊断必须逐索引与物理计数完全对账', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-00000000030c',
      runId: '00000000-0000-4000-8000-00000000030d',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 1 as const;
    const diagnostic = {
      planIndex: targetPlanIndex,
      origin: 'initial-schema' as const,
      repairRound: 1 as const,
      errorCode: 'PROMPT_WIZARD_TIMELINE_INVALID',
      fieldPaths: ['segments'],
    };
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      return input.planContexts[0]?.planIndex === targetPlanIndex
        ? { ...result, repairRounds: 1, repairDiagnostics: [diagnostic] }
        : result;
    });

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairDrafts,
        } as never,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        voiceoverLanguage: context.brief.targetLanguage,
        verifiedOffer: '',
        config: context.config,
        routeSet,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      expect(result.repairDiagnostics).toContainEqual(diagnostic);
      result.contentRepairRequestCounts.forEach((count, planIndex) => {
        expect(result.repairDiagnostics.filter(item => (
          item.planIndex === planIndex && item.origin !== 'terminal-calibration'
        ))).toHaveLength(count);
      });
      result.terminalCalibrationRequestCounts.forEach((count, planIndex) => {
        expect(result.repairDiagnostics.filter(item => (
          item.planIndex === planIndex && item.origin === 'terminal-calibration'
        ))).toHaveLength(count);
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 服务透传与当前单方案索引一致的白名单输出诊断', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-00000000035a',
      runId: '00000000-0000-4000-8000-00000000035b',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const diagnostic = {
      planIndex: 1 as const,
      operation: 'generate-drafts' as const,
      stage: 'initial' as const,
      phase: 'decoded' as const,
      classification: 'valid-json' as const,
      normalizationMode: 'native' as const,
      schemaIssue: 'not-applicable' as const,
      outputLengthBucket: '1-2048' as const,
      containerDepthBucket: '1-4' as const,
      outputTextSource: 'completed' as const,
      fieldPaths: [] as string[],
    };
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      return input.planContexts[0]?.planIndex === diagnostic.planIndex
        ? { ...result, outputDiagnostics: [diagnostic] }
        : result;
    });

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: fakeProvider.repairUseDirectionDrafts.bind(fakeProvider),
        } as never,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        voiceoverLanguage: context.brief.targetLanguage,
        verifiedOffer: '',
        config: context.config,
        routeSet,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(result.outputDiagnostics).toContainEqual(diagnostic);
      expect(JSON.stringify(result.outputDiagnostics)).not.toMatch(/正文|providerBody|responseText/iu);
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 T053533：双方案各一次内容修复后本地收口 singleton lighting 与 CTA 动作', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '服饰-10s-zh',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const productionBrief = buildPromptWizardProductionBrief(testCase.profile);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000530',
      runId: '00000000-0000-4000-8000-000000000531',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief,
      createdAt: '2026-08-10T05:35:33.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const unsafeLighting = '固定机位下光影移动但光线保持静止不变';
    const unsafeCtaAction = '人物保持不动并完成收束';
    const repairedDrafts = new Map<number, PromptWizardPlanDraft>();
    const physicalContentCounts = [0, 0, 0];

    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      const planIndex = input.planContexts[0]!.planIndex;
      if (!result.drafts[0]) return result;
      const lastIndex = result.drafts[0].segments.length - 1;
      result.drafts[0] = {
        ...result.drafts[0],
        segments: result.drafts[0].segments.map((segment, index) => ({
          ...segment,
          lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          ...(planIndex === 0 && index === lastIndex
            ? { lightingAndRealism: unsafeLighting }
            : {}),
          ...(planIndex === 1 && index === lastIndex
            ? { action: unsafeCtaAction }
            : {}),
        })),
      };
      return result;
    });
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      const result = await repairDrafts(input);
      const issue = input.issues[0]!;
      physicalContentCounts[issue.planIndex] += 1;
      const draft = structuredClone(input.previousDrafts[issue.planIndex]!);
      repairedDrafts.set(issue.planIndex, structuredClone(draft));
      return {
        ...result,
        drafts: [{
          ...result.drafts[0]!,
          planIndex: issue.planIndex,
          draft,
        }],
      };
    });
    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: testCase.profile,
        evidenceGraph,
        voiceoverLanguage: '普通话',
        verifiedOffer: '',
        config: testCase.config,
        routeSet,
        imageCount: 1,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).toHaveBeenCalledTimes(2);
      expect(physicalContentCounts).toEqual([1, 1, 0]);
      expect(result.repairRounds).toBe(1);
      expect(result.contentRepairRequestCounts).toEqual([1, 1, 0]);
      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      expect(result.formatRepairCount).toBe(0);
      expect(result.repairDiagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          planIndex: 0,
          origin: 'domain-validation',
          repairRound: 1,
          errorCode: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
          fieldPaths: ['segments[2].lightingAndRealism'],
        }),
        expect.objectContaining({
          planIndex: 1,
          origin: 'domain-validation',
          repairRound: 1,
          errorCode: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
          fieldPaths: ['segments[2].action'],
        }),
      ]));
      expect(result.repairDiagnostics).toHaveLength(2);
      expect(result.plans.map(plan => plan.deliveryVersion === 6 ? plan.role : null))
        .toEqual(['proof-conversion', 'problem-hook', 'lifestyle-seeding']);
      expect(result.drafts.map(draft => draft.segments.map(segment => segment.role)))
        .toEqual([
          ['hook', 'proof-resolution', 'cta'],
          ['hook', 'proof-resolution', 'cta'],
          ['hook', 'proof-resolution', 'cta'],
        ]);

      const beforeLightingFallback = repairedDrafts.get(0)!;
      const finalLightingDraft = result.drafts[0]!;
      expect(beforeLightingFallback.segments[2]!.lightingAndRealism).toBe(unsafeLighting);
      expect(finalLightingDraft.segments[2]!.lightingAndRealism)
        .toBe('真实环境光与反光移动随主体和镜头运动自然变化，材质表现保持连续');
      const maskLighting = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        segments: draft.segments.map((segment, index) => index === 2
          ? { ...segment, lightingAndRealism: '__lighting__' }
          : segment),
      });
      expect(maskLighting(finalLightingDraft)).toEqual(maskLighting(beforeLightingFallback));
      expect(() => assertPromptWizardMotionDensity({
        shots: finalLightingDraft.segments,
        durationSeconds: 10,
      })).not.toThrow();
      expect(result.plans[0]!.prompt).toContain(
        '光线与真实感：真实环境光与反光移动随主体和镜头运动自然变化，材质表现保持连续',
      );

      const beforeCtaFallback = repairedDrafts.get(1)!;
      const finalCtaDraft = result.drafts[1]!;
      expect(beforeCtaFallback.segments[2]!.action).toBe(unsafeCtaAction);
      expect(finalCtaDraft.segments[2]!.action).not.toBe(unsafeCtaAction);
      expect(finalCtaDraft.segments[2]!.action).toMatch(/持续|移动|推进/u);
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 lighting singleton 只接受真实、实时、规范且口播结构安全的一次修复证据', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '服饰-10s-zh',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000532',
      runId: '00000000-0000-4000-8000-000000000533',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-10T05:35:33.100Z',
    });
    const fakeProvider = new FakePromptWizardProvider();

    try {
      const generated = await fakeProvider.generateUseDirectionDrafts({
        profile: testCase.profile,
        evidenceGraph,
        targetLanguage: '普通话',
        confirmedOffer: '',
        config: testCase.config,
        planContexts: [promptWizardRouteContextsV6(routeSet)[0]!],
        imageCount: 1,
        variationKey: 1,
      });
      const draft = structuredClone(generated.drafts[0]!);
      draft.segments = draft.segments.map((segment, index) => ({
        ...segment,
        role: ['hook', 'proof-resolution', 'cta'][index] as typeof segment.role,
        lightingAndRealism: index === 2
          ? '固定机位下光影移动但光线保持静止不变'
          : `${segment.lightingAndRealism}，窗边光影移动`,
      }));
      let exactError: PromptWizardMotionDensityError | null = null;
      try {
        assertPromptWizardMotionDensity({ shots: draft.segments, durationSeconds: 10 });
      } catch (error) {
        if (error instanceof PromptWizardMotionDensityError) exactError = error;
      }
      expect(exactError?.fieldPaths).toEqual(['segments[2].lightingAndRealism']);
      const baseInput = {
        error: exactError!,
        draft,
        config: testCase.config,
        targetLanguage: '普通话',
        contentRepairRequestCount: 1,
        deliveryVersion: 6 as const,
      };
      const eligible = promptWizardSafeV6LightingMotionFallback(baseInput);
      expect(eligible?.segmentIndex).toBe(2);
      expect(eligible?.draft.segments[2]?.lightingAndRealism)
        .toBe('真实环境光与反光移动随主体和镜头运动自然变化，材质表现保持连续');
      expect(() => assertPromptWizardMotionDensity({
        shots: eligible!.draft.segments,
        durationSeconds: 10,
      })).not.toThrow();

      const errorWithPaths = (fieldPaths: string[]) => {
        const error = new PromptWizardMotionDensityError(
          ['segments[2].lightingAndRealism'],
          '画面动态密度不足',
        );
        error.fieldPaths.splice(0, error.fieldPaths.length, ...fieldPaths);
        return error;
      };
      const draftWith = (mutate: (value: PromptWizardPlanDraft) => void) => {
        const value = structuredClone(draft);
        mutate(value);
        return value;
      };
      const rejectedInputs: Array<{
        name: string;
        input: Parameters<typeof promptWizardSafeV6LightingMotionFallback>[0];
      }> = [
        {
          name: '伪造普通 Error',
          input: {
            ...baseInput,
            error: Object.assign(new Error('伪造动态错误'), {
              code: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
              fieldPaths: ['segments[2].lightingAndRealism'],
            }),
          },
        },
        {
          name: '混合 lighting 与 action 路径',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[2].lightingAndRealism',
              'segments[2].action',
            ]),
          },
        },
        {
          name: '重复原始路径',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[2].lightingAndRealism',
              'segments[2].lightingAndRealism',
            ]),
          },
        },
        {
          name: '索引含前导零',
          input: { ...baseInput, error: errorWithPaths(['segments[02].lightingAndRealism']) },
        },
        {
          name: '索引越界',
          input: { ...baseInput, error: errorWithPaths(['segments[3].lightingAndRealism']) },
        },
        {
          name: '尚未消费内容修复',
          input: { ...baseInput, contentRepairRequestCount: 0 },
        },
        {
          name: '已经消费两次内容修复',
          input: { ...baseInput, contentRepairRequestCount: 2 },
        },
        {
          name: '非 V6 交付',
          input: { ...baseInput, deliveryVersion: 5 },
        },
        {
          name: '实时 Draft 已不再复现错误',
          input: { ...baseInput, draft: eligible!.draft },
        },
        {
          name: '实时职责不符合权威 V6 时间轴',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[1]!.role = 'proof'; }),
          },
        },
        {
          name: '实时 Draft 非 Schema 规范快照',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[0]!.lightingAndRealism += ' '; }),
          },
        },
      ];
      rejectedInputs.forEach(({ name, input }) => {
        expect(promptWizardSafeV6LightingMotionFallback(input), name).toBeNull();
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 editingCue singleton 只接受真实、实时、规范且口播结构安全的一次修复证据', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '服饰-10s-zh',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000536',
      runId: '00000000-0000-4000-8000-000000000537',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-11T00:15:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();

    try {
      const generated = await fakeProvider.generateUseDirectionDrafts({
        profile: testCase.profile,
        evidenceGraph,
        targetLanguage: '普通话',
        confirmedOffer: '',
        config: testCase.config,
        planContexts: [promptWizardRouteContextsV6(routeSet)[0]!],
        imageCount: 1,
        variationKey: 1,
      });
      const draft = structuredClone(generated.drafts[0]!);
      draft.segments = draft.segments.map((segment, index) => ({
        ...segment,
        role: ['hook', 'proof-resolution', 'cta'][index] as typeof segment.role,
        lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
        editingCue: index === 0 ? '画面定格' : segment.editingCue,
      }));
      let exactError: PromptWizardMotionDensityError | null = null;
      try {
        assertPromptWizardMotionDensity({ shots: draft.segments, durationSeconds: 10 });
      } catch (error) {
        if (error instanceof PromptWizardMotionDensityError) exactError = error;
      }
      expect(exactError?.fieldPaths).toEqual(['segments[0].editingCue']);
      const baseInput = {
        error: exactError!,
        draft,
        config: testCase.config,
        targetLanguage: '普通话',
        contentRepairRequestCount: 1,
        deliveryVersion: 6 as const,
      };
      const eligible = promptWizardSafeV6EditingCueMotionFallback(baseInput);
      expect(eligible?.segmentIndex).toBe(0);
      expect(eligible?.draft.segments[0]?.editingCue)
        .toBe('沿当前镜头动作点切换景别，保持画面连续');
      expect(() => assertPromptWizardMotionDensity({
        shots: eligible!.draft.segments,
        durationSeconds: 10,
      })).not.toThrow();
      const maskEditingCue = (value: PromptWizardPlanDraft) => ({
        ...value,
        segments: value.segments.map((segment, index) => index === 0
          ? { ...segment, editingCue: '__editingCue__' }
          : segment),
      });
      expect(maskEditingCue(eligible!.draft)).toEqual(maskEditingCue(draft));

      const errorWithPaths = (fieldPaths: string[]) => {
        const error = new PromptWizardMotionDensityError(
          ['segments[0].editingCue'],
          '画面动态密度不足',
        );
        error.fieldPaths.splice(0, error.fieldPaths.length, ...fieldPaths);
        return error;
      };
      const draftWith = (mutate: (value: PromptWizardPlanDraft) => void) => {
        const value = structuredClone(draft);
        mutate(value);
        return value;
      };
      const rejectedInputs: Array<{
        name: string;
        input: Parameters<typeof promptWizardSafeV6EditingCueMotionFallback>[0];
      }> = [
        {
          name: '伪造普通 Error',
          input: {
            ...baseInput,
            error: Object.assign(new Error('伪造动态错误'), {
              code: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
              fieldPaths: ['segments[0].editingCue'],
            }),
          },
        },
        {
          name: '混合 editingCue 与 cameraMovement 路径',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[0].editingCue',
              'segments[0].cameraMovement',
            ]),
          },
        },
        {
          name: '重复原始路径',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[0].editingCue',
              'segments[0].editingCue',
            ]),
          },
        },
        {
          name: '索引含前导零',
          input: { ...baseInput, error: errorWithPaths(['segments[00].editingCue']) },
        },
        {
          name: '索引越界',
          input: { ...baseInput, error: errorWithPaths(['segments[3].editingCue']) },
        },
        {
          name: '尚未消费内容修复',
          input: { ...baseInput, contentRepairRequestCount: 0 },
        },
        {
          name: '已经消费两次内容修复',
          input: { ...baseInput, contentRepairRequestCount: 2 },
        },
        {
          name: '非 V6 交付',
          input: { ...baseInput, deliveryVersion: 5 },
        },
        {
          name: '实时 Draft 已不再复现错误',
          input: { ...baseInput, draft: eligible!.draft },
        },
        {
          name: '实时职责不符合权威 V6 时间轴',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[1]!.role = 'proof'; }),
          },
        },
        {
          name: '实时 Draft 非 Schema 规范快照',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[0]!.editingCue += ' '; }),
          },
        },
      ];
      rejectedInputs.forEach(({ name, input }) => {
        expect(promptWizardSafeV6EditingCueMotionFallback(input), name).toBeNull();
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 首尾帧 editingCue 终态收口只接受两轮后权威实时复现的唯一叶子', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '宠物用品-10s-ja',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000584',
      runId: '00000000-0000-4000-8000-000000000585',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-13T01:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();

    try {
      const generated = await fakeProvider.generateUseDirectionDrafts({
        profile: testCase.profile,
        evidenceGraph,
        targetLanguage: '日语',
        confirmedOffer: '',
        config: testCase.config,
        planContexts: [promptWizardRouteContextsV6(routeSet)[1]!],
        imageCount: 1,
        variationKey: 1,
      });
      const draft = structuredClone(generated.drafts[0]!);
      draft.segments = draft.segments.map((segment, index) => ({
        ...segment,
        role: ['hook', 'proof-resolution', 'cta'][index] as typeof segment.role,
        lightingAndRealism: `${segment.lightingAndRealism}，环境光影持续移动`,
        ...(index === 0
          ? { editingCue: '尾帧沿当前镜头动作点切换景别，保持画面连续' }
          : {}),
      }));
      expect(() => assertPromptWizardMotionDensity({
        shots: draft.segments,
        durationSeconds: testCase.config.durationSeconds,
      })).not.toThrow();
      expect(validatePromptWizardShotExecutionBudget({
        shots: draft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);

      let exactError: unknown;
      try {
        assertPromptWizardNoFirstLastSemantics(promptWizardStringLeaves(draft));
      } catch (error) {
        exactError = error;
      }
      expect(exactError).toMatchObject({
        code: 'PROMPT_WIZARD_REFERENCE_MODE_INVALID',
        fieldPaths: ['segments[0].editingCue'],
      });
      const baseInput = {
        error: exactError,
        draft,
        config: testCase.config,
        targetLanguage: '日语',
        contentRepairRequestCount: 2,
        formatRecovered: false,
        deliveryVersion: 6 as const,
      };
      const eligible = promptWizardSafeV6ReferenceEditingCueFallback(baseInput);
      expect(eligible?.segmentIndex).toBe(0);
      expect(eligible?.draft.segments[0]?.editingCue)
        .toBe('沿当前镜头动作点切换景别，保持画面连续');
      expect(() => assertPromptWizardNoFirstLastSemantics(
        promptWizardStringLeaves(eligible!.draft),
      )).not.toThrow();
      expect(() => assertPromptWizardMotionDensity({
        shots: eligible!.draft.segments,
        durationSeconds: testCase.config.durationSeconds,
      })).not.toThrow();
      expect(validatePromptWizardShotExecutionBudget({
        shots: eligible!.draft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);
      const maskEditingCue = (value: PromptWizardPlanDraft) => ({
        ...value,
        segments: value.segments.map((segment, index) => index === 0
          ? { ...segment, editingCue: '__editingCue__' }
          : segment),
      });
      expect(maskEditingCue(eligible!.draft)).toEqual(maskEditingCue(draft));

      const errorWithPaths = (fieldPaths: unknown[]) => Object.assign(
        new Error('全能参考向导不能输出首尾帧语义'),
        {
          code: 'PROMPT_WIZARD_REFERENCE_MODE_INVALID',
          fieldPaths,
        },
      );
      const draftWith = (mutate: (value: PromptWizardPlanDraft) => void) => {
        const value = structuredClone(draft);
        mutate(value);
        return value;
      };
      const overBudgetDraft = draftWith(value => {
        value.segments.forEach((segment, index) => {
          segment.location = `互不相同的场景${index + 1}`;
        });
      });
      const motionInvalidDraft = draftWith(value => {
        value.segments[0]!.editingCue = '尾帧画面完全定格';
      });
      const rejectedInputs: Array<{
        name: string;
        input: Parameters<typeof promptWizardSafeV6ReferenceEditingCueFallback>[0];
      }> = [
        {
          name: '伪造非 Error 对象',
          input: {
            ...baseInput,
            error: {
              code: 'PROMPT_WIZARD_REFERENCE_MODE_INVALID',
              fieldPaths: ['segments[0].editingCue'],
            },
          },
        },
        {
          name: '混入 productionNote',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[0].editingCue',
              'segments[0].productionNote',
            ]),
          },
        },
        {
          name: '重复路径',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[0].editingCue',
              'segments[0].editingCue',
            ]),
          },
        },
        {
          name: '路径数组混入非字符串',
          input: { ...baseInput, error: errorWithPaths([3]) },
        },
        {
          name: '索引含前导零',
          input: { ...baseInput, error: errorWithPaths(['segments[00].editingCue']) },
        },
        {
          name: '索引越界',
          input: { ...baseInput, error: errorWithPaths(['segments[3].editingCue']) },
        },
        { name: '尚未修复', input: { ...baseInput, contentRepairRequestCount: 0 } },
        { name: '只修复一次', input: { ...baseInput, contentRepairRequestCount: 1 } },
        { name: '非法第三次计数', input: { ...baseInput, contentRepairRequestCount: 3 } },
        { name: '经过格式恢复', input: { ...baseInput, formatRecovered: true } },
        { name: 'V4 不进入', input: { ...baseInput, deliveryVersion: 4 } },
        { name: 'V5 不进入', input: { ...baseInput, deliveryVersion: 5 } },
        { name: '缺少目标语言', input: { ...baseInput, targetLanguage: undefined } },
        {
          name: '实时 Draft 已不复现错误',
          input: { ...baseInput, draft: eligible!.draft },
        },
        {
          name: '实时 Draft 多出另一首尾帧路径',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[1]!.productionNote = '首帧保持产品一致'; }),
          },
        },
        {
          name: '职责不符合 V6 时间轴',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[1]!.role = 'proof'; }),
          },
        },
        {
          name: '非规范 Draft',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[1]!.foley += ' '; }),
          },
        },
        {
          name: '非规范 config',
          input: {
            ...baseInput,
            config: {
              ...testCase.config,
              aspectRatio: ' 9:16' as PromptWizardVideoConfig['aspectRatio'],
            },
          },
        },
        { name: '原稿已有执行预算问题', input: { ...baseInput, draft: overBudgetDraft } },
        { name: '原稿已有动态密度问题', input: { ...baseInput, draft: motionInvalidDraft } },
      ];
      rejectedInputs.forEach(({ name, input }) => {
        expect(promptWizardSafeV6ReferenceEditingCueFallback(input), name).toBeNull();
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 action + editingCue 联合收口只接受两次修复后的实时规范证据', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '家居-10s-es',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000566',
      runId: '00000000-0000-4000-8000-000000000567',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-12T05:30:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();

    try {
      const routeContext = promptWizardRouteContextsV6(routeSet)[0]!;
      const generated = await fakeProvider.generateUseDirectionDrafts({
        profile: testCase.profile,
        evidenceGraph,
        targetLanguage: '西班牙语',
        confirmedOffer: '',
        config: testCase.config,
        planContexts: [routeContext],
        imageCount: 1,
        variationKey: 1,
      });
      const draft = structuredClone(generated.drafts[0]!);
      draft.segments = draft.segments.map((segment, index) => ({
        ...segment,
        role: ['hook', 'proof-resolution', 'cta'][index] as typeof segment.role,
        lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
        ...(index === 0 ? { editingCue: '画面定格' } : {}),
        ...(index === 2 ? { action: '产品保持不动并完成收束' } : {}),
      }));
      let exactError: PromptWizardMotionDensityError | null = null;
      try {
        assertPromptWizardMotionDensity({
          shots: draft.segments,
          durationSeconds: testCase.config.durationSeconds,
        });
      } catch (error) {
        if (error instanceof PromptWizardMotionDensityError) exactError = error;
      }
      expect(exactError?.fieldPaths).toEqual([
        'segments[0].editingCue',
        'segments[2].action',
      ]);
      expect(validatePromptWizardShotExecutionBudget({
        shots: draft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);

      const context = {
        planIndex: 0 as const,
        variant: routeContext.variant,
        useDirection: routeContext.useDirection,
        selectedScene: routeContext.selectedScene,
      };
      const baseInput = {
        error: exactError!,
        draft,
        context,
        config: testCase.config,
        targetLanguage: '西班牙语',
        contentRepairRequestCount: 2,
        formatRecovered: false,
        deliveryVersion: 6 as const,
      };
      const eligible = promptWizardSafeV6ActionEditingCueMotionFallback(baseInput);
      expect(eligible?.editingCueSegmentIndexes).toEqual([0]);
      expect(eligible?.actionSegmentIndexes).toEqual([2]);
      expect(eligible?.draft.segments[0]?.editingCue)
        .toBe('沿当前镜头动作点切换景别，保持画面连续');
      expect(eligible?.draft.segments[2]?.action).not.toBe(draft.segments[2]?.action);
      expect(eligible?.draft.segments[2]?.action).toMatch(/持续/u);
      expect(() => assertPromptWizardMotionDensity({
        shots: eligible!.draft.segments,
        durationSeconds: testCase.config.durationSeconds,
      })).not.toThrow();
      expect(validatePromptWizardShotExecutionBudget({
        shots: eligible!.draft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);
      const maskOwnedLeaves = (value: PromptWizardPlanDraft) => ({
        ...value,
        segments: value.segments.map((segment, index) => ({
          ...segment,
          ...(index === 0 ? { editingCue: '__editingCue__' } : {}),
          ...(index === 2 ? { action: '__action__' } : {}),
        })),
      });
      expect(maskOwnedLeaves(eligible!.draft)).toEqual(maskOwnedLeaves(draft));
      expect(draft.segments[0]?.editingCue).toBe('画面定格');
      expect(draft.segments[2]?.action).toBe('产品保持不动并完成收束');

      const errorWithPaths = (fieldPaths: string[]) => {
        const error = new PromptWizardMotionDensityError(
          ['segments[0].editingCue', 'segments[2].action'],
          '画面动态密度不足',
        );
        error.fieldPaths.splice(0, error.fieldPaths.length, ...fieldPaths);
        return error;
      };
      const draftWith = (mutate: (value: PromptWizardPlanDraft) => void) => {
        const value = structuredClone(draft);
        mutate(value);
        return value;
      };
      const overBudgetDraft = draftWith(value => {
        value.segments.forEach((segment, index) => {
          segment.location = `互不相同的场景${index + 1}`;
        });
      });
      expect(validatePromptWizardShotExecutionBudget({
        shots: overBudgetDraft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      }).length).toBeGreaterThan(0);

      const rejectedInputs: Array<{
        name: string;
        input: Parameters<typeof promptWizardSafeV6ActionEditingCueMotionFallback>[0];
      }> = [
        {
          name: '伪造普通 Error',
          input: {
            ...baseInput,
            error: Object.assign(new Error('伪造动态错误'), {
              code: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
              fieldPaths: ['segments[0].editingCue', 'segments[2].action'],
            }),
          },
        },
        {
          name: '只有 editingCue',
          input: { ...baseInput, error: errorWithPaths(['segments[0].editingCue']) },
        },
        {
          name: '只有 action',
          input: { ...baseInput, error: errorWithPaths(['segments[2].action']) },
        },
        {
          name: '混入 voiceover',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[0].editingCue',
              'segments[2].action',
              'segments[0].voiceover',
            ]),
          },
        },
        {
          name: '混入 cameraMovement',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[0].editingCue',
              'segments[2].action',
              'segments[1].cameraMovement',
            ]),
          },
        },
        {
          name: '混入 lightingAndRealism',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[0].editingCue',
              'segments[2].action',
              'segments[1].lightingAndRealism',
            ]),
          },
        },
        {
          name: '混入 segments 根路径',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[0].editingCue',
              'segments[2].action',
              'segments',
            ]),
          },
        },
        {
          name: '重复原始路径',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[0].editingCue',
              'segments[2].action',
              'segments[2].action',
            ]),
          },
        },
        {
          name: '索引含前导零',
          input: {
            ...baseInput,
            error: errorWithPaths(['segments[00].editingCue', 'segments[2].action']),
          },
        },
        {
          name: '索引越界',
          input: {
            ...baseInput,
            error: errorWithPaths(['segments[0].editingCue', 'segments[3].action']),
          },
        },
        { name: '尚未修复', input: { ...baseInput, contentRepairRequestCount: 0 } },
        { name: '只修复一次', input: { ...baseInput, contentRepairRequestCount: 1 } },
        { name: '非法第三次计数', input: { ...baseInput, contentRepairRequestCount: 3 } },
        { name: '经过格式恢复', input: { ...baseInput, formatRecovered: true } },
        { name: 'V4 历史交付不进入', input: { ...baseInput, deliveryVersion: 4 } },
        { name: '非 V6 交付', input: { ...baseInput, deliveryVersion: 5 } },
        { name: '非五秒稿缺少目标语言', input: { ...baseInput, targetLanguage: undefined } },
        {
          name: '非普通话稿缺少简中译文',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[1]!.voiceoverZh = ''; }),
          },
        },
        {
          name: '简中译文含 Emoji',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[1]!.voiceoverZh += '🙂'; }),
          },
        },
        { name: '实时 Draft 已不再复现错误', input: { ...baseInput, draft: eligible!.draft } },
        {
          name: '实时职责不符合权威 V6 时间轴',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[1]!.role = 'proof'; }),
          },
        },
        {
          name: '实时 Draft 非 Schema 规范快照',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[0]!.editingCue += ' '; }),
          },
        },
        {
          name: '原稿已有执行预算问题',
          input: { ...baseInput, draft: overBudgetDraft },
        },
      ];
      rejectedInputs.forEach(({ name, input }) => {
        expect(promptWizardSafeV6ActionEditingCueMotionFallback(input), name).toBeNull();
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 action + editingCue 联合收口覆盖全部 V6 镜头职责且仍只改授权双叶子', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const fakeProvider = new FakePromptWizardProvider();
    const scenarios = [
      {
        caseId: '服饰-5s-sound-only',
        targetLanguage: null,
        roles: ['hook', 'proof-resolution'] as const,
      },
      {
        caseId: '服饰-15s-en',
        targetLanguage: '英语',
        roles: ['hook', 'proof', 'resolution', 'cta'] as const,
      },
    ] as const;

    try {
      for (const [scenarioIndex, scenario] of scenarios.entries()) {
        const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
          item => item.id === scenario.caseId,
        )!;
        const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
        const routeSet = buildPromptWizardRouteSetV6({
          id: `00000000-0000-4000-8000-00000000057${scenarioIndex * 2}`,
          runId: `00000000-0000-4000-8000-00000000057${scenarioIndex * 2 + 1}`,
          runRevision: 1,
          profile: testCase.profile,
          evidenceGraph,
          productionBrief: buildPromptWizardProductionBrief(testCase.profile),
          createdAt: '2026-08-12T05:35:00.000Z',
        });
        const routeContext = promptWizardRouteContextsV6(routeSet)[0]!;
        const generated = await fakeProvider.generateUseDirectionDrafts({
          profile: testCase.profile,
          evidenceGraph,
          ...(scenario.targetLanguage === null
            ? {}
            : { targetLanguage: scenario.targetLanguage }),
          ...(scenario.targetLanguage === null ? {} : { confirmedOffer: '' }),
          config: testCase.config,
          planContexts: [routeContext],
          imageCount: 1,
          variationKey: 1,
        });
        const canonicalDraft = structuredClone(generated.drafts[0]!);
        canonicalDraft.segments = canonicalDraft.segments.map((segment, index) => ({
          ...segment,
          role: scenario.roles[index]!,
          lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
        }));
        const context = {
          planIndex: 0 as const,
          variant: routeContext.variant,
          useDirection: routeContext.useDirection,
          selectedScene: routeContext.selectedScene,
        };

        for (const [actionSegmentIndex, role] of scenario.roles.entries()) {
          const editingCueSegmentIndex = (actionSegmentIndex + 1) % scenario.roles.length;
          const draft = structuredClone(canonicalDraft);
          draft.segments[actionSegmentIndex]!.action = '产品保持不动并等待收束';
          draft.segments[editingCueSegmentIndex]!.editingCue = '画面定格';
          let exactError: PromptWizardMotionDensityError | null = null;
          try {
            assertPromptWizardMotionDensity({
              shots: draft.segments,
              durationSeconds: testCase.config.durationSeconds,
            });
          } catch (error) {
            if (error instanceof PromptWizardMotionDensityError) exactError = error;
          }
          expect(new Set(exactError?.fieldPaths), `${scenario.caseId}/${role}`).toEqual(new Set([
            `segments[${actionSegmentIndex}].action`,
            `segments[${editingCueSegmentIndex}].editingCue`,
          ]));
          expect(validatePromptWizardShotExecutionBudget({
            shots: draft.segments,
            config: testCase.config,
            deliveryVersion: 6,
          }), `${scenario.caseId}/${role}`).toEqual([]);

          const result = promptWizardSafeV6ActionEditingCueMotionFallback({
            error: exactError!,
            draft,
            context,
            config: testCase.config,
            ...(scenario.targetLanguage === null
              ? {}
              : { targetLanguage: scenario.targetLanguage }),
            contentRepairRequestCount: 2,
            formatRecovered: false,
            deliveryVersion: 6,
          });
          expect(result, `${scenario.caseId}/${role}`).not.toBeNull();
          expect(result?.actionSegmentIndexes).toEqual([actionSegmentIndex]);
          expect(result?.editingCueSegmentIndexes).toEqual([editingCueSegmentIndex]);
          expect(result?.draft.segments[actionSegmentIndex]?.action).not
            .toBe(draft.segments[actionSegmentIndex]?.action);
          expect(result?.draft.segments[actionSegmentIndex]?.action).toMatch(/持续/u);
          expect(result?.draft.segments[editingCueSegmentIndex]?.editingCue)
            .toBe('沿当前镜头动作点切换景别，保持画面连续');
          expect(() => assertPromptWizardMotionDensity({
            shots: result!.draft.segments,
            durationSeconds: testCase.config.durationSeconds,
          })).not.toThrow();
          expect(validatePromptWizardShotExecutionBudget({
            shots: result!.draft.segments,
            config: testCase.config,
            deliveryVersion: 6,
          })).toEqual([]);

          const maskOwnedLeaves = (value: PromptWizardPlanDraft) => ({
            ...value,
            segments: value.segments.map((segment, index) => ({
              ...segment,
              ...(index === actionSegmentIndex ? { action: '__action__' } : {}),
              ...(index === editingCueSegmentIndex ? { editingCue: '__editingCue__' } : {}),
            })),
          });
          expect(maskOwnedLeaves(result!.draft)).toEqual(maskOwnedLeaves(draft));
        }
      }
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 格式恢复后单运镜收口只接受零内容修复的权威 singleton 证据', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '家居-10s-es',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000584',
      runId: '00000000-0000-4000-8000-000000000585',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-13T00:30:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();

    try {
      const generated = await fakeProvider.generateUseDirectionDrafts({
        profile: testCase.profile,
        evidenceGraph,
        targetLanguage: '西班牙语',
        confirmedOffer: '',
        config: testCase.config,
        planContexts: [promptWizardRouteContextsV6(routeSet)[1]!],
        imageCount: 1,
        variationKey: 1,
      });
      const draft = structuredClone(generated.drafts[0]!);
      draft.segments = draft.segments.map((segment, index) => ({
        ...segment,
        role: ['hook', 'proof-resolution', 'cta'][index] as typeof segment.role,
        lightingAndRealism: `${segment.lightingAndRealism}，窗边光影持续移动`,
        cameraMovement: index === 2
          ? '固定机位'
          : '镜头持续缓慢推近，产品证据始终保持清晰',
        editingCue: '沿当前镜头动作点切换景别，保持画面连续',
      }));
      let exactError: PromptWizardMotionDensityError | null = null;
      try {
        assertPromptWizardMotionDensity({
          shots: draft.segments,
          durationSeconds: testCase.config.durationSeconds,
        });
      } catch (error) {
        if (error instanceof PromptWizardMotionDensityError) exactError = error;
      }
      expect(exactError?.fieldPaths).toEqual(['segments[2].cameraMovement']);
      expect(validatePromptWizardShotExecutionBudget({
        shots: draft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);

      const baseInput = {
        error: exactError!,
        draft,
        config: testCase.config,
        targetLanguage: '西班牙语',
        contentRepairRequestCount: 0,
        formatRecovered: true,
        deliveryVersion: 6 as const,
      };
      const eligible = promptWizardSafeV6FormatRecoverySingleCameraMotionFallback(baseInput);
      expect(eligible?.segmentIndex).toBe(2);
      expect(eligible?.draft.segments[2]?.cameraMovement)
        .toBe('镜头持续缓慢推近，产品证据始终保持清晰');
      expect(() => assertPromptWizardMotionDensity({
        shots: eligible!.draft.segments,
        durationSeconds: testCase.config.durationSeconds,
      })).not.toThrow();
      expect(validatePromptWizardShotExecutionBudget({
        shots: eligible!.draft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);
      const maskOwnedLeaf = (value: PromptWizardPlanDraft) => ({
        ...value,
        segments: value.segments.map((segment, index) => index === 2
          ? { ...segment, cameraMovement: '__cameraMovement__' }
          : segment),
      });
      expect(maskOwnedLeaf(eligible!.draft)).toEqual(maskOwnedLeaf(draft));

      const errorWithPaths = (fieldPaths: string[]) => {
        const error = new PromptWizardMotionDensityError(
          ['segments[2].cameraMovement'],
          '画面动态密度不足',
        );
        error.fieldPaths.splice(0, error.fieldPaths.length, ...fieldPaths);
        return error;
      };
      const draftWith = (mutate: (value: PromptWizardPlanDraft) => void) => {
        const value = structuredClone(draft);
        mutate(value);
        return value;
      };
      const overBudgetDraft = draftWith(value => {
        value.segments.forEach((segment, index) => {
          segment.location = `互不相同的场景${index + 1}`;
        });
      });
      expect(validatePromptWizardShotExecutionBudget({
        shots: overBudgetDraft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      }).length).toBeGreaterThan(0);

      const rejectedInputs: Array<{
        name: string;
        input: Parameters<
          typeof promptWizardSafeV6FormatRecoverySingleCameraMotionFallback
        >[0];
      }> = [
        {
          name: '伪造普通 Error',
          input: {
            ...baseInput,
            error: Object.assign(new Error('伪造动态错误'), {
              code: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
              fieldPaths: ['segments[2].cameraMovement'],
            }),
          },
        },
        {
          name: '多个运镜路径',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[0].cameraMovement',
              'segments[2].cameraMovement',
            ]),
          },
        },
        {
          name: '混入 action',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[2].cameraMovement',
              'segments[2].action',
            ]),
          },
        },
        {
          name: '索引含前导零',
          input: { ...baseInput, error: errorWithPaths(['segments[02].cameraMovement']) },
        },
        {
          name: '索引越界',
          input: { ...baseInput, error: errorWithPaths(['segments[3].cameraMovement']) },
        },
        { name: '未经过格式恢复', input: { ...baseInput, formatRecovered: false } },
        { name: '已有一次内容修复', input: { ...baseInput, contentRepairRequestCount: 1 } },
        { name: '已有两次内容修复', input: { ...baseInput, contentRepairRequestCount: 2 } },
        { name: 'V4 历史交付不进入', input: { ...baseInput, deliveryVersion: 4 } },
        { name: 'V5 历史交付不进入', input: { ...baseInput, deliveryVersion: 5 } },
        { name: '非五秒稿缺少目标语言', input: { ...baseInput, targetLanguage: undefined } },
        {
          name: '非普通话稿缺少简中译文',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[1]!.voiceoverZh = ''; }),
          },
        },
        {
          name: '实时职责不符合 V6 时间轴',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[1]!.role = 'proof'; }),
          },
        },
        {
          name: '非规范 Draft',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[1]!.foley += ' '; }),
          },
        },
        { name: '原稿已有执行预算问题', input: { ...baseInput, draft: overBudgetDraft } },
        { name: '实时 Draft 已不再复现错误', input: { ...baseInput, draft: eligible!.draft } },
      ];
      rejectedInputs.forEach(({ name, input }) => {
        expect(promptWizardSafeV6FormatRecoverySingleCameraMotionFallback(input), name)
          .toBeNull();
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 两轮后运镜收口只接受权威复现的 1..N 个规范叶子', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '服饰-15s-en',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000580',
      runId: '00000000-0000-4000-8000-000000000581',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-13T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();

    try {
      const generated = await fakeProvider.generateUseDirectionDrafts({
        profile: testCase.profile,
        evidenceGraph,
        targetLanguage: '英语',
        confirmedOffer: '',
        config: testCase.config,
        planContexts: [promptWizardRouteContextsV6(routeSet)[1]!],
        imageCount: 1,
        variationKey: 1,
      });
      const draft = structuredClone(generated.drafts[0]!);
      draft.segments = draft.segments.map((segment, index) => ({
        ...segment,
        role: ['hook', 'proof', 'resolution', 'cta'][index] as typeof segment.role,
        lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
        ...(index === 0 || index === 3 ? { cameraMovement: '固定机位' } : {}),
      }));
      let exactError: PromptWizardMotionDensityError | null = null;
      try {
        assertPromptWizardMotionDensity({
          shots: draft.segments,
          durationSeconds: testCase.config.durationSeconds,
        });
      } catch (error) {
        if (error instanceof PromptWizardMotionDensityError) exactError = error;
      }
      expect(exactError?.fieldPaths).toEqual([
        'segments[0].cameraMovement',
        'segments[3].cameraMovement',
      ]);
      expect(validatePromptWizardShotExecutionBudget({
        shots: draft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);

      const baseInput = {
        error: exactError!,
        draft,
        config: testCase.config,
        targetLanguage: '英语',
        contentRepairRequestCount: 2,
        formatRecovered: false,
        deliveryVersion: 6 as const,
      };
      const eligible = promptWizardSafeV6MultiCameraMovementMotionFallback(baseInput);
      expect(eligible?.segmentIndexes).toEqual([0, 3]);
      expect(eligible?.draft.segments[0]?.cameraMovement)
        .toBe('镜头持续缓慢推近，产品证据始终保持清晰');
      expect(eligible?.draft.segments[3]?.cameraMovement)
        .toBe('镜头持续缓慢推近，产品证据始终保持清晰');
      expect(() => assertPromptWizardMotionDensity({
        shots: eligible!.draft.segments,
        durationSeconds: testCase.config.durationSeconds,
      })).not.toThrow();
      expect(validatePromptWizardShotExecutionBudget({
        shots: eligible!.draft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);
      const maskOwnedLeaves = (value: PromptWizardPlanDraft) => ({
        ...value,
        segments: value.segments.map((segment, index) => (
          index === 0 || index === 3
            ? { ...segment, cameraMovement: '__cameraMovement__' }
            : segment
        )),
      });
      expect(maskOwnedLeaves(eligible!.draft)).toEqual(maskOwnedLeaves(draft));

      const singletonDraft = structuredClone(draft);
      singletonDraft.segments[0]!.cameraMovement =
        '镜头持续缓慢推近，产品证据始终保持清晰';
      let singletonError: PromptWizardMotionDensityError | null = null;
      try {
        assertPromptWizardMotionDensity({
          shots: singletonDraft.segments,
          durationSeconds: testCase.config.durationSeconds,
        });
      } catch (error) {
        if (error instanceof PromptWizardMotionDensityError) singletonError = error;
      }
      expect(singletonError?.fieldPaths).toEqual(['segments[3].cameraMovement']);
      const singletonEligible = promptWizardSafeV6MultiCameraMovementMotionFallback({
        ...baseInput,
        error: singletonError!,
        draft: singletonDraft,
      });
      expect(singletonEligible?.segmentIndexes).toEqual([3]);
      expect(singletonEligible?.draft.segments[3]?.cameraMovement)
        .toBe('镜头持续缓慢推近，产品证据始终保持清晰');
      expect(singletonEligible?.draft.segments[0]?.cameraMovement)
        .toBe(singletonDraft.segments[0]!.cameraMovement);
      const maskSingletonLeaf = (value: PromptWizardPlanDraft) => ({
        ...value,
        segments: value.segments.map((segment, index) => (
          index === 3 ? { ...segment, cameraMovement: '__cameraMovement__' } : segment
        )),
      });
      expect(maskSingletonLeaf(singletonEligible!.draft))
        .toEqual(maskSingletonLeaf(singletonDraft));

      const errorWithPaths = (fieldPaths: string[]) => {
        const error = new PromptWizardMotionDensityError(
          ['segments[0].cameraMovement', 'segments[3].cameraMovement'],
          '画面动态密度不足',
        );
        error.fieldPaths.splice(0, error.fieldPaths.length, ...fieldPaths);
        return error;
      };
      const draftWith = (mutate: (value: PromptWizardPlanDraft) => void) => {
        const value = structuredClone(draft);
        mutate(value);
        return value;
      };
      const overBudgetDraft = draftWith(value => {
        value.segments.forEach((segment, index) => {
          segment.location = `互不相同的场景${index + 1}`;
        });
      });
      expect(validatePromptWizardShotExecutionBudget({
        shots: overBudgetDraft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      }).length).toBeGreaterThan(0);

      const rejectedInputs: Array<{
        name: string;
        input: Parameters<typeof promptWizardSafeV6MultiCameraMovementMotionFallback>[0];
      }> = [
        {
          name: '伪造普通 Error',
          input: {
            ...baseInput,
            error: Object.assign(new Error('伪造动态错误'), {
              code: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
              fieldPaths: [
                'segments[0].cameraMovement',
                'segments[3].cameraMovement',
              ],
            }),
          },
        },
        { name: '空路径数组', input: { ...baseInput, error: errorWithPaths([]) } },
        {
          name: '路径数组混入非字符串',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[0].cameraMovement',
              'segments[3].cameraMovement',
              3 as unknown as string,
            ]),
          },
        },
        {
          name: '混入 action',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[0].cameraMovement',
              'segments[3].cameraMovement',
              'segments[2].action',
            ]),
          },
        },
        {
          name: '重复原始路径',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[0].cameraMovement',
              'segments[3].cameraMovement',
              'segments[3].cameraMovement',
            ]),
          },
        },
        {
          name: '索引含前导零',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[00].cameraMovement',
              'segments[3].cameraMovement',
            ]),
          },
        },
        {
          name: '索引越界',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[0].cameraMovement',
              'segments[4].cameraMovement',
            ]),
          },
        },
        { name: '尚未修复', input: { ...baseInput, contentRepairRequestCount: 0 } },
        { name: '只修复一次', input: { ...baseInput, contentRepairRequestCount: 1 } },
        { name: '非法第三次计数', input: { ...baseInput, contentRepairRequestCount: 3 } },
        { name: '经过格式恢复', input: { ...baseInput, formatRecovered: true } },
        { name: 'V4 历史交付不进入', input: { ...baseInput, deliveryVersion: 4 } },
        { name: '非 V6 交付', input: { ...baseInput, deliveryVersion: 5 } },
        { name: '非五秒稿缺少目标语言', input: { ...baseInput, targetLanguage: undefined } },
        {
          name: '实时 validator 路径顺序不一致',
          input: {
            ...baseInput,
            error: errorWithPaths([
              'segments[3].cameraMovement',
              'segments[0].cameraMovement',
            ]),
          },
        },
        {
          name: '实时职责不符合 V6 时间轴',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[1]!.role = 'proof-resolution'; }),
          },
        },
        {
          name: '非规范 Draft',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[1]!.foley += ' '; }),
          },
        },
        {
          name: '非普通话稿缺少简中译文',
          input: {
            ...baseInput,
            draft: draftWith(value => { value.segments[1]!.voiceoverZh = ''; }),
          },
        },
        { name: '原稿已有执行预算问题', input: { ...baseInput, draft: overBudgetDraft } },
        { name: '实时 Draft 已不再复现错误', input: { ...baseInput, draft: eligible!.draft } },
      ];
      rejectedInputs.forEach(({ name, input }) => {
        expect(promptWizardSafeV6MultiCameraMovementMotionFallback(input), name).toBeNull();
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 singleton 运镜修复转为唯一运镜预算错误时只接受完整来源证据', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '美妆-10s-ja',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000538',
      runId: '00000000-0000-4000-8000-000000000539',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-11T01:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();

    try {
      const generated = await fakeProvider.generateUseDirectionDrafts({
        profile: testCase.profile,
        evidenceGraph,
        targetLanguage: '日语',
        confirmedOffer: '',
        config: testCase.config,
        planContexts: [promptWizardRouteContextsV6(routeSet)[0]!],
        imageCount: 1,
        variationKey: 1,
      });
      const previousDraft = structuredClone(generated.drafts[0]!);
      previousDraft.segments = previousDraft.segments.map((segment, index) => ({
        ...segment,
        role: ['hook', 'proof-resolution', 'cta'][index] as typeof segment.role,
        lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
        cameraMovement: index === 2 ? '固定机位' : segment.cameraMovement,
      }));
      let sourceError: PromptWizardMotionDensityError | null = null;
      try {
        assertPromptWizardMotionDensity({
          shots: previousDraft.segments,
          durationSeconds: testCase.config.durationSeconds,
        });
      } catch (error) {
        if (error instanceof PromptWizardMotionDensityError) sourceError = error;
      }
      expect(sourceError?.fieldPaths).toEqual(['segments[2].cameraMovement']);
      expect(validatePromptWizardShotExecutionBudget({
        shots: previousDraft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);

      const repairedDraft = structuredClone(previousDraft);
      repairedDraft.segments[2]!.cameraMovement =
        '镜头快速推近后横移并跟随，再环绕拉远并切换焦点';
      const budgetIssues = validatePromptWizardShotExecutionBudget({
        shots: repairedDraft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      });
      expect(budgetIssues).toEqual([expect.objectContaining({
        code: 'TOO_MANY_CAMERA_MOVES',
        fieldPath: 'segments',
        actual: expect.any(Number),
        limit: 3,
      })]);
      const budgetError = new PromptWizardExecutionBudgetError(budgetIssues);
      const source = {
        issue: {
          errorCode: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
          fieldPaths: ['segments[2].cameraMovement'],
        },
        previousDraft,
      };
      const baseInput = {
        error: budgetError,
        draft: repairedDraft,
        source,
        config: testCase.config,
        targetLanguage: '日语',
        contentRepairRequestCount: 1,
        formatRecovered: false,
        deliveryVersion: 6 as const,
      };
      const eligible = promptWizardSafeV6MotionRepairCameraBudgetFallback(baseInput);
      expect(eligible).toMatchObject({
        segmentIndex: 2,
        issue: {
          code: 'TOO_MANY_CAMERA_MOVES',
          fieldPath: 'segments',
          actual: budgetIssues[0]!.actual,
          limit: 3,
        },
      });
      expect(new Set(eligible!.draft.segments.map(segment => segment.cameraMovement)))
        .toEqual(new Set(['镜头持续缓慢推近，产品证据始终保持清晰']));
      expect(validatePromptWizardShotExecutionBudget({
        shots: eligible!.draft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);
      expect(() => assertPromptWizardMotionDensity({
        shots: eligible!.draft.segments,
        durationSeconds: testCase.config.durationSeconds,
      })).not.toThrow();
      const maskCameraMovement = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        segments: draft.segments.map(segment => ({
          ...segment,
          cameraMovement: '__cameraMovement__',
        })),
      });
      expect(maskCameraMovement(eligible!.draft)).toEqual(maskCameraMovement(repairedDraft));

      const draftWith = (mutate: (draft: PromptWizardPlanDraft) => void) => {
        const draft = structuredClone(repairedDraft);
        mutate(draft);
        return draft;
      };
      const sourceWith = (
        mutate: (snapshot: typeof source) => void,
      ) => {
        const snapshot = structuredClone(source);
        mutate(snapshot);
        return snapshot;
      };
      const mixedBudgetError = new PromptWizardExecutionBudgetError([
        ...budgetIssues,
        {
          code: 'TOO_MANY_PROPS',
          fieldPath: 'segments',
          actual: 3,
          limit: 2,
          message: '道具超限',
        },
      ]);
      const mismatchedBudgetError = new PromptWizardExecutionBudgetError([{
        ...budgetIssues[0]!,
        actual: Number(budgetIssues[0]!.actual) + 1,
      }]);
      const rejectedInputs: Array<{
        name: string;
        input: Parameters<typeof promptWizardSafeV6MotionRepairCameraBudgetFallback>[0];
      }> = [
        {
          name: '伪造普通预算 Error',
          input: {
            ...baseInput,
            error: Object.assign(new Error('伪造预算错误'), {
              code: 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED',
              issues: budgetIssues,
            }),
          },
        },
        {
          name: '混合预算子项',
          input: { ...baseInput, error: mixedBudgetError },
        },
        {
          name: '入口预算与实时预算不一致',
          input: { ...baseInput, error: mismatchedBudgetError },
        },
        {
          name: '来源混合运镜和剪辑路径',
          input: {
            ...baseInput,
            source: sourceWith(snapshot => {
              snapshot.issue.fieldPaths.push('segments[2].editingCue');
            }),
          },
        },
        {
          name: '来源索引含前导零',
          input: {
            ...baseInput,
            source: sourceWith(snapshot => {
              snapshot.issue.fieldPaths = ['segments[02].cameraMovement'];
            }),
          },
        },
        {
          name: '来源索引越界',
          input: {
            ...baseInput,
            source: sourceWith(snapshot => {
              snapshot.issue.fieldPaths = ['segments[3].cameraMovement'];
            }),
          },
        },
        {
          name: '来源错误码不是动态密度',
          input: {
            ...baseInput,
            source: sourceWith(snapshot => {
              snapshot.issue.errorCode = 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED';
            }),
          },
        },
        {
          name: '缺少来源快照',
          input: { ...baseInput, source: null },
        },
        {
          name: '尚未消费内容修复',
          input: { ...baseInput, contentRepairRequestCount: 0 },
        },
        {
          name: '已经消费两次内容修复',
          input: { ...baseInput, contentRepairRequestCount: 2 },
        },
        {
          name: '发生过格式恢复',
          input: { ...baseInput, formatRecovered: true },
        },
        {
          name: '非 V6 交付',
          input: { ...baseInput, deliveryVersion: 5 },
        },
        {
          name: '修复后稿件漂移了非目标动作',
          input: {
            ...baseInput,
            draft: draftWith(draft => { draft.segments[0]!.action += '并新增动作'; }),
          },
        },
        {
          name: '修复后稿件不是 Schema 规范快照',
          input: {
            ...baseInput,
            draft: draftWith(draft => { draft.segments[2]!.cameraMovement += ' '; }),
          },
        },
        {
          name: '修复前稿件不再复现来源运镜错误',
          input: {
            ...baseInput,
            source: sourceWith(snapshot => {
              snapshot.previousDraft.segments[2]!.cameraMovement =
                '镜头持续缓慢推近，产品证据始终保持清晰';
            }),
          },
        },
      ];
      rejectedInputs.forEach(({ name, input }) => {
        expect(promptWizardSafeV6MotionRepairCameraBudgetFallback(input), name).toBeNull();
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it.each([
    { caseName: '两轮后本地收口并交付三案', hiddenUnsafeContent: false },
    { caseName: '候选完整重渲染失败时原位关闭', hiddenUnsafeContent: true },
  ])('V6 首尾帧 editingCue 两轮不收敛：$caseName', async ({
    hiddenUnsafeContent,
  }) => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    const originalNodeEnv = env.NODE_ENV;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    env.NODE_ENV = 'production';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '宠物用品-10s-ja',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000586',
      runId: '00000000-0000-4000-8000-000000000587',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-13T01:10:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 1 as const;
    let secondRepairPreviousDrafts: PromptWizardPlanDraft[] | null = null;
    let secondRepairReturnedDraft: PromptWizardPlanDraft | null = null;

    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const generated = await generateDrafts(input);
      const planIndex = input.planContexts[0]!.planIndex;
      if (planIndex !== targetPlanIndex || !generated.drafts[0]) return generated;
      generated.drafts[0] = {
        ...generated.drafts[0],
        ...(hiddenUnsafeContent ? { productionWarnings: ['全网都在买'] } : {}),
        segments: generated.drafts[0].segments.map((segment, segmentIndex) => ({
          ...segment,
          lightingAndRealism: `${segment.lightingAndRealism}，环境光影持续移动`,
          ...(segmentIndex === 0
            ? { editingCue: '尾帧沿当前镜头动作点切换景别，保持画面连续' }
            : {}),
        })),
      };
      expect(() => assertPromptWizardMotionDensity({
        shots: generated.drafts[0]!.segments,
        durationSeconds: testCase.config.durationSeconds,
      })).not.toThrow();
      expect(validatePromptWizardShotExecutionBudget({
        shots: generated.drafts[0].segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);
      return generated;
    });

    let repairRound = 0;
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      repairRound += 1;
      expect(input.issues).toEqual([expect.objectContaining({
        planIndex: targetPlanIndex,
        errorCode: 'PROMPT_WIZARD_REFERENCE_MODE_INVALID',
        fieldPaths: ['segments[0].editingCue'],
      })]);
      if (repairRound === 2) {
        secondRepairPreviousDrafts = structuredClone(input.previousDrafts);
      }
      const repaired = await repairDrafts(input);
      // 两轮都复现 Attempt2 的单一首尾帧剪辑叶子；本地
      // 终态收口后不得再产生第三次逻辑或物理修复。
      const draft = structuredClone(input.previousDrafts[targetPlanIndex]!);
      draft.segments[0]!.editingCue =
        '尾帧沿当前镜头动作点切换景别，保持画面连续';
      if (repairRound === 2) secondRepairReturnedDraft = structuredClone(draft);
      return {
        ...repaired,
        drafts: [{
          ...repaired.drafts[0]!,
          planIndex: targetPlanIndex,
          draft,
        }],
      };
    });

    try {
      let result: Awaited<ReturnType<typeof generateValidatedPromptWizardRoutePlansV6>> | null = null;
      let thrown: unknown;
      try {
        result = await generateValidatedPromptWizardRoutePlansV6({
          provider: {
            generateUseDirectionDrafts: generateSpy,
            repairUseDirectionDrafts: repairSpy,
          } as never,
          profile: testCase.profile,
          evidenceGraph,
          voiceoverLanguage: '日语',
          verifiedOffer: '',
          config: testCase.config,
          routeSet,
          imageCount: 1,
          variationKey: 1,
          deadlineAtMs: Date.now() + 240_000,
          historicalPlans: [],
        });
      } catch (error) {
        thrown = error;
      }

      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).toHaveBeenCalledTimes(2);
      expect(repairRound).toBe(2);
      expect(secondRepairPreviousDrafts).not.toBeNull();
      expect(secondRepairReturnedDraft).not.toBeNull();
      if (hiddenUnsafeContent) {
        expect(result).toBeNull();
        expect(thrown).toMatchObject({
          code: 'PROMPT_WIZARD_UNSAFE_CONTENT',
          fieldPaths: ['productionWarnings[0]'],
          repairRounds: 2,
          planIndexes: [targetPlanIndex],
          contentRepairRequestCounts: [0, 2, 0],
          terminalCalibrationRequestCounts: [0, 0, 0],
          providerRequestAttempted: true,
          usage: { input_tokens: 0, output_tokens: 0 },
        });
        expect(warnSpy.mock.calls.some(([value]) => (
          typeof value === 'string'
          && value.includes('prompt-wizard-safe-editing-cue-fallback')
        ))).toBe(false);
        return;
      }

      if (!result) throw thrown;
      expect(result.plans).toHaveLength(3);
      expect(result.drafts).toHaveLength(3);
      expect(result.repairRounds).toBe(2);
      expect(result.contentRepairRequestCounts).toEqual([0, 2, 0]);
      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      expect(result.formatRepairCount).toBe(0);
      expect(result.usage).toMatchObject({
        requestAttempts: 5,
        inputTokens: 0,
        outputTokens: 0,
      });
      expect(result.repairDiagnostics).toEqual([
        expect.objectContaining({
          planIndex: targetPlanIndex,
          repairRound: 1,
          errorCode: 'PROMPT_WIZARD_REFERENCE_MODE_INVALID',
          fieldPaths: ['segments[0].editingCue'],
        }),
        expect.objectContaining({
          planIndex: targetPlanIndex,
          repairRound: 2,
          errorCode: 'PROMPT_WIZARD_REFERENCE_MODE_INVALID',
          fieldPaths: ['segments[0].editingCue'],
        }),
      ]);
      const finalDraft = result.drafts[targetPlanIndex]!;
      expect(finalDraft.segments[0]!.editingCue)
        .toBe('沿当前镜头动作点切换景别，保持画面连续');
      expect(() => assertPromptWizardNoFirstLastSemantics(
        promptWizardStringLeaves(finalDraft),
      )).not.toThrow();
      const maskEditingCue = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        segments: draft.segments.map((segment, segmentIndex) => segmentIndex === 0
          ? { ...segment, editingCue: '__editingCue__' }
          : segment),
      });
      expect(maskEditingCue(finalDraft)).toEqual(maskEditingCue(secondRepairReturnedDraft!));
      expect(result.drafts[0]).toEqual(secondRepairPreviousDrafts![0]);
      expect(result.drafts[2]).toEqual(secondRepairPreviousDrafts![2]);
      const fallbackLines = warnSpy.mock.calls.flatMap(([value]) => (
        typeof value === 'string'
        && value.includes('prompt-wizard-safe-editing-cue-fallback')
          ? [value]
          : []
      ));
      expect(fallbackLines).toHaveLength(1);
      expect(parsePromptWizardCanarySafeTranscript({
        protocolEvents: new Set(),
        transcript: fallbackLines.join('\n'),
      }).normalizedEvents).toEqual([{
        event: 'prompt-wizard-safe-editing-cue-fallback',
        planIndex: targetPlanIndex,
        repairRounds: 2,
      }]);
    } finally {
      warnSpy.mockRestore();
      env.NODE_ENV = originalNodeEnv;
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it.each([
    { caseName: '严格来源通过后本地收口', driftNonTarget: false },
    { caseName: '非目标字段漂移时保留预算错误并原位关闭', driftNonTarget: true },
  ])('V6 日语 10 秒运镜密度修复转为唯一运镜预算：$caseName', async ({
    driftNonTarget,
  }) => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '美妆-10s-ja',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000540',
      runId: '00000000-0000-4000-8000-000000000541',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-11T01:15:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 0 as const;
    let repairedBudgetDraft: PromptWizardPlanDraft | null = null;
    let repairPreviousDrafts: PromptWizardPlanDraft[] | null = null;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const generated = await generateDrafts(input);
      const planIndex = input.planContexts[0]!.planIndex;
      if (!generated.drafts[0]) return generated;
      generated.drafts[0] = {
        ...generated.drafts[0],
        segments: generated.drafts[0].segments.map((segment, segmentIndex) => ({
          ...segment,
          lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          ...(planIndex === targetPlanIndex && segmentIndex === 2
            ? { cameraMovement: '固定机位' }
            : {}),
        })),
      };
      if (planIndex === targetPlanIndex) {
        expect(validatePromptWizardShotExecutionBudget({
          shots: generated.drafts[0].segments,
          config: testCase.config,
          deliveryVersion: 6,
        })).toEqual([]);
        let motionError: PromptWizardMotionDensityError | null = null;
        try {
          assertPromptWizardMotionDensity({
            shots: generated.drafts[0].segments,
            durationSeconds: testCase.config.durationSeconds,
          });
        } catch (error) {
          if (error instanceof PromptWizardMotionDensityError) motionError = error;
        }
        expect(motionError?.fieldPaths).toEqual(['segments[2].cameraMovement']);
      }
      return generated;
    });
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      const repaired = await repairDrafts(input);
      const issue = input.issues[0]!;
      expect(issue).toMatchObject({
        planIndex: targetPlanIndex,
        errorCode: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
        fieldPaths: ['segments[2].cameraMovement'],
      });
      repairPreviousDrafts = structuredClone(input.previousDrafts);
      const draft = structuredClone(input.previousDrafts[targetPlanIndex]!);
      draft.segments[2]!.cameraMovement =
        '镜头快速推近后横移并跟随，再环绕拉远并切换焦点';
      if (driftNonTarget) draft.segments[0]!.foley += '，额外环境声';
      const budgetIssues = validatePromptWizardShotExecutionBudget({
        shots: draft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      });
      expect(budgetIssues).toEqual([expect.objectContaining({
        code: 'TOO_MANY_CAMERA_MOVES',
        fieldPath: 'segments',
        limit: 3,
      })]);
      repairedBudgetDraft = structuredClone(draft);
      return {
        ...repaired,
        drafts: [{
          ...repaired.drafts[0]!,
          planIndex: targetPlanIndex,
          draft,
        }],
      };
    });
    const originalNodeEnv = env.NODE_ENV;
    env.NODE_ENV = 'production';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      let result: Awaited<ReturnType<typeof generateValidatedPromptWizardRoutePlansV6>> | null = null;
      let thrown: unknown;
      try {
        result = await generateValidatedPromptWizardRoutePlansV6({
          provider: {
            generateUseDirectionDrafts: generateSpy,
            repairUseDirectionDrafts: repairSpy,
          } as never,
          profile: testCase.profile,
          evidenceGraph,
          voiceoverLanguage: '日语',
          verifiedOffer: '',
          config: testCase.config,
          routeSet,
          imageCount: 1,
          variationKey: 1,
          deadlineAtMs: Date.now() + 240_000,
          historicalPlans: [],
        });
      } catch (error) {
        thrown = error;
      }

      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).toHaveBeenCalledTimes(1);
      if (driftNonTarget) {
        expect(result).toBeNull();
        expect(thrown).toMatchObject({
          code: 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED',
          repairRounds: 1,
          planIndexes: [targetPlanIndex],
          contentRepairRequestCounts: [1, 0, 0],
          terminalCalibrationRequestCounts: [0, 0, 0],
        });
        expect(warnSpy.mock.calls.some(([value]) => (
          typeof value === 'string'
          && value.includes('prompt-wizard-v6-safe-motion-repair-camera-budget-fallback')
        ))).toBe(false);
        return;
      }
      if (!result) throw thrown;
      expect(result.repairRounds).toBe(1);
      expect(result.contentRepairRequestCounts).toEqual([1, 0, 0]);
      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      expect(result.repairDiagnostics).toEqual([expect.objectContaining({
        planIndex: targetPlanIndex,
        origin: 'domain-validation',
        repairRound: 1,
        errorCode: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
        fieldPaths: ['segments[2].cameraMovement'],
      })]);
      expect(repairedBudgetDraft).not.toBeNull();
      expect(repairPreviousDrafts).not.toBeNull();
      const finalDraft = result.drafts[targetPlanIndex]!;
      expect(new Set(finalDraft.segments.map(segment => segment.cameraMovement)))
        .toEqual(new Set(['镜头持续缓慢推近，产品证据始终保持清晰']));
      expect(validatePromptWizardShotExecutionBudget({
        shots: finalDraft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);
      expect(() => assertPromptWizardMotionDensity({
        shots: finalDraft.segments,
        durationSeconds: testCase.config.durationSeconds,
      })).not.toThrow();
      const maskAllCameraMovement = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        segments: draft.segments.map(segment => ({
          ...segment,
          cameraMovement: '__cameraMovement__',
        })),
      });
      expect(maskAllCameraMovement(finalDraft)).toEqual(
        maskAllCameraMovement(repairedBudgetDraft!),
      );
      expect(finalDraft.segments.map(segment => ({
        action: segment.action,
        voiceover: segment.voiceover,
        voiceoverZh: segment.voiceoverZh,
        evidenceRefs: segment.evidenceRefs,
      }))).toEqual(repairedBudgetDraft!.segments.map(segment => ({
        action: segment.action,
        voiceover: segment.voiceover,
        voiceoverZh: segment.voiceoverZh,
        evidenceRefs: segment.evidenceRefs,
      })));
      expect(finalDraft.segments.at(-1)?.voiceover)
        .toBe(repairedBudgetDraft!.segments.at(-1)?.voiceover);
      expect(result.drafts[1]).toEqual(repairPreviousDrafts![1]);
      expect(result.drafts[2]).toEqual(repairPreviousDrafts![2]);
      const fallbackLines = warnSpy.mock.calls.flatMap(([value]) => (
        typeof value === 'string'
        && value.includes('prompt-wizard-v6-safe-motion-repair-camera-budget-fallback')
          ? [value]
          : []
      ));
      expect(fallbackLines).toHaveLength(1);
      expect(parsePromptWizardCanarySafeTranscript({
        protocolEvents: new Set(),
        transcript: fallbackLines.join('\n'),
      }).normalizedEvents).toEqual([{
        event: 'prompt-wizard-v6-safe-motion-repair-camera-budget-fallback',
        planIndex: targetPlanIndex,
        segmentIndex: 2,
        repairRounds: 1,
        issue: {
          code: 'TOO_MANY_CAMERA_MOVES',
          fieldPath: 'segments',
          actual: expect.any(Number),
          limit: 3,
        },
      }]);
    } finally {
      warnSpy.mockRestore();
      env.NODE_ENV = originalNodeEnv;
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 首稿运镜与口播覆盖同时失败时合并为一次原子修复', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '美妆-10s-ja',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000542',
      runId: '00000000-0000-4000-8000-000000000543',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-11T02:15:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 1 as const;
    let repairPreviousDrafts: PromptWizardPlanDraft[] | null = null;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const generated = await generateDrafts(input);
      const planIndex = input.planContexts[0]!.planIndex;
      if (planIndex !== targetPlanIndex || !generated.drafts[0]) return generated;
      generated.drafts[0] = {
        ...generated.drafts[0],
        segments: generated.drafts[0].segments.map((segment, segmentIndex) => ({
          ...segment,
          lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          ...(segmentIndex < 2 ? {
            voiceover: segmentIndex === 0 ? 'よく見てください。' : '細部に注目してください。',
            voiceoverZh: segmentIndex === 0 ? '请仔细看。' : '看清这个细节。',
          } : {}),
          ...(segmentIndex === 2 ? { cameraMovement: '固定机位' } : {}),
        })),
      };
      return generated;
    });
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      const issue = input.issues[0]!;
      expect(issue).toEqual(expect.objectContaining({
        planIndex: targetPlanIndex,
        errorCode: 'PROMPT_WIZARD_CONTENT_REPAIR_REQUIRED',
        fieldPaths: [
          'segments[2].cameraMovement',
          'segments[0].voiceover',
          'segments[0].voiceoverZh',
          'segments[1].voiceover',
          'segments[1].voiceoverZh',
        ],
      }));
      expect(issue.action).toContain('动态不足');
      expect(issue.action).toContain('前三秒');
      repairPreviousDrafts = structuredClone(input.previousDrafts);
      const repaired = await repairDrafts(input);
      const draft = structuredClone(input.previousDrafts[targetPlanIndex]!);
      draft.segments[0]!.voiceover = 'このリップグロスを見てください。';
      draft.segments[0]!.voiceoverZh = `看看这款${testCase.profile.productName}。`;
      draft.segments[1]!.voiceover = '仕上がりの細部まで確認できます。';
      draft.segments[1]!.voiceoverZh = `看清${testCase.profile.productName}的细节表现。`;
      // 模拟 Provider 已获得该运镜键所有权但仍返回静态描述；随后只能由
      // 既有 singleton 安全 fallback 收口，不能再发第二次口播修复。
      draft.segments[2]!.cameraMovement = '固定机位';
      return {
        ...repaired,
        drafts: [{
          ...repaired.drafts[0]!,
          planIndex: targetPlanIndex,
          draft,
        }],
      };
    });

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: testCase.profile,
        evidenceGraph,
        voiceoverLanguage: '日语',
        verifiedOffer: '',
        config: testCase.config,
        routeSet,
        imageCount: 1,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).toHaveBeenCalledTimes(1);
      expect(result.repairRounds).toBe(1);
      expect(result.contentRepairRequestCounts).toEqual([0, 1, 0]);
      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      expect(result.repairDiagnostics).toEqual([expect.objectContaining({
        planIndex: targetPlanIndex,
        origin: 'domain-validation',
        repairRound: 1,
        errorCode: 'PROMPT_WIZARD_CONTENT_REPAIR_REQUIRED',
        fieldPaths: [
          'segments[2].cameraMovement',
          'segments[0].voiceover',
          'segments[0].voiceoverZh',
          'segments[1].voiceover',
          'segments[1].voiceoverZh',
        ],
      })]);
      expect(repairPreviousDrafts).not.toBeNull();
      const finalDraft = result.drafts[targetPlanIndex]!;
      expect(finalDraft.segments[2]!.cameraMovement)
        .toBe('镜头持续缓慢推近，产品证据始终保持清晰');
      expect(() => assertPromptWizardVoiceoverCoverage({
        shots: [
          [0, 2],
          [2, 7],
          [7, 10],
        ].map(([startSeconds, endSeconds], segmentIndex) => ({
          startSeconds: startSeconds!,
          endSeconds: endSeconds!,
          ...finalDraft.segments[segmentIndex]!,
        })),
        targetLanguage: '日语',
        durationSeconds: 10,
        profile: testCase.profile,
        v6SemanticOnly: true,
      })).not.toThrow();
      const maskOwnedFields = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        segments: draft.segments.map((segment, segmentIndex) => ({
          ...segment,
          ...(segmentIndex < 2 ? {
            voiceover: '__voiceover__',
            voiceoverZh: '__voiceoverZh__',
          } : {}),
          ...(segmentIndex === 2 ? { cameraMovement: '__cameraMovement__' } : {}),
        })),
      });
      expect(maskOwnedFields(finalDraft)).toEqual(
        maskOwnedFields(repairPreviousDrafts![targetPlanIndex]!),
      );
      expect(result.drafts[0]).toEqual(repairPreviousDrafts![0]);
      expect(result.drafts[2]).toEqual(repairPreviousDrafts![2]);
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 联合修复只解决运镜时允许第二轮仅原子重写口播', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '美妆-10s-ja',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000544',
      runId: '00000000-0000-4000-8000-000000000545',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-11T02:25:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 1 as const;
    let firstRepairPreviousDrafts: PromptWizardPlanDraft[] | null = null;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const generated = await generateDrafts(input);
      if (input.planContexts[0]!.planIndex !== targetPlanIndex || !generated.drafts[0]) {
        return generated;
      }
      generated.drafts[0] = {
        ...generated.drafts[0],
        segments: generated.drafts[0].segments.map((segment, segmentIndex) => ({
          ...segment,
          lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          ...(segmentIndex < 2 ? {
            voiceover: segmentIndex === 0 ? 'よく見てください。' : '細部に注目してください。',
            voiceoverZh: segmentIndex === 0 ? '请仔细看。' : '看清这个细节。',
          } : {}),
          ...(segmentIndex === 2 ? { cameraMovement: '固定机位' } : {}),
        })),
      };
      return generated;
    });
    let repairRound = 0;
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      repairRound += 1;
      const issue = input.issues[0]!;
      const repaired = await repairDrafts(input);
      const draft = structuredClone(input.previousDrafts[targetPlanIndex]!);
      if (repairRound === 1) {
        firstRepairPreviousDrafts = structuredClone(input.previousDrafts);
        expect(issue).toEqual(expect.objectContaining({
          planIndex: targetPlanIndex,
          errorCode: 'PROMPT_WIZARD_CONTENT_REPAIR_REQUIRED',
          fieldPaths: [
            'segments[2].cameraMovement',
            'segments[0].voiceover',
            'segments[0].voiceoverZh',
            'segments[1].voiceover',
            'segments[1].voiceoverZh',
          ],
        }));
        // 第一轮只解决运镜；原稿已经存在的口播覆盖问题必须保留到第二轮，
        // 不能被当作已修复，也不能获得其他字段所有权。
        draft.segments[2]!.cameraMovement =
          '镜头持续缓慢推近，产品证据始终保持清晰';
      } else {
        expect(issue).toEqual(expect.objectContaining({
          planIndex: targetPlanIndex,
          errorCode: 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
          fieldPaths: [
            'segments[0].voiceover',
            'segments[0].voiceoverZh',
            'segments[1].voiceover',
            'segments[1].voiceoverZh',
          ],
        }));
        draft.segments[0]!.voiceover = 'このリップグロスを見てください。';
        draft.segments[0]!.voiceoverZh = `看看这款${testCase.profile.productName}。`;
        draft.segments[1]!.voiceover = '仕上がりの細部まで確認できます。';
        draft.segments[1]!.voiceoverZh = `看清${testCase.profile.productName}的细节表现。`;
      }
      return {
        ...repaired,
        drafts: [{
          ...repaired.drafts[0]!,
          planIndex: targetPlanIndex,
          draft,
        }],
      };
    });

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: testCase.profile,
        evidenceGraph,
        voiceoverLanguage: '日语',
        verifiedOffer: '',
        config: testCase.config,
        routeSet,
        imageCount: 1,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).toHaveBeenCalledTimes(2);
      expect(repairRound).toBe(2);
      expect(result.repairRounds).toBe(2);
      expect(result.contentRepairRequestCounts).toEqual([0, 2, 0]);
      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      expect(result.repairDiagnostics).toEqual([
        expect.objectContaining({
          planIndex: targetPlanIndex,
          repairRound: 1,
          errorCode: 'PROMPT_WIZARD_CONTENT_REPAIR_REQUIRED',
        }),
        expect.objectContaining({
          planIndex: targetPlanIndex,
          repairRound: 2,
          errorCode: 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
          fieldPaths: [
            'segments[0].voiceover',
            'segments[0].voiceoverZh',
            'segments[1].voiceover',
            'segments[1].voiceoverZh',
          ],
        }),
      ]);
      const finalDraft = result.drafts[targetPlanIndex]!;
      expect(finalDraft.segments[2]!.cameraMovement)
        .toBe('镜头持续缓慢推近，产品证据始终保持清晰');
      expect(() => assertPromptWizardVoiceoverCoverage({
        shots: [
          [0, 2],
          [2, 7],
          [7, 10],
        ].map(([startSeconds, endSeconds], segmentIndex) => ({
          startSeconds: startSeconds!,
          endSeconds: endSeconds!,
          ...finalDraft.segments[segmentIndex]!,
        })),
        targetLanguage: '日语',
        durationSeconds: 10,
        profile: testCase.profile,
        v6SemanticOnly: true,
      })).not.toThrow();
      expect(firstRepairPreviousDrafts).not.toBeNull();
      const maskJointFields = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        segments: draft.segments.map((segment, segmentIndex) => ({
          ...segment,
          ...(segmentIndex < 2 ? {
            voiceover: '__voiceover__',
            voiceoverZh: '__voiceoverZh__',
          } : {}),
          ...(segmentIndex === 2 ? { cameraMovement: '__cameraMovement__' } : {}),
        })),
      });
      expect(maskJointFields(finalDraft)).toEqual(
        maskJointFields(firstRepairPreviousDrafts![targetPlanIndex]!),
      );
      expect(result.drafts[0]).toEqual(firstRepairPreviousDrafts![0]);
      expect(result.drafts[2]).toEqual(firstRepairPreviousDrafts![2]);
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it.each([
    { caseName: '两轮后本地联合收口并交付三案', hiddenUnsafeContent: false },
    { caseName: '联合收口后完整重渲染仍失败则保留真实错误', hiddenUnsafeContent: true },
  ])('V6 action + editingCue 两轮不收敛：$caseName', async ({
    hiddenUnsafeContent,
  }) => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    const originalNodeEnv = env.NODE_ENV;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    env.NODE_ENV = 'production';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '家居-10s-es',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000568',
      runId: '00000000-0000-4000-8000-000000000569',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-12T05:45:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 0 as const;
    let secondRepairPreviousDrafts: PromptWizardPlanDraft[] | null = null;

    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const generated = await generateDrafts(input);
      const planIndex = input.planContexts[0]!.planIndex;
      if (planIndex !== targetPlanIndex || !generated.drafts[0]) return generated;
      generated.drafts[0] = {
        ...generated.drafts[0],
        ...(hiddenUnsafeContent ? { productionWarnings: ['全网都在买'] } : {}),
        segments: generated.drafts[0].segments.map((segment, segmentIndex) => ({
          ...segment,
          lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          ...(segmentIndex === 0 ? { editingCue: '画面定格' } : {}),
          ...(segmentIndex === 2 ? { action: '产品保持不动并完成收束' } : {}),
        })),
      };
      let motionError: PromptWizardMotionDensityError | null = null;
      try {
        assertPromptWizardMotionDensity({
          shots: generated.drafts[0].segments,
          durationSeconds: testCase.config.durationSeconds,
        });
      } catch (error) {
        if (error instanceof PromptWizardMotionDensityError) motionError = error;
      }
      expect(motionError?.fieldPaths).toEqual([
        'segments[0].editingCue',
        'segments[2].action',
      ]);
      expect(validatePromptWizardShotExecutionBudget({
        shots: generated.drafts[0].segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);
      return generated;
    });

    let repairRound = 0;
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      repairRound += 1;
      expect(input.issues).toEqual([expect.objectContaining({
        planIndex: targetPlanIndex,
        errorCode: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
        fieldPaths: ['segments[0].editingCue', 'segments[2].action'],
      })]);
      if (repairRound === 2) {
        secondRepairPreviousDrafts = structuredClone(input.previousDrafts);
      }
      const repaired = await repairDrafts(input);
      // 两轮都模拟 Provider 仍返回同一组静态叶子；服务端必须在第二轮后
      // 本地原子收口，而不是发起第三次内容修复。
      const draft = structuredClone(input.previousDrafts[targetPlanIndex]!);
      draft.segments[0]!.editingCue = '画面定格';
      draft.segments[2]!.action = '产品保持不动并完成收束';
      return {
        ...repaired,
        drafts: [{
          ...repaired.drafts[0]!,
          planIndex: targetPlanIndex,
          draft,
        }],
      };
    });

    try {
      let result: Awaited<ReturnType<typeof generateValidatedPromptWizardRoutePlansV6>> | null = null;
      let thrown: unknown;
      try {
        result = await generateValidatedPromptWizardRoutePlansV6({
          provider: {
            generateUseDirectionDrafts: generateSpy,
            repairUseDirectionDrafts: repairSpy,
          } as never,
          profile: testCase.profile,
          evidenceGraph,
          voiceoverLanguage: '西班牙语',
          verifiedOffer: '',
          config: testCase.config,
          routeSet,
          imageCount: 1,
          variationKey: 1,
          deadlineAtMs: Date.now() + 240_000,
          historicalPlans: [],
        });
      } catch (error) {
        thrown = error;
      }

      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).toHaveBeenCalledTimes(2);
      expect(repairRound).toBe(2);
      expect(secondRepairPreviousDrafts).not.toBeNull();
      if (hiddenUnsafeContent) {
        expect(result).toBeNull();
        expect(thrown).toMatchObject({
          code: 'PROMPT_WIZARD_UNSAFE_CONTENT',
          fieldPaths: ['productionWarnings[0]'],
          repairRounds: 2,
          planIndexes: [targetPlanIndex],
          contentRepairRequestCounts: [2, 0, 0],
          terminalCalibrationRequestCounts: [0, 0, 0],
          providerRequestAttempted: true,
          usage: { input_tokens: 0, output_tokens: 0 },
        });
        expect(warnSpy.mock.calls.some(([value]) => (
          typeof value === 'string'
          && value.includes('prompt-wizard-safe-motion-combination-fallback')
        ))).toBe(false);
        return;
      }

      if (!result) throw thrown;
      expect(result.plans).toHaveLength(3);
      expect(result.drafts).toHaveLength(3);
      expect(result.repairRounds).toBe(2);
      expect(result.contentRepairRequestCounts).toEqual([2, 0, 0]);
      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      expect(result.formatRepairCount).toBe(0);
      expect(result.usage).toMatchObject({
        requestAttempts: 5,
        inputTokens: 0,
        outputTokens: 0,
      });
      expect(result.repairDiagnostics).toEqual([
        expect.objectContaining({
          planIndex: targetPlanIndex,
          repairRound: 1,
          errorCode: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
          fieldPaths: ['segments[0].editingCue', 'segments[2].action'],
        }),
        expect.objectContaining({
          planIndex: targetPlanIndex,
          repairRound: 2,
          errorCode: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
          fieldPaths: ['segments[0].editingCue', 'segments[2].action'],
        }),
      ]);
      const finalDraft = result.drafts[targetPlanIndex]!;
      expect(finalDraft.segments[0]!.editingCue)
        .toBe('沿当前镜头动作点切换景别，保持画面连续');
      expect(finalDraft.segments[2]!.action).toMatch(/持续/u);
      expect(() => assertPromptWizardMotionDensity({
        shots: finalDraft.segments,
        durationSeconds: testCase.config.durationSeconds,
      })).not.toThrow();
      expect(validatePromptWizardShotExecutionBudget({
        shots: finalDraft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);

      const maskOwnedLeaves = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        segments: draft.segments.map((segment, segmentIndex) => ({
          ...segment,
          ...(segmentIndex === 0 ? { editingCue: '__editingCue__' } : {}),
          ...(segmentIndex === 2 ? { action: '__action__' } : {}),
        })),
      });
      expect(maskOwnedLeaves(finalDraft)).toEqual(
        maskOwnedLeaves(secondRepairPreviousDrafts![targetPlanIndex]!),
      );
      expect(result.drafts[1]).toEqual(secondRepairPreviousDrafts![1]);
      expect(result.drafts[2]).toEqual(secondRepairPreviousDrafts![2]);
      const fallbackLines = warnSpy.mock.calls.flatMap(([value]) => (
        typeof value === 'string'
        && value.includes('prompt-wizard-safe-motion-combination-fallback')
          ? [value]
          : []
      ));
      expect(fallbackLines).toHaveLength(1);
      expect(parsePromptWizardCanarySafeTranscript({
        protocolEvents: new Set(),
        transcript: fallbackLines.join('\n'),
      }).normalizedEvents).toEqual([{
        event: 'prompt-wizard-safe-motion-combination-fallback',
        planIndex: targetPlanIndex,
        repairRounds: 2,
      }]);
    } finally {
      warnSpy.mockRestore();
      env.NODE_ENV = originalNodeEnv;
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it.each([
    { caseName: '第二轮部分收敛为 singleton 后本地收口并交付三案', hiddenUnsafeContent: false },
    { caseName: 'singleton 候选完整重渲染失败时保留真实错误', hiddenUnsafeContent: true },
  ])('V6 多 cameraMovement 两轮不收敛：$caseName', async ({
    hiddenUnsafeContent,
  }) => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    const originalNodeEnv = env.NODE_ENV;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    env.NODE_ENV = 'production';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '服饰-15s-en',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000582',
      runId: '00000000-0000-4000-8000-000000000583',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-13T00:10:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    // T065842 证据里的目标方案使用零基索引 2。
    const targetPlanIndex = 2 as const;
    let secondRepairPreviousDrafts: PromptWizardPlanDraft[] | null = null;
    let secondRepairReturnedDrafts: PromptWizardPlanDraft[] | null = null;

    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const generated = await generateDrafts(input);
      const planIndex = input.planContexts[0]!.planIndex;
      if (planIndex !== targetPlanIndex || !generated.drafts[0]) return generated;
      generated.drafts[0] = {
        ...generated.drafts[0],
        ...(hiddenUnsafeContent ? { productionWarnings: ['全网都在买'] } : {}),
        segments: generated.drafts[0].segments.map((segment, segmentIndex) => ({
          ...segment,
          lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          ...(segmentIndex === 0 || segmentIndex === 3
            ? { cameraMovement: '固定机位' }
            : {}),
        })),
      };
      let motionError: PromptWizardMotionDensityError | null = null;
      try {
        assertPromptWizardMotionDensity({
          shots: generated.drafts[0].segments,
          durationSeconds: testCase.config.durationSeconds,
        });
      } catch (error) {
        if (error instanceof PromptWizardMotionDensityError) motionError = error;
      }
      expect(motionError?.fieldPaths).toEqual([
        'segments[0].cameraMovement',
        'segments[3].cameraMovement',
      ]);
      expect(validatePromptWizardShotExecutionBudget({
        shots: generated.drafts[0].segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);
      return generated;
    });

    let repairRound = 0;
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      repairRound += 1;
      expect(input.issues).toEqual([expect.objectContaining({
        planIndex: targetPlanIndex,
        errorCode: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
        fieldPaths: [
          'segments[0].cameraMovement',
          'segments[3].cameraMovement',
        ],
      })]);
      if (repairRound === 2) {
        secondRepairPreviousDrafts = structuredClone(input.previousDrafts);
      }
      const repaired = await repairDrafts(input);
      // 第一轮仍返回两个静态运镜；第二轮只修好一个，真实复现 Attempt1
      // 的部分收敛。两轮耗尽后服务端只能收口剩余 singleton，不能形成
      // 第三次逻辑或物理修复。
      const draft = structuredClone(input.previousDrafts[targetPlanIndex]!);
      draft.segments[0]!.cameraMovement = '固定机位';
      draft.segments[3]!.cameraMovement = '固定机位';
      if (repairRound === 2) {
        draft.segments[0]!.cameraMovement =
          '镜头持续缓慢推近，产品证据始终保持清晰';
      }
      const response = {
        ...repaired,
        drafts: [{
          ...repaired.drafts[0]!,
          planIndex: targetPlanIndex,
          draft,
        }],
      };
      if (repairRound === 2) {
        secondRepairReturnedDrafts = structuredClone(input.previousDrafts);
        secondRepairReturnedDrafts[targetPlanIndex] = structuredClone(draft);
      }
      return response;
    });

    try {
      let result: Awaited<ReturnType<typeof generateValidatedPromptWizardRoutePlansV6>> | null = null;
      let thrown: unknown;
      try {
        result = await generateValidatedPromptWizardRoutePlansV6({
          provider: {
            generateUseDirectionDrafts: generateSpy,
            repairUseDirectionDrafts: repairSpy,
          } as never,
          profile: testCase.profile,
          evidenceGraph,
          voiceoverLanguage: '英语',
          verifiedOffer: '',
          config: testCase.config,
          routeSet,
          imageCount: 1,
          variationKey: 1,
          deadlineAtMs: Date.now() + 240_000,
          historicalPlans: [],
        });
      } catch (error) {
        thrown = error;
      }

      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).toHaveBeenCalledTimes(2);
      expect(repairRound).toBe(2);
      expect(secondRepairPreviousDrafts).not.toBeNull();
      expect(secondRepairReturnedDrafts).not.toBeNull();
      if (hiddenUnsafeContent) {
        expect(result).toBeNull();
        expect(thrown).toMatchObject({
          code: 'PROMPT_WIZARD_UNSAFE_CONTENT',
          fieldPaths: ['productionWarnings[0]'],
          repairRounds: 2,
          planIndexes: [targetPlanIndex],
          contentRepairRequestCounts: [0, 0, 2],
          terminalCalibrationRequestCounts: [0, 0, 0],
          providerRequestAttempted: true,
          usage: { input_tokens: 0, output_tokens: 0 },
        });
        expect(warnSpy.mock.calls.some(([value]) => (
          typeof value === 'string'
          && value.includes('prompt-wizard-safe-segment-camera-motion-fallback')
        ))).toBe(false);
        return;
      }

      if (!result) throw thrown;
      expect(result.plans).toHaveLength(3);
      expect(result.drafts).toHaveLength(3);
      expect(result.repairRounds).toBe(2);
      expect(result.contentRepairRequestCounts).toEqual([0, 0, 2]);
      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      expect(result.formatRepairCount).toBe(0);
      expect(result.usage).toMatchObject({
        requestAttempts: 5,
        inputTokens: 0,
        outputTokens: 0,
      });
      expect(result.repairDiagnostics).toEqual([
        expect.objectContaining({
          planIndex: targetPlanIndex,
          repairRound: 1,
          errorCode: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
          fieldPaths: [
            'segments[0].cameraMovement',
            'segments[3].cameraMovement',
          ],
        }),
        expect.objectContaining({
          planIndex: targetPlanIndex,
          repairRound: 2,
          errorCode: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
          fieldPaths: [
            'segments[0].cameraMovement',
            'segments[3].cameraMovement',
          ],
        }),
      ]);
      const finalDraft = result.drafts[targetPlanIndex]!;
      expect(finalDraft.segments[0]!.cameraMovement)
        .toBe('镜头持续缓慢推近，产品证据始终保持清晰');
      expect(finalDraft.segments[3]!.cameraMovement)
        .toBe('镜头持续缓慢推近，产品证据始终保持清晰');
      expect(() => assertPromptWizardMotionDensity({
        shots: finalDraft.segments,
        durationSeconds: testCase.config.durationSeconds,
      })).not.toThrow();
      expect(validatePromptWizardShotExecutionBudget({
        shots: finalDraft.segments,
        config: testCase.config,
        deliveryVersion: 6,
      })).toEqual([]);

      const maskOwnedLeaves = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        segments: draft.segments.map((segment, segmentIndex) => (
          segmentIndex === 3
            ? { ...segment, cameraMovement: '__cameraMovement__' }
            : segment
        )),
      });
      expect(maskOwnedLeaves(finalDraft)).toEqual(
        maskOwnedLeaves(secondRepairReturnedDrafts![targetPlanIndex]!),
      );
      expect(result.drafts[0]).toEqual(secondRepairReturnedDrafts![0]);
      expect(result.drafts[1]).toEqual(secondRepairReturnedDrafts![1]);
      const fallbackLines = warnSpy.mock.calls.flatMap(([value]) => (
        typeof value === 'string'
        && value.includes('prompt-wizard-safe-segment-camera-motion-fallback')
          ? [value]
          : []
      ));
      expect(fallbackLines).toHaveLength(1);
      expect(JSON.parse(fallbackLines[0]!)).toEqual({
        event: 'prompt-wizard-safe-segment-camera-motion-fallback',
        planIndex: targetPlanIndex,
        segmentIndexes: [3],
        repairRounds: 2,
      });
      expect(parsePromptWizardCanarySafeTranscript({
        protocolEvents: new Set(),
        transcript: fallbackLines.join('\n'),
      }).normalizedEvents).toEqual([{
        event: 'prompt-wizard-safe-segment-camera-motion-fallback',
        planIndex: targetPlanIndex,
        segmentIndexes: [3],
        repairRounds: 2,
      }]);
    } finally {
      warnSpy.mockRestore();
      env.NODE_ENV = originalNodeEnv;
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it.each([
    {
      caseName: '超出旧字数上限不再阻止 lighting 收口，完整重渲染继续执行 CTA 门禁',
      oversizedVoiceover: true,
      invalidCta: false,
      expectedCode: 'PROMPT_WIZARD_CONVERSION_CTA_INVALID',
    },
    {
      caseName: 'lighting 候选完整重渲染暴露 CTA 错误时允许第二轮后关闭',
      oversizedVoiceover: false,
      invalidCta: true,
      expectedCode: 'PROMPT_WIZARD_CONVERSION_CTA_INVALID',
    },
  ])('V6 lighting fallback 后的新 CTA 错误允许第二次 Provider 修复：$caseName', async ({
    oversizedVoiceover,
    invalidCta,
    expectedCode,
  }) => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '服饰-10s-zh',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000534',
      runId: '00000000-0000-4000-8000-000000000535',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-10T05:35:33.200Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      if (input.planContexts[0]?.planIndex !== 0 || !result.drafts[0]) return result;
      const lastIndex = result.drafts[0].segments.length - 1;
      result.drafts[0] = {
        ...result.drafts[0],
        segments: result.drafts[0].segments.map((segment, index) => ({
          ...segment,
          lightingAndRealism: index === lastIndex
            ? '固定机位下光影移动但光线保持静止不变'
            : `${segment.lightingAndRealism}，窗边光影移动`,
          ...(invalidCta && index === lastIndex
            ? { voiceover: '继续了解真实生活细节', voiceoverZh: '' }
            : {}),
        })),
      };
      return result;
    });
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      const result = await repairDrafts(input);
      const issue = input.issues[0]!;
      const draft = structuredClone(input.previousDrafts[issue.planIndex]!);
      if (oversizedVoiceover) {
        draft.segments.at(-1)!.voiceover = '现'.repeat(80);
        draft.segments.at(-1)!.voiceoverZh = '';
      }
      return {
        ...result,
        drafts: [{
          ...result.drafts[0]!,
          planIndex: issue.planIndex,
          draft,
        }],
      };
    });

    try {
      const failure = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: testCase.profile,
        evidenceGraph,
        voiceoverLanguage: '普通话',
        verifiedOffer: '',
        config: testCase.config,
        routeSet,
        imageCount: 1,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      }).then(() => null, error => error);

      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).toHaveBeenCalledTimes(2);
      expect(repairSpy.mock.calls[0]?.[0].issues).toEqual([
        expect.objectContaining({
          planIndex: 0,
          errorCode: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
          fieldPaths: ['segments[2].lightingAndRealism'],
        }),
      ]);
      expect(repairSpy.mock.calls[1]?.[0].issues).toEqual([
        expect.objectContaining({
          planIndex: 0,
          errorCode: expectedCode,
        }),
      ]);
      expect(failure).toMatchObject({
        code: expectedCode,
        repairRounds: 2,
        planIndexes: [0],
        contentRepairRequestCounts: [2, 0, 0],
        terminalCalibrationRequestCounts: [0, 0, 0],
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it.each([
    {
      caseName: '额外 Provider 正文键',
      mutate: (diagnostic: Record<string, unknown>) => {
        diagnostic.providerBody = 'secret-provider-body';
      },
    },
    {
      caseName: '动态 Provider 字段路径',
      mutate: (diagnostic: Record<string, unknown>) => {
        diagnostic.fieldPaths = ['provider.responseText'];
      },
    },
  ])('V6 输出诊断包含$caseName时失败关闭且不泄漏内容', async ({ mutate }) => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-00000000035c',
      runId: '00000000-0000-4000-8000-00000000035d',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 1 as const;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      if (input.planContexts[0]?.planIndex !== targetPlanIndex) return result;
      const diagnostic: Record<string, unknown> = {
        planIndex: targetPlanIndex,
        operation: 'generate-drafts',
        stage: 'initial',
        phase: 'decoded',
        classification: 'valid-json',
        normalizationMode: 'native',
        schemaIssue: 'not-applicable',
        outputLengthBucket: '1-2048',
        containerDepthBucket: '1-4',
        outputTextSource: 'completed',
        fieldPaths: [],
      };
      mutate(diagnostic);
      return { ...result, outputDiagnostics: [diagnostic] };
    });

    try {
      const error = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: fakeProvider.repairUseDirectionDrafts.bind(fakeProvider),
        } as never,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        voiceoverLanguage: context.brief.targetLanguage,
        verifiedOffer: '',
        config: context.config,
        routeSet,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      }).catch(cause => cause);

      expect(error).toMatchObject({
        code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
        planIndexes: [targetPlanIndex],
        outputDiagnostics: [],
      });
      expect(JSON.stringify(error)).not.toMatch(/secret-provider-body|provider\.responseText/iu);
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 首轮 Provider 失败的非法诊断会脱敏且仍与物理计数对账', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-00000000032c',
      runId: '00000000-0000-4000-8000-00000000032d',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 1 as const;
    const unsafeDiagnostic = {
      planIndex: targetPlanIndex,
      origin: 'initial-schema' as const,
      repairRound: 1 as const,
      errorCode: 'PROMPT_WIZARD_PROVIDER_SECRET',
      fieldPaths: ['provider.responseText'],
    };
    const safeDiagnostic = {
      planIndex: targetPlanIndex,
      origin: 'initial-schema' as const,
      repairRound: 1 as const,
      errorCode: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      fieldPaths: [],
    };
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      if (input.planContexts[0]?.planIndex === targetPlanIndex) {
        throw Object.assign(new Error('安全的结构化失败'), {
          code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
          repairRounds: 1,
          repairDiagnostics: [unsafeDiagnostic],
        });
      }
      return generateDrafts(input);
    });

    try {
      await expect(generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: fakeProvider.repairUseDirectionDrafts.bind(fakeProvider),
        } as never,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        voiceoverLanguage: context.brief.targetLanguage,
        verifiedOffer: '',
        config: context.config,
        routeSet,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      })).rejects.toMatchObject({
        code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
        planIndexes: [targetPlanIndex],
        contentRepairRequestCounts: [0, 1, 0],
        terminalCalibrationRequestCounts: [0, 0, 0],
        repairDiagnostics: [safeDiagnostic],
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 非白名单诊断在计入修复预算前失败关闭且不保留动态字段', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-00000000030e',
      runId: '00000000-0000-4000-8000-00000000030f',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 1 as const;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      return input.planContexts[0]?.planIndex === targetPlanIndex
        ? {
            ...result,
            repairRounds: 1,
            repairDiagnostics: [{
              planIndex: targetPlanIndex,
              origin: 'initial-schema',
              repairRound: 1,
              errorCode: 'PROMPT_WIZARD_PROVIDER_SECRET',
              fieldPaths: ['provider.responseText'],
            }],
          }
        : result;
    });

    try {
      await expect(generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairDrafts,
        } as never,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        voiceoverLanguage: context.brief.targetLanguage,
        verifiedOffer: '',
        config: context.config,
        routeSet,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      })).rejects.toMatchObject({
        code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
        planIndexes: [targetPlanIndex],
        contentRepairRequestCounts: [0, 0, 0],
        repairDiagnostics: [],
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 最终 prompt 过长时保留原错误且不会降级成 Provider 输入错误', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const base = makeConceptGenerationContext();
    const oversizedProfile = {
      ...base.profile,
      usage: '展开头梁后佩戴于双耳并按下实体按键。'.repeat(100).slice(0, 2_000),
      consistencyConstraints: '保持参考图片中的产品颜色、结构、标识和部件位置一致。'.repeat(80)
        .slice(0, 2_000),
    };
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000314',
      runId: '00000000-0000-4000-8000-000000000315',
      runRevision: 1,
      profile: base.profile,
      evidenceGraph: base.evidenceGraph,
      productionBrief: base.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const provider = new FakePromptWizardProvider();
    const repairSpy = vi.spyOn(provider, 'repairUseDirectionDrafts');
    try {
      await expect(generateValidatedPromptWizardRoutePlansV6({
        provider,
        profile: oversizedProfile,
        evidenceGraph: base.evidenceGraph,
        voiceoverLanguage: base.brief.targetLanguage,
        verifiedOffer: '',
        config: base.config,
        routeSet,
        imageCount: 1,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      })).rejects.toMatchObject({
        code: 'PROMPT_WIZARD_PROMPT_TOO_LONG',
        fieldPaths: ['prompt'],
      });
      expect(repairSpy).not.toHaveBeenCalled();
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 对全局索引 1/2 的安全 Draft 错误分别执行单方案修复', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000316',
      runId: '00000000-0000-4000-8000-000000000317',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      const planIndex = input.planContexts[0]?.planIndex;
      if ((planIndex === 1 || planIndex === 2) && result.drafts[0]) {
        result.drafts[0] = {
          ...result.drafts[0],
          hook: '支持主动降噪的通勤体验',
        };
      }
      return result;
    });
    const repairSpy = vi.fn((input: Parameters<typeof repairDrafts>[0]) => (
      repairDrafts(input)
    ));

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        voiceoverLanguage: context.brief.targetLanguage,
        verifiedOffer: '',
        config: context.config,
        routeSet,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(result.plans.map(plan => plan.deliveryVersion === 6 ? plan.role : null))
        .toEqual(['proof-conversion', 'problem-hook', 'lifestyle-seeding']);
      expect(result.repairRounds).toBeGreaterThanOrEqual(1);
      // plan 1 在不实卖点被修复后又触发一次后续内容门禁；物理计数必须
      // 如实记录两次请求，而不能被全局 repairRounds 或错误类型筛选压平。
      expect(result.contentRepairRequestCounts).toEqual([0, 2, 1]);
      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      const repairInputs = repairSpy.mock.calls.map(([input]) => input)
        .filter(input => input.issues[0]?.errorCode === 'PROMPT_WIZARD_UNCONFIRMED_CLAIM')
        .sort((left, right) => left.issues[0]!.planIndex - right.issues[0]!.planIndex);
      expect(repairInputs).toHaveLength(2);
      expect(repairInputs.map(input => input.issues[0]!.planIndex)).toEqual([1, 2]);
      repairInputs.forEach((input, offset) => {
        const expectedPlanIndex = (offset + 1) as 1 | 2;
        const issue = input.issues[0]!;
        const planContext = input.planContexts[0]!;
        expect(input.issues).toHaveLength(1);
        expect(input.planContexts).toHaveLength(1);
        expect(issue).toMatchObject({
          planIndex: expectedPlanIndex,
          errorCode: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
          fieldPaths: ['hook'],
        });
        expect(planContext.planIndex).toBe(expectedPlanIndex);
        expect('routeRole' in planContext ? planContext.routeRole : null).toBe(
          expectedPlanIndex === 1 ? 'problem-hook' : 'lifestyle-seeding',
        );
        expect(input.previousDrafts).toHaveLength(3);
        expect(input.previousDrafts[expectedPlanIndex]).toBeDefined();
        expect(issue.fieldPaths).not.toEqual(expect.arrayContaining([
          'prompt',
          'verifiedOffer',
          'shots',
        ]));
        expect(issue.action.trim()).not.toBe('');
        expect(issue.action.length).toBeLessThanOrEqual(1_000);
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 第二轮修复才引入首尾帧制作备注时确定性清空且不发起第三次修复', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const config = {
      model: 'seedance-2.0-mini',
      aspectRatio: '9:16',
      resolution: '480p',
      durationSeconds: 5,
    } as const;
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000344',
      runId: '00000000-0000-4000-8000-000000000345',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 1 as const;
    const unsafeHook = '支持主动降噪的通勤体验';
    let validTargetDraft: PromptWizardPlanDraft | null = null;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const generated = await generateDrafts(input);
      if (generated.drafts[0]) {
        generated.drafts[0] = {
          ...generated.drafts[0],
          segments: generated.drafts[0].segments.map(segment => ({
            ...segment,
            // 补足合法环境动态，让回归只聚焦终态参考模式收口。
            lightingAndRealism: `${segment.lightingAndRealism}，窗边光影持续移动`,
          })),
        };
      }
      if (input.planContexts[0]?.planIndex === targetPlanIndex && generated.drafts[0]) {
        validTargetDraft = structuredClone(generated.drafts[0]);
        generated.drafts[0] = { ...generated.drafts[0], hook: unsafeHook };
      }
      return generated;
    });
    let targetRepairRound = 0;
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      const repaired = await repairDrafts(input);
      const issue = input.issues[0];
      if (issue?.planIndex !== targetPlanIndex || !validTargetDraft) return repaired;
      targetRepairRound += 1;
      const draft = targetRepairRound === 1
        ? structuredClone(input.previousDrafts[targetPlanIndex]!)
        : structuredClone(validTargetDraft);
      if (targetRepairRound === 1) {
        draft.hook = unsafeHook;
      } else {
        draft.segments[0] = {
          ...draft.segments[0]!,
          productionNote: '尾帧保持商品位置与参考图片一致',
        };
      }
      return {
        ...repaired,
        drafts: [{
          ...repaired.drafts[0]!,
          planIndex: targetPlanIndex,
          draft,
        }],
      };
    });

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        voiceoverLanguage: context.brief.targetLanguage,
        verifiedOffer: '',
        config,
        routeSet,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(result.repairRounds).toBe(2);
      expect(result.contentRepairRequestCounts).toEqual([0, 2, 0]);
      expect(targetRepairRound).toBe(2);
      expect(repairSpy).toHaveBeenCalledTimes(2);
      expect(result.drafts[targetPlanIndex]!.segments[0]!.productionNote).toBe('');
      expect(result.plans[targetPlanIndex]!.prompt).not.toMatch(/首\s*帧|尾\s*帧|首\s*尾\s*帧/iu);
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 首稿格式恢复后若仍未通过完整领域门禁则失败关闭且不发起第三次请求', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const base = makeConceptGenerationContext();
    const config = {
      model: 'seedance-2.0-mini',
      aspectRatio: '9:16',
      resolution: '480p',
      durationSeconds: 10,
    } as const;
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000318',
      runId: '00000000-0000-4000-8000-000000000319',
      runRevision: 1,
      profile: base.profile,
      evidenceGraph: base.evidenceGraph,
      productionBrief: base.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 1 as const;
    const outputDiagnostics = [
      {
        planIndex: targetPlanIndex,
        operation: 'generate-drafts',
        stage: 'initial',
        phase: 'parse',
        classification: 'container-truncated',
        normalizationMode: 'none',
        schemaIssue: 'not-applicable',
        outputLengthBucket: '2049-8192',
        containerDepthBucket: '1-4',
        outputTextSource: 'completed',
        fieldPaths: [],
      },
      {
        planIndex: targetPlanIndex,
        operation: 'repair-draft-format',
        stage: 'format-recovery',
        phase: 'decoded',
        classification: 'valid-json',
        normalizationMode: 'native',
        schemaIssue: 'not-applicable',
        outputLengthBucket: '2049-8192',
        containerDepthBucket: '1-4',
        outputTextSource: 'completed',
        fieldPaths: [],
      },
    ] as const;
    let physicalRequestAttempts = 0;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      physicalRequestAttempts += 1;
      const generated = await generateDrafts(input);
      const planIndex = input.planContexts[0]?.planIndex ?? 0;
      if (planIndex !== targetPlanIndex || !generated.drafts[0]) return generated;
      physicalRequestAttempts += 1;
      return {
        ...generated,
        drafts: [{
          ...generated.drafts[0],
          // 恢复结果虽是可解析 JSON，仍夹带未确认的降噪功效，
          // 必须在全量领域门禁后直接失败，不再发内容修复。
          hook: '支持主动降噪的通勤体验',
        }],
        repairRounds: 0,
        formatRepairCount: 1,
        outputDiagnostics: outputDiagnostics.map(item => ({ ...item })),
        // 当前索引内含首稿 + 格式恢复两次物理请求。
        usage: { ...generated.usage, requestAttempts: 2 },
      };
    });
    const repairSpy = vi.fn((input: Parameters<typeof repairDrafts>[0]) => repairDrafts(input));

    try {
      const failure = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: base.profile,
        evidenceGraph: base.evidenceGraph,
        voiceoverLanguage: '英语',
        verifiedOffer: '',
        config,
        routeSet,
        imageCount: base.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
        costOwner: {
          runId: '00000000-0000-4000-8000-000000000318',
          batchId: '00000000-0000-4000-8000-000000000319',
          deliveryVersion: 6,
          userId: '00000000-0000-4000-8000-00000000031a',
          jobAttempt: 1,
          repairRound: 0,
        },
      }).then(
        () => null,
        error => error,
      );

      expect(failure).toMatchObject({
        code: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
        repairRounds: 0,
        planIndexes: [targetPlanIndex],
        contentRepairRequestCounts: [0, 0, 0],
        terminalCalibrationRequestCounts: [0, 0, 0],
        outputDiagnostics: outputDiagnostics.map(item => ({ ...item })),
      });
      // 编排层仅有三条并行首稿调用；物理请求数为 3 次首稿
      // + 目标索引 1 次格式恢复，内容修复和终局校准均为 0。
      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(physicalRequestAttempts).toBe(4);
      expect(repairSpy).not.toHaveBeenCalled();
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 西班牙语 10 秒格式恢复后唯一运镜超额时本地收口且不发内容修复', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const originalNodeEnv = env.NODE_ENV;
    env.NODE_ENV = 'production';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const base = makeConceptGenerationContext();
    const config = {
      model: 'seedance-2.0-fast',
      aspectRatio: '9:16',
      resolution: '720p',
      durationSeconds: 10,
    } as const;
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-00000000036a',
      runId: '00000000-0000-4000-8000-00000000036b',
      runRevision: 1,
      profile: base.profile,
      evidenceGraph: base.evidenceGraph,
      productionBrief: base.productionBrief,
      createdAt: '2026-08-10T17:46:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 1 as const;
    const outputDiagnostics = [
      {
        planIndex: targetPlanIndex,
        operation: 'generate-drafts',
        stage: 'initial',
        phase: 'parse',
        classification: 'string-truncated',
        normalizationMode: 'none',
        schemaIssue: 'not-applicable',
        outputLengthBucket: '1-2048',
        containerDepthBucket: '1-4',
        outputTextSource: 'completed',
        fieldPaths: [],
      },
      {
        planIndex: targetPlanIndex,
        operation: 'repair-draft-format',
        stage: 'format-recovery',
        phase: 'decoded',
        classification: 'valid-json',
        normalizationMode: 'native',
        schemaIssue: 'not-applicable',
        outputLengthBucket: '1-2048',
        containerDepthBucket: '1-4',
        outputTextSource: 'completed',
        fieldPaths: [],
      },
    ] as const;
    let physicalRequestAttempts = 0;
    let recoveredDraft: PromptWizardPlanDraft | null = null;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      physicalRequestAttempts += 1;
      const generated = await generateDrafts(input);
      const planIndex = input.planContexts[0]?.planIndex ?? 0;
      if (planIndex !== targetPlanIndex || !generated.drafts[0]) return generated;
      physicalRequestAttempts += 1;
      const draft = structuredClone(generated.drafts[0]);
      draft.segments = draft.segments.map((segment, segmentIndex) => ({
        ...segment,
        cameraMovement: [
          '镜头快速推近后横移展示产品证据',
          '镜头跟随手部操作过程',
          '镜头环绕产品结果',
        ][segmentIndex]!,
      }));
      expect(validatePromptWizardShotExecutionBudget({
        shots: draft.segments,
        config,
      })).toEqual([expect.objectContaining({
        code: 'TOO_MANY_CAMERA_MOVES',
        fieldPath: 'segments',
        actual: 4,
        limit: 3,
      })]);
      recoveredDraft = normalizePromptWizardRouteDraftV6({
        draft: structuredClone(draft),
        planContext: promptWizardRoutePlanContextsV6(routeSet)[targetPlanIndex]!,
        evidenceGraph: base.evidenceGraph,
        profile: base.profile,
        config,
      });
      return {
        ...generated,
        drafts: [draft],
        repairRounds: 0,
        formatRepairCount: 1,
        outputDiagnostics: outputDiagnostics.map(item => ({ ...item })),
        usage: { ...generated.usage, requestAttempts: 2 },
      };
    });
    const repairSpy = vi.fn((input: Parameters<typeof repairDrafts>[0]) => repairDrafts(input));

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: base.profile,
        evidenceGraph: base.evidenceGraph,
        voiceoverLanguage: '西班牙语',
        verifiedOffer: '',
        config,
        routeSet,
        imageCount: base.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(recoveredDraft).not.toBeNull();
      expect(result.repairRounds).toBe(0);
      expect(result.formatRepairCount).toBe(1);
      expect(result.contentRepairRequestCounts).toEqual([0, 0, 0]);
      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      expect(result.outputDiagnostics).toEqual(outputDiagnostics.map(item => ({ ...item })));
      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(physicalRequestAttempts).toBe(4);
      expect(repairSpy).not.toHaveBeenCalled();
      expect(result.drafts[targetPlanIndex]!.segments.every(segment => (
        segment.cameraMovement === '镜头持续缓慢推近，产品证据始终保持清晰'
      ))).toBe(true);
      const maskCameraMovement = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        segments: draft.segments.map(segment => ({
          ...segment,
          cameraMovement: '__cameraMovement__',
        })),
      });
      expect(maskCameraMovement(result.drafts[targetPlanIndex]!)).toEqual(
        maskCameraMovement(recoveredDraft!),
      );
      const fallbackLines = warnSpy.mock.calls.flatMap(([value]) => (
        typeof value === 'string'
        && value.includes('prompt-wizard-v6-safe-format-recovery-camera-budget-fallback')
          ? [value]
          : []
      ));
      expect(fallbackLines).toHaveLength(1);
      expect(parsePromptWizardCanarySafeTranscript({
        protocolEvents: new Set(),
        transcript: fallbackLines.join('\n'),
      }).normalizedEvents).toEqual([{
        event: 'prompt-wizard-v6-safe-format-recovery-camera-budget-fallback',
        planIndex: targetPlanIndex,
        issue: {
          code: 'TOO_MANY_CAMERA_MOVES',
          fieldPath: 'segments',
          actual: 4,
          limit: 3,
        },
      }]);

      generateSpy.mockClear();
      repairSpy.mockClear();
      physicalRequestAttempts = 0;
      recoveredDraft = null;
      const wrongModelFailure = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: base.profile,
        evidenceGraph: base.evidenceGraph,
        voiceoverLanguage: '西班牙语',
        verifiedOffer: '',
        config: { ...config, model: 'seedance-2.0' },
        routeSet,
        imageCount: base.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      }).then(
        () => null,
        error => error,
      );
      expect(wrongModelFailure).toMatchObject({
        code: 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED',
        repairRounds: 0,
        planIndexes: [targetPlanIndex],
        contentRepairRequestCounts: [0, 0, 0],
        terminalCalibrationRequestCounts: [0, 0, 0],
      });
      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(physicalRequestAttempts).toBe(4);
      expect(repairSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      env.NODE_ENV = originalNodeEnv;
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it.each([
    { caseName: '本地收口并完整交付三案', hiddenUnsafeContent: false },
    { caseName: '完整重渲染暴露后置错误时失败关闭', hiddenUnsafeContent: true },
  ])('V6 格式恢复后 singleton cameraMovement：$caseName', async ({
    hiddenUnsafeContent,
  }) => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    const originalNodeEnv = env.NODE_ENV;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    env.NODE_ENV = 'production';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const testCase = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.find(
      item => item.id === '家居-10s-es',
    )!;
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000586',
      runId: '00000000-0000-4000-8000-000000000587',
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-13T00:40:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 1 as const;
    const outputDiagnostics = [
      {
        planIndex: targetPlanIndex,
        operation: 'generate-drafts',
        stage: 'initial',
        phase: 'parse',
        classification: 'invalid-token',
        normalizationMode: 'none',
        schemaIssue: 'not-applicable',
        outputLengthBucket: '2049-8192',
        containerDepthBucket: '1-4',
        outputTextSource: 'completed',
        fieldPaths: [],
      },
      {
        planIndex: targetPlanIndex,
        operation: 'repair-draft-format',
        stage: 'format-recovery',
        phase: 'decoded',
        classification: 'valid-json',
        normalizationMode: 'native',
        schemaIssue: 'not-applicable',
        outputLengthBucket: '2049-8192',
        containerDepthBucket: '1-4',
        outputTextSource: 'completed',
        fieldPaths: [],
      },
    ] as const;
    let physicalRequestAttempts = 0;
    let recoveredDraft: PromptWizardPlanDraft | null = null;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      physicalRequestAttempts += 1;
      const generated = await generateDrafts(input);
      const planIndex = input.planContexts[0]?.planIndex ?? 0;
      if (generated.drafts[0]) {
        generated.drafts[0] = {
          ...generated.drafts[0],
          ...(planIndex === targetPlanIndex && hiddenUnsafeContent
            ? { productionWarnings: ['全网都在买'] }
            : {}),
          segments: generated.drafts[0].segments.map((segment, segmentIndex) => ({
            ...segment,
            lightingAndRealism: `${segment.lightingAndRealism}，窗边光影持续移动`,
            cameraMovement: planIndex === targetPlanIndex && segmentIndex === 2
              ? '固定机位'
              : '镜头持续缓慢推近，产品证据始终保持清晰',
            editingCue: '沿当前镜头动作点切换景别，保持画面连续',
          })),
        };
      }
      if (planIndex !== targetPlanIndex || !generated.drafts[0]) return generated;
      physicalRequestAttempts += 1;
      recoveredDraft = normalizePromptWizardRouteDraftV6({
        draft: structuredClone(generated.drafts[0]),
        planContext: promptWizardRoutePlanContextsV6(routeSet)[targetPlanIndex]!,
        evidenceGraph,
        profile: testCase.profile,
        config: testCase.config,
      });
      let exactError: PromptWizardMotionDensityError | null = null;
      try {
        assertPromptWizardMotionDensity({
          shots: recoveredDraft.segments,
          durationSeconds: testCase.config.durationSeconds,
        });
      } catch (error) {
        if (error instanceof PromptWizardMotionDensityError) exactError = error;
      }
      expect(exactError?.fieldPaths).toEqual(['segments[2].cameraMovement']);
      return {
        ...generated,
        repairRounds: 0,
        formatRepairCount: 1,
        outputDiagnostics: outputDiagnostics.map(item => ({ ...item })),
        usage: { ...generated.usage, requestAttempts: 2 },
      };
    });
    const repairSpy = vi.fn((input: Parameters<typeof repairDrafts>[0]) => repairDrafts(input));

    try {
      let result: Awaited<ReturnType<typeof generateValidatedPromptWizardRoutePlansV6>> | null = null;
      let thrown: unknown;
      try {
        result = await generateValidatedPromptWizardRoutePlansV6({
          provider: {
            generateUseDirectionDrafts: generateSpy,
            repairUseDirectionDrafts: repairSpy,
          } as never,
          profile: testCase.profile,
          evidenceGraph,
          voiceoverLanguage: '西班牙语',
          verifiedOffer: '',
          config: testCase.config,
          routeSet,
          imageCount: 1,
          variationKey: 1,
          deadlineAtMs: Date.now() + 240_000,
          historicalPlans: [],
        });
      } catch (error) {
        thrown = error;
      }

      if (hiddenUnsafeContent) {
        expect(result).toBeNull();
        expect(thrown).toMatchObject({
          code: 'PROMPT_WIZARD_UNSAFE_CONTENT',
          fieldPaths: ['productionWarnings[0]'],
          repairRounds: 0,
          planIndexes: [targetPlanIndex],
          contentRepairRequestCounts: [0, 0, 0],
          terminalCalibrationRequestCounts: [0, 0, 0],
        });
        expect(generateSpy).toHaveBeenCalledTimes(3);
        expect(physicalRequestAttempts).toBe(4);
        expect(repairSpy).not.toHaveBeenCalled();
        expect(warnSpy.mock.calls.some(([value]) => (
          typeof value === 'string'
          && value.includes(
            'prompt-wizard-v6-safe-format-recovery-single-camera-motion-fallback',
          )
        ))).toBe(false);
        return;
      }

      if (!result) throw thrown;

      expect(result.plans).toHaveLength(3);
      expect(result.repairRounds).toBe(0);
      expect(result.formatRepairCount).toBe(1);
      expect(result.contentRepairRequestCounts).toEqual([0, 0, 0]);
      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      expect(result.outputDiagnostics).toEqual(outputDiagnostics.map(item => ({ ...item })));
      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(physicalRequestAttempts).toBe(4);
      expect(repairSpy).not.toHaveBeenCalled();
      expect(result.drafts[targetPlanIndex]!.segments[2]!.cameraMovement)
        .toBe('镜头持续缓慢推近，产品证据始终保持清晰');
      const maskOwnedLeaf = (value: PromptWizardPlanDraft) => ({
        ...value,
        segments: value.segments.map((segment, index) => index === 2
          ? { ...segment, cameraMovement: '__cameraMovement__' }
          : segment),
      });
      expect(maskOwnedLeaf(result.drafts[targetPlanIndex]!)).toEqual(
        maskOwnedLeaf(recoveredDraft!),
      );
      const fallbackLines = warnSpy.mock.calls.flatMap(([value]) => (
        typeof value === 'string'
        && value.includes(
          'prompt-wizard-v6-safe-format-recovery-single-camera-motion-fallback',
        )
          ? [value]
          : []
      ));
      expect(fallbackLines).toHaveLength(1);
      expect(parsePromptWizardCanarySafeTranscript({
        protocolEvents: new Set(),
        transcript: fallbackLines.join('\n'),
      }).normalizedEvents).toEqual([{
        event: 'prompt-wizard-v6-safe-format-recovery-single-camera-motion-fallback',
        planIndex: targetPlanIndex,
        segmentIndex: 2,
        contentRepairRequestCount: 0,
      }]);
    } finally {
      warnSpy.mockRestore();
      env.NODE_ENV = originalNodeEnv;
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 首稿格式恢复后通过全部门禁时仍正常交付', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const base = makeConceptGenerationContext();
    const config = { ...base.config, durationSeconds: 10 as const };
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-00000000031b',
      runId: '00000000-0000-4000-8000-00000000031c',
      runRevision: 1,
      profile: base.profile,
      evidenceGraph: base.evidenceGraph,
      productionBrief: base.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 0 as const;
    const outputDiagnostics = [
      {
        planIndex: targetPlanIndex,
        operation: 'generate-drafts',
        stage: 'initial',
        phase: 'parse',
        classification: 'container-truncated',
        normalizationMode: 'none',
        schemaIssue: 'not-applicable',
        outputLengthBucket: '2049-8192',
        containerDepthBucket: '1-4',
        outputTextSource: 'completed',
        fieldPaths: [],
      },
      {
        planIndex: targetPlanIndex,
        operation: 'repair-draft-format',
        stage: 'format-recovery',
        phase: 'decoded',
        classification: 'valid-json',
        normalizationMode: 'native',
        schemaIssue: 'not-applicable',
        outputLengthBucket: '2049-8192',
        containerDepthBucket: '1-4',
        outputTextSource: 'completed',
        fieldPaths: [],
      },
    ] as const;
    let physicalRequestAttempts = 0;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      physicalRequestAttempts += 1;
      const generated = await generateDrafts(input);
      if (generated.drafts[0]) {
        generated.drafts[0] = {
          ...generated.drafts[0],
          segments: generated.drafts[0].segments.map(segment => ({
            ...segment,
            lightingAndRealism: `${segment.lightingAndRealism}，窗边光影持续移动`,
            cameraMovement: '持续缓慢推近',
            editingCue: `${segment.editingCue}，动作点跳切`,
          })),
        };
      }
      if (input.planContexts[0]?.planIndex !== targetPlanIndex) return generated;
      physicalRequestAttempts += 1;
      return {
        ...generated,
        repairRounds: 0,
        formatRepairCount: 1,
        outputDiagnostics: outputDiagnostics.map(item => ({ ...item })),
        usage: { ...generated.usage, requestAttempts: 2 },
      };
    });
    const repairSpy = vi.fn((input: Parameters<typeof repairDrafts>[0]) => repairDrafts(input));

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: base.profile,
        evidenceGraph: base.evidenceGraph,
        voiceoverLanguage: '普通话',
        verifiedOffer: '',
        config,
        routeSet,
        imageCount: base.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(result.plans).toHaveLength(3);
      expect(result.formatRepairCount).toBe(1);
      expect(result.contentRepairRequestCounts).toEqual([0, 0, 0]);
      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      expect(result.usage.requestAttempts).toBe(4);
      expect(result.outputDiagnostics).toEqual(outputDiagnostics.map(item => ({ ...item })));
      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(physicalRequestAttempts).toBe(4);
      expect(repairSpy).not.toHaveBeenCalled();
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 内容修复自身格式恢复后若仍未通过领域门禁则立即失败且不再请求', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const base = makeConceptGenerationContext();
    const config = { ...base.config, durationSeconds: 10 as const };
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-00000000031d',
      runId: '00000000-0000-4000-8000-00000000031e',
      runRevision: 1,
      profile: base.profile,
      evidenceGraph: base.evidenceGraph,
      productionBrief: base.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const targetPlanIndex = 1 as const;
    const outputDiagnostics = [
      {
        planIndex: targetPlanIndex,
        operation: 'repair-draft-content',
        stage: 'content-repair',
        phase: 'parse',
        classification: 'container-truncated',
        normalizationMode: 'none',
        schemaIssue: 'not-applicable',
        outputLengthBucket: '2049-8192',
        containerDepthBucket: '1-4',
        outputTextSource: 'completed',
        fieldPaths: [],
      },
      {
        planIndex: targetPlanIndex,
        operation: 'repair-draft-format',
        stage: 'format-recovery',
        phase: 'decoded',
        classification: 'valid-json',
        normalizationMode: 'native',
        schemaIssue: 'not-applicable',
        outputLengthBucket: '2049-8192',
        containerDepthBucket: '1-4',
        outputTextSource: 'completed',
        fieldPaths: [],
      },
    ] as const;
    let physicalRequestAttempts = 0;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      physicalRequestAttempts += 1;
      const generated = await generateDrafts(input);
      if (!generated.drafts[0]) return generated;
      generated.drafts[0] = {
        ...generated.drafts[0],
        ...(input.planContexts[0]?.planIndex === targetPlanIndex
          ? { hook: '支持主动降噪的通勤体验' }
          : {}),
        segments: generated.drafts[0].segments.map(segment => ({
          ...segment,
          lightingAndRealism: `${segment.lightingAndRealism}，窗边光影持续移动`,
          cameraMovement: '持续缓慢推近',
          editingCue: `${segment.editingCue}，动作点跳切`,
        })),
      };
      return generated;
    });
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      physicalRequestAttempts += 2;
      const repaired = await repairDrafts(input);
      const draft = structuredClone(input.previousDrafts[targetPlanIndex]!);
      // 内容修复的格式恢复响应虽然成为合法 JSON，仍保留未确认功效；完整
      // 门禁必须直接拒绝，不能把它再送入第二轮内容修复或终局校准。
      draft.hook = '支持主动降噪的通勤体验';
      return {
        ...repaired,
        drafts: [{
          ...repaired.drafts[0]!,
          planIndex: targetPlanIndex,
          draft,
        }],
        formatRepairCount: 1,
        outputDiagnostics: outputDiagnostics.map(item => ({ ...item })),
        usage: { ...repaired.usage, requestAttempts: 2 },
      };
    });

    try {
      const failure = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: base.profile,
        evidenceGraph: base.evidenceGraph,
        voiceoverLanguage: '英语',
        verifiedOffer: '',
        config,
        routeSet,
        imageCount: base.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      }).then(
        () => null,
        error => error,
      );

      expect(failure).toMatchObject({
        code: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
        repairRounds: 1,
        planIndexes: [targetPlanIndex],
        contentRepairRequestCounts: [0, 1, 0],
        terminalCalibrationRequestCounts: [0, 0, 0],
        outputDiagnostics: outputDiagnostics.map(item => ({ ...item })),
      });
      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).toHaveBeenCalledTimes(1);
      expect(physicalRequestAttempts).toBe(5);
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 5 秒仅有外语 differenceTag 时立即确定性收口且不消耗内容修复', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const base = makeConceptGenerationContext();
    const config = {
      model: 'seedance-2.0-mini',
      aspectRatio: '9:16',
      resolution: '480p',
      durationSeconds: 5,
    } as const;
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-00000000034a',
      runId: '00000000-0000-4000-8000-00000000034b',
      runRevision: 1,
      profile: base.profile,
      evidenceGraph: base.evidenceGraph,
      productionBrief: base.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const baselineProvider = new FakePromptWizardProvider();
    const injectedProvider = new FakePromptWizardProvider();
    const generateDrafts = injectedProvider.generateUseDirectionDrafts.bind(injectedProvider);
    const repairDrafts = injectedProvider.repairUseDirectionDrafts.bind(injectedProvider);
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const generated = await generateDrafts(input);
      if (input.planContexts[0]?.planIndex === 2 && generated.drafts[0]) {
        generated.drafts[0] = {
          ...generated.drafts[0],
          differenceTags: [
            'HIGH ENERGY PRODUCT PROOF',
            ...generated.drafts[0].differenceTags.slice(1),
          ],
        };
      }
      return generated;
    });
    const repairSpy = vi.fn((input: Parameters<typeof repairDrafts>[0]) => repairDrafts(input));

    try {
      const sharedInput = {
        profile: base.profile,
        evidenceGraph: base.evidenceGraph,
        verifiedOffer: '真实优惠仅供发布文案使用',
        config,
        routeSet,
        imageCount: base.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      };
      const baseline = await generateValidatedPromptWizardRoutePlansV6({
        ...sharedInput,
        provider: baselineProvider,
      });
      const result = await generateValidatedPromptWizardRoutePlansV6({
        ...sharedInput,
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
      });

      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).not.toHaveBeenCalled();
      expect(result.contentRepairRequestCounts).toEqual([0, 0, 0]);
      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      expect(result.repairDiagnostics).toEqual([]);
      expect(result.drafts[2]!.differenceTags[0]).toBe('持续动作演示');
      expect(result.drafts[2]!.differenceTags[0]).not.toBe('HIGH ENERGY PRODUCT PROOF');
      expect(result.drafts[0]).toEqual(baseline.drafts[0]);
      expect(result.drafts[1]).toEqual(baseline.drafts[1]);
      const withoutFirstTag = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        differenceTags: draft.differenceTags.slice(1),
      });
      expect(withoutFirstTag(result.drafts[2]!))
        .toEqual(withoutFirstTag(baseline.drafts[2]!));
      expect(result.plans.every(plan => (
        plan.deliveryVersion === 6 && plan.audioMode === 'sound-design-only'
      ))).toBe(true);
      expect(result.plans.map(plan => plan.prompt).join('\n'))
        .not.toContain('真实优惠仅供发布文案使用');
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 5 秒外语 differenceTag 混入 hook 时不走确定性收口并保留 Provider 修复', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const base = makeConceptGenerationContext();
    const config = {
      model: 'seedance-2.0-mini',
      aspectRatio: '9:16',
      resolution: '480p',
      durationSeconds: 5,
    } as const;
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-00000000034c',
      runId: '00000000-0000-4000-8000-00000000034d',
      runRevision: 1,
      profile: base.profile,
      evidenceGraph: base.evidenceGraph,
      productionBrief: base.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const injectedProvider = new FakePromptWizardProvider();
    const generateDrafts = injectedProvider.generateUseDirectionDrafts.bind(injectedProvider);
    const repairDrafts = injectedProvider.repairUseDirectionDrafts.bind(injectedProvider);
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const generated = await generateDrafts(input);
      if (input.planContexts[0]?.planIndex === 2 && generated.drafts[0]) {
        generated.drafts[0] = {
          ...generated.drafts[0],
          hook: 'LOOK AT THIS PRODUCT',
          differenceTags: [
            'HIGH ENERGY PRODUCT PROOF',
            ...generated.drafts[0].differenceTags.slice(1),
          ],
        };
      }
      return generated;
    });
    const repairSpy = vi.fn((input: Parameters<typeof repairDrafts>[0]) => repairDrafts(input));

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: base.profile,
        evidenceGraph: base.evidenceGraph,
        verifiedOffer: '',
        config,
        routeSet,
        imageCount: base.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(repairSpy).toHaveBeenCalledTimes(1);
      expect(repairSpy.mock.calls[0]?.[0].issues).toEqual([
        expect.objectContaining({
          planIndex: 2,
          errorCode: 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
          fieldPaths: expect.arrayContaining(['hook', 'differenceTags[0]']),
        }),
      ]);
      expect(result.contentRepairRequestCounts).toEqual([0, 0, 1]);
      expect(result.repairDiagnostics).toEqual([
        expect.objectContaining({
          planIndex: 2,
          origin: 'domain-validation',
          repairRound: 1,
          errorCode: 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
          fieldPaths: expect.arrayContaining(['hook', 'differenceTags[0]']),
        }),
      ]);
      expect(result.drafts[2]!.hook).not.toBe('LOOK AT THIS PRODUCT');
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 10 秒普通话仅有外语 differenceTag 时立即收口且不产生修复诊断', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const base = makeConceptGenerationContext();
    const config = { ...base.config, durationSeconds: 10 as const };
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-00000000034e',
      runId: '00000000-0000-4000-8000-00000000034f',
      runRevision: 1,
      profile: base.profile,
      evidenceGraph: base.evidenceGraph,
      productionBrief: base.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const injectedProvider = new FakePromptWizardProvider();
    const generateDrafts = injectedProvider.generateUseDirectionDrafts.bind(injectedProvider);
    const repairDrafts = injectedProvider.repairUseDirectionDrafts.bind(injectedProvider);
    let originalVoiceoverPairs: Array<{ voiceover: string; voiceoverZh: string }> = [];
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const generated = await generateDrafts(input);
      if (generated.drafts[0]) {
        generated.drafts[0] = {
          ...generated.drafts[0],
          segments: generated.drafts[0].segments.map(segment => ({
            ...segment,
            lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          })),
        };
      }
      if (input.planContexts[0]?.planIndex === 0 && generated.drafts[0]) {
        originalVoiceoverPairs = generated.drafts[0].segments.map(segment => ({
          voiceover: segment.voiceover,
          voiceoverZh: segment.voiceoverZh,
        }));
        generated.drafts[0] = {
          ...generated.drafts[0],
          differenceTags: [
            'HIGH ENERGY PRODUCT PROOF',
            ...generated.drafts[0].differenceTags.slice(1),
          ],
        };
      }
      return generated;
    });
    const repairSpy = vi.fn((input: Parameters<typeof repairDrafts>[0]) => repairDrafts(input));

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: base.profile,
        evidenceGraph: base.evidenceGraph,
        voiceoverLanguage: '普通话',
        verifiedOffer: '',
        config,
        routeSet,
        imageCount: base.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).not.toHaveBeenCalled();
      expect(result.contentRepairRequestCounts).toEqual([0, 0, 0]);
      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      expect(result.repairDiagnostics).toEqual([]);
      expect(result.drafts[0]!.differenceTags[0]).toBe('持续动作演示');
      expect(result.drafts[0]!.segments.map(segment => ({
        voiceover: segment.voiceover,
        voiceoverZh: segment.voiceoverZh,
      }))).toEqual(originalVoiceoverPairs);
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 10 秒外语 differenceTag 混入 hook 时仍进入 Provider 内容修复', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const base = makeConceptGenerationContext();
    const config = { ...base.config, durationSeconds: 10 as const };
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000350',
      runId: '00000000-0000-4000-8000-000000000351',
      runRevision: 1,
      profile: base.profile,
      evidenceGraph: base.evidenceGraph,
      productionBrief: base.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const injectedProvider = new FakePromptWizardProvider();
    const generateDrafts = injectedProvider.generateUseDirectionDrafts.bind(injectedProvider);
    const repairDrafts = injectedProvider.repairUseDirectionDrafts.bind(injectedProvider);
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const generated = await generateDrafts(input);
      if (generated.drafts[0]) {
        generated.drafts[0] = {
          ...generated.drafts[0],
          segments: generated.drafts[0].segments.map(segment => ({
            ...segment,
            lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          })),
        };
      }
      if (input.planContexts[0]?.planIndex === 0 && generated.drafts[0]) {
        generated.drafts[0] = {
          ...generated.drafts[0],
          hook: 'LOOK AT THIS PRODUCT',
          differenceTags: [
            'HIGH ENERGY PRODUCT PROOF',
            ...generated.drafts[0].differenceTags.slice(1),
          ],
        };
      }
      return generated;
    });
    const repairSpy = vi.fn((input: Parameters<typeof repairDrafts>[0]) => repairDrafts(input));

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: base.profile,
        evidenceGraph: base.evidenceGraph,
        voiceoverLanguage: '普通话',
        verifiedOffer: '',
        config,
        routeSet,
        imageCount: base.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(repairSpy).toHaveBeenCalledTimes(1);
      expect(repairSpy.mock.calls[0]?.[0].issues).toEqual([
        expect.objectContaining({
          planIndex: 0,
          errorCode: 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
          fieldPaths: expect.arrayContaining(['hook', 'differenceTags[0]']),
        }),
      ]);
      expect(result.contentRepairRequestCounts).toEqual([1, 0, 0]);
      expect(result.repairDiagnostics).toEqual([
        expect.objectContaining({
          planIndex: 0,
          origin: 'domain-validation',
          repairRound: 1,
          errorCode: 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
          fieldPaths: expect.arrayContaining(['hook', 'differenceTags[0]']),
        }),
      ]);
      expect(result.drafts[0]!.hook).not.toBe('LOOK AT THIS PRODUCT');
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 10 秒 plan1 执行预算修复保持全部口播字节不变', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const base = makeConceptGenerationContext();
    const config = {
      ...base.config,
      model: 'seedance-2.0-mini' as const,
      resolution: '480p' as const,
      durationSeconds: 10 as const,
    };
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000352',
      runId: '00000000-0000-4000-8000-000000000353',
      runRevision: 1,
      profile: base.profile,
      evidenceGraph: base.evidenceGraph,
      productionBrief: base.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const injectedProvider = new FakePromptWizardProvider();
    const generateDrafts = injectedProvider.generateUseDirectionDrafts.bind(injectedProvider);
    const repairDrafts = injectedProvider.repairUseDirectionDrafts.bind(injectedProvider);
    const targetPlanIndex = 1 as const;
    let validTargetDraft: PromptWizardPlanDraft | null = null;
    let voiceoverBytesBeforeRepair = '';
    const voiceoverBytes = (draft: PromptWizardPlanDraft) => JSON.stringify(
      draft.segments.map(segment => [segment.voiceover, segment.voiceoverZh]),
    );
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const generated = await generateDrafts(input);
      if (generated.drafts[0]) {
        generated.drafts[0] = {
          ...generated.drafts[0],
          segments: generated.drafts[0].segments.map(segment => ({
            ...segment,
            lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          })),
        };
      }
      if (input.planContexts[0]?.planIndex === targetPlanIndex && generated.drafts[0]) {
        validTargetDraft = structuredClone(generated.drafts[0]);
        generated.drafts[0] = {
          ...generated.drafts[0],
          segments: generated.drafts[0].segments.map((segment, segmentIndex) => (
            {
              ...segment,
              cameraMovement: [
                '镜头快速推近产品证据',
                '镜头横移操作过程',
                '镜头环绕产品结果',
              ][segmentIndex]!,
            }
          )),
        };
      }
      return generated;
    });
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      const repaired = await repairDrafts(input);
      const issue = input.issues[0];
      if (issue?.planIndex !== targetPlanIndex || !validTargetDraft) return repaired;
      voiceoverBytesBeforeRepair = voiceoverBytes(input.previousDrafts[targetPlanIndex]!);
      const corrected = structuredClone(input.previousDrafts[targetPlanIndex]!);
      corrected.segments = corrected.segments.map((segment, segmentIndex) => ({
        ...segment,
        cameraMovement: validTargetDraft!.segments[segmentIndex]!.cameraMovement,
      }));
      return {
        ...repaired,
        drafts: [{
          ...repaired.drafts[0]!,
          planIndex: targetPlanIndex,
          draft: corrected,
        }],
      };
    });

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: base.profile,
        evidenceGraph: base.evidenceGraph,
        voiceoverLanguage: '普通话',
        verifiedOffer: '',
        config,
        routeSet,
        imageCount: base.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(repairSpy).toHaveBeenCalledTimes(1);
      expect(repairSpy.mock.calls[0]?.[0].issues).toEqual([
        expect.objectContaining({
          planIndex: targetPlanIndex,
          errorCode: 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED',
          fieldPaths: ['segments'],
        }),
      ]);
      expect(result.contentRepairRequestCounts).toEqual([0, 1, 0]);
      expect(result.repairDiagnostics).toEqual([
        expect.objectContaining({
          planIndex: targetPlanIndex,
          origin: 'domain-validation',
          repairRound: 1,
          errorCode: 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED',
          fieldPaths: ['segments'],
        }),
      ]);
      expect(voiceoverBytesBeforeRepair).not.toBe('');
      expect(voiceoverBytes(result.drafts[targetPlanIndex]!)).toBe(voiceoverBytesBeforeRepair);
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 15 秒 plan2 两个非连续外语 differenceTags 本地收口后保持唯一并完整重渲染', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const base = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000354',
      runId: '00000000-0000-4000-8000-000000000355',
      runRevision: 1,
      profile: base.profile,
      evidenceGraph: base.evidenceGraph,
      productionBrief: base.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const injectedProvider = new FakePromptWizardProvider();
    const generateDrafts = injectedProvider.generateUseDirectionDrafts.bind(injectedProvider);
    const repairDrafts = injectedProvider.repairUseDirectionDrafts.bind(injectedProvider);
    const targetPlanIndex = 2 as const;
    const preservedMiddleTag = '真实日常场景展示';
    const foreignTags = ['HIGH ENERGY PRODUCT PROOF', 'TRAVEL LIFESTYLE REVEAL'] as const;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const generated = await generateDrafts(input);
      if (generated.drafts[0]) {
        generated.drafts[0] = {
          ...generated.drafts[0],
          segments: generated.drafts[0].segments.map(segment => ({
            ...segment,
            lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          })),
        };
      }
      if (input.planContexts[0]?.planIndex === targetPlanIndex && generated.drafts[0]) {
        generated.drafts[0] = {
          ...generated.drafts[0],
          differenceTags: [foreignTags[0], preservedMiddleTag, foreignTags[1]],
        };
      }
      return generated;
    });
    const repairSpy = vi.fn((input: Parameters<typeof repairDrafts>[0]) => repairDrafts(input));

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: base.profile,
        evidenceGraph: base.evidenceGraph,
        voiceoverLanguage: '普通话',
        verifiedOffer: '',
        config: base.config,
        routeSet,
        imageCount: base.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).not.toHaveBeenCalled();
      expect(result.contentRepairRequestCounts).toEqual([0, 0, 0]);
      expect(result.terminalCalibrationRequestCounts).toEqual([0, 0, 0]);
      expect(result.repairDiagnostics).toEqual([]);
      expect(result.plans).toHaveLength(3);
      expect(result.plans[targetPlanIndex]).toMatchObject({
        deliveryVersion: 6,
        role: 'lifestyle-seeding',
      });
      const finalTags = result.drafts[targetPlanIndex]!.differenceTags;
      expect(finalTags).toHaveLength(3);
      expect(finalTags[1]).toBe(preservedMiddleTag);
      expect(finalTags).not.toContain(foreignTags[0]);
      expect(finalTags).not.toContain(foreignTags[1]);
      expect(new Set(finalTags.map(tag => tag.normalize('NFKC').trim())).size)
        .toBe(finalTags.length);
      expect(result.plans[targetPlanIndex]!.differenceTags).toEqual(finalTags);
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 超过旧字词上限的完整自然句不再触发内容修复', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const base = makeConceptGenerationContext();
    const config = { ...base.config, durationSeconds: 10 as const };
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000322',
      runId: '00000000-0000-4000-8000-000000000323',
      runRevision: 1,
      profile: base.profile,
      evidenceGraph: base.evidenceGraph,
      productionBrief: base.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const overlongVoiceovers = [
      'See this foldable headphone move clearly right now',
      'This folding structure proves one purchase reason clearly today',
      'Tap the product card and order yours right now',
    ];
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      if (result.drafts[0]) {
        const validDraft = {
          ...result.drafts[0],
          segments: result.drafts[0].segments.map(segment => ({
            ...segment,
            // 保持与同组 V6 回归一致的合法环境动态，避免测试被运动门禁干扰。
            lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          })),
        };
        if (input.planContexts[0]?.planIndex === 0) {
          result.drafts[0] = {
            ...validDraft,
            segments: validDraft.segments.map((segment, index) => ({
              ...segment,
              voiceover: overlongVoiceovers[index]!,
            })),
          };
        } else {
          result.drafts[0] = validDraft;
        }
      }
      return result;
    });
    const repairSpy = vi.fn(repairDrafts);

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: base.profile,
        evidenceGraph: base.evidenceGraph,
        voiceoverLanguage: '英语',
        verifiedOffer: '',
        config,
        routeSet,
        imageCount: base.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(result.plans).toHaveLength(3);
      expect(result.plans.map(plan => plan.deliveryVersion === 6 ? plan.role : null))
        .toEqual(['proof-conversion', 'problem-hook', 'lifestyle-seeding']);
      expect(result.repairRounds).toBe(0);
      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).not.toHaveBeenCalled();
      expect(result.drafts[0]!.segments.map(segment => segment.voiceover))
        .toEqual(overlongVoiceovers);
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 两轮修复耗尽后仅恢复服务端场景、商品锚点和必要主动作', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000324',
      runId: '00000000-0000-4000-8000-000000000325',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const unsafeHook = '支持主动降噪的通勤体验';
    let validPlanZeroDraft: PromptWizardPlanDraft | null = null;
    let terminalInvalidDraft: PromptWizardPlanDraft | null = null;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      if (result.drafts[0]) {
        result.drafts[0] = {
          ...result.drafts[0],
          // 保持环境持续变化，避免本用例被无关的运动密度修复干扰。
          segments: result.drafts[0].segments.map(segment => ({
            ...segment,
            lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          })),
        };
      }
      if (input.planContexts[0]?.planIndex === 0 && result.drafts[0]) {
        validPlanZeroDraft = structuredClone(result.drafts[0]);
        result.drafts[0] = {
          ...result.drafts[0],
          hook: unsafeHook,
        };
      }
      return result;
    });
    let contentRepairRound = 0;
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      const result = await repairDrafts(input);
      if (input.issues[0]?.planIndex !== 0 || !validPlanZeroDraft) return result;
      contentRepairRound += 1;
      const draft = structuredClone(validPlanZeroDraft);
      if (contentRepairRound === 1) {
        draft.hook = unsafeHook;
      } else {
        draft.primaryScene = '未选择的影棚场景';
        draft.segments = draft.segments.map((segment, index) => ({
          ...segment,
          location: '未选择的影棚场景',
          ...(index === 0 ? { action: '在镜头前停留并看向产品' } : {}),
        }));
        terminalInvalidDraft = structuredClone(draft);
      }
      return {
        ...result,
        drafts: [{
          ...result.drafts[0]!,
          planIndex: 0,
          draft,
        }],
      };
    });

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        voiceoverLanguage: context.brief.targetLanguage,
        verifiedOffer: '',
        config: context.config,
        routeSet,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(result.plans).toHaveLength(3);
      expect(result.plans.map(plan => plan.deliveryVersion === 6 ? plan.role : null))
        .toEqual(['proof-conversion', 'problem-hook', 'lifestyle-seeding']);
      expect(result.repairRounds).toBe(2);
      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).toHaveBeenCalledTimes(2);
      expect(contentRepairRound).toBe(2);
      repairSpy.mock.calls.forEach(([input]) => {
        expect(input.issues).toHaveLength(1);
        expect(input.issues[0]?.planIndex).toBe(0);
        expect(input.issues[0]?.errorCode).not.toBe(
          'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID',
        );
      });

      const route = routeSet.routes[0]!;
      const finalDraft = result.drafts[0]!;
      expect(finalDraft.primaryScene).toBe(
        `${route.recommendedScene.title}｜${route.recommendedScene.environment}`,
      );
      expect(finalDraft.segments.every(segment => (
        segment.location === route.recommendedScene.environment
      ))).toBe(true);
      expect(finalDraft.segments.some(segment => segment.action.includes(
        route.recommendedScene.mainAction.replace(/[。；;.]+$/u, ''),
      ))).toBe(true);

      const stripSceneAnchorAndAction = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        primaryScene: '__scene__',
        segments: draft.segments.map((segment, segmentIndex) => ({
          ...segment,
          location: '__location__',
          action: '__action__',
          ...(segmentIndex === 0 ? { subject: '__product_anchor__' } : {}),
        })),
      });
      expect(terminalInvalidDraft).not.toBeNull();
      expect(stripSceneAnchorAndAction(finalDraft)).toEqual(
        stripSceneAnchorAndAction(terminalInvalidDraft!),
      );
      const changedActionRoles = finalDraft.segments.flatMap((segment, index) => (
        segment.action === terminalInvalidDraft!.segments[index]?.action
          ? []
          : [segment.role]
      ));
      expect(changedActionRoles).not.toContain('cta');
      expect(finalDraft.segments.at(-1)?.action).toBe(
        terminalInvalidDraft!.segments.at(-1)?.action,
      );
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 narrative-only 错误零 Provider 调用确定性收口且不改口播与 CTA', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000326',
      runId: '00000000-0000-4000-8000-000000000327',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    let invalidPlanZeroDraft: PromptWizardPlanDraft | null = null;
    const secondReason = routeSet.routes[1]!.purchaseReasonZh;
    expect(secondReason).not.toBe(routeSet.routes[0]!.purchaseReasonZh);
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      if (result.drafts[0]) {
        result.drafts[0] = {
          ...result.drafts[0],
          segments: result.drafts[0].segments.map(segment => ({
            ...segment,
            lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          })),
        };
      }
      if (input.planContexts[0]?.planIndex === 0 && result.drafts[0]) {
        result.drafts[0] = {
          ...result.drafts[0],
          narrative: `${result.drafts[0].narrative}，同时突出${secondReason}`,
        };
        invalidPlanZeroDraft = structuredClone(result.drafts[0]);
      }
      return result;
    });
    const repairSpy = vi.fn(repairDrafts);

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        voiceoverLanguage: '英语',
        verifiedOffer: '',
        config: context.config,
        routeSet,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(result.plans.map(plan => plan.deliveryVersion === 6 ? plan.role : null))
        .toEqual(['proof-conversion', 'problem-hook', 'lifestyle-seeding']);
      expect(result.repairRounds).toBe(0);
      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).not.toHaveBeenCalled();
      const finalDraft = result.drafts[0]!;
      const route = routeSet.routes[0]!;
      expect(finalDraft.narrative).toBe(
        `围绕“${route.purchaseReasonZh}”展开，在${
          route.recommendedScene.title
        }通过${route.proofActionZh}完成产品自证，最后引导点击商品卡。`,
      );
      expect(finalDraft.narrative).not.toContain(secondReason);
      expect(invalidPlanZeroDraft).not.toBeNull();
      const stripNarrativeAndServiceNormalizedActions = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        narrative: '__narrative__',
        primaryScene: '__service_normalized_scene__',
        segments: draft.segments.map((segment, segmentIndex) => ({
          ...segment,
          action: '__service_normalized_action__',
          ...(segmentIndex === 0 ? { subject: '__service_normalized_product_anchor__' } : {}),
        })),
      });
      expect(stripNarrativeAndServiceNormalizedActions(finalDraft)).toEqual(
        stripNarrativeAndServiceNormalizedActions(invalidPlanZeroDraft!),
      );
      expect(finalDraft.segments.map(segment => ({
        voiceover: segment.voiceover,
        voiceoverZh: segment.voiceoverZh,
      }))).toEqual(invalidPlanZeroDraft!.segments.map(segment => ({
        voiceover: segment.voiceover,
        voiceoverZh: segment.voiceoverZh,
      })));
      expect(finalDraft.segments.at(-1)?.voiceover).toBe(
        invalidPlanZeroDraft!.segments.at(-1)?.voiceover,
      );
      expect(finalDraft.segments.at(-1)?.voiceoverZh).toBe(
        invalidPlanZeroDraft!.segments.at(-1)?.voiceoverZh,
      );
      expect(finalDraft.segments.at(-1)?.action).toBe(
        invalidPlanZeroDraft!.segments.at(-1)?.action,
      );
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it.each([
    {
      caseName: '首段口播',
      segmentIndex: 0,
      mixedHook: false,
      expectedFieldPaths: ['segments[0].voiceover'],
    },
    {
      caseName: '末段口播',
      segmentIndex: 3,
      mixedHook: false,
      expectedFieldPaths: ['segments[3].voiceover'],
    },
    {
      caseName: '口播与 hook 混合路径',
      segmentIndex: 2,
      mixedHook: true,
      expectedFieldPaths: ['hook', 'segments[2].voiceover'],
    },
  ])('V6 非精确单一购买理由错误允许第二轮并在耗尽后关闭：$caseName', async ({
    segmentIndex,
    mixedHook,
    expectedFieldPaths,
  }) => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000350',
      runId: '00000000-0000-4000-8000-000000000351',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-09T03:33:54.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const unsafeHook = '支持主动降噪的通勤体验';
    const secondReason = routeSet.routes[1]!.purchaseReasonZh;
    let validHook = '';
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      if (result.drafts[0]) {
        result.drafts[0] = {
          ...result.drafts[0],
          segments: result.drafts[0].segments.map((segment, index) => ({
            ...segment,
            shotSize: ['产品微距特写', '产品中近景', '产品侧面近景', '产品中景'][index]!,
            cameraMovement: '镜头持续缓慢推近，产品证据始终保持清晰',
            lightingAndRealism: `${segment.lightingAndRealism}，窗边光影持续移动`,
            editingCue: '在产品或手部动作落点快切到下一景别，保持画面连续',
          })),
        };
      }
      if (input.planContexts[0]?.planIndex === 0 && result.drafts[0]) {
        validHook = result.drafts[0].hook;
        result.drafts[0] = { ...result.drafts[0], hook: unsafeHook };
      }
      return result;
    });
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      const result = await repairDrafts(input);
      const draft = structuredClone(input.previousDrafts[0]!);
      draft.hook = mixedHook ? secondReason : validHook;
      draft.segments[segmentIndex] = {
        ...draft.segments[segmentIndex]!,
        voiceover: secondReason,
        voiceoverZh: '',
      };
      return {
        ...result,
        drafts: [{
          ...result.drafts[0]!,
          planIndex: 0,
          draft,
        }],
      };
    });

    try {
      let thrown: unknown;
      try {
        await generateValidatedPromptWizardRoutePlansV6({
          provider: {
            generateUseDirectionDrafts: generateSpy,
            repairUseDirectionDrafts: repairSpy,
          } as never,
          profile: context.profile,
          evidenceGraph: context.evidenceGraph,
          voiceoverLanguage: '普通话',
          verifiedOffer: '',
          config: context.config,
          routeSet,
          imageCount: context.imageCount,
          variationKey: 1,
          deadlineAtMs: Date.now() + 240_000,
          historicalPlans: [],
        });
      } catch (error) {
        thrown = error;
      }

      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).toHaveBeenCalledTimes(2);
      expect(thrown).toMatchObject({
        code: 'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID',
        repairRounds: 2,
        planIndexes: [0],
        fieldPaths: expectedFieldPaths,
        contentRepairRequestCounts: [2, 0, 0],
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it.each([
    {
      caseName: '唯一中间运镜路径允许确定性收口',
      mixedMotionPaths: false,
    },
    {
      caseName: '混合运镜与剪辑路径必须保持失败',
      mixedMotionPaths: true,
    },
  ])('V6 一次内容修复后的运镜确定性边界：$caseName', async ({ mixedMotionPaths }) => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000330',
      runId: '00000000-0000-4000-8000-000000000331',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const immutableProductContext = structuredClone({
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      routeSet,
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const unsafeHook = '支持主动降噪的通勤体验';
    const safeCameraMovement = '镜头持续缓慢推近，产品证据始终保持清晰';
    let validPlanTwoHook = '';
    let terminalInvalidDraft: PromptWizardPlanDraft | null = null;
    let terminalPreviousDrafts: PromptWizardPlanDraft[] | null = null;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      if (result.drafts[0]) {
        result.drafts[0] = {
          ...result.drafts[0],
          // 保证原始三案已拥有合法环境动态，使本用例只命中指定的运镜路径。
          segments: result.drafts[0].segments.map(segment => ({
            ...segment,
            lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          })),
        };
      }
      if (input.planContexts[0]?.planIndex === 2 && result.drafts[0]) {
        validPlanTwoHook = result.drafts[0].hook;
        result.drafts[0] = { ...result.drafts[0], hook: unsafeHook };
      }
      return result;
    });
    let contentRepairRound = 0;
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      const result = await repairDrafts(input);
      if (input.issues[0]?.planIndex !== 2) return result;
      contentRepairRound += 1;
      const draft = structuredClone(input.previousDrafts[2]!);
      draft.hook = validPlanTwoHook;
      draft.segments[1] = {
        ...draft.segments[1]!,
        cameraMovement: '固定机位',
        ...(mixedMotionPaths ? { editingCue: '画面定格' } : {}),
      };
      terminalInvalidDraft = structuredClone(draft);
      terminalPreviousDrafts = structuredClone(input.previousDrafts);
      return {
        ...result,
        drafts: [{
          ...result.drafts[0]!,
          planIndex: 2,
          draft,
        }],
      };
    });

    try {
      let resolved: Awaited<ReturnType<typeof generateValidatedPromptWizardRoutePlansV6>> | null = null;
      let thrown: unknown;
      try {
        resolved = await generateValidatedPromptWizardRoutePlansV6({
          provider: {
            generateUseDirectionDrafts: generateSpy,
            repairUseDirectionDrafts: repairSpy,
          } as never,
          profile: context.profile,
          evidenceGraph: context.evidenceGraph,
          voiceoverLanguage: context.brief.targetLanguage,
          verifiedOffer: '',
          config: context.config,
          routeSet,
          imageCount: context.imageCount,
          variationKey: 1,
          deadlineAtMs: Date.now() + 240_000,
          historicalPlans: [],
        });
      } catch (error) {
        thrown = error;
      }

      expect(contentRepairRound).toBe(mixedMotionPaths ? 2 : 1);
      expect(repairSpy).toHaveBeenCalledTimes(mixedMotionPaths ? 2 : 1);
      expect(repairSpy.mock.calls.every(([input]) => (
        input.issues.length === 1 && input.issues[0]?.planIndex === 2
      ))).toBe(true);
      expect(terminalInvalidDraft).not.toBeNull();
      expect(terminalPreviousDrafts).not.toBeNull();
      expect({
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        routeSet,
      }).toEqual(immutableProductContext);

      if (mixedMotionPaths) {
        expect(resolved).toBeNull();
        expect(thrown).toMatchObject({
          code: 'PROMPT_WIZARD_MOTION_DENSITY_INVALID',
          repairRounds: 2,
          planIndexes: [2],
          contentRepairRequestCounts: [0, 0, 2],
          fieldPaths: [
            'segments[1].cameraMovement',
            'segments[1].editingCue',
          ],
        });
        return;
      }

      expect(thrown).toBeUndefined();
      expect(resolved).not.toBeNull();
      expect(resolved!.repairRounds).toBe(1);
      expect(resolved!.plans.map(plan => plan.deliveryVersion === 6 ? plan.role : null))
        .toEqual(['proof-conversion', 'problem-hook', 'lifestyle-seeding']);
      const finalDraft = resolved!.drafts[2]!;
      expect(finalDraft.segments[1]!.cameraMovement).toBe(safeCameraMovement);
      expect(resolved!.plans[2]!.shots[1]!.cameraMovement).toBe(safeCameraMovement);
      expect(resolved!.plans[2]!.prompt).toContain(`运镜：${safeCameraMovement}`);

      const maskTargetCameraMovement = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        segments: draft.segments.map((segment, segmentIndex) => segmentIndex === 1
          ? { ...segment, cameraMovement: '__cameraMovement__' }
          : segment),
      });
      // 除命中的中间镜头运镜外，失败方案的事实、证据、口播、动作与 CTA 均逐字不变。
      expect(JSON.stringify(maskTargetCameraMovement(finalDraft))).toBe(
        JSON.stringify(maskTargetCameraMovement(terminalInvalidDraft!)),
      );
      expect(finalDraft.segments.map(segment => ({
        voiceover: segment.voiceover,
        voiceoverZh: segment.voiceoverZh,
      }))).toEqual(terminalInvalidDraft!.segments.map(segment => ({
        voiceover: segment.voiceover,
        voiceoverZh: segment.voiceoverZh,
      })));
      expect(finalDraft.segments.at(-1)).toEqual(terminalInvalidDraft!.segments.at(-1));
      expect(JSON.stringify(resolved!.drafts[0])).toBe(
        JSON.stringify(terminalPreviousDrafts![0]),
      );
      expect(JSON.stringify(resolved!.drafts[1])).toBe(
        JSON.stringify(terminalPreviousDrafts![1]),
      );
      expect(resolved!.plans[2]).toMatchObject({
        deliveryVersion: 6,
        purchaseReasonZh: routeSet.routes[2]!.purchaseReasonZh,
        claimBasisTags: routeSet.routes[2]!.claimBasisTags,
        selectedScene: routeSet.routes[2]!.recommendedScene,
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 中文 10 秒一次内容修复后仅收口 singleton editingCue 且不发第二次请求', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const config = {
      ...context.config,
      durationSeconds: 10,
    } as const;
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000338',
      runId: '00000000-0000-4000-8000-000000000339',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-11T00:20:00.000Z',
    });
    const immutableProductContext = structuredClone({
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      routeSet,
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const unsafeHook = '支持主动降噪的通勤体验';
    const safeEditingCue = '沿当前镜头动作点切换景别，保持画面连续';
    let validPlanOneHook = '';
    let terminalInvalidDraft: PromptWizardPlanDraft | null = null;
    let terminalPreviousDrafts: PromptWizardPlanDraft[] | null = null;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      if (result.drafts[0]) {
        result.drafts[0] = {
          ...result.drafts[0],
          segments: result.drafts[0].segments.map(segment => ({
            ...segment,
            lightingAndRealism: `${segment.lightingAndRealism}，窗边光影移动`,
          })),
        };
      }
      if (input.planContexts[0]?.planIndex === 1 && result.drafts[0]) {
        validPlanOneHook = result.drafts[0].hook;
        result.drafts[0] = { ...result.drafts[0], hook: unsafeHook };
      }
      return result;
    });
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      const result = await repairDrafts(input);
      if (input.issues[0]?.planIndex !== 1) return result;
      const draft = structuredClone(input.previousDrafts[1]!);
      draft.hook = validPlanOneHook;
      draft.segments[0] = {
        ...draft.segments[0]!,
        editingCue: '画面定格',
      };
      terminalInvalidDraft = structuredClone(draft);
      terminalPreviousDrafts = structuredClone(input.previousDrafts);
      return {
        ...result,
        drafts: [{
          ...result.drafts[0]!,
          planIndex: 1,
          draft,
        }],
      };
    });

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        voiceoverLanguage: '普通话',
        verifiedOffer: '',
        config,
        routeSet,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).toHaveBeenCalledTimes(1);
      expect(result.repairRounds).toBe(1);
      expect(result.contentRepairRequestCounts).toEqual([0, 1, 0]);
      expect(terminalInvalidDraft).not.toBeNull();
      expect(terminalPreviousDrafts).not.toBeNull();
      const finalDraft = result.drafts[1]!;
      expect(finalDraft.segments[0]!.editingCue).toBe(safeEditingCue);
      expect(result.plans[1]!.shots[0]!.editingCue).toBe(safeEditingCue);
      expect(result.plans[1]!.prompt).toContain(`镜头与剪辑：${safeEditingCue}`);
      expect(() => assertPromptWizardMotionDensity({
        shots: finalDraft.segments,
        durationSeconds: 10,
      })).not.toThrow();

      const maskTargetEditingCue = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        segments: draft.segments.map((segment, index) => index === 0
          ? { ...segment, editingCue: '__editingCue__' }
          : segment),
      });
      // 除命中的剪辑提示外，商品事实、动作、口播、译文、证据与 CTA 均逐字不变。
      expect(JSON.stringify(maskTargetEditingCue(finalDraft))).toBe(
        JSON.stringify(maskTargetEditingCue(terminalInvalidDraft!)),
      );
      expect(finalDraft.segments.map(segment => ({
        action: segment.action,
        voiceover: segment.voiceover,
        voiceoverZh: segment.voiceoverZh,
        evidenceRefs: segment.evidenceRefs,
      }))).toEqual(terminalInvalidDraft!.segments.map(segment => ({
        action: segment.action,
        voiceover: segment.voiceover,
        voiceoverZh: segment.voiceoverZh,
        evidenceRefs: segment.evidenceRefs,
      })));
      expect(finalDraft.segments.at(-1)).toEqual(terminalInvalidDraft!.segments.at(-1));
      expect(JSON.stringify(result.drafts[0])).toBe(
        JSON.stringify(terminalPreviousDrafts![0]),
      );
      expect(JSON.stringify(result.drafts[2])).toBe(
        JSON.stringify(terminalPreviousDrafts![2]),
      );
      expect({
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        routeSet,
      }).toEqual(immutableProductContext);
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 两轮修复耗尽后仅按结构化执行预算收口地点、道具与运镜', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const config = {
      model: 'seedance-2.0-mini',
      aspectRatio: '9:16',
      resolution: '480p',
      durationSeconds: 15,
    } as const;
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000332',
      runId: '00000000-0000-4000-8000-000000000333',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const unsafeHook = '支持主动降噪的通勤体验';
    const safeCameraMovement = '镜头持续缓慢推近，产品证据始终保持清晰';
    const safeProductionNote = '保持产品外观、结构、Logo 与参考图片一致，不新增场景道具';
    let validPlanOneHook = '';
    let terminalInvalidDraft: PromptWizardPlanDraft | null = null;
    let terminalPreviousDrafts: PromptWizardPlanDraft[] | null = null;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      if (input.planContexts[0]?.planIndex === 1 && result.drafts[0]) {
        validPlanOneHook = result.drafts[0].hook;
        result.drafts[0] = { ...result.drafts[0], hook: unsafeHook };
      }
      return result;
    });
    let contentRepairRound = 0;
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      const result = await repairDrafts(input);
      if (input.issues[0]?.planIndex !== 1) return result;
      contentRepairRound += 1;
      const draft = structuredClone(input.previousDrafts[1]!);
      if (contentRepairRound === 1) {
        // 第一轮继续忽略 hook 修复，确保终态回退只会在两轮额度耗尽后触发。
        draft.hook = unsafeHook;
      } else {
        const route = routeSet.routes[1]!;
        draft.hook = validPlanOneHook;
        draft.primaryScene = `${route.recommendedScene.title}｜${route.recommendedScene.environment}，多地点串联`;
        draft.segments = draft.segments.map((segment, segmentIndex) => ({
          ...segment,
          // 保留已选环境原文以通过路线边界，同时让执行预算识别出卧室/厨房两地。
          location: `${route.recommendedScene.environment}，${segmentIndex % 2 === 0 ? '卧室' : '厨房'}`,
          subject: `@图片1中的${context.profile.productName}、手机、电脑与水杯`,
          cameraMovement: [
            '镜头快速推近产品证据',
            '镜头横移操作过程',
            '镜头跟随产品动作',
            '镜头环绕产品结果',
          ][segmentIndex]!,
        }));
        terminalInvalidDraft = structuredClone(draft);
        terminalPreviousDrafts = structuredClone(input.previousDrafts);
      }
      return {
        ...result,
        drafts: [{
          ...result.drafts[0]!,
          planIndex: 1,
          draft,
        }],
      };
    });

    try {
      const result = await generateValidatedPromptWizardRoutePlansV6({
        provider: {
          generateUseDirectionDrafts: generateSpy,
          repairUseDirectionDrafts: repairSpy,
        } as never,
        profile: context.profile,
        evidenceGraph: context.evidenceGraph,
        voiceoverLanguage: context.brief.targetLanguage,
        verifiedOffer: '',
        config,
        routeSet,
        imageCount: context.imageCount,
        variationKey: 1,
        deadlineAtMs: Date.now() + 240_000,
        historicalPlans: [],
      });

      expect(result.repairRounds).toBe(2);
      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).toHaveBeenCalledTimes(2);
      expect(contentRepairRound).toBe(2);
      expect(terminalInvalidDraft).not.toBeNull();
      expect(terminalPreviousDrafts).not.toBeNull();
      expect(validatePromptWizardShotExecutionBudget({
        shots: terminalInvalidDraft!.segments,
        config,
      }).map(issue => issue.code)).toEqual([
        'TOO_MANY_LOCATIONS',
        'TOO_MANY_PROPS',
        'TOO_MANY_CAMERA_MOVES',
      ]);
      expect(result.plans.map(plan => plan.deliveryVersion === 6 ? plan.role : null))
        .toEqual(['proof-conversion', 'problem-hook', 'lifestyle-seeding']);

      const route = routeSet.routes[1]!;
      const finalDraft = result.drafts[1]!;
      expect(finalDraft.primaryScene).toBe(
        `${route.recommendedScene.title}｜${route.recommendedScene.environment}`,
      );
      expect(finalDraft.segments.every(segment => (
        segment.location === route.recommendedScene.environment
      ))).toBe(true);
      expect(finalDraft.segments.every(segment => (
        segment.cameraMovement === safeCameraMovement
      ))).toBe(true);
      expect(finalDraft.segments.every(segment => (
        segment.productionNote === safeProductionNote
      ))).toBe(true);
      expect(finalDraft.segments.every(segment => (
        segment.subject.includes(`@图片1中的${context.profile.productName}`)
        && !/手机|电脑|水杯/u.test(segment.subject)
      ))).toBe(true);

      const maskBudgetFields = (draft: PromptWizardPlanDraft) => ({
        ...draft,
        primaryScene: '__primaryScene__',
        segments: draft.segments.map(segment => ({
          ...segment,
          location: '__location__',
          subject: '__subject__',
          cameraMovement: '__cameraMovement__',
          productionNote: '__productionNote__',
        })),
      });
      // 终态回退只能修改三个命中预算对应的字段，不能重写叙事、证据或口播。
      expect(JSON.stringify(maskBudgetFields(finalDraft))).toBe(
        JSON.stringify(maskBudgetFields(terminalInvalidDraft!)),
      );
      expect(finalDraft.hook).toBe(terminalInvalidDraft!.hook);
      expect(finalDraft.narrative).toBe(terminalInvalidDraft!.narrative);
      expect(finalDraft.segments.map(segment => ({
        action: segment.action,
        voiceover: segment.voiceover,
        voiceoverZh: segment.voiceoverZh,
        evidenceRefs: segment.evidenceRefs,
      }))).toEqual(terminalInvalidDraft!.segments.map(segment => ({
        action: segment.action,
        voiceover: segment.voiceover,
        voiceoverZh: segment.voiceoverZh,
        evidenceRefs: segment.evidenceRefs,
      })));
      expect(finalDraft.segments.at(-1)?.action).toBe(
        terminalInvalidDraft!.segments.at(-1)?.action,
      );
      expect(finalDraft.segments.at(-1)?.voiceover).toBe(
        terminalInvalidDraft!.segments.at(-1)?.voiceover,
      );
      expect(JSON.stringify(result.drafts[0])).toBe(
        JSON.stringify(terminalPreviousDrafts![0]),
      );
      expect(JSON.stringify(result.drafts[2])).toBe(
        JSON.stringify(terminalPreviousDrafts![2]),
      );
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 终态执行预算混入人物超限时拒绝确定性组合回退', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const config = {
      model: 'seedance-2.0-mini',
      aspectRatio: '9:16',
      resolution: '480p',
      durationSeconds: 15,
    } as const;
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000334',
      runId: '00000000-0000-4000-8000-000000000335',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const fakeProvider = new FakePromptWizardProvider();
    const generateDrafts = fakeProvider.generateUseDirectionDrafts.bind(fakeProvider);
    const repairDrafts = fakeProvider.repairUseDirectionDrafts.bind(fakeProvider);
    const unsafeHook = '支持主动降噪的通勤体验';
    let validPlanOneHook = '';
    let terminalInvalidDraft: PromptWizardPlanDraft | null = null;
    const generateSpy = vi.fn(async (input: Parameters<typeof generateDrafts>[0]) => {
      const result = await generateDrafts(input);
      if (input.planContexts[0]?.planIndex === 1 && result.drafts[0]) {
        validPlanOneHook = result.drafts[0].hook;
        result.drafts[0] = { ...result.drafts[0], hook: unsafeHook };
      }
      return result;
    });
    let contentRepairRound = 0;
    const repairSpy = vi.fn(async (input: Parameters<typeof repairDrafts>[0]) => {
      const result = await repairDrafts(input);
      if (input.issues[0]?.planIndex !== 1) return result;
      contentRepairRound += 1;
      const draft = structuredClone(input.previousDrafts[1]!);
      if (contentRepairRound === 1) {
        draft.hook = unsafeHook;
      } else {
        const route = routeSet.routes[1]!;
        draft.hook = validPlanOneHook;
        draft.primaryScene = `${route.recommendedScene.title}｜${route.recommendedScene.environment}，多地点串联`;
        draft.segments = draft.segments.map((segment, segmentIndex) => ({
          ...segment,
          location: `${route.recommendedScene.environment}，${segmentIndex % 2 === 0 ? '卧室' : '厨房'}`,
          // 人物预算不在终态安全白名单内；即使其余三类都可收口也必须整案失败。
          subject: `@图片1中的${context.profile.productName}、两位用户、手机、电脑与水杯`,
          cameraMovement: [
            '镜头快速推近产品证据',
            '镜头横移操作过程',
            '镜头跟随产品动作',
            '镜头环绕产品结果',
          ][segmentIndex]!,
        }));
        terminalInvalidDraft = structuredClone(draft);
      }
      return {
        ...result,
        drafts: [{
          ...result.drafts[0]!,
          planIndex: 1,
          draft,
        }],
      };
    });

    try {
      let thrown: unknown;
      try {
        await generateValidatedPromptWizardRoutePlansV6({
          provider: {
            generateUseDirectionDrafts: generateSpy,
            repairUseDirectionDrafts: repairSpy,
          } as never,
          profile: context.profile,
          evidenceGraph: context.evidenceGraph,
          voiceoverLanguage: context.brief.targetLanguage,
          verifiedOffer: '',
          config,
          routeSet,
          imageCount: context.imageCount,
          variationKey: 1,
          deadlineAtMs: Date.now() + 240_000,
          historicalPlans: [],
        });
      } catch (error) {
        thrown = error;
      }

      expect(contentRepairRound).toBe(2);
      expect(generateSpy).toHaveBeenCalledTimes(3);
      expect(repairSpy).toHaveBeenCalledTimes(2);
      expect(terminalInvalidDraft).not.toBeNull();
      expect(validatePromptWizardShotExecutionBudget({
        shots: terminalInvalidDraft!.segments,
        config,
      }).map(issue => issue.code)).toEqual([
        'TOO_MANY_LOCATIONS',
        'TOO_MANY_PEOPLE',
        'TOO_MANY_PROPS',
        'TOO_MANY_CAMERA_MOVES',
      ]);
      expect(thrown).toMatchObject({
        code: 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED',
        fieldPaths: ['segments'],
        repairRounds: 2,
        planIndexes: [1],
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('V6 仅修改中文译文与生产警告时，执行提示词保持逐字不变', async () => {
    const originalFakeDelayMs = env.FAKE_PROVIDER_DELAY_MS;
    env.FAKE_PROVIDER_DELAY_MS = 0;
    const context = makeConceptGenerationContext();
    const routeSet = buildPromptWizardRouteSetV6({
      id: '00000000-0000-4000-8000-000000000318',
      runId: '00000000-0000-4000-8000-000000000319',
      runRevision: 1,
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      productionBrief: context.productionBrief,
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const translationSentinel = '只供中文方案卡展示的译文哨兵';
    const warningSentinel = '只供中文方案卡展示的生产警告哨兵';
    const mutateDraft = (source: PromptWizardPlanDraft): PromptWizardPlanDraft => {
      const draft = structuredClone(source);
      draft.segments[0]!.voiceoverZh = `${draft.segments[0]!.voiceoverZh}${translationSentinel}`;
      draft.productionWarnings = [...draft.productionWarnings, warningSentinel];
      return draft;
    };
    const modifiedFake = new FakePromptWizardProvider();
    const generateDrafts = modifiedFake.generateUseDirectionDrafts.bind(modifiedFake);
    const repairDrafts = modifiedFake.repairUseDirectionDrafts.bind(modifiedFake);
    const common = {
      profile: context.profile,
      evidenceGraph: context.evidenceGraph,
      voiceoverLanguage: context.brief.targetLanguage,
      verifiedOffer: '',
      config: context.config,
      routeSet,
      imageCount: context.imageCount,
      variationKey: 1,
      deadlineAtMs: Date.now() + 240_000,
      historicalPlans: [],
    };

    try {
      const baseline = await generateValidatedPromptWizardRoutePlansV6({
        ...common,
        provider: new FakePromptWizardProvider(),
      });
      const modified = await generateValidatedPromptWizardRoutePlansV6({
        ...common,
        provider: {
          generateUseDirectionDrafts: async (
            input: Parameters<typeof generateDrafts>[0],
          ) => {
            const result = await generateDrafts(input);
            return { ...result, drafts: result.drafts.map(mutateDraft) };
          },
          repairUseDirectionDrafts: async (
            input: Parameters<typeof repairDrafts>[0],
          ) => {
            const result = await repairDrafts(input);
            return {
              ...result,
              drafts: result.drafts.map(item => ({ ...item, draft: mutateDraft(item.draft) })),
            };
          },
        } as never,
      });

      expect(modified.plans.map(plan => plan.prompt)).toEqual(
        baseline.plans.map(plan => plan.prompt),
      );
      modified.plans.forEach(plan => {
        expect(plan.shots[0]?.voiceoverZh).toContain(translationSentinel);
        expect(plan.productionWarnings).toContain(warningSentinel);
        expect(plan.prompt).not.toContain(translationSentinel);
        expect(plan.prompt).not.toContain(warningSentinel);
        plan.shots.forEach(shot => {
          expect(plan.prompt).toContain(
            `旁白（${context.brief.targetLanguage}）：${shot.voiceover}`,
          );
        });
      });
    } finally {
      env.FAKE_PROVIDER_DELAY_MS = originalFakeDelayMs;
    }
  });

  it('创意集合修复把字段级 repairFeedback 交给专用指令并按 repair-concept-set 记账', async () => {
    const context = makeConceptGenerationContext();
    const fakeResult = await new FakePromptWizardProvider().generateConcepts(context);
    const concepts = fakeResult.concepts.map(({ id: _id, ...concept }) => concept);
    const create = vi.fn().mockResolvedValue({
      id: 'response-concept-repair',
      model: 'doubao-seed-2-0-lite-260428',
      service_tier: 'default',
      output_text: JSON.stringify({ concepts }),
      usage: { input_tokens: 60, output_tokens: 40 },
    });
    const recorder = {
      beginAttempt: vi.fn().mockResolvedValue('attempt-concept-repair'),
      completeAttempt: vi.fn().mockResolvedValue(undefined),
    };
    const provider = new ArkPromptWizardProvider({ create } as never, recorder);
    const repairFeedback = [
      'concepts[2].firstSecondEvent：缺少第一秒可理解的物理事件',
      'concepts[6].evidenceIds：包含不可靠证据',
    ];

    const result = await provider.generateConcepts({
      ...context,
      repairFeedback,
      costOwner: {
        runId: '00000000-0000-4000-8000-000000000092',
        batchId: null,
        userId: '00000000-0000-4000-8000-000000000093',
        jobAttempt: 1,
        repairRound: 0,
      },
    });

    expect(result.concepts).toHaveLength(8);
    expect(create).toHaveBeenCalledOnce();
    const request = create.mock.calls[0]?.[0];
    expect(request.instructions).toContain('同一创意集合的一次定向内容修复');
    expect(request.thinking).toBeUndefined();
    const payload = JSON.parse(request.input as string);
    expect(payload.repairFeedback).toEqual(repairFeedback);
    expect(payload.repairPolicy).toEqual(expect.arrayContaining([
      expect.stringContaining('返回完整八条路线'),
    ]));
    expect(recorder.beginAttempt).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'repair-concept-set',
      planIndex: null,
      owner: expect.objectContaining({ repairRound: 1 }),
    }));
  });

  it('创意集合首轮输入不携带 repairFeedback，Fake 修复会返回一组新候选', async () => {
    const context = makeConceptGenerationContext();
    const initialPayload = JSON.parse(buildPromptWizardConceptDirectorInput(context));
    expect(initialPayload).not.toHaveProperty('repairFeedback');
    expect(initialPayload.creativePlaybook).toMatchObject({
      direction: 'ugc',
      productFamily: 'consumer-electronics',
      familyTreatment: expect.stringContaining('开机、连接、佩戴或桌面取用'),
      hookGuidance: expect.any(Array),
      proofGuidance: expect.any(Array),
      executionGuidance: expect.any(Array),
      ctaGuidance: expect.any(String),
      assessment: expect.objectContaining({ direction: 'ugc' }),
    });

    const provider = new FakePromptWizardProvider();
    const initial = await provider.generateConcepts(context);
    const repaired = await provider.generateConcepts({
      ...context,
      repairFeedback: ['concepts[0].firstSecondEvent：需要更清楚的第一秒动作'],
    });
    expect(initial.concepts).toHaveLength(8);
    expect(repaired.concepts).toHaveLength(8);
    expect(repaired.concepts[0]?.firstSecondEvent).not.toBe(
      initial.concepts[0]?.firstSecondEvent,
    );
  });

  it('产品识别固定使用 Doubao 260428、default、严格 Schema 和关闭思考', async () => {
    const evidenceSources = [
      'productName', 'category', 'materials', 'structure', 'logo', 'usage', 'visibleFacts[0]',
    ].map(fieldPath => ({
      fieldPath,
      sourceImageIndexes: [1],
      visibleRegion: '图片 1 中央产品主体',
      confidence: 'high',
      proofActions: ['稳定近景展示对应产品事实'],
    }));
    const create = vi.fn().mockResolvedValue({
      id: 'response-analysis',
      model: 'doubao-seed-2-0-lite-260428',
      service_tier: 'default',
      output_text: JSON.stringify({ ...PROFILE, evidenceSources }),
      usage: { input_tokens: 20, output_tokens: 10 },
      providerRequestId: 'request-analysis',
    });
    const provider = new ArkPromptWizardProvider({ create } as never);

    const result = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]);

    expect(PROMPT_WIZARD_SERVICE_TIER).toBe('default');
    expect(PROMPT_WIZARD_THINKING_TYPE).toBe('disabled');
    expect(PROMPT_WIZARD_PRODUCT_MAX_OUTPUT_TOKENS).toBe(8_000);
    expect(env.PROMPT_WIZARD_REQUEST_BUDGET_MS).toBe(180_000);
    expect(env.PROMPT_WIZARD_QUEUE_CONCURRENCY).toBe(10);
    expect(env.PROMPT_WIZARD_PROVIDER_CONCURRENCY).toBe(30);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: 'doubao-seed-2-0-lite-260428',
      store: false,
      stream: true,
      service_tier: 'default',
      thinking: { type: 'disabled' },
      max_output_tokens: 8_000,
      instructions: expect.stringContaining('所有说明性字段必须使用简体中文'),
      text: {
        format: {
          type: 'json_schema',
          name: 'prompt_wizard_product_profile',
          strict: true,
          schema: {
          required: expect.arrayContaining(['evidenceSources']),
          properties: {
            colors: { type: 'string', const: '' },
            userConfirmedClaims: { type: 'string', const: '' },
            evidenceSources: expect.objectContaining({
              type: 'array',
              items: expect.objectContaining({
                required: expect.arrayContaining([
                  'fieldPath', 'sourceImageIndexes', 'visibleRegion', 'confidence', 'proofActions',
                ]),
              }),
            }),
          },
          },
        },
      },
    });
    expect(create.mock.calls[0]?.[1]).toMatchObject({
      timeoutMs: env.PROMPT_WIZARD_TIMEOUT_MS,
    });
    const productSchemaText = JSON.stringify(create.mock.calls[0]?.[0]?.text?.format?.schema);
    for (const unsupportedKeyword of [
      'maxLength',
      'minLength',
      'maxItems',
      'minItems',
      'pattern',
    ]) {
      expect(productSchemaText).not.toContain(`\"${unsupportedKeyword}\"`);
    }
    expect(result.usage).toMatchObject({
      serviceTier: 'default',
      requestAttempts: 1,
      inputTokens: 20,
      outputTokens: 10,
    });
    expect(result.profile.colors).toBe('');
    expect(result.profile.userConfirmedClaims).toBe('');
    expect(result.evidenceSources).toEqual(evidenceSources);
  });

  it('permit 排队耗尽共享预算时不调用 responses.create，也不记录为已外呼', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-07-24T00:00:00.000Z');
    vi.setSystemTime(startedAt);
    const gates = Array.from({ length: 30 }, () => deferredValue<{
      id: string;
      model: string;
      output_text: string;
      usage: { input_tokens: number; output_tokens: number };
    }>());
    let nextGate = 0;
    const create = vi.fn().mockImplementation(() => gates[nextGate++]!.promise);
    const recorder = {
      beginAttempt: vi.fn().mockResolvedValue('unexpected-attempt'),
      completeAttempt: vi.fn().mockResolvedValue(undefined),
    };
    const provider = new ArkPromptWizardProvider({ create } as never, recorder);
    const image = {
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png' as const,
      sizeBytes: 1_024,
    };
    const activeRequests = Array.from({ length: 30 }, () => provider.analyzeProduct([image]));
    const queuedRequest = provider.analyzeProduct([image], {
      runId: '00000000-0000-4000-8000-000000000031',
      batchId: null,
      userId: '00000000-0000-4000-8000-000000000032',
      jobAttempt: 1,
      repairRound: 0,
    }).catch(cause => cause);

    const responseFor = (index: number) => ({
      id: `response-permit-${index}`,
      model: 'doubao-seed-2-0-lite-260428',
      output_text: JSON.stringify(PROFILE),
      usage: { input_tokens: 20, output_tokens: 10 },
    });

    try {
      await waitForMicrotasks(() => create.mock.calls.length === 30);
      expect(create).toHaveBeenCalledTimes(30);

      vi.setSystemTime(new Date(startedAt.getTime() + env.PROMPT_WIZARD_REQUEST_BUDGET_MS + 1));
      gates[0]!.resolve(responseFor(0));

      const error = await queuedRequest;
      expect(error).toMatchObject({
        code: 'PROMPT_WIZARD_PROVIDER_TIMEOUT',
        retryable: false,
      });
      expect(error.providerRequestAttempted).not.toBe(true);
      expect(create).toHaveBeenCalledTimes(30);
      expect(recorder.beginAttempt).not.toHaveBeenCalled();
      expect(recorder.completeAttempt).not.toHaveBeenCalled();
    } finally {
      gates.forEach((gate, index) => gate.resolve(responseFor(index)));
      await Promise.allSettled(activeRequests);
      vi.useRealTimers();
    }
  });

  it('每次真实 HTTP 传输尝试各写一行账本，失败有 usage 也保留并独立计费', async () => {
    const originalRetryBaseDelayMs = env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS;
    env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS = 0;
    const firstError = Object.assign(new Error('temporary'), {
      code: 'temporary_error',
      status: 500,
      httpStatus: 500,
      retryable: true,
      usage: {
        input_tokens: 7,
        cached_input_tokens: 1,
        output_tokens: 2,
      },
    });
    const create = vi.fn()
      .mockRejectedValueOnce(firstError)
      .mockResolvedValueOnce({
        id: 'response-ledger-success',
        model: 'doubao-seed-2-0-lite-260428',
        service_tier: 'default',
        output_text: JSON.stringify(PROFILE),
        usage: {
          input_tokens: 20,
          cached_input_tokens: 4,
          output_tokens: 10,
        },
        providerRequestId: 'request-ledger-success',
        httpStatus: 200,
      });
    const recorder = {
      beginAttempt: vi.fn()
        .mockResolvedValueOnce('attempt-1')
        .mockResolvedValueOnce('attempt-2'),
      completeAttempt: vi.fn().mockResolvedValue(undefined),
    };
    const provider = new ArkPromptWizardProvider({ create } as never, recorder);

    const result = await (async () => {
      try {
        return await provider.analyzeProduct([{
          name: 'product.png',
          url: 'https://assets.example.com/product.png?signature=redacted',
          mimeType: 'image/png',
          sizeBytes: 1_024,
        }], {
          runId: '00000000-0000-4000-8000-000000000001',
          batchId: null,
          userId: '00000000-0000-4000-8000-000000000002',
          jobAttempt: 1,
          repairRound: 0,
        });
      } finally {
        env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS = originalRetryBaseDelayMs;
      }
    })();

    expect(create).toHaveBeenCalledTimes(2);
    expect(recorder.beginAttempt.mock.calls.map(call => call[0].transportAttempt)).toEqual([1, 2]);
    expect(recorder.completeAttempt).toHaveBeenNthCalledWith(1, 'attempt-1', expect.objectContaining({
      status: 'failed',
      httpStatus: 500,
      usage: { inputTokens: 7, cachedInputTokens: 1, outputTokens: 2 },
    }));
    expect(recorder.completeAttempt).toHaveBeenNthCalledWith(2, 'attempt-2', expect.objectContaining({
      status: 'succeeded',
      providerResponseId: 'response-ledger-success',
      usage: { inputTokens: 20, cachedInputTokens: 4, outputTokens: 10 },
    }));
    expect(result.usage).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      requestAttempts: 2,
    });
  });

  it.each([
    {
      caseName: '短字段超长',
      candidate: { ...PROFILE, productName: '耳机'.repeat(251) },
      expectedIssue: { path: 'productName', kind: 'too_long', limit: 500, actual: 502 },
    },
    {
      caseName: '数组超过 20 项',
      candidate: {
        ...PROFILE,
        visibleFacts: Array.from({ length: 21 }, (_, index) => `可见事实 ${index + 1}`),
      },
      expectedIssue: { path: 'visibleFacts', kind: 'too_many_items', limit: 20, actual: 21 },
    },
    {
      caseName: '数组项目超过 300 字符',
      candidate: { ...PROFILE, visibleFacts: ['事实'.repeat(151)] },
      expectedIssue: { path: 'visibleFacts[0]', kind: 'too_long', limit: 300, actual: 302 },
    },
    {
      caseName: '字段类型错误',
      candidate: { ...PROFILE, visibleFacts: '不是数组' },
      expectedIssue: { path: 'visibleFacts', kind: 'type' },
    },
    {
      caseName: '废弃颜色或模型生成的用户宣称不为空',
      candidate: {
        ...PROFILE,
        colors: '黑色',
        userConfirmedClaims: '100% 防水',
      },
      expectedIssue: { path: 'colors', kind: 'must_be_empty' },
    },
    {
      caseName: '说明字段不是中文',
      candidate: {
        ...PROFILE,
        productName: 'Pro X Headphones',
        category: 'Over-ear headphones',
        materials: 'Matte plastic',
        structure: 'Foldable headband',
        usage: 'Wear over both ears',
        suggestedAudience: 'Commuters',
        suggestedScenarios: 'Commuting',
        visibleFacts: ['The headband is foldable'],
        needsConfirmation: ['Battery life needs confirmation'],
        consistencyConstraints: 'Keep the structure unchanged',
      },
      expectedIssue: { path: 'productName', kind: 'language' },
    },
    {
      caseName: '少量中文包裹大段外语说明',
      candidate: {
        ...PROFILE,
        category: '耳机 Over ear headphones designed for commuting and office use',
      },
      expectedIssue: { path: 'category', kind: 'language' },
    },
  ])('$caseName 时只执行一次统一修复，且修复请求不携带图片或签名 URL', async ({
    candidate,
    expectedIssue,
  }) => {
    const repairedProfile = {
      ...PROFILE,
      colors: '',
      userConfirmedClaims: '',
    };
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'response-analysis-invalid',
        model: 'doubao-seed-2-0-lite-260428',
        service_tier: 'default',
        output_text: JSON.stringify(candidate),
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        id: 'response-analysis-repaired',
        model: 'doubao-seed-2-0-lite-260428',
        service_tier: 'fast',
        output_text: JSON.stringify(repairedProfile),
        usage: { input_tokens: 12, output_tokens: 8 },
      });
    const provider = new ArkPromptWizardProvider({ create } as never);

    const result = await provider.analyzeProduct([{
      name: 'Pro-X.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[0]).toMatchObject({
      store: false,
      stream: true,
      service_tier: 'default',
      thinking: { type: 'disabled' },
      max_output_tokens: 8_000,
      instructions: expect.stringContaining('不得新增或推断任何产品事实'),
    });
    const repairInput = create.mock.calls[1]?.[0]?.input;
    expect(typeof repairInput).toBe('string');
    expect(repairInput).not.toContain('input_image');
    expect(repairInput).not.toContain('assets.example.com');
    expect(JSON.parse(repairInput as string)).toMatchObject({
      task: expect.stringContaining('修复'),
      issues: expect.arrayContaining([
        expect.objectContaining(expectedIssue),
      ]),
      profile: candidate,
    });
    expect(result.profile).toMatchObject({ colors: '', userConfirmedClaims: '' });
    expect(result.usage).toMatchObject({
      interactionId: 'response-analysis-repaired',
      inputTokens: 32,
      outputTokens: 18,
      serviceTier: 'fast',
      requestAttempts: 2,
    });
  });

  it('产品档案修复按 visibleFacts 索引执行中文修复，并逐字保留非问题条目与初次原文白名单', async () => {
    const initialProfile = {
      ...PROFILE,
      productName: '短袖T恤 MEXICO',
      logo: '衣身可见 MEXICO 原文印花',
      visibleFacts: [
        '参考图片中可见短袖上衣的正面与背面',
        'The front panel carries MEXICO lettering',
        '领口和袖口属于图片中可确认的结构细节',
        'The collar uses a ribbed finish',
        'The back panel shows MEXICO ORIGINAL TEAM print',
      ],
    };
    const repairedVisibleFacts = [
      '模型错误改写成了 English front and back description',
      '正面位置可见“MEXICO”原文印花，其字母排列属于图片中能够直接确认的视觉信息',
      '模型错误改写成了 English collar description',
      '领口位置可见罗纹状收边，属于图片中能够直接确认的结构细节',
      '背面位置可见“MEXICO ORIGINAL TEAM”原文印花，文字的位置、排列和大小属于图片中能够直接确认的视觉信息',
    ];
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'analysis-visible-facts-language-invalid',
        output_text: JSON.stringify(initialProfile),
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        id: 'repair-visible-facts-language-valid',
        output_text: JSON.stringify({
          ...initialProfile,
          productName: '模型擅自修改的产品名称 OTHER',
          logo: 'The front panel carries MEXICO ORIGINAL TEAM print',
          visibleFacts: repairedVisibleFacts,
        }),
        usage: { input_tokens: 12, output_tokens: 8 },
      });
    const provider = new ArkPromptWizardProvider({ create } as never);

    const result = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]);

    expect(create).toHaveBeenCalledTimes(2);
    const repairInput = JSON.parse(create.mock.calls[1]?.[0]?.input as string);
    expect(repairInput).toMatchObject({
      repairScope: {
        editableFieldPaths: [
          'visibleFacts[1]',
          'visibleFacts[3]',
          'visibleFacts[4]',
        ],
      },
      languagePolicy: {
        allowedOriginalLatinTokens: expect.arrayContaining(['mexico']),
      },
      repairActions: expect.arrayContaining([
        expect.objectContaining({
          path: 'visibleFacts[1]',
          kind: 'language',
          limit: 4,
          actual: 29,
          action: expect.stringContaining('完整翻译或改写为简体中文'),
        }),
        expect.objectContaining({
          path: 'visibleFacts[4]',
          kind: 'language',
          limit: 4,
          actual: 34,
        }),
      ]),
    });
    expect(result.profile.productName).toBe(initialProfile.productName);
    expect(result.profile.logo).toBe(initialProfile.logo);
    expect(result.profile.visibleFacts).toEqual([
      initialProfile.visibleFacts[0],
      repairedVisibleFacts[1],
      initialProfile.visibleFacts[2],
      repairedVisibleFacts[3],
      repairedVisibleFacts[4],
    ]);
  });

  it('修复结果不能通过改写非问题 name 或 logo 扩大原文白名单', async () => {
    const initialProfile = {
      ...PROFILE,
      productName: '短袖T恤 MEXICO',
      logo: '衣身可见 MEXICO 原文印花',
      visibleFacts: ['The front panel carries MEXICO lettering'],
    };
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'analysis-whitelist-invalid',
        output_text: JSON.stringify(initialProfile),
      })
      .mockResolvedValueOnce({
        id: 'repair-whitelist-expanded',
        output_text: JSON.stringify({
          ...initialProfile,
          productName: '短袖T恤 The front panel carries MEXICO lettering',
          logo: 'The front panel carries MEXICO lettering',
        }),
      });
    const provider = new ArkPromptWizardProvider({ create } as never);

    const error = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PRODUCT_REPAIR_FAILED',
      fieldPaths: ['visibleFacts[0]'],
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('删除 indexed 空白项时按首次候选原索引收口且不复制发生位移的相邻事实', async () => {
    const initialProfile = {
      ...PROFILE,
      visibleFacts: [
        '图片中可见产品正面',
        '',
        '图片中可见产品背面',
      ],
    };
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'analysis-empty-visible-fact',
        output_text: JSON.stringify(initialProfile),
      })
      .mockResolvedValueOnce({
        id: 'repair-empty-visible-fact',
        output_text: JSON.stringify({
          ...initialProfile,
          visibleFacts: [
            '模型错误改写产品正面',
            '模型错误改写产品背面',
          ],
        }),
      });
    const provider = new ArkPromptWizardProvider({ create } as never);

    const result = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]);

    expect(result.profile.visibleFacts).toEqual([
      '图片中可见产品正面',
      '图片中可见产品背面',
    ]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('产品修复输入公开精确中文门禁规则且不放宽每项校验', () => {
    const input = JSON.parse(buildPromptWizardProductRepairInput({
      ...PROFILE,
      productName: '短袖T恤 MEXICO',
      logo: '衣身可见 MEXICO 原文印花',
    }, [{
      path: 'visibleFacts[1]',
      kind: 'language',
      limit: 4,
      actual: 29,
    }]));

    expect(input.languagePolicy).toMatchObject({
      simplifiedChineseRule: expect.stringContaining('不得超过 max(4, 汉字数)'),
      arrayRule: expect.stringContaining('每一项单独执行中文占主导校验'),
      allowedOriginalLatinTokens: expect.arrayContaining(['mexico']),
    });
    expect(input.repairScope.editableFieldPaths).toEqual(['visibleFacts[1]']);
  });

  it('首次识别已用一次传输重试后若档案字段不合格，也不再发起第三次档案修复', async () => {
    const originalRetryBaseDelayMs = env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS;
    env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS = 0;
    const create = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('temporary upstream failure'), {
        code: 'upstream_unavailable',
        status: 503,
        httpStatus: 503,
        retryable: true,
        receivedBytes: 0,
        receivedEvent: false,
      }))
      .mockResolvedValueOnce({
        id: 'response-invalid-profile-after-transport-retry',
        output_text: JSON.stringify({ ...PROFILE, visibleFacts: '不是数组' }),
        usage: { input_tokens: 21, output_tokens: 6 },
      });
    const provider = new ArkPromptWizardProvider({ create } as never);

    try {
      const error = await provider.analyzeProduct([{
        name: 'product.png',
        url: 'https://assets.example.com/product.png?signature=redacted',
        mimeType: 'image/png',
        sizeBytes: 1_024,
      }]).catch(cause => cause);

      expect(error).toMatchObject({
        code: 'PROMPT_WIZARD_PRODUCT_REPAIR_FAILED',
        responseId: 'response-invalid-profile-after-transport-retry',
        providerRequestAttempted: true,
        errorClassification: 'request-call-limit-exhausted',
        fieldPaths: ['visibleFacts'],
        usage: { input_tokens: null, output_tokens: null },
      });
      expect(create).toHaveBeenCalledTimes(2);
      expect(create.mock.calls.map(([request]) => request.text.format.name)).toEqual([
        'prompt_wizard_product_profile',
        'prompt_wizard_product_profile',
      ]);
    } finally {
      env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS = originalRetryBaseDelayMs;
    }
  });

  it('统一修复后仍不合格时返回修复失败且不发起第三次调用', async () => {
    const englishProfile = {
      productName: 'Headphones',
      category: 'Audio',
      colors: 'Black',
      materials: 'Plastic',
      structure: 'Headband',
      logo: 'Pro X',
      usage: 'Wear it',
      suggestedAudience: 'Commuters',
      suggestedScenarios: 'Office',
      visibleFacts: ['Foldable'],
      needsConfirmation: ['Battery'],
      userConfirmedClaims: '',
      consistencyConstraints: 'Keep unchanged',
    };
    const create = vi.fn()
      .mockResolvedValueOnce({ id: 'analysis-en', output_text: JSON.stringify(englishProfile) })
      .mockResolvedValueOnce({ id: 'repair-en', output_text: JSON.stringify(englishProfile) });
    const provider = new ArkPromptWizardProvider({ create } as never);

    await expect(provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }])).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PRODUCT_REPAIR_FAILED',
      fieldPaths: expect.arrayContaining(['productName']),
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      caseName: '新增原候选中不存在的数字',
      initial: { ...PROFILE, category: 'Audio' },
      repaired: { ...PROFILE, materials: '哑光塑料，续航 40 小时' },
    },
    {
      caseName: '新增原候选中不存在的商业承诺',
      initial: { ...PROFILE, category: 'Audio' },
      repaired: { ...PROFILE, usage: '佩戴于双耳，保证永久有效' },
    },
    {
      caseName: '为缺失的待确认数组新增事实',
      initial: (() => {
        const candidate = { ...PROFILE } as Record<string, unknown>;
        delete candidate.needsConfirmation;
        return candidate;
      })(),
      repaired: PROFILE,
    },
  ])('统一修复不得$caseName', async ({ initial, repaired }) => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'response-analysis-before-unsafe-repair',
        output_text: JSON.stringify(initial),
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      .mockResolvedValueOnce({
        id: 'response-analysis-unsafe-repair',
        output_text: JSON.stringify(repaired),
        usage: { input_tokens: 8, output_tokens: 4 },
      });
    const provider = new ArkPromptWizardProvider({ create } as never);

    await expect(provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }])).rejects.toMatchObject({
      code: 'PROMPT_WIZARD_PRODUCT_REPAIR_FAILED',
      errorClassification: 'fact-preservation',
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('统一修复请求失败时保留首次成功调用并合并终态方舟用量', async () => {
    const englishProfile = {
      productName: 'Headphones',
      category: 'Audio',
      colors: '',
      materials: 'Plastic',
      structure: 'Headband',
      logo: 'Pro X',
      usage: 'Wear it',
      suggestedAudience: 'Commuters',
      suggestedScenarios: 'Office',
      visibleFacts: ['Foldable'],
      needsConfirmation: ['Battery'],
      userConfirmedClaims: '',
      consistencyConstraints: 'Keep unchanged',
    };
    const terminalError = Object.assign(new Error('上游修复暂时失败'), {
      code: 'PROMPT_WIZARD_PROVIDER_RESPONSE_FAILED',
      model: 'doubao-seed-2-0-lite-260428',
      responseId: 'response-repair-failed',
      status: 500,
      httpStatus: 500,
      usage: { input_tokens: 5, output_tokens: 2 },
      retryable: true,
    });
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'response-analysis-before-repair',
        model: 'doubao-seed-2-0-lite-260428',
        output_text: JSON.stringify(englishProfile),
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockRejectedValueOnce(terminalError);
    const provider = new ArkPromptWizardProvider({ create } as never);

    const error = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_RESPONSE_FAILED',
      model: 'doubao-seed-2-0-lite-260428',
      responseId: 'response-repair-failed',
      usage: { input_tokens: 25, output_tokens: 12 },
      retryable: false,
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('统一修复真实外呼失败且 usage 缺失时，已知首次用量也必须降为未知', async () => {
    const englishProfile = {
      productName: 'Headphones',
      category: 'Audio',
      colors: '',
      materials: 'Plastic',
      structure: 'Headband',
      logo: 'Pro X',
      usage: 'Wear it',
      suggestedAudience: 'Commuters',
      suggestedScenarios: 'Office',
      visibleFacts: ['Foldable'],
      needsConfirmation: ['Battery'],
      userConfirmedClaims: '',
      consistencyConstraints: 'Keep unchanged',
    };
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'response-analysis-known',
        model: 'doubao-seed-2-0-lite-260428',
        output_text: JSON.stringify(englishProfile),
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockRejectedValueOnce(Object.assign(new Error('repair failed without usage'), {
        code: 'PROMPT_WIZARD_PROVIDER_RESPONSE_FAILED',
        retryable: false,
        usage: { input_tokens: null, output_tokens: null },
      }));
    const provider = new ArkPromptWizardProvider({ create } as never);

    const error = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_RESPONSE_FAILED',
      providerRequestAttempted: true,
      usage: { input_tokens: null, output_tokens: null },
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('账本 begin 失败发生在修复外呼前，不会把首次已知用量降为未知', async () => {
    const englishProfile = {
      productName: 'Headphones',
      category: 'Audio',
      colors: '',
      materials: 'Plastic',
      structure: 'Headband',
      logo: 'Pro X',
      usage: 'Wear it',
      suggestedAudience: 'Commuters',
      suggestedScenarios: 'Office',
      visibleFacts: ['Foldable'],
      needsConfirmation: ['Battery'],
      userConfirmedClaims: '',
      consistencyConstraints: 'Keep unchanged',
    };
    const create = vi.fn().mockResolvedValue({
      id: 'response-analysis-before-ledger-failure',
      model: 'doubao-seed-2-0-lite-260428',
      output_text: JSON.stringify(englishProfile),
      usage: { input_tokens: 20, cached_input_tokens: 0, output_tokens: 10 },
    });
    const recorder = {
      beginAttempt: vi.fn()
        .mockResolvedValueOnce('attempt-analysis')
        .mockRejectedValueOnce(Object.assign(new Error('duplicate'), {
          code: 'PROMPT_WIZARD_PROVIDER_LEDGER_REPLAY',
          retryable: false,
        })),
      completeAttempt: vi.fn().mockResolvedValue(undefined),
    };
    const provider = new ArkPromptWizardProvider({ create } as never, recorder);

    const error = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }], {
      runId: '00000000-0000-4000-8000-000000000001',
      batchId: null,
      userId: '00000000-0000-4000-8000-000000000002',
      jobAttempt: 1,
      repairRound: 0,
    }).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_LEDGER_REPLAY',
      providerRequestAttempted: false,
      usage: { input_tokens: 20, output_tokens: 10 },
    });
    expect(create).toHaveBeenCalledOnce();
    expect(recorder.beginAttempt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      operation: 'repair-product-profile',
      planIndex: null,
      transportAttempt: 1,
      owner: expect.objectContaining({ repairRound: 1 }),
    }));
    expect(recorder.completeAttempt).toHaveBeenCalledOnce();
  });

  it('用量采用方舟完成响应返回的实际 service tier', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'response-analysis-fast',
      model: 'doubao-seed-2-0-lite-260428',
      service_tier: 'fast',
      output_text: JSON.stringify(PROFILE),
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const result = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]);
    expect(result.usage.serviceTier).toBe('fast');
  });

  it('产品档案自动修复仍失败时只附安全字段路径，不附响应内容且不调用第三次', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'response-analysis-invalid-profile',
      model: 'doubao-seed-2-0-lite-260428',
      output_text: JSON.stringify({ ...PROFILE, visibleFacts: '不是数组' }),
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const provider = new ArkPromptWizardProvider({ create } as never);

    const error = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PRODUCT_REPAIR_FAILED',
      responseId: 'response-analysis-invalid-profile',
      fieldPaths: ['visibleFacts'],
    });
    expect(JSON.stringify(error.fieldPaths)).not.toContain('不是数组');
    expect(JSON.stringify(error.repairIssues ?? [])).not.toContain('不是数组');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('双方案共享截止时间并行发起两个 8k 单方案严格 Schema 请求，再按 planIndex 聚合', async () => {
    const create = vi.fn().mockImplementation(async request => {
      const planIndex = JSON.parse(request.input as string).planIndex as number;
      await new Promise(resolve => setTimeout(resolve, (1 - planIndex) * 2));
      return {
        id: `response-draft-${planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        service_tier: planIndex === 1 ? 'fast' : 'default',
        output_text: JSON.stringify(makeProviderWireDraft(planIndex)),
        usage: { input_tokens: 10 + planIndex, output_tokens: 20 + planIndex },
      };
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'ark-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const result = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
      deadlineAtMs: Date.now() + 240_000,
    });

    expect(result.drafts).toHaveLength(PROMPT_WIZARD_PLAN_COUNT);
    expect(PROMPT_WIZARD_DRAFT_MAX_OUTPUT_TOKENS).toBe(8_000);
    expect(create).toHaveBeenCalledTimes(PROMPT_WIZARD_PLAN_COUNT);
    for (const [planIndex, call] of create.mock.calls.entries()) {
      expect(call[0]).toMatchObject({
        model: 'doubao-seed-2-0-lite-260428',
        store: false,
        stream: true,
        service_tier: 'default',
        thinking: { type: 'disabled' },
        max_output_tokens: 8_000,
        instructions: expect.stringContaining('产品事实 → 受众痛点 → 非广告切口 → 产品自证 → 自然 CTA'),
        text: {
          format: {
            type: 'json_schema',
            name: `prompt_wizard_plan_${planIndex + 1}`,
            strict: true,
            schema: expect.objectContaining({
              additionalProperties: false,
              required: expect.arrayContaining([
                'name', 'planningReview', 'segments', 'productionWarnings',
              ]),
              properties: expect.objectContaining({
                name: { type: 'string' },
                planningReview: expect.objectContaining({ additionalProperties: false }),
                segments: expect.objectContaining({
                  type: 'array',
                  items: expect.objectContaining({ additionalProperties: false }),
                }),
              }),
            }),
          },
        },
      });
      expect(call[0].instructions).toContain('包括“100%”“零风险”“永久”等表达');
      expect(call[1]).toMatchObject({ timeoutMs: expect.any(Number) });
      expect(JSON.parse(call[0].input as string)).toMatchObject({
        planIndex,
        assignedStrategy: strategies[planIndex],
      });
      const parsedInput = JSON.parse(call[0].input as string) as {
        structuredOutputPolicy: { rules: string[] };
      };
      expect(parsedInput.structuredOutputPolicy.rules.join('\n')).toContain('标准 JSON.parse');
      expect(call[0].instructions).toContain('中文弯引号');
      expect(call[0].instructions).toContain('JSON 词法自检');
      expect(call[0].instructions).toContain('editingCue 必须能执行，并且严禁出现“帧”字');
    }
    const schemaText = JSON.stringify(create.mock.calls[0]?.[0]?.text?.format?.schema);
    expect(schemaText).not.toContain('description');
    expect(schemaText).not.toContain('enum');
    expect(schemaText).not.toContain('minItems');
    expect(schemaText).not.toContain('maxItems');
    expect(schemaText).not.toContain('maxLength');
    expect(schemaText).not.toContain('alternativeHooks');
    expect(schemaText).not.toContain('onScreenText');
    expect(result.drafts[0]).toEqual(makeProviderDraft(0));
    expect(result.drafts[1]).toEqual(makeProviderDraft(1));
    expect(result.usage).toMatchObject({
      interactionId: 'response-draft-1',
      inputTokens: 21,
      outputTokens: 41,
      requestAttempts: 2,
      serviceTier: 'fast',
    });
  });

  it('只归一化完整 JSON 围栏与字符串内裸控制字符，不触发单方案格式重生', async () => {
    const create = vi.fn().mockImplementation(request => {
      const planIndex = JSON.parse(request.input as string).planIndex as number;
      const wire = makeProviderWireDraft(planIndex);
      let outputText = JSON.stringify(wire);
      if (planIndex === 0) {
        outputText = `\uFEFF  \`\`\`json\n${outputText}\n\`\`\`  `;
      }
      if (planIndex === 1) {
        outputText = outputText.replace(
          `"name":"${wire.name}"`,
          `"name":"${wire.name}\n现场"`,
        );
      }
      return Promise.resolve({
        id: `response-lexically-normalized-${planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: outputText,
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'lexically-normalized-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const result = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    });

    expect(create).toHaveBeenCalledTimes(PROMPT_WIZARD_PLAN_COUNT);
    expect(result.drafts[0]).toEqual(makeProviderDraft(0));
    expect(result.drafts[1]?.name).toBe('方案 2\n现场');
    const parsedInputs = create.mock.calls.map(([request]) => (
      JSON.parse(request.input as string) as { formatRecovery?: unknown }
    ));
    expect(parsedInputs.every(input => input.formatRecovery === undefined)).toBe(true);
  });

  it('无损转义正文中后接 ASCII 逗号的未转义双引号，不误判为字段结尾', async () => {
    const create = vi.fn().mockImplementation(request => {
      const planIndex = JSON.parse(request.input as string).planIndex as number;
      const wire = makeProviderWireDraft(planIndex);
      if (planIndex === 0) {
        wire.segments[0]!.action = '手部围绕杯身的"奖杯",图案持续转动';
      }
      let outputText = JSON.stringify(wire);
      if (planIndex === 0) {
        outputText = outputText.replaceAll('\\"奖杯\\"', '"奖杯"');
      }
      return Promise.resolve({
        id: `response-unescaped-quoted-copy-${planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: outputText,
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'unescaped-quoted-copy-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const result = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    });

    expect(result.drafts[0]!.segments[0]!.action)
      .toBe('手部围绕杯身的"奖杯",图案持续转动');
    expect(create).toHaveBeenCalledTimes(PROMPT_WIZARD_PLAN_COUNT);
    const parsedInputs = create.mock.calls.map(([request]) => (
      JSON.parse(request.input as string) as { formatRecovery?: unknown }
    ));
    expect(parsedInputs.every(input => input.formatRecovery === undefined)).toBe(true);
  });

  it('JSON 围栏外存在单段解释文字时无损提取唯一对象且不追加格式恢复', async () => {
    const create = vi.fn().mockImplementation(request => {
      const parsedInput = JSON.parse(request.input as string) as {
        planIndex: number;
        formatRecovery?: unknown;
      };
      const valid = JSON.stringify(makeProviderWireDraft(parsedInput.planIndex));
      return Promise.resolve({
        id: `response-envelope-extra-${parsedInput.planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: parsedInput.planIndex === 1 && !parsedInput.formatRecovery
          ? `\`\`\`json\n${valid}\n\`\`\`\n以上是方案`
          : valid,
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'envelope-extra-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const result = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    });

    expect(result.drafts).toHaveLength(PROMPT_WIZARD_PLAN_COUNT);
    expect(create).toHaveBeenCalledTimes(2);
    const parsedInputs = create.mock.calls.map(([request]) => (
      JSON.parse(request.input as string) as { planIndex: number; formatRecovery?: unknown }
    ));
    expect(parsedInputs.map(input => input.planIndex)).toEqual([0, 1]);
    expect(parsedInputs.every(input => input.formatRecovery === undefined)).toBe(true);
  });

  it('无损修复字符串内非法反斜杠、正文双引号和顶层尾逗号', async () => {
    const create = vi.fn().mockImplementation(request => {
      const planIndex = JSON.parse(request.input as string).planIndex as number;
      const wire = makeProviderWireDraft(planIndex);
      let outputText = JSON.stringify(wire);
      if (planIndex === 0) {
        outputText = outputText
          .replace(
            `"name":"${wire.name}"`,
            '"name":"方案 "MEXICO" \\shots"',
          )
          .replace(/\}$/u, ',}');
      }
      return Promise.resolve({
        id: `response-lexical-noise-${planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: outputText,
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'lexical-noise-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const result = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.drafts[0]?.name).toBe('方案 "MEXICO" \\shots');
  });

  it('并发方案中非首个真实请求缺失 usage 时，业务操作总 Token 保持未知', async () => {
    const create = vi.fn().mockImplementation(request => {
      const planIndex = JSON.parse(request.input as string).planIndex as number;
      if (planIndex === 0) {
        return Promise.reject(Object.assign(new Error('plan 0 failed with usage'), {
          code: 'PROMPT_WIZARD_PROVIDER_RESPONSE_FAILED',
          responseId: 'response-failed-plan-0',
          retryable: false,
          usage: { input_tokens: 40, output_tokens: 4 },
        }));
      }
      if (planIndex === 1) {
        return Promise.reject(Object.assign(new Error('plan 1 failed without usage'), {
          code: 'PROMPT_WIZARD_PROVIDER_RESPONSE_FAILED',
          responseId: 'response-failed-plan-1',
          retryable: false,
        }));
      }
      throw new Error('不应请求第三个方案');
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'parallel-unknown-usage-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const error = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    }).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_RESPONSE_FAILED',
      responseId: 'response-failed-plan-0',
      providerRequestAttempted: true,
      usage: { input_tokens: null, output_tokens: null },
    });
    expect(create).toHaveBeenCalledTimes(PROMPT_WIZARD_PLAN_COUNT);
  });

  it('首轮与格式重生的无效 JSON 响应都缺失 usage 时，总 Token 仍保持未知', async () => {
    const create = vi.fn().mockImplementation(request => {
      const planIndex = JSON.parse(request.input as string).planIndex as number;
      if (planIndex === 0) {
        return Promise.resolve({
          id: 'response-invalid-plan-without-usage',
          model: 'doubao-seed-2-0-lite-260428',
          output_text: '{invalid',
        });
      }
      return Promise.resolve({
        id: `response-known-plan-${planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: JSON.stringify(makeProviderWireDraft(planIndex)),
        usage: { input_tokens: 20, output_tokens: 10 },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'first-local-failure-unknown-usage-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const error = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    }).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
      responseId: 'response-invalid-plan-without-usage',
      providerRequestAttempted: true,
      usage: { input_tokens: null, output_tokens: null },
    });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('产品无效 JSON 只执行一次格式恢复，重发原图片与同一 Schema 且不携带坏正文', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'interaction-invalid-json',
        model: 'doubao-seed-2-0-lite-260428',
        output_text: '{invalid',
        usage: { input_tokens: 15, output_tokens: 3 },
      })
      .mockResolvedValueOnce({
        id: 'interaction-product-format-recovered',
        model: 'doubao-seed-2-0-lite-260428',
        service_tier: 'fast',
        output_text: JSON.stringify(PROFILE),
        usage: { input_tokens: 18, output_tokens: 7 },
      });
    const recorder = {
      beginAttempt: vi.fn()
        .mockResolvedValueOnce('attempt-analysis')
        .mockResolvedValueOnce('attempt-product-format'),
      completeAttempt: vi.fn().mockResolvedValue(undefined),
    };
    const provider = new ArkPromptWizardProvider({ create } as never, recorder);
    const images = Array.from({ length: 9 }, (_, index) => ({
      name: `product-${index + 1}.png`,
      url: `https://assets.example.com/product-${index + 1}.png?signature=redacted-${index + 1}`,
      mimeType: 'image/png' as const,
      sizeBytes: 1_024,
    }));

    const result = await provider.analyzeProduct(images, {
      runId: '00000000-0000-4000-8000-000000000201',
      batchId: null,
      userId: '00000000-0000-4000-8000-000000000202',
      jobAttempt: 1,
      repairRound: 0,
    });

    expect(create).toHaveBeenCalledTimes(2);
    const [initialRequest, recoveryRequest] = create.mock.calls.map(([request]) => request);
    expect(recoveryRequest).toMatchObject({
      max_output_tokens: 8_000,
      text: { format: {
        name: 'prompt_wizard_product_profile_format_repair',
        schema: initialRequest.text.format.schema,
      } },
    });
    const recoveryText = JSON.stringify(recoveryRequest.input);
    expect(recoveryText.match(/input_image/gu)).toHaveLength(9);
    images.forEach(image => expect(recoveryText).toContain(image.url));
    expect(recoveryText).not.toContain('{invalid');
    expect(recoveryRequest.instructions)
      .toContain('visibleFacts 与 needsConfirmation 只能是原生 JSON 字符串数组');
    expect(recoveryText)
      .toContain('visibleFacts 与 needsConfirmation 必须是原生 JSON 字符串数组');
    expect(recoveryRequest.text.format.schema.properties.visibleFacts.type).toBe('array');
    expect(recoveryRequest.text.format.schema.properties.needsConfirmation.type).toBe('array');
    expect(recorder.beginAttempt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      operation: 'repair-product-format',
      planIndex: null,
      transportAttempt: 1,
      owner: expect.objectContaining({ repairRound: 1 }),
    }));
    expect(result.profile).toEqual(PROFILE);
    expect(result.usage).toMatchObject({
      interactionId: 'interaction-product-format-recovered',
      inputTokens: 33,
      outputTokens: 10,
      requestAttempts: 2,
      serviceTier: 'fast',
    });
  });

  it('首次识别与格式恢复都逐项自检中文门禁，恢复结果单项超限时原样拒绝且不发起第三次调用', async () => {
    const formatRecoveredButLanguageInvalid = {
      ...PROFILE,
      visibleFacts: [
        '黑色外观',
        '包装正面可见白色标签EnglishWords',
      ],
    };
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'interaction-product-language-preflight-first-invalid-json',
        output_text: '{invalid',
        usage: { input_tokens: 15, output_tokens: 3 },
      })
      .mockResolvedValueOnce({
        id: 'interaction-product-language-preflight-recovered-invalid',
        output_text: JSON.stringify(formatRecoveredButLanguageInvalid),
        usage: { input_tokens: 18, output_tokens: 7 },
      });
    const provider = new ArkPromptWizardProvider({ create } as never);

    const error = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]).catch(cause => cause);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map(([request]) => request.text.format.name)).toEqual([
      'prompt_wizard_product_profile',
      'prompt_wizard_product_profile_format_repair',
    ]);
    for (const [request] of create.mock.calls) {
      expect(request.instructions).toContain('剩余拉丁字符数不得超过 max(4, 汉字数)');
      expect(request.instructions).toContain('visibleFacts[i] 与 needsConfirmation[i] 必须逐项单独通过');
      expect(request.instructions).toContain('包装正面有 white label with black text');
      expect(JSON.stringify(request.input)).toContain('输出 JSON 前必须在内部逐字段自检');
      expect(JSON.stringify(request.input)).toContain('剩余拉丁字符数不得超过 max(4, 汉字数)');
      expect(request.text.format.schema.properties.visibleFacts.items.description)
        .toContain('拉丁字符数不得超过 max(4, 汉字数)');
      expect(request.text.format.schema.properties.needsConfirmation.description)
        .toContain('不得跨项合并计数');
    }
    expect(create.mock.calls[1]?.[0]?.instructions)
      .toContain('不得因为本轮重点是 JSON 格式而跳过内容门禁');
    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PRODUCT_REPAIR_FAILED',
      responseId: 'interaction-product-language-preflight-recovered-invalid',
      fieldPaths: ['visibleFacts[1]'],
      errorClassification: 'format-recovery-validation-failed',
      usage: { input_tokens: 33, output_tokens: 10 },
      retryable: false,
    });
    expect(error.cause).toMatchObject({
      repairIssues: [{
        path: 'visibleFacts[1]',
        kind: 'language',
        limit: 10,
        actual: 12,
      }],
    });
  });

  it('首次识别已用一次传输重试后即使返回无效 JSON 也不再发起第三次格式恢复', async () => {
    const originalRetryBaseDelayMs = env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS;
    env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS = 0;
    const create = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('temporary upstream failure'), {
        code: 'upstream_unavailable',
        status: 503,
        httpStatus: 503,
        retryable: true,
        receivedBytes: 0,
        receivedEvent: false,
      }))
      .mockResolvedValueOnce({
        id: 'interaction-invalid-json-after-transport-retry',
        output_text: '{invalid-after-retry',
        usage: { input_tokens: 19, output_tokens: 4 },
      });
    const provider = new ArkPromptWizardProvider({ create } as never);

    try {
      const error = await provider.analyzeProduct([{
        name: 'product.png',
        url: 'https://assets.example.com/product.png?signature=redacted',
        mimeType: 'image/png',
        sizeBytes: 1_024,
      }]).catch(cause => cause);

      expect(error).toMatchObject({
        code: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
        responseId: 'interaction-invalid-json-after-transport-retry',
        providerRequestAttempted: true,
        usage: { input_tokens: null, output_tokens: null },
      });
      expect(create).toHaveBeenCalledTimes(2);
      expect(create.mock.calls.map(([request]) => request.text.format.name)).toEqual([
        'prompt_wizard_product_profile',
        'prompt_wizard_product_profile',
      ]);
    } finally {
      env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS = originalRetryBaseDelayMs;
    }
  });

  it('产品格式恢复仍返回无效 JSON 时直接失败，不发起第三次档案修复', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'interaction-product-invalid-first',
        output_text: '{invalid-first',
        usage: { input_tokens: 15, output_tokens: 3 },
      })
      .mockResolvedValueOnce({
        id: 'interaction-product-invalid-second',
        output_text: '{invalid-second',
        usage: { input_tokens: 17, output_tokens: 4 },
      });
    const provider = new ArkPromptWizardProvider({ create } as never);

    const error = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
      responseId: 'interaction-product-invalid-second',
      usage: { input_tokens: 32, output_tokens: 7 },
      retryable: false,
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('产品格式恢复无损归一化单项数组字符串和缺失空字段，不进入第三次模型调用', async () => {
    const recovered = {
      ...PROFILE,
      visibleFacts: PROFILE.visibleFacts[0],
      needsConfirmation: PROFILE.needsConfirmation[0],
    } as Record<string, unknown>;
    delete recovered.logo;
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'interaction-product-invalid-json',
        output_text: '{invalid',
        usage: { input_tokens: 15, output_tokens: 3 },
      })
      .mockResolvedValueOnce({
        id: 'interaction-product-normalized-profile',
        output_text: JSON.stringify(recovered),
        usage: { input_tokens: 17, output_tokens: 4 },
      });
    const provider = new ArkPromptWizardProvider({ create } as never);

    const result = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]);

    expect(result).toMatchObject({
      profile: {
        logo: '',
        visibleFacts: PROFILE.visibleFacts,
        needsConfirmation: PROFILE.needsConfirmation,
      },
      usage: { inputTokens: 32, outputTokens: 7 },
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('产品格式恢复不猜测数字或对象类型，无法无损归一化时仍直接失败', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'interaction-product-invalid-json-unsafe-shape',
        output_text: '{invalid',
        usage: { input_tokens: 15, output_tokens: 3 },
      })
      .mockResolvedValueOnce({
        id: 'interaction-product-invalid-profile-unsafe-shape',
        output_text: JSON.stringify({ ...PROFILE, visibleFacts: 123 }),
        usage: { input_tokens: 17, output_tokens: 4 },
      });
    const provider = new ArkPromptWizardProvider({ create } as never);

    const error = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PRODUCT_REPAIR_FAILED',
      responseId: 'interaction-product-invalid-profile-unsafe-shape',
      fieldPaths: ['visibleFacts'],
      errorClassification: 'format-recovery-validation-failed',
      usage: { input_tokens: 32, output_tokens: 7 },
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('产品格式恢复真实外呼缺失 usage 时累计 Token 保持未知且不传输重试', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'interaction-product-invalid-json-known-usage',
        output_text: '{invalid',
        usage: { input_tokens: 15, output_tokens: 3 },
      })
      .mockRejectedValueOnce(Object.assign(new Error('format recovery rate limited'), {
        code: 'rate_limit_exceeded',
        status: 429,
        httpStatus: 429,
        retryable: true,
        usage: { input_tokens: null, output_tokens: null },
      }));
    const provider = new ArkPromptWizardProvider({ create } as never);

    const error = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'rate_limit_exceeded',
      providerRequestAttempted: true,
      usage: { input_tokens: null, output_tokens: null },
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('产品格式恢复成功但任一次完成响应缺失 usage 时累计 Token 仍为未知', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'interaction-product-invalid-without-usage',
        output_text: '{invalid',
      })
      .mockResolvedValueOnce({
        id: 'interaction-product-recovered-known-usage',
        output_text: JSON.stringify(PROFILE),
        usage: { input_tokens: 18, output_tokens: 7 },
      });
    const provider = new ArkPromptWizardProvider({ create } as never);

    const result = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]);

    expect(result.usage).toMatchObject({
      interactionId: 'interaction-product-recovered-known-usage',
      inputTokens: null,
      outputTokens: null,
      requestAttempts: 2,
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('产品格式恢复账本 begin 在外呼前失败时保留首次已知用量', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'interaction-product-invalid-before-ledger-failure',
      output_text: '{invalid',
      usage: { input_tokens: 15, output_tokens: 3 },
    });
    const recorder = {
      beginAttempt: vi.fn()
        .mockResolvedValueOnce('attempt-product-analysis')
        .mockRejectedValueOnce(Object.assign(new Error('duplicate'), {
          code: 'PROMPT_WIZARD_PROVIDER_LEDGER_REPLAY',
          retryable: false,
        })),
      completeAttempt: vi.fn().mockResolvedValue(undefined),
    };
    const provider = new ArkPromptWizardProvider({ create } as never, recorder);

    const error = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }], {
      runId: '00000000-0000-4000-8000-000000000221',
      batchId: null,
      userId: '00000000-0000-4000-8000-000000000222',
      jobAttempt: 1,
      repairRound: 0,
    }).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_LEDGER_REPLAY',
      providerRequestAttempted: false,
      usage: { input_tokens: 15, output_tokens: 3 },
    });
    expect(create).toHaveBeenCalledOnce();
    expect(recorder.beginAttempt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      operation: 'repair-product-format',
      planIndex: null,
      owner: expect.objectContaining({ repairRound: 1 }),
    }));
  });

  it('产品无效 JSON 返回时共享预算不足 60 秒则跳过格式恢复', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T00:00:00.000Z'));
    const create = vi.fn().mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-07-24T00:02:01.000Z'));
      return {
        id: 'interaction-product-invalid-after-budget',
        output_text: '{invalid',
        usage: { input_tokens: 15, output_tokens: 3 },
      };
    });
    const provider = new ArkPromptWizardProvider({ create } as never);

    try {
      const error = await provider.analyzeProduct([{
        name: 'product.png',
        url: 'https://assets.example.com/product.png?signature=redacted',
        mimeType: 'image/png',
        sizeBytes: 1_024,
      }]).catch(cause => cause);

      expect(error).toMatchObject({
        code: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
        responseId: 'interaction-product-invalid-after-budget',
        providerRequestAttempted: true,
        usage: { input_tokens: 15, output_tokens: 3 },
      });
      expect(create).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('空响应不会进入产品档案内容修复', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'interaction-empty-output',
      model: 'doubao-seed-2-0-lite-260428',
      output_text: '',
      usage: { input_tokens: 15, output_tokens: 0 },
    });
    const provider = new ArkPromptWizardProvider({ create } as never);

    const error = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_EMPTY',
      responseId: 'interaction-empty-output',
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it('可解析但不是对象的 JSON 不会进入产品档案内容修复', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'interaction-array-output',
      model: 'doubao-seed-2-0-lite-260428',
      output_text: JSON.stringify([]),
      usage: { input_tokens: 15, output_tokens: 1 },
    });
    const provider = new ArkPromptWizardProvider({ create } as never);

    const error = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      responseId: 'interaction-array-output',
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it('Provider 终态错误不会误触发产品档案内容修复', async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error('blocked'), {
      code: 'PROMPT_WIZARD_PROVIDER_CONTENT_FILTER',
      status: 400,
      httpStatus: 400,
      responseId: 'interaction-content-filtered',
      errorClassification: 'content_filter:type:safety_policy',
      retryable: false,
    }));
    const provider = new ArkPromptWizardProvider({ create } as never);

    const error = await provider.analyzeProduct([{
      name: 'product.png',
      url: 'https://assets.example.com/product.png?signature=redacted',
      mimeType: 'image/png',
      sizeBytes: 1_024,
    }]).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_CONTENT_FILTER',
      responseId: 'interaction-content-filtered',
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it.each([429, 503])('初始请求返回 HTTP %i 时只执行传输重试，不进入内容修复', async status => {
    const originalRetryBaseDelayMs = env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS;
    env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS = 0;
    const create = vi.fn().mockRejectedValue(Object.assign(new Error(`HTTP ${status}`), {
      code: status === 429 ? 'rate_limit_exceeded' : 'upstream_unavailable',
      status,
      httpStatus: status,
      retryable: true,
      receivedBytes: 0,
      receivedEvent: false,
    }));
    const provider = new ArkPromptWizardProvider({ create } as never);

    try {
      await provider.analyzeProduct([{
        name: 'product.png',
        url: 'https://assets.example.com/product.png?signature=redacted',
        mimeType: 'image/png',
        sizeBytes: 1_024,
      }]).catch(() => undefined);
    } finally {
      env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS = originalRetryBaseDelayMs;
    }

    expect(create).toHaveBeenCalledTimes(2);
    for (const [request] of create.mock.calls) {
      expect(Array.isArray(request.input)).toBe(true);
      expect(JSON.stringify(request.input)).toContain('input_image');
    }
  });

  it('首次识别耗尽共享预算时跳过修复并返回修复失败', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T00:00:00.000Z'));
    const create = vi.fn().mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-07-24T00:02:01.000Z'));
      return {
        id: 'interaction-invalid-after-budget',
        model: 'doubao-seed-2-0-lite-260428',
        output_text: JSON.stringify({ ...PROFILE, visibleFacts: '不是数组' }),
        usage: { input_tokens: 15, output_tokens: 3 },
      };
    });
    const provider = new ArkPromptWizardProvider({ create } as never);

    try {
      const error = await provider.analyzeProduct([{
        name: 'product.png',
        url: 'https://assets.example.com/product.png?signature=redacted',
        mimeType: 'image/png',
        sizeBytes: 1_024,
      }]).catch(cause => cause);

      expect(error).toMatchObject({
        code: 'PROMPT_WIZARD_PRODUCT_REPAIR_FAILED',
        fieldPaths: ['visibleFacts'],
      });
      expect(create).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('方案响应通过传输但未通过 Zod 时仍保留本次 response ID 与 Token', async () => {
    const create = vi.fn().mockImplementation(request => {
      const planIndex = JSON.parse(request.input as string).planIndex as number;
      return Promise.resolve({
        id: `interaction-schema-${planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: JSON.stringify(planIndex === 1 ? {} : makeProviderWireDraft(planIndex)),
        usage: { input_tokens: 80, output_tokens: 12 },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'invalid-schema-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const error = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    }).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      model: 'doubao-seed-2-0-lite-260428',
      responseId: 'interaction-schema-1',
      usage: { input_tokens: 320, output_tokens: 48 },
      fieldPaths: expect.arrayContaining(['name', 'segments']),
      repairRounds: 2,
      planIndexes: [1],
      retryable: false,
    });
    expect(create).toHaveBeenCalledTimes(4);
  });

  it('初始单索引 segments Schema 失败只进入该索引内容修复', async () => {
    const initialWireDrafts = PROMPT_WIZARD_PLAN_INDEXES.map(makeProviderWireDraft);
    initialWireDrafts[1]!.segments = initialWireDrafts[1]!.segments.slice(0, 3);
    const recorder = {
      beginAttempt: vi.fn()
        .mockImplementation(async (input: {
          operation: string;
          planIndex: number | null;
          owner: { repairRound: number };
        }) => `${input.operation}-${input.planIndex}-${input.owner.repairRound}`),
      completeAttempt: vi.fn().mockResolvedValue(undefined),
    };
    const create = vi.fn().mockImplementation(request => {
      const parsed = JSON.parse(request.input as string) as {
        planIndex: number;
        repairIssue?: {
          errorCode: string;
          fieldPaths: string[];
        };
        formatRecovery?: unknown;
      };
      return Promise.resolve({
        id: `interaction-initial-schema-single-${parsed.planIndex}-${parsed.repairIssue ? 'repair' : 'initial'}`,
        output_text: JSON.stringify(parsed.repairIssue
          ? makeProviderWireDraft(parsed.planIndex)
          : initialWireDrafts[parsed.planIndex]),
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never, recorder);
    const strategies = allocatePromptWizardStrategies({
      runId: 'initial-single-schema-repair-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const result = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
      deadlineAtMs: Date.now() + 240_000,
      costOwner: {
        runId: '00000000-0000-4000-8000-000000000401',
        batchId: '00000000-0000-4000-8000-000000000402',
        userId: '00000000-0000-4000-8000-000000000403',
        jobAttempt: 1,
        repairRound: 0,
      },
    });

    expect(result.repairRounds).toBe(1);
    expect(result.drafts).toEqual(PROMPT_WIZARD_PLAN_INDEXES.map(makeProviderDraft));
    expect(create).toHaveBeenCalledTimes(3);
    const parsedInputs = create.mock.calls.map(([request]) => (
      JSON.parse(request.input as string) as {
        planIndex: number;
        previousDraft?: { segments?: unknown[] };
        repairIssue?: { errorCode: string; fieldPaths: string[] };
        formatRecovery?: unknown;
      }
    ));
    expect(parsedInputs.map(input => input.planIndex)).toEqual([0, 1, 1]);
    expect(parsedInputs[2]).toMatchObject({
      planIndex: 1,
      previousDraft: { segments: expect.arrayContaining([]) },
      repairIssue: {
        errorCode: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
        fieldPaths: ['segments'],
      },
    });
    expect(parsedInputs[2]!.previousDraft!.segments).toHaveLength(3);
    expect(parsedInputs.some(input => input.formatRecovery !== undefined)).toBe(false);
    expect(recorder.beginAttempt.mock.calls.map(([input]) => ({
      operation: input.operation,
      planIndex: input.planIndex,
      repairRound: input.owner.repairRound,
    }))).toEqual([
      { operation: 'generate-drafts', planIndex: 0, repairRound: 0 },
      { operation: 'generate-drafts', planIndex: 1, repairRound: 0 },
      { operation: 'repair-draft-content', planIndex: 1, repairRound: 1 },
    ]);
  });

  it('初始两个索引 segments Schema 失败时分别定向内容修复', async () => {
    const initialWireDrafts = PROMPT_WIZARD_PLAN_INDEXES.map(makeProviderWireDraft);
    initialWireDrafts[0]!.segments = initialWireDrafts[0]!.segments.slice(0, 3);
    initialWireDrafts[1]!.segments = initialWireDrafts[1]!.segments.slice(0, 3);
    const create = vi.fn().mockImplementation(request => {
      const parsed = JSON.parse(request.input as string) as {
        planIndex: number;
        repairIssue?: unknown;
        formatRecovery?: unknown;
      };
      return Promise.resolve({
        id: `interaction-initial-schema-double-${parsed.planIndex}`,
        output_text: JSON.stringify(parsed.repairIssue
          ? makeProviderWireDraft(parsed.planIndex)
          : initialWireDrafts[parsed.planIndex]),
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'initial-double-schema-repair-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const result = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
      deadlineAtMs: Date.now() + 240_000,
    });

    expect(result.repairRounds).toBe(1);
    expect(result.drafts).toEqual(PROMPT_WIZARD_PLAN_INDEXES.map(makeProviderDraft));
    const parsedInputs = create.mock.calls.map(([request]) => (
      JSON.parse(request.input as string) as {
        planIndex: number;
        repairIssue?: { fieldPaths: string[] };
        formatRecovery?: unknown;
      }
    ));
    expect(parsedInputs.map(input => input.planIndex)).toEqual([0, 1, 0, 1]);
    expect(parsedInputs.slice(2)).toEqual([
      expect.objectContaining({
        planIndex: 0,
        repairIssue: expect.objectContaining({ fieldPaths: ['segments'] }),
      }),
      expect.objectContaining({
        planIndex: 1,
        repairIssue: expect.objectContaining({ fieldPaths: ['segments'] }),
      }),
    ]);
    expect(parsedInputs.some(input => input.formatRecovery !== undefined)).toBe(false);
  });

  it('初始 Schema 内容修复最多两轮且合格索引保持字节级不变', async () => {
    const initialWireDrafts = PROMPT_WIZARD_PLAN_INDEXES.map(makeProviderWireDraft);
    initialWireDrafts[1]!.segments = initialWireDrafts[1]!.segments.slice(0, 3);
    let schemaRepairCalls = 0;
    const create = vi.fn().mockImplementation(request => {
      const parsed = JSON.parse(request.input as string) as {
        planIndex: number;
        repairIssue?: unknown;
      };
      if (parsed.repairIssue) schemaRepairCalls += 1;
      return Promise.resolve({
        id: `interaction-initial-schema-two-rounds-${parsed.planIndex}-${schemaRepairCalls}`,
        output_text: JSON.stringify(
          parsed.planIndex === 1 && (!parsed.repairIssue || schemaRepairCalls === 1)
            ? initialWireDrafts[1]
            : makeProviderWireDraft(parsed.planIndex),
        ),
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'initial-schema-two-rounds-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });
    const validZero = makeProviderDraft(0);

    const result = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
      deadlineAtMs: Date.now() + 240_000,
    });

    expect(result.repairRounds).toBe(2);
    expect(create.mock.calls.map(([request]) => (
      JSON.parse(request.input as string).planIndex
    ))).toEqual([0, 1, 1, 1]);
    expect(JSON.stringify(result.drafts[0])).toBe(JSON.stringify(validZero));
  });

  it('单个方案无效 JSON 只定点重生该方案，保留另一结果并累计用量与尝试数', async () => {
    let attemptSequence = 0;
    const recorder = {
      beginAttempt: vi.fn(async (_input: {
        operation: string;
        planIndex: number | null;
        transportAttempt: number;
        owner: { repairRound: number };
      }) => `attempt-${attemptSequence += 1}`),
      completeAttempt: vi.fn().mockResolvedValue(undefined),
    };
    const create = vi.fn().mockImplementation(request => {
      const parsedInput = JSON.parse(request.input as string) as {
        planIndex: number;
        formatRecovery?: unknown;
      };
      const { planIndex } = parsedInput;
      const isFormatRecovery = Boolean(parsedInput.formatRecovery);
      return Promise.resolve({
        id: isFormatRecovery
          ? `interaction-json-recovered-${planIndex}`
          : `interaction-json-initial-${planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: planIndex === 1 && !isFormatRecovery
          ? '{invalid'
          : JSON.stringify(makeProviderWireDraft(planIndex)),
        usage: {
          input_tokens: isFormatRecovery ? 14 : 11 + planIndex,
          output_tokens: isFormatRecovery ? 24 : 21 + planIndex,
        },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never, recorder);
    const strategies = allocatePromptWizardStrategies({
      runId: 'single-invalid-json-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const result = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
      costOwner: {
        runId: '00000000-0000-4000-8000-000000000101',
        batchId: '00000000-0000-4000-8000-000000000102',
        userId: '00000000-0000-4000-8000-000000000103',
        jobAttempt: 2,
        repairRound: 1,
      },
    });

    expect(result.drafts).toEqual([
      makeProviderDraft(0),
      makeProviderDraft(1),
    ]);
    expect(result.usage).toMatchObject({
      inputTokens: 37,
      outputTokens: 67,
      requestAttempts: 3,
    });
    expect(create).toHaveBeenCalledTimes(3);

    const parsedInputs = create.mock.calls.map(([request]) => (
      JSON.parse(request.input as string) as {
        planIndex: number;
        assignedStrategy: unknown;
        formatRecovery?: unknown;
      }
    ));
    expect(parsedInputs.map(input => input.planIndex)).toEqual([0, 1, 1]);
    expect(parsedInputs.slice(0, 2).every(input => input.formatRecovery === undefined)).toBe(true);
    expect(parsedInputs[2]).toMatchObject({
      planIndex: 1,
      assignedStrategy: strategies[1],
      formatRecovery: expect.anything(),
    });
    expect(JSON.stringify(create.mock.calls[2]?.[0].input)).not.toMatch(
      /input_image|assets\.example|\{invalid/u,
    );

    const recoveryLedgerCalls = recorder.beginAttempt.mock.calls
      .map(([input]) => input)
      .filter(input => input.operation === 'repair-draft-format');
    expect(recoveryLedgerCalls).toEqual([expect.objectContaining({
      operation: 'repair-draft-format',
      planIndex: 1,
      transportAttempt: 1,
      owner: expect.objectContaining({ repairRound: 1 }),
    })]);
    expect(recorder.completeAttempt).toHaveBeenCalledTimes(3);
  });

  it('单方案格式重生仍返回无效 JSON 时直接失败，不存在第三次请求', async () => {
    const create = vi.fn().mockImplementation(request => {
      const parsedInput = JSON.parse(request.input as string) as {
        planIndex: number;
        formatRecovery?: unknown;
      };
      return Promise.resolve({
        id: parsedInput.formatRecovery
          ? 'interaction-json-recovery-invalid-1'
          : `interaction-json-initial-${parsedInput.planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: parsedInput.planIndex === 1
          ? '{invalid'
          : JSON.stringify(makeProviderWireDraft(parsedInput.planIndex)),
        usage: { input_tokens: 20, output_tokens: 10 },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'single-invalid-json-recovery-terminal-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const error = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    }).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
      responseId: 'interaction-json-recovery-invalid-1',
      usage: { input_tokens: 60, output_tokens: 30 },
      retryable: false,
    });
    const parsedInputs = create.mock.calls.map(([request]) => (
      JSON.parse(request.input as string) as { planIndex: number; formatRecovery?: unknown }
    ));
    expect(parsedInputs.map(input => input.planIndex)).toEqual([0, 1, 1]);
    expect(parsedInputs.filter(input => input.formatRecovery !== undefined)).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('单方案格式重生遇到 429 时不做传输重试', async () => {
    const create = vi.fn().mockImplementation(request => {
      const parsedInput = JSON.parse(request.input as string) as {
        planIndex: number;
        formatRecovery?: unknown;
      };
      if (parsedInput.planIndex === 1 && parsedInput.formatRecovery) {
        return Promise.reject(Object.assign(new Error('rate limited'), {
          code: 'rate_limit_exceeded',
          status: 429,
          httpStatus: 429,
          retryable: true,
          receivedBytes: 0,
          receivedEvent: false,
        }));
      }
      return Promise.resolve({
        id: `interaction-format-rate-limit-${parsedInput.planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: parsedInput.planIndex === 1
          ? '{invalid'
          : JSON.stringify(makeProviderWireDraft(parsedInput.planIndex)),
        usage: { input_tokens: 20, output_tokens: 10 },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'single-invalid-json-recovery-429-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const error = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    }).catch(cause => cause);

    expect(error).toMatchObject({ code: 'rate_limit_exceeded', httpStatus: 429 });
    const parsedInputs = create.mock.calls.map(([request]) => (
      JSON.parse(request.input as string) as { planIndex: number; formatRecovery?: unknown }
    ));
    expect(parsedInputs.map(input => input.planIndex)).toEqual([0, 1, 1]);
    expect(parsedInputs.filter(input => input.formatRecovery !== undefined)).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('内容修复只并行请求指定索引，每个请求仅携带本方案 previousDraft 与结构化问题', async () => {
    let attemptSequence = 0;
    const recorder = {
      beginAttempt: vi.fn(async (_input: {
        operation: string;
        planIndex: number | null;
        owner: { repairRound: number };
      }) => `attempt-content-${attemptSequence += 1}`),
      completeAttempt: vi.fn().mockResolvedValue(undefined),
    };
    const create = vi.fn().mockImplementation(request => {
      const parsed = JSON.parse(request.input as string) as {
        planIndex: number;
        repairIssue: { planIndex: number };
      };
      return Promise.resolve({
        id: `interaction-content-repaired-${parsed.planIndex}`,
        output_text: JSON.stringify(makeProviderWireDraft(parsed.planIndex)),
        usage: { input_tokens: 10 + parsed.planIndex, output_tokens: 20 + parsed.planIndex },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never, recorder);
    const strategies = allocatePromptWizardStrategies({
      runId: 'indexed-content-repair-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });
    const previousDrafts = PROMPT_WIZARD_PLAN_INDEXES.map(makeProviderDraft);

    const result = await provider.repairDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
      previousDrafts,
      issues: [
        {
          planIndex: 1,
          errorCode: 'PROMPT_WIZARD_DIVERSITY_FAILED',
          fieldPaths: ['hook', 'primaryScene', 'segments[0].action'],
          action: '与方案一过于相似，只调整当前方案的场景和镜头节奏',
        },
        {
          planIndex: 0,
          errorCode: 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
          fieldPaths: ['name'],
          action: '只把名称改为简体中文',
        },
      ],
      costOwner: {
        runId: '00000000-0000-4000-8000-000000000301',
        batchId: '00000000-0000-4000-8000-000000000302',
        userId: '00000000-0000-4000-8000-000000000303',
        jobAttempt: 1,
        repairRound: 2,
      },
    });

    expect(result.drafts).toEqual([
      { planIndex: 0, draft: makeProviderDraft(0) },
      { planIndex: 1, draft: makeProviderDraft(1) },
    ]);
    expect(result.usage).toMatchObject({
      inputTokens: 21,
      outputTokens: 41,
      requestAttempts: 2,
    });
    expect(create).toHaveBeenCalledTimes(2);
    const parsedInputs = create.mock.calls.map(([request]) => (
      JSON.parse(request.input as string) as {
        planIndex: number;
        previousDraft: { name: string };
        repairIssue: { planIndex: number; errorCode: string; fieldPaths: string[]; action: string };
      }
    ));
    expect(parsedInputs.map(input => input.planIndex)).toEqual([0, 1]);
    expect(parsedInputs[0]).toMatchObject({
      previousDraft: { name: '方案 1' },
      repairIssue: {
        planIndex: 0,
        errorCode: 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
        fieldPaths: ['name'],
      },
    });
    expect(parsedInputs[1]).toMatchObject({
      previousDraft: { name: '方案 2' },
      repairIssue: {
        planIndex: 1,
        errorCode: 'PROMPT_WIZARD_DIVERSITY_FAILED',
        fieldPaths: ['hook', 'primaryScene', 'segments[0].action'],
      },
    });
    expect(JSON.stringify(parsedInputs[0])).not.toContain('方案 2');
    expect(JSON.stringify(parsedInputs[1])).not.toContain('方案 1');
    expect(recorder.beginAttempt.mock.calls.map(([input]) => ({
      operation: input.operation,
      planIndex: input.planIndex,
      repairRound: input.owner.repairRound,
    }))).toEqual([
      { operation: 'repair-draft-content', planIndex: 0, repairRound: 2 },
      { operation: 'repair-draft-content', planIndex: 1, repairRound: 2 },
    ]);
  });

  it('refine-plan 只请求单个索引，携带用户动作与目标场景并按 refine-plan 记账', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'interaction-refine-plan-1',
      model: 'doubao-seed-2-0-lite-260428',
      output_text: JSON.stringify(makeProviderWireDraft(1)),
      usage: { input_tokens: 18, output_tokens: 28 },
    });
    const recorder = {
      beginAttempt: vi.fn().mockResolvedValue('attempt-refine-plan'),
      completeAttempt: vi.fn().mockResolvedValue(undefined),
    };
    const provider = new ArkPromptWizardProvider({ create } as never, recorder);
    const strategies = allocatePromptWizardStrategies({
      runId: 'single-plan-refinement-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });
    const issue = {
      planIndex: 1 as const,
      errorCode: 'PROMPT_WIZARD_PLAN_REFINEMENT',
      fieldPaths: [
        'primaryScene',
        'segments[0].location',
        'segments[1].location',
      ],
      action: 'change-scene；目标场景：用户现有的厨房台面',
    };

    const result = await provider.repairDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
      previousDrafts: PROMPT_WIZARD_PLAN_INDEXES.map(makeProviderDraft),
      issues: [issue],
      operation: 'refine-plan',
      costOwner: {
        runId: '00000000-0000-4000-8000-000000000321',
        batchId: '00000000-0000-4000-8000-000000000322',
        userId: '00000000-0000-4000-8000-000000000323',
        jobAttempt: 1,
        repairRound: 0,
      },
    });

    expect(result.drafts).toEqual([{ planIndex: 1, draft: makeProviderDraft(1) }]);
    expect(create).toHaveBeenCalledOnce();
    const request = create.mock.calls[0]?.[0];
    expect(request.instructions).toContain('用户主动发起的一次单方案定向微调');
    expect(request.text.format.name).toBe('prompt_wizard_plan_2_refinement');
    const payload = JSON.parse(request.input as string);
    expect(payload).toMatchObject({
      planIndex: 1,
      previousDraft: { name: '方案 2' },
      refinement: {
        planIndex: 1,
        action: issue.action,
        editableFields: issue.fieldPaths,
      },
    });
    expect(JSON.stringify(payload)).not.toContain('方案 1');
    expect(recorder.beginAttempt).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'refine-plan',
      planIndex: 1,
    }));
  });

  it('refine-plan 拒绝多索引，且 Fake Provider 只改指定方案', async () => {
    const strategies = allocatePromptWizardStrategies({
      runId: 'fake-single-plan-refinement-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });
    const previousDrafts = PROMPT_WIZARD_PLAN_INDEXES.map(makeProviderDraft);
    const base = {
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
      previousDrafts,
      operation: 'refine-plan' as const,
    };
    const provider = new FakePromptWizardProvider();

    await expect(provider.repairDrafts({
      ...base,
      issues: [
        {
          planIndex: 0,
          errorCode: 'PROMPT_WIZARD_PLAN_REFINEMENT',
          fieldPaths: ['hook'],
          action: '钩子更强',
        },
        {
          planIndex: 1,
          errorCode: 'PROMPT_WIZARD_PLAN_REFINEMENT',
          fieldPaths: ['hook'],
          action: '钩子更强',
        },
      ],
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_INPUT_INVALID' });

    const result = await provider.repairDrafts({
      ...base,
      issues: [{
        planIndex: 1,
        errorCode: 'PROMPT_WIZARD_PLAN_REFINEMENT',
        fieldPaths: ['primaryScene', 'segments[0].location'],
        action: 'change-scene；目标场景：用户现有的厨房台面',
      }],
    });
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.planIndex).toBe(1);
    expect(result.drafts[0]?.draft.primaryScene).toBe('用户现有的厨房台面');
    expect(result.drafts[0]?.draft.segments.every(segment => (
      segment.location === '用户现有的厨房台面'
    ))).toBe(true);
    expect(previousDrafts[0]).toEqual(makeProviderDraft(0));
  });

  it('单方案内容修复返回无效 JSON 时只对该索引执行一次格式恢复', async () => {
    const create = vi.fn().mockImplementation(request => {
      const parsed = JSON.parse(request.input as string) as {
        planIndex: number;
        formatRecovery?: unknown;
      };
      return Promise.resolve({
        id: parsed.formatRecovery
          ? 'interaction-content-format-recovered-1'
          : 'interaction-content-invalid-json-1',
        output_text: parsed.formatRecovery
          ? JSON.stringify(makeProviderWireDraft(1))
          : '{invalid-content-repair',
        usage: { input_tokens: parsed.formatRecovery ? 14 : 11, output_tokens: parsed.formatRecovery ? 24 : 3 },
      });
    });
    const recorder = {
      beginAttempt: vi.fn()
        .mockResolvedValueOnce('attempt-content')
        .mockResolvedValueOnce('attempt-content-format'),
      completeAttempt: vi.fn().mockResolvedValue(undefined),
    };
    const provider = new ArkPromptWizardProvider({ create } as never, recorder);
    const strategies = allocatePromptWizardStrategies({
      runId: 'content-format-recovery-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const result = await provider.repairDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
      previousDrafts: PROMPT_WIZARD_PLAN_INDEXES.map(makeProviderDraft),
      issues: [{
        planIndex: 1,
        errorCode: 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
        fieldPaths: ['segments[1].action'],
        action: '只把画面动作改为简体中文',
      }],
      costOwner: {
        runId: '00000000-0000-4000-8000-000000000311',
        batchId: '00000000-0000-4000-8000-000000000312',
        userId: '00000000-0000-4000-8000-000000000313',
        jobAttempt: 1,
        repairRound: 1,
      },
    });

    expect(result.drafts).toEqual([{ planIndex: 1, draft: makeProviderDraft(1) }]);
    expect(result.usage).toMatchObject({
      inputTokens: 25,
      outputTokens: 27,
      requestAttempts: 2,
    });
    expect(create).toHaveBeenCalledTimes(2);
    const recoveryInput = JSON.parse(create.mock.calls[1]?.[0].input as string);
    expect(recoveryInput).toMatchObject({
      planIndex: 1,
      previousDraft: { name: '方案 2' },
      repairIssue: {
        planIndex: 1,
        errorCode: 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
        fieldPaths: ['segments[1].action'],
      },
      formatRecovery: expect.anything(),
    });
    expect(JSON.stringify(recoveryInput)).not.toContain('{invalid-content-repair');
    expect(recorder.beginAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      operation: 'repair-draft-content',
      planIndex: 1,
    }));
    expect(recorder.beginAttempt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      operation: 'repair-draft-format',
      planIndex: 1,
    }));
  });

  it('内容修复索引必须唯一且所有错误都不得省略字段路径', async () => {
    const create = vi.fn();
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'invalid-content-repair-input-test',
      ordinal: 1,
      previousSignatures: [],
    });
    const base = {
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
      previousDrafts: PROMPT_WIZARD_PLAN_INDEXES.map(makeProviderDraft),
    };

    await expect(provider.repairDrafts({
      ...base,
      issues: [
        { planIndex: 1, errorCode: 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID', fieldPaths: ['name'], action: '修复名称' },
        { planIndex: 1, errorCode: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM', fieldPaths: ['hook'], action: '删除主张' },
      ],
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_INPUT_INVALID' });
    await expect(provider.repairDrafts({
      ...base,
      issues: [{
        planIndex: 0,
        errorCode: 'PROMPT_WIZARD_DIVERSITY_FAILED',
        fieldPaths: [],
        action: '修复差异',
      }],
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_INPUT_INVALID' });
    await expect(provider.repairDrafts({
      ...base,
      issues: [{
        planIndex: 0,
        errorCode: 'PROMPT_WIZARD_CONTENT_REPAIR_REQUIRED',
        fieldPaths: Array.from({ length: 25 }, () => 'segments[0].action'),
        action: '修复过多字段',
      }],
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_INPUT_INVALID' });
    await expect(provider.repairDrafts({
      ...base,
      issues: [{
        planIndex: 0,
        errorCode: 'PROMPT_WIZARD_REFERENCE_INVALID',
        fieldPaths: ['prompt'],
        action: '错误地尝试改写最终生产稿',
      }],
    })).rejects.toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_INPUT_INVALID' });
    expect(create).not.toHaveBeenCalled();
  });

  it('时间轴修复接受 segments 根路径并真实发送给单方案 Provider', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'interaction-timeline-root-repair',
      output_text: JSON.stringify(makeProviderWireDraft(1)),
      usage: { input_tokens: 12, output_tokens: 8 },
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'timeline-root-repair-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const result = await provider.repairDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
      previousDrafts: PROMPT_WIZARD_PLAN_INDEXES.map(makeProviderDraft),
      issues: [{
        planIndex: 1,
        errorCode: 'PROMPT_WIZARD_TIMELINE_INVALID',
        fieldPaths: ['segments'],
        action: '严格按固定时间轴补齐镜头',
      }],
    });

    expect(result.drafts).toEqual([{ planIndex: 1, draft: makeProviderDraft(1) }]);
    expect(create).toHaveBeenCalledOnce();
    const payload = JSON.parse(create.mock.calls[0]?.[0]?.input as string) as {
      repairIssue: { fieldPaths: string[] };
      repairPolicy: string[];
    };
    expect(payload.repairIssue.fieldPaths).toEqual(['segments']);
    expect(payload.repairPolicy.join('\n')).toContain('segments 数组内部增删或压缩镜头');
  });

  it('内容修复输入构造器不会序列化其他方案或全局反馈', () => {
    const strategies = allocatePromptWizardStrategies({
      runId: 'content-repair-input-builder-test',
      ordinal: 1,
      previousSignatures: [],
    });
    const serialized = buildPromptWizardDraftContentRepairInput({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
      previousDrafts: PROMPT_WIZARD_PLAN_INDEXES.map(makeProviderDraft),
      issues: [{
        planIndex: 1,
        errorCode: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
        fieldPaths: ['name'],
        action: '替换为安全中性标题',
      }],
    }, {
      planIndex: 1,
      errorCode: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
      fieldPaths: ['name'],
      action: '替换为安全中性标题',
    });

    const parsed = JSON.parse(serialized);
    expect(parsed).toMatchObject({
      planIndex: 1,
      previousDraft: { name: '方案 2' },
      repairIssue: {
        planIndex: 1,
        errorCode: 'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
        fieldPaths: ['name'],
      },
    });
    expect(serialized).not.toContain('repairFeedback');
    expect(serialized).not.toContain('方案 1');
    expect(serialized).not.toContain('方案 3');
  });

  it.each([
    {
      caseName: '空响应',
      expectedCode: 'PROMPT_WIZARD_PROVIDER_EMPTY',
      response: () => ({
        id: 'interaction-draft-empty',
        model: 'doubao-seed-2-0-lite-260428',
        output_text: '',
        usage: { input_tokens: 20, output_tokens: 0 },
      }),
      expectedFailedPlanAttempts: 1,
    },
    {
      caseName: 'Schema 不合格',
      expectedCode: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      response: () => ({
        id: 'interaction-draft-schema-invalid',
        model: 'doubao-seed-2-0-lite-260428',
        output_text: JSON.stringify({}),
        usage: { input_tokens: 20, output_tokens: 2 },
      }),
      expectedFailedPlanAttempts: 3,
    },
    {
      caseName: '不完整响应',
      expectedCode: 'PROMPT_WIZARD_PROVIDER_RESPONSE_INCOMPLETE',
      response: () => Promise.reject(Object.assign(new Error('incomplete'), {
        code: 'PROMPT_WIZARD_PROVIDER_RESPONSE_INCOMPLETE',
        responseId: 'interaction-draft-incomplete',
        retryable: false,
        receivedEvent: true,
        usage: { input_tokens: 20, output_tokens: 2 },
      })),
      expectedFailedPlanAttempts: 1,
    },
    {
      caseName: '绝对超时',
      expectedCode: 'PROMPT_WIZARD_PROVIDER_TIMEOUT',
      response: () => Promise.reject(Object.assign(new Error('timeout'), {
        name: 'RequestTimeoutError',
        code: 'PROMPT_WIZARD_PROVIDER_TIMEOUT',
        retryable: false,
      })),
      expectedFailedPlanAttempts: 1,
    },
    {
      caseName: 'HTTP 429',
      expectedCode: 'rate_limit_exceeded',
      response: () => Promise.reject(Object.assign(new Error('rate limited'), {
        code: 'rate_limit_exceeded',
        status: 429,
        httpStatus: 429,
        retryable: true,
        receivedBytes: 0,
        receivedEvent: false,
      })),
      expectedFailedPlanAttempts: 2,
    },
    {
      caseName: 'HTTP 5xx',
      expectedCode: 'upstream_unavailable',
      response: () => Promise.reject(Object.assign(new Error('unavailable'), {
        code: 'upstream_unavailable',
        status: 503,
        httpStatus: 503,
        retryable: true,
        receivedBytes: 0,
        receivedEvent: false,
      })),
      expectedFailedPlanAttempts: 2,
    },
  ])('$caseName 不进入单方案格式重生', async ({
    expectedCode,
    response,
    expectedFailedPlanAttempts,
  }) => {
    const originalRetryBaseDelayMs = env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS;
    env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS = 0;
    const create = vi.fn().mockImplementation(request => {
      const parsedInput = JSON.parse(request.input as string) as {
        planIndex: number;
        formatRecovery?: unknown;
      };
      if (parsedInput.planIndex === 1) return response();
      return Promise.resolve({
        id: `interaction-non-format-failure-${parsedInput.planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: JSON.stringify(makeProviderWireDraft(parsedInput.planIndex)),
        usage: { input_tokens: 20, output_tokens: 10 },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: `non-format-recovery-${expectedCode}`,
      ordinal: 1,
      previousSignatures: [],
    });

    try {
      const error = await provider.generateDrafts({
        profile: PROFILE,
        brief: BRIEF,
        config: CONFIG,
        strategies,
        ...makeProviderV4Context(strategies),
        imageCount: 1,
        variationKey: 1,
      }).catch(cause => cause);

      expect(error).toMatchObject({ code: expectedCode });
      const parsedInputs = create.mock.calls.map(([request]) => (
        JSON.parse(request.input as string) as { planIndex: number; formatRecovery?: unknown }
      ));
      expect(parsedInputs.filter(input => input.planIndex === 1)).toHaveLength(
        expectedFailedPlanAttempts,
      );
      expect(parsedInputs.every(input => input.formatRecovery === undefined)).toBe(true);
      expect(create).toHaveBeenCalledTimes(1 + expectedFailedPlanAttempts);
    } finally {
      env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS = originalRetryBaseDelayMs;
    }
  });

  it('并行结果同时存在无效 JSON 和可修复 Schema 错误时只定点恢复无效 JSON', async () => {
    const create = vi.fn().mockImplementation(request => {
      const { planIndex } = JSON.parse(request.input as string) as { planIndex: number };
      return Promise.resolve({
        id: `interaction-mixed-failure-${planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: planIndex === 0
          ? '{invalid'
          : JSON.stringify(planIndex === 1 ? {} : makeProviderWireDraft(planIndex)),
        usage: { input_tokens: 20, output_tokens: 10 },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'mixed-plan-failures-no-format-recovery',
      ordinal: 1,
      previousSignatures: [],
    });

    await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    }).catch(() => undefined);

    expect(create).toHaveBeenCalledTimes(3);
    const parsedInputs = create.mock.calls.map(([request]) => (
      JSON.parse(request.input as string) as {
        planIndex: number;
        formatRecovery?: unknown;
        repairIssue?: unknown;
      }
    ));
    expect(parsedInputs.filter(input => input.formatRecovery !== undefined)).toEqual([
      expect.objectContaining({ planIndex: 0 }),
    ]);
    expect(parsedInputs.every(input => input.repairIssue === undefined)).toBe(true);
  });

  it('格式重生前共享截止时间不足 60 秒时直接失败，不追加请求', async () => {
    const create = vi.fn().mockImplementation(request => {
      const { planIndex } = JSON.parse(request.input as string) as { planIndex: number };
      return Promise.resolve({
        id: `interaction-format-budget-${planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: planIndex === 1 ? '{invalid' : JSON.stringify(makeProviderWireDraft(planIndex)),
        usage: { input_tokens: 20, output_tokens: 10 },
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'single-invalid-json-insufficient-budget-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const error = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
      deadlineAtMs: Date.now() + 59_999,
    }).catch(cause => cause);

    expect(error).toMatchObject({ code: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON' });
    expect(create).toHaveBeenCalledTimes(PROMPT_WIZARD_PLAN_COUNT);
  });

  it('原生嵌套字段可安全承载英文双引号、反斜杠和换行', async () => {
    const nestedPlan = makeProviderWireDraft(0);
    nestedPlan.name = '  方案 1  ';
    nestedPlan.planningReview.realPainPoint = '用户说："旧方案不够真实"\n需要保留 C:\\video 路径语义';
    nestedPlan.segments[0]!.action = '镜头展示 "MEXICO" Logo\n并沿 C:\\shots 路径移动';
    nestedPlan.segments[0]!.voiceover = 'He said: "Try it"\\now';
    nestedPlan.segments[0]!.productionNote = '保留换行\n以及反斜杠 \\';
    const create = vi.fn().mockImplementation(request => {
      const planIndex = JSON.parse(request.input as string).planIndex as number;
      return Promise.resolve({
        id: `interaction-native-nested-json-${planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: JSON.stringify(planIndex === 0 ? nestedPlan : makeProviderWireDraft(planIndex)),
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'native-nested-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const result = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    });
    expect(result.drafts[0]!.planningReview).toMatchObject({
      realPainPoint: '用户说："旧方案不够真实"\n需要保留 C:\\video 路径语义',
    });
    expect(result.drafts[0]!.name).toBe('方案 1');
    expect(result.drafts[0]!.segments[0]).toMatchObject({
      action: '镜头展示 "MEXICO" Logo\n并沿 C:\\shots 路径移动',
      voiceover: 'He said: "Try it"\\now',
      productionNote: '保留换行\n以及反斜杠 \\',
    });
    expect(create).toHaveBeenCalledTimes(PROMPT_WIZARD_PLAN_COUNT);
  });

  it('原生嵌套对象含未知键时被严格拒绝', async () => {
    const planWithUnknownKeys = makeProviderWireDraft(0);
    (planWithUnknownKeys.planningReview as Record<string, unknown>).unexpected = '禁止未知字段';
    const create = vi.fn().mockImplementation(request => {
      const planIndex = JSON.parse(request.input as string).planIndex as number;
      return Promise.resolve({
        id: `interaction-nested-unknown-keys-${planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: JSON.stringify(planIndex === 0 ? planWithUnknownKeys : makeProviderWireDraft(planIndex)),
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'nested-unknown-keys-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const error = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    }).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      responseId: 'interaction-nested-unknown-keys-0',
      fieldPaths: ['planningReview'],
    });
  });

  it('原生嵌套对象缺少必填字段时被严格拒绝', async () => {
    const incompletePlan = makeProviderWireDraft(0);
    delete (incompletePlan.segments[0] as Partial<typeof incompletePlan.segments[0]>).action;
    const create = vi.fn().mockImplementation(request => {
      const planIndex = JSON.parse(request.input as string).planIndex as number;
      return Promise.resolve({
        id: `interaction-incomplete-nested-fields-${planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: JSON.stringify(planIndex === 0 ? incompletePlan : makeProviderWireDraft(planIndex)),
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'incomplete-nested-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const error = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    }).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      responseId: 'interaction-incomplete-nested-fields-0',
      fieldPaths: ['segments[0].action'],
    });
  });

  it('原生嵌套字段类型错误或生成数组超过上限时被严格拒绝', async () => {
    const invalidPlans = [makeProviderWireDraft(0), makeProviderWireDraft(1)];
    (invalidPlans[0]!.segments[0] as { voiceover: unknown }).voiceover = 123;
    invalidPlans[1]!.productionWarnings = Array.from({ length: 9 }, (_, index) => `提醒 ${index + 1}`);
    const create = vi.fn().mockImplementation(request => {
      const planIndex = JSON.parse(request.input as string).planIndex as number;
      return Promise.resolve({
        id: `interaction-invalid-nested-types-and-limits-${planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: JSON.stringify(invalidPlans[planIndex]),
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'invalid-nested-types-and-limits-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const error = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    }).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      responseId: 'interaction-invalid-nested-types-and-limits-0',
      fieldPaths: ['segments[0].voiceover'],
    });
  });

  it('超长生成字段不会被静默截断，并返回精确字段路径', async () => {
    const invalidPlan = makeProviderWireDraft(0);
    invalidPlan.segments[0]!.action = '动作'.repeat(151);
    const create = vi.fn().mockImplementation(request => {
      const planIndex = JSON.parse(request.input as string).planIndex as number;
      return Promise.resolve({
        id: `interaction-overlong-fact-${planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: JSON.stringify(planIndex === 0 ? invalidPlan : makeProviderWireDraft(planIndex)),
      });
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const strategies = allocatePromptWizardStrategies({
      runId: 'overlong-fact-provider-test',
      ordinal: 1,
      previousSignatures: [],
    });

    const error = await provider.generateDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    }).catch(cause => cause);

    expect(error).toMatchObject({
      code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      responseId: 'interaction-overlong-fact-0',
      fieldPaths: ['segments[0].action'],
    });
    expect(create).toHaveBeenCalledTimes(4);
  });

  it('图文分析使用 Responses message，并固定图片 detail=high', () => {
    const input = buildPromptWizardProductAnalysisInput([
      {
        name: 'product-front.png',
        url: 'https://assets.example.com/product-front.png?signature=redacted',
        mimeType: 'image/png',
        sizeBytes: 1_024,
      },
      {
        name: 'product-side.webp',
        url: 'https://assets.example.com/product-side.webp?signature=redacted',
        mimeType: 'image/webp',
        sizeBytes: 1_024,
      },
    ]);

    expect(input).toEqual([{
      type: 'message',
      role: 'user',
      content: [
        expect.objectContaining({
          type: 'input_text',
          text: expect.stringContaining('product-front.png、product-side.webp'),
        }),
        {
          type: 'input_image',
          image_url: 'https://assets.example.com/product-front.png?signature=redacted',
          detail: 'high',
        },
        {
          type: 'input_image',
          image_url: 'https://assets.example.com/product-side.webp?signature=redacted',
          detail: 'high',
        },
      ],
    }]);
    expect(input.map(step => step.type)).toEqual(['message']);
  });

  it('图片输入限制 1–9 张、格式、单图 10 MiB 和已知总计 64 MiB', () => {
    expect(() => validatePromptWizardImages([])).toThrow(/1–9/);
    expect(() => validatePromptWizardImages([{
      name: 'bad.gif',
      url: 'https://assets.example.com/bad.gif',
      mimeType: 'image/gif' as never,
      sizeBytes: 1_024,
    }])).toThrow(/格式/);
    expect(() => validatePromptWizardImages([{
      name: 'large.png',
      url: 'https://assets.example.com/large.png',
      mimeType: 'image/png',
      sizeBytes: 10 * 1024 * 1024 + 1,
    }])).toThrow(/10 MiB/);
    expect(() => validatePromptWizardImages(Array.from({ length: 7 }, (_, index) => ({
      name: `${index}.png`,
      url: `https://assets.example.com/${index}.png`,
      mimeType: 'image/png' as const,
      sizeBytes: 10 * 1024 * 1024,
    })))).toThrow(/64 MiB/);
  });

  it('方案生成使用纯字符串输入，不再发送顶层 text Content 数组', () => {
    const strategies = allocatePromptWizardStrategies({
      runId: 'provider-wire-input',
      ordinal: 0,
      previousSignatures: [],
    });
    const v4Context = makeProviderV4Context(strategies);
    const input = buildPromptWizardDraftInput({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...v4Context,
      imageCount: 2,
      variationKey: 7,
    }, 4, 1);

    expect(typeof input).toBe('string');
    const parsedInput = JSON.parse(input);
    expect(parsedInput).toMatchObject({
      task: '生成一套逻辑完整的短视频结构化脚本',
      planIndex: 1,
      languagePolicy: {
        simplifiedChineseFields: expect.arrayContaining([
          'name',
          'differenceTags[]',
          'planningReview.targetAudience',
          'segments[].action',
          'segments[].foley',
        ]),
        targetLanguageFields: ['segments[].voiceover'],
        simplifiedChineseTranslationFields: ['segments[].voiceoverZh'],
        rules: expect.arrayContaining([
          expect.stringContaining('targetLanguage 只能用于 voiceover'),
          expect.stringContaining('所有镜头画面组成字段必须使用简体中文'),
          expect.stringContaining('不生成、不建议任何后期画面文字'),
        ]),
      },
      claimPolicy: {
        authoritativeSource: 'allowedCommercialClaims',
        allowedCommercialClaims: [],
        rules: expect.arrayContaining([
          expect.stringContaining('唯一可用于商业宣称的授权来源'),
          expect.stringContaining('只能逐字精确复用'),
          expect.stringContaining('禁止所有数值、比例、认证、性能、功效、成分或绝对化保证'),
          expect.stringContaining('可见原文仅允许原样保留品牌、型号、Logo 与印花文字'),
        ]),
      },
      assignedEvidence: {
        proofPoints: ['可折叠头梁与椭圆耳罩'],
        shots: [
          { role: 'hook', facts: [] },
          { role: 'proof', facts: [{ id: 'profile:structure', text: '可折叠头梁与椭圆耳罩' }] },
          { role: 'resolution', facts: [{ id: 'profile:structure', text: '可折叠头梁与椭圆耳罩' }] },
          { role: 'cta', facts: [] },
        ],
      },
      creativeBrief: BRIEF,
      directionBlueprint: expect.objectContaining({
        direction: 'ugc',
        label: '真实 UGC',
        routeGuidance: expect.any(Array),
        beatGuidance: expect.objectContaining({
          hook: expect.any(String),
          proof: expect.any(String),
        }),
      }),
      fixedVideoConfig: CONFIG,
      imageReferences: ['@图片1', '@图片2'],
      assignedStrategy: strategies[1],
      variationKey: 7,
      requiredSegmentCount: 4,
      requiredShotRoles: ['hook', 'proof', 'resolution', 'cta'],
      requiredBeats: [
        { role: 'hook', instruction: expect.any(String) },
        { role: 'proof', instruction: expect.any(String) },
        { role: 'resolution', instruction: expect.any(String) },
        { role: 'cta', instruction: expect.any(String) },
      ],
      structuredOutputPolicy: {
        mode: 'native-json',
        rules: expect.arrayContaining([
          expect.stringContaining('原生 JSON'),
          expect.stringContaining('直接返回原生 JSON 数组'),
          expect.stringContaining('不得省略 required 字段'),
        ]),
      },
      fieldLengthLimits: expect.objectContaining({
        name: 80,
        hook: 300,
        segment: expect.objectContaining({ action: 300, voiceover: 300 }),
      }),
      arrayLimits: expect.objectContaining({ segments: 4 }),
    });
    expect(parsedInput.product).not.toHaveProperty('needsConfirmation');
    const serializedInput = JSON.stringify(parsedInput);
    expect(serializedInput).not.toContain('assignedStrategies');
    expect(serializedInput).not.toContain('repairFeedback');
    expect(serializedInput).not.toContain('previousDraft');
    expect(serializedInput).not.toContain('previousDrafts');
    expect(serializedInput).not.toContain('alternativeHooks');
    expect(serializedInput).not.toContain('onScreenText');
    expect(serializedInput).not.toContain('evidenceCatalog');
    expect(serializedInput).not.toContain('evidenceRefs');
  });

  it('首轮双方案请求只携带当前入选概念及其锁定证据', async () => {
    const selection = makePromptWizardV4Selection({
      runId: 'provider-concept-isolation',
      ordinal: 1,
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
    });
    const create = vi.fn().mockImplementation(async (request: { input: string }) => {
      const payload = JSON.parse(request.input) as { planIndex: 0 | 1 };
      return {
        id: `response-concept-${payload.planIndex}`,
        model: 'doubao-seed-2-0-lite-260428',
        output_text: JSON.stringify(makeProviderWireDraft(payload.planIndex)),
        usage: { input_tokens: 20, output_tokens: 10 },
      };
    });
    const provider = new ArkPromptWizardProvider({ create } as never);

    await provider.generateDrafts({
      profile: PROFILE,
      evidenceGraph: selection.evidenceGraph,
      brief: BRIEF,
      config: CONFIG,
      strategies: selection.strategies,
      conceptAssignments: selection.conceptAssignments,
      imageCount: 1,
      variationKey: 1,
    });

    expect(create).toHaveBeenCalledTimes(PROMPT_WIZARD_PLAN_COUNT);
    const requestsByPlan = new Map(create.mock.calls.map(([request]) => {
      const payload = JSON.parse(request.input as string) as {
        planIndex: 0 | 1 | 2;
        assignedConcept: {
          openingAction: string;
          scene: string;
          progression: string;
          evidenceIds: string[];
        };
        assignedEvidence: {
          shots: Array<{ facts: Array<{ id: string }> }>;
        };
      };
      return [payload.planIndex, { payload, serialized: JSON.stringify(payload) }] as const;
    }));

    for (const assignment of selection.conceptAssignments) {
      const current = requestsByPlan.get(assignment.planIndex)!;
      const other = selection.conceptAssignments.find(item => item.planIndex !== assignment.planIndex)!;
      expect(current.payload.assignedConcept).toMatchObject({
        openingAction: assignment.openingAction,
        scene: assignment.scene,
        progression: assignment.progression,
        evidenceIds: assignment.evidenceIds,
      });
      expect(current.payload.assignedConcept).not.toHaveProperty('id');
      expect(current.payload.assignedConcept).not.toHaveProperty('candidateId');
      expect(current.payload.assignedConcept).not.toHaveProperty('score');
      expect(current.serialized).not.toContain(other.candidateId);
      expect(current.serialized).not.toContain('"candidates"');
      expect(current.serialized).not.toContain('"eligibleCandidates"');
      expect(current.serialized).not.toContain('"rejectionReasons"');
      expect(current.serialized).not.toContain('"score"');
      for (const concept of selection.conceptPreviews) {
        expect(current.serialized).not.toContain(concept.id);
      }

      const assignedEvidenceIds = current.payload.assignedEvidence.shots
        .flatMap(shot => shot.facts.map(fact => fact.id));
      expect([...new Set(assignedEvidenceIds)].sort()).toEqual(
        [...assignment.evidenceIds].sort(),
      );
    }
  });

  it('格式修复与内容修复保持原方案的入选概念投影和 evidenceIds', () => {
    const selection = makePromptWizardV4Selection({
      runId: 'provider-concept-repair-stability',
      ordinal: 2,
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
    });
    const base = {
      profile: PROFILE,
      evidenceGraph: selection.evidenceGraph,
      brief: BRIEF,
      config: CONFIG,
      strategies: selection.strategies,
      conceptAssignments: selection.conceptAssignments,
      imageCount: 1,
      variationKey: 2,
    };

    for (const assignment of selection.conceptAssignments) {
      const issue = {
        planIndex: assignment.planIndex,
        errorCode: 'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
        fieldPaths: ['segments[0].action'],
        action: '只修复当前方案的首镜头动作语言',
      };
      const initial = JSON.parse(buildPromptWizardDraftInput(
        base,
        4,
        assignment.planIndex,
      ));
      const formatRepair = JSON.parse(buildPromptWizardDraftFormatRepairInput(
        base,
        4,
        assignment.planIndex,
      ));
      const contentRepair = JSON.parse(buildPromptWizardDraftContentRepairInput({
        ...base,
        previousDrafts: PROMPT_WIZARD_PLAN_INDEXES.map(makeProviderDraft),
        issues: [issue],
      }, issue, 4));

      for (const payload of [initial, formatRepair, contentRepair]) {
        expect(payload.assignedConcept).toEqual(initial.assignedConcept);
        expect(payload.assignedConcept).toMatchObject({
          openingAction: assignment.openingAction,
          scene: assignment.scene,
          progression: assignment.progression,
          evidenceIds: assignment.evidenceIds,
        });
        expect(payload.assignedConcept).not.toHaveProperty('candidateId');
        expect(JSON.stringify(payload)).not.toContain(assignment.candidateId);
        expect(payload.assignedEvidence).toEqual(initial.assignedEvidence);
      }
    }
  });

  it('Fake Provider 消费入选 assignment 的开场、场景和证据', async () => {
    const selection = makePromptWizardV4Selection({
      runId: 'fake-provider-assigned-concepts',
      ordinal: 3,
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
    });
    const result = await new FakePromptWizardProvider().generateDrafts({
      profile: PROFILE,
      evidenceGraph: selection.evidenceGraph,
      brief: BRIEF,
      config: CONFIG,
      strategies: selection.strategies,
      conceptAssignments: selection.conceptAssignments,
      imageCount: 1,
      variationKey: 3,
    });

    selection.conceptAssignments.forEach((assignment) => {
      const draft = result.drafts[assignment.planIndex]!;
      expect(draft.hook).toContain(assignment.openingAction);
      expect(draft.planningReview.nonAdEntry).toContain(assignment.openingAction);
      expect(draft.primaryScene).toContain(assignment.scene);
      expect(draft.segments[0]?.location).toContain(assignment.scene);
      expect(draft.segments[0]?.action).toContain(assignment.openingAction);
      const evidenceIds = draft.segments.flatMap(segment => segment.evidenceRefs);
      expect([...new Set(evidenceIds)].sort()).toEqual([...assignment.evidenceIds].sort());
    });
  });

  it('首次方案格式恢复保留固定策略与事实上下文且不携带图片或坏正文', () => {
    const strategies = allocatePromptWizardStrategies({
      runId: 'provider-format-repair-input',
      ordinal: 1,
      previousSignatures: [],
    });
    const parsedInput = JSON.parse(buildPromptWizardDraftFormatRepairInput({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 2,
      variationKey: 2,
    }, 4, 1));

    expect(parsedInput).toMatchObject({
      planIndex: 1,
      assignedStrategy: strategies[1],
      formatRecovery: expect.objectContaining({
        reason: expect.stringContaining('不是合法 JSON'),
      }),
    });
    const serializedInput = JSON.stringify(parsedInput);
    expect(serializedInput).not.toMatch(/input_image|\{invalid/u);
    expect(serializedInput).not.toContain('repairFeedback');
    expect(serializedInput).not.toContain('previousDraft');
  });

  it('方案生成只把用户确认的非空逐条内容放入商业宣称白名单', () => {
    const strategies = allocatePromptWizardStrategies({
      runId: 'provider-claim-policy',
      ordinal: 0,
      previousSignatures: [],
    });
    const input = JSON.parse(buildPromptWizardDraftInput({
      profile: {
        ...PROFILE,
        needsConfirmation: ['40 小时续航待确认', '防水认证待确认'],
        userConfirmedClaims: '40 小时续航；IPX7 认证\n  \n含 80% 棉。',
      },
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
    }, 4, 0));

    expect(input.product).not.toHaveProperty('needsConfirmation');
    expect(input.claimPolicy).toMatchObject({
      authoritativeSource: 'allowedCommercialClaims',
      allowedCommercialClaims: ['40 小时续航', 'IPX7 认证', '含 80% 棉'],
      rules: expect.arrayContaining([
        expect.stringContaining('列表外的任何数值、比例、认证、性能、功效、成分或绝对化保证仍然禁止'),
      ]),
    });
    expect(JSON.stringify(input.product)).not.toContain('待确认');
  });

  it('Fake Provider 同步返回预审、结构化职责、分段口播与制作提醒', async () => {
    const brief = { ...BRIEF, direction: 'asmr-detail' as const };
    const config = { ...CONFIG, durationSeconds: 5 as const };
    const selection = makePromptWizardV4Selection({
      runId: 'fake-provider-v2',
      ordinal: 0,
      profile: PROFILE,
      brief,
      config,
    });
    const result = await new FakePromptWizardProvider().generateDrafts({
      profile: PROFILE,
      evidenceGraph: selection.evidenceGraph,
      brief,
      config,
      strategies: selection.strategies,
      conceptAssignments: selection.conceptAssignments,
      imageCount: 1,
      variationKey: 1,
    });

    expect(result.drafts).toHaveLength(PROMPT_WIZARD_PLAN_COUNT);
    result.drafts.forEach((draft, planIndex) => {
      expect(draft.name).toContain('ASMR 细节展示');
      expect(draft.planningReview).toMatchObject({
        targetAudience: expect.any(String),
        nonAdEntry: expect.any(String),
        directionFit: expect.stringContaining('ASMR 细节展示'),
      });
      expect(draft.segments.map(segment => segment.role)).toEqual([
        'hook',
        'proof-resolution',
        'cta',
      ]);
      expect(draft.segments[1]).toMatchObject({
        foley: expect.stringContaining('真实声音'),
      });
      const consumedEvidenceIds = draft.segments.flatMap(segment => segment.evidenceRefs);
      expect(consumedEvidenceIds.length).toBeGreaterThan(0);
      expect(consumedEvidenceIds.every(id => (
        selection.conceptAssignments[planIndex]!.evidenceIds.includes(id)
      ))).toBe(true);
      expect(JSON.stringify(draft)).not.toContain('alternativeHooks');
      expect(JSON.stringify(draft)).not.toContain('onScreenText');
      expect(draft.productionWarnings).toEqual([
        expect.stringContaining('Logo'),
      ]);
    });

    const rendered = renderPromptWizardPlan({
      id: '00000000-0000-4000-8000-000000000081',
      draft: result.drafts[0]!,
      strategy: selection.strategies[0]!,
      conceptAssignment: selection.conceptAssignments[0]!,
      conceptPreview: selection.conceptPreviews[0]!,
      evidenceGraph: selection.evidenceGraph,
      profile: PROFILE,
      brief,
      config,
      imageCount: 1,
    });
    expect(rendered).toMatchObject({
      deliveryVersion: 4,
      planningReview: expect.any(Object),
      shots: [
        expect.objectContaining({ role: 'hook', startSeconds: 0 }),
        expect.objectContaining({ role: 'proof-resolution' }),
        expect.objectContaining({ role: 'cta', endSeconds: 5 }),
      ],
    });
    expect(rendered.prompt).not.toContain('画面文字：');
  });

  it('Fake Provider 定向内容修复不调用双方案生成，只构造请求中的方案索引', async () => {
    const provider = new FakePromptWizardProvider();
    const generateDrafts = vi.spyOn(provider, 'generateDrafts');
    const strategies = allocatePromptWizardStrategies({
      runId: 'fake-provider-indexed-repair',
      ordinal: 1,
      previousSignatures: [],
    });

    const result = await provider.repairDrafts({
      profile: PROFILE,
      brief: BRIEF,
      config: CONFIG,
      strategies,
      ...makeProviderV4Context(strategies),
      imageCount: 1,
      variationKey: 1,
      previousDrafts: PROMPT_WIZARD_PLAN_INDEXES.map(makeProviderDraft),
      issues: [{
        planIndex: 1,
        errorCode: 'PROMPT_WIZARD_DIVERSITY_FAILED',
        fieldPaths: ['hook', 'primaryScene', 'segments[0].action'],
        action: '调整当前方案与其他方案重复的场景和镜头节奏',
      }],
    });

    expect(generateDrafts).not.toHaveBeenCalled();
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      planIndex: 1,
      draft: { name: expect.any(String) },
    });
    expect(result.drafts[0]?.draft.name).toBe('方案 2');
    expect(result.drafts[0]?.draft.narrative).toBe(makeProviderDraft(1).narrative);
    expect(result.drafts[0]?.draft.hook).not.toBe(makeProviderDraft(1).hook);
    expect(result.drafts[0]?.draft.primaryScene).not.toBe(makeProviderDraft(1).primaryScene);
  });

});

describe('提示词向导 Provider 日志脱敏', () => {
  it('完成日志只选取受限元数据，不包含输出正文、图片 URL 或密钥', () => {
    const response = {
      id: 'resp_123',
      model: '恶意模型字段',
      service_tier: 'default',
      output_text: 'prompt=秘密文案 https://assets.example.com/a.webp?signature=secret',
      usage: { input_tokens: 12, output_tokens: 34 },
      providerRequestId: 'request_123',
      xTtLogId: 'log-123',
      httpStatus: 200,
      receivedBytes: 2_048,
      receivedEvent: true,
      apiKey: 'Bearer AQ.secret',
    } as never;

    const serialized = JSON.stringify(buildPromptWizardProviderCompletionLog(
      'generate-drafts',
      response,
      1,
      250,
    ));

    expect(serialized).toContain('resp_123');
    expect(serialized).toContain('doubao-seed-2-0-lite-260428');
    expect(serialized).not.toMatch(/秘密文案|assets\.example|signature|Bearer|AQ\.secret|恶意模型字段/u);
  });

  it('失败与重试日志拒绝异常标识符和错误分类，也不记录 Error.message 或任意输入字段', () => {
    const error = Object.assign(
      new Error('prompt=秘密文案 url=https://assets.example.com/a?signature=secret key=AQ.secret'),
      {
        code: 'UPSTREAM ERROR https://secret.example',
        responseId: 'resp_123?signature=secret',
        providerRequestId: 'request-safe',
        xTtLogId: 'log-safe',
        usage: { input_tokens: 20, output_tokens: 10 },
        input: 'Bearer AQ.secret',
      },
    );
    const failure = buildPromptWizardProviderFailureLog('generate-drafts', error, 1, 500);
    const retry = buildPromptWizardProviderRetryLog('generate-drafts', {
      attempt: 1,
      nextAttempt: 2,
      status: 503,
      errorName: 'Connection Error https://secret.example',
      errorCode: 'BAD CODE key=AQ.secret',
      providerRequestId: 'request-safe',
      responseId: 'resp_123?signature=secret',
      xTtLogId: 'log-safe',
      receivedBytes: 0,
      receivedEvent: false,
      retryable: true,
      delayMs: 750,
    });
    const serialized = JSON.stringify({ failure, retry });

    expect(failure).toMatchObject({
      providerRequestId: 'request-safe',
      responseId: null,
      xTtLogId: 'log-safe',
      errorClassification: 'Error',
    });
    expect(retry).toMatchObject({
      providerRequestId: 'request-safe',
      responseId: null,
      xTtLogId: 'log-safe',
      errorName: 'UnknownError',
      errorCode: null,
    });
    expect(serialized).not.toMatch(/秘密文案|assets\.example|signature|Bearer|AQ\.secret|secret\.example/u);
  });

  it('失败日志优先记录经过门禁的内容过滤分类，不记录上游详情', () => {
    const error = Object.assign(new Error('上游详情不得写入日志'), {
      code: 'PROMPT_WIZARD_PROVIDER_CONTENT_FILTER',
      errorClassification: 'content_filter:type:safety_policy:category:regulated_content',
      responseId: 'resp_filtered_123',
      xTtLogId: 'log_filtered_123',
      usage: { input_tokens: 12, output_tokens: 1 },
    });

    const log = buildPromptWizardProviderFailureLog('generate-drafts', error, 1, 320);
    expect(log).toMatchObject({
      errorClassification: 'content_filter:type:safety_policy:category:regulated_content',
      responseId: 'resp_filtered_123',
      xTtLogId: 'log_filtered_123',
      inputTokens: 12,
      outputTokens: 1,
    });
    expect(JSON.stringify(log)).not.toContain('上游详情不得写入日志');
  });
});

function makeProviderDraft(index: number) {
  const roles = ['hook', 'proof', 'resolution', 'cta'] as const;
  const evidenceGraph = buildPromptWizardEvidenceGraph(PROFILE, 1);
  const evidence = allocatePromptWizardEvidence({
    evidenceGraph,
    shotRoles: roles,
    planIndex: index,
    preferredFactIds: [
      evidenceGraph.reliableEvidenceIds[index]
        ?? evidenceGraph.reliableEvidenceIds[0]!,
    ],
  });
  return {
    name: `方案 ${index + 1}`,
    hook: `钩子 ${index + 1}`,
    narrative: `叙事 ${index + 1}`,
    primaryScene: `场景 ${index + 1}`,
    cameraAndPacing: `镜头 ${index + 1}`,
    differenceTags: [`差异 ${index + 1}`, `节奏 ${index + 1}`],
    planningReview: {
      targetAudience: '通勤用户',
      surfaceNeed: '希望使用过程更顺畅',
      realPainPoint: '抽象口号无法帮助判断实际体验',
      nonAdEntry: '从真实通勤瞬间切入',
      proofPoints: evidence.proofPoints,
      directionFit: '使用手机跟拍和自然反应，符合真实 UGC 方向',
    },
    segments: roles.map((role, segment) => ({
      role,
      location: `通勤场景 ${segment + 1}`,
      subject: '@图片1 对应产品与通勤用户',
      shotSize: '中近景',
      action: `完成可见动作 ${index + 1}-${segment + 1}`,
      cameraMovement: '手持跟随主体移动',
      lightingAndRealism: '自然环境光与手机实拍质感',
      voiceover: `Voiceover ${index + 1}-${segment + 1}`,
      voiceoverZh: `口播翻译 ${index + 1}-${segment + 1}`,
      foley: '保留真实脚步声与操作轻响',
      editingCue: '在动作完成点剪切',
      evidenceRefs: evidence.evidenceRefsByShot[segment]!,
      productionNote: '',
    })),
    productionWarnings: ['可读 Logo 需检查生成稳定性'],
  };
}

function makeProviderWireDraft(index: number) {
  const draft = makeProviderDraft(index);
  return {
    name: draft.name,
    hook: draft.hook,
    narrative: draft.narrative,
    primaryScene: draft.primaryScene,
    cameraAndPacing: draft.cameraAndPacing,
    differenceTags: draft.differenceTags,
    planningReview: {
      targetAudience: draft.planningReview.targetAudience,
      surfaceNeed: draft.planningReview.surfaceNeed,
      realPainPoint: draft.planningReview.realPainPoint,
      nonAdEntry: draft.planningReview.nonAdEntry,
      directionFit: draft.planningReview.directionFit,
    },
    segments: draft.segments.map(segment => ({
      role: segment.role,
      location: segment.location,
      subject: segment.subject,
      shotSize: segment.shotSize,
      action: segment.action,
      cameraMovement: segment.cameraMovement,
      lightingAndRealism: segment.lightingAndRealism,
      voiceover: segment.voiceover,
      voiceoverZh: segment.voiceoverZh,
      foley: segment.foley,
      editingCue: segment.editingCue,
      productionNote: segment.productionNote,
    })),
    productionWarnings: draft.productionWarnings,
  };
}

function deferredValue<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForMicrotasks(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('等待提示词向导请求进入 Provider permit 队列超时');
}
