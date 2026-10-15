import { clearReferralCode } from '../state/referrals';
import { endpointContracts, type EndpointRequestBody, type EndpointRequestParams, type EndpointResponse } from '@lindyson/api-contracts';
import type { ImageGenerationReserveRequest,VideoGenerationReserveRequest } from '../data/admin';
import { ApiError, apiRequest, beginAuthenticatedSession, clearApiSession, jsonBody } from './client';
import { mapAccount, mapAnnouncement, mapAssetCard, mapFeatureFlags, mapFolder, mapInvoice, mapJob, mapOrder, mapPlan, mapRealPortraitActor, mapRealPortraitCapacity, mapTicket, mapTicketMessage, mapUser,mapUserTicket } from './mappers';

type RegisterCodePayload = EndpointRequestBody<'authRegisterCode'>;
type RegisterPayload = EndpointRequestBody<'authRegister'>;
type ResetPasswordPayload = EndpointRequestBody<'authResetPassword'>;
type ProfileUpdatePayload = EndpointRequestBody<'accountProfileUpdate'>;
type PasswordUpdatePayload = EndpointRequestBody<'accountPasswordUpdate'>;
type FolderCreatePayload = EndpointRequestBody<'assetFolderCreate'>;
type UploadSignaturePayload = EndpointRequestBody<'assetUploadSignature'>;
type UploadCompletePayload = EndpointRequestBody<'assetUploadComplete'>;
type PaymentCreatePayload = EndpointRequestBody<'paymentCreate'> & {
  surface: 'pc' | 'mobile';
  idempotencyKey: string;
};
type PaymentChannelPayload = EndpointRequestBody<'adminPaymentChannelSave'>;
type AssetUpdatePayload = EndpointRequestBody<'assetUpdate'>;
type SupportTicketPayload = EndpointRequestBody<'supportTicketCreate'>;
type InvoiceCreatePayload = EndpointRequestBody<'invoiceCreate'>;
type CreditAdjustPayload = EndpointRequestBody<'adminCreditsAdjust'>;
type UserSubscriptionPayload = EndpointRequestBody<'adminUserSubscription'>;

export type UploadSignatureResponse = NonNullable<EndpointResponse<'assetUploadSignature'>['signature']>;
export type UploadSessionResponse = EndpointResponse<'assetUploadSession'>['session'];
export type UploadSignatureResult = EndpointResponse<'assetUploadSignature'>;

export type PlanMutationPayload = EndpointRequestBody<'adminPlanCreate'>
  & Pick<EndpointRequestBody<'adminPlanUpdate'>, 'portraitEntitlements'>;

export async function requestProviderBillingSync(scope: 'all' | 'balance' | 'bill' | 'packages' = 'all') {
  return apiRequest('/api/admin/provider-billing/sync', endpointContracts.adminProviderBillingSync.response, {
    method: 'POST',
    body: jsonBody({ scope }),
  });
}

export async function login(email: string, password: string) {
  const response = await apiRequest('/api/auth/login', endpointContracts.authLogin.response, {
    method: 'POST',
    body: jsonBody({ email, password }),
    sessionScoped: false,
  });
  clearReferralCode();
  beginAuthenticatedSession();
  return mapAccount(response.user);
}

export async function requestRegisterCode(payload: RegisterCodePayload) {
  const response = await apiRequest('/api/auth/register-code', endpointContracts.authRegisterCode.response, {
    method: 'POST',
    body: jsonBody(payload),
  });
  return {
    verificationId: response.verificationId,
    expiresAt: response.expiresAt,
  };
}

export async function register(payload: RegisterPayload) {
  const response = await apiRequest('/api/auth/register', endpointContracts.authRegister.response, {
    method: 'POST',
    body: jsonBody(payload),
    sessionScoped: false,
  });
  clearReferralCode();
  beginAuthenticatedSession();
  return mapAccount(response.user);
}

export async function logout() {
  return apiRequest('/api/auth/logout', endpointContracts.authLogout.response, { method: 'POST', sessionScoped: false });
}

