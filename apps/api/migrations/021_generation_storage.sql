-- 上传会话将签名、完成入库和对象所有权串联起来。
CREATE TABLE IF NOT EXISTS upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  filename text NOT NULL,
  content_type text NOT NULL,
  max_size_bytes bigint NOT NULL CHECK (max_size_bytes > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
  asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_user_created
  ON upload_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_pending_expiry
  ON upload_sessions(expires_at)
  WHERE status = 'pending';

-- 同一用户的同一对象只能完成为一份资产，使 complete 可安全重试。
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_user_object_key
  ON assets(user_id, object_key);

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS deletion_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS download_requested_at timestamptz;

UPDATE assets
SET download_requested_at = downloaded_at
WHERE download_requested_at IS NULL AND downloaded_at IS NOT NULL;

ALTER TABLE assets
  DROP CONSTRAINT IF EXISTS assets_deletion_status_check;
ALTER TABLE assets
  ADD CONSTRAINT assets_deletion_status_check
  CHECK (deletion_status IN ('active', 'deleting', 'deleted'));

CREATE INDEX IF NOT EXISTS idx_assets_user_active_source
  ON assets(user_id, source, created_at DESC)
  WHERE deletion_status = 'active';

-- 对象删除在数据库提交后执行；重试删除本身是幂等的。
CREATE TABLE IF NOT EXISTS object_deletion_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key text NOT NULL UNIQUE,
  asset_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  available_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_object_deletion_outbox_pending
  ON object_deletion_outbox(available_at, created_at)
  WHERE status IN ('pending', 'processing');

-- 历史任务与积分流水保留，资产删除后仅断开引用。
ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_asset_id_fkey;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_asset_id_fkey
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL;

ALTER TABLE credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_asset_fk;
ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_asset_fk
  FOREIGN KEY (related_asset_id) REFERENCES assets(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

-- 生成任务将供应商执行与本地结算拆分，租约用于崩溃恢复。
ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_stage text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS provider_result jsonb,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_error text;

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_attempt_check;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_attempt_check CHECK (attempt >= 0);

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_processing_stage_check;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_processing_stage_check
  CHECK (processing_stage IN (
    'queued', 'provider-running', 'provider-succeeded',
    'settlement-pending', 'completed', 'failed'
  ));

UPDATE generation_tasks
SET processing_stage = CASE status
  WHEN 'queued' THEN 'queued'
  WHEN 'processing' THEN 'provider-running'
  WHEN 'completed' THEN 'completed'
  WHEN 'failed' THEN 'failed'
  ELSE 'failed'
END
WHERE processing_stage = 'queued' AND status <> 'queued';

UPDATE generation_tasks
SET lease_expires_at = now() - interval '1 second'
WHERE status = 'processing' AND lease_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_generation_tasks_reconcile
  ON generation_tasks(status, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS generation_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  task_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_generation_batches_user_created
  ON generation_batches(user_id, created_at DESC);
