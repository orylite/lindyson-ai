import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  withTransaction: vi.fn(),
  reconcileSubscriptionWithClient: vi.fn(),
  getPortraitEntitlementsForUser: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: mocks.withTransaction,
}));
vi.mock('../src/domain/subscriptionLifecycle.js', () => ({
  reconcileSubscriptionWithClient: mocks.reconcileSubscriptionWithClient,
}));
vi.mock('../src/domain/portraitEntitlements.js', () => ({
  getPortraitEntitlementsForUser: mocks.getPortraitEntitlementsForUser,
}));
vi.mock('../src/storage/storageService.js', () => ({
  createObjectReadUrl: vi.fn(),
  createUploadSignature: vi.fn(),
  getStoredObjectSize: vi.fn(),
  openStoredObjectStream: vi.fn(),
}));
vi.mock('../src/domain/assetDeletionService.js', () => ({
  scheduleObjectDeletion: vi.fn(),
  scheduleSystemAssetDeletion: vi.fn(),
}));
vi.mock('../src/domain/realPortraitSecrets.js', () => ({
  createRealPortraitBearerToken: () => 'callback-nonce',
  decryptRealPortraitSecret: vi.fn(),
  encryptRealPortraitSecret: vi.fn(),
  fingerprintRealPortraitSecret: (value: string) => `fingerprint:${value}`,
}));

import type { RealPortraitProvider } from '../src/providers/realPortraitProvider.js';
import {
  deleteRealPortraitActor,
  getRealPortraitCapacity,
  processPendingAmbiguousRealPortraitAssetSubmissions,
} from '../src/domain/realPortraitService.js';
import { processRealPortraitRemoteDeletions } from '../src/domain/realPortraitReconciliation.js';

