import type {
  PromptWizardEvidence,
  PromptWizardEvidenceGraph,
  PromptWizardProductProfile,
} from '@lindyson/api-contracts';
import type { PromptWizardShotRole } from './promptWizardDirectionBlueprint.js';
import {
  isPromptWizardLegacyPlanIndex,
  isPromptWizardPlanIndex,
} from './promptWizardPlanCount.js';
import { buildPromptWizardFactCatalog } from './promptWizardPrompt.js';

interface PromptWizardEvidenceAllocationInput {
  evidenceGraph: PromptWizardEvidenceGraph;
  shotRoles: readonly PromptWizardShotRole[];
  planIndex: number;
  /**
   * 缺省沿用 V4/V5 的双方案边界；V6 调用必须显式声明 6，才允许索引 2。
   * 这样历史调用不会因为共享的全局 PlanIndex 类型扩展而静默改变行为。
   */
  deliveryVersion?: 4 | 5 | 6;
  /**
   * 创意导演已经选定的事实 ID。提供后必须只从这些事实中分配证据，
   * 防止 Provider 输入、响应解码与最终事实门禁分别轮转到不同事实。
   */
  preferredFactIds?: readonly string[];
}

export interface PromptWizardEvidenceAllocation {
  proofPoints: string[];
  evidenceRefsByShot: string[][];
}

export class PromptWizardEvidenceAllocationError extends Error {
  readonly code = 'PROMPT_WIZARD_EVIDENCE_UNAVAILABLE';

  constructor(message = '没有可用于产品自证的已确认事实') {
    super(message);
    this.name = 'PromptWizardEvidenceAllocationError';
  }
}

const EVIDENCE_REQUIRED_ROLES = new Set<PromptWizardShotRole>([
  'proof',
  'proof-resolution',
  'resolution',
]);

const FACT_SOURCE_PRIORITY: Readonly<Record<string, number>> = {
  visible: 0,
  confirmed: 1,
  'profile:structure': 2,
  'profile:logo': 3,
  'profile:usage': 4,
  'profile:materials': 5,
  'profile:category': 6,
  'profile:productName': 7,
};

/**
 * 为方案预审和每个镜头确定性分配可追溯的产品事实。
 *
 * 事实只来自 `buildPromptWizardFactCatalog`，不使用待确认内容。
 * 同一输入始终得到同一结果；在事实数量允许时，同一批次的各方案从不同
 * 事实开始，避免每个方案都用同一个自证点。
 */
export function allocatePromptWizardEvidence(
  input: PromptWizardEvidenceAllocationInput,
): PromptWizardEvidenceAllocation {
  const hasValidDeliveryVersion = input.deliveryVersion === undefined
    || input.deliveryVersion === 4
    || input.deliveryVersion === 5
    || input.deliveryVersion === 6;
  const hasValidPlanIndex = input.deliveryVersion === 6
    ? isPromptWizardPlanIndex(input.planIndex)
    : isPromptWizardLegacyPlanIndex(input.planIndex);
  if (
    !hasValidDeliveryVersion
    || !Number.isSafeInteger(input.planIndex)
    || !hasValidPlanIndex
  ) {
    throw new RangeError(input.deliveryVersion === 6
      ? 'planIndex 必须是 0、1 或 2'
      : 'planIndex 必须是 0 或 1');
  }

  const reliableCatalog = input.evidenceGraph.reliableEvidenceIds
    .map(id => input.evidenceGraph.evidences.find(item => item.id === id))
    .filter((item): item is PromptWizardEvidence => Boolean(item))
    .map(item => ({ id: item.id, text: item.text }));
  const reliableById = new Map(reliableCatalog.map(fact => [fact.id, fact]));
  const preferredFactIds = Array.from(new Set(input.preferredFactIds ?? []));
  const catalog = preferredFactIds.length > 0
    ? preferredFactIds.map((factId) => {
      const fact = reliableById.get(factId);
      if (!fact) {
        throw new PromptWizardEvidenceAllocationError(
          `创意方案引用了不可用的产品事实：${factId}`,
        );
      }
      return fact;
    })
    : reliableCatalog;
  if (catalog.length === 0) {
    throw new PromptWizardEvidenceAllocationError();
  }

  const requiredShotIndexes = input.shotRoles
    .map((role, shotIndex) => EVIDENCE_REQUIRED_ROLES.has(role) ? shotIndex : -1)
    .filter(shotIndex => shotIndex >= 0);
  const evidenceRefsByShot = input.shotRoles.map((): string[] => []);
  const allocatedFacts: typeof catalog = [];
  const startIndex = input.planIndex % catalog.length;

  requiredShotIndexes.forEach((shotIndex, requiredIndex) => {
    const fact = catalog[(startIndex + requiredIndex) % catalog.length]!;
    evidenceRefsByShot[shotIndex] = [fact.id];
    if (!allocatedFacts.some(item => item.id === fact.id)) allocatedFacts.push(fact);
  });

  // 标准时长始终包含至少一个自证镜头。此回退仅用于容错非标准调用，
  // 保证 planningReview 仍有一项严格可追溯的事实。
  if (allocatedFacts.length === 0) allocatedFacts.push(catalog[startIndex]!);

  return {
    proofPoints: allocatedFacts.map(item => item.text),
    evidenceRefsByShot,
  };
}

/**
 * 返回可被证据图谱、创意导演、Provider 输入和响应解码共同引用的权威事实目录。
 *
 * 产品档案偶尔会在结构化字段和 visibleFacts 中重复同一句事实。这里按既有
 * 可信来源优先级确定性去重，避免创意导演选中随后会被证据分配器淘汰的别名 ID。
 */
export function buildPromptWizardReliableFactCatalog(profile: PromptWizardProductProfile) {
  const seenTexts = new Set<string>();
  return buildPromptWizardFactCatalog(profile)
    .map((fact, sourceIndex) => ({
      ...fact,
      sourceIndex,
      priority: factPriority(fact.id),
    }))
    .sort((left, right) => left.priority - right.priority || left.sourceIndex - right.sourceIndex)
    .filter((fact) => {
      const normalizedText = fact.text.normalize('NFKC').trim().replace(/\s+/gu, ' ');
      if (!normalizedText || seenTexts.has(normalizedText)) return false;
      seenTexts.add(normalizedText);
      return true;
    })
    .map(({ id, text }) => ({ id, text }));
}

function factPriority(id: string) {
  if (id.startsWith('visible:')) return FACT_SOURCE_PRIORITY.visible!;
  if (id.startsWith('confirmed:')) return FACT_SOURCE_PRIORITY.confirmed!;
  return FACT_SOURCE_PRIORITY[id] ?? Number.MAX_SAFE_INTEGER;
}
