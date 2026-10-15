import type {
  ArkPromptWizardResponsesRequest,
  ArkPromptWizardResponsesResult,
} from '../providers/arkPromptWizardResponsesClient.js';

export const PROMPT_WIZARD_ATTEMPT28_GLOBAL_PHYSICAL_REQUEST_LIMIT = 136;
export const PROMPT_WIZARD_ATTEMPT28_CASE_PHYSICAL_REQUEST_LIMIT = 10;
export const PROMPT_WIZARD_ATTEMPT28_PLAN_CONTENT_REPAIR_LIMIT = 2;
export const PROMPT_WIZARD_ATTEMPT28_CASE_CONTENT_REPAIR_LIMIT = 6;
export const PROMPT_WIZARD_ATTEMPT27_GLOBAL_PHYSICAL_REQUEST_LIMIT = 13;
export const PROMPT_WIZARD_ATTEMPT27_CASE_PHYSICAL_REQUEST_LIMIT = 5;
export const PROMPT_WIZARD_ATTEMPT27_GLOBAL_FORMAT_REPAIR_LIMIT = 4;
export const PROMPT_WIZARD_ATTEMPT27_NATURAL_FORMAT_REPAIR_LIMIT = 1;
export const PROMPT_WIZARD_ATTEMPT27_FORCED_FORMAT_REPAIR_LIMIT = 3;
export const PROMPT_WIZARD_ATTEMPT28_GLOBAL_FORMAT_REPAIR_LIMIT = 1;

export const PROMPT_WIZARD_CANARY_PHYSICAL_OPERATIONS = [
  'generate-drafts',
  'repair-draft-format',
  'repair-draft-content',
] as const;

export type PromptWizardCanaryPhysicalOperation =
  typeof PROMPT_WIZARD_CANARY_PHYSICAL_OPERATIONS[number];

export interface PromptWizardCanaryOperationCounts {
  'generate-drafts': number;
  'repair-draft-format': number;
  'repair-draft-content': number;
}

export interface PromptWizardCanaryPhysicalRequestSnapshot {
  globalCount: number;
  caseCounts: Record<string, number>;
  operationCounts: PromptWizardCanaryOperationCounts;
  caseOperationCounts: Record<string, PromptWizardCanaryOperationCounts>;
  casePlanContentRepairCounts: Record<string, [number, number, number]>;
}

export interface PromptWizardCanaryPhysicalSnapshotLimits {
  attempt: 27 | 28;
  caseIds: readonly string[];
  globalLimit: number;
  caseLimit: number;
  globalFormatRepairLimit: number;
}

export type PromptWizardCanaryResponsesClient = {
  create(
    request: ArkPromptWizardResponsesRequest,
    options: { timeoutMs: number },
  ): Promise<ArkPromptWizardResponsesResult>;
};

interface PromptWizardCanaryPhysicalRequestGuardOptions {
  attempt: 27 | 28;
  caseIds: readonly string[];
  globalLimit: number;
  caseLimit: number;
  globalFormatRepairLimit: number;
  planContentRepairLimit: number;
  caseContentRepairLimit: number;
  naturalDraftOnly?: boolean;
}

/**
 * Attempt27/28 的费用边界位于 Ark `responses.create` 最内层。所有计数都在委托
 * 之前同步完成；即使三条路线并发，A28 第三次单方案内容修复、单批第七次
 * 内容修复、A27 第二次自然格式恢复/第四次强制格式恢复、A28 第二次全局
 * 格式恢复和总物理硬帽也无法越过边界后才被发现。
 */
