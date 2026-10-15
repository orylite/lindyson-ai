DELETE FROM provider_usage_records
WHERE usage_unit = 'legacy-credit';

ALTER TABLE provider_usage_records
  ALTER COLUMN usage_unit SET DEFAULT 'tokens';

ALTER TABLE provider_usage_records
  DROP CONSTRAINT IF EXISTS provider_usage_records_usage_unit_check;

ALTER TABLE provider_usage_records
  ADD CONSTRAINT provider_usage_records_usage_unit_check
  CHECK (usage_unit IN ('tokens', 'credits'));
