ALTER TABLE admin_action_idempotency
  ADD COLUMN IF NOT EXISTS response_status integer,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS key_expires_at timestamptz;

DO $$
DECLARE
  legacy_constraint text;
BEGIN
  SELECT conname INTO legacy_constraint
  FROM pg_constraint
  WHERE conrelid = 'admin_action_idempotency'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (admin_user_id, action, idempotency_key)'
  LIMIT 1;

  IF legacy_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE admin_action_idempotency DROP CONSTRAINT %I',
      legacy_constraint
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_action_idempotency_admin_key
  ON admin_action_idempotency(admin_user_id, idempotency_key);

UPDATE admin_action_idempotency
SET response_status = CASE WHEN response_json IS NOT NULL THEN COALESCE(response_status, 200) ELSE response_status END,
    completed_at = CASE WHEN response_json IS NOT NULL THEN COALESCE(completed_at, created_at) ELSE completed_at END,
    response_expires_at = COALESCE(response_expires_at, created_at + interval '30 days'),
    key_expires_at = COALESCE(key_expires_at, created_at + interval '365 days');

ALTER TABLE admin_action_idempotency
  ALTER COLUMN response_expires_at SET DEFAULT (now() + interval '30 days'),
  ALTER COLUMN response_expires_at SET NOT NULL,
  ALTER COLUMN key_expires_at SET DEFAULT (now() + interval '365 days'),
  ALTER COLUMN key_expires_at SET NOT NULL;

ALTER TABLE admin_action_idempotency
  DROP CONSTRAINT IF EXISTS admin_action_idempotency_response_status_check;

ALTER TABLE admin_action_idempotency
  ADD CONSTRAINT admin_action_idempotency_response_status_check
  CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599);

CREATE INDEX IF NOT EXISTS idx_admin_action_idempotency_response_expiry
  ON admin_action_idempotency(response_expires_at)
  WHERE response_json IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_action_idempotency_key_expiry
  ON admin_action_idempotency(key_expires_at);
