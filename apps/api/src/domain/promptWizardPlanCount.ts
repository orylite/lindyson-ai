/**
 * V4/V5 历史生成链路固定返回的方案数量。
 *
 * 该别名暂时保留，避免仍在队列中的旧任务因为 V6 上线而改变行为；新任务
 * 必须显式使用 `PROMPT_WIZARD_V6_PLAN_COUNT`。
 */
export const PROMPT_WIZARD_PLAN_COUNT = 2 as const;
export const PROMPT_WIZARD_LEGACY_PLAN_COUNT = PROMPT_WIZARD_PLAN_COUNT;

/** V6 每个完成批次严格包含的三个商业角色。 */
export const PROMPT_WIZARD_V6_PLAN_COUNT = 3 as const;

/** V4/V5 历史链路仍只允许索引 0、1。 */
export const PROMPT_WIZARD_LEGACY_PLAN_INDEXES = [0, 1] as const;

/**
 * 历史公开别名继续只表示 V4/V5 的两个索引，避免旧编排和测试在升级后
 * 静默获得第三个索引。V6 必须显式使用下面的 V6 常量。
 */
export const PROMPT_WIZARD_PLAN_INDEXES = PROMPT_WIZARD_LEGACY_PLAN_INDEXES;
export const PROMPT_WIZARD_V6_PLAN_INDEXES = [0, 1, 2] as const;

/** Provider/成本元数据可覆盖历史与 V6 的全部索引。 */
export type PromptWizardPlanIndex = (typeof PROMPT_WIZARD_V6_PLAN_INDEXES)[number];

export function isPromptWizardPlanIndex(value: number): value is PromptWizardPlanIndex {
  return PROMPT_WIZARD_V6_PLAN_INDEXES.includes(value as PromptWizardPlanIndex);
}

export function isPromptWizardLegacyPlanIndex(
  value: number,
): value is (typeof PROMPT_WIZARD_LEGACY_PLAN_INDEXES)[number] {
  return PROMPT_WIZARD_LEGACY_PLAN_INDEXES.includes(
    value as (typeof PROMPT_WIZARD_LEGACY_PLAN_INDEXES)[number],
  );
}
