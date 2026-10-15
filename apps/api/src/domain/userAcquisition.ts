import {
  normalizeAcquisitionSource,
  type AcquisitionSource,
  type RegistrationAttribution,
  type VisitAttribution,
} from '@lindyson/api-contracts';
import type { DbClient } from '../db/pool.js';

export interface ResolvedAcquisition {
  source: AcquisitionSource;
  rawSource: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  referrerHost: string | null;
  landingPath: string | null;
  firstTouchAt: string | null;
  visitorId: string | null;
}

/**
 * 把前端上送的来源归到白名单。规则：
 * - 有 utm / from：能识别就用识别值，识别不了归 other 并保留原值；
 * - 没有 utm 但带了邀约码：记 referral；
 * - 什么都没有：记 direct（注册当下的事实，而不是留空）。
 */
export function resolveRegistrationAcquisition(
  attribution: RegistrationAttribution | VisitAttribution | undefined,
  hasReferralCode: boolean,
): ResolvedAcquisition {
  const rawSource = attribution?.source?.trim() || null;
  const normalized = normalizeAcquisitionSource(rawSource);
  let source: AcquisitionSource;
  if (normalized && normalized !== 'direct') source = normalized;
  else if (rawSource && !normalized) source = 'other';
  else source = hasReferralCode ? 'referral' : 'direct';
  return {
    source,
    rawSource: rawSource && rawSource !== source ? rawSource : null,
    medium: attribution?.medium ?? null,
    campaign: attribution?.campaign ?? null,
    content: attribution?.content ?? null,
    term: attribution?.term ?? null,
    referrerHost: attribution?.referrerHost ?? null,
    landingPath: attribution?.landingPath ?? null,
    firstTouchAt: attribution?.firstTouchAt ?? null,
    visitorId: attribution && 'visitorId' in attribution ? attribution.visitorId ?? null : null,
  };
}

export async function recordUserAcquisitionWithClient(client: DbClient, userId: string, acquisition: ResolvedAcquisition) {
  await client.query(
    `INSERT INTO user_acquisitions (
       user_id, source, raw_source, medium, campaign, content, term, referrer_host, landing_path, first_touch_at, visitor_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (user_id) DO NOTHING`,
    [
      userId,
      acquisition.source,
      acquisition.rawSource,
      acquisition.medium,
      acquisition.campaign,
      acquisition.content,
      acquisition.term,
      acquisition.referrerHost,
      acquisition.landingPath,
      acquisition.firstTouchAt,
      acquisition.visitorId,
    ],
  );
}
