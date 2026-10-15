-- Seedream 5.0 Pro 图片生成：同步响应 checkpoint、不可变逐任务价格证据与 1K/2K 积分。

ALTER TABLE generation_provider_runs
  ADD COLUMN IF NOT EXISTS provider_request_id text,
  ADD COLUMN IF NOT EXISTS provider_response_checkpoint jsonb,
  ADD COLUMN IF NOT EXISTS provider_response_url text,
  ADD COLUMN IF NOT EXISTS provider_response_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_response_url_expires_at timestamptz;

ALTER TABLE generation_provider_runs
  DROP CONSTRAINT IF EXISTS generation_provider_runs_response_checkpoint_check;
ALTER TABLE generation_provider_runs
  ADD CONSTRAINT generation_provider_runs_response_checkpoint_check CHECK (
    provider_response_checkpoint IS NULL
    OR (
      jsonb_typeof(provider_response_checkpoint) = 'object'
      AND provider_task_id IS NOT NULL
      AND provider_response_observed_at IS NOT NULL
      AND provider_response_url_expires_at IS NOT NULL
      AND provider_response_url_expires_at > provider_response_observed_at
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_provider_runs_provider_request
  ON generation_provider_runs(provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_provider_runs_seedream_checkpoint_recovery
  ON generation_provider_runs(status, provider_response_url_expires_at, created_at)
  WHERE provider_response_checkpoint IS NOT NULL
    AND status IN ('provider-succeeded', 'archiving', 'settlement-pending', 'delivery-failed');

CREATE OR REPLACE FUNCTION preserve_generation_provider_run_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.task_id, NEW.task_attempt, NEW.provider, NEW.request_hash,
    NEW.submission_key, NEW.callback_token, NEW.output_object_key,
    NEW.thumbnail_object_key, NEW.staging_object_key
  ) IS DISTINCT FROM ROW(
    OLD.task_id, OLD.task_attempt, OLD.provider, OLD.request_hash,
    OLD.submission_key, OLD.callback_token, OLD.output_object_key,
    OLD.thumbnail_object_key, OLD.staging_object_key
  ) THEN
    RAISE EXCEPTION 'generation_provider_runs 业务身份或对象路径不可修改：run=%', OLD.id;
  END IF;
  IF OLD.provider_task_id IS NOT NULL
     AND NEW.provider_task_id IS DISTINCT FROM OLD.provider_task_id THEN
    RAISE EXCEPTION 'generation_provider_runs.provider_task_id 不可替换：run=%', OLD.id;
  END IF;
  IF OLD.provider_request_id IS NOT NULL
     AND NEW.provider_request_id IS DISTINCT FROM OLD.provider_request_id THEN
    RAISE EXCEPTION 'generation_provider_runs.provider_request_id 不可替换：run=%', OLD.id;
  END IF;
  IF OLD.provider_response_checkpoint IS NOT NULL
     AND NEW.provider_response_checkpoint IS DISTINCT FROM OLD.provider_response_checkpoint THEN
    RAISE EXCEPTION 'generation_provider_runs.provider_response_checkpoint 不可替换：run=%', OLD.id;
  END IF;
  IF OLD.provider_response_url IS NOT NULL
     AND NEW.provider_response_url IS NOT NULL
     AND NEW.provider_response_url IS DISTINCT FROM OLD.provider_response_url THEN
    RAISE EXCEPTION 'generation_provider_runs.provider_response_url 不可替换：run=%', OLD.id;
  END IF;
  IF OLD.provider_response_url IS NULL
     AND OLD.provider_response_checkpoint IS NOT NULL
     AND NEW.provider_response_url IS NOT NULL THEN
    RAISE EXCEPTION 'generation_provider_runs.provider_response_url 清除后不可恢复：run=%', OLD.id;
  END IF;
  IF OLD.provider_response_observed_at IS NOT NULL
     AND NEW.provider_response_observed_at IS DISTINCT FROM OLD.provider_response_observed_at THEN
    RAISE EXCEPTION 'generation_provider_runs.provider_response_observed_at 不可替换：run=%', OLD.id;
  END IF;
  IF OLD.provider_response_url_expires_at IS NOT NULL
     AND NEW.provider_response_url_expires_at IS DISTINCT FROM OLD.provider_response_url_expires_at THEN
    RAISE EXCEPTION 'generation_provider_runs.provider_response_url_expires_at 不可替换：run=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS image_provider_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  price_version text NOT NULL,
  pricing_source_url text NOT NULL,
  currency text NOT NULL CHECK (currency = 'CNY'),
  first_reference_images_free integer NOT NULL CHECK (first_reference_images_free = 1),
  additional_reference_unit_price_cny numeric(20, 6) NOT NULL CHECK (additional_reference_unit_price_cny >= 0),
  output_pixel_threshold bigint NOT NULL CHECK (output_pixel_threshold > 0),
  small_output_price_cny numeric(20, 6) NOT NULL CHECK (small_output_price_cny >= 0),
  large_output_price_cny numeric(20, 6) NOT NULL CHECK (large_output_price_cny >= small_output_price_cny),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, model, price_version)
);

