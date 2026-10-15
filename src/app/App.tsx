import { ArrowLeft, Menu, ShieldAlert } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Toaster } from 'sonner';
import * as mutations from './api/mutations';
import * as queries from './api/queries';
import { getPortraitConsentToken, getRoutePageMetadata } from './state/routing';
import { useAppUpdate } from './state/useAppUpdate';
import { useAppController } from './state/useAppController';
import { Button, Card, LoadingState, WorkspaceTransition } from './ui';

const Sidebar = lazy(() => import('./components/Sidebar').then(module => ({ default: module.Sidebar })));
const Dashboard = lazy(() => import('./components/Dashboard').then(module => ({ default: module.Dashboard })));
const AIStudio = lazy(() => import('./components/AIStudioWorkspace').then(module => ({ default: module.AIStudioWorkspace })));
const DigitalAssets = lazy(() => import('./components/DigitalAssets').then(module => ({ default: module.DigitalAssets })));
const RealPortraitLibrary = lazy(() => import('./components/RealPortraitLibrary').then(module => ({ default: module.RealPortraitLibrary })));
const PortraitInviteConsentPage = lazy(() => import('./components/PortraitConsentPages').then(module => ({ default: module.PortraitInviteConsentPage })));
const PortraitAuthorizationPage = lazy(() => import('./components/PortraitConsentPages').then(module => ({ default: module.PortraitAuthorizationPage })));
const PortraitVerificationCompletePage = lazy(() => import('./components/PortraitConsentPages').then(module => ({ default: module.PortraitVerificationCompletePage })));
const TikTokPublish = lazy(() => import('./components/TikTokPublish').then(module => ({ default: module.TikTokPublish })));
const TikTokAccounts = lazy(() => import('./components/TikTokAccounts').then(module => ({ default: module.TikTokAccounts })));
const AccountCenter = lazy(() => import('./components/AccountCenter').then(module => ({ default: module.AccountCenter })));
const McpAuthorizationPage = lazy(() => import('./components/McpAuthorizationPage').then(module => ({ default: module.McpAuthorizationPage })));
const Subscription = lazy(() => import('./components/Subscription').then(module => ({ default: module.Subscription })));
const PaymentSuccessModal = lazy(() => import('./components/PaymentSuccessModal').then(module => ({ default: module.PaymentSuccessModal })));
const ContactSupportModal = lazy(() => import('./components/ContactSupportModal').then(module => ({ default: module.ContactSupportModal })));
const LandingPage = lazy(() => import('./components/LandingPage').then(module => ({ default: module.LandingPage })));
const LegalPage = lazy(() => import('./components/LegalPage').then(module => ({ default: module.LegalPage })));
const AuthPage = lazy(() => import('./components/AuthPage').then(module => ({ default: module.AuthPage })));
const ResetPasswordPage = lazy(() => import('./components/ResetPasswordPage').then(module => ({ default: module.ResetPasswordPage })));
const AdminLayout = lazy(() => import('./admin/AdminLayout').then(module => ({ default: module.AdminLayout })));

