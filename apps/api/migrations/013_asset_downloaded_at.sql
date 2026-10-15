ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS downloaded_at timestamptz;
