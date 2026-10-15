CREATE TABLE IF NOT EXISTS provider_billing_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('balance', 'bill', 'packages')),
  status text NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  window_start date,
  window_end date,
  page_count integer NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  request_id text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  is_final boolean NOT NULL DEFAULT false,
  CHECK (window_start IS NULL OR window_end IS NULL OR window_start <= window_end),
  CHECK (status = 'running' OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_provider_billing_sync_runs_freshness
  ON provider_billing_sync_runs(provider, kind, window_start, window_end, status, completed_at DESC);

CREATE TABLE IF NOT EXISTS provider_account_balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  account_id text,
  available_balance_cny numeric(20,6) NOT NULL,
  cash_balance_cny numeric(20,6) NOT NULL,
  frozen_amount_cny numeric(20,6) NOT NULL,
  arrears_balance_cny numeric(20,6) NOT NULL,
  credit_limit_cny numeric(20,6) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'CNY',
  request_id text,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_account_balance_snapshots_latest
  ON provider_account_balance_snapshots(provider, synced_at DESC);

CREATE TABLE IF NOT EXISTS provider_bill_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  source_detail_key text NOT NULL,
  payer_id text,
  bill_period text NOT NULL,
  expense_date date NOT NULL,
  product text NOT NULL,
  product_zh text,
  billing_mode text,
  bill_category text,
  instance_no text,
  config_name text,
  element_code text,
  configuration_code text,
  factor_code text,
  project text,
  tag jsonb,
  price numeric(20,6),
  price_unit text,
  usage_count numeric(30,6),
  usage_unit text,
  deduction_count numeric(30,6),
  original_bill_amount_cny numeric(20,6),
  preferential_bill_amount_cny numeric(20,6),
  discount_bill_amount_cny numeric(20,6),
  coupon_amount_cny numeric(20,6),
  payable_amount_cny numeric(20,6),
  paid_amount_cny numeric(20,6),
  unpaid_amount_cny numeric(20,6),
  round_amount_cny numeric(20,6),
  currency char(3) NOT NULL DEFAULT 'CNY',
  settlement_type text,
  recognized_model text,
  pricing_resolution text,
  pricing_input_has_video boolean,
  billable_tokens bigint CHECK (billable_tokens IS NULL OR billable_tokens >= 0),
  list_equivalent_cost_cny numeric(20,6) CHECK (list_equivalent_cost_cny IS NULL OR list_equivalent_cost_cny >= 0),
  is_final boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  raw_payload jsonb NOT NULL,
  last_seen_run_id uuid REFERENCES provider_billing_sync_runs(id) ON DELETE SET NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, source_detail_key)
);

CREATE INDEX IF NOT EXISTS idx_provider_bill_details_window
  ON provider_bill_details(provider, bill_period, expense_date, active);

CREATE INDEX IF NOT EXISTS idx_provider_bill_details_seedance_cost
  ON provider_bill_details(provider, recognized_model, expense_date)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_provider_bill_details_active_expense_date
  ON provider_bill_details(provider, expense_date)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS provider_billing_sync_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('all', 'balance', 'bill', 'packages')),
  window_start date,
  window_end date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  requested_by text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((window_start IS NULL) = (window_end IS NULL)),
  CHECK (window_start IS NULL OR window_start <= window_end),
  CHECK (window_start IS NULL OR scope IN ('all', 'bill'))
);

CREATE INDEX IF NOT EXISTS idx_provider_billing_sync_requests_queue
  ON provider_billing_sync_requests(provider, status, created_at);
