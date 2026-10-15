import type {
  PromptWizardCreativeBrief,
  PromptWizardEvidenceGraph,
  PromptWizardProductFamily,
  PromptWizardProductionBrief,
} from '@lindyson/api-contracts';
import {
  getPromptWizardDirectionBlueprint,
  type PromptWizardDirectionBlueprint,
} from './promptWizardDirectionBlueprint.js';
import { derivePromptWizardEvidenceCapabilities } from './promptWizardEvidenceGraph.js';

export type PromptWizardDirectionAvailability = 'recommended' | 'available' | 'unavailable';

export interface PromptWizardDirectionAssessment {
  direction: PromptWizardCreativeBrief['direction'];
  availability: PromptWizardDirectionAvailability;
  reason: string;
  missingRequirements: string[];
}

export interface PromptWizardCreativePlaybook {
  direction: PromptWizardCreativeBrief['direction'];
  directionLabel: string;
  productFamily: PromptWizardProductFamily;
  productFamilyLabel: string;
  objective: string;
  familyTreatment: string;
  hookGuidance: string[];
  proofGuidance: string[];
  executionGuidance: string[];
  ctaGuidance: string;
  guardrails: string[];
  assessment: PromptWizardDirectionAssessment;
}

export interface PromptWizardBriefQuestion {
  id: 'purchase-reason' | 'talent-mode' | 'available-scenes';
  prompt: string;
  why: string;
}

const FAMILY_LABELS: Record<PromptWizardProductFamily, string> = {
  'apparel-accessories': '服饰配件',
  'beauty-personal-care': '美妆个护',
  'consumer-electronics': '消费电子',
  'home-living': '家居生活',
  general: '通用商品',
};

const RECOMMENDED_DIRECTIONS: Record<PromptWizardProductFamily, readonly PromptWizardCreativeBrief['direction'][]> = {
  'apparel-accessories': ['ugc', 'lifestyle', 'pain-comparison', 'asmr-detail'],
  'beauty-personal-care': ['ugc', 'problem-solution', 'lifestyle', 'asmr-detail'],
  'consumer-electronics': ['ugc', 'problem-solution', 'feature-test', 'unboxing-review'],
  'home-living': ['problem-solution', 'lifestyle', 'feature-test', 'asmr-detail'],
  general: ['ugc', 'problem-solution', 'cinematic-brand'],
};

const FAMILY_DIRECTION_TREATMENT: Record<
  PromptWizardProductFamily,
  Record<PromptWizardCreativeBrief['direction'], string>
> = {
  'apparel-accessories': {
    ugc: '从穿戴、整理或搭配动作切入，让版型、结构、印花或配饰细节在人物日常中完成自证。',
    'problem-solution': '围绕穿搭选择、收纳、取用或佩戴不便建立单一问题，并用正确穿戴动作化解。',
    'unboxing-review': '仅在包装可见时呈现拆封，重点检查做工、结构、印花、配件和首次穿戴状态。',
    'feature-test': '只测试用户确认且镜头可见的服饰属性，不把触感、透气或耐用推断成客观结论。',
    'pain-comparison': '在同一人物、光线和姿态下对比穿戴前后的可见状态，不贬低其他商品。',
    lifestyle: '选择目标人群真实的一天，让产品随人物动作自然出现并保持版型、Logo 和印花连续。',
    'cinematic-brand': '用材质、轮廓、结构和印花近景建立质感，再回到一次完整穿戴动作。',
    'asmr-detail': '用拉链、纽扣、布料摩擦、折叠或佩戴声作为叙事，不编造面料不存在的声音。',
  },
  'beauty-personal-care': {
    ugc: '从梳妆或护理流程中的真实动作切入，展示容器、质地和正确使用，不虚构长期效果。',
    'problem-solution': '复现一个具体护理步骤中的不便，产品通过可见用法介入，不承诺医学或永久功效。',
    'unboxing-review': '仅在包装可见时拆封，核对瓶器、泵头、刷头、质地和首次取用动作。',
    'feature-test': '只演示用户确认的可观察功能或质地表现，禁止皮肤治疗、极端前后对照和危险测试。',
    'pain-comparison': '对比同一流程中的操作状态或妆面可见细节，不制造夸张皮肤变化。',
    lifestyle: '把产品放进晨间、通勤或夜间护理节奏，以自然取用和收纳体现价值。',
    'cinematic-brand': '以瓶器轮廓、液体或膏体质地和受控光影建立品牌感，保持包装文字原样。',
    'asmr-detail': '用开盖、按压、滴落、刷涂或喷雾等真实操作声驱动镜头。',
  },
  'consumer-electronics': {
    ugc: '从开机、连接、佩戴或桌面取用的真实瞬间切入，以完整操作代替参数口号。',
    'problem-solution': '让连接、收纳、控制或使用流程中的具体阻力先发生，再展示产品正确介入。',
    'unboxing-review': '仅在包装证据充分时开箱，依次核对接口、按键、结构、配件和首次启动。',
    'feature-test': '测试问题必须安全、可复现并由用户确认，完整保留条件、操作和可见结果。',
    'pain-comparison': '只比较同一设备或同一人物使用前后的操作流程，不推断竞品性能。',
    lifestyle: '让设备融入通勤、办公、创作或休闲的一次连续任务，保持连接状态和部件连续。',
    'cinematic-brand': '以接口、按键、屏幕、指示灯和机身材质建立精密感，再进入正确操作。',
    'asmr-detail': '用按键、旋钮、折叠、插接或收纳的真实结构声建立节奏。',
  },
  'home-living': {
    ugc: '从做饭、清洁、收纳或布置中的真实动作切入，突出产品如何融入家庭流程。',
    'problem-solution': '把一个具体家务阻力放在镜头前，通过正确使用动作产生可见缓解。',
    'unboxing-review': '仅在包装可见时拆封，检查结构、尺寸关系、配件和首次组装或摆放。',
    'feature-test': '只验证用户确认且安全的容量、开合、收纳或操作功能，不做破坏性测试。',
    'pain-comparison': '在同一空间和任务下比较流程变化，确保结果来自产品操作而非剪辑魔法。',
    lifestyle: '把产品放入家庭一天中的固定位置与动作，让环境和用途共同说明价值。',
    'cinematic-brand': '利用材质、轮廓、空间秩序和自然光建立家居质感，避免虚构奢华定位。',
    'asmr-detail': '用开合、放置、擦拭、倒入或收纳声驱动微距细节。',
  },
  general: {
    ugc: '从可见的真实取用和操作切入，避免套用与商品无关的人设或场景。',
    'problem-solution': '只选择产品档案能支持的一个具体问题，并保持动作与结果因果连续。',
    'unboxing-review': '没有包装证据时不得假装开箱；有包装时只评价镜头可见细节。',
    'feature-test': '没有用户确认的可测试功能时不得安排实测。',
    'pain-comparison': '只比较同一场景中的可见操作状态，不引入竞品或绝对优势。',
    lifestyle: '以正确使用方式连接人物与场景，不让产品沦为无关道具。',
    'cinematic-brand': '从真实结构、材质或标识出发建立氛围，不新增不存在的部件。',
    'asmr-detail': '只有产品确实能产生操作声时才使用声音钩子。',
  },
};

