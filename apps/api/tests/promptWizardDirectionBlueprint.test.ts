import { describe, expect, it } from 'vitest';
import type { PromptWizardCreativeBrief } from '@lindyson/api-contracts';
import {
  getPromptWizardDirectionBlueprint,
  promptWizardDirectionBlueprints,
  promptWizardShotRoles,
} from '../src/domain/promptWizardDirectionBlueprint.js';

const EXPECTATIONS: Array<{
  direction: PromptWizardCreativeBrief['direction'];
  label: string;
  proofKeyword: RegExp;
  guardrailKeyword: RegExp;
}> = [
  { direction: 'ugc', label: '真实 UGC', proofKeyword: /真实操作/u, guardrailKeyword: /评价|购买经历/u },
  { direction: 'problem-solution', label: '场景问题解决', proofKeyword: /闭环/u, guardrailKeyword: /魔法|绝对/u },
  { direction: 'unboxing-review', label: '开箱测评', proofKeyword: /结构|材质/u, guardrailKeyword: /购买|主观/u },
  { direction: 'feature-test', label: '功能实测', proofKeyword: /测试|性能数字/u, guardrailKeyword: /危险|测试数字/u },
  { direction: 'pain-comparison', label: '痛点对比', proofKeyword: /前后|使用动作/u, guardrailKeyword: /竞品|绝对/u },
  { direction: 'lifestyle', label: '生活方式', proofKeyword: /连续使用|多场景/u, guardrailKeyword: /道具|价格/u },
  { direction: 'cinematic-brand', label: '电影感品牌片', proofKeyword: /材质|结构/u, guardrailKeyword: /部件|奖项/u },
  { direction: 'asmr-detail', label: 'ASMR 细节展示', proofKeyword: /Foley|材质/u, guardrailKeyword: /声音|特效/u },
];

describe('提示词向导八个主创作方向蓝图', () => {
  it('完整覆盖现有八个方向且不引入母题、市场或地区预设', () => {
    expect(Object.keys(promptWizardDirectionBlueprints).sort()).toEqual(
      EXPECTATIONS.map(item => item.direction).sort(),
    );
    expect(JSON.stringify(promptWizardDirectionBlueprints)).not.toMatch(/创作母题|目标市场|墨西哥预设/u);
  });

  it.each(EXPECTATIONS)(
    '$label 固化方向目标、自证规则、CTA 语气和风险边界',
    ({ direction, label, proofKeyword, guardrailKeyword }) => {
      const blueprint = getPromptWizardDirectionBlueprint(direction);

      expect(blueprint.direction).toBe(direction);
      expect(blueprint.label).toBe(label);
      expect(blueprint.objective.length).toBeGreaterThan(10);
      expect(blueprint.routeGuidance.length).toBeGreaterThanOrEqual(3);
      expect(blueprint.visualStyle.length).toBeGreaterThanOrEqual(3);
      expect(blueprint.proofRules.join('；')).toMatch(proofKeyword);
      expect(blueprint.ctaTone.length).toBeGreaterThan(10);
      expect(blueprint.ctaTone).toMatch(/[\u3400-\u9fff]/u);
      expect(blueprint.guardrails.join('；')).toMatch(guardrailKeyword);
      expect(Object.keys(blueprint.beatGuidance).sort()).toEqual([
        'cta',
        'hook',
        'proof',
        'proof-resolution',
        'resolution',
      ]);
      for (const guidance of Object.values(blueprint.beatGuidance)) {
        expect(guidance).toMatch(/[\u3400-\u9fff]/u);
      }
    },
  );

  it('5 秒合并产品自证与化解，10/15 秒保留四段职责', () => {
    expect(promptWizardShotRoles(5)).toEqual(['hook', 'proof-resolution', 'cta']);
    expect(promptWizardShotRoles(10)).toEqual(['hook', 'proof', 'resolution', 'cta']);
    expect(promptWizardShotRoles(15)).toEqual(['hook', 'proof', 'resolution', 'cta']);
  });
});
