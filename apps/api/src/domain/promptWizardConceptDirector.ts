import { z } from 'zod';
import {
  promptWizardConceptPreviewSchema,
  type PromptWizardConceptPreview,
  type PromptWizardCreativeBrief,
  type PromptWizardEvidence,
  type PromptWizardEvidenceGraph,
  type PromptWizardProductionBrief,
  type PromptWizardProductionLoad,
  type PromptWizardVideoConfig,
} from '@lindyson/api-contracts';
import {
  type PromptWizardConceptAssignment,
  type PromptWizardConceptFingerprint,
  type PromptWizardConceptScore,
} from './promptWizardConceptContext.js';
import {
  buildPromptWizardCreativePlaybook,
} from './promptWizardCreativePlaybook.js';
import {
  assertPromptWizardExecutionBudget,
  validatePromptWizardExecutionBudget,
} from './promptWizardExecutionBudget.js';
import {
  promptWizardEvidenceById,
} from './promptWizardEvidenceGraph.js';
import {
  findPromptWizardUnconfirmedClaimFieldPaths,
  findPromptWizardUnsupportedRiskFieldPaths,
  isPromptWizardChineseDominant,
  type PromptWizardPlanDraft,
  type PromptWizardStringLeaf,
} from './promptWizardPrompt.js';
import type { PromptWizardPlanIndex } from './promptWizardPlanCount.js';

export const PROMPT_WIZARD_CONCEPT_PREVIEW_COUNT = 8 as const;
export const PROMPT_WIZARD_CONCEPT_ROLE_COUNT = 4 as const;
export const PROMPT_WIZARD_MIN_COMPLEMENTARY_DIMENSIONS = 4 as const;

export const promptWizardConceptPreviewBatchSchema = z.array(
  promptWizardConceptPreviewSchema,
).length(PROMPT_WIZARD_CONCEPT_PREVIEW_COUNT);

export type PromptWizardConceptValidationIssueCode =
  | 'SCHEMA_INVALID'
  | 'CONCEPT_COUNT_INVALID'
  | 'ROLE_BALANCE_INVALID'
  | 'DUPLICATE_ID'
  | 'DUPLICATE_RANK'
  | 'DUPLICATE_CONCEPT'
  | 'HISTORICAL_CONCEPT_DUPLICATE'
  | 'DIRECTION_MISMATCH'
  | 'DIRECTION_UNAVAILABLE'
  | 'FIRST_SECOND_EVENT_NOT_PHYSICAL'
  | 'FIRST_SECOND_EVENT_PRODUCT_UNCLEAR'
  | 'PURCHASE_REASON_EVIDENCE_MISSING'
  | 'PURCHASE_REASON_EVIDENCE_UNSUPPORTED'
  | 'PURCHASE_REASON_MULTIPLE'
  | 'CAUSAL_CHAIN_INVALID'
  | 'EVIDENCE_INVALID'
  | 'CONTENT_LANGUAGE_INVALID'
  | 'UNCONFIRMED_CLAIM'
  | 'UNSAFE_CONTENT'
  | 'CTA_NOT_CALLBACK'
  | 'REQUIRED_ASSET_UNAVAILABLE'
  | 'SCENE_UNAVAILABLE'
  | 'TALENT_MODE_MISMATCH'
  | 'EXECUTION_BUDGET_EXCEEDED';

export interface PromptWizardConceptValidationIssue {
  code: PromptWizardConceptValidationIssueCode;
  fieldPath: string;
  conceptId?: string;
  message: string;
}

export interface PromptWizardConceptSetValidationResult {
  valid: boolean;
  concepts: PromptWizardConceptPreview[];
  issues: PromptWizardConceptValidationIssue[];
}

export class PromptWizardConceptSetValidationError extends Error {
  readonly code = 'PROMPT_WIZARD_CONCEPT_SET_INVALID';

  constructor(readonly issues: PromptWizardConceptValidationIssue[]) {
    super(`创意路线未通过本地门禁：${issues.map(issue => issue.fieldPath).join('、')}`);
    this.name = 'PromptWizardConceptSetValidationError';
  }
}

export class PromptWizardConceptExpansionError extends Error {
  readonly code = 'PROMPT_WIZARD_CONCEPT_DRIFT';