export function createPromptWizardProductionBrief(
  input: Partial<PromptWizardProductionBrief> = {},
): PromptWizardProductionBrief {
  return {
    primaryPurchaseReason: input.primaryPurchaseReason?.trim() ?? '',
    appearanceMode: input.appearanceMode ?? 'hands-only',
    availableScenes: uniqueStrings(input.availableScenes ?? []),
    availableAssets: uniqueStrings(input.availableAssets ?? ['产品参考图片']),
  };
}

/** 供 3.0 Service 使用的语义化别名；profile 参数只用于保持编排调用直观。 */
export function buildPromptWizardProductionBrief(
  _profile: unknown,
  input: Partial<PromptWizardProductionBrief> = {},
): PromptWizardProductionBrief {
  return createPromptWizardProductionBrief(input);
}

export function promptWizardBriefQuestions(
  graph: PromptWizardEvidenceGraph,
  productionBrief: Partial<PromptWizardProductionBrief>,
): PromptWizardBriefQuestion[] {
  const questions: PromptWizardBriefQuestion[] = [];
  if (!productionBrief.primaryPurchaseReason) {
    questions.push({
      id: 'purchase-reason',
      prompt: '这条视频最希望观众记住哪个购买理由？',
      why: graph.evidences.some(item => item.status === 'user-confirmed')
        ? '请选择一个已确认卖点，避免单条视频同时解释多个理由。'
        : '当前只有可见产品事实，需要您确认主推重点。',
    });
  }
  if (!productionBrief.appearanceMode) {
    questions.push({
      id: 'talent-mode',
      prompt: '当前可以使用真人、手部，还是只展示产品？',
      why: '出镜条件会直接限制场景、动作和镜头复杂度。',
    });
  }
  if ((productionBrief.availableScenes ?? []).length === 0) {
    questions.push({
      id: 'available-scenes',
      prompt: '当前有哪些真实可用的拍摄场景或素材？',
      why: '优先使用已有场景，减少生成后因素材不匹配而重写。',
    });
  }
  return questions.slice(0, 3);
}

