const REFERRAL_SESSION_KEY = 'lindyson:registration-referral';
export function captureReferralCode(): string | null {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  const incoming = query.get('ref');
  if (incoming !== null) {
    // 保留无效链接以明确提示，不把有问题的邀请静默变成普通注册。
    const code = incoming.trim().slice(0, 128) || 'invalid';
    try { window.sessionStorage.setItem(REFERRAL_SESSION_KEY, code); } catch { /* 会话存储不可用时仍使用当前链接 */ }
    return code;
  }
  try { return window.sessionStorage.getItem(REFERRAL_SESSION_KEY); } catch { return null; }
}
export function clearReferralCode() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(REFERRAL_SESSION_KEY); } catch { /* 存储可能被浏览器禁用 */ }
  const url = new URL(window.location.href);
  if (url.searchParams.has('ref')) {
    url.searchParams.delete('ref');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }
}
