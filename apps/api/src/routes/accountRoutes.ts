import type { FastifyInstance } from 'fastify';
import { endpointContracts } from '@lindyson/api-contracts';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { issueAuthSession, requireAuth } from '../auth/session.js';
import { pool, withReadOnlyRepeatableRead, withTransaction } from '../db/pool.js';
import { mapUserCreditLedgerRow, type CreditLedgerRow } from '../domain/creditLedger.js';
import { readFeatureFlags } from '../domain/featureFlags.js';
import { getUserDashboardSummary } from '../domain/dashboardSummary.js';
import {
  createExactCursorPage,
  exactPageMetadataColumns,
  fourWayCursorCondition,
  fourWayCursorValues,
  fourWayPageOrderBy,
  materializeExactCursorPageQuery,
  parseExactCursorPageRequest,
  readUserPaginationVersion,
  type ExactPageMetadata,
} from '../domain/cursorPagination.js';
import { getUserProfile } from '../domain/users.js';
import { reconcileSubscription } from '../domain/subscriptionLifecycle.js';

export async function registerAccountRoutes(app: FastifyInstance) {
  app.get('/api/account/feature-flags', async request => {
    await requireAuth(request);
    return { flags: await readFeatureFlags(pool) };
  });

  app.get('/api/account/credits', async request => {
    const user = await requireAuth(request);
    await reconcileSubscription(user.id);
    const profile = await getUserProfile(pool, user.id);
    if (!profile) throw Object.assign(new Error('未找到当前用户'), { statusCode: 404 });

    return {
      mainCredits: profile.mainCredits,
      addonCredits: profile.addonCredits,
      credits: profile.credits,
      totalCredits: profile.totalCredits,
      planResetAt: profile.planResetAt,
      planExpiresAt: profile.planExpiresAt,
    };
  });

  app.get('/api/account/dashboard-summary', async request => {
    const user = await requireAuth(request);
    return getUserDashboardSummary(pool, user.id);
  });

  app.get('/api/account/credit-ledger', async request => {
    const user = await requireAuth(request);
    const rawQuery = endpointContracts.accountCreditLedger.query.parse(request.query);
    const pageRequest = parseExactCursorPageRequest({
      ...rawQuery,
      resource: 'user-credit-ledger',
      filters: { userId: user.id, type: rawQuery.type ?? null },
      defaultLimit: 20,
      maxLimit: 50,
    });
    return withReadOnlyRepeatableRead(async client => {
      const versionScope = rawQuery.type
        ? `credit-ledger:type:${rawQuery.type}`
        : 'credit-ledger:all';
      const version = await readUserPaginationVersion(client, user.id, versionScope);
      const totalItems = pageRequest.snapshot
        ? undefined
        : (await client.query<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM credit_ledger
             WHERE user_id = $1 AND ($2::text IS NULL OR type = $2)`,
            [user.id, rawQuery.type ?? null],
          )).rows[0]?.count;
      const pageQuery = materializeExactCursorPageQuery(pageRequest, {
        resourceVersion: version.version,
        snapshotAt: version.snapshotAt,
        totalItems,
      });
      const result = await client.query<CreditLedgerRow & ExactPageMetadata>(
      `SELECT credit_ledger.*,
              ${exactPageMetadataColumns('created_at')}
       FROM credit_ledger
       WHERE user_id = $1
         AND ${fourWayCursorCondition(pageQuery, 'created_at', 'id', 2, 3)}
         AND ($4::text IS NULL OR type = $4)
       ORDER BY ${fourWayPageOrderBy(pageQuery, 'created_at', 'id')}
       LIMIT $5`,
      [
        user.id,
        ...fourWayCursorValues(pageQuery),
        rawQuery.type ?? null,
        pageQuery.limit + 1,
      ],
    );

      return createExactCursorPage({
        rows: result.rows,
        query: pageQuery,
        getId: item => item.id,
        map: mapUserCreditLedgerRow,
      });
    });
  });

  app.patch('/api/account/profile', async request => {
    const user = await requireAuth(request);
    const payload = endpointContracts.accountProfileUpdate.body.parse(request.body);

    if (payload.userName) {
      await pool.query('UPDATE users SET user_name = $2, updated_at = now() WHERE id = $1', [user.id, payload.userName]);
    }

    await reconcileSubscription(user.id);
    const profile = await getUserProfile(pool, user.id);
    if (!profile) throw Object.assign(new Error('未找到当前用户'), { statusCode: 404 });

    return { user: profile };
  });

  app.patch('/api/account/password', async (request, reply) => {
    const user = await requireAuth(request);
    const payload = endpointContracts.accountPasswordUpdate.body.parse(request.body);

    const session = await withTransaction(async client => {
      const result = await client.query<{
        email: string;
        role: 'user' | 'admin';
        status: 'active' | 'trial' | 'frozen';
        auth_version: number;
        password_hash: string;
      }>(
        `SELECT email, role, status, auth_version, password_hash
         FROM users
         WHERE id = $1
         FOR UPDATE`,
        [user.id],
      );
      const current = result.rows[0];
      if (!current) throw Object.assign(new Error('未找到当前用户'), { statusCode: 404 });
      if (current.status === 'frozen' || current.auth_version !== user.authVersion) {
        throw Object.assign(new Error('登录状态已失效，请重新登录'), {
          statusCode: 401,
          code: 'AUTH_SESSION_INVALID',
        });
      }
      if (!(await verifyPassword(payload.currentPassword, current.password_hash))) {
        throw Object.assign(new Error('当前密码不正确'), { statusCode: 400 });
      }

      const passwordHash = await hashPassword(payload.newPassword);
      const updated = await client.query<{
        email: string;
        role: 'user' | 'admin';
        auth_version: number;
      }>(
        `UPDATE users
         SET password_hash = $2,
             auth_version = auth_version + 1,
             last_active_at = now(),
             updated_at = now()
         WHERE id = $1
         RETURNING email, role, auth_version`,
        [user.id, passwordHash],
      );
      await client.query(
        `UPDATE password_reset_tokens
         SET consumed_at = now()
         WHERE user_id = $1 AND consumed_at IS NULL`,
        [user.id],
      );
      return updated.rows[0]!;
    });

    issueAuthSession(app, reply, {
      id: user.id,
      email: session.email,
      role: session.role,
      authVersion: session.auth_version,
    });
    const profile = await getUserProfile(pool, user.id);
    if (!profile) throw Object.assign(new Error('未找到当前用户'), { statusCode: 404 });
    return { user: profile };
  });
}
