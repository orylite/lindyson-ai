import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ poolQuery: vi.fn() }));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: vi.fn(),
}));

import { isLikelyBotUserAgent, normalizeVisitSite, runVisitorVisitRetentionSweep } from '../src/domain/visitorVisits.js';
import { registerPublicRoutes } from '../src/routes/publicRoutes.js';

const VISITOR_ID = '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b';
const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function makeApp() {
  const app = fastify();
  app.register(registerPublicRoutes);
  return app;
}

describe('访客来源识别', () => {
  it('识别爬虫、脚本与空 UA', () => {
    expect(isLikelyBotUserAgent(BROWSER_UA)).toBe(false);
    expect(isLikelyBotUserAgent('Mozilla/5.0 (compatible; Baiduspider/2.0)')).toBe(true);
    expect(isLikelyBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isLikelyBotUserAgent('Mozilla/5.0 HeadlessChrome/120.0')).toBe(true);
    expect(isLikelyBotUserAgent('curl/8.4.0')).toBe(true);
    expect(isLikelyBotUserAgent('')).toBe(true);
    expect(isLikelyBotUserAgent(undefined)).toBe(true);
  });

  it('站点只区分两个正式域名', () => {
    expect(normalizeVisitSite('www.lindyson.com')).toBe('lindyson.com');
    expect(normalizeVisitSite('LINDYSON.CN')).toBe('lindyson.cn');
    expect(normalizeVisitSite('localhost')).toBe('other');
  });
});

describe('POST /api/public/visits', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.poolQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('按白名单归类后入库，同一访客同一天同一来源依赖唯一约束去重', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/public/visits',
        headers: { 'user-agent': BROWSER_UA },
        payload: {
          visitorId: VISITOR_ID,
          isNewVisitor: true,
          site: 'www.lindyson.cn',
          attribution: { source: 'xhs', medium: 'post', landingPath: '/' },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      const [sql, params] = mocks.poolQuery.mock.calls[0]!;
      expect(String(sql)).toContain('ON CONFLICT (visitor_id, visit_day, source) DO NOTHING');
      expect(String(sql)).toContain("AT TIME ZONE 'Asia/Shanghai'");
      expect(params).toEqual([VISITOR_ID, 'xiaohongshu', 'xhs', 'post', null, null, null, null, '/', 'lindyson.cn', true]);
    } finally {
      await app.close();
    }
  });

  it('爬虫请求返回 ok 但不入库', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/public/visits',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; bingbot/2.0)' },
        payload: { visitorId: VISITOR_ID, isNewVisitor: false, site: 'lindyson.com', attribution: { source: 'direct' } },
      });
      expect(response.statusCode).toBe(200);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('非法访客编号或多余字段被拒绝', async () => {
    const app = makeApp();
    try {
      const badId = await app.inject({
        method: 'POST', url: '/api/public/visits', headers: { 'user-agent': BROWSER_UA },
        payload: { visitorId: 'not-a-uuid', isNewVisitor: false, site: 'lindyson.com', attribution: { source: 'direct' } },
      });
      const extra = await app.inject({
        method: 'POST', url: '/api/public/visits', headers: { 'user-agent': BROWSER_UA },
        payload: { visitorId: VISITOR_ID, isNewVisitor: false, site: 'lindyson.com', attribution: { source: 'direct' }, ip: '1.1.1.1' },
      });
      expect(badId.statusCode).toBeGreaterThanOrEqual(400);
      expect(extra.statusCode).toBeGreaterThanOrEqual(400);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe('访客明细保留清理', () => {
  beforeEach(() => mocks.poolQuery.mockReset());

  it('按保留天数分批删除，不满一批即停止', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const result = await runVisitorVisitRetentionSweep({ retentionDays: 180, batchSize: 2 });
    expect(result).toEqual({ deleted: 3, batches: 2 });
    expect(mocks.poolQuery.mock.calls[0]![1]).toEqual([180, 2]);
  });

  it('收到停止信号时不再删除', async () => {
    const result = await runVisitorVisitRetentionSweep({ shouldContinue: () => false });
    expect(result).toEqual({ deleted: 0, batches: 0 });
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });
});
