import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureReferralCode, clearReferralCode } from './referrals';
function browser(url: string) {
  const values = new Map<string, string>();
  const location = new URL(url);
  const replaceState = vi.fn((_state, _title, path: string) => { const next = new URL(path, location); location.href = next.href; });
  vi.stubGlobal('window', { location, history: { state: null, replaceState }, sessionStorage: {
    setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => values.delete(key),
  } });
  return location;
}
afterEach(() => vi.unstubAllGlobals());
describe('注册邀请会话', () => {
  it('链接带码在登录/注册切换后保留，新链接替换旧码', () => {
    const location = browser('https://cn.example/register?ref=abcdefghijklmnop');
    expect(captureReferralCode()).toBe('abcdefghijklmnop');
    location.href = 'https://cn.example/login';
    expect(captureReferralCode()).toBe('abcdefghijklmnop');
    location.href = 'https://cn.example/register?ref=zyxwvutsrqponmlk';
    expect(captureReferralCode()).toBe('zyxwvutsrqponmlk');
  });
  it('登录、注册成功或主动取消会同时清理 URL 和会话', () => {
    browser('https://example/register?ref=abcdefghijklmnop&next=app'); captureReferralCode(); clearReferralCode();
    expect(captureReferralCode()).toBeNull();
    expect(window.location.search).toBe('?next=app');
  });
  it('空邀请码和超长链接保留为待校验状态，不静默取消', () => {
    const location = browser('https://example/register?ref=');
    expect(captureReferralCode()).toBe('invalid');
    location.search = '?ref=' + 'x'.repeat(200);
    expect(captureReferralCode()).toHaveLength(128);
  });
});
