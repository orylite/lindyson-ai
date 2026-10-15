import type {
  PromptWizardCreativeBrief,
  PromptWizardDirectionAssessment,
  PromptWizardEvidence,
  PromptWizardEvidenceConfidence,
  PromptWizardEvidenceGraph,
  PromptWizardEvidenceType,
  PromptWizardProductFamily,
  PromptWizardProductProfile,
  PromptWizardProductionBrief,
} from '@lindyson/api-contracts';
import { buildPromptWizardReliableFactCatalog } from './promptWizardEvidence.js';

export interface PromptWizardEvidenceCapabilities {
  hasImageEvidence: boolean;
  hasPackagingEvidence: boolean;
  hasUsageAction: boolean;
  hasVisibleStructure: boolean;
  hasMaterialEvidence: boolean;
  hasLogoOrPrint: boolean;
  hasFoleyAction: boolean;
  hasConfirmedTestableFeature: boolean;
  hasSafeBeforeAfterEvidence: boolean;
}

export interface PromptWizardVisibleFactSource {
  factIndex: number;
  imageAssetIds: string[];
  visibleArea: string;
}

/**
 * 产品识别 Provider 给出的字段级图片溯源。fieldPath 使用产品档案路径，例如
 * `structure`、`logo` 或 `visibleFacts[0]`；图片资产 ID 由服务端根据 Provider
 * 返回的一基图片序号映射，绝不接受模型伪造资产 ID。
 */
export interface PromptWizardDetectedEvidenceSource {
  fieldPath: string;
  imageAssetIds: string[];
  visibleRegion: string;
  confidence: Exclude<PromptWizardEvidenceConfidence, 'unknown'>;
  proofActions: string[];
}

const FAMILY_PATTERNS: Record<Exclude<PromptWizardProductFamily, 'general'>, readonly RegExp[]> = {
  'apparel-accessories': [
    /(?:服装|服饰|衣服|上衣|外套|夹克|衬衫|短袖|长袖|t恤|裙|裤|袜|鞋|靴|帽|围巾|手套|箱包|背包|挎包|配饰|首饰|项链|耳环|手链|戒指|腰带|领带)/iu,
    /(?:领口|袖口|鞋底|鞋面|肩带|拉链|纽扣|印花|刺绣|穿着|佩戴)/iu,
  ],
  'beauty-personal-care': [
    /(?:美妆|护肤|个护|口红|唇釉|粉底|遮瑕|眼影|睫毛膏|面膜|精华|乳液|面霜|洁面|防晒|洗发|护发|沐浴|香水|美容仪)/iu,
    /(?:涂抹|按压泵头|滴管|膏体|液体|喷雾|刷头|瓶身)/iu,
  ],
  'consumer-electronics': [
    /(?:消费电子|电子产品|耳机|音箱|手机|平板|电脑|键盘|鼠标|相机|摄像头|麦克风|充电器|充电宝|数据线|智能手表|智能穿戴|游戏机|遥控器)/iu,
    /(?:按键|接口|屏幕|指示灯|电源|充电|蓝牙|连接|开机|折叠头梁|耳罩)/iu,
  ],
  'home-living': [
    /(?:家居|家用|厨房|餐厨|收纳|清洁|杯|水壶|锅|餐具|刀具|砧板|床品|枕|被|毛巾|家具|灯具|摆件|花瓶|置物架|拖把|刷子|垃圾桶)/iu,
    /(?:抽屉|柜体|锅盖|杯盖|清洗|擦拭|悬挂|摆放|折叠收纳)/iu,
  ],
};