export class PromptWizardCanaryPhysicalRequestGuard
implements PromptWizardCanaryResponsesClient {
  private activeCaseId: string | null = null;
  private readonly caseIds: readonly string[];
  private readonly caseIdSet: ReadonlySet<string>;
  private readonly caseCounts = new Map<string, number>();
  private readonly caseOperationCounts = new Map<string, PromptWizardCanaryOperationCounts>();
  private readonly casePlanContentRepairCounts = new Map<string, [number, number, number]>();
  private readonly casePlanGenerateCounts = new Map<string, [number, number, number]>();
  private readonly operationCounts = emptyOperationCounts();
  private globalCount = 0;
  private attempt27RecoveryProbePlanIndex: 0 | 1 | 2 | null = null;
  private attempt27NaturalFormatRepairCount = 0;
  private attempt27ForcedFormatRepairCount = 0;
  private readonly attempt27CaseNaturalFormatRepairCounts = new Map<string, number>();
  private readonly attempt27CaseForcedFormatRepairCounts = new Map<string, number>();

  constructor(
    private readonly delegate: PromptWizardCanaryResponsesClient,
    private readonly options: PromptWizardCanaryPhysicalRequestGuardOptions,
  ) {
    this.caseIds = [...options.caseIds];
    this.caseIdSet = new Set(this.caseIds);
    if (
      this.caseIds.length === 0
      || this.caseIdSet.size !== this.caseIds.length
      || options.globalLimit < 1
      || options.caseLimit < 1
      || options.globalFormatRepairLimit < 0
      || options.planContentRepairLimit < 0
      || options.caseContentRepairLimit < 0
    ) {
      throw promptWizardCanaryPhysicalBudgetError(options.attempt);
    }
  }

  enterCase(caseId: string) {
    if (!this.caseIdSet.has(caseId) || this.activeCaseId !== null) {
      throw promptWizardCanaryPhysicalBudgetError(this.options.attempt);
    }
    this.activeCaseId = caseId;
    this.attempt27RecoveryProbePlanIndex = null;
  }

  beginAttempt27FormatRecoveryProbe(planIndex: 0 | 1 | 2) {
    if (
      this.options.attempt !== 27
      || !this.options.naturalDraftOnly
      || this.activeCaseId === null
      || this.attempt27RecoveryProbePlanIndex !== null
    ) {
      throw promptWizardCanaryPhysicalBudgetError(this.options.attempt);
    }
    const operations = this.caseOperationCounts.get(this.activeCaseId)
      ?? emptyOperationCounts();
    const naturalFormatRepairCount = this.attempt27CaseNaturalFormatRepairCounts
      .get(this.activeCaseId) ?? 0;
    const forcedFormatRepairCount = this.attempt27CaseForcedFormatRepairCounts
      .get(this.activeCaseId) ?? 0;
    if (
      operations['generate-drafts'] !== 3
      || operations['repair-draft-format'] !== naturalFormatRepairCount
      || operations['repair-draft-content'] !== 0
      || naturalFormatRepairCount > PROMPT_WIZARD_ATTEMPT27_NATURAL_FORMAT_REPAIR_LIMIT
      || forcedFormatRepairCount !== 0
      || this.attempt27ForcedFormatRepairCount
        >= PROMPT_WIZARD_ATTEMPT27_FORCED_FORMAT_REPAIR_LIMIT
    ) {
      throw promptWizardCanaryPhysicalBudgetError(this.options.attempt);
    }
    this.attempt27RecoveryProbePlanIndex = planIndex;
  }

  leaveCase(caseId: string) {
    if (this.activeCaseId !== caseId) {
      throw promptWizardCanaryPhysicalBudgetError(this.options.attempt);
    }
    this.activeCaseId = null;
    this.attempt27RecoveryProbePlanIndex = null;
  }

  snapshot(): PromptWizardCanaryPhysicalRequestSnapshot {
    return {
      globalCount: this.globalCount,
      caseCounts: Object.fromEntries(this.caseIds.map(caseId => [
        caseId,
        this.caseCounts.get(caseId) ?? 0,
      ])),
      operationCounts: { ...this.operationCounts },
      caseOperationCounts: Object.fromEntries(this.caseIds.map(caseId => [
        caseId,
        { ...(this.caseOperationCounts.get(caseId) ?? emptyOperationCounts()) },
      ])),
      casePlanContentRepairCounts: Object.fromEntries(this.caseIds.map(caseId => [
        caseId,
        [...(this.casePlanContentRepairCounts.get(caseId) ?? [0, 0, 0])],
      ])),
    };
  }

  create(
    request: ArkPromptWizardResponsesRequest,
    options: { timeoutMs: number },
  ): Promise<ArkPromptWizardResponsesResult> {
    const identity = promptWizardCanaryPhysicalRequestIdentity(request);
    const caseId = this.activeCaseId;
    if (!caseId || !identity) {
      return Promise.reject(promptWizardCanaryPhysicalBudgetError(this.options.attempt));
    }

    const caseCount = this.caseCounts.get(caseId) ?? 0;
    const caseOperations = this.caseOperationCounts.get(caseId) ?? emptyOperationCounts();
    const planContentCounts = this.casePlanContentRepairCounts.get(caseId) ?? [0, 0, 0];
    const planGenerateCounts = this.casePlanGenerateCounts.get(caseId) ?? [0, 0, 0];
    const isAttempt27NaturalPhase = this.options.attempt === 27
      && this.options.naturalDraftOnly
      && this.attempt27RecoveryProbePlanIndex === null;
    const isAttempt27ProbePhase = this.options.attempt === 27
      && this.options.naturalDraftOnly
      && this.attempt27RecoveryProbePlanIndex !== null;
    const isAttempt27NaturalFormatRepair = isAttempt27NaturalPhase
      && identity.operation === 'repair-draft-format';
    const isAttempt27ForcedFormatRepair = isAttempt27ProbePhase
      && identity.operation === 'repair-draft-format';
    const attempt27CaseNaturalFormatRepairCount = this.attempt27CaseNaturalFormatRepairCounts
      .get(caseId) ?? 0;
    const attempt27CaseForcedFormatRepairCount = this.attempt27CaseForcedFormatRepairCounts
      .get(caseId) ?? 0;

    if (
      (isAttempt27NaturalPhase
        && identity.operation !== 'generate-drafts'
        && identity.operation !== 'repair-draft-format')
      || (isAttempt27NaturalFormatRepair && (
        this.attempt27NaturalFormatRepairCount
          >= PROMPT_WIZARD_ATTEMPT27_NATURAL_FORMAT_REPAIR_LIMIT
        || attempt27CaseNaturalFormatRepairCount >= 1
        || planGenerateCounts[identity.planIndex] !== 1
      ))
      || (isAttempt27ProbePhase && (
        identity.operation !== 'repair-draft-format'
        || identity.planIndex !== this.attempt27RecoveryProbePlanIndex
        || attempt27CaseForcedFormatRepairCount !== 0
        || this.attempt27ForcedFormatRepairCount
          >= PROMPT_WIZARD_ATTEMPT27_FORCED_FORMAT_REPAIR_LIMIT
      ))
      || caseCount >= this.options.caseLimit
      || this.globalCount >= this.options.globalLimit
      || (
        identity.operation === 'repair-draft-format'
        && this.operationCounts['repair-draft-format'] >= this.options.globalFormatRepairLimit
      )
      || (
        identity.operation === 'generate-drafts'
        && planGenerateCounts[identity.planIndex] >= 1
      )
      || (
        identity.operation === 'repair-draft-content'
        && (
          planContentCounts[identity.planIndex] >= this.options.planContentRepairLimit
          || caseOperations['repair-draft-content'] >= this.options.caseContentRepairLimit
        )
      )
    ) {
      return Promise.reject(promptWizardCanaryPhysicalBudgetError(this.options.attempt));
    }

    this.caseCounts.set(caseId, caseCount + 1);
    this.globalCount += 1;
    caseOperations[identity.operation] += 1;
    this.operationCounts[identity.operation] += 1;
    this.caseOperationCounts.set(caseId, caseOperations);
    if (identity.operation === 'generate-drafts') {
      planGenerateCounts[identity.planIndex] += 1;
      this.casePlanGenerateCounts.set(caseId, planGenerateCounts);
    }
    if (identity.operation === 'repair-draft-content') {
      planContentCounts[identity.planIndex] += 1;
      this.casePlanContentRepairCounts.set(caseId, planContentCounts);
    }
    if (isAttempt27NaturalFormatRepair) {
      this.attempt27NaturalFormatRepairCount += 1;
      this.attempt27CaseNaturalFormatRepairCounts.set(
        caseId,
        attempt27CaseNaturalFormatRepairCount + 1,
      );
    }
    if (isAttempt27ForcedFormatRepair) {
      this.attempt27ForcedFormatRepairCount += 1;
      this.attempt27CaseForcedFormatRepairCounts.set(
        caseId,
        attempt27CaseForcedFormatRepairCount + 1,
      );
    }
    return this.delegate.create(request, options);
  }
}

