import { referralCodeSchema, referralSettingsSchema, referralStatusSchema, referralPageSchema, referralSummarySchema } from './referrals.js';
import { acquisitionSourceSchema, registrationAttributionSchema } from './acquisition.js';
import { mcpEndpointContracts } from './mcp.js';
import { z } from 'zod';
import {
  apiErrorResponseSchema,
  createExactCursorPageSchema,
  cursorSchema,
  emailSchema,
  emptyObjectSchema,
  httpUrlSchema,
  idempotencyKeySchema,
  isoDateSchema,
  isoDateTimeSchema,
  nullableIsoDateTimeSchema,
  MAX_UPLOAD_SIZE_BYTES,
  nonemptyStringSchema,
  nonnegativeIntegerSchema,
  okResponseSchema,
  pagePositionSchema,
  uuidParamsSchema,
  uuidSchema,
} from './primitives.js';
import {
  userProfileSchema,
  adminCreditLedgerSchema,
  adminGenerationTaskCardSchema,
  adminGenerationTaskSchema,
  adminOverviewSchema,
  adminApiCostHealthSchema,
  adminPaymentChannelSchema,
  adminTicketMessageSchema,
  adminTicketSchema,
  adminUserSchema,
  adminAnnouncementSchema,
  adminApiPackageSchema,
  adminApiAccountBalanceSchema,
  adminApiCostDailySchema,
  adminApiCostSelectionSchema,
  adminApiCostCoverageSchema,
  adminApiCostCombinedStatusSchema,
  adminApiCostCurrentStateSchema,
  adminApiCostUsageBookSchema,
  adminApiCostValuationBookSchema,
  adminApiCostSettlementBookSchema,
  adminApiCostReconciliationBucketSchema,
  adminApiCostReconciliationEvidenceSchema,
  adminApiCostSettlementItemSchema,
  adminApiCostModelSchema,
  adminApiCostOperationsSchema,
  adminApiCostOverviewOperationsSchema,
  adminApiCostOperationsModelSchema,
  adminApiCostSummarySchema,
  adminApiCostSyncItemSchema,
  adminApiCostAttemptSchema,
  adminApiCostTaskSchema,
  adminApiCostUserSchema,
  adminMultimodalCostModelSchema,
  adminMultimodalCostOperationSchema,
  adminMultimodalCostOperationStatusSchema,
  adminMultimodalCostOperationTypeSchema,
  adminMultimodalCostSummarySchema,
  adminMultimodalCostUserSchema,
  adminImageCostEvidenceStatusSchema,
  adminImageCostPricingSchema,
  adminImageCostSummarySchema,
  adminImageCostTaskSchema,
  adminImageCostUserSchema,
  providerBillingAttributionStatusSchema,
  providerBillingAttributionSummarySchema,
  providerBillingDetailSchema,
  providerBillingFinalitySchema,
  providerBillingProductSummarySchema,
  providerBillingServiceTypeSchema,
  providerBillingServiceTypeSummarySchema,
  providerBillingSummarySchema,
  providerOperationalUsageSchema,
  adminApiPricingRuleSchema,
  apiCostEstimateStatusSchema,
  apiCostAttributionConfidenceSchema,
  apiCostBillLineTypeSchema,
  apiCostInputClassSchema,
  apiCostMatchStateSchema,
  apiCostPaymentStatusSchema,
  apiCostPricingResolutionSchema,
  apiCostPricingRuleStatusSchema,
  apiCostUsageEvidenceOriginSchema,
  apiCostResolutionSchema,
  nonnegativeCnyAmountSchema,
  assetFolderSchema,
  assetFolderContentActionSchema,
  assetFolderDeleteResultSchema,
  assetCardPaginationSchema,
  assetCardPositionSchema,
  assetCardSortSchema,
  assetCardSchema,
  assetDetailSchema,
  assetSummarySchema,
  assetSourceSchema,
  assetTypeSchema,
  adminAuditLogSchema,
  auditRiskSchema,
  billingCycleSchema,
  consumptionSettingSchema,
  creditTypeSchema,
  userCreditLedgerSchema,
  dashboardSummarySchema,
  featureFlagsSchema,
  invoiceSchema,
  invoiceStatusSchema,
  orderSchema,
  orderStatusSchema,
  paymentLaunchSchema,
  paymentAttemptSchema,
  planBillingSchema,
  planFeatureSchema,
  planIconKeySchema,
  planKindSchema,
  planRecommendationSchema,
  portraitEntitlementsSchema,
  realPortraitActorSchema,
  realPortraitActorListSchema,
  realPortraitActivationSchema,
  realPortraitAssetKindSchema,
  realPortraitAssetSchema,
  realPortraitCapacitySchema,
  publicRealPortraitInviteSchema,
  publicRealPortraitAuthorizationSchema,
  adminRealPortraitCapacitySchema,
  adminPlanSchema,
  publicAnnouncementSchema,
  publicPlanSchema,
  planStatusSchema,
  ticketPrioritySchema,
  ticketStatusSchema,
  userGenerationTaskSchema,
  userGenerationTaskCardSchema,
  generationKindSchema,
  generationStatusSchema,
  uploadSessionSchema,
  userStatusSchema,
  userTicketMessageSchema,
  userTicketSchema,
  generationReferenceInputSchema,
  seedreamImageReferenceInputSchema,
  videoGenerationRequestConfigSchema,
  videoModelCapabilitySchema,
  seedanceVideoModelLabelSchema,
  imageGenerationRequestConfigSchema,
  seedreamAnnotationSchema,
  promptWizardRunSchema,
  promptWizardBatchSchema,
  promptWizardSettingsSchema,
  promptWizardProductProfileSchema,
  promptWizardVideoConfigSchema,
  promptWizardConceptSetSchema,
  promptWizardUseDirectionSetSchema,
  promptWizardPlanRevisionSchema,
  promptWizardSourceSchema,
  tkPromptRunSchema,
  tkPromptGenerationSchema,
  tkPromptEngineSettingsSchema,
  tkPromptEvidenceReviewSchema,
  tkPromptCreativeInputSchema,
  tkPromptVideoConfigSchema,
  tkPromptSourceSchema,
} from './resources.js';
import type {
  AdminCreditLedgerDto,
  ConsumptionSettingDto,
  PromptWizardSettings,
  TkPromptEngineSettings,
  UserCreditLedgerDto,
  VideoModelCapabilityDto,
} from './resources.js';

export interface EndpointContract {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  successStatus: number;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
  response: z.ZodTypeAny;
}

function contract<const T extends EndpointContract>(value: T) {
  return value;
}

const userResponse = z.object({ user: userProfileSchema });
const orderResponse = z.object({ order: orderSchema });
const ticketResponse = z.object({ ticket: userTicketSchema });
const adminTicketResponse = z.object({ ticket: adminTicketSchema });
const taskResponse = z.object({ task: userGenerationTaskSchema });
const adminTaskResponse = z.object({ task: adminGenerationTaskSchema });
const generationConsumptionSettingsResponseSchema: z.ZodType<{
  items: ConsumptionSettingDto[];
  promptWizard: PromptWizardSettings;
  tkPromptEngine: TkPromptEngineSettings;
  videoModels: VideoModelCapabilityDto[];
}, z.ZodTypeDef, any> = z.object({
  items: z.array(consumptionSettingSchema),
  promptWizard: promptWizardSettingsSchema,
  // 兼容先部署前端/合同、后部署 API 的短暂窗口；缺省时必须保持关闭。
  tkPromptEngine: tkPromptEngineSettingsSchema.default({
    schemaVersion: 1,
    generationCredits: 1,
    available: false,
    updatedAt: '1970-01-01T00:00:00.000Z',
  }),
  videoModels: z.array(videoModelCapabilitySchema).default([]),
});
const videoDuration25CompatibilityQuerySchema = z.object({
  videoDuration25: z.literal('1').optional(),
}).strict();
const consumptionSettingsListResponseSchema: z.ZodType<{ items: ConsumptionSettingDto[] }> = z.object({
  items: z.array(consumptionSettingSchema),
});
type CreditLedgerPageResponse<Item> = {
  items: Item[];
  pagination: {
    limit: number;
    hasPrevious: boolean;
    hasNext: boolean;
    previousCursor: string | null;
    nextCursor: string | null;
    currentPage: number;
    totalPages: number;
    totalItems: number;
    snapshotCursor: string;
  };
};
const userCreditLedgerPageResponseSchema: z.ZodType<
  CreditLedgerPageResponse<UserCreditLedgerDto>,
  z.ZodTypeDef,
  unknown
> = createExactCursorPageSchema(userCreditLedgerSchema);
const adminCreditLedgerPageResponseSchema: z.ZodType<
  CreditLedgerPageResponse<AdminCreditLedgerDto>,
  z.ZodTypeDef,
  unknown
> = createExactCursorPageSchema(adminCreditLedgerSchema);
const userPageQueryShape = {
  position: pagePositionSchema.default('first'),
  cursor: cursorSchema.optional(),
  snapshotCursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};
const adminPageQueryShape = {
  position: pagePositionSchema.optional(),
  cursor: cursorSchema.optional(),
  snapshotCursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
};
const adminSearchSchema = z.string().trim().max(120).optional();
const adminUsersQuery = z.object({
  ...adminPageQueryShape,
  search: adminSearchSchema,
  status: userStatusSchema.optional(),
  source: acquisitionSourceSchema.optional(),
}).strict();
const adminOrdersQuery = z.object({
  ...adminPageQueryShape,
  search: adminSearchSchema,
  status: orderStatusSchema.optional(),
  userId: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
}).strict();
const adminAnnouncementsQuery = z.object({
  ...adminPageQueryShape,
  search: adminSearchSchema,
}).strict();
const adminInvoicesQuery = z.object({
  ...adminPageQueryShape,
  search: adminSearchSchema,
  status: invoiceStatusSchema.optional(),
  userId: uuidSchema.optional(),
  orderId: uuidSchema.optional(),
}).strict();
const adminTicketsQuery = z.object({
  ...adminPageQueryShape,
  search: adminSearchSchema,
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
}).strict();
const adminJobsQuery = z.object({
  ...adminPageQueryShape,
  search: adminSearchSchema,
  status: generationStatusSchema.optional(),
  userId: uuidSchema.optional(),
}).strict();
const adminCreditLedgerQuery = z.object({
  ...adminPageQueryShape,
  search: adminSearchSchema,
  type: creditTypeSchema.optional(),
  userId: uuidSchema.optional(),
  relatedOrderId: uuidSchema.optional(),
  relatedJobId: uuidSchema.optional(),
}).strict();
const adminAuditLogsQuery = z.object({
  ...adminPageQueryShape,
  search: adminSearchSchema,
  risk: auditRiskSchema.optional(),
  module: z.string().trim().max(80).optional(),
}).strict();
const apiCostMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const apiCostRangeQueryShape = {
  range: z.enum(['all', 'month', 'date', 'custom']).optional(),
  month: apiCostMonthSchema.optional(),
  date: isoDateSchema.optional(),
  /** 兼容一个版本的旧区间参数；新客户端应使用 range。 */
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  model: z.string().trim().min(1).max(120).optional(),
  asOf: isoDateTimeSchema.optional(),
};

