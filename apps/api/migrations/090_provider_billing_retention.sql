-- 账单同步数据保留与查询统计。
--
-- 1. pg_stat_statements：配合 docker-compose.hk.yml 的 shared_preload_libraries 使用。
--    CREATE EXTENSION 不要求预加载，但视图只有在预加载并重启 PostgreSQL 后才有数据。
--    非超级用户无法创建该扩展；本地或测试库用非超级用户时只告警，不阻断后续迁移。
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING 'pg_stat_statements 扩展需要超级用户创建，本次跳过：%', SQLERRM;
END
$$;

-- 2. worker 每日保留清理会按年龄分批删除 run_items、资源包快照与同步运行记录。
--    删除 sync_runs 时 PostgreSQL 要逐行检查以下外键，补上被引用列的索引，避免每行顺序扫描。
CREATE INDEX IF NOT EXISTS idx_provider_bill_detail_revisions_sync_run
  ON provider_bill_detail_revisions(sync_run_id);

CREATE INDEX IF NOT EXISTS idx_provider_bill_details_last_seen_run
  ON provider_bill_details(last_seen_run_id)
  WHERE last_seen_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_resource_package_cost_events_source_snapshot
  ON provider_resource_package_cost_events(source_snapshot_id)
  WHERE source_snapshot_id IS NOT NULL;

-- 快照清理按 captured_at 从旧到新分批扫描。
CREATE INDEX IF NOT EXISTS idx_provider_resource_package_snapshots_captured_at
  ON provider_resource_package_snapshots(captured_at, id);
