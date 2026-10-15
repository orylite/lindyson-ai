import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const PRODUCT_FAMILIES = [
  'apparel-accessories',
  'beauty-personal-care',
  'consumer-electronics',
  'home-living',
  'general',
] as const;

const DIRECTIONS = [
  'ugc',
  'problem-solution',
  'unboxing-review',
  'feature-test',
  'pain-comparison',
  'lifestyle',
  'cinematic-brand',
  'asmr-detail',
] as const;

const REQUIRED_LANGUAGES = ['英语', '西班牙语', '普通话'] as const;
const REQUIRED_DURATIONS = [5, 10, 15] as const;
const MIN_CASE_COUNT = 80;
const MIN_V3_WIN_RATE = 0.65;

const opaqueReferenceSchema = z.string().trim().min(1).max(500)
  .refine(value => !/[\r\n]/u.test(value), '引用不得包含换行');

export const promptWizardV3BlindCaseSchema = z.object({
  id: z.string().trim().min(1).max(120),
  /** 只能填写脱敏 SKU 哈希或内部盲测编号，不能放商品文案。 */
  productRef: opaqueReferenceSchema,
  productFamily: z.enum(PRODUCT_FAMILIES),
  direction: z.enum(DIRECTIONS),
  durationSeconds: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  targetLanguage: z.string().trim().min(1).max(40),
  imageCount: z.number().int().min(1).max(9),
  /** V2/V3 产物存放在受控评测系统中；仓库只读取不可反查正文的引用。 */
  v2ArtifactRef: opaqueReferenceSchema,
  v3ArtifactRef: opaqueReferenceSchema,
}).strict();

export const promptWizardV3BlindDatasetSchema = z.object({
  version: z.literal(1),
  blinded: z.literal(true),
  cases: z.array(promptWizardV3BlindCaseSchema).min(MIN_CASE_COUNT).max(1_000),
}).strict().superRefine((dataset, context) => {
  const ids = dataset.cases.map(item => item.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['cases'], message: '盲测案例 id 必须唯一' });
  }
  assertCoverage('productFamily', PRODUCT_FAMILIES);
  assertCoverage('direction', DIRECTIONS);
  assertCoverage('durationSeconds', REQUIRED_DURATIONS);
  assertCoverage('targetLanguage', REQUIRED_LANGUAGES);

  function assertCoverage<
    Field extends 'productFamily' | 'direction' | 'durationSeconds' | 'targetLanguage',
  >(field: Field, expected: readonly (typeof dataset.cases[number][Field])[]) {
    const actual = new Set(dataset.cases.map(item => item[field]));
    const missing = expected.filter(value => !actual.has(value));
    if (missing.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cases'],
        message: `${field} 缺少覆盖：${missing.join('、')}`,
      });
    }
  }
});

export const promptWizardV3BlindRatingSchema = z.object({
  caseId: z.string().trim().min(1).max(120),
  /** 使用不可逆专家编号，禁止写姓名、邮箱或账号。 */
  evaluatorRef: opaqueReferenceSchema,
  preferred: z.enum(['v2', 'v3', 'tie']),
  productionReady: z.object({
    v2: z.boolean(),
    v3: z.boolean(),
  }).strict(),
}).strict();

export const promptWizardV3BlindCaseOutcomeSchema = z.object({
  caseId: z.string().trim().min(1).max(120),
  traceablePurchaseReason: z.boolean(),
  timelinePassed: z.boolean(),
  voiceoverDurationPassed: z.boolean(),
  assetReferencePassed: z.boolean(),
  actionBudgetPassed: z.boolean(),
  unconfirmedClaimCount: z.number().int().min(0),
  providerCompleted: z.boolean(),
  videoGenerationSucceeded: z.boolean(),
  contentAuditPassed: z.boolean(),
}).strict();

