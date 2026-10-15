-- 私域真人人像素材库：套餐权益、授权证据、远端物化、容量编排与生成引用快照。
-- 所有远端资源都以本地授权和归属为准；审计表优先保留，不使用级联删除。

DO $migration$
DECLARE
  portrait_columns_were_missing boolean;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'plans'
      AND column_name = 'portrait_enabled'
  ) INTO portrait_columns_were_missing;

  ALTER TABLE plans
    ADD COLUMN IF NOT EXISTS portrait_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS portrait_profile_limit integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS portrait_active_limit integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS portrait_assets_per_actor integer NOT NULL DEFAULT 0;

  -- 仅在首次增加字段时写入系统套餐默认值；迁移重放不得覆盖管理员后续配置。
  IF portrait_columns_were_missing THEN
    UPDATE plans
    SET portrait_enabled = CASE lower(code)
          WHEN 'free' THEN true
          WHEN 'pro' THEN true
          WHEN 'enterprise' THEN true
          ELSE false
        END,
        portrait_profile_limit = CASE lower(code)
          WHEN 'free' THEN 1
          WHEN 'pro' THEN 5
          WHEN 'enterprise' THEN NULL
          ELSE 0
        END,
        portrait_active_limit = CASE lower(code)
          WHEN 'free' THEN 1
          WHEN 'pro' THEN 3
          WHEN 'enterprise' THEN 10
          ELSE 0
        END,
        portrait_assets_per_actor = CASE lower(code)
          WHEN 'free' THEN 1
          WHEN 'pro' THEN 2
          WHEN 'enterprise' THEN 2
          ELSE 0
        END,
        updated_at = CASE
          WHEN lower(code) IN ('free', 'pro', 'enterprise') OR kind = 'addon' THEN now()
          ELSE updated_at
        END;
  END IF;
END
$migration$;

ALTER TABLE plans
  DROP CONSTRAINT IF EXISTS plans_portrait_entitlements_check;

ALTER TABLE plans
  ADD CONSTRAINT plans_portrait_entitlements_check CHECK (
    portrait_active_limit >= 0
    AND portrait_assets_per_actor >= 0
    AND portrait_assets_per_actor <= 2
    AND (portrait_profile_limit IS NULL OR portrait_profile_limit >= 0)
    AND (
      (
        kind = 'addon'
        AND portrait_enabled = false
        AND portrait_profile_limit = 0
        AND portrait_active_limit = 0
        AND portrait_assets_per_actor = 0
      )
      OR
      (
        kind = 'main'
        AND (
          (
            portrait_enabled = false
            AND portrait_profile_limit = 0
            AND portrait_active_limit = 0
            AND portrait_assets_per_actor = 0
          )
          OR
          (
            portrait_enabled = true
            AND (portrait_profile_limit IS NULL OR portrait_profile_limit > 0)
            AND portrait_active_limit > 0
            AND portrait_assets_per_actor > 0
            AND (portrait_profile_limit IS NULL OR portrait_active_limit <= portrait_profile_limit)
          )
        )
      )
    )
  );

ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS cancel_origin text,
  ADD COLUMN IF NOT EXISTS cancel_reason_code text;

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_cancel_origin_check;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_cancel_origin_check CHECK (
    cancel_origin IS NULL OR btrim(cancel_origin) <> ''
  );

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_cancel_reason_code_check;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_cancel_reason_code_check CHECK (
    cancel_reason_code IS NULL OR btrim(cancel_reason_code) <> ''
  );

