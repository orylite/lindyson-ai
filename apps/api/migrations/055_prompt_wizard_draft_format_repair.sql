-- 提示词向导：为单个方案的 JSON 格式修复增加独立成本操作。
-- 修复请求归属于原批次和具体方案；operation 独立于 generate-drafts，
-- 从而在相同作业、轮次与传输尝试下仍拥有不同的幂等账本键。

ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_operation_check;

ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_operation_check CHECK (
    operation IN (
      'analyze-product',
      'repair-product-chinese',
      'repair-product-profile',
      'generate-drafts',
      'repair-draft-format'
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
    OR (
      operation IN ('generate-drafts', 'repair-draft-format')
      AND batch_id IS NOT NULL
    )
  );

ALTER TABLE prompt_wizard_provider_requests
  DROP CONSTRAINT IF EXISTS prompt_wizard_provider_requests_plan_shape_check;

ALTER TABLE prompt_wizard_provider_requests
  ADD CONSTRAINT prompt_wizard_provider_requests_plan_shape_check CHECK (
    (
      operation IN ('generate-drafts', 'repair-draft-format')
      AND plan_index IS NOT NULL
    )
    OR (
      operation IN (
        'analyze-product',
        'repair-product-chinese',
        'repair-product-profile'
      )
      AND plan_index IS NULL
    )
  );
