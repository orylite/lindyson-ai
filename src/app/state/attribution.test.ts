import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureAttribution, clearAttribution, detectVisitAttribution, ensureVisitorId, reportVisit } from './attribution';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-16T08:00:00.000Z');

function browser(url: string, referrer = '', store = new Map<string, string>()) {
  const location = new URL(url);
  vi.stubGlobal('window', {
    location,
    localStorage: {
      setItem: (key: string, value: string) => store.set(key, value),
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => store.delete(key),
    },
  });
  vi.stubGlobal('document', { referrer });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe('注册来源采集', () => {
  it('读取 utm 参数并记录落地路径', () => {
    browser('https://lindyson.com/?utm_source=xiaohongshu&utm_medium=post&utm_campaign=launch-2610&ref=ABCDEFGH');
    expect(captureAttribution(NOW)).toEqual({
      source: 'xiaohongshu',
      medium: 'post',
      campaign: 'launch-2610',
      landingPath: '/',
      firstTouchAt: '2026-10-16T08:00:00.000Z',
      visitorId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('短参数 from 原样上送，由服务端归类', () => {
    browser('https://lindyson.com/pricing?from=xhs');
    expect(detectVisitAttribution(NOW)).toMatchObject({ source: 'xhs', landingPath: '/pricing' });
  });

  it('没有参数时按外部来源站点归类，并忽略本站跳转', () => {
    browser('https://lindyson.com/login', 'https://mp.weixin.qq.com/s/abc?token=secret');
    expect(detectVisitAttribution(NOW)).toEqual({
      source: 'wechat',
      referrerHost: 'mp.weixin.qq.com',
      landingPath: '/login',
      firstTouchAt: '2026-10-16T08:00:00.000Z',
    });
    browser('https://lindyson.com/login', 'https://lindyson.com/');
    expect(detectVisitAttribution(NOW)).toBeNull();
  });

  it('未知来源站点归为 other，但保留站点域名', () => {
    browser('https://lindyson.com/', 'https://news.example.org/post/1');
    expect(detectVisitAttribution(NOW)).toMatchObject({ source: 'other', referrerHost: 'news.example.org' });
  });

  it('直接访问记为 direct，之后的推广链接可以覆盖它', () => {
    const store = browser('https://lindyson.com/');
    expect(captureAttribution(NOW)).toMatchObject({ source: 'direct' });
    browser('https://lindyson.com/?utm_source=douyin', '', store);
    expect(captureAttribution(NOW + DAY)).toMatchObject({ source: 'douyin' });
  });

  it('first-touch：30 天内已有来源不被新链接覆盖，过期后才替换', () => {
    const store = browser('https://lindyson.com/?utm_source=xiaohongshu');
    captureAttribution(NOW);
    browser('https://lindyson.com/login?utm_source=zhihu', '', store);
    expect(captureAttribution(NOW + 10 * DAY)).toMatchObject({ source: 'xiaohongshu' });
    expect(captureAttribution(NOW + 31 * DAY)).toMatchObject({ source: 'zhihu' });
  });

  it('首页记录的来源在整页跳转到登录页后仍可读取，注册成功后清除', () => {
    const store = browser('https://lindyson.com/?utm_source=bilibili&utm_campaign=review');
    captureAttribution(NOW);
    browser('https://lindyson.com/login', 'https://lindyson.com/', store);
    expect(captureAttribution(NOW + 1000)).toMatchObject({ source: 'bilibili', campaign: 'review', landingPath: '/' });
    clearAttribution();
    // 注册成功只清除首次来源；匿名访客编号保留，之后的回访仍按同一访客统计。
    expect(store.has('lindyson:acquisition')).toBe(false);
    expect(store.has('lindyson:visitor')).toBe(true);
  });

  it('超长参数会被截断，存储损坏时回退为直接访问', () => {
    const store = browser(`https://lindyson.com/?utm_source=${'x'.repeat(100)}&utm_campaign=${'y'.repeat(200)}`);
    const result = captureAttribution(NOW);
    expect(result?.source).toHaveLength(64);
    expect(result?.campaign).toHaveLength(128);
    store.set('lindyson:acquisition', '{broken');
    browser('https://lindyson.com/', '', store);
    expect(captureAttribution(NOW)).toMatchObject({ source: 'direct' });
  });
});

describe('访客来源上报', () => {
  function stubBeacon() {
    const sendBeacon = vi.fn((_url: string, _body: Blob) => true);
    vi.stubGlobal('navigator', { sendBeacon, webdriver: false });
    return sendBeacon;
  }

  async function payload(sendBeacon: ReturnType<typeof stubBeacon>, index = 0) {
    const [url, blob] = sendBeacon.mock.calls[index]!;
    return { url, body: JSON.parse(await blob.text()) };
  }

  it('新访客带推广参数到站：上报一次，标记为新访客并带站点域名', async () => {
    browser('https://www.lindyson.com/?utm_source=douyin&utm_campaign=c1');
    const sendBeacon = stubBeacon();
    expect(reportVisit(NOW)).toBe(true);
    const { url, body } = await payload(sendBeacon);
    expect(url).toBe('/api/public/visits');
    expect(body).toMatchObject({
      isNewVisitor: true,
      site: 'www.lindyson.com',
      attribution: { source: 'douyin', campaign: 'c1', landingPath: '/' },
    });
    expect(body.visitorId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('同一天同一来源刷新不重复上报；换来源或跨天再上报', () => {
    const store = browser('https://lindyson.com/?utm_source=douyin');
    const sendBeacon = stubBeacon();
    expect(reportVisit(NOW)).toBe(true);
    expect(reportVisit(NOW + 60_000)).toBe(false);
    browser('https://lindyson.com/', 'https://www.zhihu.com/question/1', store);
    expect(reportVisit(NOW + 120_000)).toBe(true);
    browser('https://lindyson.com/?utm_source=douyin', '', store);
    expect(reportVisit(NOW + DAY)).toBe(true);
    expect(sendBeacon).toHaveBeenCalledTimes(3);
  });

  it('站内跳转不上报；无任何信号的外部到站记为直接访问', async () => {
    const store = browser('https://lindyson.com/login', 'https://lindyson.com/');
    const sendBeacon = stubBeacon();
    expect(reportVisit(NOW)).toBe(false);
    browser('https://lindyson.com/', '', store);
    expect(reportVisit(NOW)).toBe(true);
    expect((await payload(sendBeacon)).body.attribution.source).toBe('direct');
  });

  it('首页跳登录页带同样的推广参数时被当日去重', () => {
    const store = browser('https://lindyson.com/?utm_source=bilibili');
    const sendBeacon = stubBeacon();
    reportVisit(NOW);
    browser('https://lindyson.com/login?utm_source=bilibili', 'https://lindyson.com/', store);
    expect(reportVisit(NOW + 5_000)).toBe(false);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('邀约链接没有推广参数时归为邀约', async () => {
    browser('https://lindyson.com/register?ref=ABCDEFGH', 'https://mp.weixin.qq.com/s/x');
    const sendBeacon = stubBeacon();
    reportVisit(NOW);
    expect((await payload(sendBeacon)).body.attribution).toMatchObject({ source: 'referral', referrerHost: 'mp.weixin.qq.com' });
  });

  it('自动化浏览器不上报', () => {
    browser('https://lindyson.com/?utm_source=douyin');
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon, webdriver: true });
    expect(reportVisit(NOW)).toBe(false);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('sendBeacon 不可用时回退到 keepalive fetch', () => {
    browser('https://lindyson.com/');
    vi.stubGlobal('navigator', { webdriver: false });
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(reportVisit(NOW)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/public/visits', expect.objectContaining({ method: 'POST', keepalive: true, credentials: 'omit' }));
  });

  it('访客编号在 30 天内保持不变并顺延，过期后换新编号', () => {
    const store = browser('https://lindyson.com/');
    const first = ensureVisitorId(NOW).id;
    expect(ensureVisitorId(NOW + 20 * DAY).id).toBe(first);
    expect(ensureVisitorId(NOW + 45 * DAY).id).toBe(first);
    expect(ensureVisitorId(NOW + 80 * DAY).id).not.toBe(first);
    expect(store.has('lindyson:visitor')).toBe(true);
  });

  it('注册归因带上同一个访客编号', () => {
    browser('https://lindyson.com/?utm_source=zhihu');
    stubBeacon();
    const visitorId = ensureVisitorId(NOW).id;
    expect(captureAttribution(NOW)).toMatchObject({ source: 'zhihu', visitorId });
  });
});
