// 正式站点地址由 VITE_PUBLIC_SITE_URL 提供（带协议、无路径），用于 canonical、社交分享图与结构化数据。
// 浏览器构建读 import.meta.env；vite.config.ts 在 Node 里渲染静态快照时用 loadEnv 读到后传入 createLandingSeo。
export const DEFAULT_PUBLIC_SITE_URL = 'https://www.lindyson.com';

export function normalizePublicSiteUrl(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  return `${trimmed || DEFAULT_PUBLIC_SITE_URL}/`;
}

export function createLandingSeo(siteUrl: string) {
  const base = normalizePublicSiteUrl(siteUrl);
  return {
    title: 'Lindyson AI｜AI 视频与图片生成、TikTok 发布工作台',
    description: '面向电商与短视频团队，用 Seedance 2.0 和 Seedream 5.0 Pro 生成视频与商品图，复用参考素材、沉淀数字资产并完成 TikTok 发布。',
    canonicalUrl: base,
    socialImageUrl: `${base}landing/beauty-campaign-social.jpg`,
  } as const;
}

function readViteEnv(name: 'VITE_PUBLIC_SITE_URL'): string | undefined {
  const fromImportMeta = import.meta.env?.[name];
  if (typeof fromImportMeta === 'string') return fromImportMeta;
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

export type LandingCapabilityIconKey = 'generate' | 'library' | 'publish';

export const LANDING_CONTENT = Object.freeze({
  seo: createLandingSeo(readViteEnv('VITE_PUBLIC_SITE_URL') ?? DEFAULT_PUBLIC_SITE_URL),
  brandTagline: '电商 AI 内容创作工作台',
  hero: {
    eyebrow: 'AI CONTENT STUDIO',
    headline: '让商品创意 直接动起来',
    headlineLines: ['让商品创意','直接动起来'] as const,
    description: 'AI 视频、图片生成与 TikTok 发布，在一个工作台完成。',
    primaryCta: '开始创作',
    secondaryCta: '观看创作过程',
  },
  media: [
    {
      id: 'beauty',
      category: '美妆视觉',
      prompt: '玻璃精华液 · 暖金流光',
      sourceBase: '/landing/beauty-source',
      campaignBase: '/landing/beauty-campaign',
      campaignVideo: '/landing/beauty-campaign.mp4',
      sourceAlt: '无品牌玻璃精华液商品图',
      campaignAlt: '紫红与暖金光线中的精华液广告画面',
    },
    {
      id: 'fashion',
      category: '鞋服广告',
      prompt: '未来跑鞋 · 电蓝速度感',
      sourceBase: '/landing/fashion-source',
      campaignBase: '/landing/fashion-campaign',
      campaignVideo: '/landing/fashion-campaign.mp4',
      sourceAlt: '无品牌未来感运动鞋商品图',
      campaignAlt: '电蓝光轨环绕运动鞋的广告画面',
    },
    {
      id: 'tech',
      category: '消费电子',
      prompt: '金属耳机 · 冰蓝体积光',
      sourceBase: '/landing/tech-source',
      campaignBase: '/landing/tech-campaign',
      campaignVideo: '/landing/tech-campaign.mp4',
      sourceAlt: '无品牌金属真无线耳机商品图',
      campaignAlt: '冰蓝体积光中的真无线耳机广告画面',
    },
  ] as const,
  showcase: {
    eyebrow: 'FROM INPUT TO IMPACT',
    title: '从一张商品图，到下一条内容。',
    description: '素材、生成、入库与发布，在同一条创作链路里自然衔接。',
    analysis: {
      eyebrow: 'AI PRODUCT ANALYSIS',
      title: 'AI 产品分析',
      productLabel: '产品',
      product: '暖金香水',
      sceneLabel: '画面',
      scene: '9:16 · 5 秒 · 电商广告',
      tagsLabel: '识别标签',
      tags: ['玻璃瓶','奢华质感','暖金流光','电影光影'],
      promptLabel: '生成提示词',
      prompt: '9:16 电影感香水广告，暖金色玻璃瓶置于深色镜面台面，紫红与金色流光环绕，微距推进，奢华质感，5 秒。',
      readyLabel: 'Prompt ready',
    },
    steps: [
      { id: 'input', number: '01', title: '放入素材', description: '上传参考素材，AI 快速生成高质量提示词。' },
      { id: 'generate', number: '02', title: 'AI 生成', description: '全球领先 AI 模型，快速生成高质量商品视频。' },
      { id: 'library', number: '03', title: '自动入库', description: '生成素材与提示词原稿自动保存，不再丢失。' },
      { id: 'publish', number: '04', title: '配置发布', description: '通过 TikTok 官方授权，一键完成内容发布。' },
      { id: 'preview', number: '05', title: '发布预览', description: '曝光、播放与互动数据清晰呈现，一目了然。' },
    ] as const,
  },
  capabilities: {
    eyebrow: 'ONE CREATIVE FLOW',
    title: '创作、管理、发布，一条链路。',
    items: [
      {
        id: 'generate',
        title: 'AI 视频与图片生成',
        description: '从文字或参考素材出发，快速完成电商内容创作。',
        iconKey: 'generate',
      },
      {
        id: 'library',
        title: '素材与数字资产',
        description: '生成结果自动沉淀，提示词与参考素材随时复用。',
        iconKey: 'library',
      },
      {
        id: 'publish',
        title: 'TikTok 发布',
        description: '选择账号、封面与内容类型，完成发布准备。',
        iconKey: 'publish',
      },
    ] as const,
  },
  pricing: {
    eyebrow: 'PRICING',
    title: '选择适合当前产量的套餐',
    description: '按创作节奏开始，需要更多产量时再升级。',
  },
  faqs: [
    {
      question: '可以使用哪些参考素材？',
      answer: '可以集中上传和管理图片、视频与音频素材，并在视频或图片生成时从数字资产库直接选择复用。',
    },
    {
      question: '生成结果会自动保存吗？',
      answer: '会。生成完成的视频与图片会进入数字资产库，并保留提示词、参考素材和生成参数，方便下载或继续创作。',
    },
    {
      question: '积分如何使用？',
      answer: '不同模型、清晰度和时长会消耗对应积分。账户中心会展示当前积分、周期额度、重置日期和到期日期。',
    },
    {
      question: '如何把内容发布到 TikTok？',
      answer: '连接 TikTok 账号后，可从数字资产库选择视频或图片，配置封面、发布信息与内容类型，并创建发布任务。',
    },
  ] as const,
  finalCta: {
    title: '下一条内容，从这里开始。',
    description: '把商品素材交给 Lindyson AI，让创意自然进入生产。',
    cta: '开始创作',
  },
});

export type LandingContent = typeof LANDING_CONTENT;
