export type ProductCapabilityStatus = 'live' | 'gated' | 'planned';

export type ProductCapabilityIconKey =
  | 'video'
  | 'file-stack'
  | 'folder-open'
  | 'send'
  | 'credit-card'
  | 'shield-check'
  | 'image';

export interface ProductCapability {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly boundary: string;
  readonly status: ProductCapabilityStatus;
  readonly iconKey: ProductCapabilityIconKey;
}

export interface PageMetadata {
  readonly title: string;
  readonly description: string;
}

export const PRODUCT_BRAND = Object.freeze({
  name: 'Lindyson AI',
  adminName: 'Lindyson Admin',
  landingHeadline: LANDING_CONTENT.hero.headline,
});

export const CAPABILITY_STATUS_LABELS: Readonly<Record<ProductCapabilityStatus, string>> = Object.freeze({
  live: '已上线',
  gated: '受控开放',
  planned: '规划中',
});

export const PRODUCT_CAPABILITIES = Object.freeze({
  seedanceVideo: {
    id: 'seedance-video',
    title: 'AI 视频生成',
    description: '统一管理全能参考、首尾帧、比例、清晰度与时长配置，生成完成后自动进入数字资产。',
    boundary: 'Seedance 视频生成使用真实后端任务、积分预扣、队列和结算流程。',
    status: 'live',
    iconKey: 'video',
  },
  referenceAssets: {
    id: 'reference-assets',
    title: '参考素材管理',
    description: '上传图片、视频和音频参考素材，按文件夹沉淀并在视频生成时安全复用。',
    boundary: '参考素材上传、鉴权、存储和复用均使用真实后端与对象存储流程。',
    status: 'live',
    iconKey: 'file-stack',
  },
  digitalAssets: {
    id: 'digital-assets',
    title: '数字资产库',
    description: '视频、图片、音频、文件夹和生成信息集中沉淀，支持预览、移动、下载和复用生成策略。',
    boundary: '数字资产、文件夹和下载权限均由真实后端按当前用户隔离。',
    status: 'live',
    iconKey: 'folder-open',
  },
  tiktokWorkspace: {
    id: 'tiktok-workspace',
    title: 'TikTok 发布工作区',
    description: '保留账号授权、素材选择、发布准备和运营管理工作区，普通用户入口由功能开关控制。',
    boundary: 'TikTok 工作区受控开放，管理员可用于验收；真实 TikTok API 尚未接入，当前不承诺自动授权或发布。',
    status: 'gated',
    iconKey: 'send',
  },
  payments: {
    id: 'payments',
    title: '订阅、支付与积分',
    description: '主套餐、加购包、支付宝订单、发票申请和积分流水由真实后端统一管理。',
    boundary: '支付结果以服务端同步和异步通知为准，前端不能自行发放积分或套餐权益。',
    status: 'live',
    iconKey: 'credit-card',
  },
  admin: {
    id: 'admin',
    title: '运营管理后台',
    description: '集中管理套餐、订单、用户、发票、工单、生成任务、供应商用量和审计记录。',
    boundary: '管理后台读取真实 API 数据，写操作受权限、事务、审计和请求幂等保护。',
    status: 'live',
    iconKey: 'shield-check',
  },
  seedreamImage: {
    id: 'seedream-image',
    title: 'Seedream 图片生成',
    description: '使用 Seedream 5.0 Pro 进行文生图和参考图生图，并把结果归档到数字资产。',
    boundary: '仅通过自有后端调用固定 Seedream 5.0 Pro 模型；1K / 2K 是否开放及站内积分以后台配置为准。',
    status: 'live',
    iconKey: 'image',
  },
} as const satisfies Readonly<Record<string, ProductCapability>>);

export const PRODUCT_CAPABILITY_LIST: readonly ProductCapability[] = Object.freeze(
  Object.values(PRODUCT_CAPABILITIES),
);

export const LANDING_CAPABILITIES = Object.freeze([
  PRODUCT_CAPABILITIES.seedanceVideo,
  PRODUCT_CAPABILITIES.referenceAssets,
  PRODUCT_CAPABILITIES.digitalAssets,
  PRODUCT_CAPABILITIES.tiktokWorkspace,
] as const);