function validateApiCostRange(value: Record<string, unknown>, context: z.RefinementCtx) {
  const range = value.range as string | undefined;
  const month = value.month as string | undefined;
  const date = value.date as string | undefined;
  const from = value.from as string | undefined;
  const to = value.to as string | undefined;
  const hasBounds = Boolean(from || to);
  if (hasBounds && (!from || !to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'from 与 to 必须同时提供', path: [from ? 'to' : 'from'] });
  }
  if (hasBounds && range && range !== 'custom') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'from/to 只能用于 custom 范围', path: ['range'] });
  }
  if (hasBounds && (month || date)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'from/to 不能与 month/date 混用' });
  }
  if (from && to && from > to) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'from 不能晚于 to', path: ['from'] });
  }
  if (range === 'all' && (month || date)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '全部模式不能携带 month 或 date', path: ['range'] });
  }
  if (range === 'month' && !month) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '月份模式必须提供 month', path: ['month'] });
  }
  if (range === 'date' && !date) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '日期模式必须提供 date', path: ['date'] });
  }
  if (range === 'custom' && (!from || !to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '自定义范围必须同时提供 from 与 to', path: ['from'] });
  }
  if (range === 'custom' && (month || date)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '自定义范围不能携带 month 或 date', path: ['range'] });
  }
  if ((range === 'month' || month) && date) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '月份与日期筛选不能同时使用', path: ['date'] });
  }
}

const adminApiCostDashboardQuery = z.object(apiCostRangeQueryShape).strict().superRefine(validateApiCostRange);
const adminApiCostPagedQueryBase = z.object({
  position: pagePositionSchema.default('first'),
  cursor: cursorSchema.optional(),
  snapshotCursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  ...apiCostRangeQueryShape,
});
const adminApiCostAttributionQueryShape = {
  resolution: apiCostResolutionSchema.optional(),
  pricingResolution: apiCostPricingResolutionSchema.optional(),
  inputClass: apiCostInputClassSchema.optional(),
  status: z.enum(['completed', 'failed', 'canceled']).optional(),
  estimateStatus: apiCostEstimateStatusSchema.optional(),
  usageEvidenceOrigin: apiCostUsageEvidenceOriginSchema.optional(),
  pricingRuleStatus: apiCostPricingRuleStatusSchema.optional(),
  attributionConfidence: apiCostAttributionConfidenceSchema.optional(),
  search: z.string().trim().max(200).optional(),
};
const adminApiCostBusinessQueryShape = {
  resolution: apiCostResolutionSchema.optional(),
  status: generationStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
};
const adminApiCostTaskQueryShape = {
  ...adminApiCostBusinessQueryShape,
  costState: z.enum([
    'unfinalized',
    'unresolved',
    'pending-final-bill',
    'approved-zero',
    'recorded',
  ]).optional(),
};
const adminMultimodalCostUsersQuery = adminApiCostPagedQueryBase.extend({
  search: z.string().trim().max(200).optional(),
}).strict().superRefine(validateApiCostRange);
const adminMultimodalCostOperationsQuery = adminApiCostPagedQueryBase.extend({
  operationType: adminMultimodalCostOperationTypeSchema.optional(),
  status: adminMultimodalCostOperationStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
}).strict().superRefine(validateApiCostRange);
const adminImageCostRangeQueryShape = {
  range: z.enum(['month', 'date', 'custom']).optional(),
  month: apiCostMonthSchema.optional(),
  date: isoDateSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  asOf: isoDateTimeSchema.optional(),
};
const adminImageCostOverviewQuery = z.object(adminImageCostRangeQueryShape)
  .strict()
  .superRefine(validateApiCostRange);
const adminImageCostPagedQueryBase = z.object({
  position: pagePositionSchema.default('first'),
  cursor: cursorSchema.optional(),
  snapshotCursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  ...adminImageCostRangeQueryShape,
});
const adminImageCostTasksQuery = adminImageCostPagedQueryBase.extend({
  status: generationStatusSchema.optional(),
  evidenceStatus: adminImageCostEvidenceStatusSchema.optional(),
  search: adminSearchSchema,
}).strict().superRefine(validateApiCostRange);
const adminImageCostUsersQuery = adminImageCostPagedQueryBase.extend({
  search: adminSearchSchema,
}).strict().superRefine(validateApiCostRange);
const providerBillingFilterQueryShape = {
  ...apiCostRangeQueryShape,
  product: z.string().trim().min(1).max(160).optional(),
  serviceType: providerBillingServiceTypeSchema.optional(),
  finality: providerBillingFinalitySchema.optional(),
  attributionStatus: providerBillingAttributionStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
};
const providerBillingOverviewQueryBase = z.object(providerBillingFilterQueryShape).strict();
const providerBillingPagedQueryBase = z.object({
  position: pagePositionSchema.default('first'),
  cursor: cursorSchema.optional(),
  snapshotCursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  ...providerBillingFilterQueryShape,
}).strict();
type ProviderBillingFilterQuery = z.output<typeof providerBillingOverviewQueryBase>;
type ProviderBillingFilterQueryInput = z.input<typeof providerBillingOverviewQueryBase>;
type ProviderBillingPageQuery = z.output<typeof providerBillingPagedQueryBase>;
type ProviderBillingPageQueryInput = z.input<typeof providerBillingPagedQueryBase>;
const providerBillingOverviewQuery: z.ZodType<
  ProviderBillingFilterQuery,
  z.ZodTypeDef,
  ProviderBillingFilterQueryInput
> = providerBillingOverviewQueryBase.superRefine(validateApiCostRange);
const providerBillingPagedQuery: z.ZodType<
  ProviderBillingPageQuery,
  z.ZodTypeDef,
  ProviderBillingPageQueryInput
> = providerBillingPagedQueryBase.superRefine(validateApiCostRange);

type ProviderBillingSelection = z.output<typeof adminApiCostSelectionSchema>;
interface ProviderBillingOverviewResponse {
  asOf: string;
  selection: ProviderBillingSelection;
  summary: z.output<typeof providerBillingSummarySchema>;
  products: Array<z.output<typeof providerBillingProductSummarySchema>>;
  byServiceType: Array<z.output<typeof providerBillingServiceTypeSummarySchema>>;
  byAttribution: Array<z.output<typeof providerBillingAttributionSummarySchema>>;
}
interface ProviderBillingPageResponse<Item> {
  asOf: string;
  selection: ProviderBillingSelection;
  items: Item[];
  pagination: {
    limit: number;
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
const providerBillingOverviewResponseSchema: z.ZodType<ProviderBillingOverviewResponse> = z.object({
  asOf: isoDateTimeSchema,
  selection: adminApiCostSelectionSchema,
  summary: providerBillingSummarySchema,
  products: z.array(providerBillingProductSummarySchema),
  byServiceType: z.array(providerBillingServiceTypeSummarySchema),
  byAttribution: z.array(providerBillingAttributionSummarySchema),
});
const providerBillingDetailsResponseSchema: z.ZodType<
  ProviderBillingPageResponse<z.output<typeof providerBillingDetailSchema>>
> = createExactCursorPageSchema(providerBillingDetailSchema).extend({
  asOf: isoDateTimeSchema,
  selection: adminApiCostSelectionSchema,
});
const providerOperationalUsageResponseSchema: z.ZodType<
  ProviderBillingPageResponse<z.output<typeof providerOperationalUsageSchema>>
> = createExactCursorPageSchema(providerOperationalUsageSchema).extend({
  asOf: isoDateTimeSchema,
  selection: adminApiCostSelectionSchema,
});
interface ProviderBillingEndpointContracts {
  adminProviderBillingOverview: {
    method: 'GET';
    path: '/api/admin/provider-billing/overview';
    successStatus: 200;
    query: typeof providerBillingOverviewQuery;
    response: typeof providerBillingOverviewResponseSchema;
  };
  adminProviderBillingDetails: {
    method: 'GET';
    path: '/api/admin/provider-billing/details';
    successStatus: 200;
    query: typeof providerBillingPagedQuery;
    response: typeof providerBillingDetailsResponseSchema;
  };
  adminProviderBillingOperationalUsage: {
    method: 'GET';
    path: '/api/admin/provider-billing/operational-usage';
    successStatus: 200;
    query: typeof providerBillingPagedQuery;
    response: typeof providerOperationalUsageResponseSchema;
  };
}
const providerBillingEndpointContracts: ProviderBillingEndpointContracts = {
  adminProviderBillingOverview: contract({
    method: 'GET', path: '/api/admin/provider-billing/overview', successStatus: 200,
    query: providerBillingOverviewQuery,
    response: providerBillingOverviewResponseSchema,
  }),
  adminProviderBillingDetails: contract({
    method: 'GET', path: '/api/admin/provider-billing/details', successStatus: 200,
    query: providerBillingPagedQuery,
    response: providerBillingDetailsResponseSchema,
  }),
  adminProviderBillingOperationalUsage: contract({
    method: 'GET', path: '/api/admin/provider-billing/operational-usage', successStatus: 200,
    query: providerBillingPagedQuery,
    response: providerOperationalUsageResponseSchema,
  }),
};
const uploadSignatureBaseShape = {
  uploadUrl: httpUrlSchema,
  objectKey: nonemptyStringSchema,
  expiresAt: isoDateTimeSchema,
  sessionId: uuidSchema,
  maxSizeBytes: nonnegativeIntegerSchema.positive(),
};
const emptyUploadHeadersSchema = z.record(z.string()).refine(
  headers => Object.keys(headers).length === 0,
  'POST 表单上传不能携带自定义请求头',
);
const postUploadFieldsSchema = z.record(z.string()).refine(
  fields => Object.keys(fields).length > 0,
  'POST 表单上传必须携带签名字段',
);
const uploadSignatureResponseSchema = z.discriminatedUnion('driver', [
  z.object({
    ...uploadSignatureBaseShape,
    driver: z.literal('local'),
    method: z.literal('PUT'),
    headers: z.record(z.string()),
  }),
  z.object({
    ...uploadSignatureBaseShape,
    driver: z.literal('tos'),
    method: z.literal('POST'),
    headers: emptyUploadHeadersSchema,
    fields: postUploadFieldsSchema,
  }),
]);

const realPortraitTokenSchema = z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/);
const realPortraitMimeTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/gif',
  'image/heic',
  'image/heif',
]);
const realPortraitActorParamsSchema = z.object({ actorId: uuidSchema }).strict();
const realPortraitAssetParamsSchema = z.object({ actorId: uuidSchema, portraitAssetId: uuidSchema }).strict();
const realPortraitUploadParamsSchema = z.object({ uploadId: uuidSchema }).strict();
const realPortraitInviteParamsSchema = z.object({ token: realPortraitTokenSchema }).strict();
const realPortraitAuthorizationParamsSchema = z.object({ manageToken: realPortraitTokenSchema }).strict();
const realPortraitCallbackParamsSchema = z.object({ opaqueNonce: realPortraitTokenSchema }).strict();
export const volcRealPortraitValidationCallbackPayloadSchema = z.object({
  bytedToken: z.string().max(2_048).optional(),
  resultCode: z.string().max(160).optional(),
});
const realPortraitUploadSignatureSchema = z.discriminatedUnion('driver', [
  z.object({
    uploadUrl: httpUrlSchema,
    objectKey: nonemptyStringSchema,
    expiresAt: isoDateTimeSchema,
    maxSizeBytes: nonnegativeIntegerSchema.positive(),
    driver: z.literal('local'),
    method: z.literal('PUT'),
    headers: z.record(z.string()),
  }).strict(),
  z.object({
    uploadUrl: httpUrlSchema,
    objectKey: nonemptyStringSchema,
    expiresAt: isoDateTimeSchema,
    maxSizeBytes: nonnegativeIntegerSchema.positive(),
    driver: z.literal('tos'),
    method: z.literal('POST'),
    headers: emptyUploadHeadersSchema,
    fields: postUploadFieldsSchema,
  }).strict(),
]);

