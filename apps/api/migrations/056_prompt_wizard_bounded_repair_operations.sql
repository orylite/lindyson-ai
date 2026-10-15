-- 提示词向导：为产品 JSON 格式恢复与单方案内容定向修复增加独立成本操作。
-- repair-product-format 仅归属于 run；repair-draft-content 归属于批次和具体方案。
-- 本迁移完整保留 052–055 的历史 operation，不能缩窄既有成本流水的可读范围。

ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_operation_check;

ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_operation_check CHECK (
    operation IN (
      'analyze-product',
      'repair-product-chinese',
      'repair-product-profile',
      'repair-product-format',
      'generate-drafts',
      'repair-draft-format',
      'repair-draft-content'
    )
  );

ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_owner_shape_check;

ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_owner_shape_check CHECK (
    (
      operation IN (
        'analyze-product',
        'repair-product-chinese',
        'repair-product-profile',
        'repair-product-format'
      )
      AND batch_id IS NULL
    )
    OR (
      operation IN (
        'generate-drafts',
        'repair-draft-format',
        'repair-draft-content'
      )
      AND batch_id IS NOT NULL
    )
  );

ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_plan_shape_check;

ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_plan_shape_check CHECK (
    (
      operation IN (
        'generate-drafts',
        'repair-draft-format',
        'repair-draft-content'
      )
      AND plan_index IS NOT NULL
    )
    OR (
      operation IN (
        'analyze-product',
        'repair-product-chinese',
        'repair-product-profile',
        'repair-product-format'
      )
      AND plan_index IS NULL
    )
  );
