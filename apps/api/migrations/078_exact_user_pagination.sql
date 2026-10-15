-- 077 已用于素材文件夹删除模式；精准分页从下一顺序迁移开始。
CREATE TABLE IF NOT EXISTS user_pagination_versions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource text NOT NULL CHECK (char_length(resource) BETWEEN 1 AND 160),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, resource)
);

COMMENT ON TABLE user_pagination_versions IS
  '用户端精准分页资源版本；业务写入通过语句级触发器在同一事务递增。';

CREATE OR REPLACE FUNCTION pagination_bump_assets_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  SELECT DISTINCT user_id, 'assets', 1, now()
  FROM pagination_new_rows
  WHERE user_id IS NOT NULL
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pagination_bump_assets_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  SELECT DISTINCT user_id, 'assets', 1, now()
  FROM pagination_old_rows
  WHERE user_id IS NOT NULL
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pagination_bump_assets_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  WITH changed AS (
    SELECT old_row.user_id AS old_user_id, new_row.user_id AS new_user_id
    FROM pagination_old_rows old_row
    FULL JOIN pagination_new_rows new_row ON new_row.id = old_row.id
    WHERE ROW(
      old_row.id, old_row.user_id, old_row.folder_id, old_row.name, old_row.type,
      old_row.source, old_row.deletion_status, old_row.created_at
    ) IS DISTINCT FROM ROW(
      new_row.id, new_row.user_id, new_row.folder_id, new_row.name, new_row.type,
      new_row.source, new_row.deletion_status, new_row.created_at
    )
  ), affected AS (
    SELECT old_user_id AS user_id FROM changed WHERE old_user_id IS NOT NULL
    UNION
    SELECT new_user_id AS user_id FROM changed WHERE new_user_id IS NOT NULL
  )
  SELECT user_id, 'assets', 1, now() FROM affected
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pagination_assets_insert ON assets;
CREATE TRIGGER pagination_assets_insert
AFTER INSERT ON assets
REFERENCING NEW TABLE AS pagination_new_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_assets_insert();

DROP TRIGGER IF EXISTS pagination_assets_delete ON assets;
CREATE TRIGGER pagination_assets_delete
AFTER DELETE ON assets
REFERENCING OLD TABLE AS pagination_old_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_assets_delete();

DROP TRIGGER IF EXISTS pagination_assets_update ON assets;
CREATE TRIGGER pagination_assets_update
AFTER UPDATE ON assets
REFERENCING OLD TABLE AS pagination_old_rows NEW TABLE AS pagination_new_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_assets_update();

