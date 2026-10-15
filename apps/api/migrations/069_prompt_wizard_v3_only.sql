-- 提示词向导 3.0 独占运行：退役并清理 2.0 正文，保留财务、Provider 与匿名指标证据。
-- 本迁移必须在向导关闭且 worker 停止领取新任务后执行；遇到仍在运行或冻结积分的
-- 2.0 任务会整体失败，不擅自取消任务、结算或退款。

ALTER TABLE prompt_wizard_runs
  ADD COLUMN IF NOT EXISTS engine_version smallint;

-- 只推断尚未标记的历史行。重放时不得因为 2.0 正文已被清理而重新判断版本。
UPDATE prompt_wizard_runs run
SET engine_version = CASE
  WHEN run.evidence_graph IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM prompt_wizard_concept_sets concept_set
      WHERE concept_set.run_id = run.id
    )
    OR EXISTS (
      SELECT 1
      FROM prompt_wizard_batches batch
      WHERE batch.run_id = run.id
        AND jsonb_path_exists(
          COALESCE(batch.plans, '[]'::jsonb),
          '$[*] ? (@.deliveryVersion == 4)'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM prompt_wizard_plan_revisions revision
      WHERE revision.run_id = run.id
    )
  THEN 3
  ELSE 2
END
WHERE run.engine_version IS NULL;

ALTER TABLE prompt_wizard_runs
  ALTER COLUMN engine_version SET DEFAULT 3;
ALTER TABLE prompt_wizard_runs
  ALTER COLUMN engine_version SET NOT NULL;
ALTER TABLE prompt_wizard_runs
  DROP CONSTRAINT IF EXISTS prompt_wizard_runs_engine_version_check;
ALTER TABLE prompt_wizard_runs
  ADD CONSTRAINT prompt_wizard_runs_engine_version_check
  CHECK (engine_version IN (2, 3));

DO $prompt_wizard_v3_cutover_guard$
DECLARE
  active_run_id uuid;
  held_batch_id uuid;
BEGIN
  SELECT run.id INTO active_run_id
  FROM prompt_wizard_runs run
  WHERE run.engine_version = 2
    AND (
      run.status = 'analyzing'
      OR EXISTS (
        SELECT 1
        FROM prompt_wizard_batches batch
        WHERE batch.run_id = run.id
          AND batch.status IN ('queued', 'processing')
      )
      OR EXISTS (
        SELECT 1
        FROM prompt_wizard_provider_requests provider_request
        WHERE provider_request.run_id = run.id
          AND provider_request.request_status = 'started'
      )
    )
  ORDER BY run.created_at ASC, run.id ASC
  LIMIT 1;

  IF active_run_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 069 拒绝归档仍在运行的 2.0 任务：run=%',
      active_run_id;
  END IF;

  SELECT batch.id INTO held_batch_id
  FROM prompt_wizard_batches batch
  JOIN prompt_wizard_runs run ON run.id = batch.run_id
  WHERE run.engine_version = 2
    AND (
      batch.credit_status = 'held'
      OR EXISTS (
        SELECT 1
        FROM credit_allocations allocation
        WHERE allocation.related_prompt_batch_id = batch.id
          AND allocation.status = 'held'
      )
    )
  ORDER BY batch.created_at ASC, batch.id ASC
  LIMIT 1;

  IF held_batch_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 069 拒绝归档仍有冻结积分的 2.0 批次：batch=%',
      held_batch_id;
  END IF;
END
$prompt_wizard_v3_cutover_guard$;

-- 内容清理后的失败任务不再保留失败正文；状态与审计标识仍原样保留。
ALTER TABLE prompt_wizard_batches
  DROP CONSTRAINT IF EXISTS prompt_wizard_batches_failed_shape_check;
ALTER TABLE prompt_wizard_batches
  ADD CONSTRAINT prompt_wizard_batches_failed_shape_check CHECK (
    status <> 'failed'
    OR content_purged_at IS NOT NULL
    OR failure_reason IS NOT NULL
  );

ALTER TABLE prompt_wizard_concept_sets
  DROP CONSTRAINT IF EXISTS prompt_wizard_concept_sets_failed_shape_check;
ALTER TABLE prompt_wizard_concept_sets
  ADD CONSTRAINT prompt_wizard_concept_sets_failed_shape_check CHECK (
    status <> 'failed'
    OR content_purged_at IS NOT NULL
    OR failure_reason IS NOT NULL
  );

ALTER TABLE prompt_wizard_plan_revisions
  DROP CONSTRAINT IF EXISTS prompt_wizard_plan_revisions_failed_shape_check;
ALTER TABLE prompt_wizard_plan_revisions
  ADD CONSTRAINT prompt_wizard_plan_revisions_failed_shape_check CHECK (
    status <> 'failed'
    OR content_purged_at IS NOT NULL
    OR failure_reason IS NOT NULL
  );
ALTER TABLE prompt_wizard_plan_revisions
  DROP CONSTRAINT IF EXISTS prompt_wizard_plan_revisions_scene_check;
ALTER TABLE prompt_wizard_plan_revisions
  ADD CONSTRAINT prompt_wizard_plan_revisions_scene_check CHECK (
    content_purged_at IS NOT NULL
    OR (
      action = 'change-scene'
      AND replacement_scene IS NOT NULL
      AND btrim(replacement_scene) <> ''
    )
    OR (action <> 'change-scene' AND replacement_scene IS NULL)
  );

-- 先清理子表，再归档父任务。账本表、不可变成本证据、审计与匿名指标均不触碰。
UPDATE prompt_wizard_concept_sets concept_set
SET candidates = NULL,
    recommended_concept_ids = '{}'::uuid[],
    failure_reason = NULL,
    content_purged_at = COALESCE(concept_set.content_purged_at, now()),
    updated_at = now()
FROM prompt_wizard_runs run
WHERE run.id = concept_set.run_id
  AND run.engine_version = 2
  AND (
    concept_set.candidates IS NOT NULL
    OR cardinality(concept_set.recommended_concept_ids) <> 0
    OR concept_set.failure_reason IS NOT NULL
    OR concept_set.content_purged_at IS NULL
  );

UPDATE prompt_wizard_plan_revisions revision
SET plan = NULL,
    replacement_scene = NULL,
    failure_reason = NULL,
    content_purged_at = COALESCE(revision.content_purged_at, now()),
    updated_at = now()
FROM prompt_wizard_runs run
WHERE run.id = revision.run_id
  AND run.engine_version = 2
  AND (
    revision.plan IS NOT NULL
    OR revision.replacement_scene IS NOT NULL
    OR revision.failure_reason IS NOT NULL
    OR revision.content_purged_at IS NULL
  );

UPDATE prompt_wizard_batches batch
SET image_asset_ids = '{}'::uuid[],
    product_profile = '{}'::jsonb,
    creative_brief = '{}'::jsonb,
    video_config = '{}'::jsonb,
    plans = NULL,
    strategy_signatures = '[]'::jsonb,
    failure_reason = NULL,
    content_purged_at = COALESCE(batch.content_purged_at, now()),
    updated_at = now()
FROM prompt_wizard_runs run
WHERE run.id = batch.run_id
  AND run.engine_version = 2
  AND (
    cardinality(batch.image_asset_ids) <> 0
    OR batch.product_profile <> '{}'::jsonb
    OR batch.creative_brief <> '{}'::jsonb
    OR batch.video_config <> '{}'::jsonb
    OR batch.plans IS NOT NULL
    OR batch.strategy_signatures <> '[]'::jsonb
    OR batch.failure_reason IS NOT NULL
    OR batch.content_purged_at IS NULL
  );

UPDATE prompt_wizard_runs run
SET status = 'archived',
    image_asset_ids = '{}'::uuid[],
    product_profile = NULL,
    creative_brief = NULL,
    video_config = NULL,
    production_brief = NULL,
    evidence_graph = NULL,
    failure_reason = NULL,
    updated_at = now()
WHERE run.engine_version = 2
  AND (
    run.status <> 'archived'
    OR cardinality(run.image_asset_ids) <> 0
    OR run.product_profile IS NOT NULL
    OR run.creative_brief IS NOT NULL
    OR run.video_config IS NOT NULL
    OR run.production_brief IS NOT NULL
    OR run.evidence_graph IS NOT NULL
    OR run.failure_reason IS NOT NULL
  );

-- 旧版批次约束仍保留，另加不可被 Migration 059 重放放宽的 3.0 独占约束。
-- 069 已在生产部署，但仓库要求迁移脚本可以安全重放；当后续 070 已存在时，
-- 重放 069 不得把完成批次从 V4/V5 兼容约束降回 V4 独占。
ALTER TABLE prompt_wizard_batches
  DROP CONSTRAINT IF EXISTS prompt_wizard_batches_v3_only_completed_shape_check;
DO $prompt_wizard_forward_compatible_completed_shape$
BEGIN
  IF to_regclass('public.prompt_wizard_use_direction_sets') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'prompt_wizard_batches'
        AND column_name = 'use_direction_set_id'
    )
  THEN
    ALTER TABLE prompt_wizard_batches
      ADD CONSTRAINT prompt_wizard_batches_v3_only_completed_shape_check CHECK (
        status <> 'completed'
        OR content_purged_at IS NOT NULL
        OR (
          concept_set_id IS NOT NULL
          AND cardinality(selected_concept_ids) = 2
          AND selected_concept_ids[1] IS NOT NULL
          AND selected_concept_ids[2] IS NOT NULL
          AND selected_concept_ids[1] <> selected_concept_ids[2]
          AND use_direction_set_id IS NULL
          AND plans IS NOT NULL
          AND jsonb_typeof(plans) = 'array'
          AND jsonb_array_length(plans) = 2
          AND jsonb_path_exists(plans, '$[0] ? (@.deliveryVersion == 4)')
          AND jsonb_path_exists(plans, '$[1] ? (@.deliveryVersion == 4)')
        )
        OR (
          concept_set_id IS NULL
          AND cardinality(selected_concept_ids) = 0
          AND use_direction_set_id IS NOT NULL
          AND selected_use_direction_id IS NOT NULL
          AND ((selected_scene_id IS NULL) <> (custom_scene IS NULL))
          AND plans IS NOT NULL
          AND jsonb_typeof(plans) = 'array'
          AND jsonb_array_length(plans) = 2
          AND jsonb_path_exists(plans, '$[0] ? (@.deliveryVersion == 5)')
          AND jsonb_path_exists(plans, '$[1] ? (@.deliveryVersion == 5)')
        )
      );
  ELSE
    ALTER TABLE prompt_wizard_batches
      ADD CONSTRAINT prompt_wizard_batches_v3_only_completed_shape_check CHECK (
        status <> 'completed'
        OR content_purged_at IS NOT NULL
        OR (
          concept_set_id IS NOT NULL
          AND cardinality(selected_concept_ids) = 2
          AND selected_concept_ids[1] IS NOT NULL
          AND selected_concept_ids[2] IS NOT NULL
          AND selected_concept_ids[1] <> selected_concept_ids[2]
          AND plans IS NOT NULL
          AND jsonb_typeof(plans) = 'array'
          AND jsonb_array_length(plans) = 2
          AND jsonb_path_exists(plans, '$[0] ? (@.deliveryVersion == 4)')
          AND jsonb_path_exists(plans, '$[1] ? (@.deliveryVersion == 4)')
        )
      );
  END IF;
