import { z } from 'zod';
import {
  emailSchema,
  exactCursorPaginationSchema,
  finiteNumberSchema,
  httpUrlSchema,
  httpsUrlSchema,
  integerSchema,
  isoDateSchema,
  isoDateTimeSchema,
  jsonObjectSchema,
  nonemptyStringSchema,
  nonnegativeIntegerSchema,
  nullableIsoDateSchema,
  nullableIsoDateTimeSchema,
  paymentUrlSchema,
  percentageIntegerSchema,
  positiveIntegerSchema,
  unavailableDateTimeSchema,
  uuidSchema,
} from './primitives.js';

export const accountRoleSchema = z.enum(['user', 'admin']);
export const userStatusSchema = z.enum(['active', 'frozen', 'trial']);
export const billingCycleSchema = z.enum(['monthly', 'yearly']);
export const planKindSchema = z.enum(['main', 'addon']);
export const planBillingSchema = z.enum(['monthly', 'yearly', 'both', 'one-time']);
export const orderBillingSchema = z.enum(['monthly', 'yearly', 'one-time']);
export const planStatusSchema = z.enum(['active', 'disabled', 'draft']);
export const planRecommendationSchema = z.enum(['popular', 'enterprise']);
export const planIconKeySchema = z.enum(['zap', 'sparkles', 'crown', 'gem', 'rocket', 'building-2']);
export const assetTypeSchema = z.enum(['video', 'image', 'audio']);
export const assetSourceSchema = z.enum(['ai-video', 'ai-image', 'uploaded-video', 'uploaded-image', 'uploaded-audio']);
export const uploadAssetSourceSchema = z.enum(['uploaded-video', 'uploaded-image', 'uploaded-audio']);
export const orderStatusSchema = z.enum(['paid', 'pending', 'refunded', 'failed']);
export const invoiceStatusSchema = z.enum(['unissued', 'issued']);
export const invoiceRequestStatusSchema = z.enum(['unissued', 'issued']);
export const refundStatusSchema = z.enum(['none', 'pending', 'succeeded', 'failed']);
export const paymentSurfaceSchema = z.enum(['pc', 'mobile']);
export const paymentAttemptStatusSchema = z.enum([
  'queued', 'processing', 'ready', 'uncertain', 'paid', 'closed', 'failed', 'manual-review',
]);
export const refundAttemptStatusSchema = z.enum([
  'queued', 'processing', 'submitted', 'uncertain', 'succeeded', 'failed', 'manual-review',
]);
export const creditTypeSchema = z.enum(['earn', 'hold', 'spend', 'refund', 'adjust', 'void']);
export const creditBucketSchema = z.enum(['main', 'addon', 'mixed', 'system']);
export const creditSettlementStatusSchema = z.enum(['none', 'held', 'settled', 'refunded', 'reversed']);
export const ticketPrioritySchema = z.enum(['high', 'medium', 'low']);
export const ticketStatusSchema = z.enum(['open', 'pending', 'resolved']);
export const ticketAuthorRoleSchema = z.enum(['user', 'admin']);
export const generationKindSchema = z.enum(['video', 'image']);
export const generationStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed', 'canceled']);
export const generationFailureCategorySchema = z.enum([
  'insufficient-credits',
  'provider-failed',
  'content-policy',
  'user-canceled',
  'system-timeout',
]);
export const auditRiskSchema = z.enum(['low', 'medium', 'high']);
export const apiCostInputClassSchema = z.enum(['without-video', 'with-video', 'unknown']);
export const apiCostResolutionSchema = z.enum(['480p', '720p', '1080p', '4k', 'unknown']);
export const apiCostPricingResolutionSchema = z.enum(['480p-720p', '1080p', '4k', 'unknown']);
export const apiCostEstimateStatusSchema = z.enum([
  'priced',
  'legacy-inferred',
  'missing-usage',
  'unpriced',
  'unsupported',
]);
export const providerBillingFreshnessSchema = z.enum([
  'fresh',
  'stale',
  'running',
  'failed',
  'not-configured',
  'never-synced',
]);
export const providerBillStatusSchema = z.enum(['provisional', 'final', 'unavailable']);
export const apiCostRangeSchema = z.enum(['all', 'month', 'date', 'custom']);
export const apiCostTrendGrainSchema = z.enum(['month', 'day', 'bucket']);
export const apiCostCoverageStatusSchema = z.enum(['complete', 'partial', 'stale', 'unavailable']);
/**
 * 列表价估算的完整性独立于金额：partial 时金额仍是已知成本小计，
 * 但存在正 Token 未计价或供应商用量缺失，不能当作完整成本。
 */
export const apiCostEstimateCompletenessSchema = z.enum(['complete', 'partial', 'unavailable']);
export const apiCostBillStateSchema = z.enum(['unavailable', 'provisional', 'final', 'reopened', 'mixed']);
export const apiCostMatchStateSchema = z.enum(['cannot-reconcile', 'raw-matched', 'adjusted-matched', 'residual']);
export const apiCostUsageEvidenceOriginSchema = z.enum([
  'provider-reported',
  'legacy-raw',
  'official-bill-inferred',
  'unavailable',
]);
export const apiCostPricingRuleStatusSchema = z.enum(['priced', 'rule-missing', 'unsupported']);
export const apiCostAttributionConfidenceSchema = z.enum(['direct', 'high', 'medium', 'low', 'unallocated']);
export const apiCostBillLineTypeSchema = z.enum(['usage', 'package-purchase', 'refund', 'adjustment', 'other']);
export const apiCostPaymentStatusSchema = z.enum(['paid', 'unpaid', 'partial', 'zero', 'unknown']);

/** 财务金额始终通过十进制字符串传输，避免 JSON number 的浮点误差。 */
export const cnyAmountSchema = z.string().regex(/^-?\d+\.\d{6}$/);
export const nonnegativeCnyAmountSchema = z.string().regex(/^\d+\.\d{6}$/);

export const portraitEntitlementsSchema = z.object({
  enabled: z.boolean(),
  /** null 表示套餐不限制可建档人数。 */
  profileLimit: nonnegativeIntegerSchema.nullable(),
  activeLimit: nonnegativeIntegerSchema,
  assetsPerActor: nonnegativeIntegerSchema.max(2),
}).strict().superRefine((value, context) => {
  if (!value.enabled) {
    if (value.profileLimit !== 0 || value.activeLimit !== 0 || value.assetsPerActor !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '关闭真人人像素材库时，所有额度必须为 0',
      });
    }
    return;
  }
  if (value.profileLimit !== null && value.profileLimit === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['profileLimit'],
      message: '启用时建档额度必须为正整数或 null',
    });
  }
  if (value.activeLimit === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['activeLimit'],
      message: '启用时激活额度必须为正整数',
    });
  }
  if (value.assetsPerActor === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assetsPerActor'],
      message: '启用时每位真人素材数量必须为 1 或 2',
    });
  }
  if (value.profileLimit !== null && value.activeLimit > value.profileLimit) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['activeLimit'],
      message: '激活额度不能超过建档额度',
    });
  }
});

export type PortraitEntitlementsDto = z.infer<typeof portraitEntitlementsSchema>;

export const realPortraitPlanAccessStatusSchema = z.enum(['available', 'grace', 'plan_locked']);
export const realPortraitLifecycleStatusSchema = z.enum([
  'draft',
  'waiting',
  'invited',
  'verifying',
  'awaiting_upload',
  'processing',
  'active',
  'eviction_warning',
  'evicted',
  'revoked',
  'expired',
  'deleting',
  'sync_error',
]);
export const realPortraitAuthorizationStatusSchema = z.enum([
  'none',
  'draft',
  'pending',
  'verified',
  'active',
  'rejected',
  'revoked',
  'expired',
]);
export const realPortraitAssetKindSchema = z.enum(['primary', 'secondary']);
export const realPortraitAssetStatusSchema = z.enum([
  'queued', 'processing', 'active', 'failed', 'deleting', 'deleted',
]);
export const realPortraitConsistencyStatusSchema = z.enum(['pending', 'passed', 'failed', 'unknown']);
export const realPortraitQuotaGraceStatusSchema = z.enum(['none', 'active', 'reconciling', 'completed']);

export const realPortraitAssetSchema = z.object({
  id: uuidSchema,
  kind: realPortraitAssetKindSchema,
  status: realPortraitAssetStatusSchema,
  consistencyStatus: realPortraitConsistencyStatusSchema,
  thumbnailAvailable: z.boolean().optional(),
}).strict();

export const realPortraitActorSchema = z.object({
  id: uuidSchema,
  alias: nonemptyStringSchema.max(120),
  planAccessStatus: realPortraitPlanAccessStatusSchema,
  lifecycleStatus: realPortraitLifecycleStatusSchema,
  authorizationStatus: realPortraitAuthorizationStatusSchema,
  authorizationExpiresAt: nullableIsoDateTimeSchema,
  lastSuccessfulGenerationAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  assets: z.array(realPortraitAssetSchema).max(2),
}).strict();

export const realPortraitCapacityGlobalSchema = z.object({
  groupSoftLimit: nonnegativeIntegerSchema.max(50),
  assetSoftLimit: nonnegativeIntegerSchema.max(50),
  groupsUsed: nonnegativeIntegerSchema,
  assetsUsed: nonnegativeIntegerSchema,
  groupsReserved: nonnegativeIntegerSchema,
  assetsReserved: nonnegativeIntegerSchema,
}).strict();

export const realPortraitQuotaStateSchema = z.object({
  graceStatus: realPortraitQuotaGraceStatusSchema,
  graceUntil: nullableIsoDateTimeSchema,
  retainedActorIds: z.array(uuidSchema),
  activeActorIds: z.array(uuidSchema),
}).strict();

export const realPortraitCapacitySchema = z.object({
  sourcePlanCode: nonemptyStringSchema.max(120),
  sourcePlanName: nonemptyStringSchema.max(200),
  entitlements: portraitEntitlementsSchema,
  usage: z.object({
    profiles: nonnegativeIntegerSchema,
    active: nonnegativeIntegerSchema,
    queued: nonnegativeIntegerSchema,
  }).strict(),
  global: realPortraitCapacityGlobalSchema,
  quotaState: realPortraitQuotaStateSchema.nullable(),
}).strict();

export const realPortraitActorListSchema = z.object({
  items: z.array(realPortraitActorSchema),
  capacity: realPortraitCapacitySchema,
}).strict();

export const realPortraitActivationSchema = z.object({
  actor: realPortraitActorSchema,
  queuePosition: nonnegativeIntegerSchema.positive().nullable(),
  invitationUrl: httpUrlSchema.nullable(),
  invitationExpiresAt: nullableIsoDateTimeSchema,
}).strict();

export const publicRealPortraitInviteStatusSchema = z.enum([
  'pending', 'accepted', 'consumed', 'expired', 'cancelled',
]);

const publicRealPortraitDisclosureSchema = z.object({
  controllerName: nonemptyStringSchema,
  processorName: nonemptyStringSchema,
  privacyContact: nonemptyStringSchema,
  privacyPolicyUrl: httpsUrlSchema,
  processingScope: nonemptyStringSchema.max(1_000),
  retentionRule: nonemptyStringSchema.max(1_000),
}).strict();

export const publicRealPortraitInviteSchema = publicRealPortraitDisclosureSchema.extend({
  status: publicRealPortraitInviteStatusSchema,
  purpose: nonemptyStringSchema.max(500),
  commercialUse: z.boolean(),
  validUntil: isoDateTimeSchema,
  inviteExpiresAt: isoDateTimeSchema,
  portraitNoticeVersion: nonemptyStringSchema.max(80),
  sensitiveInfoNoticeVersion: nonemptyStringSchema.max(80),
  canStartVerification: z.boolean(),
});

export const publicRealPortraitAuthorizationSchema = publicRealPortraitDisclosureSchema.extend({
  status: realPortraitAuthorizationStatusSchema,
  purpose: nonemptyStringSchema.max(500),
  commercialUse: z.boolean(),
  validUntil: isoDateTimeSchema,
  cleanupStatus: z.enum(['not-requested', 'pending', 'completed', 'manual-review']),
});

export const adminRealPortraitCapacitySchema = z.object({
  global: realPortraitCapacityGlobalSchema,
  listInfo: z.object({
    users: z.object({ total: nonnegativeIntegerSchema, returned: nonnegativeIntegerSchema, truncated: z.boolean() }).strict(),
    queue: z.object({
      total: nonnegativeIntegerSchema,
      waiting: nonnegativeIntegerSchema,
      returned: nonnegativeIntegerSchema,
      truncated: z.boolean(),
    }).strict(),
    remoteDeleteFailures: z.object({ total: nonnegativeIntegerSchema, returned: nonnegativeIntegerSchema, truncated: z.boolean() }).strict(),
  }).strict(),
  users: z.array(z.object({
    userId: uuidSchema,
    userName: z.string(),
    email: emailSchema,
    planCode: z.string().nullable(),
    entitlements: portraitEntitlementsSchema,
    usage: z.object({
      profiles: nonnegativeIntegerSchema,
      active: nonnegativeIntegerSchema,
      queued: nonnegativeIntegerSchema,
    }).strict(),
    quotaState: z.object({
      graceStatus: realPortraitQuotaGraceStatusSchema,
      graceUntil: nullableIsoDateTimeSchema,
    }).strict().nullable(),
  }).strict()),
  queue: z.array(z.object({
    id: uuidSchema,
    userId: uuidSchema,
    userName: z.string(),
    actorAlias: nonemptyStringSchema,
    status: z.enum(['waiting', 'promoted', 'completed', 'cancelled']),
    requestedAt: isoDateTimeSchema,
    position: nonnegativeIntegerSchema.positive(),
  }).strict()),
  remoteDeleteFailures: z.array(z.object({
    id: uuidSchema,
    userId: uuidSchema,
    userName: z.string(),
    actorAlias: nonemptyStringSchema,
    resourceKind: z.enum(['asset', 'group']),
    attempts: nonnegativeIntegerSchema,
    errorCode: z.string().nullable(),
    lastAttemptAt: nullableIsoDateTimeSchema,
    nextRetryAt: nullableIsoDateTimeSchema,
  }).strict()),
}).strict();

export const userProfileSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  userName: z.string().trim().min(2).max(30),
  role: accountRoleSchema,
  status: userStatusSchema,
  planCode: z.string().nullable(),
  planName: z.string().nullable(),
  portraitEntitlements: portraitEntitlementsSchema,
  billingCycle: billingCycleSchema,
  mainCredits: nonnegativeIntegerSchema,
  addonCredits: nonnegativeIntegerSchema,
  credits: nonnegativeIntegerSchema,
  totalCredits: nonnegativeIntegerSchema,
  planResetAt: nullableIsoDateSchema,
  planExpiresAt: nullableIsoDateSchema,
  registeredAt: isoDateTimeSchema,
  lastActiveAt: isoDateTimeSchema,
});

export const planFeatureSchema = z.object({
  text: z.string(),
  enabled: z.boolean(),
});

const publicPlanBaseSchema = z.object({
  id: uuidSchema,
  code: nonemptyStringSchema,
  name: nonemptyStringSchema,
  nameEn: z.string(),
  kind: planKindSchema,
  billing: planBillingSchema,
  description: z.string(),
  monthlyPrice: nonnegativeIntegerSchema,
  yearlyPrice: nonnegativeIntegerSchema,
  credits: nonnegativeIntegerSchema,
  assetRetentionDays: nonnegativeIntegerSchema.max(3650),
  portraitEntitlements: portraitEntitlementsSchema,
  storage: z.string(),
  tiktokAccounts: z.string(),
  recommendation: planRecommendationSchema.nullable(),
  iconKey: planIconKeySchema.nullable(),
  ctaLabel: z.string(),
  status: planStatusSchema,
  landingVisible: z.boolean(),
  features: z.array(planFeatureSchema),
});

function validatePlanPortraitEntitlements(
  plan: {
    kind: z.infer<typeof planKindSchema>;
    assetRetentionDays: number;
    portraitEntitlements: PortraitEntitlementsDto;
  },
  context: z.RefinementCtx,
) {
  const value = plan.portraitEntitlements;
  if (plan.kind === 'main') {
    if (value.enabled && plan.assetRetentionDays < 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assetRetentionDays'],
        message: '启用真人演员库的主套餐必须设置正整数素材保留天数',
      });
    }
    return;
  }
  if (plan.assetRetentionDays !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assetRetentionDays'],
      message: '加购包的素材保留天数必须为 0',
    });
  }
  if (value.enabled || value.profileLimit !== 0 || value.activeLimit !== 0 || value.assetsPerActor !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['portraitEntitlements'],
      message: '加购包不能包含真人人像素材库权益',
    });
  }
}

export const publicPlanSchema = publicPlanBaseSchema.superRefine(validatePlanPortraitEntitlements);

export const adminPlanSchema = publicPlanBaseSchema.extend({
  subscribers: nonnegativeIntegerSchema,
  revenue: nonnegativeIntegerSchema,
  createdAt: nullableIsoDateTimeSchema,
  updatedAt: nullableIsoDateTimeSchema,
}).superRefine(validatePlanPortraitEntitlements);

export const publicAnnouncementSchema = z.object({
  id: uuidSchema,
  title: nonemptyStringSchema,
  content: nonemptyStringSchema,
  pinned: z.boolean(),
  publishedAt: isoDateTimeSchema,
});

export const adminAnnouncementSchema = publicAnnouncementSchema.extend({
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const featureFlagsSchema = z.object({
  tiktokAccounts: z.boolean(),
  tiktokPublish: z.boolean(),
});

export const assetReferenceRoleSchema = z.enum([
  'reference_image',
  'reference_video',
  'reference_audio',
  'first_frame',
  'last_frame',
]);

/** 新生成请求只接受不可伪造对象路径的资产 ID 与用途。 */
export const generationReferenceInputSchema = z.object({
  assetId: uuidSchema,
  role: assetReferenceRoleSchema,
}).strict();

export const seedreamImageReferenceInputSchema = z.object({
  assetId: uuidSchema,
  role: z.literal('reference_image'),
}).strict();

/** 写入边界与历史读取 DTO 分离；旧 referenceImages/objectKey 载荷不再兼容。 */
export const videoGenerationAspectRatioSchema = z.enum(['9:16', '16:9', 'adaptive']);
export const videoGenerationResolutionSchema = z.enum(['480p', '720p', '1080p']);
export const videoGenerationDurationSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(20),
  z.literal(25),
  z.literal(30),
]);
export const seedanceVideoModelLabelSchema = z.enum([
  'Seedance 2.5',
  'Seedance 2.0',
  'Seedance 2.0 Fast',
  'Seedance 2.0 Mini',
]);

export const videoGenerationRequestConfigSchema = z.object({
  mode: z.enum(['general', 'first-last']).default('general'),
  aspectRatio: videoGenerationAspectRatioSchema,
  resolution: videoGenerationResolutionSchema,
  durationSeconds: videoGenerationDurationSchema,
  generateAudio: z.boolean().optional(),
}).strict();

export interface VideoModelCapabilityDto {
  id: 'seedance-2.5' | 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-2.0-mini';
  label: 'Seedance 2.5' | 'Seedance 2.0' | 'Seedance 2.0 Fast' | 'Seedance 2.0 Mini';
  available: boolean;
  recommended: boolean;
  resolutions: Array<'480p' | '720p' | '1080p'>;
  durationSeconds: Array<5 | 10 | 15 | 20 | 25 | 30>;
  modes: Array<'general' | 'first-last'>;
  aspectRatios: {
    general: Array<'9:16' | '16:9' | 'adaptive'>;
    firstLast: Array<'9:16' | '16:9' | 'adaptive'>;
  };
  references: {
    maxTotal: number;
    maxImages: number;
    maxVideos: number;
    maxAudios: number;
    maxVideoDurationSeconds: number;
    maxAudioDurationSeconds: number;
    allowAudioOnly: boolean;
  };
  supportsPromptWizard: boolean;
  supportsRealPortrait: boolean;
  outputFormat: 'mp4';
  generateAudio: true;
}

