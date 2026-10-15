import type {
  AdminAnnouncementDto,
  AdminApiPackageDto,
  AdminApiCostAttemptDto,
  AdminApiCostTaskDto,
  AdminApiCostUserDto,
  AdminAuditLogDto,
  AdminCreditLedgerDto,
  AdminGenerationTaskCardDto,
  AdminGenerationTaskDto,
  AdminPlanDto,
  AdminTicketDto,
  AdminTicketMessageDto,
  AdminUserDto,
  AssetCardDto,
  AssetDetailDto,
  AssetFolderDto,
  ConsumptionSettingDto,
  PromptWizardSettings,
  TkPromptEngineSettings,
  FeatureFlagsDto,
  InvoiceDto,
  OrderDto,
  PublicAnnouncementDto,
  PublicPlanDto,
  UserCreditLedgerDto,
  UserGenerationTaskCardDto,
  UserGenerationTaskDto,
  UserProfileDto,
  UserTicketDto,
  UserTicketMessageDto,
  RealPortraitActorDto,
  RealPortraitCapacityDto,
} from '@lindyson/api-contracts';
import type { AccountProfile } from '../data/account';
import type {
  AdminApiPackageInstance,
  AdminApiCostDashboardSnapshot,
  AdminApiCostAttempt,
  AdminApiCostTask,
  AdminApiCostUser,
  AdminAuditLog,
  AdminCreditLedgerEntry,
  AdminGenerationJob,
  ImageGenerationAnnotation,
  AdminInvoiceRequest,
  AdminOrder,
  AdminPlan,
  AdminTicket,
  AdminUser,
  PlatformAnnouncement,
  TicketMessage,
  UserCreditLedgerEntry,
  UserTicket,
} from '../data/admin';
import type { Asset, AssetFolder, AssetGenerationMeta } from '../data/assets';
import type {
  ConsumptionSettings,
  ConsumptionVideoDuration,
  ConsumptionVideoResolution,
  VideoModelCapability,
} from '../data/consumption';
import { DEFAULT_VIDEO_MODEL_CAPABILITIES } from '../data/consumption';
import type { FeatureFlags } from '../data/featureFlags';
import type { RealPortraitActor, RealPortraitCapacity } from '../data/realPortraits';
import { resolvePlanIconKey } from '../data/planIcons';
import { getAssetThumbnailUrl } from '../utils/assetPreview';
import { ApiError } from './client';

type PlanDto = PublicPlanDto | AdminPlanDto;
type AnnouncementDto = PublicAnnouncementDto | AdminAnnouncementDto;
type GenerationTaskDto = UserGenerationTaskDto | UserGenerationTaskCardDto | AdminGenerationTaskDto;
type TicketMessageDto = UserTicketMessageDto | AdminTicketMessageDto;

export function mapAccount(row: UserProfileDto): AccountProfile {
  return {
    userName: row.userName,
    email: row.email,
    role: row.role,
    planCode: row.planCode ?? 'free',
    planName: row.planName ?? '免费版',
    portraitEntitlements: {
      ...row.portraitEntitlements,
      assetsPerActor: row.portraitEntitlements.assetsPerActor as 0 | 1 | 2,
    },
    hasActiveSubscription: row.planCode !== null,
    billingCycle: row.billingCycle,
    mainCredits: row.mainCredits,
    addonCredits: row.addonCredits,
    availableCredits: row.credits,
    totalCredits: row.totalCredits,
    resetDate: formatOptionalDate(row.planResetAt) ?? '-',
    expiresAt: formatOptionalDate(row.planExpiresAt) ?? '-',
  };
}

export function mapRealPortraitActor(row: RealPortraitActorDto): RealPortraitActor {
  return {
    ...row,
    assets: row.assets.map(asset => ({ ...asset })),
    authorizationStatus: row.authorizationStatus,
  };
}

export function mapRealPortraitCapacity(row: RealPortraitCapacityDto): RealPortraitCapacity {
  return {
    ...row,
    entitlements: {
      ...row.entitlements,
      assetsPerActor: row.entitlements.assetsPerActor as 0 | 1 | 2,
    },
    usage: { ...row.usage },
    global: { ...row.global },
    quotaState: row.quotaState ? {
      ...row.quotaState,
      retainedActorIds: [...row.quotaState.retainedActorIds],
      activeActorIds: [...row.quotaState.activeActorIds],
    } : null,
  };
}

