import { z } from 'zod';
import {
  tkPromptNarrativeBeatSchema,
  tkPromptPlanSchema,
  tkPromptStrategyBlueprintSchema,
  type TkPromptPlan,
  type TkPromptStrategyBlueprint,
} from '@lindyson/api-contracts';

export const TK_PROMPT_ENGINE_VERSION = 'tk-prompt-engine-1.0' as const;

export const TK_PROMPT_LANGUAGES = [
  '英语',
  '西班牙语',
  '葡萄牙语',
  '法语',
  '印尼语',
  '意大利语',
  '日语',
  '马来语',
  '泰语',
  '越南语',
  '普通话',
  '德语',
  '荷兰语',
  '波兰语',
] as const;

export const tkPromptLanguageSchema = z.enum(TK_PROMPT_LANGUAGES);
export type TkPromptLanguage = z.infer<typeof tkPromptLanguageSchema>;

export const TK_PROMPT_STYLE_FORMS = [
  'drama',
  'product',
  'presenter',
  'scene',
] as const;

export const TK_PROMPT_STYLES = [
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
] as const;

export const TK_PROMPT_VIDEO_MODES = [
  'product_closeup',
  'scene_demo',
  'live_presenter',
] as const;

export const tkPromptStyleFormSchema = z.enum(TK_PROMPT_STYLE_FORMS);
export const tkPromptStyleSchema = z.enum(TK_PROMPT_STYLES);
export const tkPromptVideoModeSchema = z.enum(TK_PROMPT_VIDEO_MODES);

export type TkPromptStyleForm = z.infer<typeof tkPromptStyleFormSchema>;
export type TkPromptStyle = z.infer<typeof tkPromptStyleSchema>;
export type TkPromptVideoMode = z.infer<typeof tkPromptVideoModeSchema>;

export const tkPromptEvidenceFlagsSchema = z.object({
  beforeAfter: z.boolean().default(false),
  competitor: z.boolean().default(false),
  numeric: z.boolean().default(false),
  realComment: z.boolean().default(false),
  popularity: z.boolean().default(false),
  honestExperience: z.boolean().default(false),
  sealedPackage: z.boolean().default(false),
}).strict();

export type TkPromptEvidenceFlags = z.infer<typeof tkPromptEvidenceFlagsSchema>;

export type TkPromptHookRequirement = keyof TkPromptEvidenceFlags;

export interface TkPromptHookPattern {
  id: string;
  name: string;
  stopRule: string;
  relevanceRule: string;
  bridgeRule: string;
  requirements: readonly TkPromptHookRequirement[];
  soundOnlyCompatible: boolean;
  /** 只能写入 Doubao 的策略参考上下文，不得返回 API 或最终执行 Prompt。 */
  internalExample: string;
}

export const TK_PROMPT_HOOK_PATTERNS: readonly TkPromptHookPattern[] = [
  {
    id: 'visual_shock',
    name: '视觉中断',
    stopRule: '第一帧直接出现商品相关的强动作或状态变化',
    relevanceRule: '紧接着展示这个变化对使用者的意义',
    bridgeRule: '沿同一动作进入商品证明',
    requirements: [],
    soundOnlyCompatible: true,
    internalExample: '微距中的水流突然落入商品结构，镜头随水流移动到关键部位。',
  },
  {
    id: 'sound_hook',
    name: '声音触发',
    stopRule: '以真实商品操作拟音触发视觉动作',
    relevanceRule: '让声音对应用户熟悉的使用瞬间',
    bridgeRule: '音画同步落到商品细节',
    requirements: [],
    soundOnlyCompatible: true,
    internalExample: '清脆卡扣声出现的同时，手部完成一次可见安装。',
  },
  {
    id: 'pain_strike',
    name: '痛点直击',
    stopRule: '立即呈现真实使用不便',
    relevanceRule: '明确它是目标用户会遇到的问题',
    bridgeRule: '用商品可见动作回应该问题',
    requirements: [],
    soundOnlyCompatible: true,
    internalExample: '先拍摄台面上可见的混乱，手立即把商品移入同一空间完成整理。',
  },
  {
    id: 'identity',
    name: '身份点名',
    stopRule: '开场点明具体使用人群',
    relevanceRule: '用对应场景证明与该人群有关',
    bridgeRule: '商品在该场景内开始工作',
    requirements: [],
    soundOnlyCompatible: false,
    internalExample: '口播只点名养宠人，画面同时展示参考商品的真实摆放场景。',
  },
  {
    id: 'suspense_question',
    name: '悬念提问',
    stopRule: '用与商品动作直接相关的问题留下信息缺口',
    relevanceRule: '第二拍给出可见线索',
    bridgeRule: '答案必须由商品结构或操作揭晓',
    requirements: [],
    soundOnlyCompatible: false,
    internalExample: '先问“这个位置为什么不会给台面添麻烦？”，再跟随手部展示结构。',
  },
  {
    id: 'unexpected',
    name: '意外开场',
    stopRule: '不先介绍，让商品第一帧就执行关键动作',
    relevanceRule: '展示动作发生的真实环境',
    bridgeRule: '继续同一动作完成证明',
    requirements: [],
    soundOnlyCompatible: true,
    internalExample: '第一帧就按下或打开商品的可见结构，不先摆拍全景。',
  },
  {
    id: 'contrast',
    name: '可见反差',
    stopRule: '用微距或局部遮挡隐藏答案',
    relevanceRule: '手部操作揭示结构关系',
    bridgeRule: '让结构支撑一个可验证事实',
    requirements: [],
    soundOnlyCompatible: true,
    internalExample: '镜头先只见细节，手部旋转商品后显示它与整体的连接。',
  },
  {
    id: 'before_after',
    name: '前后对照',
    stopRule: '并列或连续呈现真实前后素材',
    relevanceRule: '明确前后对应同一场景和条件',
    bridgeRule: '用商品操作连接两个状态',
    requirements: ['beforeAfter'],
    soundOnlyCompatible: true,
    internalExample: '使用用户提供的同场景前后图，中间只展示真实商品操作。',
  },
  {
    id: 'elimination_haul',
    name: '真实淘汰清单',
    stopRule: '直接展示用户提供的多款真实使用对象',
    relevanceRule: '保持同条件和同口径',
    bridgeRule: '仅陈述已确认的取舍原因',
    requirements: ['competitor'],
    soundOnlyCompatible: true,
    internalExample: '只用已提供的两件商品在同一台面完成同一项操作。',
  },
  {
    id: 'number_benefit',
    name: '数字利益',
    stopRule: '用用户确认的单一数字开场',
    relevanceRule: '说明数字的口径和对象',
    bridgeRule: '用可见操作支撑该数字',
    requirements: ['numeric'],
    soundOnlyCompatible: false,
    internalExample: '只使用用户确认的规格数字，画面展示对应标识和结构。',
  },
  {
    id: 'cost_math',
    name: '成本换算',
    stopRule: '用已确认价格和用量提出简单换算',
    relevanceRule: '展示换算所依赖的真实单位',
    bridgeRule: '不增加未确认的节省结论',
    requirements: ['numeric'],
    soundOnlyCompatible: false,
    internalExample: '按用户确认的套装数量和价格换算单件成本。',
  },
  {
    id: 'challenge_doubt',
    name: '挑战疑问',
    stopRule: '第一帧建立一项安全且可见的测试',
    relevanceRule: '明确测试条件',
    bridgeRule: '只展示现场可见结果',
    requirements: [],
    soundOnlyCompatible: true,
    internalExample: '在不损坏商品的前提下执行一次可见开合或放置测试。',
  },
  {
    id: 'honest_flaw',
    name: '真实缺点',
    stopRule: '以用户已确认的一个局限开场',
    relevanceRule: '说明该局限对哪类人有影响',
    bridgeRule: '再回到可确认的适用场景',
    requirements: ['honestExperience'],
    soundOnlyCompatible: false,
    internalExample: '只复述用户提供的一项真实局限，不进行虚构体验。',
  },
  {
    id: 'comment_reply',
    name: '真实评论回复',
    stopRule: '用用户提供的真实问题开场',
    relevanceRule: '画面直接演示问题对应部位',
    bridgeRule: '答复只使用已确认事实',
    requirements: ['realComment'],
    soundOnlyCompatible: false,
    internalExample: '念出用户提供的真实问题，随后在商品上指出对应结构。',
  },
  {
    id: 'hype_confirm',
    name: '热度验证',
    stopRule: '仅在有真实热度证据时提出验证',
    relevanceRule: '不展示伪造热度数字',
    bridgeRule: '回到商品自证而非从众结论',
    requirements: ['popularity'],
    soundOnlyCompatible: false,
    internalExample: '只引用用户提供的真实趋势上下文，随后完成商品操作验证。',
  },
  {
    id: 'confession',
    name: '真实坦白',
    stopRule: '以用户明确提供的真实经历开场',
    relevanceRule: '说明该经历对哪类用户有关',
    bridgeRule: '用当前商品的可见事实回应，不补造体验',
    requirements: ['honestExperience'],
    soundOnlyCompatible: false,
    internalExample: '只使用用户确认的一段真实经历，随后切入商品可见动作。',
  },
] as const;

export const TK_PROMPT_HOOK_IDS = [
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
] as const;
const hookIds = TK_PROMPT_HOOK_PATTERNS.map(pattern => pattern.id);
if (
  hookIds.length !== TK_PROMPT_HOOK_IDS.length
  || new Set(hookIds).size !== TK_PROMPT_HOOK_IDS.length
  || TK_PROMPT_HOOK_IDS.some(id => !hookIds.includes(id))
) {
  throw new Error('TK Prompt Engine 必须冻结16个唯一 Hook');
}
export const tkPromptHookIdSchema = z.enum(TK_PROMPT_HOOK_IDS);

export const tkPromptVerifiedOfferSchema = z.object({
  price: z.string().trim().min(1).max(80).optional(),
  condition: z.string().trim().min(1).max(300).optional(),
  endAt: z.string().datetime().optional(),
}).strict().refine(value => Object.keys(value).length > 0, '已验证优惠不能是空对象');

export const tkPromptEngineRequestSchema = z.object({
  imageAssetIds: z.array(z.string().uuid()).min(1).max(9),
  durationSeconds: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  targetMarket: z.string().trim().min(2).max(80),
  targetAudience: z.string().trim().max(500).default(''),
  spokenLanguage: tkPromptLanguageSchema.nullable(),
  userConfirmedFacts: z.array(z.string().trim().min(1).max(500)).max(40).default([]),
  forbiddenClaims: z.array(z.string().trim().min(1).max(300)).max(40).default([]),
  evidenceFlags: tkPromptEvidenceFlagsSchema.default({
    beforeAfter: false,
    competitor: false,
    numeric: false,
    realComment: false,
    popularity: false,
    honestExperience: false,
    sealedPackage: false,
  }),
  verifiedOffer: tkPromptVerifiedOfferSchema.nullable().default(null),
  appearanceMode: z.enum(['auto', ...TK_PROMPT_VIDEO_MODES]).default('auto'),
  preferLivePresenter: z.boolean().default(false),
  availableScenes: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  availableAssets: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
}).strict().superRefine((value, context) => {
  if (value.durationSeconds === 5 && value.spokenLanguage !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['spokenLanguage'],
      message: '5 秒纯声音方案的 spokenLanguage 必须为 null',
    });
  }
  if (value.durationSeconds !== 5 && value.spokenLanguage === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['spokenLanguage'],
      message: '10/15 秒口播方案必须选择 spokenLanguage',
    });
  }
  if (value.durationSeconds === 5 && value.verifiedOffer !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['verifiedOffer'],
      message: '5 秒纯声音设计方案不能提交优惠信息',
    });
  }
});

export type TkPromptEngineRequest = z.infer<typeof tkPromptEngineRequestSchema>;

export const tkPromptImageInputSchema = z.object({
  assetId: z.string().uuid(),
  name: z.string().min(1).max(300),
  url: z.string().url(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().nonnegative().max(10 * 1024 * 1024),
}).strict();

export type TkPromptImageInput = z.infer<typeof tkPromptImageInputSchema>;

const TK_PROMPT_NEUTRAL_DEMONSTRABLE_ACTION = '手部指向并展示图片中可见的商品特征';

const tkPromptFactAnalysisWireSchema = z.object({
  productName: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(120),
  confidence: z.enum(['high', 'medium', 'low']),
  visibleFacts: z.array(z.object({
    text: z.string().trim().min(1).max(300),
    sourceImageIndexes: z.array(z.number().int().min(0).max(8)).min(1).max(9),
    confidence: z.enum(['high', 'medium']),
  }).strict()).min(1).max(30),
  internalHypotheses: z.array(z.object({
    text: z.string().trim().min(1).max(300),
    purpose: z.enum(['audience', 'scenario', 'strategy-selection']),
  }).strict()).max(20),
  demonstrableActions: z.array(z.object({
    actionId: z.string().regex(/^action-\d{3}$/u),
    text: z.string().trim().min(1).max(240),
    supportingFactIndexes: z.array(z.number().int().min(0).max(29)).min(1).max(20),
  }).strict()).min(1).max(12),
}).strict();

export const tkPromptFactAnalysisSchema = tkPromptFactAnalysisWireSchema.superRefine((analysis, context) => {
  analysis.demonstrableActions.forEach((action, actionIndex) => {
    const expectedActionId = `action-${String(actionIndex + 1).padStart(3, '0')}`;
    if (action.actionId !== expectedActionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['demonstrableActions', actionIndex, 'actionId'],
        message: `可演示动作必须按顺序使用 ${expectedActionId}`,
      });
    }
    if (
      new Set(action.supportingFactIndexes).size !== action.supportingFactIndexes.length
      || action.supportingFactIndexes.some(index => index >= analysis.visibleFacts.length)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['demonstrableActions', actionIndex, 'supportingFactIndexes'],
        message: '可演示动作必须引用唯一且存在的图片事实序号',
      });
    }
  });
});

export type TkPromptFactAnalysis = z.infer<typeof tkPromptFactAnalysisSchema>;

/**
 * Structured-output JSON Schema cannot express sequential IDs or references whose
 * upper bound depends on visibleFacts.length. Repair only those structural links;
 * never invent a product claim or carry an unsupported action description forward.
 */