export const videoModelCapabilitySchema: z.ZodType<VideoModelCapabilityDto> = z.object({
  id: z.enum(['seedance-2.5', 'seedance-2.0', 'seedance-2.0-fast', 'seedance-2.0-mini']),
  label: seedanceVideoModelLabelSchema,
  available: z.boolean(),
  recommended: z.boolean(),
  resolutions: z.array(videoGenerationResolutionSchema).min(1),
  durationSeconds: z.array(videoGenerationDurationSchema).min(1),
  modes: z.array(z.enum(['general', 'first-last'])).min(1),
  aspectRatios: z.object({
    general: z.array(videoGenerationAspectRatioSchema).min(1),
    firstLast: z.array(videoGenerationAspectRatioSchema).min(1),
  }).strict(),
  references: z.object({
    maxTotal: nonnegativeIntegerSchema,
    maxImages: nonnegativeIntegerSchema,
    maxVideos: nonnegativeIntegerSchema,
    maxAudios: nonnegativeIntegerSchema,
    maxVideoDurationSeconds: nonnegativeIntegerSchema,
    maxAudioDurationSeconds: nonnegativeIntegerSchema,
    allowAudioOnly: z.boolean(),
  }).strict(),
  supportsPromptWizard: z.boolean(),
  supportsRealPortrait: z.boolean(),
  outputFormat: z.literal('mp4'),
  generateAudio: z.literal(true),
}).strict().superRefine((capability, context) => {
  const references = capability.references;
  if (references.maxImages + references.maxVideos + references.maxAudios < references.maxTotal) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['references', 'maxTotal'],
      message: '素材总上限不能大于各类型上限之和',
    });
  }
});

export const seedreamImageResolutionSchema = z.enum(['1K', '2K']);
export const seedreamImageAspectRatioSchema = z.enum([
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
  '21:9',
]);
export const seedreamOptimizePromptModeSchema = z.enum(['standard', 'fast']);
export const seedreamAnnotationTokenSchema = z.string()
  .regex(/^@标记(?:[1-9]\d{0,2})$/, '标记 token 必须为 @标记1 到 @标记999');
const seedreamNormalizedCoordinateSchema = z.number().int().min(0).max(999);

export const seedreamPointAnnotationSchema = z.object({
  token: seedreamAnnotationTokenSchema,
  assetId: uuidSchema,
  type: z.literal('point'),
  x: seedreamNormalizedCoordinateSchema,
  y: seedreamNormalizedCoordinateSchema,
}).strict();

export const seedreamBboxAnnotationSchema = z.object({
  token: seedreamAnnotationTokenSchema,
  assetId: uuidSchema,
  type: z.literal('bbox'),
  x1: seedreamNormalizedCoordinateSchema,
  y1: seedreamNormalizedCoordinateSchema,
  x2: seedreamNormalizedCoordinateSchema,
  y2: seedreamNormalizedCoordinateSchema,
}).strict().superRefine((value, context) => {
  if (value.x1 >= value.x2) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['x2'], message: '框选右边界必须大于左边界' });
  }
  if (value.y1 >= value.y2) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['y2'], message: '框选下边界必须大于上边界' });
  }
});

export const seedreamAnnotationSchema = z.union([
  seedreamPointAnnotationSchema,
  seedreamBboxAnnotationSchema,
]);

export const imageGenerationRequestConfigSchema = z.object({
  resolution: seedreamImageResolutionSchema,
  aspectRatio: seedreamImageAspectRatioSchema,
  optimizePromptMode: seedreamOptimizePromptModeSchema,
}).strict();

// ── 提示词向导 ────────────────────────────────────────────────────────────────
// 向导的配置边界故意不包含参考模式。服务端与前端都只允许在 AI Studio 的
// general（全能参考）工作区中创建和应用向导草稿。
export const promptWizardVideoModelSchema = z.enum([
  'seedance-2.0',
  'seedance-2.0-fast',
  'seedance-2.0-mini',
]);
export const promptWizardAspectRatioSchema = z.enum(['9:16', '16:9']);
export const promptWizardResolutionSchema = z.enum(['480p', '720p', '1080p']);
export const promptWizardDurationSchema = z.union([z.literal(5), z.literal(10), z.literal(15)]);
export const promptWizardDirectionSchema = z.enum([
  'ugc',
  'problem-solution',
  'unboxing-review',
  'feature-test',
  'pain-comparison',
  'lifestyle',
  'cinematic-brand',
  'asmr-detail',
]);
export const promptWizardMarketingGoalSchema = z.enum(['conversion', 'consideration', 'awareness']);
export const promptWizardCreativeIntensitySchema = z.enum(['steady', 'balanced', 'bold']);

const promptWizardShortTextSchema = z.string().trim().max(500);
const promptWizardLongTextSchema = z.string().trim().max(2_000);
const promptWizardTextListSchema = z.array(z.string().trim().min(1).max(300)).max(20);

export const promptWizardProductProfileSchema = z.object({
  productName: promptWizardShortTextSchema,
  category: promptWizardShortTextSchema,
  /** @deprecated 仅为兼容旧任务与旧客户端保留；新流程统一写入空字符串。 */
  colors: promptWizardShortTextSchema,
  materials: promptWizardShortTextSchema,
  structure: promptWizardLongTextSchema,
  logo: promptWizardShortTextSchema,
  usage: promptWizardLongTextSchema,
  suggestedAudience: promptWizardLongTextSchema,
  suggestedScenarios: promptWizardLongTextSchema,
  visibleFacts: promptWizardTextListSchema,
  /**
   * 服务端依据封闭品类白名单确定性补充的普通功能，不来自图片证据，也不能
   * 承载价格、规格、材质、认证、健康、安全、耐用或效果承诺。历史档案没有
   * 该字段时仍可只读恢复。
   */
  categoryInferredFunctions: promptWizardTextListSchema.optional(),
  needsConfirmation: promptWizardTextListSchema,
  /** 价格、数字卖点、认证、承诺等只能由用户在这里显式确认。 */
  userConfirmedClaims: promptWizardLongTextSchema,
  consistencyConstraints: promptWizardLongTextSchema,
}).strict();

export const promptWizardCreativeBriefSchema = z.object({
  targetLanguage: z.string().trim().min(1).max(40),
  direction: promptWizardDirectionSchema,
  marketingGoal: promptWizardMarketingGoalSchema,
  creativeIntensity: promptWizardCreativeIntensitySchema,
  /** 仅允许保存用户确认当前真实有效的价格或促销信息；空值表示不得生成促销内容。 */
  confirmedOffer: z.string().trim().max(300).default(''),
}).strict();

export const promptWizardAudioModeSchema = z.enum([
  'sound-design-only',
  'voiceover',
]);

/**
 * V6 极简流程由时长确定声音模式：5 秒只做声音设计，10/15 秒才保存口播语言。
 * 真实优惠始终保留在 brief，但 5 秒执行提示词不得消费该字段。
 */
export const promptWizardCreativeBriefV6Schema = z.discriminatedUnion('audioMode', [
  z.object({
    audioMode: z.literal('sound-design-only'),
    /** 空字符串表示不得生成价格、折扣或促销内容。 */
    verifiedOffer: z.string().trim().max(300).default(''),
  }).strict(),
  z.object({
    audioMode: z.literal('voiceover'),
    voiceoverLanguage: z.string().trim().min(1).max(40),
    /** 空字符串表示不得生成价格、折扣或促销内容。 */
    verifiedOffer: z.string().trim().max(300).default(''),
  }).strict(),
]);

export const promptWizardRunCreativeBriefSchema = z.union([
  promptWizardCreativeBriefSchema,
  promptWizardCreativeBriefV6Schema,
]);

export const promptWizardVideoConfigSchema = z.object({
  model: promptWizardVideoModelSchema,
  aspectRatio: promptWizardAspectRatioSchema,
  resolution: promptWizardResolutionSchema,
  durationSeconds: promptWizardDurationSchema,
}).strict().superRefine((config, context) => {
  if (
    config.resolution === '1080p'
    && (config.model === 'seedance-2.0-fast' || config.model === 'seedance-2.0-mini')
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resolution'],
      message: 'Seedance Fast 和 Mini 不支持 1080p',
    });
  }
});

export const promptWizardProductFamilySchema = z.enum([
  'apparel-accessories',
  'beauty-personal-care',
  'consumer-electronics',
  'home-living',
  'general',
]);

export const promptWizardEvidenceTypeSchema = z.enum([
  'appearance',
  'structure',
  'material',
  'logo-print',
  'usage',
  'capability',
  'commercial-claim',
  'audience',
  'scenario',
  'other',
]);

export const promptWizardEvidenceStatusSchema = z.enum([
  'visible',
  'user-confirmed',
  'needs-confirmation',
  'forbidden-assumption',
]);

/**
 * 图片证据的识别可信度。旧证据图谱没有该字段时按 unknown 读取；可信度不替代
 * status：只有图片识别来源使用 high/medium/low，用户确认内容保持 unknown。
 */
export const promptWizardEvidenceConfidenceSchema = z.enum([
  'high',
  'medium',
  'low',
  'unknown',
]);

export const promptWizardDirectionAvailabilitySchema = z.enum([
  'recommended',
  'available',
  'unavailable',
]);

export const promptWizardDirectionAssessmentSchema = z.object({
  direction: promptWizardDirectionSchema,
  availability: promptWizardDirectionAvailabilitySchema,
  reason: nonemptyStringSchema.max(500),
  missingRequirements: z.array(nonemptyStringSchema.max(300)).max(12),
}).strict();

/** 产品事实的可追溯证据；禁止把待确认内容当作可靠卖点。 */
export const promptWizardEvidenceSchema = z.object({
  id: nonemptyStringSchema.max(120),
  type: promptWizardEvidenceTypeSchema,
  text: nonemptyStringSchema.max(500),
  sourceImageAssetIds: z.array(uuidSchema).max(9),
  visibleRegion: z.string().trim().max(300),
  status: promptWizardEvidenceStatusSchema,
  confidence: promptWizardEvidenceConfidenceSchema.default('unknown'),
  proofActions: z.array(nonemptyStringSchema.max(300)).max(8),
}).strict();

export const promptWizardEvidenceGraphSchema = z.object({
  version: z.literal(1),
  productFamily: promptWizardProductFamilySchema,
  evidences: z.array(promptWizardEvidenceSchema).min(1).max(80),
  reliableEvidenceIds: z.array(nonemptyStringSchema.max(120)).max(80),
  pendingEvidenceIds: z.array(nonemptyStringSchema.max(120)).max(80),
  forbiddenAssumptionIds: z.array(nonemptyStringSchema.max(120)).max(80),
  directionAssessments: z.array(promptWizardDirectionAssessmentSchema).length(8),
}).strict().superRefine((graph, context) => {
  const evidenceIds = new Set(graph.evidences.map(evidence => evidence.id));
  if (evidenceIds.size !== graph.evidences.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['evidences'], message: '证据 id 必须唯一' });
  }
  if (new Set(graph.directionAssessments.map(item => item.direction)).size !== 8) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['directionAssessments'],
      message: '每个主创作方向必须且只能评估一次',
    });
  }
  for (const [field, ids] of [
    ['reliableEvidenceIds', graph.reliableEvidenceIds],
    ['pendingEvidenceIds', graph.pendingEvidenceIds],
    ['forbiddenAssumptionIds', graph.forbiddenAssumptionIds],
  ] as const) {
    if (ids.some(id => !evidenceIds.has(id))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: '证据分组只能引用当前证据图谱中的 id',
      });
    }
  }
});

export const promptWizardAppearanceModeSchema = z.enum([
  'person',
  'hands-only',
  'product-only',
]);

/** 用户只需确认真正会改变创意路线的生产条件。 */
export const promptWizardProductionBriefSchema = z.object({
  primaryPurchaseReason: z.string().trim().max(500),
  appearanceMode: promptWizardAppearanceModeSchema,
  availableScenes: z.array(nonemptyStringSchema.max(200)).max(12),
  availableAssets: z.array(nonemptyStringSchema.max(200)).max(20),
}).strict();

export const promptWizardStrategySchema = z.object({
  hookType: nonemptyStringSchema.max(80),
  narrativeArc: nonemptyStringSchema.max(80),
  sceneFamily: nonemptyStringSchema.max(80),
  cameraGrammar: nonemptyStringSchema.max(80),
  pacing: nonemptyStringSchema.max(80),
  proofMechanism: nonemptyStringSchema.max(80),
  ctaStyle: nonemptyStringSchema.max(80),
}).strict();

export const promptWizardConceptRoleSchema = z.enum([
  'reliable-conversion',
  'creative-breakthrough',
]);
export const promptWizardProductionDifficultySchema = z.enum(['low', 'medium', 'high']);
export const promptWizardConceptRiskSchema = z.enum(['low', 'medium', 'high']);

export const promptWizardProductionLoadSchema = z.object({
  locationCount: z.number().int().min(1).max(8),
  personCount: z.number().int().min(0).max(12),
  majorActionCount: z.number().int().min(1).max(20),
  propCount: z.number().int().min(0).max(20),
  cameraMoveCount: z.number().int().min(0).max(20),
  hasMagicTransition: z.boolean(),
}).strict();

/** 创意导演返回的短路线；strategy 必填，确保可直接映射现有双脚本扩写管线。 */
export const promptWizardConceptPreviewSchema = z.object({
  id: uuidSchema,
  role: promptWizardConceptRoleSchema,
  title: nonemptyStringSchema.max(80),
  firstSecondEvent: nonemptyStringSchema.max(500),
  viewerQuestion: nonemptyStringSchema.max(500),
  purchaseReason: nonemptyStringSchema.max(500),
  tension: nonemptyStringSchema.max(500),
  productAction: nonemptyStringSchema.max(500),
  visibleResult: nonemptyStringSchema.max(500),
  evidenceIds: z.array(nonemptyStringSchema.max(120)).min(1).max(12),
  scene: nonemptyStringSchema.max(300),
  perspective: nonemptyStringSchema.max(200),
  cameraGrammar: nonemptyStringSchema.max(300),
  ctaCallback: nonemptyStringSchema.max(300),
  requiredAssets: z.array(nonemptyStringSchema.max(300)).max(20),
  difficulty: promptWizardProductionDifficultySchema,
  risk: promptWizardConceptRiskSchema,
  direction: promptWizardDirectionSchema,
  strategy: promptWizardStrategySchema,
  productionLoad: promptWizardProductionLoadSchema,
  rank: z.number().int().min(1).max(8),
}).strict();

export const promptWizardConceptSetStatusSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
]);

export const promptWizardConceptSetSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  status: promptWizardConceptSetStatusSchema,
  runRevision: nonnegativeIntegerSchema,
  candidates: z.array(promptWizardConceptPreviewSchema).max(8),
  recommendedConceptIds: z.array(uuidSchema).max(2),
  failureReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: nullableIsoDateTimeSchema,
}).strict().superRefine((conceptSet, context) => {
  if (conceptSet.status === 'completed') {
    if (conceptSet.candidates.length !== 8) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidates'],
        message: '已完成的创意路线必须包含 8 个候选',
      });
    }
    if (conceptSet.recommendedConceptIds.length !== 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recommendedConceptIds'],
        message: '已完成的创意路线必须包含 2 个推荐候选',
      });
    }
    if (new Set(conceptSet.candidates.map(candidate => candidate.id)).size !== 8) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['candidates'], message: '候选创意 id 必须唯一' });
    }
    if (new Set(conceptSet.candidates.map(candidate => candidate.rank)).size !== 8) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['candidates'], message: '候选创意排序必须唯一' });
    }
    const reliableCount = conceptSet.candidates.filter(
      candidate => candidate.role === 'reliable-conversion',
    ).length;
    const breakthroughCount = conceptSet.candidates.filter(
      candidate => candidate.role === 'creative-breakthrough',
    ).length;
    if (reliableCount !== 4 || breakthroughCount !== 4) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidates'],
        message: '创意集合必须包含 4 条可信转化型和 4 条强钩子记忆型路线',
      });
    }
    const recommended = conceptSet.recommendedConceptIds
      .map(id => conceptSet.candidates.find(candidate => candidate.id === id));
    if (
      recommended.some(candidate => !candidate)
      || new Set(recommended.map(candidate => candidate?.role)).size !== 2
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recommendedConceptIds'],
        message: '推荐路线必须各包含一条可信转化型和强钩子记忆型候选',
      });
    }
  }
  if (conceptSet.status === 'failed' && !conceptSet.failureReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['failureReason'],
      message: '失败的创意路线必须包含失败原因',
    });
  }
});

export const promptWizardSceneOptionSchema = z.object({
  id: uuidSchema,
  title: nonemptyStringSchema.max(80),
  environment: nonemptyStringSchema.max(300),
  mainAction: nonemptyStringSchema.max(500),
}).strict();

export const promptWizardCustomSceneSchema = promptWizardSceneOptionSchema
  .omit({ id: true })
  .strict();

export const promptWizardSelectedSceneSchema = promptWizardCustomSceneSchema.extend({
  /** 推荐场景保留原 id；用户自定义场景固定为 null。 */
  id: uuidSchema.nullable(),
}).strict();

const promptWizardUseDirectionBaseSchema = z.object({
  id: uuidSchema,
  title: nonemptyStringSchema.max(80),
  useMoment: nonemptyStringSchema.max(300),
  audienceNeed: nonemptyStringSchema.max(500),
  purchaseReason: nonemptyStringSchema.max(500),
  proofAction: nonemptyStringSchema.max(500),
  evidenceIds: z.array(nonemptyStringSchema.max(120)).min(1).max(12),
  sceneOptions: z.array(promptWizardSceneOptionSchema).min(2).max(3),
  recommendedSceneId: uuidSchema,
  appearanceMode: promptWizardAppearanceModeSchema,
  internalDirection: promptWizardDirectionSchema,
  requiredAssets: z.array(nonemptyStringSchema.max(300)).max(20),
}).strict();

/** 产品证据驱动的使用方向；内部拍法不暴露为用户额外选择项。 */
export const promptWizardUseDirectionSchema = promptWizardUseDirectionBaseSchema.superRefine((direction, context) => {
  if (new Set(direction.evidenceIds).size !== direction.evidenceIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidenceIds'],
      message: '使用方向引用的证据 id 必须唯一',
    });
  }

  const sceneIds = new Set(direction.sceneOptions.map(scene => scene.id));
  if (sceneIds.size !== direction.sceneOptions.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sceneOptions'],
      message: '使用方向中的场景 id 必须唯一',
    });
  }
  if (!sceneIds.has(direction.recommendedSceneId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recommendedSceneId'],
      message: '推荐场景必须属于当前使用方向',
    });
  }
});

export const promptWizardUseDirectionSetStatusSchema = z.enum([
  'queued',
  'processing',
  'needs-input',
  'completed',
  'failed',
]);

export const promptWizardUseDirectionClarificationQuestionSchema = z.literal(
  '请补充一个您确认真实、希望重点展示的用途或卖点。',
);

export const promptWizardUseDirectionSetSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  status: promptWizardUseDirectionSetStatusSchema,
  runRevision: nonnegativeIntegerSchema,
  directions: z.array(promptWizardUseDirectionSchema).max(3),
  clarificationQuestion: promptWizardUseDirectionClarificationQuestionSchema.nullable(),
  failureReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: nullableIsoDateTimeSchema,
}).strict().superRefine((directionSet, context) => {
  if (directionSet.status === 'completed') {
    if (directionSet.directions.length < 2 || directionSet.directions.length > 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['directions'],
        message: '已完成的使用方向规划必须包含 2 至 3 个方向',
      });
    }
    if (directionSet.clarificationQuestion !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clarificationQuestion'],
        message: '已完成的使用方向规划不能继续要求补充信息',
      });
    }
  } else if (directionSet.directions.length !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['directions'],
      message: '未完成的使用方向规划不能交付部分方向',
    });
  }

  if (directionSet.status === 'needs-input' && !directionSet.clarificationQuestion) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['clarificationQuestion'],
      message: '需要补充信息时必须返回固定问题',
    });
  }
  if (directionSet.status !== 'needs-input' && directionSet.clarificationQuestion !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['clarificationQuestion'],
      message: '只有等待用户补充信息时才能返回问题',
    });
  }
  if (directionSet.status === 'failed' && !directionSet.failureReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['failureReason'],
      message: '失败的使用方向规划必须包含失败原因',
    });
  }
  if (directionSet.status !== 'failed' && directionSet.failureReason !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['failureReason'],
      message: '只有失败的使用方向规划才能返回失败原因',
    });
  }

  const directionIds = directionSet.directions.map(direction => direction.id);
  if (new Set(directionIds).size !== directionIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['directions'],
      message: '使用方向 id 必须唯一',
    });
  }
});

