import {
  endpointContracts,
  type EndpointContractName,
  type EndpointRequestQuery,
  type EndpointResponse,
} from '@lindyson/api-contracts';
import type {
  AdminApiCostAttemptFilters,
  AdminApiCostAttemptPage,
  AdminApiCostDashboardFilters,
  AdminApiCostDashboardSnapshot,
  AdminApiCostFilters,
  AdminApiCostOverviewSnapshot,
  AdminApiCostReconciliationDetail,
  AdminApiCostReconciliationFilters,
  AdminApiCostReconciliationPage,
  AdminApiCostSettlementFilters,
  AdminApiCostSettlementPage,
  AdminApiCostTaskPage,
  AdminApiCostUserPage,
  AdminMultimodalCostOperationFilters,
  AdminMultimodalCostOperationPage,
  AdminMultimodalCostOverview,
  AdminMultimodalCostOverviewFilters,
  AdminMultimodalCostUserFilters,
  AdminMultimodalCostUserPage,
  AdminImageCostOverview,
  AdminImageCostOverviewFilters,
  AdminImageCostTaskFilters,
  AdminImageCostTaskPage,
  AdminImageCostUserFilters,
  AdminImageCostUserPage,
  AdminProviderBillingDetailsFilters,
  AdminProviderBillingDetailsPage,
  AdminProviderBillingFilters,
  AdminProviderBillingOperationalUsageFilters,
  AdminProviderBillingOperationalUsagePage,
  AdminProviderBillingOverview,
  AdminGenerationJob,
  CreditType,
  OrderHistoryFilter,
  OrderHistoryPage,
  Priority,
  UserTicket,
} from '../data/admin';
import type { Asset,AssetSort,AssetSource,AssetSummary } from '../data/assets';
import { apiRequest } from './client';
import {
  normalizeExactCursorPagination,
  type CursorPageInput,
  type ExactCursorPage,
} from './cursor';
import {
  mapAccount,
  mapAdminJobCard,
  mapAnnouncement,
  mapApiCostAttempt,
  mapApiCostDashboard,
  mapApiCostTask,
  mapApiCostUser,
  mapAsset,
  mapAssetCard,
  mapAudit,
  mapConsumptionSettings,
  mapFeatureFlags,
  mapFolder,
  mapInvoice,
  mapJob,
  mapLedger,
  mapUserLedger,
  mapOrder,
  mapPlan,
  mapRealPortraitActor,
  mapRealPortraitCapacity,
  mapTicket,
  mapTicketMessage,
  mapUserTicket,
  mapUser,
} from './mappers';

export type AdminRealPortraitCapacity = EndpointResponse<'adminRealPortraitCapacity'>;

export async function getPublicPlans() {
  const response = await apiRequest('/api/subscription/plans', endpointContracts.publicPlans.response);
  return response.items.map(mapPlan);
}

export async function getAnnouncements() {
  const response = await apiRequest('/api/announcements', endpointContracts.publicAnnouncements.response);
  return response.items.map(mapAnnouncement);
}

export async function getMe() {
  const response = await apiRequest('/api/auth/me', endpointContracts.authMe.response);
  return mapAccount(response.user);
}

export async function getRealPortraitActors(signal?: AbortSignal) {
  const response = await apiRequest('/api/real-portrait-actors', endpointContracts.realPortraitActors.response, { signal });
  return {
    items: response.items.map(mapRealPortraitActor),
    capacity: mapRealPortraitCapacity(response.capacity),
  };
}

export async function getRealPortraitActor(actorId: string, signal?: AbortSignal) {
  const response = await apiRequest(
    `/api/real-portrait-actors/${encodeURIComponent(actorId)}`,
    endpointContracts.realPortraitActor.response,
    { signal },
  );
  return mapRealPortraitActor(response.actor);
}

export async function getRealPortraitCapacity(signal?: AbortSignal) {
  const response = await apiRequest('/api/real-portrait-capacity', endpointContracts.realPortraitCapacity.response, { signal });
  return mapRealPortraitCapacity(response.capacity);
}

export async function getPublicRealPortraitInvite(token: string, signal?: AbortSignal) {
  const response = await apiRequest(
    `/api/public/real-portrait-invites/${encodeURIComponent(token)}`,
    endpointContracts.publicRealPortraitInvite.response,
    { signal, sessionScoped: false },
  );
  return response.invite;
}

