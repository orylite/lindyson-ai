import { createHash, randomBytes, randomInt } from 'node:crypto';

export function createPasswordResetToken() {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    hash: hashPasswordResetToken(token),
  };
}

export function hashPasswordResetToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSixDigitCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function createVerificationSalt() {
  return randomBytes(16).toString('hex');
}

export function hashVerificationCode(code: string, salt: string) {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}
