-- 提示词向导 3.0 简化版：产品使用方向集合、V5 批次来源与成本账本归属。
-- 历史 Concept Set、V4 方案及 Provider 成本流水保持原样，只读兼容且不回填。

CREATE TABLE IF NOT EXISTS prompt_wizard_use_direction_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES prompt_wizard_runs(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  run_revision integer NOT NULL CHECK (run_revision >= 0),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'needs-input', 'completed', 'failed')),
  directions jsonb,
  clarification_question text,
  clarification_count integer NOT NULL DEFAULT 0 CHECK (clarification_count BETWEEN 0 AND 1),
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
  CONSTRAINT prompt_wizard_use_direction_sets_completed_shape_check CHECK (
    status <> 'completed'
    OR content_purged_at IS NOT NULL
    OR (
      directions IS NOT NULL
      AND jsonb_typeof(directions) = 'array'
      AND jsonb_array_length(directions) BETWEEN 2 AND 3
      AND clarification_question IS NULL
    )
  ),
  CONSTRAINT prompt_wizard_use_direction_sets_needs_input_shape_check CHECK (
    status <> 'needs-input'
    OR content_purged_at IS NOT NULL
    OR (
      directions = '[]'::jsonb
      AND clarification_question = '请补充一个您确认真实、希望重点展示的用途或卖点。'
      AND clarification_count = 1
    )
  ),
  CONSTRAINT prompt_wizard_use_direction_sets_pending_shape_check CHECK (
    status NOT IN ('queued', 'processing', 'failed')
    OR content_purged_at IS NOT NULL
    OR (directions IS NULL AND clarification_question IS NULL)
  ),
  CONSTRAINT prompt_wizard_use_direction_sets_failed_shape_check CHECK (
    status <> 'failed' OR content_purged_at IS NOT NULL OR failure_reason IS NOT NULL
  ),
  CONSTRAINT prompt_wizard_use_direction_sets_purge_shape_check CHECK (
    content_purged_at IS NULL
    OR (directions IS NULL AND clarification_question IS NULL AND failure_reason IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_wizard_use_direction_sets_one_active
  ON prompt_wizard_use_direction_sets(run_id)
  WHERE status IN ('queued', 'processing');
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_use_direction_sets_run_created
  ON prompt_wizard_use_direction_sets(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_use_direction_sets_expiry
  ON prompt_wizard_use_direction_sets(expires_at)
  WHERE content_purged_at IS NULL;

CREATE OR REPLACE FUNCTION validate_prompt_wizard_use_direction_set()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_record prompt_wizard_runs%ROWTYPE;
  direction_item jsonb;
  scene_item jsonb;
BEGIN
  SELECT * INTO run_record
  FROM prompt_wizard_runs
  WHERE id = NEW.run_id;

  IF run_record.id IS NULL
    OR run_record.user_id <> NEW.user_id
    OR run_record.engine_version <> 3
  THEN
    RAISE EXCEPTION 'prompt_wizard_use_direction_sets 与 3.0 run 归属不一致：direction_set=%', NEW.id;
  END IF;

  IF NEW.status = 'completed' AND NEW.content_purged_at IS NULL THEN
    IF NEW.directions IS NULL OR jsonb_typeof(NEW.directions) <> 'array' THEN
      RAISE EXCEPTION 'prompt_wizard_use_direction_sets 完成结果必须为数组：direction_set=%', NEW.id;
    END IF;

    IF (
      SELECT count(DISTINCT item ->> 'id')
      FROM jsonb_array_elements(NEW.directions) AS item
    ) <> jsonb_array_length(NEW.directions) THEN
      RAISE EXCEPTION 'prompt_wizard_use_direction_sets 方向 id 必须唯一：direction_set=%', NEW.id;
    END IF;

    FOR direction_item IN SELECT value FROM jsonb_array_elements(NEW.directions) LOOP
      IF jsonb_typeof(direction_item -> 'sceneOptions') <> 'array'
        OR jsonb_array_length(direction_item -> 'sceneOptions') NOT BETWEEN 2 AND 3
      THEN
        RAISE EXCEPTION 'prompt_wizard_use_direction_sets 每个方向必须包含 2 至 3 个场景：direction_set=% direction=%',
          NEW.id, direction_item ->> 'id';
      END IF;

      IF (
        SELECT count(DISTINCT item ->> 'id')
        FROM jsonb_array_elements(direction_item -> 'sceneOptions') AS item
      ) <> jsonb_array_length(direction_item -> 'sceneOptions') THEN
        RAISE EXCEPTION 'prompt_wizard_use_direction_sets 场景 id 必须唯一：direction_set=% direction=%',
          NEW.id, direction_item ->> 'id';
      END IF;

      scene_item := NULL;
      SELECT item INTO scene_item
      FROM jsonb_array_elements(direction_item -> 'sceneOptions') AS item
      WHERE item ->> 'id' = direction_item ->> 'recommendedSceneId'
      LIMIT 1;
      IF scene_item IS NULL THEN
        RAISE EXCEPTION 'prompt_wizard_use_direction_sets 推荐场景不属于当前方向：direction_set=% direction=%',
          NEW.id, direction_item ->> 'id';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_use_direction_set
  ON prompt_wizard_use_direction_sets;
CREATE TRIGGER trg_validate_prompt_wizard_use_direction_set
BEFORE INSERT OR UPDATE ON prompt_wizard_use_direction_sets
FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_use_direction_set();

ALTER TABLE prompt_wizard_batches
  ADD COLUMN IF NOT EXISTS use_direction_set_id uuid;
ALTER TABLE prompt_wizard_batches
  ADD COLUMN IF NOT EXISTS selected_use_direction_id uuid;
ALTER TABLE prompt_wizard_batches
  ADD COLUMN IF NOT EXISTS selected_scene_id uuid;
ALTER TABLE prompt_wizard_batches
  ADD COLUMN IF NOT EXISTS custom_scene jsonb;
ALTER TABLE prompt_wizard_batches
  DROP CONSTRAINT IF EXISTS prompt_wizard_batches_use_direction_set_fk;
ALTER TABLE prompt_wizard_batches
  ADD CONSTRAINT prompt_wizard_batches_use_direction_set_fk
  FOREIGN KEY (use_direction_set_id)
  REFERENCES prompt_wizard_use_direction_sets(id) ON DELETE RESTRICT;

ALTER TABLE prompt_wizard_batches
  DROP CONSTRAINT IF EXISTS prompt_wizard_batches_concept_selection_check;
ALTER TABLE prompt_wizard_batches
  DROP CONSTRAINT IF EXISTS prompt_wizard_batches_source_selection_check;
ALTER TABLE prompt_wizard_batches
  ADD CONSTRAINT prompt_wizard_batches_source_selection_check CHECK (
    content_purged_at IS NOT NULL
    OR
    (
      concept_set_id IS NULL
      AND cardinality(selected_concept_ids) = 0
      AND use_direction_set_id IS NULL
      AND selected_use_direction_id IS NULL
      AND selected_scene_id IS NULL
      AND custom_scene IS NULL
    )
    OR (
      concept_set_id IS NOT NULL
      AND cardinality(selected_concept_ids) = 2
      AND selected_concept_ids[1] IS NOT NULL
      AND selected_concept_ids[2] IS NOT NULL
      AND selected_concept_ids[1] <> selected_concept_ids[2]
      AND use_direction_set_id IS NULL
      AND selected_use_direction_id IS NULL
      AND selected_scene_id IS NULL
      AND custom_scene IS NULL
    )
    OR (
      concept_set_id IS NULL
      AND cardinality(selected_concept_ids) = 0
      AND use_direction_set_id IS NOT NULL
      AND selected_use_direction_id IS NOT NULL
      AND ((selected_scene_id IS NULL) <> (custom_scene IS NULL))
      AND (
        custom_scene IS NULL
        OR (
          jsonb_typeof(custom_scene) = 'object'
          AND btrim(COALESCE(custom_scene ->> 'title', '')) <> ''
          AND btrim(COALESCE(custom_scene ->> 'environment', '')) <> ''
          AND btrim(COALESCE(custom_scene ->> 'mainAction', '')) <> ''
        )
      )
    )
  );
ALTER TABLE prompt_wizard_batches
  DROP CONSTRAINT IF EXISTS prompt_wizard_batches_use_direction_purge_check;
ALTER TABLE prompt_wizard_batches
  ADD CONSTRAINT prompt_wizard_batches_use_direction_purge_check CHECK (
    content_purged_at IS NULL OR custom_scene IS NULL
  );

CREATE INDEX IF NOT EXISTS idx_prompt_wizard_batches_use_direction_set
  ON prompt_wizard_batches(use_direction_set_id)
  WHERE use_direction_set_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_prompt_wizard_batch_use_direction_selection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  direction_set_record prompt_wizard_use_direction_sets%ROWTYPE;
  direction_item jsonb;
BEGIN
  -- 到期清理只删除业务正文，来源 id 继续保留用于财务与成本审计。
  -- 清理后的方向集合已不再可读，因此这里不能再反查其正文或场景。
  IF NEW.content_purged_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.use_direction_set_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO direction_set_record
  FROM prompt_wizard_use_direction_sets
  WHERE id = NEW.use_direction_set_id;

  IF direction_set_record.id IS NULL
    OR direction_set_record.run_id <> NEW.run_id
    OR direction_set_record.user_id <> NEW.user_id
    OR direction_set_record.run_revision <> NEW.run_revision
    OR direction_set_record.status <> 'completed'
    OR direction_set_record.content_purged_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'prompt_wizard_batches 使用方向集合不可用于当前批次：batch=% direction_set=%',
      NEW.id, NEW.use_direction_set_id;
  END IF;

  SELECT item INTO direction_item
  FROM jsonb_array_elements(direction_set_record.directions) AS item
  WHERE item ->> 'id' = NEW.selected_use_direction_id::text
  LIMIT 1;
  IF direction_item IS NULL THEN
    RAISE EXCEPTION 'prompt_wizard_batches 选择了集合外的使用方向：batch=% direction=%',
      NEW.id, NEW.selected_use_direction_id;
  END IF;

  IF NEW.selected_scene_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(direction_item -> 'sceneOptions') AS scene
    WHERE scene ->> 'id' = NEW.selected_scene_id::text
  ) THEN
    RAISE EXCEPTION 'prompt_wizard_batches 选择了方向外的场景：batch=% scene=%',
      NEW.id, NEW.selected_scene_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_batch_use_direction_selection
  ON prompt_wizard_batches;
CREATE TRIGGER trg_validate_prompt_wizard_batch_use_direction_selection
BEFORE INSERT OR UPDATE OF
  use_direction_set_id, selected_use_direction_id, selected_scene_id, custom_scene,
  run_id, user_id, run_revision
  ON prompt_wizard_batches
FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_batch_use_direction_selection();

-- 069 的 V4 独占约束改为历史 V4 与新 V5 两条互斥来源；新业务写入只能走 V5 分支。
ALTER TABLE prompt_wizard_batches
  DROP CONSTRAINT IF EXISTS prompt_wizard_batches_v3_only_completed_shape_check;
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

-- 单方案微调使用语义正确的来源 id；历史 V4 仍保留 concept_id。
ALTER TABLE prompt_wizard_plan_revisions
  ALTER COLUMN concept_id DROP NOT NULL;
ALTER TABLE prompt_wizard_plan_revisions
  ADD COLUMN IF NOT EXISTS use_direction_id uuid;
ALTER TABLE prompt_wizard_plan_revisions
  DROP CONSTRAINT IF EXISTS prompt_wizard_plan_revisions_source_check;
ALTER TABLE prompt_wizard_plan_revisions
  ADD CONSTRAINT prompt_wizard_plan_revisions_source_check CHECK (
    (concept_id IS NULL) <> (use_direction_id IS NULL)
  );
ALTER TABLE prompt_wizard_plan_revisions
  DROP CONSTRAINT IF EXISTS prompt_wizard_plan_revisions_completed_shape_check;
ALTER TABLE prompt_wizard_plan_revisions
  ADD CONSTRAINT prompt_wizard_plan_revisions_completed_shape_check CHECK (
    status <> 'completed'
    OR content_purged_at IS NOT NULL
    OR (
      plan IS NOT NULL
      AND jsonb_typeof(plan) = 'object'
      AND (
        (concept_id IS NOT NULL AND plan ->> 'deliveryVersion' = '4')
        OR (use_direction_id IS NOT NULL AND plan ->> 'deliveryVersion' = '5')
      )
    )
  );

CREATE OR REPLACE FUNCTION validate_prompt_wizard_plan_revision_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  batch_record prompt_wizard_batches%ROWTYPE;
  source_plan jsonb;
  source_delivery_version integer;
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

  SELECT item.plan INTO source_plan
  FROM jsonb_array_elements(batch_record.plans) WITH ORDINALITY AS item(plan, ordinal)
  WHERE item.plan ->> 'id' = NEW.source_plan_id::text
    AND item.ordinal = NEW.plan_index + 1
  LIMIT 1;
  IF source_plan IS NULL THEN
    RAISE EXCEPTION 'prompt_wizard_plan_revisions 原方案与索引不一致：revision=% plan=%',
      NEW.id, NEW.source_plan_id;
  END IF;

  source_delivery_version := (source_plan ->> 'deliveryVersion')::integer;
  IF source_delivery_version = 4 THEN
    IF NEW.concept_id IS NULL
      OR NEW.use_direction_id IS NOT NULL
      OR batch_record.concept_set_id IS NULL
      OR NOT (NEW.concept_id = ANY(batch_record.selected_concept_ids))
    THEN
      RAISE EXCEPTION 'prompt_wizard_plan_revisions V4 创意不属于原批次：revision=% concept=%',
        NEW.id, NEW.concept_id;
    END IF;
  ELSIF source_delivery_version = 5 THEN
    IF NEW.concept_id IS NOT NULL
      OR NEW.use_direction_id IS NULL
      OR batch_record.use_direction_set_id IS NULL
      OR NEW.use_direction_id <> batch_record.selected_use_direction_id
    THEN
      RAISE EXCEPTION 'prompt_wizard_plan_revisions V5 使用方向不属于原批次：revision=% direction=%',
        NEW.id, NEW.use_direction_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'prompt_wizard_plan_revisions 不支持的方案版本：revision=% version=%',
      NEW.id, source_delivery_version;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_plan_revision_owner
  ON prompt_wizard_plan_revisions;
CREATE TRIGGER trg_validate_prompt_wizard_plan_revision_owner
BEFORE INSERT OR UPDATE OF
  run_id, batch_id, user_id, source_plan_id, concept_id, use_direction_id, plan_index
  ON prompt_wizard_plan_revisions
FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_plan_revision_owner();

-- 新方向规划调用直接归属于 use_direction_set，账本 key 不再复用 run 级作用域。
ALTER TABLE prompt_wizard_provider_requests
  ADD COLUMN IF NOT EXISTS use_direction_set_id uuid;
ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_use_direction_set_fk;
ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_use_direction_set_fk
  FOREIGN KEY (use_direction_set_id)
  REFERENCES prompt_wizard_use_direction_sets(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_provider_requests_use_direction_set_created
  ON prompt_wizard_provider_requests(use_direction_set_id, created_at ASC, id ASC)
  WHERE use_direction_set_id IS NOT NULL;

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
      'generate-use-directions',
      'repair-use-directions',
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
      AND use_direction_set_id IS NULL
    )
    OR (
      operation IN ('generate-use-directions', 'repair-use-directions')
      AND batch_id IS NULL
      AND use_direction_set_id IS NOT NULL
    )
    OR (
      operation IN (
        'generate-drafts',
        'repair-draft-format',
        'repair-draft-content',
        'refine-plan'
      )
      AND batch_id IS NOT NULL
      AND use_direction_set_id IS NULL
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
        'repair-concept-set',
        'generate-use-directions',
        'repair-use-directions'
      )
      AND plan_index IS NULL
    )
  );

ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_use_direction_scope_check;
ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_use_direction_scope_check CHECK (
    (
      operation IN ('generate-use-directions', 'repair-use-directions')
      AND use_direction_set_id IS NOT NULL
      AND request_key LIKE ('use-direction-set:' || use_direction_set_id::text || ':%')
    )
    OR (
      operation NOT IN ('generate-use-directions', 'repair-use-directions')
      AND use_direction_set_id IS NULL
    )
  );

