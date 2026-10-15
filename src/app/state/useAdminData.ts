import { keepPreviousData,useQuery,useQueryClient } from '@tanstack/react-query';
import { useCallback,useEffect,useMemo,useRef,useState,type Dispatch,type SetStateAction } from 'react';
import { toast } from 'sonner';
import type { CursorPage,ExactCursorPage,PagePosition } from '../api/cursor';
import { isPaginationSnapshotChanged,retryUnlessPaginationSnapshotChanged } from '../api/client';
import { IdempotencyKeyRegistry,runIdempotentMutation } from '../api/idempotency';
import { privateQueryKey } from '../api/queryClient';
import * as mutations from '../api/mutations';
import * as queries from '../api/queries';
import type {
  AdminApiCostAttempt,
  AdminApiCostAttemptFilters,
  AdminApiCostDashboard,
  AdminApiCostDashboardSnapshot,
  AdminApiCostFilters,
  AdminApiCostLoadState,
  AdminApiCostOverviewSnapshot,
  AdminApiCostPageKind,
  AdminApiCostPaginationState,
  AdminApiCostResourceState,
  AdminApiCostTask,
  AdminApiCostUser,
  AdminAuditLog,
  AdminCreditLedgerEntry,
  AdminGenerationJob,
  AdminInvoiceRequest,
  AdminOrder,
  AdminOverviewSummary,
  AdminPaymentChannel,
  AdminPlan,
  AdminTicket,
  AdminUser,
  AdminUserSubscriptionUpdate,
  PlatformAnnouncement,
  TicketMessage,
} from '../data/admin';
import { apiCostFilterKey } from '../data/apiCostFilters';
import { refundFeedback } from '../data/paymentState';
import type { ConsumptionSettings } from '../data/consumption';
import type { FeatureFlags } from '../data/featureFlags';
import { EMPTY_CONSUMPTION_SETTINGS } from './useGeneration';
import { cursorPageRequestIdentity,useCursorPagination } from './useCursorPagination';

export { apiCostFilterKey } from '../data/apiCostFilters';

const EMPTY_PAYMENT_CHANNEL: AdminPaymentChannel = {
  enabled: false,
  apiBase: '',
  mchNo: '',
  appId: '',
  hasApiKey: false,
  desktopWayCode: 'ALI_WAP',
  mobileWayCode: 'ALI_WAP',
};

function createEmptyApiCostDashboard(): AdminApiCostDashboard {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const monthStart = `${today.slice(0, 7)}-01`;
  const asOf = new Date().toISOString();
  const emptyCoverage = { start: null, end: null, status: 'unavailable' as const, reason: '尚未同步' };
  const emptySettlement = {
    rangeStart: monthStart,
    rangeEnd: today,
    timezone: 'Asia/Shanghai' as const,
    coverageStatus: 'unavailable' as const,
    coverageReason: '尚未同步官方账单',
    usageOriginalAmountCny: null,
    usagePayableAmountCny: null,
    usagePaidAmountCny: null,
    usageUnpaidAmountCny: null,
    packagePurchaseAmountCny: null,
    packagePurchasePaidAmountCny: null,
    packagePurchaseUnpaidAmountCny: null,
    paygPayableAmountCny: null,
    listPriceOffsetValueCny: null,
    listPriceOffsetStatus: 'unavailable' as const,
    refundAmountCny: null,
    billingAdjustmentAmountCny: null,
    netOfficialPayableCny: null,
    openingPrepaidAssetCny: null,
    acquisitionCostCny: null,
    openingCatchUpCny: null,
    amortizedCostCny: null,
    expiryLossCny: null,
    adjustmentCny: null,
    endingPrepaidAssetCny: null,
    allocationStatus: 'unavailable' as const,
    timeAttributionStatus: 'unavailable' as const,
    timeAttributionReason: '尚无资源包成本事件可用于时间归属',
  };
  return {
    asOf,
    selection: {
      range: 'month',
      month: today.slice(0, 7),
      date: null,
      rangeStart: monthStart,
      rangeEnd: today,
      timezone: 'Asia/Shanghai',
      grain: 'day',
    },
    coverage: {
      local: emptyCoverage,
      official: emptyCoverage,
      comparable: emptyCoverage,
      excludedPeriods: [],
    },
    currentState: {
      capturedAt: asOf,
      balanceSnapshotAt: '-',
      packageSnapshotAt: '-',
      historicalFilterAppliedToAccount: false,
      historicalFilterAppliedToPackages: false,
      historicalFilterAppliedToPricing: false,
    },
    combinedStatus: {
      billState: 'unavailable',
      matchState: 'cannot-reconcile',
      coverageState: 'unavailable',
      label: '账单未同步 · 暂不可对账',
    },
    books: {
      usage: {
        rawLocalTokens: null,
        inferredAdjustmentTokens: null,
        adjustedLocalTokens: null,
        officialTokens: null,
        rawTokenDelta: null,
        explainedTokenDelta: null,
        timingShiftTokens: null,
        residualTokens: null,
        rawCoveragePercent: null,
        adjustedCoveragePercent: null,
      },
      valuation: {
        localEstimateCompleteness: 'unavailable',
        officialEstimateCompleteness: 'unavailable',
        rawLocalCostCny: null,
        inferredAdjustmentCostCny: null,
        adjustedLocalCostCny: null,
        officialListEquivalentCostCny: null,
        rawCostDeltaCny: null,
        explainedCostDeltaCny: null,
        timingShiftCostCny: null,
        rateVarianceCny: null,
        roundingVarianceCny: null,
        residualCostCny: null,
      },
      settlement: emptySettlement,
    },
    account: {
      provider: 'volcengine',
      currency: 'CNY',
      availableBalanceCny: null,
      cashBalanceCny: null,
      frozenAmountCny: null,
      arrearsBalanceCny: null,
      creditLimitCny: null,
      syncedAt: '-',
      status: 'never-synced',
    },
    sync: {
      status: 'warning',
      stale: true,
      lastSyncedAt: '-',
      items: (['balance', 'bill', 'packages'] as const).map(kind => ({
        kind,
        status: 'never-synced' as const,
        lastAttemptAt: '-',
        lastSuccessAt: '-',
        dataThrough: '-',
        reason: null,
      })),
    },
    summary: {
      rangeStart: monthStart,
      rangeEnd: today,
      timezone: 'Asia/Shanghai',
      billStatus: 'unavailable',
      localBillableTokens: null,
      localEstimatedCostCny: null,
      localEstimateCompleteness: 'unavailable',
      localUnpricedAttempts: null,
      localUnpricedTokens: null,
      localUnavailableUsageAttempts: null,
      officialBillableTokens: null,
      officialUnpricedRows: null,
      officialUnpricedTokens: null,
      officialListEquivalentCostCny: null,
      officialOriginalBillAmountCny: null,
      officialPayableAmountCny: null,
      officialPaidAmountCny: null,
      officialUnpaidAmountCny: null,
      officialDiscountAmountCny: null,
      resourcePackageDeductedTokens: null,
      todayEstimatedCostCny: null,
      todayEstimateCompleteness: 'unavailable',
      todayUnpricedAttempts: null,
      todayUnavailableUsageAttempts: null,
      monthEstimatedCostCny: null,
      monthEstimateCompleteness: 'unavailable',
      monthUnpricedAttempts: null,
      monthUnavailableUsageAttempts: null,
      tokenDelta: null,
      costDeltaCny: null,
      localCostUnderstatementPercent: null,
      allAccountOfficialDailyAverageCny: null,
      seedanceOfficialDailyAverageCny: null,
      seedanceListDailyAverageCny: null,
      noPackageProjectedDailyCostCny: null,
      noPackageRunwayDays: null,
      noPackageProjectionCoveredDays: 0,
      noPackageProjectionUnpricedRows: 0,
      noPackageProjectionUnpricedTokens: 0,
      noPackageProjectionStatus: 'unavailable',
    },
    operations: {
      taskCount: 0,
      userCount: 0,
      settledCredits: 0,
      heldCredits: 0,
      refundedCredits: 0,
      estimatedCostCny: '0.000000',
      estimateCompleteness: 'unavailable',
      incompleteTaskCount: 0,
      officialEquivalentCostCny: null,
      differenceCny: null,
      officialPayableCny: null,
      reconciliationStatus: 'unavailable',
      models: [],
    },
    models: [],
    daily: [],
    pricingRules: [],
    packages: [],
    reconciliation: {
      items: [],
      pagination: {
        limit: 20, hasPrevious: false, hasNext: false, previousCursor: null, nextCursor: null,
        currentPage: 0, totalPages: 0, totalItems: 0, snapshotCursor: 'uninitialized',
      },
      asOf,
      selection: {
        range: 'month', month: today.slice(0, 7), date: null, rangeStart: monthStart, rangeEnd: today,
        timezone: 'Asia/Shanghai', grain: 'day',
      },
    },
    settlement: {
      items: [],
      pagination: {
        limit: 20, hasPrevious: false, hasNext: false, previousCursor: null, nextCursor: null,
        currentPage: 0, totalPages: 0, totalItems: 0, snapshotCursor: 'uninitialized',
      },
      asOf,
      selection: {
        range: 'month', month: today.slice(0, 7), date: null, rangeStart: monthStart, rangeEnd: today,
        timezone: 'Asia/Shanghai', grain: 'day',
      },
      summary: emptySettlement,
    },
  };
}

function createEmptyApiCostPagination(): AdminApiCostPaginationState {
  const empty = (): AdminApiCostPaginationState[AdminApiCostPageKind] => ({
    loaded: 0,
    limit: 20,
    position: 'first',
    hasPrevious: false,
    hasNext: false,
    previousCursor: null,
    nextCursor: null,
    currentPage: 0,
    totalPages: 0,
    totalItems: 0,
    snapshotCursor: 'uninitialized',
    loading: false,
  });
  return {
    reconciliation: empty(),
    settlement: empty(),
    attempts: empty(),
    tasks: empty(),
    users: empty(),
  };
}

export function createApiCostResourceState(): AdminApiCostResourceState {
  return {
    phase: 'idle',
    requestedKey: null,
    dataKey: null,
    error: null,
    updatedAt: null,
  };
}

