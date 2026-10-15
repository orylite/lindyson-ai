import type { EndpointRequestQuery } from '@lindyson/api-contracts';
import { env } from '../config/env.js';
import type { DbClient } from '../db/pool.js';
import {
  adminExactTimestampCursorCondition,
  adminExactTimestampCursorValues,
  adminExactTimestampMetadataColumns,
  adminExactTimestampOrderBy,
  createAdminExactTimestampPage,
  parseAdminExactKeysetQuery,
  type AdminExactTimestampPageMetadata,
} from './adminExactKeysetPagination.js';
import { toInt, toIsoDateTime } from './serialization.js';

type OverviewFilters = EndpointRequestQuery<'adminApiUsageMultimodalOverview'>;
type UserFilters = EndpointRequestQuery<'adminApiUsageMultimodalUsers'>;
type OperationFilters = EndpointRequestQuery<'adminApiUsageMultimodalOperations'>;
type EstimateCompleteness = 'complete' | 'partial' | 'unavailable';

interface CostSelection {
  range: 'all' | 'month' | 'date' | 'custom';
  month: string | null;
  date: string | null;
  rangeStart: string;
  rangeEnd: string;
  timezone: 'Asia/Shanghai';
  grain: 'month' | 'day' | 'bucket';
}

interface AggregateRow {
  provider: string | null;
  model_id: string | null;
  total_row: boolean;
  analysis_count: unknown;
  batch_count: unknown;
  user_count: unknown;
  settled_credits: unknown;
  refunded_credits: unknown;
  known_input_tokens: unknown;
  known_cached_input_tokens: unknown;
  known_output_tokens: unknown;
  known_cost_cny: unknown;
  provider_request_count: unknown;
  reconciled_zero_request_count: unknown;
  unknown_usage_request_count: unknown;
  unpriced_request_count: unknown;
  incomplete_operation_count: unknown;
  historical_evidence_operation_count: unknown;
  historical_priced_operation_count: unknown;
}

interface OperationalAggregateRow {
  call_count: unknown;
  unpriced_call_count: unknown;
  estimated_cost_cny: unknown;
}

interface OperationRow {
  id: string;
  operation_type: 'analysis' | 'plan-batch';
  run_id: string;
  batch_id: string | null;
  user_id: string;
  user_name: string;
  email: string;
  provider: string;
  model_id: string;
  status: string;
  is_free: boolean | null;
  settled_credits: unknown;
  refunded_credits: unknown;
  known_input_tokens: unknown;
  known_cached_input_tokens: unknown;
  known_output_tokens: unknown;
  known_cost_cny: unknown;
  provider_request_count: unknown;
  reconciled_zero_request_count: unknown;
  unknown_usage_request_count: unknown;
  unpriced_request_count: unknown;
  incomplete_request_count: unknown;
  estimate_completeness: EstimateCompleteness;
  usage_evidence:
    | 'ledger'
    | 'ledger-reconciled'
    | 'historical'
    | 'historical-aggregate-priced'
    | 'unavailable';
  price_version: string | null;
  pricing_source_url: string | null;
  failure_reason: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
}

interface UserRow {
  id: string;
  user_id: string;
  user_name: string;
  email: string;
  model_ids: string[];
  analysis_count: unknown;
  batch_count: unknown;
  settled_credits: unknown;
  refunded_credits: unknown;
  known_input_tokens: unknown;
  known_cached_input_tokens: unknown;
  known_output_tokens: unknown;
  known_cost_cny: unknown;
  provider_request_count: unknown;
  reconciled_zero_request_count: unknown;
  unknown_usage_request_count: unknown;
  unpriced_request_count: unknown;
  incomplete_operation_count: unknown;
  historical_evidence_operation_count: unknown;
  historical_priced_operation_count: unknown;
  operational_call_count: unknown;
  operational_unpriced_call_count: unknown;
  business_estimated_cost_cny: unknown;
  operational_estimated_cost_cny: unknown;
  known_account_cost_cny: unknown;
  estimate_completeness: EstimateCompleteness;
  last_activity_at: Date | string;
}

interface BalanceRow {
  available_balance_cny: unknown;
  cash_balance_cny: unknown;
  frozen_amount_cny: unknown;
  arrears_balance_cny: unknown;
  credit_limit_cny: unknown;
  currency: string | null;
  synced_at: Date | string | null;
  sync_status: string | null;
  sync_completed_at: Date | string | null;
}

interface PricingSourceRow {
  price_version: string;
  source_url: string;
}

const PROVIDER = 'volcengine-ark';
const MODEL_ID = env.ARK_PROMPT_WIZARD_MODEL;
const MODEL_LABEL = 'Doubao Seed 2.0 Lite';

/**
 * 成本 owner 的唯一口径：分析归 run，三案生成归 batch/generation。
 * source_kind 隔离旧 V6 与 TK 1.0 账本；只要 owner 存在逐请求账本，
 * 就不再读取旧 provider_* 聚合字段，避免新旧证据双算。
 */
