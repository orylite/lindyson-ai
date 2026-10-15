-- Seedance 视频成本规则只记录当前产品使用的 480p / 720p / 1080p，且全部采用官网刊例价。
-- 旧版本保留到本次规则生效前，历史 Provider 用量快照绝不回写。
UPDATE provider_pricing_rules
SET effective_to = '2026-08-10 00:00:00+08'
WHERE provider = 'volcengine-ark'
  AND price_version = 'volcengine-seedance-2026-07-10'
  AND effective_to IS NULL;

INSERT INTO provider_pricing_rules (
  provider, model, resolution, has_video_input, unit_price_per_million,
  currency, price_version, effective_from, source_url
)
VALUES
  ('volcengine-ark', 'Seedance 2.5', '480p', false, 70, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.5', '480p', true,  42, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.5', '720p', false, 70, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.5', '720p', true,  42, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0', '480p', false, 46, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0', '480p', true,  28, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0', '720p', false, 46, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0', '720p', true,  28, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0', '1080p', false, 51, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0', '1080p', true,  31, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Fast', '480p', false, 37, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Fast', '480p', true,  22, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Fast', '720p', false, 37, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Fast', '720p', true,  22, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Mini', '480p', false, 23, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Mini', '480p', true,  14, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Mini', '720p', false, 23, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'),
  ('volcengine-ark', 'Seedance 2.0 Mini', '720p', true,  14, 'CNY', 'volcengine-seedance-2026-08-10', '2026-08-10 00:00:00+08', 'https://docs.volcengine.com/docs/82379/1544106?lang=zh')
ON CONFLICT (provider, model, resolution, has_video_input, price_version) DO NOTHING;
