import { describe, expect, it, vi } from 'vitest';
import type {
  PromptWizardCreativeBrief,
  PromptWizardEvidenceGraph,
  PromptWizardProductProfile,
  PromptWizardUseDirection,
  PromptWizardUseDirectionPlanContext,
  PromptWizardVideoConfig,
} from '@lindyson/api-contracts';
import {
  assertPromptWizardUseDirections,
  orderPromptWizardUseDirectionsForDefaultSelection,
  promptWizardUseDirectionNeedsInput,
  PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION,
  validatePromptWizardUseDirectionSelection,
  validatePromptWizardUseDirections,
} from '../src/domain/promptWizardUseDirections.js';
import {
  ArkPromptWizardProvider,
  buildPromptWizardUseDirectionDraftInput,
  buildPromptWizardUseDirectionInput,
  createPromptWizardDraftWireV2JsonSchema,
  FakePromptWizardProvider,
  PROMPT_WIZARD_USE_DIRECTION_MAX_OUTPUT_TOKENS,
} from '../src/providers/promptWizardProvider.js';

const ASSET_ID = '00000000-0000-4000-8000-000000000701';

const VIDEO_CONFIG: PromptWizardVideoConfig = {
  model: 'seedance-2.0',
  aspectRatio: '9:16',
  resolution: '720p',
  durationSeconds: 15,
};

type VoiceoverRepairRequest = { input: string };

const PROFILE: PromptWizardProductProfile = {
  productName: '大力神杯造型玻璃杯',
  category: '玻璃饮品杯',
  colors: '',
  materials: '透明玻璃材质',
  structure: '上部为敞口杯体，中部为浮雕握柄，下部为圆形底座',
  logo: '',
  usage: '向杯内倒入饮品后手持饮用',
  suggestedAudience: '建议喜欢观赛和朋友聚会的用户',
  suggestedScenarios: '建议用于观赛、聚会和日常饮用',
  visibleFacts: ['杯身呈大力神杯浮雕轮廓'],
  needsConfirmation: ['实际容量需要用户确认'],
  userConfirmedClaims: '',
  consistencyConstraints: '保持透明玻璃材质和大力神杯造型结构一致',
};

const GRAPH: PromptWizardEvidenceGraph = {
  version: 1,
  productFamily: 'home-living',
  evidences: [
    {
      id: 'visible:shape',
      type: 'structure',
      text: '杯身呈大力神杯浮雕轮廓',
      sourceImageAssetIds: [ASSET_ID],
      visibleRegion: '图片中央杯身',
      status: 'visible',
      confidence: 'high',
      proofActions: ['手拿起玻璃杯并缓慢旋转，展示大力神杯浮雕轮廓'],
    },
    {
      id: 'visible:usage',
      type: 'usage',
      text: '杯体可以盛装饮品',
      sourceImageAssetIds: [ASSET_ID],
      visibleRegion: '图片上部杯体',
      status: 'visible',
      confidence: 'high',
      proofActions: ['手把饮品倒入杯中，展示液体进入透明杯体'],
    },
    {
      id: 'forbidden:capacity',
      type: 'commercial-claim',
      text: '容量为五百毫升',
      sourceImageAssetIds: [],
      visibleRegion: '待用户确认',
      status: 'forbidden-assumption',
      confidence: 'unknown',
      proofActions: [],
    },
  ],
  reliableEvidenceIds: ['visible:shape', 'visible:usage'],
  pendingEvidenceIds: [],
  forbiddenAssumptionIds: ['forbidden:capacity'],
  directionAssessments: directionAssessments(),
};

function directionAssessments(): PromptWizardEvidenceGraph['directionAssessments'] {
  return [
    'ugc', 'problem-solution', 'unboxing-review', 'feature-test',
    'pain-comparison', 'lifestyle', 'cinematic-brand', 'asmr-detail',
  ].map(direction => ({
    direction: direction as PromptWizardEvidenceGraph['directionAssessments'][number]['direction'],
    availability: 'available' as const,
    reason: '测试可用',
    missingRequirements: [],
  }));
}

function makeDirection(
  ordinal: number,
  overrides: Partial<PromptWizardUseDirection> = {},
): PromptWizardUseDirection {
  const shapeDirection = ordinal === 1;
  const scenes = [
    {
      id: `00000000-0000-4000-8000-0000000007${ordinal}1`,
      title: shapeDirection ? '观赛开场' : '朋友聚会',
      environment: shapeDirection ? '电视前的观赛桌面' : '朋友围坐的聚会餐桌',
      mainAction: shapeDirection
        ? '手举起玻璃杯并转动杯身展示奖杯轮廓'
        : '手把饮品倒入玻璃杯并举起碰杯',
    },
    {
      id: `00000000-0000-4000-8000-0000000007${ordinal}2`,
      title: shapeDirection ? '收藏展示' : '日常饮用',
      environment: shapeDirection ? '自然光下的展示台' : '自然光下的餐桌',
      mainAction: shapeDirection
        ? '手拿起杯子缓慢旋转并放回底座'
        : '手倒入饮品后拿起杯子直接饮用',
    },
  ];
  return {
    id: `00000000-0000-4000-8000-00000000070${ordinal}`,
    title: shapeDirection ? '观赛奖杯仪式' : '聚会倒酒互动',
    useMoment: shapeDirection ? '比赛开始前举杯进入观赛状态' : '朋友聚会开始时倒入饮品并碰杯',
    audienceNeed: shapeDirection ? '希望观赛用品具有清楚的球迷视觉记忆' : '希望聚会饮品有自然的互动动作',
    purchaseReason: shapeDirection ? '杯身呈大力神杯浮雕轮廓' : '杯体可以盛装饮品',
    proofAction: shapeDirection
      ? '手拿起玻璃杯并缓慢旋转，展示大力神杯浮雕轮廓'
      : '手把饮品倒入杯中，展示液体进入透明杯体',
    evidenceIds: [shapeDirection ? 'visible:shape' : 'visible:usage'],
    sceneOptions: scenes,
    recommendedSceneId: scenes[0]!.id,
    appearanceMode: 'hands-only',
    internalDirection: shapeDirection ? 'cinematic-brand' : 'lifestyle',
    requiredAssets: ['产品参考图片', '手部素材', shapeDirection ? '观赛桌面' : '饮品'],
    ...overrides,
  };
}

