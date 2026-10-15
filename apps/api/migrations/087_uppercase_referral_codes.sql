-- 保留上一版含小写或特殊字符的短码；与当前大写数字码、历史长码的空间互不重叠。
ALTER TABLE referral_codes ADD COLUMN IF NOT EXISTS legacy_short_code text;
CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_legacy_short_code_unique ON referral_codes(legacy_short_code);
ALTER TABLE referral_codes DROP CONSTRAINT IF EXISTS referral_codes_code_check;
DO $$
DECLARE invitation record; short_code text; attempts integer; random_byte integer;
BEGIN
  FOR invitation IN SELECT user_id, code FROM referral_codes WHERE code !~ '^[A-Z0-9]{8}$' FOR UPDATE LOOP
    attempts := 0;
    LOOP
      attempts := attempts + 1;
      short_code := '';
      WHILE length(short_code) < 8 LOOP
        random_byte := get_byte(gen_random_bytes(1), 0);
        -- 拒绝末尾四个值，保证 36 个字符的概率相同。
        IF random_byte < 252 THEN
          short_code := short_code || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', random_byte % 36 + 1, 1);
        END IF;
      END LOOP;
      BEGIN
        UPDATE referral_codes SET legacy_short_code = code, code = short_code WHERE user_id = invitation.user_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF attempts >= 8 THEN RAISE EXCEPTION '无法生成唯一的 8 位大写字母数字邀请码'; END IF;
      END;
    END LOOP;
  END LOOP;
END;
$$;
ALTER TABLE referral_codes ADD CONSTRAINT referral_codes_code_check CHECK (code ~ '^[A-Z0-9]{8}$');
ALTER TABLE referral_codes DROP CONSTRAINT IF EXISTS referral_codes_legacy_short_code_check;
ALTER TABLE referral_codes ADD CONSTRAINT referral_codes_legacy_short_code_check
  CHECK (legacy_short_code IS NULL OR (legacy_short_code ~ '^[A-Za-z0-9_-]{8}$' AND legacy_short_code !~ '^[A-Z0-9]{8}$'));
