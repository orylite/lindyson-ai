import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  withTransaction: vi.fn(),
  reconcileSubscriptionWithClient: vi.fn(),
  getPortraitEntitlementsForUser: vi.fn(),
  createObjectReadUrl: vi.fn(),
  createUploadSignature: vi.fn(),
  scheduleObjectDeletion: vi.fn(),
  scheduleSystemAssetDeletion: vi.fn(),
}));

vi.mock('../src/domain/realPortraitThumbnails.js', () => ({ ensureRealPortraitThumbnail: vi.fn().mockResolvedValue(undefined) }));

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
  getStoredObjectSize: vi.fn(),
  openStoredObjectStream: vi.fn(),
}));
vi.mock('../src/domain/assetDeletionService.js', () => ({
  scheduleObjectDeletion: mocks.scheduleObjectDeletion,
  scheduleSystemAssetDeletion: mocks.scheduleSystemAssetDeletion,
}));

import type { RealPortraitProvider } from '../src/providers/realPortraitProvider.js';
import {
  processExpiredRealPortraitVerificationSessions,
  readGlobalCapacity,
} from '../src/domain/realPortraitReconciliation.js';
import {
  completeRealPortraitUpload,
  createRealPortraitUpload,
} from '../src/domain/realPortraitService.js';

describe('真人人像 Asset 容量预留', () => {
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
    mocks.createObjectReadUrl.mockResolvedValue('https://objects.example.com/source.png');
    mocks.createUploadSignature.mockImplementation(async ({ objectKey }: { objectKey: string }) => ({
      uploadUrl: `https://upload.example.com/${objectKey}`,
      method: 'PUT',
      headers: {},
    }));
  });

  it('全局计数将 asset-less 在途会话与 queued asset 各算一个槽，并通过 asset_id 避免同一上传重复计数', async () => {
    const client = {
      query: vi.fn().mockResolvedValue(result([{
        groups_used: 1,
        assets_used: 40,
        groups_reserved: 0,
        assets_reserved: 5,
      }])),
    };

    await expect(readGlobalCapacity(client as never)).resolves.toEqual({
      groupsUsed: 1,
      assetsUsed: 40,
      groupsReserved: 0,
      assetsReserved: 5,
    });

    const sql = String(client.query.mock.calls[0]?.[0]);
    expect(sql).toContain('pending_group_slots AS');
    expect(sql).toContain(
      "verification_session.status IN ('invitation_ready', 'waiting', 'submission_unknown')",
    );
    expect(sql).toContain('verification_session.byted_token_ciphertext IS NOT NULL');
    expect(sql).toContain('materialization.provider_group_id IS NULL');
    expect(sql).toContain('SELECT pending.count FROM pending_group_slots pending');
    expect(sql).toContain('pending_asset_slots AS');
    expect(sql).toContain("asset.provider_asset_id IS NULL");
    expect(sql).toContain("asset.status = 'queued'");
    expect(sql).toContain('upload.asset_id IS NULL');
    expect(sql).toContain(
      "upload.status IN ('waiting_upload', 'uploaded', 'submitting', 'processing', 'active')",
    );
    expect(sql).toContain('SELECT pending.count FROM pending_asset_slots pending');
  });

  it('45 槽饱和时不同档案的 primary 与 secondary 并发也不能复用同一全局槽', async () => {
    const activeUploadKinds = new Set<string>();
    let transactionTail = Promise.resolve();
    const client = {
      query: vi.fn(async (sql: unknown, values?: readonly unknown[]) => {
        const query = String(sql);
        if (query.includes('pg_advisory_xact_lock')) return result([]);
        if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
        if (query.includes('FROM user_portrait_quota_states')) return result([quotaState()]);
        if (query.includes('SELECT m.id, m.status')) {
          return result([{
            id: values?.[0] === 'actor-secondary' ? 'materialization-secondary' : 'materialization-primary',
            status: 'awaiting_upload',
            authorization_status: 'active',
            authorization_valid_now: true,
            plan_access_status: 'available',
            actor_lifecycle_status: 'awaiting_upload',
          }]);
        }
        if (query.includes('SELECT primary_asset.id')) {
          return result([{ id: 'existing-primary-asset' }]);
        }
        if (query.includes('UNION ALL') && query.includes('LIMIT 1')
          && query.includes('real_portrait_upload_sessions')) {
          const materializationId = String(values?.[0]);
          const kind = String(values?.[1]);
          return activeUploadKinds.has(`${materializationId}:${kind}`) ? result([{}]) : result([]);
        }
        if (query.includes('WITH remote_group_slots AS') && query.includes('AS profiles')) {
          return result([{
            profiles: 1,
            active: 1,
            queued: 0,
            groups_used: 1,
            assets_used: 44,
            groups_reserved: 0,
            // 已有 reservation 的剩余槽，或第一笔已建立的 pending upload，始终只占 1。
            assets_reserved: 1,
          }]);
        }
        if (query.includes('WITH current_asset_slots AS')) {
          const actorId = String(values?.[0]);
          const currentAssets = actorId === 'actor-secondary' ? 1 : 0;
          return result([{
            remaining_asset_slots: Math.max(1 - currentAssets, 0),
            current_assets: currentAssets,
          }]);
        }
        if (query.includes('INSERT INTO real_portrait_upload_sessions')) {
          activeUploadKinds.add(`${String(values?.[3])}:${String(values?.[4])}`);
          return result([]);
        }
        if (query.includes('INSERT INTO real_portrait_events')) return result([]);
        throw new Error(`未预期查询：${query}`);
      }),
    };
    mocks.withTransaction.mockImplementation(<T>(callback: (db: typeof client) => Promise<T>) => {
      const current = transactionTail.then(() => callback(client));
      transactionTail = current.then(() => undefined, () => undefined);
      return current;
    });

    const settled = await Promise.allSettled([
      createRealPortraitUpload('user-1', 'actor-primary', {
        kind: 'primary',
        mimeType: 'image/png',
        sizeBytes: 1024,
      }),
      createRealPortraitUpload('user-1', 'actor-secondary', {
        kind: 'secondary',
        mimeType: 'image/png',
        sizeBytes: 1024,
      }),
    ]);

    expect(settled.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find(item => item.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: {
        code: 'REAL_PORTRAIT_CAPACITY_WAIT',
        statusCode: 409,
      },
    });
    expect(activeUploadKinds).toEqual(new Set(['materialization-primary:primary']));
    expect(client.query.mock.calls.filter(([sql]) => (
      String(sql).includes('INSERT INTO real_portrait_upload_sessions')
    ))).toHaveLength(1);
  });

  it('complete 在调用 provider 前于容量锁内复核，检测到 46/45 时释放本地在途槽并拒绝提交', async () => {
    let submissionLockReads = 0;
    const provider = fakeProvider();
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT s.*')) {
        return result([{
          id: 'upload-1',
          user_id: 'user-1',
          actor_id: 'actor-1',
          materialization_id: 'materialization-1',
          kind: 'primary',
          status: 'uploaded',
          object_key: 'real-portrait-uploads/user-1/actor-1/upload-1',
          mime_type: 'image/png',
          expires_at: '2026-08-30T08:00:00.000Z',
          asset_id: 'asset-1',
          provider_group_id: 'group-1',
          project_name: 'default',
          alias: '演员一',
        }]);
      }
      if (query.includes('SELECT upload_session.asset_id')) {
        return result([{
          asset_id: 'asset-1',
          operation_id: 'operation-1',
          actor_id: 'actor-1',
          materialization_id: 'materialization-1',
          provider_group_id: 'group-1',
          project_name: 'default',
          kind: 'primary',
        }]);
      }
      throw new Error(`未预期 pool 查询：${query}`);
    });
    const client = {
      query: vi.fn(async (sql: unknown, _values?: readonly unknown[]) => {
        const query = String(sql);
        if (query.includes('pg_advisory_xact_lock')) return result([]);
        if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
        if (query.includes('FROM user_portrait_quota_states')) return result([quotaState()]);
        if (query.includes('SELECT upload_session.status AS session_status')) {
          submissionLockReads += 1;
          return result([uploadSubmissionState({
            session_status: submissionLockReads === 1 ? 'uploaded' : 'submitting',
            operation_status: submissionLockReads === 1 ? 'prepared' : 'submitting',
          })]);
        }
        if (query.includes('WITH remote_group_slots AS') && query.includes('AS profiles')) {
          return result([{
            profiles: 1,
            active: 1,
            queued: 0,
            groups_used: 1,
            assets_used: 44,
            groups_reserved: 0,
            assets_reserved: 2,
          }]);
        }
        if (query.includes('SELECT CASE') && query.includes('FROM real_portrait_assets')) {
          return result([{ next_status: 'awaiting_upload' }]);
        }
        if (query.startsWith('UPDATE ') || query.includes('\n       UPDATE ')) return result([{}]);
        throw new Error(`未预期事务查询：${query}`);
      }),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(completeRealPortraitUpload('user-1', 'upload-1', {
      mimeType: 'image/png',
      sizeBytes: 1024,
      sha256: 'a'.repeat(64),
    }, {
      provider,
      now: () => new Date('2026-07-30T08:00:00.000Z'),
    })).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_CAPACITY_WAIT',
      statusCode: 409,
    });

    expect(provider.createAsset).not.toHaveBeenCalled();
    expect(mocks.scheduleObjectDeletion).toHaveBeenCalledWith(
      client,
      'real-portrait-uploads/user-1/actor-1/upload-1',
    );
    const capacityLockIndex = client.query.mock.calls.findIndex(([sql]) => (
      String(sql).includes('pg_advisory_xact_lock')
    ));
    const capacityReadIndex = client.query.mock.calls.findIndex(([sql]) => (
      String(sql).includes('WITH remote_group_slots AS')
    ));
    expect(capacityLockIndex).toBeGreaterThanOrEqual(0);
    expect(capacityReadIndex).toBeGreaterThan(capacityLockIndex);
  });

  it('H5/邀请过期且最终查单暂时失败时保留 token 会话，reservation 释放后仍由 pending group 独立占槽', async () => {
    const now = new Date('2026-07-30T08:00:00.000Z');
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      expect(query).toContain('verification_session.byted_token_ciphertext IS NULL');
      return result([{ id: 'invite-1' }]);
    });
    const client = {
      query: vi.fn(async (sql: unknown, _values?: readonly unknown[]) => {
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
            id: 'session-unknown-group',
            status: 'submission_unknown',
            h5_expires_at: '2026-07-30T07:30:00.000Z',
            byted_token_ciphertext: '{"ciphertext":"known-token"}',
          }]);
        }
        return result([]);
      }),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(processExpiredRealPortraitVerificationSessions(50, { now: () => now }))
      .resolves.toEqual({ scanned: 1, expired: 1, failed: 0 });

    const sessionExpiry = client.query.mock.calls.find(([sql]) => (
      String(sql).includes("SET status = 'expired'")
      && String(sql).includes('real_portrait_verification_sessions')
    ));
    expect(sessionExpiry?.[1]?.[0]).toEqual([]);
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes("SET status = 'released'")
      && String(sql).includes('real_portrait_capacity_reservations')
    ))).toBe(true);
  });
});

function quotaState() {
  return {
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
}

function result<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}

function uploadSubmissionState(overrides: Record<string, unknown> = {}) {
  return {
    session_status: 'uploaded',
    actor_id: 'actor-1',
    materialization_id: 'materialization-1',
    kind: 'primary',
    asset_id: 'asset-1',
    actor_lifecycle_status: 'awaiting_upload',
    plan_access_status: 'available',
    authorization_status: 'active',
    authorization_valid_now: true,
    materialization_status: 'awaiting_upload',
    provider_group_id: 'group-1',
    project_name: 'default',
    operation_status: 'prepared',
    asset_status: 'queued',
    provider_asset_id: null,
    ...overrides,
  };
}

function fakeProvider(): RealPortraitProvider {
  return {
    name: 'fake-real-portrait',
    createVisualValidationSession: vi.fn(),
    getVisualValidationResult: vi.fn(),
    createAsset: vi.fn(),
    listRealPortraitAssets: vi.fn(),
    getAsset: vi.fn(),
    deleteAsset: vi.fn(),
    deleteAssetGroup: vi.fn(),
  };
}