export const promptWizardPlanningReviewSchema = z.object({
  targetAudience: nonemptyStringSchema.max(500),
  surfaceNeed: nonemptyStringSchema.max(500),
  realPainPoint: nonemptyStringSchema.max(500),
  nonAdEntry: nonemptyStringSchema.max(500),
  proofPoints: z.array(nonemptyStringSchema.max(300)).min(1).max(12),
  directionFit: nonemptyStringSchema.max(500),
}).strict();

export const promptWizardShotRoleSchema = z.enum([
  'hook',
  'proof',
  'proof-resolution',
  'resolution',
  'cta',
]);

/** 3.0 创意导演分镜只保留生产执行与口播对照。 */
export const promptWizardShotSchema = z.object({
  startSeconds: z.number().finite().nonnegative(),
  endSeconds: z.number().finite().positive(),
  role: promptWizardShotRoleSchema,
  location: nonemptyStringSchema.max(300),
  subject: nonemptyStringSchema.max(300),
  shotSize: nonemptyStringSchema.max(120),
  action: nonemptyStringSchema.max(500),
  cameraMovement: nonemptyStringSchema.max(300),
  lightingAndRealism: nonemptyStringSchema.max(300),
  voiceover: z.string().trim().max(500),
  voiceoverZh: z.string().trim().max(500),
  foley: nonemptyStringSchema.max(300),
  editingCue: nonemptyStringSchema.max(300),
  evidenceRefs: z.array(nonemptyStringSchema.max(120)).max(12),
  productionNote: z.string().trim().max(500),
}).strict().superRefine((shot, context) => {
  if (shot.endSeconds <= shot.startSeconds) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endSeconds'],
      message: '分镜结束时间必须晚于开始时间',
    });
  }
});

export const promptWizardProductionWarningSchema = nonemptyStringSchema.max(500);

const promptWizardPlanCommonSchema = z.object({
  id: uuidSchema,
  name: nonemptyStringSchema.max(80),
  hook: nonemptyStringSchema.max(300),
  narrative: nonemptyStringSchema.max(500),
  primaryScene: nonemptyStringSchema.max(300),
  cameraAndPacing: nonemptyStringSchema.max(500),
  differenceTags: z.array(nonemptyStringSchema.max(40)).min(2).max(6),
  strategy: promptWizardStrategySchema,
  prompt: nonemptyStringSchema.max(3_800),
}).strict();

export const promptWizardPlanConceptSchema = z.object({
  id: uuidSchema,
  role: promptWizardConceptRoleSchema,
  summary: nonemptyStringSchema.max(500),
  firstSecondEvent: nonemptyStringSchema.max(500),
  purchaseReason: nonemptyStringSchema.max(500),
  evidenceIds: z.array(nonemptyStringSchema.max(120)).min(1).max(12),
  requiredAssets: z.array(nonemptyStringSchema.max(300)).max(20),
  difficulty: promptWizardProductionDifficultySchema,
  risk: promptWizardConceptRiskSchema,
}).strict();

/** V4 以创意导演路线为来源，并把工作台所需的执行摘要一起交付。 */
export const promptWizardPlanV4Schema = promptWizardPlanCommonSchema.extend({
  deliveryVersion: z.literal(4),
  concept: promptWizardPlanConceptSchema,
  planningReview: promptWizardPlanningReviewSchema,
  shots: z.array(promptWizardShotSchema).min(3).max(4),
  productionWarnings: z.array(promptWizardProductionWarningSchema).max(20),
}).strict();

export const promptWizardPlanVariantSchema = z.enum(['reliable', 'hook']);

/** V5 保存生成时采用的方向快照，但不重复保存该方向的其他候选场景。 */
export const promptWizardPlanUseDirectionSchema = promptWizardUseDirectionBaseSchema
  .omit({ sceneOptions: true, recommendedSceneId: true })
  .strict();

export const promptWizardUseDirectionPlanContextSchema = z.object({
  planIndex: z.union([z.literal(0), z.literal(1)]),
  variant: promptWizardPlanVariantSchema,
  useDirection: promptWizardPlanUseDirectionSchema,
  selectedScene: promptWizardSelectedSceneSchema,
}).strict();

/** V5 直接扩写已选择的使用方向和场景，不再携带 Concept 或七轴策略。 */
export const promptWizardPlanV5Schema = promptWizardPlanCommonSchema
  .omit({ strategy: true })
  .extend({
    deliveryVersion: z.literal(5),
    variant: promptWizardPlanVariantSchema,
    useDirection: promptWizardPlanUseDirectionSchema,
    selectedScene: promptWizardSelectedSceneSchema,
    shots: z.array(promptWizardShotSchema).min(3).max(4),
    productionWarnings: z.array(promptWizardProductionWarningSchema).max(20),
  })
  .strict();

export const promptWizardRouteRoleSchema = z.enum([
  'proof-conversion',
  'problem-hook',
  'lifestyle-seeding',
]);

export const promptWizardClaimBasisSchema = z.enum([
  'visible',
  'user-confirmed',
  'category-inferred',
]);

/** 用户可见的事实来源标签；品类常识不能伪装成图片证据。 */
export const promptWizardClaimBasisTagSchema = z.object({
  labelZh: nonemptyStringSchema.max(300),
  basis: promptWizardClaimBasisSchema,
  evidenceRefs: z.array(nonemptyStringSchema.max(120)).max(12),
}).strict().superRefine((tag, context) => {
  if (tag.basis !== 'category-inferred' && tag.evidenceRefs.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidenceRefs'],
      message: '图片可见或用户确认标签必须引用证据',
    });
  }
  if (tag.basis === 'category-inferred' && tag.evidenceRefs.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidenceRefs'],
      message: 'AI 品类推测不能引用图片或用户确认的证据 id',
    });
  }
});

/** V6 内部三路线之一；前端不要求用户选择路线或场景。 */
export const promptWizardRouteV6Schema = z.object({
  id: uuidSchema,
  role: promptWizardRouteRoleSchema,
  titleZh: nonemptyStringSchema.max(80),
  directionExplanationZh: nonemptyStringSchema.max(500),
  audienceZh: nonemptyStringSchema.max(500),
  purchaseReasonZh: nonemptyStringSchema.max(500),
  hookZh: nonemptyStringSchema.max(300),
  proofActionZh: nonemptyStringSchema.max(500),
  recommendedScene: promptWizardSelectedSceneSchema,
  appearanceMode: promptWizardAppearanceModeSchema,
  claimBasisTags: z.array(promptWizardClaimBasisTagSchema).min(1).max(12),
  evidenceRefs: z.array(nonemptyStringSchema.max(120)).max(12),
  requiredAssets: z.array(nonemptyStringSchema.max(300)).max(20),
}).strict().superRefine((route, context) => {
  if (new Set(route.evidenceRefs).size !== route.evidenceRefs.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidenceRefs'],
      message: '路线引用的证据 id 必须唯一',
    });
  }
});

export const promptWizardRouteSetV6StatusSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
]);

const PROMPT_WIZARD_V6_ROLE_ORDER = [
  'proof-conversion',
  'problem-hook',
  'lifestyle-seeding',
] as const;

export const promptWizardRouteSetV6Schema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  status: promptWizardRouteSetV6StatusSchema,
  runRevision: nonnegativeIntegerSchema,
  routes: z.array(promptWizardRouteV6Schema).max(3),
  failureReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: nullableIsoDateTimeSchema,
}).strict().superRefine((routeSet, context) => {
  if (routeSet.status === 'completed') {
    if (routeSet.routes.length !== 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['routes'],
        message: '已完成的 V6 路线集合必须包含三个方向',
      });
    }
    const hasStableRoleOrder = PROMPT_WIZARD_V6_ROLE_ORDER.every((role, index) => (
      routeSet.routes[index]?.role === role
    ));
    if (!hasStableRoleOrder) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['routes'],
        message: 'V6 路线集合必须按产品自证、痛点钩子、场景种草的固定索引顺序交付',
      });
    }
    if (new Set(routeSet.routes.map(route => route.id)).size !== routeSet.routes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['routes'],
        message: 'V6 路线 id 必须唯一',
      });
    }
  } else if (routeSet.routes.length !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['routes'],
      message: '未完成的 V6 路线集合不能交付部分路线',
    });
  }
  if (routeSet.status === 'failed' && !routeSet.failureReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['failureReason'],
      message: '失败的 V6 路线集合必须包含失败原因',
    });
  }
  if (routeSet.status !== 'failed' && routeSet.failureReason !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['failureReason'],
      message: '只有失败的 V6 路线集合才能返回失败原因',
    });
  }
});

export const promptWizardRoutePlanContextV6Schema = z.object({
  planIndex: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  route: promptWizardRouteV6Schema,
}).strict();

/** V6 直接交付三个中文解释方案；prompt 只用于采用后写回工作台。 */
export const promptWizardPlanV6Schema = promptWizardPlanCommonSchema
  .omit({ hook: true, strategy: true })
  .extend({
    deliveryVersion: z.literal(6),
    audioMode: promptWizardAudioModeSchema,
    role: promptWizardRouteRoleSchema,
    directionExplanationZh: nonemptyStringSchema.max(500),
    audienceZh: nonemptyStringSchema.max(500),
    purchaseReasonZh: nonemptyStringSchema.max(500),
    hookZh: nonemptyStringSchema.max(300),
    claimBasisTags: z.array(promptWizardClaimBasisTagSchema).min(1).max(12),
    selectedScene: promptWizardSelectedSceneSchema,
    shots: z.array(promptWizardShotSchema).min(2).max(4),
    productionWarnings: z.array(promptWizardProductionWarningSchema).max(20),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.audioMode !== 'sound-design-only') return;
    for (const [shotIndex, shot] of plan.shots.entries()) {
      if (shot.voiceover !== '') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', shotIndex, 'voiceover'],
          message: '纯声音设计方案的分镜不能包含口播',
        });
      }
      if (shot.voiceoverZh !== '') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', shotIndex, 'voiceoverZh'],
          message: '纯声音设计方案的分镜不能包含中文口播翻译',
        });
      }
    }
  });

/** V4/V5 只为历史任务读取保留；所有新完成批次必须交付 V6。 */
export const promptWizardPlanSchema = z.union([
  promptWizardPlanV4Schema,
  promptWizardPlanV5Schema,
  promptWizardPlanV6Schema,
]);

export const promptWizardRunStatusSchema = z.enum(['analyzing', 'ready', 'failed', 'archived']);
export const promptWizardRunSchema = z.object({
  id: uuidSchema,
  /** 3 仅用于历史 V4/V5 读取；新任务固定为 4。 */
  engineVersion: z.union([z.literal(3), z.literal(4)]),
  status: promptWizardRunStatusSchema,
  revision: nonnegativeIntegerSchema,
  imageAssetIds: z.array(uuidSchema).min(1).max(9),
  productProfile: promptWizardProductProfileSchema.nullable(),
  creativeBrief: promptWizardRunCreativeBriefSchema.nullable(),
  videoConfig: promptWizardVideoConfigSchema.nullable(),
  productionBrief: promptWizardProductionBriefSchema.nullable().default(null),
  evidenceGraph: promptWizardEvidenceGraphSchema.nullable().default(null),
  failureReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

export const promptWizardBatchStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed']);
export const promptWizardCreditStatusSchema = z.enum(['none', 'held', 'settled', 'refunded']);
export const promptWizardBatchSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  status: promptWizardBatchStatusSchema,
  isFree: z.boolean(),
  credits: nonnegativeIntegerSchema,
  creditStatus: promptWizardCreditStatusSchema,
  plans: z.array(promptWizardPlanSchema).max(3),
  conceptSetId: uuidSchema.nullable().default(null),
  selectedConceptIds: z.array(uuidSchema).max(2).default([]),
  useDirectionSetId: uuidSchema.nullable().default(null),
  selectedUseDirectionId: uuidSchema.nullable().default(null),
  selectedSceneId: uuidSchema.nullable().default(null),
  customScene: promptWizardCustomSceneSchema.nullable().default(null),
  routeSetId: uuidSchema.nullable().default(null),
  failureReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: nullableIsoDateTimeSchema,
}).strict().superRefine((batch, context) => {
  const hasConceptSelection = batch.conceptSetId !== null || batch.selectedConceptIds.length > 0;
  const hasUseDirectionSelection = batch.useDirectionSetId !== null
    || batch.selectedUseDirectionId !== null
    || batch.selectedSceneId !== null
    || batch.customScene !== null;
  const hasRouteSet = batch.routeSetId !== null;

  if ([hasConceptSelection, hasUseDirectionSelection, hasRouteSet].filter(Boolean).length > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['useDirectionSetId'],
      message: '批次不能同时使用历史创意、V5 使用方向和 V6 三路线来源',
    });
  }

  if (
    hasConceptSelection
    && (
      !batch.conceptSetId
      || batch.selectedConceptIds.length !== 2
      || new Set(batch.selectedConceptIds).size !== 2
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['selectedConceptIds'],
      message: '历史批次必须关联两个不同的创意路线',
    });
  }

  if (hasUseDirectionSelection) {
    if (!batch.useDirectionSetId || !batch.selectedUseDirectionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selectedUseDirectionId'],
        message: '新版批次必须关联使用方向集合和选中的方向',
      });
    }
    if ((batch.selectedSceneId === null) === (batch.customScene === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selectedSceneId'],
        message: '新版批次必须在推荐场景和自定义场景之间选择一个',
      });
    }
  }

  if (batch.status !== 'completed') return;

  const deliveryVersions = new Set(batch.plans.map(plan => plan.deliveryVersion));
  if (deliveryVersions.size !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['plans'], message: '同一批次的方案版本必须一致' });
    return;
  }
  const [deliveryVersion] = deliveryVersions;
  const expectedPlanCount = deliveryVersion === 6 ? 3 : 2;
  if (batch.plans.length !== expectedPlanCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['plans'],
      message: deliveryVersion === 6
        ? '已完成的 V6 批次必须包含三个方案'
        : '历史 V4/V5 已完成批次必须包含两个方案',
    });
    return;
  }
  if (deliveryVersion === 4 && !hasConceptSelection) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['conceptSetId'], message: '历史 V4 批次必须关联创意路线集合' });
  }
  if (deliveryVersion === 5 && !hasUseDirectionSelection) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['useDirectionSetId'], message: 'V5 批次必须关联使用方向集合' });
  }
  if (deliveryVersion === 6) {
    if (!hasRouteSet) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['routeSetId'], message: 'V6 批次必须关联三路线集合' });
    }
    const hasStableRoleOrder = PROMPT_WIZARD_V6_ROLE_ORDER.every((role, index) => {
      const plan = batch.plans[index];
      return plan?.deliveryVersion === 6 && plan.role === role;
    });
    if (!hasStableRoleOrder) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plans'],
        message: 'V6 批次必须按产品自证、痛点钩子、场景种草的固定索引顺序交付',
      });
    }
  }
});

export const promptWizardSettingsSchema = z.object({
  generationCredits: nonnegativeIntegerSchema,
  available: z.boolean(),
  /** 滚动部署期间允许读取历史引擎 3；新建 V6 任务仍必须由引擎 4 门禁。 */
  engineVersion: z.union([z.literal(3), z.literal(4)]).default(4),
  updatedAt: isoDateTimeSchema,
}).strict();

export const promptWizardRefinementActionSchema = z.enum([
  'stronger-hook',
  'less-ad-like',
  'no-face',
  'product-only',
  'change-scene',
  'simplify-production',
  'natural-voiceover',
]);

export const promptWizardPlanRevisionStatusSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
]);

export const promptWizardPlanRevisionSchema = z.object({
  id: uuidSchema,
  batchId: uuidSchema,
  sourcePlanId: uuidSchema,
  conceptId: uuidSchema.nullable().default(null),
  useDirectionId: uuidSchema.nullable().default(null),
  planIndex: z.union([z.literal(0), z.literal(1)]),
  action: promptWizardRefinementActionSchema,
  status: promptWizardPlanRevisionStatusSchema,
  isFree: z.boolean(),
  plan: promptWizardPlanSchema.nullable(),
  failureReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: nullableIsoDateTimeSchema,
}).strict().superRefine((revision, context) => {
  if ((revision.conceptId === null) === (revision.useDirectionId === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['useDirectionId'],
      message: '定向微调必须且只能关联历史创意或新版使用方向之一',
    });
  }
  if (revision.status === 'completed' && !revision.plan) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['plan'], message: '已完成的定向微调必须包含方案' });
  }
  if (revision.status === 'failed' && !revision.failureReason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['failureReason'], message: '失败的定向微调必须包含失败原因' });
  }
  if (revision.plan?.deliveryVersion === 4 && !revision.conceptId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['conceptId'], message: 'V4 微调必须关联历史创意' });
  }
  if (revision.plan?.deliveryVersion === 5 && !revision.useDirectionId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['useDirectionId'], message: 'V5 微调必须关联使用方向' });
  }
});

export const promptWizardEditBucketSchema = z.enum(['none', 'minor', 'material']);
export const promptWizardSourceSchema = z.object({
  runId: uuidSchema,
  batchId: uuidSchema,
  planId: uuidSchema,
  planRevisionId: uuidSchema.optional(),
  /** 3 仅允许历史 V4/V5 来源；新 V6 来源必须写 4。 */
  engineVersion: z.union([z.literal(3), z.literal(4)]),
  editBucket: promptWizardEditBucketSchema,
}).strict();

// ── TK Prompt Engine 1.0 ─────────────────────────────────────────────────────
// 新引擎与历史 Prompt Wizard/V6 使用独立协议；schemaVersion 不映射旧
// engineVersion/deliveryVersion，避免新业务重新受固定三路线约束污染。
export const tkPromptSchemaVersionSchema = z.literal(1);
export const tkPromptPlanSlotSchema = z.enum(['safe', 'native', 'creative']);
export const tkPromptStyleFormSchema = z.enum(['drama', 'product', 'presenter', 'scene']);
export const tkPromptLanguageSchema = z.enum([
  '英语',
  '西班牙语',
  '葡萄牙语',
  '法语',
  '印尼语',
  '意大利语',
  '日语',
  '马来语',
  '泰语',
  '越南语',
  '普通话',
  '德语',
  '荷兰语',
  '波兰语',
]);
export const tkPromptStyleSchema = z.enum([
  'drama',
  'reversal',
  'interview',
  'story',
  'unboxing',
  'product_pov',
  'comparison',
  'talking_head',
  'pain_point',
  'scene',
]);
export const tkPromptHookPatternIdSchema = z.enum([
  'visual_shock',
  'suspense_question',
  'contrast',
  'pain_strike',
  'before_after',
  'sound_hook',
  'challenge_doubt',
  'identity',
  'number_benefit',
  'unexpected',
  'confession',
  'honest_flaw',
  'elimination_haul',
  'cost_math',
  'comment_reply',
  'hype_confirm',
]);
export const tkPromptFirstFrameIdSchema = z.enum([
  'macro_action',
  'pain_reveal',
  'pov_entry',
  'sound_sync',
  'structure_reveal',
  'question_setup',
  'unboxing_reveal',
  'scene_interrupt',
]);
export const tkPromptBuyingMotivationIdSchema = z.enum([
  'problem_relief',
  'ease_of_use',
  'confidence',
  'identity_fit',
  'curiosity',
  'value_clarity',
]);
export const tkPromptProofMethodIdSchema = z.enum([
  'visible_operation',
  'structure_closeup',
  'context_demo',
  'verified_comparison',
  'verified_before_after',
  'presenter_delivery',
]);
export const tkPromptFactIdSchema = z.string().regex(/^(?:visible|confirmed)-\d{3}$/u);
/** graphic_montage 不属于 Seedance 可执行模式，因此不进入类型边界。 */
export const tkPromptVideoModeSchema = z.enum([
  'product_closeup',
  'scene_demo',
  'live_presenter',
]);
export const tkPromptRunStatusSchema = z.enum(['analyzing', 'ready', 'failed', 'archived']);
export const tkPromptGenerationStatusSchema = z.enum([
  'queued',
  'strategizing',
  'expanding',
  'completed',
  'failed',
]);
export const tkPromptOptionStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed']);
export const tkPromptCreditStatusSchema = z.enum(['none', 'held', 'settled', 'refunded']);
export const tkPromptEditBucketSchema = z.enum(['none', 'minor', 'material']);

