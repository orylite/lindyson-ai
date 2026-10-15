import type { AcquisitionSource } from '@lindyson/api-contracts';
export type AdminStatus = 'active' | 'disabled' | 'draft';
export type OrderStatus = 'paid' | 'pending' | 'refunded' | 'failed';
export type OrderHistoryFilter = 'all' | OrderStatus;
export type UserStatus = 'active' | 'frozen' | 'trial';
export type TicketStatus = 'open' | 'pending' | 'resolved';
export type Priority = 'high' | 'medium' | 'low';
export type InvoiceStatus = 'unissued' | 'issued';
export type CreditType = 'earn' | 'hold' | 'spend' | 'refund' | 'adjust' | 'void';
export type CreditBucket = 'main' | 'addon' | 'mixed' | 'system';
export type CreditSettlementStatus = 'none' | 'held' | 'settled' | 'refunded' | 'reversed';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
export type JobFailureCategory = 'insufficient-credits' | 'provider-failed' | 'content-policy' | 'user-canceled' | 'system-timeout';
export type AuditRisk = 'low' | 'medium' | 'high';
export type PlanRecommendation = 'popular' | 'enterprise' | null;
export type PlanIconKey = 'zap' | 'sparkles' | 'crown' | 'gem' | 'rocket' | 'building-2';

export type PaymentLaunch = PaymentLaunchDto;
export type PaymentAttempt = EndpointResponse<'paymentCreate'>['paymentAttempt'];
export type PaymentAttemptStatus = PaymentAttempt['status'];
export type RefundAttemptStatus = NonNullable<EndpointResponse<'orders'>['items'][number]['refundAttemptStatus']>;

export interface PlatformAnnouncement {
  id: string;
  title: string;
  content: string;
  publishedAt: string;
  pinned: boolean;
}

export interface AdminPlanFeature {
  text: string;
  enabled: boolean;
}

export interface AdminPlan {
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
    assetsPerActor: number;
  };
  storage: string;
  tiktokAccounts: string;
  features: AdminPlanFeature[];
  recommendation: PlanRecommendation;
  iconKey: PlanIconKey | null;
  ctaLabel: string;
  status: AdminStatus;
  landingVisible: boolean;
  subscribers: number;
  revenue: number;
  updatedAt: string;
}

export interface AdminOrder {
  id: string;
  userId: string;
  userName: string;
  email: string;
  kind: 'main' | 'addon';
  planName: string;
  amount: number;
  billing: 'monthly' | 'yearly' | 'one-time';
  status: OrderStatus;
  invoiceStatus: InvoiceStatus;
  creditStatus: CreditSettlementStatus;
  creditAmount: number;
  creditBucket: CreditBucket;
  paymentMethod: string;
  paymentMethodLabel?: string;
  paymentWayLabel?: string;
  paymentProvider?: string;
  paymentWayCode?: string;
  paymentSurface?: 'pc' | 'mobile';
  merchantOrderNo?: string;
  paymentOrderNo?: string;
  paymentError?: string;
  paymentAttemptStatus?: PaymentAttemptStatus;
  paymentAttemptId?: string;
  paymentAttemptError?: string;
  paymentRetryAfterMs?: number;
  paymentExpiresAt?: string;
  paymentExpiresAtIso?: string;
  invoiceRequestStatus?: 'none' | InvoiceStatus;
  estimatedPlanResetAt?: string;
  estimatedPlanExpiresAt?: string;
  refundStatus?: 'none' | 'pending' | 'succeeded' | 'failed';
  merchantRefundNo?: string;
  refundOrderNo?: string;
  refundError?: string;
  refundAttemptStatus?: RefundAttemptStatus;
  refundAttemptId?: string;
  refundManualReviewReason?: string;
  refundRetryAfterMs?: number;
  createdAt: string;
  createdAtIso?: string;
  paidAt?: string;
  paidAtIso?: string;
  failedAt?: string;
  refundedAt?: string;
}

