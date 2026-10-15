-- 费用中心二期采用添加式迁移：旧字段继续作为兼容投影，新字段表达证据、计价和对账三个独立维度。
ALTER TABLE provider_usage_records
  ADD COLUMN IF NOT EXISTS usage_evidence_origin text NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS pricing_rule_status text NOT NULL DEFAULT 'rule-missing',
  ADD COLUMN IF NOT EXISTS pricing_input_class text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS pricing_resolution_band text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS attribution_confidence text NOT NULL DEFAULT 'unallocated',
  ADD COLUMN IF NOT EXISTS provider_terminal_at timestamptz,
  ADD COLUMN IF NOT EXISTS usage_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS local_accounting_date date,
  ADD COLUMN IF NOT EXISTS accounting_date_origin text NOT NULL DEFAULT 'unavailable';

ALTER TABLE provider_usage_records
  DROP CONSTRAINT IF EXISTS provider_usage_records_usage_evidence_origin_check,
  DROP CONSTRAINT IF EXISTS provider_usage_records_pricing_rule_status_check,
  DROP CONSTRAINT IF EXISTS provider_usage_records_pricing_input_class_check,
  DROP CONSTRAINT IF EXISTS provider_usage_records_pricing_resolution_band_check,
  DROP CONSTRAINT IF EXISTS provider_usage_records_attribution_confidence_check,
  DROP CONSTRAINT IF EXISTS provider_usage_records_accounting_date_origin_check;

ALTER TABLE provider_usage_records
  ADD CONSTRAINT provider_usage_records_usage_evidence_origin_check CHECK (
    usage_evidence_origin IN ('provider-reported', 'legacy-raw', 'official-bill-inferred', 'unavailable')
  ),
  ADD CONSTRAINT provider_usage_records_pricing_rule_status_check CHECK (
    pricing_rule_status IN ('priced', 'rule-missing', 'unsupported')
  ),
  ADD CONSTRAINT provider_usage_records_pricing_input_class_check CHECK (
    pricing_input_class IN ('without-video', 'with-video', 'unknown')
  ),
  ADD CONSTRAINT provider_usage_records_pricing_resolution_band_check CHECK (
    pricing_resolution_band IN ('480p-720p', '1080p', '4k', 'unknown')
  ),
  ADD CONSTRAINT provider_usage_records_attribution_confidence_check CHECK (
    attribution_confidence IN ('direct', 'high', 'medium', 'low', 'unallocated')
  ),
  ADD CONSTRAINT provider_usage_records_accounting_date_origin_check CHECK (
    accounting_date_origin IN (
      'provider-terminal', 'usage-observed', 'legacy-completed',
      'official-bill-inferred', 'historical-local-time', 'unavailable'
    )
  );

