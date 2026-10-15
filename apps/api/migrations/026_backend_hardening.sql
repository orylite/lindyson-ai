ALTER TABLE admin_action_idempotency
  ADD COLUMN IF NOT EXISTS request_hash char(64);

CREATE INDEX IF NOT EXISTS idx_orders_user_cursor
  ON orders(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_orders_user_status_cursor
  ON orders(user_id, status, created_at DESC, id DESC);

-- 旧 direct URL 不再作为资产契约的一部分；读取统一基于 object_key 即时签名。
UPDATE assets
SET public_url = NULL,
    thumbnail_url = NULL
WHERE public_url IS NOT NULL OR thumbnail_url IS NOT NULL;