export default function App() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const closeMobileNavigation = useCallback((restoreFocus = false) => {
    setMobileNavOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
    }
  }, []);
  const app = useAppController();
  const {
    isAdminRoute,
    isAppRoute,
    isLandingRoute,
    isLoginRoute,
    isMcpAuthorizationRoute,
    isPolicyRoute,
    isPortraitAuthorizationRoute,
    isPortraitInviteRoute,
    isPortraitVerificationCompleteRoute,
    isRegisterRoute,
    isResetPasswordRoute,
    isTermsRoute,
    routePath,
    loading,
    activeTab,
    setActiveTab,
    account,
    updateAccount,
    changeAccountPassword,
    logoutAccount,
    logoutAllDevices,
    plans,
    announcements,
    adminAnnouncements,
    userOrders,
    userOrderPagination,
    userOrderPageLoading,
    navigateUserOrderPage,
    adminOrders,
    accountCenterSection,
    setAccountCenterSection,
    adminUsersState,
    tickets,
    userTickets,
    userTicketPagination,
    userTicketPageLoading,
    userTicketPageError,
    retryTicketPage,
    navigateTicketPage,
    ticketUnreadCount,
    adminInvoiceRequests,
    generationJobs,
    userGenerationJobs,
    videoGenerationJobs,
    imageGenerationJobs,
    generationPagination,
    generationPageLoading,
    navigateGenerationPage,
    videoGenerationPagination,
    videoGenerationPageLoading,
    navigateVideoGenerationPage,
    imageGenerationPagination,
    imageGenerationPageLoading,
    navigateImageGenerationPage,
    enableImageGenerationQueue,
    userCreditLedger,
    ledgerFilter,
    setLedgerFilter,
    ledgerPagination,
    ledgerPageLoading,
    navigateLedgerPage,
    adminCreditLedger,
    adminNavigationSummary,
    adminOrderSummary,
    adminRealPortraitCapacity,
    adminRealPortraitCapacityLoading,
    adminRealPortraitCapacityError,
    adminListControls,
    auditLogs,
    assetLibrary,
    assetSummary,
    assetPagination,
    assetPageLoading,
    assetPageError,
    retryAssetPage,
    assetFoldersLoading,
    assetFoldersError,
    retryAssetFolders,
    assetSummaryLoading,
    assetSummaryReady,
    assetSummaryError,
    retryAssetSummary,
    realPortraits,
    realPortraitsLoading,
    realPortraitsError,
    refreshRealPortraits,
    createRealPortraitActor,
    activateRealPortraitActor,
    revokeRealPortraitActor,
    deleteRealPortraitActor,
    saveRealPortraitQuotaSelection,
    uploadRealPortraitActorImage,
    deleteRealPortraitActorImage,
    setAssetFilters,
    navigateAssetPage,
    loadAssetDetail,
    assetFocusSource,
    reuseGenerationDraft,
    setReuseGenerationDraft,
    featureFlags,
    consumptionSettings,
    contactOpen,
    setContactOpen,
    canUseTikTokAccounts,
    canUseTikTokPublish,
    navigateToPath,
    openAccountCenter,
    loginAccount,
    requestRegisterCode,
    registerAccount,
    requestPasswordReset,
    resetPassword,
    reuseGeneratedAsset,
    createAssetFolder,
    renameAssetFolder,
    deleteAssetFolder,
    uploadAssetFile,
    updateAssetRecord,
    downloadAssetRecord,
    deleteAssetRecord,
    bulkMoveAssetRecords,
    bulkDeleteAssetRecords,
    createSupportTicket,
    getSupportTicketMessages,
    replySupportTicket,
    markSupportTicketRead,
    createInvoiceRequest,
    reserveGenerationCredits,
    prepareAssetLibrary,
    refreshConsumptionSettings,
    refreshPromptWizardCredits,
    loadGenerationJob,
    refreshCurrentAdminPage,
    loadAdminOrderDetail,
    loadAdminJobDetail,
    retryGenerationJob,
    manuallyRefundGenerationJob,
    refundOrder,
    syncOrderRefund,
    createPayment,
    cancelPaymentOrder,
    paymentMonitorStatus,
    startPaymentMonitor,
    stopPaymentMonitor,
    loadOrderHistory,
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
    loadAdminAsset,
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
    paymentSuccess,
    adminOverview,
    dashboardAggregate,
    dashboardAggregateStatus,
    refreshDashboardAggregate,
    presentPaymentSuccess,
    confirmPaymentSuccess,
  } = app;

  useEffect(() => {
    const metadata = getRoutePageMetadata(routePath);
    document.title = metadata.title;
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', metadata.description);
  }, [routePath]);

  const { updateAvailable, refreshToUpdate } = useAppUpdate(isAppRoute && !loading);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard announcements={announcements} generationJobs={userGenerationJobs} assets={assetLibrary.assets} authorizedTikTokCount={0} aggregate={dashboardAggregate} aggregateStatus={dashboardAggregateStatus} onStudioOpen={() => setActiveTab('ai-studio')} onAssetsOpen={() => setActiveTab('digital-assets')} onRetry={refreshDashboardAggregate} onAssetDetailLoad={loadAssetDetail} onAssetDownload={downloadAssetRecord} />;
      case 'ai-studio':
        return (
          <AIStudio
            assets={assetLibrary.assets}
            folders={assetLibrary.folders}
            assetSummary={assetSummary}
            assetPagination={assetPagination}
            assetPageLoading={assetPageLoading}
            assetPageError={assetPageError}
            videoGenerationJobs={videoGenerationJobs}
            videoGenerationPagination={videoGenerationPagination ?? generationPagination}
            videoGenerationPageLoading={videoGenerationPageLoading ?? generationPageLoading}
            imageGenerationJobs={imageGenerationJobs}
            imageGenerationPagination={imageGenerationPagination}
            imageGenerationPageLoading={imageGenerationPageLoading}
            reuseDraft={reuseGenerationDraft}
            onReuseDraftConsumed={() => setReuseGenerationDraft(null)}
            onGenerationReserve={reserveGenerationCredits}
            onAssetsPrepare={prepareAssetLibrary}
            onAssetFiltersChange={setAssetFilters}
            onAssetPageNavigate={navigateAssetPage}
            onAssetDetailLoad={loadAssetDetail}
            onGenerationJobDetailLoad={loadGenerationJob}
            onVideoGenerationPageNavigate={navigateVideoGenerationPage ?? navigateGenerationPage}
            onImageGenerationPageNavigate={navigateImageGenerationPage}
            onImageStudioVisited={enableImageGenerationQueue}
            onConsumptionSettingsRefresh={refreshConsumptionSettings}
            onCreditsRecharge={() => setActiveTab('subscription')}
            onUploadFile={uploadAssetFile}
            onAssetDownload={downloadAssetRecord}
            onAssetDelete={deleteAssetRecord}
            consumptionSettings={consumptionSettings}
            availableCredits={account.availableCredits}
            onPromptWizardCreditsChanged={refreshPromptWizardCredits}
            realPortraitActors={realPortraits?.items ?? []}
            realPortraitsLoading={realPortraitsLoading}
            onRealPortraitLibraryOpen={() => setActiveTab('real-portraits')}
          />
        );
      case 'digital-assets':
        return (
          <DigitalAssets
            library={assetLibrary}
            summary={assetSummary}
            pagination={assetPagination}
            pageLoading={assetPageLoading}
            pageError={assetPageError}
            foldersLoading={assetFoldersLoading}
            foldersError={assetFoldersError}
            summaryLoading={assetSummaryLoading}
            summaryReady={assetSummaryReady}
            summaryError={assetSummaryError}
            focusSource={assetFocusSource}
            onAIStudioOpen={() => setActiveTab('ai-studio')}
            onReuseGenerate={reuseGeneratedAsset}
            onFolderCreate={createAssetFolder}
            onFolderRename={renameAssetFolder}
            onFolderDelete={deleteAssetFolder}
            onUploadFile={uploadAssetFile}
            onAssetFiltersChange={setAssetFilters}
            onAssetPageNavigate={navigateAssetPage}
            onAssetPageRetry={retryAssetPage}
            onFoldersRetry={retryAssetFolders}
            onSummaryRetry={retryAssetSummary}
            onAssetDetailLoad={loadAssetDetail}
            onAssetUpdate={updateAssetRecord}
            onAssetDownload={downloadAssetRecord}
            onAssetDelete={deleteAssetRecord}
            onBulkMove={bulkMoveAssetRecords}
            onBulkDelete={bulkDeleteAssetRecords}
          />
        );
      case 'real-portraits':
        return (
          <RealPortraitLibrary
            data={realPortraits}
            loading={realPortraitsLoading}
            error={realPortraitsError}
            onRefresh={refreshRealPortraits}
            onCreate={createRealPortraitActor}
            onActivate={activateRealPortraitActor}
            onRevoke={revokeRealPortraitActor}
            onDelete={deleteRealPortraitActor}
            onUpload={uploadRealPortraitActorImage}
            onDeleteAsset={deleteRealPortraitActorImage}
            onQuotaSelection={saveRealPortraitQuotaSelection}
            onUpgrade={() => setActiveTab('subscription')}
          />
        );
      case 'tiktok-publish':
        return canUseTikTokPublish
          ? (
            <TikTokPublish
              assets={assetLibrary.assets}
              folders={assetLibrary.folders}
              assetSummary={assetSummary}
              assetPagination={assetPagination}
              assetPageLoading={assetPageLoading}
              assetPageError={assetPageError}
              onUploadFile={uploadAssetFile}
              onAssetsPrepare={prepareAssetLibrary}
              onAssetFiltersChange={setAssetFilters}
              onAssetPageNavigate={navigateAssetPage}
              onAssetPageRetry={retryAssetPage}
              onNavigate={setActiveTab}
            />
          )
          : <FeatureUpgradeNotice />;
      case 'tiktok-accounts':
        return canUseTikTokAccounts ? <TikTokAccounts /> : <FeatureUpgradeNotice />;
      case 'account-center':
        return <AccountCenter account={account} transactions={userCreditLedger} transactionFilter={ledgerFilter} transactionPagination={ledgerPagination} transactionLoading={ledgerPageLoading} onTransactionFilterChange={setLedgerFilter} onTransactionPageNavigate={navigateLedgerPage} activeSection={accountCenterSection} onSectionChange={setAccountCenterSection} onOrderHistoryLoad={loadOrderHistory} onGenerationJobDetailLoad={loadGenerationJob} onAccountChange={updateAccount} onPasswordChange={changeAccountPassword} onLogout={logoutAccount} onLogoutAllDevices={logoutAllDevices} onNavigate={setActiveTab} onAdminOpen={() => navigateToPath('/admin')} />;
      case 'subscription':
        return <Subscription plans={plans} currentPlanCode={account.hasActiveSubscription ? account.planCode : null} onOrderHistory={() => openAccountCenter('orders')} onCreatePayment={createPayment} paymentMonitorStatus={paymentMonitorStatus} onStartPaymentMonitor={startPaymentMonitor} onStopPaymentMonitor={stopPaymentMonitor} onCancelPaymentOrder={cancelPaymentOrder} onPaymentPaid={presentPaymentSuccess} />;
      default:
        return <Dashboard announcements={announcements} generationJobs={userGenerationJobs} assets={assetLibrary.assets} authorizedTikTokCount={0} aggregate={dashboardAggregate} aggregateStatus={dashboardAggregateStatus} onStudioOpen={() => setActiveTab('ai-studio')} onAssetsOpen={() => setActiveTab('digital-assets')} onRetry={refreshDashboardAggregate} onAssetDetailLoad={loadAssetDetail} onAssetDownload={downloadAssetRecord} />;
    }
  };

  return (
    <MotionConfig reducedMotion="user">
    <div
      className={isAppRoute
        ? 'product-shell min-h-[100dvh] overflow-hidden bg-[var(--product-canvas)] text-foreground'
        : isAdminRoute
          ? 'admin-shell dark min-h-[100dvh] overflow-hidden bg-[#06070a] text-foreground'
          : 'dark min-h-screen overflow-hidden bg-gradient-to-br from-[#0a0a0f] via-[#0f0f1e] to-[#1a0a2e] text-foreground'}
    >
      {isAppRoute ? null : isAdminRoute ? (
        <div data-ui="admin-ambient" aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -right-48 -top-64 h-[680px] w-[680px] rounded-full bg-violet-500/[0.035] blur-[180px]" />
        </div>
      ) : (
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[120px] animate-pulse"></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] animate-pulse delay-700"></div>
          <div className="absolute top-1/2 left-1/2 w-96 h-96 bg-pink-500/10 rounded-full blur-[120px] animate-pulse delay-1000"></div>
        </div>
      )}

      <Suspense fallback={<RouteLoading />}>
        {loading && (isAppRoute || isAdminRoute) ? (
          <RouteLoading />
        ) : isAdminRoute ? (
          account.role === 'admin' ? (
            <AdminLayout
              routePath={routePath}
              onNavigate={navigateToPath}
              plans={plans}
              announcements={adminAnnouncements}
              orders={adminOrders}
              users={adminUsersState}
              tickets={tickets}
              invoiceRequests={adminInvoiceRequests}
              generationJobs={generationJobs}
              creditLedger={adminCreditLedger}
              listControls={adminListControls}
              navigationSummary={adminNavigationSummary}
              orderSummary={adminOrderSummary}
              realPortraitCapacity={adminRealPortraitCapacity}
              realPortraitCapacityLoading={adminRealPortraitCapacityLoading}
              realPortraitCapacityError={adminRealPortraitCapacityError}
              overview={adminOverview}
              auditLogs={auditLogs}
              consumptionSettings={consumptionSettings}
              featureFlags={featureFlags}
              paymentChannel={paymentChannel}
              apiCostDashboard={apiCostDashboard}
              apiCostOverview={apiCostOverview}
              apiCostUsers={apiCostUsers}
              apiCostTasks={apiCostTasks}
              apiCostAttempts={apiCostAttempts}
              apiCostPagination={apiCostPagination}
              apiCostLoadState={apiCostLoadState}
              onApiCostOverviewLoad={loadApiCostOverview}
              onApiCostTasksLoad={loadApiCostTasks}
              onApiCostOverviewRefresh={refreshApiCostOverview}
              onApiCostOperatingCancel={cancelApiCostOperatingRequests}
              onApiCostAuditLoad={loadApiCostAudit}
              onApiCostAuditCancel={cancelApiCostAuditRequests}
              onApiCostPageNavigate={navigateApiCostPage}
              onApiCostSync={requestApiCostSync}
              onRefreshCurrentPage={refreshCurrentAdminPage}
              onOrderDetailLoad={loadAdminOrderDetail}
              onJobDetailLoad={loadAdminJobDetail}
              onOrderRefund={refundOrder}
              onOrderRefundSync={syncOrderRefund}
              onAdminAssetLoad={loadAdminAsset}
              onGenerationRetry={retryGenerationJob}
              onGenerationRefund={manuallyRefundGenerationJob}
              onPlanSave={saveAdminPlan}
              onAnnouncementCreate={createAdminAnnouncement}
              onAnnouncementUpdate={updateAdminAnnouncement}
              onAnnouncementDelete={deleteAdminAnnouncement}
              onFeatureFlagsChange={updateAdminFeatureFlags}
              onPaymentChannelSave={saveAdminPaymentChannel}
              onUserStatusChange={updateAdminUserStatus}
              onUserSubscriptionChange={updateAdminUserSubscription}
              onUserCreditsAdjust={adjustAdminUserCredits}
              onInvoiceStatusChange={updateAdminInvoiceStatus}
              onTicketStatusChange={updateAdminTicketStatus}
              onTicketMessagesLoad={getAdminTicketMessages}
              onTicketRead={markAdminTicketRead}
              onTicketReply={replyAdminTicket}
              onConsumptionCreditsChange={updateAdminConsumptionCredits}
              onSeedance25AvailabilityChange={updateAdminSeedance25ConsumptionAvailability}
              onTkPromptEngineSettingsChange={updateAdminTkPromptEngineSettings}
              onExit={() => navigateToPath('/app')}
            />
          ) : (
            <AdminForbiddenPage onApp={() => navigateToPath('/app')} />
          )
        ) : isMcpAuthorizationRoute ? (
          <McpAuthorizationPage onNavigate={navigateToPath} />
        ) : isLoginRoute || isRegisterRoute ? (
          <AuthPage
            mode={isRegisterRoute ? 'register' : 'login'}
            onLoginSuccess={loginAccount}
            onRegisterCodeRequest={requestRegisterCode}
            onRegisterSuccess={registerAccount}
            onForgotPassword={requestPasswordReset}
            onNavigate={navigateToPath}
          />
        ) : isResetPasswordRoute ? (
          <ResetPasswordPage onResetPassword={resetPassword} onNavigate={navigateToPath} />
        ) : isPortraitVerificationCompleteRoute ? (
          <PortraitVerificationCompletePage />
        ) : isPortraitInviteRoute ? (
          getPortraitConsentToken(routePath) ? (
            <PortraitInviteConsentPage
              token={getPortraitConsentToken(routePath)!}
              onLoad={queries.getPublicRealPortraitInvite}
              onRespond={mutations.respondToPublicRealPortraitInvite}
              onStartVerification={mutations.startPublicRealPortraitVerification}
              onReadStatus={queries.getPublicRealPortraitInviteStatus}
            />
          ) : <NotFoundPage onHome={() => navigateToPath('/')} />
        ) : isPortraitAuthorizationRoute ? (
          getPortraitConsentToken(routePath) ? (
            <PortraitAuthorizationPage
              manageToken={getPortraitConsentToken(routePath)!}
              onLoad={queries.getPublicRealPortraitAuthorization}
              onRevoke={mutations.revokePublicRealPortraitAuthorization}
            />
          ) : <NotFoundPage onHome={() => navigateToPath('/')} />
        ) : isAppRoute ? (
          <div key={account.email || 'anonymous'} className="relative flex h-[100dvh] min-w-0 overflow-hidden">
            {mobileNavOpen && (
              <button
                type="button"
                aria-label="关闭导航菜单"
                className="fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px] lg:hidden"
                onClick={() => closeMobileNavigation(true)}
              />
            )}
            <Sidebar
              activeTab={activeTab}
              onTabChange={setActiveTab}
              account={account}
              ticketUnreadCount={ticketUnreadCount}
              onContactOpen={() => setContactOpen(true)}
              onAccountOpen={() => openAccountCenter('overview')}
              onReferralsOpen={() => openAccountCenter('referrals')}
              referralsActive={activeTab === 'account-center' && accountCenterSection === 'referrals'}
              updateAvailable={updateAvailable}
              onUpdateRefresh={refreshToUpdate}
              mobileOpen={mobileNavOpen}
              onMobileClose={closeMobileNavigation}
            />
            <main className="relative min-w-0 flex-1 overflow-hidden bg-[var(--product-canvas)] pt-14 lg:pt-0">
              <div className="absolute inset-x-0 top-0 z-30 flex h-14 items-center border-b border-white/[0.08] bg-[var(--product-surface-base)] px-4 shadow-[0_12px_32px_rgba(0,0,0,0.22)] backdrop-blur-xl lg:hidden">
                <button
                  ref={mobileMenuButtonRef}
                  type="button"
                  aria-label="打开导航菜单"
                  aria-expanded={mobileNavOpen}
                  aria-controls="app-sidebar"
                  aria-haspopup="dialog"
                  onClick={() => setMobileNavOpen(true)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-[#f6f3ee] transition-colors duration-150 hover:border-white/15 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4b5fd] focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080c]"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <span className="ml-3 text-sm font-semibold tracking-tight text-[#f6f3ee]">Lindyson AI</span>
              </div>
              <WorkspaceTransition navigationKey={activeTab === 'account-center' ? `${activeTab}:${accountCenterSection}` : activeTab}>
                {renderContent()}
              </WorkspaceTransition>
              <ContactSupportModal
                open={contactOpen}
                onClose={() => setContactOpen(false)}
                account={account}
                tickets={userTickets}
                ticketPagination={userTicketPagination}
                ticketPageLoading={userTicketPageLoading}
                ticketPageError={userTicketPageError}
                onTicketPageRetry={retryTicketPage}
                orders={userOrders}
                orderPagination={userOrderPagination}
                orderPageLoading={userOrderPageLoading}
                onSupportTicketCreate={createSupportTicket}
                onTicketMessagesLoad={getSupportTicketMessages}
                onTicketReply={replySupportTicket}
                onTicketRead={markSupportTicketRead}
                onTicketPageNavigate={navigateTicketPage}
                onOrderPageNavigate={navigateUserOrderPage}
                onInvoiceRequestCreate={createInvoiceRequest}
              />
              {paymentSuccess && (
                <PaymentSuccessModal
                  order={paymentSuccess.order}
                  account={paymentSuccess.account}
                  onConfirm={confirmPaymentSuccess}
                />
              )}
            </main>
          </div>
        ) : isLandingRoute ? (
          <LandingPage plans={plans} onStart={() => navigateToPath('/login')} onLogin={() => navigateToPath('/login')} />
        ) : isTermsRoute || isPolicyRoute ? (
          <LegalPage documentType={isTermsRoute ? 'terms' : 'policy'} onHome={() => navigateToPath('/')} />
        ) : (
          <NotFoundPage onHome={() => navigateToPath('/')} />
        )}
      </Suspense>
      <Toaster className="lindyson-toaster" theme="dark" richColors position="top-center" />
    </div>
    </MotionConfig>
  );
}

function AdminForbiddenPage({ onApp }: { onApp: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-r from-purple-600 to-blue-600 shadow-lg shadow-purple-500/20">
          <ShieldAlert className="h-7 w-7 text-white" />
        </div>
        <p className="mt-6 text-sm font-semibold text-purple-200">无权限访问</p>
        <h1 className="mt-3 text-2xl font-bold text-white">仅管理员可访问管理后台</h1>
        <p className="mt-3 text-sm leading-6 text-gray-300">当前账号不是管理员，不能进入运营管理后台。</p>
        <Button className="mt-8 w-full" variant="primary" size="lg" icon={<ArrowLeft className="h-4 w-4" />} onClick={onApp}>
          返回工作台
        </Button>
      </Card>
    </main>
  );
}

function NotFoundPage({ onHome }: { onHome: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm p-8 text-center">
        <p className="text-lg font-bold text-white">Lindyson AI</p>
        <h1 className="mt-6 text-7xl font-black leading-none text-white">404</h1>
        <p className="mt-4 text-xl font-semibold text-white">页面错误</p>
        <Button className="mt-8 w-full" variant="pink" size="lg" onClick={onHome}>
          返回首页
        </Button>
      </Card>
    </main>
  );
}

function RouteLoading() {
  return <LoadingState variant="fullscreen" />;
}

function FeatureUpgradeNotice() {
  return (
    <div className="flex h-full min-h-[520px] items-center justify-center p-6">
      <Card className="w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-5 h-14 w-14 rounded-2xl bg-gradient-to-r from-purple-600 to-blue-600 shadow-lg shadow-purple-500/20" />
        <h1 className="text-2xl font-bold text-white">功能升级中</h1>
        <p className="mt-3 text-sm leading-6 text-gray-300">此功能正在升级优化，请您耐心等待。</p>
      </Card>
    </div>
  );
}
