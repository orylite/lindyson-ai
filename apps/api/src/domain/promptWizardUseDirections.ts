import { z } from 'zod';
import {
  promptWizardCustomSceneSchema,
  promptWizardUseDirectionSchema,
  type PromptWizardCustomScene,
  type PromptWizardEvidence,
  type PromptWizardEvidenceGraph,
  type PromptWizardUseDirection,
} from '@lindyson/api-contracts';
import {
  derivePromptWizardEvidenceCapabilities,
  isPromptWizardObservableAction,
} from './promptWizardEvidenceGraph.js';
import {
  findPromptWizardUnconfirmedClaimFieldPaths,
  findPromptWizardUnsupportedRiskFieldPaths,
  isPromptWizardChineseDominant,
  type PromptWizardStringLeaf,
} from './promptWizardPrompt.js';

export const PROMPT_WIZARD_USE_DIRECTION_MIN_COUNT = 2 as const;
export const PROMPT_WIZARD_USE_DIRECTION_MAX_COUNT = 3 as const;
export const PROMPT_WIZARD_USE_DIRECTION_SCENE_MIN_COUNT = 2 as const;
export const PROMPT_WIZARD_USE_DIRECTION_SCENE_MAX_COUNT = 3 as const;
export const PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION =
  '请补充一个您确认真实、希望重点展示的用途或卖点。' as const;

export type PromptWizardUseDirectionValidationIssueCode =
  | 'SCHEMA_INVALID'
  | 'DIRECTION_COUNT_INVALID'
  | 'DUPLICATE_ID'
  | 'DUPLICATE_DIRECTION'
  | 'HISTORICAL_DIRECTION_DUPLICATE'
  | 'EVIDENCE_INVALID'
  | 'PURCHASE_REASON_UNSUPPORTED'
  | 'PROOF_ACTION_UNSUPPORTED'
  | 'PROOF_ACTION_NOT_PHYSICAL'
  | 'SCENE_COUNT_INVALID'
  | 'DUPLICATE_SCENE'
  | 'RECOMMENDED_SCENE_INVALID'
  | 'SCENE_ACTION_NOT_PHYSICAL'
  | 'CONTENT_LANGUAGE_INVALID'
  | 'UNCONFIRMED_CLAIM'
  | 'UNSAFE_CONTENT'
  | 'PACKAGING_ASSET_UNAVAILABLE'
  | 'TESTABLE_FEATURE_UNAVAILABLE'
  | 'FOLEY_ACTION_UNAVAILABLE'
  | 'APPEARANCE_MODE_MISMATCH'
  | 'CLARIFICATION_INVALID';

export interface PromptWizardUseDirectionValidationIssue {
  code: PromptWizardUseDirectionValidationIssueCode;
  fieldPath: string;
  directionId?: string;
  message: string;
}

export interface PromptWizardUseDirectionValidationResult {
  valid: boolean;
  directions: PromptWizardUseDirection[];
  issues: PromptWizardUseDirectionValidationIssue[];
}

export class PromptWizardUseDirectionValidationError extends Error {
  readonly code = 'PROMPT_WIZARD_USE_DIRECTIONS_INVALID';

  constructor(readonly issues: PromptWizardUseDirectionValidationIssue[]) {
    super(`产品使用方向未通过本地门禁：${issues.map(issue => issue.fieldPath).join('、')}`);
    this.name = 'PromptWizardUseDirectionValidationError';
  }
}

const useDirectionBatchSchema = z.array(promptWizardUseDirectionSchema)
  .min(PROMPT_WIZARD_USE_DIRECTION_MIN_COUNT)
  .max(PROMPT_WIZARD_USE_DIRECTION_MAX_COUNT);

const PACKAGING_PATTERN = /(?:包装|外盒|礼盒|封膜|封口|拆封|开箱)/u;
const PERSON_ASSET_PATTERN = /(?:真人|人物|模特|演员|用户|顾客|朋友|家人)/u;
const HAND_ASSET_PATTERN = /(?:手部|双手|单手|手模)/u;
const SEMANTIC_STOP_TERMS = new Set([
  '产品', '商品', '这个', '这款', '当前', '用户', '观众', '画面', '镜头', '真实',
  '清楚', '可见', '完成', '进行', '展示', '使用', '动作', '状态', '场景', '方向',
  '需要', '适合', '通过', '主要', '能够', '可以', '购买', '理由',
]);

