ALTER TABLE plans
ADD COLUMN icon_key text;

UPDATE plans
SET icon_key = CASE
  WHEN kind = 'addon' THEN NULL
  WHEN recommendation = 'enterprise' OR lower(code) = 'enterprise' THEN 'building-2'
  WHEN lower(code) IN ('free', 'basic') THEN 'zap'
  WHEN lower(code) = 'ultra' THEN 'crown'
  WHEN recommendation = 'popular' OR lower(code) = 'pro' THEN 'sparkles'
  ELSE 'sparkles'
END;

ALTER TABLE plans
ADD CONSTRAINT plans_icon_key_by_kind_check CHECK (
  (kind = 'main' AND (icon_key IS NULL OR icon_key IN ('zap', 'sparkles', 'crown', 'gem', 'rocket', 'building-2')))
  OR (kind = 'addon' AND icon_key IS NULL)
);