export async function getPublicRealPortraitInviteStatus(token: string, signal?: AbortSignal) {
  return apiRequest(
    `/api/public/real-portrait-invites/${encodeURIComponent(token)}/status`,
    endpointContracts.publicRealPortraitInviteStatus.response,
    { signal, sessionScoped: false },
  );
}

export async function getPublicRealPortraitAuthorization(manageToken: string, signal?: AbortSignal) {
  const response = await apiRequest(
    `/api/public/real-portrait-authorizations/${encodeURIComponent(manageToken)}`,
    endpointContracts.publicRealPortraitAuthorization.response,
    { signal, sessionScoped: false },
  );
  return response.authorization;
}

export async function getDashboardSummary() {
  return apiRequest('/api/account/dashboard-summary', endpointContracts.accountDashboard.response);
}

export async function getCreditLedgerPage(input: CursorPageInput & { type?: CreditType } = {}, signal?: AbortSignal) {
  return mapExactCursorPage(
    await apiRequest(
      withCursorQuery('/api/account/credit-ledger', input, input.type ? { type: input.type } : undefined),
      endpointContracts.accountCreditLedger.response,
      { signal },
    ),
    mapUserLedger,
    input,
  );
}

export async function getAccountFeatureFlags() {
  const response = await apiRequest('/api/account/feature-flags', endpointContracts.accountFeatureFlags.response);
  return mapFeatureFlags(response.flags);
}

export async function getAssetCardsPage(input: CursorPageInput & {
  source?: AssetSource;
  type?: Asset['type'];
  folderId?: string | null;
  search?: string;
  sort?: AssetSort;
} = {}, signal?: AbortSignal) {
  const extra: Record<string, string> = {};
  if (input.source) extra.source = input.source;
  if (input.type) extra.type = input.type;
  if (input.folderId) extra.folderId = input.folderId;
  if (input.search?.trim()) extra.search = input.search.trim();
  if (input.sort) extra.sort = input.sort;
  return mapExactCursorPage(
    await apiRequest(
      withCursorQuery('/api/assets/cards', input, extra),
      endpointContracts.assetCards.response,
      { signal },
    ),
    mapAssetCard,
    input,
  );
}

export async function getAssetSummary(signal?: AbortSignal): Promise<AssetSummary> {
  const response = await apiRequest('/api/assets/summary', endpointContracts.assetSummary.response, { signal });
  return response.summary;
}

export async function getAssetDetail(id: string, signal?: AbortSignal) {
  const response = await apiRequest(
    `/api/assets/${encodeURIComponent(id)}`,
    endpointContracts.assetDetail.response,
    { signal },
  );
  return mapAsset(response.asset);
}

export async function getAssetFolders(source?: AssetSource, signal?: AbortSignal) {
  const suffix = source ? `?source=${encodeURIComponent(source)}` : '';
  const response = await apiRequest(`/api/assets/folders${suffix}`, endpointContracts.assetFolders.response, { signal });
  return response.items.map(mapFolder);
}

export async function getOrderHistory(input: CursorPageInput & {
  limit: number;
  status: OrderHistoryFilter;
  invoiceable?: boolean;
}, signal?: AbortSignal): Promise<OrderHistoryPage> {
  const params = new URLSearchParams({ limit: String(input.limit) });
  if (input.cursor) params.set('cursor', input.cursor);
  if (input.snapshotCursor) params.set('snapshotCursor', input.snapshotCursor);
  if (input.position) params.set('position', input.position);
  if (input.status !== 'all') params.set('status', input.status);
  if (input.invoiceable) params.set('invoiceable', '1');
  const response = await apiRequest(`/api/orders?${params.toString()}`, endpointContracts.orders.response, { signal });
  return {
    items: response.items.map(mapOrder),
    pagination: normalizeExactCursorPagination({
      ...response.pagination,
      position: input.position ?? 'first',
    }),
  };
}

export async function getSupportTicketsPage(input: CursorPageInput & {
  status?: UserTicket['status'];
  priority?: Priority;
  search?: string;
} = {}, signal?: AbortSignal) {
  return mapExactCursorPage(
    await apiRequest(
      withCursorQuery('/api/support/tickets', input, stringParams(input, ['status', 'priority', 'search'])),
      endpointContracts.supportTickets.response,
      { signal },
    ),
    mapUserTicket,
    input,
  );
}

