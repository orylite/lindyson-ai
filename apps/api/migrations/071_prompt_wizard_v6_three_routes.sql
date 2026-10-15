-- 提示词向导 V6：引擎 4、内部三路线集合与三个成片方案。
-- V4/V5 正文、历史来源、积分流水和 Provider 成本账本均保持只读兼容，不做回填。

-- 本文件由迁移器放在单个事务内执行。限制等待锁与单条语句执行时间，避免发布时
-- 无限占用迁移 advisory lock；任何超时、前置状态漂移或后续 DDL 失败都会整体回滚。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
LOCK TABLE prompt_wizard_settings IN SHARE ROW EXCLUSIVE MODE;

-- 首次正式升级只接受唯一单例的 3|false。050 的全新安装初始值仍是 3|true，
-- 因此只在没有用户、任务、批次和 Provider 请求的可证明空库中接受该 bootstrap
-- 状态；非空库绝不借此静默开放。SQL 重放只接受完整 071 目标结构的 4|false。
DO $prompt_wizard_v6_cutover_guard$
DECLARE
  settings_count bigint;
  settings_engine smallint;
  settings_available boolean;
  bootstrap_empty boolean;
  replay_complete boolean;
BEGIN
  SELECT count(*) INTO settings_count
  FROM prompt_wizard_settings;

  IF settings_count <> 1 THEN
    RAISE EXCEPTION
      'Migration 071 拒绝非单例配置：prompt_wizard_settings_count=%',
      settings_count;
  END IF;

  SELECT engine_version, available
  INTO settings_engine, settings_available
  FROM prompt_wizard_settings
  WHERE singleton_id = 1;

  IF settings_engine = 3 AND settings_available = false THEN
    RETURN;
  END IF;

  bootstrap_empty := settings_engine = 3
    AND settings_available = true
    AND NOT EXISTS (SELECT 1 FROM users)
    AND NOT EXISTS (SELECT 1 FROM prompt_wizard_runs)
    AND NOT EXISTS (SELECT 1 FROM prompt_wizard_batches)
    AND NOT EXISTS (SELECT 1 FROM prompt_wizard_provider_requests);
  IF bootstrap_empty THEN
    RETURN;
  END IF;

  replay_complete := settings_engine = 4
    AND settings_available = false
    AND to_regclass('public.prompt_wizard_route_sets') IS NOT NULL
    AND (
      SELECT count(*) = 20
      FROM pg_attribute attribute
      WHERE attribute.attrelid = to_regclass('public.prompt_wizard_route_sets')
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    )
    AND NOT EXISTS (
      SELECT required.column_name
      FROM (VALUES
        ('id', 'uuid', true),
        ('run_id', 'uuid', true),
        ('user_id', 'uuid', true),
        ('idempotency_key', 'text', true),
        ('request_hash', 'text', true),
        ('run_revision', 'integer', true),
        ('status', 'text', true),
        ('routes', 'jsonb', false),
        ('failure_reason', 'text', false),
        ('provider_model', 'text', false),
        ('provider_interaction_id', 'text', false),
        ('provider_input_tokens', 'integer', false),
        ('provider_output_tokens', 'integer', false),
        ('attempt_count', 'integer', true),
        ('content_purged_at', 'timestamp with time zone', false),
        ('expires_at', 'timestamp with time zone', true),
        ('started_at', 'timestamp with time zone', false),
        ('completed_at', 'timestamp with time zone', false),
        ('created_at', 'timestamp with time zone', true),
        ('updated_at', 'timestamp with time zone', true)
      ) AS required(column_name, data_type, not_null)
      WHERE NOT EXISTS (
        SELECT 1
        FROM information_schema.columns column_definition
        WHERE column_definition.table_schema = 'public'
          AND column_definition.table_name = 'prompt_wizard_route_sets'
          AND column_definition.column_name = required.column_name
          AND column_definition.data_type = required.data_type
          AND (column_definition.is_nullable = 'NO') = required.not_null
      )
    )
    AND (
      SELECT count(*) = 6
      FROM pg_attrdef default_definition
      WHERE default_definition.adrelid = to_regclass(
        'public.prompt_wizard_route_sets'
      )
    )
    AND NOT EXISTS (
      SELECT required.column_name
      FROM (VALUES
        ('id', ARRAY['gen_random_uuid']::text[]),
        ('status', ARRAY['''queued''::text']::text[]),
        ('attempt_count', ARRAY['0']::text[]),
        ('expires_at', ARRAY[
          'now+''24:00:00''::interval',
          'now+''1day''::interval',
          'now+''24hours''::interval'
        ]::text[]),
        ('created_at', ARRAY['now']::text[]),
        ('updated_at', ARRAY['now']::text[])
      ) AS required(column_name, accepted_defaults)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_attribute attribute
        JOIN pg_attrdef default_definition
          ON default_definition.adrelid = attribute.attrelid
         AND default_definition.adnum = attribute.attnum
        WHERE attribute.attrelid = to_regclass(
            'public.prompt_wizard_route_sets'
          )
          AND attribute.attname = required.column_name
          AND NOT attribute.attisdropped
          AND regexp_replace(
            pg_get_expr(default_definition.adbin, default_definition.adrelid),
            '[[:space:]()]', '', 'g'
          ) = ANY(required.accepted_defaults)
      )
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'prompt_wizard_batches'
        AND column_name = 'route_set_id'
        AND data_type = 'uuid'
        AND is_nullable = 'YES'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'prompt_wizard_provider_requests'
        AND column_name = 'route_set_id'
        AND data_type = 'uuid'
        AND is_nullable = 'YES'
    )
    AND (
      SELECT count(*) = 13
      FROM pg_constraint constraint_definition
      WHERE constraint_definition.conrelid = to_regclass(
        'public.prompt_wizard_route_sets'
      )
    )
    AND NOT EXISTS (
      SELECT required.constraint_name
      FROM (VALUES
        ('prompt_wizard_runs_engine_version_check', 'prompt_wizard_runs', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_settings_engine_version_check', 'prompt_wizard_settings', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_daily_metrics_engine_version_check', 'prompt_wizard_daily_metrics', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_route_sets_pkey', 'prompt_wizard_route_sets', 'p', NULL::text, ARRAY['id']::text[]),
        ('prompt_wizard_route_sets_run_id_fkey', 'prompt_wizard_route_sets', 'f', 'prompt_wizard_runs', ARRAY['run_id']::text[]),
        ('prompt_wizard_route_sets_user_id_fkey', 'prompt_wizard_route_sets', 'f', 'users', ARRAY['user_id']::text[]),
        ('prompt_wizard_route_sets_user_id_idempotency_key_key', 'prompt_wizard_route_sets', 'u', NULL::text, ARRAY['user_id', 'idempotency_key']::text[]),
        ('prompt_wizard_route_sets_run_revision_check', 'prompt_wizard_route_sets', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_route_sets_status_check', 'prompt_wizard_route_sets', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_route_sets_provider_input_tokens_check', 'prompt_wizard_route_sets', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_route_sets_provider_output_tokens_check', 'prompt_wizard_route_sets', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_route_sets_attempt_count_check', 'prompt_wizard_route_sets', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_route_sets_completed_shape_check', 'prompt_wizard_route_sets', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_route_sets_pending_shape_check', 'prompt_wizard_route_sets', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_route_sets_failed_shape_check', 'prompt_wizard_route_sets', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_route_sets_purge_shape_check', 'prompt_wizard_route_sets', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_batches_route_set_fk', 'prompt_wizard_batches', 'f', 'prompt_wizard_route_sets', ARRAY['route_set_id']::text[]),
        ('prompt_wizard_batches_source_selection_check', 'prompt_wizard_batches', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_batches_completed_shape_check', 'prompt_wizard_batches', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_batches_v3_only_completed_shape_check', 'prompt_wizard_batches', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_provider_requests_route_set_fk', 'prompt_wizard_provider_requests', 'f', 'prompt_wizard_route_sets', ARRAY['route_set_id']::text[]),
        ('prompt_wizard_provider_requests_operation_check', 'prompt_wizard_provider_requests', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_provider_requests_repair_round_check', 'prompt_wizard_provider_requests', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_provider_requests_owner_shape_check', 'prompt_wizard_provider_requests', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_provider_requests_plan_shape_check', 'prompt_wizard_provider_requests', 'c', NULL::text, NULL::text[]),
        ('prompt_wizard_provider_requests_route_scope_check', 'prompt_wizard_provider_requests', 'c', NULL::text, NULL::text[]),
        ('generation_tasks_prompt_wizard_source_check', 'generation_tasks', 'c', NULL::text, NULL::text[])
      ) AS required(
        constraint_name, relation_name, constraint_type,
        referenced_relation_name, constrained_columns
      )
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_constraint constraint_definition
        WHERE constraint_definition.conname = required.constraint_name
          AND constraint_definition.conrelid = to_regclass('public.' || required.relation_name)
          AND constraint_definition.contype::text = required.constraint_type
          AND constraint_definition.convalidated
          AND obj_description(constraint_definition.oid, 'pg_constraint') =
            'migration071-definition:' || md5(
              pg_get_constraintdef(constraint_definition.oid, true)
            )
          AND (
            required.referenced_relation_name IS NULL
            OR (
              constraint_definition.confrelid = to_regclass(
                'public.' || required.referenced_relation_name
              )
              AND constraint_definition.confupdtype = 'a'
              AND constraint_definition.confdeltype = 'r'
              AND NOT constraint_definition.condeferrable
              AND NOT constraint_definition.condeferred
            )
          )
          AND (
            required.constrained_columns IS NULL
            OR ARRAY(
              SELECT constrained_attribute.attname::text
              FROM unnest(constraint_definition.conkey) WITH ORDINALITY
                AS constrained_key(attnum, key_position)
              JOIN pg_attribute constrained_attribute
                ON constrained_attribute.attrelid = constraint_definition.conrelid
               AND constrained_attribute.attnum = constrained_key.attnum
              ORDER BY constrained_key.key_position
            ) = required.constrained_columns
          )
      )
    )
    AND (
      SELECT count(*) = 1
      FROM pg_trigger trigger_definition
      WHERE trigger_definition.tgrelid = to_regclass(
        'public.prompt_wizard_route_sets'
      )
        AND NOT trigger_definition.tgisinternal
    )
    AND NOT EXISTS (
      SELECT required.trigger_name
      FROM (VALUES
        ('trg_enforce_prompt_wizard_run_engine_version', 'prompt_wizard_runs'),
        ('trg_validate_prompt_wizard_route_set', 'prompt_wizard_route_sets'),
        ('trg_validate_prompt_wizard_batch_route_set', 'prompt_wizard_batches'),
        ('trg_validate_prompt_wizard_provider_terminal_calibration_owner', 'prompt_wizard_provider_requests'),
        ('trg_validate_prompt_wizard_provider_route_owner', 'prompt_wizard_provider_requests')
      ) AS required(trigger_name, relation_name)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_trigger trigger_definition
        WHERE trigger_definition.tgname = required.trigger_name
          AND trigger_definition.tgrelid = to_regclass('public.' || required.relation_name)
          AND NOT trigger_definition.tgisinternal
          AND trigger_definition.tgenabled = 'O'
          AND obj_description(trigger_definition.oid, 'pg_trigger') =
            'migration071-definition:' || md5(
              pg_get_triggerdef(trigger_definition.oid, true)
          )
      )
    )
    AND (
      SELECT count(*) = 5
      FROM pg_index index_definition
      WHERE index_definition.indrelid = to_regclass(
        'public.prompt_wizard_route_sets'
      )
    )
    AND NOT EXISTS (
      SELECT required.index_name
      FROM (VALUES
        ('idx_prompt_wizard_route_sets_one_active', 'prompt_wizard_route_sets', true, ARRAY['run_id']::text[], true),
        ('idx_prompt_wizard_route_sets_run_created', 'prompt_wizard_route_sets', false, ARRAY['run_id', 'created_at']::text[], false),
        ('idx_prompt_wizard_route_sets_expiry', 'prompt_wizard_route_sets', false, ARRAY['expires_at']::text[], true),
        ('idx_prompt_wizard_batches_route_set', 'prompt_wizard_batches', false, ARRAY['route_set_id']::text[], true),
        ('idx_prompt_wizard_provider_requests_route_set_created', 'prompt_wizard_provider_requests', false, ARRAY['route_set_id', 'created_at', 'id']::text[], true)
      ) AS required(index_name, relation_name, is_unique, key_columns, has_predicate)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_class index_relation
        JOIN pg_namespace index_namespace
          ON index_namespace.oid = index_relation.relnamespace
        JOIN pg_index index_definition
          ON index_definition.indexrelid = index_relation.oid
        WHERE index_namespace.nspname = 'public'
          AND index_relation.relname = required.index_name
          AND index_definition.indrelid = to_regclass('public.' || required.relation_name)
          AND index_definition.indisunique = required.is_unique
          AND index_definition.indnkeyatts = cardinality(required.key_columns)
          AND ARRAY(
            SELECT indexed_attribute.attname::text
            FROM unnest(index_definition.indkey) WITH ORDINALITY
              AS indexed_key(attnum, key_position)
            JOIN pg_attribute indexed_attribute
              ON indexed_attribute.attrelid = index_definition.indrelid
             AND indexed_attribute.attnum = indexed_key.attnum
            WHERE indexed_key.key_position <= index_definition.indnkeyatts
            ORDER BY indexed_key.key_position
          ) = required.key_columns
          AND (index_definition.indpred IS NOT NULL) = required.has_predicate
          AND index_definition.indisvalid
          AND index_definition.indisready
          AND index_definition.indislive
          AND obj_description(index_relation.oid, 'pg_class') =
            'migration071-definition:' || md5(
              pg_get_indexdef(index_relation.oid, 0, true)
            )
      )
    )
    AND NOT EXISTS (
      SELECT required.function_name
      FROM (VALUES
        ('enforce_prompt_wizard_run_engine_version'),
        ('validate_prompt_wizard_route_set'),
        ('validate_prompt_wizard_batch_route_set'),
        ('validate_prompt_wizard_provider_terminal_calibration_owner'),
        ('validate_prompt_wizard_provider_route_owner'),
        ('preserve_prompt_wizard_provider_request_ledger'),
        ('sync_generation_task_prompt_wizard_source')
      ) AS required(function_name)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_proc function_definition
        JOIN pg_namespace function_namespace
          ON function_namespace.oid = function_definition.pronamespace
        WHERE function_namespace.nspname = 'public'
          AND function_definition.proname = required.function_name
          AND function_definition.pronargs = 0
          AND function_definition.prorettype = 'trigger'::regtype
          AND obj_description(function_definition.oid, 'pg_proc') =
            'migration071-definition:' || md5(
              pg_get_functiondef(function_definition.oid)
            )
      )
    )
    AND NOT EXISTS (
      SELECT required.relation_name
      FROM (VALUES
        ('prompt_wizard_runs'),
        ('prompt_wizard_settings')
      ) AS required(relation_name)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_attribute attribute
        JOIN pg_attrdef default_definition
          ON default_definition.adrelid = attribute.attrelid
         AND default_definition.adnum = attribute.attnum
        WHERE attribute.attrelid = to_regclass('public.' || required.relation_name)
          AND attribute.attname = 'engine_version'
          AND attribute.atttypid = 'smallint'::regtype
          AND NOT attribute.attisdropped
          AND regexp_replace(
            pg_get_expr(default_definition.adbin, default_definition.adrelid),
            '[[:space:]()]', '', 'g'
          ) IN ('4', '4::smallint', '''4''::smallint')
      )
    );
  IF replay_complete THEN
    RETURN;
  END IF;

  RAISE EXCEPTION
    'Migration 071 拒绝配置或结构漂移：engine_version=% available=%',
    settings_engine, settings_available;
END
$prompt_wizard_v6_cutover_guard$;

-- 新任务只允许引擎 4；历史 2/3 标记保持不可变。
ALTER TABLE prompt_wizard_runs
  ALTER COLUMN engine_version SET DEFAULT 4;
ALTER TABLE prompt_wizard_runs
  DROP CONSTRAINT IF EXISTS prompt_wizard_runs_engine_version_check;
ALTER TABLE prompt_wizard_runs
  ADD CONSTRAINT prompt_wizard_runs_engine_version_check
  CHECK (engine_version IN (2, 3, 4));

ALTER TABLE prompt_wizard_settings
  ALTER COLUMN engine_version SET DEFAULT 4;
-- Migration 069/070 会把正式单例约束为 engine_version = 3；必须先移除旧约束，
-- 再把单例切到 4，否则全新数据库按序执行到这里会被旧约束拦截。
ALTER TABLE prompt_wizard_settings
  DROP CONSTRAINT IF EXISTS prompt_wizard_settings_engine_version_check;
UPDATE prompt_wizard_settings
SET engine_version = 4,
    available = false,
    updated_at = CASE
      WHEN engine_version <> 4 OR available <> false THEN now()
      ELSE updated_at
    END
WHERE engine_version <> 4 OR available <> false;
ALTER TABLE prompt_wizard_settings
  ADD CONSTRAINT prompt_wizard_settings_engine_version_check
  CHECK (engine_version = 4);

-- 日指标继续保留历史引擎 2/3，同时允许 V6 引擎 4 写入匿名聚合计数。
ALTER TABLE prompt_wizard_daily_metrics
  DROP CONSTRAINT IF EXISTS prompt_wizard_daily_metrics_engine_version_check;
ALTER TABLE prompt_wizard_daily_metrics
  ADD CONSTRAINT prompt_wizard_daily_metrics_engine_version_check
  CHECK (engine_version IN (2, 3, 4));

CREATE OR REPLACE FUNCTION enforce_prompt_wizard_run_engine_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.engine_version <> 4 THEN
    RAISE EXCEPTION 'prompt_wizard_runs 新任务只能使用引擎 4：run=%', NEW.id;
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

-- 三路线只供后台生成编排使用；用户不再选择方向或场景。
CREATE TABLE IF NOT EXISTS prompt_wizard_route_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES prompt_wizard_runs(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  run_revision integer NOT NULL CHECK (run_revision >= 0),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  routes jsonb,
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
  CONSTRAINT prompt_wizard_route_sets_completed_shape_check CHECK (
    status <> 'completed'
    OR content_purged_at IS NOT NULL
    OR (
      routes IS NOT NULL
      AND jsonb_typeof(routes) = 'array'
      AND jsonb_array_length(routes) = 3
      AND routes -> 0 ->> 'role' = 'proof-conversion'
      AND routes -> 1 ->> 'role' = 'problem-hook'
      AND routes -> 2 ->> 'role' = 'lifestyle-seeding'
    )
  ),
  CONSTRAINT prompt_wizard_route_sets_pending_shape_check CHECK (
    status NOT IN ('queued', 'processing', 'failed')
    OR content_purged_at IS NOT NULL
    OR routes IS NULL
  ),
  CONSTRAINT prompt_wizard_route_sets_failed_shape_check CHECK (
    status <> 'failed' OR content_purged_at IS NOT NULL OR failure_reason IS NOT NULL
  ),
  CONSTRAINT prompt_wizard_route_sets_purge_shape_check CHECK (
    content_purged_at IS NULL OR (routes IS NULL AND failure_reason IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_wizard_route_sets_one_active
  ON prompt_wizard_route_sets(run_id)
  WHERE status IN ('queued', 'processing');
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_route_sets_run_created
  ON prompt_wizard_route_sets(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_route_sets_expiry
  ON prompt_wizard_route_sets(expires_at)
  WHERE content_purged_at IS NULL;

CREATE OR REPLACE FUNCTION validate_prompt_wizard_route_set()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_record prompt_wizard_runs%ROWTYPE;
BEGIN
  SELECT * INTO run_record
  FROM prompt_wizard_runs
  WHERE id = NEW.run_id;

  IF run_record.id IS NULL
    OR run_record.user_id <> NEW.user_id
    OR run_record.engine_version <> 4
  THEN
    RAISE EXCEPTION 'prompt_wizard_route_sets 与引擎 4 run 归属不一致：route_set=%', NEW.id;
  END IF;

  IF NEW.status = 'completed' AND NEW.content_purged_at IS NULL THEN
    IF NEW.routes IS NULL
      OR jsonb_typeof(NEW.routes) <> 'array'
      OR jsonb_array_length(NEW.routes) <> 3
    THEN
      RAISE EXCEPTION 'prompt_wizard_route_sets 完成结果必须包含三个路线：route_set=%', NEW.id;
    END IF;

    IF (
      SELECT count(DISTINCT item ->> 'id')
      FROM jsonb_array_elements(NEW.routes) AS item
    ) <> 3 THEN
      RAISE EXCEPTION 'prompt_wizard_route_sets 路线 id 必须唯一：route_set=%', NEW.id;
    END IF;

    IF NEW.routes -> 0 ->> 'role' IS DISTINCT FROM 'proof-conversion'
      OR NEW.routes -> 1 ->> 'role' IS DISTINCT FROM 'problem-hook'
      OR NEW.routes -> 2 ->> 'role' IS DISTINCT FROM 'lifestyle-seeding'
    THEN
      RAISE EXCEPTION 'prompt_wizard_route_sets 必须按索引 0 产品自证、1 痛点钩子、2 场景种草交付：route_set=%', NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_route_set
  ON prompt_wizard_route_sets;
CREATE TRIGGER trg_validate_prompt_wizard_route_set
BEFORE INSERT OR UPDATE ON prompt_wizard_route_sets
FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_route_set();

-- V6 批次只关联内部路线集合；历史 Concept 与 V5 使用方向分支保持原样。
ALTER TABLE prompt_wizard_batches
  ADD COLUMN IF NOT EXISTS route_set_id uuid;
ALTER TABLE prompt_wizard_batches
  DROP CONSTRAINT IF EXISTS prompt_wizard_batches_route_set_fk;
ALTER TABLE prompt_wizard_batches
  ADD CONSTRAINT prompt_wizard_batches_route_set_fk
  FOREIGN KEY (route_set_id)
  REFERENCES prompt_wizard_route_sets(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_prompt_wizard_batches_route_set
  ON prompt_wizard_batches(route_set_id)
  WHERE route_set_id IS NOT NULL;

ALTER TABLE prompt_wizard_batches
  DROP CONSTRAINT IF EXISTS prompt_wizard_batches_source_selection_check;
ALTER TABLE prompt_wizard_batches
  ADD CONSTRAINT prompt_wizard_batches_source_selection_check CHECK (
    content_purged_at IS NOT NULL
    OR (
      concept_set_id IS NULL
      AND cardinality(selected_concept_ids) = 0
      AND use_direction_set_id IS NULL
      AND selected_use_direction_id IS NULL
      AND selected_scene_id IS NULL
      AND custom_scene IS NULL
      AND route_set_id IS NULL
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
      AND route_set_id IS NULL
    )
    OR (
      concept_set_id IS NULL
      AND cardinality(selected_concept_ids) = 0
      AND use_direction_set_id IS NOT NULL
      AND selected_use_direction_id IS NOT NULL
      AND ((selected_scene_id IS NULL) <> (custom_scene IS NULL))
      AND route_set_id IS NULL
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
    OR (
      concept_set_id IS NULL
      AND cardinality(selected_concept_ids) = 0
      AND use_direction_set_id IS NULL
      AND selected_use_direction_id IS NULL
      AND selected_scene_id IS NULL
      AND custom_scene IS NULL
      AND route_set_id IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION validate_prompt_wizard_batch_route_set()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  route_set_record prompt_wizard_route_sets%ROWTYPE;
BEGIN
  IF NEW.content_purged_at IS NOT NULL OR NEW.route_set_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO route_set_record
  FROM prompt_wizard_route_sets
  WHERE id = NEW.route_set_id;

  IF route_set_record.id IS NULL
    OR route_set_record.run_id <> NEW.run_id
    OR route_set_record.user_id <> NEW.user_id
    OR route_set_record.run_revision <> NEW.run_revision
    OR route_set_record.status <> 'completed'
    OR route_set_record.content_purged_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'prompt_wizard_batches 三路线集合不可用于当前批次：batch=% route_set=%',
      NEW.id, NEW.route_set_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_batch_route_set
  ON prompt_wizard_batches;
CREATE TRIGGER trg_validate_prompt_wizard_batch_route_set
BEFORE INSERT OR UPDATE OF route_set_id, run_id, user_id, run_revision
  ON prompt_wizard_batches
FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_batch_route_set();

ALTER TABLE prompt_wizard_batches
  DROP CONSTRAINT IF EXISTS prompt_wizard_batches_completed_shape_check;
ALTER TABLE prompt_wizard_batches
  ADD CONSTRAINT prompt_wizard_batches_completed_shape_check CHECK (
    status <> 'completed'
    OR content_purged_at IS NOT NULL
    OR (
      plans IS NOT NULL
      AND jsonb_typeof(plans) = 'array'
      AND jsonb_array_length(plans) IN (2, 3)
    )
  );

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
      AND route_set_id IS NULL
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
      AND route_set_id IS NULL
      AND plans IS NOT NULL
      AND jsonb_typeof(plans) = 'array'
      AND jsonb_array_length(plans) = 2
      AND jsonb_path_exists(plans, '$[0] ? (@.deliveryVersion == 5)')
      AND jsonb_path_exists(plans, '$[1] ? (@.deliveryVersion == 5)')
    )
    OR (
      concept_set_id IS NULL
      AND cardinality(selected_concept_ids) = 0
      AND use_direction_set_id IS NULL
      AND selected_use_direction_id IS NULL
      AND selected_scene_id IS NULL
      AND custom_scene IS NULL
      AND route_set_id IS NOT NULL
      AND plans IS NOT NULL
      AND jsonb_typeof(plans) = 'array'
      AND jsonb_array_length(plans) = 3
      AND jsonb_path_exists(plans, '$[0] ? (@.deliveryVersion == 6)')
      AND jsonb_path_exists(plans, '$[1] ? (@.deliveryVersion == 6)')
      AND jsonb_path_exists(plans, '$[2] ? (@.deliveryVersion == 6)')
      AND plans -> 0 ->> 'role' = 'proof-conversion'
      AND plans -> 1 ->> 'role' = 'problem-hook'
      AND plans -> 2 ->> 'role' = 'lifestyle-seeding'
    )
  );

-- 路线规划的 Provider 请求使用独立 route-set 作用域；三条方案仍归属于 batch/plan_index。
ALTER TABLE prompt_wizard_provider_requests
  ADD COLUMN IF NOT EXISTS route_set_id uuid;
ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_route_set_fk;
ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_route_set_fk
  FOREIGN KEY (route_set_id)
  REFERENCES prompt_wizard_route_sets(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_provider_requests_route_set_created
  ON prompt_wizard_provider_requests(route_set_id, created_at ASC, id ASC)
  WHERE route_set_id IS NOT NULL;

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
      'generate-routes',
      'repair-routes',
      'generate-drafts',
      'repair-draft-format',
      'repair-draft-content',
      'refine-plan'
    )
  );

-- 两轮通用内容修复后，repair-draft-content 可使用第三轮成本幂等身份；
-- 下方触发器同时核验其 batch/run/user 归属、引擎 4 与 V6 路线集合，避免
-- 旧 V4/V5 批次借用该身份。公开内容修复轮次仍保持 2。
ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_repair_round_check;
ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_repair_round_check CHECK (
    repair_round BETWEEN 0 AND 2
    OR (repair_round = 3 AND operation = 'repair-draft-content')
  );

CREATE OR REPLACE FUNCTION validate_prompt_wizard_provider_terminal_calibration_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  batch_record prompt_wizard_batches%ROWTYPE;
  run_record prompt_wizard_runs%ROWTYPE;
BEGIN
  IF NEW.repair_round <> 3 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO batch_record
  FROM prompt_wizard_batches
  WHERE id = NEW.batch_id;
  SELECT * INTO run_record
  FROM prompt_wizard_runs
  WHERE id = NEW.run_id;

  IF NEW.batch_id IS NULL
    OR batch_record.id IS NULL
    OR run_record.id IS NULL
    OR batch_record.route_set_id IS NULL
    OR batch_record.run_id <> NEW.run_id
    OR batch_record.user_id <> NEW.user_id
    OR run_record.user_id <> NEW.user_id
    OR run_record.engine_version <> 4
  THEN
    RAISE EXCEPTION 'prompt_wizard_provider_requests 第三轮只允许引擎 4 的 V6 批次：request=% batch=%',
      NEW.id, NEW.batch_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_provider_terminal_calibration_owner
  ON prompt_wizard_provider_requests;
CREATE TRIGGER trg_validate_prompt_wizard_provider_terminal_calibration_owner
BEFORE INSERT OR UPDATE OF repair_round, batch_id, run_id, user_id
  ON prompt_wizard_provider_requests
FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_provider_terminal_calibration_owner();

ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_owner_shape_check;
ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_owner_shape_check CHECK (
    (
      operation IN (
        'analyze-product', 'repair-product-chinese', 'repair-product-profile',
        'repair-product-format', 'generate-concepts', 'repair-concept-set'
      )
      AND batch_id IS NULL
      AND use_direction_set_id IS NULL
      AND route_set_id IS NULL
    )
    OR (
      operation IN ('generate-use-directions', 'repair-use-directions')
      AND batch_id IS NULL
      AND use_direction_set_id IS NOT NULL
      AND route_set_id IS NULL
    )
    OR (
      operation IN ('generate-routes', 'repair-routes')
      AND batch_id IS NULL
      AND use_direction_set_id IS NULL
      AND route_set_id IS NOT NULL
    )
    OR (
      operation IN ('generate-drafts', 'repair-draft-format', 'repair-draft-content', 'refine-plan')
      AND batch_id IS NOT NULL
      AND use_direction_set_id IS NULL
      AND route_set_id IS NULL
    )
  );

ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_plan_shape_check;
ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_plan_shape_check CHECK (
    (
      operation IN ('generate-drafts', 'repair-draft-format', 'repair-draft-content', 'refine-plan')
      AND plan_index IS NOT NULL
    )
    OR (
      operation NOT IN ('generate-drafts', 'repair-draft-format', 'repair-draft-content', 'refine-plan')
      AND plan_index IS NULL
    )
  );

ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_route_scope_check;
ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_route_scope_check CHECK (
    (
      operation IN ('generate-routes', 'repair-routes')
      AND route_set_id IS NOT NULL
      AND request_key LIKE ('route-set:' || route_set_id::text || ':%')
    )
    OR (
      operation NOT IN ('generate-routes', 'repair-routes')
      AND route_set_id IS NULL
    )
  );

CREATE OR REPLACE FUNCTION validate_prompt_wizard_provider_route_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  route_set_record prompt_wizard_route_sets%ROWTYPE;
BEGIN
  IF NEW.route_set_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO route_set_record
  FROM prompt_wizard_route_sets
  WHERE id = NEW.route_set_id;
  IF route_set_record.id IS NULL
    OR route_set_record.run_id <> NEW.run_id
    OR route_set_record.user_id <> NEW.user_id
  THEN
    RAISE EXCEPTION 'prompt_wizard_provider_requests 与三路线集合归属不一致：request=% route_set=%',
      NEW.id, NEW.route_set_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_provider_route_owner
  ON prompt_wizard_provider_requests;
CREATE TRIGGER trg_validate_prompt_wizard_provider_route_owner
BEFORE INSERT OR UPDATE OF route_set_id, run_id, user_id
  ON prompt_wizard_provider_requests
FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_provider_route_owner();

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
    NEW.id, NEW.request_key, NEW.run_id, NEW.batch_id, NEW.use_direction_set_id,
    NEW.route_set_id, NEW.user_id, NEW.operation, NEW.job_attempt, NEW.repair_round,
    NEW.plan_index, NEW.transport_attempt, NEW.provider, NEW.model, NEW.started_at, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.request_key, OLD.run_id, OLD.batch_id, OLD.use_direction_set_id,
    OLD.route_set_id, OLD.user_id, OLD.operation, OLD.job_attempt, OLD.repair_round,
    OLD.plan_index, OLD.transport_attempt, OLD.provider, OLD.model, OLD.started_at, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'prompt_wizard_provider_requests 业务身份禁止修改：request=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

-- 视频任务来源新增 V6/引擎 4 映射；历史 V1–V5 规则不变。
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
    source_delivery_version = 6 AND NEW.prompt_wizard_engine_version <> 4
  ) OR (
    source_delivery_version BETWEEN 1 AND 3 AND NEW.prompt_wizard_engine_version <> 2
  ) OR source_delivery_version NOT BETWEEN 1 AND 6 THEN
    RAISE EXCEPTION 'generation_tasks 提示词版本与来源方案不一致：task=%', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

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
      prompt_wizard_source IS NOT NULL
      AND jsonb_typeof(prompt_wizard_source) = 'object'
      AND prompt_wizard_run_id IS NOT NULL
      AND prompt_wizard_batch_id IS NOT NULL
      AND prompt_wizard_plan_id IS NOT NULL
      AND prompt_wizard_engine_version IN (2, 3, 4)
      AND prompt_wizard_edit_bucket IN ('none', 'minor', 'material')
    )
  );

-- 重放门禁不仅核验对象名称与归属，还要拒绝同表同名但定义被弱化的对象。
-- 签名写入对象 comment；常规 DROP/CREATE 会丢失 comment，CREATE OR REPLACE
-- 函数会保留旧 comment 但正文哈希改变，因此两类结构漂移都会 fail-closed。
DO $prompt_wizard_v6_definition_signatures$
DECLARE
  required record;
  object_oid oid;
  definition_hash text;
BEGIN
  FOR required IN
    SELECT * FROM (VALUES
      ('prompt_wizard_runs_engine_version_check', 'prompt_wizard_runs'),
      ('prompt_wizard_settings_engine_version_check', 'prompt_wizard_settings'),
      ('prompt_wizard_daily_metrics_engine_version_check', 'prompt_wizard_daily_metrics'),
      ('prompt_wizard_route_sets_pkey', 'prompt_wizard_route_sets'),
      ('prompt_wizard_route_sets_run_id_fkey', 'prompt_wizard_route_sets'),
      ('prompt_wizard_route_sets_user_id_fkey', 'prompt_wizard_route_sets'),
      ('prompt_wizard_route_sets_user_id_idempotency_key_key', 'prompt_wizard_route_sets'),
      ('prompt_wizard_route_sets_run_revision_check', 'prompt_wizard_route_sets'),
      ('prompt_wizard_route_sets_status_check', 'prompt_wizard_route_sets'),
      ('prompt_wizard_route_sets_provider_input_tokens_check', 'prompt_wizard_route_sets'),
      ('prompt_wizard_route_sets_provider_output_tokens_check', 'prompt_wizard_route_sets'),
      ('prompt_wizard_route_sets_attempt_count_check', 'prompt_wizard_route_sets'),
      ('prompt_wizard_route_sets_completed_shape_check', 'prompt_wizard_route_sets'),
      ('prompt_wizard_route_sets_pending_shape_check', 'prompt_wizard_route_sets'),
      ('prompt_wizard_route_sets_failed_shape_check', 'prompt_wizard_route_sets'),
      ('prompt_wizard_route_sets_purge_shape_check', 'prompt_wizard_route_sets'),
      ('prompt_wizard_batches_route_set_fk', 'prompt_wizard_batches'),
      ('prompt_wizard_batches_source_selection_check', 'prompt_wizard_batches'),
      ('prompt_wizard_batches_completed_shape_check', 'prompt_wizard_batches'),
      ('prompt_wizard_batches_v3_only_completed_shape_check', 'prompt_wizard_batches'),
      ('prompt_wizard_provider_requests_route_set_fk', 'prompt_wizard_provider_requests'),
      ('prompt_wizard_provider_requests_operation_check', 'prompt_wizard_provider_requests'),
      ('prompt_wizard_provider_requests_repair_round_check', 'prompt_wizard_provider_requests'),
      ('prompt_wizard_provider_requests_owner_shape_check', 'prompt_wizard_provider_requests'),
      ('prompt_wizard_provider_requests_plan_shape_check', 'prompt_wizard_provider_requests'),
      ('prompt_wizard_provider_requests_route_scope_check', 'prompt_wizard_provider_requests'),
      ('generation_tasks_prompt_wizard_source_check', 'generation_tasks')
    ) AS expected(object_name, relation_name)
  LOOP
    SELECT constraint_definition.oid,
      md5(pg_get_constraintdef(constraint_definition.oid, true))
    INTO STRICT object_oid, definition_hash
    FROM pg_constraint constraint_definition
    WHERE constraint_definition.conname = required.object_name
      AND constraint_definition.conrelid = to_regclass(
        'public.' || required.relation_name
      );
    EXECUTE format(
      'COMMENT ON CONSTRAINT %I ON public.%I IS %L',
      required.object_name,
      required.relation_name,
      'migration071-definition:' || definition_hash
    );
  END LOOP;

  FOR required IN
    SELECT * FROM (VALUES
      ('trg_enforce_prompt_wizard_run_engine_version', 'prompt_wizard_runs'),
      ('trg_validate_prompt_wizard_route_set', 'prompt_wizard_route_sets'),
      ('trg_validate_prompt_wizard_batch_route_set', 'prompt_wizard_batches'),
      ('trg_validate_prompt_wizard_provider_terminal_calibration_owner', 'prompt_wizard_provider_requests'),
      ('trg_validate_prompt_wizard_provider_route_owner', 'prompt_wizard_provider_requests')
    ) AS expected(object_name, relation_name)
  LOOP
    SELECT trigger_definition.oid,
      md5(pg_get_triggerdef(trigger_definition.oid, true))
    INTO STRICT object_oid, definition_hash
    FROM pg_trigger trigger_definition
    WHERE trigger_definition.tgname = required.object_name
      AND trigger_definition.tgrelid = to_regclass(
        'public.' || required.relation_name
      )
      AND NOT trigger_definition.tgisinternal;
    EXECUTE format(
      'COMMENT ON TRIGGER %I ON public.%I IS %L',
      required.object_name,
      required.relation_name,
      'migration071-definition:' || definition_hash
    );
  END LOOP;

  FOR required IN
    SELECT * FROM (VALUES
      ('idx_prompt_wizard_route_sets_one_active', 'prompt_wizard_route_sets'),
      ('idx_prompt_wizard_route_sets_run_created', 'prompt_wizard_route_sets'),
      ('idx_prompt_wizard_route_sets_expiry', 'prompt_wizard_route_sets'),
      ('idx_prompt_wizard_batches_route_set', 'prompt_wizard_batches'),
      ('idx_prompt_wizard_provider_requests_route_set_created', 'prompt_wizard_provider_requests')
    ) AS expected(object_name, relation_name)
  LOOP
    SELECT index_relation.oid,
      md5(pg_get_indexdef(index_relation.oid, 0, true))
    INTO STRICT object_oid, definition_hash
    FROM pg_class index_relation
    JOIN pg_namespace index_namespace
      ON index_namespace.oid = index_relation.relnamespace
    JOIN pg_index index_definition
      ON index_definition.indexrelid = index_relation.oid
    WHERE index_namespace.nspname = 'public'
      AND index_relation.relname = required.object_name
      AND index_definition.indrelid = to_regclass(
        'public.' || required.relation_name
      );
    EXECUTE format(
      'COMMENT ON INDEX public.%I IS %L',
      required.object_name,
      'migration071-definition:' || definition_hash
    );
  END LOOP;

  FOR required IN
    SELECT * FROM (VALUES
      ('enforce_prompt_wizard_run_engine_version'),
      ('validate_prompt_wizard_route_set'),
      ('validate_prompt_wizard_batch_route_set'),
      ('validate_prompt_wizard_provider_terminal_calibration_owner'),
      ('validate_prompt_wizard_provider_route_owner'),
      ('preserve_prompt_wizard_provider_request_ledger'),
      ('sync_generation_task_prompt_wizard_source')
    ) AS expected(object_name)
  LOOP
    SELECT function_definition.oid,
      md5(pg_get_functiondef(function_definition.oid))
    INTO STRICT object_oid, definition_hash
    FROM pg_proc function_definition
    JOIN pg_namespace function_namespace
      ON function_namespace.oid = function_definition.pronamespace
    WHERE function_namespace.nspname = 'public'
      AND function_definition.proname = required.object_name
      AND function_definition.pronargs = 0
      AND function_definition.prorettype = 'trigger'::regtype;
    EXECUTE format(
      'COMMENT ON FUNCTION public.%I() IS %L',
      required.object_name,
      'migration071-definition:' || definition_hash
    );
  END LOOP;
END
$prompt_wizard_v6_definition_signatures$;
