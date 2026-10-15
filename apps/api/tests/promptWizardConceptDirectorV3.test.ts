import { describe, expect, it } from 'vitest';
import type {
  PromptWizardConceptPreview,
  PromptWizardCreativeBrief,
  PromptWizardProductProfile,
  PromptWizardProductionBrief,
} from '@lindyson/api-contracts';
import {
  assertPromptWizardConceptExpansion,
  conceptPreviewToAssignment,
  countPromptWizardConceptDifferences,
  promptWizardConceptPreviewBatchSchema,
  selectPromptWizardConceptPair,
  validatePromptWizardConceptSet,
} from '../src/domain/promptWizardConceptDirector.js';
import { buildPromptWizardEvidenceGraph } from '../src/domain/promptWizardEvidenceGraph.js';
import type { PromptWizardPlanDraft } from '../src/domain/promptWizardPrompt.js';

const IMAGE_ID = '00000000-0000-4000-8000-000000000031';
const PROFILE: PromptWizardProductProfile = {
  productName: 'MEXICO 运动短袖',
  category: '运动服饰',
  colors: '',
  materials: '针织面料',
  structure: '圆领、短袖、直筒版型和螺纹袖口',
  logo: '胸前有 MEXICO 印花，袖部有旗帜图案',
  usage: '套头穿着并整理领口与袖口',
  suggestedAudience: '球迷与休闲穿搭用户',
  suggestedScenarios: '观赛、聚会与日常穿搭',
  visibleFacts: [
    '胸前的 MEXICO 印花位置清晰可见',
    '圆领与袖口采用螺纹结构',
    '背面有大型鹰图案',
  ],
  needsConfirmation: ['具体面料成分需要确认'],
  userConfirmedClaims: '',
  consistencyConstraints: '保持 MEXICO 字样和鹰图案位置不变',
};
const BRIEF: PromptWizardCreativeBrief = {
  targetLanguage: '英语',
  direction: 'ugc',
  marketingGoal: 'conversion',
  creativeIntensity: 'balanced',
  confirmedOffer: '',
};
const PRODUCTION_BRIEF: PromptWizardProductionBrief = {
  primaryPurchaseReason: '醒目的双面文化印花',
  appearanceMode: 'person',
  availableScenes: ['卧室', '阳台', '衣帽间', '客厅', '玄关', '工作室', '户外', '观赛区'],
  availableAssets: ['产品参考图片', '真人素材', '普通道具'],
};
const GRAPH = buildPromptWizardEvidenceGraph({
  profile: PROFILE,
  imageAssetIds: [IMAGE_ID],
  detectedEvidenceSources: [
    'productName', 'category', 'materials', 'structure', 'logo', 'usage',
    'visibleFacts[0]', 'visibleFacts[1]', 'visibleFacts[2]',
  ].map(fieldPath => ({
    fieldPath,
    imageAssetIds: [IMAGE_ID],
    visibleRegion: '图片中的产品主体',
    confidence: 'high' as const,
    proofActions: ['用手转动并稳定展示对应产品细节'],
  })),
});

