import type { DbClient } from '../db/pool.js';
import { pool } from '../db/pool.js';
import {
  isPromptWizardLegacyPlanIndex,
  isPromptWizardPlanIndex,
} from './promptWizardPlanCount.js';

export const PROMPT_WIZARD_PROVIDER_NAME = 'volcengine-ark' as const;

export type PromptWizardProviderOperation =
  | 'analyze-product'
  | 'repair-product-chinese'
  | 'repair-product-profile'
  | 'repair-product-format'
  | 'generate-concepts'
  | 'repair-concept-set'
  | 'generate-use-directions'
  | 'repair-use-directions'
  | 'generate-drafts'
  | 'repair-draft-format'
  | 'repair-draft-content'
  | 'refine-plan';

export interface PromptWizardCostOwner {
  runId: string;
  batchId: string | null;
  /**
   * 方案交付版本只影响逐方案请求允许使用的索引范围。
   *
   * 旧 worker 与历史测试未携带该字段，因此缺省必须继续按 V4/V5 的
   * 0、1 处理；只有 V6 生产批次显式写入 6 时才允许第三个索引 2。
   */
  deliveryVersion?: 4 | 5 | 6;
  /** 使用方向规划按集合而不是 run 建立幂等成本作用域，允许同一 run 合法重新规划。 */
  useDirectionSetId?: string | null;
  userId: string;
  jobAttempt: number;
  repairRound: number;
}

export interface PromptWizardProviderAttemptInput {
  owner: PromptWizardCostOwner;
  operation: PromptWizardProviderOperation;
  planIndex: number | null;
  transportAttempt: number;
  model: string;
  serviceTier: string;
}

export interface PromptWizardProviderAttemptUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}

export interface PromptWizardProviderAttemptTerminal {
  status: 'succeeded' | 'failed';
  serviceTier: string | null;
  providerRequestId: string | null;
  providerResponseId: string | null;
  xTtLogId: string | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorClassification: string | null;
  usage: PromptWizardProviderAttemptUsage;
}

export interface PromptWizardPricingRule {
  id: string;
  provider: string;
  model: string;
  service_tier: string;
  price_version: string;
  pricing_tier: string;
  min_input_tokens: number | string;
  max_input_tokens: number | string;
  input_price_per_million_cny: number | string;
  cached_input_price_per_million_cny: number | string;
  output_price_per_million_cny: number | string;
  effective_from: Date | string;
  effective_to: Date | string | null;
}

interface PromptWizardProviderRequestRow {
  id: string;
  request_status: 'started' | 'succeeded' | 'failed';
  service_tier: string;
  started_at: Date | string;
}

export interface PromptWizardProviderRequestRecorder {
  beginAttempt(input: PromptWizardProviderAttemptInput): Promise<string>;
  completeAttempt(attemptId: string, terminal: PromptWizardProviderAttemptTerminal): Promise<void>;
}