export const tkPromptVideoConfigSchema = z.object({
  model: promptWizardVideoModelSchema,
  aspectRatio: promptWizardAspectRatioSchema,
  resolution: promptWizardResolutionSchema,
  durationSeconds: promptWizardDurationSchema,
}).strict().superRefine((config, context) => {
  if (
    config.resolution === '1080p'
    && (config.model === 'seedance-2.0-fast' || config.model === 'seedance-2.0-mini')
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resolution'],
      message: 'Seedance Fast 和 Mini 不支持 1080p',
    });
  }
});

export const tkPromptProductIdentitySchema = z.object({
  name: nonemptyStringSchema.max(200),
  category: nonemptyStringSchema.max(200),
  confidence: z.enum(['high', 'medium', 'low']),
}).strict();

export const tkPromptVisibleFactSchema = z.object({
  factId: z.string().regex(/^visible-\d{3}$/u),
  text: nonemptyStringSchema.max(500),
  sourceImageAssetIds: z.array(uuidSchema).min(1).max(9),
  confidence: z.enum(['high', 'medium', 'low']),
}).strict();

export const tkPromptInferredContextSchema = z.object({
  contextId: nonemptyStringSchema.max(120),
  kind: z.enum(['audience', 'scenario', 'strategy-selection']),
  text: nonemptyStringSchema.max(500),
}).strict();

export const tkPromptDemonstrableActionSchema = z.object({
  actionId: z.string().regex(/^action-\d{3}$/u),
  text: nonemptyStringSchema.max(300),
  supportingFactIds: z.array(z.string().regex(/^visible-\d{3}$/u)).min(1).max(20),
  sourceImageAssetIds: z.array(uuidSchema).min(1).max(9),
}).strict();

export const tkPromptEvidenceProfileSchema = z.object({
  schemaVersion: tkPromptSchemaVersionSchema,
  productIdentity: tkPromptProductIdentitySchema,
  visibleFacts: z.array(tkPromptVisibleFactSchema).min(1).max(80),
  inferredContexts: z.array(tkPromptInferredContextSchema).max(40),
  demonstrableActions: z.array(tkPromptDemonstrableActionSchema).min(1).max(20),
  availableMaterials: z.array(nonemptyStringSchema.max(300)).max(20),
  forbiddenClaims: z.array(nonemptyStringSchema.max(300)).max(40),
}).strict().superRefine((profile, context) => {
  if (new Set(profile.visibleFacts.map(fact => fact.factId)).size !== profile.visibleFacts.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['visibleFacts'],
      message: '图片可见事实 ID 必须唯一',
    });
  }
  if (new Set(profile.inferredContexts.map(item => item.contextId)).size !== profile.inferredContexts.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['inferredContexts'],
      message: '内部推测 ID 必须唯一',
    });
  }
  const visibleFactById = new Map(profile.visibleFacts.map(fact => [fact.factId, fact] as const));
  profile.demonstrableActions.forEach((action, actionIndex) => {
    const expectedActionId = `action-${String(actionIndex + 1).padStart(3, '0')}`;
    if (action.actionId !== expectedActionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['demonstrableActions', actionIndex, 'actionId'],
        message: `可演示动作必须按顺序使用 ${expectedActionId}`,
      });
    }
    if (new Set(action.supportingFactIds).size !== action.supportingFactIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['demonstrableActions', actionIndex, 'supportingFactIds'],
        message: '可演示动作的支撑事实不能重复',
      });
    }
    const supportingFacts = action.supportingFactIds.flatMap(factId => {
      const fact = visibleFactById.get(factId);
      if (fact) return [fact];
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['demonstrableActions', actionIndex, 'supportingFactIds'],
        message: `可演示动作引用了未知图片事实 ${factId}`,
      });
      return [];
    });
    const expectedSourceIds = new Set(
      supportingFacts.flatMap(fact => fact.sourceImageAssetIds),
    );
    const actualSourceIds = new Set(action.sourceImageAssetIds);
    if (
      actualSourceIds.size !== action.sourceImageAssetIds.length
      || actualSourceIds.size !== expectedSourceIds.size
      || [...actualSourceIds].some(id => !expectedSourceIds.has(id))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['demonstrableActions', actionIndex, 'sourceImageAssetIds'],
        message: '可演示动作的来源图片必须与支撑事实精确闭合',
      });
    }
  });
});

/**
 * 客户端只能拒绝图片事实或补充用户确认事实，不能把任意文本伪装成 observed。
 */
export const tkPromptEvidenceReviewSchema = z.object({
  productName: nonemptyStringSchema.max(200),
  category: nonemptyStringSchema.max(200),
  rejectedVisibleFactIds: z.array(z.string().regex(/^visible-\d{3}$/u)).max(80),
  userConfirmedFacts: z.array(z.object({
    factId: z.string().regex(/^confirmed-\d{3}$/u),
    text: nonemptyStringSchema.max(500),
  }).strict()).max(40),
  forbiddenClaims: z.array(nonemptyStringSchema.max(300)).max(40),
}).strict().superRefine((review, context) => {
  if (new Set(review.rejectedVisibleFactIds).size !== review.rejectedVisibleFactIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rejectedVisibleFactIds'],
      message: '被拒绝事实 ID 不能重复',
    });
  }
  if (new Set(review.userConfirmedFacts.map(fact => fact.factId)).size !== review.userConfirmedFacts.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['userConfirmedFacts'],
      message: '用户确认事实 ID 必须唯一',
    });
  }
});

/** live_presenter 只表示由 Seedance 生成虚构非名人，不绑定真人演员库资产。 */
export const tkPromptAppearanceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('auto') }).strict(),
  z.object({ mode: z.literal('product_closeup') }).strict(),
  z.object({ mode: z.literal('scene_demo') }).strict(),
  z.object({ mode: z.literal('live_presenter') }).strict(),
]);

export const tkPromptCreativeInputSchema = z.object({
  targetMarket: nonemptyStringSchema.max(120),
  targetAudience: z.string().trim().max(500).default(''),
  spokenLanguage: tkPromptLanguageSchema.optional(),
  verifiedOffer: z.string().trim().max(300).default(''),
  appearance: tkPromptAppearanceSchema.default({ mode: 'auto' }),
  availableScenes: z.array(nonemptyStringSchema.max(300)).max(20).default([]),
  availableAssets: z.array(nonemptyStringSchema.max(300)).max(30).default([]),
}).strict();

const tkPromptStrategyCommonShape = {
  slot: tkPromptPlanSlotSchema,
  labelZh: nonemptyStringSchema.max(80),
  objective: z.enum(['conversion', 'trust', 'attention']),
  styleForm: tkPromptStyleFormSchema,
  style: tkPromptStyleSchema,
  hookPatternId: tkPromptHookPatternIdSchema,
  firstFrameId: tkPromptFirstFrameIdSchema,
  firstFrame: nonemptyStringSchema.max(500),
  openingAction: nonemptyStringSchema.max(500),
  openingLine: z.string().trim().max(500),
  relevanceBeat: nonemptyStringSchema.max(500),
  productBridge: nonemptyStringSchema.max(500),
  buyingMotivationId: tkPromptBuyingMotivationIdSchema,
  buyingMotivation: nonemptyStringSchema.max(500),
  proofMethodId: tkPromptProofMethodIdSchema,
  proofMethod: nonemptyStringSchema.max(500),
  ctaStrategy: nonemptyStringSchema.max(500),
  requiredMaterials: z.array(nonemptyStringSchema.max(300)).max(20),
  allowedFactIds: z.array(tkPromptFactIdSchema).min(1).max(80),
};

export const tkPromptStrategyBlueprintSchema = z.discriminatedUnion('videoMode', [
  z.object({
    ...tkPromptStrategyCommonShape,
    videoMode: z.literal('product_closeup'),
  }).strict(),
  z.object({
    ...tkPromptStrategyCommonShape,
    videoMode: z.literal('scene_demo'),
  }).strict(),
  z.object({
    ...tkPromptStrategyCommonShape,
    videoMode: z.literal('live_presenter'),
  }).strict(),
]);

export const tkPromptNarrativeBeatSchema = z.object({
  startSeconds: finiteNumberSchema.min(0).max(15),
  endSeconds: finiteNumberSchema.gt(0).max(15),
  environment: nonemptyStringSchema.max(500),
  subject: nonemptyStringSchema.max(500),
  action: nonemptyStringSchema.max(700),
  shotSize: nonemptyStringSchema.max(120),
  cameraMovement: nonemptyStringSchema.max(300),
  lighting: nonemptyStringSchema.max(300),
  editingCue: nonemptyStringSchema.max(300),
  soundDesign: nonemptyStringSchema.max(500),
  voiceoverTarget: z.string().trim().max(800),
  voiceoverZh: z.string().trim().max(800),
  factIds: z.array(tkPromptFactIdSchema).max(20),
}).strict().refine(beat => beat.endSeconds > beat.startSeconds, {
  path: ['endSeconds'],
  message: '分镜结束时间必须晚于开始时间',
});

export const tkPromptPlanSchema = z.object({
  schemaVersion: tkPromptSchemaVersionSchema,
  title: nonemptyStringSchema.max(120),
  whyItFits: nonemptyStringSchema.max(500),
  audioMode: promptWizardAudioModeSchema,
  executionPrompt: nonemptyStringSchema.max(3_800),
  beats: z.array(tkPromptNarrativeBeatSchema).min(1).max(6),
  factsUsed: z.array(tkPromptFactIdSchema).min(1).max(80),
  assumptions: z.array(nonemptyStringSchema.max(300)).max(20),
  requiredMaterials: z.array(nonemptyStringSchema.max(300)).max(20),
  warnings: z.array(nonemptyStringSchema.max(300)).max(20),
}).strict().superRefine((plan, context) => {
  if (plan.audioMode !== 'sound-design-only') return;
  for (const [index, beat] of plan.beats.entries()) {
    if (beat.voiceoverTarget !== '' || beat.voiceoverZh !== '') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beats', index, 'voiceoverTarget'],
        message: '纯声音设计方案不能包含口播或中文审核译文',
      });
    }
  }
});

export const tkPromptRunSchema = z.object({
  id: uuidSchema,
  schemaVersion: tkPromptSchemaVersionSchema,
  status: tkPromptRunStatusSchema,
  imageAssetIds: z.array(uuidSchema).max(9),
  evidenceProfile: tkPromptEvidenceProfileSchema.nullable(),
  failureReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: nullableIsoDateTimeSchema,
}).strict().superRefine((run, context) => {
  if (run.status === 'ready' && run.evidenceProfile === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['evidenceProfile'], message: '已就绪任务必须包含事实档案' });
  }
  if (run.status === 'failed' && !run.failureReason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['failureReason'], message: '失败任务必须包含失败原因' });
  }
});

export const tkPromptOptionSchema = z.object({
  id: uuidSchema,
  generationId: uuidSchema,
  slot: tkPromptPlanSlotSchema,
  status: tkPromptOptionStatusSchema,
  strategyBlueprint: tkPromptStrategyBlueprintSchema.nullable(),
  plan: tkPromptPlanSchema.nullable(),
  failureReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: nullableIsoDateTimeSchema,
}).strict().superRefine((option, context) => {
  if (option.status === 'completed' && option.plan === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['plan'], message: '已完成方案必须包含完整计划' });
  }
  if (option.status === 'failed' && !option.failureReason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['failureReason'], message: '失败方案必须包含失败原因' });
  }
  if (option.strategyBlueprint && option.strategyBlueprint.slot !== option.slot) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['strategyBlueprint', 'slot'], message: '策略槽位必须与方案槽位一致' });
  }
});

export const tkPromptGenerationSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  schemaVersion: tkPromptSchemaVersionSchema,
  status: tkPromptGenerationStatusSchema,
  /**
   * 恢复已完成批次时必须使用生成当时的确认与创作快照，不能回退到
   * AI Studio 当前控件或前端默认值，否则 tkPromptSource 会在提交时失配。
   */
  evidenceReview: tkPromptEvidenceReviewSchema,
  creativeInput: tkPromptCreativeInputSchema,
  videoConfig: tkPromptVideoConfigSchema,
  isFree: z.boolean(),
  credits: nonnegativeIntegerSchema,
  creditStatus: tkPromptCreditStatusSchema,
  strategySet: z.array(tkPromptStrategyBlueprintSchema).max(3),
  options: z.array(tkPromptOptionSchema).max(3),
  failureReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: nullableIsoDateTimeSchema,
}).strict().superRefine((generation, context) => {
  const slots = generation.options.map(option => option.slot);
  const strategySlots = generation.strategySet.map(strategy => strategy.slot);
  if (new Set(slots).size !== slots.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: '同一批次的方案槽位必须唯一' });
  }
  if (new Set(strategySlots).size !== strategySlots.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['strategySet'], message: '同一批次的策略槽位必须唯一' });
  }
  if (generation.strategySet.length === 3) {
    const diversityKeys = [
      'styleForm',
      'style',
      'hookPatternId',
      'firstFrameId',
      'buyingMotivationId',
      'proofMethodId',
    ] as const;
    for (let left = 0; left < generation.strategySet.length; left += 1) {
      for (let right = left + 1; right < generation.strategySet.length; right += 1) {
        const leftStrategy = generation.strategySet[left]!;
        const rightStrategy = generation.strategySet[right]!;
        const differences = diversityKeys.filter(
          key => leftStrategy[key] !== rightStrategy[key],
        ).length;
        if (differences < 4) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['strategySet', right],
            message: '任意两套策略必须在六个受控维度中至少四项不同',
          });
        }
      }
    }
  }
  if (generation.status === 'completed') {
    const expected = tkPromptPlanSlotSchema.options;
    if (
      generation.strategySet.length !== expected.length
      || expected.some(slot => !generation.strategySet.some(strategy => strategy.slot === slot))
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['strategySet'], message: '已完成批次必须包含三个策略蓝图' });
    }
    if (
      generation.options.length !== expected.length
      || expected.some(slot => !generation.options.some(option => option.slot === slot && option.status === 'completed'))
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: '已完成批次必须包含三个已完成方案' });
    }
  }
  if (generation.status === 'failed' && !generation.failureReason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['failureReason'], message: '失败批次必须包含失败原因' });
  }
});

export const tkPromptEngineSettingsSchema = z.object({
  schemaVersion: tkPromptSchemaVersionSchema,
  generationCredits: nonnegativeIntegerSchema,
  available: z.boolean(),
  updatedAt: isoDateTimeSchema,
}).strict();

export const tkPromptSourceSchema = z.object({
  runId: uuidSchema,
  generationId: uuidSchema,
  optionId: uuidSchema,
  schemaVersion: tkPromptSchemaVersionSchema,
  editBucket: tkPromptEditBucketSchema,
}).strict();

export const aiStudioVideoDraftSchema = z.object({
  prompt: nonemptyStringSchema.max(3_800),
  videoConfig: promptWizardVideoConfigSchema,
  referenceImageAssetIds: z.array(uuidSchema).min(1).max(9),
  /** 手动草稿和旧客户端可省略；向导应用的草稿必须由业务层写入来源。 */
  source: z.union([promptWizardSourceSchema, tkPromptSourceSchema]).optional(),
}).strict();

/** 新用户端详情只暴露可直接使用的短期 URL，不返回任何对象存储 key。 */
export const assetDetailReferenceSchema = z.object({
  id: uuidSchema,
  name: nonemptyStringSchema,
  type: assetTypeSchema,
  role: assetReferenceRoleSchema.optional(),
  previewUrl: httpUrlSchema.nullable(),
  durationSeconds: finiteNumberSchema.nonnegative().optional(),
  sizeBytes: nonnegativeIntegerSchema.optional(),
  width: positiveIntegerSchema.optional(),
  height: positiveIntegerSchema.optional(),
});

export const assetDetailGenerationConfigSchema = z.object({
  mode: z.enum(['general', 'first-last']).optional(),
  aspectRatio: z.string().optional(),
  resolution: z.string().optional(),
  durationSeconds: finiteNumberSchema.nonnegative().optional(),
  generateAudio: z.boolean().optional(),
  optimizePromptMode: seedreamOptimizePromptModeSchema.optional(),
  outputSize: z.string().optional(),
  ratio: z.string().optional(),
  annotations: z.array(seedreamAnnotationSchema).optional(),
  // 历史字段只读保留，但数组元素已去除 objectKey/thumbnailKey/publicUrl。
  referenceImages: z.array(assetDetailReferenceSchema).optional(),
  referenceAssets: z.array(assetDetailReferenceSchema).optional(),
  realPortrait: z.object({
    actorId: uuidSchema,
    portraitAssetId: uuidSchema,
  }).strict().optional(),
});

/** 任务响应与资产详情共用去对象 key 的安全配置；原始历史 JSON 只留在服务端。 */
export const generationConfigSchema = assetDetailGenerationConfigSchema;

export const assetDetailGenerationSchema = z.object({
  kind: generationKindSchema,
  model: nonemptyStringSchema,
  prompt: z.string(),
  credits: nonnegativeIntegerSchema.optional(),
  config: assetDetailGenerationConfigSchema.optional(),
  mode: z.enum(['general', 'first-last']).optional(),
  aspectRatio: z.string().optional(),
  resolution: z.string().optional(),
  durationSeconds: finiteNumberSchema.nonnegative().optional(),
  optimizePromptMode: seedreamOptimizePromptModeSchema.optional(),
  outputSize: z.string().optional(),
  ratio: z.string().optional(),
  annotations: z.array(seedreamAnnotationSchema).optional(),
  referenceImages: z.array(assetDetailReferenceSchema).optional(),
  referenceAssets: z.array(assetDetailReferenceSchema).optional(),
});

