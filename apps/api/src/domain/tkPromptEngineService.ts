import { omitStoredTkPromptField } from './tkPromptEngineLegacy.js';
import {
  tkPromptCreativeInputSchema,
  tkPromptEvidenceProfileSchema,
  tkPromptEvidenceReviewSchema,
  tkPromptVideoConfigSchema,
  type TkPromptCreativeInput,
  type TkPromptEngineSettings,
  type TkPromptEvidenceProfile,
  type TkPromptEvidenceReview,
  type TkPromptGeneration,
  type TkPromptRun,
  type TkPromptVideoConfig,
} from '@lindyson/api-contracts';
import { env } from '../config/env.js';
import { pool, withTransaction, type DbClient } from '../db/pool.js';
import {
  ArkTkPromptEngineProvider,
  type TkPromptEngineProvider,
} from '../providers/tkPromptEngineProvider.js';
import {
  readOwnedAssetReferencesByIds,
  type OwnedAssetReferenceRow,
} from './assetReferences.js';
import { signOwnedObjectReadUrls } from './assetReadUrlSigner.js';
import { reconcileSubscriptionWithClient } from './subscriptionLifecycle.js';
import { getStoredObjectSize } from '../storage/storageService.js';
import {
  compileTkPromptCandidateBeats,
  renderTkPromptExecutionPrompt,
  deriveTkPromptEvidenceFlags,
  normalizeTkPromptCandidateBeatInformation,
  normalizeTkPromptCandidateCameraMovements,
  normalizeTkPromptCandidateFreeText,
  normalizeTkPromptCandidateStructure,
  normalizeTkPromptStrategyAppearanceMode,
  normalizeTkPromptStrategyDiversity,
  normalizeTkPromptStrategyPromotions,
  tkPromptContractError,
  tkPromptEngineRequestSchema,
  tkPromptFactAnalysisSchema,
  tkPromptFactPackSchema,
  tkPromptImageInputSchema,
  tkPromptOptionSchema,
  tkPromptStrategySchema,
  validateTkPromptOptionCandidate,
  validateTkPromptStrategySet,
  type TkPromptEngineRequest,
  type TkPromptEvidenceFlags,
  type TkPromptFactAnalysis,
  type TkPromptFactPack,
  type TkPromptImageInput,
  type TkPromptOption,
  type TkPromptStrategy,
} from './tkPromptEngine.js';
import {
  tkPromptEngineRepository,
  type JsonObject,
  type TkPromptGenerationContext,
} from './tkPromptEngineRepository.js';

const IMAGE_READ_URL_TTL_SECONDS = 10 * 60;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const TK_PROMPT_STALE_CLAIM_AFTER_MS = 20 * 60_000;

interface StoredFactEnvelope extends JsonObject {
  schemaVersion: 1;
  factPack: TkPromptFactPack;
  evidenceReview: TkPromptEvidenceReview;
  evidenceFlags: TkPromptEvidenceFlags;
}

export interface TkPromptEngineRuntime {
  provider?: TkPromptEngineProvider;
  now?: () => number;
}

export async function readTkPromptEngineSettings(): Promise<TkPromptEngineSettings> {
  return tkPromptEngineRepository.getSettings();
}

export async function createTkPromptRun(input: {
  userId: string;
  idempotencyKey: string;
  imageAssetIds: string[];
}): Promise<TkPromptRun> {
  const settings = await tkPromptEngineRepository.getSettings();
  if (!settings.available) throw unavailableError('TK Prompt Engine 当前不可用');
  await requireOwnedTkPromptImages(pool, input.userId, input.imageAssetIds);
  return tkPromptEngineRepository.createRun(input);
}

export async function readTkPromptRun(userId: string, runId: string): Promise<TkPromptRun> {
  return tkPromptEngineRepository.getRun(userId, runId);
}