export function getSupportSummary(signal?: AbortSignal) {
  return apiRequest('/api/support/summary', endpointContracts.supportSummary.response, { signal });
}

export async function getSupportTicketMessages(id: string) {
  const response = await apiRequest(`/api/support/tickets/${id}/messages`, endpointContracts.supportTicketMessages.response);
  return response.items.map(mapTicketMessage);
}

export async function getAdminPlans(signal?: AbortSignal) {
  const response = await apiRequest('/api/admin/plans', endpointContracts.adminPlans.response, { signal });
  return response.items.map(mapPlan);
}

export function getAdminRealPortraitCapacity(signal?: AbortSignal) {
  return apiRequest(
    '/api/admin/real-portrait-capacity',
    endpointContracts.adminRealPortraitCapacity.response,
    { signal },
  );
}

export async function getAdminPaymentChannel(signal?: AbortSignal) {
  const response = await apiRequest('/api/admin/payment-channel', endpointContracts.adminPaymentChannel.response, { signal });
  return {
    ...response.channel,
    updatedAt: response.channel.updatedAt ?? undefined,
  };
}

export async function getAdminAnnouncementsPage(input: CursorEndpointQuery<'adminAnnouncements'> = {}, signal?: AbortSignal) {
  return mapExactCursorPage(
    await apiRequest(
      withCursorQuery('/api/admin/announcements', input, stringParams(input, ['search'])),
      endpointContracts.adminAnnouncements.response,
      { signal },
    ),
    mapAnnouncement,
    input,
  );
}

export async function getAdminUsersPage(input: CursorEndpointQuery<'adminUsers'> = {}, signal?: AbortSignal) {
  return mapExactCursorPage(
    await apiRequest(
      withCursorQuery('/api/admin/users', input, stringParams(input, ['search', 'status'])),
      endpointContracts.adminUsers.response,
      { signal },
    ),
    mapUser,
    input,
  );
}

export async function getAdminOrdersPage(input: CursorEndpointQuery<'adminOrders'> = {}, signal?: AbortSignal) {
  return mapExactCursorPage(
    await apiRequest(
      withCursorQuery('/api/admin/orders', input, stringParams(input, ['search', 'status', 'userId', 'from', 'to'])),
      endpointContracts.adminOrders.response,
      { signal },
    ),
    mapOrder,
    input,
  );
}

export async function getAdminOverview(signal?: AbortSignal) {
  const response = await apiRequest('/api/admin/overview', endpointContracts.adminOverview.response, { signal });
  return { ...response.summary, apiCostHealth: response.apiCostHealth };
}

export async function getAdminInvoicesPage(input: CursorEndpointQuery<'adminInvoices'> = {}, signal?: AbortSignal) {
  return mapExactCursorPage(
    await apiRequest(
      withCursorQuery('/api/admin/invoices', input, stringParams(input, ['search', 'status', 'userId', 'orderId'])),
      endpointContracts.adminInvoices.response,
      { signal },
    ),
    mapInvoice,
    input,
  );
}

export async function getAdminTicketsPage(input: CursorEndpointQuery<'adminTickets'> = {}, signal?: AbortSignal) {
  return mapExactCursorPage(
    await apiRequest(
      withCursorQuery('/api/admin/tickets', input, stringParams(input, ['search', 'status', 'priority'])),
      endpointContracts.adminTickets.response,
      { signal },
    ),
    mapTicket,
    input,
  );
}

export async function getAdminTicketMessages(id: string) {
  const response = await apiRequest(`/api/admin/tickets/${id}/messages`, endpointContracts.adminTicketMessages.response);
  return response.items.map(mapTicketMessage);
}

export async function getAdminJobsPage(input: CursorEndpointQuery<'adminJobs'> = {}, signal?: AbortSignal) {
  return mapExactCursorPage(
    await apiRequest(
      withCursorQuery('/api/admin/jobs', input, stringParams(input, ['search', 'status', 'userId'])),
      endpointContracts.adminJobs.response,
      { signal },
    ),
    mapAdminJobCard,
    input,
  );
}

export async function getAdminAsset(id: string) {
  const response = await apiRequest(
    `/api/admin/assets/${encodeURIComponent(id)}`,
    endpointContracts.adminAsset.response,
  );
  return mapAsset(response.asset);
}

