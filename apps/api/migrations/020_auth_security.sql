ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_auth_version_positive'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_auth_version_positive CHECK (auth_version > 0);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS auth_rate_limit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope text NOT NULL,
  key_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limit_events_lookup
  ON auth_rate_limit_events(scope, key_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limit_events_cleanup
  ON auth_rate_limit_events(created_at);