export function validatePromptWizardUseDirections(input: {
  directions: unknown;
  evidenceGraph: PromptWizardEvidenceGraph;
  historicalDirections?: readonly PromptWizardUseDirection[];
}): PromptWizardUseDirectionValidationResult {
  const parsed = useDirectionBatchSchema.safeParse(input.directions);
  if (!parsed.success) {
    return {
      valid: false,
      directions: [],
      issues: parsed.error.issues.map(issue => ({
        code: issue.path.length === 0
          ? 'DIRECTION_COUNT_INVALID' as const
          : 'SCHEMA_INVALID' as const,
        fieldPath: issue.path.length > 0
          ? `directions.${issue.path.join('.')}`
          : 'directions',
        message: issue.message,
      })),
    };
  }

  const directions = parsed.data;
  const issues: PromptWizardUseDirectionValidationIssue[] = [];
  const evidenceById = new Map(
    input.evidenceGraph.evidences.map(evidence => [evidence.id, evidence]),
  );
  const reliableEvidenceIds = new Set(input.evidenceGraph.reliableEvidenceIds);
  const reliableEvidence = input.evidenceGraph.evidences.filter(evidence => (
    reliableEvidenceIds.has(evidence.id)
    && (evidence.status === 'visible' || evidence.status === 'user-confirmed')
  ));
  const confirmedClaims = reliableEvidence
    .filter(evidence => evidence.status === 'user-confirmed')
    .map(evidence => evidence.text)
    .join('\n');
  const allowedLatinTokens = new Set(
    reliableEvidence.flatMap(evidence => (
      Array.from(evidence.text.normalize('NFKC').matchAll(/\p{Script=Latin}+/gu), match => (
        match[0].toLocaleLowerCase('en-US')
      ))
    )),
  );
  const capabilities = derivePromptWizardEvidenceCapabilities(input.evidenceGraph);
  const ids = new Set<string>();

  directions.forEach((direction, directionIndex) => {
    const prefix = `directions.${directionIndex}`;
    const add = (
      code: PromptWizardUseDirectionValidationIssueCode,
      field: string,
      message: string,
    ) => issues.push({
      code,
      fieldPath: `${prefix}.${field}`,
      directionId: direction.id,
      message,
    });

    if (ids.has(direction.id)) add('DUPLICATE_ID', 'id', '使用方向 ID 必须唯一。');
    ids.add(direction.id);

    const referencedEvidence = direction.evidenceIds
      .map(id => evidenceById.get(id))
      .filter((evidence): evidence is PromptWizardEvidence => Boolean(evidence));
    const purchaseEvidence = referencedEvidence.filter(evidence => (
      !['appearance', 'audience', 'scenario'].includes(evidence.type)
    ));
    direction.evidenceIds.forEach((evidenceId, evidenceIndex) => {
      const evidence = evidenceById.get(evidenceId);
      if (
        !evidence
        || !reliableEvidenceIds.has(evidenceId)
        || (evidence.status !== 'visible' && evidence.status !== 'user-confirmed')
      ) {
        issues.push({
          code: 'EVIDENCE_INVALID',
          fieldPath: `${prefix}.evidenceIds.${evidenceIndex}`,
          directionId: direction.id,
          message: `使用方向引用了不存在、待确认或禁止使用的证据：${evidenceId}`,
        });
      }
    });

    if (
      purchaseEvidence.length === 0
      || !textOverlapsEvidence(direction.purchaseReason, purchaseEvidence)
    ) {
      add(
        'PURCHASE_REASON_UNSUPPORTED',
        'purchaseReason',
        '唯一购买理由必须能够由所引用的可靠证据直接支持。',
      );
    }
    if (!isPromptWizardObservableAction(direction.proofAction)) {
      add('PROOF_ACTION_NOT_PHYSICAL', 'proofAction', '产品自证必须包含可拍摄的物理动作。');
    }
    if (
      purchaseEvidence.length === 0
      || !textOverlapsEvidence(direction.proofAction, purchaseEvidence)
    ) {
      add(
        'PROOF_ACTION_UNSUPPORTED',
        'proofAction',
        '产品自证动作必须落实所引用证据的可见事实或 proofActions。',
      );
    }

    validateScenes(direction, prefix, issues);
    validateCapabilityAndAssets(direction, prefix, capabilities, issues);

    const contentFields = useDirectionContentFields(direction, prefix);
    contentFields.forEach(field => {
      if (!isPromptWizardChineseDominant(field.value, allowedLatinTokens)) {
        issues.push({
          code: 'CONTENT_LANGUAGE_INVALID',
          fieldPath: field.fieldPath,
          directionId: direction.id,
          message: '使用方向与场景说明必须以简体中文为主，品牌、型号与可见印花可保留原文。',
        });
      }
    });
    for (const fieldPath of findPromptWizardUnconfirmedClaimFieldPaths(
      contentFields,
      confirmedClaims,
    )) {
      issues.push({
        code: 'UNCONFIRMED_CLAIM',
        fieldPath,
        directionId: direction.id,
        message: '使用方向包含未经用户确认的价格、数字、功效、认证或商业主张。',
      });
    }
    for (const fieldPath of findPromptWizardUnsupportedRiskFieldPaths(contentFields)) {
      issues.push({
        code: 'UNSAFE_CONTENT',
        fieldPath,
        directionId: direction.id,
        message: '使用方向包含虚假社会证明、虚假稀缺、危险测试、魔法变化或竞品结论。',
      });
    }
  });

  for (let leftIndex = 0; leftIndex < directions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < directions.length; rightIndex += 1) {
      const left = directions[leftIndex]!;
      const right = directions[rightIndex]!;
      if (promptWizardUseDirectionsSemanticallyDuplicate(left, right)) {
        issues.push({
          code: 'DUPLICATE_DIRECTION',
          fieldPath: `directions.${rightIndex}`,
          directionId: right.id,
          message: '两个使用方向必须在使用时刻、购买理由、自证动作或场景中至少两项不同。',
        });
      }
    }
  }

  for (let index = 0; index < directions.length; index += 1) {
    const direction = directions[index]!;
    if ((input.historicalDirections ?? []).some(historical => (
      promptWizardUseDirectionsSemanticallyDuplicate(direction, historical)
    ))) {
      issues.push({
        code: 'HISTORICAL_DIRECTION_DUPLICATE',
        fieldPath: `directions.${index}`,
        directionId: direction.id,
        message: '使用方向与当前任务已经生成过的方向过于相似。',
      });
    }
  }

  return { valid: issues.length === 0, directions, issues };
}

