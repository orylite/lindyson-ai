ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_create_claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tickets_user_updated
  ON tickets(user_id, updated_at DESC, id DESC);