const TESTABLE_FEATURE_PATTERN = /(?:支持|具备|可|能够|功能|模式|档位|降噪|续航|快充|防水|防尘|保温|加热|制冷|定时|调节|连接|识别|检测|容量|功率|速干|排汗|抗菌|清洁)/iu;
const COMMERCIAL_CLAIM_PATTERN = /(?:价格|售价|优惠|折扣|认证|保证|效果|功效|续航|降噪|防水|防尘|快充|\d)/iu;
const PACKAGING_PATTERN = /(?:包装|包装盒|外盒|礼盒|密封膜|封口|开箱|拆封)/iu;
const FOLEY_PATTERN = /(?:按|压|拨|旋|拧|开|合|扣|卡|折|拉|推|滑|敲|摩擦|撕|倒|喷|滴|刷|穿|戴|布料|金属|玻璃|木|皮革|拉链|纽扣|按键|瓶盖|盒盖)/iu;
const OBSERVABLE_PRODUCT_ACTION_PATTERN = /(?:手拿|拿起|拿出|拿住|放下|放入|放回|放置|摆放|按下|按住|按压|轻按|压入|压下|压住|挤压|拨动|拨开|推动|推开|推入|拉开|拉起|拉出|拉动|旋转|拧开|拧紧|拧动|折叠|弯折|打开|开启|开合|合上|闭合|扣上|扣紧|解扣|穿上|穿入|套头穿|穿戴|戴上|佩戴|取出|取下|取用|倒入|倒出|倾倒|倾斜|注入|滴入|滴下|喷出|喷洒|涂抹|涂上|刷开|刷过|擦拭|擦过|撕开|撕下|拆开|拆下|拆封|插入|插上|拔出|拔下|滑动|滑入|滑出|翻转|转动|转向|转身|抬起|托起|端起|握住|展开|收起|点亮|熄灭|揭开|揭晓|露出|呈现|移动|停住|碰杯|碰触|触碰|敲击|晃动|摇晃|展示|演示|操作|靠近|贴近|对准|套入|装入|抽出|举起|搅拌|特写|近景|环绕|推近|拉近|对焦|扫过|跟拍|停留|定格)/u;

/**
 * EvidenceGraph 与使用方向共用的可执行动作边界。
 *
 * 除了手部或产品的物理动作，稳定特写、近景、环绕等明确的摄影动作也是
 * 纯产品、Logo 和印花证据可观察、可拍摄的自证方式。单纯的情绪、价值或氛围词不在
 * 此范围内。
 */
export function isPromptWizardObservableAction(value: string) {
  return OBSERVABLE_PRODUCT_ACTION_PATTERN.test(normalizeEvidenceText(value));
}

export function classifyPromptWizardProductFamily(
  profile: PromptWizardProductProfile,
): PromptWizardProductFamily {
  const primaryText = `${profile.productName} ${profile.category}`;
  const secondaryText = [
    profile.materials,
    profile.structure,
    profile.logo,
    profile.usage,
    ...profile.visibleFacts,
  ].join(' ');
  const scores = Object.entries(FAMILY_PATTERNS).map(([family, patterns]) => ({
    family: family as Exclude<PromptWizardProductFamily, 'general'>,
    score: patterns.reduce((score, pattern) => (
      score + (pattern.test(primaryText) ? 4 : 0) + (pattern.test(secondaryText) ? 1 : 0)
    ), 0),
  }));
  scores.sort((left, right) => right.score - left.score);
  return scores[0] && scores[0].score > 0 ? scores[0].family : 'general';
}

