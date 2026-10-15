import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  promptWizardPlanV6Schema,
  type PromptWizardPlanV6,
  type PromptWizardProductFamily,
  type PromptWizardProductProfile,
  type PromptWizardProductionBrief,
  type PromptWizardRouteRole,
  type PromptWizardVideoConfig,
} from '@lindyson/api-contracts';
import { buildPromptWizardEvidenceGraph } from '../domain/promptWizardEvidenceGraph.js';
import {
  expectedPromptWizardSegmentCountV6,
  PROMPT_WIZARD_SOUND_DESIGN_ONLY_INSTRUCTION,
  promptWizardBeatRolesV6,
  promptWizardTimelineV6,
} from '../domain/promptWizardPrompt.js';
import {
  buildPromptWizardRouteSetV6,
  PROMPT_WIZARD_V6_ROUTE_ROLES,
  promptWizardRoutePlanContextsV6,
} from '../domain/promptWizardV6Routes.js';

export const PROMPT_WIZARD_V6_CANARY_LANGUAGES = [
  '普通话',
  '英语',
  '西班牙语',
] as const;

export const PROMPT_WIZARD_V6_CANARY_DURATIONS = [5, 10, 15] as const;

export interface PromptWizardV6CanaryCase {
  id: string;
  productKey: '耳机' | '美妆' | '服饰' | '宠物用品' | '家居';
  expectedFamily: PromptWizardProductFamily;
  profile: PromptWizardProductProfile;
  productionBrief: PromptWizardProductionBrief;
  audioMode: PromptWizardPlanV6['audioMode'];
  voiceoverLanguage: typeof PROMPT_WIZARD_V6_CANARY_LANGUAGES[number] | null;
  verifiedOffer: string;
  videoConfig: PromptWizardVideoConfig;
}

export interface PromptWizardV6CanaryObservation {
  id: string;
  productKey: PromptWizardV6CanaryCase['productKey'];
  durationSeconds: 5 | 10 | 15;
  audioMode: PromptWizardPlanV6['audioMode'];
  voiceoverLanguage: PromptWizardV6CanaryCase['voiceoverLanguage'];
  verifiedOffer: string;
  plans: PromptWizardPlanV6[];
}

const PROMPT_WIZARD_V6_CANARY_VERIFIED_OFFER = '当前真实优惠：满 100 元减 10 元';

const PRODUCTS = [
  canaryProduct('耳机', 'consumer-electronics', {
    productName: '开放式蓝牙耳机',
    category: '消费电子 > 音频 > 耳机',
    materials: '',
    structure: '参考图片可见挂耳轮廓、左右耳机与圆形充电仓',
    logo: '',
    usage: '手拿起耳机并将挂耳结构放到耳廓外侧',
    visibleFacts: ['参考图片可见挂耳轮廓、左右耳机与圆形充电仓'],
    consistencyConstraints: '保持挂耳轮廓、左右耳机和圆形充电仓外观一致',
  }, ['城市公园跑步道', '整洁办公桌', '通勤咖啡店']),
  canaryProduct('美妆', 'beauty-personal-care', {
    productName: '十色眼影盘',
    category: '美妆个护 > 彩妆 > 眼影',
    materials: '',
    structure: '参考图片可见十个独立色格、镜面与开合盘体',
    logo: '盘面保留参考图片中的品牌文字',
    usage: '手打开眼影盘并用刷具沾取一个可见色格',
    visibleFacts: ['参考图片可见十个独立色格、镜面与开合盘体'],
    consistencyConstraints: '保持色格数量、排列、盘体比例和品牌文字一致',
  }, ['自然光梳妆台', '通勤妆准备区', '旅行化妆包旁']),
  canaryProduct('服饰', 'apparel-accessories', {
    productName: '无缝高腰运动紧身裤',
    category: '服饰 > 女装 > 运动服',
    materials: '',
    structure: '参考图片可见高腰裤头、长裤版型与后侧拼接线',
    logo: '',
    usage: '人物穿着紧身裤完成一次自然站立与屈膝动作',
    visibleFacts: ['参考图片可见高腰裤头、长裤版型与后侧拼接线'],
    consistencyConstraints: '保持腰头高度、长裤版型、拼接线和颜色一致',
  }, ['自然光更衣区', '室内运动区', '日常出行玄关']),
  canaryProduct('宠物用品', 'general', {
    productName: '二合一宠物自动喂食器与饮水器',
    category: '宠物用品 > 喂食与饮水用品',
    materials: '',
    structure: '参考图片可见粮食托盘、水瓶安装位与连体底座',
    logo: '',
    usage: '手把宠物干粮倒入托盘并把水瓶稳固放入安装位',
    visibleFacts: ['参考图片可见粮食托盘、水瓶安装位与连体底座'],
    consistencyConstraints: '保持粮食托盘、水瓶安装位、连体底座和整体比例一致',
  }, ['公寓宠物角', '日常补粮位置', '多宠家庭固定喂食点']),
  canaryProduct('家居', 'home-living', {
    productName: '桌边线缆固定夹',
    category: '家居 > 桌面收纳',
    materials: '',
    structure: '参考图片可见扁平底座、纵向凹槽和夹持开口',
    logo: '',
    usage: '手把线缆压入凹槽并沿桌边固定',
    visibleFacts: ['参考图片可见扁平底座、纵向凹槽和夹持开口'],
    consistencyConstraints: '保持底座、凹槽、夹持开口和整体比例一致',
  }, ['整洁办公桌', '线缆凌乱的桌边', '居家工作区']),
] as const;

