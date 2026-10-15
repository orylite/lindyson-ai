import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  promptWizardConceptPreviewSchema,
  promptWizardAppearanceModeSchema,
  promptWizardProductProfileSchema,
  promptWizardUseDirectionSchema,
  promptWizardUseDirectionPlanContextSchema,
  type PromptWizardConceptPreview,
  type PromptWizardCreativeBrief,
  type PromptWizardEvidenceGraph,
  type PromptWizardProductProfile,
  type PromptWizardProductionBrief,
  type PromptWizardRouteRole,
  type PromptWizardUseDirection,
  type PromptWizardUseDirectionPlanContext,
  type PromptWizardVideoConfig,
} from '@lindyson/api-contracts';
import { env } from '../config/env.js';
import {
  ArkPromptWizardResponsesClient,
  type ArkPromptWizardResponsesRequest,
  type ArkPromptWizardResponsesResult,
} from './arkPromptWizardResponsesClient.js';
import {
  runPromptWizardProviderRequest,
  type PromptWizardRetryEvent,
  type PromptWizardRetryPolicy,
} from './promptWizardRetry.js';
import { withPromptWizardProviderConcurrency } from './promptWizardConcurrency.js';
import {
  escapeRawJsonStringControlCharacters,
  extractSinglePromptWizardJsonObject,
  normalizePromptWizardJsonEnvelope,
  repairPromptWizardJsonLexicalNoise,
} from './providerStructuredJson.js';
import {
  describePromptWizardProduct,
  expectedPromptWizardSegmentCount,
  expectedPromptWizardSegmentCountV6,
  promptWizardTimeline,
  promptWizardTimelineV6,
  promptWizardBeatRolesV6,
  promptWizardPlanDraftBatchSchema,
  promptWizardPlanDraftSchema,
  promptWizardSingleFamilyAction,
  type PromptWizardPlanDraft,
} from '../domain/promptWizardPrompt.js';
import {
  getPromptWizardDirectionBlueprint,
  promptWizardShotRoles,
} from '../domain/promptWizardDirectionBlueprint.js';
import { allocatePromptWizardEvidence } from '../domain/promptWizardEvidence.js';
import {
  isPromptWizardPlanIndex,
  PROMPT_WIZARD_PLAN_COUNT,
  PROMPT_WIZARD_LEGACY_PLAN_INDEXES,
  type PromptWizardPlanIndex,
} from '../domain/promptWizardPlanCount.js';
import {
  strategySignature,
  type PromptWizardStrategy,
} from '../domain/promptWizardStrategy.js';
import {
  type PromptWizardConceptAssignment,
} from '../domain/promptWizardConceptContext.js';
import {
  getPromptWizardExecutionBudget,
  getPromptWizardV6ExecutionBudget,
  countPromptWizardVoiceoverUnits,
  getPromptWizardSegmentVoiceoverBudgets,
  getPromptWizardTotalVoiceoverBudget,
  getPromptWizardVoiceoverWindowDuration,
} from '../domain/promptWizardExecutionBudget.js';
import { buildPromptWizardCreativePlaybook } from '../domain/promptWizardCreativePlaybook.js';
import {
  promptWizardProviderRequestRecorder,
  safePromptWizardProviderAttemptTerminal,
  type PromptWizardCostOwner,
  type PromptWizardProviderRequestRecorder,
} from '../domain/promptWizardCostLedger.js';
import {
  assertPromptWizardUseDirections,
  buildPromptWizardUseDirectionRepairFeedback,
  PromptWizardUseDirectionValidationError,
  promptWizardUseDirectionNeedsInput,
  PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION,
  validatePromptWizardUseDirectionClarification,
} from '../domain/promptWizardUseDirections.js';

export interface PromptWizardImageInput {
  name: string;
  url: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
}

export interface PromptWizardProviderUsage {
  interactionId: string | null;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  serviceTier: 'default' | 'fast' | null;
  requestAttempts: number;
}

export interface PromptWizardProductAnalysisResult {
  profile: PromptWizardProductProfile;
  /**
   * 模型按输入图片的一基序号返回字段级溯源；服务端随后映射为当前用户真实资产
   * ID。旧 Provider/历史测试可以省略，领域层会将无来源事实降为待确认。
   */
  evidenceSources?: PromptWizardProductEvidenceSource[];
  usage: PromptWizardProviderUsage;
}

export interface PromptWizardProductEvidenceSource {
  fieldPath: string;
  sourceImageIndexes: number[];
  visibleRegion: string;
  confidence: 'high' | 'medium' | 'low';
  proofActions: string[];
}

export interface PromptWizardDraftResult {
  drafts: PromptWizardPlanDraft[];
  usage: PromptWizardProviderUsage;
  /**
   * 当前 Provider 调用链的格式异常响应数：无法解析并触发外部恢复计一次，
   * 成功但使用非 native 规范化也计一次；同一原始响应最多计一次。
   */
  formatRepairCount?: number;
  /** 实际发出的 repair-draft-format 物理请求数；与格式异常数分开。 */
  formatRecoveryRequestCount?: number;
  /**
   * 初始方案响应已是合法 JSON、但单方案未通过本地 Schema/Zod 时，
   * Provider 会在共享批次预算内按索引执行内容修复。该轮数必须交给领域
   * 编排器计入同一份最多两轮预算，避免 Provider 与领域层各自再修两轮。
   * 纯 JSON 格式恢复不属于内容修复，绝不能占用该预算。
   */
  repairRounds?: number;
  /**
   * 只记录可安全审计的修复来源与字段定位；不得携带候选正文、修复动作、
   * 商品信息、口播或 Provider 原始响应。
   */
  repairDiagnostics?: PromptWizardRepairDiagnostic[];
  /**
   * V6 结构化正文的白名单诊断。只包含解析阶段、固定分类与逻辑字段路径，
   * 不得携带正文、摘要、哈希、动态键、错误消息或字节位置。
   */
  outputDiagnostics?: PromptWizardOutputDiagnostic[];
}

export type PromptWizardOutputOperation =
  | 'generate-drafts'
  | 'repair-draft-format'
  | 'repair-draft-content'
  | 'refine-plan';

export type PromptWizardOutputDiagnosticClassification =
  | 'valid-json'
  | 'non-json'
  | 'string-truncated'
  | 'escape-truncated'
  | 'container-truncated'
  | 'bracket-mismatch'
  | 'multiple-root-values'
  | 'invalid-token'
  | 'unknown';

export type PromptWizardOutputNormalizationMode =
  | 'native'
  | 'fence-removed'
  | 'control-character-escaped'
  | 'single-object-extracted'
  | 'lexical-repair'
  | 'append-closing-delimiters'
  | 'none';

/**
 * Schema 阶段只允许记录这一组由本地解码器确定的固定原因。它刻意不包含
 * Zod message、动态键名、坏字符、正文片段或字节位置。
 */
export type PromptWizardOutputSchemaIssue =
  | 'not-applicable'
  | 'keyset'
  | 'count'
  | 'unit'
  | 'secondary-source'
  | 'translation'
  | 'wire-shape';

type PromptWizardOutputSchemaFailureIssue = Exclude<
  PromptWizardOutputSchemaIssue,
  'not-applicable'
>;

export interface PromptWizardOutputDiagnostic {
  planIndex: PromptWizardPlanIndex;
  operation: PromptWizardOutputOperation;
  stage: 'initial' | 'format-recovery' | 'content-repair' | 'refinement';
  phase: 'parse' | 'schema' | 'decoded';
  classification: PromptWizardOutputDiagnosticClassification;
  normalizationMode: PromptWizardOutputNormalizationMode;
  schemaIssue: PromptWizardOutputSchemaIssue;
  outputLengthBucket:
    | 'empty'
    | '1-2048'
    | '2049-8192'
    | '8193-32768'
    | '32769-64000'
    | 'over-64000';
  containerDepthBucket: '0' | '1-4' | '5-8' | '9-16' | 'over-16';
  outputTextSource: 'completed' | 'streamed-fallback' | 'existing-compatible';
  fieldPaths: string[];
}

export type PromptWizardRepairDiagnosticOrigin =
  | 'initial-schema'
  | 'domain-validation'
  | 'terminal-calibration';

export interface PromptWizardRepairDiagnostic {
  planIndex: PromptWizardPlanIndex;
  origin: PromptWizardRepairDiagnosticOrigin;
  repairRound: 1 | 2 | 3;
  errorCode: string;
  fieldPaths: string[];
}

export interface PromptWizardConceptGenerationResult {
  concepts: PromptWizardConceptPreview[];
  usage: PromptWizardProviderUsage;
}

export interface PromptWizardUseDirectionGenerationResult {
  directions: PromptWizardUseDirection[];
  clarificationQuestion: string | null;
  usage: PromptWizardProviderUsage;
  repairRounds: 0 | 1;
}

export interface PromptWizardUseDirectionGenerationContext {
  profile: PromptWizardProductProfile;
  evidenceGraph: PromptWizardEvidenceGraph;
  historicalDirections: PromptWizardUseDirection[];
  deadlineAtMs?: number;
  costOwner?: PromptWizardCostOwner;
}

export interface PromptWizardUseDirectionDraftGenerationContext {
  profile: PromptWizardProductProfile;
  evidenceGraph: PromptWizardEvidenceGraph;
  /** 5 秒 V6 不得传入；10/15 秒及历史任务必须提供。 */
  targetLanguage?: string;
  confirmedOffer?: string;
  config: PromptWizardVideoConfig;
  planContexts: PromptWizardDraftPlanContext[];
  imageCount: number;
  variationKey: number;
  deadlineAtMs?: number;
  costOwner?: PromptWizardCostOwner;
}

/**
 * V6 三路线复用成熟的逐方案分镜 Provider，但不再把路线暴露成用户选择。
 * routeRole 是 V6 的权威商业角色，其余字段只是内部生成适配层。
 */
export interface PromptWizardRouteDraftPlanContext {
  planIndex: PromptWizardPlanIndex;
  routeRole: PromptWizardRouteRole;
  /**
   * 格式恢复不能读取或猜测首次无效正文；固定回退 Hook 只能来自已锁定路线。
   * 该字段仅在服务端内部流转，不属于公开批次 API。
   */
  lockedHookZh: string;
  variant: PromptWizardUseDirectionPlanContext['variant'];
  useDirection: PromptWizardUseDirectionPlanContext['useDirection'];
  selectedScene: PromptWizardUseDirectionPlanContext['selectedScene'];
  /** 封闭词表生成的普通品类功能；不得承载高风险或商业推测。 */
  categoryInference?: string;
}

export type PromptWizardDraftPlanContext =
  | PromptWizardUseDirectionPlanContext
  | PromptWizardRouteDraftPlanContext;

function isPromptWizardV6DraftContext(input: PromptWizardUseDirectionDraftGenerationContext) {
  return input.planContexts.some(context => 'routeRole' in context);
}

function isPromptWizardV6SoundDesignOnly(
  input: PromptWizardUseDirectionDraftGenerationContext,
) {
  return isPromptWizardV6DraftContext(input) && input.config.durationSeconds === 5;
}

function promptWizardRequiredTargetLanguage(
  input: PromptWizardUseDirectionDraftGenerationContext,
) {
  const targetLanguage = input.targetLanguage?.normalize('NFKC').trim();
  if (!targetLanguage) {
    throw promptWizardProviderInputError('口播方案必须提供目标语言');
  }
  return targetLanguage;
}

function usesPromptWizardMandarinCharacterArraysV3(
  input: PromptWizardUseDirectionDraftGenerationContext,
) {
  if (
    !isPromptWizardV6DraftContext(input)
    || isPromptWizardV6SoundDesignOnly(input)
    || (input.config.durationSeconds !== 10 && input.config.durationSeconds !== 15)
  ) return false;
  return promptWizardRequiredTargetLanguage(input) === '普通话';
}

function expectedPromptWizardDraftSegmentCount(
  input: PromptWizardUseDirectionDraftGenerationContext,
) {
  return isPromptWizardV6DraftContext(input)
    ? expectedPromptWizardSegmentCountV6(input.config.durationSeconds)
    : expectedPromptWizardSegmentCount(input.config.durationSeconds);
}

function promptWizardDraftTimeline(input: PromptWizardUseDirectionDraftGenerationContext) {
  return isPromptWizardV6DraftContext(input)
    ? promptWizardTimelineV6(input.config.durationSeconds)
    : promptWizardTimeline(input.config.durationSeconds);
}

function promptWizardDraftShotRoles(input: PromptWizardUseDirectionDraftGenerationContext) {
  return isPromptWizardV6DraftContext(input)
    ? promptWizardBeatRolesV6(input.config.durationSeconds)
    : promptWizardShotRoles(input.config.durationSeconds);
}

interface PromptWizardFullDraftWordSlotContract {
  format: 'full-plan-indexed-word-slots-v1';
  property: 'voiceoverSlots';
  rule: string;
  segments: Array<{
    property: string;
    segmentIndex: number;
    exactWordCount: number;
    fields: ['voiceoverWords', 'voiceoverZh'];
  }>;
}

interface PromptWizardFullDraftCharacterStringContract {
  format: 'full-plan-indexed-character-strings-v2';
  property: 'voiceoverSlots';
  rule: string;
  segments: Array<{
    property: string;
    segmentIndex: number;
    exactCharacterCount: number;
    fields: ['voiceoverText', 'voiceoverZh'];
  }>;
}

interface PromptWizardFullDraftCharacterArrayContract {
  format: 'full-plan-indexed-character-arrays-v3';
  property: 'voiceoverSlots';
  rule: string;
  segments: Array<{
    property: string;
    segmentIndex: number;
    exactCharacterCount: number;
    itemRule: 'single-readable-character';
  }>;
}

type PromptWizardFullDraftSlotContract =
  | PromptWizardFullDraftWordSlotContract
  | PromptWizardFullDraftCharacterStringContract
  | PromptWizardFullDraftCharacterArrayContract;

/** V6 首稿只向模型索取不能由锁定路线确定性推导的创意字段。 */
export interface PromptWizardDraftWireV2 {
  hook: string;
  shots: Array<{
    shotSize: string;
    action: string;
    cameraMovement: string;
    lightingAndRealism: string;
    foley: string;
    editingCue: string;
  }>;
  voiceoverSlots?: Record<string, unknown>;
}

/** JSON 格式恢复进一步缩小输出面；其余字段由锁定路线确定性补齐。 */
export interface PromptWizardDraftRecoveryWireV2 {
  shots: Array<{
    shotSize: string;
    action: string;
    cameraMovement: string;
    lightingAndRealism: string;
    foley: string;
    editingCue: string;
  }>;
  voiceoverSlots?: Record<string, unknown>;
}

function promptWizardFullDraftSlotContract(
  _input: PromptWizardUseDirectionDraftGenerationContext,
  _segmentCount?: number,
): PromptWizardFullDraftSlotContract | undefined {
  // V6 Flat Scalar V2 直接用每镜完整句 vN（以及非普通话 zN），不再创建
  // 定长词槽、字符数组或字符字符串合同。函数暂留给历史非 Flat Schema 边界。
  return undefined;
}

function usesPromptWizardCompactDraftWireV2(
  input: PromptWizardUseDirectionDraftGenerationContext,
  _segmentCount: number = expectedPromptWizardDraftSegmentCount(input),
) {
  return isPromptWizardV6DraftContext(input);
}

const PROMPT_WIZARD_FLAT_SCALAR_FORMAT = 'prompt-wizard-flat-scalars-v2' as const;

type PromptWizardFlatScalarMode = 'creative' | 'recovery' | 'voiceover';
type PromptWizardFlatScalarEntryKind =
  | 'hook'
  | 'shot'
  | 'voiceover'
  | 'translation';

export interface PromptWizardFlatScalarLayoutEntry {
  key: string;
  logicalPath: Array<string | number>;
  kind: PromptWizardFlatScalarEntryKind;
  minLength: number;
  maxLength?: number;
  segmentIndex?: number;
  startSeconds?: number;
  endSeconds?: number;
  shotField?: keyof PromptWizardDraftWireV2['shots'][number];
}

export interface PromptWizardFlatScalarLayout {
  format: typeof PROMPT_WIZARD_FLAT_SCALAR_FORMAT;
  mode: PromptWizardFlatScalarMode;
  segmentCount: 2 | 3 | 4;
  entries: PromptWizardFlatScalarLayoutEntry[];
}

interface PromptWizardFlatScalarRepairOwnershipProjection {
  canonicalRecord: Record<string, string>;
  providerOwnedKeys: ReadonlySet<string>;
}

const PROMPT_WIZARD_FLAT_SCALAR_SHOT_FIELDS = [
  { keySuffix: 'ShotSize', field: 'shotSize', maxLength: 80 },
  { keySuffix: 'Action', field: 'action', maxLength: 300 },
  { keySuffix: 'CameraMovement', field: 'cameraMovement', maxLength: 180 },
  { keySuffix: 'LightingAndRealism', field: 'lightingAndRealism', maxLength: 220 },
  { keySuffix: 'Foley', field: 'foley', maxLength: 180 },
  { keySuffix: 'EditingCue', field: 'editingCue', maxLength: 180 },
] as const;

/**
 * V6 的所有 Provider 响应共用这一份布局描述。JSON Schema、Prompt 键表、
 * decoder、Fake 与安全字段映射均从这里生成，避免不同 operation 或语种
 * 各自维护一套容易漂移的 Wire。响应根对象之外不允许任何容器。
 */
export function createPromptWizardFlatScalarLayout(
  input: PromptWizardUseDirectionDraftGenerationContext,
  segmentCount: number = expectedPromptWizardDraftSegmentCount(input),
  mode: PromptWizardFlatScalarMode = 'creative',
): PromptWizardFlatScalarLayout {
  if (!isPromptWizardV6DraftContext(input)) {
    throw promptWizardProviderInputError('Flat Scalar Wire 只允许用于 V6');
  }
  const expectedSegmentCount = expectedPromptWizardDraftSegmentCount(input);
  if (
    segmentCount !== expectedSegmentCount
    || (segmentCount !== 2 && segmentCount !== 3 && segmentCount !== 4)
  ) {
    throw promptWizardProviderInputError('Flat Scalar Wire 镜头数量必须与 V6 时间轴严格一致');
  }
  const entries: PromptWizardFlatScalarLayoutEntry[] = [];
  if (mode === 'creative') {
    entries.push({
      key: 'hook',
      logicalPath: ['hook'],
      kind: 'hook',
      minLength: 1,
      maxLength: 300,
    });
  }
  if (mode !== 'voiceover') {
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      for (const definition of PROMPT_WIZARD_FLAT_SCALAR_SHOT_FIELDS) {
        entries.push({
          key: `s${segmentIndex}${definition.keySuffix}`,
          logicalPath: ['segments', segmentIndex, definition.field],
          kind: 'shot',
          minLength: 1,
          maxLength: definition.maxLength,
          segmentIndex,
          shotField: definition.field,
        });
      }
    }
  }

  if (!isPromptWizardV6SoundDesignOnly(input)) {
    const targetLanguage = promptWizardRequiredTargetLanguage(input);
    const timeline = promptWizardDraftTimeline(input);
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const [startSeconds, endSeconds] = timeline[segmentIndex]!;
      entries.push({
        key: `v${segmentIndex}`,
        logicalPath: ['segments', segmentIndex, 'voiceover'],
        kind: 'voiceover',
        minLength: 1,
        maxLength: 300,
        segmentIndex,
        startSeconds,
        endSeconds,
      });
      if (targetLanguage !== '普通话') {
        entries.push({
          key: `z${segmentIndex}`,
          logicalPath: ['segments', segmentIndex, 'voiceoverZh'],
          kind: 'translation',
          minLength: 1,
          maxLength: 300,
          segmentIndex,
          startSeconds,
          endSeconds,
        });
      }
    }
  }
  if (mode === 'voiceover' && entries.length === 0) {
    throw promptWizardProviderInputError('5 秒纯视觉方案不能请求口播 Flat Scalar Wire');
  }
  return {
    format: PROMPT_WIZARD_FLAT_SCALAR_FORMAT,
    mode,
    segmentCount,
    entries,
  };
}

export interface PromptWizardConceptGenerationContext {
  profile: PromptWizardProductProfile;
  evidenceGraph: PromptWizardEvidenceGraph;
  productionBrief: PromptWizardProductionBrief;
  brief: PromptWizardCreativeBrief;
  config: PromptWizardVideoConfig;
  imageCount: number;
  historicalConcepts: PromptWizardConceptPreview[];
  /** 首轮本地硬门禁失败时，仅允许携带字段级问题做一次定向恢复。 */
  repairFeedback?: string[];
  deadlineAtMs?: number;
  costOwner?: PromptWizardCostOwner;
}

export interface PromptWizardDraftContentRepairIssue {
  planIndex: PromptWizardPlanIndex;
  /**
   * 仅集合内差异冲突可携带的只读对照索引。历史碰撞没有同批对照，必须省略。
   */
  referencePlanIndex?: PromptWizardPlanIndex;
  errorCode: string;
  fieldPaths: string[];
  action: string;
}

export interface PromptWizardIndexedDraft {
  planIndex: PromptWizardPlanIndex;
  draft: PromptWizardPlanDraft;
}

export interface PromptWizardDraftContentRepairResult {
  drafts: PromptWizardIndexedDraft[];
  usage: PromptWizardProviderUsage;
  outputDiagnostics?: PromptWizardOutputDiagnostic[];
  formatRepairCount?: number;
  formatRecoveryRequestCount?: number;
}

export interface PromptWizardFormatRecoveryProbeResult {
  draft: PromptWizardPlanDraft;
  usage: PromptWizardProviderUsage;
  outputDiagnostics: PromptWizardOutputDiagnostic[];
}

interface PromptWizardDraftGenerationContext {
  profile: PromptWizardProductProfile;
  evidenceGraph: PromptWizardEvidenceGraph;
  brief: PromptWizardCreativeBrief;
  config: PromptWizardVideoConfig;
  strategies: PromptWizardStrategy[];
  conceptAssignments: PromptWizardConceptAssignment[];
  imageCount: number;
  variationKey: number;
  deadlineAtMs?: number;
  costOwner?: PromptWizardCostOwner;
}

export interface PromptWizardProvider {
  analyzeProduct(
    images: PromptWizardImageInput[],
    costOwner?: PromptWizardCostOwner,
  ): Promise<PromptWizardProductAnalysisResult>;
  generateConcepts(
    input: PromptWizardConceptGenerationContext,
  ): Promise<PromptWizardConceptGenerationResult>;
  generateUseDirections(
    input: PromptWizardUseDirectionGenerationContext,
  ): Promise<PromptWizardUseDirectionGenerationResult>;
  generateUseDirectionDrafts(
    input: PromptWizardUseDirectionDraftGenerationContext,
  ): Promise<PromptWizardDraftResult>;
  repairUseDirectionDrafts(input: PromptWizardUseDirectionDraftGenerationContext & {
    previousDrafts: PromptWizardPlanDraft[];
    issues: PromptWizardDraftContentRepairIssue[];
    operation?: 'repair-draft-content' | 'refine-plan';
  }): Promise<PromptWizardDraftContentRepairResult>;
  generateDrafts(input: PromptWizardDraftGenerationContext): Promise<PromptWizardDraftResult>;
  repairDrafts(input: PromptWizardDraftGenerationContext & {
    previousDrafts: PromptWizardPlanDraft[];
    issues: PromptWizardDraftContentRepairIssue[];
    /** 缺省为内容门禁修复；refine-plan 只允许单一 issue/planIndex。 */
    operation?: 'repair-draft-content' | 'refine-plan';
  }): Promise<PromptWizardDraftContentRepairResult>;
}

export const PROMPT_WIZARD_SERVICE_TIER = 'default' as const;
export const PROMPT_WIZARD_THINKING_TYPE = 'disabled' as const;
export const PROMPT_WIZARD_PRODUCT_MAX_OUTPUT_TOKENS = 8_000;
export const PROMPT_WIZARD_CONCEPT_MAX_OUTPUT_TOKENS = 8_000;
export const PROMPT_WIZARD_USE_DIRECTION_MAX_OUTPUT_TOKENS = 2_000;
export const PROMPT_WIZARD_DRAFT_MAX_OUTPUT_TOKENS = 8_000;

const PROMPT_WIZARD_MAX_IMAGES = 9;
const PROMPT_WIZARD_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROMPT_WIZARD_MAX_KNOWN_IMAGE_BYTES = 64 * 1024 * 1024;
const PROMPT_WIZARD_MIN_PRODUCT_REPAIR_BUDGET_MS = 60_000;
const PROMPT_WIZARD_MIN_DRAFT_FORMAT_REPAIR_BUDGET_MS = 60_000;
const PROMPT_WIZARD_OUTPUT_PARSE_STATE = Symbol('prompt-wizard-output-parse-state');
const PROMPT_WIZARD_OUTPUT_SCHEMA_ISSUE = Symbol('prompt-wizard-output-schema-issue');
const PROMPT_WIZARD_OUTPUT_SCHEMA_ISSUES = new Set<PromptWizardOutputSchemaIssue>([
  'not-applicable',
  'keyset',
  'count',
  'unit',
  'secondary-source',
  'translation',
  'wire-shape',
]);
const PROMPT_WIZARD_USE_DIRECTION_ATTEMPT_TIMEOUT_MS = 60_000;
const PROMPT_WIZARD_USE_DIRECTION_REQUEST_BUDGET_MS = 120_000;
const PROMPT_WIZARD_MIN_USE_DIRECTION_REPAIR_BUDGET_MS = 30_000;
const PROMPT_WIZARD_MAX_DRAFT_CONTENT_REPAIR_ROUNDS = 2;
const PROMPT_WIZARD_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

let provider: PromptWizardProvider | null = null;

export function getPromptWizardProvider() {
  if (provider) return provider;
  provider = isPromptWizardFakeProviderEnabled()
    ? new FakePromptWizardProvider()
    : new ArkPromptWizardProvider();
  return provider;
}

/** Fake 只服务本地开发与测试；生产误配开关也必须直连方舟或显式失败。 */
export function isPromptWizardFakeProviderEnabled(
  nodeEnv = env.NODE_ENV,
  explicitlyEnabled = env.ENABLE_FAKE_PROVIDER,
) {
  return nodeEnv !== 'production' && explicitlyEnabled;
}

export function resetPromptWizardProviderForTests() {
  provider = null;
}

type PromptWizardResponsesClient = Pick<ArkPromptWizardResponsesClient, 'create'>;

export class ArkPromptWizardProvider implements PromptWizardProvider {
  private readonly model = env.ARK_PROMPT_WIZARD_MODEL;
  private readonly responses: PromptWizardResponsesClient;
  private readonly requestRecorder: PromptWizardProviderRequestRecorder;

  constructor(
    responses?: PromptWizardResponsesClient,
    requestRecorder: PromptWizardProviderRequestRecorder = promptWizardProviderRequestRecorder,
  ) {
    this.requestRecorder = requestRecorder;
    if (responses) {
      this.responses = responses;
      return;
    }
    const apiKey = env.ARK_PROMPT_WIZARD_API_KEY ?? env.ARK_API_KEY;
    if (!apiKey) {
      throw Object.assign(new Error('提示词向导未配置火山方舟 API Key'), {
        code: 'PROMPT_WIZARD_PROVIDER_NOT_CONFIGURED',
        exposeMessage: true,
      });
    }
    this.responses = new ArkPromptWizardResponsesClient({
      apiKey,
      baseUrl: env.ARK_BASE_URL,
    });
  }

  async analyzeProduct(images: PromptWizardImageInput[], costOwner?: PromptWizardCostOwner) {
    validatePromptWizardImages(images);
    const deadlineAtMs = Date.now() + env.PROMPT_WIZARD_REQUEST_BUDGET_MS;
    const analysisResult = await runArkPromptWizardOperation(
      'analyze-product',
      attemptTimeoutMs => this.responses.create(buildArkPromptWizardRequest({
        model: this.model,
        instructions: PRODUCT_ANALYSIS_SYSTEM_INSTRUCTION,
        input: buildPromptWizardProductAnalysisInput(images),
        maxOutputTokens: PROMPT_WIZARD_PRODUCT_MAX_OUTPUT_TOKENS,
        schemaName: 'prompt_wizard_product_profile',
        schema: PRODUCT_PROFILE_JSON_SCHEMA,
      }), { timeoutMs: attemptTimeoutMs }),
      promptWizardRetryPolicy(deadlineAtMs),
      costOwner ? {
        owner: costOwner,
        planIndex: null,
        model: this.model,
        serviceTier: PROMPT_WIZARD_SERVICE_TIER,
        recorder: this.requestRecorder,
      } : undefined,
    );
    const analysisResponse = analysisResult.value;
    const analysisUsage = arkResponseUsage(analysisResponse, analysisResult.attempts);
    let initialCandidate: Record<string, unknown>;
    try {
      const parsed = parseProviderJson(analysisResponse.output_text);
      if (!isPlainPromptWizardRecord(parsed)) {
        throw new z.ZodError([{
          code: 'custom',
          path: [],
          message: '产品档案必须是 JSON 对象',
        }]);
      }
      initialCandidate = parsed;
    } catch (error) {
      logPromptWizardProviderPostprocessFailure(
        'analyze-product',
        analysisResponse,
        error,
        [],
      );
      if (
        promptWizardProviderErrorMetadata(error).errorCode
          !== 'PROMPT_WIZARD_PROVIDER_INVALID_JSON'
        || analysisResult.attempts !== 1
        || deadlineAtMs - Date.now() < PROMPT_WIZARD_MIN_PRODUCT_REPAIR_BUDGET_MS
      ) {
        throw attachPromptWizardProviderFailureUsage(error, [analysisUsage], true);
      }

      logPromptWizardProductFormatRepairTriggered(
        costOwner?.runId ?? null,
        analysisResponse,
      );
      let formatRepairResult: Awaited<ReturnType<typeof runArkPromptWizardOperation>>;
      try {
        formatRepairResult = await runArkPromptWizardOperation(
          'repair-product-format',
          attemptTimeoutMs => this.responses.create(buildArkPromptWizardRequest({
            model: this.model,
            instructions: PRODUCT_FORMAT_REPAIR_SYSTEM_INSTRUCTION,
            input: buildPromptWizardProductAnalysisInput(images),
            maxOutputTokens: PROMPT_WIZARD_PRODUCT_MAX_OUTPUT_TOKENS,
            schemaName: 'prompt_wizard_product_profile_format_repair',
            schema: PRODUCT_PROFILE_JSON_SCHEMA,
          }), { timeoutMs: attemptTimeoutMs }),
          promptWizardProductFormatRepairRetryPolicy(deadlineAtMs),
          costOwner ? {
            owner: { ...costOwner, repairRound: 1 },
            planIndex: null,
            model: this.model,
            serviceTier: PROMPT_WIZARD_SERVICE_TIER,
            recorder: this.requestRecorder,
          } : undefined,
        );
      } catch (repairError) {
        throw attachPromptWizardProviderFailureUsage(repairError, [analysisUsage]);
      }

      const formatRepairResponse = formatRepairResult.value;
      const formatRepairUsage = arkResponseUsage(
        formatRepairResponse,
        formatRepairResult.attempts,
      );
      try {
        const repairedCandidate = parseProviderJson(formatRepairResponse.output_text);
        if (!isPlainPromptWizardRecord(repairedCandidate)) {
          throw new z.ZodError([{
            code: 'custom',
            path: [],
            message: '产品档案必须是 JSON 对象',
          }]);
        }
        const normalizedRecovery = normalizePromptWizardProductFormatRecoveryCandidate(
          repairedCandidate,
        );
        if (normalizedRecovery.fieldPaths.length > 0) {
          logPromptWizardProductFormatNormalized(
            formatRepairResponse,
            normalizedRecovery.fieldPaths,
          );
        }
        const repairedInspection = inspectPromptWizardProductCandidate(
          normalizedRecovery.candidate,
          undefined,
          images.length,
        );
        if (!repairedInspection.profile || repairedInspection.issues.length > 0) {
          throw promptWizardProductRepairError(
            repairedInspection.issues,
            'format-recovery-validation-failed',
          );
        }
        return {
          profile: repairedInspection.profile,
          evidenceSources: repairedInspection.evidenceSources,
          usage: mergePromptWizardProviderUsage([
            analysisUsage,
            formatRepairUsage,
          ]),
        };
      } catch (repairError) {
        logPromptWizardProviderPostprocessFailure(
          'repair-product-format',
          formatRepairResponse,
          repairError,
          promptWizardRepairIssuesFromError(repairError),
        );
        throw attachPromptWizardProviderFailureUsage(
          repairError,
          [analysisUsage, formatRepairUsage],
          true,
        );
      }
    }

    const initialInspection = inspectPromptWizardProductCandidate(
      initialCandidate,
      undefined,
      images.length,
    );
    if (initialInspection.profile && initialInspection.issues.length === 0) {
      return {
        profile: initialInspection.profile,
        evidenceSources: initialInspection.evidenceSources,
        usage: analysisUsage,
      };
    }

    logPromptWizardProviderPostprocessFailure(
      'analyze-product',
      analysisResponse,
      initialInspection.error,
      initialInspection.issues,
    );
    if (
      analysisResult.attempts !== 1
      || deadlineAtMs - Date.now() < PROMPT_WIZARD_MIN_PRODUCT_REPAIR_BUDGET_MS
    ) {
      throw attachPromptWizardProviderFailureUsage(
        promptWizardProductRepairError(
          initialInspection.issues,
          analysisResult.attempts !== 1
            ? 'request-call-limit-exhausted'
            : 'budget-exhausted',
        ),
        [analysisUsage],
        true,
      );
    }
    logPromptWizardProductRepairTriggered(
      costOwner?.runId ?? null,
      analysisResponse,
      initialInspection.issues,
    );

    let repairResult: Awaited<ReturnType<typeof runArkPromptWizardOperation>>;
    try {
      repairResult = await runArkPromptWizardOperation(
        'repair-product-profile',
        attemptTimeoutMs => this.responses.create(buildArkPromptWizardRequest({
          model: this.model,
          instructions: PRODUCT_PROFILE_REPAIR_SYSTEM_INSTRUCTION,
          input: buildPromptWizardProductRepairInput(initialCandidate, initialInspection.issues),
          maxOutputTokens: PROMPT_WIZARD_PRODUCT_MAX_OUTPUT_TOKENS,
          schemaName: 'prompt_wizard_product_profile_repair',
          schema: PRODUCT_PROFILE_JSON_SCHEMA,
        }), { timeoutMs: attemptTimeoutMs }),
        promptWizardProductRepairRetryPolicy(deadlineAtMs),
        costOwner ? {
          owner: { ...costOwner, repairRound: 1 },
          planIndex: null,
          model: this.model,
          serviceTier: PROMPT_WIZARD_SERVICE_TIER,
          recorder: this.requestRecorder,
        } : undefined,
      );
    } catch (error) {
      throw attachPromptWizardProviderFailureUsage(error, [analysisUsage]);
    }
    const repairResponse = repairResult.value;
    const repairUsage = arkResponseUsage(repairResponse, repairResult.attempts);
    try {
      let repairedCandidate: unknown;
      try {
        repairedCandidate = parseProviderJson(repairResponse.output_text);
      } catch (cause) {
        throw Object.assign(promptWizardProductRepairError([], 'repair-invalid-json'), { cause });
      }
      if (!isPlainPromptWizardRecord(repairedCandidate)) {
        throw promptWizardProductRepairError([{
          path: '$',
          kind: 'type',
        }]);
      }
      assertPromptWizardProductRepairRawRiskSafety(initialCandidate, repairedCandidate);
      const scopedRepairedCandidate = scopePromptWizardProductRepairCandidate(
        initialCandidate,
        repairedCandidate,
        initialInspection.issues,
      );
      const repairedInspection = inspectPromptWizardProductCandidate(
        scopedRepairedCandidate,
        promptWizardProductAllowedLatinTokens(initialCandidate),
        images.length,
      );
      if (!repairedInspection.profile || repairedInspection.issues.length > 0) {
        throw promptWizardProductRepairError(repairedInspection.issues);
      }
      assertPromptWizardProductRepairSafety(initialCandidate, repairedInspection.profile);
      return {
        profile: repairedInspection.profile,
        evidenceSources: repairedInspection.evidenceSources,
        usage: mergePromptWizardProviderUsage([
          analysisUsage,
          repairUsage,
        ]),
      };
    } catch (error) {
      logPromptWizardProviderPostprocessFailure(
        'repair-product-profile',
        repairResponse,
        error,
        promptWizardRepairIssuesFromError(error),
      );
      throw attachPromptWizardProviderFailureUsage(
        error,
        [analysisUsage, repairUsage],
        true,
      );
    }
  }

  async generateConcepts(input: PromptWizardConceptGenerationContext) {
    const repairFeedback = normalizePromptWizardConceptRepairFeedback(
      input.repairFeedback,
    );
    const conceptInput = repairFeedback.length > 0
      ? { ...input, repairFeedback }
      : input;
    const deadlineAtMs = input.deadlineAtMs
      ?? Date.now() + env.PROMPT_WIZARD_REQUEST_BUDGET_MS;
    const operation = repairFeedback.length > 0
      ? 'repair-concept-set' as const
      : 'generate-concepts' as const;
    const result = await runArkPromptWizardOperation(
      operation,
      attemptTimeoutMs => this.responses.create(buildArkPromptWizardRequest({
        model: this.model,
        instructions: repairFeedback.length > 0
          ? CONCEPT_DIRECTOR_REPAIR_SYSTEM_INSTRUCTION
          : CONCEPT_DIRECTOR_SYSTEM_INSTRUCTION,
        input: buildPromptWizardConceptDirectorInput(conceptInput),
        maxOutputTokens: PROMPT_WIZARD_CONCEPT_MAX_OUTPUT_TOKENS,
        schemaName: 'prompt_wizard_concept_set',
        schema: PROMPT_WIZARD_CONCEPT_SET_JSON_SCHEMA,
        // 创意阶段需要模型完成语义发散与软排序，使用模型默认思考能力。
        thinking: 'default',
      }), { timeoutMs: attemptTimeoutMs }),
      promptWizardRetryPolicy(deadlineAtMs),
      input.costOwner ? {
        owner: repairFeedback.length > 0
          ? { ...input.costOwner, repairRound: 1 }
          : input.costOwner,
        planIndex: null,
        model: this.model,
        serviceTier: PROMPT_WIZARD_SERVICE_TIER,
        recorder: this.requestRecorder,
      } : undefined,
    );
    const response = result.value;
    const usage = arkResponseUsage(response, result.attempts);
    try {
      const wire = promptWizardConceptWireSetSchema.parse(
        parseProviderJson(response.output_text),
      );
      const concepts = wire.concepts.map(concept => promptWizardConceptPreviewSchema.parse({
        ...concept,
        id: randomUUID(),
      }));
      return { concepts, usage };
    } catch (error) {
      logPromptWizardProviderPostprocessFailure(
        operation,
        response,
        error,
        [],
      );
      throw attachPromptWizardProviderFailureUsage(error, [usage], true);
    }
  }

  async generateUseDirections(input: PromptWizardUseDirectionGenerationContext) {
    if (promptWizardUseDirectionNeedsInput(input.evidenceGraph)) {
      validatePromptWizardUseDirectionClarification({
        directions: [],
        clarificationQuestion: PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION,
        evidenceGraph: input.evidenceGraph,
      });
      return {
        directions: [],
        clarificationQuestion: PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION,
        usage: emptyPromptWizardProviderUsage(this.model),
        repairRounds: 0 as const,
      };
    }

    const deadlineAtMs = Math.min(
      input.deadlineAtMs ?? Number.POSITIVE_INFINITY,
      Date.now() + PROMPT_WIZARD_USE_DIRECTION_REQUEST_BUDGET_MS,
    );
    const initialResult = await runArkPromptWizardOperation(
      'generate-use-directions',
      attemptTimeoutMs => this.responses.create(buildArkPromptWizardRequest({
        model: this.model,
        instructions: USE_DIRECTION_SYSTEM_INSTRUCTION,
        input: buildPromptWizardUseDirectionInput(input),
        maxOutputTokens: PROMPT_WIZARD_USE_DIRECTION_MAX_OUTPUT_TOKENS,
        schemaName: 'prompt_wizard_use_directions',
        schema: PROMPT_WIZARD_USE_DIRECTION_SET_JSON_SCHEMA,
        thinking: 'disabled',
      }), { timeoutMs: attemptTimeoutMs }),
      promptWizardUseDirectionRetryPolicy(deadlineAtMs, true),
      input.costOwner ? {
        owner: input.costOwner,
        planIndex: null,
        model: this.model,
        serviceTier: PROMPT_WIZARD_SERVICE_TIER,
        recorder: this.requestRecorder,
      } : undefined,
    );
    const initialResponse = initialResult.value;
    const initialUsage = arkResponseUsage(initialResponse, initialResult.attempts);
    let initialCandidate: unknown;
    let initialError: unknown;
    try {
      initialCandidate = parseProviderJson(initialResponse.output_text);
      return {
        ...decodePromptWizardUseDirections(initialCandidate, input),
        usage: initialUsage,
        repairRounds: 0 as const,
      };
    } catch (error) {
      initialError = error;
      logPromptWizardProviderPostprocessFailure(
        'generate-use-directions',
        initialResponse,
        error,
        promptWizardUseDirectionIssuePaths(error),
      );
    }

    if (deadlineAtMs - Date.now() < PROMPT_WIZARD_MIN_USE_DIRECTION_REPAIR_BUDGET_MS) {
      throw attachPromptWizardProviderFailureUsage(initialError, [initialUsage], true);
    }

    const repairFeedback = promptWizardUseDirectionRepairFeedbackFromError(initialError);
    let repairResult: Awaited<ReturnType<typeof runArkPromptWizardOperation>>;
    try {
      repairResult = await runArkPromptWizardOperation(
        'repair-use-directions',
        attemptTimeoutMs => this.responses.create(buildArkPromptWizardRequest({
          model: this.model,
          instructions: USE_DIRECTION_REPAIR_SYSTEM_INSTRUCTION,
          input: buildPromptWizardUseDirectionInput(input, {
            repairFeedback,
            previousCandidate: isPlainPromptWizardRecord(initialCandidate)
              ? initialCandidate
              : null,
          }),
          maxOutputTokens: PROMPT_WIZARD_USE_DIRECTION_MAX_OUTPUT_TOKENS,
          schemaName: 'prompt_wizard_use_directions_repair',
          schema: PROMPT_WIZARD_USE_DIRECTION_SET_JSON_SCHEMA,
          thinking: 'disabled',
        }), { timeoutMs: attemptTimeoutMs }),
        promptWizardUseDirectionRetryPolicy(deadlineAtMs, false),
        input.costOwner ? {
          owner: { ...input.costOwner, repairRound: 1 },
          planIndex: null,
          model: this.model,
          serviceTier: PROMPT_WIZARD_SERVICE_TIER,
          recorder: this.requestRecorder,
        } : undefined,
      );
    } catch (error) {
      throw attachPromptWizardProviderFailureUsage(error, [initialUsage]);
    }

    const repairResponse = repairResult.value;
    const repairUsage = arkResponseUsage(repairResponse, repairResult.attempts);
    try {
      return {
        ...decodePromptWizardUseDirections(
          parseProviderJson(repairResponse.output_text),
          input,
        ),
        usage: mergePromptWizardProviderUsage([initialUsage, repairUsage]),
        repairRounds: 1 as const,
      };
    } catch (error) {
      logPromptWizardProviderPostprocessFailure(
        'repair-use-directions',
        repairResponse,
        error,
        promptWizardUseDirectionIssuePaths(error),
      );
      throw attachPromptWizardProviderFailureUsage(
        error,
        [initialUsage, repairUsage],
        true,
      );
    }
  }

  async generateUseDirectionDrafts(input: PromptWizardUseDirectionDraftGenerationContext) {
    return generateArkPromptWizardUseDirectionDrafts({
      responses: this.responses,
      requestRecorder: this.requestRecorder,
      model: this.model,
      input,
    });
  }

  /**
   * Attempt27 专用的不可发布诊断入口。它只接收已经锁定的安全路线上下文，
   * 不接收首稿正文、错误片段或 cause，并恰好发起一次 repair-draft-format。
   * 该方法不属于公开 PromptWizardProvider 接口，也没有 HTTP/DB 映射。
   */
  async probeUseDirectionDraftFormatRecovery(
    input: PromptWizardUseDirectionDraftGenerationContext,
    planIndex: PromptWizardPlanIndex,
  ): Promise<PromptWizardFormatRecoveryProbeResult> {
    validatePromptWizardUseDirectionDraftContext(input);
    if (!isPromptWizardV6DraftContext(input)) {
      throw promptWizardProviderInputError('格式恢复诊断探针只允许用于 V6');
    }
    promptWizardDraftContextForPlanIndex(input, planIndex);
    const result = await runArkPromptWizardUseDirectionDraftPlan({
      runtime: {
        responses: this.responses,
        requestRecorder: this.requestRecorder,
        model: this.model,
      },
      context: input,
      planIndex,
      operation: 'repair-draft-format',
      deadlineAtMs: input.deadlineAtMs
        ?? Date.now() + env.PROMPT_WIZARD_REQUEST_BUDGET_MS,
    });
    return {
      draft: result.draft,
      usage: result.usage,
      outputDiagnostics: result.outputDiagnostics ?? [],
    };
  }

  async repairUseDirectionDrafts(
    input: PromptWizardUseDirectionDraftGenerationContext & {
      previousDrafts: PromptWizardPlanDraft[];
      issues: PromptWizardDraftContentRepairIssue[];
      operation?: 'repair-draft-content' | 'refine-plan';
    },
  ) {
    return repairArkPromptWizardUseDirectionDrafts({
      responses: this.responses,
      requestRecorder: this.requestRecorder,
      model: this.model,
      input,
    });
  }

  async generateDrafts(input: Parameters<PromptWizardProvider['generateDrafts']>[0]) {
    if (input.strategies.length !== PROMPT_WIZARD_PLAN_COUNT) {
      throw Object.assign(new Error('提示词向导必须为两个方案分别提供创意策略'), {
        code: 'PROMPT_WIZARD_PROVIDER_INPUT_INVALID',
      });
    }
    const segmentCount = expectedPromptWizardSegmentCount(input.config.durationSeconds);
    const sharedDeadlineAtMs = input.deadlineAtMs
      ?? Date.now() + env.PROMPT_WIZARD_REQUEST_BUDGET_MS;
    const planIndexes = PROMPT_WIZARD_LEGACY_PLAN_INDEXES;
    type PlanIndex = PromptWizardPlanIndex;
    type CompletedPlan = {
      planIndex: PlanIndex;
      draft: PromptWizardPlanDraft;
      usage: PromptWizardProviderUsage;
    };
    type SettledPlan = {
      planIndex: PlanIndex;
      result: PromiseSettledResult<CompletedPlan>;
    };

    const generatePlan = async (
      planIndex: PlanIndex,
      operation: 'generate-drafts' | 'repair-draft-format' | 'repair-draft-content',
      contentRepair?: {
        candidate: Record<string, unknown>;
        issue: PromptWizardDraftContentRepairIssue;
        repairRound: number;
      },
    ): Promise<CompletedPlan> => {
      const result = await runArkPromptWizardOperation(
        operation,
        attemptTimeoutMs => this.responses.create(buildArkPromptWizardRequest({
          model: this.model,
          instructions: operation === 'repair-draft-format'
            ? PLAN_FORMAT_REPAIR_SYSTEM_INSTRUCTION
            : operation === 'repair-draft-content'
              ? PLAN_CONTENT_REPAIR_SYSTEM_INSTRUCTION
              : PLAN_GENERATION_SYSTEM_INSTRUCTION,
          input: operation === 'repair-draft-format'
            ? buildPromptWizardDraftFormatRepairInput(input, segmentCount, planIndex)
            : operation === 'repair-draft-content'
              ? buildPromptWizardInitialDraftContentRepairInput(
                input,
                contentRepair!.candidate,
                contentRepair!.issue,
                segmentCount,
              )
              : buildPromptWizardDraftInput(input, segmentCount, planIndex),
          maxOutputTokens: PROMPT_WIZARD_DRAFT_MAX_OUTPUT_TOKENS,
          schemaName: operation === 'repair-draft-format'
            ? `prompt_wizard_plan_${planIndex + 1}_format_repair`
            : operation === 'repair-draft-content'
              ? `prompt_wizard_plan_${planIndex + 1}_initial_content_repair`
              : `prompt_wizard_plan_${planIndex + 1}`,
          schema: createDraftPlanJsonSchema(),
        }), { timeoutMs: attemptTimeoutMs }),
        operation === 'repair-draft-format'
          ? promptWizardDraftFormatRepairRetryPolicy(sharedDeadlineAtMs)
          : operation === 'repair-draft-content'
            ? promptWizardDraftContentRepairRetryPolicy(sharedDeadlineAtMs)
            : promptWizardRetryPolicy(sharedDeadlineAtMs),
        input.costOwner ? {
          owner: operation === 'repair-draft-content'
            ? {
              ...input.costOwner,
              repairRound: contentRepair!.repairRound,
            }
            : input.costOwner,
          planIndex,
          model: this.model,
          serviceTier: PROMPT_WIZARD_SERVICE_TIER,
          recorder: this.requestRecorder,
        } : undefined,
      );
      const response = result.value;
      const usage = arkResponseUsage(response, result.attempts);
      let candidate: unknown;
      try {
        candidate = parseProviderJson(response.output_text);
        return {
          planIndex,
          draft: decodePromptWizardDraftWirePlan(
            candidate,
            input,
            planIndex,
            segmentCount,
          ),
          usage,
        };
      } catch (error) {
        logPromptWizardProviderPostprocessFailure(operation, response, error, []);
        const attached = attachPromptWizardSinglePlanFailureUsage(error, usage);
        if (
          promptWizardProviderErrorMetadata(attached).errorCode
            === 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID'
          && isPlainPromptWizardRecord(candidate)
        ) {
          Object.defineProperty(attached, 'recoverableDraftCandidate', {
            value: candidate,
            enumerable: false,
            configurable: false,
            writable: false,
          });
        }
        throw attached;
      }
    };

    const initialResults = await Promise.allSettled(
      planIndexes.map(planIndex => generatePlan(planIndex, 'generate-drafts')),
    );
    const initialSettled: SettledPlan[] = planIndexes.map((planIndex, index) => ({
      planIndex,
      result: initialResults[index]!,
    }));
    const initialFailures = initialSettled.filter((entry): entry is SettledPlan & {
      result: PromiseRejectedResult;
    } => entry.result.status === 'rejected');
    const accountingEntries: SettledPlan[] = [...initialSettled];
    const completedByPlan = new Map<PlanIndex, CompletedPlan>(
      initialSettled.flatMap(entry => (
        entry.result.status === 'fulfilled'
          ? [[entry.planIndex, entry.result.value] as const]
          : []
      )),
    );

    const terminalInitialFailure = initialFailures.find(entry => (
      promptWizardProviderErrorMetadata(entry.result.reason).errorCode
        !== 'PROMPT_WIZARD_PROVIDER_INVALID_JSON'
      && !promptWizardInitialDraftSchemaRepair(entry.planIndex, entry.result.reason)
    ));
    if (terminalInitialFailure) {
      throwPromptWizardPlanFailure(terminalInitialFailure, accountingEntries);
    }

    const invalidJsonFailures = initialFailures.filter(entry => (
      promptWizardProviderErrorMetadata(entry.result.reason).errorCode
        === 'PROMPT_WIZARD_PROVIDER_INVALID_JSON'
    ));
    const formatRepairFailures: Array<SettledPlan & {
      result: PromiseRejectedResult;
    }> = [];
    if (invalidJsonFailures.length > 0) {
      if (
        sharedDeadlineAtMs - Date.now()
        < PROMPT_WIZARD_MIN_DRAFT_FORMAT_REPAIR_BUDGET_MS
      ) {
        throwPromptWizardPlanFailure(invalidJsonFailures[0]!, accountingEntries);
      }

      invalidJsonFailures.forEach(entry => {
        logPromptWizardDraftFormatRepairTriggered(
          entry.planIndex,
          entry.result.reason,
        );
      });
      const repairedResults = await Promise.allSettled(invalidJsonFailures.map(entry => (
        generatePlan(entry.planIndex, 'repair-draft-format')
      )));
      const repairedSettled: SettledPlan[] = invalidJsonFailures.map((entry, index) => ({
        planIndex: entry.planIndex,
        result: repairedResults[index]!,
      }));
      accountingEntries.push(...repairedSettled);
      repairedSettled.forEach(entry => {
        if (entry.result.status === 'fulfilled') {
          completedByPlan.set(entry.planIndex, entry.result.value);
        }
      });
      formatRepairFailures.push(...repairedSettled.filter((entry): entry is SettledPlan & {
        result: PromiseRejectedResult;
      } => entry.result.status === 'rejected'));
      const terminalFormatRepairFailure = formatRepairFailures.find(entry => (
        !promptWizardInitialDraftSchemaRepair(entry.planIndex, entry.result.reason)
      ));
      if (terminalFormatRepairFailure) {
        throwPromptWizardPlanFailure(terminalFormatRepairFailure, accountingEntries);
      }
    }

    let repairRounds = 0;
    let schemaRepairFailures = [
      ...initialFailures.filter(entry => (
        promptWizardInitialDraftSchemaRepair(entry.planIndex, entry.result.reason) !== null
      )),
      ...formatRepairFailures,
    ];
    while (schemaRepairFailures.length > 0) {
      if (
        repairRounds >= PROMPT_WIZARD_MAX_DRAFT_CONTENT_REPAIR_ROUNDS
        || sharedDeadlineAtMs - Date.now()
          < PROMPT_WIZARD_MIN_DRAFT_FORMAT_REPAIR_BUDGET_MS
      ) {
        throwPromptWizardPlanFailure(
          schemaRepairFailures[0]!,
          accountingEntries,
          repairRounds,
        );
      }

      repairRounds += 1;
      const repairContexts = schemaRepairFailures.map(entry => (
        promptWizardInitialDraftSchemaRepair(entry.planIndex, entry.result.reason)!
      ));
      const repairedResults = await Promise.allSettled(repairContexts.map(context => (
        generatePlan(context.issue.planIndex as PlanIndex, 'repair-draft-content', {
          ...context,
          repairRound: repairRounds,
        })
      )));
      const repairedSettled: SettledPlan[] = repairContexts.map((context, index) => ({
        planIndex: context.issue.planIndex as PlanIndex,
        result: repairedResults[index]!,
      }));
      accountingEntries.push(...repairedSettled);
      repairedSettled.forEach(entry => {
        if (entry.result.status === 'fulfilled') {
          completedByPlan.set(entry.planIndex, entry.result.value);
        }
      });

      const failedRepairs = repairedSettled.filter((entry): entry is SettledPlan & {
        result: PromiseRejectedResult;
      } => entry.result.status === 'rejected');
      const terminalRepairFailure = failedRepairs.find(entry => (
        !promptWizardInitialDraftSchemaRepair(entry.planIndex, entry.result.reason)
      ));
      if (terminalRepairFailure) {
        throwPromptWizardPlanFailure(
          terminalRepairFailure,
          accountingEntries,
          repairRounds,
        );
      }
      schemaRepairFailures = failedRepairs;
    }

    const completed = planIndexes
      .map(planIndex => completedByPlan.get(planIndex))
      .filter((result): result is CompletedPlan => result !== undefined)
      .sort((left, right) => left.planIndex - right.planIndex);
    if (completed.length !== planIndexes.length) {
      throw Object.assign(new Error('提示词模型没有返回完整的两套方案'), {
        code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
        repairRounds,
      });
    }
    let drafts: PromptWizardPlanDraft[];
    try {
      drafts = promptWizardPlanDraftBatchSchema.parse({
        plans: completed.map(result => result.draft),
      }).plans;
    } catch (error) {
      const target = error instanceof Error ? error : new Error('两套方案聚合校验失败');
      throw Object.assign(target, { repairRounds });
    }
    return {
      drafts,
      usage: mergePromptWizardProviderUsage(
        accountingEntries.flatMap(promptWizardUsageFromSettledPlan),
      ),
      repairRounds,
    };
  }

  async repairDrafts(input: Parameters<PromptWizardProvider['repairDrafts']>[0]) {
    const operation = input.operation ?? 'repair-draft-content';
    const issues = validatePromptWizardDraftContentRepairInput(input);
    const segmentCount = expectedPromptWizardSegmentCount(input.config.durationSeconds);
    const sharedDeadlineAtMs = input.deadlineAtMs
      ?? Date.now() + env.PROMPT_WIZARD_REQUEST_BUDGET_MS;

    if (operation === 'refine-plan') {
      if (issues.length !== 1) {
        throw promptWizardProviderInputError('单方案定向微调只能提供一个方案索引');
      }
      const issue = issues[0]!;
      const result = await runArkPromptWizardOperation(
        'refine-plan',
        attemptTimeoutMs => this.responses.create(buildArkPromptWizardRequest({
          model: this.model,
          instructions: PLAN_REFINEMENT_SYSTEM_INSTRUCTION,
          input: buildPromptWizardPlanRefinementInput(
            input,
            issue,
            segmentCount,
          ),
          maxOutputTokens: PROMPT_WIZARD_DRAFT_MAX_OUTPUT_TOKENS,
          schemaName: `prompt_wizard_plan_${issue.planIndex + 1}_refinement`,
          schema: createDraftPlanJsonSchema(),
        }), { timeoutMs: attemptTimeoutMs }),
        promptWizardDraftContentRepairRetryPolicy(sharedDeadlineAtMs),
        input.costOwner ? {
          owner: input.costOwner,
          planIndex: issue.planIndex,
          model: this.model,
          serviceTier: PROMPT_WIZARD_SERVICE_TIER,
          recorder: this.requestRecorder,
        } : undefined,
      );
      const response = result.value;
      const usage = arkResponseUsage(response, result.attempts);
      try {
        return {
          drafts: [{
            planIndex: issue.planIndex,
            draft: decodePromptWizardDraftWirePlan(
              parseProviderJson(response.output_text),
              input,
              issue.planIndex,
              segmentCount,
            ),
          }],
          usage,
        };
      } catch (error) {
        logPromptWizardProviderPostprocessFailure('refine-plan', response, error, []);
        throw attachPromptWizardProviderFailureUsage(error, [usage], true);
      }
    }
    type CompletedPlan = PromptWizardIndexedDraft & {
      usage: PromptWizardProviderUsage;
    };
    type SettledPlan = {
      planIndex: number;
      result: PromiseSettledResult<CompletedPlan>;
    };

    const repairPlan = async (
      issue: PromptWizardDraftContentRepairIssue,
      operation: 'repair-draft-content' | 'repair-draft-format',
    ): Promise<CompletedPlan> => {
      const result = await runArkPromptWizardOperation(
        operation,
        attemptTimeoutMs => this.responses.create(buildArkPromptWizardRequest({
          model: this.model,
          instructions: operation === 'repair-draft-format'
            ? PLAN_CONTENT_FORMAT_REPAIR_SYSTEM_INSTRUCTION
            : PLAN_CONTENT_REPAIR_SYSTEM_INSTRUCTION,
          input: operation === 'repair-draft-format'
            ? buildPromptWizardDraftContentFormatRepairInput(input, issue, segmentCount)
            : buildPromptWizardDraftContentRepairInput(input, issue, segmentCount),
          maxOutputTokens: PROMPT_WIZARD_DRAFT_MAX_OUTPUT_TOKENS,
          schemaName: operation === 'repair-draft-format'
            ? `prompt_wizard_plan_${issue.planIndex + 1}_content_format_repair`
            : `prompt_wizard_plan_${issue.planIndex + 1}_content_repair`,
          schema: createDraftPlanJsonSchema(),
        }), { timeoutMs: attemptTimeoutMs }),
        operation === 'repair-draft-format'
          ? promptWizardDraftFormatRepairRetryPolicy(sharedDeadlineAtMs)
          : promptWizardDraftContentRepairRetryPolicy(sharedDeadlineAtMs),
        input.costOwner ? {
          owner: input.costOwner,
          planIndex: issue.planIndex,
          model: this.model,
          serviceTier: PROMPT_WIZARD_SERVICE_TIER,
          recorder: this.requestRecorder,
        } : undefined,
      );
      const response = result.value;
      const usage = arkResponseUsage(response, result.attempts);
      try {
        return {
          planIndex: issue.planIndex,
          draft: decodePromptWizardDraftWirePlan(
            parseProviderJson(response.output_text),
            input,
            issue.planIndex,
            segmentCount,
          ),
          usage,
        };
      } catch (error) {
        logPromptWizardProviderPostprocessFailure(operation, response, error, []);
        throw attachPromptWizardSinglePlanFailureUsage(error, usage);
      }
    };

    const initialResults = await Promise.allSettled(
      issues.map(issue => repairPlan(issue, 'repair-draft-content')),
    );
    const initialSettled: SettledPlan[] = issues.map((issue, index) => ({
      planIndex: issue.planIndex,
      result: initialResults[index]!,
    }));
    const accountingEntries: SettledPlan[] = [...initialSettled];
    const completedByPlan = new Map<number, CompletedPlan>(
      initialSettled.flatMap(entry => (
        entry.result.status === 'fulfilled'
          ? [[entry.planIndex, entry.result.value] as const]
          : []
      )),
    );
    const initialFailures = initialSettled.filter((entry): entry is SettledPlan & {
      result: PromiseRejectedResult;
    } => entry.result.status === 'rejected');

    if (initialFailures.length > 0) {
      const terminalFailure = initialFailures.find(entry => (
        promptWizardProviderErrorMetadata(entry.result.reason).errorCode
          !== 'PROMPT_WIZARD_PROVIDER_INVALID_JSON'
      ));
      if (terminalFailure) {
        throwPromptWizardPlanFailure(terminalFailure, accountingEntries);
      }
      if (
        sharedDeadlineAtMs - Date.now()
        < PROMPT_WIZARD_MIN_DRAFT_FORMAT_REPAIR_BUDGET_MS
      ) {
        throwPromptWizardPlanFailure(initialFailures[0]!, accountingEntries);
      }

      const failedIssues = initialFailures.map(failure => (
        issues.find(issue => issue.planIndex === failure.planIndex)!
      ));
      initialFailures.forEach(entry => {
        logPromptWizardDraftFormatRepairTriggered(
          entry.planIndex,
          entry.result.reason,
        );
      });
      const repairedResults = await Promise.allSettled(
        failedIssues.map(issue => repairPlan(issue, 'repair-draft-format')),
      );
      const repairedSettled: SettledPlan[] = failedIssues.map((issue, index) => ({
        planIndex: issue.planIndex,
        result: repairedResults[index]!,
      }));
      accountingEntries.push(...repairedSettled);
      repairedSettled.forEach(entry => {
        if (entry.result.status === 'fulfilled') {
          completedByPlan.set(entry.planIndex, entry.result.value);
        }
      });
      const repairFailure = repairedSettled.find((entry): entry is SettledPlan & {
        result: PromiseRejectedResult;
      } => entry.result.status === 'rejected');
      if (repairFailure) {
        throwPromptWizardPlanFailure(repairFailure, accountingEntries);
      }
    }

    const drafts = issues
      .map(issue => completedByPlan.get(issue.planIndex))
      .filter((entry): entry is CompletedPlan => entry !== undefined)
      .sort((left, right) => left.planIndex - right.planIndex)
      .map(({ planIndex, draft }) => ({ planIndex, draft }));
    if (drafts.length !== issues.length) {
      throw Object.assign(new Error('提示词模型没有返回全部待修复方案'), {
        code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      });
    }
    return {
      drafts,
      usage: mergePromptWizardProviderUsage(
        accountingEntries.flatMap(promptWizardUsageFromSettledPlan),
      ),
    };
  }
}

function buildArkPromptWizardRequest(input: {
  model: string;
  instructions: string;
  input: unknown;
  maxOutputTokens: number;
  schemaName: string;
  schema: Record<string, unknown>;
  thinking?: 'disabled' | 'default';
}): ArkPromptWizardResponsesRequest {
  return {
    model: input.model,
    store: false,
    stream: true,
    service_tier: PROMPT_WIZARD_SERVICE_TIER,
    ...(input.thinking === 'default'
      ? {}
      : { thinking: { type: PROMPT_WIZARD_THINKING_TYPE } as const }),
    instructions: input.instructions,
    input: input.input,
    max_output_tokens: input.maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name: input.schemaName,
        strict: true,
        schema: input.schema,
      },
    },
  };
}

export function promptWizardRetryPolicy(deadlineAtMs?: number): PromptWizardRetryPolicy {
  return {
    attemptTimeoutMs: env.PROMPT_WIZARD_TIMEOUT_MS,
    requestBudgetMs: env.PROMPT_WIZARD_REQUEST_BUDGET_MS,
    maxRetries: env.PROMPT_WIZARD_MAX_RETRIES,
    baseDelayMs: env.PROMPT_WIZARD_RETRY_BASE_DELAY_MS,
    maxDelayMs: env.PROMPT_WIZARD_RETRY_MAX_DELAY_MS,
    ...(deadlineAtMs !== undefined ? { deadlineAtMs } : {}),
  };
}

function promptWizardUseDirectionRetryPolicy(
  deadlineAtMs: number,
  allowTransportRetry: boolean,
): PromptWizardRetryPolicy {
  return {
    ...promptWizardRetryPolicy(deadlineAtMs),
    attemptTimeoutMs: PROMPT_WIZARD_USE_DIRECTION_ATTEMPT_TIMEOUT_MS,
    requestBudgetMs: PROMPT_WIZARD_USE_DIRECTION_REQUEST_BUDGET_MS,
    maxRetries: allowTransportRetry ? Math.min(1, env.PROMPT_WIZARD_MAX_RETRIES) : 0,
    ...(allowTransportRetry
      ? {}
      : { minimumAttemptBudgetMs: PROMPT_WIZARD_MIN_USE_DIRECTION_REPAIR_BUDGET_MS }),
  };
}

function promptWizardProductRepairRetryPolicy(deadlineAtMs: number): PromptWizardRetryPolicy {
  return {
    ...promptWizardRetryPolicy(deadlineAtMs),
    maxRetries: 0,
    minimumAttemptBudgetMs: PROMPT_WIZARD_MIN_PRODUCT_REPAIR_BUDGET_MS,
  };
}

function promptWizardProductFormatRepairRetryPolicy(deadlineAtMs: number): PromptWizardRetryPolicy {
  return {
    ...promptWizardRetryPolicy(deadlineAtMs),
    maxRetries: 0,
    minimumAttemptBudgetMs: PROMPT_WIZARD_MIN_PRODUCT_REPAIR_BUDGET_MS,
  };
}

function promptWizardDraftFormatRepairRetryPolicy(deadlineAtMs: number): PromptWizardRetryPolicy {
  return {
    ...promptWizardRetryPolicy(deadlineAtMs),
    maxRetries: 0,
    minimumAttemptBudgetMs: PROMPT_WIZARD_MIN_DRAFT_FORMAT_REPAIR_BUDGET_MS,
  };
}

function promptWizardDraftContentRepairRetryPolicy(
  deadlineAtMs: number,
): PromptWizardRetryPolicy {
  return {
    ...promptWizardRetryPolicy(deadlineAtMs),
    minimumAttemptBudgetMs: PROMPT_WIZARD_MIN_DRAFT_FORMAT_REPAIR_BUDGET_MS,
  };
}

/**
 * 方舟 Responses API 的多模态输入使用 message + input_text/input_image。
 */
export function buildPromptWizardProductAnalysisInput(images: PromptWizardImageInput[]) {
  return [{
    type: 'message' as const,
    role: 'user' as const,
    content: [
      {
        type: 'input_text' as const,
        text: `用简体中文分析下面 ${images.length} 张同一产品的参考图片。文件名仅用于区分图片，不可当作已确认卖点：${images.map(image => image.name).join('、')}\n\n${PRODUCT_ANALYSIS_CHINESE_GATE}\n${PRODUCT_ANALYSIS_OUTPUT_PREFLIGHT}`,
      },
      ...images.map(image => ({
        type: 'input_image' as const,
        image_url: image.url,
        detail: 'high' as const,
      })),
    ],
  }];
}

export function buildPromptWizardConceptDirectorInput(
  input: PromptWizardConceptGenerationContext,
) {
  const repairFeedback = normalizePromptWizardConceptRepairFeedback(
    input.repairFeedback,
  );
  const reliableEvidence = input.evidenceGraph.evidences.filter(evidence => (
    input.evidenceGraph.reliableEvidenceIds.includes(evidence.id)
    && (evidence.status === 'visible' || evidence.status === 'user-confirmed')
  ));
  const creativePlaybook = buildPromptWizardCreativePlaybook({
    graph: input.evidenceGraph,
    productionBrief: input.productionBrief,
    direction: input.brief.direction,
  });
  return JSON.stringify({
    task: '为当前产品生成八条产品专属短视频创意路线，并完成软质量排序',
    product: {
      productName: input.profile.productName,
      category: input.profile.category,
      usage: input.profile.usage,
      structure: input.profile.structure,
      logo: input.profile.logo,
      consistencyConstraints: input.profile.consistencyConstraints,
      userConfirmedClaims: splitPromptWizardAllowedCommercialClaims(
        input.profile.userConfirmedClaims,
      ),
    },
    evidenceGraph: {
      productFamily: input.evidenceGraph.productFamily,
      reliableEvidence: reliableEvidence.map(evidence => ({
        id: evidence.id,
        type: evidence.type,
        text: evidence.text,
        status: evidence.status,
        confidence: evidence.confidence,
        sourceImageAssetIds: evidence.sourceImageAssetIds,
        visibleRegion: evidence.visibleRegion,
        proofActions: evidence.proofActions,
      })),
      forbiddenAssumptionIds: input.evidenceGraph.forbiddenAssumptionIds,
    },
    productionBrief: input.productionBrief,
    creativeBrief: input.brief,
    directionBlueprint: getPromptWizardDirectionBlueprint(input.brief.direction),
    creativePlaybook,
    fixedVideoConfig: input.config,
    imageCount: input.imageCount,
    currentRunHistory: input.historicalConcepts.map(concept => ({
      firstSecondEvent: concept.firstSecondEvent,
      purchaseReason: concept.purchaseReason,
      tension: concept.tension,
      scene: concept.scene,
      perspective: concept.perspective,
      ctaCallback: concept.ctaCallback,
    })),
    routeAllocation: {
      total: 8,
      reliableConversion: 4,
      creativeBreakthrough: 4,
      recommendationTarget: '后续服务端会从两组中各选一条，当前 rank 请按综合可用性从 1 到 8 唯一排序',
    },
    hardRules: [
      '每条路线只允许一个核心购买理由，并且必须由 evidenceIds 中至少一个可靠证据直接支持',
      'productAction 必须具体执行所选 evidence 的 proofActions 或等价可拍动作，并点明被验证的事实；visibleResult 必须描述该动作后镜头真正可见的证据状态，禁止使用“展示证据”“状态可核对”等通用占位句',
      'firstSecondEvent 必须是一秒内能够看懂的物理动作、状态变化或信息揭晓，不能只是人物拿产品口述',
      'viewerQuestion 必须让观众清楚知道继续看会得到什么答案；ctaCallback 必须回扣这个问题',
      'tension、productAction 与 visibleResult 必须形成同一条因果闭环，不得依赖魔法变化、假测评或不可见功效',
      '四条可信转化型优先真实、简单、可复现；四条强钩子记忆型可以更意外，但同样必须可执行且可追溯',
      '场景、人物、道具和动作必须服从 productionBrief 与 fixedVideoConfig；不得假定用户拥有未声明素材',
      '所有说明字段使用简体中文；品牌、型号、Logo 与图片可见印花原文可以保留',
      '不得生成价格、折扣、认证、性能、功效、用户评价、竞品结论或虚假稀缺，除非逐字来自 userConfirmedClaims',
      '不得输出完整分镜、时间码、口播或 Seedance 提示词；这里只生成短路线',
      'productionLoad 必须按路线真实填写地点、人物、主要动作、道具、运镜数量与是否包含魔法转场',
      '八条路线在第一秒事件、张力、主证据、场景或视角、CTA 回扣上形成实质差异，不能只换标题或同义词',
    ],
    structuredOutputPolicy: {
      rule: '只返回符合 JSON Schema 的原生 JSON 对象，不输出 Markdown、代码围栏或解释',
    },
    ...(repairFeedback.length > 0 ? {
      repairFeedback,
      repairPolicy: [
        'repairFeedback 是上一轮本地硬门禁的精确问题，必须逐项修复后返回完整八条路线',
        '只修复反馈涉及的内容，不得改变产品事实、可靠 evidence ID、主创作方向、生产简报和固定视频配置',
        '不得通过删除购买理由、证据链或第一秒物理事件来规避门禁',
        '新结果仍必须包含四条可信转化型和四条强钩子记忆型，rank 1–8 唯一，并重新满足全部 hardRules',
      ],
    } : {}),
  });
}

export function buildPromptWizardUseDirectionInput(
  input: PromptWizardUseDirectionGenerationContext,
  repair?: {
    repairFeedback: string[];
    previousCandidate: Record<string, unknown> | null;
  },
) {
  const reliableIds = new Set(input.evidenceGraph.reliableEvidenceIds);
  const reliableEvidence = input.evidenceGraph.evidences.filter(evidence => (
    reliableIds.has(evidence.id)
    && (evidence.status === 'visible' || evidence.status === 'user-confirmed')
    && !['appearance', 'audience', 'scenario'].includes(evidence.type)
  ));
  return JSON.stringify({
    task: repair
      ? '只修复上一轮产品使用方向中的指定问题，并返回完整结果'
      : '根据当前产品的可靠证据规划 2–3 个可直接用于带货短视频的产品使用方向',
    product: {
      productName: input.profile.productName,
      category: input.profile.category,
      usage: input.profile.usage,
      structure: input.profile.structure,
      materials: input.profile.materials,
      logo: input.profile.logo,
      suggestedAudience: input.profile.suggestedAudience,
      suggestedScenarios: input.profile.suggestedScenarios,
      consistencyConstraints: input.profile.consistencyConstraints,
      userConfirmedClaims: splitPromptWizardAllowedCommercialClaims(
        input.profile.userConfirmedClaims,
      ),
    },
    productFamily: input.evidenceGraph.productFamily,
    reliableEvidence: reliableEvidence.map(evidence => ({
      id: evidence.id,
      type: evidence.type,
      text: evidence.text,
      status: evidence.status,
      proofActions: evidence.proofActions,
      visibleRegion: evidence.visibleRegion,
    })),
    forbiddenAssumptionIds: input.evidenceGraph.forbiddenAssumptionIds,
    currentRunHistory: input.historicalDirections.map(direction => ({
      title: direction.title,
      useMoment: direction.useMoment,
      purchaseReason: direction.purchaseReason,
      proofAction: direction.proofAction,
      scenes: direction.sceneOptions.map(scene => ({
        environment: scene.environment,
        mainAction: scene.mainAction,
      })),
    })),
    outputRules: [
      '正常结果返回 2–3 个方向，不得为了凑够三个方向编造用途或卖点',
      `若可靠证据确实无法形成至少两个不同方向，directions 返回空数组，并把 clarificationQuestion 精确写为“${PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION}”`,
      '正常返回方向时 clarificationQuestion 必须是空字符串',
      USE_DIRECTION_NATIVE_JSON_TYPE_RULE,
      '购买理由与自证动作由服务端从 evidenceIds 首个可靠事实及其 proofActions[0] 确定；请把最能支持该方向、且具有可拍 proofActions 的主证据 ID 排在第一位，响应中不得返回 purchaseReason 或 proofAction',
      '每个方向给出 2–3 个具体场景；每个场景必须包含具体环境，主动作由服务端复用主证据的 proofActions[0]，响应中不得返回 mainAction',
      'appearanceMode 由产品和动作决定；product-only 不得要求真人或手部，hands-only 不得要求完整人物',
      '没有包装证据不得推荐 unboxing-review 或要求包装素材',
      '没有用户确认且可观察的功能不得推荐 feature-test',
      '没有真实可产生声音的动作不得推荐 asmr-detail',
      '不得使用待确认或 forbidden evidence，不得生成未经确认的价格、折扣、功效、认证、评价、稀缺性或竞品结论',
      '所有说明字段必须以简体中文为主，品牌、型号、Logo 和图片可见印花原文可保留',
      '不同方向必须在使用时刻、唯一购买理由、自证动作或场景中至少两项不同，并避开 currentRunHistory',
      '只返回符合 JSON Schema 的原生 JSON，不输出 Markdown、代码围栏或解释',
    ],
    ...(repair ? {
      repair: {
        feedback: repair.repairFeedback,
        previousCandidate: repair.previousCandidate,
        rules: [
          '只修改 feedback 指出的字段；没有指出问题的合格方向尽量保持不变',
          '不得改变可靠证据文本、添加新的 evidence ID 或引入新的产品事实',
          '若上一轮不是合法 JSON，previousCandidate 为 null，必须按原输入重新返回完整合法对象',
          '修复前先按原生 JSON 类型规则逐字段自检；响应不得包含由服务端确定的 purchaseReason、proofAction、mainAction 或 internalDirection',
          '本轮是唯一修复机会，输出前逐项自检数量、证据、场景、素材和语言规则',
        ],
      },
    } : {}),
  });
}

function normalizePromptWizardConceptRepairFeedback(value?: string[]) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw promptWizardProviderInputError('创意路线修复反馈必须包含 1–64 个问题');
  }
  const normalized = Array.from(new Set(value.map(item => item.trim())));
  if (
    normalized.some(item => item.length < 1 || item.length > 500)
    || normalized.length < 1
  ) {
    throw promptWizardProviderInputError('创意路线修复反馈格式无效');
  }
  return normalized;
}

export function validatePromptWizardImages(images: PromptWizardImageInput[]) {
  if (images.length < 1 || images.length > PROMPT_WIZARD_MAX_IMAGES) {
    throw promptWizardImageError(`产品识别必须提供 1–${PROMPT_WIZARD_MAX_IMAGES} 张图片`);
  }

  let knownTotalBytes = 0;
  images.forEach((image, index) => {
    if (!image.name.trim()) throw promptWizardImageError(`图片 ${index + 1} 缺少文件名`);
    if (!PROMPT_WIZARD_IMAGE_MIME_TYPES.has(image.mimeType)) {
      throw promptWizardImageError(`图片 ${index + 1} 的格式不受支持`);
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(image.url);
    } catch {
      throw promptWizardImageError(`图片 ${index + 1} 的读取地址无效`);
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw promptWizardImageError(`图片 ${index + 1} 的读取地址协议不受支持`);
    }
    if (!Number.isSafeInteger(image.sizeBytes) || image.sizeBytes <= 0) {
      throw promptWizardImageError(`图片 ${index + 1} 的字节大小无效`);
    }
    if (image.sizeBytes > PROMPT_WIZARD_MAX_IMAGE_BYTES) {
      throw promptWizardImageError(`图片 ${index + 1} 超过 10 MiB 限制`);
    }
    knownTotalBytes += image.sizeBytes;
  });

  if (knownTotalBytes > PROMPT_WIZARD_MAX_KNOWN_IMAGE_BYTES) {
    throw promptWizardImageError('已知图片总大小超过 64 MiB 限制');
  }
}

function promptWizardImageError(message: string) {
  return Object.assign(new Error(message), {
    code: 'PROMPT_WIZARD_PROVIDER_IMAGE_INVALID',
    exposeMessage: true,
  });
}

export type PromptWizardProductRepairIssueKind =
  | 'missing'
  | 'type'
  | 'too_long'
  | 'too_many_items'
  | 'empty'
  | 'language'
  | 'must_be_empty';

export interface PromptWizardProductRepairIssue {
  path: string;
  kind: PromptWizardProductRepairIssueKind;
  limit?: number;
  actual?: number;
}

export function buildPromptWizardProductRepairInput(
  profile: Record<string, unknown>,
  issues: PromptWizardProductRepairIssue[],
) {
  const allowedOriginalLatinTokens = [...new Set([
    ...PRODUCT_PROFILE_FIXED_LATIN_TOKENS,
    ...promptWizardProductAllowedLatinTokens(profile),
  ])].sort((left, right) => left.localeCompare(right, 'en-US'));
  return JSON.stringify({
    task: '只修复现有产品档案中列出的结构、长度、空值和简体中文问题',
    repairScope: {
      editableFieldPaths: issues.map(issue => issue.path),
      rule: '必须返回完整对象，但只能修改 editableFieldPaths 指向的字段或数组项；其余字段和数组项必须逐字保持不变',
    },
    languagePolicy: {
      simplifiedChineseRule: '每个 language 问题字段或数组项都必须独立成为以简体中文为主的完整说明句；先做 NFKC 归一化，忽略数字、标点和 allowedOriginalLatinTokens 后，必须包含汉字，剩余拉丁字符数不得超过 max(4, 汉字数)',
      visibleOriginalRule: '英文或其他拉丁字母说明必须完整翻译为简体中文；只有真实品牌、型号、Logo 或图片中实际可见的印花原文可以原样保留，建议用中文说明加引号原文的形式表达，不得把整句外语说明当作原文保留',
      arrayRule: 'visibleFacts 与 needsConfirmation 的每一项单独执行中文占主导校验，不能用其他数组项中的中文补足当前项',
      allowedOriginalLatinTokens,
    },
    repairActions: issues.map(issue => ({
      path: issue.path,
      kind: issue.kind,
      action: promptWizardProductRepairAction(issue),
      ...(issue.limit !== undefined ? { limit: issue.limit } : {}),
      ...(issue.actual !== undefined ? { actual: issue.actual } : {}),
    })),
    issues,
    profile,
  });
}

function promptWizardProductRepairAction(issue: PromptWizardProductRepairIssue) {
  if (issue.kind === 'language') {
    return `把该字段或数组项的说明性文字完整翻译或改写为简体中文；允许的可见原文保持原样；当前非允许拉丁字符数为 ${issue.actual ?? '未知'}，修复后不得超过 ${issue.limit ?? 'max(4, 汉字数)'}`;
  }
  if (issue.kind === 'must_be_empty') return '改为空字符串';
  if (issue.kind === 'too_many_items') return `只删除末尾超量项目，使数组不超过 ${issue.limit ?? 20} 项`;
  if (issue.kind === 'too_long') return `只压缩现有信息，不得超过 ${issue.limit ?? '字段'} 字符`;
  if (issue.kind === 'empty') return '删除该空白数组项，不得补写或推断新事实';
  if (issue.kind === 'missing') return '缺失字符串补空字符串，缺失数组补空数组，不得补写事实';
  return '修正为 JSON Schema 要求的字段类型，不得新增事实';
}

/** 纯文本输入直接使用字符串，避免为文本任务构造多模态 message。 */
function assignedPromptWizardConcept(
  input: Parameters<PromptWizardProvider['generateDrafts']>[0],
  planIndex: PromptWizardPlanIndex,
) {
  const assignment = input.conceptAssignments[planIndex];
  const strategy = input.strategies[planIndex];
  if (
    !assignment
    || assignment.planIndex !== planIndex
    || assignment.direction !== input.brief.direction
    || !strategy
    || strategySignature(assignment.strategy) !== strategySignature(strategy)
    || assignment.evidenceIds.length === 0
  ) {
    throw promptWizardProviderInputError(`方案 ${planIndex + 1} 的入选创意上下文无效`);
  }
  return assignment;
}

type PromptWizardUseDirectionDraftRepairContext = PromptWizardUseDirectionDraftGenerationContext & {
  previousDrafts: PromptWizardPlanDraft[];
  issues: PromptWizardDraftContentRepairIssue[];
  operation?: 'repair-draft-content' | 'refine-plan';
};

function promptWizardDeepFreezeRepairSnapshot<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) {
    promptWizardDeepFreezeRepairSnapshot(child, seen);
  }
  return Object.freeze(value);
}

function validatePromptWizardUseDirectionDraftContext(
  input: PromptWizardUseDirectionDraftGenerationContext,
) {
  const isV6 = input.planContexts.some(context => 'routeRole' in context);
  const soundDesignOnly = isV6 && input.config.durationSeconds === 5;
  if (soundDesignOnly) {
    if (input.targetLanguage !== undefined || input.confirmedOffer !== undefined) {
      throw promptWizardProviderInputError('5 秒纯视觉生成不得向 Provider 发送口播语言或真实优惠');
    }
  } else {
    promptWizardRequiredTargetLanguage(input);
  }
  if (
    (isV6 && input.planContexts.length !== 1 && input.planContexts.length !== 3)
    || (!isV6 && input.planContexts.length !== 2)
  ) {
    throw promptWizardProviderInputError('方案扩写必须提供两个历史上下文，或一个/三个 V6 路线上下文');
  }
  const contexts = isV6
    ? input.planContexts.map(context => validatePromptWizardRouteDraftPlanContext(context))
    : input.planContexts.map(context => promptWizardUseDirectionPlanContextSchema.parse(context));
  if (isV6) {
    const expectedRoles: PromptWizardRouteRole[] = [
      'proof-conversion', 'problem-hook', 'lifestyle-seeding',
    ];
    if (contexts.some(context => (
      !('routeRole' in context) || context.routeRole !== expectedRoles[context.planIndex]
    ))) {
      throw promptWizardProviderInputError('V6 必须按产品自证、痛点钩子、场景种草提供三个路线');
    }
    if (
      contexts.length === 3
      && (
        contexts.some((context, index) => context.planIndex !== index)
        || new Set(contexts.map(context => context.useDirection.id)).size !== 3
      )
    ) {
      throw promptWizardProviderInputError('V6 三个商业角色必须使用不同路线');
    }
  } else {
    if (contexts.some((context, index) => context.planIndex !== index)) {
      throw promptWizardProviderInputError('历史方案上下文索引必须从 0 连续排列');
    }
    if (contexts[0]?.variant !== 'reliable' || contexts[1]?.variant !== 'hook') {
      throw promptWizardProviderInputError('方案 1 必须易落地，方案 2 必须为强钩子');
    }
    const directionId = contexts[0]?.useDirection.id;
    const scene = contexts[0]?.selectedScene;
    if (
      !directionId
      || !scene
      || contexts.some(context => context.useDirection.id !== directionId)
      || contexts.some(context => (
        context.selectedScene.id !== scene.id
        || context.selectedScene.title !== scene.title
        || context.selectedScene.environment !== scene.environment
        || context.selectedScene.mainAction !== scene.mainAction
      ))
    ) {
      throw promptWizardProviderInputError('两个历史方案必须围绕同一个使用方向和场景生成');
    }
  }
  const reliableEvidenceIds = new Set(input.evidenceGraph.reliableEvidenceIds);
  if (contexts.some(context => context.useDirection.evidenceIds.some(
    evidenceId => !reliableEvidenceIds.has(evidenceId),
  ))) {
    throw promptWizardProviderInputError('使用方向包含不可靠的产品证据');
  }
  if (isV6 && contexts.some(context => context.useDirection.evidenceIds.some(
    evidenceId => {
      const evidence = input.evidenceGraph.evidences.find(item => item.id === evidenceId);
      return !evidence
        || evidence.id.length > 80
        || promptWizardCanonicalDeterministicDraftText(evidence.text).length > 300;
    },
  ))) {
    // evidenceRefs 是可追溯主键，proofPoints 是必须与证据原文
    // 精确匹配的事实；二者都不能通过截断“修复”。V6 在任何
    // Provider 外呼前失败关闭，与 RouteSet 新建路径的证据边界保持一致。
    throw promptWizardProviderInputError('V6 锁定证据超出 Draft 可追溯边界');
  }
  if (!Number.isSafeInteger(input.imageCount) || input.imageCount < 1 || input.imageCount > 9) {
    throw promptWizardProviderInputError('全能参考图片数量必须为 1–9 张');
  }
  return contexts;
}

function promptWizardDraftContextForPlanIndex(
  input: PromptWizardUseDirectionDraftGenerationContext,
  planIndex: PromptWizardPlanIndex,
) {
  const context = validatePromptWizardUseDirectionDraftContext(input)
    .find(candidate => candidate.planIndex === planIndex);
  if (!context) {
    throw promptWizardProviderInputError(`缺少方案 ${planIndex + 1} 的路线上下文`);
  }
  return context;
}

function validatePromptWizardLockedHookZh(value: unknown) {
  if (typeof value !== 'string') {
    throw promptWizardProviderInputError('V6 锁定 Hook 缺失');
  }
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (
    !normalized
    || normalized !== value
    || value.length > 300
    || /\p{C}/u.test(value)
    || !/\p{Script=Han}/u.test(value)
  ) {
    throw promptWizardProviderInputError('V6 锁定 Hook 无效');
  }
  return value;
}

function validatePromptWizardRouteDraftPlanContext(
  context: PromptWizardDraftPlanContext,
): PromptWizardRouteDraftPlanContext {
  if (
    !('routeRole' in context)
    || !['proof-conversion', 'problem-hook', 'lifestyle-seeding'].includes(context.routeRole)
    || !Number.isSafeInteger(context.planIndex)
    || !isPromptWizardPlanIndex(context.planIndex)
  ) {
    throw promptWizardProviderInputError('V6 路线方案上下文无效');
  }
  if (
    context.categoryInference
    && /(?:价格|优惠|折扣|促销|赠品|包邮|材质|成分|认证|医疗|治疗|健康|安全|防水|防尘|耐用|续航|容量|功率|尺寸|重量|百分比|倍|绝对|最佳|第一|竞品|胜过|无毒|抗菌|低敏|敏感肌|保证|永久|零风险|\d)/iu.test(context.categoryInference)
  ) {
    throw promptWizardProviderInputError('V6 普通品类推测包含禁止的高风险事实');
  }
  // 复用已经稳定运行的 V5 子结构校验，同时将 V6 的第三个索引留在外层验证。
  const parsed = promptWizardUseDirectionPlanContextSchema
    .omit({ planIndex: true })
    .parse({
      variant: context.variant,
      useDirection: context.useDirection,
      selectedScene: context.selectedScene,
    });
  return {
    ...parsed,
    planIndex: context.planIndex,
    routeRole: context.routeRole,
    lockedHookZh: validatePromptWizardLockedHookZh(context.lockedHookZh),
    ...(context.categoryInference ? { categoryInference: context.categoryInference } : {}),
  };
}

function promptWizardValidatedV6RepairPreviousDraft(
  value: unknown,
  segmentCount: number,
) {
  const result = promptWizardPlanDraftSchema.safeParse(value);
  if (!result.success || result.data.segments.length !== segmentCount) {
    throw promptWizardProviderInputError('V6 内容修复只能使用镜头数匹配的严格有效 previousDraft');
  }
  return result.data;
}

function validatePromptWizardUseDirectionDraftRepairInput(
  input: PromptWizardUseDirectionDraftRepairContext,
) {
  if (
    input.operation !== undefined
    && input.operation !== 'repair-draft-content'
    && input.operation !== 'refine-plan'
  ) {
    throw promptWizardProviderInputError('方案修复操作无效');
  }
  if (input.operation === 'refine-plan' && input.issues.length !== 1) {
    throw promptWizardProviderInputError('单方案定向微调只能提供一个方案索引');
  }
  if (input.costOwner?.deliveryVersion === 6 && input.costOwner.repairRound > 2) {
    throw promptWizardProviderInputError('V6 口播修复最多使用两轮内容修复成本身份');
  }
  const issues = input.issues;
  if (!issues || issues.length < 1 || issues.length > input.planContexts.length) {
    throw promptWizardProviderInputError('内容修复待修复方案数量无效');
  }
  const seen = new Set<number>();
  for (const issue of issues) {
    const hasValidDiversityReference = issue.referencePlanIndex === undefined || (
      issue.errorCode === 'PROMPT_WIZARD_DIVERSITY_FAILED'
      && isPromptWizardPlanIndex(issue.referencePlanIndex)
      && issue.referencePlanIndex !== issue.planIndex
      && Boolean(input.previousDrafts[issue.referencePlanIndex])
    );
    if (
      !isPromptWizardPlanIndex(issue.planIndex)
      || seen.has(issue.planIndex)
      || !input.previousDrafts[issue.planIndex]
      || !hasValidDiversityReference
      || !/^[A-Z][A-Z0-9_:-]{0,95}$/u.test(issue.errorCode)
      || issue.fieldPaths.length < 1
      || issue.fieldPaths.length > 24
      || issue.fieldPaths.some(path => (
        !path || path.length > 200 || !isPromptWizardProviderRepairFieldPath(path)
      ))
      || !issue.action.trim()
      || issue.action.length > 1_000
    ) {
      throw promptWizardProviderInputError('单方案内容修复上下文无效');
    }
    seen.add(issue.planIndex);
  }
  if (isPromptWizardV6DraftContext(input)) {
    const segmentCount = expectedPromptWizardDraftSegmentCount(input);
    const validatedIndexes = new Set<PromptWizardPlanIndex>();
    for (const issue of issues) {
      for (const planIndex of [issue.planIndex, issue.referencePlanIndex]) {
        if (planIndex === undefined || validatedIndexes.has(planIndex)) continue;
        promptWizardValidatedV6RepairPreviousDraft(
          input.previousDrafts[planIndex],
          segmentCount,
        );
        validatedIndexes.add(planIndex);
      }
    }
  }
  return [...issues].sort((left, right) => left.planIndex - right.planIndex);
}

function promptWizardUseDirectionEvidence(
  input: PromptWizardUseDirectionDraftGenerationContext,
  planIndex: PromptWizardPlanIndex,
) {
  const context = promptWizardDraftContextForPlanIndex(input, planIndex);
  const reliable = new Set(input.evidenceGraph.reliableEvidenceIds);
  return context.useDirection.evidenceIds.map((evidenceId) => {
    const evidence = input.evidenceGraph.evidences.find(item => item.id === evidenceId);
    if (
      !evidence
      || !reliable.has(evidenceId)
      || (evidence.status !== 'visible' && evidence.status !== 'user-confirmed')
    ) {
      throw promptWizardProviderInputError(`方案 ${planIndex + 1} 引用了不可靠的产品证据`);
    }
    return evidence;
  });
}

export function buildPromptWizardUseDirectionDraftInput(
  input: PromptWizardUseDirectionDraftGenerationContext,
  planIndex: PromptWizardPlanIndex,
  segmentCount = expectedPromptWizardDraftSegmentCount(input),
  options: { fullDraftOutput?: boolean } = {},
) {
  const context = promptWizardDraftContextForPlanIndex(input, planIndex);
  const evidence = promptWizardUseDirectionEvidence(input, planIndex);
  const isV6 = isPromptWizardV6DraftContext(input);
  const soundDesignOnly = isPromptWizardV6SoundDesignOnly(input);
  const targetLanguage = soundDesignOnly
    ? undefined
    : promptWizardRequiredTargetLanguage(input);
  const requiredShotRoles = promptWizardDraftShotRoles(input);
  const executionBudget = isV6
    ? getPromptWizardV6ExecutionBudget(input.config)
    : getPromptWizardExecutionBudget(input.config);
  // 历史 V5 worker 仍需按原契约清空队列；单动作输入收口只作用于新 V6。
  const usesSingleProductAction = isV6 && executionBudget.maxMajorActionCount <= 1;
  const lockedProductActions = usesSingleProductAction
    ? [{
        id: 'single-product-action',
        action: promptWizardSingleFamilyAction(context.useDirection.proofAction),
      }]
    : [
        {
          id: 'selected-scene-main-action',
          action: context.selectedScene.mainAction,
        },
        {
          id: 'use-direction-proof-action',
          action: context.useDirection.proofAction,
        },
      ];
  const majorActionPlan = {
    maxDistinctActionFamilies: executionBudget.maxMajorActionCount,
    lockedProductActions,
    shotRules: requiredShotRoles.map((role, segmentIndex) => {
      if (role === 'hook') {
        return {
          segmentIndex,
          role,
          allowedActionIds: usesSingleProductAction
            ? ['single-product-action']
            : ['selected-scene-main-action'],
          instruction: usesSingleProductAction
            ? '只执行唯一锁定产品动作的关键过程；所选场景只决定人物与环境，不得另执行场景铺垫动作。'
            : '只执行所选场景主动作的关键过程；不得增加第二个产品动作。',
        };
      }
      if (role === 'proof') {
        return {
          segmentIndex,
          role,
          allowedActionIds: usesSingleProductAction
            ? ['single-product-action']
            : ['use-direction-proof-action'],
          instruction: '只执行已锁定的产品自证动作，并让对应证据清楚可见；不得增加其他产品动作。',
        };
      }
      if (role === 'proof-resolution') {
        return {
          segmentIndex,
          role,
          allowedActionIds: usesSingleProductAction
            ? ['single-product-action']
            : [
                'selected-scene-main-action',
                'use-direction-proof-action',
              ],
          instruction: usesSingleProductAction
            ? '只延续唯一锁定产品动作完成证据展示和结果呈现；不得增加第二种产品动作。'
            : '只复用主动作与自证动作完成证据展示和结果呈现；不得增加第三种产品动作。',
        };
      }
      if (role === 'resolution') {
        return {
          segmentIndex,
          role,
          allowedActionIds: [],
          instruction: '不得新增产品功能动作；必须继续用人物、手部、镜头、剪辑或环境运动呈现前段动作的可见结果。',
        };
      }
      return {
        segmentIndex,
        role,
        allowedActionIds: [],
        instruction: '不得新增产品功能动作；必须通过人物、手部、镜头或动作点剪辑保持动态，并用直接购买 CTA 回扣观众需求。',
      };
    }),
  };
  const timeline = promptWizardDraftTimeline(input);
  const allocatedVoiceoverBudgets = soundDesignOnly
    ? []
    : isV6
      ? []
      : getPromptWizardSegmentVoiceoverBudgets({
          targetLanguage: targetLanguage!,
          durationSeconds: input.config.durationSeconds,
          segmentDurations: timeline.map(
            ([startSeconds, endSeconds]) => endSeconds - startSeconds,
          ),
        });
  const voiceoverTiming = soundDesignOnly || !isV6 ? undefined : timeline.map(
    ([startSeconds, endSeconds], segmentIndex) => ({
      segmentIndex,
      startSeconds,
      endSeconds,
      durationSeconds: endSeconds - startSeconds,
    }),
  );
  const voiceoverBudget = soundDesignOnly || isV6 ? undefined : timeline.map(
    ([startSeconds, endSeconds], segmentIndex) => {
      const durationSeconds = getPromptWizardVoiceoverWindowDuration({
        segmentIndex,
        startSeconds,
        endSeconds,
        totalDurationSeconds: input.config.durationSeconds,
      });
      const result = allocatedVoiceoverBudgets[segmentIndex]!;
      return {
        segmentIndex,
        startSeconds,
        endSeconds,
        durationSeconds,
        unit: result.unit,
        minUnits: result.minUnits,
        targetUnits: result.targetUnits,
        maxUnits: result.maxUnits,
      };
    },
  );
  const totalVoiceoverBudget = soundDesignOnly
    ? undefined
    : isV6
      ? undefined
      : getPromptWizardTotalVoiceoverBudget({
        targetLanguage: targetLanguage!,
        durationSeconds: input.config.durationSeconds,
        });
  const fullDraftSlotContract = promptWizardFullDraftSlotContract(
    input,
    segmentCount,
  );
  const compactWireV2 = usesPromptWizardCompactDraftWireV2(input, segmentCount)
    && !options.fullDraftOutput;
  const fullDraftWordSlotContract = fullDraftSlotContract?.format
    === 'full-plan-indexed-word-slots-v1'
    ? fullDraftSlotContract
    : undefined;
  const fullDraftCharacterArrayContract = fullDraftSlotContract?.format
    === 'full-plan-indexed-character-arrays-v3'
    ? fullDraftSlotContract
    : undefined;
  const fullDraftCharacterStringContract = fullDraftSlotContract?.format
    === 'full-plan-indexed-character-strings-v2'
    ? fullDraftSlotContract
    : undefined;
  const allowedCommercialClaims = soundDesignOnly ? [] : [...new Set([
    ...splitPromptWizardAllowedCommercialClaims(input.profile.userConfirmedClaims),
    ...evidence.filter(item => item.status === 'user-confirmed').map(item => item.text),
  ].map(item => item.trim()).filter(Boolean))];
  const narrativeStructureRule = soundDesignOnly
    ? 'V6 纯视觉结构固定为两段：Hook 用产品相关物理事件快速出现商品；proof-resolution 延续同一个商品动作，让证据与商品保持清晰可见，并用持续运镜完成视觉收口。不得生成口播或 CTA 文字。'
    : isV6
    ? requiredShotRoles.length === 3
      ? 'V6 成交结构固定为三段：Hook 说明观众为什么需要；proof-resolution 只用锁定自证动作和可见证据证明唯一购买理由并呈现结果；CTA 不新增产品动作，直接说明为什么现在点击商品卡。'
      : 'V6 成交结构固定为四段：Hook 说明观众为什么需要；proof 只用锁定自证动作展示可见证据；resolution 不新增产品动作，只呈现该证据如何支持唯一购买理由；CTA 直接说明为什么现在点击商品卡。'
    : '成交结构固定：开场说明为什么需要，自证段说明产品如何证明，场景段说明使用价值，末段明确说明为什么现在点击商品卡';
  const v6TimelineRule = isV6
    ? `V6 权威时间轴与职责依次为 ${timeline.map(
        ([startSeconds, endSeconds], segmentIndex) => (
          `${segmentIndex}:${startSeconds}-${endSeconds}s(${requiredShotRoles[segmentIndex]})`
        ),
      ).join('、')}；不得增加虚构镜头${soundDesignOnly
        ? '，不得生成口播窗口。'
        : '或口播窗口；每个 vN 必须在 voiceoverTiming 同索引的起止时间内以快速但清晰的自然口播讲完。'}`
    : null;
  return JSON.stringify({
    task: '围绕系统确定的商品商业路线和场景，生成一套可直接执行的短视频结构化脚本',
    planIndex,
    ...('routeRole' in context ? {
      routeRole: context.routeRole,
      allowedCategoryInference: context.categoryInference ?? '',
    } : {}),
    variant: context.variant,
    variantPolicy: context.variant === 'reliable'
      ? {
        label: '清晰演示成交',
        rule: '动作简单但全程持续运动；用动作点剪辑、近景与全景切换完成直接自证，优先保证 Seedance 成功率',
        firstSecond: '从所选主动作的关键过程进入，第一秒明确产品或品类并持续推进到证据落点',
        perspective: '使用稳定跟随、缓慢推近、横移或动作点景别切换；证据清楚但画面不能静止',
        pacing: '每段都有动作、镜头或剪辑运动；节奏清楚连贯，不使用静态核对或长时间停留',
        ...(soundDesignOnly
          ? { closing: '末段延续唯一商品动作，商品保持清晰可见，并用持续运镜完成视觉落点' }
          : { cta: '末段继续保持人物、手部、镜头或剪辑运动，并明确引导点击商品卡、查看商品或立即下单' }),
      }
      : {
        label: '强钩子成交',
        rule: '第一秒物理事件和停留感更强，全程持续有动作，但不得增加产品能力、人物、地点或未经确认事实',
        firstSecond: '从产品局部、状态变化或动作落点切入，并在第一镜内执行所选主动作的关键过程',
        perspective: '使用微距、极近景、主观视角或低机位揭晓；不使用固定俯拍或平视完整记录',
        pacing: '快速切入或突然揭晓，证据出现后改用持续推近、横移或跟随保持清楚；不得定格或静止',
        ...(soundDesignOnly
          ? { closing: '用与开场不同的景别延续唯一商品动作，并以持续运镜落到清晰商品主体' }
          : { cta: '用直接购买动作回扣开场问题，明确引导点击商品卡、查看商品或立即下单' }),
      },
    product: soundDesignOnly
      ? {
          ...buildPromptWizardGenerationProduct(input.profile),
          userConfirmedClaims: '',
        }
      : buildPromptWizardGenerationProduct(input.profile),
    selectedUseDirection: {
      id: context.useDirection.id,
      title: context.useDirection.title,
      useMoment: context.useDirection.useMoment,
      audienceNeed: context.useDirection.audienceNeed,
      purchaseReason: context.useDirection.purchaseReason,
      proofAction: context.useDirection.proofAction,
      evidenceIds: context.useDirection.evidenceIds,
      appearanceMode: context.useDirection.appearanceMode,
      requiredAssets: context.useDirection.requiredAssets,
    },
    selectedScene: context.selectedScene,
    assignedEvidence: evidence.map(item => ({
      id: item.id,
      text: item.text,
      status: item.status,
      visibleRegion: item.visibleRegion,
      proofActions: item.proofActions,
    })),
    claimPolicy: soundDesignOnly
      ? {
          rules: [
            '购买理由已经锁定为 selectedUseDirection.purchaseReason，不得增加第二个购买理由',
            '只能使用 assignedEvidence 以及非空时逐字同义表达 allowedCategoryInference；不得生成价格、优惠、折扣、促销、功效、认证、评价、稀缺性或竞品结论',
            '不得把待确认信息、文件名或 allowedCategoryInference 之外的常识推断写进方案',
          ],
        }
      : {
          allowedCommercialClaims,
          confirmedOffer: input.confirmedOffer?.trim() || '',
          rules: [
            '购买理由已经锁定为 selectedUseDirection.purchaseReason，不得增加第二个购买理由',
            '只能使用 assignedEvidence、allowedCommercialClaims，以及非空时逐字同义表达 allowedCategoryInference；不得编造价格、功效、认证、评价、稀缺性或竞品结论',
            '不得把待确认信息、文件名或 allowedCategoryInference 之外的常识推断写进方案',
            'confirmedOffer 非空时只允许保持原意使用一次，优先放在末段口播；不得添加限时、仅剩、全网最低等未确认稀缺内容',
          ],
        },
    ...(soundDesignOnly ? {
      audioPolicy: {
        audioMode: 'sound-design-only',
        requiredEmptyFields: compactWireV2
          ? []
          : ['segments[].voiceover', 'segments[].voiceoverZh'],
        allowedAudio: ['音乐', '环境声', '真实商品操作拟音'],
        rules: [
          compactWireV2
            ? '紧凑 Wire V2 不得返回 voiceoverSlots 或任何口播字段'
            : '每个 segment 的 voiceover 与 voiceoverZh 必须严格返回空字符串',
          '无对白、无人声、无旁白；只设计音乐、环境声和真实商品操作拟音',
          '不得生成画面文字、花字、字幕、价格文字、按钮、商品卡、购物车或任何平台 UI',
        ],
      },
      metadataLanguagePolicy: {
        simplifiedChineseFields: compactWireV2
          ? [
              'hook', 'shots[].shotSize', 'shots[].action',
              'shots[].cameraMovement', 'shots[].lightingAndRealism',
              'shots[].foley', 'shots[].editingCue',
            ]
          : [
                'name', 'hook', 'narrative', 'cameraAndPacing',
                'primaryScene', 'differenceTags[]', 'planningReview.*',
                'segments[].role',
                'segments[].location', 'segments[].subject', 'segments[].shotSize',
                'segments[].action', 'segments[].cameraMovement',
                'segments[].lightingAndRealism', 'segments[].foley',
                'segments[].editingCue', 'segments[].productionNote',
                'productionWarnings[]',
            ],
        rules: [
          compactWireV2
            ? '所有紧凑 Wire V2 说明字段必须使用简体中文，且不得返回任何口播字段'
            : '除固定为空字符串的 voiceover 与 voiceoverZh 外，所有方案元数据必须使用简体中文',
          '本模式没有口播语种、口播翻译、口播时长或优惠内容输入；不得根据其他字段补写这些内容',
        ],
      },
    } : {
      languagePolicy: {
        targetLanguage,
        targetLanguageFields: fullDraftWordSlotContract
          ? ['voiceoverSlots.segmentN.voiceoverWords[]']
          : fullDraftCharacterArrayContract
            ? ['voiceoverSlots.segmentN[]']
            : fullDraftCharacterStringContract
              ? ['voiceoverSlots.segmentN.voiceoverText']
            : ['segments[].voiceover'],
        simplifiedChineseTranslationFields: fullDraftWordSlotContract
          ? ['voiceoverSlots.segmentN.voiceoverZh']
          : fullDraftCharacterArrayContract
            ? []
            : fullDraftCharacterStringContract
              ? ['voiceoverSlots.segmentN.voiceoverZh']
            : ['segments[].voiceoverZh'],
        simplifiedChineseFields: compactWireV2
          ? [
              'hook', 'shots[].shotSize', 'shots[].action',
              'shots[].cameraMovement', 'shots[].lightingAndRealism',
              'shots[].foley', 'shots[].editingCue',
            ]
          : [
                'name', 'hook', 'narrative', 'cameraAndPacing',
                'primaryScene', 'differenceTags[]', 'planningReview.*',
                'segments[].location', 'segments[].subject', 'segments[].shotSize',
                'segments[].action', 'segments[].cameraMovement',
                'segments[].lightingAndRealism', 'segments[].foley',
                'segments[].editingCue', 'segments[].productionNote',
                'productionWarnings[]',
            ],
        rules: [
          fullDraftWordSlotContract
            ? `只有 voiceoverSlots.segmentN.voiceoverWords 使用目标语言；${compactWireV2 ? '不得返回其他口播来源' : 'segments[].voiceover 与 segments[].voiceoverZh 必须严格为空字符串'}，其他说明全部使用简体中文`
            : fullDraftCharacterArrayContract
              ? '普通话只允许写在 voiceoverSlots.segmentN 的单字符数组元素中；不得返回对象包装、译文字段或其他口播来源，其他说明全部使用简体中文'
              : fullDraftCharacterStringContract
                ? '只有 voiceoverSlots.segmentN.voiceoverText 使用目标语言；按契约同时返回 voiceoverZh，其他说明全部使用简体中文'
              : '只有 voiceover 使用目标语言；其他说明全部使用简体中文',
          fullDraftWordSlotContract
            ? '每个 segmentN 的 voiceoverWords 必须严格填满 outputContract.exactWordCount 个单词槽位；口播可跨过画面剪辑点连续，服务端仅在全部槽位通过后一次性写回对应镜头'
            : fullDraftCharacterArrayContract
              ? '每个 segmentN 数组必须严格包含 exactCharacterCount 个元素，每项恰好一个可朗读字符；服务端仅在全部数组通过后一次性拼接并写回对应镜头'
              : fullDraftCharacterStringContract
                ? '每个 segmentN 的 voiceoverText 必须严格等于 outputContract.exactCharacterCount 个字符；服务端仅在全部字符串与译文通过硬门禁后一次性写回对应镜头'
              : isV6
                ? '每个 vN 都必须是一条完整自然句，并由模型根据 voiceoverTiming 对应镜头的起止时间自行控制句子长度'
                : '每个 segment 的 voiceover 都必须非空，并按 voiceoverBudget.targetUnits 分配信息；口播可跨过画面剪辑点连续，最终以 totalVoiceoverBudget 的全片容量为硬门禁',
          '前三秒口播必须明确说出产品名称或品类；自证段说明可见特征如何支持唯一购买理由；场景段说明为什么适合当前使用时刻；末段必须是直接购买 CTA',
          fullDraftWordSlotContract
            ? '每个 voiceoverSlots.segmentN.voiceoverZh 必须提供对应口播的忠实简体中文翻译，并用于核对产品、购买理由、CTA 和商业事实'
            : fullDraftCharacterArrayContract
              ? '普通话字符数组不得包含 voiceoverZh；服务端会确定性写入空字符串'
              : fullDraftCharacterStringContract
                ? '每个字符字符串槽必须同时提供忠实的简体中文 voiceoverZh，并用于核对产品、购买理由、CTA 和商业事实'
            : '目标语言不是普通话时：每段 voiceoverZh 必须提供忠实简体中文翻译，并用于核对产品、购买理由、CTA 和商业事实',
          '目标语言是普通话时 voiceoverZh 必须始终为空',
          '不生成画面文字、花字、字幕、贴纸或水印文案',
        ],
      },
    }),
    fixedVideoConfig: input.config,
    executionBudget,
    majorActionPlan,
    ...(!soundDesignOnly && isV6 ? { voiceoverTiming } : {}),
    ...(!soundDesignOnly && !isV6 ? {
      voiceoverBudget,
      ...(totalVoiceoverBudget ? { totalVoiceoverBudget } : {}),
    } : {}),
    ...(fullDraftSlotContract ? { outputContract: fullDraftSlotContract } : {}),
    ...(compactWireV2 ? {
      outputWire: {
        format: 'prompt-wizard-draft-wire-v2',
        requiredTopLevelFields: [
          'hook', 'shots',
          ...(fullDraftSlotContract ? ['voiceoverSlots'] : []),
        ],
        forbiddenTopLevelFields: [
          'name', 'narrative', 'cameraAndPacing', 'primaryScene',
          'differenceTags', 'planningReview', 'segments', 'productionWarnings',
        ],
        requiredShotFields: [
          'shotSize', 'action', 'cameraMovement', 'lightingAndRealism',
          'foley', 'editingCue',
        ],
        forbiddenShotFields: ['role', 'location', 'subject', 'voiceover', 'voiceoverZh', 'evidenceRefs', 'productionNote'],
        rule: '只返回 Schema 要求的 Hook、六字段镜头和可选口播槽；名称、叙事摘要、镜头节奏、生产备注、场景、角色、地点、主体、证据引用、受众复盘、差异标签和生产警告均由服务端根据锁定路线确定性补齐。',
      },
    } : {}),
    imageReferences: Array.from({ length: input.imageCount }, (_, index) => `@图片${index + 1}`),
    variationKey: input.variationKey,
    requiredSegmentCount: segmentCount,
    requiredShotRoles,
    scriptRules: [
      usesSingleProductAction
        ? `${compactWireV2 ? 'shots[0].action' : '第一镜头 subject 与 action'} 必须执行 majorActionPlan.lockedProductActions[0] 的唯一产品动作，并严格按 variantPolicy 从动作起点或动作落点组织。selectedScene.mainAction 只决定场景意图，不得另执行第二种产品动作`
        : '第一镜头 subject 必须明确写出当前产品或 @图片N；action 必须执行 selectedScene.mainAction 的关键产品动作，并严格按 variantPolicy 从动作起点或动作落点组织，不得只写人物情绪、氛围或抽象运镜',
      '整个视频只服务 selectedUseDirection.purchaseReason，并通过 proofAction 和 assignedEvidence 形成因果闭环',
      usesSingleProductAction
        ? '地点固定为 selectedScene.environment；唯一核心动作以 majorActionPlan.lockedProductActions[0] 为准，selectedScene.mainAction 只提供场景意图，不得自行更换场景或增加动作'
        : '地点固定为 selectedScene.environment，核心动作必须包含 selectedScene.mainAction，不得自行更换场景',
      '人物出镜方式固定为 appearanceMode，requiredAssets 之外不得新增人物、包装或道具',
      `majorActionPlan 是整个视频唯一允许的产品动作计划；所有 ${compactWireV2 ? 'shots' : 'segments'} 必须按对应 shotRules 复用 lockedProductActions，且全片可检测的主要动作族不得超过 maxDistinctActionFamilies`,
      soundDesignOnly
        ? '镜头职责用于组织纯视觉叙事：proof-resolution 必须延续 hook 的同一个产品动作，不得新增、改写或派生第二种产品动作'
        : '镜头职责用于组织叙事，不代表每个镜头都要新增一种产品动作；可以重复使用已确认主动作和自证动作；resolution 与 CTA 不得新增产品功能动作，但必须继续有人物、手部、镜头、剪辑或环境运动',
      '每个镜头至少包含产品动作、人物/手部运动、摄像机运动、动作点剪辑或合法环境运动中的一类；5 秒全片至少两类，10/15 秒全片至少三类',
      ...(executionBudget.maxCameraMoveCount === 1
        ? [`全片所有 ${compactWireV2 ? 'shots' : 'segments'}[].cameraMovement 必须只使用同一种可识别运镜，统一写为“持续缓慢推近”；不得再出现横移、跟随、拉远、摇镜、环绕、升降或焦点切换。其他动态感必须由产品动作、手部运动和动作点剪辑提供`]
        : [`全片可检测的运镜种类不得超过 executionBudget.maxCameraMoveCount=${executionBudget.maxCameraMoveCount}`]),
      soundDesignOnly
        ? `每个 ${compactWireV2 ? 'shots' : 'segments'}[].editingCue 必须明确包含“动作点快切”或“节奏剪辑”；末镜不得做静态尾卡，必须在持续运镜和唯一商品动作中完成收尾`
        : `每个 ${compactWireV2 ? 'shots' : 'segments'}[].editingCue 必须明确包含“动作点快切”或“节奏剪辑”；CTA 镜头直接写“在手部或镜头运动中动作点快切收尾”。editingCue 不得出现停顿、停留、定格、静止、保持画面或等待口播`,
      '连续镜头不得同时使用相同景别、相同运镜和不变产品状态；不得出现“静止、固定机位、定格、长时间停留、保持不动、连续少切”等指令',
      narrativeStructureRule,
      ...(v6TimelineRule ? [v6TimelineRule] : []),
      ...(soundDesignOnly ? [
        compactWireV2
          ? '严格返回两个 shots：0–1.2s hook、1.2–5s proof-resolution；不得返回 voiceoverSlots 或任何口播字段'
          : '严格返回两个镜头：0–1.2s hook、1.2–5s proof-resolution；两个镜头 voiceover 与 voiceoverZh 都必须为空字符串',
        '最后镜头必须让 @图片N 对应商品清晰可见，延续唯一锁定商品动作，并在 cameraMovement 中明确写出“持续”运镜；不得生成文字、字幕、价格、按钮、商品卡、购物车或平台 UI',
        'foley 只写音乐、环境声或与唯一商品动作一致的真实操作拟音，不得加入对白、人声或旁白',
      ] : fullDraftWordSlotContract ? [
        '完整方案必须按 outputContract 在顶层返回 voiceoverSlots；voiceoverSlots 只能包含 segment0、segment1…固定属性，每个 voiceoverWords 数组长度必须严格等于该段 exactWordCount',
        'voiceoverWords 每个元素只能包含一个不带空白、无需 NFKC 变换且按 words 计数恰好为 1 的目标语言词；标点附在相邻词上，不得用空字符、多词、占位符或字数标签凑槽位',
        `${compactWireV2 ? '不得返回 segments 或其他口播来源' : 'segments[].voiceover 与 segments[].voiceoverZh 必须严格返回空字符串'}；每段中文译文只写在对应 voiceoverSlots.segmentN.voiceoverZh`,
        '返回前按 outputContract 检查每段 exactWordCount；全片词槽合计必须严格等于 voiceoverBudget.targetUnits 的合计，并保持产品首提、自证信息和末段直接购买 CTA',
      ] : fullDraftCharacterArrayContract ? [
        '完整方案必须按 outputContract 在顶层返回 voiceoverSlots；voiceoverSlots 只能包含 segment0、segment1…固定属性，每个 segmentN 直接是单字符字符串数组，数组长度必须严格等于该段 exactCharacterCount',
        '每个数组元素必须恰好包含一个无需 NFKC 变换的可朗读汉字、字母或数字；不得包含标点、空白、控制符、零宽符、emoji、空字符串、多字符字符串、对象包装、占位符或字数标签',
        '不得返回对象包装、译文字段、segments 或任何第二份口播来源；服务端只在全部数组同时通过后原子拼接',
        '返回前按 outputContract 检查每段数组长度；全片元素合计必须严格等于 voiceoverBudget.targetUnits 的合计，并保持产品首提、自证信息和末段直接购买 CTA',
      ] : fullDraftCharacterStringContract ? [
        '完整方案必须按 outputContract 在顶层返回 voiceoverSlots；voiceoverSlots 只能包含 segment0、segment1…固定属性，每个 voiceoverText 的字符数必须严格等于该段 exactCharacterCount',
        'voiceoverText 只能包含无需 NFKC 变换的目标语言字母、组合标记或数字；不得包含标点、空白、控制符、零宽符、emoji、占位符或字数标签',
        '每个 voiceoverSlots.segmentN 必须返回非空且无首尾空白的忠实简体中文 voiceoverZh；不得形成其他口播来源',
        '返回前按 outputContract 检查每段 exactCharacterCount；全片字符合计必须严格等于 voiceoverBudget.targetUnits 的合计，并保持产品首提、自证信息和末段直接购买 CTA',
      ] : isV6 ? [
        '每个镜头返回一条完整、自然、非空的口播句；根据 voiceoverTiming 的本镜起止时间，以快速但清晰的自然口播自行判断能否讲完',
        '若预计无法在本镜讲完，必须整句重写得更简洁；不得机械截断、堆叠关键词、跨镜借时或返回字数统计',
      ] : [
        '返回前必须按 totalVoiceoverBudget.unit 统计全部 segments[].voiceover 的合计数量；总量不得低于 totalVoiceoverBudget.minUnits、不得超过 totalVoiceoverBudget.maxUnits，并优先接近 totalVoiceoverBudget.targetUnits。voiceoverBudget 用于分配各段信息而不强制口播在画面剪辑点断句；全片合计超限仍视为失败',
      ]),
      ...(!isV6 && input.config.durationSeconds === 10
        ? ['10 秒脚本前三个内容段的口播可跨过相邻画面剪辑点，并分别在 4 秒口播窗口内说完；以 voiceoverBudget[0..2].durationSeconds=4 为准，末段 CTA 仍为 2 秒，画面时间轴不改变']
        : []),
      ...(!soundDesignOnly && input.config.durationSeconds === 5 && targetLanguage === '英语'
        ? ['5 秒英语末段 voiceover 必须使用不超过 3 个词的直接购买 CTA，优先直接写“Tap to shop”；对应 voiceoverZh 写“点击商品卡下单”。不得扩写成 4 个或更多英语词']
        : []),
      '不得根据产品常识、外观或场景自行推断新的操作方式、功能动作、使用结果或其他产品事实',
      ...('routeRole' in context
        ? [`当前商业角色固定为 ${context.routeRole}；不得改成其他角色。三条路线将分别使用不同开场、场景、自证动作、镜头语法、节奏与${soundDesignOnly ? '视觉收口' : ' CTA'}，本方案必须严格服务当前路线。`]
        : ['reliable 与 hook 方案共享购买理由、场景与证据，但必须分别遵守 variantPolicy 的互斥视角、节奏和 CTA 契约，第一秒事件、镜头视角、节奏剪辑和 CTA 回扣至少三项形成可观察差异']),
      '严格遵守镜头数量、职责、视频时长和执行预算',
      '返回单个原生 JSON 对象，不得返回 Markdown、代码围栏或解释',
    ],
    productionWarningPolicy: compactWireV2
      ? [
          'productionWarnings 与 productionNote 均由服务端根据锁定路线和产品档案确定性生成；响应不得返回这些字段。',
        ]
      : [
          'productionWarnings 必须返回空数组；素材与生成提醒由服务端根据产品档案确定性生成，不允许模型在此字段补充卖点、功效、材质结论或商业描述',
        ],
  });
}

function buildPromptWizardUseDirectionDraftRepairInput(
  input: PromptWizardUseDirectionDraftRepairContext,
  issue: PromptWizardDraftContentRepairIssue,
  segmentCount = expectedPromptWizardDraftSegmentCount(input),
) {
  const base = JSON.parse(buildPromptWizardUseDirectionDraftInput(
    input,
    issue.planIndex,
    segmentCount,
    { fullDraftOutput: true },
  )) as Record<string, unknown>;
  const diversityReferenceDraft = (
    issue.errorCode === 'PROMPT_WIZARD_DIVERSITY_FAILED'
    && issue.referencePlanIndex !== undefined
  )
    ? sanitizePromptWizardPreviousDrafts([
      input.previousDrafts[issue.referencePlanIndex],
    ])[0]
    : undefined;
  const hasVoiceoverCompression = issue.action.includes('必须压缩到')
    && issue.fieldPaths.some(fieldPath => (
      /^segments\[\d{1,2}\]\.voiceover(?:Zh)?$/u.test(fieldPath)
    ));
  const fullDraftSlotFormat = isPlainPromptWizardRecord(base.outputContract)
    && (
      base.outputContract.format === 'full-plan-indexed-word-slots-v1'
      || base.outputContract.format === 'full-plan-indexed-character-arrays-v3'
      || base.outputContract.format === 'full-plan-indexed-character-strings-v2'
    )
    ? base.outputContract.format
    : undefined;
  if (
    hasVoiceoverCompression
    && Array.isArray(base.voiceoverBudget)
  ) {
    const compactBudgets = (base.voiceoverBudget as Array<Record<string, unknown>>).map(
      budget => {
        const minimum = typeof budget.minUnits === 'number' ? budget.minUnits : 1;
        const target = typeof budget.targetUnits === 'number' ? budget.targetUnits : minimum;
        const maximum = typeof budget.maxUnits === 'number' ? budget.maxUnits : target;
        // 分段最低值由权威全片预算分配器产生，合计正好覆盖全片最低成交
        // 信息量。不能再对它乘折扣：此前 10 秒脚本会把合法的全片最低
        // 值进一步压低，同时又要求保留产品首提、购买理由、证据和 CTA，
        // 形成模型无法同时满足的矛盾指令。压缩修复锁定权威 targetUnits，
        // 它天然位于 min/max 之间，也比最低值更容易完整保留成交语义。
        const compactTarget = Math.max(minimum, Math.min(target, maximum));
        return {
          ...budget,
          minUnits: compactTarget,
          targetUnits: compactTarget,
          maxUnits: compactTarget,
        };
      },
    );
    const compactTotal = compactBudgets.reduce((sum, budget) => (
      sum + (typeof budget.targetUnits === 'number' ? budget.targetUnits : 0)
    ), 0);
    base.voiceoverBudget = compactBudgets;
    if (base.totalVoiceoverBudget && typeof base.totalVoiceoverBudget === 'object') {
      base.totalVoiceoverBudget = {
        ...(base.totalVoiceoverBudget as Record<string, unknown>),
        minUnits: compactTotal,
        targetUnits: compactTotal,
        maxUnits: compactTotal,
      };
    }
    base.voiceoverRepairMode = {
      mode: 'compress',
      rule: '本次修复只使用压缩后的唯一预算；逐段口播不得超过 voiceoverBudget.maxUnits，全片不得超过 totalVoiceoverBudget.maxUnits',
    };
  }
  return JSON.stringify({
    ...base,
    task: input.operation === 'refine-plan'
      ? '按用户选择定向微调当前单方案，并返回完整结构化脚本'
      : '只修复当前单方案中明确列出的内容问题，并返回完整结构化脚本',
    previousDraft: sanitizePromptWizardPreviousDrafts([
      input.previousDrafts[issue.planIndex],
    ])[0],
    ...(diversityReferenceDraft ? { diversityReferenceDraft } : {}),
    repairIssue: {
      planIndex: issue.planIndex,
      errorCode: issue.errorCode,
      fieldPaths: [...issue.fieldPaths],
      action: issue.action,
    },
    repairPolicy: [
      '只修改 repairIssue.fieldPaths 指向的不合格内容；其他字段保持 previousDraft 的内容和含义不变',
      '不得改变使用方向、所选场景、唯一购买理由、证据 ID、方案 variant、目标语言、视频配置和图片引用',
      '若 repairIssue 指向首镜头，segments[0].subject 明确写产品或 @图片N，segments[0].action 必须完整保留 selectedScene.mainAction 的关键产品动作，但应按 variantPolicy 从动作起点或动作落点组织，不得删除主动作',
      '修复后的每个镜头仍必须遵守 majorActionPlan.shotRules，只能复用 lockedProductActions；resolution 与 CTA 不得新增产品动作，全片不得超过 maxDistinctActionFamilies',
      '不得为了修复动作、差异或结构问题而推断新的产品操作、功能、结果、用途或其他未提供事实',
      '不得引入 Concept、七轴策略、其他候选方向或第二个购买理由',
      ...(hasVoiceoverCompression ? [
        '本次包含口播超限修复：即使还要修改动作、运镜或其他字段，所有 voiceover 也必须逐段严格等于 voiceoverBudget.targetUnits，全片严格等于 totalVoiceoverBudget.targetUnits；不得沿用 previousDraft 的超长口播',
        '前三秒口播必须明确说出产品名称或品类；末段必须保留直接购买 CTA；非普通话同步返回忠实简体中文 voiceoverZh',
      ] : []),
      ...(diversityReferenceDraft ? [
        'diversityReferenceDraft 是另一份已合格方案的只读对照，不得复制或修改；当前方案必须在第一秒物理事件、首镜头观看视角、节奏与剪辑类别、结尾 CTA 动作与口播回扣这四项中至少三项与其形成可观察差异，不能只替换同义词',
      ] : []),
      ...(fullDraftSlotFormat ? [
        '本次仍返回完整方案，但口播只能按 outputContract 写入顶层 voiceoverSlots；segments[].voiceover 与 segments[].voiceoverZh 必须严格为空字符串，不得复制 previousDraft 的口播到这两个字段',
        fullDraftSlotFormat === 'full-plan-indexed-word-slots-v1'
          ? '未被 repairIssue 指向的口播语义应通过 voiceoverSlots 保持不变；每段 voiceoverWords 仍须严格填满对应 exactWordCount，中文译文只写在对应 voiceoverSlots.segmentN.voiceoverZh'
          : fullDraftSlotFormat === 'full-plan-indexed-character-arrays-v3'
            ? '未被 repairIssue 指向的普通话口播语义应通过 voiceoverSlots 保持不变；每个 segmentN 仍须直接返回 exactCharacterCount 个单字符数组元素，不得返回对象包装或 voiceoverZh'
          : '未被 repairIssue 指向的目标语言口播与中文译文应通过 voiceoverSlots 保持不变；每段 voiceoverText 仍须严格达到对应 exactCharacterCount，voiceoverZh 必须非空且忠实翻译',
      ] : []),
      '仍需返回完整单方案 JSON 对象，不得只返回修改字段',
    ],
  });
}

function isPromptWizardVoiceoverOnlyRepairIssue(
  issue: PromptWizardDraftContentRepairIssue | undefined,
) {
  return Boolean(
    issue
    && issue.fieldPaths.length > 0
    && issue.fieldPaths.every(fieldPath => (
      /^segments\[\d{1,2}\]\.voiceover(?:Zh)?$/u.test(fieldPath)
    ))
    && (
      issue.errorCode === 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID'
      || issue.errorCode === 'PROMPT_WIZARD_VOICEOVER_TOO_LONG'
      || issue.action.includes('必须压缩到')
    ),
  );
}

function buildPromptWizardUseDirectionVoiceoverRepairInput(
  input: PromptWizardUseDirectionDraftRepairContext,
  issue: PromptWizardDraftContentRepairIssue,
  segmentCount = expectedPromptWizardDraftSegmentCount(input),
) {
  const full = JSON.parse(buildPromptWizardUseDirectionDraftRepairInput(
    input,
    issue,
    segmentCount,
  )) as Record<string, unknown>;
  const previous = input.previousDrafts[issue.planIndex]!;
  const targetLanguage = promptWizardRequiredTargetLanguage(input);
  const isMandarin = targetLanguage === '普通话';
  const isV6 = isPromptWizardV6DraftContext(input);
  const productMentionCandidates = [
    input.profile.productName.trim(),
    input.profile.category.trim(),
  ].filter(Boolean);
  const ctaCandidates = [
    '点击商品卡', '查看商品', '立即下单', '马上下单', '加入购物车', '立即购买',
  ];
  const totalVoiceoverBudget = full.totalVoiceoverBudget as {
    unit?: unknown;
    targetUnits?: unknown;
  } | undefined;
  const voiceoverBudgets = Array.isArray(full.voiceoverBudget)
    ? full.voiceoverBudget as Array<{ segmentIndex?: unknown; targetUnits?: unknown }>
    : [];
  const wordSlotContract = totalVoiceoverBudget?.unit === 'words'
    ? {
        format: 'indexed-word-slots-v1',
        rule: '每个 voiceoverWords 元素只能是一个不含空白的目标语言词，标点必须附在前一个词上；不得把多个词塞入同一元素',
        segments: voiceoverBudgets.map((budget, segmentIndex) => ({
          property: `segment${segmentIndex}`,
          segmentIndex,
          exactWordCount: budget.targetUnits,
          fields: ['voiceoverWords', 'voiceoverZh'],
        })),
      }
    : undefined;
  const characterSlotContract = (
    usesPromptWizardMandarinCharacterArraysV3(input)
    && totalVoiceoverBudget?.unit === 'characters'
  )
    ? {
        format: 'indexed-character-arrays-v3',
        rule: '每个 segmentN 直接返回恰好 exactCharacterCount 个单字符字符串元素；每项只能是无需 NFKC 变换的可朗读汉字、字母或数字，不得返回对象包装、译文字段或第二份口播来源',
        segments: voiceoverBudgets.map((budget, segmentIndex) => ({
          property: `segment${segmentIndex}`,
          segmentIndex,
          exactCharacterCount: budget.targetUnits,
          itemRule: 'single-readable-character',
        })),
      }
    : undefined;
  const indexedSlotContract = wordSlotContract ?? characterSlotContract;
  return JSON.stringify({
    task: characterSlotContract
      ? '只重写并校准当前方案的普通话 voiceover；普通话译文字段由服务端固定为空，不得返回 voiceoverZh'
      : isMandarin
        ? '只重写并校准当前方案的普通话 voiceover，并保持 voiceoverZh 为空字符串'
        : '只重写并校准当前方案的目标语言口播与中文译文',
    planIndex: issue.planIndex,
    targetLanguage,
    product: full.product,
    selectedUseDirection: full.selectedUseDirection,
    selectedScene: full.selectedScene,
    assignedEvidence: full.assignedEvidence,
    claimPolicy: full.claimPolicy,
    languagePolicy: full.languagePolicy,
    ...(isV6
      ? { voiceoverTiming: full.voiceoverTiming }
      : { voiceoverBudget: full.voiceoverBudget }),
    ...(!isV6 && full.totalVoiceoverBudget
      ? { totalVoiceoverBudget: full.totalVoiceoverBudget }
      : {}),
    voiceoverRepairMode: full.voiceoverRepairMode,
    ...(indexedSlotContract ? { outputContract: indexedSlotContract } : {}),
    requiredShotRoles: full.requiredShotRoles,
    semanticRequirements: {
      firstThreeSeconds: {
        targetLanguageRule: '口播必须明确说出当前产品名称或品类的目标语言表达，不得只说 this、it、look 或抽象需求',
        ...(isMandarin
          ? { targetLanguageMustContainOneOf: productMentionCandidates }
          : { chineseTranslationMustContainOneOf: productMentionCandidates }),
      },
      finalSegment: {
        targetLanguageRule: '必须明确引导点击商品卡、查看商品或立即下单',
        ...(isMandarin
          ? { targetLanguageMustContainOneOf: ctaCandidates }
          : { chineseTranslationMustContainOneOf: ctaCandidates }),
      },
    },
    previousVoiceovers: previous.segments.map((segment, segmentIndex) => ({
      segmentIndex,
      role: segment.role,
      voiceover: segment.voiceover,
      voiceoverZh: segment.voiceoverZh,
    })),
    repairIssue: issue,
    rules: [
      isV6
        ? '只返回 outputWire 规定的逐镜完整句 vN/zN；不得返回或改写画面、动作、运镜、证据和其他方案字段'
        : indexedSlotContract
        ? '只按 outputContract 返回 segment0、segment1…固定属性口播补丁；不得返回 segments 或改写画面、动作、运镜、证据和其他方案字段'
        : '只返回 segments 口播补丁；不得返回或改写画面、动作、运镜、证据和其他方案字段',
      isV6
        ? '每个镜头返回一条完整自然句；允许自然标点和词间空格，不得拆槽、机械截断、填充或返回旧 vNPP/voiceoverSlots'
        : wordSlotContract
        ? '每个 segmentN 的 voiceoverWords 必须严格填满 exactWordCount 个单词槽位；服务端将按空格连接为口播，不得返回字数统计或占位符'
        : characterSlotContract
          ? '每个 segmentN 必须直接返回 exactCharacterCount 个单字符字符串元素；服务端将整组校验后原子拼接普通话口播，不得返回对象包装、字数统计或占位符'
          : 'segments 必须按 segmentIndex 从 0 连续排列并覆盖全部镜头',
      isV6
        ? '根据 voiceoverTiming 的本镜起止时间使用快速但清晰的自然口播，并自行复核能在本镜内讲完；若讲不完必须整句重写得更简洁，不得机械截断或跨镜借时'
        : wordSlotContract
        ? '每段单词槽位数已由 JSON Schema 锁定为 voiceoverBudget.targetUnits；不得把其他段的额度挪到当前段'
        : characterSlotContract
          ? '每段数组的 JSON Schema minItems/maxItems 已锁定为 voiceoverBudget.targetUnits，且 items.minLength/maxLength 均为 1；不得把其他段的额度挪到当前段'
          : '每段必须严格等于 voiceoverBudget.targetUnits；不得把其他段的字数额度挪到当前段',
      ...(!isV6 ? ['全片合计必须严格等于 totalVoiceoverBudget.targetUnits'] : []),
      ...(isMandarin ? [
        '前三秒普通话 voiceover 必须逐字包含 semanticRequirements.firstThreeSeconds.targetLanguageMustContainOneOf 中至少一项',
        '末段普通话 voiceover 必须逐字包含 semanticRequirements.finalSegment.targetLanguageMustContainOneOf 中至少一项直接购买 CTA',
      ] : [
        '前三秒目标语言口播必须明确说出产品名称或品类，且中文译文必须逐字包含 semanticRequirements.firstThreeSeconds.chineseTranslationMustContainOneOf 中至少一项',
        '末段目标语言口播必须是直接购买 CTA，且中文译文必须逐字包含 semanticRequirements.finalSegment.chineseTranslationMustContainOneOf 中至少一项',
      ]),
      '保持原购买理由、产品事实和 CTA 含义；不得新增价格、功效、认证、评价、稀缺性或竞品结论',
      characterSlotContract
        ? '普通话字符数组响应不得返回对象包装、译文字段或第二份口播来源；服务端会确定性写入空字符串译文'
        : isMandarin
          ? '普通话的 voiceoverZh 必须为空字符串'
          : '非普通话必须返回忠实的简体中文 voiceoverZh',
      '只输出符合 JSON Schema 的原生 JSON 对象，不输出 Markdown、解释或字数统计',
    ],
  });
}

function createVoiceoverRepairJsonSchema(
  input: PromptWizardUseDirectionDraftRepairContext,
  segmentCount: number,
) {
  if (isPromptWizardV6DraftContext(input)) {
    return createPromptWizardFlatScalarJsonSchema(
      createPromptWizardFlatScalarLayout(input, segmentCount, 'voiceover'),
    );
  }
  const targetLanguage = promptWizardRequiredTargetLanguage(input);
  const totalBudget = getPromptWizardTotalVoiceoverBudget({
    targetLanguage,
    durationSeconds: input.config.durationSeconds,
  });
  if (totalBudget.unit === 'words') {
    const timeline = promptWizardDraftTimeline(input);
    const budgets = getPromptWizardSegmentVoiceoverBudgets({
      targetLanguage,
      durationSeconds: input.config.durationSeconds,
      segmentDurations: timeline.map(([startSeconds, endSeconds]) => (
        endSeconds - startSeconds
      )),
    });
    const required = Array.from({ length: segmentCount }, (_, index) => `segment${index}`);
    return {
      type: 'object',
      additionalProperties: false,
      required,
      properties: Object.fromEntries(required.map((property, index) => {
        const targetUnits = budgets[index]!.targetUnits;
        return [property, {
          type: 'object',
          additionalProperties: false,
          required: ['voiceoverWords', 'voiceoverZh'],
          properties: {
            voiceoverWords: {
              type: 'array',
              minItems: targetUnits,
              maxItems: targetUnits,
              items: { type: 'string', minLength: 1 },
            },
            voiceoverZh: { type: 'string' },
          },
        }];
      })),
    };
  }
  if (
    usesPromptWizardMandarinCharacterArraysV3(input)
    && totalBudget.unit === 'characters'
  ) {
    const timeline = promptWizardDraftTimeline(input);
    const budgets = getPromptWizardSegmentVoiceoverBudgets({
      targetLanguage,
      durationSeconds: input.config.durationSeconds,
      segmentDurations: timeline.map(([startSeconds, endSeconds]) => (
        endSeconds - startSeconds
      )),
    });
    const required = Array.from({ length: segmentCount }, (_, index) => `segment${index}`);
    return {
      type: 'object',
      additionalProperties: false,
      required,
      properties: Object.fromEntries(required.map((property, index) => {
        const targetUnits = budgets[index]!.targetUnits;
        return [property, {
          type: 'array',
          minItems: targetUnits,
          maxItems: targetUnits,
          items: {
            type: 'string',
            minLength: 1,
            maxLength: 1,
          },
        }];
      })),
    };
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['segments'],
    properties: {
      segments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['segmentIndex', 'voiceover', 'voiceoverZh'],
          properties: {
            segmentIndex: { type: 'integer' },
            voiceover: { type: 'string' },
            voiceoverZh: { type: 'string' },
          },
        },
      },
    },
  };
}

const promptWizardVoiceoverRepairWireSchema = z.object({
  segments: z.array(z.object({
    segmentIndex: z.number().int().nonnegative(),
    voiceover: z.string(),
    voiceoverZh: z.string(),
  }).strict()),
}).strict();

const promptWizardVoiceoverWordSlotWireSchema = z.object({
  voiceoverWords: z.array(z.string()),
  voiceoverZh: z.string(),
}).strict();

const promptWizardVoiceoverCharacterArrayWireSchema = z.array(z.string());

function parsePromptWizardVoiceoverCharacterArray(
  value: unknown,
  logicalSegmentIndex: number,
) {
  if (
    isPlainPromptWizardRecord(value)
    && (Object.hasOwn(value, 'voiceoverText') || Object.hasOwn(value, 'voiceoverZh'))
  ) {
    throw markPromptWizardOutputSchemaIssue(new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ['segments', logicalSegmentIndex, 'voiceover'],
      message: '普通话单字符数组不得返回对象包装或第二口播来源',
    }]), 'secondary-source');
  }
  const result = promptWizardVoiceoverCharacterArrayWireSchema.safeParse(value);
  if (result.success) return result.data;
  throw markPromptWizardOutputSchemaIssue(new z.ZodError(result.error.issues.map(issue => ({
    ...issue,
    path: ['segments', logicalSegmentIndex, 'voiceover'],
  }))), 'wire-shape');
}

function isPromptWizardStrictReadableCharacter(character: string) {
  const normalized = character.normalize('NFKC');
  return normalized === character
    && !/[\p{C}\p{Z}]/u.test(character)
    && !/\p{Extended_Pictographic}/u.test(character)
    && /^[\p{L}\p{N}]$/u.test(character)
    && countPromptWizardVoiceoverUnits(character, 'characters') === 1;
}

/**
 * 日语、泰语等字符计量语言允许 Unicode 组合标记；这些标记与 JSON
 * Schema minLength/maxLength 一样按 Unicode 码点计入字符预算。仍拒绝规范化变化、
 * 标点、空白、控制符、格式字符和 Emoji。
 */
function isPromptWizardStrictTranslatedCharacter(character: string) {
  const normalized = character.normalize('NFKC');
  return normalized === character
    && !/[\p{C}\p{Z}]/u.test(character)
    && !/\p{Extended_Pictographic}/u.test(character)
    && /^[\p{L}\p{M}\p{N}]$/u.test(character);
}

function decodePromptWizardVoiceoverRepairPatch(
  value: unknown,
  input: PromptWizardUseDirectionDraftRepairContext,
  issue: PromptWizardDraftContentRepairIssue,
  segmentCount: number,
  options: { sourceLocked?: boolean } = {},
) {
  const draft = structuredClone(input.previousDrafts[issue.planIndex]!);
  const targetLanguage = promptWizardRequiredTargetLanguage(input);
  const totalBudget = getPromptWizardTotalVoiceoverBudget({
    targetLanguage,
    durationSeconds: input.config.durationSeconds,
  });
  if (totalBudget.unit === 'words') {
    const record = isPlainPromptWizardRecord(value) ? value : {};
    const required = Array.from({ length: segmentCount }, (_, index) => `segment${index}`);
    const missingProperty = required.find(property => !Object.hasOwn(record, property));
    if (
      Object.keys(record).length !== required.length
      || missingProperty
    ) {
      const missingSegmentIndex = missingProperty
        ? required.indexOf(missingProperty)
        : -1;
      throw new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: missingSegmentIndex < 0 ? [] : ['segments', missingSegmentIndex, 'voiceover'],
        message: `口播补丁必须严格返回 ${required.join('、')}`,
      }]);
    }
    const timeline = promptWizardDraftTimeline(input);
    const budgets = getPromptWizardSegmentVoiceoverBudgets({
      targetLanguage,
      durationSeconds: input.config.durationSeconds,
      segmentDurations: timeline.map(([startSeconds, endSeconds]) => (
        endSeconds - startSeconds
      )),
    });
    required.forEach((property, segmentIndex) => {
      const slot = promptWizardVoiceoverWordSlotWireSchema.parse(record[property]);
      const words = slot.voiceoverWords.map((word, wordIndex) => {
        const normalized = word.normalize('NFKC').trim();
        if (options.sourceLocked && normalized !== word) {
          throw new z.ZodError([{
            code: z.ZodIssueCode.custom,
            path: [property, 'voiceoverWords', wordIndex],
            message: '来源锁定格式恢复不得规范化或裁剪口播单词',
          }]);
        }
        return normalized;
      });
      const voiceoverZh = slot.voiceoverZh.trim();
      if (options.sourceLocked && voiceoverZh !== slot.voiceoverZh) {
        throw new z.ZodError([{
          code: z.ZodIssueCode.custom,
          path: [property, 'voiceoverZh'],
          message: '来源锁定格式恢复不得裁剪中文译文',
        }]);
      }
      const targetUnits = budgets[segmentIndex]!.targetUnits;
      if (
        words.length !== targetUnits
        || words.some(word => (
          !word
          || /\s/u.test(word)
          || countPromptWizardVoiceoverUnits(word, 'words') !== 1
        ))
      ) {
        throw new z.ZodError([{
          code: z.ZodIssueCode.custom,
          path: [property, 'voiceoverWords'],
          message: `voiceoverWords 必须包含 ${targetUnits} 个不含空白的单词`,
        }]);
      }
      draft.segments[segmentIndex] = {
        ...draft.segments[segmentIndex]!,
        voiceover: words.join(' '),
        voiceoverZh,
      };
    });
    return promptWizardPlanDraftSchema.parse(draft);
  }

  if (
    usesPromptWizardMandarinCharacterArraysV3(input)
    && totalBudget.unit === 'characters'
  ) {
    const required = Array.from({ length: segmentCount }, (_, index) => `segment${index}`);
    if (!isPlainPromptWizardRecord(value)) {
      throw markPromptWizardOutputSchemaIssue(new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: ['segments', 0, 'voiceover'],
        message: '普通话口播补丁顶层必须是固定键 JSON 对象',
      }]), 'wire-shape');
    }
    const record = value;
    if (
      Object.keys(record).length !== required.length
      || required.some(property => !Object.hasOwn(record, property))
    ) {
      const missingSegmentIndex = required.findIndex(property => (
        !Object.hasOwn(record, property)
      ));
      throw markPromptWizardOutputSchemaIssue(new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: missingSegmentIndex >= 0
          ? ['segments', missingSegmentIndex, 'voiceover']
          : ['segments'],
        message: `口播补丁必须严格返回 ${required.join('、')}`,
      }]), 'keyset');
    }
    const timeline = promptWizardDraftTimeline(input);
    const budgets = getPromptWizardSegmentVoiceoverBudgets({
      targetLanguage,
      durationSeconds: input.config.durationSeconds,
      segmentDurations: timeline.map(([startSeconds, endSeconds]) => (
        endSeconds - startSeconds
      )),
    });
    // 先完成全部段的 strict Wire 解析。segmentN 必须直接是字符串数组；
    // 对象包装、voiceoverText、voiceoverZh 或非字符串元素都直接失败。
    const slots = required.map((property, segmentIndex) => (
      parsePromptWizardVoiceoverCharacterArray(
        record[property],
        segmentIndex,
      )
    ));
    const decoded = slots.map((characters, segmentIndex) => {
      const targetUnits = budgets[segmentIndex]!.targetUnits;
      const invalidCharacterIndex = characters.findIndex(character => (
        Array.from(character).length !== 1
        || !isPromptWizardStrictReadableCharacter(character)
      ));
      const error = characters.length !== targetUnits
        ? markPromptWizardOutputSchemaIssue(new z.ZodError([{
            code: z.ZodIssueCode.custom,
            path: ['segments', segmentIndex, 'voiceover'],
            message: `字符数组必须严格包含 ${targetUnits} 个元素`,
          }]), 'count')
        : invalidCharacterIndex >= 0
          ? markPromptWizardOutputSchemaIssue(new z.ZodError([{
              code: z.ZodIssueCode.custom,
              path: ['segments', segmentIndex, 'voiceover'],
              message: '字符数组每项必须恰好包含一个无需规范化的可朗读汉字、字母或数字',
            }]), 'unit')
          : null;
      return { characters, error };
    });
    const firstInvalidSlot = decoded.find(item => item.error);
    if (firstInvalidSlot?.error) throw firstInvalidSlot.error;
    const resolvedCharacters = decoded.map(item => item.characters);
    resolvedCharacters.forEach((characters, segmentIndex) => {
      draft.segments[segmentIndex] = {
        ...draft.segments[segmentIndex]!,
        voiceover: characters.join(''),
        voiceoverZh: '',
      };
    });
    const actualUnits = draft.segments.reduce((sum, segment) => (
      sum + countPromptWizardVoiceoverUnits(segment.voiceover, 'characters')
    ), 0);
    if (actualUnits !== totalBudget.targetUnits) {
      throw markPromptWizardOutputSchemaIssue(new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: ['segments'],
        message: `普通话口播必须严格包含 ${totalBudget.targetUnits} 个可朗读字符`,
      }]), 'count');
    }
    const result = promptWizardPlanDraftSchema.safeParse(draft);
    if (!result.success) {
      throw markPromptWizardOutputSchemaIssue(result.error, 'wire-shape');
    }
    return result.data;
  }

  const patch = promptWizardVoiceoverRepairWireSchema.parse(value);
  const indexes = patch.segments.map(segment => segment.segmentIndex);
  if (
    patch.segments.length !== segmentCount
    || new Set(indexes).size !== segmentCount
    || indexes.some((index, position) => index !== position)
  ) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ['segments'],
      message: `口播补丁必须按顺序返回 ${segmentCount} 个镜头`,
    }]);
  }
  patch.segments.forEach((segment, segmentIndex) => {
    draft.segments[segmentIndex] = {
      ...draft.segments[segmentIndex]!,
      voiceover: segment.voiceover.trim(),
      voiceoverZh: segment.voiceoverZh.trim(),
    };
  });
  const filled = fillPromptWizardVoiceoverRepairTinyShortfall(draft, input, issue);
  return promptWizardPlanDraftSchema.parse(
    compressPromptWizardVoiceoverRepairTinyOverage(filled, input, issue),
  );
}

const PROMPT_WIZARD_WORD_SHORTFALL_PREFIXES: Record<string, readonly [string, string]> = {
  英语: ['Now', 'Right now'],
  西班牙语: ['Ahora', 'Ahora mismo'],
  葡萄牙语: ['Agora', 'Agora mesmo'],
  法语: ['Maintenant', 'Dès maintenant'],
  印尼语: ['Sekarang', 'Sekarang juga'],
  意大利语: ['Ora', 'Proprio ora'],
  马来语: ['Sekarang', 'Sekarang juga'],
  越南语: ['Ngay', 'Bây giờ'],
  德语: ['Jetzt', 'Jetzt sofort'],
  荷兰语: ['Nu', 'Nu meteen'],
  波兰语: ['Teraz', 'Już teraz'],
};

/**
 * 方舟偶尔会在“严格等于”口播预算时少返回 1–2 个字/词。只有在内容修复
 * 已经进入轻量口播补丁、全片仅差极小容量且末段仍有语速余量时，才补入
 * 不携带产品事实的行动语气词。完整领域门禁随后仍会重新验证 CTA、事实、
 * 翻译和逐段时长；更大的缺口绝不在这里静默补齐。
 */
function fillPromptWizardVoiceoverRepairTinyShortfall(
  draft: PromptWizardPlanDraft,
  input: PromptWizardUseDirectionDraftRepairContext,
  issue: PromptWizardDraftContentRepairIssue,
) {
  if (
    issue.errorCode !== 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID'
    && !issue.action.includes('必须扩充到')
  ) return draft;
  const targetLanguage = promptWizardRequiredTargetLanguage(input);
  const totalBudget = getPromptWizardTotalVoiceoverBudget({
    targetLanguage,
    durationSeconds: input.config.durationSeconds,
  });
  const actualUnits = draft.segments.reduce((sum, segment) => (
    sum + countPromptWizardVoiceoverUnits(segment.voiceover, totalBudget.unit)
  ), 0);
  const shortfall = totalBudget.minUnits - actualUnits;
  if (shortfall < 1 || shortfall > 2 || draft.segments.length === 0) return draft;

  const timeline = promptWizardDraftTimeline(input);
  const segmentBudgets = getPromptWizardSegmentVoiceoverBudgets({
    targetLanguage,
    durationSeconds: input.config.durationSeconds,
    segmentDurations: timeline.map(([startSeconds, endSeconds]) => endSeconds - startSeconds),
  });
  const lastIndex = draft.segments.length - 1;
  const last = draft.segments[lastIndex]!;
  const lastActualUnits = countPromptWizardVoiceoverUnits(last.voiceover, totalBudget.unit);
  if (lastActualUnits + shortfall > segmentBudgets[lastIndex]!.maxUnits) return draft;

  let voiceover = last.voiceover.trim();
  let voiceoverZh = last.voiceoverZh.trim();
  if (totalBudget.unit === 'characters') {
    if (targetLanguage !== '普通话') return draft;
    voiceover = shortfall === 1
      ? `${voiceover.replace(/[。！？!?]+$/u, '')}吧。`
      : `现在，${voiceover}`;
  } else {
    const prefix = PROMPT_WIZARD_WORD_SHORTFALL_PREFIXES[targetLanguage]?.[shortfall - 1];
    if (!prefix) return draft;
    voiceover = `${prefix}, ${voiceover}`;
    voiceoverZh = `现在，${voiceoverZh}`;
  }
  const filled = structuredClone(draft);
  filled.segments[lastIndex] = { ...last, voiceover, voiceoverZh };
  if (env.NODE_ENV === 'production') {
    console.warn(JSON.stringify({
      event: 'prompt-wizard-safe-voiceover-shortfall-filled',
      planIndex: issue.planIndex,
      shortfall,
      unit: totalBudget.unit,
    }));
  }
  return filled;
}

const PROMPT_WIZARD_SAFE_VOICEOVER_FILLER_WORDS: Record<string, ReadonlySet<string>> = {
  英语: new Set([
    'really', 'just', 'clearly', 'simply', 'actually', 'here', 'closer', 'today',
    'now', 'very', 'totally', 'definitely',
  ]),
  西班牙语: new Set([
    'realmente', 'simplemente', 'claramente', 'justo', 'además', 'ahora', 'mismo',
    'muy', 'totalmente', 'definitivamente', 'hoy', 'aquí',
  ]),
  葡萄牙语: new Set([
    'realmente', 'simplesmente', 'claramente', 'mesmo', 'também', 'agora', 'muito',
    'totalmente', 'definitivamente', 'hoje', 'aqui',
  ]),
  法语: new Set([
    'vraiment', 'simplement', 'clairement', 'juste', 'aussi', 'maintenant', 'très',
    'totalement', 'définitivement', 'aujourd’hui', 'ici',
  ]),
  印尼语: new Set(['sangat', 'jelas', 'saja', 'juga', 'sekarang', 'benar-benar', 'hari', 'ini']),
  意大利语: new Set([
    'davvero', 'semplicemente', 'chiaramente', 'proprio', 'anche', 'ora', 'molto',
    'totalmente', 'decisamente', 'oggi', 'qui',
  ]),
  马来语: new Set(['sangat', 'jelas', 'sahaja', 'juga', 'sekarang', 'memang', 'hari', 'ini']),
  越南语: new Set(['thật', 'rất', 'rõ', 'cũng', 'ngay', 'bây', 'giờ', 'hôm', 'nay']),
  德语: new Set(['wirklich', 'einfach', 'klar', 'auch', 'jetzt', 'sehr', 'total', 'heute', 'hier']),
  荷兰语: new Set(['echt', 'gewoon', 'duidelijk', 'ook', 'nu', 'heel', 'vandaag', 'hier']),
  波兰语: new Set(['naprawdę', 'po', 'prostu', 'wyraźnie', 'także', 'teraz', 'bardzo', 'dzisiaj', 'tutaj']),
};

/**
 * 轻量口播修复偶尔会比全片绝对上限多出少量词。只删除不承载产品事实、
 * CTA 或时效承诺的语气/连接词，并优先处理中段；找不到足够安全词时保持
 * 原稿，让后续权威门禁继续拒绝，绝不截断产品信息或购买指令。
 */
function compressPromptWizardVoiceoverRepairTinyOverage(
  draft: PromptWizardPlanDraft,
  input: PromptWizardUseDirectionDraftRepairContext,
  issue: PromptWizardDraftContentRepairIssue,
) {
  if (
    issue.errorCode !== 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID'
    && !issue.action.includes('必须压缩到')
  ) return draft;
  const targetLanguage = promptWizardRequiredTargetLanguage(input);
  const totalBudget = getPromptWizardTotalVoiceoverBudget({
    targetLanguage,
    durationSeconds: input.config.durationSeconds,
  });
  if (totalBudget.unit !== 'words') return draft;
  const actualUnits = draft.segments.reduce((sum, segment) => (
    sum + countPromptWizardVoiceoverUnits(segment.voiceover, totalBudget.unit)
  ), 0);
  let remaining = actualUnits - totalBudget.maxUnits;
  const safeCompressionLimit = Math.min(6, Math.max(2, Math.floor(totalBudget.maxUnits * 0.25)));
  if (remaining < 1 || remaining > safeCompressionLimit || draft.segments.length === 0) return draft;
  const fillers = PROMPT_WIZARD_SAFE_VOICEOVER_FILLER_WORDS[targetLanguage];
  if (!fillers || fillers.size === 0) return draft;

  const compressed = structuredClone(draft);
  const lastIndex = compressed.segments.length - 1;
  const indexes = [
    ...compressed.segments.map((_, index) => index).filter(index => index > 0 && index < lastIndex),
    0,
    lastIndex,
  ];
  for (const segmentIndex of indexes) {
    if (remaining === 0) break;
    const segment = compressed.segments[segmentIndex]!;
    const result = removePromptWizardSafeFillerWords(
      segment.voiceover,
      fillers,
      remaining,
    );
    if (result.removed === 0) continue;
    compressed.segments[segmentIndex] = {
      ...segment,
      voiceover: result.value,
      voiceoverZh: segment.voiceoverZh
        .replace(/(?:真的|其实|非常|清楚地|简单地|另外|也)\s*/gu, '')
        .trim(),
    };
    remaining -= result.removed;
  }
  if (remaining !== 0) return draft;
  if (env.NODE_ENV === 'production') {
    console.warn(JSON.stringify({
      event: 'prompt-wizard-safe-voiceover-overage-compressed',
      planIndex: issue.planIndex,
      overage: actualUnits - totalBudget.maxUnits,
      unit: totalBudget.unit,
    }));
  }
  return compressed;
}

function removePromptWizardSafeFillerWords(
  value: string,
  fillers: ReadonlySet<string>,
  limit: number,
) {
  const matches = Array.from(value.matchAll(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu));
  const removable = matches.filter(match => (
    fillers.has(match[0].normalize('NFKC').toLocaleLowerCase())
  )).slice(0, limit);
  if (removable.length === 0) return { value, removed: 0 };
  let result = value;
  for (const match of removable.sort((left, right) => (right.index ?? 0) - (left.index ?? 0))) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    result = `${result.slice(0, start)}${result.slice(end)}`;
  }
  return {
    value: result
      .replace(/\s+([,.;:!?])/gu, '$1')
      .replace(/([,;:]){2,}/gu, '$1')
      .replace(/^[,;:\s]+|[,;:\s]+$/gu, '')
      .replace(/\s{2,}/gu, ' ')
      .trim(),
    removed: removable.length,
  };
}

function promptWizardValidatedRecoveryPreviousDraft(
  value: unknown,
  segmentCount: number,
) {
  return sanitizePromptWizardPreviousDrafts([
    promptWizardValidatedV6RepairPreviousDraft(value, segmentCount),
  ])[0];
}

function buildPromptWizardUseDirectionDraftFormatRepairInput(
  input: PromptWizardUseDirectionDraftGenerationContext,
  planIndex: PromptWizardPlanIndex,
  segmentCount = expectedPromptWizardDraftSegmentCount(input),
  repair?: {
    input: PromptWizardUseDirectionDraftRepairContext;
    issue: PromptWizardDraftContentRepairIssue;
  },
) {
  const lockedContext = promptWizardDraftContextForPlanIndex(input, planIndex);
  const original = JSON.parse(repair
    ? buildPromptWizardUseDirectionDraftRepairInput(repair.input, repair.issue, segmentCount)
    : buildPromptWizardUseDirectionDraftInput(input, planIndex, segmentCount)) as Record<string, unknown>;
  if (usesPromptWizardCompactDraftWireV2(input, segmentCount)) {
    if (!('routeRole' in lockedContext)) {
      throw promptWizardProviderInputError('V6 格式恢复缺少锁定路线');
    }
    const safeRepairContext = repair ? (() => {
      const previousDraft = promptWizardValidatedRecoveryPreviousDraft(
        repair.input.previousDrafts[repair.issue.planIndex],
        segmentCount,
      );
      const referencePlanIndex = repair.issue.errorCode === 'PROMPT_WIZARD_DIVERSITY_FAILED'
        ? repair.issue.referencePlanIndex
        : undefined;
      const diversityReferenceDraft = referencePlanIndex === undefined
        ? undefined
        : promptWizardValidatedRecoveryPreviousDraft(
            repair.input.previousDrafts[referencePlanIndex],
            segmentCount,
          );
      return {
        previousDraft,
        repairIssue: {
          errorCode: repair.issue.errorCode,
          fieldPaths: [...repair.issue.fieldPaths],
          action: repair.issue.action,
        },
        ...(referencePlanIndex === undefined || !diversityReferenceDraft ? {} : {
          referencePlanIndex,
          diversityReferenceDraft,
        }),
        repairPolicy: [
          'previousDraft 是已通过完整结构校验的当前方案，只能作为本次安全格式恢复的创意基线',
          '只修改 repairIssue.fieldPaths 指向的 Provider-owned 创意字段，其他内容和语义保持不变',
          ...(diversityReferenceDraft ? [
            'diversityReferenceDraft 是 referencePlanIndex 指向的已验证只读对照；不得修改或复制成当前方案',
          ] : []),
          '响应仍必须返回完整 Flat Scalar Recovery 键集；不得返回 hook、subject 或任何服务端确定性字段',
        ],
      };
    })() : {};
    return JSON.stringify({
      task: '基于锁定路线重新生成一个最小且可被标准 JSON.parse 解析的紧凑 Draft Wire V2',
      planIndex,
      lockedHookZh: lockedContext.lockedHookZh,
      ...safeRepairContext,
      ...('routeRole' in original ? { routeRole: original.routeRole } : {}),
      variant: original.variant,
      variantPolicy: original.variantPolicy,
      product: original.product,
      selectedUseDirection: original.selectedUseDirection,
      selectedScene: original.selectedScene,
      assignedEvidence: original.assignedEvidence,
      ...('allowedCategoryInference' in original
        ? { allowedCategoryInference: original.allowedCategoryInference }
        : {}),
      claimPolicy: original.claimPolicy,
      fixedVideoConfig: original.fixedVideoConfig,
      executionBudget: original.executionBudget,
      majorActionPlan: original.majorActionPlan,
      ...('audioPolicy' in original ? { audioPolicy: original.audioPolicy } : {}),
      ...('metadataLanguagePolicy' in original ? {
        metadataLanguagePolicy: {
          ...(original.metadataLanguagePolicy as Record<string, unknown>),
          simplifiedChineseFields: [
            'shots[].shotSize', 'shots[].action', 'shots[].cameraMovement',
            'shots[].lightingAndRealism', 'shots[].foley', 'shots[].editingCue',
          ],
        },
      } : {}),
      ...('languagePolicy' in original ? {
        languagePolicy: {
          ...(original.languagePolicy as Record<string, unknown>),
          simplifiedChineseFields: [
            'shots[].shotSize', 'shots[].action', 'shots[].cameraMovement',
            'shots[].lightingAndRealism', 'shots[].foley', 'shots[].editingCue',
          ],
        },
      } : {}),
      ...('voiceoverTiming' in original ? { voiceoverTiming: original.voiceoverTiming } : {}),
      ...('voiceoverBudget' in original ? { voiceoverBudget: original.voiceoverBudget } : {}),
      ...('totalVoiceoverBudget' in original
        ? { totalVoiceoverBudget: original.totalVoiceoverBudget }
        : {}),
      ...('outputContract' in original ? { outputContract: original.outputContract } : {}),
      imageReferences: original.imageReferences,
      requiredSegmentCount: original.requiredSegmentCount,
      requiredShotRoles: original.requiredShotRoles,
      outputWire: {
        format: 'prompt-wizard-draft-recovery-wire-v2',
        requiredTopLevelFields: [
          'shots',
          ...('outputContract' in original ? ['voiceoverSlots'] : []),
        ],
        forbiddenTopLevelFields: [
          'hook', 'name', 'narrative', 'cameraAndPacing', 'primaryScene',
          'differenceTags', 'planningReview', 'segments', 'productionWarnings',
        ],
        requiredShotFields: [
          'shotSize', 'action', 'cameraMovement', 'lightingAndRealism',
          'foley', 'editingCue',
        ],
        forbiddenShotFields: [
          'role', 'location', 'subject', 'voiceover', 'voiceoverZh',
          'evidenceRefs', 'productionNote',
        ],
      },
      formatRecovery: {
        reason: '上一轮响应不是合法 JSON',
        rules: repair ? [
          '当前输入不含上一轮失败正文、正文片段或动态错误消息；只携带固定白名单 repairIssue 与已验证 previousDraft',
          '只修复 repairIssue.fieldPaths 指向的非 Hook 创意字段，其他 previousDraft 内容和语义保持不变',
          '不得改变 selectedUseDirection、selectedScene、variant、assignedEvidence、majorActionPlan 或 fixedVideoConfig',
          'hook 由服务端逐字使用 lockedHookZh 补齐；响应不得返回 hook 或改写 lockedHookZh',
          '只返回符合恢复 Wire JSON Schema 的一个原生 JSON 对象，不得包含围栏、前后解释或其他字符',
        ] : [
          '只重新生成当前 planIndex；当前输入不含上一轮正文、片段、动态错误消息、字段路径或修复 action',
          '不得改变 selectedUseDirection、selectedScene、variant、assignedEvidence、majorActionPlan 或 fixedVideoConfig',
          'hook 由服务端逐字使用 lockedHookZh 补齐；响应不得返回 hook 或改写 lockedHookZh',
          '只返回符合恢复 Wire JSON Schema 的一个原生 JSON 对象，不得包含围栏、前后解释或其他字符',
        ],
      },
    });
  }
  return JSON.stringify({
    ...original,
    task: '按完全相同的使用方向、场景、证据和修复要求，重新返回合法 JSON',
    formatRecovery: {
      reason: '上一轮响应不是合法 JSON',
      rules: [
        '只重新生成当前 planIndex，不携带或猜测上一轮无法解析的正文',
        '不得改变 selectedUseDirection、selectedScene、variant、assignedEvidence 或 repairIssue',
        '只返回符合 JSON Schema 的原生 JSON 对象，不得包含其他字符',
      ],
    },
  });
}

function promptWizardFlatScalarLogicalPath(path: Array<string | number>) {
  return path.reduce<string>((result, part) => (
    typeof part === 'number' ? `${result}[${part}]` : result ? `${result}.${part}` : part
  ), '');
}

function promptWizardFlatScalarFieldMapping(layout: PromptWizardFlatScalarLayout) {
  const grouped = new Map<string, string[]>();
  for (const entry of layout.entries) {
    const logicalPlanPath = promptWizardFlatScalarLogicalPath(entry.logicalPath);
    grouped.set(logicalPlanPath, [...(grouped.get(logicalPlanPath) ?? []), entry.key]);
  }
  const mappings = [...grouped.entries()].map(([logicalPlanPath, outputWireKeys]) => ({
    logicalPlanPath,
    outputWireKeys,
  }));
  if (layout.mode !== 'voiceover') {
    mappings.unshift({
      logicalPlanPath: 'segments',
      outputWireKeys: layout.entries.filter(entry => entry.kind !== 'hook').map(
        entry => entry.key,
      ),
    });
  }
  return mappings;
}

function promptWizardFlatScalarRuleForEntry(entry: PromptWizardFlatScalarLayoutEntry) {
  if (entry.kind === 'hook') return '简体中文 Hook；非空且不超过 300 字符';
  if (entry.kind === 'shot') {
    return `镜头 ${entry.segmentIndex} 的 ${String(entry.shotField)}；简体中文非空字符串`;
  }
  if (entry.kind === 'voiceover') {
    return `镜头 ${entry.segmentIndex}（${entry.startSeconds}-${entry.endSeconds}s）的完整目标语言口播句；快速但清晰，并须在该时间内自然讲完`;
  }
  return `镜头 ${entry.segmentIndex}（${entry.startSeconds}-${entry.endSeconds}s）目标语言口播的忠实简体中文译文`;
}

function promptWizardFlatScalarOutputWire(layout: PromptWizardFlatScalarLayout) {
  return {
    format: layout.format,
    mode: layout.mode,
    rootType: 'object',
    valueType: 'string',
    requiredKeys: layout.entries.map(entry => entry.key),
    keyMap: layout.entries.map(entry => ({
      key: entry.key,
      ...(layout.mode === 'recovery' ? {} : {
        logicalPlanPath: promptWizardFlatScalarLogicalPath(entry.logicalPath),
      }),
      rule: promptWizardFlatScalarRuleForEntry(entry),
      minLength: entry.minLength,
      ...(entry.maxLength === undefined ? {} : { maxLength: entry.maxLength }),
    })),
    rules: [
      '只返回一个根 JSON 对象；根对象每个值都必须是字符串，禁止数组、嵌套对象、null、数字和布尔值',
      'properties 与 required 必须逐字等于 requiredKeys；不得缺键、多键、改键、包装或增加统计字段',
      layout.mode === 'recovery'
        ? '恢复响应严格禁止 hook；服务端只使用 lockedHookZh 原样补齐 Hook'
        : layout.mode === 'creative'
          ? 'creative 响应必须返回唯一 hook 键'
          : '口播专项响应不得返回 hook 或任何镜头键',
      'vN 承载对应镜头的一条完整自然口播句；非普通话 zN 承载同镜头忠实简体中文译文；普通话不得返回 zN',
    ],
  };
}

const PROMPT_WIZARD_LEGACY_OUTPUT_RULE_PATTERN = /(?:Draft Wire V2|voiceoverSlots|voiceoverWords|voiceoverText|character-arrays-v3|character-strings-v2|word-slots-v1|indexed-character|indexed-word|outputContract|\bshots\b|segments|segmentN|字符数组|数组元素)/u;

function promptWizardKeepNonLegacyOutputRules(value: unknown) {
  return Array.isArray(value)
    ? value.filter(item => (
        typeof item !== 'string' || !PROMPT_WIZARD_LEGACY_OUTPUT_RULE_PATTERN.test(item)
      ))
    : value;
}

/**
 * 保留业务语义输入，只替换 Provider 的输出协议说明。previousDraft、路线、证据
 * 等可以是嵌套输入；零容器约束只针对模型响应。
 */
function buildPromptWizardFlatScalarRequestInput(
  serialized: string,
  layout: PromptWizardFlatScalarLayout,
) {
  const request = JSON.parse(serialized) as Record<string, unknown>;
  delete request.outputContract;
  request.outputWire = promptWizardFlatScalarOutputWire(layout);
  request.task = layout.mode === 'voiceover'
    ? '只返回当前方案口播的 Flat Scalar 固定键补丁'
    : layout.mode === 'recovery'
      ? '基于锁定路线重新生成无 Hook 的 Flat Scalar 格式恢复对象'
      : '返回当前方案包含 Hook、镜头创意与口播的完整 Flat Scalar creative snapshot';

  const shotAndHookKeys = layout.entries.filter(entry => (
    entry.kind === 'hook' || entry.kind === 'shot'
  )).map(entry => entry.key);
  const voiceKeys = layout.entries.filter(entry => (
    entry.kind === 'voiceover'
  )).map(entry => entry.key);
  const translationKeys = layout.entries.filter(entry => (
    entry.kind === 'translation'
  )).map(entry => entry.key);
  const executionBudget = isPlainPromptWizardRecord(request.executionBudget)
    ? request.executionBudget
    : undefined;
  const maxCameraMoveCount = executionBudget?.maxCameraMoveCount;
  const fixedVideoConfig = isPlainPromptWizardRecord(request.fixedVideoConfig)
    ? request.fixedVideoConfig
    : undefined;
  const isFiveSecondVisual = fixedVideoConfig?.durationSeconds === 5;
  const lastShotIndex = layout.segmentCount - 1;
  const majorActionPlan = isPlainPromptWizardRecord(request.majorActionPlan)
    ? request.majorActionPlan
    : undefined;
  const lockedProductActions = Array.isArray(majorActionPlan?.lockedProductActions)
    ? majorActionPlan.lockedProductActions.filter(isPlainPromptWizardRecord)
    : [];
  const firstShotRule = Array.isArray(majorActionPlan?.shotRules)
    && isPlainPromptWizardRecord(majorActionPlan.shotRules[0])
    ? majorActionPlan.shotRules[0]
    : undefined;
  const firstShotAllowedActionIds = Array.isArray(firstShotRule?.allowedActionIds)
    ? firstShotRule.allowedActionIds.filter((value): value is string => typeof value === 'string')
    : [];
  const firstLockedAction = lockedProductActions.find(action => (
    typeof action.id === 'string'
    && firstShotAllowedActionIds.includes(action.id)
    && typeof action.action === 'string'
    && action.action.trim() === action.action
    && action.action.length > 0
  ));
  const selectedScene = isPlainPromptWizardRecord(request.selectedScene)
    ? request.selectedScene
    : undefined;
  const selectedSceneMainAction = typeof selectedScene?.mainAction === 'string'
    && selectedScene.mainAction.trim() === selectedScene.mainAction
    && selectedScene.mainAction.length > 0
    ? selectedScene.mainAction
    : undefined;
  const usesSingleLockedAction = majorActionPlan?.maxDistinctActionFamilies === 1
    && lockedProductActions.length === 1;
  const authoritativeFirstAction = usesSingleLockedAction
    ? typeof lockedProductActions[0]?.action === 'string'
      ? lockedProductActions[0].action
      : undefined
    : selectedSceneMainAction ?? (typeof firstLockedAction?.action === 'string'
      ? firstLockedAction.action
      : undefined);
  const variantPolicy = isPlainPromptWizardRecord(request.variantPolicy)
    ? request.variantPolicy
    : undefined;
  const firstSecondRule = typeof variantPolicy?.firstSecond === 'string'
    && variantPolicy.firstSecond.trim() === variantPolicy.firstSecond
    && variantPolicy.firstSecond.length > 0
    ? variantPolicy.firstSecond
    : undefined;
  const flatFirstShotActionRule = [
    '首镜 s0Action 必须且只能执行 majorActionPlan.shotRules[0].allowedActionIds 指向的锁定产品动作',
    authoritativeFirstAction
      ? `本请求的权威首镜动作是“${authoritativeFirstAction}”`
      : '必须从 majorActionPlan.lockedProductActions 按 allowedActionIds 精确取回权威首镜动作',
    firstSecondRule
      ? `严格按 variantPolicy.firstSecond=“${firstSecondRule}”从指定的动作起点、关键过程或动作落点切入`
      : '严格按 variantPolicy.firstSecond 指定的动作起点、关键过程或动作落点切入',
    '禁止新增第二个产品动作；subject 与产品锚点由服务端确定性补齐，响应不得返回 subject 键',
  ].join('；');
  const flatProductionRules = layout.mode === 'voiceover' ? [] : [
    flatFirstShotActionRule,
    typeof maxCameraMoveCount === 'number'
      && Number.isInteger(maxCameraMoveCount)
      && maxCameraMoveCount > 0
      ? maxCameraMoveCount === 1
        ? `s0CameraMovement 至 s${lastShotIndex}CameraMovement 必须只使用同一种可识别运镜，统一写为“持续缓慢推近”；不得出现横移、跟随、拉远、摇镜、环绕、升降或焦点切换`
        : `s0CameraMovement 至 s${lastShotIndex}CameraMovement 的可检测运镜种类不得超过 executionBudget.maxCameraMoveCount=${maxCameraMoveCount}`
      : '全部 sNCameraMovement 必须严格遵守 executionBudget.maxCameraMoveCount，不得自行增加运镜种类',
    `s0EditingCue 至 s${lastShotIndex}EditingCue 每个都必须明确包含“动作点快切”或“节奏剪辑”`,
    isFiveSecondVisual
      ? `5 秒末镜 s${lastShotIndex}EditingCue 不得做静态尾卡；必须在“持续缓慢推近”和唯一商品动作仍在发生时以动作点快切或节奏剪辑收尾`
      : `CTA 末镜 s${lastShotIndex}EditingCue 不得做静态尾卡；必须在手部或镜头运动中以动作点快切或节奏剪辑收尾；不得停顿、停留、定格、静止、保持画面或等待口播`,
  ];
  if (isPlainPromptWizardRecord(request.languagePolicy)) {
    request.languagePolicy = {
      ...request.languagePolicy,
      targetLanguageFields: voiceKeys,
      simplifiedChineseTranslationFields: translationKeys,
      simplifiedChineseFields: shotAndHookKeys,
      rules: [
        '只有 outputWire.keyMap 标为目标语言口播的 v 键使用目标语言；z 键必须是忠实简体中文译文；其余创意键使用简体中文',
        '每个 vN 必须是一条完整、自然、非空的口播句；允许目标语言自然标点、词间空格、数字和品牌名',
        '根据 voiceoverTiming 的本镜起止时间使用快速但清晰的自然口播，并自行复核能在该时间内讲完；若讲不完必须整句重写得更简洁',
        '服务端不提供语言语速、字词数量或时长估算；不得机械截断、跨镜借时或返回字数统计',
        '所有口播键同时通过 exact keyset、类型、规范化、目标语言与译文门禁后，服务端才原子写回完整方案',
        '不得返回第二份口播来源、旧 vNPP/voiceoverSlots 槽包装、数组、嵌套对象或字数统计',
      ],
    };
  }
  if (isPlainPromptWizardRecord(request.metadataLanguagePolicy)) {
    request.metadataLanguagePolicy = {
      ...request.metadataLanguagePolicy,
      simplifiedChineseFields: shotAndHookKeys,
      rules: [
        '所有 Flat Scalar 创意键必须使用简体中文',
        '本模式没有口播键，不得返回任何 vN、vNPP 或 zN 字段',
      ],
    };
  }
  if (isPlainPromptWizardRecord(request.audioPolicy)) {
    request.audioPolicy = {
      ...request.audioPolicy,
      requiredEmptyFields: [],
      rules: [
        'Flat Scalar 响应中不存在任何口播键；无对白、无人声、无旁白',
        '只设计音乐、环境声和真实商品操作拟音，不生成画面文字或平台 UI',
      ],
    };
  }
  if ('rules' in request) request.rules = promptWizardKeepNonLegacyOutputRules(request.rules);
  if ('scriptRules' in request) {
    request.scriptRules = [
      ...(promptWizardKeepNonLegacyOutputRules(request.scriptRules) as unknown[]),
      '每个 sNShotSize/sNAction/sNCameraMovement/sNLightingAndRealism/sNFoley/sNEditingCue 必须逐一对应 requiredShotRoles 的同索引镜头，并遵守 majorActionPlan.shotRules',
      '所有镜头共同遵守唯一动作预算；resolution 与 CTA 只呈现已有动作结果，不得派生新商品动作',
      ...flatProductionRules,
    ];
  }
  if ('repairPolicy' in request) {
    const retainedRepairPolicy = Array.isArray(request.repairPolicy)
      ? request.repairPolicy.filter(rule => (
          typeof rule !== 'string'
          || !/(?:outputContract|voiceoverSlots|voiceoverWords|voiceoverText|exactWordCount|exactCharacterCount|单字符数组|segments\[0\]\.subject)/u.test(rule)
        ))
      : [];
    request.repairPolicy = [
      ...retainedRepairPolicy,
      ...(layout.mode === 'voiceover' ? [] : [flatFirstShotActionRule]),
      '只修改 repairIssue 指向的逻辑计划字段，其他创意内容保持不变',
      '按 schemaRepairFieldMapping 将逻辑路径映射到固定根标量键；完整响应仍必须返回 outputWire.requiredKeys 的全部键',
      '不得改变锁定路线、场景、variant、唯一购买理由、证据、动作预算、视频配置或目标语言',
      '不得返回旧 Wire、完整 Draft、数组、嵌套对象或第二口播来源',
    ];
  }
  if ('schemaRepairFieldMapping' in request) {
    request.schemaRepairFieldMapping = promptWizardFlatScalarFieldMapping(layout);
  }
  if (isPlainPromptWizardRecord(request.previousWireCandidate)) {
    request.previousWireCandidate = Object.fromEntries(layout.entries.flatMap(entry => (
      Object.hasOwn(request.previousWireCandidate as Record<string, unknown>, entry.key)
        ? [[
            entry.key,
            (request.previousWireCandidate as Record<string, unknown>)[entry.key],
          ]]
        : []
    )));
  }
  if (isPlainPromptWizardRecord(request.formatRecovery)) {
    const hasSafeRepairContext = isPlainPromptWizardRecord(request.repairIssue)
      && isPlainPromptWizardRecord(request.previousDraft);
    request.formatRecovery = {
      ...request.formatRecovery,
      rules: hasSafeRepairContext ? [
        '输入不含上一轮失败正文、正文片段或动态错误消息；只使用固定白名单 repairIssue 与已验证 previousDraft',
        '只修复 repairIssue.fieldPaths 指向的非 Hook Provider-owned 创意字段，其他 previousDraft 内容保持不变',
        '不得改变锁定路线、场景、证据、动作预算、视频配置或口播语义',
        '响应不得返回 hook；服务端只使用 lockedHookZh 原样补齐',
        '只返回符合 outputWire 和 JSON Schema 的一个原生根对象，不得包含围栏、解释或额外字符',
      ] : [
        '输入不含上一轮正文、片段、动态错误消息、字段路径或 repair action；不得猜测或复述它们',
        '不得改变锁定路线、场景、证据、动作预算、视频配置或口播语义',
        '响应不得返回 hook；服务端只使用 lockedHookZh 原样补齐',
        '只返回符合 outputWire 和 JSON Schema 的一个原生根对象，不得包含围栏、解释或额外字符',
      ],
    };
  }
  request.schemaRepairFieldMapping = 'repairIssue' in request
    ? promptWizardFlatScalarFieldMapping(layout)
    : request.schemaRepairFieldMapping;
  request.flatScalarRules = promptWizardFlatScalarOutputWire(layout).rules;
  request.flatProductionRules = flatProductionRules;
  return JSON.stringify(request);
}

export function createPromptWizardFlatScalarJsonSchema(
  layout: PromptWizardFlatScalarLayout,
) {
  return {
    type: 'object',
    additionalProperties: false,
    required: layout.entries.map(entry => entry.key),
    properties: Object.fromEntries(layout.entries.map(entry => ([
      entry.key,
      {
        type: 'string',
        minLength: entry.minLength,
        ...(entry.maxLength === undefined ? {} : { maxLength: entry.maxLength }),
      },
    ]))),
  };
}

/**
 * JSON.parse 会对重复对象键采用 last-wins，这会让终局口播的来源锁
 * 失去意义。这里只做词法扫描，不修改原文；所有层级的对象键都按
 * JSON 字符串语义解码，因此 `segment1` 与 `segment\u0031` 也会冲突。
 */
function assertPromptWizardJsonObjectKeysUnique(value: string) {
  type JsonContext =
    | { type: 'object'; keys: Set<string>; expectingKey: boolean }
    | { type: 'array' };
  const stack: JsonContext[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === '"') {
      const stringStart = index;
      let escaped = false;
      let stringEnd = -1;
      for (index += 1; index < value.length; index += 1) {
        const stringCharacter = value[index]!;
        if (escaped) {
          escaped = false;
          continue;
        }
        if (stringCharacter === '\\') {
          escaped = true;
          continue;
        }
        if (stringCharacter === '"') {
          stringEnd = index;
          break;
        }
      }
      if (stringEnd < 0) return;
      const context = stack.at(-1);
      if (context?.type === 'object' && context.expectingKey) {
        const key = JSON.parse(value.slice(stringStart, stringEnd + 1)) as string;
        const canonicalKey = key.normalize('NFC');
        if (context.keys.has(canonicalKey)) {
          throw Object.assign(new Error('V6 Draft JSON 包含重复对象键'), {
            code: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
          });
        }
        context.keys.add(canonicalKey);
        context.expectingKey = false;
      }
      continue;
    }
    if (character === '{') {
      stack.push({ type: 'object', keys: new Set<string>(), expectingKey: true });
      continue;
    }
    if (character === '[') {
      stack.push({ type: 'array' });
      continue;
    }
    if (character === '}' || character === ']') {
      stack.pop();
      continue;
    }
    const context = stack.at(-1);
    if (context?.type !== 'object') continue;
    if (character === ',') context.expectingKey = true;
    else if (character === ':') context.expectingKey = false;
  }
}

function markPromptWizardOutputSchemaIssue<T extends object>(
  error: T,
  schemaIssue: PromptWizardOutputSchemaFailureIssue,
): T {
  Object.defineProperty(error, PROMPT_WIZARD_OUTPUT_SCHEMA_ISSUE, {
    configurable: false,
    enumerable: false,
    value: schemaIssue,
    writable: false,
  });
  return error;
}

function promptWizardOutputSchemaIssueFromError(
  error: unknown,
): PromptWizardOutputSchemaIssue | null {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== 'object' || current === null) return null;
    const record = current as Record<PropertyKey, unknown>;
    const candidate = record[PROMPT_WIZARD_OUTPUT_SCHEMA_ISSUE]
      ?? record.schemaIssue;
    if (
      typeof candidate === 'string'
      && PROMPT_WIZARD_OUTPUT_SCHEMA_ISSUES.has(
        candidate as PromptWizardOutputSchemaIssue,
      )
    ) {
      return candidate as PromptWizardOutputSchemaIssue;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function throwPromptWizardFullDraftWordSlotError(
  path: Array<string | number>,
  message: string,
  schemaIssue: PromptWizardOutputSchemaFailureIssue,
): never {
  throw markPromptWizardOutputSchemaIssue(new z.ZodError([{
    code: z.ZodIssueCode.custom,
    path,
    message,
  }]), schemaIssue);
}

function parsePromptWizardFullDraftWordSlot(
  segmentIndex: number,
  value: unknown,
) {
  if (!isPlainPromptWizardRecord(value)) {
    throwPromptWizardFullDraftWordSlotError(
      ['segments', segmentIndex, 'voiceover'],
      '词槽必须是对象',
      'wire-shape',
    );
  }
  const expectedKeys = ['voiceoverWords', 'voiceoverZh'];
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some(key => !expectedKeys.includes(key))
  ) {
    throwPromptWizardFullDraftWordSlotError(
      ['segments', segmentIndex, 'voiceover'],
      '词槽必须严格返回固定属性',
      'keyset',
    );
  }
  const result = promptWizardVoiceoverWordSlotWireSchema.safeParse(value);
  if (result.success) return result.data;
  throw markPromptWizardOutputSchemaIssue(
    new z.ZodError(result.error.issues.map(issue => ({
      ...issue,
      // Provider 的安全修复白名单只接收逻辑计划字段；传输层词槽绝不进入
      // diagnostics。槽内中文译文映射到 voiceoverZh，其余映射到 voiceover。
      path: [
        'segments',
        segmentIndex,
        issue.path[0] === 'voiceoverZh' ? 'voiceoverZh' : 'voiceover',
      ],
    }))),
    result.error.issues.some(issue => issue.path[0] === 'voiceoverZh')
      ? 'translation'
      : 'wire-shape',
  );
}

/**
 * 完整首稿的词槽与画面字段先各自完成严格校验，再一次性合并。任何槽位
 * 或第二来源不合法时都不会把部分口播写进 Draft。
 */
function decodePromptWizardFullDraftWordSlots(
  value: unknown,
  contract: PromptWizardFullDraftWordSlotContract,
  segmentCount: number,
) {
  if (!isPlainPromptWizardRecord(value)) {
    throwPromptWizardFullDraftWordSlotError(
      [],
      'V6 完整词槽方案顶层必须是对象',
      'wire-shape',
    );
  }
  if (!Object.hasOwn(value, contract.property)) {
    throwPromptWizardFullDraftWordSlotError(
      ['segments'],
      `V6 完整词槽方案缺少 ${contract.property}`,
      'keyset',
    );
  }
  const planCandidate = { ...value };
  const slotsCandidate = planCandidate[contract.property];
  delete planCandidate[contract.property];
  const planResult = promptWizardDraftWirePlanSchema.safeParse(planCandidate);
  if (!planResult.success) {
    throw markPromptWizardOutputSchemaIssue(planResult.error, 'wire-shape');
  }
  const plan = planResult.data;
  if (plan.segments.length !== segmentCount) {
    throwPromptWizardFullDraftWordSlotError(
      ['segments'],
      `必须返回 ${segmentCount} 个镜头`,
      'count',
    );
  }
  const secondSourceIssue = plan.segments.flatMap((segment, segmentIndex) => [
    ...(segment.voiceover !== '' ? [{
      path: ['segments', segmentIndex, 'voiceover'] as Array<string | number>,
      message: '词槽完整方案的 segments[].voiceover 必须严格为空字符串',
    }] : []),
    ...(segment.voiceoverZh !== '' ? [{
      path: ['segments', segmentIndex, 'voiceoverZh'] as Array<string | number>,
      message: '词槽完整方案的 segments[].voiceoverZh 必须严格为空字符串',
    }] : []),
  ])[0];
  if (secondSourceIssue) {
    throwPromptWizardFullDraftWordSlotError(
      secondSourceIssue.path,
      secondSourceIssue.message,
      'secondary-source',
    );
  }
  if (!isPlainPromptWizardRecord(slotsCandidate)) {
    throwPromptWizardFullDraftWordSlotError(
      ['segments'],
      `${contract.property} 必须是对象`,
      'wire-shape',
    );
  }
  const requiredProperties = contract.segments.map(segment => segment.property);
  const actualProperties = Object.keys(slotsCandidate);
  const extraProperty = actualProperties.find(property => !requiredProperties.includes(property));
  if (extraProperty) {
    throwPromptWizardFullDraftWordSlotError(
      ['segments'],
      'V6 完整词槽方案不得包含额外属性',
      'keyset',
    );
  }
  const missingProperty = requiredProperties.find(property => (
    !Object.hasOwn(slotsCandidate, property)
  ));
  if (missingProperty || actualProperties.length !== requiredProperties.length) {
    const missingSegmentIndex = contract.segments.find(
      segment => segment.property === missingProperty,
    )?.segmentIndex;
    throwPromptWizardFullDraftWordSlotError(
      missingSegmentIndex === undefined
        ? ['segments']
        : ['segments', missingSegmentIndex, 'voiceover'],
      `${contract.property} 必须严格返回 ${requiredProperties.join('、')}`,
      'keyset',
    );
  }

  const resolvedVoiceovers = contract.segments.map(segmentContract => {
    const slot = parsePromptWizardFullDraftWordSlot(
      segmentContract.segmentIndex,
      slotsCandidate[segmentContract.property],
    );
    if (slot.voiceoverWords.length !== segmentContract.exactWordCount) {
      throwPromptWizardFullDraftWordSlotError(
        ['segments', segmentContract.segmentIndex, 'voiceover'],
        `voiceoverWords 必须严格包含 ${segmentContract.exactWordCount} 个词槽`,
        'count',
      );
    }
    slot.voiceoverWords.forEach(word => {
      if (word.normalize('NFKC') !== word) {
        throwPromptWizardFullDraftWordSlotError(
          ['segments', segmentContract.segmentIndex, 'voiceover'],
          'voiceoverWords 词槽不得依赖 NFKC 变换',
          'unit',
        );
      }
      if (
        !word
        || word.trim() !== word
        || /[\p{C}\p{Z}\s]/u.test(word)
        || countPromptWizardVoiceoverUnits(word, 'words') !== 1
      ) {
        throwPromptWizardFullDraftWordSlotError(
          ['segments', segmentContract.segmentIndex, 'voiceover'],
          '每个 voiceoverWords 词槽必须且只能包含一个不含空白的目标语言词',
          'unit',
        );
      }
    });
    if (!slot.voiceoverZh || slot.voiceoverZh.trim() !== slot.voiceoverZh) {
      throwPromptWizardFullDraftWordSlotError(
        ['segments', segmentContract.segmentIndex, 'voiceoverZh'],
        'voiceoverZh 必须是非空且不含首尾空白的忠实简体中文翻译',
        'translation',
      );
    }
    return {
      voiceover: slot.voiceoverWords.join(' '),
      voiceoverZh: slot.voiceoverZh,
    };
  });

  return {
    ...plan,
    segments: plan.segments.map((segment, segmentIndex) => ({
      ...segment,
      ...resolvedVoiceovers[segmentIndex]!,
    })),
  };
}

function throwPromptWizardFullDraftCharacterSlotError(
  path: Array<string | number>,
  message: string,
  schemaIssue: PromptWizardOutputSchemaFailureIssue,
): never {
  throw markPromptWizardOutputSchemaIssue(new z.ZodError([{
    code: z.ZodIssueCode.custom,
    path,
    message,
  }]), schemaIssue);
}

function parsePromptWizardFullDraftCharacterString(
  segmentIndex: number,
  value: unknown,
): { voiceoverText: string; voiceoverZh: string } {
  if (!isPlainPromptWizardRecord(value)) {
    throwPromptWizardFullDraftCharacterSlotError(
      ['segments', segmentIndex, 'voiceover'],
      '定长字符串口播槽必须是对象',
      'wire-shape',
    );
  }
  const expectedKeys = ['voiceoverText', 'voiceoverZh'];
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some(key => !expectedKeys.includes(key))
  ) {
    throwPromptWizardFullDraftCharacterSlotError(
      ['segments', segmentIndex, 'voiceover'],
      '定长字符串口播槽必须严格返回固定属性',
      'keyset',
    );
  }
  const result = z.object({
    voiceoverText: z.string(),
    voiceoverZh: z.string().min(1).max(300),
  }).strict().safeParse(value);
  if (result.success) {
    if (result.data.voiceoverZh.trim() !== result.data.voiceoverZh) {
      throwPromptWizardFullDraftCharacterSlotError(
        ['segments', segmentIndex, 'voiceoverZh'],
        '字符字符串槽的 voiceoverZh 必须非空且不得含首尾空白',
        'translation',
      );
    }
    return result.data;
  }
  throw markPromptWizardOutputSchemaIssue(
    new z.ZodError(result.error.issues.map(issue => ({
      ...issue,
      // 与词槽一致，Provider 安全诊断只暴露逻辑计划路径，不泄漏传输结构。
      path: [
        'segments',
        segmentIndex,
        issue.path[0] === 'voiceoverZh' ? 'voiceoverZh' : 'voiceover',
      ],
    }))),
    result.error.issues.some(issue => issue.path[0] === 'voiceoverZh')
      ? 'translation'
      : 'wire-shape',
  );
}

/**
 * 完整字符计量首稿先验证全部画面字段、固定槽键、定长字符串、必要译文
 * 和第二来源，只有所有段同时通过后才原子写回；任一错误都不会产生部分 Draft。
 */
function decodePromptWizardFullDraftCharacterStrings(
  value: unknown,
  contract: PromptWizardFullDraftCharacterStringContract,
  segmentCount: number,
) {
  if (!isPlainPromptWizardRecord(value)) {
    throwPromptWizardFullDraftCharacterSlotError(
      [],
      'V6 完整字符槽方案顶层必须是对象',
      'wire-shape',
    );
  }
  if (!Object.hasOwn(value, contract.property)) {
    throwPromptWizardFullDraftCharacterSlotError(
      ['segments'],
      `V6 完整字符槽方案缺少 ${contract.property}`,
      'keyset',
    );
  }
  const planCandidate = { ...value };
  const slotsCandidate = planCandidate[contract.property];
  delete planCandidate[contract.property];
  const planResult = promptWizardDraftWirePlanSchema.safeParse(planCandidate);
  if (!planResult.success) {
    throw markPromptWizardOutputSchemaIssue(planResult.error, 'wire-shape');
  }
  const plan = planResult.data;
  if (plan.segments.length !== segmentCount) {
    throwPromptWizardFullDraftCharacterSlotError(
      ['segments'],
      `必须返回 ${segmentCount} 个镜头`,
      'count',
    );
  }
  const secondSourceIssue = plan.segments.flatMap((segment, segmentIndex) => [
    ...(segment.voiceover !== '' ? [{
      path: ['segments', segmentIndex, 'voiceover'] as Array<string | number>,
      message: '字符槽完整方案的 segments[].voiceover 必须严格为空字符串',
    }] : []),
    ...(segment.voiceoverZh !== '' ? [{
      path: ['segments', segmentIndex, 'voiceoverZh'] as Array<string | number>,
      message: '字符槽完整方案的 segments[].voiceoverZh 必须严格为空字符串',
    }] : []),
  ])[0];
  if (secondSourceIssue) {
    throwPromptWizardFullDraftCharacterSlotError(
      secondSourceIssue.path,
      secondSourceIssue.message,
      'secondary-source',
    );
  }
  if (!isPlainPromptWizardRecord(slotsCandidate)) {
    throwPromptWizardFullDraftCharacterSlotError(
      ['segments'],
      `${contract.property} 必须是对象`,
      'wire-shape',
    );
  }
  const requiredProperties = contract.segments.map(segment => segment.property);
  const actualProperties = Object.keys(slotsCandidate);
  const extraProperty = actualProperties.find(property => !requiredProperties.includes(property));
  if (extraProperty) {
    throwPromptWizardFullDraftCharacterSlotError(
      ['segments'],
      'V6 完整定长字符串不得包含额外属性',
      'keyset',
    );
  }
  const missingProperty = requiredProperties.find(property => (
    !Object.hasOwn(slotsCandidate, property)
  ));
  if (missingProperty || actualProperties.length !== requiredProperties.length) {
    const missingSegmentIndex = contract.segments.find(
      segment => segment.property === missingProperty,
    )?.segmentIndex;
    throwPromptWizardFullDraftCharacterSlotError(
      missingSegmentIndex === undefined
        ? ['segments']
        : ['segments', missingSegmentIndex, 'voiceover'],
      `${contract.property} 必须严格返回 ${requiredProperties.join('、')}`,
      'keyset',
    );
  }

  const resolvedVoiceovers = contract.segments.map(segmentContract => {
    const slot = parsePromptWizardFullDraftCharacterString(
      segmentContract.segmentIndex,
      slotsCandidate[segmentContract.property],
    );
    const characters = Array.from(slot.voiceoverText);
    if (characters.length !== segmentContract.exactCharacterCount) {
      throwPromptWizardFullDraftCharacterSlotError(
        ['segments', segmentContract.segmentIndex, 'voiceover'],
        `voiceoverText 必须严格包含 ${segmentContract.exactCharacterCount} 个字符`,
        'count',
      );
    }
    const invalidCharacterIndex = characters.findIndex(character => (
      !isPromptWizardStrictTranslatedCharacter(character)
    ));
    if (invalidCharacterIndex >= 0) {
      throwPromptWizardFullDraftCharacterSlotError(
        ['segments', segmentContract.segmentIndex, 'voiceover'],
        'voiceoverText 只能包含无需规范化的目标语言字母、组合标记或数字',
        'unit',
      );
    }
    return {
      voiceover: slot.voiceoverText,
      voiceoverZh: slot.voiceoverZh,
    };
  });

  return {
    ...plan,
    segments: plan.segments.map((segment, segmentIndex) => ({
      ...segment,
      ...resolvedVoiceovers[segmentIndex]!,
    })),
  };
}

/**
 * 普通话 Array V3 把“字符数”变成 JSON 数组长度。这里仍拒绝任何对象包装、
 * 多字符元素、规范化变化和非法字符；resolvedVoiceovers 全部构造成功之前
 * 不修改任何镜头，保证整组原子写回。
 */
function decodePromptWizardFullDraftCharacterArrays(
  value: unknown,
  contract: PromptWizardFullDraftCharacterArrayContract,
  segmentCount: number,
) {
  if (!isPlainPromptWizardRecord(value)) {
    throwPromptWizardFullDraftCharacterSlotError(
      [],
      'V6 普通话字符数组方案顶层必须是对象',
      'wire-shape',
    );
  }
  if (!Object.hasOwn(value, contract.property)) {
    throwPromptWizardFullDraftCharacterSlotError(
      ['segments'],
      `V6 普通话字符数组方案缺少 ${contract.property}`,
      'keyset',
    );
  }
  const planCandidate = { ...value };
  const slotsCandidate = planCandidate[contract.property];
  delete planCandidate[contract.property];
  const planResult = promptWizardDraftWirePlanSchema.safeParse(planCandidate);
  if (!planResult.success) {
    throw markPromptWizardOutputSchemaIssue(planResult.error, 'wire-shape');
  }
  const plan = planResult.data;
  if (plan.segments.length !== segmentCount) {
    throwPromptWizardFullDraftCharacterSlotError(
      ['segments'],
      `必须返回 ${segmentCount} 个镜头`,
      'count',
    );
  }
  const secondSourceIssue = plan.segments.flatMap((segment, segmentIndex) => [
    ...(segment.voiceover !== '' ? [{
      path: ['segments', segmentIndex, 'voiceover'] as Array<string | number>,
      message: '普通话字符数组方案的 segments[].voiceover 必须严格为空字符串',
    }] : []),
    ...(segment.voiceoverZh !== '' ? [{
      path: ['segments', segmentIndex, 'voiceoverZh'] as Array<string | number>,
      message: '普通话字符数组方案的 segments[].voiceoverZh 必须严格为空字符串',
    }] : []),
  ])[0];
  if (secondSourceIssue) {
    throwPromptWizardFullDraftCharacterSlotError(
      secondSourceIssue.path,
      secondSourceIssue.message,
      'secondary-source',
    );
  }
  if (!isPlainPromptWizardRecord(slotsCandidate)) {
    throwPromptWizardFullDraftCharacterSlotError(
      ['segments'],
      `${contract.property} 必须是对象`,
      'wire-shape',
    );
  }
  const requiredProperties = contract.segments.map(segment => segment.property);
  const actualProperties = Object.keys(slotsCandidate);
  const extraProperty = actualProperties.find(property => !requiredProperties.includes(property));
  if (extraProperty) {
    throwPromptWizardFullDraftCharacterSlotError(
      ['segments'],
      'V6 普通话字符数组不得包含额外属性',
      'keyset',
    );
  }
  const missingProperty = requiredProperties.find(property => (
    !Object.hasOwn(slotsCandidate, property)
  ));
  if (missingProperty || actualProperties.length !== requiredProperties.length) {
    const missingSegmentIndex = contract.segments.find(
      segment => segment.property === missingProperty,
    )?.segmentIndex;
    throwPromptWizardFullDraftCharacterSlotError(
      missingSegmentIndex === undefined
        ? ['segments']
        : ['segments', missingSegmentIndex, 'voiceover'],
      `${contract.property} 必须严格返回 ${requiredProperties.join('、')}`,
      'keyset',
    );
  }

  const resolvedVoiceovers = contract.segments.map(segmentContract => {
    const valueAtSlot = slotsCandidate[segmentContract.property];
    if (
      isPlainPromptWizardRecord(valueAtSlot)
      && (Object.hasOwn(valueAtSlot, 'voiceoverText')
        || Object.hasOwn(valueAtSlot, 'voiceoverZh'))
    ) {
      throwPromptWizardFullDraftCharacterSlotError(
        [
          'segments',
          segmentContract.segmentIndex,
          Object.hasOwn(valueAtSlot, 'voiceoverZh') ? 'voiceoverZh' : 'voiceover',
        ],
        '普通话单字符数组不得返回 voiceoverText、voiceoverZh 或其他口播来源',
        'secondary-source',
      );
    }
    if (!Array.isArray(valueAtSlot)) {
      throwPromptWizardFullDraftCharacterSlotError(
        ['segments', segmentContract.segmentIndex, 'voiceover'],
        '每个 segmentN 必须直接是单字符字符串数组',
        'wire-shape',
      );
    }
    if (valueAtSlot.length !== segmentContract.exactCharacterCount) {
      throwPromptWizardFullDraftCharacterSlotError(
        ['segments', segmentContract.segmentIndex, 'voiceover'],
        `字符数组必须严格包含 ${segmentContract.exactCharacterCount} 个元素`,
        'count',
      );
    }
    const nonStringIndex = valueAtSlot.findIndex(item => typeof item !== 'string');
    if (nonStringIndex >= 0) {
      throwPromptWizardFullDraftCharacterSlotError(
        ['segments', segmentContract.segmentIndex, 'voiceover'],
        '字符数组每项必须是字符串',
        'wire-shape',
      );
    }
    const characters = valueAtSlot as string[];
    const invalidCharacterIndex = characters.findIndex(character => (
      Array.from(character).length !== 1
      || !isPromptWizardStrictReadableCharacter(character)
    ));
    if (invalidCharacterIndex >= 0) {
      throwPromptWizardFullDraftCharacterSlotError(
        ['segments', segmentContract.segmentIndex, 'voiceover'],
        '字符数组每项必须恰好包含一个无需规范化的可朗读汉字、字母或数字',
        'unit',
      );
    }
    return characters.join('');
  });

  return {
    ...plan,
    segments: plan.segments.map((segment, segmentIndex) => ({
      ...segment,
      voiceover: resolvedVoiceovers[segmentIndex]!,
      voiceoverZh: '',
    })),
  };
}

function promptWizardFlatScalarFallbackLogicalPath(
  key: string,
  segmentCount: number,
): Array<string | number> {
  if (key === 'hook') return ['hook'];
  const shotMatch = /^s(\d)(ShotSize|Action|CameraMovement|LightingAndRealism|Foley|EditingCue)$/u.exec(key);
  if (shotMatch) {
    const segmentIndex = Number(shotMatch[1]);
    const fields: Record<string, string> = {
      ShotSize: 'shotSize',
      Action: 'action',
      CameraMovement: 'cameraMovement',
      LightingAndRealism: 'lightingAndRealism',
      Foley: 'foley',
      EditingCue: 'editingCue',
    };
    return segmentIndex < segmentCount
      ? ['segments', segmentIndex, fields[shotMatch[2]!]!]
      : ['segments'];
  }
  const voiceMatch = /^v(\d)(?:\d{2})?$/u.exec(key);
  if (voiceMatch) {
    const segmentIndex = Number(voiceMatch[1]);
    return segmentIndex < segmentCount
      ? ['segments', segmentIndex, 'voiceover']
      : ['segments'];
  }
  const translationMatch = /^z(\d)$/u.exec(key);
  if (translationMatch) {
    const segmentIndex = Number(translationMatch[1]);
    return segmentIndex < segmentCount
      ? ['segments', segmentIndex, 'voiceoverZh']
      : ['segments'];
  }
  return ['segments'];
}

function throwPromptWizardFlatScalarError(
  path: Array<string | number>,
  message: string,
  schemaIssue: PromptWizardOutputSchemaFailureIssue,
): never {
  throw markPromptWizardOutputSchemaIssue(new z.ZodError([{
    code: z.ZodIssueCode.custom,
    path,
    message,
  }]), schemaIssue);
}

function validatePromptWizardFlatScalarEntryValue(
  entry: PromptWizardFlatScalarLayoutEntry,
  candidate: unknown,
  options: { sourceLocked?: boolean } = {},
) {
  if (typeof candidate !== 'string') {
    throwPromptWizardFlatScalarError(
      entry.logicalPath,
      'Flat Scalar Wire 的每个值都必须是字符串',
      'wire-shape',
    );
  }
  const isVoiceText = entry.kind === 'voiceover' || entry.kind === 'translation';
  const normalizedCandidate = isVoiceText
    ? candidate.normalize('NFKC').trim()
    : candidate;
  const codePointLength = Array.from(normalizedCandidate).length;
  if (codePointLength < entry.minLength || (
    entry.maxLength !== undefined && codePointLength > entry.maxLength
  )) {
    throwPromptWizardFlatScalarError(
      entry.logicalPath,
      'Flat Scalar Wire 字符串长度不符合固定契约',
      entry.kind === 'translation' ? 'translation' : 'wire-shape',
    );
  }
  if (isVoiceText) {
    if (
      !normalizedCandidate
      || /\p{C}/u.test(normalizedCandidate)
      || /\p{Extended_Pictographic}/u.test(normalizedCandidate)
    ) {
      throwPromptWizardFlatScalarError(
        entry.logicalPath,
        entry.kind === 'translation'
          ? '中文译文不得包含控制符、零宽格式符或 Emoji'
          : '完整口播句不得包含控制符、零宽格式符或 Emoji',
        entry.kind === 'translation' ? 'translation' : 'unit',
      );
    }
    return normalizedCandidate;
  }
  const trimmed = candidate.trim();
  if (!trimmed || trimmed !== candidate) {
    throwPromptWizardFlatScalarError(
      entry.logicalPath,
      entry.kind === 'translation'
        ? options.sourceLocked
          ? '来源锁定中文译文必须非空且不得包含首尾空白'
          : '中文译文必须非空且不得包含首尾空白'
        : options.sourceLocked
          ? '来源锁定创意标量必须非空且不得包含首尾空白'
          : '创意标量必须非空且不得包含首尾空白',
      entry.kind === 'translation' ? 'translation' : 'wire-shape',
    );
  }
  return candidate;
}

/**
 * Flat Scalar Wire 在重建任何内部对象前先完成整根 exact-keyset、类型、长度、
 * 单位和字符集校验。错误路径只使用公共 Draft 逻辑路径，传输短键不会进入
 * diagnostics。normalized 只在所有键通过后返回，保证全镜头、全口播原子性。
 */
function decodePromptWizardFlatScalarRecord(
  value: unknown,
  layout: PromptWizardFlatScalarLayout,
  segmentCount: number,
  options: {
    sourceLocked?: boolean;
    repairOwnership?: PromptWizardFlatScalarRepairOwnershipProjection;
  } = {},
) {
  if (!isPlainPromptWizardRecord(value)) {
    throwPromptWizardFlatScalarError(
      ['segments'],
      'Flat Scalar Wire 顶层必须是 JSON 对象',
      'wire-shape',
    );
  }
  const expectedKeys = layout.entries.map(entry => entry.key);
  const expectedSet = new Set(expectedKeys);
  const actualKeys = Object.keys(value);
  const extraKey = actualKeys.find(key => !expectedSet.has(key));
  if (extraKey) {
    const hasTranslationKeys = layout.entries.some(entry => entry.kind === 'translation');
    const secondarySource = extraKey === 'voiceoverSlots'
      || extraKey === 'voiceoverText'
      || extraKey === 'voiceoverZh'
      || extraKey === 'voiceoverCharacters'
      || extraKey === 'shots'
      || extraKey === 'segments'
      || /^segment\d+$/u.test(extraKey)
      || (!hasTranslationKeys && /^z\d$/u.test(extraKey));
    throwPromptWizardFlatScalarError(
      promptWizardFlatScalarFallbackLogicalPath(extraKey, segmentCount),
      'Flat Scalar Wire 包含未授权固定键',
      secondarySource ? 'secondary-source' : 'keyset',
    );
  }
  const missingEntry = layout.entries.find(entry => !Object.hasOwn(value, entry.key));
  if (missingEntry || actualKeys.length !== expectedKeys.length) {
    throwPromptWizardFlatScalarError(
      missingEntry?.logicalPath ?? ['segments'],
      'Flat Scalar Wire 必须逐字返回完整固定键集合',
      'keyset',
    );
  }

  // 所有 Provider 原始值都必须先满足根标量的结构合同。所有权投影只允许
  // 忽略非目标字符串的内容，不能掩盖旧容器、null 或其他非字符串 Wire。
  for (const entry of layout.entries) {
    const candidate = value[entry.key];
    if (typeof candidate !== 'string') {
      throwPromptWizardFlatScalarError(
        entry.logicalPath,
        'Flat Scalar Wire 的每个值都必须是字符串',
        'wire-shape',
      );
    }
  }

  const normalized: Record<string, string> = {};
  for (const entry of layout.entries) {
    const providerCandidate = value[entry.key] as string;
    const candidate = options.repairOwnership
      && !options.repairOwnership.providerOwnedKeys.has(entry.key)
      ? options.repairOwnership.canonicalRecord[entry.key]
      : providerCandidate;
    normalized[entry.key] = validatePromptWizardFlatScalarEntryValue(
      entry,
      candidate,
      options,
    );
  }
  return normalized;
}

function promptWizardFlatScalarVoiceovers(
  record: Record<string, string>,
  input: PromptWizardUseDirectionDraftGenerationContext,
  segmentCount: number,
) {
  if (isPromptWizardV6SoundDesignOnly(input)) return undefined;
  const targetLanguage = promptWizardRequiredTargetLanguage(input);
  return Array.from({ length: segmentCount }, (_, segmentIndex) => ({
    voiceover: record[`v${segmentIndex}`]!,
    voiceoverZh: targetLanguage === '普通话'
      ? ''
      : record[`z${segmentIndex}`]!,
  }));
}

function decodePromptWizardFlatScalarCreativePlan(input: {
  value: unknown;
  context: PromptWizardUseDirectionDraftGenerationContext;
  planIndex: PromptWizardPlanIndex;
  segmentCount: number;
  mode: 'creative' | 'recovery';
  repairOwnership?: PromptWizardFlatScalarRepairOwnershipProjection;
}) {
  const layout = createPromptWizardFlatScalarLayout(
    input.context,
    input.segmentCount,
    input.mode,
  );
  const record = decodePromptWizardFlatScalarRecord(
    input.value,
    layout,
    input.segmentCount,
    input.repairOwnership ? { repairOwnership: input.repairOwnership } : {},
  );
  const shots = Array.from({ length: input.segmentCount }, (_, segmentIndex) => (
    Object.fromEntries(PROMPT_WIZARD_FLAT_SCALAR_SHOT_FIELDS.map(definition => ([
      definition.field,
      record[`s${segmentIndex}${definition.keySuffix}`]!,
    ])))
  ));
  const voiceovers = promptWizardFlatScalarVoiceovers(
    record,
    input.context,
    input.segmentCount,
  );
  const draft = decodePromptWizardUseDirectionDraftWirePlan(
    {
      ...(input.mode === 'creative' ? { hook: record.hook! } : {}),
      shots,
    },
    input.context,
    input.planIndex,
    input.segmentCount,
    { compactV2: input.mode === 'recovery' ? 'recovery' : 'initial' },
  );
  if (!voiceovers) return draft;
  return promptWizardPlanDraftSchema.parse({
    ...draft,
    segments: draft.segments.map((segment, segmentIndex) => ({
      ...segment,
      ...voiceovers[segmentIndex]!,
    })),
  });
}

function decodePromptWizardFlatScalarVoiceoverPatch(
  value: unknown,
  input: PromptWizardUseDirectionDraftRepairContext,
  issue: PromptWizardDraftContentRepairIssue,
  segmentCount: number,
  options: {
    sourceLocked?: boolean;
    repairOwnership?: PromptWizardFlatScalarRepairOwnershipProjection;
  } = {},
) {
  const layout = createPromptWizardFlatScalarLayout(input, segmentCount, 'voiceover');
  const record = decodePromptWizardFlatScalarRecord(
    value,
    layout,
    segmentCount,
    options,
  );
  const targetLanguage = promptWizardRequiredTargetLanguage(input);
  const draft = structuredClone(input.previousDrafts[issue.planIndex]!);
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    draft.segments[segmentIndex] = {
      ...draft.segments[segmentIndex]!,
      voiceover: record[`v${segmentIndex}`]!,
      voiceoverZh: targetLanguage === '普通话' ? '' : record[`z${segmentIndex}`]!,
    };
  }
  return promptWizardPlanDraftSchema.parse(draft);
}

function encodePromptWizardFlatScalarDraft(
  draft: PromptWizardPlanDraft,
  input: PromptWizardUseDirectionDraftGenerationContext,
  segmentCount: number,
  mode: PromptWizardFlatScalarMode,
  options: { includedKeys?: ReadonlySet<string> } = {},
) {
  const layout = createPromptWizardFlatScalarLayout(input, segmentCount, mode);
  const values: Record<string, string> = {};
  const includes = (key: string) => !options.includedKeys
    || options.includedKeys.has(key);
  if (mode === 'creative' && includes('hook')) values.hook = draft.hook;
  if (mode !== 'voiceover') {
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const segment = draft.segments[segmentIndex]!;
      for (const definition of PROMPT_WIZARD_FLAT_SCALAR_SHOT_FIELDS) {
        const key = `s${segmentIndex}${definition.keySuffix}`;
        if (includes(key)) values[key] = segment[definition.field];
      }
    }
  }
  if (!isPromptWizardV6SoundDesignOnly(input)) {
    const targetLanguage = promptWizardRequiredTargetLanguage(input);
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const segment = draft.segments[segmentIndex]!;
      const voiceoverKey = `v${segmentIndex}`;
      if (includes(voiceoverKey)) values[voiceoverKey] = segment.voiceover;
      const translationKey = `z${segmentIndex}`;
      if (targetLanguage !== '普通话' && includes(translationKey)) {
        values[translationKey] = segment.voiceoverZh;
      }
    }
  }
  return Object.fromEntries(layout.entries.filter(entry => includes(entry.key)).map(
    entry => [entry.key, values[entry.key]!],
  ));
}

function promptWizardV6RepairFieldPathOwnsFlatScalarEntry(
  issue: PromptWizardDraftContentRepairIssue,
  fieldPath: string,
  entry: PromptWizardFlatScalarLayoutEntry,
) {
  if (entry.kind === 'hook') return fieldPath === 'hook';
  const [root, rawSegmentIndex, rawField] = entry.logicalPath;
  if (
    root !== 'segments'
    || typeof rawSegmentIndex !== 'number'
    || typeof rawField !== 'string'
    || !PROMPT_WIZARD_V6_PROVIDER_OWNED_REPAIR_SEGMENT_FIELDS.has(rawField)
  ) return false;
  const exactPath = `segments[${rawSegmentIndex}].${rawField}`;
  if (fieldPath === exactPath) return true;
  if (
    rawField === 'voiceoverZh'
    && fieldPath === `segments[${rawSegmentIndex}].voiceover`
  ) return true;
  if (
    issue.errorCode === 'PROMPT_WIZARD_USER_REFINEMENT'
    && fieldPath === `segments[${rawSegmentIndex}]`
  ) return true;
  if (fieldPath !== 'segments') return false;
  if (issue.errorCode === 'PROMPT_WIZARD_USER_REFINEMENT') return true;
  const isVoiceover = rawField === 'voiceover' || rawField === 'voiceoverZh';
  return issue.errorCode === 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID'
    ? isVoiceover
    : !isVoiceover;
}

/**
 * V6 内容修复仍返回完整 Flat 根对象，但 Provider 只拥有 repairIssue 指向的
 * 创意键。先用已经严格验证的 previousDraft 只编码同一布局中的非目标键，
 * 再只保留目标键的 Provider 字符串；目标口播即使正因长度错误待修，也不会
 * 被本地截断、填充或伪造 canonical 值。根对象、精确键集和所有原始值的
 * string 类型仍由 decoder 在投影前校验；投影后的完整稿仍经过原有全部门禁。
 */
function promptWizardFlatScalarRepairOwnershipProjection(input: {
  context: PromptWizardUseDirectionDraftRepairContext;
  issue: PromptWizardDraftContentRepairIssue;
  layout: PromptWizardFlatScalarLayout;
  segmentCount: number;
}): PromptWizardFlatScalarRepairOwnershipProjection {
  if (input.layout.mode === 'recovery') {
    throw promptWizardProviderInputError('格式恢复不得使用内容修复所有权投影');
  }
  const entriesByFieldPath = input.issue.fieldPaths.map(fieldPath => (
    input.layout.entries.filter(entry => promptWizardV6RepairFieldPathOwnsFlatScalarEntry(
      input.issue,
      fieldPath,
      entry,
    ))
  ));
  // 合法 refine issue 可同时列出 Provider-owned 与服务端确定性字段；后者
  // 按既有 ownership 白名单安全忽略。只有整个 issue 没有任何可写 Flat 键
  // 时才在外呼前失败，未知/非法路径仍由上游字段路径白名单拒绝。
  const providerOwnedKeys = new Set(entriesByFieldPath.flat().map(entry => entry.key));
  // 一镜口播与其中文译文是同一个语义原子。任一逻辑路径被修复时，必须
  // 同时让 Provider 重写该镜的 vN/zN；普通话布局没有 zN，只拥有 vN。
  for (let segmentIndex = 0; segmentIndex < input.segmentCount; segmentIndex += 1) {
    const voiceoverKey = `v${segmentIndex}`;
    const translationKey = `z${segmentIndex}`;
    if (providerOwnedKeys.has(voiceoverKey) || providerOwnedKeys.has(translationKey)) {
      if (input.layout.entries.some(entry => entry.key === voiceoverKey)) {
        providerOwnedKeys.add(voiceoverKey);
      }
      if (input.layout.entries.some(entry => entry.key === translationKey)) {
        providerOwnedKeys.add(translationKey);
      }
    }
  }
  if (providerOwnedKeys.size === 0) {
    throw promptWizardProviderInputError('V6 内容修复必须至少拥有一个 Flat 标量键');
  }
  const previousDraft = promptWizardValidatedV6RepairPreviousDraft(
    input.context.previousDrafts[input.issue.planIndex],
    input.segmentCount,
  );
  const canonicalRecord = encodePromptWizardFlatScalarDraft(
    previousDraft,
    input.context,
    input.segmentCount,
    input.layout.mode,
    {
      includedKeys: new Set(input.layout.entries.filter(entry => (
        !providerOwnedKeys.has(entry.key)
      )).map(entry => entry.key)),
    },
  );
  const expectedKeys = input.layout.entries.filter(entry => (
    !providerOwnedKeys.has(entry.key)
  )).map(entry => entry.key);
  const actualKeys = Object.keys(canonicalRecord);
  if (
    actualKeys.length !== expectedKeys.length
    || expectedKeys.some(key => !Object.hasOwn(canonicalRecord, key))
    || actualKeys.some(key => !expectedKeys.includes(key))
  ) {
    throw promptWizardProviderInputError('V6 内容修复 previousDraft 的 Flat 键集无效');
  }
  try {
    // previousDraft 的目标字段正是本次待修内容，不能要求它先通过目标门禁；
    // 只对即将回填的非目标规范标量复用同一 value decoder 完整预验。
    for (const entry of input.layout.entries) {
      if (providerOwnedKeys.has(entry.key)) continue;
      validatePromptWizardFlatScalarEntryValue(entry, canonicalRecord[entry.key]);
    }
  } catch {
    throw promptWizardProviderInputError(
      'V6 内容修复 previousDraft 的非目标字段无法形成合法 Flat 标量快照',
    );
  }
  return {
    canonicalRecord,
    providerOwnedKeys,
  };
}

function decodePromptWizardUseDirectionDraftWirePlan(
  value: unknown,
  input: PromptWizardUseDirectionDraftGenerationContext,
  planIndex: PromptWizardPlanIndex,
  segmentCount: number,
  options: { compactV2?: 'initial' | 'recovery' } = {},
) {
  const compactValue = options.compactV2
    ? expandPromptWizardDraftWireV2({
        value,
        input,
        planIndex,
        segmentCount,
        recovery: options.compactV2 === 'recovery',
      })
    : value;
  const fullDraftSlotContract = promptWizardFullDraftSlotContract(
    input,
    segmentCount,
  );
  const plan = fullDraftSlotContract?.format === 'full-plan-indexed-word-slots-v1'
    ? decodePromptWizardFullDraftWordSlots(
        compactValue,
        fullDraftSlotContract,
        segmentCount,
      )
    : fullDraftSlotContract?.format === 'full-plan-indexed-character-arrays-v3'
      ? decodePromptWizardFullDraftCharacterArrays(
          compactValue,
          fullDraftSlotContract,
          segmentCount,
        )
    : fullDraftSlotContract?.format === 'full-plan-indexed-character-strings-v2'
      ? decodePromptWizardFullDraftCharacterStrings(
          compactValue,
          fullDraftSlotContract,
          segmentCount,
        )
    : promptWizardDraftWirePlanSchema.parse(compactValue);
  // V6 会为三个商业角色分别发起单方案请求，因此这里不能再把全局
  // planIndex 当成 planContexts 的数组下标。按显式索引查找既兼容
  // V5 的双方案请求，也兼容 V6 的单方案请求（例如 planIndex=2）。
  const context = promptWizardDraftContextForPlanIndex(input, planIndex);
  const evidence = promptWizardUseDirectionEvidence(input, planIndex).slice(0, 6);
  const evidenceIds = evidence.map(item => item.id);
  const evidenceTexts = evidence.map(item => item.text);
  const roles = promptWizardDraftShotRoles(input);
  if (plan.segments.length !== segmentCount) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ['segments'],
      message: `必须返回 ${segmentCount} 个镜头`,
    }]);
  }
  if (isPromptWizardV6SoundDesignOnly(input)) {
    const voiceoverIssues = plan.segments.flatMap((segment, segmentIndex) => [
      ...(segment.voiceover.trim() ? [{
        code: z.ZodIssueCode.custom,
        path: ['segments', segmentIndex, 'voiceover'],
        message: '5 秒纯视觉分镜的 voiceover 必须为空字符串',
      }] : []),
      ...(segment.voiceoverZh.trim() ? [{
        code: z.ZodIssueCode.custom,
        path: ['segments', segmentIndex, 'voiceoverZh'],
        message: '5 秒纯视觉分镜的 voiceoverZh 必须为空字符串',
      }] : []),
    ]);
    if (voiceoverIssues.length > 0) throw new z.ZodError(voiceoverIssues);
  }
  const perspective = context.useDirection.appearanceMode === 'person'
    ? '真实人物使用视角'
    : context.useDirection.appearanceMode === 'hands-only'
      ? '手部操作视角'
      : '纯产品观察视角';
  const cameraFallback = context.variant === 'reliable'
    ? '持续跟随产品动作，动作完成后缓慢推近核对证据'
    : '第一秒快速推近产品动作，揭晓后横移追踪证据细节';
  const pacingFallback = context.variant === 'reliable'
    ? '按动作顺序自然剪切，保留完整操作过程'
    : '第一秒快速进入动作，证据出现后继续横移并在动作点切换景别';
  const compactDeterministicText = (
    value: string,
    maxLength: number,
    fallback: string,
  ) => options.compactV2
    ? promptWizardBoundedDeterministicDraftText(value, maxLength, fallback)
    : value.trim() || fallback;
  const fallbackAction = (role: ReturnType<typeof promptWizardShotRoles>[number]) => {
    if (role === 'hook') {
      return context.variant === 'reliable'
        ? context.selectedScene.mainAction
        : `第一秒直接${context.selectedScene.mainAction}，镜头沿动作落点横移追踪产品关键部位。`;
    }
    if (role === 'proof' || role === 'proof-resolution') {
      return `${context.useDirection.proofAction}，只验证“${context.useDirection.purchaseReason}”。`;
    }
    if (role === 'resolution') {
      return `在${context.selectedScene.environment}继续呈现前段动作结果，镜头横移追踪产品证据。`;
    }
    return `镜头缓慢后拉展示产品的真实使用状态，以直接购买行动回扣${context.useDirection.audienceNeed}。`;
  };
  return promptWizardPlanDraftSchema.parse({
    name: plan.name.trim(),
    hook: plan.hook.trim(),
    narrative: plan.narrative.trim(),
    primaryScene: promptWizardBoundedDeterministicDraftText(
      `${context.selectedScene.title}：${context.selectedScene.environment}`,
      300,
      context.selectedScene.title,
    ),
    cameraAndPacing: plan.cameraAndPacing.trim() || cameraFallback,
    differenceTags: normalizePromptWizardDifferenceTags(
      plan.differenceTags,
      context.variant === 'reliable'
        ? ['持续动作演示', '直接证据自证']
        : ['第一秒状态揭晓', '动态近景视角'],
    ),
    planningReview: {
      targetAudience: compactDeterministicText(
        plan.planningReview.targetAudience.trim()
          || input.profile.suggestedAudience,
        240,
        '正在判断产品是否适合当前使用场景的用户',
      ),
      surfaceNeed: promptWizardBoundedDeterministicDraftText(
        context.useDirection.audienceNeed,
        240,
        '希望判断当前商品是否适合真实使用需要',
      ),
      realPainPoint: compactDeterministicText(
        plan.planningReview.realPainPoint,
        300,
        `需要通过真实动作判断“${context.useDirection.purchaseReason}”是否满足当前需要`,
      ),
      nonAdEntry: compactDeterministicText(
        plan.planningReview.nonAdEntry,
        300,
        plan.hook,
      ),
      proofPoints: evidenceTexts.map(text => (
        isPromptWizardV6DraftContext(input)
          ? promptWizardCanonicalDeterministicDraftText(text)
          : promptWizardBoundedDeterministicDraftText(text, 300, '锁定可见证据')
      )),
      directionFit: compactDeterministicText(
        plan.planningReview.directionFit,
        300,
        `围绕“${context.useDirection.title}”在“${context.selectedScene.title}”完成产品自证。`,
      ),
    },
    segments: plan.segments.map((segment, segmentIndex) => {
      const role = roles[segmentIndex]!;
      return {
        role,
        location: compactDeterministicText(
          segment.location,
          180,
          context.selectedScene.environment,
        ),
        subject: compactDeterministicText(
          segment.subject,
          180,
          `${perspective}中的 @图片1 对应${input.profile.category}`,
        ),
        shotSize: segment.shotSize.trim() || (segmentIndex === 0 ? '中近景' : '产品特写'),
        action: segment.action.trim() || fallbackAction(role),
        cameraMovement: segment.cameraMovement.trim() || cameraFallback,
        lightingAndRealism: segment.lightingAndRealism.trim()
          || '自然光与真实环境质感，产品外观严格参考 @图片1',
        voiceover: segment.voiceover.trim(),
        voiceoverZh: segment.voiceoverZh.trim(),
        foley: segment.foley.trim() || fakeFoleyForRole(role),
        editingCue: segment.editingCue.trim() || pacingFallback,
        evidenceRefs: role === 'hook' ? evidenceIds.slice(0, 1) : evidenceIds,
        productionNote: segment.productionNote.trim(),
      };
    }),
    productionWarnings: promptWizardDeterministicProductionWarnings(input.profile),
  });
}

function expandPromptWizardDraftWireV2(input: {
  value: unknown;
  input: PromptWizardUseDirectionDraftGenerationContext;
  planIndex: PromptWizardPlanIndex;
  segmentCount: number;
  recovery: boolean;
}) {
  if (!isPromptWizardV6DraftContext(input.input)) {
    throw promptWizardProviderInputError('紧凑 Draft Wire V2 只允许用于 V6');
  }
  if (isPlainPromptWizardRecord(input.value) && Array.isArray(input.value.shots)) {
    const secondSourceIndex = input.value.shots.findIndex(shot => (
      isPlainPromptWizardRecord(shot)
      && (Object.hasOwn(shot, 'voiceover') || Object.hasOwn(shot, 'voiceoverZh'))
    ));
    if (secondSourceIndex >= 0) {
      const shot = input.value.shots[secondSourceIndex] as Record<string, unknown>;
      const field = Object.hasOwn(shot, 'voiceoverZh') ? 'voiceoverZh' : 'voiceover';
      throw markPromptWizardOutputSchemaIssue(new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: ['segments', secondSourceIndex, field],
        message: '紧凑 Draft Wire V2 不得在 shots 中返回第二口播来源',
      }]), 'secondary-source');
    }
  }
  const wireResult = input.recovery
    ? promptWizardDraftRecoveryWireV2Schema.safeParse(input.value)
    : promptWizardDraftWireV2Schema.safeParse(input.value);
  if (!wireResult.success) {
    throw markPromptWizardOutputSchemaIssue(wireResult.error, 'wire-shape');
  }
  const wire = wireResult.data;
  if (wire.shots.length !== input.segmentCount) {
    throw markPromptWizardOutputSchemaIssue(new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ['shots'],
      message: `必须返回 ${input.segmentCount} 个镜头`,
    }]), 'count');
  }
  const context = promptWizardDraftContextForPlanIndex(input.input, input.planIndex);
  if (!('routeRole' in context)) {
    throw promptWizardProviderInputError('紧凑 Draft Wire V2 缺少 V6 锁定路线');
  }
  const roles = promptWizardDraftShotRoles(input.input);
  const perspective = context.useDirection.appearanceMode === 'person'
    ? '真实人物使用视角'
    : context.useDirection.appearanceMode === 'hands-only'
      ? '手部操作视角'
      : '纯产品观察视角';
  const routeTags: Record<PromptWizardRouteRole, [string, string]> = {
    'proof-conversion': ['产品自证', '证据演示'],
    'problem-hook': ['痛点钩子', '反差揭晓'],
    'lifestyle-seeding': ['场景种草', '自然转化'],
  };
  const routeRole = context.routeRole;
  const compactCategory = promptWizardBoundedDeterministicDraftText(
    input.input.profile.category,
    96,
    '当前商品',
  );
  const routeNames: Record<PromptWizardRouteRole, string> = {
    'proof-conversion': `${context.useDirection.title} · 产品自证`,
    'problem-hook': `${context.useDirection.title} · 痛点解法`,
    'lifestyle-seeding': `${context.useDirection.title} · 场景种草`,
  };
  const routeNarratives: Record<PromptWizardRouteRole, string> = {
    'proof-conversion': `围绕“${context.useDirection.purchaseReason}”，在“${context.selectedScene.title}”以唯一锁定商品动作完成产品自证。`,
    'problem-hook': `从“${context.useDirection.audienceNeed}”切入，在“${context.selectedScene.title}”用唯一锁定商品动作展示可见证据与解法。`,
    'lifestyle-seeding': `把唯一锁定商品动作放进“${context.useDirection.useMoment}”，只用可见证据说明“${context.useDirection.purchaseReason}”。`,
  };
  const routeCameraAndPacing: Record<PromptWizardRouteRole, string> = {
    'proof-conversion': '持续跟随唯一商品动作，证据出现后缓慢推近，并在动作完成点自然剪切。',
    'problem-hook': '第一秒快速推近动作落点，以近景揭晓问题与证据，随后持续横移并在动作点快切。',
    'lifestyle-seeding': '以自然生活节奏跟随唯一商品动作，在场景动作点切换景别，并平稳收束到可见证据。',
  };
  const hook = input.recovery
    ? context.lockedHookZh
    : (wire as PromptWizardDraftWireV2).hook;
  const name = promptWizardBoundedDeterministicDraftText(
    routeNames[routeRole],
    80,
    '锁定路线方案',
  );
  const narrative = promptWizardBoundedDeterministicDraftText(
    routeNarratives[routeRole],
    500,
    '围绕锁定购买理由，以唯一商品动作完成产品自证。',
  );
  const cameraAndPacing = promptWizardBoundedDeterministicDraftText(
    routeCameraAndPacing[routeRole],
    500,
    '持续跟随唯一商品动作，并在动作点自然剪切。',
  );
  const candidate: Record<string, unknown> = {
    name,
    hook,
    narrative,
    primaryScene: '',
    cameraAndPacing,
    differenceTags: routeTags[routeRole],
    planningReview: {
      targetAudience: input.input.profile.suggestedAudience
        || '正在判断产品是否适合当前使用场景的用户',
      surfaceNeed: context.useDirection.audienceNeed,
      realPainPoint: `需要通过真实动作判断“${context.useDirection.purchaseReason}”是否满足当前需要`,
      nonAdEntry: hook,
      directionFit: `围绕“${context.useDirection.title}”在“${context.selectedScene.title}”完成产品自证。`,
    },
    segments: wire.shots.map((shot, segmentIndex) => ({
      role: roles[segmentIndex] ?? '',
      location: context.selectedScene.environment,
      subject: `${perspective}中的 @图片1 对应${compactCategory || '当前商品'}`,
      shotSize: shot.shotSize,
      action: shot.action,
      cameraMovement: shot.cameraMovement,
      lightingAndRealism: shot.lightingAndRealism,
      voiceover: '',
      voiceoverZh: '',
      foley: shot.foley,
      editingCue: shot.editingCue,
      productionNote: promptWizardBoundedDeterministicDraftText(
        `镜头${segmentIndex + 1}沿用锁定场景与同一商品动作，保持 @图片1 产品外观连续。`,
        240,
        '',
      ),
    })),
    productionWarnings: [],
  };
  if ('voiceoverSlots' in wire && wire.voiceoverSlots !== undefined) {
    candidate.voiceoverSlots = wire.voiceoverSlots;
  }
  return candidate;
}

/** Zod 上限按 UTF-16 码元计算；逐码点截断可避免切开代理对。 */
function promptWizardCanonicalDeterministicDraftText(value: string) {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function promptWizardBoundedDeterministicDraftText(
  value: string,
  maxLength: number,
  fallback: string,
) {
  const normalized = promptWizardCanonicalDeterministicDraftText(value)
    || promptWizardCanonicalDeterministicDraftText(fallback);
  let result = '';
  for (const character of normalized) {
    if (result.length + character.length > maxLength) break;
    result += character;
  }
  return result.trim();
}

function promptWizardDeterministicProductionWarnings(profile: PromptWizardProductProfile) {
  return [
    profile.logo.trim()
      ? '产品结构、Logo 与印花必须严格保持参考图片中的原始位置、比例和外观。'
      : '产品结构与外观必须严格保持参考图片中的原始位置、比例和形态。',
    '产品或手部持续运动时，避免遮挡用于自证的关键可见区域。',
  ];
}

type PromptWizardArkUseDirectionDraftRuntime = {
  responses: PromptWizardResponsesClient;
  requestRecorder: PromptWizardProviderRequestRecorder;
  model: string;
};

/**
 * 普通话 Array V3 请求不携带旧字符字符串协议的字段名或格式名。
 * 通用指令仍需服务日语、泰语的 V2 翻译契约，因此只在当前请求已由
 * outputContract 明确锁定为 V3 时移除那些互斥段落，再附加完整 V3 硬约束。
 */
function promptWizardMandarinCharacterArrayV3Instructions(base: string) {
  const withoutLegacyCharacterStringProtocol = base
    .split('\n')
    .filter(line => (
      !line.includes('voiceoverText')
      && !line.includes('character-strings-v2')
    ))
    .join('\n')
    .trim();
  return `${withoutLegacyCharacterStringProtocol}
普通话 Array V3 唯一口播结构：严格返回 JSON Schema 列出的 segment0、segment1…。每个 segmentN 直接是 exactCharacterCount 长度的 JSON 字符串数组，每项恰好一个无需 NFKC 变换的可朗读汉字、字母或数字。禁止对象包装、译文字段、第二口播来源、空项、多字符项、标点、空白、控制符、零宽符、Emoji、占位符和统计字段。服务端只在全部数组同时通过后原子拼接。`;
}

function promptWizardFlatScalarSystemInstruction(
  mode: PromptWizardFlatScalarMode,
  operation: 'generate-drafts' | 'repair-draft-format' | 'repair-draft-content' | 'refine-plan',
) {
  const operationRule = operation === 'generate-drafts'
    ? '这是当前锁定路线的首稿。'
    : operation === 'repair-draft-format'
      ? '这是一次 JSON 格式恢复；输入没有上一轮正文、片段或动态错误，不得猜测它们。'
      : operation === 'refine-plan'
        ? '这是用户主动微调；只改变 repairIssue 允许的创意逻辑字段。'
        : '这是一次定向修复；只改变 repairIssue 允许的创意逻辑字段。';
  const modeRule = mode === 'creative'
    ? '必须返回 hook、全部镜头创意键和全部口播键。'
    : mode === 'recovery'
      ? '必须返回全部镜头创意键和全部口播键，严格禁止 hook；Hook 只由服务端从 lockedHookZh 原样补齐。'
      : '只返回全部口播键，严格禁止 hook 和镜头键。';
  return `${SEEDANCE_TIKTOK_SHOP_STORYBOARD_ROLE}
你只负责把输入中已经锁定的产品、商业路线、场景、唯一购买理由、可靠证据、出镜方式、动作预算、镜头职责、视频配置和口播时间写入一个 Flat Scalar JSON 响应。不得重选路线、改变事实或增加产品能力、人物、地点、包装、道具、动作、价格、功效、认证、评价、稀缺性或竞品结论。
${operationRule}${modeRule}
输出协议唯一为 ${PROMPT_WIZARD_FLAT_SCALAR_FORMAT}：只输出一个根 JSON 对象；根对象每个值都必须是 JSON 字符串。禁止任何数组、嵌套对象、null、数字、布尔值、旧 Draft、旧 Wire、槽包装、统计字段和第二份口播来源。
properties 与 required 必须逐字等于输入 outputWire.requiredKeys，不能缺键、多键、改键或增加解释。逐键语义只以 outputWire.keyMap 为准：镜头键使用简体中文；每个 vN 返回对应镜头的一条完整自然口播句，允许目标语言自然标点、词间空格、数字和品牌名；非普通话同时用 zN 返回忠实简体中文译文，普通话严禁 zN。根据 voiceoverTiming 的对应起止时间使用快速但清晰的自然口播，并自行复核能在本镜内讲完；若预计讲不完，必须整句重写得更简洁。服务端不提供语言语速、字词数量或时长估算；不得机械截断、跨镜借时、填充、拆槽或返回旧 vNPP/voiceoverSlots。
全片只允许 majorActionPlan 锁定的动作族，resolution 与 CTA 不得新增产品动作。10/15 秒前三秒口播必须明确产品名称或品类，末段必须直接引导点击商品卡、查看商品或立即下单；5 秒纯视觉不得返回任何口播键、对白、旁白、字幕、价格、按钮、商品卡或平台 UI。
${mode === 'voiceover' ? '' : '必须逐条遵守输入 flatProductionRules：全片运镜种类不得超过 executionBudget.maxCameraMoveCount；每个 sNEditingCue 都必须明确包含“动作点快切”或“节奏剪辑”；CTA 或 5 秒末镜不得做静态尾卡，必须在商品、手部或镜头仍在运动时收尾。'}
只输出可由标准 JSON.parse 原生解析且符合 JSON Schema 的根对象，不输出 Markdown、代码围栏、注释、前后解释或其他字符。`;
}

async function runArkPromptWizardUseDirectionDraftPlan(input: {
  runtime: PromptWizardArkUseDirectionDraftRuntime;
  context: PromptWizardUseDirectionDraftGenerationContext;
  planIndex: PromptWizardPlanIndex;
  operation: 'generate-drafts' | 'repair-draft-format' | 'repair-draft-content' | 'refine-plan';
  repair?: {
    input: PromptWizardUseDirectionDraftRepairContext;
    issue: PromptWizardDraftContentRepairIssue;
  };
  schemaCandidateRepair?: {
    candidate: Record<string, unknown>;
    issue: PromptWizardDraftContentRepairIssue;
  };
  /** 仅用于安全审计格式恢复的上一轮失败，不会进入 Provider 请求。 */
  formatRepairCause?: unknown;
  deadlineAtMs: number;
}) {
  const segmentCount = expectedPromptWizardDraftSegmentCount(input.context);
  const repairInput = input.repair?.input;
  const repairIssue = input.repair?.issue ?? input.schemaCandidateRepair?.issue;
  const operation = input.operation;
  const soundDesignOnly = isPromptWizardV6SoundDesignOnly(input.context);
  const fullDraftSlotContract = promptWizardFullDraftSlotContract(
    input.context,
    segmentCount,
  );
  // JSON 格式恢复必须始终优先使用完整的紧凑 Recovery Wire V2。
  // 口播专项 patch 只用于首次内容修复；它的非法 JSON 不能再用同形 patch
  // Schema 重试，否则会放大同一结构失败并绕过统一格式异常诊断。
  const voiceoverOnlyRepair = input.operation !== 'repair-draft-format' && Boolean(
    !soundDesignOnly
    && repairInput
    && repairIssue
    && isPromptWizardVoiceoverOnlyRepairIssue(repairIssue),
  );
  const compactWireV2 = !voiceoverOnlyRepair
    && (
      operation === 'generate-drafts'
      || operation === 'repair-draft-format'
      || Boolean(input.schemaCandidateRepair)
    )
    && usesPromptWizardCompactDraftWireV2(input.context, segmentCount);
  const flatMode: PromptWizardFlatScalarMode | null = isPromptWizardV6DraftContext(input.context)
    ? operation === 'repair-draft-format'
      ? 'recovery'
      : voiceoverOnlyRepair
        ? 'voiceover'
        : 'creative'
    : null;
  const flatLayout = flatMode
    ? createPromptWizardFlatScalarLayout(input.context, segmentCount, flatMode)
    : null;
  const flatRepairOwnership = flatLayout
    && repairInput
    && repairIssue
    && (operation === 'repair-draft-content' || operation === 'refine-plan')
    ? promptWizardFlatScalarRepairOwnershipProjection({
        context: repairInput,
        issue: repairIssue,
        layout: flatLayout,
        segmentCount,
      })
    : undefined;
  const baseRequestInput = voiceoverOnlyRepair
    ? buildPromptWizardUseDirectionVoiceoverRepairInput(
      repairInput!,
      repairIssue!,
      segmentCount,
    )
    : operation === 'generate-drafts'
    ? buildPromptWizardUseDirectionDraftInput(input.context, input.planIndex, segmentCount)
    : operation === 'repair-draft-format'
      ? buildPromptWizardUseDirectionDraftFormatRepairInput(
        input.context,
        input.planIndex,
        segmentCount,
        input.repair,
      )
      : repairInput && repairIssue
        ? buildPromptWizardUseDirectionDraftRepairInput(repairInput, repairIssue, segmentCount)
        : (() => {
          const base = JSON.parse(buildPromptWizardUseDirectionDraftInput(
            input.context,
            input.planIndex,
            segmentCount,
          )) as Record<string, unknown>;
          const schemaRepairFieldMapping = [
            { logicalPlanPath: 'hook', outputWirePath: 'hook' },
            { logicalPlanPath: 'segments', outputWirePath: 'shots' },
            ...Array.from({ length: segmentCount }, (_, segmentIndex) => (
              [
                'shotSize', 'action', 'cameraMovement', 'lightingAndRealism',
                'foley', 'editingCue',
              ].map(field => ({
                logicalPlanPath: `segments[${segmentIndex}].${field}`,
                outputWirePath: `shots[${segmentIndex}].${field}`,
              }))
            )).flat(),
            ...(fullDraftSlotContract
              ? fullDraftSlotContract.segments.map(segment => ({
                logicalVoiceoverPath: `segments[${segment.segmentIndex}].voiceover`,
                logicalTranslationPath: `segments[${segment.segmentIndex}].voiceoverZh`,
                outputVoiceoverPath: fullDraftSlotContract.format
                  === 'full-plan-indexed-word-slots-v1'
                  ? `voiceoverSlots.${segment.property}.voiceoverWords`
                  : fullDraftSlotContract.format
                    === 'full-plan-indexed-character-arrays-v3'
                    ? `voiceoverSlots.${segment.property}`
                    : `voiceoverSlots.${segment.property}.voiceoverText`,
                ...(fullDraftSlotContract.format === 'full-plan-indexed-word-slots-v1'
                  || fullDraftSlotContract.format
                    === 'full-plan-indexed-character-strings-v2'
                  ? {
                      outputTranslationPath: `voiceoverSlots.${segment.property}.voiceoverZh`,
                    }
                  : {
                      outputTranslationAction: fullDraftSlotContract.format
                        === 'full-plan-indexed-character-arrays-v3'
                        ? `voiceoverSlots.${segment.property} 必须保持直接单字符数组且不得返回译文字段；segments[${segment.segmentIndex}].voiceoverZh 由服务端保持为空字符串`
                        : `删除 voiceoverSlots.${segment.property}.voiceoverZh，并保持 segments[${segment.segmentIndex}].voiceoverZh 为空字符串`,
                    }),
              }))
              : []),
          ];
          return JSON.stringify({
            ...base,
            task: '只修复当前紧凑 Draft Wire V2 的结构问题，并返回完整紧凑 Wire',
            previousWireCandidate: sanitizePromptWizardPreviousDrafts([
              input.schemaCandidateRepair!.candidate,
            ])[0],
            repairIssue,
            schemaRepairFieldMapping,
            repairPolicy: [
              '只修改 repairIssue 指向的字段，其他内容保持不变',
              '不得改变使用方向、场景、variant、唯一购买理由、证据、视频配置或目标语言',
              'repairIssue.fieldPaths 为安全诊断使用的逻辑计划路径，不是本次传输结构的输出路径；必须按 schemaRepairFieldMapping 映射到 hook、shots 或 voiceoverSlots 后完成修复',
              ...(fullDraftSlotContract ? [
                fullDraftSlotContract?.format === 'full-plan-indexed-word-slots-v1'
                  ? '逻辑 voiceover 路径只允许修改对应 voiceoverWords，逻辑 voiceoverZh 路径只允许修改对应 voiceoverZh；不得返回 shots 内口播或第二口播来源'
                  : fullDraftSlotContract?.format === 'full-plan-indexed-character-arrays-v3'
                    ? '逻辑 voiceover 路径只允许修改对应 segmentN 单字符数组；逻辑 voiceoverZh 路径表示保持服务端空译文，不得返回对象包装、译文字段或第二口播来源'
                    : '逻辑 voiceover 路径只允许修改对应 voiceoverText，逻辑 voiceoverZh 路径只允许修改对应忠实简体中文译文；不得返回 shots 内口播或第二口播来源',
                fullDraftSlotContract?.format === 'full-plan-indexed-word-slots-v1'
                  ? '无论 repairIssue 只列出哪个口播逻辑路径，完整响应的所有 voiceoverSlots.segmentN 都必须继续满足 outputContract 的固定键、exactWordCount 和单词槽规则'
                  : fullDraftSlotContract?.format === 'full-plan-indexed-character-arrays-v3'
                    ? '无论 repairIssue 只列出哪个口播逻辑路径，完整响应的所有 voiceoverSlots.segmentN 都必须继续直接返回 exactCharacterCount 个合法单字符数组元素'
                  : '无论 repairIssue 只列出哪个口播逻辑路径，完整响应的所有 voiceoverSlots.segmentN 都必须继续满足 outputContract 的固定键、exactCharacterCount、定长字符串与非空忠实中文译文规则',
              ] : []),
              '不得引入 Concept 或七轴策略；严格按 outputWire 返回单个完整紧凑原生 JSON 对象',
            ],
          });
        })();
  const requestInput = flatLayout
    ? buildPromptWizardFlatScalarRequestInput(baseRequestInput, flatLayout)
    : baseRequestInput;
  const baseInstructions = voiceoverOnlyRepair
    ? USE_DIRECTION_PLAN_VOICEOVER_REPAIR_SYSTEM_INSTRUCTION
    : compactWireV2 && operation === 'generate-drafts'
      ? USE_DIRECTION_PLAN_COMPACT_GENERATION_SYSTEM_INSTRUCTION
    : compactWireV2 && operation === 'repair-draft-format'
      ? USE_DIRECTION_PLAN_COMPACT_FORMAT_REPAIR_SYSTEM_INSTRUCTION
    : compactWireV2 && input.schemaCandidateRepair
      ? USE_DIRECTION_PLAN_COMPACT_SCHEMA_REPAIR_SYSTEM_INSTRUCTION
    : soundDesignOnly
      ? operation === 'generate-drafts'
        ? USE_DIRECTION_PLAN_SOUND_DESIGN_SYSTEM_INSTRUCTION
        : operation === 'repair-draft-format'
          ? USE_DIRECTION_PLAN_SOUND_DESIGN_FORMAT_REPAIR_SYSTEM_INSTRUCTION
          : USE_DIRECTION_PLAN_SOUND_DESIGN_CONTENT_REPAIR_SYSTEM_INSTRUCTION
    : operation === 'generate-drafts'
    ? USE_DIRECTION_PLAN_GENERATION_SYSTEM_INSTRUCTION
    : operation === 'repair-draft-format'
      ? USE_DIRECTION_PLAN_FORMAT_REPAIR_SYSTEM_INSTRUCTION
      : operation === 'refine-plan'
        ? USE_DIRECTION_PLAN_REFINEMENT_SYSTEM_INSTRUCTION
        : USE_DIRECTION_PLAN_CONTENT_REPAIR_SYSTEM_INSTRUCTION;
  const instructions = flatLayout
    ? promptWizardFlatScalarSystemInstruction(flatLayout.mode, operation)
    : fullDraftSlotContract?.format === 'full-plan-indexed-character-arrays-v3'
      ? promptWizardMandarinCharacterArrayV3Instructions(baseInstructions)
      : baseInstructions;
  const result = await runArkPromptWizardOperation(
    operation,
    attemptTimeoutMs => {
      // 放在真实 Provider 请求闭包内：成本账本或预算预检失败时不误记，
      // 而 maxRetries=0 保证每次 repair-draft-format 外呼恰好一条触发日志。
      if (operation === 'repair-draft-format') {
        logPromptWizardDraftFormatRepairTriggered(
          input.planIndex,
          input.formatRepairCause,
        );
      }
      return input.runtime.responses.create(buildArkPromptWizardRequest({
        model: input.runtime.model,
        instructions,
        input: requestInput,
        maxOutputTokens: PROMPT_WIZARD_DRAFT_MAX_OUTPUT_TOKENS,
        schemaName: `prompt_wizard_use_direction_plan_${input.planIndex + 1}_${operation.replaceAll('-', '_')}`,
        schema: flatLayout
          ? createPromptWizardFlatScalarJsonSchema(flatLayout)
          : voiceoverOnlyRepair
          ? createVoiceoverRepairJsonSchema(repairInput!, segmentCount)
          : compactWireV2
            ? createPromptWizardDraftWireV2JsonSchema(
                input.context,
                segmentCount,
                operation === 'repair-draft-format',
              )
            : createDraftPlanJsonSchema({
              soundDesignOnly,
              slotContract: fullDraftSlotContract,
            }),
        thinking: 'disabled',
      }), { timeoutMs: attemptTimeoutMs });
    },
    operation === 'repair-draft-format'
      ? promptWizardDraftFormatRepairRetryPolicy(input.deadlineAtMs)
      : operation === 'generate-drafts'
        ? promptWizardRetryPolicy(input.deadlineAtMs)
        : promptWizardDraftContentRepairRetryPolicy(input.deadlineAtMs),
    input.context.costOwner ? {
      owner: operation === 'repair-draft-content'
        ? { ...input.context.costOwner, repairRound: Math.max(1, input.context.costOwner.repairRound) }
        : input.context.costOwner,
      planIndex: input.planIndex,
      model: input.runtime.model,
      serviceTier: PROMPT_WIZARD_SERVICE_TIER,
      recorder: input.runtime.requestRecorder,
    } : undefined,
  );
  const response = result.value;
  const usage = arkResponseUsage(response, result.attempts);
  let candidate: unknown;
  let outputParseState: PromptWizardDraftJsonParseState | undefined;
  const diagnoseOutput = isPromptWizardV6DraftContext(input.context);
  try {
    if (diagnoseOutput) {
      const parsed = flatLayout
        ? parsePromptWizardFlatScalarJson(response.output_text)
        : parsePromptWizardDraftJsonV2(response.output_text);
      candidate = parsed.value;
      outputParseState = parsed;
    } else {
      candidate = parseProviderJson(response.output_text);
    }
    const draft = flatLayout?.mode === 'voiceover'
      ? decodePromptWizardFlatScalarVoiceoverPatch(
        candidate,
        repairInput!,
        repairIssue!,
        segmentCount,
        {
          ...(flatRepairOwnership ? { repairOwnership: flatRepairOwnership } : {}),
        },
      )
      : voiceoverOnlyRepair
        ? decodePromptWizardVoiceoverRepairPatch(
            candidate,
            repairInput!,
            repairIssue!,
            segmentCount,
            {},
          )
        : flatLayout
          ? decodePromptWizardFlatScalarCreativePlan({
              value: candidate,
              context: input.context,
              planIndex: input.planIndex,
              segmentCount,
              mode: flatLayout.mode === 'recovery' ? 'recovery' : 'creative',
              ...(flatRepairOwnership ? { repairOwnership: flatRepairOwnership } : {}),
            })
          : decodePromptWizardUseDirectionDraftWirePlan(
        candidate,
        input.context,
        input.planIndex,
        segmentCount,
        compactWireV2 ? {
          compactV2: operation === 'repair-draft-format' ? 'recovery' : 'initial',
        } as const : {},
      );
    return {
      planIndex: input.planIndex,
      draft,
      usage,
      ...(diagnoseOutput ? {
        outputDiagnostics: [buildPromptWizardOutputDiagnostic({
          planIndex: input.planIndex,
          operation,
          response,
          phase: 'decoded',
          parseResult: outputParseState,
        })],
      } : {}),
    };
  } catch (error) {
    const safeError = diagnoseOutput
      ? sanitizePromptWizardV6DraftPostprocessError(error)
      : error;
    logPromptWizardProviderPostprocessFailure(operation, response, safeError, []);
    const attached = attachPromptWizardSinglePlanFailureUsage(safeError, usage);
    if (diagnoseOutput) {
      Object.assign(attached, {
        outputDiagnostics: [buildPromptWizardOutputDiagnostic({
          planIndex: input.planIndex,
          operation,
          response,
          phase: promptWizardProviderErrorMetadata(safeError).errorCode
              === 'PROMPT_WIZARD_PROVIDER_INVALID_JSON'
            || promptWizardProviderErrorMetadata(safeError).errorCode
              === 'PROMPT_WIZARD_PROVIDER_EMPTY'
            ? 'parse'
            : 'schema',
          parseResult: outputParseState,
          error: safeError,
        })],
      });
    }
    if (
      promptWizardProviderErrorMetadata(attached).errorCode
        === 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID'
      && isPlainPromptWizardRecord(candidate)
    ) {
      Object.defineProperty(attached, 'recoverableDraftCandidate', {
        value: candidate,
        enumerable: false,
      });
    }
    throw attached;
  }
}

async function generateArkPromptWizardUseDirectionDrafts(input: (
  PromptWizardArkUseDirectionDraftRuntime & {
    input: PromptWizardUseDirectionDraftGenerationContext;
  }
)): Promise<PromptWizardDraftResult> {
  validatePromptWizardUseDirectionDraftContext(input.input);
  const runtime = {
    responses: input.responses,
    requestRecorder: input.requestRecorder,
    model: input.model,
  };
  const deadlineAtMs = input.input.deadlineAtMs
    ?? Date.now() + env.PROMPT_WIZARD_REQUEST_BUDGET_MS;
  type Completed = Awaited<ReturnType<typeof runArkPromptWizardUseDirectionDraftPlan>>;
  type Settled = {
    planIndex: PromptWizardPlanIndex;
    result: PromiseSettledResult<Completed>;
  };
  const planIndexes = input.input.planContexts.map(context => context.planIndex);
  const initialResults = await Promise.allSettled(planIndexes.map(planIndex => (
    runArkPromptWizardUseDirectionDraftPlan({
      runtime,
      context: input.input,
      planIndex,
      operation: 'generate-drafts',
      deadlineAtMs,
    })
  )));
  const initial: Settled[] = planIndexes.map((planIndex, index) => ({
    planIndex,
    result: initialResults[index]!,
  }));
  const accounting: Settled[] = [...initial];
  const completed = new Map<PromptWizardPlanIndex, Completed>(initial.flatMap(entry => (
    entry.result.status === 'fulfilled' ? [[entry.planIndex, entry.result.value]] : []
  )));
  const failures = initial.filter((entry): entry is Settled & { result: PromiseRejectedResult } => (
    entry.result.status === 'rejected'
  ));
  const repairs = failures.map((failure) => {
    const errorCode = promptWizardProviderErrorMetadata(failure.result.reason).errorCode;
    if (errorCode === 'PROMPT_WIZARD_PROVIDER_INVALID_JSON') {
      return { failure, operation: 'repair-draft-format' as const };
    }
    const schemaRepair = promptWizardInitialDraftSchemaRepair(
      failure.planIndex,
      failure.result.reason,
    );
    if (schemaRepair) {
      return {
        failure,
        operation: 'repair-draft-content' as const,
        schemaRepair,
      };
    }
    return null;
  });
  const initialContentRepairRounds = repairs.some(repair => (
    repair?.operation === 'repair-draft-content'
  )) ? 1 : 0;
  const repairDiagnostics: PromptWizardRepairDiagnostic[] = repairs.flatMap(repair => (
    repair?.operation === 'repair-draft-content' && repair.schemaRepair
      ? [{
          planIndex: repair.failure.planIndex,
          origin: 'initial-schema' as const,
          repairRound: 1 as const,
          errorCode: repair.schemaRepair.issue.errorCode,
          fieldPaths: [...repair.schemaRepair.issue.fieldPaths],
        }]
      : []
  ));
  const terminal = repairs.findIndex(repair => repair === null);
  if (terminal >= 0) throwPromptWizardPlanFailure(failures[terminal]!, accounting);
  if (repairs.length > 0) {
    if (deadlineAtMs - Date.now() < PROMPT_WIZARD_MIN_DRAFT_FORMAT_REPAIR_BUDGET_MS) {
      throwPromptWizardPlanFailure(failures[0]!, accounting);
    }
    const repairResults = await Promise.allSettled(repairs.map((repair) => (
      runArkPromptWizardUseDirectionDraftPlan({
        runtime,
        context: input.input,
        planIndex: repair!.failure.planIndex,
        operation: repair!.operation,
        ...(repair!.operation === 'repair-draft-format'
          ? { formatRepairCause: repair!.failure.result.reason }
          : {}),
        ...(repair!.schemaRepair ? { schemaCandidateRepair: repair!.schemaRepair } : {}),
        deadlineAtMs,
      })
    )));
    const repaired: Settled[] = repairs.map((repair, index) => ({
      planIndex: repair!.failure.planIndex,
      result: repairResults[index]!,
    }));
    accounting.push(...repaired);
    const failedRepair = repaired.find((entry): entry is Settled & { result: PromiseRejectedResult } => (
      entry.result.status === 'rejected'
    ));
    if (failedRepair) {
      throwPromptWizardPlanFailure(
        failedRepair,
        accounting,
        initialContentRepairRounds,
        repairDiagnostics,
      );
    }
    repaired.forEach(entry => {
      if (entry.result.status === 'fulfilled') completed.set(entry.planIndex, entry.result.value);
    });
  }
  const ordered = planIndexes.map(planIndex => completed.get(planIndex));
  if (ordered.some(item => !item)) {
    throw Object.assign(new Error('提示词模型没有返回完整的使用方向方案'), {
      code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
    });
  }
  const orderedDrafts = ordered.map(item => item!.draft);
  const drafts = orderedDrafts.length === 1
    ? orderedDrafts.map(draft => promptWizardPlanDraftSchema.parse(draft))
    : promptWizardPlanDraftBatchSchema.parse({ plans: orderedDrafts }).plans;
  const outputDiagnostics = accounting.flatMap(
    promptWizardOutputDiagnosticsFromSettledPlan,
  );
  const formatRecoveryRequestCount = repairs.filter(repair => (
    repair?.operation === 'repair-draft-format'
  )).length;
  return {
    drafts,
    usage: mergePromptWizardProviderUsage(accounting.flatMap(promptWizardUsageFromSettledPlan)),
    repairRounds: initialContentRepairRounds,
    repairDiagnostics,
    outputDiagnostics,
    formatRepairCount: isPromptWizardV6DraftContext(input.input)
      ? countPromptWizardFormatAnomalies(outputDiagnostics)
      : formatRecoveryRequestCount,
    formatRecoveryRequestCount,
  };
}

async function repairArkPromptWizardUseDirectionDrafts(input: (
  PromptWizardArkUseDirectionDraftRuntime & {
    input: PromptWizardUseDirectionDraftRepairContext;
  }
)): Promise<PromptWizardDraftContentRepairResult> {
  // V6 在第一次异步 Provider 边界前建立无共享引用的只读快照。Prompt、
  // ownership 投影、格式恢复和最终 merge 必须贯穿同一份字节语义，调用方
  // 或测试 double 在外呼期间修改原对象不能造成 TOCTOU 分裂。V4/V5 不变。
  const repairContext = isPromptWizardV6DraftContext(input.input)
    ? promptWizardDeepFreezeRepairSnapshot(structuredClone(input.input))
    : input.input;
  validatePromptWizardUseDirectionDraftContext(repairContext);
  const issues = validatePromptWizardUseDirectionDraftRepairInput(repairContext);
  const runtime = {
    responses: input.responses,
    requestRecorder: input.requestRecorder,
    model: input.model,
  };
  const deadlineAtMs = repairContext.deadlineAtMs
    ?? Date.now() + env.PROMPT_WIZARD_REQUEST_BUDGET_MS;
  type Completed = Awaited<ReturnType<typeof runArkPromptWizardUseDirectionDraftPlan>>;
  type Settled = { planIndex: PromptWizardPlanIndex; result: PromiseSettledResult<Completed> };
  const operation = repairContext.operation ?? 'repair-draft-content';
  const initialResults = await Promise.allSettled(issues.map(issue => (
    runArkPromptWizardUseDirectionDraftPlan({
      runtime,
      context: repairContext,
      planIndex: issue.planIndex,
      operation,
      repair: { input: repairContext, issue },
      deadlineAtMs,
    })
  )));
  const initial: Settled[] = issues.map((issue, index) => ({
    planIndex: issue.planIndex,
    result: initialResults[index]!,
  }));
  const accounting: Settled[] = [...initial];
  const completed = new Map<PromptWizardPlanIndex, Completed>(initial.flatMap(entry => (
    entry.result.status === 'fulfilled' ? [[entry.planIndex, entry.result.value]] : []
  )));
  const failures = initial.filter((entry): entry is Settled & { result: PromiseRejectedResult } => (
    entry.result.status === 'rejected'
  ));
  const terminal = failures.find(failure => (
    promptWizardProviderErrorMetadata(failure.result.reason).errorCode
      !== 'PROMPT_WIZARD_PROVIDER_INVALID_JSON'
  ));
  if (terminal) throwPromptWizardPlanFailure(terminal, accounting);
  const unsupportedHookFormatRecovery = isPromptWizardV6DraftContext(repairContext)
    ? failures.find(failure => {
        const issue = issues.find(candidate => candidate.planIndex === failure.planIndex);
        return issue?.fieldPaths.includes('hook');
      })
    : undefined;
  // 格式恢复明确没有 hook 键且只能回填 lockedHookZh。若把 stronger/less-ad-like
  // Hook 微调送入该路径，会在丢弃用户意图后伪装成功，因此首个已记账请求失败后关闭。
  if (unsupportedHookFormatRecovery) {
    throwPromptWizardPlanFailure(unsupportedHookFormatRecovery, accounting);
  }
  const formatRepairFailures = failures;
  if (formatRepairFailures.length > 0) {
    if (deadlineAtMs - Date.now() < PROMPT_WIZARD_MIN_DRAFT_FORMAT_REPAIR_BUDGET_MS) {
      throwPromptWizardPlanFailure(formatRepairFailures[0]!, accounting);
    }
    const repairedResults = await Promise.allSettled(formatRepairFailures.map((failure) => {
      const issue = issues.find(candidate => candidate.planIndex === failure.planIndex)!;
      return runArkPromptWizardUseDirectionDraftPlan({
        runtime,
        context: repairContext,
        planIndex: failure.planIndex,
        operation: 'repair-draft-format',
        formatRepairCause: failure.result.reason,
        repair: { input: repairContext, issue },
        deadlineAtMs,
      });
    }));
    const repaired: Settled[] = formatRepairFailures.map((failure, index) => ({
      planIndex: failure.planIndex,
      result: repairedResults[index]!,
    }));
    accounting.push(...repaired);
    const failedRepair = repaired.find((entry): entry is Settled & { result: PromiseRejectedResult } => (
      entry.result.status === 'rejected'
    ));
    if (failedRepair) throwPromptWizardPlanFailure(failedRepair, accounting);
    repaired.forEach(entry => {
      if (entry.result.status === 'fulfilled') completed.set(entry.planIndex, entry.result.value);
    });
  }
  const drafts = issues.map(issue => completed.get(issue.planIndex)).filter(
    (entry): entry is Completed => Boolean(entry),
  ).sort((left, right) => left.planIndex - right.planIndex).map(({ planIndex, draft }) => {
    const issue = issues.find(candidate => candidate.planIndex === planIndex)!;
    return {
      planIndex,
      draft: mergePromptWizardUseDirectionRepairedDraft({
        previousDraft: repairContext.previousDrafts[planIndex]!,
        repairedDraft: draft,
        issue,
        v6CompactOwnership: isPromptWizardV6DraftContext(repairContext),
      }),
    };
  });
  if (drafts.length !== issues.length) {
    throw Object.assign(new Error('提示词模型没有返回全部待修复方案'), {
      code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
    });
  }
  const outputDiagnostics = accounting.flatMap(
    promptWizardOutputDiagnosticsFromSettledPlan,
  );
  const formatRecoveryRequestCount = formatRepairFailures.length;
  return {
    drafts,
    usage: mergePromptWizardProviderUsage(accounting.flatMap(promptWizardUsageFromSettledPlan)),
    outputDiagnostics,
    formatRepairCount: isPromptWizardV6DraftContext(repairContext)
      ? countPromptWizardFormatAnomalies(outputDiagnostics)
      : formatRecoveryRequestCount,
    formatRecoveryRequestCount,
  };
}

const PROMPT_WIZARD_REPAIRABLE_SEGMENT_FIELDS = [
  'role',
  'location',
  'subject',
  'shotSize',
  'action',
  'cameraMovement',
  'lightingAndRealism',
  'voiceover',
  'voiceoverZh',
  'foley',
  'editingCue',
  'evidenceRefs',
  'productionNote',
] as const;

const PROMPT_WIZARD_NON_VOICEOVER_SEGMENT_FIELDS = PROMPT_WIZARD_REPAIRABLE_SEGMENT_FIELDS
  .filter(field => field !== 'voiceover' && field !== 'voiceoverZh');

const PROMPT_WIZARD_V6_PROVIDER_OWNED_REPAIR_SEGMENT_FIELDS = new Set([
  'shotSize',
  'action',
  'cameraMovement',
  'lightingAndRealism',
  'voiceover',
  'voiceoverZh',
  'foley',
  'editingCue',
]);

/**
 * 方舟内容修复仍返回完整 Draft，但完整响应不代表所有字段都获准改写。
 * 这里只采纳 issue.fieldPaths 指向的补丁，避免模型修复运镜、动作等字段时
 * 擅自漂移已经通过门禁的口播、证据或其他方案内容。
 */
export function mergePromptWizardUseDirectionRepairedDraft(input: {
  previousDraft: PromptWizardPlanDraft;
  repairedDraft: PromptWizardPlanDraft;
  issue: PromptWizardDraftContentRepairIssue;
  v6CompactOwnership?: boolean;
}) {
  const merged = structuredClone(input.previousDraft);
  let v6HookWasAdopted = false;
  const copySegmentField = (segmentIndex: number, field: string) => {
    const target = merged.segments[segmentIndex] as Record<string, unknown> | undefined;
    const source = input.repairedDraft.segments[segmentIndex] as Record<string, unknown> | undefined;
    if (!target || !source || !PROMPT_WIZARD_REPAIRABLE_SEGMENT_FIELDS.includes(
      field as typeof PROMPT_WIZARD_REPAIRABLE_SEGMENT_FIELDS[number],
    ) || (
      input.v6CompactOwnership
      && !PROMPT_WIZARD_V6_PROVIDER_OWNED_REPAIR_SEGMENT_FIELDS.has(field)
    )) return;
    target[field] = structuredClone(source[field]);
  };
  const copyPath = (fieldPath: string) => {
    if (fieldPath === 'segments') {
      const allowedFields = input.issue.errorCode === 'PROMPT_WIZARD_USER_REFINEMENT'
        ? PROMPT_WIZARD_REPAIRABLE_SEGMENT_FIELDS
        : input.issue.errorCode === 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID'
          ? (['voiceover', 'voiceoverZh'] as const)
          : PROMPT_WIZARD_NON_VOICEOVER_SEGMENT_FIELDS;
      merged.segments.forEach((_, segmentIndex) => {
        allowedFields.forEach(field => copySegmentField(segmentIndex, field));
      });
      return;
    }
    const segmentMatch = /^segments\[(\d+)\](?:\.([A-Za-z][A-Za-z0-9]*))?$/u.exec(fieldPath);
    if (segmentMatch) {
      const segmentIndex = Number(segmentMatch[1]);
      const field = segmentMatch[2];
      if (!field) {
        if (input.issue.errorCode === 'PROMPT_WIZARD_USER_REFINEMENT') {
          if (input.v6CompactOwnership) {
            PROMPT_WIZARD_V6_PROVIDER_OWNED_REPAIR_SEGMENT_FIELDS.forEach(
              candidateField => copySegmentField(segmentIndex, candidateField),
            );
          } else {
            const replacement = input.repairedDraft.segments[segmentIndex];
            if (replacement) merged.segments[segmentIndex] = structuredClone(replacement);
          }
        }
        return;
      }
      copySegmentField(segmentIndex, field);
      if (field === 'voiceover') copySegmentField(segmentIndex, 'voiceoverZh');
      return;
    }
    const tagMatch = /^differenceTags\[(\d+)\]$/u.exec(fieldPath);
    if (tagMatch) {
      if (input.v6CompactOwnership) return;
      const index = Number(tagMatch[1]);
      if (input.repairedDraft.differenceTags[index] !== undefined) {
        merged.differenceTags[index] = input.repairedDraft.differenceTags[index]!;
      }
      return;
    }
    const planningReviewMatch = /^planningReview\.([A-Za-z][A-Za-z0-9]*)$/u.exec(fieldPath);
    if (planningReviewMatch) {
      if (input.v6CompactOwnership) return;
      const field = planningReviewMatch[1]!;
      const target = merged.planningReview as unknown as Record<string, unknown>;
      const source = input.repairedDraft.planningReview as unknown as Record<string, unknown>;
      if (Object.hasOwn(source, field)) target[field] = structuredClone(source[field]);
      return;
    }
    if (fieldPath === 'differenceTags') {
      if (input.v6CompactOwnership) return;
      merged.differenceTags = structuredClone(input.repairedDraft.differenceTags);
      return;
    }
    if (fieldPath === 'planningReview') {
      if (input.v6CompactOwnership) return;
      merged.planningReview = structuredClone(input.repairedDraft.planningReview);
      return;
    }
    if (fieldPath === 'productionWarnings') {
      if (input.v6CompactOwnership) return;
      merged.productionWarnings = structuredClone(input.repairedDraft.productionWarnings);
      return;
    }
    if (
      fieldPath === 'name'
      || fieldPath === 'hook'
      || fieldPath === 'narrative'
      || fieldPath === 'primaryScene'
      || fieldPath === 'cameraAndPacing'
    ) {
      if (input.v6CompactOwnership && fieldPath !== 'hook') return;
      merged[fieldPath] = input.repairedDraft[fieldPath];
      if (input.v6CompactOwnership && fieldPath === 'hook') {
        v6HookWasAdopted = true;
      }
    }
  };

  input.issue.fieldPaths.forEach(copyPath);
  if (v6HookWasAdopted) {
    merged.planningReview.nonAdEntry = merged.hook;
  }
  return promptWizardPlanDraftSchema.parse(merged);
}

function promptWizardProviderConceptProjection(assignment: PromptWizardConceptAssignment) {
  return {
    planIndex: assignment.planIndex,
    targetAudience: assignment.targetAudience,
    audienceMotivation: assignment.audienceMotivation,
    openingAction: assignment.openingAction,
    progression: assignment.progression,
    scene: assignment.scene,
    perspective: assignment.perspective,
    painExpression: assignment.painExpression,
    proofAction: assignment.proofAction,
    evidenceIds: assignment.evidenceIds,
    midpointEscalation: assignment.midpointEscalation,
    visibleResult: assignment.visibleResult,
    cameraAndSound: assignment.cameraSoundGrammar,
    cta: assignment.cta,
  };
}

export function buildPromptWizardDraftInput(
  input: Parameters<PromptWizardProvider['generateDrafts']>[0],
  segmentCount = expectedPromptWizardSegmentCount(input.config.durationSeconds),
  planIndex = 0,
) {
  if (!isPromptWizardPlanIndex(planIndex)) {
    throw promptWizardProviderInputError('方案索引必须是 0 或 1');
  }
  const directionBlueprint = getPromptWizardDirectionBlueprint(input.brief.direction);
  const requiredShotRoles = promptWizardShotRoles(input.config.durationSeconds);
  const assignedStrategy = input.strategies[planIndex];
  if (!assignedStrategy) {
    throw Object.assign(new Error(`方案 ${planIndex + 1} 缺少创意策略`), {
      code: 'PROMPT_WIZARD_PROVIDER_INPUT_INVALID',
    });
  }
  const assignedConcept = assignedPromptWizardConcept(input, planIndex);
  const evidenceCatalog = input.evidenceGraph.evidences
    .filter(item => input.evidenceGraph.reliableEvidenceIds.includes(item.id))
    .map(item => ({ id: item.id, text: item.text }));
  const evidenceById = new Map(evidenceCatalog.map(item => [item.id, item]));
  const evidenceAllocation = allocatePromptWizardEvidence({
    evidenceGraph: input.evidenceGraph,
    shotRoles: requiredShotRoles,
    planIndex,
    preferredFactIds: assignedConcept.evidenceIds,
  });
  const generationProduct = buildPromptWizardGenerationProduct(input.profile);
  const allowedCommercialClaims = [...new Set([
    ...splitPromptWizardAllowedCommercialClaims(input.profile.userConfirmedClaims),
    ...input.evidenceGraph.evidences
      .filter(item => (
        input.evidenceGraph.reliableEvidenceIds.includes(item.id)
        && item.status === 'user-confirmed'
      ))
      .map(item => item.text),
  ].map(item => item.trim()).filter(Boolean))];
  return JSON.stringify({
    task: '生成一套逻辑完整的短视频结构化脚本',
    planIndex,
    languagePolicy: {
      simplifiedChineseFields: [
        'name',
        'hook',
        'narrative',
        'primaryScene',
        'cameraAndPacing',
        'differenceTags[]',
        'planningReview.targetAudience',
        'planningReview.surfaceNeed',
        'planningReview.realPainPoint',
        'planningReview.nonAdEntry',
        'planningReview.directionFit',
        'segments[].location',
        'segments[].subject',
        'segments[].shotSize',
        'segments[].action',
        'segments[].cameraMovement',
        'segments[].lightingAndRealism',
        'segments[].foley',
        'segments[].editingCue',
        'segments[].productionNote',
        'productionWarnings[]',
      ],
      targetLanguageFields: [
        'segments[].voiceover',
      ],
      simplifiedChineseTranslationFields: [
        'segments[].voiceoverZh',
      ],
      rules: [
        'targetLanguage 只能用于 voiceover，不能扩散到方案摘要、预审、镜头画面字段、Foley、剪辑、制作提示或风险提示',
        '所有镜头画面组成字段必须使用简体中文；品牌、型号、Logo、可见印花原文和 @图片N 引用可保留原文',
        'targetLanguage 不是普通话时，voiceoverZh 必须是 voiceover 的忠实简体中文翻译；targetLanguage 是普通话时，voiceoverZh 必须为空字符串',
        '不生成、不建议任何后期画面文字、花字、字幕或贴纸文案',
      ],
    },
    product: generationProduct,
    claimPolicy: {
      authoritativeSource: 'allowedCommercialClaims',
      allowedCommercialClaims,
      rules: [
        'allowedCommercialClaims 是唯一可用于商业宣称的授权来源，仅包含用户亲自确认的非空逐条内容',
        '只能逐字精确复用 allowedCommercialClaims 中的完整条目；不得改写、拼接、推断、外延或强化',
        ...(allowedCommercialClaims.length === 0
          ? ['allowedCommercialClaims 为空：禁止所有数值、比例、认证、性能、功效、成分或绝对化保证，包括“100%”“零风险”“永久”等表达']
          : ['allowedCommercialClaims 非空时，列表外的任何数值、比例、认证、性能、功效、成分或绝对化保证仍然禁止']),
        '图片、文件名、产品档案、visibleFacts 和 assignedEvidence 不构成商业宣称授权；其中可见原文仅允许原样保留品牌、型号、Logo 与印花文字，不得转写为卖点',
      ],
    },
    assignedEvidence: {
      proofPoints: evidenceAllocation.proofPoints,
      shots: requiredShotRoles.map((role, shotIndex) => ({
        role,
        facts: evidenceAllocation.evidenceRefsByShot[shotIndex]!.map(id => evidenceById.get(id)!),
      })),
    },
    assignedConcept: promptWizardProviderConceptProjection(assignedConcept),
    conceptPolicy: [
      'assignedConcept 是本方案已经通过硬淘汰、评分与差异配对的唯一创意主线，必须完整执行，不得换题',
      '第一镜头必须落实 openingAction 的具体物理动作；不得退化为人物拿着产品口头介绍',
      '中段必须按 progression 与 midpointEscalation 推进，并用 assignedEvidence 完成 proofAction',
      '结尾只呈现 visibleResult，并使用指定 CTA 语气自然收束',
      '不得改变场景、观看视角、证据形式或引用 assignment 之外的产品事实',
    ],
    creativeBrief: input.brief,
    directionBlueprint,
    fixedVideoConfig: input.config,
    imageReferences: Array.from({ length: input.imageCount }, (_, index) => `@图片${index + 1}`),
    assignedStrategy,
    variationKey: input.variationKey,
    requiredSegmentCount: segmentCount,
    requiredShotRoles,
    requiredBeats: requiredShotRoles.map(role => ({
      role,
      instruction: directionBlueprint.beatGuidance[role],
    })),
    structuredOutputPolicy: {
      mode: 'native-json',
      rules: [
        'planningReview 必须直接返回原生 JSON 对象；segments 必须直接包含全部镜头字段，不得把任何子结构序列化为字符串',
        'differenceTags、productionWarnings 必须直接返回原生 JSON 数组，不得序列化为字符串',
        '严格遵循响应 JSON Schema，不得省略 required 字段，不得增加 Schema 外字段',
        '返回单个 JSON 对象，不得返回 Markdown、代码围栏或解释',
        '每个字符串值保持单行；内容中的引用优先使用中文弯引号“”而不是 ASCII 双引号',
        '字符串中的双引号、反斜杠和控制字符必须使用合法 JSON 转义；禁止尾随逗号',
        '输出前在内部完成一次 JSON 词法自检：首字符必须是 {，末字符必须是 }，并可被标准 JSON.parse 直接解析',
      ],
    },
    fieldLengthLimits: {
      name: 80,
      hook: 300,
      narrative: 500,
      primaryScene: 300,
      cameraAndPacing: 500,
      differenceTag: 40,
      planningReview: {
        targetAudience: 240,
        surfaceNeed: 240,
        realPainPoint: 300,
        nonAdEntry: 300,
        directionFit: 300,
      },
      segment: {
        location: 180,
        subject: 180,
        shotSize: 80,
        action: 300,
        cameraMovement: 180,
        lightingAndRealism: 220,
        voiceover: 300,
        voiceoverZh: 300,
        foley: 180,
        editingCue: 180,
        productionNote: 240,
      },
      productionWarning: 240,
    },
    arrayLimits: {
      differenceTags: '2–6',
      productionWarnings: '0–8',
      segments: segmentCount,
    },
  });
}

/**
 * JSON 格式恢复从同一份受约束输入重新生成失败方案，不携带无法解析的正文。
 * 这样既保留既定策略、事实分配和 planIndex，也避免把上游坏正文重新注入模型。
 */
export function buildPromptWizardDraftFormatRepairInput(
  input: Parameters<PromptWizardProvider['generateDrafts']>[0],
  segmentCount = expectedPromptWizardSegmentCount(input.config.durationSeconds),
  planIndex = 0,
) {
  const original = JSON.parse(
    buildPromptWizardDraftInput(input, segmentCount, planIndex),
  ) as Record<string, unknown>;
  return JSON.stringify({
    ...original,
    task: '按完全相同的策略和事实约束重新生成这一套短视频结构化脚本',
    formatRecovery: {
      reason: '上一轮响应不是合法 JSON',
      rules: [
        '只重新生成当前 planIndex，不改变 assignedConcept、assignedStrategy、assignedEvidence、视频配置或图片引用',
        '不得引用或猜测上一轮无法解析的正文',
        '必须直接返回一个符合 JSON Schema 的原生 JSON 对象',
        '不得返回 Markdown、代码围栏、前后解释或 JSON 之外的任何字符',
      ],
    },
  });
}

export function buildPromptWizardDraftContentRepairInput(
  input: Parameters<PromptWizardProvider['repairDrafts']>[0],
  issue: PromptWizardDraftContentRepairIssue,
  segmentCount = expectedPromptWizardSegmentCount(input.config.durationSeconds),
) {
  return buildPromptWizardDraftContentRepairPayload(
    input,
    input.previousDrafts[issue.planIndex]!,
    issue,
    segmentCount,
  );
}

function buildPromptWizardInitialDraftContentRepairInput(
  input: Parameters<PromptWizardProvider['generateDrafts']>[0],
  previousCandidate: Record<string, unknown>,
  issue: PromptWizardDraftContentRepairIssue,
  segmentCount = expectedPromptWizardSegmentCount(input.config.durationSeconds),
) {
  return buildPromptWizardDraftContentRepairPayload(
    input,
    previousCandidate,
    issue,
    segmentCount,
  );
}

function buildPromptWizardDraftContentRepairPayload(
  input: Parameters<PromptWizardProvider['generateDrafts']>[0],
  previousCandidate: unknown,
  issue: PromptWizardDraftContentRepairIssue,
  segmentCount: ReturnType<typeof expectedPromptWizardSegmentCount>,
) {
  const base = JSON.parse(
    buildPromptWizardDraftInput(input, segmentCount, issue.planIndex),
  ) as Record<string, unknown>;
  return JSON.stringify({
    ...base,
    task: '只修复当前方案中明确列出的内容问题，并返回完整的单方案结构化脚本',
    previousDraft: sanitizePromptWizardPreviousDrafts([
      previousCandidate,
    ])[0],
    repairIssue: {
      planIndex: issue.planIndex,
      errorCode: issue.errorCode,
      fieldPaths: issue.fieldPaths,
      action: issue.action,
    },
    repairPolicy: [
      '只修改 repairIssue 指向的不合格字段；其他字段保持 previousDraft 的内容与含义不变',
      '当 fieldPaths 包含 segments 时，只能在 segments 数组内部增删或压缩镜头以满足固定时间轴，不得改动其他顶层字段',
      '必须保持 assignedConcept、assignedStrategy、assignedEvidence、图片引用、视频配置和目标语言不变',
      '仍需返回完整的单方案 JSON 对象，不能只返回被修改字段',
    ],
  });
}

function buildPromptWizardDraftContentFormatRepairInput(
  input: Parameters<PromptWizardProvider['repairDrafts']>[0],
  issue: PromptWizardDraftContentRepairIssue,
  segmentCount = expectedPromptWizardSegmentCount(input.config.durationSeconds),
) {
  const original = JSON.parse(
    buildPromptWizardDraftContentRepairInput(input, issue, segmentCount),
  ) as Record<string, unknown>;
  return JSON.stringify({
    ...original,
    task: '按相同的定向修复要求重新生成当前单方案的合法 JSON',
    formatRecovery: {
      reason: '上一轮内容修复响应不是合法 JSON',
      rules: [
        '只重新生成当前 planIndex，不改变 repairIssue、previousDraft、assignedStrategy、assignedEvidence、视频配置或图片引用',
        '不得引用或猜测上一轮无法解析的正文',
        '必须直接返回一个符合 JSON Schema 的原生 JSON 对象',
        '不得返回 Markdown、代码围栏、前后解释或 JSON 之外的任何字符',
      ],
    },
  });
}

export function buildPromptWizardPlanRefinementInput(
  input: Parameters<PromptWizardProvider['repairDrafts']>[0],
  issue: PromptWizardDraftContentRepairIssue,
  segmentCount = expectedPromptWizardSegmentCount(input.config.durationSeconds),
) {
  const previousDraft = input.previousDrafts[issue.planIndex];
  if (!previousDraft) {
    throw promptWizardProviderInputError('单方案定向微调上下文无效');
  }
  const base = JSON.parse(
    buildPromptWizardDraftInput(input, segmentCount, issue.planIndex),
  ) as Record<string, unknown>;
  return JSON.stringify({
    ...base,
    task: '根据用户选择只微调当前单方案，并返回完整的单方案结构化脚本',
    previousDraft: sanitizePromptWizardPreviousDrafts([previousDraft])[0],
    refinement: {
      planIndex: issue.planIndex,
      action: issue.action,
      editableFields: issue.fieldPaths,
    },
    refinementPolicy: [
      '只修改 refinement.editableFields 指向的内容；其他字段、镜头职责和时间段顺序保持 previousDraft 的内容与含义不变',
      'refinement.action 是用户已选择的微调动作；若其中包含目标场景，必须准确使用该场景，不得另行猜测场景',
      '必须保留同一主创作方向、唯一购买理由、产品事实、可靠证据 ID、图片引用和 CTA 对开场问题的回扣',
      '不得新增价格、折扣、认证、功效、性能数字、社会证明、竞品结论、稀缺主张或输入未提供的素材',
      '固定视频配置和目标语言不得改变；仍需遵守动作预算、口播时长、中文门禁和产品一致性要求',
      '必须返回完整且可通过同一 JSON Schema 的单方案对象，不得只返回差异字段',
    ],
  });
}

function validatePromptWizardDraftContentRepairInput(
  input: Parameters<PromptWizardProvider['repairDrafts']>[0],
) {
  if (
    input.operation !== undefined
    && input.operation !== 'repair-draft-content'
    && input.operation !== 'refine-plan'
  ) {
    throw promptWizardProviderInputError('方案修复操作无效');
  }
  if (input.strategies.length !== PROMPT_WIZARD_PLAN_COUNT) {
    throw promptWizardProviderInputError('提示词向导必须为两个方案分别提供创意策略');
  }
  const issues = input.issues;
  if (!issues || issues.length < 1 || issues.length > PROMPT_WIZARD_PLAN_COUNT) {
    throw promptWizardProviderInputError('内容修复必须提供 1–2 个待修复方案');
  }
  const seen = new Set<number>();
  for (const issue of issues) {
    if (
      !Number.isSafeInteger(issue.planIndex)
      || !isPromptWizardPlanIndex(issue.planIndex)
      || issue.referencePlanIndex !== undefined
      || seen.has(issue.planIndex)
      || !input.previousDrafts[issue.planIndex]
      || !/^[A-Z][A-Z0-9_:-]{0,95}$/u.test(issue.errorCode)
      || issue.fieldPaths.length === 0
      || issue.fieldPaths.length > 24
      || issue.fieldPaths.some(path => (
        !path
        || path.length > 200
        || !isPromptWizardProviderRepairFieldPath(path)
      ))
      || !issue.action.trim()
      || issue.action.length > 1_000
    ) {
      throw promptWizardProviderInputError('单方案内容修复上下文无效');
    }
    seen.add(issue.planIndex);
  }
  return [...issues].sort((left, right) => left.planIndex - right.planIndex);
}

function isPromptWizardProviderRepairFieldPath(value: string) {
  return /^(?:name|hook|narrative|primaryScene|cameraAndPacing|differenceTags(?:\[\d{1,2}\])?|planningReview(?:\.(?:targetAudience|surfaceNeed|realPainPoint|nonAdEntry|directionFit|proofPoints\[\d{1,2}\]))?|segments|segments\[\d{1,2}\]\.(?:role|location|subject|shotSize|action|cameraMovement|lightingAndRealism|voiceover|voiceoverZh|foley|editingCue|evidenceRefs(?:\[\d{1,2}\])?|productionNote)|productionWarnings(?:\[\d{1,2}\])?)$/u.test(value);
}

function promptWizardInitialDraftSchemaRepair(
  planIndex: PromptWizardPlanIndex,
  error: unknown,
): {
  candidate: Record<string, unknown>;
  issue: PromptWizardDraftContentRepairIssue;
} | null {
  const metadata = promptWizardProviderErrorMetadata(error);
  if (metadata.errorCode !== 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID') return null;
  if (!error || typeof error !== 'object') return null;
  const candidate = (error as {
    recoverableDraftCandidate?: unknown;
  }).recoverableDraftCandidate;
  if (!isPlainPromptWizardRecord(candidate)) return null;
  const fieldPaths = Array.from(new Set(
    safePromptWizardFieldPaths(error, (error as { fieldPaths?: unknown }).fieldPaths),
  ));
  if (
    fieldPaths.length === 0
    || fieldPaths.some(fieldPath => !isPromptWizardProviderRepairFieldPath(fieldPath))
  ) {
    return null;
  }
  return {
    candidate,
    issue: {
      planIndex,
      errorCode: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
      fieldPaths,
      action: '只修复未通过本地 Schema/Zod 校验的字段，使当前方案满足固定结构、字段类型、数组数量与字段长度要求；其余字段保持不变',
    },
  };
}

function promptWizardProviderInputError(message: string) {
  return Object.assign(new Error(message), {
    code: 'PROMPT_WIZARD_PROVIDER_INPUT_INVALID',
    retryable: false,
  });
}

function buildPromptWizardGenerationProduct(profile: PromptWizardProductProfile) {
  const product = describePromptWizardProduct(profile);
  return Object.fromEntries(
    Object.entries(product).filter(([field]) => field !== 'needsConfirmation'),
  );
}

function splitPromptWizardAllowedCommercialClaims(value: string) {
  return value
    .split(/[\n；;。]+/u)
    .map(item => item.trim())
    .filter(Boolean);
}

function sanitizePromptWizardPreviousDrafts(drafts: unknown[]) {
  return drafts.map(draft => {
    if (!isPlainPromptWizardRecord(draft)) return draft;
    const sanitized = { ...draft } as Record<string, unknown>;
    delete sanitized.alternativeHooks;
    if (sanitized.planningReview && typeof sanitized.planningReview === 'object') {
      const planningReview = { ...sanitized.planningReview } as Record<string, unknown>;
      delete planningReview.proofPoints;
      sanitized.planningReview = planningReview;
    }
    if (Array.isArray(sanitized.segments)) {
      sanitized.segments = sanitized.segments.map(segment => {
        if (!segment || typeof segment !== 'object') return segment;
        const sanitizedSegment = { ...segment } as Record<string, unknown>;
        delete sanitizedSegment.onScreenText;
        delete sanitizedSegment.onScreenTextZh;
        delete sanitizedSegment.evidenceRefs;
        return sanitizedSegment;
      });
    }
    return sanitized;
  });
}

export class FakePromptWizardProvider implements PromptWizardProvider {
  async analyzeProduct(images: PromptWizardImageInput[]) {
    await fakeDelay();
    const inferredName = images[0]?.name.replace(/\.[^.]+$/, '').trim() || '待确认产品';
    const profile = promptWizardProductProfileSchema.parse({
      productName: `待确认产品 ${inferredName}`,
      category: '待确认品类',
      colors: '',
      materials: '待确认材质',
      structure: '产品结构需结合参考图片确认',
      logo: '',
      usage: '正确使用方式需要用户确认',
      suggestedAudience: '请结合实际销售人群确认',
      suggestedScenarios: '请结合产品真实用途确认',
      visibleFacts: [`已收到 ${images.length} 张产品图片`],
      needsConfirmation: ['产品品类、材质、使用方式和可宣传卖点需要用户确认'],
      userConfirmedClaims: '',
      consistencyConstraints: '保持参考图片中的产品外观、材质、结构和标识一致，不新增部件',
    });
    const evidenceSources: PromptWizardProductEvidenceSource[] = [
      'productName', 'category', 'materials', 'structure', 'usage', 'visibleFacts[0]',
    ].map(fieldPath => ({
      fieldPath,
      sourceImageIndexes: [1],
      visibleRegion: '图片 1 的产品主体',
      confidence: fieldPath === 'visibleFacts[0]' ? 'high' : 'low',
      proofActions: fieldPath === 'visibleFacts[0]'
        ? ['手拿起产品并用稳定近景展示产品主体']
        : [],
    }));
    return {
      profile,
      evidenceSources,
      usage: fakeUsage(),
    };
  }

  async generateUseDirections(input: PromptWizardUseDirectionGenerationContext) {
    await fakeDelay();
    if (promptWizardUseDirectionNeedsInput(input.evidenceGraph)) {
      return {
        directions: [],
        clarificationQuestion: PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION,
        usage: fakeUsage(),
        repairRounds: 0 as const,
      };
    }
    const reliableIds = new Set(input.evidenceGraph.reliableEvidenceIds);
    const reliableEvidence = input.evidenceGraph.evidences.filter(evidence => (
      reliableIds.has(evidence.id)
      && (evidence.status === 'visible' || evidence.status === 'user-confirmed')
      && !['appearance', 'audience', 'scenario'].includes(evidence.type)
      && evidence.proofActions.length > 0
    ));
    const historyRound = input.historicalDirections.length;
    const moments = [
      ['开始真实任务前，从取用产品的第一个动作切入', '任务进行到关键步骤时，让产品直接介入并完成操作', '任务结束后，在收纳前回看产品的使用状态'],
      ['临时需要产品时，用一次快速取用回应当下需求', '连续操作过程中，停下来展示影响选择的关键细节', '完成使用后，通过整理与归位展示产品状态'],
      ['第一次靠近产品时，先用局部细节引出整体用途', '日常使用流程中，用正确操作证明产品为什么合适', '使用完成后，从最终状态回溯关键结构与动作'],
    ][historyRound % 3]!;
    const directionCount = Math.min(3, Math.max(2, reliableEvidence.length));
    const directions = Array.from({ length: directionCount }, (_, index) => {
      const evidence = reliableEvidence[index % reliableEvidence.length]!;
      const useMoment = `${moments[index]}，让${input.profile.category}在具体需求中直接进入画面。`;
      const baseProofAction = fakePromptWizardExecutableProofAction(
        evidence.proofActions[0]!,
      );
      // 使用方向在用户选择视频型号与时长之前生成，因此每个方向的
      // 主自证动作必须先满足最严格的 Mini 5 秒单动作预算。取用、旋转、
      // 收纳等叙事时机只放在 useMoment，不再叠加到可执行 proofAction。
      const proofAction = baseProofAction;
      const appearanceMode = input.evidenceGraph.productFamily === 'apparel-accessories'
        ? 'person' as const
        : 'hands-only' as const;
      const sceneOptions = [
        {
          id: randomUUID(),
          title: `真实使用场景 ${index + 1}`,
          environment: [
            '自然光下的任务准备区域',
            '产品实际发挥作用的使用位置',
            '使用结束后的整理与收纳区域',
          ][index]!,
          mainAction: proofAction,
        },
        {
          id: randomUUID(),
          title: `细节核对场景 ${index + 1}`,
          environment: [
            '靠近取用位置的光线稳定区域',
            '连续操作过程中可暂停的近景区域',
            '完成归位后可回看整体状态的区域',
          ][index]!,
          mainAction: baseProofAction,
        },
      ];
      return promptWizardUseDirectionSchema.parse({
        id: randomUUID(),
        title: `${input.profile.category}${['真实取用', '过程自证', '使用回看'][index]}`,
        useMoment,
        audienceNeed: `希望在真实动作中判断${evidence.text}是否符合当前需要。`,
        purchaseReason: evidence.text,
        proofAction,
        evidenceIds: [evidence.id],
        sceneOptions,
        recommendedSceneId: sceneOptions[0]!.id,
        appearanceMode,
        internalDirection: (['problem-solution', 'lifestyle', 'cinematic-brand'] as const)[index],
        requiredAssets: appearanceMode === 'person'
          ? ['产品参考图片', '真人出镜素材']
          : ['产品参考图片', '手部素材'],
      });
    });
    return {
      directions: assertPromptWizardUseDirections({
        directions,
        evidenceGraph: input.evidenceGraph,
        historicalDirections: input.historicalDirections,
      }),
      clarificationQuestion: null,
      usage: fakeUsage(),
      repairRounds: 0 as const,
    };
  }

  async generateConcepts(input: PromptWizardConceptGenerationContext) {
    await fakeDelay();
    const repairFeedback = normalizePromptWizardConceptRepairFeedback(
      input.repairFeedback,
    );
    const isRepair = repairFeedback.length > 0;
    const executionBudget = getPromptWizardExecutionBudget(input.config);
    const historyRound = Math.floor(input.historicalConcepts.length / 8);
    // Fake Provider 同样要模拟生产的“同一 run 历史语义去重”。
    // 只在旧路线前加一个短语会被三元组相似度正确视为同一创意；
    // 因此每一轮改用一个可被观众感知的全新叙事入口。与后方
    // 的八组物理事件组合后，开场与张力两个核心维度都会发生
    // 实质变化，而不是依靠标题或标签绕过门禁。
    const historyContexts = [
      '从任务开始前的准备状态切入，镜头先锁定空着的操作区域',
      '从任务进行到一半的受阻瞬间切入，手部动作突然停在问题中心',
      '从使用结束后的回看状态切入，先让最终形态占满画面',
      '从狭小空间里的单手操作切入，产品贴近画面边缘出现',
      '从自然环境声先于产品画面出现切入，随后手部把关键部位送入焦点',
      '从参照物被移出画面的瞬间切入，操作区只留下产品关键部位',
      '从错误摆放被立即纠正的瞬间切入，产品回到正确使用位置',
      '从局部细节先被手势遮住的悬念切入，揭开后再完成产品操作',
    ] as const;
    const historyContext = historyContexts[historyRound % historyContexts.length]!;
    const evidenceById = new Map(
      input.evidenceGraph.evidences.map(evidence => [evidence.id, evidence]),
    );
    // 3.0 的购买理由必须连接能够做产品自证的事实。产品名称或品类只能帮助
    // 理解主体，不能单独作为购买证据；Fake Provider 也必须遵守生产门禁。
    const evidenceIds = input.evidenceGraph.reliableEvidenceIds.filter((evidenceId) => {
      const evidence = input.evidenceGraph.evidences.find(item => item.id === evidenceId);
      return evidence && !['appearance', 'audience', 'scenario'].includes(evidence.type);
    });
    if (evidenceIds.length === 0) {
      throw promptWizardProviderInputError('当前产品证据不足，无法生成可自证的创意路线');
    }
    const events = [
      '手在第一秒完成一次清楚的取用动作，立即露出产品关键结构',
      '产品从遮挡状态被翻转到正面，第一秒揭晓 Logo 与结构细节',
      '手按住产品可见部位并完成一次正确操作，第一秒呈现使用状态',
      '手沿正确使用方向移动产品，真实操作声同步进入画面',
      '手把产品放到真实任务中心，镜头立即停在可见结构细节上',
      '主观视角先遇到具体阻力，再把产品放到问题中心',
      '产品在自然光中被快速展开，结构变化立即形成视觉停留',
      '手抬起处于结果状态的产品，第一秒揭晓它如何工作',
    ];
    const tensions = [
      '观众需要判断产品结构是否适合眼前的真实任务',
      '遮挡状态让观众暂时看不清产品正面细节',
      '正确使用动作能否顺利完成仍等待画面验证',
      '操作声出现后，观众等待产品进入完整使用状态',
      '普通任务中突然出现的结构细节需要进一步解释',
      '主观视角遇到阻力，观众等待产品如何介入',
      '展开前后的结构状态形成可见悬念',
      '结果已经出现，观众等待镜头揭晓产品如何工作',
    ];
    const ctaCallbacks = [
      '回到开场取用动作，请观众根据结构细节判断是否适合自己的任务',
      '回扣正面揭晓，请观众再看一次刚才出现的关键细节',
      '回到正确操作问题，请观众根据完整动作判断是否符合使用习惯',
      '回扣开场操作声，请观众根据最终产品状态作出判断',
      '回到快速横移揭晓的结构细节，请观众判断它是否适合当前场景',
      '回扣主观视角遇到的阻力，请观众判断产品介入是否自然',
      '回到展开前的悬念，请观众选择更想继续查看哪个结构细节',
      '回扣开场结果，请观众根据完整过程判断是否值得继续了解',
    ];
    // 证据 ID 只用于服务端追溯，不能泄漏到方案卡或中文脚本字段。
    // 否则 `profile:materials` 这类内部标识会让后续中文门禁误判，
    // 也会把实现细节暴露给用户。这里描述的是“如何自证”，不是证据主键。
    const proofMechanisms = [
      '结构细节近景自证',
      '正反面连续展示自证',
      '正确操作过程自证',
      '使用状态停留自证',
      '关键部位对照自证',
      '问题介入动作自证',
      '展开前后状态自证',
      '结果到过程回溯自证',
    ];
    const narrativeArcs = [
      '取用疑问到结构判断',
      '遮挡悬念到正面揭晓',
      '操作疑问到完整验证',
      '声音线索到使用状态',
      '任务阻力到细节解释',
      '主观受阻到产品介入',
      '收纳状态到展开验证',
      '结果先行到过程回溯',
    ];
    const ctaStyles = [
      '回扣取用动作',
      '回扣正面揭晓',
      '回扣操作问题',
      '回扣开场声音',
      '回扣结构停顿',
      '回扣主观阻力',
      '回扣展开悬念',
      '回扣结果来源',
    ];
    const concepts = events.map((_baseFirstSecondEvent, index) => {
      // 同一 run 刷新时旋转整套核心维度，而不是只给原路线加前缀。
      // 这样 Fake Provider 才能真实覆盖 3.0 的历史语义去重门禁。
      const routeIndex = (index + historyRound) % events.length;
      const baseFirstSecondEvent = events[routeIndex]!;
      const historyAwareEvent = historyContext
        ? `${historyContext}，${baseFirstSecondEvent}`
        : baseFirstSecondEvent;
      const firstSecondEvent = isRepair
        ? `修复后的独立动作：${historyAwareEvent}`
        : historyAwareEvent;
      const primaryReasonEvidenceId = input.productionBrief.primaryPurchaseReason
        ? evidenceIds.find(id => id === 'brief:primaryPurchaseReason')
        : undefined;
      const evidenceId = primaryReasonEvidenceId ?? evidenceIds[routeIndex % evidenceIds.length]!;
      const selectedEvidence = evidenceById.get(evidenceId)!;
      const proofAction = selectedEvidence.proofActions[0]
        || `用稳定近景完整展示该事实：${selectedEvidence.text}`;
      const productAction = fakeConceptEvidenceAction({
        routeIndex,
        evidenceText: selectedEvidence.text,
        proofAction,
        maxMajorActionCount: executionBudget.maxMajorActionCount,
      });
      const purchaseReason = primaryReasonEvidenceId
        ? input.productionBrief.primaryPurchaseReason
        : selectedEvidence.text
        || '通过清楚可见的产品细节判断是否适合当前使用需求';
      const role = index < 4 ? 'reliable-conversion' : 'creative-breakthrough';
      return promptWizardConceptPreviewSchema.parse({
        id: randomUUID(),
        role,
        title: `${isRepair ? '修复后' : ''}${index < 4 ? '可信使用' : '记忆钩子'}路线 ${index + 1}`,
        firstSecondEvent,
        viewerQuestion: '这个产品如何在真实动作中解决当前问题？',
        purchaseReason,
        tension: `${historyContext ? `${historyContext}，` : ''}${tensions[routeIndex]}，需要验证“${purchaseReason}”`,
        productAction,
        visibleResult: `动作结束后，镜头清楚保留“${selectedEvidence.text}”对应的真实状态`,
        evidenceIds: [evidenceId],
        scene: input.productionBrief.availableScenes[routeIndex % Math.max(1, input.productionBrief.availableScenes.length)]
          || `真实${input.profile.category}使用场景`,
        perspective: routeIndex % 3 === 0 ? '第一人称手部视角' : routeIndex % 3 === 1 ? '人物侧面观察视角' : '纯产品近景视角',
        cameraGrammar: routeIndex % 2 === 0 ? '快速推近后横移追踪证据细节' : '连续跟随动作后切入产品特写',
        ctaCallback: ctaCallbacks[routeIndex]!,
        requiredAssets: ['现有产品参考图片', ...input.productionBrief.availableAssets.slice(0, 2)],
        difficulty: index < 3 ? 'low' : index < 6 ? 'medium' : 'high',
        risk: index < 6 ? 'low' : 'medium',
        direction: input.brief.direction,
        strategy: {
          hookType: `物理事件 ${routeIndex + 1}`,
          narrativeArc: historyContext
            ? `${historyContext}${narrativeArcs[routeIndex]}`
            : narrativeArcs[routeIndex]!,
          sceneFamily: input.productionBrief.availableScenes[routeIndex % Math.max(1, input.productionBrief.availableScenes.length)]
            || '真实使用现场',
          cameraGrammar: routeIndex % 2 === 0 ? '主观跟拍' : '产品近景推进',
          pacing: routeIndex % 2 === 0 ? '前快后稳' : '动作点跳切',
          proofMechanism: proofMechanisms[routeIndex]!,
          ctaStyle: ctaStyles[routeIndex]!,
        },
        productionLoad: {
          locationCount: 1,
          personCount: input.productionBrief.appearanceMode === 'person' ? 1 : 0,
          majorActionCount: executionBudget.maxMajorActionCount,
          propCount: Math.min(1, executionBudget.maxPropCount),
          cameraMoveCount: Math.min(2, executionBudget.maxCameraMoveCount),
          hasMagicTransition: false,
        },
        rank: index + 1,
      });
    });
    return { concepts, usage: fakeUsage() };
  }

  async generateUseDirectionDrafts(input: PromptWizardUseDirectionDraftGenerationContext) {
    validatePromptWizardUseDirectionDraftContext(input);
    await fakeDelay();
    return {
      drafts: input.planContexts.map(context => (
        buildFakePromptWizardUseDirectionDraft(input, context.planIndex)
      )),
      usage: fakeUsage(),
      formatRepairCount: 0,
    };
  }

  async repairUseDirectionDrafts(
    input: PromptWizardUseDirectionDraftGenerationContext & {
      previousDrafts: PromptWizardPlanDraft[];
      issues: PromptWizardDraftContentRepairIssue[];
      operation?: 'repair-draft-content' | 'refine-plan';
    },
  ) {
    const repairContext = isPromptWizardV6DraftContext(input)
      ? promptWizardDeepFreezeRepairSnapshot(structuredClone(input))
      : input;
    validatePromptWizardUseDirectionDraftContext(repairContext);
    const issues = validatePromptWizardUseDirectionDraftRepairInput(repairContext);
    await fakeDelay();
    return {
      drafts: issues.map(issue => ({
        planIndex: issue.planIndex,
        draft: buildFakePromptWizardUseDirectionRepairDraft(repairContext, issue),
      })),
      usage: fakeUsage(),
    };
  }

  async generateDrafts(input: Parameters<PromptWizardProvider['generateDrafts']>[0]) {
    await fakeDelay();
    const conceptDirectorVariation = input.conceptAssignments.every(assignment => (
      assignment.score.total === 0
    )) && input.variationKey > 1
      ? input.variationKey
      : 0;
    return {
      drafts: PROMPT_WIZARD_LEGACY_PLAN_INDEXES.map(planIndex => (
        buildFakePromptWizardDraft(input, planIndex, conceptDirectorVariation)
      )),
      usage: fakeUsage(),
    };
  }

  async repairDrafts(input: Parameters<PromptWizardProvider['repairDrafts']>[0]) {
    const issues = validatePromptWizardDraftContentRepairInput(input);
    if (input.operation === 'refine-plan' && issues.length !== 1) {
      throw promptWizardProviderInputError('单方案定向微调只能提供一个方案索引');
    }
    await fakeDelay();
    return {
      drafts: issues.map(issue => ({
        planIndex: issue.planIndex,
        draft: input.operation === 'refine-plan'
          ? buildFakePromptWizardRefinementDraft(input, issue)
          : buildFakePromptWizardRepairDraft(input, issue),
      })),
      usage: fakeUsage(),
    };
  }
}

const FAKE_PROMPT_WIZARD_EXECUTABLE_PRODUCT_ACTION =
  /(?:拿|放|按|压|拨|推|拉|旋|拧|折|开|合|扣|穿|戴|取|倒|滴|喷|涂|刷|擦|撕|拆|插|拔|滑|转|抬|落|展开|收起|点亮|熄灭|揭开|移动|停住|碰|敲|晃|举起)/u;

function fakePromptWizardExecutableProofAction(value: string) {
  const normalized = value.trim().replace(/[。．.]+$/u, '');
  return FAKE_PROMPT_WIZARD_EXECUTABLE_PRODUCT_ACTION.test(normalized)
    ? normalized
    : `手拿起产品并${normalized}`;
}

function fakeConceptEvidenceAction(input: {
  routeIndex: number;
  evidenceText: string;
  proofAction: string;
  maxMajorActionCount: number;
}) {
  // Mini 5 秒只有一个主要动作预算。开场与产品自证必须复用同一动作族，
  // 不能先“拿起”再执行折叠、按压或放置，否则概念阶段会低报复杂度，
  // 扩写后再被真实分镜预算拒绝。每条路线的证据文字仍完整保留。
  const routeActions = [
    '手继续取用产品并把证据部位保持在镜头前',
    '手翻转产品到正面并停在证据部位',
    '手按住产品可见部位并保持当前使用状态',
    '手沿正确使用方向移动产品并停在证据部位',
    '手把产品放到真实任务中心并露出证据部位',
    '手把产品放到问题中心并保持证据部位可见',
    '手展开产品并保持证据部位完整可见',
    '手抬起处于结果状态的产品并对准证据部位',
  ] as const;
  const routeAction = routeActions[input.routeIndex % routeActions.length]!;
  if (input.maxMajorActionCount <= 1) {
    return `${routeAction}，镜头只验证“${input.evidenceText}”`;
  }
  return `${routeAction}；随后${input.proofAction}，动作中只验证“${input.evidenceText}”`;
}

function buildFakePromptWizardUseDirectionDraft(
  input: PromptWizardUseDirectionDraftGenerationContext,
  planIndex: PromptWizardPlanIndex,
  expressionVariant = 0,
) {
  const context = promptWizardDraftContextForPlanIndex(input, planIndex);
  const soundDesignOnly = isPromptWizardV6SoundDesignOnly(input);
  const targetLanguage = soundDesignOnly
    ? undefined
    : promptWizardRequiredTargetLanguage(input);
  const reliable = context.variant === 'reliable';
  // variationKey 随批次 ordinal 递增；内容修复再向后推进一个表达槽位。
  // Fake Provider 必须模拟真实模型的“换一批”语义，否则权威历史差异门禁
  // 会正确拒绝完全相同的测试稿，掩盖真实队列与计费链路。
  // V6 三个商业角色是三次独立的单方案调用。Fake Provider 也必须让
  // 每个角色从不同表达槽位起步，否则 planIndex 不在本次数组下标里时
  // 三次调用会产出同一镜头语法，误触集合差异门禁。V5 仍保持原有
  // A/B 同轮表达规则，避免改变历史测试与运行语义。
  const routeExpressionOffset = 'routeRole' in context ? planIndex : 0;
  const variationRound = Math.max(0, input.variationKey - 1)
    + expressionVariant
    + routeExpressionOffset;
  const treatmentIndex = variationRound % 4;
  const treatmentLabels = ['现场直录', '路径切换', '细节追踪', '结果回看'] as const;
  const treatmentLabel = treatmentLabels[treatmentIndex]!;
  const roles = promptWizardDraftShotRoles(input);
  const perspective = context.useDirection.appearanceMode === 'person'
    ? (reliable
      ? [
        '人物侧面中近景持续跟随视角',
        '人物肩后连续观察视角',
        '人物正侧方中近景跟随视角',
        '低机位人物与产品同框视角',
      ][treatmentIndex]!
      : [
        '人物主观视角与产品微距视角',
        '产品低机位近景与人物反应视角',
        '越肩视角突然切入产品极近景',
        '产品正面缓慢推近后切人物主观视角',
      ][treatmentIndex]!)
    : context.useDirection.appearanceMode === 'hands-only'
      ? (reliable
        ? [
          '俯拍横移跟随手部操作视角',
          '桌面平视手部连续操作视角',
          '手部肩后跟随与产品中近景视角',
          '低机位手部与产品同框视角',
        ][treatmentIndex]!
        : [
          '手部主观视角与产品微距视角',
          '产品低机位极近景与手部切入视角',
          '越肩手部视角突然切入产品细节',
          '产品正面持续推近后切手部主观视角',
        ][treatmentIndex]!)
      : (reliable
        ? [
          '俯拍缓慢横移纯产品视角',
          '桌面平视纯产品连续观察视角',
          '产品侧后方稳定跟随视角',
          '低机位产品轮廓观察视角',
        ][treatmentIndex]!
        : [
          '纯产品微距揭晓视角',
          '产品低机位极近景揭晓视角',
          '产品侧面突然切入细节特写',
          '产品正面持续推近后切微距视角',
        ][treatmentIndex]!);
  const camera = reliable
    ? [
      '镜头持续跟随产品动作，动作落点切到近景核对细节',
      '平视镜头沿动作方向横移，完成时回到产品整体',
      '肩后镜头稳定跟随动作，证据出现时缓慢靠近',
      '低机位保持产品轮廓完整，动作落点后轻微环绕',
    ][treatmentIndex]!
    : [
      '主观视角第一秒快速推近产品局部，随后微距揭晓证据',
      '低机位从局部突然拉开，证据出现时立即锁定',
      '越肩视角快速切入极近景，用短促推进揭开证据',
      '正面持续推近后突然切到微距，动作落点立即横移追踪',
    ][treatmentIndex]!;
  const pacing = reliable
    ? [
      '采用一镜到底的连续动作，保留完整操作过程',
      '采用起点、过程、落点三拍均匀推进，动作之间自然衔接',
      '先跟随动作再缓慢靠近证据，结尾切换到产品整体',
      '先呈现完整结果再顺势回看动作，收尾保持平稳',
    ][treatmentIndex]!
    : [
      '开场快切进入动作，证据出现时持续推近，结尾快速回扣',
      '先用突然拉开制造揭晓，再以短促跳切锁定证据',
      '第一秒高密度切入细节，中段放慢核对，结尾迅速反问',
      '开场横移制造等待，动作落点突然加速并以跟随收束',
    ][treatmentIndex]!;
  const useMoment = context.useDirection.useMoment
    .trim()
    .replace(/[。．.；;！？!?]+$/gu, '');
  const audienceNeed = context.useDirection.audienceNeed
    .trim()
    .replace(/[。．.；;！？!?]+$/gu, '');
  // V6 每个镜头都应围绕单一可拍动作。路线原文可能把
  // “取用—折叠—佩戴”等完整流程塞在同一个字段里；Fake Provider 应
  // 直接模拟遵守生成约束的首稿，而不是依赖领域层额外修复。
  const sceneMainAction = 'routeRole' in context
    ? promptWizardSingleFamilyAction(context.selectedScene.mainAction)
    : context.selectedScene.mainAction;
  const routeProofAction = 'routeRole' in context
    ? promptWizardSingleFamilyAction(context.useDirection.proofAction)
    : context.useDirection.proofAction;
  const firstAction = reliable
    ? [
      `${sceneMainAction}，镜头持续跟随动作起点并在落点切换近景。`,
      `${sceneMainAction}，平视镜头从动作起点横移到证据落点。`,
      `${sceneMainAction}，肩后镜头跟随同一动作并靠近证据部位。`,
      `${sceneMainAction}，低机位先保留产品轮廓再停在动作结果。`,
    ][treatmentIndex]!
    : [
      `第一秒从产品局部近景执行${sceneMainAction}，动作落点立即揭晓证据。`,
      `第一秒从低机位局部执行${sceneMainAction}，镜头突然拉开揭晓产品整体。`,
      `第一秒从越肩近景执行${sceneMainAction}，极近景立即锁定证据部位。`,
      `第一秒镜头沿产品正面横移并执行${sceneMainAction}，落点快速推近。`,
    ][treatmentIndex]!;
  const ctaAction = reliable
    ? [
      `产品保持在完成后的真实使用状态，画面以完整结果回应${audienceNeed}。`,
      `镜头回到产品整体与动作落点，用平静确认式收束回应${audienceNeed}。`,
      `证据部位保持清楚可见，以近距离核对式结尾回应${audienceNeed}。`,
      `完整结果再次进入画面，镜头持续后拉并用直接购买行动回应${audienceNeed}。`,
    ][treatmentIndex]!
    : [
      `镜头持续推近第一秒动作的证据落点，以直接购买行动回扣${audienceNeed}。`,
      `产品整体随镜头横移继续揭晓，以直接购买行动回扣${audienceNeed}。`,
      `极近景证据放慢一拍，以挑战式提问收束并回扣${audienceNeed}。`,
      `镜头跟随动作结果并快速切换景别，以直接购买行动回扣${audienceNeed}。`,
    ][treatmentIndex]!;
  const v6ShotSizeTreatments = [
    ['中近景', '产品特写'],
    ['桌面平视近景', '产品局部近景'],
    ['肩后中景', '证据微距'],
    ['低机位中近景', '产品轮廓特写'],
  ] as const;
  const v6LightingTreatments = [
    '自然侧光和真实环境质感，产品外观严格参考 @图片1',
    '柔和窗边光和真实桌面反射，产品外观严格参考 @图片1',
    '环境顺光与局部细节层次，产品外观严格参考 @图片1',
    '自然逆光轮廓与真实材质反应，产品外观严格参考 @图片1',
  ] as const;
  const v6FoleyTreatments = [
    '同步收录现场触碰与材质摩擦，让连续动作保持原始空间感',
    '木质台面的空间回声由近至远滑过左右声道，以清脆扣合声标记动作落点',
    '收紧环境底噪，以近距离指腹摩擦和部件接触声突出细节核对',
    '先用安静底噪留出结果停顿，再以产品落位声完成回看收束',
  ] as const;
  const wire = {
    name: reliable
      ? `${context.useDirection.title} · ${treatmentLabel}易落地演示`
      : `${context.useDirection.title} · ${treatmentLabel}强钩子揭晓`,
    hook: reliable
      ? `从${useMoment}以${treatmentLabel}方式直接进入真实产品动作`
      : `第一秒以${treatmentLabel}方式执行${context.selectedScene.mainAction}并制造产品揭晓`,
    narrative: reliable
      ? `在${context.selectedScene.title}以${treatmentLabel}路径完成“动作起点—证据落点—需求回应”，只证明“${context.useDirection.purchaseReason}”`
      : `在${context.selectedScene.title}以${treatmentLabel}路径完成“等待—揭晓—证据追踪—购买回扣”，只证明“${context.useDirection.purchaseReason}”`,
    primaryScene: `${context.selectedScene.title}：${context.selectedScene.environment}，采用${treatmentLabel}画面组织`,
    cameraAndPacing: `${camera}；${pacing}`,
    differenceTags: reliable
      ? [`${treatmentLabel}完整动作`, `${treatmentLabel}跟随观察`, `${treatmentLabel}直接自证`]
      : [`${treatmentLabel}第一秒事件`, `${treatmentLabel}近景揭晓`, `${treatmentLabel}节奏反问`],
    planningReview: {
      targetAudience: input.profile.suggestedAudience || '正在判断产品是否适合当前场景的用户',
      surfaceNeed: context.useDirection.audienceNeed,
      realPainPoint: '需要通过真实动作确认产品是否适合当前使用时刻',
      nonAdEntry: reliable ? '从真实使用动作直接切入' : '从第一秒产品状态变化切入',
      directionFit: `所选动作能够在${context.selectedScene.title}直接展示产品证据`,
    },
    segments: roles.map((role, segmentIndex) => ({
      role,
      location: context.selectedScene.environment,
      subject: soundDesignOnly && segmentIndex === roles.length - 1
        ? `${perspective}中清晰可见的 @图片1 对应${input.profile.category}`
        : `${perspective}中的 @图片1 对应${input.profile.category}`,
      shotSize: 'routeRole' in context
        ? v6ShotSizeTreatments[treatmentIndex]![segmentIndex === 0 ? 0 : 1]
        : segmentIndex === 0
          ? (reliable ? '中近景' : '产品近景')
          : '手部与产品特写',
      action: soundDesignOnly
        ? promptWizardSingleFamilyAction(routeProofAction)
        : role === 'hook'
        ? firstAction
        : role === 'proof' || role === 'proof-resolution'
          ? `${routeProofAction}，只验证“${context.useDirection.purchaseReason}”。`
          : role === 'resolution'
            ? '继续呈现前段动作结果，镜头横移追踪产品证据。'
            : ctaAction,
      // 5 秒纯视觉分支只有一个商品动作，两个镜头也必须沿同一条运镜
      // 语法连续推进。若复用痛点路线里的“突然拉开/立即锁定”，会先
      // 触发视觉收口修复，再因混合运镜触发执行预算修复，造成不必要的
      // 二次 Provider 调用。Fake Provider 在这里直接模拟合格首稿。
      cameraMovement: soundDesignOnly ? '持续缓慢推近' : camera,
      lightingAndRealism: 'routeRole' in context
        ? v6LightingTreatments[treatmentIndex]!
        : '自然光和真实环境质感，产品外观严格参考 @图片1',
      voiceover: soundDesignOnly ? '' : targetLanguage === '普通话'
        ? createFakeUseDirectionVoiceover(input, planIndex, segmentIndex, true)
        : createFakeUseDirectionVoiceover(input, planIndex, segmentIndex, false),
      voiceoverZh: soundDesignOnly || targetLanguage === '普通话'
        ? ''
        : createFakeUseDirectionVoiceoverZh(input, planIndex, segmentIndex),
      foley: 'routeRole' in context
        ? `${v6FoleyTreatments[treatmentIndex]}；${fakeFoleyForRole(role)}`
        : fakeFoleyForRole(role),
      editingCue: `${pacing}；在动作点切换景别`,
      productionNote: '生成后核对产品结构、Logo 与参考素材保持一致。',
    })),
    productionWarnings: input.profile.logo
      ? ['参考图片包含可读 Logo 或印花，需检查文字与图案稳定性。']
      : [],
  };
  const fullDraftSlotContract = promptWizardFullDraftSlotContract(
    input,
    roles.length,
  );
  const wireWithVoiceoverContract = fullDraftSlotContract
    ? {
        ...wire,
        segments: wire.segments.map(segment => ({
          ...segment,
          voiceover: '',
          voiceoverZh: '',
        })),
        voiceoverSlots: Object.fromEntries(
          fullDraftSlotContract.segments.map(segmentContract => {
            const source = wire.segments[segmentContract.segmentIndex]!;
            return fullDraftSlotContract.format === 'full-plan-indexed-word-slots-v1'
              ? [segmentContract.property, {
                  voiceoverWords: source.voiceover.split(' '),
                  voiceoverZh: source.voiceoverZh,
                }]
              : fullDraftSlotContract.format === 'full-plan-indexed-character-arrays-v3'
                ? [segmentContract.property, Array.from(source.voiceover)]
                : [segmentContract.property, {
                    voiceoverText: source.voiceover,
                    voiceoverZh: source.voiceoverZh,
                  }];
          }),
        ),
      }
    : wire;
  const compactWireV2 = usesPromptWizardCompactDraftWireV2(input, roles.length);
  const providerWire = compactWireV2
    ? {
        hook: wireWithVoiceoverContract.hook,
        shots: wireWithVoiceoverContract.segments.map(segment => ({
          shotSize: segment.shotSize,
          action: segment.action,
          cameraMovement: segment.cameraMovement,
          lightingAndRealism: segment.lightingAndRealism,
          foley: segment.foley,
          editingCue: segment.editingCue,
        })),
        ...('voiceoverSlots' in wireWithVoiceoverContract
          ? { voiceoverSlots: wireWithVoiceoverContract.voiceoverSlots }
          : {}),
    }
    : wireWithVoiceoverContract;
  const decodedDraft = decodePromptWizardUseDirectionDraftWirePlan(
    providerWire,
    input,
    planIndex,
    expectedPromptWizardDraftSegmentCount(input),
    compactWireV2 ? { compactV2: 'initial' } : {},
  );
  const semanticDraft = isPromptWizardV6DraftContext(input)
    && !isPromptWizardV6SoundDesignOnly(input)
    ? promptWizardPlanDraftSchema.parse({
        ...decodedDraft,
        segments: decodedDraft.segments.map((segment, segmentIndex) => ({
          ...segment,
          voiceover: wire.segments[segmentIndex]!.voiceover,
          voiceoverZh: wire.segments[segmentIndex]!.voiceoverZh,
        })),
      })
    : decodedDraft;
  if (!isPromptWizardV6DraftContext(input)) return semanticDraft;
  const segmentCount = expectedPromptWizardDraftSegmentCount(input);
  const flatProviderWire = encodePromptWizardFlatScalarDraft(
    semanticDraft,
    input,
    segmentCount,
    'creative',
  );
  return decodePromptWizardFlatScalarCreativePlan({
    value: flatProviderWire,
    context: input,
    planIndex,
    segmentCount,
    mode: 'creative',
  });
}

function buildFakePromptWizardUseDirectionRepairDraft(
  input: PromptWizardUseDirectionDraftRepairContext,
  issue: PromptWizardDraftContentRepairIssue,
) {
  const previous = input.previousDrafts[issue.planIndex];
  if (!previous) throw promptWizardProviderInputError('待修复方案不存在');
  const template = buildFakePromptWizardUseDirectionDraft(
    input,
    issue.planIndex,
    Math.max(1, input.costOwner?.repairRound ?? 1),
  );
  if (isPromptWizardV6DraftContext(input)) {
    const segmentCount = expectedPromptWizardDraftSegmentCount(input);
    const voiceoverOnly = !isPromptWizardV6SoundDesignOnly(input)
      && isPromptWizardVoiceoverOnlyRepairIssue(issue);
    const flatLayout = createPromptWizardFlatScalarLayout(
      input,
      segmentCount,
      voiceoverOnly ? 'voiceover' : 'creative',
    );
    const flatProviderWire = encodePromptWizardFlatScalarDraft(
      template,
      input,
      segmentCount,
      voiceoverOnly ? 'voiceover' : 'creative',
    );
    const flatRepairOwnership = promptWizardFlatScalarRepairOwnershipProjection({
      context: input,
      issue,
      layout: flatLayout,
      segmentCount,
    });
    const decodedTemplate = voiceoverOnly
      ? decodePromptWizardFlatScalarVoiceoverPatch(
          flatProviderWire,
          input,
          issue,
          segmentCount,
          { repairOwnership: flatRepairOwnership },
        )
      : decodePromptWizardFlatScalarCreativePlan({
          value: flatProviderWire,
          context: input,
          planIndex: issue.planIndex,
          segmentCount,
          mode: 'creative',
          ...(flatRepairOwnership ? { repairOwnership: flatRepairOwnership } : {}),
        });
    return mergePromptWizardUseDirectionRepairedDraft({
      previousDraft: previous,
      repairedDraft: decodedTemplate,
      issue,
      v6CompactOwnership: true,
    });
  }
  const repaired = structuredClone(previous) as PromptWizardPlanDraft;
  for (const fieldPath of issue.fieldPaths) {
    copyFakePromptWizardRepairField(repaired, template, fieldPath);
  }
  return promptWizardPlanDraftSchema.parse(repaired);
}

function buildFakePromptWizardDraft(
  input: Parameters<PromptWizardProvider['generateDrafts']>[0],
  planIndex: number,
  expressionVariant = 0,
): PromptWizardPlanDraft {
  if (!isPromptWizardPlanIndex(planIndex)) {
    throw promptWizardProviderInputError('方案索引必须是 0 或 1');
  }
  const segmentCount = expectedPromptWizardSegmentCount(input.config.durationSeconds);
  const shotRoles = promptWizardShotRoles(input.config.durationSeconds);
  const directionBlueprint = getPromptWizardDirectionBlueprint(input.brief.direction);
  const concept = assignedPromptWizardConcept(input, planIndex);
  const strategy = input.strategies[planIndex]!;
  const isFirstRepair = expressionVariant % 2 === 1;
  const expressionLabel = isFirstRepair ? '分段追踪' : '逆序验证';
  const distinctiveTreatment = fakeConceptDistinctiveTreatment(concept);
  const evidenceAllocation = allocatePromptWizardEvidence({
    evidenceGraph: input.evidenceGraph,
    shotRoles,
    planIndex,
    preferredFactIds: concept.evidenceIds,
  });

  return {
    name: (expressionVariant > 0
      ? `${directionBlueprint.label} · ${concept.scene}${expressionLabel}`
      : `${directionBlueprint.label} · ${concept.fingerprint.openingAction}`).slice(0, 80),
    hook: expressionVariant > 0
      ? `${concept.perspective}先锁定${concept.scene}中的动作变化：${concept.openingAction}`
      : concept.openingAction,
    narrative: expressionVariant > 0
      ? (isFirstRepair
        ? `${concept.proofAction}；随后回应“${concept.painExpression}”；最后${concept.visibleResult}；独特声画路径采用${distinctiveTreatment}`
        : `${concept.visibleResult}；再回溯${concept.midpointEscalation}；以${concept.progression}解释过程；独特声画路径采用${distinctiveTreatment}`)
      : `${concept.progression}；${concept.midpointEscalation}；${concept.visibleResult}`,
    primaryScene: expressionVariant > 0
      ? `${concept.scene}，观看关系采用${concept.perspective}，围绕“${concept.audienceMotivation}”组织空间，并执行${distinctiveTreatment}`
      : `${concept.scene}，采用${concept.perspective}`,
    cameraAndPacing: expressionVariant > 0
      ? `${strategy.cameraGrammar}负责追踪“${concept.openingAction}”，${strategy.pacing}承接${strategy.proofMechanism}，声音按${concept.cameraSoundGrammar}处理；本方案以${distinctiveTreatment}形成辨识度`
      : concept.cameraSoundGrammar,
    differenceTags: [
      expressionVariant > 0 ? `${strategy.hookType}开局` : strategy.hookType,
      expressionVariant > 0 ? `${strategy.sceneFamily}场域` : strategy.sceneFamily,
      expressionVariant > 0 ? `${strategy.proofMechanism}自证` : strategy.proofMechanism,
      expressionVariant > 0 ? `${strategy.ctaStyle}收束` : strategy.cameraGrammar,
    ],
    planningReview: {
      targetAudience: concept.targetAudience,
      surfaceNeed: `希望快速判断产品是否适合${input.profile.suggestedScenarios || '日常使用场景'}`,
      realPainPoint: expressionVariant > 0
        ? `${concept.targetAudience}在${concept.scene}中面对“${concept.painExpression}”`
        : concept.painExpression,
      nonAdEntry: expressionVariant > 0
        ? `不铺陈口号，让${concept.perspective}直接观察：${concept.openingAction}`
        : concept.openingAction,
      proofPoints: evidenceAllocation.proofPoints,
      directionFit: expressionVariant > 0
        ? `以${strategy.narrativeArc}组织${strategy.proofMechanism}，用${distinctiveTreatment}建立声画辨识，并以${strategy.ctaStyle}收束，保持“${directionBlueprint.label}”方向。`
        : `以${concept.progression}推进，符合“${directionBlueprint.label}”的方向目标。`,
    },
    segments: shotRoles.slice(0, segmentCount).map((role, segmentIndex) => ({
      role,
      location: expressionVariant > 0
        ? `${concept.scene}的${fakeRoleStageLabel(role)}位置，以${concept.perspective}建立观看关系`
        : concept.scene,
      subject: segmentIndex === 0 ? '目标用户与 @图片1 对应产品' : '@图片1 对应产品与操作手部',
      shotSize: segmentIndex === 0 ? '中近景' : '手部与产品特写',
      action: expressionVariant > 0
        ? `${fakeConceptRepairActionForRole(concept, strategy, role, isFirstRepair)}`
        : fakeConceptActionForRole(concept, role),
      cameraMovement: `${strategy.cameraGrammar}，保持主体方向连续`,
      lightingAndRealism: `${directionBlueprint.visualStyle[segmentIndex % directionBlueprint.visualStyle.length]}，产品外观严格参考 @图片1`,
      voiceover: input.brief.targetLanguage === '普通话'
        ? createFakeVoiceoverZh(planIndex, segmentIndex)
        : createFakeVoiceover(planIndex, segmentIndex),
      voiceoverZh: input.brief.targetLanguage === '普通话'
        ? ''
        : createFakeVoiceoverZh(planIndex, segmentIndex),
      foley: fakeFoleyForRole(role),
      editingCue: `${strategy.pacing}，在动作完成点剪切`,
      evidenceRefs: evidenceAllocation.evidenceRefsByShot[segmentIndex]!,
      productionNote: input.profile.logo
        ? 'Logo 与可见印花需严格参考素材，生成后检查文字稳定性。'
        : '生成后核对产品外观、结构与参考素材保持一致。',
    })),
    productionWarnings: input.profile.logo
      ? ['参考图片包含可读 Logo 或印花，成片需检查文字与图案是否稳定。']
      : [],
  };
}

function buildFakePromptWizardRepairDraft(
  input: Parameters<PromptWizardProvider['repairDrafts']>[0],
  issue: PromptWizardDraftContentRepairIssue,
) {
  const previousDraft = input.previousDrafts[issue.planIndex];
  if (!previousDraft) throw promptWizardProviderInputError('待修复方案不存在');
  const expressionVariant = Math.max(1, input.costOwner?.repairRound ?? 1);
  const repairedTemplate = buildFakePromptWizardDraft(input, issue.planIndex, expressionVariant);
  const repairedDraft = structuredClone(previousDraft) as PromptWizardPlanDraft;
  for (const fieldPath of issue.fieldPaths) {
    copyFakePromptWizardRepairField(repairedDraft, repairedTemplate, fieldPath);
  }
  return promptWizardPlanDraftSchema.parse(repairedDraft);
}

function buildFakePromptWizardRefinementDraft(
  input: Parameters<PromptWizardProvider['repairDrafts']>[0],
  issue: PromptWizardDraftContentRepairIssue,
) {
  const previousDraft = input.previousDrafts[issue.planIndex];
  if (!previousDraft) throw promptWizardProviderInputError('待微调方案不存在');
  const refined = structuredClone(previousDraft) as PromptWizardPlanDraft;
  const action = issue.action.normalize('NFKC');
  const targetScene = action.match(
    /(?:replacementScene|目标场景|更换场景)\s*[:=：]\s*([^；;\n]{1,300})/iu,
  )?.[1]?.trim();

  if (/stronger-hook|钩子更强|强化钩子/iu.test(action)) {
    refined.hook = `第一秒直接发生可见动作：${refined.hook}`.slice(0, 300);
    const opening = refined.segments[0];
    if (opening) {
      opening.action = `画面立即执行：${opening.action}`.slice(0, 300);
      opening.editingCue = '动作发生即进入镜头，不做铺垫，证据出现后持续推近并切换景别。';
    }
  } else if (/less-ad-like|降低广告感|弱化广告感/iu.test(action)) {
    refined.hook = `从真实使用瞬间自然切入：${refined.hook}`.slice(0, 300);
    refined.narrative = `像记录日常一样推进，不做口号式介绍；${refined.narrative}`.slice(0, 500);
  } else if (/product-only|纯产品/iu.test(action)) {
    refined.primaryScene = `${targetScene || refined.primaryScene}，只展示产品与必要承托道具`.slice(0, 300);
    refined.segments.forEach(segment => {
      segment.subject = '@图片1 对应产品与必要承托道具';
      segment.action = `不出现人物或手部，由产品状态与镜头运动完成：${segment.action}`.slice(0, 300);
      segment.productionNote = '只生成产品、现有场景和必要承托道具，不出现人物或手部。';
    });
  } else if (/no-face|无人露脸|不露脸/iu.test(action)) {
    refined.segments.forEach(segment => {
      segment.subject = '不露脸的局部身体、手部与 @图片1 对应产品';
      segment.productionNote = '人物面部始终不入镜，使用手部、肩背或第一视角完成动作。';
    });
  } else if (/change-scene|更换.*场景/iu.test(action) && targetScene) {
    refined.primaryScene = targetScene;
    refined.segments.forEach(segment => {
      segment.location = targetScene;
      segment.productionNote = `只使用用户指定的现有场景“${targetScene}”，不新增其他地点。`;
    });
  } else if (/simplify-production|简化镜头|简化动作|降低.*复杂/iu.test(action)) {
    const location = refined.segments[0]?.location || refined.primaryScene;
    refined.primaryScene = `${location}，单地点连续完成`.slice(0, 300);
    refined.cameraAndPacing = '持续缓慢推进并在动作点切换景别，动作连续、剪辑克制。';
    refined.segments.forEach(segment => {
      segment.location = location;
      segment.cameraMovement = '沿动作方向持续缓慢推进或横移，证据出现时切换近景。';
      segment.editingCue = '沿连续动作在动作点直接剪接，不使用复杂转场。';
    });
  } else if (/natural-voiceover|口播.*自然|自然.*口播/iu.test(action)) {
    refined.segments.forEach((segment, segmentIndex) => {
      segment.voiceover = input.brief.targetLanguage === '普通话'
        ? createFakeVoiceoverZh(issue.planIndex, segmentIndex)
        : createFakeVoiceover(issue.planIndex, segmentIndex);
      segment.voiceoverZh = input.brief.targetLanguage === '普通话'
        ? ''
        : createFakeVoiceoverZh(issue.planIndex, segmentIndex);
    });
  } else {
    const template = buildFakePromptWizardDraft(input, issue.planIndex, 1);
    issue.fieldPaths.forEach(fieldPath => {
      copyFakePromptWizardRepairField(refined, template, fieldPath);
    });
  }
  return promptWizardPlanDraftSchema.parse(refined);
}

function copyFakePromptWizardRepairField(
  target: PromptWizardPlanDraft,
  source: PromptWizardPlanDraft,
  fieldPath: string,
) {
  const tokens = fieldPath.match(/[A-Za-z]+|\d+/gu) ?? [];
  if (tokens.length === 0 || tokens.some(token => ['__proto__', 'prototype', 'constructor'].includes(token))) {
    throw promptWizardProviderInputError('方案修复字段路径无效');
  }
  let targetNode = target as unknown as Record<string, unknown>;
  let sourceNode = source as unknown as Record<string, unknown>;
  for (const token of tokens.slice(0, -1)) {
    const nextTarget = targetNode[token];
    const nextSource = sourceNode[token];
    if (
      !nextTarget || typeof nextTarget !== 'object'
      || !nextSource || typeof nextSource !== 'object'
    ) {
      throw promptWizardProviderInputError('方案修复字段路径不存在');
    }
    targetNode = nextTarget as Record<string, unknown>;
    sourceNode = nextSource as Record<string, unknown>;
  }
  const leaf = tokens.at(-1)!;
  if (!Object.hasOwn(sourceNode, leaf)) {
    throw promptWizardProviderInputError('方案修复字段路径不存在');
  }
  targetNode[leaf] = structuredClone(sourceNode[leaf]);
}

function fakeConceptActionForRole(
  concept: PromptWizardConceptAssignment,
  role: ReturnType<typeof promptWizardShotRoles>[number],
) {
  if (role === 'hook') return `${concept.openingAction}，@图片1 对应产品在开场画面清楚可见。`;
  if (role === 'proof') return concept.proofAction;
  if (role === 'proof-resolution') return `${concept.proofAction}；${concept.visibleResult}`;
  if (role === 'resolution') return `${concept.midpointEscalation}；${concept.visibleResult}`;
  return `${concept.cta}，以真实使用状态自然收束。`;
}

function fakeConceptRepairActionForRole(
  concept: PromptWizardConceptAssignment,
  strategy: PromptWizardStrategy,
  role: ReturnType<typeof promptWizardShotRoles>[number],
  forward: boolean,
) {
  if (role === 'hook') {
    return forward
      ? `先呈现“${concept.audienceMotivation}”对应的生活动作，再执行：${concept.openingAction}`
      : `先让“${concept.painExpression}”进入画面，再由${concept.perspective}回溯：${concept.openingAction}`;
  }
  if (role === 'proof' || role === 'proof-resolution') {
    return forward
      ? `${concept.proofAction}；以${strategy.proofMechanism}连接到${concept.visibleResult}`
      : `${concept.visibleResult}；随后用${strategy.proofMechanism}回看${concept.proofAction}`;
  }
  if (role === 'resolution') {
    return forward
      ? `${concept.midpointEscalation}；在${concept.scene}完成${concept.visibleResult}`
      : `${concept.visibleResult}；镜头回到${concept.midpointEscalation}`;
  }
  return `${concept.cta}；用${strategy.ctaStyle}回扣“${concept.audienceMotivation}”。`;
}

function fakeRoleStageLabel(role: ReturnType<typeof promptWizardShotRoles>[number]) {
  if (role === 'hook') return '开场动作';
  if (role === 'proof') return '证据展示';
  if (role === 'proof-resolution') return '自证化解';
  if (role === 'resolution') return '结果呈现';
  return '自然收束';
}

const FAKE_VISUAL_TREATMENTS = [
  '前景遮挡后揭晓',
  '镜面边缘建立方向',
  '桌面轨迹逐步靠近',
  '门框纵深压缩空间',
  '窗边反光锁定细节',
  '手部入画触发动作',
  '背景先动主体后显',
  '产品落位触发转场',
] as const;

const FAKE_MOTION_TREATMENTS = [
  '由左下向右上推进',
  '先环绕观察再持续横移追踪',
  '从低机位平稳抬升',
  '锁定细节后快速抽离',
  '沿动作反向跟随',
  '在前后景间切换焦点',
  '短促推进后快速横移',
  '围绕操作手部局部移动',
] as const;

const FAKE_SOUND_TREATMENTS = [
  '主体接触声衔接环境底噪',
  '一次产品落位声作为剪辑点',
  '脚步声结束后保留短暂留白',
  '手部动作声串联镜头',
  '现场底噪由近到远渐弱',
  '产品触碰声先于画面变化',
  '桌面轻响触发结尾转场',
  '环境声由远及近引出主体',
] as const;

function fakeConceptDistinctiveTreatment(concept: PromptWizardConceptAssignment) {
  const digest = concept.candidateId.replace(/^concept-/u, '').padEnd(12, '0');
  const pick = <T>(values: readonly T[], offset: number) => {
    const parsed = Number.parseInt(digest.slice(offset, offset + 4), 16);
    return values[(Number.isFinite(parsed) ? parsed : concept.planIndex) % values.length]!;
  };
  return [
    pick(FAKE_VISUAL_TREATMENTS, 0),
    pick(FAKE_MOTION_TREATMENTS, 4),
    pick(FAKE_SOUND_TREATMENTS, 8),
  ].join('、');
}

function fakeFoleyForRole(role: ReturnType<typeof promptWizardShotRoles>[number]) {
  if (role === 'hook') return '保留现场环境底噪与人物接触产品的轻响。';
  if (role === 'proof' || role === 'proof-resolution') return '突出手部操作、部件接触和材质摩擦的真实声音。';
  if (role === 'resolution') return '环境声由紧促转为平稳，保留连续空间感。';
  return '降低环境声并保留产品落位的轻响，自然结束。';
}

function createFakeUseDirectionVoiceover(
  input: PromptWizardUseDirectionDraftGenerationContext,
  planIndex: PromptWizardPlanIndex,
  segmentIndex: number,
  chinese: boolean,
) {
  const context = promptWizardDraftContextForPlanIndex(input, planIndex);
  const expressionIndex = 'routeRole' in context
    ? (Math.max(0, input.variationKey - 1) + planIndex) % 4
    : 0;
  const targetLanguage = promptWizardRequiredTargetLanguage(input);
  const timeline = promptWizardDraftTimeline(input);
  if (isPromptWizardV6DraftContext(input)) {
    const product = fakePromptWizardProductLabel(input.profile);
    const lastSegmentIndex = timeline.length - 1;
    const candidates = chinese
      ? segmentIndex === 0
        ? [
            `${product}真实亮相。`,
            `${product}现在登场。`,
            `看这款${product}。`,
          ]
        : segmentIndex === lastSegmentIndex
          ? [
              '点击商品卡立即下单。',
              '现在打开商品卡选购。',
              '进入商品卡马上购买。',
            ]
          : segmentIndex === 1
            ? [
              `${context.useDirection.purchaseReason}。`,
              `可见细节证明${context.useDirection.purchaseReason}。`,
              `真实动作展示${context.useDirection.purchaseReason}。`,
              `近景证据支持${context.useDirection.purchaseReason}。`,
              '可见细节证明选择理由。',
              ]
            : [
                '真实结果说明它适合这个使用时刻。',
                '这个场景清楚呈现使用价值。',
                '日常环境让选择理由更清楚。',
              ]
      : targetLanguage === '泰语'
        ? segmentIndex === 0
          ? ['ดูสินค้านี้ทำงานจริง', 'ดูสินค้านี้ให้ชัด']
          : segmentIndex === lastSegmentIndex
            ? ['กดดูสินค้าแล้วซื้อเลย', 'เปิดการ์ดสินค้าแล้วเลือกเลย', 'กดซื้อสินค้าเลย']
            : ['รายละเอียดช่วยให้เลือก', 'เห็นเหตุผลที่เลือก', 'เห็นเหตุผลชัด']
        : targetLanguage === '日语'
          ? segmentIndex === 0
            ? ['この商品を実際に見よう。', 'この商品の動きを確認。']
            : segmentIndex === lastSegmentIndex
              ? ['商品カードから今すぐ購入。', '商品カードを開いて選ぼう。']
              : [
                  '見える特徴が選ぶ理由を示します。',
                  '実際の動きで特徴を確認できます。',
                  '特徴が理由を示す。',
                ]
          : segmentIndex === 0
            ? ['See this product work now.', 'Watch this product in action.']
            : segmentIndex === lastSegmentIndex
              ? ['Tap the product card and order now.', 'Open the product card to buy now.']
              : ['Visible details show why it fits your needs.', 'Real action makes the reason to choose clear.'];
    const offset = expressionIndex % candidates.length;
    const orderedCandidates = [
      ...candidates.slice(offset),
      ...candidates.slice(0, offset),
    ];
    return orderedCandidates[0]!;
  }
  const segmentBudgets = getPromptWizardSegmentVoiceoverBudgets({
    targetLanguage,
    durationSeconds: input.config.durationSeconds,
    segmentDurations: timeline.map(([start, end]) => end - start),
  });
  const targetUnits = segmentBudgets[segmentIndex]!.targetUnits;
  if (chinese) {
    const product = fakePromptWizardProductLabel(input.profile);
    const productSegment = input.config.durationSeconds === 5 ? 1 : 0;
    const bases = segmentIndex === productSegment
      ? [
          `${product}真实亮相`,
          `${product}动作开场`,
          `${product}近景登场`,
          `${product}结果入镜`,
        ][expressionIndex]!
      : segmentIndex === timeline.length - 1
        ? [
            '点击商品卡立即下单',
            '现在查看商品卡并购买',
            '打开商品卡马上选购',
            '进入商品卡立即购买',
          ][expressionIndex]!
        : segmentIndex === 1
          ? [
              `可见细节证明${context.useDirection.purchaseReason}`,
              `真实动作展示${context.useDirection.purchaseReason}`,
              `近景结果说明${context.useDirection.purchaseReason}`,
              `现场证据支持${context.useDirection.purchaseReason}`,
            ][expressionIndex]!
          : [
              '放在这个使用时刻更合适',
              '这个场景直接看见使用价值',
              '真实环境呈现动作结果',
              '日常节奏自然带出选择理由',
            ][expressionIndex]!;
    return fitFakeChineseVoiceover(bases, targetUnits);
  }
  if (getPromptWizardTotalVoiceoverBudget({
    targetLanguage,
    durationSeconds: input.config.durationSeconds,
  }).unit === 'characters') {
    const bases = targetLanguage === '泰语'
      ? segmentIndex === timeline.length - 1
        ? ['กดดูสินค้าเลยตอนนี้', 'เปิดดูสินค้าแล้วเลือกเลย', 'ดูการ์ดสินค้าแล้วซื้อเลย', 'เลือกสินค้านี้ได้ทันที'][expressionIndex]!
        : segmentIndex === 0
          ? ['ดูสินค้านี้ให้ชัดตอนนี้', 'ชมสินค้านี้ทำงานจริง', 'ดูวิธีใช้สินค้านี้ใกล้ชิด', 'เริ่มจากผลจริงของสินค้า'][expressionIndex]!
          : ['รายละเอียดนี้ช่วยให้เลือกได้', 'การใช้งานจริงแสดงเหตุผล', 'ภาพใกล้เผยรายละเอียดจริง', 'หลักฐานนี้ช่วยตัดสินใจ'][expressionIndex]!
      : segmentIndex === timeline.length - 1
        ? ['商品カードから今すぐ確認', '商品カードを開いて購入', '商品ページですぐ選ぶ', '商品カードから今すぐ購入'][expressionIndex]!
        : segmentIndex === 0
          ? ['この商品を今すぐ確認', 'この商品の動きを見る', 'この商品の使い方を確認', '商品の実際の結果を見る'][expressionIndex]!
          : ['見える特徴で選ぶ理由が分かる', '実際の動きが理由を示す', '近くで本当の特徴を確認', '見える証拠で選びやすい'][expressionIndex]!;
    return fitFakeTranslatedCharacterVoiceover(
      bases,
      targetUnits,
      targetLanguage,
    );
  }
  const bases = segmentIndex === timeline.length - 1
    ? [
        ['Tap', 'the', 'product', 'card', 'and', 'order', 'yours', 'now'],
        ['Open', 'the', 'product', 'card', 'then', 'order', 'yours', 'now'],
        ['Shop', 'from', 'the', 'product', 'card', 'and', 'order', 'now'],
        ['Choose', 'the', 'product', 'card', 'and', 'buy', 'yours', 'now'],
      ][expressionIndex]!
    : segmentIndex === 0
      ? [
          ['See', 'this', 'product', 'move', 'clearly', 'right', 'now'],
          ['Watch', 'this', 'product', 'work', 'in', 'real', 'use'],
          ['Check', 'this', 'product', 'closely', 'during', 'the', 'action'],
          ['Start', 'with', 'this', 'product', 'showing', 'real', 'results'],
        ][expressionIndex]!
      : segmentIndex === 1
        ? [
            ['This', 'visible', 'detail', 'proves', 'the', 'reason', 'to', 'choose', 'it', 'today'],
            ['The', 'real', 'action', 'shows', 'why', 'this', 'choice', 'fits', 'your', 'need'],
            ['A', 'closer', 'view', 'reveals', 'the', 'detail', 'behind', 'this', 'choice', 'now'],
            ['This', 'onscreen', 'proof', 'supports', 'the', 'reason', 'for', 'choosing', 'it', 'today'],
          ][expressionIndex]!
        : [
            ['It', 'fits', 'this', 'moment', 'and', 'keeps', 'the', 'useful', 'detail', 'clear'],
            ['The', 'scene', 'shows', 'how', 'the', 'result', 'fits', 'daily', 'use', 'naturally'],
            ['Real', 'surroundings', 'keep', 'the', 'action', 'and', 'visible', 'result', 'easy', 'to', 'judge'],
            ['A', 'daily', 'rhythm', 'connects', 'the', 'action', 'with', 'the', 'choice', 'clearly'],
          ][expressionIndex]!;
  return fitFakeWordVoiceover(bases, targetUnits);
}

function createFakeUseDirectionVoiceoverZh(
  input: PromptWizardUseDirectionDraftGenerationContext,
  planIndex: PromptWizardPlanIndex,
  segmentIndex: number,
) {
  const context = promptWizardDraftContextForPlanIndex(input, planIndex);
  const expressionIndex = 'routeRole' in context
    ? (Math.max(0, input.variationKey - 1) + planIndex) % 4
    : 0;
  const lastIndex = promptWizardDraftTimeline(input).length - 1;
  if (segmentIndex === 0) return [
    `看这款${fakePromptWizardProductLabel(input.profile)}如何直接进入使用动作`,
    `现在看这款${fakePromptWizardProductLabel(input.profile)}完成真实操作`,
    `近距离看这款${fakePromptWizardProductLabel(input.profile)}实际怎么用`,
    `先看这款${fakePromptWizardProductLabel(input.profile)}呈现真实结果`,
  ][expressionIndex]!;
  if (segmentIndex === lastIndex) return input.confirmedOffer?.trim()
    ? `${input.confirmedOffer.trim()}，现在点击商品卡立即下单`
    : [
        '现在点击商品卡查看商品并立即下单',
        '打开商品卡查看详情并马上购买',
        '进入商品卡选购并立即下单',
        '点击商品卡查看商品并马上购买',
      ][expressionIndex]!;
  if (segmentIndex === 1) return [
    `这个可见细节直接证明${context.useDirection.purchaseReason}`,
    `这段真实动作清楚展示${context.useDirection.purchaseReason}`,
    `近景结果直接说明${context.useDirection.purchaseReason}`,
    `画面中的证据支持${context.useDirection.purchaseReason}`,
  ][expressionIndex]!;
  return [
    `放在${context.useDirection.useMoment}使用更合适`,
    `${context.useDirection.useMoment}直接呈现使用价值`,
    `真实环境让${context.useDirection.useMoment}的结果更清楚`,
    `日常节奏自然连接${context.useDirection.useMoment}与选择理由`,
  ][expressionIndex]!;
}

function fakePromptWizardProductLabel(profile: PromptWizardProductProfile) {
  const candidates = [profile.category, profile.productName]
    .flatMap(value => value.match(/[\u3400-\u9fff]{2,12}/gu) ?? [])
    .map(value => value.slice(-6))
    .filter(Boolean)
    .sort((left, right) => left.length - right.length);
  return candidates[0] ?? '产品';
}

function fitFakeChineseVoiceover(value: string, targetUnits: number) {
  const characters = [...value].filter(character => /[\p{L}\p{N}]/u.test(character));
  const filler = [...'真实清楚现在值得看看马上选择'];
  while (characters.length < targetUnits) characters.push(filler[characters.length % filler.length]!);
  return characters.slice(0, targetUnits).join('');
}

function fitFakeTranslatedCharacterVoiceover(
  value: string,
  targetUnits: number,
  targetLanguage: string,
) {
  const characters = [...value].filter(isPromptWizardStrictTranslatedCharacter);
  const filler = targetLanguage === '泰语'
    ? [...'กดสนคาตอนน']
    : [...'商品確認今選理由'];
  while (characters.length < targetUnits) {
    characters.push(filler[characters.length % filler.length]!);
  }
  return characters.slice(0, targetUnits).join('');
}

function fitFakeWordVoiceover(words: string[], targetUnits: number) {
  const filler = ['clearly', 'today', 'right', 'now'];
  const result = [...words];
  while (result.length < targetUnits) result.push(filler[result.length % filler.length]!);
  return result.slice(0, targetUnits).join(' ');
}

function createFakeVoiceover(planIndex: number, segmentIndex: number) {
  const lines = [
    ['Watch this.', 'See why.', 'Fits well.', 'Your call.'],
    ['Look closer.', 'See details.', 'Judge it.', 'Choose naturally.'],
  ];
  return lines[planIndex]?.[segmentIndex] ?? '';
}

function createFakeVoiceoverZh(planIndex: number, segmentIndex: number) {
  const lines = [
    ['看这里', '看动作', '看结果', '你决定'],
    ['看细节', '看变化', '再判断', '按需选'],
  ];
  return lines[planIndex]?.[segmentIndex] ?? '';
}

type PromptWizardDraftJsonParseState = {
  classification: PromptWizardOutputDiagnosticClassification;
  normalizationMode: PromptWizardOutputNormalizationMode;
  maxContainerDepth: number;
};

type PromptWizardDraftJsonParseResult = PromptWizardDraftJsonParseState & {
  value: unknown;
};

function inspectPromptWizardDraftJsonShape(value: string): {
  classification: PromptWizardOutputDiagnosticClassification;
  maxContainerDepth: number;
  appendClosers: string | null;
} {
  const stack: Array<'}' | ']'> = [];
  let rootStarted = false;
  let rootClosed = false;
  let inString = false;
  let escaped = false;
  let mismatch = false;
  let extraRootValue = false;
  let maxContainerDepth = 0;
  for (const character of value) {
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"') inString = false;
      continue;
    }
    if (/\s/u.test(character)) continue;
    if (rootClosed) {
      extraRootValue = true;
      continue;
    }
    if (!rootStarted) {
      if (character !== '{') {
        return { classification: 'non-json', maxContainerDepth: 0, appendClosers: null };
      }
      rootStarted = true;
      stack.push('}');
      maxContainerDepth = 1;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') {
      stack.push(character === '{' ? '}' : ']');
      maxContainerDepth = Math.max(maxContainerDepth, stack.length);
      continue;
    }
    if (character === '}' || character === ']') {
      if (stack.at(-1) !== character) {
        mismatch = true;
        continue;
      }
      stack.pop();
      if (stack.length === 0) rootClosed = true;
    }
  }
  if (extraRootValue) {
    return { classification: 'multiple-root-values', maxContainerDepth, appendClosers: null };
  }
  if (mismatch) {
    return { classification: 'bracket-mismatch', maxContainerDepth, appendClosers: null };
  }
  if (inString) {
    return {
      classification: escaped ? 'escape-truncated' : 'string-truncated',
      maxContainerDepth,
      appendClosers: null,
    };
  }
  if (!rootStarted) {
    return { classification: 'non-json', maxContainerDepth, appendClosers: null };
  }
  if (!rootClosed && stack.length > 0) {
    return {
      classification: 'container-truncated',
      maxContainerDepth,
      appendClosers: [...stack].reverse().join(''),
    };
  }
  return {
    classification: rootClosed ? 'invalid-token' : 'unknown',
    maxContainerDepth,
    appendClosers: null,
  };
}

function tryParsePromptWizardDraftJsonCandidate(value: string) {
  assertPromptWizardJsonObjectKeysUnique(value);
  return JSON.parse(value) as unknown;
}

/**
 * V6 Draft 的解析只允许固定、可审计且不推测字段语义的规范化。新增的 EOF
 * 恢复只能向已开始且边界匹配的顶层对象追加缺失的 ]/}；JSON.parse 会再次
 * 确认当前 token 已完整。任何重复对象键都在 last-wins 生效前失败关闭。
 */
export function parsePromptWizardDraftJsonV2(
  outputText: string | undefined,
): PromptWizardDraftJsonParseResult {
  if (!outputText?.trim()) {
    const error = Object.assign(new Error('提示词模型没有返回结构化内容'), {
      code: 'PROMPT_WIZARD_PROVIDER_EMPTY',
    });
    Object.defineProperty(error, PROMPT_WIZARD_OUTPUT_PARSE_STATE, {
      value: {
        classification: 'non-json',
        normalizationMode: 'none',
        maxContainerDepth: 0,
      } satisfies PromptWizardDraftJsonParseState,
    });
    throw error;
  }

  const envelope = normalizePromptWizardJsonEnvelope(outputText);
  const escapedControls = escapeRawJsonStringControlCharacters(envelope);
  const extractedEnvelope = extractSinglePromptWizardJsonObject(escapedControls);
  const lexicallyRepaired = repairPromptWizardJsonLexicalNoise(extractedEnvelope);
  const candidates: Array<{
    value: string;
    normalizationMode: PromptWizardOutputNormalizationMode;
  }> = [
    { value: outputText, normalizationMode: 'native' },
    ...(envelope !== outputText
      ? [{ value: envelope, normalizationMode: 'fence-removed' as const }]
      : []),
    ...(escapedControls !== envelope
      ? [{ value: escapedControls, normalizationMode: 'control-character-escaped' as const }]
      : []),
    ...(extractedEnvelope !== escapedControls
      ? [{ value: extractedEnvelope, normalizationMode: 'single-object-extracted' as const }]
      : []),
    ...(lexicallyRepaired !== extractedEnvelope
      ? [{ value: lexicallyRepaired, normalizationMode: 'lexical-repair' as const }]
      : []),
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.value)) continue;
    seen.add(candidate.value);
    try {
      const value = tryParsePromptWizardDraftJsonCandidate(candidate.value);
      const shape = inspectPromptWizardDraftJsonShape(candidate.value);
      return {
        value,
        classification: 'valid-json',
        normalizationMode: candidate.normalizationMode,
        maxContainerDepth: shape.maxContainerDepth,
      };
    } catch {
      // 仅根据固定候选继续；禁止保存或传播原始 SyntaxError。
    }
  }

  const appendShape = inspectPromptWizardDraftJsonShape(envelope);
  if (appendShape.appendClosers) {
    const completed = `${envelope}${appendShape.appendClosers}`;
    try {
      const value = tryParsePromptWizardDraftJsonCandidate(completed);
      return {
        value,
        classification: 'valid-json',
        normalizationMode: 'append-closing-delimiters',
        maxContainerDepth: appendShape.maxContainerDepth,
      };
    } catch {
      // 当前 token 不完整或仍有其他语法损坏时，绝不能做进一步猜测修复。
    }
  }

  const shape = inspectPromptWizardDraftJsonShape(envelope);
  const error = Object.assign(new Error('提示词模型返回的 JSON 无法解析'), {
    code: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
  });
  Object.defineProperty(error, PROMPT_WIZARD_OUTPUT_PARSE_STATE, {
    value: {
      classification: shape.classification,
      normalizationMode: 'none',
      maxContainerDepth: shape.maxContainerDepth,
    } satisfies PromptWizardDraftJsonParseState,
  });
  throw error;
}

/**
 * Flat Scalar Wire 复用既有围栏移除、控制字符转义、单对象提取与词法修复
 * 计数语义，但合法响应的容器深度只能为一。唯一允许的 EOF 规范化是给
 * 已完成最后一个根标量值的对象追加一个 `}`；任何 `]` 或嵌套 `}` 都失败关闭。
 */
export function parsePromptWizardFlatScalarJson(
  outputText: string | undefined,
): PromptWizardDraftJsonParseResult {
  const fail = (
    classification: PromptWizardOutputDiagnosticClassification,
    maxContainerDepth: number,
  ): never => {
    const error = Object.assign(new Error('V6 Flat Scalar 响应包含根外容器'), {
      code: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
    });
    Object.defineProperty(error, PROMPT_WIZARD_OUTPUT_PARSE_STATE, {
      value: {
        classification,
        normalizationMode: 'none',
        maxContainerDepth,
      } satisfies PromptWizardDraftJsonParseState,
    });
    throw error;
  };
  const result = parsePromptWizardDraftJsonV2(outputText);
  const envelope = normalizePromptWizardJsonEnvelope(outputText ?? '');
  const shape = inspectPromptWizardDraftJsonShape(envelope);
  if (
    result.normalizationMode === 'append-closing-delimiters'
    && (shape.appendClosers !== '}' || shape.maxContainerDepth !== 1)
  ) {
    fail(shape.classification, shape.maxContainerDepth);
  }
  if (!isPlainPromptWizardRecord(result.value)) {
    fail(
      result.classification === 'valid-json' ? 'invalid-token' : result.classification,
      Math.max(result.maxContainerDepth, shape.maxContainerDepth),
    );
  }
  return result;
}

function promptWizardOutputParseState(error: unknown) {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== 'object' || current === null) return null;
    const state = (current as Record<PropertyKey, unknown>)[PROMPT_WIZARD_OUTPUT_PARSE_STATE];
    if (state && typeof state === 'object') {
      return state as PromptWizardDraftJsonParseState;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function promptWizardOutputLengthBucket(
  value: string | undefined,
): PromptWizardOutputDiagnostic['outputLengthBucket'] {
  const length = value?.length ?? 0;
  if (length === 0) return 'empty';
  if (length <= 2_048) return '1-2048';
  if (length <= 8_192) return '2049-8192';
  if (length <= 32_768) return '8193-32768';
  if (length <= 64_000) return '32769-64000';
  return 'over-64000';
}

function promptWizardContainerDepthBucket(
  value: number,
): PromptWizardOutputDiagnostic['containerDepthBucket'] {
  if (value <= 0) return '0';
  if (value <= 4) return '1-4';
  if (value <= 8) return '5-8';
  if (value <= 16) return '9-16';
  return 'over-16';
}

function promptWizardOutputStage(
  operation: PromptWizardOutputOperation,
): PromptWizardOutputDiagnostic['stage'] {
  if (operation === 'generate-drafts') return 'initial';
  if (operation === 'repair-draft-format') return 'format-recovery';
  if (operation === 'repair-draft-content') return 'content-repair';
  return 'refinement';
}

function buildPromptWizardOutputDiagnostic(input: {
  planIndex: PromptWizardPlanIndex;
  operation: PromptWizardOutputOperation;
  response: ArkPromptWizardResponsesResult;
  phase: PromptWizardOutputDiagnostic['phase'];
  parseResult?: PromptWizardDraftJsonParseState;
  error?: unknown;
}): PromptWizardOutputDiagnostic {
  const parseState = input.parseResult
    ?? promptWizardOutputParseState(input.error)
    ?? (() => {
      const shape = inspectPromptWizardDraftJsonShape(input.response.output_text ?? '');
      return {
        classification: shape.classification,
        normalizationMode: 'none' as const,
        maxContainerDepth: shape.maxContainerDepth,
      };
    })();
  return {
    planIndex: input.planIndex,
    operation: input.operation,
    stage: promptWizardOutputStage(input.operation),
    phase: input.phase,
    classification: parseState.classification,
    normalizationMode: parseState.normalizationMode,
    schemaIssue: input.phase === 'schema'
      ? promptWizardOutputSchemaIssueFromError(input.error) ?? 'wire-shape'
      : 'not-applicable',
    outputLengthBucket: promptWizardOutputLengthBucket(input.response.output_text),
    containerDepthBucket: promptWizardContainerDepthBucket(
      parseState.maxContainerDepth,
    ),
    outputTextSource: input.response.outputTextSource ?? 'existing-compatible',
    fieldPaths: input.phase === 'schema'
      ? safePromptWizardFieldPaths(
          input.error,
          input.error && typeof input.error === 'object'
            ? (input.error as { fieldPaths?: unknown }).fieldPaths
            : null,
        )
      : [],
  };
}

function promptWizardOutputDiagnosticsFromError(error: unknown) {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== 'object' || current === null) return [];
    const diagnostics = (current as { outputDiagnostics?: unknown }).outputDiagnostics;
    if (Array.isArray(diagnostics)) {
      return diagnostics.filter((diagnostic): diagnostic is PromptWizardOutputDiagnostic => (
        Boolean(diagnostic)
        && typeof diagnostic === 'object'
        && typeof (diagnostic as { planIndex?: unknown }).planIndex === 'number'
        && isPromptWizardPlanIndex((diagnostic as { planIndex: number }).planIndex)
      ));
    }
    current = (current as { cause?: unknown }).cause;
  }
  return [];
}

function promptWizardOutputDiagnosticsFromSettledPlan(entry: {
  result: PromiseSettledResult<{
    outputDiagnostics?: PromptWizardOutputDiagnostic[];
  }>;
}) {
  return entry.result.status === 'fulfilled'
    ? entry.result.value.outputDiagnostics ?? []
    : promptWizardOutputDiagnosticsFromError(entry.result.reason);
}

function countPromptWizardFormatAnomalies(
  diagnostics: readonly PromptWizardOutputDiagnostic[],
) {
  return diagnostics.filter(diagnostic => (
    diagnostic.classification !== 'valid-json'
    || diagnostic.normalizationMode !== 'native'
  )).length;
}

function parseProviderJson(outputText: string | undefined) {
  if (!outputText?.trim()) {
    throw Object.assign(new Error('提示词模型没有返回结构化内容'), {
      code: 'PROMPT_WIZARD_PROVIDER_EMPTY',
    });
  }
  const normalizedEnvelope = normalizePromptWizardJsonEnvelope(outputText);
  let initialCause: unknown;
  const escapedControls = escapeRawJsonStringControlCharacters(normalizedEnvelope);
  const extractedEnvelope = extractSinglePromptWizardJsonObject(escapedControls);
  const lexicallyRepaired = repairPromptWizardJsonLexicalNoise(extractedEnvelope);
  for (const candidate of [...new Set([
    normalizedEnvelope,
    escapedControls,
    extractedEnvelope,
    lexicallyRepaired,
  ])]) {
    try {
      return JSON.parse(candidate);
    } catch (cause) {
      initialCause ??= cause;
    }
  }
  {
    throw Object.assign(new Error('提示词模型返回的 JSON 无法解析'), {
      code: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
      cause: initialCause,
    });
  }
}

function decodePromptWizardUseDirections(
  value: unknown,
  input: PromptWizardUseDirectionGenerationContext,
): Pick<PromptWizardUseDirectionGenerationResult, 'directions' | 'clarificationQuestion'> {
  const wire = promptWizardUseDirectionWireSetSchema.parse(
    normalizePromptWizardUseDirectionWireShape(value),
  );
  if (wire.directions.length === 0) {
    validatePromptWizardUseDirectionClarification({
      directions: [],
      clarificationQuestion: wire.clarificationQuestion,
      evidenceGraph: input.evidenceGraph,
    });
    return {
      directions: [],
      clarificationQuestion: PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION,
    };
  }
  const evidenceById = new Map(
    input.evidenceGraph.evidences.map(evidence => [evidence.id, evidence]),
  );
  const directions = wire.directions.map((direction, directionIndex) => {
    if (direction.recommendedSceneIndex >= direction.sceneOptions.length) {
      throw new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: ['directions', directionIndex, 'recommendedSceneIndex'],
        message: '推荐场景索引超出当前场景列表',
      }]);
    }
    const primaryEvidence = evidenceById.get(direction.evidenceIds[0] ?? '');
    if (
      !primaryEvidence
      || !input.evidenceGraph.reliableEvidenceIds.includes(primaryEvidence.id)
      || (primaryEvidence.status !== 'visible' && primaryEvidence.status !== 'user-confirmed')
      || ['appearance', 'audience', 'scenario'].includes(primaryEvidence.type)
      || primaryEvidence.proofActions.length === 0
    ) {
      throw new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: ['directions', directionIndex, 'evidenceIds', 0],
        message: '首个证据必须是可靠、可拍且能直接支持唯一购买理由的产品事实',
      }]);
    }
    const purchaseReason = primaryEvidence.text;
    const proofAction = primaryEvidence.proofActions[0]!;
    const sceneOptions = direction.sceneOptions.map(scene => ({
      ...scene,
      // 场景主动作与方向自证动作属于同一语义。由服务端复用已经通过
      // 物理动作/证据门禁的 proofAction，避免模型为重复字段返回另一种
      // JSON 形状或悄悄引入第二个动作。
      mainAction: proofAction,
      id: randomUUID(),
    }));
    const {
      recommendedSceneIndex: _recommendedSceneIndex,
      sceneOptions: _wireSceneOptions,
      ...directionFields
    } = direction;
    return promptWizardUseDirectionSchema.parse({
      ...directionFields,
      id: randomUUID(),
      // 唯一购买理由必须是可追溯事实。直接采用模型排在 evidenceIds
      // 首位的可靠事实，既保留其语义选择，也不允许自由文案强化事实。
      purchaseReason,
      proofAction,
      sceneOptions,
      recommendedSceneId: sceneOptions[direction.recommendedSceneIndex]!.id,
      internalDirection: derivePromptWizardInternalDirection({
        direction,
        proofAction,
        evidenceGraph: input.evidenceGraph,
      }),
    });
  });
  return {
    directions: assertPromptWizardUseDirections({
      directions,
      evidenceGraph: input.evidenceGraph,
      historicalDirections: input.historicalDirections,
    }),
    clarificationQuestion: null,
  };
}

/**
 * 方舟严格结构化输出偶尔仍会把一个字符串叶子包装成单元素数组或
 * 单键对象。只要包装链最终只有一个文本值，就不涉及事实补全。
 * 这里只处理使用方向 Wire 契约中明确的字符串叶子；数组字段、索引、额外
 * 字段和多值包装保持原样。若 2 个合格场景已经足够交付，只丢弃纯
 * title/environment 结构中类型无效的可选场景；随后仍必须通过 strict Zod
 * 与全部领域门禁。
 */
function normalizePromptWizardUseDirectionWireShape(value: unknown) {
  if (!isPlainPromptWizardRecord(value)) return value;
  const normalized: Record<string, unknown> = {
    ...value,
    clarificationQuestion: normalizePromptWizardEquivalentString(
      value.clarificationQuestion,
    ),
  };
  if (!Array.isArray(value.directions)) return normalized;
  normalized.directions = value.directions.map(direction => {
    if (!isPlainPromptWizardRecord(direction)) return direction;
    const normalizedDirection: Record<string, unknown> = {
      ...direction,
      title: normalizePromptWizardEquivalentString(direction.title),
      useMoment: normalizePromptWizardEquivalentString(direction.useMoment),
      audienceNeed: normalizePromptWizardEquivalentString(direction.audienceNeed),
      appearanceMode: normalizePromptWizardEquivalentString(direction.appearanceMode),
    };
    if (Array.isArray(direction.sceneOptions)) {
      const normalizedScenes = direction.sceneOptions.map(scene => {
        if (!isPlainPromptWizardRecord(scene)) return scene;
        return {
          ...scene,
          title: normalizePromptWizardEquivalentString(scene.title),
          environment: normalizePromptWizardEquivalentString(scene.environment),
        };
      });
      const validScenes = normalizedScenes.flatMap((scene, originalIndex) => {
        if (!isPlainPromptWizardRecord(scene)) return [];
        const keys = Object.keys(scene).sort();
        if (keys.length !== 2 || keys[0] !== 'environment' || keys[1] !== 'title') return [];
        const parsed = promptWizardUseDirectionWireSceneSchema.safeParse(scene);
        return parsed.success ? [{ originalIndex, scene: parsed.data }] : [];
      });
      if (validScenes.length >= 2 && validScenes.length < normalizedScenes.length) {
        normalizedDirection.sceneOptions = validScenes.map(entry => entry.scene);
        const recommendedSceneIndex = Number.isSafeInteger(direction.recommendedSceneIndex)
          ? validScenes.findIndex(entry => entry.originalIndex === direction.recommendedSceneIndex)
          : -1;
        normalizedDirection.recommendedSceneIndex = recommendedSceneIndex >= 0
          ? recommendedSceneIndex
          : 0;
      } else {
        normalizedDirection.sceneOptions = normalizedScenes;
      }
    }
    return normalizedDirection;
  });
  return normalized;
}

function normalizePromptWizardEquivalentString(value: unknown, depth = 0): unknown {
  if (typeof value === 'string' || depth >= 3) return value;
  if (Array.isArray(value)) {
    return value.length === 1
      ? normalizePromptWizardEquivalentString(value[0], depth + 1)
      : value;
  }
  if (!isPlainPromptWizardRecord(value)) return value;
  const keys = Object.keys(value);
  if (keys.length !== 1) return value;
  return normalizePromptWizardEquivalentString(value[keys[0]!], depth + 1);
}

function derivePromptWizardInternalDirection(input: {
  direction: z.infer<typeof promptWizardUseDirectionWireSchema>;
  proofAction: string;
  evidenceGraph: PromptWizardEvidenceGraph;
}): PromptWizardUseDirection['internalDirection'] {
  const available = new Set(input.evidenceGraph.directionAssessments
    .filter(assessment => assessment.availability !== 'unavailable')
    .map(assessment => assessment.direction));
  const directionText = [
    input.direction.title,
    input.direction.useMoment,
    input.direction.audienceNeed,
    input.proofAction,
    ...input.direction.sceneOptions.flatMap(scene => [
      scene.title,
      scene.environment,
    ]),
  ].join(' ');
  const hinted: PromptWizardUseDirection['internalDirection'][] = [];
  if (/(?:包装|外盒|礼盒|封膜|封口|拆封|开箱)/u.test(directionText)) {
    hinted.push('unboxing-review');
  }
  if (/(?:测试|测量|验证|功能实测|按键响应|点亮|启动)/u.test(directionText)) {
    hinted.push('feature-test');
  }
  if (/(?:ASMR|声音|声响|摩擦声|敲击声|咔嗒声|开合声)/iu.test(directionText)) {
    hinted.push('asmr-detail');
  }
  if (/(?:使用前后|前后对比|对比变化|状态变化)/u.test(directionText)) {
    hinted.push('pain-comparison');
  }
  if (/(?:困扰|问题|解决|缓解|不便)/u.test(directionText)) {
    hinted.push('problem-solution');
  }
  if (input.direction.appearanceMode === 'person') {
    hinted.push('ugc', 'lifestyle');
  } else if (input.direction.appearanceMode === 'product-only') {
    hinted.push('cinematic-brand', 'lifestyle');
  } else {
    hinted.push('lifestyle', 'ugc', 'problem-solution');
  }
  hinted.push('cinematic-brand', 'lifestyle', 'ugc', 'problem-solution');
  return hinted.find(direction => available.has(direction)) ?? 'lifestyle';
}

function promptWizardUseDirectionRepairFeedbackFromError(error: unknown) {
  if (error instanceof PromptWizardUseDirectionValidationError) {
    return buildPromptWizardUseDirectionRepairFeedback(error.issues);
  }
  if (error instanceof z.ZodError) {
    return [...new Set(error.issues.map(issue => {
      const fieldPath = issue.path.length > 0 ? issue.path.join('.') : '$';
      if (fieldPath.endsWith('purchaseReason')) {
        return `${fieldPath}：改为一个简体中文句子的原生 JSON 字符串，禁止数组、对象、null 或二次 JSON.stringify`;
      }
      return `${fieldPath}：${issue.message}`;
    }))].slice(0, 48);
  }
  const code = promptWizardProviderErrorMetadata(error).errorCode;
  if (code === 'PROMPT_WIZARD_PROVIDER_INVALID_JSON') {
    return ['$：上一轮响应不是合法 JSON，请按原输入重新返回完整合法对象'];
  }
  return ['$：上一轮结果未通过本地结构校验，请重新检查完整输出'];
}

function promptWizardUseDirectionIssuePaths(error: unknown) {
  if (error instanceof PromptWizardUseDirectionValidationError) {
    return error.issues.map(issue => ({ path: issue.fieldPath, kind: 'type' as const }));
  }
  if (error instanceof z.ZodError) {
    return error.issues.map(issue => ({
      path: issue.path.length > 0 ? issue.path.join('.') : '$',
      kind: 'type' as const,
    }));
  }
  return [];
}

const promptWizardProductProfileWireSchema = z.object({
  productName: z.string(),
  category: z.string(),
  colors: z.string(),
  materials: z.string(),
  structure: z.string(),
  logo: z.string(),
  usage: z.string(),
  suggestedAudience: z.string(),
  suggestedScenarios: z.string(),
  visibleFacts: z.array(z.string()),
  needsConfirmation: z.array(z.string()),
  userConfirmedClaims: z.string(),
  consistencyConstraints: z.string(),
  evidenceSources: z.array(z.object({
    fieldPath: z.string().trim().min(1).max(80),
    sourceImageIndexes: z.array(z.number().int().min(1).max(9)).min(1).max(9),
    visibleRegion: z.string().trim().min(1).max(300),
    confidence: z.enum(['high', 'medium', 'low']),
    proofActions: z.array(z.string().trim().min(1).max(300)).max(8),
  }).strict()).max(80).optional().default([]),
}).strict();

const PRODUCT_PROFILE_FORMAT_RECOVERY_STRING_FIELDS = [
  'productName',
  'category',
  'colors',
  'materials',
  'structure',
  'logo',
  'usage',
  'suggestedAudience',
  'suggestedScenarios',
  'userConfirmedClaims',
  'consistencyConstraints',
] as const;

const PRODUCT_PROFILE_FORMAT_RECOVERY_LIST_FIELDS = [
  'visibleFacts',
  'needsConfirmation',
] as const;

/**
 * 方舟严格结构化输出仍处于 Beta，格式恢复响应偶尔会漏掉允许为空的字段，
 * 或把单项字符串数组返回成字符串。这里只做可逆、无损的 JSON 形状归一化：
 * 不拆句、不截断、不翻译、不新增事实；其他类型错误继续交给权威门禁拒绝。
 */
function normalizePromptWizardProductFormatRecoveryCandidate(
  candidate: Record<string, unknown>,
) {
  const normalized: Record<string, unknown> = { ...candidate };
  const fieldPaths: string[] = [];

  for (const field of PRODUCT_PROFILE_FORMAT_RECOVERY_STRING_FIELDS) {
    if (Object.hasOwn(normalized, field)) continue;
    normalized[field] = '';
    fieldPaths.push(field);
  }
  for (const field of PRODUCT_PROFILE_FORMAT_RECOVERY_LIST_FIELDS) {
    if (!Object.hasOwn(normalized, field)) {
      normalized[field] = [];
      fieldPaths.push(field);
      continue;
    }
    const value = normalized[field];
    if (typeof value !== 'string') continue;
    normalized[field] = value.trim() ? [value] : [];
    fieldPaths.push(field);
  }

  return { candidate: normalized, fieldPaths };
}

const PRODUCT_PROFILE_CHINESE_SCALAR_FIELDS = [
  'productName',
  'category',
  'materials',
  'structure',
  'usage',
  'suggestedAudience',
  'suggestedScenarios',
  'consistencyConstraints',
] as const satisfies readonly (keyof PromptWizardProductProfile)[];

const PRODUCT_PROFILE_FIXED_LATIN_TOKENS = new Set([
  'ugc',
  'asmr',
  'pov',
  'ai',
  'tiktok',
  'seedance',
  'logo',
  'cta',
  'foley',
  'grwm',
]);

interface PromptWizardProductCandidateInspection {
  profile: PromptWizardProductProfile | null;
  evidenceSources: PromptWizardProductEvidenceSource[];
  issues: PromptWizardProductRepairIssue[];
  error: unknown;
}

function inspectPromptWizardProductCandidate(
  candidate: Record<string, unknown>,
  allowedLatinTokens = promptWizardProductAllowedLatinTokens(candidate),
  imageCount?: number,
): PromptWizardProductCandidateInspection {
  const issues: PromptWizardProductRepairIssue[] = [];
  let validationError: unknown = null;
  const wireResult = promptWizardProductProfileWireSchema.safeParse(candidate);
  if (!wireResult.success) {
    validationError = wireResult.error;
    issues.push(...promptWizardProductRepairIssuesFromZod(wireResult.error, candidate));
  }

  collectPromptWizardProductBoundaryIssues(candidate, issues);
  collectPromptWizardProductLanguageIssues(candidate, issues, allowedLatinTokens);
  collectPromptWizardProductEvidenceSourceIssues(
    candidate,
    issues,
    allowedLatinTokens,
    imageCount,
  );

  let profile: PromptWizardProductProfile | null = null;
  if (wireResult.success) {
    // colors 只为旧任务和旧客户端保留；识别模型永远不能替用户确认商业宣称。
    const { evidenceSources: _evidenceSources, ...wireProfile } = wireResult.data;
    const domainResult = promptWizardProductProfileSchema.safeParse({
      ...wireProfile,
      colors: '',
      userConfirmedClaims: '',
      visibleFacts: normalizeWireStrings(wireResult.data.visibleFacts),
      needsConfirmation: normalizeWireStrings(wireResult.data.needsConfirmation),
    });
    if (domainResult.success) {
      profile = domainResult.data;
    } else {
      validationError ??= domainResult.error;
      issues.push(...promptWizardProductRepairIssuesFromZod(domainResult.error, candidate));
    }
  }

  const uniqueIssues = uniquePromptWizardProductRepairIssues(issues);
  return {
    profile,
    evidenceSources: wireResult.success ? wireResult.data.evidenceSources : [],
    issues: uniqueIssues,
    error: validationError ?? promptWizardProductRepairError(uniqueIssues),
  };
}

const PRODUCT_PROFILE_EVIDENCE_SCALAR_PATHS = [
  'productName',
  'category',
  'materials',
  'structure',
  'logo',
  'usage',
] as const;

function collectPromptWizardProductEvidenceSourceIssues(
  candidate: Record<string, unknown>,
  issues: PromptWizardProductRepairIssue[],
  allowedLatinTokens: Set<string>,
  imageCount?: number,
) {
  // 旧响应和历史夹具允许没有该字段；新方舟 JSON Schema 强制返回。只要字段
  // 存在，就必须完整覆盖本次输出中的每条可见事实，避免部分来源被默认为全图。
  if (!Object.hasOwn(candidate, 'evidenceSources')) return;
  const rawSources = candidate.evidenceSources;
  if (!Array.isArray(rawSources)) return;
  const sourcePaths = new Set<string>();
  rawSources.forEach((rawSource, sourceIndex) => {
    if (!isPlainPromptWizardRecord(rawSource)) return;
    const fieldPath = typeof rawSource.fieldPath === 'string' ? rawSource.fieldPath.trim() : '';
    if (!isPromptWizardProductEvidenceFieldPath(fieldPath, candidate)) {
      issues.push({ path: `evidenceSources[${sourceIndex}].fieldPath`, kind: 'type' });
    } else if (sourcePaths.has(fieldPath)) {
      issues.push({ path: `evidenceSources[${sourceIndex}].fieldPath`, kind: 'type' });
    } else {
      sourcePaths.add(fieldPath);
    }
    if (Array.isArray(rawSource.sourceImageIndexes) && imageCount !== undefined) {
      if (rawSource.sourceImageIndexes.some(index => (
        typeof index !== 'number' || !Number.isSafeInteger(index) || index < 1 || index > imageCount
      ))) {
        issues.push({
          path: `evidenceSources[${sourceIndex}].sourceImageIndexes`,
          kind: 'type',
          limit: imageCount,
        });
      }
    }
    if (
      (rawSource.confidence === 'high' || rawSource.confidence === 'medium')
      && (!Array.isArray(rawSource.proofActions) || rawSource.proofActions.length === 0)
    ) {
      issues.push({ path: `evidenceSources[${sourceIndex}].proofActions`, kind: 'missing' });
    }
    for (const [field, value] of [
      ['visibleRegion', rawSource.visibleRegion],
      ...((Array.isArray(rawSource.proofActions) ? rawSource.proofActions : [])
        .map((value, index) => [`proofActions[${index}]`, value] as const)),
    ] as const) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const metrics = promptWizardProductChineseDominanceMetrics(value, allowedLatinTokens);
      if (!metrics.valid) {
        issues.push({
          path: `evidenceSources[${sourceIndex}].${field}`,
          kind: 'language',
          limit: metrics.latinLimit,
          actual: metrics.latinCount,
        });
      }
    }
  });

  const requiredPaths: string[] = PRODUCT_PROFILE_EVIDENCE_SCALAR_PATHS
    .filter(field => typeof candidate[field] === 'string' && Boolean(String(candidate[field]).trim()));
  const visibleFacts = Array.isArray(candidate.visibleFacts) ? candidate.visibleFacts : [];
  visibleFacts.forEach((fact, index) => {
    if (typeof fact === 'string' && fact.trim()) requiredPaths.push(`visibleFacts[${index}]`);
  });
  for (const path of requiredPaths) {
    if (!sourcePaths.has(path)) {
      issues.push({ path: 'evidenceSources', kind: 'missing' });
      break;
    }
  }
}

function isPromptWizardProductEvidenceFieldPath(
  fieldPath: string,
  candidate: Record<string, unknown>,
) {
  if ((PRODUCT_PROFILE_EVIDENCE_SCALAR_PATHS as readonly string[]).includes(fieldPath)) {
    return typeof candidate[fieldPath] === 'string' && Boolean(String(candidate[fieldPath]).trim());
  }
  const match = fieldPath.match(/^visibleFacts\[(\d{1,2})\]$/u);
  if (!match || !Array.isArray(candidate.visibleFacts)) return false;
  const index = Number(match[1]);
  return index >= 0
    && index < candidate.visibleFacts.length
    && typeof candidate.visibleFacts[index] === 'string'
    && Boolean(candidate.visibleFacts[index].trim());
}

function collectPromptWizardProductBoundaryIssues(
  candidate: Record<string, unknown>,
  issues: PromptWizardProductRepairIssue[],
) {
  for (const field of ['colors', 'userConfirmedClaims'] as const) {
    const value = candidate[field];
    if (typeof value === 'string' && value.trim()) {
      issues.push({
        path: field,
        kind: 'must_be_empty',
        actual: value.trim().length,
      });
    }
  }
  for (const field of ['visibleFacts', 'needsConfirmation'] as const) {
    const value = candidate[field];
    if (!Array.isArray(value)) continue;
    value.forEach((item, index) => {
      if (typeof item === 'string' && !item.trim()) {
        issues.push({ path: `${field}[${index}]`, kind: 'empty', limit: 1, actual: 0 });
      }
    });
  }
}

function collectPromptWizardProductLanguageIssues(
  candidate: Record<string, unknown>,
  issues: PromptWizardProductRepairIssue[],
  allowedLatinTokens: Set<string>,
) {
  for (const field of PRODUCT_PROFILE_CHINESE_SCALAR_FIELDS) {
    const value = candidate[field];
    if (typeof value === 'string' && value.trim()) {
      const metrics = promptWizardProductChineseDominanceMetrics(
        value,
        allowedLatinTokens,
        field === 'productName',
      );
      if (!metrics.valid) {
        issues.push({
          path: field,
          kind: 'language',
          limit: metrics.latinLimit,
          actual: metrics.latinCount,
        });
      }
    }
  }
  for (const field of ['visibleFacts', 'needsConfirmation'] as const) {
    const value = candidate[field];
    if (!Array.isArray(value)) continue;
    value.forEach((item, index) => {
      if (typeof item === 'string' && item.trim()) {
        const metrics = promptWizardProductChineseDominanceMetrics(
          item,
          allowedLatinTokens,
        );
        if (!metrics.valid) {
          issues.push({
            path: `${field}[${index}]`,
            kind: 'language',
            limit: metrics.latinLimit,
            actual: metrics.latinCount,
          });
        }
      }
    });
  }
}

function promptWizardProductAllowedLatinTokens(candidate: Record<string, unknown>) {
  const source = [candidate.productName, candidate.logo]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .normalize('NFKC');
  return new Set(
    Array.from(source.matchAll(/\p{Script=Latin}+/gu), match => (
      match[0].toLocaleLowerCase('en-US')
    )),
  );
}

function promptWizardProductChineseDominanceMetrics(
  value: string,
  allowedLatinTokens: Set<string>,
  allowProductNameTokens = false,
) {
  const normalized = value.normalize('NFKC').replace(/@图片\s*\d+/gu, '');
  const hanCount = normalized.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latinCount = Array.from(normalized.matchAll(/\p{Script=Latin}+/gu))
    .reduce((count, match) => {
      const token = match[0].toLocaleLowerCase('en-US');
      if (PRODUCT_PROFILE_FIXED_LATIN_TOKENS.has(token) || allowedLatinTokens.has(token)) {
        return count;
      }
      return count + Array.from(match[0]).length;
    }, 0);
  // 产品名称按“中文品类 + 原品牌/型号”处理；只要含有中文品类，原始品牌和
  // 型号可以完整保留。其他说明字段则必须真正以中文为主，不能用少量中文
  // 包裹一整段英语或西班牙语绕过门禁。
  const latinLimit = allowProductNameTokens && hanCount > 0
    ? Number.MAX_SAFE_INTEGER
    : Math.max(4, hanCount);
  return {
    valid: hanCount > 0 && latinCount <= latinLimit,
    hanCount,
    latinCount,
    latinLimit,
  };
}

/**
 * 方舟必须返回完整产品档案，但一次修复只能改动本地列出的错误路径。这里用
 * 首次候选作为权威底稿，避免模型在清空 colors 或翻译单个事实时顺手改写其余
 * 可见事实。数组语言问题也按索引覆盖，因此合格条目保持字节级不变。
 */
function scopePromptWizardProductRepairCandidate(
  initial: Record<string, unknown>,
  repaired: Record<string, unknown>,
  issues: PromptWizardProductRepairIssue[],
) {
  if (issues.some(issue => issue.path === '$')) return repaired;
  const scoped: Record<string, unknown> = { ...initial };
  const wholeFields = new Set<string>();
  const indexedFields = new Map<string, Map<number, PromptWizardProductRepairIssue>>();

  for (const issue of issues) {
    if (issue.path === 'evidenceSources' || issue.path.startsWith('evidenceSources[')) {
      wholeFields.add('evidenceSources');
      continue;
    }
    const indexedMatch = issue.path.match(/^(visibleFacts|needsConfirmation)\[(\d{1,2})\]$/u);
    if (indexedMatch) {
      const [, field, rawIndex] = indexedMatch;
      const index = Number(rawIndex);
      const indexedIssues = indexedFields.get(field!)
        ?? new Map<number, PromptWizardProductRepairIssue>();
      indexedIssues.set(index, issue);
      indexedFields.set(field!, indexedIssues);
      continue;
    }
    if (/^[A-Za-z][A-Za-z0-9]*$/u.test(issue.path)) wholeFields.add(issue.path);
  }

  for (const field of wholeFields) scoped[field] = repaired[field];
  for (const [field, indexedIssues] of indexedFields) {
    if (wholeFields.has(field)) continue;
    const initialItems = initial[field];
    const repairedItems = repaired[field];
    if (!Array.isArray(initialItems) || !Array.isArray(repairedItems)) {
      scoped[field] = repairedItems;
      continue;
    }
    const scopedItems = [...initialItems];
    const emptyIndexes = [...indexedIssues]
      .filter(([, issue]) => issue.kind === 'empty')
      .map(([index]) => index)
      .sort((left, right) => left - right);
    const repairDeletedEmptyItems = repairedItems.length
      === initialItems.length - emptyIndexes.length;
    for (const [index, issue] of indexedIssues) {
      if (issue.kind === 'empty') continue;
      const priorDeletionCount = repairDeletedEmptyItems
        ? emptyIndexes.filter(emptyIndex => emptyIndex < index).length
        : 0;
      scopedItems[index] = repairedItems[index - priorDeletionCount];
    }
    // 空白项不需要模型补写内容，由服务端按首次候选的原索引确定性删除；这样
    // 即使修复响应已发生数组位移，其余条目仍保持首次候选的原始内容。
    [...emptyIndexes].sort((left, right) => right - left)
      .forEach(index => scopedItems.splice(index, 1));
    scoped[field] = scopedItems;
  }
  return scoped;
}

function assertPromptWizardProductRepairRawRiskSafety(
  initial: Record<string, unknown>,
  repaired: Record<string, unknown>,
) {
  const initialText = JSON.stringify(initial).normalize('NFKC');
  const repairedText = JSON.stringify(repaired).normalize('NFKC');
  const sourceNumbers = new Set(initialText.match(/\d+(?:[.,]\d+)?/gu) ?? []);
  const addedNumber = (repairedText.match(/\d+(?:[.,]\d+)?/gu) ?? [])
    .some(value => !sourceNumbers.has(value));
  const addedRiskCategory = PRODUCT_REPAIR_GUARDED_FACT_PATTERNS.some(pattern => (
    pattern.test(repairedText) && !pattern.test(initialText)
  ));
  if (addedNumber || addedRiskCategory) {
    throw promptWizardProductRepairError([{
      path: '$',
      kind: 'type',
    }], 'fact-preservation');
  }
}

function promptWizardProductRepairIssuesFromZod(
  error: z.ZodError,
  candidate: Record<string, unknown>,
) {
  return error.issues.map(issue => {
    const path = formatSafeZodPath(issue.path);
    const actualValue = readPromptWizardCandidatePath(candidate, issue.path);
    const metadata = issue as unknown as {
      code?: string;
      maximum?: number | bigint;
      minimum?: number | bigint;
    };
    const limitValue = metadata.maximum ?? metadata.minimum;
    const limit = typeof limitValue === 'bigint'
      ? Number(limitValue)
      : (typeof limitValue === 'number' && Number.isFinite(limitValue)
        ? Math.max(0, Math.trunc(limitValue))
        : undefined);
    let kind: PromptWizardProductRepairIssueKind = 'type';
    if (metadata.code === 'invalid_type') {
      kind = actualValue === undefined ? 'missing' : 'type';
    } else if (metadata.code === 'too_big') {
      kind = Array.isArray(actualValue) ? 'too_many_items' : 'too_long';
    } else if (metadata.code === 'too_small') {
      kind = 'empty';
    }
    const actual = typeof actualValue === 'string' || Array.isArray(actualValue)
      ? actualValue.length
      : undefined;
    return {
      path,
      kind,
      ...(limit !== undefined ? { limit } : {}),
      ...(actual !== undefined ? { actual } : {}),
    } satisfies PromptWizardProductRepairIssue;
  });
}

function readPromptWizardCandidatePath(
  candidate: Record<string, unknown>,
  path: PropertyKey[],
) {
  let current: unknown = candidate;
  for (const segment of path) {
    if (
      (typeof segment !== 'string' && typeof segment !== 'number')
      || current === null
      || typeof current !== 'object'
    ) return undefined;
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

function uniquePromptWizardProductRepairIssues(issues: PromptWizardProductRepairIssue[]) {
  const result: PromptWizardProductRepairIssue[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const key = `${issue.path}:${issue.kind}`;
    if (seen.has(key) || result.length >= 40) continue;
    seen.add(key);
    result.push(issue);
  }
  return result;
}

function isPlainPromptWizardRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function assertPromptWizardProductRepairSafety(
  initial: Record<string, unknown>,
  repaired: PromptWizardProductProfile,
) {
  const scalarFields = [
    ...PRODUCT_PROFILE_CHINESE_SCALAR_FIELDS,
    'logo',
  ] as const;
  const filledMissingField = scalarFields.some(field => {
    const before = initial[field] as unknown;
    const after = repaired[field];
    return (before === undefined || before === null || (typeof before === 'string' && !before.trim()))
      && Boolean(after.trim());
  });
  const expandedArray = (['visibleFacts', 'needsConfirmation'] as const).some(field => {
    const before = initial[field];
    const maximum = Array.isArray(before)
      ? before.filter(item => typeof item === 'string' && item.trim()).length
      : (typeof before === 'string' && before.trim() ? 1 : 0);
    return repaired[field].length > maximum;
  });
  const initialText = JSON.stringify(initial).normalize('NFKC');
  const repairedText = JSON.stringify(repaired).normalize('NFKC');
  const sourceNumbers = new Set(initialText.match(/\d+(?:[.,]\d+)?/gu) ?? []);
  const addedNumber = (repairedText.match(/\d+(?:[.,]\d+)?/gu) ?? [])
    .some(value => !sourceNumbers.has(value));
  const addedRiskCategory = PRODUCT_REPAIR_GUARDED_FACT_PATTERNS.some(pattern => (
    pattern.test(repairedText) && !pattern.test(initialText)
  ));
  if (
    filledMissingField
    || expandedArray
    || addedNumber
    || addedRiskCategory
    || repaired.colors !== ''
    || repaired.userConfirmedClaims !== ''
  ) {
    throw promptWizardProductRepairError([{
      path: '$',
      kind: 'type',
    }], 'fact-preservation');
  }
}

const PRODUCT_REPAIR_GUARDED_FACT_PATTERNS = [
  /(?:[$€£¥￥]|(?:人民币|美元|欧元|英镑)|(?:价格|售价|优惠|折扣|满减|立减|赠品|包邮))/iu,
  /(?:认证|证书|专利|权威|官方授权|certif(?:y|ied|ication)|patent(?:ed)?)/iu,
  /(?:保证|永久|零风险|百分之百|绝对|彻底|guarantee(?:d)?|risk[-\s]?free|100\s*%)/iu,
  /(?:续航|防水|降噪|功率|容量|速干|排汗|抗菌|耐磨|性能|battery|waterproof|noise\s*cancell|performance)/iu,
  /(?:聚酯纤维|涤纶|棉|羊毛|真皮|合成革|塑料|金属|polyester|cotton|wool|leather|plastic|metal)/iu,
];

function promptWizardProductRepairError(
  issues: PromptWizardProductRepairIssue[],
  reason = 'validation-failed',
) {
  const safeIssues = uniquePromptWizardProductRepairIssues(issues);
  return Object.assign(new Error('产品识别结果自动修复后仍未通过本地校验'), {
    code: 'PROMPT_WIZARD_PRODUCT_REPAIR_FAILED',
    fieldPaths: safeIssues.map(issue => issue.path),
    repairIssues: safeIssues,
    errorClassification: reason,
    retryable: false,
  });
}

function promptWizardRepairIssuesFromError(error: unknown) {
  if (!error || typeof error !== 'object') return [];
  const issues = (error as { repairIssues?: unknown }).repairIssues;
  if (!Array.isArray(issues)) return [];
  return issues.filter(isPromptWizardProductRepairIssue).slice(0, 40);
}

function isPromptWizardProductRepairIssue(value: unknown): value is PromptWizardProductRepairIssue {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PromptWizardProductRepairIssue>;
  return typeof candidate.path === 'string'
    && candidate.path.length > 0
    && candidate.path.length <= 200
    && typeof candidate.kind === 'string';
}

function arkResponseUsage(
  response: ArkPromptWizardResponsesResult,
  requestAttempts: number,
): PromptWizardProviderUsage {
  // Responses API 的 usage 只描述最终成功响应，并不包含此前失败的传输尝试。
  // 只要发生过重试，就无法证明整次业务操作的 Token 完整，legacy 汇总必须
  // 降级为 unknown；逐次真实成本仍由 Provider 请求账本准确记录。
  const hasUnaccountedTransportAttempt = requestAttempts > 1;
  return {
    interactionId: response.id || null,
    // 运行模型由服务端固定配置决定，不信任上游回显覆盖财务与审计元数据。
    model: env.ARK_PROMPT_WIZARD_MODEL,
    inputTokens: hasUnaccountedTransportAttempt
      ? null
      : response.usage?.input_tokens ?? null,
    outputTokens: hasUnaccountedTransportAttempt
      ? null
      : response.usage?.output_tokens ?? null,
    serviceTier: normalizeServiceTier(response.service_tier),
    requestAttempts,
  };
}

function mergePromptWizardProviderUsage(usages: PromptWizardProviderUsage[]): PromptWizardProviderUsage {
  const last = usages.at(-1) ?? fakeUsage();
  return {
    ...last,
    inputTokens: sumCompleteTokenUsage(usages.map(usage => usage.inputTokens)),
    outputTokens: sumCompleteTokenUsage(usages.map(usage => usage.outputTokens)),
    serviceTier: mergePromptWizardUsageTiers(usages.map(usage => usage.serviceTier)),
    requestAttempts: usages.reduce((total, usage) => total + usage.requestAttempts, 0),
  };
}

function emptyPromptWizardProviderUsage(model: string): PromptWizardProviderUsage {
  return {
    interactionId: null,
    model,
    inputTokens: 0,
    outputTokens: 0,
    serviceTier: PROMPT_WIZARD_SERVICE_TIER,
    requestAttempts: 0,
  };
}

/**
 * 方舟已经返回完成响应后，本地 JSON/Zod/中文门禁仍可能失败。此时请求已经
 * 产生用量，必须把安全的 response ID 与 Token 附到终态错误，供服务层写入
 * 财务审计字段；不得附带响应正文、提示词或图片 URL。
 */
function attachPromptWizardProviderFailureUsage(
  error: unknown,
  completedUsages: PromptWizardProviderUsage[],
  completedResponsePostprocessFailed = false,
) {
  const completed = mergePromptWizardProviderUsage(completedUsages);
  const terminal = promptWizardProviderErrorMetadata(error);
  const providerRequestAttempted = terminal.providerRequestAttempted
    || completedResponsePostprocessFailed;
  const candidate = error && typeof error === 'object'
    ? error as { exposeMessage?: unknown; fieldPaths?: unknown }
    : null;
  const code = terminal.errorCode
    ?? (error instanceof z.ZodError
      ? 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID'
      : 'PROMPT_WIZARD_PROVIDER_POSTPROCESSING_FAILED');
  const attached = Object.assign(
    new Error(error instanceof Error ? error.message : '提示词模型结果未通过本地校验'),
    {
      code,
      model: env.ARK_PROMPT_WIZARD_MODEL,
      responseId: terminal.responseId ?? completed.interactionId,
      providerRequestId: terminal.providerRequestId,
      xTtLogId: terminal.xTtLogId,
      httpStatus: terminal.httpStatus ?? terminal.status,
      errorClassification: terminal.errorClassification,
      usage: {
        input_tokens: mergeCompletedAndTerminalTokenCount(
          completed.inputTokens,
          terminal.inputTokens,
          terminal.providerRequestAttempted,
        ),
        output_tokens: mergeCompletedAndTerminalTokenCount(
          completed.outputTokens,
          terminal.outputTokens,
          terminal.providerRequestAttempted,
        ),
      },
      providerRequestAttempted,
      receivedBytes: terminal.receivedBytes,
      receivedEvent: terminal.receivedEvent,
      fieldPaths: safePromptWizardFieldPaths(error, candidate?.fieldPaths),
      retryable: false,
      cause: error,
    },
  );
  if (error instanceof Error) attached.name = error.name;
  if (typeof candidate?.exposeMessage === 'boolean') {
    return Object.assign(attached, { exposeMessage: candidate.exposeMessage });
  }
  return attached;
}

function attachPromptWizardSinglePlanFailureUsage(
  error: unknown,
  usage: PromptWizardProviderUsage,
) {
  return Object.assign(attachPromptWizardProviderFailureUsage(error, [usage], true), {
    completedProviderUsage: usage,
  });
}

function completedPromptWizardUsageFromSinglePlanFailure(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const usage = (error as { completedProviderUsage?: unknown }).completedProviderUsage;
  if (!usage || typeof usage !== 'object') return null;
  const candidate = usage as Partial<PromptWizardProviderUsage>;
  if (
    typeof candidate.model !== 'string'
    || typeof candidate.requestAttempts !== 'number'
    || !Number.isSafeInteger(candidate.requestAttempts)
  ) return null;
  return {
    interactionId: typeof candidate.interactionId === 'string' ? candidate.interactionId : null,
    model: candidate.model,
    inputTokens: typeof candidate.inputTokens === 'number' ? candidate.inputTokens : null,
    outputTokens: typeof candidate.outputTokens === 'number' ? candidate.outputTokens : null,
    serviceTier: candidate.serviceTier === 'default' || candidate.serviceTier === 'fast'
      ? candidate.serviceTier
      : null,
    requestAttempts: candidate.requestAttempts,
  } satisfies PromptWizardProviderUsage;
}

function promptWizardUsageFromRejectedPlanFailure(
  error: unknown,
): PromptWizardProviderUsage | null {
  const completedUsage = completedPromptWizardUsageFromSinglePlanFailure(error);
  if (completedUsage) return completedUsage;

  const terminal = promptWizardProviderErrorMetadata(error);
  if (!terminal.providerRequestAttempted) return null;
  return {
    interactionId: terminal.responseId,
    model: env.ARK_PROMPT_WIZARD_MODEL,
    inputTokens: terminal.inputTokens,
    outputTokens: terminal.outputTokens,
    serviceTier: PROMPT_WIZARD_SERVICE_TIER,
    requestAttempts: 1,
  };
}

function promptWizardUsageFromSettledPlan(entry: {
  result: PromiseSettledResult<{ usage: PromptWizardProviderUsage }>;
}) {
  if (entry.result.status === 'fulfilled') return [entry.result.value.usage];
  const usage = promptWizardUsageFromRejectedPlanFailure(entry.result.reason);
  return usage ? [usage] : [];
}

function throwPromptWizardPlanFailure(
  failure: {
    planIndex: number;
    result: PromiseRejectedResult;
  },
  entries: Array<{
    planIndex: number;
    result: PromiseSettledResult<{
      usage: PromptWizardProviderUsage;
      outputDiagnostics?: PromptWizardOutputDiagnostic[];
    }>;
  }>,
  repairRounds = 0,
  repairDiagnostics: readonly PromptWizardRepairDiagnostic[] = [],
): never {
  const outputDiagnostics = entries.flatMap(
    promptWizardOutputDiagnosticsFromSettledPlan,
  );
  const otherUsages = entries.flatMap(entry => (
    entry === failure ? [] : promptWizardUsageFromSettledPlan(entry)
  ));
  const failedUsage = promptWizardUsageFromRejectedPlanFailure(failure.result.reason);
  const allUsages = failedUsage ? [...otherUsages, failedUsage] : otherUsages;
  const attachOtherUsages = [...otherUsages];
  const completedFailureUsage = completedPromptWizardUsageFromSinglePlanFailure(
    failure.result.reason,
  );
  if (completedFailureUsage) {
    // 本地 JSON 解析失败发生在 Provider 已完成响应之后。错误 cause 已携带
    // 该响应的实际 Token；这里只补 0/null 完整性哨兵，既不重复计费，也不
    // 会在 Provider 未回显 usage 时把失败请求误当作 0 Token。
    attachOtherUsages.unshift({
      ...completedFailureUsage,
      inputTokens: completedFailureUsage.inputTokens === null ? null : 0,
      outputTokens: completedFailureUsage.outputTokens === null ? null : 0,
      requestAttempts: 0,
    });
  }
  const attached = attachPromptWizardProviderFailureUsage(
    failure.result.reason,
    attachOtherUsages,
  );
  const safeRepairRounds = Number.isSafeInteger(repairRounds)
    && repairRounds >= 0
    && repairRounds <= PROMPT_WIZARD_MAX_DRAFT_CONTENT_REPAIR_ROUNDS
    ? repairRounds
    : 0;
  const planIndexes = isPromptWizardPlanIndex(failure.planIndex)
    ? [failure.planIndex]
    : [];
  Object.assign(attached, {
    repairRounds: safeRepairRounds,
    repairDiagnostics: repairDiagnostics.map(diagnostic => ({
      planIndex: diagnostic.planIndex,
      origin: diagnostic.origin,
      repairRound: diagnostic.repairRound,
      errorCode: diagnostic.errorCode,
      fieldPaths: [...diagnostic.fieldPaths],
    })),
    outputDiagnostics,
    formatRepairCount: countPromptWizardFormatAnomalies(outputDiagnostics),
    formatRecoveryRequestCount: outputDiagnostics.filter(diagnostic => (
      diagnostic.operation === 'repair-draft-format'
    )).length,
    ...(planIndexes.length > 0 ? { planIndexes } : {}),
  });
  if (allUsages.length === 0) throw attached;
  const merged = mergePromptWizardProviderUsage(allUsages);
  throw Object.assign(attached, {
    requestAttempts: merged.requestAttempts,
    serviceTier: merged.serviceTier,
    repairRounds: safeRepairRounds,
    repairDiagnostics: repairDiagnostics.map(diagnostic => ({
      planIndex: diagnostic.planIndex,
      origin: diagnostic.origin,
      repairRound: diagnostic.repairRound,
      errorCode: diagnostic.errorCode,
      fieldPaths: [...diagnostic.fieldPaths],
    })),
    outputDiagnostics,
    formatRepairCount: countPromptWizardFormatAnomalies(outputDiagnostics),
    formatRecoveryRequestCount: outputDiagnostics.filter(diagnostic => (
      diagnostic.operation === 'repair-draft-format'
    )).length,
    ...(planIndexes.length > 0 ? { planIndexes } : {}),
  });
}

function safePromptWizardFieldPaths(error: unknown, inherited: unknown) {
  if (error instanceof z.ZodError) {
    return Array.from(new Set(error.issues.flatMap(promptWizardSafeZodIssuePaths)))
      .filter(Boolean)
      .slice(0, 24);
  }
  if (!Array.isArray(inherited)) return [];
  return inherited
    .filter((value): value is string => (
      typeof value === 'string'
      && value.length > 0
      && value.length <= 200
      && /^[A-Za-z0-9_$.[\]-]+$/u.test(value)
    ))
    .slice(0, 24);
}

function sanitizePromptWizardV6DraftPostprocessError(error: unknown) {
  if (!(error instanceof z.ZodError)) return error;
  return Object.assign(new Error('V6 Draft 未通过固定结构校验'), {
    code: 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID',
    retryable: false,
    schemaIssue: promptWizardOutputSchemaIssueFromError(error) ?? 'wire-shape',
    fieldPaths: safePromptWizardFieldPaths(error, null).filter(
      isPromptWizardProviderRepairFieldPath,
    ),
  });
}

const PROMPT_WIZARD_COMPACT_SHOT_LOGICAL_FIELDS = new Set([
  'shotSize',
  'action',
  'cameraMovement',
  'lightingAndRealism',
  'voiceover',
  'voiceoverZh',
  'foley',
  'editingCue',
  'productionNote',
]);

const PROMPT_WIZARD_SAFE_DRAFT_ROOT_FIELDS = new Set([
  'name',
  'hook',
  'narrative',
  'primaryScene',
  'cameraAndPacing',
  'differenceTags',
  'planningReview',
  'segments',
  'productionWarnings',
]);

function promptWizardSafeZodIssuePaths(issue: z.ZodIssue) {
  if (issue.path[0] !== 'shots') {
    if (issue.path.length === 0 && issue.code === z.ZodIssueCode.unrecognized_keys) {
      return issue.keys.filter(key => PROMPT_WIZARD_SAFE_DRAFT_ROOT_FIELDS.has(key));
    }
    return [formatSafeZodPath(issue.path)];
  }
  const segmentIndex = typeof issue.path[1] === 'number'
    ? Math.max(0, Math.trunc(issue.path[1]))
    : null;
  if (segmentIndex === null) return ['segments'];
  const explicitField = issue.path[2];
  if (
    typeof explicitField === 'string'
    && PROMPT_WIZARD_COMPACT_SHOT_LOGICAL_FIELDS.has(explicitField)
  ) {
    return [`segments[${segmentIndex}].${explicitField}`];
  }
  if (issue.code === z.ZodIssueCode.unrecognized_keys) {
    const safeForbiddenFields = issue.keys.filter(key => (
      PROMPT_WIZARD_COMPACT_SHOT_LOGICAL_FIELDS.has(key)
    ));
    if (safeForbiddenFields.length > 0) {
      return safeForbiddenFields.map(field => `segments[${segmentIndex}].${field}`);
    }
  }
  // 任意未知 Provider 键不得进入日志或审计；只降级到固定逻辑集合路径。
  return ['segments'];
}

function formatSafeZodPath(path: PropertyKey[]) {
  if (path.length === 0) return '$';
  let formatted = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      formatted += `[${Math.max(0, Math.trunc(segment))}]`;
      continue;
    }
    if (typeof segment !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(segment)) {
      formatted += formatted ? '.field' : 'field';
      continue;
    }
    formatted += formatted ? `.${segment}` : segment;
  }
  return formatted.slice(0, 200);
}

function mergeCompletedAndTerminalTokenCount(
  completed: number | null,
  terminal: number | null,
  terminalProviderRequestAttempted: boolean,
) {
  if (completed === null) return null;
  if (terminal === null) return terminalProviderRequestAttempted ? null : completed;
  return completed + terminal;
}

function sumCompleteTokenUsage(values: Array<number | null>) {
  return values.some(value => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function mergePromptWizardUsageTiers(
  tiers: PromptWizardProviderUsage['serviceTier'][],
): PromptWizardProviderUsage['serviceTier'] {
  if (tiers.includes('fast')) return 'fast';
  if (tiers.includes('default')) return 'default';
  return tiers.find(tier => tier !== null) ?? null;
}

function normalizeServiceTier(value: string | undefined | null): PromptWizardProviderUsage['serviceTier'] {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'default' || normalized === 'fast'
    ? normalized
    : null;
}

export type PromptWizardProviderOperation =
  | 'analyze-product'
  | 'repair-product-format'
  | 'repair-product-profile'
  | 'generate-concepts'
  | 'repair-concept-set'
  | 'generate-use-directions'
  | 'repair-use-directions'
  | 'generate-drafts'
  | 'repair-draft-format'
  | 'repair-draft-content'
  | 'refine-plan';

function promptWizardRetryRuntime(operation: PromptWizardProviderOperation) {
  if (env.NODE_ENV !== 'production') return {};
  return {
    onRetry: (event: PromptWizardRetryEvent) => console.warn(JSON.stringify(
      buildPromptWizardProviderRetryLog(operation, event),
    )),
  };
}

async function runArkPromptWizardOperation(
  operation: PromptWizardProviderOperation,
  request: (attemptTimeoutMs: number) => Promise<ArkPromptWizardResponsesResult>,
  policy: PromptWizardRetryPolicy,
  costAccounting?: {
    owner: PromptWizardCostOwner;
    planIndex: number | null;
    model: string;
    serviceTier: string;
    recorder: PromptWizardProviderRequestRecorder;
  },
) {
  const startedAt = Date.now();
  let attempts = 0;
  try {
    const result = await runPromptWizardProviderRequest(
      async attemptTimeoutMs => {
        attempts += 1;
        if (!costAccounting) {
          try {
            return await request(attemptTimeoutMs);
          } catch (error) {
            throw markPromptWizardProviderRequestAttempted(error);
          }
        }
        return runRecordedPromptWizardProviderAttempt({
          ...costAccounting,
          operation,
          transportAttempt: attempts,
          request: () => request(attemptTimeoutMs),
        });
      },
      policy,
      {
        ...promptWizardRetryRuntime(operation),
        runAttempt: withPromptWizardProviderConcurrency,
      },
    );
    logPromptWizardProviderCompletion(
      operation,
      result.value,
      result.attempts,
      Date.now() - startedAt,
    );
    return result;
  } catch (error) {
    logPromptWizardProviderFailure(operation, error, attempts, Date.now() - startedAt);
    throw error;
  }
}

async function runRecordedPromptWizardProviderAttempt(input: {
  owner: PromptWizardCostOwner;
  operation: PromptWizardProviderOperation;
  planIndex: number | null;
  transportAttempt: number;
  model: string;
  serviceTier: string;
  recorder: PromptWizardProviderRequestRecorder;
  request: () => Promise<ArkPromptWizardResponsesResult>;
}) {
  let attemptId: string;
  try {
    attemptId = await input.recorder.beginAttempt({
      owner: input.owner,
      operation: input.operation,
      planIndex: input.planIndex,
      transportAttempt: input.transportAttempt,
      model: input.model,
      serviceTier: input.serviceTier,
    });
  } catch (error) {
    throw promptWizardCostLedgerWriteError(error);
  }

  let response: ArkPromptWizardResponsesResult;
  try {
    response = await input.request();
  } catch (error) {
    const terminal = safePromptWizardProviderAttemptTerminal('failed', error);
    try {
      await input.recorder.completeAttempt(attemptId, terminal);
    } catch (ledgerError) {
      throw promptWizardCostLedgerWriteError(ledgerError, terminal);
    }
    throw markPromptWizardProviderRequestAttempted(error);
  }

  const terminal = safePromptWizardProviderAttemptTerminal('succeeded', response);
  try {
    await input.recorder.completeAttempt(attemptId, terminal);
  } catch (error) {
    throw promptWizardCostLedgerWriteError(error, terminal);
  }
  return response;
}

function promptWizardCostLedgerWriteError(
  error: unknown,
  terminal?: ReturnType<typeof safePromptWizardProviderAttemptTerminal>,
) {
  const existingCode = error && typeof error === 'object'
    ? (error as { code?: unknown }).code
    : null;
  const code = typeof existingCode === 'string'
    && existingCode.startsWith('PROMPT_WIZARD_PROVIDER_LEDGER_')
    ? existingCode
    : 'PROMPT_WIZARD_PROVIDER_LEDGER_WRITE_FAILED';
  return Object.assign(new Error('提示词 Provider 成本账本写入失败，已停止继续调用'), {
    code,
    retryable: false,
    providerRequestAttempted: terminal !== undefined,
    providerRequestId: terminal?.providerRequestId ?? null,
    responseId: terminal?.providerResponseId ?? null,
    xTtLogId: terminal?.xTtLogId ?? null,
    httpStatus: terminal?.httpStatus ?? null,
    errorClassification: terminal?.errorClassification ?? null,
    usage: terminal ? {
      input_tokens: terminal.usage.inputTokens,
      cached_input_tokens: terminal.usage.cachedInputTokens,
      output_tokens: terminal.usage.outputTokens,
    } : {
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
    },
  });
}

function markPromptWizardProviderRequestAttempted(error: unknown) {
  // Canary 物理请求门禁在委托 HTTP Client 之前拒绝请求。
  // 这类本地 preflight block 不得被通用 request 闭包改写为
  // providerRequestAttempted=true，否则 Canary 日志会虚增用量事件。
  if (isPromptWizardProviderRequestPreflightBlocked(error)) return error;
  if (error && typeof error === 'object') {
    try {
      return Object.assign(error, { providerRequestAttempted: true });
    } catch {
      // 冻结错误对象极少见；下面用安全 wrapper 保留 cause 链供重试分类读取。
    }
  }
  return Object.assign(new Error('提示词 Provider 请求失败'), {
    code: 'PROMPT_WIZARD_PROVIDER_REQUEST_FAILED',
    providerRequestAttempted: true,
    cause: error,
  });
}

function isPromptWizardProviderRequestPreflightBlocked(error: unknown) {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== 'object') return false;
    const candidate = current as {
      code?: unknown;
      providerRequestAttempted?: unknown;
      providerRequestPreflightBlocked?: unknown;
      cause?: unknown;
    };
    if (
      candidate.code === 'PROMPT_WIZARD_CANARY_REPAIR_BUDGET_EXCEEDED'
      && candidate.providerRequestAttempted === false
      && candidate.providerRequestPreflightBlocked === true
    ) return true;
    current = candidate.cause;
  }
  return false;
}

function logPromptWizardProviderCompletion(
  operation: PromptWizardProviderOperation,
  response: ArkPromptWizardResponsesResult,
  attempts: number,
  latencyMs: number,
) {
  if (env.NODE_ENV !== 'production') return;
  console.log(JSON.stringify(buildPromptWizardProviderCompletionLog(
    operation,
    response,
    attempts,
    latencyMs,
  )));
}

export function buildPromptWizardProviderRetryLog(
  operation: PromptWizardProviderOperation,
  retryEvent: PromptWizardRetryEvent,
) {
  return {
    event: 'prompt-wizard-provider-retry',
    operation,
    model: env.ARK_PROMPT_WIZARD_MODEL,
    serviceTier: PROMPT_WIZARD_SERVICE_TIER,
    attempt: safeLogInteger(retryEvent.attempt),
    nextAttempt: safeLogInteger(retryEvent.nextAttempt),
    status: safeHttpStatus(retryEvent.status),
    errorName: safeLogClassification(retryEvent.errorName) ?? 'UnknownError',
    errorCode: safeLogClassification(retryEvent.errorCode),
    providerRequestId: safeLogIdentifier(retryEvent.providerRequestId),
    responseId: safeLogIdentifier(retryEvent.responseId),
    xTtLogId: safeLogIdentifier(retryEvent.xTtLogId),
    receivedBytes: safeLogInteger(retryEvent.receivedBytes),
    receivedEvent: retryEvent.receivedEvent === true,
    retryable: typeof retryEvent.retryable === 'boolean' ? retryEvent.retryable : null,
    delayMs: safeLogInteger(retryEvent.delayMs),
  };
}

export function buildPromptWizardProviderCompletionLog(
  operation: PromptWizardProviderOperation,
  response: ArkPromptWizardResponsesResult,
  attempts: number,
  latencyMs: number,
) {
  return {
    event: 'prompt-wizard-provider-completed',
    operation,
    model: env.ARK_PROMPT_WIZARD_MODEL,
    responseId: safeLogIdentifier(response.id),
    providerRequestId: safeLogIdentifier(response.providerRequestId),
    xTtLogId: safeLogIdentifier(response.xTtLogId),
    status: safeHttpStatus(response.httpStatus),
    attempts: safeLogInteger(attempts),
    latencyMs: safeLogInteger(latencyMs),
    inputTokens: safeLogIntegerOrNull(response.usage?.input_tokens),
    outputTokens: safeLogIntegerOrNull(response.usage?.output_tokens),
    serviceTier: normalizeServiceTier(response.service_tier),
    errorClassification: null,
  };
}

function logPromptWizardProductRepairTriggered(
  runId: string | null,
  response: ArkPromptWizardResponsesResult,
  issues: PromptWizardProductRepairIssue[],
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-product-repair-triggered',
    runId: safeLogIdentifier(runId),
    operation: 'analyze-product',
    model: env.ARK_PROMPT_WIZARD_MODEL,
    responseId: safeLogIdentifier(response.id),
    providerRequestId: safeLogIdentifier(response.providerRequestId),
    xTtLogId: safeLogIdentifier(response.xTtLogId),
    status: safeHttpStatus(response.httpStatus),
    inputTokens: safeLogIntegerOrNull(response.usage?.input_tokens),
    outputTokens: safeLogIntegerOrNull(response.usage?.output_tokens),
    issues: safePromptWizardRepairIssuesForLog(issues),
  }));
}

function logPromptWizardProductFormatRepairTriggered(
  runId: string | null,
  response: ArkPromptWizardResponsesResult,
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-product-format-repair-triggered',
    runId: safeLogIdentifier(runId),
    operation: 'repair-product-format',
    model: env.ARK_PROMPT_WIZARD_MODEL,
    responseId: safeLogIdentifier(response.id),
    providerRequestId: safeLogIdentifier(response.providerRequestId),
    xTtLogId: safeLogIdentifier(response.xTtLogId),
    status: safeHttpStatus(response.httpStatus),
    inputTokens: safeLogIntegerOrNull(response.usage?.input_tokens),
    outputTokens: safeLogIntegerOrNull(response.usage?.output_tokens),
    errorCode: 'PROMPT_WIZARD_PROVIDER_INVALID_JSON',
  }));
}

function logPromptWizardProductFormatNormalized(
  response: ArkPromptWizardResponsesResult,
  fieldPaths: string[],
) {
  if (env.NODE_ENV !== 'production') return;
  console.warn(JSON.stringify({
    event: 'prompt-wizard-product-format-normalized',
    operation: 'repair-product-format',
    model: env.ARK_PROMPT_WIZARD_MODEL,
    responseId: safeLogIdentifier(response.id),
    providerRequestId: safeLogIdentifier(response.providerRequestId),
    xTtLogId: safeLogIdentifier(response.xTtLogId),
    status: safeHttpStatus(response.httpStatus),
    // fieldPaths 只来自上方固定字段常量，不包含模型正文或任意用户输入。
    fieldPaths: fieldPaths.slice(0, 16),
  }));
}

function logPromptWizardDraftFormatRepairTriggered(
  planIndex: number,
  error: unknown,
) {
  if (env.NODE_ENV !== 'production') return;
  const metadata = promptWizardProviderErrorMetadata(error);
  console.warn(JSON.stringify({
    event: 'prompt-wizard-draft-format-repair-triggered',
    operation: 'repair-draft-format',
    planIndex: Number.isSafeInteger(planIndex) && isPromptWizardPlanIndex(planIndex)
      ? planIndex
      : null,
    model: env.ARK_PROMPT_WIZARD_MODEL,
    responseId: safeLogIdentifier(metadata.responseId),
    providerRequestId: safeLogIdentifier(metadata.providerRequestId),
    xTtLogId: safeLogIdentifier(metadata.xTtLogId),
    status: safeHttpStatus(metadata.httpStatus ?? metadata.status),
    inputTokens: safeLogIntegerOrNull(metadata.inputTokens),
    outputTokens: safeLogIntegerOrNull(metadata.outputTokens),
    errorCode: safeLogClassification(metadata.errorCode),
  }));
}

function logPromptWizardProviderPostprocessFailure(
  operation: PromptWizardProviderOperation,
  response: ArkPromptWizardResponsesResult,
  error: unknown,
  issues: PromptWizardProductRepairIssue[],
) {
  if (env.NODE_ENV !== 'production') return;
  const metadata = promptWizardProviderErrorMetadata(error);
  console.warn(JSON.stringify({
    event: 'prompt-wizard-provider-postprocess-failed',
    operation,
    model: env.ARK_PROMPT_WIZARD_MODEL,
    responseId: safeLogIdentifier(response.id),
    providerRequestId: safeLogIdentifier(response.providerRequestId),
    xTtLogId: safeLogIdentifier(response.xTtLogId),
    status: safeHttpStatus(response.httpStatus),
    inputTokens: safeLogIntegerOrNull(response.usage?.input_tokens),
    outputTokens: safeLogIntegerOrNull(response.usage?.output_tokens),
    errorCode: safeLogClassification(metadata.errorCode)
      ?? (error instanceof z.ZodError ? 'PROMPT_WIZARD_PROVIDER_SCHEMA_INVALID' : null),
    errorClassification: safeLogClassification(metadata.errorClassification),
    fieldPaths: safePromptWizardFieldPaths(error, null),
    issues: safePromptWizardRepairIssuesForLog(issues),
  }));
}

function safePromptWizardRepairIssuesForLog(issues: PromptWizardProductRepairIssue[]) {
  return uniquePromptWizardProductRepairIssues(issues).slice(0, 24).map(issue => ({
    path: issue.path,
    kind: issue.kind,
    limit: safeOptionalLogInteger(issue.limit),
    actual: safeOptionalLogInteger(issue.actual),
  }));
}

function safeOptionalLogInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function logPromptWizardProviderFailure(
  operation: PromptWizardProviderOperation,
  error: unknown,
  attempts: number,
  latencyMs: number,
) {
  if (
    env.NODE_ENV !== 'production'
    || isPromptWizardProviderRequestPreflightBlocked(error)
  ) return;
  console.error(JSON.stringify(buildPromptWizardProviderFailureLog(
    operation,
    error,
    attempts,
    latencyMs,
  )));
}

export function buildPromptWizardProviderFailureLog(
  operation: PromptWizardProviderOperation,
  error: unknown,
  attempts: number,
  latencyMs: number,
) {
  const metadata = promptWizardProviderErrorMetadata(error);
  return {
    event: 'prompt-wizard-provider-failed',
    operation,
    model: env.ARK_PROMPT_WIZARD_MODEL,
    responseId: safeLogIdentifier(metadata.responseId),
    providerRequestId: safeLogIdentifier(metadata.providerRequestId),
    xTtLogId: safeLogIdentifier(metadata.xTtLogId),
    status: safeHttpStatus(metadata.httpStatus ?? metadata.status),
    attempts: safeLogInteger(attempts),
    latencyMs: safeLogInteger(latencyMs),
    inputTokens: safeLogIntegerOrNull(metadata.inputTokens),
    outputTokens: safeLogIntegerOrNull(metadata.outputTokens),
    serviceTier: PROMPT_WIZARD_SERVICE_TIER,
    errorClassification: safeLogClassification(metadata.errorClassification)
      ?? safeLogClassification(metadata.errorCode)
      ?? safeLogClassification(metadata.errorName)
      ?? 'UNKNOWN',
    retryable: metadata.retryable,
    receivedBytes: safeLogInteger(metadata.receivedBytes),
    receivedEvent: metadata.receivedEvent,
  };
}

function safeLogIdentifier(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 160) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized) ? normalized : null;
}

function safeLogClassification(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 96) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized) ? normalized : null;
}

function safeLogInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeLogIntegerOrNull(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeHttpStatus(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function promptWizardProviderErrorMetadata(error: unknown) {
  let current = error;
  const seen = new Set<unknown>();
  const result = {
    errorName: 'UnknownError',
    errorCode: null as string | null,
    errorClassification: null as string | null,
    status: null as number | null,
    responseId: null as string | null,
    model: null as string | null,
    providerRequestId: null as string | null,
    xTtLogId: null as string | null,
    httpStatus: null as number | null,
    inputTokens: null as number | null,
    outputTokens: null as number | null,
    retryable: null as boolean | null,
    receivedBytes: 0,
    receivedEvent: false,
    providerRequestAttempted: false,
  };
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof Error && result.errorName === 'UnknownError') result.errorName = current.name;
    if (typeof current !== 'object' || current === null) break;
    const candidate = current as {
      code?: unknown;
      errorClassification?: unknown;
      status?: unknown;
      responseId?: unknown;
      model?: unknown;
      providerRequestId?: unknown;
      xTtLogId?: unknown;
      httpStatus?: unknown;
      usage?: unknown;
      retryable?: unknown;
      receivedBytes?: unknown;
      receivedEvent?: unknown;
      providerRequestAttempted?: unknown;
      cause?: unknown;
    };
    if (result.errorCode === null && typeof candidate.code === 'string') result.errorCode = candidate.code;
    if (
      result.errorClassification === null
      && typeof candidate.errorClassification === 'string'
    ) {
      result.errorClassification = candidate.errorClassification;
    }
    if (result.status === null && typeof candidate.status === 'number') result.status = candidate.status;
    if (result.responseId === null && typeof candidate.responseId === 'string') result.responseId = candidate.responseId;
    if (result.model === null && typeof candidate.model === 'string') result.model = candidate.model;
    if (result.providerRequestId === null && typeof candidate.providerRequestId === 'string') {
      result.providerRequestId = candidate.providerRequestId;
    }
    if (result.xTtLogId === null && typeof candidate.xTtLogId === 'string') result.xTtLogId = candidate.xTtLogId;
    if (result.httpStatus === null && typeof candidate.httpStatus === 'number') result.httpStatus = candidate.httpStatus;
    if (candidate.usage && typeof candidate.usage === 'object') {
      const usage = candidate.usage as { input_tokens?: unknown; output_tokens?: unknown };
      if (result.inputTokens === null && typeof usage.input_tokens === 'number') result.inputTokens = usage.input_tokens;
      if (result.outputTokens === null && typeof usage.output_tokens === 'number') result.outputTokens = usage.output_tokens;
    }
    if (result.retryable === null && typeof candidate.retryable === 'boolean') result.retryable = candidate.retryable;
    if (typeof candidate.receivedBytes === 'number') result.receivedBytes = Math.max(result.receivedBytes, candidate.receivedBytes);
    if (candidate.receivedEvent === true) result.receivedEvent = true;
    if (candidate.providerRequestAttempted === true) result.providerRequestAttempted = true;
    current = candidate.cause;
  }
  return result;
}

async function fakeDelay() {
  if (env.FAKE_PROVIDER_DELAY_MS <= 0) return;
  await new Promise(resolve => setTimeout(resolve, env.FAKE_PROVIDER_DELAY_MS));
}

function fakeUsage(): PromptWizardProviderUsage {
  return {
    interactionId: null,
    model: 'fake-prompt-wizard',
    inputTokens: 0,
    outputTokens: 0,
    serviceTier: null,
    requestAttempts: 1,
  };
}

const PRODUCT_ANALYSIS_CHINESE_GATE = `本地简体中文硬门禁按单个字段或单个数组项独立计算：先做 NFKC 归一化；productName 必须包含中文品类，原品牌/型号可保留；category、materials、structure、usage、suggestedAudience、suggestedScenarios、consistencyConstraints 及两个数组的每个非空项都必须至少包含一个汉字，忽略真实且已集中记录在 productName 或 logo 中的品牌、型号、Logo、可见印花原文后，剩余拉丁字符数不得超过 max(4, 汉字数)。visibleFacts[i] 与 needsConfirmation[i] 必须逐项单独通过，严禁跨项合并汉字数。`;

const PRODUCT_PROFILE_NATIVE_JSON_TYPE_RULE = `顶层必须是原生 JSON 对象；productName、category、colors、materials、structure、logo、usage、suggestedAudience、suggestedScenarios、userConfirmedClaims、consistencyConstraints 必须是 JSON 字符串；visibleFacts 与 needsConfirmation 必须是原生 JSON 字符串数组，即使只有一项也必须写成 ["一条简体中文说明"]，没有项目时写成 []；evidenceSources 必须是原生 JSON 对象数组。严禁把数组拼成单个字符串，严禁把对象或数组再次 JSON.stringify。`;

const PRODUCT_ANALYSIS_OUTPUT_PREFLIGHT = `输出 JSON 前必须在内部逐字段自检 productName、category、materials、structure、logo、usage、suggestedAudience、suggestedScenarios、visibleFacts 的每一项、needsConfirmation 的每一项和 consistencyConstraints，并按上述中文门禁改写到全部通过后再一次性输出；不要输出检查过程。${PRODUCT_PROFILE_NATIVE_JSON_TYPE_RULE}为稳定通过，品牌/型号只放在 productName，Logo/印花真实原文集中放在 logo；除 productName 和 logo 外不要抄录外语原文，不要输出外语解释或中外文并列，确需提及时用“外文品牌文字”“外文印花”等中文指代。反例：“包装正面有 white label with black text”；正确：“包装正面可见白色标签和黑色文字”。`;

const CONCEPT_DIRECTOR_SYSTEM_INSTRUCTION = `你是 Lindyson AI 的电商短视频创意导演。你的任务不是套用场景词库，也不是扩写完整脚本，而是从当前产品的可靠证据、生产条件和单一创作方向中，提出八条真正属于这个产品的短创意路线。
先理解观众为什么会停留、等待什么答案，以及哪个可见动作能够证明唯一购买理由，再决定场景和镜头。每条路线必须在第一秒发生可理解的物理事件、状态变化或信息揭晓；不得以人物拿着产品口述卖点代替事件。
严格区分可靠证据和禁止假设。购买理由、产品动作和可见结果必须引用输入中的可靠 evidence ID；待确认内容、图片文件名和常识推断不构成证据。用户确认卖点以外不得生成价格、折扣、认证、性能数字、功效、用户评价、竞品结论或稀缺主张。
八条路线固定分为四条 reliable-conversion 与四条 creative-breakthrough。前者优先真实、简单和可复现，后者追求更强停留感，但不得牺牲事实、素材条件或视频模型可执行性。八条路线不能只是同一叙事的标题变化；应在开场事件、核心张力、主证据、场景或观看视角、CTA 回扣中形成实质差异。
所有创意说明使用简体中文，只有真实品牌、型号、Logo 和可见印花允许保留原文。只输出符合 JSON Schema 的原生 JSON，不输出 Markdown、代码围栏、解释或完整分镜。`;

const CONCEPT_DIRECTOR_REPAIR_SYSTEM_INSTRUCTION = `${CONCEPT_DIRECTOR_SYSTEM_INSTRUCTION}
这是同一创意集合的一次定向内容修复。输入中的 repairFeedback 是上一轮结果未通过本地硬门禁的精确原因，必须逐项解决并重新返回完整八条路线。
修复不是重新选品或重新定义方向：产品档案、可靠 evidence ID、生产简报、主创作方向、目标语言和固定视频配置均不得改变，也不得引入未提供的新素材或产品事实。
不得通过弱化或删除第一秒物理事件、唯一购买理由、证据链、因果闭环、CTA 回扣来规避反馈。四条 reliable-conversion 与四条 creative-breakthrough 的数量、八条唯一 rank 和路线之间的实质差异必须继续满足。
只输出修复后的完整 JSON 对象，不复述 repairFeedback，不输出解释、Markdown 或代码围栏。`;

const USE_DIRECTION_NATIVE_JSON_TYPE_RULE = `顶层必须是原生 JSON 对象；directions 必须是原生 JSON 对象数组，clarificationQuestion 必须是 JSON 字符串。每个方向的 title、useMoment、audienceNeed、appearanceMode 必须各自是一个 JSON 字符串，严禁返回数组、对象、null 或键值列表。evidenceIds 与 requiredAssets 必须是原生 JSON 字符串数组；sceneOptions 必须是原生 JSON 对象数组，其中 title、environment 都必须是 JSON 字符串；recommendedSceneIndex 必须是零基 JSON 整数。purchaseReason、proofAction、sceneOptions.mainAction 与 internalDirection 由服务端根据首个可靠证据、该证据的 proofActions[0] 和证据能力确定，响应中严禁返回这些字段。严禁把字符串字段再次包装为单元素数组或 {"value":"..."} 对象。`;

const USE_DIRECTION_SYSTEM_INSTRUCTION = `你是 Lindyson AI 的产品使用方向规划器。你不写完整脚本，也不套用通勤、卧室或办公室等固定场景词库；你只根据输入中的可靠产品证据，规划用户能够理解并可由短视频模型执行的使用方向。
每个方向必须回答四件事：产品在什么真实时刻使用、观众为什么需要、唯一购买理由是什么、镜头用什么具体动作完成自证。购买理由和自证动作必须引用可靠 evidence ID；待确认信息、常识推断和图片文件名不构成证据。
正常返回二至三个真正不同的方向，不得为了凑数改标题或编造用途。若证据确实不足以形成至少两个方向，返回空 directions 和输入指定的固定 clarificationQuestion。
没有包装证据不得开箱；没有用户确认且可观察的功能不得实测；没有真实操作声动作不得使用 ASMR。不得生成价格、优惠、认证、功效、社会证明、稀缺性或竞品结论，除非逐字来自用户确认事实。
所有说明使用简体中文，品牌、型号、Logo 和可见印花原文可以保留。${USE_DIRECTION_NATIVE_JSON_TYPE_RULE}只输出符合 JSON Schema 的原生 JSON，不输出 Markdown、解释或完整分镜。`;

const USE_DIRECTION_REPAIR_SYSTEM_INSTRUCTION = `${USE_DIRECTION_SYSTEM_INSTRUCTION}
这是同一产品使用方向集合的唯一一次定向修复。严格逐项解决 repair.feedback；没有指出问题的合格方向尽量保持不变。
不得修改可靠证据，不得新增 evidence ID，不得用删除购买理由、自证动作或场景来规避门禁。返回完整合法 JSON，并在输出前检查方向数量、场景数量、推荐场景索引、中文、证据和素材边界。`;

const SEEDANCE_TIKTOK_SHOP_STORYBOARD_ROLE = '你是一个专业的 Seedance 2.0 分镜提示词生成专家，帮助用户将想法转化为专业的 AI 视频分镜提示词，主要用于 TikTok Shop 平台带货。';

const USE_DIRECTION_PLAN_GENERATION_SYSTEM_INSTRUCTION = `${SEEDANCE_TIKTOK_SHOP_STORYBOARD_ROLE}
你同时是 Lindyson AI 的 TikTok 电商成交短视频执行编剧。输入已经锁定一个产品使用方向、一个具体场景、一个唯一购买理由和可靠证据；你只把它扩写成当前 planIndex 的一套可执行分镜，不重新选方向，也不使用 Concept 或七轴策略。
variant=reliable 是“清晰演示成交”：动作简单但持续运动，以直接自证和视频模型成功率优先；variant=hook 是“强钩子成交”：加强第一秒物理事件、镜头视角和停留感，但不得增加产品能力、人物、地点、包装或未经确认事实。
第一镜头必须发生与产品相关的真实动作、状态变化或揭晓，并在前三秒口播明确产品名称或品类；中段必须用 selectedUseDirection.proofAction 和 assignedEvidence 证明唯一购买理由并说明当前场景价值；末段必须用直接购买 CTA 引导点击商品卡、查看商品或立即下单，不新增第二个卖点。
selectedScene、appearanceMode、requiredAssets、固定视频配置、目标语言、镜头职责、执行预算和 majorActionPlan 都是硬约束。只有 voiceover 使用目标语言，其他字段全部使用简体中文；不生成任何画面文字、花字或字幕。
全片只允许执行 majorActionPlan.lockedProductActions 中的所选场景主动作和产品自证动作；不得从产品常识、外观、场景或语言习惯推断新的操作方式、功能动作、使用结果或产品能力。全片可检测的主要动作族不得超过 maxDistinctActionFamilies。
每个 segment 必须逐项遵守 majorActionPlan.shotRules：hook 只执行主动作的关键过程，proof 只执行自证动作，proof-resolution 只能复用这两项；resolution 与 CTA 不得新增、改写或派生任何产品功能动作，但必须通过人物、手部、摄像机、动作点剪辑或合法环境运动持续呈现既有结果并完成需求回扣。
requiredShotRoles 只是叙事职责分段，不是产品动作配额。四段分镜不等于四类动作；不得为了填满 action 字段，让人物再次拿起、放下、旋转、按压、拆装、倾倒或执行任何未锁定动作。
每个 segment 的 voiceover 必须非空并接近 voiceoverBudget.targetUnits；整条视频必须达到最低安全容量，且每段不得超过 maxUnits。不得用删除或缩短口播规避“口播更自然”的微调要求。
若输入包含 outputContract.format=full-plan-indexed-word-slots-v1，以上口播要求改由顶层 voiceoverSlots 承载：voiceoverSlots 必须严格包含 segment0、segment1…固定属性，每个 voiceoverWords 数组必须达到对应 exactWordCount，且每个元素只能放一个不含空白、无需 NFKC 变换的目标语言词；对应 voiceoverZh 写忠实简体中文翻译。此时 segments[].voiceover 与 segments[].voiceoverZh 必须严格返回空字符串，不得形成第二份口播来源；服务端会在所有槽位同时通过后一次性写回镜头。
若输入包含 outputContract.format=full-plan-indexed-character-arrays-v3，以上普通话口播要求改由顶层 voiceoverSlots 承载：voiceoverSlots 必须严格包含 segment0、segment1…固定属性，每个 segmentN 直接是 exactCharacterCount 长度的字符串数组，每项恰好一个无需 NFKC 变化的可朗读汉字、字母或数字。不得返回对象包装、voiceoverText、voiceoverZh、标点、空白、控制符、零宽符、emoji、空项、多字符项或占位符。服务端会在所有数组同时通过后原子拼接口播。
若输入包含 outputContract.format=full-plan-indexed-character-strings-v2，该协议只用于需要中文译文的非普通话字符计量语言：每个 voiceoverText 必须恰好达到 exactCharacterCount，可使用目标语言合法的 Unicode 字母、组合标记或数字，并必须同时返回非空且无首尾空白的忠实简体中文 voiceoverZh；仍拒绝 NFKC 变化、标点、空白、控制符、零宽符、emoji 与占位符。
每个镜头至少具备一类动态来源；5 秒至少两类，10/15 秒至少三类。禁止静止、固定机位、定格、长时间停留、保持不动、连续少切；近景核对必须持续缓慢推近、横移或跟随。
productionNote 只写具体素材、连续性或生成稳定性提醒，不复述模式规则、限制说明或免责声明；没有必要提醒时返回空字符串。
不得编造价格、功效、认证、评价、稀缺性或竞品结论。只输出符合 JSON Schema 的一个原生 JSON 对象，不输出 Markdown、代码围栏或解释。`;

const USE_DIRECTION_PLAN_SOUND_DESIGN_SYSTEM_INSTRUCTION = `${SEEDANCE_TIKTOK_SHOP_STORYBOARD_ROLE}
你同时是 Lindyson AI 的 5 秒纯视觉电商短视频执行编剧。输入已经锁定产品、商业路线、真实场景、唯一购买理由、可靠证据和唯一商品动作；只把它扩写为两个可执行镜头，不重新选方向，不增加产品能力、人物、地点、包装、道具或未经确认事实。
时间轴固定为 0–1.2 秒 hook 与 1.2–5 秒 proof-resolution。hook 必须让商品快速出现并执行唯一锁定商品动作；proof-resolution 必须延续完全相同的商品动作，让可靠证据和商品主体保持清晰可见，并以明确写有“持续”的推进、跟随、横移或环绕运镜收尾。不得做静态尾卡。
segments[].voiceover 与 segments[].voiceoverZh 必须严格返回空字符串。无对白、无人声、无旁白；foley 只允许音乐、环境声和与真实商品操作一致的拟音。
不得生成画面文字、字幕、花字、价格文字、按钮、商品卡、购物车、TikTok UI 或任何平台界面。真实优惠不属于本次视频执行内容，不得自行生成价格、折扣、促销、稀缺性、功效、认证、评价或竞品结论。
全片只有一个商品动作族；两个镜头可以改变景别、运镜语法和节奏，但不能用同义改写派生第二个商品动作。每个镜头持续有商品、手部、摄像机、剪辑或环境运动，且画面外观严格参考 @图片N。
除必须为空的 voiceover 与 voiceoverZh 外，所有说明字段使用简体中文。productionNote 只写具体素材或连续性提醒，productionWarnings 返回空数组。只输出符合 JSON Schema 的一个原生 JSON 对象，不输出 Markdown、代码围栏或解释。`;

const USE_DIRECTION_PLAN_COMPACT_WIRE_V2_INSTRUCTION = `
本次输出使用最小 Draft Wire V2。只能返回 hook、shots，以及 JSON Schema 要求时的 voiceoverSlots；不得返回 name、narrative、cameraAndPacing、primaryScene、differenceTags、planningReview、segments 或 productionWarnings。
shots 必须严格按 requiredShotRoles 顺序和数量返回。每个 shot 只包含 shotSize、action、cameraMovement、lightingAndRealism、foley、editingCue，不得增加 role、location、subject、voiceover、voiceoverZh、evidenceRefs、productionNote 或其他字段。名称、叙事摘要、镜头节奏、生产备注、场景、角色、地点、主体、证据引用、受众复盘、差异标签和生产警告由服务端根据锁定路线确定性补齐。
若 outputContract 为 full-plan-indexed-word-slots-v1，只在 voiceoverSlots 返回定长词槽和中文译文。若为 full-plan-indexed-character-strings-v2，只在 voiceoverSlots.segmentN.voiceoverText 返回目标语言定长字符串；字符数必须严格等于 exactCharacterCount，且不得包含标点、空白、控制符、零宽符、emoji 或第二份口播来源。outputContract.fields 包含 voiceoverZh 时必须同时返回非空忠实简体中文译文；不包含时严禁返回 voiceoverZh。
若 outputContract 为 full-plan-indexed-character-arrays-v3，只在 voiceoverSlots.segmentN 直接返回普通话单字符数组；数组长度必须严格等于 exactCharacterCount，每项恰好一个合法字符，不得返回对象包装、voiceoverText、voiceoverZh 或第二份口播来源。character-strings-v2 仅用于需要 voiceoverZh 的非普通话字符计量语言。
只输出符合 JSON Schema 的一个原生 JSON 对象，不输出 Markdown、代码围栏、前后解释或任何其他字符。`;

const USE_DIRECTION_PLAN_COMPACT_GENERATION_SYSTEM_INSTRUCTION = `${SEEDANCE_TIKTOK_SHOP_STORYBOARD_ROLE}
你同时是 Lindyson AI 的 TikTok Shop 成交短视频执行编剧。输入已经锁定产品、商业角色、使用方向、场景、唯一购买理由、可靠证据、出镜方式、唯一动作预算、镜头职责和视频配置；只能把这些约束扩写为当前 planIndex 的可执行镜头，不得重选方向或增加产品能力、人物、地点、包装、道具和未经确认事实。
第一镜必须发生与产品相关的真实物理事件并快速出现商品；中段只通过 lockedProductActions 与 assignedEvidence 证明唯一购买理由；10/15 秒末段必须以目标语言直接引导点击商品卡、查看商品或立即下单，且不得新增产品动作。5 秒 audioMode=sound-design-only 时固定两个镜头，只延续同一个商品动作，以商品清晰可见和持续运镜收口；无对白、无人声、无旁白，不生成 CTA 文字、字幕、价格、按钮、商品卡、购物车或平台 UI。
全片只允许 majorActionPlan 中的动作族。每个 shot 严格对应 requiredShotRoles 的同索引职责，持续包含产品、手部、摄像机、动作点剪辑或合法环境运动；不得静止、定格或用同义改写派生新动作。只能使用 assignedEvidence、allowedCommercialClaims 和明确提供的 allowedCategoryInference；不得编造价格、功效、认证、评价、稀缺性或竞品结论。
${USE_DIRECTION_PLAN_COMPACT_WIRE_V2_INSTRUCTION}`;

const USE_DIRECTION_PLAN_COMPACT_FORMAT_REPAIR_SYSTEM_INSTRUCTION = `${SEEDANCE_TIKTOK_SHOP_STORYBOARD_ROLE}
你只负责基于输入中已经锁定的产品路线、场景、证据、唯一动作、视频配置和口播契约，重新生成一个最小 JSON 对象。输入不包含上一轮正文；不得猜测、引用或复述上一轮输出。
只能返回 shots，以及 JSON Schema 要求时的 voiceoverSlots。shots 只包含 shotSize、action、cameraMovement、lightingAndRealism、foley、editingCue；不得包含 voiceover、voiceoverZh，也不得返回 hook、name、narrative、cameraAndPacing、primaryScene、differenceTags、planningReview、segments、productionWarnings、productionNote 或额外字段。hook 由服务端逐字使用输入的 lockedHookZh 补齐；不得回传或改写 lockedHookZh。
严格保持 selectedUseDirection、selectedScene、assignedEvidence、majorActionPlan、fixedVideoConfig、requiredShotRoles 和已有 outputContract；不得改变任何锁定事实。audioMode=sound-design-only 时不得返回 voiceoverSlots 或任何口播；有 outputContract 时只按该契约返回唯一口播来源。
outputContract.format=full-plan-indexed-character-arrays-v3 时，每个 voiceoverSlots.segmentN 必须直接返回 exactCharacterCount 个单字符字符串元素，不得返回对象包装、voiceoverText、voiceoverZh 或统计字段。character-strings-v2 只按非普通话译文契约返回。
只输出一个可由标准 JSON.parse 原生解析并符合 JSON Schema 的 JSON 对象；不得输出围栏、解释、注释或 JSON 之外字符。`;

const USE_DIRECTION_PLAN_COMPACT_SCHEMA_REPAIR_SYSTEM_INSTRUCTION = `${USE_DIRECTION_PLAN_COMPACT_GENERATION_SYSTEM_INSTRUCTION}
这是当前最小 Draft Wire V2 的一次结构修复。只修复 repairIssue 指向的键、数量、槽位或字段形状；不得把服务端确定性字段加回响应，也不得改变锁定路线、场景、证据、动作预算、视频配置或目标语言。严格返回 outputWire 指定的完整紧凑对象。`;

const USE_DIRECTION_PLAN_SOUND_DESIGN_CONTENT_REPAIR_SYSTEM_INSTRUCTION = `${USE_DIRECTION_PLAN_SOUND_DESIGN_SYSTEM_INSTRUCTION}
这是当前纯视觉单方案的定向内容修复。只修改 repairIssue.fieldPaths 指向的内容，其他字段保持 previousDraft 的事实、含义与结构不变；不得改变路线、场景、唯一购买理由、证据、视频配置或唯一商品动作。`;

const USE_DIRECTION_PLAN_SOUND_DESIGN_FORMAT_REPAIR_SYSTEM_INSTRUCTION = `${USE_DIRECTION_PLAN_SOUND_DESIGN_SYSTEM_INSTRUCTION}
这是当前纯视觉单方案的 JSON 格式恢复。不得引用或猜测上一轮无法解析的正文；按完全相同的路线、场景和证据重新返回可被标准 JSON.parse 解析的完整对象。`;

const USE_DIRECTION_PLAN_CONTENT_REPAIR_SYSTEM_INSTRUCTION = `${USE_DIRECTION_PLAN_GENERATION_SYSTEM_INSTRUCTION}
这是当前单方案的定向内容修复。只修改 repairIssue.fieldPaths 指向的内容，其他字段保持 previousDraft 的事实、含义与结构不变；不得改变方向、场景、variant、唯一购买理由、证据、视频配置或目标语言。
修复时仍必须按 majorActionPlan.shotRules 收口动作：只能复用 lockedProductActions，resolution 与 CTA 不得新增产品动作，也不得用同义改写把新动作伪装成原动作。`;

const USE_DIRECTION_PLAN_VOICEOVER_REPAIR_SYSTEM_INSTRUCTION = `${SEEDANCE_TIKTOK_SHOP_STORYBOARD_ROLE}
你现在只负责压缩并重写一套已经通过画面与事实门禁的 TikTok Shop 视频口播。不得返回或改写画面、动作、运镜、证据或其他脚本字段。
逐段严格遵守 voiceoverBudget.targetUnits，不能超出或借用其他段额度；全片合计严格等于 totalVoiceoverBudget.targetUnits。保持产品、唯一购买理由、自证逻辑和直接购买 CTA，不新增任何商业事实。
当输入含 outputContract.format=indexed-word-slots-v1 时，必须返回 segment0、segment1…固定属性；每个 voiceoverWords 元素只能放一个不含空白的目标语言词，严禁在同一元素中藏入多词。JSON Schema 锁定的数组长度就是该段唯一允许词数，必须在槽位内写成语义完整的口播，不得用空字符、占位符、字数标签或截断句子凑数。
当输入含 outputContract.format=indexed-character-arrays-v3 时，必须返回 segment0、segment1…固定属性；每个 segmentN 直接是 exactCharacterCount 长度的字符串数组。每项必须恰好一个无需 NFKC 规范化的可朗读汉字、字母或数字，不得包含标点、空白、控制符、零宽符、emoji、空项、多字符项、对象包装、voiceoverText、voiceoverZh 或占位符。服务端整组校验后原子拼接口播。
前三秒的目标语言口播必须明确说出当前产品名称或品类，不能只用“this/it/look”等代词；末段必须是直接购买 CTA。目标语言不是普通话时，对应中文译文必须逐字包含 semanticRequirements 指定的产品名称或品类及行动短语，并保持忠实翻译。目标语言是普通话时，产品首提与 CTA 要求直接在拼接后的 voiceover 中按 semanticRequirements.targetLanguageMustContainOneOf 检查；indexed-character-arrays-v3 响应不得包含 voiceoverZh，由服务端确定性写入空字符串。
只输出符合 JSON Schema 的原生 JSON 对象，不输出解释、Markdown 或字数统计。`;

const USE_DIRECTION_PLAN_FORMAT_REPAIR_SYSTEM_INSTRUCTION = `${USE_DIRECTION_PLAN_GENERATION_SYSTEM_INSTRUCTION}
这是当前单方案的 JSON 格式恢复。不得引用或猜测上一轮无法解析的正文；按完全相同的方向、场景和证据重新返回可被标准 JSON.parse 解析的完整对象。`;

const USE_DIRECTION_PLAN_REFINEMENT_SYSTEM_INSTRUCTION = `${USE_DIRECTION_PLAN_GENERATION_SYSTEM_INSTRUCTION}
这是用户主动发起的单方案微调。只执行 repairIssue.action 并修改允许字段；不得改变方向、场景、variant、唯一购买理由、证据、视频配置或目标语言。`;

const PRODUCT_ANALYSIS_SYSTEM_INSTRUCTION = `你是电商产品视觉分析器。只报告图片中可见且能够确认的事实。
所有说明性字段必须使用简体中文，包括产品名称、品类、材质、结构、使用方式、建议受众、建议场景、可见事实、待确认信息和一致性约束。
产品名称采用“中文品类 + 原品牌/型号”的形式；品牌、型号只在 productName 保留原文，Logo 和图片中实际印花文字只在 logo 保留原文，不要翻译或改写。
logo 集中记录 Logo 或印花的位置与真实原文；除 productName 和 logo 外，其余字段不得抄录外语原文，说明性外语必须翻译成简体中文，确需提及原文时只用中文指代。
${PRODUCT_ANALYSIS_CHINESE_GATE}
visibleFacts 与 needsConfirmation 的每一项都必须是独立、完整且以简体中文为主的说明句，不能用其他数组项中的中文补足；不得输出外语解释或中外文并列。
colors 是废弃兼容字段，必须返回空字符串；不要另行概括颜色。
不要根据图片猜测价格、折扣、认证、性能数字、效果承诺、竞品结论或用户评价。
看不清或无法确认的内容放入 needsConfirmation。建议受众和场景必须明确是建议。
userConfirmedClaims 必须返回空字符串，只有用户本人可以填写。
consistencyConstraints 只描述可见的外观、材质、结构、Logo 和不得变化的细节。
evidenceSources 必须为每个非空的 productName、category、materials、structure、logo、usage 和 visibleFacts[i] 各返回一条字段级图片溯源，fieldPath 必须精确使用这些字段名或 visibleFacts[0] 形式的零基路径，不能为 suggestedAudience、suggestedScenarios、needsConfirmation 或 consistencyConstraints 伪造图片事实来源。
sourceImageIndexes 使用本次输入图片的一基顺序（第一张为 1），只能引用实际存在的图片；visibleRegion 用简体中文写明可见区域；confidence 只能按真实可见程度选择 high、medium 或 low；proofActions 只写当前图片事实可以通过何种镜头动作自证，不能新增卖点。看不清或只靠常识推断的字段必须标为 low，并将具体待确认问题写入 needsConfirmation。
字段必须简洁：productName、category、materials、logo 各不超过500字符；structure、usage、suggestedAudience、suggestedScenarios、consistencyConstraints 各不超过2000字符。
visibleFacts 与 needsConfirmation 各最多20项，每项1–300字符，不得返回空白项；每项只表达一个事实或一个待确认问题。
${PRODUCT_ANALYSIS_OUTPUT_PREFLIGHT}`;

const PRODUCT_PROFILE_REPAIR_SYSTEM_INSTRUCTION = `你是产品档案结构与简体中文修复器。输入是一次已经完成的图片事实分析，不会再次提供图片。
只修复 issues 指出的字段，允许把已有文字翻译成简体中文、修正字段类型、缩短超长文字、删除空白项、重复项或超过数量限制的末尾项目。
repairScope.editableFieldPaths 是唯一允许修改的路径；返回完整对象时，其他字段及其他数组项必须逐字保持不变。languagePolicy 是本地校验的精确规则，不是建议：每个 language 路径必须单独包含汉字，忽略 allowedOriginalLatinTokens 后的拉丁字符数不得超过 max(4, 汉字数)。
visibleFacts 与 needsConfirmation 的每一项必须是独立、完整且以简体中文为主的说明句，不得把中文和整句外语并列输出。说明性外语必须翻译；仅允许在中文说明中原样保留 languagePolicy.allowedOriginalLatinTokens 对应的真实品牌、型号、Logo 或可见印花，不得自行扩大允许列表。
不得新增或推断任何产品事实；不得强化或替换已有事实；不得新增数字、价格、折扣、认证、性能、功效、成分、材质结论、竞品结论或用户评价。
缺失的字符串只能补空字符串，缺失的数组只能补空数组；不得为了让字段非空而编造内容。
产品名称可采用“中文品类 + 原品牌/型号”的形式；品牌、型号、Logo 和实际印花文字必须原样保留。
colors 与 userConfirmedClaims 必须返回空字符串。数组只能保持或减少原有有效项目数量；原字段缺失时必须为空数组。
evidenceSources 只能修复已有事实的来源形状、路径、简体中文区域说明、可信度和自证动作，不得新增图片索引或把待确认信息改成图片可见事实；若 visibleFacts 因删除空项发生索引移动，必须同步调整 fieldPath。
productName、category、materials、logo 各不超过500字符；structure、usage、suggestedAudience、suggestedScenarios、consistencyConstraints 各不超过2000字符。
visibleFacts 与 needsConfirmation 各最多20项，每项1–300字符且不得为空白。
不要输出 Markdown 或解释，只输出符合 JSON Schema 的对象。`;

const PRODUCT_FORMAT_REPAIR_SYSTEM_INSTRUCTION = `${PRODUCT_ANALYSIS_SYSTEM_INSTRUCTION}
这是同一批产品图片的一次 JSON 格式恢复。请重新观察当前提供的全部图片并重新生成产品档案；上一轮无法解析的正文不会提供，也不得猜测其内容。
格式恢复仍必须先按上述清单逐字段、逐数组项完成中文门禁自检，不得因为本轮重点是 JSON 格式而跳过内容门禁。
格式恢复必须再次执行字段类型自检：visibleFacts 与 needsConfirmation 只能是原生 JSON 字符串数组，禁止返回字符串；其他字段只能是 JSON 字符串，禁止返回数组或对象。
必须直接返回一个符合 JSON Schema 的原生 JSON 对象，不得返回 Markdown、代码围栏、前后解释或 JSON 之外的任何字符。`;

const PLAN_GENERATION_SYSTEM_INSTRUCTION = `你是短视频脚本预审与镜头执行策划器。输入中的主创作方向、directionBlueprint、视频配置、requiredShotRoles、assignedStrategy、languagePolicy 和 structuredOutputPolicy 都是硬约束。
一次只返回当前 planIndex 对应的一个完整方案；必须先完成脚本预审，再根据 requiredShotRoles 生成结构化 segments 和必要的制作提醒。不要输出时间码，服务端会注入连续时间轴。
响应中的 planningReview 必须是原生 JSON 对象，segments 必须直接包含全部镜头字段；differenceTags 和 productionWarnings 必须是原生 JSON 数组。禁止把对象或数组再次 JSON.stringify 成字符串。严格遵循响应 JSON Schema 的字段、类型和 required 约束。
每个字符串必须先去除首尾空白，并严格遵守输入中的 fieldLengthLimits 字符上限；数组数量严格遵守 arrayLimits。不得依赖服务端截断超长内容。
主创作方向固定不变。当前方案必须严格采用 assignedStrategy，禁止改用其他策略或只换同义词。
planningReview 必须沿“产品事实 → 受众痛点 → 非广告切口 → 产品自证 → 自然 CTA”推导。产品自证只能表现 assignedEvidence 中为对应镜头分配的 facts，不得改写为更强的结论。proofPoints 与 evidenceRefs 由服务端确定性写入，不属于你的响应字段。
每个 segment 必须严格按 requiredShotRoles 的相同位置返回 role。地点、主体、景别、动作、运镜、光线与真实感应分别填写，不能把整段自由画面塞进单个字段。Foley 必须来自画面中真实发生的操作或环境；editingCue 必须能执行，并且严禁出现“帧”字，开始、结束或定格只能用“镜头”或“画面”描述。
productionWarnings 必须返回空数组；素材与生成提醒由服务端确定性生成，模型不得在该字段补充卖点、功效、材质结论或商业描述。不生成、不建议任何后期画面文字、花字、字幕或贴纸文案。
segments 的地点、主体、动作和制作提示不得要求视频模型新增可读字幕、贴纸、水印或虚构 Logo；参考图片中原有 Logo 与印花必须保持一致。
方案名称、摘要、planningReview、镜头画面组成、Foley、剪辑、制作提示和风险提示必须使用简体中文；品牌、型号、Logo、可见印花原文与 @图片N 可保留原文。
targetLanguage 只能用于 voiceover，即使目标语言为英语或西班牙语，也绝不能扩散到其他字段。targetLanguage 不是“普通话”时，voiceover 非空则 voiceoverZh 必须是忠实的简体中文译文；voiceover 为空则 voiceoverZh 也为空。targetLanguage 是“普通话”时，voiceoverZh 必须为空字符串。
只能引用 imageReferences 中真实存在的 @图片N；不得出现首帧、尾帧、首尾帧、first frame 或 last frame。
claimPolicy.allowedCommercialClaims 是商业宣称的唯一授权源，只能逐字精确复用完整条目，不得改写、拼接、推断或强化。列表为空时，禁止所有数值、比例、认证、性能、功效、成分和绝对化保证，包括“100%”“零风险”“永久”等表达。即使图片、文件名、产品档案、visibleFacts 或 assignedEvidence 出现这些内容，也不能视为授权；可见原文仅可原样保留品牌、型号、Logo 与印花文字。不得伪造购买经历、社会证明、虚假稀缺、危险测试、魔法变化、竞品结论或用户评价。
保持每个字段简洁且信息密度高，不在多个字段中重复同一段说明。
所有字符串值必须保持单行。内容需要引用品牌、型号或印花原文时优先使用中文弯引号“”；不得在字符串内部写未转义的 ASCII 双引号、反斜杠、换行、制表符或其他控制字符。输出前必须在内部执行 JSON 词法自检，确保首字符为 {、末字符为 }、无尾随逗号，并能被标准 JSON.parse 直接解析；不要输出自检过程。
不要复述规则，不要输出 Markdown，只输出符合 JSON Schema 的对象。`;

const PLAN_FORMAT_REPAIR_SYSTEM_INSTRUCTION = `${PLAN_GENERATION_SYSTEM_INSTRUCTION}
这是同一 planIndex 的一次 JSON 格式恢复。上一轮无法解析的正文不会提供给你；请根据完整的固定输入重新生成。必须返回同一策略下的合法 JSON 对象，不得改变 assignedStrategy、assignedEvidence、视频配置、图片引用或目标语言。不得输出代码围栏、前后说明或 JSON 之外的任何字符。`;

const PLAN_CONTENT_REPAIR_SYSTEM_INSTRUCTION = `${PLAN_GENERATION_SYSTEM_INSTRUCTION}
这是当前 planIndex 的一次定向内容修复。repairIssue 是唯一允许修改的问题范围；必须以 previousDraft 为基准，只修改 fieldPaths 指向的字段并执行 action，其他字段内容和含义保持不变。
不得改变 assignedStrategy、assignedEvidence、视频配置、图片引用或目标语言；仍需返回完整的单方案 JSON 对象。不得输出代码围栏、前后说明或 JSON 之外的任何字符。`;

const PLAN_CONTENT_FORMAT_REPAIR_SYSTEM_INSTRUCTION = `${PLAN_CONTENT_REPAIR_SYSTEM_INSTRUCTION}
这是同一内容修复的一次 JSON 格式恢复。上一轮无法解析的正文不会提供给你；必须继续执行当前 repairIssue，不得扩大修改范围。必须直接返回合法 JSON，不得输出 JSON 之外的任何字符。`;

const PLAN_REFINEMENT_SYSTEM_INSTRUCTION = `${PLAN_GENERATION_SYSTEM_INSTRUCTION}
这是用户主动发起的一次单方案定向微调，不是重新生成整批方案。refinement.action 是唯一的修改目标，refinement.editableFields 是允许修改的最大字段范围；必须以 previousDraft 为基准完成动作，并返回完整单方案 JSON。
保持原主创作方向、第一秒问题、唯一购买理由、产品事实、可靠证据 ID、图片引用、镜头职责、固定视频配置和目标语言不变。若 action 指定目标场景，只能迁移到该目标场景，不得自行改选其他场景或新增用户未提供的素材。
微调后仍必须通过事实、安全、中文、口播时长、动作预算和产品一致性门禁。不得借微调新增价格、折扣、认证、功效、性能数字、社会证明、竞品结论、稀缺主张或不可执行的魔法变化。
不得输出差异说明、Markdown 或代码围栏，只输出修复后的完整合法 JSON 对象。`;

const promptWizardConceptWireSchema = promptWizardConceptPreviewSchema.omit({ id: true });
const promptWizardConceptWireSetSchema = z.object({
  concepts: z.array(promptWizardConceptWireSchema).length(8),
}).strict();

const promptWizardUseDirectionWireSceneSchema = z.object({
  title: z.string(),
  environment: z.string(),
}).strict();

const promptWizardUseDirectionWireSchema = z.object({
  title: z.string(),
  useMoment: z.string(),
  audienceNeed: z.string(),
  evidenceIds: z.array(z.string()),
  sceneOptions: z.array(promptWizardUseDirectionWireSceneSchema),
  recommendedSceneIndex: z.number().int().nonnegative(),
  appearanceMode: promptWizardAppearanceModeSchema,
  requiredAssets: z.array(z.string()),
}).strict();

const promptWizardUseDirectionWireSetSchema = z.object({
  directions: z.array(promptWizardUseDirectionWireSchema).max(3),
  clarificationQuestion: z.string(),
}).strict().superRefine((value, context) => {
  if (value.directions.length === 0) {
    if (value.clarificationQuestion !== PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clarificationQuestion'],
        message: '证据不足时必须返回固定补充问题',
      });
    }
    return;
  }
  if (value.directions.length < 2 || value.directions.length > 3) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['directions'],
      message: '正常结果必须包含 2–3 个产品使用方向',
    });
  }
  if (value.clarificationQuestion !== '') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['clarificationQuestion'],
      message: '正常结果不得同时请求用户补充信息',
    });
  }
});

const PROMPT_WIZARD_STRATEGY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'hookType', 'narrativeArc', 'sceneFamily', 'cameraGrammar',
    'pacing', 'proofMechanism', 'ctaStyle',
  ],
  properties: {
    hookType: { type: 'string' },
    narrativeArc: { type: 'string' },
    sceneFamily: { type: 'string' },
    cameraGrammar: { type: 'string' },
    pacing: { type: 'string' },
    proofMechanism: { type: 'string' },
    ctaStyle: { type: 'string' },
  },
} as const;

const PROMPT_WIZARD_PRODUCTION_LOAD_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'locationCount', 'personCount', 'majorActionCount', 'propCount',
    'cameraMoveCount', 'hasMagicTransition',
  ],
  properties: {
    locationCount: { type: 'integer' },
    personCount: { type: 'integer' },
    majorActionCount: { type: 'integer' },
    propCount: { type: 'integer' },
    cameraMoveCount: { type: 'integer' },
    hasMagicTransition: { type: 'boolean' },
  },
} as const;

const PROMPT_WIZARD_CONCEPT_SET_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['concepts'],
  properties: {
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'role', 'title', 'firstSecondEvent', 'viewerQuestion',
          'purchaseReason', 'tension', 'productAction', 'visibleResult',
          'evidenceIds', 'scene', 'perspective', 'cameraGrammar',
          'ctaCallback', 'requiredAssets', 'difficulty', 'risk',
          'direction', 'strategy', 'productionLoad', 'rank',
        ],
        properties: {
          role: {
            type: 'string',
            enum: ['reliable-conversion', 'creative-breakthrough'],
          },
          title: { type: 'string', description: '简体中文路线名' },
          firstSecondEvent: { type: 'string', description: '第一秒可理解的物理事件' },
          viewerQuestion: { type: 'string', description: '观众继续观看所等待的答案' },
          purchaseReason: { type: 'string', description: '唯一购买理由' },
          tension: { type: 'string', description: '具体痛点或张力' },
          productAction: { type: 'string', description: '具体执行所选 evidence.proofActions 或等价动作，并明确被验证的事实；不得写通用占位句' },
          visibleResult: { type: 'string', description: '动作后镜头真实可见且与所选 evidence.text 对应的状态；不得写通用占位句' },
          evidenceIds: { type: 'array', items: { type: 'string' } },
          scene: { type: 'string' },
          perspective: { type: 'string' },
          cameraGrammar: { type: 'string' },
          ctaCallback: { type: 'string', description: '对 viewerQuestion 的自然回扣' },
          requiredAssets: { type: 'array', items: { type: 'string' } },
          difficulty: { type: 'string', enum: ['low', 'medium', 'high'] },
          risk: { type: 'string', enum: ['low', 'medium', 'high'] },
          direction: {
            type: 'string',
            enum: [
              'ugc', 'problem-solution', 'unboxing-review', 'feature-test',
              'pain-comparison', 'lifestyle', 'cinematic-brand', 'asmr-detail',
            ],
          },
          strategy: PROMPT_WIZARD_STRATEGY_JSON_SCHEMA,
          productionLoad: PROMPT_WIZARD_PRODUCTION_LOAD_JSON_SCHEMA,
          rank: { type: 'integer' },
        },
      },
    },
  },
};

const PROMPT_WIZARD_USE_DIRECTION_SET_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['directions', 'clarificationQuestion'],
  properties: {
    directions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title', 'useMoment', 'audienceNeed',
          'evidenceIds', 'sceneOptions', 'recommendedSceneIndex', 'appearanceMode',
          'requiredAssets',
        ],
        properties: {
          title: { type: 'string', description: '简体中文、产品专属的使用方向标题' },
          useMoment: { type: 'string', description: '产品在什么真实时刻被使用' },
          audienceNeed: { type: 'string', description: '该时刻观众需要解决的单一需求' },
          evidenceIds: { type: 'array', items: { type: 'string' }, description: '可靠证据 ID；最能支持唯一购买理由且具有 proofActions 的主证据必须排在第一位' },
          sceneOptions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'environment'],
              properties: {
                title: { type: 'string' },
                environment: { type: 'string' },
              },
            },
          },
          recommendedSceneIndex: {
            type: 'integer',
            description: 'sceneOptions 的零基推荐索引',
          },
          appearanceMode: {
            type: 'string',
            enum: ['person', 'hands-only', 'product-only'],
          },
          requiredAssets: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    clarificationQuestion: {
      type: 'string',
      description: `证据不足时精确返回“${PROMPT_WIZARD_USE_DIRECTION_CLARIFICATION}”，否则返回空字符串`,
    },
  },
} as const;

const PRODUCT_PROFILE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'productName', 'category', 'colors', 'materials', 'structure', 'logo', 'usage',
    'suggestedAudience', 'suggestedScenarios', 'visibleFacts', 'needsConfirmation',
    'userConfirmedClaims', 'consistencyConstraints', 'evidenceSources',
  ],
  properties: {
    productName: { type: 'string', description: '必须包含简体中文品类；仅这里可附原品牌或型号' },
    category: { type: 'string', description: '简体中文产品品类；必须含汉字，不得输出外语解释或双语并列' },
    colors: { type: 'string', const: '' },
    materials: { type: 'string', description: '简体中文材质视觉信息；必须含汉字，不得抄录外语说明' },
    structure: { type: 'string', description: '简体中文结构说明；必须含汉字，不得抄录外语说明' },
    logo: { type: 'string', description: '用简体中文说明 Logo 或印花位置，并在这里集中记录真实可见原文' },
    usage: { type: 'string', description: '简体中文使用方式；必须含汉字，不得抄录外语说明' },
    suggestedAudience: { type: 'string', description: '简体中文建议受众；必须含汉字并明确是建议' },
    suggestedScenarios: { type: 'string', description: '简体中文建议场景；必须含汉字并明确是建议' },
    visibleFacts: {
      type: 'array',
      description: '每项独立执行中文门禁，不得跨项合并计数；外文内容只用中文指代，真实原文集中放入 logo',
      items: { type: 'string', description: '独立的简体中文事实句；必须含汉字，拉丁字符数不得超过 max(4, 汉字数)，不得输出外语解释或双语并列' },
    },
    needsConfirmation: {
      type: 'array',
      description: '每项独立执行中文门禁，不得跨项合并计数；外文内容只用中文指代',
      items: { type: 'string', description: '独立的简体中文待确认句；必须含汉字，拉丁字符数不得超过 max(4, 汉字数)，不得输出外语解释或双语并列' },
    },
    userConfirmedClaims: { type: 'string', const: '' },
    consistencyConstraints: { type: 'string', description: '简体中文产品一致性约束；必须含汉字，不得抄录外语说明' },
    evidenceSources: {
      type: 'array',
      description: '逐条覆盖产品字段和 visibleFacts 的真实图片来源；图片序号一基，不得默认引用全部图片',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'fieldPath', 'sourceImageIndexes', 'visibleRegion', 'confidence', 'proofActions',
        ],
        properties: {
          fieldPath: { type: 'string', description: 'productName/category/materials/structure/logo/usage 或 visibleFacts[零基索引]' },
          sourceImageIndexes: { type: 'array', items: { type: 'integer' }, description: '实际支持该事实的一基图片序号' },
          visibleRegion: { type: 'string', description: '简体中文可见区域，如“图片 2 左下角包装标签”' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          proofActions: { type: 'array', items: { type: 'string' }, description: '简体中文、只基于该事实的可拍摄自证动作' },
        },
      },
    },
  },
};

const wireString = z.string();
const promptWizardDraftWireV2ShotSchema = z.object({
  shotSize: z.string().trim().min(1).max(80),
  action: z.string().trim().min(1).max(300),
  cameraMovement: z.string().trim().min(1).max(180),
  lightingAndRealism: z.string().trim().min(1).max(220),
  foley: z.string().trim().min(1).max(180),
  editingCue: z.string().trim().min(1).max(180),
}).strict();

const promptWizardDraftWireV2Schema = z.object({
  hook: z.string().trim().min(1).max(300),
  shots: z.array(promptWizardDraftWireV2ShotSchema).min(2).max(4),
  voiceoverSlots: z.record(z.string(), z.unknown()).optional(),
}).strict();

const promptWizardDraftRecoveryWireV2Schema = z.object({
  shots: z.array(promptWizardDraftWireV2ShotSchema).min(2).max(4),
  voiceoverSlots: z.record(z.string(), z.unknown()).optional(),
}).strict();

const promptWizardDraftWirePlanSchema = z.object({
  name: wireString,
  hook: wireString,
  narrative: wireString,
  primaryScene: wireString,
  cameraAndPacing: wireString,
  // 方舟结构化输出目前不会可靠执行数组数量约束。这个字段只用于方案摘要，
  // 因此先接受原生字符串数组，再由服务端确定性去重、截断并补足两个安全标签。
  differenceTags: z.array(wireString),
  planningReview: z.object({
    targetAudience: wireString,
    surfaceNeed: wireString,
    realPainPoint: wireString,
    nonAdEntry: wireString,
    directionFit: wireString,
  }).strict(),
  segments: z.array(z.object({
    role: wireString,
    location: wireString,
    subject: wireString,
    shotSize: wireString,
    action: wireString,
    cameraMovement: wireString,
    lightingAndRealism: wireString,
    voiceover: wireString,
    voiceoverZh: wireString,
    foley: wireString,
    editingCue: wireString,
    productionNote: wireString,
  }).strict()).min(2).max(4),
  productionWarnings: z.array(wireString).max(8),
}).strict();

function normalizeWireStrings(values: string[]) {
  const uniqueValues: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueValues.push(normalized);
  }
  return uniqueValues;
}

function normalizePromptWizardDifferenceTags(
  values: string[],
  controlledFallbacks: readonly string[],
) {
  const normalized = normalizeWireStrings(values).slice(0, 6);
  if (normalized.length >= 2) return normalized;
  const seen = new Set(normalized.map(value => value.normalize('NFKC').trim()));
  for (const fallback of controlledFallbacks) {
    const key = fallback.normalize('NFKC').trim();
    if (!key || seen.has(key)) continue;
    normalized.push(fallback);
    seen.add(key);
    if (normalized.length >= 2) break;
  }
  return normalized;
}

function defaultPromptWizardSubject(
  input: Parameters<PromptWizardProvider['generateDrafts']>[0],
) {
  return input.imageCount > 0
    ? `@图片1 对应${input.profile.category}`
    : `已确认的${input.profile.category}`;
}

function defaultPromptWizardAction(
  role: ReturnType<typeof promptWizardShotRoles>[number],
  input: Parameters<PromptWizardProvider['generateDrafts']>[0],
  fallbackFact?: string,
) {
  const product = defaultPromptWizardSubject(input);
  const proof = fallbackFact || input.profile.structure;
  if (role === 'hook') {
    return `${product}自然进入真实使用场景，以一个连续动作建立观看问题。`;
  }
  if (role === 'proof') {
    return `按照已确认的正确方式完成操作：${input.profile.usage}，并清楚展示${proof}。`;
  }
  if (role === 'proof-resolution') {
    return `连续完成${input.profile.usage}，同时展示${proof}并回扣开场需求。`;
  }
  if (role === 'resolution') {
    return `在真实场景中继续${input.profile.usage}，通过${proof}呈现问题得到缓解后的状态。`;
  }
  return `保持${product}的自然使用状态，以克制的动作完成收束。`;
}

function decodePromptWizardDraftWirePlan(
  value: unknown,
  input: Parameters<PromptWizardProvider['generateDrafts']>[0],
  planIndex: number,
  segmentCount: number,
) {
  if (!isPromptWizardPlanIndex(planIndex)) {
    throw promptWizardProviderInputError('方案索引必须是 0 或 1');
  }
  const plan = promptWizardDraftWirePlanSchema.parse(value);
  const directionBlueprint = getPromptWizardDirectionBlueprint(input.brief.direction);
  const requiredShotRoles = promptWizardShotRoles(input.config.durationSeconds);
  const assignedConcept = assignedPromptWizardConcept(input, planIndex);
  const evidenceAllocation = allocatePromptWizardEvidence({
    evidenceGraph: input.evidenceGraph,
    shotRoles: requiredShotRoles,
    planIndex,
    preferredFactIds: assignedConcept.evidenceIds,
  });
  const fallbackFactText = evidenceAllocation.proofPoints[0];
  if (plan.segments.length !== segmentCount) {
    throw new z.ZodError([{
      code: 'custom',
      path: ['segments'],
      message: `必须返回 ${segmentCount} 个镜头`,
    }]);
  }
  const strategy = input.strategies[planIndex]!;
  return promptWizardPlanDraftSchema.parse({
    name: plan.name.trim(),
    hook: plan.hook.trim(),
    narrative: plan.narrative.trim(),
    primaryScene: plan.primaryScene.trim(),
    cameraAndPacing: plan.cameraAndPacing.trim(),
    differenceTags: normalizePromptWizardDifferenceTags(
      plan.differenceTags,
      ['真实动作', '产品自证'],
    ),
    planningReview: (() => {
      const review = plan.planningReview;
      return {
        targetAudience: review.targetAudience.trim()
          || input.profile.suggestedAudience
          || `需要了解${input.profile.category}使用方式的用户`,
        surfaceNeed: review.surfaceNeed.trim()
          || `希望了解${input.profile.category}如何用于${input.profile.suggestedScenarios}`,
        realPainPoint: review.realPainPoint.trim()
          || '需要通过真实使用过程判断产品是否适合当前场景',
        nonAdEntry: review.nonAdEntry.trim() || plan.hook.trim(),
        proofPoints: evidenceAllocation.proofPoints,
        directionFit: review.directionFit.trim()
          || `采用${directionBlueprint.label}的镜头职责与真实使用过程展开。`,
      };
    })(),
    segments: plan.segments.map((segment, segmentIndex) => {
      const role = requiredShotRoles[segmentIndex]!;
      return {
        role,
        location: segment.location.trim() || plan.primaryScene.trim(),
        subject: segment.subject.trim() || defaultPromptWizardSubject(input),
        shotSize: segment.shotSize.trim() || '中近景',
        action: segment.action.trim() || defaultPromptWizardAction(role, input, fallbackFactText),
        cameraMovement: segment.cameraMovement.trim() || strategy.cameraGrammar,
        lightingAndRealism: segment.lightingAndRealism.trim()
          || directionBlueprint.visualStyle[segmentIndex % directionBlueprint.visualStyle.length]
          || '自然光与真实环境质感',
        voiceover: segment.voiceover.trim(),
        voiceoverZh: segment.voiceoverZh.trim(),
        foley: segment.foley.trim() || fakeFoleyForRole(role),
        editingCue: segment.editingCue.trim() || `${strategy.pacing}，在动作完成点剪切`,
        productionNote: segment.productionNote.trim(),
        evidenceRefs: evidenceAllocation.evidenceRefsByShot[segmentIndex]!,
      };
    }),
    productionWarnings: normalizeWireStrings(plan.productionWarnings),
  });
}

export function createPromptWizardDraftWireV2JsonSchema(
  input: PromptWizardUseDirectionDraftGenerationContext,
  segmentCount = expectedPromptWizardDraftSegmentCount(input),
  recovery = false,
) {
  if (isPromptWizardV6DraftContext(input)) {
    return createPromptWizardFlatScalarJsonSchema(
      createPromptWizardFlatScalarLayout(
        input,
        segmentCount,
        recovery ? 'recovery' : 'creative',
      ),
    );
  }
  const slotContract = promptWizardFullDraftSlotContract(input, segmentCount);
  const voiceoverSlotsSchema = slotContract?.format === 'full-plan-indexed-word-slots-v1'
    ? {
        type: 'object',
        additionalProperties: false,
        required: slotContract.segments.map(segment => segment.property),
        properties: Object.fromEntries(slotContract.segments.map(segment => ([
          segment.property,
          {
            type: 'object',
            additionalProperties: false,
            required: ['voiceoverWords', 'voiceoverZh'],
            properties: {
              voiceoverWords: {
                type: 'array',
                minItems: segment.exactWordCount,
                maxItems: segment.exactWordCount,
                items: { type: 'string', minLength: 1 },
              },
              voiceoverZh: { type: 'string', minLength: 1, maxLength: 300 },
            },
          },
        ]))),
      }
    : slotContract?.format === 'full-plan-indexed-character-arrays-v3'
      ? {
          type: 'object',
          additionalProperties: false,
          required: slotContract.segments.map(segment => segment.property),
          properties: Object.fromEntries(slotContract.segments.map(segment => ([
            segment.property,
            {
              type: 'array',
              minItems: segment.exactCharacterCount,
              maxItems: segment.exactCharacterCount,
              items: {
                type: 'string',
                minLength: 1,
                maxLength: 1,
              },
            },
          ]))),
        }
    : slotContract?.format === 'full-plan-indexed-character-strings-v2'
      ? {
          type: 'object',
          additionalProperties: false,
          required: slotContract.segments.map(segment => segment.property),
          properties: Object.fromEntries(slotContract.segments.map(segment => ([
            segment.property,
            {
              type: 'object',
              additionalProperties: false,
              required: segment.fields,
              properties: {
                voiceoverText: {
                  type: 'string',
                  minLength: segment.exactCharacterCount,
                  maxLength: segment.exactCharacterCount,
                },
                ...(segment.fields.length === 2 ? {
                  voiceoverZh: { type: 'string', minLength: 1, maxLength: 300 },
                } : {}),
              },
            },
          ]))),
        }
      : undefined;
  const shotProperties = {
    shotSize: { type: 'string', minLength: 1, maxLength: 80 },
    action: { type: 'string', minLength: 1, maxLength: 300 },
    cameraMovement: { type: 'string', minLength: 1, maxLength: 180 },
    lightingAndRealism: { type: 'string', minLength: 1, maxLength: 220 },
    foley: { type: 'string', minLength: 1, maxLength: 180 },
    editingCue: { type: 'string', minLength: 1, maxLength: 180 },
  };
  const required = [
    ...(!recovery ? ['hook'] : []),
    'shots',
    ...(voiceoverSlotsSchema ? ['voiceoverSlots'] : []),
  ];
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties: {
      ...(!recovery
        ? { hook: { type: 'string', minLength: 1, maxLength: 300 } }
        : {}),
      shots: {
        type: 'array',
        minItems: segmentCount,
        maxItems: segmentCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'shotSize', 'action', 'cameraMovement', 'lightingAndRealism',
            'foley', 'editingCue',
          ],
          properties: shotProperties,
        },
      },
      ...(voiceoverSlotsSchema ? { voiceoverSlots: voiceoverSlotsSchema } : {}),
    },
  };
}

function createDraftPlanJsonSchema(options: {
  soundDesignOnly?: boolean;
  slotContract?: PromptWizardFullDraftSlotContract;
} = {}) {
  const usesFullDraftSlots = Boolean(options.slotContract);
  const voiceoverSlotsSchema = options.slotContract?.format
    === 'full-plan-indexed-word-slots-v1'
    ? {
        type: 'object',
        additionalProperties: false,
        required: options.slotContract.segments.map(segment => segment.property),
        properties: Object.fromEntries(options.slotContract.segments.map(segment => ([
          segment.property,
          {
            type: 'object',
            additionalProperties: false,
            required: ['voiceoverWords', 'voiceoverZh'],
            properties: {
              voiceoverWords: {
                type: 'array',
                minItems: segment.exactWordCount,
                maxItems: segment.exactWordCount,
                items: { type: 'string', minLength: 1 },
              },
              voiceoverZh: { type: 'string', minLength: 1 },
            },
          },
        ]))),
      }
    : options.slotContract?.format === 'full-plan-indexed-character-arrays-v3'
      ? {
          type: 'object',
          additionalProperties: false,
          required: options.slotContract.segments.map(segment => segment.property),
          properties: Object.fromEntries(options.slotContract.segments.map(segment => ([
            segment.property,
            {
              type: 'array',
              minItems: segment.exactCharacterCount,
              maxItems: segment.exactCharacterCount,
              items: {
                type: 'string',
                minLength: 1,
                maxLength: 1,
              },
            },
          ]))),
        }
    : options.slotContract?.format === 'full-plan-indexed-character-strings-v2'
      ? {
          type: 'object',
          additionalProperties: false,
          required: options.slotContract.segments.map(segment => segment.property),
          properties: Object.fromEntries(options.slotContract.segments.map(segment => ([
            segment.property,
            {
              type: 'object',
              additionalProperties: false,
              required: segment.fields,
              properties: {
                voiceoverText: {
                  type: 'string',
                  minLength: segment.exactCharacterCount,
                  maxLength: segment.exactCharacterCount,
                },
                ...(segment.fields.length === 2 ? {
                  voiceoverZh: { type: 'string', minLength: 1, maxLength: 300 },
                } : {}),
              },
            },
          ]))),
        }
      : undefined;
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'name', 'hook', 'narrative', 'primaryScene', 'cameraAndPacing', 'differenceTags',
      'planningReview', 'segments', 'productionWarnings',
      ...(usesFullDraftSlots ? ['voiceoverSlots'] : []),
    ],
    properties: {
      name: { type: 'string' },
      hook: { type: 'string' },
      narrative: { type: 'string' },
      primaryScene: { type: 'string' },
      cameraAndPacing: { type: 'string' },
      differenceTags: {
        type: 'array',
        items: { type: 'string' },
      },
      planningReview: {
        type: 'object',
        additionalProperties: false,
        required: [
          'targetAudience', 'surfaceNeed', 'realPainPoint', 'nonAdEntry',
          'directionFit',
        ],
        properties: {
          targetAudience: { type: 'string' },
          surfaceNeed: { type: 'string' },
          realPainPoint: { type: 'string' },
          nonAdEntry: { type: 'string' },
          directionFit: { type: 'string' },
        },
      },
      segments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'role', 'location', 'subject', 'shotSize', 'action', 'cameraMovement',
            'lightingAndRealism', 'voiceover', 'voiceoverZh', 'foley', 'editingCue',
            'productionNote',
          ],
          properties: {
            role: { type: 'string' },
            location: { type: 'string' },
            subject: { type: 'string' },
            shotSize: { type: 'string' },
            action: { type: 'string' },
            cameraMovement: { type: 'string' },
            lightingAndRealism: { type: 'string' },
            voiceover: options.soundDesignOnly || usesFullDraftSlots
              ? { type: 'string', enum: [''] }
              : { type: 'string' },
            voiceoverZh: options.soundDesignOnly || usesFullDraftSlots
              ? { type: 'string', enum: [''] }
              : { type: 'string' },
            foley: { type: 'string' },
            editingCue: { type: 'string' },
            productionNote: { type: 'string' },
          },
        },
      },
      productionWarnings: {
        type: 'array',
        items: { type: 'string' },
      },
      ...(voiceoverSlotsSchema ? { voiceoverSlots: voiceoverSlotsSchema } : {}),
    },
  };
}