const EVENTS = [
  '手从衣架上取下这件 MEXICO T恤并翻到胸前印花',
  '人物拉开衣柜后把短袖贴到镜前快速比对',
  '双手展开衣服让背面鹰图案突然进入画面',
  '人物套头穿上 T恤并立即整理红色袖口',
  '手指从黑场拨开衣料揭出 MEXICO 印花',
  '人物推开门走入阳台并转身展示背面图案',
  '镜头快速拉近衣服圆领，手指随即压住螺纹边缘',
  '人物从观赛包里拿出短袖并在镜头前展开',
] as const;
const SCENES = ['卧室', '阳台', '衣帽间', '客厅', '玄关', '工作室', '户外', '观赛区'] as const;
const EVIDENCE_IDS = [
  'visible:1', 'profile:structure', 'visible:3', 'profile:usage',
  'profile:logo', 'visible:2', 'profile:materials', 'visible:1',
] as const;
const PURCHASE_REASONS = [
  '胸前文化印花带来清楚辨识度',
  '圆领和螺纹袖口结构清楚可见',
  '背面大型鹰图案形成正反细节反差',
  '套头穿着并整理领口袖口的正确用法',
  '胸前 MEXICO 印花保持原有位置',
  '圆领与袖口螺纹结构能够近景核对',
  '针织面料的可见纹理',
  '胸前印花位置能够稳定核对',
] as const;
const PRODUCT_ACTIONS = [
  '人物穿上衣服后用手指向胸前印花',
  '人物拉平圆领并整理螺纹袖口',
  '人物转动衣服并用手展开背面图案',
  '人物套头穿上衣服并依次整理领口和袖口',
  '人物拿起衣服并展示胸前 MEXICO 印花位置',
  '人物用手压住圆领并转动袖口展示螺纹结构',
  '人物用手展开衣料并推近展示针织纹理',
  '人物拿起衣服并把胸前印花转到镜头正中',
] as const;
const VISIBLE_RESULTS = [
  '胸前文化印花完整进入画面并清楚可见',
  '圆领和螺纹袖口结构在自然光下清楚可见',
  '背面大型鹰图案完整进入画面',
  '衣服完成套头穿着且领口袖口保持正确位置',
  '胸前 MEXICO 印花在原有位置清楚可见',
  '圆领与袖口的螺纹结构同时进入特写画面',
  '针织面料纹理在近景光线下清楚呈现',
  '胸前印花位置稳定留在镜头正中',
] as const;

function concepts(): PromptWizardConceptPreview[] {
  return Array.from({ length: 8 }, (_, index): PromptWizardConceptPreview => ({
    id: `00000000-0000-4000-8000-${String(index + 101).padStart(12, '0')}`,
    role: index < 4 ? 'reliable-conversion' : 'creative-breakthrough',
    title: `产品专属创意路线 ${index + 1}`,
    firstSecondEvent: EVENTS[index]!,
    viewerQuestion: index < 4
      ? '这件衣服的辨识度来自哪里？'
      : '转身之后还会出现什么细节？',
    purchaseReason: PURCHASE_REASONS[index]!,
    tension: index < 4
      ? `观众需要判断${PURCHASE_REASONS[index]}是否适合观赛穿搭`
      : `观众还没看到${PURCHASE_REASONS[index]}对应的完整状态`,
    productAction: PRODUCT_ACTIONS[index]!,
    visibleResult: VISIBLE_RESULTS[index]!,
    evidenceIds: [EVIDENCE_IDS[index]!],
    scene: SCENES[index]!,
    perspective: index < 4 ? '朋友视角的手机跟拍' : '第一视角快速发现',
    cameraGrammar: index < 4 ? '中景跟拍后推近产品细节' : '快速摇移后定格背面图案',
    ctaCallback: index < 4
      ? '如果你也想让观赛穿搭更有辨识度，可以再看看这些细节。'
      : '现在看到背面的答案了，你会选正面还是背面？',
    requiredAssets: ['产品参考图片', '真人素材'],
    difficulty: index < 4 ? 'low' : 'medium',
    risk: index < 4 ? 'low' : 'medium',
    direction: 'ugc',
    strategy: {
      hookType: index < 4 ? '真实动作' : '细节揭晓',
      narrativeArc: index < 4 ? '需求到自证' : '悬念到反转',
      sceneFamily: SCENES[index]!,
      cameraGrammar: index < 4 ? '手机跟拍' : '第一视角',
      pacing: index < 4 ? '均匀三拍' : '前紧后松',
      proofMechanism: index < 4 ? '穿戴动作闭环' : '双面图案揭晓',
      ctaStyle: index < 4 ? '场景邀请' : '问题回扣',
    },
    productionLoad: {
      locationCount: 1,
      personCount: 1,
      majorActionCount: index < 4 ? 2 : 3,
      propCount: 1,
      cameraMoveCount: 2,
      hasMagicTransition: false,
    },
    rank: index + 1,
  }));
}

function validate(
  candidateConcepts: unknown,
  historicalConcepts: readonly PromptWizardConceptPreview[] = [],
) {
  return validatePromptWizardConceptSet({
    concepts: candidateConcepts,
    evidenceGraph: GRAPH,
    brief: BRIEF,
    config: { model: 'seedance-2.0', durationSeconds: 15 },
    productionBrief: PRODUCTION_BRIEF,
    historicalConcepts,
  });
}

