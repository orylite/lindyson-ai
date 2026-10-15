import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  withTransaction: vi.fn(),
  scheduleObjectDeletion: vi.fn(),
  scheduleSystemAssetDeletion: vi.fn(),
  getAsset: vi.fn(),
  deleteAsset: vi.fn(),
  deleteAssetGroup: vi.fn(),
  releaseGenerationLotsWithClient: vi.fn(),
  setUserAvailableCreditsWithClient: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: mocks.withTransaction,
}));
vi.mock('../src/domain/assetDeletionService.js', () => ({
  scheduleObjectDeletion: mocks.scheduleObjectDeletion,
  scheduleSystemAssetDeletion: mocks.scheduleSystemAssetDeletion,
}));
vi.mock('../src/providers/realPortraitProvider.js', () => ({
  getConfiguredRealPortraitProvider: () => ({
    getAsset: mocks.getAsset,
    deleteAsset: mocks.deleteAsset,
    deleteAssetGroup: mocks.deleteAssetGroup,
  }),
}));
vi.mock('../src/domain/generationCredits.js', () => ({
  releaseGenerationLotsWithClient: mocks.releaseGenerationLotsWithClient,
}));
vi.mock('../src/domain/financialCredits.js', () => ({
  setUserAvailableCreditsWithClient: mocks.setUserAvailableCreditsWithClient,
}));

import {
  enqueuePlanPortraitReconciliationWithClient,
  enqueuePortraitEntitlementReconcileWithClient,
  countUserActiveActors,
  portraitEntitlementsDecreased,
  processDuePortraitQuotaReconciliations,
  processPortraitEntitlementReconcileOutbox,
  processRealPortraitCapacityQueue,
  processExpiredRealPortraitAuthorizations,
  processExpiredRealPortraitVerificationSessions,
  processExpiredRealPortraitUploadSessions,
  processPendingRealPortraitAssets,
  processRealPortraitRemoteDeletions,
  readGlobalCapacity,
  requestPortraitTaskCancellationWithClient,
  scheduleExpiredRealPortraitUploadObjectDeletion,
} from '../src/domain/realPortraitReconciliation.js';

