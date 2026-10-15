import { Readable } from 'node:stream';
import fastify from 'fastify';
import type { InjectOptions, Response as LightMyRequestResponse } from 'light-my-request';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enforceAuthRateLimit: vi.fn(),
  requireAdmin: vi.fn(),
  requireAuth: vi.fn(),
  acceptPublicRealPortraitInvite: vi.fn(),
  completeRealPortraitUpload: vi.fn(),
  readRealPortraitThumbnail: vi.fn(),
  createRealPortraitActor: vi.fn(),
  createRealPortraitUpload: vi.fn(),
  deleteRealPortraitActor: vi.fn(),
  deleteRealPortraitAsset: vi.fn(),
  getPublicRealPortraitInvite: vi.fn(),
  getPublicRealPortraitInviteStatus: vi.fn(),
  getAdminRealPortraitCapacity: vi.fn(),
  getRealPortraitActor: vi.fn(),
  getRealPortraitAuthorizationByManageToken: vi.fn(),
  getRealPortraitCapacity: vi.fn(),
  handleVolcRealPortraitValidationCallback: vi.fn(),
  listRealPortraitActors: vi.fn(),
  requestRealPortraitActivation: vi.fn(),
  revokeOwnedRealPortraitActor: vi.fn(),
  revokeRealPortraitAuthorizationByManageToken: vi.fn(),
  selectRealPortraitQuotaActors: vi.fn(),
  startPublicRealPortraitVerification: vi.fn(),
}));

vi.mock('../src/domain/realPortraitThumbnails.js', () => ({ readRealPortraitThumbnail: mocks.readRealPortraitThumbnail }));

vi.mock('../src/auth/session.js', () => ({
  requireAdmin: mocks.requireAdmin,
  requireAuth: mocks.requireAuth,
}));

vi.mock('../src/auth/rateLimit.js', () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
}));

vi.mock('../src/domain/realPortraitService.js', () => ({
  acceptPublicRealPortraitInvite: mocks.acceptPublicRealPortraitInvite,
  completeRealPortraitUpload: mocks.completeRealPortraitUpload,
  createRealPortraitActor: mocks.createRealPortraitActor,
  createRealPortraitUpload: mocks.createRealPortraitUpload,
  deleteRealPortraitActor: mocks.deleteRealPortraitActor,
  deleteRealPortraitAsset: mocks.deleteRealPortraitAsset,
  getPublicRealPortraitInvite: mocks.getPublicRealPortraitInvite,
  getPublicRealPortraitInviteStatus: mocks.getPublicRealPortraitInviteStatus,
  getAdminRealPortraitCapacity: mocks.getAdminRealPortraitCapacity,
  getRealPortraitActor: mocks.getRealPortraitActor,
  getRealPortraitAuthorizationByManageToken: mocks.getRealPortraitAuthorizationByManageToken,
  getRealPortraitCapacity: mocks.getRealPortraitCapacity,
  handleVolcRealPortraitValidationCallback: mocks.handleVolcRealPortraitValidationCallback,
  listRealPortraitActors: mocks.listRealPortraitActors,
  requestRealPortraitActivation: mocks.requestRealPortraitActivation,
  revokeOwnedRealPortraitActor: mocks.revokeOwnedRealPortraitActor,
  revokeRealPortraitAuthorizationByManageToken: mocks.revokeRealPortraitAuthorizationByManageToken,
  selectRealPortraitQuotaActors: mocks.selectRealPortraitQuotaActors,
  startPublicRealPortraitVerification: mocks.startPublicRealPortraitVerification,
}));

import { registerRealPortraitRoutes } from '../src/routes/realPortraitRoutes.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const INVITE_TOKEN = 'invite_token_abcdefghijklmnopqrstuvwxyz123456';
const MANAGE_TOKEN = 'manage_token_abcdefghijklmnopqrstuvwxyz123456';
const CALLBACK_NONCE = 'callback_nonce_abcdefghijklmnopqrstuvwxyz1234';

