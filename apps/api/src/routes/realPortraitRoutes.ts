import { readRealPortraitThumbnail } from '../domain/realPortraitThumbnails.js';
import {
  endpointContracts,
  volcRealPortraitValidationCallbackPayloadSchema,
} from '@lindyson/api-contracts';
import type { FastifyInstance } from 'fastify';
import { enforceAuthRateLimit } from '../auth/rateLimit.js';
import { requireAdmin, requireAuth } from '../auth/session.js';
import { env } from '../config/env.js';
import {
  acceptPublicRealPortraitInvite,
  completeRealPortraitUpload,
  createRealPortraitActor,
  createRealPortraitUpload,
  deleteRealPortraitActor,
  deleteRealPortraitAsset,
  getPublicRealPortraitInvite,
  getPublicRealPortraitInviteStatus,
  getAdminRealPortraitCapacity,
  getRealPortraitActor,
  getRealPortraitAuthorizationByManageToken,
  getRealPortraitCapacity,
  handleVolcRealPortraitValidationCallback,
  listRealPortraitActors,
  requestRealPortraitActivation,
  revokeOwnedRealPortraitActor,
  revokeRealPortraitAuthorizationByManageToken,
  selectRealPortraitQuotaActors,
  startPublicRealPortraitVerification,
} from '../domain/realPortraitService.js';