describe('真人人像异步权益协调', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scheduleObjectDeletion.mockResolvedValue(undefined);
    mocks.releaseGenerationLotsWithClient.mockResolvedValue({
      mainReturned: 10,
      addonReturned: 0,
      expiredAmount: 0,
    });
    mocks.setUserAvailableCreditsWithClient.mockResolvedValue({ balance: 100 });
  });

  it('套餐 ID 改变但结构化权益相同不会创建协调 outbox', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(result([planEntitlements('plan-old')]))
        .mockResolvedValueOnce(result([planEntitlements('plan-new')])),
    };

    await expect(enqueuePortraitEntitlementReconcileWithClient(client as never, {
      userId: 'user-1',
      eventKey: 'portrait-switch:user-1',
      reason: 'plan-switched',
      oldPlanId: 'plan-old',
      newPlanId: 'plan-new',
    })).resolves.toBe(false);

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('portrait_entitlement_reconcile_outbox')
    ))).toBe(false);
  });

  it('结构化权益下降只在当前事务写 outbox，不调用远端供应商', async () => {
    const client = {
      query: vi.fn(async (sql: unknown) => {
        const query = String(sql);
        if (query.includes('FROM plans')) {
          const call = client.query.mock.calls.filter(([value]) => String(value).includes('FROM plans')).length;
          return result([call === 1
            ? planEntitlements('plan-pro', { portrait_active_limit: 3 })
            : planEntitlements('plan-free', { portrait_active_limit: 1, portrait_assets_per_actor: 1 })]);
        }
        if (query.includes('INSERT INTO portrait_entitlement_reconcile_outbox')) return result([{ id: 'outbox-1' }]);
        throw new Error(`未预期查询：${query}`);
      }),
    };

    await expect(enqueuePortraitEntitlementReconcileWithClient(client as never, {
      userId: 'user-1',
      eventKey: 'portrait-payment:order-1',
      reason: 'main-plan-purchased',
      oldPlanId: 'plan-pro',
      newPlanId: 'plan-free',
    })).resolves.toBe(true);

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO portrait_entitlement_reconcile_outbox'),
      expect.arrayContaining(['user-1', 'portrait-payment:order-1', 'main-plan-purchased']),
    );
    expect(mocks.deleteAsset).not.toHaveBeenCalled();
    expect(mocks.deleteAssetGroup).not.toHaveBeenCalled();
  });

  it('任一结构化权益减少都被识别，包括无限档案降为有限档案', () => {
    const enterprise = snapshot({ profileLimit: null, activeLimit: 10, assetsPerActor: 2 });
    expect(portraitEntitlementsDecreased(enterprise, snapshot({ profileLimit: 5 }))).toBe(true);
    expect(portraitEntitlementsDecreased(snapshot(), snapshot({ activeLimit: 2 }))).toBe(true);
    expect(portraitEntitlementsDecreased(snapshot(), snapshot({ assetsPerActor: 1 }))).toBe(true);
    expect(portraitEntitlementsDecreased(snapshot(), snapshot({ enabled: false, profileLimit: 0, activeLimit: 0, assetsPerActor: 0 }))).toBe(true);
    expect(portraitEntitlementsDecreased(snapshot(), snapshot({ profileLimit: 8, activeLimit: 4 }))).toBe(false);
  });

  it('后台批量改权益使用单条 INSERT SELECT，并覆盖免费版 plan_id 为空用户', async () => {
    const client = { query: vi.fn().mockResolvedValue(result([{ id: 'outbox-1' }, { id: 'outbox-2' }])) };
    await expect(enqueuePlanPortraitReconciliationWithClient(client as never, {
      planId: 'free-plan',
      planCode: 'free',
      eventKeyPrefix: 'portrait-plan-update:action-1',
      reason: 'admin-plan-entitlements-updated',
      oldEntitlements: values({ activeLimit: 2 }),
      newEntitlements: values({ activeLimit: 1 }),
    })).resolves.toBe(2);

    const sql = String(client.query.mock.calls[0]?.[0]);
    expect(sql).toContain('INSERT INTO portrait_entitlement_reconcile_outbox');
    expect(sql).toContain('SELECT u.id');
    expect(sql).toContain("$7 = 'free' AND u.plan_id IS NULL");
  });

  it('超过 24 小时的上传对象只进入对象删除 outbox，由既有物理删除 worker 处理', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    const client = {
      query: vi.fn().mockResolvedValue(result([
        { object_key: 'real-portrait/user-1/upload-1.jpg' },
        { object_key: 'real-portrait/user-1/upload-2.jpg' },
      ])),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(scheduleExpiredRealPortraitUploadObjectDeletion(100, { now: () => now }))
      .resolves.toEqual({ scanned: 2, scheduled: 2 });

    expect(String(client.query.mock.calls[0]?.[0])).toContain("interval '24 hours'");
    expect(mocks.scheduleObjectDeletion).toHaveBeenNthCalledWith(
      1, client, 'real-portrait/user-1/upload-1.jpg', [], now,
    );
    expect(mocks.scheduleObjectDeletion).toHaveBeenNthCalledWith(
      2, client, 'real-portrait/user-1/upload-2.jpg', [], now,
    );
  });

  it('邀请或 H5 过期会释放预留并把档案恢复为可重新邀请状态', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    mocks.poolQuery.mockResolvedValue(result([{ id: 'invite-1' }]));
    const client = { query: vi.fn(async (sql: unknown, _values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT invite.id AS invite_id')) {
        return result([{
          invite_id: 'invite-1',
          invite_status: 'accepted',
          invite_expires_at: '2026-07-30T07:30:00.000Z',
          actor_id: 'actor-1',
          user_id: 'user-1',
          authorization_id: 'authorization-1',
          authorization_status: 'pending',
          consented_at: '2026-07-30T07:00:00.000Z',
          materialization_id: 'materialization-1',
          materialization_status: 'verifying',
          provider_group_id: null,
        }]);
      }
      if (query.includes('FROM real_portrait_verification_sessions') && query.includes('FOR UPDATE')) {
        return result([{
          id: 'session-1',
          status: 'invitation_ready',
          h5_expires_at: '2026-07-30T07:30:00.000Z',
        }]);
      }
      return result([]);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(processExpiredRealPortraitVerificationSessions(50, { now: () => now }))
      .resolves.toEqual({ scanned: 1, expired: 1, failed: 0 });

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some(sql => sql.includes("SET status = 'expired'")
      && sql.includes('accepted_at = NULL')
      && sql.includes('real_portrait_invites'))).toBe(true);
    expect(statements.some(sql => sql.includes("THEN 'rejected' ELSE 'expired'") && sql.includes('real_portrait_authorizations'))).toBe(true);
    expect(statements.some(sql => sql.includes("SET status = 'error'") && sql.includes('real_portrait_materializations'))).toBe(true);
    expect(statements.some(sql => sql.includes("SET status = 'released'") && sql.includes('real_portrait_capacity_reservations'))).toBe(true);
    expect(statements.some(sql => sql.includes("SET status = 'cancelled'") && sql.includes('real_portrait_activation_queue'))).toBe(true);
    expect(statements.some(sql => sql.includes("SET lifecycle_status = 'expired'") && sql.includes('real_portrait_actors'))).toBe(true);
  });

  it('套餐降级只取消确定未提交任务，已提交任务保持原状态等待终态', async () => {
    const client = { query: vi.fn(async (sql: unknown, _values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('FROM generation_tasks task')) {
        return result([
          {
            id: 'task-queued', attempt: 0, status: 'queued', credit_status: 'held',
            reserved_credits: 10, main_credits_used: 10, addon_credits_used: 0,
            active_provider_run_id: 'run-prepared', provider_run_status: 'prepared',
          },
          {
            id: 'task-submitted', attempt: 0, status: 'processing', credit_status: 'held',
            reserved_credits: 10, main_credits_used: 10, addon_credits_used: 0,
            active_provider_run_id: 'run-submitted', provider_run_status: 'provider-running',
          },
        ]);
      }
      if (query.includes('SELECT status FROM generation_provider_runs')) {
        return result([{
          status: _values?.[0] === 'run-prepared' ? 'prepared' : 'provider-running',
        }]);
      }
      if (query.includes('UPDATE generation_provider_runs')) return result([{ id: 'run-prepared' }]);
      return result([]);
    }) };

    await requestPortraitTaskCancellationWithClient(
      client as never,
      'user-1',
      ['actor-over-quota'],
    );

    const taskUpdates = client.query.mock.calls.filter(([sql]) => (
      String(sql).includes('UPDATE generation_tasks')
    ));
    expect(taskUpdates).toHaveLength(1);
    expect(taskUpdates[0]?.[1]?.[0]).toBe('task-queued');
    expect(taskUpdates.some(([, values]) => values?.[0] === 'task-submitted')).toBe(false);
    expect(mocks.releaseGenerationLotsWithClient).toHaveBeenCalledOnce();
  });

  it('90 天授权到期只取消同一授权的未提交任务，已提交任务固定旧物化直到终态', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    mocks.poolQuery.mockResolvedValue(result([{ id: 'authorization-1' }]));
    const client = { query: vi.fn(async (sql: unknown, values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT portrait_authorization.id AS authorization_id')) {
        return result([expiredAuthorizationRow({ authorization_status: 'active' })]);
      }
      if (query.includes('FROM generation_tasks task')) {
        return result([
          pendingGenerationTask('task-unsubmitted', 'run-prepared', 'prepared', 'queued'),
          pendingGenerationTask('task-submitted', 'run-running', 'provider-running', 'processing'),
        ]);
      }
      if (query.includes('SELECT status FROM generation_provider_runs')) {
        return result([{ status: values?.[0] === 'run-prepared' ? 'prepared' : 'provider-running' }]);
      }
      if (query.includes('UPDATE generation_provider_runs')) return result([{ id: 'run-prepared' }]);
      if (query.includes('WHERE ref.authorization_id = $1 AND ref.materialization_id = $2')) {
        return result([{ exists: 1 }]);
      }
      return result([]);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(processExpiredRealPortraitAuthorizations(20, { now: () => now }))
      .resolves.toEqual({ scanned: 1, expired: 1, cleanupPending: 1, failed: 0 });

    const taskSelection = client.query.mock.calls.find(([sql]) => String(sql).includes('FROM generation_tasks task'));
    expect(taskSelection?.[1]?.[2]).toEqual(['authorization-1']);
    const taskUpdates = client.query.mock.calls.filter(([sql]) => String(sql).includes('UPDATE generation_tasks'));
    expect(taskUpdates).toHaveLength(1);
    expect(taskUpdates[0]?.[1]?.[0]).toBe('task-unsubmitted');
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes("SET lifecycle_status = 'expired'")
    ))).toBe(true);
    expect(client.query.mock.calls.some(([, values]) => values?.[4] === 'authorization_delete_asset')).toBe(false);
    expect(mocks.scheduleSystemAssetDeletion).not.toHaveBeenCalled();
  });

  it('旧授权清理遇到 CreateAsset 提交不确定时保持固定，不提前删除 Group，也不覆盖后续重认证状态', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    mocks.poolQuery.mockResolvedValue(result([{ id: 'authorization-1' }]));
    const client = { query: vi.fn(async (sql: unknown, _values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT portrait_authorization.id AS authorization_id')) {
        return result([expiredAuthorizationRow({ authorization_status: 'expired' })]);
      }
      if (query.includes('WHERE ref.authorization_id = $1 AND ref.materialization_id = $2')) return result([]);
      if (query.includes("operation.operation_type = 'create_asset'")) return result([{ exists: 1 }]);
      return result([]);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(processExpiredRealPortraitAuthorizations(20, { now: () => now }))
      .resolves.toEqual({ scanned: 1, expired: 0, cleanupPending: 1, failed: 0 });

    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('FROM real_portrait_assets'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("SET lifecycle_status = 'expired'"))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('authorization_delete_group'))).toBe(false);
  });

  it('持久素材轮询可把首次 Processing 的素材收敛为 Active', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    const { client, claim } = pendingAssetClient();
    mocks.withTransaction.mockImplementation(async callback => callback(client));
    mocks.poolQuery.mockResolvedValue(result([]));
    mocks.getAsset.mockResolvedValue(providerAsset(claim, 'Active'));

    await expect(processPendingRealPortraitAssets(5, {
      now: () => now,
      provider: { getAsset: mocks.getAsset } as never,
    })).resolves.toEqual({ claimed: 1, active: 1, processing: 0, failed: 0, timedOut: 0, retried: 0 });

    expect(mocks.getAsset).toHaveBeenCalledWith('provider-asset-1', 'default');
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes("SET status = 'active', consistency_status")
    ))).toBe(true);
    const lifecycleSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes('SELECT CASE') && sql.includes('AS next_status'));
    expect(lifecycleSql).toContain("kind = 'primary'");
    expect(lifecycleSql).toContain("consistency_status = 'passed'");
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes("SET status = 'consumed'")
    ))).toBe(true);
    expect(mocks.scheduleObjectDeletion).toHaveBeenCalledWith(
      client, 'real-portrait/upload-1.jpg', [], now,
    );
  });

  it('供应商素材 Failed 后自动排远端删除，失败状态仍由 remote_deleted_at 权威计数', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    const { client, claim } = pendingAssetClient();
    mocks.withTransaction.mockImplementation(async callback => callback(client));
    mocks.poolQuery.mockResolvedValue(result([]));
    mocks.getAsset.mockResolvedValue({
      ...providerAsset(claim, 'Failed'),
      errorCode: 'PROVIDER_REJECTED',
    });

    await expect(processPendingRealPortraitAssets(5, {
      now: () => now,
      provider: { getAsset: mocks.getAsset } as never,
    })).resolves.toEqual({ claimed: 1, active: 0, processing: 0, failed: 1, timedOut: 0, retried: 0 });

    const cleanupInsert = client.query.mock.calls.find(([, values]) => (
      values?.[4] === 'asset_processing_failed_delete_asset'
    ));
    expect(cleanupInsert).toBeTruthy();
    const deletingSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes("SET status = 'deleting', consistency_status"));
    expect(deletingSql).toContain('error_code = NULL');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'released'"))).toBe(true);
  });

  it('素材持续 Processing 超过 24 小时会终止并排远端删除', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    const { client, claim } = pendingAssetClient({
      operation_created_at: '2026-07-29T07:59:00.000Z',
    });
    mocks.withTransaction.mockImplementation(async callback => callback(client));
    mocks.poolQuery.mockResolvedValue(result([]));
    mocks.getAsset.mockResolvedValue(providerAsset(claim, 'Processing'));

    await expect(processPendingRealPortraitAssets(5, {
      now: () => now,
      provider: { getAsset: mocks.getAsset } as never,
    })).resolves.toEqual({ claimed: 1, active: 0, processing: 0, failed: 0, timedOut: 1, retried: 0 });

    expect(client.query.mock.calls.some(([, values]) => (
      values?.[4] === 'asset_processing_timeout_delete_asset'
    ))).toBe(true);
  });

  it('未超时 Processing 会写入可恢复的指数退避游标', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    const { client, claim } = pendingAssetClient();
    mocks.withTransaction.mockImplementation(async callback => callback(client));
    mocks.poolQuery.mockResolvedValue(result([]));
    mocks.getAsset.mockResolvedValue(providerAsset(claim, 'Processing'));

    await expect(processPendingRealPortraitAssets(5, {
      now: () => now,
      provider: { getAsset: mocks.getAsset } as never,
    })).resolves.toMatchObject({ claimed: 1, processing: 1 });

    const retry = mocks.poolQuery.mock.calls.find(([sql]) => String(sql).includes("SET status = 'submitted'"));
    expect(retry?.[1]?.[1]).toBeInstanceOf(Date);
    expect((retry?.[1]?.[1] as Date).getTime()).toBeGreaterThan(now.getTime());
  });

  it('过期等待上传会话释放空占位，但保留 processing/active 所需素材槽', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    let usageRead = 0;
    const client = { query: vi.fn(async (sql: unknown, _values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('FROM real_portrait_upload_sessions') && query.includes('FOR UPDATE SKIP LOCKED')) {
        return result([
          { id: 'upload-1', user_id: 'user-1', actor_id: 'actor-1', materialization_id: 'mat-1', object_key: null },
          { id: 'upload-2', user_id: 'user-1', actor_id: 'actor-1', materialization_id: 'mat-1', object_key: 'upload-2.jpg' },
        ]);
      }
      if (query.includes('AS has_remote_group')) {
        usageRead += 1;
        return result([{ has_remote_group: true, remote_assets: 1, pending_uploads: 1 }]);
      }
      return result([]);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(processExpiredRealPortraitUploadSessions(100, { now: () => now }))
      .resolves.toEqual({ scanned: 2, expired: 2, actorsReconciled: 1 });

    expect(usageRead).toBe(1);
    const resize = client.query.mock.calls.find(([sql]) => String(sql).includes('asset_slots = GREATEST'));
    expect(resize?.[1]).toEqual(['actor-1', 2]);
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes("SET status = 'released'") && String(sql).includes('capacity_reservations')
    ))).toBe(false);
    expect(mocks.scheduleObjectDeletion).toHaveBeenCalledWith(client, 'upload-2.jpg', [], now);
  });

  it('同一演员多个过期上传且没有有效素材时释放 Asset 预留', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    const client = { query: vi.fn(async (sql: unknown, _values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('FROM real_portrait_upload_sessions') && query.includes('FOR UPDATE SKIP LOCKED')) {
        return result([
          { id: 'upload-1', user_id: 'user-1', actor_id: 'actor-1', materialization_id: 'mat-1', object_key: null },
          { id: 'upload-2', user_id: 'user-1', actor_id: 'actor-1', materialization_id: 'mat-1', object_key: null },
        ]);
      }
      if (query.includes('AS has_remote_group')) {
        return result([{ has_remote_group: true, remote_assets: 0, pending_uploads: 0 }]);
      }
      return result([]);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(processExpiredRealPortraitUploadSessions(100, { now: () => now }))
      .resolves.toEqual({ scanned: 2, expired: 2, actorsReconciled: 1 });

    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes("SET status = 'released'") && String(sql).includes('capacity_reservations')
    ))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('asset_slots = GREATEST'))).toBe(false);
  });

  it('全局容量与用户活跃数均按未确认远端删除计数，不因 error/deleting 漏算', async () => {
    const capacityClient = { query: vi.fn().mockResolvedValue(result([{
      groups_used: 1, assets_used: 1, groups_reserved: 0, assets_reserved: 0,
    }])) };
    await expect(readGlobalCapacity(capacityClient as never)).resolves.toEqual({
      groupsUsed: 1, assetsUsed: 1, groupsReserved: 0, assetsReserved: 0,
    });
    const capacitySql = String(capacityClient.query.mock.calls[0]?.[0]);
    expect(capacitySql).toContain('provider_group_id IS NOT NULL AND remote_deleted_at IS NULL');
    expect(capacitySql).toContain('asset.provider_asset_id IS NOT NULL');
    expect(capacitySql).toContain('asset.remote_deleted_at IS NULL');

    const countClient = { query: vi.fn().mockResolvedValue(result([{ count: 4 }])) };
    await expect(countUserActiveActors(countClient as never, 'user-1', 'actor-current')).resolves.toBe(4);
    const countSql = String(countClient.query.mock.calls[0]?.[0]);
    expect(countSql).toContain("queue.status IN ('waiting', 'promoted')");
    expect(countSql).toContain("reservation.status = 'reserved'");
    expect(countSql).toContain("'eviction_warning'");
    expect(countSql).toContain('materialization.remote_deleted_at IS NULL');
  });

  it('远端删除确认后才写 remote_deleted_at，并清除 failed error_code 以满足约束', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    let claimRead = 0;
    const client = { query: vi.fn(async (sql: unknown, _values?: unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT operation.id, operation.user_id')) {
        claimRead += 1;
        return claimRead === 1 ? result([{
          id: 'delete-op-1', user_id: 'user-1', actor_id: 'actor-1', materialization_id: 'mat-1',
          portrait_asset_id: 'asset-1', operation_type: 'asset_processing_failed_delete_asset',
          attempt_count: 0, provider_asset_id: 'provider-asset-1', provider_group_id: 'group-1',
          project_name: 'default',
        }]) : result([]);
      }
      if (query.includes('RETURNING attempt_count')) return result([{ attempt_count: 1 }]);
      if (query.includes('SELECT status FROM real_portrait_remote_operations')) return result([{ status: 'submitting' }]);
      if (query.includes('SELECT actor_id, provider_group_id, status')) {
        return result([{ actor_id: 'actor-1', provider_group_id: 'group-1', status: 'awaiting_upload' }]);
      }
      return result([]);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));
    mocks.poolQuery.mockResolvedValue(result([]));
    mocks.deleteAsset.mockResolvedValue({ assetId: 'provider-asset-1', requestId: null });

    await expect(processRealPortraitRemoteDeletions(5, {
      now: () => now,
      provider: { deleteAsset: mocks.deleteAsset } as never,
    })).resolves.toEqual({ claimed: 1, completed: 1, failed: 0 });

    const deletedSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes("SET status = 'deleted'") && sql.includes('remote_deleted_at'));
    expect(deletedSql).toContain('error_code = NULL');
    const claimSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes('SELECT operation.id, operation.user_id'));
    expect(claimSql).toContain(
      "create_operation.status IN ('submitting', 'submission_unknown', 'manual_review')",
    );
  });

  it('保存宽限期选择不会令 reconciling 绕过 grace_until 提前进入远端清理', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    mocks.poolQuery.mockResolvedValue(result([]));
    await expect(processDuePortraitQuotaReconciliations(20, { now: () => now }))
      .resolves.toEqual({ scanned: 0, completed: 0, failed: 0 });
    const sql = String(mocks.poolQuery.mock.calls[0]?.[0]);
    expect(sql).toContain("grace_status IN ('active', 'reconciling')");
    expect(sql).toContain('AND grace_until <= $1');
    expect(mocks.deleteAsset).not.toHaveBeenCalled();
    expect(mocks.deleteAssetGroup).not.toHaveBeenCalled();
  });

  it('足额升级会终结套餐宽限，远端在飞清理由操作表独立追踪', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    const actor = quotaActor(ACTOR_ONE, { occupies_active_slot: true });
    const harness = quotaReconciliationClient({
      current: quotaState({
        source_plan_id: '10000000-0000-4000-8000-000000000001',
        portrait_enabled: true,
        profile_limit: 1,
        active_limit: 1,
        assets_per_actor: 1,
        grace_status: 'reconciling',
        grace_until: '2026-07-29T08:00:00.000Z',
        retained_actor_ids: [ACTOR_ONE],
        active_actor_ids: [ACTOR_ONE],
      }),
      next: resolvedQuota({
        sourcePlanId: '20000000-0000-4000-8000-000000000002',
        profileLimit: 5,
        activeLimit: 3,
        assetsPerActor: 2,
      }),
      actors: [actor],
      remoteCleanupInFlight: true,
    });
    mocks.poolQuery.mockResolvedValue(result([{ user_id: TEST_USER_ID }]));
    mocks.withTransaction.mockImplementation(async callback => callback(harness.client));

    await expect(processDuePortraitQuotaReconciliations(20, { now: () => now }))
      .resolves.toEqual({ scanned: 1, completed: 1, failed: 0 });

    expect(harness.quotaWrites).toHaveLength(1);
    expect(harness.quotaWrites[0]?.slice(6, 10)).toEqual(['none', null, '[]', '[]']);
    expect(harness.client.query.mock.calls.some(([sql]) => (
      String(sql).includes("SET plan_access_status = 'available'")
    ))).toBe(true);
    const restoredMaterializationSql = harness.client.query.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => (
        sql.includes('UPDATE real_portrait_materializations materialization')
        && sql.includes("SET status = 'active'")
      ));
    expect(restoredMaterializationSql).toContain("asset.kind = 'primary'");
    expect(restoredMaterializationSql).toContain("asset.consistency_status = 'passed'");
    const upgradeEvent = harness.client.query.mock.calls.find(([, values]) => (
      values?.[3] === 'quota.cleanup_cancelled_by_upgrade'
    ));
    expect(upgradeEvent?.[1]?.[4]).toBe(JSON.stringify({ remoteCleanupInFlight: true }));
    expect(harness.client.query.mock.calls.some(([, values]) => (
      Array.isArray(values) && values.includes('entitlement_delete_group')
    ))).toBe(false);
  });

  it('仍然超额的部分升级沿用原宽限截止时间，不重新获得七天', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    const originalGraceUntil = '2026-07-29T08:00:00.000Z';
    const actors = [
      quotaActor(ACTOR_ONE, { occupies_active_slot: true }),
      quotaActor(ACTOR_TWO, { occupies_active_slot: true }),
      quotaActor(ACTOR_THREE, { occupies_active_slot: true }),
    ];
    const harness = quotaReconciliationClient({
      current: quotaState({
        active_limit: 1,
        grace_status: 'active',
        grace_until: originalGraceUntil,
      }),
      next: resolvedQuota({ activeLimit: 2 }),
      actors,
    });
    mocks.poolQuery.mockResolvedValue(result([{ user_id: TEST_USER_ID }]));
    mocks.withTransaction.mockImplementation(async callback => callback(harness.client));

    await expect(processDuePortraitQuotaReconciliations(20, { now: () => now }))
      .resolves.toEqual({ scanned: 1, completed: 1, failed: 0 });

    expect(harness.quotaWrites).toHaveLength(1);
    expect(harness.quotaWrites[0]?.[7]).toBe(originalGraceUntil);
    expect(harness.quotaWrites[0]?.[9]).toBe(JSON.stringify([ACTOR_ONE, ACTOR_TWO]));
    expect(new Date(String(harness.quotaWrites[0]?.[7])).getTime()).toBeLessThan(now.getTime());
  });

  it('宽限已完成后的部分升级不重开宽限，并保留原选择后用新增额度补位', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    const originalGraceUntil = '2026-07-29T08:00:00.000Z';
    const actors = [
      quotaActor(ACTOR_ONE, { occupies_active_slot: true }),
      quotaActor(ACTOR_TWO, { occupies_active_slot: true }),
      quotaActor(ACTOR_THREE, { occupies_active_slot: true }),
    ];
    const harness = quotaReconciliationClient({
      current: quotaState({
        profile_limit: 1,
        active_limit: 1,
        grace_status: 'completed',
        grace_until: originalGraceUntil,
        retained_actor_ids: [ACTOR_THREE],
        active_actor_ids: [ACTOR_THREE],
      }),
      next: resolvedQuota({ profileLimit: 2, activeLimit: 2 }),
      actors,
    });
    const claim = {
      id: '30000000-0000-4000-8000-000000000003',
      user_id: TEST_USER_ID,
      event_key: 'partial-upgrade-after-completed',
      attempt_count: 0,
      old_entitlements: null,
    };
    const claimClient = { query: vi.fn(async (sql: unknown) => (
      String(sql).includes('RETURNING id, user_id, event_key') ? result([claim]) : result([claim])
    )) };
    mocks.poolQuery.mockResolvedValue(result([]));
    mocks.withTransaction
      .mockImplementationOnce(async callback => callback(claimClient))
      .mockImplementationOnce(async callback => callback(harness.client));

    await expect(processPortraitEntitlementReconcileOutbox(1, { now: () => now }))
      .resolves.toEqual({ claimed: 1, completed: 1, failed: 0 });

    expect(harness.quotaWrites).toHaveLength(1);
    expect(harness.quotaWrites[0]?.[7]).toBe(originalGraceUntil);
    expect(harness.quotaWrites[0]?.[8]).toBe(JSON.stringify([ACTOR_THREE, ACTOR_ONE]));
    expect(harness.quotaWrites[0]?.[9]).toBe(JSON.stringify([ACTOR_THREE, ACTOR_ONE]));
  });

  it('宽限到期按统一 active 口径复验用户选择并丢弃已不占槽演员', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    const actors = [
      quotaActor(ACTOR_ONE, { lifecycle_status: 'sync_error', occupies_active_slot: true }),
      quotaActor(ACTOR_TWO, { lifecycle_status: 'draft', occupies_active_slot: false }),
      quotaActor(ACTOR_THREE, { lifecycle_status: 'waiting', occupies_active_slot: true }),
    ];
    const harness = quotaReconciliationClient({
      current: quotaState({
        active_limit: 2,
        grace_status: 'reconciling',
        grace_until: '2026-07-29T08:00:00.000Z',
        retained_actor_ids: [ACTOR_ONE, ACTOR_TWO, ACTOR_THREE],
        active_actor_ids: [ACTOR_TWO, ACTOR_ONE],
      }),
      next: resolvedQuota({ activeLimit: 2 }),
      actors,
    });
    mocks.poolQuery.mockResolvedValue(result([{ user_id: TEST_USER_ID }]));
    mocks.withTransaction.mockImplementation(async callback => callback(harness.client));

    await expect(processDuePortraitQuotaReconciliations(20, { now: () => now }))
      .resolves.toEqual({ scanned: 1, completed: 1, failed: 0 });

    expect(harness.quotaWrites[0]?.[9]).toBe(JSON.stringify([ACTOR_ONE]));
    expect(harness.actorReadSql).toContain('provider_group_id IS NOT NULL');
    expect(harness.actorReadSql).toContain("reservation.status = 'reserved'");
    expect(harness.actorReadSql).toContain("queue.status IN ('waiting', 'promoted')");
    expect(harness.actorReadSql).toContain('AS occupies_active_slot');
  });

  it('真人权益关闭且宽限到期时，无 Group 的未决权威查单保持 verifying 并完成套餐收口', async () => {
    const now = new Date('2026-08-18T08:00:00.000Z');
    const harness = quotaReconciliationClient({
      current: quotaState({
        portrait_enabled: true,
        profile_limit: 1,
        active_limit: 1,
        assets_per_actor: 1,
        grace_status: 'active',
        grace_until: '2026-08-18T07:59:59.000Z',
      }),
      next: resolvedQuota({
        sourcePlanId: '20000000-0000-4000-8000-000000000002',
        enabled: false,
      }),
      actors: [quotaActor(ACTOR_ONE, {
        lifecycle_status: 'revoked',
        live_asset_count: 0,
        occupies_active_slot: true,
      })],
      cleanupMaterializations: {
        [ACTOR_ONE]: [{ id: MATERIALIZATION_ONE, provider_group_id: null }],
      },
      unresolvedMaterializationIds: [MATERIALIZATION_ONE],
    });
    mocks.poolQuery.mockResolvedValue(result([{ user_id: TEST_USER_ID }]));
    mocks.withTransaction.mockImplementation(async callback => callback(harness.client));

    await expect(processDuePortraitQuotaReconciliations(20, { now: () => now }))
      .resolves.toEqual({ scanned: 1, completed: 1, failed: 0 });

    expect(harness.quotaWrites[0]?.[6]).toBe('completed');
    expect(harness.unresolvedReadSql).toContain("operation.status <> 'completed'");
    expect(harness.unresolvedReadSql).toContain(
      "'prepared', 'submitting', 'invitation_ready', 'waiting', 'submission_unknown'",
    );
    expect(harness.unresolvedReadSql).toContain('asset.provider_asset_id IS NOT NULL');
    expect(harness.client.query.mock.calls.some(([sql, params]) => (
      String(sql).includes("SET status = 'deleting'") && params?.[0] === MATERIALIZATION_ONE
    ))).toBe(false);
    expect(harness.client.query.mock.calls.some(([sql, params]) => (
      String(sql).includes("SET status = 'error'") && params?.[0] === MATERIALIZATION_ONE
    ))).toBe(false);
    expect(harness.client.query.mock.calls.some(([sql]) => (
      String(sql).includes("SET plan_access_status = CASE")
    ))).toBe(true);
  });

  it('真人权益关闭且宽限到期时，无 Group 且无未决远端状态才以本地 error 收口', async () => {
    const now = new Date('2026-08-18T08:00:00.000Z');
    const harness = quotaReconciliationClient({
      current: quotaState({
        portrait_enabled: true,
        profile_limit: 1,
        active_limit: 1,
        assets_per_actor: 1,
        grace_status: 'active',
        grace_until: '2026-08-18T07:59:59.000Z',
      }),
      next: resolvedQuota({
        sourcePlanId: '20000000-0000-4000-8000-000000000002',
        enabled: false,
      }),
      actors: [quotaActor(ACTOR_ONE, {
        lifecycle_status: 'revoked',
        live_asset_count: 0,
        occupies_active_slot: true,
      })],
      cleanupMaterializations: {
        [ACTOR_ONE]: [{ id: MATERIALIZATION_ONE, provider_group_id: null }],
      },
    });
    mocks.poolQuery.mockResolvedValue(result([{ user_id: TEST_USER_ID }]));
    mocks.withTransaction.mockImplementation(async callback => callback(harness.client));

    await expect(processDuePortraitQuotaReconciliations(20, { now: () => now }))
      .resolves.toEqual({ scanned: 1, completed: 1, failed: 0 });

    const localTerminalSql = harness.client.query.mock.calls
      .find(([sql, params]) => (
        String(sql).includes("SET status = 'error'") && params?.[0] === MATERIALIZATION_ONE
      ))?.[0];
    expect(String(localTerminalSql)).toContain('remote_deleted_at = COALESCE(remote_deleted_at, now())');
    expect(harness.client.query.mock.calls.some(([sql, params]) => (
      String(sql).includes("SET status = 'deleting'") && params?.[0] === MATERIALIZATION_ONE
    ))).toBe(false);
    expect(harness.quotaWrites[0]?.[6]).toBe('completed');
  });

  it('套餐宽限清理只有已有 Group 的物化才进入 deleting 并安排幂等 Group 删除', async () => {
    const now = new Date('2026-08-18T08:00:00.000Z');
    const harness = quotaReconciliationClient({
      current: quotaState({
        portrait_enabled: true,
        profile_limit: 1,
        active_limit: 1,
        assets_per_actor: 1,
        grace_status: 'active',
        grace_until: '2026-08-18T07:59:59.000Z',
      }),
      next: resolvedQuota({
        sourcePlanId: '20000000-0000-4000-8000-000000000002',
        enabled: false,
      }),
      actors: [quotaActor(ACTOR_ONE)],
      cleanupMaterializations: {
        [ACTOR_ONE]: [{ id: MATERIALIZATION_ONE, provider_group_id: 'provider-group-1' }],
      },
      cleanupAssets: { [MATERIALIZATION_ONE]: [] },
    });
    mocks.poolQuery.mockResolvedValue(result([{ user_id: TEST_USER_ID }]));
    mocks.withTransaction.mockImplementation(async callback => callback(harness.client));

    await expect(processDuePortraitQuotaReconciliations(20, { now: () => now }))
      .resolves.toEqual({ scanned: 1, completed: 1, failed: 0 });

    expect(harness.client.query.mock.calls.some(([sql, params]) => (
      String(sql).includes("SET status = 'deleting'") && params?.[0] === MATERIALIZATION_ONE
    ))).toBe(true);
    expect(harness.client.query.mock.calls.some(([, params]) => (
      params?.[4] === 'entitlement_delete_group'
      && String(params?.[5]).includes(MATERIALIZATION_ONE)
    ))).toBe(true);
  });

  it('分钟退避参数显式转换为 int，真实 PostgreSQL 不依赖 unknown 参数推断', async () => {
    const client = { query: vi.fn().mockResolvedValue(result([])) };
    mocks.poolQuery.mockResolvedValue(result([]));
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(processPortraitEntitlementReconcileOutbox(1)).resolves.toEqual({
      claimed: 0, completed: 0, failed: 0,
    });
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain(
      "now() - ($1::int * interval '1 minute')",
    );

    mocks.poolQuery.mockClear();
    await expect(processRealPortraitRemoteDeletions(1)).resolves.toEqual({
      claimed: 0, completed: 0, failed: 0,
    });
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain(
      "now() - ($1::int * interval '1 minute')",
    );
  });

  it('容量队列每轮只取各用户队首，并把最近已提升用户排到后面', async () => {
    const client = { query: vi.fn().mockResolvedValue(result([])) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(processRealPortraitCapacityQueue(20, {
      now: () => new Date('2026-07-30T08:00:00.000Z'),
    })).resolves.toEqual({ scanned: 0, promoted: 0, cancelled: 0, waiting: 0 });

    const selectionSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes('SELECT queue.id, queue.user_id, queue.actor_id'));
    expect(selectionSql).toContain('earlier.user_id = queue.user_id');
    expect(selectionSql).toContain('(earlier.requested_at, earlier.id) < (queue.requested_at, queue.id)');
    expect(selectionSql).toContain('max(history.promoted_at)');
    expect(selectionSql).toContain('ASC NULLS FIRST');
  });

  it('promoted 预留过期会恢复 waiting，plan_locked promoted 会取消并释放预留', async () => {
    let cancelled = false;
    let restored = false;
    const client = { query: vi.fn(async (sql: unknown, _values?: unknown[]) => {
      const query = String(sql);
      if (query.includes("SET status = 'cancelled'") && query.includes("queue.status = 'promoted'")) {
        cancelled = true;
        return result([{ reservation_id: 'reservation-locked' }]);
      }
      if (query.includes("SET status = 'waiting', reservation_id = NULL")) {
        restored = true;
        return result([{ id: 'queue-expired' }]);
      }
      if (query.includes('SELECT queue.id, queue.user_id, queue.actor_id')) return result([]);
      return result([]);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(processRealPortraitCapacityQueue(20, {
      now: () => new Date('2026-07-30T08:00:00.000Z'),
    })).resolves.toEqual({ scanned: 0, promoted: 0, cancelled: 1, waiting: 1 });

    expect(cancelled).toBe(true);
    expect(restored).toBe(true);
    expect(client.query.mock.calls.some(([sql, values]) => (
      String(sql).includes("status IN ('reserved', 'expired')")
      && Array.isArray(values?.[0])
      && values[0].includes('reservation-locked')
    ))).toBe(true);
  });
});

function planEntitlements(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    portrait_enabled: true,
    portrait_profile_limit: 5,
    portrait_active_limit: 3,
    portrait_assets_per_actor: 2,
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    sourcePlanId: 'plan-1',
    enabled: true,
    profileLimit: 5,
    activeLimit: 3,
    assetsPerActor: 2,
    ...overrides,
  } as Parameters<typeof portraitEntitlementsDecreased>[0];
}