const OPERATION_COST_CTE = `WITH operation_sources AS (
  SELECT 'v6'::text AS source_kind,
         runs.id, 'analysis'::text AS operation_type, runs.id AS run_id,
         NULL::uuid AS batch_id, runs.user_id, users.user_name, users.email::text,
         CASE WHEN runs.completed_at IS NOT NULL AND runs.completed_at > $3::timestamptz
              THEN 'analyzing' ELSE runs.status END AS status,
         (runs.completed_at IS NOT NULL AND runs.completed_at <= $3::timestamptz) AS terminal_as_of,
         NULL::boolean AS is_free, 0::bigint AS settled_credits, 0::bigint AS refunded_credits,
         runs.provider_model AS legacy_model,
         CASE WHEN runs.completed_at IS NOT NULL AND runs.completed_at <= $3::timestamptz
              THEN runs.provider_input_tokens ELSE NULL END AS legacy_input_tokens,
         CASE WHEN runs.completed_at IS NOT NULL AND runs.completed_at <= $3::timestamptz
              THEN runs.provider_output_tokens ELSE NULL END AS legacy_output_tokens,
         runs.failure_reason, runs.created_at, runs.completed_at
  FROM prompt_wizard_runs runs
  JOIN users ON users.id = runs.user_id
  WHERE runs.created_at <= $3::timestamptz
    AND (runs.created_at AT TIME ZONE 'Asia/Shanghai')::date BETWEEN $1::date AND $2::date
  UNION ALL
  SELECT 'v6'::text AS source_kind,
         batches.id, 'plan-batch'::text AS operation_type, batches.run_id,
         batches.id AS batch_id, batches.user_id, users.user_name, users.email::text,
         CASE WHEN batches.completed_at IS NOT NULL AND batches.completed_at > $3::timestamptz
              THEN 'processing' ELSE batches.status END AS status,
         (batches.completed_at IS NOT NULL AND batches.completed_at <= $3::timestamptz) AS terminal_as_of,
         batches.is_free,
         CASE WHEN batches.completed_at IS NOT NULL AND batches.completed_at <= $3::timestamptz
                    AND batches.credit_status = 'settled' THEN batches.credits ELSE 0 END::bigint,
         CASE WHEN batches.completed_at IS NOT NULL AND batches.completed_at <= $3::timestamptz
                    AND batches.credit_status = 'refunded' THEN batches.credits ELSE 0 END::bigint,
         batches.provider_model AS legacy_model,
         CASE WHEN batches.completed_at IS NOT NULL AND batches.completed_at <= $3::timestamptz
              THEN batches.provider_input_tokens ELSE NULL END AS legacy_input_tokens,
         CASE WHEN batches.completed_at IS NOT NULL AND batches.completed_at <= $3::timestamptz
              THEN batches.provider_output_tokens ELSE NULL END AS legacy_output_tokens,
         batches.failure_reason, batches.created_at, batches.completed_at
  FROM prompt_wizard_batches batches
  JOIN users ON users.id = batches.user_id
  WHERE batches.created_at <= $3::timestamptz
    AND (batches.created_at AT TIME ZONE 'Asia/Shanghai')::date BETWEEN $1::date AND $2::date
  UNION ALL
  SELECT 'tk'::text AS source_kind,
         runs.id, 'analysis'::text AS operation_type, runs.id AS run_id,
         NULL::uuid AS batch_id, runs.user_id, users.user_name, users.email::text,
         CASE WHEN runs.completed_at IS NOT NULL AND runs.completed_at > $3::timestamptz
              THEN 'analyzing' ELSE runs.status END AS status,
         (runs.completed_at IS NOT NULL AND runs.completed_at <= $3::timestamptz) AS terminal_as_of,
         NULL::boolean AS is_free, 0::bigint AS settled_credits, 0::bigint AS refunded_credits,
         NULL::text AS legacy_model, NULL::integer AS legacy_input_tokens,
         NULL::integer AS legacy_output_tokens,
         runs.failure_reason, runs.created_at, runs.completed_at
  FROM tk_prompt_runs runs
  JOIN users ON users.id = runs.user_id
  WHERE runs.created_at <= $3::timestamptz
    AND (runs.created_at AT TIME ZONE 'Asia/Shanghai')::date BETWEEN $1::date AND $2::date
  UNION ALL
  SELECT 'tk'::text AS source_kind,
         generations.id, 'plan-batch'::text AS operation_type, generations.run_id,
         generations.id AS batch_id, generations.user_id, users.user_name, users.email::text,
         CASE
           WHEN generations.completed_at IS NOT NULL AND generations.completed_at > $3::timestamptz
             THEN 'processing'
           WHEN generations.status IN ('strategizing', 'expanding') THEN 'processing'
           ELSE generations.status
         END AS status,
         (generations.completed_at IS NOT NULL AND generations.completed_at <= $3::timestamptz)
           AS terminal_as_of,
         generations.is_free,
         CASE WHEN generations.completed_at IS NOT NULL
                    AND generations.completed_at <= $3::timestamptz
                    AND generations.credit_status = 'settled'
              THEN generations.credits ELSE 0 END::bigint,
         CASE WHEN generations.completed_at IS NOT NULL
                    AND generations.completed_at <= $3::timestamptz
                    AND generations.credit_status = 'refunded'
              THEN generations.credits ELSE 0 END::bigint,
         NULL::text AS legacy_model, NULL::integer AS legacy_input_tokens,
         NULL::integer AS legacy_output_tokens,
         generations.failure_reason, generations.created_at, generations.completed_at
  FROM tk_prompt_generations generations
  JOIN users ON users.id = generations.user_id
  WHERE generations.created_at <= $3::timestamptz
    AND (generations.created_at AT TIME ZONE 'Asia/Shanghai')::date BETWEEN $1::date AND $2::date
), request_presence AS (
  SELECT requests.source_kind, requests.run_id, requests.batch_id,
         count(*)::int AS any_request_count
  FROM (
    SELECT 'v6'::text AS source_kind, requests.run_id, requests.batch_id,
           requests.created_at
    FROM prompt_wizard_provider_requests requests
    WHERE requests.created_at <= $3::timestamptz
    UNION ALL
    SELECT 'tk'::text AS source_kind, requests.run_id,
           CASE WHEN requests.stage = 'analysis' THEN NULL::uuid
                ELSE requests.generation_id END AS batch_id,
           requests.created_at
    FROM tk_prompt_provider_requests requests
    WHERE requests.created_at <= $3::timestamptz
      AND requests.completed_at IS NOT NULL
      AND requests.completed_at <= $3::timestamptz
      AND requests.request_status IN ('succeeded', 'failed')
  ) requests
  JOIN operation_sources source
    ON source.source_kind = requests.source_kind
   AND source.run_id = requests.run_id
   AND source.batch_id IS NOT DISTINCT FROM requests.batch_id
  GROUP BY requests.source_kind, requests.run_id, requests.batch_id
), historical_cost_evidence AS (
  SELECT 'v6'::text AS source_kind,
         coalesce(evidence.analysis_run_id, evidence.batch_id) AS operation_id,
         CASE WHEN evidence.analysis_run_id IS NOT NULL
              THEN 'analysis'::text ELSE 'plan-batch'::text END AS operation_type,
         evidence.provider, evidence.model AS model_id,
         evidence.input_tokens::bigint AS input_tokens,
         evidence.cached_input_tokens::bigint AS cached_input_tokens,
         evidence.output_tokens::bigint AS output_tokens,
         evidence.cost_cny::numeric(20,6) AS cost_cny,
         evidence.pricing_version AS price_version,
         evidence.pricing_source_url,
         evidence.priced_at, evidence.created_at
  FROM prompt_wizard_historical_operation_cost_evidence evidence
  WHERE evidence.priced_at <= $3::timestamptz
    AND evidence.created_at <= $3::timestamptz
    AND evidence.provider = '${PROVIDER}'
    AND evidence.model = $4::text
), request_evidence AS (
  SELECT 'v6'::text AS source_kind,
         requests.run_id, requests.batch_id, requests.provider, requests.model,
         requests.completed_at,
         CASE
           WHEN requests.completed_at IS NOT NULL AND requests.completed_at <= $3::timestamptz
             AND reconciliations.id IS NOT NULL
             THEN reconciliations.effective_input_tokens
           WHEN requests.completed_at IS NOT NULL AND requests.completed_at <= $3::timestamptz
             THEN requests.input_tokens
           ELSE NULL
         END AS effective_input_tokens,
         CASE
           WHEN requests.completed_at IS NOT NULL AND requests.completed_at <= $3::timestamptz
             AND reconciliations.id IS NOT NULL
             THEN reconciliations.effective_cached_input_tokens
           WHEN requests.completed_at IS NOT NULL AND requests.completed_at <= $3::timestamptz
             THEN requests.cached_input_tokens
           ELSE NULL
         END AS effective_cached_input_tokens,
         CASE
           WHEN requests.completed_at IS NOT NULL AND requests.completed_at <= $3::timestamptz
             AND reconciliations.id IS NOT NULL
             THEN reconciliations.effective_output_tokens
           WHEN requests.completed_at IS NOT NULL AND requests.completed_at <= $3::timestamptz
             THEN requests.output_tokens
           ELSE NULL
         END AS effective_output_tokens,
         CASE
           WHEN requests.completed_at IS NOT NULL AND requests.completed_at <= $3::timestamptz
             AND reconciliations.id IS NOT NULL
             THEN reconciliations.effective_cost_cny
           WHEN requests.completed_at IS NOT NULL AND requests.completed_at <= $3::timestamptz
             AND requests.cost_status = 'known'
             THEN requests.cost_cny
           ELSE NULL
         END AS effective_cost_cny,
         (requests.completed_at IS NOT NULL AND requests.completed_at <= $3::timestamptz
           AND reconciliations.id IS NOT NULL) AS reconciled_zero,
         (requests.completed_at IS NOT NULL AND requests.completed_at <= $3::timestamptz
           AND (requests.cost_status = 'known' OR reconciliations.id IS NOT NULL)) AS effective_cost_known
  FROM prompt_wizard_provider_requests requests
  JOIN operation_sources source
    ON source.source_kind = 'v6'
   AND source.run_id = requests.run_id
   AND source.batch_id IS NOT DISTINCT FROM requests.batch_id
  LEFT JOIN prompt_wizard_provider_request_reconciliations reconciliations
    ON reconciliations.request_id = requests.id
   AND reconciliations.reconciliation_status = 'confirmed-zero'
   AND reconciliations.reconciled_at <= $3::timestamptz
   AND reconciliations.created_at <= $3::timestamptz
  WHERE requests.created_at <= $3::timestamptz
    AND requests.provider = '${PROVIDER}'
    AND requests.model = $4::text
  UNION ALL
  SELECT 'tk'::text AS source_kind,
         requests.run_id,
         CASE WHEN requests.stage = 'analysis' THEN NULL::uuid
              ELSE requests.generation_id END AS batch_id,
         requests.provider, requests.model, requests.completed_at,
         requests.input_tokens AS effective_input_tokens,
         requests.cached_input_tokens AS effective_cached_input_tokens,
         requests.output_tokens AS effective_output_tokens,
         CASE WHEN requests.cost_status = 'known' THEN requests.cost_cny
              ELSE NULL END AS effective_cost_cny,
         false AS reconciled_zero,
         (requests.cost_status = 'known') AS effective_cost_known
  FROM tk_prompt_provider_requests requests
  JOIN operation_sources source
    ON source.source_kind = 'tk'
   AND source.run_id = requests.run_id
   AND source.batch_id IS NOT DISTINCT FROM (
     CASE WHEN requests.stage = 'analysis' THEN NULL::uuid ELSE requests.generation_id END
   )
  WHERE requests.created_at <= $3::timestamptz
    AND requests.completed_at IS NOT NULL
    AND requests.completed_at <= $3::timestamptz
    AND requests.request_status IN ('succeeded', 'failed')
    AND requests.provider = '${PROVIDER}'
    AND requests.model = $4::text
), request_aggregates AS (
  SELECT requests.source_kind, requests.run_id, requests.batch_id,
         max(requests.provider) AS provider,
         max(requests.model) AS model_id,
         count(*)::int AS provider_request_count,
         count(*) FILTER (
           WHERE requests.effective_cost_known
         )::int AS known_cost_request_count,
         count(*) FILTER (WHERE requests.reconciled_zero)::int AS reconciled_zero_request_count,
         count(*) FILTER (
           WHERE requests.completed_at IS NULL OR requests.completed_at > $3::timestamptz
              OR requests.effective_input_tokens IS NULL
              OR requests.effective_cached_input_tokens IS NULL
              OR requests.effective_output_tokens IS NULL
         )::int AS unknown_usage_request_count,
         count(*) FILTER (
           WHERE requests.completed_at IS NOT NULL AND requests.completed_at <= $3::timestamptz
             AND requests.effective_input_tokens IS NOT NULL
             AND requests.effective_cached_input_tokens IS NOT NULL
             AND requests.effective_output_tokens IS NOT NULL
             AND NOT requests.effective_cost_known
         )::int AS unpriced_request_count,
         CASE WHEN count(requests.effective_input_tokens) > 0
              THEN sum(requests.effective_input_tokens)::bigint ELSE NULL END AS known_input_tokens,
         CASE WHEN count(requests.effective_cached_input_tokens) > 0
              THEN sum(requests.effective_cached_input_tokens)::bigint ELSE NULL END AS known_cached_input_tokens,
         CASE WHEN count(requests.effective_output_tokens) > 0
              THEN sum(requests.effective_output_tokens)::bigint ELSE NULL END AS known_output_tokens,
         CASE WHEN count(requests.effective_cost_cny) > 0
              THEN sum(requests.effective_cost_cny)::numeric(20,6) ELSE NULL END AS known_cost_cny
  FROM request_evidence requests
  GROUP BY requests.source_kind, requests.run_id, requests.batch_id
), operation_costs AS (
  SELECT source.id, source.operation_type, source.run_id, source.batch_id,
         source.user_id, source.user_name, source.email,
         coalesce(requests.provider, historical.provider, '${PROVIDER}') AS provider,
         CASE
           WHEN requests.provider_request_count > 0 THEN $4::text
           WHEN presence.any_request_count IS NULL AND historical.operation_id IS NOT NULL
             THEN $4::text
           WHEN presence.any_request_count IS NULL AND source.legacy_model = $4::text THEN $4::text
           WHEN presence.any_request_count IS NULL AND source.legacy_model IS NULL
             AND NOT source.terminal_as_of THEN $4::text
           ELSE NULL
         END AS model_id,
         source.status, source.is_free, source.settled_credits, source.refunded_credits,
         CASE WHEN requests.provider_request_count > 0 THEN requests.known_input_tokens
              WHEN presence.any_request_count IS NULL AND historical.operation_id IS NOT NULL
                THEN historical.input_tokens
              ELSE source.legacy_input_tokens::bigint END AS known_input_tokens,
         CASE WHEN requests.provider_request_count > 0 THEN requests.known_cached_input_tokens
              WHEN presence.any_request_count IS NULL AND historical.operation_id IS NOT NULL
                THEN historical.cached_input_tokens
              ELSE NULL::bigint END AS known_cached_input_tokens,
         CASE WHEN requests.provider_request_count > 0 THEN requests.known_output_tokens
              WHEN presence.any_request_count IS NULL AND historical.operation_id IS NOT NULL
                THEN historical.output_tokens
              ELSE source.legacy_output_tokens::bigint END AS known_output_tokens,
         CASE WHEN requests.provider_request_count > 0 THEN requests.known_cost_cny
              WHEN presence.any_request_count IS NULL AND historical.operation_id IS NOT NULL
                THEN historical.cost_cny
              ELSE NULL::numeric(20,6) END AS known_cost_cny,
         coalesce(requests.provider_request_count, 0)::int AS provider_request_count,
         coalesce(requests.reconciled_zero_request_count, 0)::int AS reconciled_zero_request_count,
         coalesce(requests.unknown_usage_request_count, 0)::int AS unknown_usage_request_count,
         coalesce(requests.unpriced_request_count, 0)::int AS unpriced_request_count,
         (coalesce(requests.unknown_usage_request_count, 0)
           + coalesce(requests.unpriced_request_count, 0))::int AS incomplete_request_count,
         CASE
           WHEN source.terminal_as_of AND requests.provider_request_count > 0
             AND requests.known_cost_request_count = requests.provider_request_count THEN 'complete'
           WHEN source.terminal_as_of AND presence.any_request_count IS NULL
             AND historical.operation_id IS NOT NULL THEN 'complete'
           WHEN requests.known_cost_request_count > 0 THEN 'partial'
           ELSE 'unavailable'
         END AS estimate_completeness,
         CASE WHEN requests.reconciled_zero_request_count > 0 THEN 'ledger-reconciled'
              WHEN requests.provider_request_count > 0 THEN 'ledger'
              WHEN presence.any_request_count IS NULL AND historical.operation_id IS NOT NULL
                THEN 'historical-aggregate-priced'
              WHEN source.legacy_input_tokens IS NOT NULL OR source.legacy_output_tokens IS NOT NULL
                THEN 'historical'
              ELSE 'unavailable' END AS usage_evidence,
         CASE WHEN presence.any_request_count IS NULL AND historical.operation_id IS NOT NULL
              THEN historical.price_version ELSE NULL::text END AS price_version,
         CASE WHEN presence.any_request_count IS NULL AND historical.operation_id IS NOT NULL
              THEN historical.pricing_source_url ELSE NULL::text END AS pricing_source_url,
         source.failure_reason, source.created_at,
         CASE WHEN source.completed_at IS NOT NULL AND source.completed_at <= $3::timestamptz
              THEN source.completed_at ELSE NULL END AS completed_at
  FROM operation_sources source
  LEFT JOIN request_aggregates requests
    ON requests.source_kind = source.source_kind
   AND requests.run_id = source.run_id
   AND requests.batch_id IS NOT DISTINCT FROM source.batch_id
  LEFT JOIN request_presence presence
    ON presence.source_kind = source.source_kind
   AND presence.run_id = source.run_id
   AND presence.batch_id IS NOT DISTINCT FROM source.batch_id
  LEFT JOIN historical_cost_evidence historical
    ON historical.source_kind = source.source_kind
   AND historical.operation_id = source.id
   AND historical.operation_type = source.operation_type
)`;

