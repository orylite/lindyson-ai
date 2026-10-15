import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  getStoredObjectSize: mocks.getStoredObjectSize,
  openStoredObjectStream: mocks.openStoredObjectStream,
}));
vi.mock('../src/domain/assetDeletionService.js', () => ({
  scheduleObjectDeletion: mocks.scheduleObjectDeletion,
  scheduleSystemAssetDeletion: mocks.scheduleSystemAssetDeletion,
}));
vi.mock('../src/domain/realPortraitSecrets.js', () => ({
  createRealPortraitBearerToken: () => 'callback-nonce',
  decryptRealPortraitSecret: (secret: { ciphertext: string }) => secret.ciphertext,
  encryptRealPortraitSecret: (value: string) => ({ ciphertext: value, iv: 'iv', tag: 'tag' }),
  fingerprintRealPortraitSecret: (value: string) => `fingerprint:${value}`,
}));

import type { RealPortraitProvider } from '../src/providers/realPortraitProvider.js';
import {
  acceptPublicRealPortraitInvite,
  completeRealPortraitUpload,
  handleVolcRealPortraitValidationCallback,
  processPendingRealPortraitVerificationResults,
  startPublicRealPortraitVerification,
} from '../src/domain/realPortraitService.js';

const NOW = new Date('2026-07-30T08:00:00.000Z');
const FUTURE = '2026-08-30T08:00:00.000Z';