UPDATE provider_usage_records
SET usage_evidence_origin = CASE
      WHEN completion_tokens IS NOT NULL AND billable_basis = 'completion_tokens' THEN 'provider-reported'
      WHEN billable_basis = 'legacy_raw_units' THEN 'legacy-raw'
      ELSE 'unavailable'
    END,
    pricing_rule_status = CASE
      WHEN price_version IS NOT NULL AND unit_price_per_million IS NOT NULL AND estimated_cost IS NOT NULL THEN 'priced'
      ELSE 'rule-missing'
    END,
    pricing_input_class = CASE
      WHEN has_video_input THEN 'with-video'
      WHEN resolution IS NOT NULL THEN 'without-video'
      ELSE 'unknown'
    END,
    pricing_resolution_band = CASE
      WHEN lower(resolution) IN ('480p', '720p') THEN '480p-720p'
      WHEN lower(resolution) = '1080p' THEN '1080p'
      WHEN lower(resolution) = '4k' THEN '4k'
      ELSE 'unknown'
    END,
    attribution_confidence = CASE
      WHEN completion_tokens IS NOT NULL AND billable_basis = 'completion_tokens' THEN 'direct'
      WHEN billable_basis = 'legacy_raw_units' THEN 'medium'
      ELSE 'unallocated'
    END,
    usage_observed_at = coalesce(completed_at, created_at),
    local_accounting_date = (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date,
    accounting_date_origin = 'legacy-completed';

-- 六条已通过正式账单逐行审核的记录使用确定性任务清单标记，禁止从 error 文本反推。
UPDATE provider_usage_records
SET usage_evidence_origin = 'official-bill-inferred',
    attribution_confidence = 'high',
    accounting_date_origin = 'official-bill-inferred'
WHERE task_id IN (
  '8decb084-3961-4617-b9d8-206ebd8946a6'::uuid,
  '5ba32d13-222f-4529-8e66-84c28269b6b2'::uuid,
  '4cb64976-6f61-49a6-9b5d-c9df6e9ca31a'::uuid,
  'b30cebd6-2e28-4b4d-9338-87d11f180bd1'::uuid,
  '594a9f42-aca0-4b8c-aa6d-e892a9753721'::uuid,
  'c11fe67b-a482-4773-ada9-53dfc12cfb04'::uuid
)
  AND billable_tokens IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_usage_records_accounting_dimensions
  ON provider_usage_records(
    provider, local_accounting_date, model, pricing_resolution_band,
    pricing_input_class, usage_evidence_origin
  )
  INCLUDE (billable_tokens, estimated_cost, unit_price_per_million, currency);

ALTER TABLE provider_bill_details
  ADD COLUMN IF NOT EXISTS bill_line_type text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS normalized_unit_price_per_million numeric(20,6),
  ADD COLUMN IF NOT EXISTS normalization_version text NOT NULL DEFAULT 'volcengine-billing-v1';

ALTER TABLE provider_bill_details
  DROP CONSTRAINT IF EXISTS provider_bill_details_bill_line_type_check,
  DROP CONSTRAINT IF EXISTS provider_bill_details_normalized_unit_price_check;

ALTER TABLE provider_bill_details
  ADD CONSTRAINT provider_bill_details_bill_line_type_check CHECK (
    bill_line_type IN ('usage', 'package-purchase', 'refund', 'adjustment', 'other')
  ),
  ADD CONSTRAINT provider_bill_details_normalized_unit_price_check CHECK (
    normalized_unit_price_per_million IS NULL OR normalized_unit_price_per_million >= 0
  );

UPDATE provider_bill_details
SET bill_line_type = CASE
      WHEN coalesce(bill_category, '') ~* '(退款|退订|refund)' THEN 'refund'
      WHEN coalesce(bill_category, '') ~* '(调账|调整|adjust)' THEN 'adjustment'
      WHEN coalesce(bill_category, '') ~* '(新购|购买|purchase)'
        OR (
          coalesce(billing_mode, '') ~* '(预付|prepaid)'
          AND coalesce(config_name, '') ~* '(资源包|package|pack_)'
        ) THEN 'package-purchase'
      WHEN usage_count IS NOT NULL AND nullif(trim(coalesce(usage_unit, '')), '') IS NOT NULL THEN 'usage'
      ELSE 'other'
    END,
    normalized_unit_price_per_million = CASE
      WHEN price IS NULL OR price <= 0 THEN NULL
      WHEN coalesce(bill_category, '') ~* '(退款|退订|refund|调账|调整|adjust)' THEN NULL
      WHEN price_unit ~* '(百万|million|mtoken|1m)' THEN price
      WHEN price_unit ~* '(千|ktoken|1k)' THEN price * 1000
      WHEN price_unit ~* '(token|令牌)' THEN price * 1000000
      ELSE NULL
    END,
    normalization_version = 'volcengine-billing-v2';

CREATE TABLE IF NOT EXISTS provider_bill_detail_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  source_detail_key text NOT NULL,
  sync_run_id uuid NOT NULL REFERENCES provider_billing_sync_runs(id) ON DELETE RESTRICT,
  payload_hash char(64) NOT NULL,
  raw_payload jsonb NOT NULL,
  normalized_payload jsonb NOT NULL,
  normalization_version text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, source_detail_key, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_provider_bill_detail_revisions_source
  ON provider_bill_detail_revisions(provider, source_detail_key, observed_at DESC);

CREATE TABLE IF NOT EXISTS provider_bill_sync_run_items (
  sync_run_id uuid NOT NULL REFERENCES provider_billing_sync_runs(id) ON DELETE CASCADE,
  bill_detail_revision_id uuid NOT NULL REFERENCES provider_bill_detail_revisions(id) ON DELETE RESTRICT,
  source_detail_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sync_run_id, source_detail_key),
  UNIQUE (sync_run_id, bill_detail_revision_id)
);

ALTER TABLE provider_bill_details
  ADD COLUMN IF NOT EXISTS current_revision_id uuid REFERENCES provider_bill_detail_revisions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_provider_bill_details_line_dimensions
  ON provider_bill_details(
    provider, bill_period, expense_date, bill_line_type, recognized_model,
    pricing_resolution, pricing_input_has_video, normalized_unit_price_per_million
  ) WHERE active = true;

