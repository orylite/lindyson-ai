-- Seedance 供应商价格只通过受审迁移发布版本，后台不提供直接改价入口。
CREATE TABLE IF NOT EXISTS provider_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  resolution text NOT NULL,
  has_video_input boolean NOT NULL,
  unit_price_per_million numeric(20,6) NOT NULL CHECK (unit_price_per_million >= 0),
  currency char(3) NOT NULL DEFAULT 'CNY',
  price_version text NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  source_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (provider, model, resolution, has_video_input, price_version)
);

INSERT INTO provider_pricing_rules (
  provider, model, resolution, has_video_input, unit_price_per_million,
  currency, price_version, effective_from, source_url
)
VALUES
  ('volcengine-ark', 'Seedance 2.0', '480p', false, 46, 'CNY', 'volcengine-seedance-2026-07-10', '2026-01-28 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0', '480p', true,  28, 'CNY', 'volcengine-seedance-2026-07-10', '2026-01-28 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0', '720p', false, 46, 'CNY', 'volcengine-seedance-2026-07-10', '2026-01-28 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0', '720p', true,  28, 'CNY', 'volcengine-seedance-2026-07-10', '2026-01-28 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0', '1080p', false, 51, 'CNY', 'volcengine-seedance-2026-07-10', '2026-01-28 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0', '1080p', true,  31, 'CNY', 'volcengine-seedance-2026-07-10', '2026-01-28 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0', '4k', false, 26, 'CNY', 'volcengine-seedance-2026-07-10', '2026-01-28 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0', '4k', true,  16, 'CNY', 'volcengine-seedance-2026-07-10', '2026-01-28 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Fast', '480p', false, 37, 'CNY', 'volcengine-seedance-2026-07-10', '2026-01-28 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Fast', '480p', true,  22, 'CNY', 'volcengine-seedance-2026-07-10', '2026-01-28 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Fast', '720p', false, 37, 'CNY', 'volcengine-seedance-2026-07-10', '2026-01-28 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Fast', '720p', true,  22, 'CNY', 'volcengine-seedance-2026-07-10', '2026-01-28 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Mini', '480p', false, 23, 'CNY', 'volcengine-seedance-2026-07-10', '2026-06-15 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Mini', '480p', true,  14, 'CNY', 'volcengine-seedance-2026-07-10', '2026-06-15 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Mini', '720p', false, 23, 'CNY', 'volcengine-seedance-2026-07-10', '2026-06-15 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Mini', '720p', true,  14, 'CNY', 'volcengine-seedance-2026-07-10', '2026-06-15 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh')
ON CONFLICT (provider, model, resolution, has_video_input, price_version) DO NOTHING;

-- provider_task_attempt 表示真正创建外部任务时的 attempt；租约恢复增加 attempt 时仍沿用它。
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS provider_task_attempt integer,
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_requested_by uuid REFERENCES users(id) ON DELETE SET NULL;

UPDATE generation_tasks
SET provider_task_attempt = attempt
WHERE provider_task_id IS NOT NULL AND provider_task_attempt IS NULL;

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_provider_task_attempt_check;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_provider_task_attempt_check
  CHECK (provider_task_attempt IS NULL OR provider_task_attempt >= 0);

-- 外部任务一旦可能已提交，取消只能进入待终态状态，不能停止供应商成本采集。
ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_processing_stage_check;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_processing_stage_check
  CHECK (processing_stage IN (
    'queued', 'provider-running', 'provider-succeeded',
    'settlement-pending', 'cancel-requested', 'canceled',
    'completed', 'failed'
  ));

ALTER TABLE provider_usage_records
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_task_id text,
  ADD COLUMN IF NOT EXISTS completion_tokens bigint,
  ADD COLUMN IF NOT EXISTS total_tokens bigint,
  ADD COLUMN IF NOT EXISTS billable_tokens bigint,
  ADD COLUMN IF NOT EXISTS billable_basis text,
  ADD COLUMN IF NOT EXISTS resolution text,
  ADD COLUMN IF NOT EXISTS has_video_input boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_version text,
  ADD COLUMN IF NOT EXISTS unit_price_per_million numeric(20,6),
  ADD COLUMN IF NOT EXISTS estimated_cost numeric(20,6),
  ADD COLUMN IF NOT EXISTS currency char(3) NOT NULL DEFAULT 'CNY',
  ADD COLUMN IF NOT EXISTS pricing_status text NOT NULL DEFAULT 'unpriced';