export const assetDetailSchema = z.object({
  id: uuidSchema,
  name: nonemptyStringSchema,
  type: assetTypeSchema,
  source: assetSourceSchema,
  folderId: uuidSchema.nullable(),
  publicUrl: httpUrlSchema,
  thumbnailUrl: httpUrlSchema.nullable(),
  sizeBytes: nonnegativeIntegerSchema,
  durationSeconds: finiteNumberSchema.nonnegative().nullable(),
  width: nonnegativeIntegerSchema.nullable(),
  height: nonnegativeIntegerSchema.nullable(),
  generation: assetDetailGenerationSchema.nullish(),
  views: nonnegativeIntegerSchema,
  downloadedAt: nullableIsoDateTimeSchema,
  downloadRequestedAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const assetCardSchema = z.object({
  id: uuidSchema,
  name: nonemptyStringSchema,
  type: assetTypeSchema,
  source: assetSourceSchema,
  folderId: uuidSchema.nullable(),
  previewUrl: httpUrlSchema.nullable(),
  sizeBytes: nonnegativeIntegerSchema,
  durationSeconds: finiteNumberSchema.nonnegative().nullable(),
  width: nonnegativeIntegerSchema.nullable(),
  height: nonnegativeIntegerSchema.nullable(),
  mediaExtension: z.string().trim().min(1).max(20).regex(/^[a-z0-9]+$/).nullable(),
  views: nonnegativeIntegerSchema,
  firstDownloadAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const assetCardPositionSchema = z.enum(['first', 'previous', 'next', 'last']);

export const assetCardSortSchema = z.enum(['created-desc', 'created-asc']);

export const assetCardPaginationSchema = z.object({
  position: assetCardPositionSchema,
}).merge(exactCursorPaginationSchema);

export const assetSummarySchema = z.object({
  total: nonnegativeIntegerSchema,
  byType: z.object({
    video: nonnegativeIntegerSchema,
    image: nonnegativeIntegerSchema,
    audio: nonnegativeIntegerSchema,
  }),
  bySource: z.object({
    'ai-video': nonnegativeIntegerSchema,
    'ai-image': nonnegativeIntegerSchema,
    'uploaded-video': nonnegativeIntegerSchema,
    'uploaded-image': nonnegativeIntegerSchema,
    'uploaded-audio': nonnegativeIntegerSchema,
  }),
  downloaded: nonnegativeIntegerSchema,
  notDownloaded: nonnegativeIntegerSchema,
  folderCounts: z.array(z.object({
    folderId: uuidSchema.nullable(),
    count: nonnegativeIntegerSchema,
  })),
});

export const assetFolderSchema = z.object({
  id: uuidSchema,
  name: nonemptyStringSchema,
  source: assetSourceSchema,
  isSystem: z.boolean(),
  createdAt: isoDateTimeSchema,
});

export const assetFolderContentActionSchema = z.enum(['move-to-root', 'delete-assets']);

export const assetFolderDeleteResultSchema = z.object({
  ok: z.literal(true),
  contentAction: assetFolderContentActionSchema,
  // 027 迁移产生的历史墓碑没有保存影响数量，因此幂等重放时允许 null。
  affectedAssetCount: nonnegativeIntegerSchema.nullable(),
});

export const uploadSessionStatusSchema = z.enum([
  'pending', 'processing', 'completed', 'failed', 'canceled', 'expired',
]);

export const uploadProcessingStageSchema = z.enum([
  'waiting-upload', 'queued', 'sealing', 'validating', 'probing',
  'thumbnailing', 'persisting', 'completed', 'failed', 'canceled', 'expired',
]);

export const uploadSessionSchema = z.object({
  id: uuidSchema,
  status: uploadSessionStatusSchema,
  processingStage: uploadProcessingStageSchema,
  progress: nonnegativeIntegerSchema.max(100),
  attempt: nonnegativeIntegerSchema,
  filename: nonemptyStringSchema,
  // 046 对无法可靠判型的历史会话只允许转 expired，不猜测来源。
  source: uploadAssetSourceSchema.nullable(),
  asset: assetCardSchema.nullable(),
  error: z.object({ code: nonemptyStringSchema, message: nonemptyStringSchema }).nullable(),
  canRetry: z.boolean(),
  expiresAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const orderSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  userName: z.string(),
  email: emailSchema,
  planId: uuidSchema.nullable(),
  kind: planKindSchema,
  planName: nonemptyStringSchema,
  amount: nonnegativeIntegerSchema,
  billing: orderBillingSchema,
  status: orderStatusSchema,
  invoiceStatus: invoiceStatusSchema,
  invoiceRequestStatus: invoiceRequestStatusSchema.nullable(),
  creditStatus: creditSettlementStatusSchema,
  creditAmount: nonnegativeIntegerSchema,
  creditBucket: creditBucketSchema,
  paymentMethod: z.string(),
  paymentMethodLabel: z.string(),
  paymentWayLabel: z.string(),
  paymentProvider: z.string(),
  paymentWayCode: z.string().nullable(),
  paymentSurface: paymentSurfaceSchema.nullable(),
  merchantOrderNo: z.string().nullable(),
  paymentOrderNo: z.string().nullable(),
  paymentError: z.string().nullable(),
  paymentAttemptStatus: paymentAttemptStatusSchema,
  paymentAttemptId: uuidSchema.nullable(),
  paymentAttemptError: z.string().nullable(),
  paymentRetryAfterMs: nonnegativeIntegerSchema.nullable(),
  paymentExpiresAt: nullableIsoDateTimeSchema,
  estimatedPlanResetAt: isoDateSchema.optional(),
  estimatedPlanExpiresAt: isoDateSchema.optional(),
  refundStatus: refundStatusSchema,
  merchantRefundNo: z.string().nullable(),
  refundOrderNo: z.string().nullable(),
  refundError: z.string().nullable(),
  refundAttemptStatus: refundAttemptStatusSchema.nullable(),
  refundAttemptId: uuidSchema.nullable(),
  refundManualReviewReason: z.string().nullable(),
  refundRetryAfterMs: nonnegativeIntegerSchema.nullable(),
  createdAt: isoDateTimeSchema,
  paidAt: nullableIsoDateTimeSchema,
  failedAt: nullableIsoDateTimeSchema,
  refundedAt: nullableIsoDateTimeSchema,
});

const paymentFormFieldSchema = z.object({
  name: z.string().trim().min(1).max(128),
  value: z.string().max(32_768),
});

export const paymentLaunchSchema = z.discriminatedUnion('type', [
  z.object({ surface: z.literal('mobile'), type: z.literal('url'), url: paymentUrlSchema }),
  z.object({
    surface: z.literal('mobile'),
    type: z.literal('form'),
    action: paymentUrlSchema,
    method: z.enum(['GET', 'POST']),
    fields: z.array(paymentFormFieldSchema).min(1).max(128),
  }),
  z.object({ surface: z.literal('pc'), type: z.literal('qr'), codeUrl: paymentUrlSchema }),
]);

export const paymentAttemptSchema = z.object({
  id: uuidSchema,
  attempt: nonnegativeIntegerSchema.positive(),
  status: paymentAttemptStatusSchema,
  launch: paymentLaunchSchema.nullable(),
  retryAfterMs: nonnegativeIntegerSchema.nullable(),
  error: z.string().nullable(),
  manualReviewReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

const ticketBaseSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  title: nonemptyStringSchema,
  userName: z.string(),
  email: emailSchema,
  priority: ticketPrioritySchema,
  status: ticketStatusSchema,
  assignee: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  slaHours: nonnegativeIntegerSchema,
  lastMessage: z.string(),
  unreadCount: nonnegativeIntegerSchema,
  messageCount: nonnegativeIntegerSchema,
  lastMessageAuthor: ticketAuthorRoleSchema,
  lastMessageAt: isoDateTimeSchema,
});

export const userTicketSchema = ticketBaseSchema;
export const adminTicketSchema = ticketBaseSchema.extend({
  internalNote: z.string().nullable(),
});

const ticketMessageBaseSchema = z.object({
  id: uuidSchema,
  ticketId: uuidSchema,
  authorRole: ticketAuthorRoleSchema,
  authorName: nonemptyStringSchema,
  body: nonemptyStringSchema,
  createdAt: isoDateTimeSchema,
});

export const userTicketMessageSchema = ticketMessageBaseSchema;
export const adminTicketMessageSchema = ticketMessageBaseSchema.extend({
  authorEmail: z.string(),
});

export const invoiceSchema = z.object({
  id: uuidSchema,
  orderId: uuidSchema,
  userId: uuidSchema,
  userName: z.string(),
  email: emailSchema,
  planName: nonemptyStringSchema,
  amount: nonnegativeIntegerSchema,
  invoiceTitle: nonemptyStringSchema,
  taxId: nonemptyStringSchema,
  receiveEmail: emailSchema,
  status: invoiceStatusSchema,
  note: z.string(),
  requestedAt: isoDateTimeSchema,
  issuedAt: nullableIsoDateTimeSchema,
});

export const consumptionSettingSchema = z.object({
  id: uuidSchema,
  kind: generationKindSchema,
  model: nonemptyStringSchema,
  modelLabel: nonemptyStringSchema,
  durationSeconds: nonnegativeIntegerSchema.nullable(),
  resolution: z.string(),
  credits: nonnegativeIntegerSchema,
  referenceVideoCredits: nonnegativeIntegerSchema.nullable(),
  available: z.boolean(),
  updatedAt: isoDateTimeSchema,
}).superRefine((setting, context) => {
  if (setting.kind === 'video' && setting.referenceVideoCredits === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['referenceVideoCredits'],
      message: '视频配置必须包含参考视频积分',
    });
  }
  if (setting.kind === 'image' && setting.referenceVideoCredits !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['referenceVideoCredits'],
      message: '图片配置不能包含参考视频积分',
    });
  }
});

const generationTaskCommonShape = {
  id: uuidSchema,
  kind: generationKindSchema,
  model: nonemptyStringSchema,
  status: generationStatusSchema,
  failureCategory: generationFailureCategorySchema.nullable(),
  failureReason: z.string().nullable(),
  prompt: z.string(),
  config: generationConfigSchema,
  credits: nonnegativeIntegerSchema,
  reservedCredits: nonnegativeIntegerSchema,
  settledCredits: nonnegativeIntegerSchema,
  refundedCredits: nonnegativeIntegerSchema,
  creditStatus: creditSettlementStatusSchema,
  mainCreditsUsed: nonnegativeIntegerSchema,
  addonCreditsUsed: nonnegativeIntegerSchema,
  assetId: uuidSchema.nullable(),
  retryCount: nonnegativeIntegerSchema,
  /** 负数表示由迁移推断的历史 attempt；新调用从 0 起。 */
  attempt: integerSchema,
  processingStage: z.string().nullable(),
  cancelState: z.string().optional(),
  cancelRequestedAt: nullableIsoDateTimeSchema.optional(),
  createdAt: isoDateTimeSchema,
  startedAt: nullableIsoDateTimeSchema,
  completedAt: nullableIsoDateTimeSchema,
} as const;

export const userGenerationTaskSchema = z.object({
  ...generationTaskCommonShape,
  config: z.object({
    mode: z.enum(['general', 'first-last']).optional(),
    aspectRatio: z.string().optional(),
    resolution: z.string().optional(),
    durationSeconds: finiteNumberSchema.nonnegative().optional(),
    generateAudio: z.boolean().optional(),
    optimizePromptMode: seedreamOptimizePromptModeSchema.optional(),
    outputSize: z.string().optional(),
    ratio: z.string().optional(),
    annotations: z.array(seedreamAnnotationSchema).optional(),
    referenceAssets: z.array(assetDetailReferenceSchema).optional(),
  }),
  assetName: z.string().nullable().optional(),
  assetSource: assetSourceSchema.nullable().optional(),
  updatedAt: isoDateTimeSchema.optional(),
});

/** 用户任务列表只携带排队与卡片展示字段；提示词和参考素材必须从详情按需读取。 */
export const userGenerationTaskCardSchema = userGenerationTaskSchema
  .omit({ prompt: true, config: true })
  .extend({
    config: z.object({
      aspectRatio: z.string().optional(),
      resolution: z.string().optional(),
      durationSeconds: finiteNumberSchema.nonnegative().optional(),
    }),
    /** 队列卡片使用的已签名缩略图地址；只在关联资产缩略图已就绪时返回。 */
    assetThumbnailUrl: httpUrlSchema.nullable().optional(),
    /** 关联生成素材仍处于活动状态；用户删除素材后为 false。 */
    assetAvailable: z.boolean().optional(),
  });

export const adminGenerationTaskSchema = z.object({
  ...generationTaskCommonShape,
  userId: uuidSchema,
  userName: z.string(),
  email: emailSchema,
  providerTaskId: z.string().nullable(),
  providerRunId: uuidSchema.nullable().optional(),
  providerRunStatus: z.string().nullable().optional(),
  claimEpoch: nonnegativeIntegerSchema.optional(),
  settlementError: z.string().nullable(),
  assetName: z.string().nullable(),
  assetSource: assetSourceSchema.nullable(),
  ledgerIds: z.array(uuidSchema),
  heartbeatAt: nullableIsoDateTimeSchema,
  leaseExpiresAt: nullableIsoDateTimeSchema,
  updatedAt: isoDateTimeSchema.optional(),
});

/** 后台任务列表只返回表格和操作判定需要的字段；提示词、配置、租约与流水由详情接口读取。 */
export const adminGenerationTaskCardSchema = adminGenerationTaskSchema.pick({
  id: true,
  userId: true,
  userName: true,
  email: true,
  kind: true,
  model: true,
  status: true,
  processingStage: true,
  failureCategory: true,
  creditStatus: true,
  assetId: true,
  assetName: true,
  assetSource: true,
  retryCount: true,
  providerRunId: true,
  providerRunStatus: true,
  createdAt: true,
});

/**
 * 生成任务可在同一 task id 上推进 attempt，因此用户账单只能读取这份随流水落库的
 * 不可变快照，不能再用 relatedJobId 反查任务当前状态。
 */
export interface GenerationCreditSnapshotDto {
  attempt: number;
  model: string;
  durationSeconds: number | null;
  resolution: string | null;
  hasReferenceVideo: boolean;
  reservedCredits: number;
  settledCredits: number;
  refundedCredits: number;
  taskStatus: z.infer<typeof generationStatusSchema>;
  creditStatus: z.infer<typeof creditSettlementStatusSchema>;
}

export const generationCreditSnapshotSchema: z.ZodType<GenerationCreditSnapshotDto> = z.object({
  attempt: nonnegativeIntegerSchema,
  model: z.string().min(1),
  durationSeconds: nonnegativeIntegerSchema.nullable(),
  resolution: z.string().min(1).nullable(),
  hasReferenceVideo: z.boolean(),
  reservedCredits: nonnegativeIntegerSchema,
  settledCredits: nonnegativeIntegerSchema,
  refundedCredits: nonnegativeIntegerSchema,
  taskStatus: generationStatusSchema,
  creditStatus: creditSettlementStatusSchema,
}).strict();

export interface UserCreditLedgerDto {
  id: string;
  type: z.infer<typeof creditTypeSchema>;
  bucket: z.infer<typeof creditBucketSchema>;
  settlementStatus: z.infer<typeof creditSettlementStatusSchema>;
  amount: number;
  balance: number;
  source: string;
  note: string;
  relatedOrderId: string | null;
  relatedJobId: string | null;
  relatedAssetId: string | null;
  generationSnapshot: GenerationCreditSnapshotDto | null;
  createdAt: string;
}

type UserCreditLedgerInput = Omit<UserCreditLedgerDto, 'generationSnapshot'> & {
  generationSnapshot?: GenerationCreditSnapshotDto | null | undefined;
};

export interface AdminCreditLedgerDto extends UserCreditLedgerDto {
  userId: string;
  userName: string;
  email: string;
  operator: string;
}

type AdminCreditLedgerInput = Omit<AdminCreditLedgerDto, 'generationSnapshot'> & {
  generationSnapshot?: GenerationCreditSnapshotDto | null | undefined;
};

const userCreditLedgerObjectSchema = z.object({
  id: uuidSchema,
  type: creditTypeSchema,
  bucket: creditBucketSchema,
  settlementStatus: creditSettlementStatusSchema,
  amount: finiteNumberSchema,
  balance: nonnegativeIntegerSchema,
  source: z.string(),
  note: z.string(),
  relatedOrderId: uuidSchema.nullable(),
  relatedJobId: uuidSchema.nullable(),
  relatedAssetId: uuidSchema.nullable(),
  // default(null) 兼容迁移前已持久化的后台幂等响应；新数据库行会始终显式返回快照或 null。
  generationSnapshot: generationCreditSnapshotSchema.nullable().default(null),
  createdAt: isoDateTimeSchema,
});

export const userCreditLedgerSchema: z.ZodType<
  UserCreditLedgerDto,
  z.ZodTypeDef,
  UserCreditLedgerInput
> = userCreditLedgerObjectSchema;

export const adminCreditLedgerSchema: z.ZodType<
  AdminCreditLedgerDto,
  z.ZodTypeDef,
  AdminCreditLedgerInput
> = userCreditLedgerObjectSchema.extend({
  userId: uuidSchema,
  userName: z.string(),
  email: emailSchema,
  operator: z.string(),
});

export const adminUserSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  userName: z.string(),
  role: accountRoleSchema,
  status: userStatusSchema,
  planId: uuidSchema.nullable(),
  planCode: z.string().nullable(),
  planName: z.string().nullable(),
  billingCycle: billingCycleSchema,
  mainCredits: nonnegativeIntegerSchema,
  addonCredits: nonnegativeIntegerSchema,
  credits: nonnegativeIntegerSchema,
  totalCredits: nonnegativeIntegerSchema,
  orderCount: nonnegativeIntegerSchema,
  ticketCount: nonnegativeIntegerSchema,
  apiCalls: nonnegativeIntegerSchema,
  planCycleStartedAt: isoDateSchema,
  planResetAt: nullableIsoDateSchema,
  planExpiresAt: nullableIsoDateSchema,
  activeSubscriptionOrderId: uuidSchema.nullable(),
  registeredAt: isoDateTimeSchema,
  lastActiveAt: nullableIsoDateTimeSchema,
});

export const adminAuditLogSchema = z.object({
  id: uuidSchema,
  adminUserId: uuidSchema.nullable(),
  adminEmail: z.string(),
  module: z.string(),
  action: z.string(),
  target: z.string(),
  risk: auditRiskSchema,
  ip: z.string().nullable(),
  detail: z.string(),
  createdAt: isoDateTimeSchema,
});

export const adminPaymentChannelSchema = z.object({
  enabled: z.boolean(),
  apiBase: z.string().max(500),
  mchNo: z.string().max(30),
  appId: z.string().max(24),
  hasApiKey: z.boolean(),
  desktopWayCode: z.literal('ALI_WAP'),
  mobileWayCode: z.literal('ALI_WAP'),
  updatedAt: nullableIsoDateTimeSchema,
});

export const dashboardSummarySchema = z.object({
  summary: z.object({
    totalGenerations: nonnegativeIntegerSchema,
    videoGenerations: nonnegativeIntegerSchema,
    imageGenerations: nonnegativeIntegerSchema,
  }),
  trend: z.array(z.object({
    day: isoDateSchema,
    videos: nonnegativeIntegerSchema,
    images: nonnegativeIntegerSchema,
  })),
  modelUsage: z.array(z.object({
    model: nonemptyStringSchema,
    count: nonnegativeIntegerSchema,
  })),
  recentProjects: z.array(z.object({
    id: uuidSchema,
    kind: generationKindSchema,
    model: nonemptyStringSchema,
    status: generationStatusSchema,
    assetId: uuidSchema.nullable(),
    assetName: nonemptyStringSchema.nullable(),
    previewUrl: httpUrlSchema.nullable(),
    createdAt: isoDateTimeSchema,
    completedAt: nullableIsoDateTimeSchema,
  })),
  timezone: nonemptyStringSchema,
});

export const adminOverviewSchema = z.object({
  totalUsers: nonnegativeIntegerSchema,
  todayNewUsers: nonnegativeIntegerSchema,
  monthNewUsers: nonnegativeIntegerSchema,
  totalRevenue: nonnegativeIntegerSchema,
  todayRevenue: nonnegativeIntegerSchema,
  monthRevenue: nonnegativeIntegerSchema,
  sevenDayRevenue: nonnegativeIntegerSchema,
  totalJobs: nonnegativeIntegerSchema,
  todayJobs: nonnegativeIntegerSchema,
  activeJobs: nonnegativeIntegerSchema,
  openTickets: nonnegativeIntegerSchema,
  pendingInvoices: nonnegativeIntegerSchema,
  sevenDayPaymentFailures: nonnegativeIntegerSchema,
  inactiveUsers: nonnegativeIntegerSchema,
  failedJobs: nonnegativeIntegerSchema,
  sevenDayApiRequests: nonnegativeIntegerSchema,
  sevenDayApiSuccesses: nonnegativeIntegerSchema,
  sevenDayApiSuccessRate: percentageIntegerSchema,
  revenueTrend: z.array(z.object({ day: isoDateSchema, revenue: nonnegativeIntegerSchema, orders: nonnegativeIntegerSchema })),
  modelUsage: z.array(z.object({ model: nonemptyStringSchema, billableTokens: nonnegativeIntegerSchema })),
  timezone: nonemptyStringSchema,
  dayStart: isoDateTimeSchema,
  monthStart: isoDateTimeSchema,
});

/** 管理员仪表盘只读取费用中心健康摘要，不加载完整成本审计报表。 */
export const adminApiCostHealthSchema = z.object({
  syncStatus: z.enum(['normal', 'warning', 'error']),
  lastSyncedAt: unavailableDateTimeSchema,
  matchState: apiCostMatchStateSchema,
  residualTokens: integerSchema.nullable(),
  residualCostCny: cnyAmountSchema.nullable(),
});

export const adminApiPackageSchema = z.object({
  id: uuidSchema,
  packageId: nonemptyStringSchema,
  product: z.string(),
  config: z.union([z.string(), jsonObjectSchema]),
  recognizedModel: nonemptyStringSchema,
  status: nonemptyStringSchema,
  totalQuota: nonnegativeIntegerSchema,
  remainingQuota: nonnegativeIntegerSchema,
  startsAt: unavailableDateTimeSchema,
  expiresAt: unavailableDateTimeSchema,
});

export const adminApiCostSyncItemSchema = z.object({
  kind: z.enum(['balance', 'bill', 'packages']),
  status: providerBillingFreshnessSchema,
  lastAttemptAt: unavailableDateTimeSchema,
  lastSuccessAt: unavailableDateTimeSchema,
  dataThrough: z.union([isoDateSchema, z.literal('-')]),
  reason: z.string().nullable(),
});

export const adminApiAccountBalanceSchema = z.object({
  provider: nonemptyStringSchema,
  currency: z.literal('CNY'),
  availableBalanceCny: cnyAmountSchema.nullable(),
  cashBalanceCny: cnyAmountSchema.nullable(),
  frozenAmountCny: cnyAmountSchema.nullable(),
  arrearsBalanceCny: cnyAmountSchema.nullable(),
  creditLimitCny: cnyAmountSchema.nullable(),
  syncedAt: unavailableDateTimeSchema,
  status: providerBillingFreshnessSchema,
});