export async function getAdminMultimodalCostOverview(
  client: DbClient,
  rawQuery: OverviewFilters | unknown = {},
) {
  const asOf = resolveAsOf(rawQuery);
  const modelId = resolveModelFilter(rawQuery);
  const selection = await resolveSelection(client, rawQuery, asOf, modelId);
  const aggregateResult = await client.query<AggregateRow>(
    `${OPERATION_COST_CTE}
     SELECT CASE WHEN grouping(model_id) = 1 THEN NULL ELSE provider END AS provider,
            CASE WHEN grouping(model_id) = 1 THEN NULL ELSE model_id END AS model_id,
            grouping(model_id) = 1 AS total_row,
            count(*) FILTER (WHERE operation_type = 'analysis')::int AS analysis_count,
            count(*) FILTER (WHERE operation_type = 'plan-batch')::int AS batch_count,
            count(DISTINCT user_id)::int AS user_count,
            coalesce(sum(settled_credits), 0)::bigint AS settled_credits,
            coalesce(sum(refunded_credits), 0)::bigint AS refunded_credits,
            CASE WHEN count(*) = 0 THEN 0::bigint
                 WHEN count(known_input_tokens) > 0 THEN sum(known_input_tokens)::bigint
                 ELSE NULL::bigint END AS known_input_tokens,
            CASE WHEN count(*) = 0 THEN 0::bigint
                 WHEN count(known_cached_input_tokens) > 0 THEN sum(known_cached_input_tokens)::bigint
                 ELSE NULL::bigint END AS known_cached_input_tokens,
            CASE WHEN count(*) = 0 THEN 0::bigint
                 WHEN count(known_output_tokens) > 0 THEN sum(known_output_tokens)::bigint
                 ELSE NULL::bigint END AS known_output_tokens,
            CASE WHEN count(*) = 0 THEN 0::numeric(20,6)
                 WHEN count(known_cost_cny) > 0 THEN sum(known_cost_cny)::numeric(20,6)
                 ELSE NULL::numeric(20,6) END AS known_cost_cny,
            coalesce(sum(provider_request_count), 0)::int AS provider_request_count,
            coalesce(sum(reconciled_zero_request_count), 0)::int AS reconciled_zero_request_count,
            coalesce(sum(unknown_usage_request_count), 0)::int AS unknown_usage_request_count,
            coalesce(sum(unpriced_request_count), 0)::int AS unpriced_request_count,
            count(*) FILTER (WHERE estimate_completeness <> 'complete')::int AS incomplete_operation_count,
            count(*) FILTER (WHERE usage_evidence = 'historical')::int
              AS historical_evidence_operation_count,
            count(*) FILTER (WHERE usage_evidence = 'historical-aggregate-priced')::int
              AS historical_priced_operation_count
     FROM operation_costs
     WHERE model_id = $4::text
     GROUP BY GROUPING SETS ((model_id, provider), ())
     ORDER BY total_row, model_id`,
    [selection.rangeStart, selection.rangeEnd, asOf, modelId],
  );
  const operationalResult = await client.query<OperationalAggregateRow>(
    `WITH latest_valuation AS (
       SELECT DISTINCT ON (valuation.operational_usage_record_id)
              valuation.operational_usage_record_id,
              valuation.pricing_status,
              valuation.estimated_cost_cny
       FROM provider_operational_usage_valuations valuation
       WHERE valuation.recorded_at <= $3::timestamptz
       ORDER BY valuation.operational_usage_record_id,
                valuation.recorded_at DESC, valuation.id DESC
     )
     SELECT count(*)::int AS call_count,
            count(*) FILTER (
              WHERE valuation.operational_usage_record_id IS NULL
                 OR valuation.pricing_status <> 'priced'
                 OR valuation.estimated_cost_cny IS NULL
            )::int AS unpriced_call_count,
            coalesce(sum(valuation.estimated_cost_cny)
              FILTER (WHERE valuation.pricing_status = 'priced'), 0)::numeric(20,6)
              AS estimated_cost_cny
     FROM provider_operational_usage_records usage
     LEFT JOIN latest_valuation valuation
       ON valuation.operational_usage_record_id = usage.id
     WHERE usage.provider = $5
       AND usage.service_type = 'multimodal'
       AND usage.model = ANY($4::text[])
       AND usage.local_accounting_date BETWEEN $1::date AND $2::date
       AND usage.recorded_at <= $3::timestamptz`,
    [selection.rangeStart, selection.rangeEnd, asOf, [modelId, MODEL_LABEL], PROVIDER],
  );
  const total = aggregateResult.rows.find(row => row.total_row) ?? emptyAggregate();
  const operational = operationalResult.rows[0] ?? {
    call_count: 0, unpriced_call_count: 0, estimated_cost_cny: '0.000000',
  };
  const modelRows = aggregateResult.rows.filter(
    (row): row is AggregateRow & { model_id: string; provider: string } => (
      !row.total_row && Boolean(row.model_id) && Boolean(row.provider)
    ),
  );
  const pricingSources = await readPricingSources(client, selection, asOf, modelId);
  const models = modelRows.length > 0
    ? modelRows.map(row => mapModelAggregate(row, pricingSources, operational))
    : [mapModelAggregate(emptyModelAggregate(), pricingSources, operational)];
  const account = await readAccountBalance(client, asOf);
  return {
    asOf,
    selection,
    account,
    summary: mapSummaryAggregate(total, operational),
    models,
  };
}

