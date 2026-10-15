import { describe, expect, it } from 'vitest';
import type { PromptWizardProductProfile } from '@lindyson/api-contracts';
import type { PromptWizardShotRole } from '../src/domain/promptWizardDirectionBlueprint.js';
import {
  PromptWizardEvidenceAllocationError,
  allocatePromptWizardEvidence,
  buildPromptWizardReliableFactCatalog,
} from '../src/domain/promptWizardEvidence.js';
import { buildPromptWizardFactCatalog } from '../src/domain/promptWizardPrompt.js';
import {
  PROMPT_WIZARD_PLAN_INDEXES,
  PROMPT_WIZARD_V6_PLAN_INDEXES,
} from '../src/domain/promptWizardPlanCount.js';
import { buildPromptWizardEvidenceGraph } from '../src/domain/promptWizardEvidenceGraph.js';

const PROFILE: PromptWizardProductProfile = {
  productName: '折叠式降噪耳机',
  category: '头戴式耳机',
  colors: '',
  materials: '哑光塑料与软皮耳罩',
  structure: '可折叠头梁、椭圆耳罩',
  logo: '右侧耳罩有可见 Logo',
  usage: '佩戴于双耳并按下电源键',
  suggestedAudience: '通勤用户',
  suggestedScenarios: '通勤、办公与旅行',
  visibleFacts: ['黑色外观', '头梁可以折叠', '椭圆形软皮耳罩'],
  needsConfirmation: ['续航时长需由用户确认'],
  userConfirmedClaims: '',
  consistencyConstraints: '所有镜头保持材质和耳罩结构一致',
};

const FOUR_SHOT_ROLES = ['hook', 'proof', 'resolution', 'cta'] as const;
const EVIDENCE_GRAPH = buildPromptWizardEvidenceGraph(PROFILE, 1);

