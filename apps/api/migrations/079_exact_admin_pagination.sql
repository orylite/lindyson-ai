CREATE TABLE IF NOT EXISTS admin_pagination_versions (
  resource text PRIMARY KEY CHECK (char_length(resource) BETWEEN 1 AND 160),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE admin_pagination_versions IS
  '管理后台跨用户精准分页的全局资源版本；业务写入通过语句级触发器递增。';

CREATE OR REPLACE FUNCTION admin_pagination_bump_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  resource_name text;
BEGIN
  FOREACH resource_name IN ARRAY TG_ARGV LOOP
    INSERT INTO admin_pagination_versions (resource, version, updated_at)
    VALUES (resource_name, 1, now())
    ON CONFLICT (resource) DO UPDATE
    SET version = admin_pagination_versions.version + 1,
        updated_at = now();
  END LOOP;
  RETURN NULL;
END;
$$;

-- 用户姓名和邮箱参与多个后台列表的模糊搜索，身份变更需使所有相关快照失效。
DROP TRIGGER IF EXISTS admin_pagination_users_insert ON users;
CREATE TRIGGER admin_pagination_users_insert
AFTER INSERT ON users
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-users');

DROP TRIGGER IF EXISTS admin_pagination_users_delete ON users;
CREATE TRIGGER admin_pagination_users_delete
AFTER DELETE ON users
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-users');

CREATE OR REPLACE FUNCTION admin_pagination_bump_users_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO admin_pagination_versions (resource, version, updated_at)
  WITH changes AS (
    SELECT
      coalesce(bool_or(ROW(
        old_row.id, old_row.email, old_row.user_name
      ) IS DISTINCT FROM ROW(
        new_row.id, new_row.email, new_row.user_name
      )), false) AS identity_changed,
      coalesce(bool_or(ROW(
        old_row.id, old_row.email, old_row.user_name, old_row.role,
        old_row.status, old_row.plan_id, old_row.registered_at
      ) IS DISTINCT FROM ROW(
        new_row.id, new_row.email, new_row.user_name, new_row.role,
        new_row.status, new_row.plan_id, new_row.registered_at
      )), false) AS user_list_changed
    FROM admin_pagination_old_rows old_row
    FULL JOIN admin_pagination_new_rows new_row ON new_row.id = old_row.id
  ), resources AS (
    SELECT 'admin-users'::text AS resource
    FROM changes WHERE user_list_changed
    UNION
    SELECT dependent.resource
    FROM changes
    CROSS JOIN LATERAL unnest(ARRAY[
      'admin-orders', 'admin-invoices', 'admin-tickets',
      'admin-jobs', 'admin-credit-ledger'
    ]::text[]) AS dependent(resource)
    WHERE identity_changed
  )
  SELECT resource, 1, now() FROM resources
  ON CONFLICT (resource) DO UPDATE
  SET version = admin_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS admin_pagination_users_identity_update ON users;
DROP TRIGGER IF EXISTS admin_pagination_users_list_update ON users;
DROP TRIGGER IF EXISTS admin_pagination_users_update ON users;
CREATE TRIGGER admin_pagination_users_update
AFTER UPDATE ON users
REFERENCING OLD TABLE AS admin_pagination_old_rows NEW TABLE AS admin_pagination_new_rows
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_users_update();

-- 用户列表搜索和展示依赖套餐名称与代码。
DROP TRIGGER IF EXISTS admin_pagination_plans_user_list_update ON plans;
CREATE TRIGGER admin_pagination_plans_user_list_update
AFTER UPDATE OF id, name, code ON plans
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-users');

DROP TRIGGER IF EXISTS admin_pagination_orders_insert ON orders;
CREATE TRIGGER admin_pagination_orders_insert
AFTER INSERT ON orders
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-orders');

DROP TRIGGER IF EXISTS admin_pagination_orders_delete ON orders;
CREATE TRIGGER admin_pagination_orders_delete
AFTER DELETE ON orders
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-orders');

DROP TRIGGER IF EXISTS admin_pagination_orders_update ON orders;
CREATE TRIGGER admin_pagination_orders_update
AFTER UPDATE OF id, user_id, status, plan_name, merchant_order_no,
  provider_order_id, provider_trade_id, created_at ON orders
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-orders');

-- 发票申请同时决定订单列表中的开票申请状态。
DROP TRIGGER IF EXISTS admin_pagination_invoice_requests_insert ON invoice_requests;
CREATE TRIGGER admin_pagination_invoice_requests_insert
AFTER INSERT ON invoice_requests
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-invoices', 'admin-orders');

DROP TRIGGER IF EXISTS admin_pagination_invoice_requests_delete ON invoice_requests;
CREATE TRIGGER admin_pagination_invoice_requests_delete
AFTER DELETE ON invoice_requests
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-invoices', 'admin-orders');

DROP TRIGGER IF EXISTS admin_pagination_invoice_requests_update ON invoice_requests;
CREATE TRIGGER admin_pagination_invoice_requests_update
AFTER UPDATE OF id, user_id, order_id, status, invoice_title, tax_id, requested_at ON invoice_requests
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-invoices', 'admin-orders');

DROP TRIGGER IF EXISTS admin_pagination_tickets_insert ON tickets;
CREATE TRIGGER admin_pagination_tickets_insert
AFTER INSERT ON tickets
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-tickets');

DROP TRIGGER IF EXISTS admin_pagination_tickets_delete ON tickets;
CREATE TRIGGER admin_pagination_tickets_delete
AFTER DELETE ON tickets
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-tickets');

DROP TRIGGER IF EXISTS admin_pagination_tickets_update ON tickets;
CREATE TRIGGER admin_pagination_tickets_update
AFTER UPDATE OF id, user_id, title, priority, status, updated_at ON tickets
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-tickets');

DROP TRIGGER IF EXISTS admin_pagination_generation_tasks_insert ON generation_tasks;
CREATE TRIGGER admin_pagination_generation_tasks_insert
AFTER INSERT ON generation_tasks
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-jobs');

DROP TRIGGER IF EXISTS admin_pagination_generation_tasks_delete ON generation_tasks;
CREATE TRIGGER admin_pagination_generation_tasks_delete
AFTER DELETE ON generation_tasks
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-jobs');

DROP TRIGGER IF EXISTS admin_pagination_generation_tasks_update ON generation_tasks;
CREATE TRIGGER admin_pagination_generation_tasks_update
AFTER UPDATE OF id, user_id, status, model, prompt, created_at ON generation_tasks
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-jobs');

DROP TRIGGER IF EXISTS admin_pagination_credit_ledger_insert ON credit_ledger;
CREATE TRIGGER admin_pagination_credit_ledger_insert
AFTER INSERT ON credit_ledger
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-credit-ledger');

DROP TRIGGER IF EXISTS admin_pagination_credit_ledger_delete ON credit_ledger;
CREATE TRIGGER admin_pagination_credit_ledger_delete
AFTER DELETE ON credit_ledger
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-credit-ledger');

DROP TRIGGER IF EXISTS admin_pagination_credit_ledger_update ON credit_ledger;
CREATE TRIGGER admin_pagination_credit_ledger_update
AFTER UPDATE OF id, user_id, type, source, note, related_order_id,
  related_job_id, related_asset_id, created_at ON credit_ledger
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-credit-ledger');

DROP TRIGGER IF EXISTS admin_pagination_audit_logs_insert ON audit_logs;
CREATE TRIGGER admin_pagination_audit_logs_insert
AFTER INSERT ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-audit-logs');

DROP TRIGGER IF EXISTS admin_pagination_audit_logs_delete ON audit_logs;
CREATE TRIGGER admin_pagination_audit_logs_delete
AFTER DELETE ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-audit-logs');

DROP TRIGGER IF EXISTS admin_pagination_audit_logs_update ON audit_logs;
CREATE TRIGGER admin_pagination_audit_logs_update
AFTER UPDATE OF id, admin_email, module, action, target, risk, detail, created_at ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-audit-logs');

DROP TRIGGER IF EXISTS admin_pagination_announcements_insert ON announcements;
CREATE TRIGGER admin_pagination_announcements_insert
AFTER INSERT ON announcements
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-announcements-v1-published-desc');

DROP TRIGGER IF EXISTS admin_pagination_announcements_delete ON announcements;
CREATE TRIGGER admin_pagination_announcements_delete
AFTER DELETE ON announcements
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-announcements-v1-published-desc');

DROP TRIGGER IF EXISTS admin_pagination_announcements_update ON announcements;
CREATE TRIGGER admin_pagination_announcements_update
AFTER UPDATE OF id, title, content, pinned, published_at ON announcements
FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_bump_trigger('admin-announcements-v1-published-desc');