export async function listAdminMultimodalCostOperations(
  client: DbClient,
  rawQuery: OperationFilters | unknown = {},
  authorizationScope = 'role:admin',
) {
  const normalized = await normalizePagedQuery<OperationFilters>(client, rawQuery, 'multimodal-cost-operations', authorizationScope);
  const { selection, asOf, page, filters, modelId } = normalized;
  const values: unknown[] = [
    selection.rangeStart, selection.rangeEnd, asOf, modelId,
    filters.operationType ?? null, filters.status ?? null, filters.search ?? null,
    ...adminExactTimestampCursorValues(page), page.limit + 1,
  ];
  const result = await client.query<OperationRow & AdminExactTimestampPageMetadata>(
    `${OPERATION_COST_CTE}
     SELECT operation_costs.*,
            ${adminExactTimestampMetadataColumns(page, 'operation_costs.created_at')}
     FROM operation_costs
     WHERE operation_costs.model_id = $4::text
       AND ($5::text IS NULL OR operation_costs.operation_type = $5::text)
       AND ($6::text IS NULL OR operation_costs.status = $6::text)
       AND ($7::text IS NULL OR (
         operation_costs.id::text ILIKE '%' || $7::text || '%'
         OR operation_costs.run_id::text ILIKE '%' || $7::text || '%'
         OR coalesce(operation_costs.batch_id::text, '') ILIKE '%' || $7::text || '%'
         OR operation_costs.user_id::text ILIKE '%' || $7::text || '%'
         OR operation_costs.user_name ILIKE '%' || $7::text || '%'
         OR operation_costs.email ILIKE '%' || $7::text || '%'
       ))
       AND ${adminExactTimestampCursorCondition(page, 'operation_costs.created_at', 'operation_costs.id', 8, 9)}
     ORDER BY ${adminExactTimestampOrderBy(page, 'operation_costs.created_at', 'operation_costs.id')}
     LIMIT $10`,
    values,
  );
  return {
    asOf,
    selection,
    ...createAdminExactTimestampPage({
      rows: result.rows,
      query: page,
      getId: row => row.id,
      map: mapOperation,
    }),
  };
}

