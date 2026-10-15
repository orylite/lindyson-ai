import { describe, expect, it } from 'vitest';
import {
  evaluatePromptWizardV3BlindSet,
  promptWizardV3BlindDatasetSchema,
} from '../src/tools/evaluatePromptWizardV3BlindSet.js';

const families = [
  'apparel-accessories',
  'beauty-personal-care',
  'consumer-electronics',
  'home-living',
  'general',
] as const;
const directions = [
  'ugc',
  'problem-solution',
  'unboxing-review',
  'feature-test',
  'pain-comparison',
  'lifestyle',
  'cinematic-brand',
  'asmr-detail',
] as const;
const durations = [5, 10, 15] as const;
const languages = ['英语', '西班牙语', '普通话'] as const;

function dataset() {
  return {
    version: 1 as const,
    blinded: true as const,
    cases: Array.from({ length: 80 }, (_, index) => ({
      id: `case-${index + 1}`,
      productRef: `sku-hash-${index + 1}`,
      productFamily: families[index % families.length]!,
      direction: directions[index % directions.length]!,
      durationSeconds: durations[index % durations.length]!,
      targetLanguage: languages[index % languages.length]!,
      imageCount: (index % 9) + 1,
      v2ArtifactRef: `vault://v2/${index + 1}`,
      v3ArtifactRef: `vault://v3/${index + 1}`,
    })),
  };
}

function ratings(preferred: 'v2' | 'v3' | 'tie' = 'v3') {
  return {
    version: 1 as const,
    ratings: dataset().cases.map(item => ({
      caseId: item.id,
      evaluatorRef: 'expert-hash-a',
      preferred,
      productionReady: { v2: false, v3: true },
    })),
    caseOutcomes: dataset().cases.map(item => ({
      caseId: item.id,
      traceablePurchaseReason: true,
      timelinePassed: true,
      voiceoverDurationPassed: true,
      assetReferencePassed: true,
      actionBudgetPassed: true,
      unconfirmedClaimCount: 0,
      providerCompleted: true,
      videoGenerationSucceeded: true,
      contentAuditPassed: true,
    })),
    baselineRates: {
      baselineVideoGenerationSuccessRate: 0.9,
      baselineContentAuditPassRate: 0.95,
    },
  };
}

describe('提示词向导 3.0 真实商品盲测门禁', () => {
  it('要求至少 80 案例并覆盖产品族、方向、时长和主要语言', () => {
    expect(promptWizardV3BlindDatasetSchema.parse(dataset()).cases).toHaveLength(80);
    const expanded = dataset();
    expanded.cases.push({
      ...expanded.cases[0]!,
      id: 'case-81',
      productRef: 'sku-hash-81',
      v2ArtifactRef: 'vault://v2/81',
      v3ArtifactRef: 'vault://v3/81',
    });
    expect(promptWizardV3BlindDatasetSchema.parse(expanded).cases).toHaveLength(81);
    const incomplete = dataset();
    incomplete.cases = incomplete.cases.slice(0, 79);
    expect(() => promptWizardV3BlindDatasetSchema.parse(incomplete)).toThrow();
  });

  it('3.0 专家盲选胜率达到 65% 时通过', () => {
    const inputRatings = ratings('v3');
    inputRatings.ratings.slice(0, 24).forEach(item => { item.preferred = 'v2'; });
    const result = evaluatePromptWizardV3BlindSet({ dataset: dataset(), ratings: inputRatings });

    expect(result.v3WinRate).toBe(0.7);
    expect(result.passed).toBe(true);
    expect(result.ratedCaseCount).toBe(80);
  });

  it('胜率不足、漏评或重复评价不能绕过发布门禁', () => {
    const losing = ratings('v2');
    expect(evaluatePromptWizardV3BlindSet({ dataset: dataset(), ratings: losing }).passed).toBe(false);

    const missing = ratings('v3');
    missing.ratings[79] = {
      ...missing.ratings[0]!,
      evaluatorRef: 'expert-hash-b',
    };
    expect(() => evaluatePromptWizardV3BlindSet({ dataset: dataset(), ratings: missing })).toThrow('没有专家盲评');

    const duplicate = ratings('v3');
    duplicate.ratings.push({ ...duplicate.ratings[0]! });
    expect(() => evaluatePromptWizardV3BlindSet({ dataset: dataset(), ratings: duplicate })).toThrow('重复评价');
  });

  it('事实、执行预算、Provider 和视频基线门禁任一不合格都会阻断发布', () => {
    const inputRatings = ratings('v3');
    inputRatings.caseOutcomes[0]!.actionBudgetPassed = false;
    inputRatings.caseOutcomes.slice(0, 5).forEach(item => { item.providerCompleted = false; });
    inputRatings.caseOutcomes.slice(0, 9).forEach(item => { item.videoGenerationSucceeded = false; });

    const result = evaluatePromptWizardV3BlindSet({ dataset: dataset(), ratings: inputRatings });

    expect(result.passed).toBe(false);
    expect(result.failedGates).toEqual(expect.arrayContaining([
      '动作预算通过率未达到 100%',
      'Provider 批次完成率低于 95%',
      '视频生成成功率低于 2.0 基线',
    ]));
  });
});
