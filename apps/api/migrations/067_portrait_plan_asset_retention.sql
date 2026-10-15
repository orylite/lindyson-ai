-- 真人演员库启用后，历史 AI 生成素材必须具有明确且有限的套餐保留期。
-- 本迁移只更新已经存在的套餐代码，不创建价格、积分等产品定义未知的新套餐。

DO $migration$
DECLARE
  portrait_retention_policy_was_missing boolean;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'plans'::regclass
      AND conname = 'plans_portrait_asset_retention_check'
  ) INTO portrait_retention_policy_was_missing;

  -- 只在首次应用本策略时写入用户确认的标准档位；直接重放不得覆盖管理员后续配置。
  IF portrait_retention_policy_was_missing THEN
    UPDATE plans
    SET asset_retention_days = CASE lower(code)
          WHEN 'free' THEN 7
          WHEN 'basic' THEN 15
          WHEN 'pro' THEN 30
          WHEN 'ultra' THEN 60
          WHEN 'enterprise' THEN 90
          ELSE asset_retention_days
        END,
        updated_at = now()
    WHERE kind = 'main'
      AND lower(code) IN ('free', 'basic', 'pro', 'ultra', 'enterprise')
      AND asset_retention_days IS DISTINCT FROM CASE lower(code)
            WHEN 'free' THEN 7
            WHEN 'basic' THEN 15
            WHEN 'pro' THEN 30
            WHEN 'ultra' THEN 60
            WHEN 'enterprise' THEN 90
            ELSE asset_retention_days
          END;
  END IF;

  -- 未知自定义套餐不能根据名称或价格猜测保留期；要求管理员先显式补齐。
  IF EXISTS (
    SELECT 1
    FROM plans
    WHERE kind = 'main'
      AND portrait_enabled = true
      AND asset_retention_days = 0
  ) THEN
    RAISE EXCEPTION
      '启用真人演员库的主套餐必须显式设置正整数 asset_retention_days（1-3650）';
  END IF;
END
$migration$;

ALTER TABLE plans
  DROP CONSTRAINT IF EXISTS plans_portrait_asset_retention_check;

ALTER TABLE plans
  ADD CONSTRAINT plans_portrait_asset_retention_check CHECK (
    (
      kind = 'addon'
      AND asset_retention_days = 0
    )
    OR
    (
      kind = 'main'
      AND (
        portrait_enabled = false
        OR asset_retention_days BETWEEN 1 AND 3650
      )
    )
  );
