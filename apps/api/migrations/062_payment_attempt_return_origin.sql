-- 支付返回来源是 attempt 的不可变业务身份。
-- 保留数据库默认值，确保迁移完成到新 API 容器切换之间旧版本仍可继续创建 attempt。

ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS return_origin text DEFAULT 'https://www.lindyson.com';

ALTER TABLE payment_attempts
  ALTER COLUMN return_origin SET DEFAULT 'https://www.lindyson.com';

UPDATE payment_attempts
SET return_origin = 'https://www.lindyson.com'
WHERE return_origin IS NULL;

ALTER TABLE payment_attempts
  ALTER COLUMN return_origin SET NOT NULL;

COMMENT ON COLUMN payment_attempts.return_origin IS
  '创建此支付 attempt 时的可信前端来源；用于移动支付返回地址，一旦写入不可修改。';

-- 047 首次定义此函数；必须等 return_origin 加列后再替换，保持历史迁移顺序可执行。
CREATE OR REPLACE FUNCTION preserve_payment_attempt_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.order_id, NEW.attempt, NEW.idempotency_key, NEW.request_hash,
    NEW.merchant_order_no, NEW.channel_revision_id, NEW.amount, NEW.currency,
    NEW.surface, NEW.way_code, NEW.return_origin
  ) IS DISTINCT FROM ROW(
    OLD.order_id, OLD.attempt, OLD.idempotency_key, OLD.request_hash,
    OLD.merchant_order_no, OLD.channel_revision_id, OLD.amount, OLD.currency,
    OLD.surface, OLD.way_code, OLD.return_origin
  ) THEN
    RAISE EXCEPTION 'payment_attempts 业务身份不可修改：attempt=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_attempts_preserve_identity ON payment_attempts;
CREATE TRIGGER payment_attempts_preserve_identity
BEFORE UPDATE ON payment_attempts
FOR EACH ROW EXECUTE FUNCTION preserve_payment_attempt_identity();
