import { keepPreviousData,useQuery,useQueryClient } from '@tanstack/react-query';
import { useCallback,useEffect,useRef,useState } from 'react';
import { toast } from 'sonner';
import type { CursorPage,CursorPageInput,PagePosition } from '../api/cursor';
import { isPaginationSnapshotChanged,retryUnlessPaginationSnapshotChanged } from '../api/client';
import * as mutations from '../api/mutations';
import { privateQueryKey } from '../api/queryClient';
import * as queries from '../api/queries';
import type { AccountProfile } from '../data/account';
import type {
  AdminOrder,
  AdminPlan,
  CreditType,
  OrderHistoryFilter,
} from '../data/admin';
import { usePaymentMonitor,type StartPaymentMonitorInput } from './usePaymentMonitor';
import type { AppTab } from './routing';
import { cursorPageRequestIdentity,useCursorPagination } from './useCursorPagination';

interface UseBillingOptions {
  accountRef: { current: AccountProfile };
  refreshAccount: () => Promise<AccountProfile>;
  openAccountCenter: (section?: 'overview' | 'orders') => void;
  activeTab: AppTab;
  accountEmail: string;
  accountCenterSection: 'overview' | 'orders' | 'referrals' | 'chatgpt';
  contactOpen: boolean;
  sessionEpoch: number;
}

