-- 提示词向导：版本化大模型列表价与逐次真实 HTTP 尝试成本账本。
-- 账本只保存安全标识、用量与价格快照，禁止保存提示词、图片 URL 或响应正文。

CREATE TABLE IF NOT EXISTS prompt_wizard_model_pricing_rules (
  id text PRIMARY KEY,
  provider text NOT NULL,
  model text NOT NULL,
  service_tier text NOT NULL,
  price_version text NOT NULL,
  pricing_tier text NOT NULL,
  min_input_tokens integer NOT NULL CHECK (min_input_tokens >= 0),
  max_input_tokens integer NOT NULL CHECK (max_input_tokens >= min_input_tokens),
  input_price_per_million_cny numeric(18, 6) NOT NULL
    CHECK (input_price_per_million_cny >= 0),
  cached_input_price_per_million_cny numeric(18, 6) NOT NULL
    CHECK (cached_input_price_per_million_cny >= 0),
  output_price_per_million_cny numeric(18, 6) NOT NULL
    CHECK (output_price_per_million_cny >= 0),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  source_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, model, service_tier, price_version, pricing_tier),
  CONSTRAINT prompt_wizard_model_pricing_rules_effective_range_check CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

-- Doubao Seed 2.0 Lite 默认在线推理列表价，单位为元 / 百万 Token。
-- effective_from 使用官方价格页可核验的最近更新时间，不从模型 ID 猜测历史价格。
-- 输入长度档采用 32K / 128K / 256K（千 Token）边界；每个请求按其总输入
-- Token 独立选档，命中缓存的输入 Token 使用同档缓存命中价。
INSERT INTO prompt_wizard_model_pricing_rules (
  id, provider, model, service_tier, price_version, pricing_tier,
  min_input_tokens, max_input_tokens,
  input_price_per_million_cny, cached_input_price_per_million_cny,
  output_price_per_million_cny, effective_from, source_url
)
VALUES
  (
    'volcengine-doubao-seed-2-0-lite-260428-default-2026-07-23-0-32k',
    'volcengine-ark', 'doubao-seed-2-0-lite-260428', 'default',
    'volcengine-list-2026-07-23', '0-32k',
    0, 32000, 0.600000, 0.120000, 3.600000,
    '2026-07-23 18:06:05+08',
    'https://www.volcengine.com/docs/82379/1544106'
  ),
  (
    'volcengine-doubao-seed-2-0-lite-260428-default-2026-07-23-32k-128k',
    'volcengine-ark', 'doubao-seed-2-0-lite-260428', 'default',
    'volcengine-list-2026-07-23', '32k-128k',
    32001, 128000, 0.900000, 0.180000, 5.400000,
    '2026-07-23 18:06:05+08',
    'https://www.volcengine.com/docs/82379/1544106'
  ),
  (
    'volcengine-doubao-seed-2-0-lite-260428-default-2026-07-23-128k-256k',
    'volcengine-ark', 'doubao-seed-2-0-lite-260428', 'default',
    'volcengine-list-2026-07-23', '128k-256k',
    128001, 256000, 1.800000, 0.360000, 10.800000,
    '2026-07-23 18:06:05+08',
    'https://www.volcengine.com/docs/82379/1544106'
  )
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS prompt_wizard_provider_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL UNIQUE,
  run_id uuid NOT NULL REFERENCES prompt_wizard_runs(id),
  batch_id uuid REFERENCES prompt_wizard_batches(id),
  user_id uuid NOT NULL REFERENCES users(id),
  operation text NOT NULL CHECK (
    operation IN ('analyze-product', 'repair-product-chinese', 'generate-drafts')
  ),
  job_attempt integer NOT NULL CHECK (job_attempt > 0),
  repair_round integer NOT NULL DEFAULT 0 CHECK (repair_round BETWEEN 0 AND 2),
  plan_index integer CHECK (plan_index BETWEEN 0 AND 2),
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
  pricing_rule_id text REFERENCES prompt_wizard_model_pricing_rules(id),
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
  CONSTRAINT prompt_wizard_provider_requests_owner_shape_check CHECK (
    (operation IN ('analyze-product', 'repair-product-chinese') AND batch_id IS NULL)
    OR (operation = 'generate-drafts' AND batch_id IS NOT NULL)
  ),
  CONSTRAINT prompt_wizard_provider_requests_plan_shape_check CHECK (
    (operation = 'generate-drafts' AND plan_index IS NOT NULL)
    OR (operation <> 'generate-drafts' AND plan_index IS NULL)
  ),
  CONSTRAINT prompt_wizard_provider_requests_terminal_shape_check CHECK (
    (request_status = 'started' AND completed_at IS NULL)
    OR (request_status <> 'started' AND completed_at IS NOT NULL)
  ),
  CONSTRAINT prompt_wizard_provider_requests_cost_shape_check CHECK (
    (
      cost_status = 'unknown'
      AND cost_cny IS NULL
    )
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

CREATE INDEX IF NOT EXISTS idx_prompt_wizard_provider_requests_run_created
  ON prompt_wizard_provider_requests(run_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_provider_requests_batch_created
  ON prompt_wizard_provider_requests(batch_id, created_at ASC, id ASC)
  WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_provider_requests_user_created
  ON prompt_wizard_provider_requests(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_wizard_provider_requests_reporting
  ON prompt_wizard_provider_requests(created_at DESC, model, operation, request_status);

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
    NEW.id, NEW.request_key, NEW.run_id, NEW.batch_id, NEW.user_id,
    NEW.operation, NEW.job_attempt, NEW.repair_round, NEW.plan_index,
    NEW.transport_attempt, NEW.provider, NEW.model, NEW.started_at, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.request_key, OLD.run_id, OLD.batch_id, OLD.user_id,
    OLD.operation, OLD.job_attempt, OLD.repair_round, OLD.plan_index,
    OLD.transport_attempt, OLD.provider, OLD.model, OLD.started_at, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'prompt_wizard_provider_requests 业务身份禁止修改：request=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preserve_prompt_wizard_provider_request_ledger
  ON prompt_wizard_provider_requests;
CREATE TRIGGER trg_preserve_prompt_wizard_provider_request_ledger
BEFORE UPDATE OR DELETE ON prompt_wizard_provider_requests
FOR EACH ROW EXECUTE FUNCTION preserve_prompt_wizard_provider_request_ledger();