function createApiCostLoadState(): AdminApiCostLoadState {
  return {
    overview: createApiCostResourceState(),
    users: createApiCostResourceState(),
    tasks: createApiCostResourceState(),
  };
}

export function startApiCostResource(previous: AdminApiCostResourceState, key: string): AdminApiCostResourceState {
  return {
    ...previous,
    phase: previous.dataKey === key ? 'refreshing' : 'loading',
    requestedKey: key,
    error: null,
  };
}

export function resolveApiCostResource(previous: AdminApiCostResourceState, key: string): AdminApiCostResourceState {
  if (previous.requestedKey !== key) return previous;
  return {
    phase: 'ready',
    requestedKey: key,
    dataKey: key,
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

export function rejectApiCostResource(
  previous: AdminApiCostResourceState,
  key: string,
  error: unknown,
): AdminApiCostResourceState {
  if (previous.requestedKey !== key) return previous;
  return {
    ...previous,
    phase: 'error',
    error: error instanceof Error ? error.message : '请求失败，请稍后重试',
  };
}

function overviewFiltersFromTaskFilters(filters: AdminApiCostFilters): AdminApiCostFilters {
  const {
    status: _status,
    costState: _costState,
    search: _search,
    resolution: _resolution,
    asOf: _asOf,
    ...overviewFilters
  } = filters;
  return overviewFilters;
}

function apiCostPageLoadState(page: {
  items: Array<{ id: string }>;
  pagination: {
    limit: number;
    hasPrevious: boolean;
    hasNext: boolean;
    previousCursor: string | null;
    nextCursor: string | null;
    currentPage: number;
    totalPages: number;
    totalItems: number;
    snapshotCursor: string;
  };
}, position: PagePosition = 'first'): AdminApiCostPaginationState[AdminApiCostPageKind] {
  return {
    loaded: page.items.length,
    limit: page.pagination.limit,
    position,
    hasPrevious: page.pagination.hasPrevious,
    hasNext: page.pagination.hasNext,
    previousCursor: page.pagination.previousCursor,
    nextCursor: page.pagination.nextCursor,
    currentPage: page.pagination.currentPage,
    totalPages: page.pagination.totalPages,
    totalItems: page.pagination.totalItems,
    snapshotCursor: page.pagination.snapshotCursor,
    loading: false,
  };
}

export function assertApiCostCursorProgress(
  currentCursor: string,
  pagination: {
    hasPrevious: boolean;
    hasNext: boolean;
    previousCursor: string | null;
    nextCursor: string | null;
  },
  direction: 'previous' | 'next' = 'next',
) {
  const hasPage = direction === 'previous' ? pagination.hasPrevious : pagination.hasNext;
  const cursor = direction === 'previous' ? pagination.previousCursor : pagination.nextCursor;
  if (hasPage && (!cursor || cursor === currentCursor)) {
    throw Object.assign(new Error('成本明细分页未返回有效游标，已停止翻页'), {
      code: 'API_COST_CURSOR_STALLED',
    });
  }
}

export function assertApiCostPageConsistency(
  dashboard: Pick<AdminApiCostDashboardSnapshot, 'asOf' | 'selection'> & Partial<Pick<AdminApiCostDashboardSnapshot, 'coverage'>>,
  kind: AdminApiCostPageKind,
  page: Pick<AdminApiCostDashboardSnapshot, 'asOf' | 'selection'>,
) {
  const expectedSelection = kind === 'reconciliation'
    ? {
        ...dashboard.selection,
        rangeStart: dashboard.coverage?.comparable.start ?? dashboard.selection.rangeStart,
        rangeEnd: dashboard.coverage?.comparable.end ?? dashboard.selection.rangeEnd,
      }
    : dashboard.selection;
  if (page.asOf !== dashboard.asOf || apiCostSelectionIdentity(page.selection) !== apiCostSelectionIdentity(expectedSelection)) {
    throw new Error(`API 成本看盘的${apiCostPageLabel(kind)}未返回统一数据截点，请刷新后重试`);
  }
}

function apiCostSelectionIdentity(selection: AdminApiCostDashboardSnapshot['selection']) {
  return [
    selection.range,
    selection.month ?? '',
    selection.date ?? '',
    selection.rangeStart,
    selection.rangeEnd,
    selection.timezone,
    selection.grain,
  ].join('|');
}

function apiCostPageLabel(name: string) {
  return {
    reconciliation: '对账明细',
    settlement: '结算明细',
    attempts: '供应商尝试明细',
    tasks: '任务明细',
    users: '用户汇总',
  }[name] ?? '明细';
}

interface UseAdminDataOptions {
  routePath: string;
  accountEmail: string;
  accountRole: 'user' | 'admin';
  sessionEpoch: number;
  plans: AdminPlan[];
  setPlans: Dispatch<SetStateAction<AdminPlan[]>>;
  setAnnouncements: Dispatch<SetStateAction<PlatformAnnouncement[]>>;
  setFeatureFlags: Dispatch<SetStateAction<FeatureFlags>>;
  setConsumptionSettings: (settings: ConsumptionSettings) => void;
}

function mergeAdminPlanPreservingOrder(current: AdminPlan[], saved: AdminPlan) {
  const existingIndex = current.findIndex(item => item.id === saved.id);
  if (existingIndex === -1) return [...current, saved];
  return current.map((item, index) => index === existingIndex ? saved : item);
}

type ApiCostOperatingResource = keyof AdminApiCostLoadState;

interface ApiCostInFlightRequest<Result = unknown> {
  key: string;
  controller: AbortController;
  promise: Promise<Result>;
}

export function abortApiCostPageRequests(
  controllers: Map<string, AbortController>,
  activeKeys: Set<string>,
  kinds?: ReadonlySet<AdminApiCostPageKind>,
) {
  for (const [key, controller] of controllers) {
    const kind = key.slice(0, key.indexOf(':')) as AdminApiCostPageKind;
    if (kinds && !kinds.has(kind)) continue;
    controller.abort();
    controllers.delete(key);
    activeKeys.delete(key);
  }
}

export function releaseApiCostPageRequest(
  controllers: Map<string, AbortController>,
  activeKeys: Set<string>,
  key: string,
  controller: AbortController,
) {
  if (controllers.get(key) !== controller) return false;
  controllers.delete(key);
  activeKeys.delete(key);
  return true;
}

/** 后台专属数据和破坏性操作，和用户工作台状态分离。 */
export function useAdminData({
  routePath,
  accountEmail,
  accountRole,
  sessionEpoch,
  plans,
  setPlans,
  setAnnouncements,
  setFeatureFlags,
  setConsumptionSettings,
}: UseAdminDataOptions) {
  const queryClient = useQueryClient();
  const activeAdminTab = useMemo(() => adminTabFromPath(routePath), [routePath]);
  const adminEnabled = isAdminDataEnabled(routePath, accountEmail, accountRole);
  const [userFilters, setUserFiltersState] = useState<{ search?: string; status?: AdminUser['status'] }>({});
  const [orderFilters, setOrderFiltersState] = useState<{ search?: string; status?: AdminOrder['status']; userId?: string; from?: string; to?: string }>({});
  const [invoiceFilters, setInvoiceFiltersState] = useState<{ search?: string; status?: AdminInvoiceRequest['status']; userId?: string; orderId?: string }>({});
  const [ticketFilters, setTicketFiltersState] = useState<{ search?: string; status?: AdminTicket['status']; priority?: AdminTicket['priority'] }>({});
  const [jobFilters, setJobFiltersState] = useState<{ search?: string; status?: AdminGenerationJob['status']; userId?: string }>({});
  const [creditFilters, setCreditFiltersState] = useState<{ search?: string; type?: AdminCreditLedgerEntry['type']; userId?: string; relatedOrderId?: string; relatedJobId?: string }>({});
  const [auditFilters, setAuditFiltersState] = useState<{ search?: string; risk?: AdminAuditLog['risk']; module?: string }>({});
  const [announcementFilters, setAnnouncementFiltersState] = useState<{ search?: string }>({});
  const usersPaging = useCursorPagination(20);
  const ordersPaging = useCursorPagination(20);
  const invoicesPaging = useCursorPagination(20);
  const ticketsPaging = useCursorPagination(20);
  const jobsPaging = useCursorPagination(20);
  const creditsPaging = useCursorPagination(20);
  const auditPaging = useCursorPagination(20);
  const announcementsPaging = useCursorPagination(20);

  const usersQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'users', userFilters, cursorPageRequestIdentity(usersPaging.request)),
    queryFn: ({ signal }) => queries.getAdminUsersPage({ ...userFilters, ...usersPaging.request }, signal),
    enabled: adminEnabled && activeAdminTab === 'users',
    placeholderData: keepPreviousData,
    retry: retryUnlessPaginationSnapshotChanged,
    staleTime: 30_000,
  });
  const ordersQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'orders', orderFilters, cursorPageRequestIdentity(ordersPaging.request)),
    queryFn: ({ signal }) => queries.getAdminOrdersPage({ ...orderFilters, ...ordersPaging.request }, signal),
    enabled: adminEnabled && activeAdminTab === 'orders',
    placeholderData: keepPreviousData,
    retry: retryUnlessPaginationSnapshotChanged,
    staleTime: 30_000,
  });
  const invoicesQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'invoices', invoiceFilters, cursorPageRequestIdentity(invoicesPaging.request)),
    queryFn: ({ signal }) => queries.getAdminInvoicesPage({ ...invoiceFilters, ...invoicesPaging.request }, signal),
    enabled: adminEnabled && activeAdminTab === 'invoices',
    placeholderData: keepPreviousData,
    retry: retryUnlessPaginationSnapshotChanged,
    staleTime: 30_000,
  });
  const ticketsQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'tickets', ticketFilters, cursorPageRequestIdentity(ticketsPaging.request)),
    queryFn: ({ signal }) => queries.getAdminTicketsPage({ ...ticketFilters, ...ticketsPaging.request }, signal),
    enabled: adminEnabled && activeAdminTab === 'tickets',
    placeholderData: keepPreviousData,
    retry: retryUnlessPaginationSnapshotChanged,
    staleTime: 30_000,
  });
  const jobsQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'jobs', jobFilters, cursorPageRequestIdentity(jobsPaging.request)),
    queryFn: ({ signal }) => queries.getAdminJobsPage({ ...jobFilters, ...jobsPaging.request }, signal),
    enabled: adminEnabled && activeAdminTab === 'jobs',
    placeholderData: keepPreviousData,
    retry: retryUnlessPaginationSnapshotChanged,
    staleTime: 30_000,
  });
  const creditsQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'credits', creditFilters, cursorPageRequestIdentity(creditsPaging.request)),
    queryFn: ({ signal }) => queries.getAdminCreditLedgerPage({ ...creditFilters, ...creditsPaging.request }, signal),
    enabled: adminEnabled && activeAdminTab === 'credits',
    placeholderData: keepPreviousData,
    retry: retryUnlessPaginationSnapshotChanged,
    staleTime: 30_000,
  });
  const auditQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'audit', auditFilters, cursorPageRequestIdentity(auditPaging.request)),
    queryFn: ({ signal }) => queries.getAdminAuditLogsPage({ ...auditFilters, ...auditPaging.request }, signal),
    enabled: adminEnabled && activeAdminTab === 'audit',
    placeholderData: keepPreviousData,
    retry: retryUnlessPaginationSnapshotChanged,
    staleTime: 30_000,
  });
  useExactAdminPageLifecycle(usersQuery, usersPaging);
  useExactAdminPageLifecycle(ordersQuery, ordersPaging);
  useExactAdminPageLifecycle(invoicesQuery, invoicesPaging);
  useExactAdminPageLifecycle(ticketsQuery, ticketsPaging);
  useExactAdminPageLifecycle(jobsQuery, jobsPaging);
  useExactAdminPageLifecycle(creditsQuery, creditsPaging);
  useExactAdminPageLifecycle(auditQuery, auditPaging);
  useEmptyAdminPageRecovery(usersQuery, usersPaging);
  useEmptyAdminPageRecovery(ordersQuery, ordersPaging);
  useEmptyAdminPageRecovery(invoicesQuery, invoicesPaging);
  useEmptyAdminPageRecovery(ticketsQuery, ticketsPaging);
  useEmptyAdminPageRecovery(jobsQuery, jobsPaging);
  useEmptyAdminPageRecovery(creditsQuery, creditsPaging);
  useEmptyAdminPageRecovery(auditQuery, auditPaging);
  const navigationQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'navigation-summary'),
    queryFn: ({ signal }) => queries.getAdminNavigationSummary(signal),
    enabled: adminEnabled,
    staleTime: 30_000,
  });
  const orderSummaryQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'orders-summary', orderFilters.from ?? null, orderFilters.to ?? null),
    queryFn: ({ signal }) => queries.getAdminOrdersSummary({ from: orderFilters.from, to: orderFilters.to }, signal),
    enabled: adminEnabled && activeAdminTab === 'orders',
    staleTime: 30_000,
  });

  const adminUsersState = usersQuery.data?.items ?? [];
  const adminOrders = ordersQuery.data?.items ?? [];
  const adminInvoiceRequests = invoicesQuery.data?.items ?? [];
  const tickets = ticketsQuery.data?.items ?? [];
  const generationJobs = jobsQuery.data?.items ?? [];
  const adminCreditLedger = creditsQuery.data?.items ?? [];
  const auditLogs = auditQuery.data?.items ?? [];
  const [apiCostDashboard, setApiCostDashboard] = useState<AdminApiCostDashboard>(createEmptyApiCostDashboard);
  const [apiCostOverview, setApiCostOverview] = useState<AdminApiCostOverviewSnapshot | null>(null);
  const [apiCostUsers, setApiCostUsers] = useState<AdminApiCostUser[]>([]);
  const [apiCostTasks, setApiCostTasks] = useState<AdminApiCostTask[]>([]);
  const [apiCostAttempts, setApiCostAttempts] = useState<AdminApiCostAttempt[]>([]);
  const [apiCostPagination, setApiCostPagination] = useState<AdminApiCostPaginationState>(createEmptyApiCostPagination);
  const [apiCostLoadState, setApiCostLoadState] = useState<AdminApiCostLoadState>(createApiCostLoadState);
  const [paymentChannel, setPaymentChannel] = useState<AdminPaymentChannel>(EMPTY_PAYMENT_CHANNEL);
  const [adminOverview, setAdminOverview] = useState<AdminOverviewSummary | null>(null);
  const overviewQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'overview'),
    queryFn: ({ signal }) => queries.getAdminOverview(signal),
    enabled: adminEnabled && activeAdminTab === 'overview',
    staleTime: 30_000,
  });
  const plansQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'plans'),
    queryFn: ({ signal }) => queries.getAdminPlans(signal),
    enabled: adminEnabled && (activeAdminTab === 'plans' || activeAdminTab === 'users'),
    staleTime: 5 * 60_000,
  });
  const realPortraitCapacityQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'real-portrait-capacity'),
    queryFn: ({ signal }) => queries.getAdminRealPortraitCapacity(signal),
    enabled: adminEnabled && activeAdminTab === 'real-portrait-capacity',
    staleTime: 30_000,
  });
  const announcementsQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'announcements', announcementFilters, cursorPageRequestIdentity(announcementsPaging.request)),
    queryFn: ({ signal }) => queries.getAdminAnnouncementsPage({ ...announcementFilters, ...announcementsPaging.request }, signal),
    enabled: adminEnabled && activeAdminTab === 'announcements',
    placeholderData: keepPreviousData,
    retry: retryUnlessPaginationSnapshotChanged,
    staleTime: 30_000,
  });
  useExactAdminPageLifecycle(announcementsQuery, announcementsPaging);
  useEmptyAdminPageRecovery(announcementsQuery, announcementsPaging);
  const adminAnnouncements = announcementsQuery.data?.items ?? [];
  const paymentChannelQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'payment-channel'),
    queryFn: ({ signal }) => queries.getAdminPaymentChannel(signal),
    enabled: adminEnabled && activeAdminTab === 'payment-channel',
    staleTime: 5 * 60_000,
  });
  const consumptionQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'consumption-settings'),
    queryFn: ({ signal }) => queries.getConsumptionSettings(signal),
    enabled: adminEnabled && (activeAdminTab === 'consumption-settings' || activeAdminTab === 'feature-flags'),
    staleTime: 5 * 60_000,
  });
  const featureFlagsQuery = useQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'feature-flags'),
    queryFn: ({ signal }) => queries.getFeatureFlags(signal),
    enabled: adminEnabled && activeAdminTab === 'feature-flags',
    staleTime: 5 * 60_000,
  });
  const adminMutationKeysRef = useRef(new IdempotencyKeyRegistry());
  const apiCostMainSequenceRef = useRef(0);
  const apiCostSyncPollingSequenceRef = useRef(0);
  const apiCostAuditRequestSequenceRef = useRef(0);
  const apiCostAuditControllerRef = useRef<AbortController | null>(null);
  const apiCostOverviewRef = useRef<AdminApiCostOverviewSnapshot | null>(null);
  const apiCostOverviewDataKeyRef = useRef<string | null>(null);
  const apiCostOverviewFiltersRef = useRef<AdminApiCostFilters>({});
  const apiCostTaskFiltersRef = useRef<AdminApiCostFilters>({});
  const apiCostAuditFiltersRef = useRef<AdminApiCostAttemptFilters>({});
  const apiCostPageRequestRef = useRef(new Set<string>());
  const apiCostPageControllersRef = useRef(new Map<string, AbortController>());
  const apiCostSnapshotNoticeShownRef = useRef(false);
  const apiCostRequestedKeysRef = useRef<Record<ApiCostOperatingResource, string | null>>({
    overview: null,
    users: null,
    tasks: null,
  });
  const apiCostInFlightRef = useRef<Partial<Record<ApiCostOperatingResource, ApiCostInFlightRequest>>>({});

  useEffect(() => {
    if (overviewQuery.data) setAdminOverview(overviewQuery.data);
  }, [overviewQuery.data]);
  useEffect(() => {
    if (plansQuery.data) setPlans(plansQuery.data);
  }, [plansQuery.data, setPlans]);
  useEffect(() => {
    if (paymentChannelQuery.data) setPaymentChannel(paymentChannelQuery.data);
  }, [paymentChannelQuery.data]);
  useEffect(() => {
    if (consumptionQuery.data) setConsumptionSettings(consumptionQuery.data);
  }, [consumptionQuery.data, setConsumptionSettings]);
  useEffect(() => {
    if (featureFlagsQuery.data) setFeatureFlags(featureFlagsQuery.data);
  }, [featureFlagsQuery.data, setFeatureFlags]);

  useEffect(() => () => {
    for (const request of Object.values(apiCostInFlightRef.current)) request?.controller.abort();
    apiCostAuditControllerRef.current?.abort();
    abortApiCostPageRequests(apiCostPageControllersRef.current, apiCostPageRequestRef.current);
  }, []);

  const executeAdminMutation = useCallback(<Result,>(
    intent: string,
    prefix: string,
    execute: (idempotencyKey: string) => Promise<Result>,
  ) => runIdempotentMutation(adminMutationKeysRef.current, intent, prefix, execute), []);

  const setAdminUsersState = useCallback((update: SetStateAction<AdminUser[]>) => {
    updateAdminPages(queryClient, sessionEpoch, 'users', update);
  }, [queryClient, sessionEpoch]);
  const setAdminOrders = useCallback((update: SetStateAction<AdminOrder[]>) => {
    updateAdminPages(queryClient, sessionEpoch, 'orders', update);
  }, [queryClient, sessionEpoch]);
  const setAdminInvoiceRequests = useCallback((update: SetStateAction<AdminInvoiceRequest[]>) => {
    updateAdminPages(queryClient, sessionEpoch, 'invoices', update);
  }, [queryClient, sessionEpoch]);
  const setTickets = useCallback((update: SetStateAction<AdminTicket[]>) => {
    updateAdminPages(queryClient, sessionEpoch, 'tickets', update);
  }, [queryClient, sessionEpoch]);
  const setGenerationJobs = useCallback((update: SetStateAction<AdminGenerationJob[]>) => {
    updateAdminPages(queryClient, sessionEpoch, 'jobs', update);
  }, [queryClient, sessionEpoch]);
  const setAuditLogs = useCallback((update: SetStateAction<AdminAuditLog[]>) => {
    updateAdminPages(queryClient, sessionEpoch, 'audit', update);
  }, [queryClient, sessionEpoch]);

  const setUserFilters = useCallback((next: typeof userFilters) => {
    setUserFiltersState(normalizeAdminFilters(next));
    usersPaging.reset();
  }, [usersPaging.reset]);
  const setOrderFilters = useCallback((next: typeof orderFilters) => {
    setOrderFiltersState(normalizeAdminFilters(next));
    ordersPaging.reset();
  }, [ordersPaging.reset]);
  const setInvoiceFilters = useCallback((next: typeof invoiceFilters) => {
    setInvoiceFiltersState(normalizeAdminFilters(next));
    invoicesPaging.reset();
  }, [invoicesPaging.reset]);
  const setTicketFilters = useCallback((next: typeof ticketFilters) => {
    setTicketFiltersState(normalizeAdminFilters(next));
    ticketsPaging.reset();
  }, [ticketsPaging.reset]);
  const setJobFilters = useCallback((next: typeof jobFilters) => {
    setJobFiltersState(normalizeAdminFilters(next));
    jobsPaging.reset();
  }, [jobsPaging.reset]);
  const setCreditFilters = useCallback((next: typeof creditFilters) => {
    setCreditFiltersState(normalizeAdminFilters(next));
    creditsPaging.reset();
  }, [creditsPaging.reset]);
  const setAuditFilters = useCallback((next: typeof auditFilters) => {
    setAuditFiltersState(normalizeAdminFilters(next));
    auditPaging.reset();
  }, [auditPaging.reset]);
  const setAnnouncementFilters = useCallback((next: typeof announcementFilters) => {
    setAnnouncementFiltersState(normalizeAdminFilters(next));
    announcementsPaging.reset();
  }, [announcementsPaging.reset]);

  const startOperatingRequest = useCallback(<Result,>(
    resource: ApiCostOperatingResource,
    key: string,
    request: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> => {
    const existing = apiCostInFlightRef.current[resource] as ApiCostInFlightRequest<Result> | undefined;
    if (existing?.key === key) return existing.promise;
    existing?.controller.abort();

    const controller = new AbortController();
    apiCostRequestedKeysRef.current[resource] = key;
    setApiCostLoadState(previous => ({
      ...previous,
      [resource]: startApiCostResource(previous[resource], key),
    }));
    const promise = request(controller.signal).finally(() => {
      if (apiCostInFlightRef.current[resource]?.controller === controller) {
        delete apiCostInFlightRef.current[resource];
      }
    });
    apiCostInFlightRef.current[resource] = { key, controller, promise };
    return promise;
  }, []);

  const prepareOperatingResource = useCallback((resource: ApiCostOperatingResource, key: string) => {
    if (resource === 'users' || resource === 'tasks') {
      abortApiCostPageRequests(
        apiCostPageControllersRef.current,
        apiCostPageRequestRef.current,
        new Set([resource]),
      );
    }
    const existing = apiCostInFlightRef.current[resource];
    if (existing?.key !== key) {
      existing?.controller.abort();
      delete apiCostInFlightRef.current[resource];
    }
    apiCostRequestedKeysRef.current[resource] = key;
    setApiCostLoadState(previous => ({
      ...previous,
      [resource]: startApiCostResource(previous[resource], key),
    }));
  }, []);

  const rejectOperatingResource = useCallback((
    resource: ApiCostOperatingResource,
    key: string,
    error: unknown,
  ) => {
    if (isAbortError(error) || apiCostRequestedKeysRef.current[resource] !== key) return;
    setApiCostLoadState(previous => ({
      ...previous,
      [resource]: rejectApiCostResource(previous[resource], key, error),
    }));
  }, []);

  const loadApiCostOverviewSnapshot = useCallback(async (filters: AdminApiCostFilters = {}) => {
    const key = apiCostFilterKey(filters, 'overview');
    try {
      const overview = await startOperatingRequest(
        'overview',
        key,
        signal => queries.getAdminApiUsageOverview(filters, signal),
      );
      if (apiCostRequestedKeysRef.current.overview === key) {
        apiCostOverviewRef.current = overview;
        apiCostOverviewDataKeyRef.current = key;
        setApiCostOverview(overview);
        setApiCostLoadState(previous => ({
          ...previous,
          overview: resolveApiCostResource(previous.overview, key),
        }));
      }
      return overview;
    } catch (error) {
      rejectOperatingResource('overview', key, error);
      throw error;
    }
  }, [rejectOperatingResource, startOperatingRequest]);

  const loadApiCostUsersForSnapshot = useCallback(async (
    filters: AdminApiCostFilters,
    overview: AdminApiCostOverviewSnapshot,
  ) => {
    const key = apiCostFilterKey(filters, 'users');
    try {
      const page = await startOperatingRequest(
        'users',
        key,
        signal => queries.getAdminApiCostUsersPage({ ...filters, asOf: overview.asOf, position: 'first', limit: 20 }, signal),
      );
      assertApiCostPageConsistency(overview, 'users', page);
      assertApiCostCursorProgress('', page.pagination);
      if (apiCostRequestedKeysRef.current.users === key) {
        setApiCostUsers(page.items);
        setApiCostPagination(previous => ({ ...previous, users: apiCostPageLoadState(page) }));
        setApiCostLoadState(previous => ({
          ...previous,
          users: resolveApiCostResource(previous.users, key),
        }));
      }
      return page;
    } catch (error) {
      rejectOperatingResource('users', key, error);
      throw error;
    }
  }, [rejectOperatingResource, startOperatingRequest]);

  const loadApiCostTasksForSnapshot = useCallback(async (
    filters: AdminApiCostFilters,
    overview: AdminApiCostOverviewSnapshot,
  ) => {
    const key = apiCostFilterKey(filters, 'tasks');
    try {
      const page = await startOperatingRequest(
        'tasks',
        key,
        signal => queries.getAdminApiCostTasksPage({ ...filters, asOf: overview.asOf, position: 'first', limit: 20 }, signal),
      );
      assertApiCostPageConsistency(overview, 'tasks', page);
      assertApiCostCursorProgress('', page.pagination);
      if (apiCostRequestedKeysRef.current.tasks === key) {
        setApiCostTasks(page.items);
        setApiCostPagination(previous => ({ ...previous, tasks: apiCostPageLoadState(page) }));
        setApiCostLoadState(previous => ({
          ...previous,
          tasks: resolveApiCostResource(previous.tasks, key),
        }));
      }
      return page;
    } catch (error) {
      rejectOperatingResource('tasks', key, error);
      throw error;
    }
  }, [rejectOperatingResource, startOperatingRequest]);

  const loadApiCostOverview = useCallback(async (
    requestedFilters?: AdminApiCostFilters,
    requestedTaskFilters?: AdminApiCostFilters,
  ) => {
    const filters = requestedFilters ?? apiCostOverviewFiltersRef.current;
    const taskFilters = requestedTaskFilters ?? (requestedFilters ? filters : apiCostTaskFiltersRef.current);
    apiCostOverviewFiltersRef.current = filters;
    apiCostTaskFiltersRef.current = taskFilters;
    apiCostMainSequenceRef.current += 1;
    const usersKey = apiCostFilterKey(filters, 'users');
    const tasksKey = apiCostFilterKey(taskFilters, 'tasks');
    prepareOperatingResource('users', usersKey);
    prepareOperatingResource('tasks', tasksKey);

    let overview: AdminApiCostOverviewSnapshot;
    try {
      overview = await loadApiCostOverviewSnapshot(filters);
    } catch (error) {
      rejectOperatingResource('users', usersKey, error);
      rejectOperatingResource('tasks', tasksKey, error);
      throw error;
    }
    const detailResults = await Promise.allSettled([
      loadApiCostUsersForSnapshot(filters, overview),
      loadApiCostTasksForSnapshot(taskFilters, overview),
    ]);
    const detailError = apiCostOperatingLoadError(detailResults);
    if (detailError) throw detailError;
  }, [loadApiCostOverviewSnapshot, loadApiCostTasksForSnapshot, loadApiCostUsersForSnapshot, prepareOperatingResource, rejectOperatingResource]);

  const loadApiCostTasks = useCallback(async (requestedFilters?: AdminApiCostFilters) => {
    const filters = requestedFilters ?? apiCostTaskFiltersRef.current;
    apiCostTaskFiltersRef.current = filters;
    apiCostMainSequenceRef.current += 1;
    const overviewFilters = overviewFiltersFromTaskFilters(filters);
    const taskKey = apiCostFilterKey(filters, 'tasks');
    prepareOperatingResource('tasks', taskKey);
    try {
      const overviewKey = apiCostFilterKey(overviewFilters, 'overview');
      const overview = apiCostOverviewRef.current && apiCostOverviewDataKeyRef.current === overviewKey
        ? apiCostOverviewRef.current
        : await loadApiCostOverviewSnapshot(overviewFilters);
      await loadApiCostTasksForSnapshot(filters, overview);
    } catch (error) {
      rejectOperatingResource('tasks', taskKey, error);
      if (!isAbortError(error)) throw error;
    }
  }, [loadApiCostOverviewSnapshot, loadApiCostTasksForSnapshot, prepareOperatingResource, rejectOperatingResource]);

  const refreshApiCostOverview = useCallback(async (requestedFilters?: AdminApiCostFilters) => {
    const filters = requestedFilters ?? apiCostOverviewFiltersRef.current;
    apiCostOverviewFiltersRef.current = filters;
    await loadApiCostOverviewSnapshot(filters);
  }, [loadApiCostOverviewSnapshot]);

  const invalidateNavigationSummary = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: privateQueryKey(sessionEpoch, 'admin', 'navigation-summary') });
  }, [queryClient, sessionEpoch]);

  const cancelApiCostOperatingRequests = useCallback(() => {
    apiCostMainSequenceRef.current += 1;
    apiCostSyncPollingSequenceRef.current += 1;
    for (const request of Object.values(apiCostInFlightRef.current)) request?.controller.abort();
    apiCostInFlightRef.current = {};
    abortApiCostPageRequests(
      apiCostPageControllersRef.current,
      apiCostPageRequestRef.current,
      new Set(['users', 'tasks']),
    );
  }, []);

  const loadApiCostAudit = useCallback(async (requestedFilters?: AdminApiCostAttemptFilters) => {
    const filters = requestedFilters ?? apiCostAuditFiltersRef.current;
    apiCostAuditFiltersRef.current = filters;
    const requestSequence = ++apiCostAuditRequestSequenceRef.current;
    apiCostAuditControllerRef.current?.abort();
    abortApiCostPageRequests(
      apiCostPageControllersRef.current,
      apiCostPageRequestRef.current,
      new Set(['reconciliation', 'settlement', 'attempts']),
    );
    const controller = new AbortController();
    apiCostAuditControllerRef.current = controller;
    const dashboard = await queries.getAdminApiUsage(filters, controller.signal);
    const snapshotFilters = { ...filters, asOf: dashboard.asOf };
    const [reconciliation, settlement, attempts] = await Promise.all([
      queries.getAdminApiCostReconciliationPage({ ...snapshotFilters, position: 'first', limit: 20 }, controller.signal),
      queries.getAdminApiCostSettlementPage({ ...snapshotFilters, position: 'first', limit: 20 }, controller.signal),
      queries.getAdminApiCostAttemptsPage({ ...snapshotFilters, position: 'first', limit: 20 }, controller.signal),
    ]);
    for (const [kind, page] of [
      ['reconciliation', reconciliation],
      ['settlement', settlement],
      ['attempts', attempts],
    ] as const) {
      assertApiCostPageConsistency(dashboard, kind, page);
      assertApiCostCursorProgress('', page.pagination);
    }
    if (apiCostAuditRequestSequenceRef.current !== requestSequence) return;
    setApiCostDashboard({ ...dashboard, reconciliation, settlement });
    setApiCostAttempts(attempts.items);
    setApiCostPagination(previous => ({
      ...previous,
      reconciliation: apiCostPageLoadState(reconciliation),
      settlement: apiCostPageLoadState(settlement),
      attempts: apiCostPageLoadState(attempts),
    }));
    apiCostSnapshotNoticeShownRef.current = false;
  }, []);

  const cancelApiCostAuditRequests = useCallback(() => {
    apiCostAuditRequestSequenceRef.current += 1;
    apiCostAuditControllerRef.current?.abort();
    apiCostAuditControllerRef.current = null;
    abortApiCostPageRequests(
      apiCostPageControllersRef.current,
      apiCostPageRequestRef.current,
      new Set(['reconciliation', 'settlement', 'attempts']),
    );
  }, []);

  const refreshCurrentAdminPage = useCallback(async () => {
    if (activeAdminTab === 'feature-flags') {
      const [featureFlagsResult, tkPromptEngineResult] = await Promise.all([
        featureFlagsQuery.refetch(),
        consumptionQuery.refetch(),
      ]);
      if (featureFlagsResult.isError) {
        throw featureFlagsResult.error ?? new Error('功能开关加载失败');
      }
      if (tkPromptEngineResult.isError) {
        throw tkPromptEngineResult.error ?? new Error('TK Prompt Engine 设置加载失败');
      }
    }

    const refresh = {
      overview: overviewQuery.refetch,
      announcements: announcementsQuery.refetch,
      plans: plansQuery.refetch,
      'real-portrait-capacity': realPortraitCapacityQuery.refetch,
      'consumption-settings': consumptionQuery.refetch,
      'payment-channel': paymentChannelQuery.refetch,
      users: usersQuery.refetch,
      orders: ordersQuery.refetch,
      invoices: invoicesQuery.refetch,
      tickets: ticketsQuery.refetch,
      jobs: jobsQuery.refetch,
      credits: creditsQuery.refetch,
      audit: auditQuery.refetch,
    }[activeAdminTab];
    const currentResult = activeAdminTab === 'feature-flags' ? null : refresh ? await refresh() : null;
    if (currentResult?.isError) {
      throw currentResult.error ?? new Error('当前后台页面刷新失败');
    }

    const navigationResult = await navigationQuery.refetch();
    if (navigationResult.isError) {
      throw navigationResult.error ?? new Error('后台导航摘要刷新失败');
    }
  }, [
    activeAdminTab, announcementsQuery.refetch, auditQuery.refetch, consumptionQuery.refetch,
    creditsQuery.refetch, featureFlagsQuery.refetch, invoicesQuery.refetch, jobsQuery.refetch,
    navigationQuery.refetch, ordersQuery.refetch, overviewQuery.refetch, paymentChannelQuery.refetch,
    plansQuery.refetch, realPortraitCapacityQuery.refetch, ticketsQuery.refetch, usersQuery.refetch,
  ]);

  const loadAdminAsset = useCallback((assetId: string) => queries.getAdminAsset(assetId), []);
  const loadAdminOrderDetail = useCallback((orderId: string) => queryClient.fetchQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'order-detail', orderId),
    queryFn: ({ signal }) => queries.getAdminOrderDetail(orderId, signal),
    staleTime: 5 * 60_000,
  }), [queryClient, sessionEpoch]);
  const loadAdminJobDetail = useCallback((jobId: string) => queryClient.fetchQuery({
    queryKey: privateQueryKey(sessionEpoch, 'admin', 'job-detail', jobId),
    queryFn: ({ signal }) => queries.getAdminJobDetail(jobId, signal),
    staleTime: 5 * 60_000,
  }), [queryClient, sessionEpoch]);

  const navigateApiCostPage = useCallback(async (
    kind: AdminApiCostPageKind,
    position: PagePosition,
  ) => {
    const pageState = apiCostPagination[kind];
    const auditKind = kind === 'reconciliation' || kind === 'settlement' || kind === 'attempts';
    const snapshot = auditKind ? apiCostDashboard : apiCostOverview;
    if (!snapshot) return;
    const cursor = position === 'previous'
      ? pageState.previousCursor
      : position === 'next' ? pageState.nextCursor : undefined;
    if ((position === 'previous' || position === 'next') && !cursor) return;
    const requestKey = `${kind}:${snapshot.asOf}:${pageState.snapshotCursor}:${position}:${cursor ?? '-'}`;
    if (apiCostPageRequestRef.current.has(requestKey)) return;
    abortApiCostPageRequests(
      apiCostPageControllersRef.current,
      apiCostPageRequestRef.current,
      new Set([kind]),
    );
    apiCostPageRequestRef.current.add(requestKey);
    const controller = new AbortController();
    apiCostPageControllersRef.current.set(requestKey, controller);
    const requestSequence = auditKind ? apiCostAuditRequestSequenceRef.current : apiCostMainSequenceRef.current;
    setApiCostPagination(previous => ({
      ...previous,
      [kind]: { ...previous[kind], loading: true },
    }));
    const pageInput = {
      asOf: snapshot.asOf,
      position,
      ...(cursor ? { cursor } : {}),
      ...(pageState.snapshotCursor !== 'uninitialized'
        ? { snapshotCursor: pageState.snapshotCursor }
        : {}),
      limit: 20,
    };
    const requestIsCurrent = () => auditKind
      ? apiCostAuditRequestSequenceRef.current === requestSequence
      : apiCostMainSequenceRef.current === requestSequence;

    try {
      if (kind === 'reconciliation') {
        const page = await queries.getAdminApiCostReconciliationPage({
          ...apiCostAuditFiltersRef.current,
          ...pageInput,
        }, controller.signal);
        assertApiCostCursorProgress(cursor ?? '', page.pagination, position === 'previous' || position === 'last' ? 'previous' : 'next');
        assertApiCostPageConsistency(apiCostDashboard, kind, page);
        if (!requestIsCurrent()) return;
        setApiCostDashboard(previous => ({
          ...previous,
          reconciliation: page,
        }));
        setApiCostPagination(previous => ({
          ...previous,
          reconciliation: apiCostPageLoadState(page, position),
        }));
        if (position === 'first') apiCostSnapshotNoticeShownRef.current = false;
      } else if (kind === 'settlement') {
        const page = await queries.getAdminApiCostSettlementPage({
          ...apiCostAuditFiltersRef.current,
          ...pageInput,
        }, controller.signal);
        assertApiCostCursorProgress(cursor ?? '', page.pagination, position === 'previous' || position === 'last' ? 'previous' : 'next');
        assertApiCostPageConsistency(apiCostDashboard, kind, page);
        if (!requestIsCurrent()) return;
        setApiCostDashboard(previous => ({
          ...previous,
          settlement: page,
        }));
        setApiCostPagination(previous => ({
          ...previous,
          settlement: apiCostPageLoadState(page, position),
        }));
        if (position === 'first') apiCostSnapshotNoticeShownRef.current = false;
      } else if (kind === 'attempts') {
        const page = await queries.getAdminApiCostAttemptsPage({
          ...apiCostAuditFiltersRef.current,
          ...pageInput,
        }, controller.signal);
        assertApiCostCursorProgress(cursor ?? '', page.pagination, position === 'previous' || position === 'last' ? 'previous' : 'next');
        assertApiCostPageConsistency(apiCostDashboard, kind, page);
        if (!requestIsCurrent()) return;
        setApiCostAttempts(page.items);
        setApiCostPagination(previous => ({
          ...previous,
          attempts: apiCostPageLoadState(page, position),
        }));
        if (position === 'first') apiCostSnapshotNoticeShownRef.current = false;
      } else if (kind === 'tasks') {
        const page = await queries.getAdminApiCostTasksPage({
          ...apiCostTaskFiltersRef.current,
          ...pageInput,
        }, controller.signal);
        assertApiCostCursorProgress(cursor ?? '', page.pagination, position === 'previous' || position === 'last' ? 'previous' : 'next');
        assertApiCostPageConsistency(snapshot, kind, page);
        if (!requestIsCurrent()) return;
        setApiCostTasks(page.items);
        setApiCostPagination(previous => ({
          ...previous,
          tasks: apiCostPageLoadState(page, position),
        }));
        if (position === 'first') apiCostSnapshotNoticeShownRef.current = false;
      } else {
        const page = await queries.getAdminApiCostUsersPage({
          ...apiCostOverviewFiltersRef.current,
          ...pageInput,
        }, controller.signal);
        assertApiCostCursorProgress(cursor ?? '', page.pagination, position === 'previous' || position === 'last' ? 'previous' : 'next');
        assertApiCostPageConsistency(snapshot, kind, page);
        if (!requestIsCurrent()) return;
        setApiCostUsers(page.items);
        setApiCostPagination(previous => ({
          ...previous,
          users: apiCostPageLoadState(page, position),
        }));
        if (position === 'first') apiCostSnapshotNoticeShownRef.current = false;
      }
    } catch (error) {
      if (isAbortError(error)) return;
      if (isPaginationSnapshotChanged(error)) {
        if (!apiCostSnapshotNoticeShownRef.current) {
          apiCostSnapshotNoticeShownRef.current = true;
          toast.info('列表已更新，已返回第 1 页');
        }
        if (auditKind) await loadApiCostAudit(apiCostAuditFiltersRef.current);
        else if (kind === 'tasks') await loadApiCostTasks(apiCostTaskFiltersRef.current);
        else await loadApiCostOverview(apiCostOverviewFiltersRef.current);
        return;
      }
      throw error;
    } finally {
      const released = releaseApiCostPageRequest(
        apiCostPageControllersRef.current,
        apiCostPageRequestRef.current,
        requestKey,
        controller,
      );
      if (released && requestIsCurrent()) {
        setApiCostPagination(previous => ({
          ...previous,
          [kind]: { ...previous[kind], loading: false },
        }));
      }
    }
  }, [apiCostDashboard, apiCostOverview, apiCostPagination, loadApiCostAudit, loadApiCostOverview, loadApiCostTasks]);

  const requestApiCostSync = useCallback(async (requestedFilters?: AdminApiCostFilters) => {
    const filters = requestedFilters ?? apiCostOverviewFiltersRef.current;
    const filterKey = apiCostFilterKey(filters, 'overview');
    const pollingSequence = ++apiCostSyncPollingSequenceRef.current;
    const baseline = new Map(
      (apiCostOverviewRef.current?.sync.items ?? [])
        .filter(item => item.status !== 'not-configured')
        .map(item => [item.kind, item.lastAttemptAt]),
    );
    await mutations.requestProviderBillingSync('all');
    toast.success('费用中心同步已进入后台队列');
    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (apiCostSyncPollingSequenceRef.current !== pollingSequence) return;
      if (apiCostFilterKey(apiCostOverviewFiltersRef.current, 'overview') !== filterKey) return;
      if (attempt > 0) await new Promise(resolve => globalThis.setTimeout(resolve, 2_000));
      if (apiCostSyncPollingSequenceRef.current !== pollingSequence) return;
      try {
        const overview = await loadApiCostOverviewSnapshot(filters);
        const relevantItems = overview.sync.items.filter(item => item.status !== 'not-configured');
        const completed = relevantItems.length > 0 && relevantItems.every(item => (
          item.status !== 'running' && item.lastAttemptAt !== (baseline.get(item.kind) ?? '-')
        ));
        if (completed) {
          if (relevantItems.some(item => item.status === 'failed')) {
            throw new Error('费用中心同步已结束，但部分数据同步失败，请查看同步状态');
          }
          return;
        }
      } catch (error) {
        if (isAbortError(error)) return;
        if (error instanceof Error && error.message.startsWith('费用中心同步已结束')) throw error;
        if (attempt === 23) throw error;
      }
    }
    toast.info('费用中心仍在后台同步，可稍后刷新查看最新结果');
  }, [loadApiCostOverviewSnapshot]);

  const retryGenerationJob = useCallback(async (job: AdminGenerationJob) => {
    const updated = await executeAdminMutation(
      adminMutationIntent('job-retry', job.id),
      'admin-job-retry',
      key => mutations.retryAdminJob(job.id, key),
    );
    setGenerationJobs(current => current.map(item => item.id === updated.id ? updated : item));
    jobsPaging.reset();
    invalidateNavigationSummary();
    toast.success('任务已重新加入队列');
  }, [executeAdminMutation, invalidateNavigationSummary, jobsPaging.reset, setGenerationJobs]);

  const manuallyRefundGenerationJob = useCallback(async (job: AdminGenerationJob) => {
    const updated = await executeAdminMutation(
      adminMutationIntent('job-refund', job.id),
      'admin-job-refund',
      key => mutations.refundAdminJob(job.id, key),
    );
    setGenerationJobs(current => current.map(item => item.id === updated.id ? updated : item));
    jobsPaging.reset();
    invalidateNavigationSummary();
    const feedback = generationRefundFeedback(updated);
    if (feedback.kind === 'success') toast.success(feedback.message);
    else if (feedback.kind === 'warning') toast.warning(feedback.message);
    else toast.info(feedback.message);
  }, [executeAdminMutation, invalidateNavigationSummary, jobsPaging.reset, setGenerationJobs]);

  const refundOrder = useCallback(async (order: AdminOrder) => {
    const updated = await executeAdminMutation(
      adminMutationIntent('order-refund', order.id),
      'admin-order-refund',
      key => mutations.refundOrder(order.id, key),
    );
    setAdminOrders(current => current.map(item => item.id === updated.id ? updated : item));
    ordersPaging.reset();
    invalidateNavigationSummary();
    void queryClient.invalidateQueries({ queryKey: privateQueryKey(sessionEpoch, 'admin', 'orders-summary') });
    showRefundFeedback(updated);
  }, [executeAdminMutation, invalidateNavigationSummary, ordersPaging.reset, queryClient, sessionEpoch, setAdminOrders]);

  const syncOrderRefund = useCallback(async (order: AdminOrder) => {
    const updated = await mutations.syncOrderRefund(order.id);
    setAdminOrders(current => current.map(item => item.id === updated.id ? updated : item));
    ordersPaging.reset();
    invalidateNavigationSummary();
    void queryClient.invalidateQueries({ queryKey: privateQueryKey(sessionEpoch, 'admin', 'orders-summary') });
    showRefundFeedback(updated);
  }, [invalidateNavigationSummary, ordersPaging.reset, queryClient, sessionEpoch, setAdminOrders]);

  const saveAdminPaymentChannel = useCallback(async (payload: Omit<AdminPaymentChannel, 'hasApiKey' | 'updatedAt'> & { apiKey?: string }) => {
    const channel = await executeAdminMutation(
      adminMutationIntent('payment-channel-save', undefined, payload),
      'admin-payment-channel',
      key => mutations.savePaymentChannel(payload, key),
    );
    setPaymentChannel(channel);
    queryClient.setQueryData(privateQueryKey(sessionEpoch, 'admin', 'payment-channel'), channel);
    return channel;
  }, [executeAdminMutation, queryClient, sessionEpoch]);

  const saveAdminPlan = useCallback(async (plan: AdminPlan) => {
    const payload = toPlanMutationPayload(plan);
    const updating = plans.some(item => item.id === plan.id);
    const action = updating ? 'plan-update' : 'plan-create';
    const saved = await executeAdminMutation(
      adminMutationIntent(action, updating ? plan.id : undefined, payload),
      `admin-${action}`,
      key => updating ? mutations.updatePlan(plan.id, payload, key) : mutations.createPlan(payload, key),
    );
    setPlans(current => mergeAdminPlanPreservingOrder(current, saved));
    queryClient.setQueryData<AdminPlan[]>(
      privateQueryKey(sessionEpoch, 'admin', 'plans'),
      current => mergeAdminPlanPreservingOrder(current ?? [], saved),
    );
  }, [executeAdminMutation, plans, queryClient, sessionEpoch, setPlans]);

  const createAdminAnnouncement = useCallback(async (payload: { title: string; content: string; pinned: boolean }) => {
    const created = await executeAdminMutation(
      adminMutationIntent('announcement-create', undefined, payload),
      'admin-announcement-create',
      key => mutations.createAnnouncement(payload, key),
    );
    setAnnouncements(current => [created, ...current.filter(item => item.id !== created.id)]);
    announcementsPaging.reset();
    const search = announcementFilters.search?.trim().toLowerCase() ?? '';
    const belongsToCurrentPage = !search
      || created.title.toLowerCase().includes(search)
      || created.content.toLowerCase().includes(search);
    if (announcementsPaging.request.position === 'first' && belongsToCurrentPage) {
      queryClient.setQueryData<CursorPage<PlatformAnnouncement>>(
        privateQueryKey(sessionEpoch, 'admin', 'announcements', announcementFilters, announcementsPaging.request),
        current => current ? {
          ...current,
          items: [created, ...current.items.filter(item => item.id !== created.id)].slice(0, current.pagination.limit),
        } : current,
      );
    }
    void queryClient.invalidateQueries({
      queryKey: privateQueryKey(sessionEpoch, 'admin', 'announcements'),
      refetchType: 'none',
    });
  }, [announcementFilters, announcementsPaging.request, announcementsPaging.reset, executeAdminMutation, queryClient, sessionEpoch, setAnnouncements]);

  const updateAdminAnnouncement = useCallback(async (id: string, payload: Partial<{ title: string; content: string; pinned: boolean }>) => {
    const updated = await executeAdminMutation(
      adminMutationIntent('announcement-update', id, payload),
      'admin-announcement-update',
      key => mutations.updateAnnouncement(id, payload, key),
    );
    setAnnouncements(current => current.map(item => item.id === updated.id ? updated : item));
    announcementsPaging.reset();
    updateAdminPages<PlatformAnnouncement>(queryClient, sessionEpoch, 'announcements', current => current.map(item => item.id === updated.id ? updated : item));
    const search = announcementFilters.search?.trim().toLowerCase() ?? '';
    if (search && !updated.title.toLowerCase().includes(search) && !updated.content.toLowerCase().includes(search)) {
      queryClient.setQueryData<CursorPage<PlatformAnnouncement>>(
        privateQueryKey(sessionEpoch, 'admin', 'announcements', announcementFilters, announcementsPaging.request),
        current => current ? { ...current, items: current.items.filter(item => item.id !== updated.id) } : current,
      );
    }
    void queryClient.invalidateQueries({ queryKey: privateQueryKey(sessionEpoch, 'admin', 'announcements'), refetchType: 'none' });
  }, [announcementFilters, announcementsPaging.request, announcementsPaging.reset, executeAdminMutation, queryClient, sessionEpoch, setAnnouncements]);

  const deleteAdminAnnouncement = useCallback(async (id: string) => {
    await executeAdminMutation(
      adminMutationIntent('announcement-delete', id),
      'admin-announcement-delete',
      key => mutations.deleteAnnouncement(id, key),
    );
    setAnnouncements(current => current.filter(item => item.id !== id));
    announcementsPaging.reset();
    updateAdminPages<PlatformAnnouncement>(queryClient, sessionEpoch, 'announcements', current => current.filter(item => item.id !== id));
    void queryClient.invalidateQueries({ queryKey: privateQueryKey(sessionEpoch, 'admin', 'announcements'), refetchType: 'none' });
  }, [announcementsPaging.reset, executeAdminMutation, queryClient, sessionEpoch, setAnnouncements]);

  const updateAdminFeatureFlags = useCallback(async (nextFlags: FeatureFlags) => {
    const result = await executeAdminMutation(
      adminMutationIntent('feature-flags-update', undefined, nextFlags),
      'admin-feature-flags',
      key => mutations.patchFeatureFlags(nextFlags, key),
    );
    setFeatureFlags(result.flags);
    queryClient.setQueryData(privateQueryKey(sessionEpoch, 'admin', 'feature-flags'), result.flags);
  }, [executeAdminMutation, queryClient, sessionEpoch, setFeatureFlags]);

  const updateAdminUserStatus = useCallback(async (user: AdminUser, status: AdminUser['status']) => {
    const updated = await executeAdminMutation(
      adminMutationIntent('user-status-update', user.id, { status }),
      'admin-user-status',
      key => mutations.updateUserStatus(user.id, status, key),
    );
    setAdminUsersState(current => current.map(item => item.id === updated.id ? updated : item));
    usersPaging.reset();
  }, [executeAdminMutation, setAdminUsersState, usersPaging.reset]);

  const updateAdminUserSubscription = useCallback(async (
    user: AdminUser,
    payload: AdminUserSubscriptionUpdate,
  ) => {
    let result: Awaited<ReturnType<typeof mutations.updateUserSubscription>>;
    try {
      result = await executeAdminMutation(
        adminMutationIntent('user-subscription-update', user.id, payload),
        'admin-user-subscription',
        idempotencyKey => mutations.updateUserSubscription(user.id, payload, idempotencyKey),
      );
    } catch (error) {
      void usersQuery.refetch();
      throw error;
    }
    setAdminUsersState(current => current.map(item => item.id === result.user.id ? result.user : item));
    usersPaging.reset();
    void queryClient.invalidateQueries({ queryKey: privateQueryKey(sessionEpoch, 'admin', 'plans') });
    void queryClient.invalidateQueries({ queryKey: privateQueryKey(sessionEpoch, 'admin', 'overview') });
    void queryClient.invalidateQueries({ queryKey: privateQueryKey(sessionEpoch, 'admin', 'audit') });
    void queryClient.invalidateQueries({ queryKey: privateQueryKey(sessionEpoch, 'admin', 'credits') });
    return result.user;
  }, [executeAdminMutation, queryClient, sessionEpoch, setAdminUsersState, usersPaging.reset, usersQuery.refetch]);

  const adjustAdminUserCredits = useCallback(async (
    user: AdminUser,
    mainDelta: number,
    addonDelta: number,
    note: string,
  ) => {
    const payload = { userId: user.id, mainDelta, addonDelta, note };
    const result = await executeAdminMutation(
      adminMutationIntent('credit-adjust', user.id, payload),
      'credit-adjust',
      idempotencyKey => mutations.adjustCredits(payload, idempotencyKey),
    );
    setAdminUsersState(current => current.map(item => item.id === result.user.id ? result.user : item));
    if (result.entries.length > 0) {
      void queryClient.invalidateQueries({ queryKey: privateQueryKey(sessionEpoch, 'admin', 'credits') });
    }
    void queryClient.invalidateQueries({ queryKey: privateQueryKey(sessionEpoch, 'admin', 'audit') });
    return result.user;
  }, [executeAdminMutation, queryClient, sessionEpoch, setAdminUsersState]);

  const updateAdminInvoiceStatus = useCallback(async (request: AdminInvoiceRequest, status: AdminInvoiceRequest['status']) => {
    const updated = await executeAdminMutation(
      adminMutationIntent('invoice-status-update', request.id, { status }),
      'admin-invoice-status',
      key => mutations.updateInvoiceStatus(request.id, status, key),
    );
    setAdminInvoiceRequests(current => current.map(item => item.id === updated.id ? updated : item));
    invoicesPaging.reset();
    invalidateNavigationSummary();
  }, [executeAdminMutation, invalidateNavigationSummary, invoicesPaging.reset, setAdminInvoiceRequests]);

  const updateAdminTicketStatus = useCallback(async (ticket: AdminTicket, status: AdminTicket['status']) => {
    const updated = await executeAdminMutation(
      adminMutationIntent('ticket-status-update', ticket.id, { status }),
      'admin-ticket-status',
      key => mutations.updateTicketStatus(ticket.id, status, key),
    );
    setTickets(current => current.map(item => item.id === updated.id ? updated : item));
    ticketsPaging.reset();
    invalidateNavigationSummary();
  }, [executeAdminMutation, invalidateNavigationSummary, setTickets, ticketsPaging.reset]);

  const getAdminTicketMessages = useCallback((ticketId: string) => queries.getAdminTicketMessages(ticketId), []);

  const markAdminTicketRead = useCallback(async (ticketId: string) => {
    const updated = await mutations.markAdminTicketRead(ticketId);
    setTickets(current => current.map(item => item.id === updated.id ? updated : item));
  }, [setTickets]);

  const replyAdminTicket = useCallback(async (ticketId: string, message: string): Promise<TicketMessage> => {
    const result = await executeAdminMutation(
      adminMutationIntent('ticket-reply', ticketId, { message }),
      'admin-ticket-reply',
      key => mutations.createAdminTicketMessage(ticketId, message, key),
    );
    setTickets(current => current.map(item => item.id === result.ticket.id ? result.ticket : item));
    ticketsPaging.reset();
    invalidateNavigationSummary();
    return result.message;
  }, [executeAdminMutation, invalidateNavigationSummary, setTickets, ticketsPaging.reset]);

  const updateAdminConsumptionCredits = useCallback(async (
    id: string,
    payload: { credits?: number; referenceVideoCredits?: number; available?: boolean },
  ) => {
    await executeAdminMutation(
      adminMutationIntent('consumption-setting-update', id, payload),
      'admin-consumption-setting',
      key => mutations.updateConsumptionSetting(id, payload, key),
    );
    void queryClient.invalidateQueries({ queryKey: privateQueryKey(sessionEpoch, 'admin', 'consumption-settings') });
  }, [executeAdminMutation, queryClient, sessionEpoch]);

  const updateAdminSeedance25ConsumptionAvailability = useCallback(async (available: boolean) => {
    await executeAdminMutation(
      adminMutationIntent('video-consumption-model-availability-update', 'Seedance 2.5', { available }),
      'admin-seedance-2-5-consumption-availability',
      key => mutations.updateVideoConsumptionModelAvailability('Seedance 2.5', available, key),
    );
    await queryClient.invalidateQueries({
      queryKey: privateQueryKey(sessionEpoch, 'admin', 'consumption-settings'),
    });
  }, [executeAdminMutation, queryClient, sessionEpoch]);

  const updateAdminTkPromptEngineSettings = useCallback(async (
    payload: { generationCredits?: number; available?: boolean },
  ) => {
    const tkPromptEngine = await executeAdminMutation(
      adminMutationIntent('tk-prompt-engine-settings-update', undefined, payload),
      'admin-tk-prompt-engine-settings',
      key => mutations.updateTkPromptEngineSettings(payload, key),
    );
    const settingsKey = privateQueryKey(sessionEpoch, 'admin', 'consumption-settings');
    const current = queryClient.getQueryData<ConsumptionSettings>(settingsKey) ?? consumptionQuery.data;
    if (current) {
      const next = { ...current, tkPromptEngine };
      queryClient.setQueryData(settingsKey, next);
      setConsumptionSettings(next);
    } else {
      void queryClient.invalidateQueries({ queryKey: settingsKey });
    }
  }, [consumptionQuery.data, executeAdminMutation, queryClient, sessionEpoch, setConsumptionSettings]);

  const clearAdminState = useCallback(() => {
    apiCostMainSequenceRef.current += 1;
    apiCostSyncPollingSequenceRef.current += 1;
    apiCostAuditRequestSequenceRef.current += 1;
    for (const request of Object.values(apiCostInFlightRef.current)) request?.controller.abort();
    apiCostInFlightRef.current = {};
    apiCostAuditControllerRef.current?.abort();
    apiCostAuditControllerRef.current = null;
    abortApiCostPageRequests(apiCostPageControllersRef.current, apiCostPageRequestRef.current);
    apiCostOverviewRef.current = null;
    apiCostOverviewDataKeyRef.current = null;
    apiCostRequestedKeysRef.current = { overview: null, users: null, tasks: null };
    setUserFiltersState({});
    setOrderFiltersState({});
    setInvoiceFiltersState({});
    setTicketFiltersState({});
    setJobFiltersState({});
    setCreditFiltersState({});
    setAuditFiltersState({});
    setAnnouncementFiltersState({});
    usersPaging.reset();
    ordersPaging.reset();
    invoicesPaging.reset();
    ticketsPaging.reset();
    jobsPaging.reset();
    creditsPaging.reset();
    auditPaging.reset();
    announcementsPaging.reset();
    setApiCostDashboard(createEmptyApiCostDashboard());
    setApiCostOverview(null);
    setApiCostUsers([]);
    setApiCostTasks([]);
    setApiCostAttempts([]);
    setApiCostPagination(createEmptyApiCostPagination());
    setApiCostLoadState(createApiCostLoadState());
    setPaymentChannel(EMPTY_PAYMENT_CHANNEL);
    setAdminOverview(null);
    setConsumptionSettings(EMPTY_CONSUMPTION_SETTINGS);
    adminMutationKeysRef.current.clear();
  }, [
    announcementsPaging.reset, auditPaging.reset, creditsPaging.reset, invoicesPaging.reset, jobsPaging.reset,
    ordersPaging.reset, setConsumptionSettings, ticketsPaging.reset, usersPaging.reset,
  ]);

  return {
    adminAnnouncements,
    adminUsersState,
    setSyncedAdminUsers: setAdminUsersState,
    adminOrders,
    tickets,
    setTickets,
    adminInvoiceRequests,
    generationJobs,
    setGenerationJobs,
    adminCreditLedger,
    auditLogs,
    setAuditLogs,
    apiCostDashboard,
    apiCostOverview,
    apiCostUsers,
    apiCostTasks,
    apiCostAttempts,
    apiCostPagination,
    apiCostLoadState,
    loadApiCostOverview,
    loadApiCostTasks,
    refreshApiCostOverview,
    cancelApiCostOperatingRequests,
    loadApiCostAudit,
    cancelApiCostAuditRequests,
    navigateApiCostPage,
    requestApiCostSync,
    paymentChannel,
    adminOverview,
    adminNavigationSummary: navigationQuery.data ?? null,
    adminOrderSummary: orderSummaryQuery.data ?? null,
    adminRealPortraitCapacity: realPortraitCapacityQuery.data ?? null,
    adminRealPortraitCapacityLoading: realPortraitCapacityQuery.isPending,
    adminRealPortraitCapacityError: realPortraitCapacityQuery.error,
    refreshCurrentAdminPage,
    adminListControls: {
      announcements: listControl(announcementFilters, setAnnouncementFilters, announcementsPaging, announcementsQuery),
      users: listControl(userFilters, setUserFilters, usersPaging, usersQuery),
      orders: listControl(orderFilters, setOrderFilters, ordersPaging, ordersQuery),
      invoices: listControl(invoiceFilters, setInvoiceFilters, invoicesPaging, invoicesQuery),
      tickets: listControl(ticketFilters, setTicketFilters, ticketsPaging, ticketsQuery),
      jobs: listControl(jobFilters, setJobFilters, jobsPaging, jobsQuery),
      credits: listControl(creditFilters, setCreditFilters, creditsPaging, creditsQuery),
      audit: listControl(auditFilters, setAuditFilters, auditPaging, auditQuery),
    },
    loadAdminAsset,
    loadAdminOrderDetail,
    loadAdminJobDetail,
    retryGenerationJob,
    manuallyRefundGenerationJob,
    refundOrder,
    syncOrderRefund,
    saveAdminPaymentChannel,
    saveAdminPlan,
    createAdminAnnouncement,
    updateAdminAnnouncement,
    deleteAdminAnnouncement,
    updateAdminFeatureFlags,
    updateAdminUserStatus,
    updateAdminUserSubscription,
    adjustAdminUserCredits,
    updateAdminInvoiceStatus,
    updateAdminTicketStatus,
    getAdminTicketMessages,
    markAdminTicketRead,
    replyAdminTicket,
    updateAdminConsumptionCredits,
    updateAdminSeedance25ConsumptionAvailability,
    updateAdminTkPromptEngineSettings,
    clearAdminState,
  };
}