describe('提示词向导确定性事实分配', () => {
  it('指定事实后 Provider 输入与响应解码可复用完全相同的分配结果', () => {
    const preferredFactIds = ['visible:3', 'profile:structure'] as const;
    const providerInputAllocation = allocatePromptWizardEvidence({
      evidenceGraph: EVIDENCE_GRAPH,
      shotRoles: FOUR_SHOT_ROLES,
      planIndex: 0,
      preferredFactIds,
    });
    const responseDecodeAllocation = allocatePromptWizardEvidence({
      evidenceGraph: EVIDENCE_GRAPH,
      shotRoles: FOUR_SHOT_ROLES,
      planIndex: 0,
      preferredFactIds,
    });

    expect(responseDecodeAllocation).toEqual(providerInputAllocation);
    expect(providerInputAllocation).toEqual({
      proofPoints: ['椭圆形软皮耳罩', '可折叠头梁、椭圆耳罩'],
      evidenceRefsByShot: [
        [],
        ['visible:3'],
        ['profile:structure'],
        [],
      ],
    });
  });

  it('多个指定事实按顺序分配到每个自证镜头，并按方案索引确定性轮转', () => {
    const preferredFactIds = [
      'visible:1',
      'visible:2',
      'profile:logo',
    ] as const;
    const planZero = allocatePromptWizardEvidence({
      evidenceGraph: EVIDENCE_GRAPH,
      shotRoles: FOUR_SHOT_ROLES,
      planIndex: 0,
      preferredFactIds,
    });
    const planOne = allocatePromptWizardEvidence({
      evidenceGraph: EVIDENCE_GRAPH,
      shotRoles: FOUR_SHOT_ROLES,
      planIndex: 1,
      preferredFactIds,
    });

    expect(planZero.evidenceRefsByShot).toEqual([
      [],
      ['visible:1'],
      ['visible:2'],
      [],
    ]);
    expect(planZero.proofPoints).toEqual(['黑色外观', '头梁可以折叠']);
    expect(planOne.evidenceRefsByShot).toEqual([
      [],
      ['visible:2'],
      ['profile:logo'],
      [],
    ]);
    expect(planOne.proofPoints).toEqual(['头梁可以折叠', '右侧耳罩有可见 Logo']);
  });

  it.each([
    {
      label: '非法事实 ID',
      profile: PROFILE,
      factId: 'needsConfirmation:1',
    },
    {
      label: '待确认事实',
      profile: { ...PROFILE, materials: '无法确认材质' },
      factId: 'profile:materials',
    },
    {
      label: '不存在的事实 ID',
      profile: PROFILE,
      factId: 'visible:99',
    },
  ])('$label 会明确失败，不会回退到其他可靠事实', ({ profile, factId }) => {
    expect(() => allocatePromptWizardEvidence({
      evidenceGraph: buildPromptWizardEvidenceGraph(profile, 1),
      shotRoles: FOUR_SHOT_ROLES,
      planIndex: 0,
      preferredFactIds: [factId],
    })).toThrowError(PromptWizardEvidenceAllocationError);

    try {
      allocatePromptWizardEvidence({
        evidenceGraph: buildPromptWizardEvidenceGraph(profile, 1),
        shotRoles: FOUR_SHOT_ROLES,
        planIndex: 0,
        preferredFactIds: [factId],
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PROMPT_WIZARD_EVIDENCE_UNAVAILABLE',
        message: `创意方案引用了不可用的产品事实：${factId}`,
      });
    }
  });

  it('未指定事实或传入空列表时保持旧的事实优先级与方案轮转行为', () => {
    const legacyAllocation = allocatePromptWizardEvidence({
      evidenceGraph: EVIDENCE_GRAPH,
      shotRoles: FOUR_SHOT_ROLES,
      planIndex: 1,
    });
    const emptyPreferredAllocation = allocatePromptWizardEvidence({
      evidenceGraph: EVIDENCE_GRAPH,
      shotRoles: FOUR_SHOT_ROLES,
      planIndex: 1,
      preferredFactIds: [],
    });

    expect(emptyPreferredAllocation).toEqual(legacyAllocation);
    expect(legacyAllocation.evidenceRefsByShot).toEqual([
      [],
      ['visible:2'],
      ['visible:3'],
      [],
    ]);
    expect(legacyAllocation.proofPoints).toEqual([
      '头梁可以折叠',
      '椭圆形软皮耳罩',
    ]);
  });

  it('重复事实按来源优先级保留一个权威 ID，避免下游引用已去除的别名', () => {
    const duplicateProfile: PromptWizardProductProfile = {
      ...PROFILE,
      logo: '衣身可见 MEXICO 原文印花',
      visibleFacts: ['衣身可见 MEXICO 原文印花'],
    };

    const catalog = buildPromptWizardReliableFactCatalog(duplicateProfile);

    expect(catalog.filter(item => item.text === '衣身可见 MEXICO 原文印花')).toEqual([
      { id: 'visible:1', text: '衣身可见 MEXICO 原文印花' },
    ]);
  });

  it('只返回可追溯的事实，且为自证与化解镜头分配引用', () => {
    const result = allocatePromptWizardEvidence({
      evidenceGraph: EVIDENCE_GRAPH,
      shotRoles: FOUR_SHOT_ROLES,
      planIndex: 0,
    });
    const catalog = buildPromptWizardFactCatalog(PROFILE);
    const catalogIds = new Set(catalog.map(item => item.id));
    const catalogTexts = new Set(catalog.map(item => item.text));

    expect(result.evidenceRefsByShot).toHaveLength(FOUR_SHOT_ROLES.length);
    expect(result.evidenceRefsByShot[0]).toEqual([]);
    expect(result.evidenceRefsByShot[1]).toHaveLength(1);
    expect(result.evidenceRefsByShot[2]).toHaveLength(1);
    expect(result.evidenceRefsByShot[3]).toEqual([]);
    expect(result.evidenceRefsByShot.flat().every(id => catalogIds.has(id))).toBe(true);
    expect(result.proofPoints.every(text => catalogTexts.has(text))).toBe(true);
    expect(result.proofPoints).not.toContain(PROFILE.needsConfirmation[0]);
  });

  it.each([
    ['proof'] as const,
    ['proof-resolution'] as const,
    ['resolution'] as const,
  ])('%s 镜头必须至少获得一项事实', (role) => {
    const shotRoles: readonly PromptWizardShotRole[] = ['hook', role, 'cta'];
    const result = allocatePromptWizardEvidence({ evidenceGraph: EVIDENCE_GRAPH, shotRoles, planIndex: 1 });

    expect(result.evidenceRefsByShot[1]).toHaveLength(1);
    expect(result.proofPoints).toHaveLength(1);
  });

  it('对相同输入结果稳定，且两个方案优先使用不同的可见事实', () => {
    const allocations = PROMPT_WIZARD_PLAN_INDEXES.map(planIndex => allocatePromptWizardEvidence({
      evidenceGraph: EVIDENCE_GRAPH,
      shotRoles: FOUR_SHOT_ROLES,
      planIndex,
    }));

    expect(allocatePromptWizardEvidence({
      evidenceGraph: EVIDENCE_GRAPH,
      shotRoles: FOUR_SHOT_ROLES,
      planIndex: 1,
    })).toEqual(allocations[1]);
    expect(new Set(allocations.map(item => item.evidenceRefsByShot[1]![0])).size).toBe(2);
    expect(allocations.map(item => item.evidenceRefsByShot[1]![0])).toEqual([
      'visible:1',
      'visible:2',
    ]);
  });

  it('只有一项可靠事实时会复用，但不留下空的自证引用', () => {
    const profile: PromptWizardProductProfile = {
      ...PROFILE,
      productName: '',
      category: '',
      materials: '',
      structure: '',
      logo: '',
      usage: '',
      visibleFacts: ['头梁可以折叠'],
      userConfirmedClaims: '',
    };

    const result = allocatePromptWizardEvidence({
      evidenceGraph: buildPromptWizardEvidenceGraph(profile, 1),
      shotRoles: FOUR_SHOT_ROLES,
      planIndex: 1,
    });

    expect(result.proofPoints).toEqual(['头梁可以折叠']);
    expect(result.evidenceRefsByShot).toEqual([
      [],
      ['visible:1'],
      ['visible:1'],
      [],
    ]);
  });

  it('没有可靠事实时抛出明确错误，不使用 needsConfirmation 填充', () => {
    const profile: PromptWizardProductProfile = {
      ...PROFILE,
      productName: '',
      category: '',
      materials: '无法确认材质',
      structure: '',
      logo: '',
      usage: '',
      visibleFacts: [],
      userConfirmedClaims: '',
      needsConfirmation: ['头梁是否可折叠需确认'],
    };

    expect(() => allocatePromptWizardEvidence({
      evidenceGraph: buildPromptWizardEvidenceGraph(profile, 1),
      shotRoles: FOUR_SHOT_ROLES,
      planIndex: 0,
    })).toThrowError(PromptWizardEvidenceAllocationError);

    try {
      allocatePromptWizardEvidence({
        evidenceGraph: buildPromptWizardEvidenceGraph(profile, 1),
        shotRoles: FOUR_SHOT_ROLES,
        planIndex: 0,
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PROMPT_WIZARD_EVIDENCE_UNAVAILABLE',
        message: '没有可用于产品自证的已确认事实',
      });
    }
  });

  it('拒绝非法的方案序号', () => {
    expect(() => allocatePromptWizardEvidence({
      evidenceGraph: EVIDENCE_GRAPH,
      shotRoles: FOUR_SHOT_ROLES,
      planIndex: 2,
    } as never)).toThrowError('planIndex 必须是 0 或 1');
  });

  it('V6 显式支持三个方案的稳定证据轮转，且继续拒绝索引 3', () => {
    const allocations = PROMPT_WIZARD_V6_PLAN_INDEXES.map(planIndex => (
      allocatePromptWizardEvidence({
        evidenceGraph: EVIDENCE_GRAPH,
        shotRoles: FOUR_SHOT_ROLES,
        planIndex,
        deliveryVersion: 6,
      })
    ));

    expect(allocations.map(item => item.evidenceRefsByShot[1]![0])).toEqual([
      'visible:1',
      'visible:2',
      'visible:3',
    ]);
    expect(allocatePromptWizardEvidence({
      evidenceGraph: EVIDENCE_GRAPH,
      shotRoles: FOUR_SHOT_ROLES,
      planIndex: 2,
      deliveryVersion: 6,
    })).toEqual(allocations[2]);
    expect(() => allocatePromptWizardEvidence({
      evidenceGraph: EVIDENCE_GRAPH,
      shotRoles: FOUR_SHOT_ROLES,
      planIndex: 3,
      deliveryVersion: 6,
    } as never)).toThrowError('planIndex 必须是 0、1 或 2');
  });
});