describe('真人素材路由契约路径与响应包装', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.enforceAuthRateLimit.mockResolvedValue(undefined);
    mocks.requireAuth.mockResolvedValue({
      id: 'user-1',
      email: 'member@lindyson.ai',
      role: 'user',
    });
    mocks.requireAdmin.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@lindyson.ai',
      role: 'admin',
    });
  });

  it('缩略图要求登录并返回不缓存的WebP流', async () => {
    mocks.readRealPortraitThumbnail.mockResolvedValue(Readable.from(Buffer.from('webp')));
    const url = `/api/real-portrait-actors/${ACTOR_ID}/assets/${ACTOR_ID}/thumbnail`;
    const response = await inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toBe('webp');
    expect(mocks.readRealPortraitThumbnail).toHaveBeenCalledWith('user-1', ACTOR_ID, ACTOR_ID);
    mocks.readRealPortraitThumbnail.mockClear();
    mocks.requireAuth.mockRejectedValue(Object.assign(new Error('未登录'), { statusCode: 401 }));
    expect((await inject({ method: 'GET', url })).statusCode).toBe(401);
    expect(mocks.readRealPortraitThumbnail).not.toHaveBeenCalled();
  });

  it('admin capacity GET 必须通过管理员鉴权并直接返回 service payload', async () => {
    const payload = {
      global: {
        groupSoftLimit: 45,
        assetSoftLimit: 45,
        groupsUsed: 12,
        assetsUsed: 18,
        groupsReserved: 1,
        assetsReserved: 2,
      },
      listInfo: {
        users: { total: 0, returned: 0, truncated: false },
        queue: { total: 0, waiting: 0, returned: 0, truncated: false },
        remoteDeleteFailures: { total: 0, returned: 0, truncated: false },
      },
      users: [],
      queue: [],
      remoteDeleteFailures: [],
    };
    mocks.getAdminRealPortraitCapacity.mockResolvedValue(payload);

    const response = await inject({
      method: 'GET',
      url: '/api/admin/real-portrait-capacity',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.requireAuth).not.toHaveBeenCalled();
    expect(mocks.getAdminRealPortraitCapacity).toHaveBeenCalledWith();
    expect(response.json()).toEqual(payload);
    expect(response.json()).not.toHaveProperty('capacity');
  });

  it('activation-requests 使用契约路径并包装为 { activation }', async () => {
    const activation = {
      actor: { id: ACTOR_ID, alias: '演员一' },
      queuePosition: 2,
      invitationUrl: 'https://www.lindyson.com/invite/example',
      invitationExpiresAt: '2026-07-30T02:00:00.000Z',
    };
    mocks.requestRealPortraitActivation.mockResolvedValue(activation);
    const body = {
      purpose: '授权用于商业 AI 视频生成',
      commercialUse: true,
      portraitNoticeVersion: 'portrait-v1',
      sensitiveInfoNoticeVersion: 'sensitive-v1',
    };

    const response = await inject({
      method: 'POST',
      url: `/api/real-portrait-actors/${ACTOR_ID}/activation-requests`,
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.requireAuth).toHaveBeenCalledTimes(1);
    expect(mocks.requestRealPortraitActivation).toHaveBeenCalledWith(
      'user-1',
      ACTOR_ID,
      body,
    );
    expect(response.json()).toEqual({ activation });
  });

  it('activation-requests 拒绝客户端指定授权截止时间', async () => {
    const response = await inject({
      method: 'POST',
      url: `/api/real-portrait-actors/${ACTOR_ID}/activation-requests`,
      payload: {
        purpose: '授权用于商业 AI 视频生成',
        commercialUse: true,
        portraitNoticeVersion: 'portrait-v1',
        sensitiveInfoNoticeVersion: 'sensitive-v1',
        validUntil: '2027-07-30T00:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(mocks.requestRealPortraitActivation).not.toHaveBeenCalled();
  });

  it('capacity GET 使用独立契约路径并包装为 { capacity }', async () => {
    const capacity = {
      entitlements: {
        enabled: true,
        profileLimit: 5,
        activeLimit: 2,
        assetsPerActor: 2,
      },
      usage: { profiles: 1, active: 1, queued: 0 },
      global: {
        groupSoftLimit: 45,
        assetSoftLimit: 45,
        groupsUsed: 1,
        assetsUsed: 2,
        groupsReserved: 0,
        assetsReserved: 0,
      },
      quotaState: null,
    };
    mocks.getRealPortraitCapacity.mockResolvedValue(capacity);

    const response = await inject({
      method: 'GET',
      url: '/api/real-portrait-capacity',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.getRealPortraitCapacity).toHaveBeenCalledWith('user-1');
    expect(response.json()).toEqual({ capacity });
  });

  it('公开邀请明确传递 accepted=false，且不要求登录', async () => {
    mocks.acceptPublicRealPortraitInvite.mockResolvedValue({
      status: 'declined',
      manageUrl: null,
    });

    const response = await inject({
      method: 'POST',
      url: `/api/public/real-portrait-invites/${INVITE_TOKEN}`,
      payload: { accepted: false },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.acceptPublicRealPortraitInvite).toHaveBeenCalledWith(
      INVITE_TOKEN,
      { accepted: false },
    );
    expect(mocks.requireAuth).not.toHaveBeenCalled();
    expect(response.json()).toEqual({
      status: 'declined',
      manageUrl: null,
    });
  });

  it('公开邀请只在四项授权与 90 天期限全部明确同意后传递完整证据', async () => {
    mocks.acceptPublicRealPortraitInvite.mockResolvedValue({
      status: 'accepted',
      manageUrl: 'https://www.lindyson.com/portrait-consent/authorization/example',
    });
    const decision = {
      accepted: true,
      adultConfirmed: true,
      portraitConsent: true,
      sensitiveFaceConsent: true,
      commercialUseConsent: true,
      authorizationDays: 90,
    } as const;

    const response = await inject({
      method: 'POST',
      url: `/api/public/real-portrait-invites/${INVITE_TOKEN}`,
      payload: decision,
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.acceptPublicRealPortraitInvite).toHaveBeenCalledWith(INVITE_TOKEN, decision);
    expect(mocks.requireAuth).not.toHaveBeenCalled();
  });

  it('start-verification 使用公开契约路径并包装为 { verification }', async () => {
    const verification = {
      status: 'verification-ready',
      verificationUrl: 'https://verify.example.com/session',
      expiresAt: '2026-07-30T02:00:00.000Z',
      queuePosition: null,
    };
    mocks.startPublicRealPortraitVerification.mockResolvedValue(verification);

    const response = await inject({
      method: 'POST',
      url: `/api/public/real-portrait-invites/${INVITE_TOKEN}/start-verification`,
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.startPublicRealPortraitVerification).toHaveBeenCalledWith(INVITE_TOKEN);
    expect(mocks.requireAuth).not.toHaveBeenCalled();
    expect(response.json()).toEqual({ verification });
  });

  it('授权管理读取使用无 /revoke 的 GET，GET /revoke 不存在', async () => {
    const authorization = {
      status: 'active',
      controllerName: 'Lindyson AI',
      purpose: '商业 AI 视频生成',
      commercialUse: true,
      validUntil: '2027-07-30T00:00:00.000Z',
      cleanupStatus: 'not-requested',
    };
    mocks.getRealPortraitAuthorizationByManageToken.mockResolvedValue(authorization);

    const managedResponse = await inject({
      method: 'GET',
      url: `/api/public/real-portrait-authorizations/${MANAGE_TOKEN}`,
    });
    const nonexistentRevokeGet = await inject({
      method: 'GET',
      url: `/api/public/real-portrait-authorizations/${MANAGE_TOKEN}/revoke`,
    });

    expect(managedResponse.statusCode).toBe(200);
    expect(managedResponse.json()).toEqual({ authorization });
    expect(mocks.getRealPortraitAuthorizationByManageToken).toHaveBeenCalledWith(MANAGE_TOKEN);
    expect(nonexistentRevokeGet.statusCode).toBe(404);
    expect(mocks.getRealPortraitAuthorizationByManageToken).toHaveBeenCalledTimes(1);
  });

  it('Volc H5 callback 接受真实 GET 查询参数并 303 到无凭证完成页', async () => {
    mocks.handleVolcRealPortraitValidationCallback.mockResolvedValue({
      accepted: true,
      status: 'verified',
    });

    const query = new URLSearchParams({
      bytedToken: 'byted-token-from-volc',
      resultCode: '10000',
      algorithmBaseRespCode: '0',
      reqMeasureInfoValue: '1',
      verify_type: 'real_time',
    });
    const response = await inject({
      method: 'GET',
      url: `/api/providers/volc/real-portrait-validation/${CALLBACK_NONCE}?${query}`,
    });

    expect(response.statusCode).toBe(303);
    expect(mocks.enforceAuthRateLimit).toHaveBeenCalledWith(expect.anything(), {
      scope: 'real-portrait-provider-callback',
      identity: CALLBACK_NONCE,
      maxAttempts: 60,
      ipMaxAttempts: 300,
      windowSeconds: 15 * 60,
    });
    expect(mocks.handleVolcRealPortraitValidationCallback).toHaveBeenCalledWith(
      CALLBACK_NONCE,
      {
        bytedToken: 'byted-token-from-volc',
        resultCode: '10000',
      },
    );
    const location = new URL(String(response.headers.location));
    expect(location.pathname).toBe('/portrait-consent/verification-complete');
    expect(location.search).toBe('');
    expect(location.hash).toBe('#status=verified');
    expect(location.toString()).not.toContain('byted-token-from-volc');
    expect(response.headers['cache-control']).toBe('no-store, max-age=0');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('Volc callback 保留 POST JSON 向后兼容', async () => {
    mocks.handleVolcRealPortraitValidationCallback.mockResolvedValue({
      accepted: true,
      status: 'verified',
    });

    const response = await inject({
      method: 'POST',
      url: `/api/providers/volc/real-portrait-validation/${CALLBACK_NONCE}`,
      payload: {
        bytedToken: 'byted-token-from-volc',
        resultCode: '10000',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.handleVolcRealPortraitValidationCallback).toHaveBeenCalledWith(
      CALLBACK_NONCE,
      {
        bytedToken: 'byted-token-from-volc',
        resultCode: '10000',
      },
    );
    expect(response.json()).toEqual({
      accepted: true,
      status: 'verified',
    });
  });
});

async function inject(input: InjectOptions): Promise<LightMyRequestResponse> {
  const app = fastify({ logger: false });
  app.register(registerRealPortraitRoutes);
  try {
    return await app.inject(input);
  } finally {
    await app.close();
  }
}