  constructor(readonly fieldPaths: string[]) {
    super(`脚本扩写偏离已选创意路线：${fieldPaths.join('、')}`);
    this.name = 'PromptWizardConceptExpansionError';
  }
}

export interface PromptWizardSelectedConceptPair {
  primary: PromptWizardConceptPreview;
  secondary: PromptWizardConceptPreview;
  primaryConceptId: string;
  secondaryConceptId: string;
  complementaryDimensions: number;
}

const PHYSICAL_ACTION_PATTERN = /(?:拿|放|按|压|拨|推|拉|旋|拧|折|开|合|扣|穿|戴|取|倒|滴|喷|涂|刷|擦|撕|拆|插|拔|滑|转|抬|落|展开|收起|点亮|熄灭|出现|揭开|切开|移动|停住|碰|敲|晃|展示)/u;
const PRODUCT_REFERENCE_PATTERN = /(?:产品|商品|包装|盒|瓶|衣|鞋|包|耳机|手机|设备|杯|锅|刷|按钮|屏幕|Logo|印花|材质|结构)/iu;
const GENERIC_CTA_PATTERN = /^(?:立即|马上|现在)?(?:点击|下单|购买|抢购|入手|带走)(?:它|这款|一个)?[！!。.]?$/u;
const CONCEPT_ROLES = ['reliable-conversion', 'creative-breakthrough'] as const;

