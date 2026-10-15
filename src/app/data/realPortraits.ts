export type PortraitPlanAccessStatus = 'available' | 'grace' | 'plan_locked';

export type PortraitLifecycleStatus =
  | 'draft'
  | 'waiting'
  | 'invited'
  | 'verifying'
  | 'awaiting_upload'
  | 'processing'
  | 'active'
  | 'eviction_warning'
  | 'evicted'
  | 'revoked'
  | 'expired'
  | 'deleting'
  | 'sync_error';

export type PortraitAuthorizationStatus =
  | 'none'
  | 'draft'
  | 'pending'
  | 'verified'
  | 'active'
  | 'rejected'
  | 'revoked'
  | 'expired';

export type PortraitAssetKind = 'primary' | 'secondary';
export type PortraitAssetStatus = 'queued' | 'processing' | 'active' | 'failed' | 'deleting' | 'deleted';
export type PortraitConsistencyStatus = 'pending' | 'passed' | 'failed' | 'unknown';

export interface RealPortraitAsset {
  id: string;
  kind: PortraitAssetKind;
  status: PortraitAssetStatus;
  consistencyStatus: PortraitConsistencyStatus;
  thumbnailAvailable?: boolean;
}

export interface RealPortraitActor {
  id: string;
  alias: string;
  planAccessStatus: PortraitPlanAccessStatus;
  lifecycleStatus: PortraitLifecycleStatus;
  authorizationStatus: PortraitAuthorizationStatus;
  authorizationExpiresAt: string | null;
  lastSuccessfulGenerationAt: string | null;
  createdAt: string;
  updatedAt: string;
  assets: RealPortraitAsset[];
}

export interface PortraitEntitlements {
  enabled: boolean;
  profileLimit: number | null;
  activeLimit: number;
  assetsPerActor: 0 | 1 | 2;
}

export interface PortraitQuotaState {
  graceStatus: 'none' | 'active' | 'reconciling' | 'completed';
  graceUntil: string | null;
  retainedActorIds: string[];
  activeActorIds: string[];
}

export interface RealPortraitCapacity {
  sourcePlanCode: string;
  sourcePlanName: string;
  entitlements: PortraitEntitlements;
  usage: {
    profiles: number;
    active: number;
    queued: number;
  };
  global: {
    groupSoftLimit: number;
    assetSoftLimit: number;
    groupsUsed: number;
    assetsUsed: number;
    groupsReserved: number;
    assetsReserved: number;
  };
  quotaState: PortraitQuotaState | null;
}

export interface RealPortraitActorList {
  items: RealPortraitActor[];
  capacity: RealPortraitCapacity;
}

export interface PortraitActivationResult {
  actor: RealPortraitActor;
  queuePosition: number | null;
  invitationUrl: string | null;
  invitationExpiresAt: string | null;
}

export interface PublicPortraitInvite {
  status: 'pending' | 'accepted' | 'consumed' | 'expired' | 'cancelled';
  controllerName: string;
  processorName: string;
  privacyContact: string;
  privacyPolicyUrl: string;
  processingScope: string;
  retentionRule: string;
  purpose: string;
  commercialUse: boolean;
  validUntil: string;
  inviteExpiresAt: string;
  portraitNoticeVersion: string;
  sensitiveInfoNoticeVersion: string;
  canStartVerification: boolean;
}

export interface PublicPortraitVerificationStart {
  status: 'verification-ready' | 'waiting-capacity';
  verificationUrl: string | null;
  expiresAt: string | null;
  queuePosition: number | null;
}

export interface PublicPortraitConsentResult {
  status: 'accepted' | 'declined';
  manageUrl: string | null;
}

export interface PublicPortraitAuthorization {
  status: PortraitAuthorizationStatus;
  controllerName: string;
  processorName: string;
  privacyContact: string;
  privacyPolicyUrl: string;
  processingScope: string;
  retentionRule: string;
  purpose: string;
  commercialUse: boolean;
  validUntil: string;
  cleanupStatus: 'not-requested' | 'pending' | 'completed' | 'manual-review';
}