export function normalizeTkPromptFactAnalysisStructure(
  rawAnalysis: unknown,
  imageCount = 9,
  internalIdentifiers: string[] = [],
): TkPromptFactAnalysis {
  if (!Number.isInteger(imageCount) || imageCount < 1 || imageCount > 9) {
    throw tkPromptContractError(
      'TK_PROMPT_IMAGE_REFERENCE_COUNT_INVALID',
      '事实分析绑定的参考图数量无效',
    );
  }
  const source = rawAnalysis && typeof rawAnalysis === 'object' && !Array.isArray(rawAnalysis)
    ? rawAnalysis as Record<string, unknown>
    : {};
  const text = (value: unknown, fallback: string, maximum: number) => {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim();
    if (!normalized) return fallback;
    return sanitizeTkPromptInternalIdentifiers(
      normalized.slice(0, maximum).replace(/[\uD800-\uDBFF]$/u, ''),
      fallback,
      internalIdentifiers,
    );
  };
  const visibleFacts = (Array.isArray(source.visibleFacts) ? source.visibleFacts : [])
    .flatMap((value): Array<{
      text: string;
      sourceImageIndexes: number[];
      confidence: 'high' | 'medium';
    }> => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const fact = value as Record<string, unknown>;
      const factText = text(fact.text, '', 300);
      if (!factText) return [];
      const sourceImageIndexes = [...new Set(
        (Array.isArray(fact.sourceImageIndexes) ? fact.sourceImageIndexes : [])
          .filter((index): index is number => (
            Number.isInteger(index) && Number(index) >= 0 && Number(index) < imageCount
          )),
      )].slice(0, 9);
      return [{
        text: factText,
        sourceImageIndexes: sourceImageIndexes.length > 0 ? sourceImageIndexes : [0],
        confidence: fact.confidence === 'high' ? 'high' : 'medium',
      }];
    })
    .slice(0, 30);
  const internalHypotheses = (Array.isArray(source.internalHypotheses)
    ? source.internalHypotheses
    : [])
    .flatMap((value): Array<{
      text: string;
      purpose: 'audience' | 'scenario' | 'strategy-selection';
    }> => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const hypothesis = value as Record<string, unknown>;
      const hypothesisText = text(hypothesis.text, '', 300);
      if (!hypothesisText || ![
        'audience', 'scenario', 'strategy-selection',
      ].includes(String(hypothesis.purpose))) return [];
      return [{
        text: hypothesisText,
        purpose: hypothesis.purpose as 'audience' | 'scenario' | 'strategy-selection',
      }];
    })
    .slice(0, 20);
  const rawActions = Array.isArray(source.demonstrableActions)
    ? source.demonstrableActions
    : [];
  const normalizedActions = rawActions.flatMap((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const action = value as Record<string, unknown>;
    const supportingFactIndexes = [...new Set(
      (Array.isArray(action.supportingFactIndexes) ? action.supportingFactIndexes : [])
        .filter((factIndex): factIndex is number => (
          Number.isInteger(factIndex)
          && Number(factIndex) >= 0
          && Number(factIndex) < visibleFacts.length
        )),
    )].slice(0, 20);
    return [{
      actionId: `action-${String(index + 1).padStart(3, '0')}`,
      text: supportingFactIndexes.length > 0
        ? text(action.text, TK_PROMPT_NEUTRAL_DEMONSTRABLE_ACTION, 240)
        : TK_PROMPT_NEUTRAL_DEMONSTRABLE_ACTION,
      supportingFactIndexes: supportingFactIndexes.length > 0
        ? supportingFactIndexes
        : [0],
    }];
  }).slice(0, 12);
  const analysis = tkPromptFactAnalysisWireSchema.parse({
    productName: text(source.productName, '参考商品', 160),
    category: text(source.category, '未分类商品', 120),
    confidence: ['high', 'medium', 'low'].includes(String(source.confidence))
      ? source.confidence
      : 'low',
    visibleFacts,
    internalHypotheses,
    demonstrableActions: normalizedActions.length > 0
      ? normalizedActions
      : [{
          actionId: 'action-001',
          text: TK_PROMPT_NEUTRAL_DEMONSTRABLE_ACTION,
          supportingFactIndexes: [0],
        }],
  });
  const demonstrableActions = analysis.demonstrableActions.map((action, index) => {
    const supportingFactIndexes = [...new Set(action.supportingFactIndexes)]
      .filter(factIndex => factIndex < analysis.visibleFacts.length);
    return {
      actionId: `action-${String(index + 1).padStart(3, '0')}`,
      text: supportingFactIndexes.length > 0
        ? action.text
        : TK_PROMPT_NEUTRAL_DEMONSTRABLE_ACTION,
      supportingFactIndexes: supportingFactIndexes.length > 0
        ? supportingFactIndexes
        : [0],
    };
  });
  return tkPromptFactAnalysisSchema.parse({
    ...analysis,
    demonstrableActions,
  });
}

export const tkPromptFactSchema = z.object({
  factId: z.string().regex(/^(?:visible|confirmed)-\d{3}$/u),
  status: z.enum(['visible', 'user-confirmed']),
  text: z.string().trim().min(1).max(500),
  sourceImageIds: z.array(z.string().uuid()).max(9),
}).strict();

export const tkPromptDemonstrableActionSchema = z.object({
  actionId: z.string().regex(/^action-\d{3}$/u),
  text: z.string().trim().min(1).max(300),
  supportingFactIds: z.array(z.string().regex(/^visible-\d{3}$/u)).min(1).max(20),
  sourceImageAssetIds: z.array(z.string().uuid()).min(1).max(9),
}).strict();

export const tkPromptFactPackSchema = z.object({
  productName: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(200),
  confidence: z.enum(['high', 'medium', 'low']),
  facts: z.array(tkPromptFactSchema).min(1).max(50),
  internalHypotheses: z.array(z.object({
    text: z.string().trim().min(1).max(300),
    purpose: z.enum(['audience', 'scenario', 'strategy-selection']),
  }).strict()).max(20),
  demonstrableActions: z.array(tkPromptDemonstrableActionSchema).max(12),
  forbiddenClaims: z.array(z.string().trim().min(1).max(300)).max(40),
  availableMaterials: z.tuple([z.literal('product-images')]),
  targetMarket: z.string().trim().min(2).max(80),
  spokenLanguage: tkPromptLanguageSchema.nullable(),
  verifiedOffer: tkPromptVerifiedOfferSchema.nullable(),
}).strict().superRefine((factPack, context) => {
  const visibleFactById = new Map(factPack.facts
    .filter(fact => fact.status === 'visible')
    .map(fact => [fact.factId, fact] as const));
  if (new Set(factPack.demonstrableActions.map(action => action.actionId)).size
    !== factPack.demonstrableActions.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['demonstrableActions'],
      message: '可演示动作 ID 必须唯一',
    });
  }
  factPack.demonstrableActions.forEach((action, actionIndex) => {
    if (new Set(action.supportingFactIds).size !== action.supportingFactIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['demonstrableActions', actionIndex, 'supportingFactIds'],
        message: '可演示动作的支撑事实不能重复',
      });
    }
    const supportingFacts = action.supportingFactIds.flatMap(factId => {
      const fact = visibleFactById.get(factId);
      if (fact) return [fact];
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['demonstrableActions', actionIndex, 'supportingFactIds'],
        message: `可演示动作引用了未知或已拒绝的图片事实 ${factId}`,
      });
      return [];
    });
    const expectedSourceIds = new Set(supportingFacts.flatMap(fact => fact.sourceImageIds));
    const actualSourceIds = new Set(action.sourceImageAssetIds);
    if (
      actualSourceIds.size !== action.sourceImageAssetIds.length
      || actualSourceIds.size !== expectedSourceIds.size
      || [...actualSourceIds].some(id => !expectedSourceIds.has(id))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['demonstrableActions', actionIndex, 'sourceImageAssetIds'],
        message: '可演示动作的来源图片必须与支撑事实精确闭合',
      });
    }
  });
});

export type TkPromptFactPack = z.infer<typeof tkPromptFactPackSchema>;

export const tkPromptPlanIdSchema = z.enum(['safe', 'native', 'creative']);
export const tkPromptObjectiveSchema = z.enum(['conversion', 'trust', 'attention']);
export const tkPromptFirstFrameSchema = z.enum([
  'macro_action',
  'pain_reveal',
  'pov_entry',
  'sound_sync',
  'structure_reveal',
  'question_setup',
  'unboxing_reveal',
  'scene_interrupt',
]);
export const tkPromptBuyingMotivationSchema = z.enum([
  'problem_relief',
  'ease_of_use',
  'confidence',
  'identity_fit',
  'curiosity',
  'value_clarity',
]);
export const tkPromptProofMethodSchema = z.enum([
  'visible_operation',
  'structure_closeup',
  'context_demo',
  'verified_comparison',
  'verified_before_after',
  'presenter_delivery',
]);

export const tkPromptStrategySchema = tkPromptStrategyBlueprintSchema;

export const tkPromptStrategySetSchema = z.object({
  strategies: z.array(tkPromptStrategySchema).length(3),
}).strict();

export type TkPromptStrategy = TkPromptStrategyBlueprint;

export const tkPromptBeatSchema = tkPromptNarrativeBeatSchema;

export const TK_PROMPT_CAMERA_MOVEMENT_IDS = [
  'locked_off',
  'slow_push_in',
  'gentle_pull_back',
  'lateral_track',
  'handheld_follow',
  'macro_follow',
] as const;

export const tkPromptCameraMovementIdSchema = z.enum(TK_PROMPT_CAMERA_MOVEMENT_IDS);
export type TkPromptCameraMovementId = z.infer<typeof tkPromptCameraMovementIdSchema>;

export const TK_PROMPT_CAMERA_MOVEMENT_TEXT: Readonly<Record<TkPromptCameraMovementId, string>> = {
  locked_off: '锁定机位，不移动镜头',
  slow_push_in: '稳定缓慢推近',
  gentle_pull_back: '稳定轻缓后拉',
  lateral_track: '稳定水平跟移',
  handheld_follow: '轻微手持跟随',
  macro_follow: '微距稳定跟随',
};

const tkPromptCoreInformationPointSchema = z.object({
  messageId: z.string().regex(/^message-00[1-3]$/u),
  message: z.string().trim().min(1).max(500),
  factIds: z.array(z.string().regex(/^(?:visible|confirmed)-\d{3}$/u)).min(1).max(8),
}).strict();

const tkPromptInternalBeatSchema = z.object({
  startSeconds: z.number().finite().min(0).max(15),
  endSeconds: z.number().finite().gt(0).max(15),
  environment: z.string().trim().min(1).max(500),
  subject: z.string().trim().min(1).max(360),
  action: z.string().trim().min(1).max(400),
  shotSize: z.string().trim().min(1).max(120),
  lighting: z.string().trim().min(1).max(300),
  editingCue: z.string().trim().min(1).max(300),
  soundDesign: z.string().trim().min(1).max(500),
  voiceoverTarget: z.string().trim().max(800),
  voiceoverZh: z.string().trim().max(800),
  factIds: z.array(z.string().regex(/^(?:visible|confirmed)-\d{3}$/u)).max(20),
  coreInformationPointIds: z.array(z.string().regex(/^message-00[1-3]$/u)).max(1),
  actionPhase: z.enum(['start', 'progress', 'complete']).nullable(),
  productImageIndex: z.number().int().min(1).max(9),
  presenterVisible: z.boolean(),
  movementId: tkPromptCameraMovementIdSchema,
}).strict().refine(beat => beat.endSeconds > beat.startSeconds, {
  path: ['endSeconds'],
  message: '分镜结束时间必须晚于开始时间',
});

export const tkPromptOptionCandidateSchema = z.object({
  title: z.string().trim().min(1).max(100),
  whyItFits: z.string().trim().min(1).max(360),
  coreInformationPoints: z.array(tkPromptCoreInformationPointSchema).min(1).max(3),
  primaryActionId: z.string().regex(/^action-\d{3}$/u).nullable(),
  beats: z.array(tkPromptInternalBeatSchema).min(3).max(5),
  assumptions: z.array(z.string().trim().min(1).max(300)).max(20),
  requiredMaterials: z.array(z.string().trim().min(1).max(300)).max(20),
  warnings: z.array(z.string().trim().min(1).max(300)).max(20),
}).strict();

export type TkPromptOptionCandidate = z.infer<typeof tkPromptOptionCandidateSchema>;

export const tkPromptOptionSchema = tkPromptPlanSchema;

export type TkPromptOption = TkPromptPlan;

