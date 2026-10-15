-- 邀约关系只在注册时绑定，奖励通过独立加购积分批次进入现有账本。
CREATE TABLE IF NOT EXISTS referral_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  inviter_credits integer NOT NULL DEFAULT 500 CHECK (inviter_credits BETWEEN 1 AND 1000000),
  invitee_credits integer NOT NULL DEFAULT 500 CHECK (invitee_credits BETWEEN 1 AND 1000000)
);
INSERT INTO referral_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS referral_codes (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9_-]{16,64}$')
);
CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id uuid NOT NULL REFERENCES users(id),
  invitee_id uuid NOT NULL UNIQUE REFERENCES users(id),
  inviter_credits integer NOT NULL CHECK (inviter_credits > 0),
  invitee_credits integer NOT NULL CHECK (invitee_credits > 0),
  order_id uuid UNIQUE REFERENCES orders(id),
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (inviter_id <> invitee_id)
);
CREATE INDEX IF NOT EXISTS referrals_inviter_page ON referrals(inviter_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS referrals_page ON referrals(created_at DESC, id DESC);
ALTER TABLE credit_lots ADD COLUMN IF NOT EXISTS referral_revoked_at timestamptz;
ALTER TABLE credit_lots DROP CONSTRAINT IF EXISTS credit_lots_source_type_check;
ALTER TABLE credit_lots ADD CONSTRAINT credit_lots_source_type_check CHECK (
  source_type IN ('order', 'subscription-cycle', 'admin-adjustment', 'legacy', 'tk-prompt-engine-refund', 'referral-reward')
);
CREATE TABLE IF NOT EXISTS referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES referrals(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('inviter', 'invitee')),
  amount integer NOT NULL CHECK (amount > 0),
  lot_id uuid UNIQUE REFERENCES credit_lots(id),
  reviewed_consumed integer NOT NULL DEFAULT 0 CHECK (reviewed_consumed >= 0 AND reviewed_consumed <= amount),
  review_note text,
  UNIQUE (referral_id, role),
  UNIQUE (referral_id, user_id)
);
-- 各关系独立递增版本，读取时求和；避免所有奖励写入争抢一行造成跨账户锁反转。
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION preserve_referral_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '邀请关系不可删除'; END IF;
  IF ROW(NEW.inviter_id, NEW.invitee_id, NEW.inviter_credits, NEW.invitee_credits, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.inviter_id, OLD.invitee_id, OLD.inviter_credits, OLD.invitee_credits, OLD.created_at)
    OR (OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id)
    OR (OLD.refunded_at IS NOT NULL AND NEW.refunded_at IS DISTINCT FROM OLD.refunded_at) THEN
    RAISE EXCEPTION '邀请归属、规则和首次奖励订单不可改写';
  END IF;
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS preserve_referral_identity ON referrals;
CREATE TRIGGER preserve_referral_identity BEFORE UPDATE OR DELETE ON referrals
FOR EACH ROW EXECUTE FUNCTION preserve_referral_identity();
CREATE OR REPLACE FUNCTION bump_referral_page_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'referral_rewards' THEN
    UPDATE referrals SET revision = revision + 1 WHERE id = COALESCE(NEW.referral_id, OLD.referral_id);
  ELSE
    UPDATE referrals SET revision = revision + 1
      WHERE id IN (SELECT referral_id FROM referral_rewards WHERE lot_id = NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS referral_rewards_page_version ON referral_rewards;
CREATE TRIGGER referral_rewards_page_version AFTER INSERT OR UPDATE OR DELETE ON referral_rewards
FOR EACH ROW EXECUTE FUNCTION bump_referral_page_version();
DROP TRIGGER IF EXISTS referral_lots_page_version ON credit_lots;
CREATE TRIGGER referral_lots_page_version AFTER UPDATE ON credit_lots
FOR EACH ROW WHEN (NEW.source_type = 'referral-reward') EXECUTE FUNCTION bump_referral_page_version();
-- 撤销不可逆，已撤销批次不得重新成为可用余额。
CREATE OR REPLACE FUNCTION guard_revoked_referral_lot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.referral_revoked_at IS NOT NULL AND NEW.referral_revoked_at IS DISTINCT FROM OLD.referral_revoked_at)
     OR (NEW.referral_revoked_at IS NOT NULL AND (NEW.source_type <> 'referral-reward' OR NEW.available_amount <> 0)) THEN
    RAISE EXCEPTION '已撤销邀约奖励不可重新变成可用余额';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_revoked_referral_lot ON credit_lots;
CREATE TRIGGER guard_revoked_referral_lot BEFORE UPDATE ON credit_lots
FOR EACH ROW EXECUTE FUNCTION guard_revoked_referral_lot();