function expandedDraft(concept: PromptWizardConceptPreview): PromptWizardPlanDraft {
  const evidence = GRAPH.evidences.find(item => item.id === concept.evidenceIds[0])!;
  return {
    name: '观赛穿搭真实细节路线',
    hook: concept.firstSecondEvent,
    narrative: `${concept.purchaseReason}；${concept.visibleResult}；${concept.ctaCallback}`,
    primaryScene: `${concept.scene}，围绕${concept.purchaseReason}展开`,
    cameraAndPacing: concept.cameraGrammar,
    differenceTags: ['真实动作', '细节自证'],
    planningReview: {
      targetAudience: '观赛穿搭用户',
      surfaceNeed: concept.purchaseReason,
      realPainPoint: concept.tension,
      nonAdEntry: concept.firstSecondEvent,
      proofPoints: [evidence.text],
      directionFit: `用${concept.productAction}验证${concept.purchaseReason}`,
    },
    segments: [
      {
        role: 'hook',
        location: concept.scene,
        subject: '人物与参考图对应产品',
        shotSize: '中近景',
        action: concept.firstSecondEvent,
        cameraMovement: '手持跟随',
        lightingAndRealism: '自然光真实记录',
        voiceover: 'Look at this.',
        voiceoverZh: '看看这个。',
        foley: '衣物摩擦声',
        editingCue: '动作点切入',
        evidenceRefs: [],
        productionNote: '',
      },
      {
        role: 'proof',
        location: concept.scene,
        subject: '参考图对应产品',
        shotSize: '产品特写',
        action: concept.productAction,
        cameraMovement: '稳定推近',
        lightingAndRealism: '自然光保留真实纹理',
        voiceover: 'Here is the detail.',
        voiceoverZh: '细节就在这里。',
        foley: '布料轻响',
        editingCue: '证据出现后停留',
        evidenceRefs: [evidence.id],
        productionNote: '',
      },
      {
        role: 'resolution',
        location: concept.scene,
        subject: '参考图对应产品',
        shotSize: '中景',
        action: concept.visibleResult,
        cameraMovement: '固定机位',
        lightingAndRealism: '自然光真实呈现',
        voiceover: 'Now the result is clear.',
        voiceoverZh: '现在结果很清楚。',
        foley: '自然环境声',
        editingCue: '保持连续',
        evidenceRefs: [evidence.id],
        productionNote: '',
      },
      {
        role: 'cta',
        location: concept.scene,
        subject: '人物与参考图对应产品',
        shotSize: '中近景',
        action: concept.ctaCallback,
        cameraMovement: '固定机位',
        lightingAndRealism: '真实自然光',
        voiceover: 'Would this fit your game day?',
        voiceoverZh: '它适合你的观赛日吗？',
        foley: '自然环境声',
        editingCue: '自然收束',
        evidenceRefs: [],
        productionNote: concept.ctaCallback,
      },
    ],
    productionWarnings: [],
  };
}