export function validatePromptWizardConceptSet(input: {
  concepts: unknown;
  evidenceGraph: PromptWizardEvidenceGraph;
  brief: PromptWizardCreativeBrief;
  config: Pick<PromptWizardVideoConfig, 'model' | 'durationSeconds'>;
  productionBrief: PromptWizardProductionBrief;
  /** 只允许同一 run 内的历史路线参与去重；跨 run 不建立创意指纹。 */
  historicalConcepts?: readonly PromptWizardConceptPreview[];
}): PromptWizardConceptSetValidationResult {
  const parsed = promptWizardConceptPreviewBatchSchema.safeParse(input.concepts);
  if (!parsed.success) {
    return {
      valid: false,
      concepts: [],
      issues: parsed.error.issues.map(issue => ({
        code: issue.path.length === 0 ? 'CONCEPT_COUNT_INVALID' : 'SCHEMA_INVALID',
        fieldPath: issue.path.length > 0 ? `concepts.${issue.path.join('.')}` : 'concepts',
        message: issue.message,
      })),
    };
  }

  const concepts = parsed.data;
  const issues: PromptWizardConceptValidationIssue[] = [];
  const ids = new Set<string>();
  const ranks = new Set<number>();
  const evidenceById = promptWizardEvidenceById(input.evidenceGraph);
  const reliableEvidenceIds = new Set(input.evidenceGraph.reliableEvidenceIds);
  const reliableEvidence = input.evidenceGraph.evidences.filter(item => (
    reliableEvidenceIds.has(item.id)
  ));
  const confirmedClaims = reliableEvidence
    .filter(item => item.status === 'user-confirmed')
    .map(item => item.text)
    .join('\n');
  const allowedLatinTokens = new Set(
    reliableEvidence.flatMap(item => (
      Array.from(item.text.normalize('NFKC').matchAll(/\p{Script=Latin}+/gu), match => (
        match[0].toLocaleLowerCase('en-US')
      ))
    )),
  );
  // Playbook 是产品族 × 主方向 × 证据能力的权威本地边界，而不只是 UI 推荐文案。
  const playbook = buildPromptWizardCreativePlaybook({
    graph: input.evidenceGraph,
    productionBrief: input.productionBrief,
    direction: input.brief.direction,
  });

  const roleCounts = countBy(concepts, concept => concept.role);
  for (const role of CONCEPT_ROLES) {
    if ((roleCounts.get(role) ?? 0) !== PROMPT_WIZARD_CONCEPT_ROLE_COUNT) {
      issues.push({
        code: 'ROLE_BALANCE_INVALID',
        fieldPath: 'concepts',
        message: `${role} 必须恰好提供 ${PROMPT_WIZARD_CONCEPT_ROLE_COUNT} 条路线。`,
      });
    }
  }
  if (playbook.assessment.availability === 'unavailable') {
    issues.push({
      code: 'DIRECTION_UNAVAILABLE',
      fieldPath: 'brief.direction',
      message: playbook.assessment.reason,
    });
  }

  concepts.forEach((concept, index) => {
    const prefix = `concepts.${index}`;
    if (ids.has(concept.id)) add('DUPLICATE_ID', 'id', '创意路线 ID 必须唯一。');
    ids.add(concept.id);
    if (ranks.has(concept.rank)) add('DUPLICATE_RANK', 'rank', '八条创意路线的 rank 必须唯一。');
    ranks.add(concept.rank);
    if (concept.direction !== input.brief.direction) {
      add('DIRECTION_MISMATCH', 'direction', '创意路线不得偏离用户选择的主创作方向。');
    }
    if (!PHYSICAL_ACTION_PATTERN.test(concept.firstSecondEvent)) {
      add('FIRST_SECOND_EVENT_NOT_PHYSICAL', 'firstSecondEvent', '第一秒必须发生可拍摄的物理动作、状态变化或揭晓。');
    }
    if (!firstEventMentionsProduct(concept.firstSecondEvent, input.evidenceGraph)) {
      add('FIRST_SECOND_EVENT_PRODUCT_UNCLEAR', 'firstSecondEvent', '第一秒必须让产品或具体产品问题可被理解。');
    }

    const referencedEvidence = concept.evidenceIds.map(id => evidenceById.get(id));
    concept.evidenceIds.forEach((id, evidenceIndex) => {
      const evidence = evidenceById.get(id);
      if (!evidence || !reliableEvidenceIds.has(id)) {
        issues.push({
          code: 'EVIDENCE_INVALID',
          fieldPath: `${prefix}.evidenceIds.${evidenceIndex}`,
          conceptId: concept.id,
          message: `引用了不存在、待确认或禁止使用的证据：${id}`,
        });
      }
    });
    if (!referencedEvidence.some(evidence => evidence && !['appearance', 'audience', 'scenario'].includes(evidence.type))) {
      add('PURCHASE_REASON_EVIDENCE_MISSING', 'purchaseReason', '核心购买理由必须连接至少一项可自证产品事实。');
    }
    const usableReferencedEvidence = referencedEvidence.filter((evidence): evidence is PromptWizardEvidence => (
      Boolean(evidence && reliableEvidenceIds.has(evidence.id))
    ));
    if (
      usableReferencedEvidence.length > 0
      && !purchaseReasonSupportedByEvidence(concept.purchaseReason, usableReferencedEvidence)
    ) {
      add(
        'PURCHASE_REASON_EVIDENCE_UNSUPPORTED',
        'purchaseReason',
        '核心购买理由与所引用证据的文字及可执行自证动作不一致。',
      );
    }
    if (containsMultiplePurchaseReasons(concept.purchaseReason)) {
      add('PURCHASE_REASON_MULTIPLE', 'purchaseReason', '一个视频只能保留一个核心购买理由。');
    }
    for (const field of validateConceptCausalChain(concept, usableReferencedEvidence)) {
      add(
        'CAUSAL_CHAIN_INVALID',
        field,
        '痛点、产品动作与可见结果必须围绕同一购买理由形成可拍摄的因果闭环。',
      );
    }
    if (GENERIC_CTA_PATTERN.test(concept.ctaCallback)) {
      add('CTA_NOT_CALLBACK', 'ctaCallback', 'CTA 必须回扣开场问题或购买理由，不能只是通用购买口令。');
    }
    const contentFields = conceptContentFields(concept, prefix);
    for (const field of contentFields) {
      const languageValue = [...reliableEvidenceIds].reduce(
        (value, evidenceId) => value.replaceAll(evidenceId, ''),
        field.value,
      );
      if (!isPromptWizardChineseDominant(languageValue, allowedLatinTokens)) {
        issues.push({
          code: 'CONTENT_LANGUAGE_INVALID',
          fieldPath: field.fieldPath,
          conceptId: concept.id,
          message: '创意路线说明必须以简体中文为主，品牌、型号与可见印花可保留原文。',
        });
      }
    }
    for (const fieldPath of findPromptWizardUnconfirmedClaimFieldPaths(
      contentFields,
      confirmedClaims,
    )) {
      issues.push({
        code: 'UNCONFIRMED_CLAIM',
        fieldPath,
        conceptId: concept.id,
        message: '创意路线包含未经用户确认的价格、数字、功效、认证或商业主张。',
      });
    }
    for (const fieldPath of findPromptWizardUnsupportedRiskFieldPaths(contentFields)) {
      issues.push({
        code: 'UNSAFE_CONTENT',
        fieldPath,
        conceptId: concept.id,
        message: '创意路线包含虚假社会证明、虚假稀缺、危险测试、魔法变化或竞品结论。',
      });
    }
    validateProductionConditions(concept, index, input.productionBrief, issues);
    for (const budgetIssue of validatePromptWizardExecutionBudget({
      productionLoad: concept.productionLoad,
      config: input.config,
      fieldPathPrefix: prefix,
    })) {
      issues.push({
        code: 'EXECUTION_BUDGET_EXCEEDED',
        fieldPath: budgetIssue.fieldPath,
        conceptId: concept.id,
        message: budgetIssue.message,
      });
    }

    function add(
      code: PromptWizardConceptValidationIssueCode,
      field: string,
      message: string,
    ) {
      issues.push({ code, fieldPath: `${prefix}.${field}`, conceptId: concept.id, message });
    }
  });

  for (let leftIndex = 0; leftIndex < concepts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < concepts.length; rightIndex += 1) {
      if (!promptWizardConceptsSemanticallyDuplicate(concepts[leftIndex]!, concepts[rightIndex]!)) {
        continue;
      }
      issues.push({
        code: 'DUPLICATE_CONCEPT',
        fieldPath: `concepts.${rightIndex}`,
        conceptId: concepts[rightIndex]!.id,
        message: `与本批路线 ${leftIndex + 1} 的开场、张力、主证据、场景视角和 CTA 过于相似。`,
      });
    }
  }

  const historicalConcepts = input.historicalConcepts ?? [];
  concepts.forEach((concept, index) => {
    if (!historicalConcepts.some(history => promptWizardConceptsSemanticallyDuplicate(concept, history))) {
      return;
    }
    issues.push({
      code: 'HISTORICAL_CONCEPT_DUPLICATE',
      fieldPath: `concepts.${index}`,
      conceptId: concept.id,
      message: '该路线与当前任务已经生成过的路线过于相似。',
    });
  });

  return { valid: issues.length === 0, concepts, issues };
}