const registerCodeBody = z.object({
  userName: nonemptyStringSchema.min(2).max(30),
  email: emailSchema,
}).strict();

const registerBody = z.object({
  referralCode: referralCodeSchema.optional(),
  attribution: registrationAttributionSchema.optional(),
  userName: nonemptyStringSchema.min(2).max(30),
  email: emailSchema,
  password: z.string().min(8).max(32).regex(/[A-Za-z]/).regex(/[0-9]/).refine(value => !/\s/.test(value)),
  verificationId: uuidSchema,
  verificationCode: z.string().regex(/^\d{6}$/),
}).strict();

const planMutationBody = z.object({
  code: nonemptyStringSchema.max(80).optional(),
  name: nonemptyStringSchema.max(120).optional(),
  nameEn: z.string().max(120).optional(),
  kind: planKindSchema.optional(),
  billing: planBillingSchema.optional(),
  description: z.string().max(1_000).optional(),
  monthlyPrice: nonnegativeIntegerSchema.optional(),
  yearlyPrice: nonnegativeIntegerSchema.optional(),
  credits: nonnegativeIntegerSchema.optional(),
  assetRetentionDays: nonnegativeIntegerSchema.max(3650).optional(),
  portraitEntitlements: portraitEntitlementsSchema.optional(),
  storage: z.string().max(80).optional(),
  tiktokAccounts: z.string().max(80).optional(),
  recommendation: planRecommendationSchema.nullable().optional(),
  iconKey: planIconKeySchema.nullable().optional(),
  ctaLabel: z.string().max(80).optional(),
  status: planStatusSchema.optional(),
  landingVisible: z.boolean().optional(),
  features: z.array(planFeatureSchema).max(100).optional(),
}).strict();

function validatePlanMutationRetention(
  payload: z.infer<typeof planMutationBody>,
  context: z.RefinementCtx,
) {
  if (payload.kind === 'addon' && payload.assetRetentionDays !== undefined && payload.assetRetentionDays !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assetRetentionDays'],
      message: '加购包不能设置 AI 生成素材保留天数',
    });
  }
  if (
    payload.kind !== 'addon'
    && payload.portraitEntitlements?.enabled === true
    && (payload.assetRetentionDays === undefined || payload.assetRetentionDays < 1)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assetRetentionDays'],
      message: '启用真人演员库的主套餐必须明确设置 1 到 3650 天的素材保留期',
    });
  }
}

const planPatchBody = planMutationBody.extend({
  portraitEntitlements: portraitEntitlementsSchema,
}).superRefine((payload, context) => {
  validatePlanMutationRetention(payload, context);
  if (payload.kind !== 'addon') return;
  const value = payload.portraitEntitlements;
  if (value.enabled || value.profileLimit !== 0 || value.activeLimit !== 0 || value.assetsPerActor !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['portraitEntitlements'],
      message: '加购包不能包含真人人像素材库权益',
    });
  }
});

const planCreateBody = planMutationBody.extend({
  code: nonemptyStringSchema.max(80),
  name: nonemptyStringSchema.max(120),
  kind: planKindSchema,
  billing: planBillingSchema,
  credits: nonnegativeIntegerSchema,
}).superRefine((payload, context) => {
  validatePlanMutationRetention(payload, context);
  if (payload.kind === 'main' && payload.portraitEntitlements === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['portraitEntitlements'],
      message: '新增主套餐必须明确设置真人人像素材库权益',
    });
  }
  if (payload.kind === 'addon' && payload.portraitEntitlements?.enabled) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['portraitEntitlements'],
      message: '加购包不能启用真人人像素材库权益',
    });
  }
});

const announcementBody = z.object({
  title: nonemptyStringSchema.max(120),
  content: nonemptyStringSchema.max(4_000),
  pinned: z.boolean().default(false),
}).strict();

const paymentChannelBody = z.object({
  enabled: z.boolean(),
  apiBase: z.string().trim().max(500),
  mchNo: z.string().trim().max(30),
  appId: z.string().trim().max(24),
  apiKey: z.string().trim().max(500).optional(),
  desktopWayCode: z.literal('ALI_WAP'),
  mobileWayCode: z.literal('ALI_WAP'),
}).strict();

const ticketMessageBody = z.object({ message: nonemptyStringSchema.max(2_000) }).strict();

const adminCreditAdjustBody = z.object({
  userId: uuidSchema,
  mainDelta: z.number().int().finite().default(0),
  addonDelta: z.number().int().finite().default(0),
  note: nonemptyStringSchema.max(500),
}).strict().refine(payload => payload.mainDelta !== 0 || payload.addonDelta !== 0, {
  message: '至少需要调整一个积分账户',
});

const adminUserSubscriptionSnapshot = z.object({
  planId: uuidSchema.nullable(),
  billingCycle: billingCycleSchema,
  planCycleStartedAt: isoDateSchema,
  planResetAt: isoDateSchema.nullable(),
  planExpiresAt: isoDateSchema.nullable(),
  activeSubscriptionOrderId: uuidSchema.nullable(),
  mainCredits: nonnegativeIntegerSchema,
}).strict();

const adminUserSubscriptionBody = z.object({
  planId: uuidSchema.nullable(),
  billingCycle: billingCycleSchema.nullable(),
  planResetAt: isoDateSchema.nullable(),
  planExpiresAt: isoDateSchema.nullable(),
  note: nonemptyStringSchema.max(500),
  expected: adminUserSubscriptionSnapshot,
  expectedPlanCredits: nonnegativeIntegerSchema,
}).strict().superRefine((payload, context) => {
  if (payload.planId === null) {
    if (payload.billingCycle !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['billingCycle'], message: '免费版不能设置计费周期' });
    }
    if (payload.planResetAt !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['planResetAt'], message: '免费版不能设置积分重置日期' });
    }
    if (payload.planExpiresAt !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['planExpiresAt'], message: '免费版不能设置套餐到期日期' });
    }
    if (payload.expectedPlanCredits !== 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedPlanCredits'], message: '免费版标准积分必须为 0' });
    }
    return;
  }

  if (payload.billingCycle === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['billingCycle'], message: '付费套餐必须设置计费周期' });
  }
  if (payload.planResetAt === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['planResetAt'], message: '付费套餐必须设置积分重置日期' });
  }
  if (payload.planExpiresAt === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['planExpiresAt'], message: '付费套餐必须设置套餐到期日期' });
  }
  if (
    payload.planResetAt !== null
    && payload.planExpiresAt !== null
    && payload.planResetAt > payload.planExpiresAt
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['planExpiresAt'], message: '套餐到期日期不能早于积分重置日期' });
  }
});

