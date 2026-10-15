-- 上传会话由“一次性签名记录”升级为可恢复、可查询且带 fencing token 的状态机。
ALTER TABLE upload_sessions
  DROP CONSTRAINT IF EXISTS upload_sessions_status_check;

ALTER TABLE upload_sessions
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_hash text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS asset_type text,
  ADD COLUMN IF NOT EXISTS asset_name text,
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES asset_folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS final_object_key text,
  ADD COLUMN IF NOT EXISTS thumbnail_key text,
  ADD COLUMN IF NOT EXISTS actual_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS sealed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sealed_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS retryable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_stage text NOT NULL DEFAULT 'waiting-upload',
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_until timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

UPDATE upload_sessions
SET idempotency_key = COALESCE(idempotency_key, 'legacy:' || id::text),
    request_hash = COALESCE(request_hash, 'legacy:' || id::text),
    asset_name = COALESCE(NULLIF(asset_name, ''), NULLIF(regexp_replace(filename, '\\.[^.]+$', ''), ''), 'asset'),
    retention_until = COALESCE(retention_until, expires_at + interval '24 hours'),
    processing_stage = CASE status
      WHEN 'completed' THEN 'completed'
      WHEN 'expired' THEN 'expired'
      ELSE processing_stage
    END;

-- 只有明确 MIME 前缀的未完成会话才可按声明分类；未知类型不猜测。
UPDATE upload_sessions
SET source = CASE
      WHEN content_type LIKE 'video/%' THEN 'uploaded-video'
      WHEN content_type LIKE 'audio/%' THEN 'uploaded-audio'
      WHEN content_type LIKE 'image/%' THEN 'uploaded-image'
      ELSE source
    END,
    asset_type = CASE
      WHEN content_type LIKE 'video/%' THEN 'video'
      WHEN content_type LIKE 'audio/%' THEN 'audio'
      WHEN content_type LIKE 'image/%' THEN 'image'
      ELSE asset_type
    END
WHERE status <> 'completed' AND (source IS NULL OR asset_type IS NULL);

-- 宽限期内仍可继续的历史会话补齐确定性 final key 与真实系统目录。final key
-- 从未签发给浏览器，worker 只会把旧 object_key 的 staging 字节封口复制到这里。
UPDATE upload_sessions
SET final_object_key = 'users/' || user_id::text || '/uploads/' || id::text || '/' ||
    COALESCE(
      NULLIF(trim(BOTH '-' FROM regexp_replace(filename, '[^a-zA-Z0-9._-]+', '-', 'g')), ''),
      'asset'
    )
WHERE status <> 'completed' AND final_object_key IS NULL;

UPDATE upload_sessions session
SET folder_id = folder.id
FROM asset_folders folder
WHERE session.status <> 'completed'
  AND session.folder_id IS NULL
  AND folder.user_id = session.user_id
  AND folder.source = session.source
  AND folder.is_system = true;

-- completed 一律以真实资产为事实源，不能使用签名大小或客户端 MIME 猜测。
UPDATE upload_sessions session
SET source = asset.source,
    asset_type = asset.type,
    asset_name = asset.name,
    folder_id = asset.folder_id,
    final_object_key = asset.object_key,
    thumbnail_key = asset.thumbnail_key,
    actual_size_bytes = asset.size_bytes,
    completed_at = COALESCE(session.completed_at, session.updated_at, session.created_at),
    sealed_at = COALESCE(session.sealed_at, session.completed_at, session.updated_at),
    sealed_size_bytes = asset.size_bytes
FROM assets asset
WHERE session.status = 'completed'
  AND session.asset_id = asset.id
  AND session.user_id = asset.user_id
  AND asset.deletion_status <> 'deleted';

UPDATE upload_sessions session
SET asset_id = asset.id,
    source = asset.source,
    asset_type = asset.type,
    asset_name = asset.name,
    folder_id = asset.folder_id,
    final_object_key = asset.object_key,
    thumbnail_key = asset.thumbnail_key,
    actual_size_bytes = asset.size_bytes,
    completed_at = COALESCE(session.completed_at, session.updated_at, session.created_at),
    sealed_at = COALESCE(session.sealed_at, session.completed_at, session.updated_at),
    sealed_size_bytes = asset.size_bytes
FROM assets asset
WHERE session.status = 'completed'
  AND session.asset_id IS NULL
  AND asset.user_id = session.user_id
  AND asset.object_key = session.object_key
  AND asset.deletion_status <> 'deleted';

UPDATE upload_sessions
SET status = 'expired',
    processing_stage = 'expired',
    error_code = CASE
      WHEN source IS NULL OR asset_type IS NULL THEN 'LEGACY_UPLOAD_TYPE_UNKNOWN'
      WHEN folder_id IS NULL THEN 'LEGACY_UPLOAD_FOLDER_UNKNOWN'
      ELSE 'UPLOAD_SESSION_EXPIRED'
    END,
    error_message = CASE
      WHEN source IS NULL OR asset_type IS NULL THEN '历史上传会话无法可靠判定媒体类型'
      WHEN folder_id IS NULL THEN '历史上传会话无法可靠确定素材目录'
      ELSE '上传签名及宽限期已过期'
    END,
    retention_until = now(),
    updated_at = now()
WHERE status = 'pending'
  AND (
    source IS NULL OR asset_type IS NULL
    OR folder_id IS NULL
    OR expires_at < now() - interval '15 minutes'
  );