export function createPromptWizardAttempt27PhysicalRequestGuard(
  delegate: PromptWizardCanaryResponsesClient,
  caseIds: readonly string[],
) {
  return new PromptWizardCanaryPhysicalRequestGuard(delegate, {
    attempt: 27,
    caseIds,
    globalLimit: PROMPT_WIZARD_ATTEMPT27_GLOBAL_PHYSICAL_REQUEST_LIMIT,
    caseLimit: PROMPT_WIZARD_ATTEMPT27_CASE_PHYSICAL_REQUEST_LIMIT,
    globalFormatRepairLimit: PROMPT_WIZARD_ATTEMPT27_GLOBAL_FORMAT_REPAIR_LIMIT,
    planContentRepairLimit: 0,
    caseContentRepairLimit: 0,
    naturalDraftOnly: true,
  });
}

export function createPromptWizardAttempt28PhysicalRequestGuard(
  delegate: PromptWizardCanaryResponsesClient,
  caseIds: readonly string[],
) {
  return new PromptWizardCanaryPhysicalRequestGuard(delegate, {
    attempt: 28,
    caseIds,
    globalLimit: PROMPT_WIZARD_ATTEMPT28_GLOBAL_PHYSICAL_REQUEST_LIMIT,
    caseLimit: PROMPT_WIZARD_ATTEMPT28_CASE_PHYSICAL_REQUEST_LIMIT,
    globalFormatRepairLimit: PROMPT_WIZARD_ATTEMPT28_GLOBAL_FORMAT_REPAIR_LIMIT,
    planContentRepairLimit: PROMPT_WIZARD_ATTEMPT28_PLAN_CONTENT_REPAIR_LIMIT,
    caseContentRepairLimit: PROMPT_WIZARD_ATTEMPT28_CASE_CONTENT_REPAIR_LIMIT,
  });
}

