import { bindReferralWithClient } from '../domain/referrals.js';
import type { FastifyInstance } from 'fastify';
import { endpointContracts } from '@lindyson/api-contracts';
import { clearAuthSession, issueAuthSession, requireAuth } from '../auth/session.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { clearAuthAccountRateLimit, enforceAuthRateLimit } from '../auth/rateLimit.js';
import {
  createPasswordResetToken,
  createSixDigitCode,
  createVerificationSalt,
  hashPasswordResetToken,
  hashVerificationCode,
} from '../auth/verificationTokens.js';
import { resolveTrustedRequestAppOrigin } from '../config/requestOrigin.js';
import { pool, withTransaction } from '../db/pool.js';
import { reconcileSubscription } from '../domain/subscriptionLifecycle.js';
import { ensureDefaultAssetFolders, getUserProfile } from '../domain/users.js';
import { sendPasswordResetEmail, sendRegisterCodeEmail, sendWelcomeEmail } from '../notifications/emailService.js';

const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;
const REGISTER_CODE_TTL_MINUTES = 10;
const REGISTER_CODE_RESEND_COOLDOWN_SECONDS = 60;
const REGISTER_CODE_MAX_ATTEMPTS = 5;

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/register-code', async request => {
    const payload = endpointContracts.authRegisterCode.body.parse(request.body);
    await enforceAuthRateLimit(request, {
      scope: 'register-code',
      identity: payload.email,
      maxAttempts: 5,
      ipMaxAttempts: 20,
      windowSeconds: 15 * 60,
    });
    const existing = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [payload.email]);
    if (existing.rowCount) {
      throw Object.assign(new Error('该邮箱已注册，请直接登录'), { statusCode: 409 });
    }

    const recent = await pool.query<{ sent_at: Date | string }>(
      `SELECT sent_at FROM registration_verification_codes
       WHERE email = $1
         AND consumed_at IS NULL
         AND sent_at > now() - ($2::text || ' seconds')::interval
       ORDER BY sent_at DESC
       LIMIT 1`,
      [payload.email, REGISTER_CODE_RESEND_COOLDOWN_SECONDS],
    );
    if (recent.rowCount) {
      throw Object.assign(new Error('验证码发送过于频繁，请稍后再试'), { statusCode: 429 });
    }

    const code = createSixDigitCode();
    const salt = createVerificationSalt();
    const codeHash = hashVerificationCode(code, salt);
    const verificationResult = await pool.query<{ id: string; expires_at: Date | string }>(
      `INSERT INTO registration_verification_codes (
         email, user_name, code_hash, code_salt, expires_at
       )
       VALUES ($1, $2, $3, $4, now() + ($5::text || ' minutes')::interval)
       RETURNING id, expires_at`,
      [payload.email, payload.userName, codeHash, salt, REGISTER_CODE_TTL_MINUTES],
    );
    const verification = verificationResult.rows[0]!;

    const emailResult = await sendRegisterCodeEmail({
      email: payload.email,
      userName: payload.userName,
      code,
      expiresMinutes: REGISTER_CODE_TTL_MINUTES,
      idempotencyKey: verification.id,
    });
    if (emailResult.status !== 'sent') {
      await pool.query('UPDATE registration_verification_codes SET consumed_at = now() WHERE id = $1', [verification.id]);
      throw Object.assign(new Error('验证码邮件发送失败，请稍后重试'), { statusCode: 503, exposeMessage: true });
    }

    return {
      verificationId: verification.id,
      expiresAt: toIsoString(verification.expires_at),
    };
  });

  app.post('/api/auth/register', async (request, reply) => {
    const payload = endpointContracts.authRegister.body.parse(request.body);
    await enforceAuthRateLimit(request, {
      scope: 'register',
      identity: payload.email,
      maxAttempts: 10,
      ipMaxAttempts: 30,
      windowSeconds: 15 * 60,
    });

    const result = await withTransaction(async client => {
      const verificationResult = await client.query<{
        id: string;
        email: string;
        user_name: string;
        code_hash: string;
        code_salt: string;
        attempt_count: number;
        expires_at: Date | string;
        consumed_at: Date | string | null;
      }>(
        `SELECT id, email, user_name, code_hash, code_salt, attempt_count, expires_at, consumed_at
         FROM registration_verification_codes
         WHERE id = $1 AND email = $2
         LIMIT 1
         FOR UPDATE`,
        [payload.verificationId, payload.email],
      );
      const verification = verificationResult.rows[0];
      if (!verification) {
        return registrationFailure('请先获取邮箱验证码', 400);
      }
      if (verification.consumed_at) {
        return registrationFailure('验证码已失效，请重新获取', 400);
      }
      if (new Date(verification.expires_at).getTime() <= Date.now()) {
        await client.query('UPDATE registration_verification_codes SET consumed_at = now() WHERE id = $1', [verification.id]);
        return registrationFailure('验证码已过期，请重新获取', 400);
      }
      if (verification.user_name !== payload.userName) {
        return registrationFailure('邮箱或用户名已变更，请重新获取验证码', 400);
      }
      if (verification.attempt_count >= REGISTER_CODE_MAX_ATTEMPTS) {
        await client.query('UPDATE registration_verification_codes SET consumed_at = now() WHERE id = $1', [verification.id]);
        return registrationFailure('验证码错误次数过多，请重新获取', 400);
      }

      const expectedHash = hashVerificationCode(payload.verificationCode, verification.code_salt);
      if (expectedHash !== verification.code_hash) {
        const nextAttemptCount = verification.attempt_count + 1;
        await client.query(
          `UPDATE registration_verification_codes
           SET attempt_count = $2::integer,
               consumed_at = CASE WHEN $2::integer >= $3::integer THEN now() ELSE consumed_at END
           WHERE id = $1`,
          [verification.id, nextAttemptCount, REGISTER_CODE_MAX_ATTEMPTS],
        );
        return registrationFailure(
          nextAttemptCount >= REGISTER_CODE_MAX_ATTEMPTS ? '验证码错误次数过多，请重新获取' : '验证码错误',
          400,
        );
      }

      const existing = await client.query('SELECT id FROM users WHERE email = $1', [payload.email]);
      if (existing.rowCount) {
        return registrationFailure('该邮箱已注册，请直接登录', 409);
      }

      const passwordHash = await hashPassword(payload.password);
      const userResult = await client.query<{ id: string; auth_version: number }>(
        `INSERT INTO users (
           email, password_hash, user_name, role, status,
           plan_id, main_credits, addon_credits, total_credits,
           plan_reset_at, plan_expires_at
         )
         VALUES (
           $1, $2, $3, 'user', 'active',
           NULL, 0, 0, 0,
           NULL, NULL
         )
         RETURNING id, auth_version`,
        [payload.email, passwordHash, payload.userName],
      );
      const userId = userResult.rows[0]!.id;

      if (payload.referralCode) await bindReferralWithClient(client, userId, payload.referralCode);
      await ensureDefaultAssetFolders(client, userId);
      await client.query('UPDATE registration_verification_codes SET consumed_at = now() WHERE id = $1', [verification.id]);
      const profile = await getUserProfile(client, userId);
      if (!profile) return registrationFailure('用户创建失败', 500);
      return { ok: true as const, profile, authVersion: userResult.rows[0]!.auth_version };
    });

    if (!result.ok) {
      throw Object.assign(new Error(result.message), { statusCode: result.statusCode });
    }

    const profile = result.profile;
    void sendWelcomeEmail({
      userId: profile.id,
      email: profile.email,
      userName: profile.userName,
    });

    issueAuthSession(app, reply, {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      authVersion: result.authVersion,
    });
    return { user: profile };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const payload = endpointContracts.authLogin.body.parse(request.body);
    await enforceAuthRateLimit(request, {
      scope: 'login',
      identity: payload.email,
      maxAttempts: 8,
      ipMaxAttempts: 30,
      windowSeconds: 15 * 60,
    });
    const result = await pool.query<{
      id: string;
      email: string;
      role: 'user' | 'admin';
      status: string;
      password_hash: string;
      auth_version: number;
    }>(
      `SELECT id, email, role, status, password_hash, auth_version FROM users WHERE email = $1 LIMIT 1`,
      [payload.email],
    );
    const user = result.rows[0];

    if (!user || !(await verifyPassword(payload.password, user.password_hash))) {
      throw Object.assign(new Error('邮箱或密码错误'), { statusCode: 401 });
    }
    if (user.status === 'frozen') {
      throw Object.assign(new Error('账号已被冻结'), { statusCode: 403 });
    }

    await clearAuthAccountRateLimit(pool, 'login', payload.email);
    await pool.query('UPDATE users SET last_active_at = now() WHERE id = $1', [user.id]);
    await reconcileSubscription(user.id);
    const profile = await getUserProfile(pool, user.id);
    if (!profile) {
      throw Object.assign(new Error('登录成功但用户资料缺失'), {
        statusCode: 500,
        code: 'API_RESPONSE_SCHEMA_MISMATCH',
      });
    }

    issueAuthSession(app, reply, {
      id: user.id,
      email: user.email,
      role: user.role,
      authVersion: user.auth_version,
    });
    return { user: profile };
  });

  app.post('/api/auth/forgot-password', async request => {
    const payload = endpointContracts.authForgotPassword.body.parse(request.body);
    await enforceAuthRateLimit(request, {
      scope: 'forgot-password',
      identity: payload.email,
      maxAttempts: 3,
      ipMaxAttempts: 10,
      windowSeconds: 30 * 60,
    });
    const userResult = await pool.query<{
      id: string;
      email: string;
      user_name: string;
      status: string;
    }>(
      `SELECT id, email, user_name, status FROM users WHERE email = $1 LIMIT 1`,
      [payload.email],
    );
    const user = userResult.rows[0];

    if (user && user.status !== 'frozen') {
      const resetToken = createPasswordResetToken();
      const resetTokenId = await withTransaction(async client => {
        await client.query(
          `UPDATE password_reset_tokens
           SET consumed_at = now()
           WHERE user_id = $1 AND consumed_at IS NULL`,
          [user.id],
        );
        const resetResult = await client.query<{ id: string }>(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, now() + ($3::text || ' minutes')::interval)
           RETURNING id`,
          [user.id, resetToken.hash, PASSWORD_RESET_TOKEN_TTL_MINUTES],
        );
        return resetResult.rows[0]!.id;
      });

      const resetUrl = new URL('/reset-password', resolveTrustedRequestAppOrigin(request));
      resetUrl.searchParams.set('token', resetToken.token);

      void sendPasswordResetEmail({
        userId: user.id,
        email: user.email,
        userName: user.user_name,
        resetUrl: resetUrl.toString(),
        expiresMinutes: PASSWORD_RESET_TOKEN_TTL_MINUTES,
        idempotencyKey: resetTokenId,
      });
    }

    return { ok: true };
  });

  app.post('/api/auth/reset-password', async (request, reply) => {
    const payload = endpointContracts.authResetPassword.body.parse(request.body);
    await enforceAuthRateLimit(request, {
      scope: 'reset-password',
      maxAttempts: 10,
      ipMaxAttempts: 10,
      windowSeconds: 30 * 60,
    });
    const tokenHash = hashPasswordResetToken(payload.token);
    const candidateResult = await pool.query<{ user_id: string; status: string }>(
      `SELECT reset.user_id, users.status
       FROM password_reset_tokens reset
       JOIN users ON users.id = reset.user_id
       WHERE reset.token_hash = $1
         AND reset.consumed_at IS NULL
         AND reset.expires_at > now()
       LIMIT 1`,
      [tokenHash],
    );
    const candidate = candidateResult.rows[0];
    if (!candidate) {
      throw Object.assign(new Error('重置链接无效或已过期'), { statusCode: 400 });
    }
    if (candidate.status === 'frozen') {
      throw Object.assign(new Error('账号已被冻结'), { statusCode: 403 });
    }
    await enforceAuthRateLimit(request, {
      scope: 'reset-password',
      identity: candidate.user_id,
      maxAttempts: 5,
      includeIp: false,
      windowSeconds: 30 * 60,
    });
    const passwordHash = await hashPassword(payload.password);

    await withTransaction(async client => {
      const resetResult = await client.query<{
        id: string;
        user_id: string;
        status: string;
      }>(
        `SELECT reset.id, reset.user_id, users.status
         FROM password_reset_tokens reset
         JOIN users ON users.id = reset.user_id
         WHERE reset.token_hash = $1
           AND reset.consumed_at IS NULL
           AND reset.expires_at > now()
         LIMIT 1
         FOR UPDATE`,
        [tokenHash],
      );
      const resetRecord = resetResult.rows[0];
      if (!resetRecord) {
        throw Object.assign(new Error('重置链接无效或已过期'), { statusCode: 400 });
      }
      if (resetRecord.status === 'frozen') {
        throw Object.assign(new Error('账号已被冻结'), { statusCode: 403 });
      }

      await client.query(
        `UPDATE users
         SET password_hash = $1,
             auth_version = auth_version + 1,
             updated_at = now(),
             last_active_at = now()
         WHERE id = $2`,
        [passwordHash, resetRecord.user_id],
      );
      await client.query(
        `UPDATE password_reset_tokens
         SET consumed_at = now()
         WHERE user_id = $1 AND consumed_at IS NULL`,
        [resetRecord.user_id],
      );
    });

    // 当前浏览器可能仍带有旧版本 Cookie；成功重置后立即清除，避免留下必然
    // 失败的陈旧会话。用户需使用新密码重新登录。
    clearAuthSession(reply);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    clearAuthSession(reply);
    return { ok: true };
  });

  // 退出所有设备：递增 auth_version 让所有已签发的会话与 MCP 连接失效，再清掉当前 Cookie。
  app.post('/api/auth/logout-all', async (request, reply) => {
    const user = await requireAuth(request);
    await pool.query('UPDATE users SET auth_version = auth_version + 1, updated_at = now() WHERE id = $1', [user.id]);
    clearAuthSession(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async request => {
    const user = await requireAuth(request);
    await reconcileSubscription(user.id);
    const profile = await getUserProfile(pool, user.id);
    if (!profile) throw Object.assign(new Error('未找到当前用户'), { statusCode: 404 });

    return { user: profile };
  });
}

function registrationFailure(message: string, statusCode: number) {
  return { ok: false as const, message, statusCode };
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