CREATE TABLE IF NOT EXISTS provider_resource_package_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  sync_run_id uuid NOT NULL REFERENCES provider_billing_sync_runs(id) ON DELETE RESTRICT,
  package_id text NOT NULL,
  product text NOT NULL,
  config text NOT NULL,
  recognized_model text NOT NULL,
  status text NOT NULL,
  total_quota bigint NOT NULL CHECK (total_quota >= 0),
  remaining_quota bigint NOT NULL CHECK (remaining_quota >= 0),
  starts_at timestamptz,
  expires_at timestamptz,
  payload_hash char(64) NOT NULL,
  raw_payload jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sync_run_id, package_id),
  CHECK (remaining_quota <= total_quota)
);

CREATE INDEX IF NOT EXISTS idx_provider_resource_package_snapshots_history
  ON provider_resource_package_snapshots(provider, package_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS provider_resource_package_acquisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  package_id text NOT NULL,
  bill_source_detail_key text NOT NULL,
  bill_detail_id uuid REFERENCES provider_bill_details(id) ON DELETE SET NULL,
  current_revision_id uuid REFERENCES provider_bill_detail_revisions(id) ON DELETE SET NULL,
  acquisition_date date NOT NULL,
  acquired_quota bigint CHECK (acquired_quota IS NULL OR acquired_quota >= 0),
  original_amount_cny numeric(20,6),
  payable_amount_cny numeric(20,6),
  paid_amount_cny numeric(20,6),
  unpaid_amount_cny numeric(20,6),
  currency char(3) NOT NULL DEFAULT 'CNY',
  cost_basis_status text NOT NULL DEFAULT 'matched',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, bill_source_detail_key),
  CHECK (cost_basis_status IN ('matched', 'missing-bill', 'revised'))
);

CREATE INDEX IF NOT EXISTS idx_provider_resource_package_acquisitions_package
  ON provider_resource_package_acquisitions(provider, package_id, acquisition_date);

-- 036 上线前已经同步的资源包购买账单必须先形成购置基础；仅使用 instance_no
-- 精确关联资源包，禁止根据配置名称猜测实例。
INSERT INTO provider_resource_package_acquisitions (
  provider, package_id, bill_source_detail_key, bill_detail_id,
  current_revision_id, acquisition_date, acquired_quota,
  original_amount_cny, payable_amount_cny, paid_amount_cny,
  unpaid_amount_cny, currency, cost_basis_status, updated_at
)
SELECT
  details.provider,
  details.instance_no,
  details.source_detail_key,
  details.id,
  details.current_revision_id,
  details.expense_date,
  packages.total_quota::bigint,
  details.original_bill_amount_cny,
  details.payable_amount_cny,
  details.paid_amount_cny,
  details.unpaid_amount_cny,
  details.currency,
  'matched',
  now()
FROM provider_bill_details details
LEFT JOIN provider_resource_packages packages
  ON packages.provider = details.provider
 AND packages.package_id = details.instance_no
WHERE details.bill_line_type = 'package-purchase'
  AND details.instance_no IS NOT NULL
  AND details.currency = 'CNY'
  AND coalesce(details.payable_amount_cny, details.paid_amount_cny) >= 0
  AND details.recognized_model IN ('Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini')
ON CONFLICT (provider, bill_source_detail_key) DO UPDATE SET
  package_id = EXCLUDED.package_id,
  bill_detail_id = EXCLUDED.bill_detail_id,
  current_revision_id = coalesce(
    provider_resource_package_acquisitions.current_revision_id,
    EXCLUDED.current_revision_id
  ),
  acquisition_date = EXCLUDED.acquisition_date,
  acquired_quota = coalesce(
    provider_resource_package_acquisitions.acquired_quota,
    EXCLUDED.acquired_quota
  ),
  original_amount_cny = EXCLUDED.original_amount_cny,
  payable_amount_cny = EXCLUDED.payable_amount_cny,
  paid_amount_cny = EXCLUDED.paid_amount_cny,
  unpaid_amount_cny = EXCLUDED.unpaid_amount_cny,
  currency = EXCLUDED.currency,
  updated_at = CASE
    WHEN (
      provider_resource_package_acquisitions.package_id,
      provider_resource_package_acquisitions.bill_detail_id,
      provider_resource_package_acquisitions.current_revision_id,
      provider_resource_package_acquisitions.acquisition_date,
      provider_resource_package_acquisitions.acquired_quota,
      provider_resource_package_acquisitions.original_amount_cny,
      provider_resource_package_acquisitions.payable_amount_cny,
      provider_resource_package_acquisitions.paid_amount_cny,
      provider_resource_package_acquisitions.unpaid_amount_cny,
      provider_resource_package_acquisitions.currency
    ) IS DISTINCT FROM (
      EXCLUDED.package_id,
      EXCLUDED.bill_detail_id,
      coalesce(provider_resource_package_acquisitions.current_revision_id, EXCLUDED.current_revision_id),
      EXCLUDED.acquisition_date,
      coalesce(provider_resource_package_acquisitions.acquired_quota, EXCLUDED.acquired_quota),
      EXCLUDED.original_amount_cny,
      EXCLUDED.payable_amount_cny,
      EXCLUDED.paid_amount_cny,
      EXCLUDED.unpaid_amount_cny,
      EXCLUDED.currency
    ) THEN now()
    ELSE provider_resource_package_acquisitions.updated_at
  END;