export function normalizePromptWizardCanaryPhysicalRequestSnapshot(
  value: unknown,
  limits: PromptWizardCanaryPhysicalSnapshotLimits,
): PromptWizardCanaryPhysicalRequestSnapshot {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'globalCount',
      'caseCounts',
      'operationCounts',
      'caseOperationCounts',
      'casePlanContentRepairCounts',
    ])
    || !isBoundedInteger(value.globalCount, limits.globalLimit)
    || !isRecord(value.caseCounts)
    || !isRecord(value.operationCounts)
    || !isRecord(value.caseOperationCounts)
    || !isRecord(value.casePlanContentRepairCounts)
  ) {
    throw promptWizardCanaryPhysicalEvidenceError(limits.attempt);
  }
  const expectedCaseIds = [...limits.caseIds];
  const planContentRepairLimit = limits.attempt === 28
    ? PROMPT_WIZARD_ATTEMPT28_PLAN_CONTENT_REPAIR_LIMIT
    : 0;
  const caseContentRepairLimit = limits.attempt === 28
    ? PROMPT_WIZARD_ATTEMPT28_CASE_CONTENT_REPAIR_LIMIT
    : 0;
  if (
    new Set(expectedCaseIds).size !== expectedCaseIds.length
    || !hasExactKeys(value.caseCounts, expectedCaseIds)
    || !hasExactKeys(value.caseOperationCounts, expectedCaseIds)
    || !hasExactKeys(value.casePlanContentRepairCounts, expectedCaseIds)
  ) {
    throw promptWizardCanaryPhysicalEvidenceError(limits.attempt);
  }
  const operationCounts = normalizeOperationCounts(
    value.operationCounts,
    limits.globalLimit,
    limits.attempt,
  );
  if (operationCounts['repair-draft-format'] > limits.globalFormatRepairLimit) {
    throw promptWizardCanaryPhysicalEvidenceError(limits.attempt);
  }
  const caseCounts: Record<string, number> = {};
  const caseOperationCounts: Record<string, PromptWizardCanaryOperationCounts> = {};
  const casePlanContentRepairCounts: Record<string, [number, number, number]> = {};
  const summedOperations = emptyOperationCounts();
  let summedCases = 0;
  let zeroPrefixReached = false;
  for (const caseId of expectedCaseIds) {
    const rawCaseCount = value.caseCounts[caseId];
    const rawCaseOperations = value.caseOperationCounts[caseId];
    const rawPlanContentCounts = value.casePlanContentRepairCounts[caseId];
    if (
      !isBoundedInteger(rawCaseCount, limits.caseLimit)
      || !Array.isArray(rawPlanContentCounts)
      || rawPlanContentCounts.length !== 3
      || rawPlanContentCounts.some(count => (
        !isBoundedInteger(count, planContentRepairLimit)
      ))
      || (zeroPrefixReached && Number(rawCaseCount) > 0)
    ) {
      throw promptWizardCanaryPhysicalEvidenceError(limits.attempt);
    }
    if (Number(rawCaseCount) === 0) zeroPrefixReached = true;
    const normalizedOperations = normalizeOperationCounts(
      rawCaseOperations,
      limits.caseLimit,
      limits.attempt,
    );
    const planContentCounts = rawPlanContentCounts.map(Number) as [number, number, number];
    const caseOperationTotal = PROMPT_WIZARD_CANARY_PHYSICAL_OPERATIONS.reduce(
      (sum, operation) => sum + normalizedOperations[operation],
      0,
    );
    if (
      caseOperationTotal !== Number(rawCaseCount)
      || normalizedOperations['repair-draft-content']
        !== planContentCounts.reduce((sum, count) => sum + count, 0)
      || normalizedOperations['repair-draft-content'] > caseContentRepairLimit
      || normalizedOperations['repair-draft-format'] > (limits.attempt === 27 ? 2 : 1)
    ) {
      throw promptWizardCanaryPhysicalEvidenceError(limits.attempt);
    }
    caseCounts[caseId] = Number(rawCaseCount);
    caseOperationCounts[caseId] = normalizedOperations;
    casePlanContentRepairCounts[caseId] = planContentCounts;
    summedCases += Number(rawCaseCount);
    PROMPT_WIZARD_CANARY_PHYSICAL_OPERATIONS.forEach(operation => {
      summedOperations[operation] += normalizedOperations[operation];
    });
  }
  if (
    summedCases !== Number(value.globalCount)
    || PROMPT_WIZARD_CANARY_PHYSICAL_OPERATIONS.some(operation => (
      summedOperations[operation] !== operationCounts[operation]
    ))
  ) {
    throw promptWizardCanaryPhysicalEvidenceError(limits.attempt);
  }
  return {
    globalCount: Number(value.globalCount),
    caseCounts,
    operationCounts,
    caseOperationCounts,
    casePlanContentRepairCounts,
  };
}