export function mapPlan(row: PlanDto): AdminPlan {
  const updatedAt = 'updatedAt' in row ? row.updatedAt : null;
  const plan: AdminPlan = {
    id: row.id,
    name: row.name,
    nameEn: row.nameEn,
    code: row.code,
    kind: row.kind,
    billing: row.billing,
    description: row.description,
    monthlyPrice: row.monthlyPrice,
    yearlyPrice: row.yearlyPrice,
    credits: row.credits,
    assetRetentionDays: row.assetRetentionDays,
    portraitEntitlements: { ...row.portraitEntitlements },
    storage: row.storage,
    tiktokAccounts: row.tiktokAccounts,
    features: row.features.map(feature => ({ ...feature })),
    recommendation: row.recommendation,
    iconKey: null,
    ctaLabel: row.ctaLabel,
    status: row.status,
    landingVisible: row.landingVisible,
    subscribers: 'subscribers' in row ? row.subscribers : 0,
    revenue: 'revenue' in row ? row.revenue : 0,
    updatedAt: formatOptionalDateTime(updatedAt) ?? '-',
  };
  plan.iconKey = resolvePlanIconKey(row.iconKey, plan);
  return plan;
}

export function mapAnnouncement(row: AnnouncementDto): PlatformAnnouncement {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    pinned: row.pinned,
    publishedAt: formatDateTime(row.publishedAt),
  };
}

export function mapAsset(row: AssetDetailDto): Asset {
  const durationSeconds = row.durationSeconds ?? undefined;
  const width = row.width ?? undefined;
  const height = row.height ?? undefined;
  const asset: Asset = {
    id: row.id,
    name: row.name,
    type: row.type,
    source: row.source,
    folderId: row.folderId,
    size: formatBytes(row.sizeBytes),
    sizeBytes: row.sizeBytes,
    duration: durationSeconds === undefined ? undefined : `${Math.round(durationSeconds)}s`,
    durationSeconds,
    width,
    height,
    dimensions: width !== undefined && height !== undefined ? `${width}×${height}` : undefined,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDate(row.updatedAt),
    downloadRequestedAt: formatOptionalDateTime(row.downloadRequestedAt),
    downloadedAt: formatOptionalDateTime(row.downloadedAt),
    thumbnail: '',
    publicUrl: row.publicUrl,
    thumbnailUrl: row.thumbnailUrl ?? undefined,
    mediaExtension: resolveMediaExtension(undefined, row.name, row.publicUrl),
    views: row.views,
    generation: mapGenerationMeta(row.generation),
  };
  return {
    ...asset,
    thumbnail: getAssetThumbnailUrl(asset) ?? '',
  };
}

export function mapAssetCard(row: AssetCardDto): Asset {
  const durationSeconds = row.durationSeconds ?? undefined;
  const width = row.width ?? undefined;
  const height = row.height ?? undefined;
  const downloadRequestedAt = formatOptionalDateTime(row.firstDownloadAt);
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    source: row.source,
    folderId: row.folderId,
    size: formatBytes(row.sizeBytes),
    sizeBytes: row.sizeBytes,
    duration: durationSeconds === undefined ? undefined : `${Math.round(durationSeconds)}s`,
    durationSeconds,
    width,
    height,
    dimensions: width !== undefined && height !== undefined ? `${width}×${height}` : undefined,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDate(row.updatedAt),
    downloadRequestedAt,
    thumbnail: row.previewUrl ?? '',
    thumbnailUrl: row.previewUrl ?? undefined,
    mediaExtension: resolveMediaExtension(row.mediaExtension ?? undefined, row.name),
    views: row.views,
  };
}

export function mapFolder(row: AssetFolderDto): AssetFolder {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    isSystem: row.isSystem,
    createdAt: formatDate(row.createdAt),
  };
}

