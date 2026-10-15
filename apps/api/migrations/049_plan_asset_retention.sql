DO $migration$
DECLARE
  retention_column_was_missing boolean;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'plans'
      AND column_name = 'asset_retention_days'
  ) INTO retention_column_was_missing;

  ALTER TABLE plans
    ADD COLUMN IF NOT EXISTS asset_retention_days integer NOT NULL DEFAULT 0;

  -- 免费账户在 users.plan_id 中继续使用 NULL；free 套餐是其可编辑的权益策略记录。
  INSERT INTO plans (
    code, name, name_en, kind, billing, description, monthly_price,
    yearly_price, credits, storage_label, tiktok_accounts,
    recommendation, icon_key, cta_label, status, landing_visible, features,
    asset_retention_days
  )
  VALUES (
    'free', '免费版', 'Free', 'main', 'both', '适合体验基础创作功能', 0,
    0, 0, '基础存储', '0',
    NULL, 'zap', '免费使用', 'active', true, '[]'::jsonb,
    7
  )
  ON CONFLICT (code) DO NOTHING;

  -- 只在首次增加字段时写入既有套餐默认值；重复演练不得覆盖管理员后续配置。
  IF retention_column_was_missing THEN
    UPDATE plans
    SET asset_retention_days = CASE lower(code)
          WHEN 'free' THEN 7
          WHEN 'pro' THEN 30
          WHEN 'enterprise' THEN 90
          ELSE asset_retention_days
        END,
        updated_at = CASE
          WHEN lower(code) IN ('free', 'pro', 'enterprise') THEN now()
          ELSE updated_at
        END
    WHERE lower(code) IN ('free', 'pro', 'enterprise');
  END IF;
END
$migration$;

ALTER TABLE plans
  DROP CONSTRAINT IF EXISTS plans_asset_retention_days_check;

ALTER TABLE plans
  ADD CONSTRAINT plans_asset_retention_days_check
  CHECK (asset_retention_days BETWEEN 0 AND 3650);

ALTER TABLE plans
  DROP CONSTRAINT IF EXISTS plans_asset_retention_by_kind_check;

ALTER TABLE plans
  ADD CONSTRAINT plans_asset_retention_by_kind_check
  CHECK (kind = 'main' OR asset_retention_days = 0);

CREATE INDEX IF NOT EXISTS idx_assets_retention_sweep
  ON assets(created_at ASC, id ASC)
  WHERE deletion_status = 'active'
    AND source IN ('ai-video', 'ai-image');

CREATE TABLE IF NOT EXISTS asset_retention_sweep_runs (
  business_date date PRIMARY KEY,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed')),
  claim_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  scanned_count integer NOT NULL DEFAULT 0 CHECK (scanned_count >= 0),
  scheduled_count integer NOT NULL DEFAULT 0 CHECK (scheduled_count >= 0),
  last_error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_retention_sweep_runs_state_check CHECK (
    (
      status = 'running'
      AND claim_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND completed_at IS NULL
    )
    OR (
      status = 'completed'
      AND claim_token IS NULL
      AND lease_expires_at IS NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_asset_retention_sweep_runs_claimable
  ON asset_retention_sweep_runs(status, lease_expires_at, business_date);
