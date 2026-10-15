import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  withTransaction: vi.fn(),
  reconcileSubscriptionWithClient: vi.fn(),
  getPortraitEntitlementsForUser: vi.fn(),
  createObjectReadUrl: vi.fn(),
  createUploadSignature: vi.fn(),
  getStoredObjectSize: vi.fn(),
  openStoredObjectStream: vi.fn(),
  scheduleObjectDeletion: vi.fn(),
  scheduleSystemAssetDeletion: vi.fn(),
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
  createObjectReadUrl: mocks.createObjectReadUrl,
  createUploadSignature: mocks.createUploadSignature,
  getStoredObjectSize: mocks.getStoredObjectSize,
  openStoredObjectStream: mocks.openStoredObjectStream,
}));
vi.mock('../src/domain/assetDeletionService.js', () => ({
  scheduleObjectDeletion: mocks.scheduleObjectDeletion,
  scheduleSystemAssetDeletion: mocks.scheduleSystemAssetDeletion,
}));
vi.mock('../src/domain/realPortraitSecrets.js', () => ({
  createRealPortraitBearerToken: () => 'callback-nonce',
  decryptRealPortraitSecret: vi.fn(),
  encryptRealPortraitSecret: vi.fn(),
  fingerprintRealPortraitSecret: (value: string) => `fingerprint:${value}`,
}));

import type { RealPortraitProvider } from '../src/providers/realPortraitProvider.js';
import {
  deleteRealPortraitAsset,
  processPendingAmbiguousRealPortraitAssetSubmissions,
  revokeOwnedRealPortraitActor,
} from '../src/domain/realPortraitService.js';

