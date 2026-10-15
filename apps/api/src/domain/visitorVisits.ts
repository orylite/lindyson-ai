import type { VisitorVisitBody } from '@lindyson/api-contracts';
import { env } from '../config/env.js';
import { pool, type DbClient } from '../db/pool.js';
import { resolveRegistrationAcquisition } from './userAcquisition.js';

const BOT_USER_AGENT = /bot|spider|crawl|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|bytespider|python-requests|python-urllib|curl\/|wget|go-http-client|okhttp|java\/|axios\/|node-fetch|scrapy|phantomjs|puppeteer|playwright/i;

/** 爬虫、监控与脚本请求不计入访客；没有 User-Agent 的请求也视为非浏览器。 */
export function isLikelyBotUserAgent(userAgent: string | undefined | null) {
  if (!userAgent || !userAgent.trim()) return true;
  return BOT_USER_AGENT.test(userAgent);
}

/** 只区分两个正式站点，其他主机（预览、测试）归 other，避免任意字符串入库。 */
export function normalizeVisitSite(site: string) {
  const host = site.trim().toLowerCase().replace(/^www\./, '');
  if (host === 'lindyson.com') return 'lindyson.com' as const;
  if (host === 'lindyson.cn') return 'lindyson.cn' as const;
  return 'other' as const;
}

/**
 * 记录一次访客到站。同一访客同一天（北京时间）同一来源只入库一次，重复上报静默忽略。
 * 返回是否新写入一条记录。
 */
export async function recordVisitorVisit(client: DbClient, body: VisitorVisitBody) {
  const acquisition = resolveRegistrationAcquisition(body.attribution, false);
  const result = await client.query(
    `INSERT INTO visitor_visits (
       visitor_id, visit_day, source, raw_source, medium, campaign, content, term,
       referrer_host, landing_path, site, is_new_visitor
     ) VALUES (
       $1, (now() AT TIME ZONE 'Asia/Shanghai')::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
     )
     ON CONFLICT (visitor_id, visit_day, source) DO NOTHING`,
    [
      body.visitorId,
      acquisition.source,
      acquisition.rawSource,
      acquisition.medium,
      acquisition.campaign,
      acquisition.content,
      acquisition.term,
      acquisition.referrerHost,
      acquisition.landingPath,
      normalizeVisitSite(body.site),
      body.isNewVisitor,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export interface VisitorVisitRetentionOptions {
  retentionDays?: number;
  batchSize?: number;
  maxBatches?: number;
  shouldContinue?: () => boolean;
}

/** 按保留期分批删除访客明细，每批独立提交，可被 worker 停止信号中断。 */
export async function runVisitorVisitRetentionSweep(options: VisitorVisitRetentionOptions = {}) {
  const retentionDays = options.retentionDays ?? env.VISITOR_VISITS_RETENTION_DAYS;
  const batchSize = options.batchSize ?? 5_000;
  const maxBatches = options.maxBatches ?? 200;
  let deleted = 0;
  let batches = 0;
  while (batches < maxBatches && (options.shouldContinue?.() ?? true)) {
    const result = await pool.query(
      `DELETE FROM visitor_visits
       WHERE id IN (
         SELECT id FROM visitor_visits
         WHERE created_at < now() - make_interval(days => $1::int)
         ORDER BY id
         LIMIT $2
       )`,
      [retentionDays, batchSize],
    );
    batches += 1;
    const count = result.rowCount ?? 0;
    deleted += count;
    if (count < batchSize) break;
  }
  return { deleted, batches };
}
