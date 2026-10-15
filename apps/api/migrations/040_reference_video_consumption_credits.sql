ALTER TABLE consumption_settings
  ADD COLUMN reference_video_credits integer;

UPDATE consumption_settings
SET reference_video_credits = credits
WHERE kind = 'video'
  AND reference_video_credits IS NULL;

ALTER TABLE consumption_settings
  ADD CONSTRAINT consumption_settings_reference_video_credits_check
  CHECK (
    (kind = 'video' AND reference_video_credits IS NOT NULL AND reference_video_credits >= 0)
    OR
    (kind = 'image' AND reference_video_credits IS NULL)
  );