export interface AdminOverviewSummary {
  totalUsers: number;
  todayNewUsers: number;
  monthNewUsers: number;
  totalRevenue: number;
  todayRevenue: number;
  monthRevenue: number;
  sevenDayRevenue: number;
  totalJobs: number;
  todayJobs: number;
  activeJobs: number;
  openTickets: number;
  pendingInvoices: number;
  sevenDayPaymentFailures: number;
  inactiveUsers: number;
  failedJobs: number;
  sevenDayApiRequests: number;
  sevenDayApiSuccesses: number;
  sevenDayApiSuccessRate: number;
  revenueTrend: Array<{
    day: string;
    revenue: number;
    orders: number;
  }>;
  modelUsage: Array<{
    model: string;
    billableTokens: number;
  }>;
  acquisitionMix: Array<{
    source: AcquisitionSource;
    registrations: number;
    paidUsers: number;
    revenue: number;
  }>;
  timezone: string;
  dayStart: string;
  monthStart: string;
  apiCostHealth: {
    syncStatus: 'normal' | 'warning' | 'error';
    lastSyncedAt: string;
    matchState: 'raw-matched' | 'adjusted-matched' | 'residual' | 'cannot-reconcile';
    residualTokens: number | null;
    residualCostCny: string | null;
  };
}

export interface OrderHistoryPage {
  items: AdminOrder[];
  pagination: {
    limit: number;
    position: 'first' | 'previous' | 'next' | 'last';
    hasPrevious: boolean;
    hasNext: boolean;
    previousCursor: string | null;
    nextCursor: string | null;
    currentPage: number;
    totalPages: number;
    totalItems: number;
    snapshotCursor: string;
  };
}

export interface AdminPaymentChannel {
  enabled: boolean;
  apiBase: string;
  mchNo: string;
  appId: string;
  hasApiKey: boolean;
  desktopWayCode: 'ALI_WAP';
  mobileWayCode: 'ALI_WAP';
  updatedAt?: string;
}

export interface AdminInvoiceRequest {
  id: string;
  orderId: string;
  userId: string;
  userName: string;
  email: string;
  planName: string;
  amount: number;
  invoiceTitle: string;
  taxId: string;
  receiveEmail: string;
  status: InvoiceStatus;
  requestedAt: string;
  issuedAt?: string;
  note: string;
}

export interface AdminUserAcquisition {
  source: AcquisitionSource;
  rawSource: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  referrerHost: string | null;
  landingPath: string | null;
  firstTouchAt: string | null;
}

export interface AdminUser {
  id: string;
  userName: string;
  email: string;
  planId: string | null;
  planCode: string | null;
  planName: string;
  billingCycle: 'monthly' | 'yearly';
  planCycleStartedAt: string;
  mainCredits: number;
  addonCredits: number;
  credits: number;
  totalCredits: number;
  planResetAt: string | null;
  planExpiresAt: string | null;
  activeSubscriptionOrderId: string | null;
  status: UserStatus;
  registeredAt: string;
  lastActiveAt: string;
  orderCount: number;
  apiCalls: number;
  ticketCount: number;
  acquisition: AdminUserAcquisition | null;
}

export interface AdminUserSubscriptionExpected {
  planId: string | null;
  billingCycle: 'monthly' | 'yearly';
  planCycleStartedAt: string;
  planResetAt: string | null;
  planExpiresAt: string | null;
  activeSubscriptionOrderId: string | null;
  mainCredits: number;
}

export interface AdminUserSubscriptionUpdate {
  planId: string | null;
  billingCycle: 'monthly' | 'yearly' | null;
  planResetAt: string | null;
  planExpiresAt: string | null;
  note: string;
  expected: AdminUserSubscriptionExpected;
  expectedPlanCredits: number;
}

export interface UserTicket {
  id: string;
  userId?: string;
  title: string;
  userName: string;
  email: string;
  priority: Priority;
  status: TicketStatus;
  assignee: string;
  createdAt: string;
  updatedAt: string;
  slaHours: number;
  lastMessage: string;
  unreadCount: number;
  messageCount: number;
  lastMessageAuthor: 'user' | 'admin';
  lastMessageAt: string;
}

