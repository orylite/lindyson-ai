import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureAttribution, clearAttribution, detectVisitAttribution } from './attribution';

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
    expect(store.size).toBe(0);
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
