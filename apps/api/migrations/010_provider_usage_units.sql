ALTER TABLE provider_usage_records
  ADD COLUMN IF NOT EXISTS usage_unit text;

UPDATE provider_usage_records
SET usage_unit = 'legacy-credit'
WHERE usage_unit IS NULL OR usage_unit = '';

ALTER TABLE provider_usage_records
  ALTER COLUMN usage_unit SET DEFAULT 'legacy-credit';

ALTER TABLE provider_usage_records
  ALTER COLUMN usage_unit SET NOT NULL;

ALTER TABLE provider_usage_records
  DROP CONSTRAINT IF EXISTS provider_usage_records_usage_unit_check;

ALTER TABLE provider_usage_records
  ADD CONSTRAINT provider_usage_records_usage_unit_check
  CHECK (usage_unit IN ('tokens', 'credits', 'legacy-credit'));
