ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_expires_at timestamptz;

UPDATE orders
SET payment_expires_at = created_at + interval '7200 seconds'
WHERE payment_provider = 'jeepay'
  AND status = 'pending'
  AND payment_expires_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_expires_at_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_payment_expires_at_check
      CHECK (payment_expires_at IS NULL OR payment_expires_at >= created_at);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_pending_payment_expiry
  ON orders(payment_expires_at)
  WHERE payment_provider = 'jeepay' AND status = 'pending';