export async function logoutAllDevices() {
  return apiRequest('/api/auth/logout-all', endpointContracts.authLogoutAll.response, { method: 'POST', sessionScoped: false });
}

export async function requestPasswordReset(email: string) {
  return apiRequest('/api/auth/forgot-password', endpointContracts.authForgotPassword.response, {
    method: 'POST',
    body: jsonBody({ email }),
  });
}

export async function resetPassword(payload: ResetPasswordPayload) {
  const response = await apiRequest('/api/auth/reset-password', endpointContracts.authResetPassword.response, {
    method: 'POST',
    body: jsonBody(payload),
  });
  clearApiSession('expired');
  return response;
}

export async function updateProfile(payload: ProfileUpdatePayload) {
  const response = await apiRequest('/api/account/profile', endpointContracts.accountProfileUpdate.response, {
    method: 'PATCH',
    body: jsonBody(payload),
  });
  return mapAccount(response.user);
}

export async function changePassword(payload: PasswordUpdatePayload) {
  const response = await apiRequest('/api/account/password', endpointContracts.accountPasswordUpdate.response, {
    method: 'PATCH',
    body: jsonBody(payload),
  });
  clearReferralCode();
  beginAuthenticatedSession();
  return mapAccount(response.user);
}

export async function createRealPortraitActor(alias: string) {
  const response = await apiRequest('/api/real-portrait-actors', endpointContracts.realPortraitActorCreate.response, {
    method: 'POST',
    body: jsonBody({ alias }),
  });
  return mapRealPortraitActor(response.actor);
}

export async function deleteRealPortraitActor(actorId: string) {
  return apiRequest(
    `/api/real-portrait-actors/${encodeURIComponent(actorId)}`,
    endpointContracts.realPortraitActorDelete.response,
    { method: 'DELETE' },
  );
}

export async function requestRealPortraitActivation(
  actorId: string,
  payload: EndpointRequestBody<'realPortraitActivationCreate'>,
) {
  const response = await apiRequest(
    `/api/real-portrait-actors/${encodeURIComponent(actorId)}/activation-requests`,
    endpointContracts.realPortraitActivationCreate.response,
    { method: 'POST', body: jsonBody(payload) },
  );
  return {
    ...response.activation,
    actor: mapRealPortraitActor(response.activation.actor),
  };
}

export async function createRealPortraitUpload(
  actorId: string,
  payload: EndpointRequestBody<'realPortraitUploadCreate'>,
) {
  const response = await apiRequest(
    `/api/real-portrait-actors/${encodeURIComponent(actorId)}/uploads`,
    endpointContracts.realPortraitUploadCreate.response,
    { method: 'POST', body: jsonBody(payload) },
  );
  return response.upload;
}

export async function completeRealPortraitUpload(
  uploadId: string,
  payload: EndpointRequestBody<'realPortraitUploadComplete'>,
) {
  const response = await apiRequest(
    `/api/real-portrait-uploads/${encodeURIComponent(uploadId)}/complete`,
    endpointContracts.realPortraitUploadComplete.response,
    { method: 'POST', body: jsonBody(payload) },
  );
  return response.asset;
}

export async function deleteRealPortraitAsset(actorId: string, portraitAssetId: string) {
  return apiRequest(
    `/api/real-portrait-actors/${encodeURIComponent(actorId)}/assets/${encodeURIComponent(portraitAssetId)}`,
    endpointContracts.realPortraitAssetDelete.response,
    { method: 'DELETE' },
  );
}

export async function revokeOwnedRealPortraitActor(actorId: string, reasonCode = 'owner-requested') {
  const response = await apiRequest(
    `/api/real-portrait-actors/${encodeURIComponent(actorId)}/revoke`,
    endpointContracts.realPortraitActorRevoke.response,
    { method: 'POST', body: jsonBody({ reasonCode }) },
  );
  return mapRealPortraitActor(response.actor);
}

