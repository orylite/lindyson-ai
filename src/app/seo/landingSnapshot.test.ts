import { describe,expect,it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicComplianceNotice } from '../components/PublicComplianceNotice';
import { LANDING_CONTENT } from '../data/landingContent';
import { PUBLIC_COMPLIANCE,getVisiblePublicComplianceRegistrations } from '../data/publicCompliance';
import { getLandingStructuredData,renderLandingSnapshot,serializeLandingStructuredData } from './landingSnapshot';

describe('首页静态 SEO 快照', () => {
  it('无需 JavaScript 即包含主标题、创作流程、三项能力和 FAQ', () => {
    const html = renderLandingSnapshot();

    expect(html).toContain(`<h1 class="landing-static-headline">${LANDING_CONTENT.hero.headlineLines.join('<br>')}</h1>`);
    expect(html).toContain('<a class="landing-static-header-cta" href="/login">开始创作</a>');
    LANDING_CONTENT.showcase.steps.forEach(step => {
      expect(html).toContain(step.title);
      expect(html).toContain(step.description);
    });
    expect(LANDING_CONTENT.showcase.steps.map(step => step.description)).toEqual([
      '上传参考素材，AI 快速生成高质量提示词。',
      '全球领先 AI 模型，快速生成高质量商品视频。',
      '生成素材与提示词原稿自动保存，不再丢失。',
      '通过 TikTok 官方授权，一键完成内容发布。',
      '曝光、播放与互动数据清晰呈现，一目了然。',
    ]);
    expect(LANDING_CONTENT.showcase.analysis).toMatchObject({
      product: '暖金香水',
      tags: ['玻璃瓶','奢华质感','暖金流光','电影光影'],
      prompt: '9:16 电影感香水广告，暖金色玻璃瓶置于深色镜面台面，紫红与金色流光环绕，微距推进，奢华质感，5 秒。',
      readyLabel: 'Prompt ready',
    });
    expect(html).toContain('<section id="landing-capabilities">');
    LANDING_CONTENT.capabilities.items.forEach(capability => expect(html).toContain(capability.title));
    LANDING_CONTENT.faqs.forEach(item => expect(html).toContain(item.question));
    expect(html).toContain(`${LANDING_CONTENT.media[1].campaignBase}.avif`);
    expect(LANDING_CONTENT.media.map(item => item.campaignVideo)).toEqual([
      '/landing/beauty-campaign.mp4',
      '/landing/fashion-campaign.mp4',
      '/landing/tech-campaign.mp4',
    ]);
  });

  it('首页营销正文不再混入运营后台内容或技术状态标签', () => {
    const html = renderLandingSnapshot();
    for (const forbidden of ['管理员后台','订单与工单','发票申请','供应商额度','受控开放','规划中']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('输出 WebApplication 与 FAQ 结构化数据并安全转义标签起始符', () => {
    const data = getLandingStructuredData();
    expect(data['@graph'].map(item => item['@type'])).toEqual(['WebApplication','FAQPage']);
    expect(data['@graph'][0]).toMatchObject({ image: LANDING_CONTENT.seo.socialImageUrl });
    expect(serializeLandingStructuredData()).not.toContain('<');
  });

  it('动态页与静态快照共用同一套公开合规配置且不展示缺失备案', () => {
    const dynamicHtml = renderToStaticMarkup(createElement(PublicComplianceNotice));
    const snapshotHtml = renderLandingSnapshot();
    const registrations = getVisiblePublicComplianceRegistrations();

    expect(registrations.map(registration => registration.kind)).toEqual(['icp']);
    expect(dynamicHtml).toContain(PUBLIC_COMPLIANCE.companyName);
    expect(snapshotHtml).toContain(PUBLIC_COMPLIANCE.companyName);
    expect(dynamicHtml).toContain('class="text-left"');
    expect(dynamicHtml).toContain('justify-start');
    expect(snapshotHtml).toContain('class="landing-static-compliance"');

    for (const registration of registrations) {
      expect(dynamicHtml).toContain(`href="${registration.url}"`);
      expect(dynamicHtml).toContain(registration.label);
      expect(snapshotHtml).toContain(`href="${registration.url}"`);
      expect(snapshotHtml).toContain(registration.label);
    }

    expect(PUBLIC_COMPLIANCE.registrations.publicSecurity).toBeNull();
    expect(PUBLIC_COMPLIANCE.registrations.aiApplication).toBeNull();
    expect(PUBLIC_COMPLIANCE.registrations.aiModel).toBeNull();
    for (const unverifiedText of ['公网安备','AI 应用登记','AI 模型备案','待补','placeholder']) {
      expect(dynamicHtml).not.toContain(unverifiedText);
      expect(snapshotHtml).not.toContain(unverifiedText);
    }
  });
});