-- 历史记录放入负 attempt 命名空间，避免与迁移后真实 attempt 冲突。
WITH ranked AS (
  SELECT
    id,
    -row_number() OVER (
      PARTITION BY provider, task_id
      ORDER BY coalesce(completed_at, created_at), id
    )::integer AS inferred_attempt
  FROM provider_usage_records
  WHERE task_id IS NOT NULL
)
UPDATE provider_usage_records pur
SET attempt = ranked.inferred_attempt
FROM ranked
WHERE pur.id = ranked.id;

UPDATE provider_usage_records pur
SET provider_task_id = gt.provider_task_id,
    completion_tokens = CASE WHEN pur.usage_unit = 'tokens' THEN pur.raw_units END,
    total_tokens = CASE WHEN pur.usage_unit = 'tokens' THEN pur.deducted_units END,
    billable_tokens = CASE WHEN pur.usage_unit = 'tokens' THEN pur.raw_units END,
    billable_basis = CASE WHEN pur.usage_unit = 'tokens' AND pur.raw_units IS NOT NULL THEN 'legacy_raw_units' END,
    resolution = CASE
      WHEN lower(gt.config->>'resolution') IN ('480p', '720p', '1080p', '4k')
        THEN lower(gt.config->>'resolution')
      ELSE NULL
    END,
    has_video_input = CASE
      WHEN jsonb_typeof(gt.config->'referenceAssets') = 'array' THEN EXISTS (
        SELECT 1
        FROM jsonb_array_elements(gt.config->'referenceAssets') AS reference(item)
        WHERE lower(reference.item->>'type') = 'video'
           OR lower(reference.item->>'role') = 'reference_video'
      )
      ELSE false
    END,
    pricing_status = CASE WHEN pur.usage_unit = 'tokens' THEN 'legacy-inferred' ELSE 'unpriced' END
FROM generation_tasks gt
WHERE pur.task_id = gt.id;

UPDATE provider_usage_records pur
SET price_version = rule.price_version,
    unit_price_per_million = rule.unit_price_per_million,
    estimated_cost = round((pur.billable_tokens::numeric * rule.unit_price_per_million) / 1000000, 6),
    currency = rule.currency
FROM provider_pricing_rules rule
WHERE pur.provider = rule.provider
  AND pur.model = rule.model
  AND pur.resolution = rule.resolution
  AND pur.has_video_input = rule.has_video_input
  AND pur.billable_tokens IS NOT NULL
  AND rule.price_version = 'volcengine-seedance-2026-07-10';

ALTER TABLE provider_usage_records
  DROP CONSTRAINT IF EXISTS provider_usage_records_attempt_check,
  DROP CONSTRAINT IF EXISTS provider_usage_records_tokens_check,
  DROP CONSTRAINT IF EXISTS provider_usage_records_billable_basis_check,
  DROP CONSTRAINT IF EXISTS provider_usage_records_pricing_status_check,
  DROP CONSTRAINT IF EXISTS provider_usage_records_cost_check;

ALTER TABLE provider_usage_records
  ADD CONSTRAINT provider_usage_records_attempt_check CHECK (attempt <> 0 OR task_id IS NULL OR pricing_status <> 'legacy-inferred'),
  ADD CONSTRAINT provider_usage_records_tokens_check CHECK (
    (completion_tokens IS NULL OR completion_tokens >= 0)
    AND (total_tokens IS NULL OR total_tokens >= 0)
    AND (billable_tokens IS NULL OR billable_tokens >= 0)
  ),
  ADD CONSTRAINT provider_usage_records_billable_basis_check CHECK (
    billable_basis IS NULL OR billable_basis IN ('completion_tokens', 'legacy_raw_units')
  ),
  ADD CONSTRAINT provider_usage_records_pricing_status_check CHECK (
    pricing_status IN ('priced', 'unpriced', 'legacy-inferred')
  ),
  ADD CONSTRAINT provider_usage_records_cost_check CHECK (
    (unit_price_per_million IS NULL OR unit_price_per_million >= 0)
    AND (estimated_cost IS NULL OR estimated_cost >= 0)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_usage_records_provider_task_attempt
  ON provider_usage_records(provider, task_id, attempt)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_usage_records_cost_cursor
  ON provider_usage_records((coalesce(completed_at, created_at)) DESC, id DESC)
  INCLUDE (provider, model, billable_tokens, estimated_cost, pricing_status);