export async function processTkPromptAnalysis(
  runId: string,
  expectedAttempt: number,
  runtime: TkPromptEngineRuntime = {},
) {
  const claimed = await tkPromptEngineRepository.claimRunAnalysis({
    runId,
    staleBefore: staleBefore(runtime),
    expectedAttempt,
  });
  if (!claimed) return false;
  try {
    const images = await resolveTkPromptEngineImages(claimed.userId, claimed.imageAssetIds);
    const provider = runtime.provider ?? new ArkTkPromptEngineProvider();
    const result = await provider.analyzeFacts({
      images,
      costOwner: {
        runId: claimed.id,
        generationId: null,
        optionId: null,
        userId: claimed.userId,
        claimToken: claimed.claimToken,
        stage: 'analysis',
        action: 'analyze-facts',
        jobAttempt: claimed.attemptCount,
        repairRound: 0,
      },
      deadlineAtMs: now(runtime) + env.PROMPT_WIZARD_BATCH_BUDGET_MS,
    });
    const profile = materializeTkPromptEvidenceProfile(result.value, images);
    await tkPromptEngineRepository.completeRunAnalysis({
      runId: claimed.id,
      userId: claimed.userId,
      claimToken: claimed.claimToken,
      evidenceProfile: profile,
    });
    return true;
  } catch (error) {
    await tkPromptEngineRepository.failRunAnalysis({
      runId: claimed.id,
      userId: claimed.userId,
      claimToken: claimed.claimToken,
      failureReason: failureReason(error),
    }).catch(() => undefined);
    throw error;
  }
}

export async function createTkPromptGeneration(input: {
  userId: string;
  runId: string;
  idempotencyKey: string;
  expectedGenerationCredits: number;
  evidenceReview: TkPromptEvidenceReview;
  creativeInput: TkPromptCreativeInput;
  videoConfig: TkPromptVideoConfig;
}): Promise<TkPromptGeneration> {
  const evidenceReview = tkPromptEvidenceReviewSchema.parse(input.evidenceReview);
  const creativeInput = tkPromptCreativeInputSchema.parse(input.creativeInput);
  const videoConfig = tkPromptVideoConfigSchema.parse(input.videoConfig);
  if (videoConfig.durationSeconds === 5 && creativeInput.verifiedOffer.trim()) {
    throw tkPromptContractError(
      'TK_PROMPT_SOUND_ONLY_OFFER_FORBIDDEN',
      '5 秒纯声音设计方案不能提交优惠信息',
    );
  }
  const run = await tkPromptEngineRepository.getRun(input.userId, input.runId);
  if (run.status !== 'ready' || !run.evidenceProfile) {
    throw tkPromptContractError('TK_PROMPT_RUN_NOT_READY', '事实分析尚未完成');
  }
  await withTransaction(client => reconcileSubscriptionWithClient(client, input.userId));
  const evidenceFlags = deriveTkPromptEvidenceFlags({
    userConfirmedFacts: evidenceReview.userConfirmedFacts.map(fact => fact.text),
    verifiedOffer: creativeInput.verifiedOffer,
    availableScenes: creativeInput.availableScenes,
    availableAssets: creativeInput.availableAssets,
  });
  const factPack = materializeReviewedFactPack({
    evidenceProfile: run.evidenceProfile,
    evidenceReview,
    creativeInput,
  });
  if (videoConfig.durationSeconds === 5 && factPack.demonstrableActions.length === 0) {
    throw tkPromptContractError(
      'TK_PROMPT_REVIEW_ACTION_EMPTY',
      '5 秒方案至少需要一个仍由已保留图片事实支撑的可演示动作',
    );
  }
  const request = buildInternalRequest({
    imageAssetIds: run.imageAssetIds,
    evidenceReview,
    creativeInput,
    videoConfig,
    evidenceFlags,
  });
  tkPromptEngineRequestSchema.parse(request);
  const envelope: StoredFactEnvelope = {
    schemaVersion: 1,
    factPack,
    evidenceReview,
    evidenceFlags,
  };
  return tkPromptEngineRepository.createGeneration({
    userId: input.userId,
    runId: input.runId,
    idempotencyKey: input.idempotencyKey,
    expectedGenerationCredits: input.expectedGenerationCredits,
    confirmedFactPack: envelope,
    creativeInput,
    videoConfig,
  });
}

export async function readTkPromptGeneration(
  userId: string,
  generationId: string,
): Promise<TkPromptGeneration> {
  return tkPromptEngineRepository.getGeneration(userId, generationId);
}

export async function readTkPromptResume(userId: string) {
  return tkPromptEngineRepository.resume(userId);
}