export function isAdminDataEnabled(
  routePath: string,
  accountEmail: string,
  accountRole: 'user' | 'admin',
) {
  return Boolean(accountEmail) && accountRole === 'admin' && routePath.startsWith('/admin');
}

function adminTabFromPath(path: string) {
  return path.split('/')[2] || 'overview';
}

function normalizeAdminFilters<Filters extends Record<string, unknown>>(filters: Filters): Filters {
  return Object.fromEntries(Object.entries(filters).flatMap(([key, value]) => {
    if (typeof value === 'string') {
      const normalized = value.trim();
      return normalized ? [[key, normalized]] : [];
    }
    return value === undefined || value === null ? [] : [[key, value]];
  })) as Filters;
}

function listControl<Filters extends Record<string, unknown>, Item>(
  filters: Filters,
  setFilters: (filters: Filters) => void,
  paging: ReturnType<typeof useCursorPagination>,
  query: { data?: ExactCursorPage<Item>; isFetching: boolean; error: unknown },
) {
  return {
    filters,
    setFilters,
    pagination: query.data?.pagination,
    loading: query.isFetching,
    error: query.error instanceof Error ? query.error : null,
    navigate: (position: PagePosition) => paging.navigate(position, query.data?.pagination),
  };
}

function useEmptyAdminPageRecovery(
  query: { data?: CursorPage<unknown>; isFetching: boolean },
  paging: ReturnType<typeof useCursorPagination>,
) {
  useEffect(() => {
    if (
      !query.isFetching
      && query.data
      && query.data.items.length === 0
      && paging.request.position !== 'first'
    ) {
      paging.recoverEmptyPage(query.data.pagination);
    }
  }, [paging.recoverEmptyPage, paging.request.position, query.data, query.isFetching]);
}