describe('Prompt Wizard 3.0 八条创意路线门禁', () => {
  it('严格解析四条可信转化型和四条创意突破型路线', () => {
    const candidates = concepts();
    expect(promptWizardConceptPreviewBatchSchema.parse(candidates)).toEqual(candidates);
    expect(validate(candidates)).toEqual({ valid: true, concepts: candidates, issues: [] });
  });

  it.each([
    ['角色失衡', (items: PromptWizardConceptPreview[]) => { items[4]!.role = 'reliable-conversion'; }, 'ROLE_BALANCE_INVALID'],
    ['索引重复', (items: PromptWizardConceptPreview[]) => { items[1]!.rank = 1; }, 'DUPLICATE_RANK'],
    ['方向漂移', (items: PromptWizardConceptPreview[]) => { items[2]!.direction = 'lifestyle'; }, 'DIRECTION_MISMATCH'],
    ['开场无物理动作', (items: PromptWizardConceptPreview[]) => { items[0]!.firstSecondEvent = '这是一件很好看的衣服'; }, 'FIRST_SECOND_EVENT_NOT_PHYSICAL'],
    ['引用待确认事实', (items: PromptWizardConceptPreview[]) => { items[0]!.evidenceIds = ['needs-confirmation:1']; }, 'EVIDENCE_INVALID'],
    ['说明字段扩散为外语', (items: PromptWizardConceptPreview[]) => { items[0]!.title = 'A surprising product reveal in the bedroom'; }, 'CONTENT_LANGUAGE_INVALID'],
    ['写入未经确认的功效数字', (items: PromptWizardConceptPreview[]) => { items[0]!.purchaseReason = '具备 40dB 主动降噪效果'; }, 'UNCONFIRMED_CLAIM'],
    ['安排危险测试', (items: PromptWizardConceptPreview[]) => { items[0]!.productAction = '用明火燃烧产品并展示结果'; }, 'UNSAFE_CONTENT'],
    ['通用 CTA', (items: PromptWizardConceptPreview[]) => { items[0]!.ctaCallback = '立即购买'; }, 'CTA_NOT_CALLBACK'],
    ['超出执行预算', (items: PromptWizardConceptPreview[]) => { items[0]!.productionLoad.majorActionCount = 5; }, 'EXECUTION_BUDGET_EXCEEDED'],
  ] as const)('%s 会给出稳定错误码和字段路径', (_label, mutate, expectedCode) => {
    const candidates = concepts();
    mutate(candidates);
    const result = validate(candidates);
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toContain(expectedCode);
    expect(result.issues.every(issue => issue.fieldPath.length > 0)).toBe(true);
  });

  it('数量不是八条时在 Schema 层失败，不进入内容判断', () => {
    const result = validate(concepts().slice(0, 7));
    expect(result).toMatchObject({ valid: false, concepts: [] });
    expect(result.issues[0]?.code).toBe('CONCEPT_COUNT_INVALID');
  });

  it('批内只换标题和标签、核心语义相同的路线会被本地拒绝', () => {
    const candidates = concepts();
    candidates[1] = {
      ...candidates[1]!,
      firstSecondEvent: candidates[0]!.firstSecondEvent,
      tension: candidates[0]!.tension,
      evidenceIds: [...candidates[0]!.evidenceIds],
      scene: candidates[0]!.scene,
      perspective: candidates[0]!.perspective,
      ctaCallback: candidates[0]!.ctaCallback,
    };
    const result = validate(candidates);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DUPLICATE_CONCEPT', fieldPath: 'concepts.1' }),
    ]));
  });

  it('与当前 run 历史路线语义重复时拒绝，但不读取跨 run 指纹', () => {
    const candidates = concepts();
    const historical = [{
      ...candidates[0]!,
      id: '00000000-0000-4000-8000-000000000901',
    }];
    const result = validate(candidates, historical);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'HISTORICAL_CONCEPT_DUPLICATE',
        fieldPath: 'concepts.0',
      }),
    ]));
    expect(validate(candidates).issues.some(issue => (
      issue.code === 'HISTORICAL_CONCEPT_DUPLICATE'
    ))).toBe(false);
  });

  it('购买理由必须由所选证据语义支持且只保留一个理由', () => {
    const unsupported = concepts();
    unsupported[0]!.purchaseReason = '便携收纳让通勤更轻松';
    expect(validate(unsupported).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PURCHASE_REASON_EVIDENCE_UNSUPPORTED' }),
    ]));

    const stacked = concepts();
    stacked[0]!.purchaseReason = '胸前文化印花清楚可见，并且针织纹理细腻';
    expect(validate(stacked).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PURCHASE_REASON_MULTIPLE' }),
    ]));
  });

  it('痛点、产品动作与可见结果不能拼接成互不相关的三段话', () => {
    const candidates = concepts();
    candidates[0]!.productAction = '人物拿起水杯并擦拭桌面';
    candidates[0]!.visibleResult = '窗外灯光亮起并进入画面';
    expect(validate(candidates).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CAUSAL_CHAIN_INVALID' }),
    ]));
  });
});