describe('真人人像供应商提交前状态栅栏', () => {
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

  it('release 已进入 eviction_warning 时 start 不创建远端实名会话', async () => {
    const provider = fakeProvider();
    const client = { query: vi.fn(async (sql: unknown, _params?: readonly unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT actor.user_id')) return result([{ user_id: 'user-1' }]);
      if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
      if (query.includes('FROM user_portrait_quota_states')) return result([quotaState()]);
      if (query.includes('SELECT i.id AS invite_id')) {
        return result([inviteRow({
          lifecycle_status: 'eviction_warning',
          materialization_status: 'eviction_warning',
        })]);
      }
      if (query.includes('FROM real_portrait_verification_sessions')) return result([]);
      throw new Error(`未预期查询：${query}`);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(startPublicRealPortraitVerification('invite-token', {
      provider,
      now: () => NOW,
    })).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_VERIFICATION_NO_LONGER_USABLE',
      statusCode: 409,
    });

    expect(provider.createVisualValidationSession).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('FOR UPDATE OF i, auth, a, m')
    ))).toBe(true);
  });

  it('已验证上传在 provider fence 前变为 eviction_warning 时不调用 CreateAsset', async () => {
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
          expires_at: FUTURE,
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
    const client = { query: vi.fn(async (sql: unknown, _params?: readonly unknown[]) => {
      const query = String(sql);
      if (query.includes('pg_advisory_xact_lock')) return result([]);
      if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
      if (query.includes('FROM user_portrait_quota_states')) return result([quotaState()]);
      if (query.includes('SELECT upload_session.status AS session_status')) {
        return result([{
          session_status: 'uploaded',
          actor_id: 'actor-1',
          materialization_id: 'materialization-1',
          kind: 'primary',
          asset_id: 'asset-1',
          actor_lifecycle_status: 'eviction_warning',
          plan_access_status: 'available',
          authorization_status: 'active',
          authorization_valid_now: true,
          materialization_status: 'eviction_warning',
          provider_group_id: 'group-1',
          project_name: 'default',
          operation_status: 'prepared',
          asset_status: 'queued',
        }]);
      }
      throw new Error(`未预期事务查询：${query}`);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(completeRealPortraitUpload('user-1', 'upload-1', {
      mimeType: 'image/png',
      sizeBytes: 1024,
      sha256: 'a'.repeat(64),
    }, {
      provider,
      now: () => NOW,
    })).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_UPLOAD_NOT_ALLOWED',
      statusCode: 409,
    });

    expect(provider.createAsset).not.toHaveBeenCalled();
    const fenceSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes('SELECT upload_session.status AS session_status'));
    expect(fenceSql).toContain(
      'FOR UPDATE OF upload_session, actor, portrait_authorization, materialization, asset, operation',
    );
  });

  it('远端实名会话创建在事务外，返回后授权变化时只保存加密恢复证据且不交付 H5', async () => {
    let transactionDepth = 0;
    let providerReturned = false;
    let visualLockCount = 0;
    let persistedTokenParams: readonly unknown[] | undefined;
    const provider = fakeProvider();
    provider.createVisualValidationSession.mockImplementation(async () => {
      expect(transactionDepth).toBe(0);
      providerReturned = true;
      return {
        bytedToken: 'byted-token-1',
        h5Link: 'https://verify.example.com/h5/session-1',
        requestId: 'request-1',
      };
    });
    const client = { query: vi.fn(async (sql: unknown, params?: readonly unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT actor.user_id')) return result([{ user_id: 'user-1' }]);
      if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
      if (query.includes('FROM user_portrait_quota_states')) return result([quotaState()]);
      if (query.includes('SELECT i.id AS invite_id')) return result([inviteRow()]);
      if (query.includes('SELECT id, status, h5_link_ciphertext')) return result([]);
      if (query.includes('INSERT INTO real_portrait_verification_sessions')) {
        return result([{ id: 'session-1' }]);
      }
      if (query.includes('INSERT INTO real_portrait_remote_operations')
          && query.includes("'create_visual_validation_session'")) {
        return result([{ id: 'operation-1' }]);
      }
      if (query.includes("SET lifecycle_status = 'verifying'")) return result([{}]);
      if (query.includes("SET status = 'verifying'")) return result([{}]);
      if (query.includes('SELECT verification_session.status AS session_status')) {
        visualLockCount += 1;
        return result([visualLockCount === 1
          ? visualSubmissionState()
          : visualSubmissionState({
            authorization_status: 'revoked',
            authorization_valid_now: false,
            lifecycle_status: 'revoked',
            materialization_status: 'deleting',
          })]);
      }
      if (query.includes('SET updated_at = now()') && query.includes("status = 'submitting'")) {
        return result([{}]);
      }
      if (query.includes('SET byted_token_ciphertext = COALESCE')) {
        expect(providerReturned).toBe(true);
        persistedTokenParams = params;
        return result([{}]);
      }
      if (query.includes("last_error_code = 'ACCESS_CHANGED_AFTER_SUBMISSION'")) return result([{}]);
      if (query.includes('INSERT INTO real_portrait_events')) return result([{}]);
      throw new Error(`未预期查询：${query}`);
    }) };
    mocks.withTransaction.mockImplementation(async callback => {
      transactionDepth += 1;
      try {
        return await callback(client);
      } finally {
        transactionDepth -= 1;
      }
    });

    await expect(startPublicRealPortraitVerification('invite-token', {
      provider,
      now: () => NOW,
    })).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_VERIFICATION_NO_LONGER_USABLE',
      statusCode: 409,
    });

    expect(provider.createVisualValidationSession).toHaveBeenCalledOnce();
    expect(persistedTokenParams).toEqual([
      'session-1',
      JSON.stringify({ ciphertext: 'byted-token-1', iv: 'iv', tag: 'tag' }),
      'fingerprint:byted-token-1',
      expect.any(Date),
      JSON.stringify({
        ciphertext: 'https://verify.example.com/h5/session-1',
        iv: 'iv',
        tag: 'tag',
      }),
    ]);
  });

  it('远端素材创建在事务外，返回后授权变化时保存 Asset ID 并进入幂等清理', async () => {
    let transactionDepth = 0;
    let uploadLockCount = 0;
    let persistedAssetParams: readonly unknown[] | undefined;
    const provider = fakeProvider();
    provider.createAsset.mockImplementation(async () => {
      expect(transactionDepth).toBe(0);
      return { assetId: 'remote-asset-1', requestId: 'request-asset-1' };
    });
    mocks.createObjectReadUrl.mockImplementation(async () => {
      expect(transactionDepth).toBe(0);
      return 'https://storage.example.com/source.png';
    });
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT s.*')) return result([uploadSessionRow()]);
      if (query.includes('SELECT upload_session.asset_id')) return result([preparedUploadRow()]);
      throw new Error(`未预期 pool 查询：${query}`);
    });
    const client = { query: vi.fn(async (sql: unknown, params?: readonly unknown[]) => {
      const query = String(sql);
      if (query.includes('pg_advisory_xact_lock')) return result([]);
      if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
      if (query.includes('FROM user_portrait_quota_states')) return result([quotaState()]);
      if (query.includes('WITH remote_group_slots AS')) return result([capacityCounts()]);
      if (query.includes('SELECT upload_session.status AS session_status')) {
        uploadLockCount += 1;
        return result([uploadLockCount < 3
          ? uploadSubmissionState({
            session_status: uploadLockCount === 1 ? 'uploaded' : 'submitting',
            operation_status: uploadLockCount === 1 ? 'prepared' : 'submitting',
          })
          : uploadSubmissionState({
            session_status: 'submitting',
            operation_status: 'submitting',
            authorization_status: 'revoked',
            authorization_valid_now: false,
            actor_lifecycle_status: 'revoked',
            materialization_status: 'deleting',
          })]);
      }
      if (query.includes('UPDATE real_portrait_upload_sessions SET status = \'submitting\'')) return result([{}]);
      if (query.includes("SET status = 'submitting', attempt_count")) return result([{}]);
      if (query.includes("SET lifecycle_status = 'processing'")) return result([{}]);
      if (query.includes("SET status = 'processing'") && query.includes('real_portrait_materializations')) {
        return result([{}]);
      }
      if (query.includes('SET provider_asset_id = $2, status = \'deleting\'')) {
        persistedAssetParams = params;
        return result([{}]);
      }
      if (query.includes("SET status = 'failed'") && query.includes('real_portrait_upload_sessions')) {
        return result([{}]);
      }
      if (query.includes("last_error_code = 'ACCESS_CHANGED_AFTER_SUBMISSION'")) return result([{}]);
      if (query.includes("'late_create_delete_asset'")) return result([{}]);
      if (query.includes('INSERT INTO real_portrait_events')) return result([{}]);
      throw new Error(`未预期事务查询：${query}`);
    }) };
    mocks.withTransaction.mockImplementation(async callback => {
      transactionDepth += 1;
      try {
        return await callback(client);
      } finally {
        transactionDepth -= 1;
      }
    });

    await expect(completeRealPortraitUpload('user-1', 'upload-1', uploadCompletionInput(), {
      provider,
      now: () => NOW,
    })).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_UPLOAD_NOT_ALLOWED',
      statusCode: 409,
    });

    expect(provider.createAsset).toHaveBeenCalledOnce();
    expect(persistedAssetParams).toEqual(['asset-1', 'remote-asset-1']);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("'late_create_delete_asset'")))
      .toBe(true);
  });

  it('实名 finalize 提交结果未知时二次事务保存 token 与加密 H5，重试 start 幂等返回原链接', async () => {
    const commitError = Object.assign(new Error('commit result unknown'), { code: 'COMMIT_UNKNOWN' });
    let transactionNumber = 0;
    let transactionDepth = 0;
    let recoveryPersisted = false;
    let recoveredExpiresAt: Date | undefined;
    let recoveredH5Ciphertext: string | undefined;
    const provider = fakeProvider();
    provider.createVisualValidationSession.mockImplementation(async () => {
      expect(transactionDepth).toBe(0);
      return {
        bytedToken: 'byted-token-recovery',
        h5Link: 'https://verify.example.com/h5/recovery',
        requestId: 'request-recovery',
      };
    });
    const client = { query: vi.fn(async (sql: unknown, params?: readonly unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT actor.user_id')) return result([{ user_id: 'user-1' }]);
      if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
      if (query.includes('FROM user_portrait_quota_states')) return result([quotaState()]);
      if (query.includes('SELECT i.id AS invite_id')) {
        return result([inviteRow(recoveryPersisted ? {
          lifecycle_status: 'verifying',
          materialization_status: 'verifying',
        } : {})]);
      }
      if (query.includes('SELECT id, status, h5_link_ciphertext')) {
        return recoveryPersisted
          ? result([{
            id: 'session-recovery',
            status: 'submission_unknown',
            h5_link_ciphertext: recoveredH5Ciphertext,
            h5_expires_at: recoveredExpiresAt,
          }])
          : result([]);
      }
      if (query.includes('INSERT INTO real_portrait_verification_sessions')) {
        return result([{ id: 'session-recovery' }]);
      }
      if (query.includes('INSERT INTO real_portrait_remote_operations')
          && query.includes("'create_visual_validation_session'")) {
        return result([{ id: 'operation-recovery' }]);
      }
      if (query.includes("SET lifecycle_status = 'verifying'")) return result([{}]);
      if (query.includes("SET status = 'verifying'")) return result([{}]);
      if (query.includes('SELECT verification_session.status AS session_status')) {
        return result([visualSubmissionState()]);
      }
      if (query.includes('SET updated_at = now()') && query.includes("status = 'submitting'")) {
        return result([{}]);
      }
      if (query.includes('SET byted_token_ciphertext = $2')) return result([{}]);
      if (query.includes("SET status = 'completed'") && query.includes('real_portrait_remote_operations')) {
        return result([{}]);
      }
      if (query.includes('SELECT verification_session.status, verification_session.byted_token_fingerprint')) {
        return result([{ status: 'submitting', byted_token_fingerprint: null }]);
      }
      if (query.includes('SET byted_token_ciphertext = COALESCE')
          && query.includes('h5_link_ciphertext = COALESCE(h5_link_ciphertext, $6)')) {
        recoveredExpiresAt = params?.[3] as Date;
        recoveredH5Ciphertext = params?.[5] as string;
        recoveryPersisted = true;
        return result([{}]);
      }
      if (query.includes("SET status = 'invitation_ready', failure_code = NULL")) return result([{}]);
      if (query.includes('INSERT INTO real_portrait_remote_operations')
          && query.includes("'get_visual_validation_result'")) return result([{}]);
      if (query.includes('INSERT INTO real_portrait_events')) return result([{}]);
      if (query.includes('UPDATE real_portrait_remote_operations')) return result([{}]);
      throw new Error(`未预期查询：${query}`);
    }) };
    mocks.withTransaction.mockImplementation(async callback => {
      const currentTransaction = ++transactionNumber;
      transactionDepth += 1;
      try {
        const value = await callback(client);
        if (currentTransaction === 3) throw commitError;
        return value;
      } finally {
        transactionDepth -= 1;
      }
    });

    await expect(startPublicRealPortraitVerification('invite-token', {
      provider,
      now: () => NOW,
    })).rejects.toBe(commitError);

    expect(recoveryPersisted).toBe(true);
    await expect(startPublicRealPortraitVerification('invite-token', {
      provider,
      now: () => NOW,
    })).resolves.toEqual({
      status: 'verification-ready',
      verificationUrl: 'https://verify.example.com/h5/recovery',
      expiresAt: recoveredExpiresAt?.toISOString(),
      queuePosition: null,
    });
    expect(provider.createVisualValidationSession).toHaveBeenCalledOnce();
  });

  it('CreateAsset finalize 提交结果未知时用第二事务保存已知 remote ID 并安全交付', async () => {
    const commitError = new Error('asset finalize commit unknown');
    let transactionNumber = 0;
    let transactionDepth = 0;
    let uploadLockCount = 0;
    const provider = fakeProvider();
    provider.createAsset.mockImplementation(async () => {
      expect(transactionDepth).toBe(0);
      return { assetId: 'remote-asset-recovery', requestId: 'request-asset-recovery' };
    });
    mocks.createObjectReadUrl.mockImplementation(async () => {
      expect(transactionDepth).toBe(0);
      return 'https://storage.example.com/source.png';
    });
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT s.*')) return result([uploadSessionRow()]);
      if (query.includes('SELECT upload_session.asset_id')) return result([preparedUploadRow()]);
      if (query.includes('SELECT pa.id, pa.kind')) {
        return result([{
          id: 'asset-1',
          kind: 'primary',
          status: 'processing',
          consistency_status: 'pending',
        }]);
      }
      throw new Error(`未预期 pool 查询：${query}`);
    });
    const client = { query: vi.fn(async (sql: unknown, _params?: readonly unknown[]) => {
      const query = String(sql);
      if (query.includes('pg_advisory_xact_lock')) return result([]);
      if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
      if (query.includes('FROM user_portrait_quota_states')) return result([quotaState()]);
      if (query.includes('WITH remote_group_slots AS')) return result([capacityCounts()]);
      if (query.includes('SELECT upload_session.status AS session_status')) {
        uploadLockCount += 1;
        return result([uploadSubmissionState({
          session_status: uploadLockCount === 1 ? 'uploaded' : 'submitting',
          operation_status: uploadLockCount === 1 ? 'prepared' : 'submitting',
        })]);
      }
      if (query.includes('UPDATE real_portrait_upload_sessions SET status = \'submitting\'')) return result([{}]);
      if (query.includes("SET status = 'submitting', attempt_count")) return result([{}]);
      if (query.includes("SET lifecycle_status = 'processing'")) return result([{}]);
      if (query.includes("SET status = 'processing'") && query.includes('real_portrait_materializations')) {
        return result([{}]);
      }
      if (query.includes('SET provider_asset_id = $2, status = \'processing\'')) return result([{}]);
      if (query.includes("SET status = 'processing'") && query.includes('real_portrait_upload_sessions')) {
        return result([{}]);
      }
      if (query.includes("SET status = 'submitted'")) return result([{}]);
      throw new Error(`未预期事务查询：${query}`);
    }) };
    mocks.withTransaction.mockImplementation(async callback => {
      const currentTransaction = ++transactionNumber;
      transactionDepth += 1;
      try {
        const value = await callback(client);
        if (currentTransaction === 3) throw commitError;
        return value;
      } finally {
        transactionDepth -= 1;
      }
    });

    await expect(completeRealPortraitUpload('user-1', 'upload-1', uploadCompletionInput(), {
      provider,
      now: () => NOW,
    })).resolves.toEqual({
      asset: {
        id: 'asset-1',
        kind: 'primary',
        status: 'processing',
        consistencyStatus: 'pending', thumbnailAvailable: false,
      },
    });

    expect(transactionNumber).toBe(4);
    expect(provider.createAsset).toHaveBeenCalledOnce();
    const remoteIdWrites = client.query.mock.calls.filter(([sql, params]) => (
      String(sql).includes("SET provider_asset_id = $2, status = 'processing'")
      && params?.[1] === 'remote-asset-recovery'
    ));
    expect(remoteIdWrites).toHaveLength(2);
  });

  it('callback 可用 nonce 中的远端 token 修复 create-response 丢失窗口，并在事务外权威查单', async () => {
    let transactionDepth = 0;
    let callbackPersistParams: readonly unknown[] | undefined;
    const provider = fakeProvider();
    provider.getVisualValidationResult.mockImplementation(async () => {
      expect(transactionDepth).toBe(0);
      return { groupId: 'group-from-authoritative-query', requestId: 'lookup-request-1' };
    });
    const client = { query: vi.fn(async (sql: unknown, params?: readonly unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT verification_session.id AS session_id')) {
        return result([verificationCallbackRow({
          status: 'submitting',
          byted_token_ciphertext: null,
          byted_token_fingerprint: null,
        })]);
      }
      if (query.includes('SET byted_token_ciphertext = COALESCE')
          && query.includes('CALLBACK_AUTHORITATIVE_LOOKUP_PENDING')) {
        callbackPersistParams = params;
        return result([{}]);
      }
      if (query.includes("operation_type = 'create_visual_validation_session'")) return result([{}]);
      if (query.includes('INSERT INTO real_portrait_remote_operations')
          && query.includes("'get_visual_validation_result'")) return result([{}]);
      if (query.includes('pg_advisory_xact_lock')) return result([]);
      if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
      if (query.includes('FROM user_portrait_quota_states')) return result([quotaState()]);
      if (query.includes('SELECT s.status AS session_status')) {
        return result([verificationResolutionState()]);
      }
      if (query.includes('UPDATE real_portrait_verification_sessions')) return result([{}]);
      if (query.includes('UPDATE real_portrait_authorizations')) return result([{}]);
      if (query.includes('UPDATE real_portrait_materializations')) return result([{}]);
      if (query.includes('UPDATE real_portrait_actors')) return result([{}]);
      if (query.includes('UPDATE real_portrait_invites')) return result([{}]);
      if (query.includes('UPDATE real_portrait_activation_queue')) return result([{}]);
      if (query.includes('UPDATE real_portrait_remote_operations')) return result([{}]);
      if (query.includes('INSERT INTO real_portrait_events')) return result([{}]);
      throw new Error(`未预期查询：${query}`);
    }) };
    mocks.withTransaction.mockImplementation(async callback => {
      transactionDepth += 1;
      try {
        return await callback(client);
      } finally {
        transactionDepth -= 1;
      }
    });

    await expect(handleVolcRealPortraitValidationCallback('opaque-callback-nonce', {
      bytedToken: 'callback-byted-token',
      resultCode: 'untrusted-success',
    }, {
      provider,
      now: () => NOW,
    })).resolves.toEqual({ accepted: true, status: 'verified' });

    expect(callbackPersistParams?.[1]).toBe(JSON.stringify({
      ciphertext: 'callback-byted-token',
      iv: 'iv',
      tag: 'tag',
    }));
    expect(callbackPersistParams?.[2]).toBe('fingerprint:callback-byted-token');
    expect(provider.getVisualValidationResult).toHaveBeenCalledWith('callback-byted-token', 'default');
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('FOR UPDATE OF verification_session, actor, portrait_authorization, materialization')
    ))).toBe(true);
  });

  it('查单 worker 只在 next_retry_at 到期后轮询 invitation_ready，并让到期会话在已到期候选中优先', async () => {
    let transactionDepth = 0;
    let candidateSql = '';
    const provider = fakeProvider();
    provider.getVisualValidationResult.mockImplementation(async () => {
      expect(transactionDepth).toBe(0);
      return { groupId: 'group-worker', requestId: 'lookup-worker' };
    });
    mocks.poolQuery.mockResolvedValue(result([]));
    const client = { query: vi.fn(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM real_portrait_remote_operations op')
          && query.includes("op.operation_type = 'get_visual_validation_result'")) {
        candidateSql = query;
        return result([{
          ...verificationCallbackRow({ status: 'invitation_ready' }),
          operation_id: 'lookup-operation-1',
        }]);
      }
      if (query.includes("SET status = 'submitting', attempt_count")) {
        return result([{ attempt_count: 1 }]);
      }
      if (query.includes('pg_advisory_xact_lock')) return result([]);
      if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
      if (query.includes('FROM user_portrait_quota_states')) return result([quotaState()]);
      if (query.includes('SELECT s.status AS session_status')) {
        return result([verificationResolutionState()]);
      }
      if (query.includes('UPDATE real_portrait_verification_sessions')) return result([{}]);
      if (query.includes('UPDATE real_portrait_authorizations')) return result([{}]);
      if (query.includes('UPDATE real_portrait_materializations')) return result([{}]);
      if (query.includes('UPDATE real_portrait_actors')) return result([{}]);
      if (query.includes('UPDATE real_portrait_invites')) return result([{}]);
      if (query.includes('UPDATE real_portrait_activation_queue')) return result([{}]);
      if (query.includes('UPDATE real_portrait_remote_operations')) return result([{}]);
      if (query.includes('INSERT INTO real_portrait_events')) return result([{}]);
      throw new Error(`未预期查询：${query}`);
    }) };
    mocks.withTransaction.mockImplementation(async callback => {
      transactionDepth += 1;
      try {
        return await callback(client);
      } finally {
        transactionDepth -= 1;
      }
    });

    await expect(processPendingRealPortraitVerificationResults(1, {
      provider,
      now: () => NOW,
    })).resolves.toEqual({ processed: 1 });

    expect(candidateSql).toContain("s.status IN ('submission_unknown', 'invitation_ready', 'waiting')");
    expect(candidateSql).toContain('AND (op.next_retry_at IS NULL OR op.next_retry_at <= $1)');
    expect(candidateSql).not.toContain('OR (s.h5_expires_at IS NOT NULL');
    expect(candidateSql).toContain('ORDER BY (s.h5_expires_at IS NOT NULL AND s.h5_expires_at <= $1) DESC');
    expect(provider.getVisualValidationResult).toHaveBeenCalledWith('worker-byted-token', 'default');
  });

  it('H5 已过期但 next_retry_at 尚未到期时不 claim，也不调用权威查单', async () => {
    let candidateSql = '';
    const provider = fakeProvider();
    mocks.poolQuery.mockResolvedValue(result([]));
    const client = { query: vi.fn(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM real_portrait_remote_operations op')
          && query.includes("op.operation_type = 'get_visual_validation_result'")) {
        candidateSql = query;
        return result([]);
      }
      throw new Error(`未预期查询：${query}`);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(processPendingRealPortraitVerificationResults(1, {
      provider,
      now: () => NOW,
    })).resolves.toEqual({ processed: 0 });

    expect(candidateSql).toContain('AND (op.next_retry_at IS NULL OR op.next_retry_at <= $1)');
    expect(candidateSql).not.toContain('OR (s.h5_expires_at IS NOT NULL');
    expect(provider.getVisualValidationResult).not.toHaveBeenCalled();
  });

  it('权威查单异常按已 claim attempt 指数退避并在 6 小时封顶，且失败落库不重复增加 attempt', async () => {
    const claimedAttempts = [1, 5, 21];
    const retryWrites: Array<readonly unknown[]> = [];
    let candidateReads = 0;
    let claimWrites = 0;
    const provider = fakeProvider();
    provider.getVisualValidationResult.mockRejectedValue(
      Object.assign(new Error('lookup timeout'), { code: 'LOOKUP_TIMEOUT' }),
    );
    mocks.poolQuery.mockResolvedValue(result([]));
    const client = { query: vi.fn(async (sql: unknown, params?: readonly unknown[]) => {
      const query = String(sql);
      if (query.includes('FROM real_portrait_remote_operations op')
          && query.includes("op.operation_type = 'get_visual_validation_result'")) {
        const current = candidateReads;
        candidateReads += 1;
        if (current >= claimedAttempts.length) return result([]);
        return result([{
          ...verificationCallbackRow(),
          operation_id: `lookup-operation-backoff-${current + 1}`,
          attempt_count: claimedAttempts[current] - 1,
        }]);
      }
      if (query.includes("SET status = 'submitting', attempt_count = attempt_count + 1")
          && query.includes("status IN ('prepared', 'failed', 'submission_unknown')")) {
        const attemptCount = claimedAttempts[claimWrites];
        claimWrites += 1;
        return result([{ attempt_count: attemptCount }]);
      }
      if (query.includes('UPDATE real_portrait_verification_sessions')) return result([{}]);
      if (query.includes("SET status = 'submission_unknown', next_retry_at = $2")
          && query.includes('AND attempt_count = $4')) {
        retryWrites.push(params ?? []);
        return result([{}]);
      }
      throw new Error(`未预期查询：${query}`);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(processPendingRealPortraitVerificationResults(3, {
      provider,
      now: () => NOW,
    })).resolves.toEqual({ processed: 3 });

    expect(retryWrites.map(params => params[1])).toEqual([
      new Date('2026-07-30T08:01:00.000Z'),
      new Date('2026-07-30T08:16:00.000Z'),
      new Date('2026-07-30T14:00:00.000Z'),
    ]);
    expect(retryWrites.map(params => params[3])).toEqual(claimedAttempts);
    expect(provider.getVisualValidationResult).toHaveBeenCalledTimes(3);
    expect(client.query.mock.calls.filter(([sql]) => (
      String(sql).includes('attempt_count = attempt_count + 1')
    ))).toHaveLength(3);
  });

  it('已撤回且套餐锁定后迟到 Group 的顺序重放由数据库 claim 栅栏保证只物理删除一次', async () => {
    let candidateReads = 0;
    let cleanupInsertSql = '';
    let cleanupClaimSql = '';
    let cleanupStatus: 'absent' | 'prepared' | 'submitting' | 'completed' = 'absent';
    const provider = fakeProvider();
    provider.getVisualValidationResult.mockResolvedValue({
      groupId: 'late-provider-group-1',
      requestId: 'late-lookup-request-1',
    });
    provider.deleteAssetGroup.mockResolvedValue({
      groupId: 'late-provider-group-1',
      requestId: 'late-delete-request-1',
    });
    mocks.getPortraitEntitlementsForUser.mockResolvedValue({
      sourcePlanId: 'plan-disabled',
      sourcePlanCode: 'portrait-disabled',
      sourcePlanName: '真人停用套餐',
      portraitEnabled: false,
      portraitProfileLimit: 0,
      portraitActiveLimit: 0,
      portraitAssetsPerActor: 0,
    });
    mocks.poolQuery.mockResolvedValue(result([]));
    const client = { query: vi.fn(async (sql: unknown, params?: readonly unknown[]) => {
      const query = String(sql);
      if (query.includes('FROM real_portrait_remote_operations op')
          && query.includes("op.operation_type = 'get_visual_validation_result'")) {
        candidateReads += 1;
        return result([{
          ...verificationCallbackRow(),
          operation_id: `lookup-operation-late-${candidateReads}`,
          attempt_count: candidateReads - 1,
        }]);
      }
      if (query.includes("'expired_verification_delete_group', 'prepared'")) {
        cleanupInsertSql = query;
        expect(params?.[4]).toBe('late-validation-group:verification-session-1');
        if (cleanupStatus === 'absent') cleanupStatus = 'prepared';
        return result([]);
      }
      if (query.includes("operation_type = 'expired_verification_delete_group'")
          && query.includes('RETURNING id')) {
        cleanupClaimSql = query;
        if (cleanupStatus !== 'prepared') return result([]);
        cleanupStatus = 'submitting';
        return result([{ id: 'late-delete-operation-1' }]);
      }
      if (query.includes("SET status = 'submitting', attempt_count = attempt_count + 1")
          && query.includes("status IN ('prepared', 'failed', 'submission_unknown')")) {
        return result([{ attempt_count: candidateReads }]);
      }
      if (query.includes('pg_advisory_xact_lock')) return result([]);
      if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
      if (query.includes('FROM user_portrait_quota_states')) {
        return result([quotaState({
          source_plan_id: 'plan-disabled',
          portrait_enabled: false,
          profile_limit: 0,
          active_limit: 0,
          assets_per_actor: 0,
          grace_status: 'completed',
          grace_until: '2026-07-30T07:59:59.000Z',
        })]);
      }
      if (query.includes('SELECT s.status AS session_status')) {
        return result([verificationResolutionState({
          authorization_status: 'revoked',
          authorization_valid_now: false,
          lifecycle_status: 'revoked',
          plan_access_status: 'plan_locked',
        })]);
      }
      if (query.includes('UPDATE real_portrait_verification_sessions')) return result([{}]);
      if (query.includes('UPDATE real_portrait_authorizations')) return result([{}]);
      if (query.includes('UPDATE real_portrait_materializations')) return result([{}]);
      if (query.includes('UPDATE real_portrait_actors')) return result([{}]);
      if (query.includes("UPDATE real_portrait_remote_operations SET status = 'completed'")
          && params?.[0] === 'late-delete-operation-1') {
        cleanupStatus = 'completed';
        return result([{}]);
      }
      if (query.includes('UPDATE real_portrait_remote_operations')) return result([{}]);
      if (query.includes('INSERT INTO real_portrait_events')) return result([{}]);
      throw new Error(`未预期查询：${query}`);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(processPendingRealPortraitVerificationResults(1, {
      provider,
      now: () => NOW,
    })).resolves.toEqual({ processed: 1 });
    await expect(processPendingRealPortraitVerificationResults(1, {
      provider,
      now: () => NOW,
    })).resolves.toEqual({ processed: 1 });

    expect(provider.getVisualValidationResult).toHaveBeenCalledTimes(2);
    expect(provider.deleteAssetGroup).toHaveBeenCalledOnce();
    expect(provider.deleteAssetGroup).toHaveBeenCalledWith('late-provider-group-1', 'default');
    expect(cleanupInsertSql).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(cleanupClaimSql).toContain("status IN ('prepared', 'failed', 'submission_unknown')");
    expect(cleanupClaimSql).toContain('RETURNING id');
    expect(cleanupStatus).toBe('completed');
    expect(client.query.mock.calls.some(([sql, params]) => (
      String(sql).includes('SET provider_group_id = $2')
      && String(sql).includes("ELSE 'deleting'")
      && String(sql).includes("WHEN status = 'deleted' THEN remote_deleted_at")
      && params?.[1] === 'late-provider-group-1'
    ))).toBe(true);
    expect(client.query.mock.calls.some(([sql, params]) => (
      String(sql).includes("SET status = 'deleted', remote_deleted_at = $2")
      && params?.[0] === 'materialization-1'
    ))).toBe(true);
    expect(client.query.mock.calls.some(([sql, params]) => (
      String(sql).includes("SET status = 'completed'")
      && params?.[0] === 'late-delete-operation-1'
    ))).toBe(true);
  });

  it('CreateVisualValidateSession 确定失败会回滚 verifying 栅栏，以便本人重试', async () => {
    const providerError = Object.assign(new Error('bad request'), {
      statusCode: 400,
      code: 'VOLC_INVALID_REQUEST',
    });
    const provider = fakeProvider();
    provider.createVisualValidationSession.mockRejectedValue(providerError);
    const statusWrites: Array<readonly unknown[]> = [];
    const client = { query: vi.fn(async (sql: unknown, params?: readonly unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT actor.user_id')) return result([{ user_id: 'user-1' }]);
      if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
      if (query.includes('FROM user_portrait_quota_states')) return result([quotaState()]);
      if (query.includes('SELECT i.id AS invite_id')) return result([inviteRow()]);
      if (query.includes('SELECT id, status, h5_link_ciphertext')) return result([]);
      if (query.includes('INSERT INTO real_portrait_verification_sessions')) {
        return result([{ id: 'session-known-failure' }]);
      }
      if (query.includes('INSERT INTO real_portrait_remote_operations')) {
        return result([{ id: 'operation-known-failure' }]);
      }
      if (query.includes("SET lifecycle_status = 'verifying'")) return result([{}]);
      if (query.includes("SET status = 'verifying'")) return result([{}]);
      if (query.includes('SELECT verification_session.status AS session_status')) {
        return result([visualSubmissionState()]);
      }
      if (query.includes('SET updated_at = now()') && query.includes("status = 'submitting'")) {
        return result([{}]);
      }
      if (query.includes('SET status = $2, failure_code = $3')) {
        statusWrites.push(params ?? []);
        return result([{}]);
      }
      if (query.includes('SET status = $2, last_error_code = $3')) {
        statusWrites.push(params ?? []);
        return result([{}]);
      }
      if (query.includes("SET lifecycle_status = 'invited'")) return result([{}]);
      if (query.includes("SET status = 'reserved'")) return result([{}]);
      throw new Error(`未预期查询：${query}`);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(startPublicRealPortraitVerification('invite-token', {
      provider,
      now: () => NOW,
    })).rejects.toBe(providerError);

    expect(statusWrites).toEqual([
      ['session-known-failure', 'failed', 'VOLC_INVALID_REQUEST'],
      ['operation-known-failure', 'failed', 'VOLC_INVALID_REQUEST'],
    ]);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("lifecycle_status = 'invited'")))
      .toBe(true);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'reserved'")))
      .toBe(true);
  });

  it('CreateVisualValidateSession 网络结果不确定时保持 submission_unknown 且不回滚实名栅栏', async () => {
    const providerError = Object.assign(new Error('socket closed'), { code: 'ECONNRESET' });
    const provider = fakeProvider();
    provider.createVisualValidationSession.mockRejectedValue(providerError);
    const statusWrites: Array<readonly unknown[]> = [];
    const client = { query: vi.fn(async (sql: unknown, params?: readonly unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT actor.user_id')) return result([{ user_id: 'user-1' }]);
      if (query.includes('SELECT id FROM users')) return result([{ id: 'user-1' }]);
      if (query.includes('FROM user_portrait_quota_states')) return result([quotaState()]);
      if (query.includes('SELECT i.id AS invite_id')) return result([inviteRow()]);
      if (query.includes('SELECT id, status, h5_link_ciphertext')) return result([]);
      if (query.includes('INSERT INTO real_portrait_verification_sessions')) {
        return result([{ id: 'session-unknown' }]);
      }
      if (query.includes('INSERT INTO real_portrait_remote_operations')) {
        return result([{ id: 'operation-unknown' }]);
      }
      if (query.includes("SET lifecycle_status = 'verifying'")) return result([{}]);
      if (query.includes("SET status = 'verifying'")) return result([{}]);
      if (query.includes('SELECT verification_session.status AS session_status')) {
        return result([visualSubmissionState()]);
      }
      if (query.includes('SET updated_at = now()') && query.includes("status = 'submitting'")) {
        return result([{}]);
      }
      if (query.includes('SET status = $2, failure_code = $3')
          || query.includes('SET status = $2, last_error_code = $3')) {
        statusWrites.push(params ?? []);
        return result([{}]);
      }
      throw new Error(`未预期查询：${query}`);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(startPublicRealPortraitVerification('invite-token', {
      provider,
      now: () => NOW,
    })).rejects.toBe(providerError);

    expect(statusWrites).toEqual([
      ['session-unknown', 'submission_unknown', 'ECONNRESET'],
      ['operation-unknown', 'submission_unknown', 'ECONNRESET'],
    ]);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("SET lifecycle_status = 'invited'")))
      .toBe(false);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'reserved'")))
      .toBe(false);
  });
});

describe('真人肖像本人授权期限', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('从本人同意时刻起固定授权 90 天，并以同一截止时间签发管理令牌', async () => {
    const client = { query: vi.fn(async (sql: unknown, _params?: readonly unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT i.id AS invite_id')) {
        return result([inviteRow({ invite_status: 'pending', accepted_at: null })]);
      }
      return result([]);
    }) };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(acceptPublicRealPortraitInvite('invite-token', {
      accepted: true,
      adultConfirmed: true,
      portraitConsent: true,
      sensitiveFaceConsent: true,
      commercialUseConsent: true,
      authorizationDays: 90,
    })).resolves.toMatchObject({ status: 'accepted' });

    const expectedValidUntil = new Date('2026-10-28T08:00:00.000Z');
    const authorizationUpdate = client.query.mock.calls.find(([sql]) => (
      String(sql).includes("SET status = 'pending', valid_from = $2, valid_until = $3")
    ));
    expect(authorizationUpdate?.[1]).toEqual([
      'authorization-1',
      NOW,
      expectedValidUntil,
    ]);

    const tokenInsert = client.query.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO real_portrait_subject_access_tokens')
    ));
    expect(tokenInsert?.[1]).toEqual([
      'authorization-1',
      'fingerprint:callback-nonce',
      expectedValidUntil,
    ]);

    const consentEvent = client.query.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO real_portrait_events')
    ));
    expect(consentEvent?.[1]).toContainEqual(expect.stringContaining('"authorizationDays":90'));
  });
});

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

function quotaState(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function capacityCounts() {
  return {
    profiles: 1,
    active: 1,
    queued: 0,
    groups_used: 1,
    assets_used: 0,
    groups_reserved: 0,
    assets_reserved: 1,
  };
}

function inviteRow(overrides: Record<string, unknown> = {}) {
  return {
    invite_id: 'invite-1',
    invite_status: 'accepted',
    invite_expires_at: FUTURE,
    accepted_at: '2026-07-30T07:55:00.000Z',
    actor_id: 'actor-1',
    alias: '演员一',
    plan_access_status: 'available',
    lifecycle_status: 'invited',
    controller_name: 'Lindyson AI',
    user_id: 'user-1',
    authorization_id: 'authorization-1',
    authorization_status: 'pending',
    authorization_valid_until: FUTURE,
    purpose: 'AI 视频生成',
    commercial_use: true,
    consented_at: '2026-07-30T07:55:00.000Z',
    portrait_notice_version: 'portrait-v1',
    sensitive_info_notice_version: 'sensitive-v1',
    materialization_id: 'materialization-1',
    materialization_status: 'reserved',
    verification_status: null,
    ...overrides,
  };
}

function visualSubmissionState(overrides: Record<string, unknown> = {}) {
  return {
    session_status: 'submitting',
    byted_token_fingerprint: null,
    authorization_status: 'pending',
    authorization_valid_now: true,
    materialization_status: 'verifying',
    lifecycle_status: 'verifying',
    plan_access_status: 'available',
    operation_status: 'submitting',
    ...overrides,
  };
}

function uploadSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'upload-1',
    user_id: 'user-1',
    actor_id: 'actor-1',
    materialization_id: 'materialization-1',
    kind: 'primary',
    status: 'uploaded',
    object_key: 'real-portrait-uploads/user-1/actor-1/upload-1',
    mime_type: 'image/png',
    expires_at: FUTURE,
    asset_id: 'asset-1',
    provider_group_id: 'group-1',
    project_name: 'default',
    alias: '演员一',
    ...overrides,
  };
}