export async function getAdminCreditLedgerPage(input: CursorEndpointQuery<'adminCreditLedger'> = {}, signal?: AbortSignal) {
  return mapExactCursorPage(
    await apiRequest(
      withCursorQuery('/api/admin/credit-ledger', input, stringParams(input, ['search', 'type', 'userId', 'relatedOrderId', 'relatedJobId'])),
      endpointContracts.adminCreditLedger.response,
      { signal },
    ),
    mapLedger,
    input,
  );
}

export async function getAdminAuditLogsPage(input: CursorEndpointQuery<'adminAuditLogs'> = {}, signal?: AbortSignal) {
  return mapExactCursorPage(
    await apiRequest(
      withCursorQuery('/api/admin/audit-logs', input, stringParams(input, ['search', 'risk', 'module'])),
      endpointContracts.adminAuditLogs.response,
      { signal },
    ),
    mapAudit,
    input,
  );
}

export function getAdminNavigationSummary(signal?: AbortSignal) {
  return apiRequest('/api/admin/navigation-summary', endpointContracts.adminNavigationSummary.response, { signal });
}

export function getAdminOrdersSummary(
  input: EndpointRequestQuery<'adminOrdersSummary'> = {},
  signal?: AbortSignal,
) {
  return apiRequest(
    withQuery('/api/admin/orders/summary', stringParams(input, ['from', 'to'])),
    endpointContracts.adminOrdersSummary.response,
    { signal },
  );
}

export async function getAdminOrderDetail(id: string, signal?: AbortSignal) {
  const response = await apiRequest(
    `/api/admin/orders/${encodeURIComponent(id)}`,
    endpointContracts.adminOrderDetail.response,
    { signal },
  );
  return {
    order: mapOrder(response.order),
    invoice: response.invoice ? mapInvoice(response.invoice) : null,
    creditLedger: response.creditLedger.map(mapLedger),
  };
}

export async function getAdminJobDetail(id: string, signal?: AbortSignal) {
  const response = await apiRequest(
    `/api/admin/jobs/${encodeURIComponent(id)}`,
    endpointContracts.adminJobDetail.response,
    { signal },
  );
  return mapJob(response.task);
}

export async function getConsumptionSettings(signal?: AbortSignal) {
  const response = await apiRequest('/api/ai/consumption-settings?videoDuration25=1', endpointContracts.generationConsumptionSettings.response, { signal });
  return mapConsumptionSettings(
    response.items,
    response.promptWizard,
    (response as typeof response & { videoModels?: unknown }).videoModels,
    response.tkPromptEngine,
  );
}

export async function getPromptWizardRun(id: string, signal?: AbortSignal) {
  const response = await apiRequest(
    `/api/ai/prompt-wizard/runs/${encodeURIComponent(id)}`,
    endpointContracts.promptWizardRun.response,
    { signal },
  );
  return response.run;
}

export async function getPromptWizardBatch(id: string, signal?: AbortSignal) {
  const response = await apiRequest(
    `/api/ai/prompt-wizard/batches/${encodeURIComponent(id)}`,
    endpointContracts.promptWizardBatch.response,
    { signal },
  );
  return response.batch;
}

export async function resumePromptWizard(signal?: AbortSignal) {
  return apiRequest(
    '/api/ai/prompt-wizard/resume',
    endpointContracts.promptWizardResume.response,
    { signal },
  );
}

export async function getTkPromptRun(id: string, signal?: AbortSignal) {
  const response = await apiRequest(
    `/api/ai/tk-prompt-engine/runs/${encodeURIComponent(id)}`,
    endpointContracts.tkPromptRun.response,
    { signal },
  );
  return response.run;
}

export async function getTkPromptGeneration(id: string, signal?: AbortSignal) {
  const response = await apiRequest(
    `/api/ai/tk-prompt-engine/generations/${encodeURIComponent(id)}`,
    endpointContracts.tkPromptGeneration.response,
    { signal },
  );
  return response.generation;
}

export async function resumeTkPromptEngine(signal?: AbortSignal) {
  return apiRequest(
    '/api/ai/tk-prompt-engine/resume',
    endpointContracts.tkPromptResume.response,
    { signal },
  );
}

export async function getFeatureFlags(signal?: AbortSignal) {
  const response = await apiRequest('/api/admin/feature-flags', endpointContracts.adminFeatureFlags.response, { signal });
  return mapFeatureFlags(response.flags);
}

