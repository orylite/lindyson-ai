-- 保留已删除文件夹的用户归属，使 DELETE 响应丢失后的安全重试仍返回成功，
-- 同时不把其他用户或从未存在的文件夹误报为已删除。
CREATE TABLE IF NOT EXISTS asset_folder_deletion_records (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, folder_id)
);

