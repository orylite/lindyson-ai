import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { NOT_FOUND_PAGE_METADATA,ROUTE_PAGE_METADATA,type PageMetadata } from '../../src/app/data/capabilities';
import { expectedPublicSiteUrl,loadPublicComplianceForTests,loadViteEnvForTests } from './publicCompliance';

// 页脚公示信息与客服二维码按部署配置断言，仓库模板与正式站点都能通过。
const PUBLIC_COMPLIANCE_FOR_TESTS = loadPublicComplianceForTests();
const PUBLIC_COMPLIANCE_COMPANY_NAME = PUBLIC_COMPLIANCE_FOR_TESTS.companyName;
const PUBLIC_COMPLIANCE_ICP_LABEL = PUBLIC_COMPLIANCE_FOR_TESTS.registrations.icp?.label ?? '';
const VITE_ENV_FOR_TESTS = loadViteEnvForTests();
const SUPPORT_QR_CONFIGURED = Boolean(VITE_ENV_FOR_TESTS.VITE_SUPPORT_QR_URL?.trim());
const PUBLIC_SITE_URL_FOR_TESTS = expectedPublicSiteUrl(VITE_ENV_FOR_TESTS);
const TUTORIAL_MEDIA_BASE_URL = (VITE_ENV_FOR_TESTS.VITE_SEEDREAM_TUTORIAL_MEDIA_BASE_URL ?? '').trim().replace(/\/+$/, '');

const registerCode = '135790';
const verificationId = '00000000-0000-4000-8000-000000000001';
const rootVideoFolderId = mockUuid('system-folder-ai-video');
const productVideoFolderId = mockUuid('folder-ai-video-product');
const assetBrandId = mockUuid('asset-brand');
const paymentOrderTwoId = mockUuid('order-payment-2');
const mockDesktopAlipayUrl = [
  'https://openapi.alipay.com/gateway.do?app_id=2026000000000000',
  '&method=alipay.trade.wap.pay&charset=UTF-8&sign_type=RSA2',
  '&timestamp=2026-07-11%2018%3A37%3A00&version=1.0',
  `&biz_content=${'A'.repeat(760)}`,
  `&sign=${'B'.repeat(172)}`,
].join('');

type MockPlan = {
  id: string;
  name: string;
  nameEn: string;
  code: string;
  kind: 'main' | 'addon';
  billing: 'monthly' | 'yearly' | 'both' | 'one-time';
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  credits: number;
  assetRetentionDays: number;
  portraitEntitlements: {
    enabled: boolean;
    profileLimit: number | null;
    activeLimit: number;
    assetsPerActor: 0 | 1 | 2;
  };
  storage: string;
  tiktokAccounts: string;
  features: Array<{ text: string; enabled: boolean }>;
  recommendation: 'popular' | 'enterprise' | null;
  iconKey: 'zap' | 'sparkles' | 'crown' | 'gem' | 'rocket' | 'building-2' | null;
  ctaLabel: string;
  status: 'active' | 'disabled' | 'draft';
  landingVisible: boolean;
  subscribers: number;
  revenue: number;
  createdAt: string | null;
  updatedAt: string;
};

type MockAnnouncement = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
};

type AdminRefreshScenario =
  | 'default'
  | 'fresh-data'
  | 'fail-next-admin-plans'
  | 'fail-next-api-cost-overview'
  | 'fail-next-api-cost-users'
  | 'fail-next-api-cost-tasks'
  | 'delay-next-api-cost-audit';
type PaymentSyncFinalStatus = 'pending' | 'paid' | 'failed';
type PaymentCreateAttemptStatus = 'ready' | 'processing' | 'uncertain' | 'manual-review';

type MockFeatureFlags = {
  tiktokAccounts: boolean;
  tiktokPublish: boolean;
};

type MockUploadSessionRecord = {
  id: string;
  idempotencyKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  source: 'uploaded-video' | 'uploaded-image' | 'uploaded-audio';
  folderId: string | null;
  stagingObjectKey: string;
  finalObjectKey: string;
  status: 'pending' | 'completed';
  processingStage: 'waiting-upload' | 'completed';
  progress: number;
  attempt: number;
  asset: ReturnType<typeof uploadedAsset> | null;
  expiresAt: string;
  updatedAt: string;
};

type MockPromptWizardRun = {
  id: string;
  engineVersion: 4;
  status: 'ready';
  revision: number;
  imageAssetIds: string[];
  productProfile: {
    productName: string;
    category: string;
    colors: string;
    materials: string;
    structure: string;
    logo: string;
    usage: string;
    suggestedAudience: string;
    suggestedScenarios: string;
    visibleFacts: string[];
    categoryInferredFunctions?: string[];
    needsConfirmation: string[];
    userConfirmedClaims: string;
    consistencyConstraints: string;
  };
  creativeBrief: ({
    audioMode: 'sound-design-only';
    verifiedOffer: string;
  } | {
    audioMode: 'voiceover';
    voiceoverLanguage: string;
    verifiedOffer: string;
  }) | null;
  videoConfig: {
    model: string;
    aspectRatio: string;
    resolution: string;
    durationSeconds: number;
  } | null;
  productionBrief?: {
    primaryPurchaseReason: string;
    appearanceMode: 'person' | 'hands-only' | 'product-only';
    availableScenes: string[];
    availableAssets: string[];
  } | null;
  evidenceGraph?: Record<string, unknown> | null;
  failureReason: null;
  createdAt: string;
  updatedAt: string;
};

type MockPromptWizardBatch = {
  id: string;
  runId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  isFree: boolean;
  credits: number;
  creditStatus: 'none' | 'held' | 'settled' | 'refunded';
  plans: Array<Record<string, unknown>>;
  routeSetId?: string | null;
  conceptSetId?: string | null;
  selectedConceptIds?: string[];
  useDirectionSetId?: string | null;
  selectedUseDirectionId?: string | null;
  selectedSceneId?: string | null;
  customScene?: Record<string, string> | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

type MockPromptWizardDeferredBatch = {
  outcome: 'completed' | 'failed';
  completedPlans: Array<Record<string, unknown>>;
  pollCount: number;
};

type MockTkPromptRun = {
  id: string;
  schemaVersion: 1;
  status: 'ready';
  imageAssetIds: string[];
  evidenceProfile: Record<string, unknown>;
  failureReason: null;
  createdAt: string;
  completedAt: string;
};

type MockTkPromptGeneration = Record<string, any> & {
  id: string;
  runId: string;
  status: 'completed';
  options: Array<Record<string, any>>;
};

async function installApiMocks(page: Page) {
  const apiRequestCounts = new Map<string, number>();
  const uploadAttempts = new Map<string, number>();
  const uploadSessionsById = new Map<string, MockUploadSessionRecord>();
  const uploadSessionsByIdempotencyKey = new Map<string, MockUploadSessionRecord>();
  const assetFolderDeletionRecords = new Map<string, {
    contentAction: 'move-to-root' | 'delete-assets';
    affectedAssetCount: number;
  }>();
  const generationRequests: unknown[] = [];
  const generationFailuresOnPoll = new Set<string>();
  const promptWizardRuns = new Map<string, MockPromptWizardRun>();
  const promptWizardBatches = new Map<string, MockPromptWizardBatch>();
  const promptWizardDeferredBatches = new Map<string, MockPromptWizardDeferredBatch>();
  const promptWizardUseDirectionSets = new Map<string, Record<string, any>>();
  const promptWizardPlanRevisions = new Map<string, Record<string, any>>();
  const promptWizardBatchIdsByRun = new Map<string, string[]>();
  const promptWizardRefinementRequests: unknown[] = [];
  const tkPromptEngineSettingsRequests: Array<{ generationCredits?: number; available?: boolean }> = [];
  const tkPromptRuns = new Map<string, MockTkPromptRun>();
  const tkPromptGenerations = new Map<string, MockTkPromptGeneration>();
  const tkPromptGenerationRequests: Array<Record<string, any>> = [];
  const promptWizardSettingsRequests: Array<{ generationCredits?: number; available?: boolean }> = [];
  let promptWizardRunSequence = 0;
  let promptWizardBatchSequence = 0;
  let promptWizardUseDirectionSetSequence = 0;
  let promptWizardPlanRevisionSequence = 0;
  let promptWizardResumeEnabled = false;
  let promptWizardLegacyTaskRetired = false;
  let promptWizardFailNextInitialBatch = false;
  let promptWizardFailNextPaidBatch = false;
  let promptWizardNextDeferredBatchOutcome: MockPromptWizardDeferredBatch['outcome'] | null = null;
  let promptWizardDeferredBatchPollingEnabled = false;
  let tkPromptRunSequence = 0;
  let tkPromptGenerationSequence = 0;
  let promptWizardSettings = {
    generationCredits: 1,
    available: true,
    engineVersion: 4 as const,
    updatedAt: '2026-07-17T10:00:00.000Z',
  };
  let tkPromptEngineSettings = {
    schemaVersion: 1 as const,
    generationCredits: 1,
    available: true,
    updatedAt: '2026-08-17T00:00:00.000Z',
  };
  let adminRefreshScenario: AdminRefreshScenario = 'default';
  let adminPlanReadFailuresRemaining = 0;
  let adminPlanReadDelayMs = 0;
  let apiCostSyncRevision = 0;
  let currentUser = account('管理员', 'admin@lindyson.ai');
  const users = [
    adminUser(currentUser),
    adminUser(account('Pro User', 'pro.user@lindyson.ai')),
  ];
  let folders = [
    folder(rootVideoFolderId, '主目录', 'ai-video', true),
    folder(productVideoFolderId, '产品发布', 'ai-video', false, '2026-07-01T10:00:00.000Z'),
    folder('system-folder-ai-image', '主目录', 'ai-image', true),
    folder('system-folder-uploaded-video', '主目录', 'uploaded-video', true),
    folder('system-folder-uploaded-image', '主目录', 'uploaded-image', true),
    folder('folder-uploaded-image-archive', '图片归档', 'uploaded-image', false, '2026-07-06T10:00:00.000Z'),
    folder('folder-uploaded-image-campaign', '活动图片', 'uploaded-image', false, '2026-07-05T10:00:00.000Z'),
    folder('folder-uploaded-image-product', '商品图片', 'uploaded-image', false, '2026-07-04T10:00:00.000Z'),
    folder('folder-uploaded-image-scene', '场景图片', 'uploaded-image', false, '2026-07-03T10:00:00.000Z'),
    folder('folder-uploaded-image-reference', '参考图片', 'uploaded-image', false, '2026-07-02T10:00:00.000Z'),
    folder('folder-uploaded-image-history', '历史图片', 'uploaded-image', false, '2026-07-01T10:00:00.000Z'),
    folder('system-folder-uploaded-audio', '主目录', 'uploaded-audio', true),
  ];
  let assets = [
    videoAsset('asset-brand', '品牌故事视频', rootVideoFolderId, 'Seedance 2.0 Mini', 15.041667),
    videoAsset('asset-tutorial', '教程演示视频', rootVideoFolderId, 'Seedance 2.0'),
    {
      ...videoAsset('asset-product', '产品发布宣传片', productVideoFolderId, 'Seedance 2.0'),
      thumbnailUrl: null,
    },
    uploadedAsset('asset-ref-image', {
      name: '参考商品图',
      type: 'image',
      source: 'uploaded-image',
      folderId: mockUuid('system-folder-uploaded-image'),
      objectKey: 'users/e2e/ref-image.png',
      publicUrl: 'https://cdn.example.com/ref-image.png',
      sizeBytes: 1024,
    }),
    uploadedAsset('asset-ref-last-image', {
      name: '参考收尾图',
      type: 'image',
      source: 'uploaded-image',
      folderId: mockUuid('system-folder-uploaded-image'),
      objectKey: 'users/e2e/ref-last-image.png',
      publicUrl: 'https://cdn.example.com/ref-last-image.png',
      sizeBytes: 1024,
    }),
    uploadedAsset('asset-ref-audio', {
      name: '参考配乐',
      type: 'audio',
      source: 'uploaded-audio',
      folderId: mockUuid('system-folder-uploaded-audio'),
      objectKey: 'users/e2e/ref-audio.mp3',
      publicUrl: 'https://cdn.example.com/ref-audio.mp3',
      sizeBytes: 1024 * 1024,
      durationSeconds: 15.041667,
    }),
  ];
  let generationTasks: Array<ReturnType<typeof job> & Record<string, unknown>> = [job(currentUser.userName, currentUser.email)];
  let featureFlags: MockFeatureFlags = { tiktokAccounts: true, tiktokPublish: true };
  let paymentChannel = {
    enabled: false,
    apiBase: '',
    mchNo: '',
    appId: '',
    hasApiKey: false,
    desktopWayCode: 'ALI_WAP' as const,
    mobileWayCode: 'ALI_WAP' as const,
    updatedAt: null as string | null,
  };
  let paymentLaunchType: 'url' | 'form' = 'url';
  let paymentCreateAttemptStatus: PaymentCreateAttemptStatus = 'ready';
  const paymentCreateIdempotencyKeys: string[] = [];
  let desktopPaymentCodeUrl = mockDesktopAlipayUrl;
  let failPaymentRefreshes = false;
  let failPrivateDataRefreshes = false;
  let failDashboardSummary = false;
  let paymentSyncFailuresRemaining = 0;
  let paymentSyncFinalStatus: PaymentSyncFinalStatus = 'pending';
  let userTicketReadFailuresRemaining = 0;
  let adminTicketReadFailuresRemaining = 0;
  let cursorPageSizeCap: number | null = null;
  let paginationSnapshotFailuresRemaining = 0;
  let plans: MockPlan[] = [
    {
      id: mockUuid('plan-free'),
      name: '免费版',
      nameEn: 'Free',
      code: 'free',
      kind: 'main',
      billing: 'monthly',
      description: '入门体验',
      monthlyPrice: 0,
      yearlyPrice: 0,
      credits: 100,
      assetRetentionDays: 7,
      portraitEntitlements: {
        enabled: true,
        profileLimit: 1,
        activeLimit: 1,
        assetsPerActor: 1,
      },
      storage: '1GB',
      tiktokAccounts: '1',
      features: [
        { text: 'AI 视频生成', enabled: true },
        { text: '数字资产管理', enabled: true },
      ],
      recommendation: null,
      iconKey: 'zap',
      ctaLabel: '当前套餐',
      status: 'active',
      landingVisible: true,
      subscribers: 1,
      revenue: 0,
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-30T10:00:00.000Z',
    },
  ];
  let announcements: MockAnnouncement[] = [
    announcement('ann-1', '系统公告', '欢迎使用 Lindyson。', true, '2026-06-30T10:00:00.000Z'),
    announcement('ann-2', '置顶维护公告', '维护窗口会提前通知。', true, '2026-06-30T09:30:00.000Z'),
    announcement('ann-3', '置顶规则公告', '平台规则更新会同步展示。', true, '2026-06-30T09:00:00.000Z'),
    announcement('ann-4', 'AI 队列公告', '生成队列已完成升级。', false, '2026-06-30T08:30:00.000Z'),
    announcement('ann-5', '资产整理公告', '数字资产支持批量整理。', false, '2026-06-30T08:00:00.000Z'),
    announcement('ann-6', '后台完整列表专属公告', '这条公告用于验证后台读取完整列表。', false, '2026-06-30T07:30:00.000Z'),
  ];
  let orders = [
    order('order-1', currentUser.userName, currentUser.email, '免费版', 0, 'paid'),
  ];
  let creditLedger = [
    ledger(currentUser.userName, currentUser.email),
  ];
  let tickets = [
    ticket('ticket-1', '生成问题咨询', currentUser.userName, currentUser.email),
  ];
  const ticketMessages = new Map<string, ReturnType<typeof ticketMessage>[]>([
    [mockUuid('ticket-1'), [
      ticketMessage('message-1', 'ticket-1', 'user', currentUser.userName, currentUser.email, '生成任务状态需要人工协助确认。', '2026-06-30T10:00:00.000Z'),
    ]],
  ]);
  const ticketMessageDelays = new Map<string, number>();
  let invoices = [
    {
      id: mockUuid('invoice-1'),
      orderId: mockUuid('order-1'),
      userId: currentUser.id,
      userName: currentUser.userName,
      email: currentUser.email,
      planName: '免费版',
      amount: 0,
      invoiceTitle: '示例贸易有限公司',
      taxId: '91441900MA00000000',
      receiveEmail: currentUser.email,
      status: 'unissued',
      requestedAt: '2026-06-30T10:00:00.000Z',
      issuedAt: null,
      note: '',
    },
  ];
  const refreshedInvoice = {
    id: mockUuid('invoice-refresh'),
    orderId: mockUuid('order-1'),
    userId: currentUser.id,
    userName: currentUser.userName,
    email: currentUser.email,
    planName: '免费版',
    amount: 0,
    invoiceTitle: '刷新后新增发票',
    taxId: '91441900MA11111111',
    receiveEmail: currentUser.email,
    status: 'unissued',
    requestedAt: '2026-06-30T11:30:00.000Z',
    issuedAt: null,
    note: '用于验证后台刷新真实重拉。',
  };
  let consumptionSettings = [
    consumption('cons-video-15-480', 'video', 'Seedance 2.0', 'Seedance 2.0', 15, '480p', 70, true, 85),
    consumption('cons-video-5-480', 'video', 'Seedance 2.0', 'Seedance 2.0', 5, '480p', 15),
    consumption('cons-video-10-480', 'video', 'Seedance 2.0', 'Seedance 2.0', 10, '480p', 30),
    consumption('cons-video-15-720', 'video', 'Seedance 2.0', 'Seedance 2.0', 15, '720p', 80, true, 95),
    consumption('cons-video-5-720', 'video', 'Seedance 2.0', 'Seedance 2.0', 5, '720p', 20),
    consumption('cons-video-10-720', 'video', 'Seedance 2.0', 'Seedance 2.0', 10, '720p', 35),
    consumption('cons-video-fast-10-480', 'video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 10, '480p', 24, true, 30),
    consumption('cons-image-1k', 'image', 'Seedream 5.0 Pro', 'Seedream 5.0 Pro', null, '1K', 14),
    consumption('cons-image-2k', 'image', 'Seedream 5.0 Pro', 'Seedream 5.0 Pro', null, '2K', 28),
  ];
  let videoModelCapabilities: unknown[] = [];
  const apiPackages = [{
    id: mockUuid('pkg-1'),
    packageId: 'Ark_bd2000000789744935106',
    product: 'Doubao-Seedance-2.0-在线推理资源包-1000万 tokens',
    config: 'Seedance 2.0 / 1000万 tokens',
    recognizedModel: 'Seedance 2.0',
    status: 'active',
    totalQuota: 10_000_000,
    remainingQuota: 8_200_000,
    startsAt: '2026-06-01T00:00:00.000Z',
    expiresAt: '2026-12-31T00:00:00.000Z',
  }];
  let apiCostAsOf = '2026-06-30T10:00:00.000Z';
  const apiCostSelection = {
    range: 'month',
    month: '2026-06',
    date: null,
    rangeStart: '2026-06-01',
    rangeEnd: '2026-06-30',
    timezone: 'Asia/Shanghai',
    grain: 'day',
  };
  const apiCostSettlementSummary = {
    rangeStart: '2026-06-01',
    rangeEnd: '2026-06-30',
    timezone: 'Asia/Shanghai',
    coverageStatus: 'complete',
    coverageReason: null,
    usageOriginalAmountCny: '305.773290',
    usagePayableAmountCny: '0.000000',
    usagePaidAmountCny: '0.000000',
    usageUnpaidAmountCny: '0.000000',
    packagePurchaseAmountCny: null,
    packagePurchasePaidAmountCny: null,
    packagePurchaseUnpaidAmountCny: null,
    paygPayableAmountCny: '0.000000',
    listPriceOffsetValueCny: '305.773290',
    listPriceOffsetStatus: 'priced',
    refundAmountCny: '0.000000',
    billingAdjustmentAmountCny: '0.000000',
    netOfficialPayableCny: '0.000000',
    openingPrepaidAssetCny: null,
    acquisitionCostCny: null,
    amortizedCostCny: null,
    openingCatchUpCny: null,
    expiryLossCny: null,
    adjustmentCny: null,
    endingPrepaidAssetCny: null,
    allocationStatus: 'unavailable',
    timeAttributionStatus: 'unavailable',
    timeAttributionReason: '资源包购置成本与消耗归因尚未完成',
  };
  const apiCostAttempts = [{
    id: mockUuid('usage-api-1'),
    taskId: mockUuid('task-api-1'),
    origin: 'generation-task' as const,
    providerTaskId: 'provider-task-api-1',
    attempt: 1,
    userId: currentUser.id,
    userName: currentUser.userName,
    email: currentUser.email,
    provider: 'volcengine-ark',
    model: 'Seedance 2.0',
    resolution: '720p',
    inputClass: 'without-video',
    status: 'completed',
    completionTokens: 12000,
    totalTokens: 12500,
    billableTokens: 12000,
    billableBasis: 'completion_tokens',
    unitPriceCnyPerMillion: '46.000000',
    estimatedCostCny: '0.552000',
    pricingVersion: 'volcengine-seedance-2026-07-10',
    estimateStatus: 'priced',
    usageEvidenceOrigin: 'provider-reported',
    pricingRuleStatus: 'priced',
    reconciliationStatus: 'cannot-reconcile',
    attributionConfidence: 'direct',
    costResolutionStatus: 'recorded',
    costResolutionCaseId: null,
    costResolutionCaseStatus: null,
    costResolutionEvidence: null,
    accountingDate: '2026-06-30',
    providerTerminalAt: '2026-06-30T09:31:00.000Z',
    usageObservedAt: '2026-06-30T09:31:00.000Z',
    createdAt: '2026-06-30T09:30:00.000Z',
    completedAt: '2026-06-30T09:31:00.000Z',
    error: null,
  }];
  apiCostAttempts.push({
    ...apiCostAttempts[0]!,
    id: mockUuid('usage-api-2'),
    taskId: mockUuid('task-api-2'),
    providerTaskId: 'provider-task-api-2',
    completionTokens: null,
    totalTokens: null,
    billableTokens: null,
    billableBasis: 'unavailable',
    unitPriceCnyPerMillion: null,
    estimatedCostCny: null,
    pricingVersion: null,
    estimateStatus: 'missing-usage',
    usageEvidenceOrigin: 'unavailable',
    pricingRuleStatus: 'rule-missing',
    attributionConfidence: 'unallocated',
    costResolutionStatus: 'pending-final-bill',
    costResolutionCaseId: mockUuid('zero-cost-case-api-2'),
    costResolutionCaseStatus: 'open',
    costResolutionEvidence: {
      reason: '历史失败回执已过查询期',
      currentBillResidualTokens: 0,
      currentBillResidualCostCny: '0.000000',
    },
    createdAt: '2026-06-30T08:30:00.000Z',
    completedAt: '2026-06-30T08:31:00.000Z',
    providerTerminalAt: '2026-06-30T08:31:00.000Z',
    usageObservedAt: '2026-06-30T08:31:00.000Z',
  });
  const apiCostTasks = [{
    id: mockUuid('task-api-1'),
    taskId: mockUuid('task-api-1'),
    userId: currentUser.id,
    userName: currentUser.userName,
    email: currentUser.email,
    model: 'Seedance 2.0',
    priceVersions: ['volcengine-seedance-2026-07-10'],
    status: 'completed',
    resolution: '720p',
    configuredCredits: 80,
    reservedCredits: 80,
    settledCredits: 80,
    refundedCredits: 0,
    creditStatus: 'settled',
    attemptCount: 2,
    billableTokens: 12_000,
    estimatedCostCny: '0.552000',
    estimateCompleteness: 'complete',
    costFinalized: true,
    costResolutionStatus: 'recorded',
    costResolutionCaseId: null,
    missingUsageAttempts: 0,
    unpricedAttempts: 0,
    createdAt: '2026-06-30T09:30:00.000Z',
    completedAt: '2026-06-30T09:31:00.000Z',
  }];
  apiCostTasks.push({
    id: mockUuid('task-api-2'),
    taskId: mockUuid('task-api-2'),
    userId: users[1]!.id,
    userName: users[1]!.userName,
    email: users[1]!.email,
    model: 'Seedance 2.0 Fast',
    priceVersions: [],
    status: 'failed',
    resolution: '720p',
    configuredCredits: 35,
    reservedCredits: 35,
    settledCredits: 0,
    refundedCredits: 35,
    creditStatus: 'refunded',
    attemptCount: 2,
    billableTokens: 0,
    estimatedCostCny: '0.000000',
    estimateCompleteness: 'unavailable',
    costFinalized: false,
    costResolutionStatus: 'pending-final-bill',
    costResolutionCaseId: mockUuid('zero-cost-case-api-2'),
    missingUsageAttempts: 1,
    unpricedAttempts: 0,
    createdAt: '2026-06-30T08:30:00.000Z',
    completedAt: '2026-06-30T08:31:00.000Z',
  });
  const apiCostUsers = [{
    id: currentUser.id,
    userId: currentUser.id,
    name: currentUser.userName,
    email: currentUser.email,
    taskCount: 1,
    operationalCallCount: 3,
    successfulTasks: 1,
    failedTasks: 0,
    canceledTasks: 0,
    settledCredits: 80,
    refundedCredits: 0,
    billableTokens: 12_000,
    estimatedCostCny: '0.552000',
    businessEstimatedCostCny: '0.552000',
    operationalEstimatedCostCny: '0.000000',
    knownAccountCostCny: '0.552000',
    operationalUnpricedCallCount: 0,
    estimateCompleteness: 'complete',
    incompleteTaskCount: 0,
    averageTaskCostCny: '0.552000',
    lastTaskAt: '2026-06-30T09:30:00.000Z',
    lastActivityAt: '2026-06-30T10:00:00.000Z',
  }, {
    id: users[1]!.id,
    userId: users[1]!.id,
    name: users[1]!.userName,
    email: users[1]!.email,
    taskCount: 1,
    operationalCallCount: 0,
    successfulTasks: 0,
    failedTasks: 1,
    canceledTasks: 0,
    settledCredits: 0,
    refundedCredits: 35,
    billableTokens: 0,
    estimatedCostCny: '0.000000',
    businessEstimatedCostCny: '0.000000',
    operationalEstimatedCostCny: '0.000000',
    knownAccountCostCny: '0.000000',
    operationalUnpricedCallCount: 0,
    estimateCompleteness: 'unavailable',
    incompleteTaskCount: 1,
    averageTaskCostCny: '0.000000',
    lastTaskAt: '2026-06-30T08:30:00.000Z',
    lastActivityAt: '2026-06-30T08:30:00.000Z',
  }];
  const apiCostReconciliation = [{
    id: mockUuid('api-cost-reconciliation-1'),
    periodStart: '2026-06-30',
    periodEnd: '2026-06-30',
    expenseDate: '2026-06-30',
    billLineType: 'usage',
    model: 'Seedance 2.0',
    resolutionBand: '480p-720p',
    inputClass: 'without-video',
    unitPriceCnyPerMillion: '46.000000',
    currency: 'CNY',
    rawLocalTokens: 8_042_794,
    inferredAdjustmentTokens: 1_184_876,
    adjustedLocalTokens: 9_227_670,
    officialTokens: 9_227_670,
    timingShiftTokens: 0,
    residualTokens: 0,
    rawLocalCostCny: '272.807868',
    inferredAdjustmentCostCny: '32.965422',
    adjustedLocalCostCny: '305.773290',
    officialListEquivalentCostCny: '305.773290',
    timingShiftCostCny: '0.000000',
    rateVarianceCny: null,
    roundingVarianceCny: null,
    residualCostCny: '0.000000',
    matchState: 'adjusted-matched',
    attributionConfidence: 'high',
  }];
  apiCostReconciliation.push({
    ...apiCostReconciliation[0]!,
    id: mockUuid('api-cost-reconciliation-2'),
    periodStart: '2026-06-29',
    periodEnd: '2026-06-29',
    expenseDate: '2026-06-29',
  });
  const apiCostSettlementItems = [{
    id: 'api-cost-settlement-usage-1',
    sourceDetailKey: 'Detail-e2e-1',
    billPeriod: '2026-06',
    expenseDate: '2026-06-30',
    billLineType: 'usage',
    model: 'Seedance 2.0',
    instanceNo: null,
    packageId: 'Ark_bd2000000789744935106',
    originalAmountCny: '305.773290',
    preferentialAmountCny: '0.000000',
    discountAmountCny: '305.773290',
    couponAmountCny: '0.000000',
    payableAmountCny: '0.000000',
    paidAmountCny: '0.000000',
    unpaidAmountCny: '0.000000',
    currency: 'CNY',
    paymentStatus: 'zero',
    acquisitionLinkStatus: 'not-applicable',
    isFinal: false,
  }];
  apiCostSettlementItems.push({
    ...apiCostSettlementItems[0]!,
    id: 'api-cost-settlement-usage-2',
    sourceDetailKey: 'Detail-e2e-2',
    expenseDate: '2026-06-29',
  });
  const apiCostDashboard = {
    asOf: apiCostAsOf,
    selection: apiCostSelection,
    coverage: {
      local: { start: '2026-06-01', end: '2026-06-30', status: 'complete', reason: null },
      official: { start: '2026-06-01', end: '2026-06-30', status: 'complete', reason: null },
      comparable: { start: '2026-06-01', end: '2026-06-30', status: 'complete', reason: null },
      excludedPeriods: [],
    },
    currentState: {
      capturedAt: apiCostAsOf,
      balanceSnapshotAt: apiCostAsOf,
      packageSnapshotAt: apiCostAsOf,
      historicalFilterAppliedToAccount: false,
      historicalFilterAppliedToPackages: false,
      historicalFilterAppliedToPricing: false,
    },
    combinedStatus: {
      billState: 'provisional',
      matchState: 'adjusted-matched',
      coverageState: 'complete',
      label: '出账中 · 经调整后对齐 · 覆盖完整',
    },
    books: {
      usage: {
        rawLocalTokens: 8_042_794,
        inferredAdjustmentTokens: 1_184_876,
        adjustedLocalTokens: 9_227_670,
        officialTokens: 9_227_670,
        rawTokenDelta: 1_184_876,
        explainedTokenDelta: 1_184_876,
        timingShiftTokens: 0,
        residualTokens: 0,
        rawCoveragePercent: 87.16,
        adjustedCoveragePercent: 100,
      },
      valuation: {
        localEstimateCompleteness: 'partial',
        officialEstimateCompleteness: 'complete',
        rawLocalCostCny: '272.807868',
        inferredAdjustmentCostCny: '32.965422',
        adjustedLocalCostCny: '305.773290',
        officialListEquivalentCostCny: '305.773290',
        rawCostDeltaCny: '32.965422',
        explainedCostDeltaCny: '32.965422',
        timingShiftCostCny: '0.000000',
        rateVarianceCny: null,
        roundingVarianceCny: null,
        residualCostCny: '0.000000',
      },
      settlement: apiCostSettlementSummary,
    },
    account: {
      provider: 'volcengine-ark', currency: 'CNY', availableBalanceCny: '0.000000', cashBalanceCny: '0.000000',
      frozenAmountCny: '0.000000', arrearsBalanceCny: '0.000000', creditLimitCny: '0.000000',
      syncedAt: '2026-06-30T10:00:00.000Z', status: 'fresh',
    },
    sync: {
      status: 'normal', stale: false, lastSyncedAt: '2026-06-30T10:00:00.000Z',
      items: ['balance', 'bill', 'packages'].map(kind => ({
        kind, status: 'fresh', lastAttemptAt: '2026-06-30T10:00:00.000Z',
        lastSuccessAt: '2026-06-30T10:00:00.000Z', dataThrough: '2026-06-30', reason: null,
      })),
    },
    summary: {
      rangeStart: '2026-06-01', rangeEnd: '2026-06-30', timezone: 'Asia/Shanghai', billStatus: 'provisional',
      localBillableTokens: 8_042_794, localEstimatedCostCny: '272.807868', localEstimateCompleteness: 'partial',
      localUnpricedAttempts: 1, localUnpricedTokens: 12_000, localUnavailableUsageAttempts: 1,
      officialBillableTokens: 9_227_670,
      officialUnpricedRows: 0, officialUnpricedTokens: 0,
      officialListEquivalentCostCny: '305.773290', officialOriginalBillAmountCny: '0.000000',
      officialPayableAmountCny: '0.000000', officialPaidAmountCny: '0.000000', officialUnpaidAmountCny: '0.000000',
      officialDiscountAmountCny: '305.773290', resourcePackageDeductedTokens: 9_227_670,
      todayEstimatedCostCny: '0.552000', todayEstimateCompleteness: 'partial', todayUnpricedAttempts: 1,
      todayUnavailableUsageAttempts: 1,
      monthEstimatedCostCny: '272.807868', monthEstimateCompleteness: 'partial', monthUnpricedAttempts: 1,
      monthUnavailableUsageAttempts: 1, tokenDelta: 1_184_876,
      costDeltaCny: '32.965422', localCostUnderstatementPercent: 10.781,
      allAccountOfficialDailyAverageCny: '0.000000', seedanceOfficialDailyAverageCny: '0.000000',
      seedanceListDailyAverageCny: '23.520000', noPackageProjectedDailyCostCny: '23.520000', noPackageRunwayDays: 0,
      noPackageProjectionCoveredDays: 7, noPackageProjectionUnpricedRows: 0, noPackageProjectionUnpricedTokens: 0,
      noPackageProjectionStatus: 'complete',
    },
    operations: {
      taskCount: 2,
      userCount: 2,
      settledCredits: 80,
      heldCredits: 0,
      refundedCredits: 35,
      estimatedCostCny: '0.552000',
      businessEstimatedCostCny: '0.552000',
      operationalCallCount: 3,
      operationalEstimatedCostCny: '0.000000',
      operationalUnpricedCallCount: 0,
      adminDirectUsageCount: 3,
      adminDirectEstimatedCostCny: '0.000000',
      knownAccountCostCny: '0.552000',
      estimateCompleteness: 'partial',
      incompleteTaskCount: 1,
      unresolvedTaskCount: 0,
      pendingFinalBillTaskCount: 1,
      approvedZeroCostTaskCount: 0,
      officialEquivalentCostCny: '0.552000',
      differenceCny: '0.000000',
      officialPayableCny: '0.000000',
      reconciliationStatus: 'incomplete',
      models: [{
        id: 'Seedance 2.5',
        model: 'Seedance 2.5',
        priceVersions: [],
        taskCount: 0,
        operationalCallCount: 0,
        settledCredits: 0,
        heldCredits: 0,
        refundedCredits: 0,
        estimatedCostCny: '0.000000',
        businessEstimatedCostCny: '0.000000',
        operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: '0.000000',
        operationalUnpricedCallCount: 0,
        estimateCompleteness: 'complete',
        incompleteTaskCount: 0,
        averageTaskCostCny: null,
      }, {
        id: 'Seedance 2.0',
        model: 'Seedance 2.0',
        priceVersions: ['volcengine-seedance-2026-07-10'],
        taskCount: 1,
        operationalCallCount: 3,
        settledCredits: 80,
        heldCredits: 0,
        refundedCredits: 0,
        estimatedCostCny: '0.552000',
        businessEstimatedCostCny: '0.552000',
        operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: '0.552000',
        operationalUnpricedCallCount: 0,
        estimateCompleteness: 'complete',
        incompleteTaskCount: 0,
        averageTaskCostCny: '0.552000',
      }, {
        id: 'Seedance 2.0 Fast',
        model: 'Seedance 2.0 Fast',
        priceVersions: [],
        taskCount: 1,
        operationalCallCount: 0,
        settledCredits: 0,
        heldCredits: 0,
        refundedCredits: 35,
        estimatedCostCny: '0.000000',
        businessEstimatedCostCny: '0.000000',
        operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: '0.000000',
        operationalUnpricedCallCount: 0,
        estimateCompleteness: 'unavailable',
        incompleteTaskCount: 1,
        averageTaskCostCny: '0.000000',
      }, {
        id: 'Seedance 2.0 Mini',
        model: 'Seedance 2.0 Mini',
        priceVersions: [],
        taskCount: 0,
        operationalCallCount: 0,
        settledCredits: 0,
        heldCredits: 0,
        refundedCredits: 0,
        estimatedCostCny: '0.000000',
        businessEstimatedCostCny: '0.000000',
        operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: '0.000000',
        operationalUnpricedCallCount: 0,
        estimateCompleteness: 'complete',
        incompleteTaskCount: 0,
        averageTaskCostCny: null,
      }],
    },
    models: [{
      id: 'volcengine-ark-1', provider: 'volcengine-ark', model: 'Seedance 2.0', billableTokens: 8_042_794,
      estimatedCostCny: '272.807868', officialBillableTokens: 9_227_670, officialListEquivalentCostCny: '305.773290',
      officialPayableAmountCny: '0.000000', attemptCount: 11, taskCount: 11, successfulVideoCount: 10,
      successfulTasks: 10, failedTasks: 1, failedBillableTokens: 324900,
      failedEstimatedCostCny: '12.021300', averageSuccessfulTaskCostCny: '26.078657',
      costPerSuccessfulVideoCny: '27.280787', successfulOutputSeconds: 100,
      costPerOutputSecondCny: '2.728079', costSharePercent: 100, withoutVideoCostCny: '255.848268',
      withVideoCostCny: '16.959600', unpricedTasks: 1, unavailableUsageAttempts: 1, estimateCompleteness: 'partial',
    }],
    daily: [{
      day: '2026-06-30', localBillableTokens: 8_042_794, localEstimatedCostCny: '272.807868',
      localUnpricedAttempts: 1, localUnavailableUsageAttempts: 1, localEstimateCompleteness: 'partial',
      officialBillableTokens: 9_227_670, officialListEquivalentCostCny: '305.773290', officialPayableAmountCny: '0.000000',
    }],
    pricingRules: [
      { version: 'volcengine-seedance-2026-07-10', effectiveFrom: '2026-01-28T00:00:00+08:00', model: 'Seedance 2.0', resolution: '480p-720p', inputClass: 'without-video', unitPriceCnyPerMillion: '46.000000', platformAvailable: true },
      { version: 'volcengine-seedance-2026-07-10', effectiveFrom: '2026-01-28T00:00:00+08:00', model: 'Seedance 2.0', resolution: '480p-720p', inputClass: 'with-video', unitPriceCnyPerMillion: '28.000000', platformAvailable: true },
    ],
    packages: apiPackages,
  };
  const apiCostSelectionForRequest = (requestUrl: URL) => {
    const requestedRange = requestUrl.searchParams.get('range');
    const from = requestUrl.searchParams.get('from');
    const to = requestUrl.searchParams.get('to');
    if (requestedRange === 'custom' || (!requestedRange && from && to)) {
      return {
        range: 'custom',
        month: null,
        date: null,
        rangeStart: from ?? '2026-06-01',
        rangeEnd: to ?? '2026-06-30',
        timezone: 'Asia/Shanghai',
        grain: 'day',
      };
    }
    if (requestedRange === 'date') {
      const selectedDate = requestUrl.searchParams.get('date') ?? '2026-06-30';
      return {
        range: 'date',
        month: null,
        date: selectedDate,
        rangeStart: selectedDate,
        rangeEnd: selectedDate,
        timezone: 'Asia/Shanghai',
        grain: 'day',
      };
    }
    if (requestedRange === 'all') return apiCostSelection;
    const selectedMonth = requestUrl.searchParams.get('month') ?? '2026-07';
    const [year,monthNumber] = selectedMonth.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
    return {
      range: 'month',
      month: selectedMonth,
      date: null,
      rangeStart: `${selectedMonth}-01`,
      rangeEnd: `${selectedMonth}-${String(lastDay).padStart(2, '0')}`,
      timezone: 'Asia/Shanghai',
      grain: 'day',
    };
  };
  const apiCostDashboardForRequest = (requestUrl: URL) => {
    const selection = apiCostSelectionForRequest(requestUrl);
    const coverageWindow = { start: selection.rangeStart, end: selection.rangeEnd, status: 'complete', reason: null };
    return {
      ...apiCostDashboard,
      selection,
      coverage: {
        ...apiCostDashboard.coverage,
        local: coverageWindow,
        official: coverageWindow,
        comparable: coverageWindow,
      },
      books: {
        ...apiCostDashboard.books,
        settlement: {
          ...apiCostDashboard.books.settlement,
          rangeStart: selection.rangeStart,
          rangeEnd: selection.rangeEnd,
        },
      },
      summary: {
        ...apiCostDashboard.summary,
        rangeStart: selection.rangeStart,
        rangeEnd: selection.rangeEnd,
      },
    };
  };
  const apiCostOverviewForRequest = (requestUrl: URL) => {
    const dashboard = apiCostDashboardForRequest(requestUrl);
    const { models, ...operations } = dashboard.operations;
    const selectedModel = requestUrl.searchParams.get('model');
    const lastSyncedAt = apiCostSyncRevision > 0
      ? '2026-06-30T10:00:01.000Z'
      : dashboard.sync.lastSyncedAt;
    return {
      asOf: dashboard.asOf,
      selection: dashboard.selection,
      account: dashboard.account,
      sync: { ...dashboard.sync, lastSyncedAt },
      operations,
      models: selectedModel ? models.filter(item => item.model === selectedModel) : models,
    };
  };
  const imageCostUsers = users.slice(0, 2).map((user, index) => ({
    id: user.id,
    userId: user.id,
    userName: user.userName,
    email: user.email,
    taskCount: 1,
    completedTaskCount: 1,
    failedTaskCount: 0,
    settledCredits: 14,
    refundedCredits: 0,
    referenceImageCount: index + 1,
    outputPixels: 1_048_576,
    knownCostTaskCount: 1,
    missingEvidenceTaskCount: 0,
    knownCostCny: '0.200000',
    operationalCallCount: 0,
    operationalUnpricedCallCount: 0,
    businessEstimatedCostCny: '0.200000',
    operationalEstimatedCostCny: '0.000000',
    knownAccountCostCny: '0.200000',
    estimateCompleteness: 'complete' as const,
    lastTaskAt: `2026-06-30T09:${20 - index}:00.000Z`,
    lastActivityAt: `2026-06-30T09:${20 - index}:00.000Z`,
  }));
  const imageCostTasks = users.slice(0, 2).map((user, index) => {
    const id = mockUuid(`image-cost-task-${index + 1}`);
    return {
      id,
      taskId: id,
      userId: user.id,
      userName: user.userName,
      email: user.email,
      model: 'Seedream 5.0 Pro',
      status: 'completed' as const,
      creditStatus: 'settled' as const,
      reservedCredits: 14,
      settledCredits: 14,
      refundedCredits: 0,
      attemptCount: 1,
      knownUsageCount: 1,
      missingUsageCount: 0,
      evidenceStatus: 'known' as const,
      referenceImageCount: index + 1,
      additionalReferenceImageCount: index,
      outputWidth: 1024,
      outputHeight: 1024,
      outputPixels: 1_048_576,
      outputTier: 'small' as const,
      referenceUnitPriceCny: '0.010000',
      referencePriceCny: index === 0 ? '0.000000' : '0.010000',
      outputPixelThreshold: 2_000_000,
      smallOutputPriceCny: '0.200000',
      largeOutputPriceCny: '0.400000',
      outputPriceCny: '0.200000',
      estimatedCostCny: index === 0 ? '0.200000' : '0.210000',
      pricingStatus: 'priced' as const,
      priceVersion: 'volcengine-seedream-2026-06',
      pricingSourceUrl: 'https://www.volcengine.com/docs/82379/1544106',
      providerOperationId: `image-operation-${index + 1}`,
      providerRequestId: `image-request-${index + 1}`,
      requestEvidenceStatus: 'provider-id' as const,
      generatedImages: 1,
      outputTokens: 1,
      totalTokens: 1,
      error: null,
      createdAt: `2026-06-30T09:${20 - index}:00.000Z`,
      completedAt: `2026-06-30T09:${21 - index}:00.000Z`,
    };
  });
  const imageCostOverviewForRequest = (requestUrl: URL) => ({
    asOf: apiCostAsOf,
    selection: apiCostSelectionForRequest(requestUrl),
    summary: {
      taskCount: 2,
      userCount: 2,
      completedTaskCount: 2,
      failedTaskCount: 0,
      canceledTaskCount: 0,
      settledCredits: 28,
      heldCredits: 0,
      refundedCredits: 0,
      referenceImageCount: 3,
      outputPixels: 2_097_152,
      knownCostTaskCount: 2,
      missingEvidenceTaskCount: 0,
      knownCostCny: '0.410000',
      operationalCallCount: 0,
      operationalUnpricedCallCount: 0,
      businessEstimatedCostCny: '0.410000',
      operationalEstimatedCostCny: '0.000000',
      knownAccountCostCny: '0.410000',
      estimateCompleteness: 'complete' as const,
    },
    pricing: {
      model: 'Seedream 5.0 Pro' as const,
      modelId: 'doubao-seedream-5-0-pro-260628' as const,
      currency: 'CNY' as const,
      firstReferenceImageIncluded: 1 as const,
      additionalReferenceUnitPriceCny: '0.010000',
      outputPixelThreshold: 2_000_000,
      smallOutputPriceCny: '0.200000',
      largeOutputPriceCny: '0.400000',
      priceVersion: 'volcengine-seedream-2026-06',
      pricingSourceUrl: 'https://www.volcengine.com/docs/82379/1544106',
      disclaimer: '仅用于 E2E 验证的不可变图片价格证据。',
    },
  });
  const multimodalUsers = [{
    id: currentUser.id,
    userId: currentUser.id,
    name: currentUser.userName,
    email: currentUser.email,
    models: ['doubao-seed-2-0-lite-260428'],
    analysisCount: 2,
    batchCount: 1,
    settledCredits: 20,
    refundedCredits: 0,
    incompleteOperationCount: 0,
    historicalEvidenceOperationCount: 0,
    historicalPricedOperationCount: 0,
    operationalCallCount: 0,
    operationalUnpricedCallCount: 0,
    businessEstimatedCostCny: '0.025400',
    operationalEstimatedCostCny: '0.000000',
    knownAccountCostCny: '0.025400',
    knownInputTokens: 12_400,
    knownCachedInputTokens: 2_100,
    knownOutputTokens: 3_200,
    knownCostCny: '0.025400',
    providerRequestCount: 5,
    reconciledZeroRequestCount: 0,
    unknownUsageRequestCount: 0,
    unpricedRequestCount: 0,
    estimateCompleteness: 'complete',
    lastActivityAt: '2026-06-30T09:20:00.000Z',
  }, {
    id: users[1]!.id,
    userId: users[1]!.id,
    name: users[1]!.userName,
    email: users[1]!.email,
    models: ['doubao-seed-2-0-lite-260428'],
    analysisCount: 1,
    batchCount: 0,
    settledCredits: 0,
    refundedCredits: 0,
    incompleteOperationCount: 0,
    historicalEvidenceOperationCount: 0,
    historicalPricedOperationCount: 1,
    operationalCallCount: 0,
    operationalUnpricedCallCount: 0,
    businessEstimatedCostCny: '0.000912',
    operationalEstimatedCostCny: '0.000000',
    knownAccountCostCny: '0.000912',
    knownInputTokens: 800,
    knownCachedInputTokens: 0,
    knownOutputTokens: 120,
    knownCostCny: '0.000912',
    providerRequestCount: 0,
    reconciledZeroRequestCount: 0,
    unknownUsageRequestCount: 0,
    unpricedRequestCount: 0,
    estimateCompleteness: 'complete',
    lastActivityAt: '2026-06-30T08:20:00.000Z',
  }];
  const multimodalOperations = [{
    id: mockUuid('multimodal-operation-analysis'),
    operationType: 'analysis',
    runId: mockUuid('multimodal-run-analysis'),
    batchId: null,
    userId: currentUser.id,
    userName: currentUser.userName,
    email: currentUser.email,
    provider: 'volcengine-ark',
    model: 'doubao-seed-2-0-lite-260428',
    status: 'completed',
    isFree: null,
    settledCredits: 0,
    refundedCredits: 0,
    incompleteRequestCount: 0,
    usageEvidence: 'ledger',
    priceVersion: null,
    pricingSourceUrl: null,
    failureReason: null,
    createdAt: '2026-06-30T09:10:00.000Z',
    completedAt: '2026-06-30T09:11:00.000Z',
    knownInputTokens: 4_200,
    knownCachedInputTokens: 600,
    knownOutputTokens: 1_100,
    knownCostCny: '0.008400',
    providerRequestCount: 1,
    reconciledZeroRequestCount: 0,
    unknownUsageRequestCount: 0,
    unpricedRequestCount: 0,
    estimateCompleteness: 'complete',
  }, {
    id: mockUuid('multimodal-operation-batch'),
    operationType: 'plan-batch',
    runId: mockUuid('multimodal-run-batch'),
    batchId: mockUuid('multimodal-batch'),
    userId: currentUser.id,
    userName: currentUser.userName,
    email: currentUser.email,
    provider: 'volcengine-ark',
    model: 'doubao-seed-2-0-lite-260428',
    status: 'completed',
    isFree: false,
    settledCredits: 20,
    refundedCredits: 0,
    incompleteRequestCount: 0,
    usageEvidence: 'ledger',
    priceVersion: null,
    pricingSourceUrl: null,
    failureReason: null,
    createdAt: '2026-06-30T09:20:00.000Z',
    completedAt: '2026-06-30T09:21:00.000Z',
    knownInputTokens: 8_200,
    knownCachedInputTokens: 1_500,
    knownOutputTokens: 2_100,
    knownCostCny: '0.017000',
    providerRequestCount: 4,
    reconciledZeroRequestCount: 0,
    unknownUsageRequestCount: 0,
    unpricedRequestCount: 0,
    estimateCompleteness: 'complete',
  }, {
    id: mockUuid('multimodal-operation-history'),
    operationType: 'analysis',
    runId: mockUuid('multimodal-run-history'),
    batchId: null,
    userId: users[1]!.id,
    userName: users[1]!.userName,
    email: users[1]!.email,
    provider: 'volcengine-ark',
    model: 'doubao-seed-2-0-lite-260428',
    status: 'archived',
    isFree: null,
    settledCredits: 0,
    refundedCredits: 0,
    incompleteRequestCount: 0,
    usageEvidence: 'historical-aggregate-priced',
    priceVersion: 'volcengine-list-2026-07-23',
    pricingSourceUrl: 'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
    failureReason: null,
    createdAt: '2026-06-30T08:20:00.000Z',
    completedAt: '2026-06-30T08:21:00.000Z',
    knownInputTokens: 800,
    knownCachedInputTokens: 0,
    knownOutputTokens: 120,
    knownCostCny: '0.000912',
    providerRequestCount: 0,
    reconciledZeroRequestCount: 0,
    unknownUsageRequestCount: 0,
    unpricedRequestCount: 0,
    estimateCompleteness: 'complete',
  }];
  const multimodalOverviewForRequest = (requestUrl: URL) => ({
    asOf: apiCostAsOf,
    selection: apiCostSelectionForRequest(requestUrl),
    account: apiCostDashboard.account,
    summary: {
      analysisCount: 3,
      batchCount: 1,
      userCount: 2,
      settledCredits: 20,
      refundedCredits: 0,
      incompleteOperationCount: 0,
      historicalEvidenceOperationCount: 0,
      historicalPricedOperationCount: 5,
      operationalCallCount: 0,
      operationalUnpricedCallCount: 0,
      businessEstimatedCostCny: '1.019045',
      operationalEstimatedCostCny: '0.000000',
      knownAccountCostCny: '1.019045',
      knownInputTokens: 13_200,
      knownCachedInputTokens: 2_100,
      knownOutputTokens: 3_320,
      knownCostCny: '1.019045',
      providerRequestCount: 5,
      reconciledZeroRequestCount: 0,
      unknownUsageRequestCount: 0,
      unpricedRequestCount: 0,
      estimateCompleteness: 'complete',
    },
    models: [{
      id: 'volcengine-ark:doubao-seed-2-0-lite-260428',
      provider: 'volcengine-ark',
      model: 'doubao-seed-2-0-lite-260428',
      analysisCount: 3,
      batchCount: 1,
      userCount: 2,
      settledCredits: 20,
      refundedCredits: 0,
      incompleteOperationCount: 0,
      historicalEvidenceOperationCount: 0,
      historicalPricedOperationCount: 5,
      operationalCallCount: 0,
      operationalUnpricedCallCount: 0,
      businessEstimatedCostCny: '1.019045',
      operationalEstimatedCostCny: '0.000000',
      knownAccountCostCny: '1.019045',
      pricingSources: [{
        priceVersion: 'volcengine-list-2026-07-23',
        sourceUrl: 'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
      }],
      knownInputTokens: 13_200,
      knownCachedInputTokens: 2_100,
      knownOutputTokens: 3_320,
      knownCostCny: '1.019045',
      providerRequestCount: 5,
      reconciledZeroRequestCount: 0,
      unknownUsageRequestCount: 0,
      unpricedRequestCount: 0,
      estimateCompleteness: 'complete',
    }],
  });
  const publicUploadSession = (session: MockUploadSessionRecord) => ({
    id: session.id,
    status: session.status,
    processingStage: session.processingStage,
    progress: session.progress,
    attempt: session.attempt,
    filename: session.filename,
    source: session.source,
    asset: session.asset ? assetCard(session.asset) : null,
    error: null,
    canRetry: false,
    expiresAt: session.expiresAt,
    updatedAt: session.updatedAt,
  });

  const promptWizardEvidenceGraphFor = (imageAssetIds: string[]) => ({
    version: 1,
    productFamily: 'consumer-electronics',
    evidences: [
      {
        id: 'visible-appearance-1',
        type: 'appearance',
        text: '参考图片可见黑色哑光机身与椭圆耳罩',
        sourceImageAssetIds: imageAssetIds,
        visibleRegion: '产品正面与耳罩区域',
        status: 'visible',
        proofActions: ['手部拿起耳机并缓慢转动展示外观'],
      },
      {
        id: 'visible-structure-1',
        type: 'structure',
        text: '头梁与耳罩连接处可折叠',
        sourceImageAssetIds: imageAssetIds,
        visibleRegion: '头梁转轴区域',
        status: 'visible',
        proofActions: ['近景展示折叠与展开动作'],
      },
      {
        id: 'pending-package-1',
        type: 'other',
        text: '当前图片没有包装或拆封过程',
        sourceImageAssetIds: imageAssetIds,
        visibleRegion: '整张参考图片',
        status: 'needs-confirmation',
        proofActions: [],
      },
    ],
    reliableEvidenceIds: ['visible-appearance-1', 'visible-structure-1'],
    pendingEvidenceIds: ['pending-package-1'],
    forbiddenAssumptionIds: [],
    directionAssessments: [
      'ugc',
      'problem-solution',
      'unboxing-review',
      'feature-test',
      'pain-comparison',
      'lifestyle',
      'cinematic-brand',
      'asmr-detail',
    ].map(direction => ({
      direction,
      availability: direction === 'unboxing-review' ? 'unavailable' : 'available',
      reason: direction === 'unboxing-review' ? '参考图片未确认包装素材' : '可由可靠产品证据支持',
      missingRequirements: direction === 'unboxing-review' ? ['包装素材'] : [],
    })),
  });

  const promptWizardUseDirectionSetFor = (run: MockPromptWizardRun) => {
    promptWizardUseDirectionSetSequence += 1;
    const setOrdinal = promptWizardUseDirectionSetSequence;
    const makeScene = (directionOrdinal: number, sceneOrdinal: number, title: string, environment: string, mainAction: string) => ({
      id: mockUuid(`prompt-wizard-use-scene-${setOrdinal}-${directionOrdinal}-${sceneOrdinal}`),
      title,
      environment,
      mainAction,
    });
    const firstScenes = [
      makeScene(1, 1, '通勤出发前', '玄关收纳台与打开的随身包', '双手折叠耳罩并将耳机放入随身包'),
      makeScene(1, 2, '办公桌收纳', '自然窗光下的办公桌', '折叠耳机并放入桌边收纳袋'),
      makeScene(1, 3, '居家整理', '卧室衣柜旁的收纳区', '展开耳机后再次折叠并整齐收好'),
    ];
    const directions = [
      {
        id: mockUuid(`prompt-wizard-use-direction-${setOrdinal}-1`),
        title: '通勤折叠收纳',
        useMoment: '出门前把耳机放入随身包',
        audienceNeed: '减少头戴式耳机在通勤包中占用的空间',
        purchaseReason: '可折叠结构便于收纳',
        proofAction: '近景连续展示耳罩折叠并放入随身包',
        evidenceIds: ['visible-structure-1'],
        sceneOptions: firstScenes,
        recommendedSceneId: firstScenes[0]!.id,
        appearanceMode: 'hands-only',
        internalDirection: 'problem-solution',
        requiredAssets: ['随身包'],
      },
      {
        id: mockUuid(`prompt-wizard-use-direction-${setOrdinal}-2`),
        title: '桌面结构展示',
        useMoment: '挑选日常耳机时检查外观与结构',
        audienceNeed: '快速看清耳罩、头梁与转轴细节',
        purchaseReason: '哑光机身与折叠结构清晰可见',
        proofAction: '手部缓慢转动产品并完成一次折叠展开',
        evidenceIds: ['visible-appearance-1', 'visible-structure-1'],
        sceneOptions: [
          makeScene(2, 1, '自然光桌面', '靠窗的简洁木质桌面', '手部转动耳机并展示转轴'),
          makeScene(2, 2, '纯色产品台', '深灰纯色背景的产品展示台', '低机位环绕展示哑光耳罩与头梁'),
        ],
        recommendedSceneId: mockUuid(`prompt-wizard-use-scene-${setOrdinal}-2-1`),
        appearanceMode: 'hands-only',
        internalDirection: 'feature-test',
        requiredAssets: [],
      },
      {
        id: mockUuid(`prompt-wizard-use-direction-${setOrdinal}-3`),
        title: '居家佩戴准备',
        useMoment: '开始听音乐前拿起并佩戴耳机',
        audienceNeed: '确认耳罩外形与佩戴步骤是否直观',
        purchaseReason: '椭圆软质耳罩与头梁结构容易辨认',
        proofAction: '双手展开头梁并自然佩戴，保持 Logo 朝向一致',
        evidenceIds: ['visible-appearance-1'],
        sceneOptions: [
          makeScene(3, 1, '卧室书桌', '自然光下的卧室书桌', '拿起耳机、展开头梁并佩戴'),
          makeScene(3, 2, '客厅沙发旁', '安静简洁的客厅边桌', '从边桌拿起耳机并调整耳罩'),
        ],
        recommendedSceneId: mockUuid(`prompt-wizard-use-scene-${setOrdinal}-3-1`),
        appearanceMode: 'person',
        internalDirection: 'lifestyle',
        requiredAssets: ['一名演员'],
      },
    ];
    const useDirectionSet = {
      id: mockUuid(`prompt-wizard-use-direction-set-${setOrdinal}`),
      runId: run.id,
      status: 'completed',
      runRevision: run.revision,
      directions,
      clarificationQuestion: null,
      failureReason: null,
      createdAt: '2026-08-01T01:00:00.000Z',
      completedAt: '2026-08-01T01:00:08.000Z',
    };
    promptWizardUseDirectionSets.set(useDirectionSet.id, useDirectionSet);
    return useDirectionSet;
  };

  const promptWizardV5PlansFor = (
    useDirection: Record<string, any>,
    selectedScene: Record<string, any>,
    targetLanguage: string,
    duration: number,
    batchIndex: number,
  ) => ([0, 1] as const).map(index => {
    const reliable = index === 0;
    const timeline = duration === 5
      ? [[0, 1.2], [1.2, 3.5], [3.5, 5]]
      : duration === 10
        ? [[0, 2], [2, 5], [5, 8], [8, 10]]
        : [[0, 3], [3, 7], [7, 12], [12, 15]];
    const voiceoversZh = reliable
      ? duration === 5
        ? ['看耳机折叠', '转轴证明收纳省空间', '点商品卡下单']
        : ['看这款头戴式耳机立刻折叠', '可见转轴证明收纳更省空间', '通勤携带方便而且不显臃肿', '现在点击商品卡立即下单']
      : duration === 5
        ? ['看耳机展开', '哑光转轴清楚可见', '点商品卡下单']
        : ['看这款头戴式耳机第一秒展开', '哑光机身与转轴直接完成自证', '通勤场景里结构与携带价值都清楚', '现在点击商品卡立即下单'];
    const voiceovers = targetLanguage === '普通话'
      ? voiceoversZh
      : targetLanguage === '西班牙语'
        ? reliable
          ? duration === 5
            ? ['Mira estos auriculares', 'La bisagra prueba su guardado', 'Compra desde la tarjeta']
            : ['Auriculares plegables en acción', 'La bisagra demuestra un guardado compacto', 'Ideales para trayectos sin volumen extra', 'Toca la tarjeta ahora']
          : duration === 5
            ? ['Mira cómo se despliegan', 'La bisagra queda bien visible', 'Compra desde la tarjeta']
            : ['Auriculares revelados en un segundo', 'La bisagra mate demuestra su estructura', 'Funcionan en trayectos sin ocultar detalles', 'Toca la tarjeta ahora']
        : reliable
          ? duration === 5
            ? ['Watch these headphones', 'The hinge proves compact storage', 'Tap product card now']
            : ['Watch these headphones fold now', 'The visible hinge proves compact bag storage', 'They fit commutes with less extra bulk', 'Tap product card now']
          : duration === 5
            ? ['Watch headphones unfold', 'The matte hinge stays clearly visible', 'Tap product card now']
            : ['Watch these headphones unfold now', 'The matte hinge proves the visible structure', 'They fit commutes while details stay clear', 'Tap product card now'];
    const firstAction = reliable
      ? '双手在第一秒折叠耳罩并对准打开的随身包'
      : '耳机从画外滑入，手部立即展开转轴形成结构揭晓';
    const cameraMovement = reliable ? '稳定手部俯拍跟随' : '低机位快速推近后侧向环绕';
    const shots = timeline.map(([startSeconds, endSeconds], shotIndex) => {
      const lastIndex = timeline.length - 1;
      const role = shotIndex === 0
        ? 'hook'
        : shotIndex === lastIndex
          ? 'cta'
          : shotIndex === 1 ? 'proof' : 'resolution';
      return {
        startSeconds,
        endSeconds,
        role,
        location: selectedScene.environment,
        subject: shotIndex === 0
          ? '手部与黑色头戴式耳机'
          : shotIndex === lastIndex
            ? '移动中的手部、产品与随身包'
            : '折叠结构、手部与通勤随身包',
        shotSize: shotIndex === 0 ? '产品近景' : shotIndex === lastIndex ? '动态中景' : '手部中近景',
        action: shotIndex === 0
          ? firstAction
          : shotIndex === 1
            ? '手部持续转动耳罩展示可见转轴，再沿动作方向完成折叠'
            : shotIndex === lastIndex
              ? '手部拉好随身包后再次拿起耳机朝镜头点头示意'
              : '人物边走向通勤出口边将折叠耳机放入随身包',
        cameraMovement: shotIndex === 0
          ? cameraMovement
          : shotIndex === 1
            ? '镜头横移跟随转轴和手部折叠动作'
            : shotIndex === lastIndex
              ? '镜头持续缓慢后拉并在动作点切换景别'
              : '手持跟随人物移动并轻微推进产品近景',
        lightingAndRealism: shotIndex === 0
          ? '自然窗光，保留真实手持呼吸感'
          : '自然环境光随人物与产品移动产生真实变化',
        voiceover: voiceovers[shotIndex],
        voiceoverZh: targetLanguage === '普通话' ? '' : voiceoversZh[shotIndex],
        foley: shotIndex === 0
          ? '转轴轻响与桌面接触声'
          : shotIndex === lastIndex ? '拉链声、脚步声与环境底噪' : '布料摩擦声与转轴轻响',
        editingCue: shotIndex === lastIndex
          ? '在拿起产品和点头动作发生时快速切换景别'
          : '沿连续动作节点切入下一个动态景别',
        evidenceRefs: shotIndex === lastIndex ? ['visible-appearance-1'] : useDirection.evidenceIds,
        productionNote: shotIndex === lastIndex
          ? '结尾不新增可读文字或水印'
          : '保持耳罩、头梁与 Logo 连续一致',
      };
    });
    const prompt = shots.map(shot => {
      const roleLabel = shot.role === 'hook'
        ? '开场钩子'
        : shot.role === 'cta' ? '成交行动提示' : shot.role === 'proof' ? '产品自证' : '场景价值';
      return `【${shot.startSeconds}-${shot.endSeconds}s｜${roleLabel}】\n画面：在${shot.location}中，${shot.action}；${shot.cameraMovement}。\n旁白（${targetLanguage}）：${shot.voiceover}`;
    }).join('\n\n');
    return {
      id: mockUuid(`prompt-wizard-v5-plan-${promptWizardBatchSequence}-${index + 1}`),
      name: `${batchIndex === 0 ? '' : `焕新${batchIndex}·`}${reliable ? '折叠收纳一秒见证' : '转轴揭晓停留实验'}`,
      hook: firstAction,
      narrative: reliable
        ? `从随身包空间问题切入，通过${useDirection.proofAction}证明${useDirection.purchaseReason}`
        : `用突然滑入和结构揭晓制造停留，再以${useDirection.proofAction}完成证据闭环`,
      primaryScene: `${selectedScene.title}：${selectedScene.environment}`,
      cameraAndPacing: cameraMovement,
      differenceTags: reliable ? ['直接自证', '稳定俯拍'] : ['结构揭晓', '快速推近'],
      prompt: `${prompt}\n\n【产品一致性硬约束】\n画面内不新增可读文字、贴纸或水印；参考图片中已有 Logo 与印花必须保持原样。\n材质：可见哑光机身与软质耳罩。\n结构：可折叠头梁、椭圆形耳罩，右耳罩外侧带 Logo。`,
      deliveryVersion: 5,
      variant: reliable ? 'reliable' : 'hook',
      useDirection: {
        id: useDirection.id,
        title: useDirection.title,
        useMoment: useDirection.useMoment,
        audienceNeed: useDirection.audienceNeed,
        purchaseReason: useDirection.purchaseReason,
        proofAction: useDirection.proofAction,
        evidenceIds: useDirection.evidenceIds,
        appearanceMode: useDirection.appearanceMode,
        internalDirection: useDirection.internalDirection,
        requiredAssets: useDirection.requiredAssets,
      },
      selectedScene: {
        id: selectedScene.id ?? null,
        title: selectedScene.title,
        environment: selectedScene.environment,
        mainAction: selectedScene.mainAction,
      },
      shots,
      productionWarnings: ['右侧 Logo 较小，生成时需保持位置与比例一致。'],
    };
  });

  const promptWizardV6PlansFor = (
    voiceoverLanguage: string | undefined,
    duration: number,
    batchIndex: number,
  ) => {
    const audioMode = duration === 5 ? 'sound-design-only' : 'voiceover';
    const roles = [
      {
        role: 'proof-conversion',
        name: '折叠结构自证成交',
        explanation: '用连续折叠动作直接证明商品的可收纳结构，让购买理由可见、可核对。',
        audience: '适合重视通勤收纳与商品结构真实性的人群。',
        purchaseReason: '图片可见的折叠头梁能通过真实动作直接自证。',
        hook: '第一秒把耳罩折叠进随身包，直接回答是否方便携带。',
        sceneTitle: '通勤出发前',
        environment: '自然窗光下的玄关收纳台',
        mainAction: '双手折叠耳罩并放入打开的随身包',
        tags: ['动作自证', '稳健成交'],
      },
      {
        role: 'problem-hook',
        name: '通勤收纳痛点钩子',
        explanation: '先呈现包内空间被占满的通勤痛点，再用折叠结构完成问题化解。',
        audience: '适合经常携带耳机、在意包内空间的通勤用户。',
        purchaseReason: '用痛点前后对照突出折叠结构带来的收纳价值。',
        hook: '包已经塞满？让耳机一折就收好。',
        sceneTitle: '拥挤通勤包',
        environment: '地铁站入口旁的整理台',
        mainAction: '先展示拥挤随身包，再折叠耳机腾出空间',
        tags: ['痛点切入', '前后对照'],
      },
      {
        role: 'lifestyle-seeding',
        name: '办公通勤场景种草',
        explanation: '把拿取、佩戴与收纳串进真实办公通勤日常，降低硬广告感。',
        audience: '适合在办公与通勤之间切换、偏好自然体验分享的人群。',
        purchaseReason: '真实场景让可见外观与折叠方式更容易被理解。',
        hook: '从办公桌到通勤包，一副耳机自然切换两个场景。',
        sceneTitle: '办公结束通勤',
        environment: '傍晚自然光下的简洁办公桌',
        mainAction: '人物从桌面拿起耳机，折叠后放入通勤包',
        tags: ['生活代入', '自然种草'],
      },
    ] as const;
    const timeline = duration === 5
      ? [[0, 1.2], [1.2, 5]]
      : duration === 10
        ? [[0, 2], [2, 7], [7, 10]]
        : [[0, 2], [2, 7], [7, 12], [12, 15]];
    const zhVoiceovers = ['先看它怎么折叠', '可见转轴直接证明收纳更省空间', '日常拿取和收纳都更清晰', '点击商品卡查看'];
    const translatedVoiceovers = voiceoverLanguage === '普通话'
      ? zhVoiceovers
      : voiceoverLanguage === '西班牙语'
        ? ['Mira cómo se pliega', 'La bisagra visible demuestra un guardado compacto', 'Uso diario más claro', 'Toca la tarjeta del producto']
        : ['Watch how it folds', 'The visible hinge proves compact storage', 'Clear in daily use', 'Tap the product card'];

    return roles.map((route, planIndex) => {
      const shots = timeline.map(([startSeconds, endSeconds], shotIndex) => ({
        startSeconds,
        endSeconds,
        role: shotIndex === 0
          ? 'hook'
          : shotIndex === timeline.length - 1
            ? audioMode === 'sound-design-only' ? 'resolution' : 'cta'
            : 'proof',
        location: route.environment,
        subject: '手部、黑色头戴式耳机与随身包',
        shotSize: shotIndex === 0 ? '产品近景' : '手部中近景',
        action: shotIndex === 0
          ? route.mainAction
          : shotIndex === timeline.length - 1
            ? audioMode === 'sound-design-only'
              ? '延续同一次折叠动作，保持商品清晰可见并沿持续运镜自然收尾'
              : '保持商品外观一致，手部自然指向商品卡区域'
            : '镜头贴近可见转轴，连续展示折叠与展开过程',
        cameraMovement: shotIndex === 0 ? '快速推近后稳定跟随' : '沿手部动作平滑横移',
        lightingAndRealism: '自然环境光，保留真实手持呼吸感与材质细节',
        voiceover: audioMode === 'sound-design-only' ? '' : translatedVoiceovers[shotIndex] ?? '',
        voiceoverZh: audioMode === 'sound-design-only' || voiceoverLanguage === '普通话'
          ? ''
          : zhVoiceovers[shotIndex] ?? '',
        foley: shotIndex === 1 ? '转轴轻响与布料摩擦声' : '自然环境底噪',
        editingCue: '沿连续动作节点切入下一镜头，不添加可读花字',
        evidenceRefs: shotIndex === timeline.length - 1 ? [] : ['visible-structure-1'],
        productionNote: '保持黑色机身、椭圆耳罩与右侧 Logo 连续一致',
      }));
      const prompt = shots.map(shot => (
        `【${shot.startSeconds}-${shot.endSeconds}s】\n画面：${shot.location}，${shot.action}；${shot.cameraMovement}。${audioMode === 'voiceover' ? `\n旁白（${voiceoverLanguage}）：${shot.voiceover}` : ''}`
      )).join('\n\n');
      return {
        id: mockUuid(`prompt-wizard-v6-plan-${promptWizardBatchSequence}-${planIndex + 1}`),
        name: `${batchIndex === 0 ? '' : `焕新${batchIndex}·`}${route.name}`,
        narrative: route.explanation,
        primaryScene: `${route.sceneTitle}：${route.environment}`,
        cameraAndPacing: '前三秒快速建立问题或证据，随后用连续动作完成商品自证',
        differenceTags: [...route.tags],
        prompt: `${prompt}${audioMode === 'sound-design-only' ? '\n\n无对白、无人声、无旁白；仅使用音乐、环境声和真实商品操作拟音。' : ''}\n\n【商品一致性】保持黑色哑光机身、椭圆耳罩、可折叠头梁和右侧 Logo；不新增价格、认证、折扣或参数。`,
        deliveryVersion: 6,
        audioMode,
        role: route.role,
        directionExplanationZh: route.explanation,
        audienceZh: route.audience,
        purchaseReasonZh: route.purchaseReason,
        hookZh: route.hook,
        claimBasisTags: [
          { labelZh: '可折叠头梁与转轴', basis: 'visible', evidenceRefs: ['visible-structure-1'] },
          { labelZh: '播放手机音频属于耳机品类常见功能', basis: 'category-inferred', evidenceRefs: [] },
        ],
        selectedScene: {
          id: mockUuid(`prompt-wizard-v6-scene-${promptWizardBatchSequence}-${planIndex + 1}`),
          title: route.sceneTitle,
          environment: route.environment,
          mainAction: route.mainAction,
        },
        shots,
        productionWarnings: ['右侧 Logo 较小，生成时需保持位置与比例一致。'],
      };
    });
  };

  await page.exposeFunction('__setAdminRefreshScenario', (scenario: AdminRefreshScenario) => {
    adminRefreshScenario = scenario;
    adminPlanReadFailuresRemaining = scenario === 'fail-next-admin-plans' ? 2 : 0;
  });
  await page.exposeFunction('__setAdminPlanReadDelay', (delayMs: number) => {
    adminPlanReadDelayMs = Math.max(0, delayMs);
  });
  await page.exposeFunction('__setVideoConsumptionConfiguration', (input: {
    items: Array<ReturnType<typeof consumption>>;
    videoModels: unknown[];
  }) => {
    consumptionSettings = [
      ...consumptionSettings.filter(item => item.model !== 'Seedance 2.5'),
      ...input.items.map(item => ({ ...item, id: mockUuid(item.id) })),
    ];
    videoModelCapabilities = input.videoModels;
  });
  const createTkPromptRunFixture = (imageAssetIds: string[]): MockTkPromptRun => {
    tkPromptRunSequence += 1;
    const now = `2026-08-17T10:${String(tkPromptRunSequence).padStart(2, '0')}:00.000Z`;
    return {
      id: mockUuid(`tk-prompt-run-${tkPromptRunSequence}`),
      schemaVersion: 1,
      status: 'ready',
      imageAssetIds,
      evidenceProfile: {
        schemaVersion: 1,
        productIdentity: { name: '黑色头戴式耳机', category: '消费电子 > 耳机', confidence: 'high' },
        visibleFacts: [{
          factId: 'visible-001',
          text: '黑色哑光机身、椭圆耳罩与可折叠头梁清晰可见',
          sourceImageAssetIds: imageAssetIds,
          confidence: 'high',
        }],
        inferredContexts: [
          { contextId: 'audience-001', kind: 'audience', text: '通勤和日常收纳人群' },
          { contextId: 'scenario-001', kind: 'scenario', text: '通勤包旁的真实收纳场景' },
          { contextId: 'strategy-001', kind: 'strategy-selection', text: '可用折叠动作完成可见自证' },
        ],
        demonstrableActions: [{
          actionId: 'action-001',
          text: '用手折叠头梁并放入随身包',
          supportingFactIds: ['visible-001'],
          sourceImageAssetIds: imageAssetIds,
        }],
        availableMaterials: ['商品参考图片', '随身包'],
        forbiddenClaims: ['不编造降噪数值、续航或价格'],
      },
      failureReason: null,
      createdAt: now,
      completedAt: now,
    };
  };

  const createTkPromptGenerationFixture = (
    run: MockTkPromptRun,
    request: Record<string, any>,
  ): MockTkPromptGeneration => {
    tkPromptGenerationSequence += 1;
    const id = mockUuid(`tk-prompt-generation-${tkPromptGenerationSequence}`);
    const now = `2026-08-17T11:${String(tkPromptGenerationSequence).padStart(2, '0')}:00.000Z`;
    const duration = Number(request.videoConfig?.durationSeconds ?? 15);
    const soundOnly = duration === 5;
    const spokenLanguage = String(request.creativeInput?.spokenLanguage ?? '');
    const wantsPresenter = request.creativeInput?.appearance?.mode === 'live_presenter';
    const strategyTemplates: Array<Record<string, any>> = [
      {
        slot: 'safe', labelZh: '最稳', objective: 'conversion', styleForm: 'product', style: 'product_pov',
        hookPatternId: 'visual_shock', firstFrameId: 'macro_action', buyingMotivationId: 'problem_relief',
        proofMethodId: 'visible_operation', videoMode: 'product_closeup',
      },
      {
        slot: 'native', labelZh: '最原生', objective: 'trust', styleForm: 'scene', style: 'scene',
        hookPatternId: 'identity', firstFrameId: 'pov_entry', buyingMotivationId: 'identity_fit',
        proofMethodId: wantsPresenter ? 'presenter_delivery' : 'context_demo',
        videoMode: wantsPresenter ? 'live_presenter' : 'scene_demo',
      },
      {
        slot: 'creative', labelZh: '最抓眼', objective: 'attention', styleForm: 'drama', style: 'reversal',
        hookPatternId: 'sound_hook', firstFrameId: 'sound_sync', buyingMotivationId: 'curiosity',
        proofMethodId: 'structure_closeup', videoMode: 'product_closeup',
      },
    ];
    const strategies = strategyTemplates.map(template => ({
      ...template,
      firstFrame: `${template.labelZh}：第一帧直接看见耳机折叠动作`,
      openingAction: '手部在一秒内折叠可见头梁',
      openingLine: soundOnly ? '' : 'Watch this fold.',
        relevanceBeat: '1-3秒：三秒内让通勤用户看懂收纳问题',
      productBridge: '折叠动作自然连接到商品结构',
      buyingMotivation: '可见动作帮助用户判断是否适合日常收纳',
      proofMethod: '只通过图片可见结构和真实操作进行证明',
      ctaStrategy: '用一句低压商品卡引导收尾',
      requiredMaterials: ['商品参考图片1'],
      allowedFactIds: ['visible-001'],
    }));
    const titles: Record<string, string> = {
      safe: '折叠结构直接自证',
      native: '通勤收纳POV',
      creative: '转轴声音悬念',
    };
    const options = strategies.map(strategy => ({
      id: mockUuid(`tk-prompt-option-${tkPromptGenerationSequence}-${strategy.slot}`),
      generationId: id,
      slot: strategy.slot,
      status: 'completed',
      strategyBlueprint: strategy,
      plan: {
        schemaVersion: 1,
        title: titles[strategy.slot],
        whyItFits: `${strategy.labelZh}方案只使用已确认的可见商品事实。`,
        audioMode: soundOnly ? 'sound-design-only' : 'voiceover',
        executionPrompt: soundOnly
          ? `TK1-${strategy.slot}：@图片1 的头梁在真实桌面上被快速折叠。${strategy.videoMode === 'live_presenter' ? '符合目标市场的成年虚构非名人出镜，单条人物身份一致；' : ''}无对白、无人声、无旁白；仅使用环境声与商品操作拟音。`
          : `TK1-${strategy.slot}：@图片1 的头梁在真实桌面上被快速折叠。${strategy.videoMode === 'live_presenter' ? '符合目标市场与口播语言的成年虚构非名人出镜，单条人物身份一致。' : ''}\n旁白（${spokenLanguage}）：Watch this fold and fit your commute.`,
        beats: [{
          startSeconds: 0,
          endSeconds: duration,
          environment: '通勤包旁的真实桌面',
          subject: '@图片1 中的黑色头戴式耳机与手部',
          action: '用手折叠头梁并放在随身包旁',
          shotSize: '产品近景',
          cameraMovement: '低机位快速推近后跟随手部',
          lighting: '柔和自然光',
          editingCue: '在折叠完成的动作点切镜',
          soundDesign: '转轴轻响和布料摩擦声',
          voiceoverTarget: soundOnly ? '' : 'Watch this fold and fit your commute.',
          voiceoverZh: soundOnly ? '' : '看它折叠后如何收进你的通勤包。',
          factIds: ['visible-001'],
        }],
        factsUsed: ['visible-001'],
        assumptions: [],
        requiredMaterials: ['商品参考图片1'],
        warnings: ['不编造降噪数值或续航'],
      },
      failureReason: null,
      createdAt: now,
      completedAt: now,
    }));
    return {
      id,
      runId: run.id,
      schemaVersion: 1,
      status: 'completed',
      evidenceReview: request.evidenceReview,
      creativeInput: request.creativeInput,
      videoConfig: request.videoConfig,
      isFree: tkPromptGenerationSequence === 1,
      credits: tkPromptGenerationSequence === 1 ? 0 : tkPromptEngineSettings.generationCredits,
      creditStatus: tkPromptGenerationSequence === 1 ? 'none' : 'settled',
      strategySet: strategies,
      options,
      failureReason: null,
      createdAt: now,
      completedAt: now,
    };
  };

  await page.exposeFunction('__getApiRequestCount', (key: string) => apiRequestCounts.get(key) ?? 0);
  await page.exposeFunction('__getAdminApiRequestCount', () => {
    return Array.from(apiRequestCounts.entries()).reduce((total, [key, count]) => {
      return key.includes(' /api/admin/') ? total + count : total;
    }, 0);
  });
  await page.exposeFunction('__getLastGenerationRequest', () => generationRequests.at(-1) ?? null);
  await page.exposeFunction('__getPromptWizardRuns', () => Array.from(promptWizardRuns.values()));
  await page.exposeFunction('__getPromptWizardBatches', () => Array.from(promptWizardBatches.values()));
  await page.exposeFunction('__getPromptWizardUseDirectionSets', () => Array.from(promptWizardUseDirectionSets.values()));
  await page.exposeFunction('__getPromptWizardRefinementRequests', () => promptWizardRefinementRequests);
  await page.exposeFunction('__getPromptWizardSettingsRequests', () => promptWizardSettingsRequests);
  await page.exposeFunction('__getTkPromptRuns', () => Array.from(tkPromptRuns.values()));
  await page.exposeFunction('__getTkPromptGenerations', () => Array.from(tkPromptGenerations.values()));
  await page.exposeFunction('__getTkPromptGenerationRequests', () => tkPromptGenerationRequests);
  await page.exposeFunction('__getTkPromptEngineSettingsRequests', () => tkPromptEngineSettingsRequests);
  await page.exposeFunction('__setPromptWizardResumeEnabled', (enabled: boolean) => {
    promptWizardResumeEnabled = enabled;
  });
  await page.exposeFunction('__setPromptWizardLegacyTaskRetired', (retired: boolean) => {
    promptWizardLegacyTaskRetired = retired;
  });
  await page.exposeFunction('__failNextPromptWizardInitialBatch', () => {
    promptWizardFailNextInitialBatch = true;
  });
  await page.exposeFunction('__failNextPromptWizardPaidBatch', () => {
    promptWizardFailNextPaidBatch = true;
  });
  await page.exposeFunction('__deferNextPromptWizardBatch', (outcome: 'completed' | 'failed') => {
    promptWizardNextDeferredBatchOutcome = outcome;
    promptWizardDeferredBatchPollingEnabled = false;
  });
  await page.exposeFunction('__releasePromptWizardBatchPolling', () => {
    promptWizardDeferredBatchPollingEnabled = true;
  });
  await page.exposeFunction('__setGenerationTasks', (items: Array<ReturnType<typeof job> & Record<string, unknown>>) => {
    generationTasks = items.map(item => normalizeGenerationTaskFixture(item, currentUser));
    generationFailuresOnPoll.clear();
  });
  await page.exposeFunction('__failNextPaginationSnapshot', () => {
    paginationSnapshotFailuresRemaining += 1;
  });
  await page.exposeFunction('__setApiCostAsOf', (asOf: string) => {
    apiCostAsOf = asOf;
  });
  await page.exposeFunction('__setAssetPreviewFixture', (id: string, fixture: { publicUrl: string; prompt: string }) => {
    assets = assets.map(asset => {
      if (asset.id !== id || !('generation' in asset)) return asset;
      return {
        ...asset,
        publicUrl: fixture.publicUrl,
        generation: {
          ...asset.generation,
          prompt: fixture.prompt,
        },
      };
    });
  });
  await page.exposeFunction('__setAssetDownloadRequestedAt', (id: string, downloadRequestedAt: string | null) => {
    assets = assets.map(asset => asset.id === id ? { ...asset, downloadRequestedAt } : asset);
  });
  await page.exposeFunction('__appendImageReferenceAssets', (count: number) => {
    const safeCount = Math.max(0, Math.min(8, Math.floor(count)));
    const names = Array.from({ length: safeCount }, (_, index) => `布局参考图 ${index + 3}`);
    assets = [
      ...assets,
      ...names.map((name, index) => uploadedAsset(`asset-layout-reference-${index + 3}`, {
        name,
        type: 'image',
        source: 'uploaded-image',
        objectKey: `users/e2e/layout-reference-${index + 3}.png`,
        publicUrl: `https://cdn.example.com/layout-reference-${index + 3}.png`,
        sizeBytes: 1024 + index,
      })),
    ];
    return names;
  });
  await page.exposeFunction('__setMockCurrentUser', (user: ReturnType<typeof account>) => {
    currentUser = {
      ...account(user.userName, user.email, user.role),
      ...user,
      id: mockUuid(user.id),
    };
    if (!users.some(item => item.email === currentUser.email)) users.push(adminUser(currentUser));
  });
  await page.exposeFunction('__setFeatureFlags', (flags: Partial<MockFeatureFlags>) => {
    featureFlags = { ...featureFlags, ...flags };
  });
  await page.exposeFunction('__removeSystemFolder', (source: string) => {
    folders = folders.filter(folder => !(folder.isSystem && folder.source === source));
  });
  await page.exposeFunction('__setPlans', (items: MockPlan[]) => {
    plans = items.map(item => ({
      ...item,
      id: mockUuid(item.id),
      createdAt: item.createdAt ?? '2026-06-01T10:00:00.000Z',
    }));
  });
  await page.exposeFunction('__setOrders', (items: Array<ReturnType<typeof order>>) => {
    orders = items;
  });
  await page.exposeFunction('__setInvoices', (items: Array<(typeof invoices)[number]>) => {
    invoices = items;
  });
  await page.exposeFunction('__setCreditLedger', (items: Array<ReturnType<typeof ledger>>) => {
    creditLedger = items;
  });
  await page.exposeFunction('__setPaymentLaunchType', (type: 'url' | 'form') => {
    paymentLaunchType = type;
  });
  await page.exposeFunction('__setPaymentCreateAttemptStatus', (status: PaymentCreateAttemptStatus) => {
    paymentCreateAttemptStatus = status;
  });
  await page.exposeFunction('__getPaymentCreateIdempotencyKeys', () => [...paymentCreateIdempotencyKeys]);
  await page.exposeFunction('__setDesktopPaymentCodeUrl', (value: string) => {
    desktopPaymentCodeUrl = value;
  });
  await page.exposeFunction('__setFailPaymentRefreshes', (value: boolean) => {
    failPaymentRefreshes = value;
  });
  await page.exposeFunction('__setFailPrivateDataRefreshes', (value: boolean) => {
    failPrivateDataRefreshes = value;
  });
  await page.exposeFunction('__setFailDashboardSummary', (value: boolean) => {
    failDashboardSummary = value;
  });
  await page.exposeFunction('__configurePaymentSync', (input: { failures: number; finalStatus: PaymentSyncFinalStatus }) => {
    paymentSyncFailuresRemaining = Math.max(0, input.failures);
    paymentSyncFinalStatus = input.finalStatus;
  });
  await page.exposeFunction('__prepareTicketReadFailure', (input: { surface: 'user' | 'admin'; failures: number }) => {
    const currentTicket = tickets[0];
    if (!currentTicket) return;
    const authorRole = input.surface === 'user' ? 'admin' : 'user';
    const body = input.surface === 'user' ? '客服回复仍应正常展示。' : '用户消息仍应正常展示。';
    const message = ticketMessage(
      `message-read-failure-${input.surface}`,
      currentTicket.id,
      authorRole,
      authorRole === 'admin' ? 'Lindyson Support' : currentUser.userName,
      authorRole === 'admin' ? 'admin@lindyson.ai' : currentUser.email,
      body,
      '2026-07-12T10:00:00.000Z',
    );
    ticketMessages.set(currentTicket.id, [...(ticketMessages.get(currentTicket.id) ?? []), message]);
    tickets = tickets.map(ticket => ticket.id === currentTicket.id ? {
      ...ticket,
      unreadCount: 1,
      lastMessageAuthor: authorRole,
      lastMessage: body,
      lastMessageAt: message.createdAt,
      updatedAt: message.createdAt,
    } : ticket);
    if (input.surface === 'user') userTicketReadFailuresRemaining = Math.max(0, input.failures);
    else adminTicketReadFailuresRemaining = Math.max(0, input.failures);
  });
  await page.exposeFunction('__prepareTicketPaginationScenario', (count: number) => {
    tickets = Array.from({ length: count }, (_, index) => {
      const timestamp = new Date(Date.UTC(2026, 5, 29, 10) - index * 60_000).toISOString();
      const item = ticket(`pagination-ticket-${index}`, `分页工单 ${index + 1}`, currentUser.userName, currentUser.email, {
        lastMessage: `分页消息 ${index + 1}`,
        lastMessageAuthor: 'user',
        unreadCount: 0,
        updatedAt: timestamp,
        lastMessageAt: timestamp,
      });
      ticketMessages.set(item.id, [
        ticketMessage(`pagination-message-${index}`, item.id, 'user', currentUser.userName, currentUser.email, item.lastMessage, timestamp),
      ]);
      return item;
    });
  });
  await page.exposeFunction('__prepareTicketSwitchScenario', () => {
    const slow = ticket('ticket-slow', '慢工单', currentUser.userName, currentUser.email, {
      lastMessage: '慢速工单消息',
      updatedAt: '2026-07-13T10:00:00.000Z',
      lastMessageAt: '2026-07-13T10:00:00.000Z',
    });
    const fast = ticket('ticket-fast', '快工单', currentUser.userName, currentUser.email, {
      lastMessage: '快速工单消息',
      updatedAt: '2026-07-13T09:00:00.000Z',
      lastMessageAt: '2026-07-13T09:00:00.000Z',
    });
    tickets = [slow, fast];
    ticketMessages.set(slow.id, [
      ticketMessage('message-slow', slow.id, 'user', currentUser.userName, currentUser.email, '慢速工单消息', slow.updatedAt),
    ]);
    ticketMessages.set(fast.id, [
      ticketMessage('message-fast', fast.id, 'user', currentUser.userName, currentUser.email, '快速工单消息', fast.updatedAt),
    ]);
    ticketMessageDelays.set(slow.id, 1_000);
  });
  await page.exposeFunction('__setCursorPageSizeCap', (value: number | null) => {
    cursorPageSizeCap = value === null ? null : Math.max(1, Math.floor(value));
  });
  await page.exposeFunction('__prepareDigitalAssetPaginationScenario', () => {
    assets = Array.from({ length: 61 }, (_, index) => ({
      ...videoAsset(
        `asset-pagination-${String(index + 1).padStart(2, '0')}`,
        `分页素材 ${String(index + 1).padStart(2, '0')}`,
        rootVideoFolderId,
        'Seedance 2.0',
      ),
      createdAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
    }));
  });

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const requestKey = `${method} ${path}`;
    apiRequestCounts.set(requestKey, (apiRequestCounts.get(requestKey) ?? 0) + 1);
    if (!path.startsWith('/api/')) {
      await route.continue();
      return;
    }

    if (
      method === 'GET'
      && url.searchParams.has('snapshotCursor')
      && paginationSnapshotFailuresRemaining > 0
      && (path === '/api/ai/tasks' || path.startsWith('/api/admin/'))
    ) {
      paginationSnapshotFailuresRemaining -= 1;
      await json(route, {
        message: '列表已更新，请重新建立分页快照',
        code: 'PAGINATION_SNAPSHOT_CHANGED',
      }, 409);
      return;
    }

    if (path.startsWith('/api/mock-storage/') && method === 'PUT') {
      const filename = decodeURIComponent(path.split('/').pop() ?? 'asset');
      const attempts = uploadAttempts.get(filename) ?? 0;
      uploadAttempts.set(filename, attempts + 1);
      if (filename.includes('fail-first') && attempts === 0) {
        await route.fulfill({ status: 403, contentType: 'text/plain', body: 'Forbidden' });
        return;
      }
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const payload = postJson<{ email?: string }>(route);
      currentUser = payload.email === 'member@lindyson.ai'
        ? account('普通用户', 'member@lindyson.ai', 'user')
        : account('管理员', 'admin@lindyson.ai');
      if (!users.some(user => user.email === currentUser.email)) users.push(adminUser(currentUser));
      await json(route, { user: currentUser });
      return;
    }

    if (path === '/api/auth/register-code' && method === 'POST') {
      const payload = postJson<{ email?: string }>(route);
      if (payload.email === 'pro.user@lindyson.ai') {
        await json(route, { message: '该邮箱已注册，请直接登录' }, 409);
        return;
      }

      await json(route, {
        verificationId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      return;
    }

    if (path === '/api/auth/register' && method === 'POST') {
      const payload = postJson<{ userName?: string; email?: string; verificationCode?: string }>(route);
      if (payload.verificationCode !== registerCode) {
        await json(route, { message: '验证码错误' }, 400);
        return;
      }

      currentUser = account(payload.userName ?? '测试用户', payload.email ?? 'new.user@lindyson.ai', 'user');
      currentUser = {
        ...currentUser,
        planCode: null,
        planName: null,
        mainCredits: 0,
        addonCredits: 0,
        credits: 0,
        totalCredits: 0,
        planResetAt: null,
        planExpiresAt: null,
      };
      if (!users.some(user => user.email === currentUser.email)) users.push(adminUser(currentUser));
      await json(route, { user: currentUser });
      return;
    }

    if (path === '/api/auth/me') {
      if (failPaymentRefreshes) {
        await json(route, { message: '服务器错误' }, 500);
        return;
      }
      await json(route, { user: currentUser });
      return;
    }

    if (path === '/api/account/credits') {
      if (failPaymentRefreshes || failPrivateDataRefreshes) {
        await json(route, { message: '服务器错误' }, 500);
        return;
      }
      await json(route, {
        mainCredits: currentUser.mainCredits,
        addonCredits: currentUser.addonCredits,
        credits: currentUser.credits,
        totalCredits: currentUser.totalCredits,
        planResetAt: currentUser.planResetAt,
        planExpiresAt: currentUser.planExpiresAt,
      });
      return;
    }

    if (path === '/api/account/dashboard-summary' && method === 'GET') {
      if (failDashboardSummary) {
        await json(route, { message: '仪表盘聚合暂不可用' }, 503);
        return;
      }
      const visibleTasks = isNewRegisteredUser(currentUser) ? [] : generationTasks;
      const completedTasks = visibleTasks.filter(task => task.status === 'completed');
      const modelCounts = new Map<string, number>();
      completedTasks.forEach(task => modelCounts.set(task.model, (modelCounts.get(task.model) ?? 0) + 1));
      const recentProjects = completedTasks
        .filter(task => task.assetId && assets.some(asset => asset.id === task.assetId))
        .sort((left, right) => new Date(right.completedAt ?? right.createdAt).getTime() - new Date(left.completedAt ?? left.createdAt).getTime())
        .slice(0, 6)
        .map(task => {
          const asset = assets.find(item => item.id === task.assetId);
          return {
            id: task.id,
            kind: task.kind,
            model: task.model,
            status: task.status,
            assetId: task.assetId,
            assetName: task.assetName,
            previewUrl: asset?.thumbnailUrl ?? null,
            createdAt: task.createdAt,
            completedAt: task.completedAt,
          };
        });
      await json(route, {
        summary: {
          totalGenerations: completedTasks.length,
          videoGenerations: completedTasks.filter(task => task.kind === 'video').length,
          imageGenerations: completedTasks.filter(task => task.kind === 'image').length,
        },
        trend: dashboardTrend(completedTasks),
        modelUsage: [...modelCounts.entries()].map(([model, count]) => ({ model, count })),
        recentProjects,
        timezone: 'Asia/Shanghai',
      });
      return;
    }

    if (path === '/api/account/feature-flags') {
      await json(route, { flags: featureFlags });
      return;
    }

    if (path === '/api/subscription/plans') {
      await json(route, { items: plans.filter(plan => plan.status === 'active') });
      return;
    }

    if (path.startsWith('/api/admin/') && currentUser.role !== 'admin') {
      await json(route, { message: '需要管理员权限' }, 403);
      return;
    }

    if (path === '/api/admin/plans' && method === 'GET') {
      if (adminPlanReadDelayMs > 0) {
        const delayMs = adminPlanReadDelayMs;
        adminPlanReadDelayMs = 0;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      if (failPaymentRefreshes) {
        await json(route, { message: '服务器错误' }, 500);
        return;
      }
      if (adminPlanReadFailuresRemaining > 0) {
        adminPlanReadFailuresRemaining -= 1;
        if (adminPlanReadFailuresRemaining === 0) adminRefreshScenario = 'default';
        await json(route, { message: '后台数据刷新失败' }, 500);
        return;
      }
      await json(route, { items: plans });
      return;
    }

    if (path === '/api/admin/overview' && method === 'GET') {
      const paidOrders = orders.filter(item => item.status === 'paid');
      await json(route, { summary: {
        totalUsers: users.length,
        todayNewUsers: 0,
        monthNewUsers: users.length,
        totalRevenue: paidOrders.reduce((sum, item) => sum + item.amount, 0),
        todayRevenue: 0,
        monthRevenue: paidOrders.reduce((sum, item) => sum + item.amount, 0),
        sevenDayRevenue: paidOrders.reduce((sum, item) => sum + item.amount, 0),
        totalJobs: generationTasks.length,
        todayJobs: 0,
        activeJobs: generationTasks.filter(item => item.status === 'queued' || item.status === 'processing').length,
        openTickets: tickets.filter(item => item.status !== 'resolved').length,
        pendingInvoices: invoices.filter(item => item.status !== 'issued').length,
        sevenDayPaymentFailures: orders.filter(item => item.status === 'failed').length,
        inactiveUsers: 0,
        failedJobs: generationTasks.filter(item => item.status === 'failed').length,
        sevenDayApiRequests: apiCostTasks.length,
        sevenDayApiSuccesses: apiCostTasks.filter(item => item.status === 'completed').length,
        sevenDayApiSuccessRate: apiCostTasks.length > 0
          ? Math.round((apiCostTasks.filter(item => item.status === 'completed').length / apiCostTasks.length) * 100)
          : 100,
        revenueTrend: [{
          day: '2026-07-11',
          revenue: paidOrders.reduce((sum, item) => sum + item.amount, 0),
          orders: paidOrders.length,
        }],
        modelUsage: apiCostTasks
          .filter(item => (item.billableTokens ?? 0) > 0)
          .map(item => ({ model: item.model, billableTokens: item.billableTokens ?? 0 })),
        timezone: 'Asia/Shanghai',
        dayStart: '2026-07-11T00:00:00+08:00',
        monthStart: '2026-07-01T00:00:00+08:00',
      }, apiCostHealth: {
        syncStatus: 'normal',
        lastSyncedAt: apiCostAsOf,
        matchState: 'raw-matched',
        residualTokens: 0,
        residualCostCny: '0.000000',
      } });
      return;
    }

    if (path === '/api/admin/navigation-summary' && method === 'GET') {
      await json(route, {
        openTickets: tickets.filter(item => item.status !== 'resolved').length,
        pendingInvoices: invoices.filter(item => item.status !== 'issued').length,
        activeJobs: generationTasks.filter(item => item.status === 'queued' || item.status === 'processing').length,
        manualReviewPayments: orders.filter(item => item.paymentAttemptStatus === 'manual-review').length,
        manualReviewRefunds: orders.filter(item => item.refundAttemptStatus === 'manual-review').length,
        asOf: '2026-07-11T10:00:00.000Z',
      });
      return;
    }

    if (path === '/api/admin/payment-channel' && method === 'GET') {
      await json(route, { channel: paymentChannel });
      return;
    }

    if (path === '/api/admin/payment-channel' && method === 'PUT') {
      const payload = postJson<typeof paymentChannel & { apiKey?: string }>(route);
      paymentChannel = {
        enabled: payload.enabled,
        apiBase: payload.apiBase,
        mchNo: payload.mchNo,
        appId: payload.appId,
        hasApiKey: paymentChannel.hasApiKey || Boolean(payload.apiKey),
        desktopWayCode: 'ALI_WAP',
        mobileWayCode: 'ALI_WAP',
        updatedAt: '2026-07-10T10:00:00.000Z',
      };
      await json(route, { channel: paymentChannel });
      return;
    }

    if (path === '/api/admin/plans' && method === 'POST') {
      const payload = postJson<Omit<MockPlan, 'id' | 'subscribers' | 'revenue' | 'createdAt' | 'updatedAt'>>(route);
      const nextPlan: MockPlan = {
        ...payload,
        id: mockUuid(`plan-${payload.code}`),
        subscribers: 0,
        revenue: 0,
        createdAt: '2026-06-30T10:30:00.000Z',
        updatedAt: '2026-06-30T10:30:00.000Z',
      };
      plans = [nextPlan, ...plans];
      await json(route, { plan: nextPlan });
      return;
    }

    if (path.startsWith('/api/admin/plans/') && method === 'PATCH') {
      const id = path.split('/').pop();
      const payload = postJson<Partial<MockPlan>>(route);
      if (!payload.portraitEntitlements) {
        await json(route, { message: '编辑套餐时必须显式提交真人演员库权益配置' }, 400);
        return;
      }
      const current = plans.find(plan => plan.id === id);
      if (!current) {
        await json(route, { message: '套餐不存在' }, 404);
        return;
      }
      const nextKind = payload.kind ?? current.kind;
      const portrait = payload.portraitEntitlements;
      if (nextKind === 'addon' && (
        portrait.enabled
        || portrait.profileLimit !== 0
        || portrait.activeLimit !== 0
        || portrait.assetsPerActor !== 0
      )) {
        await json(route, { message: '加购包不能包含真人人像素材库权益' }, 400);
        return;
      }
      const nextPlan: MockPlan = {
        ...current,
        ...payload,
        id: current.id,
        subscribers: current.subscribers,
        revenue: current.revenue,
        updatedAt: '2026-06-30T10:45:00.000Z',
      };
      plans = plans.map(plan => plan.id === id ? nextPlan : plan);
      await json(route, { plan: nextPlan });
      return;
    }

    if (path === '/api/announcements' && method === 'GET') {
      await json(route, { items: sortAnnouncementsForApi(announcements).slice(0, 5) });
      return;
    }

    if (path === '/api/admin/announcements' && method === 'GET') {
      const search = url.searchParams.get('search')?.trim().toLowerCase() ?? '';
      const filtered = sortAnnouncementsForApi(announcements).filter(item => (
        !search || item.title.toLowerCase().includes(search) || item.content.toLowerCase().includes(search)
      ));
      await json(route, cursorPage(filtered, url, cursorPageSizeCap));
      return;
    }

    if (path === '/api/admin/announcements' && method === 'POST') {
      const payload = postJson<{ title: string; content: string; pinned: boolean }>(route);
      if (payload.pinned && announcements.filter(item => item.pinned).length >= 3) {
        await json(route, { message: '最多只能置顶 3 条公告' }, 400);
        return;
      }

      const nextAnnouncement = announcement(
        `ann-new-${announcements.length + 1}`,
        payload.title,
        payload.content,
        payload.pinned,
        '2026-06-30T11:00:00.000Z',
      );
      announcements = [nextAnnouncement, ...announcements];
      await json(route, { announcement: nextAnnouncement });
      return;
    }

    if (path.startsWith('/api/admin/announcements/') && method === 'PATCH') {
      const id = path.split('/').pop();
      const payload = postJson<Partial<Pick<MockAnnouncement, 'title' | 'content' | 'pinned'>>>(route);
      const current = announcements.find(item => item.id === id);
      if (!current) {
        await json(route, { message: '公告不存在' }, 404);
        return;
      }

      const nextPinned = payload.pinned ?? current.pinned;
      if (nextPinned && !current.pinned && announcements.filter(item => item.pinned).length >= 3) {
        await json(route, { message: '最多只能置顶 3 条公告' }, 400);
        return;
      }

      const nextAnnouncement = {
        ...current,
        title: payload.title ?? current.title,
        content: payload.content ?? current.content,
        pinned: nextPinned,
        updatedAt: '2026-06-30T11:15:00.000Z',
      };
      announcements = announcements.map(item => item.id === id ? nextAnnouncement : item);
      await json(route, { announcement: nextAnnouncement });
      return;
    }

    if (path.startsWith('/api/admin/announcements/') && method === 'DELETE') {
      const id = path.split('/').pop();
      announcements = announcements.filter(item => item.id !== id);
      await json(route, { ok: true });
      return;
    }

    if (path === '/api/account/credit-ledger') {
      const type = url.searchParams.get('type');
      await json(route, cursorPage(creditLedger.filter(item => (
        item.userId === currentUser.id && (!type || item.type === type)
      )), url, cursorPageSizeCap));
      return;
    }

    if (path === '/api/admin/credit-ledger') {
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      const type = url.searchParams.get('type');
      const userId = url.searchParams.get('userId');
      const relatedOrderId = url.searchParams.get('relatedOrderId');
      const relatedJobId = url.searchParams.get('relatedJobId');
      const filtered = creditLedger.filter(item => (
        (!type || item.type === type)
        && (!userId || item.userId === userId)
        && (!relatedOrderId || item.relatedOrderId === relatedOrderId)
        && (!relatedJobId || item.relatedJobId === relatedJobId)
        && (!search || [item.id, item.userName, item.email, item.source, item.note, item.relatedOrderId, item.relatedJobId]
          .some(value => String(value ?? '').toLocaleLowerCase('zh-CN').includes(search)))
      ));
      await json(route, cursorPage(filtered, url, cursorPageSizeCap));
      return;
    }

    if (path === '/api/assets/folders' && method === 'POST') {
      const payload = postJson<{ name: string; source: string }>(route);
      const created = folder(
        '00000000-0000-4000-8000-000000000099',
        payload.name,
        payload.source,
        false,
        '2026-07-12T10:00:00.000Z',
      );
      folders = [...folders, created];
      await json(route, { folder: created });
      return;
    }

    if (path === '/api/assets/folders' && method === 'GET') {
      await json(route, { items: sortFoldersForApi(folders) });
      return;
    }

    if (path.match(/^\/api\/assets\/folders\/[^/]+$/) && method === 'PATCH') {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      const payload = postJson<{ name: string }>(route);
      const current = folders.find(item => item.id === id && !item.isSystem);
      const name = payload.name.trim();
      if (!current || !name) {
        await json(route, { message: '文件夹不存在或不可修改' }, 404);
        return;
      }
      const updated = { ...current, name };
      folders = folders.map(item => item.id === id ? updated : item);
      await json(route, { folder: updated });
      return;
    }

    if (path.match(/^\/api\/assets\/folders\/[^/]+$/) && method === 'DELETE') {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      const requestedAction = url.searchParams.get('contentAction');
      if (requestedAction !== null && requestedAction !== 'move-to-root' && requestedAction !== 'delete-assets') {
        await json(route, { message: '文件夹内容处理方式无效' }, 400);
        return;
      }
      const current = folders.find(item => item.id === id && !item.isSystem);
      if (!current) {
        const deleted = assetFolderDeletionRecords.get(id);
        if (!deleted) {
          await json(route, { message: '文件夹不存在或不可删除' }, 404);
          return;
        }
        if (requestedAction && requestedAction !== deleted.contentAction) {
          await json(route, {
            message: '文件夹已按不同的内容处理方式删除',
            code: 'ASSET_FOLDER_DELETE_ACTION_CONFLICT',
          }, 409);
          return;
        }
        await json(route, { ok: true, ...deleted });
        return;
      }

      const rootFolder = folders.find(item => item.isSystem && item.source === current.source);
      if (!rootFolder) {
        await json(route, {
          message: '素材系统主目录缺失，请联系管理员',
          code: 'ASSET_ROOT_FOLDER_MISSING',
        }, 500);
        return;
      }
      const contentAction = requestedAction ?? 'move-to-root';
      const affectedAssetCount = assets.filter(asset => asset.folderId === id).length;
      assets = contentAction === 'move-to-root'
        ? assets.map(asset => asset.folderId === id ? { ...asset, folderId: rootFolder.id } : asset)
        : assets.filter(asset => asset.folderId !== id);
      for (const session of uploadSessionsById.values()) {
        if (session.status === 'pending' && session.folderId === id) session.folderId = rootFolder.id;
      }
      folders = folders.filter(item => item.id !== id);
      assetFolderDeletionRecords.set(id, { contentAction, affectedAssetCount });
      await json(route, { ok: true, contentAction, affectedAssetCount });
      return;
    }

    if (path === '/api/assets' && method === 'GET') {
      await json(route, { message: '接口不存在' }, 404);
      return;
    }

    if (path === '/api/assets/summary' && method === 'GET') {
      const visibleAssets = isNewRegisteredUser(currentUser) ? [] : assets;
      await json(route, { summary: assetSummary(visibleAssets) });
      return;
    }

    if (path === '/api/assets/cards' && method === 'GET') {
      const source = url.searchParams.get('source');
      const type = url.searchParams.get('type');
      const folderId = url.searchParams.get('folderId');
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      const visibleAssets = (isNewRegisteredUser(currentUser) ? [] : assets).filter(asset => (
        (!source || asset.source === source)
        && (!type || asset.type === type)
        && (!folderId || asset.folderId === folderId)
        && (!search || asset.name.toLocaleLowerCase('zh-CN').includes(search))
      ));
      await json(route, assetCardsPage(visibleAssets, url, cursorPageSizeCap));
      return;
    }

    if (path.match(/^\/api\/assets\/[^/]+$/) && method === 'GET') {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      const current = assets.find(asset => asset.id === id);
      if (!current) {
        await json(route, { message: '素材不存在' }, 404);
        return;
      }
      await json(route, { asset: assetDetail(current) });
      return;
    }

    if (path.match(/^\/api\/assets\/[^/]+\/download$/) && method === 'POST') {
      const id = path.split('/')[3];
      const current = assets.find(asset => asset.id === id);
      if (!current) {
        await json(route, { message: '素材不存在' }, 404);
        return;
      }
      const downloadRequestedAt = current.downloadRequestedAt ?? '2026-07-01T12:00:00.000Z';
      const extension = current.objectKey?.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? '.mp4';
      const filename = `${current.name.replace(/\.(?:avif|gif|jpe?g|mov|mp3|mp4|mpeg|png|wav|webm|webp)$/i, '')}${extension}`;
      assets = assets.map(asset => asset.id === id ? { ...asset, downloadRequestedAt } : asset);
      await json(route, {
        download: {
          url: `https://download.example.com/${current.objectKey}`,
          filename,
          downloadRequestedAt,
        },
      });
      return;
    }

    if (path.match(/^\/api\/assets\/[^/]+\/download$/) && method === 'GET') {
      const id = path.split('/')[3];
      const current = assets.find(asset => asset.id === id);
      if (!current) {
        await json(route, { message: '素材不存在' }, 404);
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'mock asset' });
      return;
    }

    if (path === '/api/assets/upload-signature' && method === 'POST') {
      const payload = postJson<{
        filename: string;
        contentType: string;
        sizeBytes: number;
        source: 'uploaded-video' | 'uploaded-image' | 'uploaded-audio';
        folderId?: string | null;
        idempotencyKey: string;
      }>(route);
      const encodedName = encodeURIComponent(payload.filename);
      let session = uploadSessionsByIdempotencyKey.get(payload.idempotencyKey);
      if (!session) {
        const sessionId = mockUuid(`upload-${payload.idempotencyKey}`);
        session = {
          id: sessionId,
          idempotencyKey: payload.idempotencyKey,
          filename: payload.filename,
          contentType: payload.contentType,
          sizeBytes: payload.sizeBytes,
          source: payload.source,
          folderId: payload.folderId ?? null,
          stagingObjectKey: `users/e2e/upload-staging/${sessionId}/${encodedName}`,
          finalObjectKey: `users/e2e/uploads/${sessionId}/${encodedName}`,
          status: 'pending',
          processingStage: 'waiting-upload',
          progress: 5,
          attempt: 0,
          asset: null,
          expiresAt: '2099-01-01T00:00:00.000Z',
          updatedAt: '2026-07-01T08:59:00.000Z',
        };
        uploadSessionsById.set(session.id, session);
        uploadSessionsByIdempotencyKey.set(session.idempotencyKey, session);
      }
      await json(route, {
        signature: session.status === 'pending' ? {
          driver: 'local',
          method: 'PUT',
          uploadUrl: `${url.origin}/api/mock-storage/${encodedName}`,
          headers: { 'content-type': session.contentType },
          objectKey: session.stagingObjectKey,
          expiresAt: '2099-01-01T00:00:00.000Z',
          sessionId: session.id,
          maxSizeBytes: Math.max(session.sizeBytes, 1024 * 1024),
        } : null,
        session: publicUploadSession(session),
      });
      return;
    }

    if (path === '/api/assets/complete-upload' && method === 'POST') {
      const payload = postJson<{ uploadSessionId: string }>(route);
      const session = uploadSessionsById.get(payload.uploadSessionId);
      if (!session) {
        await json(route, { message: '上传会话不存在' }, 404);
        return;
      }
      if (!session.asset) {
        const type = session.source === 'uploaded-video'
          ? 'video'
          : session.source === 'uploaded-audio'
            ? 'audio'
            : 'image';
        session.asset = uploadedAsset(`asset-uploaded-${session.id}`, {
          name: session.filename,
          type,
          source: session.source,
          folderId: session.folderId,
          objectKey: session.finalObjectKey,
          sizeBytes: session.sizeBytes,
        });
        session.status = 'completed';
        session.processingStage = 'completed';
        session.progress = 100;
        session.attempt = 1;
        session.updatedAt = '2026-07-01T09:00:00.000Z';
        assets = [session.asset, ...assets];
      }
      await json(route, { session: publicUploadSession(session) });
      return;
    }

    if (path.match(/^\/api\/assets\/upload-sessions\/[^/]+$/) && method === 'GET') {
      const id = path.split('/').pop() ?? '';
      const session = uploadSessionsById.get(id);
      if (!session) {
        await json(route, { message: '上传会话不存在' }, 404);
        return;
      }
      await json(route, { session: publicUploadSession(session) });
      return;
    }

    if (path.startsWith('/api/assets/') && method === 'PATCH') {
      const id = path.split('/').pop();
      const payload = postJson<{ name?: string; folderId?: string | null }>(route);
      const current = assets.find(asset => asset.id === id);
      if (!current) {
        await json(route, { message: '素材不存在' }, 404);
        return;
      }

      const updated = {
        ...current,
        name: payload.name ?? current.name,
        folderId: payload.folderId ?? current.folderId,
        updatedAt: '2026-07-01T10:30:00.000Z',
      };
      assets = assets.map(asset => asset.id === id ? updated : asset);
      await json(route, { asset: assetCard(updated) });
      return;
    }

    if (path === '/api/ai/tasks' && method === 'GET') {
      generationTasks = generationTasks.map(task => {
        if (!generationFailuresOnPoll.has(task.id)) return task;
        generationFailuresOnPoll.delete(task.id);
        return {
          ...task,
          status: 'failed' as const,
          failureCategory: 'provider-failed',
          failureReason: '供应商返回失败',
          creditStatus: 'refunded' as const,
          settledCredits: 0,
          refundedCredits: task.reservedCredits,
          completedAt: '2026-07-01T10:05:00.000Z',
        };
      });
      const status = url.searchParams.get('status');
      const kind = url.searchParams.get('kind');
      await json(route, cursorPage((isNewRegisteredUser(currentUser) ? [] : generationTasks).filter(task => (
        (!status || task.status === status)
        && (!kind || task.kind === kind)
      )), url, cursorPageSizeCap));
      return;
    }

    if (path.startsWith('/api/ai/tasks/') && method === 'GET') {
      const id = path.split('/').pop() ?? mockUuid('job-1');
      let task = generationTasks.find(item => item.id === id) ?? { ...job(currentUser.userName, currentUser.email), id, status: 'queued' as const };
      if (generationFailuresOnPoll.has(id)) {
        task = {
          ...task,
          status: 'failed',
          failureCategory: 'provider-failed',
          failureReason: '供应商返回失败',
          creditStatus: 'refunded',
          settledCredits: 0,
          refundedCredits: task.reservedCredits,
          completedAt: '2026-07-01T10:05:00.000Z',
        };
        generationTasks = generationTasks.map(item => item.id === id ? task : item);
        generationFailuresOnPoll.delete(id);
      }
      await json(route, { task });
      return;
    }

    if ((path === '/api/ai/video-tasks/batch' || path === '/api/ai/image-tasks/batch') && method === 'POST') {
      const payload = postJson<{ requests: Array<Record<string, unknown>> }>(route);
      if (containsLegacyGenerationReferenceField(payload)) {
        await json(route, { message: '参考素材载荷必须只包含 assetId 与 role', code: 'INVALID_REFERENCE_PAYLOAD' }, 400);
        return;
      }
      const tasks = payload.requests.map(requestPayload => {
        generationRequests.push(requestPayload);
        const id = mockUuid(`job-${generationRequests.length}`);
        const prompt = String(requestPayload.prompt ?? '');
        const task = {
          ...job(currentUser.userName, currentUser.email),
          id,
          kind: path.includes('/image-tasks/') ? 'image' as const : 'video' as const,
          status: 'queued' as const,
          prompt,
          model: String(requestPayload.model ?? 'Seedance 2.0'),
          config: requestPayload.config ?? {},
          createdAt: `2026-07-01T10:${String(generationRequests.length).padStart(2, '0')}:00+08:00`,
          completedAt: null,
          startedAt: null,
        };
        if (prompt.includes('失败')) generationFailuresOnPoll.add(id);
        return task;
      });
      generationTasks = [...tasks, ...generationTasks];
      await json(route, { tasks });
      return;
    }

    if (path === '/api/assets/bulk-move' && method === 'POST') {
      const payload = postJson<{ assetIds: string[]; folderId: string | null }>(route);
      const assetIds = new Set(payload.assetIds);
      const rootFoldersBySource = new Map<string, string>();
      if (payload.folderId === null) {
        for (const asset of assets.filter(item => assetIds.has(item.id))) {
          const rootFolder = folders.find(item => item.isSystem && item.source === asset.source);
          if (!rootFolder) {
            await json(route, {
              message: '素材系统主目录缺失，请联系管理员',
              code: 'ASSET_ROOT_FOLDER_MISSING',
            }, 500);
            return;
          }
          rootFoldersBySource.set(asset.source, rootFolder.id);
        }
      }
      assets = assets.map(asset => assetIds.has(asset.id)
        ? {
          ...asset,
          folderId: payload.folderId ?? rootFoldersBySource.get(asset.source)!,
        }
        : asset);
      await json(route, { items: assets.filter(asset => assetIds.has(asset.id)).map(assetCard) });
      return;
    }

    if (path === '/api/assets/bulk-delete' && method === 'POST') {
      const payload = postJson<{ assetIds: string[] }>(route);
      assets = assets.filter(asset => !payload.assetIds.includes(asset.id));
      await json(route, { ok: true });
      return;
    }

    if (path === '/api/support/tickets' && method === 'GET') {
      const status = url.searchParams.get('status');
      const priority = url.searchParams.get('priority');
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      await json(route, cursorPage(tickets
        .filter(item => item.email === currentUser.email)
        .filter(item => !status || item.status === status)
        .filter(item => !priority || item.priority === priority)
        .filter(item => !search || [item.title, item.lastMessage].some(value => String(value ?? '').toLocaleLowerCase('zh-CN').includes(search)))
        .map(item => ({ ...item, unreadCount: item.lastMessageAuthor === 'admin' ? item.unreadCount : 0 })), url, cursorPageSizeCap));
      return;
    }

    if (path === '/api/support/summary' && method === 'GET') {
      const visibleTickets = tickets.filter(item => item.email === currentUser.email);
      await json(route, {
        unreadTickets: visibleTickets.filter(item => item.lastMessageAuthor === 'admin' && item.unreadCount > 0).length,
        openTickets: visibleTickets.filter(item => item.status !== 'resolved').length,
        asOf: '2026-07-11T10:00:00.000Z',
      });
      return;
    }

    if (path === '/api/support/tickets' && method === 'POST') {
      const payload = postJson<{ title: string; message: string; priority: 'high' | 'medium' | 'low' }>(route);
      const created = ticket(`ticket-${tickets.length + 1}`, payload.title, currentUser.userName, currentUser.email, {
        priority: payload.priority,
        lastMessage: payload.message,
        messageCount: 1,
        lastMessageAuthor: 'user',
      });
      tickets = [created, ...tickets];
      ticketMessages.set(created.id, [
        ticketMessage(`message-${created.id}-1`, created.id, 'user', currentUser.userName, currentUser.email, payload.message, '2026-06-30T10:10:00.000Z'),
      ]);
      await json(route, { ticket: created });
      return;
    }

    if (path.match(/^\/api\/support\/tickets\/[^/]+\/messages$/) && method === 'GET') {
      const id = path.split('/')[4];
      const delayMs = ticketMessageDelays.get(id) ?? 0;
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
      await json(route, { items: ticketMessages.get(id) ?? [] });
      return;
    }

    if (path.match(/^\/api\/support\/tickets\/[^/]+\/messages$/) && method === 'POST') {
      const id = path.split('/')[4];
      const payload = postJson<{ message: string }>(route);
      const message = ticketMessage(`message-${id}-${Date.now()}`, id, 'user', currentUser.userName, currentUser.email, payload.message, '2026-06-30T10:20:00.000Z');
      ticketMessages.set(id, [...(ticketMessages.get(id) ?? []), message]);
      tickets = tickets.map(item => item.id === id ? { ...item, status: 'open', lastMessage: payload.message, unreadCount: 1, messageCount: item.messageCount + 1, lastMessageAuthor: 'user', lastMessageAt: message.createdAt, updatedAt: message.createdAt } : item);
      await json(route, { message, ticket: tickets.find(item => item.id === id) });
      return;
    }

    if (path.match(/^\/api\/support\/tickets\/[^/]+\/read$/) && method === 'POST') {
      if (userTicketReadFailuresRemaining > 0) {
        userTicketReadFailuresRemaining -= 1;
        await json(route, { message: '模拟用户端已读失败' }, 500);
        return;
      }
      const id = path.split('/')[4];
      tickets = tickets.map(item => item.id === id && item.lastMessageAuthor === 'admin' ? { ...item, unreadCount: 0 } : item);
      await json(route, { ticket: tickets.find(item => item.id === id) });
      return;
    }

    if (path === '/api/payments/create' && method === 'POST') {
      const payload = postJson<{
        planId: string;
        billing: 'monthly' | 'yearly' | 'one-time';
        surface: 'pc' | 'mobile';
        idempotencyKey: string;
      }>(route);
      paymentCreateIdempotencyKeys.push(payload.idempotencyKey);
      const plan = plans.find(item => item.id === payload.planId);
      if (!plan) {
        await json(route, { message: '套餐不存在或未启用' }, 404);
        return;
      }
      const id = `order-payment-${orders.length + 1}`;
      const paymentAttemptId = mockUuid(`payment-attempt-${id}`);
      const created = order(
        id,
        currentUser.userName,
        currentUser.email,
        plan.name,
        payload.billing === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice,
        'pending',
        {
          kind: plan.kind,
          planId: plan.id,
          billing: payload.billing,
          creditStatus: 'none',
          creditAmount: plan.credits,
          merchantOrderNo: `ord_${String(orders.length + 1).padStart(24, '0')}`,
          paymentMethod: '支付宝',
          paymentMethodLabel: '支付宝',
          paymentWayLabel: payload.surface === 'mobile' ? '支付宝手机网页' : '支付宝扫码支付',
          paymentSurface: payload.surface,
          paymentOrderNo: `PAY-${orders.length + 1}`,
          paymentAttemptStatus: paymentCreateAttemptStatus,
          paymentAttemptId,
          paymentAttemptError: paymentCreateAttemptStatus === 'manual-review' ? '支付通道返回字段冲突' : null,
          paymentRetryAfterMs: paymentCreateAttemptStatus === 'processing' ? 3_000 : null,
          paymentExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          ...(plan.kind === 'main' ? {
            estimatedPlanResetAt: '2026-08-09',
            estimatedPlanExpiresAt: payload.billing === 'yearly' ? '2027-07-10' : '2026-08-09',
          } : {}),
          paidAt: null,
        },
      );
      orders = [created, ...orders];
      const payment = payload.surface === 'pc'
        ? {
            surface: 'pc' as const,
            type: 'qr' as const,
            codeUrl: `${desktopPaymentCodeUrl}${desktopPaymentCodeUrl.includes('?') ? '&' : '?'}merchant_order_index=${orders.length}`,
          }
        : paymentLaunchType === 'form'
        ? {
            surface: payload.surface,
            type: 'form' as const,
            action: 'about:blank',
            method: 'GET' as const,
            fields: [{ name: 'order', value: id }],
          }
        : {
            surface: payload.surface,
            type: 'url' as const,
            url: `about:blank?order=${encodeURIComponent(id)}`,
          };
      const launch = paymentCreateAttemptStatus === 'ready' ? payment : null;
      await json(route, {
        order: created,
        paymentAttempt: {
          id: paymentAttemptId,
          attempt: 1,
          status: paymentCreateAttemptStatus,
          launch,
          retryAfterMs: paymentCreateAttemptStatus === 'processing' ? 3_000 : null,
          error: paymentCreateAttemptStatus === 'uncertain' ? '支付服务响应丢失' : null,
          manualReviewReason: paymentCreateAttemptStatus === 'manual-review' ? '支付通道返回字段冲突' : null,
          createdAt: '2026-07-10T10:00:00.000Z',
          updatedAt: '2026-07-10T10:00:00.000Z',
        },
        payment: launch,
        reused: false,
      });
      return;
    }

    if (path.match(/^\/api\/payments\/orders\/[^/]+\/sync$/) && method === 'POST') {
      if (paymentSyncFailuresRemaining > 0) {
        paymentSyncFailuresRemaining -= 1;
        await json(route, { message: '服务器错误' }, 500);
        return;
      }
      const id = path.split('/')[4];
      const current = orders.find(item => item.id === id);
      if (!current) {
        await json(route, { message: '订单不存在' }, 404);
        return;
      }
      const synced = {
        ...current,
        status: paymentSyncFinalStatus,
        paymentAttemptStatus: paymentSyncFinalStatus === 'paid'
          ? 'paid'
          : paymentSyncFinalStatus === 'failed' ? 'failed' : current.paymentAttemptStatus,
        creditStatus: paymentSyncFinalStatus === 'paid' ? 'settled' : current.creditStatus,
        paidAt: paymentSyncFinalStatus === 'paid' ? '2026-07-10T10:05:00.000Z' : null,
        failedAt: paymentSyncFinalStatus === 'failed' ? '2026-07-10T10:05:00.000Z' : null,
      };
      if (current.status !== 'paid' && paymentSyncFinalStatus === 'paid') {
        const purchasedPlan = plans.find(plan => plan.name === current.planName);
        const mainCredits = current.kind === 'main' ? currentUser.mainCredits + current.creditAmount : currentUser.mainCredits;
        const addonCredits = current.kind === 'addon' ? currentUser.addonCredits + current.creditAmount : currentUser.addonCredits;
        currentUser = {
          ...currentUser,
          planCode: current.kind === 'main' ? purchasedPlan?.code ?? currentUser.planCode : currentUser.planCode,
          planName: current.kind === 'main' ? current.planName : currentUser.planName,
          billingCycle: current.kind === 'main' && current.billing !== 'one-time' ? current.billing : currentUser.billingCycle,
          mainCredits,
          addonCredits,
          credits: mainCredits + addonCredits,
          totalCredits: currentUser.totalCredits + current.creditAmount,
          planResetAt: current.kind === 'main' ? '2026-08-09' : currentUser.planResetAt,
          planExpiresAt: current.kind === 'main'
            ? current.billing === 'yearly' ? '2027-07-10' : '2026-08-09'
            : currentUser.planExpiresAt,
        };
      }
      orders = orders.map(item => item.id === id ? synced : item);
      await json(route, { order: synced });
      return;
    }

    if (path.match(/^\/api\/payments\/orders\/[^/]+\/cancel$/) && method === 'POST') {
      const id = path.split('/')[4];
      const current = orders.find(item => item.id === id);
      if (!current) {
        await json(route, { message: '订单不存在' }, 404);
        return;
      }
      const canceled = {
        ...current,
        status: 'failed',
        paymentAttemptStatus: 'closed',
        failedAt: '2026-07-10T10:05:00.000Z',
      };
      orders = orders.map(item => item.id === id ? canceled : item);
      await json(route, { order: canceled });
      return;
    }

    if (path === '/api/orders' && method === 'GET') {
      if (failPaymentRefreshes) {
        await json(route, { message: '服务器错误' }, 500);
        return;
      }
      const status = url.searchParams.get('status');
      const invoiceable = url.searchParams.get('invoiceable') === '1';
      const filtered = orders.filter(item => (
        item.email === currentUser.email
        && (!status || item.status === status)
        && (!invoiceable || (
          item.status === 'paid'
          && item.invoiceStatus === 'unissued'
          && item.invoiceRequestStatus === 'none'
        ))
      ));
      await json(route, cursorPage(filtered, url, cursorPageSizeCap));
      return;
    }

    if (path === '/api/admin/orders/summary' && method === 'GET') {
      const amountFor = (status: string) => orders.filter(item => item.status === status).reduce((sum, item) => sum + item.amount, 0);
      await json(route, {
        totalCount: orders.length,
        totalAmount: orders.reduce((sum, item) => sum + item.amount, 0),
        paidCount: orders.filter(item => item.status === 'paid').length,
        paidAmount: amountFor('paid'),
        pendingCount: orders.filter(item => item.status === 'pending').length,
        refundedCount: orders.filter(item => item.status === 'refunded').length,
        refundedAmount: amountFor('refunded'),
        failedCount: orders.filter(item => item.status === 'failed').length,
        failedAmount: amountFor('failed'),
      });
      return;
    }

    if (path.match(/^\/api\/admin\/orders\/[^/]+$/) && method === 'GET') {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      const current = orders.find(item => item.id === id);
      if (!current) {
        await json(route, { message: '订单不存在' }, 404);
        return;
      }
      await json(route, {
        order: current,
        invoice: invoices.find(item => item.orderId === id) ?? null,
        creditLedger: creditLedger.filter(item => item.relatedOrderId === id),
      });
      return;
    }

    if (path === '/api/admin/orders' && method === 'GET') {
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      const status = url.searchParams.get('status');
      const userId = url.searchParams.get('userId');
      const filtered = orders.filter(item => (
        (!status || item.status === status)
        && (!userId || item.userId === userId)
        && (!search || [item.id, item.merchantOrderNo, item.paymentOrderNo, item.userName, item.email, item.planName]
          .some(value => String(value ?? '').toLocaleLowerCase('zh-CN').includes(search)))
      ));
      await json(route, cursorPage(filtered, url, cursorPageSizeCap));
      return;
    }

    if (path === '/api/admin/users') {
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      const status = url.searchParams.get('status');
      const filtered = users.filter(item => (
        (!status || item.status === status)
        && (!search || [item.userName, item.email].some(value => value.toLocaleLowerCase('zh-CN').includes(search)))
      ));
      await json(route, cursorPage(filtered, url, cursorPageSizeCap));
      return;
    }

    if (path.match(/^\/api\/admin\/users\/[^/]+\/subscription$/) && method === 'PATCH') {
      if (!route.request().headers()['idempotency-key']) {
        await json(route, { message: '后台写操作必须提供幂等键', code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
        return;
      }
      const id = path.split('/')[4];
      const payload = postJson<{
        planId: string | null;
        billingCycle: 'monthly' | 'yearly' | null;
        planResetAt: string | null;
        planExpiresAt: string | null;
        note: string;
        expectedPlanCredits: number;
      }>(route);
      const userIndex = users.findIndex(item => item.id === id);
      const existing = users[userIndex];
      if (!existing) {
        await json(route, { message: '用户不存在' }, 404);
        return;
      }
      const targetPlan = payload.planId ? plans.find(plan => plan.id === payload.planId) : null;
      if (payload.planId && (!targetPlan || targetPlan.kind !== 'main' || targetPlan.status !== 'active')) {
        await json(route, { message: '目标套餐不可分配' }, 400);
        return;
      }
      const standardCredits = targetPlan?.credits ?? 0;
      if (payload.expectedPlanCredits !== standardCredits) {
        await json(route, { message: '套餐标准积分已变化，请刷新后重试', code: 'CONFLICT' }, 409);
        return;
      }
      const mainCredits = existing.planId === payload.planId ? existing.mainCredits : standardCredits;
      const nextUser = {
        ...existing,
        planId: payload.planId,
        planCode: targetPlan?.code ?? null,
        planName: targetPlan?.name ?? null,
        billingCycle: payload.billingCycle ?? 'monthly',
        planCycleStartedAt: '2026-07-17',
        mainCredits,
        credits: mainCredits + existing.addonCredits,
        totalCredits: mainCredits + existing.addonCredits,
        planResetAt: payload.planId ? payload.planResetAt : null,
        planExpiresAt: payload.planId ? payload.planExpiresAt : null,
        activeSubscriptionOrderId: null,
      };
      users.splice(userIndex, 1, nextUser);
      if (currentUser.id === id) {
        currentUser = {
          ...currentUser,
          planCode: nextUser.planCode,
          planName: nextUser.planName,
          billingCycle: nextUser.billingCycle,
          mainCredits: nextUser.mainCredits,
          credits: nextUser.credits,
          totalCredits: nextUser.totalCredits,
          planResetAt: nextUser.planResetAt,
          planExpiresAt: nextUser.planExpiresAt,
        };
      }
      const delta = mainCredits - existing.mainCredits;
      const entry = delta === 0 ? null : ledger(nextUser.userName, nextUser.email, {
        id: mockUuid(`subscription-adjust-${id}-${apiRequestCounts.get(requestKey) ?? 0}`),
        userId: id,
        bucket: 'main',
        amount: delta,
        balance: nextUser.credits,
        source: '后台套餐调整',
        note: targetPlan ? `主套餐已调整为${targetPlan.name}。` : '主套餐已调整为免费版。',
      });
      if (entry) creditLedger = [entry, ...creditLedger];
      await json(route, { user: nextUser, entry });
      return;
    }

    if (path === '/api/admin/credits/adjust' && method === 'POST') {
      if (!route.request().headers()['idempotency-key']) {
        await json(route, { message: '后台写操作必须提供幂等键', code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
        return;
      }
      const payload = postJson<{ userId: string; mainDelta: number; addonDelta: number; note: string }>(route);
      const userIndex = users.findIndex(item => item.id === payload.userId);
      const existing = users[userIndex];
      if (!existing) {
        await json(route, { message: '用户不存在' }, 404);
        return;
      }
      const mainCredits = existing.mainCredits + payload.mainDelta;
      const addonCredits = existing.addonCredits + payload.addonDelta;
      if (mainCredits < 0 || addonCredits < 0) {
        await json(route, { message: '调整后积分不能为负数' }, 400);
        return;
      }
      const nextUser = {
        ...existing,
        mainCredits,
        addonCredits,
        credits: mainCredits + addonCredits,
        totalCredits: mainCredits + addonCredits,
      };
      users.splice(userIndex, 1, nextUser);
      if (currentUser.id === payload.userId) {
        currentUser = {
          ...currentUser,
          mainCredits,
          addonCredits,
          credits: nextUser.credits,
          totalCredits: nextUser.totalCredits,
        };
      }
      const entries = [
        { bucket: 'main', amount: payload.mainDelta },
        { bucket: 'addon', amount: payload.addonDelta },
      ].filter(item => item.amount !== 0).map((item, index) => ledger(nextUser.userName, nextUser.email, {
        id: mockUuid(`credit-adjust-${payload.userId}-${item.bucket}-${apiRequestCounts.get(requestKey) ?? 0}-${index}`),
        userId: payload.userId,
        bucket: item.bucket,
        amount: item.amount,
        balance: nextUser.credits,
        source: '后台积分调整',
        note: item.amount > 0 ? '账户积分已补发。' : '账户积分已由管理员调整。',
      }));
      creditLedger = [...entries, ...creditLedger];
      await json(route, { user: nextUser, entry: entries[0] ?? null, entries });
      return;
    }

    if (path === '/api/admin/invoices') {
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      const status = url.searchParams.get('status');
      const userId = url.searchParams.get('userId');
      const orderId = url.searchParams.get('orderId');
      const allInvoices = adminRefreshScenario === 'fresh-data' ? [...invoices, refreshedInvoice] : invoices;
      const filtered = allInvoices.filter(item => (
        (!status || item.status === status)
        && (!userId || item.userId === userId)
        && (!orderId || item.orderId === orderId)
        && (!search || [item.userName, item.email, item.invoiceTitle, item.taxId, item.planName]
          .some(value => String(value ?? '').toLocaleLowerCase('zh-CN').includes(search)))
      ));
      await json(route, cursorPage(filtered, url, cursorPageSizeCap));
      return;
    }

    if (path.match(/^\/api\/admin\/invoices\/[^/]+\/status$/) && method === 'PATCH') {
      if (!route.request().headers()['idempotency-key']) {
        await json(route, { message: '后台写操作必须提供幂等键', code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
        return;
      }
      const id = path.split('/')[4];
      const payload = postJson<{ status: 'unissued' | 'issued' }>(route);
      invoices = invoices.map(item => item.id === id ? {
        ...item,
        status: payload.status,
        issuedAt: payload.status === 'issued' ? '2026-06-30T10:50:00.000Z' : null,
      } : item);
      await json(route, { invoice: invoices.find(item => item.id === id) });
      return;
    }

    if (path === '/api/admin/tickets') {
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      const status = url.searchParams.get('status');
      const priority = url.searchParams.get('priority');
      const filtered = tickets.filter(item => (
        (!status || item.status === status)
        && (!priority || item.priority === priority)
        && (!search || [item.title, item.userName, item.email, item.lastMessage]
          .some(value => String(value ?? '').toLocaleLowerCase('zh-CN').includes(search)))
      ));
      await json(route, cursorPage(filtered.map(item => ({ ...item, unreadCount: item.lastMessageAuthor === 'user' ? item.unreadCount : 0 })), url, cursorPageSizeCap));
      return;
    }

    if (path.match(/^\/api\/admin\/tickets\/[^/]+\/messages$/) && method === 'GET') {
      const id = path.split('/')[4];
      const delayMs = ticketMessageDelays.get(id) ?? 0;
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
      await json(route, { items: ticketMessages.get(id) ?? [] });
      return;
    }

    if (path.match(/^\/api\/admin\/tickets\/[^/]+\/messages$/) && method === 'POST') {
      const id = path.split('/')[4];
      const payload = postJson<{ message: string }>(route);
      const message = ticketMessage(`message-${id}-${Date.now()}`, id, 'admin', 'Lindyson Support', 'admin@lindyson.ai', payload.message, '2026-06-30T10:30:00.000Z');
      ticketMessages.set(id, [...(ticketMessages.get(id) ?? []), message]);
      tickets = tickets.map(item => item.id === id ? { ...item, status: 'pending', assignee: 'admin@lindyson.ai', lastMessage: payload.message, unreadCount: 1, messageCount: item.messageCount + 1, lastMessageAuthor: 'admin', lastMessageAt: message.createdAt, updatedAt: message.createdAt } : item);
      await json(route, { message, ticket: tickets.find(item => item.id === id) });
      return;
    }

    if (path.match(/^\/api\/admin\/tickets\/[^/]+\/read$/) && method === 'POST') {
      if (adminTicketReadFailuresRemaining > 0) {
        adminTicketReadFailuresRemaining -= 1;
        await json(route, { message: '模拟后台已读失败' }, 500);
        return;
      }
      const id = path.split('/')[4];
      await json(route, { ticket: tickets.find(item => item.id === id) });
      return;
    }

    if (path.match(/^\/api\/admin\/tickets\/[^/]+\/status$/) && method === 'PATCH') {
      const id = path.split('/')[4];
      const payload = postJson<{ status: 'open' | 'pending' | 'resolved' }>(route);
      tickets = tickets.map(item => item.id === id ? { ...item, status: payload.status, updatedAt: '2026-06-30T10:40:00.000Z' } : item);
      await json(route, { ticket: tickets.find(item => item.id === id) });
      return;
    }

    if (path.match(/^\/api\/admin\/assets\/[^/]+\/download$/) && method === 'POST') {
      const id = decodeURIComponent(path.split('/')[4] ?? '');
      const asset = assets.find(item => item.id === id);
      if (!asset) {
        await json(route, { message: '素材不存在' }, 404);
        return;
      }
      const extension = asset.objectKey?.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? '.mp4';
      const filename = `${asset.name.replace(/\.(?:avif|gif|jpe?g|mov|mp3|mp4|mpeg|png|wav|webm|webp)$/i, '')}${extension}`;
      await json(route, {
        download: {
          url: `https://download.example.com/${asset.objectKey}`,
          filename,
        },
      });
      return;
    }

    if (path.match(/^\/api\/admin\/assets\/[^/]+$/) && method === 'GET') {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      const asset = assets.find(item => item.id === id);
      if (!asset) {
        await json(route, { message: '素材不存在' }, 404);
        return;
      }
      await json(route, { asset: assetDetail(asset) });
      return;
    }

    if (path.match(/^\/api\/admin\/jobs\/[^/]+$/) && method === 'GET') {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      const task = generationTasks.find(item => item.id === id);
      if (!task) {
        await json(route, { message: '任务不存在' }, 404);
        return;
      }
      await json(route, { task });
      return;
    }

    if (path === '/api/admin/jobs') {
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      const status = url.searchParams.get('status');
      const userId = url.searchParams.get('userId');
      const filtered = generationTasks.filter(item => (
        (!status || item.status === status)
        && (!userId || item.userId === userId)
        && (!search || [item.id, item.userName, item.email, item.model]
          .some(value => String(value ?? '').toLocaleLowerCase('zh-CN').includes(search)))
      ));
      await json(route, cursorPage(filtered, url, cursorPageSizeCap));
      return;
    }

    if (path === '/api/admin/audit-logs') {
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      const risk = url.searchParams.get('risk');
      const module = url.searchParams.get('module');
      const auditItems = [{
        id: mockUuid('audit-1'),
        adminUserId: currentUser.id,
        createdAt: '2026-06-30T10:00:00.000Z',
        adminEmail: 'admin@lindyson.ai',
        module: '用户管理',
        action: '登录',
        target: currentUser.email,
        risk: 'low',
        ip: '127.0.0.1',
        detail: 'E2E 登录。',
      }].filter(item => (
        (!risk || item.risk === risk)
        && (!module || item.module === module)
        && (!search || [item.adminEmail, item.action, item.target, item.detail]
          .some(value => value.toLocaleLowerCase('zh-CN').includes(search)))
      ));
      await json(route, cursorPage(auditItems, url, cursorPageSizeCap));
      return;
    }

    if (path === '/api/ai/tk-prompt-engine/resume' && method === 'GET') {
      const generation = [...tkPromptGenerations.values()].at(-1) ?? null;
      const run = generation
        ? tkPromptRuns.get(generation.runId) ?? null
        : [...tkPromptRuns.values()].at(-1) ?? null;
      await json(route, { run, generation });
      return;
    }

    if (path === '/api/ai/tk-prompt-engine/settings' && method === 'GET') {
      await json(route, { settings: tkPromptEngineSettings });
      return;
    }

    if (path === '/api/ai/tk-prompt-engine/runs' && method === 'POST') {
      const payload = postJson<{ imageAssetIds?: string[] }>(route);
      const imageAssetIds = payload.imageAssetIds ?? [];
      if (imageAssetIds.length < 1 || imageAssetIds.length > 9) {
        await json(route, { message: '请选择1–9张商品图片' }, 400);
        return;
      }
      const run = createTkPromptRunFixture(imageAssetIds);
      tkPromptRuns.set(run.id, run);
      await json(route, { run }, 202);
      return;
    }

    const tkPromptGenerationCreateMatch = path.match(/^\/api\/ai\/tk-prompt-engine\/runs\/([^/]+)\/generations$/);
    if (tkPromptGenerationCreateMatch && method === 'POST') {
      const run = tkPromptRuns.get(decodeURIComponent(tkPromptGenerationCreateMatch[1] ?? ''));
      if (!run) {
        await json(route, { message: 'TK Prompt Engine任务不存在' }, 404);
        return;
      }
      const payload = postJson<Record<string, any>>(route);
      tkPromptGenerationRequests.push({ runId: run.id, ...payload });
      const generation = createTkPromptGenerationFixture(run, payload);
      tkPromptGenerations.set(generation.id, generation);
      await json(route, { generation }, 202);
      return;
    }

    const tkPromptRunMatch = path.match(/^\/api\/ai\/tk-prompt-engine\/runs\/([^/]+)$/);
    if (tkPromptRunMatch && method === 'GET') {
      const run = tkPromptRuns.get(decodeURIComponent(tkPromptRunMatch[1] ?? ''));
      await json(route, run ? { run } : { message: 'TK Prompt Engine任务不存在' }, run ? 200 : 404);
      return;
    }

    const tkPromptGenerationMatch = path.match(/^\/api\/ai\/tk-prompt-engine\/generations\/([^/]+)$/);
    if (tkPromptGenerationMatch && method === 'GET') {
      const generation = tkPromptGenerations.get(decodeURIComponent(tkPromptGenerationMatch[1] ?? ''));
      await json(route, generation ? { generation } : { message: 'TK Prompt Engine批次不存在' }, generation ? 200 : 404);
      return;
    }

    if (path === '/api/ai/prompt-wizard/resume' && method === 'GET') {
      if (promptWizardLegacyTaskRetired) {
        await json(route, {
          run: null,
          conceptSet: null,
          useDirectionSet: null,
          batch: null,
          planRevision: null,
          legacyTaskRetired: true,
        });
        return;
      }
      if (!promptWizardResumeEnabled) {
        await json(route, {
          run: null,
          conceptSet: null,
          useDirectionSet: null,
          batch: null,
          planRevision: null,
          legacyTaskRetired: false,
        });
        return;
      }
      const run = Array.from(promptWizardRuns.values()).at(-1) ?? null;
      const runBatches = run
        ? (promptWizardBatchIdsByRun.get(run.id) ?? [])
          .map(batchId => promptWizardBatches.get(batchId))
          .filter((batch): batch is MockPromptWizardBatch => Boolean(batch))
        : [];
      // 与真实恢复接口保持一致：活动批次优先；失败批次不覆盖最近成功结果。
      const batch = runBatches.filter(item => (
        item.status === 'queued' || item.status === 'processing'
      )).at(-1) ?? runBatches.filter(item => item.status === 'completed').at(-1) ?? null;
      const useDirectionSet = batch?.useDirectionSetId
        ? promptWizardUseDirectionSets.get(batch.useDirectionSetId) ?? null
        : run
          ? Array.from(promptWizardUseDirectionSets.values()).filter(item => item.runId === run.id).at(-1) ?? null
          : null;
      const planRevision = batch
        ? Array.from(promptWizardPlanRevisions.values()).filter(item => item.batchId === batch.id).at(-1) ?? null
        : null;
      await json(route, { run, conceptSet: null, useDirectionSet, batch, planRevision, legacyTaskRetired: false });
      return;
    }

    if (path === '/api/ai/prompt-wizard/runs' && method === 'POST') {
      const payload = postJson<{ imageAssetIds?: string[]; referenceMode?: string }>(route);
      if (payload.referenceMode !== 'general') {
        await json(route, { message: '提示词向导只支持全能参考模式' }, 400);
        return;
      }
      const imageAssetIds = (payload.imageAssetIds ?? []).map(mockUuid);
      if (imageAssetIds.length < 1 || imageAssetIds.length > 9) {
        await json(route, { message: '请选择 1–9 张产品图片' }, 400);
        return;
      }
      promptWizardRunSequence += 1;
      const now = `2026-07-17T10:${String(promptWizardRunSequence).padStart(2, '0')}:00.000Z`;
      const run: MockPromptWizardRun = {
        id: mockUuid(`prompt-wizard-run-${promptWizardRunSequence}`),
        engineVersion: 4,
        status: 'ready',
        revision: 0,
        imageAssetIds,
        productProfile: {
          productName: '黑色头戴式降噪耳机',
          category: '头戴式耳机',
          colors: '',
          materials: '可见哑光机身与软质耳罩',
          structure: '可折叠头梁、椭圆形耳罩，右耳罩外侧带 Logo',
          logo: '右耳罩外侧可见品牌 Logo',
          usage: '佩戴于耳部，通过耳罩按键操作',
          suggestedAudience: '通勤者、音乐爱好者与需要专注的办公人群',
          suggestedScenarios: '通勤、办公、居家与轻运动',
          visibleFacts: ['黑色哑光机身', '椭圆形软质耳罩', '可折叠头梁'],
          categoryInferredFunctions: ['播放手机音频', '通过耳罩佩戴收听'],
          needsConfirmation: ['主动降噪数值、续航时间与快充效果需要用户确认'],
          userConfirmedClaims: '',
          consistencyConstraints: '保持黑色哑光机身、椭圆耳罩、可折叠头梁和右耳罩 Logo 一致',
        },
        creativeBrief: null,
        videoConfig: null,
        productionBrief: {
          primaryPurchaseReason: '可折叠结构便于收纳',
          appearanceMode: 'hands-only',
          availableScenes: ['通勤桌面', '居家收纳区'],
          availableAssets: ['随身包'],
        },
        evidenceGraph: promptWizardEvidenceGraphFor(imageAssetIds),
        failureReason: null,
        createdAt: now,
        updatedAt: now,
      };
      promptWizardRuns.set(run.id, run);
      await json(route, { run }, 202);
      return;
    }

    const promptWizardConceptSetCreateMatch = path.match(/^\/api\/ai\/prompt-wizard\/runs\/([^/]+)\/concept-sets$/);
    if (promptWizardConceptSetCreateMatch && method === 'POST') {
      await json(route, { message: '提示词流程已升级，请刷新后重新选择使用方向。' }, 410);
      return;
    }

    const promptWizardUseDirectionSetCreateMatch = path.match(/^\/api\/ai\/prompt-wizard\/runs\/([^/]+)\/use-direction-sets$/);
    if (promptWizardUseDirectionSetCreateMatch && method === 'POST') {
      const run = promptWizardRuns.get(promptWizardUseDirectionSetCreateMatch[1] ?? '');
      if (!run) {
        await json(route, { message: '提示词向导任务不存在' }, 404);
        return;
      }
      const payload = postJson<{ revision?: number }>(route);
      if (payload.revision !== run.revision) {
        await json(route, { message: '向导内容已更新，请重试' }, 409);
        return;
      }
      await json(route, { useDirectionSet: promptWizardUseDirectionSetFor(run) }, 202);
      return;
    }

    const promptWizardUseDirectionSetMatch = path.match(/^\/api\/ai\/prompt-wizard\/use-direction-sets\/([^/]+)$/);
    if (promptWizardUseDirectionSetMatch && method === 'GET') {
      const useDirectionSet = promptWizardUseDirectionSets.get(promptWizardUseDirectionSetMatch[1] ?? '');
      await json(route, useDirectionSet ? { useDirectionSet } : { message: '使用方向不存在' }, useDirectionSet ? 200 : 404);
      return;
    }

    const promptWizardBatchCreateMatch = path.match(/^\/api\/ai\/prompt-wizard\/runs\/([^/]+)\/batches$/);
    if (promptWizardBatchCreateMatch && method === 'POST') {
      const run = promptWizardRuns.get(promptWizardBatchCreateMatch[1] ?? '');
      if (!run) {
        await json(route, { message: '提示词向导任务不存在' }, 404);
        return;
      }
      const payload = postJson<{
        revision?: number;
        expectedGenerationCredits?: number;
        voiceoverLanguage?: string;
        verifiedOffer?: string;
        videoConfig?: NonNullable<MockPromptWizardRun['videoConfig']>;
      }>(route);
      if (payload.revision !== run.revision) {
        await json(route, { message: '向导内容已更新，请重试' }, 409);
        return;
      }
      const priorBatchIds = promptWizardBatchIdsByRun.get(run.id) ?? [];
      const completedBatchCount = priorBatchIds.filter(batchId => (
        promptWizardBatches.get(batchId)?.status === 'completed'
      )).length;
      if (payload.expectedGenerationCredits !== promptWizardSettings.generationCredits) {
        await json(route, { message: '生成方案积分已变化，请重新确认' }, 409);
        return;
      }
      promptWizardBatchSequence += 1;
      const now = new Date(Date.now() - promptWizardBatchSequence * 1_000).toISOString();
      const durationSeconds = payload.videoConfig?.durationSeconds;
      const isSoundDesignOnly = durationSeconds === 5;
      if (
        !durationSeconds
        || (isSoundDesignOnly && payload.voiceoverLanguage !== undefined)
        || (!isSoundDesignOnly && !payload.voiceoverLanguage)
      ) {
        await json(route, { message: '请先确认视频参数与声音模式' }, 400);
        return;
      }
      promptWizardRuns.set(run.id, {
        ...run,
        creativeBrief: isSoundDesignOnly
          ? {
            audioMode: 'sound-design-only',
            verifiedOffer: payload.verifiedOffer ?? '',
          }
          : {
            audioMode: 'voiceover',
            voiceoverLanguage: payload.voiceoverLanguage!,
            verifiedOffer: payload.verifiedOffer ?? '',
          },
        videoConfig: payload.videoConfig,
        updatedAt: now,
      });
      const isFree = completedBatchCount === 0;
      const shouldFailInitialBatch = promptWizardFailNextInitialBatch && isFree;
      const shouldFailWithRefund = promptWizardFailNextPaidBatch && !isFree;
      if (shouldFailInitialBatch) promptWizardFailNextInitialBatch = false;
      if (shouldFailWithRefund) promptWizardFailNextPaidBatch = false;
      const shouldFail = shouldFailInitialBatch || shouldFailWithRefund;
      const deferredOutcome = promptWizardNextDeferredBatchOutcome;
      promptWizardNextDeferredBatchOutcome = null;
      const completedPlans = promptWizardV6PlansFor(
        payload.voiceoverLanguage,
        payload.videoConfig.durationSeconds,
        completedBatchCount,
      );
      const batch: MockPromptWizardBatch = {
        id: mockUuid(`prompt-wizard-batch-${promptWizardBatchSequence}`),
        runId: run.id,
        status: deferredOutcome ? 'queued' : shouldFail ? 'failed' : 'completed',
        isFree,
        credits: isFree ? 0 : promptWizardSettings.generationCredits,
        creditStatus: isFree || promptWizardSettings.generationCredits === 0
          ? 'none'
          : deferredOutcome ? 'held' : shouldFailWithRefund ? 'refunded' : 'settled',
        plans: deferredOutcome || shouldFail ? [] : completedPlans,
        conceptSetId: null,
        selectedConceptIds: [],
        useDirectionSetId: null,
        selectedUseDirectionId: null,
        selectedSceneId: null,
        customScene: null,
        routeSetId: mockUuid(`prompt-wizard-v6-route-set-${promptWizardBatchSequence}`),
        failureReason: deferredOutcome ? null : shouldFailInitialBatch
          ? 'AI 返回内容未通过脚本结构与事实校验，本批次未交付。'
          : shouldFailWithRefund ? '方案生成失败，已退回积分。' : null,
        createdAt: now,
        completedAt: deferredOutcome ? null : now,
      };
      promptWizardBatches.set(batch.id, batch);
      promptWizardBatchIdsByRun.set(run.id, [...priorBatchIds, batch.id]);
      if (deferredOutcome) {
        promptWizardDeferredBatches.set(batch.id, {
          outcome: deferredOutcome,
          completedPlans,
          pollCount: 0,
        });
      }
      await json(route, { batch }, 202);
      return;
    }

    const promptWizardRefinementCreateMatch = path.match(
      /^\/api\/ai\/prompt-wizard\/batches\/([^/]+)\/plans\/([^/]+)\/refinements$/,
    );
    if (promptWizardRefinementCreateMatch && method === 'POST') {
      const [, batchId = '', planId = ''] = promptWizardRefinementCreateMatch;
      const batch = promptWizardBatches.get(batchId);
      const sourcePlan = batch?.plans.find(plan => plan.id === planId);
      if (!batch || !sourcePlan || sourcePlan.deliveryVersion !== 5) {
        await json(route, { message: '当前方案不支持定向微调' }, 400);
        return;
      }
      const payload = postJson<{ action?: string; replacementScene?: string }>(route);
      promptWizardRefinementRequests.push({ batchId, planId, ...payload });
      promptWizardPlanRevisionSequence += 1;
      const refinedPlanId = mockUuid(`prompt-wizard-refined-plan-${promptWizardPlanRevisionSequence}`);
      const refinedPlan = {
        ...sourcePlan,
        id: refinedPlanId,
        name: `微调后·${String(sourcePlan.name)}`,
        hook: '耳机在第一秒完成折叠并进入随身包，立即回答能否轻松收纳',
        variant: sourcePlan.variant,
        prompt: `${String(sourcePlan.prompt)}\n微调要求：第一秒直接完成折叠动作。`,
      };
      const planIndex = batch.plans.findIndex(plan => plan.id === planId) as 0 | 1;
      const revision = {
        id: mockUuid(`prompt-wizard-plan-revision-${promptWizardPlanRevisionSequence}`),
        batchId,
        sourcePlanId: planId,
        conceptId: null,
        useDirectionId: (sourcePlan.useDirection as Record<string, string>).id,
        planIndex,
        action: payload.action,
        status: 'completed',
        isFree: true,
        plan: refinedPlan,
        failureReason: null,
        createdAt: '2026-08-01T01:02:00.000Z',
        completedAt: '2026-08-01T01:02:08.000Z',
      };
      promptWizardPlanRevisions.set(revision.id, revision);
      await json(route, { revision }, 202);
      return;
    }

    const promptWizardPlanRevisionMatch = path.match(/^\/api\/ai\/prompt-wizard\/plan-revisions\/([^/]+)$/);
    if (promptWizardPlanRevisionMatch && method === 'GET') {
      const revision = promptWizardPlanRevisions.get(promptWizardPlanRevisionMatch[1] ?? '');
      await json(route, revision ? { revision } : { message: '方案修订不存在' }, revision ? 200 : 404);
      return;
    }

    const promptWizardRunMatch = path.match(/^\/api\/ai\/prompt-wizard\/runs\/([^/]+)$/);
    if (promptWizardRunMatch && method === 'GET') {
      const run = promptWizardRuns.get(promptWizardRunMatch[1] ?? '');
      await json(route, run ? { run } : { message: '提示词向导任务不存在' }, run ? 200 : 404);
      return;
    }

    if (promptWizardRunMatch && method === 'PATCH') {
      const run = promptWizardRuns.get(promptWizardRunMatch[1] ?? '');
      if (!run) {
        await json(route, { message: '提示词向导任务不存在' }, 404);
        return;
      }
      const payload = postJson<Partial<MockPromptWizardRun> & { revision?: number }>(route);
      if (payload.revision !== run.revision) {
        await json(route, { message: '向导内容已更新，请重试' }, 409);
        return;
      }
      const updatedRun: MockPromptWizardRun = {
        ...run,
        productProfile: payload.productProfile ?? run.productProfile,
        creativeBrief: payload.creativeBrief ?? run.creativeBrief,
        videoConfig: payload.videoConfig ?? run.videoConfig,
        productionBrief: payload.productionBrief ?? run.productionBrief,
        revision: run.revision + 1,
        updatedAt: '2026-07-17T11:00:00.000Z',
      };
      promptWizardRuns.set(run.id, updatedRun);
      await json(route, { run: updatedRun });
      return;
    }

    const promptWizardBatchMatch = path.match(/^\/api\/ai\/prompt-wizard\/batches\/([^/]+)$/);
    if (promptWizardBatchMatch && method === 'GET') {
      const batchId = promptWizardBatchMatch[1] ?? '';
      let batch = promptWizardBatches.get(batchId);
      const deferred = promptWizardDeferredBatches.get(batchId);
      if (batch && deferred && promptWizardDeferredBatchPollingEnabled) {
        deferred.pollCount += 1;
        if (deferred.pollCount === 1) {
          batch = { ...batch, status: 'processing' };
        } else {
          const completedAt = new Date().toISOString();
          batch = deferred.outcome === 'completed'
            ? {
                ...batch,
                status: 'completed',
                creditStatus: batch.isFree || batch.credits === 0 ? 'none' : 'settled',
                plans: deferred.completedPlans,
                failureReason: null,
                completedAt,
              }
            : {
                ...batch,
                status: 'failed',
                creditStatus: batch.isFree || batch.credits === 0 ? 'none' : 'refunded',
                plans: [],
                failureReason: '方案生成失败，已退回积分。',
                completedAt,
              };
          promptWizardDeferredBatches.delete(batchId);
        }
        promptWizardBatches.set(batchId, batch);
      }
      await json(route, batch ? { batch } : { message: '提示词批次不存在' }, batch ? 200 : 404);
      return;
    }

    if (path === '/api/ai/consumption-settings') {
      await json(route, {
        items: consumptionSettings,
        promptWizard: promptWizardSettings,
        tkPromptEngine: tkPromptEngineSettings,
        videoModels: videoModelCapabilities,
      });
      return;
    }

    if (path === '/api/admin/tk-prompt-engine-settings' && method === 'PATCH') {
      const payload = postJson<{ generationCredits?: number; available?: boolean; schemaVersion?: unknown }>(route);
      if ('schemaVersion' in payload) {
        await json(route, { message: '不允许修改TK Prompt Engine协议版本' }, 400);
        return;
      }
      tkPromptEngineSettingsRequests.push(payload);
      tkPromptEngineSettings = {
        schemaVersion: 1,
        generationCredits: typeof payload.generationCredits === 'number'
          ? payload.generationCredits
          : tkPromptEngineSettings.generationCredits,
        available: typeof payload.available === 'boolean'
          ? payload.available
          : tkPromptEngineSettings.available,
        updatedAt: '2026-08-17T12:00:00.000Z',
      };
      await json(route, { settings: tkPromptEngineSettings });
      return;
    }

    if (path === '/api/admin/prompt-wizard-settings' && method === 'PATCH') {
      const payload = postJson<{ generationCredits?: number; available?: boolean; engineVersion?: unknown }>(route);
      if ('engineVersion' in payload) {
        await json(route, { message: '不允许修改提示词向导引擎版本' }, 400);
        return;
      }
      promptWizardSettingsRequests.push(payload);
      promptWizardSettings = {
        generationCredits: typeof payload.generationCredits === 'number'
          ? payload.generationCredits
          : promptWizardSettings.generationCredits,
        available: typeof payload.available === 'boolean'
          ? payload.available
          : promptWizardSettings.available,
        engineVersion: 4,
        updatedAt: '2026-07-17T12:00:00.000Z',
      };
      await json(route, { promptWizard: promptWizardSettings });
      return;
    }

    if (path.startsWith('/api/admin/consumption-settings/video-models/') && path.endsWith('/availability') && method === 'PATCH') {
      const payload = postJson<{ available: boolean }>(route);
      consumptionSettings = consumptionSettings.map(setting => (
        setting.model === 'Seedance 2.5' ? { ...setting, available: payload.available } : setting
      ));
      await json(route, {
        items: consumptionSettings,
        promptWizard: promptWizardSettings,
        videoModels: videoModelCapabilities,
      });
      return;
    }

    if (path.startsWith('/api/admin/consumption-settings/') && method === 'PATCH') {
      const payload = postJson<{ credits?: number; referenceVideoCredits?: number; available?: boolean }>(route);
      const id = path.split('/').pop();
      const setting = consumptionSettings.find(item => item.id === id);
      if (setting && typeof payload.credits === 'number') setting.credits = payload.credits;
      if (setting && typeof payload.referenceVideoCredits === 'number') {
        setting.referenceVideoCredits = payload.referenceVideoCredits;
      }
      if (setting && typeof payload.available === 'boolean') setting.available = payload.available;
      await json(route, { setting });
      return;
    }

    if (path === '/api/admin/feature-flags' && method === 'GET') {
      await json(route, { flags: featureFlags });
      return;
    }

    if (path === '/api/admin/feature-flags' && method === 'PATCH') {
      const payload = postJson<Partial<MockFeatureFlags>>(route);
      featureFlags = { ...featureFlags, ...payload };
      await json(route, { flags: featureFlags });
      return;
    }

    if (path === '/api/admin/api-usage/image/overview' && method === 'GET') {
      await json(route, imageCostOverviewForRequest(url));
      return;
    }

    if (path === '/api/admin/api-usage/image/users' && method === 'GET') {
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      const items = imageCostUsers.filter(item => (
        !search || [item.userName, item.email, item.userId]
          .some(value => value.toLocaleLowerCase('zh-CN').includes(search))
      ));
      await json(route, {
        ...cursorPage(items, url, cursorPageSizeCap),
        asOf: apiCostAsOf,
        selection: apiCostSelectionForRequest(url),
      });
      return;
    }

    if (path === '/api/admin/api-usage/image/tasks' && method === 'GET') {
      const status = url.searchParams.get('status');
      const evidenceStatus = url.searchParams.get('evidenceStatus');
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      const items = imageCostTasks.filter(item => (
        (!status || item.status === status)
        && (!evidenceStatus || item.evidenceStatus === evidenceStatus)
        && (!search || [item.taskId, item.userName, item.email]
          .some(value => value.toLocaleLowerCase('zh-CN').includes(search)))
      ));
      await json(route, {
        ...cursorPage(items, url, cursorPageSizeCap),
        asOf: apiCostAsOf,
        selection: apiCostSelectionForRequest(url),
      });
      return;
    }

    if (path === '/api/admin/api-usage/multimodal/overview' && method === 'GET') {
      await json(route, multimodalOverviewForRequest(url));
      return;
    }

    if (path === '/api/admin/api-usage/multimodal/users' && method === 'GET') {
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      const items = multimodalUsers.filter(item => (
        !search || [item.name, item.email, item.userId]
          .some(value => value.toLocaleLowerCase('zh-CN').includes(search))
      ));
      await json(route, {
        ...cursorPage(items, url, cursorPageSizeCap),
        asOf: apiCostAsOf,
        selection: apiCostSelectionForRequest(url),
      });
      return;
    }

    if (path === '/api/admin/api-usage/multimodal/operations' && method === 'GET') {
      const operationType = url.searchParams.get('operationType');
      const status = url.searchParams.get('status');
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      const items = multimodalOperations.filter(item => (
        (!operationType || item.operationType === operationType)
        && (!status || item.status === status)
        && (!search || [item.runId, item.batchId ?? '', item.userName, item.email]
          .some(value => value.toLocaleLowerCase('zh-CN').includes(search)))
      ));
      await json(route, {
        ...cursorPage(items, url, cursorPageSizeCap),
        asOf: apiCostAsOf,
        selection: apiCostSelectionForRequest(url),
      });
      return;
    }

    if (path.startsWith('/api/admin/api-usage/reconciliation/') && method === 'GET') {
      await json(route, { bucket: apiCostReconciliation[0], evidence: [] });
      return;
    }

    if (path === '/api/admin/api-usage/reconciliation' && method === 'GET') {
      await json(route, {
        ...cursorPage(apiCostReconciliation, url, cursorPageSizeCap),
        asOf: apiCostAsOf,
        selection: apiCostSelectionForRequest(url),
      });
      return;
    }

    if (path === '/api/admin/api-usage/settlement' && method === 'GET') {
      await json(route, {
        ...cursorPage(apiCostSettlementItems, url, cursorPageSizeCap),
        asOf: apiCostAsOf,
        selection: apiCostSelectionForRequest(url),
        summary: apiCostSettlementSummary,
      });
      return;
    }

    if (path === '/api/admin/api-usage/tasks' && method === 'GET') {
      if (adminRefreshScenario === 'fail-next-api-cost-tasks') {
        adminRefreshScenario = 'default';
        await json(route, { message: '任务成本加载失败', code: 'REPORT_TIMEOUT', requestId: 'mock-task-timeout' }, 503);
        return;
      }
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      const status = url.searchParams.get('status');
      const model = url.searchParams.get('model');
      const items = apiCostTasks.filter(item => (
        (!status || item.status === status)
        && (!model || item.model === model)
        && (!search || [item.taskId, item.userName, item.email].some(value => value.toLocaleLowerCase('zh-CN').includes(search)))
      ));
      await json(route, {
        ...cursorPage(items, url, cursorPageSizeCap),
        asOf: apiCostAsOf,
        selection: apiCostSelectionForRequest(url),
      });
      return;
    }

    if (path === '/api/admin/api-usage/attempts' && method === 'GET') {
      const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN') ?? '';
      const items = apiCostAttempts.filter(item => (
        (!url.searchParams.get('model') || item.model === url.searchParams.get('model'))
        && (!url.searchParams.get('pricingResolution') || (item.resolution === '720p' ? '480p-720p' : item.resolution) === url.searchParams.get('pricingResolution'))
        && (!url.searchParams.get('inputClass') || item.inputClass === url.searchParams.get('inputClass'))
        && (!url.searchParams.get('status') || item.status === url.searchParams.get('status'))
        && (!url.searchParams.get('usageEvidenceOrigin') || item.usageEvidenceOrigin === url.searchParams.get('usageEvidenceOrigin'))
        && (!url.searchParams.get('pricingRuleStatus') || item.pricingRuleStatus === url.searchParams.get('pricingRuleStatus'))
        && (!url.searchParams.get('attributionConfidence') || item.attributionConfidence === url.searchParams.get('attributionConfidence'))
        && (!search || [item.taskId, item.providerTaskId ?? '', item.userName, item.email].some(value => value.toLocaleLowerCase('zh-CN').includes(search)))
      ));
      await json(route, {
        ...cursorPage(items, url, cursorPageSizeCap),
        asOf: apiCostAsOf,
        selection: apiCostSelectionForRequest(url),
      });
      return;
    }

    if (path === '/api/admin/api-usage/users' && method === 'GET') {
      if (adminRefreshScenario === 'fail-next-api-cost-users') {
        adminRefreshScenario = 'default';
        await json(route, { message: '用户成本加载失败', code: 'REPORT_TIMEOUT', requestId: 'mock-user-timeout' }, 503);
        return;
      }
      await json(route, {
        ...cursorPage(apiCostUsers, url, cursorPageSizeCap),
        asOf: apiCostAsOf,
        selection: apiCostSelectionForRequest(url),
      });
      return;
    }

    if (path === '/api/admin/provider-billing/sync' && method === 'POST') {
      apiCostSyncRevision += 1;
      await json(route, { accepted: true, scope: 'all' }, 202);
      return;
    }

    if (path === '/api/admin/api-usage/overview' && method === 'GET') {
      if (adminRefreshScenario === 'fail-next-api-cost-overview') {
        adminRefreshScenario = 'default';
        await json(route, { message: '成本汇总加载失败', code: 'REPORT_TIMEOUT', requestId: 'mock-overview-timeout' }, 503);
        return;
      }
      if (adminRefreshScenario === 'fresh-data') {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      await json(route, apiCostOverviewForRequest(url));
      return;
    }

    if (path === '/api/admin/api-usage' && method === 'GET') {
      if (adminRefreshScenario === 'delay-next-api-cost-audit') {
        adminRefreshScenario = 'default';
        await new Promise(resolve => setTimeout(resolve, 600));
      }
      if (adminRefreshScenario === 'fresh-data') {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      await json(route, apiCostDashboardForRequest(url));
      return;
    }

    await json(route, { ok: true });
  });
}

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test('数字资产页面没有严重或致命的自动化无障碍问题', async ({ page }) => {
  await page.goto('/app/digital-assets');
  await expect(page.getByRole('heading', { name: '数字资产' })).toBeVisible();
  await expect(page.getByTestId('digital-asset-grid')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include('main')
    .analyze();
  const severeViolations = results.violations.filter(violation => (
    violation.impact === 'serious' || violation.impact === 'critical'
  ));

  expect(severeViolations, JSON.stringify(severeViolations, null, 2)).toEqual([]);
});

async function prepareMultiPageOrders(page: Page) {
  const items = Array.from({ length: 3 }, (_, index) => order(
    `pagination-layout-${index}`,
    '管理员',
    'admin@lindyson.ai',
    '专业版',
    2900,
    'paid',
    { createdAt: `2026-07-0${index + 1}T10:00:00.000Z` },
  ));
  await page.evaluate(async items => {
    await (window as any).__setOrders(items);
    await (window as any).__setCursorPageSizeCap(1);
  }, items);
}

async function holdMediaRequest(page: Page, url: string) {
  const requestedUrls: string[] = [];
  let releaseGate!: () => void;
  let released = false;
  const gate = new Promise<void>(resolve => {
    releaseGate = resolve;
  });
  await page.route(url, async route => {
    requestedUrls.push(route.request().url());
    await gate;
    await route.abort();
  });
  return {
    requestedUrls,
    release() {
      if (released) return;
      released = true;
      releaseGate();
    },
  };
}

async function holdFirstApiRequest(page: Page, url: string) {
  let releaseGate!: () => void;
  let released = false;
  let firstRequest = true;
  let requestCount = 0;
  const gate = new Promise<void>(resolve => {
    releaseGate = resolve;
  });
  await page.route(url, async route => {
    requestCount += 1;
    if (firstRequest) {
      firstRequest = false;
      await gate;
    }
    await route.fallback();
  });
  return {
    get requestCount() {
      return requestCount;
    },
    release() {
      if (released) return;
      released = true;
      releaseGate();
    },
  };
}

async function json(route: Route, body: unknown, status = 200) {
  const responseBody = status >= 400 && body !== null && typeof body === 'object' && !Array.isArray(body)
    ? { code: `HTTP_${status}`, requestId: `e2e-${status}`, ...body }
    : body;
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(responseBody),
  });
}

function cursorPage<Item>(items: Item[], url: URL, pageSizeCap: number | null) {
  const requestedLimit = Math.max(1, Number(url.searchParams.get('limit') ?? 100));
  const limit = pageSizeCap === null ? requestedLimit : Math.min(requestedLimit, pageSizeCap);
  const position = url.searchParams.get('position') ?? 'first';
  const rawCursor = url.searchParams.get('cursor');
  const lastOffset = items.length === 0 ? 0 : Math.floor((items.length - 1) / limit) * limit;
  const offset = position === 'last'
    ? lastOffset
    : position === 'first'
      ? 0
      : rawCursor === null ? 0 : Math.max(0, Math.min(lastOffset, Number(rawCursor)));
  const pageItems = items.slice(offset, offset + limit);
  const hasPrevious = offset > 0;
  const hasNext = offset + limit < items.length;
  const totalPages = items.length === 0 ? 0 : Math.ceil(items.length / limit);
  const currentPage = items.length === 0 ? 0 : Math.floor(offset / limit) + 1;
  return {
    items: pageItems,
    pagination: {
      limit,
      hasPrevious,
      hasNext,
      previousCursor: hasPrevious ? String(Math.max(0, offset - limit)) : null,
      nextCursor: hasNext ? String(offset + limit) : null,
      currentPage,
      totalPages,
      totalItems: items.length,
      snapshotCursor: `snapshot-${items.length}-${limit}`,
    },
  };
}

function assetCardsPage(items: Array<Record<string, any>>, url: URL, pageSizeCap: number | null) {
  const sort = url.searchParams.get('sort') === 'created-asc' ? 'created-asc' : 'created-desc';
  const sortedItems = [...items].sort((left, right) => {
    const createdAtComparison = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    const idComparison = String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0;
    const comparison = createdAtComparison || idComparison;
    return sort === 'created-asc' ? comparison : -comparison;
  });
  const page = cursorPage(sortedItems.map(assetCard), url, pageSizeCap);
  return {
    ...page,
    pagination: {
      ...page.pagination,
      position: url.searchParams.get('position') ?? 'first',
    },
  };
}

function assetCard(asset: Record<string, any>) {
  const extension = typeof asset.objectKey === 'string'
    ? asset.objectKey.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? null
    : null;
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    source: asset.source,
    folderId: asset.folderId ?? null,
    previewUrl: asset.type === 'audio' ? null : asset.thumbnailUrl ?? null,
    sizeBytes: asset.sizeBytes,
    durationSeconds: asset.durationSeconds ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    mediaExtension: extension,
    views: asset.views ?? 0,
    firstDownloadAt: asset.downloadRequestedAt ?? asset.downloadedAt ?? null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function assetDetail(asset: Record<string, any>) {
  const generation = asset.generation && typeof asset.generation === 'object'
    ? safeGenerationDetail(asset.generation as Record<string, any>)
    : null;
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    source: asset.source,
    folderId: asset.folderId ?? null,
    publicUrl: asset.publicUrl,
    thumbnailUrl: asset.type === 'audio' ? null : asset.thumbnailUrl ?? null,
    sizeBytes: asset.sizeBytes,
    durationSeconds: asset.durationSeconds ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    generation,
    views: asset.views ?? 0,
    downloadedAt: asset.downloadedAt ?? null,
    downloadRequestedAt: asset.downloadRequestedAt ?? null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function safeGenerationDetail(generation: Record<string, any>) {
  const config = generation.config && typeof generation.config === 'object'
    ? generation.config as Record<string, any>
    : {};
  const safeConfig = {
    ...copyFields(config, ['mode', 'aspectRatio', 'resolution', 'durationSeconds', 'generateAudio', 'outputSize', 'ratio']),
    ...(Array.isArray(config.referenceImages) ? { referenceImages: config.referenceImages.map(safeAssetReference) } : {}),
    ...(Array.isArray(config.referenceAssets) ? { referenceAssets: config.referenceAssets.map(safeAssetReference) } : {}),
  };
  return {
    kind: generation.kind,
    model: generation.model,
    prompt: generation.prompt ?? '',
    ...(typeof generation.credits === 'number' ? { credits: generation.credits } : {}),
    config: safeConfig,
  };
}

function safeAssetReference(reference: Record<string, any>) {
  return {
    id: reference.id,
    name: reference.name,
    type: reference.type,
    ...(typeof reference.role === 'string' ? { role: reference.role } : {}),
    previewUrl: reference.previewUrl ?? reference.thumbnailUrl ?? reference.thumbnail ?? null,
    ...(typeof reference.durationSeconds === 'number' ? { durationSeconds: reference.durationSeconds } : {}),
    ...(typeof reference.sizeBytes === 'number' ? { sizeBytes: reference.sizeBytes } : {}),
  };
}

function copyFields(source: Record<string, any>, fields: string[]) {
  return Object.fromEntries(fields.flatMap(field => source[field] === undefined ? [] : [[field, source[field]]]));
}

function containsLegacyGenerationReferenceField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsLegacyGenerationReferenceField);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const forbidden = ['objectKey', 'thumbnailKey', 'publicUrl', 'url', 'referenceImages', 'referenceAssets'];
  return forbidden.some(field => field in record) || Object.values(record).some(containsLegacyGenerationReferenceField);
}

function assetSummary(items: Array<Record<string, any>>) {
  const sources = ['ai-video', 'ai-image', 'uploaded-video', 'uploaded-image', 'uploaded-audio'] as const;
  const folderCounts = new Map<string | null, number>();
  for (const asset of items) {
    const folderId = asset.folderId ?? null;
    folderCounts.set(folderId, (folderCounts.get(folderId) ?? 0) + 1);
  }
  return {
    total: items.length,
    byType: {
      video: items.filter(item => item.type === 'video').length,
      image: items.filter(item => item.type === 'image').length,
      audio: items.filter(item => item.type === 'audio').length,
    },
    bySource: Object.fromEntries(sources.map(source => [source, items.filter(item => item.source === source).length])),
    downloaded: items.filter(item => item.downloadRequestedAt || item.downloadedAt).length,
    notDownloaded: items.filter(item => !item.downloadRequestedAt && !item.downloadedAt).length,
    folderCounts: [...folderCounts.entries()].map(([folderId, count]) => ({ folderId, count })),
  };
}

async function expectDashboardStat(page: Page, label: string, value: string) {
  const card = page.getByText(label, { exact: true }).locator('..');
  await expect(card.getByText(value, { exact: true })).toBeVisible();
}

async function expectPageMetadata(page: Page, metadata: PageMetadata) {
  await expect(page).toHaveTitle(metadata.title);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', metadata.description);
}

async function expectFolderListItemBefore(page: Page, firstName: string, secondName: string) {
  const folderList = page.getByTestId('digital-asset-folder-sidebar');
  const order = await folderList.getByRole('button', { name: /^打开文件夹 / }).evaluateAll(buttons => (
    buttons.map(button => button.getAttribute('aria-label') ?? '')
  ));
  const firstIndex = order.findIndex(label => label.startsWith(`打开文件夹 ${firstName}，`));
  const secondIndex = order.findIndex(label => label.startsWith(`打开文件夹 ${secondName}，`));
  expect(firstIndex).toBeGreaterThanOrEqual(0);
  expect(secondIndex).toBeGreaterThanOrEqual(0);
  expect(firstIndex).toBeLessThan(secondIndex);
}

async function fillAdminInput(scope: Locator, label: string, value: string) {
  await scope.locator('label').filter({ hasText: label }).locator('input').fill(value);
}

async function fillAdminTextarea(scope: Locator, label: string, value: string) {
  await scope.locator('label').filter({ hasText: label }).locator('textarea').fill(value);
}

function adminAnnouncementRow(page: Page, title: string) {
  return page.getByRole('row').filter({ hasText: title });
}

function postJson<T>(route: Route): T {
  return route.request().postDataJSON() as T;
}

function announcement(id: string, title: string, content: string, pinned: boolean, publishedAt: string): MockAnnouncement {
  return {
    id: mockUuid(id),
    title,
    content,
    pinned,
    publishedAt,
    createdAt: publishedAt,
    updatedAt: publishedAt,
  };
}

function sortAnnouncementsForApi(items: MockAnnouncement[]) {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
}

function account(userName: string, email: string, role: 'admin' | 'user' = 'admin') {
  return {
    id: mockUuid(`user-${email}`),
    userName,
    email,
    role,
    status: 'active' as const,
    planCode: 'free' as string | null,
    planName: '免费版' as string | null,
    portraitEntitlements: {
      enabled: true,
      profileLimit: 1,
      activeLimit: 1,
      assetsPerActor: 1 as const,
    },
    billingCycle: 'monthly',
    mainCredits: 100,
    addonCredits: 0,
    credits: 100,
    totalCredits: 100,
    planResetAt: '2026-07-30' as string | null,
    planExpiresAt: '2026-07-30' as string | null,
    registeredAt: '2026-06-30T10:00:00.000Z',
    lastActiveAt: '2026-06-30T10:00:00.000Z',
  };
}

function adminUser(user: ReturnType<typeof account>) {
  return {
    id: user.id,
    userName: user.userName,
    email: user.email,
    role: user.role,
    planId: user.planCode && user.planCode !== 'free' ? mockUuid(`plan-${user.planCode}`) : null,
    planCode: user.planCode,
    planName: user.planName,
    billingCycle: user.billingCycle,
    planCycleStartedAt: '2026-06-30',
    mainCredits: user.mainCredits,
    addonCredits: user.addonCredits,
    credits: user.credits,
    totalCredits: user.totalCredits,
    planResetAt: user.planResetAt,
    planExpiresAt: user.planExpiresAt,
    activeSubscriptionOrderId: null,
    status: user.status,
    registeredAt: '2026-06-30T10:00:00.000Z',
    lastActiveAt: '2026-06-30T10:00:00.000Z',
    orderCount: 1,
    apiCalls: 0,
    ticketCount: 0,
  };
}

function isNewRegisteredUser(user: ReturnType<typeof account>) {
  return user.email === 'new.user@lindyson.ai';
}

function folder(id: string, name: string, source: string, isSystem: boolean, createdAt = '2026-06-30T10:00:00.000Z') {
  return { id: mockUuid(id), name, source, isSystem, createdAt };
}

function sortFoldersForApi(items: ReturnType<typeof folder>[]) {
  return [...items].sort((left, right) => (
    Number(right.isSystem) - Number(left.isSystem)
    || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    || right.id.localeCompare(left.id)
  ));
}

function videoAsset(id: string, name: string, folderId: string, model: string, durationSeconds = 10) {
  const assetId = mockUuid(id);
  return {
    id: assetId,
    name,
    type: 'video',
    source: 'ai-video',
    folderId,
    objectKey: `users/e2e/${id}.mp4`,
    thumbnailKey: `users/e2e/${id}-thumbnail.jpg`,
    sizeBytes: 256 * 1024 * 1024,
    durationSeconds,
    width: 1280,
    height: 720,
    createdAt: '2026-06-30T10:00:00.000Z',
    updatedAt: '2026-06-30T10:00:00.000Z',
    downloadedAt: null as string | null,
    downloadRequestedAt: null as string | null,
    thumbnailUrl: 'https://images.unsplash.com/photo-1536240478700-b869ad10e2a3?w=400&q=80',
    publicUrl: `https://cdn.example.com/${assetId}.mp4`,
    views: 860,
    generation: {
      kind: 'video',
      model,
      prompt: `${name} 生成提示词`,
      config: {
        mode: 'general',
        aspectRatio: '16:9',
        resolution: '720p',
        durationSeconds: 10,
        referenceImages: [
          {
            id: mockUuid('ref-expired-thumbnail'),
            name: '过期参考图',
            type: 'image',
            thumbnail: 'https://cdn.example.com/ref-preview-signed.png',
            thumbnailUrl: 'https://cdn.example.com/ref-preview-signed.png',
            objectKey: 'users/e2e/ref-image.png',
            thumbnailKey: 'users/e2e/ref-image-thumb.png',
          },
        ],
        referenceAssets: [
          {
            id: mockUuid('ref-expired-thumbnail'),
            name: '过期参考图',
            type: 'image',
            thumbnail: 'https://cdn.example.com/ref-preview-signed.png',
            thumbnailUrl: 'https://cdn.example.com/ref-preview-signed.png',
            objectKey: 'users/e2e/ref-image.png',
            thumbnailKey: 'users/e2e/ref-image-thumb.png',
          },
        ],
      },
      credits: 35,
    },
  };
}

function uploadedAsset(id: string, payload: {
  name: string;
  type: 'video' | 'image' | 'audio';
  source: 'uploaded-video' | 'uploaded-image' | 'uploaded-audio';
  folderId?: string | null;
  objectKey: string;
  publicUrl?: string;
  sizeBytes: number;
  durationSeconds?: number | null;
}) {
  const assetId = mockUuid(id);
  return {
    id: assetId,
    name: payload.name,
    type: payload.type,
    source: payload.source,
    folderId: payload.folderId ?? (
      payload.source === 'uploaded-video'
        ? mockUuid('system-folder-uploaded-video')
        : payload.source === 'uploaded-audio'
          ? mockUuid('system-folder-uploaded-audio')
          : mockUuid('system-folder-uploaded-image')
    ),
    objectKey: payload.objectKey,
    thumbnailKey: null as string | null,
    sizeBytes: payload.sizeBytes,
    durationSeconds: payload.durationSeconds ?? (payload.type === 'video' ? 6 : null),
    width: payload.type === 'image' ? 1200 : payload.type === 'video' ? 1280 : null,
    height: payload.type === 'image' ? 800 : payload.type === 'video' ? 720 : null,
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-01T09:00:00.000Z',
    downloadedAt: null as string | null,
    downloadRequestedAt: null as string | null,
    thumbnailUrl: payload.type === 'audio' ? null : payload.publicUrl ?? `https://cdn.example.com/${assetId}`,
    publicUrl: payload.publicUrl ?? `https://cdn.example.com/${assetId}`,
    views: 0,
  };
}

function order(
  id: string,
  userName: string,
  email: string,
  planName: string,
  amount: number,
  status: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: mockUuid(id),
    userId: mockUuid(`user-${email}`),
    userName,
    email,
    planId: mockUuid(planName === '免费版' ? 'plan-free' : `plan-${planName}`),
    kind: 'main',
    planName,
    amount,
    billing: 'monthly',
    status,
    invoiceStatus: 'unissued',
    invoiceRequestStatus: null,
    creditStatus: 'settled',
    creditAmount: 100,
    creditBucket: 'main',
    paymentMethod: 'alipay',
    paymentMethodLabel: '支付宝',
    paymentWayLabel: '支付宝电脑网站',
    paymentProvider: 'jeepay',
    paymentWayCode: null,
    paymentSurface: null,
    merchantOrderNo: `ord_${id}`,
    paymentOrderNo: `PAY-${id}`,
    paymentError: null,
    paymentAttemptStatus: status === 'paid' || status === 'refunded'
      ? 'paid'
      : status === 'failed' ? 'failed' : 'ready',
    paymentAttemptId: null,
    paymentAttemptError: null,
    paymentRetryAfterMs: null,
    createdAt: '2026-06-30T10:00:00.000Z',
    paymentExpiresAt: '2026-06-30T12:00:00.000Z',
    paidAt: status === 'paid' ? '2026-06-30T10:01:00.000Z' : null,
    failedAt: null,
    refundedAt: null,
    refundStatus: 'none',
    merchantRefundNo: null,
    refundOrderNo: null,
    refundError: null,
    refundAttemptStatus: null,
    refundAttemptId: null,
    refundManualReviewReason: null,
    refundRetryAfterMs: null,
    ...overrides,
  };
}

function paidPlan(overrides: Partial<MockPlan> = {}): MockPlan {
  return {
    id: mockUuid('plan-pro'),
    name: '专业版',
    nameEn: 'Pro',
    code: 'pro',
    kind: 'main',
    billing: 'both',
    description: '适合稳定产出短视频和素材',
    monthlyPrice: 2900,
    yearlyPrice: 22800,
    credits: 30000,
    assetRetentionDays: 30,
    portraitEntitlements: {
      enabled: true,
      profileLimit: 5,
      activeLimit: 3,
      assetsPerActor: 2,
    },
    storage: '100GB',
    tiktokAccounts: '5',
    features: [
      { text: 'Seedance 视频生成', enabled: true },
      { text: 'Seedream 5.0 Pro 图片生成', enabled: true },
      { text: 'TikTok 发布工作区', enabled: false },
    ],
    recommendation: 'popular',
    iconKey: 'sparkles',
    ctaLabel: '升级专业版',
    status: 'active',
    landingVisible: true,
    subscribers: 10,
    revenue: 228000,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-07-10T10:00:00.000Z',
    ...overrides,
  };
}

function addonPlan(overrides: Partial<MockPlan> = {}): MockPlan {
  return {
    id: mockUuid('plan-addon-30000'),
    name: '30000 积分加购包',
    nameEn: '30000 Credits Pack',
    code: 'addon-30000',
    kind: 'addon',
    billing: 'one-time',
    description: '一次性补充积分，不改变套餐周期',
    monthlyPrice: 5900,
    yearlyPrice: 0,
    credits: 30000,
    assetRetentionDays: 0,
    portraitEntitlements: {
      enabled: false,
      profileLimit: 0,
      activeLimit: 0,
      assetsPerActor: 0,
    },
    storage: '不增加',
    tiktokAccounts: '不增加',
    features: [],
    recommendation: null,
    iconKey: null,
    ctaLabel: '购买加购包',
    status: 'active',
    landingVisible: false,
    subscribers: 0,
    revenue: 0,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-07-10T10:00:00.000Z',
    ...overrides,
  };
}

function ticket(id: string, title: string, userName: string, email: string, overrides: Record<string, unknown> = {}) {
  return {
    id: mockUuid(id),
    userId: mockUuid(`user-${email}`),
    title,
    userName,
    email,
    priority: 'medium',
    status: 'open',
    assignee: 'Lindyson Support',
    createdAt: '2026-06-30T10:00:00.000Z',
    updatedAt: '2026-06-30T10:00:00.000Z',
    slaHours: 24,
    lastMessage: '生成任务状态需要人工协助确认。',
    internalNote: 'E2E 数据。',
    unreadCount: 0,
    messageCount: 1,
    lastMessageAuthor: 'user',
    lastMessageAt: '2026-06-30T10:00:00.000Z',
    ...overrides,
  };
}

function ticketMessage(id: string, ticketId: string, authorRole: 'user' | 'admin', authorName: string, authorEmail: string, body: string, createdAt: string) {
  return {
    id: mockUuid(id),
    ticketId: mockUuid(ticketId),
    authorRole,
    authorName,
    authorEmail,
    body,
    createdAt,
  };
}

function ledger(userName: string, email: string, overrides: Record<string, unknown> = {}) {
  return {
    id: mockUuid('ledger-1'),
    userId: mockUuid(`user-${email}`),
    createdAt: '2026-06-30T10:00:00.000Z',
    userName,
    email,
    type: 'adjust',
    bucket: 'main',
    settlementStatus: 'settled',
    amount: 100,
    balance: 100,
    source: '后台积分调整',
    operator: 'system',
    note: '管理员手动调整积分。',
    relatedOrderId: null,
    relatedJobId: null,
    relatedAssetId: null,
    generationSnapshot: null,
    ...overrides,
  };
}

function job(userName: string, email: string) {
  return {
    id: mockUuid('job-1'),
    userId: mockUuid(`user-${email}`),
    createdAt: '2026-06-30T10:00:00.000Z',
    userName,
    email,
    kind: 'video',
    model: 'Seedance 2.0',
    status: 'completed',
    failureCategory: null,
    failureReason: null,
    credits: 20,
    reservedCredits: 20,
    settledCredits: 20,
    refundedCredits: 0,
    creditStatus: 'settled',
    mainCreditsUsed: 20,
    addonCreditsUsed: 0,
    prompt: '生成产品展示视频',
    config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5, referenceImages: [], referenceAssets: [] },
    assetId: assetBrandId,
    assetName: '品牌故事视频',
    assetSource: 'ai-video',
    retryCount: 0,
    attempt: 0,
    processingStage: 'completed',
    providerTaskId: null,
    settlementError: null,
    ledgerIds: [] as string[],
    heartbeatAt: null,
    leaseExpiresAt: null,
    completedAt: '2026-06-30T10:02:00.000Z',
    startedAt: '2026-06-30T10:01:00.000Z',
    updatedAt: '2026-06-30T10:02:00.000Z',
  };
}

function dashboardTrend(tasks: Array<{ kind: string }>) {
  const videos = tasks.filter(task => task.kind === 'video').length;
  const images = tasks.filter(task => task.kind === 'image').length;

  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 5, 18 + index));
    const day = date.toISOString().slice(0, 10);
    return {
      day,
      videos: day === '2026-07-11' ? videos : 0,
      images: day === '2026-07-11' ? images : 0,
    };
  });
}

function normalizeGenerationTaskFixture(
  item: ReturnType<typeof job> & Record<string, unknown>,
  fallbackUser: ReturnType<typeof account>,
) {
  const userName = typeof item.userName === 'string' ? item.userName : fallbackUser.userName;
  const email = typeof item.email === 'string' ? item.email : fallbackUser.email;
  const base = job(userName, email);
  return {
    ...base,
    ...item,
    id: mockUuid(typeof item.id === 'string' ? item.id : base.id),
    userId: mockUuid(typeof item.userId === 'string' ? item.userId : `user-${email}`),
    assetId: typeof item.assetId === 'string' ? mockUuid(item.assetId) : item.assetId ?? null,
    createdAt: normalizeMockIsoDateTime(item.createdAt, base.createdAt),
    startedAt: item.startedAt === null ? null : normalizeMockIsoDateTime(item.startedAt, base.startedAt),
    completedAt: item.completedAt === null ? null : normalizeMockIsoDateTime(item.completedAt, base.completedAt),
    updatedAt: normalizeMockIsoDateTime(item.updatedAt ?? item.completedAt ?? item.createdAt, base.updatedAt),
  };
}

function consumption(
  id: string,
  kind: string,
  model: string,
  modelLabel: string,
  durationSeconds: number | null,
  resolution: string | null,
  credits: number,
  available = true,
  referenceVideoCredits: number | null = kind === 'video' ? credits : null,
) {
  return {
    id: mockUuid(id),
    kind,
    model,
    modelLabel,
    durationSeconds,
    resolution: resolution ?? '',
    credits,
    referenceVideoCredits,
    available,
    updatedAt: '2026-06-30T10:00:00.000Z',
  };
}

function seedance25Capability(available = true) {
  return {
    id: 'seedance-2.5',
    label: 'Seedance 2.5',
    available,
    recommended: true,
    resolutions: ['480p', '720p'],
    durationSeconds: [5, 10, 15, 20, 25, 30],
    modes: ['general', 'first-last'],
    aspectRatios: {
      general: ['9:16', '16:9'],
      firstLast: ['adaptive'],
    },
    references: {
      maxTotal: 50,
      maxImages: 30,
      maxVideos: 10,
      maxAudios: 10,
      maxVideoDurationSeconds: 30,
      maxAudioDurationSeconds: 30,
      allowAudioOnly: true,
    },
    supportsPromptWizard: false,
    supportsRealPortrait: false,
    outputFormat: 'mp4',
    generateAudio: true,
  };
}

function seedance25ConsumptionRows() {
  const productionPrices = {
    '480p': {
      5: [46, 28], 10: [77, 47], 15: [107, 65], 20: [143, 86], 25: [179, 108], 30: [214, 129],
    },
    '720p': {
      5: [77, 47], 10: [153, 92], 15: [229, 138], 20: [306, 184], 25: [382, 230], 30: [458, 275],
    },
  } as const;
  return (['480p', '720p'] as const).flatMap(resolution => (
    ([5, 10, 15, 20, 25, 30] as const).map(durationSeconds => consumption(
      `cons-video-25-${durationSeconds}-${resolution}`,
      'video',
      'Seedance 2.5',
      'Seedance 2.5',
      durationSeconds,
      resolution,
      productionPrices[resolution][durationSeconds][0],
      true,
      productionPrices[resolution][durationSeconds][1],
    ))
  ));
}

function seedance25ReferenceAssets({
  imageCount = 30,
  videoCount = 10,
  audioCount = 10,
}: {
  imageCount?: number;
  videoCount?: number;
  audioCount?: number;
} = {}) {
  const images = Array.from({ length: imageCount }, (_, index) => ({
    id: mockUuid(`asset-seedance-25-retry-image-${index + 1}`),
    name: `重试参考图片${index + 1}`,
    type: 'image' as const,
    role: 'reference_image' as const,
    previewUrl: `https://cdn.example.com/seedance-25-retry-image-${index + 1}.png`,
    sizeBytes: 1024 + index,
  }));
  const videos = Array.from({ length: videoCount }, (_, index) => ({
    id: mockUuid(`asset-seedance-25-retry-video-${index + 1}`),
    name: `重试参考视频${index + 1}`,
    type: 'video' as const,
    role: 'reference_video' as const,
    previewUrl: `https://cdn.example.com/seedance-25-retry-video-${index + 1}.mp4`,
    durationSeconds: 3,
    sizeBytes: 2048 + index,
  }));
  const audios = Array.from({ length: audioCount }, (_, index) => ({
    id: mockUuid(`asset-seedance-25-retry-audio-${index + 1}`),
    name: `重试参考音频${index + 1}`,
    type: 'audio' as const,
    role: 'reference_audio' as const,
    previewUrl: `https://cdn.example.com/seedance-25-retry-audio-${index + 1}.mp3`,
    durationSeconds: 3,
    sizeBytes: 1024 * 1024 + index,
  }));
  return [...images, ...videos, ...audios];
}

function seedance25FailedTask(
  references = seedance25ReferenceAssets(),
  id = 'job-seedance-25-failed-retry',
) {
  return {
    ...job('管理员', 'admin@lindyson.ai'),
    id,
    model: 'Seedance 2.5',
    status: 'failed' as const,
    failureCategory: 'provider-failed',
    failureReason: '当前组合参数校验失败，请修改后重试',
    credits: 230,
    reservedCredits: 230,
    settledCredits: 0,
    refundedCredits: 55,
    creditStatus: 'refunded' as const,
    prompt: '保留这条 Seedance 2.5 失败任务的提示词',
    config: {
      mode: 'general',
      aspectRatio: '16:9',
      resolution: '720p',
      durationSeconds: 25,
      generateAudio: true,
      referenceImages: [],
      referenceAssets: references,
    },
    assetId: null,
    assetName: null,
    assetSource: null,
    processingStage: 'failed',
    completedAt: '2026-07-01T10:05:00.000Z',
    updatedAt: '2026-07-01T10:05:00.000Z',
  };
}

function mockUuid(value: string) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    first = Math.imul(first ^ value.charCodeAt(index), 0x01000193) >>> 0;
    second = Math.imul(second ^ value.charCodeAt(value.length - index - 1), 0x85ebca6b) >>> 0;
  }
  const hex = `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}${((first ^ second) >>> 0).toString(16).padStart(8, '0')}${(Math.imul(first, second) >>> 0).toString(16).padStart(8, '0')}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function normalizeMockIsoDateTime(value: unknown, fallback: string | null) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  if (value.endsWith('Z') || /[+-][0-9]{2}:[0-9]{2}$/.test(value)) return value;
  return `${value}+08:00`;
}

test('用户仪表盘聚合失败时明确提示且不使用任务列表伪造累计', async ({ page }) => {
  await page.evaluate(() => (window as any).__setFailDashboardSummary(true));
  await page.goto('/app');

  await expect(page.getByText(/累计生成统计暂不可用/)).toBeVisible();
  await expectDashboardStat(page, '累计生成次数', '—');
  await expectDashboardStat(page, '累计视频生成', '—');
  await expectDashboardStat(page, '累计图片生成', '—');
  await expect(page.getByText('创作趋势暂不可用')).toBeVisible();
  await expect(page.getByText('工具统计暂不可用')).toBeVisible();
  await expect(page.getByText('Seedance 2.0 视频任务', { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/ai/tasks'))).toBe(0);
});

test('创作趋势使用近7日和近30日滚动范围且首尾日期完整可见', async ({ page }) => {
  await page.goto('/app');

  const rangeTabs = page.getByRole('tablist', { name: '创作趋势时间范围' });
  const lastSevenDays = rangeTabs.getByRole('tab', { name: '近7日' });
  const lastThirtyDays = rangeTabs.getByRole('tab', { name: '近30日' });
  await expect(lastSevenDays).toHaveAttribute('aria-selected', 'true');
  await expect(lastThirtyDays).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('tab', { name: '本周' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '本月' })).toHaveCount(0);

  const trendCard = page.getByRole('heading', { name: '创作趋势' })
    .locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');
  await expect(trendCard.locator('svg.recharts-surface').getByText('7月11日', { exact: true })).toBeVisible();
  await expect(trendCard.locator('svg.recharts-surface').getByText('7月17日', { exact: true })).toBeVisible();
  await expect(trendCard.locator('svg.recharts-surface').getByText('6月18日', { exact: true })).toHaveCount(0);

  await lastThirtyDays.click();
  await expect(lastThirtyDays).toHaveAttribute('aria-selected', 'true');
  const firstLabel = trendCard.locator('svg.recharts-surface').getByText('6月18日', { exact: true });
  const lastLabel = trendCard.locator('svg.recharts-surface').getByText('7月17日', { exact: true });
  await expect(firstLabel).toBeVisible();
  await expect(lastLabel).toBeVisible();

  const chartBox = await trendCard.locator('svg.recharts-surface').boundingBox();
  const firstLabelBox = await firstLabel.boundingBox();
  const lastLabelBox = await lastLabel.boundingBox();
  if (!chartBox || !firstLabelBox || !lastLabelBox) {
    throw new Error('创作趋势图表或日期刻度未完成渲染');
  }
  expect(firstLabelBox.x).toBeGreaterThanOrEqual(chartBox.x - 1);
  expect(lastLabelBox.x + lastLabelBox.width).toBeLessThanOrEqual(chartBox.x + chartBox.width + 1);
});

test('用户端恢复原始黑底和彩色强调且组件应用统一主题', async ({ page }, testInfo) => {
  const attachCurrentPage = async (name: string) => {
    await testInfo.attach(name, {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
  };

  await page.goto('/app');

  const statAccents = [
    ['累计生成次数', 'violet'],
    ['累计视频生成', 'blue'],
    ['累计图片生成', 'pink'],
    ['已授权TikTok账号', 'slate'],
  ] as const;

  for (const [label, accent] of statAccents) {
    const card = page.getByText(label, { exact: true }).locator('..');
    await expect(card).toHaveAttribute('data-ui', 'card');
    await expect(card).toHaveAttribute('data-accent', accent);
    await expect(card).toHaveCSS('background-image', /radial-gradient/);
  }

  await expect(page.getByText('当前最常用的生成模型是', { exact: false })).toHaveCount(0);
  const toolUsageList = page.getByRole('list', { name: '工具使用占比明细' });
  const seedreamUsage = toolUsageList.getByRole('listitem').filter({ hasText: 'Seedream 5.0 Pro' });
  await expect(seedreamUsage).toContainText('0%');

  const trendPlot = page.getByRole('img', { name: '近7日 AI视频与AI图片生成趋势' });
  await expect(trendPlot).toHaveCSS('background-color', 'rgb(9, 9, 15)');

  const announcementCard = page.getByRole('heading', { name: '平台公告' })
    .locator('xpath=ancestor::div[@data-ui="card"][1]');
  await expect(announcementCard).toHaveAttribute('data-accent', 'warm');
  await expect(announcementCard).toHaveCSS('background-color', 'rgb(16, 14, 13)');
  await attachCurrentPage('dashboard-accent-surfaces');

  await page.goto('/app/digital-assets');
  await expect(page.getByRole('heading', { name: '数字资产' })).toBeVisible();
  const assetSummary = page.getByRole('region', { name: '资产统计' });
  const assetStatAccents = [
    ['全部资产', 'violet'],
    ['视频文件', 'blue'],
    ['图片文件', 'pink'],
    ['音频文件', 'cyan'],
  ] as const;
  for (const [label, accent] of assetStatAccents) {
    const card = assetSummary.getByText(label, { exact: true }).locator('..');
    await expect(card).toHaveAttribute('data-ui', 'card');
    await expect(card).toHaveAttribute('data-accent', accent);
  }
  await attachCurrentPage('digital-assets-accent-surfaces');

  await page.goto('/app/ai-studio');
  await expect(page.getByRole('heading', { name: 'AI Studio' })).toBeVisible();
  const videoStudioTab = page.getByRole('tab', { name: 'AI 视频' });
  const imageStudioTab = page.getByRole('tab', { name: 'AI 图片' });
  await expect(videoStudioTab).toHaveAttribute('data-accent', 'violet');
  await expect(videoStudioTab).toHaveAttribute('data-state', 'active');
  await expect(imageStudioTab).toHaveAttribute('data-accent', 'pink');
  await expect(imageStudioTab).toHaveAttribute('data-state', 'inactive');
  await expect(page.getByText('参考素材', { exact: true }).first().locator('xpath=ancestor::div[@data-ui="card"][1]')).toHaveAttribute('data-accent', 'violet');
  await expect(page.getByTestId('ai-studio-video-controls').locator('xpath=ancestor::div[@data-ui="card"][1]')).toHaveAttribute('data-accent', 'blue');
  await attachCurrentPage('ai-studio-accent-surfaces');

  await page.goto('/app/account-center');
  await expect(page.getByRole('heading', { name: '账户中心' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '积分概览' }).locator('xpath=ancestor::div[@data-ui="card"][1]')).toHaveAttribute('data-accent', 'pink');
  await attachCurrentPage('account-center-accent-surfaces');

  await page.goto('/app/subscription');
  await expect(page.getByRole('heading', { name: '选择适合你的套餐' })).toBeVisible();
  await expect(page.getByRole('button', { name: '当前套餐' }).locator('xpath=ancestor::div[@data-ui="card"][1]')).toHaveAttribute('data-accent', 'violet');
  await attachCurrentPage('subscription-accent-surfaces');

  await page.goto('/app/tiktok-accounts');
  await expect(page.getByRole('heading', { name: '管理TikTok账号' })).toBeVisible();
  await expect(page.getByText('已授权账号', { exact: true }).locator('xpath=ancestor::div[@data-ui="card"][1]')).toHaveAttribute('data-accent', 'slate');
  await attachCurrentPage('tiktok-accounts-neutral-surfaces');

  await page.goto('/app/tiktok-publish');
  await expect(page.getByRole('heading', { name: '发布至 TikTok 账号' })).toBeVisible();
  await expect(page.locator('[aria-labelledby="tiktok-publish-assets-title"]')).toHaveAttribute('data-accent', 'none');
  await attachCurrentPage('tiktok-publish-neutral-surfaces');
});

test('用户端工作台在多档视口展示六列9:16作品且无名称日期与横向溢出', async ({ page }, testInfo) => {
  const completedProjects = Array.from({ length: 6 }, (_, index) => ({
    ...job('管理员', 'admin@lindyson.ai'),
    id: mockUuid(`dashboard-project-${index}`),
    assetId: assetBrandId,
    assetName: `成果项目 ${index + 1}`,
    createdAt: `2026-06-30T0${index + 1}:00:00.000Z`,
    completedAt: `2026-06-30T0${index + 1}:02:00.000Z`,
  }));
  await page.evaluate(tasks => (window as any).__setGenerationTasks(tasks), [
    ...completedProjects,
    {
      ...job('管理员', 'admin@lindyson.ai'),
      id: mockUuid('dashboard-project-failed'),
      status: 'failed',
      assetId: null,
      assetName: '不应显示的失败任务',
      completedAt: '2026-06-30T08:02:00.000Z',
    },
  ]);

  const viewports = [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'laptop', width: 1280, height: 900 },
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'large', width: 1920, height: 1080 },
    { name: 'wide', width: 2560, height: 1440 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: '创作趋势时间范围' })).toBeVisible();
    await expect(page.getByText('按生成模型汇总', { exact: true })).toBeVisible();
    await expect(page.getByText('按生成模型汇总，不以颜色作为唯一识别方式', { exact: true })).toHaveCount(0);

    const shell = page.locator('.product-shell');
    await expect(shell).toBeVisible();
    const shellVisual = await shell.evaluate(element => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, fontFamily: style.fontFamily };
    });
    expect(shellVisual.backgroundColor).toBe('rgb(5, 5, 7)');
    expect(shellVisual.fontFamily).toContain('Geist Sans');
    expect(shellVisual.fontFamily).toContain('MiSans');
    expect(shellVisual.fontFamily).toContain('PingFang SC');

    const appPageBox = await page.locator('[data-app-page="true"]').first().boundingBox();
    if (!appPageBox) throw new Error(`${viewport.name} 用户端页面容器未完成布局`);
    expect(appPageBox.width).toBeLessThanOrEqual(Math.min(1600, viewport.width) + 1);

    const recentProjectTrack = page.getByTestId('dashboard-recent-project-track');
    const recentProjectList = recentProjectTrack.getByRole('list', { name: '最近完成成果' });
    const recentProjectCards = page.getByTestId('dashboard-recent-project-card');
    const trackBox = await recentProjectTrack.boundingBox();
    if (!trackBox) throw new Error(`${viewport.name} 最近项目轨道未完成布局`);
    await expect(recentProjectCards).toHaveCount(6);
    await expect(page.getByText('不应显示的失败任务', { exact: true })).toHaveCount(0);
    await expect(page.getByText('成果项目 1', { exact: true })).toHaveCount(0);
    await expect(recentProjectTrack.getByText('2026-06-30', { exact: true })).toHaveCount(0);
    await expect(recentProjectCards.first()).toHaveAccessibleName('预览视频成果：成果项目 6，生成于 2026-06-30');
    await expect(page.getByRole('button', { name: '查看下一组最近项目' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查看上一组最近项目' })).toHaveCount(0);
    await expect(page.getByText('01 / 06', { exact: true })).toHaveCount(0);
    await expect(recentProjectTrack.locator(':scope > .h-px')).toHaveCount(0);

    const cardTexts = await recentProjectCards.allTextContents();
    expect(cardTexts.every(text => !text.includes('2026-06-30'))).toBe(true);
    expect(cardTexts.every(text => !text.includes('成果项目'))).toBe(true);
    expect(cardTexts.every(text => !/(刚刚|分钟前|小时前|天前)/.test(text))).toBe(true);

    const recentProjectCovers = page.getByTestId('dashboard-recent-project-cover');
    expect(await recentProjectCovers.count()).toBeGreaterThan(0);
    for (let index = 0; index < await recentProjectCovers.count(); index += 1) {
      const coverBox = await recentProjectCovers.nth(index).boundingBox();
      if (!coverBox) throw new Error(`${viewport.name} 最近项目封面未完成布局`);
      expect(coverBox.width / coverBox.height).toBeCloseTo(9 / 16, 3);
      const cardBox = await recentProjectCards.nth(index).boundingBox();
      if (!cardBox) throw new Error(`${viewport.name} 最近项目卡片未完成布局`);
      expect(cardBox.height - coverBox.height).toBeLessThanOrEqual(2);
    }

    const recentProjectThumbnails = page.getByTestId('dashboard-recent-project-thumbnail');
    await expect(recentProjectThumbnails).toHaveCount(6);
    const thumbnailLayer = await recentProjectThumbnails.first().evaluate(element => {
      const style = getComputedStyle(element);
      return { position: style.position, zIndex: style.zIndex };
    });
    expect(thumbnailLayer).toEqual({ position: 'absolute', zIndex: '10' });

    const recentProjectKinds = page.getByTestId('dashboard-recent-project-kind');
    const recentProjectDates = page.getByTestId('dashboard-recent-project-date');
    await expect(recentProjectKinds).toHaveCount(6);
    await expect(recentProjectDates).toHaveCount(0);
    await expect(recentProjectKinds.first()).toBeVisible();
    await expect(recentProjectKinds.first()).toHaveCSS('z-index', '20');

    if (viewport.width < 768) {
      const firstMobileCardBox = await recentProjectCards.first().boundingBox();
      if (!firstMobileCardBox) throw new Error(`${viewport.name} 手机成果卡片未完成布局`);
      expect(firstMobileCardBox.width).toBeCloseTo(140, 0);
      const mobileScrollState = await recentProjectList.evaluate(element => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: getComputedStyle(element).overflowX,
      }));
      expect(mobileScrollState.scrollWidth).toBeGreaterThan(mobileScrollState.clientWidth);
      expect(mobileScrollState.overflowX).toBe('auto');
      await recentProjectList.evaluate(element => {
        element.scrollLeft = element.scrollWidth;
      });
      await expect.poll(() => recentProjectList.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      await recentProjectList.evaluate(element => { element.scrollLeft = 0; });
    } else {
      const desktopLayout = await recentProjectList.evaluate(element => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        display: getComputedStyle(element).display,
      }));
      expect(desktopLayout.display).toBe('grid');
      expect(desktopLayout.scrollWidth).toBeLessThanOrEqual(desktopLayout.clientWidth + 1);

      const cardBoxes = await recentProjectCards.evaluateAll(cards => cards.map(card => {
        const box = card.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top };
      }));
      expect(Math.max(...cardBoxes.map(box => box.top)) - Math.min(...cardBoxes.map(box => box.top))).toBeLessThanOrEqual(1);
      expect(cardBoxes.every(box => box.left >= trackBox.x - 1 && box.right <= trackBox.x + trackBox.width + 1)).toBe(true);
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    const screenshotPath = testInfo.outputPath(`dashboard-${viewport.width}.png`);
    await page.screenshot({ animations: 'disabled', fullPage: true, path: screenshotPath });
    await testInfo.attach(`dashboard-${viewport.name}-${viewport.width}x${viewport.height}`, {
      path: screenshotPath,
      contentType: 'image/png',
    });
    const trendCard = page.getByRole('img', { name: '近7日 AI视频与AI图片生成趋势' }).locator('xpath=ancestor::div[@data-ui="card"][1]');
    const trendScreenshotPath = testInfo.outputPath(`dashboard-trend-${viewport.width}.png`);
    await trendCard.screenshot({ animations: 'disabled', path: trendScreenshotPath });
    await testInfo.attach(`dashboard-trend-${viewport.width}`, { path: trendScreenshotPath, contentType: 'image/png' });
  }
});

test('最近完成成果点击后才加载详情并打开只读素材预览', async ({ page }) => {
  await page.goto('/app');

  const detailRequest = `GET /api/assets/${assetBrandId}`;
  const projectCard = page.getByRole('button', { name: /预览视频成果：品牌故事视频，生成于 2026-06-30/ });
  await expect(projectCard).toBeVisible();
  await expect(projectCard.getByText('2026-06-30', { exact: true })).toHaveCount(0);
  await expect(projectCard.getByText('品牌故事视频', { exact: true })).toHaveCount(0);
  expect(await projectCard.textContent()).not.toMatch(/刚刚|分钟前|小时前|天前/);
  await expect.poll(() => page.evaluate(key => (window as any).__getApiRequestCount(key), detailRequest)).toBe(0);

  await projectCard.focus();
  await expect(projectCard).toBeFocused();
  await projectCard.press('Enter');

  await expect(page.getByRole('heading', { name: '素材预览' })).toBeVisible();
  await expect(page.getByText('品牌故事视频', { exact: true }).last()).toBeVisible();
  await expect.poll(() => page.evaluate(key => (window as any).__getApiRequestCount(key), detailRequest)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '素材预览' })).toHaveCount(0);
  await expect(projectCard).toBeFocused();
});

test('首页源 HTML、应用壳、robots 与 sitemap 符合收录边界', async ({ request }) => {
  const homeResponse = await request.get('/', { headers: { Accept: 'text/html' } });
  const homeHtml = await homeResponse.text();
  expect(homeResponse.ok()).toBe(true);
  expect(homeHtml).toContain('<meta name="robots" content="index, follow"');
  expect(homeHtml).toContain(`<link rel="canonical" href="${PUBLIC_SITE_URL_FOR_TESTS}"`);
  expect(homeHtml).toContain('让商品创意<br>直接动起来');
  expect(homeHtml).toContain('AI 视频与图片生成');
  expect(homeHtml).toContain('TikTok 发布');
  expect(homeHtml).not.toContain('<link rel="preload" as="video"');
  expect(homeHtml).toContain(`<meta property="og:image" content="${PUBLIC_SITE_URL_FOR_TESTS}landing/beauty-campaign-social.jpg"`);

  const appResponse = await request.get('/app', { headers: { Accept: 'text/html' } });
  const appHtml = await appResponse.text();
  expect(appResponse.ok()).toBe(true);
  expect(appHtml).toContain('<meta name="robots" content="noindex, nofollow"');
  expect(appHtml).not.toContain('landing-static-hero');

  const robotsResponse = await request.get('/robots.txt');
  expect(robotsResponse.headers()['content-type']).toContain('text/plain');
  expect(await robotsResponse.text()).toContain('Sitemap: https://www.lindyson.com/sitemap.xml');

  const sitemapResponse = await request.get('/sitemap.xml');
  expect(sitemapResponse.headers()['content-type']).toMatch(/xml/);
  expect(await sitemapResponse.text()).toContain('<loc>https://www.lindyson.com/</loc>');
});

test('首页展示精简创作链路且隐藏未勾选的启用套餐和运营端旧文案', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [
    paidPlan({ id: mockUuid('plan-visible'),code: 'pro',name: '正式套餐',landingVisible: true }),
    paidPlan({ id: mockUuid('plan-hidden'),code: 'test',name: '内部测试套餐',landingVisible: false }),
    addonPlan({ id: mockUuid('plan-addon-visible-attempt'),landingVisible: true }),
  ]);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '让商品创意 直接动起来' })).toBeVisible();
  await expect(page.locator('[data-campaign-video]')).toHaveCount(11);
  await expect(page.locator('[data-showcase-stage]')).toHaveCount(5);
  await expect(page.locator('[data-showcase-product="beauty"]')).toHaveCount(1);
  await expect(page.locator('[data-product-analysis-panel]')).toHaveCount(2);
  await expect(page.getByText('暖金香水', { exact: true }).first()).toBeAttached();
  await expect(page.getByText('9:16 电影感香水广告，暖金色玻璃瓶置于深色镜面台面，紫红与金色流光环绕，微距推进，奢华质感，5 秒。', { exact: true }).first()).toBeAttached();
  const showcaseVideoSources = await page.locator('#landing-showcase [data-campaign-video]').evaluateAll(videos => [...new Set(videos.map(video => video.getAttribute('data-campaign-video'))) ]);
  expect(showcaseVideoSources).toEqual(['/landing/beauty-campaign.mp4']);
  const showcaseStageHeights = await page.locator('[data-creation-workspace], [data-showcase-stage="library"], [data-showcase-stage="publish"], [data-showcase-stage="preview"]').evaluateAll(stages => stages.map(stage => stage.getBoundingClientRect().height));
  expect(Math.max(...showcaseStageHeights) - Math.min(...showcaseStageHeights)).toBeLessThanOrEqual(1);
  for (const capability of ['AI 视频与图片生成','素材与数字资产','TikTok 发布']) {
    await expect(page.getByRole('heading', { name: capability,exact: true })).toBeVisible();
  }
  for (const step of ['放入素材','AI 生成','自动入库','配置发布','发布预览']) {
    await expect(page.locator('#landing-showcase').getByText(step, { exact: true }).first()).toBeAttached();
  }
  for (const description of [
    '上传参考素材，AI 快速生成高质量提示词。',
    '全球领先 AI 模型，快速生成高质量商品视频。',
    '生成素材与提示词原稿自动保存，不再丢失。',
    '通过 TikTok 官方授权，一键完成内容发布。',
    '曝光、播放与互动数据清晰呈现，一目了然。',
  ]) {
    await expect(page.locator('#landing-showcase').getByText(description, { exact: true }).first()).toBeAttached();
  }
  await expect(page.locator('#landing-showcase').getByText('For You', { exact: true }).first()).toBeAttached();
  await expect(page.locator('#landing-showcase').getByText('24.8K', { exact: true }).first()).toBeAttached();
  await expect(page.getByText('正式套餐', { exact: true })).toBeVisible();
  await expect(page.getByText('内部测试套餐', { exact: true })).toHaveCount(0);
  await expect(page.getByText('30000 积分加购包', { exact: true })).toHaveCount(0);
  for (const forbidden of ['管理员后台','发票申请','供应商额度','受控开放']) {
    await expect(page.getByText(forbidden, { exact: false })).toHaveCount(0);
  }
});

test('首页套餐复用订阅卡片视觉并固定展示月付价格与前五条权益', async ({ page }) => {
  const features = Array.from({ length: 6 },(_,index) => ({
    text: `首页权益 ${index + 1}`,
    enabled: index !== 4,
  }));
  await page.evaluate((items) => (window as any).__setPlans(items), [
    paidPlan({
      id: mockUuid('landing-operating'),
      code: 'landing-operating',
      name: '运营专业成长套餐超长名称',
      nameEn: 'Operating Growth Pro',
      monthlyPrice: 59900,
      yearlyPrice: 549900,
      credits: 3100,
      features,
      recommendation: 'popular',
      iconKey: 'gem',
      landingVisible: true,
    }),
    paidPlan({
      id: mockUuid('landing-enterprise'),
      code: 'landing-enterprise',
      name: '企业专业版',
      nameEn: 'Enterprise Pro',
      monthlyPrice: 499900,
      yearlyPrice: 4799900,
      credits: 31190,
      recommendation: 'enterprise',
      iconKey: 'rocket',
      landingVisible: true,
    }),
    paidPlan({
      id: mockUuid('landing-hidden'),
      code: 'landing-hidden',
      name: '未展示套餐',
      landingVisible: false,
    }),
    paidPlan({
      id: mockUuid('landing-disabled'),
      code: 'landing-disabled',
      name: '已停用首页套餐',
      status: 'disabled',
      landingVisible: true,
    }),
    addonPlan({
      id: mockUuid('landing-addon'),
      name: '错误展示的加购包',
      landingVisible: true,
    }),
  ]);
  await page.setViewportSize({ width: 1440,height: 900 });
  await page.goto('/');

  const pricing = page.locator('#landing-pricing');
  const operatingCard = pricing.locator('[data-plan-card="landing-operating"]');
  const enterpriseCard = pricing.locator('[data-plan-card="landing-enterprise"]');
  await expect(pricing.locator('[data-plan-card]')).toHaveCount(2);
  await expect(page.getByText('未展示套餐', { exact: true })).toHaveCount(0);
  await expect(page.getByText('已停用首页套餐', { exact: true })).toHaveCount(0);
  await expect(page.getByText('错误展示的加购包', { exact: true })).toHaveCount(0);

  await expect(operatingCard).toHaveAttribute('data-accent', 'violet');
  await expect(enterpriseCard).toHaveAttribute('data-accent', 'orange');
  await expect(operatingCard.locator('[data-plan-icon-key="gem"]')).toBeVisible();
  await expect(enterpriseCard.locator('[data-plan-icon-key="rocket"]')).toBeVisible();
  await expect(operatingCard.locator('[data-plan-cycle-credits]')).toHaveAttribute('data-plan-tone', 'standard');
  await expect(enterpriseCard.locator('[data-plan-cycle-credits]')).toHaveAttribute('data-plan-tone', 'enterprise');
  await expect(operatingCard.locator('[data-plan-card-price]')).toContainText('¥599');
  await expect(enterpriseCard.locator('[data-plan-card-price]')).toContainText('¥4,999');
  await expect(pricing.getByText('按月计费', { exact: true })).toHaveCount(2);
  await expect(pricing.getByText('按年计费', { exact: false })).toHaveCount(0);
  await expect(pricing.getByRole('button', { name: '月付' })).toHaveCount(0);
  await expect(pricing.getByRole('button', { name: '年付' })).toHaveCount(0);
  await expect(operatingCard.getByText('首页权益 5', { exact: true })).toBeVisible();
  await expect(operatingCard.getByText('首页权益 6', { exact: true })).toHaveCount(0);
  await expect(operatingCard.locator('[data-plan-recommendation-badge]')).toHaveText('最受欢迎');
  await expect(enterpriseCard.locator('[data-plan-recommendation-badge]')).toHaveText('企业首选');

  const cardBackgrounds = await pricing.locator('[data-plan-card]').evaluateAll(cards => (
    cards.map(card => getComputedStyle(card).backgroundImage)
  ));
  expect(cardBackgrounds.every(background => background.includes('radial-gradient'))).toBe(true);

  const headerTops = await pricing.locator('[data-plan-card-header]').evaluateAll(headers => (
    headers.map(header => header.getBoundingClientRect().top)
  ));
  const priceTops = await pricing.locator('[data-plan-card-price]').evaluateAll(prices => (
    prices.map(price => price.getBoundingClientRect().top)
  ));
  expect(Math.max(...headerTops) - Math.min(...headerTops)).toBeLessThanOrEqual(1);
  expect(Math.max(...priceTops) - Math.min(...priceTops)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 375,height: 812 });
  const mobileLayout = await operatingCard.evaluate(card => {
    const identity = card.querySelector<HTMLElement>('[data-plan-card-identity]');
    const badge = card.querySelector<HTMLElement>('[data-plan-recommendation-badge]');
    if (!identity || !badge) throw new Error('首页套餐卡片缺少标题或推荐标签');
    return {
      identityRight: identity.getBoundingClientRect().right,
      badgeLeft: badge.getBoundingClientRect().left,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(mobileLayout.identityRight).toBeLessThanOrEqual(mobileLayout.badgeLeft);
  expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth);
});

test('首页单商品创作过程按滚动完成生成、入库、发布配置和手机预览', async ({ page }) => {
  await page.setViewportSize({ width: 1440,height: 900 });
  await page.goto('/');

  const scrollShowcaseTo = async (progress: number) => {
    await page.locator('main').evaluate((main,value) => {
      const section = document.querySelector<HTMLElement>('#landing-showcase');
      if (!section) throw new Error('未找到首页创作过程');
      main.scrollTop = section.offsetTop + (section.offsetHeight - main.clientHeight) * value;
    },progress);
    await page.waitForTimeout(650);
  };
  const expectStageVisible = async (stage: string) => {
    const opacity = await page.locator(`[data-showcase-stage="${stage}"]`).evaluate(element => Number(getComputedStyle(element).opacity));
    expect(opacity).toBeGreaterThan(0.9);
  };
  const expectAtMostOnePlayingVideo = async () => {
    const playing = await page.locator('#landing-showcase video').evaluateAll(videos => videos.filter(video => !video.paused && !video.ended).length);
    expect(playing).toBeLessThanOrEqual(1);
  };
  const generationValue = async () => Number.parseInt(await page.locator('[data-generation-progress]').first().innerText(),10);
  const analysisValue = async () => Number.parseInt(await page.locator('[data-analysis-progress]').first().innerText(),10);
  const stageOpacity = async (selector: string) => page.locator(selector).first().evaluate(element => Number(getComputedStyle(element).opacity));
  const product = page.locator('[data-showcase-product="beauty"]');
  const productHandle = await product.elementHandle();
  if (!productHandle) throw new Error('未找到共享香水商品图');
  await expect(product).toHaveCount(1);
  const captureCreationGeometry = async () => {
    const productBox = await product.boundingBox();
    const workspaceBox = await page.locator('[data-creation-workspace-right]').boundingBox();
    if (!productBox || !workspaceBox) throw new Error('共享创作工作台未进入布局');
    return { productBox,workspaceBox };
  };
  const expectGeometryStable = (current: Awaited<ReturnType<typeof captureCreationGeometry>>,baseline: Awaited<ReturnType<typeof captureCreationGeometry>>) => {
    for (const key of ['x','y','width','height'] as const) {
      expect(Math.abs(current.productBox[key] - baseline.productBox[key])).toBeLessThanOrEqual(1);
      expect(Math.abs(current.workspaceBox[key] - baseline.workspaceBox[key])).toBeLessThanOrEqual(1);
    }
  };
  const generationVideo = page.locator('[data-generation-video-view] video');
  const generationVideoOpacity = () => stageOpacity('[data-generation-video-view]');

  await scrollShowcaseTo(0.02);
  expect(await analysisValue()).toBeLessThan(10);
  expect(await generationValue()).toBe(0);

  await scrollShowcaseTo(0.12);
  expect(await analysisValue()).toBeGreaterThan(35);
  expect(await analysisValue()).toBeLessThan(80);
  expect(await stageOpacity('[data-showcase-stage="input"] [data-analysis-tags]')).toBeGreaterThan(0.2);
  expect(await stageOpacity('[data-showcase-stage="input"] [data-analysis-prompt]')).toBeLessThan(0.25);
  expect(await generationValue()).toBe(0);
  expect(await generationVideoOpacity()).toBeLessThan(0.05);
  expect(await generationVideo.evaluate(video => video.paused)).toBe(true);
  const stableCreationGeometry = await captureCreationGeometry();

  await scrollShowcaseTo(0.21);
  expect(await analysisValue()).toBe(100);
  expect(await stageOpacity('[data-showcase-stage="input"] [data-analysis-prompt]')).toBeGreaterThan(0.9);
  expect(await stageOpacity('[data-showcase-stage="input"] [data-analysis-ready]')).toBeGreaterThan(0.9);
  expect(await generationValue()).toBe(0);
  expectGeometryStable(await captureCreationGeometry(),stableCreationGeometry);
  expect(await productHandle.evaluate(element => element.isConnected)).toBe(true);

  await scrollShowcaseTo(0.35);
  await expectStageVisible('generate');
  expect(await generationValue()).toBeGreaterThan(25);
  expect(await generationValue()).toBeLessThan(85);
  expectGeometryStable(await captureCreationGeometry(),stableCreationGeometry);
  expect(await generationVideoOpacity()).toBeLessThan(0.05);
  expect(await generationVideo.evaluate(video => video.paused)).toBe(true);

  await scrollShowcaseTo(0.45);
  await expectStageVisible('generate');
  await expect.poll(generationValue).toBe(100);
  expectGeometryStable(await captureCreationGeometry(),stableCreationGeometry);

  await scrollShowcaseTo(0.47);
  await expect.poll(generationValue).toBe(100);
  expectGeometryStable(await captureCreationGeometry(),stableCreationGeometry);
  await expect.poll(generationVideoOpacity).toBeGreaterThan(0.9);
  await expect.poll(async () => generationVideo.evaluate(video => !video.paused)).toBe(true);

  const sharedPanelGeometry = await page.locator('[data-showcase-stage-root] [data-product-analysis-panel], [data-showcase-stage-root] [data-generation-workspace]').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { x: box.x,y: box.y,width: box.width,height: box.height };
  }));
  expect(sharedPanelGeometry).toHaveLength(2);
  for (const key of ['x','y','width','height'] as const) {
    expect(Math.abs(sharedPanelGeometry[0][key] - sharedPanelGeometry[1][key])).toBeLessThanOrEqual(1);
  }

  const stableStagePoints = [
    ['input',[0.04,0.12,0.21]],
    ['generate',[0.28,0.44]],
    ['library',[0.52,0.62]],
    ['publish',[0.70,0.78]],
    ['preview',[0.86,0.96]],
  ] as const;
  for (const [stage,points] of stableStagePoints) {
    for (const progress of points) {
      await scrollShowcaseTo(progress);
      await expectStageVisible(stage);
      await expectAtMostOnePlayingVideo();
    }
  }

  await expect(page.locator('[data-asset-library-window]').first()).toBeAttached();
  await expect(page.locator('[data-tiktok-publish-window]').first()).toBeAttached();
  await expect(page.locator('[data-tiktok-phone]').first()).toBeAttached();
  const showcaseHeightInViewports = await page.locator('#landing-showcase').evaluate((section) => section.getBoundingClientRect().height / document.querySelector('main')!.clientHeight);
  expect(showcaseHeightInViewports).toBeGreaterThanOrEqual(5.9);

  await scrollShowcaseTo(0.93);
  const phoneGeometry = await page.locator('[data-showcase-stage="preview"] [data-tiktok-phone]').evaluate(phone => {
    const phoneBox = phone.getBoundingClientRect();
    const screenBox = phone.querySelector<HTMLElement>('[data-tiktok-phone-screen]')!.getBoundingClientRect();
    const islandBox = phone.querySelector<HTMLElement>('[data-tiktok-dynamic-island]')!.getBoundingClientRect();
    const screenStyles = getComputedStyle(phone.querySelector<HTMLElement>('[data-tiktok-phone-screen]')!);
    const islandStyles = getComputedStyle(phone.querySelector<HTMLElement>('[data-tiktok-dynamic-island]')!);
    return {
      screenLeft: (screenBox.left - phoneBox.left) / phoneBox.width,
      screenTop: (screenBox.top - phoneBox.top) / phoneBox.height,
      screenWidth: screenBox.width / phoneBox.width,
      screenHeight: screenBox.height / phoneBox.height,
      islandLeft: (islandBox.left - phoneBox.left) / phoneBox.width,
      islandTop: (islandBox.top - phoneBox.top) / phoneBox.height,
      screenBorderRadius: screenStyles.borderRadius,
      screenClipPath: screenStyles.clipPath,
      islandBorderRadius: islandStyles.borderRadius,
    };
  });
  expect(phoneGeometry.screenLeft).toBeCloseTo(0.05,2);
  expect(phoneGeometry.screenTop).toBeCloseTo(0.02082,2);
  expect(phoneGeometry.screenWidth).toBeCloseTo(0.9,2);
  expect(phoneGeometry.screenHeight).toBeCloseTo(0.95836,2);
  expect(phoneGeometry.islandLeft).toBeCloseTo(0.35769,2);
  expect(phoneGeometry.islandTop).toBeCloseTo(0.03596,2);
  expect(phoneGeometry.screenBorderRadius).not.toBe('0px');
  expect(phoneGeometry.screenClipPath).toContain('round');
  expect(phoneGeometry.islandBorderRadius).not.toBe('0px');
  const hasHorizontalOverflow = await page.locator('main').evaluate(element => element.scrollWidth > element.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

test('首页能力标题、默认显色卡片与毛玻璃导航具有清晰指针反馈', async ({ page }) => {
  await page.setViewportSize({ width: 1440,height: 900 });
  await page.goto('/');

  const headerGlass = await page.locator('[data-header-glass]').evaluate(element => {
    const style = getComputedStyle(element);
    return { opacity: Number(style.opacity),backdropFilter: style.backdropFilter || (style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter };
  });
  expect(headerGlass.opacity).toBeGreaterThanOrEqual(0.75);
  expect(headerGlass.backdropFilter).not.toBe('none');

  const navButton = page.locator('[data-nav-target="landing-capabilities"]');
  const navLine = navButton.locator('[data-nav-hover-line]');
  await navButton.hover();
  await expect.poll(async () => Number(await navLine.evaluate(element => getComputedStyle(element).opacity))).toBeGreaterThan(0.8);
  await navButton.focus();
  await expect.poll(async () => Number(await navButton.locator('[data-nav-hover-surface]').evaluate(element => getComputedStyle(element).opacity))).toBeGreaterThan(0.8);

  await page.locator('#landing-capabilities').scrollIntoViewIfNeeded();
  const defaultGlows = await page.locator('[data-capability-default-glow]').evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    return { opacity: Number(style.opacity),backgroundImage: style.backgroundImage };
  }));
  expect(defaultGlows).toHaveLength(3);
  expect(defaultGlows.every(glow => glow.opacity >= 0.75 && glow.backgroundImage !== 'none')).toBe(true);
  expect(new Set(defaultGlows.map(glow => glow.backgroundImage)).size).toBe(3);

  const firstCard = page.locator('[data-capability-card]').first();
  const firstGlow = firstCard.locator('[data-capability-cursor-glow]');
  const cardBox = await firstCard.boundingBox();
  if (!cardBox) throw new Error('首页能力卡未进入布局');
  await page.mouse.move(cardBox.x + cardBox.width * 0.2,cardBox.y + cardBox.height * 0.25);
  await page.waitForTimeout(120);
  const glowAtStart = await firstGlow.evaluate(element => getComputedStyle(element).backgroundImage);
  const hoverTransform = await firstCard.evaluate(element => getComputedStyle(element).transform);
  await page.mouse.move(cardBox.x + cardBox.width * 0.82,cardBox.y + cardBox.height * 0.78);
  await page.waitForTimeout(120);
  const glowAtEnd = await firstGlow.evaluate(element => getComputedStyle(element).backgroundImage);
  expect(glowAtEnd).not.toBe(glowAtStart);
  expect(hoverTransform).not.toBe('none');
  await page.mouse.move(4,4);
  await page.waitForTimeout(650);
  const resetTransform = await firstCard.evaluate(element => getComputedStyle(element).transform);
  expect(resetTransform).not.toBe(hoverTransform);

  for (const viewport of [{ width: 1440,height: 900 },{ width: 768,height: 900 }]) {
    await page.setViewportSize(viewport);
    const titleLayout = await page.locator('[data-capabilities-title]').evaluate(element => {
      const style = getComputedStyle(element);
      return { height: element.getBoundingClientRect().height,lineHeight: Number.parseFloat(style.lineHeight),whiteSpace: style.whiteSpace };
    });
    expect(titleLayout.whiteSpace).toBe('nowrap');
    expect(titleLayout.height).toBeLessThanOrEqual(titleLayout.lineHeight * 1.2);
  }

  await page.setViewportSize({ width: 390,height: 844 });
  const mobileTitleWhiteSpace = await page.locator('[data-capabilities-title]').evaluate(element => getComputedStyle(element).whiteSpace);
  expect(mobileTitleWhiteSpace).toBe('normal');
  const hasHorizontalOverflow = await page.locator('main').evaluate(element => element.scrollWidth > element.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

test('首页导航与 Hero 创作入口将区块分割线对齐至导航底边', async ({ page }) => {
  await page.setViewportSize({ width: 1440,height: 900 });
  await page.goto('/');

  const expectSectionAligned = async (target: string) => {
    await expect.poll(async () => page.evaluate((targetId) => {
      const header = document.querySelector<HTMLElement>('[data-landing-header]');
      const section = document.getElementById(targetId);
      if (!header || !section) return Number.POSITIVE_INFINITY;
      return Math.abs(section.getBoundingClientRect().top - header.getBoundingClientRect().bottom);
    },target),{ timeout: 5_000 }).toBeLessThanOrEqual(1);
  };

  await page.getByRole('button', { name: '观看创作过程' }).click();
  await expectSectionAligned('landing-showcase');

  for (const target of ['landing-capabilities','landing-faq','landing-pricing','landing-showcase']) {
    await page.locator(`[data-nav-target="${target}"]`).click();
    await expectSectionAligned(target);
  }
});

test('首页导航登录与开始创作按钮使用响应式主次层级', async ({ page }) => {
  const viewportCases = [
    { width: 1440,height: 900,buttonHeight: 40,fontSize: 14,brandVisible: true },
    { width: 390,height: 844,buttonHeight: 36,fontSize: 13,brandVisible: true },
    { width: 360,height: 844,buttonHeight: 36,fontSize: 13,brandVisible: true },
    { width: 320,height: 844,buttonHeight: 36,fontSize: 13,brandVisible: false },
  ];

  for (const viewport of viewportCases) {
    await page.setViewportSize({ width: viewport.width,height: viewport.height });
    await page.goto('/');

    const login = page.locator('[data-header-login]');
    const start = page.locator('[data-header-start]');
    await expect(login).toBeVisible();
    await expect(start).toBeVisible();

    for (const button of [login,start]) {
      const styles = await button.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { height: rect.height,fontSize: Number.parseFloat(style.fontSize) };
      });
      expect(styles.height).toBeCloseTo(viewport.buttonHeight,1);
      expect(styles.fontSize).toBeCloseTo(viewport.fontSize,1);
    }

    const loginWidth = await login.evaluate(element => element.getBoundingClientRect().width);
    const startWidth = await start.evaluate(element => element.getBoundingClientRect().width);
    expect(loginWidth).toBeGreaterThanOrEqual(viewport.width >= 640 ? 64 : 52);
    expect(startWidth).toBeGreaterThanOrEqual(viewport.width >= 640 ? 116 : 100);

    const brandCopy = page.locator('[data-header-brand-copy]');
    if (viewport.brandVisible) {
      await expect(brandCopy).toBeVisible();
    } else {
      await expect(brandCopy).toBeHidden();
      await expect(page.getByRole('button', { name: '返回首页顶部' })).toBeVisible();
    }

    const horizontalOverflow = await page.locator('main').evaluate(element => element.scrollWidth - element.clientWidth);
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: 1440,height: 900 });
  await page.goto('/');
  const login = page.locator('[data-header-login]');
  const start = page.locator('[data-header-start]');
  const loginSurface = await login.evaluate(element => {
    const style = getComputedStyle(element);
    return { backgroundColor: style.backgroundColor,borderWidth: style.borderWidth,color: style.color };
  });
  expect(loginSurface.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(loginSurface.borderWidth).toBe('1px');
  expect(loginSurface.color).not.toBe('rgba(0, 0, 0, 0)');
  expect(await start.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
  expect(await start.locator('.landing-header-start-icon').evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(16,1);

  await login.hover();
  await expect.poll(async () => login.evaluate(element => getComputedStyle(element).transform)).not.toBe('none');
  await login.focus();
  await expect(login).toBeFocused();
  expect(await login.evaluate(element => getComputedStyle(element).outlineWidth)).not.toBe('0px');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const reducedMotionLogin = page.locator('[data-header-login]');
  await reducedMotionLogin.hover();
  const reducedMotionTransform = await reducedMotionLogin.evaluate(element => getComputedStyle(element).transform);
  expect(reducedMotionTransform).toBe('none');
});

test('首页 Hero 固定为两行且备案号与公司名左对齐', async ({ page }) => {
  for (const width of [1920,1440,1024,768,390,320]) {
    await page.setViewportSize({ width,height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '让商品创意 直接动起来' })).toBeVisible();

    const headlineMetrics = await page.locator('[data-hero-headline-line]').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      const textRect = range.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      return {
        height: rect.height,
        lineHeight,
        textRight: textRect.right,
        whiteSpace: getComputedStyle(element).whiteSpace,
      };
    }));

    expect(headlineMetrics).toHaveLength(2);
    for (const metric of headlineMetrics) {
      expect(metric.whiteSpace).toBe('nowrap');
      expect(Math.abs(metric.height - metric.lineHeight)).toBeLessThanOrEqual(1);
    }

    if (width >= 1024) {
      const visualLeft = await page.locator('[data-hero-visual]').evaluate(element => element.getBoundingClientRect().left);
      expect(Math.max(...headlineMetrics.map(metric => metric.textRight))).toBeLessThanOrEqual(visualLeft + 1);
    }

    const horizontalOverflow = await page.locator('main').evaluate(element => element.scrollWidth - element.clientWidth);
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  }

  for (const width of [1440,390]) {
    await page.setViewportSize({ width,height: 900 });
    await page.goto('/');
    const companyLeft = await page.locator('[data-public-company]').evaluate(element => element.getBoundingClientRect().left);
    const registrationLeft = await page.getByRole('link', { name: PUBLIC_COMPLIANCE_ICP_LABEL }).evaluate(element => element.getBoundingClientRect().left);
    expect(Math.abs(companyLeft - registrationLeft)).toBeLessThanOrEqual(1);
  }
});

test('首页减少动态模式可完整浏览、定位创作过程并键盘展开 FAQ', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390,height: 844 });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '让商品创意 直接动起来' })).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  await page.getByRole('button', { name: '观看创作过程' }).click();
  await expect.poll(async () => page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('[data-landing-header]');
    const section = document.getElementById('landing-showcase');
    if (!header || !section) return Number.POSITIVE_INFINITY;
    return Math.abs(section.getBoundingClientRect().top - header.getBoundingClientRect().bottom);
  })).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-analysis-progress]').first()).toHaveText('100%');
  await expect(page.locator('[data-showcase-mobile-stage="input"] [data-analysis-prompt]')).toBeVisible();
  for (const description of [
    '上传参考素材，AI 快速生成高质量提示词。',
    '全球领先 AI 模型，快速生成高质量商品视频。',
    '生成素材与提示词原稿自动保存，不再丢失。',
    '通过 TikTok 官方授权，一键完成内容发布。',
    '曝光、播放与互动数据清晰呈现，一目了然。',
  ]) {
    await expect(page.locator(`[data-showcase-mobile-stage]`).getByText(description, { exact: true })).toBeVisible();
  }

  const firstFaq = page.locator('#landing-faq details').first();
  await firstFaq.locator('summary').press('Enter');
  await expect(firstFaq).toHaveAttribute('open', '');
  await expect(firstFaq.getByText('可以集中上传和管理图片、视频与音频素材')).toBeVisible();

  const reducedMotionCard = page.locator('[data-capability-card]').first();
  await reducedMotionCard.hover();
  const reducedMotionTransform = await reducedMotionCard.evaluate(element => {
    const value = getComputedStyle(element).transform;
    const matrix = new DOMMatrix(value === 'none' ? undefined : value);
    return { m11: matrix.m11,m12: matrix.m12,m21: matrix.m21,m22: matrix.m22,m41: matrix.m41,m42: matrix.m42 };
  });
  expect(reducedMotionTransform).toEqual({ m11: 1,m12: 0,m21: 0,m22: 1,m41: 0,m42: 0 });
  expect(Number(await reducedMotionCard.locator('[data-capability-default-glow]').evaluate(element => getComputedStyle(element).opacity))).toBeGreaterThanOrEqual(0.75);

  const hasHorizontalOverflow = await page.locator('main').evaluate(element => element.scrollWidth > element.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

test('首页底部法律页面入口可用', async ({ page }) => {
  await page.goto('/');
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/']);
  await expect(page.getByRole('heading', { name: '让商品创意 直接动起来' })).toBeVisible();
  await expect(page.getByText(PUBLIC_COMPLIANCE_COMPANY_NAME, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: PUBLIC_COMPLIANCE_ICP_LABEL })).toBeVisible();
  await expect(page.getByText('© 2026 Lindyson All Rights Reserved')).toBeVisible();

  await page.getByRole('link', { name: '服务条款' }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/terms']);
  await expect(page.getByRole('heading', { name: 'Lindyson AI 服务条款' })).toBeVisible();
  await expect(page.getByText('生效日期：2026 年 7 月 30 日')).toBeVisible();
  await page.getByRole('button', { name: '返回首页' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/']);

  await page.getByRole('link', { name: '隐私政策' }).click();
  await expect(page).toHaveURL(/\/policy$/);
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/policy']);
  await expect(page.getByRole('heading', { name: 'Lindyson AI 隐私政策' })).toBeVisible();
  await expect(page.getByText('生效日期：2026 年 7 月 30 日')).toBeVisible();
  await page.getByRole('button', { name: '返回首页' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/']);
});

test('公开页、登录、注册和 404 路由可用', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '让商品创意 直接动起来' })).toBeVisible();

  await page.getByRole('button', { name: '开始创作' }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/login']);
  await expect(page.getByRole('heading', { name: '登录 Lindyson AI' })).toBeVisible();

  await page.getByLabel('邮箱', { exact: true }).fill('admin@lindyson.ai');
  await page.getByLabel('密码', { exact: true }).fill('mock123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();
  await expectDashboardStat(page, '累计生成次数', '1');
  await expectDashboardStat(page, '累计视频生成', '1');
  await expectDashboardStat(page, '累计图片生成', '0');
  await expectDashboardStat(page, '已授权TikTok账号', '0');
  await expect(page.getByRole('heading', { name: '最近作品' })).toBeVisible();
  await expect(page.getByRole('list', { name: '最近完成成果' }).getByRole('button')).toHaveCount(1);
  await expect(page.getByText('已完成', { exact: true })).toHaveCount(0);
  await expect(page.getByText('1200×800', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Seedance 2.0', { exact: true })).toBeVisible();
  await expect(page.getByText('100%')).toBeVisible();

  await page.goto('/register');
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/register']);
  await expect(page.getByLabel('用户名')).toBeVisible();
  await expect(page.getByLabel('邮箱验证码', { exact: true })).toBeVisible();
  await page.getByLabel('用户名').fill('测试用户');
  await page.getByLabel('邮箱', { exact: true }).fill('pro.user@lindyson.ai');
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('该邮箱已注册，请直接登录')).toBeVisible();

  await page.getByLabel('邮箱', { exact: true }).fill('new.user@lindyson.ai');
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送，10 分钟内有效')).toBeVisible();
  await page.getByLabel('邮箱验证码', { exact: true }).fill('000000');
  await page.getByLabel('密码', { exact: true }).fill('mock1234');
  await page.getByLabel('确认密码').fill('mock1234');
  await page.getByRole('button', { name: '注册并进入工作台' }).click();
  await expect(page.getByText('验证码错误')).toBeVisible();

  await page.getByLabel('邮箱验证码', { exact: true }).fill(registerCode);
  await page.getByRole('button', { name: '注册并进入工作台' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expectDashboardStat(page, '累计生成次数', '0');
  await expectDashboardStat(page, '累计视频生成', '0');
  await expectDashboardStat(page, '累计图片生成', '0');
  await expectDashboardStat(page, '已授权TikTok账号', '0');
  await expect(page.getByText('暂无生成任务')).toBeVisible();
  await expect(page.getByText('暂无完成作品')).toBeVisible();
  await expect(page.getByText('系统公告')).toBeVisible();
  await expect(page.getByText('测试用户')).toBeVisible();
  await page.getByRole('button', { name: /测试用户/ }).click();
  await expect(page.getByRole('heading', { name: '账户中心' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '用户名' })).toHaveValue('测试用户');
  await expect(page.getByRole('textbox', { name: '注册邮箱' })).toHaveValue('new.user@lindyson.ai');
  await expect(page.getByRole('main').getByText('免费版', { exact: true })).toBeVisible();
  await expect(page.getByText('无订阅', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '测试用户 免费版 当前积分 0 / 0' })).toBeVisible();
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await expect(page.locator('.rounded-2xl').filter({ hasText: '免费版' }).filter({ hasText: '免费套餐' }).first()).toBeVisible();
  await expect(page.getByText('当前套餐', { exact: true })).toHaveCount(0);

  const adminRequestsBefore = await page.evaluate(() => (window as any).__getAdminApiRequestCount());
  await page.evaluate(() => {
    window.history.pushState({}, '', '/admin');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText('无权限访问')).toBeVisible();
  await expect(page.getByRole('heading', { name: '仅管理员可访问管理后台' })).toBeVisible();
  await expect(page.getByText('当前账号不是管理员，不能进入运营管理后台。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '管理员仪表盘' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '用户管理' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__getAdminApiRequestCount())).toBe(adminRequestsBefore);

  await page.goto('/unknown');
  await expectPageMetadata(page, NOT_FOUND_PAGE_METADATA);
  await expect(page.getByText('404')).toBeVisible();
  await page.getByRole('button', { name: '返回首页' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('用户端与后台深链接支持刷新、前进后退，未知子路径进入 404', async ({ page }) => {
  const defaultDigitalAssetsUrl = /\/app\/digital-assets\?source=ai-video&folder=root$/;
  await page.goto('/app/digital-assets');
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/app/digital-assets']);
  await expect(page.getByRole('heading', { name: '数字资产' })).toBeVisible();
  await expect(page).toHaveURL(defaultDigitalAssetsUrl);
  await page.reload();
  await expect(page).toHaveURL(defaultDigitalAssetsUrl);
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/app/digital-assets']);
  await expect(page.getByRole('heading', { name: '数字资产' })).toBeVisible();

  await page.getByRole('button', { name: 'AI Studio' }).click();
  await expect(page).toHaveURL(/\/app\/ai-studio$/);
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/app/ai-studio']);
  await expect(page.getByRole('heading', { name: 'AI Studio' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(defaultDigitalAssetsUrl);
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/app/digital-assets']);
  await expect(page.getByRole('heading', { name: '数字资产' })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/app\/ai-studio$/);
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/app/ai-studio']);
  await expect(page.getByRole('heading', { name: 'AI Studio' })).toBeVisible();

  await page.goto('/admin/orders');
  await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible();
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/admin/orders']);
  await page.reload();
  await expect(page).toHaveURL(/\/admin\/orders$/);
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/admin/orders']);
  await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible();

  await page.goto('/admin/api-usage/audit?range=month&month=2026-06');
  await expect(page.getByRole('heading', { name: '高级成本对账' })).toBeVisible();
  await expectPageMetadata(page, ROUTE_PAGE_METADATA['/admin/api-usage/audit']);
  await page.reload();
  await expect(page).toHaveURL(/\/admin\/api-usage\/audit\?costType=video&range=month&month=2026-06$/);
  await expect(page.getByRole('heading', { name: '高级成本对账' })).toBeVisible();

  for (const path of ['/app/not-a-page', '/admin/not-a-page']) {
    await page.goto(path);
    await expectPageMetadata(page, NOT_FOUND_PAGE_METADATA);
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
  }
});

test('数字资产目录切换延迟显示简洁提示，保留当前缓存并清理切换计时', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/digital-assets');
  await expect(page.getByRole('button', { name: '打开素材 品牌故事视频', exact: true })).toBeVisible();
  const clockStart = new Date();
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000));

  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/api/assets/cards?**', async route => {
    if (new URL(route.request().url()).searchParams.get('folderId') === productVideoFolderId) {
      requests += 1;
      await gate;
    }
    await route.fallback();
  });
  const loading = page.getByRole('status', { name: '正在加载素材', exact: true });
  const productFolder = page.getByRole('button', { name: /^打开文件夹 产品发布，/ });
  const rootFolder = page.getByRole('button', { name: /^选择主目录，/ });
  await productFolder.click();
  await expect.poll(() => requests).toBe(1);
  await expect(loading).toBeVisible();
  await expect(page.getByTestId('digital-asset-grid')).toHaveCount(0);
  await expect(page.getByText('“产品发布”还是空的', { exact: true })).toHaveCount(0);
  await page.clock.runFor(199);
  await expect(loading.locator('svg')).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(loading.locator('svg')).toBeVisible();

  // 未完成请求期间切回主目录，再次进入时重新计时。
  await rootFolder.click();
  await expect(page.getByRole('button', { name: '打开素材 品牌故事视频', exact: true })).toBeVisible();
  await expect(loading).toHaveCount(0);
  await productFolder.click();
  await expect.poll(() => requests).toBe(2);
  await expect(loading.locator('svg')).toHaveCount(0);
  await page.clock.runFor(100);
  const response = page.waitForResponse(res => res.url().includes('/api/assets/cards?') && res.url().includes(productVideoFolderId) && res.status() === 200);
  release();
  await response;
  await page.clock.runFor(10);
  await expect(page.getByRole('button', { name: '打开素材 产品发布宣传片', exact: true })).toBeVisible();
  await page.clock.runFor(300);
  await expect(loading).toHaveCount(0);
  await productFolder.click();
  await expect(page.getByRole('button', { name: '打开素材 产品发布宣传片', exact: true })).toBeVisible();
  expect(requests).toBe(2);
  await expect(loading).toHaveCount(0);

  // 当前查询后台刷新时，继续展示已确认的缓存素材。
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
  await page.route('**/api/assets/cards?**', async route => {
    await refreshGate;
    await route.fallback();
  });
  await page.clock.runFor(31_000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(async () => {
    await page.clock.runFor(1);
    return page.getByTestId('digital-asset-grid').getAttribute('aria-busy');
  }).toBe('true');
  await expect(page.getByRole('button', { name: '打开素材 产品发布宣传片', exact: true })).toBeVisible();
  await expect(loading).toHaveCount(0);
  releaseRefresh();
  await page.clock.resume();
  await expect(page.getByTestId('digital-asset-grid')).toHaveAttribute('aria-busy', 'false');
});

for (const width of [1440, 390]) {
  test(`数字资产 ${width}px 首次加载和空目录使用同高提示，失败可重试`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const archiveFolderId = mockUuid('folder-uploaded-image-archive');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let fail = false;
    await page.route('**/api/assets/cards?**', async route => {
      await gate;
      if (fail) await json(route, { message: '素材读取失败', code: 'ASSET_READ_FAILED' }, 503);
      else await route.fallback();
    });
    await page.goto(`/app/digital-assets?source=uploaded-image&folder=${archiveFolderId}`);
    const loading = page.getByRole('status', { name: '正在加载素材', exact: true });
    await expect(loading.locator('svg')).toBeVisible();
    await expect(page.locator('.digital-asset-card-grid')).toHaveCount(0);
    await expect(page.getByText('“图片归档”还是空的', { exact: true })).toHaveCount(0);
    const loadingHeight = (await loading.boundingBox())!.height;
    expect(loadingHeight).toBeGreaterThanOrEqual(288);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`assets-loading-${width}.png`), fullPage: true });
    release();
    const emptyTitle = page.getByText('“图片归档”还是空的', { exact: true });
    await expect(emptyTitle).toBeVisible();
    expect((await emptyTitle.locator('..').boundingBox())!.height).toBe(loadingHeight);
    await expect(loading).toHaveCount(0);

    fail = true;
    const search = page.getByRole('textbox', { name: '搜索已上传图片全部文件夹' });
    await search.fill('失败重试');
    await search.press('Enter');
    await expect(page.getByRole('heading', { name: '素材加载失败', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('没有找到“失败重试”', { exact: true })).toHaveCount(0);
    fail = false;
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(page.getByText('没有找到“失败重试”', { exact: true })).toBeVisible();
    await expect(loading).toHaveCount(0);
  });
}

test('数字资产固定 30 条并按 2/3/5/6/10 容器约数列响应，缩放不重新请求', async ({ page }) => {
  const cardRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/assets/cards') cardRequests.push(request.url());
  });
  await page.evaluate(() => (window as any).__prepareDigitalAssetPaginationScenario());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/digital-assets');

  const folderSidebar = page.getByTestId('digital-asset-folder-sidebar');
  const grid = page.getByTestId('digital-asset-grid');
  await expect(folderSidebar).toBeVisible();
  await expect(grid).toBeVisible();
  await expect(page.getByRole('button', { name: /^选择主目录，/ })).toHaveAttribute('aria-current', 'page');

  const sidebarBox = await folderSidebar.boundingBox();
  const gridBox = await grid.boundingBox();
  if (!sidebarBox || !gridBox) throw new Error('数字资产双栏未完成布局');
  expect(sidebarBox.x + sidebarBox.width).toBeLessThan(gridBox.x);
  await expect.poll(() => cardRequests.length).toBe(1);
  expect(new URL(cardRequests[0]).searchParams.get('limit')).toBe('30');
  await expect(grid.locator(':scope > li')).toHaveCount(30);

  const pager = page.getByRole('navigation', { name: '数字资产翻页' });
  await expect(pager.getByRole('status', { name: '第 1 页，共 3 页' })).toBeVisible();
  await pager.getByRole('button', { name: '下一页' }).click();
  await expect(grid.locator(':scope > li')).toHaveCount(30);
  await expect(pager.getByRole('status', { name: '第 2 页，共 3 页' })).toBeVisible();
  await pager.getByRole('button', { name: '下一页' }).click();
  await expect(grid.locator(':scope > li')).toHaveCount(1);
  await expect(pager.getByRole('status', { name: '第 3 页，共 3 页' })).toBeVisible();
  await pager.getByRole('button', { name: '首页' }).click();
  await expect(grid.locator(':scope > li')).toHaveCount(30);
  await expect(cardRequests).toHaveLength(3);
  for (const requestUrl of cardRequests) {
    expect(new URL(requestUrl).searchParams.get('limit')).toBe('30');
  }

  const expectedColumns = (containerWidth: number) => {
    if (containerWidth >= 1624) return 10;
    if (containerWidth >= 968) return 6;
    if (containerWidth >= 804) return 5;
    if (containerWidth >= 476) return 3;
    return 2;
  };

  const resultsContainer = page.locator('.digital-assets-results-container');
  await page.setViewportSize({ width: 2560, height: 900 });
  for (const [containerWidth,columns] of [[475,2],[476,3],[803,3],[804,5],[967,5],[968,6],[1623,6],[1624,10]] as const) {
    await resultsContainer.evaluate((element,width) => {
      element.style.boxSizing = 'content-box';
      element.style.justifySelf = 'start';
      element.style.width = `${width}px`;
    }, containerWidth);
    await expect.poll(() => grid.evaluate(element => (
      getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length
    ))).toBe(columns);
    expect(cardRequests).toHaveLength(3);
  }
  await resultsContainer.evaluate(element => {
    element.style.removeProperty('box-sizing');
    element.style.removeProperty('justify-self');
    element.style.removeProperty('width');
  });

  // 720 CSS px 等价于 1440px 物理视口在 200% 浏览器缩放下的响应式宽度。
  for (const width of [320,390,720,768,1024,1280,1440,1920,2560]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(grid).toBeVisible();
    const geometry = await grid.evaluate(element => ({
      columnCount: getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
      clientWidth: element.clientWidth,
    }));
    expect(geometry.columnCount).toBe(expectedColumns(geometry.clientWidth));
    if (width >= 1280) await expect(folderSidebar).toBeVisible();
    else await expect(folderSidebar).toBeHidden();
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(1);
    expect(cardRequests).toHaveLength(3);
  }
});

test('数字资产文件夹入口在平板为侧边抽屉、手机为底部面板且批量栏固定底部', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await page.goto('/app/digital-assets');

  await expect(page.getByTestId('digital-asset-folder-sidebar')).toBeHidden();
  const folderTrigger = page.getByRole('button', { name: /^选择文件夹/ });
  await folderTrigger.click();
  const tabletDrawer = page.getByRole('dialog', { name: '选择文件夹' });
  const tabletBox = await tabletDrawer.boundingBox();
  if (!tabletBox) throw new Error('平板文件夹抽屉未完成布局');
  expect(tabletBox.x).toBeLessThanOrEqual(1);
  expect(tabletBox.y).toBeLessThanOrEqual(1);
  expect(tabletBox.height).toBeGreaterThanOrEqual(758);
  await page.getByRole('button', { name: '关闭选择文件夹' }).click();

  await page.setViewportSize({ width: 390, height: 760 });
  await expect.poll(() => page.getByTestId('digital-asset-grid').evaluate(element => (
    getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length
  ))).toBe(2);
  await folderTrigger.click();
  const mobileSheet = page.getByRole('dialog', { name: '选择文件夹' });
  const mobileBox = await mobileSheet.boundingBox();
  if (!mobileBox) throw new Error('手机文件夹底部面板未完成布局');
  expect(mobileBox.y).toBeGreaterThan(0);
  expect(mobileBox.y + mobileBox.height).toBeGreaterThanOrEqual(759);
  expect(mobileBox.width).toBeGreaterThanOrEqual(389);
  const mobileFolderMenu = mobileSheet.getByRole('button', { name: '更多操作：文件夹 产品发布' });
  await mobileFolderMenu.focus();
  await mobileFolderMenu.press('ArrowDown');
  await expect(mobileSheet.getByRole('menuitem', { name: '重命名' })).toBeFocused();
  await mobileSheet.getByRole('menuitem', { name: '重命名' }).press('Escape');
  await expect(mobileFolderMenu).toBeFocused();
  await page.getByRole('button', { name: '关闭选择文件夹' }).click();

  await page.getByRole('button', { name: '批量操作' }).click();
  const bulkToolbar = page.getByText('已选择 0 个', { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "fixed")][1]');
  await expect(bulkToolbar).toBeVisible();
  await expect(bulkToolbar).toHaveCSS('position', 'fixed');
  await expect.poll(async () => {
    const bulkBox = await bulkToolbar.boundingBox();
    if (!bulkBox) throw new Error('手机批量操作栏未完成布局');
    return bulkBox.y + bulkBox.height;
  }).toBeGreaterThanOrEqual(759);
});

test('数字资产使用提交式跨目录搜索，旧 sort URL 被规范化且清除后恢复目录', async ({ page }) => {
  const archiveFolderId = mockUuid('folder-uploaded-image-archive');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/app/digital-assets?source=uploaded-image&folder=${archiveFolderId}&q=${encodeURIComponent('参考')}&sort=created-asc`);

  await expect(page.getByRole('tab', { name: '已上传图片' })).toHaveAttribute('aria-selected', 'true');
  const search = page.getByRole('textbox', { name: '搜索已上传图片全部文件夹' });
  await expect(search).toHaveValue('参考');
  await expect(page.getByRole('combobox', { name: '素材排序' })).toHaveCount(0);
  await expect(page.getByText('正在搜索当前“已上传图片”分类的全部文件夹，不受当前目录限制。')).toBeVisible();
  const crossFolderResult = page.getByText('参考商品图', { exact: true }).first().locator('xpath=ancestor::article[1]');
  await expect(crossFolderResult.getByText('文件夹：主目录', { exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('source')).toBe('uploaded-image');
  expect(new URL(page.url()).searchParams.get('folder')).toBe(archiveFolderId);
  expect(new URL(page.url()).searchParams.get('q')).toBe('参考');
  expect(new URL(page.url()).searchParams.get('sort')).toBeNull();

  await page.getByTestId('digital-asset-search-clear').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBeNull();
  expect(new URL(page.url()).searchParams.get('folder')).toBe(archiveFolderId);
  await expect(page.getByRole('button', { name: /^打开文件夹 图片归档，/ })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: /^选择主目录，/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('folder')).toBe('root');
  expect(new URL(page.url()).searchParams.get('source')).toBe('uploaded-image');

  const searchButton = page.getByTestId('digital-asset-search-submit');
  await expect(searchButton).toHaveAccessibleName('确认搜索');
  await expect(searchButton.locator('svg')).toHaveCount(1);
  const [searchBox,searchButtonBox] = await Promise.all([search.boundingBox(),searchButton.boundingBox()]);
  if (!searchBox || !searchButtonBox) throw new Error('提交式搜索工具栏未完成布局');
  expect(searchButtonBox.x).toBeGreaterThan(searchBox.x + searchBox.width / 2);

  const requestsBeforeDraft = await page.evaluate(() => (window as any).__getApiRequestCount('GET /api/assets/cards'));
  await search.fill('  参考  ');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).__getApiRequestCount('GET /api/assets/cards'))).toBe(requestsBeforeDraft);
  expect(new URL(page.url()).searchParams.get('q')).toBeNull();
  await expect(page.getByText('参考商品图', { exact: true }).first()).toBeVisible();

  await searchButton.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('参考');
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/assets/cards'))).toBe(requestsBeforeDraft + 1);
  await expect(search).toHaveValue('参考');

  await search.fill('不存在');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).__getApiRequestCount('GET /api/assets/cards'))).toBe(requestsBeforeDraft + 1);
  expect(new URL(page.url()).searchParams.get('q')).toBe('参考');
  await expect(page.getByText('参考商品图', { exact: true }).first()).toBeVisible();
  await search.press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('不存在');
  await expect(page.getByText('没有找到“不存在”')).toBeVisible();

  await page.getByTestId('digital-asset-search-clear').click();
  await expect(search).toHaveValue('');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBeNull();
  await search.fill('参考');
  const finalSubmitRequests: string[] = [];
  page.on('request', request => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname === '/api/assets/cards' && requestUrl.searchParams.get('search') === '参考') {
      finalSubmitRequests.push(request.url());
    }
  });
  await searchButton.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('参考');
  await expect.poll(() => finalSubmitRequests.length).toBe(1);
  await expect(searchButton).toBeDisabled();
  await page.waitForTimeout(100);
  expect(finalSubmitRequests).toHaveLength(1);

  // 不存在或与来源不匹配的真实 UUID 必须在文件夹数据到达后规范化为主目录。
  await page.goto(`/app/digital-assets?source=uploaded-image&folder=${mockUuid('system-folder-ai-image')}&sort=created-asc`);
  await expect.poll(() => new URL(page.url()).searchParams.get('folder')).toBe('root');
  expect(new URL(page.url()).searchParams.get('sort')).toBeNull();
  await expect(page.getByRole('button', { name: /^选择主目录，/ })).toHaveAttribute('aria-current', 'page');
});

test('数字资产五分类复用 AI Studio 标签视觉、键盘语义与横向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/app/digital-assets');

  const tablist = page.getByRole('tablist', { name: '数字资产分类' });
  const categories = [
    ['AI视频','violet','3'],
    ['AI图片','pink','0'],
    ['已上传视频','blue','0'],
    ['已上传图片','pink','2'],
    ['已上传音频','cyan','1'],
  ] as const;
  for (const [label,accent,count] of categories) {
    const tab = tablist.getByRole('tab').filter({ hasText: label });
    await expect(tab).toHaveAttribute('data-ui', 'studio-tab');
    await expect(tab).toHaveAttribute('data-accent', accent);
    await expect(tab).toHaveAttribute('aria-controls', 'digital-assets-panel');
    await expect(tab.locator('svg')).toHaveCount(1);
    await expect(tab).toContainText(count);
  }
  expect(await tablist.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);

  const firstTab = tablist.getByRole('tab').filter({ hasText: 'AI视频' });
  const lastTab = tablist.getByRole('tab').filter({ hasText: '已上传音频' });
  await firstTab.focus();
  await firstTab.press('End');
  await expect(lastTab).toBeFocused();
  await expect(lastTab).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => tablist.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await lastTab.press('Home');
  await expect(firstTab).toBeFocused();
  await firstTab.press('ArrowRight');
  await expect(tablist.getByRole('tab').filter({ hasText: 'AI图片' })).toBeFocused();
  await expect(page.locator('#digital-assets-panel')).toHaveAttribute('aria-labelledby', 'asset-tab-ai-image');

  for (const [label] of categories) {
    const tab = tablist.getByRole('tab').filter({ hasText: label });
    await tab.click();
    const toolbar = page.getByTestId('digital-asset-toolbar-actions');
    await expect(toolbar.getByRole('textbox')).toBeVisible();
    await expect(toolbar.getByTestId('digital-asset-search-submit')).toHaveAccessibleName('确认搜索');
    await expect(toolbar.getByRole('button', { name: '批量操作' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: '上传素材' })).toBeVisible();
  }

  await page.goto('/app/ai-studio');
  const studioTabs = page.getByRole('tablist', { name: 'AI Studio 生成类型' });
  await expect(studioTabs.getByRole('tab', { name: 'AI 视频' })).toHaveAttribute('data-ui', 'studio-tab');
  await expect(studioTabs.getByRole('tab', { name: 'AI 视频' })).toHaveAttribute('data-accent', 'violet');
  await expect(studioTabs.getByRole('tab', { name: 'AI 图片' })).toHaveAttribute('data-ui', 'studio-tab');
  await expect(studioTabs.getByRole('tab', { name: 'AI 图片' })).toHaveAttribute('data-accent', 'pink');
  const pickerRequestPromise = page.waitForRequest(request => {
    const requestUrl = new URL(request.url());
    return requestUrl.pathname === '/api/assets/cards' && requestUrl.searchParams.get('limit') === '24';
  });
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: '选择数字资产' })).toBeVisible();
  const pickerRequest = new URL((await pickerRequestPromise).url());
  expect(pickerRequest.searchParams.get('limit')).toBe('24');
});

test('数字资产下载成功显示绿色请求状态，下载中禁止重复提交', async ({ page }) => {
  await page.addInitScript(() => {
    window.__assetDownloadClicks = [];
    HTMLAnchorElement.prototype.click = function () {
      window.__assetDownloadClicks.push(this.href);
    };
  });
  await page.goto('/app/digital-assets');

  const brandCard = page.getByText('品牌故事视频', { exact: true }).first().locator('xpath=ancestor::article[1]');
  const download = brandCard.getByRole('button', { name: '下载素材 品牌故事视频' });
  const more = brandCard.getByRole('button', { name: '更多操作：品牌故事视频' });
  await expect(download).toBeVisible();
  await expect(more).toBeVisible();
  await expect(download).toHaveAttribute('data-download-state', 'idle');

  await download.click();
  await expect.poll(() => page.evaluate(() => window.__assetDownloadClicks.length)).toBe(1);
  const requestedDownload = brandCard.getByRole('button', { name: '重新下载素材 品牌故事视频（已发起过下载）' });
  await expect(requestedDownload).toHaveAttribute('data-download-state', 'requested');
  await expect(requestedDownload).toHaveClass(/emerald/);
  await expect(more).toBeVisible();
  await page.evaluate(({ id,requestedAt }) => (window as any).__setAssetDownloadRequestedAt(id, requestedAt), {
    id: assetBrandId,
    requestedAt: '2026-07-01T12:00:00.000Z',
  });
  await page.reload();
  const reloadedCard = page.getByText('品牌故事视频', { exact: true }).first().locator('xpath=ancestor::article[1]');
  await expect(reloadedCard.getByRole('button', { name: '重新下载素材 品牌故事视频（已发起过下载）' })).toHaveAttribute('data-download-state', 'requested');

  let resolveDownload: (() => void) | undefined;
  const pendingDownload = new Promise<void>(resolve => { resolveDownload = resolve; });
  await page.route(`**/api/assets/${assetBrandId}/download`, async route => {
    await pendingDownload;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ download: {
        url: 'https://download.example.com/users/e2e/asset-brand.mp4',
        filename: '品牌故事视频.mp4',
        downloadRequestedAt: '2026-07-01T12:00:00.000Z',
      } }),
    });
  });
  const pendingButton = reloadedCard.getByRole('button', { name: '重新下载素材 品牌故事视频（已发起过下载）' });
  await pendingButton.click();
  const pendingState = reloadedCard.getByRole('button', { name: '正在准备下载素材 品牌故事视频' });
  await expect(pendingState).toBeDisabled();
  await expect(pendingState).toHaveAttribute('aria-busy', 'true');
  const requestCountBeforeRepeatedClick = await page.evaluate(id => (window as any).__getApiRequestCount(`POST /api/assets/${id}/download`), assetBrandId);
  await pendingState.click({ force: true });
  expect(await page.evaluate(id => (window as any).__getApiRequestCount(`POST /api/assets/${id}/download`), assetBrandId)).toBe(requestCountBeforeRepeatedClick);
  resolveDownload?.();
  await expect(reloadedCard.getByRole('button', { name: '重新下载素材 品牌故事视频（已发起过下载）' })).toBeEnabled();
  await page.unroute(`**/api/assets/${assetBrandId}/download`);
});

test('数字资产将页头操作迁到工具栏，空目录只有一个上传入口', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/digital-assets');
  await expect(page.getByRole('button', { name: '新建文件夹', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '上传素材', exact: true })).toHaveCount(1);

  const toolbarActions = page.getByTestId('digital-asset-toolbar-actions');
  const batch = toolbarActions.getByRole('button', { name: '批量操作', exact: true });
  const upload = toolbarActions.getByRole('button', { name: '上传素材', exact: true });
  await expect(batch).toBeVisible();
  await expect(upload).toBeVisible();
  const [batchBox, uploadBox] = await Promise.all([batch.boundingBox(), upload.boundingBox()]);
  if (!batchBox || !uploadBox) throw new Error('素材工具栏操作未完成布局');
  expect(batchBox.x).toBeLessThan(uploadBox.x);
  expect(batchBox.height).toBe(uploadBox.height);

  await page.getByRole('button', { name: '新建AI视频文件夹' }).click();
  const createDialog = page.getByRole('dialog', { name: '新建AI视频文件夹' });
  await createDialog.getByLabel('文件夹名称').fill('空目录上传入口测试');
  await createDialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('heading', { name: '空目录上传入口测试', exact: true })).toBeVisible();
  await expect(page.getByText('“空目录上传入口测试”还是空的')).toBeVisible();
  await expect(page.getByRole('button', { name: '上传素材', exact: true })).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 760 });
  const [mobileBatchBox, mobileUploadBox] = await Promise.all([batch.boundingBox(), upload.boundingBox()]);
  if (!mobileBatchBox || !mobileUploadBox) throw new Error('手机素材工具栏操作未完成布局');
  expect(Math.abs(mobileBatchBox.width - mobileUploadBox.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(mobileBatchBox.y - mobileUploadBox.y)).toBeLessThanOrEqual(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('数字资产操作菜单支持键盘，文件夹可安全迁回或强确认永久删除', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/digital-assets');

  const brandMenu = page.getByRole('button', { name: '更多操作：品牌故事视频' });
  await brandMenu.focus();
  await brandMenu.press('ArrowDown');
  const brandPopup = page.getByRole('menu', { name: '更多操作：品牌故事视频' });
  await expect(brandPopup).toBeVisible();
  const brandPopupBox = await brandPopup.boundingBox();
  if (!brandPopupBox) throw new Error('素材菜单未完成定位');
  expect(brandPopupBox.width).toBeGreaterThanOrEqual(175);
  expect(brandPopupBox.width).toBeLessThanOrEqual(177);
  await expect(page.getByRole('menuitem', { name: '重命名' })).toBeFocused();
  await page.getByRole('menuitem', { name: '重命名' }).press('End');
  await expect(page.getByRole('menuitem', { name: '删除', exact: true })).toBeFocused();
  await page.getByRole('menuitem', { name: '删除', exact: true }).press('Escape');
  await expect(brandMenu).toBeFocused();
  await expect(page.getByRole('menu', { name: '更多操作：品牌故事视频' })).toHaveCount(0);

  const productFolderMenu = page.getByRole('button', { name: '更多操作：文件夹 产品发布' });
  const rootCount = page.getByRole('button', { name: /^选择主目录，/ }).locator('span').last();
  const productCount = page.getByRole('button', { name: /^打开文件夹 产品发布，/ }).locator('span').last();
  const [rootCountBox, productCountBox] = await Promise.all([rootCount.boundingBox(), productCount.boundingBox()]);
  if (!rootCountBox || !productCountBox) throw new Error('文件夹数量列未完成布局');
  expect(Math.abs((rootCountBox.x + rootCountBox.width) - (productCountBox.x + productCountBox.width))).toBeLessThanOrEqual(1);
  await productFolderMenu.focus();
  await productFolderMenu.press('ArrowDown');
  const productFolderPopup = page.getByRole('menu', { name: '更多操作：文件夹 产品发布' });
  await expect(productFolderPopup).toBeVisible();
  const productFolderPopupBox = await productFolderPopup.boundingBox();
  if (!productFolderPopupBox) throw new Error('文件夹菜单未完成定位');
  expect(productFolderPopupBox.width).toBeGreaterThanOrEqual(175);
  expect(productFolderPopupBox.width).toBeLessThanOrEqual(177);
  await expect(page.getByRole('menuitem', { name: '重命名' })).toBeFocused();
  await page.getByRole('menuitem', { name: '重命名' }).press('End');
  await expect(page.getByRole('menuitem', { name: '删除文件夹' })).toBeFocused();
  await page.getByRole('menuitem', { name: '删除文件夹' }).press('Escape');
  await expect(productFolderMenu).toBeFocused();

  await productFolderMenu.click();
  await page.getByRole('menuitem', { name: '删除文件夹' }).click();
  const moveDeleteDialog = page.getByRole('alertdialog', { name: '删除文件夹' });
  await expect(moveDeleteDialog.getByText('“产品发布”中有 1 个素材。删除文件夹后，如何处理？')).toBeVisible();
  await expect(moveDeleteDialog.getByRole('radio', { name: /移到主目录/ })).toBeChecked();
  await moveDeleteDialog.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('button', { name: /^打开文件夹 产品发布，/ })).toHaveCount(0);
  await expect(page.getByText('产品发布宣传片', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: '新建AI视频文件夹', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: '新建AI视频文件夹' });
  await createDialog.getByLabel('文件夹名称').fill('待永久删除目录');
  await createDialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(createDialog).toHaveCount(0);

  const createdFolderMenu = page.getByRole('button', { name: '更多操作：文件夹 待永久删除目录' });
  await createdFolderMenu.click();
  await page.getByRole('menuitem', { name: '重命名' }).click();
  const renameDialog = page.getByRole('dialog', { name: '重命名文件夹' });
  await renameDialog.getByLabel('文件夹名称').fill('永久删除确认目录');
  await renameDialog.getByRole('button', { name: '保存' }).click();
  await expect(renameDialog).toHaveCount(0);

  await page.getByRole('button', { name: /^选择主目录，/ }).click();
  await page.getByRole('button', { name: '批量操作' }).click();
  await page.getByRole('button', { name: '选择素材 品牌故事视频' }).click();
  await page.getByRole('combobox', { name: '选择目标文件夹' }).click();
  await page.getByRole('option', { name: '永久删除确认目录' }).click();
  await page.getByRole('button', { name: '移动' }).click();
  await page.getByRole('button', { name: '确认移动' }).click();
  await page.getByRole('button', { name: /^打开文件夹 永久删除确认目录，/ }).click();
  await expect(page.getByText('品牌故事视频', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: '更多操作：文件夹 永久删除确认目录' }).click();
  await page.getByRole('menuitem', { name: '删除文件夹' }).click();
  const permanentDeleteDialog = page.getByRole('alertdialog', { name: '删除文件夹' });
  await permanentDeleteDialog.getByRole('radio', { name: /同时删除内部素材/ }).click();
  const permanentConfirm = permanentDeleteDialog.getByRole('button', { name: '确认删除' });
  const folderNameConfirmation = permanentDeleteDialog.getByLabel(/输入完整文件夹名称/);
  await expect(permanentConfirm).toBeDisabled();
  await folderNameConfirmation.fill('不匹配');
  await expect(permanentConfirm).toBeDisabled();
  await folderNameConfirmation.fill('永久删除确认目录');
  await expect(permanentConfirm).toBeEnabled();
  await permanentConfirm.click();
  await expect(page.getByRole('button', { name: /^打开文件夹 永久删除确认目录，/ })).toHaveCount(0);
  await expect(page.getByText('品牌故事视频', { exact: true })).toHaveCount(0);
});

test('用户与后台列表只请求当前页并支持首页上一页下一页尾页', async ({ page }) => {
  await page.evaluate(() => (window as any).__setCursorPageSizeCap(1));
  await page.goto('/app/digital-assets');

  await expect(page.getByRole('heading', { name: '数字资产' })).toBeVisible();
  await expect(page.getByText('教程演示视频', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/assets/cards'))).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/assets'))).toBe(0);

  const assetPager = page.getByRole('navigation', { name: '数字资产翻页' });
  await expect(assetPager.getByRole('button', { name: '首页' })).toBeDisabled();
  await expect(assetPager.getByRole('button', { name: '上一页' })).toBeDisabled();
  await expect(assetPager.getByRole('button', { name: '下一页' })).toBeEnabled();
  await expect(assetPager.getByRole('button', { name: '尾页' })).toBeEnabled();
  await expect(assetPager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  await expect(assetPager.getByRole('button', { name: '首页' })).toHaveText('');
  await assetPager.getByRole('button', { name: '下一页' }).hover();
  await expect(assetPager.getByText('下一页', { exact: true })).toBeVisible();
  await assetPager.getByRole('button', { name: '尾页' }).focus();
  await expect(assetPager.getByText('尾页', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '批量操作' }).click();
  await page.getByRole('button', { name: '选择本页 1 项' }).click();
  await expect(page.getByText('已选择 1 个', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择素材 教程演示视频' })).toHaveAttribute('aria-pressed', 'true');

  await assetPager.getByRole('button', { name: '尾页' }).click();
  await expect(page.getByText('品牌故事视频', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/assets/cards'))).toBe(2);
  await expect(page.getByText('已选择 0 个', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择素材 品牌故事视频' })).toHaveAttribute('aria-pressed', 'false');
  await expect(assetPager.getByRole('button', { name: '下一页' })).toBeDisabled();
  await expect(assetPager.getByRole('button', { name: '尾页' })).toBeDisabled();
  await expect(assetPager.getByRole('status', { name: '第 2 页，共 2 页' })).toBeVisible();
  await assetPager.getByRole('button', { name: '上一页' }).click();
  await expect(page.getByText('教程演示视频', { exact: true })).toBeVisible();
  await assetPager.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('品牌故事视频', { exact: true })).toBeVisible();
  await assetPager.getByRole('button', { name: '首页' }).click();
  await expect(page.getByText('教程演示视频', { exact: true })).toBeVisible();

  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: '用户管理', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/admin/users'))).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/admin/orders'))).toBe(0);
  const adminPager = page.getByRole('navigation', { name: '用户分页导航' });
  await expect(adminPager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  await expect(adminPager.getByRole('button', { name: '首页' })).toHaveText('');
  await expect(adminPager.getByRole('button', { name: '下一页' })).toBeEnabled();
  await adminPager.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('pro.user@lindyson.ai', { exact: true })).toBeVisible();
  await expect(adminPager.getByRole('status', { name: '第 2 页，共 2 页' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/admin/users'))).toBe(2);
});

test('管理后台精准分页快照失效时保留旧表格、只提示一次并自动回首页', async ({ page }) => {
  await page.evaluate(() => (window as any).__setCursorPageSizeCap(1));
  await page.evaluate(() => (window as any).__failNextPaginationSnapshot());
  await page.goto('/admin/users');

  const pager = page.getByRole('navigation', { name: '用户分页导航' });
  await expect(pager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  await expect(page.getByText('admin@lindyson.ai', { exact: true })).toBeVisible();
  await pager.getByRole('button', { name: '下一页' }).click();

  await expect(page.getByText('列表已更新，已返回第 1 页', { exact: true })).toBeVisible();
  await expect(page.getByText('admin@lindyson.ai', { exact: true })).toBeVisible();
  await expect(pager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  await expect(page.getByText('列表已更新，已返回第 1 页', { exact: true })).toHaveCount(1);
});

test('管理后台精准分页加载时保留旧表格和页码并禁用重复点击', async ({ page }) => {
  await page.evaluate(() => (window as any).__setCursorPageSizeCap(1));
  await page.goto('/admin/users');

  const pager = page.getByRole('navigation', { name: '用户分页导航' });
  await expect(pager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  const heldRequest = await holdFirstApiRequest(page, '**/api/admin/users?**');
  await pager.getByRole('button', { name: '下一页' }).click();

  await expect.poll(() => heldRequest.requestCount).toBe(1);
  await expect(pager).toHaveAttribute('aria-busy', 'true');
  for (const name of ['首页', '上一页', '下一页', '尾页']) {
    await expect(pager.getByRole('button', { name })).toBeDisabled();
  }
  await expect(page.getByText('admin@lindyson.ai', { exact: true })).toBeVisible();
  await expect(pager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();

  heldRequest.release();
  await expect(pager).toHaveAttribute('aria-busy', 'false');
  await expect(pager.getByRole('status', { name: '第 2 页，共 2 页' })).toBeVisible();
  await expect(page.getByText('pro.user@lindyson.ai', { exact: true })).toBeVisible();
});

test('资产卡片和详情 DTO 不暴露对象 key，旧全量接口与旧参考载荷已删除', async ({ page }) => {
  await page.goto('/app/digital-assets');
  const result = await page.evaluate(async assetId => {
    const [cardsResponse, detailResponse, legacyListResponse, legacyReferenceResponse] = await Promise.all([
      fetch('/api/assets/cards?position=first&limit=24&source=ai-video'),
      fetch(`/api/assets/${assetId}`),
      fetch('/api/assets'),
      fetch('/api/ai/video-tasks/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: 'e2e-legacy-reference-payload',
          requests: [{
            model: 'Seedance 2.0',
            prompt: '旧载荷不得创建任务',
            config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
            references: [{ assetId, role: 'reference_video', objectKey: 'users/e2e/forbidden.mp4' }],
          }],
        }),
      }),
    ]);
    return {
      cards: await cardsResponse.json(),
      detail: await detailResponse.json(),
      legacyListStatus: legacyListResponse.status,
      legacyReferenceStatus: legacyReferenceResponse.status,
      legacyReferenceBody: await legacyReferenceResponse.json(),
    };
  }, assetBrandId);

  expect(result.legacyListStatus).toBe(404);
  expect(result.legacyReferenceStatus).toBe(400);
  expect(result.legacyReferenceBody.code).toBe('INVALID_REFERENCE_PAYLOAD');
  expect(JSON.stringify(result.cards)).not.toMatch(/objectKey|thumbnailKey|publicUrl|generation/);
  expect(JSON.stringify(result.detail)).not.toMatch(/objectKey|thumbnailKey/);
});

test('视频成本主看盘与高级对账明细均使用精准快照分页且替换当前页', async ({ page }) => {
  await page.evaluate(() => (window as any).__setCursorPageSizeCap(1));
  await page.goto('/admin/api-usage?range=month&month=2026-06');
  await expect(page.getByRole('heading', { name: '成本看盘' })).toBeVisible();

  for (const title of ['用户成本汇总', '任务成本明细']) {
    const section = page.locator('section').filter({
      has: page.getByRole('heading', { name: title, exact: true }),
    });
    await expect(section.getByText('本页 1 条 · 共 2 条')).toBeVisible();
    await expect(section.getByRole('button', { name: '首页', exact: true })).toBeDisabled();
    await expect(section.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
    await section.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(section.getByRole('button', { name: '上一页', exact: true })).toBeEnabled();
    await expect(section.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    await section.getByRole('button', { name: '上一页', exact: true }).click();
    await expect(section.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
    await section.getByRole('button', { name: '尾页', exact: true }).click();
    await expect(section.getByRole('button', { name: '尾页', exact: true })).toBeDisabled();
    await section.getByRole('button', { name: '首页', exact: true }).click();
    await expect(section.getByRole('button', { name: '首页', exact: true })).toBeDisabled();
  }

  await page.getByRole('button', { name: '高级对账' }).click();
  await expect(page).toHaveURL(/\/admin\/api-usage\/audit\?costType=video&range=month&month=2026-06$/);
  await expect(page.getByRole('heading', { name: '高级成本对账' })).toBeVisible();
  for (const title of ['用量与估值对账矩阵', '结算与资源包', '供应商 attempt 与用量证据']) {
    const section = page.locator('section').filter({
      has: page.getByRole('heading', { name: title, exact: true }),
    });
    await expect(section.getByText('本页 1 条 · 共 2 条')).toBeVisible();
    await section.getByRole('button', { name: '尾页', exact: true }).click();
    await expect(section.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    await expect(section.getByRole('button', { name: '上一页', exact: true })).toBeEnabled();
    await section.getByRole('button', { name: '首页', exact: true }).click();
    await expect(section.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
  }

  const attemptSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: '供应商 attempt 与用量证据', exact: true }),
  });
  await attemptSection.getByRole('button', { name: '尾页', exact: true }).click();
  const pendingResolutionRow = attemptSection.getByRole('row').filter({ hasText: '待最终账单确认' });
  await expect(pendingResolutionRow).toBeVisible();
  await pendingResolutionRow.getByRole('button', { name: /查看任务详情/ }).click();
  await expect(page.getByText('案件证据', { exact: true })).toBeVisible();
  await expect(page.getByText(/\u5386\u53f2\u5931\u8d25\u56de\u6267\u5df2\u8fc7\u67e5\u8be2\u671f/)).toBeVisible();
});

test('视频成本主看盘只展示经营口径并按发起时间倒序列出一任务一行', async ({ page }) => {
  await page.goto('/admin/api-usage?range=month&month=2026-06');
  await expect(page.getByRole('heading', { name: '成本看盘' })).toBeVisible();

  await expect(page.getByText('当前可用人民币余额', { exact: true })).toBeVisible();
  await expect(page.getByText('本期最终实扣积分', { exact: true })).toBeVisible();
  await expect(page.getByText('本期供应商估算成本', { exact: true })).toBeVisible();
  await expect(page.getByText('已知金额已对上，1 项待最终账单确认', { exact: true })).toBeVisible();
  await expect(page.getByText('80 积分', { exact: true })).toBeVisible();
  await expect(page.getByText('¥0.552000+', { exact: true }).first()).toBeVisible();

  for (const hiddenAuditTerm of ['三本账摘要', '原始本地', '推断调整', '调整后本地', '未解释残差']) {
    await expect(page.getByText(hiddenAuditTerm, { exact: true })).toHaveCount(0);
  }

  const modelSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: '模型成本汇总', exact: true }),
  });
  await expect(modelSection.getByText('价格版本', { exact: true })).toBeVisible();
  await expect(modelSection.getByText('成本完整性', { exact: true })).toBeVisible();
  await expect(modelSection.getByText('volcengine-seedance-2026-07-10', { exact: true })).toBeVisible();
  await expect(modelSection.getByText('完整估值', { exact: true })).toBeVisible();
  await expect(modelSection.getByText('估值不可用', { exact: true })).toBeVisible();

  const taskSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: '任务成本明细', exact: true }),
  });
  const taskRows = taskSection.getByRole('row');
  await expect(taskRows).toHaveCount(3);
  await expect(taskRows.nth(1)).toContainText('管理员');
  await expect(taskRows.nth(1)).toContainText('80');
  await expect(taskRows.nth(2)).toContainText('Pro User');
  await expect(taskRows.nth(2)).toContainText('0（已退 35）');
  await expect(taskRows.nth(2)).toContainText('待终账确认');
  await expect(taskRows.nth(2)).toContainText('当前账单未发现额外费用');

  const observedCostRequests: URL[] = [];
  page.on('request', request => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname.startsWith('/api/admin/api-usage')) observedCostRequests.push(requestUrl);
  });
  const userSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: '用户成本汇总', exact: true }),
  });
  const filteredTaskRequest = page.waitForRequest(request => {
    const requestUrl = new URL(request.url());
    return requestUrl.pathname === '/api/admin/api-usage/tasks'
      && requestUrl.searchParams.get('search') === 'admin@lindyson.ai';
  });
  await userSection.getByRole('button', { name: /查看用户详情/ }).first().click();
  await filteredTaskRequest;
  await expect(taskSection.getByRole('row')).toHaveCount(2);
  expect(observedCostRequests.filter(requestUrl => requestUrl.pathname !== '/api/admin/api-usage/tasks').every(requestUrl => !requestUrl.searchParams.has('search'))).toBe(true);
  await expect(page.getByText('已知金额已对上，1 项待最终账单确认', { exact: true })).toBeVisible();
});

test('视频成本四模型常驻且单模型筛选不把平台调用伪造成业务任务', async ({ page }) => {
  await page.goto('/admin/api-usage?range=month&month=2026-06');
  await expect(page.getByRole('heading', { name: '成本看盘' })).toBeVisible();

  const modelSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: '模型成本汇总', exact: true }),
  });
  const rows = modelSection.getByRole('row');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(1).getByRole('cell').nth(0)).toHaveText('Seedance 2.5');
  await expect(rows.nth(2).getByRole('cell').nth(0)).toHaveText('Seedance 2.0');
  await expect(rows.nth(3).getByRole('cell').nth(0)).toHaveText('Seedance 2.0 Fast');
  await expect(rows.nth(4).getByRole('cell').nth(0)).toHaveText('Seedance 2.0 Mini');
  await expect(rows.nth(2).getByRole('cell').nth(1)).toHaveText('1');
  await expect(rows.nth(2).getByRole('cell').nth(2)).toHaveText('3');
  await expect(page.getByText('平台调用 3 次 / ¥0.000000', { exact: false })).toBeVisible();

  const modelTrigger = page.getByRole('combobox', { name: '模型', exact: true });
  await modelTrigger.click();
  const filteredOverview = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/admin/api-usage/overview'
      && url.searchParams.get('model') === 'Seedance 2.5';
  });
  await page.getByRole('listbox', { name: '模型', exact: true })
    .getByRole('option', { name: '2.5', exact: true }).click();
  await filteredOverview;

  await expect.poll(() => new URL(page.url()).searchParams.get('model')).toBe('Seedance 2.5');
  await expect(modelSection.getByRole('row')).toHaveCount(2);
  await expect(modelSection.getByRole('row').nth(1).getByRole('cell').nth(0)).toHaveText('Seedance 2.5');
  await expect(modelSection.getByRole('row').nth(1).getByRole('cell').nth(1)).toHaveText('0');
  await expect(modelSection.getByRole('row').nth(1).getByRole('cell').nth(2)).toHaveText('0');
});

test('官方账单页透传业务筛选并明确提示账户级与待归属边界', async ({ page }) => {
  const asOf = '2026-06-30T10:00:00.000Z';
  const selection = {
    range: 'month', month: '2026-06', date: null,
    rangeStart: '2026-06-01', rangeEnd: '2026-06-30',
    timezone: 'Asia/Shanghai', grain: 'day',
  };
  const amounts = {
    originalBillAmountCny: '15.000000', preferentialBillAmountCny: '13.000000',
    discountBillAmountCny: '2.000000', couponAmountCny: '1.000000',
    payableAmountCny: '12.000000', paidAmountCny: '10.000000', unpaidAmountCny: '2.000000',
  };
  const billingDetails = [{
    id: mockUuid('official-account-level'), provider: 'volcengine-ark',
    sourceDetailKey: 'account-package', billPeriod: '2026-06', expenseDate: '2026-06-30',
    product: 'ark', productName: '火山方舟', serviceType: 'video', model: null,
    billLineType: 'package-purchase', finality: 'final', attributionStatus: 'account-level',
    attributionEvidenceId: null, billingMode: 'subscription', billCategory: 'package',
    instanceNo: null, configName: 'Seedance 套餐', usageCount: null, usageUnit: null,
    deductionCount: null, ...amounts, roundAmountCny: '0.000000', currency: 'CNY',
    currentRevisionId: mockUuid('official-account-level-revision'), syncedAt: asOf,
  }, {
    id: mockUuid('official-unattributed'), provider: 'volcengine-ark',
    sourceDetailKey: 'unknown-adjustment', billPeriod: '2026-06', expenseDate: '2026-06-29',
    product: 'ark', productName: '火山方舟', serviceType: 'video', model: null,
    billLineType: 'adjustment', finality: 'provisional', attributionStatus: 'unattributed',
    attributionEvidenceId: null, billingMode: null, billCategory: 'adjustment',
    instanceNo: null, configName: null, usageCount: null, usageUnit: null,
    deductionCount: null, ...amounts, roundAmountCny: '0.000000', currency: 'CNY',
    currentRevisionId: mockUuid('official-unattributed-revision'), syncedAt: asOf,
  }];

  await page.route('**/api/admin/provider-billing/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/provider-billing/overview') {
      await json(route, {
        asOf, selection,
        summary: {
          lineCount: 2, productCount: 1, finalLineCount: 1, provisionalLineCount: 1, ...amounts,
        },
        products: [{
          product: 'ark', productName: '火山方舟', serviceType: 'video', lineCount: 2,
          finalLineCount: 1, provisionalLineCount: 1, ...amounts,
        }],
        byServiceType: [{ serviceType: 'video', lineCount: 2, ...amounts }],
        byAttribution: [
          { attributionStatus: 'account-level', lineCount: 1, ...amounts },
          { attributionStatus: 'unattributed', lineCount: 1, ...amounts },
        ],
      });
      return;
    }
    if (url.pathname === '/api/admin/provider-billing/details') {
      const attribution = url.searchParams.get('attributionStatus');
      const items = attribution
        ? billingDetails.filter(item => item.attributionStatus === attribution)
        : billingDetails;
      await json(route, {
        items,
        pagination: {
          limit: 20, hasPrevious: false, hasNext: false,
          previousCursor: null, nextCursor: null,
          currentPage: items.length > 0 ? 1 : 0,
          totalPages: items.length > 0 ? 1 : 0,
          totalItems: items.length,
          snapshotCursor: `official-details-${attribution ?? 'all'}`,
        },
        asOf, selection,
      });
      return;
    }
    if (url.pathname === '/api/admin/provider-billing/operational-usage') {
      await json(route, {
        items: [],
        pagination: {
          limit: 20, hasPrevious: false, hasNext: false,
          previousCursor: null, nextCursor: null,
          currentPage: 0, totalPages: 0, totalItems: 0,
          snapshotCursor: 'official-operational-empty',
        },
        asOf, selection,
      });
      return;
    }
    await route.fallback();
  });

  await page.goto('/admin/api-usage/bills?range=month&month=2026-06');
  await expect(page.getByRole('heading', { name: '官方账单', exact: true })).toBeVisible();
  await expect(page.getByText('账户级费用不按模型或业务任务伪分摊', { exact: false })).toBeVisible();
  await expect(page.getByText('待归属表示当前证据不足', { exact: false })).toBeVisible();
  for (const label of ['官方原价金额', '官方优惠后金额', '官方应付金额', '官方已付金额', '官方未付金额']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }

  const chooseFilter = async (label: string, option: string, parameter: string, value: string) => {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    const request = page.waitForRequest(candidate => {
      const url = new URL(candidate.url());
      return url.pathname === '/api/admin/provider-billing/overview'
        && url.searchParams.get(parameter) === value;
    });
    await page.getByRole('listbox', { name: label, exact: true })
      .getByRole('option', { name: option, exact: true }).click();
    await request;
  };
  await chooseFilter('产品', '火山方舟 · ark', 'product', 'ark');
  await chooseFilter('服务', '视频生成', 'serviceType', 'video');
  await chooseFilter('终账', '终账', 'finality', 'final');

  const modelRequest = page.waitForRequest(candidate => {
    const url = new URL(candidate.url());
    return url.pathname === '/api/admin/provider-billing/overview'
      && url.searchParams.get('model') === 'Seedance 2.5';
  });
  await page.getByRole('textbox', { name: '模型', exact: true }).fill('Seedance 2.5');
  await modelRequest;

  await chooseFilter('归属', '账户级', 'attributionStatus', 'account-level');
  const detailSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: '逐行官方账单', exact: true }),
  });
  await expect(detailSection.getByText('账户级费用', { exact: true })).toBeVisible();

  await chooseFilter('归属', '待归属', 'attributionStatus', 'unattributed');
  await expect(detailSection.getByText('待归属', { exact: true })).toBeVisible();
  await expect.poll(() => {
    const url = new URL(page.url());
    return [
      url.searchParams.get('product'), url.searchParams.get('serviceType'),
      url.searchParams.get('model'), url.searchParams.get('finality'),
      url.searchParams.get('attributionStatus'),
    ].join('|');
  }).toBe('ark|video|Seedance 2.5|final|unattributed');
});

test('官方账单快照失效时用新 asOf 重建汇总和两张列表并只提示一次', async ({ page }) => {
  const initialAsOf = '2026-06-30T10:00:00.000Z';
  const nextAsOf = '2026-06-30T10:01:00.000Z';
  let currentAsOf = initialAsOf;
  let failNextSnapshot = false;
  const requestCounts = { overview: 0, details: 0, operations: 0 };
  const selection = {
    range: 'month', month: '2026-06', date: null,
    rangeStart: '2026-06-01', rangeEnd: '2026-06-30',
    timezone: 'Asia/Shanghai', grain: 'day',
  };
  const amounts = {
    originalBillAmountCny: '15.000000', preferentialBillAmountCny: '13.000000',
    discountBillAmountCny: '2.000000', couponAmountCny: '1.000000',
    payableAmountCny: '12.000000', paidAmountCny: '10.000000', unpaidAmountCny: '2.000000',
  };
  const billingDetails = [0, 1].map(index => ({
    id: mockUuid(`official-refresh-${index + 1}`), provider: 'volcengine-ark',
    sourceDetailKey: `refresh-line-${index + 1}`, billPeriod: '2026-06',
    expenseDate: `2026-06-${30 - index}`, product: 'ark', productName: '火山方舟',
    serviceType: 'video', model: 'Seedance 2.5', billLineType: 'usage',
    finality: 'final', attributionStatus: 'business', attributionEvidenceId: null,
    billingMode: 'payg', billCategory: 'inference', instanceNo: null,
    configName: 'Seedance 2.5', usageCount: '1.000000', usageUnit: '次',
    deductionCount: null, ...amounts, roundAmountCny: '0.000000', currency: 'CNY',
    currentRevisionId: mockUuid(`official-refresh-revision-${index + 1}`), syncedAt: currentAsOf,
  }));

  await page.route('**/api/admin/provider-billing/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/provider-billing/overview') {
      requestCounts.overview += 1;
      await json(route, {
        asOf: currentAsOf, selection,
        summary: {
          lineCount: 2, productCount: 1, finalLineCount: 2, provisionalLineCount: 0, ...amounts,
        },
        products: [{
          product: 'ark', productName: '火山方舟', serviceType: 'video', lineCount: 2,
          finalLineCount: 2, provisionalLineCount: 0, ...amounts,
        }],
        byServiceType: [{ serviceType: 'video', lineCount: 2, ...amounts }],
        byAttribution: [{ attributionStatus: 'business', lineCount: 2, ...amounts }],
      });
      return;
    }
    if (url.pathname === '/api/admin/provider-billing/details') {
      requestCounts.details += 1;
      if (failNextSnapshot && url.searchParams.has('snapshotCursor')) {
        failNextSnapshot = false;
        await json(route, {
          message: '列表已更新，请重新建立分页快照',
          code: 'PAGINATION_SNAPSHOT_CHANGED',
        }, 409);
        return;
      }
      await json(route, {
        ...cursorPage(billingDetails.map(item => ({ ...item, syncedAt: currentAsOf })), url, 1),
        asOf: currentAsOf,
        selection,
      });
      return;
    }
    if (url.pathname === '/api/admin/provider-billing/operational-usage') {
      requestCounts.operations += 1;
      await json(route, {
        ...cursorPage([], url, 1),
        asOf: currentAsOf,
        selection,
      });
      return;
    }
    await route.fallback();
  });

  await page.goto('/admin/api-usage/bills?range=month&month=2026-06');
  const detailPager = page.getByRole('navigation', { name: '逐行官方账单分页导航' });
  await expect(detailPager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  await expect.poll(() => ({ ...requestCounts })).toEqual({ overview: 1, details: 1, operations: 1 });

  failNextSnapshot = true;
  currentAsOf = nextAsOf;
  const refreshedDetails = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/admin/provider-billing/details'
      && url.searchParams.get('asOf') === nextAsOf
      && !url.searchParams.has('snapshotCursor');
  });
  const refreshedOperations = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/admin/provider-billing/operational-usage'
      && url.searchParams.get('asOf') === nextAsOf
      && !url.searchParams.has('snapshotCursor');
  });

  await detailPager.getByRole('button', { name: '下一页' }).click();
  await Promise.all([refreshedDetails, refreshedOperations]);

  await expect.poll(() => ({ ...requestCounts })).toEqual({ overview: 2, details: 3, operations: 2 });
  await expect(detailPager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  await expect(page.getByText('列表已更新，已返回第 1 页', { exact: true })).toHaveCount(1);
});

test('成本看盘双视图按需加载并用 costType 恢复当前视图', async ({ page }) => {
  await page.goto('/admin/api-usage?range=month&month=2026-06');
  await expect(page.getByRole('heading', { name: '成本看盘' })).toBeVisible();
  await expect(page.getByRole('button', { name: '视频生成', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => new URL(page.url()).searchParams.get('costType')).toBe('video');
  await expect.poll(() => page.evaluate(async () => ({
    video: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/overview'),
    multimodal: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/overview'),
  }))).toEqual({ video: 1, multimodal: 0 });

  await page.getByRole('button', { name: '多模态模型', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('costType')).toBe('multimodal');
  await expect(page.getByRole('button', { name: '多模态模型', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '高级对账', exact: true })).toHaveCount(0);
  await expect(page.getByText('Doubao Seed 2.0 Lite', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('¥1.019045', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('¥1.019045+', { exact: true })).toHaveCount(0);
  await expect(page.getByText('5 项历史聚合 Token 已定价、0 项历史证据不足', { exact: true })).toBeVisible();
  await expect(page.getByText('历史证据不足 / 待核对', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '分析与方案批次明细', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => ({
    video: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/overview'),
    overview: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/overview'),
    users: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/users'),
    operations: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/operations'),
  }))).toEqual({ video: 1, overview: 1, users: 1, operations: 1 });

  const operationSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: '分析与方案批次明细', exact: true }),
  });
  const historicalPricedRow = operationSection.getByRole('row').filter({ hasText: '¥0.000912' });
  await historicalPricedRow.getByRole('button').click();
  await expect(page.getByText('历史聚合 Token 定价', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();

  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await expect(page.getByText('后台数据已刷新', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => ({
    video: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/overview'),
    overview: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/overview'),
    users: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/users'),
    operations: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/operations'),
  }))).toEqual({ video: 1, overview: 2, users: 2, operations: 2 });

  const filteredOperationRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/admin/api-usage/multimodal/operations'
      && url.searchParams.get('operationType') === 'plan-batch';
  });
  await page.getByRole('combobox', { name: '操作类型', exact: true }).click();
  await page.getByRole('listbox', { name: '操作类型', exact: true }).getByRole('option', { name: '方案批次', exact: true }).click();
  await filteredOperationRequest;
  await expect(page.getByRole('heading', { name: '用户成本汇总', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '视频生成', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('costType')).toBe('video');
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '高级对账', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => ({
    video: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/overview'),
    multimodal: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/overview'),
  }))).toEqual({ video: 2, multimodal: 2 });
});

test('图片成本快照失效时用新 asOf 重建汇总和两张列表并只提示一次', async ({ page }) => {
  const nextAsOf = '2026-06-30T10:01:00.000Z';
  await page.evaluate(() => (window as any).__setCursorPageSizeCap(1));
  await page.goto('/admin/api-usage?costType=image&range=month&month=2026-06');

  const taskPager = page.getByRole('navigation', { name: '图片任务成本明细分页导航' });
  await expect(taskPager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => ({
    overview: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/image/overview'),
    users: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/image/users'),
    tasks: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/image/tasks'),
  }))).toEqual({ overview: 1, users: 1, tasks: 1 });

  await page.evaluate(() => (window as any).__failNextPaginationSnapshot());
  await page.evaluate(asOf => (window as any).__setApiCostAsOf(asOf), nextAsOf);
  const refreshedUsers = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/admin/api-usage/image/users'
      && url.searchParams.get('asOf') === nextAsOf
      && !url.searchParams.has('snapshotCursor');
  });
  const refreshedTasks = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/admin/api-usage/image/tasks'
      && url.searchParams.get('asOf') === nextAsOf
      && !url.searchParams.has('snapshotCursor');
  });

  await taskPager.getByRole('button', { name: '下一页' }).click();
  await Promise.all([refreshedUsers, refreshedTasks]);

  await expect.poll(() => page.evaluate(async () => ({
    overview: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/image/overview'),
    users: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/image/users'),
    tasks: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/image/tasks'),
  }))).toEqual({ overview: 2, users: 2, tasks: 3 });
  await expect(taskPager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  await expect(page.getByText('列表已更新，已返回第 1 页', { exact: true })).toHaveCount(1);
});

test('多模态成本快照失效时用新 asOf 重建汇总和两张列表并只提示一次', async ({ page }) => {
  const nextAsOf = '2026-06-30T10:01:00.000Z';
  await page.evaluate(() => (window as any).__setCursorPageSizeCap(1));
  await page.goto('/admin/api-usage?costType=multimodal&range=month&month=2026-06');

  const operationPager = page.getByRole('navigation', { name: '多模态操作成本明细分页导航' });
  await expect(operationPager.getByRole('status', { name: '第 1 页，共 3 页' })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => ({
    overview: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/overview'),
    users: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/users'),
    operations: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/operations'),
  }))).toEqual({ overview: 1, users: 1, operations: 1 });

  await page.evaluate(() => (window as any).__failNextPaginationSnapshot());
  await page.evaluate(asOf => (window as any).__setApiCostAsOf(asOf), nextAsOf);
  const refreshedUsers = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/admin/api-usage/multimodal/users'
      && url.searchParams.get('asOf') === nextAsOf
      && !url.searchParams.has('snapshotCursor');
  });
  const refreshedOperations = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/admin/api-usage/multimodal/operations'
      && url.searchParams.get('asOf') === nextAsOf
      && !url.searchParams.has('snapshotCursor');
  });

  await operationPager.getByRole('button', { name: '下一页' }).click();
  await Promise.all([refreshedUsers, refreshedOperations]);

  await expect.poll(() => page.evaluate(async () => ({
    overview: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/overview'),
    users: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/users'),
    operations: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/operations'),
  }))).toEqual({ overview: 2, users: 2, operations: 3 });
  await expect(operationPager.getByRole('status', { name: '第 1 页，共 3 页' })).toBeVisible();
  await expect(page.getByText('列表已更新，已返回第 1 页', { exact: true })).toHaveCount(1);
});

test('多模态成本用户与操作明细分别使用精准快照分页', async ({ page }) => {
  await page.evaluate(() => (window as any).__setCursorPageSizeCap(1));
  await page.goto('/admin/api-usage?costType=multimodal&range=month&month=2026-06');
  await expect(page.getByText('Doubao Seed 2.0 Lite', { exact: true }).first()).toBeVisible();

  for (const { title, total } of [
    { title: '用户成本汇总', total: 2 },
    { title: '分析与方案批次明细', total: 3 },
  ]) {
    const section = page.locator('section').filter({
      has: page.getByRole('heading', { name: title, exact: true }),
    });
    await expect(section.getByText(`本页 1 条 · 共 ${total} 条`, { exact: true })).toBeVisible();
    await expect(section.getByRole('button', { name: '首页', exact: true })).toBeDisabled();
    await section.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(section.getByRole('button', { name: '上一页', exact: true })).toBeEnabled();
    await section.getByRole('button', { name: '上一页', exact: true }).click();
    await section.getByRole('button', { name: '尾页', exact: true }).click();
    await expect(section.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    await section.getByRole('button', { name: '首页', exact: true }).click();
    await expect(section.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
  }

  await expect.poll(() => page.evaluate(async () => ({
    overview: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/multimodal/overview'),
    video: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/overview'),
  }))).toEqual({ overview: 1, video: 0 });
});

test('视频成本主看盘首屏请求不重复，搜索只刷新任务，同步不重载用户和任务', async ({ page }) => {
  await page.goto('/admin/api-usage?range=month&month=2026-06');
  await expect(page.getByText('80 积分', { exact: true })).toBeVisible();

  await expect.poll(() => page.evaluate(async () => ({
    overview: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/overview'),
    users: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/users'),
    tasks: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/tasks'),
    audit: await (window as any).__getApiRequestCount('GET /api/admin/api-usage'),
  }))).toEqual({ overview: 1, users: 1, tasks: 1, audit: 0 });

  await page.getByPlaceholder('搜索用户、邮箱或任务 ID...').fill('admin@lindyson.ai');
  await expect.poll(() => page.evaluate(async () => ({
    overview: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/overview'),
    users: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/users'),
    tasks: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/tasks'),
  }))).toEqual({ overview: 1, users: 1, tasks: 2 });

  const beforeSync = await page.evaluate(async () => ({
    overview: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/overview'),
    users: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/users'),
    tasks: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/tasks'),
    sync: await (window as any).__getApiRequestCount('POST /api/admin/provider-billing/sync'),
  }));
  await page.getByRole('button', { name: '同步费用中心' }).click();
  await expect(page.getByText('费用中心同步已进入后台队列', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => ({
    overview: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/overview'),
    users: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/users'),
    tasks: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/tasks'),
    sync: await (window as any).__getApiRequestCount('POST /api/admin/provider-billing/sync'),
  }))).toEqual({
    overview: beforeSync.overview + 1,
    users: beforeSync.users,
    tasks: beforeSync.tasks,
    sync: beforeSync.sync + 1,
  });
});

test('视频成本首次汇总失败显示持久错误，不把失败伪装成零值', async ({ page }) => {
  await page.evaluate(() => (window as any).__setAdminRefreshScenario('fail-next-api-cost-overview'));
  await page.goto('/admin/api-usage?range=month&month=2026-06');

  await expect(page.getByText('成本汇总加载失败', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('未将失败结果显示为 0。', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('0 积分', { exact: true })).toHaveCount(0);
  await expect(page.getByText('本期最终实扣积分', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '重新加载' }).first().click();
  await expect(page.getByText('80 积分', { exact: true })).toBeVisible();
});

test('视频成本同周期更新失败保留旧数据，新周期失败不冒充并可恢复', async ({ page }) => {
  await page.goto('/admin/api-usage?range=month&month=2026-06');
  await expect(page.getByText('80 积分', { exact: true })).toBeVisible();

  await page.evaluate(() => (window as any).__setAdminRefreshScenario('fail-next-api-cost-overview'));
  await page.getByRole('button', { name: '刷新数据' }).click();
  await expect(page.getByText(/更新失败，仍显示上次数据/).first()).toBeVisible();
  await expect(page.getByText('80 积分', { exact: true })).toBeVisible();

  await page.evaluate(() => (window as any).__setAdminRefreshScenario('fail-next-api-cost-overview'));
  const monthTrigger = page.getByRole('combobox', { name: '月份', exact: true });
  await monthTrigger.click();
  await page.locator('[data-date-picker-panel="month"]').getByRole('gridcell', { name: '2026年05月', exact: true }).click();

  await expect(page.getByText('成本汇总加载失败', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('80 积分', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/数据截点：等待当前周期数据/)).toBeVisible();
  await page.getByRole('button', { name: '恢复上次成功周期' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('month')).toBe('2026-06');
  await expect(page.getByText('80 积分', { exact: true })).toBeVisible();
});

test('视频成本任务局部失败不清空汇总和用户，重试只恢复任务区块', async ({ page }) => {
  await page.goto('/admin/api-usage?range=month&month=2026-06');
  await expect(page.getByText('80 积分', { exact: true })).toBeVisible();
  await expect(page.getByText('管理员', { exact: true }).first()).toBeVisible();

  const before = await page.evaluate(async () => ({
    overview: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/overview'),
    users: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/users'),
    tasks: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/tasks'),
  }));
  await page.evaluate(() => (window as any).__setAdminRefreshScenario('fail-next-api-cost-tasks'));
  await page.getByPlaceholder('搜索用户、邮箱或任务 ID...').fill('admin@lindyson.ai');

  await expect(page.getByText('任务成本明细加载失败', { exact: true })).toBeVisible();
  await expect(page.getByText('80 积分', { exact: true })).toBeVisible();
  await expect(page.getByText('管理员', { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(async () => ({
    overview: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/overview'),
    users: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/users'),
    tasks: await (window as any).__getApiRequestCount('GET /api/admin/api-usage/tasks'),
  }))).toEqual({ overview: before.overview, users: before.users, tasks: before.tasks + 1 });

  const taskSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: '任务成本明细', exact: true }),
  });
  await taskSection.getByRole('button', { name: '重新加载' }).click();
  await expect(taskSection.getByText('任务成本明细加载失败', { exact: true })).toHaveCount(0);
  await expect(taskSection.getByRole('row')).toHaveCount(2);
});

test('视频成本路由刷新任一明细失败时保留旧数据且不提示刷新成功', async ({ page }) => {
  await page.goto('/admin/api-usage?range=month&month=2026-06');
  await expect(page.getByText('80 积分', { exact: true })).toBeVisible();
  await expect(page.getByText('管理员', { exact: true }).first()).toBeVisible();

  await page.evaluate(() => (window as any).__setAdminRefreshScenario('fail-next-api-cost-users'));
  await page.getByRole('button', { name: '刷新数据' }).click();

  await expect(page.getByText('成本看盘刷新不完整：用户成本加载失败', { exact: true })).toBeVisible();
  await expect(page.getByText('后台数据已刷新', { exact: true })).toHaveCount(0);
  await expect(page.getByText('80 积分', { exact: true })).toBeVisible();
  await expect(page.getByText('管理员', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/更新失败，仍显示上次数据/).first()).toBeVisible();
});

test('高级对账离页会静默取消主请求且不显示错误 Toast', async ({ page }) => {
  await page.evaluate(() => (window as any).__setAdminRefreshScenario('delay-next-api-cost-audit'));
  const auditRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/admin/api-usage');
  await page.goto('/admin/api-usage/audit?range=month&month=2026-06');
  await auditRequest;
  await page.getByRole('button', { name: '返回成本看盘' }).click();

  await expect(page).toHaveURL(/\/admin\/api-usage\?costType=video&range=month&month=2026-06/);
  await page.waitForTimeout(700);
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
});

test('高级成本对账筛选统一使用暗色自绘菜单并联动 attempt 查询', async ({ page }) => {
  await page.goto('/admin/api-usage/audit?range=month&month=2026-06');
  await expect(page.getByRole('heading', { name: '高级成本对账' })).toBeVisible();
  await expect(page.locator('select, input[type="date"], input[type="month"]')).toHaveCount(0);

  const filterNames = ['模型', '计价档', '输入档', '任务', '用量证据', '计价', '可信度'];
  for (const name of filterNames) {
    const trigger = page.getByRole('combobox', { name, exact: true });
    await expect(trigger).toHaveCount(1);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();

    const listbox = page.getByRole('listbox', { name, exact: true });
    await expect(listbox).toBeVisible();
    await expect(listbox).toHaveCSS('background-color', 'rgba(11, 12, 18, 0.98)');
    const selected = listbox.locator('[role="option"][aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveClass(/text-purple-300/);
    await expect(selected).toHaveClass(/bg-purple-600\/20/);
    await expect(selected.locator('svg')).toHaveCount(1);

    await trigger.press('Escape');
    await expect(listbox).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }

  const modelTrigger = page.getByRole('combobox', { name: '模型', exact: true });
  await modelTrigger.click();
  const modelRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/admin/api-usage'
      && url.searchParams.get('model') === 'Seedance 2.0 Fast';
  });
  await page.getByRole('listbox', { name: '模型', exact: true }).getByRole('option', { name: 'Fast', exact: true }).click();
  await modelRequest;
  await expect.poll(() => new URL(page.url()).searchParams.get('model')).toBe('Seedance 2.0 Fast');

  const resolutionTrigger = page.getByRole('combobox', { name: '计价档', exact: true });
  await resolutionTrigger.click();
  const taskFilterRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/admin/api-usage/attempts'
      && url.searchParams.get('pricingResolution') === '1080p';
  });
  await page.getByRole('listbox', { name: '计价档', exact: true }).getByRole('option', { name: '1080P', exact: true }).click();
  await taskFilterRequest;

  for (const filter of [
    { label: '输入档', option: '含视频', parameter: 'inputClass', value: 'with-video' },
    { label: '任务', option: '失败', parameter: 'status', value: 'failed' },
    { label: '用量证据', option: '账单匹配推断', parameter: 'usageEvidenceOrigin', value: 'official-bill-inferred' },
    { label: '计价', option: '未匹配价格规则', parameter: 'pricingRuleStatus', value: 'rule-missing' },
    { label: '可信度', option: '高', parameter: 'attributionConfidence', value: 'high' },
  ]) {
    const trigger = page.getByRole('combobox', { name: filter.label, exact: true });
    await trigger.click();
    const filteredRequest = page.waitForRequest(request => {
      const url = new URL(request.url());
      return url.pathname === '/api/admin/api-usage/attempts'
        && url.searchParams.get(filter.parameter) === filter.value;
    });
    await page.getByRole('listbox', { name: filter.label, exact: true }).getByRole('option', { name: filter.option, exact: true }).click();
    await filteredRequest;
  }
});

test('成本看盘可还原视频自选周期且与高级对账往返保留筛选', async ({ page }) => {
  await page.goto('/admin/api-usage?range=custom&from=2026-06-10&to=2026-06-20&model=Seedance%202.0%20Fast');
  await expect(page.getByRole('heading', { name: '成本看盘' })).toBeVisible();
  await expect(page.getByRole('button', { name: '自选周期', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: '开始日期', exact: true })).toContainText('2026-06-10');
  await expect(page.getByRole('combobox', { name: '结束日期', exact: true })).toContainText('2026-06-20');
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toContainText('Fast');

  const customRequest = page.waitForRequest(request => {
    const requestUrl = new URL(request.url());
    return requestUrl.pathname === '/api/admin/api-usage/overview'
      && requestUrl.searchParams.get('range') === 'custom'
      && requestUrl.searchParams.get('from') === '2026-06-11'
      && requestUrl.searchParams.get('to') === '2026-06-20';
  });
  await page.getByRole('combobox', { name: '开始日期', exact: true }).click();
  await page.locator('[data-date-picker-panel="date"]').getByRole('gridcell', { name: '2026-06-11', exact: true }).click();
  await customRequest;
  await expect.poll(() => {
    const current = new URL(page.url());
    return `${current.searchParams.get('range')}:${current.searchParams.get('from')}:${current.searchParams.get('to')}`;
  }).toBe('custom:2026-06-11:2026-06-20');

  await page.getByRole('button', { name: '高级对账' }).click();
  await expect(page).toHaveURL(/\/admin\/api-usage\/audit\?costType=video&range=custom&from=2026-06-11&to=2026-06-20&model=Seedance(?:%20|\+)2\.0(?:%20|\+)Fast$/);
  await expect(page.getByRole('heading', { name: '高级成本对账' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '三本账摘要' })).toBeVisible();
  await expect(page.getByText('原始本地', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('推断调整', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('未解释残差', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: '返回成本看盘' }).click();
  await expect(page).toHaveURL(/\/admin\/api-usage\?costType=video&range=custom&from=2026-06-11&to=2026-06-20&model=Seedance(?:%20|\+)2\.0(?:%20|\+)Fast$/);
  await expect(page.getByRole('heading', { name: '成本看盘' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '开始日期', exact: true })).toContainText('2026-06-11');
});

test('视频成本月份与高级对账日期使用暗色自绘网格并支持键盘操作', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/admin/api-usage?range=month&month=2026-06');
  await expect(page.getByRole('heading', { name: '成本看盘' })).toBeVisible();

  const monthTrigger = page.getByRole('combobox', { name: '月份', exact: true });
  await expect(monthTrigger).toContainText('2026年06月');
  await expect(monthTrigger).toHaveAttribute('aria-haspopup', 'grid');
  await monthTrigger.click();
  const monthDialog = page.locator('[data-date-picker-panel="month"]');
  await expect(monthDialog).toBeVisible();
  await expect(monthDialog).toHaveCSS('background-color', 'rgba(11, 12, 18, 0.98)');
  const monthGrid = monthDialog.getByRole('grid', { name: '选择月份', exact: true });
  await expect(monthGrid.getByRole('row')).toHaveCount(4);
  await expect(monthGrid.getByRole('gridcell')).toHaveCount(12);
  await expect(monthGrid.getByRole('gridcell', { name: '2026年12月', exact: true })).toBeVisible();
  await expect.poll(() => monthDialog.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  const monthBox = await monthDialog.boundingBox();
  if (!monthBox) throw new Error('月份选择面板未完成布局');
  expect(monthBox.x).toBeGreaterThanOrEqual(8);
  expect(monthBox.y).toBeGreaterThanOrEqual(8);
  expect(monthBox.x + monthBox.width).toBeLessThanOrEqual(382);
  expect(monthBox.y + monthBox.height).toBeLessThanOrEqual(752);

  const monthRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/admin/api-usage/overview'
      && url.searchParams.get('range') === 'month'
      && url.searchParams.get('month') === '2026-05';
  });
  await monthDialog.getByRole('gridcell', { name: '2026年05月', exact: true }).click();
  await monthRequest;
  await expect.poll(() => new URL(page.url()).searchParams.get('month')).toBe('2026-05');

  const expectActiveMonth = async (key: string, expectedMonth: string) => {
    await monthTrigger.press(key);
    await expect(monthTrigger).toHaveAttribute('aria-activedescendant', new RegExp(`cell-${expectedMonth}$`));
  };
  await monthTrigger.press('Enter');
  await expect(monthDialog).toBeVisible();
  await expectActiveMonth('PageUp', '2025-05');
  await expectActiveMonth('ArrowRight', '2025-06');
  await expectActiveMonth('ArrowDown', '2025-09');
  await expectActiveMonth('Home', '2025-01');
  await expectActiveMonth('End', '2025-12');
  await expectActiveMonth('PageUp', '2024-12');
  await expectActiveMonth('PageDown', '2025-12');
  await expectActiveMonth('ArrowLeft', '2025-11');
  await expectActiveMonth('ArrowUp', '2025-08');
  await monthTrigger.press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('month')).toBe('2025-08');

  await monthTrigger.press('Space');
  await expect(monthDialog).toBeVisible();
  await monthTrigger.press('Escape');
  await expect(monthDialog).toHaveCount(0);
  await expect(monthTrigger).toBeFocused();

  await monthTrigger.press('Enter');
  await monthTrigger.press('Tab');
  await expect(monthDialog).toHaveCount(0);
  await expect(monthTrigger).toHaveAttribute('aria-expanded', 'false');

  const beijingToday = await page.evaluate(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }));
  const [currentYear,currentMonth] = beijingToday.slice(0, 7).split('-').map(Number);
  if (!currentYear || !currentMonth) throw new Error(`无法解析北京时间：${beijingToday}`);
  await page.goto(`/admin/api-usage?range=month&month=${beijingToday.slice(0, 7)}`);
  const currentMonthTrigger = page.getByRole('combobox', { name: '月份', exact: true });
  await currentMonthTrigger.click();
  const currentMonthDialog = page.locator('[data-date-picker-panel="month"]');
  if (currentMonth < 12) {
    const futureMonth = `${currentYear}年${String(currentMonth + 1).padStart(2, '0')}月`;
    await expect(currentMonthDialog.getByRole('gridcell', { name: futureMonth, exact: true })).toHaveAttribute('aria-disabled', 'true');
  } else {
    await expect(currentMonthDialog.getByRole('button', { name: '下一年', exact: true })).toBeDisabled();
  }
  await currentMonthTrigger.press('Escape');

  await page.goto('/admin/api-usage/audit?range=date&date=2026-06-15');
  await expect(page.getByRole('heading', { name: '高级成本对账' })).toBeVisible();
  const dateTrigger = page.getByRole('combobox', { name: '日期', exact: true });
  await expect(dateTrigger).toContainText('2026-06-15');
  await expect(dateTrigger).toHaveAttribute('aria-haspopup', 'grid');
  await dateTrigger.click();
  const dateDialog = page.locator('[data-date-picker-panel="date"]');
  await expect(dateDialog).toBeVisible();
  await expect(dateDialog).toHaveCSS('background-color', 'rgba(11, 12, 18, 0.98)');
  const dateGrid = dateDialog.getByRole('grid', { name: '选择日期', exact: true });
  await expect(dateGrid.getByRole('row')).toHaveCount(6);
  await expect(dateGrid.getByRole('gridcell')).toHaveCount(42);
  const dateBox = await dateDialog.boundingBox();
  if (!dateBox) throw new Error('日期选择面板未完成布局');
  expect(dateBox.x).toBeGreaterThanOrEqual(8);
  expect(dateBox.y).toBeGreaterThanOrEqual(8);
  expect(dateBox.x + dateBox.width).toBeLessThanOrEqual(382);
  expect(dateBox.y + dateBox.height).toBeLessThanOrEqual(752);

  const dateRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/admin/api-usage'
      && url.searchParams.get('range') === 'date'
      && url.searchParams.get('date') === '2026-06-14';
  });
  await dateDialog.getByRole('gridcell', { name: '2026-06-14', exact: true }).click();
  await dateRequest;
  await expect.poll(() => new URL(page.url()).searchParams.get('date')).toBe('2026-06-14');

  const expectActiveDate = async (key: string, expectedDate: string) => {
    await dateTrigger.press(key);
    await expect(dateTrigger).toHaveAttribute('aria-activedescendant', new RegExp(`cell-${expectedDate}$`));
  };
  await dateTrigger.press('Enter');
  await expect(dateDialog).toBeVisible();
  await expectActiveDate('ArrowLeft', '2026-06-13');
  await expectActiveDate('ArrowRight', '2026-06-14');
  await expectActiveDate('ArrowDown', '2026-06-21');
  await expectActiveDate('ArrowUp', '2026-06-14');
  await expectActiveDate('Home', '2026-06-08');
  await expectActiveDate('End', '2026-06-14');
  await expectActiveDate('PageUp', '2026-05-14');
  await expectActiveDate('PageDown', '2026-06-14');
  await expectActiveDate('Shift+PageUp', '2025-06-14');
  await expectActiveDate('Shift+PageDown', '2026-06-14');
  await expectActiveDate('ArrowLeft', '2026-06-13');
  await dateTrigger.press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('date')).toBe('2026-06-13');

  await dateTrigger.press('Space');
  await dateTrigger.press('Escape');
  await expect(dateDialog).toHaveCount(0);
  await expect(dateTrigger).toBeFocused();

  await dateTrigger.press('Enter');
  await page.getByRole('heading', { name: '高级成本对账' }).click();
  await expect(dateDialog).toHaveCount(0);
  await expect(dateTrigger).toHaveAttribute('aria-expanded', 'false');

  const nextBeijingDay = new Date(`${beijingToday}T00:00:00.000Z`);
  nextBeijingDay.setUTCDate(nextBeijingDay.getUTCDate() + 1);
  const nextDay = nextBeijingDay.toISOString().slice(0, 10);
  await page.goto(`/admin/api-usage/audit?range=date&date=${beijingToday}`);
  const currentDateTrigger = page.getByRole('combobox', { name: '日期', exact: true });
  await currentDateTrigger.click();
  await expect(page.locator('[data-date-picker-panel="date"]').getByRole('gridcell', { name: nextDay, exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect.poll(() => runtimeErrors).toEqual([]);
});

test('后台筛选菜单在窄屏内完整展示长选项并覆盖其他后台页面', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/admin/api-usage/audit?range=month&month=2026-06');
  await expect(page.getByRole('heading', { name: '高级成本对账' })).toBeVisible();

  const confidenceTrigger = page.getByRole('combobox', { name: '可信度', exact: true });
  await confidenceTrigger.scrollIntoViewIfNeeded();
  await confidenceTrigger.click();
  const confidenceListbox = page.getByRole('listbox', { name: '可信度', exact: true });
  await expect(confidenceListbox.getByRole('option')).toHaveCount(6);
  await expect(confidenceListbox.getByRole('option', { name: '未归因', exact: true })).toBeVisible();
  const confidenceBox = await confidenceListbox.boundingBox();
  if (!confidenceBox) throw new Error('可信度菜单未完成布局');
  expect(confidenceBox.x).toBeGreaterThanOrEqual(8);
  expect(confidenceBox.y).toBeGreaterThanOrEqual(8);
  expect(confidenceBox.x + confidenceBox.width).toBeLessThanOrEqual(382);
  expect(confidenceBox.y + confidenceBox.height).toBeLessThanOrEqual(752);
  await confidenceTrigger.press('Escape');

  const pricingTrigger = page.getByRole('combobox', { name: '计价', exact: true });
  await pricingTrigger.click();
  const pricingListbox = page.getByRole('listbox', { name: '计价', exact: true });
  const pricingBox = await pricingListbox.boundingBox();
  if (!pricingBox) throw new Error('计价菜单未完成布局');
  expect(pricingBox.width).toBeGreaterThanOrEqual(160);
  const longOptionText = pricingListbox.getByRole('option', { name: '未匹配价格规则', exact: true }).locator('span').first();
  await expect(longOptionText).toBeVisible();
  await expect.poll(() => longOptionText.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await pricingTrigger.press('Escape');

  for (const surface of [
    { path: '/admin/orders', heading: '订单管理', option: '待支付' },
    { path: '/admin/users', heading: '用户管理', option: '已冻结' },
    { path: '/admin/jobs', heading: '生成任务监控', option: '生成中 / 待核验' },
  ]) {
    await page.goto(surface.path);
    await expect(page.getByRole('heading', { name: surface.heading, exact: true })).toBeVisible();
    await expect(page.locator('select')).toHaveCount(0);
    const statusTrigger = page.getByRole('combobox', { name: '状态', exact: true });
    await statusTrigger.click();
    const statusListbox = page.getByRole('listbox', { name: '状态', exact: true });
    await expect(statusListbox).toHaveCSS('background-color', 'rgba(11, 12, 18, 0.98)');
    await statusListbox.getByRole('option', { name: surface.option, exact: true }).click();
    await expect(statusTrigger).toContainText(surface.option);
  }
});

test('统一对话框限制焦点、支持 Esc 并恢复触发按钮焦点', async ({ page }) => {
  await page.goto('/admin/plans');
  await expect(page.getByRole('heading', { name: '订阅套餐管理' })).toBeVisible();

  const trigger = page.getByRole('button', { name: '新增套餐' });
  await trigger.focus();
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: '新增套餐' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);

  await dialog.getByRole('heading', { name: '新增套餐' }).click();
  await dialog.evaluate(element => (element as HTMLElement).focus());
  await expect(dialog).toBeFocused();
  await expect(dialog).not.toHaveClass(/focus-visible:ring-/);

  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('跨标签登录为其他账号后旧标签立即隔离并刷新私有数据', async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByText('管理员', { exact: true })).toBeVisible();
  const meRequestsBefore = await page.evaluate(() => (window as any).__getApiRequestCount('GET /api/auth/me'));

  const secondPage = await page.context().newPage();
  await installApiMocks(secondPage);
  await page.evaluate(() => (window as any).__setMockCurrentUser({
    id: 'user-member@lindyson.ai',
    userName: '普通用户',
    email: 'member@lindyson.ai',
    role: 'user',
    planCode: 'free',
    planName: '免费版',
    billingCycle: 'monthly',
    mainCredits: 100,
    addonCredits: 0,
    credits: 100,
    totalCredits: 100,
    planResetAt: '2026-07-30',
    planExpiresAt: '2026-07-30',
  }));

  await secondPage.goto('/login');
  await secondPage.getByLabel('邮箱', { exact: true }).fill('member@lindyson.ai');
  await secondPage.getByLabel('密码', { exact: true }).fill('mock123');
  await secondPage.getByRole('button', { name: '登录' }).click();
  await expect(secondPage).toHaveURL(/\/app$/);

  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/auth/me'))).toBeGreaterThan(meRequestsBefore);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('普通用户', { exact: true })).toBeVisible();
  await expect(page.getByText('管理员', { exact: true })).toHaveCount(0);
  await secondPage.close();
});

test('用户窗口重新聚焦时刷新完整账户并清除已取消套餐日期', async ({ page }) => {
  await page.goto('/app/account-center');
  await expect(page.getByText('当前订阅', { exact: true })).toBeVisible();
  const otherPage = await page.context().newPage();
  await otherPage.goto('about:blank');

  await page.evaluate(() => (window as any).__setMockCurrentUser({
    id: 'user-admin@lindyson.ai',
    userName: '管理员',
    email: 'admin@lindyson.ai',
    role: 'admin',
    planCode: 'focus-pro',
    planName: '聚焦专业版',
    billingCycle: 'yearly',
    mainCredits: 4321,
    addonCredits: 25,
    credits: 4346,
    totalCredits: 4346,
    planResetAt: '2026-08-30',
    planExpiresAt: '2027-07-30',
  }));
  await otherPage.bringToFront();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('聚焦专业版', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('2026-08-30', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('4,346 / 4,346', { exact: true })).toBeVisible();

  const meRequestsBeforeFree = await page.evaluate(
    () => (window as any).__getApiRequestCount('GET /api/auth/me'),
  );
  await page.evaluate(() => (window as any).__setMockCurrentUser({
    id: 'user-admin@lindyson.ai',
    userName: '管理员',
    email: 'admin@lindyson.ai',
    role: 'admin',
    planCode: null,
    planName: null,
    billingCycle: 'monthly',
    mainCredits: 0,
    addonCredits: 25,
    credits: 25,
    totalCredits: 25,
    planResetAt: null,
    planExpiresAt: null,
  }));
  await otherPage.bringToFront();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  await expect.poll(() => page.evaluate(
    () => (window as any).__getApiRequestCount('GET /api/auth/me'),
  )).toBeGreaterThan(meRequestsBeforeFree);
  await expect(page.getByText('免费版', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('无订阅', { exact: true })).toBeVisible();
  await expect(page.getByText('25 / 25', { exact: true })).toBeVisible();
  await expect(page.getByText('2026-08-30', { exact: true })).toHaveCount(0);
  await expect(page.getByText('2027-07-30', { exact: true })).toHaveCount(0);
  await otherPage.close();
});

test('管理后台使用独立实色表面、静态环境光和暖白标题', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '管理员仪表盘' })).toBeVisible();

  const adminShell = page.locator('.admin-shell');
  await expect(adminShell).toHaveCount(1);
  await expect(page.locator('[data-ui="admin-layout"]')).toBeVisible();
  await expect(page.locator('[data-ui="admin-ambient"]')).toHaveCount(1);
  await expect(page.locator('[data-ui="admin-ambient"] .animate-pulse')).toHaveCount(0);

  const title = page.locator('[data-ui="admin-page-header"] h1');
  const titleSurface = await title.evaluate(element => {
    const shell = element.closest('.admin-shell');
    if (!shell) throw new Error('管理后台标题未处于 admin-shell 中');
    const expectedText = document.createElement('span');
    expectedText.style.color = 'var(--admin-text-primary)';
    shell.append(expectedText);
    const expectedColor = getComputedStyle(expectedText).color;
    expectedText.remove();
    const style = getComputedStyle(element);
    return {
      backgroundImage: style.backgroundImage,
      backgroundClip: style.backgroundClip,
      color: style.color,
      expectedColor,
      textFillColor: style.webkitTextFillColor,
    };
  });
  expect(titleSurface.backgroundImage).toBe('none');
  expect(titleSurface.backgroundClip).not.toBe('text');
  expect(titleSurface.color).toBe(titleSurface.expectedColor);
  expect(titleSurface.textFillColor).not.toBe('rgba(0, 0, 0, 0)');

  const ordinaryCard = page.locator('[data-ui="card"]')
    .filter({ hasNot: page.locator('[data-admin-ui="modal"]') })
    .first();
  await expect(ordinaryCard).toBeVisible();
  const cardSurface = await ordinaryCard.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      variant: element.getAttribute('data-variant'),
      backdropFilter: style.backdropFilter,
    };
  });
  expect(['default', 'raised', 'interactive', 'media']).toContain(cardSurface.variant);
  expect(cardSurface.backdropFilter).toBe('none');
});

test('管理后台 PageShell 在宽屏限宽并避免全局横向溢出', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '管理员仪表盘' })).toBeVisible();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1200 },
  ]) {
    await page.setViewportSize(viewport);
    const geometry = await page.locator('[data-ui="admin-page"][data-width="dashboard"]').evaluate(element => {
      const main = element.closest('[data-ui="admin-main"]');
      const content = element.firstElementChild;
      if (!(main instanceof HTMLElement) || !(content instanceof HTMLElement)) {
        throw new Error('管理后台 PageShell 结构不完整');
      }
      const mainRect = main.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      return {
        computedMaxWidth: getComputedStyle(content).maxWidth,
        contentWidth: contentRect.width,
        leftInset: contentRect.left - mainRect.left,
        rightInset: mainRect.right - contentRect.right,
        documentFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
        bodyFits: document.body.scrollWidth <= window.innerWidth + 1,
      };
    });

    expect(geometry.computedMaxWidth).toBe('1600px');
    expect(geometry.contentWidth).toBeLessThanOrEqual(1601);
    expect(Math.abs(geometry.leftInset - geometry.rightInset)).toBeLessThanOrEqual(2);
    expect(geometry.documentFits).toBe(true);
    expect(geometry.bodyFits).toBe(true);
  }
});

test('后台宽表只在表格内横向滚动且分页保持在滚动容器外', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareMultiPageOrders(page);
  await page.goto('/admin/orders');
  await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible();

  const table = page.locator('[data-admin-ui="table"]').first();
  const scrollRegion = table.locator('[data-ui="admin-table-scroll"]');
  const pagination = table.locator('[data-ui="admin-table-pagination"]');
  const pager = pagination.getByRole('navigation', { name: '订单分页导航' });
  await expect(scrollRegion).toBeVisible();
  await expect(pagination).toBeVisible();
  await expect(pager).toBeVisible();
  await expect(pager.getByRole('status', { name: /第 1 页，共 \d+ 页/ })).toBeVisible();
  for (const label of ['首页', '上一页', '下一页', '尾页']) {
    const button = pager.getByRole('button', { name: label, exact: true });
    await expect(button).toHaveText('');
    const size = await button.boundingBox();
    expect(size?.width).toBe(32);
    expect(size?.height).toBe(32);
  }
  await pager.getByRole('button', { name: '下一页' }).hover();
  await expect(pager.getByText('下一页', { exact: true })).toBeVisible();
  await pager.getByRole('button', { name: '尾页' }).focus();
  await expect(pager.getByText('尾页', { exact: true })).toBeVisible();
  const dock = pager.locator('[role="group"]');
  const dockBox = await dock.boundingBox();
  expect(dockBox?.width).toBeLessThanOrEqual(340);
  expect(dockBox?.height).toBe(32);

  const tableState = await table.evaluate(element => {
    const scroll = element.querySelector<HTMLElement>('[data-ui="admin-table-scroll"]');
    const pager = element.querySelector<HTMLElement>('[data-ui="admin-table-pagination"]');
    if (!scroll || !pager) throw new Error('后台表格滚动区或分页区缺失');
    return {
      overflowX: getComputedStyle(scroll).overflowX,
      hasLocalOverflow: scroll.scrollWidth > scroll.clientWidth,
      pagerInsideScroll: scroll.contains(pager),
      pagerIsSibling: scroll.nextElementSibling === pager,
      pagerLeft: pager.getBoundingClientRect().left,
    };
  });
  expect(tableState.overflowX).toBe('auto');
  expect(tableState.hasLocalOverflow).toBe(true);
  expect(tableState.pagerInsideScroll).toBe(false);
  expect(tableState.pagerIsSibling).toBe(true);

  await scrollRegion.evaluate(element => {
    element.scrollLeft = element.scrollWidth;
  });
  const pagerLeftAfterScroll = await pagination.evaluate(element => element.getBoundingClientRect().left);
  expect(Math.abs(pagerLeftAfterScroll - tableState.pagerLeft)).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect.poll(() => pagination.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await expect.poll(() => page.evaluate(() => ({
    documentFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
    bodyFits: document.body.scrollWidth <= window.innerWidth + 1,
  }))).toEqual({ documentFits: true, bodyFits: true });
});

test('390px 后台抽屉限制焦点，支持 Escape 并在关闭后回到菜单按钮', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/orders');
  await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible();

  const menuButton = page.getByRole('button', { name: '打开后台导航' });
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await menuButton.click();

  const drawer = page.getByRole('dialog', { name: '后台导航' });
  await expect(drawer).toBeVisible();
  await expect(page.getByRole('button', { name: '订单管理', exact: true })).toBeFocused();

  const drawerButtons = drawer.locator('button:not([disabled])');
  await drawerButtons.last().focus();
  await page.keyboard.press('Tab');
  await expect(drawerButtons.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(drawerButtons.last()).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(menuButton).toBeFocused();
  await expect(page.getByRole('dialog', { name: '后台导航' })).toHaveCount(0);

  await menuButton.click();
  await page.getByRole('button', { name: '用户管理' }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('390px 设计规范可切换后台章节并在自身区域滚动', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/design-system');
  await expect(page.getByRole('heading', { name: '设计规范', exact: true })).toBeVisible();

  const designSystem = page.locator('[data-ui="design-system"]');
  const chapterNav = page.getByRole('navigation', { name: '设计规范章节' });
  const content = page.locator('[data-ui="design-system-content"]');
  await expect(designSystem).toBeVisible();
  await expect(chapterNav).toBeVisible();

  const adminChapter = chapterNav.getByRole('button', { name: '管理后台', exact: true });
  await adminChapter.click();
  await expect(adminChapter).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: '管理后台视觉与业务规范', exact: true })).toBeVisible();
  await expect(page.getByText('admin-shell 视觉方向', { exact: true })).toBeVisible();

  const scrollingState = await page.evaluate(() => {
    const candidates = [
      document.querySelector<HTMLElement>('[data-ui="design-system-content"]'),
      document.querySelector<HTMLElement>('[data-ui="admin-main"]'),
    ].filter((element): element is HTMLElement => Boolean(element));
    const owner = candidates.find(element => {
      const overflowY = getComputedStyle(element).overflowY;
      return ['auto', 'scroll'].includes(overflowY) && element.scrollHeight > element.clientHeight + 1;
    });
    if (!owner) return { found: false, moved: false };
    owner.scrollTop = owner.scrollHeight;
    return { found: true, moved: owner.scrollTop > 0 };
  });
  expect(scrollingState).toEqual({ found: true, moved: true });
  await expect.poll(() => page.evaluate(() => ({
    documentFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
    bodyFits: document.body.scrollWidth <= window.innerWidth + 1,
  }))).toEqual({ documentFits: true, bodyFits: true });
});

test('390px 用户端导航抽屉限制焦点并在关闭后回到菜单按钮', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');

  const menuButton = page.getByRole('button', { name: '打开导航菜单' });
  const sidebar = page.locator('#app-sidebar');
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar).toHaveAttribute('aria-hidden', 'true');

  await menuButton.click();
  const drawer = page.getByRole('dialog', { name: '工作台导航' });
  await expect(drawer).toBeVisible();
  await expect(page.getByRole('button', { name: '仪表盘', exact: true })).toBeFocused();

  const drawerButtons = drawer.getByRole('button');
  await drawerButtons.last().focus();
  await page.keyboard.press('Tab');
  await expect(drawerButtons.first()).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(menuButton).toBeFocused();
  await expect(sidebar).toHaveAttribute('aria-hidden', 'true');

  await menuButton.click();
  const navigationBackdrop = page.getByRole('button', { name: '关闭导航菜单' });
  const backdropBox = await navigationBackdrop.boundingBox();
  if (!backdropBox) throw new Error('移动导航遮罩未完成布局');
  await navigationBackdrop.click({
    position: { x: backdropBox.width - 4, y: Math.min(backdropBox.height / 2, 420) },
  });
  await expect(menuButton).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('系统减少动态效果偏好会停用装饰性动画', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const animationDuration = await page.locator('.animate-pulse').first().evaluate(element => (
    Number.parseFloat(getComputedStyle(element).animationDuration) || 0
  ));
  expect(animationDuration).toBeLessThanOrEqual(0.001);
});

test('普通会员直接访问管理后台只显示无权限页', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('邮箱', { exact: true }).fill('member@lindyson.ai');
  await page.getByLabel('密码', { exact: true }).fill('mock123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();

  const adminRequestsBefore = await page.evaluate(() => (window as any).__getAdminApiRequestCount());
  await page.goto('/admin');

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText('无权限访问')).toBeVisible();
  await expect(page.getByRole('heading', { name: '仅管理员可访问管理后台' })).toBeVisible();
  await expect(page.getByText('当前账号不是管理员，不能进入运营管理后台。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '管理员仪表盘' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '用户管理' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__getAdminApiRequestCount())).toBe(adminRequestsBefore);

  await page.getByRole('button', { name: '返回工作台' }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test('套餐管理页展示完整价格排序且编辑后保持同价顺序', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [
    addonPlan({ id: mockUuid('plan-addon-2000'), name: '2000 积分加购包', code: 'addon-2000', monthlyPrice: 36900 }),
    paidPlan({ id: mockUuid('plan-enterprise-max'), name: '企业旗舰版 Max', code: 'max.enterprise', monthlyPrice: 1099900 }),
    paidPlan({ id: mockUuid('plan-pro-a'), name: '运营专业版 A', code: 'pro-a', monthlyPrice: 59900 }),
    paidPlan({ id: mockUuid('plan-basic'), name: '运营基础版 Basic', code: 'basic', monthlyPrice: 19900 }),
    paidPlan({ id: mockUuid('plan-enterprise-pro'), name: '企业专业版 Pro', code: 'pro.ent', monthlyPrice: 499900 }),
    addonPlan({ id: mockUuid('plan-addon-500'), name: '500 积分加购包', code: 'addon-500', monthlyPrice: 9900 }),
    paidPlan({ id: mockUuid('plan-free'), name: '免费版', code: 'free', monthlyPrice: 0, yearlyPrice: 0 }),
    paidPlan({ id: mockUuid('plan-max'), name: '运营旗舰版 Max', code: 'max', monthlyPrice: 129900 }),
    paidPlan({ id: mockUuid('plan-pro-b'), name: '运营专业版 B', code: 'pro-b', monthlyPrice: 59900 }),
    paidPlan({ id: mockUuid('plan-enterprise-basic'), name: '企业基础版 Basic', code: 'basic.ent', monthlyPrice: 199900 }),
  ]);
  await page.goto('/admin/plans');

  const expectedNames = [
    '免费版',
    '运营基础版 Basic',
    '运营专业版 A',
    '运营专业版 B',
    '运营旗舰版 Max',
    '企业基础版 Basic',
    '企业专业版 Pro',
    '企业旗舰版 Max',
    '500 积分加购包',
    '2000 积分加购包',
  ];
  const planRows = page.getByRole('row').filter({ has: page.getByRole('button', { name: /查看套餐详情/ }) });
  await expect(planRows).toHaveCount(expectedNames.length);
  await expect(page.getByText('本页 10 条 · 共 10 条', { exact: true })).toBeVisible();
  await expect(page.getByLabel('分页导航')).toHaveCount(0);

  const visiblePlanNames = async () => (await planRows.allTextContents()).map(text => (
    expectedNames.find(name => text.includes(name))
  ));
  expect(await visiblePlanNames()).toEqual(expectedNames);

  const editedRow = planRows.filter({ hasText: '运营专业版 B' });
  await editedRow.getByRole('button', { name: '编辑', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '编辑套餐', exact: true });
  await fillAdminInput(modal, '套餐名称', '运营专业版 B（已编辑）');
  await modal.getByRole('button', { name: '保存套餐', exact: true }).click();
  await expect(page.getByText('套餐信息已保存', { exact: true })).toBeVisible();

  const updatedNames = expectedNames.map(name => name === '运营专业版 B' ? '运营专业版 B（已编辑）' : name);
  const updatedRowTexts = await planRows.allTextContents();
  expect(updatedRowTexts.map(text => updatedNames.find(name => text.includes(name)))).toEqual(updatedNames);
});

test('订阅套餐新增、编辑、下架后同步到首页和用户端订阅页', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: '订阅套餐' }).click();

  await page.getByRole('button', { name: '新增套餐' }).click();
  let modal = page.locator('.fixed.inset-0.z-50').last();
  await fillAdminInput(modal, '套餐名称', '增长版');
  await fillAdminInput(modal, '套餐代码', 'growth');
  await fillAdminInput(modal, '英文名', 'Growth');
  await fillAdminTextarea(modal, '简介', '适合快速扩张的运营团队');
  await fillAdminInput(modal, '月付价格（元）', '39.99');
  await fillAdminInput(modal, '年付总价（元）', '390');
  await fillAdminInput(modal, '周期积分', '20000');
  await fillAdminInput(modal, 'AI 生成素材保留天数', '45');
  await expect(modal.getByText('系统每天北京时间 03:00 扫描。', { exact: false })).toBeVisible();
  await fillAdminInput(modal, '存储空间', '200GB');
  await fillAdminInput(modal, 'TikTok 账号数', '10');
  await fillAdminInput(modal, 'CTA 文案', '升级增长版');
  await modal.getByRole('button', { name: '选择火箭图标' }).click();
  await modal.getByRole('radio', { name: '展示' }).click();
  await modal.getByRole('radio', { name: '启用中' }).click();
  await modal.getByRole('button', { name: '新增套餐' }).click();
  await expect(page.getByText('增长版', { exact: true })).toBeVisible();
  await expect(page.getByText('¥39.99/月 · ¥390/年')).toBeVisible();
  const adminRocketIcon = page.getByRole('row').filter({ hasText: '增长版' }).locator('[data-plan-icon-key="rocket"]');
  await expect(adminRocketIcon).toBeVisible();
  await expect(adminRocketIcon).toHaveClass(/from-purple-600/);
  await expect(adminRocketIcon).toHaveClass(/to-blue-600/);

  await page.getByRole('row').filter({ hasText: '增长版' }).getByRole('button', { name: '编辑', exact: true }).click();
  modal = page.locator('.fixed.inset-0.z-50').last();
  await expect(modal.getByLabel('AI 生成素材保留天数')).toHaveValue('45');
  await fillAdminInput(modal, '套餐名称', '增长旗舰版');
  await fillAdminInput(modal, '月付价格（元）', '49');
  await fillAdminInput(modal, '年付总价（元）', '588');
  await fillAdminInput(modal, '周期积分', '26000');
  await fillAdminInput(modal, 'AI 生成素材保留天数', '60');
  await fillAdminInput(modal, 'CTA 文案', '升级增长旗舰版');
  await modal.getByRole('button', { name: '选择宝石图标' }).click();
  await modal.getByRole('button', { name: '保存套餐' }).click();
  await expect(page.getByText('增长旗舰版', { exact: true })).toBeVisible();
  await expect(page.getByText('¥49/月 · ¥588/年')).toBeVisible();
  const adminGemIcon = page.getByRole('row').filter({ hasText: '增长旗舰版' }).locator('[data-plan-icon-key="gem"]');
  await expect(adminGemIcon).toBeVisible();
  await expect(adminGemIcon).toHaveClass(/from-purple-600/);
  await expect(adminGemIcon).toHaveClass(/to-blue-600/);

  await page.getByRole('row').filter({ hasText: '增长旗舰版' }).getByRole('button', { name: /查看套餐详情/ }).click();
  const planDetailDialog = page.getByRole('dialog', { name: '增长旗舰版' });
  await expect(planDetailDialog.getByText('AI 生成素材保留', { exact: true })).toBeVisible();
  await expect(planDetailDialog.getByText('60 天', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/');
  const landingGrowthCard = page.getByText('增长旗舰版', { exact: true }).locator('xpath=ancestor::*[@data-plan-card][1]');
  await expect(landingGrowthCard).toBeVisible();
  await expect(landingGrowthCard.locator('[data-plan-card-price]')).toContainText('¥49');
  await expect(landingGrowthCard.getByText('按月计费', { exact: true })).toBeVisible();
  await expect(landingGrowthCard.getByText('按年计费', { exact: false })).toHaveCount(0);
  const landingGemIcon = page.locator('[data-plan-icon-key="gem"]');
  await expect(landingGemIcon).toBeVisible();
  await expect(landingGemIcon).toHaveClass(/from-purple-600/);
  await expect(landingGemIcon).toHaveClass(/to-blue-600/);

  await page.goto('/app');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await expect(page.getByText('增长旗舰版', { exact: true })).toBeVisible();
  await expect(page.getByText('按年计费 ¥588/年 · 月付原价 ¥588/年 · 省 0%')).toBeVisible();
  const subscriptionGemIcon = page.locator('[data-plan-icon-key="gem"]');
  await expect(subscriptionGemIcon).toBeVisible();
  await expect(subscriptionGemIcon).toHaveClass(/from-purple-600/);
  await expect(subscriptionGemIcon).toHaveClass(/to-blue-600/);
  await page.getByRole('button', { name: '升级增长旗舰版' }).click();
  await expect(page.getByRole('heading', { name: '确认购买' })).toBeVisible();
  await expect(page.locator('[data-plan-icon-key="gem"]')).toBeVisible();

  await page.goto('/admin');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  const enabledGrowthRow = page.getByRole('row').filter({ hasText: '增长旗舰版' });
  await enabledGrowthRow.getByRole('button', { name: '下架', exact: true }).click();
  await page.getByRole('button', { name: '下架套餐' }).click();
  await expect(page.getByRole('row').filter({ hasText: '增长旗舰版' }).filter({ hasText: '已停用' })).toBeVisible();

  await page.goto('/');
  await expect(page.getByText('增长旗舰版')).toHaveCount(0);

  await page.goto('/app');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await expect(page.getByText('增长旗舰版')).toHaveCount(0);

  await page.goto('/admin');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await page.getByRole('button', { name: '新增套餐' }).click();
  modal = page.locator('.fixed.inset-0.z-50').last();
  await modal.getByRole('radio', { name: '加购包' }).click();
  await expect(modal.getByRole('button', { name: '选择星光图标' })).toHaveCount(0);
  await expect(modal.getByLabel('AI 生成素材保留天数')).toHaveCount(0);
  await fillAdminInput(modal, '套餐名称', '50000 积分加购包');
  await fillAdminInput(modal, '套餐代码', 'addon-50000');
  await fillAdminInput(modal, '英文名', '50000 Credits Pack');
  await fillAdminTextarea(modal, '简介', '一次性补充 50000 积分');
  await fillAdminInput(modal, '一次性价格（元）', '79');
  await fillAdminInput(modal, '补充积分', '50000');
  await fillAdminInput(modal, 'CTA 文案', '购买 50000 积分包');
  await modal.getByRole('radio', { name: '启用中' }).click();
  await modal.getByRole('button', { name: '新增套餐' }).click();
  await expect(page.getByText('50000 积分加购包', { exact: true })).toBeVisible();
  const adminAddonIcon = page.getByRole('row').filter({ hasText: '50000 积分加购包' }).locator('[data-plan-icon-key="coins"]');
  await expect(adminAddonIcon).toBeVisible();
  await expect(adminAddonIcon).toHaveClass(/from-orange-500/);
  await expect(adminAddonIcon).toHaveClass(/to-red-600/);

  await page.goto('/');
  await expect(page.getByText('50000 积分加购包')).toHaveCount(0);

  await page.goto('/app');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await expect(page.getByText('50000 积分加购包', { exact: true })).toBeVisible();
  await expect(page.getByText('¥79')).toBeVisible();
  const addonCardIcon = page.locator('[data-plan-icon-key="coins"]');
  await expect(addonCardIcon).toBeVisible();
  await expect(addonCardIcon).toHaveClass(/from-orange-500/);
  await expect(addonCardIcon).toHaveClass(/to-red-600/);
  await page.getByRole('button', { name: '购买 50000 积分包' }).click();
  await expect(page.getByRole('heading', { name: '确认购买' })).toBeVisible();
  const addonConfirmationIcon = page.locator('[data-plan-icon-key="coins"]');
  await expect(addonConfirmationIcon).toBeVisible();
  await expect(addonConfirmationIcon).toHaveClass(/from-orange-500/);
  await expect(addonConfirmationIcon).toHaveClass(/to-red-600/);
});

test('后台数字输入保留中间态，并只在提交时校验数值规则', async ({ page }) => {
  await page.goto('/admin/plans');
  await page.getByRole('button', { name: '新增套餐', exact: true }).click();
  const planDialog = page.getByRole('dialog', { name: '新增套餐', exact: true });
  await fillAdminInput(planDialog, '套餐名称', '零值套餐');
  await fillAdminInput(planDialog, '套餐代码', 'zero-plan');
  await fillAdminInput(planDialog, '英文名', 'Zero Plan');
  await fillAdminTextarea(planDialog, '简介', '用于验证后台数值输入的零值套餐');
  const monthlyPriceInput = planDialog.getByLabel('月付价格（元）');
  await monthlyPriceInput.fill('');
  await expect(monthlyPriceInput).toHaveValue('');
  await monthlyPriceInput.pressSequentially('-');
  await expect(monthlyPriceInput).toHaveValue('-');
  await fillAdminInput(planDialog, '年付总价（元）', '0');
  await fillAdminInput(planDialog, '周期积分', '0');
  const retentionInput = planDialog.getByLabel('AI 生成素材保留天数');
  await retentionInput.fill('3651');
  await fillAdminInput(planDialog, '存储空间', '0GB');
  await fillAdminInput(planDialog, 'TikTok 账号数', '0');
  await fillAdminInput(planDialog, 'CTA 文案', '选择零值套餐');
  await planDialog.getByRole('button', { name: '新增套餐', exact: true }).click();
  await expect(planDialog.getByText('请填写有效的月付或一次性价格', { exact: true })).toBeVisible();

  await monthlyPriceInput.fill('0');
  await planDialog.getByRole('button', { name: '新增套餐', exact: true }).click();
  await expect(planDialog.getByText('AI 生成素材保留天数必须是 0 到 3650 的整数', { exact: true })).toBeVisible();

  await retentionInput.fill('0');
  await planDialog.getByRole('button', { name: '新增套餐', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: '零值套餐' })).toBeVisible();

  await page.goto('/admin/users');
  const userRow = page.getByRole('row').filter({ hasText: 'admin@lindyson.ai' });
  await userRow.getByRole('button', { name: '调整积分', exact: true }).click();

  const adjustmentDialog = page.getByRole('dialog', { name: '套餐与积分调整', exact: true });
  const adjustmentInput = adjustmentDialog.getByLabel('主套餐积分调整值');
  await adjustmentDialog.getByLabel('内部调整原因（仅后台）').fill('端到端数值校验');
  await adjustmentInput.fill('');
  await expect(adjustmentInput).toHaveValue('');
  await adjustmentInput.pressSequentially('-');
  await expect(adjustmentInput).toHaveValue('-');
  await adjustmentDialog.getByRole('button', { name: '保存积分调整', exact: true }).click();
  await expect(adjustmentDialog.getByRole('alert')).toHaveText('主套餐积分和加购包积分的调整值都必须是整数');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  await adjustmentInput.fill('-10');
  await adjustmentDialog.getByRole('button', { name: '保存积分调整', exact: true }).click();
  let confirmDialog = page.getByRole('alertdialog', { name: '确认调整积分？', exact: true });
  await expect(confirmDialog).toContainText('主套餐积分将从 100 调整为 90');
  await confirmDialog.getByRole('button', { name: '取消', exact: true }).click();

  await adjustmentInput.fill('10');
  await adjustmentDialog.getByRole('button', { name: '保存积分调整', exact: true }).click();
  confirmDialog = page.getByRole('alertdialog', { name: '确认调整积分？', exact: true });
  await expect(confirmDialog).toContainText('主套餐积分将从 100 调整为 110');
  await confirmDialog.getByRole('button', { name: '取消', exact: true }).click();

  await adjustmentInput.fill('0');
  await adjustmentDialog.getByRole('button', { name: '保存积分调整', exact: true }).click();
  await expect(adjustmentDialog.getByRole('alert')).toHaveText('至少填写一项非 0 的积分调整值');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  await page.goto('/admin/consumption-settings');
  const intermediateStateVideoRow = page.getByRole('row')
    .filter({ has: page.getByText('Seedance 2.0', { exact: true }) })
    .filter({ has: page.getByText('15s', { exact: true }) })
    .filter({ has: page.getByText('480p', { exact: true }) })
    .first();
  await intermediateStateVideoRow.getByRole('button', { name: '修改积分', exact: true }).click();
  const consumptionDialog = page.getByRole('dialog', { name: '修改视频消耗', exact: true });
  const consumptionInput = consumptionDialog.getByLabel('无参考视频积分');
  await consumptionInput.click();
  await consumptionInput.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await consumptionInput.press('Backspace');
  await expect(consumptionInput).toHaveValue('');
  await consumptionInput.pressSequentially('-');
  await expect(consumptionInput).toHaveValue('-');
  await consumptionDialog.getByRole('button', { name: '提交修改', exact: true }).click();
  await expect(consumptionDialog.getByRole('alert')).toHaveText('积分必须是非负整数');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  await consumptionInput.fill('0');
  await consumptionDialog.getByRole('button', { name: '提交修改', exact: true }).click();
  confirmDialog = page.getByRole('alertdialog', { name: '确认修改视频消耗？', exact: true });
  await expect(confirmDialog).toContainText('无参考视频');
  await expect(confirmDialog).toContainText('→ 0 积分');
  await confirmDialog.getByRole('button', { name: '取消', exact: true }).click();
});

test('后台在同一弹窗独立修改套餐和分桶积分，并立即更新用户行', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [paidPlan({
    id: 'plan-admin-pro',
    name: '后台专业版',
    code: 'admin-pro',
    credits: 30000,
    assetRetentionDays: 30,
  })]);
  await page.goto('/admin/users');

  const userRow = page.getByRole('row').filter({ hasText: 'admin@lindyson.ai' });
  await userRow.getByRole('button', { name: '调整积分', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '套餐与积分调整', exact: true });
  await dialog.getByRole('tab', { name: '修改套餐', exact: true }).click();

  await dialog.getByRole('combobox', { name: '目标套餐', exact: true }).click();
  await page.getByRole('option', { name: /后台专业版/ }).click();
  const resetDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const expiresDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  await dialog.getByRole('combobox', { name: '下次套餐重置日期', exact: true }).click();
  await page.getByRole('gridcell', { name: resetDate, exact: true }).click();
  await dialog.getByRole('combobox', { name: '套餐到期日期', exact: true }).click();
  await page.getByRole('gridcell', { name: expiresDate, exact: true }).click();
  await dialog.getByLabel('内部调整原因（仅后台）').fill('线下签约开通');
  await dialog.getByRole('button', { name: '保存套餐设置', exact: true }).click();

  let confirmDialog = page.getByRole('alertdialog', { name: '确认修改用户套餐？', exact: true });
  await expect(confirmDialog).toContainText('主套餐积分将自动调整为 30,000');
  await expect(confirmDialog).toContainText('不会生成订单、收入、发票或通知邮件');
  await confirmDialog.getByRole('button', { name: '确认修改套餐', exact: true }).click();
  await expect(page.getByText('用户套餐已更新', { exact: true })).toBeVisible();

  await dialog.getByRole('tab', { name: '调整积分', exact: true }).click();
  await dialog.getByLabel('加购包积分调整值').fill('25');
  await dialog.getByLabel('内部调整原因（仅后台）').fill('活动赠送积分包');
  await dialog.getByRole('button', { name: '保存积分调整', exact: true }).click();
  confirmDialog = page.getByRole('alertdialog', { name: '确认调整积分？', exact: true });
  await expect(confirmDialog).toContainText('加购包积分将从 0 调整为 25');
  await confirmDialog.getByRole('button', { name: '确认调整积分', exact: true }).click();
  await expect(page.getByText('积分已调整', { exact: true })).toBeVisible();

  await dialog.getByRole('tab', { name: '修改套餐', exact: true }).click();
  await dialog.getByRole('combobox', { name: '目标套餐', exact: true }).click();
  await page.getByRole('option', { name: '免费版（特殊）', exact: true }).click();
  await dialog.getByLabel('内部调整原因（仅后台）').fill('结束线下套餐并保留活动积分包');
  await dialog.getByRole('button', { name: '保存套餐设置', exact: true }).click();
  confirmDialog = page.getByRole('alertdialog', { name: '确认修改用户套餐？', exact: true });
  await expect(confirmDialog).toContainText('主套餐积分将自动调整为 0');
  await expect(confirmDialog).toContainText('加购包积分保持 25');
  await expect(confirmDialog).toContainText('周期重置与到期日期将清空');
  await confirmDialog.getByRole('button', { name: '确认修改套餐', exact: true }).click();
  // 本用例会连续两次成功修改套餐，首个 Sonner 通知可能仍在退场动画中。
  await expect(page.getByText('用户套餐已更新', { exact: true }).last()).toBeVisible();

  await dialog.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(userRow).toContainText('免费版');
  await expect(userRow).toContainText('25 / 25');
  const adminSubscriptionRequestKey = `PATCH /api/admin/users/${mockUuid('user-admin@lindyson.ai')}/subscription`;
  await expect.poll(() => page.evaluate(
    key => (window as any).__getApiRequestCount(key),
    adminSubscriptionRequestKey,
  )).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('POST /api/admin/credits/adjust'))).toBe(1);
});

test('套餐保存前刷新期间草稿变化或关闭弹窗不会弹出过期确认', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [paidPlan({
    id: 'plan-race-pro',
    name: '竞态校验专业版',
    code: 'race-pro',
    credits: 20000,
  })]);
  await page.goto('/admin/users');

  const userRow = page.getByRole('row').filter({ hasText: 'admin@lindyson.ai' });
  await userRow.getByRole('button', { name: '调整积分', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '套餐与积分调整', exact: true });
  await dialog.getByRole('tab', { name: '修改套餐', exact: true }).click();
  await dialog.getByRole('combobox', { name: '目标套餐', exact: true }).click();
  await page.getByRole('option', { name: /竞态校验专业版/ }).click();

  const resetDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const expiresDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  await dialog.getByRole('combobox', { name: '下次套餐重置日期', exact: true }).click();
  await page.getByRole('gridcell', { name: resetDate, exact: true }).click();
  await dialog.getByRole('combobox', { name: '套餐到期日期', exact: true }).click();
  await page.getByRole('gridcell', { name: expiresDate, exact: true }).click();
  const noteInput = dialog.getByLabel('内部调整原因（仅后台）');
  await noteInput.fill('提交前旧草稿');

  const planReadRequestKey = 'GET /api/admin/plans';
  const firstPlanReadCount = await page.evaluate(
    key => (window as any).__getApiRequestCount(key),
    planReadRequestKey,
  );
  await page.evaluate(() => (window as any).__setAdminPlanReadDelay(500));
  await dialog.getByRole('button', { name: '保存套餐设置', exact: true }).click();
  await expect.poll(() => page.evaluate(
    key => (window as any).__getApiRequestCount(key),
    planReadRequestKey,
  )).toBe(firstPlanReadCount + 1);
  await noteInput.fill('刷新期间已修改草稿');
  await expect(dialog.getByRole('alert')).toHaveText('套餐草稿在校验期间发生变化，当前未提交任何修改，请重新核对后保存');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  const secondPlanReadCount = await page.evaluate(
    key => (window as any).__getApiRequestCount(key),
    planReadRequestKey,
  );
  await page.evaluate(() => (window as any).__setAdminPlanReadDelay(500));
  await dialog.getByRole('button', { name: '保存套餐设置', exact: true }).click();
  await expect.poll(() => page.evaluate(
    key => (window as any).__getApiRequestCount(key),
    planReadRequestKey,
  )).toBe(secondPlanReadCount + 1);
  await dialog.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.waitForTimeout(700);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const adminSubscriptionRequestKey = `PATCH /api/admin/users/${mockUuid('user-admin@lindyson.ai')}/subscription`;
  await expect.poll(() => page.evaluate(
    key => (window as any).__getApiRequestCount(key),
    adminSubscriptionRequestKey,
  )).toBe(0);
});

test('企业版在首页和订阅页保留楼宇图标', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [paidPlan({
    id: 'plan-enterprise',
    code: 'enterprise',
    name: '企业版',
    nameEn: 'Enterprise',
    recommendation: 'enterprise',
    iconKey: 'building-2',
    ctaLabel: '升级企业版',
  })]);

  await page.goto('/');
  await expect(page.getByText('企业版', { exact: true })).toBeVisible();
  const landingEnterpriseIcon = page.locator('[data-plan-icon-key="building-2"]');
  await expect(landingEnterpriseIcon).toBeVisible();
  await expect(landingEnterpriseIcon).toHaveClass(/from-orange-500/);
  await expect(landingEnterpriseIcon).toHaveClass(/to-red-600/);

  await page.goto('/app');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await expect(page.getByText('企业版', { exact: true })).toBeVisible();
  const subscriptionEnterpriseIcon = page.locator('[data-plan-icon-key="building-2"]');
  await expect(subscriptionEnterpriseIcon).toBeVisible();
  await expect(subscriptionEnterpriseIcon).toHaveClass(/from-orange-500/);
  await expect(subscriptionEnterpriseIcon).toHaveClass(/to-red-600/);

  await page.goto('/admin');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  const adminEnterpriseIcon = page.locator('[data-plan-icon-key="building-2"]');
  await expect(adminEnterpriseIcon).toBeVisible();
  await expect(adminEnterpriseIcon).toHaveClass(/from-orange-500/);
  await expect(adminEnterpriseIcon).toHaveClass(/to-red-600/);
});

test('订阅卡片推荐标签右对齐且不改变标题与价格基线', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [
    paidPlan({
      id: mockUuid('plan-alignment-basic'),
      code: 'alignment-basic',
      name: '标准版',
      nameEn: 'Basic',
      monthlyPrice: 1900,
      yearlyPrice: 18000,
      credits: 800,
      recommendation: null,
      iconKey: 'zap',
      ctaLabel: '升级标准版',
    }),
    paidPlan({
      id: mockUuid('plan-alignment-popular'),
      code: 'alignment-popular',
      name: '适合持续稳定批量生产内容的专业版本',
      nameEn: 'Professional for Growing Teams',
      credits: 3100,
      recommendation: 'popular',
      iconKey: 'sparkles',
      ctaLabel: '升级专业版',
    }),
    paidPlan({
      id: mockUuid('plan-alignment-enterprise'),
      code: 'alignment-enterprise',
      name: '企业版',
      nameEn: 'Enterprise',
      monthlyPrice: 9900,
      yearlyPrice: 99000,
      credits: 31190,
      recommendation: 'enterprise',
      iconKey: 'rocket',
      ctaLabel: '升级企业版',
    }),
  ]);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/subscription');

  const yearlyToggle = page.getByRole('button', { name: '年付' });
  await expect(yearlyToggle).toContainText('年付更优惠');
  await expect(page.getByText('省 30%', { exact: true })).toHaveCount(0);

  const cards = page.locator('[data-plan-card]');
  await expect(cards).toHaveCount(3);
  const headerTops = await cards.locator('[data-plan-card-header]').evaluateAll(elements => (
    elements.map(element => element.getBoundingClientRect().top)
  ));
  const priceTops = await cards.locator('[data-plan-card-price]').evaluateAll(elements => (
    elements.map(element => element.getBoundingClientRect().top)
  ));
  expect(Math.max(...headerTops) - Math.min(...headerTops)).toBeLessThanOrEqual(1);
  expect(Math.max(...priceTops) - Math.min(...priceTops)).toBeLessThanOrEqual(1);

  const popularCard = page.locator('[data-plan-card="alignment-popular"]');
  const enterpriseCard = page.locator('[data-plan-card="alignment-enterprise"]');
  const basicCard = page.locator('[data-plan-card="alignment-basic"]');
  const popularBadge = popularCard.locator('[data-plan-recommendation-badge]');
  const enterpriseBadge = enterpriseCard.locator('[data-plan-recommendation-badge]');
  await expect(popularBadge).toHaveText('最受欢迎');
  await expect(popularBadge).toHaveClass(/rounded-full/);
  await expect(popularBadge).toHaveClass(/from-purple-600/);
  await expect(popularBadge).toHaveClass(/to-blue-600/);
  await expect(enterpriseBadge).toHaveText('企业首选');
  await expect(enterpriseBadge).toHaveClass(/rounded-full/);
  await expect(enterpriseBadge).toHaveClass(/from-orange-500/);
  await expect(enterpriseBadge).toHaveClass(/to-red-600/);
  await expect(basicCard).toHaveAttribute('data-accent', 'violet');
  await expect(popularCard).toHaveAttribute('data-accent', 'violet');
  await expect(enterpriseCard).toHaveAttribute('data-accent', 'orange');
  await expect(enterpriseCard.locator('[data-plan-icon-key="rocket"]')).toBeVisible();
  await expect(enterpriseCard.locator('[data-plan-card-price]')).toContainText('¥83');
  await expect(enterpriseCard.locator('[data-plan-card-price]')).not.toContainText('¥82.50');
  await expect(page.locator('[data-plan-cycle-credits]')).toHaveCount(3);
  await expect(page.locator('[data-plan-card="alignment-basic"] [data-plan-cycle-credits]')).toContainText('800');
  await expect(popularCard.locator('[data-plan-cycle-credits]')).toContainText('3,100');
  await expect(enterpriseCard.locator('[data-plan-cycle-credits]')).toContainText('31,190');
  await expect(popularCard.locator('[data-plan-cycle-credits]')).toHaveClass(/border-fuchsia-400\/30/);
  await expect(popularCard.locator('[data-plan-cycle-credits]')).toHaveClass(/from-fuchsia-500\/15/);
  await expect(popularCard.locator('[data-plan-cycle-credits]')).toHaveClass(/to-blue-500\/10/);

  const expectHeaderDoesNotOverlapBadge = async (card: ReturnType<typeof page.locator>) => {
    const layout = await card.evaluate(element => {
      const header = element.querySelector<HTMLElement>('[data-plan-card-header]');
      const identity = element.querySelector<HTMLElement>('[data-plan-card-identity]');
      const badge = element.querySelector<HTMLElement>('[data-plan-recommendation-badge]');
      if (!header || !identity || !badge) throw new Error('套餐标题行缺少推荐标签布局节点');
      const headerBox = header.getBoundingClientRect();
      const identityBox = identity.getBoundingClientRect();
      const badgeBox = badge.getBoundingClientRect();
      return {
        headerTop: headerBox.top,
        headerRight: headerBox.right,
        identityRight: identityBox.right,
        badgeTop: badgeBox.top,
        badgeLeft: badgeBox.left,
        badgeRight: badgeBox.right,
      };
    });
    expect(layout.identityRight).toBeLessThanOrEqual(layout.badgeLeft);
    expect(Math.abs(layout.headerTop - layout.badgeTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.headerRight - layout.badgeRight)).toBeLessThanOrEqual(1);
  };

  await expectHeaderDoesNotOverlapBadge(popularCard);
  await expectHeaderDoesNotOverlapBadge(enterpriseCard);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectHeaderDoesNotOverlapBadge(popularCard);
  await expectHeaderDoesNotOverlapBadge(enterpriseCard);

  await enterpriseCard.getByRole('button', { name: '升级企业版' }).click();
  await expect(page.locator('[data-plan-icon-key="rocket"]')).toBeVisible();
  await expect(page.getByText('¥990', { exact: true })).toBeVisible();
  await expect(page.getByText('约 ¥83/月', { exact: true })).toBeVisible();
});

test('订阅页 FAQ 默认折叠并支持键盘展开', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [paidPlan()]);
  await page.goto('/app/subscription');

  const faq = page.locator('[data-subscription-faq]');
  const items = faq.locator('details');
  const firstItem = items.first();
  const firstSummary = firstItem.locator('summary');
  const firstAnswer = firstItem.getByText('不会，主套餐积分会在每个结算周期开始时重置。', { exact: true });

  await expect(items).toHaveCount(4);
  await expect(firstItem).not.toHaveAttribute('open', '');
  await expect(firstAnswer).not.toBeVisible();

  await firstSummary.focus();
  await expect(firstSummary).toBeFocused();
  await firstSummary.press('Enter');
  await expect(firstItem).toHaveAttribute('open', '');
  await expect(firstAnswer).toBeVisible();

  await firstSummary.press('Enter');
  await expect(firstItem).not.toHaveAttribute('open', '');
  await expect(firstAnswer).not.toBeVisible();
});

test('套餐和加购包先确认再创建支付订单，取消不会下单', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [paidPlan(), addonPlan()]);
  await page.goto('/app');
  await page.getByRole('button', { name: '订阅套餐' }).click();

  const paymentRequestsBefore = await page.evaluate(() => (window as any).__getApiRequestCount('POST /api/payments/create'));
  await page.getByRole('button', { name: '升级专业版' }).click();
  await expect(page.getByRole('heading', { name: '确认购买' })).toBeVisible();
  const paymentSummaryCard = page.getByTestId('payment-summary-card');
  const paymentMethodCard = page.getByTestId('payment-method-card');
  await expect(paymentSummaryCard.getByRole('heading', { name: '支付摘要' })).toBeVisible();
  await expect(paymentSummaryCard.getByText('支付宝', { exact: true })).toHaveCount(0);
  await expect(paymentSummaryCard.getByRole('button')).toHaveCount(0);
  await expect(paymentMethodCard.getByRole('heading', { name: '支付方式' })).toBeVisible();
  const paymentMethodTitleIcon = paymentMethodCard.getByTestId('payment-method-title-icon');
  await expect(paymentMethodTitleIcon.locator('svg')).toHaveCount(1);
  await expect(paymentMethodTitleIcon.locator('svg')).toHaveClass(/lucide-credit-card/);
  const alipayLogo = paymentMethodCard.getByTestId('alipay-method-logo');
  await expect(alipayLogo).toHaveAttribute('src', /\/alipay-logo(?:-[A-Za-z0-9_-]+)?\.png(?:\?.*)?$/);
  await expect.poll(() => alipayLogo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const paymentMethodOptionOrder = await paymentMethodCard.getByTestId('payment-method-option-content').evaluate(element => (
    Array.from(element.children).map(child => child.tagName)
  ));
  expect(paymentMethodOptionOrder).toEqual(['INPUT', 'IMG', 'SPAN']);
  await expect(paymentMethodCard.getByRole('radio')).toHaveCount(1);
  await expect(paymentMethodCard.getByRole('radio')).toBeChecked();
  await expect(paymentMethodCard.getByRole('button', { name: '确认支付 ¥228' })).toBeVisible();
  await expect(paymentMethodCard.getByRole('button', { name: '取消支付' })).toBeVisible();
  await expect(paymentMethodCard.getByText('付款成功且套餐正式生效后无法退款。', { exact: true })).toBeVisible();
  await expect(page.getByText('完整套餐权益')).toBeVisible();
  const periodMetric = page.getByText('周期积分', { exact: true }).locator('..');
  await expect(periodMetric).toHaveClass(/text-white/);
  await expect(page.getByText('30,000')).toBeVisible();
  await expect(page.getByText('100GB')).toBeVisible();
  await expect(page.getByText('¥228', { exact: true })).toBeVisible();
  await expect(page.getByText('-¥120', { exact: true })).toBeVisible();
  await expect(page.getByText('点击确认后才会创建订单')).toHaveCount(0);

  await page.getByRole('button', { name: '月付套餐' }).click();
  await expect(page.getByRole('button', { name: '确认支付 ¥29' })).toBeVisible();
  await expect(page.getByText('月付原价')).toHaveCount(0);
  await expect(page.getByText('年付优惠')).toHaveCount(0);
  await page.getByRole('button', { name: '年付套餐' }).click();
  await expect(page.getByRole('button', { name: '确认支付 ¥228' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('POST /api/payments/create'))).toBe(paymentRequestsBefore);

  await page.getByRole('button', { name: '取消支付' }).click();
  await expect(page.getByRole('heading', { name: '选择适合你的套餐' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('POST /api/payments/create'))).toBe(paymentRequestsBefore);

  await page.getByRole('button', { name: '购买加购包' }).click();
  await expect(page.getByRole('heading', { name: '确认购买' })).toBeVisible();
  await expect(page.getByText('加购包规则')).toBeVisible();
  await expect(page.getByText('一次性购买', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('¥59', { exact: true })).toBeVisible();
  await expect(page.getByTestId('payment-method-card').getByRole('radio')).toBeChecked();
  await expect(page.getByTestId('payment-method-card').getByRole('button', { name: '确认支付 ¥59' })).toBeVisible();
  await expect(page.getByTestId('payment-method-card').getByRole('button', { name: '取消支付' })).toBeVisible();
  await expect(page.getByRole('button', { name: '月付套餐' })).toHaveCount(0);
  await expect(page.getByText('点击确认后才会创建订单')).toHaveCount(0);
  await page.getByRole('button', { name: '取消支付' }).click();

  await page.getByRole('button', { name: '升级专业版' }).click();
  let popupOpened = false;
  page.once('popup', () => {
    popupOpened = true;
  });
  await page.getByRole('button', { name: '确认支付 ¥228' }).click();
  const qrDialog = page.getByRole('dialog', { name: '支付宝扫码支付' });
  await expect(qrDialog).toBeVisible();
  await expect(qrDialog.getByText('专业版', { exact: true })).toBeVisible();
  await expect(qrDialog.getByText('+30,000 积分', { exact: true })).toBeVisible();
  await expect(qrDialog.getByText('预计积分重置日期', { exact: true })).toBeVisible();
  await expect(qrDialog.getByText('2026-08-09', { exact: true })).toBeVisible();
  await expect(qrDialog.getByText('预计套餐到期日期', { exact: true })).toBeVisible();
  await expect(qrDialog.getByText('2027-07-10', { exact: true })).toBeVisible();
  await expect(qrDialog.getByText('¥228', { exact: true })).toBeVisible();
  const paymentSummary = qrDialog.getByTestId('payment-qr-summary');
  const paymentQrPanel = qrDialog.getByTestId('payment-qr-code-panel');
  const paymentQr = qrDialog.locator('svg[aria-label="支付宝支付二维码"]');
  await expect(paymentSummary).toBeVisible();
  await expect(paymentQrPanel).toBeVisible();
  await expect(paymentQr).toBeVisible();
  await expect(paymentQr).toHaveAttribute('width', '320');
  await expect(paymentQr).toHaveAttribute('height', '320');
  const desktopDialogBox = await qrDialog.boundingBox();
  const desktopSummaryBox = await paymentSummary.boundingBox();
  const desktopQrBox = await paymentQrPanel.boundingBox();
  expect(desktopDialogBox).not.toBeNull();
  expect(desktopSummaryBox).not.toBeNull();
  expect(desktopQrBox).not.toBeNull();
  expect(desktopDialogBox!.width).toBeGreaterThan(768);
  expect(desktopQrBox!.width).toBe(336);
  expect(desktopSummaryBox!.x + desktopSummaryBox!.width).toBeLessThan(desktopQrBox!.x);
  await page.waitForTimeout(200);
  expect(popupOpened).toBe(false);
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('POST /api/payments/create'))).toBe(paymentRequestsBefore + 1);
  await qrDialog.getByRole('button', { name: '取消支付' }).click();
  await expect(qrDialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(
    id => (window as any).__getApiRequestCount(`POST /api/payments/orders/${id}/cancel`),
    paymentOrderTwoId,
  )).toBe(1);
});

test('支付入口处理中不会虚报完成，重复确认沿用原幂等键', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [paidPlan()]);
  await page.evaluate(() => (window as any).__setPaymentCreateAttemptStatus('processing'));
  await page.goto('/app');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await page.getByRole('button', { name: '升级专业版' }).click();

  const confirmButton = page.getByRole('button', { name: '确认支付 ¥228' });
  await confirmButton.click();
  await expect(page.getByText('支付入口正在准备，约 3 秒后可重试', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '支付宝扫码支付' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '支付成功' })).toHaveCount(0);

  await confirmButton.click();
  await expect.poll(() => page.evaluate(
    () => (window as any).__getPaymentCreateIdempotencyKeys() as string[],
  )).toHaveLength(2);
  const idempotencyKeys = await page.evaluate(
    () => (window as any).__getPaymentCreateIdempotencyKeys() as string[],
  );
  expect(idempotencyKeys[0]).toBeTruthy();
  expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
});

test('支付 attempt 转人工核对时保留订单且不再打开支付入口', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [paidPlan()]);
  await page.evaluate(() => (window as any).__setPaymentCreateAttemptStatus('manual-review'));
  await page.goto('/app');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await page.getByRole('button', { name: '升级专业版' }).click();
  await page.getByRole('button', { name: '确认支付 ¥228' }).click();

  await expect(page.getByText('支付通道返回字段冲突', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '支付宝扫码支付' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '支付成功' })).toHaveCount(0);
});

test('支付二维码弹窗在窄屏按摘要、二维码顺序纵向排列', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [paidPlan()]);
  await page.goto('/app');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await page.getByRole('button', { name: '升级专业版' }).click();
  await page.getByRole('button', { name: '确认支付 ¥228' }).click();

  const qrDialog = page.getByRole('dialog', { name: '支付宝扫码支付' });
  const paymentSummary = qrDialog.getByTestId('payment-qr-summary');
  const paymentQrPanel = qrDialog.getByTestId('payment-qr-code-panel');
  const paymentQr = qrDialog.locator('svg[aria-label="支付宝支付二维码"]');
  await expect(qrDialog).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(qrDialog.getByText('+30,000 积分', { exact: true })).toBeVisible();
  await expect(qrDialog.getByText('预计积分重置日期', { exact: true })).toBeVisible();
  await expect(qrDialog.getByText('2026-08-09', { exact: true })).toBeVisible();
  await expect(qrDialog.getByText('预计套餐到期日期', { exact: true })).toBeVisible();
  await expect(qrDialog.getByText('2027-07-10', { exact: true })).toBeVisible();

  const dialogBox = await qrDialog.boundingBox();
  const narrowSummaryBox = await paymentSummary.boundingBox();
  const narrowQrBox = await paymentQrPanel.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(narrowSummaryBox).not.toBeNull();
  expect(narrowQrBox).not.toBeNull();
  expect(narrowSummaryBox!.y + narrowSummaryBox!.height).toBeLessThan(narrowQrBox!.y);
  expect(narrowQrBox!.x).toBeGreaterThanOrEqual(dialogBox!.x);
  expect(narrowQrBox!.x + narrowQrBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width);
  const narrowQrCodeBox = await paymentQr.boundingBox();
  expect(narrowQrCodeBox).not.toBeNull();
  expect(narrowQrCodeBox!.width).toBeLessThanOrEqual(narrowQrBox!.width);

  await qrDialog.getByRole('button', { name: '取消支付' }).click();
  await expect(qrDialog).toHaveCount(0);
});

test('二维码渲染容量异常时显示安全提示并仍可取消订单', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [paidPlan()]);
  await page.evaluate((value) => (window as any).__setDesktopPaymentCodeUrl(value),
    `https://openapi.alipay.com/gateway.do?token=${'a'.repeat(3_000)}`);
  await page.goto('/app');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await page.getByRole('button', { name: '升级专业版' }).click();
  await page.getByRole('button', { name: '确认支付 ¥228' }).click();

  const qrDialog = page.getByRole('dialog', { name: '支付宝扫码支付' });
  await expect(qrDialog.getByRole('alert')).toHaveText('支付二维码无法显示，请取消支付后重试。');
  await qrDialog.getByRole('button', { name: '取消支付' }).click();
  await expect(qrDialog).toHaveCount(0);
});

test('移动端 Jeepay 表单支付使用结构化字段自动提交', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [paidPlan()]);
  await page.evaluate(() => (window as any).__setPaymentLaunchType('form'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await page.getByRole('button', { name: '打开导航菜单' }).click();
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await page.getByRole('button', { name: '升级专业版' }).click();

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: '确认支付 ¥228' }).click();
  const popup = await popupPromise;
  await expect(page.getByText('已打开支付页面')).toBeVisible();
  await expect.poll(() => popup.url()).toContain('order=order-payment-');
  await popup.close();
});

test('二维码支付主动查单成功后刷新失败不覆盖结果', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [paidPlan()]);
  await page.goto('/app');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await page.getByRole('button', { name: '升级专业版' }).click();
  await page.evaluate(() => {
    (window as any).__setFailPaymentRefreshes(true);
    (window as any).__configurePaymentSync({ failures: 2, finalStatus: 'paid' });
  });

  await page.getByRole('button', { name: '确认支付 ¥228' }).click();
  await expect(page.getByRole('dialog', { name: '支付宝扫码支付' })).toBeVisible();
  await page.evaluate(() => (window as any).__setFailPaymentRefreshes(false));

  const successDialog = page.getByRole('dialog', { name: '支付成功' });
  await expect(successDialog).toBeVisible({ timeout: 20_000 });
  await expect(successDialog.getByText('已成功订阅专业版套餐', { exact: true })).toBeVisible();
  await expect(successDialog.getByText('+30,000', { exact: true })).toBeVisible();
  await expect(successDialog.getByText('30,100', { exact: true })).toBeVisible();
  await expect(successDialog.getByText('2026-08-09', { exact: true })).toBeVisible();
  await expect(successDialog.getByText('2027-07-10', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(
    id => (window as any).__getApiRequestCount(`POST /api/payments/orders/${id}/sync`),
    paymentOrderTwoId,
  )).toBe(3);
  await expect(page.getByText('服务器错误', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '确认并查看账户中心' }).click();
  await expect(page.getByRole('heading', { name: '账户中心' })).toBeVisible();
});

test('二维码支付主动查单临时失败时保留二维码并继续重试', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [paidPlan()]);
  await page.evaluate(() => (window as any).__configurePaymentSync({ failures: 99, finalStatus: 'pending' }));
  await page.goto('/app');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await page.getByRole('button', { name: '升级专业版' }).click();
  const orderRefreshesBefore = await page.evaluate(() => (window as any).__getApiRequestCount('GET /api/orders'));

  await page.getByRole('button', { name: '确认支付 ¥228' }).click();
  const qrDialog = page.getByRole('dialog', { name: '支付宝扫码支付' });
  await expect(qrDialog).toBeVisible();
  await expect(qrDialog.getByText('支付状态暂时无法确认，系统会继续自动查询。', { exact: true })).toBeVisible();
  await expect(qrDialog.getByText('支付状态暂时无法确认，系统会继续自动查询。', { exact: true })).toHaveCount(1);
  await expect.poll(
    () => page.evaluate(
      id => (window as any).__getApiRequestCount(`POST /api/payments/orders/${id}/sync`),
      paymentOrderTwoId,
    ),
    { timeout: 12_000 },
  ).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/orders'))).toBe(orderRefreshesBefore);
  await expect(qrDialog).toBeVisible();
  await expect(page.getByText('服务器错误', { exact: true })).toHaveCount(0);
  await qrDialog.getByRole('button', { name: '取消支付' }).click();
});

test('离开支付页面后立即停止二维码监控', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setPlans(items), [paidPlan()]);
  await page.evaluate(() => (window as any).__configurePaymentSync({ failures: 0, finalStatus: 'pending' }));
  await page.goto('/app');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await page.getByRole('button', { name: '升级专业版' }).click();
  await page.getByRole('button', { name: '确认支付 ¥228' }).click();
  await expect(page.getByRole('dialog', { name: '支付宝扫码支付' })).toBeVisible();
  await expect.poll(() => page.evaluate(
    id => (window as any).__getApiRequestCount(`POST /api/payments/orders/${id}/sync`),
    paymentOrderTwoId,
  )).toBeGreaterThanOrEqual(1);

  await page.goto('/app/digital-assets');
  const requestsAfterLeaving = await page.evaluate(
    id => (window as any).__getApiRequestCount(`POST /api/payments/orders/${id}/sync`),
    paymentOrderTwoId,
  );
  await page.waitForTimeout(6_000);
  await expect.poll(() => page.evaluate(
    id => (window as any).__getApiRequestCount(`POST /api/payments/orders/${id}/sync`),
    paymentOrderTwoId,
  )).toBe(requestsAfterLeaving);
});

test('支付返回页同步失败显示固定友好提示', async ({ page }) => {
  await page.evaluate(() => (window as any).__configurePaymentSync({ failures: 1, finalStatus: 'paid' }));
  await page.goto(`/app?payment=return&order=${mockUuid('order-1')}`);

  await expect(page.getByText('支付状态暂未确认，请稍后在历史订单中查看', { exact: true })).toBeVisible();
  await expect(page.getByText('服务器错误', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/app$/);
});

test('支付返回页遇到已确认失败时明确提示失败而非继续确认', async ({ page }) => {
  await page.evaluate(() => (window as any).__configurePaymentSync({ failures: 0, finalStatus: 'failed' }));
  await page.goto(`/app?payment=return&order=${mockUuid('order-1')}`);

  await expect(page.getByText('支付未完成，请重新发起支付', { exact: true })).toBeVisible();
  await expect(page.getByText('支付尚未完成，请在历史订单中查看最新状态', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/app$/);
});

test('支付返回页先同步核心订单，次要刷新失败不清除登录态', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__configurePaymentSync({ failures: 0, finalStatus: 'paid' });
    (window as any).__setFailPrivateDataRefreshes(true);
  });
  await page.goto(`/app?payment=return&order=${mockUuid('order-1')}`);

  await expect(page.getByText('支付成功', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('lindyson_api_token'))).toBeNull();
  await expect(page.getByText('服务器错误', { exact: true })).toHaveCount(0);
});

test('历史订单支持双入口、服务端游标分页、状态筛选、详情与用户隔离', async ({ page }) => {
  const currentUserOrders = Array.from({ length: 12 }, (_, index) => {
    const status = index % 3 === 0 ? 'paid' : index % 3 === 1 ? 'pending' : 'failed';
    return order(
      `history-${index + 1}`,
      '管理员',
      'admin@lindyson.ai',
      `历史套餐 ${index + 1}`,
      22800 + index,
      status,
      {
        billing: index % 2 === 0 ? 'yearly' : 'monthly',
        createdAt: `2026-07-${String(12 - index).padStart(2, '0')}T10:00:00.000Z`,
        failedAt: status === 'failed' ? '2026-07-01T10:05:00.000Z' : null,
        paymentError: status === 'failed' ? '支付未完成' : null,
      },
    );
  });
  const otherUserOrder = order('history-other', '其他用户', 'other@lindyson.ai', '其他用户专属订单', 9900, 'paid');
  await page.evaluate((items) => {
    (window as any).__setCursorPageSizeCap(10);
    (window as any).__setOrders(items);
  }, [...currentUserOrders, otherUserOrder]);

  await page.goto('/app');
  await page.getByRole('button', { name: '订阅套餐' }).click();
  await page.getByRole('button', { name: '历史订单' }).click();

  await expect(page.getByRole('heading', { name: '账户中心' })).toBeVisible();
  const orderPager = page.getByRole('navigation', { name: '历史订单翻页' });
  await expect(page.getByText('本页 10 条 · 共 12 条')).toBeVisible();
  await expect(page.getByText('历史套餐 1', { exact: true })).toBeVisible();
  await expect(page.getByText('其他用户专属订单')).toHaveCount(0);

  await orderPager.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('本页 2 条 · 共 12 条')).toBeVisible();
  await expect(page.getByText('历史套餐 11', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '刷新订单记录' }).click();
  await expect(page.getByText('本页 2 条 · 共 12 条')).toBeVisible();
  await expect(page.getByText('历史套餐 11', { exact: true })).toBeVisible();

  await orderPager.getByRole('button', { name: '上一页' }).click();
  await expect(page.getByText('本页 10 条 · 共 12 条')).toBeVisible();
  await orderPager.getByRole('button', { name: '尾页' }).click();
  await expect(page.getByText('本页 2 条 · 共 12 条')).toBeVisible();

  await page.getByRole('tab', { name: '已退款' }).click();
  await expect(page.getByText('暂无符合条件的订单')).toBeVisible();

  await page.getByRole('tab', { name: '已支付' }).click();
  await expect(page.getByText('共 4 条', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '详情', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '订单详情' })).toBeVisible();
  await expect(page.getByText('支付宝电脑网站')).toBeVisible();
  await expect(page.getByText('100 积分')).toBeVisible();
  await expect(page.getByText('订单失效时间')).toBeVisible();
  await page.getByRole('button', { name: '关闭订单详情' }).click();

  await page.getByRole('tab', { name: '全部' }).click();
  await expect(page.getByText('本页 10 条 · 共 12 条')).toBeVisible();
  await expect(page.getByText('历史套餐 1', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: '账户概览' }).click();
  await expect(page.getByText('积分概览')).toBeVisible();
  await page.getByRole('tab', { name: '订单记录' }).click();
  await expect(page.getByText('历史订单', { exact: true })).toBeVisible();
});

test('用户管理按 userId 隔离历史订单和积分流水，并支持搜索、筛选与只读详情', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const adminUserId = mockUuid('user-admin@lindyson.ai');
  const otherUserId = mockUuid('user-pro.user@lindyson.ai');
  const paidOrderId = mockUuid('admin-history-paid');
  const relatedJobId = mockUuid('admin-history-job');
  const ownOrders = [
    order('admin-history-paid', '管理员旧名', 'admin.old@lindyson.ai', '管理员年度套餐', 22800, 'paid', {
      userId: adminUserId,
      billing: 'yearly',
      merchantOrderNo: 'merchant-admin-paid',
      paymentOrderNo: 'PAY-ADMIN-PAID',
      createdAt: '2026-07-04T10:00:00.000Z',
    }),
    order('admin-history-pending', '管理员', 'admin@lindyson.ai', '管理员待支付套餐', 2900, 'pending', {
      userId: adminUserId,
      createdAt: '2026-07-03T10:00:00.000Z',
    }),
    order('admin-history-failed', '管理员', 'admin@lindyson.ai', '管理员失败套餐', 5900, 'failed', {
      userId: adminUserId,
      paymentError: '支付渠道拒绝',
      failedAt: '2026-07-02T10:05:00.000Z',
      createdAt: '2026-07-02T10:00:00.000Z',
    }),
    order('admin-history-refunded', '管理员', 'admin@lindyson.ai', '管理员已退款套餐', 9900, 'refunded', {
      userId: adminUserId,
      refundStatus: 'succeeded',
      refundedAt: '2026-07-01T11:00:00.000Z',
      createdAt: '2026-07-01T10:00:00.000Z',
    }),
    order('admin-history-page-filler-1', '管理员', 'admin@lindyson.ai', '分页占位套餐一', 2900, 'paid', { userId: adminUserId }),
    order('admin-history-page-filler-2', '管理员', 'admin@lindyson.ai', '分页占位套餐二', 2900, 'pending', { userId: adminUserId }),
    order('admin-history-page-2', '管理员', 'admin@lindyson.ai', '第二页历史套餐', 2900, 'paid', { userId: adminUserId }),
  ];
  const identityCollisionOrder = order(
    'admin-history-identity-collision',
    '管理员',
    'admin@lindyson.ai',
    '其他用户的同名订单',
    19900,
    'paid',
    { userId: otherUserId },
  );
  const ownInvoice = {
    id: mockUuid('admin-history-invoice'),
    orderId: paidOrderId,
    userId: adminUserId,
    userName: '管理员旧名',
    email: 'admin.old@lindyson.ai',
    planName: '管理员年度套餐',
    amount: 22800,
    invoiceTitle: '管理员正确发票抬头',
    taxId: '91441900MA22222222',
    receiveEmail: 'finance@lindyson.ai',
    status: 'unissued',
    requestedAt: '2026-07-04T10:02:00.000Z',
    issuedAt: null,
    note: '正确归属的发票',
  };
  const identityCollisionInvoice = {
    ...ownInvoice,
    id: mockUuid('admin-history-invoice-collision'),
    userId: otherUserId,
    invoiceTitle: '其他用户串线发票抬头',
    taxId: '91441900MA33333333',
  };
  const ownLedger = [
    ledger('管理员旧名', 'admin.old@lindyson.ai', {
      id: mockUuid('admin-ledger-earn'),
      userId: adminUserId,
      type: 'earn',
      amount: 1000,
      balance: 1000,
      source: '年度套餐积分到账',
      note: '旧邮箱下的到账记录',
      relatedOrderId: paidOrderId,
    }),
    ledger('管理员', 'admin@lindyson.ai', {
      id: mockUuid('admin-ledger-hold'),
      userId: adminUserId,
      type: 'hold',
      amount: -80,
      balance: 920,
      source: '生成任务预扣',
      note: '等待任务结算',
      relatedJobId,
    }),
    ledger('管理员', 'admin@lindyson.ai', {
      id: mockUuid('admin-ledger-spend'),
      userId: adminUserId,
      type: 'spend',
      amount: -80,
      balance: 920,
      source: '生成任务实扣',
      note: '任务成功结算',
      relatedJobId,
    }),
    ledger('管理员', 'admin@lindyson.ai', {
      id: mockUuid('admin-ledger-refund'),
      userId: adminUserId,
      type: 'refund',
      amount: 80,
      balance: 1000,
      source: '失败任务退回',
      note: '任务失败自动退回',
      relatedJobId,
    }),
    ledger('管理员', 'admin@lindyson.ai', {
      id: mockUuid('admin-ledger-adjust'),
      userId: adminUserId,
      type: 'adjust',
      amount: 45,
      balance: 1045,
      source: '人工补偿唯一来源',
      note: '人工补偿唯一备注',
      operator: 'admin@lindyson.ai',
    }),
    ledger('管理员', 'admin@lindyson.ai', {
      id: mockUuid('admin-ledger-void'),
      userId: adminUserId,
      type: 'void',
      amount: 80,
      balance: 1125,
      source: '冲销任务预扣',
      note: '撤销未结算预扣',
      relatedJobId,
    }),
    ledger('管理员', 'admin@lindyson.ai', {
      id: mockUuid('admin-ledger-page-2'),
      userId: adminUserId,
      type: 'earn',
      amount: 10,
      balance: 1135,
      source: '第二页积分流水',
      note: '用于验证本地分页',
    }),
  ];
  const identityCollisionLedger = ledger('管理员', 'admin@lindyson.ai', {
    id: mockUuid('admin-ledger-identity-collision'),
    userId: otherUserId,
    source: '其他用户的同名流水',
    note: '不应出现在管理员详情中',
  });

  await page.evaluate(({ orders, invoices, entries }) => {
    (window as any).__setCursorPageSizeCap(6);
    (window as any).__setOrders(orders);
    (window as any).__setInvoices(invoices);
    (window as any).__setCreditLedger(entries);
  }, {
    orders: [...ownOrders, identityCollisionOrder],
    invoices: [ownInvoice, identityCollisionInvoice],
    entries: [...ownLedger, identityCollisionLedger],
  });
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: '用户管理', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/admin/orders'))).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/admin/invoices'))).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/admin/credit-ledger'))).toBe(0);

  const adminRow = page.getByRole('row').filter({ hasText: 'admin@lindyson.ai' });
  for (const action of ['历史订单', '积分流水', '调整积分', '冻结']) {
    await expect(adminRow.getByRole('button', { name: action, exact: true })).toBeVisible();
  }
  await adminRow.getByRole('button', { name: '历史订单', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/orders$/);
  await expect(page.getByRole('heading', { name: '订单管理', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/admin/orders'))).toBe(1);
  const orderTable = page.getByRole('table');
  await expect.poll(() => orderTable.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const paidOrderRow = orderTable.getByRole('row').filter({ hasText: paidOrderId });
  const fullOrderId = paidOrderRow.getByText(paidOrderId, { exact: true });
  await expect(fullOrderId).toBeVisible();
  for (const planName of ['管理员年度套餐', '管理员待支付套餐', '管理员失败套餐', '管理员已退款套餐']) {
    await expect(page.getByText(planName, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('其他用户的同名订单', { exact: true })).toHaveCount(0);
  const orderPager = page.getByRole('navigation', { name: '订单分页导航' });
  await orderPager.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('第二页历史套餐', { exact: true })).toBeVisible();
  await orderPager.getByRole('button', { name: '上一页', exact: true }).click();

  const orderSearch = page.getByPlaceholder('搜索订单号、用户或套餐...');
  for (const query of [paidOrderId, '管理员年度套餐', 'merchant-admin-paid', 'PAY-ADMIN-PAID']) {
    await orderSearch.fill(query);
    await expect(page.getByText('管理员年度套餐', { exact: true })).toBeVisible();
  }
  await orderSearch.fill('不存在的订单');
  await expect(page.getByText('本页 0 条 · 共 0 条', { exact: true })).toBeVisible();
  await orderSearch.clear();
  await expect(page.getByText('管理员年度套餐', { exact: true })).toBeVisible();

  const orderStatus = page.getByRole('combobox', { name: '状态', exact: true });
  await orderStatus.click();
  await page.getByRole('listbox', { name: '状态', exact: true }).getByRole('option', { name: '已退款', exact: true }).click();
  await expect(page.getByText('管理员已退款套餐', { exact: true })).toBeVisible();
  await expect(page.getByText('管理员年度套餐', { exact: true })).toHaveCount(0);
  await orderStatus.click();
  await page.getByRole('listbox', { name: '状态', exact: true }).getByRole('option', { name: '已支付', exact: true }).click();
  await page.getByRole('row').filter({ hasText: '管理员年度套餐' }).getByRole('button', { name: '详情', exact: true }).click();
  const orderDetail = page.getByRole('dialog', { name: paidOrderId, exact: true });
  await expect(orderDetail.getByText('merchant-admin-paid', { exact: true })).toBeVisible();
  await expect(orderDetail.getByText('PAY-ADMIN-PAID', { exact: true })).toBeVisible();
  await expect(orderDetail.getByText('管理员正确发票抬头', { exact: true })).toBeVisible();
  await expect(orderDetail.getByText('其他用户串线发票抬头', { exact: true })).toHaveCount(0);
  await orderDetail.getByRole('button', { name: '关闭详情', exact: true }).click();

  await page.getByRole('button', { name: '用户管理', exact: true }).click();
  const refreshedAdminRow = page.getByRole('row').filter({ hasText: 'admin@lindyson.ai' });
  await refreshedAdminRow.getByRole('button', { name: '积分流水', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/credits$/);
  await expect(page.getByRole('heading', { name: '积分流水管理', exact: true })).toBeVisible();
  const ledgerTable = page.getByRole('table');
  await expect.poll(() => ledgerTable.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  for (const source of ['年度套餐积分到账', '生成任务预扣', '生成任务实扣', '失败任务退回', '人工补偿唯一来源', '冲销任务预扣']) {
    await expect(page.getByText(source, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('其他用户的同名流水', { exact: true })).toHaveCount(0);
  const ledgerPager = page.getByRole('navigation', { name: '积分流水分页导航' });
  await ledgerPager.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('第二页积分流水', { exact: true })).toBeVisible();
  await ledgerPager.getByRole('button', { name: '上一页', exact: true }).click();

  const ledgerSearch = page.getByPlaceholder('搜索用户、来源或备注...');
  for (const query of ['人工补偿唯一来源', '人工补偿唯一备注', relatedJobId]) {
    await ledgerSearch.fill(query);
    const expectedSource = query === relatedJobId ? '生成任务预扣' : '人工补偿唯一来源';
    await expect(page.getByText(expectedSource, { exact: true }).first()).toBeVisible();
  }
  await ledgerSearch.fill('不存在的流水');
  await expect(page.getByText('本页 0 条 · 共 0 条', { exact: true })).toBeVisible();
  await ledgerSearch.clear();
  await expect(page.getByText('年度套餐积分到账', { exact: true })).toBeVisible();

  const ledgerType = page.getByRole('combobox', { name: '类型', exact: true });
  await ledgerType.click();
  await page.getByRole('listbox', { name: '类型', exact: true }).getByRole('option', { name: '冲销', exact: true }).click();
  const voidRow = page.getByRole('row').filter({ hasText: '冲销任务预扣' });
  await expect(voidRow).toBeVisible();
  await expect(page.getByText('年度套餐积分到账', { exact: true })).toHaveCount(0);
  await voidRow.getByRole('button').click();
  const ledgerDetail = page.getByRole('dialog', { name: '冲销任务预扣', exact: true });
  await expect(ledgerDetail.getByText('撤销未结算预扣', { exact: true })).toBeVisible();
  await expect(ledgerDetail.getByText('管理员 · admin@lindyson.ai', { exact: true })).toBeVisible();
  await expect(ledgerDetail.getByText('system', { exact: true })).toBeVisible();
});

test('用户管理的历史订单和积分流水会区分无数据空状态', async ({ page }) => {
  const otherUserId = mockUuid('user-pro.user@lindyson.ai');
  await page.evaluate(({ otherOrder, otherLedger }) => {
    (window as any).__setOrders([otherOrder]);
    (window as any).__setCreditLedger([otherLedger]);
  }, {
    otherOrder: order('空状态-其他用户订单', '管理员', 'admin@lindyson.ai', '其他用户套餐', 2900, 'paid', { userId: otherUserId }),
    otherLedger: ledger('管理员', 'admin@lindyson.ai', {
      id: mockUuid('空状态-其他用户流水'),
      userId: otherUserId,
      source: '其他用户流水',
    }),
  });
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: '用户管理', exact: true })).toBeVisible();

  const adminRow = page.getByRole('row').filter({ hasText: 'admin@lindyson.ai' });
  await adminRow.getByRole('button', { name: '历史订单', exact: true }).click();
  await expect(page.getByRole('heading', { name: '订单管理', exact: true })).toBeVisible();
  await expect(page.getByText('本页 0 条 · 共 0 条', { exact: true })).toBeVisible();
  await expect(page.getByText('其他用户套餐', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '用户管理', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'admin@lindyson.ai' }).getByRole('button', { name: '积分流水', exact: true }).click();
  await expect(page.getByRole('heading', { name: '积分流水管理', exact: true })).toBeVisible();
  await expect(page.getByText('本页 0 条 · 共 0 条', { exact: true })).toBeVisible();
  await expect(page.getByText('其他用户流水', { exact: true })).toHaveCount(0);
});

test('平台公告新增、修改、置顶和删除后同步到用户端仪表盘', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: '平台公告' }).click();
  await expect(page.getByRole('heading', { name: '平台公告' })).toBeVisible();

  const searchInput = page.getByPlaceholder('搜索公告标题或内容...');
  await searchInput.fill('后台完整列表专属公告');
  await expect(page.getByText('后台完整列表专属公告', { exact: true })).toBeVisible();
  await searchInput.fill('');

  await page.getByRole('button', { name: '新增公告' }).click();
  let modal = page.locator('.fixed.inset-0.z-50').last();
  await expect(modal.getByRole('heading', { name: '新增公告' })).toBeVisible();
  await fillAdminInput(modal, '公告标题', 'E2E 同步公告');
  await fillAdminTextarea(modal, '公告内容', '这条公告需要同时出现在后台列表和用户端仪表盘。');
  await modal.getByRole('button', { name: '发布公告' }).click();
  await expect(page.getByRole('heading', { name: '发布公告' })).toBeVisible();
  await page.getByRole('button', { name: '确认发布' }).click();
  await expect(adminAnnouncementRow(page, 'E2E 同步公告')).toBeVisible();

  await adminAnnouncementRow(page, 'E2E 同步公告').getByRole('button', { name: '修改' }).click();
  modal = page.locator('.fixed.inset-0.z-50').last();
  await expect(modal.getByRole('heading', { name: '修改公告' })).toBeVisible();
  await fillAdminInput(modal, '公告标题', 'E2E 同步公告（已编辑）');
  await fillAdminTextarea(modal, '公告内容', '编辑后的公告内容需要同步到用户端详情弹窗。');
  await modal.getByRole('button', { name: '保存修改' }).click();
  await expect(adminAnnouncementRow(page, 'E2E 同步公告（已编辑）')).toBeVisible();

  await page.getByRole('button', { name: '返回用户端' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();
  await expect(page.getByText('E2E 同步公告（已编辑）', { exact: true })).toBeVisible();
  await page.getByText('E2E 同步公告（已编辑）', { exact: true }).click();
  await expect(page.getByText('编辑后的公告内容需要同步到用户端详情弹窗。')).toBeVisible();
  await page.getByRole('button', { name: '关闭公告详情' }).click();

  await page.goto('/admin');
  await page.getByRole('button', { name: '平台公告' }).click();
  await adminAnnouncementRow(page, '系统公告').getByRole('button', { name: '取消置顶' }).click();
  await expect(adminAnnouncementRow(page, '系统公告').getByText('普通', { exact: true })).toBeVisible();

  await adminAnnouncementRow(page, 'E2E 同步公告（已编辑）').getByRole('button', { name: '置顶' }).click();
  await expect(adminAnnouncementRow(page, 'E2E 同步公告（已编辑）').getByText('置顶', { exact: true })).toBeVisible();
  await adminAnnouncementRow(page, 'AI 队列公告').getByRole('button', { name: '置顶' }).click();
  await expect(page.getByText('最多可置顶 3 条公告')).toBeVisible();

  await adminAnnouncementRow(page, 'E2E 同步公告（已编辑）').getByRole('button', { name: '删除' }).click();
  await expect(page.getByRole('heading', { name: '删除公告' })).toBeVisible();
  await page.getByRole('button', { name: '删除公告' }).click();
  await expect(adminAnnouncementRow(page, 'E2E 同步公告（已编辑）')).toHaveCount(0);

  await page.getByRole('button', { name: '返回用户端' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('E2E 同步公告（已编辑）', { exact: true })).toHaveCount(0);
});

test('注册验证码重新发送按钮需要等待 60 秒', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-06-30T10:00:00') });
  await page.goto('/register');

  await page.getByLabel('用户名').fill('倒计时用户');
  await page.getByLabel('邮箱', { exact: true }).fill('pro.user@lindyson.ai');
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('该邮箱已注册，请直接登录')).toBeVisible();
  await expect(page.getByRole('button', { name: '发送验证码' })).toBeEnabled();

  await page.getByLabel('邮箱', { exact: true }).fill('cooldown.user@lindyson.ai');
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByRole('button', { name: '60s 后重发' })).toBeDisabled();

  await page.clock.fastForward(60_000);
  await expect(page.getByRole('button', { name: '重新发送' })).toBeEnabled();

  await page.getByRole('button', { name: '重新发送' }).click();
  await expect(page.getByRole('button', { name: '60s 后重发' })).toBeDisabled();
  await page.getByLabel('用户名').fill('倒计时用户改名');
  await expect(page.getByRole('button', { name: /\d+s 后重发/ })).toBeDisabled();
  await page.getByLabel('邮箱', { exact: true }).fill('other.user@lindyson.ai');
  await expect(page.getByRole('button', { name: '发送验证码' })).toBeEnabled();
  await page.getByLabel('邮箱', { exact: true }).fill('cooldown.user@lindyson.ai');
  await expect(page.getByRole('button', { name: /\d+s 后重发/ })).toBeDisabled();
});

test('普通用户 AI Studio 读取用户端积分配置接口', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('邮箱', { exact: true }).fill('member@lindyson.ai');
  await page.getByLabel('密码', { exact: true }).fill('mock123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole('button', { name: 'AI Studio', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成视频 · 70 积分' })).toBeVisible();
  await expect(page.getByText('单条 70 积分，共 1 条，合计 70 积分')).toHaveCount(0);
});

async function expectAIStudioMenuGeometry(menu: Locator, options: { fullyVisible: boolean }) {
  await expect(menu).toBeVisible();
  if (options.fullyVisible) {
    // 浮层在下一帧按实际内容和边框二次定位，等待完成后再检查完整展示。
    await expect.poll(() => menu.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  }
  const geometry = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const styles = window.getComputedStyle(element);
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      overflowX: styles.overflowX,
      overflowY: styles.overflowY,
    };
  });

  expect(geometry.left).toBeGreaterThanOrEqual(7);
  expect(geometry.top).toBeGreaterThanOrEqual(7);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth - 7);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight - 7);
  expect(geometry.overflowX).toBe('hidden');
  expect(geometry.overflowY).toBe('auto');
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  if (options.fullyVisible) {
    expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight + 1);
  } else {
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight + 1);
  }
  return geometry;
}

test('AI Studio 视频参数使用紧凑下拉并按模型隐藏不支持的分辨率', async ({ page }) => {
  await page.setViewportSize({ width: 1889, height: 1185 });
  await page.evaluate(input => (window as any).__setVideoConsumptionConfiguration(input), {
    items: [
      consumption('cons-video-15-1080-e2e', 'video', 'Seedance 2.0', 'Seedance 2.0', 15, '1080p', 90, true, 105),
      consumption('cons-video-fast-15-720-e2e', 'video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 15, '720p', 30, true, 36),
    ],
    videoModels: [],
  });
  await page.goto('/app/ai-studio');

  const controls = page.getByTestId('ai-studio-video-controls');
  const composer = page.getByTestId('ai-studio-video-composer');
  const studioHeading = page.getByRole('heading', { name: 'AI Studio', exact: true });
  const studioTabs = page.getByRole('tablist', { name: 'AI Studio 生成类型' });
  const referenceCard = page.getByTestId('ai-studio-video-reference-card');
  const promptCard = page.getByTestId('ai-studio-video-prompt-card');
  await expect(page.getByTestId('ai-studio-real-portrait-card')).toHaveCount(0);
  const portraitTrigger = page.getByRole('button', { name: '真人演员：不使用真人演员', exact: true });
  const prompt = page.getByPlaceholder('详细描述你想生成的视频内容、场景、风格...');
  const modeTrigger = page.getByRole('button', { name: '参考模式：全能参考', exact: true });
  const modelTrigger = page.getByRole('button', { name: 'AI 模型：Seedance 2.0', exact: true });
  const defaultParameters = page.getByRole('button', { name: '视频参数：9:16 · 480p · 15s', exact: true });
  const quantityTrigger = page.getByRole('button', { name: '生成数量：1 条', exact: true });

  await expect(controls).toBeVisible();
  await expect(modeTrigger).toBeVisible();
  await expect(modelTrigger).toBeVisible();
  await expect(defaultParameters).toBeVisible();
  await expect(quantityTrigger).toBeVisible();
  const generateButton = page.getByRole('button', { name: '生成视频 · 70 积分', exact: true });
  const [composerBox, headingBox, tabsBox, referenceCardBox, promptCardBox, portraitBox, promptBox, controlsBox, modeBox, generateBox] = await Promise.all([
    composer.boundingBox(),
    studioHeading.boundingBox(),
    studioTabs.boundingBox(),
    referenceCard.boundingBox(),
    promptCard.boundingBox(),
    portraitTrigger.boundingBox(),
    prompt.boundingBox(),
    controls.boundingBox(),
    modeTrigger.boundingBox(),
    generateButton.boundingBox(),
  ]);
  expect(composerBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(tabsBox).not.toBeNull();
  expect(referenceCardBox).not.toBeNull();
  expect(promptCardBox).not.toBeNull();
  expect(portraitBox).not.toBeNull();
  expect(promptBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(modeBox).not.toBeNull();
  expect(generateBox).not.toBeNull();
  expect(composerBox!.width).toBeGreaterThanOrEqual(850);
  expect(Math.abs(headingBox!.x - referenceCardBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(tabsBox!.x - referenceCardBox!.x)).toBeLessThanOrEqual(1);
  expect(portraitBox!.y).toBeGreaterThanOrEqual(controlsBox!.y);
  expect(portraitBox!.x + portraitBox!.width).toBeLessThanOrEqual(generateBox!.x);
  expect(controlsBox!.y).toBeGreaterThanOrEqual(promptBox!.y + promptBox!.height);
  expect(Math.abs(generateBox!.y - modeBox!.y)).toBeLessThanOrEqual(1);

  await modeTrigger.click();
  await expectAIStudioMenuGeometry(page.getByTestId('ai-studio-video-mode-menu'), { fullyVisible: true });
  await page.keyboard.press('Escape');

  await modelTrigger.click();
  const modelMenu = page.getByTestId('ai-studio-video-model-menu');
  await expectAIStudioMenuGeometry(modelMenu, { fullyVisible: true });
  for (const [name, badge, description] of [
    ['Seedance 2.5', '新品推荐', '多模态长视频，原生有声更沉浸'],
    ['Seedance 2.0', '全能推荐', '1080p 高清输出，正式成片首选'],
    ['Seedance 2.0 Fast', '快速出片', '更快生成，适合高效试稿'],
    ['Seedance 2.0 Mini', '高性价比', '低成本批量创作，日常出片更省'],
  ] as const) {
    const option = modelMenu.getByRole('option').filter({ hasText: description });
    await expect(option).toContainText(name);
    await expect(option).toContainText(badge);
    await expect(option).toContainText(description);
  }
  await page.keyboard.press('Escape');

  await defaultParameters.click();
  const parametersMenu = page.getByTestId('ai-studio-video-parameters-menu');
  await expectAIStudioMenuGeometry(parametersMenu, { fullyVisible: true });
  const videoAspectPreview = page.getByTestId('ai-studio-video-aspect-ratio-preview');
  const videoAspectFrame = videoAspectPreview.locator('[data-ui="ai-studio-aspect-ratio-frame"]');
  await expect(videoAspectPreview).toHaveAttribute('data-aspect-ratio', '9:16');
  await expect(parametersMenu.locator('[data-ui="ai-studio-aspect-ratio-thumbnail"]')).toHaveCount(2);
  const portraitFrameBox = await videoAspectFrame.boundingBox();
  expect(portraitFrameBox).not.toBeNull();
  expect(portraitFrameBox!.height).toBeGreaterThan(portraitFrameBox!.width);
  await parametersMenu.getByRole('radio', { name: '16:9', exact: true }).click();
  await expect(videoAspectPreview).toHaveAttribute('data-aspect-ratio', '16:9');
  await expect.poll(async () => {
    const box = await videoAspectFrame.boundingBox();
    return box ? box.width > box.height : false;
  }).toBe(true);
  await parametersMenu.getByRole('radio', { name: '9:16', exact: true }).click();
  await expect(parametersMenu.getByRole('radio', { name: '1080p', exact: true })).toBeVisible();
  await parametersMenu.getByRole('radio', { name: '1080p', exact: true }).click();
  await expect(page.getByRole('button', { name: '视频参数：9:16 · 1080p · 15s', exact: true })).toBeVisible();

  await modelTrigger.click();
  await expect(parametersMenu).toHaveCount(0);
  await expect(modelMenu).toBeVisible();
  await modelMenu.getByRole('option', { name: /Seedance 2\.0 Fast/ }).click();
  await expect(page.getByRole('button', { name: 'AI 模型：Seedance 2.0 Fast', exact: true })).toBeVisible();
  const limitedParameters = page.getByRole('button', { name: '视频参数：9:16 · 720p · 15s', exact: true });
  await expect(limitedParameters).toBeVisible();

  await limitedParameters.click();
  await expect(parametersMenu.getByRole('radio', { name: '720p', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(parametersMenu.getByRole('radio', { name: '720p', exact: true })).toBeVisible();
  await expect(parametersMenu.getByRole('radio', { name: '1080p', exact: true })).toHaveCount(0);
  await expect(parametersMenu).not.toContainText('1080p');

  await page.getByRole('button', { name: 'AI 模型：Seedance 2.0 Fast', exact: true }).click();
  await modelMenu.getByRole('option').filter({ hasText: 'Seedance 2.0' }).filter({ hasText: '全能推荐' }).click();
  const restoredParameters = page.getByRole('button', { name: '视频参数：9:16 · 720p · 15s', exact: true });
  await expect(restoredParameters).toBeVisible();
  await restoredParameters.click();
  await expect(parametersMenu.getByRole('radio', { name: '720p', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(parametersMenu.getByRole('radio', { name: '1080p', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(parametersMenu).toHaveCount(0);
  await expect(restoredParameters).toBeFocused();

  await quantityTrigger.click();
  const quantityMenu = page.getByTestId('ai-studio-video-quantity-menu');
  await expectAIStudioMenuGeometry(quantityMenu, { fullyVisible: true });
  await quantityMenu.getByRole('option', { name: '4 条', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成数量：4 条', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '积分不足 · 还差 220', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '充值 / 查看套餐', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(controls).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('AI Studio 在完整双档积分与远程能力就绪时开放 Seedance 2.5', async ({ page }) => {
  await page.evaluate(input => (window as any).__setVideoConsumptionConfiguration(input), {
    items: seedance25ConsumptionRows(),
    videoModels: [seedance25Capability()],
  });
  await page.goto('/app/ai-studio');

  const defaultParameters = page.getByRole('button', { name: '视频参数：9:16 · 480p · 15s', exact: true });
  await defaultParameters.click();
  await expect(page.getByTestId('ai-studio-video-parameters-menu').getByRole('radio', { name: '25s', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await expect(page.getByRole('button', { name: 'AI 模型：Seedance 2.0', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'AI 模型：Seedance 2.0', exact: true }).click();
  const modelMenu = page.getByTestId('ai-studio-video-model-menu');
  const seedance25Option = modelMenu.getByRole('option').filter({ hasText: 'Seedance 2.5' });
  await expect(modelMenu.getByRole('option').first()).toContainText('Seedance 2.5');
  await expect(seedance25Option).toBeEnabled();
  await expect(seedance25Option).toContainText('新品推荐');
  await expect(seedance25Option).toContainText('多模态长视频，原生有声更沉浸');
  await seedance25Option.click();

  await expect(page.getByRole('button', { name: 'AI 模型：Seedance 2.5', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI 提示词适配中', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '真人演员：不使用真人演员', exact: true }).click();
  await expect(page.getByText('Seedance 2.5 的真人演员功能正在适配中。', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('支持仅使用音频作为参考', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '积分不足 · 还差 7', exact: true })).toBeDisabled();

  const generalParameters = page.getByRole('button', { name: '视频参数：9:16 · 480p · 15s', exact: true });
  await generalParameters.click();
  let parametersMenu = page.getByTestId('ai-studio-video-parameters-menu');
  await expect(parametersMenu.getByRole('radio', { name: '480p', exact: true })).toBeVisible();
  await expect(parametersMenu.getByRole('radio', { name: '720p', exact: true })).toBeVisible();
  await expect(parametersMenu.getByRole('radio', { name: '1080p', exact: true })).toHaveCount(0);
  await expect(parametersMenu.getByRole('radio', { name: '20s', exact: true })).toBeVisible();
  await expect(parametersMenu.getByRole('radio', { name: '25s', exact: true })).toBeVisible();
  await expect(parametersMenu.getByRole('radio', { name: '30s', exact: true })).toBeVisible();
  await expect(parametersMenu.getByRole('radio', { name: '跟随首帧', exact: true })).toHaveCount(0);
  await parametersMenu.getByRole('radio', { name: '25s', exact: true }).click();
  await expect(page.getByRole('button', { name: '积分不足 · 还差 79', exact: true })).toBeDisabled();
  await parametersMenu.getByRole('radio', { name: '720p', exact: true }).click();
  await expect(page.getByRole('button', { name: '积分不足 · 还差 282', exact: true })).toBeDisabled();
  await parametersMenu.getByRole('radio', { name: '480p', exact: true }).click();
  await parametersMenu.getByRole('radio', { name: '15s', exact: true }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '参考模式：全能参考', exact: true }).click();
  await page.getByTestId('ai-studio-video-mode-menu').getByRole('option').filter({ hasText: '首尾帧' }).click();
  const firstLastParameters = page.getByRole('button', { name: '视频参数：跟随首帧 · 480p · 15s', exact: true });
  await expect(firstLastParameters).toBeVisible();
  await firstLastParameters.click();
  parametersMenu = page.getByTestId('ai-studio-video-parameters-menu');
  await expect(parametersMenu.getByRole('radio', { name: '跟随首帧', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('ai-studio-video-aspect-ratio-preview')).toHaveAttribute('data-aspect-ratio', 'adaptive');
  await expect(parametersMenu.locator('[data-ui="ai-studio-aspect-ratio-adaptive-frame"]')).toBeVisible();
  await expect(parametersMenu.locator('[data-ui="ai-studio-aspect-ratio-frame"]')).toHaveCount(0);
  await expect(parametersMenu.getByRole('radio', { name: '9:16', exact: true })).toHaveCount(0);
  await expect(parametersMenu.getByRole('radio', { name: '16:9', exact: true })).toHaveCount(0);
});

test('AI Studio Seedance 2.5 失败任务恢复原参数并支持过滤、键盘选择素材后重新提交', async ({ page }) => {
  const references = seedance25ReferenceAssets({ imageCount: 2, videoCount: 3, audioCount: 1 });
  await page.evaluate(() => (window as any).__setMockCurrentUser({
    id: 'user-admin@lindyson.ai',
    userName: '管理员',
    email: 'admin@lindyson.ai',
    role: 'admin',
    planCode: 'free',
    planName: '免费版',
    billingCycle: 'monthly',
    mainCredits: 500,
    addonCredits: 0,
    credits: 500,
    totalCredits: 500,
    planResetAt: '2026-07-30',
    planExpiresAt: '2026-07-30',
  }));
  await page.evaluate(input => (window as any).__setVideoConsumptionConfiguration(input), {
    items: seedance25ConsumptionRows(),
    videoModels: [seedance25Capability()],
  });
  await page.evaluate(task => (window as any).__setGenerationTasks([task]), seedance25FailedTask(references));
  await page.goto('/app/ai-studio');

  await expect(page.getByText('当前组合参数校验失败，请修改后重试', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '修改参数并重试', exact: true }).click();

  const prompt = page.getByPlaceholder('详细描述你想生成的视频内容、场景、风格...');
  await expect(prompt).toHaveValue('保留这条 Seedance 2.5 失败任务的提示词');
  await expect(page.getByRole('button', { name: 'AI 模型：Seedance 2.5', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '视频参数：16:9 · 720p · 25s', exact: true })).toBeVisible();
  await expect(page.getByText('已选择 2 张图片、3 个视频、1 个音频', { exact: true })).toBeVisible();
  await expect(page.getByText('共 6/50 个 · 视频 9s · 音频 3s', { exact: true })).toBeVisible();

  await prompt.fill('改写为 @重试参考视频3');
  const referenceMenu = page.getByTestId('reference-mention-menu');
  const videoGroup = referenceMenu.getByRole('group', { name: '视频', exact: true });
  await expect(referenceMenu).toBeVisible();
  await expect(videoGroup).toBeVisible();
  await expect(referenceMenu.getByRole('group', { name: '图片', exact: true })).toHaveCount(0);
  await expect(referenceMenu.getByRole('group', { name: '音频', exact: true })).toHaveCount(0);
  await expect(videoGroup.getByRole('option')).toHaveCount(1);
  await expect(videoGroup.getByRole('option')).toContainText('重试参考视频3');

  await prompt.press('ArrowDown');
  await prompt.press('ArrowUp');
  await expect(videoGroup.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  await prompt.press('Enter');
  await expect(prompt).toHaveValue('改写为 @视频3 ');
  await expect(referenceMenu).toHaveCount(0);
  await expect(prompt).toBeFocused();

  await page.getByRole('button', { name: '生成视频 · 230 积分', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__getLastGenerationRequest())).not.toBeNull();
  const request = await page.evaluate(() => (window as any).__getLastGenerationRequest());
  expect(request).toMatchObject({
    model: 'Seedance 2.5',
    prompt: '改写为 @视频3',
    config: {
      mode: 'general',
      aspectRatio: '16:9',
      resolution: '720p',
      durationSeconds: 25,
      generateAudio: true,
    },
  });
  expect((request as any).references).toHaveLength(6);
  expect((request as any).references.map((reference: { role: string }) => reference.role)).toEqual([
    'reference_image',
    'reference_image',
    'reference_video',
    'reference_video',
    'reference_video',
    'reference_audio',
  ]);
});

test('AI Studio Seedance 2.5 的 50 项素材与模型菜单在窄屏折叠展示且不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(input => (window as any).__setVideoConsumptionConfiguration(input), {
    items: seedance25ConsumptionRows(),
    videoModels: [seedance25Capability()],
  });
  await page.evaluate(task => (window as any).__setGenerationTasks([task]), seedance25FailedTask(
    seedance25ReferenceAssets(),
    'job-seedance-25-mobile-50-assets',
  ));
  await page.goto('/app/ai-studio');

  await page.getByRole('button', { name: '修改参数并重试', exact: true }).click();
  const composer = page.getByTestId('ai-studio-video-composer');
  const modelTrigger = page.getByRole('button', { name: 'AI 模型：Seedance 2.5', exact: true });
  const assetCard = page.getByText('参考素材', { exact: true }).first()
    .locator('xpath=ancestor::div[@data-ui="card"][1]');
  const removeAssetButtons = composer.getByRole('button', { name: /^删除(?:图片|视频|音频)\d+$/ });

  await expect(page.getByText('已选择 30 张图片、10 个视频、10 个音频', { exact: true })).toBeVisible();
  await expect(page.getByText('共 50/50 个 · 视频 30s · 音频 30s', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '展开其余 40 个素材', exact: true })).toBeVisible();
  await expect(removeAssetButtons).toHaveCount(10);

  const [composerBox, modelTriggerBox, assetCardBox] = await Promise.all([
    composer.boundingBox(),
    modelTrigger.boundingBox(),
    assetCard.boundingBox(),
  ]);
  if (!composerBox || !modelTriggerBox || !assetCardBox) throw new Error('Seedance 2.5 窄屏工作台未完成布局');
  for (const box of [composerBox, modelTriggerBox, assetCardBox]) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole('button', { name: '展开其余 40 个素材', exact: true }).click();
  await expect(page.getByRole('button', { name: '收起素材', exact: true })).toBeVisible();
  await expect(removeAssetButtons).toHaveCount(50);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await modelTrigger.click();
  const modelMenu = page.getByTestId('ai-studio-video-model-menu');
  await expect(modelMenu).toBeVisible();
  await expectAIStudioMenuGeometry(modelMenu, { fullyVisible: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 420 });
  await modelTrigger.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await modelTrigger.click();
  await expectAIStudioMenuGeometry(modelMenu, { fullyVisible: false });
  expect(await modelMenu.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  })).toBeGreaterThan(0);
  await page.keyboard.press('Escape');

  const parametersTrigger = page.getByRole('button', { name: '视频参数：16:9 · 720p · 25s', exact: true });
  await parametersTrigger.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await parametersTrigger.click();
  const parametersMenu = page.getByTestId('ai-studio-video-parameters-menu');
  await expectAIStudioMenuGeometry(parametersMenu, { fullyVisible: false });
  expect(await parametersMenu.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  })).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('AI Studio 在 Seedance 2.5 积分组合不完整时保持禁用且不显示零积分', async ({ page }) => {
  await page.evaluate(input => (window as any).__setVideoConsumptionConfiguration(input), {
    items: seedance25ConsumptionRows().slice(0, 11),
    videoModels: [seedance25Capability()],
  });
  await page.goto('/app/ai-studio');

  await page.getByRole('button', { name: 'AI 模型：Seedance 2.0', exact: true }).click();
  const seedance25Option = page.getByTestId('ai-studio-video-model-menu')
    .getByRole('option')
    .filter({ hasText: 'Seedance 2.5' });
  await expect(seedance25Option).toBeDisabled();
  await expect(seedance25Option).toContainText('当前未开放或积分配置未完整');
  await expect(page.getByText('0 积分', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '生成视频 · 70 积分', exact: true })).toBeVisible();
});

test('AI Studio 紧凑胶囊页签与工作区同流滚动，并在标签切换后保留独立状态', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  const requestedKinds: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/ai/tasks') {
      requestedKinds.push(url.searchParams.get('kind') ?? 'missing');
    }
  });

  await page.goto('/app/ai-studio');
  await expect(page.getByRole('button', { name: /生成视频 · \d+ 积分/ })).toBeVisible();
  await expect.poll(() => requestedKinds.filter(kind => kind === 'video').length).toBe(1);
  expect(requestedKinds.filter(kind => kind === 'image')).toHaveLength(0);

  const studioHeading = page.getByRole('heading', { name: 'AI Studio', exact: true });
  const workspaceScroll = page.getByTestId('ai-studio-workspace-scroll');
  const workspaceContent = page.getByTestId('ai-studio-workspace-content');
  const studioTabs = page.getByTestId('ai-studio-workspace-tabs');
  const videoTab = page.getByRole('tab', { name: 'AI 视频' });
  const imageTab = page.getByRole('tab', { name: 'AI 图片' });
  await expect(studioHeading).toBeVisible();
  await expect(workspaceScroll).toBeVisible();
  await expect(workspaceContent).toBeVisible();
  await expect(studioTabs).toBeVisible();
  await expect(studioTabs).toHaveAttribute('role', 'tablist');
  await expect(workspaceContent.locator('[data-testid="ai-studio-workspace-tabs"]')).toHaveCount(1);

  const videoPanelId = await videoTab.getAttribute('aria-controls');
  const videoTabId = await videoTab.getAttribute('id');
  if (!videoPanelId || !videoTabId) throw new Error('AI 视频页签缺少关联面板语义');
  const videoPanel = page.locator(`#${videoPanelId}`);
  await expect(videoPanel).toHaveAttribute('role', 'tabpanel');
  await expect(videoPanel).toHaveAttribute('aria-labelledby', videoTabId);
  await expect(workspaceContent.locator(`#${videoPanelId}`)).toHaveCount(1);
  const initialImagePanelId = await imageTab.getAttribute('aria-controls');
  const initialImageTabId = await imageTab.getAttribute('id');
  if (!initialImagePanelId || !initialImageTabId) throw new Error('AI 图片页签缺少关联面板语义');
  const initialImagePanel = page.locator(`#${initialImagePanelId}`);
  await expect(initialImagePanel).toHaveAttribute('role', 'tabpanel');
  await expect(initialImagePanel).toHaveAttribute('aria-labelledby', initialImageTabId);
  await expect(workspaceContent.locator(`#${initialImagePanelId}`)).toHaveCount(1);
  await expect(videoTab).toHaveAttribute('tabindex', '0');
  await expect(imageTab).toHaveAttribute('tabindex', '-1');

  const referenceCard = page.getByTestId('ai-studio-video-reference-card');
  const [headingBox, contentBox, tabsBox, referenceCardBox] = await Promise.all([
    studioHeading.boundingBox(),
    workspaceContent.boundingBox(),
    studioTabs.boundingBox(),
    referenceCard.boundingBox(),
  ]);
  expect(headingBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(tabsBox).not.toBeNull();
  expect(referenceCardBox).not.toBeNull();
  expect(tabsBox!.y).toBeGreaterThan(headingBox!.y + headingBox!.height);
  expect(Math.abs(headingBox!.x - referenceCardBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(tabsBox!.x - referenceCardBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(contentBox!.x - tabsBox!.x)).toBeLessThanOrEqual(1);
  // 页签恢复为原紧凑胶囊，而不是占满工作区的通栏框架。
  expect(contentBox!.width - tabsBox!.width).toBeGreaterThan(100);

  const contentPresentation = await workspaceContent.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      position: style.position,
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
      borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      borderRadius: style.borderRadius,
    };
  });
  expect(contentPresentation.position).toBe('static');
  expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(contentPresentation.backgroundColor);
  expect(contentPresentation.boxShadow).toBe('none');
  expect(contentPresentation.borderWidths.every(width => parseFloat(width) === 0)).toBe(true);
  expect(parseFloat(contentPresentation.borderRadius)).toBe(0);

  const tabsPresentation = await studioTabs.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      position: style.position,
      display: style.display,
      backgroundColor: style.backgroundColor,
      borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      borderRadius: style.borderRadius,
      paddingTop: style.paddingTop,
      boxShadow: style.boxShadow,
      backdropFilter: style.backdropFilter,
      webkitBackdropFilter: style.getPropertyValue('-webkit-backdrop-filter'),
    };
  });
  expect(tabsPresentation.position).toBe('static');
  expect(tabsPresentation.display).toBe('inline-flex');
  expect(['transparent', 'rgba(0, 0, 0, 0)']).not.toContain(tabsPresentation.backgroundColor);
  expect(tabsPresentation.borderWidths.every(width => parseFloat(width) > 0)).toBe(true);
  expect(parseFloat(tabsPresentation.borderRadius)).toBeGreaterThan(0);
  expect(parseFloat(tabsPresentation.paddingTop)).toBeGreaterThan(0);
  expect(tabsPresentation.boxShadow).toBe('none');
  expect(['', 'none']).toContain(tabsPresentation.backdropFilter);
  expect(['', 'none']).toContain(tabsPresentation.webkitBackdropFilter);

  const [tabsBeforeScroll, cardBeforeScroll] = await Promise.all([
    studioTabs.boundingBox(),
    referenceCard.boundingBox(),
  ]);
  expect(tabsBeforeScroll).not.toBeNull();
  expect(cardBeforeScroll).not.toBeNull();
  const scrollMovement = await workspaceScroll.evaluate(element => {
    const start = element.scrollTop;
    const maximum = element.scrollHeight - element.clientHeight;
    element.scrollTop = Math.min(maximum, start + 180);
    return { delta: element.scrollTop - start, maximum };
  });
  expect(scrollMovement.maximum).toBeGreaterThan(0);
  expect(scrollMovement.delta).toBeGreaterThan(0);
  const [tabsAfterScroll, cardAfterScroll] = await Promise.all([
    studioTabs.boundingBox(),
    referenceCard.boundingBox(),
  ]);
  expect(tabsAfterScroll).not.toBeNull();
  expect(cardAfterScroll).not.toBeNull();
  expect(tabsAfterScroll!.y).toBeLessThan(tabsBeforeScroll!.y);
  expect(cardAfterScroll!.y).toBeLessThan(cardBeforeScroll!.y);
  expect(Math.abs((tabsBeforeScroll!.y - tabsAfterScroll!.y) - scrollMovement.delta)).toBeLessThanOrEqual(2);
  expect(Math.abs((cardBeforeScroll!.y - cardAfterScroll!.y) - scrollMovement.delta)).toBeLessThanOrEqual(2);
  await workspaceScroll.evaluate(element => { element.scrollTop = 0; });

  await expect(videoTab).toHaveAttribute('data-accent', 'violet');
  await expect(videoTab).toHaveAttribute('data-state', 'active');
  await expect(imageTab).toHaveAttribute('data-accent', 'pink');
  await expect(imageTab).toHaveAttribute('data-state', 'inactive');

  await imageTab.click();
  await expect(videoTab).toHaveAttribute('data-state', 'inactive');
  await expect(imageTab).toHaveAttribute('data-state', 'active');
  await expect(videoTab).toHaveAttribute('tabindex', '-1');
  await expect(imageTab).toHaveAttribute('tabindex', '0');
  await expect(imageTab).toBeFocused();
  await expect(page.getByText('使用 Seedream 5.0 Pro 生成与精准编辑图片')).toBeVisible();
  await expect.poll(() => requestedKinds.filter(kind => kind === 'image').length).toBe(1);
  const imagePanelId = await imageTab.getAttribute('aria-controls');
  const imageTabId = await imageTab.getAttribute('id');
  if (!imagePanelId || !imageTabId) throw new Error('AI 图片页签缺少关联面板语义');
  const imagePanel = page.locator(`#${imagePanelId}`);
  await expect(imagePanel).toHaveAttribute('role', 'tabpanel');
  await expect(imagePanel).toHaveAttribute('aria-labelledby', imageTabId);
  await expect(workspaceContent.locator(`#${imagePanelId}`)).toHaveCount(1);

  const [imageHeadingBox, imageContentBox, imageTabsBox, imageWorkbenchBox] = await Promise.all([
    studioHeading.boundingBox(),
    workspaceContent.boundingBox(),
    studioTabs.boundingBox(),
    page.getByTestId('image-reference-workbench').boundingBox(),
  ]);
  expect(imageHeadingBox).not.toBeNull();
  expect(imageContentBox).not.toBeNull();
  expect(imageTabsBox).not.toBeNull();
  expect(imageWorkbenchBox).not.toBeNull();
  expect(Math.abs(imageHeadingBox!.x - imageWorkbenchBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(imageContentBox!.x - imageWorkbenchBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(imageTabsBox!.x - imageWorkbenchBox!.x)).toBeLessThanOrEqual(1);
  await page.getByLabel('图片描述').fill('保留图片工作区草稿');

  await page.getByRole('tab', { name: 'AI 视频' }).click();
  await expect(page.getByRole('button', { name: /生成视频 · \d+ 积分/ })).toBeVisible();
  await page.getByRole('tab', { name: 'AI 图片' }).click();
  await expect(page.getByLabel('图片描述')).toHaveValue('保留图片工作区草稿');
  expect(requestedKinds.filter(kind => kind === 'image')).toHaveLength(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>('[data-testid="ai-studio-workspace-scroll"]');
    const content = document.querySelector<HTMLElement>('[data-testid="ai-studio-workspace-content"]');
    const tabs = document.querySelector<HTMLElement>('[data-testid="ai-studio-workspace-tabs"]');
    if (!scroll || !content || !tabs) return null;
    return {
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      bodyFits: document.body.scrollWidth <= document.body.clientWidth + 1,
      scrollFits: scroll.scrollWidth <= scroll.clientWidth + 1,
      contentFits: content.scrollWidth <= content.clientWidth + 1,
      tabsFitContent: tabs.getBoundingClientRect().width <= content.getBoundingClientRect().width + 1,
      overflowX: getComputedStyle(scroll).overflowX,
    };
  })).toEqual({
    documentFits: true,
    bodyFits: true,
    scrollFits: true,
    contentFits: true,
    tabsFitContent: true,
    overflowX: 'hidden',
  });
});

test('AI 图片使用紧凑下拉并支持 @图片与 @标记引用', async ({ page }) => {
  await page.route('https://cdn.example.com/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#d946ef"/></svg>',
  }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app/ai-studio');
  await page.getByRole('tab', { name: 'AI 图片' }).click();

  const controls = page.getByTestId('ai-studio-image-controls');
  const modelTrigger = controls.getByRole('button', { name: 'AI 模型：Seedream 5.0 Pro', exact: true });
  const parametersTrigger = controls.getByRole('button', { name: '图片参数：1:1 · 2K', exact: true });
  const optimizationTrigger = controls.getByRole('button', { name: '提示词优化：标准', exact: true });
  const quantityTrigger = controls.getByRole('button', { name: '生成数量：1 张', exact: true });
  const generateButton = controls.getByRole('button', { name: '生成图片 · 28 积分', exact: true });

  for (const control of [modelTrigger, parametersTrigger, optimizationTrigger, quantityTrigger, generateButton]) {
    await expect(control).toBeVisible();
  }
  await expect(page.getByText('输出固定为 PNG 格式且无水印。', { exact: true })).toHaveCount(0);
  await expect(page.getByText('单张 28 积分，共 1 张，合计 28 积分', { exact: true })).toHaveCount(0);
  const controlBoxes = await Promise.all([
    modelTrigger.boundingBox(),
    parametersTrigger.boundingBox(),
    optimizationTrigger.boundingBox(),
    quantityTrigger.boundingBox(),
    generateButton.boundingBox(),
  ]);
  expect(controlBoxes.every(Boolean)).toBe(true);
  expect(Math.max(...controlBoxes.map(box => box!.y)) - Math.min(...controlBoxes.map(box => box!.y))).toBeLessThanOrEqual(1);
  expect(new Set(controlBoxes.map(box => box!.height)).size).toBe(1);

  await modelTrigger.click();
  const modelMenu = page.getByTestId('ai-studio-image-model-menu');
  await expectAIStudioMenuGeometry(modelMenu, { fullyVisible: true });
  await expect(modelMenu.getByRole('option')).toHaveCount(1);
  await expect(modelMenu.getByRole('option')).toContainText('固定模型');
  await page.keyboard.press('Escape');
  await expect(modelMenu).toHaveCount(0);
  await expect(modelTrigger).toBeFocused();

  await parametersTrigger.click();
  let parametersMenu = page.getByTestId('ai-studio-image-parameters-menu');
  await expectAIStudioMenuGeometry(parametersMenu, { fullyVisible: true });
  const imageAspectPreview = page.getByTestId('ai-studio-image-aspect-ratio-preview');
  const imageAspectFrame = imageAspectPreview.locator('[data-ui="ai-studio-aspect-ratio-frame"]');
  await expect(imageAspectPreview).toHaveAttribute('data-aspect-ratio', '1:1');
  await expect(parametersMenu.locator('[data-ui="ai-studio-aspect-ratio-thumbnail"]')).toHaveCount(8);
  for (const ratio of ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9']) {
    await expect(parametersMenu.locator(`[data-ui="ai-studio-aspect-ratio-thumbnail"][data-aspect-ratio="${ratio}"]`)).toBeVisible();
  }
  const squareFrameBox = await imageAspectFrame.boundingBox();
  expect(squareFrameBox).not.toBeNull();
  expect(Math.abs(squareFrameBox!.width - squareFrameBox!.height)).toBeLessThanOrEqual(1);
  await parametersMenu.getByRole('radio', { name: '3:4', exact: true }).click();
  await expect(imageAspectPreview).toHaveAttribute('data-aspect-ratio', '3:4');
  await expect.poll(async () => {
    const box = await imageAspectFrame.boundingBox();
    return box ? box.height > box.width : false;
  }).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await imageAspectFrame.evaluate(element => getComputedStyle(element).transitionProperty)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await parametersMenu.getByRole('radio', { name: '1K', exact: true }).click();
  await expect(controls.getByRole('button', { name: '图片参数：3:4 · 1K', exact: true })).toBeVisible();
  await expect(parametersMenu).toBeVisible();

  await optimizationTrigger.click();
  await expect(parametersMenu).toHaveCount(0);
  const optimizationMenu = page.getByTestId('ai-studio-image-optimization-menu');
  await expectAIStudioMenuGeometry(optimizationMenu, { fullyVisible: true });
  await optimizationMenu.getByRole('option').filter({ hasText: '极速' }).click();
  await expect(controls.getByRole('button', { name: '提示词优化：极速', exact: true })).toBeVisible();

  await quantityTrigger.click();
  const quantityMenu = page.getByTestId('ai-studio-image-quantity-menu');
  await expectAIStudioMenuGeometry(quantityMenu, { fullyVisible: true });
  await quantityMenu.getByRole('option', { name: '4 张', exact: true }).click();
  await expect(controls.getByRole('button', { name: '生成数量：4 张', exact: true })).toBeVisible();
  await expect(controls.getByRole('button', { name: '生成图片 · 56 积分', exact: true })).toBeVisible();

  const workbench = page.getByTestId('image-reference-workbench');
  await workbench.getByRole('button', { name: '选择图片', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择数字资产' });
  await picker.getByText('参考商品图', { exact: true }).click();
  await picker.getByText('参考收尾图', { exact: true }).click();
  await picker.getByRole('button', { name: '确认选择（2）' }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId('image-reference-summary')).toHaveText('参考图片 2/10，顺序对应 @图片1～@图片10');

  const annotationWorkspace = page.getByTestId('image-annotation-workspace');
  const annotationCanvas = annotationWorkspace.getByTestId('image-annotation-canvas');
  await expect(annotationCanvas).toHaveAttribute('data-grid-state', 'active');
  const gridBeforeZoom = await annotationCanvas.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      backgroundImage: style.backgroundImage,
      backgroundPosition: style.backgroundPosition,
      backgroundSize: style.backgroundSize,
    };
  });
  expect(gridBeforeZoom.backgroundImage).not.toBe('none');
  expect(gridBeforeZoom.backgroundSize).toContain('96px 96px');
  expect(gridBeforeZoom.backgroundSize).toContain('24px 24px');
  await annotationWorkspace.getByRole('button', { name: '放大画布' }).click();
  await expect.poll(() => annotationCanvas.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      backgroundImage: style.backgroundImage,
      backgroundPosition: style.backgroundPosition,
      backgroundSize: style.backgroundSize,
    };
  })).toEqual(gridBeforeZoom);
  await annotationWorkspace.getByRole('button', { name: '重置画布' }).click();

  await annotationCanvas.locator('img').dispatchEvent('error');
  await expect(annotationCanvas).toHaveAttribute('data-grid-state', 'inactive');
  await expect(annotationCanvas.getByText('这张参考图的预览地址已失效，请重新选择素材。', { exact: true })).toBeVisible();
  await expect(annotationCanvas.locator('img')).toHaveCount(0);
  await workbench.getByRole('button', { name: '选择图2：参考收尾图', exact: true }).click();
  await expect(annotationCanvas).toHaveAttribute('data-grid-state', 'active');
  await expect(annotationCanvas.getByAltText('参考收尾图')).toBeVisible();

  const prompt = page.getByLabel('图片描述');
  await prompt.fill('融合 @收尾');
  const mentionMenu = page.getByTestId('image-mention-menu');
  await expect(mentionMenu).toBeVisible();
  await expect(mentionMenu.getByText('参考图片', { exact: true })).toBeVisible();
  await expect(mentionMenu.getByRole('option', { name: /@图片2/ })).toBeVisible();
  await expect(mentionMenu.getByRole('option', { name: /@图片1/ })).toHaveCount(0);
  await prompt.press('Enter');
  await expect(prompt).toHaveValue('融合 @图片2 ');

  await workbench.getByRole('button', { name: '将图2前移', exact: true }).click();
  await expect(prompt).toHaveValue('融合 @图片1');
  await annotationWorkspace.getByTestId('image-annotation-canvas').click({ position: { x: 280, y: 210 } });
  await expect(prompt).toHaveValue(/@标记1/);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await prompt.focus();
  await prompt.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length));
  await prompt.pressSequentially(' @');
  await expect(mentionMenu).toBeVisible();
  await expect(mentionMenu.getByText('参考图片', { exact: true })).toBeVisible();
  await expect(mentionMenu.getByText('精准标记', { exact: true })).toBeVisible();
  await expect(mentionMenu.getByRole('option', { name: /@标记1/ })).toBeVisible();

  await controls.getByRole('button', { name: '图片参数：3:4 · 1K', exact: true }).click();
  await expect(mentionMenu).toHaveCount(0);
  parametersMenu = page.getByTestId('ai-studio-image-parameters-menu');
  await expect(parametersMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await prompt.focus();
  await prompt.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length - 2, element.value.length));
  await prompt.press('Backspace');

  const finalPrompt = await prompt.inputValue();
  expect(finalPrompt).toBe('融合 @图片1 @标记1 ');
  await controls.getByRole('button', { name: '生成图片 · 56 积分', exact: true }).click();
  const stableImageGenerateButton = page.getByTestId('ai-studio-image-generate-button');
  await expect(stableImageGenerateButton).toHaveAccessibleName('已加入队列 ✓');
  await expect(stableImageGenerateButton).toBeDisabled();
  await expect(page.getByText(/已加入图片生成队列/)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__getLastGenerationRequest())).not.toBeNull();
  const request = await page.evaluate(() => (window as any).__getLastGenerationRequest());
  expect(request).toMatchObject({
    model: 'Seedream 5.0 Pro',
    // 编辑器保留引用后的续写空格，提交时仅去除首尾空白。
    prompt: finalPrompt.trim(),
    config: { aspectRatio: '3:4', resolution: '1K', optimizePromptMode: 'fast' },
  });
  expect(request.references).toHaveLength(2);
  await expect(stableImageGenerateButton).toHaveAccessibleName('生成图片 · 56 积分', { timeout: 2_000 });
  await expect(stableImageGenerateButton).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 260 });
  const mobileParametersTrigger = controls.getByRole('button', { name: '图片参数：3:4 · 1K', exact: true });
  await mobileParametersTrigger.scrollIntoViewIfNeeded();
  await mobileParametersTrigger.click();
  parametersMenu = page.getByTestId('ai-studio-image-parameters-menu');
  await expectAIStudioMenuGeometry(parametersMenu, { fullyVisible: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('AI 图片交互编辑教程使用本地媒体并完整支持响应式弹窗交互', async ({ page }) => {
  // 演示媒体是火山引擎官方素材，不随仓库分发；没有配置媒体目录时无法验证播放与布局。
  test.skip(!TUTORIAL_MEDIA_BASE_URL, '未设置 VITE_SEEDREAM_TUTORIAL_MEDIA_BASE_URL，跳过教程媒体用例');
  const runtimeErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' && message.location().url.includes(`${TUTORIAL_MEDIA_BASE_URL}/`)) {
      runtimeErrors.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app/ai-studio');
  await page.getByRole('tab', { name: 'AI 图片' }).click();

  const prompt = page.getByLabel('图片描述');
  const tutorialButton = page.getByRole('button', { name: '交互编辑教程', exact: true });
  await prompt.fill('保留教程打开前的图片草稿');
  await expect(tutorialButton).toBeVisible();

  const imageTaskRequestsBefore = await page.evaluate(() => (
    (window as any).__getApiRequestCount('POST /api/ai/image-tasks/batch')
  ));
  await tutorialButton.click();

  const dialog = page.getByRole('dialog', { name: 'Seedream 5.0 Pro 交互编辑教程' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('25.84 秒', { exact: true })).toHaveCount(0);
  const descriptionRegion = dialog.getByRole('region', { name: '功能描述' });
  await expect(descriptionRegion).toBeVisible();
  await expect(descriptionRegion.getByText('支持通过坐标、框选、箭头等多种方式指定编辑位置，精准编辑图片，实现局部元素替换、物品定位、区域生成等精细化操作。', { exact: true })).toBeVisible();

  const video = dialog.getByTestId('seedream-tutorial-video');
  const inputImage = dialog.getByRole('img', { name: '交互编辑输入图：狗与孔雀海报组合图' });
  const outputImage = dialog.getByRole('img', { name: '交互编辑输出图：狗被定位放入孔雀海报后的成品图' });
  await expect(video).toHaveAttribute('src', `${TUTORIAL_MEDIA_BASE_URL}/seedream-interactive-editing.mp4`);
  await expect(video).toHaveAttribute('poster', `${TUTORIAL_MEDIA_BASE_URL}/seedream-interactive-editing-poster.webp`);
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).toHaveAttribute('playsinline', '');
  await expect(video).toHaveAttribute('preload', 'metadata');
  await expect(inputImage).toHaveAttribute('src', `${TUTORIAL_MEDIA_BASE_URL}/seedream-interactive-input.webp`);
  await expect(outputImage).toHaveAttribute('src', `${TUTORIAL_MEDIA_BASE_URL}/seedream-interactive-output.webp`);
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
  expect(await video.evaluate(element => ({
    autoplay: (element as HTMLVideoElement).autoplay,
    paused: (element as HTMLVideoElement).paused,
    loop: (element as HTMLVideoElement).loop,
  }))).toEqual({ autoplay: false, paused: true, loop: false });
  const videoMetadata = await video.evaluate(element => ({
    duration: (element as HTMLVideoElement).duration,
    width: (element as HTMLVideoElement).videoWidth,
    height: (element as HTMLVideoElement).videoHeight,
  }));
  expect(videoMetadata.duration).toBeGreaterThan(25.7);
  expect(videoMetadata.duration).toBeLessThan(26);
  expect(videoMetadata.width).toBeGreaterThan(0);
  expect(videoMetadata.width).toBeLessThanOrEqual(1280);
  expect(videoMetadata.height).toBeGreaterThan(0);
  expect(videoMetadata.height).toBeLessThanOrEqual(720);
  await video.evaluate(element => (element as HTMLVideoElement).play());
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await video.evaluate(element => (element as HTMLVideoElement).pause());
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);

  const [videoBox, videoElementBox, descriptionBox, inputBox, outputBox] = await Promise.all([
    dialog.getByRole('region', { name: '演示视频' }).boundingBox(),
    video.boundingBox(),
    descriptionRegion.boundingBox(),
    inputImage.locator('xpath=ancestor::figure[1]').boundingBox(),
    outputImage.locator('xpath=ancestor::figure[1]').boundingBox(),
  ]);
  expect(videoBox).not.toBeNull();
  expect(videoElementBox).not.toBeNull();
  expect(descriptionBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(outputBox).not.toBeNull();
  expect(videoBox!.height).toBeLessThanOrEqual(videoElementBox!.height + 90);
  expect(descriptionBox!.y).toBeGreaterThanOrEqual(videoBox!.y + videoBox!.height - 2);
  expect(Math.abs(descriptionBox!.x - videoBox!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(descriptionBox!.width - videoBox!.width)).toBeLessThanOrEqual(2);
  expect(inputBox!.x).toBeGreaterThan(videoBox!.x + videoBox!.width - 2);
  expect(outputBox!.x).toBeGreaterThan(videoBox!.x + videoBox!.width - 2);
  expect(outputBox!.y).toBeGreaterThan(inputBox!.y + inputBox!.height - 2);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(tutorialButton).toBeFocused();
  await expect(prompt).toHaveValue('保留教程打开前的图片草稿');

  await tutorialButton.click();
  await dialog.getByRole('button', { name: '关闭交互编辑教程' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(tutorialButton).toBeFocused();

  await tutorialButton.click();
  await page.locator('[data-dialog-root="true"]').click({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
  await expect(tutorialButton).toBeFocused();

  await page.setViewportSize({ width: 375, height: 812 });
  await tutorialButton.click();
  await expect(dialog).toBeVisible();
  const mobileLayout = await dialog.evaluate(element => {
    const root = document.documentElement;
    const videoCard = element.querySelector('[aria-labelledby="seedream-tutorial-video-label"]');
    const descriptionCard = element.querySelector('[aria-labelledby="seedream-tutorial-description-label"]');
    const images = [...element.querySelectorAll('figure img')];
    const scrollArea = element.querySelector('[data-testid="seedream-tutorial-scroll-area"]');
    const videoRect = videoCard?.getBoundingClientRect();
    const descriptionRect = descriptionCard?.getBoundingClientRect();
    const imageRects = images.map(image => image.getBoundingClientRect());
    return {
      hasHorizontalOverflow: root.scrollWidth > root.clientWidth,
      scrollable: Boolean(scrollArea && scrollArea.scrollHeight > scrollArea.clientHeight),
      videoCardBottom: videoRect?.bottom ?? 0,
      descriptionTop: descriptionRect?.top ?? 0,
      descriptionBottom: descriptionRect?.bottom ?? 0,
      firstImageTop: imageRects[0]?.top ?? 0,
      firstImageBottom: imageRects[0]?.bottom ?? 0,
      secondImageTop: imageRects[1]?.top ?? 0,
    };
  });
  expect(mobileLayout.hasHorizontalOverflow).toBe(false);
  expect(mobileLayout.scrollable).toBe(true);
  expect(mobileLayout.descriptionTop).toBeGreaterThanOrEqual(mobileLayout.videoCardBottom - 2);
  expect(mobileLayout.firstImageTop).toBeGreaterThanOrEqual(mobileLayout.descriptionBottom - 2);
  expect(mobileLayout.secondImageTop).toBeGreaterThanOrEqual(mobileLayout.firstImageBottom - 2);
  await expect(dialog.getByRole('button', { name: '关闭交互编辑教程' })).toBeVisible();
  await dialog.getByTestId('seedream-tutorial-scroll-area').evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(outputImage).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(tutorialButton).toBeFocused();
  await expect(prompt).toHaveValue('保留教程打开前的图片草稿');
  await expect.poll(() => page.evaluate(() => (
    (window as any).__getApiRequestCount('POST /api/ai/image-tasks/batch')
  ))).toBe(imageTaskRequestsBefore);
  expect(runtimeErrors).toEqual([]);
});

test('AI 图片参考与标记工作台按容器宽度合并布局且教程不丢失草稿', async ({ page }) => {
  const extraReferenceNames = await page.evaluate(async () => (
    (window as any).__appendImageReferenceAssets(8)
  )) as string[];
  const referenceNames = ['参考商品图', '参考收尾图', ...extraReferenceNames];

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app/ai-studio');
  await page.getByRole('tab', { name: 'AI 图片' }).click();

  const workbench = page.getByTestId('image-reference-workbench');
  const tutorialButton = workbench.getByRole('button', { name: '交互编辑教程', exact: true });
  const chooseButton = workbench.getByRole('button', { name: '选择图片', exact: true });
  await expect(workbench.getByText('参考与标记', { exact: true })).toBeVisible();
  await expect(workbench.getByText('参考图片 0/10，顺序对应 @图片1～@图片10', { exact: true })).toBeVisible();
  await expect(tutorialButton).toBeVisible();
  await expect(chooseButton).toBeVisible();
  await expect(page.getByTestId('image-annotation-workspace')).toHaveCount(0);

  await chooseButton.click();
  let picker = page.getByRole('dialog', { name: '选择数字资产' });
  await picker.getByText(referenceNames[0]!, { exact: true }).click();
  await picker.getByRole('button', { name: /确认选择/ }).click();
  await expect(workbench.getByText('参考图片 1/10，顺序对应 @图片1～@图片10', { exact: true })).toBeVisible();
  await expect(tutorialButton).toBeVisible();

  await chooseButton.click();
  picker = page.getByRole('dialog', { name: '选择数字资产' });
  await expect(picker.getByRole('button', { name: '确认选择（1）' })).toBeVisible();
  for (const name of referenceNames.slice(1)) {
    await picker.getByText(name, { exact: true }).click();
  }
  await picker.getByRole('button', { name: '确认选择（10）' }).click();

  await expect(workbench.getByText('参考图片 10/10，顺序对应 @图片1～@图片10', { exact: true })).toBeVisible();
  const referenceList = page.getByTestId('image-reference-list');
  const annotationWorkspace = page.getByTestId('image-annotation-workspace');
  const referenceSummary = page.getByTestId('image-reference-summary');
  const activeReferenceLabel = page.getByTestId('image-active-reference');
  await expect(referenceList).toBeVisible();
  await expect(annotationWorkspace).toBeVisible();

  const firstReferenceButton = workbench.getByRole('button', { name: '选择图1：参考商品图', exact: true });
  const lastReferenceButton = workbench.getByRole('button', { name: '选择图10：布局参考图 10', exact: true });
  await expect(firstReferenceButton).toHaveAttribute('aria-pressed', 'true');
  await expect(lastReferenceButton).toHaveAttribute('aria-pressed', 'false');
  await lastReferenceButton.click();
  await expect(firstReferenceButton).toHaveAttribute('aria-pressed', 'false');
  await expect(lastReferenceButton).toHaveAttribute('aria-pressed', 'true');

  const wideBoxes = await Promise.all([
    referenceList.boundingBox(),
    annotationWorkspace.boundingBox(),
    workbench.getByText('参考与标记', { exact: true }).boundingBox(),
    tutorialButton.boundingBox(),
    chooseButton.boundingBox(),
  ]);
  const [wideListBox, wideWorkspaceBox, wideTitleBox, wideTutorialBox, wideChooseBox] = wideBoxes;
  if (!wideListBox || !wideWorkspaceBox || !wideTitleBox || !wideTutorialBox || !wideChooseBox) {
    throw new Error('宽屏参考与标记工作台未完成布局');
  }
  expect(wideListBox.x + wideListBox.width).toBeLessThanOrEqual(wideWorkspaceBox.x + 2);
  expect(Math.abs(wideListBox.y - wideWorkspaceBox.y)).toBeLessThanOrEqual(2);
  expect(wideTutorialBox.x).toBeGreaterThan(wideTitleBox.x + wideTitleBox.width);
  expect(wideTutorialBox.x + wideTutorialBox.width).toBeLessThanOrEqual(wideChooseBox.x + 1);
  expect(Math.abs(wideTutorialBox.y - wideChooseBox.y)).toBeLessThanOrEqual(2);
  expect(wideTutorialBox.y + wideTutorialBox.height).toBeLessThanOrEqual(wideListBox.y + 2);
  const [wideSummaryBox, wideActiveReferenceBox] = await Promise.all([
    referenceSummary.boundingBox(),
    activeReferenceLabel.boundingBox(),
  ]);
  if (!wideSummaryBox || !wideActiveReferenceBox) {
    throw new Error('宽屏当前参考图片字段未完成布局');
  }
  expect(wideActiveReferenceBox.y).toBeGreaterThanOrEqual(wideSummaryBox.y + wideSummaryBox.height - 1);
  const wideListOverflow = await referenceList.evaluate(element => ({
    overflowX: getComputedStyle(element).overflowX,
    overflowY: getComputedStyle(element).overflowY,
    hasVerticalOverflow: element.scrollHeight > element.clientHeight,
  }));
  expect(wideListOverflow.overflowY).toBe('auto');
  expect(wideListOverflow.hasVerticalOverflow).toBe(true);

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const wide = (await workbench.boundingBox())!.width >= 740;
    await expect.poll(async () => {
      const [listBox, workspaceBox] = await Promise.all([
        referenceList.boundingBox(),
        annotationWorkspace.boundingBox(),
      ]);
      return Boolean(listBox && workspaceBox && (wide
        ? listBox.x + listBox.width <= workspaceBox.x + 2
        : listBox.y + listBox.height <= workspaceBox.y + 2));
    }).toBe(true);

    const [listBox, workspaceBox, titleBox, tutorialBox, selectBox, summaryBox, activeReferenceBox] = await Promise.all([
      referenceList.boundingBox(),
      annotationWorkspace.boundingBox(),
      workbench.getByText('参考与标记', { exact: true }).boundingBox(),
      tutorialButton.boundingBox(),
      chooseButton.boundingBox(),
      referenceSummary.boundingBox(),
      activeReferenceLabel.boundingBox(),
    ]);
    if (!listBox || !workspaceBox || !titleBox || !tutorialBox || !selectBox || !summaryBox || !activeReferenceBox) {
      throw new Error(`${viewport.width}px 参考与标记工作台未完成布局`);
    }
    if (wide) {
      expect(listBox.x + listBox.width).toBeLessThanOrEqual(workspaceBox.x + 2);
      expect(Math.abs(listBox.y - workspaceBox.y)).toBeLessThanOrEqual(2);
      expect(tutorialBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
    } else {
      expect(listBox.y + listBox.height).toBeLessThanOrEqual(workspaceBox.y + 2);
      expect(tutorialBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
    }
    expect(Math.abs(tutorialBox.y - selectBox.y)).toBeLessThanOrEqual(2);
    expect(tutorialBox.x + tutorialBox.width).toBeLessThanOrEqual(selectBox.x + 1);
    expect(activeReferenceBox.y).toBeGreaterThanOrEqual(summaryBox.y + summaryBox.height - 1);
    const narrowState = await referenceList.evaluate(element => ({
      overflowX: getComputedStyle(element).overflowX,
      overflowY: getComputedStyle(element).overflowY,
      hasVerticalOverflow: element.scrollHeight > element.clientHeight,
      hasHorizontalOverflow: element.scrollWidth > element.clientWidth,
    }));
    if (wide) {
      expect(narrowState.overflowY).toBe('auto');
      expect(narrowState.hasVerticalOverflow).toBe(true);
    } else {
      expect(narrowState.overflowX).toBe('auto');
      expect(narrowState.hasHorizontalOverflow).toBe(true);
    }
    expect(await page.evaluate(() => ({
      document: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      body: document.body.scrollWidth <= document.body.clientWidth,
    }))).toEqual({ document: true, body: true });
  }

  const prompt = page.getByLabel('图片描述');
  await prompt.fill('打开教程后仍保留的工作台草稿');
  await tutorialButton.click();
  const dialog = page.getByRole('dialog', { name: 'Seedream 5.0 Pro 交互编辑教程' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(tutorialButton).toBeFocused();
  await expect(prompt).toHaveValue('打开教程后仍保留的工作台草稿');
  await expect(lastReferenceButton).toHaveAttribute('aria-pressed', 'true');
});

test('普通用户功能开关关闭后 TikTok 工作区只显示升级提示', async ({ page }) => {
  await page.evaluate(() => (window as any).__setFeatureFlags({ tiktokAccounts: false, tiktokPublish: false }));
  await page.goto('/login');
  await page.getByLabel('邮箱', { exact: true }).fill('member@lindyson.ai');
  await page.getByLabel('密码', { exact: true }).fill('mock123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await expect(page.getByRole('button', { name: '管理 TikTok 账号', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '管理 TikTok 账号', exact: true }).click();
  await expect(page.getByRole('heading', { name: '功能升级中' })).toBeVisible();
  await expect(page.getByText('此功能正在升级优化，请您耐心等待。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '管理TikTok账号' })).toHaveCount(0);
  await expect(page.getByText('@lindyson_official')).toHaveCount(0);

  await expect(page.getByRole('button', { name: '发布至 TikTok', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '发布至 TikTok', exact: true }).click();
  await expect(page.getByRole('heading', { name: '功能升级中' })).toBeVisible();
  await expect(page.getByText('此功能正在升级优化，请您耐心等待。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '发布至 TikTok 账号' })).toHaveCount(0);
  await expect(page.getByText('从数字资产选择素材')).toHaveCount(0);
});

test('管理员在功能开关关闭时仍可使用用户端 TikTok 工作区', async ({ page }) => {
  await page.evaluate(() => (window as any).__setFeatureFlags({ tiktokAccounts: false, tiktokPublish: false }));
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();

  await page.getByRole('button', { name: '管理 TikTok 账号', exact: true }).click();
  await expect(page.getByRole('heading', { name: '管理TikTok账号' })).toBeVisible();
  await expect(page.getByText('@lindyson_official')).toBeVisible();

  await page.getByRole('button', { name: '发布至 TikTok', exact: true }).click();
  await expect(page.getByRole('heading', { name: '发布至 TikTok 账号' })).toBeVisible();
  await expect(page.getByText('从数字资产选择素材')).toBeVisible();
});

test('后台TK Prompt Engine 1.0使用独立功能开关并保持二次确认', async ({ page }) => {
  await page.goto('/admin/feature-flags');

  const card = page.getByTestId('tk-prompt-engine-feature-card');
  const tkPromptEngineToggle = card.getByRole('switch', { name: '开放 TK Prompt Engine 1.0' });
  await expect(card.getByRole('heading', { name: 'TK Prompt Engine 1.0', exact: true })).toBeVisible();
  await expect(card.getByText('已开放', { exact: true })).toBeVisible();
  await expect(tkPromptEngineToggle).toBeChecked();
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/admin/feature-flags'))).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('GET /api/ai/consumption-settings'))).toBe(1);

  await tkPromptEngineToggle.click();
  let confirmDialog = page.getByRole('alertdialog', { name: '确认关闭 TK Prompt Engine 1.0？', exact: true });
  await expect(confirmDialog).toContainText('所有账号都无法新建TK1.0任务');
  await confirmDialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(tkPromptEngineToggle).toBeChecked();
  await expect(page.evaluate(() => (window as any).__getTkPromptEngineSettingsRequests())).resolves.toEqual([]);

  await tkPromptEngineToggle.click();
  confirmDialog = page.getByRole('alertdialog', { name: '确认关闭 TK Prompt Engine 1.0？', exact: true });
  await confirmDialog.getByRole('button', { name: '确认关闭', exact: true }).click();

  await expect(card.getByText('已关闭', { exact: true })).toBeVisible();
  await expect(tkPromptEngineToggle).not.toBeChecked();
  await expect(page.evaluate(() => (window as any).__getTkPromptEngineSettingsRequests())).resolves.toEqual([
    { available: false },
  ]);
});

test('后台TK Prompt Engine积分卡保存换整批积分并使用紧凑布局', async ({ page }) => {
  await page.setViewportSize({ width: 1340, height: 768 });
  await page.goto('/admin/consumption-settings');

  const card = page.getByTestId('tk-prompt-engine-credits-card');
  const heading = card.getByRole('heading', { name: 'TK Prompt Engine 1.0 整批生成积分', exact: true });
  const creditsInput = card.getByLabel('TK Prompt Engine整批生成积分');
  const saveButton = card.getByRole('button', { name: '保存积分', exact: true });
  await expect(heading).toBeVisible();
  await expect(card.getByText('首个成功的safe/native/creative三方案批次免费；这里设置后续每次“换一批”的整批积分消耗。', { exact: true })).toBeVisible();
  await expect(card.getByText('后续每次换一批三个方案', { exact: true })).toBeVisible();
  await expect(card.getByRole('switch')).toHaveCount(0);
  await expect(card.getByText('已开放', { exact: true })).toHaveCount(0);

  const headingBox = await heading.boundingBox();
  const inputBox = await creditsInput.boundingBox();
  const buttonBox = await saveButton.boundingBox();
  if (!headingBox || !inputBox || !buttonBox) throw new Error('TK Prompt Engine积分卡片未完成布局');
  expect(inputBox.x).toBeGreaterThan(headingBox.x + headingBox.width);
  expect(buttonBox.x).toBeGreaterThan(inputBox.x + inputBox.width);

  await creditsInput.fill('4');
  await saveButton.click();
  const confirmDialog = page.getByRole('alertdialog', { name: '确认修改TK Prompt Engine整批生成积分？', exact: true });
  await expect(confirmDialog).toContainText('从 1 调整为 4 积分');
  await confirmDialog.getByRole('button', { name: '确认保存', exact: true }).click();

  await expect(page.evaluate(() => (window as any).__getTkPromptEngineSettingsRequests())).resolves.toEqual([
    { generationCredits: 4 },
  ]);

  await page.goto('/admin/feature-flags');
  await expect(page.getByTestId('tk-prompt-engine-feature-card').getByRole('switch', { name: '开放 TK Prompt Engine 1.0' })).toBeChecked();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/consumption-settings');
  const mobileCard = page.getByTestId('tk-prompt-engine-credits-card');
  const mobileHeadingBox = await mobileCard.getByRole('heading', { name: 'TK Prompt Engine 1.0 整批生成积分', exact: true }).boundingBox();
  const mobileInputBox = await mobileCard.getByLabel('TK Prompt Engine整批生成积分').boundingBox();
  const mobileButtonBox = await mobileCard.getByRole('button', { name: '保存积分', exact: true }).boundingBox();
  if (!mobileHeadingBox || !mobileInputBox || !mobileButtonBox) throw new Error('移动端TK Prompt Engine积分卡片未完成布局');
  expect(mobileInputBox.y).toBeGreaterThan(mobileHeadingBox.y + mobileHeadingBox.height);
  expect(mobileButtonBox.y).toBeGreaterThan(mobileInputBox.y + mobileInputBox.height);
});

test('后台消费设置展示 2.5 的 25 秒双档价格并按能力表原子暂停 12 个组合', async ({ page }) => {
  await page.evaluate(input => (window as any).__setVideoConsumptionConfiguration(input), {
    items: seedance25ConsumptionRows(),
    videoModels: [seedance25Capability()],
  });
  await page.goto('/admin/consumption-settings');

  await expect(page.getByText('12/12 已开放', { exact: true })).toBeVisible();
  const setting25s480p = page.getByRole('row')
    .filter({ has: page.getByText('Seedance 2.5', { exact: true }) })
    .filter({ has: page.getByText('25s', { exact: true }) })
    .filter({ has: page.getByText('480p', { exact: true }) });
  await expect(setting25s480p).toContainText('179');
  await expect(setting25s480p).toContainText('108');

  await page.getByRole('button', { name: '全部暂停', exact: true }).click();
  const confirmDialog = page.getByRole('alertdialog', { name: '全量暂停 Seedance 2.5？', exact: true });
  await expect(confirmDialog).toContainText('全部 12 个组合');
  await confirmDialog.getByRole('button', { name: '确认全量暂停', exact: true }).click();

  await expect(page.getByText('Seedance 2.5 已全量暂停', { exact: true })).toBeVisible();
  await expect(page.getByText('0/12 已开放', { exact: true })).toBeVisible();
});

test('用户端 AI Studio、联系客服和数字资产关键交互可用', async ({ page }) => {
  await page.addInitScript(() => {
    window.__assetDownloadClicks = [];
    window.__assetDownloadNames = [];
    window.__assetDownloadTargets = [];
    HTMLAnchorElement.prototype.click = function () {
      window.__assetDownloadClicks.push(this.href);
      window.__assetDownloadNames.push(this.download);
      window.__assetDownloadTargets.push(this.target);
    };
  });
  const brandPreviewUrl = `https://cdn.example.com/${assetBrandId}.mp4`;
  const heldBrandPreview = await holdMediaRequest(page, brandPreviewUrl);
  await page.evaluate((items) => (window as any).__setGenerationTasks(items), [{
    ...job('管理员', 'admin@lindyson.ai'),
    assetId: 'asset-brand',
    assetName: '品牌故事视频',
    assetSource: 'ai-video',
  }]);
  await page.goto('/app');

  await page.getByRole('button', { name: 'AI Studio', exact: true }).click();
  await expect(page.getByRole('button', { name: /生成视频 · \d+ 积分/ })).toBeVisible();

  await page.getByRole('button', { name: /联系客服/ }).click();
  await expect(page.getByRole('heading', { name: '联系客服' })).toBeVisible();
  await expect(page.getByText('Lindyson AI 客服')).toBeVisible();
  await page.getByRole('tab', { name: '提交问题' }).click();
  await page.getByLabel('问题标题').fill('生成问题咨询');
  await page.getByLabel('问题描述').fill('生成任务状态需要人工协助确认。');
  await page.getByRole('button', { name: '提交问题' }).click();
  await expect(page.getByRole('heading', { name: '联系客服' })).toBeVisible();
  await expect(page.getByText('生成任务状态需要人工协助确认。').first()).toBeVisible();
  await page.getByLabel('关闭客服窗口').click();

  await page.getByRole('button', { name: '数字资产', exact: true }).click();
  const initialBrandName = '品牌故事视频';
  const brandCard = page.getByText(initialBrandName, { exact: true }).first().locator('xpath=ancestor::article[1]');
  await expect(brandCard.getByText('2026-06-30', { exact: true })).toBeVisible();
  await expect(brandCard.getByText('15s', { exact: true })).toBeVisible();
  await expect(brandCard.getByRole('button', { name: `下载素材 ${initialBrandName}` })).toBeVisible();
  await expect(brandCard.getByRole('button', { name: `更多操作：${initialBrandName}` })).toBeVisible();
  await expect(brandCard.getByLabel(/尚未下载|已下载/)).toHaveCount(0);
  const downloadPagePath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: `下载素材 ${initialBrandName}` }).click();
  await expect.poll(() => page.evaluate(() => window.__assetDownloadClicks.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__assetDownloadClicks.at(-1))).toMatch(/asset-brand\.mp4$/);
  await expect.poll(() => page.evaluate(() => window.__assetDownloadNames.at(-1))).toBe('品牌故事视频.mp4');
  await expect.poll(() => page.evaluate(() => window.__assetDownloadTargets.at(-1))).toBe('');
  expect(new URL(page.url()).pathname).toBe(downloadPagePath);

  await page.getByRole('button', { name: '打开素材 品牌故事视频' }).click();
  await expect(page.getByRole('heading', { name: '素材预览' })).toBeVisible();
  const userAssetPreviewCard = page.getByRole('dialog').locator('[data-ui="card"][data-variant="modal"]');
  await expect(userAssetPreviewCard).toHaveAttribute('data-backdrop-blur', 'false');
  expect(await userAssetPreviewCard.evaluate(element => getComputedStyle(element).backdropFilter)).toBe('none');
  const previewVideo = page.getByLabel('视频预览 品牌故事视频');
  const videoFallback = page.getByText('视频暂时无法播放');
  await expect(previewVideo).toBeVisible();
  await expect.poll(() => heldBrandPreview.requestedUrls).toContain(brandPreviewUrl);
  const previewVideoState = await previewVideo.evaluate((video: HTMLVideoElement) => ({
    controls: video.controls,
    src: video.getAttribute('src'),
  }));
  expect(previewVideoState).toEqual({ controls: true, src: brandPreviewUrl });
  heldBrandPreview.release();
  await expect(videoFallback).toBeVisible();
  await expect(page.getByRole('heading', { name: '原始参考素材' })).toBeVisible();
  await expect(page.getByText('过期参考图')).toBeVisible();
  await expect(page.getByText('参考图片').first()).toBeVisible();
  await page.getByRole('button', { name: '下载素材', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__assetDownloadClicks.length)).toBe(2);
  const updatedBrandName = '品牌故事视频确认保存';
  const namePatchCountBefore = await page.evaluate(
    id => (window as any).__getApiRequestCount(`PATCH /api/assets/${id}`),
    assetBrandId,
  );
  const nameInput = page.getByRole('textbox', { name: '素材名称' });
  await nameInput.fill(updatedBrandName);
  await expect.poll(() => page.evaluate(
    id => (window as any).__getApiRequestCount(`PATCH /api/assets/${id}`),
    assetBrandId,
  )).toBe(namePatchCountBefore);
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect.poll(() => page.evaluate(
    id => (window as any).__getApiRequestCount(`PATCH /api/assets/${id}`),
    assetBrandId,
  )).toBe(namePatchCountBefore + 1);
  await expect(nameInput).toHaveValue(updatedBrandName);
  await expect(page.getByRole('heading', { name: '素材预览' })).toBeVisible();
  await page.getByRole('button', { name: '关闭素材预览' }).click();
  await expect(page.getByRole('heading', { name: '素材预览' })).toBeHidden();

  await page.getByRole('button', { name: 'AI Studio', exact: true }).click();
  const completedQueueItem = page.locator('div.group').filter({ hasText: 'Seedance 2.0' }).filter({ hasText: '完成' }).first();
  await expect(completedQueueItem).toBeVisible();
  await completedQueueItem.hover();
  await completedQueueItem.getByTitle('下载').click();
  await expect.poll(() => page.evaluate(() => window.__assetDownloadClicks.length)).toBe(3);
  await page.getByRole('button', { name: '数字资产', exact: true }).click();

  await page.getByRole('tab', { name: '已上传图片' }).click();
  const uploadedImageCard = page.getByText('参考商品图', { exact: true }).first().locator('xpath=ancestor::article[1]');
  await expect(uploadedImageCard.getByText('2026-07-01', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开素材 参考商品图' }).click();
  await expect(page.getByAltText('图片预览 参考商品图')).toBeVisible();
  await page.getByRole('button', { name: '关闭素材预览' }).click();
  await expect(page.getByRole('heading', { name: '素材预览' })).toBeHidden();

  await page.getByRole('tab', { name: '已上传音频' }).click();
  const uploadedAudioCard = page.getByText('参考配乐', { exact: true }).first().locator('xpath=ancestor::article[1]');
  await expect(uploadedAudioCard.getByText('15s', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开素材 参考配乐' }).click();
  await expect(page.getByLabel('音频预览 参考配乐')).toBeVisible();
  await expect(page.getByText('已上传音频', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: '关闭素材预览' }).click();
  await expect(page.getByRole('heading', { name: '素材预览' })).toBeHidden();

  await page.getByRole('tab', { name: 'AI视频' }).click();
  const updatedBrandCard = page.getByRole('button', { name: `打开素材 ${updatedBrandName}` }).locator('xpath=ancestor::article[1]');
  await updatedBrandCard.getByRole('button', { name: `下载素材 ${updatedBrandName}` }).click();
  await expect.poll(() => page.evaluate(() => window.__assetDownloadClicks.length)).toBeGreaterThan(0);

  await page.getByRole('button', { name: '批量操作' }).click();
  const brandSelectionButton = page.getByRole('button', { name: `选择素材 ${updatedBrandName}` });
  await expect(brandSelectionButton).toHaveAttribute('aria-pressed', 'false');
  await brandSelectionButton.click();
  await expect(brandSelectionButton).toHaveAttribute('aria-pressed', 'true');
  await brandSelectionButton.click();
  await expect(brandSelectionButton).toHaveAttribute('aria-pressed', 'false');
  await brandSelectionButton.click();
  await expect(page.getByText('已选择 1 个', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '选择目标文件夹' }).click();
  await page.getByRole('option', { name: '产品发布' }).click();
  await page.getByRole('button', { name: '移动' }).click();
  await expect(page.getByRole('heading', { name: '批量移动素材' })).toBeVisible();
  await page.getByRole('button', { name: '确认移动' }).click();
  await expect(page.getByText(updatedBrandName)).toHaveCount(0);

  await page.getByRole('button', { name: /^打开文件夹 产品发布，/ }).click();
  await expect(page.getByText(updatedBrandName, { exact: true }).first()).toBeVisible();
  const unavailableAssetCard = page.getByText('产品发布宣传片', { exact: true }).first().locator('xpath=ancestor::article[1]');
  const unavailableAssetClickCount = await page.evaluate(() => window.__assetDownloadClicks.length);
  await unavailableAssetCard.getByRole('button', { name: '下载素材 产品发布宣传片' }).click();
  await expect.poll(() => page.evaluate(() => window.__assetDownloadClicks.length)).toBe(unavailableAssetClickCount + 1);
  await expect.poll(() => page.evaluate(() => window.__assetDownloadClicks.at(-1))).toMatch(/asset-product\.mp4$/);
  await expect(unavailableAssetCard.getByLabel(/尚未下载|已下载/)).toHaveCount(0);

  await page.getByRole('button', { name: `打开素材 ${updatedBrandName}` }).click();
  await page.getByRole('combobox', { name: '所在文件夹' }).click();
  await page.getByRole('option', { name: '产品发布' }).click();
  await page.getByRole('combobox', { name: '所在文件夹' }).click();
  await page.getByRole('option', { name: '主目录' }).click();
  await expect.poll(() => page.evaluate(
    id => (window as any).__getApiRequestCount(`PATCH /api/assets/${id}`),
    assetBrandId,
  )).toBe(namePatchCountBefore + 2);
  await page.getByRole('button', { name: '关闭素材预览' }).click();
  await expect(page.getByText(updatedBrandName)).toHaveCount(0);
  await page.getByRole('button', { name: /^选择主目录，/ }).click();
  await expect(page.getByText(updatedBrandName, { exact: true }).first()).toBeVisible();

  const tutorialCard = page.getByText('教程演示视频', { exact: true }).first().locator('xpath=ancestor::article[1]');
  const tutorialDownloadClickCount = await page.evaluate(() => window.__assetDownloadClicks.length);
  await expect(tutorialCard.getByLabel(/尚未下载|已下载/)).toHaveCount(0);
  await tutorialCard.getByRole('button', { name: '下载素材 教程演示视频' }).click();
  await expect.poll(() => page.evaluate(() => window.__assetDownloadClicks.length)).toBe(tutorialDownloadClickCount + 1);
  await expect.poll(() => page.evaluate(() => window.__assetDownloadClicks.at(-1))).toMatch(/asset-tutorial\.mp4$/);
  await expect(tutorialCard.getByRole('button', { name: '更多操作：教程演示视频' })).toBeVisible();

  await page.getByRole('button', { name: '批量操作' }).click();
  await page.getByRole('button', { name: '选择素材 教程演示视频' }).click();
  await page.getByRole('button', { name: '删除' }).click();
  await expect(page.getByRole('heading', { name: '批量删除素材' })).toBeVisible();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText('教程演示视频')).toHaveCount(0);
});

test('工单支持后台回复、用户端未读提示和继续对话', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: '工单管理' }).click();
  await page.getByRole('button', { name: '回复' }).first().click();
  await expect(page.getByText('回复记录')).toBeVisible();
  await page.getByLabel('回复用户').fill('后台已确认，任务积分已处理。');
  await page.getByRole('button', { name: '发送回复' }).click();
  await expect(page.locator('p').filter({ hasText: '后台已确认，任务积分已处理。' }).last()).toBeVisible();
  await page.getByLabel('关闭详情').click();
  await page.getByRole('button', { name: '返回用户端' }).click();

  const supportButton = page.getByRole('button', { name: /联系客服/ });
  await expect(supportButton.getByText('1')).toBeVisible();
  await supportButton.click();
  await expect(page.locator('p').filter({ hasText: '后台已确认，任务积分已处理。' }).last()).toBeVisible();
  await expect(supportButton.getByText('1')).toHaveCount(0);

  await page.getByPlaceholder('继续补充问题或回复客服').fill('谢谢，我这边再确认一次。');
  await page.getByRole('button', { name: '发送回复' }).click();
  await expect(page.locator('p').filter({ hasText: '谢谢，我这边再确认一次。' }).last()).toBeVisible();
});

test('用户端工单已读失败不影响消息展示且重新打开会重试', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.evaluate(() => (window as any).__prepareTicketReadFailure({ surface: 'user', failures: 1 }));
  await page.goto('/app');

  const supportButton = page.getByRole('button', { name: /联系客服/ });
  await expect(supportButton.getByText('1')).toBeVisible();
  await supportButton.click();
  await expect(page.getByTestId('support-ticket-message-list').getByText('客服回复仍应正常展示。', { exact: true })).toBeVisible();
  await expect(page.getByText('工单已读状态更新失败，稍后重新打开将自动重试', { exact: true })).toBeVisible();
  await expect(supportButton.getByText('1')).toBeVisible();
  await page.getByLabel('关闭客服窗口').click();

  const readRoute = `POST /api/support/tickets/${mockUuid('ticket-1')}/read`;
  await expect.poll(() => page.evaluate(
    key => (window as any).__getApiRequestCount(key),
    readRoute,
  )).toBe(1);
  await supportButton.click();
  await expect.poll(() => page.evaluate(
    key => (window as any).__getApiRequestCount(key),
    readRoute,
  )).toBe(2);
  await expect(supportButton.getByText('1')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('快速切换用户工单时延迟响应不会回写到新工单', async ({ page }) => {
  await page.evaluate(() => (window as any).__prepareTicketSwitchScenario());
  await page.goto('/app');
  await page.getByRole('button', { name: /联系客服/ }).click();

  await page.getByRole('button', { name: /快工单/ }).click();
  await expect(page.locator('p').filter({ hasText: '快速工单消息' }).last()).toBeVisible();
  await page.waitForTimeout(1_200);
  await expect(page.getByTestId('support-ticket-message-list').getByText('慢速工单消息', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('support-ticket-message-list').getByText('快速工单消息', { exact: true })).toBeVisible();
});

test('后台工单已读失败被捕获且不遮断回复记录', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.evaluate(() => (window as any).__prepareTicketReadFailure({ surface: 'admin', failures: 1 }));
  await page.goto('/admin/tickets');
  await page.getByRole('button', { name: '回复' }).first().click();

  await expect(page.getByTestId('admin-ticket-message-list').getByText('用户消息仍应正常展示。', { exact: true })).toBeVisible();
  await expect(page.getByText('工单已读状态更新失败，稍后重新打开将自动重试', { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('管理后台工单对话关闭需要二次确认', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: '工单管理' }).click();
  await page.getByRole('button', { name: '回复' }).first().click();

  await page.getByRole('button', { name: '关闭工单' }).click();
  await expect(page.getByRole('heading', { name: '确认关闭工单？' })).toBeVisible();
  await expect(page.getByText('关闭后用户和管理员都不能继续回复。')).toBeVisible();
  await expect(page.getByText('工单已关闭，回复区域只读。')).toHaveCount(0);

  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('heading', { name: '确认关闭工单？' })).toHaveCount(0);
  await expect(page.getByLabel('回复用户')).toBeVisible();

  await page.getByRole('button', { name: '关闭工单' }).click();
  await expect(page.getByRole('heading', { name: '确认关闭工单？' })).toBeVisible();
  await page.getByRole('button', { name: '关闭工单' }).last().click();
  await expect(page.getByText('工单已关闭', { exact: true })).toBeVisible();
  await expect(page.getByText('工单已关闭，回复区域只读。')).toBeVisible();
});

test('工单聊天弹窗只在回复记录区域滚动', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: '工单管理' }).click();
  await page.getByRole('button', { name: '回复' }).first().click();

  const adminModalBody = page.getByTestId('admin-detail-fixed-body');
  const adminMessageList = page.getByTestId('admin-ticket-message-list');
  await expect(adminModalBody).toBeVisible();
  const adminModalHeight = await adminModalBody.evaluate(element => (element as HTMLElement).offsetHeight);

  for (let index = 1; index <= 8; index += 1) {
    const body = `后台滚动验证消息 ${index}`;
    await page.getByLabel('回复用户').fill(body);
    await page.getByRole('button', { name: '发送回复' }).click();
    await expect(page.locator('p').filter({ hasText: body }).last()).toBeVisible();
  }

  await expect.poll(() => adminMessageList.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(page.getByLabel('回复用户')).toBeVisible();
  await expect(page.getByRole('button', { name: '发送回复' })).toBeVisible();
  await expect(page.locator('p').filter({ hasText: '后台滚动验证消息 8' }).last()).toBeVisible();
  const adminModalHeightAfterMessages = await adminModalBody.evaluate(element => (element as HTMLElement).offsetHeight);
  expect(Math.abs(adminModalHeightAfterMessages - adminModalHeight)).toBeLessThan(2);

  await page.getByLabel('关闭详情').click();
  await page.getByRole('button', { name: '返回用户端' }).click();

  const supportButton = page.getByRole('button', { name: /联系客服/ });
  await expect(supportButton.getByText('1')).toBeVisible();
  await supportButton.click();

  const supportModal = page.getByTestId('support-modal-card');
  const supportMessageList = page.getByTestId('support-ticket-message-list');
  await expect(supportModal).toBeVisible();
  await expect.poll(() => supportModal.evaluate(element => (element as HTMLElement).offsetHeight)).toBeGreaterThan(660);
  if (SUPPORT_QR_CONFIGURED) await expect(page.getByAltText('飞书联系二维码')).toBeVisible();
  else await expect(page.getByAltText('飞书联系二维码')).toHaveCount(0);
  await expect.poll(() => supportMessageList.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  const supportModalHeight = await supportModal.evaluate(element => (element as HTMLElement).offsetHeight);

  await page.getByPlaceholder('继续补充问题或回复客服').fill('用户端滚动验证回复');
  await page.getByRole('button', { name: '发送回复' }).click();
  await expect(page.locator('p').filter({ hasText: '用户端滚动验证回复' }).last()).toBeVisible();
  await expect(page.getByPlaceholder('继续补充问题或回复客服')).toBeVisible();
  await expect(page.getByRole('button', { name: '发送回复' })).toBeVisible();
  const supportModalHeightAfterReply = await supportModal.evaluate(element => (element as HTMLElement).offsetHeight);
  expect(Math.abs(supportModalHeightAfterReply - supportModalHeight)).toBeLessThan(2);
});

test('用户端工单弹窗窄屏下保持消息区独立滚动', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/app');
  await page.getByRole('button', { name: '打开导航菜单' }).click();
  await page.getByRole('button', { name: /联系客服/ }).click();

  const supportModal = page.getByTestId('support-modal-card');
  const supportMessageList = page.getByTestId('support-ticket-message-list');
  await expect(supportModal).toBeVisible();

  for (let index = 1; index <= 8; index += 1) {
    const body = `窄屏滚动验证 ${index}`;
    await page.getByPlaceholder('继续补充问题或回复客服').fill(body);
    await page.getByRole('button', { name: '发送回复' }).click();
    await expect(page.locator('p').filter({ hasText: body }).last()).toBeVisible();
  }

  await expect.poll(() => supportMessageList.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(page.getByPlaceholder('继续补充问题或回复客服')).toBeVisible();
  await expect(page.getByRole('button', { name: '发送回复' })).toBeVisible();
  const supportModalBox = await supportModal.boundingBox();
  if (!supportModalBox) throw new Error('窄屏客服弹窗未能完成渲染');
  expect(supportModalBox.height).toBeLessThanOrEqual(760);
});

for (const count of [0, 1, 6, 7, 9, 12, 13]) {
  test(`客服工单每页六条：${count} 条的总数、页数和四向翻页正确`, async ({ page }) => {
    await page.evaluate(count => (window as any).__prepareTicketPaginationScenario(count), count);
    const requests: URL[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/api/support/tickets' && request.method() === 'GET') requests.push(url);
    });
    await page.goto('/app/account-center');
    await page.getByRole('button', { name: /联系客服/ }).click();
    const modal = page.getByTestId('support-modal-card');
    const pager = modal.getByRole('navigation', { name: '我的工单翻页' });
    const cards = modal.getByRole('button', { name: /^分页工单 / });
    if (count === 0) {
      await expect(modal.getByText('暂无工单', { exact: true })).toBeVisible();
      await expect(pager).toHaveCount(0);
    } else if (count <= 6) {
      await expect(cards).toHaveCount(count);
      await expect(pager).toHaveCount(0);
    } else {
      const pages = Math.ceil(count / 6);
      const seen: string[] = [];
      for (let currentPage = 1; currentPage <= pages; currentPage += 1) {
        await expect(pager.getByRole('status', { name: `第 ${currentPage} 页，共 ${pages} 页` })).toBeVisible();
        const pageCount = Math.min(6, count - (currentPage - 1) * 6);
        await expect(cards).toHaveCount(pageCount);
        seen.push(...await cards.locator('p:first-child').allTextContents());
        if (currentPage < pages) await pager.getByRole('button', { name: '下一页', exact: true }).click();
      }
      expect(seen).toEqual(Array.from({ length: count }, (_, index) => `分页工单 ${index + 1}`));
      await expect(pager.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
      await pager.getByRole('button', { name: '上一页', exact: true }).click();
      await expect(pager.getByRole('status', { name: `第 ${pages - 1} 页，共 ${pages} 页` })).toBeVisible();
      await pager.getByRole('button', { name: '尾页', exact: true }).click();
      await expect(pager.getByRole('status', { name: `第 ${pages} 页，共 ${pages} 页` })).toBeVisible();
      await pager.getByRole('button', { name: '首页', exact: true }).click();
      await expect(pager.getByRole('status', { name: `第 1 页，共 ${pages} 页` })).toBeVisible();
      await expect(pager.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
    }
    await expect(modal.locator('.pagination-summary')).toHaveCount(0);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(url => url.searchParams.get('limit') === '6')).toBe(true);
  });
}

for (const initialCount of [0, 6, 9]) {
  test(`客服工单新增后同步首页和总数：初始 ${initialCount} 条`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(count => (window as any).__prepareTicketPaginationScenario(count), initialCount);
    await page.goto('/app/account-center');
    await page.getByRole('button', { name: /联系客服/ }).click();
    const modal = page.getByTestId('support-modal-card');
    const pager = modal.getByRole('navigation', { name: '我的工单翻页' });
    if (initialCount > 6) {
      await pager.getByRole('button', { name: '尾页', exact: true }).click();
      await expect(pager.getByRole('status', { name: '第 2 页，共 2 页' })).toBeVisible();
    } else if (initialCount > 0) {
      await expect(modal.getByRole('button', { name: /^分页工单 / })).toHaveCount(initialCount);
    } else {
      await expect(modal.getByText('暂无工单', { exact: true })).toBeVisible();
    }
    const freshRequests: URL[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/api/support/tickets' && request.method() === 'GET') freshRequests.push(url);
    });
    // 连续创建三条，覆盖原问题中总数停留在旧值的场景。
    const creates = initialCount === 6 ? 3 : 1;
    for (let index = 1; index <= creates; index += 1) {
      await modal.getByRole('tab', { name: '提交问题' }).click();
      await modal.getByLabel('问题标题').fill(`新增分页工单 ${index}`);
      await modal.getByLabel('问题描述').fill(`新增会话内容 ${index}`);
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/support/tickets' && response.request().method() === 'GET' && response.ok());
      await modal.getByRole('button', { name: '提交问题', exact: true }).click();
      const total = initialCount + index;
      expect((await (await refreshed).json()).pagination.totalItems).toBe(total);
      await expect(modal.getByRole('button', { name: new RegExp(`^新增分页工单 ${index} `) })).toBeVisible();
      await expect(modal.locator('.pagination-summary')).toHaveCount(0);
      await expect(modal.getByTestId('support-ticket-message-list')).toContainText(`新增会话内容 ${index}`);
      const list = modal.locator('.pagination-footer').locator('..');
      await expect(list.locator(':scope > button')).toHaveCount(Math.min(6, total));
      if (total > 6) await expect(pager.getByRole('status', { name: `第 1 页，共 ${Math.ceil(total / 6)} 页` })).toBeVisible();
    }
    expect(freshRequests).toHaveLength(creates);
    expect(freshRequests.every(url => url.searchParams.get('position') === 'first' && !url.searchParams.has('snapshotCursor') && !url.searchParams.has('cursor'))).toBe(true);
    if (initialCount === 6) await page.screenshot({ path: testInfo.outputPath('support-six-per-page.png') });
  });
}

test('客服工单创建成功但列表刷新失败时保留会话且只重试列表', async ({ page }) => {
  await page.evaluate(() => (window as any).__prepareTicketPaginationScenario(9));
  await page.goto('/app/account-center');
  await page.getByRole('button', { name: /联系客服/ }).click();
  const modal = page.getByTestId('support-modal-card');
  const pager = modal.getByRole('navigation', { name: '我的工单翻页' });
  await pager.getByRole('button', { name: '尾页', exact: true }).click();
  await expect(pager.getByRole('status', { name: '第 2 页，共 2 页' })).toBeVisible();
  let createRequests = 0;
  let failLists = true;
  let releaseList!: () => void;
  const listGate = new Promise<void>(resolve => { releaseList = resolve; });
  await page.route('**/api/support/tickets?*', async route => {
    await listGate;
    if (failLists) await route.fulfill({ status: 503, json: { message: '列表暂时不可用', code: 'SERVICE_UNAVAILABLE', requestId: 'support-list-retry' } });
    else await route.fallback();
  });
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/support/tickets' && request.method() === 'POST') createRequests += 1;
  });
  await modal.getByRole('tab', { name: '提交问题' }).click();
  await modal.getByLabel('问题标题').fill('已创建待刷新');
  await modal.getByLabel('问题描述').fill('重试不应重复提交此工单');
  await modal.getByRole('button', { name: '提交问题', exact: true }).click();
  try {
    await expect(modal.getByTestId('support-ticket-message-list')).toContainText('重试不应重复提交此工单');
    await expect(pager).toHaveAttribute('aria-busy', 'true');
    for (const name of ['首页', '上一页', '下一页', '尾页']) await expect(pager.getByRole('button', { name, exact: true })).toBeDisabled();
  } finally {
    releaseList();
  }
  await expect(modal.getByRole('alert')).toContainText('工单已创建，列表刷新失败，请重试');
  await expect(modal.getByTestId('support-ticket-message-list')).toContainText('重试不应重复提交此工单');
  failLists = false;
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/support/tickets' && response.request().method() === 'GET' && response.ok());
  await modal.getByRole('button', { name: '重试加载', exact: true }).click();
  expect((await (await refreshed).json()).pagination.totalItems).toBe(10);
  await expect(modal.locator('.pagination-footer').locator('..').locator(':scope > button')).toHaveCount(6);
  await expect(modal.locator('.pagination-summary')).toHaveCount(0);
  await expect(pager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  await expect(modal.getByRole('alert')).toHaveCount(0);
  await expect(modal.getByTestId('support-ticket-message-list')).toContainText('重试不应重复提交此工单');
  expect(createRequests).toBe(1);
});

test('客服工单创建失败时保留表单且不改变列表总数', async ({ page }) => {
  await page.evaluate(() => (window as any).__prepareTicketPaginationScenario(6));
  await page.goto('/app/account-center');
  await page.getByRole('button', { name: /联系客服/ }).click();
  const modal = page.getByTestId('support-modal-card');
  await expect(modal.getByRole('button', { name: /^分页工单 / })).toHaveCount(6);
  await page.route('**/api/support/tickets', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { message: '工单创建暂时不可用', code: 'SERVICE_UNAVAILABLE', requestId: 'support-create-failed' } })
    : route.fallback());
  await modal.getByRole('tab', { name: '提交问题' }).click();
  await modal.getByLabel('问题标题').fill('创建失败保留内容');
  await modal.getByLabel('问题描述').fill('不应丢失的描述');
  await modal.getByRole('button', { name: '提交问题', exact: true }).click();
  await expect(page.getByText('工单创建暂时不可用', { exact: true })).toBeVisible();
  await expect(modal.getByLabel('问题标题')).toHaveValue('创建失败保留内容');
  await expect(modal.getByLabel('问题描述')).toHaveValue('不应丢失的描述');
  await modal.getByRole('tab', { name: '我的工单' }).click();
  await expect(modal.getByRole('navigation', { name: '我的工单翻页' })).toHaveCount(0);
  await expect(modal.locator('.pagination-summary')).toHaveCount(0);
  await expect(modal.getByRole('button', { name: /^分页工单 / })).toHaveCount(6);
});

test('客服轻量分页隐藏数量、单页隐藏导航、多页居中且禁用按钮透明', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app/account-center');
  await page.getByRole('button', { name: /联系客服/ }).click();
  const modal = page.getByTestId('support-modal-card');
  const footer = modal.locator('.pagination-footer');
  const pager = modal.getByRole('navigation', { name: '我的工单翻页' });
  await expect(modal.getByRole('button', { name: /^生成问题咨询 / })).toBeVisible();
  await expect(footer.locator('.pagination-summary')).toHaveCount(0);
  await expect(pager).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('support-single-page.png') });

  await page.getByRole('button', { name: '关闭客服窗口' }).click();
  await page.evaluate(async () => {
    await (window as any).__prepareTicketSwitchScenario();
    await (window as any).__setCursorPageSizeCap(1);
  });
  await page.reload();
  await page.getByRole('button', { name: /联系客服/ }).click();
  await expect(pager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  await expect(footer.locator('.pagination-summary')).toHaveCount(0);
  const controls = await pager.locator('[role="group"]').boundingBox();
  const footerBox = await footer.boundingBox();
  expect(controls!.x).toBeGreaterThanOrEqual(footerBox!.x);
  expect(controls!.x + controls!.width).toBeLessThanOrEqual(footerBox!.x + footerBox!.width + 1);
  expect(Math.abs(controls!.x + controls!.width / 2 - footerBox!.x - footerBox!.width / 2)).toBeLessThan(2);
  const disabledBackground = await pager.getByRole('button', { name: '首页', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor);
  expect(disabledBackground).toBe('rgba(0, 0, 0, 0)');
  await expect(page.getByTestId('support-ticket-message-list').getByText('慢速工单消息', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('support-multiple-pages.png') });
  await pager.getByRole('button', { name: '下一页' }).focus();
  await expect(pager.getByText('下一页', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(pager.getByRole('status', { name: '第 2 页，共 2 页' })).toBeVisible();
});

test('分页页脚以容器宽度切换布局并支持长页码', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepareMultiPageOrders(page);
  await page.goto('/admin/orders');
  const footer = page.locator('[data-ui="admin-table-pagination"]').first();
  const content = footer.locator('.pagination-footer-content');
  const pager = footer.getByRole('navigation');
  await expect(pager).toBeVisible();
  await expect(content).toHaveCSS('flex-direction', 'row');
  await page.screenshot({ path: testInfo.outputPath('admin-pagination.png') });
  for (const width of [419, 420]) {
    await footer.evaluate((element, width) => {
      element.style.width = `${width}px`;
      element.style.paddingInline = '0';
    }, width);
    await expect(content).toHaveCSS('flex-direction', width < 420 ? 'column' : 'row');
  }
  // 仅将展示文本替换成长页码，验证真实页脚的排版，不改变分页请求。
  await footer.evaluate(element => { element.style.width = '260px'; });
  await pager.locator('.pagination-page-numbers').evaluate(element => { element.textContent = '9999 / 10000'; });
  const bounds = await footer.evaluate(element => {
    const controls = element.querySelector('.pagination-controls')!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return { left: controls.left - box.left, right: box.right - controls.right, fits: element.scrollWidth <= element.clientWidth };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeGreaterThanOrEqual(0);
  expect(bounds.fits).toBe(true);
});

test.describe('触屏轻量分页', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('分页按钮保持 44px 点击区域且页脚不溢出', async ({ page }, testInfo) => {
    await prepareMultiPageOrders(page);
    await page.goto('/admin/orders');
    const footer = page.locator('[data-ui="admin-table-pagination"]').first();
    const pager = footer.getByRole('navigation');
    await expect(pager).toBeVisible();
    for (const label of ['首页', '上一页', '下一页', '尾页']) {
      const box = await pager.getByRole('button', { name: label, exact: true }).boundingBox();
      expect(box!.width).toBe(44);
      expect(box!.height).toBe(44);
    }
    await expect(footer.locator('.pagination-footer-content')).toHaveCSS('flex-direction', 'column');
    expect(await footer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await footer.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('admin-pagination-mobile.png') });
  });
});

test('数字资产上传面板展示逐文件状态并支持失败重试', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: '数字资产', exact: true }).click();
  await page.getByRole('button', { name: '上传素材' }).click();

  await expect(page.getByRole('heading', { name: '上传素材' })).toBeVisible();
  await expect(page.getByText('选择或拖拽图片、视频、音频文件')).toBeVisible();
  await expect(page.getByText('图片目标文件夹')).toBeVisible();
  await expect(page.getByText('视频目标文件夹')).toBeVisible();
  await expect(page.getByText('音频目标文件夹')).toBeVisible();

  const fileInput = page.getByLabel('选择上传素材文件');
  await fileInput.focus();
  await expect(fileInput).toBeFocused();
  await expect(fileInput).not.toHaveCSS('display', 'none');
  await fileInput.setInputFiles([
    { name: 'ok-cover.png', mimeType: 'image/png', buffer: Buffer.from('ok') },
    { name: 'fail-first-demo.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fail') },
  ]);

  await expect(page.getByText('ok-cover.png')).toBeVisible();
  await expect(page.getByText('fail-first-demo.mp4')).toBeVisible();
  await expect(page.getByText('2 个可上传素材')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '上传素材' }).getByRole('status', { name: '' }).filter({ hasText: '0 / 2' })).toBeVisible();

  await page.getByRole('button', { name: '开始上传' }).click();
  await expect(page.getByText('本批次已完成 1 个，失败 1 个。')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '上传素材' })).toContainText('1 / 2');
  await expect(page.getByRole('dialog', { name: '上传素材' }).getByText(/\d+%/)).toHaveCount(0);
  await expect(page.getByText(/对象存储拒绝上传/)).toBeVisible();
  await expect(page.getByText('Failed to fetch')).toHaveCount(0);

  await page.getByRole('button', { name: '全部重试' }).click();
  await expect(page.getByText('本批次 1 个素材已完成上传。')).toBeVisible();
  await expect(page.getByText(/对象存储拒绝上传/)).toHaveCount(0);

  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('heading', { name: '上传素材' })).toBeHidden();
});

test('系统主目录缺失时仅暂停相关来源操作且其他来源仍可上传', async ({ page }) => {
  await page.evaluate(() => (window as any).__removeSystemFolder('uploaded-image'));
  await page.goto('/app/digital-assets');
  await page.getByRole('tab', { name: '已上传图片' }).click();

  await expect(page.getByRole('alert').filter({ hasText: '已上传图片目录暂不可用' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建已上传图片文件夹' })).toBeDisabled();
  const uploadButton = page.getByRole('button', { name: '上传素材' });
  await expect(uploadButton).toBeEnabled();
  await uploadButton.click();
  await expect(page.getByRole('combobox', { name: '图片目标文件夹' })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: '视频目标文件夹' })).toBeEnabled();
  await expect(page.getByRole('combobox', { name: '音频目标文件夹' })).toBeEnabled();
});

test('新建文件夹在所有数字资产入口按最新创建优先展示', async ({ page }) => {
  const newestFolderName = '最新图片目录';
  await page.goto('/app/digital-assets');
  await page.getByRole('tab', { name: '已上传图片' }).click();

  await page.getByRole('button', { name: '新建已上传图片文件夹' }).click();
  const createDialog = page.getByRole('dialog', { name: '新建已上传图片文件夹' });
  await createDialog.getByLabel('文件夹名称').fill(newestFolderName);
  await createDialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(createDialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: newestFolderName, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `打开文件夹 ${newestFolderName}，0 个素材` })).toBeVisible();
  await expectFolderListItemBefore(page, newestFolderName, '图片归档');

  await page.reload();
  await page.getByRole('tab', { name: '已上传图片' }).click();
  await expectFolderListItemBefore(page, newestFolderName, '图片归档');

  await page.getByRole('button', { name: '上传素材' }).click();
  await page.getByRole('combobox', { name: '图片目标文件夹' }).click();
  const uploadFolderOptions = await page.getByRole('listbox', { name: '图片目标文件夹' }).getByRole('option').allTextContents();
  expect(uploadFolderOptions.slice(0, 3)).toEqual(['不放入文件夹', newestFolderName, '图片归档']);
  await page.getByRole('combobox', { name: '图片目标文件夹' }).press('Escape');
  await page.getByRole('button', { name: '关闭上传素材' }).click();

  await page.getByRole('button', { name: '批量操作' }).click();
  await page.getByRole('button', { name: '选择素材 参考商品图' }).click();
  await page.getByRole('combobox', { name: '选择目标文件夹' }).click();
  const bulkMoveOptions = await page.getByRole('listbox', { name: '选择目标文件夹' }).getByRole('option').allTextContents();
  expect(bulkMoveOptions.slice(0, 3)).toEqual(['选择目标文件夹', newestFolderName, '图片归档']);
  await page.getByRole('combobox', { name: '选择目标文件夹' }).press('Escape');
  await page.getByRole('button', { name: '退出批量操作' }).click();

  await page.getByRole('button', { name: '打开素材 参考商品图' }).click();
  await page.getByRole('combobox', { name: '所在文件夹' }).click();
  const previewFolderOptions = await page.getByRole('listbox', { name: '所在文件夹' }).getByRole('option').allTextContents();
  expect(previewFolderOptions.slice(0, 3)).toEqual(['主目录', newestFolderName, '图片归档']);
  await page.getByRole('combobox', { name: '所在文件夹' }).press('Escape');
  await page.getByRole('button', { name: '关闭素材预览' }).click();

  await page.getByRole('button', { name: 'AI Studio', exact: true }).click();
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择数字资产' });
  await picker.getByRole('tab', { name: '已上传图片' }).click();
  const pickerButtons = await picker.getByRole('button').allTextContents();
  expect(pickerButtons.findIndex(label => label.includes(newestFolderName))).toBeGreaterThanOrEqual(0);
  expect(pickerButtons.findIndex(label => label.includes(newestFolderName)))
    .toBeLessThan(pickerButtons.findIndex(label => label.includes('图片归档')));
});

test('上传素材文件夹下拉使用深色浮层并支持键盘与窄屏定位', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/app/digital-assets');
  await page.getByRole('button', { name: '上传素材' }).click();

  const trigger = page.getByRole('combobox', { name: '图片目标文件夹' });
  await expect.poll(async () => (await trigger.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await trigger.click();

  const listbox = page.getByRole('listbox', { name: '图片目标文件夹' });
  await expect(listbox).toBeVisible();
  await expect(listbox).toHaveCSS('background-color', 'rgb(11, 10, 18)');
  await expect(page.getByRole('option', { name: '不放入文件夹' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('option', { name: '根目录' })).toHaveCount(0);
  await expect(page.getByRole('option', { name: '图片归档' })).toBeVisible();
  await expect(page.getByRole('option', { name: '历史图片' })).toBeVisible();
  expect(await listbox.getByRole('option').evaluateAll(options => options.every(option => option.getBoundingClientRect().height >= 44))).toBe(true);
  await expect(listbox).toHaveJSProperty('scrollTop', 0);
  await expect.poll(() => listbox.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);

  const listboxBox = await listbox.boundingBox();
  if (!listboxBox) throw new Error('图片目标文件夹下拉未完成布局');
  expect(listboxBox.x).toBeGreaterThanOrEqual(0);
  expect(listboxBox.y).toBeGreaterThanOrEqual(0);
  expect(listboxBox.x + listboxBox.width).toBeLessThanOrEqual(390);
  expect(listboxBox.y + listboxBox.height).toBeLessThanOrEqual(760);

  const visibleOptionBoxes = await page.getByRole('option').evaluateAll(options => options.map(option => {
    const box = option.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  }));
  expect(visibleOptionBoxes[4]?.bottom).toBeLessThanOrEqual(listboxBox.y + listboxBox.height);
  expect(visibleOptionBoxes[5]?.bottom).toBeGreaterThan(listboxBox.y + listboxBox.height);

  await page.getByRole('option', { name: '图片归档' }).click();
  await expect(trigger).toContainText('图片归档');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await trigger.press('Home');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await trigger.press('Enter');
  await expect(trigger).toContainText('不放入文件夹');

  await trigger.press('Enter');
  await trigger.press('End');
  await expect.poll(() => listbox.evaluate(element => element.scrollTop > 0)).toBe(true);
  await trigger.press('Enter');
  await expect(trigger).toContainText('历史图片');

  await trigger.press('Enter');
  await trigger.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('heading', { name: '上传素材' })).toBeVisible();

  const videoTrigger = page.getByRole('combobox', { name: '视频目标文件夹' });
  await videoTrigger.click();
  const videoListbox = page.getByRole('listbox', { name: '视频目标文件夹' });
  await expect(videoListbox.getByRole('option')).toHaveCount(1);
  const videoListboxBox = await videoListbox.boundingBox();
  if (!videoListboxBox) throw new Error('视频目标文件夹下拉未完成布局');
  expect(videoListboxBox.height).toBeLessThan(listboxBox.height);
  await expect.poll(() => videoListbox.evaluate(element => element.scrollHeight === element.clientHeight)).toBe(true);
});

async function expectPromptWizardFooterActionsCentered(dialog: Locator) {
  const actionButtons = dialog.getByTestId('prompt-wizard-footer-actions').getByRole('button');
  const styles = await actionButtons.evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button);
    return {
      display: style.display,
      alignItems: style.alignItems,
      justifyContent: style.justifyContent,
    };
  }));
  expect(styles.length).toBeGreaterThan(0);
  expect(styles.every(style => (
    (style.display === 'flex' || style.display === 'inline-flex')
    && style.alignItems === 'center'
    && style.justifyContent === 'center'
  )), JSON.stringify(styles)).toBe(true);
}

async function openPromptWizardAdvancedEditor(dialog: Locator) {
  const region = dialog.getByRole('region', { name: '高级编辑 · Seedance 生产提示词' });
  const isOpen = await region.evaluate(element => (
    element instanceof HTMLDetailsElement
      ? element.open
      : element.querySelector('details')?.open === true
  ));
  if (!isOpen) await region.locator('summary').click();
  const editor = dialog.getByRole('textbox', { name: '生产 Seedance 提示词', exact: true });
  await expect(editor).toBeVisible();
  return editor;
}

async function advancePromptWizardToResults(
  page: Page,
  targetLanguage: '英语' | '西班牙语' | '普通话' = '英语',
) {
  const dialog = page.getByRole('dialog', { name: 'TikTok 提示词向导', exact: true });
  await expect(dialog.getByRole('button', { name: /产品识别/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /产品理解/ })).toHaveCount(0);
  await expectPromptWizardFooterActionsCentered(dialog);
  const startRecognitionButton = dialog.getByRole('button', { name: '开始识别', exact: true });
  if (await startRecognitionButton.count() === 1) {
    await expect(startRecognitionButton).toBeEnabled();
    await startRecognitionButton.click();
  }
  await expect(dialog.getByText('产品识别已完成，所有内容均可编辑', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '颜色', exact: true })).toHaveCount(0);
  await expect(dialog.getByPlaceholder(/外观、颜色/)).toHaveCount(0);
  await expectPromptWizardFooterActionsCentered(dialog);
  await dialog.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '这个产品适合怎么拍', exact: true })).toBeVisible();
  await expect(dialog.getByText('通勤折叠收纳', { exact: true })).toBeVisible();
  await expect(dialog.getByText('桌面结构展示', { exact: true })).toBeVisible();
  await expect(dialog.getByText('居家佩戴准备', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/真实 UGC|开箱测评|电影感品牌片|营销目标|创意强度/)).toHaveCount(0);
  await dialog.getByText('桌面结构展示', { exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '选择一个拍摄场景', exact: true })).toBeVisible();
  await dialog.getByText('纯色产品台', { exact: true }).click();
  await expectPromptWizardFooterActionsCentered(dialog);
  const confirmedOffer = dialog.getByRole('textbox', { name: '本次真实促销信息（可选）', exact: true });
  await expect(confirmedOffer).toBeVisible();
  await expect(confirmedOffer).toHaveAttribute('maxlength', '300');
  await expect(dialog.getByText(
    '只填写当前真实有效的信息；留空时系统不会编造价格、优惠或稀缺性。',
    { exact: true },
  )).toBeVisible();

  const languageTrigger = dialog.getByRole('combobox', { name: '目标语言', exact: true });
  await expect(languageTrigger).toContainText('英语');
  await languageTrigger.click();
  const languageListbox = page.getByRole('listbox', { name: '目标语言', exact: true });
  await expect(languageListbox.getByRole('option')).toHaveCount(14);
  await expect.poll(() => languageListbox.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  const languageListboxBox = await languageListbox.boundingBox();
  if (!languageListboxBox) throw new Error('目标语言下拉未完成布局');
  const visibleLanguageOptions = await languageListbox.getByRole('option').evaluateAll(options => (
    options.map(option => {
      const box = option.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    })
  ));
  expect(visibleLanguageOptions[5]?.bottom).toBeLessThanOrEqual(languageListboxBox.y + languageListboxBox.height);
  expect(visibleLanguageOptions[6]?.bottom).toBeGreaterThan(languageListboxBox.y + languageListboxBox.height);
  await languageTrigger.press('End');
  await expect.poll(() => languageListbox.evaluate(element => element.scrollTop > 0)).toBe(true);
  await languageTrigger.press('Escape');
  await expect(languageTrigger).toBeFocused();
  await languageTrigger.press('Home');
  await languageTrigger.press('Enter');
  await expect(languageTrigger).toContainText('英语');
  if (targetLanguage !== '英语') {
    await languageTrigger.click();
    await page.getByRole('option', { name: targetLanguage, exact: true }).click();
    await expect(languageTrigger).toContainText(targetLanguage);
  }

  await expect(dialog.getByRole('heading', { name: '视频模型', exact: true })).toBeVisible();
  await expect(dialog.getByText('请选择视频生产配置。', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: /^Seedance 2\.0 Fast/ }).click();
  await dialog.getByRole('button', { name: '16:9', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '10s', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '10s', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '480p', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '480p', exact: true }).click();
  await expect(dialog.getByText('向导只生成提示词方案，不会创建视频任务或扣除上方的视频生成积分。', { exact: true })).toBeVisible();
  await expectPromptWizardFooterActionsCentered(dialog);

  const generateButton = dialog.getByRole('button', { name: '生成方案', exact: true });
  await expect(generateButton).toBeVisible();
  await expect(generateButton).not.toContainText('免费');
  await expect(generateButton).not.toContainText(/[23] 个方案/);
  await generateButton.click();
  await expect(dialog.getByText('折叠收纳一秒见证', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('转轴揭晓停留实验', { exact: true })).toBeVisible();
  await expectPromptWizardFooterActionsCentered(dialog);
  await expect(dialog.getByText('A · 清晰演示成交', { exact: true })).toBeVisible();
  await expect(dialog.getByText('B · 强钩子成交', { exact: true })).toBeVisible();
  await expect(dialog.getByText('双手在第一秒折叠耳罩并对准打开的随身包', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('纯色产品台：深灰纯色背景的产品展示台', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('稳定手部俯拍跟随', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('直接自证', { exact: true })).toBeVisible();
  await expect(dialog.getByText('稳定俯拍', { exact: true })).toBeVisible();

  await expect(dialog.getByRole('textbox', { name: '生产 Seedance 提示词', exact: true })).toHaveCount(0);
  const productionPrompt = await openPromptWizardAdvancedEditor(dialog);
  const productionPromptValue = await productionPrompt.inputValue();
  const visualLines = productionPromptValue.split('\n').filter(line => line.startsWith('画面：'));
  expect(visualLines).toHaveLength(4);
  for (const visualLine of visualLines) expect(visualLine).toMatch(/[\u3400-\u9fff]/);
  expect(productionPromptValue).toContain(`旁白（${targetLanguage}）：`);
  expect(productionPromptValue).not.toContain(`画面文字（${targetLanguage}）：`);
  expect(productionPromptValue).not.toMatch(/静止|固定机位|定格|长时间停留|保持不动|连续少切/u);
  if (targetLanguage === '西班牙语') {
    expect(productionPromptValue).toContain('Auriculares plegables en acción');
    expect(productionPromptValue).toContain('Toca la tarjeta ahora');
  } else if (targetLanguage === '普通话') {
    expect(productionPromptValue).toContain('现在点击商品卡立即下单');
  } else {
    expect(productionPromptValue).toContain('Tap product card now');
  }

  const warningsRegion = dialog.getByRole('region', { name: '素材与生成提醒' });
  await expect(dialog.getByRole('region', { name: '脚本预审' })).toHaveCount(0);
  await expect(dialog.getByRole('region', { name: '分镜执行信息' })).toHaveCount(0);
  await expect(dialog.getByRole('region', { name: '备选 Hook' })).toHaveCount(0);
  await expect(dialog.getByText('0–2 秒', { exact: true })).toBeVisible();
  await expect(dialog.getByText('开场钩子', { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText(/画面文字|后期花字|Foley|产品事实依据|制作与素材提醒/);
  if (targetLanguage === '普通话') {
    await expect(dialog.getByText('普通话口播', { exact: true })).toHaveCount(4);
    await expect(dialog.getByText(/中文对照/)).toHaveCount(0);
  } else {
    await expect(dialog.getByText(`${targetLanguage}口播`, { exact: true })).toHaveCount(4);
    await expect(dialog.getByText('中文对照', { exact: true })).toHaveCount(4);
    await expect(dialog.getByText('现在点击商品卡立即下单', { exact: true })).toBeVisible();
  }
  await warningsRegion.getByText('素材与生成提醒', { exact: true }).click();
  await expect(warningsRegion).toContainText('右侧 Logo 较小');

  await dialog.getByText('转轴揭晓停留实验', { exact: true }).click();
  await expect(dialog.getByText('看这款头戴式耳机第一秒展开', { exact: true })).toBeVisible();
  await expect(productionPrompt).not.toHaveValue(/画面文字|后期花字/);
  await dialog.getByText('折叠收纳一秒见证', { exact: true }).click();
  return dialog;
}

async function advancePromptWizardV6ToResults(
  page: Page,
  voiceoverLanguage: '英语' | '西班牙语' | '普通话' = '英语',
) {
  const dialog = page.getByRole('dialog', { name: 'TikTok 提示词向导', exact: true });
  for (const label of ['识别商品', '视频参数与声音', '三个提示词方向']) {
    await expect(dialog.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(dialog.getByText('商品识别完成', { exact: true })).toBeVisible();
  await expect(dialog.getByText('AI 基于品类推测', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '仍需确认的内容（每行一条）', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: '建议受众', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: '建议使用场景', exact: true })).toHaveCount(0);
  await expect(dialog).not.toContainText(/使用方向|营销目标|创意强度|选择一个拍摄场景/);
  await dialog.getByRole('button', { name: /修正识别结果/ }).click();
  await expect(dialog.getByText('完整识别证据', { exact: true })).toBeVisible();
  await expect(dialog.getByText('商品一致性要求', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '建议受众', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: '建议使用场景', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: '仍需确认的内容（每行一条）', exact: true }))
    .toHaveValue('主动降噪数值、续航时间与快充效果需要用户确认');
  await dialog.getByRole('button', { name: /修正识别结果/ }).click();
  await dialog.getByRole('button', { name: '下一步', exact: true }).click();

  await expect(dialog.getByRole('heading', { name: '视频参数与声音', exact: true })).toBeVisible();
  const languageTrigger = dialog.getByRole('combobox', { name: '口播语言', exact: true });
  if (voiceoverLanguage !== '英语') {
    await languageTrigger.click();
    await page.getByRole('option', { name: voiceoverLanguage, exact: true }).click();
  }
  await dialog.getByRole('button', { name: /^Seedance 2\.0 Fast/ }).click();
  await dialog.getByRole('button', { name: '16:9', exact: true }).click();
  await dialog.getByRole('button', { name: '10s', exact: true }).click();
  await dialog.getByRole('button', { name: '480p', exact: true }).click();
  await dialog.getByRole('textbox', { name: '真实优惠信息（可留空）', exact: true })
    .fill('当前满 49 元包邮');
  await dialog.getByRole('button', { name: '生成三个方向', exact: true }).click();

  await expect(dialog.getByText('产品自证型', { exact: true })).toBeVisible();
  await expect(dialog.getByText('痛点钩子型', { exact: true })).toBeVisible();
  await expect(dialog.getByText('场景种草型', { exact: true })).toBeVisible();
  await expect(dialog.getByText('为什么这样拍', { exact: true })).toBeVisible();
  await expect(dialog.getByText('适合谁看', { exact: true })).toBeVisible();
  await expect(dialog.getByText('购买理由', { exact: true })).toBeVisible();
  await expect(dialog.getByText('AI 基于品类推测', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/节奏与剪辑：/).first()).toBeVisible();
  await expect(dialog.getByText(/声音：/).first()).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: /生产.*提示词/ })).toHaveCount(0);
  if (voiceoverLanguage === '普通话') {
    await expect(dialog.getByText('先看它怎么折叠', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/中文翻译/)).toHaveCount(0);
    await expect(dialog.getByText('中文口播核对 · 仅供审核，不会写入提示词', { exact: true }).first()).toBeVisible();
  } else {
    const targetVoiceover = voiceoverLanguage === '西班牙语' ? 'Mira cómo se pliega' : 'Watch how it folds';
    await expect(dialog.getByText(targetVoiceover, { exact: true })).toBeVisible();
    await expect(dialog.getByText('中文翻译 · 仅供审核，不会写入提示词', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText('先看它怎么折叠', { exact: true })).toBeVisible();
  }

  const planCards = [
    ['proof-conversion', '产品自证型'],
    ['problem-hook', '痛点钩子型'],
    ['lifestyle-seeding', '场景种草型'],
  ] as const;
  for (const [role, label] of planCards) {
    const card = dialog.getByTestId(`prompt-wizard-plan-${role}`);
    await card.getByText(label, { exact: true }).click();
    await expect(card.getByText('为什么这样拍', { exact: true })).toBeVisible();
    await expect(card.getByText('事实来源', { exact: true })).toBeVisible();
    await expect(card.getByText('镜头与口播', { exact: true })).toBeVisible();
    await expect(card.getByText('完整方案已展开', { exact: true })).toBeVisible();
  }
  await dialog.getByTestId('prompt-wizard-plan-proof-conversion')
    .getByText('产品自证型', { exact: true })
    .click();
  return dialog;
}

test('AI Studio 提示词向导移除重复按钮且资产选择器保持最前层', async ({ page }) => {
  await page.goto('/app/ai-studio');

  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: 'TK Prompt Engine 1.0', exact: true });
  await expect(wizard).toBeVisible();
  await expect(wizard.getByRole('button', { name: '选择资产', exact: true })).toHaveCount(0);
  await wizard.getByRole('button', { name: '选择商品图片', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择数字资产', exact: true });
  await expect(picker).toBeVisible();
  await expect(page.locator('[data-dialog-root="true"]').filter({ has: picker })).toHaveCSS('z-index', '110');
  await picker.getByRole('button', { name: '关闭资产选择器', exact: true }).click();
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 1024, height: 600 }]) {
  test(`AI Studio TK1.0固定切换与连续阅读 ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/app/ai-studio');
    await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
    await page.getByText('参考商品图', { exact: true }).click();
    await page.getByRole('button', { name: /确认选择/ }).click();
    await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'TK Prompt Engine 1.0', exact: true });
    await dialog.getByRole('button', { name: '确认事实并继续', exact: true }).click();
    await dialog.getByRole('button', { name: '生成三个方案', exact: true }).click();
    const choices = dialog.getByRole('radiogroup', { name: '提示词方案' });
    const safe = choices.getByRole('radio', { name: '方案 A · 最稳', exact: true });
    const native = choices.getByRole('radio', { name: '方案 B · 最原生', exact: true });
    const creative = choices.getByRole('radio', { name: '方案 C · 最抓眼', exact: true });
    const scroll = dialog.getByTestId('prompt-wizard-scroll-region');
    const details = dialog.getByTestId('tk-prompt-selected-details');
    await expect(safe).toBeChecked();
    await expect(details).toHaveCount(1);
    await expect(details).toContainText('1–3秒：三秒内让通勤用户看懂收纳问题');
    await expect(details).not.toContainText('1–3秒：1-3秒');
    await expect(details).not.toContainText('中文翻译 · 仅供审核，不会写入执行提示词');
    const choicesY = (await choices.boundingBox())!.y;
    await scroll.evaluate(el => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect((await choices.boundingBox())!.y).toBeCloseTo(choicesY, 1);
    for (const slot of ['safe', 'native', 'creative']) {
      await expect(dialog.getByTestId(`tk-prompt-plan-${slot}`)).toBeInViewport();
    }
    await dialog.getByTestId('tk-prompt-plan-native').click();
    await expect(native).toBeChecked();
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBe(0);
    await expect(details).toContainText('通勤收纳POV');
    await scroll.evaluate(el => el.scrollTo(0, el.scrollHeight));
    const previousTop = await scroll.evaluate(el => el.scrollTop);
    await dialog.getByTestId('tk-prompt-plan-native').click();
    expect(await scroll.evaluate(el => el.scrollTop)).toBe(previousTop);
    await native.focus();
    await page.keyboard.press('ArrowRight');
    await expect(creative).toBeChecked();
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBe(0);
    await expect(dialog.locator('footer')).toContainText('当前选择：方案 C · 最抓眼');
    await scroll.evaluate(el => el.scrollTo(0, el.scrollHeight));
    await dialog.getByRole('button', { name: '换一批 · 1积分', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__getTkPromptGenerationRequests())).toHaveLength(2);
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBe(0);
    await expect(creative).toBeChecked();
    await expect(dialog.getByRole('button', { name: '采用此方案', exact: true })).toBeInViewport();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await testInfo.attach('方案切换布局', { body: await page.screenshot({ path: testInfo.outputPath('prompt-wizard.png') }), contentType: 'image/png' });

    let releaseFailure!: () => void;
    const failureGate = new Promise<void>(resolve => { releaseFailure = resolve; });
    await page.route('**/api/ai/tk-prompt-engine/runs/*/generations', async route => {
      await failureGate;
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: '测试换批失败' }) });
    });
    await dialog.getByRole('button', { name: '换一批 · 1积分', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '采用此方案', exact: true })).toBeDisabled();
    await dialog.getByTestId('tk-prompt-plan-native').click();
    await expect(native).toBeChecked();
    releaseFailure();
    await expect(dialog).toContainText('当前三个方案已保留');
    await expect(native).toBeChecked();
    await dialog.getByRole('button', { name: '采用此方案', exact: true }).click();
    await expect(page.getByPlaceholder('详细描述你想生成的视频内容、场景、风格...')).toHaveValue(/TK1-native/);
  });
}

test('AI Studio TK1.0生成三卡、换整批并以独立来源应用', async ({ page }) => {
  await page.goto('/app/ai-studio');
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('tab', { name: 'AI视频' }).click();
  await page.getByText('品牌故事视频', { exact: true }).click();
  await page.getByRole('tab', { name: '已上传音频' }).click();
  await page.getByText('参考配乐', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();
  await expect(page.getByText('已选择 1 张图片、1 个视频、1 个音频').first()).toBeVisible();

  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'TK Prompt Engine 1.0', exact: true });
  await expect(dialog.getByText('商品事实已识别', { exact: true })).toBeVisible();
  const steps = dialog.getByRole('navigation', { name: '生成步骤', exact: true });
  for (const label of ['确认商品事实', '设置市场与创作条件', '三个提示词方案']) {
    await expect(steps).toContainText(label);
  }
  await expect(dialog).not.toContainText(/V6|快节奏商品图混剪/);
  await dialog.getByRole('button', { name: '确认事实并继续', exact: true }).click();

  const targetMarket = dialog.getByRole('combobox', { name: '目标市场', exact: true });
  await targetMarket.click();
  await page.getByRole('option', { name: '墨西哥', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: '发布语言', exact: true })).toHaveCount(0);
  const spokenLanguage = dialog.getByRole('combobox', { name: '口播语言', exact: true });
  await expect(spokenLanguage).toContainText('英语');
  await spokenLanguage.click();
  await page.getByRole('option', { name: '西班牙语', exact: true }).click();
  await spokenLanguage.click();
  await page.getByRole('option', { name: '英语', exact: true }).click();

  const duration = dialog.getByRole('combobox', { name: '时长', exact: true });
  await duration.click();
  await page.getByRole('option', { name: '10秒', exact: true }).click();
  await expect(dialog).toContainText('Seedance会按目标市场与口播语言生成成年虚构非名人');
  await expect(dialog).toContainText('单条视频中保持人物身份一致');
  await dialog.getByRole('button', { name: /人物出镜/ }).click();
  await dialog.getByRole('button', { name: '生成三个方案', exact: true }).click();

  for (const slot of ['safe', 'native', 'creative']) {
    await expect(dialog.getByTestId(`tk-prompt-plan-${slot}`)).toBeVisible();
  }
  await expect(dialog.getByText('3/3 已完成', { exact: true })).toBeVisible();
  let requests = await page.evaluate(() => (window as any).__getTkPromptGenerationRequests());
  expect(requests).toHaveLength(1);
  expect(requests[0].creativeInput).toMatchObject({
    targetMarket: '墨西哥',
    spokenLanguage: '英语',
    appearance: { mode: 'live_presenter' },
    availableScenes: [],
  });
  expect(requests[0].creativeInput.appearance).not.toHaveProperty('authorizedActorAssetId');

  await dialog.getByRole('button', { name: '关闭提示词向导', exact: true }).click();
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '重新生成 · 1积分', exact: true })).toBeVisible();
  await expect(dialog.getByTestId('tk-prompt-plan-safe')).toHaveCount(0);
  await expect(dialog.getByText('3/3 已完成', { exact: true })).toHaveCount(0);
  await expect(targetMarket).toContainText('墨西哥');
  await expect(spokenLanguage).toContainText('英语');
  await dialog.getByRole('button', { name: '重新生成 · 1积分', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (
    window as any
  ).__getTkPromptGenerationRequests())).toHaveLength(2);
  await expect(dialog.getByText('3/3 已完成', { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: '换一批 · 1积分', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (
    window as any
  ).__getTkPromptGenerationRequests())).toHaveLength(3);
  requests = await page.evaluate(() => (window as any).__getTkPromptGenerationRequests());
  expect(requests[1].creativeInput).toMatchObject({
    targetMarket: '墨西哥',
    spokenLanguage: '英语',
  });
  expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
  expect(requests[2].idempotencyKey).not.toBe(requests[1].idempotencyKey);

  await dialog.getByTestId('tk-prompt-plan-native').getByText('通勤收纳POV', { exact: true }).click();
  await dialog.getByRole('button', { name: '采用此方案', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const videoPrompt = page.getByPlaceholder('详细描述你想生成的视频内容、场景、风格...');
  await expect(videoPrompt).toHaveValue(/TK1-native/);
  await expect(videoPrompt).toHaveValue(/符合目标市场与口播语言的成年虚构非名人出镜，单条人物身份一致/);
  await expect(videoPrompt).toHaveValue(/旁白（英语）：Watch this fold/);
  await expect(videoPrompt).not.toHaveValue(/中文翻译|看它折叠后如何收进/);
  await expect(page.getByText('已选择 1 张图片').first()).toBeVisible();
  await page.getByRole('button', { name: /生成视频 · \d+ 积分/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__getLastGenerationRequest())).not.toBeNull();
  const videoRequest = await page.evaluate(() => (window as any).__getLastGenerationRequest());
  expect(videoRequest.tkPromptSource).toMatchObject({
    runId: requests[2].runId,
    schemaVersion: 1,
    editBucket: 'none',
  });
  expect(videoRequest.tkPromptSource.generationId).toBeTruthy();
  expect(videoRequest.tkPromptSource.optionId).toBeTruthy();
  expect(videoRequest).not.toHaveProperty('promptWizardSource');
  expect(videoRequest).not.toHaveProperty('realPortrait');
  expect(videoRequest.references).toHaveLength(1);
});

test('AI Studio TK1.0应用后修改来源快照参数会保留提示词并转为手动草稿', async ({ page }) => {
  await page.goto('/app/ai-studio');
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'TK Prompt Engine 1.0', exact: true });
  await expect(dialog.getByText('商品事实已识别', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '确认事实并继续', exact: true }).click();
  await dialog.getByRole('button', { name: '生成三个方案', exact: true }).click();
  await expect(dialog.getByText('3/3 已完成', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '采用此方案', exact: true }).click();

  const prompt = page.getByPlaceholder('详细描述你想生成的视频内容、场景、风格...');
  const appliedPrompt = await prompt.inputValue();
  await page.getByRole('button', { name: /^视频参数：.*15s$/ }).click();
  const parametersMenu = page.getByTestId('ai-studio-video-parameters-menu');
  await parametersMenu.getByRole('radio', { name: '10s', exact: true }).click();
  await page.keyboard.press('Escape');

  await expect(page.getByText(/已保留当前执行提示词；视频时长与原 TK 方案快照不同，已转为手动草稿/)).toBeVisible();
  await expect(prompt).toHaveValue(appliedPrompt);
  await page.getByRole('button', { name: /生成视频 · \d+ 积分/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__getLastGenerationRequest())).not.toBeNull();
  const videoRequest = await page.evaluate(() => (window as any).__getLastGenerationRequest());
  expect(videoRequest.prompt).toBe(appliedPrompt);
  expect(videoRequest).not.toHaveProperty('tkPromptSource');
});

test('AI Studio TK1.0切换图片序列不会沿用上一商品的人工事实与创作输入', async ({ page }) => {
  await page.goto('/app/ai-studio');
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'TK Prompt Engine 1.0', exact: true });
  await expect(dialog.getByText('商品事实已识别', { exact: true })).toBeVisible();
  await dialog.getByPlaceholder('每行一条，例如：容量为 2L').fill('上一商品容量为2L');
  await dialog.getByPlaceholder('每行一条，例如：不要提医疗功效').fill('上一商品专属禁用词');
  await dialog.getByRole('button', { name: '确认事实并继续', exact: true }).click();
  await dialog.getByRole('textbox', { name: '目标人群（可选）', exact: true }).fill('上一商品受众');
  await dialog.getByPlaceholder('例如：店铺当前满30美元减5美元').fill('上一商品满30减5');
  await dialog.getByRole('button', { name: /真实场景演示/ }).click();
  await dialog.getByRole('button', { name: '返回', exact: true }).click();

  await dialog.getByRole('button', { name: '删除图片1', exact: true }).click();
  await expect(dialog.getByText('请先选择1–9张商品图片', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '选择商品图片', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择数字资产', exact: true });
  await picker.getByText('参考商品图', { exact: true }).click();
  await picker.getByRole('button', { name: /确认选择/ }).click();

  await expect(dialog.getByText('商品事实已识别', { exact: true })).toBeVisible();
  await expect(dialog.getByPlaceholder('每行一条，例如：容量为 2L')).toHaveValue('');
  await expect(dialog.getByPlaceholder('每行一条，例如：不要提医疗功效'))
    .toHaveValue('不编造降噪数值、续航或价格');
  await expect(dialog.getByRole('checkbox').first()).toBeChecked();
  await dialog.getByRole('button', { name: '确认事实并继续', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: '目标人群（可选）', exact: true })).toHaveValue('');
  await expect(dialog.getByPlaceholder('例如：店铺当前满30美元减5美元')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: /AI自动选择/ })).toHaveClass(/border-purple-400/);
});

test('AI Studio TK1.0 5秒不发送语言字段且不生成发布文案', async ({ page }) => {
  await page.goto('/app/ai-studio');
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'TK Prompt Engine 1.0', exact: true });
  await expect(dialog.getByText('商品事实已识别', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '确认事实并继续', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '视频参数与声音', exact: true })).toBeVisible();

  const spokenLanguage = dialog.getByRole('combobox', { name: '口播语言', exact: true });
  await spokenLanguage.click();
  await page.getByRole('option', { name: '西班牙语', exact: true }).click();
  const verifiedOffer = dialog.getByPlaceholder('例如：店铺当前满30美元减5美元');
  await verifiedOffer.fill('满30减5');
  const duration = dialog.getByRole('combobox', { name: '时长', exact: true });
  await duration.click();
  await page.getByRole('option', { name: '5秒', exact: true }).click();
  await expect(dialog.getByTestId('prompt-wizard-sound-design-only')).toContainText('无口播 · 纯声音设计');
  await expect(dialog.getByRole('combobox', { name: '口播语言', exact: true })).toHaveCount(0);
  await expect(verifiedOffer).toHaveCount(0);
  await expect(dialog.getByTestId('tk-prompt-five-second-no-offer')).toContainText('5秒方案不使用优惠信息');
  await dialog.getByRole('button', { name: /人物出镜/ }).click();
  await dialog.getByRole('button', { name: '生成三个方案', exact: true }).click();

  await expect(dialog.getByText('镜头与声音设计', { exact: true })).toBeVisible();
  await expect(dialog.getByText('镜头 1', { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText(/目标口播|Watch this fold/);
  await expect(dialog.getByText('中文翻译 · 仅供审核，不会写入执行提示词', { exact: true })).toHaveCount(0);
  const [request] = await page.evaluate(() => (window as any).__getTkPromptGenerationRequests());
  expect(request.creativeInput).not.toHaveProperty('publishLanguage');
  expect(request.creativeInput.verifiedOffer).toBe('');
  expect(request.creativeInput.appearance).toEqual({ mode: 'live_presenter' });
  expect(request.creativeInput).not.toHaveProperty('spokenLanguage');
  const [generation] = await page.evaluate(() => (window as any).__getTkPromptGenerations());
  expect(generation.options).toHaveLength(3);
  expect(generation.options.every((item: Record<string, any>) => !('publishPack' in item.plan))).toBe(true);
  await expect(dialog).not.toContainText('TikTok发布文案');
  expect(generation.options.every((item: Record<string, any>) => item.plan.audioMode === 'sound-design-only')).toBe(true);

  await dialog.getByTestId('tk-prompt-plan-native').getByText('通勤收纳POV', { exact: true }).click();
  await dialog.getByRole('button', { name: '采用此方案', exact: true }).click();
  const videoPrompt = page.getByPlaceholder('详细描述你想生成的视频内容、场景、风格...');
  await expect(videoPrompt).toHaveValue(/符合目标市场的成年虚构非名人出镜，单条人物身份一致/);
  await expect(videoPrompt).toHaveValue(/无对白、无人声、无旁白；仅使用环境声与商品操作拟音/);
  await expect(videoPrompt).not.toHaveValue(/旁白（|中文翻译/);
});

test.skip('旧版：AI Studio 提示词向导只在全能参考显示并拒绝首尾帧任务', async ({ page }) => {
  await page.goto('/app/ai-studio');
  const guideButton = page.getByRole('button', { name: 'AI 帮我写提示词', exact: true });
  await expect(guideButton).toBeVisible();
  await expect(guideButton).toHaveClass(/h-10/);
  await expect(guideButton).toHaveClass(/from-purple-600/);
  await expect(guideButton).toHaveClass(/to-blue-600/);
  await expect(guideButton).toHaveClass(/focus-visible:ring-2/);
  expect((await guideButton.boundingBox())?.height).toBeCloseTo(40, 3);
  await guideButton.focus();
  await expect(guideButton).toBeFocused();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(guideButton).toBeInViewport({ ratio: 1 });
  expect((await guideButton.boundingBox())?.height).toBeCloseTo(40, 3);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole('button', { name: '参考模式：全能参考', exact: true }).click();
  await page.getByRole('option', { name: /首尾帧/ }).click();
  await expect(guideButton).toHaveCount(0);
  await expect(page.getByText(/提示词向导.*只支持|切换.*全能参考/)).toHaveCount(0);

  const forgedResponse = await page.evaluate(async imageAssetId => {
    const response = await fetch('/api/ai/prompt-wizard/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageAssetIds: [imageAssetId], referenceMode: 'first-last' }),
    });
    return { status: response.status, body: await response.json() };
  }, mockUuid('asset-ref-image'));
  expect(forgedResponse.status).toBe(400);
  expect((forgedResponse.body as { message?: string }).message).toContain('只支持全能参考模式');

  await page.getByRole('button', { name: '参考模式：首尾帧', exact: true }).click();
  await page.getByRole('option', { name: /全能参考/ }).click();
  await expect(guideButton).toBeVisible();
});

test.skip('旧版：AI Studio 提示词向导选图后手动识别并在识别期间锁定图片', async ({ page }) => {
  await page.goto('/app/ai-studio');
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'TikTok 提示词向导', exact: true });
  const startRecognitionButton = dialog.getByRole('button', { name: '开始识别', exact: true });
  await expect(startRecognitionButton).toBeDisabled();
  await expect(dialog.getByText('选择图片后，点击「开始识别」', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window as any
  ).__getApiRequestCount('POST /api/ai/prompt-wizard/runs'))).toBe(0);

  await dialog.getByRole('button', { name: '选择资产', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择数字资产' });
  await picker.getByText('参考商品图', { exact: true }).click();
  await picker.getByRole('button', { name: /确认选择/ }).click();

  await expect(dialog.getByText('已选择 1 张图片，点击「开始识别」后识别产品。', { exact: true })).toBeVisible();
  await expect(startRecognitionButton).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (
    window as any
  ).__getApiRequestCount('POST /api/ai/prompt-wizard/runs'))).toBe(0);

  const recognitionRequest = await holdFirstApiRequest(page, '**/api/ai/prompt-wizard/runs');
  await startRecognitionButton.evaluate(element => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect.poll(() => recognitionRequest.requestCount).toBe(1);
  await expect(dialog.getByRole('button', { name: '识别中…', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '选择资产', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '移除参考商品图', exact: true })).toBeDisabled();

  recognitionRequest.release();
  await expect(dialog.getByText('产品识别已完成，所有内容均可编辑', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '下一步', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: '选择资产', exact: true })).toBeEnabled();
  const removeImageButton = dialog.getByRole('button', { name: '移除参考商品图', exact: true });
  await expect(removeImageButton).toBeEnabled();
  await removeImageButton.click();

  await expect(startRecognitionButton).toBeDisabled();
  await dialog.getByRole('button', { name: '选择资产', exact: true }).click();
  const replacementPicker = page.getByRole('dialog', { name: '选择数字资产' });
  await replacementPicker.getByText('参考收尾图', { exact: true }).click();
  await replacementPicker.getByRole('button', { name: /确认选择/ }).click();
  await expect(startRecognitionButton).toBeEnabled();
  await expect(dialog.getByText('已选择 1 张图片，点击「开始识别」后识别产品。', { exact: true })).toBeVisible();
  expect(recognitionRequest.requestCount).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__getPromptWizardRuns())).toHaveLength(1);
});

test.skip('旧版：AI Studio 提示词向导识别失败后由底部按钮手动重试', async ({ page }) => {
  await page.goto('/app/ai-studio');
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();

  let recognitionAttempts = 0;
  await page.route('**/api/ai/prompt-wizard/runs', async route => {
    recognitionAttempts += 1;
    if (recognitionAttempts === 1) {
      await json(route, { message: '产品识别服务暂时不可用，请稍后重试。' }, 503);
      return;
    }
    await route.fallback();
  });

  const dialog = page.getByRole('dialog', { name: 'TikTok 提示词向导', exact: true });
  await expect(dialog.getByText('已选择 1 张图片，点击「开始识别」后识别产品。', { exact: true })).toBeVisible();
  expect(recognitionAttempts).toBe(0);
  await dialog.getByRole('button', { name: '开始识别', exact: true }).click();
  await expect(dialog.getByText('产品识别服务暂时不可用，请稍后重试。', { exact: true })).toBeVisible();

  const retryButton = dialog.getByRole('button', { name: '重新识别', exact: true });
  await expect(retryButton).toBeEnabled();
  await expect(dialog.getByRole('button', { name: '选择资产', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: '移除参考商品图', exact: true })).toBeEnabled();
  await retryButton.click();
  await expect(dialog.getByText('产品识别已完成，所有内容均可编辑', { exact: true })).toBeVisible();
  expect(recognitionAttempts).toBe(2);
});

test.skip('旧版：AI Studio 提示词向导清除旧版任务且不自动重新识别', async ({ page }) => {
  await page.goto('/app/ai-studio');
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();
  await page.evaluate(() => (window as any).__setPromptWizardLegacyTaskRetired(true));
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'TikTok 提示词向导', exact: true });
  await expect(dialog.getByText('旧版提示词任务已清除，请点击“开始识别”重新创建 3.0 任务。', { exact: true })).toBeVisible();
  await expect(dialog.getByText('点击「开始识别」创建新的 3.0 产品任务', { exact: true })).toBeVisible();
  await expect(dialog.getByAltText('参考商品图')).toBeVisible();
  await expect(dialog.getByText('产品识别已完成，所有内容均可编辑', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '下一步', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    window as any
  ).__getApiRequestCount('POST /api/ai/prompt-wizard/runs'))).toBe(0);

  await dialog.getByRole('button', { name: '开始识别', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (
    window as any
  ).__getApiRequestCount('POST /api/ai/prompt-wizard/runs'))).toBe(1);
  await expect(dialog.getByText('产品识别已完成，所有内容均可编辑', { exact: true })).toBeVisible();
});

test.skip('旧版：AI Studio 提示词向导防止遮罩误关并在修改使用方向后作废旧方案', async ({ page }) => {
  await page.goto('/app/ai-studio');
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();

  const dialog = await advancePromptWizardToResults(page);
  const batchesBeforeReview = await page.evaluate(() => (window as any).__getPromptWizardBatches());
  expect(batchesBeforeReview).toHaveLength(1);

  await page.mouse.click(20, 450);
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: '使用方向与视频配置', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /^Seedance 2\.0 Fast/ })).toHaveClass(/border-purple-400/);
  const viewCurrentButton = dialog.getByRole('button', { name: '查看当前方案', exact: true });
  await expect(viewCurrentButton).toBeVisible();
  await viewCurrentButton.click();
  await expect(dialog.getByText('折叠收纳一秒见证', { exact: true }).first()).toBeVisible();
  await expect(page.evaluate(() => (window as any).__getPromptWizardBatches())).resolves.toHaveLength(1);

  await dialog.getByRole('button', { name: '使用方向与视频配置', exact: true }).click();
  await dialog.getByText('居家佩戴准备', { exact: true }).click();
  await dialog.getByText('客厅沙发旁', { exact: true }).click();

  await expect(dialog.getByRole('button', { name: '查看旧方案', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '换一批 · 1 积分', exact: true })).toBeVisible();
  await expect(page.evaluate(() => (window as any).__getPromptWizardBatches())).resolves.toHaveLength(1);

  await dialog.getByRole('button', { name: '换一批 · 1 积分', exact: true }).click();
  await expect(dialog.getByText('焕新1·折叠收纳一秒见证', { exact: true }).first()).toBeVisible();
  await expect(page.evaluate(() => (window as any).__getPromptWizardBatches())).resolves.toHaveLength(2);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();
  const reopenedDialog = page.getByRole('dialog', { name: 'TikTok 提示词向导', exact: true });
  await reopenedDialog.getByRole('button', { name: '关闭提示词向导', exact: true }).click();
  await expect(reopenedDialog).toHaveCount(0);
});

test.skip('旧版：AI Studio 提示词向导隔离滚动并在关闭后恢复页面样式', async ({ page }) => {
  await page.goto('/app/ai-studio');
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();

  const guideButton = page.getByRole('button', { name: 'AI 帮我写提示词', exact: true });
  const initialScrollY = await page.evaluate(() => {
    document.body.style.height = '3000px';
    document.body.style.overflow = 'auto';
    document.body.style.overscrollBehavior = 'auto';
    document.body.style.paddingRight = '9px';
    document.documentElement.style.overflow = 'visible';
    document.documentElement.style.overscrollBehavior = 'auto';
    window.scrollTo(0, 320);
    return window.scrollY;
  });
  expect(initialScrollY).toBeGreaterThan(0);

  await guideButton.evaluate(element => (element as HTMLButtonElement).click());
  const dialog = await advancePromptWizardToResults(page);
  const scrollRegion = dialog.getByTestId('prompt-wizard-scroll-region');

  await expect(page.getByTestId('prompt-wizard-backdrop')).toHaveCSS('backdrop-filter', 'none');
  await expect.poll(() => page.evaluate(() => ({
    bodyLocked: document.body.classList.contains('prompt-wizard-scroll-locked'),
    bodyOverflow: getComputedStyle(document.body).overflow,
    bodyOverscroll: getComputedStyle(document.body).overscrollBehavior,
    rootLocked: document.documentElement.classList.contains('prompt-wizard-scroll-locked'),
    rootOverflow: getComputedStyle(document.documentElement).overflow,
    rootOverscroll: getComputedStyle(document.documentElement).overscrollBehavior,
  }))).toEqual({
    bodyLocked: true,
    bodyOverflow: 'hidden',
    bodyOverscroll: 'none',
    rootLocked: true,
    rootOverflow: 'hidden',
    rootOverscroll: 'none',
  });
  await expect.poll(() => scrollRegion.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      overflowY: style.overflowY,
      overscrollBehavior: style.overscrollBehavior,
      scrollbarGutter: style.scrollbarGutter,
      canScroll: element.scrollHeight > element.clientHeight,
    };
  })).toEqual({
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    scrollbarGutter: 'stable',
    canScroll: true,
  });

  const wizardHeader = dialog.locator('header').first();
  const headerY = (await wizardHeader.boundingBox())?.y;
  const footerY = (await dialog.locator('footer').boundingBox())?.y;
  await scrollRegion.evaluate(element => element.scrollTo({ top: element.scrollHeight }));
  await expect.poll(() => scrollRegion.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const scrollRegionBox = await scrollRegion.boundingBox();
  if (!scrollRegionBox || headerY === undefined || footerY === undefined) {
    throw new Error('提示词向导滚动布局未完成');
  }
  await page.mouse.move(
    scrollRegionBox.x + scrollRegionBox.width / 2,
    scrollRegionBox.y + scrollRegionBox.height / 2,
  );
  await page.mouse.wheel(0, 2_000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(initialScrollY);
  expect((await wizardHeader.boundingBox())?.y).toBeCloseTo(headerY, 1);
  expect((await dialog.locator('footer').boundingBox())?.y).toBeCloseTo(footerY, 1);

  await scrollRegion.evaluate(element => element.scrollTo({ top: 0 }));
  await page.mouse.wheel(0, -2_000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(initialScrollY);

  await dialog.getByRole('button', { name: '使用此方案', exact: true }).click();
  const confirmationBackdrop = dialog.getByTestId('prompt-wizard-confirmation-backdrop');
  await expect(confirmationBackdrop).toBeVisible();
  await expect(confirmationBackdrop).toHaveCSS('backdrop-filter', 'none');
  await dialog.getByRole('button', { name: '继续检查', exact: true }).click();
  await dialog.getByRole('button', { name: '关闭提示词向导', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    bodyOverflow: document.body.style.overflow,
    bodyOverscroll: document.body.style.overscrollBehavior,
    bodyPaddingRight: document.body.style.paddingRight,
    rootOverflow: document.documentElement.style.overflow,
    rootOverscroll: document.documentElement.style.overscrollBehavior,
    scrollY: window.scrollY,
  }))).toEqual({
    bodyOverflow: 'auto',
    bodyOverscroll: 'auto',
    bodyPaddingRight: '9px',
    rootOverflow: 'visible',
    rootOverscroll: 'auto',
    scrollY: initialScrollY,
  });
});

test.skip('旧版：AI Studio 提示词向导首次失败后保留选择并支持原地免费重试', async ({ page }) => {
  await page.goto('/app/ai-studio');
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'TikTok 提示词向导', exact: true });
  await dialog.getByRole('button', { name: '开始识别', exact: true }).click();
  await expect(dialog.getByText('产品识别已完成，所有内容均可编辑', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(dialog.getByText('桌面结构展示', { exact: true })).toBeVisible();
  await dialog.getByText('桌面结构展示', { exact: true }).click();
  await dialog.getByText('纯色产品台', { exact: true }).click();

  await page.evaluate(() => (window as any).__failNextPromptWizardInitialBatch());
  await dialog.getByRole('button', { name: '生成方案', exact: true }).click();

  await expect(dialog.getByText('AI 返回内容未通过脚本结构与事实校验，本批次未交付。', { exact: true })).toBeVisible();
  await expect(dialog.getByText('产品识别、使用方向、场景和视频配置均已保留，可直接重新生成。', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '调整方向或场景', exact: true })).toBeVisible();
  const retryButton = dialog.getByRole('button', { name: '重新生成方案', exact: true });
  await expect(retryButton).toBeVisible();

  const retryRequest = await holdFirstApiRequest(page, '**/api/ai/prompt-wizard/runs/*/batches');
  await retryButton.click();
  await expect(dialog.getByRole('button', { name: '重新生成中…', exact: true })).toBeDisabled();
  await expect.poll(() => retryRequest.requestCount).toBe(1);
  retryRequest.release();

  await expect(dialog.getByText('折叠收纳一秒见证', { exact: true }).first()).toBeVisible();
  const [failedBatch, completedBatch] = await page.evaluate(() => (window as any).__getPromptWizardBatches());
  expect(failedBatch).toMatchObject({ status: 'failed', isFree: true, credits: 0, creditStatus: 'none' });
  expect(completedBatch).toMatchObject({ status: 'completed', isFree: true, credits: 0, creditStatus: 'none' });
  expect(completedBatch.selectedUseDirectionId).toBe(failedBatch.selectedUseDirectionId);
  expect(completedBatch.selectedSceneId).toBe(failedBatch.selectedSceneId);
  await expect(page.evaluate(() => (window as any).__getPromptWizardRuns())).resolves.toHaveLength(1);
  await expect(page.evaluate(() => (window as any).__getPromptWizardUseDirectionSets())).resolves.toHaveLength(1);
});

test.skip('旧版：AI Studio 三步向导生成产品专属双方案并应用配置', async ({ page }) => {
  await page.goto('/app/ai-studio');
  const productRecognitionRequest = await holdFirstApiRequest(page, '**/api/ai/prompt-wizard/runs');

  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('tab', { name: 'AI视频' }).click();
  await page.getByText('品牌故事视频', { exact: true }).click();
  await page.getByRole('tab', { name: '已上传音频' }).click();
  await page.getByText('参考配乐', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();
  await expect(page.getByText('已选择 1 张图片、1 个视频、1 个音频').first()).toBeVisible();

  const generationRequestsBefore = await page.evaluate(() => (
    window as any
  ).__getApiRequestCount('POST /api/ai/video-tasks/batch'));
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();
  const recognizingDialog = page.getByRole('dialog', { name: 'TikTok 提示词向导', exact: true });
  await expect(recognizingDialog.getByText('已选择 1 张图片，点击「开始识别」后识别产品。', { exact: true })).toBeVisible();
  expect(productRecognitionRequest.requestCount).toBe(0);
  await recognizingDialog.getByRole('button', { name: '开始识别', exact: true }).click();
  await expect.poll(() => productRecognitionRequest.requestCount).toBe(1);
  await expect(recognizingDialog.getByText('Lindyson AI 正在识别产品...', { exact: true })).toBeVisible();
  await expect(recognizingDialog.getByRole('button', { name: '选择资产', exact: true })).toBeDisabled();
  await expect(recognizingDialog.getByRole('button', { name: '移除参考商品图', exact: true })).toBeDisabled();
  productRecognitionRequest.release();
  let dialog = await advancePromptWizardToResults(page, '西班牙语');

  let batches = await page.evaluate(() => (window as any).__getPromptWizardBatches());
  expect(batches).toHaveLength(1);
  expect(batches[0]).toMatchObject({ isFree: true, credits: 0, creditStatus: 'none' });
  const refreshButton = dialog.getByRole('button', { name: '换一批 · 1 积分', exact: true });
  await expect(refreshButton).toBeVisible();
  await expect(refreshButton).toHaveClass(/from-pink-600/);
  await expect(refreshButton).toHaveClass(/to-purple-600/);

  const refreshRequest = await holdFirstApiRequest(page, '**/api/ai/prompt-wizard/runs/*/batches');
  await refreshButton.click();
  await expect(dialog.getByText('Lindyson AI 正在生成新的提示词方案...', { exact: true })).toBeVisible();
  await expect(dialog.getByText('折叠收纳一秒见证', { exact: true }).first()).toBeVisible();
  refreshRequest.release();
  await expect(dialog.getByText('焕新1·折叠收纳一秒见证', { exact: true }).first()).toBeVisible();
  batches = await page.evaluate(() => (window as any).__getPromptWizardBatches());
  expect(batches).toHaveLength(2);
  expect(batches[1]).toMatchObject({ isFree: false, credits: 1, creditStatus: 'settled' });

  await page.evaluate(() => (window as any).__failNextPromptWizardPaidBatch());
  await refreshButton.click();
  await expect(dialog.getByText('焕新1·折叠收纳一秒见证', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText(/方案生成失败，已退回积分。.*原有方案已保留/)).toBeVisible();
  batches = await page.evaluate(() => (window as any).__getPromptWizardBatches());
  expect(batches).toHaveLength(3);
  expect(batches[2]).toMatchObject({
    status: 'failed',
    isFree: false,
    credits: 1,
    creditStatus: 'refunded',
    plans: [],
    failureReason: '方案生成失败，已退回积分。',
  });

  await dialog.getByText('焕新1·转轴揭晓停留实验', { exact: true }).click();
  const productionPrompt = await openPromptWizardAdvancedEditor(dialog);
  await expect(productionPrompt).not.toHaveValue(/【禁止事项】/);
  await expect(productionPrompt).toHaveValue(/画面：在深灰纯色背景的产品展示台中/);
  await expect(productionPrompt).toHaveValue(/旁白（西班牙语）：Auriculares revelados en un segundo/);
  await expect(productionPrompt).not.toHaveValue(/画面文字（西班牙语）：/);
  await expect(dialog.getByText('看这款头戴式耳机第一秒展开', { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText(/画面文字|后期花字/);
  await productionPrompt.fill(`${await productionPrompt.inputValue()}\n用户编辑备注。`);
  await expect(dialog.getByText('口播对照基于初始方案', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '使用此方案', exact: true }).click();
  const confirm = dialog.getByText('应用这套视频方案？', { exact: true }).locator('..');
  await expect(confirm).toContainText('现有参考视频、音频与生成数量保持不变');
  await expect(confirm).toContainText('口播中文译文与素材提醒不会带入视频描述');
  await expect(confirm).not.toContainText(/脚本预审|画面文字|后期花字|备选 Hook/);
  await dialog.getByRole('button', { name: '确认应用', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const videoPrompt = page.getByPlaceholder('详细描述你想生成的视频内容、场景、风格...');
  await expect(videoPrompt).toHaveValue(/深灰纯色背景的产品展示台/);
  await expect(videoPrompt).toHaveValue(/用户编辑备注/);
  await expect(videoPrompt).not.toHaveValue(/看这款头戴式耳机第一秒展开/);
  await expect(videoPrompt).not.toHaveValue(/【禁止事项】|不得出现首尾帧指令/);
  await expect(videoPrompt).toBeFocused();
  await expect(page.getByText('已选择 1 张图片、1 个视频、1 个音频').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI 模型：Seedance 2.0 Fast', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '视频参数：16:9 · 480p · 10s', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window as any
  ).__getApiRequestCount('POST /api/ai/video-tasks/batch'))).toBe(generationRequestsBefore);

  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();
  dialog = await advancePromptWizardToResults(page, '普通话');
  await expect.poll(() => page.evaluate(() => (window as any).__getPromptWizardRuns())).toHaveLength(2);
  batches = await page.evaluate(() => (window as any).__getPromptWizardBatches());
  expect(batches).toHaveLength(4);
  expect(batches[3]).toMatchObject({ isFree: true, credits: 0, creditStatus: 'none' });
  await expect(dialog.getByRole('button', { name: '换一批 · 1 积分', exact: true })).toBeVisible();
});

test.skip('旧版：AI Studio 产品使用方向支持场景选择、单方案微调、来源应用与 24 小时恢复', async ({ page }) => {
  await page.goto('/app/ai-studio');

  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();

  let dialog = page.getByRole('dialog', { name: 'TikTok 提示词向导', exact: true });
  for (const label of ['产品识别', '使用方向与视频配置', '两个提示词方案']) {
    await expect(dialog.getByRole('button', { name: new RegExp(`${label}$`) })).toBeVisible();
  }
  await expect(dialog.getByText(/创作设定|创意路线与视频配置|分镜工作台/)).toHaveCount(0);

  await dialog.getByRole('button', { name: '开始识别', exact: true }).click();
  await expect(dialog.getByText('产品识别已完成，所有内容均可编辑', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '下一步', exact: true }).click();

  await expect(dialog.getByRole('region', { name: '产品使用方向', exact: true })).toBeVisible();
  await expect(dialog.getByText('通勤折叠收纳', { exact: true })).toBeVisible();
  await expect(dialog.getByText('桌面结构展示', { exact: true })).toBeVisible();
  await expect(dialog.getByText('居家佩戴准备', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/真实 UGC|场景问题解决|开箱测评|功能实测|痛点对比|生活方式|电影感品牌片|ASMR 细节展示|营销目标|创意强度/)).toHaveCount(0);
  await dialog.getByText('桌面结构展示', { exact: true }).click();
  await dialog.getByText('纯色产品台', { exact: true }).click();
  await expect(dialog.getByText('深灰纯色背景的产品展示台', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__getPromptWizardUseDirectionSets())).toHaveLength(1);

  const generateButton = dialog.getByRole('button', { name: '生成方案', exact: true });
  await expect(generateButton).toBeEnabled();
  await generateButton.click();
  await expect(dialog.getByText('折叠收纳一秒见证', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('转轴揭晓停留实验', { exact: true })).toBeVisible();
  await expect(dialog.getByText('分镜工作台', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('结构化分镜', { exact: true })).toBeVisible();
  await expect(dialog.getByText('0–3 秒', { exact: true })).toBeVisible();
  await expect(dialog.getByText('第一拍与前三秒', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '生产 Seedance 提示词', exact: true })).toHaveCount(0);

  await openPromptWizardAdvancedEditor(dialog);

  await dialog.getByRole('button', { name: '钩子更强', exact: true }).click();
  await expect(dialog.getByText('微调后·折叠收纳一秒见证', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('转轴揭晓停留实验', { exact: true })).toBeVisible();
  await expect(dialog.getByText('免费微调已使用', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__getPromptWizardRefinementRequests())).toHaveLength(1);

  await dialog.getByRole('button', { name: '使用此方案', exact: true }).click();
  await dialog.getByRole('button', { name: '确认应用', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: /生成视频 · \d+ 积分/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__getLastGenerationRequest())).not.toBeNull();
  const generationRequest = await page.evaluate(() => (window as any).__getLastGenerationRequest());
  expect(generationRequest).toMatchObject({
    promptWizardSource: {
      engineVersion: 3,
      editBucket: 'none',
    },
  });
  expect((generationRequest as any).promptWizardSource.planRevisionId).toBeTruthy();
  expect((generationRequest as any).promptWizardSource.planId)
    .toBe(mockUuid('prompt-wizard-refined-plan-1'));

  await page.evaluate(() => (window as any).__setPromptWizardResumeEnabled(true));
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'TikTok 提示词向导', exact: true });
  await expect(dialog.getByText('微调后·折叠收纳一秒见证', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('已恢复最近的提示词方案', { exact: true })).toBeVisible();

  const restoredPromptEditor = await openPromptWizardAdvancedEditor(dialog);
  await restoredPromptEditor.fill(`${await restoredPromptEditor.inputValue()}\n本地恢复校验标记`);
  await expect(restoredPromptEditor).toHaveValue(/本地恢复校验标记/u);
  await dialog.getByRole('button', { name: '关闭提示词向导', exact: true }).click();
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'TikTok 提示词向导', exact: true });
  await openPromptWizardAdvancedEditor(dialog);
  await expect(dialog.getByRole('textbox', { name: '生产 Seedance 提示词', exact: true }))
    .toHaveValue(/本地恢复校验标记/u);

  await dialog.getByRole('button', { name: '使用方向与视频配置', exact: true }).click();
  await dialog.getByRole('button', { name: '10s', exact: true }).click();
  const viewOldPlanButton = dialog.getByRole('button', { name: '查看旧方案', exact: true });
  await expect(viewOldPlanButton).toBeVisible();
  await viewOldPlanButton.click();
  await expect(dialog.getByText('基于修改前的配置', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '使用此方案', exact: true })).toBeDisabled();
});

test('AI Studio 资产选择支持图片、视频和音频混选并提交参考素材', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'AI Studio', exact: true }).click();

  await expect(page.getByText('最多9张图片 / 最多3个视频（总时长≤15s） / 最多3个音频（总时长≤15s）', { exact: true })).toBeVisible();
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择数字资产' })).toBeVisible();
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('tab', { name: 'AI视频' }).click();
  await expect(page.getByText('品牌故事视频', { exact: true }).locator('../..').getByText('15s', { exact: true })).toBeVisible();
  await page.getByText('品牌故事视频', { exact: true }).click();
  await page.getByRole('tab', { name: '已上传音频' }).click();
  await expect(page.getByText('参考配乐', { exact: true }).locator('../..').getByText('15s', { exact: true })).toBeVisible();
  await page.getByText('参考配乐', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();

  await expect(page.getByRole('button', { name: '生成视频 · 85 积分' })).toBeVisible();

  await expect(page.getByText('已选择 1 张图片、1 个视频、1 个音频').first()).toBeVisible();
  await page.getByText('点击可重新选择参考素材').click();
  await expect(page.getByRole('heading', { name: '选择数字资产' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认选择（3）' })).toBeVisible();
  await expect(page.getByText('参考商品图', { exact: true }).locator('../..')).toHaveClass(/border-purple-500/);
  await page.getByRole('tab', { name: 'AI视频' }).click();
  await expect(page.getByText('品牌故事视频', { exact: true }).locator('../..')).toHaveClass(/border-purple-500/);
  await page.getByText('品牌故事视频', { exact: true }).click();
  await page.getByRole('tab', { name: '已上传音频' }).click();
  await expect(page.getByText('参考配乐', { exact: true }).locator('../..')).toHaveClass(/border-purple-500/);
  await page.getByRole('button', { name: /确认选择/ }).click();
  await expect(page.getByRole('button', { name: '生成视频 · 70 积分' })).toBeVisible();

  await page.getByText('点击可重新选择参考素材').click();
  await page.getByRole('tab', { name: 'AI视频' }).click();
  await page.getByText('品牌故事视频', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();
  await expect(page.getByRole('button', { name: '生成视频 · 85 积分' })).toBeVisible();

  const videoPrompt = page.getByPlaceholder('详细描述你想生成的视频内容、场景、风格...');
  await videoPrompt.click();
  await videoPrompt.fill('@');
  const referenceMenu = page.getByTestId('reference-mention-menu');
  await expect(referenceMenu).toBeVisible();
  await expect(referenceMenu).toHaveCSS('opacity', '1');
  const firstMenuBox = await referenceMenu.boundingBox();
  expect(firstMenuBox).not.toBeNull();

  await videoPrompt.fill('产品展示 @');
  await expect.poll(async () => (await referenceMenu.boundingBox())?.x ?? 0)
    .toBeGreaterThan((firstMenuBox?.x ?? 0) + 32);

  const singleLineMenuBox = await referenceMenu.boundingBox();
  expect(singleLineMenuBox).not.toBeNull();
  await videoPrompt.fill('第一行\n第二行 @');
  await expect.poll(async () => (await referenceMenu.boundingBox())?.y ?? 0)
    .toBeGreaterThan((singleLineMenuBox?.y ?? 0) + 12);

  const promptBox = await videoPrompt.boundingBox();
  const multilineMenuBox = await referenceMenu.boundingBox();
  expect(promptBox).not.toBeNull();
  expect(multilineMenuBox).not.toBeNull();
  expect(multilineMenuBox!.y).toBeLessThan(promptBox!.y + promptBox!.height - 16);
  expect(multilineMenuBox!.x).toBeGreaterThanOrEqual(promptBox!.x);
  expect(multilineMenuBox!.x + multilineMenuBox!.width).toBeLessThanOrEqual(promptBox!.x + promptBox!.width + 1);
  await expect(page.locator('button').filter({ has: page.getByText('图片1', { exact: true }) }).filter({ has: page.getByText('参考商品图', { exact: true }) })).toBeVisible();
  await expect(page.locator('button').filter({ has: page.getByText('视频1', { exact: true }) }).filter({ has: page.getByText('品牌故事视频', { exact: true }) })).toBeVisible();
  await expect(page.locator('button').filter({ has: page.getByText('音频1', { exact: true }) }).filter({ has: page.getByText('参考配乐', { exact: true }) })).toBeVisible();
  await referenceMenu.getByRole('option').first().click();
  await expect(videoPrompt).toHaveValue('第一行\n第二行 @图片1 ');
  await expect(videoPrompt).toBeFocused();
  await expect(referenceMenu).toHaveCount(0);
  await videoPrompt.fill('用参考图片、参考视频和参考音频生成一段产品展示视频');
  await page.getByRole('button', { name: /生成视频 · \d+ 积分/ }).click();

  await expect.poll(async () => page.evaluate(() => (window as any).__getLastGenerationRequest())).not.toBeNull();
  const request = await page.evaluate(() => (window as any).__getLastGenerationRequest());
  expect((request as any).references).toEqual(expect.arrayContaining([
    { assetId: mockUuid('asset-ref-image'), role: 'reference_image' },
    { assetId: mockUuid('asset-brand'), role: 'reference_video' },
    { assetId: mockUuid('asset-ref-audio'), role: 'reference_audio' },
  ]));
  expect((request as any).config.referenceAssets).toBeUndefined();
  expect((request as any).config.referenceImages).toBeUndefined();
  expect(JSON.stringify(request)).not.toMatch(/objectKey|thumbnailKey|publicUrl/);
});

test('AI Studio 首尾帧从数字资产选择图片并提交首尾帧引用', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'AI Studio', exact: true }).click();

  await page.getByRole('button', { name: '参考模式：全能参考', exact: true }).click();
  await page.getByRole('option', { name: /首尾帧/ }).click();
  await page.getByRole('button', { name: '选择首帧图片' }).click();
  await expect(page.getByRole('heading', { name: '选择数字资产' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'AI视频' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '已上传视频' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '已上传音频' })).toHaveCount(0);
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();

  await expect(page.getByRole('button', { name: '重新选择首帧图片' })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择尾帧图片' })).toBeVisible();
  await expect(page.getByText('首帧', { exact: true })).toBeVisible();
  await expect(page.getByText('参考商品图', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: '重新选择首帧图片' }).click();
  await expect(page.getByRole('heading', { name: '选择数字资产' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认选择（1）' })).toBeVisible();
  await expect(page.locator('button').filter({ hasText: '参考商品图' }).first()).toHaveClass(/border-purple-500/);
  await page.getByRole('button', { name: /确认选择/ }).click();

  await page.getByRole('button', { name: '选择尾帧图片' }).click();
  await expect(page.getByRole('heading', { name: '选择数字资产' })).toBeVisible();
  await page.getByText('参考收尾图', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();

  await expect(page.getByRole('button', { name: '重新选择首帧图片' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新选择尾帧图片' })).toBeVisible();
  await expect(page.getByText('尾帧', { exact: true })).toBeVisible();
  await expect(page.getByText('参考收尾图', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: '重新选择尾帧图片' }).click();
  await expect(page.getByRole('heading', { name: '选择数字资产' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认选择（1）' })).toBeVisible();
  await expect(page.locator('button').filter({ hasText: '参考收尾图' }).first()).toHaveClass(/border-purple-500/);
  await page.getByRole('button', { name: /确认选择/ }).click();

  await page.getByRole('button', { name: '清除尾帧图片' }).click();
  await expect(page.getByRole('button', { name: '重新选择首帧图片' })).toBeVisible();
  await expect(page.getByText('首帧', { exact: true })).toBeVisible();
  await expect(page.getByText('参考商品图', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '选择尾帧图片' })).toBeVisible();
  await expect(page.getByText('尾帧', { exact: true })).toHaveCount(0);
  await expect(page.getByText('参考收尾图', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '选择尾帧图片' }).click();
  await expect(page.getByRole('heading', { name: '选择数字资产' })).toBeVisible();
  await page.getByText('参考收尾图', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();

  await expect(page.getByRole('button', { name: '重新选择尾帧图片' })).toBeVisible();
  await expect(page.getByText('尾帧', { exact: true })).toBeVisible();
  await page.getByPlaceholder('详细描述你想生成的视频内容、场景、风格...').fill('从首帧商品图自然转场到尾帧收尾图');
  await page.getByRole('button', { name: /生成视频 · \d+ 积分/ }).click();

  await expect.poll(async () => page.evaluate(() => (window as any).__getLastGenerationRequest())).not.toBeNull();
  const request = await page.evaluate(() => (window as any).__getLastGenerationRequest());
  const config = (request as any).config;
  expect(config.mode).toBe('first-last');
  expect((request as any).references).toEqual([
    { assetId: mockUuid('asset-ref-image'), role: 'first_frame' },
    { assetId: mockUuid('asset-ref-last-image'), role: 'last_frame' },
  ]);
  expect(config.referenceAssets).toBeUndefined();
  expect(config.referenceImages).toBeUndefined();
  expect(JSON.stringify(request)).not.toMatch(/objectKey|thumbnailKey|publicUrl/);
});

test('AI Studio 生成队列支持连续提交、切页保留和失败任务展示', async ({ page }) => {
  await page.evaluate(() => (window as any).__setGenerationTasks([]));
  await page.goto('/app');
  await page.getByRole('button', { name: 'AI Studio', exact: true }).click();

  const prompt = page.getByPlaceholder('详细描述你想生成的视频内容、场景、风格...');
  const generateButton = page.getByTestId('ai-studio-video-generate-button');
  const heldFirstRequest = await holdFirstApiRequest(page, '**/api/ai/video-tasks/batch');

  await prompt.fill('第一条测试视频');
  await generateButton.click({ clickCount: 2 });
  await expect.poll(() => heldFirstRequest.requestCount).toBe(1);
  await expect(generateButton).toHaveAccessibleName('提交中...');
  await expect(generateButton).toHaveAttribute('aria-busy', 'true');
  await expect(generateButton).toBeDisabled();
  heldFirstRequest.release();
  await expect(generateButton).toHaveAccessibleName('已加入队列 ✓');
  await expect(generateButton).toBeDisabled();
  await expect(page.getByText(/已加入生成队列/)).toHaveCount(0);
  await expect(generateButton).toHaveAccessibleName(/生成视频 · \d+ 积分/, { timeout: 2_000 });
  await expect(generateButton).toBeEnabled();

  await prompt.fill('第二条失败测试视频');
  await generateButton.click();
  await expect(generateButton).toHaveAccessibleName('已加入队列 ✓');
  await expect(generateButton).toBeDisabled();
  await expect(generateButton).toHaveAccessibleName(/生成视频 · \d+ 积分/, { timeout: 2_000 });
  await expect(generateButton).toBeEnabled();

  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('POST /api/ai/video-tasks/batch'))).toBe(2);
  await expect(page.getByText('2 个任务')).toBeVisible();
  await expect(page.getByText('07-01 10:01')).toBeVisible();
  await expect(page.getByText('07-01 10:02')).toBeVisible();

  const firstTaskBox = await page.getByText('07-01 10:01').boundingBox();
  const secondTaskBox = await page.getByText('07-01 10:02').boundingBox();
  if (!firstTaskBox || !secondTaskBox) throw new Error('生成队列任务时间未渲染');
  const taskTimes = await page.getByTestId('ai-studio-result-card').locator('p').filter({ hasText: /07-01 10:0[12]/ }).allTextContents();
  expect(taskTimes).toEqual(['07-01 10:02', '07-01 10:01']);

  await expect(page.getByText('供应商返回失败')).toBeVisible();
  await expect(page.getByText('已退 20 / 预扣 20 积分', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '仪表盘', exact: true }).click();
  await page.getByRole('button', { name: 'AI Studio', exact: true }).click();

  await expect(page.getByText('2 个任务')).toBeVisible();
  await expect(page.getByText('供应商返回失败')).toBeVisible();
  await expect(page.getByRole('button', { name: /生成视频 · \d+ 积分/ })).toBeEnabled();
});

test('AI Studio 视频与图片提交失败时立即恢复按钮并保留错误提示', async ({ page }) => {
  await page.goto('/app/ai-studio');

  await page.route('**/api/ai/video-tasks/batch', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      message: '模拟视频提交失败',
      code: 'VIDEO_GENERATION_UNAVAILABLE',
      requestId: 'e2e-video-generation-failure',
    }),
  }));
  await page.getByPlaceholder('详细描述你想生成的视频内容、场景、风格...').fill('验证视频失败反馈');
  const videoGenerateButton = page.getByTestId('ai-studio-video-generate-button');
  await videoGenerateButton.click();
  await expect(page.getByText('模拟视频提交失败', { exact: true })).toBeVisible();
  await expect(videoGenerateButton).toHaveAccessibleName(/生成视频 · \d+ 积分/);
  await expect(videoGenerateButton).toBeEnabled();
  await expect(videoGenerateButton).not.toHaveAccessibleName('已加入队列 ✓');

  await page.getByRole('tab', { name: 'AI 图片' }).click();
  await page.route('**/api/ai/image-tasks/batch', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      message: '模拟图片提交失败',
      code: 'IMAGE_GENERATION_UNAVAILABLE',
      requestId: 'e2e-image-generation-failure',
    }),
  }));
  await page.getByLabel('图片描述').fill('验证图片失败反馈');
  const imageGenerateButton = page.getByTestId('ai-studio-image-generate-button');
  await imageGenerateButton.click();
  await expect(page.getByText('模拟图片提交失败', { exact: true })).toBeVisible();
  await expect(imageGenerateButton).toHaveAccessibleName(/生成图片 · \d+ 积分/);
  await expect(imageGenerateButton).toBeEnabled();
  await expect(imageGenerateButton).not.toHaveAccessibleName('已加入队列 ✓');
});

test('AI Studio 生成队列不依赖资产卡片页并按需加载可播放详情', async ({ page }) => {
  const previewUrl = `https://cdn.example.com/${assetBrandId}.mp4`;
  const heldPreview = await holdMediaRequest(page, previewUrl);
  await page.evaluate((items) => (window as any).__setGenerationTasks(items), [{
    ...job('管理员', 'admin@lindyson.ai'),
    id: 'job-queue-preview-detail',
    assetId: 'asset-brand',
    assetName: '品牌故事视频',
    assetSource: 'ai-video',
  }]);

  await page.goto('/app/ai-studio');
  await expect(page.getByRole('heading', { name: 'AI Studio' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window as any
  ).__getApiRequestCount('GET /api/assets/cards'))).toBe(0);

  const completedQueueItem = page.locator('div.group')
    .filter({ hasText: 'Seedance 2.0' })
    .filter({ hasText: '完成' })
    .first();
  await expect(completedQueueItem).toBeVisible();
  await completedQueueItem.click();

  await expect.poll(() => page.evaluate(id => (
    window as any
  ).__getApiRequestCount(`GET /api/assets/${id}`), assetBrandId)).toBe(1);
  await expect(page.getByRole('heading', { name: '素材预览' })).toBeVisible();
  const previewVideo = page.getByLabel('视频预览 品牌故事视频');
  await expect(previewVideo).toBeVisible();
  await expect(previewVideo).toHaveAttribute('src', previewUrl);
  await expect.poll(() => heldPreview.requestedUrls).toContain(previewUrl);

  heldPreview.release();
});

test('AI Studio 已缓存资产卡片时仍加载视频详情而不把缩略图卡片当详情', async ({ page }) => {
  const previewUrl = `https://cdn.example.com/${assetBrandId}.mp4`;
  const heldPreview = await holdMediaRequest(page, previewUrl);
  await page.evaluate((items) => (window as any).__setGenerationTasks(items), [{
    ...job('管理员', 'admin@lindyson.ai'),
    id: 'job-queue-preview-cached-card',
    assetId: 'asset-brand',
    assetName: '品牌故事视频',
    assetSource: 'ai-video',
  }]);

  await page.goto('/app/digital-assets');
  await expect(page.getByText('品牌故事视频', { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window as any
  ).__getApiRequestCount('GET /api/assets/cards'))).toBe(1);
  await expect.poll(() => page.evaluate(id => (
    window as any
  ).__getApiRequestCount(`GET /api/assets/${id}`), assetBrandId)).toBe(0);

  await page.getByRole('button', { name: 'AI Studio', exact: true }).click();
  const completedQueueItem = page.locator('div.group')
    .filter({ hasText: 'Seedance 2.0' })
    .filter({ hasText: '完成' })
    .first();
  await completedQueueItem.click();

  await expect.poll(() => page.evaluate(id => (
    window as any
  ).__getApiRequestCount(`GET /api/assets/${id}`), assetBrandId)).toBe(1);
  const previewVideo = page.getByLabel('视频预览 品牌故事视频');
  await expect(previewVideo).toBeVisible();
  await expect(previewVideo).toHaveAttribute('src', previewUrl);
  await expect(page.getByText('素材还没有可播放视频地址')).toHaveCount(0);

  heldPreview.release();
});

test('AI Studio 排队中和生成中的任务均不提供取消操作', async ({ page }) => {
  await page.evaluate((items) => (window as any).__setGenerationTasks(items), [
    {
      ...job('管理员', 'admin@lindyson.ai'),
      id: 'job-queued',
      status: 'queued',
      creditStatus: 'held',
      settledCredits: 0,
      refundedCredits: 0,
    },
    {
      ...job('管理员', 'admin@lindyson.ai'),
      id: 'job-processing',
      status: 'processing',
      creditStatus: 'held',
      settledCredits: 0,
      refundedCredits: 0,
    },
  ]);
  await page.goto('/app');
  await page.getByRole('button', { name: 'AI Studio', exact: true }).click();

  await expect(page.getByText('排队中', { exact: true })).toBeVisible();
  await expect(page.getByText('生成中', { exact: true })).toBeVisible();
  await expect(page.getByText('冻结 20 积分', { exact: true })).toHaveCount(2);
  await expect(page.locator('button[title="取消任务"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /取消/ })).toHaveCount(0);
});

test('AI Studio 生成队列只加载当前服务端页并支持四向分页', async ({ page }) => {
  const tasks = Array.from({ length: 41 }, (_, index) => {
    const minute = 41 - index;
    return {
      ...job('管理员', 'admin@lindyson.ai'),
      id: `job-history-${minute}`,
      createdAt: `2026-07-01T09:${String(minute).padStart(2, '0')}:00`,
      model: 'Seedance 2.0 Mini',
      credits: 10,
      reservedCredits: 10,
      settledCredits: 10,
      mainCreditsUsed: 10,
      config: { aspectRatio: '9:16', resolution: '480p', durationSeconds: 5 },
      prompt: `历史任务 ${minute}`,
    };
  });

  await page.evaluate((items) => (window as any).__setGenerationTasks(items), tasks);
  await page.goto('/app');
  await page.getByRole('button', { name: 'AI Studio', exact: true }).click();

  await expect(page.getByText('共 41 个任务')).toBeVisible();
  await expect(page.getByText('07-01 09:41')).toBeVisible();
  await expect(page.getByText('07-01 09:30')).toBeVisible();
  await expect(page.getByText('07-01 09:29')).toBeHidden();

  const queuePager = page.getByRole('navigation', { name: '视频生成队列翻页' });
  await expect(queuePager.getByRole('status', { name: '第 1 页，共 4 页' })).toBeVisible();
  await queuePager.getByRole('button', { name: '尾页' }).click();
  await expect(page.getByText('共 41 个任务')).toBeVisible();
  await expect(queuePager.getByRole('status', { name: '第 4 页，共 4 页' })).toBeVisible();
  await expect(page.getByText('07-01 09:01')).toBeVisible();
  await expect(page.getByText('07-01 09:41')).toBeHidden();

  await queuePager.getByRole('button', { name: '上一页' }).click();
  await expect(queuePager.getByRole('status', { name: '第 3 页，共 4 页' })).toBeVisible();
  await expect(page.getByText('07-01 09:17')).toBeVisible();
  await queuePager.getByRole('button', { name: '首页' }).click();
  await expect(queuePager.getByRole('status', { name: '第 1 页，共 4 页' })).toBeVisible();
  await expect(page.getByText('07-01 09:41')).toBeVisible();

  const prompt = page.getByPlaceholder('详细描述你想生成的视频内容、场景、风格...');
  const generateButton = page.getByRole('button', { name: /生成视频 · \d+ 积分/ });
  await prompt.fill('分页后提交新任务');
  await generateButton.click();

  await expect(generateButton).toBeEnabled();
  await expect(page.getByText('共 42 个任务')).toBeVisible();
  await expect(page.getByText('07-01 10:01')).toBeVisible();
});

test('精准分页快照失效时保留内容、只提示一次并自动回首页', async ({ page }) => {
  const tasks = Array.from({ length: 14 }, (_, index) => ({
    ...job('管理员', 'admin@lindyson.ai'),
    id: `snapshot-job-${index + 1}`,
    createdAt: `2026-07-01T09:${String(59 - index).padStart(2, '0')}:00`,
    prompt: `快照任务 ${index + 1}`,
  }));
  await page.evaluate(items => (window as any).__setGenerationTasks(items), tasks);
  await page.evaluate(() => (window as any).__failNextPaginationSnapshot());
  await page.goto('/app/ai-studio');

  const pager = page.getByRole('navigation', { name: '视频生成队列翻页' });
  await expect(pager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  await pager.getByRole('button', { name: '下一页' }).click();

  await expect(page.getByText('列表已更新，已返回第 1 页', { exact: true })).toBeVisible();
  await expect(page.getByText('07-01 09:59')).toBeVisible();
  await expect(pager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  await expect(page.getByText('列表已更新，已返回第 1 页', { exact: true })).toHaveCount(1);
});

test('精准分页加载时保留旧列表、标记忙碌并禁用重复点击', async ({ page }) => {
  const tasks = Array.from({ length: 14 }, (_, index) => ({
    ...job('管理员', 'admin@lindyson.ai'),
    id: `loading-job-${index + 1}`,
    createdAt: `2026-07-01T09:${String(59 - index).padStart(2, '0')}:00`,
    prompt: `加载任务 ${index + 1}`,
  }));
  await page.evaluate(items => (window as any).__setGenerationTasks(items), tasks);
  await page.goto('/app/ai-studio');

  const pager = page.getByRole('navigation', { name: '视频生成队列翻页' });
  await expect(pager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  const heldRequest = await holdFirstApiRequest(page, '**/api/ai/tasks?**');
  await pager.getByRole('button', { name: '下一页' }).click();

  await expect.poll(() => heldRequest.requestCount).toBe(1);
  await expect(pager).toHaveAttribute('aria-busy', 'true');
  for (const name of ['首页', '上一页', '下一页', '尾页']) {
    await expect(pager.getByRole('button', { name })).toBeDisabled();
  }
  await expect(page.getByText('07-01 09:59')).toBeVisible();
  await expect(pager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();

  heldRequest.release();
  await expect(pager).toHaveAttribute('aria-busy', 'false');
  await expect(pager.getByRole('status', { name: '第 2 页，共 2 页' })).toBeVisible();
  await expect(page.getByText('07-01 09:47')).toBeVisible();
});

test('轻量分页隐藏单页导航且在关键宽度与 200% 文本缩放下不溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(items => (window as any).__setGenerationTasks(items), [
    {
      ...job('管理员', 'admin@lindyson.ai'),
      id: 'single-page-job',
      createdAt: '2026-07-01T09:59:00',
    },
  ]);
  await page.goto('/app/ai-studio');

  const pager = page.getByRole('navigation', { name: '视频生成队列翻页' });
  await expect(page.getByText('共 1 个任务', { exact: true })).toBeVisible();
  await expect(pager).toHaveCount(0);
  await page.evaluate(items => (window as any).__setGenerationTasks(items), Array.from({ length: 14 }, (_, index) => ({
    ...job('管理员', 'admin@lindyson.ai'),
    id: `responsive-job-${index}`,
    createdAt: `2026-07-01T09:${String(59 - index).padStart(2, '0')}:00`,
  })));
  await page.reload();
  await expect(pager.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  const dockBox = await pager.locator('[role="group"]').boundingBox();
  expect(dockBox).not.toBeNull();
  expect(dockBox!.width).toBeLessThanOrEqual(340);
  expect(dockBox!.height).toBe(32);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  for (const width of [1440, 1500, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await pager.evaluate(element => {
      const dock = element.querySelector('[role="group"]');
      const navRect = element.getBoundingClientRect();
      const dockRect = dock?.getBoundingClientRect();
      return {
        navLeft: navRect.left,
        navRight: navRect.right,
        dockLeft: dockRect?.left ?? -1,
        dockRight: dockRect?.right ?? -1,
        dockHeight: dockRect?.height ?? -1,
      };
    });
    expect(bounds.dockLeft).toBeGreaterThanOrEqual(bounds.navLeft);
    expect(bounds.dockRight).toBeLessThanOrEqual(bounds.navRight + 0.5);
    expect(bounds.dockHeight).toBe(32);
  }
});

test('TikTok 发布素材选择支持图片组或单视频且不混选', async ({ page }) => {
  const cardRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/assets/cards') cardRequests.push(request.url());
  });

  // 先制造数字资产旧筛选，验证进入 TikTok 后不会复用其分类、目录或搜索词。
  await page.goto('/app/digital-assets?source=uploaded-image&folder=root&q=%E5%8F%82%E8%80%83');
  await expect.poll(() => cardRequests.length).toBeGreaterThan(0);
  const digitalAssetRequestCount = cardRequests.length;
  await page.getByRole('button', { name: '发布至 TikTok', exact: true }).click();
  await expect(page.getByRole('heading', { name: '发布至 TikTok 账号' })).toBeVisible();
  await page.waitForTimeout(50);
  expect(cardRequests).toHaveLength(digitalAssetRequestCount);

  await page.getByText('从数字资产选择素材').click();
  const picker = page.getByRole('dialog', { name: '选择数字资产' });
  await expect(picker).toBeVisible();
  await expect.poll(() => cardRequests.length).toBeGreaterThan(digitalAssetRequestCount);
  const firstPickerRequest = new URL(cardRequests.at(-1)!);
  expect(firstPickerRequest.searchParams.get('limit')).toBe('24');
  expect(firstPickerRequest.searchParams.get('source')).toBe('ai-video');
  expect(firstPickerRequest.searchParams.get('folderId')).toBe(rootVideoFolderId);
  expect(firstPickerRequest.searchParams.get('search')).toBeNull();
  await expect(picker.locator('.pagination-summary')).toHaveText(/^共 \d+ 个$/);
  await expect(picker.getByRole('navigation', { name: '资产选择器翻页' })).toHaveCount(0);
  await expect(picker.getByRole('status', { name: '第 1 页，共 1 页' })).toHaveCount(0);

  await expect(picker.getByRole('tab', { name: '已上传音频' })).toHaveCount(0);
  await picker.getByRole('tab', { name: '已上传图片' }).click();
  await picker.getByText('参考商品图', { exact: true }).click();
  await picker.getByRole('tab', { name: 'AI视频' }).click();
  await expect(picker.getByText('品牌故事视频', { exact: true }).locator('../..')).toHaveAttribute('aria-disabled', 'true');
  await picker.getByRole('button', { name: /确认选择/ }).click();

  await expect(page.getByText('已选择 1 张图片').first()).toBeVisible();
});

test('TikTok 工作区在 390px 窄屏纵向排布且账号表格局部滚动', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/tiktok-publish');

  const publishHeading = page.getByRole('heading', { name: '发布至 TikTok 账号' });
  const publishListHeading = page.getByRole('heading', { name: '发布列表' });
  await expect(publishHeading).toBeVisible();
  await expect(publishListHeading).toBeVisible();
  const [publishHeadingBox, publishListHeadingBox] = await Promise.all([
    publishHeading.boundingBox(),
    publishListHeading.boundingBox(),
  ]);
  expect(publishHeadingBox).not.toBeNull();
  expect(publishListHeadingBox).not.toBeNull();
  expect(publishListHeadingBox!.y).toBeGreaterThan(publishHeadingBox!.y + publishHeadingBox!.height);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.goto('/app/tiktok-accounts');
  const accountTableRegion = page.getByRole('region', { name: 'TikTok 账号列表' });
  await expect(accountTableRegion).toBeVisible();
  await expect.poll(() => accountTableRegion.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const authorizeButton = page.getByRole('button', { name: '新增授权' });
  await authorizeButton.click();
  await expect(page.getByRole('dialog', { name: '新增授权' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '新增授权' })).toHaveCount(0);
  await expect(authorizeButton).toBeFocused();
});

test('支付通道可安全保存且界面不展示内部适配器名称', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: '支付通道' }).click();

  await expect(page.getByRole('heading', { name: '支付通道' })).toBeVisible();
  await page.getByLabel('API 基础地址').fill('https://pay.example.com');
  await page.getByLabel('商户号').fill('M100000');
  await page.getByLabel('应用 ID').fill('APP100000');
  await page.getByLabel('API 密钥').fill('secret-value');
  await page.getByRole('switch').click();
  await page.getByRole('button', { name: '保存配置' }).click();
  await page.getByRole('button', { name: '保存并启用' }).click();

  await expect(page.getByText('支付通道已保存并启用')).toBeVisible();
  await expect(page.getByText('已启用', { exact: true }).first()).toBeVisible();
  await expect(page.getByPlaceholder('已配置，留空表示不修改')).toHaveValue('');
  await expect(page.locator('body')).not.toContainText(/jeepay/i);
  await expect.poll(() => page.evaluate(() => (window as any).__getApiRequestCount('PUT /api/admin/payment-channel'))).toBe(1);
});

test('管理后台侧边栏低高度下不与底部操作重叠', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto('/admin');

  const sidebarNav = page.locator('aside nav');
  const refreshButton = page.getByRole('button', { name: '刷新数据' });
  const exitButton = page.getByRole('button', { name: '返回用户端' });

  await expect(page.getByRole('heading', { name: '管理员仪表盘' })).toBeVisible();
  await expect(refreshButton).toBeVisible();
  await expect(exitButton).toBeVisible();

  const sidebarNavBox = await sidebarNav.boundingBox();
  const refreshButtonBox = await refreshButton.boundingBox();
  const exitButtonBox = await exitButton.boundingBox();
  if (!sidebarNavBox || !refreshButtonBox || !exitButtonBox) {
    throw new Error('管理后台侧边栏布局元素未能完成渲染');
  }

  expect(sidebarNavBox.y + sidebarNavBox.height).toBeLessThanOrEqual(refreshButtonBox.y);
  expect(refreshButtonBox.y + refreshButtonBox.height).toBeLessThanOrEqual(exitButtonBox.y);
  await expect
    .poll(() => sidebarNav.evaluate(element => element.scrollHeight > element.clientHeight))
    .toBe(true);
});

test('管理后台侧边栏提示和工单未读标签可用', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '管理员仪表盘' })).toBeVisible();
  await expect(page.getByTestId('admin-nav-badge-tickets')).toHaveText('1');
  await expect(page.getByTestId('admin-nav-badge-invoices')).toHaveText('1');

  await page.getByRole('button', { name: '返回用户端' }).click();
  await page.getByRole('button', { name: /联系客服/ }).click();
  await page.getByPlaceholder('继续补充问题或回复客服').fill('请后台查看未读颜色。');
  await page.getByRole('button', { name: '发送回复' }).click();
  await expect(page.locator('p').filter({ hasText: '请后台查看未读颜色。' }).last()).toBeVisible();
  await page.getByLabel('关闭客服窗口').click();

  await page.goto('/admin');
  await page.getByRole('button', { name: '工单管理' }).click();
  const unreadBadge = page.getByText('1 新消息', { exact: true });
  await expect(unreadBadge).toBeVisible();
  await expect(unreadBadge).toHaveClass(/bg-pink-500\/25/);
  await expect(unreadBadge).toHaveClass(/text-pink-100/);

  await page.getByRole('button', { name: '关闭', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '确认关闭工单？' })).toBeVisible();
  await page.getByRole('button', { name: '关闭工单' }).click();
  await expect(page.getByText('工单已关闭')).toBeVisible();
  await expect(page.getByTestId('admin-nav-badge-tickets')).toHaveCount(0);

  await page.getByRole('button', { name: '发票管理' }).click();
  await expect(page.getByRole('heading', { name: '发票管理' })).toBeVisible();
  await expect(page.getByTestId('admin-nav-badge-invoices')).toHaveText('1');
  await page.getByRole('button', { name: '确认已开票并已发送', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '确认已人工开票并发送？' })).toBeVisible();
  await expect(page.getByText(/人工发送至 admin@lindyson\.ai/)).toBeVisible();
  await expect(page.getByText(/系统不会发送邮件或附件/)).toBeVisible();
  await page.getByRole('button', { name: '确认已开票并已发送' }).last().click();
  await expect(page.getByText('已记录人工开票和发送状态')).toBeVisible();
  await expect(page.getByTestId('admin-nav-badge-invoices')).toHaveCount(0);
});

test('管理后台侧边栏刷新数据会更新当前页面且不预加载完整成本报表', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: '发票管理' }).click();
  await expect(page.getByRole('heading', { name: '发票管理' })).toBeVisible();
  await expect(page.getByText(mockUuid('invoice-refresh'))).toHaveCount(0);

  const beforeApiUsageCount = await page.evaluate(() => (window as any).__getApiRequestCount('GET /api/admin/api-usage'));
  await page.evaluate(() => (window as any).__setAdminRefreshScenario('fresh-data'));

  const refreshButton = page.getByRole('button', { name: '刷新数据' });
  await refreshButton.click();
  await expect(page.getByText('后台数据已刷新')).toBeVisible();
  await expect(refreshButton).toBeEnabled();

  const afterApiUsageCount = await page.evaluate(() => (window as any).__getApiRequestCount('GET /api/admin/api-usage'));
  expect(afterApiUsageCount).toBe(beforeApiUsageCount);
  await expect(page.getByText(mockUuid('invoice-refresh'))).toBeVisible();
  await expect(page.getByText('刷新后新增发票')).toBeVisible();
});

test('管理后台侧边栏刷新失败会提示并保留页面', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: '订阅套餐', exact: true }).click();
  await expect(page.getByRole('heading', { name: '订阅套餐管理' })).toBeVisible();

  await page.evaluate(() => (window as any).__setAdminRefreshScenario('fail-next-admin-plans'));
  const refreshButton = page.getByRole('button', { name: '刷新数据' });
  await refreshButton.click();

  await expect(page.getByText('后台数据刷新失败')).toBeVisible();
  await expect(refreshButton).toBeEnabled();
  await expect(page.getByRole('heading', { name: '订阅套餐管理' })).toBeVisible();
});

test('管理后台导航、积分消耗和订单筛选可用', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '管理员仪表盘' })).toBeVisible();

  await page.getByRole('button', { name: '积分消耗' }).click();
  await expect(page.getByRole('heading', { name: '积分消耗', exact: true })).toBeVisible();
  // 按默认 AI Studio 视频规格定位，避免新增图片档位或调整表格顺序后误点其他配置。
  const defaultVideoConsumptionRow = page.getByRole('row')
    .filter({ has: page.getByText('Seedance 2.0', { exact: true }) })
    .filter({ has: page.getByText('15s', { exact: true }) })
    .filter({ has: page.getByText('480p', { exact: true }) })
    .first();
  await defaultVideoConsumptionRow.getByRole('button', { name: '修改积分', exact: true }).click();
  await expect(page.getByLabel('修改视频消耗').getByText('无参考视频', { exact: true })).toBeVisible();
  await page.getByLabel('无参考视频积分').fill('80');
  await page.getByLabel('含参考视频积分').fill('109');
  await page.getByRole('button', { name: '提交修改' }).click();
  await expect(page.getByRole('heading', { name: '确认修改视频消耗？' })).toBeVisible();
  await page.getByRole('button', { name: '确认修改' }).click();
  await expect(page.getByText('视频消耗已更新')).toBeVisible();
  await page.getByRole('button', { name: '返回用户端' }).click();
  await page.getByRole('button', { name: 'AI Studio', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成视频 · 80 积分' })).toBeVisible();
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await page.getByRole('tab', { name: 'AI视频' }).click();
  await page.getByText('品牌故事视频', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();
  // 管理员夹具余额为 100；含参考视频价格更新为 109 后应体现真实缺口，而不是仍显示可生成。
  await expect(page.getByRole('button', { name: '积分不足 · 还差 9' })).toBeVisible();

  await page.goto('/admin');

  await page.getByRole('button', { name: '订单管理' }).click();
  await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible();
  await page.getByRole('tab', { name: '本月' }).click();
  await expect(page.getByText('本月已支付订单金额')).toBeVisible();

  await page.getByRole('button', { name: '成本看盘' }).click();
  await expect(page.getByRole('heading', { name: '成本看盘' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '模型成本汇总' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '用户成本汇总' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '任务成本明细' })).toBeVisible();
  await expect(page.getByText('当前可用人民币余额')).toBeVisible();
  await expect(page.getByText('本期最终实扣积分')).toBeVisible();
  await expect(page.getByText('本期供应商估算成本')).toBeVisible();
  await expect(page.getByText('已知金额已对上，1 项待最终账单确认')).toBeVisible();

  await page.getByRole('button', { name: '高级对账' }).click();
  await expect(page.getByRole('heading', { name: '高级成本对账' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '用量与估值对账矩阵' })).toBeVisible();
  await page.locator('summary').filter({ hasText: '当前资源包实例' }).click();
  await expect(page.getByText('Doubao-Seedance-2.0-在线推理资源包-1000万 tokens')).toBeVisible();
  await expect(page.locator('details').getByText('Ark_bd2000000789744935106')).toBeVisible();
});

test('管理后台生成任务成功资产可直接预览', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      runtimeErrors.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
  await page.addInitScript(() => {
    window.__assetDownloadClicks = [];
    window.__assetDownloadNames = [];
    HTMLAnchorElement.prototype.click = function () {
      window.__assetDownloadClicks.push(this.href);
      window.__assetDownloadNames.push(this.download);
    };
  });
  const brandPreviewUrl = new URL(
    '/tutorials/seedream-interactive-editing.mp4',
    String(testInfo.project.use.baseURL),
  ).toString();
  const longPrompt = Array.from({ length: 18 }, (_, index) => (
    `镜头 ${index + 1}：保持主体、环境光线和产品外观一致，使用自然运镜展示产品细节，并让字幕与口播时间轴严格对齐。`
  )).join('\n\n');
  await page.evaluate(({ id, publicUrl, prompt }) => (
    (window as any).__setAssetPreviewFixture(id, { publicUrl, prompt })
  ), { id: assetBrandId, publicUrl: brandPreviewUrl, prompt: longPrompt });
  await page.evaluate(() => (window as any).__setGenerationTasks([
    {
      id: 'job-admin-asset-preview',
      createdAt: '2026-06-30T10:00:00.000Z',
      userName: 'Pro User',
      email: 'pro.user@lindyson.ai',
      kind: 'video',
      model: 'Seedance 2.0 Mini',
      status: 'completed',
      credits: 35,
      reservedCredits: 35,
      settledCredits: 35,
      refundedCredits: 0,
      creditStatus: 'settled',
      mainCreditsUsed: 35,
      addonCreditsUsed: 0,
      prompt: '生成品牌故事视频',
      config: { aspectRatio: '16:9', resolution: '720p', durationSeconds: 10 },
      retryCount: 0,
      assetId: 'asset-brand',
      assetName: '品牌故事视频',
      completedAt: '2026-06-30T10:02:00.000Z',
      startedAt: '2026-06-30T10:01:00.000Z',
    },
    {
      id: 'job-admin-failed-no-preview',
      createdAt: '2026-06-30T09:00:00.000Z',
      userName: '管理员',
      email: 'admin@lindyson.ai',
      kind: 'video',
      model: 'Seedance 2.0',
      status: 'failed',
      credits: 20,
      reservedCredits: 20,
      settledCredits: 0,
      refundedCredits: 20,
      creditStatus: 'refunded',
      mainCreditsUsed: 20,
      addonCreditsUsed: 0,
      prompt: '生成失败视频',
      config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
      retryCount: 0,
      failureCategory: 'provider-failed',
      failureReason: '供应商失败',
    },
    {
      id: 'job-admin-completed-no-asset',
      createdAt: '2026-06-30T08:00:00.000Z',
      userName: '管理员',
      email: 'admin@lindyson.ai',
      kind: 'video',
      model: 'Seedance 2.0',
      status: 'completed',
      credits: 20,
      reservedCredits: 20,
      settledCredits: 20,
      refundedCredits: 0,
      creditStatus: 'settled',
      mainCreditsUsed: 20,
      addonCreditsUsed: 0,
      prompt: '完成但没有资产',
      config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
      retryCount: 0,
      completedAt: '2026-06-30T08:02:00.000Z',
      startedAt: '2026-06-30T08:01:00.000Z',
    },
  ]));

  await page.goto('/admin');
  await page.getByRole('button', { name: '生成任务', exact: true }).click();
  await expect(page.getByRole('heading', { name: '生成任务监控' })).toBeVisible();

  const completedRow = page.getByRole('row').filter({ hasText: mockUuid('job-admin-asset-preview') });
  const failedRow = page.getByRole('row').filter({ hasText: mockUuid('job-admin-failed-no-preview') });
  const completedNoAssetRow = page.getByRole('row').filter({ hasText: mockUuid('job-admin-completed-no-asset') });

  await expect(completedRow.getByRole('button', { name: '资产' })).toBeEnabled();
  await expect(failedRow.getByRole('button', { name: '资产' })).toBeDisabled();
  await expect(completedNoAssetRow.getByRole('button', { name: '资产' })).toBeDisabled();

  await completedRow.getByRole('button', { name: '资产' }).click();
  await expect.poll(() => page.evaluate(
    id => (window as any).__getApiRequestCount(`GET /api/admin/assets/${id}`),
    assetBrandId,
  )).toBe(1);
  await expect(page.getByRole('heading', { name: '素材预览' })).toBeVisible();
  await expect(page.getByText('品牌故事视频', { exact: true }).nth(1)).toBeVisible();

  const dialog = page.getByRole('dialog');
  const dialogRoot = page.locator('[data-dialog-root="true"]');
  const dialogCard = dialog.locator('[data-ui="card"][data-variant="modal"]');
  await expect(dialogRoot).toHaveAttribute('data-backdrop-blur', 'false');
  await expect(dialogCard).toHaveAttribute('data-backdrop-blur', 'false');
  const compositingStyles = await Promise.all([dialogRoot, dialogCard].map(locator => locator.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      backdropFilter: style.backdropFilter,
      webkitBackdropFilter: style.getPropertyValue('-webkit-backdrop-filter'),
      transform: style.transform,
    };
  })));
  for (const style of compositingStyles) {
    expect(style.backdropFilter).toBe('none');
    expect(['', 'none']).toContain(style.webkitBackdropFilter);
    expect(style.transform).toBe('none');
  }

  const previewVideo = page.getByLabel('视频预览 品牌故事视频');
  await expect(previewVideo).toBeVisible();
  const previewVideoState = await previewVideo.evaluate((video: HTMLVideoElement) => ({
    controls: video.controls,
    src: video.getAttribute('src'),
  }));
  expect(previewVideoState).toEqual({ controls: true, src: brandPreviewUrl });
  await expect.poll(() => previewVideo.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(1);
  await previewVideo.evaluate((video: HTMLVideoElement) => {
    (window as any).__assetPreviewVideoNode = video;
    return video.play();
  });
  await expect.poll(() => previewVideo.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
  const videoTimeBeforeScroll = await previewVideo.evaluate((video: HTMLVideoElement) => video.currentTime);

  const promptScroll = page.getByTestId('asset-preview-prompt-scroll');
  const previewSidebar = dialog.locator('aside');
  const promptLayout = await promptScroll.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      contain: style.contain,
      overscrollBehaviorY: style.overscrollBehaviorY,
      scrollbarGutter: style.scrollbarGutter,
    };
  });
  expect(promptLayout.scrollHeight).toBeGreaterThan(promptLayout.clientHeight);
  expect(promptLayout.contain).toContain('paint');
  expect(promptLayout.overscrollBehaviorY).toBe('contain');
  expect(promptLayout.scrollbarGutter).toContain('stable');

  await promptScroll.hover();
  for (const deltaY of [900, -500, 900, -500]) {
    await page.mouse.wheel(0, deltaY);
  }
  await expect.poll(() => promptScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await promptScroll.evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  const sidebarScrollBeforeBoundaryWheel = await previewSidebar.evaluate(element => element.scrollTop);
  await promptScroll.hover();
  await page.mouse.wheel(0, 900);
  await expect.poll(() => previewSidebar.evaluate(element => element.scrollTop)).toBe(sidebarScrollBeforeBoundaryWheel);

  const videoAfterScroll = await previewVideo.evaluate((video: HTMLVideoElement) => ({
    currentTime: video.currentTime,
    paused: video.paused,
    sameNode: video === (window as any).__assetPreviewVideoNode,
  }));
  expect(videoAfterScroll.sameNode).toBe(true);
  expect(videoAfterScroll.paused).toBe(false);
  expect(videoAfterScroll.currentTime).toBeGreaterThanOrEqual(videoTimeBeforeScroll);
  expect(runtimeErrors).toEqual([]);

  await page.getByRole('button', { name: '下载素材', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__assetDownloadClicks.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__assetDownloadClicks.at(-1))).toMatch(/asset-brand\.mp4$/);
  await expect.poll(() => page.evaluate(() => window.__assetDownloadNames.at(-1))).toBe('品牌故事视频.mp4');
  await expect(page.getByText('素材下载已开始', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(
    id => (window as any).__getApiRequestCount(`POST /api/admin/assets/${id}/download`),
    assetBrandId,
  )).toBe(1);
  await expect.poll(() => page.evaluate(
    id => (window as any).__getApiRequestCount(`POST /api/assets/${id}/download`),
    assetBrandId,
  )).toBe(0);
  await expect.poll(() => page.evaluate(
    id => (window as any).__getApiRequestCount(`GET /api/assets/${id}/download`),
    assetBrandId,
  )).toBe(0);
});

test('真人演员释放和删除使用站内确认弹窗并真正提交请求', async ({ page }) => {
  const actorId = mockUuid('portrait-action-dialog-actor');
  let actor: Record<string, unknown> | null = {
    id: actorId,
    alias: 'Juno',
    planAccessStatus: 'available',
    lifecycleStatus: 'invited',
    authorizationStatus: 'pending',
    authorizationExpiresAt: '2026-10-28T10:00:00.000Z',
    lastSuccessfulGenerationAt: null,
    createdAt: '2026-07-30T10:00:00.000Z',
    updatedAt: '2026-07-30T10:00:00.000Z',
    assets: [],
  };
  let revokeRequests = 0;
  let deleteRequests = 0;
  let nativeDialogCount = 0;
  page.on('dialog', dialog => {
    nativeDialogCount += 1;
    void dialog.dismiss();
  });

  await page.route('**/api/real-portrait-actors**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === '/api/real-portrait-actors' && method === 'GET') {
      const active = actor && actor.lifecycleStatus !== 'revoked' ? 1 : 0;
      await json(route, {
        items: actor ? [actor] : [],
        capacity: {
          sourcePlanCode: 'free',
          sourcePlanName: '免费版',
          entitlements: { enabled: true, profileLimit: 1, activeLimit: 1, assetsPerActor: 1 },
          usage: { profiles: actor ? 1 : 0, active, queued: 0 },
          global: {
            groupSoftLimit: 45,
            assetSoftLimit: 45,
            groupsUsed: 0,
            assetsUsed: 0,
            groupsReserved: active,
            assetsReserved: active,
          },
          quotaState: null,
        },
      });
      return;
    }
    if (path === `/api/real-portrait-actors/${actorId}/revoke` && method === 'POST' && actor) {
      revokeRequests += 1;
      actor = {
        ...actor,
        lifecycleStatus: 'revoked',
        authorizationStatus: 'revoked',
        updatedAt: '2026-07-30T10:05:00.000Z',
      };
      await json(route, { actor });
      return;
    }
    if (path === `/api/real-portrait-actors/${actorId}` && method === 'DELETE') {
      deleteRequests += 1;
      actor = null;
      await json(route, { deleted: true });
      return;
    }
    await route.fallback();
  });

  await page.goto('/app/real-portraits');
  await expect(page.getByRole('heading', { name: '真人演员库' })).toBeVisible();
  await expect(page.getByText('全局共享容量', { exact: true })).toHaveCount(0);
  await expect(page.getByText('套餐权益', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '释放容量' }).click();
  const releaseDialog = page.getByRole('alertdialog');
  await expect(releaseDialog.getByRole('heading', { name: '停止使用并释放容量' })).toBeVisible();
  await expect(releaseDialog.getByRole('button', { name: '取消' })).toBeFocused();
  await releaseDialog.getByRole('button', { name: '确认释放' }).click();
  await expect.poll(() => revokeRequests).toBe(1);
  await expect(releaseDialog).toBeHidden();
  await expect(page.getByText('已停止新生成，远端容量进入异步清理', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '删除档案' }).click();
  const deleteDialog = page.getByRole('alertdialog');
  await expect(deleteDialog.getByRole('heading', { name: '删除真人演员档案' })).toBeVisible();
  await deleteDialog.getByRole('button', { name: '确认删除' }).click();
  await expect.poll(() => deleteRequests).toBe(1);
  await expect(deleteDialog).toBeHidden();
  await expect(page.getByText('真人演员档案已删除，远端素材进入异步清理', { exact: true })).toBeVisible();
  await expect(page.getByText('还没有真人演员')).toBeVisible();
  expect(nativeDialogCount).toBe(0);
});

test('邀约注册：链接邀请码隐藏、切换保留、验证码失败可重试且成功清理', async ({ page }) => {
  const code = 'abcdefghijklmnopqrstuvwx';
  await page.route('**/api/public/referrals/check', route => json(route, { valid: true, message: '邀请有效' }));
  const submitted: Record<string, unknown>[] = [];
  page.on('request', request => { if (request.url().endsWith('/api/auth/register')) submitted.push(request.postDataJSON()); });
  await page.goto(`/register?ref=${code}`);
  await expect(page.getByLabel('邀请码（选填）')).toHaveCount(0);
  await expect(page.getByText(code, { exact: true })).toHaveCount(0);
  await page.goto('/login'); await page.goto('/register');
  await expect(page.getByLabel('邀请码（选填）')).toHaveCount(0);
  await page.getByLabel('用户名').fill('邀请新人');
  await page.getByLabel('邮箱', { exact: true }).fill('referral.new@lindyson.ai');
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送，10 分钟内有效', { exact: true })).toBeVisible();
  await page.getByLabel('邮箱验证码', { exact: true }).fill('000000');
  await page.getByLabel('密码', { exact: true }).fill('mock1234');
  await page.getByLabel('确认密码').fill('mock1234');
  await page.getByRole('button', { name: '注册并进入工作台' }).click();
  await expect(page.getByRole('alert')).toContainText('验证码错误');
  await page.getByLabel('邮箱验证码', { exact: true }).fill(registerCode);
  await page.getByRole('button', { name: '注册并进入工作台' }).click();
  await expect(page).toHaveURL(/\/app$/);
  expect(submitted).toHaveLength(2);
  expect(submitted.every(body => body.referralCode === code)).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem('lindyson:registration-referral'))).toBeNull();
});

test('邀约注册：无效链接明确提示并允许取消，普通注册可手填邀请码', async ({ page }) => {
  await page.route('**/api/public/referrals/check', route => json(route, { valid: false, message: '邀请已失效或活动已关闭，可取消邀请后继续注册' }));
  await page.goto('/register?ref=invalid');
  await expect(page.getByRole('alert')).toContainText('邀请已失效');
  await expect(page.getByLabel('邀请码（选填）')).toHaveCount(0);
  await page.getByRole('button', { name: '取消邀请，继续普通注册' }).click();
  await expect(page.getByLabel('邀请码（选填）')).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
  await page.route('**/api/public/referrals/check', route => json(route, { valid: true, message: '邀请有效' }));
  const submitted = page.waitForRequest(request => request.url().endsWith('/api/auth/register'));
  await page.getByLabel('邀请码（选填）').fill('AB12CD34');
  await page.getByLabel('用户名').fill('手填新人');
  await page.getByLabel('邮箱', { exact: true }).fill('referral.manual@lindyson.ai');
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送，10 分钟内有效', { exact: true })).toBeVisible();
  await page.getByLabel('邮箱验证码', { exact: true }).fill(registerCode);
  await page.getByLabel('密码', { exact: true }).fill('mock1234');
  await page.getByLabel('确认密码').fill('mock1234');
  await page.getByRole('button', { name: '注册并进入工作台' }).click();
  expect((await submitted).postDataJSON().referralCode).toBe('AB12CD34');
  await expect(page).toHaveURL(/\/app$/);
});

const referralPreviewRecord = {
  id: '98765432-1234-4234-8234-123456789012', inviter: 'creator@lindyson.test', invitee: 'l***@example.com',
  createdAt: '2026-09-20T10:00:00.000Z', orderId: '98765432-1234-4234-8234-123456789013', refundedAt: null,
  status: 'rewarded', inviterCredits: 500, inviteeCredits: 500, granted: 1000, reversed: 0, held: 0, consumed: 0, reviewNote: null,
};
function referralPreviewPage(item = referralPreviewRecord) {
  return { items: [item], pagination: { limit: 20, hasPrevious: false, hasNext: false, previousCursor: null, nextCursor: null, currentPage: 1, totalPages: 1, totalItems: 1, snapshotCursor: 'referral-preview-snapshot' } };
}

test('邀约奖励用户页面：按需加载、分享、脱敏与移动端展示', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/api/account/referrals/summary', route => json(route, { code: 'AB12CD34', settings: { enabled: true, inviterCredits: 500, inviteeCredits: 500 }, invited: 1, earned: 500 }));
  await page.route('**/api/account/referrals?*', route => json(route, referralPreviewPage()));
  await page.goto('/app/dashboard');
  const entry = page.locator('#app-sidebar').getByRole('button', { name: '邀约奖励', exact: true });
  await entry.click();
  await expect(page.getByRole('tab', { name: '邀约奖励', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(entry).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('限新用户注册时绑定，每位新用户奖励一次。奖励长期有效。', { exact: true })).toBeVisible();
  expect(await page.locator('#app-sidebar').getByRole('button', { name: '订阅套餐', exact: true }).evaluate(element => element.nextElementSibling?.textContent)).toBe('邀约奖励');
  await expect(page.getByRole('heading', { name: '分享你的专属邀请' })).toBeVisible();
  await expect(page.getByText('l***@example.com', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '复制邀请链接' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('/register?ref=AB12CD34');
  await expect(page.getByText('邀请链接已复制', { exact: true })).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: 'artifacts/referrals/user-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '复制邀请链接' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect.poll(() => page.locator('#app-sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await page.getByRole('tab', { name: '账户概览', exact: true }).click();
  await page.getByRole('button', { name: '打开导航菜单', exact: true }).click();
  await entry.click();
  await expect(page.getByRole('tab', { name: '邀约奖励', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.locator('#app-sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 390, height: 1700 });
  await page.screenshot({ path: 'artifacts/referrals/user-mobile.png', fullPage: true });
});

test('邀约奖励后台：规则修改、失败重试复用幂等键与人工核对', async ({ page }) => {
  let settings = { enabled: true, inviterCredits: 500, inviteeCredits: 500 };
  let failures = 1;
  const keys: string[] = [];
  await page.route('**/api/admin/referral-settings', async route => {
    if (route.request().method() === 'PATCH') {
      keys.push(route.request().headers()['idempotency-key']);
      if (failures-- > 0) return json(route, { message: '暂时不可用' }, 503);
      const body = route.request().postDataJSON();
      settings = { enabled: body.enabled, inviterCredits: body.inviterCredits, inviteeCredits: body.inviteeCredits };
    }
    await json(route, settings);
  });
  await page.route('**/api/admin/referrals?*', route => json(route, referralPreviewPage({ ...referralPreviewRecord, status: 'review', granted: 0 })));
  await page.route('**/api/admin/referrals/*/resolve', route => json(route, { ok: true }));
  await page.goto('/admin/referrals');
  await expect(page.getByRole('heading', { name: '活动规则' })).toBeVisible();
  await expect(page.getByText('当前已打开', { exact: true })).toBeVisible();
  const activitySwitch = page.getByRole('switch', { name: '接受新邀请' });
  await expect(activitySwitch).toBeChecked();
  await activitySwitch.click();
  await expect(activitySwitch).not.toBeChecked();
  await expect(page.getByText('尚未保存：保存后功能将关闭，并使用下方奖励额度。', { exact: true })).toBeVisible();
  await expect(page.getByText('当前已打开', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存规则', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '请填写修改原因' })).toBeVisible();
  expect(keys).toHaveLength(0);
  await page.getByLabel('邀请人奖励积分').fill('800');
  await page.getByLabel('修改原因').fill('测试活动规则');
  await page.getByRole('button', { name: '保存规则' }).click();
  await expect(page.getByText('暂时不可用', { exact: true })).toBeVisible();
  await expect(page.getByText('当前已打开', { exact: true })).toBeVisible();
  await expect(activitySwitch).not.toBeChecked();
  await expect(page.getByLabel('修改原因')).toHaveValue('测试活动规则');
  await page.getByRole('button', { name: '保存规则' }).click();
  await expect(page.getByText('规则已保存，邀约奖励功能已关闭', { exact: true })).toBeVisible();
  await expect(page.getByText('当前已关闭', { exact: true })).toBeVisible();
  await expect(page.getByText(/尚未保存：/)).toHaveCount(0);
  await expect(activitySwitch).not.toBeChecked();
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
  await page.reload();
  await expect(activitySwitch).not.toBeChecked();
  await expect(page.getByLabel('邀请人奖励积分')).toHaveValue('800');
  await activitySwitch.click();
  await page.getByLabel('修改原因').fill('重新开放邀约活动');
  await page.getByLabel('邀请人奖励积分').fill('0');
  await page.getByRole('button', { name: '保存规则', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '请输入 1 至 1,000,000 的整数' })).toBeVisible();
  expect(keys).toHaveLength(2);
  await page.getByLabel('邀请人奖励积分').fill('200');
  await page.getByLabel('新用户奖励积分').fill('200');
  await page.getByRole('button', { name: '保存规则', exact: true }).click();
  await expect(page.getByText('规则已保存，邀约奖励功能已打开', { exact: true })).toBeVisible();
  await expect(page.getByText('当前已打开', { exact: true })).toBeVisible();
  expect(keys).toHaveLength(3); expect(keys[2]).not.toBe(keys[1]);
  expect(settings).toEqual({ enabled: true, inviterCredits: 200, inviteeCredits: 200 });
  await page.reload();
  await expect(activitySwitch).toBeChecked();
  await expect(page.getByLabel('邀请人奖励积分')).toHaveValue('200');
  await page.getByRole('button', { name: '处理待发奖励' }).click();
  await page.getByLabel('处理说明').fill('账号已恢复，补发原规则奖励');
  await page.getByRole('button', { name: '确认补发' }).click();
  await expect(page.getByText('核对处理已记录')).toBeVisible();
  await expect(page.getByText('核对处理已记录', { exact: true })).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: 'artifacts/referrals/admin-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.reload();
  await expect(activitySwitch).toBeChecked();
  await expect.poll(() => page.locator('#admin-sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/referrals/admin-mobile.png', fullPage: true });
});

test('用户端趋势放大为实线且支持悬停和键盘，零数据与加载失败可区分并重试', async ({ page }) => {
  await page.goto('/app');
  const chart = page.getByRole('img', { name: '近7日 AI视频与AI图片生成趋势' });
  const trendValue = page.locator('#dashboard-trend-value');
  await expect(page.getByLabel('查看日期数据')).toHaveCount(0);
  await expect(chart).toHaveCSS('height', '304px');
  await expect(trendValue).toHaveCSS('position', 'absolute');
  await expect(trendValue).toHaveCSS('clip', 'rect(0px, 0px, 0px, 0px)');
  await expect(page.getByLabel('图表图例')).toHaveText('● AI视频● AI图片');
  await expect(chart.locator('.recharts-area-curve')).toHaveCount(2);
  await expect(chart.locator('.recharts-reference-line-line')).toHaveCount(1);
  expect(await chart.locator('.recharts-cartesian-grid-horizontal line').count()).toBeGreaterThan(0);
  const strokePatterns = await chart.locator('.recharts-area-curve, .recharts-cartesian-grid-horizontal line, .recharts-reference-line-line').evaluateAll(lines => lines.map(line => getComputedStyle(line).strokeDasharray));
  expect(strokePatterns.every(pattern => pattern === 'none')).toBe(true);
  await chart.focus();
  await page.keyboard.press('Home');
  await expect(trendValue).toContainText('7月11日');
  await expect(chart).toHaveAccessibleDescription(/7月11日：视频 1 次 · 图片 0 次/);
  await page.keyboard.press('ArrowRight');
  await expect(trendValue).toContainText('7月12日');
  await page.keyboard.press('ArrowLeft');
  await expect(trendValue).toContainText('7月11日');
  await page.keyboard.press('End');
  await expect(trendValue).toContainText('7月17日：视频 0 次 · 图片 0 次');

  await page.getByRole('tab', { name: '近30日', exact: true }).click();
  const monthChart = page.getByRole('img', { name: '近30日 AI视频与AI图片生成趋势' });
  await expect(monthChart).toHaveCSS('height', '304px');
  await monthChart.focus();
  await page.keyboard.press('Home');
  await expect(trendValue).toContainText('6月18日');
  await page.getByRole('tab', { name: '近7日', exact: true }).click();
  await expect(trendValue).toContainText('7月17日');

  const firstDateBox = await chart.locator('.recharts-xAxis .recharts-cartesian-axis-tick').first().boundingBox();
  const chartBox = await chart.boundingBox();
  if (!firstDateBox || !chartBox) throw new Error('趋势图未完成布局');
  await page.mouse.move(firstDateBox.x + firstDateBox.width / 2, chartBox.y + chartBox.height / 2);
  const tooltip = chart.locator('.recharts-tooltip-wrapper');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('7月11日');
  await expect(tooltip).toContainText('AI视频');
  await expect(tooltip).toContainText('AI图片');
  await expect(trendValue).toContainText('7月11日：视频 1 次 · 图片 0 次');
  await page.evaluate(() => (window as any).__setGenerationTasks([]));
  await page.reload();
  await expect(page.getByText('这段时间暂无生成', { exact: true })).toBeVisible();
  await expect(page.getByText('暂无完成作品', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__setFailDashboardSummary(true));
  await page.reload();
  await expect(page.getByText('创作趋势暂不可用', { exact: true })).toBeVisible();
  await expect(page.getByText('这段时间暂无生成', { exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).__setFailDashboardSummary(false));
  await page.getByRole('button', { name: '重新加载统计' }).click();
  await expect(page.getByText('这段时间暂无生成', { exact: true })).toBeVisible();
});

test('用户端首次加载保留骨架，描述错误定位字段且请求失败保留输入', async ({ page }) => {
  let releaseSummary!: () => void;
  const summaryGate = new Promise<void>(resolve => { releaseSummary = resolve; });
  await page.route('**/api/account/dashboard-summary', async route => { await summaryGate; await route.fallback(); });
  try {
    await page.goto('/app');
    await expect(page.getByTestId('dashboard-recent-projects').getByRole('status', { name: '正在加载' })).toBeVisible();
    await expect(page.getByText('暂无完成作品', { exact: true })).toHaveCount(0);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const skeletons = page.getByTestId('dashboard-recent-projects').locator('.product-skeleton');
      await expect(skeletons).toHaveCount(6);
      const ratios = await skeletons.evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect();
        return box.width / box.height;
      }));
      for (const ratio of ratios) expect(ratio).toBeCloseTo(9 / 16, 3);
    }
  } finally { releaseSummary(); }
  await expect(page.getByTestId('dashboard-recent-project-card').first()).toBeVisible();
  await page.getByRole('button', { name: '开始创作', exact: true }).click();
  const prompt = page.getByRole('textbox', { name: '视频描述' });
  const generate = page.getByTestId('ai-studio-video-generate-button');
  await generate.click();
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert').filter({ hasText: '请输入视频描述' })).toBeVisible();
  await prompt.fill('保持描述，验证失败后可修改重试。');
  await expect(prompt).not.toHaveAttribute('aria-invalid', 'true');
  let releaseGeneration!: () => void;
  const generationGate = new Promise<void>(resolve => { releaseGeneration = resolve; });
  let requests = 0;
  await page.route('**/api/ai/video-tasks/batch', async route => {
    requests += 1;
    await generationGate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '生成服务暂不可用，请稍后重试', code: 'UNAVAILABLE', requestId: 'ui-feedback-check' }) });
  });
  const before = await generate.boundingBox();
  try {
    await generate.click();
    await expect(generate).toHaveAttribute('aria-busy', 'true');
    await expect(generate).toBeDisabled();
    await expect(generate).toHaveCSS('opacity', '1');
    const during = await generate.boundingBox();
    expect(Math.abs((during?.width ?? 0) - (before?.width ?? 0))).toBeLessThanOrEqual(1);
    await generate.evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(() => requests).toBe(1);
  } finally { releaseGeneration(); }
  await expect(page.getByRole('alert').filter({ hasText: '生成服务暂不可用' })).toBeVisible();
  await expect(prompt).toHaveValue('保持描述，验证失败后可修改重试。');
  await expect(generate).toBeEnabled();
  await page.getByRole('tab', { name: 'AI 图片', exact: true }).click();
  await page.getByTestId('ai-studio-image-generate-button').click();
  await expect(page.getByLabel('图片描述')).toBeFocused();
  await expect(page.getByLabel('图片描述')).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('tab', { name: 'AI 视频', exact: true }).click();
  await expect(prompt).toHaveValue('保持描述，验证失败后可修改重试。');
});

test.describe('用户端视觉交互交付', () => {
  test('录制导航、生成校验、参数菜单、资产选择并保存四档页面截图', async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const { mkdir } = await import('node:fs/promises');
    await mkdir('artifacts/ui-refresh', { recursive: true });
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, hasTouch: true, recordVideo: process.env.CAPTURE_USER_UI === '1' ? { dir: 'artifacts/ui-refresh/recordings', size: { width: 1440, height: 900 } } : undefined });
    const page = await context.newPage();
    await installApiMocks(page);
    try {
    await page.evaluate(tasks => (window as any).__setGenerationTasks(tasks), Array.from({ length: 6 }, (_, index) => ({ ...job('管理员', 'admin@lindyson.ai'), id: mockUuid(`ui-demo-${index}`), assetId: assetBrandId, assetName: ['夏日新品展示', '品牌故事', '日常生活片段', '产品细节特写', '开箱与体验', '创意短片'][index] })));
    await page.goto('/app');
    await expect(page.getByTestId('dashboard-recent-project-card').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const violations = await new AxeBuilder({ page }).include('main').analyze();
    expect(violations.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
    await page.screenshot({ animations: 'disabled', path: 'artifacts/ui-refresh/dashboard-1440.png' });
    await page.getByRole('button', { name: '开始创作', exact: true }).click();
    await page.getByTestId('ai-studio-video-generate-button').click();
    await expect(page.getByRole('textbox', { name: '视频描述' })).toBeFocused();
    await page.getByRole('textbox', { name: '视频描述' }).fill('为新品制作一段自然光下的产品展示视频。');
    await expect(page.getByRole('tabpanel', { name: 'AI 视频' })).toHaveCSS('opacity', '1');
    const studioContrast = await new AxeBuilder({ page }).include('.product-shell').withRules(['color-contrast']).analyze();
    expect(studioContrast.violations).toEqual([]);
    await page.locator('.product-shell main > .h-full.overflow-auto').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ animations: 'disabled', path: 'artifacts/ui-refresh/studio-1440.png' });
    await page.getByRole('button', { name: /^视频参数：/ }).click();
    const parameters = page.getByTestId('ai-studio-video-parameters-menu');
    await expect(parameters).toBeVisible();
    await expect(parameters).toHaveCSS('background-color', 'rgb(11, 10, 18)');
    await expect(parameters).toHaveCSS('opacity', '1');
    const parameterContrast = await new AxeBuilder({ page }).include('[data-testid="ai-studio-video-parameters-menu"]').withRules(['color-contrast']).analyze();
    expect(parameterContrast.violations).toEqual([]);
    await page.screenshot({ animations: 'disabled', path: 'artifacts/ui-refresh/studio-parameters.png' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^视频参数：/ })).toBeFocused();
    await page.getByRole('tab', { name: 'AI 图片', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'AI 图片' })).toHaveCSS('opacity', '1');
    await expect(page.getByRole('textbox', { name: '图片描述' })).toHaveCSS('font-size', '16px');
    const imageContrast = await new AxeBuilder({ page }).include('.product-shell').withRules(['color-contrast']).analyze();
    expect(imageContrast.violations).toEqual([]);
    await page.screenshot({ animations: 'disabled', path: 'artifacts/ui-refresh/studio-image-1440.png' });
    await page.goto('/app/digital-assets');
    await expect(page.getByTestId('digital-asset-grid')).toBeVisible();
    const assetContrast = await new AxeBuilder({ page }).include('.product-shell').withRules(['color-contrast']).analyze();
    expect(assetContrast.violations).toEqual([]);
    await page.screenshot({ animations: 'disabled', path: 'artifacts/ui-refresh/assets-1440.png' });
    await page.getByRole('button', { name: '批量操作', exact: true }).click();
    await page.getByRole('button', { name: /^选择素材 / }).first().click();
    await expect(page.getByText('已选择 1 个', { exact: true })).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: 'artifacts/ui-refresh/assets-selected.png' });
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '上传素材', exact: true }).click();
    const uploadInput = page.getByLabel('选择上传素材文件');
    await uploadInput.locator('..').dispatchEvent('dragenter');
    await expect(page.getByText('松开以上传', { exact: true })).toBeVisible();
    await uploadInput.locator('..').dispatchEvent('dragleave');
    await page.keyboard.press('Escape');
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
      for (const [route, name] of [['/app', 'dashboard'], ['/app/ai-studio', 'studio'], ['/app/digital-assets', 'assets']]) {
        await page.goto(route);
        await expect(page.locator('main [data-app-page="true"]').first()).toBeVisible();
        if (name === 'dashboard') await expect(page.getByTestId('dashboard-recent-project-card').first()).toBeVisible();
        if (name === 'assets') await expect(page.getByTestId('digital-asset-grid')).toBeVisible();
        if (name === 'studio') await expect(page.getByTestId('ai-studio-video-generate-button')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        await page.screenshot({ animations: 'disabled', path: `artifacts/ui-refresh/${name}-${width}.png` });
      }
    }
    await page.getByRole('button', { name: '批量操作', exact: true }).click();
    await page.getByRole('button', { name: /^选择素材 / }).first().click();
    const mobileBatchBar = page.getByText('已选择 1 个', { exact: true }).locator('xpath=ancestor::div[contains(@class, "fixed")][1]');
    await page.locator('.product-shell main > .h-full.overflow-auto').evaluate(element => { element.scrollTop = element.scrollHeight; });
    const lastAssetBox = await page.getByTestId('digital-asset-grid').locator('article').last().boundingBox();
    const mobileBatchBox = await mobileBatchBar.boundingBox();
    expect(lastAssetBox && mobileBatchBox && lastAssetBox.y + lastAssetBox.height <= mobileBatchBox.y).toBeTruthy();
    await page.screenshot({ animations: 'disabled', path: 'artifacts/ui-refresh/assets-selected-390.png' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app');
    const create = page.getByRole('button', { name: '开始创作', exact: true }).first();
    await expect(create).toHaveCSS('transition-duration', '0s');
    await expect(page.getByTestId('dashboard-recent-project-card').first().locator('.product-preview-action')).toHaveCSS('opacity', '1');
    } finally {
      const video = page.video();
      await context.close();
      if (video) await video.saveAs('artifacts/ui-refresh/user-interactions.webm');
    }
  });
});

test('用户端原始配色 实际加载中英字体和等宽数字，官网与后台保持独立', async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: '仪表盘', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => ({
    files: performance.getEntriesByType('resource').map(entry => entry.name).filter(name => name.includes('/fonts/') && name.endsWith('.woff2')),
    loaded: Array.from(document.fonts).filter(font => font.status === 'loaded').map(font => font.family),
  }));
  expect(fonts.loaded).toContain('Geist Sans');
  expect(fonts.loaded).toContain('MiSans');
  expect(fonts.files.length).toBeGreaterThanOrEqual(2);
  expect(fonts.files.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  await expect(page.locator('.product-shell')).not.toHaveClass(/\bdark\b/);
  await expect(page.locator('.product-shell')).toHaveCSS('color-scheme', 'dark');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-ui="page-header"] h1' });
  const rendered = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  expect(rendered.fonts.some(font => font.isCustomFont && font.familyName.includes('MiSans') && font.glyphCount > 0)).toBe(true);
  const digitsNode = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-ui="stat-card-value"]' });
  const digitsFont = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: digitsNode.nodeId });
  expect(digitsFont.fonts.some(font => font.isCustomFont && font.familyName.includes('Geist') && font.glyphCount > 0)).toBe(true);
  await cdp.detach();
  const widths = await page.locator('.product-shell').evaluate(shell => {
    const sample = document.createElement('span');
    sample.style.cssText = 'font-size:32px;font-variant-numeric:tabular-nums;position:absolute;visibility:hidden;white-space:nowrap';
    shell.append(sample);
    const widths = ['111,111', '888,888'].map(text => { sample.textContent = text; return sample.getBoundingClientRect().width; });
    sample.remove();
    return widths;
  });
  expect(widths[0]).toBeCloseTo(widths[1], 2);
  await page.goto('/');
  await expect(page.locator('.product-shell')).toHaveCount(0);
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)).not.toContain('MiSans');
  await page.goto('/admin');
  await expect(page.locator('.admin-shell')).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('.admin-shell')).toHaveCSS('background-color', 'rgb(6, 7, 10)');
  expect(await page.locator('.admin-shell').evaluate(element => getComputedStyle(element).fontFamily)).not.toContain('Geist');
});

test('用户端原始配色 字体请求失败仍能阅读并使用用户端', async ({ page }) => {
  await page.route('**/fonts/*.woff2', route => route.abort('failed'));
  await page.goto('/app/ai-studio');
  const prompt = page.getByRole('textbox', { name: '视频描述' });
  await expect(prompt).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => Array.from(document.fonts).filter(font => ['MiSans', 'Geist Sans'].includes(font.family) && font.status === 'loaded').length)).toBe(0);
  await prompt.fill('字体下载失败时仍然可以编辑 Video 123。');
  await page.getByRole('tab', { name: 'AI 图片', exact: true }).click();
  await page.getByRole('tab', { name: 'AI 视频', exact: true }).click();
  await expect(prompt).toHaveValue('字体下载失败时仍然可以编辑 Video 123。');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('用户端原始配色 其余用户页面、媒体预览与账户弹窗对比度', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { mkdir } = await import('node:fs/promises');
  await mkdir('artifacts/ui-refresh', { recursive: true });
  for (const [route, title] of [
    ['/app/real-portraits', '真人演员库'],
    ['/app/tiktok-accounts', '管理TikTok账号'],
    ['/app/tiktok-publish', '发布至 TikTok 账号'],
    ['/app/subscription', '选择适合你的套餐'],
    ['/app/account-center', '账户中心'],
  ]) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `artifacts/ui-refresh/${route.split('/').at(-1)}-1440.png`, animations: 'disabled' });
    const report = await new AxeBuilder({ page }).include('.product-shell').withRules(['color-contrast']).analyze();
    expect(report.violations.flatMap(violation => violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })))).toEqual([]);
  }
  const edit = page.getByRole('button', { name: '修改资料', exact: true });
  await edit.click();
  await expect(page.getByRole('dialog', { name: '修改资料' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '修改资料' }).locator(':scope > div')).toHaveCSS('opacity', '1');
  const dialogReport = await new AxeBuilder({ page }).include('[role="dialog"]').withRules(['color-contrast']).analyze();
  expect(dialogReport.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(edit).toBeFocused();
  await page.goto('/app/digital-assets');
  await page.getByRole('button', { name: /^打开素材 / }).first().click();
  await expect(page.getByRole('dialog', { name: '素材预览' })).toBeVisible();
  await expect(page.locator('.product-media-surface').filter({ has: page.locator('video, img') }).first()).toHaveCSS('color-scheme', 'dark');
  await page.screenshot({ path: 'artifacts/ui-refresh/asset-preview.png', animations: 'disabled' });
  const mediaReport = await new AxeBuilder({ page }).include('[role="dialog"]').withRules(['color-contrast']).analyze();
  expect(mediaReport.violations.flatMap(violation => violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })))).toEqual([]);
});

test('用户端原始配色 深色主题的辅助文字、禁用状态与关键弹窗保持可读', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
  const checkReading = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.locator('[role="dialog"][style*="opacity"], [role="dialog"] [style*="opacity"]').evaluateAll(elements => elements.every(element => Number(getComputedStyle(element).opacity) === 1))).toBe(true);
    const report = await new AxeBuilder({ page }).include('.product-shell').include('.product-popover').withRules(['color-contrast']).analyze();
    expect(report.violations.flatMap(violation => violation.nodes.map(node => ({ name, target: node.target, summary: node.failureSummary })))).toEqual([]);
    const tinyText = await page.locator('.product-shell, .product-popover').evaluateAll(roots => roots.flatMap(root => {
      const result: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        const text = walker.currentNode.textContent?.trim();
        if (!text || !parent || parent.closest('[aria-hidden="true"], .sr-only, style, script') || !parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        if (parseFloat(getComputedStyle(parent).fontSize) < 12) result.push(text.slice(0, 60));
      }
      return result;
    }));
    expect(tinyText, name).toEqual([]);
  };
  await page.goto('/app/subscription');
  const currentPlan = page.getByRole('button', { name: '当前套餐', exact: true });
  await expect(currentPlan).toBeDisabled();
  await expect(currentPlan).toHaveCSS('opacity', '1');
  const disabledContrast = await currentPlan.evaluate(element => {
    const luminance = (rgb: string) => {
      const channels = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const style = getComputedStyle(element);
    const [dark, light] = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => a - b);
    return (light + 0.05) / (dark + 0.05);
  });
  expect(disabledContrast).toBeGreaterThanOrEqual(4.5);
  await checkReading('套餐禁用文字');
  await page.evaluate(items => (window as any).__setPlans(items), [paidPlan()]);
  await page.reload();
  await page.getByRole('button', { name: '升级专业版', exact: true }).click();
  await checkReading('确认购买');
  await page.evaluate(() => (window as any).__configurePaymentSync({ failures: 99, finalStatus: 'pending' }));
  await page.getByRole('button', { name: '确认支付 ¥228' }).click();
  await expect(page.getByRole('dialog', { name: '支付宝扫码支付' })).toBeVisible();
  await checkReading('扫码支付与状态说明');
  await page.getByRole('dialog', { name: '支付宝扫码支付' }).getByRole('button', { name: '取消支付', exact: true }).click();
  await page.goto('/app/account-center');
  await page.getByRole('button', { name: /联系客服/ }).click();
  await expect(page.getByPlaceholder('继续补充问题或回复客服')).toBeVisible();
  await checkReading('客服对话');
  await page.goto('/app/digital-assets');
  await page.getByRole('button', { name: '上传素材', exact: true }).click();
  await page.getByLabel('选择上传素材文件').setInputFiles([{ name: '不支持的文件.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') }]);
  await checkReading('上传格式错误');
  await page.screenshot({ path: 'artifacts/ui-refresh/readability-upload-error.png', animations: 'disabled' });
  await page.goto('/app/ai-studio');
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await checkReading('素材选择器');
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: 'TK Prompt Engine 1.0', exact: true });
  await wizard.getByRole('button', { name: '确认事实并继续', exact: true }).waitFor();
  await checkReading('商品事实');
  await wizard.getByRole('button', { name: '确认事实并继续', exact: true }).click();
  await checkReading('创作要求');
  await wizard.getByRole('button', { name: '生成三个方案', exact: true }).click();
  await expect(wizard.getByRole('radiogroup', { name: '提示词方案' })).toBeVisible();
  await checkReading('提示词结果');
  await page.setViewportSize({ width: 390, height: 844 });
  await checkReading('手机提示词结果');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/ui-refresh/readability-wizard-390.png', animations: 'disabled' });
  await page.route('**/api/account/referrals/summary', route => json(route, { code: 'AB12CD34', settings: { enabled: false, inviterCredits: 500, inviteeCredits: 500 }, invited: 1, earned: 500 }));
  await page.route('**/api/account/referrals?*', route => json(route, referralPreviewPage()));
  await page.goto('/app/account-center');
  await page.getByRole('tab', { name: '邀约奖励', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制邀请链接', exact: true })).toBeDisabled();
  await checkReading('手机邀约奖励与禁用说明');
  await page.screenshot({ path: 'artifacts/ui-refresh/readability-referrals-390.png', animations: 'disabled' });
});

for (const kind of ['video', 'image'] as const) {
  test(`AI Studio ${kind} 底部结果网格响应式、分页及异常说明`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      window.__assetDownloadClicks = [];
      HTMLAnchorElement.prototype.click = function () { window.__assetDownloadClicks.push(this.href); };
    });
    const resultAssetId = kind === 'video' ? assetBrandId : mockUuid('asset-ref-image');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('https://cdn.example.com/studio-result-*.webp', route => {
      const fixtures = ['fashion-campaign', 'tech-campaign', 'beauty-campaign'];
      const index = Number(route.request().url().match(/result-(\d+)/)?.[1] ?? 0);
      return route.fulfill({ path: `public/landing/${fixtures[index % fixtures.length]}.webp`, contentType: 'image/webp' });
    });
    const tasks = Array.from({ length: 13 }, (_, index) => ({
      ...job('管理员', 'admin@lindyson.ai'),
      id: `results-${kind}-${index}`,
      kind,
      model: kind === 'video' ? 'Seedance 2.0' : 'Seedream 5.0 Pro',
      createdAt: `2026-09-21T09:${String(59 - index).padStart(2, '0')}:00`,
      config: { aspectRatio: '9:16', resolution: kind === 'video' ? '720p' : '2K', durationSeconds: 5 },
      assetId: resultAssetId,
      assetSource: kind === 'video' ? 'ai-video' : 'uploaded-image',
      assetAvailable: index !== 3,
      assetThumbnailUrl: `https://cdn.example.com/studio-result-${index}.webp`,
      status: index === 1 ? 'queued' : index === 2 ? 'processing' : index === 4 ? 'failed' : 'completed',
      processingStage: index === 2 ? 'submission-unknown' : index === 1 ? 'queued' : 'completed',
      creditStatus: index === 1 || index === 2 ? 'held' : index === 4 ? 'refunded' : 'settled',
      refundedCredits: index === 4 ? 20 : 0,
      failureReason: index === 4 ? '参考素材未通过校验。请检查素材的清晰度、文件格式和尺寸，并确认参考素材符合所选模型的要求。修改参数后可以创建新任务，原任务记录会保留。' : null,
    }));
    await page.evaluate(items => (window as any).__setGenerationTasks(items), tasks);
    const requests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/api/ai/tasks' && url.searchParams.get('kind') === kind) requests.push(url.searchParams.get('limit') ?? '');
    });
    await page.setViewportSize({ width: 1440, height: 2000 });
    await page.goto('/app/ai-studio');
    if (kind === 'image') await page.getByRole('tab', { name: 'AI 图片' }).click();
    const results = page.getByTestId(`ai-studio-${kind}-results`);
    const cards = results.getByTestId('ai-studio-result-card');
    await expect(cards).toHaveCount(12);
    await expect(results.getByText('共 13 个任务')).toBeVisible();
    expect(requests).toContain('12');
    await expect(results.getByRole('status', { name: '第 1 页，共 2 页' })).toBeVisible();
    await expect(cards.nth(1).getByText('排队中', { exact: true })).toBeVisible();
    await expect(cards.nth(2).getByText('待核对', { exact: true })).toBeVisible();
    await expect(cards.nth(3).getByText('素材已删除', { exact: true })).toBeVisible();
    await expect(cards.nth(3).getByRole('button', { name: /预览|下载/ })).toHaveCount(0);
    await expect(cards.first().getByRole('button', { name: /预览/ })).toHaveCSS('opacity', '1');
    await cards.first().getByRole('button', { name: /下载/ }).click();
    await expect.poll(() => page.evaluate(() => window.__assetDownloadClicks.length)).toBe(1);
    await expect.poll(() => page.evaluate(id => (window as any).__getApiRequestCount(`POST /api/assets/${id}/download`), resultAssetId)).toBe(1);
    await expect(page.getByRole('heading', { name: '素材预览' })).toHaveCount(0);
    await cards.first().getByRole('button', { name: /预览/ }).click();
    await expect(page.getByRole('heading', { name: '素材预览' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: '素材预览' })).toHaveCount(0);
    const failedCard = cards.nth(4);
    const detailsButton = failedCard.getByRole('button', { name: '查看说明' });
    const failedBounds = await failedCard.boundingBox();
    await detailsButton.click();
    const explanation = page.getByRole('dialog', { name: '任务说明' });
    await expect(explanation.getByText(tasks[4].failureReason!, { exact: true })).toBeVisible();
    const backdropBounds = (await explanation.locator('..').boundingBox())!;
    expect(backdropBounds.x).toBe(0);
    expect(backdropBounds.y).toBe(0);
    expect(backdropBounds.width).toBe(1440);
    expect((await failedCard.boundingBox())!.height).toBeCloseTo(failedBounds!.height, 1);
    await page.keyboard.press('Escape');
    await expect(explanation).toHaveCount(0);
    await expect(detailsButton).toBeFocused();
    if (kind === 'video') await expect(failedCard.getByRole('button', { name: '修改参数并重试' })).toBeVisible();

    const verifyDetailsActions = async () => {
      const details = failedCard.getByRole('button', { name: '查看说明' });
      await expect(details).toHaveCSS('text-decoration-line', 'none');
      await expect(details).toHaveCSS('font-size', '12px');
      const infoBounds = (await failedCard.getByTestId('ai-studio-result-info').boundingBox())!;
      const detailsBounds = (await details.boundingBox())!;
      expect(detailsBounds.width).toBeCloseTo(infoBounds.width - 20, 1);
      if (kind === 'video') {
        const retry = failedCard.getByRole('button', { name: '修改参数并重试' });
        const properties = ['background-color', 'color', 'font-size', 'font-weight', 'line-height', 'border-radius', 'border-color', 'border-width', 'padding', 'height'];
        const styles = (element: Element, properties: string[]) => properties.map(property => getComputedStyle(element).getPropertyValue(property));
        expect(await details.evaluate(styles, properties)).toEqual(await retry.evaluate(styles, properties));
        const retryBounds = (await retry.boundingBox())!;
        expect(retryBounds.x).toBeCloseTo(detailsBounds.x, 1);
        expect(retryBounds.width).toBeCloseTo(detailsBounds.width, 1);
        expect(retryBounds.y).toBeGreaterThanOrEqual(detailsBounds.y + detailsBounds.height + 4);
        await details.hover();
        const hoverStyles = await details.evaluate(styles, properties);
        await retry.hover();
        expect(await retry.evaluate(styles, properties)).toEqual(hoverStyles);
      }
    };
    await expect(page.getByText(kind === 'video' ? '素材下载已开始' : '图片下载已开始', { exact: true })).toBeHidden();
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 2000 : 900 });
      const composer = page.getByTestId(`ai-studio-${kind}-composer`);
      const composerBounds = await composer.boundingBox();
      const resultsBounds = await results.boundingBox();
      expect(resultsBounds!.y).toBeGreaterThanOrEqual(composerBounds!.y + composerBounds!.height);
      expect(Math.abs(resultsBounds!.width - composerBounds!.width)).toBeLessThanOrEqual(1);
      const grid = results.getByTestId('ai-studio-results-grid');
      const layout = await grid.evaluate(element => ({ width: element.clientWidth, columns: getComputedStyle(element).gridTemplateColumns.split(' ').length, gap: getComputedStyle(element).gap }));
      expect(layout.columns).toBe(layout.width >= 1080 ? 6 : layout.width >= 720 ? 4 : layout.width >= 540 ? 3 : layout.width >= 320 ? 2 : 1);
      expect(layout.gap).toBe('16px');
      for (const card of await cards.all()) {
        const bounds = (await card.boundingBox())!;
        expect(Math.abs(bounds.height - bounds.width * 16 / 9)).toBeLessThan(1);
        const preview = (await card.getByTestId('ai-studio-result-preview').boundingBox())!;
        expect(preview.x).toBeCloseTo(bounds.x + 1, 1);
        expect(preview.y).toBeCloseTo(bounds.y + 1, 1);
        expect(preview.width).toBeCloseTo(bounds.width - 2, 1);
        expect(preview.height).toBeCloseTo(bounds.height - 2, 1);
        const info = (await card.getByTestId('ai-studio-result-info').boundingBox())!;
        const modelBounds = (await card.getByTestId('ai-studio-result-info').locator('p').first().boundingBox())!;
        expect(modelBounds.y).toBeGreaterThan(bounds.y + 36);
        expect(info.y + info.height).toBeLessThanOrEqual(bounds.y + bounds.height);
        expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      if (layout.columns === 6) {
        const rows = await cards.evaluateAll(elements => new Set(elements.map(element => Math.round(element.getBoundingClientRect().top))).size);
        expect(rows).toBe(2);
      }
      await expect(cards.first().getByTestId('ai-studio-result-preview').locator('img')).toHaveCSS('object-fit', 'cover');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(await results.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await verifyDetailsActions();
      await results.scrollIntoViewIfNeeded();
      if (width === 1440) {
        await page.getByTestId('ai-studio-workspace-scroll').evaluate(element => { element.scrollTop = 0; });
        const path = testInfo.outputPath(`${kind}-desktop.png`);
        await page.screenshot({ path });
        await testInfo.attach(`${kind}-desktop`, { path, contentType: 'image/png' });
        const resultsPath = testInfo.outputPath(`${kind}-results.png`);
        await results.screenshot({ path: resultsPath });
        await testInfo.attach(`${kind}-results`, { path: resultsPath, contentType: 'image/png' });
      }
      if (width === 390) {
        const path = testInfo.outputPath(`${kind}-mobile.png`);
        await page.screenshot({ path });
        await testInfo.attach(`${kind}-mobile`, { path, contentType: 'image/png' });
        const failurePath = testInfo.outputPath(`${kind}-mobile-failure.png`);
        await failedCard.screenshot({ path: failurePath });
        await testInfo.attach(`${kind}-mobile-failure`, { path: failurePath, contentType: 'image/png' });
      }
    }
    await page.setViewportSize({ width: 1600, height: 1200 });
    const grid = results.getByTestId('ai-studio-results-grid');
    const container = grid.locator('..');
    for (const width of [319, 320, 539, 540, 719, 720, 1079, 1080]) {
      await container.evaluate((element, size) => { (element as HTMLElement).style.width = `${size}px`; }, width);
      const expectedColumns = width >= 1080 ? 6 : width >= 720 ? 4 : width >= 540 ? 3 : width >= 320 ? 2 : 1;
      await expect.poll(() => grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(expectedColumns);
      for (const card of await cards.all()) {
        const bounds = (await card.boundingBox())!;
        const info = (await card.getByTestId('ai-studio-result-info').boundingBox())!;
        const modelBounds = (await card.getByTestId('ai-studio-result-info').locator('p').first().boundingBox())!;
        expect(modelBounds.y).toBeGreaterThan(bounds.y + 36);
        expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      await verifyDetailsActions();
    }
    await container.evaluate(element => { (element as HTMLElement).style.removeProperty('width'); });
    const pager = results.getByRole('navigation');
    await pager.getByRole('button', { name: '尾页' }).click();
    await expect(cards).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(cards).toHaveCount(1);
    await expect(pager.getByRole('status', { name: '第 2 页，共 2 页' })).toBeVisible();
    await page.getByRole('tab', { name: kind === 'video' ? 'AI 图片' : 'AI 视频' }).click();
    await page.getByRole('tab', { name: kind === 'video' ? 'AI 视频' : 'AI 图片' }).click();
    await expect(pager.getByRole('status', { name: '第 2 页，共 2 页' })).toBeVisible();
    await page.evaluate(() => (window as any).__setGenerationTasks([]));
    await page.reload();
    if (kind === 'image') await page.getByRole('tab', { name: 'AI 图片' }).click();
    await expect(results.getByText('暂无生成任务', { exact: true })).toBeVisible();
    await expect(results.getByRole('navigation')).toHaveCount(0);
  });
}

for (const kind of ['video', 'image'] as const) {
  test(`AI Studio ${kind} 不同比例缩略图四边铺满且预览保留完整素材`, async ({ page }) => {
    const shapes = [[360, 640], [640, 360], [480, 480]];
    if (kind === 'video') {
      await page.route(`https://cdn.example.com/${assetBrandId}.mp4`, route => route.fulfill({ path: 'public/landing/fashion-campaign.mp4', contentType: 'video/mp4' }));
    }
    await page.route('https://cdn.example.com/studio-shape-*.svg', route => {
      const index = Number(route.request().url().match(/shape-(\d+)/)?.[1] ?? 0);
      const [width, height] = shapes[index];
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#145e71"/><rect x="8" y="8" width="${width - 16}" height="${height - 16}" fill="#6041a8"/><circle cx="${width / 2}" cy="${height / 2}" r="60" fill="#f6c363"/></svg>` });
    });
    await page.evaluate(items => (window as any).__setGenerationTasks(items), shapes.map((_, index) => ({
      ...job('管理员', 'admin@lindyson.ai'),
      id: `shape-${kind}-${index}`,
      kind,
      model: kind === 'video' ? 'Seedance 2.0' : 'Seedream 5.0 Pro',
      status: 'completed',
      processingStage: 'completed',
      creditStatus: 'settled',
      createdAt: `2026-09-21T09:0${index}:00`,
      config: { aspectRatio: ['9:16', '16:9', '1:1'][index], resolution: kind === 'video' ? '720p' : '2K', durationSeconds: 5 },
      assetId: kind === 'video' ? assetBrandId : mockUuid('asset-ref-image'),
      assetAvailable: true,
      assetThumbnailUrl: `https://cdn.example.com/studio-shape-${index}.svg`,
    })));
    await page.goto('/app/ai-studio');
    if (kind === 'image') await page.getByRole('tab', { name: 'AI 图片' }).click();
    const cards = page.getByTestId(`ai-studio-${kind}-results`).getByTestId('ai-studio-result-card');
    await expect(cards).toHaveCount(3);
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const card of await cards.all()) {
        const media = card.getByTestId('ai-studio-result-preview');
        const thumbnail = media.locator('img');
        await expect.poll(() => thumbnail.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
        await expect(thumbnail).toHaveCSS('object-fit', 'cover');
        await expect(thumbnail).toHaveCSS('object-position', '50% 50%');
        const natural = await thumbnail.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight]);
        expect(shapes).toContainEqual(natural);
        const frame = (await media.boundingBox())!;
        const image = (await thumbnail.boundingBox())!;
        for (const edge of ['x', 'y', 'width', 'height'] as const) expect(image[edge]).toBeCloseTo(frame[edge], 1);
      }
    }
    await cards.first().getByRole('button', { name: /预览/ }).click();
    const preview = page.getByRole('dialog', { name: '素材预览' });
    await expect(preview).toBeVisible();
    await expect(preview.locator(kind === 'video' ? 'video' : 'img').first()).toHaveCSS('object-fit', 'contain');
    await page.keyboard.press('Escape');
  });
}

function studioPortraitFixture(alias = '演员一') {
  return {
    id: mockUuid(`studio-portrait-${alias}`), alias,
    planAccessStatus: 'available', lifecycleStatus: 'active', authorizationStatus: 'active',
    authorizationExpiresAt: null, lastSuccessfulGenerationAt: null,
    createdAt: '2026-07-30T10:00:00.000Z', updatedAt: '2026-07-30T10:00:00.000Z',
    assets: [
      { id: mockUuid(`studio-primary-${alias}`), kind: 'primary', status: 'active', consistencyStatus: 'passed', thumbnailAvailable: true },
      { id: mockUuid(`studio-secondary-${alias}`), kind: 'secondary', status: 'active', consistencyStatus: 'passed', thumbnailAvailable: true },
    ],
  };
}

async function mockStudioPortraits(page: Page, items: ReturnType<typeof studioPortraitFixture>[], gate?: Promise<void>) {
  await page.route('**/api/real-portrait-actors/*/assets/*/thumbnail', route => {
    const secondary = items.some(actor => actor.assets.some(asset => asset.kind === 'secondary' && route.request().url().includes(asset.id)));
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" fill="${secondary ? '#b8b2bc' : '#aebccc'}"/><path d="M21 160q4-57 59-57t59 57" fill="${secondary ? '#65516e' : '#39495e'}"/><ellipse cx="80" cy="65" rx="29" ry="37" fill="#e5bfaa"/><path d="M49 64q-6-45 31-46q34 1 31 46l-12-23q-27 13-47 4" fill="#3b2d2e"/></svg>` });
  });
  await page.route('**/api/real-portrait-actors', async route => {
    if (gate) await gate;
    await json(route, {
      items,
      capacity: {
        sourcePlanCode: 'pro', sourcePlanName: '专业版',
        entitlements: { enabled: true, profileLimit: 20, activeLimit: 20, assetsPerActor: 2 },
        usage: { profiles: items.length, active: items.length, queued: 0 },
        global: { groupSoftLimit: 45, assetSoftLimit: 45, groupsUsed: items.length, assetsUsed: items.length * 2, groupsReserved: 0, assetsReserved: 0 },
        quotaState: null,
      },
    });
  });
}

test('AI Studio 真人演员下拉保留图片选择、响应式布局与提交参数', async ({ page }, testInfo) => {
  const actor = studioPortraitFixture('这是一位用于检查长名称省略的真人演员甲');
  await mockStudioPortraits(page, [actor, studioPortraitFixture('演员乙'), { ...studioPortraitFixture('未授权演员'), authorizationStatus: 'revoked' }]);
  await page.goto('/app/ai-studio');
  const trigger = page.getByRole('button', { name: /^真人演员：/ });
  const menu = page.getByRole('dialog', { name: '真人演员', exact: true });
  await expect(trigger).toHaveText('不使用真人演员');
  await expect(page.getByTestId('ai-studio-real-portrait-card')).toHaveCount(0);
  await trigger.click();
  await expect(menu.getByRole('option', { name: `${actor.alias} 图片1`, exact: true })).toBeEnabled();
  await expect(menu.getByRole('option', { name: /未授权演员/ })).toHaveCount(0);
  await menu.getByRole('option', { name: '不使用真人演员', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  const firstPicture = menu.getByRole('option', { name: `${actor.alias} 图片1`, exact: true });
  await expect(firstPicture).toBeFocused();
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(firstPicture).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  const pictures = menu.getByRole('group', { name: actor.alias, exact: true });
  await expect(pictures.getByRole('option')).toHaveCount(2);
  await expect(pictures.getByRole('option', { name: `${actor.alias} 图片1`, exact: true })).toHaveAttribute('aria-selected', 'true');
  await pictures.getByRole('option', { name: `${actor.alias} 图片2`, exact: true }).click();
  await expect(pictures.getByRole('option', { name: `${actor.alias} 图片2`, exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger.locator('span[title]').first()).toHaveAttribute('title', `${actor.alias} · 图片2`);
  await page.getByRole('tab', { name: 'AI 图片', exact: true }).click();
  await expect(trigger).toHaveCount(0);
  await page.getByRole('tab', { name: 'AI 视频', exact: true }).click();
  await expect(trigger).toHaveText(actor.alias);
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1100 : 900 });
    await trigger.click();
    await expect(pictures.getByRole('option', { name: `${actor.alias} 图片2`, exact: true })).toHaveAttribute('aria-selected', 'true');
    const image = pictures.getByRole('option', { name: `${actor.alias} 图片2`, exact: true }).locator('img');
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(160);
    const optionBounds = (await pictures.getByRole('option').first().boundingBox())!;
    expect(optionBounds.width).toBe(48);
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await menu.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (width === 1440 || width === 390) {
      const path = testInfo.outputPath(`portrait-${width === 1440 ? 'desktop' : 'mobile'}.png`);
      await expect(menu).toHaveCSS('opacity', '1');
      await page.screenshot({ path, animations: 'disabled' });
      await testInfo.attach(`portrait-${width}`, { path, contentType: 'image/png' });
    }
    await page.keyboard.press('Escape');
  }
  const prompt = page.getByRole('textbox', { name: '视频描述', exact: true });
  await prompt.fill('演员演示商品');
  await page.getByRole('button', { name: /生成视频 · \d+ 积分/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__getLastGenerationRequest())).toMatchObject({ realPortrait: { actorId: actor.id, portraitAssetId: actor.assets[1].id } });
  await trigger.click();
  await menu.getByRole('option', { name: '不使用真人演员', exact: true }).click();
  await page.keyboard.press('Escape');
  await prompt.fill('无真人演员的商品展示');
  await page.getByRole('button', { name: /生成视频 · \d+ 积分/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__getLastGenerationRequest())).toMatchObject({ prompt: '无真人演员的商品展示' });
  expect(await page.evaluate(() => (window as any).__getLastGenerationRequest())).not.toHaveProperty('realPortrait');
});

test('AI Studio 真人演员下拉保留不兼容选择并允许清除', async ({ page }) => {
  const actor = studioPortraitFixture();
  await mockStudioPortraits(page, [actor]);
  await page.evaluate(input => (window as any).__setVideoConsumptionConfiguration(input), { items: seedance25ConsumptionRows(), videoModels: [seedance25Capability()] });
  await page.goto('/app/ai-studio');
  const trigger = page.getByRole('button', { name: /^真人演员：/ });
  const menu = page.getByRole('dialog', { name: '真人演员', exact: true });
  await trigger.click();
  await menu.getByRole('option', { name: `${actor.alias} 图片1`, exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '参考模式：全能参考', exact: true }).click();
  await page.getByRole('option').filter({ hasText: '首尾帧' }).click();
  await expect(trigger).toContainText('当前不可用');
  await trigger.click();
  await expect(menu).toContainText('真人演员只支持“全能参考”模式');
  await expect(menu.getByRole('option', { name: `${actor.alias} 图片1`, exact: true })).toBeDisabled();
  await expect(menu.getByRole('option', { name: `${actor.alias} 图片1`, exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '参考模式：首尾帧', exact: true }).click();
  await page.getByRole('option').filter({ hasText: '全能参考' }).click();
  await expect(trigger).toHaveText(actor.alias);
  await page.getByRole('button', { name: 'AI 模型：Seedance 2.0', exact: true }).click();
  await page.getByRole('option').filter({ hasText: 'Seedance 2.5' }).click();
  await trigger.click();
  await expect(menu).toContainText('Seedance 2.5 的真人演员功能正在适配中');
  await expect(menu.getByRole('option', { name: `${actor.alias} 图片1`, exact: true })).toBeDisabled();
  await menu.getByRole('option', { name: '不使用真人演员', exact: true }).click();
  await expect(trigger).toHaveText('不使用真人演员');
  await page.getByRole('heading', { name: 'AI Studio', exact: true }).click();
  await expect(menu).toHaveCount(0);
});

test('AI Studio 真人演员下拉加载、空列表与演员库入口', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await mockStudioPortraits(page, [], gate);
  await page.goto('/app/ai-studio');
  await page.getByRole('button', { name: '真人演员：不使用真人演员', exact: true }).click();
  const menu = page.getByRole('dialog', { name: '真人演员', exact: true });
  await expect(menu).toContainText('正在读取可用真人演员');
  release();
  await expect(menu).toContainText('暂无可用真人演员');
  await expect(menu.getByRole('option', { name: '不使用真人演员', exact: true })).toBeEnabled();
  await menu.getByRole('button', { name: '管理演员库 →', exact: true }).click();
  await expect(page.getByRole('heading', { name: '真人演员库', exact: true })).toBeVisible();
  await expect(menu).toHaveCount(0);
});

test('AI Studio 真人演员下拉更换TK来源会保留提示词并转为手动草稿', async ({ page }) => {
  const actor = studioPortraitFixture();
  await mockStudioPortraits(page, [actor]);
  await page.goto('/app/ai-studio');
  await page.getByText('图片 / 视频 / 音频', { exact: true }).click();
  await page.getByText('参考商品图', { exact: true }).click();
  await page.getByRole('button', { name: /确认选择/ }).click();
  await page.getByRole('button', { name: 'AI 帮我写提示词', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'TK Prompt Engine 1.0', exact: true });
  await expect(dialog.getByText('商品事实已识别', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '确认事实并继续', exact: true }).click();
  await dialog.getByRole('button', { name: '生成三个方案', exact: true }).click();
  await expect(dialog.getByText('3/3 已完成', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '采用此方案', exact: true }).click();

  const prompt = page.getByPlaceholder('详细描述你想生成的视频内容、场景、风格...');
  const appliedPrompt = await prompt.inputValue();
  await page.getByRole('button', { name: /^真人演员：/ }).click();
  await page.getByRole('dialog', { name: '真人演员', exact: true }).getByRole('option', { name: `${actor.alias} 图片1`, exact: true }).click();
  await page.keyboard.press('Escape');

  await expect(page.getByText(/已保留当前执行提示词；真人演员选择与原 TK 方案快照不同，已转为手动草稿/)).toBeVisible();
  await expect(prompt).toHaveValue(appliedPrompt);
  await page.getByRole('button', { name: /生成视频 · \d+ 积分/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__getLastGenerationRequest())).not.toBeNull();
  const videoRequest = await page.evaluate(() => (window as any).__getLastGenerationRequest());
  expect(videoRequest.prompt).toBe(appliedPrompt);
  expect(videoRequest).not.toHaveProperty('tkPromptSource');
  expect(videoRequest.realPortrait).toEqual({ actorId: actor.id, portraitAssetId: actor.assets[0].id });
});

test('AI Studio 真人演员下拉过滤无效图片并清理失效演员', async ({ page }) => {
  const actor = studioPortraitFixture();
  actor.assets[1].consistencyStatus = 'failed';
  await mockStudioPortraits(page, [actor]);
  await page.goto('/app/ai-studio');
  const trigger = page.getByRole('button', { name: /^真人演员：/ });
  await trigger.click();
  const menu = page.getByRole('dialog', { name: '真人演员', exact: true });
  await menu.getByRole('option', { name: `${actor.alias} 图片1`, exact: true }).click();
  await expect(menu.getByRole('group', { name: actor.alias, exact: true }).getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.clock.install();
  await page.clock.fastForward(16_000);
  actor.authorizationStatus = 'revoked';
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/real-portrait-actors'));
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.clock.runFor(500);
  await refreshed;
  await expect(trigger).toHaveText('不使用真人演员');
  await trigger.click();
  await expect(menu.getByRole('group', { name: actor.alias, exact: true })).toHaveCount(0);
  await expect(menu).toContainText('暂无可用真人演员');
});

test('AI Studio 真人演员下拉缩略图缺失或读取失败保留选择，多演员菜单滚动', async ({ page }) => {
  const actors = Array.from({ length: 12 }, (_, i) => studioPortraitFixture(`演员${i + 1}`));
  actors[0].assets[0].thumbnailAvailable = false;
  actors[0].assets = [actors[0].assets[0]];
  await mockStudioPortraits(page, actors);
  await page.route(`**/api/real-portrait-actors/${actors[1].id}/assets/*/thumbnail`, route => route.fulfill({ status: 404 }));
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/app/ai-studio');
  const trigger = page.getByRole('button', { name: /^真人演员：/ });
  await trigger.click();
  const menu = page.getByRole('dialog', { name: '真人演员', exact: true });
  const first = menu.getByRole('option', { name: '演员1 图片1', exact: true });
  await expect(first.locator('img')).toHaveCount(0);
  await expect(menu.getByRole('option', { name: '演员1 图片2', exact: true })).toHaveCount(0);
  await first.click();
  await expect(trigger).toHaveText('演员1');
  const failed = menu.getByRole('option', { name: '演员2 图片2', exact: true });
  await expect(failed.locator('img')).toHaveCount(0);
  await failed.click();
  await expect(trigger).toHaveText('演员2');
  expect(await menu.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await menu.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await menu.getByRole('option', { name: '演员12 图片2', exact: true }).click();
  await expect(trigger).toHaveText('演员12');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});


test('后台提交异常显示待核验并禁止直接重试', async ({ page }) => {
  await page.evaluate(() => (window as any).__setGenerationTasks([{
    id: 'job-submission-unknown', createdAt: '2026-09-30T08:58:00.000Z',
    userName: '测试用户', email: 'test@example.com', kind: 'video', model: 'Seedance 2.5',
    status: 'processing', processingStage: 'submission-unknown', providerRunStatus: 'submission-unknown',
    credits: 320, reservedCredits: 320, settledCredits: 0, refundedCredits: 0,
    creditStatus: 'held', mainCreditsUsed: 320, addonCreditsUsed: 0,
    prompt: '生成产品展示视频', config: {}, retryCount: 0, settlementError: 'fetch failed',
  }]));
  await page.goto('/admin/jobs');
  const row = page.getByRole('row').filter({ hasText: mockUuid('job-submission-unknown') });
  await expect(row.getByText('提交异常，待核验', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: '重试', exact: true })).toBeDisabled();
  await expect(row.getByRole('button', { name: '退回', exact: true })).toBeEnabled();
  await row.getByRole('button', { name: '详情', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('提交异常，待核验', { exact: true })).toBeVisible();
  await expect(dialog.getByText('fetch failed', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/已暂停自动重试/)).toBeVisible();
});