export function buildPromptWizardEvidenceGraph(input: {
  profile: PromptWizardProductProfile;
  imageAssetIds: readonly string[];
  detectedEvidenceSources?: readonly PromptWizardDetectedEvidenceSource[];
  /** @deprecated 只用于旧测试/旧识别结果的 visibleFacts 索引兼容。 */
  visibleFactSources?: readonly PromptWizardVisibleFactSource[];
}): PromptWizardEvidenceGraph;
export function buildPromptWizardEvidenceGraph(
  profile: PromptWizardProductProfile,
  imageInput: number | readonly string[],
): PromptWizardEvidenceGraph;
export function buildPromptWizardEvidenceGraph(
  inputOrProfile: {
    profile: PromptWizardProductProfile;
    imageAssetIds: readonly string[];
    detectedEvidenceSources?: readonly PromptWizardDetectedEvidenceSource[];
    visibleFactSources?: readonly PromptWizardVisibleFactSource[];
  } | PromptWizardProductProfile,
  imageInput?: number | readonly string[],
): PromptWizardEvidenceGraph {
  const input = 'profile' in inputOrProfile
    ? inputOrProfile
    : {
      profile: inputOrProfile,
      // 只有数量时不能伪造资产 UUID；证据仍保留“来自图片识别”的区域说明。
      imageAssetIds: Array.isArray(imageInput) ? imageInput : [],
      detectedEvidenceSources: undefined,
      visibleFactSources: undefined,
    };
  const imageAssetIds = uniqueNonempty(input.imageAssetIds);
  const reliableCatalog = buildPromptWizardReliableFactCatalog(input.profile);
  const visibleSources = new Map(
    (input.visibleFactSources ?? []).map(item => [item.factIndex, item]),
  );
  const detectedSources = new Map(
    (input.detectedEvidenceSources ?? []).map(item => [item.fieldPath, item]),
  );
  const usesDetectedProvenance = input.detectedEvidenceSources !== undefined;
  const candidateEvidences = reliableCatalog.map((fact): PromptWizardEvidence => {
    const source = evidenceSource(
      fact.id,
      imageAssetIds,
      detectedSources,
      visibleSources,
      usesDetectedProvenance,
    );
    const type = evidenceType(fact.id, fact.text);
    const userConfirmed = fact.id.startsWith('confirmed:');
    const status = userConfirmed
      ? 'user-confirmed' as const
      : !usesDetectedProvenance
        || (
          source.imageAssetIds.length > 0
          && (source.confidence === 'high' || source.confidence === 'medium')
        )
        ? 'visible' as const
        : 'needs-confirmation' as const;
    return {
      id: fact.id,
      type,
      text: fact.text,
      sourceImageAssetIds: source.imageAssetIds,
      visibleRegion: source.visibleRegion,
      status,
      confidence: userConfirmed ? 'unknown' : source.confidence,
      proofActions: status === 'needs-confirmation'
        ? []
        : normalizePromptWizardProofActions(type, fact.text, source.proofActions),
    };
  });
  const reliableEvidences = candidateEvidences.filter(item => (
    item.status === 'visible' || item.status === 'user-confirmed'
  ));
  const provenancePendingEvidences = candidateEvidences.filter(item => (
    item.status === 'needs-confirmation'
  ));
  const profilePendingEvidences = input.profile.needsConfirmation
    .map((text, index): PromptWizardEvidence => ({
      id: `needs-confirmation:${index + 1}`,
      type: evidenceType('needs-confirmation', text),
      text: text.trim(),
      sourceImageAssetIds: [],
      visibleRegion: '待用户确认',
      status: 'needs-confirmation',
      confidence: 'unknown',
      proofActions: [],
    }))
    .filter(item => item.text.length > 0);
  const pendingEvidences = [...provenancePendingEvidences, ...profilePendingEvidences];
  const forbiddenEvidences = pendingEvidences.map((item, index): PromptWizardEvidence => ({
    ...item,
    id: `forbidden-assumption:${index + 1}`,
    status: 'forbidden-assumption',
    visibleRegion: '未确认前禁止写入创意',
  }));
  const evidences = [...reliableEvidences, ...pendingEvidences, ...forbiddenEvidences];
  const core = {
    version: 1 as const,
    productFamily: classifyPromptWizardProductFamily(input.profile),
    evidences,
    reliableEvidenceIds: reliableEvidences.map(item => item.id),
    pendingEvidenceIds: pendingEvidences.map(item => item.id),
    forbiddenAssumptionIds: forbiddenEvidences.map(item => item.id),
  };
  return {
    ...core,
    directionAssessments: buildInitialDirectionAssessments(core),
  };
}

/**
 * 用户编辑产品档案后的权威重分类：完全未改动的图片事实保留原溯源；任何新写、
 * 改写或重排后无法按原文匹配的内容只可成为 user-confirmed，绝不能继续携带
 * 图片来源冒充视觉事实。待确认项仍保持 pending/forbidden。
 */