describe('真人人像远端清理可靠性', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scheduleSystemAssetDeletion.mockResolvedValue(0);
  });

  it('重复删除正在清理的素材时幂等返回 cleanup pending 且不重复创建操作', async () => {
    const provider = fakeProvider();
    const client = {
      query: vi.fn(async (sql: unknown) => {
        const query = String(sql);
        if (query.includes('FROM real_portrait_assets pa')) {
          return result([{
            id: 'asset-1',
            provider_asset_id: 'provider-asset-1',
            status: 'deleting',
            materialization_id: 'materialization-1',
            project_name: 'default',
          }]);
        }
        throw new Error(`未预期查询：${query}`);
      }),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(deleteRealPortraitAsset('user-1', 'actor-1', 'asset-1', { provider }))
      .resolves.toEqual({ deleted: true, cleanupPending: true });

    expect(provider.deleteAsset).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('INSERT INTO real_portrait_remote_operations')
    ))).toBe(false);
  });

  it('撤回仅锁定非 nullable 主记录，再独立锁定 materialization', async () => {
    const provider = fakeProvider();
    const client = createRevokeClient({ manualReview: false });
    mocks.withTransaction.mockImplementation(async callback => callback(client));
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM real_portrait_actors a')) return result([actorRow()]);
      throw new Error(`未预期 pool 查询：${query}`);
    });

    await revokeOwnedRealPortraitActor('user-1', 'actor-1', {}, { provider });

    const authorizationSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes('SELECT auth.id AS authorization_id'));
    expect(authorizationSql).toContain('FOR UPDATE OF a, auth');
    expect(authorizationSql).not.toContain('FOR UPDATE OF a, auth, m');
    expect(client.query.mock.calls.some(([sql]) => {
      const query = String(sql);
      return query.includes('FROM real_portrait_materializations')
        && query.includes("status NOT IN ('evicted', 'deleted', 'error')")
        && query.includes('FOR UPDATE');
    })).toBe(true);
    const inviteCancellationSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes('UPDATE real_portrait_invites') && sql.includes("status = 'cancelled'"));
    expect(inviteCancellationSql).toContain('accepted_at = NULL');
    expect(mocks.scheduleSystemAssetDeletion).not.toHaveBeenCalled();
  });

  it('已同意但 H5 尚未创建 Group 时直接关闭本地物化并释放容量', async () => {
    const provider = fakeProvider();
    const client = createRevokeClient({ manualReview: false, providerGroupId: null });
    mocks.withTransaction.mockImplementation(async callback => callback(client));
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM real_portrait_actors a')) return result([actorRow()]);
      throw new Error(`未预期 pool 查询：${query}`);
    });

    await expect(revokeOwnedRealPortraitActor('user-1', 'actor-1', {}, { provider }))
      .resolves.toMatchObject({ cleanupPending: false });

    const executedSql = client.query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(executedSql).toContain("SET status = 'cancelled', accepted_at = NULL");
    expect(executedSql).toContain("SET status = 'error', remote_deleted_at = now()");
    expect(executedSql).toContain("SET status = 'released'");
    expect(executedSql).not.toContain("SET status = 'deleting', updated_at = now()\n         WHERE id = $1");
    expect(provider.deleteAssetGroup).not.toHaveBeenCalled();
  });

  it('撤回在同一事务内隐藏当前演员关联的多份站内成片，忽略无成片任务', async () => {
    const provider = fakeProvider();
    const client = createRevokeClient({
      manualReview: false,
      generatedAssets: [
        { id: 'asset-output-1', user_id: 'user-1' },
        { id: 'asset-output-2', user_id: 'user-1' },
      ],
    });
    mocks.withTransaction.mockImplementation(async callback => callback(client));
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM real_portrait_actors a')) return result([actorRow()]);
      throw new Error(`未预期 pool 查询：${query}`);
    });
    mocks.scheduleSystemAssetDeletion.mockResolvedValue(2);

    await expect(revokeOwnedRealPortraitActor('user-1', 'actor-1', {}, { provider }))
      .resolves.toMatchObject({ cleanupPending: false });

    expect(mocks.scheduleSystemAssetDeletion).toHaveBeenCalledTimes(1);
    expect(mocks.scheduleSystemAssetDeletion).toHaveBeenCalledWith(client, [
      { id: 'asset-output-1', userId: 'user-1' },
      { id: 'asset-output-2', userId: 'user-1' },
    ]);
    const targetSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes('FROM generation_real_portrait_references reference'));
    expect(targetSql).toContain('JOIN generation_tasks task');
    expect(targetSql).toContain('task.id = reference.task_id AND task.user_id = $1');
    expect(targetSql).toContain('asset.id = task.asset_id AND asset.user_id = task.user_id');
    expect(targetSql).toContain('reference.actor_id = $2');
    expect(targetSql).toContain("asset.deletion_status = 'active'");

    const executedSql = client.query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(executedSql).not.toContain('ai_clean_export_audits');
  });

  it('重复撤回已撤回演员不会重复安排站内成片删除', async () => {
    const provider = fakeProvider();
    const client = createRevokeClient({
      manualReview: false,
      generatedAssets: [{ id: 'asset-output-1', user_id: 'user-1' }],
      lifecycleStatuses: ['active', 'revoked'],
    });
    mocks.withTransaction.mockImplementation(async callback => callback(client));
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM real_portrait_actors a')) return result([actorRow()]);
      throw new Error(`未预期 pool 查询：${query}`);
    });
    mocks.scheduleSystemAssetDeletion.mockResolvedValue(1);

    await revokeOwnedRealPortraitActor('user-1', 'actor-1', {}, { provider });
    await revokeOwnedRealPortraitActor('user-1', 'actor-1', {}, { provider });

    expect(mocks.scheduleSystemAssetDeletion).toHaveBeenCalledTimes(1);
    expect(provider.deleteAssetGroup).toHaveBeenCalledTimes(1);
  });

  it('撤回时用 group delete 安全处置 create_asset manual_review 并保留审计原因', async () => {
    const provider = fakeProvider();
    const client = createRevokeClient({ manualReview: true });
    mocks.withTransaction.mockImplementation(async callback => callback(client));
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM real_portrait_actors a')) return result([actorRow()]);
      throw new Error(`未预期 pool 查询：${query}`);
    });

    await expect(revokeOwnedRealPortraitActor('user-1', 'actor-1', {}, { provider }))
      .resolves.toMatchObject({ cleanupPending: false });

    expect(provider.deleteAssetGroup).toHaveBeenCalledWith('group-current', 'project-current');
    expect(client.query.mock.calls.some(([sql]) => {
      const query = String(sql);
      return query.includes("operation_type = 'create_asset'")
        && query.includes("status = 'manual_review'")
        && query.includes("last_error_code = 'SUPERSEDED_BY_GROUP_DELETE:");
    })).toBe(true);
    const executedSql = client.query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(executedSql).toContain("SET lifecycle_status = 'revoked'");
    expect(executedSql).not.toContain("lifecycle_status = 'evicted'");
  });

  it('撤回后才进入 manual_review 时持久化 group delete 接管路径', async () => {
    const provider = fakeProvider();
    provider.listRealPortraitAssets.mockRejectedValue(Object.assign(new Error('lookup failed'), {
      code: 'LOOKUP_FAILED',
      statusCode: 400,
    }));
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('UPDATE real_portrait_remote_operations operation')) return result([]);
      if (query.includes('SELECT upload_session.user_id')) {
        return result([{ user_id: 'user-1', upload_id: 'upload-1' }]);
      }
      if (query.includes('SELECT upload_session.asset_id')) {
        return result([{
          asset_id: 'asset-1',
          operation_id: 'operation-create-1',
          actor_id: 'actor-1',
          materialization_id: 'materialization-1',
          provider_group_id: 'group-current',
          project_name: 'project-current',
          kind: 'primary',
        }]);
      }
      throw new Error(`未预期 pool 查询：${query}`);
    });
    const client = {
      query: vi.fn(async (sql: unknown) => {
        const query = String(sql);
        if (query.includes('RETURNING user_id, actor_id, materialization_id')) {
          return result([{
            user_id: 'user-1',
            actor_id: 'actor-1',
            materialization_id: 'materialization-1',
          }]);
        }
        if (query.includes('SELECT materialization.provider_group_id')) {
          return result([{ provider_group_id: 'group-current' }]);
        }
        return result([]);
      }),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(processPendingAmbiguousRealPortraitAssetSubmissions(20, { provider }))
      .resolves.toEqual({ scanned: 1, recovered: 0 });

    expect(client.query.mock.calls.some(([sql]) => {
      const query = String(sql);
      return query.includes("'delete_asset_group', 'prepared'")
        && query.includes('ON CONFLICT (idempotency_key) DO UPDATE');
    })).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes("last_error_code = 'SUPERSEDED_BY_GROUP_DELETE:")
    ))).toBe(true);
  });

  it('撤回远端清理失败后 actor 保持 revoked，不覆盖为 sync_error', async () => {
    const provider = fakeProvider();
    provider.deleteAssetGroup.mockRejectedValue(Object.assign(new Error('provider unavailable'), {
      code: 'PROVIDER_UNAVAILABLE',
    }));
    const client = createRevokeClient({ manualReview: false });
    mocks.withTransaction.mockImplementation(async callback => callback(client));
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM real_portrait_actors a')) return result([actorRow()]);
      throw new Error(`未预期 pool 查询：${query}`);
    });

    await expect(revokeOwnedRealPortraitActor('user-1', 'actor-1', {}, { provider }))
      .resolves.toMatchObject({
        actor: { lifecycleStatus: 'revoked' },
        cleanupPending: true,
      });

    const executedSql = client.query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(executedSql).not.toContain("lifecycle_status = 'sync_error'");
    expect(executedSql).not.toContain("lifecycle_status = 'evicted'");
    expect(executedSql).toContain("SET lifecycle_status = 'revoked'");
    expect(executedSql).toContain("SET status = $2, last_error_code = $3");
  });
});