export const PRODUCT_CAPABILITY_COPY = Object.freeze({
  creationSummary: '当前提供 Seedance AI 视频生成、Seedream AI 图片生成、参考素材与数字资产管理、订阅积分和运营后台；TikTok 工作区受控开放。',
  liveBoundary: '登录、注册、支付宝支付、积分、资产、Seedance 视频生成、Seedream 图片生成和后台数据均使用真实后端接口。TikTok 工作区受功能开关控制，真实 TikTok API 尚未接入。',
});

export const ROUTE_PAGE_METADATA = Object.freeze({
  '/': {
    title: LANDING_CONTENT.seo.title,
    description: LANDING_CONTENT.seo.description,
  },
  '/login': {
    title: `登录 · ${PRODUCT_BRAND.name}`,
    description: `登录 ${PRODUCT_BRAND.name}，继续管理视频生成任务、参考素材、数字资产、订阅和积分。`,
  },
  '/register': {
    title: `注册 · ${PRODUCT_BRAND.name}`,
    description: `注册 ${PRODUCT_BRAND.name} 账户，开始使用 Seedance 视频生成、参考素材和数字资产管理。`,
  },
  '/reset-password': {
    title: `重置密码 · ${PRODUCT_BRAND.name}`,
    description: `为 ${PRODUCT_BRAND.name} 账户设置新密码并恢复安全访问。`,
  },
  '/terms': {
    title: `服务条款 · ${PRODUCT_BRAND.name}`,
    description: `查看 ${PRODUCT_BRAND.name} 服务条款、账户规则、内容责任和服务边界。`,
  },
  '/policy': {
    title: `隐私政策 · ${PRODUCT_BRAND.name}`,
    description: `查看 ${PRODUCT_BRAND.name} 对账户、内容、资产和支付相关信息的处理与保护规则。`,
  },
  '/mcp/authorize': {
    title: `MCP 连接授权 · ${PRODUCT_BRAND.name}`,
    description: '查看 ChatGPT 或 Codex 请求的账号、素材和生成权限，确认积分消费说明并决定是否授权。',
  },
  '/portrait-consent/invite': {
    title: `真人肖像授权 · ${PRODUCT_BRAND.name}`,
    description: '由真人本人阅读肖像与敏感个人信息告知，并决定是否授权及启动官方活体认证。',
  },
  '/portrait-consent/authorization': {
    title: `真人肖像授权管理 · ${PRODUCT_BRAND.name}`,
    description: '由真人本人查看授权期限和处理状态，并可随时撤回后续使用授权。',
  },
  '/portrait-consent/verification-complete': {
    title: `真人认证结果 · ${PRODUCT_BRAND.name}`,
    description: '火山方舟官方 H5 已返回，最终认证状态由服务端通过官方接口确认。',
  },
  '/app': {
    title: `仪表盘 · ${PRODUCT_BRAND.name}`,
    description: `查看 ${PRODUCT_BRAND.name} 创作统计、最近任务、数字资产和平台公告。`,
  },
  '/app/ai-studio': {
    title: `AI Studio · ${PRODUCT_BRAND.name}`,
    description: PRODUCT_CAPABILITIES.seedanceVideo.description,
  },
  '/app/digital-assets': {
    title: `数字资产 · ${PRODUCT_BRAND.name}`,
    description: PRODUCT_CAPABILITIES.digitalAssets.description,
  },
  '/app/real-portraits': {
    title: `真人演员库 · ${PRODUCT_BRAND.name}`,
    description: '管理私有真人演员档案、本人授权、活体认证、素材状态和套餐额度。',
  },
  '/app/tiktok-accounts': {
    title: `管理 TikTok 账号 · ${PRODUCT_BRAND.name}`,
    description: PRODUCT_CAPABILITIES.tiktokWorkspace.boundary,
  },
  '/app/tiktok-publish': {
    title: `发布至 TikTok · ${PRODUCT_BRAND.name}`,
    description: PRODUCT_CAPABILITIES.tiktokWorkspace.boundary,
  },
  '/app/subscription': {
    title: `订阅套餐 · ${PRODUCT_BRAND.name}`,
    description: PRODUCT_CAPABILITIES.payments.description,
  },
  '/app/account-center': {
    title: `账户中心 · ${PRODUCT_BRAND.name}`,
    description: '管理账户资料、安全设置、订单、积分流水和发票申请状态。',
  },
  '/admin': {
    title: `仪表盘 · ${PRODUCT_BRAND.adminName}`,
    description: PRODUCT_CAPABILITIES.admin.description,
  },
  '/admin/announcements': {
    title: `平台公告 · ${PRODUCT_BRAND.adminName}`,
    description: `创建、编辑、置顶和下线 ${PRODUCT_BRAND.name} 平台公告。`,
  },
  '/admin/referrals': {
    title: `邀约奖励 · ${PRODUCT_BRAND.adminName}`,
    description: '配置用户邀约奖励，查询邀请、积分发放、退款追回与人工核对记录。',
  },
  '/admin/plans': {
    title: `订阅套餐 · ${PRODUCT_BRAND.adminName}`,
    description: '管理主套餐、加购包、积分额度、价格、状态和展示规则。',
  },
  '/admin/real-portrait-capacity': {
    title: `真人容量 · ${PRODUCT_BRAND.adminName}`,
    description: '查看真人演员套餐额度、共享容量、降级宽限、等待队列和远端清理失败。',
  },
  '/admin/consumption-settings': {
    title: `积分消耗 · ${PRODUCT_BRAND.adminName}`,
    description: '管理视频生成模型、时长、清晰度及参考视频双档积分配置。',
  },
  '/admin/feature-flags': {
    title: `功能开关 · ${PRODUCT_BRAND.adminName}`,
    description: '管理普通用户对受控工作区的访问状态。',
  },
  '/admin/payment-channel': {
    title: `支付通道 · ${PRODUCT_BRAND.adminName}`,
    description: '管理生产支付通道、商户配置和启用状态。',
  },
  '/admin/orders': {
    title: `订单管理 · ${PRODUCT_BRAND.adminName}`,
    description: '查询订阅与加购订单，并处理支付同步和退款流程。',
  },
  '/admin/users': {
    title: `用户管理 · ${PRODUCT_BRAND.adminName}`,
    description: '查询用户、调整账户状态，并执行受审计保护的积分操作。',
  },
  '/admin/tickets': {
    title: `工单管理 · ${PRODUCT_BRAND.adminName}`,
    description: '查看用户工单、消息和未读状态，并处理回复与关闭流程。',
  },
  '/admin/invoices': {
    title: `发票管理 · ${PRODUCT_BRAND.adminName}`,
    description: '查看发票抬头、税号和接收邮箱，并记录人工开具与发送状态。',
  },
  '/admin/api-usage': {
    title: `成本看盘 · ${PRODUCT_BRAND.adminName}`,
    description: '按月份或自选周期查看视频生成与多模态模型的用户积分、人民币成本和火山方舟余额。',
  },
  '/admin/api-usage/audit': {
    title: `高级成本对账 · ${PRODUCT_BRAND.adminName}`,
    description: '查看供应商 Token、价格、历史补记、对账证据和官方结算明细。',
  },
  '/admin/api-usage/bills': {
    title: `官方账单 · ${PRODUCT_BRAND.adminName}`,
    description: '按周期、产品、服务、模型、终账状态和归属查看供应商官方账单与运营调用。',
  },
  '/admin/credits': {
    title: `积分流水 · ${PRODUCT_BRAND.adminName}`,
    description: '查询后台积分调整、扣减、退款和结算流水。',
  },
  '/admin/jobs': {
    title: `生成任务 · ${PRODUCT_BRAND.adminName}`,
    description: '查看视频生成任务、尝试次数、结算状态和恢复操作。',
  },
  '/admin/audit': {
    title: `操作审计 · ${PRODUCT_BRAND.adminName}`,
    description: '查询后台写操作、操作者、请求标识和审计结果。',
  },
  '/admin/design-system': {
    title: `设计规范 · ${PRODUCT_BRAND.adminName}`,
    description: `查看 ${PRODUCT_BRAND.name} 的界面组件、交互规则和当前产品能力边界。`,
  },
} as const satisfies Readonly<Record<string, PageMetadata>>);

export const DEFAULT_PAGE_METADATA: PageMetadata = ROUTE_PAGE_METADATA['/'];

export const NOT_FOUND_PAGE_METADATA: PageMetadata = Object.freeze({
  title: `页面不存在 · ${PRODUCT_BRAND.name}`,
  description: `当前地址不存在或已经失效，请返回 ${PRODUCT_BRAND.name} 首页。`,
});
import { LANDING_CONTENT } from './landingContent';