export function reconcilePromptWizardEvidenceGraphForProfileUpdate(input: {
  profile: PromptWizardProductProfile;
  previousGraph: PromptWizardEvidenceGraph;
  imageAssetIds: readonly string[];
}): PromptWizardEvidenceGraph {
  const baseline = buildPromptWizardEvidenceGraph({
    profile: input.profile,
    imageAssetIds: input.imageAssetIds,
    detectedEvidenceSources: [],
  });
  const priorReliable = input.previousGraph.evidences.filter(item => (
    item.status === 'visible' || item.status === 'user-confirmed'
  ));
  const priorById = new Map(priorReliable.map(item => [item.id, item]));
  const priorByText = new Map<string, PromptWizardEvidence[]>();
  for (const evidence of priorReliable) {
    const key = normalizeEvidenceText(evidence.text);
    priorByText.set(key, [...(priorByText.get(key) ?? []), evidence]);
  }
  const consumedPriorIds = new Set<string>();
  const profileFactIds = new Set(buildPromptWizardReliableFactCatalog(input.profile).map(item => item.id));
  const revisedFacts = baseline.evidences
    .filter(item => profileFactIds.has(item.id))
    .map((evidence): PromptWizardEvidence => {
      const sameId = priorById.get(evidence.id);
      const exact = sameId && normalizeEvidenceText(sameId.text) === normalizeEvidenceText(evidence.text)
        ? sameId
        : (priorByText.get(normalizeEvidenceText(evidence.text)) ?? [])
          .find(item => !consumedPriorIds.has(item.id));
      if (exact) {
        consumedPriorIds.add(exact.id);
        return {
          ...exact,
          id: evidence.id,
          text: evidence.text,
          proofActions: normalizePromptWizardProofActions(
            exact.type,
            evidence.text,
            exact.proofActions,
          ),
        };
      }
      return {
        ...evidence,
        sourceImageAssetIds: [],
        visibleRegion: '用户编辑确认',
        status: 'user-confirmed',
        confidence: 'unknown',
        proofActions: normalizePromptWizardProofActions(evidence.type, evidence.text, []),
      };
    });
  const pending = baseline.evidences.filter(item => (
    item.status === 'needs-confirmation' && !profileFactIds.has(item.id)
  ));
  const forbidden = pending.map((item, index): PromptWizardEvidence => ({
    ...item,
    id: `forbidden-assumption:${index + 1}`,
    status: 'forbidden-assumption',
    visibleRegion: '未确认前禁止写入创意',
  }));
  const evidences = [...revisedFacts, ...pending, ...forbidden];
  const core = {
    version: 1 as const,
    productFamily: classifyPromptWizardProductFamily(input.profile),
    evidences,
    reliableEvidenceIds: revisedFacts.map(item => item.id),
    pendingEvidenceIds: pending.map(item => item.id),
    forbiddenAssumptionIds: forbidden.map(item => item.id),
  };
  return {
    ...core,
    directionAssessments: buildInitialDirectionAssessments(core),
  };
}

/**
 * “主推购买理由”是用户在轻确认步骤主动提供的事实，不属于图片识别。它使用
 * 独立、稳定的 evidence ID，既不借用任意结构事实，也不携带图片来源。
 */
export function mergePromptWizardProductionBriefEvidence(
  graph: PromptWizardEvidenceGraph,
  productionBrief: PromptWizardProductionBrief,
): PromptWizardEvidenceGraph {
  const evidenceId = 'brief:primaryPurchaseReason';
  const withoutPrior = graph.evidences.filter(item => item.id !== evidenceId);
  const reason = productionBrief.primaryPurchaseReason.trim();
  const purchaseEvidence: PromptWizardEvidence[] = reason ? [{
    id: evidenceId,
    type: COMMERCIAL_CLAIM_PATTERN.test(reason) ? 'commercial-claim' : 'capability',
    text: reason,
    sourceImageAssetIds: [],
    visibleRegion: '用户确认的主推购买理由',
    status: 'user-confirmed',
    confidence: 'unknown',
    proofActions: normalizePromptWizardProofActions('capability', reason, [
      `用安全、可观察的产品动作或稳定近景展示该购买理由：${reason}`,
    ]),
  }] : [];
  const evidences = [...withoutPrior, ...purchaseEvidence];
  const reliableEvidenceIds = graph.reliableEvidenceIds
    .filter(id => id !== evidenceId)
    .concat(purchaseEvidence.map(item => item.id));
  const core = {
    version: graph.version,
    productFamily: graph.productFamily,
    evidences,
    reliableEvidenceIds,
    pendingEvidenceIds: graph.pendingEvidenceIds.filter(id => id !== evidenceId),
    forbiddenAssumptionIds: graph.forbiddenAssumptionIds.filter(id => id !== evidenceId),
  };
  return {
    ...core,
    directionAssessments: buildInitialDirectionAssessments(core),
  };
}