export async function listAdminMultimodalCostUsers(
  client: DbClient,
  rawQuery: UserFilters | unknown = {},
  authorizationScope = 'role:admin',
) {
  const normalized = await normalizePagedQuery<UserFilters>(client, rawQuery, 'multimodal-cost-users-v2', authorizationScope);
  const { selection, asOf, page, filters, modelId } = normalized;
  const values: unknown[] = [
    selection.rangeStart, selection.rangeEnd, asOf, modelId, filters.search ?? null,
    ...adminExactTimestampCursorValues(page), page.limit + 1,
  ];
  const result = await client.query<UserRow & AdminExactTimestampPageMetadata>(
    `${OPERATION_COST_CTE}, latest_valuation AS (
       SELECT DISTINCT ON (valuation.operational_usage_record_id)
              valuation.operational_usage_record_id,
              valuation.pricing_status,
              valuation.estimated_cost_cny
       FROM provider_operational_usage_valuations valuation
       WHERE valuation.recorded_at <= $3::timestamptz
       ORDER BY valuation.operational_usage_record_id,
                valuation.recorded_at DESC, valuation.id DESC
     ), business_user_costs AS (
       SELECT user_id AS id, user_id, max(user_name) AS user_name, max(email) AS email,
              array_agg(DISTINCT model_id ORDER BY model_id) AS model_ids,
              count(*) FILTER (WHERE operation_type = 'analysis')::int AS analysis_count,
              count(*) FILTER (WHERE operation_type = 'plan-batch')::int AS batch_count,
              coalesce(sum(settled_credits), 0)::bigint AS settled_credits,
              coalesce(sum(refunded_credits), 0)::bigint AS refunded_credits,
              CASE WHEN count(known_input_tokens) > 0 THEN sum(known_input_tokens)::bigint ELSE NULL END
                AS known_input_tokens,
              CASE WHEN count(known_cached_input_tokens) > 0 THEN sum(known_cached_input_tokens)::bigint ELSE NULL END
                AS known_cached_input_tokens,
              CASE WHEN count(known_output_tokens) > 0 THEN sum(known_output_tokens)::bigint ELSE NULL END
                AS known_output_tokens,
              CASE WHEN count(known_cost_cny) > 0 THEN sum(known_cost_cny)::numeric(20,6) ELSE NULL END
                AS known_cost_cny,
              coalesce(sum(provider_request_count), 0)::int AS provider_request_count,
              coalesce(sum(reconciled_zero_request_count), 0)::int AS reconciled_zero_request_count,
              coalesce(sum(unknown_usage_request_count), 0)::int AS unknown_usage_request_count,
              coalesce(sum(unpriced_request_count), 0)::int AS unpriced_request_count,
              count(*) FILTER (WHERE estimate_completeness <> 'complete')::int AS incomplete_operation_count,
              count(*) FILTER (WHERE usage_evidence = 'historical')::int
                AS historical_evidence_operation_count,
              count(*) FILTER (WHERE usage_evidence = 'historical-aggregate-priced')::int
                AS historical_priced_operation_count,
              CASE WHEN count(*) FILTER (WHERE estimate_completeness <> 'complete') = 0 THEN 'complete'
                   WHEN count(known_cost_cny) > 0 THEN 'partial' ELSE 'unavailable' END
                AS estimate_completeness,
              max(created_at) AS last_activity_at
       FROM operation_costs
       WHERE model_id = $4::text
       GROUP BY user_id
     ), operational_user_costs AS (
       SELECT usage.cost_owner_user_id AS id,
              max(owner.user_name) AS user_name,
              max(owner.email) AS email,
              count(*)::int AS operational_call_count,
              count(*) FILTER (
                WHERE valuation.operational_usage_record_id IS NULL
                   OR valuation.pricing_status <> 'priced'
                   OR valuation.estimated_cost_cny IS NULL
              )::int AS operational_unpriced_call_count,
              coalesce(sum(valuation.estimated_cost_cny)
                FILTER (WHERE valuation.pricing_status = 'priced'), 0)::numeric(20,6)
                AS operational_estimated_cost_cny,
              max(usage.occurred_at) AS last_activity_at
       FROM provider_operational_usage_records usage
       JOIN users owner ON owner.id = usage.cost_owner_user_id
       LEFT JOIN latest_valuation valuation
         ON valuation.operational_usage_record_id = usage.id
       WHERE usage.provider = '${PROVIDER}'
         AND usage.service_type = 'multimodal'
         AND usage.model IN ($4::text, '${MODEL_LABEL}')
         AND usage.local_accounting_date BETWEEN $1::date AND $2::date
         AND usage.recorded_at <= $3::timestamptz
       GROUP BY usage.cost_owner_user_id
     ), user_costs AS (
       SELECT coalesce(business.id, operational.id) AS id,
              coalesce(business.user_id, operational.id) AS user_id,
              coalesce(business.user_name, operational.user_name) AS user_name,
              coalesce(business.email, operational.email) AS email,
              coalesce(business.model_ids, ARRAY[$4::text]) AS model_ids,
              coalesce(business.analysis_count, 0)::int AS analysis_count,
              coalesce(business.batch_count, 0)::int AS batch_count,
              coalesce(business.settled_credits, 0)::bigint AS settled_credits,
              coalesce(business.refunded_credits, 0)::bigint AS refunded_credits,
              business.known_input_tokens,
              business.known_cached_input_tokens,
              business.known_output_tokens,
              business.known_cost_cny,
              coalesce(business.provider_request_count, 0)::int AS provider_request_count,
              coalesce(business.reconciled_zero_request_count, 0)::int AS reconciled_zero_request_count,
              coalesce(business.unknown_usage_request_count, 0)::int AS unknown_usage_request_count,
              coalesce(business.unpriced_request_count, 0)::int AS unpriced_request_count,
              coalesce(business.incomplete_operation_count, 0)::int AS incomplete_operation_count,
              coalesce(business.historical_evidence_operation_count, 0)::int
                AS historical_evidence_operation_count,
              coalesce(business.historical_priced_operation_count, 0)::int
                AS historical_priced_operation_count,
              coalesce(operational.operational_call_count, 0)::int AS operational_call_count,
              coalesce(operational.operational_unpriced_call_count, 0)::int
                AS operational_unpriced_call_count,
              coalesce(business.known_cost_cny, 0)::numeric(20,6) AS business_estimated_cost_cny,
              coalesce(operational.operational_estimated_cost_cny, 0)::numeric(20,6)
                AS operational_estimated_cost_cny,
              (coalesce(business.known_cost_cny, 0) + coalesce(operational.operational_estimated_cost_cny, 0))::numeric(20,6)
                AS known_account_cost_cny,
              CASE
                WHEN coalesce(business.incomplete_operation_count, 0)
                   + coalesce(operational.operational_unpriced_call_count, 0) = 0 THEN 'complete'
                WHEN business.known_cost_cny IS NOT NULL
                  OR coalesce(operational.operational_estimated_cost_cny, 0) > 0 THEN 'partial'
                ELSE 'unavailable'
              END AS estimate_completeness,
              greatest(
                coalesce(business.last_activity_at, '-infinity'::timestamptz),
                coalesce(operational.last_activity_at, '-infinity'::timestamptz)
              ) AS last_activity_at
       FROM business_user_costs business
       FULL OUTER JOIN operational_user_costs operational ON operational.id = business.id
     )
     SELECT user_costs.*,
            ${adminExactTimestampMetadataColumns(page, 'user_costs.last_activity_at')}
     FROM user_costs
     WHERE ($5::text IS NULL OR (
       user_costs.user_id::text ILIKE '%' || $5::text || '%'
       OR user_costs.user_name ILIKE '%' || $5::text || '%'
       OR user_costs.email ILIKE '%' || $5::text || '%'
     ))
       AND ${adminExactTimestampCursorCondition(page, 'user_costs.last_activity_at', 'user_costs.id', 6, 7)}
     ORDER BY ${adminExactTimestampOrderBy(page, 'user_costs.last_activity_at', 'user_costs.id')}
     LIMIT $8`,
    values,
  );
  return {
    asOf,
    selection,
    ...createAdminExactTimestampPage({
      rows: result.rows,
      query: page,
      getId: row => row.id,
      map: mapUser,
    }),
  };
}

async function normalizePagedQuery<Filters extends UserFilters | OperationFilters>(
  client: DbClient,
  rawQuery: Filters | unknown,
  resource: string,
  authorizationScope: string,
) {
  const filters = (rawQuery && typeof rawQuery === 'object' ? rawQuery : {}) as Filters;
  if ((filters.position === 'previous' || filters.position === 'next') && !filters.asOf) {
    throw reportInputError('翻页请求必须携带首屏返回的 asOf', 'INVALID_CURSOR');
  }
  const asOf = resolveAsOf(filters);
  const modelId = resolveModelFilter(filters);
  const selection = await resolveSelection(client, filters, asOf, modelId);
  const page = await parseAdminExactKeysetQuery(client, {
    rawQuery: filters,
    resource,
    defaultLimit: 20,
    maxLimit: 50,
    filters: {
      asOf,
      selection,
      model: modelId,
      search: filters.search ?? null,
      operationType: 'operationType' in filters ? filters.operationType ?? null : null,
      status: 'status' in filters ? filters.status ?? null : null,
    },
    versionResource: 'admin:cost-multimodal',
    asOf,
    authorizationScope,
  });
  return { filters, asOf, selection, page, modelId };
}