function toWire(direction: PromptWizardUseDirection) {
  const {
    id: _id,
    recommendedSceneId,
    sceneOptions,
    internalDirection: _internalDirection,
    purchaseReason: _purchaseReason,
    proofAction: _proofAction,
    ...rest
  } = direction;
  return {
    ...rest,
    sceneOptions: sceneOptions.map(({
      id: _sceneId,
      mainAction: _mainAction,
      ...scene
    }) => scene),
    recommendedSceneIndex: sceneOptions.findIndex(scene => scene.id === recommendedSceneId),
  };
}

function generationContext() {
  return {
    profile: PROFILE,
    evidenceGraph: GRAPH,
    historicalDirections: [],
  };
}

function draftContext() {
  const direction = makeDirection(1);
  const { sceneOptions: _sceneOptions, recommendedSceneId: _recommendedSceneId, ...snapshot } = direction;
  const scene = direction.sceneOptions[0]!;
  const selectedScene = {
    id: scene.id,
    title: scene.title,
    environment: scene.environment,
    mainAction: scene.mainAction,
  };
  const planContexts: PromptWizardUseDirectionPlanContext[] = [
    { planIndex: 0, variant: 'reliable', useDirection: snapshot, selectedScene },
    { planIndex: 1, variant: 'hook', useDirection: snapshot, selectedScene },
  ];
  return {
    profile: PROFILE,
    evidenceGraph: GRAPH,
    targetLanguage: '英语',
    config: VIDEO_CONFIG,
    planContexts,
    imageCount: 1,
    variationKey: 1,
  };
}

function v6SinglePlanDraftContext() {
  const base = draftContext();
  return {
    ...base,
    planContexts: [{
      ...base.planContexts[0]!,
      routeRole: 'proof-conversion' as const,
      lockedHookZh: '先看真实动作再判断这个商品是否适合你。',
    }],
  };
}


function draftWire(planIndex: 0 | 1) {
  const reliable = planIndex === 0;
  return {
    name: reliable ? '观赛奖杯仪式易落地版' : '第一秒奖杯揭晓版',
    hook: reliable ? '比赛开始前直接举杯进入观赛状态' : '第一秒旋转杯身揭晓奖杯轮廓',
    narrative: '围绕奖杯浮雕轮廓完成一次真实旋转展示，并回扣观赛仪式感',
    primaryScene: '电视前的观赛桌面',
    cameraAndPacing: reliable ? '稳定跟随动作并自然剪切' : '快速推近后停留产品细节',
    differenceTags: reliable ? ['稳定跟随', '完整动作'] : ['第一秒揭晓', '快速推近'],
    planningReview: {
      targetAudience: '喜欢观赛仪式感的用户',
      surfaceNeed: '希望观赛用品有清楚的视觉记忆',
      realPainPoint: '普通饮品杯缺少观赛场景辨识度',
      nonAdEntry: reliable ? '从举杯动作直接切入' : '从旋转揭晓动作切入',
      directionFit: '动作能够直接展示奖杯造型证据',
    },
    segments: ['hook', 'proof', 'resolution', 'cta'].map((role, index) => ({
      role,
      location: '电视前的观赛桌面',
      subject: '@图片1 对应玻璃饮品杯与操作手部',
      shotSize: index === 0 ? '中近景' : '产品特写',
      action: index === 0
        ? (reliable
          ? '手举起玻璃杯并转动杯身展示奖杯轮廓'
          : '第一秒手拿起玻璃杯快速旋转，揭晓奖杯轮廓')
        : index === 1
          ? '手缓慢旋转杯身，保持浮雕轮廓清楚可见'
          : index === 2
            ? '手把玻璃杯放回观赛桌面并再次举起'
            : '手保持举杯状态并自然收束动作',
      cameraMovement: reliable ? '稳定跟随手部动作' : '快速推近后稳定停留',
      lightingAndRealism: '自然室内光和真实观赛环境质感',
      voiceover: ['Game starts now.', 'Look at this trophy shape.', 'Make the moment count.', 'Ready for the match?'][index],
      voiceoverZh: ['比赛现在开始', '看看这个奖杯造型', '让这一刻更有仪式感', '准备好看比赛了吗'][index],
      foley: '保留玻璃杯与桌面接触的真实轻响',
      editingCue: reliable ? '在动作完成点自然剪切' : '开场快切后在证据处停顿',
      productionNote: '生成后核对玻璃材质和奖杯轮廓',
    })),
    productionWarnings: ['透明玻璃边缘需检查生成稳定性'],
  };
}

