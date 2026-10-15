-- 统一 Doubao Seed 2.0 Lite 价格快照的官方来源地址。
-- 052 已进入正式环境，因此通过可重放的新迁移更正来源，不改写既有迁移历史。

UPDATE prompt_wizard_model_pricing_rules
SET source_url = 'https://docs.volcengine.com/docs/82379/1544106?lang=zh'
WHERE id IN (
  'volcengine-doubao-seed-2-0-lite-260428-default-2026-07-23-0-32k',
  'volcengine-doubao-seed-2-0-lite-260428-default-2026-07-23-32k-128k',
  'volcengine-doubao-seed-2-0-lite-260428-default-2026-07-23-128k-256k'
)
AND source_url IS DISTINCT FROM 'https://docs.volcengine.com/docs/82379/1544106?lang=zh';
