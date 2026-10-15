ALTER TABLE asset_folders
  DROP CONSTRAINT IF EXISTS asset_folders_source_check;

ALTER TABLE asset_folders
  ADD CONSTRAINT asset_folders_source_check
  CHECK (source IN ('ai-video', 'ai-image', 'uploaded-video', 'uploaded-image', 'uploaded-audio'));

ALTER TABLE assets
  DROP CONSTRAINT IF EXISTS assets_type_check;

ALTER TABLE assets
  ADD CONSTRAINT assets_type_check
  CHECK (type IN ('video', 'image', 'audio'));

ALTER TABLE assets
  DROP CONSTRAINT IF EXISTS assets_source_check;

ALTER TABLE assets
  ADD CONSTRAINT assets_source_check
  CHECK (source IN ('ai-video', 'ai-image', 'uploaded-video', 'uploaded-image', 'uploaded-audio'));

INSERT INTO asset_folders (user_id, name, source, is_system)
SELECT users.id, '已上传音频', 'uploaded-audio', true
FROM users
WHERE NOT EXISTS (
  SELECT 1
  FROM asset_folders
  WHERE asset_folders.user_id = users.id
    AND asset_folders.source = 'uploaded-audio'
    AND asset_folders.is_system = true
);