describe('Prompt Wizard 3.0 默认互补方案选择', () => {
  it('默认选择排名最高的可信转化路线和至少四维不同的创意突破路线', () => {
    const candidates = concepts();
    const selected = selectPromptWizardConceptPair(candidates);
    expect(selected.primary.id).toBe(candidates[0]!.id);
    expect(selected.secondary.id).toBe(candidates[4]!.id);
    expect(selected.complementaryDimensions).toBeGreaterThanOrEqual(4);
    expect(countPromptWizardConceptDifferences(selected.primary, selected.secondary)).toBe(
      selected.complementaryDimensions,
    );
  });

  it('只有标签不同但五个核心维度相同的两条路线不会被当成互补方案', () => {
    const [primary, , , , secondary] = concepts();
    const cosmeticVariant: PromptWizardConceptPreview = {
      ...secondary!,
      firstSecondEvent: primary!.firstSecondEvent,
      tension: primary!.tension,
      evidenceIds: [...primary!.evidenceIds],
      scene: primary!.scene,
      perspective: primary!.perspective,
      ctaCallback: primary!.ctaCallback,
    };
    expect(countPromptWizardConceptDifferences(primary!, cosmeticVariant)).toBe(0);
    expect(() => selectPromptWizardConceptPair([primary!, cosmeticVariant])).toThrowError(
      expect.objectContaining({ code: 'PROMPT_WIZARD_CONCEPT_SET_INVALID' }),
    );
  });

  it('适配旧 Provider 时不运行旧 24 候选分数门槛，并完整保留创意证据', () => {
    const preview = concepts()[0]!;
    const assignment = conceptPreviewToAssignment(preview, 0);
    expect(assignment).toMatchObject({
      planIndex: 0,
      candidateId: preview.id,
      openingAction: preview.firstSecondEvent,
      proofAction: preview.productAction,
      evidenceIds: preview.evidenceIds,
      score: { total: 0 },
      conservative: false,
    });
    expect(assignment.providerContext).toMatchObject({
      opening: preview.firstSecondEvent,
      proof: preview.productAction,
      cta: preview.ctaCallback,
    });
  });
});

describe('Prompt Wizard 3.0 入选路线扩写防漂移', () => {
  it('忠实保留第一秒事件、购买理由、主证据、可见结果和 CTA 回扣时通过', () => {
    const concept = concepts()[0]!;
    expect(() => assertPromptWizardConceptExpansion({
      draft: expandedDraft(concept),
      concept,
      evidenceGraph: GRAPH,
    })).not.toThrow();
  });

  it.each([
    ['第一秒事件', (draft: PromptWizardPlanDraft) => { draft.segments[0]!.action = '人物站在房间里微笑'; }, 'segments[0].action'],
    ['购买理由', (draft: PromptWizardPlanDraft) => {
      draft.narrative = '记录一个普通下午';
      draft.primaryScene = '安静房间';
      draft.planningReview.surfaceNeed = '记录生活';
      draft.planningReview.realPainPoint = '不知道今天吃什么';
      draft.planningReview.directionFit = '自然记录';
    }, 'narrative'],
    ['主证据引用', (draft: PromptWizardPlanDraft) => {
      draft.segments.forEach(segment => { segment.evidenceRefs = []; });
    }, 'segments'],
    ['可见结果', (draft: PromptWizardPlanDraft) => {
      draft.narrative = '人物在窗边休息';
      draft.segments[2]!.action = '人物转身看向窗外';
    }, 'narrative'],
    ['CTA 回扣', (draft: PromptWizardPlanDraft) => {
      draft.narrative = '记录日常使用过程';
      draft.segments[3]!.action = '立即购买';
      draft.segments[3]!.productionNote = '';
    }, 'segments[3].action'],
  ] as const)('%s 漂移会被本地门禁拒绝', (_label, mutate, fieldPath) => {
    const concept = concepts()[0]!;
    const draft = expandedDraft(concept);
    mutate(draft);
    expect(() => assertPromptWizardConceptExpansion({
      draft,
      concept,
      evidenceGraph: GRAPH,
    })).toThrowError(expect.objectContaining({
      code: 'PROMPT_WIZARD_CONCEPT_DRIFT',
      fieldPaths: expect.arrayContaining([fieldPath]),
    }));
  });
});
