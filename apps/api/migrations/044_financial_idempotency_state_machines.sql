-- 财务幂等基础设施：积分批次、支付/退款 attempt、通道版本和供应商事件。
-- 本迁移只做扩展和保守回填；旧订单字段保留，应用完成双读切换后再另行清理。

ALTER TABLE credit_ledger
  ADD COLUMN IF NOT EXISTS business_event_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_business_event_key
  ON credit_ledger(business_event_key)
  WHERE business_event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS credit_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  bucket text NOT NULL CHECK (bucket IN ('main', 'addon')),
  source_type text NOT NULL CHECK (source_type IN ('order', 'subscription-cycle', 'admin-adjustment', 'legacy')),
  source_order_id uuid REFERENCES orders(id),
  source_event_key text NOT NULL UNIQUE,
  original_amount integer NOT NULL CHECK (original_amount >= 0),
  available_amount integer NOT NULL DEFAULT 0 CHECK (available_amount >= 0),
  held_amount integer NOT NULL DEFAULT 0 CHECK (held_amount >= 0),
  consumed_amount integer NOT NULL DEFAULT 0 CHECK (consumed_amount >= 0),
  expired_amount integer NOT NULL DEFAULT 0 CHECK (expired_amount >= 0),
  reversed_amount integer NOT NULL DEFAULT 0 CHECK (reversed_amount >= 0),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_lots_amounts_balance CHECK (
    original_amount = available_amount + held_amount + consumed_amount + expired_amount + reversed_amount
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_lots_source_order
  ON credit_lots(source_order_id)
  WHERE source_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_lots_spendable
  ON credit_lots(user_id, bucket, expires_at, created_at, id)
  WHERE available_amount > 0;

CREATE TABLE IF NOT EXISTS credit_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  lot_id uuid NOT NULL REFERENCES credit_lots(id),
  business_event_key text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('generation', 'refund', 'adjustment')),
  status text NOT NULL CHECK (status IN ('held', 'settled', 'released', 'reversed', 'expired')),
  amount integer NOT NULL CHECK (amount > 0),
  related_order_id uuid REFERENCES orders(id),
  related_job_id uuid REFERENCES generation_tasks(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_event_key, lot_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_allocations_order
  ON credit_allocations(related_order_id, status)
  WHERE related_order_id IS NOT NULL;

-- total_credits 是两个可用桶的派生缓存，禁止调用方自行计算出不同结果。
CREATE OR REPLACE FUNCTION sync_user_total_credits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.total_credits := NEW.main_credits + NEW.addon_credits;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_sync_total_credits ON users;
CREATE TRIGGER users_sync_total_credits
BEFORE INSERT OR UPDATE OF main_credits, addon_credits, total_credits ON users
FOR EACH ROW EXECUTE FUNCTION sync_user_total_credits();

UPDATE users
SET total_credits = main_credits + addon_credits
WHERE total_credits <> main_credits + addon_credits;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_total_credits_matches_buckets;
ALTER TABLE users
  ADD CONSTRAINT users_total_credits_matches_buckets
  CHECK (total_credits = main_credits + addon_credits) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT users_total_credits_matches_buckets;

-- 历史余额无法可靠归属到具体订单，统一建 legacy lot；这类 lot 不允许自动整单退款。
INSERT INTO credit_lots (
  user_id, bucket, source_type, source_event_key,
  original_amount, available_amount, expires_at, created_at, updated_at
)
SELECT id, 'main', 'legacy', 'legacy-main:' || id,
       main_credits, main_credits,
       CASE WHEN plan_reset_at IS NULL THEN NULL ELSE plan_reset_at::timestamptz END,
       created_at, now()
FROM users
WHERE main_credits > 0
ON CONFLICT (source_event_key) DO NOTHING;

INSERT INTO credit_lots (
  user_id, bucket, source_type, source_event_key,
  original_amount, available_amount, created_at, updated_at
)
SELECT id, 'addon', 'legacy', 'legacy-addon:' || id,
       addon_credits, addon_credits, created_at, now()
FROM users
WHERE addon_credits > 0
ON CONFLICT (source_event_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS payment_channel_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  enabled boolean NOT NULL,
  api_base text NOT NULL,
  mch_no text NOT NULL,
  app_id text NOT NULL,
  api_key_ciphertext text,
  api_key_iv text,
  api_key_tag text,
  desktop_way_code text NOT NULL,
  mobile_way_code text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, revision)
);