export async function processTkPromptStrategy(
  generationId: string,
  expectedAttempt: number,
  runtime: TkPromptEngineRuntime = {},
): Promise<string[]> {
  const generation = await tkPromptEngineRepository.claimGenerationStrategy({
    generationId,
    staleBefore: staleBefore(runtime),
    expectedAttempt,
  });
  if (!generation) return [];
  try {
    const run = await tkPromptEngineRepository.getRun(generation.userId, generation.runId);
    const stored = parseStoredFactEnvelope(generation.confirmedFactPack);
    const request = buildInternalRequestFromStored(run, generation, stored);
    const provider = runtime.provider ?? new ArkTkPromptEngineProvider();
    const result = await provider.planStrategies({
      request,
      factPack: stored.factPack,
      costOwner: {
        runId: run.id,
        generationId: generation.id,
        optionId: null,
        userId: generation.userId,
        claimToken: generation.claimToken,
        stage: 'strategy',
        action: 'plan-strategies',
        jobAttempt: generation.attemptCount,
        repairRound: 0,
      },
      deadlineAtMs: now(runtime) + env.PROMPT_WIZARD_BATCH_BUDGET_MS,
    });
    const appearanceLockedStrategySet = normalizeTkPromptStrategyAppearanceMode({
      strategySet: result.value,
      appearanceMode: request.appearanceMode,
      durationSeconds: request.durationSeconds,
    });
    const normalizedStrategySet = normalizeTkPromptStrategyPromotions({
      strategySet: appearanceLockedStrategySet,
      factPack: stored.factPack,
    });
    const diversityLockedStrategySet = normalizeTkPromptStrategyDiversity({
      strategySet: normalizedStrategySet,
    });
    const strategies = validateTkPromptStrategySet({
      strategySet: diversityLockedStrategySet,
      factPack: stored.factPack,
      durationSeconds: generation.videoConfig.durationSeconds,
      evidenceFlags: stored.evidenceFlags,
      requireLivePresenter: request.preferLivePresenter,
    });
    enforceAppearanceMode(strategies, generation.creativeInput);
    const saved = await tkPromptEngineRepository.saveStrategiesAndCreateOptions({
      generationId: generation.id,
      userId: generation.userId,
      claimToken: generation.claimToken,
      strategies,
    });
    return saved.options.map(option => option.id);
  } catch (error) {
    await tkPromptEngineRepository.failGeneration({
      generationId: generation.id,
      userId: generation.userId,
      claimToken: generation.claimToken,
      failureReason: failureReason(error),
    }).catch(() => undefined);
    throw error;
  }
}

export async function processTkPromptOption(
  optionId: string,
  expectedAttempt: number,
  runtime: TkPromptEngineRuntime = {},
) {
  const option = await tkPromptEngineRepository.claimOption({
    optionId,
    staleBefore: staleBefore(runtime),
    expectedAttempt,
  });
  if (!option) return false;
  try {
    const generation = await tkPromptEngineRepository.getGenerationWork(
      option.userId,
      option.generationId,
    );
    const run = await tkPromptEngineRepository.getRun(option.userId, generation.runId);
    const stored = parseStoredFactEnvelope(generation.confirmedFactPack);
    const strategy = tkPromptStrategySchema.parse(option.strategyBlueprint);
    const request = buildInternalRequestFromStored(run, generation, stored);
    const provider = runtime.provider ?? new ArkTkPromptEngineProvider();
    const deadlineAtMs = now(runtime) + env.PROMPT_WIZARD_BATCH_BUDGET_MS;
    const baseOwner = {
      runId: run.id,
      generationId: generation.id,
      optionId: option.id,
      userId: option.userId,
      claimToken: option.claimToken,
      stage: 'option' as const,
      jobAttempt: option.attemptCount,
    };
    const initial = await provider.generateOption({
      request,
      factPack: stored.factPack,
      strategy,
      costOwner: { ...baseOwner, action: 'generate-option', repairRound: 0 },
      deadlineAtMs,
    });
    let candidate: unknown = initial.value;
    let validated;
    try {
      validated = validateCandidate(candidate, strategy, stored.factPack, request);
    } catch (initialError) {
      const repaired = await provider.repairOption({
        request,
        factPack: stored.factPack,
        strategy,
        previousCandidate: candidate,
        issues: validationIssues(initialError),
        costOwner: { ...baseOwner, action: 'repair-option', repairRound: 1 },
        deadlineAtMs,
      });
      candidate = repaired.value;
      validated = validateCandidate(candidate, strategy, stored.factPack, request);
    }
    const plan = buildPlan(validated, strategy, stored.factPack, request);
    await tkPromptEngineRepository.completeOption({
      optionId: option.id,
      userId: option.userId,
      claimToken: option.claimToken,
      plan,
    });
    return true;
  } catch (error) {
    await tkPromptEngineRepository.failOption({
      optionId: option.id,
      userId: option.userId,
      claimToken: option.claimToken,
      failureReason: failureReason(error),
    }).catch(() => undefined);
    throw error;
  }
}

