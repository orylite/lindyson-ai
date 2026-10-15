-- 提示词向导 3.0：证据图谱、创意导演、单方案微调、来源追踪与匿名日聚合。
-- 迁移保留 V1–V3 方案和既有成本账本，只为新链路增加可选字段与新表。

ALTER TABLE prompt_wizard_settings
  -- 既有正式单例在迁移时必须继续停留在 2.0，先积累短期基线；
  -- 新安装或后续新增行才默认 3.0，最终切换由管理端显式完成。
  ADD COLUMN IF NOT EXISTS engine_version smallint NOT NULL DEFAULT 2;
ALTER TABLE prompt_wizard_settings
  ALTER COLUMN engine_version SET DEFAULT 3;
ALTER TABLE prompt_wizard_settings
  DROP CONSTRAINT IF EXISTS prompt_wizard_settings_engine_version_check;
ALTER TABLE prompt_wizard_settings
  ADD CONSTRAINT prompt_wizard_settings_engine_version_check
  CHECK (engine_version IN (2, 3));

ALTER TABLE prompt_wizard_runs
  ADD COLUMN IF NOT EXISTS production_brief jsonb;
ALTER TABLE prompt_wizard_runs
  ADD COLUMN IF NOT EXISTS evidence_graph jsonb;
ALTER TABLE prompt_wizard_runs
  DROP CONSTRAINT IF EXISTS prompt_wizard_runs_v3_content_shape_check;
ALTER TABLE prompt_wizard_runs
  ADD CONSTRAINT prompt_wizard_runs_v3_content_shape_check CHECK (
    (
      production_brief IS NULL
      OR jsonb_typeof(production_brief) = 'object'
    )
    AND (
      evidence_graph IS NULL
      OR jsonb_typeof(evidence_graph) = 'object'
    )
    AND (
      status <> 'archived'
      OR (production_brief IS NULL AND evidence_graph IS NULL)
    )
  );

