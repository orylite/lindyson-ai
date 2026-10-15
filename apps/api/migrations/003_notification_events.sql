CREATE TABLE IF NOT EXISTS notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('email')),
  event_type text NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  provider text NOT NULL DEFAULT 'resend',
  provider_message_id text,
  error text,
  related_user_id uuid REFERENCES users(id),
  related_order_id uuid REFERENCES orders(id),
  related_ticket_id uuid REFERENCES tickets(id),
  related_invoice_id uuid REFERENCES invoice_requests(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_events_created ON notification_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_events_user_created ON notification_events(related_user_id, created_at DESC);