const referralListQuery = z.object({
  ...adminPageQueryShape,
  search: adminSearchSchema,
  status: referralStatusSchema.optional(),
  from: isoDateSchema.optional(), to: isoDateSchema.optional(),
}).strict();
const publicEndpointContracts = {
  referralCheck: contract({ method: 'POST', path: '/api/public/referrals/check', successStatus: 200,
    body: z.object({ code: z.string().trim().min(1).max(128) }).strict(),
    response: z.object({ valid: z.boolean(), message: z.string() }) }),
  accountReferrals: contract({ method: 'GET', path: '/api/account/referrals', successStatus: 200, query: referralListQuery, response: referralPageSchema }),
  accountReferralSummary: contract({ method: 'GET', path: '/api/account/referrals/summary', successStatus: 200, response: referralSummarySchema }),
  adminReferralSettings: contract({ method: 'GET', path: '/api/admin/referral-settings', successStatus: 200, response: referralSettingsSchema }),
  adminReferralSettingsUpdate: contract({ method: 'PATCH', path: '/api/admin/referral-settings', successStatus: 200,
    body: referralSettingsSchema.extend({ reason: z.string().trim().min(1).max(500) }).strict(), response: referralSettingsSchema }),
  adminReferrals: contract({ method: 'GET', path: '/api/admin/referrals', successStatus: 200, query: referralListQuery, response: referralPageSchema }),
  adminReferralResolve: contract({ method: 'POST', path: '/api/admin/referrals/:id/resolve', successStatus: 200, params: uuidParamsSchema,
    body: z.object({ action: z.enum(['grant', 'close']), reason: z.string().trim().min(1).max(500) }).strict(), response: okResponseSchema }),
  health: contract({ method: 'GET', path: '/api/health', successStatus: 200, response: okResponseSchema }),
  ready: contract({ method: 'GET', path: '/api/ready', successStatus: 200, response: okResponseSchema }),

  publicPlans: contract({
    method: 'GET', path: '/api/subscription/plans', successStatus: 200,
    response: z.object({ items: z.array(publicPlanSchema) }),
  }),
  publicAnnouncements: contract({
    method: 'GET', path: '/api/announcements', successStatus: 200,
    response: z.object({ items: z.array(publicAnnouncementSchema) }),
  }),

  authRegisterCode: contract({
    method: 'POST', path: '/api/auth/register-code', successStatus: 200, body: registerCodeBody,
    response: z.object({ verificationId: uuidSchema, expiresAt: isoDateTimeSchema }),
  }),
  authRegister: contract({ method: 'POST', path: '/api/auth/register', successStatus: 200, body: registerBody, response: userResponse }),
  authLogin: contract({
    method: 'POST', path: '/api/auth/login', successStatus: 200,
    body: z.object({ email: emailSchema, password: z.string().min(1) }).strict(), response: userResponse,
  }),
  authForgotPassword: contract({
    method: 'POST', path: '/api/auth/forgot-password', successStatus: 200,
    body: z.object({ email: emailSchema }).strict(), response: okResponseSchema,
  }),
  authResetPassword: contract({
    method: 'POST', path: '/api/auth/reset-password', successStatus: 200,
    body: z.object({
      token: nonemptyStringSchema.min(32).max(512),
      password: z.string().min(8).max(32).regex(/[A-Za-z]/).regex(/[0-9]/).refine(value => !/\s/.test(value)),
    }).strict(), response: okResponseSchema,
  }),
  authLogout: contract({ method: 'POST', path: '/api/auth/logout', successStatus: 200, response: okResponseSchema }),
  authLogoutAll: contract({ method: 'POST', path: '/api/auth/logout-all', successStatus: 200, response: okResponseSchema }),
  authMe: contract({ method: 'GET', path: '/api/auth/me', successStatus: 200, response: userResponse }),

  accountFeatureFlags: contract({
    method: 'GET', path: '/api/account/feature-flags', successStatus: 200,
    response: z.object({ flags: featureFlagsSchema }),
  }),
  accountCredits: contract({
    method: 'GET', path: '/api/account/credits', successStatus: 200,
    response: z.object({
      mainCredits: nonnegativeIntegerSchema,
      addonCredits: nonnegativeIntegerSchema,
      credits: nonnegativeIntegerSchema,
      totalCredits: nonnegativeIntegerSchema,
      planResetAt: z.string().nullable(),
      planExpiresAt: z.string().nullable(),
    }),
  }),
  accountDashboard: contract({ method: 'GET', path: '/api/account/dashboard-summary', successStatus: 200, response: dashboardSummarySchema }),
  accountCreditLedger: contract({
    method: 'GET', path: '/api/account/credit-ledger', successStatus: 200,
    query: z.object({ ...userPageQueryShape, type: creditTypeSchema.optional() }).strict(),
    response: userCreditLedgerPageResponseSchema,
  }),
  accountProfileUpdate: contract({
    method: 'PATCH', path: '/api/account/profile', successStatus: 200,
    body: z.object({ userName: nonemptyStringSchema.min(2).max(30).optional() }).strict(), response: userResponse,
  }),
  accountPasswordUpdate: contract({
    method: 'PATCH', path: '/api/account/password', successStatus: 200,
    body: z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8).max(32).regex(/[A-Za-z]/).regex(/[0-9]/).refine(value => !/\s/.test(value)),
    }).strict().refine(value => value.currentPassword !== value.newPassword, { path: ['newPassword'] }), response: userResponse,
  }),

  generationConsumptionSettings: contract({
    method: 'GET', path: '/api/ai/consumption-settings', successStatus: 200,
    query: videoDuration25CompatibilityQuerySchema,
    response: generationConsumptionSettingsResponseSchema,
  }),
  tkPromptEngineSettings: contract({
    method: 'GET', path: '/api/ai/tk-prompt-engine/settings', successStatus: 200,
    response: z.object({ settings: tkPromptEngineSettingsSchema }),
  }),
  tkPromptRunCreate: contract({
    method: 'POST', path: '/api/ai/tk-prompt-engine/runs', successStatus: 202,
    body: z.object({
      idempotencyKey: idempotencyKeySchema,
      imageAssetIds: z.array(uuidSchema).min(1).max(9),
    }).strict().superRefine((payload, context) => {
      if (new Set(payload.imageAssetIds).size !== payload.imageAssetIds.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['imageAssetIds'],
          message: '参考图片不能重复',
        });
      }
    }),
    response: z.object({ run: tkPromptRunSchema }),
  }),
  tkPromptRun: contract({
    method: 'GET', path: '/api/ai/tk-prompt-engine/runs/:id', successStatus: 200,
    params: uuidParamsSchema,
    response: z.object({ run: tkPromptRunSchema }),
  }),
  tkPromptGenerationCreate: contract({
    method: 'POST', path: '/api/ai/tk-prompt-engine/runs/:id/generations', successStatus: 202,
    params: uuidParamsSchema,
    body: z.object({
      idempotencyKey: idempotencyKeySchema,
      expectedGenerationCredits: nonnegativeIntegerSchema,
      evidenceReview: tkPromptEvidenceReviewSchema,
      creativeInput: tkPromptCreativeInputSchema,
      videoConfig: tkPromptVideoConfigSchema,
    }).strict().superRefine((payload, context) => {
      const soundDesignOnly = payload.videoConfig.durationSeconds === 5;
      if (soundDesignOnly && payload.creativeInput.spokenLanguage !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['creativeInput', 'spokenLanguage'],
          message: '5 秒纯声音设计方案不能提交口播语言',
        });
      }
      if (soundDesignOnly && payload.creativeInput.verifiedOffer.trim() !== '') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['creativeInput', 'verifiedOffer'],
          message: '5 秒纯声音设计方案不能使用优惠信息',
        });
      }
      if (!soundDesignOnly && payload.creativeInput.spokenLanguage === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['creativeInput', 'spokenLanguage'],
          message: '10/15 秒方案必须提交口播语言',
        });
      }
    }),
    response: z.object({ generation: tkPromptGenerationSchema }),
  }),
  tkPromptGeneration: contract({
    method: 'GET', path: '/api/ai/tk-prompt-engine/generations/:id', successStatus: 200,
    params: uuidParamsSchema,
    response: z.object({ generation: tkPromptGenerationSchema }),
  }),
  tkPromptResume: contract({
    method: 'GET', path: '/api/ai/tk-prompt-engine/resume', successStatus: 200,
    response: z.object({
      run: tkPromptRunSchema.nullable(),
      generation: tkPromptGenerationSchema.nullable(),
    }),
  }),
  promptWizardRunCreate: contract({
    method: 'POST', path: '/api/ai/prompt-wizard/runs', successStatus: 202,
    body: z.object({
      imageAssetIds: z.array(uuidSchema).min(1).max(9),
      referenceMode: z.literal('general'),
    }).strict(),
    response: z.object({ run: promptWizardRunSchema }),
  }),
  promptWizardRun: contract({
    method: 'GET', path: '/api/ai/prompt-wizard/runs/:id', successStatus: 200,
    params: uuidParamsSchema,
    response: z.object({ run: promptWizardRunSchema }),
  }),
  promptWizardRunUpdate: contract({
    method: 'PATCH', path: '/api/ai/prompt-wizard/runs/:id', successStatus: 200,
    params: uuidParamsSchema,
    body: z.object({
      revision: nonnegativeIntegerSchema,
      productProfile: promptWizardProductProfileSchema,
    }).strict(),
    response: z.object({ run: promptWizardRunSchema }),
  }),
  promptWizardConceptSet: contract({
    method: 'GET', path: '/api/ai/prompt-wizard/concept-sets/:id', successStatus: 200,
    params: uuidParamsSchema,
    response: z.object({ conceptSet: promptWizardConceptSetSchema }),
  }),
  /** 滚动发布期只用于让旧客户端获得稳定 410；不再接受或创建新任务。 */
  promptWizardConceptSetCreateRetired: contract({
    method: 'POST', path: '/api/ai/prompt-wizard/runs/:id/concept-sets', successStatus: 200,
    response: z.object({}),
  }),
  promptWizardUseDirectionSet: contract({
    method: 'GET', path: '/api/ai/prompt-wizard/use-direction-sets/:id', successStatus: 200,
    params: uuidParamsSchema,
    response: z.object({ useDirectionSet: promptWizardUseDirectionSetSchema }),
  }),
  /** 滚动发布期只用于让旧客户端获得稳定 410；不再接受或创建新任务。 */
  promptWizardUseDirectionSetCreateRetired: contract({
    method: 'POST', path: '/api/ai/prompt-wizard/runs/:id/use-direction-sets', successStatus: 200,
    response: z.object({}),
  }),
  promptWizardBatchCreate: contract({
    method: 'POST', path: '/api/ai/prompt-wizard/runs/:id/batches', successStatus: 202,
    params: uuidParamsSchema,
    body: z.object({
      idempotencyKey: idempotencyKeySchema,
      revision: nonnegativeIntegerSchema,
      expectedGenerationCredits: nonnegativeIntegerSchema,
      voiceoverLanguage: z.string().trim().min(1).max(40).optional(),
      verifiedOffer: z.string().trim().max(300).optional(),
      videoConfig: promptWizardVideoConfigSchema,
    }).strict().superRefine((payload, context) => {
      const isSoundDesignOnly = payload.videoConfig.durationSeconds === 5;
      if (isSoundDesignOnly && payload.voiceoverLanguage !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['voiceoverLanguage'],
          message: '5 秒纯声音设计方案不能提交口播语言',
        });
      }
      if (!isSoundDesignOnly && payload.voiceoverLanguage === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['voiceoverLanguage'],
          message: '10/15 秒方案必须提交口播语言',
        });
      }
    }),
    response: z.object({ batch: promptWizardBatchSchema }),
  }),
  promptWizardBatch: contract({
    method: 'GET', path: '/api/ai/prompt-wizard/batches/:id', successStatus: 200,
    params: uuidParamsSchema,
    response: z.object({ batch: promptWizardBatchSchema }),
  }),
  promptWizardPlanRevision: contract({
    method: 'GET', path: '/api/ai/prompt-wizard/plan-revisions/:id', successStatus: 200,
    params: uuidParamsSchema,
    response: z.object({ revision: promptWizardPlanRevisionSchema }),
  }),
  /** 滚动发布期只用于让旧客户端获得稳定 410；单方案精修不再创建。 */
  promptWizardPlanRefinementCreateRetired: contract({
    method: 'POST',
    path: '/api/ai/prompt-wizard/batches/:batchId/plans/:planId/refinements',
    successStatus: 200,
    response: z.object({}),
  }),
  promptWizardResume: contract({
    method: 'GET', path: '/api/ai/prompt-wizard/resume', successStatus: 200,
    response: z.object({
      run: promptWizardRunSchema.nullable(),
      conceptSet: promptWizardConceptSetSchema.nullable().default(null),
      useDirectionSet: promptWizardUseDirectionSetSchema.nullable().default(null),
      batch: promptWizardBatchSchema.nullable(),
      planRevision: promptWizardPlanRevisionSchema.nullable().default(null),
      // 滚动发布期旧 API 可缺省；新 API 只暴露退役标记，不返回 2.0 正文。
      legacyTaskRetired: z.boolean().default(false),
    }),
  }),
  generationBatchCreate: contract({
    method: 'POST', path: '/api/ai/video-tasks/batch', successStatus: 200,
    body: z.object({
      idempotencyKey: idempotencyKeySchema,
      requests: z.array(z.object({
        model: nonemptyStringSchema,
        prompt: nonemptyStringSchema.max(4_000),
        config: videoGenerationRequestConfigSchema,
        references: z.array(generationReferenceInputSchema).max(50).default([]),
        realPortrait: z.object({
          actorId: uuidSchema,
          portraitAssetId: uuidSchema.optional(),
        }).strict().optional(),
        promptWizardSource: promptWizardSourceSchema.optional(),
        tkPromptSource: tkPromptSourceSchema.optional(),
      }).strict().superRefine((item, context) => {
        if (item.promptWizardSource !== undefined && item.tkPromptSource !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tkPromptSource'],
            message: '同一视频任务不能同时关联历史 Prompt Wizard 与 TK Prompt Engine 来源',
          });
        }
      })).min(1).max(4),
    }).strict(),
    response: z.object({ tasks: z.array(userGenerationTaskSchema) }),
  }),
  imageGenerationBatchCreate: contract({
    method: 'POST', path: '/api/ai/image-tasks/batch', successStatus: 200,
    body: z.object({
      idempotencyKey: idempotencyKeySchema,
      requests: z.array(z.object({
        model: z.literal('Seedream 5.0 Pro'),
        prompt: nonemptyStringSchema.max(4_000),
        config: imageGenerationRequestConfigSchema,
        references: z.array(seedreamImageReferenceInputSchema).max(10).default([]),
        annotations: z.array(seedreamAnnotationSchema).max(50).default([]),
      }).strict()).min(1).max(4),
    }).strict(),
    response: z.object({ tasks: z.array(userGenerationTaskSchema) }),
  }),
  realPortraitActors: contract({
    method: 'GET', path: '/api/real-portrait-actors', successStatus: 200,
    response: realPortraitActorListSchema.strip(),
  }),
  realPortraitActorCreate: contract({
    method: 'POST', path: '/api/real-portrait-actors', successStatus: 200,
    body: z.object({ alias: nonemptyStringSchema.max(120) }).strict(),
    response: z.object({ actor: realPortraitActorSchema }),
  }),
  realPortraitActor: contract({
    method: 'GET', path: '/api/real-portrait-actors/:actorId', successStatus: 200,
    params: realPortraitActorParamsSchema,
    response: z.object({ actor: realPortraitActorSchema }),
  }),
  realPortraitActorDelete: contract({
    method: 'DELETE', path: '/api/real-portrait-actors/:actorId', successStatus: 200,
    params: realPortraitActorParamsSchema,
    response: z.object({ deleted: z.literal(true) }),
  }),
  realPortraitActivationCreate: contract({
    method: 'POST', path: '/api/real-portrait-actors/:actorId/activation-requests', successStatus: 200,
    params: realPortraitActorParamsSchema,
    body: z.object({
      purpose: nonemptyStringSchema.max(500),
      commercialUse: z.literal(true),
      portraitNoticeVersion: nonemptyStringSchema.max(80),
      sensitiveInfoNoticeVersion: nonemptyStringSchema.max(80),
    }).strict(),
    response: z.object({ activation: realPortraitActivationSchema }),
  }),
  realPortraitUploadCreate: contract({
    method: 'POST', path: '/api/real-portrait-actors/:actorId/uploads', successStatus: 200,
    params: realPortraitActorParamsSchema,
    body: z.object({
      kind: realPortraitAssetKindSchema,
      mimeType: realPortraitMimeTypeSchema,
      sizeBytes: nonnegativeIntegerSchema.positive().max(30 * 1024 * 1024 - 1),
    }).strict(),
    response: z.object({
      upload: z.object({
        id: uuidSchema,
        kind: realPortraitAssetKindSchema,
        status: z.literal('waiting_upload'),
        expiresAt: isoDateTimeSchema,
        signature: realPortraitUploadSignatureSchema,
      }).strict(),
    }),
  }),
  realPortraitUploadComplete: contract({
    method: 'POST', path: '/api/real-portrait-uploads/:uploadId/complete', successStatus: 200,
    params: realPortraitUploadParamsSchema,
    body: z.object({
      mimeType: realPortraitMimeTypeSchema,
      sizeBytes: nonnegativeIntegerSchema.positive().max(30 * 1024 * 1024 - 1),
      width: nonnegativeIntegerSchema.min(300).max(6000).optional(),
      height: nonnegativeIntegerSchema.min(300).max(6000).optional(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict().refine(value => (value.width === undefined) === (value.height === undefined), {
      message: '真人图片宽高必须同时提供或同时省略',
    }).refine(value => value.width === undefined || value.height === undefined
      || (value.width / value.height > 0.4 && value.width / value.height < 2.5), {
      message: '真人图片宽高比必须在 0.4 到 2.5 之间',
    }),
    response: z.object({ asset: realPortraitAssetSchema }),
  }),
  realPortraitAssetThumbnail: contract({
    method: 'GET', path: '/api/real-portrait-actors/:actorId/assets/:portraitAssetId/thumbnail', successStatus: 200,
    params: realPortraitAssetParamsSchema,
    response: z.instanceof(Uint8Array),
  }),
  realPortraitAssetDelete: contract({
    method: 'DELETE', path: '/api/real-portrait-actors/:actorId/assets/:portraitAssetId', successStatus: 200,
    params: realPortraitAssetParamsSchema,
    response: z.object({ deleted: z.literal(true) }),
  }),
  realPortraitActorRevoke: contract({
    method: 'POST', path: '/api/real-portrait-actors/:actorId/revoke', successStatus: 200,
    params: realPortraitActorParamsSchema,
    body: z.object({ reasonCode: z.string().trim().min(1).max(80).optional() }).strict(),
    response: z.object({ actor: realPortraitActorSchema }),
  }),
  realPortraitCapacity: contract({
    method: 'GET', path: '/api/real-portrait-capacity', successStatus: 200,
    response: z.object({ capacity: realPortraitCapacitySchema }),
  }),
  accountRealPortraitQuotaSelection: contract({
    method: 'POST', path: '/api/account/real-portrait-quota-selection', successStatus: 200,
    body: z.object({
      retainedActorIds: z.array(uuidSchema),
      activeActorIds: z.array(uuidSchema),
    }).strict(),
    response: z.object({ capacity: realPortraitCapacitySchema }),
  }),
  publicRealPortraitInvite: contract({
    method: 'GET', path: '/api/public/real-portrait-invites/:token', successStatus: 200,
    params: realPortraitInviteParamsSchema,
    response: z.object({ invite: publicRealPortraitInviteSchema }),
  }),
  publicRealPortraitInviteRespond: contract({
    method: 'POST', path: '/api/public/real-portrait-invites/:token', successStatus: 200,
    params: realPortraitInviteParamsSchema,
    body: z.discriminatedUnion('accepted', [
      z.object({ accepted: z.literal(false) }).strict(),
      z.object({
        accepted: z.literal(true),
        adultConfirmed: z.literal(true),
        portraitConsent: z.literal(true),
        sensitiveFaceConsent: z.literal(true),
        commercialUseConsent: z.literal(true),
        authorizationDays: z.literal(90),
      }).strict(),
    ]),
    response: z.object({
      status: z.enum(['accepted', 'declined']),
      manageUrl: httpUrlSchema.nullable(),
    }),
  }),
  publicRealPortraitVerificationStart: contract({
    method: 'POST', path: '/api/public/real-portrait-invites/:token/start-verification', successStatus: 200,
    params: realPortraitInviteParamsSchema,
    response: z.object({
      verification: z.object({
        status: z.enum(['verification-ready', 'waiting-capacity']),
        verificationUrl: httpUrlSchema.nullable(),
        expiresAt: nullableIsoDateTimeSchema,
        queuePosition: nonnegativeIntegerSchema.positive().nullable(),
      }).strict(),
    }),
  }),
  publicRealPortraitInviteStatus: contract({
    method: 'GET', path: '/api/public/real-portrait-invites/:token/status', successStatus: 200,
    params: realPortraitInviteParamsSchema,
    response: z.object({
      status: z.enum(['waiting', 'invited', 'verifying', 'verified', 'awaiting_upload', 'active', 'failed', 'expired']),
      authorizationExpiresAt: nullableIsoDateTimeSchema,
    }),
  }),
  publicRealPortraitAuthorization: contract({
    method: 'GET', path: '/api/public/real-portrait-authorizations/:manageToken', successStatus: 200,
    params: realPortraitAuthorizationParamsSchema,
    response: z.object({ authorization: publicRealPortraitAuthorizationSchema }),
  }),
  publicRealPortraitAuthorizationRevoke: contract({
    method: 'POST', path: '/api/public/real-portrait-authorizations/:manageToken/revoke', successStatus: 200,
    params: realPortraitAuthorizationParamsSchema,
    body: z.object({ reasonCode: z.string().trim().min(1).max(80).optional() }).strict(),
    response: z.object({ authorization: publicRealPortraitAuthorizationSchema }),
  }),
  volcRealPortraitValidationCallback: contract({
    method: 'POST', path: '/api/providers/volc/real-portrait-validation/:opaqueNonce', successStatus: 200,
    params: realPortraitCallbackParamsSchema,
    body: volcRealPortraitValidationCallbackPayloadSchema.strict(),
    response: z.object({ accepted: z.boolean(), status: z.string() }),
  }),
  generationTasks: contract({
    method: 'GET', path: '/api/ai/tasks', successStatus: 200,
    query: z.object({
      ...userPageQueryShape,
      status: generationStatusSchema.optional(),
      kind: generationKindSchema.optional(),
    }).strict(),
    response: createExactCursorPageSchema(userGenerationTaskCardSchema),
  }),
  generationTask: contract({ method: 'GET', path: '/api/ai/tasks/:id', successStatus: 200, params: uuidParamsSchema, response: taskResponse }),
  assetCards: contract({
    method: 'GET', path: '/api/assets/cards', successStatus: 200,
    query: z.object({
      position: assetCardPositionSchema.default('first'),
      cursor: cursorSchema.optional(),
      snapshotCursor: cursorSchema.optional(),
      limit: z.coerce.number().int().min(1).max(50).default(24),
      source: assetSourceSchema.optional(),
      type: assetTypeSchema.optional(),
      folderId: uuidSchema.optional(),
      search: z.string().trim().min(1).max(100).optional(),
      sort: assetCardSortSchema.default('created-desc'),
    }).strict(),
    response: z.object({ items: z.array(assetCardSchema), pagination: assetCardPaginationSchema }),
  }),
  assetSummary: contract({
    method: 'GET', path: '/api/assets/summary', successStatus: 200,
    response: z.object({ summary: assetSummarySchema }),
  }),
  assetDetail: contract({
    method: 'GET', path: '/api/assets/:id', successStatus: 200, params: uuidParamsSchema,
    response: z.object({ asset: assetDetailSchema }),
  }),
  assetFolders: contract({
    method: 'GET', path: '/api/assets/folders', successStatus: 200,
    query: z.object({ source: assetSourceSchema.optional() }).strict(), response: z.object({ items: z.array(assetFolderSchema) }),
  }),
  assetFolderCreate: contract({
    method: 'POST', path: '/api/assets/folders', successStatus: 200,
    body: z.object({ name: nonemptyStringSchema.max(80), source: assetSourceSchema }).strict(),
    response: z.object({ folder: assetFolderSchema }),
  }),
  assetFolderRename: contract({
    method: 'PATCH', path: '/api/assets/folders/:id', successStatus: 200, params: uuidParamsSchema,
    body: z.object({ name: nonemptyStringSchema.max(80) }).strict(), response: z.object({ folder: assetFolderSchema }),
  }),
  assetFolderDelete: contract({
    method: 'DELETE', path: '/api/assets/folders/:id', successStatus: 200,
    params: uuidParamsSchema,
    query: z.object({ contentAction: assetFolderContentActionSchema.optional() }).strict(),
    response: assetFolderDeleteResultSchema,
  }),
  assetUploadSignature: contract({
    method: 'POST', path: '/api/assets/upload-signature', successStatus: 200,
    body: z.object({
      filename: nonemptyStringSchema.max(255),
      contentType: nonemptyStringSchema.max(120),
      sizeBytes: nonnegativeIntegerSchema.positive().max(MAX_UPLOAD_SIZE_BYTES),
      source: z.enum(['uploaded-video', 'uploaded-image', 'uploaded-audio']),
      folderId: uuidSchema.nullable().optional(),
      idempotencyKey: idempotencyKeySchema,
    }).strict(),
    response: z.object({
      signature: uploadSignatureResponseSchema.nullable(),
      session: uploadSessionSchema,
    }),
  }),
  assetUploadComplete: contract({
    method: 'POST', path: '/api/assets/complete-upload', successStatus: 200,
    body: z.object({
      uploadSessionId: uuidSchema,
    }).strict(),
    response: z.object({ session: uploadSessionSchema }),
  }),
  assetUploadSession: contract({
    method: 'GET', path: '/api/assets/upload-sessions/:id', successStatus: 200,
    params: uuidParamsSchema,
    response: z.object({ session: uploadSessionSchema }),
  }),
  assetUploadSessionCancel: contract({
    method: 'POST', path: '/api/assets/upload-sessions/:id/cancel', successStatus: 200,
    params: uuidParamsSchema,
    response: z.object({ session: uploadSessionSchema }),
  }),
  assetUploadSessionRetry: contract({
    method: 'POST', path: '/api/assets/upload-sessions/:id/retry', successStatus: 200,
    params: uuidParamsSchema,
    response: z.object({ session: uploadSessionSchema }),
  }),
  assetUpdate: contract({
    method: 'PATCH', path: '/api/assets/:id', successStatus: 200, params: uuidParamsSchema,
    body: z.object({ name: nonemptyStringSchema.max(255).optional(), folderId: uuidSchema.nullable().optional() }).strict(),
    response: z.object({ asset: assetCardSchema }),
  }),
  assetDownloadRequest: contract({
    method: 'POST', path: '/api/assets/:id/download', successStatus: 200, params: uuidParamsSchema,
    response: z.object({ download: z.object({ url: httpUrlSchema, filename: nonemptyStringSchema, downloadRequestedAt: isoDateTimeSchema }) }),
  }),
  assetDelete: contract({ method: 'DELETE', path: '/api/assets/:id', successStatus: 200, params: uuidParamsSchema, response: okResponseSchema }),
  assetsBulkMove: contract({
    method: 'POST', path: '/api/assets/bulk-move', successStatus: 200,
    body: z.object({ assetIds: z.array(uuidSchema).min(1), folderId: uuidSchema.nullable() }).strict(),
    response: z.object({ items: z.array(assetCardSchema) }),
  }),
  assetsBulkDelete: contract({
    method: 'POST', path: '/api/assets/bulk-delete', successStatus: 200,
    body: z.object({ assetIds: z.array(uuidSchema).min(1) }).strict(), response: okResponseSchema,
  }),

  orders: contract({
    method: 'GET', path: '/api/orders', successStatus: 200,
    query: z.object({
      ...userPageQueryShape,
      status: orderStatusSchema.optional(),
      invoiceable: z.literal('1').optional(),
    }).strict(),
    response: createExactCursorPageSchema(orderSchema),
  }),
  paymentCreate: contract({
    method: 'POST', path: '/api/payments/create', successStatus: 200,
    body: z.object({
      planId: uuidSchema, billing: z.enum(['monthly', 'yearly', 'one-time']),
      surface: z.enum(['pc', 'mobile']).default('pc'), idempotencyKey: idempotencyKeySchema.optional(),
    }).strict(),
    response: z.object({
      order: orderSchema,
      paymentAttempt: paymentAttemptSchema,
      /** 一版兼容字段；等旧前端停用后再删除。 */
      payment: paymentLaunchSchema.nullable(),
      reused: z.boolean().optional(),
    }),
  }),
  paymentRetry: contract({
    method: 'POST', path: '/api/payments/orders/:id/retry', successStatus: 200,
    params: uuidParamsSchema,
    body: z.object({ idempotencyKey: idempotencyKeySchema }).strict(),
    response: z.object({ order: orderSchema, paymentAttempt: paymentAttemptSchema }),
  }),
  paymentSync: contract({ method: 'POST', path: '/api/payments/orders/:id/sync', successStatus: 200, params: uuidParamsSchema, response: orderResponse }),
  paymentCancel: contract({ method: 'POST', path: '/api/payments/orders/:id/cancel', successStatus: 200, params: uuidParamsSchema, response: orderResponse }),

  supportSummary: contract({
    method: 'GET', path: '/api/support/summary', successStatus: 200,
    response: z.object({
      unreadTickets: nonnegativeIntegerSchema,
      openTickets: nonnegativeIntegerSchema,
      asOf: isoDateTimeSchema,
    }),
  }),
  supportTickets: contract({
    method: 'GET', path: '/api/support/tickets', successStatus: 200,
    query: z.object({
      ...userPageQueryShape,
      status: ticketStatusSchema.optional(),
      priority: ticketPrioritySchema.optional(),
      search: z.string().trim().min(1).max(120).optional(),
    }).strict(),
    response: createExactCursorPageSchema(userTicketSchema),
  }),
  supportTicketCreate: contract({
    method: 'POST', path: '/api/support/tickets', successStatus: 200,
    body: z.object({ title: nonemptyStringSchema.max(120), message: nonemptyStringSchema.max(2_000), priority: ticketPrioritySchema.default('medium') }).strict(),
    response: ticketResponse,
  }),
  supportTicketMessages: contract({
    method: 'GET', path: '/api/support/tickets/:id/messages', successStatus: 200, params: uuidParamsSchema,
    response: z.object({ items: z.array(userTicketMessageSchema) }),
  }),
  supportTicketMessageCreate: contract({
    method: 'POST', path: '/api/support/tickets/:id/messages', successStatus: 200, params: uuidParamsSchema, body: ticketMessageBody,
    response: z.object({ message: userTicketMessageSchema, ticket: userTicketSchema }),
  }),
  supportTicketRead: contract({ method: 'POST', path: '/api/support/tickets/:id/read', successStatus: 200, params: uuidParamsSchema, response: ticketResponse }),
  invoiceCreate: contract({
    method: 'POST', path: '/api/invoices', successStatus: 200,
    body: z.object({
      orderId: uuidSchema, invoiceTitle: nonemptyStringSchema.max(120), taxId: nonemptyStringSchema.max(80),
      receiveEmail: emailSchema, note: z.string().trim().max(500).default(''),
    }).strict(), response: z.object({ invoice: invoiceSchema }),
  }),
} as const satisfies Record<string, EndpointContract>;

const adminEndpointContracts = {
  adminOverview: contract({
    method: 'GET', path: '/api/admin/overview', successStatus: 200,
    response: z.object({ summary: adminOverviewSchema, apiCostHealth: adminApiCostHealthSchema }),
  }),
  adminNavigationSummary: contract({
    method: 'GET', path: '/api/admin/navigation-summary', successStatus: 200,
    response: z.object({
      openTickets: nonnegativeIntegerSchema,
      pendingInvoices: nonnegativeIntegerSchema,
      activeJobs: nonnegativeIntegerSchema,
      manualReviewPayments: nonnegativeIntegerSchema,
      manualReviewRefunds: nonnegativeIntegerSchema,
      asOf: isoDateTimeSchema,
    }),
  }),
  adminPaymentChannel: contract({ method: 'GET', path: '/api/admin/payment-channel', successStatus: 200, response: z.object({ channel: adminPaymentChannelSchema }) }),
  adminPaymentChannelSave: contract({ method: 'PUT', path: '/api/admin/payment-channel', successStatus: 200, body: paymentChannelBody, response: z.object({ channel: adminPaymentChannelSchema }) }),
  adminPlans: contract({ method: 'GET', path: '/api/admin/plans', successStatus: 200, response: z.object({ items: z.array(adminPlanSchema) }) }),
  adminRealPortraitCapacity: contract({
    method: 'GET', path: '/api/admin/real-portrait-capacity', successStatus: 200,
    response: adminRealPortraitCapacitySchema.strip(),
  }),
  adminPlanCreate: contract({ method: 'POST', path: '/api/admin/plans', successStatus: 200, body: planCreateBody, response: z.object({ plan: adminPlanSchema }) }),
  adminPlanUpdate: contract({ method: 'PATCH', path: '/api/admin/plans/:id', successStatus: 200, params: uuidParamsSchema, body: planPatchBody, response: z.object({ plan: adminPlanSchema }) }),
  adminUsers: contract({ method: 'GET', path: '/api/admin/users', successStatus: 200, query: adminUsersQuery, response: createExactCursorPageSchema(adminUserSchema) }),
  adminUserStatus: contract({
    method: 'PATCH', path: '/api/admin/users/:id/status', successStatus: 200, params: uuidParamsSchema,
    body: z.object({ status: userStatusSchema }).strict(), response: z.object({ user: adminUserSchema }),
  }),
  adminUserSubscription: contract({
    method: 'PATCH', path: '/api/admin/users/:id/subscription', successStatus: 200, params: uuidParamsSchema,
    body: adminUserSubscriptionBody,
    response: z.object({ user: adminUserSchema, entry: adminCreditLedgerSchema.nullable() }),
  }),
  adminCreditsAdjust: contract({
    method: 'POST', path: '/api/admin/credits/adjust', successStatus: 200,
    body: adminCreditAdjustBody,
    response: z.object({ entry: adminCreditLedgerSchema.nullable(), entries: z.array(adminCreditLedgerSchema), user: adminUserSchema }),
  }),
  adminOrders: contract({ method: 'GET', path: '/api/admin/orders', successStatus: 200, query: adminOrdersQuery, response: createExactCursorPageSchema(orderSchema) }),
  adminOrdersSummary: contract({
    method: 'GET', path: '/api/admin/orders/summary', successStatus: 200,
    query: z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() }).strict(),
    response: z.object({
      totalCount: nonnegativeIntegerSchema,
      totalAmount: nonnegativeIntegerSchema,
      paidCount: nonnegativeIntegerSchema,
      paidAmount: nonnegativeIntegerSchema,
      pendingCount: nonnegativeIntegerSchema,
      refundedCount: nonnegativeIntegerSchema,
      refundedAmount: nonnegativeIntegerSchema,
      failedCount: nonnegativeIntegerSchema,
      failedAmount: nonnegativeIntegerSchema,
    }),
  }),
  adminOrderDetail: contract({
    method: 'GET', path: '/api/admin/orders/:id', successStatus: 200, params: uuidParamsSchema,
    response: z.object({
      order: orderSchema,
      invoice: invoiceSchema.nullable(),
      creditLedger: z.array(adminCreditLedgerSchema),
    }),
  }),
  adminOrderRefund: contract({ method: 'POST', path: '/api/admin/orders/:id/refund', successStatus: 200, params: uuidParamsSchema, response: orderResponse }),
  adminOrderRefundSync: contract({ method: 'POST', path: '/api/admin/orders/:id/refund/sync', successStatus: 200, params: uuidParamsSchema, response: orderResponse }),
  adminInvoices: contract({ method: 'GET', path: '/api/admin/invoices', successStatus: 200, query: adminInvoicesQuery, response: createExactCursorPageSchema(invoiceSchema) }),
  adminTickets: contract({ method: 'GET', path: '/api/admin/tickets', successStatus: 200, query: adminTicketsQuery, response: createExactCursorPageSchema(adminTicketSchema) }),
  adminTicketMessages: contract({
    method: 'GET', path: '/api/admin/tickets/:id/messages', successStatus: 200, params: uuidParamsSchema,
    response: z.object({ items: z.array(adminTicketMessageSchema) }),
  }),
  adminTicketMessageCreate: contract({
    method: 'POST', path: '/api/admin/tickets/:id/messages', successStatus: 200, params: uuidParamsSchema, body: ticketMessageBody,
    response: z.object({ message: adminTicketMessageSchema, ticket: adminTicketSchema }),
  }),
  adminTicketRead: contract({ method: 'POST', path: '/api/admin/tickets/:id/read', successStatus: 200, params: uuidParamsSchema, response: adminTicketResponse }),
  adminTicketStatus: contract({
    method: 'PATCH', path: '/api/admin/tickets/:id/status', successStatus: 200, params: uuidParamsSchema,
    body: z.object({ status: ticketStatusSchema }).strict(), response: adminTicketResponse,
  }),
  adminInvoiceStatus: contract({
    method: 'PATCH', path: '/api/admin/invoices/:id/status', successStatus: 200, params: uuidParamsSchema,
    body: z.object({ status: invoiceStatusSchema }).strict(), response: z.object({ invoice: invoiceSchema }),
  }),
  adminAsset: contract({ method: 'GET', path: '/api/admin/assets/:id', successStatus: 200, params: uuidParamsSchema, response: z.object({ asset: assetDetailSchema }) }),
  adminAssetDownload: contract({
    method: 'POST', path: '/api/admin/assets/:id/download', successStatus: 200, params: uuidParamsSchema,
    response: z.object({ download: z.object({ url: httpUrlSchema, filename: nonemptyStringSchema }) }),
  }),
  adminJobs: contract({ method: 'GET', path: '/api/admin/jobs', successStatus: 200, query: adminJobsQuery, response: createExactCursorPageSchema(adminGenerationTaskCardSchema) }),
  adminJobDetail: contract({ method: 'GET', path: '/api/admin/jobs/:id', successStatus: 200, params: uuidParamsSchema, response: adminTaskResponse }),
  adminJobRetry: contract({ method: 'POST', path: '/api/admin/jobs/:id/retry', successStatus: 200, params: uuidParamsSchema, response: adminTaskResponse }),
  adminJobRefund: contract({ method: 'POST', path: '/api/admin/jobs/:id/refund', successStatus: 200, params: uuidParamsSchema, response: adminTaskResponse }),
  adminCreditLedger: contract({ method: 'GET', path: '/api/admin/credit-ledger', successStatus: 200, query: adminCreditLedgerQuery, response: adminCreditLedgerPageResponseSchema }),
  adminAuditLogs: contract({ method: 'GET', path: '/api/admin/audit-logs', successStatus: 200, query: adminAuditLogsQuery, response: createExactCursorPageSchema(adminAuditLogSchema) }),
  adminFeatureFlags: contract({ method: 'GET', path: '/api/admin/feature-flags', successStatus: 200, response: z.object({ flags: featureFlagsSchema }) }),
  adminFeatureFlagsUpdate: contract({ method: 'PATCH', path: '/api/admin/feature-flags', successStatus: 200, body: featureFlagsSchema.partial().strict(), response: z.object({ flags: featureFlagsSchema }) }),
  adminApiUsage: contract({
    method: 'GET', path: '/api/admin/api-usage', successStatus: 200,
    query: adminApiCostDashboardQuery,
    response: z.object({
      asOf: isoDateTimeSchema,
      selection: adminApiCostSelectionSchema,
      coverage: adminApiCostCoverageSchema,
      currentState: adminApiCostCurrentStateSchema,
      combinedStatus: adminApiCostCombinedStatusSchema,
      books: z.object({
        usage: adminApiCostUsageBookSchema,
        valuation: adminApiCostValuationBookSchema,
        settlement: adminApiCostSettlementBookSchema,
      }),
      account: adminApiAccountBalanceSchema,
      sync: z.object({
        status: z.enum(['normal', 'warning', 'error']),
        stale: z.boolean(),
        lastSyncedAt: z.union([isoDateTimeSchema, z.literal('-')]),
        items: z.array(adminApiCostSyncItemSchema),
      }),
      summary: adminApiCostSummarySchema,
      operations: adminApiCostOperationsSchema,
      models: z.array(adminApiCostModelSchema),
      daily: z.array(adminApiCostDailySchema),
      pricingRules: z.array(adminApiPricingRuleSchema),
      packages: z.array(adminApiPackageSchema),
    }),
  }),
  adminApiUsageOverview: contract({
    method: 'GET', path: '/api/admin/api-usage/overview', successStatus: 200,
    query: adminApiCostDashboardQuery,
    response: z.object({
      asOf: isoDateTimeSchema,
      selection: adminApiCostSelectionSchema,
      account: adminApiAccountBalanceSchema,
      sync: z.object({
        status: z.enum(['normal', 'warning', 'error']),
        stale: z.boolean(),
        lastSyncedAt: z.union([isoDateTimeSchema, z.literal('-')]),
        items: z.array(adminApiCostSyncItemSchema),
      }),
      operations: adminApiCostOverviewOperationsSchema,
      models: z.array(adminApiCostOperationsModelSchema),
    }),
  }),
  adminApiUsageTasks: contract({
    method: 'GET', path: '/api/admin/api-usage/tasks', successStatus: 200,
    query: adminApiCostPagedQueryBase.extend(adminApiCostTaskQueryShape).strict().superRefine(validateApiCostRange),
    response: createExactCursorPageSchema(adminApiCostTaskSchema).extend({
      asOf: isoDateTimeSchema,
      selection: adminApiCostSelectionSchema,
    }),
  }),
  adminApiUsageAttempts: contract({
    method: 'GET', path: '/api/admin/api-usage/attempts', successStatus: 200,
    query: adminApiCostPagedQueryBase.extend(adminApiCostAttributionQueryShape).strict().superRefine(validateApiCostRange),
    response: createExactCursorPageSchema(adminApiCostAttemptSchema).extend({
      asOf: isoDateTimeSchema,
      selection: adminApiCostSelectionSchema,
    }),
  }),
  adminApiUsageUsers: contract({
    method: 'GET', path: '/api/admin/api-usage/users', successStatus: 200,
    query: adminApiCostPagedQueryBase.extend(adminApiCostBusinessQueryShape).strict().superRefine(validateApiCostRange),
    response: createExactCursorPageSchema(adminApiCostUserSchema).extend({
      asOf: isoDateTimeSchema,
      selection: adminApiCostSelectionSchema,
    }),
  }),
  adminApiUsageImageOverview: contract({
    method: 'GET', path: '/api/admin/api-usage/image/overview', successStatus: 200,
    query: adminImageCostOverviewQuery,
    response: z.object({
      asOf: isoDateTimeSchema,
      selection: adminApiCostSelectionSchema,
      summary: adminImageCostSummarySchema,
      pricing: adminImageCostPricingSchema,
    }),
  }),
  adminApiUsageImageUsers: contract({
    method: 'GET', path: '/api/admin/api-usage/image/users', successStatus: 200,
    query: adminImageCostUsersQuery,
    response: createExactCursorPageSchema(adminImageCostUserSchema).extend({
      asOf: isoDateTimeSchema,
      selection: adminApiCostSelectionSchema,
    }),
  }),
  adminApiUsageImageTasks: contract({
    method: 'GET', path: '/api/admin/api-usage/image/tasks', successStatus: 200,
    query: adminImageCostTasksQuery,
    response: createExactCursorPageSchema(adminImageCostTaskSchema).extend({
      asOf: isoDateTimeSchema,
      selection: adminApiCostSelectionSchema,
    }),
  }),
  adminApiUsageMultimodalOverview: contract({
    method: 'GET', path: '/api/admin/api-usage/multimodal/overview', successStatus: 200,
    query: adminApiCostDashboardQuery,
    response: z.object({
      asOf: isoDateTimeSchema,
      selection: adminApiCostSelectionSchema,
      account: adminApiAccountBalanceSchema,
      summary: adminMultimodalCostSummarySchema,
      models: z.array(adminMultimodalCostModelSchema),
    }),
  }),
  adminApiUsageMultimodalUsers: contract({
    method: 'GET', path: '/api/admin/api-usage/multimodal/users', successStatus: 200,
    query: adminMultimodalCostUsersQuery,
    response: createExactCursorPageSchema(adminMultimodalCostUserSchema).extend({
      asOf: isoDateTimeSchema,
      selection: adminApiCostSelectionSchema,
    }),
  }),
  adminApiUsageMultimodalOperations: contract({
    method: 'GET', path: '/api/admin/api-usage/multimodal/operations', successStatus: 200,
    query: adminMultimodalCostOperationsQuery,
    response: createExactCursorPageSchema(adminMultimodalCostOperationSchema).extend({
      asOf: isoDateTimeSchema,
      selection: adminApiCostSelectionSchema,
    }),
  }),
  adminApiUsageReconciliation: contract({
    method: 'GET', path: '/api/admin/api-usage/reconciliation', successStatus: 200,
    query: adminApiCostPagedQueryBase.extend({
      pricingResolution: apiCostPricingResolutionSchema.optional(),
      inputClass: apiCostInputClassSchema.optional(),
      unitPriceCnyPerMillion: nonnegativeCnyAmountSchema.optional(),
      billLineType: apiCostBillLineTypeSchema.optional(),
      matchState: apiCostMatchStateSchema.optional(),
      attributionConfidence: apiCostAttributionConfidenceSchema.optional(),
    }).strict().superRefine(validateApiCostRange),
    response: createExactCursorPageSchema(adminApiCostReconciliationBucketSchema).extend({
      asOf: isoDateTimeSchema,
      selection: adminApiCostSelectionSchema,
    }),
  }),
  adminApiUsageReconciliationDetail: contract({
    method: 'GET', path: '/api/admin/api-usage/reconciliation/:id', successStatus: 200,
    params: uuidParamsSchema,
    query: z.object({ asOf: isoDateTimeSchema.optional() }).strict(),
    response: z.object({
      bucket: adminApiCostReconciliationBucketSchema,
      evidence: z.array(adminApiCostReconciliationEvidenceSchema),
    }),
  }),
  adminApiUsageSettlement: contract({
    method: 'GET', path: '/api/admin/api-usage/settlement', successStatus: 200,
    query: adminApiCostPagedQueryBase.extend({
      billLineType: apiCostBillLineTypeSchema.optional(),
      paymentStatus: apiCostPaymentStatusSchema.optional(),
    }).strict().superRefine(validateApiCostRange),
    response: createExactCursorPageSchema(adminApiCostSettlementItemSchema).extend({
      asOf: isoDateTimeSchema,
      selection: adminApiCostSelectionSchema,
      summary: adminApiCostSettlementBookSchema,
    }),
  }),
  adminProviderBillingSync: contract({
    method: 'POST', path: '/api/admin/provider-billing/sync', successStatus: 202,
    body: z.object({
      scope: z.enum(['all', 'balance', 'bill', 'packages']).default('all'),
      windowStart: isoDateSchema.optional(),
      windowEnd: isoDateSchema.optional(),
    }).strict().superRefine((value, context) => {
      if (Boolean(value.windowStart) !== Boolean(value.windowEnd)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'windowStart 与 windowEnd 必须同时提供' });
      }
      if (value.windowStart && value.windowEnd) {
        if (value.scope !== 'all' && value.scope !== 'bill') {
          context.addIssue({ code: z.ZodIssueCode.custom, message: '只有 all 或 bill 同步支持日期范围', path: ['scope'] });
        }
        if (value.windowStart > value.windowEnd) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'windowStart 不能晚于 windowEnd', path: ['windowStart'] });
        }
        const days = Math.floor((Date.parse(`${value.windowEnd}T00:00:00Z`) - Date.parse(`${value.windowStart}T00:00:00Z`)) / 86_400_000) + 1;
        if (days > 93) context.addIssue({ code: z.ZodIssueCode.custom, message: '单次账单同步最多 93 天', path: ['windowEnd'] });
      }
    }),
    response: z.object({
      accepted: z.literal(true),
      scope: z.enum(['all', 'balance', 'bill', 'packages']),
      windowStart: isoDateSchema.optional(),
      windowEnd: isoDateSchema.optional(),
    }),
  }),
  adminConsumptionSettingUpdate: contract({
    method: 'PATCH', path: '/api/admin/consumption-settings/:id', successStatus: 200, params: uuidParamsSchema,
    body: z.object({
      credits: nonnegativeIntegerSchema.optional(),
      referenceVideoCredits: nonnegativeIntegerSchema.optional(),
      available: z.boolean().optional(),
    }).strict(),
    response: z.object({ setting: consumptionSettingSchema }),
  }),
  adminVideoConsumptionAvailabilityUpdate: contract({
    method: 'PATCH',
    path: '/api/admin/consumption-settings/video-models/:model/availability',
    successStatus: 200,
    params: z.object({ model: seedanceVideoModelLabelSchema }).strict(),
    query: videoDuration25CompatibilityQuerySchema,
    body: z.object({ available: z.boolean() }).strict(),
    response: consumptionSettingsListResponseSchema,
  }),
  adminPromptWizardSettingsUpdate: contract({
    method: 'PATCH', path: '/api/admin/prompt-wizard-settings', successStatus: 200,
    body: z.object({
      generationCredits: nonnegativeIntegerSchema.optional(),
      available: z.boolean().optional(),
    }).strict().refine(
      value => value.generationCredits !== undefined
        || value.available !== undefined,
      { message: '至少提供一项设置' },
    ),
    response: z.object({ promptWizard: promptWizardSettingsSchema }),
  }),
  adminTkPromptEngineSettingsUpdate: contract({
    method: 'PATCH', path: '/api/admin/tk-prompt-engine-settings', successStatus: 200,
    body: z.object({
      generationCredits: nonnegativeIntegerSchema.optional(),
      available: z.boolean().optional(),
    }).strict().refine(
      value => value.generationCredits !== undefined || value.available !== undefined,
      { message: '至少提供一项设置' },
    ),
    response: z.object({ settings: tkPromptEngineSettingsSchema }),
  }),
  adminAnnouncements: contract({
    method: 'GET', path: '/api/admin/announcements', successStatus: 200,
    query: adminAnnouncementsQuery,
    response: createExactCursorPageSchema(adminAnnouncementSchema),
  }),
  adminAnnouncementCreate: contract({ method: 'POST', path: '/api/admin/announcements', successStatus: 200, body: announcementBody, response: z.object({ announcement: adminAnnouncementSchema }) }),
  adminAnnouncementUpdate: contract({
    method: 'PATCH', path: '/api/admin/announcements/:id', successStatus: 200, params: uuidParamsSchema,
    body: announcementBody.partial().strict(), response: z.object({ announcement: adminAnnouncementSchema }),
  }),
  adminAnnouncementDelete: contract({ method: 'DELETE', path: '/api/admin/announcements/:id', successStatus: 200, params: uuidParamsSchema, response: okResponseSchema }),
} as const satisfies Record<string, EndpointContract>;