export const tkPromptProviderUsageSchema = z.object({
  operation: z.enum(['facts', 'strategies', 'option', 'option-repair']),
  planId: tkPromptPlanIdSchema.nullable(),
  responseId: z.string().nullable(),
  model: z.string(),
  attempts: z.number().int().positive(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
}).strict();

export type TkPromptProviderUsage = z.infer<typeof tkPromptProviderUsageSchema>;

export const tkPromptEngineResultSchema = z.object({
  engineVersion: z.literal(TK_PROMPT_ENGINE_VERSION),
  factPack: tkPromptFactPackSchema,
  options: z.array(tkPromptOptionSchema).length(3),
  usage: z.array(tkPromptProviderUsageSchema).min(5).max(8),
}).strict();

export type TkPromptEngineResult = z.infer<typeof tkPromptEngineResultSchema>;

export function eligibleTkPromptHookIds(input: {
  durationSeconds: 5 | 10 | 15;
  evidenceFlags: TkPromptEvidenceFlags;
}) {
  return TK_PROMPT_HOOK_PATTERNS.filter(pattern => (
    (input.durationSeconds !== 5 || pattern.soundOnlyCompatible)
    && pattern.requirements.every(requirement => input.evidenceFlags[requirement])
  )).map(pattern => pattern.id);
}

/**
 * Hook/证明资格只能由用户确认的事实升级。场景和可用素材是执行条件，
 * 不是“真实评论/竞品/前后”等主张的证据。已验证优惠只能补充 numeric 资格。
 */
export function deriveTkPromptEvidenceFlags(input: {
  userConfirmedFacts: string[];
  verifiedOffer: string;
  availableScenes?: string[];
  availableAssets?: string[];
}): TkPromptEvidenceFlags {
  const affirmedFacts = input.userConfirmedFacts.filter(fact => !isNegatedTkPromptEvidence(fact));
  const hasAffirmed = (pattern: RegExp) => affirmedFacts.some(fact => pattern.test(fact));
  return {
    beforeAfter: hasAffirmed(/(?:前后(?:对比|素材|效果|状态)|使用前后|before\s*(?:and|&|\/)\s*after(?:\s+(?:evidence|material|comparison))?)/iu),
    competitor: hasAffirmed(/(?:竞品(?:素材|商品|对比|证据)|对比商品|competitor\s+(?:evidence|product|comparison))/iu),
    numeric: affirmedFacts.some(fact => /\d/u.test(fact)) || /\d/u.test(input.verifiedOffer),
    realComment: hasAffirmed(/(?:真实评论(?:原文|问题|素材|证据)?|用户(?:评论|提问|问题)原文|real\s+(?:comment|review)|review\s+question|comment\s+evidence)/iu),
    popularity: hasAffirmed(/(?:真实(?:热度|趋势)(?:证据|数据|素材)|趋势证据|trend\s+evidence|popularity\s+evidence)/iu),
    honestExperience: hasAffirmed(/(?:真实经历(?:原文|内容|素材)?|实际体验(?:内容|记录)?|真实(?:缺点|局限)|honest\s+experience|personal\s+experience)/iu),
    sealedPackage: hasAffirmed(/(?:未拆封(?:包装|商品|素材)|完整封装(?:素材|包装)|sealed\s+package|unopened\s+package)/iu),
  };
}

const TK_PROMPT_EVIDENCE_PATTERNS: Readonly<Record<keyof TkPromptEvidenceFlags, RegExp>> = {
  beforeAfter: /(?:前后(?:对比|素材|效果|状态)|使用前后|before\s*(?:and|&|\/)\s*after)/iu,
  competitor: /(?:竞品(?:素材|商品|对比|证据)|对比商品|competitor\s+(?:evidence|product|comparison))/iu,
  numeric: /\d/u,
  realComment: /(?:真实评论(?:原文|问题|素材|证据)?|用户(?:评论|提问|问题)原文|real\s+(?:comment|review)|review\s+question|comment\s+evidence)/iu,
  popularity: /(?:真实(?:热度|趋势)(?:证据|数据|素材)|趋势证据|trend\s+evidence|popularity\s+evidence)/iu,
  honestExperience: /(?:真实经历(?:原文|内容|素材)?|实际体验(?:内容|记录)?|真实(?:缺点|局限)|honest\s+experience|personal\s+experience)/iu,
  sealedPackage: /(?:未拆封(?:包装|商品|素材)|完整封装(?:素材|包装)|sealed\s+package|unopened\s+package)/iu,
};

function isNegatedTkPromptEvidence(value: string) {
  return /(?:没有|并无|(?:^|[，。；,;\s])无|缺少|未提供|不含|不是|不存在|禁止|不得|不要|不可).{0,12}(?:前后|竞品|对比商品|数字|\d|评论|用户问题|热度|趋势|经历|体验|缺点|局限|拆封|封装)|(?:no|without|missing|not\s+(?:provided|available|present)|do\s+not\s+(?:use|have|include)).{0,24}(?:before|after|competitor|comparison|number|\d|comment|review|trend|popularity|experience|sealed|unopened)/iu.test(value);
}

function tkPromptEvidenceFactIds(
  factPack: TkPromptFactPack,
  flag: keyof TkPromptEvidenceFlags,
) {
  const pattern = TK_PROMPT_EVIDENCE_PATTERNS[flag];
  return new Set(factPack.facts.flatMap(fact => (
    fact.status === 'user-confirmed'
    && !isNegatedTkPromptEvidence(fact.text)
    && pattern.test(fact.text)
      ? [fact.factId]
      : []
  )));
}

export function tkPromptDemonstrableActionRegistry(factPack: TkPromptFactPack) {
  return factPack.demonstrableActions.map(action => ({ ...action }));
}

const STYLE_FORM_BY_STYLE: Readonly<Record<TkPromptStyle, TkPromptStyleForm>> = {
  drama: 'drama',
  reversal: 'drama',
  interview: 'drama',
  story: 'drama',
  unboxing: 'product',
  product_pov: 'product',
  comparison: 'product',
  talking_head: 'presenter',
  pain_point: 'presenter',
  scene: 'scene',
};

export function validateTkPromptStrategySet(input: {
  strategySet: unknown;
  factPack: TkPromptFactPack;
  durationSeconds: 5 | 10 | 15;
  evidenceFlags: TkPromptEvidenceFlags;
  requireLivePresenter?: boolean;
}) {
  const parsed = tkPromptStrategySetSchema.parse(input.strategySet);
  const expected = [
    ['safe', 'conversion'],
    ['native', 'trust'],
    ['creative', 'attention'],
  ] as const;
  const factIds = new Set(input.factPack.facts.map(fact => fact.factId));
  const eligibleHooks = new Set(eligibleTkPromptHookIds(input));

  const strategyUsesEvidenceFact = (
    strategy: TkPromptStrategy,
    flag: keyof TkPromptEvidenceFlags,
  ) => {
    const supportingFactIds = tkPromptEvidenceFactIds(input.factPack, flag);
    return strategy.allowedFactIds.some(factId => supportingFactIds.has(factId));
  };

  parsed.strategies.forEach((strategy, index) => {
    const [planId, objective] = expected[index]!;
    if (strategy.slot !== planId || strategy.objective !== objective) {
      throw tkPromptContractError(
        'TK_PROMPT_STRATEGY_SLOT_INVALID',
        `策略槽 ${index} 必须是 ${planId}/${objective}`,
      );
    }
    if (STYLE_FORM_BY_STYLE[strategy.style] !== strategy.styleForm) {
      throw tkPromptContractError(
        'TK_PROMPT_STYLE_FORM_INVALID',
        `策略 ${strategy.slot} 的 Style 与 Form 不匹配`,
      );
    }
    if (!eligibleHooks.has(strategy.hookPatternId)) {
      throw tkPromptContractError(
        'TK_PROMPT_HOOK_NOT_ELIGIBLE',
        `策略 ${strategy.slot} 的 Hook 缺少必要证据`,
      );
    }
    const hookPattern = TK_PROMPT_HOOK_PATTERNS.find(
      pattern => pattern.id === strategy.hookPatternId,
    )!;
    for (const requirement of hookPattern.requirements) {
      const verifiedOfferSupportsNumeric = requirement === 'numeric'
        && /\d/u.test(JSON.stringify(input.factPack.verifiedOffer ?? {}));
      const supportingFactIds = tkPromptEvidenceFactIds(input.factPack, requirement);
      if (
        !verifiedOfferSupportsNumeric
        && !strategy.allowedFactIds.some(factId => supportingFactIds.has(factId))
      ) {
        throw tkPromptContractError(
          'TK_PROMPT_HOOK_EVIDENCE_FACT_REQUIRED',
          `策略 ${strategy.slot} 的 Hook 未引用对应证据事实`,
        );
      }
    }
    if (input.durationSeconds === 5 && strategy.openingLine !== '') {
      throw tkPromptContractError(
        'TK_PROMPT_SOUND_ONLY_OPENING_LINE_FORBIDDEN',
        `5 秒纯声音策略 ${strategy.slot} 的 openingLine 必须为空`,
      );
    }
    if (
      (strategy.style === 'interview'
        || strategy.style === 'talking_head'
        || strategy.proofMethodId === 'presenter_delivery')
      && strategy.videoMode !== 'live_presenter'
    ) {
      throw tkPromptContractError(
        'TK_PROMPT_PRESENTER_MODE_REQUIRED',
        `策略 ${strategy.slot} 的真人风格或证明必须使用 live_presenter`,
      );
    }
    if (strategy.hookPatternId === 'cost_math' && input.factPack.verifiedOffer === null) {
      throw tkPromptContractError(
        'TK_PROMPT_COST_MATH_OFFER_REQUIRED',
        `策略 ${strategy.slot} 的成本换算 Hook 缺少已验证优惠`,
      );
    }
    if (strategy.style === 'comparison' && !input.evidenceFlags.competitor) {
      throw tkPromptContractError(
        'TK_PROMPT_COMPARISON_EVIDENCE_REQUIRED',
        '对比风格缺少用户确认的竞品证据',
      );
    }
    if (strategy.style === 'comparison' && !strategyUsesEvidenceFact(strategy, 'competitor')) {
      throw tkPromptContractError(
        'TK_PROMPT_COMPARISON_EVIDENCE_FACT_REQUIRED',
        '对比风格未引用用户确认的竞品证据事实',
      );
    }
    if (strategy.proofMethodId === 'verified_comparison' && !input.evidenceFlags.competitor) {
      throw tkPromptContractError(
        'TK_PROMPT_COMPARISON_EVIDENCE_REQUIRED',
        '已验证对比证明缺少用户确认的竞品证据',
      );
    }
    if (
      strategy.proofMethodId === 'verified_comparison'
      && !strategyUsesEvidenceFact(strategy, 'competitor')
    ) {
      throw tkPromptContractError(
        'TK_PROMPT_COMPARISON_EVIDENCE_FACT_REQUIRED',
        '已验证对比证明未引用用户确认的竞品证据事实',
      );
    }
    if (strategy.proofMethodId === 'verified_before_after' && !input.evidenceFlags.beforeAfter) {
      throw tkPromptContractError(
        'TK_PROMPT_BEFORE_AFTER_EVIDENCE_REQUIRED',
        '已验证前后对照证明缺少用户确认的前后素材',
      );
    }
    if (
      strategy.proofMethodId === 'verified_before_after'
      && !strategyUsesEvidenceFact(strategy, 'beforeAfter')
    ) {
      throw tkPromptContractError(
        'TK_PROMPT_BEFORE_AFTER_EVIDENCE_FACT_REQUIRED',
        '已验证前后对照未引用用户确认的前后证据事实',
      );
    }
    if (strategy.style === 'unboxing' && !input.evidenceFlags.sealedPackage) {
      throw tkPromptContractError(
        'TK_PROMPT_UNBOXING_MATERIAL_REQUIRED',
        '开箱风格缺少用户确认的完整封装素材',
      );
    }
    if (strategy.style === 'unboxing' && !strategyUsesEvidenceFact(strategy, 'sealedPackage')) {
      throw tkPromptContractError(
        'TK_PROMPT_UNBOXING_EVIDENCE_FACT_REQUIRED',
        '开箱风格未引用用户确认的未拆封素材事实',
      );
    }
    if (strategy.allowedFactIds.some(factId => !factIds.has(factId))) {
      throw tkPromptContractError(
        'TK_PROMPT_UNKNOWN_FACT_REFERENCE',
        `策略 ${strategy.slot} 引用了未知事实`,
      );
    }
    assertTkPromptPromotionBoundToOffer(
      JSON.stringify(strategy),
      input.factPack.verifiedOffer,
      `策略 ${strategy.slot}`,
      tkPromptAllowedFactTexts(input.factPack, strategy.allowedFactIds),
    );
    assertTkPromptForbiddenClaimsAbsent(
      JSON.stringify(strategy),
      input.factPack.forbiddenClaims,
      `策略 ${strategy.slot}`,
    );
  });

  if (input.requireLivePresenter
    && !parsed.strategies.some(strategy => strategy.videoMode === 'live_presenter')) {
    throw tkPromptContractError(
      'TK_PROMPT_LIVE_PRESENTER_REQUIRED',
      '用户已选择人物出镜，三案中至少一案必须使用 live_presenter',
    );
  }

  const serializedStrategies = JSON.stringify(parsed.strategies);
  if (TK_PROMPT_FORBIDDEN_PERSONA_PATTERN.test(serializedStrategies)) {
    throw tkPromptContractError(
      'TK_PROMPT_EXPERT_HISTORY_LEAKED',
      '虚构专家履历不得进入策略输出',
    );
  }
  if (TK_PROMPT_AI_DISCLOSURE_PATTERN.test(serializedStrategies)) {
    throw tkPromptContractError(
      'TK_PROMPT_AI_DISCLOSURE_FORBIDDEN',
      '策略不得生成 AI 声明',
    );
  }
  if (containsFabricatedTkPromptPresenterExperience(serializedStrategies)) {
    throw tkPromptContractError(
      'TK_PROMPT_PRESENTER_EXPERIENCE_FORBIDDEN',
      '策略不得虚构主持人的个人使用经历、测评身份或购买经历',
    );
  }
  if (TK_PROMPT_HOOK_PATTERNS.some(pattern => (
    pattern.internalExample.length >= 12
    && normalizeTkPromptLeakText(serializedStrategies)
      .includes(normalizeTkPromptLeakText(pattern.internalExample))
  ))) {
    throw tkPromptContractError(
      'TK_PROMPT_INTERNAL_HOOK_EXAMPLE_LEAKED',
      'Hook 内部教学案例不得进入策略输出',
    );
  }

  for (let left = 0; left < parsed.strategies.length; left += 1) {
    for (let right = left + 1; right < parsed.strategies.length; right += 1) {
      const leftStrategy = parsed.strategies[left]!;
      const rightStrategy = parsed.strategies[right]!;
      const dimensions = [
        leftStrategy.styleForm !== rightStrategy.styleForm,
        leftStrategy.style !== rightStrategy.style,
        leftStrategy.hookPatternId !== rightStrategy.hookPatternId,
        leftStrategy.firstFrameId !== rightStrategy.firstFrameId,
        leftStrategy.buyingMotivationId !== rightStrategy.buyingMotivationId,
        leftStrategy.proofMethodId !== rightStrategy.proofMethodId,
      ];
      if (dimensions.filter(Boolean).length < 4) {
        throw tkPromptContractError(
          'TK_PROMPT_STRATEGY_DIVERSITY_INVALID',
          `策略 ${leftStrategy.slot} 与 ${rightStrategy.slot} 的六维差异少于四项`,
        );
      }
    }
  }
  return parsed.strategies;
}

const TK_PROMPT_NEUTRAL_STRATEGY_TEXT = {
  labelZh: {
    safe: '最稳',
    native: '最原生',
    creative: '最抓眼',
  },
  firstFrame: '首帧立即展示商品的可见结构或操作动作',
  openingAction: '立即开始一次由已允许事实支撑的商品操作',
  openingLine: '',
  relevanceBeat: '沿同一商品动作展示它与使用场景的关系',
  productBridge: '沿同一动作进入商品结构与操作细节',
  buyingMotivation: '帮助观众快速理解商品的使用方式',
  proofMethod: '使用参考图中可见的结构与操作过程进行展示',
  ctaStrategy: '引导观众点击商品卡查看商品详情',
} as const;

const TK_PROMPT_PROMOTION_ERROR_CODES = new Set([
  'TK_PROMPT_UNVERIFIED_PROMOTION_FORBIDDEN',
  'TK_PROMPT_PROMOTION_ENHANCEMENT_FORBIDDEN',
  'TK_PROMPT_PROMOTION_VALUE_UNVERIFIED',
]);

/**
 * Provider 的策略自由文本偶尔会扩写未验证促销、人物或其他不安全指令。
 * 这里只替换不安全字段，再交回权威校验；不会放行声明或产生额外请求。
 */
export function normalizeTkPromptStrategyPromotions(input: {
  strategySet: unknown;
  factPack: TkPromptFactPack;
}) {
  const parsed = tkPromptStrategySetSchema.parse(input.strategySet);
  const internalIdentifiers = [
    ...input.factPack.facts.flatMap(fact => [fact.factId, ...fact.sourceImageIds]),
    ...input.factPack.demonstrableActions.map(action => action.actionId),
  ];
  return {
    strategies: parsed.strategies.map(strategy => {
      const supportedFacts = tkPromptAllowedFactTexts(
        input.factPack,
        strategy.allowedFactIds,
      );
      const normalizeText = (value: string, fallback: string) => {
        try {
          assertTkPromptPromotionBoundToOffer(
            value,
            input.factPack.verifiedOffer,
            `策略 ${strategy.slot}`,
            supportedFacts,
          );
          assertTkPromptForbiddenClaimsAbsent(
            value,
            input.factPack.forbiddenClaims,
            `策略 ${strategy.slot}`,
          );
        } catch (error) {
          const code = error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
          if (
            !TK_PROMPT_PROMOTION_ERROR_CODES.has(code)
            && code !== 'TK_PROMPT_FORBIDDEN_CLAIM_LEAKED'
          ) throw error;
          return fallback;
        }
        if (
          containsPositiveTkPromptTextOverlayInstruction(value)
          || containsFabricatedTkPromptPresenterExperience(value)
          || TK_PROMPT_FORBIDDEN_PERSONA_PATTERN.test(value)
          || TK_PROMPT_AI_DISCLOSURE_PATTERN.test(value)
          || TK_PROMPT_FREE_REFERENCE_PATTERN.test(value)
          || TK_PROMPT_UUID_PATTERN.test(value)
          || TK_PROMPT_INTERNAL_ID_PATTERN.test(value)
          || containsTkPromptKnownInternalIdentifier(value, internalIdentifiers)
          || (
            strategy.videoMode !== 'live_presenter'
            && (
              TK_PROMPT_PERSON_REFERENCE_PATTERN.test(value)
              || containsPositiveTkPromptPersonInstruction(value)
            )
          )
          || TK_PROMPT_HOOK_PATTERNS.some(pattern => (
            pattern.internalExample.length >= 12
            && normalizeTkPromptLeakText(value)
              .includes(normalizeTkPromptLeakText(pattern.internalExample))
          ))
        ) return fallback;
        return value;
      };

      return {
        ...strategy,
        labelZh: normalizeText(
          strategy.labelZh,
          TK_PROMPT_NEUTRAL_STRATEGY_TEXT.labelZh[strategy.slot],
        ),
        firstFrame: normalizeText(
          strategy.firstFrame,
          TK_PROMPT_NEUTRAL_STRATEGY_TEXT.firstFrame,
        ),
        openingAction: normalizeText(
          strategy.openingAction,
          TK_PROMPT_NEUTRAL_STRATEGY_TEXT.openingAction,
        ),
        openingLine: normalizeText(
          strategy.openingLine,
          TK_PROMPT_NEUTRAL_STRATEGY_TEXT.openingLine,
        ),
        relevanceBeat: normalizeText(
          strategy.relevanceBeat,
          TK_PROMPT_NEUTRAL_STRATEGY_TEXT.relevanceBeat,
        ),
        productBridge: normalizeText(
          strategy.productBridge,
          TK_PROMPT_NEUTRAL_STRATEGY_TEXT.productBridge,
        ),
        buyingMotivation: normalizeText(
          strategy.buyingMotivation,
          TK_PROMPT_NEUTRAL_STRATEGY_TEXT.buyingMotivation,
        ),
        proofMethod: normalizeText(
          strategy.proofMethod,
          TK_PROMPT_NEUTRAL_STRATEGY_TEXT.proofMethod,
        ),
        ctaStrategy: normalizeText(
          strategy.ctaStrategy,
          TK_PROMPT_NEUTRAL_STRATEGY_TEXT.ctaStrategy,
        ),
        requiredMaterials: strategy.requiredMaterials.flatMap(material => (
          normalizeText(material, '') ? [material] : []
        )),
      };
    }),
  };
}

const TK_PROMPT_NON_PRESENTER_STRATEGY_FALLBACK = {
  safe: {
    styleForm: 'scene',
    style: 'scene',
    proofMethodId: 'visible_operation',
    proofMethod: '使用参考图中可见的结构与操作过程进行展示',
  },
  native: {
    styleForm: 'product',
    style: 'product_pov',
    proofMethodId: 'structure_closeup',
    proofMethod: '使用商品结构近景与可见操作进行展示',
  },
  creative: {
    styleForm: 'drama',
    style: 'reversal',
    proofMethodId: 'context_demo',
    proofMethod: '在连续使用场景中展示可见商品动作',
  },
} as const satisfies Readonly<Record<TkPromptStrategy['slot'], Partial<TkPromptStrategy>>>;

const TK_PROMPT_STRATEGY_DIVERSITY_LOCK = {
  safe: {
    styleForm: 'scene',
    style: 'scene',
    firstFrameId: 'pain_reveal',
    buyingMotivationId: 'problem_relief',
    proofMethodId: 'visible_operation',
  },
  native: {
    styleForm: 'product',
    style: 'product_pov',
    firstFrameId: 'sound_sync',
    buyingMotivationId: 'confidence',
    proofMethodId: 'structure_closeup',
  },
  creative: {
    styleForm: 'drama',
    style: 'reversal',
    firstFrameId: 'structure_reveal',
    buyingMotivationId: 'curiosity',
    proofMethodId: 'context_demo',
  },
} as const satisfies Readonly<Record<TkPromptStrategy['slot'], Partial<TkPromptStrategy>>>;

/**
 * 三个策略槽的核心差异属于产品合同，不应依赖 Provider 随机命中。
 * 服务端锁定风格、首帧、购买动机和证明方式 ID，保证每对至少五维不同；
 * Hook、事实白名单与自由文案仍由 Provider 产生并继续通过原权威门禁。
 */
export function normalizeTkPromptStrategyDiversity(input: {
  strategySet: unknown;
}) {
  const parsed = tkPromptStrategySetSchema.parse(input.strategySet);
  return {
    strategies: parsed.strategies.map(strategy => ({
      ...strategy,
      ...TK_PROMPT_STRATEGY_DIVERSITY_LOCK[strategy.slot],
    })),
  };
}

/** 用户显式选择非主持人模式时，该枚举由服务端锁定，不再交给 Provider 决定。 */
export function normalizeTkPromptStrategyAppearanceMode(input: {
  strategySet: unknown;
  appearanceMode: 'auto' | TkPromptVideoMode;
  durationSeconds: 5 | 10 | 15;
}) {
  const parsed = tkPromptStrategySetSchema.parse(input.strategySet);
  const expected = [
    { slot: 'safe', objective: 'conversion' },
    { slot: 'native', objective: 'trust' },
    { slot: 'creative', objective: 'attention' },
  ] as const;
  const structurallyLocked = parsed.strategies.map((strategy, index) => ({
    ...strategy,
    ...expected[index]!,
    styleForm: STYLE_FORM_BY_STYLE[strategy.style],
    openingLine: input.durationSeconds === 5 ? '' : strategy.openingLine,
  }));
  if (input.appearanceMode === 'auto' || input.appearanceMode === 'live_presenter') {
    return { strategies: structurallyLocked };
  }
  return {
    strategies: structurallyLocked.map(strategy => {
      const requiresPresenter = strategy.style === 'interview'
        || strategy.style === 'talking_head'
        || strategy.proofMethodId === 'presenter_delivery';
      return {
        ...strategy,
        ...(requiresPresenter
          ? TK_PROMPT_NON_PRESENTER_STRATEGY_FALLBACK[strategy.slot]
          : {}),
        videoMode: input.appearanceMode,
      };
    }),
  };
}

export function tkPromptTimeline(durationSeconds: 5 | 10 | 15) {
  if (durationSeconds === 5) {
    return [
      [0, 1, 'stop'],
      [1, 3, 'relevance'],
      [3, 5, 'proof'],
    ] as const;
  }
  if (durationSeconds === 10) {
    return [
      [0, 1, 'stop'],
      [1, 3, 'relevance'],
      [3, 7, 'proof'],
      [7, 10, 'cta'],
    ] as const;
  }
  return [
    [0, 1, 'stop'],
    [1, 3, 'relevance'],
    [3, 7, 'proof'],
    [7, 11, 'resolution'],
    [11, 15, 'cta'],
  ] as const;
}

const HUMAN_VOICE_PATTERN = /(?:人声|旁白|对白|台词|解说|配音|语音|说话|主持人.{0,4}(?:讲话|说话|解说)|歌声|吟唱|human\s+voice|voiceover|dialogue|speech|narration|vocals?|spoken\s+words?|whisper|singing)/iu;
const FORBIDDEN_EXECUTION_PROMPT_LANGUAGE_LOCK = /(?:AUDIO\s+LANGUAGE\s+LOCK|音频语言硬约束|all\s+human\s+speech\s+must|only\s+use\s+the\s+selected\s+language)/iu;

export function containsPositiveTkPromptHumanVoiceInstruction(value: string) {
  const withoutNegations = value
    .replace(/(?:无|没有|不含|不包含|不得(?:包含|加入|添加|生成|使用)?|禁止(?:包含|加入|添加|生成|出现|使用)?|不要(?:包含|加入|添加|生成|使用)?|避免(?:包含|加入|添加|生成|使用)?)(?:任何)?\s*(?:人声|旁白|对白|台词|解说|配音|语音|说话|主持人讲话|歌声|吟唱)(?:(?:\s*[、,，/或和]\s*)(?:人声|旁白|对白|台词|解说|配音|语音|说话|歌声|吟唱))*/giu, '')
    .replace(/(?:no|without|exclude|avoid)\s+(?:any\s+)?(?:human\s+voice|voiceover|dialogue|speech|narration|vocals?|spoken\s+words?|whisper|singing)(?:(?:\s*(?:,|\/|or|and)\s*)(?:human\s+voice|voiceover|dialogue|speech|narration|vocals?|spoken\s+words?|whisper|singing))*/giu, '')
    .replace(/(?:do\s+not|must\s+not|never)\s+(?:add|include|generate|use|play)?\s*(?:any\s+)?(?:human\s+voice|voiceover|dialogue|speech|narration|vocals?|spoken\s+words?|whisper|singing)(?:(?:\s*(?:,|\/|or|and)\s*)(?:human\s+voice|voiceover|dialogue|speech|narration|vocals?|spoken\s+words?|whisper|singing))*/giu, '');
  return HUMAN_VOICE_PATTERN.test(withoutNegations);
}

export function containsPositiveTkPromptPersonInstruction(value: string) {
  const withoutNegations = value
    .replace(/(?:无脸|仅|只有|只拍|只展示)?\s*(?:用户|顾客|人物|演员)?\s*手部(?:特写|操作|出镜|入镜)?/giu, '手部操作')
    .replace(/(?:第一人称|第一视角|无脸视角|POV)(?:\s*(?:镜头|拍摄|操作|手部))?/giu, 'POV')
    .replace(/(?:无人|无脸|不出现|不生成|不得生成|禁止生成)(?:任何)?\s*(?:真人|演员|人物|女孩|男孩|女性|男性|达人|主播|模特|顾客|消费者|店员|主人|妈妈|爸爸|学生|创作者|博主|网红|主持人)/giu, '')
    .replace(/(?:no|without|do\s+not\s+(?:show|generate|include)|must\s+not\s+(?:show|generate|include)|faceless)\s+(?:people|person|actor|presenter|influencer|human\s+model|fashion\s+model|woman|man|girl|boy|customer|shopper|consumer|clerk|student|creator|host)/giu, '');
  const person = '(?:真人|演员|人物|女孩|男孩|女性|男性|女生|男生|达人|主播|模特|顾客|消费者|店员|主人|妈妈|爸爸|学生|创作者|博主|网红|主持人|people|person|actor|presenter|influencer|human\\s+model|fashion\\s+model|woman|man|girl|boy|customer|shopper|consumer|clerk|student|creator|host)';
  return new RegExp(
    `(?:随机|陌生|另一位|一名|一个|random|another|new)\\s*${person}|${person}.{0,24}(?:出镜|出现|入镜|露脸|演示|操作|拿起|手持|站|坐|走|说|口播|讲解|appears?|presents?|demonstrates?|holds?|stands?|speaks?|talks?)|(?:让|由|生成|展示|拍摄|show|generate|feature|film).{0,24}${person}`,
    'iu',
  ).test(withoutNegations);
}

const TK_PROMPT_PERSON_REFERENCE_PATTERN = /(?:真人|演员|人物|女孩|男孩|女性|男性|女生|男生|达人|主播|模特|顾客|消费者|店员|主人|妈妈|爸爸|学生|创作者|博主|网红|主持人|\b(?:people|person|actor|presenter|influencer|human\s+model|fashion\s+model|woman|man|girl|boy|customer|shopper|consumer|clerk|student|creator|host)\b)/iu;

export function containsFabricatedTkPromptPresenterExperience(value: string) {
  return /(?:\bI\b|我|本人|亲自|作为(?:一名|一个)?).{0,28}(?:used|tested|reviewed|bought|purchased|repurchased|recommend(?:ed)?|用了|用过|使用了|试用|测试|测评|购买|买过|回购|推荐)|(?:reviewer|product\s+tester|verified\s+buyer|customer|shopper|测评师|评测师|体验官|真实买家|老顾客|资深用户).{0,24}(?:身份|经验|经历|推荐|测评|评测|体验|used|tested|reviewed|recommend)/iu.test(value);
}

export function containsPositiveTkPromptTextOverlayInstruction(value: string) {
  const withoutAllowedProductText = value
    .replace(/(?:展示|保留|拍到|看到)?\s*(?:参考商品|商品|产品|包装).{0,12}(?:原有|原始|自带|可见|已有).{0,8}(?:品牌|型号|Logo|文字|包装原文|标签)/giu, '')
    .replace(/(?:show|retain|preserve|visible)?\s*(?:the\s+)?(?:original|existing|reference-product)\s+(?:brand|model|logo|packaging\s+text|label)/giu, '');
  const withoutNegations = withoutAllowedProductText
    .replace(/(?:禁止|不得|不要|避免|不应|不可)(?:生成|添加|显示|叠加|放置|出现|包含|展示)?(?:任何)?\s*(?:字幕|标题|屏幕文字|文字|文案|贴纸|标签|价格(?:贴片|标签|浮层)|文字浮层|文字气泡|对话气泡|虚构\s*UI)/giu, '')
    .replace(/(?:no|without|exclude|avoid)\s+(?:any\s+)?(?:subtitles?|titles?|screen\s+text|shown\s+text|text\s+overlays?|caption\s+overlays?|stickers?|labels?|price\s+(?:stickers?|tags?|overlays?)|speech\s+bubbles?|fictional\s+UI)/giu, '')
    .replace(/(?:do\s+not|must\s+not|never)\s+(?:add|show|generate|display|overlay|include)?\s*(?:any\s+)?(?:subtitles?|titles?|screen\s+text|shown\s+text|text\s+overlays?|caption\s+overlays?|stickers?|labels?|price\s+(?:stickers?|tags?|overlays?)|speech\s+bubbles?|fictional\s+UI)/giu, '');
  return /(?:添加|生成|显示|叠加|放置|出现|加入|展示).{0,16}(?:字幕|标题|屏幕文字|文字|文案|贴纸|标签|价格(?:贴片|标签|浮层)|文字浮层|文字气泡|对话气泡|虚构\s*UI)|(?:屏幕|画面).{0,8}(?:显示|出现|展示).{0,12}(?:文字|文案|贴纸|标签)|(?:show|add|generate|display|overlay|include).{0,32}(?:subtitles?|titles?|screen\s+text|shown\s+text|text\s+overlays?|caption\s+overlays?|stickers?|labels?|price\s+(?:stickers?|tags?|overlays?)|speech\s+bubbles?|fictional\s+UI)/iu.test(withoutNegations);
}

/**
 * 只返回候选方案中真正由 Provider 生成的文本值。不能直接扫描序列化 JSON：
 * 例如一个字段以 “Show” 结尾、后续对象恰好含 `title` 键时，JSON 结构会被
 * 错拼成 “show ... title”，造成并不存在的文字浮层指令。
 */
function tkPromptOptionCandidateTextValues(candidate: TkPromptOptionCandidate) {
  return [
    candidate.title,
    candidate.whyItFits,
    ...candidate.coreInformationPoints.map(point => point.message),
    ...candidate.beats.flatMap(beat => [
      beat.environment,
      beat.subject,
      beat.action,
      beat.shotSize,
      beat.lighting,
      beat.editingCue,
      beat.soundDesign,
      beat.voiceoverTarget,
      beat.voiceoverZh,
    ]),
    ...candidate.assumptions,
    ...candidate.requiredMaterials,
    ...candidate.warnings,
  ];
}

const TK_PROMPT_FREE_REFERENCE_PATTERN = /@(?:图片|视频|音频|素材|演员)/u;
const TK_PROMPT_CAMERA_RUN_BUDGET = { 5: 1, 10: 2, 15: 3 } as const;
const TK_PROMPT_CORE_INFORMATION_LIMIT = { 5: 1, 10: 2, 15: 3 } as const;
const TK_PROMPT_ACTION_PHASES = ['start', 'progress', 'complete'] as const;
const TK_PROMPT_TIMELINE_PHASE_TEXT = {
  stop: '开场停留',
  relevance: '用户关联',
  proof: '商品证明',
  cta: '行动引导',
  resolution: '结果收束',
} as const;

/**
 * Provider 偶尔会在修复后仍超过运镜连续段预算。保留前 N 个合法连续段，
 * 将后续切换合并到最后一个合法运镜；结构、事实、口播和商品动作均不改动。
 */
export function normalizeTkPromptCandidateCameraMovements(input: {
  candidate: unknown;
  durationSeconds: 5 | 10 | 15;
}) {
  const candidate = tkPromptOptionCandidateSchema.parse(input.candidate);
  const maximumRuns = TK_PROMPT_CAMERA_RUN_BUDGET[input.durationSeconds];
  let runs = 0;
  let currentMovement: TkPromptCameraMovementId | null = null;
  return {
    ...candidate,
    beats: candidate.beats.map(beat => {
      if (currentMovement === null || beat.movementId === currentMovement) {
        if (currentMovement === null) runs = 1;
        currentMovement = beat.movementId;
        return beat;
      }
      if (runs < maximumRuns) {
        runs += 1;
        currentMovement = beat.movementId;
        return beat;
      }
      return { ...beat, movementId: currentMovement };
    }),
  };
}

/**
 * 核心信息点与 beat.factIds 是结构引用，不应依赖模型在修复后自行对齐。
 * 非 CTA 镜头按顺序轮转已生成的信息点，CTA 不绑定信息点；事实集合随引用同步。
 */
export function normalizeTkPromptCandidateBeatInformation(input: {
  candidate: unknown;
  durationSeconds: 5 | 10 | 15;
}) {
  const candidate = tkPromptOptionCandidateSchema.parse(input.candidate);
  const timeline = tkPromptTimeline(input.durationSeconds);
  let nonCtaIndex = 0;
  return {
    ...candidate,
    beats: candidate.beats.map((beat, index) => {
      const purpose = timeline[index]?.[2];
      if (!purpose) return beat;
      if (purpose === 'cta') {
        return { ...beat, coreInformationPointIds: [], factIds: [] };
      }
      const point = candidate.coreInformationPoints[
        nonCtaIndex % candidate.coreInformationPoints.length
      ];
      nonCtaIndex += 1;
      if (!point) return beat;
      return {
        ...beat,
        coreInformationPointIds: [point.messageId],
        factIds: [...point.factIds],
      };
    }),
  };
}

/**
 * 把时长、事实白名单、主动作、时间轴、人物和音频等确定性协议字段锁回服务端权威值。
 * 这些字段不需要 Provider 二次创作；发生无效事实引用时只回退到策略已允许的事实，
 * 不保留可能建立在越权引用上的自由文本。
 */
export function normalizeTkPromptCandidateStructure(input: {
  candidate: unknown;
  strategy: TkPromptStrategy;
  factPack: TkPromptFactPack;
  durationSeconds: 5 | 10 | 15;
  spokenLanguage: TkPromptLanguage | null;
  imageCount: number;
}) {
  const candidate = tkPromptOptionCandidateSchema.parse(input.candidate);
  if (!Number.isInteger(input.imageCount) || input.imageCount < 1 || input.imageCount > 9) {
    throw tkPromptContractError(
      'TK_PROMPT_IMAGE_REFERENCE_COUNT_INVALID',
      '参考图数量必须为 1 至 9 张',
    );
  }
  const allowedFactIds = [...new Set(input.strategy.allowedFactIds)];
  const allowedFactIdSet = new Set(allowedFactIds);
  const fallbackFactId = allowedFactIds[0];
  if (!fallbackFactId) {
    throw tkPromptContractError(
      'TK_PROMPT_STRATEGY_FACT_EMPTY',
      '锁定策略缺少可用事实',
    );
  }
  const factTextById = new Map(input.factPack.facts.map(fact => [fact.factId, fact.text]));
  const informationLimit = TK_PROMPT_CORE_INFORMATION_LIMIT[input.durationSeconds];
  const coreInformationPoints = candidate.coreInformationPoints
    .slice(0, informationLimit)
    .map((point, index) => {
      const factIds = [...new Set(point.factIds)].filter(factId => allowedFactIdSet.has(factId));
      const normalizedFactIds = factIds.length > 0 ? factIds : [fallbackFactId];
      const referencesChanged = normalizedFactIds.length !== point.factIds.length
        || normalizedFactIds.some((factId, factIndex) => factId !== point.factIds[factIndex]);
      return {
        ...point,
        messageId: `message-${String(index + 1).padStart(3, '0')}`,
        message: referencesChanged
          ? factTextById.get(normalizedFactIds[0]!) ?? '展示已验证的商品特征'
          : point.message,
        factIds: normalizedFactIds,
      };
    });
  const timeline = tkPromptTimeline(input.durationSeconds);
  const beats = candidate.beats.slice(0, timeline.length);
  while (beats.length < timeline.length) beats.push({ ...beats[beats.length - 1]! });
  const presenterRequired = input.strategy.videoMode === 'live_presenter';
  const presenterAlreadyVisible = beats.some(beat => beat.presenterVisible);
  const selectedAction = input.durationSeconds === 5
    ? tkPromptDemonstrableActionRegistry(input.factPack)[0]
    : null;
  if (input.durationSeconds === 5 && !selectedAction) {
    throw tkPromptContractError(
      'TK_PROMPT_PRIMARY_ACTION_INVALID',
      '5 秒方案缺少可演示的主商品动作',
    );
  }
  const voiceoverFallback = input.spokenLanguage === null
    ? ''
    : TK_PROMPT_NEUTRAL_TARGET_TEXT[input.spokenLanguage];
  const reviewFallback = '查看商品细节与操作方式。';

  return tkPromptOptionCandidateSchema.parse({
    ...candidate,
    coreInformationPoints,
    primaryActionId: selectedAction?.actionId ?? null,
    beats: beats.map((beat, index) => {
      const [startSeconds, endSeconds] = timeline[index]!;
      return {
        ...beat,
        startSeconds,
        endSeconds,
        actionPhase: input.durationSeconds === 5 ? TK_PROMPT_ACTION_PHASES[index]! : null,
        productImageIndex: Math.min(Math.max(beat.productImageIndex, 1), input.imageCount),
        presenterVisible: presenterRequired
          ? beat.presenterVisible || (!presenterAlreadyVisible && index === 0)
          : false,
        voiceoverTarget: input.durationSeconds === 5
          ? ''
          : beat.voiceoverTarget.trim() || voiceoverFallback,
        voiceoverZh: input.durationSeconds === 5 || input.spokenLanguage === '普通话'
          ? ''
          : /[\u3400-\u9fff]/u.test(beat.voiceoverZh) ? beat.voiceoverZh : reviewFallback,
      };
    }),
  });
}

const TK_PROMPT_NEUTRAL_TARGET_TEXT = {
  英语: 'See the product details in action.',
  西班牙语: 'Mira los detalles del producto en acción.',
  葡萄牙语: 'Veja os detalhes do produto em ação.',
  法语: 'Découvrez les détails du produit en action.',
  印尼语: 'Lihat detail produk saat digunakan.',
  意大利语: 'Guarda i dettagli del prodotto in azione.',
  日语: '商品のディテールと使い方をご覧ください。',
  马来语: 'Lihat butiran produk semasa digunakan.',
  泰语: 'ดูรายละเอียดสินค้าและวิธีใช้งาน',
  越南语: 'Xem chi tiết sản phẩm khi sử dụng.',
  普通话: '查看商品细节与操作方式。',
  德语: 'Sieh dir die Produktdetails in Aktion an.',
  荷兰语: 'Bekijk de productdetails in gebruik.',
  波兰语: 'Zobacz szczegóły produktu w użyciu.',
} as const satisfies Readonly<Record<TkPromptLanguage, string>>;

const TK_PROMPT_TARGET_LANGUAGE_MARKERS: Readonly<Record<TkPromptLanguage, readonly string[]>> = {
  英语: ['see', 'the', 'this', 'product', 'details', 'discover', 'how', 'works', 'action', 'use', 'off', 'sale', 'discount'],
  西班牙语: ['mira', 'el', 'la', 'los', 'las', 'producto', 'detalle', 'detalles', 'descubre', 'cómo', 'funciona', 'acción', 'uso', 'oferta', 'descuento'],
  葡萄牙语: ['veja', 'o', 'a', 'os', 'as', 'produto', 'detalhes', 'descubra', 'como', 'funciona', 'ação', 'uso', 'oferta', 'desconto'],
  法语: ['regardez', 'le', 'la', 'les', 'produit', 'détails', 'découvrez', 'comment', 'fonctionne', 'utilisation', 'offre', 'remise'],
  印尼语: ['lihat', 'ini', 'produk', 'detail', 'bagaimana', 'berfungsi', 'saat', 'digunakan', 'penggunaan'],
  意大利语: ['guarda', 'il', 'lo', 'la', 'prodotto', 'dettagli', 'scopri', 'come', 'funziona', 'azione', 'uso'],
  日语: [],
  马来语: ['lihat', 'ini', 'produk', 'butiran', 'bagaimana', 'berfungsi', 'semasa', 'digunakan', 'penggunaan'],
  泰语: [],
  越南语: ['xem', 'sản', 'phẩm', 'chi', 'tiết', 'cách', 'hoạt', 'động', 'sử', 'dụng'],
  普通话: [],
  德语: ['sieh', 'schau', 'der', 'die', 'das', 'produkt', 'details', 'funktioniert', 'aktion', 'verwendung', 'welches', 'würdest', 'zuerst', 'ansehen'],
  荷兰语: ['bekijk', 'bekijken', 'zie', 'de', 'het', 'een', 'product', 'details', 'werkt', 'gebruik', 'welk', 'eerst'],
  波兰语: ['zobacz', 'zobaczysz', 'ten', 'ta', 'to', 'produkt', 'produktu', 'szczegół', 'szczegóły', 'działa', 'użyciu', 'użycie', 'który', 'najpierw'],
};

const TK_PROMPT_STRONG_ENGLISH_MARKERS = new Set([
  'see', 'the', 'this', 'these', 'those', 'discover', 'how', 'works', 'working',
  'action', 'look', 'watch', 'your', 'with', 'for', 'use', 'using',
]);

const TK_PROMPT_TARGET_LANGUAGE_FALLBACKS: Readonly<Record<TkPromptLanguage, {
  voiceovers: readonly string[];
}>> = {
  英语: {
    voiceovers: ['See this product detail.', 'Discover how it works in action.', 'Watch the product use step by step.', 'See the product details now.'],
  },
  西班牙语: {
    voiceovers: ['Mira este detalle del producto.', 'Descubre cómo funciona en acción.', 'Observa su uso paso a paso.', 'Mira ahora los detalles del producto.'],
  },
  葡萄牙语: {
    voiceovers: ['Veja este detalhe do produto.', 'Descubra como funciona em ação.', 'Observe o uso passo a passo.', 'Veja agora os detalhes do produto.'],
  },
  法语: {
    voiceovers: ['Regardez ce détail du produit.', 'Découvrez comment il fonctionne en action.', 'Observez son utilisation étape par étape.', 'Regardez maintenant les détails du produit.'],
  },
  印尼语: {
    voiceovers: ['Lihat detail produk ini.', 'Temukan bagaimana produk ini berfungsi.', 'Lihat penggunaannya langkah demi langkah.', 'Lihat detail produk sekarang.'],
  },
  意大利语: {
    voiceovers: ['Guarda questo dettaglio del prodotto.', 'Scopri come funziona in azione.', 'Osserva il suo uso passo dopo passo.', 'Guarda ora i dettagli del prodotto.'],
  },
  日语: {
    voiceovers: ['商品のこのディテールをご覧ください。', '実際の使い方をご覧ください。', '使い方を順番に確認してください。', '商品の詳細を今すぐご覧ください。'],
  },
  马来语: {
    voiceovers: ['Lihat butiran produk ini.', 'Temui bagaimana produk ini berfungsi.', 'Lihat penggunaannya langkah demi langkah.', 'Lihat butiran produk sekarang.'],
  },
  泰语: {
    voiceovers: ['ดูรายละเอียดของสินค้านี้', 'ดูวิธีการทำงานของสินค้า', 'ดูการใช้งานทีละขั้นตอน', 'ดูรายละเอียดสินค้าตอนนี้'],
  },
  越南语: {
    voiceovers: ['Xem chi tiết của sản phẩm này.', 'Khám phá cách sản phẩm hoạt động.', 'Xem cách sử dụng từng bước.', 'Xem chi tiết sản phẩm ngay bây giờ.'],
  },
  普通话: {
    voiceovers: ['查看这处商品细节。', '了解商品的实际操作方式。', '逐步查看商品的使用过程。', '现在查看商品详情。'],
  },
  德语: {
    voiceovers: ['Sieh dir dieses Produktdetail an.', 'Entdecke, wie das Produkt funktioniert.', 'Sieh dir die Verwendung Schritt für Schritt an.', 'Sieh dir jetzt die Produktdetails an.'],
  },
  荷兰语: {
    voiceovers: ['Bekijk dit productdetail.', 'Ontdek hoe het product werkt.', 'Bekijk het gebruik stap voor stap.', 'Bekijk nu de productdetails.'],
  },
  波兰语: {
    voiceovers: ['Zobacz ten szczegół produktu.', 'Odkryj, jak produkt działa w praktyce.', 'Zobacz użycie krok po kroku.', 'Zobacz teraz szczegóły produktu.'],
  },
};

/**
 * 目标语言字段不能只依赖 Provider 自觉。这里按单字段保守识别；无法确定时由
 * 调用方换成同语种固定文案，不猜测或翻译 Provider 原文。
 */
export function isTkPromptTargetLanguageText(
  value: string,
  language: TkPromptLanguage,
  allowedLatinTexts: readonly string[] = [],
) {
  let remaining = value.normalize('NFKC').trim();
  if (/^#(?:TikTokShop|TikTok)$/iu.test(remaining)) return true;
  for (const allowed of [...TK_PROMPT_ALLOWED_LATIN_NARRATIVE_TERMS, ...allowedLatinTexts]) {
    const normalized = allowed.normalize('NFKC').trim();
    if (!normalized) continue;
    remaining = remaining.split(normalized).join('');
  }
  if (!remaining) return false;
  if (language === '普通话') {
    return /[\u3400-\u9fff]/u.test(remaining)
      && !/[\u3040-\u30ff\u0e00-\u0e7f]/u.test(remaining);
  }
  if (language === '日语') return /[\u3040-\u30ff]/u.test(remaining);
  if (language === '泰语') return /[\u0e00-\u0e7f]/u.test(remaining);
  if (/[\u3400-\u9fff\u3040-\u30ff\u0e00-\u0e7f]/u.test(remaining)) return false;
  const tokens = remaining
    .replace(/([a-z])([A-Z])/gu, '$1 $2')
    .toLocaleLowerCase('und')
    .match(/\p{L}+/gu) ?? [];
  const markerSet = new Set(TK_PROMPT_TARGET_LANGUAGE_MARKERS[language]);
  const targetScore = tokens.filter(token => markerSet.has(token)).length;
  if (targetScore < 1) return false;
  if (language !== '英语') {
    const strongEnglishScore = tokens.filter(token => TK_PROMPT_STRONG_ENGLISH_MARKERS.has(token)).length;
    if (strongEnglishScore > 0 && strongEnglishScore >= targetScore) return false;
  }
  return true;
}

const TK_PROMPT_ALLOWED_LATIN_NARRATIVE_TERMS = [
  'TikTok Shop', 'TikTok', 'Seedance', 'Logo', 'POV', 'CTA', 'SEO', 'AI',
] as const;

/**
 * 执行层叙述必须以中文为主体。已确认商品名、事实、品牌型号和固定技术专名
 * 可以原样嵌入；带数字的型号也可保留，但其余英文叙述词一律回落为中文。
 */
export function isTkPromptChineseNarrative(
  value: string,
  allowedLatinTexts: readonly string[] = [],
) {
  if (!/[\u3400-\u9fff]/u.test(value)) return false;
  let remaining = value;
  for (const allowed of [...TK_PROMPT_ALLOWED_LATIN_NARRATIVE_TERMS, ...allowedLatinTexts]) {
    const normalized = allowed.trim();
    if (!normalized || !/[A-Za-z]/u.test(normalized)) continue;
    remaining = remaining.split(normalized).join('');
  }
  remaining = remaining.replace(/\b[A-Z][A-Z0-9-]*\d[A-Z0-9-]*\b/gu, '');
  const englishWords = remaining.match(/\b[A-Za-z][A-Za-z0-9'-]{2,}\b/gu) ?? [];
  return englishWords.length === 0;
}

/**
 * 单方案 Provider 在修复结构字段时仍可能扩写未授权促销或正向文字浮层。
 * 这里只替换不安全的自由文本，随后仍由原权威校验拒绝任何漏网声明。
 */
export function normalizeTkPromptCandidateFreeText(input: {
  candidate: unknown;
  factPack: TkPromptFactPack;
  strategy: TkPromptStrategy;
  durationSeconds: 5 | 10 | 15;
  spokenLanguage: TkPromptLanguage | null;
}) {
  const candidate = tkPromptOptionCandidateSchema.parse(input.candidate);
  const internalIdentifiers = [
    ...input.factPack.facts.flatMap(fact => [fact.factId, ...fact.sourceImageIds]),
    ...input.factPack.demonstrableActions.map(action => action.actionId),
    ...candidate.coreInformationPoints.map(point => point.messageId),
  ];
  const supportedFacts = tkPromptAllowedFactTexts(
    input.factPack,
    input.strategy.allowedFactIds,
  );
  const allowedLatinTexts = [
    input.factPack.productName,
    input.factPack.category,
    ...supportedFacts,
  ];
  const normalizeText = (value: string, fallback: string, requireChinese = true) => {
    try {
      assertTkPromptPromotionBoundToOffer(
        value,
        input.factPack.verifiedOffer,
        '单方案自由文本',
        supportedFacts,
      );
      assertTkPromptForbiddenClaimsAbsent(
        value,
        input.factPack.forbiddenClaims,
        '单方案自由文本',
      );
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
      if (
        !TK_PROMPT_PROMOTION_ERROR_CODES.has(code)
        && code !== 'TK_PROMPT_FORBIDDEN_CLAIM_LEAKED'
      ) throw error;
      return fallback;
    }
    if (
      containsPositiveTkPromptTextOverlayInstruction(value)
      || containsFabricatedTkPromptPresenterExperience(value)
      || TK_PROMPT_FORBIDDEN_PERSONA_PATTERN.test(value)
      || TK_PROMPT_AI_DISCLOSURE_PATTERN.test(value)
      || TK_PROMPT_FREE_REFERENCE_PATTERN.test(value)
      || TK_PROMPT_UUID_PATTERN.test(value)
      || TK_PROMPT_INTERNAL_ID_PATTERN.test(value)
      || containsTkPromptKnownInternalIdentifier(value, internalIdentifiers)
      || TK_PROMPT_HOOK_PATTERNS.some(pattern => (
        pattern.internalExample.length >= 12
        && normalizeTkPromptLeakText(value)
          .includes(normalizeTkPromptLeakText(pattern.internalExample))
      ))
    ) return fallback;
    if (requireChinese && !isTkPromptChineseNarrative(value, allowedLatinTexts)) return fallback;
    return value;
  };
  const normalizeList = (values: string[]) => values.flatMap(value => (
    normalizeText(value, '') ? [value] : []
  ));
  const fallbackForPoint = (factIds: string[]) => {
    const factText = input.factPack.facts
      .filter(fact => factIds.includes(fact.factId))
      .map(fact => fact.text)
      .find(text => normalizeText(text, '') !== '');
    return factText
      ? `展示已确认商品事实：${factText}`
      : '展示与已验证事实对应的商品特征';
  };
  const targetText = input.spokenLanguage === null
    ? ''
    : TK_PROMPT_NEUTRAL_TARGET_TEXT[input.spokenLanguage];
  const reviewText = input.spokenLanguage === null || input.spokenLanguage === '普通话'
    ? ''
    : '查看商品细节与操作方式。';
  const normalizeTargetText = (
    value: string,
    language: TkPromptLanguage,
    fallback: string,
  ) => {
    const normalized = normalizeText(value, fallback, false);
    return isTkPromptTargetLanguageText(normalized, language, allowedLatinTexts)
      ? normalized
      : fallback;
  };
  let normalizedBeats = candidate.beats.map((beat, index) => {
      let environment = normalizeText(beat.environment, '清晰、简洁的商品展示场景');
      let subject = normalizeText(beat.subject, '商品主体及其可见结构');
      let action = normalizeText(beat.action, '连续展示商品结构与操作方式');
      let editingCue = normalizeText(beat.editingCue, '保持动作连续');
      if (
        input.strategy.videoMode !== 'live_presenter'
        && (
          TK_PROMPT_PERSON_REFERENCE_PATTERN.test(
            [environment, subject, action, editingCue].join('；'),
          )
          || containsPositiveTkPromptPersonInstruction(
            [environment, subject, action, editingCue].join('；'),
          )
        )
      ) {
        environment = '清晰、简洁的商品展示场景';
        subject = '商品主体及其可见结构';
        action = '连续展示商品结构与操作方式';
        editingCue = '保持动作连续';
      }
      const soundDesign = normalizeText(beat.soundDesign, '自然环境声与商品操作声');
      let shotSize = normalizeText(beat.shotSize, '商品中近景');
      let lighting = normalizeText(beat.lighting, '自然清晰光线');
      if (
        input.strategy.videoMode !== 'live_presenter'
        && (
          TK_PROMPT_PERSON_REFERENCE_PATTERN.test([shotSize, lighting].join('；'))
          || containsPositiveTkPromptPersonInstruction([shotSize, lighting].join('；'))
        )
      ) {
        shotSize = '商品中近景';
        lighting = '自然清晰光线';
      }
      return {
        ...beat,
        environment,
        subject,
        action,
        shotSize,
        lighting,
        editingCue,
        soundDesign: input.durationSeconds === 5
          && containsPositiveTkPromptHumanVoiceInstruction(soundDesign)
          ? '自然环境声与商品操作声'
          : soundDesign,
        voiceoverTarget: input.spokenLanguage === null
          ? ''
          : normalizeTargetText(
            beat.voiceoverTarget,
            input.spokenLanguage,
            TK_PROMPT_TARGET_LANGUAGE_FALLBACKS[input.spokenLanguage]
              .voiceovers[index % TK_PROMPT_TARGET_LANGUAGE_FALLBACKS[input.spokenLanguage]
                .voiceovers.length] ?? targetText,
          ),
        voiceoverZh: normalizeText(beat.voiceoverZh, reviewText),
      };
    });
  if (
    input.strategy.videoMode !== 'live_presenter'
    && (
      TK_PROMPT_PERSON_REFERENCE_PATTERN.test(normalizedBeats.map(beat => (
        [beat.environment, beat.subject, beat.action, beat.editingCue].join('；')
      )).join('；'))
      || containsPositiveTkPromptPersonInstruction(normalizedBeats.map(beat => (
        [beat.environment, beat.subject, beat.action, beat.editingCue].join('；')
      )).join('；'))
    )
  ) {
    normalizedBeats = normalizedBeats.map(beat => ({
      ...beat,
      environment: '清晰、简洁的商品展示场景',
      subject: '商品主体及其可见结构',
      action: '连续展示商品结构与操作方式',
      editingCue: '保持动作连续',
    }));
  }

  return {
    ...candidate,
    title: normalizeText(candidate.title, `商品可见结构与操作方案`),
    whyItFits: normalizeText(candidate.whyItFits, '围绕已验证商品事实展示结构与操作方式'),
    coreInformationPoints: candidate.coreInformationPoints.map(point => ({
      ...point,
      message: normalizeText(point.message, fallbackForPoint(point.factIds)),
    })),
    beats: normalizedBeats,
    assumptions: normalizeList(candidate.assumptions),
    requiredMaterials: normalizeList(candidate.requiredMaterials),
    warnings: normalizeList(candidate.warnings),
  };
}

function sameStringSet(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every(item => rightSet.has(item));
}

function tkPromptAllowedFactTexts(factPack: TkPromptFactPack, allowedFactIds: string[]) {
  const allowed = new Set(allowedFactIds);
  return factPack.facts.filter(fact => allowed.has(fact.factId)).map(fact => fact.text);
}

export function validateTkPromptOptionCandidate(input: {
  candidate: unknown;
  strategy: TkPromptStrategy;
  factPack: TkPromptFactPack;
  durationSeconds: 5 | 10 | 15;
  spokenLanguage: TkPromptLanguage | null;
  imageAssetIds?: string[];
}) {
  const candidate = tkPromptOptionCandidateSchema.parse(input.candidate);
  const timeline = tkPromptTimeline(input.durationSeconds);
  const imageAssetIds = input.imageAssetIds
    ?? [...new Set(input.factPack.facts.flatMap(fact => fact.sourceImageIds))];
  if (imageAssetIds.length < 1 || imageAssetIds.length > 9) {
    throw tkPromptContractError(
      'TK_PROMPT_IMAGE_REFERENCE_COUNT_INVALID',
      '参考图数量必须为 1 至 9 张',
    );
  }
  if (candidate.beats.length !== timeline.length) {
    throw tkPromptContractError(
      'TK_PROMPT_TIMELINE_COUNT_INVALID',
      '方案节拍数量与时长不匹配',
    );
  }
  const informationLimit = TK_PROMPT_CORE_INFORMATION_LIMIT[input.durationSeconds];
  if (
    candidate.coreInformationPoints.length > informationLimit
    || (input.durationSeconds === 5 && candidate.coreInformationPoints.length !== 1)
  ) {
    throw tkPromptContractError(
      'TK_PROMPT_CORE_INFORMATION_BUDGET_INVALID',
      `${input.durationSeconds} 秒方案核心信息点超出 ${informationLimit} 个的上限`,
    );
  }
  const allowedFactIds = new Set(input.strategy.allowedFactIds);
  const informationPointById = new Map(candidate.coreInformationPoints.map((point, index) => {
    const expectedId = `message-${String(index + 1).padStart(3, '0')}`;
    if (point.messageId !== expectedId) {
      throw tkPromptContractError(
        'TK_PROMPT_CORE_INFORMATION_ORDER_INVALID',
        `核心信息点 ${index} 必须使用 ${expectedId}`,
      );
    }
    if (
      new Set(point.factIds).size !== point.factIds.length
      || point.factIds.some(factId => !allowedFactIds.has(factId))
    ) {
      throw tkPromptContractError(
        'TK_PROMPT_CORE_INFORMATION_FACT_INVALID',
        `核心信息点 ${point.messageId} 引用了未授权或重复事实`,
      );
    }
    return [point.messageId, point] as const;
  }));
  const actionRegistry = tkPromptDemonstrableActionRegistry(input.factPack);
  const selectedAction = candidate.primaryActionId === null
    ? null
    : actionRegistry.find(action => action.actionId === candidate.primaryActionId) ?? null;
  if (input.durationSeconds === 5 ? !selectedAction : candidate.primaryActionId !== null) {
    throw tkPromptContractError(
      'TK_PROMPT_PRIMARY_ACTION_INVALID',
      input.durationSeconds === 5
        ? '5 秒方案必须选择唯一且可演示的主商品动作'
        : '10/15 秒方案不得提交 5 秒专用的 primaryActionId',
    );
  }
  const freeReferenceText = JSON.stringify(candidate);
  if (TK_PROMPT_FREE_REFERENCE_PATTERN.test(freeReferenceText)) {
    throw tkPromptContractError(
      'TK_PROMPT_FREE_REFERENCE_FORBIDDEN',
      '候选方案不得在自由文本中编写参考素材编号',
    );
  }
  let movementRuns = 0;
  candidate.beats.forEach((beat, index) => {
    if (index === 0 || beat.movementId !== candidate.beats[index - 1]!.movementId) {
      movementRuns += 1;
    }
  });
  if (movementRuns > TK_PROMPT_CAMERA_RUN_BUDGET[input.durationSeconds]) {
    throw tkPromptContractError(
      'TK_PROMPT_CAMERA_DENSITY_INVALID',
      `${input.durationSeconds} 秒方案运镜连续段超出上限`,
    );
  }
  if (
    input.strategy.videoMode === 'live_presenter'
      ? !candidate.beats.some(beat => beat.presenterVisible)
      : candidate.beats.some(beat => beat.presenterVisible)
  ) {
    throw tkPromptContractError(
      'TK_PROMPT_PRESENTER_VISIBILITY_INVALID',
      input.strategy.videoMode === 'live_presenter'
        ? 'live_presenter 方案至少一拍必须出现同一位成年虚构非名人主持人'
        : '非 live_presenter 方案不得生成真人出镜',
    );
  }
  if (
    input.strategy.videoMode !== 'live_presenter'
    && containsPositiveTkPromptPersonInstruction(candidate.beats.map(beat => (
      [beat.environment, beat.subject, beat.action, beat.editingCue].join('；')
    )).join('\n'))
  ) {
    throw tkPromptContractError(
      'TK_PROMPT_PERSON_FORBIDDEN',
      '非 live_presenter 方案不得在画面指令中生成真人',
    );
  }
  let referencedFactCount = 0;
  const referencedInformationPointIds = new Set<string>();
  candidate.beats.forEach((beat, index) => {
    const expected = timeline[index]!;
    if (
      beat.startSeconds !== expected[0]
      || beat.endSeconds !== expected[1]
    ) {
      throw tkPromptContractError(
        'TK_PROMPT_TIMELINE_INVALID',
        `节拍 ${index} 必须严格使用 ${expected[0]}-${expected[1]}s/${expected[2]}`,
      );
    }
    if (beat.productImageIndex > imageAssetIds.length) {
      throw tkPromptContractError(
        'TK_PROMPT_IMAGE_REFERENCE_INVALID',
        `节拍 ${index} 引用了不存在的参考图`,
      );
    }
    const isCta = expected[2] === 'cta';
    if (
      (!isCta && beat.coreInformationPointIds.length !== 1)
      || (isCta && beat.coreInformationPointIds.length > 1)
    ) {
      throw tkPromptContractError(
        'TK_PROMPT_BEAT_INFORMATION_REFERENCE_INVALID',
        `节拍 ${index} 的核心信息点引用数量无效`,
      );
    }
    const pointFacts = beat.coreInformationPointIds.flatMap(pointId => {
      const point = informationPointById.get(pointId);
      if (!point) {
        throw tkPromptContractError(
          'TK_PROMPT_BEAT_INFORMATION_REFERENCE_INVALID',
          `节拍 ${index} 引用了未知核心信息点`,
        );
      }
      referencedInformationPointIds.add(pointId);
      return point.factIds;
    });
    if (
      new Set(beat.factIds).size !== beat.factIds.length
      || !sameStringSet(beat.factIds, pointFacts)
    ) {
      throw tkPromptContractError(
        'TK_PROMPT_BEAT_FACT_CLOSURE_INVALID',
        `节拍 ${index} 的事实引用与核心信息点不闭合`,
      );
    }
    referencedFactCount += beat.factIds.length;
    if (input.durationSeconds === 5) {
      if (beat.actionPhase !== TK_PROMPT_ACTION_PHASES[index]) {
        throw tkPromptContractError(
          'TK_PROMPT_ACTION_PHASE_INVALID',
          `5 秒节拍 ${index} 必须使用 ${TK_PROMPT_ACTION_PHASES[index]} 阶段`,
        );
      }
      if (beat.voiceoverTarget !== '' || beat.voiceoverZh !== '') {
        throw tkPromptContractError(
          'TK_PROMPT_SOUND_ONLY_VOICE_INVALID',
          '5 秒纯声音方案不得包含口播或中文译文',
        );
      }
      if (containsPositiveTkPromptHumanVoiceInstruction(beat.soundDesign)) {
        throw tkPromptContractError(
          'TK_PROMPT_SOUND_ONLY_HUMAN_VOICE_INVALID',
          `5 秒节拍 ${index} 的声音设计不得包含人声`,
        );
      }
      return;
    }
    if (beat.actionPhase !== null) {
      throw tkPromptContractError(
        'TK_PROMPT_ACTION_PHASE_INVALID',
        `10/15 秒节拍 ${index} 的 actionPhase 必须为 null`,
      );
    }
    if (!beat.voiceoverTarget.trim()) {
      throw tkPromptContractError(
        'TK_PROMPT_VOICEOVER_REQUIRED',
        `10/15 秒节拍 ${index} 必须有目标语言口播`,
      );
    }
    const reviewZh = beat.voiceoverZh;
    if (input.spokenLanguage === '普通话') {
      if (reviewZh !== '') {
        throw tkPromptContractError(
          'TK_PROMPT_MANDARIN_REVIEW_INVALID',
          '普通话口播不得重复生成中文审核译文',
        );
      }
    } else if (!/[\u3400-\u9fff]/u.test(reviewZh)) {
      throw tkPromptContractError(
        'TK_PROMPT_REVIEW_TRANSLATION_REQUIRED',
        `节拍 ${index} 缺少忠实简体中文审核译文`,
      );
    }
  });
  if (referencedInformationPointIds.size !== candidate.coreInformationPoints.length) {
    throw tkPromptContractError(
      'TK_PROMPT_CORE_INFORMATION_UNUSED',
      '每个核心信息点都必须被至少一个节拍引用',
    );
  }
  if (referencedFactCount === 0) {
    throw tkPromptContractError(
      'TK_PROMPT_OPTION_FACT_CLOSURE_INVALID',
      '方案没有引用任何已验证商品事实',
    );
  }
  const serializedCandidate = JSON.stringify(candidate);
  if (TK_PROMPT_FORBIDDEN_PERSONA_PATTERN.test(serializedCandidate)) {
    throw tkPromptContractError(
      'TK_PROMPT_EXPERT_HISTORY_LEAKED',
      '虚构专家履历不得进入单方案输出',
    );
  }
  if (TK_PROMPT_AI_DISCLOSURE_PATTERN.test(serializedCandidate)) {
    throw tkPromptContractError(
      'TK_PROMPT_AI_DISCLOSURE_FORBIDDEN',
      '方案不得生成 AI 声明',
    );
  }
  if (containsFabricatedTkPromptPresenterExperience(serializedCandidate)) {
    throw tkPromptContractError(
      'TK_PROMPT_PRESENTER_EXPERIENCE_FORBIDDEN',
      '方案不得虚构主持人的个人使用经历、测评身份或购买经历',
    );
  }
  if (tkPromptOptionCandidateTextValues(candidate).some(
    containsPositiveTkPromptTextOverlayInstruction,
  )) {
    throw tkPromptContractError(
      'TK_PROMPT_TEXT_OVERLAY_FORBIDDEN',
      '方案不得要求生成字幕或文字浮层',
    );
  }
  if (TK_PROMPT_HOOK_PATTERNS.some(pattern => (
    pattern.internalExample.length >= 12
    && normalizeTkPromptLeakText(serializedCandidate)
      .includes(normalizeTkPromptLeakText(pattern.internalExample))
  ))) {
    throw tkPromptContractError(
      'TK_PROMPT_INTERNAL_HOOK_EXAMPLE_LEAKED',
      'Hook 内部教学案例不得进入单方案输出',
    );
  }
  assertTkPromptPromotionBoundToOffer(
    serializedCandidate,
    input.factPack.verifiedOffer,
    '单方案与发布包',
    tkPromptAllowedFactTexts(input.factPack, input.strategy.allowedFactIds),
  );
  assertTkPromptForbiddenClaimsAbsent(
    serializedCandidate,
    input.factPack.forbiddenClaims,
    '单方案与发布包',
  );
  return candidate;
}

const LANGUAGE_LABELS: Readonly<Record<TkPromptLanguage, string>> = {
  英语: 'English',
  西班牙语: 'Spanish',
  葡萄牙语: 'Portuguese',
  法语: 'French',
  印尼语: 'Indonesian',
  意大利语: 'Italian',
  日语: 'Japanese',
  马来语: 'Malay',
  泰语: 'Thai',
  越南语: 'Vietnamese',
  普通话: 'Mandarin Chinese',
  德语: 'German',
  荷兰语: 'Dutch',
  波兰语: 'Polish',
};

export const TK_PROMPT_VISUAL_TEXT_BOUNDARY = '画面文字边界：禁止生成字幕、标题、价格贴片、文字浮层、气泡和虚构 UI；仅保留参考商品原有品牌、型号、Logo 和包装可见原文。';
export const TK_PROMPT_LIVE_PRESENTER_BOUNDARY = '人物边界：由 Seedance 自动生成一位适合目标市场的成年虚构非名人主持人；目标市场与语言只用于文化语境和表达，不得据此推断种族、民族、宗教或其他敏感属性；全片所有人物镜头保持同一人物身份、外貌、服装与动作风格连续，不得新增、替换或切换人物，不得虚构其个人使用经历、测评身份或购买经历。';
export const TK_PROMPT_NON_LIVE_PERSON_BOUNDARY = '人物边界：不得生成任何真人出镜；仅允许商品、操作手部、POV 或无脸场景。';

const ACTION_PHASE_TEXT = {
  start: '启动',
  progress: '连续推进',
  complete: '完成',
} as const;

export function compileTkPromptCandidateBeats(input: {
  candidate: TkPromptOptionCandidate;
  strategy: TkPromptStrategy;
  factPack: TkPromptFactPack;
  durationSeconds: 5 | 10 | 15;
}) {
  const selectedAction = input.candidate.primaryActionId === null
    ? null
    : tkPromptDemonstrableActionRegistry(input.factPack)
      .find(action => action.actionId === input.candidate.primaryActionId) ?? null;
  if (input.durationSeconds === 5 && !selectedAction) {
    throw tkPromptContractError(
      'TK_PROMPT_PRIMARY_ACTION_INVALID',
      '5 秒方案引用的主商品动作已失效或缺少事实支撑',
    );
  }
  const selectedActionText = selectedAction
    && input.strategy.videoMode !== 'live_presenter'
    && (
      TK_PROMPT_PERSON_REFERENCE_PATTERN.test(selectedAction.text)
      || containsPositiveTkPromptPersonInstruction(selectedAction.text)
    )
    ? TK_PROMPT_NEUTRAL_DEMONSTRABLE_ACTION
    : selectedAction?.text;
  return input.candidate.beats.map(beat => {
    const {
      coreInformationPointIds: _coreInformationPointIds,
      actionPhase,
      productImageIndex,
      presenterVisible,
      movementId,
      ...publicBeat
    } = beat;
    const canonicalSubject = `@图片${productImageIndex}中的同一主商品${presenterVisible ? '与全片同一位成年虚构非名人主持人' : ''}`;
    const canonicalAction = input.durationSeconds === 5 && selectedActionText && actionPhase
      ? `主商品动作：${selectedActionText}；阶段：${ACTION_PHASE_TEXT[actionPhase]}；${publicBeat.action}`
      : publicBeat.action;
    return tkPromptBeatSchema.parse({
      ...publicBeat,
      subject: `${canonicalSubject}；${publicBeat.subject}`,
      action: canonicalAction,
      cameraMovement: TK_PROMPT_CAMERA_MOVEMENT_TEXT[movementId],
    });
  });
}

export function validateTkPromptFinalExecutionPrompt(input: {
  prompt: string;
  imageCount: number;
  videoMode: TkPromptVideoMode;
  durationSeconds: 5 | 10 | 15;
  internalIdentifiers?: string[];
  forbiddenClaims?: string[];
  verifiedOffer?: TkPromptFactPack['verifiedOffer'];
  supportedFacts?: string[];
}) {
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 3_800) {
    throw tkPromptContractError(
      'TK_PROMPT_EXECUTION_PROMPT_LENGTH_INVALID',
      'Seedance 执行 Prompt 必须为 1 至 3800 个字符',
    );
  }
  if (input.imageCount < 1 || input.imageCount > 9) {
    throw tkPromptContractError(
      'TK_PROMPT_IMAGE_REFERENCE_COUNT_INVALID',
      '执行 Prompt 绑定的参考图数量无效',
    );
  }
  if (/@(?:视频|音频|素材|演员)/u.test(prompt)) {
    throw tkPromptContractError(
      'TK_PROMPT_REFERENCE_KIND_FORBIDDEN',
      'TK 执行 Prompt 只允许使用已绑定的 @图片N 参考',
    );
  }
  const imageStarts = prompt.match(/@图片/gu)?.length ?? 0;
  const imageReferences = Array.from(prompt.matchAll(
    /@图片([1-9]\d*)(?![\dA-Za-z_]|[._+\-/][\p{L}\p{N}_])/gu,
  ));
  const expectedCanonicalImageReferences = input.imageCount
    + tkPromptTimeline(input.durationSeconds).length;
  if (
    imageReferences.length !== expectedCanonicalImageReferences
    || imageStarts !== imageReferences.length
    || imageReferences.some(match => Number(match[1]) > input.imageCount)
    || Array.from({ length: input.imageCount }, (_, index) => index + 1)
      .some(index => !imageReferences.some(match => Number(match[1]) === index))
  ) {
    throw tkPromptContractError(
      'TK_PROMPT_IMAGE_REFERENCE_INVALID',
      `执行 Prompt 只能保留编译器生成的 ${expectedCanonicalImageReferences} 个 @图片引用，且编号必须为 1 至 ${input.imageCount}`,
    );
  }
  if (!prompt.includes(TK_PROMPT_VISUAL_TEXT_BOUNDARY)) {
    throw tkPromptContractError(
      'TK_PROMPT_VISUAL_TEXT_BOUNDARY_MISSING',
      '执行 Prompt 缺少规范画面文字边界',
    );
  }
  if (containsPositiveTkPromptTextOverlayInstruction(prompt)) {
    throw tkPromptContractError(
      'TK_PROMPT_TEXT_OVERLAY_FORBIDDEN',
      '执行 Prompt 不得要求生成字幕、标题、价格贴片、气泡或虚构 UI',
    );
  }
  const requiredPersonBoundary = input.videoMode === 'live_presenter'
    ? TK_PROMPT_LIVE_PRESENTER_BOUNDARY
    : TK_PROMPT_NON_LIVE_PERSON_BOUNDARY;
  if (!prompt.includes(requiredPersonBoundary)) {
    throw tkPromptContractError(
      'TK_PROMPT_PRESENTER_BOUNDARY_MISSING',
      '执行 Prompt 缺少与方案模式一致的人物边界',
    );
  }
  const promptWithoutCanonicalBoundaries = prompt
    .replace(TK_PROMPT_VISUAL_TEXT_BOUNDARY, '')
    .replace(requiredPersonBoundary, '');
  const visualPersonInstructionLines = promptWithoutCanonicalBoundaries
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^(?:【创意方向】|画面：|镜头：|剪辑：)/u.test(line));
  const personInstructionScope = visualPersonInstructionLines.length > 0
    ? visualPersonInstructionLines.join('\n')
    : promptWithoutCanonicalBoundaries;
  if (
    input.videoMode !== 'live_presenter'
    && containsPositiveTkPromptPersonInstruction(personInstructionScope)
  ) {
    throw tkPromptContractError(
      'TK_PROMPT_PERSON_FORBIDDEN',
      '非 live_presenter 执行 Prompt 不得生成真人',
    );
  }
  if (input.durationSeconds === 5) {
    if (containsPositiveTkPromptHumanVoiceInstruction(promptWithoutCanonicalBoundaries)) {
      throw tkPromptContractError(
        'TK_PROMPT_SOUND_ONLY_HUMAN_VOICE_INVALID',
        '5 秒执行 Prompt 不得包含人声、旁白或对白',
      );
    }
    if (
      /(?:优惠|折扣|立减|满减|包邮|赠品|买一送一|限时|仅剩|最低价|到手价|(?:价格|售价).{0,8}\d|discount|coupon|free\s+shipping|limited\s+time|only\s+\d+\s+left|lowest\s+price|sale\s+price|price.{0,8}\d)/iu
        .test(promptWithoutCanonicalBoundaries)
    ) {
      throw tkPromptContractError(
        'TK_PROMPT_SOUND_ONLY_PROMOTION_FORBIDDEN',
        '5 秒执行 Prompt 不得包含优惠、价格或促销信息',
      );
    }
  }
  assertTkPromptInternalIdentifiersAbsent(
    promptWithoutCanonicalBoundaries,
    input.internalIdentifiers ?? [],
    '最终执行 Prompt',
  );
  if (TK_PROMPT_FORBIDDEN_PERSONA_PATTERN.test(promptWithoutCanonicalBoundaries)) {
    throw tkPromptContractError(
      'TK_PROMPT_EXPERT_HISTORY_LEAKED',
      '最终执行 Prompt 不得包含虚构专家履历或权威背书',
    );
  }
  if (containsFabricatedTkPromptPresenterExperience(promptWithoutCanonicalBoundaries)) {
    throw tkPromptContractError(
      'TK_PROMPT_PRESENTER_EXPERIENCE_FORBIDDEN',
      '最终执行 Prompt 不得虚构主持人的个人使用经历、测评身份或购买经历',
    );
  }
  if (TK_PROMPT_HOOK_PATTERNS.some(pattern => (
    pattern.internalExample.length >= 12
    && normalizeTkPromptLeakText(promptWithoutCanonicalBoundaries)
      .includes(normalizeTkPromptLeakText(pattern.internalExample))
  ))) {
    throw tkPromptContractError(
      'TK_PROMPT_INTERNAL_HOOK_EXAMPLE_LEAKED',
      '最终执行 Prompt 不得包含 Hook 内部教学案例',
    );
  }
  assertTkPromptPromotionBoundToOffer(
    promptWithoutCanonicalBoundaries,
    input.verifiedOffer ?? null,
    '最终执行 Prompt',
    input.supportedFacts ?? [],
  );
  assertTkPromptForbiddenClaimsAbsent(
    promptWithoutCanonicalBoundaries,
    input.forbiddenClaims ?? [],
    '最终执行 Prompt',
  );
  if (FORBIDDEN_EXECUTION_PROMPT_LANGUAGE_LOCK.test(prompt)) {
    throw tkPromptContractError(
      'TK_PROMPT_LANGUAGE_LOCK_FORBIDDEN',
      '执行 Prompt 不得包含全局音频语言硬约束',
    );
  }
  if (TK_PROMPT_AI_DISCLOSURE_PATTERN.test(prompt)) {
    throw tkPromptContractError(
      'TK_PROMPT_AI_DISCLOSURE_FORBIDDEN',
      '执行 Prompt 不得生成 AI 声明',
    );
  }
  const nonVoiceoverPrompt = prompt
    .split('\n')
    .filter(line => !line.startsWith('旁白（'))
    .join('\n');
  if (!isTkPromptChineseNarrative(nonVoiceoverPrompt, input.supportedFacts ?? [])) {
    throw tkPromptContractError(
      'TK_PROMPT_EXECUTION_LANGUAGE_INVALID',
      'Seedance 执行 Prompt 的非口播内容必须使用简体中文',
    );
  }
  return prompt;
}

export function renderTkPromptExecutionPrompt(input: {
  candidate: TkPromptOptionCandidate;
  strategy: TkPromptStrategy;
  factPack: TkPromptFactPack;
  durationSeconds: 5 | 10 | 15;
  spokenLanguage: TkPromptLanguage | null;
  imageAssetIds?: string[];
}) {
  const imageAssetIds = input.imageAssetIds
    ?? [...new Set(input.factPack.facts.flatMap(fact => fact.sourceImageIds))];
  const timeline = tkPromptTimeline(input.durationSeconds);
  const compiledBeats = compileTkPromptCandidateBeats(input);
  if (input.durationSeconds !== 5 && !input.spokenLanguage) {
    throw tkPromptContractError(
      'TK_PROMPT_SPOKEN_LANGUAGE_REQUIRED',
      '10/15 秒执行 Prompt 缺少口播语言',
    );
  }
  const clip = (value: string, maximum: number) => {
    if (value.length <= maximum) return value;
    const prefix = value.slice(0, Math.max(1, maximum - 1))
      .replace(/[\uD800-\uDBFF]$/u, '');
    return `${prefix}…`;
  };
  const buildPrompt = (scale: number | null) => {
    const fit = (value: string, maximum: number) => scale === null
      ? value
      : clip(value, Math.max(12, Math.floor(maximum * scale)));
    const lines: string[] = [
      `【TikTok Shop方案】${fit(input.candidate.title, 80)}`,
      `【商品】${fit(input.factPack.productName, 120)}`,
      `【时长】${input.durationSeconds}秒`,
      `【目标市场】${fit(input.factPack.targetMarket, 80)}`,
      `【创意方向】${fit(input.strategy.labelZh, 40)}｜${fit(input.strategy.firstFrame, 160)} → ${fit(input.strategy.productBridge, 160)}`,
      `【参考图固定映射】${imageAssetIds.map((_, index) => `@图片${index + 1}=上传顺序第${index + 1}张`).join('；')}`,
      '参考图身份连续性：全片严格沿用以上上传顺序和同一主商品身份，不得重排、替换、拼接成其他商品或自由编造参考图编号。',
      input.strategy.videoMode === 'live_presenter'
        ? TK_PROMPT_LIVE_PRESENTER_BOUNDARY
        : TK_PROMPT_NON_LIVE_PERSON_BOUNDARY,
      ...(input.strategy.videoMode === 'live_presenter'
        ? [input.durationSeconds === 5
            ? '主持人音频：主持人仅作无声动作演示；全片禁止任何人声。'
            : `主持人口播：人物文化语境适合${fit(input.factPack.targetMarket, 80)}，全片声音特征连续，口型与各镜头的${input.spokenLanguage ?? ''}旁白自然对应。`]
        : []),
      ...(input.durationSeconds === 5
        ? ['连续动作：三拍必须是同一主要商品动作的启动 → 与用户相关的推进 → 完成，不得改成三个互不相干的动作。']
        : []),
      '',
    ];
    compiledBeats.forEach((beat, index) => {
      lines.push(
        `【${beat.startSeconds}-${beat.endSeconds}秒｜${TK_PROMPT_TIMELINE_PHASE_TEXT[timeline[index]?.[2] ?? 'proof']}】`,
        `画面：${fit(beat.environment, 64)}；主体：${fit(beat.subject, 120)}；动作：${fit(beat.action, 160)}`,
        `镜头：${fit(beat.shotSize, 40)}；运镜：${beat.cameraMovement}；光线：${fit(beat.lighting, 64)}`,
        `剪辑：${fit(beat.editingCue, 64)}`,
        `声音：${fit(beat.soundDesign, 96)}`,
      );
      if (input.durationSeconds !== 5 && input.spokenLanguage) {
        lines.push(
          `旁白（${LANGUAGE_LABELS[input.spokenLanguage]}）：${fit(beat.voiceoverTarget, 120)}`,
        );
      }
      lines.push('');
    });
    lines.push(TK_PROMPT_VISUAL_TEXT_BOUNDARY);
    return lines.join('\n').trim();
  };
  let prompt = buildPrompt(null);
  if (prompt.length > 3_800) {
    for (const scale of [1, 0.75, 0.5, 0.35, 0.25, 0.15]) {
      prompt = buildPrompt(scale);
      if (prompt.length <= 3_800) break;
    }
  }
  if (prompt.length > 3_800) {
    throw tkPromptContractError(
      'TK_PROMPT_EXECUTION_PROMPT_TOO_LONG',
      'Seedance 执行 Prompt 超过 AI Studio 3800 字符上限',
    );
  }
  if (FORBIDDEN_EXECUTION_PROMPT_LANGUAGE_LOCK.test(prompt)) {
    throw tkPromptContractError(
      'TK_PROMPT_LANGUAGE_LOCK_FORBIDDEN',
      '执行 Prompt 不得包含全局音频语言硬约束',
    );
  }
  for (const translation of input.candidate.beats.map(beat => beat.voiceoverZh).filter(Boolean)) {
    if (prompt.includes(translation)) {
      throw tkPromptContractError(
        'TK_PROMPT_REVIEW_TRANSLATION_LEAKED',
        '中文审核译文不得进入 Seedance 执行 Prompt',
      );
    }
  }
  const internalIdentifiers = [
    ...imageAssetIds,
    ...input.factPack.facts.flatMap(fact => [fact.factId, ...fact.sourceImageIds]),
    ...tkPromptDemonstrableActionRegistry(input.factPack).map(action => action.actionId),
    ...input.candidate.coreInformationPoints.map(point => point.messageId),
  ];
  return validateTkPromptFinalExecutionPrompt({
    prompt,
    imageCount: imageAssetIds.length,
    videoMode: input.strategy.videoMode,
    durationSeconds: input.durationSeconds,
    internalIdentifiers,
    forbiddenClaims: input.factPack.forbiddenClaims,
    verifiedOffer: input.factPack.verifiedOffer,
    supportedFacts: [
      input.factPack.productName,
      input.factPack.category,
      input.factPack.targetMarket,
      ...tkPromptAllowedFactTexts(input.factPack, input.strategy.allowedFactIds),
    ],
  });
}

export function tkPromptContractError(code: string, message: string) {
  return Object.assign(new Error(message), { code, statusCode: 422, exposeMessage: true });
}

const TK_PROMPT_FORBIDDEN_PERSONA_PATTERN = /(?:\bGMV\b|(?:\d+|十(?:余|多|几)?|数十)年.{0,20}(?:经验|从业)|(?:拥有|具备|身为).{0,16}(?:\d+|十(?:余|多|几)?)年.{0,12}(?:经验|从业)|(?:十亿|百亿|千万|亿级).{0,16}(?:销售额|销量|业绩|成交额|营收)|世界.{0,8}(?:顶级|一流).{0,12}(?:编导|专家|导演|策略师)|顶级.{0,12}(?:编导|专家|导演|策略师)|操盘过|专家.{0,8}(?:推荐|背书|认证)|(?:作为|我是|本方案由).{0,20}(?:专家|编导|导演|策略师)|(?:world[-\s]?class|top[-\s](?:tier|ranked)|leading).{0,24}(?:e-?commerce|tiktok\s+shop|marketing|creative)?\s*(?:expert|director|strategist)|\d+\s+years?.{0,16}(?:of\s+)?experience|(?:billion[- ]level|billions?\s+(?:in|of)\s+(?:sales|revenue)|billion[- ](?:sales|revenue)))/iu;
const TK_PROMPT_AI_DISCLOSURE_PATTERN = /(?:^|[^\p{L}\p{N}_])(?:#\s*)?AIGC(?![\p{L}\p{N}_])|#\s*AI(?![\p{L}\p{N}_])|(?:由\s*)?(?:AI|人工智能)\s*(?:生成|制作|创作|合成)(?:的?内容)?|(?:AI[-\s]?(?:generated|created|made)|(?:generated|created|made)\s+(?:by|with)\s+(?:AI|artificial\s+intelligence))/iu;
const PROMOTION_VALUE_PATTERN = /(?:[$€£¥]\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:%|折|元|美元|欧元|英镑))/giu;
const PROMOTION_SCARCITY_VALUE_PATTERN = /(?:仅剩\s*\d+\s*[件个套]?|only\s+\d+\s+left)/giu;
const PROMOTION_DISCOUNT_VALUE_PATTERN = /(?:第\s*(?:\d+|[一二三四五六七八九十]+)\s*件\s*(?:半价|(?:\d+(?:[.,]\d+)?|[一二三四五六七八九]+)折)|半价|特价|(?:[一二三四五六七八九]+)折|满\s*\d+(?:[.,]\d+)?\s*(?:减|省)\s*\d+(?:[.,]\d+)?|(?:立减|直降|减免)\s*\d+(?:[.,]\d+)?|(?:second\s+(?:item|one)\s+)?half[-\s]+price|special\s+price)/giu;
const PROMOTION_BUNDLE_VALUE_PATTERN = /(?:买\s*(?:\d+|[一二三四五六七八九十]+)\s*送\s*(?:\d+|[一二三四五六七八九十]+)|buy\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:and\s+)?get\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+free)?)/giu;
const PROMOTION_FAMILY_PATTERNS = {
  discount_coupon: /(?:优惠|折扣|立减|满减|半价|特价|第\s*(?:\d+|[一二三四五六七八九十]+)\s*件\s*半价|(?:\d+(?:[.,]\d+)?|[一二三四五六七八九]+)折|满\s*\d+(?:[.,]\d+)?\s*(?:减|省)|优惠券|代金券|券码|\d+(?:[.,]\d+)?\s*%\s*off|half[-\s]+price|special\s+price|\bdiscount\b|\bcoupons?\b|\bon\s+sale\b|\bsale\b|descuento|cup[oó]n|desconto|cupom|r[ée]duction|remise|diskon|kupon|sconto|割引|クーポン|diskaun|ส่วนลด|คูปอง|giảm\s+giá|mã\s+giảm\s+giá|rabatt|gutschein|korting|kortingsbon|rabat)/iu,
  free_shipping: /(?:包邮|免邮|free\s+shipping|env[ií]o\s+gratis|frete\s+gr[áa]tis|livraison\s+gratuite|gratis\s+ongkir|pengiriman\s+gratis|spedizione\s+gratuita|送料無料|penghantaran\s+percuma|ส่งฟรี|miễn\s+phí\s+vận\s+chuyển|kostenloser\s+versand|gratis\s+verzending|darmowa\s+wysyłka)/iu,
  gift: /(?:赠品|加赠|赠送礼品|free\s+gift|gift\s+with\s+purchase|regalo\s+gratis|brinde\s+gr[áa]tis|cadeau\s+gratuit|hadiah\s+gratis|regalo\s+omaggio|無料プレゼント|購入特典|hadiah\s+percuma|ของแถม|quà\s+tặng|gratisgeschenk|gratis\s+cadeau|darmowy\s+prezent)/iu,
  buy_one_get_one: /(?:买\s*(?:\d+|[一二三四五六七八九十]+)\s*送\s*(?:\d+|[一二三四五六七八九十]+)|\bBOGO\b|buy\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:and\s+)?get\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+free)?|compra\s+uno\s+(?:y\s+)?(?:ll[ée]vate|recibe)\s+otro|compre\s+um\s+(?:e\s+)?leve\s+outro|achetez[-\s]+en\s+un.{0,16}offert|beli\s+satu\s+gratis\s+satu|paghi\s+uno.{0,16}due|一つ買うと一つ無料|mua\s+một\s+tặng\s+một|kauf\s+eins.{0,16}gratis|kup\s+jeden.{0,16}gratis)/iu,
  limited_time: /(?:限时|最后机会|截止.{0,12}(?:优惠|折扣|活动)|limited\s+time|last\s+chance|por\s+tiempo\s+limitado|tempo\s+limitado|dur[ée]e\s+limit[ée]e|waktu\s+terbatas|tempo\s+limitato|期間限定|masa\s+terhad|เวลาจำกัด|thời\s+gian\s+có\s+hạn|nur\s+für\s+kurze\s+zeit|beperkte\s+tijd|ograniczony\s+czas)/iu,
  scarcity: /(?:仅剩|库存|余量|only\s+\d+\s+left|left\s+in\s+stock|stock\s+left|solo\s+quedan|s[oó]\s+restam|plus\s+que\s+\d+|tersisa|rimasti|scorte|残り|在庫|tinggal|สต็อก|เหลือ|chỉ\s+còn|tồn\s+kho|nur\s+noch|lagerbestand|nog\s+maar|voorraad|zostało|zapas)/iu,
  price: /(?:价格|售价|到手价|最低价|史低|\bprice\b|sale\s+price|lowest\s+price|precio|preço|prix|harga|prezzo|価格|ราคา|\bgiá\b|\bpreis\b|\bprijs\b|\bcena\b|[$€£¥]\s*\d)/iu,
} as const;
type TkPromptPromotionFamily = keyof typeof PROMOTION_FAMILY_PATTERNS;
const TK_PROMPT_UUID_PATTERN = /(?:^|[^0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![0-9a-f])/iu;
const TK_PROMPT_INTERNAL_ID_PATTERN = /(?:^|[^\p{L}\p{N}_])(?:visible|confirmed|action|message)-\d{3}(?![\p{L}\p{N}_])/iu;
const TK_PROMPT_UUID_TOKEN_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu;
const TK_PROMPT_INTERNAL_ID_TOKEN_PATTERN = /(?:visible|confirmed|action|message)-\d{3}/giu;

function containsTkPromptKnownInternalIdentifier(text: string, internalIdentifiers: string[]) {
  const normalizedText = normalizeTkPromptLeakText(text);
  return internalIdentifiers.some(identifier => {
    const normalizedIdentifier = normalizeTkPromptLeakText(identifier);
    return normalizedIdentifier.length >= 6 && normalizedText.includes(normalizedIdentifier);
  });
}

function sanitizeTkPromptInternalIdentifiers(
  value: string,
  fallback: string,
  internalIdentifiers: string[],
) {
  let sanitized = value
    .replace(TK_PROMPT_UUID_TOKEN_PATTERN, ' ')
    .replace(TK_PROMPT_INTERNAL_ID_TOKEN_PATTERN, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (containsTkPromptKnownInternalIdentifier(sanitized, internalIdentifiers)) {
    sanitized = fallback;
  }
  return sanitized || fallback;
}

function assertTkPromptInternalIdentifiersAbsent(
  text: string,
  internalIdentifiers: string[],
  field: string,
) {
  if (
    TK_PROMPT_UUID_PATTERN.test(text)
    || TK_PROMPT_INTERNAL_ID_PATTERN.test(text)
    || containsTkPromptKnownInternalIdentifier(text, internalIdentifiers)
  ) {
    throw tkPromptContractError(
      'TK_PROMPT_INTERNAL_IDENTIFIER_LEAKED',
      `${field} 泄漏了素材 UUID 或内部标识`,
    );
  }
}

function assertTkPromptPromotionBoundToOffer(
  text: string,
  offer: { price?: string; condition?: string; endAt?: string } | null,
  field: string,
  supportedFacts: string[] = [],
) {
  const textFamilies = tkPromptPromotionFamilies(text);
  if (textFamilies.size === 0) return;
  if (!offer) {
    throw tkPromptContractError(
      'TK_PROMPT_UNVERIFIED_PROMOTION_FORBIDDEN',
      `${field} 不得生成未验证的价格、折扣、库存或限时信息`,
    );
  }
  const offerText = [offer.price, offer.condition, offer.endAt].filter(Boolean).join(' ');
  const offerFamilies = tkPromptPromotionFamilies(offerText);
  if (offer.price) offerFamilies.add('price');
  if (offer.endAt) offerFamilies.add('limited_time');
  if (/\d+(?:[.,]\d+)?\s*%/u.test(offer.condition ?? '')) {
    offerFamilies.add('discount_coupon');
  }
  if ([...textFamilies].some(family => !offerFamilies.has(family))) {
    throw tkPromptContractError(
      'TK_PROMPT_PROMOTION_ENHANCEMENT_FORBIDDEN',
      `${field} 增强了已验证优惠中不存在的促销语义`,
    );
  }
  const promotionText = maskTkPromptNonPromotionFacts(text, supportedFacts);
  const offerValues = new Set(tkPromptPromotionValues(offerText).map(normalizeTkPromptClaim));
  if (tkPromptPromotionValues(promotionText).some(
    value => !offerValues.has(normalizeTkPromptClaim(value)),
  )) {
    throw tkPromptContractError(
      'TK_PROMPT_PROMOTION_VALUE_UNVERIFIED',
      `${field} 使用了已验证优惠中不存在的数值`,
    );
  }
}

function tkPromptPromotionValues(text: string) {
  const contextualPatterns = [
    PROMOTION_DISCOUNT_VALUE_PATTERN,
    PROMOTION_BUNDLE_VALUE_PATTERN,
    PROMOTION_SCARCITY_VALUE_PATTERN,
  ];
  const values: string[] = [];
  let remainder = text;
  for (const pattern of contextualPatterns) {
    values.push(...[...remainder.matchAll(pattern)].map(match => match[0]));
    remainder = remainder.replace(pattern, ' ');
  }
  values.push(...[...remainder.matchAll(PROMOTION_VALUE_PATTERN)].map(match => match[0]));
  return values;
}

function tkPromptPromotionFamilies(value: string): Set<TkPromptPromotionFamily> {
  return new Set((Object.entries(PROMOTION_FAMILY_PATTERNS) as Array<[
    TkPromptPromotionFamily,
    RegExp,
  ]>).flatMap(([family, pattern]) => pattern.test(value) ? [family] : []));
}

function maskTkPromptNonPromotionFacts(text: string, supportedFacts: string[]) {
  return supportedFacts.reduce((masked, fact) => {
    if (tkPromptPromotionFamilies(fact).size > 0) return masked;
    const variants = [fact, JSON.stringify(fact).slice(1, -1)];
    return variants.reduce((result, variant) => {
      if (!variant) return result;
      return result.replace(new RegExp(escapeTkPromptRegExp(variant), 'giu'), ' ');
    }, masked);
  }, text);
}

function escapeTkPromptRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function assertTkPromptForbiddenClaimsAbsent(
  text: string,
  forbiddenClaims: string[],
  field: string,
) {
  const normalizedText = normalizeTkPromptClaim(text);
  const leaked = forbiddenClaims.find(claim => {
    const normalized = normalizeTkPromptForbiddenClaim(claim);
    return normalized.length >= 2 && normalizedText.includes(normalized);
  });
  if (leaked) {
    throw tkPromptContractError(
      'TK_PROMPT_FORBIDDEN_CLAIM_LEAKED',
      `${field} 泄漏了用户禁止声明`,
    );
  }
}

function normalizeTkPromptForbiddenClaim(value: string) {
  const withoutInstructionPrefix = value.normalize('NFKC').trim()
    .replace(
      /^(?:请|务必)?\s*(?:不要|别|禁止|不得|不可|避免)\s*(?:再)?\s*(?:提及|提到|提|出现|使用|声称|宣称|描述|写入|写|说出|说|包含)?\s*(?:任何|有关|关于)?\s*/u,
      '',
    )
    .replace(
      /^(?:please\s+)?(?:do\s+not|don't|never|must\s+not|avoid|exclude)\s+(?:(?:ever|any)\s+)?(?:mention|say|claim|state|include|use|show|write|describe)?\s*(?:any\s+)?/iu,
      '',
    );
  return normalizeTkPromptClaim(withoutInstructionPrefix);
}

function normalizeTkPromptClaim(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function normalizeTkPromptLeakText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}
