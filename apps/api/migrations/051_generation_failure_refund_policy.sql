-- 新生成规则：用户未获得可用成片时，终态失败只能以积分已退回收口。
-- 历史任务可能存在“失败但已结算/仍冻结”的旧口径，因此约束使用 NOT VALID：
-- 不扫描、不改写历史账务，但会拒绝之后写入或更新出新的违规失败状态。

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_failed_refund_policy_check;

ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_failed_refund_policy_check
  CHECK (
    status <> 'failed'
    OR (
      credit_status = 'refunded'
      AND settled_credits = 0
    )
  ) NOT VALID;

COMMENT ON CONSTRAINT generation_tasks_failed_refund_policy_check ON generation_tasks IS
  '新终态失败必须解除预扣且不得结算用户积分；历史旧口径保留只读兼容。';