describe('产品使用方向领域门禁', () => {
  it('默认先选证据更充分且拍摄负担更低的方向', () => {
    const personDirection = makeDirection(1, {
      appearanceMode: 'person',
      internalDirection: 'cinematic-brand',
      requiredAssets: ['产品参考图片', '真人演员', '观赛桌面', '额外道具'],
    });
    const handsDirection = makeDirection(2, {
      evidenceIds: ['visible:usage', 'visible:shape'],
      purchaseReason: '杯体可以盛装饮品，杯身呈大力神杯浮雕轮廓',
    });
    expect(orderPromptWizardUseDirectionsForDefaultSelection([
      personDirection,
      handsDirection,
    ])[0]?.id).toBe(handsDirection.id);
  });

  it('交付两个产品专属方向并验证预设与自定义场景', () => {
    const directions = assertPromptWizardUseDirections({
      directions: [makeDirection(1), makeDirection(2)],
      evidenceGraph: GRAPH,
    });
    expect(directions).toHaveLength(2);
    expect(validatePromptWizardUseDirectionSelection({
      direction: directions[0]!,
      selectedSceneId: directions[0]!.recommendedSceneId,
    })).toMatchObject({ title: '观赛开场' });
    expect(validatePromptWizardUseDirectionSelection({
      direction: directions[0]!,
      customScene: {
        title: '自定义客厅',
        environment: '自然光客厅桌面',
        mainAction: '手拿起玻璃杯并旋转展示浮雕轮廓',
      },
    })).toMatchObject({ id: null, title: '自定义客厅' });
  });

  it('拒绝方向外的预设场景和缺少素材或主动作无关的自定义场景', () => {
    const direction = makeDirection(1);
    expect(() => validatePromptWizardUseDirectionSelection({
      direction,
      selectedSceneId: '00000000-0000-4000-8000-000000009999',
    })).toThrow(/场景/u);
    expect(() => validatePromptWizardUseDirectionSelection({
      direction,
      customScene: {
        title: '礼盒开箱',
        environment: '带封膜包装的拆箱桌面',
        mainAction: '手拆开包装盒后取出杯子',
      },
      evidenceGraph: GRAPH,
      userConfirmedClaims: '',
    })).toThrow(/主动作|包装/u);
    expect(() => validatePromptWizardUseDirectionSelection({
      direction,
      customScene: {
        title: '车内出行',
        environment: '行驶中的汽车驾驶室',
        mainAction: '手拿起汽车钥匙并插入点火孔启动汽车',
      },
      evidenceGraph: GRAPH,
      userConfirmedClaims: '',
    })).toThrow(/主动作|方向/u);
  });

  it('拒绝不可靠证据、无包装开箱和历史重复方向', () => {
    const invalid = makeDirection(1, {
      evidenceIds: ['forbidden:capacity'],
      purchaseReason: '容量为五百毫升',
      proofAction: '手拆开包装后展示容量标记',
      internalDirection: 'unboxing-review',
      requiredAssets: ['产品包装盒', '手部素材'],
    });
    const result = validatePromptWizardUseDirections({
      directions: [invalid, makeDirection(2)],
      evidenceGraph: GRAPH,
      historicalDirections: [invalid],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'EVIDENCE_INVALID',
      'PACKAGING_ASSET_UNAVAILABLE',
      'HISTORICAL_DIRECTION_DUPLICATE',
    ]));
  });

  it('单个通用词重合不能冒充购买理由或自证动作的直接证据', () => {
    const weaklyRelated = makeDirection(1, {
      purchaseReason: '玻璃外观看起来适合各种日常任务',
      proofAction: '手把玻璃制品放到桌面并停住',
      evidenceIds: ['visible:shape'],
    });
    const result = validatePromptWizardUseDirections({
      directions: [weaklyRelated, makeDirection(2)],
      evidenceGraph: GRAPH,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'PURCHASE_REASON_UNSUPPORTED',
      'PROOF_ACTION_UNSUPPORTED',
    ]));
  });

  it('使用方向复用图谱的可观察动作边界，允许 Logo 或印花的稳定特写', () => {
    const logoEvidence = {
      id: 'visible:logo',
      type: 'logo-print' as const,
      text: '胸前可见 MEXICO 印花',
      sourceImageAssetIds: [ASSET_ID],
      visibleRegion: '图片胸前印花区域',
      status: 'visible' as const,
      confidence: 'high' as const,
      proofActions: ['稳定特写保持 MEXICO 印花原样'],
    };
    const graph = {
      ...GRAPH,
      evidences: [logoEvidence, GRAPH.evidences[1]!, GRAPH.evidences[2]!],
      reliableEvidenceIds: [logoEvidence.id, 'visible:usage'],
    };
    const scenes = [{
      id: '00000000-0000-4000-8000-000000000741',
      title: '印花细节展示',
      environment: '自然光下的纯色背景',
      mainAction: '稳定特写保持 MEXICO 印花原样',
    }, {
      id: '00000000-0000-4000-8000-000000000742',
      title: '印花近景核对',
      environment: '柔和自然光下的展示台',
      mainAction: '近景对焦 MEXICO 印花并停留展示细节',
    }];
    const logoDirection = makeDirection(1, {
      title: '印花细节展示',
      useMoment: '挑选服饰时核对胸前印花细节',
      audienceNeed: '希望看清服饰上的可见印花设计',
      purchaseReason: '胸前可见 MEXICO 印花',
      proofAction: '稳定特写保持 MEXICO 印花原样',
      evidenceIds: [logoEvidence.id],
      sceneOptions: scenes,
      recommendedSceneId: scenes[0]!.id,
      appearanceMode: 'product-only',
      internalDirection: 'cinematic-brand',
      requiredAssets: ['产品参考图片', '纯色背景'],
    });
    const result = validatePromptWizardUseDirections({
      directions: [logoDirection, makeDirection(2)],
      evidenceGraph: graph,
    });
    expect(result.issues.map(issue => issue.code)).not.toEqual(expect.arrayContaining([
      'PROOF_ACTION_NOT_PHYSICAL',
      'SCENE_ACTION_NOT_PHYSICAL',
    ]));
    expect(result.valid).toBe(true);
  });

  it('产品名称和品类只是外观身份，不能单独充当购买理由', () => {
    const appearanceEvidence = {
      id: 'profile:productName',
      type: 'appearance' as const,
      text: '大力神杯造型玻璃杯',
      sourceImageAssetIds: [ASSET_ID],
      visibleRegion: '图片中央产品主体',
      status: 'visible' as const,
      confidence: 'high' as const,
      proofActions: ['手拿起产品并展示产品主体'],
    };
    const graph = {
      ...GRAPH,
      evidences: [appearanceEvidence, GRAPH.evidences[1]!],
      reliableEvidenceIds: [appearanceEvidence.id, 'visible:usage'],
      forbiddenAssumptionIds: [],
    };
    const invalid = makeDirection(1, {
      purchaseReason: appearanceEvidence.text,
      proofAction: appearanceEvidence.proofActions[0]!,
      evidenceIds: [appearanceEvidence.id],
    });
    const result = validatePromptWizardUseDirections({
      directions: [invalid, makeDirection(2)],
      evidenceGraph: graph,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'PURCHASE_REASON_UNSUPPORTED',
      'PROOF_ACTION_UNSUPPORTED',
    ]));
    expect(promptWizardUseDirectionNeedsInput({
      ...graph,
      evidences: [appearanceEvidence],
      reliableEvidenceIds: [appearanceEvidence.id],
    })).toBe(true);
  });

  it('一条强证据可以形成两个使用时刻，零条可拍证据时才追问一次', async () => {
    const oneEvidenceGraph = {
      ...GRAPH,
      evidences: [GRAPH.evidences[0]!],
      reliableEvidenceIds: ['visible:shape'],
      forbiddenAssumptionIds: [],
    };
    expect(promptWizardUseDirectionNeedsInput(oneEvidenceGraph)).toBe(false);
    const gatheringScenes = [{
      id: '00000000-0000-4000-8000-000000000731',
      title: '球迷收藏架陈列',
      environment: '自然光照亮的球迷收藏架',
      mainAction: '双手托住圆形底座，把玻璃杯放到收藏架中央并环绕展示浮雕轮廓',
    }, {
      id: '00000000-0000-4000-8000-000000000732',
      title: '书桌陈列角整理',
      environment: '摆有球迷纪念物的安静书桌一角',
      mainAction: '用软布擦过杯身后托住底座放稳，从侧面揭晓大力神杯轮廓',
    }];
    const directions = assertPromptWizardUseDirections({
      directions: [makeDirection(1), makeDirection(2, {
        title: '球迷收藏陈列',
        useMoment: '整理球迷收藏架时，把杯子放到纪念物旁形成陈列焦点',
        audienceNeed: '希望日常陈列也能保留清楚的球迷视觉记忆',
        purchaseReason: '杯身呈大力神杯浮雕轮廓',
        proofAction: '双手托住圆形底座，把玻璃杯缓慢放上收藏架并环绕展示大力神杯浮雕轮廓',
        evidenceIds: ['visible:shape'],
        sceneOptions: gatheringScenes,
        recommendedSceneId: gatheringScenes[0]!.id,
        internalDirection: 'lifestyle',
        requiredAssets: ['产品参考图片', '手部素材', '球迷收藏架'],
      })],
      evidenceGraph: oneEvidenceGraph,
    });
    expect(directions).toHaveLength(2);
    expect(directions.every(direction => (
      direction.evidenceIds.every(id => id === 'visible:shape')
    ))).toBe(true);
    const fakeOneEvidence = await new FakePromptWizardProvider().generateUseDirections({
      profile: PROFILE,
      evidenceGraph: oneEvidenceGraph,
      historicalDirections: [],
    });
    expect(fakeOneEvidence.directions).toHaveLength(2);
    expect(fakeOneEvidence.clarificationQuestion).toBeNull();

    const emptyGraph = {
      ...oneEvidenceGraph,
      evidences: [],
      reliableEvidenceIds: [],
    };
    expect(promptWizardUseDirectionNeedsInput(emptyGraph)).toBe(true);
    const result = await new FakePromptWizardProvider().generateUseDirections({
      profile: PROFILE,
      evidenceGraph: emptyGraph,
      historicalDirections: [],
    });
    expect(result.directions).toEqual([]);
    expect(result.clarificationQuestion).toBe(PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION);
    expect(result.usage.requestAttempts).toBe(1);
  });

  it('只改变自证动作不会被场景主动作重复计成两个差异维度', () => {
    const first = makeDirection(1);
    const secondScenes = first.sceneOptions.map((scene, index) => ({
      ...scene,
      id: `00000000-0000-4000-8000-00000000076${index + 1}`,
      mainAction: '手将玻璃杯转向另一侧并展示同一奖杯轮廓',
    }));
    const result = validatePromptWizardUseDirections({
      directions: [first, {
        ...first,
        id: '00000000-0000-4000-8000-000000000760',
        proofAction: '手将玻璃杯转向另一侧并展示大力神杯浮雕轮廓',
        sceneOptions: secondScenes,
        recommendedSceneId: secondScenes[0]!.id,
      }],
      evidenceGraph: GRAPH,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toContain('DUPLICATE_DIRECTION');
  });
});