export async function registerRealPortraitRoutes(app: FastifyInstance) {
  app.get('/api/admin/real-portrait-capacity', async request => {
    await requireAdmin(request);
    return getAdminRealPortraitCapacity();
  });

  app.get('/api/real-portrait-actors', async request => {
    const user = await requireAuth(request);
    return listRealPortraitActors(user.id);
  });

  app.post('/api/real-portrait-actors', async request => {
    const user = await requireAuth(request);
    await enforceAuthRateLimit(request, {
      scope: 'real-portrait-actor-create', identity: user.id,
      maxAttempts: 20, ipMaxAttempts: 100, windowSeconds: 60 * 60,
    });
    const body = endpointContracts.realPortraitActorCreate.body.parse(request.body);
    return { actor: await createRealPortraitActor(user.id, body.alias) };
  });

  app.get('/api/real-portrait-actors/:actorId', async request => {
    const user = await requireAuth(request);
    const { actorId } = endpointContracts.realPortraitActor.params.parse(request.params);
    return { actor: await getRealPortraitActor(user.id, actorId) };
  });

  app.delete('/api/real-portrait-actors/:actorId', async request => {
    const user = await requireAuth(request);
    const { actorId } = endpointContracts.realPortraitActorDelete.params.parse(request.params);
    return deleteRealPortraitActor(user.id, actorId);
  });

  app.post('/api/real-portrait-actors/:actorId/activation-requests', async request => {
    const user = await requireAuth(request);
    await enforceAuthRateLimit(request, {
      scope: 'real-portrait-activation', identity: user.id,
      maxAttempts: 10, ipMaxAttempts: 50, windowSeconds: 60 * 60,
    });
    const { actorId } = endpointContracts.realPortraitActivationCreate.params.parse(request.params);
    const body = endpointContracts.realPortraitActivationCreate.body.parse(request.body);
    return { activation: await requestRealPortraitActivation(user.id, actorId, body) };
  });

  app.post('/api/real-portrait-actors/:actorId/uploads', async request => {
    const user = await requireAuth(request);
    await enforceAuthRateLimit(request, {
      scope: 'real-portrait-upload-create', identity: user.id,
      maxAttempts: 30, ipMaxAttempts: 100, windowSeconds: 60 * 60,
    });
    const { actorId } = endpointContracts.realPortraitUploadCreate.params.parse(request.params);
    const body = endpointContracts.realPortraitUploadCreate.body.parse(request.body);
    return createRealPortraitUpload(user.id, actorId, body);
  });

  app.post('/api/real-portrait-uploads/:uploadId/complete', async request => {
    const user = await requireAuth(request);
    await enforceAuthRateLimit(request, {
      scope: 'real-portrait-upload-complete', identity: user.id,
      maxAttempts: 60, ipMaxAttempts: 200, windowSeconds: 60 * 60,
    });
    const { uploadId } = endpointContracts.realPortraitUploadComplete.params.parse(request.params);
    const body = endpointContracts.realPortraitUploadComplete.body.parse(request.body);
    return completeRealPortraitUpload(user.id, uploadId, body);
  });

  app.get('/api/real-portrait-actors/:actorId/assets/:portraitAssetId/thumbnail', async (request, reply) => {
    const user = await requireAuth(request);
    const { actorId, portraitAssetId } = endpointContracts.realPortraitAssetThumbnail.params.parse(request.params);
    const stream = await readRealPortraitThumbnail(user.id, actorId, portraitAssetId);
    return reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff')
      .type('image/webp').send(stream);
  });

  app.delete('/api/real-portrait-actors/:actorId/assets/:portraitAssetId', async request => {
    const user = await requireAuth(request);
    const { actorId, portraitAssetId } = endpointContracts.realPortraitAssetDelete.params.parse(request.params);
    return deleteRealPortraitAsset(user.id, actorId, portraitAssetId);
  });

  app.post('/api/real-portrait-actors/:actorId/revoke', async request => {
    const user = await requireAuth(request);
    const { actorId } = endpointContracts.realPortraitActorRevoke.params.parse(request.params);
    const body = endpointContracts.realPortraitActorRevoke.body.parse(request.body);
    const result = await revokeOwnedRealPortraitActor(user.id, actorId, body);
    return { actor: result.actor };
  });

  app.get('/api/real-portrait-capacity', async request => {
    const user = await requireAuth(request);
    return { capacity: await getRealPortraitCapacity(user.id) };
  });

  app.post('/api/account/real-portrait-quota-selection', async request => {
    const user = await requireAuth(request);
    await enforceAuthRateLimit(request, {
      scope: 'real-portrait-quota-selection', identity: user.id,
      maxAttempts: 30, ipMaxAttempts: 100, windowSeconds: 60 * 60,
    });
    const body = endpointContracts.accountRealPortraitQuotaSelection.body.parse(request.body);
    return selectRealPortraitQuotaActors(user.id, body);
  });

  app.get('/api/public/real-portrait-invites/:token', async request => {
    const { token } = endpointContracts.publicRealPortraitInvite.params.parse(request.params);
    return { invite: await getPublicRealPortraitInvite(token) };
  });

  app.post('/api/public/real-portrait-invites/:token', async request => {
    const { token } = endpointContracts.publicRealPortraitInviteRespond.params.parse(request.params);
    await enforceAuthRateLimit(request, {
      scope: 'real-portrait-consent', identity: token,
      maxAttempts: 10, ipMaxAttempts: 50, windowSeconds: 15 * 60,
    });
    const body = endpointContracts.publicRealPortraitInviteRespond.body.parse(request.body);
    return acceptPublicRealPortraitInvite(token, body);
  });

  app.post('/api/public/real-portrait-invites/:token/start-verification', async request => {
    const { token } = endpointContracts.publicRealPortraitVerificationStart.params.parse(request.params);
    await enforceAuthRateLimit(request, {
      scope: 'real-portrait-verification-start', identity: token,
      maxAttempts: 5, ipMaxAttempts: 25, windowSeconds: 60 * 60,
    });
    return { verification: await startPublicRealPortraitVerification(token) };
  });

  app.get('/api/public/real-portrait-invites/:token/status', async request => {
    const { token } = endpointContracts.publicRealPortraitInviteStatus.params.parse(request.params);
    await enforceAuthRateLimit(request, {
      scope: 'real-portrait-verification-status', identity: token,
      maxAttempts: 360, ipMaxAttempts: 3_000, windowSeconds: 15 * 60,
    });
    return getPublicRealPortraitInviteStatus(token);
  });

  app.get('/api/public/real-portrait-authorizations/:manageToken', async request => {
    const { manageToken } = endpointContracts.publicRealPortraitAuthorization.params.parse(request.params);
    await enforceAuthRateLimit(request, {
      scope: 'real-portrait-authorization-read', identity: manageToken,
      maxAttempts: 120, ipMaxAttempts: 600, windowSeconds: 60 * 60,
    });
    return { authorization: await getRealPortraitAuthorizationByManageToken(manageToken) };
  });

  app.post('/api/public/real-portrait-authorizations/:manageToken/revoke', async request => {
    const { manageToken } = endpointContracts.publicRealPortraitAuthorizationRevoke.params.parse(request.params);
    await enforceAuthRateLimit(request, {
      scope: 'real-portrait-authorization-revoke', identity: manageToken,
      maxAttempts: 10, ipMaxAttempts: 50, windowSeconds: 60 * 60,
    });
    const body = endpointContracts.publicRealPortraitAuthorizationRevoke.body.parse(request.body);
    return revokeRealPortraitAuthorizationByManageToken(manageToken, body);
  });

  app.post('/api/providers/volc/real-portrait-validation/:opaqueNonce', async request => {
    const { opaqueNonce } = endpointContracts.volcRealPortraitValidationCallback.params.parse(request.params);
    await enforceAuthRateLimit(request, {
      scope: 'real-portrait-provider-callback', identity: opaqueNonce,
      maxAttempts: 60, ipMaxAttempts: 300, windowSeconds: 15 * 60,
    });
    const body = endpointContracts.volcRealPortraitValidationCallback.body.parse(request.body);
    return handleVolcRealPortraitValidationCallback(opaqueNonce, body);
  });

  app.get('/api/providers/volc/real-portrait-validation/:opaqueNonce', async (request, reply) => {
    const { opaqueNonce } = endpointContracts.volcRealPortraitValidationCallback.params.parse(request.params);
    await enforceAuthRateLimit(request, {
      scope: 'real-portrait-provider-callback', identity: opaqueNonce,
      maxAttempts: 60, ipMaxAttempts: 300, windowSeconds: 15 * 60,
    });
    // 火山 H5 会在浏览器回跳时附带额外诊断参数。这里只提取可信查单所需字段，
    // 未知字段由 Zod 默认剥离，最终状态仍以 GetVisualValidateResult 为准。
    const query = volcRealPortraitValidationCallbackPayloadSchema.parse(request.query);
    const result = await handleVolcRealPortraitValidationCallback(opaqueNonce, query);
    const completionUrl = new URL('/portrait-consent/verification-complete', env.APP_BASE_URL);
    completionUrl.hash = `status=${encodeURIComponent(result.status)}`;
    return reply
      .header('Cache-Control', 'no-store, max-age=0')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Robots-Tag', 'noindex, nofollow')
      .redirect(completionUrl.toString(), 303);
  });
}