export interface AdminTicket extends UserTicket {
  internalNote: string;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorRole: 'user' | 'admin';
  authorName: string;
  authorEmail: string;
  body: string;
  createdAt: string;
}

export interface AdminApiPackageInstance {
  id: string;
  packageId: string;
  product: string;
  config: string;
  recognizedModel: string;
  status: string;
  totalQuota: number;
  remainingQuota: number;
  startsAt: string;
  expiresAt: string;
}

export type AdminApiCostDashboardSnapshot = Omit<AdminApiCostDashboardDto, 'packages'> & {
  packages: AdminApiPackageInstance[];
};

/** 经营看盘只读取必要字段，避免加载高级审计账本和资源包明细。 */
export type AdminApiCostOverviewSnapshot = EndpointResponse<'adminApiUsageOverview'>;

export type AdminApiCostDashboard = AdminApiCostDashboardSnapshot & {
  reconciliation: AdminApiCostReconciliationPage;
  settlement: AdminApiCostSettlementPage;
};

export type AdminApiCostTask = AdminApiCostTaskDto;
export type AdminApiCostUser = AdminApiCostUserDto;
export type AdminApiCostAttempt = AdminApiCostAttemptDto;
export type AdminApiCostTaskPage = Omit<AdminApiCostTaskResponseDto, 'items'> & {
  items: AdminApiCostTask[];
};
export type AdminApiCostUserPage = Omit<AdminApiCostUserResponseDto, 'items'> & {
  items: AdminApiCostUser[];
};
export type AdminApiCostAttemptPage = Omit<AdminApiCostAttemptResponseDto, 'items'> & {
  items: AdminApiCostAttempt[];
};
export type AdminApiCostFilters = Omit<AdminApiCostTaskQueryDto, 'position' | 'cursor' | 'snapshotCursor' | 'limit'>;
export type AdminApiCostAttemptFilters = Omit<AdminApiCostAttemptQueryDto, 'position' | 'cursor' | 'snapshotCursor' | 'limit'>;
export type AdminApiCostDashboardFilters = AdminApiCostDashboardQueryDto;
export type AdminApiCostReconciliationFilters = Omit<AdminApiCostReconciliationQueryDto, 'position' | 'cursor' | 'snapshotCursor' | 'limit'>;
export type AdminApiCostSettlementFilters = Omit<AdminApiCostSettlementQueryDto, 'position' | 'cursor' | 'snapshotCursor' | 'limit'>;
export type AdminApiCostReconciliationPage = AdminApiCostReconciliationResponseDto;
export type AdminApiCostReconciliationDetail = AdminApiCostReconciliationDetailResponseDto;
export type AdminApiCostSettlementPage = AdminApiCostSettlementResponseDto;

export type AdminProviderBillingOverview = AdminProviderBillingOverviewResponseDto;
export type AdminProviderBillingDetail = AdminProviderBillingDetailsResponseDto['items'][number];
export type AdminProviderBillingOperationalUsage = AdminProviderBillingOperationalUsageResponseDto['items'][number];
export type AdminProviderBillingDetailsPage = AdminProviderBillingDetailsResponseDto;
export type AdminProviderBillingOperationalUsagePage = AdminProviderBillingOperationalUsageResponseDto;
export type AdminProviderBillingFilters = AdminProviderBillingOverviewQueryDto;
export type AdminProviderBillingDetailsFilters = Omit<AdminProviderBillingDetailsQueryDto, 'position' | 'cursor' | 'snapshotCursor' | 'limit'>;
export type AdminProviderBillingOperationalUsageFilters = Omit<AdminProviderBillingOperationalUsageQueryDto, 'position' | 'cursor' | 'snapshotCursor' | 'limit'>;

type AdminMultimodalCostOverviewBase = AdminMultimodalCostOverviewResponseDto;
type AdminMultimodalCostUserBase = AdminMultimodalCostUserResponseDto['items'][number];
type AdminMultimodalCostOperationBase = AdminMultimodalCostOperationResponseDto['items'][number];
type AdminMultimodalHistoricalPricingFields = {
  historicalPricedOperationCount: number;
};

