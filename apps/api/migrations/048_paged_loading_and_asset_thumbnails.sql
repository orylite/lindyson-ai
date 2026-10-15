-- P1：将列表成本限制在当前页，并让 TOS 缩略图成为资产卡片唯一媒体来源。
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS thumbnail_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS thumbnail_error_code text,
  ADD COLUMN IF NOT EXISTS thumbnail_error_message text,
  ADD COLUMN IF NOT EXISTS thumbnail_updated_at timestamptz;

UPDATE assets
SET thumbnail_status = CASE
      WHEN type = 'audio' THEN 'not-required'
      WHEN thumbnail_key IS NOT NULL AND thumbnail_key <> object_key THEN 'ready'
      WHEN thumbnail_status = 'failed'
        AND thumbnail_error_code IS NOT NULL
        AND thumbnail_error_message IS NOT NULL THEN 'failed'
      ELSE 'pending'
    END,
    thumbnail_error_code = CASE
      WHEN type <> 'audio'
        AND (thumbnail_key IS NULL OR thumbnail_key = object_key)
        AND thumbnail_status = 'failed'
        AND thumbnail_error_code IS NOT NULL
        AND thumbnail_error_message IS NOT NULL THEN thumbnail_error_code
      ELSE NULL
    END,
    thumbnail_error_message = CASE
      WHEN type <> 'audio'
        AND (thumbnail_key IS NULL OR thumbnail_key = object_key)
        AND thumbnail_status = 'failed'
        AND thumbnail_error_code IS NOT NULL
        AND thumbnail_error_message IS NOT NULL THEN thumbnail_error_message
      ELSE NULL
    END,
    thumbnail_updated_at = CASE
      WHEN thumbnail_key IS NOT NULL AND thumbnail_key <> object_key
        THEN COALESCE(thumbnail_updated_at, updated_at, created_at)
      WHEN thumbnail_status = 'failed'
        THEN COALESCE(thumbnail_updated_at, updated_at, created_at)
      ELSE NULL
    END;

ALTER TABLE assets
  DROP CONSTRAINT IF EXISTS assets_thumbnail_status_check,
  DROP CONSTRAINT IF EXISTS assets_thumbnail_applicability_check,
  DROP CONSTRAINT IF EXISTS assets_ready_thumbnail_check,
  DROP CONSTRAINT IF EXISTS assets_thumbnail_error_check;

ALTER TABLE assets
  ADD CONSTRAINT assets_thumbnail_status_check
    CHECK (thumbnail_status IN ('pending', 'ready', 'failed', 'not-required')),
  ADD CONSTRAINT assets_thumbnail_applicability_check
    CHECK (
      (type = 'audio' AND thumbnail_status = 'not-required')
      OR (type <> 'audio' AND thumbnail_status <> 'not-required')
    ),
  ADD CONSTRAINT assets_ready_thumbnail_check
    CHECK (thumbnail_status <> 'ready' OR (thumbnail_key IS NOT NULL AND thumbnail_key <> object_key)),
  ADD CONSTRAINT assets_thumbnail_error_check
    CHECK (
      (thumbnail_status = 'failed' AND thumbnail_error_code IS NOT NULL AND thumbnail_error_message IS NOT NULL)
      OR (thumbnail_status <> 'failed' AND thumbnail_error_code IS NULL AND thumbnail_error_message IS NULL)
    );

CREATE INDEX IF NOT EXISTS idx_assets_image_thumbnail_backfill
  ON assets(created_at ASC, id ASC)
  WHERE deletion_status = 'active' AND type = 'image' AND thumbnail_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_assets_ai_video_thumbnail_recovery
  ON assets(thumbnail_updated_at ASC NULLS FIRST, created_at ASC, id ASC)
  WHERE deletion_status = 'active'
    AND type = 'video'
    AND source = 'ai-video'
    AND thumbnail_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_assets_user_source_folder_cursor
  ON assets(user_id, source, folder_id, created_at DESC, id DESC)
  WHERE deletion_status = 'active';

-- source-only 列表不绑定 folder_id；中间列缺失时上面的索引无法直接提供顺序。
CREATE INDEX IF NOT EXISTS idx_assets_user_source_cursor
  ON assets(user_id, source, created_at DESC, id DESC)
  WHERE deletion_status = 'active';

CREATE INDEX IF NOT EXISTS idx_assets_user_cursor
  ON assets(user_id, created_at DESC, id DESC)
  WHERE deletion_status = 'active';