export function mapOrder(row: OrderDto): AdminOrder {
  const paymentMethodLabel = safePaymentMethodLabel(row.paymentMethodLabel || row.paymentMethod);
  const paymentWayLabel = safePaymentWayLabel(row.paymentWayLabel, row.paymentWayCode, paymentMethodLabel);
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    email: row.email,
    kind: row.kind,
    planName: row.planName,
    amount: row.amount,
    billing: row.billing,
    status: row.status,
    invoiceStatus: row.invoiceStatus,
    creditStatus: row.creditStatus,
    creditAmount: row.creditAmount,
    creditBucket: row.creditBucket,
    paymentMethod: paymentMethodLabel,
    paymentMethodLabel,
    paymentWayLabel,
    paymentProvider: optionalText(row.paymentProvider),
    paymentWayCode: row.paymentWayCode ?? undefined,
    paymentSurface: row.paymentSurface ?? undefined,
    merchantOrderNo: row.merchantOrderNo ?? undefined,
    paymentOrderNo: row.paymentOrderNo ?? undefined,
    paymentError: row.paymentError ?? undefined,
    paymentAttemptStatus: row.paymentAttemptStatus,
    paymentAttemptId: row.paymentAttemptId ?? undefined,
    paymentAttemptError: row.paymentAttemptError ?? undefined,
    paymentRetryAfterMs: row.paymentRetryAfterMs ?? undefined,
    paymentExpiresAt: formatOptionalDateTime(row.paymentExpiresAt),
    paymentExpiresAtIso: normalizeOptionalIsoDateTime(row.paymentExpiresAt),
    invoiceRequestStatus: row.invoiceRequestStatus ?? 'none',
    estimatedPlanResetAt: row.estimatedPlanResetAt,
    estimatedPlanExpiresAt: row.estimatedPlanExpiresAt,
    refundStatus: row.refundStatus,
    merchantRefundNo: row.merchantRefundNo ?? undefined,
    refundOrderNo: row.refundOrderNo ?? undefined,
    refundError: row.refundError ?? undefined,
    refundAttemptStatus: row.refundAttemptStatus ?? undefined,
    refundAttemptId: row.refundAttemptId ?? undefined,
    refundManualReviewReason: row.refundManualReviewReason ?? undefined,
    refundRetryAfterMs: row.refundRetryAfterMs ?? undefined,
    createdAt: formatDateTime(row.createdAt),
    createdAtIso: normalizeIsoDateTime(row.createdAt),
    paidAt: formatOptionalDateTime(row.paidAt),
    paidAtIso: normalizeOptionalIsoDateTime(row.paidAt),
    failedAt: formatOptionalDateTime(row.failedAt),
    refundedAt: formatOptionalDateTime(row.refundedAt),
  };
}

export function mapUser(row: AdminUserDto): AdminUser {
  return {
    id: row.id,
    userName: row.userName,
    email: row.email,
    planId: row.planId,
    planCode: row.planCode,
    planName: row.planName ?? '免费版',
    billingCycle: row.billingCycle,
    planCycleStartedAt: formatOptionalDate(row.planCycleStartedAt) ?? '-',
    mainCredits: row.mainCredits,
    addonCredits: row.addonCredits,
    credits: row.credits,
    totalCredits: row.totalCredits,
    planResetAt: formatOptionalDate(row.planResetAt) ?? null,
    planExpiresAt: formatOptionalDate(row.planExpiresAt) ?? null,
    activeSubscriptionOrderId: row.activeSubscriptionOrderId,
    status: row.status,
    registeredAt: formatDateTime(row.registeredAt),
    lastActiveAt: formatOptionalDateTime(row.lastActiveAt) ?? '-',
    orderCount: row.orderCount,
    apiCalls: row.apiCalls,
    ticketCount: row.ticketCount,
  };
}

export function mapInvoice(row: InvoiceDto): AdminInvoiceRequest {
  return {
    id: row.id,
    orderId: row.orderId,
    userId: row.userId,
    userName: row.userName,
    email: row.email,
    planName: row.planName,
    amount: row.amount,
    invoiceTitle: row.invoiceTitle,
    taxId: row.taxId,
    receiveEmail: row.receiveEmail,
    status: row.status,
    requestedAt: formatDateTime(row.requestedAt),
    issuedAt: formatOptionalDateTime(row.issuedAt),
    note: row.note,
  };
}

export function mapTicket(row: AdminTicketDto): AdminTicket {
  return {
    ...mapUserTicket(row),
    internalNote: row.internalNote ?? '',
  };
}

export function mapUserTicket(row: UserTicketDto): UserTicket {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    userName: row.userName,
    email: row.email,
    priority: row.priority,
    status: row.status,
    assignee: row.assignee,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
    slaHours: row.slaHours,
    lastMessage: row.lastMessage,
    unreadCount: row.unreadCount,
    messageCount: row.messageCount,
    lastMessageAuthor: row.lastMessageAuthor,
    lastMessageAt: formatDateTime(row.lastMessageAt),
  };
}