ALTER TABLE payment_channels
  ADD COLUMN IF NOT EXISTS current_revision_id uuid REFERENCES payment_channel_revisions(id);

INSERT INTO payment_channel_revisions (
  provider, revision, enabled, api_base, mch_no, app_id,
  api_key_ciphertext, api_key_iv, api_key_tag,
  desktop_way_code, mobile_way_code, created_by, created_at
)
SELECT provider, 1, enabled, api_base, mch_no, app_id,
       api_key_ciphertext, api_key_iv, api_key_tag,
       desktop_way_code, mobile_way_code, updated_by, created_at
FROM payment_channels
ON CONFLICT (provider, revision) DO NOTHING;

UPDATE payment_channels channel
SET current_revision_id = revision.id
FROM payment_channel_revisions revision
WHERE revision.provider = channel.provider
  AND revision.revision = (
    SELECT max(candidate.revision)
    FROM payment_channel_revisions candidate
    WHERE candidate.provider = channel.provider
  )
  AND channel.current_revision_id IS NULL;

CREATE TABLE IF NOT EXISTS payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  attempt integer NOT NULL CHECK (attempt > 0),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  merchant_order_no text NOT NULL UNIQUE,
  channel_revision_id uuid REFERENCES payment_channel_revisions(id),
  provider_order_id text,
  provider_trade_id text,
  amount integer NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
  surface text NOT NULL CHECK (surface IN ('pc', 'mobile')),
  way_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'ready', 'uncertain', 'paid', 'closed', 'failed', 'manual-review')),
  launch_ciphertext text,
  launch_iv text,
  launch_tag text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  error text,
  manual_review_reason text,
  ready_at timestamptz,
  paid_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, attempt),
  UNIQUE (order_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_provider_order
  ON payment_attempts(provider_order_id)
  WHERE provider_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_due
  ON payment_attempts(next_at, created_at)
  WHERE status IN ('queued', 'processing', 'uncertain');

CREATE TABLE IF NOT EXISTS order_refund_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  attempt integer NOT NULL CHECK (attempt > 0),
  request_hash text NOT NULL,
  merchant_refund_no text NOT NULL UNIQUE,
  merchant_order_no text NOT NULL,
  channel_revision_id uuid REFERENCES payment_channel_revisions(id),
  provider_refund_id text,
  provider_order_id text,
  amount integer NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'submitted', 'uncertain', 'succeeded', 'failed', 'manual-review')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  client_ip inet,
  error text,
  manual_review_reason text,
  submitted_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, attempt)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_refund_attempts_provider_refund
  ON order_refund_attempts(provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_refund_attempts_due
  ON order_refund_attempts(next_at, created_at)
  WHERE status IN ('queued', 'processing', 'submitted', 'uncertain');

CREATE TABLE IF NOT EXISTS provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('payment-notify', 'refund-notify')),
  event_key text NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'rejected')),
  order_id uuid REFERENCES orders(id),
  payment_attempt_id uuid REFERENCES payment_attempts(id),
  refund_attempt_id uuid REFERENCES order_refund_attempts(id),
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, event_type, event_key)
);

CREATE TABLE IF NOT EXISTS payment_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  provider_message_id text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_notification_outbox_due
  ON payment_notification_outbox(available_at, created_at)
  WHERE status IN ('pending', 'processing');

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS current_payment_attempt_id uuid REFERENCES payment_attempts(id),
  ADD COLUMN IF NOT EXISTS current_refund_attempt_id uuid REFERENCES order_refund_attempts(id);

