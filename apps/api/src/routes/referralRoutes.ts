import type { FastifyInstance } from 'fastify';
import { endpointContracts } from '@lindyson/api-contracts';
import { requireAuth, requireAdmin } from '../auth/session.js';
import { enforceAuthRateLimit } from '../auth/rateLimit.js';
import { pool } from '../db/pool.js';
import { checkReferralCode, getReferralSummary, listReferrals, readReferralSettings, resolveReferralWithClient } from '../domain/referrals.js';
import { resolveAdminIdempotencyKey, runAdminIdempotentAction } from '../domain/adminIdempotency.js';

export async function registerReferralRoutes(app: FastifyInstance) {
  app.post('/api/public/referrals/check', async request => {
    const { code } = endpointContracts.referralCheck.body.parse(request.body);
    await enforceAuthRateLimit(request, { scope: 'referral-check', identity: request.ip, maxAttempts: 60, ipMaxAttempts: 60, windowSeconds: 60 });
    const valid = Boolean(await checkReferralCode(pool, code));
    return { valid, message: valid ? '邀请有效' : '邀请已失效或活动已关闭，可取消邀请后继续注册' };
  });
  app.get('/api/account/referrals/summary', async request => {
    const user = await requireAuth(request);
    return getReferralSummary(user.id);
  });
  app.get('/api/account/referrals', async request => {
    const user = await requireAuth(request);
    const query = endpointContracts.accountReferrals.query.parse(request.query);
    // 不允许用完整邮箱搜索脱敏记录，避免通过命中结果枚举被邀请人身份。
    return listReferrals({ ...query, search: undefined }, user.id);
  });
  app.get('/api/admin/referral-settings', async request => {
    await requireAdmin(request);
    return readReferralSettings();
  });
  app.get('/api/admin/referrals', async request => {
    await requireAdmin(request);
    return listReferrals(endpointContracts.adminReferrals.query.parse(request.query));
  });
  app.patch('/api/admin/referral-settings', async (request, reply) => {
    const admin = await requireAdmin(request);
    const body = endpointContracts.adminReferralSettingsUpdate.body.parse(request.body);
    const result = await runAdminIdempotentAction({ adminUserId: admin.id, action: 'referral-settings', target: 'referral-settings', body,
      idempotencyKey: resolveAdminIdempotencyKey({ headerKey: request.headers['idempotency-key'] }),
      responseSchema: endpointContracts.adminReferralSettingsUpdate.response,
      execute: async client => {
        await client.query('SELECT id FROM referral_settings WHERE id = 1 FOR UPDATE');
        const before = await readReferralSettings(client);
        await client.query('UPDATE referral_settings SET enabled = $1, inviter_credits = $2, invitee_credits = $3 WHERE id = 1', [body.enabled, body.inviterCredits, body.inviteeCredits]);
        await client.query(`INSERT INTO audit_logs(admin_user_id, admin_email, module, action, target, risk, ip, detail)
          VALUES ($1, $2, '邀约奖励', '规则修改', 'referral-settings', 'high', $3, $4)`,
          [admin.id, admin.email, request.ip, JSON.stringify({ before, after: body, reason: body.reason })]);
        return readReferralSettings(client);
      },
    });
    if (result.reused) reply.header('Idempotency-Replayed', 'true');
    return result.response;
  });
  app.post('/api/admin/referrals/:id/resolve', async (request, reply) => {
    const admin = await requireAdmin(request);
    const { id } = endpointContracts.adminReferralResolve.params.parse(request.params);
    const body = endpointContracts.adminReferralResolve.body.parse(request.body);
    const result = await runAdminIdempotentAction({ adminUserId: admin.id, action: 'referral-resolve', target: id, body,
      idempotencyKey: resolveAdminIdempotencyKey({ headerKey: request.headers['idempotency-key'] }), responseSchema: endpointContracts.adminReferralResolve.response,
      execute: async client => {
        await resolveReferralWithClient(client, id, body.action, body.reason);
        await client.query(`INSERT INTO audit_logs(admin_user_id, admin_email, module, action, target, risk, ip, detail)
          VALUES ($1, $2, '邀约奖励', $3, $4, 'high', $5, $6)`, [admin.id, admin.email, body.action === 'grant' ? '补发奖励' : '核对结案', id, request.ip, body.reason]);
        return { ok: true };
      },
    });
    if (result.reused) reply.header('Idempotency-Replayed', 'true');
    return result.response;
  });
}
