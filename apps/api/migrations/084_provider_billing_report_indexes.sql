-- 成本报表会按 official_sync_run_id 判断同步证据，并读取该同步批次的最新对账状态。
-- 历史账单批次持续增长后，不能再为每次看盘查询顺序扫描全部对账运行记录。
CREATE INDEX IF NOT EXISTS idx_provider_reconciliation_runs_official_latest
  ON provider_reconciliation_runs(official_sync_run_id, created_at DESC, id DESC)
  INCLUDE (bill_state)
  WHERE official_sync_run_id IS NOT NULL;