export function assessPromptWizardDirection(input: {
  graph: PromptWizardEvidenceGraph;
  productionBrief: PromptWizardProductionBrief;
  direction: PromptWizardCreativeBrief['direction'];
}): PromptWizardDirectionAssessment {
  const missingRequirements: string[] = [];
  const capabilities = derivePromptWizardEvidenceCapabilities(input.graph);
  const assets = new Set(input.productionBrief.availableAssets);
  const packagingAvailable = capabilities.hasPackagingEvidence
    || [...assets].some(asset => /(?:包装|外盒|礼盒)/u.test(asset));

  if (input.direction === 'unboxing-review' && !packagingAvailable) {
    missingRequirements.push('缺少可见包装或开箱素材');
  }
  if (input.direction === 'feature-test' && !capabilities.hasConfirmedTestableFeature) {
    missingRequirements.push('缺少用户确认且可观察的测试功能');
  }
  if (input.direction === 'asmr-detail' && !capabilities.hasFoleyAction) {
    missingRequirements.push('缺少可产生真实操作声的动作或结构');
  }
  if (input.direction === 'pain-comparison' && !capabilities.hasSafeBeforeAfterEvidence) {
    missingRequirements.push('缺少可连接使用前后状态的正确使用动作');
  }
  if (
    input.direction === 'cinematic-brand'
    && !capabilities.hasVisibleStructure
    && !capabilities.hasMaterialEvidence
    && !capabilities.hasLogoOrPrint
  ) {
    missingRequirements.push('缺少可用于质感镜头的结构、材质或标识证据');
  }

  if (missingRequirements.length > 0) {
    return {
      direction: input.direction,
      availability: 'unavailable',
      reason: missingRequirements.join('；'),
      missingRequirements,
    };
  }

  const recommended = RECOMMENDED_DIRECTIONS[input.graph.productFamily].includes(input.direction)
    && !(input.direction === 'ugc' && input.productionBrief.appearanceMode === 'product-only');
  return {
    direction: input.direction,
    availability: recommended ? 'recommended' : 'available',
    reason: recommended
      ? '当前产品证据和生产条件能够支撑该方向的关键镜头。'
      : '可以生成，但需要优先使用现有证据和可执行动作。',
    missingRequirements: [],
  };
}

export function buildPromptWizardCreativePlaybook(input: {
  graph: PromptWizardEvidenceGraph;
  productionBrief: PromptWizardProductionBrief;
  direction: PromptWizardCreativeBrief['direction'];
}): PromptWizardCreativePlaybook {
  const base = getPromptWizardDirectionBlueprint(input.direction);
  const assessment = assessPromptWizardDirection(input);
  const familyTreatment = FAMILY_DIRECTION_TREATMENT[input.graph.productFamily][input.direction];
  return {
    direction: input.direction,
    directionLabel: base.label,
    productFamily: input.graph.productFamily,
    productFamilyLabel: FAMILY_LABELS[input.graph.productFamily],
    objective: base.objective,
    familyTreatment,
    hookGuidance: [base.beatGuidance.hook, familyTreatment],
    proofGuidance: [...base.proofRules, ...capabilityProofGuidance(input.graph)],
    executionGuidance: [
      ...base.visualStyle,
      talentGuidance(input.productionBrief.appearanceMode),
      sceneGuidance(input.productionBrief.availableScenes),
    ],
    ctaGuidance: base.ctaTone,
    guardrails: [...base.guardrails],
    assessment,
  };
}

export function buildAllPromptWizardDirectionAssessments(input: {
  graph: PromptWizardEvidenceGraph;
  productionBrief: PromptWizardProductionBrief;
}) {
  return (Object.keys(DIRECTION_KEYS) as PromptWizardCreativeBrief['direction'][]).map(direction => (
    assessPromptWizardDirection({ ...input, direction })
  ));
}

const DIRECTION_KEYS: Record<PromptWizardCreativeBrief['direction'], true> = {
  ugc: true,
  'problem-solution': true,
  'unboxing-review': true,
  'feature-test': true,
  'pain-comparison': true,
  lifestyle: true,
  'cinematic-brand': true,
  'asmr-detail': true,
};

function capabilityProofGuidance(graph: PromptWizardEvidenceGraph) {
  const capabilities = derivePromptWizardEvidenceCapabilities(graph);
  const guidance: string[] = [];
  if (capabilities.hasUsageAction) guidance.push('优先使用一次完整、正确的产品操作作为主证据。');
  if (capabilities.hasVisibleStructure) guidance.push('可用结构近景或结构操作完成产品自证。');
  if (capabilities.hasLogoOrPrint) guidance.push('Logo、印花及可读原文只能保持参考图片原样。');
  if (capabilities.hasMaterialEvidence) guidance.push('材质只描述可见质感，不推断成分或性能。');
  return guidance.length > 0 ? guidance : ['仅使用证据图谱中的可靠事实，不补写待确认信息。'];
}

function talentGuidance(mode: PromptWizardProductionBrief['appearanceMode']) {
  if (mode === 'person') return '允许真人出镜，但人物动作必须服务产品自证。';
  if (mode === 'hands-only') return '只使用手部操作，不出现完整人物面部或虚构体验者。';
  if (mode === 'product-only') return '只展示产品，使用机位、光线和真实结构动作推进。';
  return '出镜方式尚未确认，优先采用手部或纯产品即可完成的路线。';
}

function sceneGuidance(scenes: readonly string[]) {
  return scenes.length > 0
    ? `只从当前可用场景中选择：${scenes.join('、')}。`
    : '场景尚未确认，路线必须能在普通桌面或中性空间落地。';
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}
export type { PromptWizardDirectionBlueprint };
