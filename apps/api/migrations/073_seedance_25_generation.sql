-- Seedance 2.5 用户端积分基准。
--
-- 生产迁移尊重部署时 Seedance 2.0 的普通积分：2.5 与 2.0 的无视频输入
-- 官网刊例价分别为 70 / 46 元每百万 Token；含视频输入价为 42 / 70。
-- 20 / 30 秒从同分辨率 15 秒的已换算 2.5 积分继续推导。
DO $$
DECLARE
  baseline_count integer;
BEGIN
  SELECT COUNT(*)
  INTO baseline_count
  FROM consumption_settings
  WHERE kind = 'video'
    AND model = 'Seedance 2.0'
    AND duration_seconds IN (5, 10, 15)
    AND resolution IN ('480p', '720p');

  IF baseline_count NOT IN (0, 6) THEN
    RAISE EXCEPTION 'Seedance 2.5 迁移要求 Seedance 2.0 的 480p/720p × 5/10/15 秒积分基准为 0 或 6 条，当前为 % 条', baseline_count;
  END IF;
END
$$;

WITH seedance_20_existing_baseline AS (
  SELECT duration_seconds, resolution, credits
  FROM consumption_settings
  WHERE kind = 'video'
    AND model = 'Seedance 2.0'
    AND duration_seconds IN (5, 10, 15)
    AND resolution IN ('480p', '720p')
), seedance_20_default_baseline(duration_seconds, resolution, credits) AS (
  VALUES
    (5,  '480p', 32),
    (10, '480p', 56),
    (15, '480p', 56),
    (5,  '720p', 40),
    (10, '720p', 70),
    (15, '720p', 80)
), seedance_20_baseline AS (
  SELECT duration_seconds, resolution, credits
  FROM seedance_20_existing_baseline

  UNION ALL

  SELECT duration_seconds, resolution, credits
  FROM seedance_20_default_baseline
  WHERE NOT EXISTS (SELECT 1 FROM seedance_20_existing_baseline)
), seedance_25_short AS (
  SELECT
    duration_seconds,
    resolution,
    CEIL(credits * 70::numeric / 46)::integer AS credits
  FROM seedance_20_baseline
), seedance_25_all_durations AS (
  SELECT duration_seconds, resolution, credits
  FROM seedance_25_short

  UNION ALL

  SELECT 20, resolution, CEIL(credits * 20::numeric / 15)::integer
  FROM seedance_25_short
  WHERE duration_seconds = 15

  UNION ALL

  SELECT 30, resolution, credits * 2
  FROM seedance_25_short
  WHERE duration_seconds = 15
), seedance_25_pricing AS (
  SELECT
    duration_seconds,
    resolution,
    credits,
    CEIL(credits * 42::numeric / 70)::integer AS reference_video_credits
  FROM seedance_25_all_durations
)
INSERT INTO consumption_settings (
  kind, model, model_label, duration_seconds, resolution,
  credits, reference_video_credits, available
)
SELECT
  'video',
  'Seedance 2.5',
  'Seedance 2.5',
  duration_seconds,
  resolution,
  credits,
  reference_video_credits,
  false
FROM seedance_25_pricing
ON CONFLICT (kind, model, duration_seconds, resolution) DO NOTHING;

DO $$
DECLARE
  seedance_25_count integer;
BEGIN
  SELECT COUNT(*)
  INTO seedance_25_count
  FROM consumption_settings
  WHERE kind = 'video' AND model = 'Seedance 2.5';

  IF seedance_25_count <> 10 THEN
    RAISE EXCEPTION 'Seedance 2.5 迁移后必须恰有 10 条积分组合，当前为 % 条', seedance_25_count;
  END IF;
END
$$;