CREATE TABLE IF NOT EXISTS provider_resource_package_cost_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  package_id text NOT NULL,
  source_snapshot_id uuid REFERENCES provider_resource_package_snapshots(id) ON DELETE RESTRICT,
  source_bill_detail_revision_id uuid REFERENCES provider_bill_detail_revisions(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  event_date date NOT NULL,
  quota_delta bigint NOT NULL,
  allocated_cost_cny numeric(20,6),
  cost_basis_status text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (event_type IN ('opening-balance', 'consumption', 'expiry-writeoff', 'refund', 'adjustment')),
  CHECK (cost_basis_status IN ('allocated', 'missing-acquisition', 'opening-unallocated')),
  UNIQUE (provider, package_id, source_snapshot_id, event_type),
  UNIQUE (provider, package_id, source_bill_detail_revision_id, event_type),
  CHECK (source_snapshot_id IS NOT NULL OR source_bill_detail_revision_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_provider_resource_package_cost_events_date
  ON provider_resource_package_cost_events(provider, event_date, package_id);

CREATE TABLE IF NOT EXISTS provider_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  bill_period text NOT NULL,
  window_start date NOT NULL,
  window_end date NOT NULL,
  official_sync_run_id uuid REFERENCES provider_billing_sync_runs(id) ON DELETE SET NULL,
  local_cutoff timestamptz NOT NULL,
  normalization_version text NOT NULL,
  official_snapshot_hash char(64) NOT NULL,
  local_snapshot_hash char(64) NOT NULL,
  bill_state text NOT NULL,
  match_state text NOT NULL,
  coverage_state text NOT NULL,
  raw_local_tokens bigint NOT NULL DEFAULT 0,
  raw_local_cost_cny numeric(20,6) NOT NULL DEFAULT 0,
  inferred_adjustment_tokens bigint NOT NULL DEFAULT 0,
  inferred_adjustment_cost_cny numeric(20,6) NOT NULL DEFAULT 0,
  adjusted_local_tokens bigint NOT NULL DEFAULT 0,
  adjusted_local_cost_cny numeric(20,6) NOT NULL DEFAULT 0,
  official_tokens bigint NOT NULL DEFAULT 0,
  official_cost_cny numeric(20,6) NOT NULL DEFAULT 0,
  residual_tokens bigint NOT NULL DEFAULT 0,
  residual_cost_cny numeric(20,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (bill_period ~ '^\d{4}-\d{2}$'),
  CHECK (window_start <= window_end),
  CHECK (bill_state IN ('unavailable', 'provisional', 'final', 'reopened')),
  CHECK (match_state IN ('cannot-reconcile', 'raw-matched', 'adjusted-matched', 'residual')),
  CHECK (coverage_state IN ('complete', 'partial', 'stale'))
);

CREATE INDEX IF NOT EXISTS idx_provider_reconciliation_runs_latest
  ON provider_reconciliation_runs(provider, bill_period, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_reconciliation_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_run_id uuid NOT NULL REFERENCES provider_reconciliation_runs(id) ON DELETE CASCADE,
  provider text NOT NULL,
  bill_period text NOT NULL,
  expense_date date,
  bill_line_type text NOT NULL,
  product text NOT NULL,
  recognized_model text,
  pricing_resolution_band text NOT NULL,
  pricing_input_class text NOT NULL,
  unit_price_per_million numeric(20,6),
  currency char(3) NOT NULL DEFAULT 'CNY',
  raw_local_tokens bigint NOT NULL DEFAULT 0,
  raw_local_cost_cny numeric(20,6) NOT NULL DEFAULT 0,
  inferred_adjustment_tokens bigint NOT NULL DEFAULT 0,
  inferred_adjustment_cost_cny numeric(20,6) NOT NULL DEFAULT 0,
  adjusted_local_tokens bigint NOT NULL DEFAULT 0,
  adjusted_local_cost_cny numeric(20,6) NOT NULL DEFAULT 0,
  official_tokens bigint NOT NULL DEFAULT 0,
  official_cost_cny numeric(20,6) NOT NULL DEFAULT 0,
  timing_adjustment_tokens bigint NOT NULL DEFAULT 0,
  timing_adjustment_cost_cny numeric(20,6) NOT NULL DEFAULT 0,
  rate_variance_cny numeric(20,6),
  rounding_variance_cny numeric(20,6),
  residual_tokens bigint NOT NULL DEFAULT 0,
  residual_cost_cny numeric(20,6) NOT NULL DEFAULT 0,
  status text NOT NULL,
  CHECK (bill_line_type IN ('usage', 'package-purchase', 'refund', 'adjustment', 'other')),
  CHECK (pricing_resolution_band IN ('480p-720p', '1080p', '4k', 'unknown')),
  CHECK (pricing_input_class IN ('without-video', 'with-video', 'unknown')),
  CHECK (status IN ('raw-matched', 'adjusted-matched', 'residual', 'not-comparable'))
);

CREATE INDEX IF NOT EXISTS idx_provider_reconciliation_buckets_dimensions
  ON provider_reconciliation_buckets(
    reconciliation_run_id, expense_date, recognized_model,
    pricing_resolution_band, pricing_input_class
  );

CREATE TABLE IF NOT EXISTS provider_reconciliation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  case_key text NOT NULL,
  bill_period text NOT NULL,
  case_type text NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  root_cause text NOT NULL,
  confidence text NOT NULL,
  token_adjustment bigint NOT NULL DEFAULT 0,
  cost_adjustment_cny numeric(20,6) NOT NULL DEFAULT 0,
  official_expense_date date,
  local_accounting_date date,
  evidence jsonb NOT NULL,
  evidence_hash char(64) NOT NULL,
  supersedes_case_id uuid REFERENCES provider_reconciliation_cases(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, case_key),
  CHECK (case_type IN ('missing-local-usage', 'cross-date', 'scope-mismatch', 'rate-mismatch', 'rounding', 'other')),
  CHECK (status IN ('open', 'approved', 'superseded')),
  CHECK (confidence IN ('direct', 'high', 'medium', 'low', 'unallocated'))
);

CREATE INDEX IF NOT EXISTS idx_provider_reconciliation_cases_period
  ON provider_reconciliation_cases(provider, bill_period, case_type, status);

CREATE TABLE IF NOT EXISTS provider_reconciliation_case_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES provider_reconciliation_cases(id) ON DELETE CASCADE,
  usage_record_id uuid REFERENCES provider_usage_records(id) ON DELETE SET NULL,
  bill_detail_id uuid REFERENCES provider_bill_details(id) ON DELETE SET NULL,
  bill_detail_revision_id uuid REFERENCES provider_bill_detail_revisions(id) ON DELETE SET NULL,
  allocated_tokens bigint NOT NULL DEFAULT 0,
  allocated_cost_cny numeric(20,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_reconciliation_case_links_case
  ON provider_reconciliation_case_links(case_id);

-- 将已审核的六条历史漏采及一条跨日偏移保存为结构化案件，供后续对账快照引用。
WITH evidence(task_id, detail_key, tokens, cost, root_cause) AS (
  VALUES
    ('8decb084-3961-4617-b9d8-206ebd8946a6'::uuid, 'Detail7657484265949745423', 108900::bigint, 2.504700::numeric, 'archive-or-hash-failure'),
    ('5ba32d13-222f-4529-8e66-84c28269b6b2'::uuid, 'Detail7657500475047252258', 324900::bigint, 7.472700::numeric, 'archive-or-hash-failure'),
    ('4cb64976-6f61-49a6-9b5d-c9df6e9ca31a'::uuid, 'Detail7657821306821447987', 324900::bigint, 7.472700::numeric, 'post-submit-cancellation-race'),
    ('b30cebd6-2e28-4b4d-9338-87d11f180bd1'::uuid, 'Detail7657823018853683466', 324900::bigint, 12.021300::numeric, 'post-submit-cancellation-race'),
    ('594a9f42-aca0-4b8c-aa6d-e892a9753721'::uuid, 'Detail7660684150990934307', 50638::bigint, 1.164674::numeric, 'post-submit-cancellation-race'),
    ('c11fe67b-a482-4773-ada9-53dfc12cfb04'::uuid, 'Detail7661185007071236404', 50638::bigint, 2.329348::numeric, 'post-submit-cancellation-race')
), inserted AS (
  INSERT INTO provider_reconciliation_cases (
    provider, case_key, bill_period, case_type, status, root_cause, confidence,
    token_adjustment, cost_adjustment_cny, evidence, evidence_hash
  )
  SELECT
    'volcengine-ark', 'history-backfill:' || task_id::text, '2026-07',
    'missing-local-usage', 'approved', root_cause, 'high', tokens, cost,
    jsonb_build_object('taskId', task_id, 'officialDetailKey', detail_key, 'version', '2026-07-13-v1'),
    encode(digest(task_id::text || ':' || detail_key || ':2026-07-13-v1', 'sha256'), 'hex')
  FROM evidence
  WHERE EXISTS (SELECT 1 FROM provider_usage_records pur WHERE pur.task_id = evidence.task_id)
  ON CONFLICT (provider, case_key) DO NOTHING
  RETURNING id
)
SELECT count(*) FROM inserted;

INSERT INTO provider_reconciliation_case_links (
  case_id, usage_record_id, bill_detail_id, bill_detail_revision_id,
  allocated_tokens, allocated_cost_cny
)
SELECT
  cases.id,
  usage.id,
  details.id,
  details.current_revision_id,
  cases.token_adjustment,
  cases.cost_adjustment_cny
FROM provider_reconciliation_cases cases
JOIN provider_usage_records usage
  ON cases.case_key = 'history-backfill:' || usage.task_id::text
LEFT JOIN provider_bill_details details
  ON details.provider = cases.provider
 AND details.source_detail_key = cases.evidence->>'officialDetailKey'
WHERE cases.provider = 'volcengine-ark'
  AND cases.case_key LIKE 'history-backfill:%'
  AND usage.usage_evidence_origin = 'official-bill-inferred'
  AND NOT EXISTS (
    SELECT 1 FROM provider_reconciliation_case_links existing
    WHERE existing.case_id = cases.id AND existing.usage_record_id = usage.id
  );

INSERT INTO provider_reconciliation_cases (
  provider, case_key, bill_period, case_type, status, root_cause, confidence,
  token_adjustment, cost_adjustment_cny, official_expense_date,
  local_accounting_date, evidence, evidence_hash
)
SELECT
  'volcengine-ark', 'cross-date:594a9f42-aca0-4b8c-aa6d-e892a9753721', '2026-07',
  'cross-date', 'approved', 'provider-accounting-cutoff', 'high', 50638, 1.164674,
  '2026-07-01'::date, usage.local_accounting_date,
  jsonb_build_object(
    'taskId', usage.task_id,
    'officialDetailKey', 'Detail7660684150990934307',
    'note', '仅移动对账日期，不修改任务时间'
  ),
  encode(digest('cross-date:594a9f42-aca0-4b8c-aa6d-e892a9753721:2026-07-01', 'sha256'), 'hex')
FROM provider_usage_records usage
WHERE usage.task_id = '594a9f42-aca0-4b8c-aa6d-e892a9753721'::uuid
  AND usage.billable_tokens = 50638
ON CONFLICT (provider, case_key) DO NOTHING;

INSERT INTO provider_reconciliation_case_links (
  case_id, usage_record_id, bill_detail_id, bill_detail_revision_id,
  allocated_tokens, allocated_cost_cny
)
SELECT
  cases.id,
  usage.id,
  details.id,
  details.current_revision_id,
  cases.token_adjustment,
  cases.cost_adjustment_cny
FROM provider_reconciliation_cases cases
JOIN provider_usage_records usage
  ON usage.task_id = (cases.evidence->>'taskId')::uuid
LEFT JOIN provider_bill_details details
  ON details.provider = cases.provider
 AND details.source_detail_key = cases.evidence->>'officialDetailKey'
WHERE cases.provider = 'volcengine-ark'
  AND cases.case_key = 'cross-date:594a9f42-aca0-4b8c-aa6d-e892a9753721'
  AND NOT EXISTS (
    SELECT 1
    FROM provider_reconciliation_case_links existing
    WHERE existing.case_id = cases.id
      AND existing.usage_record_id = usage.id
  );
