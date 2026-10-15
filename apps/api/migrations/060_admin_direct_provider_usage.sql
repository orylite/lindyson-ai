-- 管理员可直接调用供应商生成营销素材；这类用量进入供应商成本账本，
-- 但不伪造站内生成任务、数字资产或用户积分流水。
ALTER TABLE provider_usage_records
  ADD COLUMN IF NOT EXISTS initiated_by_admin_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'provider_usage_records_admin_user_fk'
      AND conrelid = 'provider_usage_records'::regclass
  ) THEN
    ALTER TABLE provider_usage_records
      ADD CONSTRAINT provider_usage_records_admin_user_fk
      FOREIGN KEY (initiated_by_admin_user_id)
      REFERENCES users(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE provider_usage_records
  DROP CONSTRAINT IF EXISTS provider_usage_records_single_origin_check;

ALTER TABLE provider_usage_records
  ADD CONSTRAINT provider_usage_records_single_origin_check CHECK (
    task_id IS NULL OR initiated_by_admin_user_id IS NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_usage_records_admin_direct_task
  ON provider_usage_records(provider, provider_task_id)
  WHERE task_id IS NULL
    AND initiated_by_admin_user_id IS NOT NULL
    AND provider_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_usage_records_admin_direct_user
  ON provider_usage_records(initiated_by_admin_user_id, created_at DESC)
  WHERE initiated_by_admin_user_id IS NOT NULL;