export type AdminMultimodalCostOverview = Omit<AdminMultimodalCostOverviewBase, 'summary' | 'models'> & {
  summary: AdminMultimodalCostOverviewBase['summary'] & AdminMultimodalHistoricalPricingFields;
  models: Array<AdminMultimodalCostOverviewBase['models'][number] & AdminMultimodalHistoricalPricingFields>;
};
export type AdminMultimodalCostUser = AdminMultimodalCostUserBase & AdminMultimodalHistoricalPricingFields;
export type AdminMultimodalCostOperation = Omit<AdminMultimodalCostOperationBase, 'usageEvidence'> & {
  usageEvidence: AdminMultimodalCostOperationBase['usageEvidence'] | 'historical-aggregate-priced';
};
export type AdminMultimodalCostUserPage = Omit<AdminMultimodalCostUserResponseDto, 'items'> & {
  items: AdminMultimodalCostUser[];
};
export type AdminMultimodalCostOperationPage = Omit<AdminMultimodalCostOperationResponseDto, 'items'> & {
  items: AdminMultimodalCostOperation[];
};
export type AdminMultimodalCostOverviewFilters = AdminMultimodalCostOverviewQueryDto;
export type AdminMultimodalCostUserFilters = Omit<AdminMultimodalCostUserQueryDto, 'position' | 'cursor' | 'snapshotCursor' | 'limit'>;
export type AdminMultimodalCostOperationFilters = Omit<AdminMultimodalCostOperationQueryDto, 'position' | 'cursor' | 'snapshotCursor' | 'limit'>;

export type AdminImageCostOverview = AdminImageCostOverviewResponseDto;
export type AdminImageCostTask = AdminImageCostTaskResponseDto['items'][number];
export type AdminImageCostUser = AdminImageCostUserResponseDto['items'][number];
export type AdminImageCostTaskPage = AdminImageCostTaskResponseDto;
export type AdminImageCostUserPage = AdminImageCostUserResponseDto;
export type AdminImageCostOverviewFilters = AdminImageCostOverviewQueryDto;
export type AdminImageCostTaskFilters = Omit<AdminImageCostTaskQueryDto, 'position' | 'cursor' | 'snapshotCursor' | 'limit'>;
export type AdminImageCostUserFilters = Omit<AdminImageCostUserQueryDto, 'position' | 'cursor' | 'snapshotCursor' | 'limit'>;

export type AdminApiCostPageKind = 'reconciliation' | 'settlement' | 'attempts' | 'tasks' | 'users';

export interface AdminApiCostPageLoadState {
  loaded: number;
  limit: number;
  position: 'first' | 'previous' | 'next' | 'last';
  hasPrevious: boolean;
  hasNext: boolean;
  previousCursor: string | null;
  nextCursor: string | null;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  snapshotCursor: string;
  loading: boolean;
}

export type AdminApiCostResourcePhase = 'idle' | 'loading' | 'ready' | 'refreshing' | 'error';

export interface AdminApiCostResourceState {
  phase: AdminApiCostResourcePhase;
  requestedKey: string | null;
  dataKey: string | null;
  error: string | null;
  updatedAt: string | null;
}

export interface AdminApiCostLoadState {
  overview: AdminApiCostResourceState;
  users: AdminApiCostResourceState;
  tasks: AdminApiCostResourceState;
}

export type AdminApiCostPaginationState = Record<AdminApiCostPageKind, AdminApiCostPageLoadState>;

export interface UserCreditLedgerEntry {
  id: string;
  time: string;
  type: CreditType;
  bucket: CreditBucket;
  settlementStatus?: CreditSettlementStatus;
  amount: number;
  balance: number;
  source: string;
  note: string;
  relatedOrderId?: string;
  relatedJobId?: string;
  relatedAssetId?: string;
  generationSnapshot?: GenerationCreditSnapshot;
}