function createRevokeClient(input: {
  manualReview: boolean;
  providerGroupId?: string | null;
  generatedAssets?: Array<{ id: string; user_id: string }>;
  lifecycleStatuses?: string[];
}) {
  const providerGroupId = input.providerGroupId === undefined ? 'group-current' : input.providerGroupId;
  let lifecycleReadCount = 0;
  return {
    query: vi.fn(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT lifecycle_status FROM real_portrait_actors')) {
        const statuses = input.lifecycleStatuses ?? ['active'];
        const lifecycleStatus = statuses[Math.min(lifecycleReadCount, statuses.length - 1)]!;
        lifecycleReadCount += 1;
        return result([{ lifecycle_status: lifecycleStatus }]);
      }
      if (query.includes('SELECT auth.id AS authorization_id')) {
        return result([{
          authorization_id: 'authorization-1',
          materialization_id: 'materialization-1',
          provider_group_id: providerGroupId,
          project_name: 'project-stale',
          has_unsettled_verification: false,
          has_unsettled_create_asset: false,
          has_manual_review_create_asset: input.manualReview,
        }]);
      }
      if (query.includes('SELECT id, provider_group_id, project_name')) {
        return result([{
          id: 'materialization-1',
          provider_group_id: providerGroupId,
          project_name: 'project-current',
        }]);
      }
      if (query.includes('FROM generation_real_portrait_references reference')) {
        return result(input.generatedAssets ?? []);
      }
      if (query.includes('INSERT INTO real_portrait_remote_operations')) {
        return result([{ id: 'operation-delete-group-1' }]);
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
    deleteAssetGroup: vi.fn(),
  } satisfies RealPortraitProvider;
}

function actorRow() {
  return {
    id: 'actor-1',
    alias: '演员一',
    plan_access_status: 'available',
    lifecycle_status: 'revoked',
    authorization_status: 'revoked',
    authorization_expires_at: '2026-08-30T08:00:00.000Z',
    last_successful_generation_at: null,
    created_at: '2026-07-30T08:00:00.000Z',
    updated_at: '2026-07-30T08:00:00.000Z',
    assets: [],
  };
}

function result<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}