export async function recoverTkPromptEngineWork() {
  return tkPromptEngineRepository.recoverableWork(
    new Date(Date.now() - TK_PROMPT_STALE_CLAIM_AFTER_MS),
  );
}

export async function resolveTkPromptEngineImages(
  userId: string,
  imageAssetIds: string[],
): Promise<TkPromptImageInput[]> {
  const orderedAssets = await requireOwnedTkPromptImages(pool, userId, imageAssetIds);
  // 事实层必须读取原图，避免缩略图损失 OCR、型号和微小结构证据。
  const objectKeys = orderedAssets.map(asset => asset.object_key);
  const [signedUrls, sizes, mimeTypes] = await Promise.all([
    signOwnedObjectReadUrls(objectKeys, { expiresInSeconds: IMAGE_READ_URL_TTL_SECONDS }),
    Promise.all(objectKeys.map(objectKey => getStoredObjectSize(objectKey))),
    readTkPromptImageMimeTypes(userId, orderedAssets),
  ]);
  return orderedAssets.map((asset, index) => {
    const objectKey = objectKeys[index]!;
    const sizeBytes = sizes[index]!;
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_IMAGE_BYTES) {
      throw Object.assign(new Error('参考图超过 10 MB 或尺寸信息无效'), {
        statusCode: 400,
        code: 'TK_PROMPT_IMAGE_TOO_LARGE',
        exposeMessage: true,
      });
    }
    return tkPromptImageInputSchema.parse({
      assetId: asset.id,
      name: asset.name,
      url: signedUrls.get(objectKey),
      mimeType: tkPromptImageMimeType({
        objectKey,
        uploadContentType: mimeTypes.get(asset.id),
      }),
      sizeBytes,
    });
  });
}

export function materializeTkPromptEvidenceProfile(
  rawAnalysis: TkPromptFactAnalysis,
  images: TkPromptImageInput[],
): TkPromptEvidenceProfile {
  const analysis = tkPromptFactAnalysisSchema.parse(rawAnalysis);
  const visibleFacts = analysis.visibleFacts.map((fact, index) => ({
    factId: `visible-${String(index + 1).padStart(3, '0')}`,
    text: fact.text,
    sourceImageAssetIds: [...new Set(fact.sourceImageIndexes.map(sourceIndex => {
      const image = images[sourceIndex];
      if (!image) throw tkPromptContractError(
        'TK_PROMPT_FACT_IMAGE_REFERENCE_INVALID',
        `可见事实 ${index + 1} 引用了不存在的图片序号`,
      );
      return image.assetId;
    }))],
    confidence: fact.confidence,
  }));
  return tkPromptEvidenceProfileSchema.parse({
    schemaVersion: 1,
    productIdentity: {
      name: analysis.productName,
      category: analysis.category,
      confidence: analysis.confidence,
    },
    visibleFacts,
    inferredContexts: analysis.internalHypotheses.map((item, index) => ({
      contextId: `inferred-${String(index + 1).padStart(3, '0')}`,
      kind: item.purpose,
      text: item.text,
    })),
    demonstrableActions: analysis.demonstrableActions.map(action => {
      const supportingFacts = action.supportingFactIndexes.map(index => visibleFacts[index]!);
      return {
        actionId: action.actionId,
        text: action.text,
        supportingFactIds: supportingFacts.map(fact => fact.factId),
        sourceImageAssetIds: [...new Set(
          supportingFacts.flatMap(fact => fact.sourceImageAssetIds),
        )],
      };
    }),
    availableMaterials: ['product-images'],
    forbiddenClaims: [],
  });
}