export const PROMPT_WIZARD_V6_CANARY_CASES: readonly PromptWizardV6CanaryCase[] =
  PRODUCTS.flatMap((product, productIndex) => (
    PROMPT_WIZARD_V6_CANARY_DURATIONS.map((durationSeconds, durationIndex) => {
      const soundDesignOnly = durationSeconds === 5;
      const voiceoverLanguage = soundDesignOnly
        ? null
        : PROMPT_WIZARD_V6_CANARY_LANGUAGES[
          (productIndex * 2 + durationIndex - 1) % PROMPT_WIZARD_V6_CANARY_LANGUAGES.length
        ]!;
      return {
        id: `${product.productKey}-${durationSeconds}s-${voiceoverLanguage ?? 'sound-only'}`,
        ...product,
        audioMode: soundDesignOnly ? 'sound-design-only' as const : 'voiceover' as const,
        voiceoverLanguage,
        verifiedOffer: PROMPT_WIZARD_V6_CANARY_VERIFIED_OFFER,
        videoConfig: videoConfig(durationSeconds),
      };
    })
  ));

/**
 * 纯本地确定性 V6 门禁。它只验证证据图谱、三路线、V6 交付 Schema、
 * 镜头预算与语言矩阵，不连接 Provider，也不能作为真实模型质量结论。
 */
export function runPromptWizardV6CanaryCase(
  testCase: PromptWizardV6CanaryCase,
  caseIndex: number,
): PromptWizardV6CanaryObservation {
  const imageAssetId = deterministicUuid(caseIndex + 1);
  const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, [imageAssetId]);
  if (evidenceGraph.productFamily !== testCase.expectedFamily) {
    throw new Error(
      `${testCase.id} 产品族识别错误：${evidenceGraph.productFamily}，预期 ${testCase.expectedFamily}`,
    );
  }
  const routeSet = buildPromptWizardRouteSetV6({
    id: deterministicUuid(100 + caseIndex),
    runId: deterministicUuid(200 + caseIndex),
    runRevision: 1,
    profile: testCase.profile,
    evidenceGraph,
    productionBrief: testCase.productionBrief,
    createdAt: '2026-08-05T00:00:00.000Z',
  });
  const contexts = promptWizardRoutePlanContextsV6(routeSet);
  const plans = contexts.map(({ planIndex, route }) => promptWizardPlanV6Schema.parse({
    id: deterministicUuid(1_000 + caseIndex * 3 + planIndex),
    deliveryVersion: 6,
    audioMode: testCase.audioMode,
    role: route.role,
    name: route.titleZh,
    narrative: route.directionExplanationZh,
    primaryScene: route.recommendedScene.title,
    cameraAndPacing: promptWizardCanaryPacing(route.role),
    differenceTags: [promptWizardRoleLabel(route.role), '本地确定性门禁'],
    prompt: promptWizardCanaryPrompt(
      testCase,
      route.role,
      route.titleZh,
      route.recommendedScene.mainAction,
    ),
    directionExplanationZh: route.directionExplanationZh,
    audienceZh: route.audienceZh,
    purchaseReasonZh: route.purchaseReasonZh,
    hookZh: route.hookZh,
    claimBasisTags: route.claimBasisTags,
    selectedScene: route.recommendedScene,
    shots: promptWizardCanaryShots(testCase, route.role, route.evidenceRefs),
    productionWarnings: ['本地样本只验证结构，不代表真实 Provider 生成质量已通过'],
  }));
  return {
    id: testCase.id,
    productKey: testCase.productKey,
    durationSeconds: testCase.videoConfig.durationSeconds,
    audioMode: testCase.audioMode,
    voiceoverLanguage: testCase.voiceoverLanguage,
    verifiedOffer: testCase.verifiedOffer,
    plans,
  };
}