export async function getAdminApiUsage(
  input: AdminApiCostDashboardFilters = {},
  signal?: AbortSignal,
): Promise<AdminApiCostDashboardSnapshot> {
  const response = await apiRequest(
    withQuery('/api/admin/api-usage', apiCostDashboardFilterParams(input)),
    endpointContracts.adminApiUsage.response,
    { signal },
  );
  return mapApiCostDashboard(response);
}

export async function getAdminApiUsageOverview(
  input: AdminApiCostDashboardFilters = {},
  signal?: AbortSignal,
): Promise<AdminApiCostOverviewSnapshot> {
  return apiRequest(
    withQuery('/api/admin/api-usage/overview', apiCostDashboardFilterParams(input)),
    endpointContracts.adminApiUsageOverview.response,
    { signal },
  );
}

export async function getAdminApiCostReconciliationPage(
  input: CursorPageInput & AdminApiCostReconciliationFilters = {},
  signal?: AbortSignal,
): Promise<AdminApiCostReconciliationPage> {
  return apiRequest(
    withCursorQuery('/api/admin/api-usage/reconciliation', input, apiCostReconciliationFilterParams(input)),
    endpointContracts.adminApiUsageReconciliation.response,
    { signal },
  );
}

export async function getAdminApiCostReconciliationDetail(
  id: string,
  asOf?: string,
  signal?: AbortSignal,
): Promise<AdminApiCostReconciliationDetail> {
  return apiRequest(
    withQuery(
      `/api/admin/api-usage/reconciliation/${encodeURIComponent(id)}`,
      asOf ? { asOf } : {},
    ),
    endpointContracts.adminApiUsageReconciliationDetail.response,
    { signal },
  );
}

export async function getAdminApiCostSettlementPage(
  input: CursorPageInput & AdminApiCostSettlementFilters = {},
  signal?: AbortSignal,
): Promise<AdminApiCostSettlementPage> {
  return apiRequest(
    withCursorQuery('/api/admin/api-usage/settlement', input, apiCostSettlementFilterParams(input)),
    endpointContracts.adminApiUsageSettlement.response,
    { signal },
  );
}

export async function getAdminProviderBillingOverview(
  input: AdminProviderBillingFilters = {},
  signal?: AbortSignal,
): Promise<AdminProviderBillingOverview> {
  return apiRequest(
    withQuery('/api/admin/provider-billing/overview', providerBillingFilterParams(input)),
    endpointContracts.adminProviderBillingOverview.response,
    { signal },
  );
}

export async function getAdminProviderBillingDetailsPage(
  input: CursorPageInput & AdminProviderBillingDetailsFilters = {},
  signal?: AbortSignal,
): Promise<AdminProviderBillingDetailsPage> {
  return apiRequest(
    withCursorQuery('/api/admin/provider-billing/details', input, providerBillingFilterParams(input)),
    endpointContracts.adminProviderBillingDetails.response,
    { signal },
  );
}

export async function getAdminProviderBillingOperationalUsagePage(
  input: CursorPageInput & AdminProviderBillingOperationalUsageFilters = {},
  signal?: AbortSignal,
): Promise<AdminProviderBillingOperationalUsagePage> {
  return apiRequest(
    withCursorQuery('/api/admin/provider-billing/operational-usage', input, providerBillingFilterParams(input)),
    endpointContracts.adminProviderBillingOperationalUsage.response,
    { signal },
  );
}

export async function getAdminApiCostTasksPage(
  input: CursorPageInput & AdminApiCostFilters = {},
  signal?: AbortSignal,
): Promise<AdminApiCostTaskPage> {
  const response = await apiRequest(
    withCursorQuery('/api/admin/api-usage/tasks', input, apiCostFilterParams(input)),
    endpointContracts.adminApiUsageTasks.response,
    { signal },
  );
  return { ...response, items: response.items.map(mapApiCostTask) };
}

export async function getAdminApiCostAttemptsPage(
  input: CursorPageInput & AdminApiCostAttemptFilters = {},
  signal?: AbortSignal,
): Promise<AdminApiCostAttemptPage> {
  const response = await apiRequest(
    withCursorQuery('/api/admin/api-usage/attempts', input, apiCostAttemptFilterParams(input)),
    endpointContracts.adminApiUsageAttempts.response,
    { signal },
  );
  return { ...response, items: response.items.map(mapApiCostAttempt) };
}