export function materializeReviewedFactPack(input: {
  evidenceProfile: TkPromptEvidenceProfile;
  evidenceReview: TkPromptEvidenceReview;
  creativeInput: TkPromptCreativeInput;
}): TkPromptFactPack {
  const rejected = new Set(input.evidenceReview.rejectedVisibleFactIds);
  const profileFactIds = new Set(input.evidenceProfile.visibleFacts.map(fact => fact.factId));
  if ([...rejected].some(factId => !profileFactIds.has(factId))) {
    throw tkPromptContractError('TK_PROMPT_REVIEW_FACT_INVALID', '事实审核引用了未知图片事实');
  }
  const retainedVisibleFacts = input.evidenceProfile.visibleFacts
    .filter(fact => !rejected.has(fact.factId));
  const retainedVisibleFactById = new Map(
    retainedVisibleFacts.map(fact => [fact.factId, fact] as const),
  );
  const facts = [
    ...retainedVisibleFacts.map(fact => ({
        factId: fact.factId,
        status: 'visible' as const,
        text: fact.text,
        sourceImageIds: fact.sourceImageAssetIds,
      })),
    ...input.evidenceReview.userConfirmedFacts.map(fact => ({
      factId: fact.factId,
      status: 'user-confirmed' as const,
      text: fact.text,
      sourceImageIds: [],
    })),
  ];
  if (!facts.length) {
    throw tkPromptContractError('TK_PROMPT_REVIEW_EMPTY', '至少保留或确认一条商品事实');
  }
  return tkPromptFactPackSchema.parse({
    productName: input.evidenceReview.productName,
    category: input.evidenceReview.category,
    confidence: input.evidenceProfile.productIdentity.confidence,
    facts,
    internalHypotheses: input.evidenceProfile.inferredContexts.map(item => ({
      text: item.text,
      purpose: item.kind,
    })),
    demonstrableActions: input.evidenceProfile.demonstrableActions.flatMap(action => {
      const supportingFacts = action.supportingFactIds.flatMap(factId => {
        const fact = retainedVisibleFactById.get(factId);
        return fact ? [fact] : [];
      });
      if (supportingFacts.length === 0) return [];
      return [{
        actionId: action.actionId,
        text: action.text,
        supportingFactIds: supportingFacts.map(fact => fact.factId),
        sourceImageAssetIds: [...new Set(
          supportingFacts.flatMap(fact => fact.sourceImageAssetIds),
        )],
      }];
    }),
    forbiddenClaims: input.evidenceReview.forbiddenClaims,
    availableMaterials: ['product-images'],
    targetMarket: input.creativeInput.targetMarket,
    spokenLanguage: input.creativeInput.spokenLanguage ?? null,
    verifiedOffer: input.creativeInput.verifiedOffer
      ? { condition: input.creativeInput.verifiedOffer }
      : null,
  });
}

function buildInternalRequest(input: {
  imageAssetIds: string[];
  evidenceReview: TkPromptEvidenceReview;
  creativeInput: TkPromptCreativeInput;
  videoConfig: TkPromptVideoConfig;
  evidenceFlags: TkPromptEvidenceFlags;
}): TkPromptEngineRequest {
  return tkPromptEngineRequestSchema.parse({
    imageAssetIds: input.imageAssetIds,
    durationSeconds: input.videoConfig.durationSeconds,
    targetMarket: input.creativeInput.targetMarket,
    targetAudience: input.creativeInput.targetAudience,
    spokenLanguage: input.creativeInput.spokenLanguage ?? null,
    userConfirmedFacts: input.evidenceReview.userConfirmedFacts.map(fact => fact.text),
    forbiddenClaims: input.evidenceReview.forbiddenClaims,
    evidenceFlags: input.evidenceFlags,
    verifiedOffer: input.creativeInput.verifiedOffer
      ? { condition: input.creativeInput.verifiedOffer }
      : null,
    appearanceMode: input.creativeInput.appearance.mode === 'live_presenter'
      ? 'auto'
      : input.creativeInput.appearance.mode,
    preferLivePresenter: input.creativeInput.appearance.mode === 'live_presenter',
    availableScenes: input.creativeInput.availableScenes,
    availableAssets: input.creativeInput.availableAssets,
  });
}