CREATE OR REPLACE FUNCTION pagination_bump_generation_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  SELECT DISTINCT row.user_id, resource.name, 1, now()
  FROM pagination_new_rows row
  CROSS JOIN LATERAL (VALUES
    ('generation:all'),
    ('generation:' || row.kind || ':all'),
    ('generation:status:' || row.status),
    ('generation:' || row.kind || ':status:' || row.status)
  ) AS resource(name)
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pagination_bump_generation_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  SELECT DISTINCT row.user_id, resource.name, 1, now()
  FROM pagination_old_rows row
  CROSS JOIN LATERAL (VALUES
    ('generation:all'),
    ('generation:' || row.kind || ':all'),
    ('generation:status:' || row.status),
    ('generation:' || row.kind || ':status:' || row.status)
  ) AS resource(name)
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pagination_bump_generation_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  WITH compared AS (
    SELECT
      old_row.user_id AS old_user_id,
      old_row.kind AS old_kind,
      old_row.status AS old_status,
      new_row.user_id AS new_user_id,
      new_row.kind AS new_kind,
      new_row.status AS new_status,
      ROW(old_row.id, old_row.user_id, old_row.kind, old_row.created_at)
        IS DISTINCT FROM ROW(new_row.id, new_row.user_id, new_row.kind, new_row.created_at)
        AS membership_changed,
      ROW(old_row.id, old_row.user_id, old_row.kind, old_row.status, old_row.created_at)
        IS DISTINCT FROM ROW(new_row.id, new_row.user_id, new_row.kind, new_row.status, new_row.created_at)
        AS status_membership_changed
    FROM pagination_old_rows old_row
    FULL JOIN pagination_new_rows new_row ON new_row.id = old_row.id
  ), resources AS (
    SELECT old_user_id AS user_id, resource.name
    FROM compared
    CROSS JOIN LATERAL (VALUES
      ('generation:all'),
      ('generation:' || old_kind || ':all')
    ) AS resource(name)
    WHERE membership_changed AND old_user_id IS NOT NULL
    UNION
    SELECT new_user_id AS user_id, resource.name
    FROM compared
    CROSS JOIN LATERAL (VALUES
      ('generation:all'),
      ('generation:' || new_kind || ':all')
    ) AS resource(name)
    WHERE membership_changed AND new_user_id IS NOT NULL
    UNION
    SELECT old_user_id AS user_id, resource.name
    FROM compared
    CROSS JOIN LATERAL (VALUES
      ('generation:status:' || old_status),
      ('generation:' || old_kind || ':status:' || old_status)
    ) AS resource(name)
    WHERE status_membership_changed AND old_user_id IS NOT NULL
    UNION
    SELECT new_user_id AS user_id, resource.name
    FROM compared
    CROSS JOIN LATERAL (VALUES
      ('generation:status:' || new_status),
      ('generation:' || new_kind || ':status:' || new_status)
    ) AS resource(name)
    WHERE status_membership_changed AND new_user_id IS NOT NULL
  )
  SELECT DISTINCT user_id, name, 1, now() FROM resources
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pagination_generation_insert ON generation_tasks;
CREATE TRIGGER pagination_generation_insert
AFTER INSERT ON generation_tasks
REFERENCING NEW TABLE AS pagination_new_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_generation_insert();

DROP TRIGGER IF EXISTS pagination_generation_delete ON generation_tasks;
CREATE TRIGGER pagination_generation_delete
AFTER DELETE ON generation_tasks
REFERENCING OLD TABLE AS pagination_old_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_generation_delete();

DROP TRIGGER IF EXISTS pagination_generation_update ON generation_tasks;
CREATE TRIGGER pagination_generation_update
AFTER UPDATE ON generation_tasks
REFERENCING OLD TABLE AS pagination_old_rows NEW TABLE AS pagination_new_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_generation_update();

CREATE OR REPLACE FUNCTION pagination_bump_credit_ledger_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  SELECT DISTINCT row.user_id, resource.name, 1, now()
  FROM pagination_new_rows row
  CROSS JOIN LATERAL (VALUES
    ('credit-ledger:all'),
    ('credit-ledger:type:' || row.type)
  ) AS resource(name)
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pagination_bump_credit_ledger_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  SELECT DISTINCT row.user_id, resource.name, 1, now()
  FROM pagination_old_rows row
  CROSS JOIN LATERAL (VALUES
    ('credit-ledger:all'),
    ('credit-ledger:type:' || row.type)
  ) AS resource(name)
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pagination_bump_credit_ledger_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  WITH compared AS (
    SELECT old_row.user_id AS old_user_id, old_row.type AS old_type,
           new_row.user_id AS new_user_id, new_row.type AS new_type
    FROM pagination_old_rows old_row
    FULL JOIN pagination_new_rows new_row ON new_row.id = old_row.id
    WHERE ROW(old_row.id, old_row.user_id, old_row.type, old_row.created_at)
      IS DISTINCT FROM ROW(new_row.id, new_row.user_id, new_row.type, new_row.created_at)
  ), resources AS (
    SELECT old_user_id AS user_id, resource.name
    FROM compared
    CROSS JOIN LATERAL (VALUES
      ('credit-ledger:all'),
      ('credit-ledger:type:' || old_type)
    ) AS resource(name)
    WHERE old_user_id IS NOT NULL
    UNION
    SELECT new_user_id AS user_id, resource.name
    FROM compared
    CROSS JOIN LATERAL (VALUES
      ('credit-ledger:all'),
      ('credit-ledger:type:' || new_type)
    ) AS resource(name)
    WHERE new_user_id IS NOT NULL
  )
  SELECT DISTINCT user_id, name, 1, now() FROM resources
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pagination_credit_ledger_insert ON credit_ledger;
CREATE TRIGGER pagination_credit_ledger_insert
AFTER INSERT ON credit_ledger
REFERENCING NEW TABLE AS pagination_new_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_credit_ledger_insert();