export const promptWizardV3BlindRatingsSchema = z.object({
  version: z.literal(1),
  ratings: z.array(promptWizardV3BlindRatingSchema).min(MIN_CASE_COUNT),
  caseOutcomes: z.array(promptWizardV3BlindCaseOutcomeSchema).min(MIN_CASE_COUNT).max(1_000),
  baselineRates: z.object({
    baselineVideoGenerationSuccessRate: z.number().min(0).max(1),
    baselineContentAuditPassRate: z.number().min(0).max(1),
  }).strict(),
}).strict();

export interface PromptWizardV3BlindEvaluation {
  caseCount: number;
  ratedCaseCount: number;
  ratingCount: number;
  v2Wins: number;
  v3Wins: number;
  ties: number;
  v3WinRate: number;
  v2ProductionReadyRate: number;
  v3ProductionReadyRate: number;
  traceablePurchaseReasonRate: number;
  timelinePassRate: number;
  voiceoverDurationPassRate: number;
  assetReferencePassRate: number;
  actionBudgetPassRate: number;
  unconfirmedClaimCount: number;
  providerCompletionRate: number;
  videoGenerationSuccessRate: number;
  contentAuditPassRate: number;
  failedGates: string[];
  passed: boolean;
}

/**
 * 发布门禁只计算盲评结果，不读取或输出商品、图片、提示词正文。
 * 胜率分母排除平局；每个案例至少需要一位专家完成盲评。
 */