CREATE TABLE IF NOT EXISTS real_portrait_actors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  alias text NOT NULL CHECK (btrim(alias) <> '' AND char_length(alias) <= 120),
  plan_access_status text NOT NULL DEFAULT 'available'
    CHECK (plan_access_status IN ('available', 'grace', 'plan_locked')),
  lifecycle_status text NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_status IN (
      'draft', 'waiting', 'invited', 'verifying', 'awaiting_upload', 'processing',
      'active', 'eviction_warning', 'evicted', 'revoked', 'expired', 'deleting', 'sync_error'
    )),
  last_successful_generation_at timestamptz,
  locked_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  CONSTRAINT real_portrait_actors_lock_state_check CHECK (
    plan_access_status <> 'plan_locked' OR locked_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_real_portrait_actors_owner_alias_live
  ON real_portrait_actors(user_id, lower(alias))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_real_portrait_actors_owner_status
  ON real_portrait_actors(user_id, plan_access_status, lifecycle_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_real_portrait_actors_lifecycle
  ON real_portrait_actors(lifecycle_status, updated_at)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS real_portrait_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES real_portrait_actors(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'verified', 'active', 'rejected', 'revoked', 'expired')),
  purpose text NOT NULL CHECK (btrim(purpose) <> ''),
  commercial_use boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  portrait_notice_version text NOT NULL CHECK (btrim(portrait_notice_version) <> ''),
  sensitive_info_notice_version text NOT NULL CHECK (btrim(sensitive_info_notice_version) <> ''),
  consented_at timestamptz,
  revoked_at timestamptz,
  revoke_source text,
  revoke_reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, version),
  UNIQUE (id, actor_id),
  UNIQUE (id, actor_id, version),
  CONSTRAINT real_portrait_authorizations_validity_check CHECK (valid_until > valid_from),
  CONSTRAINT real_portrait_authorizations_consent_check CHECK (
    status NOT IN ('verified', 'active', 'revoked', 'expired') OR consented_at IS NOT NULL
  ),
  CONSTRAINT real_portrait_authorizations_revocation_check CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status <> 'revoked' AND revoked_at IS NULL)
  ),
  CONSTRAINT real_portrait_authorizations_revoke_metadata_check CHECK (
    (revoke_source IS NULL AND revoke_reason_code IS NULL)
    OR revoked_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_real_portrait_authorizations_actor_status
  ON real_portrait_authorizations(actor_id, status, version DESC);
CREATE INDEX IF NOT EXISTS idx_real_portrait_authorizations_expiry
  ON real_portrait_authorizations(valid_until, actor_id)
  WHERE status IN ('pending', 'verified', 'active');

CREATE TABLE IF NOT EXISTS real_portrait_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  authorization_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (btrim(token_hash) <> ''),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'consumed', 'expired', 'cancelled')),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, actor_id, authorization_id),
  FOREIGN KEY (authorization_id, actor_id)
    REFERENCES real_portrait_authorizations(id, actor_id) ON DELETE RESTRICT,
  CONSTRAINT real_portrait_invites_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT real_portrait_invites_acceptance_check CHECK (
    (status IN ('accepted', 'consumed') AND accepted_at IS NOT NULL)
    OR (status NOT IN ('accepted', 'consumed') AND accepted_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_real_portrait_invites_actor_status
  ON real_portrait_invites(actor_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_real_portrait_invites_expiry
  ON real_portrait_invites(status, expires_at)
  WHERE status IN ('pending', 'accepted');

CREATE TABLE IF NOT EXISTS real_portrait_verification_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  authorization_id uuid NOT NULL,
  invite_id uuid NOT NULL,
  byted_token_ciphertext text,
  byted_token_fingerprint text,
  h5_link_ciphertext text,
  callback_nonce_hash text NOT NULL UNIQUE CHECK (btrim(callback_nonce_hash) <> ''),
  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN (
      'prepared', 'submitting', 'invitation_ready', 'waiting', 'verified',
      'failed', 'expired', 'submission_unknown'
    )),
  h5_expires_at timestamptz,
  last_polled_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, actor_id),
  FOREIGN KEY (authorization_id, actor_id)
    REFERENCES real_portrait_authorizations(id, actor_id) ON DELETE RESTRICT,
  FOREIGN KEY (invite_id, actor_id, authorization_id)
    REFERENCES real_portrait_invites(id, actor_id, authorization_id) ON DELETE RESTRICT,
  CONSTRAINT real_portrait_verification_token_pair_check CHECK (
    (byted_token_ciphertext IS NULL AND byted_token_fingerprint IS NULL)
    OR (byted_token_ciphertext IS NOT NULL AND byted_token_fingerprint IS NOT NULL)
  ),
  CONSTRAINT real_portrait_verification_h5_expiry_check CHECK (
    h5_expires_at IS NULL OR h5_expires_at > created_at
  ),
  CONSTRAINT real_portrait_verification_h5_link_check CHECK (
    h5_link_ciphertext IS NULL OR h5_expires_at IS NOT NULL
  ),
  CONSTRAINT real_portrait_verification_failure_check CHECK (
    failure_code IS NULL OR status IN ('failed', 'expired', 'submission_unknown')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_real_portrait_verification_token_fingerprint
  ON real_portrait_verification_sessions(byted_token_fingerprint)
  WHERE byted_token_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_real_portrait_verification_actor_status
  ON real_portrait_verification_sessions(actor_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_real_portrait_verification_expiry
  ON real_portrait_verification_sessions(status, h5_expires_at)
  WHERE status IN ('prepared', 'submitting', 'invitation_ready', 'waiting', 'submission_unknown');

CREATE TABLE IF NOT EXISTS real_portrait_materializations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  authorization_id uuid NOT NULL,
  generation integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  provider_account_key text NOT NULL CHECK (btrim(provider_account_key) <> ''),
  region text NOT NULL CHECK (btrim(region) <> ''),
  project_name text NOT NULL DEFAULT 'default' CHECK (btrim(project_name) <> ''),
  provider_group_id text,
  group_type text NOT NULL DEFAULT 'LivenessFace' CHECK (group_type = 'LivenessFace'),
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN (
      'reserved', 'verifying', 'awaiting_upload', 'processing', 'active',
      'eviction_warning', 'deleting', 'evicted', 'deleted', 'error'
    )),
  activated_at timestamptz,
  last_used_at timestamptz,
  eviction_eligible_at timestamptz,
  remote_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, generation),
  UNIQUE (id, actor_id),
  UNIQUE (id, actor_id, authorization_id),
  FOREIGN KEY (authorization_id, actor_id)
    REFERENCES real_portrait_authorizations(id, actor_id) ON DELETE RESTRICT,
  CONSTRAINT real_portrait_materializations_group_check CHECK (
    provider_group_id IS NOT NULL
    OR status IN ('reserved', 'verifying', 'error')
  ),
  CONSTRAINT real_portrait_materializations_remote_delete_check CHECK (
    remote_deleted_at IS NULL OR status IN ('evicted', 'deleted', 'error')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_real_portrait_materializations_provider_group
  ON real_portrait_materializations(provider_account_key, region, project_name, provider_group_id)
  WHERE provider_group_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_real_portrait_materializations_actor_live
  ON real_portrait_materializations(actor_id)
  WHERE status NOT IN ('evicted', 'deleted', 'error');
CREATE INDEX IF NOT EXISTS idx_real_portrait_materializations_actor_status
  ON real_portrait_materializations(actor_id, status, generation DESC);
CREATE INDEX IF NOT EXISTS idx_real_portrait_materializations_eviction
  ON real_portrait_materializations(status, eviction_eligible_at, last_used_at)
  WHERE status IN ('active', 'eviction_warning', 'deleting');

CREATE TABLE IF NOT EXISTS real_portrait_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  materialization_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('primary', 'secondary')),
  provider_asset_id text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'active', 'failed', 'deleting', 'deleted')),
  consistency_status text NOT NULL DEFAULT 'pending'
    CHECK (consistency_status IN ('pending', 'passed', 'failed', 'unknown')),
  error_code text,
  remote_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, actor_id),
  UNIQUE (id, actor_id, materialization_id),
  FOREIGN KEY (materialization_id, actor_id)
    REFERENCES real_portrait_materializations(id, actor_id) ON DELETE RESTRICT,
  CONSTRAINT real_portrait_assets_provider_id_check CHECK (
    provider_asset_id IS NOT NULL OR status IN ('queued', 'failed')
  ),
  CONSTRAINT real_portrait_assets_error_check CHECK (
    error_code IS NULL OR status = 'failed'
  ),
  CONSTRAINT real_portrait_assets_remote_delete_check CHECK (
    remote_deleted_at IS NULL OR status = 'deleted'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_real_portrait_assets_materialization_kind_live
  ON real_portrait_assets(materialization_id, kind)
  WHERE status <> 'deleted';
CREATE UNIQUE INDEX IF NOT EXISTS idx_real_portrait_assets_provider_id
  ON real_portrait_assets(provider_asset_id)
  WHERE provider_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_real_portrait_assets_actor_status
  ON real_portrait_assets(actor_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_real_portrait_assets_materialization_status
  ON real_portrait_assets(materialization_id, status, kind);

CREATE TABLE IF NOT EXISTS real_portrait_capacity_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  group_slots integer NOT NULL DEFAULT 1 CHECK (group_slots >= 1),
  asset_slots integer NOT NULL DEFAULT 1 CHECK (asset_slots >= 1),
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'consumed', 'released', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id, actor_id),
  FOREIGN KEY (actor_id, user_id)
    REFERENCES real_portrait_actors(id, user_id) ON DELETE RESTRICT,
  CONSTRAINT real_portrait_capacity_reservations_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_real_portrait_capacity_owner_status
  ON real_portrait_capacity_reservations(user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_real_portrait_capacity_expiry
  ON real_portrait_capacity_reservations(status, expires_at)
  WHERE status = 'reserved';
CREATE UNIQUE INDEX IF NOT EXISTS idx_real_portrait_capacity_actor_reserved
  ON real_portrait_capacity_reservations(actor_id)
  WHERE status = 'reserved';

CREATE TABLE IF NOT EXISTS real_portrait_activation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'promoted', 'cancelled', 'completed')),
  reservation_id uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (actor_id, user_id)
    REFERENCES real_portrait_actors(id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (reservation_id, user_id, actor_id)
    REFERENCES real_portrait_capacity_reservations(id, user_id, actor_id) ON DELETE RESTRICT,
  CONSTRAINT real_portrait_activation_queue_promotion_check CHECK (
    status <> 'promoted' OR promoted_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_real_portrait_activation_actor_nonterminal
  ON real_portrait_activation_queue(actor_id)
  WHERE status IN ('waiting', 'promoted');
CREATE INDEX IF NOT EXISTS idx_real_portrait_activation_waiting
  ON real_portrait_activation_queue(status, requested_at, id)
  WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_real_portrait_activation_owner_status
  ON real_portrait_activation_queue(user_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS user_portrait_quota_states (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  source_plan_id uuid REFERENCES plans(id) ON DELETE RESTRICT,
  portrait_enabled boolean NOT NULL,
  profile_limit integer,
  active_limit integer NOT NULL CHECK (active_limit >= 0),
  assets_per_actor integer NOT NULL CHECK (assets_per_actor >= 0 AND assets_per_actor <= 2),
  grace_status text NOT NULL DEFAULT 'none'
    CHECK (grace_status IN ('none', 'active', 'reconciling', 'completed')),
  grace_until timestamptz,
  retained_actor_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  active_actor_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_portrait_quota_profile_limit_check CHECK (
    profile_limit IS NULL OR profile_limit >= 0
  ),
  CONSTRAINT user_portrait_quota_entitlements_check CHECK (
    (
      portrait_enabled = false
      AND profile_limit = 0
      AND active_limit = 0
      AND assets_per_actor = 0
    )
    OR
    (
      portrait_enabled = true
      AND (profile_limit IS NULL OR profile_limit > 0)
      AND active_limit > 0
      AND assets_per_actor > 0
      AND (profile_limit IS NULL OR active_limit <= profile_limit)
    )
  ),
  CONSTRAINT user_portrait_quota_grace_check CHECK (
    (grace_status IN ('active', 'reconciling') AND grace_until IS NOT NULL)
    OR (grace_status = 'none' AND grace_until IS NULL)
    OR grace_status = 'completed'
  ),
  CONSTRAINT user_portrait_quota_retained_array_check CHECK (
    jsonb_typeof(retained_actor_ids) = 'array'
  ),
  CONSTRAINT user_portrait_quota_active_array_check CHECK (
    jsonb_typeof(active_actor_ids) = 'array'
  )
);

CREATE INDEX IF NOT EXISTS idx_user_portrait_quota_grace
  ON user_portrait_quota_states(grace_status, grace_until)
  WHERE grace_status IN ('active', 'reconciling');
CREATE INDEX IF NOT EXISTS idx_user_portrait_quota_source_plan
  ON user_portrait_quota_states(source_plan_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS portrait_entitlement_reconcile_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_key text NOT NULL UNIQUE CHECK (btrim(event_key) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  old_entitlements jsonb NOT NULL,
  new_entitlements jsonb NOT NULL,
  effective_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portrait_entitlement_old_object_check CHECK (jsonb_typeof(old_entitlements) = 'object'),
  CONSTRAINT portrait_entitlement_new_object_check CHECK (jsonb_typeof(new_entitlements) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_portrait_entitlement_outbox_claimable
  ON portrait_entitlement_reconcile_outbox(status, effective_at, created_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_portrait_entitlement_outbox_user
  ON portrait_entitlement_reconcile_outbox(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS real_portrait_upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  materialization_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('primary', 'secondary')),
  status text NOT NULL DEFAULT 'waiting_upload'
    CHECK (status IN (
      'waiting_upload', 'uploaded', 'submitting', 'processing', 'active',
      'failed', 'cancelled', 'expired'
    )),
  object_key text,
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes > 0),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  asset_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (actor_id, user_id)
    REFERENCES real_portrait_actors(id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (materialization_id, actor_id)
    REFERENCES real_portrait_materializations(id, actor_id) ON DELETE RESTRICT,
  FOREIGN KEY (asset_id, actor_id, materialization_id)
    REFERENCES real_portrait_assets(id, actor_id, materialization_id) ON DELETE RESTRICT,
  CONSTRAINT real_portrait_upload_sessions_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT real_portrait_upload_sessions_object_check CHECK (
    (
      object_key IS NULL
      AND mime_type IS NULL
      AND size_bytes IS NULL
      AND width IS NULL
      AND height IS NULL
      AND sha256 IS NULL
      AND status IN ('waiting_upload', 'failed', 'cancelled', 'expired')
    )
    OR (
      object_key IS NOT NULL
      AND mime_type IS NOT NULL
      AND size_bytes IS NOT NULL
      AND sha256 IS NOT NULL
    )
  ),
  CONSTRAINT real_portrait_upload_sessions_asset_check CHECK (
    status <> 'active' OR asset_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_real_portrait_upload_object_key
  ON real_portrait_upload_sessions(object_key)
  WHERE object_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_real_portrait_upload_owner_status
  ON real_portrait_upload_sessions(user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_real_portrait_upload_actor_kind
  ON real_portrait_upload_sessions(actor_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_real_portrait_upload_expiry
  ON real_portrait_upload_sessions(status, expires_at)
  WHERE status IN ('waiting_upload', 'uploaded', 'submitting', 'processing');

CREATE TABLE IF NOT EXISTS real_portrait_remote_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  materialization_id uuid,
  portrait_asset_id uuid,
  verification_session_id uuid,
  operation_type text NOT NULL CHECK (btrim(operation_type) <> ''),
  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN (
      'prepared', 'submitting', 'submitted', 'submission_unknown',
      'completed', 'failed', 'manual_review'
    )),
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_retry_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (actor_id, user_id)
    REFERENCES real_portrait_actors(id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (materialization_id, actor_id)
    REFERENCES real_portrait_materializations(id, actor_id) ON DELETE RESTRICT,
  FOREIGN KEY (portrait_asset_id, actor_id)
    REFERENCES real_portrait_assets(id, actor_id) ON DELETE RESTRICT,
  FOREIGN KEY (verification_session_id, actor_id)
    REFERENCES real_portrait_verification_sessions(id, actor_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_real_portrait_remote_operations_claimable
  ON real_portrait_remote_operations(status, next_retry_at, created_at)
  WHERE status IN ('prepared', 'submission_unknown', 'failed');
CREATE INDEX IF NOT EXISTS idx_real_portrait_remote_operations_owner
  ON real_portrait_remote_operations(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_real_portrait_remote_operations_actor
  ON real_portrait_remote_operations(actor_id, operation_type, created_at DESC);

CREATE TABLE IF NOT EXISTS generation_real_portrait_references (
  task_id uuid NOT NULL REFERENCES generation_tasks(id) ON DELETE RESTRICT,
  task_attempt integer NOT NULL DEFAULT 0 CHECK (task_attempt >= 0),
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  actor_id uuid NOT NULL REFERENCES real_portrait_actors(id) ON DELETE RESTRICT,
  authorization_id uuid NOT NULL,
  materialization_id uuid NOT NULL,
  portrait_asset_id uuid NOT NULL,
  authorization_version integer NOT NULL CHECK (authorization_version >= 1),
  provider_asset_id_snapshot text NOT NULL CHECK (btrim(provider_asset_id_snapshot) <> ''),
  bound_at timestamptz NOT NULL DEFAULT now(),
  use_started_at timestamptz,
  PRIMARY KEY (task_id, task_attempt, position),
  FOREIGN KEY (authorization_id, actor_id, authorization_version)
    REFERENCES real_portrait_authorizations(id, actor_id, version) ON DELETE RESTRICT,
  FOREIGN KEY (materialization_id, actor_id, authorization_id)
    REFERENCES real_portrait_materializations(id, actor_id, authorization_id) ON DELETE RESTRICT,
  FOREIGN KEY (portrait_asset_id, actor_id, materialization_id)
    REFERENCES real_portrait_assets(id, actor_id, materialization_id) ON DELETE RESTRICT,
  CONSTRAINT generation_real_portrait_use_time_check CHECK (
    use_started_at IS NULL OR use_started_at >= bound_at
  )
);

CREATE INDEX IF NOT EXISTS idx_generation_real_portrait_actor
  ON generation_real_portrait_references(actor_id, bound_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_real_portrait_materialization
  ON generation_real_portrait_references(materialization_id, portrait_asset_id, bound_at DESC);

CREATE TABLE IF NOT EXISTS real_portrait_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES real_portrait_actors(id) ON DELETE RESTRICT,
  authorization_id uuid REFERENCES real_portrait_authorizations(id) ON DELETE RESTRICT,
  materialization_id uuid REFERENCES real_portrait_materializations(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  initiator_type text NOT NULL CHECK (initiator_type IN ('user', 'subject', 'admin', 'system')),
  initiator_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT real_portrait_events_initiator_check CHECK (
    (initiator_type IN ('user', 'admin') AND initiator_user_id IS NOT NULL)
    OR initiator_type IN ('subject', 'system')
  )
);

CREATE INDEX IF NOT EXISTS idx_real_portrait_events_owner_created
  ON real_portrait_events(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_real_portrait_events_actor_created
  ON real_portrait_events(actor_id, created_at DESC, id DESC)
  WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_real_portrait_events_type_created
  ON real_portrait_events(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS real_portrait_subject_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id uuid NOT NULL REFERENCES real_portrait_authorizations(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (btrim(token_hash) <> ''),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT real_portrait_subject_tokens_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_real_portrait_subject_tokens_expiry
  ON real_portrait_subject_access_tokens(status, expires_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_real_portrait_subject_tokens_authorization
  ON real_portrait_subject_access_tokens(authorization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_clean_export_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  generation_task_id uuid NOT NULL REFERENCES generation_tasks(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES real_portrait_actors(id) ON DELETE RESTRICT,
  notice_version text NOT NULL CHECK (btrim(notice_version) <> ''),
  accepted_at timestamptz NOT NULL,
  ip_hash text NOT NULL CHECK (btrim(ip_hash) <> ''),
  user_agent_hash text NOT NULL CHECK (btrim(user_agent_hash) <> ''),
  retain_until timestamptz NOT NULL,
  CONSTRAINT ai_clean_export_audits_retention_check CHECK (retain_until > accepted_at)
);

CREATE INDEX IF NOT EXISTS idx_ai_clean_export_audits_owner
  ON ai_clean_export_audits(user_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_clean_export_audits_asset
  ON ai_clean_export_audits(asset_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_clean_export_audits_retention
  ON ai_clean_export_audits(retain_until, id);

CREATE OR REPLACE FUNCTION reject_real_portrait_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '真人素材审计证据不可修改或删除：table=%, operation=%', TG_TABLE_NAME, TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS real_portrait_events_immutable ON real_portrait_events;
CREATE TRIGGER real_portrait_events_immutable
BEFORE UPDATE OR DELETE ON real_portrait_events
FOR EACH ROW EXECUTE FUNCTION reject_real_portrait_audit_mutation();

DROP TRIGGER IF EXISTS ai_clean_export_audits_immutable ON ai_clean_export_audits;
CREATE TRIGGER ai_clean_export_audits_immutable
BEFORE UPDATE OR DELETE ON ai_clean_export_audits
FOR EACH ROW EXECUTE FUNCTION reject_real_portrait_audit_mutation();