function conceptContentFields(
  concept: PromptWizardConceptPreview,
  prefix: string,
): PromptWizardStringLeaf[] {
  return [
    ['title', concept.title],
    ['firstSecondEvent', concept.firstSecondEvent],
    ['viewerQuestion', concept.viewerQuestion],
    ['purchaseReason', concept.purchaseReason],
    ['tension', concept.tension],
    ['productAction', concept.productAction],
    ['visibleResult', concept.visibleResult],
    ['scene', concept.scene],
    ['perspective', concept.perspective],
    ['cameraGrammar', concept.cameraGrammar],
    ['ctaCallback', concept.ctaCallback],
    ...concept.requiredAssets.map((value, index) => [`requiredAssets.${index}`, value] as const),
    ...Object.entries(concept.strategy).map(([key, value]) => [`strategy.${key}`, value] as const),
  ].map(([fieldPath, value]) => ({ fieldPath: `${prefix}.${fieldPath}`, value }));
}

export function assertPromptWizardConceptSet(
  input: Parameters<typeof validatePromptWizardConceptSet>[0],
) {
  const result = validatePromptWizardConceptSet(input);
  if (!result.valid) throw new PromptWizardConceptSetValidationError(result.issues);
  return result.concepts;
}

export function selectPromptWizardConceptPair(
  concepts: readonly PromptWizardConceptPreview[],
): PromptWizardSelectedConceptPair {
  const reliable = concepts
    .filter(concept => concept.role === 'reliable-conversion')
    .sort(compareSelectionPriority);
  const bold = concepts
    .filter(concept => concept.role === 'creative-breakthrough')
    .sort(compareSelectionPriority);
  let best: { primary: PromptWizardConceptPreview; secondary: PromptWizardConceptPreview; difference: number; priority: number } | null = null;

  for (const primary of reliable) {
    for (const secondary of bold) {
      const difference = countPromptWizardConceptDifferences(primary, secondary);
      if (difference < PROMPT_WIZARD_MIN_COMPLEMENTARY_DIMENSIONS) continue;
      const priority = selectionPriority(primary) + selectionPriority(secondary) + (5 - difference) * 2;
      if (!best || priority < best.priority) best = { primary, secondary, difference, priority };
    }
  }
  if (!best) {
    throw new PromptWizardConceptSetValidationError([{
      code: 'SCHEMA_INVALID',
      fieldPath: 'concepts',
      message: '没有找到至少四项核心创意维度不同的可信转化型与强钩子型路线。',
    }]);
  }
  return {
    primary: best.primary,
    secondary: best.secondary,
    primaryConceptId: best.primary.id,
    secondaryConceptId: best.secondary.id,
    complementaryDimensions: best.difference,
  };
}

