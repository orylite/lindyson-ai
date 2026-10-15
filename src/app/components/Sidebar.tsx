import {
  CreditCard,
  Gift,
  Headphones,
  Image,
  LayoutDashboard,
  RefreshCw,
  ScanFace,
  Send,
  Sparkles,
  Users,
  Video,
  Zap,
} from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type AccountProfile } from '../data/account';
import { getSafePercent } from '../utils/progress';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  account: AccountProfile;
  ticketUnreadCount: number;
  onContactOpen: () => void;
  onAccountOpen: () => void;
  onReferralsOpen: () => void;
  referralsActive: boolean;
  updateAvailable: boolean;
  onUpdateRefresh: () => void;
  mobileOpen?: boolean;
  onMobileClose?: (restoreFocus?: boolean) => void;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => element.offsetWidth > 0 || element.offsetHeight > 0);
}

export function Sidebar({
  activeTab,
  onTabChange,
  account,
  ticketUnreadCount,
  onContactOpen,
  onAccountOpen,
  onReferralsOpen,
  referralsActive,
  updateAvailable,
  onUpdateRefresh,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(() => (
    typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches
  ));
  const availablePercent = getSafePercent(account.availableCredits, account.totalCredits);
  const menuItems = [
    { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
    { id: 'ai-studio', label: 'AI Studio', icon: Video },
    { id: 'digital-assets', label: '数字资产', icon: Image },
    { id: 'real-portraits', label: '真人演员库', icon: ScanFace },
    { id: 'tiktok-accounts', label: '管理 TikTok 账号', icon: Users },
    { id: 'tiktok-publish', label: '发布至 TikTok', icon: Send },
  ];

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const syncViewport = () => setIsMobileViewport(!mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);
    return () => mediaQuery.removeEventListener('change', syncViewport);
  }, []);

  useLayoutEffect(() => {
    if (!drawerRef.current) return;
    drawerRef.current.inert = isMobileViewport && !mobileOpen;
  }, [isMobileViewport, mobileOpen]);

  useEffect(() => {
    if (!isMobileViewport || !mobileOpen || !drawerRef.current) return;
    const drawer = drawerRef.current;
    const focusFrame = requestAnimationFrame(() => {
      const activeNavigationItem = drawer.querySelector<HTMLElement>('[aria-current="page"]');
      (activeNavigationItem ?? getFocusableElements(drawer)[0] ?? drawer).focus();
    });

    const keepFocusInDrawer = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onMobileClose?.(true);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements(drawer);
      if (focusableElements.length === 0) {
        event.preventDefault();
        drawer.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === firstElement || !drawer.contains(activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && (activeElement === lastElement || !drawer.contains(activeElement))) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', keepFocusInDrawer);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', keepFocusInDrawer);
    };
  }, [isMobileViewport, mobileOpen, onMobileClose]);

  const navigationItemClass = (isActive: boolean) => `
    group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border px-3 py-2.5 text-left
    transition-[background-color,border-color,color,transform] duration-[180ms]
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4b5fd] focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080c]
    ${isActive
      ? 'product-sidebar-active border-white/10 bg-white/[0.065] text-[var(--product-text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]'
      : 'border-transparent text-[var(--product-text-secondary)] hover:border-white/[0.06] hover:bg-white/[0.035] hover:text-[var(--product-text-primary)]'}
  `;

  return (
    <aside
      ref={drawerRef}
      id="app-sidebar"
      data-ui="product-sidebar"
      role={isMobileViewport && mobileOpen ? 'dialog' : undefined}
      aria-modal={isMobileViewport && mobileOpen ? true : undefined}
      aria-hidden={isMobileViewport && !mobileOpen ? true : undefined}
      aria-label="工作台导航"
      tabIndex={isMobileViewport && mobileOpen ? -1 : undefined}
      className={`fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[calc(100vw-24px)] max-w-[288px] flex-col overflow-hidden border-r border-white/[0.08] bg-[#08080c] p-3 shadow-[24px_0_70px_rgba(0,0,0,0.48)] transition-transform duration-[180ms] ease-out lg:static lg:z-auto lg:w-[248px] lg:flex-none lg:translate-x-0 lg:shadow-none ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <div className="mb-5 px-1 pt-1">
        <button
          type="button"
          aria-label="返回仪表盘"
          onClick={() => {
            onTabChange('dashboard');
            onMobileClose?.();
          }}
          className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-[180ms] hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4b5fd] focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080c]"
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-violet-300/20 bg-violet-500/15 text-violet-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors duration-[180ms] group-hover:border-violet-300/30 group-hover:bg-violet-500/20">
            <Sparkles className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-[-0.01em] text-[var(--product-text-primary)]">Lindyson AI</span>
            <span className="mt-0.5 block text-[11px] tracking-wide text-[var(--product-text-muted)]">PRO STUDIO</span>
          </span>
        </button>
      </div>

      <nav aria-label="主要功能" className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <Fragment key={item.id}>
              {(item.id === 'ai-studio' || item.id === 'tiktok-accounts') && <p className="px-3 pb-1 pt-4 text-xs font-medium text-[var(--product-text-muted)]">{item.id === 'ai-studio' ? '创作与素材' : '账号与发布'}</p>}
            <button
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                onTabChange(item.id);
                onMobileClose?.();
              }}
              className={navigationItemClass(isActive)}
            >
              {isActive && (
                <span aria-hidden="true" className="absolute inset-y-2 left-0 w-px rounded-full bg-violet-200" />
              )}
              <Icon className={`h-[18px] w-[18px] flex-none transition-colors duration-[180ms] ${isActive ? 'text-violet-200' : 'text-[var(--product-text-muted)] group-hover:text-[var(--product-text-secondary)]'}`} />
              <span className="truncate text-sm font-medium">{item.label}</span>
            </button>
            </Fragment>
          );
        })}

        {updateAvailable && (
          <div className="mt-3 rounded-xl border border-violet-300/15 bg-violet-500/[0.07] p-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-violet-300/15 bg-violet-500/10 text-violet-200">
                <RefreshCw className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--product-text-primary)]">Lindyson AI 已更新</p>
                <p className="mt-0.5 text-[11px] leading-4 text-[var(--product-text-muted)]">刷新以使用最新功能</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onUpdateRefresh}
              className="mt-2.5 w-full rounded-lg border border-white/[0.08] bg-white/[0.045] px-2.5 py-1.5 text-xs font-semibold text-violet-100 transition-colors duration-[180ms] hover:border-white/[0.13] hover:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4b5fd]"
            >
              立即刷新
            </button>
          </div>
        )}
      </nav>

      <div className="mt-3 flex-none space-y-1 border-t border-white/[0.08] pt-3">
        <button
          type="button"
          aria-current={activeTab === 'subscription' ? 'page' : undefined}
          onClick={() => {
            onTabChange('subscription');
            onMobileClose?.();
          }}
          className={navigationItemClass(activeTab === 'subscription')}
        >
          {activeTab === 'subscription' && (
            <span aria-hidden="true" className="absolute inset-y-2 left-0 w-px rounded-full bg-violet-200" />
          )}
          <CreditCard className={`h-[18px] w-[18px] flex-none ${activeTab === 'subscription' ? 'text-violet-200' : 'text-[var(--product-text-muted)] group-hover:text-[var(--product-text-secondary)]'}`} />
          <span className="text-sm font-medium">订阅套餐</span>
        </button>

        <button
          type="button"
          aria-current={referralsActive ? 'page' : undefined}
          onClick={() => {
            onReferralsOpen();
            onMobileClose?.();
          }}
          className={navigationItemClass(referralsActive)}
        >
          {referralsActive && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-px rounded-full bg-violet-200" />}
          <Gift className={`h-[18px] w-[18px] flex-none ${referralsActive ? 'text-violet-200' : 'text-[var(--product-text-muted)] group-hover:text-[var(--product-text-secondary)]'}`} />
          <span className="text-sm font-medium">邀约奖励</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onContactOpen();
            onMobileClose?.();
          }}
          className={navigationItemClass(false)}
        >
          <Headphones className="h-[18px] w-[18px] flex-none text-[var(--product-text-muted)] transition-colors duration-[180ms] group-hover:text-[var(--product-text-secondary)]" />
          <span className="text-sm font-medium">联系客服</span>
          {ticketUnreadCount > 0 && (
            <span className="ml-auto min-w-5 rounded-full bg-fuchsia-500/80 px-1.5 py-0.5 text-center text-[10px] font-bold leading-4 text-white">
              {ticketUnreadCount > 99 ? '99+' : ticketUnreadCount}
            </span>
          )}
        </button>

        <button
          type="button"
          aria-current={activeTab === 'account-center' && !referralsActive ? 'page' : undefined}
          onClick={() => {
            onAccountOpen();
            onMobileClose?.();
          }}
          className={`group mt-2 w-full rounded-2xl border px-3 py-3 text-left transition-[background-color,border-color,transform] duration-[180ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4b5fd] focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080c] ${
            activeTab === 'account-center' && !referralsActive
              ? 'product-sidebar-active border-violet-300/20 bg-violet-500/[0.08]'
              : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.13] hover:bg-white/[0.05]'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-xl border border-violet-300/15 bg-violet-500/10 text-violet-200">
              <Zap className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[var(--product-text-primary)]">{account.userName}</span>
              <span className="mt-0.5 block text-[11px] text-[var(--product-text-muted)]">{account.planName}</span>
            </span>
          </span>

          <span className="mt-3 block">
            <span className="block text-[10px] font-medium tracking-wide text-[var(--product-text-muted)]">当前积分</span>
            <span className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span className="text-lg font-semibold tabular-nums leading-tight text-[var(--product-text-primary)]">{account.availableCredits.toLocaleString()}</span>
              <span className="text-xs font-medium tabular-nums leading-tight text-[var(--product-text-muted)]">/ {account.totalCredits.toLocaleString()}</span>
            </span>
            <span className="mt-2 block h-1 overflow-hidden rounded-full bg-white/[0.08]">
              <span
                className="block h-full rounded-full bg-[var(--product-accent-violet)]"
                style={{ width: `${availablePercent}%` }}
              />
            </span>
          </span>

          <span className="mt-3 grid grid-cols-2 border-y border-white/[0.07] py-2 text-[10px]">
            <span className="min-w-0 border-r border-white/[0.07] pr-2">
              <span className="block text-[var(--product-text-muted)]">积分重置</span>
              <span className="mt-0.5 block truncate text-[var(--product-text-secondary)]">{account.resetDate}</span>
            </span>
            <span className="min-w-0 pl-2">
              <span className="block text-[var(--product-text-muted)]">到期日期</span>
              <span className="mt-0.5 block truncate text-[var(--product-text-secondary)]">{account.expiresAt}</span>
            </span>
          </span>

          <span className="mt-2.5 flex items-center justify-between text-[11px]">
            <span className="text-[var(--product-text-muted)]">账户中心</span>
            <span className="text-violet-200 transition-colors duration-[180ms] group-hover:text-violet-100">查看详情</span>
          </span>
        </button>
      </div>
    </aside>
  );
}
