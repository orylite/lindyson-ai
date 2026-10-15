CREATE INDEX IF NOT EXISTS idx_orders_admin_paid_at
  ON orders(paid_at)
  INCLUDE (amount)
  WHERE status = 'paid';

CREATE INDEX IF NOT EXISTS idx_orders_admin_failed_at
  ON orders((coalesce(failed_at, created_at)))
  WHERE status = 'failed';

CREATE INDEX IF NOT EXISTS idx_users_admin_last_active
  ON users(last_active_at);

CREATE INDEX IF NOT EXISTS idx_provider_usage_admin_completed
  ON provider_usage_records((coalesce(completed_at, created_at)));

CREATE INDEX IF NOT EXISTS idx_provider_usage_admin_model_tokens
  ON provider_usage_records(
    usage_unit,
    status,
    (coalesce(completed_at, created_at)),
    model
  )
  INCLUDE (deducted_units);