export const adminApiCostSelectionSchema = z.object({
  range: apiCostRangeSchema,
  month: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  date: isoDateSchema.nullable(),
  rangeStart: isoDateSchema,
  rangeEnd: isoDateSchema,
  timezone: z.literal('Asia/Shanghai'),
  grain: apiCostTrendGrainSchema,
});

export const adminApiCostCoverageWindowSchema = z.object({
  start: isoDateSchema.nullable(),
  end: isoDateSchema.nullable(),
  status: apiCostCoverageStatusSchema,
  reason: z.string().nullable(),
});

export const adminApiCostCoverageSchema = z.object({
  local: adminApiCostCoverageWindowSchema,
  official: adminApiCostCoverageWindowSchema,
  comparable: adminApiCostCoverageWindowSchema,
  excludedPeriods: z.array(z.object({
    start: isoDateSchema,
    end: isoDateSchema,
    reason: nonemptyStringSchema,
  })),
});

export const adminApiCostCombinedStatusSchema = z.object({
  billState: apiCostBillStateSchema,
  matchState: apiCostMatchStateSchema,
  coverageState: apiCostCoverageStatusSchema,
  label: nonemptyStringSchema,
});

export const adminApiCostUsageBookSchema = z.object({
  /** 共同覆盖不可用时，正式对账账本整体为 null；成功同步的零行才返回 0。 */
  rawLocalTokens: nonnegativeIntegerSchema.nullable(),
  inferredAdjustmentTokens: integerSchema.nullable(),
  adjustedLocalTokens: nonnegativeIntegerSchema.nullable(),
  officialTokens: nonnegativeIntegerSchema.nullable(),
  rawTokenDelta: integerSchema.nullable(),
  explainedTokenDelta: integerSchema.nullable(),
  timingShiftTokens: integerSchema.nullable(),
  residualTokens: integerSchema.nullable(),
  rawCoveragePercent: finiteNumberSchema.nonnegative().max(100).nullable(),
  adjustedCoveragePercent: finiteNumberSchema.nonnegative().max(100).nullable(),
});

export const adminApiCostValuationBookSchema = z.object({
  localEstimateCompleteness: apiCostEstimateCompletenessSchema,
  officialEstimateCompleteness: apiCostEstimateCompletenessSchema,
  rawLocalCostCny: nonnegativeCnyAmountSchema.nullable(),
  inferredAdjustmentCostCny: cnyAmountSchema.nullable(),
  adjustedLocalCostCny: nonnegativeCnyAmountSchema.nullable(),
  officialListEquivalentCostCny: nonnegativeCnyAmountSchema.nullable(),
  rawCostDeltaCny: cnyAmountSchema.nullable(),
  explainedCostDeltaCny: cnyAmountSchema.nullable(),
  timingShiftCostCny: cnyAmountSchema.nullable(),
  /** 汇总层未完成逐桶拆分时返回 null，禁止把“未计算”伪装成零。 */
  rateVarianceCny: cnyAmountSchema.nullable(),
  roundingVarianceCny: cnyAmountSchema.nullable(),
  residualCostCny: cnyAmountSchema.nullable(),
});

export const adminApiCostSettlementBookSchema = z.object({
  rangeStart: isoDateSchema,
  rangeEnd: isoDateSchema,
  timezone: z.literal('Asia/Shanghai'),
  coverageStatus: apiCostCoverageStatusSchema,
  coverageReason: z.string().nullable(),
  usageOriginalAmountCny: cnyAmountSchema.nullable(),
  usagePayableAmountCny: cnyAmountSchema.nullable(),
  usagePaidAmountCny: cnyAmountSchema.nullable(),
  usageUnpaidAmountCny: cnyAmountSchema.nullable(),
  packagePurchaseAmountCny: cnyAmountSchema.nullable(),
  packagePurchasePaidAmountCny: cnyAmountSchema.nullable(),
  packagePurchaseUnpaidAmountCny: cnyAmountSchema.nullable(),
  paygPayableAmountCny: cnyAmountSchema.nullable(),
  listPriceOffsetValueCny: cnyAmountSchema.nullable(),
  listPriceOffsetStatus: z.enum(['priced', 'unpriced', 'unavailable']),
  refundAmountCny: cnyAmountSchema.nullable(),
  billingAdjustmentAmountCny: cnyAmountSchema.nullable(),
  netOfficialPayableCny: cnyAmountSchema.nullable(),
  openingPrepaidAssetCny: cnyAmountSchema.nullable(),
  acquisitionCostCny: cnyAmountSchema.nullable(),
  amortizedCostCny: cnyAmountSchema.nullable(),
  openingCatchUpCny: cnyAmountSchema.nullable(),
  expiryLossCny: cnyAmountSchema.nullable(),
  adjustmentCny: cnyAmountSchema.nullable(),
  endingPrepaidAssetCny: cnyAmountSchema.nullable(),
  allocationStatus: z.enum(['complete', 'partial', 'unavailable']),
  timeAttributionStatus: z.enum(['complete', 'partial', 'unavailable']),
  timeAttributionReason: z.string().nullable(),
});

export const adminApiCostCurrentStateSchema = z.object({
  capturedAt: isoDateTimeSchema,
  balanceSnapshotAt: unavailableDateTimeSchema,
  packageSnapshotAt: unavailableDateTimeSchema,
  historicalFilterAppliedToAccount: z.literal(false),
  historicalFilterAppliedToPackages: z.literal(false),
  historicalFilterAppliedToPricing: z.literal(false),
});

export const adminApiCostSummarySchema = z.object({
  rangeStart: isoDateSchema,
  rangeEnd: isoDateSchema,
  timezone: z.literal('Asia/Shanghai'),
  billStatus: providerBillStatusSchema,
  localBillableTokens: nonnegativeIntegerSchema.nullable(),
  localEstimatedCostCny: nonnegativeCnyAmountSchema.nullable(),
  localEstimateCompleteness: apiCostEstimateCompletenessSchema,
  localUnpricedAttempts: nonnegativeIntegerSchema.nullable(),
  localUnpricedTokens: nonnegativeIntegerSchema.nullable(),
  localUnavailableUsageAttempts: nonnegativeIntegerSchema.nullable(),
  officialBillableTokens: nonnegativeIntegerSchema.nullable(),
  officialUnpricedRows: nonnegativeIntegerSchema.nullable(),
  officialUnpricedTokens: nonnegativeIntegerSchema.nullable(),
  officialListEquivalentCostCny: nonnegativeCnyAmountSchema.nullable(),
  officialOriginalBillAmountCny: nonnegativeCnyAmountSchema.nullable(),
  officialPayableAmountCny: nonnegativeCnyAmountSchema.nullable(),
  officialPaidAmountCny: nonnegativeCnyAmountSchema.nullable(),
  officialUnpaidAmountCny: nonnegativeCnyAmountSchema.nullable(),
  officialDiscountAmountCny: nonnegativeCnyAmountSchema.nullable(),
  resourcePackageDeductedTokens: nonnegativeIntegerSchema.nullable(),
  todayEstimatedCostCny: nonnegativeCnyAmountSchema.nullable(),
  todayEstimateCompleteness: apiCostEstimateCompletenessSchema,
  todayUnpricedAttempts: nonnegativeIntegerSchema.nullable(),
  todayUnavailableUsageAttempts: nonnegativeIntegerSchema.nullable(),
  monthEstimatedCostCny: nonnegativeCnyAmountSchema.nullable(),
  monthEstimateCompleteness: apiCostEstimateCompletenessSchema,
  monthUnpricedAttempts: nonnegativeIntegerSchema.nullable(),
  monthUnavailableUsageAttempts: nonnegativeIntegerSchema.nullable(),
  tokenDelta: z.number().int().finite().nullable(),
  costDeltaCny: cnyAmountSchema.nullable(),
  localCostUnderstatementPercent: finiteNumberSchema.nullable(),
  allAccountOfficialDailyAverageCny: nonnegativeCnyAmountSchema.nullable(),
  seedanceOfficialDailyAverageCny: nonnegativeCnyAmountSchema.nullable(),
  seedanceListDailyAverageCny: nonnegativeCnyAmountSchema.nullable(),
  noPackageProjectedDailyCostCny: nonnegativeCnyAmountSchema.nullable(),
  noPackageRunwayDays: finiteNumberSchema.nonnegative().nullable(),
  noPackageProjectionCoveredDays: nonnegativeIntegerSchema.max(7),
  noPackageProjectionUnpricedRows: nonnegativeIntegerSchema,
  noPackageProjectionUnpricedTokens: nonnegativeIntegerSchema,
  noPackageProjectionStatus: z.enum(['complete', 'partial', 'unavailable', 'unpriced']),
});

export const adminApiCostModelSchema = z.object({
  id: nonemptyStringSchema,
  provider: nonemptyStringSchema,
  model: nonemptyStringSchema,
  billableTokens: nonnegativeIntegerSchema.nullable(),
  estimatedCostCny: nonnegativeCnyAmountSchema.nullable(),
  officialBillableTokens: nonnegativeIntegerSchema.nullable(),
  officialListEquivalentCostCny: nonnegativeCnyAmountSchema.nullable(),
  officialPayableAmountCny: nonnegativeCnyAmountSchema.nullable(),
  attemptCount: nonnegativeIntegerSchema.nullable(),
  taskCount: nonnegativeIntegerSchema.nullable(),
  successfulVideoCount: nonnegativeIntegerSchema.nullable(),
  successfulTasks: nonnegativeIntegerSchema.nullable(),
  failedTasks: nonnegativeIntegerSchema.nullable(),
  failedBillableTokens: nonnegativeIntegerSchema.nullable(),
  failedEstimatedCostCny: nonnegativeCnyAmountSchema.nullable(),
  averageSuccessfulTaskCostCny: nonnegativeCnyAmountSchema.nullable(),
  costPerSuccessfulVideoCny: nonnegativeCnyAmountSchema.nullable(),
  successfulOutputSeconds: finiteNumberSchema.nonnegative().nullable(),
  costPerOutputSecondCny: nonnegativeCnyAmountSchema.nullable(),
  costSharePercent: finiteNumberSchema.nonnegative().max(100).nullable(),
  withoutVideoCostCny: nonnegativeCnyAmountSchema.nullable(),
  withVideoCostCny: nonnegativeCnyAmountSchema.nullable(),
  unpricedTasks: nonnegativeIntegerSchema.nullable(),
  unavailableUsageAttempts: nonnegativeIntegerSchema.nullable(),
  estimateCompleteness: apiCostEstimateCompletenessSchema,
});

export const adminApiCostOperationsModelSchema = z.object({
  id: nonemptyStringSchema,
  model: nonemptyStringSchema,
  /** 周期内该模型所有任务 attempt 命中的非空价格版本，去重排序。 */
  priceVersions: z.array(nonemptyStringSchema),
  taskCount: nonnegativeIntegerSchema,
  /** 无业务任务/run/batch 的真实 Provider 运营调用数。 */
  operationalCallCount: nonnegativeIntegerSchema,
  settledCredits: nonnegativeIntegerSchema,
  heldCredits: nonnegativeIntegerSchema,
  refundedCredits: nonnegativeIntegerSchema,
  estimatedCostCny: nonnegativeCnyAmountSchema,
  /** 仅业务任务的列表价估算；不含运营调用。 */
  businessEstimatedCostCny: nonnegativeCnyAmountSchema,
  /** 仅运营调用的列表价估算。 */
  operationalEstimatedCostCny: nonnegativeCnyAmountSchema,
  /** 业务与运营调用的本地已知列表价之和。 */
  knownAccountCostCny: nonnegativeCnyAmountSchema,
  operationalUnpricedCallCount: nonnegativeIntegerSchema,
  estimateCompleteness: apiCostEstimateCompletenessSchema,
  incompleteTaskCount: nonnegativeIntegerSchema,
  averageTaskCostCny: nonnegativeCnyAmountSchema.nullable(),
});

export const adminApiCostOperationsSchema = z.object({
  taskCount: nonnegativeIntegerSchema,
  userCount: nonnegativeIntegerSchema,
  settledCredits: nonnegativeIntegerSchema,
  heldCredits: nonnegativeIntegerSchema,
  refundedCredits: nonnegativeIntegerSchema,
  estimatedCostCny: nonnegativeCnyAmountSchema,
  estimateCompleteness: apiCostEstimateCompletenessSchema,
  incompleteTaskCount: nonnegativeIntegerSchema,
  officialEquivalentCostCny: nonnegativeCnyAmountSchema.nullable(),
  differenceCny: cnyAmountSchema.nullable(),
  officialPayableCny: nonnegativeCnyAmountSchema.nullable(),
  reconciliationStatus: z.enum(['matched', 'matched-adjusted', 'incomplete', 'difference', 'unavailable']),
  models: z.array(adminApiCostOperationsModelSchema),
});

/** 主看盘把模型作为顶层表格数据返回，避免 operations 内重复携带。 */
export const adminApiCostOverviewOperationsSchema = adminApiCostOperationsSchema.omit({ models: true }).extend({
  /** 仅业务任务的官网列表价估算。 */
  businessEstimatedCostCny: nonnegativeCnyAmountSchema,
  /** 新运营账本与 legacy 后台直连合并后的调用数。 */
  operationalCallCount: nonnegativeIntegerSchema,
  /** 新运营账本与 legacy 后台直连合并后的已知列表价。 */
  operationalEstimatedCostCny: nonnegativeCnyAmountSchema,
  operationalUnpricedCallCount: nonnegativeIntegerSchema,
  /** 后台直连供应商且不归属于前端任务的用量条数。 */
  adminDirectUsageCount: nonnegativeIntegerSchema,
  /** 后台直连调用按官网按量价折算的成本。 */
  adminDirectEstimatedCostCny: nonnegativeCnyAmountSchema,
  /** 前端任务成本与后台直连成本之和，供账户级官方对账使用。 */
  knownAccountCostCny: nonnegativeCnyAmountSchema,
  /** 尚未建立零成本候选或缺少有效计价证据的任务数。 */
  unresolvedTaskCount: nonnegativeIntegerSchema,
  /** 账单尚未终结，已有结构化案件等待最终账单确认的任务数。 */
  pendingFinalBillTaskCount: nonnegativeIntegerSchema,
  /** 已由最终账单审计确认为零成本的任务数。 */
  approvedZeroCostTaskCount: nonnegativeIntegerSchema,
});

export const adminApiCostDailySchema = z.object({
  day: isoDateSchema,
  /** 覆盖范围内无记录为 0；覆盖范围外为 null。 */
  localBillableTokens: nonnegativeIntegerSchema.nullable(),
  /** partial 时仍返回已知成本小计，不代表完整成本。 */
  localEstimatedCostCny: nonnegativeCnyAmountSchema.nullable(),
  localUnpricedAttempts: nonnegativeIntegerSchema.nullable(),
  localUnavailableUsageAttempts: nonnegativeIntegerSchema.nullable(),
  localEstimateCompleteness: apiCostEstimateCompletenessSchema,
  officialBillableTokens: nonnegativeIntegerSchema.nullable(),
  officialListEquivalentCostCny: nonnegativeCnyAmountSchema.nullable(),
  officialPayableAmountCny: nonnegativeCnyAmountSchema.nullable(),
});

export const adminApiCostReconciliationBucketSchema = z.object({
  id: nonemptyStringSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  expenseDate: isoDateSchema.nullable(),
  billLineType: apiCostBillLineTypeSchema,
  model: nonemptyStringSchema,
  resolutionBand: apiCostPricingResolutionSchema,
  inputClass: apiCostInputClassSchema,
  unitPriceCnyPerMillion: nonnegativeCnyAmountSchema.nullable(),
  currency: z.literal('CNY'),
  rawLocalTokens: nonnegativeIntegerSchema,
  inferredAdjustmentTokens: integerSchema,
  adjustedLocalTokens: nonnegativeIntegerSchema,
  officialTokens: nonnegativeIntegerSchema,
  timingShiftTokens: integerSchema,
  residualTokens: integerSchema,
  rawLocalCostCny: nonnegativeCnyAmountSchema,
  inferredAdjustmentCostCny: cnyAmountSchema,
  adjustedLocalCostCny: nonnegativeCnyAmountSchema,
  officialListEquivalentCostCny: nonnegativeCnyAmountSchema,
  timingShiftCostCny: cnyAmountSchema,
  rateVarianceCny: cnyAmountSchema.nullable(),
  roundingVarianceCny: cnyAmountSchema.nullable(),
  residualCostCny: cnyAmountSchema,
  matchState: apiCostMatchStateSchema,
  attributionConfidence: apiCostAttributionConfidenceSchema,
});

export const adminApiCostReconciliationEvidenceSchema = z.object({
  id: nonemptyStringSchema,
  side: z.enum(['local', 'official', 'adjustment', 'zero-cost-candidate']),
  usageRecordId: uuidSchema.nullable(),
  billDetailRevisionId: uuidSchema.nullable(),
  taskId: uuidSchema.nullable(),
  providerTaskId: z.string().nullable(),
  sourceDetailKey: z.string().nullable(),
  allocatedTokens: integerSchema,
  allocatedCostCny: cnyAmountSchema,
  cause: z.string().nullable(),
  confidence: apiCostAttributionConfidenceSchema,
  evidence: jsonObjectSchema,
});

export const adminApiCostSettlementItemSchema = z.object({
  id: nonemptyStringSchema,
  sourceDetailKey: nonemptyStringSchema,
  billPeriod: z.string().regex(/^\d{4}-\d{2}$/),
  expenseDate: isoDateSchema,
  billLineType: apiCostBillLineTypeSchema,
  model: z.string().nullable(),
  instanceNo: z.string().nullable(),
  packageId: z.string().nullable(),
  originalAmountCny: cnyAmountSchema,
  preferentialAmountCny: cnyAmountSchema,
  discountAmountCny: cnyAmountSchema,
  couponAmountCny: cnyAmountSchema,
  payableAmountCny: cnyAmountSchema,
  paidAmountCny: cnyAmountSchema,
  unpaidAmountCny: cnyAmountSchema,
  currency: z.literal('CNY'),
  paymentStatus: apiCostPaymentStatusSchema,
  acquisitionLinkStatus: z.enum(['linked', 'missing', 'not-applicable']),
  isFinal: z.boolean(),
});

export const adminApiPricingRuleSchema = z.object({
  version: nonemptyStringSchema,
  effectiveFrom: isoDateTimeSchema,
  model: nonemptyStringSchema,
  resolution: apiCostPricingResolutionSchema,
  inputClass: apiCostInputClassSchema,
  unitPriceCnyPerMillion: nonnegativeCnyAmountSchema,
  platformAvailable: z.boolean(),
});

export const adminApiCostAttemptSchema = z.object({
  id: uuidSchema,
  taskId: uuidSchema.nullable(),
  origin: z.enum(['generation-task', 'admin-direct']),
  providerTaskId: z.string().nullable(),
  /** 历史回填使用负数 attempt，与未来供应商真实重试序号隔离。 */
  attempt: integerSchema,
  userId: uuidSchema.nullable(),
  userName: z.string(),
  email: z.string(),
  provider: nonemptyStringSchema,
  model: nonemptyStringSchema,
  resolution: apiCostResolutionSchema,
  inputClass: apiCostInputClassSchema,
  status: z.enum(['completed', 'failed', 'canceled']),
  completionTokens: nonnegativeIntegerSchema.nullable(),
  totalTokens: nonnegativeIntegerSchema.nullable(),
  billableTokens: nonnegativeIntegerSchema.nullable(),
  billableBasis: z.enum(['completion_tokens', 'raw_units_legacy', 'unavailable']),
  unitPriceCnyPerMillion: nonnegativeCnyAmountSchema.nullable(),
  estimatedCostCny: nonnegativeCnyAmountSchema.nullable(),
  pricingVersion: z.string().nullable(),
  estimateStatus: apiCostEstimateStatusSchema,
  usageEvidenceOrigin: apiCostUsageEvidenceOriginSchema,
  pricingRuleStatus: apiCostPricingRuleStatusSchema,
  reconciliationStatus: apiCostMatchStateSchema,
  attributionConfidence: apiCostAttributionConfidenceSchema,
  costResolutionStatus: z.enum(['recorded', 'pending-final-bill', 'approved-zero', 'unresolved']),
  costResolutionCaseId: uuidSchema.nullable(),
  /** 高级对账保留案件原始状态和证据，不把审计确认伪装成供应商回执。 */
  costResolutionCaseStatus: z.enum(['open', 'approved', 'superseded']).nullable(),
  costResolutionEvidence: jsonObjectSchema.nullable(),
  accountingDate: isoDateSchema,
  providerTerminalAt: unavailableDateTimeSchema,
  usageObservedAt: unavailableDateTimeSchema,
  createdAt: isoDateTimeSchema,
  completedAt: unavailableDateTimeSchema,
  error: z.string().nullable(),
});

