ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_user_idempotency_key
  ON orders(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_requests_order_id
  ON invoice_requests(order_id);

CREATE TABLE IF NOT EXISTS admin_action_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  idempotency_key text NOT NULL,
  response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admin_user_id, action, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_unique_recommendation
  ON plans(recommendation)
  WHERE recommendation IS NOT NULL;