CREATE OR REPLACE FUNCTION validate_prompt_wizard_provider_use_direction_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  direction_set_record prompt_wizard_use_direction_sets%ROWTYPE;
BEGIN
  IF NEW.use_direction_set_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO direction_set_record
  FROM prompt_wizard_use_direction_sets
  WHERE id = NEW.use_direction_set_id;
  IF direction_set_record.id IS NULL
    OR direction_set_record.run_id <> NEW.run_id
    OR direction_set_record.user_id <> NEW.user_id
  THEN
    RAISE EXCEPTION 'prompt_wizard_provider_requests 与使用方向集合归属不一致：request=% direction_set=%',
      NEW.id, NEW.use_direction_set_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_provider_use_direction_owner
  ON prompt_wizard_provider_requests;
CREATE TRIGGER trg_validate_prompt_wizard_provider_use_direction_owner
BEFORE INSERT OR UPDATE OF use_direction_set_id, run_id, user_id
  ON prompt_wizard_provider_requests
FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_provider_use_direction_owner();

-- generation_tasks 的来源校验扩展到 V5；历史 V1–V4 语义保持不变。
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
    NEW.prompt_wizard_source ->> 'planRevisionId', ''
  )::uuid;
  NEW.prompt_wizard_engine_version := (NEW.prompt_wizard_source ->> 'engineVersion')::smallint;
  NEW.prompt_wizard_edit_bucket := NEW.prompt_wizard_source ->> 'editBucket';

  SELECT * INTO source_batch FROM prompt_wizard_batches WHERE id = NEW.prompt_wizard_batch_id;
  IF source_batch.id IS NULL
    OR source_batch.run_id <> NEW.prompt_wizard_run_id
    OR source_batch.user_id <> NEW.user_id
    OR source_batch.status <> 'completed'
    OR source_batch.content_purged_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'generation_tasks 提示词来源不属于当前用户的已完成批次：task=%', NEW.id;
  END IF;

  SELECT * INTO source_run FROM prompt_wizard_runs WHERE id = NEW.prompt_wizard_run_id;
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
    source_delivery_version IN (4, 5) AND NEW.prompt_wizard_engine_version <> 3
  ) OR (
    source_delivery_version BETWEEN 1 AND 3 AND NEW.prompt_wizard_engine_version <> 2
  ) OR source_delivery_version NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'generation_tasks 提示词版本与来源方案不一致：task=%', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- 新增 owner 后同步扩展不可变身份，终态成本、价格和用量仍只允许一次写入。
CREATE OR REPLACE FUNCTION preserve_prompt_wizard_provider_request_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'prompt_wizard_provider_requests 成本账本禁止删除：request=%', OLD.id;
  END IF;
  IF OLD.request_status <> 'started' THEN
    RAISE EXCEPTION 'prompt_wizard_provider_requests 终态禁止修改：request=%', OLD.id;
  END IF;
  IF NEW.request_status = 'started' THEN
    RAISE EXCEPTION 'prompt_wizard_provider_requests 只允许从 started 写入一次终态：request=%', OLD.id;
  END IF;
  IF ROW(
    NEW.id, NEW.request_key, NEW.run_id, NEW.batch_id, NEW.use_direction_set_id, NEW.user_id,
    NEW.operation, NEW.job_attempt, NEW.repair_round, NEW.plan_index,
    NEW.transport_attempt, NEW.provider, NEW.model, NEW.started_at, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.request_key, OLD.run_id, OLD.batch_id, OLD.use_direction_set_id, OLD.user_id,
    OLD.operation, OLD.job_attempt, OLD.repair_round, OLD.plan_index,
    OLD.transport_attempt, OLD.provider, OLD.model, OLD.started_at, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'prompt_wizard_provider_requests 业务身份禁止修改：request=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
