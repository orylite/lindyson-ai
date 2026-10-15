-- 提示词向导：任务、批次、刷新计费与 24 小时内容保留边界。

CREATE TABLE IF NOT EXISTS prompt_wizard_settings (
  singleton_id smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  refresh_credits integer NOT NULL DEFAULT 1 CHECK (refresh_credits >= 0),
  available boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO prompt_wizard_settings (singleton_id, refresh_credits, available)
VALUES (1, 1, true)
ON CONFLICT (singleton_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS prompt_wizard_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'analyzing'
    CHECK (status IN ('analyzing', 'ready', 'failed', 'archived')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  image_asset_ids uuid[] NOT NULL,
  product_profile jsonb,
  creative_brief jsonb,
  video_config jsonb,
  failure_reason text,
  provider_model text,
  provider_interaction_id text,
  provider_input_tokens integer CHECK (provider_input_tokens IS NULL OR provider_input_tokens >= 0),
  provider_output_tokens integer CHECK (provider_output_tokens IS NULL OR provider_output_tokens >= 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_wizard_runs_image_count_check CHECK (
    status = 'archived' OR cardinality(image_asset_ids) BETWEEN 1 AND 9
  ),
  CONSTRAINT prompt_wizard_runs_failure_reason_check CHECK (
    status <> 'failed' OR failure_reason IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_prompt_wizard_runs_user_created
  ON prompt_wizard_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_runs_expiry
  ON prompt_wizard_runs(expires_at)
  WHERE status <> 'archived';

CREATE TABLE IF NOT EXISTS prompt_wizard_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES prompt_wizard_runs(id),
  user_id uuid NOT NULL REFERENCES users(id),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  run_revision integer NOT NULL CHECK (run_revision >= 0),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  is_free boolean NOT NULL DEFAULT false,
  credits integer NOT NULL DEFAULT 0 CHECK (credits >= 0),
  credit_status text NOT NULL DEFAULT 'none'
    CHECK (credit_status IN ('none', 'held', 'settled', 'refunded')),
  main_credits_used integer NOT NULL DEFAULT 0 CHECK (main_credits_used >= 0),
  addon_credits_used integer NOT NULL DEFAULT 0 CHECK (addon_credits_used >= 0),
  image_asset_ids uuid[] NOT NULL,
  product_profile jsonb NOT NULL,
  creative_brief jsonb NOT NULL,
  video_config jsonb NOT NULL,
  plans jsonb,
  strategy_signatures jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_model text,
  provider_interaction_id text,
  provider_input_tokens integer CHECK (provider_input_tokens IS NULL OR provider_input_tokens >= 0),
  provider_output_tokens integer CHECK (provider_output_tokens IS NULL OR provider_output_tokens >= 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  failure_reason text,
  content_purged_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (run_id, ordinal),
  CONSTRAINT prompt_wizard_batches_credit_shape_check CHECK (
    (is_free AND credits = 0 AND credit_status = 'none')
    OR (
      NOT is_free
      AND (
        (credits = 0 AND credit_status = 'none')
        OR (credits > 0 AND credit_status IN ('held', 'settled', 'refunded'))
      )
    )
  ),
  CONSTRAINT prompt_wizard_batches_completed_shape_check CHECK (
    status <> 'completed'
    OR content_purged_at IS NOT NULL
    OR (plans IS NOT NULL AND jsonb_typeof(plans) = 'array' AND jsonb_array_length(plans) = 3)
  ),
  CONSTRAINT prompt_wizard_batches_failed_shape_check CHECK (
    status <> 'failed' OR failure_reason IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_wizard_batches_one_active
  ON prompt_wizard_batches(run_id)
  WHERE status IN ('queued', 'processing');
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_batches_user_created
  ON prompt_wizard_batches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_batches_run_history
  ON prompt_wizard_batches(run_id, ordinal ASC);

ALTER TABLE credit_allocations
  DROP CONSTRAINT IF EXISTS credit_allocations_purpose_check;
ALTER TABLE credit_allocations
  ADD CONSTRAINT credit_allocations_purpose_check
  CHECK (purpose IN ('generation', 'prompt-wizard', 'refund', 'adjustment'));

ALTER TABLE credit_allocations
  ADD COLUMN IF NOT EXISTS related_prompt_batch_id uuid;
ALTER TABLE credit_allocations
  DROP CONSTRAINT IF EXISTS credit_allocations_prompt_batch_fk;
ALTER TABLE credit_allocations
  ADD CONSTRAINT credit_allocations_prompt_batch_fk
  FOREIGN KEY (related_prompt_batch_id) REFERENCES prompt_wizard_batches(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_credit_allocations_prompt_batch
  ON credit_allocations(related_prompt_batch_id, status)
  WHERE related_prompt_batch_id IS NOT NULL;

-- 047 的不可变业务身份在本迁移新增了提示词批次关联后需要同步扩展，
-- 防止账务分配在创建后被改绑到另一批提示词任务。
CREATE OR REPLACE FUNCTION preserve_credit_allocation_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.user_id, NEW.lot_id, NEW.business_event_key, NEW.purpose,
    NEW.amount, NEW.related_order_id, NEW.related_job_id,
    NEW.related_prompt_batch_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.user_id, OLD.lot_id, OLD.business_event_key, OLD.purpose,
    OLD.amount, OLD.related_order_id, OLD.related_job_id,
    OLD.related_prompt_batch_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'credit_allocations 业务身份不可修改：allocation=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE credit_ledger
  ADD COLUMN IF NOT EXISTS related_prompt_batch_id uuid;
ALTER TABLE credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_prompt_batch_fk;
ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_prompt_batch_fk
  FOREIGN KEY (related_prompt_batch_id) REFERENCES prompt_wizard_batches(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_credit_ledger_prompt_batch
  ON credit_ledger(related_prompt_batch_id, created_at DESC)
  WHERE related_prompt_batch_id IS NOT NULL;