export async function selectRealPortraitQuotaActors(retainedActorIds: string[], activeActorIds: string[]) {
  const response = await apiRequest(
    '/api/account/real-portrait-quota-selection',
    endpointContracts.accountRealPortraitQuotaSelection.response,
    { method: 'POST', body: jsonBody({ retainedActorIds, activeActorIds }) },
  );
  return mapRealPortraitCapacity(response.capacity);
}

export async function respondToPublicRealPortraitInvite(token: string, accepted: boolean) {
  return apiRequest(
    `/api/public/real-portrait-invites/${encodeURIComponent(token)}`,
    endpointContracts.publicRealPortraitInviteRespond.response,
    {
      method: 'POST',
      body: jsonBody(accepted ? {
        accepted: true,
        adultConfirmed: true,
        portraitConsent: true,
        sensitiveFaceConsent: true,
        commercialUseConsent: true,
        authorizationDays: 90,
      } : { accepted: false }),
      sessionScoped: false,
    },
  );
}

export async function startPublicRealPortraitVerification(token: string) {
  const response = await apiRequest(
    `/api/public/real-portrait-invites/${encodeURIComponent(token)}/start-verification`,
    endpointContracts.publicRealPortraitVerificationStart.response,
    { method: 'POST', sessionScoped: false },
  );
  return response.verification;
}

export async function revokePublicRealPortraitAuthorization(manageToken: string) {
  const response = await apiRequest(
    `/api/public/real-portrait-authorizations/${encodeURIComponent(manageToken)}/revoke`,
    endpointContracts.publicRealPortraitAuthorizationRevoke.response,
    { method: 'POST', body: jsonBody({ reasonCode: 'subject-requested' }), sessionScoped: false },
  );
  return response.authorization;
}

export async function createVideoGenerationBatch(requests: VideoGenerationReserveRequest[], idempotencyKey: string) {
  const response = await apiRequest('/api/ai/video-tasks/batch', endpointContracts.generationBatchCreate.response, {
    method: 'POST',
    body: jsonBody({
      idempotencyKey,
      requests: requests.map(request => ({
        model: request.model,
        prompt: request.prompt,
        config: request.config,
        references: request.references,
        realPortrait: request.realPortrait,
        promptWizardSource: request.promptWizardSource,
        tkPromptSource: request.tkPromptSource,
      })),
    }),
  });
  return response.tasks.map(mapJob);
}

export async function createImageGenerationBatch(requests: ImageGenerationReserveRequest[], idempotencyKey: string) {
  const response = await apiRequest('/api/ai/image-tasks/batch', endpointContracts.imageGenerationBatchCreate.response, {
    method: 'POST',
    body: jsonBody({
      idempotencyKey,
      requests: requests.map(request => ({
        model: request.model,
        prompt: request.prompt,
        config: request.config,
        references: request.references,
        annotations: request.annotations,
      })),
    }),
  });
  return response.tasks.map(mapJob);
}

export async function createPromptWizardRun(imageAssetIds: string[]) {
  const response = await apiRequest(
    '/api/ai/prompt-wizard/runs',
    endpointContracts.promptWizardRunCreate.response,
    {
      method: 'POST',
      body: jsonBody({ imageAssetIds, referenceMode: 'general' }),
    },
  );
  return response.run;
}

export async function createTkPromptRun(payload: EndpointRequestBody<'tkPromptRunCreate'>) {
  const response = await apiRequest(
    '/api/ai/tk-prompt-engine/runs',
    endpointContracts.tkPromptRunCreate.response,
    { method: 'POST', body: jsonBody(payload) },
  );
  return response.run;
}

export async function createTkPromptGeneration(
  runId: string,
  payload: EndpointRequestBody<'tkPromptGenerationCreate'>,
) {
  const response = await apiRequest(
    `/api/ai/tk-prompt-engine/runs/${encodeURIComponent(runId)}/generations`,
    endpointContracts.tkPromptGenerationCreate.response,
    { method: 'POST', body: jsonBody(payload) },
  );
  return response.generation;
}

