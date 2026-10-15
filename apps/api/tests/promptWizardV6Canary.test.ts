import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertPromptWizardV6Canary,
  PROMPT_WIZARD_V6_CANARY_CASES,
  PROMPT_WIZARD_V6_CANARY_DURATIONS,
  PROMPT_WIZARD_V6_CANARY_LANGUAGES,
  runPromptWizardV6Canary,
  runPromptWizardV6CanaryCase,
} from '../src/tools/canaryPromptWizardV6.js';
import { PROMPT_WIZARD_V6_ROUTE_ROLES } from '../src/domain/promptWizardV6Routes.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('V6 本地确定性 Canary', () => {
  it('固定覆盖五类商品、十五个批次与四十五个方案槽位', () => {
    expect(PROMPT_WIZARD_V6_CANARY_CASES).toHaveLength(15);
    expect(new Set(PROMPT_WIZARD_V6_CANARY_CASES.map(item => item.productKey)))
      .toEqual(new Set(['耳机', '美妆', '服饰', '宠物用品', '家居']));

    const observations = PROMPT_WIZARD_V6_CANARY_CASES.map(runPromptWizardV6CanaryCase);
    expect(observations.flatMap(item => item.plans)).toHaveLength(45);
    expect(assertPromptWizardV6Canary(observations)).toEqual({
      completedBatchCount: 15,
      validatedPlanCount: 45,
      providerMode: 'deterministic-no-provider',
      realProviderCalled: false,
    });
  });

  it('每类商品覆盖 5 秒无口播与 10/15 秒口播，十个口播批次轮换三种语言', () => {
    for (const productKey of ['耳机', '美妆', '服饰', '宠物用品', '家居'] as const) {
      const productCases = PROMPT_WIZARD_V6_CANARY_CASES.filter(item => (
        item.productKey === productKey
      ));
      expect(productCases.map(item => item.videoConfig.durationSeconds))
        .toEqual(PROMPT_WIZARD_V6_CANARY_DURATIONS);
      expect(productCases.filter(item => item.videoConfig.durationSeconds === 5))
        .toEqual([expect.objectContaining({
          audioMode: 'sound-design-only',
          voiceoverLanguage: null,
        })]);
      const voiceoverProductCases = productCases.filter(item => (
        item.videoConfig.durationSeconds !== 5
      ));
      expect(voiceoverProductCases).toHaveLength(2);
      expect(voiceoverProductCases.every(item => (
        item.audioMode === 'voiceover' && Boolean(item.voiceoverLanguage)
      ))).toBe(true);
      expect(new Set(voiceoverProductCases.map(item => item.voiceoverLanguage)).size).toBe(2);
    }
    const voiceoverCases = PROMPT_WIZARD_V6_CANARY_CASES.filter(item => (
      item.audioMode === 'voiceover'
    ));
    expect(voiceoverCases).toHaveLength(10);
    expect(new Set(voiceoverCases.map(item => item.voiceoverLanguage)))
      .toEqual(new Set(PROMPT_WIZARD_V6_CANARY_LANGUAGES));
  });

  it('每批严格按 0/1/2 顺序交付产品自证、痛点钩子与场景种草三个角色', () => {
    const observations = PROMPT_WIZARD_V6_CANARY_CASES.map(runPromptWizardV6CanaryCase);
    for (const observation of observations) {
      expect(observation.plans.map(plan => plan.role)).toEqual(PROMPT_WIZARD_V6_ROUTE_ROLES);
      expect(observation.plans.map((_, index) => index)).toEqual([0, 1, 2]);
      expect(new Set(observation.plans.map(plan => plan.name)).size).toBe(3);
    }
  });

  it('镜头预算固定为 5 秒两镜、10 秒三镜、15 秒四镜', () => {
    const expectedShotCounts = new Map([[5, 2], [10, 3], [15, 4]]);
    const observations = PROMPT_WIZARD_V6_CANARY_CASES.map(runPromptWizardV6CanaryCase);
    for (const observation of observations) {
      expect(observation.plans.map(plan => plan.shots.length))
        .toEqual(Array(3).fill(expectedShotCounts.get(observation.durationSeconds)));
    }
  });

  it('5 秒无语言、口播、译文与优惠，10/15 秒仅把目标语言口播写入执行提示词', () => {
    const observations = PROMPT_WIZARD_V6_CANARY_CASES.map(runPromptWizardV6CanaryCase);
    for (const observation of observations) {
      for (const plan of observation.plans) {
        if (observation.audioMode === 'sound-design-only') {
          expect(observation.voiceoverLanguage).toBeNull();
          expect(plan.audioMode).toBe('sound-design-only');
          expect(plan.shots).toHaveLength(2);
          expect(plan.shots.every(shot => (
            shot.voiceover === '' && shot.voiceoverZh === ''
          ))).toBe(true);
          expect(plan.prompt).toContain(
            '无对白、无人声、无旁白；仅使用音乐、环境声和真实商品操作拟音。',
          );
          expect(plan.prompt).not.toContain('【口播');
          expect(plan.prompt).not.toContain(observation.verifiedOffer);
          continue;
        }
        expect(observation.voiceoverLanguage).not.toBeNull();
        expect(plan.audioMode).toBe('voiceover');
        expect(plan.shots.every(shot => shot.voiceover.length > 0)).toBe(true);
        if (observation.voiceoverLanguage !== '普通话') {
          expect(plan.shots.every(shot => shot.voiceoverZh.length > 0)).toBe(true);
          expect(plan.shots.every(shot => !plan.prompt.includes(shot.voiceoverZh))).toBe(true);
        } else {
          expect(plan.shots.every(shot => shot.voiceoverZh === '')).toBe(true);
        }
      }
    }
  });

  it('入口明确报告未连接真实 Provider，不输出真实质量通过结论', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(runPromptWizardV6Canary()).toEqual({
      completedBatchCount: 15,
      validatedPlanCount: 45,
      providerMode: 'deterministic-no-provider',
      realProviderCalled: false,
    });
    expect(write).toHaveBeenCalled();
    const output = write.mock.calls.map(call => String(call[0])).join('');
    expect(output).toContain('"realProviderCalled":false');
    expect(output).toContain('"providerMode":"deterministic-no-provider"');
    const caseEvents = output.trim().split('\n').map(line => JSON.parse(line)).filter(event => (
      event.event === 'prompt-wizard-v6-local-canary-case'
    ));
    expect(caseEvents.filter(event => event.audioMode === 'sound-design-only')).toHaveLength(5);
    expect(caseEvents.filter(event => event.audioMode === 'sound-design-only').every(event => (
      !Object.hasOwn(event, 'voiceoverLanguage')
    ))).toBe(true);
  });

  it('缺批次、缺角色或镜头预算漂移都会阻断', () => {
    const observations = PROMPT_WIZARD_V6_CANARY_CASES.map(runPromptWizardV6CanaryCase);
    expect(() => assertPromptWizardV6Canary(observations.slice(0, 14)))
      .toThrow(/15 个批次/u);
    expect(() => assertPromptWizardV6Canary([
      {
        ...observations[0]!,
        plans: observations[0]!.plans.map(plan => ({ ...plan, role: 'proof-conversion' })),
      },
      ...observations.slice(1),
    ] as never)).toThrow(/三个商业角色/u);
    expect(() => assertPromptWizardV6Canary([
      {
        ...observations[0]!,
        plans: observations[0]!.plans.map(plan => ({
          ...plan,
          shots: [...plan.shots, plan.shots[0]!],
        })),
      },
      ...observations.slice(1),
    ] as never)).toThrow(/镜头数/u);
  });
});