describe('套餐锁定真人档案软删除', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcileSubscriptionWithClient.mockResolvedValue(undefined);
    mocks.getPortraitEntitlementsForUser.mockResolvedValue({
      sourcePlanId: 'plan-pro',
      sourcePlanCode: 'pro',
      sourcePlanName: '专业版',
      portraitEnabled: true,
      portraitProfileLimit: 5,
      portraitActiveLimit: 3,
      portraitAssetsPerActor: 2,
    });
  });

  it.each([
    { lifecycleStatus: 'revoked', authorizationStatus: 'revoked', cleanupCase: '清理仍在进行' },
    { lifecycleStatus: 'sync_error', authorizationStatus: 'revoked', cleanupCase: '清理已经失败' },
    { lifecycleStatus: 'expired', authorizationStatus: 'expired', cleanupCase: '授权已终止' },
  ])(
    'plan_locked + $lifecycleStatus 时即使$cleanupCase也立即本地脱敏，不改远端资源和清理操作',
    async ({ lifecycleStatus, authorizationStatus }) => {
      const client = createDeleteClient({
        lifecycleStatus,
        authorizationStatus,
        consentedAt: '2026-07-30T08:00:00.000Z',
        hasRemoteResource: true,
        hasUnsettledRemoteOperation: true,
      });
      mocks.withTransaction.mockImplementation(async callback => callback(client));

      await expect(deleteRealPortraitActor('user-1', 'actor-1'))
        .resolves.toEqual({ deleted: true });

      const sql = client.query.mock.calls.map(([query]) => String(query));
      const actorLockSql = sql.find(query => query.includes('SELECT a.lifecycle_status'));
      expect(actorLockSql).toContain('a.deleted_at IS NULL');
      expect(sql.some(query => (
        query.includes('UPDATE real_portrait_actors')
        && query.includes('deleted_at = now()')
        && query.includes("alias = '已删除演员'")
      ))).toBe(true);
      expect(sql.some(query => (
        query.includes('UPDATE real_portrait_materializations')
        && query.includes("SET status = 'deleting'")
        && query.includes('remote_deleted_at IS NULL')
      ))).toBe(true);
      expect(sql.some(query => /UPDATE real_portrait_(assets|remote_operations)/.test(query))).toBe(false);
      expect(sql.some(query => (
        query.includes("'actor_delete_group', 'prepared'")
        && query.includes("existing.status <> 'completed'")
      ))).toBe(true);
      if (authorizationStatus === 'expired') {
        expect(sql.some(query => (
          query.includes('UPDATE real_portrait_authorizations')
          && query.includes("status = 'revoked'")
          && query.includes("revoke_reason_code = 'actor-deleted'")
        ))).toBe(true);
      }
      expect(sql.some(query => /^DELETE\s/i.test(query.trim()))).toBe(false);
    },
  );

  it('plan_locked + active 授权一次点击内先撤回授权、取消未提交任务，再软删除', async () => {
    const client = createDeleteClient({
      lifecycleStatus: 'deleting',
      authorizationStatus: 'active',
      consentedAt: '2026-07-30T08:00:00.000Z',
      hasRemoteResource: true,
      hasUnsettledRemoteOperation: true,
    });
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(deleteRealPortraitActor('user-1', 'actor-1'))
      .resolves.toEqual({ deleted: true });

    const sql = client.query.mock.calls.map(([query]) => String(query));
    expect(sql.some(query => (
      query.includes('UPDATE real_portrait_authorizations')
      && query.includes("status = 'revoked'")
      && query.includes("revoke_source = 'owner'")
      && query.includes("revoke_reason_code = 'actor-deleted'")
    ))).toBe(true);
    expect(sql.some(query => query.includes('FROM generation_tasks task'))).toBe(true);
    expect(sql.some(query => (
      query.includes("'actor_delete_group', 'prepared'")
      && query.includes("existing.operation_type LIKE '%delete%group%'")
    ))).toBe(true);
    expect(sql.some(query => (
      query.includes('UPDATE real_portrait_actors') && query.includes('deleted_at = now()')
    ))).toBe(true);
  });

  it('plan_locked + 已提交 processing 生成时档案立即软删，但远端清理保持 pinned', async () => {
    const provider = fakeProvider();
    const deleteClient = createDeleteClient({
      lifecycleStatus: 'deleting',
      authorizationStatus: 'active',
      consentedAt: '2026-07-30T08:00:00.000Z',
      hasRemoteResource: true,
      hasUnsettledRemoteOperation: true,
      submittedProcessingTask: true,
    });
    mocks.withTransaction.mockImplementation(async callback => callback(deleteClient));

    await expect(deleteRealPortraitActor('user-1', 'actor-1'))
      .resolves.toEqual({ deleted: true });

    const deleteSql = deleteClient.query.mock.calls.map(([query]) => String(query));
    expect(deleteSql.some(query => (
      query.includes('UPDATE real_portrait_actors') && query.includes('deleted_at = now()')
    ))).toBe(true);
    expect(deleteSql.some(query => query.includes("'actor_delete_group', 'prepared'"))).toBe(true);
    expect(deleteSql.some(query => query.includes('UPDATE generation_tasks'))).toBe(false);

    const workerClient = {
      query: vi.fn(async (sql: unknown) => {
        const query = String(sql);
        if (query.includes('SELECT operation.id, operation.user_id')) return result([]);
        return result([]);
      }),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(workerClient));
    mocks.poolQuery.mockResolvedValue(result([]));

    await expect(processRealPortraitRemoteDeletions(1, { provider }))
      .resolves.toEqual({ claimed: 0, completed: 0, failed: 0 });

    expect(provider.deleteAssetGroup).not.toHaveBeenCalled();
    const claimSql = workerClient.query.mock.calls
      .map(([query]) => String(query))
      .find(query => query.includes('SELECT operation.id, operation.user_id'));
    expect(claimSql).toContain('JOIN real_portrait_actors actor ON actor.id = operation.actor_id');
    expect(claimSql).toContain('FROM generation_real_portrait_references reference');
    expect(claimSql).toContain('reference.actor_id = operation.actor_id');
    expect(claimSql).toContain("task.status IN ('queued', 'processing')");
    expect(claimSql).toContain('FOR UPDATE OF operation, actor SKIP LOCKED');
  });

  it('plan_locked 的未同意授权在同一事务内 rejected 并取消邀请', async () => {
    const client = createDeleteClient({
      lifecycleStatus: 'invited',
      authorizationStatus: 'draft',
      consentedAt: null,
      hasRemoteResource: false,
      hasUnsettledRemoteOperation: false,
    });
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(deleteRealPortraitActor('user-1', 'actor-1'))
      .resolves.toEqual({ deleted: true });

    const sql = client.query.mock.calls.map(([query]) => String(query));
    expect(sql.some(query => (
      query.includes('UPDATE real_portrait_authorizations') && query.includes("status = 'rejected'")
    ))).toBe(true);
    expect(sql.some(query => (
      query.includes('UPDATE real_portrait_invites')
      && query.includes("status = 'cancelled'")
      && query.includes('accepted_at = NULL')
    ))).toBe(true);
  });

  it('未锁定档案的 active 授权仍必须走显式撤回流程', async () => {
    const client = createDeleteClient({
      lifecycleStatus: 'active',
      planAccessStatus: 'available',
      authorizationStatus: 'active',
      consentedAt: '2026-07-30T08:00:00.000Z',
      hasRemoteResource: true,
      hasUnsettledRemoteOperation: false,
    });
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(deleteRealPortraitActor('user-1', 'actor-1')).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_REVOKE_REQUIRED',
      statusCode: 409,
    });
  });

  it('未锁定但已撤回的档案不会被仍在重试的验证查单阻塞软删除', async () => {
    const client = createDeleteClient({
      lifecycleStatus: 'revoked',
      planAccessStatus: 'available',
      authorizationStatus: 'revoked',
      consentedAt: '2026-07-31T07:00:00.000Z',
      hasRemoteResource: false,
      hasUnsettledRemoteOperation: true,
    });
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(deleteRealPortraitActor('user-1', 'actor-1'))
      .resolves.toEqual({ deleted: true });

    const sql = client.query.mock.calls.map(([query]) => String(query));
    expect(sql.some(query => (
      query.includes('UPDATE real_portrait_actors')
      && query.includes('deleted_at = now()')
      && query.includes("alias = '已删除演员'")
    ))).toBe(true);
    expect(sql.some(query => query.includes('FROM generation_tasks task'))).toBe(true);
    expect(sql.some(query => (
      query.includes('UPDATE real_portrait_remote_operations')
      && query.includes("operation_type = 'get_visual_validation_result'")
    ))).toBe(false);
  });

  it('tombstone 不占 profile，但未确认删除的远端 ID 仍计入全局容量', async () => {
    const quotaState = {
      source_plan_id: 'plan-pro',
      portrait_enabled: true,
      profile_limit: 5,
      active_limit: 3,
      assets_per_actor: 2,
      grace_status: 'none',
      grace_until: null,
      retained_actor_ids: [],
      active_actor_ids: [],
    };
    const client = {
      query: vi.fn(async (sql: unknown) => {
        const query = String(sql);
        if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
        if (query.includes('FROM user_portrait_quota_states')) return result([quotaState]);
        if (query.includes('WITH remote_group_slots AS') && query.includes('AS profiles')) {
          return result([{
            profiles: 0,
            active: 0,
            queued: 0,
            groups_used: 1,
            assets_used: 2,
            groups_reserved: 0,
            assets_reserved: 0,
          }]);
        }
        throw new Error(`未预期查询：${query}`);
      }),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    const capacity = await getRealPortraitCapacity('user-1');

    expect(capacity.usage.profiles).toBe(0);
    expect(capacity.global.groupsUsed).toBe(1);
    expect(capacity.global.assetsUsed).toBe(2);
    const capacitySql = client.query.mock.calls
      .map(([query]) => String(query))
      .find(query => query.includes('WITH remote_group_slots AS') && query.includes('AS profiles'));
    expect(capacitySql).toContain('WHERE user_id = $1 AND deleted_at IS NULL');
    expect(capacitySql).toContain('provider_group_id IS NOT NULL AND remote_deleted_at IS NULL');
    expect(capacitySql).toContain('asset.provider_asset_id IS NOT NULL AND asset.remote_deleted_at IS NULL');
  });

  it('actor 已软删除不会阻止 worker claim 并继续完成远端删除', async () => {
    const provider = fakeProvider();
    let claimCount = 0;
    const client = {
      query: vi.fn(async (sql: unknown) => {
        const query = String(sql);
        if (query.includes('SELECT operation.id, operation.user_id')) {
          claimCount += 1;
          return claimCount === 1
            ? result([{
              id: 'operation-1',
              user_id: 'user-1',
              actor_id: 'actor-1',
              materialization_id: 'materialization-1',
              portrait_asset_id: null,
              operation_type: 'entitlement_delete_group',
              attempt_count: 1,
              provider_asset_id: null,
              provider_group_id: 'provider-group-1',
              project_name: 'default',
            }])
            : result([]);
        }
        if (query.includes('RETURNING attempt_count')) return result([{ attempt_count: 2 }]);
        if (query.includes('SELECT status FROM real_portrait_remote_operations')) {
          return result([{ status: 'submitting' }]);
        }
        return result([]);
      }),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(client));
    mocks.poolQuery.mockResolvedValue(result([]));

    await expect(processRealPortraitRemoteDeletions(2, { provider }))
      .resolves.toEqual({ claimed: 1, completed: 1, failed: 0 });

    expect(provider.deleteAssetGroup).toHaveBeenCalledWith('provider-group-1', 'default');
    const claimSql = client.query.mock.calls
      .map(([query]) => String(query))
      .find(query => query.includes('SELECT operation.id, operation.user_id'));
    expect(claimSql).not.toContain('actor.deleted_at');
    expect(claimSql).toContain('JOIN real_portrait_actors actor ON actor.id = operation.actor_id');
    expect(claimSql).toContain('FROM generation_real_portrait_references reference');
  });

  it('deleting 物化中的 stale submitted create_asset 不被删除扫尾器改写，Group 清理仍可完成', async () => {
    const provider = fakeProvider();
    let claimCount = 0;
    const client = {
      query: vi.fn(async (sql: unknown) => {
        const query = String(sql);
        if (query.includes('SELECT operation.id, operation.user_id')) {
          claimCount += 1;
          return claimCount === 1
            ? result([{
              id: 'group-operation-1',
              user_id: 'user-1',
              actor_id: 'actor-1',
              materialization_id: 'materialization-deleting-1',
              portrait_asset_id: null,
              operation_type: 'actor_delete_group',
              attempt_count: 1,
              provider_asset_id: null,
              provider_group_id: 'provider-group-1',
              project_name: 'default',
            }])
            : result([]);
        }
        if (query.includes('RETURNING attempt_count')) return result([{ attempt_count: 2 }]);
        if (query.includes('SELECT status FROM real_portrait_remote_operations')) {
          return result([{ status: 'submitting' }]);
        }
        return result([]);
      }),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(client));
    mocks.poolQuery.mockResolvedValue(result([]));

    await expect(processRealPortraitRemoteDeletions(2, { provider }))
      .resolves.toEqual({ claimed: 1, completed: 1, failed: 0 });

    expect(provider.deleteAssetGroup).toHaveBeenCalledWith('provider-group-1', 'default');
    const staleSweepSql = mocks.poolQuery.mock.calls
      .map(([query]) => String(query))
      .find(query => query.includes("SET status = 'submission_unknown'"));
    expect(staleSweepSql).toContain("WHERE operation_type LIKE '%delete%'");
    expect(staleSweepSql).toContain("status IN ('submitting', 'submitted')");
    const claimSql = client.query.mock.calls
      .map(([query]) => String(query))
      .find(query => query.includes('SELECT operation.id, operation.user_id'));
    expect(claimSql).toContain("create_operation.operation_type = 'create_asset'");
    expect(claimSql).toContain(
      "create_operation.status IN ('submitting', 'submission_unknown', 'manual_review')",
    );
  });

  it('软删除后 stale submitting 先恢复为 submission_unknown，再落远端 ID 并只进入 late delete', async () => {
    const provider = fakeProvider();
    let staleSubmissionRecovered = false;
    provider.listRealPortraitAssets.mockResolvedValue({
      items: [{
        id: 'provider-asset-1',
        name: 'lindyson-primary-upload-1',
        sourceUrl: 'https://objects.example.com/source.png',
        assetType: 'Image',
        groupId: 'provider-group-1',
        status: 'Processing',
        projectName: 'default',
        errorCode: null,
        errorMessage: null,
        requestId: 'request-1',
      }],
      totalCount: 1,
      requestId: 'request-list-1',
    });
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('UPDATE real_portrait_remote_operations operation')) {
        staleSubmissionRecovered = true;
        return result([]);
      }
      if (query.includes('SELECT upload_session.user_id')) {
        expect(staleSubmissionRecovered).toBe(true);
        return result([{ user_id: 'user-1', upload_id: 'upload-1' }]);
      }
      if (query.includes('SELECT upload_session.asset_id')) {
        return result([{
          asset_id: 'asset-1',
          operation_id: 'create-operation-1',
          actor_id: 'actor-1',
          materialization_id: 'materialization-1',
          provider_group_id: 'provider-group-1',
          project_name: 'default',
          kind: 'primary',
        }]);
      }
      throw new Error(`未预期 pool 查询：${query}`);
    });
    const quotaState = {
      source_plan_id: 'plan-pro',
      portrait_enabled: true,
      profile_limit: 5,
      active_limit: 3,
      assets_per_actor: 2,
      grace_status: 'none',
      grace_until: null,
      retained_actor_ids: [],
      active_actor_ids: [],
    };
    const client = {
      query: vi.fn(async (sql: unknown) => {
        const query = String(sql);
        if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
        if (query.includes('FROM user_portrait_quota_states')) return result([quotaState]);
        if (query.includes('SELECT upload_session.status AS session_status')) {
          return result([{
            session_status: 'submitting',
            actor_id: 'actor-1',
            materialization_id: 'materialization-1',
            kind: 'primary',
            asset_id: 'asset-1',
            actor_lifecycle_status: 'revoked',
            plan_access_status: 'plan_locked',
            actor_deleted_at: '2026-07-30T08:00:00.000Z',
            authorization_status: 'revoked',
            authorization_valid_now: true,
            materialization_status: 'deleting',
            provider_group_id: 'provider-group-1',
            project_name: 'default',
            operation_status: 'submission_unknown',
            asset_status: 'queued',
            provider_asset_id: null,
          }]);
        }
        if (query.includes('UPDATE real_portrait_assets')
          && query.includes('provider_asset_id = $2')) {
          return result([{ id: 'asset-1' }]);
        }
        return result([]);
      }),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(processPendingAmbiguousRealPortraitAssetSubmissions(1, { provider }))
      .resolves.toEqual({ scanned: 1, recovered: 0 });

    const poolSql = mocks.poolQuery.mock.calls.map(([query]) => String(query));
    const staleRecoverySql = poolSql.find(query => (
      query.includes('UPDATE real_portrait_remote_operations operation')
    ));
    expect(staleRecoverySql).toContain("SET status = 'submission_unknown'");
    expect(staleRecoverySql).toContain("operation.status = 'submitting'");
    expect(staleRecoverySql).toContain("interval '5 minutes'");
    expect(staleRecoverySql).toContain('CREATE_ASSET_FINALIZE_STALE');

    const sql = client.query.mock.calls.map(([query]) => String(query));
    const lockSql = sql.find(query => query.includes('SELECT upload_session.status AS session_status'));
    expect(lockSql).toContain('actor.deleted_at AS actor_deleted_at');
    expect(lockSql).not.toContain('actor.deleted_at IS NULL');
    expect(sql.some(query => (
      query.includes('UPDATE real_portrait_assets')
      && query.includes('provider_asset_id = $2')
      && query.includes("status = 'deleting'")
    ))).toBe(true);
    expect(sql.some(query => query.includes("'late_create_delete_asset', 'prepared'"))).toBe(true);
    expect(sql.some(query => query.includes("SET status = 'processing'"))).toBe(false);
  });
});