export function mapTicketMessage(row: TicketMessageDto): TicketMessage {
  return {
    id: row.id,
    ticketId: row.ticketId,
    authorRole: row.authorRole,
    authorName: row.authorName,
    authorEmail: 'authorEmail' in row ? row.authorEmail : '',
    body: row.body,
    createdAt: formatDateTime(row.createdAt),
  };
}

export function mapLedger(row: AdminCreditLedgerDto): AdminCreditLedgerEntry {
  return {
    ...mapUserLedger(row),
    userId: row.userId,
    userName: row.userName,
    email: row.email,
    operator: row.operator,
  };
}

export function mapUserLedger(row: UserCreditLedgerDto): UserCreditLedgerEntry {
  return {
    id: row.id,
    time: formatDateTime(row.createdAt),
    type: row.type,
    bucket: row.bucket,
    settlementStatus: row.settlementStatus,
    amount: row.amount,
    balance: row.balance,
    source: row.source,
    note: row.note,
    relatedOrderId: row.relatedOrderId ?? undefined,
    relatedJobId: row.relatedJobId ?? undefined,
    relatedAssetId: row.relatedAssetId ?? undefined,
    generationSnapshot: row.generationSnapshot ?? undefined,
  };
}

export function mapJob(row: GenerationTaskDto): AdminGenerationJob {
  const startedAt = formatOptionalDateTime(row.startedAt);
  const completedAt = formatOptionalDateTime(row.completedAt);
  const adminFields = 'providerTaskId' in row ? row : null;
  return {
    id: row.id,
    time: formatDateTime(row.createdAt),
    createdAtIso: normalizeIsoDateTime(row.createdAt),
    userName: adminFields?.userName ?? '',
    email: adminFields?.email ?? '',
    kind: row.kind,
    model: row.model,
    status: row.status,
    duration: completedAt && startedAt ? '已完成' : '-',
    credits: row.credits,
    reservedCredits: row.reservedCredits,
    settledCredits: row.settledCredits,
    refundedCredits: row.refundedCredits,
    creditStatus: row.creditStatus,
    mainCreditsUsed: row.mainCreditsUsed,
    addonCreditsUsed: row.addonCreditsUsed,
    prompt: 'prompt' in row ? row.prompt : '',
    config: formatConfig(row.config),
    configData: row.config,
    failCategory: row.failureCategory ?? undefined,
    failReason: row.failureReason ?? undefined,
    assetId: row.assetId ?? undefined,
    assetName: row.assetName ?? undefined,
    assetSource: row.assetSource ?? undefined,
    assetThumbnailUrl: 'assetThumbnailUrl' in row ? row.assetThumbnailUrl ?? undefined : undefined,
    assetAvailable: 'assetAvailable' in row ? row.assetAvailable : undefined,
    ledgerIds: adminFields?.ledgerIds,
    retryCount: row.retryCount,
    attempt: row.attempt,
    processingStage: row.processingStage,
    cancelState: row.cancelState,
    claimEpoch: adminFields?.claimEpoch,
    providerRunId: adminFields?.providerRunId ?? undefined,
    providerRunStatus: adminFields?.providerRunStatus ?? null,
    providerTaskId: adminFields?.providerTaskId ?? undefined,
    settlementError: adminFields?.settlementError ?? null,
    heartbeatAt: formatOptionalDateTime(adminFields?.heartbeatAt),
    leaseExpiresAt: formatOptionalDateTime(adminFields?.leaseExpiresAt),
    startedAt,
    completedAt,
  };
}

export function mapAdminJobCard(row: AdminGenerationTaskCardDto): AdminGenerationJob {
  return {
    id: row.id,
    time: formatDateTime(row.createdAt),
    createdAtIso: normalizeIsoDateTime(row.createdAt),
    userName: row.userName,
    email: row.email,
    kind: row.kind,
    model: row.model,
    status: row.status,
    processingStage: row.processingStage,
    duration: '-',
    credits: 0,
    reservedCredits: 0,
    settledCredits: 0,
    refundedCredits: 0,
    creditStatus: row.creditStatus,
    mainCreditsUsed: 0,
    addonCreditsUsed: 0,
    prompt: '',
    config: '',
    failCategory: row.failureCategory ?? undefined,
    assetId: row.assetId ?? undefined,
    assetName: row.assetName ?? undefined,
    assetSource: row.assetSource ?? undefined,
    retryCount: row.retryCount,
    providerRunId: row.providerRunId ?? undefined,
    providerRunStatus: row.providerRunStatus ?? null,
  };
}

