import { describe,expect,it } from 'vitest';
import {
  DEFAULT_PAGE_METADATA,
  LANDING_CAPABILITIES,
  PRODUCT_BRAND,
  PRODUCT_CAPABILITIES,
  PRODUCT_CAPABILITY_LIST,
  ROUTE_PAGE_METADATA,
} from './capabilities';

describe('共享产品能力配置', () => {
  it('固定生产能力状态与真实边界', () => {
    expect(PRODUCT_CAPABILITIES.seedanceVideo.status).toBe('live');
    expect(PRODUCT_CAPABILITIES.digitalAssets.status).toBe('live');
    expect(PRODUCT_CAPABILITIES.payments.status).toBe('live');
    expect(PRODUCT_CAPABILITIES.admin.status).toBe('live');
    expect(PRODUCT_CAPABILITIES.tiktokWorkspace.status).toBe('gated');
    expect(PRODUCT_CAPABILITIES.tiktokWorkspace.boundary).toContain('真实 TikTok API 尚未接入');
    expect(PRODUCT_CAPABILITIES.seedreamImage.status).toBe('live');
    expect(PRODUCT_CAPABILITIES.seedreamImage.boundary).toContain('1K / 2K');
  });

  it('落地页能力卡片全部来自共享配置', () => {
    expect(LANDING_CAPABILITIES.map(capability => capability.id)).toEqual([
      'seedance-video',
      'reference-assets',
      'digital-assets',
      'tiktok-workspace',
    ]);
    expect(PRODUCT_CAPABILITY_LIST).toContain(PRODUCT_CAPABILITIES.tiktokWorkspace);
  });

  it('构建期首页 metadata 与共享默认值保持一致', () => {
    expect(PRODUCT_BRAND.landingHeadline).toBe('让商品创意 直接动起来');
    expect(DEFAULT_PAGE_METADATA).toBe(ROUTE_PAGE_METADATA['/']);
    expect(DEFAULT_PAGE_METADATA.title).toBe('Lindyson AI｜AI 视频与图片生成、TikTok 发布工作台');
  });
});