/** 生成流水发生时的不可变 attempt 与账务规格，不从可重试的任务当前行反查。 */
export interface GenerationCreditSnapshot {
  attempt: number;
  model: string;
  durationSeconds: number | null;
  resolution: string | null;
  hasReferenceVideo: boolean;
  reservedCredits: number;
  settledCredits: number;
  refundedCredits: number;
  taskStatus: JobStatus;
  creditStatus: CreditSettlementStatus;
}

export interface AdminCreditLedgerEntry extends UserCreditLedgerEntry {
  userId: string;
  userName: string;
  email: string;
  operator: string;
}

export interface AdminGenerationJob {
  id: string;
  time: string;
  createdAtIso?: string;
  userName: string;
  email: string;
  kind: 'video' | 'image';
  model: string;
  status: JobStatus;
  duration: string;
  credits: number;
  reservedCredits: number;
  settledCredits: number;
  refundedCredits: number;
  creditStatus: CreditSettlementStatus;
  mainCreditsUsed: number;
  addonCreditsUsed: number;
  prompt: string;
  config: string;
  configData?: Record<string, unknown>;
  failCategory?: JobFailureCategory;
  failReason?: string;
  assetId?: string;
  assetName?: string;
  assetSource?: string;
  assetThumbnailUrl?: string;
  assetAvailable?: boolean;
  ledgerIds?: string[];
  retryCount: number;
  attempt?: number;
  processingStage?: string | null;
  cancelState?: string;
  claimEpoch?: number;
  providerRunId?: string;
  providerRunStatus?: string | null;
  providerTaskId?: string;
  settlementError?: string | null;
  heartbeatAt?: string;
  leaseExpiresAt?: string;
  startedAt?: string;
  completedAt?: string;
}

interface VideoGenerationReserveRequestBase {
  kind: 'video';
  model: string;
  prompt: string;
  config: {
    mode: 'general' | 'first-last';
    aspectRatio: '9:16' | '16:9' | 'adaptive';
    resolution: '480p' | '720p' | '1080p';
    durationSeconds: 5 | 10 | 15 | 20 | 25 | 30;
    generateAudio?: boolean;
  };
  references: Array<{
    assetId: string;
    role: 'reference_image' | 'reference_video' | 'reference_audio' | 'first_frame' | 'last_frame';
  }>;
  realPortrait?: {
    actorId: string;
    portraitAssetId?: string;
  };
}

export type VideoGenerationReserveRequest = VideoGenerationReserveRequestBase & (
  | { promptWizardSource?: PromptWizardSource; tkPromptSource?: never }
  | { promptWizardSource?: never; tkPromptSource?: TkPromptSource }
);

export type ImageGenerationAspectRatio = '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3' | '21:9';
export type ImageGenerationResolution = '1K' | '2K';
export type ImageGenerationOptimizePromptMode = 'standard' | 'fast';

export interface ImagePointAnnotation {
  token: `@标记${number}`;
  assetId: string;
  type: 'point';
  x: number;
  y: number;
}