export function derivePromptWizardEvidenceCapabilities(
  graph: Pick<PromptWizardEvidenceGraph, 'evidences' | 'reliableEvidenceIds'>,
): PromptWizardEvidenceCapabilities {
  const reliableIds = new Set(graph.reliableEvidenceIds);
  const reliable = graph.evidences.filter(item => reliableIds.has(item.id));
  const visibleText = reliable.filter(item => item.status === 'visible').map(item => item.text).join(' ');
  const confirmedText = reliable.filter(item => item.status === 'user-confirmed').map(item => item.text).join(' ');
  const hasUsageAction = reliable.some(item => item.type === 'usage');
  const hasVisibleStructure = reliable.some(item => item.type === 'structure');
  const hasMaterialEvidence = reliable.some(item => item.type === 'material');
  const hasLogoOrPrint = reliable.some(item => item.type === 'logo-print');
  return {
    hasImageEvidence: reliable.some(item => item.sourceImageAssetIds.length > 0),
    hasPackagingEvidence: PACKAGING_PATTERN.test(visibleText),
    hasUsageAction,
    hasVisibleStructure,
    hasMaterialEvidence,
    hasLogoOrPrint,
    hasFoleyAction: FOLEY_PATTERN.test(`${visibleText} ${confirmedText}`),
    hasConfirmedTestableFeature: Boolean(confirmedText && TESTABLE_FEATURE_PATTERN.test(confirmedText)),
    hasSafeBeforeAfterEvidence: hasUsageAction && reliable.length >= 2,
  };
}

const DIRECTIONS: PromptWizardCreativeBrief['direction'][] = [
  'ugc', 'problem-solution', 'unboxing-review', 'feature-test',
  'pain-comparison', 'lifestyle', 'cinematic-brand', 'asmr-detail',
];

const INITIAL_RECOMMENDED: Record<PromptWizardProductFamily, readonly PromptWizardCreativeBrief['direction'][]> = {
  'apparel-accessories': ['ugc', 'lifestyle', 'pain-comparison', 'asmr-detail'],
  'beauty-personal-care': ['ugc', 'problem-solution', 'lifestyle', 'asmr-detail'],
  'consumer-electronics': ['ugc', 'problem-solution', 'feature-test', 'unboxing-review'],
  'home-living': ['problem-solution', 'lifestyle', 'feature-test', 'asmr-detail'],
  general: ['ugc', 'problem-solution', 'cinematic-brand'],
};

function buildInitialDirectionAssessments(
  graph: Pick<PromptWizardEvidenceGraph, 'productFamily' | 'evidences' | 'reliableEvidenceIds'>,
): PromptWizardDirectionAssessment[] {
  const capabilities = derivePromptWizardEvidenceCapabilities(graph);
  return DIRECTIONS.map((direction) => {
    const missingRequirements: string[] = [];
    if (direction === 'unboxing-review' && !capabilities.hasPackagingEvidence) {
      missingRequirements.push('缺少可见包装或开箱素材');
    }
    if (direction === 'feature-test' && !capabilities.hasConfirmedTestableFeature) {
      missingRequirements.push('缺少用户确认且可观察的测试功能');
    }
    if (direction === 'asmr-detail' && !capabilities.hasFoleyAction) {
      missingRequirements.push('缺少可产生真实操作声的动作或结构');
    }
    if (direction === 'pain-comparison' && !capabilities.hasSafeBeforeAfterEvidence) {
      missingRequirements.push('缺少可连接使用前后状态的正确使用动作');
    }
    if (
      direction === 'cinematic-brand'
      && !capabilities.hasVisibleStructure
      && !capabilities.hasMaterialEvidence
      && !capabilities.hasLogoOrPrint
    ) {
      missingRequirements.push('缺少可用于质感镜头的结构、材质或标识证据');
    }
    if (missingRequirements.length > 0) {
      return {
        direction,
        availability: 'unavailable',
        reason: missingRequirements.join('；'),
        missingRequirements,
      };
    }
    const recommended = INITIAL_RECOMMENDED[graph.productFamily].includes(direction);
    return {
      direction,
      availability: recommended ? 'recommended' : 'available',
      reason: recommended
        ? '当前产品证据能够支撑该方向的关键镜头。'
        : '可以生成，进入创作前需结合出镜与场景条件确认。',
      missingRequirements: [],
    };
  });
}

export function promptWizardEvidenceById(graph: PromptWizardEvidenceGraph) {
  return new Map(graph.evidences.map(item => [item.id, item]));
}