export function countPromptWizardConceptDifferences(
  left: PromptWizardConceptPreview,
  right: PromptWizardConceptPreview,
) {
  const dimensions = [
    textsMeaningfullyDifferent(left.firstSecondEvent, right.firstSecondEvent),
    textsMeaningfullyDifferent(left.tension, right.tension),
    left.evidenceIds[0] !== right.evidenceIds[0],
    textsMeaningfullyDifferent(`${left.scene} ${left.perspective}`, `${right.scene} ${right.perspective}`),
    textsMeaningfullyDifferent(left.ctaCallback, right.ctaCallback),
  ];
  return dimensions.filter(Boolean).length;
}

/**
 * 把 3.0 创意导演路线编译为双方案脚本 Provider 的执行上下文。
 * score 是内部结构的中性占位，不参与路线选择、门禁或排序。
 */
export function conceptPreviewToAssignment(
  preview: PromptWizardConceptPreview,
  planIndex: PromptWizardPlanIndex,
): PromptWizardConceptAssignment {
  assertPromptWizardExecutionBudget({
    productionLoad: preview.productionLoad,
    config: { model: 'seedance-2.0', durationSeconds: 15 },
  });
  const fingerprint: PromptWizardConceptFingerprint = {
    audienceMotivation: preview.purchaseReason,
    openingAction: preview.firstSecondEvent,
    scene: preview.scene,
    perspective: preview.perspective,
    evidenceMode: preview.evidenceIds.join('+'),
    cameraSoundGrammar: preview.cameraGrammar,
  };
  const score: PromptWizardConceptScore = {
    visualStop: 0,
    productSpecificity: 0,
    evidenceCredibility: 0,
    novelty: 0,
    directionPurity: 0,
    marketingFit: 0,
    feasibility: 0,
    total: 0,
  };
  return {
    planIndex,
    candidateId: preview.id,
    direction: preview.direction,
    strategy: preview.strategy,
    targetAudience: '由产品档案与创作简报确定的目标人群',
    audienceMotivation: preview.purchaseReason,
    openingAction: preview.firstSecondEvent,
    scene: preview.scene,
    perspective: preview.perspective,
    painExpression: preview.tension,
    progression: `${preview.viewerQuestion}；${preview.productAction}`,
    proofAction: preview.productAction,
    midpointEscalation: preview.visibleResult,
    visibleResult: preview.visibleResult,
    evidenceIds: [...preview.evidenceIds],
    evidenceFactIds: [...preview.evidenceIds],
    cameraSoundGrammar: preview.cameraGrammar,
    cta: preview.ctaCallback,
    fingerprint,
    score,
    conservative: false,
    providerContext: {
      creativePremise: `${preview.purchaseReason}；${preview.tension}`,
      opening: preview.firstSecondEvent,
      proof: preview.productAction,
      progression: preview.viewerQuestion,
      midpointEscalation: preview.visibleResult,
      visibleResult: preview.visibleResult,
      cameraAndSound: preview.cameraGrammar,
      cta: preview.ctaCallback,
    },
  };
}

