-- 真人授权在供应商提交后撤回时，任务保留供应商终态与成本事实，
-- 但不得建立数字资产或进入可恢复成片流程。

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_processing_stage_check;

ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_processing_stage_check
  CHECK (processing_stage IN (
    'queued', 'prepared', 'submitting', 'submitted', 'submission-unknown',
    'provider-running', 'provider-succeeded', 'archiving',
    'settlement-pending', 'cancel-requested', 'canceled',
    'completed', 'failed', 'delivery-failed', 'manual-review',
    'privacy-withheld'
  ));
