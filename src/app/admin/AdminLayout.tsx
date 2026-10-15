import { ArrowLeft,Lock,Menu,RefreshCw,X } from 'lucide-react';
import { Suspense,lazy,useEffect,useLayoutEffect,useRef,useState } from 'react';
import { toast } from 'sonner';
import { LoadingState } from '../ui';
import { ConfirmModal,DetailModal } from './components/AdminModals';
import { ADMIN_NAV } from './config/navigation';
import type { AdminLayoutProps,AdminTab,ConfirmState,DetailState } from './types';

const AdminReferralsPage = lazy(() => import('./pages/ReferralsPage').then(module => ({ default: module.AdminReferralsPage })));

const AdminOverviewPage = lazy(() => import('./pages/OverviewPage').then(module => ({ default: module.AdminOverviewPage })));
const AdminAnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage').then(module => ({ default: module.AdminAnnouncementsPage })));
const AdminPlansPage = lazy(() => import('./pages/PlansPage').then(module => ({ default: module.AdminPlansPage })));
const AdminRealPortraitCapacityPage = lazy(() => import('./pages/RealPortraitCapacityPage').then(module => ({ default: module.AdminRealPortraitCapacityPage })));
const AdminConsumptionSettingsPage = lazy(() => import('./pages/ConsumptionSettingsPage').then(module => ({ default: module.AdminConsumptionSettingsPage })));
const AdminFeatureFlagsPage = lazy(() => import('./pages/FeatureFlagsPage').then(module => ({ default: module.AdminFeatureFlagsPage })));
const AdminPaymentChannelPage = lazy(() => import('./pages/PaymentChannelPage').then(module => ({ default: module.AdminPaymentChannelPage })));
const AdminOrdersPage = lazy(() => import('./pages/OrdersPage').then(module => ({ default: module.AdminOrdersPage })));
const AdminUsersPage = lazy(() => import('./pages/UsersPage').then(module => ({ default: module.AdminUsersPage })));
const AdminTicketsPage = lazy(() => import('./pages/TicketsPage').then(module => ({ default: module.AdminTicketsPage })));
const AdminInvoicesPage = lazy(() => import('./pages/InvoicesPage').then(module => ({ default: module.AdminInvoicesPage })));
const AdminApiCostOverviewPage = lazy(() => import('./pages/ApiCostOverviewPage').then(module => ({ default: module.AdminApiCostOverviewPage })));
const AdminApiUsagePage = lazy(() => import('./pages/ApiUsagePage').then(module => ({ default: module.AdminApiUsagePage })));
const AdminOfficialBillsPage = lazy(() => import('./pages/OfficialBillsPage').then(module => ({ default: module.AdminOfficialBillsPage })));
const AdminCreditsPage = lazy(() => import('./pages/CreditsPage').then(module => ({ default: module.AdminCreditsPage })));
const AdminJobsPage = lazy(() => import('./pages/JobsPage').then(module => ({ default: module.AdminJobsPage })));
const AdminAuditPage = lazy(() => import('./pages/AuditPage').then(module => ({ default: module.AdminAuditPage })));
const DesignSystem = lazy(() => import('../components/DesignSystem').then(module => ({ default: module.DesignSystem })));

const ADMIN_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getAdminFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(ADMIN_FOCUSABLE_SELECTOR))
    .filter(element => element.offsetWidth > 0 || element.offsetHeight > 0);
}