export function assertPromptWizardV6Canary(
  observations: readonly PromptWizardV6CanaryObservation[],
) {
  if (observations.length !== 15) {
    throw new Error(`V6 Canary 必须包含 15 个批次，实际 ${observations.length} 个`);
  }
  const expectedIds = new Set(PROMPT_WIZARD_V6_CANARY_CASES.map(item => item.id));
  if (new Set(observations.map(item => item.id)).size !== 15
    || observations.some(item => !expectedIds.has(item.id))) {
    throw new Error('V6 Canary 批次必须与固定矩阵一一对应且不得重复');
  }
  for (const observation of observations) {
    const expectedCount = expectedPromptWizardSegmentCountV6(observation.durationSeconds);
    if (observation.plans.length !== 3) {
      throw new Error(`${observation.id} 必须严格包含三个 V6 方案`);
    }
    if (!sameOrderedValues(
      observation.plans.map(plan => plan.role),
      PROMPT_WIZARD_V6_ROUTE_ROLES,
    )) {
      throw new Error(`${observation.id} 未按固定顺序包含三个商业角色`);
    }
    for (const plan of observation.plans) {
      promptWizardPlanV6Schema.parse(plan);
      if (plan.audioMode !== observation.audioMode) {
        throw new Error(`${observation.id} 的 ${plan.role} 音频模式不符合 V6 时长规则`);
      }
      if (plan.shots.length !== expectedCount) {
        throw new Error(`${observation.id} 的 ${plan.role} 镜头数不符合 V6 时长预算`);
      }
      if (observation.audioMode === 'sound-design-only') {
        if (
          observation.voiceoverLanguage !== null
          || plan.shots.some(shot => shot.voiceover || shot.voiceoverZh)
          || !plan.prompt.includes(PROMPT_WIZARD_SOUND_DESIGN_ONLY_INSTRUCTION)
          || plan.prompt.includes(observation.verifiedOffer)
        ) {
          throw new Error(`${observation.id} 的 5 秒方案必须无语言、口播、译文与优惠`);
        }
      } else if (
        !observation.voiceoverLanguage
        || plan.shots.some(shot => !shot.voiceover)
      ) {
        throw new Error(`${observation.id} 的 10/15 秒方案必须包含目标语言口播`);
      }
    }
  }
  for (const product of PRODUCTS) {
    const productCases = observations.filter(item => item.productKey === product.productKey);
    const soundDesignOnlyCases = productCases.filter(item => item.durationSeconds === 5);
    const voiceoverCases = productCases.filter(item => item.durationSeconds !== 5);
    if (
      !sameSets(productCases.map(item => item.durationSeconds), PROMPT_WIZARD_V6_CANARY_DURATIONS)
      || soundDesignOnlyCases.length !== 1
      || soundDesignOnlyCases[0]?.audioMode !== 'sound-design-only'
      || soundDesignOnlyCases[0]?.voiceoverLanguage !== null
      || voiceoverCases.length !== 2
      || voiceoverCases.some(item => item.audioMode !== 'voiceover' || !item.voiceoverLanguage)
      || new Set(voiceoverCases.map(item => item.voiceoverLanguage)).size !== 2
    ) {
      throw new Error(`${product.productKey} 未完整覆盖 5 秒无口播与 10/15 秒口播矩阵`);
    }
  }
  const voiceoverLanguages = observations.flatMap(item => (
    item.voiceoverLanguage ? [item.voiceoverLanguage] : []
  ));
  if (!sameSets([...new Set(voiceoverLanguages)], PROMPT_WIZARD_V6_CANARY_LANGUAGES)) {
    throw new Error('V6 Canary 的 10/15 秒批次未轮换普通话、英语与西班牙语');
  }
  const validatedPlanCount = observations.reduce((total, item) => total + item.plans.length, 0);
  if (validatedPlanCount !== 45) {
    throw new Error(`V6 Canary 必须验证 45 个本地方案，实际 ${validatedPlanCount} 个`);
  }
  return {
    completedBatchCount: 15,
    validatedPlanCount,
    providerMode: 'deterministic-no-provider' as const,
    realProviderCalled: false as const,
  };
}

