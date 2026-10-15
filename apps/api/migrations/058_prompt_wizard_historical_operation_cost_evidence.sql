-- 提示词向导：为没有逐请求账本、但保留了 operation 聚合 Token 的历史
-- run / batch 保存追加式列表价折算证据。
--
-- 本表不伪造 Provider 请求、请求次数或逐请求价格快照。每个 operation 永久
-- 最多一条证据；若未来取得更细粒度证据，应新增独立的核对结构，而不是修改
-- 或删除本表原记录。

CREATE TABLE IF NOT EXISTS prompt_wizard_historical_operation_cost_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_run_id uuid REFERENCES prompt_wizard_runs(id) ON DELETE RESTRICT,
  batch_id uuid REFERENCES prompt_wizard_batches(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  cached_input_tokens integer NOT NULL,
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  -- NULL 表示首档没有开区间下界，即官方 [0, max] 口径；其他档使用
  -- (input_tier_min_exclusive, input_tier_max_inclusive]。
  input_tier_min_exclusive integer,
  input_tier_max_inclusive integer NOT NULL,
  input_rate_cny_per_million numeric(18, 6) NOT NULL,
  cached_input_rate_cny_per_million numeric(18, 6) NOT NULL,
  output_rate_cny_per_million numeric(18, 6) NOT NULL,
  pricing_version text NOT NULL,
  pricing_source_url text NOT NULL,
  cost_cny numeric(18, 6) NOT NULL,
  calculation_basis text NOT NULL,
  evidence_source text NOT NULL,
  observed_at timestamptz NOT NULL,
  priced_at timestamptz NOT NULL,
  priced_by text NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_wizard_historical_cost_owner_shape_check CHECK (
    num_nonnulls(analysis_run_id, batch_id) = 1
  ),
  CONSTRAINT prompt_wizard_historical_cost_cached_tokens_check CHECK (
    cached_input_tokens >= 0 AND cached_input_tokens <= input_tokens
  ),
  CONSTRAINT prompt_wizard_historical_cost_tier_check CHECK (
    (input_tier_min_exclusive IS NULL OR input_tier_min_exclusive >= 0)
    AND input_tier_max_inclusive >= 0
    AND input_tier_max_inclusive > coalesce(input_tier_min_exclusive, -1)
    AND (input_tier_min_exclusive IS NULL OR input_tokens > input_tier_min_exclusive)
    AND input_tokens <= input_tier_max_inclusive
  ),
  CONSTRAINT prompt_wizard_historical_cost_rates_check CHECK (
    input_rate_cny_per_million >= 0
    AND cached_input_rate_cny_per_million >= 0
    AND output_rate_cny_per_million >= 0
  ),
  CONSTRAINT prompt_wizard_historical_cost_value_check CHECK (
    cost_cny = round(
      (
        (input_tokens - cached_input_tokens)::numeric * input_rate_cny_per_million
        + cached_input_tokens::numeric * cached_input_rate_cny_per_million
        + output_tokens::numeric * output_rate_cny_per_million
      ) / 1000000::numeric,
      6
    )
  ),
  CONSTRAINT prompt_wizard_historical_cost_basis_check CHECK (
    calculation_basis = 'historical-operation-aggregate-token'
  ),
  CONSTRAINT prompt_wizard_historical_cost_audit_time_check CHECK (
    observed_at <= priced_at AND priced_at <= created_at
  ),
  CONSTRAINT prompt_wizard_historical_cost_audit_text_check CHECK (
    length(btrim(provider)) > 0
    AND length(btrim(model)) > 0
    AND length(btrim(pricing_version)) > 0
    AND pricing_source_url ~ '^https://'
    AND length(btrim(evidence_source)) > 0
    AND length(btrim(priced_by)) > 0
    AND length(btrim(note)) > 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_wizard_historical_cost_analysis_owner
  ON prompt_wizard_historical_operation_cost_evidence(analysis_run_id)
  WHERE analysis_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_wizard_historical_cost_batch_owner
  ON prompt_wizard_historical_operation_cost_evidence(batch_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prompt_wizard_historical_cost_as_of
  ON prompt_wizard_historical_operation_cost_evidence(priced_at ASC, created_at ASC, id ASC);

CREATE OR REPLACE FUNCTION validate_prompt_wizard_historical_operation_cost_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_model text;
  source_input_tokens integer;
  source_output_tokens integer;
  source_created_at timestamptz;
  source_started_at timestamptz;
  source_completed_at timestamptz;
  source_usage_at timestamptz;
  matching_rule_count integer;
BEGIN
  IF NEW.analysis_run_id IS NOT NULL THEN
    SELECT
      runs.provider_model,
      runs.provider_input_tokens,
      runs.provider_output_tokens,
      runs.created_at,
      runs.started_at,
      runs.completed_at
    INTO
      source_model,
      source_input_tokens,
      source_output_tokens,
      source_created_at,
      source_started_at,
      source_completed_at
    FROM prompt_wizard_runs runs
    WHERE runs.id = NEW.analysis_run_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'prompt_wizard_historical_operation_cost_evidence analysis run 不存在：run=%',
        NEW.analysis_run_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM prompt_wizard_provider_requests requests
      WHERE requests.run_id = NEW.analysis_run_id
        AND requests.batch_id IS NULL
    ) THEN
      RAISE EXCEPTION
        'prompt_wizard_historical_operation_cost_evidence analysis 已有逐请求账本：run=%',
        NEW.analysis_run_id;
    END IF;
  ELSE
    SELECT
      batches.provider_model,
      batches.provider_input_tokens,
      batches.provider_output_tokens,
      batches.created_at,
      batches.started_at,
      batches.completed_at
    INTO
      source_model,
      source_input_tokens,
      source_output_tokens,
      source_created_at,
      source_started_at,
      source_completed_at
    FROM prompt_wizard_batches batches
    WHERE batches.id = NEW.batch_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'prompt_wizard_historical_operation_cost_evidence batch 不存在：batch=%',
        NEW.batch_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM prompt_wizard_provider_requests requests
      WHERE requests.batch_id = NEW.batch_id
    ) THEN
      RAISE EXCEPTION
        'prompt_wizard_historical_operation_cost_evidence batch 已有逐请求账本：batch=%',
        NEW.batch_id;
    END IF;
  END IF;

  IF source_model IS DISTINCT FROM NEW.model
    OR source_input_tokens IS DISTINCT FROM NEW.input_tokens
    OR source_output_tokens IS DISTINCT FROM NEW.output_tokens
    OR source_completed_at IS NULL
    OR NEW.observed_at < source_completed_at
    OR NEW.priced_at < source_completed_at
  THEN
    RAISE EXCEPTION
      'prompt_wizard_historical_operation_cost_evidence 与原 operation 终态不一致：run=% batch=%',
      NEW.analysis_run_id,
      NEW.batch_id;
  END IF;

  source_usage_at := coalesce(source_started_at, source_created_at);

  -- 历史聚合没有 service_tier 字段；当前提示词向导只使用 default。这里必须
  -- 与版本化规则的完整快照唯一匹配，并按真实 operation 开始时间选价格版本。
  SELECT count(*)::integer INTO matching_rule_count
  FROM prompt_wizard_model_pricing_rules rules
  WHERE rules.provider = NEW.provider
    AND rules.model = NEW.model
    AND rules.service_tier = 'default'
    AND rules.price_version = NEW.pricing_version
    AND rules.min_input_tokens = coalesce(NEW.input_tier_min_exclusive + 1, 0)
    AND rules.max_input_tokens = NEW.input_tier_max_inclusive
    AND rules.input_price_per_million_cny = NEW.input_rate_cny_per_million
    AND rules.cached_input_price_per_million_cny = NEW.cached_input_rate_cny_per_million
    AND rules.output_price_per_million_cny = NEW.output_rate_cny_per_million
    AND rules.source_url = NEW.pricing_source_url
    AND rules.effective_from <= source_usage_at
    AND (rules.effective_to IS NULL OR source_usage_at < rules.effective_to);

  IF matching_rule_count <> 1 THEN
    RAISE EXCEPTION
      'prompt_wizard_historical_operation_cost_evidence 未唯一命中 operation 当时价格：run=% batch=% matches=%',
      NEW.analysis_run_id,
      NEW.batch_id,
      matching_rule_count;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_historical_operation_cost_evidence
  ON prompt_wizard_historical_operation_cost_evidence;
CREATE TRIGGER trg_validate_prompt_wizard_historical_operation_cost_evidence
BEFORE INSERT ON prompt_wizard_historical_operation_cost_evidence
FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_historical_operation_cost_evidence();

CREATE OR REPLACE FUNCTION preserve_prompt_wizard_historical_operation_cost_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'prompt_wizard_historical_operation_cost_evidence 历史成本证据禁止删除：evidence=%',
      OLD.id;
  END IF;

  RAISE EXCEPTION
    'prompt_wizard_historical_operation_cost_evidence 历史成本证据禁止修改：evidence=%',
    OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS trg_preserve_prompt_wizard_historical_operation_cost_evidence
  ON prompt_wizard_historical_operation_cost_evidence;
CREATE TRIGGER trg_preserve_prompt_wizard_historical_operation_cost_evidence
BEFORE UPDATE OR DELETE ON prompt_wizard_historical_operation_cost_evidence
FOR EACH ROW EXECUTE FUNCTION preserve_prompt_wizard_historical_operation_cost_evidence();
