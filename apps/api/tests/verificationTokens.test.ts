import { describe, expect, it } from 'vitest';
import {
  createPasswordResetToken,
  createSixDigitCode,
  createVerificationSalt,
  hashPasswordResetToken,
  hashVerificationCode,
} from '../src/auth/verificationTokens.js';

describe('邮箱验证码和密码重置 token', () => {
  it('生成 6 位数字注册验证码', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(createSixDigitCode()).toMatch(/^\d{6}$/);
    }
  });

  it('验证码哈希与盐值绑定，不保存明文验证码', () => {
    const code = '123456';
    const firstSalt = createVerificationSalt();
    const secondSalt = createVerificationSalt();

    expect(firstSalt).toMatch(/^[a-f0-9]{32}$/);
    expect(secondSalt).toMatch(/^[a-f0-9]{32}$/);
    expect(hashVerificationCode(code, firstSalt)).toBe(hashVerificationCode(code, firstSalt));
    expect(hashVerificationCode(code, firstSalt)).not.toBe(hashVerificationCode(code, secondSalt));
    expect(hashVerificationCode(code, firstSalt)).not.toContain(code);
  });

  it('密码重置 token 只通过哈希匹配', () => {
    const resetToken = createPasswordResetToken();

    expect(resetToken.token).toHaveLength(43);
    expect(resetToken.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPasswordResetToken(resetToken.token)).toBe(resetToken.hash);
    expect(hashPasswordResetToken(`${resetToken.token}-wrong`)).not.toBe(resetToken.hash);
  });
});