/** 用户订单、发票、积分流水和支付结果状态。 */
export function useBilling({
  accountRef,
  refreshAccount,
  openAccountCenter,
  activeTab,
  accountEmail,
  accountCenterSection,
  contactOpen,
  sessionEpoch,
}: UseBillingOptions) {
  const queryClient = useQueryClient();
  const ledgerPaging = useCursorPagination(20);
  const paidOrdersPaging = useCursorPagination(20);
  const [ledgerFilter, setLedgerFilterState] = useState<'all' | CreditType>('all');
  const [paymentSuccess, setPaymentSuccess] = useState<{ order: AdminOrder; account: AccountProfile } | null>(null);
  const paymentResultSequenceRef = useRef(0);
  const orderHistoryRequestSequenceRef = useRef(0);
  const ledgerSnapshotNoticeRef = useRef(false);
  const orderSnapshotNoticeRef = useRef(false);
  const ledgerKey = privateQueryKey(
    sessionEpoch,
    'billing',
    'ledger',
    ledgerFilter,
    cursorPageRequestIdentity(ledgerPaging.request),
  );
  const paidOrdersKey = privateQueryKey(
    sessionEpoch,
    'billing',
    'contact-orders',
    'paid',
    cursorPageRequestIdentity(paidOrdersPaging.request),
  );
  const ledgerQuery = useQuery({
    queryKey: ledgerKey,
    queryFn: ({ signal }) => queries.getCreditLedgerPage({
      ...ledgerPaging.request,
      type: ledgerFilter === 'all' ? undefined : ledgerFilter,
    }, signal),
    enabled: Boolean(accountEmail) && activeTab === 'account-center' && accountCenterSection === 'overview',
    placeholderData: keepPreviousData,
    retry: retryUnlessPaginationSnapshotChanged,
    staleTime: 30_000,
  });
  const paidOrdersQuery = useQuery({
    queryKey: paidOrdersKey,
    queryFn: ({ signal }) => queries.getOrderHistory({
      ...paidOrdersPaging.request,
      status: 'all',
      invoiceable: true,
    }, signal),
    enabled: Boolean(accountEmail) && contactOpen,
    placeholderData: keepPreviousData,
    retry: retryUnlessPaginationSnapshotChanged,
    staleTime: 30_000,
  });
  const userOrders = paidOrdersQuery.data?.items ?? [];
  const userCreditLedger = ledgerQuery.data?.items ?? [];

  useEffect(() => {
    if (ledgerQuery.isFetching || !ledgerQuery.data) return;
    ledgerPaging.adoptSnapshot(ledgerQuery.data.pagination);
    ledgerSnapshotNoticeRef.current = false;
  }, [ledgerPaging.adoptSnapshot, ledgerQuery.data, ledgerQuery.isFetching]);

  useEffect(() => {
    if (!isPaginationSnapshotChanged(ledgerQuery.error)) return;
    ledgerPaging.reset();
    if (!ledgerSnapshotNoticeRef.current) {
      ledgerSnapshotNoticeRef.current = true;
      toast.info('列表已更新，已返回第 1 页');
    }
  }, [ledgerPaging.reset, ledgerQuery.error]);

  useEffect(() => {
    if (paidOrdersQuery.isFetching || !paidOrdersQuery.data) return;
    paidOrdersPaging.adoptSnapshot(paidOrdersQuery.data.pagination);
    orderSnapshotNoticeRef.current = false;
  }, [paidOrdersPaging.adoptSnapshot, paidOrdersQuery.data, paidOrdersQuery.isFetching]);

  useEffect(() => {
    if (!isPaginationSnapshotChanged(paidOrdersQuery.error)) return;
    paidOrdersPaging.reset();
    if (!orderSnapshotNoticeRef.current) {
      orderSnapshotNoticeRef.current = true;
      toast.info('列表已更新，已返回第 1 页');
    }
  }, [paidOrdersPaging.reset, paidOrdersQuery.error]);

  useEffect(() => {
    if (!ledgerQuery.isFetching && ledgerQuery.data?.items.length === 0 && ledgerPaging.request.position !== 'first') {
      ledgerPaging.recoverEmptyPage(ledgerQuery.data.pagination);
    }
  }, [ledgerPaging.recoverEmptyPage, ledgerPaging.request.position, ledgerQuery.data, ledgerQuery.isFetching]);

  useEffect(() => {
    if (!paidOrdersQuery.isFetching && paidOrdersQuery.data?.items.length === 0 && paidOrdersPaging.request.position !== 'first') {
      paidOrdersPaging.recoverEmptyPage(paidOrdersQuery.data.pagination);
    }
  }, [paidOrdersPaging.recoverEmptyPage, paidOrdersPaging.request.position, paidOrdersQuery.data, paidOrdersQuery.isFetching]);

  const refreshUserOrders = useCallback(async () => {
    const result = await paidOrdersQuery.refetch();
    return result.data?.items ?? [];
  }, [paidOrdersQuery.refetch]);

  const invalidateUserCreditLedger = useCallback(() => {
    void invalidateCreditLedgerQueries(queryClient, sessionEpoch);
  }, [queryClient, sessionEpoch]);

  const setLedgerFilter = useCallback((filter: 'all' | CreditType) => {
    setLedgerFilterState(filter);
    ledgerPaging.reset();
  }, [ledgerPaging.reset]);

  const navigateLedgerPage = useCallback((position: PagePosition) => {
    ledgerPaging.navigate(position, ledgerQuery.data?.pagination);
  }, [ledgerPaging.navigate, ledgerQuery.data?.pagination]);

  const navigatePaidOrdersPage = useCallback((position: PagePosition) => {
    paidOrdersPaging.navigate(position, paidOrdersQuery.data?.pagination);
  }, [paidOrdersPaging.navigate, paidOrdersQuery.data?.pagination]);

  const loadOrderHistory = useCallback(async (input: CursorPageInput & { limit: number; status: OrderHistoryFilter }) => {
    const requestSequence = ++orderHistoryRequestSequenceRef.current;
    await cancelOrderHistoryQueries(queryClient, sessionEpoch);
    if (requestSequence !== orderHistoryRequestSequenceRef.current) {
      throw new DOMException('订单筛选已切换', 'AbortError');
    }
    return queryClient.fetchQuery({
      queryKey: privateQueryKey(sessionEpoch, 'billing', 'orders', input.status, input),
      queryFn: ({ signal }) => queries.getOrderHistory(input, signal),
      staleTime: 30_000,
    });
  }, [queryClient, sessionEpoch]);

  const syncPaymentOrder = useCallback((orderId: string, options: { signal?: AbortSignal } = {}) => {
    return mutations.syncPaymentOrder(orderId, options);
  }, []);

  const paymentMonitor = usePaymentMonitor({ syncPaymentOrder });

  const presentPaymentSuccess = useCallback(async (order: AdminOrder) => {
    const requestSequence = ++paymentResultSequenceRef.current;
    const accountEmail = accountRef.current.email;
    let latestAccount = accountRef.current;
    try {
      latestAccount = await refreshAccount();
    } catch {
      // 支付已确认时，摘要刷新失败不应覆盖核心支付结果。
    }
    if (paymentResultSequenceRef.current !== requestSequence || accountRef.current.email !== accountEmail) return;
    updateCachedOrders(queryClient, sessionEpoch, order);
    setPaymentSuccess({ order, account: latestAccount });
    invalidateUserCreditLedger();
  }, [accountRef, invalidateUserCreditLedger, queryClient, refreshAccount, sessionEpoch]);

  const confirmPaymentSuccess = useCallback(() => {
    setPaymentSuccess(null);
    openAccountCenter('overview');
  }, [openAccountCenter]);

  const createPayment = useCallback(async (
    plan: AdminPlan,
    billing: Exclude<AdminPlan['billing'], 'both'>,
    surface: 'pc' | 'mobile',
    idempotencyKey: string,
  ) => {
    const result = await mutations.createPayment({ planId: plan.id, billing, surface, idempotencyKey });
    updateCachedOrders(queryClient, sessionEpoch, result.order);
    return result;
  }, [queryClient, sessionEpoch]);

  const startPaymentMonitor = useCallback((input: StartPaymentMonitorInput) => {
    paymentMonitor.startPaymentMonitor({
      ...input,
      onFailed: async order => {
        updateCachedOrders(queryClient, sessionEpoch, order);
        await input.onFailed(order);
      },
    });
  }, [paymentMonitor.startPaymentMonitor, queryClient, sessionEpoch]);

  const cancelPaymentOrder = useCallback(async (orderId: string) => {
    const order = await mutations.cancelPaymentOrder(orderId);
    updateCachedOrders(queryClient, sessionEpoch, order);
    return order;
  }, [queryClient, sessionEpoch]);

  const createInvoiceRequest = useCallback(async (request: {
    orderId: string;
    invoiceTitle: string;
    taxId: string;
    receiveEmail: string;
    note: string;
  }) => {
    const created = await mutations.createInvoice(request);
    updateCachedOrders(queryClient, sessionEpoch, {
      ...userOrders.find(order => order.id === created.orderId),
      id: created.orderId,
      invoiceRequestStatus: created.status,
    } as AdminOrder);
    paidOrdersPaging.reset();
    await queryClient.invalidateQueries({
      queryKey: privateQueryKey(sessionEpoch, 'billing', 'contact-orders'),
      refetchType: 'none',
    });
  }, [paidOrdersPaging.reset, queryClient, sessionEpoch, userOrders]);

  const clearBillingState = useCallback(() => {
    paymentMonitor.stopPaymentMonitor();
    paymentResultSequenceRef.current += 1;
    orderHistoryRequestSequenceRef.current += 1;
    void cancelOrderHistoryQueries(queryClient, sessionEpoch);
    setPaymentSuccess(null);
    setLedgerFilterState('all');
    ledgerPaging.reset();
    paidOrdersPaging.reset();
  }, [ledgerPaging.reset, paidOrdersPaging.reset, paymentMonitor.stopPaymentMonitor, queryClient, sessionEpoch]);

  return {
    userOrders,
    userOrderPagination: paidOrdersQuery.data?.pagination,
    userOrderPageLoading: paidOrdersQuery.isFetching,
    navigateUserOrderPage: navigatePaidOrdersPage,
    userCreditLedger,
    ledgerFilter,
    setLedgerFilter,
    ledgerPagination: ledgerQuery.data?.pagination,
    ledgerPageLoading: ledgerQuery.isFetching,
    navigateLedgerPage,
    paymentSuccess,
    refreshUserOrders,
    invalidateUserCreditLedger,
    loadOrderHistory,
    presentPaymentSuccess,
    confirmPaymentSuccess,
    createPayment,
    syncPaymentOrder,
    cancelPaymentOrder,
    paymentMonitorStatus: paymentMonitor.paymentMonitorStatus,
    startPaymentMonitor,
    stopPaymentMonitor: paymentMonitor.stopPaymentMonitor,
    createInvoiceRequest,
    clearBillingState,
  };
}

export function cancelOrderHistoryQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionEpoch: number,
) {
  return queryClient.cancelQueries({ queryKey: privateQueryKey(sessionEpoch, 'billing', 'orders') });
}

/** 财务写操作只将流水缓存标记为过期，未打开账户流水时不会发起请求。 */
export function invalidateCreditLedgerQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionEpoch: number,
) {
  return queryClient.invalidateQueries({
    queryKey: privateQueryKey(sessionEpoch, 'billing', 'ledger'),
    refetchType: 'none',
  });
}

function updateCachedOrders(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionEpoch: number,
  patch: Pick<AdminOrder, 'id'> & Partial<AdminOrder>,
) {
  queryClient.setQueriesData<CursorPage<AdminOrder>>(
    { queryKey: privateQueryKey(sessionEpoch, 'billing') },
    current => current ? {
      ...current,
      items: current.items.map(order => order.id === patch.id ? { ...order, ...patch } : order),
    } : current,
  );
}