function values(overrides: Record<string, unknown> = {}) {
  return {
    portraitEnabled: true,
    portraitProfileLimit: 5,
    portraitActiveLimit: 3,
    portraitAssetsPerActor: 2,
    ...('activeLimit' in overrides ? { portraitActiveLimit: overrides.activeLimit } : {}),
    ...overrides,
  } as never;
}

function result<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}

function expiredAuthorizationRow(overrides: Record<string, unknown> = {}) {
  return {
    authorization_id: 'authorization-1',
    authorization_status: 'active',
    valid_until: '2026-07-30T07:00:00.000Z',
    actor_id: 'actor-1',
    user_id: 'user-1',
    materialization_id: 'materialization-1',
    materialization_status: 'active',
    provider_group_id: 'provider-group-1',
    remote_deleted_at: null,
    ...overrides,
  };
}

function pendingGenerationTask(
  id: string,
  runId: string,
  runStatus: string,
  status: 'queued' | 'processing',
) {
  return {
    id,
    attempt: 0,
    status,
    credit_status: 'held',
    reserved_credits: 10,
    main_credits_used: 10,
    addon_credits_used: 0,
    active_provider_run_id: runId,
    provider_run_status: runStatus,
  };
}

function pendingAssetClient(overrides: Record<string, unknown> = {}) {
  const claim = {
    operation_id: 'create-operation-1',
    user_id: 'user-1',
    actor_id: 'actor-1',
    authorization_id: 'authorization-1',
    materialization_id: 'materialization-1',
    portrait_asset_id: 'asset-1',
    provider_asset_id: 'provider-asset-1',
    provider_group_id: 'provider-group-1',
    project_name: 'default',
    attempt_count: 1,
    operation_created_at: '2026-07-30T07:00:00.000Z',
    ...overrides,
  };
  let claimRead = 0;
  const client = { query: vi.fn(async (sql: unknown, _values?: unknown[]) => {
    const query = String(sql);
    if (query.includes('SELECT operation.id AS operation_id')) {
      claimRead += 1;
      return claimRead === 1 ? result([claim]) : result([]);
    }
    if (query.includes("SET status = 'submitting', attempt_count = attempt_count + 1")) {
      return result([{ attempt_count: 2 }]);
    }
    if (query.includes('SELECT operation.status AS operation_status')) {
      return result([{
        operation_status: 'submitting',
        asset_status: 'processing',
        authorization_status: 'active',
        valid_until: '2026-08-30T08:00:00.000Z',
        materialization_status: 'processing',
      }]);
    }
    if (query.includes('SELECT object_key')) {
      return result([{ object_key: 'real-portrait/upload-1.jpg' }]);
    }
    if (query.includes('SELECT CASE') && query.includes('AS next_status')) {
      return result([{ next_status: 'active' }]);
    }
    return result([]);
  }) };
  return { client, claim };
}

