import {
  NOT_FOUND_PAGE_METADATA,
  ROUTE_PAGE_METADATA,
  type PageMetadata,
} from '../data/capabilities';

export function normalizePath(path: string) {
  return path !== '/' && path.endsWith('/') ? path.slice(0, -1) : path;
}

export function getCurrentPath() {
  if (typeof window === 'undefined') return '/';
  return normalizePath(window.location.pathname || '/');
}

export const APP_TABS = [
  'dashboard',
  'ai-studio',
  'digital-assets',
  'real-portraits',
  'tiktok-accounts',
  'tiktok-publish',
  'subscription',
  'account-center',
] as const;

export type AppTab = typeof APP_TABS[number];

const PORTRAIT_INVITE_ROUTE = /^\/portrait-consent\/invite$/;
const PORTRAIT_AUTHORIZATION_ROUTE = /^\/portrait-consent\/authorization$/;
const PORTRAIT_VERIFICATION_COMPLETE_ROUTE = /^\/portrait-consent\/verification-complete$/;

export const ADMIN_TABS = [
  'referrals',
  'overview',
  'announcements',
  'plans',
  'real-portrait-capacity',
  'consumption-settings',
  'feature-flags',
  'payment-channel',
  'orders',
  'users',
  'tickets',
  'invoices',
  'api-usage',
  'credits',
  'jobs',
  'audit',
  'design-system',
] as const;

function isExactSectionPath(path: string, root: 'app' | 'admin', sections: readonly string[]) {
  const normalized = normalizePath(path);
  if (normalized === `/${root}`) return true;
  const segments = normalized.split('/').filter(Boolean);
  return segments.length === 2 && segments[0] === root && sections.includes(segments[1] ?? '');
}

export function isKnownAppPath(path: string) {
  return isExactSectionPath(path, 'app', APP_TABS);
}

export function isKnownAdminPath(path: string) {
  const normalized = normalizePath(path);
  return normalized === '/admin/api-usage/audit'
    || normalized === '/admin/api-usage/bills'
    || isExactSectionPath(normalized, 'admin', ADMIN_TABS);
}

export function getAppTabFromPath(path: string): AppTab {
  const segment = normalizePath(path).split('/')[2];
  return APP_TABS.includes(segment as AppTab) ? segment as AppTab : 'dashboard';
}

export function getAppPathForTab(tab: string) {
  return tab === 'dashboard' ? '/app' : `/app/${tab}`;
}

export function getRouteFlags(routePath: string) {
  const normalized = normalizePath(routePath);
  return {
    isAdminRoute: isKnownAdminPath(normalized),
    isAppRoute: isKnownAppPath(normalized),
    isLandingRoute: normalized === '/',
    isLoginRoute: normalized === '/login',
    isMcpAuthorizationRoute: normalized === '/mcp/authorize',
    isPolicyRoute: normalized === '/policy',
    isPortraitAuthorizationRoute: PORTRAIT_AUTHORIZATION_ROUTE.test(normalized),
    isPortraitInviteRoute: PORTRAIT_INVITE_ROUTE.test(normalized),
    isPortraitVerificationCompleteRoute: PORTRAIT_VERIFICATION_COMPLETE_ROUTE.test(normalized),
    isRegisterRoute: normalized === '/register',
    isResetPasswordRoute: normalized === '/reset-password',
    isTermsRoute: normalized === '/terms',
  };
}

export function isKnownTopLevelPath(routePath: string) {
  return (
    routePath === '/'
    || routePath === '/login'
    || routePath === '/register'
    || routePath === '/reset-password'
    || routePath === '/mcp/authorize'
    || routePath === '/terms'
    || routePath === '/policy'
    || PORTRAIT_INVITE_ROUTE.test(normalizePath(routePath))
    || PORTRAIT_AUTHORIZATION_ROUTE.test(normalizePath(routePath))
    || PORTRAIT_VERIFICATION_COMPLETE_ROUTE.test(normalizePath(routePath))
    || isKnownAppPath(routePath)
    || isKnownAdminPath(routePath)
  );
}

export function getRoutePageMetadata(path: string): PageMetadata {
  const normalized = normalizePath(path);
  return ROUTE_PAGE_METADATA[normalized as keyof typeof ROUTE_PAGE_METADATA] ?? NOT_FOUND_PAGE_METADATA;
}

export function getPortraitConsentToken(
  path: string,
  hash = typeof window === 'undefined' ? '' : window.location.hash,
) {
  const normalized = normalizePath(path);
  if (!PORTRAIT_INVITE_ROUTE.test(normalized) && !PORTRAIT_AUTHORIZATION_ROUTE.test(normalized)) return null;
  const token = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('token')?.trim();
  return token || null;
}