export function assertPromptWizardUseDirections(
  input: Parameters<typeof validatePromptWizardUseDirections>[0],
) {
  const result = validatePromptWizardUseDirections(input);
  if (!result.valid) throw new PromptWizardUseDirectionValidationError(result.issues);
  return result.directions;
}

/**
 * 数组第一项就是前端默认选择。先比较证据覆盖，再比较拍摄负担；同分时保持
 * Provider 原顺序，避免同一响应在重试或轮询时抖动。
 */
export function orderPromptWizardUseDirectionsForDefaultSelection(
  directions: readonly PromptWizardUseDirection[],
) {
  const appearanceScore = {
    'product-only': 18,
    'hands-only': 12,
    person: 0,
  } as const;
  const directionLoadPenalty: Partial<Record<PromptWizardUseDirection['internalDirection'], number>> = {
    'cinematic-brand': 8,
    'unboxing-review': 6,
    'feature-test': 4,
  };
  return directions
    .map((direction, index) => ({
      direction,
      index,
      score: direction.evidenceIds.length * 100
        + appearanceScore[direction.appearanceMode]
        - direction.requiredAssets.length * 2
        - (directionLoadPenalty[direction.internalDirection] ?? 0),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(item => item.direction);
}

export function promptWizardUseDirectionNeedsInput(graph: PromptWizardEvidenceGraph) {
  const reliableIds = new Set(graph.reliableEvidenceIds);
  const usableEvidence = graph.evidences.filter(evidence => (
    reliableIds.has(evidence.id)
    && (evidence.status === 'visible' || evidence.status === 'user-confirmed')
    && !['appearance', 'audience', 'scenario'].includes(evidence.type)
    && evidence.proofActions.length > 0
  ));
  // 一条强证据也可能支持多个真实使用时刻，例如同一个杯型既可用于倒酒，
  // 也可用于聚会碰杯。这里只在完全没有可拍自证动作时提前追问；其余情况
  // 交给方向规划模型尝试形成 2–3 个方向，再由本地完整门禁决定是否交付。
  return usableEvidence.length === 0;
}

export function validatePromptWizardUseDirectionClarification(input: {
  directions: readonly unknown[];
  clarificationQuestion: unknown;
  evidenceGraph: PromptWizardEvidenceGraph;
}) {
  if (
    input.directions.length === 0
    && input.clarificationQuestion === PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION
  ) return;
  throw new PromptWizardUseDirectionValidationError([{
    code: 'CLARIFICATION_INVALID',
    fieldPath: 'clarificationQuestion',
    message: '只有可靠证据不足以形成两个方向时，才能请求用户补充一个真实用途或卖点。',
  }]);
}

export function validatePromptWizardUseDirectionSelection(input: {
  direction: PromptWizardUseDirection;
  selectedSceneId?: string | null;
  customScene?: PromptWizardCustomScene | null;
  evidenceGraph?: PromptWizardEvidenceGraph;
  userConfirmedClaims?: string;
}) {
  const hasSelectedScene = Boolean(input.selectedSceneId);
  const hasCustomScene = input.customScene !== undefined && input.customScene !== null;
  if (hasSelectedScene === hasCustomScene) {
    throw Object.assign(new Error('必须且只能选择一个预设场景或自定义场景'), {
      code: 'PROMPT_WIZARD_USE_DIRECTION_SCENE_INVALID',
      fieldPaths: ['selectedSceneId', 'customScene'],
    });
  }
  if (input.selectedSceneId) {
    const selected = input.direction.sceneOptions.find(scene => scene.id === input.selectedSceneId);
    if (!selected) {
      throw Object.assign(new Error('所选场景不属于当前产品使用方向'), {
        code: 'PROMPT_WIZARD_USE_DIRECTION_SCENE_INVALID',
        fieldPaths: ['selectedSceneId'],
      });
    }
    return selected;
  }
  const parsed = promptWizardCustomSceneSchema.parse(input.customScene);
  if (!isPromptWizardObservableAction(parsed.mainAction)) {
    throw Object.assign(new Error('自定义场景必须包含可拍摄的产品动作'), {
      code: 'PROMPT_WIZARD_USE_DIRECTION_SCENE_INVALID',
      fieldPaths: ['customScene.mainAction'],
    });
  }
  const customFields: PromptWizardStringLeaf[] = [
    { fieldPath: 'customScene.title', value: parsed.title },
    { fieldPath: 'customScene.environment', value: parsed.environment },
    { fieldPath: 'customScene.mainAction', value: parsed.mainAction },
  ];
  const allowedLatinTokens = new Set(
    input.evidenceGraph?.evidences
      .filter(evidence => input.direction.evidenceIds.includes(evidence.id))
      .flatMap(evidence => (
        Array.from(evidence.text.normalize('NFKC').matchAll(/\p{Script=Latin}+/gu), match => (
          match[0].toLocaleLowerCase('en-US')
        ))
      )) ?? [],
  );
  const languagePaths = customFields
    .filter(field => !isPromptWizardChineseDominant(field.value, allowedLatinTokens))
    .map(field => field.fieldPath);
  if (languagePaths.length > 0) {
    throw Object.assign(new Error('自定义场景必须使用简体中文描述'), {
      code: 'PROMPT_WIZARD_USE_DIRECTION_SCENE_INVALID',
      fieldPaths: languagePaths,
    });
  }
  const confirmedEvidence = input.evidenceGraph?.evidences
    .filter(evidence => evidence.status === 'user-confirmed')
    .map(evidence => evidence.text)
    .join('\n') ?? '';
  const confirmedClaims = [input.userConfirmedClaims ?? '', confirmedEvidence]
    .filter(Boolean)
    .join('\n');
  const unsafePaths = [
    ...findPromptWizardUnconfirmedClaimFieldPaths(customFields, confirmedClaims),
    ...findPromptWizardUnsupportedRiskFieldPaths(customFields),
  ];
  if (unsafePaths.length > 0) {
    throw Object.assign(new Error('自定义场景包含未经确认或不安全的内容'), {
      code: 'PROMPT_WIZARD_USE_DIRECTION_SCENE_INVALID',
      fieldPaths: [...new Set(unsafePaths)],
    });
  }
  if (!customSceneActionBelongsToDirection(parsed.mainAction, input.direction)) {
    throw Object.assign(new Error('自定义场景的主动作必须属于所选产品使用方向'), {
      code: 'PROMPT_WIZARD_USE_DIRECTION_SCENE_INVALID',
      fieldPaths: ['customScene.mainAction'],
    });
  }
  if (input.evidenceGraph) {
    const capabilities = derivePromptWizardEvidenceCapabilities(input.evidenceGraph);
    const customText = customFields.map(field => field.value).join(' ');
    if (!capabilities.hasPackagingEvidence && PACKAGING_PATTERN.test(customText)) {
      throw Object.assign(new Error('没有包装证据时不能在自定义场景中要求拆箱或包装'), {
        code: 'PROMPT_WIZARD_USE_DIRECTION_SCENE_INVALID',
        fieldPaths: ['customScene'],
      });
    }
    if (
      input.direction.appearanceMode === 'product-only'
      && (PERSON_ASSET_PATTERN.test(customText) || HAND_ASSET_PATTERN.test(customText))
    ) {
      throw Object.assign(new Error('纯产品方向的自定义场景不能要求人物或手部'), {
        code: 'PROMPT_WIZARD_USE_DIRECTION_SCENE_INVALID',
        fieldPaths: ['customScene'],
      });
    }
    if (input.direction.appearanceMode === 'hands-only' && PERSON_ASSET_PATTERN.test(customText)) {
      throw Object.assign(new Error('手部出镜方向的自定义场景不能要求完整人物'), {
        code: 'PROMPT_WIZARD_USE_DIRECTION_SCENE_INVALID',
        fieldPaths: ['customScene'],
      });
    }
  }
  return { ...parsed, id: null };
}

function customSceneActionBelongsToDirection(
  action: string,
  direction: PromptWizardUseDirection,
) {
  return [direction.proofAction, direction.useMoment, direction.purchaseReason].some(reference => {
    if (directionDimensionSemanticallySimilar(action, reference)) return true;
    const actionTerms = semanticTerms(action);
    const referenceTerms = semanticTerms(reference);
    if (actionTerms.size === 0 || referenceTerms.size === 0) return false;
    let intersection = 0;
    actionTerms.forEach(term => {
      if (referenceTerms.has(term)) intersection += 1;
    });
    // “拿起”等一个通用动作词不足以证明属于同一方向；真实相关动作通常会
    // 同时复用产品、结构或用途的多个语义片段。
    return intersection >= 3
      && intersection / Math.min(actionTerms.size, referenceTerms.size) >= 0.4;
  });
}

export function promptWizardUseDirectionsSemanticallyDuplicate(
  left: PromptWizardUseDirection,
  right: PromptWizardUseDirection,
) {
  const dimensions = [
    [left.useMoment, right.useMoment],
    [left.purchaseReason, right.purchaseReason],
    [left.proofAction, right.proofAction],
    [
      left.sceneOptions.map(scene => `${scene.title} ${scene.environment}`).join(' '),
      right.sceneOptions.map(scene => `${scene.title} ${scene.environment}`).join(' '),
    ],
  ] as const;
  const differences = dimensions.filter(([leftValue, rightValue]) => (
    !directionDimensionSemanticallySimilar(leftValue, rightValue)
  )).length;
  return differences < 2;
}

export function buildPromptWizardUseDirectionRepairFeedback(
  issues: readonly PromptWizardUseDirectionValidationIssue[],
) {
  return [...new Set(issues.map(issue => (
    `${issue.fieldPath}：${issue.message}`
  )))].slice(0, 48);
}

function validateScenes(
  direction: PromptWizardUseDirection,
  prefix: string,
  issues: PromptWizardUseDirectionValidationIssue[],
) {
  if (
    direction.sceneOptions.length < PROMPT_WIZARD_USE_DIRECTION_SCENE_MIN_COUNT
    || direction.sceneOptions.length > PROMPT_WIZARD_USE_DIRECTION_SCENE_MAX_COUNT
  ) {
    issues.push({
      code: 'SCENE_COUNT_INVALID',
      fieldPath: `${prefix}.sceneOptions`,
      directionId: direction.id,
      message: '每个使用方向必须提供 2–3 个具体场景。',
    });
  }
  const ids = new Set<string>();
  const signatures = new Set<string>();
  direction.sceneOptions.forEach((scene, sceneIndex) => {
    if (ids.has(scene.id)) {
      issues.push({
        code: 'DUPLICATE_SCENE',
        fieldPath: `${prefix}.sceneOptions.${sceneIndex}.id`,
        directionId: direction.id,
        message: '场景 ID 必须唯一。',
      });
    }
    ids.add(scene.id);
    // V5 的 mainAction 由服务端统一复用方向 proofAction，同一方向内没有
    // 额外区分度；场景唯一性只比较模型真正选择的标题与环境。
    const signature = normalizeSemanticText(`${scene.title} ${scene.environment}`);
    if (signatures.has(signature)) {
      issues.push({
        code: 'DUPLICATE_SCENE',
        fieldPath: `${prefix}.sceneOptions.${sceneIndex}`,
        directionId: direction.id,
        message: '同一使用方向中的场景不能重复。',
      });
    }
    signatures.add(signature);
    if (!isPromptWizardObservableAction(scene.mainAction)) {
      issues.push({
        code: 'SCENE_ACTION_NOT_PHYSICAL',
        fieldPath: `${prefix}.sceneOptions.${sceneIndex}.mainAction`,
        directionId: direction.id,
        message: '场景必须包含能够拍摄的产品动作。',
      });
    }
  });
  if (!ids.has(direction.recommendedSceneId)) {
    issues.push({
      code: 'RECOMMENDED_SCENE_INVALID',
      fieldPath: `${prefix}.recommendedSceneId`,
      directionId: direction.id,
      message: '推荐场景必须引用当前方向内存在的场景。',
    });
  }
}

function validateCapabilityAndAssets(
  direction: PromptWizardUseDirection,
  prefix: string,
  capabilities: ReturnType<typeof derivePromptWizardEvidenceCapabilities>,
  issues: PromptWizardUseDirectionValidationIssue[],
) {
  const assetText = direction.requiredAssets.join(' ');
  if (
    direction.internalDirection === 'unboxing-review'
    && !capabilities.hasPackagingEvidence
  ) {
    issues.push({
      code: 'PACKAGING_ASSET_UNAVAILABLE',
      fieldPath: `${prefix}.internalDirection`,
      directionId: direction.id,
      message: '没有包装证据时不得推荐开箱方向。',
    });
  }
  if (!capabilities.hasPackagingEvidence && PACKAGING_PATTERN.test(assetText)) {
    issues.push({
      code: 'PACKAGING_ASSET_UNAVAILABLE',
      fieldPath: `${prefix}.requiredAssets`,
      directionId: direction.id,
      message: '没有包装证据时不得要求包装、拆封或开箱素材。',
    });
  }
  if (
    direction.internalDirection === 'feature-test'
    && !capabilities.hasConfirmedTestableFeature
  ) {
    issues.push({
      code: 'TESTABLE_FEATURE_UNAVAILABLE',
      fieldPath: `${prefix}.internalDirection`,
      directionId: direction.id,
      message: '没有用户确认的可观察功能时不得推荐功能实测。',
    });
  }
  if (direction.internalDirection === 'asmr-detail' && !capabilities.hasFoleyAction) {
    issues.push({
      code: 'FOLEY_ACTION_UNAVAILABLE',
      fieldPath: `${prefix}.internalDirection`,
      directionId: direction.id,
      message: '没有真实操作声动作时不得推荐 ASMR。',
    });
  }
  const modeMismatch = (
    direction.appearanceMode === 'product-only'
    && (PERSON_ASSET_PATTERN.test(assetText) || HAND_ASSET_PATTERN.test(assetText))
  ) || (
    direction.appearanceMode === 'hands-only'
    && PERSON_ASSET_PATTERN.test(assetText)
  );
  if (modeMismatch) {
    issues.push({
      code: 'APPEARANCE_MODE_MISMATCH',
      fieldPath: `${prefix}.requiredAssets`,
      directionId: direction.id,
      message: '所需人物素材与方向指定的出镜方式不一致。',
    });
  }
}

function useDirectionContentFields(
  direction: PromptWizardUseDirection,
  prefix: string,
): PromptWizardStringLeaf[] {
  return [
    ['title', direction.title],
    ['useMoment', direction.useMoment],
    ['audienceNeed', direction.audienceNeed],
    ['purchaseReason', direction.purchaseReason],
    ['proofAction', direction.proofAction],
    ...direction.requiredAssets.map((value, index) => [`requiredAssets.${index}`, value] as const),
    ...direction.sceneOptions.flatMap((scene, sceneIndex) => [
      [`sceneOptions.${sceneIndex}.title`, scene.title] as const,
      [`sceneOptions.${sceneIndex}.environment`, scene.environment] as const,
      [`sceneOptions.${sceneIndex}.mainAction`, scene.mainAction] as const,
    ]),
  ].map(([field, value]) => ({ fieldPath: `${prefix}.${field}`, value }));
}

function textOverlapsEvidence(value: string, evidences: readonly PromptWizardEvidence[]) {
  return evidences.some(evidence => textSemanticallySimilar(
    value,
    `${evidence.text} ${evidence.proofActions.join(' ')}`,
  ));
}

function textSemanticallySimilar(left: string, right: string) {
  const normalizedLeft = normalizeSemanticText(left);
  const normalizedRight = normalizeSemanticText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  const shorterLength = Math.min(normalizedLeft.length, normalizedRight.length);
  if (
    shorterLength >= 4
    && (
      normalizedRight.includes(normalizedLeft)
      || normalizedLeft.includes(normalizedRight)
    )
  ) return true;
  const leftTerms = semanticTerms(left);
  const rightTerms = semanticTerms(right);
  const sharedTerms = [...leftTerms].filter(term => rightTerms.has(term));
  const minimumTermCount = Math.min(leftTerms.size, rightTerms.size);
  if (
    sharedTerms.length >= 2
    && minimumTermCount > 0
    && sharedTerms.length / minimumTermCount >= 0.3
  ) return true;
  // 品牌、型号或可见印花可能只有一个较长的拉丁词；它们本身足以构成
  // 可追溯实体，但“透明”“使用”等单个中文通用二元词不能充当证据链。
  if (sharedTerms.some(term => /^\p{Script=Latin}[\p{Script=Latin}\p{N}-]{3,}$/u.test(term))) {
    return true;
  }
  return trigramJaccard(normalizedLeft, normalizedRight) >= 0.48;
}

/**
 * 方向去重必须比“事实是否有依据”的判断更严格。
 *
 * 同一条可靠证据天然会让两个方向共享购买理由和部分自证措辞；若沿用
 * textSemanticallySimilar 的“任意中文二元词重合即相似”，倒酒与碰杯、
 * 取用与收纳等真实不同的使用时刻也会被误判为重复。这里仅把高度重合
 * 或几乎互相包含的整段说明视为相似，让 useMoment 与场景动作可以形成
 * 两个实质差异，同时不放松购买理由的证据追溯门禁。
 */
function directionDimensionSemanticallySimilar(left: string, right: string) {
  const normalizedLeft = normalizeSemanticText(left);
  const normalizedRight = normalizeSemanticText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  const shorterLength = Math.min(normalizedLeft.length, normalizedRight.length);
  const longerLength = Math.max(normalizedLeft.length, normalizedRight.length);
  if (
    shorterLength >= 8
    && shorterLength / longerLength >= 0.75
    && (
      normalizedLeft.includes(normalizedRight)
      || normalizedRight.includes(normalizedLeft)
    )
  ) return true;
  return trigramJaccard(normalizedLeft, normalizedRight) >= 0.68;
}

function semanticTerms(value: string) {
  const result = new Set<string>();
  const normalized = value.normalize('NFKC').toLocaleLowerCase('zh-CN');
  for (const token of normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    if (/^[\u3400-\u9fff]+$/u.test(token)) {
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

function normalizeSemanticText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[^\p{L}\p{N}]+/gu, '');
}

function trigramJaccard(left: string, right: string) {
  const leftSet = ngrams(left, 3);
  const rightSet = ngrams(right, 3);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let intersection = 0;
  leftSet.forEach(value => {
    if (rightSet.has(value)) intersection += 1;
  });
  return intersection / (leftSet.size + rightSet.size - intersection);
}

function ngrams(value: string, size: number) {
  const result = new Set<string>();
  for (let index = 0; index <= value.length - size; index += 1) {
    result.add(value.slice(index, index + size));
  }
  return result;
}
