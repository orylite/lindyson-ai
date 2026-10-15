-- 提示词向导：为产品档案的单次结构/中文定向修复增加独立成本操作。
-- 历史 repair-product-chinese 账本继续保留并可读；新链路使用
-- repair-product-profile，且与产品识别一样只归属于 run，不归属于 batch/plan。

ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_operation_check;

ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_operation_check CHECK (
    operation IN (
      'analyze-product',
      'repair-product-chinese',
      'repair-product-profile',
      'generate-drafts'
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
        'repair-product-profile'
      )
      AND batch_id IS NULL
    )
    OR (operation = 'generate-drafts' AND batch_id IS NOT NULL)
  );