export interface RealPortraitReferenceInput {
  actorId: string;
  portraitAssetId?: string;
}

export const portraitLifecycleLabels: Record<PortraitLifecycleStatus, string> = {
  draft: '未激活',
  waiting: '等待资源',
  invited: '待本人认证',
  verifying: '本人认证中',
  awaiting_upload: '待上传主图',
  processing: '素材校验中',
  active: '可用',
  eviction_warning: '即将释放',
  evicted: '资源已释放',
  revoked: '授权已撤回',
  expired: '授权已到期',
  deleting: '删除中',
  sync_error: '同步异常',
};

export function canUsePortraitActor(actor: RealPortraitActor) {
  return actor.planAccessStatus !== 'plan_locked'
    && actor.lifecycleStatus === 'active'
    && actor.authorizationStatus === 'active'
    && actor.assets.some(asset => (
      asset.kind === 'primary'
      && asset.status === 'active'
      && asset.consistencyStatus === 'passed'
    ));
}

export function occupiesPortraitActiveSlot(actor: RealPortraitActor) {
  return [
    'waiting',
    'invited',
    'verifying',
    'awaiting_upload',
    'processing',
    'active',
    'eviction_warning',
    'sync_error',
  ].includes(actor.lifecycleStatus);
}

export function rankPortraitActorsForRetention(actors: RealPortraitActor[]) {
  return [...actors].sort((left, right) => {
    const leftSuccessfulAt = portraitDateRank(left.lastSuccessfulGenerationAt);
    const rightSuccessfulAt = portraitDateRank(right.lastSuccessfulGenerationAt);
    const leftWasUsed = leftSuccessfulAt > Number.NEGATIVE_INFINITY;
    const rightWasUsed = rightSuccessfulAt > Number.NEGATIVE_INFINITY;
    if (leftWasUsed !== rightWasUsed) return leftWasUsed ? -1 : 1;
    if (leftWasUsed && rightWasUsed && leftSuccessfulAt !== rightSuccessfulAt) {
      return rightSuccessfulAt - leftSuccessfulAt;
    }
    const createdDifference = portraitDateRank(right.createdAt) - portraitDateRank(left.createdAt);
    return createdDifference || left.id.localeCompare(right.id);
  });
}

function portraitDateRank(value: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

export function formatPortraitLimit(limit: number | null) {
  return limit === null ? '不限' : String(limit);
}

export interface PortraitPlanBenefit {
  key: 'profiles' | 'active' | 'assets';
  label: string;
  value: string;
  enabled: boolean;
}

/**
 * 套餐卡只从结构化权益产生真人演员展示项。
 * 加购包即使收到异常数据也不能被展示为真人库权益。
 */
export function getPortraitPlanBenefits(plan: {
  kind: 'main' | 'addon';
  portraitEntitlements: {
    enabled: boolean;
    profileLimit: number | null;
    activeLimit: number;
    assetsPerActor: number;
  };
}): PortraitPlanBenefit[] {
  if (plan.kind !== 'main') return [];
  const entitlements = plan.portraitEntitlements;
  const enabled = entitlements.enabled;
  return [
    {
      key: 'profiles',
      label: '真人演员档案数',
      value: enabled
        ? entitlements.profileLimit === null ? '不限' : `${entitlements.profileLimit.toLocaleString()} 人`
        : '0 人',
      enabled,
    },
    {
      key: 'active',
      label: '同时可用人数',
      value: enabled ? `${entitlements.activeLimit.toLocaleString()} 人` : '0 人',
      enabled,
    },
    {
      key: 'assets',
      label: '每人图片数',
      value: enabled ? `${entitlements.assetsPerActor.toLocaleString()} 张` : '0 张',
      enabled,
    },
  ];
}