export function runPromptWizardV6Canary() {
  const observations = PROMPT_WIZARD_V6_CANARY_CASES.map(runPromptWizardV6CanaryCase);
  observations.forEach(observation => emit({
    event: 'prompt-wizard-v6-local-canary-case',
    ok: true,
    id: observation.id,
    planCount: observation.plans.length,
    roles: observation.plans.map(plan => plan.role),
    shotCounts: observation.plans.map(plan => plan.shots.length),
    audioMode: observation.audioMode,
    ...(observation.voiceoverLanguage
      ? { voiceoverLanguage: observation.voiceoverLanguage }
      : {}),
    realProviderCalled: false,
  }));
  const summary = assertPromptWizardV6Canary(observations);
  emit({ event: 'prompt-wizard-v6-local-canary-completed', ok: true, ...summary });
  return summary;
}

function canaryProduct(
  productKey: PromptWizardV6CanaryCase['productKey'],
  expectedFamily: PromptWizardProductFamily,
  partial: Pick<PromptWizardProductProfile,
    'productName' | 'category' | 'materials' | 'structure' | 'logo' | 'usage'
    | 'visibleFacts' | 'consistencyConstraints'>,
  scenes: string[],
) {
  const profile: PromptWizardProductProfile = {
    colors: '',
    suggestedAudience: '希望在真实短视频中快速看清商品和正确使用动作的用户',
    suggestedScenarios: scenes.join('\n'),
    categoryInferredFunctions: [],
    needsConfirmation: [],
    userConfirmedClaims: '',
    ...partial,
  };
  const productionBrief: PromptWizardProductionBrief = {
    primaryPurchaseReason: partial.visibleFacts[0] ?? '',
    appearanceMode: productKey === '服饰' ? 'person' : 'hands-only',
    availableScenes: scenes,
    availableAssets: productKey === '服饰'
      ? ['商品参考图片', '真人出镜素材']
      : ['商品参考图片', '手部素材'],
  };
  return { productKey, expectedFamily, profile, productionBrief };
}

function videoConfig(durationSeconds: 5 | 10 | 15): PromptWizardVideoConfig {
  if (durationSeconds === 5) {
    return { model: 'seedance-2.0-mini', aspectRatio: '9:16', resolution: '480p', durationSeconds };
  }
  if (durationSeconds === 10) {
    return { model: 'seedance-2.0-fast', aspectRatio: '9:16', resolution: '720p', durationSeconds };
  }
  return { model: 'seedance-2.0', aspectRatio: '9:16', resolution: '1080p', durationSeconds };
}

function promptWizardCanaryShots(
  testCase: PromptWizardV6CanaryCase,
  role: PromptWizardRouteRole,
  evidenceRefs: string[],
) {
  const roles = promptWizardBeatRolesV6(testCase.videoConfig.durationSeconds);
  return promptWizardTimelineV6(testCase.videoConfig.durationSeconds).map(([startSeconds, endSeconds], index) => {
    const speech = promptWizardCanarySpeech(testCase, role);
    const soundDesignOnly = testCase.audioMode === 'sound-design-only';
    const soundDesignAction = promptWizardCanarySoundDesignAction(testCase.productKey);
    return {
      startSeconds,
      endSeconds,
      role: roles[index]!,
      location: testCase.productionBrief.availableScenes[index % 3]!,
      subject: `参考图片中的${testCase.profile.productName}与真实操作主体`,
      shotSize: index === 0 ? '产品近景' : '中近景',
      action: soundDesignOnly
        ? soundDesignAction
        : index === 0
          ? `第一秒让${testCase.profile.productName}完整进入画面并开始一次正确操作`
          : index === roles.length - 1
            ? `保持商品清楚可见，以查看商品详情的购买行动收束`
            : `连续展示一次与可靠证据相连的正确使用动作`,
      cameraMovement: soundDesignOnly
        ? index === 0 ? '持续跟随唯一商品动作' : '沿唯一商品动作持续缓慢推近'
        : index === 0 ? '快速推近后稳定跟随' : '沿动作方向持续横移',
      lightingAndRealism: '自然光、真实手机拍摄质感，商品外观清楚可辨',
      voiceover: speech.original,
      voiceoverZh: speech.translationZh,
      foley: '保留商品拿取与操作的真实声音',
      editingCue: '在动作完成点切换镜头',
      evidenceRefs,
      productionNote: '保持商品外观、结构和标识与参考图片一致',
    };
  });
}