/**
 * 后台精准快照与用户端遵循同一恢复协议：成功页只采用快照令牌而不重复请求；
 * 资源版本失效时保留占位数据、回到首页，并且每次失效最多提示一次。
 */
function useExactAdminPageLifecycle(
  query: { data?: ExactCursorPage<unknown>; isFetching: boolean; error: unknown },
  paging: ReturnType<typeof useCursorPagination>,
) {
  const noticeShownRef = useRef(false);

  useEffect(() => {
    if (query.isFetching || !query.data) return;
    paging.adoptSnapshot(query.data.pagination);
    noticeShownRef.current = false;
  }, [paging.adoptSnapshot, query.data, query.isFetching]);

  useEffect(() => {
    if (!isPaginationSnapshotChanged(query.error)) return;
    paging.reset();
    if (!noticeShownRef.current) {
      noticeShownRef.current = true;
      toast.info('列表已更新，已返回第 1 页');
    }
  }, [paging.reset, query.error]);
}

function updateAdminPages<Item>(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionEpoch: number,
  resource: string,
  update: SetStateAction<Item[]>,
) {
  queryClient.setQueriesData<CursorPage<Item>>(
    { queryKey: privateQueryKey(sessionEpoch, 'admin', resource) },
    current => current
      ? { ...current, items: typeof update === 'function' ? (update as (items: Item[]) => Item[])(current.items) : update }
      : current,
  );
}