type FlatScalarTestRequest = VoiceoverRepairRequest & {
  text?: { format?: { schema?: { required?: string[] } } };
};

function v2VoiceoverFixture(
  targetLanguage: string,
  segmentIndex: number,
  segmentCount: number,
) {
  const last = segmentIndex === segmentCount - 1;
  if (targetLanguage === '普通话') {
    if (segmentIndex === 0) return '玻璃饮品杯真实亮相。';
    if (last) return '点击商品卡立即下单。';
    if (segmentIndex === 1) return '可见奖杯轮廓证明杯身呈大力神杯浮雕轮廓。';
    return '真实观赛场景清楚呈现使用结果。';
  }
  if (targetLanguage === '日语') {
    if (segmentIndex === 0) return 'このガラス杯を見よう。';
    if (last) return '商品カードから今すぐ購入。';
    return segmentIndex === 1
      ? '見えるトロフィー形状が選ぶ理由を示します。'
      : '観戦の場面で実際の結果を確認できます。';
  }
  if (targetLanguage === '泰语') {
    if (segmentIndex === 0) return 'ดูแก้วสินค้านี้ใช้งานจริง';
    if (last) return 'กดการ์ดสินค้าแล้วซื้อเลย';
    return 'รูปทรงถ้วยรางวัลที่เห็นช่วยให้เลือกได้';
  }
  if (targetLanguage === '西班牙语') {
    if (segmentIndex === 0) return 'Mira este vaso de cristal.';
    if (last) return 'Abre la tarjeta y compra ahora.';
    return 'La forma visible demuestra por qué elegirlo.';
  }
  if (segmentIndex === 0) return 'See this glass cup now.';
  if (last) return 'Tap the product card and order now.';
  return segmentIndex === 1
    ? 'The visible trophy shape supports this choice.'
    : 'The result fits a real match setting.';
}

function v2VoiceoverZhFixture(segmentIndex: number, segmentCount: number) {
  if (segmentIndex === 0) return '现在看这款玻璃饮品杯。';
  if (segmentIndex === segmentCount - 1) return '点击商品卡立即下单。';
  if (segmentIndex === 1) return '可见奖杯轮廓证明杯身呈大力神杯浮雕轮廓。';
  return '真实观赛场景清楚呈现使用结果。';
}

function buildV2FlatScalarOutput(
  request: FlatScalarTestRequest,
  targetLanguage: string | null,
  mutate?: (output: Record<string, unknown>) => void,
) {
  const payload = JSON.parse(request.input) as {
    planIndex?: 0 | 1 | 2;
    requiredShotRoles: string[];
  };
  const required = request.text?.format?.schema?.required;
  if (!required) throw new Error('测试请求缺少 Flat Scalar required keys');
  const segmentCount = payload.requiredShotRoles.length;
  const wire = draftWire(payload.planIndex === 1 ? 1 : 0);
  const output: Record<string, unknown> = {};
  const shotFields: Record<string, keyof typeof wire.segments[number]> = {
    ShotSize: 'shotSize',
    Action: 'action',
    CameraMovement: 'cameraMovement',
    LightingAndRealism: 'lightingAndRealism',
    Foley: 'foley',
    EditingCue: 'editingCue',
  };
  for (const key of required) {
    if (key === 'hook') {
      output[key] = wire.hook;
      continue;
    }
    const shot = /^s(\d+)(ShotSize|Action|CameraMovement|LightingAndRealism|Foley|EditingCue)$/u
      .exec(key);
    if (shot) {
      output[key] = wire.segments[Number(shot[1])]![shotFields[shot[2]!]!];
      continue;
    }
    const voiceover = /^v(\d+)$/u.exec(key);
    if (voiceover && targetLanguage) {
      output[key] = v2VoiceoverFixture(targetLanguage, Number(voiceover[1]), segmentCount);
      continue;
    }
    const translation = /^z(\d+)$/u.exec(key);
    if (translation) {
      output[key] = v2VoiceoverZhFixture(Number(translation[1]), segmentCount);
    }
  }
  mutate?.(output);
  return output;
}

