-- 新批次固定生成两个提示词方案，同时保留历史三方案批次的只读兼容。
-- 迁移只放宽已完成批次的 JSONB 形状，不改写任何历史方案或成本流水。

ALTER TABLE prompt_wizard_batches
  DROP CONSTRAINT IF EXISTS prompt_wizard_batches_completed_shape_check;

ALTER TABLE prompt_wizard_batches
  ADD CONSTRAINT prompt_wizard_batches_completed_shape_check CHECK (
    status <> 'completed'
    OR content_purged_at IS NOT NULL
    OR (
      plans IS NOT NULL
      AND jsonb_typeof(plans) = 'array'
      AND jsonb_array_length(plans) IN (2, 3)
    )
  );
