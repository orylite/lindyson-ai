import { describe, expect, it } from 'vitest';
import type {
  PromptWizardCreativeBrief,
  PromptWizardProductProfile,
} from '@lindyson/api-contracts';
import {
  assessPromptWizardDirection,
  buildAllPromptWizardDirectionAssessments,
  buildPromptWizardCreativePlaybook,
  buildPromptWizardProductionBrief,
  promptWizardBriefQuestions,
} from '../src/domain/promptWizardCreativePlaybook.js';
import { buildPromptWizardEvidenceGraph } from '../src/domain/promptWizardEvidenceGraph.js';

const IMAGE_ID = '00000000-0000-4000-8000-000000000021';
const DIRECTIONS: PromptWizardCreativeBrief['direction'][] = [
  'ugc', 'problem-solution', 'unboxing-review', 'feature-test',
  'pain-comparison', 'lifestyle', 'cinematic-brand', 'asmr-detail',
];

function profile(overrides: Partial<PromptWizardProductProfile> = {}): PromptWizardProductProfile {
  return {
    productName: 'Pro X 耳机',
    category: '头戴式耳机',
    colors: '',
    materials: '哑光机身与软皮耳罩',
    structure: '可折叠头梁和右耳罩电源按键',
    logo: '右耳罩有 Pro X Logo',
    usage: '佩戴耳机并按下电源键',
    suggestedAudience: '通勤用户',
    suggestedScenarios: '通勤与办公',
    visibleFacts: ['包装盒与耳机同时可见', '头梁可以折叠'],
    needsConfirmation: [],
    userConfirmedClaims: '用户确认支持三档降噪模式',
    consistencyConstraints: '保持耳罩结构与 Logo 位置一致',
    ...overrides,
  };
}

describe('Prompt Wizard 3.0 产品族方向 Playbook', () => {
  it('八个方向均生成产品族专属指引和能力适配结果', () => {
    const graph = buildPromptWizardEvidenceGraph(profile(), [IMAGE_ID]);
    const productionBrief = buildPromptWizardProductionBrief(profile(), {
      primaryPurchaseReason: '折叠结构便于收纳',
      appearanceMode: 'person',
      availableScenes: ['通勤车厢', '办公桌'],
      availableAssets: ['产品参考图片', '包装素材', '真人素材'],
    });
    const assessments = buildAllPromptWizardDirectionAssessments({ graph, productionBrief });

    expect(assessments).toHaveLength(8);
    expect(assessments.every(item => item.availability !== 'unavailable')).toBe(true);
    for (const direction of DIRECTIONS) {
      const playbook = buildPromptWizardCreativePlaybook({ graph, productionBrief, direction });
      expect(playbook.direction).toBe(direction);
      expect(playbook.productFamily).toBe('consumer-electronics');
      expect(playbook.familyTreatment).toMatch(/[\u3400-\u9fff]/u);
      expect(playbook.hookGuidance.join('')).toMatch(/[\u3400-\u9fff]/u);
      expect(playbook.proofGuidance.length).toBeGreaterThan(0);
      expect(playbook.executionGuidance.join('')).toContain('通勤车厢');
    }
  });

  it.each([
    ['unboxing-review', '缺少可见包装'],
    ['feature-test', '缺少用户确认'],
    ['asmr-detail', '缺少可产生真实操作声'],
  ] as const)('%s 缺少硬条件时标记暂不可用', (direction, reason) => {
    const sparse = profile({
      productName: '展示摆件',
      category: '创意商品',
      materials: '',
      structure: '',
      logo: '',
      usage: '',
      visibleFacts: ['红色方形物体'],
      userConfirmedClaims: '',
    });
    const graph = buildPromptWizardEvidenceGraph(sparse, [IMAGE_ID]);
    const productionBrief = buildPromptWizardProductionBrief(sparse, {
      appearanceMode: 'product-only',
      availableAssets: ['产品参考图片'],
    });

    expect(assessPromptWizardDirection({ graph, productionBrief, direction })).toMatchObject({
      availability: 'unavailable',
      reason: expect.stringContaining(reason),
    });
  });

  it('服饰、美妆、电子和家居的同一 UGC 方向不会复用同一套处理文案', () => {
    const cases: PromptWizardProductProfile[] = [
      profile({ productName: '运动 T恤', category: '服饰' }),
      profile({ productName: '精华液', category: '护肤品', usage: '按压泵头后涂抹' }),
      profile(),
      profile({ productName: '厨房收纳盒', category: '家居收纳', usage: '打开盒盖后放入餐具' }),
    ];
    const treatments = cases.map(item => {
      const graph = buildPromptWizardEvidenceGraph(item, [IMAGE_ID]);
      const productionBrief = buildPromptWizardProductionBrief(item, { appearanceMode: 'hands-only' });
      return buildPromptWizardCreativePlaybook({ graph, productionBrief, direction: 'ugc' }).familyTreatment;
    });
    expect(new Set(treatments)).toHaveLength(4);
  });

  it('只在关键信息缺失时提出最多三个轻量问题', () => {
    const graph = buildPromptWizardEvidenceGraph(profile(), [IMAGE_ID]);
    const questions = promptWizardBriefQuestions(graph, {});
    expect(questions.map(item => item.id)).toEqual([
      'purchase-reason', 'talent-mode', 'available-scenes',
    ]);
    expect(promptWizardBriefQuestions(graph, {
      primaryPurchaseReason: '折叠收纳',
      appearanceMode: 'hands-only',
      availableScenes: ['桌面'],
      availableAssets: ['产品参考图片'],
    })).toEqual([]);
  });
});