-- 历史 attempt 仅表达已知事实；不从缺失字段猜测供应商状态。
WITH historical_payment_orders AS (
  SELECT item.*,
         CASE
           WHEN item.provider_order_id IS NULL THEN 0
           ELSE count(*) OVER (PARTITION BY item.provider_order_id)
         END AS provider_order_id_count
  FROM orders item
  WHERE item.payment_provider = 'jeepay'
    AND item.merchant_order_no IS NOT NULL
)
INSERT INTO payment_attempts (
  order_id, attempt, idempotency_key, request_hash, merchant_order_no,
  channel_revision_id, provider_order_id, provider_trade_id, amount,
  surface, way_code, status, error, manual_review_reason, next_at, ready_at, paid_at, terminal_at,
  created_at, updated_at
)
SELECT orders.id, 1,
       COALESCE(orders.idempotency_key, 'legacy:' || orders.id),
       'legacy:' || encode(digest(concat_ws('|', orders.plan_id::text, orders.billing, orders.amount::text,
         COALESCE(orders.payment_surface, 'pc')), 'sha256'), 'hex'),
       orders.merchant_order_no,
       channel.current_revision_id,
       CASE WHEN orders.provider_order_id_count > 1 THEN NULL ELSE orders.provider_order_id END,
       orders.provider_trade_id,
       orders.amount,
       COALESCE(orders.payment_surface, 'pc'),
       COALESCE(orders.payment_way_code, 'ALI_WAP'),
       CASE
         WHEN channel.current_revision_id IS NULL THEN 'manual-review'
         WHEN orders.provider_order_id_count > 1 THEN 'manual-review'
         WHEN orders.status IN ('paid', 'refunded') THEN 'paid'
         WHEN orders.status = 'failed' THEN 'failed'
         WHEN orders.provider_order_id IS NOT NULL THEN 'uncertain'
         ELSE 'queued'
       END,
       orders.payment_error,
       CASE
         WHEN channel.current_revision_id IS NULL THEN '历史支付订单缺少可验证的支付通道版本'
         WHEN orders.provider_order_id_count > 1 THEN '历史支付订单重复使用供应商支付单号'
         ELSE NULL
       END,
       CASE
         WHEN channel.current_revision_id IS NOT NULL
           AND orders.provider_order_id_count <= 1
           AND orders.status = 'pending'
           THEN COALESCE(orders.payment_create_claimed_at, orders.created_at, now())
         ELSE NULL
       END,
       CASE
         WHEN orders.provider_order_id IS NOT NULL AND orders.provider_order_id_count = 1
           THEN orders.created_at
         ELSE NULL
       END,
       orders.paid_at,
       CASE
         WHEN channel.current_revision_id IS NULL THEN COALESCE(orders.created_at, now())
         WHEN orders.provider_order_id_count > 1 THEN COALESCE(orders.created_at, now())
         WHEN orders.status IN ('paid', 'refunded', 'failed') THEN COALESCE(orders.paid_at, orders.failed_at, orders.refunded_at, orders.created_at)
         ELSE NULL
       END,
       orders.created_at, now()
FROM historical_payment_orders orders
LEFT JOIN payment_channels channel ON channel.provider = orders.payment_provider
ON CONFLICT (merchant_order_no) DO NOTHING;

-- 允许在影子库重复执行修正版 044：旧回填若没有通道 revision，必须终止自动重试。
UPDATE payment_attempts
SET status = 'manual-review',
    manual_review_reason = COALESCE(manual_review_reason, '历史支付订单缺少可验证的支付通道版本'),
    next_at = NULL,
    lease_token = NULL,
    lease_until = NULL,
    terminal_at = COALESCE(terminal_at, now()),
    updated_at = now()
WHERE channel_revision_id IS NULL
  AND status <> 'manual-review';

-- manual-review 是终态，不得残留可领取时间或租约；此更新也修复早期 044
-- 在重复供应商支付单号场景留下 next_at 的影子库记录。
UPDATE payment_attempts
SET next_at = NULL,
    lease_token = NULL,
    lease_until = NULL,
    terminal_at = COALESCE(terminal_at, now()),
    updated_at = now()
WHERE status = 'manual-review'
  AND (next_at IS NOT NULL OR lease_token IS NOT NULL OR lease_until IS NOT NULL OR terminal_at IS NULL);

UPDATE orders item
SET current_payment_attempt_id = attempt.id
FROM payment_attempts attempt
WHERE attempt.order_id = item.id
  AND attempt.attempt = (SELECT max(candidate.attempt) FROM payment_attempts candidate WHERE candidate.order_id = item.id)
  AND item.current_payment_attempt_id IS NULL;