export function mapAudit(row: AdminAuditLogDto): AdminAuditLog {
  return {
    id: row.id,
    time: formatDateTime(row.createdAt),
    admin: row.adminEmail,
    module: row.module,
    action: row.action,
    target: row.target,
    risk: row.risk,
    ip: row.ip ?? '-',
    detail: row.detail,
  };
}

export function mapConsumptionSettings(
  rows: ConsumptionSettingDto[],
  promptWizard?: PromptWizardSettings,
  videoModels?: unknown,
  tkPromptEngine?: TkPromptEngineSettings,
): ConsumptionSettings {
  const video = rows
    .filter(row => row.kind === 'video')
    .map(row => ({
      id: row.id,
      model: modelId(row.model),
      modelLabel: row.modelLabel,
      duration: consumptionDuration(row.durationSeconds),
      resolution: consumptionResolution(row.resolution),
      credits: row.credits,
      referenceVideoCredits: row.referenceVideoCredits ?? row.credits,
      available: row.available,
    }));
  const imageRows = rows.filter(row => row.kind === 'image' && isSeedreamImageModel(row.model));
  return {
    video,
    videoModels: mapVideoModelCapabilities(videoModels),
    image: (['1K', '2K'] as const).map(resolution => {
      const imageRow = imageRows.find(row => row.resolution.toUpperCase() === resolution);
      return {
        id: imageRow?.id ?? `seedream-5.0-pro-${resolution.toLowerCase()}`,
        model: 'seedream-5.0-pro',
        modelLabel: 'Seedream 5.0 Pro',
        resolution,
        credits: imageRow?.credits ?? 0,
        available: imageRow?.available ?? false,
      };
    }),
    promptWizard: {
      generationCredits: promptWizard?.generationCredits ?? 1,
      available: promptWizard?.available ?? false,
      engineVersion: promptWizard?.engineVersion ?? 4,
      updatedAt: promptWizard?.updatedAt ?? '',
    },
    tkPromptEngine: {
      schemaVersion: 1,
      generationCredits: tkPromptEngine?.generationCredits ?? 1,
      available: tkPromptEngine?.available ?? false,
      updatedAt: tkPromptEngine?.updatedAt ?? '',
    },
  };
}

function mapVideoModelCapabilities(value: unknown): VideoModelCapability[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<VideoModelCapability>(item => {
    if (!isRecord(item)) return [];
    const id = optionalModelId(readStringField(item, 'id'));
    if (!id) return [];
    const fallback = DEFAULT_VIDEO_MODEL_CAPABILITIES[id];
    const aspectRatios = isRecord(item.aspectRatios) ? item.aspectRatios : {};
    const references = isRecord(item.references) ? item.references : {};
    const resolutions = readStringArray(item, 'resolutions')
      .filter((entry): entry is VideoModelCapability['resolutions'][number] => (
        entry === '480p' || entry === '720p' || entry === '1080p'
      ));
    const durationSeconds = readNumberArray(item, 'durationSeconds')
      .filter((entry): entry is VideoModelCapability['durationSeconds'][number] => (
        entry === 5 || entry === 10 || entry === 15 || entry === 20 || entry === 25 || entry === 30
      ));
    const modes = readStringArray(item, 'modes')
      .filter((entry): entry is VideoModelCapability['modes'][number] => (
        entry === 'general' || entry === 'first-last'
      ));
    const generalRatios = readStringArray(aspectRatios, 'general')
      .filter((entry): entry is VideoModelCapability['aspectRatios']['general'][number] => (
        entry === '9:16' || entry === '16:9' || entry === 'adaptive'
      ));
    const firstLastRatios = readStringArray(aspectRatios, 'firstLast')
      .filter((entry): entry is VideoModelCapability['aspectRatios']['firstLast'][number] => (
        entry === '9:16' || entry === '16:9' || entry === 'adaptive'
      ));
    const numberReference = (key: keyof VideoModelCapability['references']) => {
      const field = references[key];
      return typeof field === 'number' && Number.isFinite(field) && field >= 0
        ? field
        : fallback.references[key];
    };
    return [{
      ...fallback,
      label: readStringField(item, 'label') ?? fallback.label,
      available: readBooleanField(item, 'available') ?? fallback.available,
      recommended: readBooleanField(item, 'recommended') ?? fallback.recommended,
      resolutions: resolutions.length > 0 ? resolutions : fallback.resolutions,
      durationSeconds: durationSeconds.length > 0 ? durationSeconds : fallback.durationSeconds,
      modes: modes.length > 0 ? modes : fallback.modes,
      aspectRatios: {
        general: generalRatios.length > 0 ? generalRatios : fallback.aspectRatios.general,
        firstLast: firstLastRatios.length > 0 ? firstLastRatios : fallback.aspectRatios.firstLast,
      },
      references: {
        maxTotal: numberReference('maxTotal') as number,
        maxImages: numberReference('maxImages') as number,
        maxVideos: numberReference('maxVideos') as number,
        maxAudios: numberReference('maxAudios') as number,
        maxVideoDurationSeconds: numberReference('maxVideoDurationSeconds') as number,
        maxAudioDurationSeconds: numberReference('maxAudioDurationSeconds') as number,
        allowAudioOnly: readBooleanField(references, 'allowAudioOnly') ?? fallback.references.allowAudioOnly,
      },
      supportsPromptWizard: readBooleanField(item, 'supportsPromptWizard') ?? fallback.supportsPromptWizard,
      supportsRealPortrait: readBooleanField(item, 'supportsRealPortrait') ?? fallback.supportsRealPortrait,
      outputFormat: 'mp4',
      generateAudio: true,
    }];
  });
}

