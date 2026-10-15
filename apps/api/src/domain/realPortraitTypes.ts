export type RealPortraitActorLifecycleStatus =
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

export type RealPortraitPlanAccessStatus = 'available' | 'grace' | 'plan_locked';

export type RealPortraitAuthorizationStatus =
  | 'none'
  | 'draft'
  | 'pending'
  | 'verified'
  | 'active'
  | 'rejected'
  | 'revoked'
  | 'expired';

export type RealPortraitVerificationStatus =
  | 'prepared'
  | 'submitting'
  | 'submission_unknown'
  | 'invitation_ready'
  | 'waiting'
  | 'verified'
  | 'failed'
  | 'expired';

export type RealPortraitMaterializationStatus =
  | 'reserved'
  | 'verifying'
  | 'awaiting_upload'
  | 'processing'
  | 'active'
  | 'eviction_warning'
  | 'deleting'
  | 'evicted'
  | 'deleted'
  | 'error';

export type RealPortraitAssetStatus =
  | 'queued'
  | 'processing'
  | 'active'
  | 'failed'
  | 'deleting'
  | 'deleted';

export type RealPortraitConsistencyStatus = 'pending' | 'passed' | 'failed' | 'unknown';
export type RealPortraitAssetKind = 'primary' | 'secondary';
export type RealPortraitProviderAssetType = 'Image' | 'Video' | 'Audio';

export interface RealPortraitAsset {
  id: string;
  kind: RealPortraitAssetKind;
  status: RealPortraitAssetStatus;
  consistencyStatus: RealPortraitConsistencyStatus;
  thumbnailAvailable?: boolean;
}

export interface RealPortraitActor {
  id: string;
  alias: string;
  planAccessStatus: RealPortraitPlanAccessStatus;
  lifecycleStatus: RealPortraitActorLifecycleStatus;
  authorizationStatus: RealPortraitAuthorizationStatus | null;
  authorizationExpiresAt: string | null;
  lastSuccessfulGenerationAt: string | null;
  createdAt: string;
  updatedAt: string;
  assets: RealPortraitAsset[];
}

export interface RealPortraitAuthorization {
  id: string;
  actorId: string;
  version: number;
  status: RealPortraitAuthorizationStatus;
  purpose: string;
  commercialUse: boolean;
  validFrom: string;
  validUntil: string;
  consentedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RealPortraitGenerationReference {
  actorId: string;
  portraitAssetId: string;
  authorizationId: string;
  materializationId: string;
  authorizationVersion: number;
  providerAssetId: string;
  projectName: string;
  providerUrl: `asset://${string}`;
}

export type RealPortraitGenerationDeliveryBlockReason =
  | 'authorization-revoked'
  | 'authorization-expired'
  | 'authorization-inactive';

export type RealPortraitGenerationDeliveryDecision =
  | { hasReferences: false; allowed: true; reason: null }
  | { hasReferences: true; allowed: true; reason: null }
  | {
      hasReferences: true;
      allowed: false;
      reason: RealPortraitGenerationDeliveryBlockReason;
    };

export interface RealPortraitQuota {
  enabled: boolean;
  profileLimit: number | null;
  activeLimit: number;
  assetsPerActor: 0 | 1 | 2;
  sourcePlanId: string | null;
  sourcePlanCode?: string | null;
  sourcePlanName?: string | null;
}

export interface RealPortraitCapacitySnapshot {
  residentGroups: number;
  residentAssets: number;
  heldGroupSlots: number;
  heldAssetSlots: number;
  groupSoftLimit: number;
  assetSoftLimit: number;
}

export interface RealPortraitCapacityDecision {
  outcome: 'reserve' | 'wait-capacity' | 'over-user-quota';
  groupSlots: number;
  assetSlots: number;
  reason: string | null;
}

export interface RealPortraitQuotaState {
  graceStatus: 'none' | 'active' | 'reconciling' | 'completed';
  graceUntil: string | null;
  retainedActorIds: string[];
  activeActorIds: string[];
}

export interface RealPortraitCapacityDto {
  sourcePlanCode: string;
  sourcePlanName: string;
  entitlements: {
    enabled: boolean;
    profileLimit: number | null;
    activeLimit: number;
    assetsPerActor: number;
  };
  usage: { profiles: number; active: number; queued: number };
  global: {
    groupSoftLimit: number;
    assetSoftLimit: number;
    groupsUsed: number;
    assetsUsed: number;
    groupsReserved: number;
    assetsReserved: number;
  };
  quotaState: RealPortraitQuotaState | null;
}
