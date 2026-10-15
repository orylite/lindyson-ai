-- 成本中心跨多张账本聚合，使用报表族级单调版本使精准页码在原地更新后失效。
CREATE TABLE IF NOT EXISTS admin_cost_pagination_versions (
  resource text PRIMARY KEY,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO admin_cost_pagination_versions (resource)
VALUES
  ('admin:cost-video'),
  ('admin:cost-image'),
  ('admin:cost-multimodal'),
  ('admin:provider-billing')
ON CONFLICT (resource) DO NOTHING;

CREATE OR REPLACE FUNCTION bump_admin_cost_pagination_versions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pagination_resource text;
BEGIN
  FOREACH pagination_resource IN ARRAY TG_ARGV LOOP
    INSERT INTO admin_cost_pagination_versions (resource, version, updated_at)
    VALUES (pagination_resource, 1, clock_timestamp())
    ON CONFLICT (resource) DO UPDATE
      SET version = admin_cost_pagination_versions.version + 1,
          updated_at = EXCLUDED.updated_at;
  END LOOP;
  RETURN NULL;
END;
$$;

-- 语句级触发器保证一次批量 SQL 对每个报表族只递增一次。
CREATE OR REPLACE FUNCTION install_admin_cost_pagination_trigger(
  target_table regclass,
  trigger_name text,
  resources text[]
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  resource_args text;
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', trigger_name, target_table);
  SELECT string_agg(quote_literal(resource), ', ' ORDER BY ordinal)
    INTO resource_args
  FROM unnest(resources) WITH ORDINALITY AS selected(resource, ordinal);
  EXECUTE format(
    'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH STATEMENT EXECUTE FUNCTION bump_admin_cost_pagination_versions(%s)',
    trigger_name,
    target_table,
    resource_args
  );
END;
$$;

SELECT install_admin_cost_pagination_trigger(
  'users', 'users_admin_cost_pagination_version',
  ARRAY['admin:cost-video', 'admin:cost-image', 'admin:cost-multimodal', 'admin:provider-billing']
);
-- 通用安装函数先覆盖 I/U/D；用户更新只需关心报表读取与搜索的展示身份列。
DROP TRIGGER users_admin_cost_pagination_version ON users;
CREATE TRIGGER users_admin_cost_pagination_version_insert_delete
AFTER INSERT OR DELETE ON users
FOR EACH STATEMENT EXECUTE FUNCTION bump_admin_cost_pagination_versions(
  'admin:cost-video', 'admin:cost-image', 'admin:cost-multimodal', 'admin:provider-billing'
);
CREATE TRIGGER users_admin_cost_pagination_version_identity_update
AFTER UPDATE OF user_name, email ON users
FOR EACH STATEMENT EXECUTE FUNCTION bump_admin_cost_pagination_versions(
  'admin:cost-video', 'admin:cost-image', 'admin:cost-multimodal', 'admin:provider-billing'
);
SELECT install_admin_cost_pagination_trigger(
  'generation_tasks', 'generation_tasks_admin_cost_pagination_version',
  ARRAY['admin:cost-video', 'admin:cost-image']
);
DROP TRIGGER generation_tasks_admin_cost_pagination_version ON generation_tasks;
CREATE TRIGGER generation_tasks_admin_cost_pagination_version_insert_delete
AFTER INSERT OR DELETE ON generation_tasks
FOR EACH STATEMENT EXECUTE FUNCTION bump_admin_cost_pagination_versions(
  'admin:cost-video', 'admin:cost-image'
);
CREATE TRIGGER generation_tasks_admin_cost_pagination_version_report_update
AFTER UPDATE OF kind, model, user_id, status, config, credits, reserved_credits,
  settled_credits, refunded_credits, credit_status, provider_task_id,
  provider_task_attempt, created_at, completed_at ON generation_tasks
FOR EACH STATEMENT EXECUTE FUNCTION bump_admin_cost_pagination_versions(
  'admin:cost-video', 'admin:cost-image'
);
SELECT install_admin_cost_pagination_trigger(
  'generation_provider_runs', 'generation_provider_runs_admin_cost_pagination_version',
  ARRAY['admin:cost-image']
);
DROP TRIGGER generation_provider_runs_admin_cost_pagination_version ON generation_provider_runs;
CREATE TRIGGER generation_provider_runs_admin_cost_pagination_version_insert_delete
AFTER INSERT OR DELETE ON generation_provider_runs
FOR EACH STATEMENT EXECUTE FUNCTION bump_admin_cost_pagination_versions('admin:cost-image');
CREATE TRIGGER generation_provider_runs_admin_cost_pagination_version_identity_update
AFTER UPDATE OF task_id, created_at ON generation_provider_runs
FOR EACH STATEMENT EXECUTE FUNCTION bump_admin_cost_pagination_versions('admin:cost-image');
SELECT install_admin_cost_pagination_trigger(
  'provider_usage_records', 'provider_usage_records_admin_cost_pagination_version',
  ARRAY['admin:cost-video', 'admin:provider-billing']
);
SELECT install_admin_cost_pagination_trigger(
  'image_provider_usage_records', 'image_provider_usage_records_admin_cost_pagination_version',
  ARRAY['admin:cost-image']
);
SELECT install_admin_cost_pagination_trigger(
  'prompt_wizard_runs', 'prompt_wizard_runs_admin_cost_pagination_version',
  ARRAY['admin:cost-multimodal']
);
DROP TRIGGER prompt_wizard_runs_admin_cost_pagination_version ON prompt_wizard_runs;
CREATE TRIGGER prompt_wizard_runs_admin_cost_pagination_version_insert_delete
AFTER INSERT OR DELETE ON prompt_wizard_runs
FOR EACH STATEMENT EXECUTE FUNCTION bump_admin_cost_pagination_versions('admin:cost-multimodal');
CREATE TRIGGER prompt_wizard_runs_admin_cost_pagination_version_report_update
AFTER UPDATE OF user_id, status, provider_model, provider_input_tokens,
  provider_output_tokens, failure_reason, created_at, completed_at ON prompt_wizard_runs
FOR EACH STATEMENT EXECUTE FUNCTION bump_admin_cost_pagination_versions('admin:cost-multimodal');
SELECT install_admin_cost_pagination_trigger(
  'prompt_wizard_batches', 'prompt_wizard_batches_admin_cost_pagination_version',
  ARRAY['admin:cost-multimodal']
);
DROP TRIGGER prompt_wizard_batches_admin_cost_pagination_version ON prompt_wizard_batches;
CREATE TRIGGER prompt_wizard_batches_admin_cost_pagination_version_insert_delete
AFTER INSERT OR DELETE ON prompt_wizard_batches
FOR EACH STATEMENT EXECUTE FUNCTION bump_admin_cost_pagination_versions('admin:cost-multimodal');
CREATE TRIGGER prompt_wizard_batches_admin_cost_pagination_version_report_update
AFTER UPDATE OF run_id, user_id, status, is_free, credits, credit_status,
  provider_model, provider_input_tokens, provider_output_tokens, failure_reason,
  created_at, completed_at ON prompt_wizard_batches
FOR EACH STATEMENT EXECUTE FUNCTION bump_admin_cost_pagination_versions('admin:cost-multimodal');
SELECT install_admin_cost_pagination_trigger(
  'prompt_wizard_provider_requests', 'prompt_wizard_requests_admin_cost_pagination_version',
  ARRAY['admin:cost-multimodal']
);
SELECT install_admin_cost_pagination_trigger(
  'prompt_wizard_provider_request_reconciliations',
  'prompt_wizard_reconciliations_admin_cost_pagination_version',
  ARRAY['admin:cost-multimodal']
);
SELECT install_admin_cost_pagination_trigger(
  'prompt_wizard_historical_operation_cost_evidence',
  'prompt_wizard_historical_cost_admin_pagination_version',
  ARRAY['admin:cost-multimodal']
);
SELECT install_admin_cost_pagination_trigger(
  'provider_operational_usage_records', 'provider_operational_usage_admin_cost_pagination_version',
  ARRAY['admin:cost-video', 'admin:cost-image', 'admin:cost-multimodal', 'admin:provider-billing']
);
SELECT install_admin_cost_pagination_trigger(
  'provider_operational_usage_valuations', 'provider_operational_valuations_admin_cost_pagination_version',
  ARRAY['admin:cost-video', 'admin:cost-image', 'admin:cost-multimodal', 'admin:provider-billing']
);
SELECT install_admin_cost_pagination_trigger(
  'provider_billing_sync_runs', 'provider_billing_runs_admin_cost_pagination_version',
  ARRAY['admin:cost-video', 'admin:provider-billing']
);
DROP TRIGGER provider_billing_runs_admin_cost_pagination_version ON provider_billing_sync_runs;
CREATE TRIGGER provider_billing_runs_admin_cost_pagination_version_insert_delete
AFTER INSERT OR DELETE ON provider_billing_sync_runs
FOR EACH STATEMENT EXECUTE FUNCTION bump_admin_cost_pagination_versions(
  'admin:cost-video', 'admin:provider-billing'
);
CREATE TRIGGER provider_billing_runs_admin_cost_pagination_version_report_update
AFTER UPDATE OF provider, kind, status, window_start, window_end, completed_at, is_final
ON provider_billing_sync_runs
FOR EACH STATEMENT EXECUTE FUNCTION bump_admin_cost_pagination_versions(
  'admin:cost-video', 'admin:provider-billing'
);
SELECT install_admin_cost_pagination_trigger(
  'provider_bill_details', 'provider_bill_details_admin_cost_pagination_version',
  ARRAY['admin:cost-video', 'admin:provider-billing']
);
SELECT install_admin_cost_pagination_trigger(
  'provider_bill_detail_revisions', 'provider_bill_revisions_admin_cost_pagination_version',
  ARRAY['admin:cost-video', 'admin:provider-billing']
);
SELECT install_admin_cost_pagination_trigger(
  'provider_bill_sync_run_items', 'provider_bill_items_admin_cost_pagination_version',
  ARRAY['admin:cost-video', 'admin:provider-billing']
);
SELECT install_admin_cost_pagination_trigger(
  'provider_bill_attribution_events', 'provider_bill_attribution_admin_cost_pagination_version',
  ARRAY['admin:provider-billing']
);
SELECT install_admin_cost_pagination_trigger(
  'provider_reconciliation_runs', 'provider_reconciliation_runs_admin_cost_pagination_version',
  ARRAY['admin:cost-video', 'admin:provider-billing']
);
SELECT install_admin_cost_pagination_trigger(
  'provider_reconciliation_buckets', 'provider_reconciliation_buckets_admin_cost_pagination_version',
  ARRAY['admin:cost-video']
);
SELECT install_admin_cost_pagination_trigger(
  'provider_reconciliation_cases', 'provider_reconciliation_cases_admin_cost_pagination_version',
  ARRAY['admin:cost-video', 'admin:provider-billing']
);
SELECT install_admin_cost_pagination_trigger(
  'provider_reconciliation_case_links', 'provider_reconciliation_links_admin_cost_pagination_version',
  ARRAY['admin:cost-video', 'admin:provider-billing']
);
SELECT install_admin_cost_pagination_trigger(
  'provider_resource_package_acquisitions', 'provider_package_acquisitions_admin_cost_pagination_version',
  ARRAY['admin:cost-video', 'admin:provider-billing']
);
SELECT install_admin_cost_pagination_trigger(
  'provider_resource_package_snapshots', 'provider_package_snapshots_admin_cost_pagination_version',
  ARRAY['admin:cost-video']
);
SELECT install_admin_cost_pagination_trigger(
  'provider_resource_package_cost_events', 'provider_package_events_admin_cost_pagination_version',
  ARRAY['admin:cost-video']
);
DROP FUNCTION install_admin_cost_pagination_trigger(regclass, text, text[]);