CREATE INDEX IF NOT EXISTS idx_assets_user_folder_cursor
  ON assets(user_id, folder_id, created_at DESC, id DESC)
  WHERE deletion_status = 'active';

CREATE INDEX IF NOT EXISTS idx_assets_user_type_cursor
  ON assets(user_id, type, created_at DESC, id DESC)
  WHERE deletion_status = 'active';

CREATE INDEX IF NOT EXISTS idx_assets_active_name_trgm
  ON assets USING gin (name gin_trgm_ops)
  WHERE deletion_status = 'active';

CREATE INDEX IF NOT EXISTS idx_generation_tasks_user_status_cursor
  ON generation_tasks(user_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_generation_tasks_user_cursor
  ON generation_tasks(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_type_cursor
  ON credit_ledger(user_id, type, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_cursor
  ON credit_ledger(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_user_status_cursor
  ON tickets(user_id, status, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_user_cursor
  ON tickets(user_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_status_priority_cursor
  ON tickets(status, priority, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_status_cursor
  ON tickets(status, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_priority_cursor
  ON tickets(priority, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_role_created
  ON ticket_messages(ticket_id, author_role, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_orders_status_cursor
  ON orders(status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_orders_user_cursor
  ON orders(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_orders_user_status_cursor
  ON orders(user_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_requests_status_cursor
  ON invoice_requests(status, requested_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_requests_user_cursor
  ON invoice_requests(user_id, requested_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_requests_user_status_cursor
  ON invoice_requests(user_id, status, requested_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_requests_order
  ON invoice_requests(order_id);

CREATE INDEX IF NOT EXISTS idx_generation_tasks_status_cursor
  ON generation_tasks(status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_type_cursor
  ON credit_ledger(type, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_related_order_cursor
  ON credit_ledger(related_order_id, created_at DESC, id DESC)
  WHERE related_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_ledger_related_job_cursor
  ON credit_ledger(related_job_id, created_at DESC, id DESC)
  WHERE related_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_risk_module_cursor
  ON audit_logs(risk, module, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_risk_cursor
  ON audit_logs(risk, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_module_cursor
  ON audit_logs(module, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_announcements_published_cursor
  ON announcements(published_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_users_status_registered_cursor
  ON users(status, registered_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_users_due_plan_reset
  ON users(plan_reset_at, updated_at, id)
  WHERE plan_reset_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_due_plan_expiry
  ON users(plan_expires_at, updated_at, id)
  WHERE plan_expires_at IS NOT NULL;

-- 搜索使用逐列 OR ILIKE。每张高写入表只维护一个多列 GIN，既覆盖原搜索语义，
-- 又避免为每个搜索字段建立一棵独立索引。
CREATE INDEX IF NOT EXISTS idx_users_admin_search_trgm
  ON users USING gin (user_name gin_trgm_ops, (email::text) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_plans_admin_search_trgm
  ON plans USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_admin_search_trgm
  ON orders USING gin (
    (id::text) gin_trgm_ops,
    plan_name gin_trgm_ops,
    merchant_order_no gin_trgm_ops,
    provider_order_id gin_trgm_ops,
    provider_trade_id gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS idx_invoice_requests_admin_search_trgm
  ON invoice_requests USING gin (
    (id::text) gin_trgm_ops,
    (order_id::text) gin_trgm_ops,
    invoice_title gin_trgm_ops,
    tax_id gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS idx_tickets_search_trgm
  ON tickets USING gin (
    (id::text) gin_trgm_ops,
    title gin_trgm_ops,
    last_message gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS idx_generation_tasks_admin_search_trgm
  ON generation_tasks USING gin (
    (id::text) gin_trgm_ops,
    model gin_trgm_ops,
    prompt gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS idx_credit_ledger_admin_search_trgm
  ON credit_ledger USING gin (
    source gin_trgm_ops,
    note gin_trgm_ops,
    (related_order_id::text) gin_trgm_ops,
    (related_job_id::text) gin_trgm_ops,
    (related_asset_id::text) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_search_trgm
  ON audit_logs USING gin (
    (admin_email::text) gin_trgm_ops,
    module gin_trgm_ops,
    action gin_trgm_ops,
    target gin_trgm_ops,
    detail gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS idx_announcements_admin_search_trgm
  ON announcements USING gin (title gin_trgm_ops, content gin_trgm_ops);
