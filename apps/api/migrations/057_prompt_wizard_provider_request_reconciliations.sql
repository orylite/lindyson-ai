-- 提示词向导：为供应商未返回 usage 的终态失败请求保存追加式核对证据。
-- 原始逐请求账本保持不可变；报表只能在 reconciled_at 之后叠加本表的有效值。

CREATE TABLE IF NOT EXISTS prompt_wizard_provider_request_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE
    REFERENCES prompt_wizard_provider_requests(id) ON DELETE RESTRICT,
  reconciliation_status text NOT NULL,
  effective_input_tokens integer NOT NULL,
  effective_cached_input_tokens integer NOT NULL,
  effective_output_tokens integer NOT NULL,
  effective_cost_cny numeric(18, 6) NOT NULL,
  evidence_source text NOT NULL,
  evidence_source_url text,
  official_window_start timestamptz NOT NULL,
  official_window_end timestamptz NOT NULL,
  official_request_count integer NOT NULL,
  official_input_tokens bigint NOT NULL,
  official_output_tokens bigint NOT NULL,
  official_total_tokens bigint NOT NULL,
  local_known_request_count integer NOT NULL,
  local_known_input_tokens bigint NOT NULL,
  local_known_output_tokens bigint NOT NULL,
  local_known_total_tokens bigint NOT NULL,
  observed_at timestamptz NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  reconciled_by text NOT NULL,
  evidence_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_wizard_provider_request_reconciliations_status_check CHECK (
    reconciliation_status IN ('confirmed-zero')
  ),
  CONSTRAINT prompt_wizard_provider_request_reconciliations_effective_zero_check CHECK (
    effective_input_tokens = 0
    AND effective_cached_input_tokens = 0
    AND effective_output_tokens = 0
    AND effective_cost_cny = 0.000000
  ),
  CONSTRAINT prompt_wizard_provider_request_reconciliations_metrics_check CHECK (
    official_request_count >= 0
    AND official_input_tokens >= 0
    AND official_output_tokens >= 0
    AND official_total_tokens = official_input_tokens + official_output_tokens
    AND local_known_request_count >= 0
    AND local_known_input_tokens >= 0
    AND local_known_output_tokens >= 0
    AND local_known_total_tokens = local_known_input_tokens + local_known_output_tokens
  ),
  CONSTRAINT prompt_wizard_provider_request_reconciliations_zero_residual_check CHECK (
    official_request_count = local_known_request_count
    AND official_input_tokens = local_known_input_tokens
    AND official_output_tokens = local_known_output_tokens
    AND official_total_tokens = local_known_total_tokens
  ),
  CONSTRAINT prompt_wizard_provider_request_reconciliations_window_check CHECK (
    official_window_end = official_window_start + interval '1 hour'
    AND date_trunc(
      'hour',
      official_window_start AT TIME ZONE 'Asia/Shanghai'
    ) = official_window_start AT TIME ZONE 'Asia/Shanghai'
  ),
  CONSTRAINT prompt_wizard_provider_request_reconciliations_audit_time_check CHECK (
    observed_at >= official_window_end
    AND reconciled_at >= observed_at
    AND created_at >= reconciled_at
  ),
  CONSTRAINT prompt_wizard_provider_request_reconciliations_audit_text_check CHECK (
    length(btrim(evidence_source)) > 0
    AND length(btrim(reconciled_by)) > 0
    AND length(btrim(evidence_note)) > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_prompt_wizard_request_reconciliations_as_of
  ON prompt_wizard_provider_request_reconciliations(reconciled_at ASC, request_id ASC);

CREATE OR REPLACE FUNCTION validate_prompt_wizard_provider_request_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_request prompt_wizard_provider_requests%ROWTYPE;
BEGIN
  SELECT * INTO source_request
  FROM prompt_wizard_provider_requests
  WHERE id = NEW.request_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'prompt_wizard_provider_request_reconciliations 原始请求不存在：request=%',
      NEW.request_id;
  END IF;

  IF source_request.request_status IS DISTINCT FROM 'failed'
    OR source_request.cost_status IS DISTINCT FROM 'unknown'
    OR source_request.input_tokens IS NOT NULL
    OR source_request.cached_input_tokens IS NOT NULL
    OR source_request.output_tokens IS NOT NULL
    OR source_request.cost_cny IS NOT NULL
  THEN
    RAISE EXCEPTION
      'prompt_wizard_provider_request_reconciliations 只接受缺少 usage 的未知成本失败请求：request=%',
      NEW.request_id;
  END IF;

  IF source_request.started_at < NEW.official_window_start
    OR source_request.started_at >= NEW.official_window_end
  THEN
    RAISE EXCEPTION
      'prompt_wizard_provider_request_reconciliations 原始请求不属于官方小时窗口：request=%',
      NEW.request_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prompt_wizard_provider_request_reconciliation
  ON prompt_wizard_provider_request_reconciliations;
CREATE TRIGGER trg_validate_prompt_wizard_provider_request_reconciliation
BEFORE INSERT ON prompt_wizard_provider_request_reconciliations
FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_provider_request_reconciliation();

CREATE OR REPLACE FUNCTION preserve_prompt_wizard_provider_request_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'prompt_wizard_provider_request_reconciliations 核对证据禁止删除：reconciliation=%',
      OLD.id;
  END IF;

  RAISE EXCEPTION
    'prompt_wizard_provider_request_reconciliations 核对证据禁止修改：reconciliation=%',
    OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS trg_preserve_prompt_wizard_provider_request_reconciliation
  ON prompt_wizard_provider_request_reconciliations;
CREATE TRIGGER trg_preserve_prompt_wizard_provider_request_reconciliation
BEFORE UPDATE OR DELETE ON prompt_wizard_provider_request_reconciliations
FOR EACH ROW EXECUTE FUNCTION preserve_prompt_wizard_provider_request_reconciliation();
