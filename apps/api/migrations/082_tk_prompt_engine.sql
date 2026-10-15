-- TK Prompt Engine 1.0：独立事实分析、三策略、三方案并行扩写与来源追踪。
-- 历史 prompt_wizard_* / V6 表、正文、触发器和成本账本保持原样；本迁移不回填历史内容。

CREATE OR REPLACE FUNCTION tk_prompt_uuid_array_is_unique(value uuid[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT count(*) = count(DISTINCT item) FROM unnest(value) AS item;
$$;

CREATE TABLE IF NOT EXISTS tk_prompt_engine_settings (
  singleton_id smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  generation_credits integer NOT NULL DEFAULT 1 CHECK (generation_credits >= 0),
  available boolean NOT NULL DEFAULT false,
  -- 单向切流墓碑：首次开放 TK 1.0 后永不清空，回滚也不能复活 V6 写链。
  v6_retired_at timestamptz,
  updated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tk_prompt_engine_settings (
  singleton_id, schema_version, generation_credits, available
)
SELECT 1, 1, refresh_credits, false
FROM prompt_wizard_settings
WHERE singleton_id = 1
ON CONFLICT (singleton_id) DO NOTHING;

ALTER TABLE tk_prompt_engine_settings
  ADD COLUMN IF NOT EXISTS v6_retired_at timestamptz;
UPDATE tk_prompt_engine_settings
SET v6_retired_at = COALESCE(v6_retired_at, clock_timestamp())
WHERE available = true AND v6_retired_at IS NULL;
ALTER TABLE tk_prompt_engine_settings
  DROP CONSTRAINT IF EXISTS tk_prompt_engine_settings_cutover_shape_check;
ALTER TABLE tk_prompt_engine_settings
  ADD CONSTRAINT tk_prompt_engine_settings_cutover_shape_check CHECK (
    NOT available OR v6_retired_at IS NOT NULL
  );

CREATE OR REPLACE FUNCTION tk_prompt_engine_preserve_v6_retirement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.v6_retired_at IS NOT NULL
     AND NEW.v6_retired_at IS DISTINCT FROM OLD.v6_retired_at THEN
    RAISE EXCEPTION 'tk_prompt_engine_settings.v6_retired_at is immutable after cutover';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tk_prompt_engine_preserve_v6_retirement_trigger
  ON tk_prompt_engine_settings;
CREATE TRIGGER tk_prompt_engine_preserve_v6_retirement_trigger
BEFORE UPDATE OF v6_retired_at ON tk_prompt_engine_settings
FOR EACH ROW
EXECUTE FUNCTION tk_prompt_engine_preserve_v6_retirement();

CREATE TABLE IF NOT EXISTS tk_prompt_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL,
  status text NOT NULL DEFAULT 'analyzing'
    CHECK (status IN ('analyzing', 'ready', 'failed', 'archived')),
  image_asset_ids uuid[] NOT NULL,
  evidence_profile jsonb,
  failure_reason text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_token uuid,
  content_purged_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (id, user_id),
  CONSTRAINT tk_prompt_runs_idempotency_key_check CHECK (
    idempotency_key = btrim(idempotency_key) AND idempotency_key <> ''
  ),
  CONSTRAINT tk_prompt_runs_request_hash_check CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tk_prompt_runs_image_count_check CHECK (
    status = 'archived'
    OR (
      cardinality(image_asset_ids) BETWEEN 1 AND 9
      AND tk_prompt_uuid_array_is_unique(image_asset_ids)
    )
  ),
  CONSTRAINT tk_prompt_runs_evidence_shape_check CHECK (
    evidence_profile IS NULL OR jsonb_typeof(evidence_profile) = 'object'
  ),
  CONSTRAINT tk_prompt_runs_terminal_shape_check CHECK (
    (status = 'ready' AND evidence_profile IS NOT NULL AND failure_reason IS NULL AND completed_at IS NOT NULL)
    OR (status = 'failed' AND failure_reason IS NOT NULL AND completed_at IS NOT NULL)
    OR status IN ('analyzing', 'archived')
  ),
  CONSTRAINT tk_prompt_runs_purge_shape_check CHECK (
    content_purged_at IS NULL
    OR (
      status = 'archived'
      AND cardinality(image_asset_ids) = 0
      AND evidence_profile IS NULL
      AND failure_reason IS NULL
    )
  )
);

ALTER TABLE tk_prompt_runs
  ADD COLUMN IF NOT EXISTS claim_token uuid;
UPDATE tk_prompt_runs
SET claim_token = CASE
      WHEN status = 'analyzing' AND started_at IS NOT NULL
        THEN COALESCE(claim_token, gen_random_uuid())
      ELSE NULL
    END
WHERE claim_token IS NOT NULL
   OR (status = 'analyzing' AND started_at IS NOT NULL);
ALTER TABLE tk_prompt_runs
  DROP CONSTRAINT IF EXISTS tk_prompt_runs_claim_shape_check;
ALTER TABLE tk_prompt_runs
  ADD CONSTRAINT tk_prompt_runs_claim_shape_check CHECK (
    (
      status = 'analyzing'
      AND (
        (started_at IS NULL AND claim_token IS NULL)
        OR (started_at IS NOT NULL AND claim_token IS NOT NULL)
      )
    )
    OR (status <> 'analyzing' AND claim_token IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_tk_prompt_runs_user_created
  ON tk_prompt_runs(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tk_prompt_runs_recovery
  ON tk_prompt_runs(status, started_at, created_at)
  WHERE status = 'analyzing';
CREATE INDEX IF NOT EXISTS idx_tk_prompt_runs_expiry
  ON tk_prompt_runs(expires_at)
  WHERE content_purged_at IS NULL;

CREATE TABLE IF NOT EXISTS tk_prompt_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES tk_prompt_runs(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'strategizing', 'expanding', 'completed', 'failed')),
  confirmed_fact_pack jsonb,
  creative_input jsonb,
  video_config jsonb,
  strategy_set jsonb,
  is_free boolean NOT NULL DEFAULT false,
  credits integer NOT NULL DEFAULT 0 CHECK (credits >= 0),
  credit_status text NOT NULL DEFAULT 'none'
    CHECK (credit_status IN ('none', 'held', 'settled', 'refunded')),
  main_credits_used integer NOT NULL DEFAULT 0 CHECK (main_credits_used >= 0),
  addon_credits_used integer NOT NULL DEFAULT 0 CHECK (addon_credits_used >= 0),
  failure_reason text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_token uuid,
  content_purged_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (run_id, ordinal),
  UNIQUE (id, user_id),
  CONSTRAINT tk_prompt_generations_idempotency_key_check CHECK (
    idempotency_key = btrim(idempotency_key) AND idempotency_key <> ''
  ),
  CONSTRAINT tk_prompt_generations_request_hash_check CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tk_prompt_generations_input_shape_check CHECK (
    content_purged_at IS NOT NULL
    OR (
      jsonb_typeof(confirmed_fact_pack) = 'object'
      AND jsonb_typeof(creative_input) = 'object'
      AND jsonb_typeof(video_config) = 'object'
    )
  ),
  CONSTRAINT tk_prompt_generations_strategy_shape_check CHECK (
    content_purged_at IS NOT NULL
    OR (
      status IN ('queued', 'strategizing')
      AND strategy_set IS NULL
    )
    OR (
      status IN ('expanding', 'completed')
      AND jsonb_typeof(strategy_set) = 'array'
      AND jsonb_array_length(strategy_set) = 3
    )
    OR (
      status = 'failed'
      AND (
        strategy_set IS NULL
        OR (
          jsonb_typeof(strategy_set) = 'array'
          AND jsonb_array_length(strategy_set) = 3
        )
      )
    )
  ),
  CONSTRAINT tk_prompt_generations_credit_shape_check CHECK (
    (
      is_free
      AND credits = 0
      AND credit_status = 'none'
      AND main_credits_used = 0
      AND addon_credits_used = 0
    )
    OR (
      NOT is_free
      AND (
        (credits = 0 AND credit_status = 'none' AND main_credits_used = 0 AND addon_credits_used = 0)
        OR (
          credits > 0
          AND main_credits_used + addon_credits_used = credits
          AND (
            (status IN ('queued', 'strategizing', 'expanding') AND credit_status = 'held')
            OR (status = 'completed' AND credit_status = 'settled')
            OR (status = 'failed' AND credit_status = 'refunded')
          )
        )
      )
    )
  ),
  CONSTRAINT tk_prompt_generations_terminal_shape_check CHECK (
    content_purged_at IS NOT NULL
    OR (
      status = 'completed'
      AND completed_at IS NOT NULL
      AND failure_reason IS NULL
      AND (credits = 0 OR credit_status = 'settled')
    )
    OR (
      status = 'failed'
      AND completed_at IS NOT NULL
      AND failure_reason IS NOT NULL
      AND (credits = 0 OR credit_status = 'refunded')
    )
    OR status IN ('queued', 'strategizing', 'expanding')
  ),
  CONSTRAINT tk_prompt_generations_purge_shape_check CHECK (
    content_purged_at IS NULL
    OR (
      status IN ('completed', 'failed')
      AND confirmed_fact_pack IS NULL
      AND creative_input IS NULL
      AND video_config IS NULL
      AND strategy_set IS NULL
      AND failure_reason IS NULL
    )
  )
);

ALTER TABLE tk_prompt_generations
  ADD COLUMN IF NOT EXISTS claim_token uuid;
UPDATE tk_prompt_generations
SET claim_token = CASE
      WHEN status = 'strategizing'
        THEN COALESCE(claim_token, gen_random_uuid())
      ELSE NULL
    END
WHERE claim_token IS NOT NULL OR status = 'strategizing';
ALTER TABLE tk_prompt_generations
  DROP CONSTRAINT IF EXISTS tk_prompt_generations_claim_shape_check;
ALTER TABLE tk_prompt_generations
  ADD CONSTRAINT tk_prompt_generations_claim_shape_check CHECK (
    (status = 'queued' AND started_at IS NULL AND claim_token IS NULL)
    OR (status = 'strategizing' AND started_at IS NOT NULL AND claim_token IS NOT NULL)
    OR (status IN ('expanding', 'completed', 'failed') AND claim_token IS NULL)
  );
ALTER TABLE tk_prompt_generations
  DROP CONSTRAINT IF EXISTS tk_prompt_generations_credit_shape_check;
ALTER TABLE tk_prompt_generations
  ADD CONSTRAINT tk_prompt_generations_credit_shape_check CHECK (
    (
      is_free
      AND credits = 0
      AND credit_status = 'none'
      AND main_credits_used = 0
      AND addon_credits_used = 0
    )
    OR (
      NOT is_free
      AND (
        (credits = 0 AND credit_status = 'none' AND main_credits_used = 0 AND addon_credits_used = 0)
        OR (
          credits > 0
          AND main_credits_used + addon_credits_used = credits
          AND (
            (status IN ('queued', 'strategizing', 'expanding') AND credit_status = 'held')
            OR (status = 'completed' AND credit_status = 'settled')
            OR (status = 'failed' AND credit_status = 'refunded')
          )
        )
      )
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_tk_prompt_generations_one_active
  ON tk_prompt_generations(run_id)
  WHERE status IN ('queued', 'strategizing', 'expanding');
CREATE INDEX IF NOT EXISTS idx_tk_prompt_generations_user_created
  ON tk_prompt_generations(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tk_prompt_generations_recovery
  ON tk_prompt_generations(status, started_at, created_at)
  WHERE status IN ('queued', 'strategizing', 'expanding');
CREATE INDEX IF NOT EXISTS idx_tk_prompt_generations_expiry
  ON tk_prompt_generations(expires_at)
  WHERE content_purged_at IS NULL;

CREATE OR REPLACE FUNCTION validate_tk_prompt_generation_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_run tk_prompt_runs%ROWTYPE;
BEGIN
  SELECT * INTO source_run FROM tk_prompt_runs WHERE id = NEW.run_id;
  IF source_run.id IS NULL OR source_run.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'tk_prompt_generations 与 run 用户归属不一致：generation=%', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_tk_prompt_generation_owner ON tk_prompt_generations;
CREATE TRIGGER trg_validate_tk_prompt_generation_owner
BEFORE INSERT OR UPDATE OF run_id, user_id ON tk_prompt_generations
FOR EACH ROW EXECUTE FUNCTION validate_tk_prompt_generation_owner();

CREATE TABLE IF NOT EXISTS tk_prompt_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL REFERENCES tk_prompt_generations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slot text NOT NULL CHECK (slot IN ('safe', 'native', 'creative')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  strategy_blueprint jsonb,
  plan jsonb,
  failure_reason text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_token uuid,
  content_purged_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, slot),
  UNIQUE (id, user_id),
  CONSTRAINT tk_prompt_options_content_shape_check CHECK (
    content_purged_at IS NOT NULL
    OR (
      strategy_blueprint IS NOT NULL
      AND jsonb_typeof(strategy_blueprint) = 'object'
      AND (plan IS NULL OR jsonb_typeof(plan) = 'object')
      AND strategy_blueprint ->> 'slot' = slot
      AND strategy_blueprint ->> 'videoMode' IN (
        'product_closeup', 'scene_demo', 'live_presenter'
      )
      AND (
        strategy_blueprint ->> 'videoMode' <> 'live_presenter'
        OR coalesce(
          strategy_blueprint ->> 'authorizedActorAssetId'
            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          false
        )
      )
      AND strategy_blueprint ->> 'videoMode' <> 'graphic_montage'
    )
  ),
  CONSTRAINT tk_prompt_options_terminal_shape_check CHECK (
    content_purged_at IS NOT NULL
    OR (
      status = 'completed'
      AND plan IS NOT NULL
      AND failure_reason IS NULL
      AND completed_at IS NOT NULL
    )
    OR (
      status = 'failed'
      AND plan IS NULL
      AND failure_reason IS NOT NULL
      AND completed_at IS NOT NULL
    )
    OR (
      status IN ('queued', 'processing')
      AND plan IS NULL
      AND failure_reason IS NULL
      AND completed_at IS NULL
    )
  ),
  CONSTRAINT tk_prompt_options_purge_shape_check CHECK (
    content_purged_at IS NULL
    OR (
      status IN ('completed', 'failed')
      AND strategy_blueprint IS NULL
      AND plan IS NULL
      AND failure_reason IS NULL
    )
  )
);

ALTER TABLE tk_prompt_options
  ADD COLUMN IF NOT EXISTS claim_token uuid;
UPDATE tk_prompt_options
SET claim_token = CASE
      WHEN status = 'processing'
        THEN COALESCE(claim_token, gen_random_uuid())
      ELSE NULL
    END
WHERE claim_token IS NOT NULL OR status = 'processing';
ALTER TABLE tk_prompt_options
  DROP CONSTRAINT IF EXISTS tk_prompt_options_claim_shape_check;
ALTER TABLE tk_prompt_options
  ADD CONSTRAINT tk_prompt_options_claim_shape_check CHECK (
    (status = 'queued' AND started_at IS NULL AND claim_token IS NULL)
    OR (status = 'processing' AND started_at IS NOT NULL AND claim_token IS NOT NULL)
    OR (status IN ('completed', 'failed') AND claim_token IS NULL)
  );

CREATE OR REPLACE FUNCTION validate_tk_prompt_claim_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  claim_status text;
  status_transition_valid boolean;
  parent_generation_status text;
  claim_reset boolean;
  provider_attempt_exists boolean;
BEGIN
  IF TG_TABLE_NAME = 'tk_prompt_runs' THEN
    claim_status := 'analyzing';
    status_transition_valid := CASE OLD.status
      WHEN 'analyzing' THEN NEW.status IN ('analyzing', 'ready', 'failed')
      WHEN 'ready' THEN NEW.status IN ('ready', 'archived')
      WHEN 'failed' THEN NEW.status IN ('failed', 'archived')
      WHEN 'archived' THEN NEW.status = 'archived'
      ELSE false
    END;
  ELSIF TG_TABLE_NAME = 'tk_prompt_generations' THEN
    claim_status := 'strategizing';
    status_transition_valid := CASE OLD.status
      WHEN 'queued' THEN NEW.status IN ('queued', 'strategizing', 'failed')
      WHEN 'strategizing' THEN NEW.status IN ('queued', 'strategizing', 'expanding', 'failed')
      WHEN 'expanding' THEN NEW.status IN ('expanding', 'completed', 'failed')
      WHEN 'completed' THEN NEW.status = 'completed'
      WHEN 'failed' THEN NEW.status = 'failed'
      ELSE false
    END;
  ELSIF TG_TABLE_NAME = 'tk_prompt_options' THEN
    claim_status := 'processing';
    status_transition_valid := CASE OLD.status
      WHEN 'queued' THEN NEW.status IN ('queued', 'processing', 'failed')
      WHEN 'processing' THEN NEW.status IN ('queued', 'processing', 'completed', 'failed')
      -- 整批失败时，已完成的兄弟方案也必须原子撤回为 failed。
      WHEN 'completed' THEN NEW.status IN ('completed', 'failed')
      WHEN 'failed' THEN NEW.status = 'failed'
      ELSE false
    END;
  ELSE
    RAISE EXCEPTION '未知 TK Prompt claim 表：%', TG_TABLE_NAME;
  END IF;

  claim_reset := NEW.attempt_count = OLD.attempt_count
    AND OLD.claim_token IS NOT NULL
    AND NEW.claim_token IS NULL
    AND NEW.started_at IS NULL
    AND (
      (TG_TABLE_NAME = 'tk_prompt_runs'
        AND OLD.status = 'analyzing' AND NEW.status = 'analyzing')
      OR (TG_TABLE_NAME = 'tk_prompt_generations'
        AND OLD.status = 'strategizing' AND NEW.status = 'queued')
      OR (TG_TABLE_NAME = 'tk_prompt_options'
        AND OLD.status = 'processing' AND NEW.status = 'queued')
    );
  IF claim_reset THEN
    IF TG_TABLE_NAME = 'tk_prompt_runs' THEN
      SELECT EXISTS (
        SELECT 1 FROM tk_prompt_provider_requests request
        WHERE request.run_id = OLD.id
          AND request.generation_id IS NULL AND request.option_id IS NULL
          AND request.stage = 'analysis'
          AND request.job_attempt = OLD.attempt_count
          AND request.claim_token = OLD.claim_token
      ) INTO provider_attempt_exists;
    ELSIF TG_TABLE_NAME = 'tk_prompt_generations' THEN
      SELECT EXISTS (
        SELECT 1 FROM tk_prompt_provider_requests request
        WHERE request.generation_id = OLD.id AND request.option_id IS NULL
          AND request.stage = 'strategy'
          AND request.job_attempt = OLD.attempt_count
          AND request.claim_token = OLD.claim_token
      ) INTO provider_attempt_exists;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM tk_prompt_provider_requests request
        WHERE request.option_id = OLD.id AND request.stage = 'option'
          AND request.job_attempt = OLD.attempt_count
          AND request.claim_token = OLD.claim_token
      ) INTO provider_attempt_exists;
    END IF;
    IF provider_attempt_exists THEN
      RAISE EXCEPTION '已有 Provider 调用事实的 claim 不可重置：table=%, id=%',
        TG_TABLE_NAME, OLD.id;
    END IF;
  END IF;

  IF NOT status_transition_valid THEN
    RAISE EXCEPTION 'TK Prompt 非法状态迁移：table=%, old=%, new=%',
      TG_TABLE_NAME, OLD.status, NEW.status;
  END IF;
  IF TG_TABLE_NAME = 'tk_prompt_options'
    AND OLD.status = 'completed'
    AND NEW.status = 'failed'
  THEN
    SELECT status INTO parent_generation_status
    FROM tk_prompt_generations
    WHERE id = NEW.generation_id
    FOR UPDATE;
    IF parent_generation_status IS DISTINCT FROM 'expanding' THEN
      RAISE EXCEPTION '已完成批次的方案不可撤回：generation=%', NEW.generation_id;
    END IF;
  END IF;
  IF NEW.attempt_count < OLD.attempt_count
    OR NEW.attempt_count > OLD.attempt_count + 1
  THEN
    RAISE EXCEPTION 'TK Prompt attempt_count 必须保持或恰好加一：table=%', TG_TABLE_NAME;
  END IF;

  IF NEW.attempt_count = OLD.attempt_count + 1 THEN
    IF NEW.status <> claim_status
      OR NEW.claim_token IS NULL
      OR NEW.claim_token IS NOT DISTINCT FROM OLD.claim_token
      OR NEW.started_at IS NULL
      OR (OLD.started_at IS NOT NULL AND NEW.started_at <= OLD.started_at)
      OR NEW.content_purged_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'TK Prompt 新 attempt 必须原子换 claim：table=%', TG_TABLE_NAME;
    END IF;
  ELSIF NOT claim_reset THEN
    IF NEW.started_at IS DISTINCT FROM OLD.started_at THEN
      RAISE EXCEPTION 'TK Prompt started_at 仅能在新 attempt 写入：table=%', TG_TABLE_NAME;
    END IF;
    IF NEW.claim_token IS DISTINCT FROM OLD.claim_token AND NOT (
      OLD.claim_token IS NOT NULL
      AND NEW.claim_token IS NULL
      AND OLD.status = claim_status
      AND NEW.status <> claim_status
    ) THEN
      RAISE EXCEPTION 'TK Prompt claim_token 只能由新 attempt 替换或在离开 claim 状态时清空：table=%',
        TG_TABLE_NAME;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_tk_prompt_run_claim_transition ON tk_prompt_runs;
CREATE TRIGGER trg_validate_tk_prompt_run_claim_transition
BEFORE UPDATE OF status, attempt_count, claim_token, started_at ON tk_prompt_runs
FOR EACH ROW EXECUTE FUNCTION validate_tk_prompt_claim_transition();

DROP TRIGGER IF EXISTS trg_validate_tk_prompt_generation_claim_transition
  ON tk_prompt_generations;
CREATE TRIGGER trg_validate_tk_prompt_generation_claim_transition
BEFORE UPDATE OF status, attempt_count, claim_token, started_at ON tk_prompt_generations
FOR EACH ROW EXECUTE FUNCTION validate_tk_prompt_claim_transition();

DROP TRIGGER IF EXISTS trg_validate_tk_prompt_option_claim_transition ON tk_prompt_options;
CREATE TRIGGER trg_validate_tk_prompt_option_claim_transition
BEFORE UPDATE OF status, attempt_count, claim_token, started_at ON tk_prompt_options
FOR EACH ROW EXECUTE FUNCTION validate_tk_prompt_claim_transition();

CREATE INDEX IF NOT EXISTS idx_tk_prompt_options_generation
  ON tk_prompt_options(generation_id, slot);
CREATE INDEX IF NOT EXISTS idx_tk_prompt_options_recovery
  ON tk_prompt_options(status, started_at, created_at)
  WHERE status IN ('queued', 'processing');

CREATE OR REPLACE FUNCTION validate_tk_prompt_option_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_generation tk_prompt_generations%ROWTYPE;
BEGIN
  SELECT * INTO source_generation
  FROM tk_prompt_generations
  WHERE id = NEW.generation_id;
  IF source_generation.id IS NULL OR source_generation.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'tk_prompt_options 与 generation 用户归属不一致：option=%', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_tk_prompt_option_owner ON tk_prompt_options;
CREATE TRIGGER trg_validate_tk_prompt_option_owner
BEFORE INSERT OR UPDATE OF generation_id, user_id ON tk_prompt_options
FOR EACH ROW EXECUTE FUNCTION validate_tk_prompt_option_owner();

CREATE OR REPLACE FUNCTION validate_tk_prompt_generation_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  completed_options integer;
  completed_slots integer;
BEGIN
  IF NEW.status <> 'completed' OR NEW.content_purged_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*), count(DISTINCT slot)
  INTO completed_options, completed_slots
  FROM tk_prompt_options
  WHERE generation_id = NEW.id
    AND status = 'completed'
    AND content_purged_at IS NULL;
  IF completed_options <> 3 OR completed_slots <> 3 THEN
    RAISE EXCEPTION 'tk_prompt_generations 完成前必须有三个已完成方案：generation=%', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_tk_prompt_generation_completion ON tk_prompt_generations;
CREATE TRIGGER trg_validate_tk_prompt_generation_completion
BEFORE INSERT OR UPDATE OF status, content_purged_at ON tk_prompt_generations
FOR EACH ROW EXECUTE FUNCTION validate_tk_prompt_generation_completion();

CREATE TABLE IF NOT EXISTS tk_prompt_provider_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL UNIQUE,
  run_id uuid NOT NULL REFERENCES tk_prompt_runs(id) ON DELETE RESTRICT,
  generation_id uuid REFERENCES tk_prompt_generations(id) ON DELETE RESTRICT,
  option_id uuid REFERENCES tk_prompt_options(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('analysis', 'strategy', 'option')),
  action text NOT NULL,
  job_attempt integer NOT NULL CHECK (job_attempt > 0),
  claim_token uuid NOT NULL,
  repair_round integer NOT NULL DEFAULT 0 CHECK (repair_round BETWEEN 0 AND 1),
  transport_attempt integer NOT NULL CHECK (transport_attempt > 0),
  provider text NOT NULL,
  model text NOT NULL,
  service_tier text NOT NULL,
  request_status text NOT NULL DEFAULT 'started'
    CHECK (request_status IN ('started', 'succeeded', 'failed')),
  provider_request_id text,
  provider_response_id text,
  x_tt_log_id text,
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  error_code text,
  error_classification text,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  cached_input_tokens integer CHECK (
    cached_input_tokens IS NULL
    OR (
      cached_input_tokens >= 0
      AND input_tokens IS NOT NULL
      AND cached_input_tokens <= input_tokens
    )
  ),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  pricing_rule_id text REFERENCES prompt_wizard_model_pricing_rules(id) ON DELETE RESTRICT,
  price_version text,
  pricing_tier text,
  input_price_per_million_cny numeric(18, 6),
  cached_input_price_per_million_cny numeric(18, 6),
  output_price_per_million_cny numeric(18, 6),
  cost_cny numeric(18, 6),
  cost_status text NOT NULL DEFAULT 'unknown'
    CHECK (cost_status IN ('known', 'unknown')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tk_prompt_provider_requests_owner_shape_check CHECK (
    (stage = 'analysis' AND generation_id IS NULL AND option_id IS NULL)
    OR (stage = 'strategy' AND generation_id IS NOT NULL AND option_id IS NULL)
    OR (stage = 'option' AND generation_id IS NOT NULL AND option_id IS NOT NULL)
  ),
  CONSTRAINT tk_prompt_provider_requests_action_shape_check CHECK (
    (stage = 'analysis' AND action = 'analyze-facts' AND repair_round = 0)
    OR (stage = 'strategy' AND action = 'plan-strategies' AND repair_round = 0)
    OR (
      stage = 'option'
      AND (
        (action = 'generate-option' AND repair_round = 0)
        OR (action = 'repair-option' AND repair_round = 1)
      )
    )
  ),
  CONSTRAINT tk_prompt_provider_requests_terminal_shape_check CHECK (
    (request_status = 'started' AND completed_at IS NULL)
    OR (request_status <> 'started' AND completed_at IS NOT NULL)
  ),
  CONSTRAINT tk_prompt_provider_requests_cost_shape_check CHECK (
    (cost_status = 'unknown' AND cost_cny IS NULL)
    OR (
      cost_status = 'known'
      AND input_tokens IS NOT NULL
      AND cached_input_tokens IS NOT NULL
      AND output_tokens IS NOT NULL
      AND pricing_rule_id IS NOT NULL
      AND price_version IS NOT NULL
      AND pricing_tier IS NOT NULL
      AND input_price_per_million_cny IS NOT NULL
      AND cached_input_price_per_million_cny IS NOT NULL
      AND output_price_per_million_cny IS NOT NULL
      AND cost_cny IS NOT NULL
    )
  )
);

ALTER TABLE tk_prompt_provider_requests
  ADD COLUMN IF NOT EXISTS claim_token uuid;
ALTER TABLE tk_prompt_provider_requests
  DROP CONSTRAINT IF EXISTS tk_prompt_provider_requests_claim_token_check;
-- 若本迁移曾以早期草案运行，旧成本事实无法可靠反推 claim；NOT VALID 仅豁免旧行，
-- PostgreSQL 仍会对后续 INSERT/UPDATE 强制 claim 非空，owner trigger 再核验当前 attempt。
ALTER TABLE tk_prompt_provider_requests
  ADD CONSTRAINT tk_prompt_provider_requests_claim_token_check
  CHECK (claim_token IS NOT NULL) NOT VALID;
ALTER TABLE tk_prompt_provider_requests
  DROP CONSTRAINT IF EXISTS tk_prompt_provider_requests_action_shape_check;
ALTER TABLE tk_prompt_provider_requests
  ADD CONSTRAINT tk_prompt_provider_requests_action_shape_check CHECK (
    (stage = 'analysis' AND action = 'analyze-facts' AND repair_round = 0)
    OR (stage = 'strategy' AND action = 'plan-strategies' AND repair_round = 0)
    OR (
      stage = 'option'
      AND (
        (action = 'generate-option' AND repair_round = 0)
        OR (action = 'repair-option' AND repair_round = 1)
      )
    )
  );

CREATE INDEX IF NOT EXISTS idx_tk_prompt_provider_requests_run_created
  ON tk_prompt_provider_requests(run_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_tk_prompt_provider_requests_generation_created
  ON tk_prompt_provider_requests(generation_id, created_at ASC, id ASC)
  WHERE generation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tk_prompt_provider_requests_option_created
  ON tk_prompt_provider_requests(option_id, created_at ASC, id ASC)
  WHERE option_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tk_prompt_provider_requests_reporting
  ON tk_prompt_provider_requests(created_at DESC, model, stage, request_status);
DROP INDEX IF EXISTS idx_tk_prompt_provider_requests_logical_attempt;
CREATE UNIQUE INDEX idx_tk_prompt_provider_requests_logical_attempt
  ON tk_prompt_provider_requests (
    run_id, generation_id, option_id, stage, action,
    repair_round, transport_attempt
  ) NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION validate_tk_prompt_provider_request_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_run tk_prompt_runs%ROWTYPE;
  source_generation tk_prompt_generations%ROWTYPE;
  source_option tk_prompt_options%ROWTYPE;
  expected_request_key text;
BEGIN
  expected_request_key :=
    'run:' || NEW.run_id::text
    || ':generation:' || coalesce(NEW.generation_id::text, 'none')
    || ':option:' || coalesce(NEW.option_id::text, 'none')
    || ':stage:' || NEW.stage
    || ':action:' || NEW.action
    || ':job:' || NEW.job_attempt::text
    || ':claim:' || NEW.claim_token::text
    || ':repair:' || NEW.repair_round::text
    || ':transport:' || NEW.transport_attempt::text;
  IF NEW.request_key IS DISTINCT FROM expected_request_key THEN
    RAISE EXCEPTION 'tk_prompt_provider_requests request_key 与逻辑 attempt 不一致：request=%', NEW.id;
  END IF;
  -- 与批次终态、来源应用保持 generation → option → run 锁序。
  IF NEW.stage IN ('strategy', 'option') THEN
    SELECT * INTO source_generation
    FROM tk_prompt_generations
    WHERE id = NEW.generation_id
    FOR SHARE;
    IF source_generation.id IS NULL
      OR source_generation.run_id <> NEW.run_id
      OR source_generation.user_id <> NEW.user_id
    THEN
      RAISE EXCEPTION 'tk_prompt_provider_requests 与 generation 归属不一致：request=%', NEW.id;
    END IF;
  END IF;
  IF NEW.stage = 'option' THEN
    SELECT * INTO source_option
    FROM tk_prompt_options
    WHERE id = NEW.option_id
    FOR SHARE;
    IF source_option.id IS NULL
      OR source_option.generation_id <> NEW.generation_id
      OR source_option.user_id <> NEW.user_id
    THEN
      RAISE EXCEPTION 'tk_prompt_provider_requests 与 option 归属不一致：request=%', NEW.id;
    END IF;
  END IF;
  SELECT * INTO source_run
  FROM tk_prompt_runs
  WHERE id = NEW.run_id
  FOR SHARE;
  IF source_run.id IS NULL OR source_run.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'tk_prompt_provider_requests 与 run 用户归属不一致：request=%', NEW.id;
  END IF;

  IF NEW.stage = 'analysis' AND (
    source_run.status <> 'analyzing'
    OR source_run.claim_token IS DISTINCT FROM NEW.claim_token
    OR source_run.attempt_count <> NEW.job_attempt
    OR source_run.content_purged_at IS NOT NULL
    OR source_run.expires_at <= clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'tk_prompt_provider_requests analysis claim 已失效：request=%', NEW.id;
  END IF;
  IF NEW.stage = 'strategy' AND (
    source_run.status <> 'ready'
    OR source_run.content_purged_at IS NOT NULL
    OR source_run.expires_at <= clock_timestamp()
    OR source_generation.status <> 'strategizing'
    OR source_generation.claim_token IS DISTINCT FROM NEW.claim_token
    OR source_generation.attempt_count <> NEW.job_attempt
    OR source_generation.content_purged_at IS NOT NULL
    OR source_generation.expires_at <= clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'tk_prompt_provider_requests strategy claim 已失效：request=%', NEW.id;
  END IF;
  IF NEW.stage = 'option' AND (
    source_run.status <> 'ready'
    OR source_run.content_purged_at IS NOT NULL
    OR source_run.expires_at <= clock_timestamp()
    OR source_generation.status <> 'expanding'
    OR source_generation.content_purged_at IS NOT NULL
    OR source_generation.expires_at <= clock_timestamp()
    OR source_option.status <> 'processing'
    OR source_option.claim_token IS DISTINCT FROM NEW.claim_token
    OR source_option.attempt_count <> NEW.job_attempt
    OR source_option.content_purged_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'tk_prompt_provider_requests option claim 已失效：request=%', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_tk_prompt_provider_request_owner
  ON tk_prompt_provider_requests;
CREATE TRIGGER trg_validate_tk_prompt_provider_request_owner
BEFORE INSERT OR UPDATE OF
  request_key, run_id, generation_id, option_id, user_id,
  stage, action, job_attempt, claim_token, repair_round, transport_attempt
  ON tk_prompt_provider_requests
FOR EACH ROW EXECUTE FUNCTION validate_tk_prompt_provider_request_owner();

CREATE OR REPLACE FUNCTION preserve_tk_prompt_provider_request_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tk_prompt_provider_requests 成本账本禁止删除：request=%', OLD.id;
  END IF;
  IF OLD.request_status <> 'started' THEN
    RAISE EXCEPTION 'tk_prompt_provider_requests 终态禁止修改：request=%', OLD.id;
  END IF;
  IF NEW.request_status = 'started' THEN
    RAISE EXCEPTION 'tk_prompt_provider_requests 只允许从 started 写入一次终态：request=%', OLD.id;
  END IF;
  IF ROW(
    NEW.id, NEW.request_key, NEW.run_id, NEW.generation_id, NEW.option_id,
    NEW.user_id, NEW.stage, NEW.action, NEW.job_attempt, NEW.claim_token, NEW.repair_round,
    NEW.transport_attempt, NEW.provider, NEW.model, NEW.started_at, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.request_key, OLD.run_id, OLD.generation_id, OLD.option_id,
    OLD.user_id, OLD.stage, OLD.action, OLD.job_attempt, OLD.claim_token, OLD.repair_round,
    OLD.transport_attempt, OLD.provider, OLD.model, OLD.started_at, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'tk_prompt_provider_requests 业务身份禁止修改：request=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preserve_tk_prompt_provider_request_ledger
  ON tk_prompt_provider_requests;
CREATE TRIGGER trg_preserve_tk_prompt_provider_request_ledger
BEFORE UPDATE OR DELETE ON tk_prompt_provider_requests
FOR EACH ROW EXECUTE FUNCTION preserve_tk_prompt_provider_request_ledger();

-- 新引擎积分关联独立于 prompt_wizard_batches；旧关联与账务事实不做回填。
ALTER TABLE credit_lots
  DROP CONSTRAINT IF EXISTS credit_lots_source_type_check;
ALTER TABLE credit_lots
  ADD CONSTRAINT credit_lots_source_type_check CHECK (
    source_type IN (
      'order', 'subscription-cycle', 'admin-adjustment', 'legacy',
      'tk-prompt-engine-refund'
    )
  );

ALTER TABLE credit_allocations
  ADD COLUMN IF NOT EXISTS related_tk_prompt_generation_id uuid;
ALTER TABLE credit_allocations
  DROP CONSTRAINT IF EXISTS credit_allocations_tk_prompt_generation_fk;
ALTER TABLE credit_allocations
  ADD CONSTRAINT credit_allocations_tk_prompt_generation_fk
  FOREIGN KEY (related_tk_prompt_generation_id, user_id)
  REFERENCES tk_prompt_generations(id, user_id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE credit_allocations
  DROP CONSTRAINT IF EXISTS credit_allocations_purpose_check;
ALTER TABLE credit_allocations
  ADD CONSTRAINT credit_allocations_purpose_check CHECK (
    purpose IN ('generation', 'prompt-wizard', 'tk-prompt-engine', 'refund', 'adjustment')
  );
ALTER TABLE credit_allocations
  DROP CONSTRAINT IF EXISTS credit_allocations_tk_prompt_owner_shape_check;
ALTER TABLE credit_allocations
  ADD CONSTRAINT credit_allocations_tk_prompt_owner_shape_check CHECK (
    (
      related_tk_prompt_generation_id IS NULL
      AND purpose <> 'tk-prompt-engine'
    )
    OR (
      related_tk_prompt_generation_id IS NOT NULL
      AND purpose = 'tk-prompt-engine'
      AND related_order_id IS NULL
      AND related_job_id IS NULL
      AND related_prompt_batch_id IS NULL
    )
  );
CREATE INDEX IF NOT EXISTS idx_credit_allocations_tk_prompt_generation
  ON credit_allocations(related_tk_prompt_generation_id, status)
  WHERE related_tk_prompt_generation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION preserve_credit_allocation_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.user_id, NEW.lot_id, NEW.business_event_key, NEW.purpose,
    NEW.amount, NEW.related_order_id, NEW.related_job_id,
    NEW.related_prompt_batch_id, NEW.related_tk_prompt_generation_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.user_id, OLD.lot_id, OLD.business_event_key, OLD.purpose,
    OLD.amount, OLD.related_order_id, OLD.related_job_id,
    OLD.related_prompt_batch_id, OLD.related_tk_prompt_generation_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'credit_allocations 业务身份不可修改：allocation=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE credit_ledger
  ADD COLUMN IF NOT EXISTS related_tk_prompt_generation_id uuid;
ALTER TABLE credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_tk_prompt_generation_fk;
ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_tk_prompt_generation_fk
  FOREIGN KEY (related_tk_prompt_generation_id, user_id)
  REFERENCES tk_prompt_generations(id, user_id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_tk_prompt_owner_shape_check;
ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_tk_prompt_owner_shape_check CHECK (
    related_tk_prompt_generation_id IS NULL
    OR (
      related_order_id IS NULL
      AND related_job_id IS NULL
      AND related_asset_id IS NULL
      AND related_prompt_batch_id IS NULL
    )
  );
CREATE INDEX IF NOT EXISTS idx_credit_ledger_tk_prompt_generation
  ON credit_ledger(related_tk_prompt_generation_id, created_at DESC)
  WHERE related_tk_prompt_generation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION preserve_tk_prompt_credit_ledger_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.related_tk_prompt_generation_id IS DISTINCT FROM OLD.related_tk_prompt_generation_id THEN
    RAISE EXCEPTION 'credit_ledger TK Prompt Engine 归属不可修改：ledger=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credit_ledger_preserve_tk_prompt_identity ON credit_ledger;
CREATE TRIGGER credit_ledger_preserve_tk_prompt_identity
BEFORE UPDATE OF related_tk_prompt_generation_id ON credit_ledger
FOR EACH ROW EXECUTE FUNCTION preserve_tk_prompt_credit_ledger_identity();

-- AI Studio / Seedance 来源独立落列；新旧来源严格互斥。
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS tk_prompt_source jsonb;
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS tk_prompt_run_id uuid;
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS tk_prompt_generation_id uuid;
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS tk_prompt_option_id uuid;
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS tk_prompt_schema_version smallint;
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS tk_prompt_edit_bucket text;

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_tk_prompt_run_fk;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_tk_prompt_run_fk
  FOREIGN KEY (tk_prompt_run_id) REFERENCES tk_prompt_runs(id) ON DELETE RESTRICT;
ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_tk_prompt_generation_fk;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_tk_prompt_generation_fk
  FOREIGN KEY (tk_prompt_generation_id) REFERENCES tk_prompt_generations(id) ON DELETE RESTRICT;
ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_tk_prompt_option_fk;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_tk_prompt_option_fk
  FOREIGN KEY (tk_prompt_option_id) REFERENCES tk_prompt_options(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION sync_generation_task_tk_prompt_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_run tk_prompt_runs%ROWTYPE;
  source_generation tk_prompt_generations%ROWTYPE;
  source_option tk_prompt_options%ROWTYPE;
BEGIN
  IF NEW.tk_prompt_source IS NULL THEN
    NEW.tk_prompt_run_id := NULL;
    NEW.tk_prompt_generation_id := NULL;
    NEW.tk_prompt_option_id := NULL;
    NEW.tk_prompt_schema_version := NULL;
    NEW.tk_prompt_edit_bucket := NULL;
    RETURN NEW;
  END IF;
  IF NEW.prompt_wizard_source IS NOT NULL THEN
    RAISE EXCEPTION 'generation_tasks 不能同时关联 Prompt Wizard 与 TK Prompt Engine：task=%', NEW.id;
  END IF;
  IF jsonb_typeof(NEW.tk_prompt_source) <> 'object' THEN
    RAISE EXCEPTION 'generation_tasks.tk_prompt_source 必须为 JSON 对象：task=%', NEW.id;
  END IF;

  NEW.tk_prompt_run_id := (NEW.tk_prompt_source ->> 'runId')::uuid;
  NEW.tk_prompt_generation_id := (NEW.tk_prompt_source ->> 'generationId')::uuid;
  NEW.tk_prompt_option_id := (NEW.tk_prompt_source ->> 'optionId')::uuid;
  NEW.tk_prompt_schema_version := (NEW.tk_prompt_source ->> 'schemaVersion')::smallint;
  NEW.tk_prompt_edit_bucket := NEW.tk_prompt_source ->> 'editBucket';

  SELECT * INTO source_generation
  FROM tk_prompt_generations
  WHERE id = NEW.tk_prompt_generation_id
  FOR SHARE;
  SELECT * INTO source_option
  FROM tk_prompt_options
  WHERE id = NEW.tk_prompt_option_id
  FOR SHARE;
  SELECT * INTO source_run
  FROM tk_prompt_runs
  WHERE id = NEW.tk_prompt_run_id
  FOR SHARE;

  IF NEW.tk_prompt_schema_version IS DISTINCT FROM 1
    OR source_run.id IS NULL
    OR source_generation.id IS NULL
    OR source_option.id IS NULL
    OR source_run.user_id <> NEW.user_id
    OR source_generation.user_id <> NEW.user_id
    OR source_option.user_id <> NEW.user_id
    OR source_generation.run_id <> source_run.id
    OR source_option.generation_id <> source_generation.id
    OR source_run.status <> 'ready'
    OR source_generation.status <> 'completed'
    OR source_option.status <> 'completed'
    OR source_run.content_purged_at IS NOT NULL
    OR source_generation.content_purged_at IS NOT NULL
    OR source_option.content_purged_at IS NOT NULL
    OR source_run.expires_at <= clock_timestamp()
    OR source_generation.expires_at <= clock_timestamp()
    OR source_option.plan IS NULL
    OR jsonb_typeof(source_option.plan) <> 'object'
    OR jsonb_typeof(source_option.plan -> 'executionPrompt') IS DISTINCT FROM 'string'
    OR btrim(source_option.plan ->> 'executionPrompt') = ''
  THEN
    RAISE EXCEPTION 'generation_tasks TK Prompt Engine 来源无效或已过期：task=%', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_generation_task_tk_prompt_source ON generation_tasks;
CREATE TRIGGER trg_sync_generation_task_tk_prompt_source
BEFORE INSERT OR UPDATE OF
  user_id,
  tk_prompt_source, tk_prompt_run_id, tk_prompt_generation_id,
  tk_prompt_option_id, tk_prompt_schema_version, tk_prompt_edit_bucket,
  prompt_wizard_source
ON generation_tasks
FOR EACH ROW EXECUTE FUNCTION sync_generation_task_tk_prompt_source();

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_tk_prompt_source_check;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_tk_prompt_source_check CHECK (
    (
      tk_prompt_source IS NULL
      AND tk_prompt_run_id IS NULL
      AND tk_prompt_generation_id IS NULL
      AND tk_prompt_option_id IS NULL
      AND tk_prompt_schema_version IS NULL
      AND tk_prompt_edit_bucket IS NULL
    )
    OR (
      tk_prompt_source IS NOT NULL
      AND prompt_wizard_source IS NULL
      AND jsonb_typeof(tk_prompt_source) = 'object'
      AND tk_prompt_run_id IS NOT NULL
      AND tk_prompt_generation_id IS NOT NULL
      AND tk_prompt_option_id IS NOT NULL
      AND tk_prompt_schema_version IS NOT NULL
      AND tk_prompt_schema_version = 1
      AND tk_prompt_edit_bucket IS NOT NULL
      AND tk_prompt_edit_bucket IN ('none', 'minor', 'material')
    )
  );

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_prompt_source_exclusive_check;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_prompt_source_exclusive_check CHECK (
    NOT (prompt_wizard_source IS NOT NULL AND tk_prompt_source IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_generation_tasks_tk_prompt_generation
  ON generation_tasks(tk_prompt_generation_id, created_at DESC)
  WHERE tk_prompt_generation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_generation_tasks_tk_prompt_option
  ON generation_tasks(tk_prompt_option_id, created_at DESC)
  WHERE tk_prompt_option_id IS NOT NULL;