function promptWizardCanaryPrompt(
  testCase: PromptWizardV6CanaryCase,
  role: PromptWizardRouteRole,
  title: string,
  mainAction: string,
) {
  if (testCase.audioMode === 'sound-design-only') {
    return [
      `【商业路线】${title}`,
      `【0-1.2s｜钩子】${mainAction}`,
      `【1.2-5s｜自证与化解】商品保持清晰可见，延续唯一商品动作并以持续运镜收尾。`,
      `【声音】${PROMPT_WIZARD_SOUND_DESIGN_ONLY_INSTRUCTION}`,
    ].join('\n');
  }
  const speech = promptWizardCanarySpeech(testCase, role);
  return [
    `【商业路线】${title}`,
    `【画面】${mainAction}`,
    `【口播（${testCase.voiceoverLanguage}）】${speech.original}`,
    '【声音】保留真实商品操作声。',
    '【结尾】商品保持清楚可见，引导查看商品详情。',
  ].join('\n');
}

function promptWizardCanarySpeech(
  testCase: PromptWizardV6CanaryCase,
  role: PromptWizardRouteRole,
) {
  if (testCase.audioMode === 'sound-design-only') {
    return { original: '', translationZh: '' };
  }
  if (!testCase.voiceoverLanguage) {
    throw new Error(`${testCase.id} 的口播模式缺少目标语言`);
  }
  return promptWizardCanaryVoiceover(testCase.voiceoverLanguage, role);
}

function promptWizardCanarySoundDesignAction(
  productKey: PromptWizardV6CanaryCase['productKey'],
) {
  if (productKey === '耳机') return '手持续将一只耳机放到耳廓外侧';
  if (productKey === '美妆') return '手持续打开眼影盘';
  if (productKey === '服饰') return '人物持续完成一次自然屈膝';
  if (productKey === '宠物用品') return '手持续把少量干粮倒入托盘';
  return '手持续把一根线缆压入凹槽';
}

function promptWizardCanaryVoiceover(
  language: typeof PROMPT_WIZARD_V6_CANARY_LANGUAGES[number],
  role: PromptWizardRouteRole,
) {
  const meaning = role === 'proof-conversion'
    ? '先看商品如何完成真实操作，再决定是否适合你。'
    : role === 'problem-hook'
      ? '遇到这个日常问题，看看商品如何自然介入。'
      : '把商品放进真实生活节奏，再查看商品详情。';
  if (language === '普通话') return { original: meaning, translationZh: '' };
  if (language === '英语') {
    return {
      original: role === 'problem-hook'
        ? 'See how this product steps into a real everyday problem.'
        : role === 'lifestyle-seeding'
          ? 'See it in a real routine, then check the product details.'
          : 'Watch the real product action, then decide if it fits you.',
      translationZh: meaning,
    };
  }
  return {
    original: role === 'problem-hook'
      ? 'Mira cómo este producto resuelve un problema cotidiano real.'
      : role === 'lifestyle-seeding'
        ? 'Míralo en una rutina real y revisa los detalles del producto.'
        : 'Mira la acción real del producto y decide si es para ti.',
    translationZh: meaning,
  };
}

function promptWizardCanaryPacing(role: PromptWizardRouteRole) {
  if (role === 'proof-conversion') return '产品近景快速进入，证明动作稳定跟随，结尾直接查看商品。';
  if (role === 'problem-hook') return '问题事件快切进入，解决动作持续追踪，结尾回扣痛点。';
  return '生活场景自然进入，手机跟拍保持真实节奏，结尾自然种草。';
}

function promptWizardRoleLabel(role: PromptWizardRouteRole) {
  if (role === 'proof-conversion') return '产品自证型';
  if (role === 'problem-hook') return '痛点钩子型';
  return '场景种草型';
}

function deterministicUuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function sameOrderedValues(left: readonly unknown[], right: readonly unknown[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameSets(left: readonly unknown[], right: readonly unknown[]) {
  return left.length === right.length
    && new Set(left).size === new Set(right).size
    && left.every(value => new Set(right).has(value));
}

function emit(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry!) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    runPromptWizardV6Canary();
  } catch (error) {
    emit({
      event: 'prompt-wizard-v6-local-canary-aborted',
      ok: false,
      error: error instanceof Error ? error.message : '未知错误',
      realProviderCalled: false,
    });
    process.exitCode = 1;
  }
}