DROP TRIGGER IF EXISTS pagination_credit_ledger_delete ON credit_ledger;
CREATE TRIGGER pagination_credit_ledger_delete
AFTER DELETE ON credit_ledger
REFERENCING OLD TABLE AS pagination_old_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_credit_ledger_delete();

DROP TRIGGER IF EXISTS pagination_credit_ledger_update ON credit_ledger;
CREATE TRIGGER pagination_credit_ledger_update
AFTER UPDATE ON credit_ledger
REFERENCING OLD TABLE AS pagination_old_rows NEW TABLE AS pagination_new_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_credit_ledger_update();

CREATE OR REPLACE FUNCTION pagination_bump_orders_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  SELECT DISTINCT row.user_id, resource.name, 1, now()
  FROM pagination_new_rows row
  CROSS JOIN LATERAL (VALUES
    ('orders:all'),
    ('orders:status:' || row.status),
    ('orders:invoiceable')
  ) AS resource(name)
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pagination_bump_orders_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  SELECT DISTINCT row.user_id, resource.name, 1, now()
  FROM pagination_old_rows row
  CROSS JOIN LATERAL (VALUES
    ('orders:all'),
    ('orders:status:' || row.status),
    ('orders:invoiceable')
  ) AS resource(name)
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pagination_bump_orders_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  WITH compared AS (
    SELECT
      old_row.user_id AS old_user_id, old_row.status AS old_status,
      new_row.user_id AS new_user_id, new_row.status AS new_status,
      ROW(old_row.id, old_row.user_id, old_row.status, old_row.created_at)
        IS DISTINCT FROM ROW(new_row.id, new_row.user_id, new_row.status, new_row.created_at)
        AS membership_changed,
      ROW(old_row.id, old_row.user_id, old_row.status, old_row.created_at)
        IS DISTINCT FROM ROW(new_row.id, new_row.user_id, new_row.status, new_row.created_at)
        AS status_membership_changed,
      ROW(old_row.id, old_row.user_id, old_row.status, old_row.invoice_status, old_row.created_at)
        IS DISTINCT FROM ROW(new_row.id, new_row.user_id, new_row.status, new_row.invoice_status, new_row.created_at)
        AS invoiceable_membership_changed
    FROM pagination_old_rows old_row
    FULL JOIN pagination_new_rows new_row ON new_row.id = old_row.id
  ), resources AS (
    SELECT old_user_id AS user_id, 'orders:all' AS name FROM compared
    WHERE membership_changed AND old_user_id IS NOT NULL
    UNION
    SELECT new_user_id, 'orders:all' FROM compared
    WHERE membership_changed AND new_user_id IS NOT NULL
    UNION
    SELECT old_user_id, 'orders:status:' || old_status FROM compared
    WHERE status_membership_changed AND old_user_id IS NOT NULL
    UNION
    SELECT new_user_id, 'orders:status:' || new_status FROM compared
    WHERE status_membership_changed AND new_user_id IS NOT NULL
    UNION
    SELECT old_user_id, 'orders:invoiceable' FROM compared
    WHERE invoiceable_membership_changed AND old_user_id IS NOT NULL
    UNION
    SELECT new_user_id, 'orders:invoiceable' FROM compared
    WHERE invoiceable_membership_changed AND new_user_id IS NOT NULL
  )
  SELECT DISTINCT user_id, name, 1, now() FROM resources
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pagination_orders_insert ON orders;
CREATE TRIGGER pagination_orders_insert
AFTER INSERT ON orders
REFERENCING NEW TABLE AS pagination_new_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_orders_insert();

DROP TRIGGER IF EXISTS pagination_orders_delete ON orders;
CREATE TRIGGER pagination_orders_delete
AFTER DELETE ON orders
REFERENCING OLD TABLE AS pagination_old_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_orders_delete();

