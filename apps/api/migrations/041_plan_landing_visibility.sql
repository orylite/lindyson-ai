ALTER TABLE plans
ADD COLUMN IF NOT EXISTS landing_visible boolean NOT NULL DEFAULT false;

UPDATE plans
SET landing_visible = true,
    updated_at = now()
WHERE kind = 'main'
  AND status = 'active'
  AND lower(code) IN ('free', 'basic', 'pro', 'ultra', 'enterprise')
  AND landing_visible = false;

UPDATE plans
SET landing_visible = false,
    updated_at = now()
WHERE kind = 'addon'
  AND landing_visible = true;

ALTER TABLE plans
DROP CONSTRAINT IF EXISTS plans_landing_visibility_by_kind_check;

ALTER TABLE plans
ADD CONSTRAINT plans_landing_visibility_by_kind_check
CHECK (kind = 'main' OR landing_visible = false);