export async function updatePromptWizardRun(
  id: string,
  payload: EndpointRequestBody<'promptWizardRunUpdate'>,
) {
  const response = await apiRequest(
    `/api/ai/prompt-wizard/runs/${encodeURIComponent(id)}`,
    endpointContracts.promptWizardRunUpdate.response,
    { method: 'PATCH', body: jsonBody(payload) },
  );
  return response.run;
}

export async function createPromptWizardBatch(
  runId: string,
  payload: EndpointRequestBody<'promptWizardBatchCreate'>,
) {
  const response = await apiRequest(
    `/api/ai/prompt-wizard/runs/${encodeURIComponent(runId)}/batches`,
    endpointContracts.promptWizardBatchCreate.response,
    { method: 'POST', body: jsonBody(payload) },
  );
  return response.batch;
}

export async function retryAdminJob(id: string, idempotencyKey: string) {
  const response = await apiRequest(`/api/admin/jobs/${id}/retry`, endpointContracts.adminJobRetry.response, {
    method: 'POST',
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return mapJob(response.task);
}

export async function refundAdminJob(id: string, idempotencyKey: string) {
  const response = await apiRequest(`/api/admin/jobs/${id}/refund`, endpointContracts.adminJobRefund.response, {
    method: 'POST',
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return mapJob(response.task);
}

export async function createFolder(payload: FolderCreatePayload) {
  const response = await apiRequest('/api/assets/folders', endpointContracts.assetFolderCreate.response, {
    method: 'POST',
    body: jsonBody(payload),
  });
  return mapFolder(response.folder);
}

export async function renameFolder(id: string, name: string) {
  const response = await apiRequest(`/api/assets/folders/${id}`, endpointContracts.assetFolderRename.response, {
    method: 'PATCH',
    body: jsonBody({ name }),
  });
  return mapFolder(response.folder);
}

export async function deleteFolder(id: string, contentAction: 'move-to-root' | 'delete-assets') {
  return apiRequest(
    `/api/assets/folders/${encodeURIComponent(id)}?contentAction=${encodeURIComponent(contentAction)}`,
    endpointContracts.assetFolderDelete.response,
    { method: 'DELETE' },
  );
}

export async function createUploadSignature(payload: UploadSignaturePayload, options: { signal?: AbortSignal } = {}) {
  const response = await apiRequest('/api/assets/upload-signature', endpointContracts.assetUploadSignature.response, {
    method: 'POST',
    body: jsonBody(payload),
    signal: options.signal,
  });
  return { ...response, session: mapUploadSession(response.session) };
}

export async function completeUpload(payload: UploadCompletePayload, options: { signal?: AbortSignal } = {}) {
  const response = await apiRequest('/api/assets/complete-upload', endpointContracts.assetUploadComplete.response, {
    method: 'POST',
    body: jsonBody(payload),
    signal: options.signal,
  });
  return mapUploadSession(response.session);
}

export async function getUploadSession(id: string, options: { signal?: AbortSignal } = {}) {
  const response = await apiRequest(`/api/assets/upload-sessions/${id}`, endpointContracts.assetUploadSession.response, {
    signal: options.signal,
  });
  return mapUploadSession(response.session);
}

export async function cancelUploadSession(id: string, options: { signal?: AbortSignal } = {}) {
  const response = await apiRequest(`/api/assets/upload-sessions/${id}/cancel`, endpointContracts.assetUploadSessionCancel.response, {
    method: 'POST',
    signal: options.signal,
  });
  return mapUploadSession(response.session);
}

export async function retryUploadSession(id: string, options: { signal?: AbortSignal } = {}) {
  const response = await apiRequest(`/api/assets/upload-sessions/${id}/retry`, endpointContracts.assetUploadSessionRetry.response, {
    method: 'POST',
    signal: options.signal,
  });
  return mapUploadSession(response.session);
}

function mapUploadSession(session: UploadSessionResponse) {
  return { ...session, asset: session.asset ? mapAssetCard(session.asset) : null };
}

export async function createPayment(payload: PaymentCreatePayload) {
  const response = await apiRequest('/api/payments/create', endpointContracts.paymentCreate.response, {
    method: 'POST',
    body: jsonBody(payload),
  });
  if (response.paymentAttempt.launch !== null && response.paymentAttempt.launch.surface !== payload.surface) {
    throw new ApiError('服务器返回的支付端类型与请求不一致', 502, 'INVALID_API_RESPONSE');
  }
  if (response.payment !== null && response.payment.surface !== payload.surface) {
    throw new ApiError('服务器返回的兼容支付端类型与请求不一致', 502, 'INVALID_API_RESPONSE');
  }
  return {
    order: mapOrder(response.order),
    paymentAttempt: response.paymentAttempt,
    payment: response.payment,
    reused: response.reused ?? false,
  };
}

export async function retryPaymentOrder(id: string, idempotencyKey: string) {
  const response = await apiRequest(`/api/payments/orders/${id}/retry`, endpointContracts.paymentRetry.response, {
    method: 'POST',
    body: jsonBody({ idempotencyKey }),
  });
  return { order: mapOrder(response.order), paymentAttempt: response.paymentAttempt };
}

export async function syncPaymentOrder(id: string, options: { signal?: AbortSignal } = {}) {
  const response = await apiRequest(`/api/payments/orders/${id}/sync`, endpointContracts.paymentSync.response, {
    method: 'POST',
    signal: options.signal,
  });
  return mapOrder(response.order);
}

export async function cancelPaymentOrder(id: string) {
  const response = await apiRequest(`/api/payments/orders/${id}/cancel`, endpointContracts.paymentCancel.response, { method: 'POST' });
  return mapOrder(response.order);
}

export async function savePaymentChannel(payload: PaymentChannelPayload, idempotencyKey: string) {
  const response = await apiRequest('/api/admin/payment-channel', endpointContracts.adminPaymentChannelSave.response, {
    method: 'PUT',
    body: jsonBody(payload),
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return {
    ...response.channel,
    updatedAt: response.channel.updatedAt ?? undefined,
  };
}

export async function updateAsset(id: string, payload: AssetUpdatePayload) {
  const response = await apiRequest(`/api/assets/${id}`, endpointContracts.assetUpdate.response, {
    method: 'PATCH',
    body: jsonBody(payload),
  });
  return mapAssetCard(response.asset);
}

export async function requestAssetDownload(id: string) {
  const response = await apiRequest(
    `/api/assets/${encodeURIComponent(id)}/download`,
    endpointContracts.assetDownloadRequest.response,
    { method: 'POST' },
  );
  return response.download;
}

export async function requestAdminAssetDownload(id: string) {
  const response = await apiRequest(
    `/api/admin/assets/${encodeURIComponent(id)}/download`,
    endpointContracts.adminAssetDownload.response,
    { method: 'POST' },
  );
  return response.download;
}

export async function deleteAsset(id: string) {
  return apiRequest(`/api/assets/${id}`, endpointContracts.assetDelete.response, { method: 'DELETE' });
}

export async function bulkMoveAssets(assetIds: string[], folderId: string | null) {
  const response = await apiRequest('/api/assets/bulk-move', endpointContracts.assetsBulkMove.response, {
    method: 'POST',
    body: jsonBody({ assetIds, folderId }),
  });
  return response.items.map(mapAssetCard);
}

export async function bulkDeleteAssets(assetIds: string[]) {
  return apiRequest('/api/assets/bulk-delete', endpointContracts.assetsBulkDelete.response, {
    method: 'POST',
    body: jsonBody({ assetIds }),
  });
}

export async function createSupportTicket(payload: SupportTicketPayload) {
  const response = await apiRequest('/api/support/tickets', endpointContracts.supportTicketCreate.response, {
    method: 'POST',
    body: jsonBody(payload),
  });
  return mapUserTicket(response.ticket);
}

export async function createSupportTicketMessage(id: string, message: string) {
  const response = await apiRequest(`/api/support/tickets/${id}/messages`, endpointContracts.supportTicketMessageCreate.response, {
    method: 'POST',
    body: jsonBody({ message }),
  });
  return {
    message: mapTicketMessage(response.message),
    ticket: mapUserTicket(response.ticket),
  };
}

export async function markSupportTicketRead(id: string) {
  const response = await apiRequest(`/api/support/tickets/${id}/read`, endpointContracts.supportTicketRead.response, { method: 'POST' });
  return mapUserTicket(response.ticket);
}

export async function createInvoice(payload: InvoiceCreatePayload) {
  const response = await apiRequest('/api/invoices', endpointContracts.invoiceCreate.response, {
    method: 'POST',
    body: jsonBody(payload),
  });
  return mapInvoice(response.invoice);
}

export async function refundOrder(id: string, idempotencyKey: string) {
  const response = await apiRequest(`/api/admin/orders/${id}/refund`, endpointContracts.adminOrderRefund.response, {
    method: 'POST',
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return mapOrder(response.order);
}

export async function syncOrderRefund(id: string) {
  const response = await apiRequest(`/api/admin/orders/${id}/refund/sync`, endpointContracts.adminOrderRefundSync.response, { method: 'POST' });
  return mapOrder(response.order);
}

export async function updateUserStatus(
  id: string,
  status: EndpointRequestBody<'adminUserStatus'>['status'],
  idempotencyKey: string,
) {
  const response = await apiRequest(`/api/admin/users/${id}/status`, endpointContracts.adminUserStatus.response, {
    method: 'PATCH',
    body: jsonBody({ status }),
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return mapUser(response.user);
}

export async function updateUserSubscription(
  id: string,
  payload: UserSubscriptionPayload,
  idempotencyKey: string,
) {
  const response = await apiRequest(
    `/api/admin/users/${id}/subscription`,
    endpointContracts.adminUserSubscription.response,
    {
      method: 'PATCH',
      body: jsonBody(payload),
      headers: adminIdempotencyHeaders(idempotencyKey),
    },
  );
  return { entry: response.entry, user: mapUser(response.user) };
}

export async function adjustCredits(
  payload: CreditAdjustPayload,
  idempotencyKey: string,
) {
  const response = await apiRequest('/api/admin/credits/adjust', endpointContracts.adminCreditsAdjust.response, {
    method: 'POST',
    body: jsonBody(payload),
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return { entry: response.entry, entries: response.entries, user: mapUser(response.user) };
}

export async function updateInvoiceStatus(
  id: string,
  status: EndpointRequestBody<'adminInvoiceStatus'>['status'],
  idempotencyKey: string,
) {
  const response = await apiRequest(`/api/admin/invoices/${id}/status`, endpointContracts.adminInvoiceStatus.response, {
    method: 'PATCH',
    body: jsonBody({ status }),
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return mapInvoice(response.invoice);
}

export async function updateTicketStatus(
  id: string,
  status: EndpointRequestBody<'adminTicketStatus'>['status'],
  idempotencyKey: string,
) {
  const response = await apiRequest(`/api/admin/tickets/${id}/status`, endpointContracts.adminTicketStatus.response, {
    method: 'PATCH',
    body: jsonBody({ status }),
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return mapTicket(response.ticket);
}

export async function createAdminTicketMessage(id: string, message: string, idempotencyKey: string) {
  const response = await apiRequest(`/api/admin/tickets/${id}/messages`, endpointContracts.adminTicketMessageCreate.response, {
    method: 'POST',
    body: jsonBody({ message }),
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return {
    message: mapTicketMessage(response.message),
    ticket: mapTicket(response.ticket),
  };
}

export async function markAdminTicketRead(id: string) {
  const response = await apiRequest(`/api/admin/tickets/${id}/read`, endpointContracts.adminTicketRead.response, { method: 'POST' });
  return mapTicket(response.ticket);
}

export async function patchFeatureFlags(payload: EndpointRequestBody<'adminFeatureFlagsUpdate'>, idempotencyKey: string) {
  const response = await apiRequest('/api/admin/feature-flags', endpointContracts.adminFeatureFlagsUpdate.response, {
    method: 'PATCH',
    body: jsonBody(payload),
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return { flags: mapFeatureFlags(response.flags) };
}

export async function updateConsumptionSetting(
  id: string,
  payload: EndpointRequestBody<'adminConsumptionSettingUpdate'>,
  idempotencyKey: string,
) {
  const response = await apiRequest(`/api/admin/consumption-settings/${id}`, endpointContracts.adminConsumptionSettingUpdate.response, {
    method: 'PATCH',
    body: jsonBody(payload),
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return { setting: response.setting };
}

export async function updateVideoConsumptionModelAvailability(
  model: EndpointRequestParams<'adminVideoConsumptionAvailabilityUpdate'>['model'],
  available: boolean,
  idempotencyKey: string,
) {
  return apiRequest(
    `/api/admin/consumption-settings/video-models/${encodeURIComponent(model)}/availability?videoDuration25=1`,
    endpointContracts.adminVideoConsumptionAvailabilityUpdate.response,
    {
      method: 'PATCH',
      body: jsonBody({ available }),
      headers: adminIdempotencyHeaders(idempotencyKey),
    },
  );
}

export async function updatePromptWizardSettings(
  payload: EndpointRequestBody<'adminPromptWizardSettingsUpdate'>,
  idempotencyKey: string,
) {
  const response = await apiRequest(
    '/api/admin/prompt-wizard-settings',
    endpointContracts.adminPromptWizardSettingsUpdate.response,
    {
      method: 'PATCH',
      body: jsonBody(payload),
      headers: adminIdempotencyHeaders(idempotencyKey),
    },
  );
  return response.promptWizard;
}

export async function updateTkPromptEngineSettings(
  payload: EndpointRequestBody<'adminTkPromptEngineSettingsUpdate'>,
  idempotencyKey: string,
) {
  const response = await apiRequest(
    endpointContracts.adminTkPromptEngineSettingsUpdate.path,
    endpointContracts.adminTkPromptEngineSettingsUpdate.response,
    {
      method: 'PATCH',
      body: jsonBody(payload),
      headers: adminIdempotencyHeaders(idempotencyKey),
    },
  );
  return response.settings;
}

export async function createPlan(payload: PlanMutationPayload, idempotencyKey: string) {
  const response = await apiRequest('/api/admin/plans', endpointContracts.adminPlanCreate.response, {
    method: 'POST',
    body: jsonBody(payload),
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return mapPlan(response.plan);
}

export async function updatePlan(
  id: string,
  payload: EndpointRequestBody<'adminPlanUpdate'>,
  idempotencyKey: string,
) {
  const response = await apiRequest(`/api/admin/plans/${id}`, endpointContracts.adminPlanUpdate.response, {
    method: 'PATCH',
    body: jsonBody(payload),
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return mapPlan(response.plan);
}

export async function createAnnouncement(
  payload: EndpointRequestBody<'adminAnnouncementCreate'>,
  idempotencyKey: string,
) {
  const response = await apiRequest('/api/admin/announcements', endpointContracts.adminAnnouncementCreate.response, {
    method: 'POST',
    body: jsonBody(payload),
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return mapAnnouncement(response.announcement);
}

export async function updateAnnouncement(
  id: string,
  payload: EndpointRequestBody<'adminAnnouncementUpdate'>,
  idempotencyKey: string,
) {
  const response = await apiRequest(`/api/admin/announcements/${id}`, endpointContracts.adminAnnouncementUpdate.response, {
    method: 'PATCH',
    body: jsonBody(payload),
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
  return mapAnnouncement(response.announcement);
}

export async function deleteAnnouncement(id: string, idempotencyKey: string) {
  return apiRequest(`/api/admin/announcements/${id}`, endpointContracts.adminAnnouncementDelete.response, {
    method: 'DELETE',
    headers: adminIdempotencyHeaders(idempotencyKey),
  });
}

function adminIdempotencyHeaders(idempotencyKey: string) {
  return { 'Idempotency-Key': idempotencyKey };
}