DROP TRIGGER IF EXISTS pagination_orders_update ON orders;
CREATE TRIGGER pagination_orders_update
AFTER UPDATE ON orders
REFERENCING OLD TABLE AS pagination_old_rows NEW TABLE AS pagination_new_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_orders_update();

CREATE OR REPLACE FUNCTION pagination_bump_invoice_requests_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  SELECT DISTINCT user_id, 'orders:invoiceable', 1, now()
  FROM pagination_new_rows
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pagination_bump_invoice_requests_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  SELECT DISTINCT user_id, 'orders:invoiceable', 1, now()
  FROM pagination_old_rows
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pagination_bump_invoice_requests_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  WITH affected AS (
    SELECT user_id FROM pagination_old_rows
    UNION
    SELECT user_id FROM pagination_new_rows
  )
  SELECT DISTINCT user_id, 'orders:invoiceable', 1, now() FROM affected
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pagination_invoice_requests_insert ON invoice_requests;
CREATE TRIGGER pagination_invoice_requests_insert
AFTER INSERT ON invoice_requests
REFERENCING NEW TABLE AS pagination_new_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_invoice_requests_insert();

DROP TRIGGER IF EXISTS pagination_invoice_requests_delete ON invoice_requests;
CREATE TRIGGER pagination_invoice_requests_delete
AFTER DELETE ON invoice_requests
REFERENCING OLD TABLE AS pagination_old_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_invoice_requests_delete();

DROP TRIGGER IF EXISTS pagination_invoice_requests_update ON invoice_requests;
CREATE TRIGGER pagination_invoice_requests_update
AFTER UPDATE ON invoice_requests
REFERENCING OLD TABLE AS pagination_old_rows NEW TABLE AS pagination_new_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_invoice_requests_update();

CREATE OR REPLACE FUNCTION pagination_bump_tickets_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  SELECT DISTINCT user_id, 'tickets', 1, now()
  FROM pagination_new_rows
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pagination_bump_tickets_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  SELECT DISTINCT user_id, 'tickets', 1, now()
  FROM pagination_old_rows
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pagination_bump_tickets_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_pagination_versions (user_id, resource, version, updated_at)
  WITH changed AS (
    SELECT old_row.user_id AS old_user_id, new_row.user_id AS new_user_id
    FROM pagination_old_rows old_row
    FULL JOIN pagination_new_rows new_row ON new_row.id = old_row.id
    WHERE ROW(
      old_row.id, old_row.user_id, old_row.status, old_row.priority,
      old_row.title, old_row.last_message, old_row.updated_at
    ) IS DISTINCT FROM ROW(
      new_row.id, new_row.user_id, new_row.status, new_row.priority,
      new_row.title, new_row.last_message, new_row.updated_at
    )
  ), affected AS (
    SELECT old_user_id AS user_id FROM changed WHERE old_user_id IS NOT NULL
    UNION
    SELECT new_user_id AS user_id FROM changed WHERE new_user_id IS NOT NULL
  )
  SELECT user_id, 'tickets', 1, now() FROM affected
  ON CONFLICT (user_id, resource) DO UPDATE
  SET version = user_pagination_versions.version + 1,
      updated_at = now();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pagination_tickets_insert ON tickets;
CREATE TRIGGER pagination_tickets_insert
AFTER INSERT ON tickets
REFERENCING NEW TABLE AS pagination_new_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_tickets_insert();

DROP TRIGGER IF EXISTS pagination_tickets_delete ON tickets;
CREATE TRIGGER pagination_tickets_delete
AFTER DELETE ON tickets
REFERENCING OLD TABLE AS pagination_old_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_tickets_delete();

DROP TRIGGER IF EXISTS pagination_tickets_update ON tickets;
CREATE TRIGGER pagination_tickets_update
AFTER UPDATE ON tickets
REFERENCING OLD TABLE AS pagination_old_rows NEW TABLE AS pagination_new_rows
FOR EACH STATEMENT EXECUTE FUNCTION pagination_bump_tickets_update();