export function evaluatePromptWizardV3BlindSet(input: {
  dataset: unknown;
  ratings: unknown;
}): PromptWizardV3BlindEvaluation {
  const dataset = promptWizardV3BlindDatasetSchema.parse(input.dataset);
  const ratings = promptWizardV3BlindRatingsSchema.parse(input.ratings);
  const caseIds = new Set(dataset.cases.map(item => item.id));
  const ratingKeys = new Set<string>();
  const ratedCaseIds = new Set<string>();
  const outcomeCaseIds = new Set<string>();

  for (const [index, rating] of ratings.ratings.entries()) {
    if (!caseIds.has(rating.caseId)) {
      throw new Error(`盲评结果引用了不存在的案例：ratings.${index}.caseId`);
    }
    const key = `${rating.caseId}:${rating.evaluatorRef}`;
    if (ratingKeys.has(key)) {
      throw new Error(`同一专家不得重复评价同一案例：ratings.${index}`);
    }
    ratingKeys.add(key);
    ratedCaseIds.add(rating.caseId);
  }
  const missingCaseCount = dataset.cases.length - ratedCaseIds.size;
  if (missingCaseCount > 0) {
    throw new Error(`仍有 ${missingCaseCount} 个真实商品案例没有专家盲评`);
  }
  for (const [index, outcome] of ratings.caseOutcomes.entries()) {
    if (!caseIds.has(outcome.caseId)) {
      throw new Error(`质量结果引用了不存在的案例：caseOutcomes.${index}.caseId`);
    }
    if (outcomeCaseIds.has(outcome.caseId)) {
      throw new Error(`同一案例只能有一份质量结果：caseOutcomes.${index}`);
    }
    outcomeCaseIds.add(outcome.caseId);
  }
  const missingOutcomeCount = dataset.cases.length - outcomeCaseIds.size;
  if (missingOutcomeCount > 0) {
    throw new Error(`仍有 ${missingOutcomeCount} 个真实商品案例没有质量结果`);
  }

  const v2Wins = ratings.ratings.filter(item => item.preferred === 'v2').length;
  const v3Wins = ratings.ratings.filter(item => item.preferred === 'v3').length;
  const ties = ratings.ratings.filter(item => item.preferred === 'tie').length;
  const decisive = v2Wins + v3Wins;
  if (decisive === 0) throw new Error('全部盲评均为平局，无法计算 3.0 专家胜率');
  const v3WinRate = v3Wins / decisive;
  const v2ProductionReadyRate = ratings.ratings.filter(item => item.productionReady.v2).length
    / ratings.ratings.length;
  const v3ProductionReadyRate = ratings.ratings.filter(item => item.productionReady.v3).length
    / ratings.ratings.length;
  const outcomeCount = ratings.caseOutcomes.length;
  const rate = (field: keyof Pick<
    z.infer<typeof promptWizardV3BlindCaseOutcomeSchema>,
    | 'traceablePurchaseReason'
    | 'timelinePassed'
    | 'voiceoverDurationPassed'
    | 'assetReferencePassed'
    | 'actionBudgetPassed'
    | 'providerCompleted'
    | 'videoGenerationSucceeded'
    | 'contentAuditPassed'
  >) => ratings.caseOutcomes.filter(item => item[field]).length / outcomeCount;
  const traceablePurchaseReasonRate = rate('traceablePurchaseReason');
  const timelinePassRate = rate('timelinePassed');
  const voiceoverDurationPassRate = rate('voiceoverDurationPassed');
  const assetReferencePassRate = rate('assetReferencePassed');
  const actionBudgetPassRate = rate('actionBudgetPassed');
  const unconfirmedClaimCount = ratings.caseOutcomes.reduce(
    (total, item) => total + item.unconfirmedClaimCount,
    0,
  );
  const providerCompletionRate = rate('providerCompleted');
  const videoGenerationSuccessRate = rate('videoGenerationSucceeded');
  const contentAuditPassRate = rate('contentAuditPassed');
  const failedGates = [
    v3WinRate < MIN_V3_WIN_RATE ? '专家盲选胜率低于 65%' : null,
    traceablePurchaseReasonRate !== 1 ? '购买理由追溯率未达到 100%' : null,
    timelinePassRate !== 1 ? '时间轴通过率未达到 100%' : null,
    voiceoverDurationPassRate !== 1 ? '口播时长通过率未达到 100%' : null,
    assetReferencePassRate !== 1 ? '素材引用通过率未达到 100%' : null,
    actionBudgetPassRate !== 1 ? '动作预算通过率未达到 100%' : null,
    unconfirmedClaimCount !== 0 ? '仍存在未经确认的商业宣称' : null,
    providerCompletionRate < 0.95 ? 'Provider 批次完成率低于 95%' : null,
    videoGenerationSuccessRate < ratings.baselineRates.baselineVideoGenerationSuccessRate
      ? '视频生成成功率低于 2.0 基线'
      : null,
    contentAuditPassRate < ratings.baselineRates.baselineContentAuditPassRate
      ? '内容审核通过率低于 2.0 基线'
      : null,
  ].filter((value): value is string => value !== null);

  return {
    caseCount: dataset.cases.length,
    ratedCaseCount: ratedCaseIds.size,
    ratingCount: ratings.ratings.length,
    v2Wins,
    v3Wins,
    ties,
    v3WinRate,
    v2ProductionReadyRate,
    v3ProductionReadyRate,
    traceablePurchaseReasonRate,
    timelinePassRate,
    voiceoverDurationPassRate,
    assetReferencePassRate,
    actionBudgetPassRate,
    unconfirmedClaimCount,
    providerCompletionRate,
    videoGenerationSuccessRate,
    contentAuditPassRate,
    failedGates,
    passed: failedGates.length === 0,
  };
}

async function main() {
  const datasetPath = process.argv[2];
  const ratingsPath = process.argv[3];
  if (!datasetPath || !ratingsPath) {
    throw new Error(
      '用法：npm run eval:prompt-wizard-v3 -- /绝对路径/盲测集.json /绝对路径/盲评结果.json',
    );
  }
  const [datasetText, ratingsText] = await Promise.all([
    readFile(resolve(datasetPath), 'utf8'),
    readFile(resolve(ratingsPath), 'utf8'),
  ]);
  const result = evaluatePromptWizardV3BlindSet({
    dataset: JSON.parse(datasetText) as unknown,
    ratings: JSON.parse(ratingsText) as unknown,
  });
  process.stdout.write(`${JSON.stringify({ event: 'prompt-wizard-v3-blind-evaluation', ...result })}\n`);
  if (!result.passed) {
    throw new Error(`3.0 发布门禁未通过：${result.failedGates.join('；')}`);
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      event: 'prompt-wizard-v3-blind-evaluation',
      ok: false,
      message: error instanceof Error ? error.message : '盲测门禁失败',
    })}\n`);
    process.exitCode = 1;
  });
}
