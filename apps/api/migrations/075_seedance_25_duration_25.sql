-- Seedance 2.5 新增 25 秒固定档。
--
-- 积分以迁移当时同分辨率的 15 秒普通档为基准，保留运营人员对旧档位的
-- 调价事实：25 秒普通档 = ceil(15 秒普通档 * 25 / 15)，视频参考档再按
-- 42 / 70 向上取整。迁移只插入缺失的两行，绝不覆盖已存在的人工价格或开放状态。
--
-- 旧 10 档全开时，新档也必须全开，避免部分关闭使模型整体不可用；旧档全关时
-- 新档保持关闭。旧档不完整、混合开关或已有 25 秒行与旧档状态冲突时拒绝迁移，
-- 由外层事务整体回滚。
DO $$
DECLARE
  legacy_count integer;
  legacy_available_count integer;
  initial_count integer;
  initial_available_count integer;
  unexpected_count integer;
  source_count integer;
  invalid_source_count integer;
  invalid_existing_price_count integer;
  existing_25_status_mismatch_count integer;
  desired_available boolean;
  inserted_count integer;
  final_count integer;
  final_available_count integer;
  final_invalid_price_count integer;
  pricing_snapshot jsonb;
BEGIN
  -- 与后台模型级开关争用同一批行锁，状态判断与插入位于同一事务。
  PERFORM id
  FROM consumption_settings
  WHERE kind = 'video' AND model = 'Seedance 2.5'
  FOR UPDATE;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE available)
  INTO initial_count, initial_available_count
  FROM consumption_settings
  WHERE kind = 'video' AND model = 'Seedance 2.5';

  SELECT COUNT(*)
  INTO legacy_count
  FROM consumption_settings
  WHERE kind = 'video'
    AND model = 'Seedance 2.5'
    AND duration_seconds IN (5, 10, 15, 20, 30)
    AND resolution IN ('480p', '720p');

  SELECT COUNT(*)
  INTO unexpected_count
  FROM consumption_settings
  WHERE kind = 'video'
    AND model = 'Seedance 2.5'
    AND (
      duration_seconds IN (5, 10, 15, 20, 25, 30)
      AND resolution IN ('480p', '720p')
    ) IS NOT TRUE;

  IF legacy_count <> 10 OR unexpected_count <> 0 THEN
    RAISE EXCEPTION
      'Seedance 2.5 25秒迁移要求旧 10 档完整且无额外档位，当前旧档 % 条、额外档 % 条',
      legacy_count, unexpected_count;
  END IF;

  SELECT COUNT(*) FILTER (WHERE available)
  INTO legacy_available_count
  FROM consumption_settings
  WHERE kind = 'video'
    AND model = 'Seedance 2.5'
    AND duration_seconds IN (5, 10, 15, 20, 30)
    AND resolution IN ('480p', '720p');

  IF legacy_available_count NOT IN (0, 10) THEN
    RAISE EXCEPTION
      'Seedance 2.5 旧 10 档必须全开或全关，当前开放 % 条，已回滚避免产生混合状态',
      legacy_available_count;
  END IF;
  desired_available := legacy_available_count = 10;

  SELECT COUNT(*)
  INTO invalid_existing_price_count
  FROM consumption_settings
  WHERE kind = 'video'
    AND model = 'Seedance 2.5'
    AND (
      credits <= 0
      OR reference_video_credits IS NULL
      OR reference_video_credits <= 0
    );

  IF invalid_existing_price_count <> 0 THEN
    RAISE EXCEPTION
      'Seedance 2.5 已有档位的普通与视频参考积分必须全部为正整数，当前无效 % 条',
      invalid_existing_price_count;
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE credits <= 0)
  INTO source_count, invalid_source_count
  FROM consumption_settings
  WHERE kind = 'video'
    AND model = 'Seedance 2.5'
    AND duration_seconds = 15
    AND resolution IN ('480p', '720p');

  IF source_count <> 2 OR invalid_source_count <> 0 THEN
    RAISE EXCEPTION
      'Seedance 2.5 25秒迁移要求 480p/720p 的 15 秒普通积分为正整数，当前基准 % 条、无效 % 条',
      source_count, invalid_source_count;
  END IF;

  SELECT COUNT(*)
  INTO existing_25_status_mismatch_count
  FROM consumption_settings
  WHERE kind = 'video'
    AND model = 'Seedance 2.5'
    AND duration_seconds = 25
    AND resolution IN ('480p', '720p')
    AND available IS DISTINCT FROM desired_available;

  IF existing_25_status_mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'Seedance 2.5 已有 25 秒档与旧 10 档开放状态冲突，已回滚且不覆盖人工状态';
  END IF;

  WITH source AS (
    SELECT resolution, CEIL(credits * 25::numeric / 15)::integer AS credits
    FROM consumption_settings
    WHERE kind = 'video'
      AND model = 'Seedance 2.5'
      AND duration_seconds = 15
      AND resolution IN ('480p', '720p')
  ), pricing AS (
    SELECT
      resolution,
      credits,
      CEIL(credits * 42::numeric / 70)::integer AS reference_video_credits
    FROM source
  )
  INSERT INTO consumption_settings (
    kind, model, model_label, duration_seconds, resolution,
    credits, reference_video_credits, available
  )
  SELECT
    'video',
    'Seedance 2.5',
    'Seedance 2.5',
    25,
    resolution,
    credits,
    reference_video_credits,
    desired_available
  FROM pricing
  ON CONFLICT (kind, model, duration_seconds, resolution) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE available),
    COUNT(*) FILTER (
      WHERE credits <= 0 OR reference_video_credits IS NULL OR reference_video_credits <= 0
    )
  INTO final_count, final_available_count, final_invalid_price_count
  FROM consumption_settings
  WHERE kind = 'video' AND model = 'Seedance 2.5';

  IF final_count <> 12
    OR final_available_count <> (CASE WHEN desired_available THEN 12 ELSE 0 END)
    OR final_invalid_price_count <> 0
  THEN
    RAISE EXCEPTION
      'Seedance 2.5 25秒迁移后必须为 12 档全开或全关且开放档价格有效，当前总数 %、开放 %、无效开放价格 %',
      final_count, final_available_count, final_invalid_price_count;
  END IF;

  IF inserted_count > 0 THEN
    SELECT jsonb_object_agg(
      resolution,
      jsonb_build_object(
        'credits', credits,
        'referenceVideoCredits', reference_video_credits,
        'available', available
      )
      ORDER BY resolution
    )
    INTO pricing_snapshot
    FROM consumption_settings
    WHERE kind = 'video'
      AND model = 'Seedance 2.5'
      AND duration_seconds = 25
      AND resolution IN ('480p', '720p');

    INSERT INTO audit_logs (
      admin_user_id, admin_email, module, action, target, risk, detail
    )
    SELECT
      NULL,
      'system@lindyson.local',
      '积分消耗',
      '新增 Seedance 2.5 25秒档',
      'Seedance 2.5:25s',
      'high',
      jsonb_build_object(
        'migration', '075_seedance_25_duration_25.sql',
        'insertedCount', inserted_count,
        'previousCombinationCount', initial_count,
        'newCombinationCount', final_count,
        'previousAvailableCount', initial_available_count,
        'newAvailableCount', final_available_count,
        'prices', pricing_snapshot,
        'preservedExistingPricesAndAvailability', true,
        'note', '只插入缺失的 25 秒档，未覆盖任何已有档位的人工价格或开放状态'
      )::text
    WHERE NOT EXISTS (
      SELECT 1
      FROM audit_logs AS existing_audit
      WHERE existing_audit.module = '积分消耗'
        AND existing_audit.action = '新增 Seedance 2.5 25秒档'
        AND existing_audit.target = 'Seedance 2.5:25s'
        AND existing_audit.risk = 'high'
        AND existing_audit.detail LIKE '%075_seedance_25_duration_25.sql%'
    );
  END IF;
END
$$;
