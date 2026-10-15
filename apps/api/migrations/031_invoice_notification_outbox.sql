-- 发票由管理员人工开具和发送；系统只可靠通知管理员有新的申请。
CREATE TABLE IF NOT EXISTS invoice_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL DEFAULT 'invoice-requested-admin'
    CHECK (event_type IN ('invoice-requested-admin')),
  invoice_id uuid NOT NULL UNIQUE REFERENCES invoice_requests(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text,
  provider_message_id text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_notification_outbox_pending
  ON invoice_notification_outbox(available_at, created_at)
  WHERE status IN ('pending', 'processing');