function validateProductionConditions(
  concept: PromptWizardConceptPreview,
  index: number,
  brief: PromptWizardProductionBrief,
  issues: PromptWizardConceptValidationIssue[],
) {
  const prefix = `concepts.${index}`;
  const requirements = concept.requiredAssets.join(' ');
  const assets = new Set(brief.availableAssets);
  if (
    /(?:包装|外盒|礼盒|拆封|开箱)/u.test(requirements)
    && ![...assets].some(asset => /(?:包装|外盒|礼盒)/u.test(asset))
  ) {
    add('REQUIRED_ASSET_UNAVAILABLE', 'requiredAssets', '路线需要包装，但当前生产条件未提供包装素材。');
  }
  if (/(?:真人|人物|模特|演员)/u.test(requirements) && brief.appearanceMode !== 'person') {
    add('TALENT_MODE_MISMATCH', 'requiredAssets', '路线需要真人，但当前出镜条件不允许真人。');
  }
  if (brief.appearanceMode === 'product-only' && concept.productionLoad.personCount > 0) {
    add('TALENT_MODE_MISMATCH', 'productionLoad.personCount', '纯产品模式的人物数量必须为 0。');
  }
  if (brief.appearanceMode === 'hands-only' && concept.productionLoad.personCount > 0) {
    add('TALENT_MODE_MISMATCH', 'productionLoad.personCount', '手部模式不得安排完整人物出镜。');
  }
  if (
    brief.availableScenes.length > 0
    && !brief.availableScenes.some(scene => (
      concept.scene.includes(scene) || scene.includes(concept.scene)
    ))
  ) {
    add('SCENE_UNAVAILABLE', 'scene', '路线场景不在用户确认的可用场景内。');
  }

  function add(
    code: PromptWizardConceptValidationIssueCode,
    field: string,
    message: string,
  ) {
    issues.push({ code, fieldPath: `${prefix}.${field}`, conceptId: concept.id, message });
  }
}

function firstEventMentionsProduct(event: string, graph: PromptWizardEvidenceGraph) {
  if (PRODUCT_REFERENCE_PATTERN.test(event)) return true;
  const terms = graph.evidences
    .filter(item => ['appearance', 'structure', 'logo-print'].includes(item.type))
    .flatMap(item => meaningfulTerms(item.text));
  return terms.some(term => event.includes(term));
}

const PURCHASE_REASON_LIST_PATTERN = /(?:、|以及|并且|而且|同时|还(?:能|可|有)|又(?:能|可)|兼具|既[^，。；]{1,40}又)/u;
const OBSERVABLE_RESULT_PATTERN = /(?:可见|看见|看清|露出|呈现|显示|亮起|熄灭|打开|闭合|展开|收起|固定|对齐|进入画面|留在画面|状态|结构|图案|印花|Logo|轮廓|位置|声音|动作完成)/iu;
const SEMANTIC_STOP_TERMS = new Set([
  '产品', '商品', '这个', '这款', '当前', '观众', '画面', '镜头', '真实', '清楚',
  '可见', '完成', '进行', '展示', '使用', '动作', '状态', '问题', '结果', '细节',
]);

function purchaseReasonSupportedByEvidence(
  purchaseReason: string,
  evidences: readonly PromptWizardEvidence[],
) {
  return evidences.some(evidence => textSemanticOverlap(
    purchaseReason,
    [evidence.text, ...evidence.proofActions].join(' '),
  ));
}

function containsMultiplePurchaseReasons(value: string) {
  const normalized = value.normalize('NFKC').trim();
  if (!PURCHASE_REASON_LIST_PATTERN.test(normalized)) return false;
  // “正反面”“开合”等单一结构关系不等于多个购买理由；只有连接词两侧
  // 都保留实质语义时才判为卖点堆叠。
  const clauses = normalized
    .split(/(?:、|以及|并且|而且|同时|还(?:能|可|有)|又(?:能|可)|兼具)/u)
    .map(clause => semanticTerms(clause))
    .filter(terms => terms.size > 0);
  return clauses.length >= 2;
}