export function AdminLayout({
  routePath,
  onNavigate,
  onExit,
  plans,
  announcements,
  orders,
  users,
  tickets,
  invoiceRequests,
  overview,
  generationJobs,
  creditLedger,
  listControls,
  navigationSummary,
  realPortraitCapacity,
  realPortraitCapacityLoading,
  realPortraitCapacityError,
  orderSummary,
  auditLogs,
  consumptionSettings,
  featureFlags,
  paymentChannel,
  apiCostDashboard,
  apiCostOverview,
  apiCostUsers,
  apiCostTasks,
  apiCostAttempts,
  apiCostPagination,
  apiCostLoadState,
  onApiCostOverviewLoad,
  onApiCostTasksLoad,
  onApiCostOverviewRefresh,
  onApiCostOperatingCancel,
  onApiCostAuditLoad,
  onApiCostAuditCancel,
  onApiCostPageNavigate,
  onApiCostSync,
  onRefreshCurrentPage,
  onOrderDetailLoad,
  onJobDetailLoad,
  onOrderRefund,
  onOrderRefundSync,
  onAdminAssetLoad,
  onGenerationRetry,
  onGenerationRefund,
  onPlanSave,
  onAnnouncementCreate,
  onAnnouncementUpdate,
  onAnnouncementDelete,
  onFeatureFlagsChange,
  onPaymentChannelSave,
  onUserStatusChange,
  onUserSubscriptionChange,
  onUserCreditsAdjust,
  onInvoiceStatusChange,
  onTicketStatusChange,
  onTicketMessagesLoad,
  onTicketRead,
  onTicketReply,
  onConsumptionCreditsChange,
  onSeedance25AvailabilityChange,
  onTkPromptEngineSettingsChange,
}: AdminLayoutProps) {
  const [activeTab, setActiveTabState] = useState<AdminTab>(() => adminTabFromPath(routePath));
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() => (
    typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches
  ));
  const mobileNavRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);

  const setActiveTab = (tab: AdminTab) => {
    setActiveTabState(tab);
    setMobileNavOpen(false);
    onNavigate(tab === 'overview' ? '/admin' : `/admin/${tab}`);
    if (isMobileViewport) requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
  };

  useEffect(() => {
    setActiveTabState(adminTabFromPath(routePath));
  }, [routePath]);

  useEffect(() => {
    document.body.classList.add('admin-mode');
    return () => document.body.classList.remove('admin-mode');
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const syncViewport = () => setIsMobileViewport(!mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);
    return () => mediaQuery.removeEventListener('change', syncViewport);
  }, []);

  useLayoutEffect(() => {
    if (!mobileNavRef.current) return;
    mobileNavRef.current.inert = isMobileViewport && !mobileNavOpen;
  }, [isMobileViewport, mobileNavOpen]);

  useEffect(() => {
    if (!isMobileViewport || !mobileNavOpen || !mobileNavRef.current) return;
    const drawer = mobileNavRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = requestAnimationFrame(() => {
      const activeItem = drawer.querySelector<HTMLElement>('[aria-current="page"]');
      (activeItem ?? getAdminFocusableElements(drawer)[0] ?? drawer).focus();
    });

    const keepFocusInDrawer = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileNavOpen(false);
        requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getAdminFocusableElements(drawer);
      if (focusable.length === 0) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !drawer.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !drawer.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', keepFocusInDrawer);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keepFocusInDrawer);
    };
  }, [isMobileViewport, mobileNavOpen]);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const toastId = toast.loading('正在刷新后台数据...');
    try {
      if (activeTab === 'referrals') {
        const { queryClient } = await import('../api/queryClient');
        await queryClient.invalidateQueries({ predicate: query => query.queryKey.includes('referrals') });
      } else if (activeTab === 'api-usage') {
        if (routePath === '/admin/api-usage/bills') {
          const { refreshOfficialBills } = await import('./pages/officialBillsRefresh');
          await refreshOfficialBills();
        } else if (routePath === '/admin/api-usage/audit') await onApiCostAuditLoad();
        else if (new URLSearchParams(window.location.search).get('costType') === 'multimodal') {
          const { refreshMultimodalCost } = await import('./pages/multimodalCostRefresh');
          await refreshMultimodalCost();
        } else if (new URLSearchParams(window.location.search).get('costType') === 'image') {
          const { refreshImageCost } = await import('./pages/imageCostRefresh');
          await refreshImageCost();
        } else await onApiCostOverviewLoad();
      } else {
        await onRefreshCurrentPage();
      }
      toast.success('后台数据已刷新', { id: toastId });
    } catch (error) {
      if (isAbortError(error)) toast.dismiss(toastId);
      else toast.error(error instanceof Error ? error.message : '后台数据刷新失败', { id: toastId });
    } finally {
      setRefreshing(false);
    }
  };

  const renderPage = () => {
    switch (activeTab) {
      case 'referrals':
        return <AdminReferralsPage />;
      case 'overview':
        return <AdminOverviewPage summary={overview} plans={plans} setActiveTab={setActiveTab} setDetail={setDetail} />;
      case 'announcements':
        return <AdminAnnouncementsPage announcements={announcements} control={listControls.announcements} onCreate={onAnnouncementCreate} onUpdate={onAnnouncementUpdate} onDelete={onAnnouncementDelete} setDetail={setDetail} setConfirm={setConfirm} />;
      case 'plans':
        return <AdminPlansPage plans={plans} onPlanSave={onPlanSave} setDetail={setDetail} setConfirm={setConfirm} />;
      case 'real-portrait-capacity':
        return (
          <AdminRealPortraitCapacityPage
            capacity={realPortraitCapacity}
            loading={realPortraitCapacityLoading}
            error={realPortraitCapacityError}
          />
        );
      case 'consumption-settings':
        return <AdminConsumptionSettingsPage consumptionSettings={consumptionSettings} onConsumptionCreditsChange={onConsumptionCreditsChange} onSeedance25AvailabilityChange={onSeedance25AvailabilityChange} onTkPromptEngineSettingsChange={onTkPromptEngineSettingsChange} setDetail={setDetail} setConfirm={setConfirm} />;
      case 'feature-flags':
        return <AdminFeatureFlagsPage featureFlags={featureFlags} tkPromptEngine={consumptionSettings.tkPromptEngine} onFeatureFlagsChange={onFeatureFlagsChange} onTkPromptEngineSettingsChange={onTkPromptEngineSettingsChange} setConfirm={setConfirm} />;
      case 'payment-channel':
        return <AdminPaymentChannelPage channel={paymentChannel} onSave={onPaymentChannelSave} setConfirm={setConfirm} />;
      case 'orders':
        return <AdminOrdersPage orders={orders} control={listControls.orders} summary={orderSummary} onOrderDetailLoad={onOrderDetailLoad} onOrderRefund={onOrderRefund} onOrderRefundSync={onOrderRefundSync} setDetail={setDetail} setConfirm={setConfirm} />;
      case 'users':
        return <AdminUsersPage users={users} control={listControls.users} onOpenUserOrders={user => { listControls.orders.setFilters({ userId: user.id }); setActiveTab('orders'); }} onOpenUserCredits={user => { listControls.credits.setFilters({ userId: user.id }); setActiveTab('credits'); }} onUserStatusChange={onUserStatusChange} onUserSubscriptionChange={onUserSubscriptionChange} onUserCreditsAdjust={onUserCreditsAdjust} setDetail={setDetail} setConfirm={setConfirm} />;
      case 'tickets':
        return <AdminTicketsPage tickets={tickets} control={listControls.tickets} onTicketStatusChange={onTicketStatusChange} onTicketMessagesLoad={onTicketMessagesLoad} onTicketRead={onTicketRead} onTicketReply={onTicketReply} setDetail={setDetail} setConfirm={setConfirm} />;
      case 'invoices':
        return <AdminInvoicesPage invoiceRequests={invoiceRequests} control={listControls.invoices} onOrderDetailLoad={onOrderDetailLoad} onInvoiceStatusChange={onInvoiceStatusChange} setDetail={setDetail} setConfirm={setConfirm} />;
      case 'api-usage':
        return routePath === '/admin/api-usage/bills'
          ? <AdminOfficialBillsPage onNavigate={onNavigate} />
          : routePath === '/admin/api-usage/audit'
          ? <AdminApiUsagePage dashboard={apiCostDashboard} attempts={apiCostAttempts} pagination={apiCostPagination} onDetailsLoad={onApiCostAuditLoad} onCancel={onApiCostAuditCancel} onPageNavigate={onApiCostPageNavigate} onSync={onApiCostSync} onNavigate={onNavigate} setDetail={setDetail} />
          : <AdminApiCostOverviewPage overview={apiCostOverview} users={apiCostUsers} tasks={apiCostTasks} pagination={apiCostPagination} loadState={apiCostLoadState} onOverviewLoad={onApiCostOverviewLoad} onTasksLoad={onApiCostTasksLoad} onOverviewRefresh={onApiCostOverviewRefresh} onCancel={onApiCostOperatingCancel} onPageNavigate={onApiCostPageNavigate} onSync={onApiCostSync} onNavigate={onNavigate} setDetail={setDetail} />;
      case 'credits':
        return <AdminCreditsPage entries={creditLedger} control={listControls.credits} setDetail={setDetail} />;
      case 'jobs':
        return <AdminJobsPage jobs={generationJobs} control={listControls.jobs} onJobDetailLoad={onJobDetailLoad} onAdminAssetLoad={onAdminAssetLoad} onGenerationRetry={onGenerationRetry} onGenerationRefund={onGenerationRefund} setDetail={setDetail} setConfirm={setConfirm} />;
      case 'audit':
        return <AdminAuditPage logs={auditLogs} control={listControls.audit} setDetail={setDetail} />;
      case 'design-system':
        return <DesignSystem />;
      default:
        return null;
    }
  };

  return (
    <div data-ui="admin-layout" className="relative flex h-[100dvh] min-w-0 overflow-hidden">
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="关闭后台导航"
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-[2px] lg:hidden"
          onClick={() => {
            setMobileNavOpen(false);
            requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
          }}
        />
      )}
      <aside
        ref={mobileNavRef}
        id="admin-sidebar"
        role={isMobileViewport && mobileNavOpen ? 'dialog' : undefined}
        aria-modal={isMobileViewport && mobileNavOpen ? true : undefined}
        aria-hidden={isMobileViewport && !mobileNavOpen ? true : undefined}
        aria-label="后台导航"
        tabIndex={isMobileViewport && mobileNavOpen ? -1 : undefined}
        className={`fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[calc(100vw-24px)] max-w-[288px] flex-shrink-0 flex-col overflow-hidden border-r border-[var(--admin-border-subtle)] bg-[var(--admin-surface-sidebar)] p-3 shadow-[24px_0_70px_rgba(0,0,0,0.5)] transition-transform duration-[180ms] ease-out lg:static lg:z-auto lg:w-[248px] lg:translate-x-0 lg:shadow-none ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="mb-5 flex-shrink-0 px-1 pt-1">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <div className="relative flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-violet-300/20 bg-violet-500/15 text-violet-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <Lock className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-[-0.01em] text-[var(--admin-text-primary)]">管理后台</h1>
              <p className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-[var(--admin-text-muted)]">Operations</p>
            </div>
            <button
              type="button"
              aria-label="关闭后台导航"
              onClick={() => {
                setMobileNavOpen(false);
                requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
              }}
              className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-[var(--admin-text-secondary)] transition-[background-color,border-color,color] duration-[180ms] hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-white lg:hidden"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 scrollbar-gutter-stable">
          {ADMIN_NAV.map(item => {
            const Icon = item.icon;
            const active = item.id === activeTab;
            const badgeCount = getAdminNavBadgeCount(item.id, navigationSummary);
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                data-ui="admin-nav-item"
                data-state={active ? 'active' : 'inactive'}
                onClick={() => setActiveTab(item.id)}
                className={`group relative flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl border px-3 py-2.5 text-sm font-medium transition-[background-color,border-color,color] duration-[180ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--admin-surface-sidebar)] ${
                  active
                    ? 'border-white/10 bg-white/[0.055] text-[var(--admin-text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] before:absolute before:bottom-2.5 before:left-0 before:top-2.5 before:w-px before:rounded-full before:bg-violet-300 before:content-["_"]'
                    : 'border-transparent text-[var(--admin-text-secondary)] hover:border-white/[0.055] hover:bg-white/[0.03] hover:text-[var(--admin-text-primary)]'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                {badgeCount > 0 && <AdminNavBadge tab={item.id} count={badgeCount} active={active} />}
              </button>
            );
          })}
        </nav>

        <div className="mt-3 flex-shrink-0 border-t border-[var(--admin-border-subtle)] pt-3">
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            aria-busy={refreshing}
            className="mb-1 flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-sm font-medium text-[var(--admin-text-secondary)] transition-[background-color,border-color,color] duration-[180ms] hover:border-white/[0.055] hover:bg-white/[0.03] hover:text-white disabled:cursor-wait disabled:opacity-70"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-purple-300' : ''}`} />
            刷新数据
          </button>
          <button type="button" onClick={onExit} className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-sm font-medium text-[var(--admin-text-secondary)] transition-[background-color,border-color,color] duration-[180ms] hover:border-white/[0.055] hover:bg-white/[0.03] hover:text-white">
            <ArrowLeft className="w-4 h-4" />
            返回用户端
          </button>
        </div>
      </aside>

      <main data-ui="admin-main" className="relative min-w-0 flex-1 overflow-y-auto pt-14 lg:pt-0">
        <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center border-b border-[var(--admin-border-subtle)] bg-[rgba(7,8,11,0.92)] px-4 backdrop-blur-xl lg:hidden">
          <button
            ref={mobileMenuButtonRef}
            type="button"
            aria-label="打开后台导航"
            aria-expanded={mobileNavOpen}
            aria-controls="admin-sidebar"
            onClick={() => setMobileNavOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--admin-border-default)] bg-white/[0.04] text-[var(--admin-text-primary)]"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="ml-3 truncate text-sm font-semibold text-[var(--admin-text-primary)]">
            {ADMIN_NAV.find(item => item.id === activeTab)?.label ?? '管理后台'}
          </span>
        </div>
        <Suspense fallback={<AdminPageFallback />}>
          {renderPage()}
        </Suspense>
      </main>
      <DetailModal detail={detail} onClose={() => setDetail(null)} />
      <ConfirmModal confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function AdminPageFallback() {
  return <LoadingState variant="panel" />;
}

