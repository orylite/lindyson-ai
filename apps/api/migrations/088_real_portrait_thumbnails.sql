-- 旧授权默认不保存缩略图；新授权在生成告知快照时明确启用。
ALTER TABLE real_portrait_authorizations
  ADD COLUMN IF NOT EXISTS thumbnail_storage_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE real_portrait_assets
  ADD COLUMN IF NOT EXISTS thumbnail_object_key text,
  ADD COLUMN IF NOT EXISTS thumbnail_ready boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'real_portrait_assets'::regclass
    AND conname = 'real_portrait_thumbnail_ready_check') THEN
    ALTER TABLE real_portrait_assets ADD CONSTRAINT real_portrait_thumbnail_ready_check
      CHECK (NOT thumbnail_ready OR thumbnail_object_key IS NOT NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_real_portrait_thumbnail_cleanup ON real_portrait_assets(id)
  WHERE thumbnail_object_key IS NOT NULL;