export const endpointContracts:
  typeof publicEndpointContracts & typeof adminEndpointContracts & ProviderBillingEndpointContracts & typeof mcpEndpointContracts =
  Object.assign(publicEndpointContracts, adminEndpointContracts, providerBillingEndpointContracts, mcpEndpointContracts);

export type EndpointContractName = keyof typeof endpointContracts;
export type EndpointResponse<Name extends EndpointContractName> = z.output<(typeof endpointContracts)[Name]['response']>;
export type EndpointRequestBody<Name extends EndpointContractName> =
  (typeof endpointContracts)[Name] extends { body: infer Schema extends z.ZodTypeAny }
    ? z.input<Schema>
    : never;
export type EndpointRequestQuery<Name extends EndpointContractName> =
  (typeof endpointContracts)[Name] extends { query: infer Schema extends z.ZodTypeAny }
    ? z.input<Schema>
    : never;
export type EndpointRequestParams<Name extends EndpointContractName> =
  (typeof endpointContracts)[Name] extends { params: infer Schema extends z.ZodTypeAny }
    ? z.input<Schema>
    : never;

const endpointContractLookup = new Map<string, EndpointContract>(
  Object.values(endpointContracts).map(item => [`${item.method} ${item.path}`, item]),
);

export function getEndpointContract(method: string, path: string) {
  return endpointContractLookup.get(`${method.toUpperCase()} ${path}`);
}

export const commonErrorResponseSchema = apiErrorResponseSchema;
export const noBodySchema = emptyObjectSchema;