function createDeleteClient(input: {
  lifecycleStatus: string;
  planAccessStatus?: string;
  authorizationStatus: string;
  consentedAt: Date | string | null;
  hasRemoteResource: boolean;
  hasUnsettledRemoteOperation: boolean;
  submittedProcessingTask?: boolean;
}) {
  return {
    query: vi.fn(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT a.lifecycle_status')) {
        return result([{
          lifecycle_status: input.lifecycleStatus,
          plan_access_status: input.planAccessStatus ?? 'plan_locked',
          has_remote_resource: input.hasRemoteResource,
          has_unsettled_remote_operation: input.hasUnsettledRemoteOperation,
        }]);
      }
      if (query.includes('FROM generation_tasks task')) {
        return input.submittedProcessingTask
          ? result([{
            id: 'generation-task-1',
            attempt: 1,
            status: 'processing',
            credit_status: 'captured',
            reserved_credits: 0,
            main_credits_used: 10,
            addon_credits_used: 0,
            active_provider_run_id: 'provider-run-1',
            provider_run_status: 'submitted',
          }])
          : result([]);
      }
      if (query.includes('SELECT status FROM generation_provider_runs')) {
        return result([{ status: 'submitted' }]);
      }
      if (query.includes('FROM real_portrait_authorizations')) {
        return result([{
          id: 'authorization-1',
          status: input.authorizationStatus,
          consented_at: input.consentedAt,
        }]);
      }
      return result([]);
    }),
  };
}

function fakeProvider() {
  return {
    name: 'fake-real-portrait',
    createVisualValidationSession: vi.fn(),
    getVisualValidationResult: vi.fn(),
    createAsset: vi.fn(),
    listRealPortraitAssets: vi.fn(),
    getAsset: vi.fn(),
    deleteAsset: vi.fn(),
    deleteAssetGroup: vi.fn().mockResolvedValue({
      groupId: 'provider-group-1',
      requestId: null,
    }),
  } satisfies RealPortraitProvider;
}

function result<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}