function validateConceptCausalChain(
  concept: PromptWizardConceptPreview,
  evidences: readonly PromptWizardEvidence[],
) {
  const invalid = new Set<'tension' | 'productAction' | 'visibleResult'>();
  const evidenceText = evidences
    .map(evidence => `${evidence.text} ${evidence.proofActions.join(' ')}`)
    .join(' ');

  if (!textSemanticOverlap(
    concept.tension,
    `${concept.viewerQuestion} ${concept.purchaseReason} ${concept.visibleResult}`,
  )) {
    invalid.add('tension');
  }
  if (!PHYSICAL_ACTION_PATTERN.test(concept.productAction)) {
    invalid.add('productAction');
  }
  if (
    !textSemanticOverlap(concept.productAction, concept.visibleResult)
    && !(
      textSemanticOverlap(concept.productAction, evidenceText)
      && textSemanticOverlap(concept.visibleResult, evidenceText)
    )
  ) {
    invalid.add('productAction');
    invalid.add('visibleResult');
  }
  if (
    !OBSERVABLE_RESULT_PATTERN.test(concept.visibleResult)
    || !textSemanticOverlap(concept.visibleResult, `${concept.purchaseReason} ${evidenceText}`)
  ) {
    invalid.add('visibleResult');
  }
  return [...invalid];
}

/**
 * 批内与同一 run 历史统一使用五个用户可感知维度去重。至少两个维度有
 * 实质差异才视为新路线，避免仅换标题、标签或近义词绕过。
 */
export function promptWizardConceptsSemanticallyDuplicate(
  left: PromptWizardConceptPreview,
  right: PromptWizardConceptPreview,
) {
  return countPromptWizardConceptDifferences(left, right) < 2;
}

/**
 * V4 扩写必须忠实保留用户选择的路线。3.0 独占运行后，所有公开扩写
 * 都必须先携带 conceptPreview 再进入这条门禁。
 */
export function assertPromptWizardConceptExpansion(input: {
  draft: PromptWizardPlanDraft;
  concept: PromptWizardConceptPreview;
  evidenceGraph: PromptWizardEvidenceGraph;
}) {
  const fieldPaths = new Set<string>();
  const firstSegment = input.draft.segments[0];
  const ctaSegment = input.draft.segments.at(-1);
  const evidenceById = promptWizardEvidenceById(input.evidenceGraph);
  const reliableIds = new Set(input.evidenceGraph.reliableEvidenceIds);
  const primaryEvidenceId = input.concept.evidenceIds[0];
  const primaryEvidence = primaryEvidenceId ? evidenceById.get(primaryEvidenceId) : undefined;

  if (
    !firstSegment
    || !PHYSICAL_ACTION_PATTERN.test(firstSegment.action)
    || !textSemanticOverlap(
      input.concept.firstSecondEvent,
      `${input.draft.hook} ${input.draft.planningReview.nonAdEntry} ${firstSegment.subject} ${firstSegment.action}`,
    )
  ) {
    fieldPaths.add('segments[0].action');
  }

  const purchaseReasonContext = [
    input.draft.hook,
    input.draft.narrative,
    input.draft.primaryScene,
    input.draft.planningReview.surfaceNeed,
    input.draft.planningReview.realPainPoint,
    input.draft.planningReview.directionFit,
  ].join(' ');
  if (!textSemanticOverlap(input.concept.purchaseReason, purchaseReasonContext)) {
    fieldPaths.add('narrative');
  }

  const evidenceSegments = input.draft.segments.filter(segment => (
    ['proof', 'proof-resolution', 'resolution'].includes(segment.role)
  ));
  if (
    !primaryEvidence
    || !reliableIds.has(primaryEvidence.id)
    || !evidenceSegments.some(segment => segment.evidenceRefs.includes(primaryEvidence.id))
  ) {
    fieldPaths.add('segments');
  }
  if (
    primaryEvidence
    && !input.draft.planningReview.proofPoints.some(point => (
      normalize(point) === normalize(primaryEvidence.text)
    ))
  ) {
    fieldPaths.add('planningReview.proofPoints');
  }

  const proofExecution = evidenceSegments.map(segment => segment.action).join(' ');
  if (
    !textSemanticOverlap(input.concept.productAction, proofExecution)
    && !(
      primaryEvidence
      && textSemanticOverlap(proofExecution, `${primaryEvidence.text} ${primaryEvidence.proofActions.join(' ')}`)
    )
  ) {
    fieldPaths.add('segments');
  }
  const resultSegments = input.draft.segments.filter(segment => (
    segment.role === 'proof-resolution' || segment.role === 'resolution'
  ));
  const resultExecution = `${input.draft.narrative} ${resultSegments.map(segment => segment.action).join(' ')}`;
  if (!textSemanticOverlap(input.concept.visibleResult, resultExecution)) {
    fieldPaths.add('narrative');
  }

  if (
    !ctaSegment
    || ctaSegment.role !== 'cta'
    || !textSemanticOverlap(
      input.concept.ctaCallback,
      `${ctaSegment.action} ${ctaSegment.productionNote} ${input.draft.narrative}`,
    )
  ) {
    fieldPaths.add(`segments[${Math.max(0, input.draft.segments.length - 1)}].action`);
  }

  if (fieldPaths.size > 0) throw new PromptWizardConceptExpansionError([...fieldPaths]);
}