WITH payment_provider_id_counts AS (
  SELECT provider_order_id, count(*) AS provider_order_id_count
  FROM orders
  WHERE provider_order_id IS NOT NULL
  GROUP BY provider_order_id
),
historical_refund_orders AS (
  SELECT item.*,
         CASE
           WHEN item.provider_refund_id IS NULL THEN 0
           ELSE count(*) OVER (PARTITION BY item.provider_refund_id)
         END AS provider_refund_id_count,
         COALESCE(payment_ids.provider_order_id_count, 0) AS provider_order_id_count
  FROM orders item
  LEFT JOIN payment_provider_id_counts payment_ids
    ON payment_ids.provider_order_id = item.provider_order_id
  WHERE item.merchant_refund_no IS NOT NULL
    AND item.merchant_order_no IS NOT NULL
)
INSERT INTO order_refund_attempts (
  order_id, attempt, request_hash, merchant_refund_no, merchant_order_no,
  channel_revision_id, provider_refund_id, provider_order_id, amount,
  status, attempts, next_at, lease_until, client_ip, error,
  manual_review_reason, submitted_at, terminal_at, created_at, updated_at
)
SELECT orders.id, 1,
       encode(digest(concat_ws('|', orders.id::text, orders.amount::text, orders.merchant_refund_no), 'sha256'), 'hex'),
       orders.merchant_refund_no, orders.merchant_order_no,
       channel.current_revision_id,
       CASE WHEN orders.provider_refund_id_count > 1 THEN NULL ELSE orders.provider_refund_id END,
       orders.provider_order_id,
       orders.amount,
       CASE
         WHEN channel.current_revision_id IS NULL THEN 'manual-review'
         WHEN orders.provider_refund_id_count > 1 THEN 'manual-review'
         WHEN orders.provider_order_id_count > 1 THEN 'manual-review'
         WHEN orders.refund_status = 'pending'
           AND orders.provider_refund_id IS NOT NULL
           AND orders.refund_dispatch_status IN ('idle', 'queued')
           THEN 'manual-review'
         WHEN orders.refund_status = 'succeeded' THEN 'succeeded'
         WHEN orders.refund_status = 'failed' THEN 'failed'
         WHEN orders.refund_status <> 'pending' THEN 'manual-review'
         WHEN orders.refund_dispatch_status = 'submitted' THEN 'submitted'
         WHEN orders.refund_dispatch_status IN ('processing', 'uncertain') THEN 'uncertain'
         WHEN orders.refund_dispatch_status IN ('idle', 'queued') THEN 'queued'
         ELSE 'manual-review'
       END,
       orders.refund_dispatch_attempts,
       CASE
         WHEN channel.current_revision_id IS NOT NULL
           AND orders.provider_refund_id_count <= 1
           AND orders.provider_order_id_count <= 1
           AND orders.refund_status = 'pending'
           AND orders.refund_dispatch_status IN ('idle', 'queued', 'processing', 'uncertain', 'submitted')
           AND NOT (
             orders.provider_refund_id IS NOT NULL
             AND orders.refund_dispatch_status IN ('idle', 'queued')
           )
           THEN COALESCE(orders.refund_dispatch_next_at, now())
         ELSE NULL
       END,
       NULL, orders.refund_client_ip,
       orders.refund_error,
       CASE
         WHEN channel.current_revision_id IS NULL THEN '历史退款订单缺少可验证的支付通道版本'
         WHEN orders.provider_refund_id_count > 1 THEN '历史退款订单重复使用供应商退款单号'
         WHEN orders.provider_order_id_count > 1 THEN '历史退款订单关联了重复的供应商支付单号'
         WHEN orders.refund_status = 'pending'
           AND orders.provider_refund_id IS NOT NULL
           AND orders.refund_dispatch_status IN ('idle', 'queued')
           THEN '历史退款已有供应商退款单号但仍处于未提交投递状态'
         WHEN orders.refund_status <> 'pending'
           AND orders.refund_status NOT IN ('succeeded', 'failed')
           THEN '历史退款号与订单退款状态冲突'
         WHEN orders.refund_status = 'pending'
           AND orders.refund_dispatch_status NOT IN ('idle', 'queued', 'processing', 'uncertain', 'submitted')
           THEN '历史退款状态与投递状态冲突'
         ELSE NULL
       END,
       CASE
         WHEN orders.provider_refund_id IS NOT NULL AND orders.provider_refund_id_count = 1
           THEN orders.created_at
         ELSE NULL
       END,
       CASE
         WHEN channel.current_revision_id IS NULL THEN COALESCE(orders.created_at, now())
         WHEN orders.provider_refund_id_count > 1 THEN COALESCE(orders.created_at, now())
         WHEN orders.provider_order_id_count > 1 THEN COALESCE(orders.created_at, now())
         WHEN orders.refund_status = 'pending'
           AND orders.provider_refund_id IS NOT NULL
           AND orders.refund_dispatch_status IN ('idle', 'queued')
           THEN COALESCE(orders.created_at, now())
         WHEN orders.refund_status IN ('succeeded', 'failed') THEN COALESCE(orders.refunded_at, orders.created_at)
         WHEN orders.refund_status <> 'pending'
           OR orders.refund_dispatch_status NOT IN ('idle', 'queued', 'processing', 'uncertain', 'submitted')
           THEN COALESCE(orders.created_at, now())
         ELSE NULL
       END,
       orders.created_at, now()