function buildInternalRequestFromStored(
  run: TkPromptRun,
  generation: TkPromptGenerationContext,
  stored: StoredFactEnvelope,
) {
  return buildInternalRequest({
    imageAssetIds: run.imageAssetIds,
    evidenceReview: {
      productName: stored.factPack.productName,
      category: stored.factPack.category,
      rejectedVisibleFactIds: [],
      userConfirmedFacts: stored.factPack.facts
        .filter(fact => fact.status === 'user-confirmed')
        .map(fact => ({ factId: fact.factId, text: fact.text })),
      forbiddenClaims: stored.factPack.forbiddenClaims,
    },
    creativeInput: generation.creativeInput,
    videoConfig: generation.videoConfig,
    evidenceFlags: stored.evidenceFlags,
  });
}

function parseStoredFactEnvelope(value: JsonObject): StoredFactEnvelope {
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== 1) {
    throw tkPromptContractError('TK_PROMPT_STORED_INPUT_INVALID', '确认事实包版本无效');
  }
  return {
    schemaVersion: 1,
    factPack: tkPromptFactPackSchema.parse(omitStoredTkPromptField(source.factPack, 'publishLanguage')),
    evidenceReview: tkPromptEvidenceReviewSchema.parse(source.evidenceReview),
    evidenceFlags: parseEvidenceFlags(source.evidenceFlags),
  };
}

function enforceAppearanceMode(strategies: TkPromptStrategy[], creative: TkPromptCreativeInput) {
  if (creative.appearance.mode === 'auto' || creative.appearance.mode === 'live_presenter') return;
  for (const strategy of strategies) {
    if (strategy.videoMode !== creative.appearance.mode) {
      throw tkPromptContractError(
        'TK_PROMPT_APPEARANCE_MODE_MISMATCH',
        `策略 ${strategy.slot} 未遵循用户选择的出镜方式`,
      );
    }
  }
}

function validateCandidate(
  candidate: unknown,
  strategy: TkPromptStrategy,
  factPack: TkPromptFactPack,
  request: TkPromptEngineRequest,
) {
  const normalizedStructure = normalizeTkPromptCandidateStructure({
    candidate,
    strategy,
    factPack,
    durationSeconds: request.durationSeconds,
    spokenLanguage: request.spokenLanguage,
    imageCount: request.imageAssetIds.length,
  });
  const normalizedCandidate = normalizeTkPromptCandidateCameraMovements({
    candidate: normalizedStructure,
    durationSeconds: request.durationSeconds,
  });
  const normalizedBeatInformation = normalizeTkPromptCandidateBeatInformation({
    candidate: normalizedCandidate,
    durationSeconds: request.durationSeconds,
  });
  const normalizedFreeText = normalizeTkPromptCandidateFreeText({
    candidate: normalizedBeatInformation,
    factPack,
    strategy,
    durationSeconds: request.durationSeconds,
    spokenLanguage: request.spokenLanguage,
  });
  const parsed = validateTkPromptOptionCandidate({
    candidate: normalizedFreeText,
    strategy,
    factPack,
    durationSeconds: request.durationSeconds,
    spokenLanguage: request.spokenLanguage,
    imageAssetIds: request.imageAssetIds,
  });
  return parsed;
}

function buildPlan(
  candidate: ReturnType<typeof validateCandidate>,
  strategy: TkPromptStrategy,
  factPack: TkPromptFactPack,
  request: TkPromptEngineRequest,
): TkPromptOption {
  const executionPrompt = renderTkPromptExecutionPrompt({
    candidate,
    strategy,
    factPack,
    durationSeconds: request.durationSeconds,
    spokenLanguage: request.spokenLanguage,
    imageAssetIds: request.imageAssetIds,
  });
  const compiledBeats = compileTkPromptCandidateBeats({
    candidate,
    strategy,
    factPack,
    durationSeconds: request.durationSeconds,
  });
  return tkPromptOptionSchema.parse({
    schemaVersion: 1,
    title: candidate.title,
    whyItFits: candidate.whyItFits,
    audioMode: request.durationSeconds === 5 ? 'sound-design-only' : 'voiceover',
    executionPrompt,
    beats: compiledBeats,
    factsUsed: [...new Set(compiledBeats.flatMap(beat => beat.factIds))],
    assumptions: candidate.assumptions,
    requiredMaterials: candidate.requiredMaterials,
    warnings: candidate.warnings,
  });
}

