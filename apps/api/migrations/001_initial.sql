CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  name_en text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('main', 'addon')),
  billing text NOT NULL CHECK (billing IN ('monthly', 'yearly', 'both', 'one-time')),
  description text NOT NULL DEFAULT '',
  monthly_price integer NOT NULL DEFAULT 0,
  yearly_price integer NOT NULL DEFAULT 0,
  credits integer NOT NULL CHECK (credits >= 0),
  storage_label text NOT NULL DEFAULT '',
  tiktok_accounts text NOT NULL DEFAULT '',
  recommendation text CHECK (recommendation IN ('popular', 'enterprise')),
  cta_label text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'draft')),
  subscribers integer NOT NULL DEFAULT 0,
  revenue integer NOT NULL DEFAULT 0,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  user_name text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'trial')),
  plan_id uuid REFERENCES plans(id),
  main_credits integer NOT NULL DEFAULT 0 CHECK (main_credits >= 0),
  addon_credits integer NOT NULL DEFAULT 0 CHECK (addon_credits >= 0),
  total_credits integer NOT NULL DEFAULT 0 CHECK (total_credits >= 0),
  plan_reset_at date,
  plan_expires_at date,
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  plan_id uuid REFERENCES plans(id),
  kind text NOT NULL CHECK (kind IN ('main', 'addon')),
  plan_name text NOT NULL,
  amount integer NOT NULL CHECK (amount >= 0),
  billing text NOT NULL CHECK (billing IN ('monthly', 'yearly', 'one-time')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('paid', 'pending', 'refunded', 'failed')),
  invoice_status text NOT NULL DEFAULT 'unissued' CHECK (invoice_status IN ('unissued', 'issued')),
  credit_status text NOT NULL DEFAULT 'none' CHECK (credit_status IN ('none', 'held', 'settled', 'refunded', 'reversed')),
  credit_amount integer NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  credit_bucket text NOT NULL DEFAULT 'system' CHECK (credit_bucket IN ('main', 'addon', 'mixed', 'system')),
  payment_method text NOT NULL DEFAULT 'manual',
  provider_trade_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('earn', 'hold', 'spend', 'refund', 'adjust', 'void')),
  bucket text NOT NULL CHECK (bucket IN ('main', 'addon', 'mixed', 'system')),
  settlement_status text NOT NULL DEFAULT 'none' CHECK (settlement_status IN ('none', 'held', 'settled', 'refunded', 'reversed')),
  amount integer NOT NULL,
  balance integer NOT NULL CHECK (balance >= 0),
  source text NOT NULL,
  operator text NOT NULL DEFAULT 'system',
  note text NOT NULL DEFAULT '',
  related_order_id uuid REFERENCES orders(id),
  related_job_id uuid,
  related_asset_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asset_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  source text NOT NULL CHECK (source IN ('ai-video', 'ai-image', 'uploaded-video', 'uploaded-image')),
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  folder_id uuid REFERENCES asset_folders(id),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('video', 'image')),
  source text NOT NULL CHECK (source IN ('ai-video', 'ai-image', 'uploaded-video', 'uploaded-image')),
  object_key text NOT NULL,
  thumbnail_key text,
  public_url text,
  thumbnail_url text,
  size_bytes bigint NOT NULL DEFAULT 0,
  duration_seconds numeric,
  width integer,
  height integer,
  generation_meta jsonb,
  views integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('video', 'image')),
  model text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'canceled')),
  failure_category text CHECK (failure_category IN ('insufficient-credits', 'provider-failed', 'content-policy', 'user-canceled', 'system-timeout')),
  failure_reason text,
  prompt text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_task_id text,
  credits integer NOT NULL CHECK (credits >= 0),
  reserved_credits integer NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  settled_credits integer NOT NULL DEFAULT 0 CHECK (settled_credits >= 0),
  refunded_credits integer NOT NULL DEFAULT 0 CHECK (refunded_credits >= 0),
  credit_status text NOT NULL DEFAULT 'none' CHECK (credit_status IN ('none', 'held', 'settled', 'refunded', 'reversed')),
  main_credits_used integer NOT NULL DEFAULT 0 CHECK (main_credits_used >= 0),
  addon_credits_used integer NOT NULL DEFAULT 0 CHECK (addon_credits_used >= 0),
  asset_id uuid REFERENCES assets(id),
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_job_fk
  FOREIGN KEY (related_job_id) REFERENCES generation_tasks(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_asset_fk
  FOREIGN KEY (related_asset_id) REFERENCES assets(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS invoice_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  user_id uuid NOT NULL REFERENCES users(id),
  invoice_title text NOT NULL,
  tax_id text NOT NULL DEFAULT '',
  receive_email citext NOT NULL,
  status text NOT NULL DEFAULT 'unissued' CHECK (status IN ('unissued', 'issued')),
  note text NOT NULL DEFAULT '',
  requested_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz
);

CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved')),
  assignee text NOT NULL DEFAULT 'unassigned',
  last_message text NOT NULL DEFAULT '',
  internal_note text NOT NULL DEFAULT '',
  sla_hours integer NOT NULL DEFAULT 24,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text NOT NULL,
  pinned boolean NOT NULL DEFAULT false,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES users(id),
  admin_email citext NOT NULL,
  module text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  risk text NOT NULL DEFAULT 'low' CHECK (risk IN ('low', 'medium', 'high')),
  ip inet,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consumption_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('video', 'image')),
  model text NOT NULL,
  model_label text NOT NULL,
  duration_seconds integer,
  resolution text,
  credits integer NOT NULL CHECK (credits >= 0),
  available boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, model, duration_seconds, resolution)
);

CREATE TABLE IF NOT EXISTS provider_usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  task_id uuid REFERENCES generation_tasks(id),
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  raw_units integer,
  deducted_units integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created ON credit_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_tasks_user_created ON generation_tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_tasks_status ON generation_tasks(status);
CREATE INDEX IF NOT EXISTS idx_assets_user_source ON assets(user_id, source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);