CREATE TABLE IF NOT EXISTS prompt_wizard_concept_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES prompt_wizard_runs(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  run_revision integer NOT NULL CHECK (run_revision >= 0),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  candidates jsonb,
  recommended_concept_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  failure_reason text,
  provider_model text,
  provider_interaction_id text,
  provider_input_tokens integer CHECK (provider_input_tokens IS NULL OR provider_input_tokens >= 0),
  provider_output_tokens integer CHECK (provider_output_tokens IS NULL OR provider_output_tokens >= 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  content_purged_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  CONSTRAINT prompt_wizard_concept_sets_completed_shape_check CHECK (
    status <> 'completed'
    OR content_purged_at IS NOT NULL
    OR (
      candidates IS NOT NULL
      AND jsonb_typeof(candidates) = 'array'
      AND jsonb_array_length(candidates) = 8
      AND cardinality(recommended_concept_ids) = 2
      AND recommended_concept_ids[1] <> recommended_concept_ids[2]
    )
  ),
  CONSTRAINT prompt_wizard_concept_sets_failed_shape_check CHECK (
    status <> 'failed' OR failure_reason IS NOT NULL
  ),
  CONSTRAINT prompt_wizard_concept_sets_purge_shape_check CHECK (
    content_purged_at IS NULL
    OR (candidates IS NULL AND cardinality(recommended_concept_ids) = 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_wizard_concept_sets_one_active
  ON prompt_wizard_concept_sets(run_id)
  WHERE status IN ('queued', 'processing');
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_concept_sets_run_created
  ON prompt_wizard_concept_sets(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_concept_sets_expiry
  ON prompt_wizard_concept_sets(expires_at)
  WHERE content_purged_at IS NULL;

CREATE OR REPLACE FUNCTION validate_prompt_wizard_concept_set()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_user_id uuid;
  recommended_id uuid;
BEGIN
  SELECT user_id INTO run_user_id
  FROM prompt_wizard_runs
  WHERE id = NEW.run_id;

  IF run_user_id IS NULL OR run_user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'prompt_wizard_concept_sets 与 run 用户归属不一致：concept_set=%', NEW.id;
  END IF;

  IF NEW.status = 'completed' AND NEW.content_purged_at IS NULL THEN
    IF (
      SELECT count(DISTINCT item ->> 'id')
      FROM jsonb_array_elements(NEW.candidates) AS item
    ) <> 8 THEN
      RAISE EXCEPTION 'prompt_wizard_concept_sets 候选 id 必须唯一：concept_set=%', NEW.id;
    END IF;

    IF (
      SELECT count(*)
      FROM jsonb_array_elements(NEW.candidates) AS item
      WHERE item ->> 'role' = 'reliable-conversion'
    ) <> 4 OR (
      SELECT count(*)
      FROM jsonb_array_elements(NEW.candidates) AS item
      WHERE item ->> 'role' = 'creative-breakthrough'
    ) <> 4 THEN
      RAISE EXCEPTION 'prompt_wizard_concept_sets 必须包含 4+4 两类创意：concept_set=%', NEW.id;
    END IF;

    FOREACH recommended_id IN ARRAY NEW.recommended_concept_ids LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(NEW.candidates) AS item
        WHERE item ->> 'id' = recommended_id::text
      ) THEN
        RAISE EXCEPTION 'prompt_wizard_concept_sets 推荐候选不属于候选集合：concept_set=% concept=%',
          NEW.id, recommended_id;
      END IF;
    END LOOP;

    IF (
      SELECT count(DISTINCT item ->> 'role')
      FROM jsonb_array_elements(NEW.candidates) AS item
      WHERE item ->> 'id' IN (
        SELECT selected.recommended_id::text
        FROM unnest(NEW.recommended_concept_ids) AS selected(recommended_id)
      )
    ) <> 2 THEN
      RAISE EXCEPTION 'prompt_wizard_concept_sets 推荐项必须分别来自两种路线：concept_set=%', NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_concept_set
  ON prompt_wizard_concept_sets;
CREATE TRIGGER trg_validate_prompt_wizard_concept_set
BEFORE INSERT OR UPDATE ON prompt_wizard_concept_sets
FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_concept_set();

ALTER TABLE prompt_wizard_batches
  ADD COLUMN IF NOT EXISTS concept_set_id uuid;
ALTER TABLE prompt_wizard_batches
  ADD COLUMN IF NOT EXISTS selected_concept_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
ALTER TABLE prompt_wizard_batches
  DROP CONSTRAINT IF EXISTS prompt_wizard_batches_concept_set_fk;
ALTER TABLE prompt_wizard_batches
  ADD CONSTRAINT prompt_wizard_batches_concept_set_fk
  FOREIGN KEY (concept_set_id) REFERENCES prompt_wizard_concept_sets(id) ON DELETE RESTRICT;
ALTER TABLE prompt_wizard_batches
  DROP CONSTRAINT IF EXISTS prompt_wizard_batches_concept_selection_check;
ALTER TABLE prompt_wizard_batches
  ADD CONSTRAINT prompt_wizard_batches_concept_selection_check CHECK (
    (concept_set_id IS NULL AND cardinality(selected_concept_ids) = 0)
    OR (
      concept_set_id IS NOT NULL
      AND cardinality(selected_concept_ids) = 2
      AND selected_concept_ids[1] <> selected_concept_ids[2]
    )
  );
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_batches_concept_set
  ON prompt_wizard_batches(concept_set_id)
  WHERE concept_set_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_prompt_wizard_batch_concept_selection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  concept_set_record prompt_wizard_concept_sets%ROWTYPE;
  selected_id uuid;
BEGIN
  IF NEW.concept_set_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO concept_set_record
  FROM prompt_wizard_concept_sets
  WHERE id = NEW.concept_set_id;

  IF concept_set_record.id IS NULL
    OR concept_set_record.run_id <> NEW.run_id
    OR concept_set_record.user_id <> NEW.user_id
    OR concept_set_record.run_revision <> NEW.run_revision
    OR concept_set_record.status <> 'completed'
    OR concept_set_record.content_purged_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'prompt_wizard_batches 创意集合不可用于当前批次：batch=% concept_set=%',
      NEW.id, NEW.concept_set_id;
  END IF;

  FOREACH selected_id IN ARRAY NEW.selected_concept_ids LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(concept_set_record.candidates) AS item
      WHERE item ->> 'id' = selected_id::text
    ) THEN
      RAISE EXCEPTION 'prompt_wizard_batches 选择了集合外的创意：batch=% concept=%',
        NEW.id, selected_id;
    END IF;
  END LOOP;

  IF (
    SELECT count(DISTINCT item ->> 'role')
    FROM jsonb_array_elements(concept_set_record.candidates) AS item
    WHERE item ->> 'id' IN (
      SELECT selected.selected_id::text
      FROM unnest(NEW.selected_concept_ids) AS selected(selected_id)
    )
  ) <> 2 THEN
    RAISE EXCEPTION 'prompt_wizard_batches 必须各选择一条可信转化型与强钩子型路线：batch=%',
      NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_batch_concept_selection
  ON prompt_wizard_batches;
CREATE TRIGGER trg_validate_prompt_wizard_batch_concept_selection
BEFORE INSERT OR UPDATE OF concept_set_id, selected_concept_ids, run_id, user_id, run_revision
  ON prompt_wizard_batches
FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_batch_concept_selection();

CREATE TABLE IF NOT EXISTS prompt_wizard_plan_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES prompt_wizard_runs(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES prompt_wizard_batches(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_plan_id uuid NOT NULL,
  concept_id uuid NOT NULL,
  plan_index integer NOT NULL CHECK (plan_index BETWEEN 0 AND 1),
  action text NOT NULL CHECK (
    action IN (
      'stronger-hook',
      'less-ad-like',
      'no-face',
      'product-only',
      'change-scene',
      'simplify-production',
      'natural-voiceover'
    )
  ),
  replacement_scene text,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  is_free boolean NOT NULL DEFAULT true,
  plan jsonb,
  failure_reason text,
  provider_model text,
  provider_interaction_id text,
  provider_input_tokens integer CHECK (provider_input_tokens IS NULL OR provider_input_tokens >= 0),
  provider_output_tokens integer CHECK (provider_output_tokens IS NULL OR provider_output_tokens >= 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  content_purged_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  CONSTRAINT prompt_wizard_plan_revisions_scene_check CHECK (
    (action = 'change-scene' AND replacement_scene IS NOT NULL AND btrim(replacement_scene) <> '')
    OR (action <> 'change-scene' AND replacement_scene IS NULL)
  ),
  CONSTRAINT prompt_wizard_plan_revisions_completed_shape_check CHECK (
    status <> 'completed'
    OR content_purged_at IS NOT NULL
    OR (plan IS NOT NULL AND jsonb_typeof(plan) = 'object')
  ),
  CONSTRAINT prompt_wizard_plan_revisions_failed_shape_check CHECK (
    status <> 'failed' OR failure_reason IS NOT NULL
  ),
  CONSTRAINT prompt_wizard_plan_revisions_purge_shape_check CHECK (
    content_purged_at IS NULL OR plan IS NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_wizard_plan_revisions_one_active
  ON prompt_wizard_plan_revisions(batch_id)
  WHERE status IN ('queued', 'processing');
DROP INDEX IF EXISTS idx_prompt_wizard_plan_revisions_one_free;
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_wizard_plan_revisions_one_free
  ON prompt_wizard_plan_revisions(batch_id)
  WHERE is_free AND status <> 'failed';
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_plan_revisions_batch_created
  ON prompt_wizard_plan_revisions(batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_plan_revisions_expiry
  ON prompt_wizard_plan_revisions(expires_at)
  WHERE content_purged_at IS NULL;

CREATE OR REPLACE FUNCTION validate_prompt_wizard_plan_revision_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  batch_record prompt_wizard_batches%ROWTYPE;
BEGIN
  SELECT * INTO batch_record
  FROM prompt_wizard_batches
  WHERE id = NEW.batch_id;

  IF batch_record.id IS NULL
    OR batch_record.run_id <> NEW.run_id
    OR batch_record.user_id <> NEW.user_id
    OR batch_record.status <> 'completed'
    OR batch_record.content_purged_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'prompt_wizard_plan_revisions 与已完成批次归属不一致：revision=%', NEW.id;
  END IF;

  IF batch_record.concept_set_id IS NULL
    OR NOT (NEW.concept_id = ANY(batch_record.selected_concept_ids))
  THEN
    RAISE EXCEPTION 'prompt_wizard_plan_revisions 创意不属于原批次：revision=% concept=%',
      NEW.id, NEW.concept_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(batch_record.plans) WITH ORDINALITY AS item(plan, ordinal)
    WHERE item.plan ->> 'id' = NEW.source_plan_id::text
      AND item.ordinal = NEW.plan_index + 1
  ) THEN
    RAISE EXCEPTION 'prompt_wizard_plan_revisions 原方案与索引不一致：revision=% plan=%',
      NEW.id, NEW.source_plan_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_plan_revision_owner
  ON prompt_wizard_plan_revisions;
CREATE TRIGGER trg_validate_prompt_wizard_plan_revision_owner
BEFORE INSERT OR UPDATE OF run_id, batch_id, user_id, source_plan_id, concept_id, plan_index
  ON prompt_wizard_plan_revisions
FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_plan_revision_owner();

-- 新操作延续现有不可变 Provider 成本账本；创意集合归属于 run，方案微调归属于 batch/plan。
ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_operation_check;
ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_operation_check CHECK (
    operation IN (
      'analyze-product',
      'repair-product-chinese',
      'repair-product-profile',
      'repair-product-format',
      'generate-concepts',
      'repair-concept-set',
      'generate-drafts',
      'repair-draft-format',
      'repair-draft-content',
      'refine-plan'
    )
  );

ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_owner_shape_check;
ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_owner_shape_check CHECK (
    (
      operation IN (
        'analyze-product',
        'repair-product-chinese',
        'repair-product-profile',
        'repair-product-format',
        'generate-concepts',
        'repair-concept-set'
      )
      AND batch_id IS NULL
    )
    OR (
      operation IN (
        'generate-drafts',
        'repair-draft-format',
        'repair-draft-content',
        'refine-plan'
      )
      AND batch_id IS NOT NULL
    )
  );

ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_plan_shape_check;
ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_plan_shape_check CHECK (
    (
      operation IN (
        'generate-drafts',
        'repair-draft-format',
        'repair-draft-content',
        'refine-plan'
      )
      AND plan_index IS NOT NULL
    )
    OR (
      operation IN (
        'analyze-product',
        'repair-product-chinese',
        'repair-product-profile',
        'repair-product-format',
        'generate-concepts',
        'repair-concept-set'
      )
      AND plan_index IS NULL
    )
  );

-- 应用方案后的视频任务仅保存不可变来源标识，不复制产品、概念或提示词正文。
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS prompt_wizard_source jsonb;
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS prompt_wizard_run_id uuid;
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS prompt_wizard_batch_id uuid;
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS prompt_wizard_plan_id uuid;
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS prompt_wizard_plan_revision_id uuid;
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS prompt_wizard_engine_version smallint;
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS prompt_wizard_edit_bucket text;

CREATE OR REPLACE FUNCTION sync_generation_task_prompt_wizard_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_batch prompt_wizard_batches%ROWTYPE;
  source_run prompt_wizard_runs%ROWTYPE;
  source_revision prompt_wizard_plan_revisions%ROWTYPE;
  source_plan jsonb;
  source_delivery_version integer;
BEGIN
  IF NEW.prompt_wizard_source IS NULL THEN
    NEW.prompt_wizard_run_id := NULL;
    NEW.prompt_wizard_batch_id := NULL;
    NEW.prompt_wizard_plan_id := NULL;
    NEW.prompt_wizard_plan_revision_id := NULL;
    NEW.prompt_wizard_engine_version := NULL;
    NEW.prompt_wizard_edit_bucket := NULL;
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.prompt_wizard_source) <> 'object' THEN
    RAISE EXCEPTION 'generation_tasks.prompt_wizard_source 必须为 JSON 对象：task=%', NEW.id;
  END IF;

  NEW.prompt_wizard_run_id := (NEW.prompt_wizard_source ->> 'runId')::uuid;
  NEW.prompt_wizard_batch_id := (NEW.prompt_wizard_source ->> 'batchId')::uuid;
  NEW.prompt_wizard_plan_id := (NEW.prompt_wizard_source ->> 'planId')::uuid;
  NEW.prompt_wizard_plan_revision_id := NULLIF(
    NEW.prompt_wizard_source ->> 'planRevisionId',
    ''
  )::uuid;
  NEW.prompt_wizard_engine_version := (NEW.prompt_wizard_source ->> 'engineVersion')::smallint;
  NEW.prompt_wizard_edit_bucket := NEW.prompt_wizard_source ->> 'editBucket';

  SELECT * INTO source_batch
  FROM prompt_wizard_batches
  WHERE id = NEW.prompt_wizard_batch_id;
  IF source_batch.id IS NULL
    OR source_batch.run_id <> NEW.prompt_wizard_run_id
    OR source_batch.user_id <> NEW.user_id
    OR source_batch.status <> 'completed'
    OR source_batch.content_purged_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'generation_tasks 提示词来源不属于当前用户的已完成批次：task=%', NEW.id;
  END IF;

  SELECT * INTO source_run
  FROM prompt_wizard_runs
  WHERE id = NEW.prompt_wizard_run_id;
  IF source_run.id IS NULL
    OR source_run.user_id <> NEW.user_id
    OR source_run.status = 'archived'
    OR source_run.expires_at <= now()
  THEN
    RAISE EXCEPTION 'generation_tasks 提示词来源已超过 24 小时有效期：task=%', NEW.id;
  END IF;

  IF NEW.prompt_wizard_plan_revision_id IS NULL THEN
    SELECT item INTO source_plan
    FROM jsonb_array_elements(source_batch.plans) AS item
    WHERE item ->> 'id' = NEW.prompt_wizard_plan_id::text
    LIMIT 1;
    IF source_plan IS NULL THEN
      RAISE EXCEPTION 'generation_tasks 提示词方案不属于来源批次：task=% plan=%',
        NEW.id, NEW.prompt_wizard_plan_id;
    END IF;
  ELSE
    SELECT * INTO source_revision
    FROM prompt_wizard_plan_revisions
    WHERE id = NEW.prompt_wizard_plan_revision_id;
    IF source_revision.id IS NULL
      OR source_revision.batch_id <> NEW.prompt_wizard_batch_id
      OR source_revision.user_id <> NEW.user_id
      OR source_revision.status <> 'completed'
      OR source_revision.content_purged_at IS NOT NULL
      OR source_revision.plan IS NULL
      OR (source_revision.plan ->> 'id') IS DISTINCT FROM NEW.prompt_wizard_plan_id::text
    THEN
      RAISE EXCEPTION 'generation_tasks 提示词微调版本与来源不一致：task=%', NEW.id;
    END IF;
    source_plan := source_revision.plan;
  END IF;

  source_delivery_version := COALESCE((source_plan ->> 'deliveryVersion')::integer, 1);
  IF (
    source_delivery_version = 4 AND NEW.prompt_wizard_engine_version <> 3
  ) OR (
    source_delivery_version BETWEEN 1 AND 3 AND NEW.prompt_wizard_engine_version <> 2
  ) OR source_delivery_version NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'generation_tasks 提示词版本与来源方案不一致：task=%', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_generation_task_prompt_wizard_source
  ON generation_tasks;
CREATE TRIGGER trg_sync_generation_task_prompt_wizard_source
BEFORE INSERT OR UPDATE OF prompt_wizard_source ON generation_tasks
FOR EACH ROW EXECUTE FUNCTION sync_generation_task_prompt_wizard_source();

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_prompt_wizard_run_fk;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_prompt_wizard_run_fk
  FOREIGN KEY (prompt_wizard_run_id) REFERENCES prompt_wizard_runs(id) ON DELETE RESTRICT;
ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_prompt_wizard_batch_fk;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_prompt_wizard_batch_fk
  FOREIGN KEY (prompt_wizard_batch_id) REFERENCES prompt_wizard_batches(id) ON DELETE RESTRICT;
ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_prompt_wizard_revision_fk;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_prompt_wizard_revision_fk
  FOREIGN KEY (prompt_wizard_plan_revision_id) REFERENCES prompt_wizard_plan_revisions(id) ON DELETE RESTRICT;
ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_prompt_wizard_source_check;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_prompt_wizard_source_check CHECK (
    (
      prompt_wizard_source IS NULL
      AND prompt_wizard_run_id IS NULL
      AND prompt_wizard_batch_id IS NULL
      AND prompt_wizard_plan_id IS NULL
      AND prompt_wizard_plan_revision_id IS NULL
      AND prompt_wizard_engine_version IS NULL
      AND prompt_wizard_edit_bucket IS NULL
    )
    OR (
      kind = 'video'
      AND prompt_wizard_source IS NOT NULL
      AND jsonb_typeof(prompt_wizard_source) = 'object'
      AND prompt_wizard_run_id IS NOT NULL
      AND prompt_wizard_batch_id IS NOT NULL
      AND prompt_wizard_plan_id IS NOT NULL
      AND prompt_wizard_engine_version IN (2, 3)
      AND prompt_wizard_edit_bucket IN ('none', 'minor', 'material')
    )
  );

CREATE INDEX IF NOT EXISTS idx_generation_tasks_prompt_wizard_batch
  ON generation_tasks(prompt_wizard_batch_id, created_at DESC)
  WHERE prompt_wizard_batch_id IS NOT NULL;

-- 只保留不可回溯到用户、run、图片或正文的日级聚合。
CREATE TABLE IF NOT EXISTS prompt_wizard_daily_metrics (
  metric_date date NOT NULL,
  engine_version smallint NOT NULL CHECK (engine_version IN (2, 3)),
  completed_batches bigint NOT NULL DEFAULT 0 CHECK (completed_batches >= 0),
  applied_plans bigint NOT NULL DEFAULT 0 CHECK (applied_plans >= 0),
  no_material_edit_applies bigint NOT NULL DEFAULT 0 CHECK (no_material_edit_applies >= 0),
  refreshes bigint NOT NULL DEFAULT 0 CHECK (refreshes >= 0),
  refinements bigint NOT NULL DEFAULT 0 CHECK (refinements >= 0),
  video_successes bigint NOT NULL DEFAULT 0 CHECK (video_successes >= 0),
  video_failures bigint NOT NULL DEFAULT 0 CHECK (video_failures >= 0),
  moderation_failures bigint NOT NULL DEFAULT 0 CHECK (moderation_failures >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_date, engine_version)
);

COMMENT ON TABLE prompt_wizard_daily_metrics IS
  '提示词向导匿名日级质量指标；禁止加入 user/run/batch/asset 外键或任何产品、概念、提示词正文。';