function evidenceSource(
  id: string,
  imageAssetIds: string[],
  detectedSources: ReadonlyMap<string, PromptWizardDetectedEvidenceSource>,
  visibleSources: ReadonlyMap<number, PromptWizardVisibleFactSource>,
  usesDetectedProvenance: boolean,
) {
  if (id.startsWith('confirmed:')) {
    return {
      imageAssetIds: [] as string[],
      visibleRegion: '用户确认卖点',
      confidence: 'unknown' as const,
      proofActions: [] as string[],
    };
  }
  const fieldPath = evidenceFieldPath(id);
  const detected = fieldPath ? detectedSources.get(fieldPath) : undefined;
  if (detected) {
    return {
      imageAssetIds: uniqueNonempty(detected.imageAssetIds).filter(id => imageAssetIds.includes(id)),
      visibleRegion: detected.visibleRegion.trim(),
      confidence: detected.confidence,
      proofActions: uniqueNonempty(detected.proofActions),
    };
  }
  if (usesDetectedProvenance) {
    return {
      imageAssetIds: [] as string[],
      visibleRegion: '未提供可追溯图片证据',
      confidence: 'unknown' as const,
      proofActions: [] as string[],
    };
  }
  if (id.startsWith('visible:')) {
    const factIndex = Number.parseInt(id.slice('visible:'.length), 10) - 1;
    const source = visibleSources.get(factIndex);
    return {
      imageAssetIds: source ? uniqueNonempty(source.imageAssetIds) : [...imageAssetIds],
      visibleRegion: source?.visibleArea.trim() || '产品主体（旧识别结果未定位具体区域）',
      confidence: source ? 'high' as const : 'unknown' as const,
      proofActions: [] as string[],
    };
  }
  return {
    imageAssetIds: [...imageAssetIds],
    visibleRegion: '产品识别摘要（旧识别结果）',
    confidence: 'unknown' as const,
    proofActions: [] as string[],
  };
}

function evidenceFieldPath(id: string) {
  if (id.startsWith('profile:')) return id.slice('profile:'.length);
  if (id.startsWith('visible:')) {
    const index = Number.parseInt(id.slice('visible:'.length), 10) - 1;
    return Number.isSafeInteger(index) && index >= 0 ? `visibleFacts[${index}]` : null;
  }
  return null;
}

function normalizeEvidenceText(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function evidenceType(id: string, text: string): PromptWizardEvidenceType {
  // 产品名称和品类是主体身份，不是购买理由。必须先按稳定字段 ID 分类，
  // 否则“玻璃饮品杯”“金属水壶”“皮革手袋”等名称会被文本词法误判为材质，
  // 后续又把脚本中正常出现的产品主体误报成第二购买理由。
  if (id === 'profile:productName' || id === 'profile:category') return 'appearance';
  if (id === 'profile:materials') return 'material';
  if (id === 'profile:structure') return 'structure';
  if (id === 'profile:logo') return 'logo-print';
  if (id === 'profile:usage') return 'usage';
  if (id.startsWith('confirmed:')) {
    return COMMERCIAL_CLAIM_PATTERN.test(text) ? 'commercial-claim' : 'capability';
  }
  if (/(?:Logo|标识|印花|文字|图案)/iu.test(text)) return 'logo-print';
  if (/(?:材质|面料|金属|玻璃|塑料|皮革|木)/u.test(text)) return 'material';
  if (/(?:使用|穿|戴|按|旋|打开|折叠|连接|涂抹)/u.test(text)) return 'usage';
  if (/(?:结构|部件|领口|袖口|按键|接口|瓶口|拉链)/u.test(text)) return 'structure';
  return 'other';
}

function deriveProofActions(type: PromptWizardEvidenceType, text: string) {
  if (type === 'usage') return [`完整展示正确使用动作：${text}`];
  if (type === 'structure') return [`近景操作或环绕展示结构：${text}`];
  if (type === 'material') return [`自然光近景配合触碰或弯折展示材质：${text}`];
  if (type === 'logo-print') {
    return [`将 Logo 或印花区域转向镜头，以稳定特写展示并保持原样：${text}`];
  }
  if (type === 'capability' || type === 'commercial-claim') {
    return [`在安全、可观察条件下操作产品，并稳定展示已确认信息对应的可见结果：${text}`];
  }
  if (FOLEY_PATTERN.test(text)) return [`用连续动作和真实操作声展示：${text}`];
  return [`用清晰产品近景展示：${text}`];
}

function normalizePromptWizardProofActions(
  type: PromptWizardEvidenceType,
  text: string,
  actions: readonly string[],
) {
  const observable = uniqueNonempty(actions).filter(isPromptWizardObservableAction);
  if (observable.length > 0) return observable;
  return deriveProofActions(type, text).filter(isPromptWizardObservableAction);
}

function uniqueNonempty(values: readonly string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}
