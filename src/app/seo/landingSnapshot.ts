import { LANDING_CONTENT } from '../data/landingContent';
import { PUBLIC_COMPLIANCE,getVisiblePublicComplianceRegistrations,type PublicComplianceConfig } from '../data/publicCompliance';

// vite.config.ts 在 Node 里渲染快照时传入正式站点的内容与合规配置；浏览器与单元测试使用模块默认值。
export interface LandingSnapshotOptions {
  content?: typeof LANDING_CONTENT;
  compliance?: PublicComplianceConfig;
}

function escapeHtml(value: string) {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

export function renderLandingSnapshot({ content = LANDING_CONTENT, compliance = PUBLIC_COMPLIANCE }: LandingSnapshotOptions = {}) {
  const complianceLinks = getVisiblePublicComplianceRegistrations(compliance)
    .map(registration => `<a href="${escapeHtml(registration.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(registration.label)}</a>`)
    .join(' · ');
  const heroMedia = content.media[1];
  const showcaseItems = content.showcase.steps
    .map(step => `<article><span>${escapeHtml(step.number)}</span><h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.description)}</p></article>`)
    .join('');
  const capabilityItems = content.capabilities.items
    .map(capability => `<article><h3>${escapeHtml(capability.title)}</h3><p>${escapeHtml(capability.description)}</p></article>`)
    .join('');
  const faqItems = content.faqs
    .map(item => `<details><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`)
    .join('');

  return [
    '<main class="landing-static">',
    '<header><a href="/" aria-label="Lindyson AI 首页"><strong>Lindyson AI</strong><span>电商 AI 内容创作工作台</span></a><nav><a href="#landing-showcase">创作过程</a><a href="#landing-pricing">定价</a><a class="landing-static-header-cta" href="/login">开始创作</a></nav></header>',
    '<section class="landing-static-hero">',
    '<div>',
    `<small>${escapeHtml(content.hero.eyebrow)}</small>`,
    `<h1 class="landing-static-headline">${content.hero.headlineLines.map(escapeHtml).join('<br>')}</h1>`,
    `<p>${escapeHtml(content.hero.description)}</p>`,
    `<a class="landing-static-cta" href="/login">${escapeHtml(content.hero.primaryCta)}</a>`,
    '</div>',
    `<picture><source srcset="${escapeHtml(heroMedia.campaignBase)}.avif" type="image/avif"><source srcset="${escapeHtml(heroMedia.campaignBase)}.webp" type="image/webp"><img src="${escapeHtml(heroMedia.campaignBase)}.webp" alt="${escapeHtml(heroMedia.campaignAlt)}" width="1024" height="1280"></picture>`,
    '</section>',
    '<section id="landing-showcase">',
    `<small>${escapeHtml(content.showcase.eyebrow)}</small>`,
    `<h2>${escapeHtml(content.showcase.title)}</h2>`,
    `<p>${escapeHtml(content.showcase.description)}</p>`,
    `<div class="landing-static-grid landing-static-steps">${showcaseItems}</div>`,
    '</section>',
    '<section id="landing-capabilities">',
    `<small>${escapeHtml(content.capabilities.eyebrow)}</small>`,
    `<h2>${escapeHtml(content.capabilities.title)}</h2>`,
    `<div class="landing-static-grid landing-static-capabilities">${capabilityItems}</div>`,
    '</section>',
    '<section id="landing-pricing" class="landing-static-center">',
    `<small>${escapeHtml(content.pricing.eyebrow)}</small>`,
    `<h2>${escapeHtml(content.pricing.title)}</h2>`,
    `<p>${escapeHtml(content.pricing.description)}</p>`,
    '</section>',
    '<section class="landing-static-faq">',
    '<small>FAQ</small>',
    '<h2>开始之前，了解这些。</h2>',
    faqItems,
    '</section>',
    '<section class="landing-static-final">',
    `<h2>${escapeHtml(content.finalCta.title)}</h2>`,
    `<p>${escapeHtml(content.finalCta.description)}</p>`,
    `<a class="landing-static-cta" href="/login">${escapeHtml(content.finalCta.cta)}</a>`,
    '</section>',
    `<footer><strong>Lindyson AI</strong><div class="landing-static-footer-links"><a href="/terms">服务条款</a><a href="/policy">隐私政策</a></div><div class="landing-static-compliance"><p>${escapeHtml(compliance.companyName)}</p><p>${complianceLinks}</p></div><p>© 2026 Lindyson All Rights Reserved</p></footer>`,
    '</main>',
  ].join('');
}

export function getLandingStructuredData({ content = LANDING_CONTENT, compliance = PUBLIC_COMPLIANCE }: LandingSnapshotOptions = {}) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        '@id': `${content.seo.canonicalUrl}#application`,
        name: 'Lindyson AI',
        url: content.seo.canonicalUrl,
        description: content.seo.description,
        image: content.seo.socialImageUrl,
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Web',
        featureList: content.capabilities.items.map(capability => capability.title),
        publisher: {
          '@type': 'Organization',
          name: compliance.companyName,
        },
      },
      {
        '@type': 'FAQPage',
        '@id': `${content.seo.canonicalUrl}#faq`,
        mainEntity: content.faqs.map(item => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.answer,
          },
        })),
      },
    ],
  };
}

export function serializeLandingStructuredData(options: LandingSnapshotOptions = {}) {
  return JSON.stringify(getLandingStructuredData(options)).replace(/</g, '\\u003c');
}
