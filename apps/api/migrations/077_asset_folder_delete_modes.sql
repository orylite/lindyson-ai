ALTER TABLE asset_folder_deletion_records
  ADD COLUMN IF NOT EXISTS content_action text,
  ADD COLUMN IF NOT EXISTS affected_asset_count integer;

-- 077 之前删除文件夹的唯一行为是连同目录内素材一起删除。
-- 影响数量在旧版本中没有被记录，保持 NULL 以准确表达未知。
UPDATE asset_folder_deletion_records
SET content_action = 'delete-assets'
WHERE content_action IS NULL;

ALTER TABLE asset_folder_deletion_records
  ALTER COLUMN content_action SET DEFAULT 'delete-assets',
  ALTER COLUMN content_action SET NOT NULL;

ALTER TABLE asset_folder_deletion_records
  DROP CONSTRAINT IF EXISTS asset_folder_deletion_records_content_action_check;

ALTER TABLE asset_folder_deletion_records
  ADD CONSTRAINT asset_folder_deletion_records_content_action_check
  CHECK (content_action IN ('move-to-root', 'delete-assets'));

ALTER TABLE asset_folder_deletion_records
  DROP CONSTRAINT IF EXISTS asset_folder_deletion_records_affected_asset_count_check;

ALTER TABLE asset_folder_deletion_records
  ADD CONSTRAINT asset_folder_deletion_records_affected_asset_count_check
  CHECK (affected_asset_count IS NULL OR affected_asset_count >= 0);

-- 046 要求所有非 expired 会话都必须保留 folder_id，047 又把 folder_id
-- 纳入绝对不可变身份。这两个旧约束都早于“删除普通目录时迁回系统主目录”能力：
-- 可恢复会话必须迁回同来源主目录，终态历史会话则只脱钩，不能伪装成在主目录完成。
ALTER TABLE upload_sessions
  DROP CONSTRAINT IF EXISTS upload_sessions_source_required_check;

ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_source_required_check
  CHECK (
    status = 'expired'
    OR (
      source IS NOT NULL AND asset_type IS NOT NULL AND final_object_key IS NOT NULL
      AND (
        folder_id IS NOT NULL
        OR status IN ('completed', 'canceled')
        OR (
          status = 'failed'
          AND NOT (retryable = true AND retention_until > now())
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION preserve_upload_session_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- folder_id 在下方按目录生命周期单独验证；其余请求身份和对象路径仍绝对不可变。
  IF ROW(
    NEW.user_id, NEW.object_key, NEW.filename, NEW.content_type,
    NEW.max_size_bytes, NEW.idempotency_key, NEW.request_hash, NEW.source,
    NEW.asset_type, NEW.asset_name, NEW.final_object_key
  ) IS DISTINCT FROM ROW(
    OLD.user_id, OLD.object_key, OLD.filename, OLD.content_type,
    OLD.max_size_bytes, OLD.idempotency_key, OLD.request_hash, OLD.source,
    OLD.asset_type, OLD.asset_name, OLD.final_object_key
  ) THEN
    RAISE EXCEPTION 'upload_sessions 请求身份或对象路径不可修改：session=%', OLD.id;
  END IF;

  IF NEW.folder_id IS DISTINCT FROM OLD.folder_id
     AND NOT (
       -- 仍可能封口成素材的会话，只能从普通目录迁到同用户、同来源系统主目录。
       (
         OLD.folder_id IS NOT NULL
         AND NEW.folder_id IS NOT NULL
         AND (
           OLD.status IN ('pending', 'processing')
           OR (
             OLD.status = 'failed'
             AND OLD.retryable = true
             AND OLD.retention_until > now()
           )
         )
         AND (
           NEW.status IN ('pending', 'processing')
           OR (
             NEW.status = 'failed'
             AND NEW.retryable = true
             AND NEW.retention_until > now()
           )
         )
         AND EXISTS (
           SELECT 1
           FROM asset_folders old_folder
           JOIN asset_folders new_folder ON new_folder.id = NEW.folder_id
           WHERE old_folder.id = OLD.folder_id
             AND old_folder.user_id = OLD.user_id
             AND new_folder.user_id = OLD.user_id
             AND old_folder.source = OLD.source
             AND new_folder.source = OLD.source
             AND old_folder.is_system = false
             AND new_folder.is_system = true
         )
       )
       OR
       -- 终态会话只保留历史，不再产生素材；删除其普通目录时允许受控脱钩。
       (
         OLD.folder_id IS NOT NULL
         AND NEW.folder_id IS NULL
         AND (
           OLD.status IN ('completed', 'canceled', 'expired')
           OR (
             OLD.status = 'failed'
             AND NOT (OLD.retryable = true AND OLD.retention_until > now())
           )
         )
         AND (
           NEW.status IN ('completed', 'canceled', 'expired')
           OR (
             NEW.status = 'failed'
             AND NOT (NEW.retryable = true AND NEW.retention_until > now())
           )
         )
         AND EXISTS (
           SELECT 1
           FROM asset_folders old_folder
           WHERE old_folder.id = OLD.folder_id
             AND old_folder.user_id = OLD.user_id
             AND old_folder.source = OLD.source
             AND old_folder.is_system = false
         )
       )
     ) THEN
    RAISE EXCEPTION
      'upload_sessions.folder_id 仅允许可恢复会话迁入同来源主目录或终态会话从普通目录脱钩：session=%',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

-- 显式重建可防止历史环境缺失 trigger；重复执行迁移也只保留一个实例。
DROP TRIGGER IF EXISTS upload_sessions_preserve_identity ON upload_sessions;
CREATE TRIGGER upload_sessions_preserve_identity
BEFORE UPDATE ON upload_sessions
FOR EACH ROW EXECUTE FUNCTION preserve_upload_session_identity();