export async function getAdminApiCostUsersPage(
  input: CursorPageInput & AdminApiCostFilters = {},
  signal?: AbortSignal,
): Promise<AdminApiCostUserPage> {
  const response = await apiRequest(
    withCursorQuery('/api/admin/api-usage/users', input, apiCostBusinessFilterParams(input)),
    endpointContracts.adminApiUsageUsers.response,
    { signal },
  );
  return { ...response, items: response.items.map(mapApiCostUser) };
}

export async function getAdminImageCostOverview(
  input: AdminImageCostOverviewFilters = {},
  signal?: AbortSignal,
): Promise<AdminImageCostOverview> {
  return apiRequest(
    withQuery('/api/admin/api-usage/image/overview', imageCostFilterParams(input)),
    endpointContracts.adminApiUsageImageOverview.response,
    { signal },
  );
}

export async function getAdminImageCostUsersPage(
  input: CursorPageInput & AdminImageCostUserFilters = {},
  signal?: AbortSignal,
): Promise<AdminImageCostUserPage> {
  return apiRequest(
    withCursorQuery('/api/admin/api-usage/image/users', input, imageCostFilterParams(input)),
    endpointContracts.adminApiUsageImageUsers.response,
    { signal },
  );
}

export async function getAdminImageCostTasksPage(
  input: CursorPageInput & AdminImageCostTaskFilters = {},
  signal?: AbortSignal,
): Promise<AdminImageCostTaskPage> {
  return apiRequest(
    withCursorQuery('/api/admin/api-usage/image/tasks', input, imageCostFilterParams(input)),
    endpointContracts.adminApiUsageImageTasks.response,
    { signal },
  );
}

export async function getAdminMultimodalCostOverview(
  input: AdminMultimodalCostOverviewFilters = {},
  signal?: AbortSignal,
): Promise<AdminMultimodalCostOverview> {
  const response = await apiRequest(
    withQuery('/api/admin/api-usage/multimodal/overview', multimodalCostFilterParams(input)),
    endpointContracts.adminApiUsageMultimodalOverview.response,
    { signal },
  );
  return {
    ...response,
    summary: withHistoricalPricedOperationCount(response.summary),
    models: response.models.map(withHistoricalPricedOperationCount),
  } as AdminMultimodalCostOverview;
}

export async function getAdminMultimodalCostUsersPage(
  input: CursorPageInput & AdminMultimodalCostUserFilters = {},
  signal?: AbortSignal,
): Promise<AdminMultimodalCostUserPage> {
  const response = await apiRequest(
    withCursorQuery('/api/admin/api-usage/multimodal/users', input, multimodalCostFilterParams(input)),
    endpointContracts.adminApiUsageMultimodalUsers.response,
    { signal },
  );
  return {
    ...response,
    items: response.items.map(withHistoricalPricedOperationCount),
  } as AdminMultimodalCostUserPage;
}

export async function getAdminMultimodalCostOperationsPage(
  input: CursorPageInput & AdminMultimodalCostOperationFilters = {},
  signal?: AbortSignal,
): Promise<AdminMultimodalCostOperationPage> {
  const response = await apiRequest(
    withCursorQuery('/api/admin/api-usage/multimodal/operations', input, multimodalCostFilterParams(input)),
    endpointContracts.adminApiUsageMultimodalOperations.response,
    { signal },
  );
  return {
    ...response,
    items: response.items.map(item => ({
      ...item,
      priceVersion: item.priceVersion ?? null,
      pricingSourceUrl: item.pricingSourceUrl ?? null,
    })),
  } as AdminMultimodalCostOperationPage;
}

function withHistoricalPricedOperationCount<T extends object>(value: T) {
  const candidate = (value as T & { historicalPricedOperationCount?: unknown })
    .historicalPricedOperationCount;
  return {
    ...value,
    historicalPricedOperationCount: typeof candidate === 'number'
      && Number.isSafeInteger(candidate)
      && candidate >= 0
      ? candidate
      : 0,
  };
}

export async function getGenerationJobsPage(
  input: CursorPageInput & {
    status?: AdminGenerationJob['status'];
    kind?: AdminGenerationJob['kind'];
  } = {},
  signal?: AbortSignal,
) {
  return mapExactCursorPage(
    await apiRequest(
      withCursorQuery('/api/ai/tasks', input, stringParams(input, ['status', 'kind'])),
      endpointContracts.generationTasks.response,
      { signal },
    ),
    mapJob,
    input,
  );
}