function textSemanticOverlap(left: string, right: string) {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (
    (normalizedLeft.length >= 2 && normalizedRight.includes(normalizedLeft))
    || (normalizedRight.length >= 2 && normalizedLeft.includes(normalizedRight))
  ) return true;
  const leftTerms = semanticTerms(left);
  const rightTerms = semanticTerms(right);
  return [...leftTerms].some(term => rightTerms.has(term));
}

function semanticTerms(value: string) {
  const result = new Set<string>();
  const normalized = value.normalize('NFKC').toLowerCase();
  for (const token of normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    if (/^[\u3400-\u9fff]+$/u.test(token)) {
      if (token.length === 2 && !SEMANTIC_STOP_TERMS.has(token)) result.add(token);
      for (let index = 0; index <= token.length - 2; index += 1) {
        const term = token.slice(index, index + 2);
        if (!SEMANTIC_STOP_TERMS.has(term)) result.add(term);
      }
      continue;
    }
    if (token.length >= 3 && !SEMANTIC_STOP_TERMS.has(token)) result.add(token);
  }
  return result;
}

function meaningfulTerms(value: string) {
  return value
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap(token => {
      if (/^[\u3400-\u9fff]+$/u.test(token)) {
        return token.length <= 6
          ? [token]
          : Array.from({ length: token.length - 1 }, (_, index) => token.slice(index, index + 2));
      }
      return token.length >= 3 ? [token] : [];
    })
    .filter(term => term.length >= 2);
}

function compareSelectionPriority(left: PromptWizardConceptPreview, right: PromptWizardConceptPreview) {
  return selectionPriority(left) - selectionPriority(right) || left.id.localeCompare(right.id, 'zh-CN');
}

function selectionPriority(concept: PromptWizardConceptPreview) {
  const difficultyPenalty = concept.difficulty === 'low' ? 0 : concept.difficulty === 'medium' ? 2 : 5;
  const riskPenalty = concept.risk === 'low' ? 0 : concept.risk === 'medium' ? 2 : 5;
  return concept.rank * 10 + difficultyPenalty + riskPenalty;
}

function textsMeaningfullyDifferent(left: string, right: string) {
  const leftTrigrams = ngrams(left, 3);
  const rightTrigrams = ngrams(right, 3);
  if (leftTrigrams.size === 0 || rightTrigrams.size === 0) return normalize(left) !== normalize(right);
  const intersection = [...leftTrigrams].filter(value => rightTrigrams.has(value)).length;
  const union = new Set([...leftTrigrams, ...rightTrigrams]).size;
  return intersection / Math.max(1, union) < 0.55;
}

function ngrams(value: string, size: number) {
  const normalized = normalize(value);
  const result = new Set<string>();
  for (let index = 0; index <= normalized.length - size; index += 1) {
    result.add(normalized.slice(index, index + size));
  }
  return result;
}

function normalize(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function countBy<T, K>(values: readonly T[], key: (value: T) => K) {
  const counts = new Map<K, number>();
  values.forEach(value => counts.set(key(value), (counts.get(key(value)) ?? 0) + 1));
  return counts;
}

export type { PromptWizardConceptPreview, PromptWizardProductionLoad };
