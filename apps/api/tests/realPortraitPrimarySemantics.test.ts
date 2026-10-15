import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { env } from '../src/config/env.js';
import type { RealPortraitProvider } from '../src/providers/realPortraitProvider.js';
import {
  assertRealPortraitGenerationReferenceStillUsableWithClient,
  createRealPortraitActor,
  createRealPortraitUpload,
  requestRealPortraitActivation,
  resolveRealPortraitGenerationReferenceWithClient,
} from '../src/domain/realPortraitService.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const ACTOR_ID = '00000000-0000-4000-8000-000000000011';
const MATERIALIZATION_ID = '00000000-0000-4000-8000-000000000021';
const SECONDARY_ASSET_ID = '00000000-0000-4000-8000-000000000031';
const NOW = new Date('2026-07-30T08:00:00.000Z');

const originalLegalDisclosure = {
  tokenEncryptionKey: env.REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY,
  controllerName: env.REAL_PORTRAIT_CONTROLLER_NAME,
  processorName: env.REAL_PORTRAIT_PROCESSOR_NAME,
  privacyContact: env.REAL_PORTRAIT_PRIVACY_CONTACT,
  privacyPolicyUrl: env.REAL_PORTRAIT_PRIVACY_POLICY_URL,
};

describe('真人权益扩容与主素材锚点', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcileSubscriptionWithClient.mockResolvedValue(undefined);
    mocks.createUploadSignature.mockResolvedValue({
      uploadUrl: 'https://upload.example.com/portrait',
      method: 'PUT',
      headers: {},
    });
    env.REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY = 'test-real-portrait-encryption-key-at-least-32-bytes';
    env.REAL_PORTRAIT_CONTROLLER_NAME = '测试个人信息处理者';
    env.REAL_PORTRAIT_PROCESSOR_NAME = '测试受托处理方';
    env.REAL_PORTRAIT_PRIVACY_CONTACT = 'privacy@example.com';
    env.REAL_PORTRAIT_PRIVACY_POLICY_URL = 'https://example.com/privacy';
  });

  afterAll(() => {
    env.REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY = originalLegalDisclosure.tokenEncryptionKey;
    env.REAL_PORTRAIT_CONTROLLER_NAME = originalLegalDisclosure.controllerName;
    env.REAL_PORTRAIT_PROCESSOR_NAME = originalLegalDisclosure.processorName;
    env.REAL_PORTRAIT_PRIVACY_CONTACT = originalLegalDisclosure.privacyContact;
    env.REAL_PORTRAIT_PRIVACY_POLICY_URL = originalLegalDisclosure.privacyPolicyUrl;
  });

  it.each([
    {
      title: '创建档案不能绕过活跃真人超额',
      usage: { profiles: 1, active: 2, max_assets: 1 },
      run: () => createRealPortraitActor(USER_ID, '演员一'),
      forbiddenSql: 'INSERT INTO real_portrait_actors',
    },
    {
      title: '创建档案不能绕过单人素材超额',
      usage: { profiles: 1, active: 1, max_assets: 2 },
      run: () => createRealPortraitActor(USER_ID, '演员一'),
      forbiddenSql: 'INSERT INTO real_portrait_actors',
    },
    {
      title: '激活新人不能绕过档案总数超额',
      usage: { profiles: 2, active: 0, max_assets: 1 },
      run: () => requestRealPortraitActivation(USER_ID, ACTOR_ID, {
        purpose: '生成已授权的品牌宣传视频',
        commercialUse: true,
        portraitNoticeVersion: 'portrait-v1',
        sensitiveInfoNoticeVersion: 'sensitive-v1',
      }, {
        provider: fakeProvider(),
        now: () => NOW,
      }),
      forbiddenSql: 'FROM real_portrait_actors\n       WHERE id = $1',
    },
  ])('$title', async ({ usage, run, forbiddenSql }) => {
    mocks.getPortraitEntitlementsForUser.mockResolvedValue(entitlements({
      profileLimit: 1,
      activeLimit: 1,
      assetsPerActor: 1,
    }));
    const client = quotaExpansionClient(usage);
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(run()).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_QUOTA_RECONCILIATION_REQUIRED',
      statusCode: 409,
    });

    const usageSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes('AS max_assets'));
    expect(usageSql).toContain('AS profiles');
    expect(usageSql).toContain('AS active');
    expect(usageSql).toContain('live_asset_slots AS');
    expect(usageSql).toContain("asset.provider_asset_id IS NULL AND asset.status = 'queued'");
    expect(usageSql).toContain('upload.asset_id IS NULL');
    expect(usageSql).toContain(
      "upload.status IN ('waiting_upload', 'uploaded', 'submitting', 'processing', 'active')",
    );
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes(forbiddenSql))).toBe(false);
  });

  it('secondary 上传准备要求同一物化已有 active + passed 主素材', async () => {
    mocks.getPortraitEntitlementsForUser.mockResolvedValue(entitlements());
    const client = {
      query: vi.fn(async (sql: unknown) => {
        const query = String(sql);
        if (query.includes('pg_advisory_xact_lock')) return result([]);
        if (query.includes('SELECT id FROM users')) return result([{ id: USER_ID }]);
        if (query.includes('FROM user_portrait_quota_states')) return result([quotaState()]);
        if (query.includes('SELECT m.id, m.status')) {
          return result([{
            id: MATERIALIZATION_ID,
            status: 'active',
            authorization_status: 'active',
            authorization_valid_now: true,
            plan_access_status: 'available',
            actor_lifecycle_status: 'active',
          }]);
        }
        if (query.includes('SELECT primary_asset.id')) return result([]);
        throw new Error(`未预期查询：${query}`);
      }),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(createRealPortraitUpload(USER_ID, ACTOR_ID, {
      kind: 'secondary',
      mimeType: 'image/png',
      sizeBytes: 1024,
    })).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_PRIMARY_ASSET_REQUIRED',
      statusCode: 409,
    });

    const primarySql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes('SELECT primary_asset.id'));
    expect(primarySql).toContain('primary_asset.materialization_id = $1');
    expect(primarySql).toContain("primary_asset.kind = 'primary'");
    expect(primarySql).toContain("primary_asset.status = 'active'");
    expect(primarySql).toContain("primary_asset.consistency_status = 'passed'");
    expect(primarySql).toContain('FOR SHARE OF primary_asset');
    expect(mocks.createUploadSignature).not.toHaveBeenCalled();
  });

  it('显式选择 secondary 也必须由同一物化的 active + passed 主素材锚定', async () => {
    mocks.getPortraitEntitlementsForUser.mockResolvedValue(entitlements());
    const client = generationClient();

    await expect(resolveRealPortraitGenerationReferenceWithClient(client as never, USER_ID, {
      actorId: ACTOR_ID,
      portraitAssetId: SECONDARY_ASSET_ID,
      kind: 'secondary',
    })).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_REFERENCE_UNAVAILABLE',
      statusCode: 409,
    });

    const referenceSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes('SELECT a.id AS actor_id'));
    expect(referenceSql).toContain('JOIN real_portrait_assets primary_asset');
    expect(referenceSql).toContain('primary_asset.materialization_id = m.id');
    expect(referenceSql).toContain("primary_asset.kind = 'primary'");
    expect(referenceSql).toContain("primary_asset.consistency_status = 'passed'");
    expect(referenceSql).toContain('FOR SHARE OF a, auth, m, primary_asset, pa');
  });

  it('任务绑定 secondary 后删除主素材会在供应商提交前立即阻断', async () => {
    mocks.getPortraitEntitlementsForUser.mockResolvedValue(entitlements());
    const client = generationClient({ taskReferenceCount: 1 });

    await expect(assertRealPortraitGenerationReferenceStillUsableWithClient(
      client as never,
      'task-1',
      1,
    )).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_REFERENCE_REVOKED',
      statusCode: 409,
    });

    const revalidationSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes('SELECT ref.position'));
    expect(revalidationSql).toContain('JOIN real_portrait_assets primary_asset');
    expect(revalidationSql).toContain('primary_asset.materialization_id = ref.materialization_id');
    expect(revalidationSql).toContain("primary_asset.status = 'active'");
    expect(revalidationSql).toContain("primary_asset.consistency_status = 'passed'");
    expect(revalidationSql).toContain('FOR SHARE OF a, auth, m, primary_asset, pa');
  });
});