function promptWizardCanaryPhysicalRequestIdentity(request: ArkPromptWizardResponsesRequest) {
  const schemaName = request.text?.format?.name;
  if (typeof schemaName !== 'string') return null;
  const match = /^prompt_wizard_use_direction_plan_([1-3])_(generate_drafts|repair_draft_format|repair_draft_content)$/u
    .exec(schemaName);
  if (!match) return null;
  const planIndex = Number(match[1]) - 1;
  const encodedOperation = match[2];
  if (planIndex !== 0 && planIndex !== 1 && planIndex !== 2) return null;
  const operation = encodedOperation === 'generate_drafts'
    ? 'generate-drafts'
    : encodedOperation === 'repair_draft_format'
      ? 'repair-draft-format'
      : 'repair-draft-content';
  return { planIndex, operation } as const;
}

function emptyOperationCounts(): PromptWizardCanaryOperationCounts {
  return {
    'generate-drafts': 0,
    'repair-draft-format': 0,
    'repair-draft-content': 0,
  };
}

function normalizeOperationCounts(
  value: unknown,
  maximum: number,
  attempt: 27 | 28,
): PromptWizardCanaryOperationCounts {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [...PROMPT_WIZARD_CANARY_PHYSICAL_OPERATIONS])
    || PROMPT_WIZARD_CANARY_PHYSICAL_OPERATIONS.some(operation => (
      !isBoundedInteger(value[operation], maximum)
    ))
  ) {
    throw promptWizardCanaryPhysicalEvidenceError(attempt);
  }
  return {
    'generate-drafts': Number(value['generate-drafts']),
    'repair-draft-format': Number(value['repair-draft-format']),
    'repair-draft-content': Number(value['repair-draft-content']),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === expected.length
    && actual.every(key => expected.includes(key))
    && expected.every(key => Object.hasOwn(value, key));
}

function isBoundedInteger(value: unknown, maximum: number) {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= maximum;
}

function promptWizardCanaryPhysicalBudgetError(attempt: 27 | 28) {
  return Object.assign(new Error(`Attempt${attempt} Provider 物理请求预算已耗尽或操作无效`), {
    code: 'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED',
    retryable: false,
    // 该错误只会在 Canary 的 responses.create 外层门禁中产生，
    // 委托的 HTTP Client 尚未被调用。显式标记为 preflight block，
    // 避免 Provider 通用运行时把它误记为一次真实外呼失败。
    providerRequestAttempted: false,
    providerRequestPreflightBlocked: true,
  });
}

function promptWizardCanaryPhysicalEvidenceError(attempt: 27 | 28) {
  return Object.assign(new Error(`Attempt${attempt} 物理请求证据无效`), {
    code: 'PROMPT_WIZARD_CANARY_EVIDENCE_INVALID',
  });
}