INSERT INTO image_provider_pricing_rules (
  provider, model, price_version, pricing_source_url, currency,
  first_reference_images_free, additional_reference_unit_price_cny,
  output_pixel_threshold, small_output_price_cny, large_output_price_cny
) VALUES (
  'volcengine-ark',
  'Seedream 5.0 Pro',
  'volcengine-seedream-5.0-pro-list-2026-07-27',
  'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
  'CNY', 1, 0.020000, 2360000, 0.300000, 0.600000
)
ON CONFLICT (provider, model, price_version) DO NOTHING;

CREATE TABLE IF NOT EXISTS image_provider_usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES generation_tasks(id) ON DELETE RESTRICT,
  provider_run_id uuid NOT NULL REFERENCES generation_provider_runs(id) ON DELETE RESTRICT,
  attempt integer NOT NULL CHECK (attempt >= 0),
  provider text NOT NULL,
  model text NOT NULL,
  provider_operation_id text,
  provider_request_id text,
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  request_evidence_status text NOT NULL CHECK (request_evidence_status IN ('provider-id', 'local-only', 'missing')),
  evidence_status text NOT NULL CHECK (evidence_status IN ('known', 'missing-evidence')),
  reference_image_count integer CHECK (reference_image_count >= 0),
  additional_reference_image_count integer CHECK (additional_reference_image_count >= 0),
  output_width integer CHECK (output_width > 0),
  output_height integer CHECK (output_height > 0),
  output_pixels bigint CHECK (output_pixels > 0),
  output_tier text CHECK (output_tier IN ('small', 'large')),
  reference_unit_price_cny numeric(20, 6) NOT NULL CHECK (reference_unit_price_cny >= 0),
  reference_price_cny numeric(20, 6),
  output_pixel_threshold bigint NOT NULL CHECK (output_pixel_threshold > 0),
  small_output_price_cny numeric(20, 6) NOT NULL CHECK (small_output_price_cny >= 0),
  large_output_price_cny numeric(20, 6) NOT NULL CHECK (large_output_price_cny >= small_output_price_cny),
  output_price_cny numeric(20, 6),
  estimated_cost_cny numeric(20, 6),
  currency text NOT NULL CHECK (currency = 'CNY'),
  pricing_status text NOT NULL CHECK (pricing_status IN ('priced', 'missing-evidence')),
  price_version text NOT NULL,
  pricing_source_url text NOT NULL,
  generated_images integer CHECK (generated_images >= 0),
  output_tokens bigint CHECK (output_tokens >= 0),
  total_tokens bigint CHECK (total_tokens >= 0),
  provider_terminal_at timestamptz,
  usage_observed_at timestamptz NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_run_id),
  UNIQUE (task_id, attempt),
  CHECK (
    (evidence_status = 'known'
      AND reference_image_count IS NOT NULL
      AND additional_reference_image_count IS NOT NULL
      AND output_width IS NOT NULL AND output_height IS NOT NULL AND output_pixels IS NOT NULL
      AND output_tier IS NOT NULL
      AND reference_price_cny IS NOT NULL AND output_price_cny IS NOT NULL AND estimated_cost_cny IS NOT NULL
      AND pricing_status = 'priced')
    OR
    (evidence_status = 'missing-evidence'
      AND reference_price_cny IS NULL AND output_price_cny IS NULL AND estimated_cost_cny IS NULL
      AND pricing_status = 'missing-evidence')
  )
);

CREATE INDEX IF NOT EXISTS idx_image_provider_usage_records_created
  ON image_provider_usage_records(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_image_provider_usage_records_model
  ON image_provider_usage_records(model, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_provider_usage_records_request
  ON image_provider_usage_records(provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION reject_image_provider_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Seedream 图片价格证据为不可变事实，禁止 %：record=%', TG_OP, OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS image_provider_usage_records_immutable ON image_provider_usage_records;
CREATE TRIGGER image_provider_usage_records_immutable
BEFORE UPDATE OR DELETE ON image_provider_usage_records
FOR EACH ROW EXECUTE FUNCTION reject_image_provider_evidence_mutation();

CREATE OR REPLACE FUNCTION reject_image_provider_pricing_rule_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Seedream 图片价格规则为受审不可变事实，禁止 %：rule=%', TG_OP, OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS image_provider_pricing_rules_immutable ON image_provider_pricing_rules;
CREATE TRIGGER image_provider_pricing_rules_immutable
BEFORE UPDATE OR DELETE ON image_provider_pricing_rules
FOR EACH ROW EXECUTE FUNCTION reject_image_provider_pricing_rule_mutation();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM consumption_settings
    WHERE kind = 'image' AND model = 'GPT Image 2.0' AND available = true
  ) THEN
    RAISE EXCEPTION '旧 GPT Image 图片积分占位被意外启用，需先人工复核';
  END IF;
END
$$;

DELETE FROM consumption_settings
WHERE kind = 'image' AND model = 'GPT Image 2.0' AND available = false;

INSERT INTO consumption_settings (
  kind, model, model_label, duration_seconds, resolution,
  credits, reference_video_credits, available
) VALUES
  ('image', 'Seedream 5.0 Pro', 'Seedream 5.0 Pro', 0, '1K', 14, NULL, false),
  ('image', 'Seedream 5.0 Pro', 'Seedream 5.0 Pro', 0, '2K', 28, NULL, false)
ON CONFLICT (kind, model, duration_seconds, resolution) DO UPDATE
SET model_label = EXCLUDED.model_label,
    credits = EXCLUDED.credits,
    reference_video_credits = NULL,
    available = consumption_settings.available,
    updated_at = now();