async function resolveSelection(
  client: DbClient,
  rawQuery: unknown,
  asOf: string,
  modelId: string,
): Promise<CostSelection> {
  const value = (rawQuery && typeof rawQuery === 'object' ? rawQuery : {}) as {
    range?: 'all' | 'month' | 'date' | 'custom';
    month?: string;
    date?: string;
    from?: string;
    to?: string;
  };
  const today = beijingDate(asOf);
  if (value.from || value.to) {
    if (!value.from || !value.to || !isIsoDate(value.from) || !isIsoDate(value.to) || value.from > value.to) {
      throw reportInputError('自定义日期范围无效', 'INVALID_DATE_RANGE');
    }
    if (value.to > today) throw reportInputError('不能查询未来日期', 'FUTURE_DATE');
    return {
      range: value.range === 'custom' ? 'custom' : value.from === value.to ? 'date' : 'all',
      month: null,
      date: value.range === 'custom' ? null : value.from === value.to ? value.from : null,
      rangeStart: value.from,
      rangeEnd: value.to,
      timezone: 'Asia/Shanghai',
      grain: value.range === 'custom' ? 'day' : value.from === value.to ? 'bucket' : 'day',
    };
  }
  const range = value.range ?? (value.month ? 'month' : value.date ? 'date' : 'month');
  if (range === 'all') {
    const coverage = await client.query<{ start_date: Date | string | null; end_date: Date | string | null }>(
      `WITH request_scope AS (
         SELECT requests.run_id, requests.batch_id,
                bool_or(requests.provider = '${PROVIDER}' AND requests.model = $2::text) AS has_target,
                true AS has_any
         FROM prompt_wizard_provider_requests requests
         WHERE requests.created_at <= $1::timestamptz
         GROUP BY requests.run_id, requests.batch_id
       ), tk_request_scope AS (
         SELECT requests.run_id,
                CASE WHEN requests.stage = 'analysis' THEN NULL::uuid
                     ELSE requests.generation_id END AS generation_id,
                bool_or(requests.provider = '${PROVIDER}' AND requests.model = $2::text) AS has_target,
                true AS has_any
         FROM tk_prompt_provider_requests requests
         WHERE requests.created_at <= $1::timestamptz
           AND requests.completed_at IS NOT NULL
           AND requests.completed_at <= $1::timestamptz
           AND requests.request_status IN ('succeeded', 'failed')
         GROUP BY requests.run_id,
                  CASE WHEN requests.stage = 'analysis' THEN NULL::uuid
                       ELSE requests.generation_id END
       ), observed AS (
         SELECT (runs.created_at AT TIME ZONE 'Asia/Shanghai')::date AS created_date
         FROM prompt_wizard_runs runs
         LEFT JOIN request_scope scope
           ON scope.run_id = runs.id AND scope.batch_id IS NULL
         WHERE runs.created_at <= $1::timestamptz
           AND (
             coalesce(scope.has_target, false)
             OR (
               scope.has_any IS NULL
               AND (
                 runs.provider_model = $2::text
                 OR (
                   runs.provider_model IS NULL
                   AND (runs.completed_at IS NULL OR runs.completed_at > $1::timestamptz)
                 )
               )
             )
           )
         UNION ALL
         SELECT (batches.created_at AT TIME ZONE 'Asia/Shanghai')::date AS created_date
         FROM prompt_wizard_batches batches
         LEFT JOIN request_scope scope
           ON scope.run_id = batches.run_id AND scope.batch_id = batches.id
         WHERE batches.created_at <= $1::timestamptz
           AND (
             coalesce(scope.has_target, false)
             OR (
               scope.has_any IS NULL
               AND (
                 batches.provider_model = $2::text
                 OR (
                   batches.provider_model IS NULL
                   AND (batches.completed_at IS NULL OR batches.completed_at > $1::timestamptz)
                 )
               )
             )
           )
         UNION ALL
         SELECT (runs.created_at AT TIME ZONE 'Asia/Shanghai')::date AS created_date
         FROM tk_prompt_runs runs
         LEFT JOIN tk_request_scope scope
           ON scope.run_id = runs.id AND scope.generation_id IS NULL
         WHERE runs.created_at <= $1::timestamptz
           AND (
             coalesce(scope.has_target, false)
             OR (
               scope.has_any IS NULL
               AND (runs.completed_at IS NULL OR runs.completed_at > $1::timestamptz)
             )
           )
         UNION ALL
         SELECT (generations.created_at AT TIME ZONE 'Asia/Shanghai')::date AS created_date
         FROM tk_prompt_generations generations
         LEFT JOIN tk_request_scope scope
           ON scope.run_id = generations.run_id
          AND scope.generation_id = generations.id
         WHERE generations.created_at <= $1::timestamptz
           AND (
             coalesce(scope.has_target, false)
             OR (
               scope.has_any IS NULL
               AND (generations.completed_at IS NULL OR generations.completed_at > $1::timestamptz)
             )
           )
       )
       SELECT min(created_date) AS start_date, max(created_date) AS end_date
       FROM observed`,
      [asOf, modelId],
    );
    const start = dateOnly(coverage.rows[0]?.start_date) ?? today;
    const end = minDate(dateOnly(coverage.rows[0]?.end_date) ?? today, today);
    return {
      range: 'all', month: null, date: null, rangeStart: start, rangeEnd: end,
      timezone: 'Asia/Shanghai', grain: 'month',
    };
  }
  if (range === 'date') {
    if (!value.date || !isIsoDate(value.date)) throw reportInputError('日期模式必须提供有效 date', 'INVALID_DATE');
    if (value.date > today) throw reportInputError('不能查询未来日期', 'FUTURE_DATE');
    return {
      range: 'date', month: null, date: value.date, rangeStart: value.date, rangeEnd: value.date,
      timezone: 'Asia/Shanghai', grain: 'bucket',
    };
  }
  if (range === 'custom') throw reportInputError('自定义范围必须同时提供 from 与 to', 'INVALID_DATE_RANGE');
  const month = value.month ?? today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw reportInputError('月份格式无效', 'INVALID_MONTH');
  if (month > today.slice(0, 7)) throw reportInputError('不能查询未来月份', 'FUTURE_MONTH');
  const start = `${month}-01`;
  return {
    range: 'month', month, date: null, rangeStart: start,
    rangeEnd: minDate(endOfMonth(start), today), timezone: 'Asia/Shanghai', grain: 'day',
  };
}

