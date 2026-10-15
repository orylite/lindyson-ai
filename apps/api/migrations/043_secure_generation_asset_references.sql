-- 生成参考素材只能由任务/资产所属用户的活动资产行重建。
-- 清理范围同时覆盖终态任务 config 与已生成资产 generation_meta；
-- 没有 objectKey 的早期外链记录继续保留，但任何未验证 thumbnailKey 都会移除。

-- 不能在供应商仍可能读取任务配置时改写输入。部署前应先排空带参考素材的任务；
-- 若未排空，整条 migration 失败并回滚，不会把任务静默改成无参考生成。
SET LOCAL lock_timeout = '10s';
LOCK TABLE generation_tasks IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE assets IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM generation_tasks
    WHERE status IN ('queued', 'processing')
      AND (
        jsonb_array_length(
          CASE
            WHEN jsonb_typeof(config->'referenceAssets') = 'array'
              THEN config->'referenceAssets'
            ELSE '[]'::jsonb
          END
        ) > 0
        OR jsonb_array_length(
          CASE
            WHEN jsonb_typeof(config->'referenceImages') = 'array'
              THEN config->'referenceImages'
            ELSE '[]'::jsonb
          END
        ) > 0
      )
  ) THEN
    RAISE EXCEPTION '043 migration requires queued/processing reference tasks to be drained first';
  END IF;
END;
$$;

-- 两次历史 UPDATE 共用同一份活动资产快照，避免迁移期间资产状态变化造成任务与资产口径漂移。
CREATE TEMP TABLE lindyson_active_reference_assets ON COMMIT DROP AS
SELECT id, user_id, name, object_key, thumbnail_key, type, duration_seconds, size_bytes
FROM assets
WHERE deletion_status = 'active';

CREATE UNIQUE INDEX lindyson_active_reference_assets_owner_object_idx
  ON lindyson_active_reference_assets(user_id, object_key);