function providerAsset(
  claim: ReturnType<typeof pendingAssetClient>['claim'],
  status: 'Active' | 'Processing' | 'Failed',
) {
  return {
    id: claim.provider_asset_id,
    name: 'portrait',
    sourceUrl: 'https://example.invalid/portrait.jpg',
    assetType: 'Image',
    groupId: claim.provider_group_id,
    status,
    projectName: claim.project_name,
    errorCode: null,
    errorMessage: null,
    requestId: null,
  };
}

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001';
const ACTOR_ONE = '00000000-0000-4000-8000-000000000011';
const ACTOR_TWO = '00000000-0000-4000-8000-000000000012';
const ACTOR_THREE = '00000000-0000-4000-8000-000000000013';
const MATERIALIZATION_ONE = '00000000-0000-4000-8000-000000000021';

function quotaState(overrides: Record<string, unknown> = {}) {
  return {
    user_id: TEST_USER_ID,
    source_plan_id: '10000000-0000-4000-8000-000000000001',
    portrait_enabled: true,
    profile_limit: 5,
    active_limit: 3,
    assets_per_actor: 2,
    grace_status: 'active',
    grace_until: '2026-07-31T08:00:00.000Z',
    retained_actor_ids: [],
    active_actor_ids: [],
    ...overrides,
  };
}

