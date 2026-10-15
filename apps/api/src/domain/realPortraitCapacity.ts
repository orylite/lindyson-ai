import type {
  RealPortraitCapacityDecision,
  RealPortraitCapacitySnapshot,
  RealPortraitQuota,
} from './realPortraitTypes.js';

export interface RealPortraitCapacityRequest {
  quota: RealPortraitQuota;
  currentUserActiveActors: number;
  snapshot: RealPortraitCapacitySnapshot;
  needsGroup?: boolean;
  desiredAssetCount?: 1 | 2;
}

export interface RealPortraitEvictionCandidate {
  materializationId: string;
  actorId: string;
  activeAssetCount: number;
  lastUsedAt: string | null;
  activatedAt: string | null;
  hasPinnedGeneration: boolean;
  hasPendingRemoteOperation: boolean;
  status: 'active' | 'eviction_warning';
}

export interface RealPortraitEvictionPlan {
  candidateIds: string[];
  freedGroupSlots: number;
  freedAssetSlots: number;
  complete: boolean;
}

/**
 * 同时执行用户套餐软上限和共享火山账号软上限。这里只做纯决策；真正预留必须在
 * PostgreSQL 账号级 advisory lock 内完成并写入 capacity reservation。
 */
export function decideRealPortraitCapacity(input: RealPortraitCapacityRequest): RealPortraitCapacityDecision {
  const needsGroup = input.needsGroup !== false;
  const groupSlots = needsGroup ? 1 : 0;
  const assetSlots = input.desiredAssetCount ?? input.quota.assetsPerActor;
  if (needsGroup && input.currentUserActiveActors >= input.quota.activeLimit) {
    return {
      outcome: 'over-user-quota',
      groupSlots,
      assetSlots,
      reason: '当前套餐的活跃真人额度已用完',
    };
  }
  const groupsAvailable = input.snapshot.groupSoftLimit
    - input.snapshot.residentGroups
    - input.snapshot.heldGroupSlots;
  const assetsAvailable = input.snapshot.assetSoftLimit
    - input.snapshot.residentAssets
    - input.snapshot.heldAssetSlots;
  if (groupsAvailable < groupSlots || assetsAvailable < assetSlots) {
    return {
      outcome: 'wait-capacity',
      groupSlots,
      assetSlots,
      reason: groupsAvailable < groupSlots ? '真人组共享容量暂时不足' : '真人素材共享容量暂时不足',
    };
  }
  return { outcome: 'reserve', groupSlots, assetSlots, reason: null };
}

/** 30 天只是“可按需淘汰”的资格线，不是到期即删。未终态生成和远端操作会硬性 pin。 */
export function selectRealPortraitEvictionPlan(input: {
  candidates: RealPortraitEvictionCandidate[];
  requiredGroupSlots: number;
  requiredAssetSlots: number;
  now?: Date;
  idleDays?: number;
}): RealPortraitEvictionPlan {
  const now = input.now ?? new Date();
  const idleBefore = now.getTime() - (input.idleDays ?? 30) * 24 * 60 * 60 * 1_000;
  const eligible = input.candidates
    .filter(candidate => (
      !candidate.hasPinnedGeneration
      && !candidate.hasPendingRemoteOperation
      && candidate.activeAssetCount > 0
      && lruTimestamp(candidate) <= idleBefore
    ))
    .sort((left, right) => (
      lruTimestamp(left) - lruTimestamp(right)
      || right.activeAssetCount - left.activeAssetCount
      || left.materializationId.localeCompare(right.materializationId)
    ));
  const candidateIds: string[] = [];
  let freedGroupSlots = 0;
  let freedAssetSlots = 0;
  for (const candidate of eligible) {
    if (freedGroupSlots >= input.requiredGroupSlots && freedAssetSlots >= input.requiredAssetSlots) break;
    candidateIds.push(candidate.materializationId);
    freedGroupSlots += 1;
    freedAssetSlots += candidate.activeAssetCount;
  }
  return {
    candidateIds,
    freedGroupSlots,
    freedAssetSlots,
    complete: freedGroupSlots >= input.requiredGroupSlots && freedAssetSlots >= input.requiredAssetSlots,
  };
}

export function assertProfileQuota(currentProfiles: number, profileLimit: number | null) {
  if (profileLimit === null || currentProfiles < profileLimit) return;
  throw Object.assign(new Error('当前套餐的真人档案数量额度已用完'), {
    statusCode: 409,
    code: 'REAL_PORTRAIT_PROFILE_QUOTA_EXCEEDED',
    exposeMessage: true,
  });
}

function lruTimestamp(candidate: Pick<RealPortraitEvictionCandidate, 'lastUsedAt' | 'activatedAt'>) {
  const value = candidate.lastUsedAt ?? candidate.activatedAt;
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}
