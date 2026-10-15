ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refund_dispatch_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS refund_dispatch_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_dispatch_next_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_dispatch_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS refund_client_ip inet;

UPDATE orders
SET refund_dispatch_status = CASE
      WHEN refund_status = 'succeeded' THEN 'completed'
      WHEN refund_status = 'failed' THEN 'failed'
      WHEN refund_status = 'pending' THEN 'submitted'
      ELSE 'idle'
    END,
    refund_dispatch_next_at = NULL,
    refund_dispatch_lease_until = NULL;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_refund_dispatch_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_refund_dispatch_status_check
  CHECK (refund_dispatch_status IN ('idle', 'queued', 'processing', 'uncertain', 'submitted', 'completed', 'failed'));

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_refund_dispatch_attempts_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_refund_dispatch_attempts_check
  CHECK (refund_dispatch_attempts >= 0);

CREATE INDEX IF NOT EXISTS idx_orders_refund_dispatch_due
  ON orders(refund_dispatch_next_at, created_at)
  WHERE refund_dispatch_status IN ('queued', 'uncertain', 'processing');