ALTER TABLE upload_sessions
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN request_hash SET NOT NULL,
  ALTER COLUMN asset_name SET NOT NULL,
  ALTER COLUMN retention_until SET NOT NULL;

ALTER TABLE upload_sessions
  DROP CONSTRAINT IF EXISTS upload_sessions_source_check,
  DROP CONSTRAINT IF EXISTS upload_sessions_asset_type_check,
  DROP CONSTRAINT IF EXISTS upload_sessions_source_type_check,
  DROP CONSTRAINT IF EXISTS upload_sessions_source_required_check,
  DROP CONSTRAINT IF EXISTS upload_sessions_attempt_check,
  DROP CONSTRAINT IF EXISTS upload_sessions_actual_size_check,
  DROP CONSTRAINT IF EXISTS upload_sessions_sealed_size_check,
  DROP CONSTRAINT IF EXISTS upload_sessions_processing_stage_check;

ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'canceled', 'expired')),
  ADD CONSTRAINT upload_sessions_source_check
  CHECK (source IN ('uploaded-video', 'uploaded-image', 'uploaded-audio')),
  ADD CONSTRAINT upload_sessions_asset_type_check
  CHECK (asset_type IN ('video', 'image', 'audio')),
  ADD CONSTRAINT upload_sessions_source_type_check
  CHECK (
    (source = 'uploaded-video' AND asset_type = 'video') OR
    (source = 'uploaded-image' AND asset_type = 'image') OR
    (source = 'uploaded-audio' AND asset_type = 'audio')
  ),
  ADD CONSTRAINT upload_sessions_source_required_check
  CHECK (
    status = 'expired'
    OR (
      source IS NOT NULL AND asset_type IS NOT NULL
      AND folder_id IS NOT NULL AND final_object_key IS NOT NULL
    )
  ),
  ADD CONSTRAINT upload_sessions_attempt_check CHECK (attempt >= 0),
  ADD CONSTRAINT upload_sessions_actual_size_check CHECK (actual_size_bytes IS NULL OR actual_size_bytes >= 0),
  ADD CONSTRAINT upload_sessions_sealed_size_check CHECK (sealed_size_bytes IS NULL OR sealed_size_bytes > 0),
  ADD CONSTRAINT upload_sessions_processing_stage_check
  CHECK (processing_stage IN (
    'waiting-upload', 'queued', 'sealing', 'validating', 'probing',
    'thumbnailing', 'persisting', 'completed', 'failed', 'canceled', 'expired'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_sessions_user_idempotency
  ON upload_sessions(user_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_sessions_final_object_key
  ON upload_sessions(final_object_key)
  WHERE final_object_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_upload_sessions_worker_claim
  ON upload_sessions(status, lease_expires_at, updated_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_upload_sessions_retention
  ON upload_sessions(retention_until)
  WHERE status IN ('failed', 'canceled', 'expired');

-- 对象删除使用随机 claim token 防止过期 worker 覆盖接管者的结果。
ALTER TABLE object_deletion_outbox
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

ALTER TABLE object_deletion_outbox
  DROP CONSTRAINT IF EXISTS object_deletion_outbox_status_check;
ALTER TABLE object_deletion_outbox
  ADD CONSTRAINT object_deletion_outbox_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'skipped'));

INSERT INTO object_deletion_outbox (object_key, asset_ids, status, available_at)
SELECT session.object_key, '{}'::uuid[], 'pending', now()
FROM upload_sessions session
WHERE session.status = 'expired'
  AND session.asset_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM assets asset
    WHERE asset.user_id = session.user_id
      AND asset.object_key = session.object_key
      AND asset.deletion_status <> 'deleted'
  )
ON CONFLICT (object_key) DO UPDATE
SET status = 'pending', claim_token = NULL, lease_expires_at = NULL,
    available_at = LEAST(object_deletion_outbox.available_at, now()), updated_at = now()
WHERE object_deletion_outbox.status = 'pending'
   OR (
     object_deletion_outbox.status = 'processing'
     AND (
       object_deletion_outbox.claim_token IS NULL
       OR object_deletion_outbox.lease_expires_at IS NULL
       OR object_deletion_outbox.lease_expires_at <= now()
     )
   );

-- 旧 processing 没有 fencing token，或租约已经过期，不能继续声称所有权；重新排队。
-- 重复执行迁移时保留 completed/skipped 终态以及仍有效的新 worker 租约。
UPDATE object_deletion_outbox
SET status = 'pending', claim_token = NULL, lease_expires_at = NULL,
    available_at = LEAST(available_at, now()), updated_at = now()
WHERE status = 'processing'
  AND (claim_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= now());

CREATE INDEX IF NOT EXISTS idx_object_deletion_outbox_claimable
  ON object_deletion_outbox(status, available_at, lease_expires_at, created_at)
  WHERE status IN ('pending', 'processing');

-- 历史 completed 会话必须能回链到同用户、同对象的真实上传资产。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM upload_sessions session
    WHERE session.status = 'completed'
      AND (
        session.asset_id IS NULL OR session.source NOT IN ('uploaded-video', 'uploaded-image', 'uploaded-audio')
        OR session.asset_type NOT IN ('video', 'image', 'audio') OR session.actual_size_bytes IS NULL
      )
  ) THEN
    RAISE EXCEPTION '存在无法回链资产的 completed upload session';
  END IF;
END $$;