export const adminApiCostTaskSchema = z.object({
  id: uuidSchema,
  taskId: uuidSchema,
  userId: uuidSchema.nullable(),
  userName: z.string(),
  email: z.string(),
  model: nonemptyStringSchema,
  /** 该任务全部供应商 attempt 命中的非空价格版本，去重排序。 */
  priceVersions: z.array(nonemptyStringSchema),
  status: generationStatusSchema,
  resolution: apiCostResolutionSchema,
  configuredCredits: nonnegativeIntegerSchema,
  reservedCredits: nonnegativeIntegerSchema,
  settledCredits: nonnegativeIntegerSchema,
  refundedCredits: nonnegativeIntegerSchema,
  creditStatus: creditSettlementStatusSchema,
  attemptCount: nonnegativeIntegerSchema,
  billableTokens: nonnegativeIntegerSchema,
  estimatedCostCny: nonnegativeCnyAmountSchema,
  estimateCompleteness: apiCostEstimateCompletenessSchema,
  costFinalized: z.boolean(),
  costResolutionStatus: z.enum(['recorded', 'pending-final-bill', 'approved-zero', 'unresolved']),
  costResolutionCaseId: uuidSchema.nullable(),
  missingUsageAttempts: nonnegativeIntegerSchema,
  unpricedAttempts: nonnegativeIntegerSchema,
  createdAt: isoDateTimeSchema,
  completedAt: unavailableDateTimeSchema,
});

export const adminApiCostUserSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema.nullable(),
  name: z.string(),
  email: z.string(),
  taskCount: nonnegativeIntegerSchema,
  operationalCallCount: nonnegativeIntegerSchema,
  successfulTasks: nonnegativeIntegerSchema,
  failedTasks: nonnegativeIntegerSchema,
  canceledTasks: nonnegativeIntegerSchema,
  settledCredits: nonnegativeIntegerSchema,
  refundedCredits: nonnegativeIntegerSchema,
  billableTokens: nonnegativeIntegerSchema,
  estimatedCostCny: nonnegativeCnyAmountSchema,
  businessEstimatedCostCny: nonnegativeCnyAmountSchema,
  operationalEstimatedCostCny: nonnegativeCnyAmountSchema,
  knownAccountCostCny: nonnegativeCnyAmountSchema,
  operationalUnpricedCallCount: nonnegativeIntegerSchema,
  estimateCompleteness: apiCostEstimateCompletenessSchema,
  incompleteTaskCount: nonnegativeIntegerSchema,
  averageTaskCostCny: nonnegativeCnyAmountSchema.nullable(),
  lastTaskAt: unavailableDateTimeSchema,
  lastActivityAt: isoDateTimeSchema,
});

/**
 * 多模态模型成本只表达本地逐请求账本与历史聚合证据，不与 Seedance 官方账单
 * 对账口径混用。known* 字段是已知小计；partial 时不能视为完整成本。
 */
export const adminMultimodalCostUsageEvidenceSchema = z.enum([
  'ledger',
  'ledger-reconciled',
  'historical',
  'historical-aggregate-priced',
  'unavailable',
]);

export const adminMultimodalCostPricingSourceSchema = z.object({
  priceVersion: nonemptyStringSchema,
  sourceUrl: httpUrlSchema,
});

export const adminMultimodalCostOperationTypeSchema = z.enum(['analysis', 'plan-batch']);
export const adminMultimodalCostOperationStatusSchema = z.enum([
  'analyzing',
  'ready',
  'queued',
  'processing',
  'completed',
  'failed',
  'archived',
]);

const adminMultimodalCostUsageSummaryShape = {
  knownInputTokens: nonnegativeIntegerSchema.nullable(),
  knownCachedInputTokens: nonnegativeIntegerSchema.nullable(),
  knownOutputTokens: nonnegativeIntegerSchema.nullable(),
  knownCostCny: nonnegativeCnyAmountSchema.nullable(),
  providerRequestCount: nonnegativeIntegerSchema,
  reconciledZeroRequestCount: nonnegativeIntegerSchema,
  unknownUsageRequestCount: nonnegativeIntegerSchema,
  unpricedRequestCount: nonnegativeIntegerSchema,
  estimateCompleteness: apiCostEstimateCompletenessSchema,
};

export const adminMultimodalCostSummarySchema = z.object({
  analysisCount: nonnegativeIntegerSchema,
  batchCount: nonnegativeIntegerSchema,
  userCount: nonnegativeIntegerSchema,
  settledCredits: nonnegativeIntegerSchema,
  refundedCredits: nonnegativeIntegerSchema,
  incompleteOperationCount: nonnegativeIntegerSchema,
  historicalEvidenceOperationCount: nonnegativeIntegerSchema,
  historicalPricedOperationCount: nonnegativeIntegerSchema.optional().default(0),
  operationalCallCount: nonnegativeIntegerSchema,
  operationalUnpricedCallCount: nonnegativeIntegerSchema,
  businessEstimatedCostCny: nonnegativeCnyAmountSchema,
  operationalEstimatedCostCny: nonnegativeCnyAmountSchema,
  knownAccountCostCny: nonnegativeCnyAmountSchema,
  ...adminMultimodalCostUsageSummaryShape,
});

export const adminMultimodalCostModelSchema = z.object({
  id: nonemptyStringSchema,
  provider: nonemptyStringSchema,
  model: nonemptyStringSchema,
  analysisCount: nonnegativeIntegerSchema,
  batchCount: nonnegativeIntegerSchema,
  userCount: nonnegativeIntegerSchema,
  settledCredits: nonnegativeIntegerSchema,
  refundedCredits: nonnegativeIntegerSchema,
  incompleteOperationCount: nonnegativeIntegerSchema,
  historicalEvidenceOperationCount: nonnegativeIntegerSchema,
  historicalPricedOperationCount: nonnegativeIntegerSchema.optional().default(0),
  operationalCallCount: nonnegativeIntegerSchema,
  operationalUnpricedCallCount: nonnegativeIntegerSchema,
  businessEstimatedCostCny: nonnegativeCnyAmountSchema,
  operationalEstimatedCostCny: nonnegativeCnyAmountSchema,
  knownAccountCostCny: nonnegativeCnyAmountSchema,
  pricingSources: z.array(adminMultimodalCostPricingSourceSchema),
  ...adminMultimodalCostUsageSummaryShape,
});

export const adminMultimodalCostOperationSchema = z.object({
  id: uuidSchema,
  operationType: adminMultimodalCostOperationTypeSchema,
  runId: uuidSchema,
  batchId: uuidSchema.nullable(),
  userId: uuidSchema,
  userName: z.string(),
  email: z.string(),
  provider: nonemptyStringSchema,
  model: nonemptyStringSchema,
  status: adminMultimodalCostOperationStatusSchema,
  isFree: z.boolean().nullable(),
  settledCredits: nonnegativeIntegerSchema,
  refundedCredits: nonnegativeIntegerSchema,
  incompleteRequestCount: nonnegativeIntegerSchema,
  usageEvidence: adminMultimodalCostUsageEvidenceSchema,
  priceVersion: nonemptyStringSchema.nullable().optional().default(null),
  pricingSourceUrl: httpUrlSchema.nullable().optional().default(null),
  failureReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: nullableIsoDateTimeSchema,
  ...adminMultimodalCostUsageSummaryShape,
});

export const adminMultimodalCostUserSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  name: z.string(),
  email: z.string(),
  models: z.array(nonemptyStringSchema),
  analysisCount: nonnegativeIntegerSchema,
  batchCount: nonnegativeIntegerSchema,
  settledCredits: nonnegativeIntegerSchema,
  refundedCredits: nonnegativeIntegerSchema,
  incompleteOperationCount: nonnegativeIntegerSchema,
  historicalEvidenceOperationCount: nonnegativeIntegerSchema,
  historicalPricedOperationCount: nonnegativeIntegerSchema.optional().default(0),
  operationalCallCount: nonnegativeIntegerSchema,
  operationalUnpricedCallCount: nonnegativeIntegerSchema,
  businessEstimatedCostCny: nonnegativeCnyAmountSchema,
  operationalEstimatedCostCny: nonnegativeCnyAmountSchema,
  knownAccountCostCny: nonnegativeCnyAmountSchema,
  lastActivityAt: isoDateTimeSchema,
  ...adminMultimodalCostUsageSummaryShape,
});

/**
 * Seedream 图片成本是独立的官网列表价估算账本。金额为空表示缺少不可变证据，
 * 不能把它归零，也不能套用 Seedance Token 定价规则补算。
 */
export const adminImageCostEvidenceStatusSchema = z.enum(['known', 'missing-evidence']);
export const adminImageRequestEvidenceStatusSchema = z.enum(['provider-id', 'local-only', 'missing']);

export const adminImageCostSummarySchema = z.object({
  taskCount: nonnegativeIntegerSchema,
  userCount: nonnegativeIntegerSchema,
  completedTaskCount: nonnegativeIntegerSchema,
  failedTaskCount: nonnegativeIntegerSchema,
  canceledTaskCount: nonnegativeIntegerSchema,
  settledCredits: nonnegativeIntegerSchema,
  heldCredits: nonnegativeIntegerSchema,
  refundedCredits: nonnegativeIntegerSchema,
  referenceImageCount: nonnegativeIntegerSchema,
  outputPixels: nonnegativeIntegerSchema,
  knownCostTaskCount: nonnegativeIntegerSchema,
  missingEvidenceTaskCount: nonnegativeIntegerSchema,
  knownCostCny: nonnegativeCnyAmountSchema.nullable(),
  operationalCallCount: nonnegativeIntegerSchema,
  operationalUnpricedCallCount: nonnegativeIntegerSchema,
  businessEstimatedCostCny: nonnegativeCnyAmountSchema,
  operationalEstimatedCostCny: nonnegativeCnyAmountSchema,
  knownAccountCostCny: nonnegativeCnyAmountSchema,
  estimateCompleteness: apiCostEstimateCompletenessSchema,
}).superRefine((value, context) => {
  if (value.knownCostTaskCount === 0 && value.knownCostCny !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['knownCostCny'], message: '没有已知价格证据时成本必须为 null' });
  }
  if (value.knownCostTaskCount > 0 && value.knownCostCny === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['knownCostCny'], message: '存在已知价格证据时必须返回已知成本小计' });
  }
});

export const adminImageCostPricingSchema = z.object({
  model: z.literal('Seedream 5.0 Pro'),
  modelId: z.literal('doubao-seedream-5-0-pro-260628'),
  currency: z.literal('CNY'),
  firstReferenceImageIncluded: z.literal(1),
  additionalReferenceUnitPriceCny: nonnegativeCnyAmountSchema,
  outputPixelThreshold: nonnegativeIntegerSchema,
  smallOutputPriceCny: nonnegativeCnyAmountSchema,
  largeOutputPriceCny: nonnegativeCnyAmountSchema,
  priceVersion: nonemptyStringSchema,
  pricingSourceUrl: httpUrlSchema,
  disclaimer: nonemptyStringSchema,
});

export const adminImageCostTaskSchema = z.object({
  id: uuidSchema,
  taskId: uuidSchema,
  userId: uuidSchema,
  userName: z.string(),
  email: z.string(),
  model: nonemptyStringSchema,
  status: generationStatusSchema,
  creditStatus: creditSettlementStatusSchema,
  reservedCredits: nonnegativeIntegerSchema,
  settledCredits: nonnegativeIntegerSchema,
  refundedCredits: nonnegativeIntegerSchema,
  attemptCount: nonnegativeIntegerSchema,
  knownUsageCount: nonnegativeIntegerSchema,
  missingUsageCount: nonnegativeIntegerSchema,
  evidenceStatus: adminImageCostEvidenceStatusSchema,
  referenceImageCount: nonnegativeIntegerSchema.nullable(),
  additionalReferenceImageCount: nonnegativeIntegerSchema.nullable(),
  outputWidth: nonnegativeIntegerSchema.nullable(),
  outputHeight: nonnegativeIntegerSchema.nullable(),
  outputPixels: nonnegativeIntegerSchema.nullable(),
  outputTier: z.enum(['small', 'large']).nullable(),
  referenceUnitPriceCny: nonnegativeCnyAmountSchema.nullable(),
  referencePriceCny: nonnegativeCnyAmountSchema.nullable(),
  outputPixelThreshold: nonnegativeIntegerSchema.nullable(),
  smallOutputPriceCny: nonnegativeCnyAmountSchema.nullable(),
  largeOutputPriceCny: nonnegativeCnyAmountSchema.nullable(),
  outputPriceCny: nonnegativeCnyAmountSchema.nullable(),
  estimatedCostCny: nonnegativeCnyAmountSchema.nullable(),
  pricingStatus: z.enum(['priced', 'missing-evidence']).nullable(),
  priceVersion: nonemptyStringSchema.nullable(),
  pricingSourceUrl: httpUrlSchema.nullable(),
  providerOperationId: z.string().nullable(),
  providerRequestId: z.string().nullable(),
  requestEvidenceStatus: adminImageRequestEvidenceStatusSchema,
  generatedImages: nonnegativeIntegerSchema.nullable(),
  outputTokens: nonnegativeIntegerSchema.nullable(),
  totalTokens: nonnegativeIntegerSchema.nullable(),
  error: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: nullableIsoDateTimeSchema,
}).superRefine((value, context) => {
  const costFields = [value.referencePriceCny, value.outputPriceCny, value.estimatedCostCny];
  if (value.knownUsageCount === 0 && costFields.some(field => field !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['estimatedCostCny'], message: '没有已知 run 证据时成本字段必须为 null' });
  }
  if (value.knownUsageCount > 0 && value.estimatedCostCny === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['estimatedCostCny'], message: '存在已知 run 证据时必须返回已知成本小计' });
  }
});

export const adminImageCostUserSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  userName: z.string(),
  email: z.string(),
  taskCount: nonnegativeIntegerSchema,
  completedTaskCount: nonnegativeIntegerSchema,
  failedTaskCount: nonnegativeIntegerSchema,
  settledCredits: nonnegativeIntegerSchema,
  refundedCredits: nonnegativeIntegerSchema,
  referenceImageCount: nonnegativeIntegerSchema,
  outputPixels: nonnegativeIntegerSchema,
  knownCostTaskCount: nonnegativeIntegerSchema,
  missingEvidenceTaskCount: nonnegativeIntegerSchema,
  knownCostCny: nonnegativeCnyAmountSchema.nullable(),
  operationalCallCount: nonnegativeIntegerSchema,
  operationalUnpricedCallCount: nonnegativeIntegerSchema,
  businessEstimatedCostCny: nonnegativeCnyAmountSchema,
  operationalEstimatedCostCny: nonnegativeCnyAmountSchema,
  knownAccountCostCny: nonnegativeCnyAmountSchema,
  estimateCompleteness: apiCostEstimateCompletenessSchema,
  lastTaskAt: isoDateTimeSchema,
  lastActivityAt: isoDateTimeSchema,
}).superRefine((value, context) => {
  if (value.knownCostTaskCount === 0 && value.knownCostCny !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['knownCostCny'], message: '没有已知价格证据时成本必须为 null' });
  }
  if (value.knownCostTaskCount > 0 && value.knownCostCny === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['knownCostCny'], message: '存在已知价格证据时必须返回已知成本小计' });
  }
});