describe('V6 提示词向导 Flat Scalar V2', () => {
  it.each([
    { targetLanguage: null, durationSeconds: 5 as const, segmentCount: 2 },
    ...(['普通话', '英语', '西班牙语', '日语', '泰语'] as const).flatMap(
      targetLanguage => ([
        { targetLanguage, durationSeconds: 10 as const, segmentCount: 3 },
        { targetLanguage, durationSeconds: 15 as const, segmentCount: 4 },
      ]),
    ),
  ])('$targetLanguage $durationSeconds 秒只暴露逐镜完整句标量', ({
    targetLanguage,
    durationSeconds,
    segmentCount,
  }) => {
    const base = v6SinglePlanDraftContext();
    const context = durationSeconds === 5
      ? (() => {
          const { targetLanguage: _targetLanguage, ...withoutLanguage } = base;
          return {
            ...withoutLanguage,
            config: {
              ...VIDEO_CONFIG,
              model: 'seedance-2.0-mini' as const,
              durationSeconds,
              resolution: '480p' as const,
            },
          };
        })()
      : {
          ...base,
          targetLanguage: targetLanguage!,
          config: { ...VIDEO_CONFIG, durationSeconds },
        };
    const initial = createPromptWizardDraftWireV2JsonSchema(
      context,
      segmentCount as 2 | 3 | 4,
      false,
    );
    const recovery = createPromptWizardDraftWireV2JsonSchema(
      context,
      segmentCount as 2 | 3 | 4,
      true,
    );
    expect(initial.additionalProperties).toBe(false);
    expect(recovery.required).toEqual(initial.required.filter(key => key !== 'hook'));
    expect(initial.required.filter(key => /^v\d+$/u.test(key))).toHaveLength(
      targetLanguage ? segmentCount : 0,
    );
    expect(initial.required.filter(key => /^z\d+$/u.test(key))).toHaveLength(
      targetLanguage && targetLanguage !== '普通话' ? segmentCount : 0,
    );
    expect(initial.required.some(key => /^v\d\d{2}$/u.test(key))).toBe(false);
    expect(initial.required).not.toContain('voiceoverSlots');
    for (const key of initial.required.filter(key => /^(?:v|z)\d+$/u.test(key))) {
      expect((initial.properties as Record<string, unknown>)[key]).toMatchObject({
        type: 'string', minLength: 1, maxLength: 300,
      });
    }
  });

  it.each([
    ['普通话', 10],
    ['英语', 15],
    ['日语', 10],
  ] as const)('$targetLanguage $durationSeconds 秒首稿解码完整 vN/zN 句子', async (
    targetLanguage,
    durationSeconds,
  ) => {
    const context = {
      ...v6SinglePlanDraftContext(),
      targetLanguage,
      config: { ...VIDEO_CONFIG, durationSeconds },
    };
    const create = vi.fn().mockImplementation(async (request: FlatScalarTestRequest) => ({
      id: `v2-${targetLanguage}-${durationSeconds}`,
      model: 'doubao-seed-2-0-lite-260428',
      service_tier: 'default',
      output_text: JSON.stringify(buildV2FlatScalarOutput(request, targetLanguage)),
      usage: { input_tokens: 60, output_tokens: 40 },
    }));
    const result = await new ArkPromptWizardProvider({ create } as never)
      .generateUseDirectionDrafts(context);
    expect(result.drafts[0]!.segments).toHaveLength(durationSeconds === 10 ? 3 : 4);
    expect(result.drafts[0]!.segments.every(segment => segment.voiceover.length > 0)).toBe(true);
    expect(result.drafts[0]!.segments.every(segment => (
      targetLanguage === '普通话' ? segment.voiceoverZh === '' : segment.voiceoverZh.length > 0
    ))).toBe(true);
    const payload = JSON.parse(create.mock.calls[0]![0].input);
    expect(payload.outputWire.format).toBe('prompt-wizard-flat-scalars-v2');
    expect(payload).not.toHaveProperty('totalVoiceoverBudget');
    expect(payload).not.toHaveProperty('voiceoverBudget');
    expect(payload.voiceoverTiming).toEqual(durationSeconds === 10
      ? [
          { segmentIndex: 0, startSeconds: 0, endSeconds: 2, durationSeconds: 2 },
          { segmentIndex: 1, startSeconds: 2, endSeconds: 7, durationSeconds: 5 },
          { segmentIndex: 2, startSeconds: 7, endSeconds: 10, durationSeconds: 3 },
        ]
      : [
          { segmentIndex: 0, startSeconds: 0, endSeconds: 3, durationSeconds: 3 },
          { segmentIndex: 1, startSeconds: 3, endSeconds: 7, durationSeconds: 4 },
          { segmentIndex: 2, startSeconds: 7, endSeconds: 12, durationSeconds: 5 },
          { segmentIndex: 3, startSeconds: 12, endSeconds: 15, durationSeconds: 3 },
        ]);
    expect(JSON.stringify(payload)).not.toMatch(
      /(?:speechRateMultiplier|maxUnits|minUnits|targetUnits|exactWordCount|exactCharacterCount)/u,
    );
    expect(payload.outputWire.keyMap.find((item: { key: string }) => item.key === 'v0').rule)
      .toContain(durationSeconds === 10 ? '0-2s' : '0-3s');
  });

  it.each([
    '英语', '西班牙语', '葡萄牙语', '法语', '印尼语', '意大利语', '日语',
    '马来语', '泰语', '越南语', '普通话', '德语', '荷兰语', '波兰语',
  ] as PromptWizardCreativeBrief['targetLanguage'][])(
    '%s 的 V6 Provider 输入只携带分镜时间，不携带语言语速配置',
    targetLanguage => {
      const payload = JSON.parse(buildPromptWizardUseDirectionDraftInput({
        ...v6SinglePlanDraftContext(),
        targetLanguage,
        config: { ...VIDEO_CONFIG, durationSeconds: 10 },
      }, 0));
      expect(payload.voiceoverTiming).toEqual([
        { segmentIndex: 0, startSeconds: 0, endSeconds: 2, durationSeconds: 2 },
        { segmentIndex: 1, startSeconds: 2, endSeconds: 7, durationSeconds: 5 },
        { segmentIndex: 2, startSeconds: 7, endSeconds: 10, durationSeconds: 3 },
      ]);
      expect(payload).not.toHaveProperty('voiceoverBudget');
      expect(payload).not.toHaveProperty('totalVoiceoverBudget');
      expect(JSON.stringify(payload)).not.toMatch(
        /(?:speechRateMultiplier|maxUnits|minUnits|targetUnits|exactWordCount|exactCharacterCount)/u,
      );
    },
  );

  it('首稿非法 JSON 只使用一次 Recovery V2 恢复', async () => {
    const context = {
      ...v6SinglePlanDraftContext(),
      targetLanguage: '英语',
      config: { ...VIDEO_CONFIG, durationSeconds: 10 as const },
    };
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'v2-invalid', model: 'm', service_tier: 'default', output_text: '{',
        usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockImplementationOnce(async (request: FlatScalarTestRequest) => ({
        id: 'v2-recovered',
        model: 'm',
        service_tier: 'default',
        output_text: JSON.stringify(buildV2FlatScalarOutput(request, '英语')),
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    const result = await new ArkPromptWizardProvider({ create } as never)
      .generateUseDirectionDrafts(context);
    expect(result.formatRepairCount).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
    const recovery = create.mock.calls[1]![0] as FlatScalarTestRequest;
    const payload = JSON.parse(recovery.input);
    expect(payload.outputWire.format).toBe('prompt-wizard-flat-scalars-v2');
    expect(recovery.text?.format?.schema?.required).toEqual(expect.arrayContaining([
      'v0', 'z0', 'v1', 'z1', 'v2', 'z2',
    ]));
    expect(recovery.text?.format?.schema?.required?.some(key => /^v\d\d{2}$/u.test(key)))
      .toBe(false);
  });

  it('解码只做 trim 与 NFKC，并保留自然标点和品牌字母', async () => {
    const context = {
      ...v6SinglePlanDraftContext(),
      targetLanguage: '普通话',
      config: { ...VIDEO_CONFIG, durationSeconds: 10 as const },
    };
    const create = vi.fn().mockImplementation(async (request: FlatScalarTestRequest) => ({
      id: 'v2-normalized', model: 'm', service_tier: 'default',
      output_text: JSON.stringify(buildV2FlatScalarOutput(request, '普通话', output => {
        output.v0 = '  玻璃饮品杯Ａ款亮相。  ';
      })),
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const result = await new ArkPromptWizardProvider({ create } as never)
      .generateUseDirectionDrafts(context);
    expect(result.drafts[0]!.segments[0]!.voiceover).toBe('玻璃饮品杯A款亮相。');
  });

  it.each([
    ['控制字符', '玻璃饮品杯\u0001亮相。'],
    ['零宽字符', '玻璃饮品杯\u200b亮相。'],
    ['Emoji', '玻璃饮品杯亮相😀。'],
  ])('拒绝口播中的%s', async (_label, voiceover) => {
    const context = {
      ...v6SinglePlanDraftContext(),
      targetLanguage: '普通话',
      config: { ...VIDEO_CONFIG, durationSeconds: 10 as const },
    };
    const create = vi.fn().mockImplementation(async (request: FlatScalarTestRequest) => ({
      id: 'v2-rejected', model: 'm', service_tier: 'default',
      output_text: JSON.stringify(buildV2FlatScalarOutput(request, '普通话', output => {
        output.v0 = voiceover;
      })),
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    await expect(new ArkPromptWizardProvider({ create } as never)
      .generateUseDirectionDrafts(context)).rejects.toBeDefined();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['旧 vNPP', (output: Record<string, unknown>) => { output.v000 = '旧槽'; }],
    ['数组', (output: Record<string, unknown>) => { output.v0 = ['非法']; }],
    ['嵌套对象', (output: Record<string, unknown>) => { output.v0 = { text: '非法' }; }],
    ['普通话 zN', (output: Record<string, unknown>) => { output.z0 = '多余译文'; }],
  ])('拒绝%s与额外键', async (_label, mutate) => {
    const context = {
      ...v6SinglePlanDraftContext(),
      targetLanguage: '普通话',
      config: { ...VIDEO_CONFIG, durationSeconds: 10 as const },
    };
    const create = vi.fn().mockImplementation(async (request: FlatScalarTestRequest) => ({
      id: 'v2-shape-rejected', model: 'm', service_tier: 'default',
      output_text: JSON.stringify(buildV2FlatScalarOutput(request, '普通话', mutate)),
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    await expect(new ArkPromptWizardProvider({ create } as never)
      .generateUseDirectionDrafts(context)).rejects.toBeDefined();
  });

  it('口播修复按镜原子更新 vN/zN，其他镜头保持不变', async () => {
    const context = {
      ...v6SinglePlanDraftContext(),
      targetLanguage: '英语',
      config: { ...VIDEO_CONFIG, durationSeconds: 15 as const },
    };
    const previousDrafts = (await new FakePromptWizardProvider()
      .generateUseDirectionDrafts(context)).drafts;
    const snapshot = structuredClone(previousDrafts[0]!);
    const create = vi.fn().mockImplementation(async (request: FlatScalarTestRequest) => ({
      id: 'v2-atomic-repair', model: 'm', service_tier: 'default',
      output_text: JSON.stringify(buildV2FlatScalarOutput(request, '英语', output => {
        output.v1 = 'Visible trophy details support this choice.';
        output.z1 = '可见奖杯轮廓证明杯身呈大力神杯浮雕轮廓。';
      })),
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const result = await new ArkPromptWizardProvider({ create } as never)
      .repairUseDirectionDrafts({
        ...context,
        previousDrafts,
        issues: [{
          planIndex: 0,
          errorCode: 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID',
          fieldPaths: ['segments[1].voiceover'],
          action: '整镜重写完整自然口播句，并同步忠实中文译文',
        }],
      });
    const repaired = result.drafts[0]!.draft;
    expect(repaired.segments[1]!.voiceover).toBe('Visible trophy details support this choice.');
    expect(repaired.segments[1]!.voiceoverZh).toBe('可见奖杯轮廓证明杯身呈大力神杯浮雕轮廓。');
    expect(repaired.segments[0]).toEqual(snapshot.segments[0]);
    expect(repaired.segments.slice(2)).toEqual(snapshot.segments.slice(2));
    const payload = JSON.parse(create.mock.calls[0]![0].input);
    expect(payload.voiceoverTiming).toEqual([
      { segmentIndex: 0, startSeconds: 0, endSeconds: 3, durationSeconds: 3 },
      { segmentIndex: 1, startSeconds: 3, endSeconds: 7, durationSeconds: 4 },
      { segmentIndex: 2, startSeconds: 7, endSeconds: 12, durationSeconds: 5 },
      { segmentIndex: 3, startSeconds: 12, endSeconds: 15, durationSeconds: 3 },
    ]);
    expect(payload).not.toHaveProperty('voiceoverBudget');
  });

  it('V5 私有生成输入仍保留旧预算，V6 公共返回类型保持不变', () => {
    const legacy = JSON.parse(buildPromptWizardUseDirectionDraftInput(draftContext(), 0));
    expect(legacy.totalVoiceoverBudget).toMatchObject({
      unit: 'words', minUnits: expect.any(Number), targetUnits: expect.any(Number),
    });
    expect(legacy).not.toHaveProperty('outputWire.format', 'prompt-wizard-flat-scalars-v2');
  });
});

describe('产品使用方向方舟请求', () => {
  it('关闭思考、限制 2000 Token 和 60 秒，并且不发送图片', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'response-use-directions',
      model: 'doubao-seed-2-0-lite-260428',
      service_tier: 'default',
      output_text: JSON.stringify({
        directions: [toWire(makeDirection(1)), toWire(makeDirection(2))],
        clarificationQuestion: '',
      }),
      usage: { input_tokens: 80, output_tokens: 50 },
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const result = await provider.generateUseDirections(generationContext());

    expect(result.directions).toHaveLength(2);
    expect(result.repairRounds).toBe(0);
    expect(PROMPT_WIZARD_USE_DIRECTION_MAX_OUTPUT_TOKENS).toBe(2_000);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      max_output_tokens: 2_000,
      thinking: { type: 'disabled' },
      text: { format: { name: 'prompt_wizard_use_directions', strict: true } },
    });
    const request = create.mock.calls[0]?.[0];
    const directionProperties = request.text.format.schema.properties.directions
      .items.properties;
    expect(directionProperties).not.toHaveProperty('purchaseReason');
    expect(directionProperties).not.toHaveProperty('proofAction');
    expect(directionProperties).not.toHaveProperty('internalDirection');
    expect(directionProperties.sceneOptions.items.properties).not.toHaveProperty('mainAction');
    expect(request.instructions).toContain('purchaseReason、proofAction、sceneOptions.mainAction 与 internalDirection 由服务端');
    expect(create.mock.calls[0]?.[1]).toEqual({ timeoutMs: 60_000 });
    expect(JSON.stringify(create.mock.calls[0]?.[0])).not.toContain('input_image');
  });

  it('购买理由、自证动作、场景动作与内部拍法均由服务端确定性补全', async () => {
    const firstDirection = toWire(makeDirection(1));
    const secondDirection = toWire(makeDirection(2));
    const create = vi.fn().mockResolvedValue({
      id: 'response-use-directions-server-derived-fields',
      model: 'doubao-seed-2-0-lite-260428',
      service_tier: 'default',
      output_text: JSON.stringify({
        directions: [firstDirection, secondDirection],
        clarificationQuestion: '',
      }),
      usage: { input_tokens: 80, output_tokens: 50 },
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const result = await provider.generateUseDirections(generationContext());

    expect(create).toHaveBeenCalledOnce();
    expect(result.repairRounds).toBe(0);
    expect(result.directions.map(direction => direction.purchaseReason)).toEqual([
      makeDirection(1).purchaseReason,
      makeDirection(2).purchaseReason,
    ]);
    expect(result.directions.map(direction => direction.proofAction)).toEqual([
      makeDirection(1).proofAction,
      makeDirection(2).proofAction,
    ]);
    expect(result.directions.flatMap(direction => (
      direction.sceneOptions.map(scene => scene.mainAction)
    ))).toEqual([
      makeDirection(1).proofAction,
      makeDirection(1).proofAction,
      makeDirection(2).proofAction,
      makeDirection(2).proofAction,
    ]);
    expect(result.directions.map(direction => direction.internalDirection)).toEqual([
      'lifestyle',
      'lifestyle',
    ]);
  });

  it('严格 Schema 前只归一化等价的单值字符串包装', async () => {
    const firstDirection = toWire(makeDirection(1));
    const secondDirection = toWire(makeDirection(2));
    const create = vi.fn().mockResolvedValue({
      id: 'response-use-directions-single-value-wrapper',
      model: 'doubao-seed-2-0-lite-260428',
      service_tier: 'default',
      output_text: JSON.stringify({
        directions: [{
          ...firstDirection,
          title: [{ localized: { copy: firstDirection.title } }],
          sceneOptions: firstDirection.sceneOptions.map((scene, index) => (
            index === 0
              ? { ...scene, environment: [{ localized: scene.environment }] }
              : scene
          )),
        }, secondDirection],
        clarificationQuestion: [''],
      }),
      usage: { input_tokens: 80, output_tokens: 50 },
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const result = await provider.generateUseDirections(generationContext());

    expect(create).toHaveBeenCalledOnce();
    expect(result.repairRounds).toBe(0);
    expect(result.directions[0]?.title).toBe(firstDirection.title);
    expect(result.directions[0]?.sceneOptions[0]?.environment)
      .toBe(firstDirection.sceneOptions[0]?.environment);
  });

  it('已有两个合格场景时丢弃类型无效的第三个可选场景', async () => {
    const firstDirection = toWire(makeDirection(1));
    const secondDirection = toWire(makeDirection(2));
    const create = vi.fn().mockResolvedValue({
      id: 'response-use-directions-invalid-optional-third-scene',
      model: 'doubao-seed-2-0-lite-260428',
      service_tier: 'default',
      output_text: JSON.stringify({
        directions: [{
          ...firstDirection,
          sceneOptions: [
            ...firstDirection.sceneOptions,
            { title: null, environment: [] },
          ],
        }, secondDirection],
        clarificationQuestion: '',
      }),
      usage: { input_tokens: 80, output_tokens: 50 },
    });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const result = await provider.generateUseDirections(generationContext());

    expect(create).toHaveBeenCalledOnce();
    expect(result.repairRounds).toBe(0);
    expect(result.directions[0]?.sceneOptions).toHaveLength(2);
    expect(result.directions[0]?.recommendedSceneId)
      .toBe(result.directions[0]?.sceneOptions[0]?.id);
  });

  it('模型返回服务端字段时不会被静默接收，并触发唯一一次修复', async () => {
    const firstDirection = toWire(makeDirection(1));
    const secondDirection = toWire(makeDirection(2));
    const repairedResponse = {
      directions: [firstDirection, secondDirection],
      clarificationQuestion: '',
    };
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'response-use-directions-ambiguous-wrapper',
        model: 'doubao-seed-2-0-lite-260428',
        service_tier: 'default',
        output_text: JSON.stringify({
          directions: [
            {
              ...firstDirection,
              purchaseReason: '不应由模型返回的购买理由',
            },
            {
              ...secondDirection,
              sceneOptions: secondDirection.sceneOptions.map((scene, index) => (
                index === 0 ? { ...scene, mainAction: '不应由模型返回的场景动作' } : scene
              )),
            },
          ],
          clarificationQuestion: '',
        }),
        usage: { input_tokens: 40, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        id: 'response-use-directions-ambiguous-wrapper-repaired',
        model: 'doubao-seed-2-0-lite-260428',
        service_tier: 'default',
        output_text: JSON.stringify(repairedResponse),
        usage: { input_tokens: 50, output_tokens: 30 },
      });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const result = await provider.generateUseDirections(generationContext());

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.repairRounds).toBe(1);
    const repairPayload = JSON.parse(create.mock.calls[1]?.[0].input);
    expect(repairPayload.repair.feedback).toEqual(expect.arrayContaining([
      expect.stringContaining('directions.0'),
      expect.stringContaining('directions.1.sceneOptions.0'),
    ]));
    expect(repairPayload.repair.previousCandidate).not.toBeNull();
  });

  it('首个证据不可靠时不会跳到后续证据，并要求模型修复证据顺序', async () => {
    const firstDirection = toWire(makeDirection(1));
    const secondDirection = toWire(makeDirection(2));
    const repairedResponse = {
      directions: [firstDirection, secondDirection],
      clarificationQuestion: '',
    };
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'response-use-directions-invalid-primary-evidence',
        model: 'doubao-seed-2-0-lite-260428',
        service_tier: 'default',
        output_text: JSON.stringify({
          directions: [{
            ...firstDirection,
            evidenceIds: ['forbidden:capacity', 'visible:shape'],
          }, secondDirection],
          clarificationQuestion: '',
        }),
        usage: { input_tokens: 40, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        id: 'response-use-directions-primary-evidence-repaired',
        model: 'doubao-seed-2-0-lite-260428',
        service_tier: 'default',
        output_text: JSON.stringify(repairedResponse),
        usage: { input_tokens: 50, output_tokens: 30 },
      });
    const provider = new ArkPromptWizardProvider({ create } as never);
    const result = await provider.generateUseDirections(generationContext());

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.repairRounds).toBe(1);
    const repairPayload = JSON.parse(create.mock.calls[1]?.[0].input);
    expect(repairPayload.repair.feedback).toEqual(expect.arrayContaining([
      expect.stringContaining('directions.0.evidenceIds.0'),
    ]));
    expect(result.directions[0]?.purchaseReason).toBe('杯身呈大力神杯浮雕轮廓');
  });

  it('唯一修复仍返回服务端字段时直接失败且不发起第三次调用', async () => {
    const firstDirection = toWire(makeDirection(1));
    const secondDirection = toWire(makeDirection(2));
    const invalidResponse = {
      directions: [
        {
          ...firstDirection,
          purchaseReason: '不应由模型返回的购买理由',
        },
        secondDirection,
      ],
      clarificationQuestion: '',
    };
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'response-use-directions-invalid-wrapper-first',
        model: 'doubao-seed-2-0-lite-260428',
        service_tier: 'default',
        output_text: JSON.stringify(invalidResponse),
        usage: { input_tokens: 40, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        id: 'response-use-directions-invalid-wrapper-repair',
        model: 'doubao-seed-2-0-lite-260428',
        service_tier: 'default',
        output_text: JSON.stringify(invalidResponse),
        usage: { input_tokens: 50, output_tokens: 30 },
      });
    const provider = new ArkPromptWizardProvider({ create } as never);

    await expect(provider.generateUseDirections(generationContext())).rejects.toBeDefined();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('首次本地校验失败时只执行一次定向修复', async () => {
    const validResponse = {
      directions: [toWire(makeDirection(1)), toWire(makeDirection(2))],
      clarificationQuestion: '',
    };
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: 'response-use-direction-invalid',
        model: 'doubao-seed-2-0-lite-260428',
        service_tier: 'default',
        output_text: '{invalid json',
        usage: { input_tokens: 40, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        id: 'response-use-direction-repaired',
        model: 'doubao-seed-2-0-lite-260428',
        service_tier: 'default',
        output_text: JSON.stringify(validResponse),
        usage: { input_tokens: 50, output_tokens: 30 },
      });
    const recorder = {
      beginAttempt: vi.fn()
        .mockResolvedValueOnce('attempt-use-direction')
        .mockResolvedValueOnce('attempt-use-direction-repair'),
      completeAttempt: vi.fn().mockResolvedValue(undefined),
    };
    const provider = new ArkPromptWizardProvider({ create } as never, recorder);
    const result = await provider.generateUseDirections({
      ...generationContext(),
      costOwner: {
        runId: '00000000-0000-4000-8000-000000000702',
        batchId: null,
        userId: '00000000-0000-4000-8000-000000000703',
        jobAttempt: 1,
        repairRound: 0,
      },
    });

    expect(result.directions).toHaveLength(2);
    expect(result.repairRounds).toBe(1);
    expect(result.usage).toMatchObject({ inputTokens: 90, outputTokens: 40 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(JSON.parse(create.mock.calls[1]?.[0].input)).toMatchObject({
      repair: {
        previousCandidate: null,
        feedback: [expect.stringContaining('不是合法 JSON')],
      },
    });
    expect(recorder.beginAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      operation: 'generate-use-directions',
    }));
    expect(recorder.beginAttempt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      operation: 'repair-use-directions',
      owner: expect.objectContaining({ repairRound: 1 }),
    }));
  });

  it('输入只包含档案和可靠证据，并携带当前任务历史方向', () => {
    const payload = JSON.parse(buildPromptWizardUseDirectionInput({
      ...generationContext(),
      historicalDirections: [makeDirection(1)],
    }));
    expect(payload.task).toContain('2–3');
    expect(payload.reliableEvidence).toHaveLength(2);
    expect(payload.currentRunHistory).toHaveLength(1);
    expect(payload).not.toHaveProperty('images');
    expect(payload.outputRules).toEqual(expect.arrayContaining([
      expect.stringContaining('没有包装证据不得推荐'),
      expect.stringContaining('不得生成未经确认'),
    ]));
  });
});