export function toPlanMutationPayload(plan: AdminPlan): mutations.PlanMutationPayload {
  const isAddon = plan.kind === 'addon';
  return {
    code: plan.code.trim(),
    name: plan.name.trim(),
    nameEn: plan.nameEn.trim(),
    kind: plan.kind,
    billing: isAddon ? 'one-time' : 'both',
    description: plan.description.trim(),
    monthlyPrice: Math.max(0, Math.round(plan.monthlyPrice)),
    yearlyPrice: isAddon ? 0 : Math.max(0, Math.round(plan.yearlyPrice)),
    credits: Math.max(0, Math.round(plan.credits)),
    assetRetentionDays: isAddon ? 0 : Math.max(0, Math.round(plan.assetRetentionDays)),
    portraitEntitlements: isAddon || !plan.portraitEntitlements.enabled
      ? {
          enabled: false,
          profileLimit: 0,
          activeLimit: 0,
          assetsPerActor: 0,
        }
      : {
          enabled: true,
          profileLimit: plan.portraitEntitlements.profileLimit === null
            ? null
            : Math.max(1, Math.round(plan.portraitEntitlements.profileLimit)),
          activeLimit: Math.max(1, Math.round(plan.portraitEntitlements.activeLimit)),
          assetsPerActor: plan.portraitEntitlements.assetsPerActor === 2 ? 2 : 1,
        },
    storage: isAddon ? '不增加' : plan.storage.trim(),
    tiktokAccounts: isAddon ? '不增加' : plan.tiktokAccounts.trim(),
    recommendation: isAddon ? null : plan.recommendation,
    iconKey: isAddon ? null : plan.iconKey ?? 'sparkles',
    ctaLabel: plan.ctaLabel.trim(),
    status: plan.status,
    landingVisible: isAddon ? false : plan.landingVisible,
    features: isAddon ? [] : plan.features,
  };
}

