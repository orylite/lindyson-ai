CREATE TABLE IF NOT EXISTS payment_channels (
  provider text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  api_base text NOT NULL DEFAULT '',
  mch_no text NOT NULL DEFAULT '',
  app_id text NOT NULL DEFAULT '',
  api_key_ciphertext text,
  api_key_iv text,
  api_key_tag text,
  desktop_way_code text NOT NULL DEFAULT 'ALI_PC',
  mobile_way_code text NOT NULL DEFAULT 'ALI_WAP',
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (desktop_way_code = 'ALI_PC'),
  CHECK (mobile_way_code = 'ALI_WAP')
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS active_subscription_order_id uuid REFERENCES orders(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_billing_cycle_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_billing_cycle_check
      CHECK (billing_cycle IN ('monthly', 'yearly'));
  END IF;
END $$;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS payment_way_code text,
  ADD COLUMN IF NOT EXISTS merchant_order_no text,
  ADD COLUMN IF NOT EXISTS provider_order_id text,
  ADD COLUMN IF NOT EXISTS payment_error text,
  ADD COLUMN IF NOT EXISTS refund_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS merchant_refund_no text,
  ADD COLUMN IF NOT EXISTS provider_refund_id text,
  ADD COLUMN IF NOT EXISTS refund_error text,
  ADD COLUMN IF NOT EXISTS refund_credit_ledger_id uuid REFERENCES credit_ledger(id),
  ADD COLUMN IF NOT EXISTS previous_plan_id uuid REFERENCES plans(id),
  ADD COLUMN IF NOT EXISTS previous_billing_cycle text,
  ADD COLUMN IF NOT EXISTS previous_plan_reset_at date,
  ADD COLUMN IF NOT EXISTS previous_plan_expires_at date,
  ADD COLUMN IF NOT EXISTS previous_subscription_order_id uuid REFERENCES orders(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_refund_status_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_refund_status_check
      CHECK (refund_status IN ('none', 'pending', 'succeeded', 'failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_previous_billing_cycle_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_previous_billing_cycle_check
      CHECK (previous_billing_cycle IS NULL OR previous_billing_cycle IN ('monthly', 'yearly'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_merchant_order_no
  ON orders(merchant_order_no)
  WHERE merchant_order_no IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_merchant_refund_no
  ON orders(merchant_refund_no)
  WHERE merchant_refund_no IS NOT NULL;

UPDATE orders
SET payment_provider = 'alipay-direct',
    payment_method = '支付宝'
WHERE lower(payment_method) = 'alipay';

UPDATE orders
SET status = 'failed',
    failed_at = COALESCE(failed_at, now()),
    payment_error = COALESCE(payment_error, '支付通道切换，旧待支付订单已关闭')
WHERE payment_provider = 'alipay-direct'
  AND status = 'pending';
