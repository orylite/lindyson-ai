import { describe, expect, it } from 'vitest';
import {
  promptWizardEvidenceGraphSchema,
  type PromptWizardProductProfile,
} from '@lindyson/api-contracts';
import {
  buildPromptWizardEvidenceGraph,
  classifyPromptWizardProductFamily,
  derivePromptWizardEvidenceCapabilities,
  isPromptWizardObservableAction,
  mergePromptWizardProductionBriefEvidence,
  reconcilePromptWizardEvidenceGraphForProfileUpdate,
} from '../src/domain/promptWizardEvidenceGraph.js';

const IMAGE_ID = '00000000-0000-4000-8000-000000000011';

function profile(overrides: Partial<PromptWizardProductProfile> = {}): PromptWizardProductProfile {
  return {
    productName: '测试产品',
    category: '通用商品',
    colors: '',
    materials: '',
    structure: '',
    logo: '',
    usage: '',
    suggestedAudience: '日常消费者',
    suggestedScenarios: '日常使用',
    visibleFacts: ['产品主体为方形结构'],
    needsConfirmation: [],
    userConfirmedClaims: '',
    consistencyConstraints: '保持产品外观一致',
    ...overrides,
  };
}

describe('Prompt Wizard 3.0 产品证据图谱', () => {
  it.each([
    ['服饰配件', { productName: 'MEXICO 短袖 T恤', category: '运动服饰' }, 'apparel-accessories'],
    ['美妆个护', { productName: '玻尿酸精华液', category: '护肤品' }, 'beauty-personal-care'],
    ['消费电子', { productName: 'Pro X 头戴式耳机', category: '消费电子' }, 'consumer-electronics'],
    ['家居生活', { productName: '折叠收纳盒', category: '家居收纳' }, 'home-living'],
    ['通用回退', { productName: 'XYZ 模型', category: '其他商品' }, 'general'],
  ] as const)('%s 根据产品语义归入正确产品族', (_label, overrides, expected) => {
    expect(classifyPromptWizardProductFamily(profile(overrides))).toBe(expected);
  });

  it('区分可见事实、用户确认、待确认和禁止假设，并保留图片来源与自证动作', () => {
    const graph = buildPromptWizardEvidenceGraph({
      profile: profile({
        productName: '折叠式耳机 Pro X',
        category: '头戴式耳机',
        materials: '哑光机身与软皮耳罩',
        structure: '头梁可向内折叠，右耳罩有电源按键',
        logo: '右耳罩外侧有 Pro X Logo',
        usage: '佩戴后按下右耳罩电源键开机',
        visibleFacts: ['头梁可以向内折叠', '耳罩为椭圆结构'],
        needsConfirmation: ['续航是否达到 30 小时'],
        userConfirmedClaims: '用户确认支持主动降噪功能',
      }),
      imageAssetIds: [IMAGE_ID],
      visibleFactSources: [{ factIndex: 0, imageAssetIds: [IMAGE_ID], visibleArea: '图片 1 顶部头梁' }],
    });

    expect(promptWizardEvidenceGraphSchema.parse(graph)).toEqual(graph);
    expect(graph.productFamily).toBe('consumer-electronics');
    expect(graph.reliableEvidenceIds).toContain('visible:1');
    expect(graph.reliableEvidenceIds).toContain('confirmed:1');
    expect(graph.pendingEvidenceIds).toEqual(['needs-confirmation:1']);
    expect(graph.forbiddenAssumptionIds).toEqual(['forbidden-assumption:1']);
    expect(graph.evidences.find(item => item.id === 'visible:1')).toMatchObject({
      status: 'visible',
      sourceImageAssetIds: [IMAGE_ID],
      visibleRegion: '图片 1 顶部头梁',
    });
    expect(graph.evidences.find(item => item.id === 'profile:usage')?.proofActions[0]).toContain('正确使用动作');
    expect(graph.evidences.find(item => item.id === 'confirmed:1')).toMatchObject({
      status: 'user-confirmed',
      sourceImageAssetIds: [],
    });
    expect(graph.evidences.find(item => item.id === 'forbidden-assumption:1')?.status)
      .toBe('forbidden-assumption');
  });

  it.each([
    ['奖杯造型玻璃饮品杯', '玻璃饮品杯'],
    ['户外金属水壶', '金属水壶'],
    ['复古皮革手袋', '皮革手袋'],
  ])('产品名称和品类中的材质词不会改变主体身份分类：%s', (productName, category) => {
    const graph = buildPromptWizardEvidenceGraph(profile({
      productName,
      category,
      materials: '材质细节以参考图片为准',
    }), [IMAGE_ID]);

    expect(graph.evidences.find(item => item.id === 'profile:productName')?.type)
      .toBe('appearance');
    expect(graph.evidences.find(item => item.id === 'profile:category')?.type)
      .toBe('appearance');
  });

  it.each([
    '稳定近景展示产品主体',
    '环绕特写后推近并停留在结构细节',
    '第一秒揭晓产品整体轮廓',
    '手倾斜杯身并注入饮品',
    '手端起产品并对准镜头',
  ])('方向层允许的可拍动作使用同一权威词表：%s', action => {
    expect(isPromptWizardObservableAction(action)).toBe(true);
  });

  it('纯情绪及抽象氛围不属于可拍产品动作', () => {
    expect(isPromptWizardObservableAction('人物很开心，画面很有高级感')).toBe(false);
  });

  it('只从可靠证据推导包装、功能实测、操作声和前后对比能力', () => {
    const graph = buildPromptWizardEvidenceGraph(profile({
      productName: '智能耳机',
      category: '消费电子',
      structure: '折叠头梁与按键结构',
      usage: '打开包装盒，佩戴耳机并按下电源键',
      visibleFacts: ['包装盒与耳机同时出现在图片中'],
      needsConfirmation: ['防水等级需要确认'],
      userConfirmedClaims: '用户确认支持三档降噪模式',
    }), [IMAGE_ID]);
    const capabilities = derivePromptWizardEvidenceCapabilities(graph);

    expect(capabilities).toEqual(expect.objectContaining({
      hasImageEvidence: true,
      hasPackagingEvidence: true,
      hasUsageAction: true,
      hasVisibleStructure: true,
      hasFoleyAction: true,
      hasConfirmedTestableFeature: true,
      hasSafeBeforeAfterEvidence: true,
    }));
    expect(graph.reliableEvidenceIds).not.toContain('needs-confirmation:1');
    expect(JSON.stringify(graph.evidences.filter(item => graph.reliableEvidenceIds.includes(item.id))))
      .not.toContain('防水等级');
  });

  it('只传图片数量时不伪造资产 UUID', () => {
    const graph = buildPromptWizardEvidenceGraph(profile(), 3);
    expect(graph.evidences.every(item => item.sourceImageAssetIds.length === 0)).toBe(true);
  });

  it('旧证据图谱缺少 confidence 时仍可读取并归一化为 unknown', () => {
    const graph = buildPromptWizardEvidenceGraph(profile(), [IMAGE_ID]);
    const legacy = structuredClone(graph) as unknown as {
      evidences: Array<Record<string, unknown>>;
    };
    legacy.evidences.forEach(item => delete item.confidence);
    const parsed = promptWizardEvidenceGraphSchema.parse(legacy);
    expect(parsed.evidences.every(item => item.confidence === 'unknown')).toBe(true);
  });

  it('新识别只绑定 Provider 明确返回的来源图片、区域、可信度和自证动作', () => {
    const secondImageId = '00000000-0000-4000-8000-000000000012';
    const graph = buildPromptWizardEvidenceGraph({
      profile: profile({
        materials: '视觉上可见金属质感',
        structure: '主体为方形结构',
        visibleFacts: ['右侧可见圆形按键'],
      }),
      imageAssetIds: [IMAGE_ID, secondImageId],
      detectedEvidenceSources: [
        {
          fieldPath: 'structure',
          imageAssetIds: [secondImageId],
          visibleRegion: '图片 2 中央产品主体',
          confidence: 'high',
          proofActions: ['环绕近景展示方形主体结构'],
        },
        {
          fieldPath: 'visibleFacts[0]',
          imageAssetIds: [IMAGE_ID],
          visibleRegion: '图片 1 右侧按键区域',
          confidence: 'medium',
          proofActions: ['手指靠近按键并稳定展示其位置'],
        },
        {
          fieldPath: 'materials',
          imageAssetIds: [secondImageId],
          visibleRegion: '图片 2 顶部反光区域',
          confidence: 'low',
          proofActions: [],
        },
      ],
    });

    expect(graph.evidences.find(item => item.id === 'profile:structure')).toMatchObject({
      sourceImageAssetIds: [secondImageId],
      visibleRegion: '图片 2 中央产品主体',
      confidence: 'high',
      proofActions: ['环绕近景展示方形主体结构'],
      status: 'visible',
    });
    expect(graph.evidences.find(item => item.id === 'profile:materials')).toMatchObject({
      sourceImageAssetIds: [secondImageId],
      confidence: 'low',
      status: 'needs-confirmation',
      proofActions: [],
    });
    expect(graph.reliableEvidenceIds).not.toContain('profile:materials');
    expect(graph.pendingEvidenceIds).toContain('profile:materials');
    expect(graph.evidences.find(item => item.id === 'profile:productName')).toMatchObject({
      sourceImageAssetIds: [],
      status: 'needs-confirmation',
      confidence: 'unknown',
    });
  });

  it('detected Logo 稳定特写属于可观察动作，不可拍的抽象说明回退为确定性动作', () => {
    const stableCloseUp = '稳定特写保持 MEXICO 印花原样';
    const detectedGraph = buildPromptWizardEvidenceGraph({
      profile: profile({ logo: '胸前可见 MEXICO 印花' }),
      imageAssetIds: [IMAGE_ID],
      detectedEvidenceSources: [{
        fieldPath: 'logo',
        imageAssetIds: [IMAGE_ID],
        visibleRegion: '图片 1 胸前印花区域',
        confidence: 'high',
        proofActions: [stableCloseUp],
      }],
    });
    const logoEvidence = detectedGraph.evidences.find(item => item.id === 'profile:logo');
    expect(logoEvidence?.proofActions).toEqual([stableCloseUp]);
    expect(logoEvidence?.proofActions.every(isPromptWizardObservableAction)).toBe(true);

    const fallbackGraph = buildPromptWizardEvidenceGraph({
      profile: profile({ logo: '胸前可见 MEXICO 印花' }),
      imageAssetIds: [IMAGE_ID],
      detectedEvidenceSources: [{
        fieldPath: 'logo',
        imageAssetIds: [IMAGE_ID],
        visibleRegion: '图片 1 胸前印花区域',
        confidence: 'high',
        proofActions: ['强化品牌质感'],
      }],
    });
    const fallbackEvidence = fallbackGraph.evidences.find(item => item.id === 'profile:logo');
    expect(fallbackEvidence?.proofActions).not.toContain('强化品牌质感');
    expect(fallbackEvidence?.proofActions[0]).toContain('稳定特写展示');
    expect(fallbackEvidence?.proofActions.every(isPromptWizardObservableAction)).toBe(true);
  });

  it('用户编辑后仅原文未变事实保留图片来源，改写内容转为独立 user-confirmed', () => {
    const originalProfile = profile({
      structure: '主体为方形结构',
      visibleFacts: ['右侧可见圆形按键'],
    });
    const original = buildPromptWizardEvidenceGraph({
      profile: originalProfile,
      imageAssetIds: [IMAGE_ID],
      detectedEvidenceSources: [
        {
          fieldPath: 'structure',
          imageAssetIds: [IMAGE_ID],
          visibleRegion: '图片 1 产品主体',
          confidence: 'high',
          proofActions: ['环绕展示方形结构'],
        },
        {
          fieldPath: 'visibleFacts[0]',
          imageAssetIds: [IMAGE_ID],
          visibleRegion: '图片 1 右侧',
          confidence: 'high',
          proofActions: ['近景展示圆形按键'],
        },
      ],
    });
    const revised = reconcilePromptWizardEvidenceGraphForProfileUpdate({
      profile: { ...originalProfile, structure: '用户确认主体可以折叠收纳' },
      previousGraph: original,
      imageAssetIds: [IMAGE_ID],
    });

    expect(revised.evidences.find(item => item.id === 'visible:1')).toMatchObject({
      status: 'visible',
      sourceImageAssetIds: [IMAGE_ID],
      visibleRegion: '图片 1 右侧',
    });
    expect(revised.evidences.find(item => item.id === 'profile:structure')).toMatchObject({
      text: '用户确认主体可以折叠收纳',
      status: 'user-confirmed',
      sourceImageAssetIds: [],
      visibleRegion: '用户编辑确认',
      confidence: 'unknown',
    });
  });

  it('主推购买理由写入独立用户确认证据，不借用图片结构事实', () => {
    const graph = buildPromptWizardEvidenceGraph(profile(), [IMAGE_ID]);
    const merged = mergePromptWizardProductionBriefEvidence(graph, {
      primaryPurchaseReason: '用户确认便于单手取用',
      appearanceMode: 'hands-only',
      availableScenes: ['桌面'],
      availableAssets: ['产品参考图片'],
    });
    expect(merged.evidences.find(item => item.id === 'brief:primaryPurchaseReason')).toMatchObject({
      text: '用户确认便于单手取用',
      status: 'user-confirmed',
      sourceImageAssetIds: [],
      visibleRegion: '用户确认的主推购买理由',
    });
    expect(merged.reliableEvidenceIds).toContain('brief:primaryPurchaseReason');
  });
});