async function readPricingSources(
  client: DbClient,
  selection: CostSelection,
  asOf: string,
  modelId: string,
) {
  const result = await client.query<PricingSourceRow>(
    `WITH owner_scope AS (
       SELECT runs.id AS operation_id, 'analysis'::text AS operation_type,
              runs.id AS run_id, NULL::uuid AS batch_id
       FROM prompt_wizard_runs runs
       WHERE runs.created_at <= $3::timestamptz
         AND (runs.created_at AT TIME ZONE 'Asia/Shanghai')::date BETWEEN $1::date AND $2::date
       UNION ALL
       SELECT batches.id AS operation_id, 'plan-batch'::text AS operation_type,
              batches.run_id, batches.id AS batch_id
       FROM prompt_wizard_batches batches
       WHERE batches.created_at <= $3::timestamptz
         AND (batches.created_at AT TIME ZONE 'Asia/Shanghai')::date BETWEEN $1::date AND $2::date
     ), ledger_sources AS (
       SELECT DISTINCT requests.price_version, rules.source_url
       FROM prompt_wizard_provider_requests requests
       JOIN owner_scope owners
         ON owners.run_id = requests.run_id
        AND owners.batch_id IS NOT DISTINCT FROM requests.batch_id
       JOIN prompt_wizard_model_pricing_rules rules ON rules.id = requests.pricing_rule_id
       WHERE requests.created_at <= $3::timestamptz
         AND requests.completed_at IS NOT NULL
         AND requests.completed_at <= $3::timestamptz
         AND requests.provider = '${PROVIDER}'
         AND requests.model = $4::text
         AND requests.price_version IS NOT NULL
     ), tk_ledger_sources AS (
       SELECT DISTINCT requests.price_version, rules.source_url
       FROM tk_prompt_provider_requests requests
       JOIN prompt_wizard_model_pricing_rules rules ON rules.id = requests.pricing_rule_id
       WHERE requests.created_at <= $3::timestamptz
         AND requests.completed_at IS NOT NULL
         AND requests.completed_at <= $3::timestamptz
         AND requests.request_status IN ('succeeded', 'failed')
         AND requests.provider = '${PROVIDER}'
         AND requests.model = $4::text
         AND requests.price_version IS NOT NULL
         AND (
           (
             requests.stage = 'analysis'
             AND EXISTS (
               SELECT 1 FROM tk_prompt_runs runs
               WHERE runs.id = requests.run_id
                 AND runs.created_at <= $3::timestamptz
                 AND (runs.created_at AT TIME ZONE 'Asia/Shanghai')::date
                   BETWEEN $1::date AND $2::date
             )
           ) OR (
             requests.stage IN ('strategy', 'option')
             AND EXISTS (
               SELECT 1 FROM tk_prompt_generations generations
               WHERE generations.id = requests.generation_id
                 AND generations.created_at <= $3::timestamptz
                 AND (generations.created_at AT TIME ZONE 'Asia/Shanghai')::date
                   BETWEEN $1::date AND $2::date
             )
           )
         )
     ), historical_sources AS (
       SELECT DISTINCT evidence.pricing_version AS price_version,
              evidence.pricing_source_url AS source_url
       FROM prompt_wizard_historical_operation_cost_evidence evidence
       JOIN owner_scope owners
         ON (
           owners.operation_type = 'analysis'
           AND evidence.analysis_run_id = owners.operation_id
         ) OR (
           owners.operation_type = 'plan-batch'
           AND evidence.batch_id = owners.operation_id
         )
       WHERE evidence.priced_at <= $3::timestamptz
         AND evidence.created_at <= $3::timestamptz
         AND evidence.provider = '${PROVIDER}'
         AND evidence.model = $4::text
         AND NOT EXISTS (
           SELECT 1
           FROM prompt_wizard_provider_requests requests
           WHERE requests.created_at <= $3::timestamptz
             AND requests.run_id = owners.run_id
             AND requests.batch_id IS NOT DISTINCT FROM owners.batch_id
         )
     ), used_sources AS (
       SELECT price_version, source_url FROM ledger_sources
       UNION
       SELECT price_version, source_url FROM tk_ledger_sources
       UNION
       SELECT price_version, source_url FROM historical_sources
     ), active_sources AS (
       SELECT DISTINCT rules.price_version, rules.source_url
       FROM prompt_wizard_model_pricing_rules rules
       WHERE rules.provider = '${PROVIDER}'
         AND rules.model = $4::text
         AND rules.effective_from <= $3::timestamptz
         AND (rules.effective_to IS NULL OR rules.effective_to > $3::timestamptz)
     )
     SELECT price_version, source_url FROM used_sources
     UNION
     SELECT price_version, source_url FROM active_sources
     WHERE NOT EXISTS (SELECT 1 FROM used_sources)
     ORDER BY price_version, source_url`,
    [selection.rangeStart, selection.rangeEnd, asOf, modelId],
  );
  return result.rows.map(row => ({
    priceVersion: row.price_version,
    sourceUrl: row.source_url,
  }));
}

async function readAccountBalance(client: DbClient, asOf: string) {
  const result = await client.query<BalanceRow>(
    `WITH latest_balance AS (
       SELECT available_balance_cny, cash_balance_cny, frozen_amount_cny,
              arrears_balance_cny, credit_limit_cny, currency, synced_at
       FROM provider_account_balance_snapshots
       WHERE provider = $1 AND synced_at <= $2::timestamptz
       ORDER BY synced_at DESC, id DESC LIMIT 1
     ), latest_sync AS (
       SELECT CASE WHEN completed_at IS NOT NULL AND completed_at > $2::timestamptz
                     THEN 'running' ELSE status END AS sync_status,
              CASE WHEN completed_at IS NOT NULL AND completed_at <= $2::timestamptz
                     THEN completed_at ELSE NULL END AS sync_completed_at
       FROM provider_billing_sync_runs
       WHERE provider = $1 AND kind = 'balance' AND started_at <= $2::timestamptz
       ORDER BY started_at DESC, id DESC LIMIT 1
     )
     SELECT balance.*, sync.sync_status, sync.sync_completed_at
     FROM (SELECT 1) anchor
     LEFT JOIN latest_balance balance ON true
     LEFT JOIN latest_sync sync ON true`,
    [PROVIDER, asOf],
  );
  const row = result.rows[0];
  return {
    provider: PROVIDER,
    currency: 'CNY' as const,
    availableBalanceCny: nullableCny(row?.available_balance_cny),
    cashBalanceCny: nullableCny(row?.cash_balance_cny),
    frozenAmountCny: nullableCny(row?.frozen_amount_cny),
    arrearsBalanceCny: nullableCny(row?.arrears_balance_cny),
    creditLimitCny: nullableCny(row?.credit_limit_cny),
    syncedAt: row?.synced_at ? toIsoDateTime(row.synced_at) : '-',
    status: accountFreshness(row, asOf),
  };
}

function accountFreshness(row: BalanceRow | undefined, asOf: string) {
  if (row?.sync_status === 'running') return 'running' as const;
  if (row?.sync_status === 'failed') return 'failed' as const;
  if (!row?.synced_at || row.sync_status !== 'success') return 'never-synced' as const;
  const age = new Date(asOf).getTime() - new Date(row.synced_at).getTime();
  return age > 15 * 60_000 ? 'stale' as const : 'fresh' as const;
}

function mapSummaryAggregate(row: AggregateRow, operational?: OperationalAggregateRow) {
  const incompleteOperationCount = toInt(row.incomplete_operation_count);
  const historicalEvidenceOperationCount = toInt(row.historical_evidence_operation_count);
  const historicalPricedOperationCount = toInt(row.historical_priced_operation_count);
  const knownCost = nullableCny(row.known_cost_cny);
  const businessEstimatedCost = cnyMicros(row.known_cost_cny);
  const operationalEstimatedCost = cnyMicros(operational?.estimated_cost_cny);
  const knownAccountCost = businessEstimatedCost + operationalEstimatedCost;
  const operationalUnpricedCallCount = toInt(operational?.unpriced_call_count);
  return {
    analysisCount: toInt(row.analysis_count),
    batchCount: toInt(row.batch_count),
    userCount: toInt(row.user_count),
    settledCredits: toInt(row.settled_credits),
    refundedCredits: toInt(row.refunded_credits),
    incompleteOperationCount,
    historicalEvidenceOperationCount,
    historicalPricedOperationCount,
    operationalCallCount: toInt(operational?.call_count),
    operationalUnpricedCallCount,
    businessEstimatedCostCny: formatCnyMicros(businessEstimatedCost),
    operationalEstimatedCostCny: formatCnyMicros(operationalEstimatedCost),
    knownAccountCostCny: formatCnyMicros(knownAccountCost),
    knownInputTokens: nullableInt(row.known_input_tokens),
    knownCachedInputTokens: nullableInt(row.known_cached_input_tokens),
    knownOutputTokens: nullableInt(row.known_output_tokens),
    knownCostCny: knownCost,
    providerRequestCount: toInt(row.provider_request_count),
    reconciledZeroRequestCount: toInt(row.reconciled_zero_request_count),
    unknownUsageRequestCount: toInt(row.unknown_usage_request_count),
    unpricedRequestCount: toInt(row.unpriced_request_count),
    estimateCompleteness: aggregateCompleteness(
      incompleteOperationCount + operationalUnpricedCallCount,
      knownAccountCost > 0n ? formatCnyMicros(knownAccountCost) : knownCost,
    ),
  };
}

