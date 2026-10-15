-- MCP 授权、限流和附件导入独立于网站会话及积分账本。
CREATE TABLE IF NOT EXISTS mcp_oauth_states (
  kind text NOT NULL,
  id_hash text NOT NULL,
  payload_encrypted text NOT NULL,
  grant_id text,
  uid_hash text,
  user_code_hash text,
  consumed_at timestamptz,
  expires_at timestamptz,
  PRIMARY KEY (kind, id_hash)
);
CREATE INDEX IF NOT EXISTS mcp_oauth_states_grant ON mcp_oauth_states(grant_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_states_uid ON mcp_oauth_states(kind, uid_hash);
CREATE INDEX IF NOT EXISTS mcp_oauth_states_expiry ON mcp_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS mcp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id text UNIQUE NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_version integer NOT NULL,
  client_id text NOT NULL,
  scopes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_connections_user ON mcp_connections(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mcp_rate_limits (
  key_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  calls integer NOT NULL,
  PRIMARY KEY (key_hash, window_start)
);

CREATE TABLE IF NOT EXISTS mcp_file_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES mcp_connections(id),
  idempotency_key text NOT NULL,
  file_id text NOT NULL,
  filename text,
  declared_type text,
  source_encrypted text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','downloading','processing','completed','failed')),
  upload_session_id uuid REFERENCES upload_sessions(id),
  asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  attempt integer NOT NULL DEFAULT 1,
  lease_token uuid,
  lease_until timestamptz,
  error_code text,
  source_expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS mcp_file_imports_pending ON mcp_file_imports(status, lease_until);
CREATE INDEX IF NOT EXISTS mcp_file_imports_user ON mcp_file_imports(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mcp_import_batches (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  import_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,idempotency_key)
);