export function generationRefundFeedback(job: AdminGenerationJob): {
  kind: 'success' | 'warning' | 'info';
  message: string;
} {
  if (job.creditStatus === 'refunded') {
    if (job.refundedCredits >= job.reservedCredits) {
      return { kind: 'success', message: `已退回 ${job.refundedCredits} 积分` };
    }
    const expiredCredits = Math.max(0, job.reservedCredits - job.refundedCredits);
    return {
      kind: 'info',
      message: `已退回 ${job.refundedCredits} 积分；${expiredCredits} 积分所属批次已过期，未恢复到账户`,
    };
  }
  if (job.creditStatus === 'held') {
    return { kind: 'warning', message: '积分仍处于冻结状态，退款未完成，请继续核对任务与供应商结果' };
  }
  if (job.creditStatus === 'settled') {
    return { kind: 'warning', message: '供应商用量已结算，本次操作未退回积分' };
  }
  return { kind: 'info', message: '任务积分状态已更新，请以积分流水为准' };
}

function showRefundFeedback(order: AdminOrder) {
  const feedback = refundFeedback(order);
  if (feedback.tone === 'success') toast.success(feedback.message);
  else if (feedback.tone === 'error') toast.error(feedback.message);
  else if (feedback.tone === 'warning') toast.warning(feedback.message);
  else toast.info(feedback.message);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function apiCostOperatingLoadError(results: PromiseSettledResult<unknown>[]) {
  const reasons = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  const failures = reasons.filter(reason => !isAbortError(reason));
  if (failures.length > 0) {
    const messages = [...new Set(failures.map(reason => (
      reason instanceof Error ? reason.message : '请求失败，请稍后重试'
    )))];
    return new Error(`成本看盘刷新不完整：${messages.join('；')}`);
  }
  const canceled = reasons.find(isAbortError);
  return canceled instanceof Error ? canceled : null;
}

function adminMutationIntent(action: string, resourceId?: string, payload?: unknown) {
  const serialized = payload === undefined ? '' : JSON.stringify(payload);
  // 指纹只用于当前会话内复用不确定请求的键；使用散列避免把支付密钥等表单内容留在 Map key 中。
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${action}:${resourceId ?? 'new'}:${serialized.length}:${(hash >>> 0).toString(36)}`;
}