export async function getGenerationJob(id: string) {
  const response = await apiRequest(
    `/api/ai/tasks/${encodeURIComponent(id)}`,
    endpointContracts.generationTask.response,
  );
  return mapJob(response.task);
}

function withCursorQuery(
  path: string,
  input: CursorPageInput,
  extra?: Record<string, string>,
) {
  const params = new URLSearchParams(extra);
  if (input.position) params.set('position', input.position);
  if (input.cursor) params.set('cursor', input.cursor);
  if (input.snapshotCursor) params.set('snapshotCursor', input.snapshotCursor);
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

type CursorEndpointQuery<Name extends EndpointContractName> =
  Omit<EndpointRequestQuery<Name>, keyof CursorPageInput> & CursorPageInput;

function withQuery(path: string, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return query ? `${path}?${query}` : path;
}

function apiCostFilterParams(input: AdminApiCostFilters) {
  return stringParams(input, [
    'range', 'month', 'date', 'from', 'to', 'model', 'asOf', 'resolution', 'status', 'costState', 'search',
  ]);
}

function apiCostBusinessFilterParams(input: AdminApiCostFilters) {
  return stringParams(input, [
    'range', 'month', 'date', 'from', 'to', 'model', 'asOf', 'resolution', 'status', 'search',
  ]);
}

function apiCostAttemptFilterParams(input: AdminApiCostAttemptFilters) {
  return stringParams(input, [
    'range', 'month', 'date', 'from', 'to', 'model', 'asOf', 'resolution', 'pricingResolution',
    'inputClass', 'status', 'estimateStatus', 'usageEvidenceOrigin', 'pricingRuleStatus',
    'attributionConfidence', 'search',
  ]);
}

function apiCostDashboardFilterParams(input: AdminApiCostDashboardFilters) {
  return stringParams(input, ['range', 'month', 'date', 'from', 'to', 'model', 'asOf']);
}

function apiCostReconciliationFilterParams(input: AdminApiCostReconciliationFilters) {
  return stringParams(input, [
    'range', 'month', 'date', 'from', 'to', 'model', 'asOf', 'pricingResolution', 'inputClass',
    'unitPriceCnyPerMillion', 'billLineType', 'matchState', 'attributionConfidence',
  ]);
}

function apiCostSettlementFilterParams(input: AdminApiCostSettlementFilters) {
  return stringParams(input, [
    'range', 'month', 'date', 'from', 'to', 'model', 'asOf', 'billLineType', 'paymentStatus',
  ]);
}

function providerBillingFilterParams(input: object) {
  return stringParams(input, [
    'range', 'month', 'date', 'from', 'to', 'product', 'serviceType', 'model', 'finality',
    'attributionStatus', 'search', 'asOf',
  ]);
}

function multimodalCostFilterParams(input: object) {
  return stringParams(input, [
    'range', 'month', 'date', 'from', 'to', 'model', 'asOf', 'operationType', 'status', 'search',
  ]);
}

function imageCostFilterParams(input: object) {
  return stringParams(input, [
    'range', 'month', 'date', 'from', 'to', 'asOf', 'status', 'evidenceStatus', 'search',
  ]);
}

function stringParams(input: object, allowedKeys: readonly string[]) {
  const allowed = new Set(allowedKeys);
  return Object.fromEntries(Object.entries(input).filter(
    ([key, value]) => allowed.has(key) && typeof value === 'string' && value.length > 0,
  )) as Record<string, string>;
}

function mapExactCursorPage<Row, Item>(
  response: {
    items: Row[];
    pagination: {
      limit: number;
      position?: CursorPageInput['position'];
      hasPrevious: boolean;
      hasNext: boolean;
      previousCursor: string | null;
      nextCursor: string | null;
      currentPage: number;
      totalPages: number;
      totalItems: number;
      snapshotCursor: string;
    };
  },
  mapper: (item: Row) => Item,
  request: CursorPageInput = {},
): ExactCursorPage<Item> {
  return {
    items: response.items.map(mapper),
    pagination: normalizeExactCursorPagination({
      ...response.pagination,
      position: response.pagination.position ?? request.position ?? 'first',
    }),
  };
}
