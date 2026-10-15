-- 079 / 080 的 AFTER STATEMENT 触发器即使影响 0 行也会执行。
-- 在同一事务内，先由配对的 BEFORE STATEMENT 触发器记录目标表事务级 tuple 计数，
-- 再由原 AFTER 函数比较本语句前后的差值；资源绑定、列过滤和语句级一次递增保持不变。

CREATE OR REPLACE FUNCTION admin_pagination_capture_statement_counters()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  counter_namespace text := TG_ARGV[0];
  setting_prefix text;
BEGIN
  IF counter_namespace NOT IN ('admin_pagination', 'admin_cost_pagination') THEN
    RAISE EXCEPTION '未知的后台分页计数命名空间：%', counter_namespace;
  END IF;

  setting_prefix := format(
    'lindyson.%s_r%s_',
    counter_namespace,
    TG_RELID::text
  );
  PERFORM set_config(
    setting_prefix || 'inserted',
    pg_stat_get_xact_tuples_inserted(TG_RELID)::text,
    true
  );
  PERFORM set_config(
    setting_prefix || 'updated',
    pg_stat_get_xact_tuples_updated(TG_RELID)::text,
    true
  );
  PERFORM set_config(
    setting_prefix || 'deleted',
    pg_stat_get_xact_tuples_deleted(TG_RELID)::text,
    true
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION admin_pagination_statement_changed(
  counter_namespace text,
  relation_id oid
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  setting_prefix text;
  inserted_before bigint;
  updated_before bigint;
  deleted_before bigint;
  inserted_after bigint;
  updated_after bigint;
  deleted_after bigint;
BEGIN
  IF counter_namespace NOT IN ('admin_pagination', 'admin_cost_pagination') THEN
    RAISE EXCEPTION '未知的后台分页计数命名空间：%', counter_namespace;
  END IF;

  setting_prefix := format(
    'lindyson.%s_r%s_',
    counter_namespace,
    relation_id::text
  );
  inserted_after := pg_stat_get_xact_tuples_inserted(relation_id);
  updated_after := pg_stat_get_xact_tuples_updated(relation_id);
  deleted_after := pg_stat_get_xact_tuples_deleted(relation_id);
  inserted_before := coalesce(
    nullif(current_setting(setting_prefix || 'inserted', true), '')::bigint,
    0
  );
  updated_before := coalesce(
    nullif(current_setting(setting_prefix || 'updated', true), '')::bigint,
    0
  );
  deleted_before := coalesce(
    nullif(current_setting(setting_prefix || 'deleted', true), '')::bigint,
    0
  );

  -- 立即推进本命名空间、目标表的事务内基线，避免同一 SQL 的多个事件触发器重复递增。
  PERFORM set_config(setting_prefix || 'inserted', inserted_after::text, true);
  PERFORM set_config(setting_prefix || 'updated', updated_after::text, true);
  PERFORM set_config(setting_prefix || 'deleted', deleted_after::text, true);

  RETURN inserted_after > inserted_before
    OR updated_after > updated_before
    OR deleted_after > deleted_before;
END;
$$;

CREATE OR REPLACE FUNCTION admin_pagination_bump_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  resource_name text;
BEGIN
  IF NOT admin_pagination_statement_changed('admin_pagination', TG_RELID) THEN
    RETURN NULL;
  END IF;

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

CREATE OR REPLACE FUNCTION bump_admin_cost_pagination_versions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pagination_resource text;
BEGIN
  IF NOT admin_pagination_statement_changed('admin_cost_pagination', TG_RELID) THEN
    RETURN NULL;
  END IF;

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

-- 根据 079 / 080 已安装的 AFTER 触发器复制事件和 UPDATE OF 列范围。
-- BEFORE 与 AFTER 使用不同命名空间；资源参数仍只保留在原 AFTER 触发器上。
DO $$
DECLARE
  installed_trigger record;
  stale_trigger record;
  counter_namespace text;
  tracker_name text;
  event_parts text[];
  update_columns text;
BEGIN
  FOR stale_trigger IN
    SELECT trigger_row.tgname, trigger_row.tgrelid
    FROM pg_trigger trigger_row
    WHERE NOT trigger_row.tgisinternal
      AND trigger_row.tgfoid = 'admin_pagination_capture_statement_counters()'::regprocedure
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %s',
      stale_trigger.tgname,
      stale_trigger.tgrelid::regclass
    );
  END LOOP;

  FOR installed_trigger IN
    SELECT
      trigger_row.tgname,
      trigger_row.tgrelid,
      trigger_row.tgfoid,
      trigger_row.tgtype,
      trigger_row.tgattr
    FROM pg_trigger trigger_row
    WHERE NOT trigger_row.tgisinternal
      AND (trigger_row.tgtype::integer & 1) = 0
      AND (trigger_row.tgtype::integer & 2) = 0
      AND trigger_row.tgfoid IN (
        'admin_pagination_bump_trigger()'::regprocedure,
        'bump_admin_cost_pagination_versions()'::regprocedure
      )
    ORDER BY trigger_row.tgrelid, trigger_row.tgname
  LOOP
    counter_namespace := CASE installed_trigger.tgfoid
      WHEN 'admin_pagination_bump_trigger()'::regprocedure
        THEN 'admin_pagination'
      ELSE 'admin_cost_pagination'
    END;
    tracker_name := 'admin_pagination_before_' || substr(md5(
      installed_trigger.tgrelid::text || ':' ||
      installed_trigger.tgname || ':' || counter_namespace
    ), 1, 32);
    event_parts := ARRAY[]::text[];

    IF (installed_trigger.tgtype::integer & 4) <> 0 THEN
      event_parts := array_append(event_parts, 'INSERT');
    END IF;
    IF (installed_trigger.tgtype::integer & 16) <> 0 THEN
      SELECT string_agg(quote_ident(attribute_row.attname), ', ' ORDER BY selected_column.ordinality)
      INTO update_columns
      FROM unnest(installed_trigger.tgattr::smallint[]) WITH ORDINALITY
        AS selected_column(attnum, ordinality)
      JOIN pg_attribute attribute_row
        ON attribute_row.attrelid = installed_trigger.tgrelid
       AND attribute_row.attnum = selected_column.attnum;
      event_parts := array_append(
        event_parts,
        'UPDATE' || CASE
          WHEN update_columns IS NULL THEN ''
          ELSE ' OF ' || update_columns
        END
      );
    END IF;
    IF (installed_trigger.tgtype::integer & 8) <> 0 THEN
      event_parts := array_append(event_parts, 'DELETE');
    END IF;

    IF cardinality(event_parts) = 0 THEN
      RAISE EXCEPTION '后台分页 AFTER 触发器没有可复制的 DML 事件：%', installed_trigger.tgname;
    END IF;

    EXECUTE format(
      'CREATE TRIGGER %I BEFORE %s ON %s FOR EACH STATEMENT EXECUTE FUNCTION admin_pagination_capture_statement_counters(%L)',
      tracker_name,
      array_to_string(event_parts, ' OR '),
      installed_trigger.tgrelid::regclass,
      counter_namespace
    );
  END LOOP;
END;
$$;
