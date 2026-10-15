-- 展示码缩短为 8 位，原长码保留为兼容别名，已经分享的链接继续可用。
ALTER TABLE referral_codes ADD COLUMN IF NOT EXISTS legacy_code text;
CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_legacy_code_unique ON referral_codes(legacy_code);
ALTER TABLE referral_codes DROP CONSTRAINT IF EXISTS referral_codes_code_check;
DO $$
DECLARE
  invitation record;
  short_code text;
  attempts integer;
BEGIN
  FOR invitation IN SELECT user_id, code FROM referral_codes WHERE length(code) <> 8 FOR UPDATE LOOP
    attempts := 0;
    LOOP
      attempts := attempts + 1;
      short_code := translate(encode(gen_random_bytes(6), 'base64'), '+/', '-_');
      BEGIN
        UPDATE referral_codes SET legacy_code = code, code = short_code WHERE user_id = invitation.user_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF attempts >= 8 THEN RAISE EXCEPTION '无法生成唯一的 8 位邀请码'; END IF;
      END;
    END LOOP;
  END LOOP;
END;
$$;
ALTER TABLE referral_codes ADD CONSTRAINT referral_codes_code_check CHECK (code ~ '^[A-Za-z0-9_-]{8}$');
ALTER TABLE referral_codes DROP CONSTRAINT IF EXISTS referral_codes_legacy_code_check;
ALTER TABLE referral_codes ADD CONSTRAINT referral_codes_legacy_code_check
  CHECK (legacy_code IS NULL OR legacy_code ~ '^[A-Za-z0-9_-]{16,64}$');
