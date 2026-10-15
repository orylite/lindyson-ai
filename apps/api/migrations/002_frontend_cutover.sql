CREATE TABLE IF NOT EXISTS feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO feature_flags (key, enabled)
VALUES
  ('tiktokAccounts', true),
  ('tiktokPublish', true)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS provider_resource_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id text NOT NULL UNIQUE,
  provider text NOT NULL,
  product text NOT NULL,
  config text NOT NULL,
  recognized_model text NOT NULL,
  status text NOT NULL DEFAULT 'configured',
  total_quota integer NOT NULL DEFAULT 0 CHECK (total_quota >= 0),
  remaining_quota integer NOT NULL DEFAULT 0 CHECK (remaining_quota >= 0),
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO provider_resource_packages (
  package_id, provider, product, config, recognized_model, status,
  total_quota, remaining_quota, starts_at, expires_at
)
VALUES
  ('fake-video-provider-main', 'fake-provider', '内置假视频供应商', 'Seedance 兼容任务流程测试包', 'Seedance 2.0', 'Effective', 10000000, 10000000, now(), now() + interval '90 days'),
  ('fake-image-provider-main', 'fake-provider', '内置假图片供应商', 'GPT Image 兼容任务流程测试包', 'GPT Image 2.0', 'Effective', 2000000, 2000000, now(), now() + interval '90 days')
ON CONFLICT (package_id) DO UPDATE
SET provider = EXCLUDED.provider,
    product = EXCLUDED.product,
    config = EXCLUDED.config,
    recognized_model = EXCLUDED.recognized_model,
    status = EXCLUDED.status,
    total_quota = EXCLUDED.total_quota,
    remaining_quota = EXCLUDED.remaining_quota,
    starts_at = EXCLUDED.starts_at,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();

CREATE INDEX IF NOT EXISTS idx_asset_folders_user_source ON asset_folders(user_id, source, created_at DESC);