function preparedUploadRow() {
  return {
    asset_id: 'asset-1',
    operation_id: 'operation-1',
    actor_id: 'actor-1',
    materialization_id: 'materialization-1',
    provider_group_id: 'group-1',
    project_name: 'default',
    kind: 'primary',
  };
}

function uploadSubmissionState(overrides: Record<string, unknown> = {}) {
  return {
    session_status: 'submitting',
    actor_id: 'actor-1',
    materialization_id: 'materialization-1',
    kind: 'primary',
    asset_id: 'asset-1',
    actor_lifecycle_status: 'processing',
    plan_access_status: 'available',
    authorization_status: 'active',
    authorization_valid_now: true,
    materialization_status: 'processing',
    provider_group_id: 'group-1',
    project_name: 'default',
    operation_status: 'submitting',
    asset_status: 'queued',
    provider_asset_id: null,
    ...overrides,
  };
}

function uploadCompletionInput() {
  return {
    mimeType: 'image/png',
    sizeBytes: 1024,
    sha256: 'a'.repeat(64),
  };
}

function verificationCallbackRow(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'verification-session-1',
    actor_id: 'actor-1',
    authorization_id: 'authorization-1',
    byted_token_ciphertext: JSON.stringify({
      ciphertext: 'worker-byted-token',
      iv: 'iv',
      tag: 'tag',
    }),
    byted_token_fingerprint: 'fingerprint:worker-byted-token',
    status: 'submission_unknown',
    user_id: 'user-1',
    materialization_id: 'materialization-1',
    project_name: 'default',
    ...overrides,
  };
}

function verificationResolutionState(overrides: Record<string, unknown> = {}) {
  return {
    session_status: 'submission_unknown',
    authorization_status: 'pending',
    authorization_valid_now: true,
    lifecycle_status: 'verifying',
    plan_access_status: 'available',
    materialization_status: 'verifying',
    grace_valid: false,
    ...overrides,
  };
}

function result<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}
