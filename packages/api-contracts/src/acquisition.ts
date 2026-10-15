import { z } from 'zod';
import { isoDateTimeSchema, nonnegativeIntegerSchema } from './primitives.js';

/** 注册来源白名单：推广链接的 utm_source / from 不在表内时服务端归为 other，并保留原值。 */
export const ACQUISITION_SOURCES = [
  'xiaohongshu',
  'douyin',
  'bilibili',
  'zhihu',
  'wechat',
  'weibo',
  'github',
  'search-baidu',
  'search-google',
  'search-bing',
  'referral',
  'direct',
  'other',
] as const;
export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];
export const acquisitionSourceSchema = z.enum(ACQUISITION_SOURCES);

export const ACQUISITION_SOURCE_LABELS: Record<AcquisitionSource, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  bilibili: 'B站',
  zhihu: '知乎',
  wechat: '微信',
  weibo: '微博',
  github: 'GitHub',
  'search-baidu': '百度搜索',
  'search-google': 'Google 搜索',
  'search-bing': 'Bing 搜索',
  referral: '邀约',
  direct: '直接访问',
  other: '其他',
};

/** 短参数 `?from=` 与常见别名到白名单值的映射，键一律小写。 */
const SOURCE_ALIASES: Record<string, AcquisitionSource> = {
  xhs: 'xiaohongshu',
  xiaohongshu: 'xiaohongshu',
  redbook: 'xiaohongshu',
  rednote: 'xiaohongshu',
  dy: 'douyin',
  douyin: 'douyin',
  tiktok: 'douyin',
  bili: 'bilibili',
  bilibili: 'bilibili',
  b23: 'bilibili',
  zhihu: 'zhihu',
  wx: 'wechat',
  wechat: 'wechat',
  weixin: 'wechat',
  weibo: 'weibo',
  wb: 'weibo',
  github: 'github',
  gh: 'github',
  baidu: 'search-baidu',
  'search-baidu': 'search-baidu',
  google: 'search-google',
  'search-google': 'search-google',
  bing: 'search-bing',
  'search-bing': 'search-bing',
  referral: 'referral',
  direct: 'direct',
  other: 'other',
};

/** 把 utm_source / from 的原始值归到白名单；无法识别返回 null，由调用方决定归 other。 */
export function normalizeAcquisitionSource(raw: string | null | undefined): AcquisitionSource | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return SOURCE_ALIASES[key] ?? null;
}

const attributionTextSchema = (max: number) => z.string().trim().min(1).max(max);

/** 注册时随请求体提交的来源信息，由前端在首页或登录页首次访问时采集。 */
export const registrationAttributionSchema = z.object({
  source: attributionTextSchema(64),
  medium: attributionTextSchema(64).optional(),
  campaign: attributionTextSchema(128).optional(),
  content: attributionTextSchema(128).optional(),
  term: attributionTextSchema(128).optional(),
  referrerHost: attributionTextSchema(255).optional(),
  landingPath: attributionTextSchema(255).optional(),
  firstTouchAt: isoDateTimeSchema.optional(),
}).strict();
export type RegistrationAttribution = z.infer<typeof registrationAttributionSchema>;

/** 后台用户列表里的来源信息；历史用户为 null，前端显示「未知」。 */
export const adminUserAcquisitionSchema = z.object({
  source: acquisitionSourceSchema,
  rawSource: z.string().nullable(),
  medium: z.string().nullable(),
  campaign: z.string().nullable(),
  content: z.string().nullable(),
  term: z.string().nullable(),
  referrerHost: z.string().nullable(),
  landingPath: z.string().nullable(),
  firstTouchAt: isoDateTimeSchema.nullable(),
}).strict();

/** 仪表盘本月注册来源分布。 */
export const adminAcquisitionMixItemSchema = z.object({
  source: acquisitionSourceSchema,
  registrations: nonnegativeIntegerSchema,
  paidUsers: nonnegativeIntegerSchema,
  revenue: nonnegativeIntegerSchema,
}).strict();
