import { describe,expect,it } from 'vitest';
import {
  ADMIN_TABS,
  APP_TABS,
  getAppPathForTab,
  getAppTabFromPath,
  getPortraitConsentToken,
  getRouteFlags,
  getRoutePageMetadata,
  isKnownTopLevelPath,
  normalizePath,
} from './routing';

describe('路径路由规则', () => {
  it('去掉非根路径末尾斜杠', () => {
    expect(normalizePath('/app/')).toBe('/app');
    expect(normalizePath('/')).toBe('/');
  });

  it('识别用户端和后台子路径', () => {
    expect(getRouteFlags('/app/digital-assets').isAppRoute).toBe(true);
    expect(getRouteFlags('/admin/orders').isAdminRoute).toBe(true);
    expect(getRouteFlags('/admin/api-usage/audit').isAdminRoute).toBe(true);
    expect(getRouteFlags('/admin/api-usage/audit/').isAdminRoute).toBe(true);
    expect(getRouteFlags('/admin/api-usage/bills').isAdminRoute).toBe(true);
    expect(getRouteFlags('/admin/api-usage/bills/').isAdminRoute).toBe(true);
    expect(getRouteFlags('/admin/api-usage/unknown').isAdminRoute).toBe(false);
  });

  it('用户端深链与活动页签双向映射', () => {
    expect(getAppTabFromPath('/app/ai-studio')).toBe('ai-studio');
    expect(getAppTabFromPath('/app/unknown')).toBe('dashboard');
    expect(getAppPathForTab('dashboard')).toBe('/app');
    expect(getAppPathForTab('digital-assets')).toBe('/app/digital-assets');
  });

  it('识别公开法律页面', () => {
    expect(getRouteFlags('/terms').isTermsRoute).toBe(true);
    expect(getRouteFlags('/policy').isPolicyRoute).toBe(true);
    expect(isKnownTopLevelPath('/terms')).toBe(true);
    expect(isKnownTopLevelPath('/policy')).toBe(true);
  });

  it('只识别固定结构的真人授权公开页面且安全解析 token', () => {
    const invitePath = '/portrait-consent/invite';
    const managePath = '/portrait-consent/authorization';
    const verificationCompletePath = '/portrait-consent/verification-complete';
    expect(getRouteFlags(invitePath).isPortraitInviteRoute).toBe(true);
    expect(getRouteFlags(managePath).isPortraitAuthorizationRoute).toBe(true);
    expect(getRouteFlags(verificationCompletePath).isPortraitVerificationCompleteRoute).toBe(true);
    expect(isKnownTopLevelPath(invitePath)).toBe(true);
    expect(isKnownTopLevelPath(verificationCompletePath)).toBe(true);
    expect(isKnownTopLevelPath(`${invitePath}/extra`)).toBe(false);
    expect(getPortraitConsentToken(invitePath, '#token=invite-token_123')).toBe('invite-token_123');
    expect(getRoutePageMetadata(invitePath).title).toBe('真人肖像授权 · Lindyson AI');
    expect(getRoutePageMetadata(verificationCompletePath).title).toBe('真人认证结果 · Lindyson AI');
    expect(getPortraitConsentToken('/portrait-consent/invite', '#token=%E6%BC%94%E5%91%98-token')).toBe('演员-token');
    expect(getPortraitConsentToken('/portrait-consent/authorization', '#token=manage-token_456')).toBe('manage-token_456');
    expect(getPortraitConsentToken('/portrait-consent/invite', '')).toBeNull();
    expect(getPortraitConsentToken('/portrait-consent/unknown', '#token=hidden')).toBeNull();
    expect(isKnownTopLevelPath('/portrait-consent/invite/invite-token_123')).toBe(false);
  });

  it('未知路径（包括未知 app/admin 子路径）进入 404', () => {
    expect(isKnownTopLevelPath('/unknown')).toBe(false);
    expect(isKnownTopLevelPath('/app/unknown')).toBe(false);
    expect(isKnownTopLevelPath('/admin/unknown')).toBe(false);
    expect(getRouteFlags('/app/unknown').isAppRoute).toBe(false);
    expect(getRouteFlags('/admin/unknown').isAdminRoute).toBe(false);
  });

  it('为全部公开、用户端和后台路由提供标题与描述', () => {
    for (const path of ['/', '/login', '/register', '/reset-password', '/terms', '/policy']) {
      const metadata = getRoutePageMetadata(path);
      expect(metadata.title.length).toBeGreaterThan(0);
      expect(metadata.description.length).toBeGreaterThan(0);
    }

    for (const tab of APP_TABS) {
      const metadata = getRoutePageMetadata(getAppPathForTab(tab));
      expect(metadata.title).toMatch(/· Lindyson AI$/);
      expect(metadata.description.length).toBeGreaterThan(0);
    }

    for (const tab of ADMIN_TABS) {
      const path = tab === 'overview' ? '/admin' : `/admin/${tab}`;
      const metadata = getRoutePageMetadata(path);
      expect(metadata.title).toMatch(/· Lindyson Admin$/);
      expect(metadata.description.length).toBeGreaterThan(0);
    }

    expect(getRoutePageMetadata('/admin/api-usage/audit')).toMatchObject({
      title: '高级成本对账 · Lindyson Admin',
    });
    expect(getRoutePageMetadata('/admin/api-usage/bills')).toMatchObject({
      title: '官方账单 · Lindyson Admin',
    });
  });

  it('规范化路径并为未知地址返回明确的 404 metadata', () => {
    expect(getRoutePageMetadata('/app/digital-assets/')).toEqual(getRoutePageMetadata('/app/digital-assets'));
    expect(getRoutePageMetadata('/app/not-a-page')).toEqual({
      title: '页面不存在 · Lindyson AI',
      description: '当前地址不存在或已经失效，请返回 Lindyson AI 首页。',
    });
  });
});
