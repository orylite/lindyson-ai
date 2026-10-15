import type { DbClient } from '../db/pool.js';

export interface PromptWizardDailyMetricDelta {
  completedBatches?: number;
  appliedPlans?: number;
  noMaterialEditApplies?: number;
  refreshes?: number;
  refinements?: number;
  videoSuccesses?: number;
  videoFailures?: number;
  moderationFailures?: number;
}

/**
 * 只写匿名日级计数，不接收或保存 user/run/batch/asset 标识与内容正文。
 * 同一业务事件必须在其幂等状态迁移成功后、同一事务内调用。
 */
export async function incrementPromptWizardDailyMetricsWithClient(
  client: DbClient,
  engineVersion: 2 | 3 | 4,
  delta: PromptWizardDailyMetricDelta,
) {
  const values = [
    delta.completedBatches ?? 0,
    delta.appliedPlans ?? 0,
    delta.noMaterialEditApplies ?? 0,
    delta.refreshes ?? 0,
    delta.refinements ?? 0,
    delta.videoSuccesses ?? 0,
    delta.videoFailures ?? 0,
    delta.moderationFailures ?? 0,
  ];
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('提示词向导日指标增量必须为非负安全整数');
  }
  if (values.every(value => value === 0)) return;

  await client.query(
    `INSERT INTO prompt_wizard_daily_metrics (
       metric_date, engine_version, completed_batches, applied_plans,
       no_material_edit_applies, refreshes, refinements,
       video_successes, video_failures, moderation_failures
     )
     VALUES (
       (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date,
       $1, $2, $3, $4, $5, $6, $7, $8, $9
     )
     ON CONFLICT (metric_date, engine_version) DO UPDATE
     SET completed_batches = prompt_wizard_daily_metrics.completed_batches + EXCLUDED.completed_batches,
         applied_plans = prompt_wizard_daily_metrics.applied_plans + EXCLUDED.applied_plans,
         no_material_edit_applies = prompt_wizard_daily_metrics.no_material_edit_applies + EXCLUDED.no_material_edit_applies,
         refreshes = prompt_wizard_daily_metrics.refreshes + EXCLUDED.refreshes,
         refinements = prompt_wizard_daily_metrics.refinements + EXCLUDED.refinements,
         video_successes = prompt_wizard_daily_metrics.video_successes + EXCLUDED.video_successes,
         video_failures = prompt_wizard_daily_metrics.video_failures + EXCLUDED.video_failures,
         moderation_failures = prompt_wizard_daily_metrics.moderation_failures + EXCLUDED.moderation_failures,
         updated_at = now()`,
    [engineVersion, ...values],
  );
}