export type UserProfileDto = z.infer<typeof userProfileSchema>;
export type RealPortraitActorDto = z.infer<typeof realPortraitActorSchema>;
export type RealPortraitCapacityDto = z.infer<typeof realPortraitCapacitySchema>;
export type AdminRealPortraitCapacityDto = z.infer<typeof adminRealPortraitCapacitySchema>;
export type PublicPlanDto = z.infer<typeof publicPlanSchema>;
export type AdminPlanDto = z.infer<typeof adminPlanSchema>;
export type PublicAnnouncementDto = z.infer<typeof publicAnnouncementSchema>;
export type AdminAnnouncementDto = z.infer<typeof adminAnnouncementSchema>;
export type FeatureFlagsDto = z.infer<typeof featureFlagsSchema>;
export type AssetDetailDto = z.infer<typeof assetDetailSchema>;
export type AssetCardDto = z.infer<typeof assetCardSchema>;
export type AssetCardSort = z.infer<typeof assetCardSortSchema>;
export type AssetSummaryDto = z.infer<typeof assetSummarySchema>;
export type AssetFolderDto = z.infer<typeof assetFolderSchema>;
export type AssetFolderContentAction = z.infer<typeof assetFolderContentActionSchema>;
export type AssetFolderDeleteResultDto = z.infer<typeof assetFolderDeleteResultSchema>;
export type OrderDto = z.infer<typeof orderSchema>;
export type PaymentLaunchDto = z.infer<typeof paymentLaunchSchema>;
export type UserTicketDto = z.infer<typeof userTicketSchema>;
export type AdminTicketDto = z.infer<typeof adminTicketSchema>;
export type UserTicketMessageDto = z.infer<typeof userTicketMessageSchema>;
export type AdminTicketMessageDto = z.infer<typeof adminTicketMessageSchema>;
export type InvoiceDto = z.infer<typeof invoiceSchema>;
export type ConsumptionSettingDto = z.infer<typeof consumptionSettingSchema>;
export type PromptWizardProductProfile = z.infer<typeof promptWizardProductProfileSchema>;
export type PromptWizardCreativeBrief = z.infer<typeof promptWizardCreativeBriefSchema>;
export type PromptWizardAudioMode = z.infer<typeof promptWizardAudioModeSchema>;
export type PromptWizardCreativeBriefV6 = z.infer<typeof promptWizardCreativeBriefV6Schema>;
export type PromptWizardRunCreativeBrief = z.infer<typeof promptWizardRunCreativeBriefSchema>;
export type PromptWizardVideoConfig = z.infer<typeof promptWizardVideoConfigSchema>;
export type PromptWizardProductFamily = z.infer<typeof promptWizardProductFamilySchema>;
export type PromptWizardEvidenceType = z.infer<typeof promptWizardEvidenceTypeSchema>;
export type PromptWizardEvidenceStatus = z.infer<typeof promptWizardEvidenceStatusSchema>;
export type PromptWizardEvidenceConfidence = z.infer<typeof promptWizardEvidenceConfidenceSchema>;
export type PromptWizardDirectionAvailability = z.infer<typeof promptWizardDirectionAvailabilitySchema>;
export type PromptWizardDirectionAssessment = z.infer<typeof promptWizardDirectionAssessmentSchema>;
export type PromptWizardEvidence = z.infer<typeof promptWizardEvidenceSchema>;
export type PromptWizardEvidenceGraph = z.infer<typeof promptWizardEvidenceGraphSchema>;
export type PromptWizardAppearanceMode = z.infer<typeof promptWizardAppearanceModeSchema>;
export type PromptWizardProductionBrief = z.infer<typeof promptWizardProductionBriefSchema>;
export type PromptWizardConceptRole = z.infer<typeof promptWizardConceptRoleSchema>;
export type PromptWizardProductionDifficulty = z.infer<typeof promptWizardProductionDifficultySchema>;
export type PromptWizardConceptRisk = z.infer<typeof promptWizardConceptRiskSchema>;
export type PromptWizardProductionLoad = z.infer<typeof promptWizardProductionLoadSchema>;
export type PromptWizardConceptPreview = z.infer<typeof promptWizardConceptPreviewSchema>;
export type PromptWizardConceptSetStatus = z.infer<typeof promptWizardConceptSetStatusSchema>;
export type PromptWizardConceptSet = z.infer<typeof promptWizardConceptSetSchema>;
export type PromptWizardSceneOption = z.infer<typeof promptWizardSceneOptionSchema>;
export type PromptWizardCustomScene = z.infer<typeof promptWizardCustomSceneSchema>;
export type PromptWizardSelectedScene = z.infer<typeof promptWizardSelectedSceneSchema>;
export type PromptWizardUseDirection = z.infer<typeof promptWizardUseDirectionSchema>;
export type PromptWizardUseDirectionSetStatus = z.infer<typeof promptWizardUseDirectionSetStatusSchema>;
export type PromptWizardUseDirectionSet = z.infer<typeof promptWizardUseDirectionSetSchema>;
export type PromptWizardPlanningReview = z.infer<typeof promptWizardPlanningReviewSchema>;
export type PromptWizardShotRole = z.infer<typeof promptWizardShotRoleSchema>;
export type PromptWizardShot = z.infer<typeof promptWizardShotSchema>;
export type PromptWizardProductionWarning = z.infer<typeof promptWizardProductionWarningSchema>;
export type PromptWizardPlanConcept = z.infer<typeof promptWizardPlanConceptSchema>;
export type PromptWizardPlanV4 = z.infer<typeof promptWizardPlanV4Schema>;
export type PromptWizardPlanVariant = z.infer<typeof promptWizardPlanVariantSchema>;
export type PromptWizardPlanUseDirection = z.infer<typeof promptWizardPlanUseDirectionSchema>;
export type PromptWizardUseDirectionPlanContext = z.infer<typeof promptWizardUseDirectionPlanContextSchema>;
export type PromptWizardPlanV5 = z.infer<typeof promptWizardPlanV5Schema>;
export type PromptWizardRouteRole = z.infer<typeof promptWizardRouteRoleSchema>;
export type PromptWizardClaimBasis = z.infer<typeof promptWizardClaimBasisSchema>;
export type PromptWizardClaimBasisTag = z.infer<typeof promptWizardClaimBasisTagSchema>;
export type PromptWizardRouteV6 = z.infer<typeof promptWizardRouteV6Schema>;
export type PromptWizardRouteSetV6Status = z.infer<typeof promptWizardRouteSetV6StatusSchema>;
export type PromptWizardRouteSetV6 = z.infer<typeof promptWizardRouteSetV6Schema>;
export type PromptWizardRoutePlanContextV6 = z.infer<typeof promptWizardRoutePlanContextV6Schema>;
export type PromptWizardPlanV6 = z.infer<typeof promptWizardPlanV6Schema>;
export type PromptWizardPlan = z.infer<typeof promptWizardPlanSchema>;
export type PromptWizardRun = z.infer<typeof promptWizardRunSchema>;
export type PromptWizardBatch = z.infer<typeof promptWizardBatchSchema>;
export type PromptWizardSettings = z.infer<typeof promptWizardSettingsSchema>;
export type PromptWizardRefinementAction = z.infer<typeof promptWizardRefinementActionSchema>;
export type PromptWizardPlanRevisionStatus = z.infer<typeof promptWizardPlanRevisionStatusSchema>;
export type PromptWizardPlanRevision = z.infer<typeof promptWizardPlanRevisionSchema>;
export type PromptWizardEditBucket = z.infer<typeof promptWizardEditBucketSchema>;
export type PromptWizardSource = z.infer<typeof promptWizardSourceSchema>;
export type TkPromptSchemaVersion = z.infer<typeof tkPromptSchemaVersionSchema>;
export type TkPromptPlanSlot = z.infer<typeof tkPromptPlanSlotSchema>;
export type TkPromptStyleForm = z.infer<typeof tkPromptStyleFormSchema>;
export type TkPromptLanguage = z.infer<typeof tkPromptLanguageSchema>;
export type TkPromptStyle = z.infer<typeof tkPromptStyleSchema>;
export type TkPromptHookPatternId = z.infer<typeof tkPromptHookPatternIdSchema>;
export type TkPromptVideoMode = z.infer<typeof tkPromptVideoModeSchema>;
export type TkPromptVideoConfig = z.infer<typeof tkPromptVideoConfigSchema>;
export type TkPromptEvidenceProfile = z.infer<typeof tkPromptEvidenceProfileSchema>;
export type TkPromptEvidenceReview = z.infer<typeof tkPromptEvidenceReviewSchema>;
export type TkPromptCreativeInput = z.infer<typeof tkPromptCreativeInputSchema>;
export type TkPromptStrategyBlueprint = z.infer<typeof tkPromptStrategyBlueprintSchema>;
export type TkPromptNarrativeBeat = z.infer<typeof tkPromptNarrativeBeatSchema>;
export type TkPromptPlan = z.infer<typeof tkPromptPlanSchema>;
export type TkPromptRun = z.infer<typeof tkPromptRunSchema>;
export type TkPromptGeneration = z.infer<typeof tkPromptGenerationSchema>;
export type TkPromptOption = z.infer<typeof tkPromptOptionSchema>;
export type TkPromptEngineSettings = z.infer<typeof tkPromptEngineSettingsSchema>;
export type TkPromptSource = z.infer<typeof tkPromptSourceSchema>;
export type AIStudioVideoDraft = z.infer<typeof aiStudioVideoDraftSchema>;
export type VideoGenerationRequestConfig = z.infer<typeof videoGenerationRequestConfigSchema>;
export type ImageGenerationRequestConfig = z.infer<typeof imageGenerationRequestConfigSchema>;
export type SeedreamAnnotation = z.infer<typeof seedreamAnnotationSchema>;
export type SeedreamPointAnnotation = z.infer<typeof seedreamPointAnnotationSchema>;
export type SeedreamBboxAnnotation = z.infer<typeof seedreamBboxAnnotationSchema>;
export type UserGenerationTaskDto = z.infer<typeof userGenerationTaskSchema>;
export type UserGenerationTaskCardDto = z.infer<typeof userGenerationTaskCardSchema>;
export type AdminGenerationTaskDto = z.infer<typeof adminGenerationTaskSchema>;
export type AdminGenerationTaskCardDto = z.infer<typeof adminGenerationTaskCardSchema>;
export type AdminUserDto = z.infer<typeof adminUserSchema>;
export type AdminAuditLogDto = z.infer<typeof adminAuditLogSchema>;
export type AdminPaymentChannelDto = z.infer<typeof adminPaymentChannelSchema>;
export type DashboardSummaryDto = z.infer<typeof dashboardSummarySchema>;
export type AdminOverviewDto = z.infer<typeof adminOverviewSchema>;
export type AdminApiCostHealthDto = z.infer<typeof adminApiCostHealthSchema>;
export type AdminApiPackageDto = z.infer<typeof adminApiPackageSchema>;
export type AdminApiCostSyncItemDto = z.infer<typeof adminApiCostSyncItemSchema>;
export type AdminApiAccountBalanceDto = z.infer<typeof adminApiAccountBalanceSchema>;
export type AdminApiCostSummaryDto = z.infer<typeof adminApiCostSummarySchema>;
export type AdminApiCostModelDto = z.infer<typeof adminApiCostModelSchema>;
export type AdminApiCostOperationsDto = z.infer<typeof adminApiCostOperationsSchema>;
export type AdminApiCostOverviewOperationsDto = z.infer<typeof adminApiCostOverviewOperationsSchema>;
export type AdminApiCostOperationsModelDto = z.infer<typeof adminApiCostOperationsModelSchema>;
export type AdminApiCostDailyDto = z.infer<typeof adminApiCostDailySchema>;
export type AdminApiCostSelectionDto = z.infer<typeof adminApiCostSelectionSchema>;
export type AdminApiCostCoverageDto = z.infer<typeof adminApiCostCoverageSchema>;
export type AdminApiCostCombinedStatusDto = z.infer<typeof adminApiCostCombinedStatusSchema>;
export type AdminApiCostUsageBookDto = z.infer<typeof adminApiCostUsageBookSchema>;
export type AdminApiCostValuationBookDto = z.infer<typeof adminApiCostValuationBookSchema>;
export type AdminApiCostSettlementBookDto = z.infer<typeof adminApiCostSettlementBookSchema>;
export type AdminApiCostReconciliationBucketDto = z.infer<typeof adminApiCostReconciliationBucketSchema>;
export type AdminApiCostSettlementItemDto = z.infer<typeof adminApiCostSettlementItemSchema>;
export type AdminApiPricingRuleDto = z.infer<typeof adminApiPricingRuleSchema>;
export type AdminApiCostTaskDto = z.infer<typeof adminApiCostTaskSchema>;
export type AdminApiCostUserDto = z.infer<typeof adminApiCostUserSchema>;
export type AdminApiCostAttemptDto = z.infer<typeof adminApiCostAttemptSchema>;
export type AdminMultimodalCostSummaryDto = z.infer<typeof adminMultimodalCostSummarySchema>;
export type AdminMultimodalCostModelDto = z.infer<typeof adminMultimodalCostModelSchema>;
export type AdminMultimodalCostOperationDto = z.infer<typeof adminMultimodalCostOperationSchema>;
export type AdminMultimodalCostUserDto = z.infer<typeof adminMultimodalCostUserSchema>;
export type AdminImageCostSummaryDto = z.infer<typeof adminImageCostSummarySchema>;
export type AdminImageCostPricingDto = z.infer<typeof adminImageCostPricingSchema>;
export type AdminImageCostTaskDto = z.infer<typeof adminImageCostTaskSchema>;
export type AdminImageCostUserDto = z.infer<typeof adminImageCostUserSchema>;

// 全产品官方账单只读视图与运营直连用量使用独立契约，避免把账户级费用
// 或无法证明归属的供应商用量混入现有视频、图片、多模态业务成本账本。
export const providerBillingServiceTypeSchema = z.enum([
  'video',
  'image',
  'multimodal',
  'storage',
  'other',
]);
export const providerBillingFinalitySchema = z.enum(['final', 'provisional']);
export const providerBillingAttributionStatusSchema = z.enum([
  'business',
  'admin-operational',
  'account-level',
  'unattributed',
]);
export const providerOperationalUsageServiceTypeSchema = z.enum([
  'video',
  'image',
  'multimodal',
]);
export const providerOperationalUsageOriginSchema = z.enum([
  'manifest-v1',
  'legacy-admin-direct',
]);
export const providerOperationalUsagePurposeSchema = z.enum([
  'deployment-canary',
  'api-smoke-test',
  'provider-diagnostic',
  'admin-direct',
]);
export const providerOperationalUsageInitiatorTypeSchema = z.enum([
  'admin-user',
  'release-automation',
  'maintenance-script',
]);
export const providerOperationalUsageStatusSchema = z.enum(['success', 'failed', 'unknown']);
export const providerOperationalUsagePricingStatusSchema = z.enum([
  'priced',
  'unpriced',
  'missing-evidence',
]);
export const providerOperationalUsageEvidenceStatusSchema = z.enum([
  'verified',
  'admin-confirmed-missing-original',
]);
export const providerOperationalUsageReconciliationStatusSchema = z.enum([
  'unmatched',
  'partial',
  'matched',
]);

const providerBillingBreakdownAmountShape = {
  lineCount: nonnegativeIntegerSchema,
  originalBillAmountCny: cnyAmountSchema,
  preferentialBillAmountCny: cnyAmountSchema,
  discountBillAmountCny: cnyAmountSchema,
  couponAmountCny: cnyAmountSchema,
  payableAmountCny: cnyAmountSchema,
  paidAmountCny: cnyAmountSchema,
  unpaidAmountCny: cnyAmountSchema,
};

export const providerBillingSummarySchema = z.object({
  lineCount: nonnegativeIntegerSchema,
  productCount: nonnegativeIntegerSchema,
  finalLineCount: nonnegativeIntegerSchema,
  provisionalLineCount: nonnegativeIntegerSchema,
  originalBillAmountCny: cnyAmountSchema,
  preferentialBillAmountCny: cnyAmountSchema,
  discountBillAmountCny: cnyAmountSchema,
  couponAmountCny: cnyAmountSchema,
  payableAmountCny: cnyAmountSchema,
  paidAmountCny: cnyAmountSchema,
  unpaidAmountCny: cnyAmountSchema,
});

export const providerBillingProductSummarySchema = z.object({
  product: nonemptyStringSchema,
  productName: z.string().nullable(),
  serviceType: providerBillingServiceTypeSchema,
  lineCount: nonnegativeIntegerSchema,
  finalLineCount: nonnegativeIntegerSchema,
  provisionalLineCount: nonnegativeIntegerSchema,
  originalBillAmountCny: cnyAmountSchema,
  preferentialBillAmountCny: cnyAmountSchema,
  discountBillAmountCny: cnyAmountSchema,
  couponAmountCny: cnyAmountSchema,
  payableAmountCny: cnyAmountSchema,
  paidAmountCny: cnyAmountSchema,
  unpaidAmountCny: cnyAmountSchema,
});

export const providerBillingServiceTypeSummarySchema = z.object({
  serviceType: providerBillingServiceTypeSchema,
  ...providerBillingBreakdownAmountShape,
});

export const providerBillingAttributionSummarySchema = z.object({
  attributionStatus: providerBillingAttributionStatusSchema,
  ...providerBillingBreakdownAmountShape,
});

const providerBillingDecimalSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/);

export interface ProviderBillingDetailDto {
  id: string;
  provider: string;
  sourceDetailKey: string;
  billPeriod: string;
  expenseDate: string;
  product: string;
  productName: string | null;
  serviceType: 'video' | 'image' | 'multimodal' | 'storage' | 'other';
  model: string | null;
  billLineType: 'usage' | 'package-purchase' | 'refund' | 'adjustment' | 'other';
  finality: 'final' | 'provisional';
  attributionStatus: 'business' | 'admin-operational' | 'account-level' | 'unattributed';
  attributionEvidenceId: string | null;
  billingMode: string | null;
  billCategory: string | null;
  instanceNo: string | null;
  configName: string | null;
  usageCount: string | null;
  usageUnit: string | null;
  deductionCount: string | null;
  originalBillAmountCny: string | null;
  preferentialBillAmountCny: string | null;
  discountBillAmountCny: string | null;
  couponAmountCny: string | null;
  payableAmountCny: string | null;
  paidAmountCny: string | null;
  unpaidAmountCny: string | null;
  roundAmountCny: string | null;
  currency: string;
  currentRevisionId: string | null;
  syncedAt: string;
}

export const providerBillingDetailSchema: z.ZodType<ProviderBillingDetailDto> = z.object({
  id: uuidSchema,
  provider: nonemptyStringSchema,
  sourceDetailKey: nonemptyStringSchema,
  billPeriod: z.string().regex(/^\d{4}-\d{2}$/),
  expenseDate: isoDateSchema,
  product: nonemptyStringSchema,
  productName: z.string().nullable(),
  serviceType: providerBillingServiceTypeSchema,
  model: z.string().nullable(),
  billLineType: apiCostBillLineTypeSchema,
  finality: providerBillingFinalitySchema,
  attributionStatus: providerBillingAttributionStatusSchema,
  attributionEvidenceId: uuidSchema.nullable(),
  billingMode: z.string().nullable(),
  billCategory: z.string().nullable(),
  instanceNo: z.string().nullable(),
  configName: z.string().nullable(),
  usageCount: providerBillingDecimalSchema.nullable(),
  usageUnit: z.string().nullable(),
  deductionCount: providerBillingDecimalSchema.nullable(),
  originalBillAmountCny: cnyAmountSchema.nullable(),
  preferentialBillAmountCny: cnyAmountSchema.nullable(),
  discountBillAmountCny: cnyAmountSchema.nullable(),
  couponAmountCny: cnyAmountSchema.nullable(),
  payableAmountCny: cnyAmountSchema.nullable(),
  paidAmountCny: cnyAmountSchema.nullable(),
  unpaidAmountCny: cnyAmountSchema.nullable(),
  roundAmountCny: cnyAmountSchema.nullable(),
  currency: z.string().length(3),
  currentRevisionId: uuidSchema.nullable(),
  syncedAt: isoDateTimeSchema,
});

export interface ProviderOperationalUsageDto {
  id: string;
  origin: 'manifest-v1' | 'legacy-admin-direct';
  provider: string;
  serviceType: 'video' | 'image' | 'multimodal';
  model: string | null;
  operation: string;
  operationKey: string;
  costOwnerUserId: string;
  costOwnerUserName: string | null;
  costOwnerEmail: string | null;
  purpose: 'deployment-canary' | 'api-smoke-test' | 'provider-diagnostic' | 'admin-direct';
  initiatorType: 'admin-user' | 'release-automation' | 'maintenance-script';
  initiatedByUserId: string | null;
  sourceRunId: string | null;
  sourceItemKey: string | null;
  providerTaskId: string | null;
  providerOperationId: string | null;
  providerRequestId: string | null;
  status: 'success' | 'failed' | 'unknown';
  providerReached: boolean | null;
  occurredAt: string;
  localAccountingDate: string;
  usageEvidence: z.infer<typeof jsonObjectSchema> | null;
  evidenceStatus: 'verified' | 'admin-confirmed-missing-original' | null;
  approvalSha256: string | null;
  approvedAt: string | null;
  evidencePath: string | null;
  evidenceSha256: string | null;
  manifestVersion: string | null;
  manifestId: string | null;
  manifestSha256: string | null;
  pricingStatus: 'priced' | 'unpriced' | 'missing-evidence';
  priceVersion: string | null;
  pricingSourceUrl: string | null;
  unitPriceSnapshot: z.infer<typeof jsonObjectSchema> | null;
  estimatedCostCny: string | null;
  valuationEvidenceSha256: string | null;
  valuationRecordedAt: string | null;
  officialAttributionCount: number;
  officialBillDetailId: string | null;
  officialSourceDetailKey: string | null;
  officialFinality: 'final' | 'provisional' | null;
  officialAttributedAmountCny: string | null;
  reconciliationStatus: 'unmatched' | 'partial' | 'matched';
  createdAt: string;
}

export const providerOperationalUsageSchema: z.ZodType<ProviderOperationalUsageDto> = z.object({
  id: uuidSchema,
  origin: providerOperationalUsageOriginSchema,
  provider: nonemptyStringSchema,
  serviceType: providerOperationalUsageServiceTypeSchema,
  model: z.string().nullable(),
  operation: nonemptyStringSchema,
  operationKey: nonemptyStringSchema,
  costOwnerUserId: uuidSchema,
  costOwnerUserName: z.string().nullable(),
  costOwnerEmail: z.string().nullable(),
  purpose: providerOperationalUsagePurposeSchema,
  initiatorType: providerOperationalUsageInitiatorTypeSchema,
  initiatedByUserId: uuidSchema.nullable(),
  sourceRunId: nonemptyStringSchema.nullable(),
  sourceItemKey: nonemptyStringSchema.nullable(),
  providerTaskId: z.string().nullable(),
  providerOperationId: z.string().nullable(),
  providerRequestId: z.string().nullable(),
  status: providerOperationalUsageStatusSchema,
  providerReached: z.boolean().nullable(),
  occurredAt: isoDateTimeSchema,
  localAccountingDate: isoDateSchema,
  usageEvidence: jsonObjectSchema.nullable(),
  evidenceStatus: providerOperationalUsageEvidenceStatusSchema.nullable(),
  approvalSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  approvedAt: nullableIsoDateTimeSchema,
  evidencePath: z.string().nullable(),
  evidenceSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  manifestVersion: z.string().nullable(),
  manifestId: z.string().nullable(),
  manifestSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  pricingStatus: providerOperationalUsagePricingStatusSchema,
  priceVersion: z.string().nullable(),
  pricingSourceUrl: httpUrlSchema.nullable(),
  unitPriceSnapshot: jsonObjectSchema.nullable(),
  estimatedCostCny: nonnegativeCnyAmountSchema.nullable(),
  valuationEvidenceSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  valuationRecordedAt: nullableIsoDateTimeSchema,
  officialAttributionCount: nonnegativeIntegerSchema,
  officialBillDetailId: uuidSchema.nullable(),
  officialSourceDetailKey: z.string().nullable(),
  officialFinality: providerBillingFinalitySchema.nullable(),
  officialAttributedAmountCny: cnyAmountSchema.nullable(),
  reconciliationStatus: providerOperationalUsageReconciliationStatusSchema,
  createdAt: isoDateTimeSchema,
}).superRefine((usage, context) => {
  const isAdminConfirmed = usage.evidenceStatus === 'admin-confirmed-missing-original';
  if (isAdminConfirmed && (!usage.approvalSha256 || !usage.approvedAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['approvalSha256'],
      message: '管理员确认缺失原始证据的记录必须披露审批 SHA256 和审批时间',
    });
  }
  if (!isAdminConfirmed && (usage.approvalSha256 !== null || usage.approvedAt !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['approvalSha256'],
      message: '仅管理员确认缺失原始证据的记录可以披露审批元数据',
    });
  }
});

export type ProviderBillingServiceType = z.infer<typeof providerBillingServiceTypeSchema>;
export type ProviderBillingAttributionStatus = z.infer<typeof providerBillingAttributionStatusSchema>;