function quotaExpansionClient(usage: {
  profiles: number;
  active: number;
  max_assets: number;
}) {
  return {
    query: vi.fn(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('pg_advisory_xact_lock')) return result([]);
      if (query.includes("SET status = 'expired'") && query.includes('capacity_reservations')) {
        return result([]);
      }
      if (query.includes('SELECT id FROM users')) return result([{ id: USER_ID }]);
      if (query.includes('FROM user_portrait_quota_states')) {
        return result([quotaState({
          profile_limit: 1,
          active_limit: 1,
          assets_per_actor: 1,
          grace_status: 'active',
        })]);
      }
      if (query.includes('AS max_assets')) return result([usage]);
      throw new Error(`未预期查询：${query}`);
    }),
  };
}

function generationClient(input: { taskReferenceCount?: number } = {}) {
  return {
    query: vi.fn(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT task.user_id')) {
        return result([{ user_id: USER_ID, count: input.taskReferenceCount ?? 0 }]);
      }
      if (query.includes('SELECT id FROM users')) return result([{ id: USER_ID }]);
      if (query.includes('FROM user_portrait_quota_states')) return result([quotaState()]);
      if (query.includes('SELECT a.id AS actor_id')) return result([]);
      if (query.includes('SELECT ref.position')) return result([]);
      throw new Error(`未预期查询：${query}`);
    }),
  };
}

function entitlements(overrides: {
  profileLimit?: number;
  activeLimit?: number;
  assetsPerActor?: 1 | 2;
} = {}) {
  return {
    sourcePlanId: 'plan-current',
    sourcePlanCode: 'current',
    sourcePlanName: '当前套餐',
    portraitEnabled: true,
    portraitProfileLimit: overrides.profileLimit ?? 5,
    portraitActiveLimit: overrides.activeLimit ?? 3,
    portraitAssetsPerActor: overrides.assetsPerActor ?? 2,
  };
}

function quotaState(overrides: Record<string, unknown> = {}) {
  return {
    source_plan_id: 'plan-current',
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

function result<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}
