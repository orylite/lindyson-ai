INSERT INTO asset_folders (user_id, name, source, is_system)
SELECT users.id, defaults.name, defaults.source, true
FROM users
CROSS JOIN (
  VALUES
    ('AI 视频', 'ai-video'),
    ('AI 图片', 'ai-image'),
    ('已上传视频', 'uploaded-video'),
    ('已上传图片', 'uploaded-image'),
    ('已上传音频', 'uploaded-audio')
) AS defaults(name, source)
WHERE NOT EXISTS (
  SELECT 1
  FROM asset_folders existing
  WHERE existing.user_id = users.id
    AND existing.source = defaults.source
    AND existing.is_system = true
);

CREATE TEMP TABLE asset_folder_merge_map ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY user_id, source
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id,
    row_number() OVER (
      PARTITION BY user_id, source
      ORDER BY created_at ASC, id ASC
    ) AS position
  FROM asset_folders
  WHERE is_system = true
)
SELECT id AS duplicate_id, canonical_id
FROM ranked
WHERE position > 1;

UPDATE assets
SET folder_id = merge_map.canonical_id,
    updated_at = now()
FROM asset_folder_merge_map merge_map
WHERE assets.folder_id = merge_map.duplicate_id;

DELETE FROM asset_folders folders
USING asset_folder_merge_map merge_map
WHERE folders.id = merge_map.duplicate_id;

UPDATE assets
SET folder_id = root_folder.id,
    updated_at = now()
FROM asset_folders root_folder
WHERE assets.folder_id IS NULL
  AND assets.deletion_status = 'active'
  AND root_folder.user_id = assets.user_id
  AND root_folder.source = assets.source
  AND root_folder.is_system = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_folders_unique_system_source
  ON asset_folders(user_id, source)
  WHERE is_system;

ALTER TABLE assets
  DROP CONSTRAINT IF EXISTS assets_active_folder_required;

ALTER TABLE assets
  ADD CONSTRAINT assets_active_folder_required
  CHECK (deletion_status <> 'active' OR folder_id IS NOT NULL)
  NOT VALID;

ALTER TABLE assets
  VALIDATE CONSTRAINT assets_active_folder_required;
