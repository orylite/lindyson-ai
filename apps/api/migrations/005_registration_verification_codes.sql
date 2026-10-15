CREATE TABLE IF NOT EXISTS registration_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL,
  user_name text NOT NULL,
  code_hash text NOT NULL,
  code_salt text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  expires_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registration_verification_codes_email_sent ON registration_verification_codes(email, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_registration_verification_codes_expires ON registration_verification_codes(expires_at);