async function requireOwnedTkPromptImages(
  client: DbClient,
  userId: string,
  imageAssetIds: string[],
) {
  const assets = await readOwnedAssetReferencesByIds(client, userId, imageAssetIds);
  if (
    assets.size !== imageAssetIds.length
    || imageAssetIds.some(assetId => assets.get(assetId)?.type !== 'image')
  ) {
    throw Object.assign(new Error('参考图不存在、不属于当前账号或不是图片'), {
      statusCode: 400,
      code: 'TK_PROMPT_IMAGE_REFERENCE_INVALID',
      exposeMessage: true,
    });
  }
  return imageAssetIds.map(assetId => assets.get(assetId)!);
}

async function readTkPromptImageMimeTypes(
  userId: string,
  assets: OwnedAssetReferenceRow[],
) {
  const result = await pool.query<{ asset_id: string; content_type: string }>(
    `SELECT session.asset_id, session.content_type
     FROM upload_sessions session
     JOIN assets asset
       ON asset.id = session.asset_id
      AND asset.user_id = session.user_id
      AND asset.object_key = session.final_object_key
     WHERE session.user_id = $1
       AND session.asset_id = ANY($2::uuid[])
       AND session.status = 'completed'
       AND session.processing_stage = 'completed'
       AND session.asset_type = 'image'
       AND asset.thumbnail_status = 'ready'
       AND asset.thumbnail_key IS NOT NULL
       AND asset.deletion_status = 'active'`,
    [userId, assets.map(asset => asset.id)],
  );
  return new Map(result.rows.map(row => [row.asset_id, row.content_type] as const));
}

function parseEvidenceFlags(value: unknown): TkPromptEvidenceFlags {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    beforeAfter: source.beforeAfter === true,
    competitor: source.competitor === true,
    numeric: source.numeric === true,
    realComment: source.realComment === true,
    popularity: source.popularity === true,
    honestExperience: source.honestExperience === true,
    sealedPackage: source.sealedPackage === true,
  };
}

export function tkPromptImageMimeType(input: {
  objectKey: string;
  uploadContentType?: string;
}): TkPromptImageInput['mimeType'] {
  if (input.uploadContentType !== undefined) {
    const trustedUploadMime = input.uploadContentType.trim().toLowerCase();
    if (trustedUploadMime === 'image/jpeg'
      || trustedUploadMime === 'image/png'
      || trustedUploadMime === 'image/webp') {
      return trustedUploadMime;
    }
    throw tkPromptImageMimeError();
  }
  const normalizedObjectKey = input.objectKey.toLowerCase().split('?')[0] ?? '';
  if (normalizedObjectKey.endsWith('.png')) return 'image/png';
  if (normalizedObjectKey.endsWith('.webp')) return 'image/webp';
  if (normalizedObjectKey.endsWith('.jpg') || normalizedObjectKey.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  throw tkPromptImageMimeError();
}

function tkPromptImageMimeError() {
  return Object.assign(new Error('参考图缺少可信 JPEG、PNG 或 WebP 类型记录'), {
    statusCode: 400,
    code: 'TK_PROMPT_IMAGE_MIME_INVALID',
    exposeMessage: true,
  });
}

function validationIssues(error: unknown) {
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
    return error.issues.slice(0, 20).map(issue => JSON.stringify(issue).slice(0, 500));
  }
  if (error instanceof Error) return [error.message.slice(0, 500)];
  return ['单方案未通过本地协议校验'];
}

function now(runtime: TkPromptEngineRuntime) {
  return (runtime.now ?? Date.now)();
}

function staleBefore(runtime: TkPromptEngineRuntime) {
  return new Date(now(runtime) - TK_PROMPT_STALE_CLAIM_AFTER_MS);
}

function failureReason(error: unknown) {
  const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? String((error as { code: string }).code)
    : 'TK_PROMPT_TASK_FAILED';
  const message = error instanceof Error ? error.message : '未知错误';
  return `${code}: ${message}`.slice(0, 1_000);
}

function unavailableError(message: string) {
  return Object.assign(new Error(message), {
    statusCode: 503,
    code: 'TK_PROMPT_ENGINE_UNAVAILABLE',
    exposeMessage: true,
  });
}
