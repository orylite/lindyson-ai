import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

export interface EncryptedRealPortraitSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function createRealPortraitBearerToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function fingerprintRealPortraitSecret(value: string) {
  return createHmac('sha256', requireSecretKey()).update(value).digest('hex');
}

export function encryptRealPortraitSecret(value: string): EncryptedRealPortraitSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptRealPortraitSecret(secret: EncryptedRealPortraitSecret) {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveEncryptionKey(),
      Buffer.from(secret.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw Object.assign(new Error('真人验证会话密文无法解密', { cause: error }), {
      statusCode: 503,
      code: 'REAL_PORTRAIT_SECRET_DECRYPT_FAILED',
    });
  }
}

function deriveEncryptionKey() {
  return createHash('sha256').update(requireSecretKey()).digest();
}

function requireSecretKey() {
  const key = env.REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY?.trim();
  if (!key || key.length < 32) {
    throw Object.assign(new Error('真人验证会话加密密钥尚未配置'), {
      statusCode: 503,
      code: 'REAL_PORTRAIT_SECRET_KEY_NOT_CONFIGURED',
      exposeMessage: true,
    });
  }
  return key;
}
