import { useCallback,useEffect,useRef,useState } from 'react';
import { clearApiSession,getSessionEpoch } from '../api/client';
import { privateQueryKey,queryClient } from '../api/queryClient';
import * as mutations from '../api/mutations';
import * as queries from '../api/queries';
import type { AccountProfile } from '../data/account';
import type { AdminPlan,PlatformAnnouncement } from '../data/admin';
import { initialFeatureFlags,type FeatureFlags } from '../data/featureFlags';
import type { RegisterPayload } from './auth';
import { getAppPathForTab,getAppTabFromPath,getCurrentPath,getRouteFlags } from './routing';

export const EMPTY_ACCOUNT: AccountProfile = {
  userName: '',
  email: '',
  role: 'user',
  planCode: 'free',
  planName: '免费版',
  portraitEntitlements: { enabled: true, profileLimit: 1, activeLimit: 1, assetsPerActor: 1 },
  hasActiveSubscription: false,
  billingCycle: 'monthly',
  mainCredits: 0,
  addonCredits: 0,
  availableCredits: 0,
  totalCredits: 0,
  resetDate: '-',
  expiresAt: '-',
};

/** 管理路由、公开配置和 cookie 会话生命周期。 */
export function useSession() {
  const sessionEpoch = getSessionEpoch();
  const [routePath, setRoutePath] = useState(getCurrentPath);
  const [activeTab, setActiveTabState] = useState(() => getAppTabFromPath(getCurrentPath()));
  const [account, setAccount] = useState<AccountProfile>(() => EMPTY_ACCOUNT);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [announcements, setAnnouncements] = useState<PlatformAnnouncement[]>([]);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>(() => initialFeatureFlags);
  const [loading, setLoading] = useState(true);
  const accountRef = useRef(account);

  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  useEffect(() => {
    const handlePopState = () => setRoutePath(getCurrentPath());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (getRouteFlags(routePath).isAppRoute) setActiveTabState(getAppTabFromPath(routePath));
  }, [routePath]);

  const setAccountState = useCallback((nextAccount: AccountProfile) => {
    accountRef.current = nextAccount;
    setAccount(nextAccount);
    if (nextAccount.email) {
      queryClient.setQueryData(privateQueryKey(getSessionEpoch(), 'account', 'me'), nextAccount);
    }
  }, []);

  const navigateToPath = useCallback((path: string) => {
    const target = new URL(path, window.location.origin);
    const nextPath = target.pathname !== '/' && target.pathname.endsWith('/')
      ? target.pathname.slice(0, -1)
      : target.pathname;
    const nextHref = `${nextPath}${target.search}${target.hash}`;
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentHref !== nextHref) window.history.pushState({}, '', nextHref);
    setRoutePath(nextPath);
  }, []);

  const setActiveTab = useCallback((tab: string) => {
    const nextPath = getAppPathForTab(tab);
    setActiveTabState(getAppTabFromPath(nextPath));
    if (getRouteFlags(getCurrentPath()).isAppRoute) navigateToPath(nextPath);
  }, [navigateToPath]);

  const enterApp = useCallback(() => {
    setActiveTabState('dashboard');
    navigateToPath('/app');
  }, [navigateToPath]);

  const loadPublicData = useCallback(async () => {
    const [plansResult, announcementsResult] = await Promise.allSettled([
      queries.getPublicPlans(),
      queries.getAnnouncements(),
    ]);
    if (plansResult.status === 'fulfilled') setPlans(plansResult.value);
    if (announcementsResult.status === 'fulfilled') setAnnouncements(announcementsResult.value);
    const failures = [plansResult, announcementsResult].filter(result => result.status === 'rejected');
    if (failures.length > 0) {
      throw new Error(failures.length === 2 ? '套餐与公告加载失败' : '部分公开配置加载失败');
    }
  }, []);

  const refreshFeatureFlags = useCallback(async () => {
    const nextFeatureFlags = await queries.getAccountFeatureFlags();
    setFeatureFlags(nextFeatureFlags);
    return nextFeatureFlags;
  }, []);

  const loginSession = useCallback(async (payload: { email: string; password: string }) => {
    const nextAccount = await mutations.login(payload.email, payload.password);
    setAccountState(nextAccount);
    return nextAccount;
  }, [setAccountState]);

  const registerSession = useCallback(async (payload: RegisterPayload & { password: string; verificationId: string; verificationCode: string }) => {
    const nextAccount = await mutations.register(payload);
    setAccountState(nextAccount);
    return nextAccount;
  }, [setAccountState]);

  const requestRegisterCode = useCallback((payload: RegisterPayload) => mutations.requestRegisterCode({
    userName: payload.userName,
    email: payload.email,
  }), []);

  const requestPasswordReset = useCallback(async (email: string) => {
    await mutations.requestPasswordReset(email);
  }, []);

  const resetPassword = useCallback(async (payload: { token: string; password: string }) => {
    await mutations.resetPassword(payload);
  }, []);

  const logoutAccount = useCallback(() => {
    clearApiSession('logout');
    void mutations.logout().catch(() => undefined);
  }, []);

  // 先向服务端递增 auth_version（需要当前会话），再清本地状态；失败则退回普通退出。
  const logoutAllDevices = useCallback(async () => {
    try {
      await mutations.logoutAllDevices();
    } finally {
      clearApiSession('logout');
    }
  }, []);

  const clearSessionState = useCallback(() => {
    setAccountState(EMPTY_ACCOUNT);
    setFeatureFlags(initialFeatureFlags);
    setActiveTabState('dashboard');
  }, [setAccountState]);

  const isAdminUser = account.role === 'admin';

  return {
    routePath,
    sessionEpoch,
    setRoutePath,
    activeTab,
    setActiveTab,
    account,
    accountRef,
    setAccount: setAccountState,
    plans,
    setPlans,
    announcements,
    setAnnouncements,
    featureFlags,
    setFeatureFlags,
    loading,
    setLoading,
    navigateToPath,
    enterApp,
    loadPublicData,
    refreshFeatureFlags,
    loginSession,
    registerSession,
    requestRegisterCode,
    requestPasswordReset,
    resetPassword,
    logoutAccount,
    logoutAllDevices,
    clearSessionState,
    canUseTikTokAccounts: isAdminUser || featureFlags.tiktokAccounts,
    canUseTikTokPublish: isAdminUser || featureFlags.tiktokPublish,
  };
}