function mapModelAggregate(
  row: AggregateRow & { model_id: string; provider: string },
  pricingSources: Array<{ priceVersion: string; sourceUrl: string }>,
  operational?: OperationalAggregateRow,
) {
  const summary = mapSummaryAggregate(row, operational);
  return {
    id: row.model_id,
    provider: row.provider,
    model: modelLabel(row.model_id),
    analysisCount: summary.analysisCount,
    batchCount: summary.batchCount,
    userCount: summary.userCount,
    settledCredits: summary.settledCredits,
    refundedCredits: summary.refundedCredits,
    incompleteOperationCount: summary.incompleteOperationCount,
    historicalEvidenceOperationCount: summary.historicalEvidenceOperationCount,
    historicalPricedOperationCount: summary.historicalPricedOperationCount,
    operationalCallCount: summary.operationalCallCount,
    operationalUnpricedCallCount: summary.operationalUnpricedCallCount,
    businessEstimatedCostCny: summary.businessEstimatedCostCny,
    operationalEstimatedCostCny: summary.operationalEstimatedCostCny,
    knownAccountCostCny: summary.knownAccountCostCny,
    pricingSources,
    knownInputTokens: summary.knownInputTokens,
    knownCachedInputTokens: summary.knownCachedInputTokens,
    knownOutputTokens: summary.knownOutputTokens,
    knownCostCny: summary.knownCostCny,
    providerRequestCount: summary.providerRequestCount,
    reconciledZeroRequestCount: summary.reconciledZeroRequestCount,
    unknownUsageRequestCount: summary.unknownUsageRequestCount,
    unpricedRequestCount: summary.unpricedRequestCount,
    estimateCompleteness: summary.estimateCompleteness,
  };
}

function mapOperation(row: OperationRow & AdminExactTimestampPageMetadata) {
  return {
    id: row.id,
    operationType: row.operation_type,
    runId: row.run_id,
    batchId: row.batch_id,
    userId: row.user_id,
    userName: row.user_name,
    email: row.email,
    provider: row.provider,
    model: modelLabel(row.model_id),
    status: normalizeOperationStatus(row.status),
    isFree: row.is_free,
    settledCredits: toInt(row.settled_credits),
    refundedCredits: toInt(row.refunded_credits),
    knownInputTokens: nullableInt(row.known_input_tokens),
    knownCachedInputTokens: nullableInt(row.known_cached_input_tokens),
    knownOutputTokens: nullableInt(row.known_output_tokens),
    knownCostCny: nullableCny(row.known_cost_cny),
    providerRequestCount: toInt(row.provider_request_count),
    reconciledZeroRequestCount: toInt(row.reconciled_zero_request_count),
    unknownUsageRequestCount: toInt(row.unknown_usage_request_count),
    unpricedRequestCount: toInt(row.unpriced_request_count),
    incompleteRequestCount: toInt(row.incomplete_request_count),
    estimateCompleteness: row.estimate_completeness,
    usageEvidence: row.usage_evidence,
    priceVersion: row.price_version ?? null,
    pricingSourceUrl: row.pricing_source_url ?? null,
    failureReason: row.failure_reason,
    createdAt: toIsoDateTime(row.created_at)!,
    completedAt: row.completed_at ? toIsoDateTime(row.completed_at) : null,
  };
}

function mapUser(row: UserRow & AdminExactTimestampPageMetadata) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.user_name,
    email: row.email,
    models: row.model_ids.map(modelLabel),
    analysisCount: toInt(row.analysis_count),
    batchCount: toInt(row.batch_count),
    settledCredits: toInt(row.settled_credits),
    refundedCredits: toInt(row.refunded_credits),
    knownInputTokens: nullableInt(row.known_input_tokens),
    knownCachedInputTokens: nullableInt(row.known_cached_input_tokens),
    knownOutputTokens: nullableInt(row.known_output_tokens),
    knownCostCny: nullableCny(row.known_cost_cny),
    providerRequestCount: toInt(row.provider_request_count),
    reconciledZeroRequestCount: toInt(row.reconciled_zero_request_count),
    unknownUsageRequestCount: toInt(row.unknown_usage_request_count),
    unpricedRequestCount: toInt(row.unpriced_request_count),
    estimateCompleteness: row.estimate_completeness,
    incompleteOperationCount: toInt(row.incomplete_operation_count),
    historicalEvidenceOperationCount: toInt(row.historical_evidence_operation_count),
    historicalPricedOperationCount: toInt(row.historical_priced_operation_count),
    operationalCallCount: toInt(row.operational_call_count),
    operationalUnpricedCallCount: toInt(row.operational_unpriced_call_count),
    businessEstimatedCostCny: formatCnyMicros(cnyMicros(row.business_estimated_cost_cny)),
    operationalEstimatedCostCny: formatCnyMicros(cnyMicros(row.operational_estimated_cost_cny)),
    knownAccountCostCny: formatCnyMicros(cnyMicros(row.known_account_cost_cny)),
    lastActivityAt: toIsoDateTime(row.last_activity_at)!,
  };
}

function aggregateCompleteness(incompleteCount: number, knownCost: string | null): EstimateCompleteness {
  if (incompleteCount === 0) return 'complete';
  return knownCost === null ? 'unavailable' : 'partial';
}

function emptyAggregate(): AggregateRow {
  return {
    provider: null, model_id: null, total_row: true,
    analysis_count: 0, batch_count: 0, user_count: 0,
    settled_credits: 0, refunded_credits: 0,
    known_input_tokens: 0, known_cached_input_tokens: 0, known_output_tokens: 0,
    known_cost_cny: '0.000000', provider_request_count: 0,
    reconciled_zero_request_count: 0,
    unknown_usage_request_count: 0, unpriced_request_count: 0,
    incomplete_operation_count: 0, historical_evidence_operation_count: 0,
    historical_priced_operation_count: 0,
  };
}

function emptyModelAggregate(): AggregateRow & { provider: string; model_id: string } {
  return { ...emptyAggregate(), provider: PROVIDER, model_id: MODEL_ID, total_row: false };
}

function resolveAsOf(rawQuery: unknown) {
  const value = rawQuery && typeof rawQuery === 'object'
    ? (rawQuery as { asOf?: unknown }).asOf
    : undefined;
  const parsed = value === undefined ? new Date() : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw reportInputError('asOf 时间无效', 'INVALID_AS_OF');
  if (parsed.getTime() > Date.now() + 5 * 60_000) throw reportInputError('asOf 不能晚于当前时间', 'FUTURE_AS_OF');
  return parsed.toISOString();
}

function resolveModelFilter(rawQuery: unknown) {
  const value = rawQuery && typeof rawQuery === 'object'
    ? (rawQuery as { model?: unknown }).model
    : undefined;
  // 首版只核算当前提示词向导的 Doubao Seed 2.0 Lite。不传 model 也必须
  // 收紧到该模型，避免历史上其他 provider_model 混入总计与用户明细。
  if (value === undefined || value === null || value === '') return MODEL_ID;
  const model = String(value);
  if (model === MODEL_ID || model === MODEL_LABEL) return MODEL_ID;
  throw reportInputError('不支持的多模态模型筛选', 'INVALID_MODEL');
}

function modelLabel(modelId: string) {
  return modelId === MODEL_ID ? MODEL_LABEL : modelId;
}

function normalizeOperationStatus(value: string) {
  if (
    value === 'analyzing' || value === 'ready' || value === 'queued' || value === 'processing'
    || value === 'completed' || value === 'failed' || value === 'archived'
  ) return value;
  return 'failed' as const;
}

function nullableInt(value: unknown) {
  return value === null || value === undefined ? null : toInt(value);
}

function nullableCny(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  return `${match[1]}.${(match[2] ?? '').padEnd(6, '0').slice(0, 6)}`;
}

function cnyMicros(value: unknown) {
  const normalized = nullableCny(value);
  if (normalized === null) return 0n;
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole ?? '0') * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}

function formatCnyMicros(value: bigint) {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}

function reportInputError(message: string, code: string) {
  return Object.assign(new Error(message), { statusCode: 400, code });
}

function beijingDate(value: Date | string) {
  return new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function dateOnly(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function endOfMonth(start: string) {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function minDate(left: string, right: string) {
  return left < right ? left : right;
}