function getAdminNavBadgeCount(tab: AdminTab, summary: AdminLayoutProps['navigationSummary']) {
  if (!summary) return 0;
  if (tab === 'tickets') return summary.openTickets;
  if (tab === 'invoices') return summary.pendingInvoices;
  if (tab === 'jobs') return summary.activeJobs;
  if (tab === 'orders') return summary.manualReviewPayments + summary.manualReviewRefunds;
  return 0;
}

function adminTabFromPath(path: string): AdminTab {
  const segment = path.split('/')[2] as AdminTab | undefined;
  return ADMIN_NAV.some(item => item.id === segment) ? segment! : 'overview';
}

function AdminNavBadge({ tab, count, active }: { tab: AdminTab; count: number; active: boolean }) {
  const label = count > 99 ? '99+' : String(count);
  const toneClass = tab === 'invoices'
    ? active
      ? 'bg-orange-300 text-orange-950 shadow-orange-950/20'
      : 'bg-orange-500/25 text-orange-100 ring-1 ring-orange-400/40 shadow-orange-950/20'
    : active
      ? 'bg-pink-300 text-pink-950 shadow-pink-950/20'
      : 'bg-pink-500/25 text-pink-100 ring-1 ring-pink-400/40 shadow-pink-950/20';

  return (
    <span
      aria-hidden="true"
      data-testid={`admin-nav-badge-${tab}`}
      className={`ml-auto inline-flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none shadow-sm ${toneClass}`}
    >
      {label}
    </span>
  );
}
