import { pool, withTransaction, type DbClient } from '../db/pool.js';
import {
  calculatePromptWizardCostCny,
  safePromptWizardProviderAttemptTerminal,
  selectPromptWizardPricingRule,
  type PromptWizardPricingRule,
  type PromptWizardProviderAttemptTerminal,
} from './promptWizardCostLedger.js';
import {
  createTkPromptEngineRepository,
  tkPromptProviderRequestKey,
} from './tkPromptEngineRepository.js';

export interface TkPromptCostOwner {
  runId: string;
  generationId: string | null;
  optionId: string | null;
  userId: string;
  claimToken: string;
  stage: 'analysis' | 'strategy' | 'option';
  action: 'analyze-facts' | 'plan-strategies' | 'generate-option' | 'repair-option';
  jobAttempt: number;
  repairRound: 0 | 1;
}

export interface TkPromptProviderAttemptInput {
  owner: TkPromptCostOwner;
  transportAttempt: number;
  model: string;
  serviceTier: string;
}

export interface TkPromptProviderRequestRecorder {
  beginAttempt(input: TkPromptProviderAttemptInput): Promise<string>;
  completeAttempt(attemptId: string, terminal: PromptWizardProviderAttemptTerminal): Promise<void>;
}

export function createTkPromptProviderRequestRecorder(
  client: DbClient = pool,
): TkPromptProviderRequestRecorder {
  const repository = createTkPromptEngineRepository({
    reader: client,
    transaction: client === pool
      ? withTransaction
      : callback => callback(client),
  });
  return {
    async beginAttempt(input) {
      assertOwner(input.owner);
      const requestKey = tkPromptProviderRequestKey({
        ...input.owner,
        transportAttempt: input.transportAttempt,
      });
      return repository.beginProviderRequest({
        requestKey,
        runId: input.owner.runId,
        generationId: input.owner.generationId,
        optionId: input.owner.optionId,
        userId: input.owner.userId,
        stage: input.owner.stage,
        action: input.owner.action,
        jobAttempt: input.owner.jobAttempt,
        claimToken: input.owner.claimToken,
        repairRound: input.owner.repairRound,
        transportAttempt: input.transportAttempt,
        provider: 'volcengine-ark',
        model: input.model,
        serviceTier: input.serviceTier,
      });
    },

    async completeAttempt(attemptId, terminal) {
      const existing = await client.query<{
        id: string;
        request_status: string;
        service_tier: string;
        started_at: Date | string;
      }>(
        `SELECT id, request_status, service_tier, started_at
         FROM tk_prompt_provider_requests
         WHERE id = $1`,
        [attemptId],
      );
      const attempt = existing.rows[0];
      if (!attempt) throw new Error('TK Prompt Engine Provider 账本记录不存在');
      if (attempt.request_status !== 'started') return;
      const serviceTier = terminal.serviceTier ?? attempt.service_tier;
      const usage = terminal.usage;
      const usageComplete = Number.isSafeInteger(usage.inputTokens)
        && Number(usage.inputTokens) >= 0
        && Number.isSafeInteger(usage.cachedInputTokens)
        && Number(usage.cachedInputTokens) >= 0
        && Number(usage.cachedInputTokens) <= Number(usage.inputTokens)
        && Number.isSafeInteger(usage.outputTokens)
        && Number(usage.outputTokens) >= 0;
      const rules = usageComplete
        ? await client.query<PromptWizardPricingRule>(
            `SELECT rule.*
             FROM tk_prompt_provider_requests request
             JOIN prompt_wizard_model_pricing_rules rule
               ON rule.provider = request.provider
              AND rule.model = request.model
              AND rule.service_tier = $2
              AND rule.effective_from <= request.started_at
              AND (rule.effective_to IS NULL OR request.started_at < rule.effective_to)
             WHERE request.id = $1
             ORDER BY rule.min_input_tokens ASC`,
            [attemptId, serviceTier],
          )
        : { rows: [] as PromptWizardPricingRule[] };
      const rule = usageComplete
        ? selectPromptWizardPricingRule(rules.rows, usage.inputTokens, attempt.started_at)
        : null;
      const costCny = rule && usageComplete
        ? calculatePromptWizardCostCny({ usage, pricingRule: rule })
        : null;
      const known = rule !== null && costCny !== null;
      await repository.completeProviderRequest(attemptId, known && rule ? {
        status: terminal.status,
        providerRequestId: terminal.providerRequestId,
        providerResponseId: terminal.providerResponseId,
        xTtLogId: terminal.xTtLogId,
        httpStatus: terminal.httpStatus,
        errorCode: terminal.errorCode,
        errorClassification: terminal.errorClassification,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        costStatus: 'known',
        pricingRuleId: rule.id,
        priceVersion: rule.price_version,
        pricingTier: rule.pricing_tier,
        inputPricePerMillionCny: rule.input_price_per_million_cny,
        cachedInputPricePerMillionCny: rule.cached_input_price_per_million_cny,
        outputPricePerMillionCny: rule.output_price_per_million_cny,
        costCny,
      } : {
        status: terminal.status,
        providerRequestId: terminal.providerRequestId,
        providerResponseId: terminal.providerResponseId,
        xTtLogId: terminal.xTtLogId,
        httpStatus: terminal.httpStatus,
        errorCode: terminal.errorCode,
        errorClassification: terminal.errorClassification,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        costStatus: 'unknown',
      });
    },
  };
}

export const tkPromptProviderRequestRecorder = createTkPromptProviderRequestRecorder();

export { safePromptWizardProviderAttemptTerminal as safeTkPromptProviderAttemptTerminal };

function assertOwner(owner: TkPromptCostOwner) {
  const correctShape = owner.stage === 'analysis'
    ? owner.generationId === null && owner.optionId === null && owner.action === 'analyze-facts'
    : owner.stage === 'strategy'
      ? owner.generationId !== null && owner.optionId === null && owner.action === 'plan-strategies'
      : owner.generationId !== null
        && owner.optionId !== null
        && (owner.action === 'generate-option' || owner.action === 'repair-option');
  if (
    !correctShape
    || !Number.isSafeInteger(owner.jobAttempt)
    || owner.jobAttempt < 1
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(owner.claimToken)
    || (owner.repairRound !== 0 && owner.repairRound !== 1)
    || (owner.action === 'repair-option') !== (owner.repairRound === 1)
  ) {
    throw Object.assign(new Error('TK Prompt Engine Provider 账本上下文无效'), {
      code: 'TK_PROMPT_PROVIDER_LEDGER_CONTEXT_INVALID',
      retryable: false,
    });
  }
}
