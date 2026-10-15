CREATE INDEX IF NOT EXISTS idx_users_admin_registered
  ON users(registered_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_orders_admin_created
  ON orders(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_requests_admin_requested
  ON invoice_requests(requested_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_admin_updated
  ON tickets(updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_generation_tasks_admin_created
  ON generation_tasks(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_admin_created
  ON credit_ledger(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_created
  ON audit_logs(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_user
  ON tickets(user_id);

CREATE INDEX IF NOT EXISTS idx_provider_usage_records_task
  ON provider_usage_records(task_id);
