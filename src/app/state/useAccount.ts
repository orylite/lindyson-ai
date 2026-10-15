import { keepPreviousData,useQuery,useQueryClient } from '@tanstack/react-query';
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { toast } from 'sonner';
import { isPaginationSnapshotChanged,retryUnlessPaginationSnapshotChanged } from '../api/client';
import type { CursorPage,PagePosition } from '../api/cursor';
import * as mutations from '../api/mutations';
import { privateQueryKey } from '../api/queryClient';
import * as queries from '../api/queries';
import type { AccountProfile } from '../data/account';
import type { Priority,TicketMessage,UserTicket } from '../data/admin';
import type { DashboardAggregate,DashboardAggregateStatus } from './dashboard';
import { getRouteFlags } from './routing';
import { cursorPageRequestIdentity,useCursorPagination } from './useCursorPagination';

interface UseAccountOptions {
  accountRef: { current: AccountProfile };
  accountEmail: string;
  setAccount: (account: AccountProfile) => void;
  routePath: string;
  setActiveTab: (tab: string) => void;
  refreshFeatureFlags: () => Promise<unknown>;
  sessionEpoch: number;
}

/** 账户资料、用户工单和用户仪表盘聚合。 */
export function useAccount({
  accountRef,
  accountEmail,
  setAccount,
  routePath,
  setActiveTab,
  refreshFeatureFlags,
  sessionEpoch,
}: UseAccountOptions) {
  const queryClient = useQueryClient();
  const [accountCenterSection, setAccountCenterSection] = useState<'overview' | 'orders' | 'referrals' | 'chatgpt'>('overview');
  const [contactOpen, setContactOpen] = useState(false);
  const ticketPaging = useCursorPagination(6);
  const [ticketCreationRefreshPending, setTicketCreationRefreshPending] = useState(false);
  const ticketSnapshotNoticeRef = useRef(false);
  const authenticatedApp = Boolean(accountEmail) && getRouteFlags(routePath).isAppRoute;
  const dashboardEnabled = authenticatedApp && (routePath === '/app' || routePath === '/app/dashboard');
  const ticketKey = useMemo(() => privateQueryKey(
    sessionEpoch,
    'support',
    'tickets',
    cursorPageRequestIdentity(ticketPaging.request),
  ), [
    sessionEpoch,
    ticketPaging.request.cursor,
    ticketPaging.request.limit,
    ticketPaging.request.position,
    ticketPaging.request.revision,
  ]);
  const ticketSummaryKey = useMemo(
    () => privateQueryKey(sessionEpoch, 'support', 'summary'),
    [sessionEpoch],
  );
  const dashboardKey = useMemo(() => privateQueryKey(sessionEpoch, 'dashboard'), [sessionEpoch]);
  const accountKey = useMemo(() => privateQueryKey(sessionEpoch, 'account', 'me'), [sessionEpoch]);

  const accountQuery = useQuery({
    queryKey: accountKey,
    queryFn: queries.getMe,
    enabled: authenticatedApp,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const ticketsQuery = useQuery({
    queryKey: ticketKey,
    queryFn: ({ signal }) => queries.getSupportTicketsPage(ticketPaging.request, signal),
    enabled: authenticatedApp && contactOpen,
    placeholderData: keepPreviousData,
    retry: retryUnlessPaginationSnapshotChanged,
    staleTime: 30_000,
  });
  const ticketSummaryQuery = useQuery({
    queryKey: ticketSummaryKey,
    queryFn: ({ signal }) => queries.getSupportSummary(signal),
    enabled: authenticatedApp,
    refetchInterval: 30_000,
    staleTime: 30_000,
  });
  const dashboardQuery = useQuery({
    queryKey: dashboardKey,
    queryFn: queries.getDashboardSummary,
    enabled: dashboardEnabled,
    staleTime: 30_000,
  });
  const userTickets = ticketsQuery.data?.items ?? [];
  const dashboardAggregate = (dashboardQuery.data ?? null) as DashboardAggregate | null;
  const dashboardAggregateStatus: DashboardAggregateStatus = !dashboardEnabled
    ? 'idle'
    : dashboardQuery.isPending
    ? 'loading'
    : dashboardQuery.isError
      ? 'error'
      : dashboardQuery.data
        ? 'ready'
        : 'idle';

  useEffect(() => {
    if (ticketsQuery.isFetching || ticketsQuery.isPlaceholderData || ticketsQuery.isError || !ticketsQuery.data) return;
    ticketPaging.adoptSnapshot(ticketsQuery.data.pagination);
    ticketSnapshotNoticeRef.current = false;
    setTicketCreationRefreshPending(false);
  }, [ticketPaging.adoptSnapshot, ticketsQuery.data, ticketsQuery.isFetching, ticketsQuery.isPlaceholderData, ticketsQuery.isError]);

  useEffect(() => {
    if (!isPaginationSnapshotChanged(ticketsQuery.error)) return;
    ticketPaging.reset();
    if (!ticketSnapshotNoticeRef.current) {
      ticketSnapshotNoticeRef.current = true;
      toast.info('列表已更新，已返回第 1 页');
    }
  }, [ticketPaging.reset, ticketsQuery.error]);

  useEffect(() => {
    const latestAccount = accountQuery.data;
    if (!latestAccount || latestAccount.email !== accountRef.current.email) return;
    setAccount(latestAccount);
  }, [accountQuery.data, accountRef, setAccount]);

  useEffect(() => {
    if (!authenticatedApp) return;
    const refreshOnFocus = () => {
      void accountQuery.refetch();
    };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [accountQuery.refetch, authenticatedApp]);

  useEffect(() => {
    if (!ticketsQuery.isFetching && ticketsQuery.data?.items.length === 0 && ticketPaging.request.position !== 'first') {
      ticketPaging.recoverEmptyPage(ticketsQuery.data.pagination);
    }
  }, [ticketPaging.recoverEmptyPage, ticketPaging.request.position, ticketsQuery.data, ticketsQuery.isFetching]);

  const refreshAccount = useCallback(async () => {
    const result = await accountQuery.refetch();
    const nextAccount = result.data;
    if (!nextAccount) throw result.error ?? new Error('账户信息刷新失败');
    setAccount(nextAccount);
    return nextAccount;
  }, [accountQuery.refetch, setAccount]);

  const updateAccount = useCallback(async (patch: Partial<AccountProfile>) => {
    const nextAccount = await mutations.updateProfile({ userName: patch.userName });
    setAccount(nextAccount);
  }, [setAccount]);

  const changeAccountPassword = useCallback(async (payload: { currentPassword: string; newPassword: string }) => {
    const nextAccount = await mutations.changePassword(payload);
    setAccount(nextAccount);
  }, [setAccount]);

  const refreshUserTickets = useCallback(async () => {
    const result = await ticketsQuery.refetch();
    return result.data?.items ?? [];
  }, [ticketsQuery.refetch]);

  const setUserTickets = useCallback((value: UserTicket[] | ((current: UserTicket[]) => UserTicket[])) => {
    queryClient.setQueryData<CursorPage<UserTicket>>(ticketKey, current => {
      const currentItems = current?.items ?? [];
      const items = typeof value === 'function' ? value(currentItems) : value;
      return current ? { ...current, items } : current;
    });
  }, [queryClient, ticketKey]);

  const navigateTicketPage = useCallback((position: PagePosition) => {
    ticketPaging.navigate(position, ticketsQuery.data?.pagination);
  }, [ticketPaging.navigate, ticketsQuery.data?.pagination]);

  const refreshDashboardAggregate = useCallback(async () => {
    const result = await dashboardQuery.refetch();
    if (result.error || !result.data) throw result.error ?? new Error('工作台汇总加载失败');
    return result.data;
  }, [dashboardQuery.refetch]);

  useEffect(() => {
    if (!authenticatedApp || accountRef.current.role === 'admin') return;
    void refreshFeatureFlags().catch(error => {
      if (!isAbortError(error)) toast.error('功能配置加载失败，将继续使用上次数据');
    });
  }, [authenticatedApp, accountRef, refreshFeatureFlags, sessionEpoch]);

  useEffect(() => {
    if (!accountRef.current.email || !getRouteFlags(routePath).isAppRoute) return;
    const refreshOnFocus = () => {
      if (accountRef.current.role !== 'admin') {
        void refreshFeatureFlags().catch(error => {
          if (!isAbortError(error)) toast.error('功能配置刷新失败，将继续使用上次数据');
        });
      }
    };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [accountEmail, accountRef, refreshFeatureFlags, routePath]);

  const openAccountCenter = useCallback((section: 'overview' | 'orders' | 'referrals' | 'chatgpt' = 'overview') => {
    setAccountCenterSection(section);
    setActiveTab('account-center');
  }, [setActiveTab]);

  const createSupportTicket = useCallback(async (ticket: { title: string; message: string; priority: Priority }) => {
    const created = await mutations.createSupportTicket(ticket);
    await queryClient.cancelQueries({ queryKey: privateQueryKey(sessionEpoch, 'support', 'tickets') });
    setTicketCreationRefreshPending(true);
    ticketPaging.reset();
    void queryClient.invalidateQueries({ queryKey: ticketSummaryKey });
    return created;
  }, [queryClient, sessionEpoch, ticketPaging.reset, ticketSummaryKey]);

  const getSupportTicketMessages = useCallback((ticketId: string) => queries.getSupportTicketMessages(ticketId), []);

  const replySupportTicket = useCallback(async (ticketId: string, message: string): Promise<TicketMessage> => {
    const result = await mutations.createSupportTicketMessage(ticketId, message);
    setUserTickets(current => current.map(item => item.id === result.ticket.id ? result.ticket : item));
    void queryClient.invalidateQueries({ queryKey: ticketSummaryKey });
    return result.message;
  }, [queryClient, setUserTickets, ticketSummaryKey]);

  const markSupportTicketRead = useCallback(async (ticketId: string) => {
    const updated = await mutations.markSupportTicketRead(ticketId);
    setUserTickets(current => current.map(item => item.id === updated.id ? updated : item));
    void queryClient.invalidateQueries({ queryKey: ticketSummaryKey });
  }, [queryClient, setUserTickets, ticketSummaryKey]);

  const clearAccountState = useCallback(() => {
    setContactOpen(false);
    setAccountCenterSection('overview');
    setTicketCreationRefreshPending(false);
    ticketPaging.reset();
  }, []);

  return {
    accountCenterSection,
    setAccountCenterSection,
    userTickets,
    setUserTickets,
    userTicketPagination: ticketsQuery.data?.pagination,
    userTicketPageLoading: ticketsQuery.isFetching,
    userTicketPageError: ticketsQuery.isError && !isPaginationSnapshotChanged(ticketsQuery.error)
      ? ticketCreationRefreshPending ? '工单已创建，列表刷新失败，请重试' : '工单列表加载失败，请重试'
      : undefined,
    retryTicketPage: ticketPaging.reset,
    navigateTicketPage,
    ticketUnreadCount: ticketSummaryQuery.data?.unreadTickets ?? 0,
    dashboardAggregate,
    dashboardAggregateStatus,
    contactOpen,
    setContactOpen,
    refreshAccount,
    updateAccount,
    changeAccountPassword,
    refreshUserTickets,
    refreshDashboardAggregate,
    openAccountCenter,
    createSupportTicket,
    getSupportTicketMessages,
    replySupportTicket,
    markSupportTicketRead,
    clearAccountState,
  };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