CREATE OR REPLACE FUNCTION pg_temp.lindyson_clean_generation_reference(
  owner_id uuid,
  reference_value jsonb,
  image_only boolean
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  requested_object_key text;
  reference_asset record;
  cleaned jsonb;
  role_value text;
BEGIN
  IF jsonb_typeof(reference_value) <> 'object' THEN
    RETURN NULL;
  END IF;

  requested_object_key := NULLIF(btrim(reference_value->>'objectKey'), '');

  -- 旧版允许只保存外链；它不再具备对象存储 key，因此不能触发服务端签名。
  IF requested_object_key IS NULL THEN
    cleaned := reference_value - 'objectKey' - 'thumbnailKey';
    IF image_only THEN
      cleaned := jsonb_set(cleaned, '{type}', '"image"'::jsonb, true);
    END IF;
    RETURN cleaned;
  END IF;

  SELECT a.id, a.name, a.type, a.object_key, a.thumbnail_key,
         a.duration_seconds, a.size_bytes
  INTO reference_asset
  FROM pg_temp.lindyson_active_reference_assets a
  WHERE a.user_id = owner_id
    AND a.object_key = requested_object_key
  LIMIT 1;

  -- 跨用户、已删除或损坏引用只保留无访问能力的展示信息。
  IF NOT FOUND THEN
    cleaned := reference_value
      - 'objectKey'
      - 'thumbnailKey'
      - 'publicUrl'
      - 'thumbnailUrl'
      - 'url';
    cleaned := jsonb_set(cleaned, '{thumbnail}', '""'::jsonb, true);
    IF image_only THEN
      cleaned := jsonb_set(cleaned, '{type}', '"image"'::jsonb, true);
    END IF;
    RETURN cleaned;
  END IF;

  -- referenceImages 只能投影真实图片；损坏的跨类型旧记录直接移除。
  IF image_only AND reference_asset.type <> 'image' THEN
    RETURN NULL;
  END IF;

  cleaned := jsonb_build_object(
    'id', reference_asset.id,
    'name', reference_asset.name,
    'thumbnail', '',
    'objectKey', reference_asset.object_key,
    'type', reference_asset.type
  );

  IF reference_asset.thumbnail_key IS NOT NULL THEN
    cleaned := cleaned || jsonb_build_object('thumbnailKey', reference_asset.thumbnail_key);
  END IF;
  IF reference_asset.duration_seconds IS NOT NULL THEN
    cleaned := cleaned || jsonb_build_object('durationSeconds', reference_asset.duration_seconds);
  END IF;
  IF reference_asset.size_bytes IS NOT NULL THEN
    cleaned := cleaned || jsonb_build_object('sizeBytes', reference_asset.size_bytes);
  END IF;

  role_value := reference_value->>'role';
  IF role_value IN ('reference_image', 'reference_video', 'reference_audio', 'first_frame', 'last_frame') THEN
    cleaned := cleaned || jsonb_build_object('role', role_value);
  END IF;

  RETURN cleaned;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.lindyson_clean_generation_reference_array(
  owner_id uuid,
  references_value jsonb,
  image_only boolean
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  item jsonb;
  cleaned_item jsonb;
  cleaned_items jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(references_value) <> 'array' THEN
    RETURN references_value;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(references_value)
  LOOP
    cleaned_item := pg_temp.lindyson_clean_generation_reference(owner_id, item, image_only);
    IF cleaned_item IS NOT NULL THEN
      cleaned_items := cleaned_items || jsonb_build_array(cleaned_item);
    END IF;
  END LOOP;

  RETURN cleaned_items;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.lindyson_clean_generation_reference_container(
  owner_id uuid,
  container_value jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  cleaned jsonb := container_value;
BEGIN
  IF jsonb_typeof(container_value) <> 'object' THEN
    RETURN container_value;
  END IF;

  IF jsonb_typeof(container_value->'referenceAssets') = 'array' THEN
    cleaned := jsonb_set(
      cleaned,
      '{referenceAssets}',
      pg_temp.lindyson_clean_generation_reference_array(
        owner_id,
        container_value->'referenceAssets',
        false
      )
    );
  END IF;

  IF jsonb_typeof(container_value->'referenceImages') = 'array' THEN
    cleaned := jsonb_set(
      cleaned,
      '{referenceImages}',
      pg_temp.lindyson_clean_generation_reference_array(
        owner_id,
        container_value->'referenceImages',
        true
      )
    );
  END IF;

  RETURN cleaned;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.lindyson_clean_generation_meta(
  owner_id uuid,
  generation_value jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  cleaned jsonb := generation_value;
BEGIN
  IF jsonb_typeof(generation_value) <> 'object' THEN
    RETURN generation_value;
  END IF;

  IF jsonb_typeof(generation_value->'config') = 'object' THEN
    cleaned := jsonb_set(
      cleaned,
      '{config}',
      pg_temp.lindyson_clean_generation_reference_container(
        owner_id,
        generation_value->'config'
      )
    );
  END IF;

  RETURN pg_temp.lindyson_clean_generation_reference_container(owner_id, cleaned);
END;
$$;

WITH cleaned_tasks AS (
  SELECT id,
         pg_temp.lindyson_clean_generation_reference_container(user_id, config) AS next_config
  FROM generation_tasks
  WHERE jsonb_typeof(config) = 'object'
    AND (config ? 'referenceAssets' OR config ? 'referenceImages')
)
UPDATE generation_tasks AS task
SET config = cleaned_tasks.next_config
FROM cleaned_tasks
WHERE task.id = cleaned_tasks.id
  AND task.config IS DISTINCT FROM cleaned_tasks.next_config;

WITH cleaned_assets AS (
  SELECT id,
         pg_temp.lindyson_clean_generation_meta(user_id, generation_meta) AS next_generation_meta
  FROM assets
  WHERE jsonb_typeof(generation_meta) = 'object'
    AND (
      generation_meta ? 'referenceAssets'
      OR generation_meta ? 'referenceImages'
      OR (generation_meta->'config') ? 'referenceAssets'
      OR (generation_meta->'config') ? 'referenceImages'
    )
)
UPDATE assets AS asset
SET generation_meta = cleaned_assets.next_generation_meta
FROM cleaned_assets
WHERE asset.id = cleaned_assets.id
  AND asset.generation_meta IS DISTINCT FROM cleaned_assets.next_generation_meta;

-- 后置不变量：任何仍带 objectKey 的引用都必须精确命中所属用户的活动资产，
-- thumbnailKey 必须与快照一致，且持久化 JSON 中不得残留可过期的访问 URL。
DO $$
DECLARE
  invalid_reference_count bigint;
BEGIN
  WITH reference_rows AS (
    SELECT task.user_id AS owner_id, item.value AS reference_value
    FROM generation_tasks task
    CROSS JOIN LATERAL (
      VALUES (task.config->'referenceAssets'), (task.config->'referenceImages')
    ) AS arrays(value)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(arrays.value) = 'array' THEN arrays.value ELSE '[]'::jsonb END
    ) AS item(value)

    UNION ALL

    SELECT asset.user_id AS owner_id, item.value AS reference_value
    FROM assets asset
    CROSS JOIN LATERAL (
      VALUES
        (asset.generation_meta->'referenceAssets'),
        (asset.generation_meta->'referenceImages'),
        (asset.generation_meta->'config'->'referenceAssets'),
        (asset.generation_meta->'config'->'referenceImages')
    ) AS arrays(value)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(arrays.value) = 'array' THEN arrays.value ELSE '[]'::jsonb END
    ) AS item(value)
  )
  SELECT count(*)
  INTO invalid_reference_count
  FROM reference_rows reference
  WHERE jsonb_typeof(reference.reference_value) = 'object'
    AND (
      (
        reference.reference_value ? 'objectKey'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_temp.lindyson_active_reference_assets owned
          WHERE owned.user_id = reference.owner_id
            AND owned.object_key = reference.reference_value->>'objectKey'
            AND COALESCE(owned.thumbnail_key, '') = COALESCE(
              reference.reference_value->>'thumbnailKey',
              ''
            )
        )
      )
      OR (
        reference.reference_value ? 'thumbnailKey'
        AND NOT (reference.reference_value ? 'objectKey')
      )
      OR (
        reference.reference_value ? 'objectKey'
        AND (
          reference.reference_value ? 'publicUrl'
          OR reference.reference_value ? 'thumbnailUrl'
          OR reference.reference_value ? 'url'
        )
      )
    );

  IF invalid_reference_count > 0 THEN
    RAISE EXCEPTION '043 migration left % invalid generation asset references', invalid_reference_count;
  END IF;
END;
$$;

DROP FUNCTION pg_temp.lindyson_clean_generation_meta(uuid, jsonb);
DROP FUNCTION pg_temp.lindyson_clean_generation_reference_container(uuid, jsonb);
DROP FUNCTION pg_temp.lindyson_clean_generation_reference_array(uuid, jsonb, boolean);
DROP FUNCTION pg_temp.lindyson_clean_generation_reference(uuid, jsonb, boolean);