export function createPromptWizardProviderRequestRecorder(
  client: DbClient = pool,
): PromptWizardProviderRequestRecorder {
  return {
    async beginAttempt(input) {
      assertPromptWizardProviderAttemptInput(input);
      const requestKey = promptWizardProviderRequestKey(input);
      const result = await client.query<{ id: string }>(
        `INSERT INTO prompt_wizard_provider_requests (
           request_key, run_id, batch_id, use_direction_set_id, user_id, operation,
           job_attempt, repair_round, plan_index, transport_attempt,
           provider, model, service_tier
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (request_key) DO NOTHING
         RETURNING id`,
        [
          requestKey,
          input.owner.runId,
          input.owner.batchId,
          input.owner.useDirectionSetId ?? null,
          input.owner.userId,
          input.operation,
          input.owner.jobAttempt,
          input.owner.repairRound,
          input.planIndex,
          input.transportAttempt,
          PROMPT_WIZARD_PROVIDER_NAME,
          input.model,
          normalizeServiceTier(input.serviceTier) ?? input.serviceTier,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) {
        throw Object.assign(new Error('提示词 Provider 请求账本键已存在，拒绝重复付费调用'), {
          code: 'PROMPT_WIZARD_PROVIDER_LEDGER_REPLAY',
          retryable: false,
        });
      }
      return id;
    },

    async completeAttempt(attemptId, terminal) {
      const existing = await client.query<PromptWizardProviderRequestRow>(
        `SELECT id, request_status, service_tier, started_at
         FROM prompt_wizard_provider_requests
         WHERE id = $1`,
        [attemptId],
      );
      const attempt = existing.rows[0];
      if (!attempt) {
        throw Object.assign(new Error('提示词 Provider 请求账本记录不存在'), {
          code: 'PROMPT_WIZARD_PROVIDER_LEDGER_MISSING',
          retryable: false,
        });
      }
      // 终态更新允许安全重放，但绝不覆盖第一次记录的 Token 与价格快照。
      if (attempt.request_status !== 'started') return;

      const usage = normalizePromptWizardAttemptUsage(terminal.usage);
      // Responses 终态并不保证回显 service_tier；缺失时必须使用请求已明确
      // 发送并在 begin 阶段落账的档位，不能把完整 usage 误判为未知成本。
      const serviceTier = normalizeServiceTier(terminal.serviceTier)
        ?? normalizeServiceTier(attempt.service_tier);
      const pricingRules = usageComplete(usage) && serviceTier
        ? await readPromptWizardPricingRules(client, attemptId, serviceTier)
        : [];
      const pricingRule = usageComplete(usage)
        ? selectPromptWizardPricingRule(pricingRules, usage.inputTokens, attempt.started_at)
        : null;
      const costCny = pricingRule && usageComplete(usage)
        ? calculatePromptWizardCostCny({ usage, pricingRule })
        : null;
      const costKnown = pricingRule !== null && costCny !== null;

      await client.query(
        `UPDATE prompt_wizard_provider_requests
         SET request_status = $2,
             service_tier = COALESCE($3, service_tier),
             provider_request_id = $4,
             provider_response_id = $5,
             x_tt_log_id = $6,
             http_status = $7,
             error_code = $8,
             error_classification = $9,
             input_tokens = $10,
             cached_input_tokens = $11,
             output_tokens = $12,
             pricing_rule_id = $13,
             price_version = $14,
             pricing_tier = $15,
             input_price_per_million_cny = $16,
             cached_input_price_per_million_cny = $17,
             output_price_per_million_cny = $18,
             cost_cny = $19,
             cost_status = $20,
             completed_at = now()
         WHERE id = $1 AND request_status = 'started'`,
        [
          attemptId,
          terminal.status,
          serviceTier,
          safeProviderIdentifier(terminal.providerRequestId),
          safeProviderIdentifier(terminal.providerResponseId),
          safeProviderIdentifier(terminal.xTtLogId),
          safeHttpStatus(terminal.httpStatus),
          safeClassification(terminal.errorCode),
          safeClassification(terminal.errorClassification),
          usage.inputTokens,
          usage.cachedInputTokens,
          usage.outputTokens,
          pricingRule?.id ?? null,
          pricingRule?.price_version ?? null,
          pricingRule?.pricing_tier ?? null,
          pricingRule?.input_price_per_million_cny ?? null,
          pricingRule?.cached_input_price_per_million_cny ?? null,
          pricingRule?.output_price_per_million_cny ?? null,
          costCny,
          costKnown ? 'known' : 'unknown',
        ],
      );
    },
  };
}

export const promptWizardProviderRequestRecorder = createPromptWizardProviderRequestRecorder();

export function promptWizardProviderRequestKey(input: PromptWizardProviderAttemptInput) {
  const isUseDirectionOperation = input.operation === 'generate-use-directions'
    || input.operation === 'repair-use-directions';
  const scope = isUseDirectionOperation
    ? `use-direction-set:${input.owner.useDirectionSetId}`
    : input.owner.batchId
      ? `batch:${input.owner.batchId}`
      : `run:${input.owner.runId}`;
  const plan = input.planIndex === null ? 'none' : String(input.planIndex);
  return [
    scope,
    `job:${input.owner.jobAttempt}`,
    `operation:${input.operation}`,
    `repair:${input.owner.repairRound}`,
    `plan:${plan}`,
    `transport:${input.transportAttempt}`,
  ].join(':');
}

export function selectPromptWizardPricingRule(
  rules: PromptWizardPricingRule[],
  inputTokens: number | null,
  at: Date | string,
) {
  if (inputTokens === null || !isSafeTokenCount(inputTokens)) return null;
  const atMs = new Date(at).getTime();
  if (!Number.isFinite(atMs)) return null;
  const matched = rules.filter(rule => {
    const effectiveFrom = new Date(rule.effective_from).getTime();
    const effectiveTo = rule.effective_to === null
      ? Number.POSITIVE_INFINITY
      : new Date(rule.effective_to).getTime();
    return inputTokens >= Number(rule.min_input_tokens)
      && inputTokens <= Number(rule.max_input_tokens)
      && atMs >= effectiveFrom
      && atMs < effectiveTo;
  });
  // 版本窗口重叠同样属于定价证据不足；宁可保持未知，也不能任意选一条。
  return matched.length === 1 ? matched[0]! : null;
}

export function calculatePromptWizardCostCny(input: {
  usage: PromptWizardProviderAttemptUsage;
  pricingRule: Pick<
    PromptWizardPricingRule,
    | 'input_price_per_million_cny'
    | 'cached_input_price_per_million_cny'
    | 'output_price_per_million_cny'
  >;
}) {
  const usage = normalizePromptWizardAttemptUsage(input.usage);
  if (!usageComplete(usage)) return null;
  const inputPrice = parsePricePerMillionFixed6(
    input.pricingRule.input_price_per_million_cny,
  );
  const cachedPrice = parsePricePerMillionFixed6(
    input.pricingRule.cached_input_price_per_million_cny,
  );
  const outputPrice = parsePricePerMillionFixed6(
    input.pricingRule.output_price_per_million_cny,
  );
  if (inputPrice === null || cachedPrice === null || outputPrice === null) return null;

  const uncachedInputTokens = BigInt(usage.inputTokens - usage.cachedInputTokens);
  const cachedInputTokens = BigInt(usage.cachedInputTokens);
  const outputTokens = BigInt(usage.outputTokens);
  // 价格先精确缩放为 10^-6 元/百万 Token。成本换算到微元时，分母同样
  // 是一百万；全程 BigInt，三项汇总后再按 half-up 一次性舍入到微元。
  const fixed6Denominator = 1_000_000n;
  const numerator = uncachedInputTokens * inputPrice
    + cachedInputTokens * cachedPrice
    + outputTokens * outputPrice;
  const microCny = (numerator + fixed6Denominator / 2n) / fixed6Denominator;
  return formatFixed6Cny(microCny);
}

export function safePromptWizardProviderAttemptTerminal(
  status: PromptWizardProviderAttemptTerminal['status'],
  value: unknown,
): PromptWizardProviderAttemptTerminal {
  const metadata = safeProviderMetadata(value);
  return {
    status,
    serviceTier: metadata.serviceTier,
    providerRequestId: metadata.providerRequestId,
    providerResponseId: metadata.providerResponseId,
    xTtLogId: metadata.xTtLogId,
    httpStatus: metadata.httpStatus,
    errorCode: status === 'failed' ? metadata.errorCode : null,
    errorClassification: status === 'failed' ? metadata.errorClassification : null,
    usage: metadata.usage,
  };
}

async function readPromptWizardPricingRules(
  client: DbClient,
  attemptId: string,
  serviceTier: string,
) {
  const result = await client.query<PromptWizardPricingRule>(
    `SELECT rule.*
     FROM prompt_wizard_provider_requests request
     JOIN prompt_wizard_model_pricing_rules rule
       ON rule.provider = request.provider
      AND rule.model = request.model
      AND rule.service_tier = $2
      AND rule.effective_from <= request.started_at
      AND (rule.effective_to IS NULL OR request.started_at < rule.effective_to)
     WHERE request.id = $1
     ORDER BY rule.min_input_tokens ASC`,
    [attemptId, serviceTier],
  );
  return result.rows;
}

function assertPromptWizardProviderAttemptInput(input: PromptWizardProviderAttemptInput) {
  const isPlanOperation = input.operation === 'generate-drafts'
    || input.operation === 'repair-draft-format'
    || input.operation === 'repair-draft-content'
    || input.operation === 'refine-plan';
  const isUseDirectionOperation = input.operation === 'generate-use-directions'
    || input.operation === 'repair-use-directions';
  const useDirectionSetId = input.owner.useDirectionSetId ?? null;
  const deliveryVersion = input.owner.deliveryVersion;
  const maxRepairRound = (
    deliveryVersion === 6
    && input.operation === 'repair-draft-content'
  ) ? 3 : 2;
  const hasValidDeliveryVersion = deliveryVersion === undefined
    || deliveryVersion === 4
    || deliveryVersion === 5
    || deliveryVersion === 6;
  const hasValidPlanIndex = input.planIndex !== null && (
    deliveryVersion === 6
      ? isPromptWizardPlanIndex(input.planIndex)
      : isPromptWizardLegacyPlanIndex(input.planIndex)
  );
  if (
    !input.owner.runId
    || !input.owner.userId
    || !hasValidDeliveryVersion
    || !Number.isSafeInteger(input.owner.jobAttempt)
    || input.owner.jobAttempt < 1
    || !Number.isSafeInteger(input.owner.repairRound)
    || input.owner.repairRound < 0
    || input.owner.repairRound > maxRepairRound
    || !Number.isSafeInteger(input.transportAttempt)
    || input.transportAttempt < 1
    || !input.model.trim()
    || !input.serviceTier.trim()
    || (isPlanOperation && !input.owner.batchId)
    || (!isPlanOperation && input.owner.batchId !== null)
    || (isUseDirectionOperation && !useDirectionSetId)
    || (!isUseDirectionOperation && useDirectionSetId !== null)
    || (isPlanOperation && !hasValidPlanIndex)
    || (!isPlanOperation && input.planIndex !== null)
  ) {
    throw Object.assign(new Error('提示词 Provider 请求账本上下文无效'), {
      code: 'PROMPT_WIZARD_PROVIDER_LEDGER_CONTEXT_INVALID',
      retryable: false,
    });
  }
}

function normalizePromptWizardAttemptUsage(
  usage: PromptWizardProviderAttemptUsage,
): PromptWizardProviderAttemptUsage {
  const inputTokens = safeTokenCount(usage.inputTokens);
  const outputTokens = safeTokenCount(usage.outputTokens);
  const cachedInputTokens = safeTokenCount(usage.cachedInputTokens);
  return {
    inputTokens,
    cachedInputTokens: inputTokens !== null
      && cachedInputTokens !== null
      && cachedInputTokens <= inputTokens
      ? cachedInputTokens
      : null,
    outputTokens,
  };
}

function usageComplete(
  usage: PromptWizardProviderAttemptUsage,
): usage is { inputTokens: number; cachedInputTokens: number; outputTokens: number } {
  return usage.inputTokens !== null
    && usage.cachedInputTokens !== null
    && usage.outputTokens !== null;
}

function safeProviderMetadata(value: unknown) {
  const metadata = {
    serviceTier: null as string | null,
    providerRequestId: null as string | null,
    providerResponseId: null as string | null,
    xTtLogId: null as string | null,
    httpStatus: null as number | null,
    errorCode: null as string | null,
    errorClassification: null as string | null,
    usage: {
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
    } as PromptWizardProviderAttemptUsage,
  };
  let current = value;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== 'object') break;
    const candidate = current as Record<string, unknown> & { cause?: unknown };
    metadata.serviceTier ??= normalizeServiceTier(candidate.service_tier ?? candidate.serviceTier);
    metadata.providerRequestId ??= safeProviderIdentifier(candidate.providerRequestId);
    metadata.providerResponseId ??= safeProviderIdentifier(
      candidate.id ?? candidate.responseId ?? candidate.interactionId,
    );
    metadata.xTtLogId ??= safeProviderIdentifier(candidate.xTtLogId);
    metadata.httpStatus ??= safeHttpStatus(
      candidate.httpStatus ?? candidate.status ?? candidate.statusCode,
    );
    metadata.errorCode ??= safeClassification(candidate.code);
    metadata.errorClassification ??= safeClassification(candidate.errorClassification);
    const usage = candidate.usage;
    if (usage && typeof usage === 'object') {
      const usageRecord = usage as Record<string, unknown>;
      metadata.usage.inputTokens ??= safeTokenCount(
        usageRecord.input_tokens ?? usageRecord.inputTokens,
      );
      metadata.usage.cachedInputTokens ??= safeTokenCount(
        usageRecord.cached_input_tokens
        ?? usageRecord.cachedInputTokens
        ?? (usageRecord.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens,
      );
      metadata.usage.outputTokens ??= safeTokenCount(
        usageRecord.output_tokens ?? usageRecord.outputTokens,
      );
    }
    current = candidate.cause;
  }
  return metadata;
}

function normalizeServiceTier(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,31}$/u.test(normalized) ? normalized : null;
}

function safeProviderIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized.length > 200) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized) ? normalized : null;
}

function safeClassification(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized.length > 200) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized) ? normalized : null;
}

function safeHttpStatus(value: unknown) {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 100
    && value <= 599
    ? value
    : null;
}

function safeTokenCount(value: unknown) {
  return isSafeTokenCount(value) ? value : null;
}

function isSafeTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parsePricePerMillionFixed6(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) return null;
  const normalized = String(value).trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/u.exec(normalized);
  if (!match) return null;
  const whole = match[1]!;
  const fraction = (match[2] ?? '').padEnd(6, '0');
  return BigInt(whole) * 1_000_000n + BigInt(fraction || '0');
}

function formatFixed6Cny(microCny: bigint) {
  const denominator = 1_000_000n;
  const whole = microCny / denominator;
  const fraction = (microCny % denominator).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}
