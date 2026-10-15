import { useCallback,useEffect,useRef } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../api/client';
import { clearPrivateQueryCache } from '../api/queryClient';
import * as queries from '../api/queries';
import { isPaymentAttemptDefinitivelyFailed,paymentFailureMessage } from '../data/paymentState';
import { claimBootstrapStart } from './bootstrapGate';
import { getCurrentPath,getRouteFlags } from './routing';
import { useAccount } from './useAccount';
import { useAdminData } from './useAdminData';
import { useAssets } from './useAssets';
import { useBilling } from './useBilling';
import { useGeneration } from './useGeneration';
import { useRealPortraits } from './useRealPortraits';
import { useSession } from './useSession';

/**
 * 兼容 App 现有消费接口的薄聚合层。
 * 领域状态和操作分别由六个 hook 管理，这里只协调登录引导、跨域刷新和统一清理。
 */
export function useAppController() {
  const session = useSession();
  const bootstrapStartedRef = useRef(false);

  const accountDomain = useAccount({
    accountRef: session.accountRef,
    accountEmail: session.account.email,
    setAccount: session.setAccount,
    routePath: session.routePath,
    setActiveTab: session.setActiveTab,
    refreshFeatureFlags: session.refreshFeatureFlags,
    sessionEpoch: session.sessionEpoch,
  });

  const assets = useAssets({
    setActiveTab: session.setActiveTab,
    activeTab: session.activeTab,
    accountEmail: session.account.email,
    sessionEpoch: session.sessionEpoch,
  });

  const realPortraits = useRealPortraits({
    activeTab: session.activeTab,
    accountEmail: session.account.email,
    sessionEpoch: session.sessionEpoch,
  });

  const billing = useBilling({
    accountRef: session.accountRef,
    refreshAccount: accountDomain.refreshAccount,
    openAccountCenter: accountDomain.openAccountCenter,
    activeTab: session.activeTab,
    accountEmail: session.account.email,
    accountCenterSection: accountDomain.accountCenterSection,
    contactOpen: accountDomain.contactOpen,
    sessionEpoch: session.sessionEpoch,
  });

  const generation = useGeneration({
    refreshAccount: accountDomain.refreshAccount,
    invalidateUserCreditLedger: billing.invalidateUserCreditLedger,
    activeTab: session.activeTab,
    accountEmail: session.account.email,
    sessionEpoch: session.sessionEpoch,
  });

  const admin = useAdminData({
    routePath: session.routePath,
    accountEmail: session.account.email,
    accountRole: session.account.role,
    sessionEpoch: session.sessionEpoch,
    plans: session.plans,
    setPlans: session.setPlans,
    setAnnouncements: session.setAnnouncements,
    setFeatureFlags: session.setFeatureFlags,
    setConsumptionSettings: generation.setConsumptionSettings,
  });
  const clearPrivateState = useCallback(() => {
    void clearPrivateQueryCache();
    session.clearSessionState();
    accountDomain.clearAccountState();
    assets.clearAssetsState();
    realPortraits.clearRealPortraitState();
    billing.clearBillingState();
    generation.clearGenerationState();
    admin.clearAdminState();
  }, [accountDomain.clearAccountState, admin.clearAdminState, assets.clearAssetsState, billing.clearBillingState, generation.clearGenerationState, realPortraits.clearRealPortraitState, session.clearSessionState]);

  const bootstrap = useCallback(async () => {
    session.setLoading(true);
    const routeFlags = getRouteFlags(getCurrentPath());
    const isStaticPublicRoute = routeFlags.isTermsRoute
      || routeFlags.isPolicyRoute
      || routeFlags.isPortraitVerificationCompleteRoute;
    try {
      const publicData = isStaticPublicRoute
        ? Promise.resolve()
        : session.loadPublicData().catch(error => {
            if (!isAbortError(error)) toast.warning('公开配置暂时加载失败，可稍后重试');
          });
      if (isStaticPublicRoute || (!routeFlags.isAppRoute && !routeFlags.isAdminRoute)) {
        await publicData;
        return;
      }

      const currentAccount = await queries.getMe();
      session.setAccount(currentAccount);
      void publicData;
      const searchParams = new URLSearchParams(window.location.search);
      const paymentOrderId = searchParams.get('order');
      if (searchParams.get('payment') === 'return' && paymentOrderId) {
        try {
          const returnedOrder = await billing.syncPaymentOrder(paymentOrderId);
          if (returnedOrder.status === 'paid') await billing.presentPaymentSuccess(returnedOrder);
          else if (returnedOrder.status === 'refunded') toast.info('该订单已退款');
          else if (returnedOrder.paymentAttemptStatus === 'manual-review') {
            toast.warning(paymentFailureMessage(returnedOrder));
          } else if (isPaymentAttemptDefinitivelyFailed(returnedOrder)) {
            toast.error(paymentFailureMessage(returnedOrder));
          } else if (returnedOrder.paymentAttemptStatus === 'uncertain') {
            toast.warning('支付结果暂时无法确认，系统会继续查询；请勿重复付款');
          } else {
            toast.info('支付尚未完成，请在历史订单中查看最新状态');
          }
        } catch {
          toast.info('支付状态暂未确认，请稍后在历史订单中查看');
        } finally {
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
      // 身份确认后立即交付工作台；各页面只加载当前路由需要的一页数据。
      session.setLoading(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearPrivateState();
        toast.error('登录状态已失效');
      } else if (!isAbortError(error)) {
        toast.error(error instanceof Error ? error.message : '服务器暂时不可用，请稍后重试');
      }
    } finally {
      session.setLoading(false);
    }
  }, [billing.presentPaymentSuccess, billing.syncPaymentOrder, clearPrivateState, session.loadPublicData, session.setAccount, session.setLoading]);

  useEffect(() => {
    if (!claimBootstrapStart(bootstrapStartedRef)) return;
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const synchronizeAuthenticatedSession = async () => {
      clearPrivateState();
      session.setLoading(true);
      try {
        const currentAccount = await queries.getMe();
        session.setAccount(currentAccount);
        session.navigateToPath('/app');
        session.setLoading(false);
        toast.info('检测到账号已切换，工作台数据已刷新');
      } catch (error) {
        if (!isAbortError(error)) session.navigateToPath('/login');
      } finally {
        session.setLoading(false);
      }
    };
    const handleSessionChange = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      if (reason === 'authenticated') {
        void synchronizeAuthenticatedSession();
        return;
      }
      clearPrivateState();
      session.navigateToPath('/login');
    };
    window.addEventListener('lindyson:session-change', handleSessionChange);
    return () => window.removeEventListener('lindyson:session-change', handleSessionChange);
  }, [clearPrivateState, session.navigateToPath, session.setAccount, session.setLoading]);

  useEffect(() => {
    const flags = getRouteFlags(session.routePath);
    if (!session.loading && !session.accountRef.current.email && (flags.isAppRoute || flags.isAdminRoute)) {
      session.navigateToPath('/login');
    }
  }, [session.account.email, session.accountRef, session.loading, session.navigateToPath, session.routePath]);

  const enterApp = useCallback(() => {
    accountDomain.setAccountCenterSection('overview');
    const interaction = new URLSearchParams(window.location.search).get('mcp_interaction');
    if (interaction && /^[A-Za-z0-9_-]{1,256}$/.test(interaction)) {
      session.navigateToPath(`/mcp/authorize?interaction=${encodeURIComponent(interaction)}`);
    } else {
      session.enterApp();
    }
  }, [accountDomain.setAccountCenterSection, session.enterApp, session.navigateToPath]);

  const loginAccount = useCallback(async (payload: { email: string; password: string }) => {
    clearPrivateState();
    await session.loginSession(payload);
    enterApp();
  }, [clearPrivateState, enterApp, session.loginSession]);

  const registerAccount = useCallback(async (payload: Parameters<typeof session.registerSession>[0]) => {
    clearPrivateState();
    await session.registerSession(payload);
    enterApp();
  }, [clearPrivateState, enterApp, session.registerSession]);

  return {
    routePath: session.routePath,
    ...getRouteFlags(session.routePath),
    loading: session.loading,
    activeTab: session.activeTab,
    setActiveTab: session.setActiveTab,
    account: session.account,
    updateAccount: accountDomain.updateAccount,
    changeAccountPassword: accountDomain.changeAccountPassword,
    logoutAccount: session.logoutAccount,
    logoutAllDevices: session.logoutAllDevices,
    plans: session.plans,
    setPlans: session.setPlans,
    announcements: session.announcements,
    adminAnnouncements: admin.adminAnnouncements,
    setAnnouncements: session.setAnnouncements,
    userOrders: billing.userOrders,
    userOrderPagination: billing.userOrderPagination,
    userOrderPageLoading: billing.userOrderPageLoading,
    navigateUserOrderPage: billing.navigateUserOrderPage,
    adminOrders: admin.adminOrders,
    accountCenterSection: accountDomain.accountCenterSection,
    setAccountCenterSection: accountDomain.setAccountCenterSection,
    adminUsersState: admin.adminUsersState,
    setSyncedAdminUsers: admin.setSyncedAdminUsers,
    tickets: admin.tickets,
    setTickets: admin.setTickets,
    userTickets: accountDomain.userTickets,
    setUserTickets: accountDomain.setUserTickets,
    userTicketPagination: accountDomain.userTicketPagination,
    userTicketPageLoading: accountDomain.userTicketPageLoading,
    userTicketPageError: accountDomain.userTicketPageError,
    retryTicketPage: accountDomain.retryTicketPage,
    navigateTicketPage: accountDomain.navigateTicketPage,
    ticketUnreadCount: accountDomain.ticketUnreadCount,
    adminInvoiceRequests: admin.adminInvoiceRequests,
    generationJobs: admin.generationJobs,
    setGenerationJobs: admin.setGenerationJobs,
    userGenerationJobs: generation.userGenerationJobs,
    videoGenerationJobs: generation.videoGenerationJobs,
    imageGenerationJobs: generation.imageGenerationJobs,
    generationPagination: generation.generationPagination,
    generationPageLoading: generation.generationPageLoading,
    navigateGenerationPage: generation.navigateGenerationPage,
    videoGenerationPagination: generation.videoGenerationPagination,
    videoGenerationPageLoading: generation.videoGenerationPageLoading,
    navigateVideoGenerationPage: generation.navigateVideoGenerationPage,
    imageGenerationPagination: generation.imageGenerationPagination,
    imageGenerationPageLoading: generation.imageGenerationPageLoading,
    navigateImageGenerationPage: generation.navigateImageGenerationPage,
    enableImageGenerationQueue: generation.enableImageGenerationQueue,
    userCreditLedger: billing.userCreditLedger,
    ledgerFilter: billing.ledgerFilter,
    setLedgerFilter: billing.setLedgerFilter,
    ledgerPagination: billing.ledgerPagination,
    ledgerPageLoading: billing.ledgerPageLoading,
    navigateLedgerPage: billing.navigateLedgerPage,
    adminCreditLedger: admin.adminCreditLedger,
    adminNavigationSummary: admin.adminNavigationSummary,
    adminOrderSummary: admin.adminOrderSummary,
    adminRealPortraitCapacity: admin.adminRealPortraitCapacity,
    adminRealPortraitCapacityLoading: admin.adminRealPortraitCapacityLoading,
    adminRealPortraitCapacityError: admin.adminRealPortraitCapacityError,
    adminListControls: admin.adminListControls,
    auditLogs: admin.auditLogs,
    setAuditLogs: admin.setAuditLogs,
    assetLibrary: assets.assetLibrary,
    assetSummary: assets.assetSummary,
    assetPagination: assets.assetPagination,
    assetPageLoading: assets.assetPageLoading,
    assetPageError: assets.assetPageError,
    retryAssetPage: assets.retryAssetPage,
    assetFoldersLoading: assets.assetFoldersLoading,
    assetFoldersError: assets.assetFoldersError,
    retryAssetFolders: assets.retryAssetFolders,
    assetSummaryLoading: assets.assetSummaryLoading,
    assetSummaryReady: assets.assetSummaryReady,
    assetSummaryError: assets.assetSummaryError,
    retryAssetSummary: assets.retryAssetSummary,
    setAssetFilters: assets.setAssetFilters,
    navigateAssetPage: assets.navigateAssetPage,
    loadAssetDetail: assets.loadAssetDetail,
    realPortraits: realPortraits.realPortraits,
    realPortraitsLoading: realPortraits.realPortraitsLoading,
    realPortraitsError: realPortraits.realPortraitsError,
    refreshRealPortraits: realPortraits.refreshRealPortraits,
    createRealPortraitActor: realPortraits.createRealPortraitActor,
    activateRealPortraitActor: realPortraits.activateRealPortraitActor,
    revokeRealPortraitActor: realPortraits.revokeRealPortraitActor,
    deleteRealPortraitActor: realPortraits.deleteRealPortraitActor,
    saveRealPortraitQuotaSelection: realPortraits.saveRealPortraitQuotaSelection,
    uploadRealPortraitActorImage: realPortraits.uploadRealPortraitActorImage,
    deleteRealPortraitActorImage: realPortraits.deleteRealPortraitActorImage,
    assetFocusSource: assets.assetFocusSource,
    reuseGenerationDraft: assets.reuseGenerationDraft,
    setReuseGenerationDraft: assets.setReuseGenerationDraft,
    featureFlags: session.featureFlags,
    setFeatureFlags: session.setFeatureFlags,
    consumptionSettings: generation.consumptionSettings,
    setConsumptionSettings: generation.setConsumptionSettings,
    contactOpen: accountDomain.contactOpen,
    setContactOpen: accountDomain.setContactOpen,
    canUseTikTokAccounts: session.canUseTikTokAccounts,
    canUseTikTokPublish: session.canUseTikTokPublish,
    apiCostDashboard: admin.apiCostDashboard,
    apiCostOverview: admin.apiCostOverview,
    apiCostUsers: admin.apiCostUsers,
    apiCostTasks: admin.apiCostTasks,
    apiCostAttempts: admin.apiCostAttempts,
    apiCostPagination: admin.apiCostPagination,
    apiCostLoadState: admin.apiCostLoadState,
    loadApiCostOverview: admin.loadApiCostOverview,
    loadApiCostTasks: admin.loadApiCostTasks,
    refreshApiCostOverview: admin.refreshApiCostOverview,
    cancelApiCostOperatingRequests: admin.cancelApiCostOperatingRequests,
    loadApiCostAudit: admin.loadApiCostAudit,
    cancelApiCostAuditRequests: admin.cancelApiCostAuditRequests,
    navigateApiCostPage: admin.navigateApiCostPage,
    requestApiCostSync: admin.requestApiCostSync,
    paymentChannel: admin.paymentChannel,
    paymentSuccess: billing.paymentSuccess,
    adminOverview: admin.adminOverview,
    dashboardAggregate: accountDomain.dashboardAggregate,
    dashboardAggregateStatus: accountDomain.dashboardAggregateStatus,
    refreshDashboardAggregate: accountDomain.refreshDashboardAggregate,
    navigateToPath: session.navigateToPath,
    enterApp,
    openAccountCenter: accountDomain.openAccountCenter,
    presentPaymentSuccess: billing.presentPaymentSuccess,
    confirmPaymentSuccess: billing.confirmPaymentSuccess,
    loginAccount,
    requestRegisterCode: session.requestRegisterCode,
    registerAccount,
    requestPasswordReset: session.requestPasswordReset,
    resetPassword: session.resetPassword,
    reuseGeneratedAsset: assets.reuseGeneratedAsset,
    createAssetFolder: assets.createAssetFolder,
    renameAssetFolder: assets.renameAssetFolder,
    deleteAssetFolder: assets.deleteAssetFolder,
    uploadAssetFile: assets.uploadAssetFile,
    updateAssetRecord: assets.updateAssetRecord,
    downloadAssetRecord: assets.downloadAssetRecord,
    deleteAssetRecord: assets.deleteAssetRecord,
    bulkMoveAssetRecords: assets.bulkMoveAssetRecords,
    bulkDeleteAssetRecords: assets.bulkDeleteAssetRecords,
    createSupportTicket: accountDomain.createSupportTicket,
    getSupportTicketMessages: accountDomain.getSupportTicketMessages,
    replySupportTicket: accountDomain.replySupportTicket,
    markSupportTicketRead: accountDomain.markSupportTicketRead,
    createInvoiceRequest: billing.createInvoiceRequest,
    reserveGenerationCredits: generation.reserveGenerationCredits,
    prepareAssetLibrary: assets.prepareAssetLibrary,
    refreshConsumptionSettings: generation.refreshConsumptionSettings,
    refreshPromptWizardCredits: generation.refreshPromptWizardCredits,
    loadGenerationJob: generation.loadGenerationJob,
    refreshCurrentAdminPage: admin.refreshCurrentAdminPage,
    loadAdminOrderDetail: admin.loadAdminOrderDetail,
    loadAdminJobDetail: admin.loadAdminJobDetail,
    retryGenerationJob: admin.retryGenerationJob,
    manuallyRefundGenerationJob: admin.manuallyRefundGenerationJob,
    refundOrder: admin.refundOrder,
    syncOrderRefund: admin.syncOrderRefund,
    createPayment: billing.createPayment,
    cancelPaymentOrder: billing.cancelPaymentOrder,
    paymentMonitorStatus: billing.paymentMonitorStatus,
    startPaymentMonitor: billing.startPaymentMonitor,
    stopPaymentMonitor: billing.stopPaymentMonitor,
    loadOrderHistory: billing.loadOrderHistory,
    saveAdminPaymentChannel: admin.saveAdminPaymentChannel,
    saveAdminPlan: admin.saveAdminPlan,
    createAdminAnnouncement: admin.createAdminAnnouncement,
    updateAdminAnnouncement: admin.updateAdminAnnouncement,
    deleteAdminAnnouncement: admin.deleteAdminAnnouncement,
    updateAdminFeatureFlags: admin.updateAdminFeatureFlags,
    updateAdminUserStatus: admin.updateAdminUserStatus,
    updateAdminUserSubscription: admin.updateAdminUserSubscription,
    adjustAdminUserCredits: admin.adjustAdminUserCredits,
    updateAdminInvoiceStatus: admin.updateAdminInvoiceStatus,
    updateAdminTicketStatus: admin.updateAdminTicketStatus,
    getAdminTicketMessages: admin.getAdminTicketMessages,
    markAdminTicketRead: admin.markAdminTicketRead,
    replyAdminTicket: admin.replyAdminTicket,
    updateAdminConsumptionCredits: admin.updateAdminConsumptionCredits,
    updateAdminSeedance25ConsumptionAvailability: admin.updateAdminSeedance25ConsumptionAvailability,
    updateAdminTkPromptEngineSettings: admin.updateAdminTkPromptEngineSettings,
    loadAdminAsset: admin.loadAdminAsset,
  };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