END
$prompt_wizard_forward_compatible_completed_shape$;

-- 全局只保留 3.0。运行时只可开关服务和调整刷新积分，不能回退引擎。
UPDATE prompt_wizard_settings
SET engine_version = 3,
    updated_at = CASE WHEN engine_version <> 3 THEN now() ELSE updated_at END
WHERE engine_version <> 3;
ALTER TABLE prompt_wizard_settings
  ALTER COLUMN engine_version SET DEFAULT 3;
ALTER TABLE prompt_wizard_settings
  DROP CONSTRAINT IF EXISTS prompt_wizard_settings_engine_version_check;
ALTER TABLE prompt_wizard_settings
  ADD CONSTRAINT prompt_wizard_settings_engine_version_check
  CHECK (engine_version = 3);

-- 历史 2.0 标记不可改写；迁移完成后的新增任务只能是 3.0。
CREATE OR REPLACE FUNCTION enforce_prompt_wizard_run_engine_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.engine_version <> 3 THEN
    RAISE EXCEPTION 'prompt_wizard_runs 新任务只能使用 3.0：run=%', NEW.id;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.engine_version IS DISTINCT FROM OLD.engine_version THEN
    RAISE EXCEPTION 'prompt_wizard_runs 引擎版本不可修改：run=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_prompt_wizard_run_engine_version
  ON prompt_wizard_runs;
CREATE TRIGGER trg_enforce_prompt_wizard_run_engine_version
BEFORE INSERT OR UPDATE OF engine_version ON prompt_wizard_runs
FOR EACH ROW EXECUTE FUNCTION enforce_prompt_wizard_run_engine_version();

CREATE INDEX IF NOT EXISTS idx_prompt_wizard_runs_engine_status
  ON prompt_wizard_runs(engine_version, status, created_at DESC);