export interface ImageBboxAnnotation {
  token: `@标记${number}`;
  assetId: string;
  type: 'bbox';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type ImageGenerationAnnotation = ImagePointAnnotation | ImageBboxAnnotation;

export interface ImageGenerationReserveRequest {
  kind: 'image';
  model: 'Seedream 5.0 Pro';
  prompt: string;
  config: {
    resolution: ImageGenerationResolution;
    aspectRatio: ImageGenerationAspectRatio;
    optimizePromptMode: ImageGenerationOptimizePromptMode;
  };
  references: Array<{
    assetId: string;
    role: 'reference_image';
  }>;
  annotations: ImageGenerationAnnotation[];
}

export type GenerationReserveRequest = VideoGenerationReserveRequest | ImageGenerationReserveRequest;

export interface GenerationReserveSuccess {
  ok: true;
  jobs: AdminGenerationJob[];
}

export interface GenerationReserveFailure {
  ok: false;
  message: string;
}

export type GenerationReserveResult = GenerationReserveSuccess | GenerationReserveFailure;

export interface GenerationSettlePayload {
  jobId: string;
  duration: string;
  assetId: string;
  assetName: string;
  assetSource: string;
}

export interface GenerationRefundPayload {
  jobId: string;
  status: 'failed' | 'canceled';
  failCategory: JobFailureCategory;
  failReason: string;
}

export interface AdminAuditLog {
  id: string;
  time: string;
  admin: string;
  module: string;
  action: string;
  target: string;
  risk: AuditRisk;
  ip: string;
  detail: string;
}
import type {
  AdminApiCostAttemptDto,
  AdminApiCostTaskDto,
  AdminApiCostUserDto,
  EndpointRequestQuery,
  EndpointResponse,
  PaymentLaunchDto,
  PromptWizardSource,
  TkPromptSource,
} from '@lindyson/api-contracts';

type AdminApiCostDashboardDto = EndpointResponse<'adminApiUsage'>;
type AdminApiCostDashboardQueryDto = EndpointRequestQuery<'adminApiUsage'>;
type AdminApiCostTaskQueryDto = EndpointRequestQuery<'adminApiUsageTasks'>;
type AdminApiCostTaskResponseDto = EndpointResponse<'adminApiUsageTasks'>;
type AdminApiCostAttemptQueryDto = EndpointRequestQuery<'adminApiUsageAttempts'>;
type AdminApiCostAttemptResponseDto = EndpointResponse<'adminApiUsageAttempts'>;
type AdminApiCostUserResponseDto = EndpointResponse<'adminApiUsageUsers'>;
type AdminApiCostReconciliationQueryDto = EndpointRequestQuery<'adminApiUsageReconciliation'>;
type AdminApiCostSettlementQueryDto = EndpointRequestQuery<'adminApiUsageSettlement'>;
type AdminApiCostReconciliationResponseDto = EndpointResponse<'adminApiUsageReconciliation'>;
type AdminApiCostReconciliationDetailResponseDto = EndpointResponse<'adminApiUsageReconciliationDetail'>;
type AdminApiCostSettlementResponseDto = EndpointResponse<'adminApiUsageSettlement'>;
type AdminProviderBillingOverviewQueryDto = EndpointRequestQuery<'adminProviderBillingOverview'>;
type AdminProviderBillingOverviewResponseDto = EndpointResponse<'adminProviderBillingOverview'>;
type AdminProviderBillingDetailsQueryDto = EndpointRequestQuery<'adminProviderBillingDetails'>;
type AdminProviderBillingDetailsResponseDto = EndpointResponse<'adminProviderBillingDetails'>;
type AdminProviderBillingOperationalUsageQueryDto = EndpointRequestQuery<'adminProviderBillingOperationalUsage'>;
type AdminProviderBillingOperationalUsageResponseDto = EndpointResponse<'adminProviderBillingOperationalUsage'>;
type AdminMultimodalCostOverviewQueryDto = EndpointRequestQuery<'adminApiUsageMultimodalOverview'>;
type AdminMultimodalCostOverviewResponseDto = EndpointResponse<'adminApiUsageMultimodalOverview'>;
type AdminMultimodalCostUserQueryDto = EndpointRequestQuery<'adminApiUsageMultimodalUsers'>;
type AdminMultimodalCostUserResponseDto = EndpointResponse<'adminApiUsageMultimodalUsers'>;
type AdminMultimodalCostOperationQueryDto = EndpointRequestQuery<'adminApiUsageMultimodalOperations'>;
type AdminMultimodalCostOperationResponseDto = EndpointResponse<'adminApiUsageMultimodalOperations'>;
type AdminImageCostOverviewQueryDto = EndpointRequestQuery<'adminApiUsageImageOverview'>;
type AdminImageCostOverviewResponseDto = EndpointResponse<'adminApiUsageImageOverview'>;
type AdminImageCostUserQueryDto = EndpointRequestQuery<'adminApiUsageImageUsers'>;
type AdminImageCostUserResponseDto = EndpointResponse<'adminApiUsageImageUsers'>;
type AdminImageCostTaskQueryDto = EndpointRequestQuery<'adminApiUsageImageTasks'>;
type AdminImageCostTaskResponseDto = EndpointResponse<'adminApiUsageImageTasks'>;