FROM historical_refund_orders orders
LEFT JOIN payment_channels channel ON channel.provider = orders.payment_provider
ON CONFLICT (merchant_refund_no) DO NOTHING;

UPDATE order_refund_attempts
SET status = 'manual-review',
    manual_review_reason = COALESCE(manual_review_reason, '历史退款订单缺少可验证的支付通道版本'),
    next_at = NULL,
    lease_token = NULL,
    lease_until = NULL,
    terminal_at = COALESCE(terminal_at, now()),
    updated_at = now()
WHERE channel_revision_id IS NULL
  AND status <> 'manual-review';

UPDATE order_refund_attempts
SET next_at = NULL,
    lease_token = NULL,
    lease_until = NULL,
    terminal_at = COALESCE(terminal_at, now()),
    updated_at = now()
WHERE status = 'manual-review'
  AND (next_at IS NOT NULL OR lease_token IS NOT NULL OR lease_until IS NOT NULL OR terminal_at IS NULL);

-- 允许修正版 044 在已经跑过旧版本的影子库重复执行：已存在退款号却仍标记为
-- idle/queued，或关联了重复供应商支付单号，都是矛盾历史，只能人工核对。
WITH payment_provider_id_counts AS (
  SELECT provider_order_id, count(*) AS provider_order_id_count
  FROM orders
  WHERE provider_order_id IS NOT NULL
  GROUP BY provider_order_id
)
UPDATE order_refund_attempts attempt
SET status = 'manual-review',
    manual_review_reason = COALESCE(
      attempt.manual_review_reason,
      CASE
        WHEN payment_ids.provider_order_id_count > 1
          THEN '历史退款订单关联了重复的供应商支付单号'
        ELSE '历史退款已有供应商退款单号但仍处于未提交投递状态'
      END
    ),
    next_at = NULL,
    lease_token = NULL,
    lease_until = NULL,
    terminal_at = COALESCE(attempt.terminal_at, now()),
    updated_at = now()
FROM orders item
LEFT JOIN payment_provider_id_counts payment_ids
  ON payment_ids.provider_order_id = item.provider_order_id
WHERE attempt.order_id = item.id
  AND attempt.attempt = 1
  AND attempt.created_at = item.created_at
  AND attempt.status NOT IN ('succeeded', 'failed', 'manual-review')
  AND (
    payment_ids.provider_order_id_count > 1
    OR (
      item.refund_status = 'pending'
      AND item.provider_refund_id IS NOT NULL
      AND item.refund_dispatch_status IN ('idle', 'queued')
    )
  );

UPDATE order_refund_attempts attempt
SET status = 'manual-review',
    manual_review_reason = COALESCE(
      attempt.manual_review_reason,
      CASE
        WHEN item.refund_status <> 'pending'
          AND item.refund_status NOT IN ('succeeded', 'failed')
          THEN '历史退款号与订单退款状态冲突'
        ELSE '历史退款状态与投递状态冲突'
      END
    ),
    next_at = NULL,
    lease_token = NULL,
    lease_until = NULL,
    terminal_at = COALESCE(attempt.terminal_at, now()),
    updated_at = now()
FROM orders item
WHERE attempt.order_id = item.id
  AND attempt.status NOT IN ('succeeded', 'failed', 'manual-review')
  AND (
    (item.refund_status <> 'pending' AND item.refund_status NOT IN ('succeeded', 'failed'))
    OR (
      item.refund_status = 'pending'
      AND item.refund_dispatch_status NOT IN ('idle', 'queued', 'processing', 'uncertain', 'submitted')
    )
  );

UPDATE orders item
SET current_refund_attempt_id = attempt.id
FROM order_refund_attempts attempt
WHERE attempt.order_id = item.id
  AND attempt.attempt = (SELECT max(candidate.attempt) FROM order_refund_attempts candidate WHERE candidate.order_id = item.id)
  AND item.current_refund_attempt_id IS NULL;

-- 旧 submitted 退款此前 next_at 为空，导致永不自动查单；立即恢复为可领取状态。
UPDATE orders
SET refund_dispatch_next_at = now()
WHERE refund_status = 'pending'
  AND refund_dispatch_status = 'submitted'
  AND refund_dispatch_next_at IS NULL;