function isSeedreamImageModel(value: string) {
  return value.trim().toLowerCase().replace(/^doubao\s+/, '') === 'seedream 5.0 pro';
}

export function mapFeatureFlags(row: FeatureFlagsDto): FeatureFlags {
  return { ...row };
}

export function mapApiPackage(row: AdminApiPackageDto): AdminApiPackageInstance {
  return {
    ...row,
    config: typeof row.config === 'string' ? row.config : JSON.stringify(row.config),
  };
}

export function mapApiCostDashboard(
  row: Omit<AdminApiCostDashboardSnapshot, 'packages'> & { packages: AdminApiPackageDto[] },
): AdminApiCostDashboardSnapshot {
  return {
    ...row,
    packages: row.packages.map(mapApiPackage),
  };
}

export function mapApiCostTask(row: AdminApiCostTaskDto): AdminApiCostTask {
  return { ...row };
}

export function mapApiCostAttempt(row: AdminApiCostAttemptDto): AdminApiCostAttempt {
  return { ...row };
}

export function mapApiCostUser(row: AdminApiCostUserDto): AdminApiCostUser {
  return { ...row };
}

function mapGenerationMeta(value: AssetDetailDto['generation']): AssetGenerationMeta | undefined {
  if (!value) return undefined;
  const config = value.config ?? {};
  const referenceImages = mapReferenceImages(readArrayField(config, 'referenceImages') ?? value.referenceImages ?? []);
  const mappedReferenceAssets = mapReferenceAssets(
    readArrayField(config, 'referenceAssets') ?? value.referenceAssets,
  );
  const referenceAssets = mappedReferenceAssets?.length || referenceImages.length === 0
    ? mappedReferenceAssets
    : undefined;

  if (value.kind === 'video') {
    const durationSeconds = readNumberField(config, 'durationSeconds') ?? value.durationSeconds ?? 5;
    const aspectRatio = readEnumField(config, 'aspectRatio', ['9:16', '16:9', 'adaptive'])
      ?? (value.aspectRatio === '9:16' || value.aspectRatio === '16:9' || value.aspectRatio === 'adaptive' ? value.aspectRatio : undefined)
      ?? '9:16';
    return {
      kind: 'video',
      mode: readEnumField(config, 'mode', ['general', 'first-last']) ?? value.mode ?? 'general',
      model: value.model,
      aspectRatio,
      resolution: readStringField(config, 'resolution') ?? value.resolution ?? '720p',
      duration: `${durationSeconds}s`,
      generateAudio: readBooleanField(config, 'generateAudio'),
      outputFormat: readEnumField(config, 'outputFormat', ['mp4', 'mov']),
      prompt: value.prompt,
      referenceImages,
      referenceAssets,
      credits: value.credits,
    };
  }
  const resolution = readEnumField(config, 'resolution', ['1K', '2K'])
    ?? (value.resolution === '1K' || value.resolution === '2K' ? value.resolution : undefined)
    ?? '2K';
  const ratio = readEnumField(config, 'aspectRatio', ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'])
    ?? readEnumField(config, 'ratio', ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'])
    ?? (value.aspectRatio && ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'].includes(value.aspectRatio) ? value.aspectRatio : undefined)
    ?? value.ratio
    ?? '1:1';
  const optimizePromptMode = readEnumField(config, 'optimizePromptMode', ['standard', 'fast'])
    ?? value.optimizePromptMode
    ?? 'standard';
  const annotations = mapImageAnnotations(readArrayField(config, 'annotations') ?? value.annotations ?? []);
  return {
    kind: 'image',
    model: value.model,
    outputSize: readStringField(config, 'outputSize') ?? value.outputSize ?? resolution,
    ratio,
    resolution,
    optimizePromptMode,
    annotations,
    prompt: value.prompt,
    referenceImages,
    referenceAssets,
    credits: value.credits,
  };
}

function mapImageAnnotations(value: unknown[]): ImageGenerationAnnotation[] {
  return value.flatMap<ImageGenerationAnnotation>(item => {
    if (!isRecord(item)) return [];
    const token = optionalStringField(item, 'token');
    const assetId = optionalStringField(item, 'assetId');
    if (!token || !/^@标记[1-9]\d*$/.test(token) || !assetId) return [];
    if (item.type === 'point') {
      const x = readNumberField(item, 'x');
      const y = readNumberField(item, 'y');
      if (x === undefined || y === undefined) return [];
      return [{ token: token as `@标记${number}`, assetId, type: 'point' as const, x, y }];
    }
    if (item.type === 'bbox') {
      const x1 = readNumberField(item, 'x1');
      const y1 = readNumberField(item, 'y1');
      const x2 = readNumberField(item, 'x2');
      const y2 = readNumberField(item, 'y2');
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return [];
      return [{ token: token as `@标记${number}`, assetId, type: 'bbox' as const, x1, y1, x2, y2 }];
    }
    return [];
  });
}

function mapReferenceImages(value: unknown[]): AssetGenerationMeta['referenceImages'] {
  return value.filter(isRecord).map(reference => ({
    id: stringField(reference, 'id'),
    name: stringField(reference, 'name'),
    thumbnail: optionalStringField(reference, 'previewUrl') ?? stringField(reference, 'thumbnail'),
    publicUrl: optionalStringField(reference, 'previewUrl') ?? optionalStringField(reference, 'publicUrl'),
    thumbnailUrl: optionalStringField(reference, 'thumbnailUrl'),
    role: readEnumField(reference, 'role', ['reference_image', 'reference_video', 'reference_audio', 'first_frame', 'last_frame']),
  }));
}

function mapReferenceAssets(value: unknown[] | undefined): AssetGenerationMeta['referenceAssets'] {
  if (!value) return undefined;
  return value.filter(isRecord).map(reference => ({
    id: stringField(reference, 'id'),
    name: stringField(reference, 'name'),
    thumbnail: optionalStringField(reference, 'previewUrl') ?? stringField(reference, 'thumbnail'),
    publicUrl: optionalStringField(reference, 'previewUrl') ?? optionalStringField(reference, 'publicUrl'),
    thumbnailUrl: optionalStringField(reference, 'thumbnailUrl'),
    role: readEnumField(reference, 'role', ['reference_image', 'reference_video', 'reference_audio', 'first_frame', 'last_frame']),
    type: readEnumField(reference, 'type', ['image', 'video', 'audio']) ?? 'image',
    duration: optionalStringField(reference, 'duration'),
    durationSeconds: readNumberField(reference, 'durationSeconds'),
    sizeBytes: readNumberField(reference, 'sizeBytes'),
    width: readNumberField(reference, 'width'),
    height: readNumberField(reference, 'height'),
    mediaExtension: resolveMediaExtension(optionalStringField(reference, 'mediaExtension'), stringField(reference, 'name')),
  }));
}

function resolveMediaExtension(explicit: string | undefined, ...candidates: Array<string | undefined>) {
  const normalizedExplicit = explicit?.trim().toLowerCase();
  if (normalizedExplicit && /^[a-z0-9]+$/.test(normalizedExplicit)) return normalizedExplicit;
  for (const candidate of candidates) {
    const clean = candidate?.split(/[?#]/, 1)[0] ?? '';
    const match = clean.match(/\.([A-Za-z0-9]+)$/);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return undefined;
}

function safePaymentMethodLabel(value: string) {
  return value === '支付宝' || /alipay|支付宝/i.test(value) ? '支付宝' : '在线支付';
}

function safePaymentWayLabel(label: string, code: string | null, fallback: string) {
  if (label === '支付宝扫码支付' || code === 'ALI_QR') return '支付宝扫码支付';
  if (label === '支付宝电脑网站' || code === 'ALI_PC') return '支付宝电脑网站';
  if (label === '支付宝手机网页' || code === 'ALI_WAP') return '支付宝手机网页';
  return fallback;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDate(value: string) {
  return formatDateTime(value).slice(0, 10);
}

function formatOptionalDateTime(value: string | null | undefined) {
  return value ? formatDateTime(value) : undefined;
}

function formatOptionalDate(value: string | null | undefined) {
  // 契约中的日期字段已经是无时区的 YYYY-MM-DD 业务日期；转成 Date 会在负时区减一天。
  return value ? value.slice(0, 10) : undefined;
}

function normalizeIsoDateTime(value: string) {
  return new Date(value).toISOString();
}

function normalizeOptionalIsoDateTime(value: string | null | undefined) {
  return value ? normalizeIsoDateTime(value) : undefined;
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 B';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatConfig(config: GenerationTaskDto['config']) {
  const aspectRatio = readStringField(config, 'aspectRatio');
  const resolution = readStringField(config, 'resolution');
  const durationSeconds = readNumberField(config, 'durationSeconds');
  const outputSize = readStringField(config, 'outputSize');
  const ratio = readStringField(config, 'ratio');
  return [aspectRatio, resolution, durationSeconds !== undefined ? `${durationSeconds}s` : outputSize ?? ratio]
    .filter(Boolean)
    .join(' · ') || JSON.stringify(config);
}

function modelId(label: string): ConsumptionSettings['video'][number]['model'] {
  if (label === 'Seedance 2.5' || label === 'seedance-2.5') return 'seedance-2.5';
  if (label === 'Seedance 2.0' || label === 'seedance-2.0') return 'seedance-2.0';
  if (label === 'Seedance 2.0 Fast' || label === 'seedance-2.0-fast') return 'seedance-2.0-fast';
  if (label === 'Seedance 2.0 Mini' || label === 'seedance-2.0-mini') return 'seedance-2.0-mini';
  throw invalidMappedValue('model');
}

function consumptionDuration(value: number | null): ConsumptionVideoDuration {
  const text = String(value);
  if (text === '5' || text === '10' || text === '15' || text === '20' || text === '25' || text === '30') return text;
  throw invalidMappedValue('durationSeconds');
}

function consumptionResolution(value: string): ConsumptionVideoResolution {
  if (value === '480p' || value === '720p' || value === '1080p') return value;
  throw invalidMappedValue('resolution');
}

function optionalText(value: string) {
  return value || undefined;
}

function readArrayField(value: unknown, key: string): unknown[] | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return Array.isArray(field) ? field : undefined;
}

function readStringArray(value: unknown, key: string) {
  return (readArrayField(value, key) ?? []).filter((entry): entry is string => typeof entry === 'string');
}

function readNumberArray(value: unknown, key: string) {
  return (readArrayField(value, key) ?? []).filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry));
}

function readStringField(value: unknown, key: string) {
  return isRecord(value) ? optionalStringField(value, key) : undefined;
}

function readNumberField(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined;
}

function readBooleanField(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === 'boolean' ? field : undefined;
}

function optionalModelId(value: string | undefined) {
  if (!value) return undefined;
  try {
    return modelId(value);
  } catch {
    return undefined;
  }
}

function readEnumField<const Values extends readonly string[]>(
  value: unknown,
  key: string,
  allowed: Values,
): Values[number] | undefined {
  const field = readStringField(value, key);
  return field && allowed.includes(field) ? field as Values[number] : undefined;
}

function stringField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  return typeof field === 'string' ? field : '';
}

function optionalStringField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidMappedValue(field: string) {
  return new ApiError(`服务器响应字段无法转换：${field}`, 502, 'INVALID_API_RESPONSE');
}

function pad(value: number) {
  return value.toString().padStart(2, '0');
}