function resolvedQuota(overrides: Record<string, unknown> = {}) {
  const sourcePlanId = String(overrides.sourcePlanId ?? '10000000-0000-4000-8000-000000000001');
  const enabled = overrides.enabled === undefined ? true : Boolean(overrides.enabled);
  const profileLimit = overrides.profileLimit ?? (enabled ? 5 : 0);
  const activeLimit = overrides.activeLimit ?? (enabled ? 3 : 0);
  const assetsPerActor = overrides.assetsPerActor ?? (enabled ? 2 : 0);
  return {
    user_id: TEST_USER_ID,
    assigned_plan_id: sourcePlanId,
    source_plan_id: sourcePlanId,
    source_plan_code: 'test-main',
    source_plan_name: '测试主套餐',
    source_plan_kind: 'main',
    portrait_enabled: enabled,
    portrait_profile_limit: profileLimit,
    portrait_active_limit: activeLimit,
    portrait_assets_per_actor: assetsPerActor,
  };
}

function quotaActor(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    lifecycle_status: 'active',
    last_successful_generation_at: null,
    created_at: '2026-07-01T08:00:00.000Z',
    live_asset_count: 1,
    occupies_active_slot: true,
    ...overrides,
  };
}

function quotaReconciliationClient(input: {
  current: ReturnType<typeof quotaState>;
  next: ReturnType<typeof resolvedQuota>;
  actors: ReturnType<typeof quotaActor>[];
  remoteCleanupInFlight?: boolean;
  cleanupMaterializations?: Record<string, Array<{
    id: string;
    provider_group_id: string | null;
  }>>;
  cleanupAssets?: Record<string, Array<{
    id: string;
    provider_asset_id: string | null;
  }>>;
  unresolvedMaterializationIds?: string[];
}) {
  const quotaWrites: unknown[][] = [];
  let actorReadSql = '';
  let unresolvedReadSql = '';
  const client = { query: vi.fn(async (sql: unknown, values?: unknown[]) => {
    const query = String(sql);
    if (query.includes('SELECT status FROM portrait_entitlement_reconcile_outbox')) {
      return result([{ status: 'processing' }]);
    }
    if (query.includes('SELECT id FROM users WHERE id = $1 FOR UPDATE')) {
      return result([{ id: TEST_USER_ID }]);
    }
    if (query.includes('assigned_plan_id') && query.includes('source_plan_kind')) {
      return result([input.next]);
    }
    if (query.includes('SELECT * FROM user_portrait_quota_states')) {
      return result([input.current]);
    }
    if (query.includes('SELECT a.id, a.lifecycle_status')) {
      actorReadSql = query;
      return result(input.actors);
    }
    if (query.includes('SELECT id, provider_group_id')
        && query.includes('FROM real_portrait_materializations')) {
      return result(input.cleanupMaterializations?.[String(values?.[0])] ?? []);
    }
    if (query.includes('SELECT id, provider_asset_id')
        && query.includes('FROM real_portrait_assets')) {
      return result(input.cleanupAssets?.[String(values?.[0])] ?? []);
    }
    if (query.includes('WHERE EXISTS (')
        && query.includes('real_portrait_verification_sessions verification_session')) {
      unresolvedReadSql = query;
      return input.unresolvedMaterializationIds?.includes(String(values?.[0]))
        ? result([{ exists: 1 }])
        : result([]);
    }
    if (query.includes("operation_type LIKE 'entitlement_%'")
        && query.includes("status IN ('submitting', 'submitted', 'submission_unknown', 'manual_review')")) {
      return input.remoteCleanupInFlight ? result([{ exists: 1 }]) : result([]);
    }
    if (query.includes('INSERT INTO user_portrait_quota_states')) {
      quotaWrites.push([...(values ?? [])]);
      return result([]);
    }
    return result([]);
  }) };
  return {
    client,
    quotaWrites,
    get actorReadSql() { return actorReadSql; },
    get unresolvedReadSql() { return unresolvedReadSql; },
  };
}
