import type { EndpointRequestQuery } from '@lindyson/api-contracts';
import type { DbClient } from '../db/pool.js';
import { normalizeCursorTimestamp } from './cursorPagination.js';
import {
  adminExactPageTotalCountSql,
  createAdminExactKeysetPage,
  parseAdminExactKeysetQuery,
  type AdminExactKeysetQuery,
  type AdminExactPageMetadata,
} from './adminExactKeysetPagination.js';
import { SEEDANCE_COST_MODEL_LABELS, seedanceCostModelOrder } from './seedanceModels.js';
import { toIsoDateTime, toInt } from './serialization.js';

type CostFilters = EndpointRequestQuery<'adminApiUsageTasks'>;
type CostAttemptFilters = EndpointRequestQuery<'adminApiUsageAttempts'>;
type CostUserFilters = EndpointRequestQuery<'adminApiUsageUsers'>;
type CostDashboardFilters = EndpointRequestQuery<'adminApiUsage'>;
type CostOverviewFilters = EndpointRequestQuery<'adminApiUsageOverview'>;
type CostReconciliationFilters = EndpointRequestQuery<'adminApiUsageReconciliation'>;
type CostSettlementFilters = EndpointRequestQuery<'adminApiUsageSettlement'>;
type AnyCostFilters = CostFilters | CostAttemptFilters | CostUserFilters | CostReconciliationFilters | CostSettlementFilters;
type SyncKind = 'balance' | 'bill' | 'packages';

interface ObservedCoverage {
  localStart: string | null;
  localEnd: string | null;
  officialStart: string | null;
  officialEnd: string | null;
  localIntervals: DateInterval[];
  officialIntervals: DateInterval[];
}

interface DateInterval {
  start: string;
  end: string;
  isFinal?: boolean;
  billState?: 'provisional' | 'final' | 'reopened';
}

interface CostSelection {
  range: 'all' | 'month' | 'date' | 'custom';
  month: string | null;
  date: string | null;
  rangeStart: string;
  rangeEnd: string;
  timezone: 'Asia/Shanghai';
  grain: 'month' | 'day' | 'bucket';
}

type KeysetPageMetadata = AdminExactPageMetadata;

interface TimestampKeysetPageMetadata extends KeysetPageMetadata {
  __pagination_cursor_timestamp: string;
}

interface BalanceRow {
  provider: string;
  available_balance_cny: unknown;
  cash_balance_cny: unknown;
  frozen_amount_cny: unknown;
  arrears_balance_cny: unknown;
  credit_limit_cny: unknown;
  currency: string;
  synced_at: Date | string;
}

interface AccountSyncSnapshotRow {
  balance: unknown;
  sync_runs: unknown;
}

interface SyncRunRow {
  kind: string;
  status: string;
  window_end: Date | string | null;
  error: string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
  last_success_at: Date | string | null;
  last_success_window_end: Date | string | null;
}

interface LocalSummaryRow {
  billable_tokens: unknown;
  estimated_cost_cny: unknown;
  unpriced_attempts: unknown;
  unpriced_tokens: unknown;
  unavailable_usage_attempts: unknown;
  raw_billable_tokens: unknown;
  raw_estimated_cost_cny: unknown;
  inferred_adjustment_tokens: unknown;
  inferred_adjustment_cost_cny: unknown;
  comparable_billable_tokens: unknown;
  comparable_estimated_cost_cny: unknown;
  comparable_raw_billable_tokens: unknown;
  comparable_raw_estimated_cost_cny: unknown;
  comparable_inferred_adjustment_tokens: unknown;
  comparable_inferred_adjustment_cost_cny: unknown;
  comparable_unpriced_attempts: unknown;
  comparable_unpriced_tokens: unknown;
  comparable_unavailable_usage_attempts: unknown;
  today_estimated_cost_cny: unknown;
  today_unpriced_attempts: unknown;
  today_unpriced_tokens: unknown;
  today_unavailable_usage_attempts: unknown;
  month_estimated_cost_cny: unknown;
  month_unpriced_attempts: unknown;
  month_unpriced_tokens: unknown;
  month_unavailable_usage_attempts: unknown;
}

interface OfficialSummaryRow {
  row_count: unknown;
  billable_tokens: unknown;
  unpriced_rows: unknown;
  unpriced_tokens: unknown;
  list_equivalent_cost_cny: unknown;
  original_bill_amount_cny: unknown;
  payable_amount_cny: unknown;
  paid_amount_cny: unknown;
  unpaid_amount_cny: unknown;
  deducted_tokens: unknown;
  all_final: boolean | null;
  any_final: boolean | null;
}

interface OfficialRevisionRow {
  revision_id: string | null;
  source_detail_key: string | null;
  normalized_payload: unknown;
  is_final: boolean | null;
  coverage_complete?: boolean;
}

interface OfficialAsOfDetail {
  revisionId: string | null;
  sourceDetailKey: string;
  billPeriod: string;
  expenseDate: string;
  product: string;
  billLineType: 'usage' | 'package-purchase' | 'refund' | 'adjustment' | 'other';
  recognizedModel: string | null;
  seedanceCandidate: boolean;
  pricingResolution: string | null;
  pricingInputHasVideo: boolean | null;
  normalizedUnitPricePerMillion: unknown;
  billableTokens: unknown;
  deductionCount: unknown;
  listEquivalentCostCny: unknown;
  originalBillAmountCny: unknown;
  preferentialBillAmountCny: unknown;
  discountBillAmountCny: unknown;
  couponAmountCny: unknown;
  payableAmountCny: unknown;
  paidAmountCny: unknown;
  unpaidAmountCny: unknown;
  currency: string;
  instanceNo: string | null;
  isFinal: boolean;
}

interface CostCoverageRow {
  local_start: Date | string | null;
  local_end: Date | string | null;
  official_start: Date | string | null;
  official_end: Date | string | null;
  local_intervals?: unknown;
  official_intervals?: unknown;
}

interface SettlementSummaryRow {
  usage_original_amount_cny: unknown;
  usage_payable_amount_cny: unknown;
  usage_paid_amount_cny: unknown;
  usage_unpaid_amount_cny: unknown;
  package_purchase_amount_cny: unknown;
  package_purchase_paid_amount_cny: unknown;
  package_purchase_unpaid_amount_cny: unknown;
  refund_amount_cny: unknown;
  billing_adjustment_amount_cny: unknown;
  net_official_payable_cny: unknown;
}

interface SettlementSnapshotPageRow extends OfficialRevisionRow, SettlementSummaryRow, KeysetPageMetadata {
  list_price_cost_cny: unknown;
  list_price_status: 'priced' | 'unpriced' | 'unavailable';
}

interface TimingAdjustmentRow {
  timing_tokens: unknown;
  timing_cost_cny: unknown;
}

interface PackageLedgerSummaryRow {
  opening_prepaid_asset_cny: unknown;
  acquisition_cost_cny: unknown;
  amortized_cost_cny: unknown;
  opening_catch_up_cny: unknown;
  expiry_loss_cny: unknown;
  adjustment_cny: unknown;
  ending_prepaid_asset_cny: unknown;
  incomplete_rows: unknown;
  row_count: unknown;
  event_rows: unknown;
  opening_catch_up_rows: unknown;
  uncertain_time_rows: unknown;
  stale_gap_time_rows: unknown;
}

interface OfficialAverageRow {
  all_account_payable_cny: unknown;
  seedance_payable_cny: unknown;
  seedance_list_cost_cny: unknown;
  seedance_unpriced_rows: unknown;
  seedance_unpriced_tokens: unknown;
}

interface ListPriceSummary {
  cost: bigint | null;
  status: 'priced' | 'unpriced' | 'unavailable';
}

interface LocalModelRow {
  model: string;
  billable_tokens: unknown;
  estimated_cost_cny: unknown;
  successful_tasks: unknown;
  failed_tasks: unknown;
  failed_billable_tokens: unknown;
  failed_estimated_cost_cny: unknown;
  successful_estimated_cost_cny: unknown;
  without_video_cost_cny: unknown;
  with_video_cost_cny: unknown;
  unpriced_tasks: unknown;
  unavailable_usage_attempts: unknown;
  attempt_count: unknown;
  task_count: unknown;
  successful_video_count: unknown;
  successful_output_seconds: unknown;
}

interface OfficialModelRow {
  model: string;
  billable_tokens: unknown;
  list_equivalent_cost_cny: unknown;
  payable_amount_cny: unknown;
}

interface DailyRow {
  day: Date | string;
  billable_tokens: unknown;
  estimated_cost_cny?: unknown;
  list_equivalent_cost_cny?: unknown;
  payable_amount_cny?: unknown;
  unpriced_attempts?: unknown;
  unavailable_usage_attempts?: unknown;
}

interface PricingRow {
  model: string;
  resolution: string;
  has_video_input: boolean;
  unit_price_per_million: unknown;
  price_version: string;
  effective_from: Date | string;
}

interface PackageRow {
  id: string;
  package_id: string;
  product: string;
  config: unknown;
  recognized_model: string;
  status: string;
  total_quota: unknown;
  remaining_quota: unknown;
  starts_at: Date | string | null;
  expires_at: Date | string | null;
}

interface AttemptCostRow extends TimestampKeysetPageMetadata {
  id: string;
  task_id: string | null;
  origin: string;
  provider_task_id: string | null;
  attempt: unknown;
  user_id: string | null;
  user_name: string | null;
  email: string | null;
  provider: string;
  model: string;
  resolution: string | null;
  has_video_input: boolean;
  task_status: string | null;
  usage_status: string;
  completion_tokens: unknown;
  total_tokens: unknown;
  billable_tokens: unknown;
  billable_basis: string | null;
  unit_price_per_million: unknown;
  estimated_cost: unknown;
  price_version: string | null;
  pricing_status: string;
  usage_evidence_origin: string;
  pricing_rule_status: string;
  pricing_input_class: string;
  pricing_resolution_band: string;
  attribution_confidence: string;
  local_accounting_date: Date | string | null;
  provider_terminal_at: Date | string | null;
  usage_observed_at: Date | string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  error: string | null;
  cost_resolution_case_id: string | null;
  cost_resolution_case_status: string | null;
  cost_resolution_evidence: unknown;
}

interface BusinessTaskCostRow extends TimestampKeysetPageMetadata {
  id: string;
  user_id: string | null;
  user_name: string | null;
  email: string | null;
  model: string;
  price_versions: unknown;
  status: string;
  resolution: string;
  configured_credits: unknown;
  reserved_credits: unknown;
  settled_credits: unknown;
  refunded_credits: unknown;
  credit_status: string;
  attempt_count: unknown;
  billable_tokens: unknown;
  estimated_cost_cny: unknown;
  unpriced_attempts: unknown;
  missing_usage_attempts: unknown;
  cost_finalized: boolean;
  cost_resolution_status: string;
  cost_resolution_case_id: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
}

interface BusinessUserCostRow extends TimestampKeysetPageMetadata {
  id: string;
  user_id: string | null;
  user_name: string | null;
  email: string | null;
  task_count: unknown;
  successful_tasks: unknown;
  failed_tasks: unknown;
  canceled_tasks: unknown;
  settled_credits: unknown;
  refunded_credits: unknown;
  billable_tokens: unknown;
  estimated_cost_cny: unknown;
  business_estimated_cost_cny: unknown;
  operational_estimated_cost_cny: unknown;
  operational_call_count: unknown;
  operational_unpriced_call_count: unknown;
  incomplete_task_count: unknown;
  last_task_at: Date | string | null;
  last_activity_at: Date | string;
}

interface BusinessOperationsAggregateRow {
  model: string | null;
  price_versions: unknown;
  total_row: boolean;
  task_count: unknown;
  user_count: unknown;
  settled_credits: unknown;
  held_credits: unknown;
  refunded_credits: unknown;
  estimated_cost_cny: unknown;
  incomplete_task_count: unknown;
  pending_final_bill_task_count: unknown;
  approved_zero_cost_task_count: unknown;
  unresolved_task_count: unknown;
  admin_direct_usage_count: unknown;
  admin_direct_estimated_cost_cny: unknown;
  timing_shift_cost_cny: unknown;
}

interface OperationalUsageAggregateRow {
  model: string;
  call_count: unknown;
  estimated_cost_cny: unknown;
  unpriced_call_count: unknown;
  price_versions: unknown;
}

interface ReconciliationBucketRow extends KeysetPageMetadata {
  id: string;
  period_start: Date | string;
  period_end: Date | string;
  expense_date: Date | string | null;
  bill_line_type: string;
  recognized_model: string | null;
  pricing_resolution_band: string;
  pricing_input_class: string;
  unit_price_per_million: unknown;
  currency: string;
  raw_local_tokens: unknown;
  inferred_adjustment_tokens: unknown;
  adjusted_local_tokens: unknown;
  official_tokens: unknown;
  timing_adjustment_tokens: unknown;
  residual_tokens: unknown;
  raw_local_cost_cny: unknown;
  inferred_adjustment_cost_cny: unknown;
  adjusted_local_cost_cny: unknown;
  official_cost_cny: unknown;
  timing_adjustment_cost_cny: unknown;
  rate_variance_cny: unknown;
  rounding_variance_cny: unknown;
  residual_cost_cny: unknown;
  status: string;
  attribution_confidence: string | null;
}

interface ReconciliationEvidenceRow {
  id: string;
  side: string;
  usage_record_id: string | null;
  bill_detail_revision_id: string | null;
  task_id: string | null;
  provider_task_id: string | null;
  source_detail_key: string | null;
  allocated_tokens: unknown;
  allocated_cost_cny: unknown;
  cause: string | null;
  confidence: string;
  evidence: unknown;
}

interface SettlementItemRow {
  id: string;
  revision_id: string;
  source_detail_key: string;
  bill_period: string;
  expense_date: Date | string;
  bill_line_type: string;
  recognized_model: string | null;
  instance_no: string | null;
  package_id: string | null;
  original_bill_amount_cny: unknown;
  preferential_bill_amount_cny: unknown;
  discount_bill_amount_cny: unknown;
  coupon_amount_cny: unknown;
  payable_amount_cny: unknown;
  paid_amount_cny: unknown;
  unpaid_amount_cny: unknown;
  currency: string;
  is_final: boolean;
  acquisition_link_status?: 'linked' | 'missing' | 'not-applicable';
}

interface AcquisitionLinkRow {
  bill_source_detail_key: string;
  package_id: string;
  current_revision_id: string | null;
  cost_basis_status: string;
}

const PROVIDER = 'volcengine-ark';
const OFFICIAL_PRODUCT = 'ark_bd';

/**
 * 经营口径始终先按任务创建日筛选，再把同一任务的全部供应商 attempt 聚合回任务。
 * tasks、users、dashboard.operations 共用这段 CTE，避免按 attempt 会计日期拼出不同任务数。
 */
const ZERO_COST_USAGE_RESOLUTIONS_CTE = `zero_cost_usage_resolutions AS (
  SELECT DISTINCT ON (links.usage_record_id)
         links.usage_record_id, cases.id AS case_id, cases.status AS case_status,
         cases.evidence AS case_evidence
  FROM (
    SELECT DISTINCT case_id, usage_record_id
    FROM provider_reconciliation_case_links
    WHERE usage_record_id IS NOT NULL AND created_at <= $5::timestamptz
  ) links
  JOIN provider_reconciliation_cases cases ON cases.id = links.case_id
  WHERE cases.provider = $1
    AND cases.case_type = 'missing-local-usage'
    AND cases.evidence->>'resolutionKind' = 'zero-cost'
    AND cases.token_adjustment = 0
    AND cases.cost_adjustment_cny = 0
    AND cases.status IN ('open', 'approved')
    AND cases.created_at <= $5::timestamptz
  ORDER BY links.usage_record_id,
           CASE cases.status WHEN 'approved' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
           cases.created_at DESC, cases.id DESC
)`;

const BUSINESS_TASK_COST_CTE = `WITH ${ZERO_COST_USAGE_RESOLUTIONS_CTE}, business_task_aggregates AS (
  SELECT gt.id, gt.user_id, u.user_name, u.email, gt.model, gt.status,
         CASE lower(coalesce(gt.config->>'resolution', ''))
           WHEN '480p' THEN '480p' WHEN '720p' THEN '720p'
           WHEN '1080p' THEN '1080p' WHEN '4k' THEN '4k' ELSE 'unknown'
         END AS resolution,
         gt.credits AS configured_credits, gt.reserved_credits, gt.settled_credits,
         gt.refunded_credits, gt.credit_status, gt.provider_task_id,
         gt.provider_task_attempt, gt.created_at, gt.completed_at,
         coalesce(
           array_agg(DISTINCT pur.price_version ORDER BY pur.price_version)
             FILTER (WHERE pur.price_version IS NOT NULL),
           ARRAY[]::text[]
         ) AS price_versions,
         count(pur.id)::int AS recorded_attempts,
         count(pur.id) FILTER (WHERE pur.billable_tokens IS NOT NULL)::int AS known_usage_attempts,
         count(pur.id) FILTER (
           WHERE pur.billable_tokens IS NULL AND resolution.case_status = 'approved'
         )::int AS approved_zero_attempts,
         count(pur.id) FILTER (
           WHERE pur.billable_tokens IS NULL AND resolution.case_status = 'open'
         )::int AS pending_final_bill_attempts,
         (min(resolution.case_id::text) FILTER (
           WHERE pur.billable_tokens IS NULL AND resolution.case_status = 'approved'
         ))::uuid AS approved_zero_case_id,
         (min(resolution.case_id::text) FILTER (
           WHERE pur.billable_tokens IS NULL AND resolution.case_status = 'open'
         ))::uuid AS pending_final_bill_case_id,
         coalesce(sum(pur.billable_tokens), 0)::bigint AS billable_tokens,
         coalesce(sum(pur.estimated_cost), 0)::numeric(20,6) AS estimated_cost_cny,
         count(pur.id) FILTER (
           WHERE pur.billable_tokens > 0 AND (
             pur.estimated_cost IS NULL OR pur.pricing_rule_status <> 'priced'
             OR pur.pricing_resolution_band = 'unknown'
             OR pur.pricing_input_class = 'unknown'
             OR pur.unit_price_per_million IS NULL
           )
         )::int AS unpriced_attempts
  FROM generation_tasks gt
  LEFT JOIN users u ON u.id = gt.user_id
  LEFT JOIN provider_usage_records pur
    ON pur.task_id = gt.id AND pur.provider = $1
   AND pur.usage_unit = 'tokens' AND pur.currency = 'CNY'
   AND pur.created_at <= $5::timestamptz
  LEFT JOIN zero_cost_usage_resolutions resolution ON resolution.usage_record_id = pur.id
  WHERE gt.kind = 'video' AND gt.model = ANY($2::text[])
    AND gt.created_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Shanghai')
    AND gt.created_at < (($4::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
    AND gt.created_at <= $5::timestamptz
  GROUP BY gt.id, gt.user_id, u.user_name, u.email, gt.model, gt.status,
           gt.config, gt.credits, gt.reserved_credits, gt.settled_credits,
           gt.refunded_credits, gt.credit_status, gt.provider_task_id,
           gt.provider_task_attempt, gt.created_at, gt.completed_at
), business_task_expected AS (
  SELECT aggregates.*,
         greatest(
           recorded_attempts,
           CASE
             WHEN provider_task_attempt IS NOT NULL THEN provider_task_attempt + 1
             WHEN provider_task_id IS NOT NULL OR status = 'completed' THEN 1
             ELSE 0
           END
         )::int AS attempt_count
  FROM business_task_aggregates aggregates
), business_task_costs AS (
  SELECT expected.*,
         greatest(attempt_count - known_usage_attempts - approved_zero_attempts, 0)::int AS missing_usage_attempts,
         (
           status IN ('completed', 'failed', 'canceled')
           AND greatest(attempt_count - known_usage_attempts - approved_zero_attempts, 0) = 0
           AND unpriced_attempts = 0
         ) AS cost_finalized,
         CASE
           WHEN status IN ('completed', 'failed', 'canceled')
            AND greatest(attempt_count - known_usage_attempts - approved_zero_attempts, 0) = 0
            AND unpriced_attempts = 0 AND approved_zero_attempts > 0
             THEN 'approved-zero'
           WHEN status IN ('completed', 'failed', 'canceled')
            AND greatest(attempt_count - known_usage_attempts - approved_zero_attempts, 0)
                = pending_final_bill_attempts
            AND pending_final_bill_attempts > 0 AND unpriced_attempts = 0
             THEN 'pending-final-bill'
           WHEN status IN ('completed', 'failed', 'canceled')
            AND greatest(attempt_count - known_usage_attempts, 0) = 0
            AND unpriced_attempts = 0 THEN 'recorded'
           ELSE 'unresolved'
         END AS cost_resolution_status,
         CASE
           WHEN status IN ('completed', 'failed', 'canceled')
            AND greatest(attempt_count - known_usage_attempts - approved_zero_attempts, 0)
                = pending_final_bill_attempts
            AND pending_final_bill_attempts > 0 AND unpriced_attempts = 0
             THEN pending_final_bill_case_id
           WHEN status IN ('completed', 'failed', 'canceled')
            AND greatest(attempt_count - known_usage_attempts - approved_zero_attempts, 0) = 0
            AND unpriced_attempts = 0 AND approved_zero_attempts > 0
             THEN approved_zero_case_id
           ELSE NULL
         END AS cost_resolution_case_id
  FROM business_task_expected expected
)`;

/**
 * 主看盘只读取经营所需的三组数据：账户/同步、任务聚合、官方同价折算。
 * 审计账本、趋势、资源包和价格版本仍由完整 dashboard 接口按需加载。
 */
export async function getAdminApiCostOverview(
  client: DbClient,
  rawQuery: CostOverviewFilters | unknown = {},
) {
  const asOf = resolveAsOf(rawQuery);
  const models = resolveSelectedModels(rawQuery);
  const selection = await resolveDirectCostSelection(client, rawQuery, asOf);
  const accountSyncResult = await client.query<AccountSyncSnapshotRow>(
      `WITH latest_balance AS (
         SELECT provider, available_balance_cny, cash_balance_cny, frozen_amount_cny,
                arrears_balance_cny, credit_limit_cny, currency, synced_at
         FROM provider_account_balance_snapshots
         WHERE provider = $1 AND synced_at <= $2
         ORDER BY synced_at DESC, id DESC
         LIMIT 1
       ), ranked_sync AS (
         SELECT CASE WHEN kind LIKE 'bill%' THEN 'bill' ELSE kind END AS kind,
                CASE WHEN completed_at > $2::timestamptz THEN 'running' ELSE status END AS status,
                window_end,
                CASE WHEN completed_at > $2::timestamptz THEN NULL ELSE error END AS error,
                started_at,
                CASE WHEN completed_at > $2::timestamptz THEN NULL ELSE completed_at END AS completed_at,
                max(completed_at) FILTER (
                  WHERE status = 'success' AND completed_at <= $2::timestamptz
                ) OVER (
                  PARTITION BY CASE WHEN kind LIKE 'bill%' THEN 'bill' ELSE kind END
                ) AS last_success_at,
                max(window_end) FILTER (
                  WHERE status = 'success' AND completed_at <= $2::timestamptz
                ) OVER (
                  PARTITION BY CASE WHEN kind LIKE 'bill%' THEN 'bill' ELSE kind END
                ) AS last_success_window_end,
                row_number() OVER (
                  PARTITION BY CASE WHEN kind LIKE 'bill%' THEN 'bill' ELSE kind END
                  ORDER BY started_at DESC, id DESC
                ) AS row_number
         FROM provider_billing_sync_runs
         WHERE provider = $1 AND started_at <= $2
       )
       SELECT (SELECT to_jsonb(balance) FROM latest_balance balance) AS balance,
              coalesce((SELECT jsonb_agg(to_jsonb(sync_row))
                        FROM ranked_sync sync_row WHERE row_number = 1), '[]'::jsonb) AS sync_runs`,
      [PROVIDER, asOf],
    );
  const operationsResult = await client.query<BusinessOperationsAggregateRow>(
      `${BUSINESS_TASK_COST_CTE}, timing_adjustment AS (
         SELECT coalesce(sum(CASE
                  WHEN official_expense_date BETWEEN $3::date AND $4::date
                    AND (local_accounting_date IS NULL OR local_accounting_date NOT BETWEEN $3::date AND $4::date)
                    THEN cost_adjustment_cny
                  WHEN local_accounting_date BETWEEN $3::date AND $4::date
                    AND (official_expense_date IS NULL OR official_expense_date NOT BETWEEN $3::date AND $4::date)
                    THEN -cost_adjustment_cny
                  ELSE 0 END), 0)::numeric(20,6) AS cost_cny
         FROM provider_reconciliation_cases
         WHERE provider = $1 AND case_type = 'cross-date' AND status = 'approved' AND created_at <= $5
       ), admin_direct_usage AS (
         SELECT count(*)::int AS usage_count,
                coalesce(sum(pur.estimated_cost), 0)::numeric(20,6) AS estimated_cost_cny
         FROM provider_usage_records pur
         WHERE pur.provider = $1
           AND pur.model = ANY($2::text[])
           AND pur.task_id IS NULL
           AND pur.initiated_by_admin_user_id IS NOT NULL
           AND pur.usage_unit = 'tokens'
           AND pur.currency = 'CNY'
           AND pur.local_accounting_date BETWEEN $3::date AND $4::date
           AND pur.created_at <= $5::timestamptz
       ), model_price_versions AS (
         SELECT version_task.model,
                coalesce(
                  array_agg(
                    DISTINCT version_usage.price_version
                    ORDER BY version_usage.price_version
                  ) FILTER (WHERE version_usage.price_version IS NOT NULL),
                  ARRAY[]::text[]
                ) AS price_versions
         FROM generation_tasks version_task
         JOIN provider_usage_records version_usage
           ON version_usage.task_id = version_task.id
          AND version_usage.provider = $1
          AND version_usage.usage_unit = 'tokens'
          AND version_usage.currency = 'CNY'
          AND version_usage.created_at <= $5::timestamptz
         WHERE version_task.kind = 'video'
           AND version_task.model = ANY($2::text[])
           AND version_task.created_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Shanghai')
           AND version_task.created_at < (($4::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
           AND version_task.created_at <= $5::timestamptz
         GROUP BY version_task.model
       )
       SELECT CASE WHEN grouping(task.model) = 1 THEN NULL ELSE task.model END AS model,
              CASE WHEN grouping(task.model) = 1
                THEN ARRAY[]::text[]
                ELSE coalesce(versions.price_versions, ARRAY[]::text[])
              END AS price_versions,
              grouping(task.model) = 1 AS total_row,
              count(*)::int AS task_count,
              count(DISTINCT task.user_id)::int AS user_count,
              coalesce(sum(task.settled_credits), 0)::bigint AS settled_credits,
              coalesce(sum(CASE WHEN task.credit_status = 'held' THEN task.reserved_credits ELSE 0 END), 0)::bigint AS held_credits,
              coalesce(sum(task.refunded_credits), 0)::bigint AS refunded_credits,
              coalesce(sum(task.estimated_cost_cny), 0)::numeric(20,6) AS estimated_cost_cny,
              count(*) FILTER (WHERE NOT task.cost_finalized)::int AS incomplete_task_count,
              count(*) FILTER (
                WHERE task.cost_resolution_status = 'pending-final-bill'
              )::int AS pending_final_bill_task_count,
              count(*) FILTER (
                WHERE task.cost_resolution_status = 'approved-zero'
              )::int AS approved_zero_cost_task_count,
              count(*) FILTER (
                WHERE task.cost_resolution_status = 'unresolved'
              )::int AS unresolved_task_count,
              (SELECT usage_count FROM admin_direct_usage) AS admin_direct_usage_count,
              (SELECT estimated_cost_cny FROM admin_direct_usage) AS admin_direct_estimated_cost_cny,
              (SELECT cost_cny FROM timing_adjustment) AS timing_shift_cost_cny
       FROM business_task_costs task
       LEFT JOIN model_price_versions versions ON versions.model = task.model
       GROUP BY GROUPING SETS ((task.model, versions.price_versions), ())
       ORDER BY total_row, task.model`,
      [PROVIDER, models, selection.rangeStart, selection.rangeEnd, asOf],
    );
  const operationalResult = await client.query<OperationalUsageAggregateRow>(
    `WITH latest_valuation AS (
       SELECT DISTINCT ON (valuation.operational_usage_record_id)
              valuation.operational_usage_record_id,
              valuation.pricing_status,
              valuation.price_version,
              valuation.estimated_cost_cny
       FROM provider_operational_usage_valuations valuation
       WHERE valuation.recorded_at <= $5::timestamptz
       ORDER BY valuation.operational_usage_record_id,
                valuation.recorded_at DESC, valuation.id DESC
     ), operational_sources AS (
       SELECT usage.model,
              usage.id::text AS source_id,
              coalesce(usage.estimated_cost, 0)::numeric(20,6) AS estimated_cost_cny,
              NOT (
                usage.billable_tokens IS NOT NULL
                AND (
                  usage.billable_tokens = 0
                  OR (usage.estimated_cost IS NOT NULL AND usage.pricing_rule_status = 'priced')
                )
              ) AS unpriced,
              usage.price_version
       FROM provider_usage_records usage
       WHERE usage.provider = $1
         AND usage.model = ANY($2::text[])
         AND usage.usage_unit = 'tokens'
         AND usage.currency = 'CNY'
         AND usage.task_id IS NULL
         AND usage.initiated_by_admin_user_id IS NOT NULL
         AND usage.local_accounting_date BETWEEN $3::date AND $4::date
         AND usage.created_at <= $5::timestamptz
       UNION ALL
       SELECT usage.model,
              usage.id::text AS source_id,
              coalesce(valuation.estimated_cost_cny, 0)::numeric(20,6) AS estimated_cost_cny,
              valuation.operational_usage_record_id IS NULL
                OR valuation.pricing_status <> 'priced'
                OR valuation.estimated_cost_cny IS NULL AS unpriced,
              valuation.price_version
       FROM provider_operational_usage_records usage
       LEFT JOIN latest_valuation valuation
         ON valuation.operational_usage_record_id = usage.id
       WHERE usage.provider = $1
         AND usage.service_type = 'video'
         AND usage.model = ANY($2::text[])
         AND usage.local_accounting_date BETWEEN $3::date AND $4::date
         AND usage.recorded_at <= $5::timestamptz
     )
     SELECT model,
            count(*)::int AS call_count,
            coalesce(sum(estimated_cost_cny), 0)::numeric(20,6) AS estimated_cost_cny,
            count(*) FILTER (WHERE unpriced)::int AS unpriced_call_count,
            coalesce(array_agg(DISTINCT price_version ORDER BY price_version)
              FILTER (WHERE price_version IS NOT NULL), ARRAY[]::text[]) AS price_versions
     FROM operational_sources
     GROUP BY model`,
    [PROVIDER, models, selection.rangeStart, selection.rangeEnd, asOf],
  );
  const officialDetails = await readOfficialSnapshotAsOf(client, {
    start: selection.rangeStart,
    end: selection.rangeEnd,
    asOf,
    product: OFFICIAL_PRODUCT,
    models,
  });

  const snapshot = accountSyncResult.rows[0];
  const sync = buildSync(parseSyncRows(snapshot?.sync_runs), asOf);
  const balance = parseBalanceRow(snapshot?.balance);
  const account = buildAccountBalance(balance, sync);
  const selectionDates = enumerateDates(selection.rangeStart, selection.rangeEnd);
  const official = summarizeOfficialUsage(officialDetails.details, selectionDates, true, models);
  const billSync = sync.items.find(item => item.kind === 'bill');
  const officialAvailable = Boolean(billSync?.status === 'fresh' && officialDetails.coverageComplete);
  const aggregates = operationsResult.rows;
  const total = aggregates.find(row => row.total_row) ?? emptyOperationsAggregate();
  const timingShiftCost = cnyMicros(total.timing_shift_cost_cny);
  const aggregateByModel = new Map(
    aggregates
      .filter((row): row is BusinessOperationsAggregateRow & { model: string } => !row.total_row && Boolean(row.model))
      .map(row => [row.model, row] as const),
  );
  const operationalByModel = new Map(
    operationalResult.rows.map(row => [row.model, row] as const),
  );
  // 主看盘是经营目录，不是“本期有数据才出现”的排行榜。即使所选周期没有任务，
  // 也必须按目录顺序返回所选模型；单模型筛选则只返回该模型。
  const operatingModels = models
    .slice()
    .sort((left, right) => seedanceCostModelOrder(left) - seedanceCostModelOrder(right))
    .map(model => mapOperationsModelAggregate(
      aggregateByModel.get(model) ?? emptyOperationsModelAggregate(model),
      operationalByModel.get(model),
    ));
  const businessEstimatedCost = cnyMicros(total.estimated_cost_cny);
  const operationalCallCount = operationalResult.rows.reduce(
    (sum, row) => sum + toInt(row.call_count), 0,
  );
  const operationalUnpricedCallCount = operationalResult.rows.reduce(
    (sum, row) => sum + toInt(row.unpriced_call_count), 0,
  );
  const operationalEstimatedCost = operationalResult.rows.reduce(
    (sum, row) => sum + cnyMicros(row.estimated_cost_cny), 0n,
  );
  const adminDirectEstimatedCost = cnyMicros(total.admin_direct_estimated_cost_cny);
  const knownAccountCost = businessEstimatedCost + operationalEstimatedCost;
  const incompleteTaskCount = toInt(total.incomplete_task_count);
  const officialEquivalent = officialAvailable && toInt(official.unpriced_rows) === 0
    ? cnyMicros(official.list_equivalent_cost_cny)
    : null;
  const reconciliation = resolveBusinessReconciliationStatus({
    incompleteTaskCount: incompleteTaskCount + operationalUnpricedCallCount,
    estimatedCostMicros: knownAccountCost,
    officialEquivalentMicros: officialEquivalent,
    timingShiftCostMicros: timingShiftCost,
  });
  return {
    asOf,
    selection,
    account,
    sync,
    operations: {
      taskCount: toInt(total.task_count),
      userCount: toInt(total.user_count),
      settledCredits: toInt(total.settled_credits),
      heldCredits: toInt(total.held_credits),
      refundedCredits: toInt(total.refunded_credits),
      estimatedCostCny: formatCnyMicros(knownAccountCost),
      businessEstimatedCostCny: formatCnyMicros(businessEstimatedCost),
      operationalCallCount,
      operationalEstimatedCostCny: formatCnyMicros(operationalEstimatedCost),
      operationalUnpricedCallCount,
      adminDirectUsageCount: toInt(total.admin_direct_usage_count),
      adminDirectEstimatedCostCny: formatCnyMicros(adminDirectEstimatedCost),
      knownAccountCostCny: formatCnyMicros(knownAccountCost),
      estimateCompleteness: aggregateEstimateCompleteness(
        incompleteTaskCount + operationalUnpricedCallCount,
        knownAccountCost,
      ),
      incompleteTaskCount,
      unresolvedTaskCount: toInt(total.unresolved_task_count),
      pendingFinalBillTaskCount: toInt(total.pending_final_bill_task_count),
      approvedZeroCostTaskCount: toInt(total.approved_zero_cost_task_count),
      officialEquivalentCostCny: officialEquivalent === null ? null : formatCnyMicros(officialEquivalent),
      differenceCny: reconciliation.difference === null ? null : formatCnyMicros(reconciliation.difference),
      officialPayableCny: officialAvailable ? nullableCny(official.payable_amount_cny) : null,
      reconciliationStatus: reconciliation.status,
    },
    models: operatingModels,
  };
}

/** 管理页 GET 只读取最近一次成功快照，不在请求链路调用供应商。 */
export async function getAdminApiCostDashboard(client: DbClient, rawQuery: CostDashboardFilters | unknown = {}) {
  const asOf = resolveAsOf(rawQuery);
  const models = resolveSelectedModels(rawQuery);
  const selectedModel = models.length === 1 ? models[0] : undefined;
  const observedCoverage = await readObservedCoverage(client, asOf, selectedModel);
  // 无套餐预测是全账户现金覆盖能力，不得随模型筛选改变覆盖分母。
  const projectionObservedCoverage = selectedModel
    ? await readObservedCoverage(client, asOf)
    : observedCoverage;
  const selection = resolveCostSelection(rawQuery, observedCoverage, asOf);
  const comparable = resolveComparableWindow(selection, observedCoverage);
  const todayBoundaries = beijingDateBoundaries(asOf);
  const today = todayBoundaries.today;
  const monthStart = todayBoundaries.monthStart;
  const tomorrow = todayBoundaries.tomorrow;
  const selectionDates = enumerateDates(selection.rangeStart, selection.rangeEnd);
  const localSelectionDates = resolveLocalSelectionDates(selection, observedCoverage);
  const hasComparableRange = Boolean(comparable.start && comparable.end);
  const balanceResult = await client.query<BalanceRow>(
      `SELECT provider, available_balance_cny, cash_balance_cny, frozen_amount_cny,
              arrears_balance_cny, credit_limit_cny, currency, synced_at
       FROM provider_account_balance_snapshots
       WHERE provider = 'volcengine-ark' AND synced_at <= $1
       ORDER BY synced_at DESC, id DESC
       LIMIT 1`,
      [asOf],
    );
  const syncResult = await client.query<SyncRunRow>(
      `WITH ranked AS (
         SELECT CASE WHEN kind LIKE 'bill%' THEN 'bill' ELSE kind END AS kind,
                CASE WHEN completed_at > $1::timestamptz THEN 'running' ELSE status END AS status,
                window_end,
                CASE WHEN completed_at > $1::timestamptz THEN NULL ELSE error END AS error,
                started_at,
                CASE WHEN completed_at > $1::timestamptz THEN NULL ELSE completed_at END AS completed_at,
                max(completed_at) FILTER (
                  WHERE status = 'success' AND completed_at <= $1::timestamptz
                ) OVER (
                  PARTITION BY CASE WHEN kind LIKE 'bill%' THEN 'bill' ELSE kind END
                ) AS last_success_at,
                max(window_end) FILTER (
                  WHERE status = 'success' AND completed_at <= $1::timestamptz
                ) OVER (
                  PARTITION BY CASE WHEN kind LIKE 'bill%' THEN 'bill' ELSE kind END
                ) AS last_success_window_end,
                row_number() OVER (
                  PARTITION BY CASE WHEN kind LIKE 'bill%' THEN 'bill' ELSE kind END
                  ORDER BY started_at DESC, id DESC
                ) AS row_number
         FROM provider_billing_sync_runs
         WHERE provider = 'volcengine-ark' AND started_at <= $1
       )
       SELECT kind, status, window_end, error, started_at, completed_at,
              last_success_at, last_success_window_end
       FROM ranked
       WHERE row_number = 1`,
      [asOf],
    );
  const localSummaryResult = await client.query<LocalSummaryRow>(
      `SELECT coalesce(sum(billable_tokens) FILTER (
                WHERE coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($4::date[])
              ), 0)::bigint AS billable_tokens,
              coalesce(sum(estimated_cost) FILTER (
                WHERE coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($4::date[])
              ), 0)::numeric(20,6) AS estimated_cost_cny,
              coalesce(sum(billable_tokens) FILTER (
                WHERE usage_evidence_origin <> 'official-bill-inferred'
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($4::date[])
              ), 0)::bigint AS raw_billable_tokens,
              coalesce(sum(estimated_cost) FILTER (
                WHERE usage_evidence_origin <> 'official-bill-inferred'
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($4::date[])
              ), 0)::numeric(20,6) AS raw_estimated_cost_cny,
              coalesce(sum(billable_tokens) FILTER (
                WHERE usage_evidence_origin = 'official-bill-inferred'
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($4::date[])
              ), 0)::bigint AS inferred_adjustment_tokens,
              coalesce(sum(estimated_cost) FILTER (
                WHERE usage_evidence_origin = 'official-bill-inferred'
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($4::date[])
              ), 0)::numeric(20,6) AS inferred_adjustment_cost_cny,
              count(*) FILTER (
                WHERE billable_tokens > 0
                  AND (estimated_cost IS NULL OR pricing_rule_status <> 'priced'
                  OR pricing_resolution_band = 'unknown' OR pricing_input_class = 'unknown'
                  OR unit_price_per_million IS NULL)
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($4::date[])
              )::int AS unpriced_attempts,
              coalesce(sum(billable_tokens) FILTER (
                WHERE billable_tokens > 0
                  AND (estimated_cost IS NULL OR pricing_rule_status <> 'priced'
                  OR pricing_resolution_band = 'unknown' OR pricing_input_class = 'unknown'
                  OR unit_price_per_million IS NULL)
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($4::date[])
              ), 0)::bigint AS unpriced_tokens,
              count(*) FILTER (
                WHERE billable_tokens IS NULL
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($4::date[])
              )::int AS unavailable_usage_attempts,
              coalesce(sum(billable_tokens) FILTER (
                WHERE coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($5::date[])
              ), 0)::bigint AS comparable_billable_tokens,
              coalesce(sum(estimated_cost) FILTER (
                WHERE coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($5::date[])
              ), 0)::numeric(20,6) AS comparable_estimated_cost_cny,
              coalesce(sum(billable_tokens) FILTER (
                WHERE usage_evidence_origin <> 'official-bill-inferred'
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($5::date[])
              ), 0)::bigint AS comparable_raw_billable_tokens,
              coalesce(sum(estimated_cost) FILTER (
                WHERE usage_evidence_origin <> 'official-bill-inferred'
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($5::date[])
              ), 0)::numeric(20,6) AS comparable_raw_estimated_cost_cny,
              coalesce(sum(billable_tokens) FILTER (
                WHERE usage_evidence_origin = 'official-bill-inferred'
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($5::date[])
              ), 0)::bigint AS comparable_inferred_adjustment_tokens,
              coalesce(sum(estimated_cost) FILTER (
                WHERE usage_evidence_origin = 'official-bill-inferred'
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($5::date[])
              ), 0)::numeric(20,6) AS comparable_inferred_adjustment_cost_cny,
              count(*) FILTER (
                WHERE billable_tokens > 0
                  AND (estimated_cost IS NULL OR pricing_rule_status <> 'priced'
                  OR pricing_resolution_band = 'unknown' OR pricing_input_class = 'unknown'
                  OR unit_price_per_million IS NULL)
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($5::date[])
              )::int AS comparable_unpriced_attempts,
              coalesce(sum(billable_tokens) FILTER (
                WHERE billable_tokens > 0
                  AND (estimated_cost IS NULL OR pricing_rule_status <> 'priced'
                  OR pricing_resolution_band = 'unknown' OR pricing_input_class = 'unknown'
                  OR unit_price_per_million IS NULL)
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($5::date[])
              ), 0)::bigint AS comparable_unpriced_tokens,
              count(*) FILTER (
                WHERE billable_tokens IS NULL
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($5::date[])
              )::int AS comparable_unavailable_usage_attempts,
              coalesce(sum(estimated_cost) FILTER (
                WHERE coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) >= $6::date
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) < $7::date
              ), 0)::numeric(20,6) AS today_estimated_cost_cny,
              count(*) FILTER (
                WHERE billable_tokens > 0
                  AND (estimated_cost IS NULL OR pricing_rule_status <> 'priced'
                  OR pricing_resolution_band = 'unknown' OR pricing_input_class = 'unknown'
                  OR unit_price_per_million IS NULL)
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) >= $6::date
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) < $7::date
              )::int AS today_unpriced_attempts,
              coalesce(sum(billable_tokens) FILTER (
                WHERE billable_tokens > 0
                  AND (estimated_cost IS NULL OR pricing_rule_status <> 'priced'
                  OR pricing_resolution_band = 'unknown' OR pricing_input_class = 'unknown'
                  OR unit_price_per_million IS NULL)
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) >= $6::date
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) < $7::date
              ), 0)::bigint AS today_unpriced_tokens,
              count(*) FILTER (
                WHERE billable_tokens IS NULL
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) >= $6::date
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) < $7::date
              )::int AS today_unavailable_usage_attempts,
              coalesce(sum(estimated_cost) FILTER (
                WHERE coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) >= $8::date
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) < $7::date
              ), 0)::numeric(20,6) AS month_estimated_cost_cny,
              count(*) FILTER (
                WHERE billable_tokens > 0
                  AND (estimated_cost IS NULL OR pricing_rule_status <> 'priced'
                  OR pricing_resolution_band = 'unknown' OR pricing_input_class = 'unknown'
                  OR unit_price_per_million IS NULL)
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) >= $8::date
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) < $7::date
              )::int AS month_unpriced_attempts,
              coalesce(sum(billable_tokens) FILTER (
                WHERE billable_tokens > 0
                  AND (estimated_cost IS NULL OR pricing_rule_status <> 'priced'
                  OR pricing_resolution_band = 'unknown' OR pricing_input_class = 'unknown'
                  OR unit_price_per_million IS NULL)
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) >= $8::date
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) < $7::date
              ), 0)::bigint AS month_unpriced_tokens,
              count(*) FILTER (
                WHERE billable_tokens IS NULL
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) >= $8::date
                  AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) < $7::date
              )::int AS month_unavailable_usage_attempts
       FROM provider_usage_records
       WHERE provider = $1
         AND model = ANY($2::text[])
         AND usage_unit = 'tokens'
         AND currency = 'CNY'
         AND created_at <= $3`,
      [PROVIDER, models, asOf, localSelectionDates, comparable.dates, today, tomorrow, monthStart],
    );
  const officialDetails = await readOfficialDetailsAsOf(client, {
    start: selection.rangeStart, end: selection.rangeEnd, asOf,
    product: OFFICIAL_PRODUCT, models,
  });
  const averageDetails = await readOfficialDetailsAsOf(client, {
    start: shiftDate(today, -6), end: today, asOf,
  });
  const localModelsResult = await client.query<LocalModelRow>(
      `SELECT model,
              coalesce(sum(billable_tokens), 0)::bigint AS billable_tokens,
              coalesce(sum(estimated_cost), 0)::numeric(20,6) AS estimated_cost_cny,
              count(*)::int AS attempt_count,
              count(DISTINCT task_id)::int AS task_count,
              count(DISTINCT task_id) FILTER (WHERE status = 'success')::int AS successful_video_count,
              (SELECT CASE
                        WHEN count(*) > 0 AND count(outputs.duration_seconds) = count(*)
                          THEN sum(outputs.duration_seconds)::numeric
                        ELSE NULL
                      END
               FROM (
                 SELECT DISTINCT ON (successful_usage.task_id)
                        CASE
                          WHEN output_asset.duration_seconds > 0
                           AND output_asset.generation_meta->>'durationSource' = 'media-probe'
                            THEN output_asset.duration_seconds
                          ELSE NULL
                        END AS duration_seconds
                 FROM provider_usage_records successful_usage
                 LEFT JOIN generation_tasks success_task ON success_task.id = successful_usage.task_id
                 LEFT JOIN assets output_asset
                   ON output_asset.id = success_task.asset_id AND output_asset.created_at <= $4
                 WHERE successful_usage.provider = $1
                   AND successful_usage.model = usage.model
                   AND successful_usage.usage_unit = 'tokens'
                   AND successful_usage.currency = 'CNY'
                   AND successful_usage.status = 'success'
                   AND successful_usage.created_at <= $4
                   AND coalesce(
                     successful_usage.local_accounting_date,
                     (coalesce(successful_usage.completed_at, successful_usage.created_at)
                       AT TIME ZONE 'Asia/Shanghai')::date
                   ) = ANY($3::date[])
                 ORDER BY successful_usage.task_id,
                          coalesce(successful_usage.completed_at, successful_usage.created_at) DESC,
                          successful_usage.id DESC
               ) outputs) AS successful_output_seconds,
              count(*) FILTER (WHERE status = 'success')::int AS successful_tasks,
              count(*) FILTER (WHERE status <> 'success')::int AS failed_tasks,
              coalesce(sum(billable_tokens) FILTER (WHERE status <> 'success'), 0)::bigint AS failed_billable_tokens,
              coalesce(sum(estimated_cost) FILTER (WHERE status <> 'success'), 0)::numeric(20,6) AS failed_estimated_cost_cny,
              coalesce(sum(estimated_cost) FILTER (WHERE status = 'success'), 0)::numeric(20,6) AS successful_estimated_cost_cny,
              coalesce(sum(estimated_cost) FILTER (WHERE pricing_input_class = 'without-video'), 0)::numeric(20,6) AS without_video_cost_cny,
              coalesce(sum(estimated_cost) FILTER (WHERE pricing_input_class = 'with-video'), 0)::numeric(20,6) AS with_video_cost_cny,
              count(*) FILTER (WHERE billable_tokens > 0 AND (
                estimated_cost IS NULL OR pricing_rule_status <> 'priced'
                OR pricing_resolution_band = 'unknown' OR pricing_input_class = 'unknown'
                OR unit_price_per_million IS NULL
              ))::int AS unpriced_tasks,
              count(*) FILTER (WHERE billable_tokens IS NULL)::int AS unavailable_usage_attempts
       FROM provider_usage_records usage
       WHERE provider = $1
         AND model = ANY($2::text[])
         AND usage_unit = 'tokens'
         AND currency = 'CNY'
         AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($3::date[])
         AND created_at <= $4
       GROUP BY model`,
      [PROVIDER, models, localSelectionDates, asOf],
    );
  const localDailyResult = await client.query<DailyRow>(
      `SELECT CASE WHEN $6 = 'month'
                    THEN date_trunc('month', coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date))::date
                    ELSE coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date)
              END AS day,
              coalesce(sum(billable_tokens), 0)::bigint AS billable_tokens,
              coalesce(sum(estimated_cost), 0)::numeric(20,6) AS estimated_cost_cny,
              count(*) FILTER (WHERE billable_tokens > 0 AND (
                estimated_cost IS NULL OR pricing_rule_status <> 'priced'
                OR pricing_resolution_band = 'unknown' OR pricing_input_class = 'unknown'
                OR unit_price_per_million IS NULL
              ))::int AS unpriced_attempts,
              count(*) FILTER (WHERE billable_tokens IS NULL)::int AS unavailable_usage_attempts
       FROM provider_usage_records
       WHERE provider = $1
         AND model = ANY($2::text[])
         AND usage_unit = 'tokens'
         AND currency = 'CNY'
         AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) >= $3::date
         AND coalesce(local_accounting_date, (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date) < $4::date
         AND created_at <= $5
       GROUP BY day ORDER BY day`,
      [PROVIDER, models, selection.rangeStart, shiftDate(selection.rangeEnd, 1), asOf, selection.grain],
    );
  const pricingResult = await client.query<PricingRow>(
      `SELECT model, resolution, has_video_input, unit_price_per_million, price_version, effective_from
       FROM provider_pricing_rules
       WHERE provider = $1
         AND model = ANY($2::text[])
         AND effective_from <= $3
         AND (effective_to IS NULL OR effective_to > $3)
       ORDER BY effective_from DESC, model, resolution, has_video_input`,
      [PROVIDER, models, asOf],
    );
  const packageResult = await client.query<PackageRow>(
      `WITH latest AS (
         SELECT DISTINCT ON (package_id)
                id, package_id, product, config, recognized_model, status,
                total_quota, remaining_quota, starts_at, expires_at, captured_at
         FROM provider_resource_package_snapshots
         WHERE provider = $1 AND recognized_model = ANY($2::text[]) AND captured_at <= $3
         ORDER BY package_id, captured_at DESC, id DESC
       )
       SELECT id, package_id, product, config, recognized_model, status, total_quota,
              remaining_quota, starts_at, expires_at
       FROM latest
       WHERE total_quota > 0
         AND lower(status) NOT IN ('stale', 'expired')
         AND (starts_at IS NULL OR starts_at <= $3)
         AND (expires_at IS NULL OR expires_at > $3)
       ORDER BY starts_at DESC NULLS LAST, expires_at DESC NULLS LAST, package_id DESC`,
      [PROVIDER, models, asOf],
    );
  const timingAdjustmentResult = await client.query<TimingAdjustmentRow>(
      `SELECT
         coalesce(sum(CASE
           WHEN official_expense_date = ANY($2::date[])
             AND (local_accounting_date IS NULL OR NOT (local_accounting_date = ANY($2::date[])))
             THEN token_adjustment
           WHEN local_accounting_date = ANY($2::date[])
             AND (official_expense_date IS NULL OR NOT (official_expense_date = ANY($2::date[])))
             THEN -token_adjustment
           ELSE 0 END), 0)::bigint AS timing_tokens,
         coalesce(sum(CASE
           WHEN official_expense_date = ANY($2::date[])
             AND (local_accounting_date IS NULL OR NOT (local_accounting_date = ANY($2::date[])))
             THEN cost_adjustment_cny
           WHEN local_accounting_date = ANY($2::date[])
             AND (official_expense_date IS NULL OR NOT (official_expense_date = ANY($2::date[])))
             THEN -cost_adjustment_cny
           ELSE 0 END), 0)::numeric(20,6) AS timing_cost_cny
       FROM provider_reconciliation_cases
       WHERE provider = $1 AND case_type = 'cross-date' AND status = 'approved' AND created_at <= $3`,
      [PROVIDER, comparable.dates, asOf],
    );
  const packageLedgerResult = await readPackageLedgerSummary(client, selection, asOf);
  const businessTasksResult = await client.query<BusinessTaskCostRow>(
      `${BUSINESS_TASK_COST_CTE}
       SELECT * FROM business_task_costs
       ORDER BY created_at DESC, id DESC`,
      [PROVIDER, models, selection.rangeStart, selection.rangeEnd, asOf],
    );

  const sync = buildSync(syncResult.rows);
  const balance = balanceResult.rows[0];
  const account = {
    provider: PROVIDER,
    currency: 'CNY' as const,
    availableBalanceCny: balance ? formatCny(balance.available_balance_cny) : null,
    cashBalanceCny: balance ? formatCny(balance.cash_balance_cny) : null,
    frozenAmountCny: balance ? formatCny(balance.frozen_amount_cny) : null,
    arrearsBalanceCny: balance ? formatCny(balance.arrears_balance_cny) : null,
    creditLimitCny: balance ? formatCny(balance.credit_limit_cny) : null,
    syncedAt: balance ? toIsoDateTime(balance.synced_at) : '-',
    status: sync.items.find(item => item.kind === 'balance')?.status ?? 'never-synced' as const,
  };

  const local = localSummaryResult.rows[0] ?? {} as LocalSummaryRow;
  const comparableOfficial = summarizeOfficialUsage(
    officialDetails, comparable.dates, hasComparableRange, models,
  );
  const selectedOfficial = summarizeOfficialUsage(officialDetails, selectionDates, true, models);
  // 无套餐预测是账户现金覆盖能力，必须始终替换全部 Seedance 用量，不能随看盘模型筛选漂移。
  const averages = summarizeOfficialAverage(averageDetails, [...SEEDANCE_COST_MODEL_LABELS]);
  const settlementRow = summarizeOfficialSettlement(officialDetails);
  const officialModels = summarizeOfficialModels(officialDetails, selectionDates, true);
  const officialDaily = summarizeOfficialDaily(officialDetails, selection);
  const timingRow = timingAdjustmentResult.rows[0] ?? {} as TimingAdjustmentRow;
  const packageLedgerRow = packageLedgerResult;
  const selectedLocalCost = cnyMicros(local.estimated_cost_cny);
  const selectedLocalTokens = toInt(local.billable_tokens);
  const selectedLocalUnpricedAttempts = toInt(local.unpriced_attempts);
  const selectedLocalUnpricedTokens = toInt(local.unpriced_tokens);
  const selectedLocalUnavailableUsageAttempts = toInt(local.unavailable_usage_attempts);
  const comparableLocalCost = cnyMicros(local.comparable_estimated_cost_cny);
  const comparableRawLocalCost = cnyMicros(local.comparable_raw_estimated_cost_cny);
  const comparableInferredAdjustmentCost = cnyMicros(local.comparable_inferred_adjustment_cost_cny);
  const comparableLocalUnpricedAttempts = toInt(local.comparable_unpriced_attempts);
  const comparableLocalUnavailableUsageAttempts = toInt(local.comparable_unavailable_usage_attempts);
  const comparableOfficialListCost = cnyMicros(comparableOfficial.list_equivalent_cost_cny);
  const timingCost = cnyMicros(timingRow.timing_cost_cny);
  const costDelta = comparableOfficialListCost - comparableLocalCost - timingCost;
  const comparableOfficialTokens = toInt(comparableOfficial.billable_tokens);
  const comparableLocalTokens = toInt(local.comparable_billable_tokens);
  const comparableRawLocalTokens = toInt(local.comparable_raw_billable_tokens);
  const comparableInferredAdjustmentTokens = toInt(local.comparable_inferred_adjustment_tokens);
  const timingTokens = toInt(timingRow.timing_tokens);
  const residualTokens = comparableOfficialTokens - comparableLocalTokens - timingTokens;
  const projectionCoveredDays = countCoveredDays(
    projectionObservedCoverage.officialIntervals, shiftDate(today, -6), today,
  );
  const projectionUnpricedRows = toInt(averages.seedance_unpriced_rows);
  const projectionUnpricedTokens = toInt(averages.seedance_unpriced_tokens);
  const projectionDivisor = BigInt(projectionCoveredDays);
  const allAccountDaily = projectionCoveredDays > 0 && averages.all_account_payable_cny !== null
    ? divideRounded(cnyMicros(averages.all_account_payable_cny), projectionDivisor) : null;
  const seedanceOfficialDaily = projectionCoveredDays > 0 && averages.seedance_payable_cny !== null
    ? divideRounded(cnyMicros(averages.seedance_payable_cny), projectionDivisor) : null;
  const seedanceListDaily = projectionCoveredDays > 0 && projectionUnpricedRows === 0
    && averages.seedance_list_cost_cny !== null
    ? divideRounded(cnyMicros(averages.seedance_list_cost_cny), projectionDivisor) : null;
  const noPackageDaily = allAccountDaily !== null && seedanceOfficialDaily !== null && seedanceListDaily !== null
    ? maxMicros(0n, allAccountDaily - seedanceOfficialDaily + seedanceListDaily) : null;
  const availableBalance = account.availableBalanceCny === null
    ? null : maxMicros(0n, cnyMicros(account.availableBalanceCny));
  const billStale = sync.items.find(item => item.kind === 'bill')?.status !== 'fresh';
  const coverage = buildCoverage(selection, observedCoverage, comparable, billStale);
  const selectedLocalAvailable = localSelectionDates.length > 0;
  const selectedOfficialAvailable = selectionDates.some(day => observedCoverage.officialIntervals.some(interval => (
    day >= interval.start && day <= interval.end
  )));
  const selectedOfficialComplete = selectionDates.length > 0 && selectionDates.every(day => (
    observedCoverage.officialIntervals.some(interval => day >= interval.start && day <= interval.end)
  ));
  const operations = buildOperationsSummary(
    businessTasksResult.rows,
    selectedOfficial,
    selectedOfficialComplete && !billStale,
    cnyMicros(timingRow.timing_cost_cny),
    models,
  );
  const todayLocalAvailable = observedCoverage.localIntervals.some(interval => (
    today >= interval.start && today <= interval.end
  ));
  const monthDates = enumerateDates(monthStart, today);
  const monthLocalAvailable = monthDates.every(day => observedCoverage.localIntervals.some(interval => (
    day >= interval.start && day <= interval.end
  )));
  const reconciliationBillState = resolveOfficialBillState(comparable.dates, observedCoverage.officialIntervals);
  const selectedOfficialBillState = resolveCoveredOfficialBillState(
    selectionDates, observedCoverage.officialIntervals,
  );
  const comparableLocalComplete = hasComparableRange
    && comparableLocalUnpricedAttempts === 0
    && comparableLocalUnavailableUsageAttempts === 0;
  const comparableOfficialComplete = hasComparableRange
    && toInt(comparableOfficial.unpriced_rows) === 0;
  const comparableComplete = comparableLocalComplete && comparableOfficialComplete;
  const matchState = !comparableComplete
    ? 'cannot-reconcile' as const
    : residualTokens === 0 && costDelta === 0n
      ? (comparableOfficialTokens === comparableRawLocalTokens
          && comparableOfficialListCost === comparableRawLocalCost
        ? 'raw-matched' as const : 'adjusted-matched' as const)
      : 'residual' as const;
  const combinedStatus = {
    billState: reconciliationBillState,
    matchState,
    coverageState: coverage.comparable.status,
    label: combinedStatusLabel(reconciliationBillState, matchState),
  };
  const settlementListPrice = summarizeListPrice(officialDetails);
  const selectedUsageDetails = officialDetails.filter(item => item.billLineType === 'usage');
  // DeductionCount 是供应商资源包抵扣量证据，官方可返回小数 token。
  // 现有摘要契约只能传整数；任一行缺失或为非整数时，整个汇总保持 NULL，
  // 详情仍保留精确 decimal string，不把小数截断或伪造为 0。
  const selectedDeductedTokens = sumWholeTokenDecimalsOrNull(
    selectedUsageDetails,
    item => item.deductionCount,
  );
  const settlementBook = buildSettlementBook(
    settlementRow, packageLedgerRow, settlementListPrice, selection, coverage.official,
  );

  return {
    asOf,
    selection,
    coverage,
    currentState: {
      capturedAt: asOf,
      balanceSnapshotAt: balance ? toIsoDateTime(balance.synced_at) : '-',
      packageSnapshotAt: sync.items.find(item => item.kind === 'packages')?.lastSuccessAt ?? '-',
      historicalFilterAppliedToAccount: false as const,
      historicalFilterAppliedToPackages: false as const,
      historicalFilterAppliedToPricing: false as const,
    },
    combinedStatus,
    books: {
      usage: {
        rawLocalTokens: hasComparableRange ? comparableRawLocalTokens : null,
        inferredAdjustmentTokens: hasComparableRange ? comparableInferredAdjustmentTokens : null,
        adjustedLocalTokens: hasComparableRange ? comparableLocalTokens : null,
        officialTokens: hasComparableRange ? comparableOfficialTokens : null,
        rawTokenDelta: hasComparableRange ? comparableOfficialTokens - comparableRawLocalTokens : null,
        explainedTokenDelta: hasComparableRange ? comparableInferredAdjustmentTokens : null,
        timingShiftTokens: hasComparableRange ? timingTokens : null,
        residualTokens: hasComparableRange ? residualTokens : null,
        rawCoveragePercent: hasComparableRange
          ? coveragePercent(comparableRawLocalTokens, comparableOfficialTokens) : null,
        adjustedCoveragePercent: hasComparableRange
          ? coveragePercent(comparableLocalTokens + timingTokens, comparableOfficialTokens) : null,
      },
      valuation: {
        localEstimateCompleteness: estimateCompleteness(
          hasComparableRange, comparableLocalUnpricedAttempts,
          comparableLocalUnavailableUsageAttempts,
        ),
        officialEstimateCompleteness: estimateCompleteness(
          hasComparableRange, toInt(comparableOfficial.unpriced_rows), 0,
        ),
        rawLocalCostCny: hasComparableRange ? formatCnyMicros(comparableRawLocalCost) : null,
        inferredAdjustmentCostCny: hasComparableRange
          ? formatCnyMicros(comparableInferredAdjustmentCost) : null,
        adjustedLocalCostCny: hasComparableRange ? formatCnyMicros(comparableLocalCost) : null,
        officialListEquivalentCostCny: hasComparableRange
          ? formatCnyMicros(comparableOfficialListCost) : null,
        rawCostDeltaCny: comparableComplete
          ? formatCnyMicros(comparableOfficialListCost - comparableRawLocalCost) : null,
        explainedCostDeltaCny: hasComparableRange
          ? formatCnyMicros(comparableInferredAdjustmentCost) : null,
        timingShiftCostCny: hasComparableRange ? formatCnyMicros(timingCost) : null,
        rateVarianceCny: null,
        roundingVarianceCny: null,
        residualCostCny: comparableComplete ? formatCnyMicros(costDelta) : null,
      },
      settlement: settlementBook,
    },
    account,
    sync,
    summary: {
      rangeStart: selection.rangeStart,
      rangeEnd: selection.rangeEnd,
      timezone: 'Asia/Shanghai' as const,
      billStatus: selectedOfficialBillState === 'final' ? 'final' as const
        : selectedOfficialBillState === 'unavailable' ? 'unavailable' as const : 'provisional' as const,
      localBillableTokens: selectedLocalAvailable ? selectedLocalTokens : null,
      localEstimatedCostCny: selectedLocalAvailable ? formatCnyMicros(selectedLocalCost) : null,
      localEstimateCompleteness: estimateCompleteness(
        selectedLocalAvailable, selectedLocalUnpricedAttempts,
        selectedLocalUnavailableUsageAttempts,
      ),
      localUnpricedAttempts: selectedLocalAvailable ? selectedLocalUnpricedAttempts : null,
      localUnpricedTokens: selectedLocalAvailable ? selectedLocalUnpricedTokens : null,
      localUnavailableUsageAttempts: selectedLocalAvailable
        ? selectedLocalUnavailableUsageAttempts : null,
      officialBillableTokens: !selectedOfficialAvailable
        ? null : toInt(selectedOfficial.billable_tokens),
      officialUnpricedRows: !selectedOfficialAvailable
        ? null : toInt(selectedOfficial.unpriced_rows),
      officialUnpricedTokens: !selectedOfficialAvailable
        ? null : toInt(selectedOfficial.unpriced_tokens),
      officialListEquivalentCostCny: !selectedOfficialAvailable
        || toInt(selectedOfficial.unpriced_rows) > 0
        ? null : formatCny(selectedOfficial.list_equivalent_cost_cny),
      officialOriginalBillAmountCny: coverage.official.status === 'unavailable'
        ? null : nullableCny(settlementRow.usage_original_amount_cny),
      officialPayableAmountCny: coverage.official.status === 'unavailable'
        ? null : nullableCny(settlementRow.usage_payable_amount_cny),
      officialPaidAmountCny: coverage.official.status === 'unavailable'
        ? null : nullableCny(settlementRow.usage_paid_amount_cny),
      officialUnpaidAmountCny: coverage.official.status === 'unavailable'
        ? null : nullableCny(settlementRow.usage_unpaid_amount_cny),
      officialDiscountAmountCny: coverage.official.status === 'unavailable'
        || settlementListPrice.cost === null || settlementRow.usage_payable_amount_cny === null
        ? null : formatCnyMicros(maxMicros(0n,
          settlementListPrice.cost - cnyMicros(settlementRow.usage_payable_amount_cny))),
      resourcePackageDeductedTokens: coverage.official.status === 'unavailable' ? null : selectedDeductedTokens,
      todayEstimatedCostCny: todayLocalAvailable ? formatCny(local.today_estimated_cost_cny) : null,
      todayEstimateCompleteness: estimateCompleteness(
        todayLocalAvailable, toInt(local.today_unpriced_attempts),
        toInt(local.today_unavailable_usage_attempts),
      ),
      todayUnpricedAttempts: todayLocalAvailable ? toInt(local.today_unpriced_attempts) : null,
      todayUnavailableUsageAttempts: todayLocalAvailable
        ? toInt(local.today_unavailable_usage_attempts) : null,
      monthEstimatedCostCny: monthLocalAvailable ? formatCny(local.month_estimated_cost_cny) : null,
      monthEstimateCompleteness: estimateCompleteness(
        monthLocalAvailable, toInt(local.month_unpriced_attempts),
        toInt(local.month_unavailable_usage_attempts),
      ),
      monthUnpricedAttempts: monthLocalAvailable ? toInt(local.month_unpriced_attempts) : null,
      monthUnavailableUsageAttempts: monthLocalAvailable
        ? toInt(local.month_unavailable_usage_attempts) : null,
      tokenDelta: hasComparableRange ? residualTokens : null,
      costDeltaCny: comparableComplete ? formatCnyMicros(costDelta) : null,
      localCostUnderstatementPercent: comparableComplete && comparableOfficialListCost > 0n
        ? round4(Number(costDelta * 1_000_000n / comparableOfficialListCost) / 10_000)
        : null,
      allAccountOfficialDailyAverageCny: allAccountDaily === null ? null : formatCnyMicros(allAccountDaily),
      seedanceOfficialDailyAverageCny: seedanceOfficialDaily === null ? null : formatCnyMicros(seedanceOfficialDaily),
      seedanceListDailyAverageCny: seedanceListDaily === null ? null : formatCnyMicros(seedanceListDaily),
      noPackageProjectedDailyCostCny: noPackageDaily === null ? null : formatCnyMicros(noPackageDaily),
      noPackageRunwayDays: availableBalance !== null && noPackageDaily !== null && noPackageDaily > 0n
        ? round2(Number(availableBalance) / Number(noPackageDaily))
        : null,
      noPackageProjectionCoveredDays: projectionCoveredDays,
      noPackageProjectionUnpricedRows: projectionUnpricedRows,
      noPackageProjectionUnpricedTokens: projectionUnpricedTokens,
      noPackageProjectionStatus: projectionCoveredDays === 0
        ? 'unavailable' as const : projectionUnpricedRows > 0 ? 'unpriced' as const
          : projectionCoveredDays < 7 ? 'partial' as const : 'complete' as const,
    },
    operations,
    models: buildModelBreakdown(
      localModelsResult.rows, officialModels, selectedLocalCost,
      selectedLocalAvailable, selectedOfficialAvailable,
    )
      .filter(item => models.includes(item.model)),
    daily: buildCostTrend(selection, localDailyResult.rows, officialDaily, observedCoverage),
    pricingRules: buildPricingRules(pricingResult.rows),
    packages: packageResult.rows.map(mapPackage),
  };
}

export async function listAdminApiCostAttempts(client: DbClient, rawQuery: unknown, authorizationScope = 'role:admin') {
  const query = await normalizeKeysetQuery<CostAttemptFilters>(client, rawQuery, 'admin-api-cost-attempts', authorizationScope);
  const observed = await readObservedCoverage(client, query.asOf, query.filters.model);
  const selection = resolveCostSelection(query.filters, observed, query.asOf);
  const localSelectionDates = resolveLocalSelectionDates(selection, observed);
  if (localSelectionDates.length === 0) return emptyCostPage(query, selection);
  const filter = buildCostFilter(query.filters, 1, query.asOf, localSelectionDates);
  const modelIndex = filter.values.length + 1;
  const cursorIndex = modelIndex + 1;
  const limitIndex = cursorIndex + 4;
  const cursor = query.cursor?.key ?? [];
  const result = await client.query<AttemptCostRow>(
    `WITH filtered_attempts AS (
       SELECT pur.id, pur.task_id, pur.provider_task_id, pur.attempt,
            CASE WHEN pur.initiated_by_admin_user_id IS NOT NULL
              THEN 'admin-direct' ELSE 'generation-task' END AS origin,
            u.id AS user_id, u.user_name, u.email, pur.provider, pur.model,
            pur.resolution, pur.has_video_input, gt.status AS task_status,
            pur.status AS usage_status, pur.completion_tokens, pur.total_tokens,
            pur.billable_tokens, pur.billable_basis, pur.unit_price_per_million,
            pur.estimated_cost, pur.price_version, pur.pricing_status,
            pur.usage_evidence_origin, pur.pricing_rule_status,
            pur.pricing_input_class, pur.pricing_resolution_band,
            pur.attribution_confidence, pur.local_accounting_date,
            pur.provider_terminal_at, pur.usage_observed_at,
            pur.created_at, pur.completed_at, pur.error
       FROM provider_usage_records pur
       LEFT JOIN generation_tasks gt ON gt.id = pur.task_id
       LEFT JOIN users u ON u.id = coalesce(gt.user_id, pur.initiated_by_admin_user_id)
       WHERE pur.provider = '${PROVIDER}'
         AND pur.model = ANY($${modelIndex}::text[])
         AND pur.usage_unit = 'tokens'
         AND pur.currency = 'CNY'
         AND (pur.task_id IS NOT NULL OR pur.initiated_by_admin_user_id IS NOT NULL)
         ${filter.sql}
         AND pur.created_at <= $${filter.values.length}::timestamptz
     ), page_attempts AS (
       SELECT pur.*,
              ${keysetPageTotalCountSql(query)} AS __pagination_total_count,
              ${exactUtcTimestampSql('coalesce(pur.completed_at, pur.created_at)')}
                AS __pagination_cursor_timestamp
       FROM filtered_attempts pur
       WHERE ($${cursorIndex}::numeric IS NULL OR (
         coalesce(pur.estimated_cost, -1::numeric),
         coalesce(pur.billable_tokens, -1::bigint),
         coalesce(pur.completed_at, pur.created_at),
         pur.id
       ) ${costKeysetOperator(query)} (
         $${cursorIndex}::numeric, $${cursorIndex + 1}::bigint,
         $${cursorIndex + 2}::timestamptz, $${cursorIndex + 3}::uuid
       ))
       ORDER BY coalesce(pur.estimated_cost, -1::numeric) ${costKeysetDirection(query)},
                coalesce(pur.billable_tokens, -1::bigint) ${costKeysetDirection(query)},
                coalesce(pur.completed_at, pur.created_at) ${costKeysetDirection(query)},
                pur.id ${costKeysetDirection(query)}
       LIMIT $${limitIndex}
     )
     SELECT pur.*,
            resolution.case_id AS cost_resolution_case_id,
            resolution.case_status AS cost_resolution_case_status,
            resolution.case_evidence AS cost_resolution_evidence
     FROM page_attempts pur
     LEFT JOIN LATERAL (
       SELECT cases.id AS case_id, cases.status AS case_status,
              cases.evidence AS case_evidence
       FROM (
         SELECT DISTINCT case_id
         FROM provider_reconciliation_case_links
         WHERE usage_record_id = pur.id
           AND created_at <= $${filter.values.length}::timestamptz
       ) links
       JOIN provider_reconciliation_cases cases ON cases.id = links.case_id
       WHERE cases.provider = '${PROVIDER}'
         AND cases.case_type = 'missing-local-usage'
         AND cases.evidence->>'resolutionKind' = 'zero-cost'
         AND cases.token_adjustment = 0
         AND cases.cost_adjustment_cny = 0
         AND cases.created_at <= $${filter.values.length}::timestamptz
       ORDER BY CASE cases.status WHEN 'approved' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
                cases.created_at DESC, cases.id DESC
       LIMIT 1
     ) resolution ON true
     ORDER BY coalesce(pur.estimated_cost, -1::numeric) ${costKeysetDirection(query)},
              coalesce(pur.billable_tokens, -1::bigint) ${costKeysetDirection(query)},
              coalesce(pur.completed_at, pur.created_at) ${costKeysetDirection(query)},
              pur.id ${costKeysetDirection(query)}`,
    [
    ...filter.values,
    [...SEEDANCE_COST_MODEL_LABELS],
      cursor[0] ?? null, cursor[1] ?? null, cursor[2] ?? null, cursor[3] ?? null,
      query.limit + 1,
    ],
  );
  const page = makeKeysetPage(result.rows, query, row => [
    row.estimated_cost === null ? '-1' : String(row.estimated_cost),
    row.billable_tokens === null ? '-1' : String(row.billable_tokens),
    normalizeCursorTimestamp(row.__pagination_cursor_timestamp),
    row.id,
  ], mapAttemptCost);
  return { asOf: query.asOf, selection, ...page };
}

export async function listAdminApiCostTasks(client: DbClient, rawQuery: unknown, authorizationScope = 'role:admin') {
  const query = await normalizeKeysetQuery<CostFilters>(client, rawQuery, 'admin-api-cost-tasks', authorizationScope);
  const selection = await resolveDirectCostSelection(client, query.filters, query.asOf);
  const models = resolveSelectedModels(query.filters);
  const filter = buildBusinessTaskFilter(query.filters, 6);
  const costStateCondition = buildBusinessTaskCostStateCondition(query.filters.costState);
  const values: unknown[] = [
    PROVIDER, models, selection.rangeStart, selection.rangeEnd, query.asOf, ...filter.values,
  ];
  const cursorIndex = values.length + 1;
  const limitIndex = cursorIndex + 2;
  const cursor = query.cursor?.key ?? [];
  const result = await client.query<BusinessTaskCostRow>(
    `${BUSINESS_TASK_COST_CTE}, page_tasks AS (
       SELECT task.*,
              ${keysetPageTotalCountSql(query)} AS __pagination_total_count,
              ${exactUtcTimestampSql('task.created_at')} AS __pagination_cursor_timestamp
       FROM business_task_costs task
       WHERE ${filter.sql || 'true'}
         AND ${costStateCondition}
         AND ($${cursorIndex}::timestamptz IS NULL OR (
           task.created_at, task.id
         ) ${costKeysetOperator(query)} ($${cursorIndex}::timestamptz, $${cursorIndex + 1}::uuid))
       ORDER BY task.created_at ${costKeysetDirection(query)}, task.id ${costKeysetDirection(query)}
       LIMIT $${limitIndex}
     )
     SELECT * FROM page_tasks task
     ORDER BY task.created_at ${costKeysetDirection(query)}, task.id ${costKeysetDirection(query)}`,
    [
      ...values, cursor[0] ?? null, cursor[1] ?? null,
      query.limit + 1,
    ],
  );
  const page = makeKeysetPage(result.rows, query, row => [
    normalizeCursorTimestamp(row.__pagination_cursor_timestamp), row.id,
  ], mapBusinessTaskCost);
  return { asOf: query.asOf, selection, ...page };
}

function buildBusinessTaskCostStateCondition(costState: CostFilters['costState']) {
  if (!costState) return 'true';
  if (costState === 'unfinalized') return "task.cost_resolution_status <> 'recorded' AND task.cost_resolution_status <> 'approved-zero'";
  return `task.cost_resolution_status = '${costState}'`;
}

export async function listAdminApiCostUsers(client: DbClient, rawQuery: unknown, authorizationScope = 'role:admin') {
  const query = await normalizeKeysetQuery<CostUserFilters>(client, rawQuery, 'admin-api-cost-users-v2', authorizationScope);
  const selection = await resolveDirectCostSelection(client, query.filters, query.asOf);
  const models = resolveSelectedModels(query.filters);
  const filter = buildBusinessTaskFilter(query.filters, 6);
  const values: unknown[] = [
    PROVIDER, models, selection.rangeStart, selection.rangeEnd, query.asOf, ...filter.values,
  ];
  let operationalSearchCondition = 'true';
  if (query.filters.search) {
    values.push(`%${query.filters.search}%`);
    operationalSearchCondition = `(
      owner.user_name ILIKE $${values.length}
      OR owner.email ILIKE $${values.length}
    )`;
  }
  const cursorIndex = values.length + 1;
  const limitIndex = cursorIndex + 4;
  const cursor = query.cursor?.key ?? [];
  const userCursorCondition = query.position === 'previous'
    ? `users.estimated_cost_cny > $${cursorIndex}::numeric
        OR (users.estimated_cost_cny = $${cursorIndex}::numeric AND users.task_count > $${cursorIndex + 1}::int)
        OR (users.estimated_cost_cny = $${cursorIndex}::numeric AND users.task_count = $${cursorIndex + 1}::int
            AND users.last_activity_at > $${cursorIndex + 2}::timestamptz)
        OR (users.estimated_cost_cny = $${cursorIndex}::numeric AND users.task_count = $${cursorIndex + 1}::int
            AND users.last_activity_at = $${cursorIndex + 2}::timestamptz AND users.id < $${cursorIndex + 3}::uuid)`
    : `users.estimated_cost_cny < $${cursorIndex}::numeric
        OR (users.estimated_cost_cny = $${cursorIndex}::numeric AND users.task_count < $${cursorIndex + 1}::int)
        OR (users.estimated_cost_cny = $${cursorIndex}::numeric AND users.task_count = $${cursorIndex + 1}::int
            AND users.last_activity_at < $${cursorIndex + 2}::timestamptz)
        OR (users.estimated_cost_cny = $${cursorIndex}::numeric AND users.task_count = $${cursorIndex + 1}::int
            AND users.last_activity_at = $${cursorIndex + 2}::timestamptz AND users.id > $${cursorIndex + 3}::uuid)`;
  const userOrder = query.reverseQuery
    ? 'users.estimated_cost_cny ASC, users.task_count ASC, users.last_activity_at ASC, users.id DESC'
    : 'users.estimated_cost_cny DESC, users.task_count DESC, users.last_activity_at DESC, users.id ASC';
  const result = await client.query<BusinessUserCostRow>(
    `${BUSINESS_TASK_COST_CTE}, latest_valuation AS (
       SELECT DISTINCT ON (valuation.operational_usage_record_id)
              valuation.operational_usage_record_id,
              valuation.pricing_status,
              valuation.estimated_cost_cny
       FROM provider_operational_usage_valuations valuation
       WHERE valuation.recorded_at <= $5::timestamptz
       ORDER BY valuation.operational_usage_record_id,
                valuation.recorded_at DESC, valuation.id DESC
     ), business_user_costs AS (
       SELECT task.user_id AS id, task.user_id, max(task.user_name) AS user_name,
              max(task.email) AS email, count(*)::int AS task_count,
              count(*) FILTER (WHERE task.status = 'completed')::int AS successful_tasks,
              count(*) FILTER (WHERE task.status = 'failed')::int AS failed_tasks,
              count(*) FILTER (WHERE task.status = 'canceled')::int AS canceled_tasks,
              coalesce(sum(task.settled_credits), 0)::bigint AS settled_credits,
              coalesce(sum(task.refunded_credits), 0)::bigint AS refunded_credits,
              coalesce(sum(task.billable_tokens), 0)::bigint AS billable_tokens,
              coalesce(sum(task.estimated_cost_cny), 0)::numeric(20,6) AS estimated_cost_cny,
              count(*) FILTER (WHERE NOT task.cost_finalized)::int AS incomplete_task_count,
              max(task.created_at) AS last_task_at
       FROM business_task_costs task
       WHERE ${filter.sql || 'true'}
       GROUP BY task.user_id
     ), operational_sources AS (
       SELECT usage.id::text AS source_id,
              usage.initiated_by_admin_user_id AS user_id,
              coalesce(usage.billable_tokens, 0)::bigint AS billable_tokens,
              coalesce(usage.estimated_cost, 0)::numeric(20,6) AS estimated_cost_cny,
              NOT (
                usage.billable_tokens IS NOT NULL
                AND (
                  usage.billable_tokens = 0
                  OR (usage.estimated_cost IS NOT NULL AND usage.pricing_rule_status = 'priced')
                )
              ) AS unpriced,
              coalesce(usage.provider_terminal_at, usage.completed_at, usage.created_at) AS occurred_at
       FROM provider_usage_records usage
       WHERE usage.provider = $1
         AND usage.model = ANY($2::text[])
         AND usage.usage_unit = 'tokens'
         AND usage.currency = 'CNY'
         AND usage.task_id IS NULL
         AND usage.initiated_by_admin_user_id IS NOT NULL
         AND usage.local_accounting_date BETWEEN $3::date AND $4::date
         AND usage.created_at <= $5::timestamptz
       UNION ALL
       SELECT usage.id::text AS source_id,
              usage.cost_owner_user_id AS user_id,
              CASE WHEN coalesce(usage.usage_evidence ->> 'billableTokens', '') ~ '^\\d+$'
                   THEN (usage.usage_evidence ->> 'billableTokens')::bigint ELSE 0 END,
              coalesce(valuation.estimated_cost_cny, 0)::numeric(20,6),
              valuation.operational_usage_record_id IS NULL
                OR valuation.pricing_status <> 'priced'
                OR valuation.estimated_cost_cny IS NULL AS unpriced,
              usage.occurred_at
       FROM provider_operational_usage_records usage
       LEFT JOIN latest_valuation valuation
         ON valuation.operational_usage_record_id = usage.id
       WHERE usage.provider = $1
         AND usage.service_type = 'video'
         AND usage.model = ANY($2::text[])
         AND usage.local_accounting_date BETWEEN $3::date AND $4::date
         AND usage.recorded_at <= $5::timestamptz
     ), operational_user_costs AS (
       SELECT source.user_id AS id, source.user_id,
              max(owner.user_name) AS user_name, max(owner.email) AS email,
              count(*)::int AS operational_call_count,
              coalesce(sum(source.billable_tokens), 0)::bigint AS billable_tokens,
              coalesce(sum(source.estimated_cost_cny), 0)::numeric(20,6) AS estimated_cost_cny,
              count(*) FILTER (WHERE source.unpriced)::int AS unpriced_call_count,
              max(source.occurred_at) AS last_activity_at
       FROM operational_sources source
       JOIN users owner ON owner.id = source.user_id
       WHERE ${operationalSearchCondition}
       GROUP BY source.user_id
     ), aggregated_users AS (
       SELECT coalesce(business.id, operational.id) AS id,
              coalesce(business.user_id, operational.user_id) AS user_id,
              coalesce(business.user_name, operational.user_name) AS user_name,
              coalesce(business.email, operational.email) AS email,
              coalesce(business.task_count, 0)::int AS task_count,
              coalesce(business.successful_tasks, 0)::int AS successful_tasks,
              coalesce(business.failed_tasks, 0)::int AS failed_tasks,
              coalesce(business.canceled_tasks, 0)::int AS canceled_tasks,
              coalesce(business.settled_credits, 0)::bigint AS settled_credits,
              coalesce(business.refunded_credits, 0)::bigint AS refunded_credits,
              (coalesce(business.billable_tokens, 0) + coalesce(operational.billable_tokens, 0))::bigint
                AS billable_tokens,
              coalesce(business.estimated_cost_cny, 0)::numeric(20,6)
                AS business_estimated_cost_cny,
              coalesce(operational.estimated_cost_cny, 0)::numeric(20,6)
                AS operational_estimated_cost_cny,
              (coalesce(business.estimated_cost_cny, 0) + coalesce(operational.estimated_cost_cny, 0))::numeric(20,6)
                AS estimated_cost_cny,
              coalesce(operational.operational_call_count, 0)::int AS operational_call_count,
              coalesce(operational.unpriced_call_count, 0)::int AS operational_unpriced_call_count,
              coalesce(business.incomplete_task_count, 0)::int AS incomplete_task_count,
              business.last_task_at,
              greatest(
                coalesce(business.last_task_at, '-infinity'::timestamptz),
                coalesce(operational.last_activity_at, '-infinity'::timestamptz)
              ) AS last_activity_at
       FROM business_user_costs business
       FULL OUTER JOIN operational_user_costs operational ON operational.id = business.id
     )
     SELECT users.*,
            ${keysetPageTotalCountSql(query)} AS __pagination_total_count,
            ${exactUtcTimestampSql('users.last_activity_at')} AS __pagination_cursor_timestamp
     FROM aggregated_users users
     WHERE $${cursorIndex}::numeric IS NULL
        OR ${userCursorCondition}
     ORDER BY ${userOrder}
     LIMIT $${limitIndex}`,
    [
      ...values,
      cursor[0] ?? null, cursor[1] ?? null, cursor[2] ?? null, cursor[3] ?? null,
      query.limit + 1,
    ],
  );
  const page = makeKeysetPage(result.rows, query, row => [
    String(row.estimated_cost_cny ?? 0), toInt(row.task_count),
    normalizeCursorTimestamp(row.__pagination_cursor_timestamp), row.id,
  ], mapBusinessUserCost);
  return { asOf: query.asOf, selection, ...page };
}

export async function listAdminApiCostReconciliation(client: DbClient, rawQuery: unknown, authorizationScope = 'role:admin') {
  const query = await normalizeKeysetQuery<CostReconciliationFilters>(
    client, rawQuery,
    'admin-api-cost-reconciliation-date-desc-v1', authorizationScope,
  );
  const observed = await readObservedCoverage(client, query.asOf, query.filters.model);
  const selection = resolveCostSelection(query.filters, observed, query.asOf);
  const comparable = resolveComparableWindow(selection, observed);
  const effectiveSelection = comparable?.start && comparable.end
    ? { ...selection, rangeStart: comparable.start, rangeEnd: comparable.end }
    : selection;
  if (!comparable.start || !comparable.end) {
    return emptyCostPage(query, effectiveSelection);
  }
  const conditions = ['b.provider = $1', "b.currency = 'CNY'"];
  const values: unknown[] = [PROVIDER, query.asOf, comparable.dates];
  // 单模型筛选仍保留 Seedance 候选但未归属的官方桶，否则会误报已完整对账。
  addSqlFilter(conditions, values, query.filters.model,
    index => `(b.recognized_model = $${index} OR b.recognized_model IS NULL)`);
  addSqlFilter(conditions, values, query.filters.pricingResolution, index => `b.pricing_resolution_band = $${index}`);
  addSqlFilter(conditions, values, query.filters.inputClass, index => `b.pricing_input_class = $${index}`);
  addSqlFilter(conditions, values, query.filters.unitPriceCnyPerMillion, index => `b.unit_price_per_million = $${index}::numeric`);
  addSqlFilter(conditions, values, query.filters.billLineType, index => `b.bill_line_type = $${index}`);
  const computedConditions: string[] = [];
  addSqlFilter(computedConditions, values, query.filters.matchState, index => `computed.status = $${index}`);
  addSqlFilter(computedConditions, values, query.filters.attributionConfidence, index => `computed.attribution_confidence = $${index}`);
  const cursorIndex = values.length + 1;
  const limitIndex = cursorIndex + 4;
  const cursor = query.cursor?.key ?? [];
  const result = await client.query<ReconciliationBucketRow>(
    `WITH timing_adjustments AS (
       SELECT shifted.expense_date, usage.model AS recognized_model,
              usage.pricing_resolution_band, usage.pricing_input_class,
              usage.unit_price_per_million, usage.currency,
              sum(links.allocated_tokens * shifted.direction)::bigint AS timing_tokens,
              sum(links.allocated_cost_cny * shifted.direction)::numeric(20,6) AS timing_cost_cny
       FROM provider_reconciliation_cases cases
       JOIN provider_reconciliation_case_links links ON links.case_id = cases.id
       JOIN provider_usage_records usage ON usage.id = links.usage_record_id
       CROSS JOIN LATERAL (VALUES
         (cases.official_expense_date, 1::bigint),
         (cases.local_accounting_date, -1::bigint)
       ) AS shifted(expense_date, direction)
       WHERE cases.provider = $1 AND cases.case_type = 'cross-date'
         AND cases.status = 'approved' AND cases.created_at <= $2
         AND shifted.expense_date IS NOT NULL
       GROUP BY shifted.expense_date, usage.model, usage.pricing_resolution_band,
                usage.pricing_input_class, usage.unit_price_per_million, usage.currency
     ), selected_runs AS (
       SELECT dates.expense_date, selected.id, selected.window_start, selected.window_end
       FROM unnest($3::date[]) AS dates(expense_date)
       JOIN LATERAL (
         SELECT runs.id, runs.window_start, runs.window_end
         FROM provider_reconciliation_runs runs
         WHERE runs.provider = $1
           AND runs.created_at <= $2
           AND runs.window_start <= dates.expense_date
           AND runs.window_end >= dates.expense_date
         ORDER BY runs.created_at DESC, runs.id DESC
         LIMIT 1
       ) selected ON true
     ), latest_buckets AS (
       SELECT b.*, selected.window_start AS period_start, selected.window_end AS period_end
       FROM selected_runs selected
       JOIN provider_reconciliation_buckets b ON b.reconciliation_run_id = selected.id
       WHERE coalesce(b.expense_date, selected.window_start) = selected.expense_date
         AND ${conditions.join('\n         AND ')}
     ), computed_buckets AS (
     SELECT b.id, b.period_start, b.period_end,
            b.expense_date, b.bill_line_type, b.recognized_model,
            b.pricing_resolution_band, b.pricing_input_class,
            b.unit_price_per_million, b.currency,
            b.raw_local_tokens, b.inferred_adjustment_tokens, b.adjusted_local_tokens,
            b.official_tokens,
            (b.timing_adjustment_tokens + coalesce(timing.timing_tokens, 0))::bigint AS timing_adjustment_tokens,
            (b.residual_tokens - coalesce(timing.timing_tokens, 0))::bigint AS residual_tokens,
            b.raw_local_cost_cny, b.inferred_adjustment_cost_cny, b.adjusted_local_cost_cny,
            b.official_cost_cny,
            (b.timing_adjustment_cost_cny + coalesce(timing.timing_cost_cny, 0))::numeric(20,6) AS timing_adjustment_cost_cny,
            b.rate_variance_cny, b.rounding_variance_cny,
            (b.residual_cost_cny - coalesce(timing.timing_cost_cny, 0))::numeric(20,6) AS residual_cost_cny,
            CASE
              WHEN b.status = 'not-comparable' THEN 'cannot-reconcile'
              WHEN b.residual_tokens - coalesce(timing.timing_tokens, 0) = 0
               AND b.residual_cost_cny - coalesce(timing.timing_cost_cny, 0) = 0
                THEN CASE WHEN b.inferred_adjustment_tokens = 0 AND coalesce(timing.timing_tokens, 0) = 0
                  THEN 'raw-matched' ELSE 'adjusted-matched' END
              ELSE 'residual'
            END AS status,
            CASE WHEN b.inferred_adjustment_tokens <> 0 OR timing.timing_tokens IS NOT NULL THEN 'high' ELSE 'direct' END AS attribution_confidence
     FROM latest_buckets b
     LEFT JOIN timing_adjustments timing
       ON timing.expense_date = b.expense_date
      AND timing.recognized_model IS NOT DISTINCT FROM b.recognized_model
      AND timing.pricing_resolution_band = b.pricing_resolution_band
      AND timing.pricing_input_class = b.pricing_input_class
      AND timing.unit_price_per_million IS NOT DISTINCT FROM b.unit_price_per_million
      AND timing.currency = b.currency
     )
     SELECT computed.*,
            ${keysetPageTotalCountSql(query)} AS __pagination_total_count
     FROM computed_buckets computed
     WHERE ${computedConditions.length ? computedConditions.join('\n       AND ') : 'true'}
       AND ($${cursorIndex}::date IS NULL OR (
         coalesce(computed.expense_date, computed.period_start), abs(computed.residual_cost_cny),
         computed.official_tokens, computed.id
       ) ${costKeysetOperator(query)} ($${cursorIndex}::date, $${cursorIndex + 1}::numeric, $${cursorIndex + 2}::bigint, $${cursorIndex + 3}::uuid))
     ORDER BY coalesce(computed.expense_date, computed.period_start) ${costKeysetDirection(query)},
              abs(computed.residual_cost_cny) ${costKeysetDirection(query)},
              computed.official_tokens ${costKeysetDirection(query)},
              computed.id ${costKeysetDirection(query)}
     LIMIT $${limitIndex}`,
    [...values, cursor[0] ?? null, cursor[1] ?? null, cursor[2] ?? null, cursor[3] ?? null, query.limit + 1],
  );
  const page = makeKeysetPage(result.rows, query, row => [
    dateOnly(row.expense_date ?? row.period_start),
    formatCny(row.residual_cost_cny).replace('-', ''), String(row.official_tokens ?? 0), row.id,
  ], mapReconciliationBucket);
  return { asOf: query.asOf, selection: effectiveSelection, ...page };
}

export async function getAdminApiCostReconciliationDetail(
  client: DbClient,
  id: string,
  rawQuery: { asOf?: string } | unknown = {},
) {
  const asOf = resolveAsOf(rawQuery);
  const bucketResult = await client.query<ReconciliationBucketRow>(
    `SELECT b.id, r.window_start AS period_start, r.window_end AS period_end,
            b.expense_date, b.bill_line_type, b.recognized_model,
            b.pricing_resolution_band, b.pricing_input_class, b.unit_price_per_million,
            b.currency, b.raw_local_tokens, b.inferred_adjustment_tokens,
            b.adjusted_local_tokens, b.official_tokens, b.timing_adjustment_tokens,
            b.residual_tokens, b.raw_local_cost_cny, b.inferred_adjustment_cost_cny,
            b.adjusted_local_cost_cny, b.official_cost_cny, b.timing_adjustment_cost_cny,
            b.rate_variance_cny, b.rounding_variance_cny, b.residual_cost_cny, b.status,
            CASE WHEN b.inferred_adjustment_tokens <> 0 THEN 'high' ELSE 'direct' END AS attribution_confidence
     FROM provider_reconciliation_buckets b
     JOIN provider_reconciliation_runs r ON r.id = b.reconciliation_run_id
     WHERE b.id = $1 AND b.provider = $2 AND b.currency = 'CNY' AND r.created_at <= $3`,
    [id, PROVIDER, asOf],
  );
  const bucket = bucketResult.rows[0];
  if (!bucket) throw Object.assign(new Error('对账桶不存在'), { statusCode: 404, code: 'RECONCILIATION_BUCKET_NOT_FOUND' });
  const expenseDate = bucket.expense_date ? dateOnly(bucket.expense_date) : null;
  const dimensionParams = [
    PROVIDER, asOf, expenseDate, bucket.recognized_model,
    bucket.pricing_resolution_band, bucket.pricing_input_class,
    bucket.unit_price_per_million,
  ];
  const timingResult = await client.query<TimingAdjustmentRow>(
      `SELECT coalesce(sum(links.allocated_tokens * shifted.direction), 0)::bigint AS timing_tokens,
              coalesce(sum(links.allocated_cost_cny * shifted.direction), 0)::numeric(20,6) AS timing_cost_cny
       FROM provider_reconciliation_cases cases
       JOIN provider_reconciliation_case_links links ON links.case_id = cases.id
       JOIN provider_usage_records usage ON usage.id = links.usage_record_id
       CROSS JOIN LATERAL (VALUES
         (cases.official_expense_date, 1::bigint),
         (cases.local_accounting_date, -1::bigint)
       ) AS shifted(expense_date, direction)
       WHERE cases.provider = $1 AND cases.case_type = 'cross-date' AND cases.status = 'approved'
         AND cases.created_at <= $2 AND shifted.expense_date = $3::date
         AND usage.model IS NOT DISTINCT FROM $4::text
         AND usage.pricing_resolution_band = $5::text
         AND usage.pricing_input_class = $6::text
         AND usage.unit_price_per_million IS NOT DISTINCT FROM $7::numeric
         AND usage.currency = 'CNY'`,
      dimensionParams,
    );
  const localEvidenceResult = await client.query<ReconciliationEvidenceRow>(
      `SELECT usage.id::text AS id, 'local'::text AS side,
              usage.id AS usage_record_id, NULL::uuid AS bill_detail_revision_id,
              usage.task_id, usage.provider_task_id, NULL::text AS source_detail_key,
              coalesce(usage.billable_tokens, 0)::bigint AS allocated_tokens,
              coalesce(usage.estimated_cost, 0)::numeric(20,6) AS allocated_cost_cny,
              NULL::text AS cause, usage.attribution_confidence AS confidence,
              jsonb_build_object(
                'usageEvidenceOrigin', usage.usage_evidence_origin,
                'pricingRuleStatus', usage.pricing_rule_status,
                'accountingDateOrigin', usage.accounting_date_origin
              ) AS evidence
       FROM provider_usage_records usage
       WHERE usage.provider = $1 AND usage.created_at <= $2 AND usage.currency = 'CNY'
         AND $3::date IS NOT NULL
         AND usage.local_accounting_date = $3::date
         AND usage.model IS NOT DISTINCT FROM $4::text
         AND usage.pricing_resolution_band = $5::text
         AND usage.pricing_input_class = $6::text
         AND usage.unit_price_per_million IS NOT DISTINCT FROM $7::numeric
         AND usage.usage_unit = 'tokens'
         AND usage.usage_evidence_origin <> 'official-bill-inferred'
         AND NOT EXISTS (
           SELECT 1
           FROM provider_reconciliation_case_links candidate_links
           JOIN provider_reconciliation_cases candidate_cases
             ON candidate_cases.id = candidate_links.case_id
           WHERE candidate_links.usage_record_id = usage.id
             AND candidate_cases.provider = $1
             AND candidate_cases.case_type = 'missing-local-usage'
             AND candidate_cases.status IN ('open', 'approved')
             AND candidate_cases.evidence->>'resolutionKind' = 'zero-cost'
             AND candidate_cases.created_at <= $2
         )
       ORDER BY usage.created_at, usage.id`,
      dimensionParams,
    );
  const zeroCostCandidateEvidenceResult = await client.query<ReconciliationEvidenceRow>(
      `SELECT links.id::text AS id, 'zero-cost-candidate'::text AS side,
              links.usage_record_id, NULL::uuid AS bill_detail_revision_id,
              usage.task_id, usage.provider_task_id, NULL::text AS source_detail_key,
              0::bigint AS allocated_tokens, 0::numeric(20,6) AS allocated_cost_cny,
              cases.root_cause AS cause, cases.confidence,
              cases.evidence || jsonb_build_object(
                'caseId', cases.id,
                'caseKey', cases.case_key,
                'caseStatus', cases.status,
                'auditScope', 'account-billing-bucket'
              ) AS evidence
       FROM provider_reconciliation_cases cases
       JOIN provider_reconciliation_case_links links ON links.case_id = cases.id
       JOIN provider_usage_records usage ON usage.id = links.usage_record_id
       WHERE cases.provider = $1
         AND cases.case_type = 'missing-local-usage'
         AND cases.status IN ('open', 'approved')
         AND cases.evidence->>'resolutionKind' = 'zero-cost'
         AND cases.created_at <= $2
         AND $3::date IS NOT NULL
         AND (cases.evidence->>'expenseDate')::date = $3::date
         AND cases.evidence->>'model' IS NOT DISTINCT FROM $4::text
         AND cases.evidence->>'pricingResolutionBand' = $5::text
         AND cases.evidence->>'pricingInputClass' = $6::text
         AND (cases.evidence->>'unitPricePerMillion')::numeric IS NOT DISTINCT FROM $7::numeric
       ORDER BY cases.created_at, links.id`,
      dimensionParams,
    );
  const adjustmentEvidenceResult = await client.query<ReconciliationEvidenceRow>(
      `SELECT links.id::text AS id, 'adjustment'::text AS side,
              links.usage_record_id, links.bill_detail_revision_id,
              usage.task_id, usage.provider_task_id,
              coalesce(revisions.source_detail_key, cases.evidence->>'officialDetailKey') AS source_detail_key,
              links.allocated_tokens, links.allocated_cost_cny,
              cases.root_cause AS cause, cases.confidence, cases.evidence
       FROM provider_reconciliation_cases cases
       JOIN provider_reconciliation_case_links links ON links.case_id = cases.id
       LEFT JOIN provider_usage_records usage ON usage.id = links.usage_record_id
       LEFT JOIN provider_bill_detail_revisions revisions ON revisions.id = links.bill_detail_revision_id
       WHERE cases.provider = $1 AND cases.status = 'approved' AND cases.created_at <= $2
         AND $3::date IS NOT NULL
         AND (
           cases.official_expense_date = $3::date OR cases.local_accounting_date = $3::date
           OR usage.local_accounting_date = $3::date
           OR nullif(revisions.normalized_payload->>'expenseDate', '')::date = $3::date
         )
         AND coalesce(usage.model, revisions.normalized_payload->>'recognizedModel') IS NOT DISTINCT FROM $4::text
         AND coalesce(usage.pricing_resolution_band, CASE
               WHEN lower(coalesce(revisions.normalized_payload->>'pricingResolution', '')) ~ '(480|720)' THEN '480p-720p'
               WHEN lower(coalesce(revisions.normalized_payload->>'pricingResolution', '')) ~ '1080' THEN '1080p'
               WHEN lower(coalesce(revisions.normalized_payload->>'pricingResolution', '')) ~ '4k' THEN '4k'
               ELSE 'unknown' END) = $5::text
         AND coalesce(usage.pricing_input_class, CASE revisions.normalized_payload->>'pricingInputHasVideo'
               WHEN 'true' THEN 'with-video' WHEN 'false' THEN 'without-video' ELSE 'unknown' END) = $6::text
         AND coalesce(usage.unit_price_per_million,
               nullif(revisions.normalized_payload->>'normalizedUnitPricePerMillion', '')::numeric)
               IS NOT DISTINCT FROM $7::numeric
         AND coalesce(usage.currency, revisions.normalized_payload->>'currency', 'CNY') = 'CNY'
       ORDER BY cases.created_at, links.id`,
      dimensionParams,
    );
  const officialDetails = expenseDate ? await readOfficialDetailsAsOf(client, {
      start: expenseDate, end: expenseDate, asOf, product: OFFICIAL_PRODUCT,
      models: bucket.recognized_model ? [bucket.recognized_model] : undefined,
    }) : [];
  const timing = timingResult.rows[0] ?? {} as TimingAdjustmentRow;
  const adjustedBucket = applyTimingAdjustment(bucket, timing);
  const officialEvidence = officialDetails
    .filter(detail => officialDetailMatchesBucket(detail, adjustedBucket))
    .map(officialDetailToReconciliationEvidence);
  return {
    bucket: mapReconciliationBucket(adjustedBucket),
    evidence: [
      ...localEvidenceResult.rows.map(mapReconciliationEvidence),
      ...zeroCostCandidateEvidenceResult.rows.map(mapReconciliationEvidence),
      ...officialEvidence,
      ...adjustmentEvidenceResult.rows.map(mapReconciliationEvidence),
    ],
  };
}

export async function listAdminApiCostSettlement(client: DbClient, rawQuery: unknown, authorizationScope = 'role:admin') {
  const query = await normalizeKeysetQuery<CostSettlementFilters>(client, rawQuery, 'admin-api-cost-settlement', authorizationScope);
  const observed = await readObservedCoverage(client, query.asOf, query.filters.model);
  const selection = resolveCostSelection(query.filters, observed, query.asOf);
  const settlementCoverage = buildCoverage(
    selection, observed, resolveComparableWindow(selection, observed), false,
  ).official;
  const snapshot = await readOfficialSettlementPageSnapshot(client, query, selection);
  const acquisitionLinks = await readAcquisitionLinks(client, snapshot.details, query.asOf);
  const rows = snapshot.details.map(detail => ({
    ...officialDetailToSettlementRow(detail, acquisitionLinks),
    __pagination_total_count: snapshot.totalCount,
  }));
  const ledgerRow = await readPackageLedgerSummary(client, selection, query.asOf);
  const page = makeKeysetPage(rows, query, row => [
    formatCny(row.payable_amount_cny).replace('-', ''), dateOnly(row.expense_date), row.revision_id,
  ], mapSettlementItem);
  return {
    asOf: query.asOf,
    selection,
    summary: buildSettlementBook(
      snapshot.summary, ledgerRow, snapshot.listPrice, selection, settlementCoverage,
    ),
    ...page,
  };
}

function summarizeOfficialUsage(
  details: OfficialAsOfDetail[],
  comparableDates: string[],
  enabled: boolean,
  expectedModels: string[],
): OfficialSummaryRow {
  const dateSet = new Set(comparableDates);
  const rows = enabled ? details.filter(item => (
    item.product === OFFICIAL_PRODUCT
    && dateSet.has(item.expenseDate)
    && (item.billLineType === 'usage' || (item.billLineType === 'other' && item.seedanceCandidate))
    && (item.seedanceCandidate || (item.recognizedModel !== null && expectedModels.includes(item.recognizedModel)))
  )) : [];
  const unpriced = rows.filter(item => (
    item.billLineType !== 'usage'
    || item.recognizedModel === null
    || !expectedModels.includes(item.recognizedModel)
    || item.listEquivalentCostCny === null
    || item.listEquivalentCostCny === undefined
    || item.normalizedUnitPricePerMillion === null
    || item.normalizedUnitPricePerMillion === undefined
    || normalizeOfficialPricingResolution(item.pricingResolution) === 'unknown'
    || item.pricingInputHasVideo === null
  ));
  return {
    row_count: rows.length,
    billable_tokens: sumIntegers(rows, item => item.billableTokens),
    unpriced_rows: unpriced.length,
    unpriced_tokens: sumIntegers(unpriced, item => item.billableTokens),
    list_equivalent_cost_cny: sumCny(rows, item => item.listEquivalentCostCny),
    original_bill_amount_cny: sumCny(rows, item => item.originalBillAmountCny),
    payable_amount_cny: sumCny(rows, item => item.payableAmountCny),
    paid_amount_cny: sumCny(rows, item => item.paidAmountCny),
    unpaid_amount_cny: sumCny(rows, item => item.unpaidAmountCny),
    deducted_tokens: sumWholeTokenDecimalsOrNull(rows, item => item.deductionCount),
    all_final: rows.length > 0 ? rows.every(item => item.isFinal) : null,
    any_final: rows.length > 0 ? rows.some(item => item.isFinal) : null,
  };
}

function summarizeOfficialAverage(details: OfficialAsOfDetail[], models: string[]): OfficialAverageRow {
  const usage = details.filter(item => item.billLineType === 'usage'
    || (item.billLineType === 'other' && item.seedanceCandidate));
  const seedance = usage.filter(item => item.product === OFFICIAL_PRODUCT
    && (item.seedanceCandidate || (item.recognizedModel !== null && models.includes(item.recognizedModel))));
  const unpriced = seedance.filter(item => (
    item.billLineType !== 'usage'
    || item.recognizedModel === null
    || !models.includes(item.recognizedModel)
    || item.listEquivalentCostCny === null
    || item.listEquivalentCostCny === undefined
    || item.normalizedUnitPricePerMillion === null
    || item.normalizedUnitPricePerMillion === undefined
    || normalizeOfficialPricingResolution(item.pricingResolution) === 'unknown'
    || item.pricingInputHasVideo === null
  ));
  return {
    all_account_payable_cny: sumNullableCny(usage, item => item.payableAmountCny),
    seedance_payable_cny: sumNullableCny(seedance, item => item.payableAmountCny),
    seedance_list_cost_cny: sumNullableCny(seedance, item => item.listEquivalentCostCny),
    seedance_unpriced_rows: unpriced.length,
    seedance_unpriced_tokens: sumIntegers(unpriced, item => item.billableTokens),
  };
}

function summarizeOfficialSettlement(details: OfficialAsOfDetail[]): SettlementSummaryRow {
  const usage = details.filter(item => item.billLineType === 'usage');
  const purchases = details.filter(item => item.billLineType === 'package-purchase');
  const refunds = details.filter(item => item.billLineType === 'refund');
  const adjustments = details.filter(item => item.billLineType === 'adjustment');
  return {
    usage_original_amount_cny: sumNullableCny(usage, item => item.originalBillAmountCny),
    usage_payable_amount_cny: sumNullableCny(usage, item => item.payableAmountCny),
    usage_paid_amount_cny: sumNullableCny(usage, item => item.paidAmountCny),
    usage_unpaid_amount_cny: sumNullableCny(usage, item => item.unpaidAmountCny),
    package_purchase_amount_cny: sumNullableCny(purchases, item => item.payableAmountCny),
    package_purchase_paid_amount_cny: sumNullableCny(purchases, item => item.paidAmountCny),
    package_purchase_unpaid_amount_cny: sumNullableCny(purchases, item => item.unpaidAmountCny),
    refund_amount_cny: sumNullableCny(refunds, item => item.payableAmountCny),
    billing_adjustment_amount_cny: sumNullableCny(adjustments, item => item.payableAmountCny),
    net_official_payable_cny: sumNullableCny(details, item => item.payableAmountCny),
  };
}

function summarizeListPrice(details: OfficialAsOfDetail[]): ListPriceSummary {
  const usage = details.filter(item => item.billLineType === 'usage'
    || (item.billLineType === 'other' && item.seedanceCandidate));
  if (usage.length === 0) return { cost: null, status: 'unavailable' };
  if (usage.some(item => item.listEquivalentCostCny === null
    || item.listEquivalentCostCny === undefined
    || (item.seedanceCandidate && item.recognizedModel === null))) {
    return { cost: null, status: 'unpriced' };
  }
  return {
    cost: usage.reduce((sum, item) => sum + cnyMicros(item.listEquivalentCostCny), 0n),
    status: 'priced',
  };
}

function summarizeOfficialModels(
  details: OfficialAsOfDetail[],
  comparableDates: string[],
  enabled: boolean,
) {
  if (!enabled) return [] as OfficialModelRow[];
  const dateSet = new Set(comparableDates);
  const grouped = new Map<string, OfficialAsOfDetail[]>();
  for (const detail of details) {
    if (detail.billLineType !== 'usage' || !detail.recognizedModel || !dateSet.has(detail.expenseDate)) continue;
    const group = grouped.get(detail.recognizedModel) ?? [];
    group.push(detail);
    grouped.set(detail.recognizedModel, group);
  }
  return [...grouped.entries()].map(([model, rows]) => ({
    model,
    billable_tokens: sumIntegers(rows, item => item.billableTokens),
    list_equivalent_cost_cny: sumCny(rows, item => item.listEquivalentCostCny),
    payable_amount_cny: sumCny(rows, item => item.payableAmountCny),
  }));
}

function summarizeOfficialDaily(details: OfficialAsOfDetail[], selection: CostSelection) {
  const grouped = new Map<string, OfficialAsOfDetail[]>();
  for (const detail of details) {
    if (detail.billLineType !== 'usage') continue;
    const key = selection.grain === 'month' ? `${detail.expenseDate.slice(0, 7)}-01` : detail.expenseDate;
    const group = grouped.get(key) ?? [];
    group.push(detail);
    grouped.set(key, group);
  }
  return [...grouped.entries()].map(([day, rows]) => ({
    day,
    billable_tokens: sumIntegers(rows, item => item.billableTokens),
    list_equivalent_cost_cny: rows.some(item => item.listEquivalentCostCny === null || item.listEquivalentCostCny === undefined)
      ? null : sumCny(rows, item => item.listEquivalentCostCny),
    payable_amount_cny: sumCny(rows, item => item.payableAmountCny),
  } satisfies DailyRow));
}

function sumIntegers<Row>(rows: Row[], value: (row: Row) => unknown) {
  return rows.reduce((sum, row) => sum + toInt(value(row)), 0);
}

function sumWholeTokenDecimalsOrNull<Row>(rows: Row[], value: (row: Row) => unknown) {
  let total = 0n;
  for (const row of rows) {
    const raw = value(row);
    if (raw === null || raw === undefined) return null;
    const match = /^(\d+)(?:\.0*)?$/.exec(String(raw).trim());
    if (!match) return null;
    total += BigInt(match[1]!);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  }
  return Number(total);
}

function sumCny<Row>(rows: Row[], value: (row: Row) => unknown) {
  return formatCnyMicros(rows.reduce((sum, row) => sum + cnyMicros(value(row)), 0n));
}

function sumNullableCny<Row>(rows: Row[], value: (row: Row) => unknown) {
  if (rows.some(row => value(row) === null || value(row) === undefined)) return null;
  return sumCny(rows, value);
}

function buildModelBreakdown(
  localRows: LocalModelRow[],
  officialRows: OfficialModelRow[],
  totalLocalCost: bigint,
  localAvailable: boolean,
  officialAvailable: boolean,
) {
  const localByModel = new Map(localRows.map(row => [row.model, row]));
  const officialByModel = new Map(officialRows.map(row => [row.model, row]));
  return [...SEEDANCE_COST_MODEL_LABELS].map((model, index) => {
    const local = localByModel.get(model);
    const official = officialByModel.get(model);
    const estimatedCost = cnyMicros(local?.estimated_cost_cny);
    const successes = toInt(local?.successful_tasks);
    const successfulVideos = toInt(local?.successful_video_count);
    const successfulOutputSeconds = nullablePositiveNumber(local?.successful_output_seconds);
    const unpricedAttempts = toInt(local?.unpriced_tasks);
    const unavailableUsageAttempts = toInt(local?.unavailable_usage_attempts);
    const modelCompleteness = estimateCompleteness(
      localAvailable, unpricedAttempts, unavailableUsageAttempts,
    );
    return {
      id: `volcengine-ark-${index + 1}`,
      provider: PROVIDER,
      model,
      billableTokens: localAvailable ? toInt(local?.billable_tokens) : null,
      estimatedCostCny: localAvailable ? formatCnyMicros(estimatedCost) : null,
      officialBillableTokens: officialAvailable ? toInt(official?.billable_tokens) : null,
      officialListEquivalentCostCny: officialAvailable
        ? formatCny(official?.list_equivalent_cost_cny) : null,
      officialPayableAmountCny: officialAvailable ? formatCny(official?.payable_amount_cny) : null,
      attemptCount: localAvailable ? toInt(local?.attempt_count) : null,
      taskCount: localAvailable ? toInt(local?.task_count) : null,
      successfulVideoCount: localAvailable ? successfulVideos : null,
      successfulTasks: localAvailable ? successes : null,
      failedTasks: localAvailable ? toInt(local?.failed_tasks) : null,
      failedBillableTokens: localAvailable ? toInt(local?.failed_billable_tokens) : null,
      failedEstimatedCostCny: localAvailable ? formatCny(local?.failed_estimated_cost_cny) : null,
      averageSuccessfulTaskCostCny: localAvailable && successes > 0
        ? formatCnyMicros(divideRounded(
          cnyMicros(local?.successful_estimated_cost_cny), BigInt(successes),
        )) : null,
      costPerSuccessfulVideoCny: localAvailable && successfulVideos > 0
        ? formatCnyMicros(divideRounded(estimatedCost, BigInt(successfulVideos))) : null,
      successfulOutputSeconds: localAvailable ? successfulOutputSeconds : null,
      costPerOutputSecondCny: localAvailable && successfulOutputSeconds !== null
        ? formatCnyMicros(divideRounded(
          estimatedCost * 1_000_000n,
          BigInt(Math.round(successfulOutputSeconds * 1_000_000)),
        )) : null,
      costSharePercent: !localAvailable ? null : totalLocalCost > 0n
        ? round2(Number(estimatedCost * 10_000n / totalLocalCost) / 100)
        : 0,
      withoutVideoCostCny: localAvailable ? formatCny(local?.without_video_cost_cny) : null,
      withVideoCostCny: localAvailable ? formatCny(local?.with_video_cost_cny) : null,
      unpricedTasks: localAvailable ? unpricedAttempts : null,
      unavailableUsageAttempts: localAvailable ? unavailableUsageAttempts : null,
      estimateCompleteness: modelCompleteness,
    };
  });
}

function buildCostTrend(
  selection: CostSelection,
  localRows: DailyRow[],
  officialRows: DailyRow[],
  coverage: ObservedCoverage,
) {
  const local = new Map(localRows.map(row => [dateOnly(row.day), row]));
  const official = new Map(officialRows.map(row => [dateOnly(row.day), row]));
  const periods = selection.grain === 'month'
    ? enumerateMonths(selection.rangeStart, selection.rangeEnd)
    : selection.grain === 'bucket' ? [selection.rangeStart] : enumerateDates(selection.rangeStart, selection.rangeEnd);
  return periods.map(day => {
    const periodStart = day;
    const periodEnd = selection.grain === 'month'
      ? minDate(endOfMonth(day), selection.rangeEnd)
      : selection.grain === 'bucket' ? selection.rangeEnd : day;
    const hasLocalCoverage = coverage.localIntervals.some(interval => (
      overlapsDateRange(periodStart, periodEnd, interval.start, interval.end)
    ));
    const hasOfficialCoverage = coverage.officialIntervals.some(interval => (
      overlapsDateRange(periodStart, periodEnd, interval.start, interval.end)
    ));
    const localRow = local.get(day);
    const officialRow = official.get(day);
    const localUnpricedAttempts = hasLocalCoverage ? toInt(localRow?.unpriced_attempts) : null;
    const localUnavailableUsageAttempts = hasLocalCoverage
      ? toInt(localRow?.unavailable_usage_attempts) : null;
    return {
      day,
      localBillableTokens: hasLocalCoverage ? toInt(localRow?.billable_tokens) : null,
      localEstimatedCostCny: hasLocalCoverage ? formatCny(localRow?.estimated_cost_cny) : null,
      localUnpricedAttempts,
      localUnavailableUsageAttempts,
      localEstimateCompleteness: estimateCompleteness(
        hasLocalCoverage, localUnpricedAttempts ?? 0, localUnavailableUsageAttempts ?? 0,
      ),
      officialBillableTokens: hasOfficialCoverage ? toInt(officialRow?.billable_tokens) : null,
      officialListEquivalentCostCny: hasOfficialCoverage
        ? officialRow ? nullableCny(officialRow.list_equivalent_cost_cny) : '0.000000' : null,
      officialPayableAmountCny: hasOfficialCoverage
        ? officialRow ? nullableCny(officialRow.payable_amount_cny) : '0.000000' : null,
    };
  });
}

function overlapsDateRange(start: string, end: string, coverageStart: string | null, coverageEnd: string | null) {
  return Boolean(coverageStart && coverageEnd && start <= coverageEnd && end >= coverageStart);
}

function countCoveredDays(intervals: DateInterval[], start: string, end: string) {
  return enumerateDates(start, end).filter(day => (
    intervals.some(interval => day >= interval.start && day <= interval.end)
  )).length;
}

function resolveOfficialBillState(dates: string[], intervals: DateInterval[]) {
  if (dates.length === 0) return 'unavailable' as const;
  const states = dates.flatMap(day => {
    const interval = intervals.find(item => day >= item.start && day <= item.end);
    if (!interval) return [];
    return [interval.billState ?? (interval.isFinal ? 'final' as const : 'provisional' as const)];
  });
  if (states.length !== dates.length) return 'unavailable' as const;
  const unique = new Set(states);
  if (unique.size > 1) return 'mixed' as const;
  return states[0] ?? 'unavailable' as const;
}

function resolveCoveredOfficialBillState(dates: string[], intervals: DateInterval[]) {
  const coveredDates = dates.filter(day => intervals.some(interval => (
    day >= interval.start && day <= interval.end
  )));
  return resolveOfficialBillState(coveredDates, intervals);
}

function buildPricingRules(rows: PricingRow[]) {
  const latest = new Map<string, PricingRow>();
  for (const row of rows) {
    const resolution = row.resolution === '480p' || row.resolution === '720p' ? '480p-720p' : row.resolution;
    if (resolution !== '480p-720p' && resolution !== '1080p') continue;
    const key = `${row.price_version}:${row.model}:${resolution}:${row.has_video_input}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.entries()].map(([key, row]) => {
    const resolution = key.split(':').at(-2) as '480p-720p' | '1080p';
    return {
      version: row.price_version,
      effectiveFrom: toIsoDateTime(row.effective_from),
      model: row.model,
      resolution,
      inputClass: row.has_video_input ? 'with-video' as const : 'without-video' as const,
      unitPriceCnyPerMillion: formatCny(row.unit_price_per_million),
      platformAvailable: true,
    };
  }).sort((left, right) => (
    seedanceCostModelOrder(left.model) - seedanceCostModelOrder(right.model)
      || pricingResolutionOrder(left.resolution) - pricingResolutionOrder(right.resolution)
      || left.inputClass.localeCompare(right.inputClass)
  ));
}

function mapPackage(row: PackageRow) {
  return {
    id: row.id,
    packageId: row.package_id,
    product: row.product,
    config: isJsonObject(row.config) ? row.config : String(row.config ?? ''),
    recognizedModel: row.recognized_model,
    status: row.status,
    totalQuota: toInt(row.total_quota),
    remainingQuota: toInt(row.remaining_quota),
    startsAt: row.starts_at ? toIsoDateTime(row.starts_at) : '-',
    expiresAt: row.expires_at ? toIsoDateTime(row.expires_at) : '-',
  };
}

function buildSync(rows: SyncRunRow[], referenceTime: Date | string = new Date()) {
  const normalized = new Map<SyncKind, SyncRunRow>();
  for (const row of rows) {
    const kind = normalizeSyncKind(row.kind);
    if (kind && !normalized.has(kind)) normalized.set(kind, row);
  }
  const items = (['balance', 'bill', 'packages'] as const).map(kind => {
    const row = normalized.get(kind);
    if (!row) return {
      kind,
      status: 'never-synced' as const,
      lastAttemptAt: '-',
      lastSuccessAt: '-',
      dataThrough: '-',
      reason: null,
    };
    const status = syncFreshness(kind, row, referenceTime);
    return {
      kind,
      status,
      lastAttemptAt: toIsoDateTime(row.started_at),
      lastSuccessAt: row.last_success_at ? toIsoDateTime(row.last_success_at) : '-',
      dataThrough: row.last_success_window_end ? dateOnly(row.last_success_window_end) : '-',
      reason: row.error ?? null,
    };
  });
  const successTimes = items.map(item => item.lastSuccessAt).filter(value => value !== '-');
  const hasError = items.some(item => item.status === 'failed');
  const stale = items.some(item => item.status !== 'fresh');
  return {
    status: hasError ? 'error' as const : stale ? 'warning' as const : 'normal' as const,
    stale,
    lastSyncedAt: successTimes.sort().at(-1) ?? '-',
    items,
  };
}

function parseBalanceRow(value: unknown): BalanceRow | undefined {
  if (!isJsonObject(value)) return undefined;
  return value as unknown as BalanceRow;
}

function parseSyncRows(value: unknown): SyncRunRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isJsonObject).map(row => row as unknown as SyncRunRow);
}

function buildAccountBalance(balance: BalanceRow | undefined, sync: ReturnType<typeof buildSync>) {
  return {
    provider: PROVIDER,
    currency: 'CNY' as const,
    availableBalanceCny: balance ? formatCny(balance.available_balance_cny) : null,
    cashBalanceCny: balance ? formatCny(balance.cash_balance_cny) : null,
    frozenAmountCny: balance ? formatCny(balance.frozen_amount_cny) : null,
    arrearsBalanceCny: balance ? formatCny(balance.arrears_balance_cny) : null,
    creditLimitCny: balance ? formatCny(balance.credit_limit_cny) : null,
    syncedAt: balance ? toIsoDateTime(balance.synced_at) : '-',
    status: sync.items.find(item => item.kind === 'balance')?.status ?? 'never-synced' as const,
  };
}

function emptyOperationsAggregate(): BusinessOperationsAggregateRow {
  return {
    model: null,
    price_versions: [],
    total_row: true,
    task_count: 0,
    user_count: 0,
    settled_credits: 0,
    held_credits: 0,
    refunded_credits: 0,
    estimated_cost_cny: '0.000000',
    incomplete_task_count: 0,
    pending_final_bill_task_count: 0,
    approved_zero_cost_task_count: 0,
    unresolved_task_count: 0,
    admin_direct_usage_count: 0,
    admin_direct_estimated_cost_cny: '0.000000',
    timing_shift_cost_cny: '0.000000',
  };
}

function emptyOperationsModelAggregate(model: string): BusinessOperationsAggregateRow & { model: string } {
  return {
    ...emptyOperationsAggregate(),
    model,
    total_row: false,
  };
}

function mapOperationsModelAggregate(
  row: BusinessOperationsAggregateRow & { model: string },
  operational?: OperationalUsageAggregateRow,
) {
  const taskCount = toInt(row.task_count);
  const businessEstimatedCost = cnyMicros(row.estimated_cost_cny);
  const operationalEstimatedCost = cnyMicros(operational?.estimated_cost_cny ?? 0);
  const knownAccountCost = businessEstimatedCost + operationalEstimatedCost;
  const incompleteTaskCount = toInt(row.incomplete_task_count);
  const operationalUnpricedCallCount = toInt(operational?.unpriced_call_count);
  return {
    id: row.model,
    model: row.model,
    priceVersions: normalizePriceVersions([
      ...normalizePriceVersions(row.price_versions),
      ...normalizePriceVersions(operational?.price_versions),
    ]),
    taskCount,
    operationalCallCount: toInt(operational?.call_count),
    settledCredits: toInt(row.settled_credits),
    heldCredits: toInt(row.held_credits),
    refundedCredits: toInt(row.refunded_credits),
    estimatedCostCny: formatCnyMicros(knownAccountCost),
    businessEstimatedCostCny: formatCnyMicros(businessEstimatedCost),
    operationalEstimatedCostCny: formatCnyMicros(operationalEstimatedCost),
    knownAccountCostCny: formatCnyMicros(knownAccountCost),
    operationalUnpricedCallCount,
    estimateCompleteness: aggregateEstimateCompleteness(
      incompleteTaskCount + operationalUnpricedCallCount,
      knownAccountCost,
    ),
    incompleteTaskCount,
    averageTaskCostCny: taskCount > 0
      ? formatCnyMicros(divideRounded(businessEstimatedCost, BigInt(taskCount))) : null,
  };
}

function syncFreshness(kind: SyncKind, row: SyncRunRow, referenceTime: Date | string) {
  if (row.status === 'running') return 'running' as const;
  if (row.status !== 'success') return 'failed' as const;
  if (!row.last_success_at) return 'failed' as const;
  const age = new Date(referenceTime).getTime() - new Date(row.last_success_at).getTime();
  const staleAfter = kind === 'balance' ? 15 * 60_000 : 30 * 60_000;
  return age > staleAfter ? 'stale' as const : 'fresh' as const;
}

function normalizeSyncKind(value: string): SyncKind | null {
  if (value === 'balance') return 'balance';
  if (value === 'packages') return 'packages';
  if (value.startsWith('bill')) return 'bill';
  return null;
}

type NormalizedKeysetQuery<Filters extends AnyCostFilters> = AdminExactKeysetQuery<Filters>;

async function normalizeKeysetQuery<Filters extends AnyCostFilters>(
  client: DbClient,
  rawQuery: unknown,
  resource: string,
  authorizationScope: string,
): Promise<NormalizedKeysetQuery<Filters>> {
  const value = (rawQuery && typeof rawQuery === 'object' ? rawQuery : {}) as Filters;
  const asOf = resolveAsOf(value);
  return parseAdminExactKeysetQuery(client, {
    rawQuery,
    filters: value,
    fingerprintFilters: omitKeys(value, ['cursor', 'snapshotCursor', 'limit', 'position', 'asOf']),
    resource,
    versionResource: 'admin:cost-video',
    asOf,
    authorizationScope,
    defaultLimit: 20,
    maxLimit: 50,
  });
}

function buildCostFilter(
  filters: CostAttemptFilters,
  startIndex: number,
  asOf: string,
  accountingDates?: string[],
) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const add = (sql: (index: number) => string, value: unknown) => {
    values.push(value);
    conditions.push(sql(startIndex + values.length - 1));
  };
  const range = resolveFilterDateRange(filters);
  if (accountingDates) {
    add(index => `coalesce(pur.local_accounting_date, (coalesce(pur.completed_at, pur.created_at) AT TIME ZONE 'Asia/Shanghai')::date) = ANY($${index}::date[])`, accountingDates);
  } else if (range) {
    add(index => `coalesce(pur.local_accounting_date, (coalesce(pur.completed_at, pur.created_at) AT TIME ZONE 'Asia/Shanghai')::date) >= $${index}::date`, range.start);
    add(index => `coalesce(pur.local_accounting_date, (coalesce(pur.completed_at, pur.created_at) AT TIME ZONE 'Asia/Shanghai')::date) <= $${index}::date`, range.end);
  }
  if (filters.model) add(index => `pur.model = $${index}`, filters.model);
  if (filters.resolution) {
    if (filters.resolution === 'unknown') conditions.push('pur.resolution IS NULL');
    else add(index => `pur.resolution = $${index}`, filters.resolution);
  }
  if (filters.pricingResolution) add(index => `pur.pricing_resolution_band = $${index}`, filters.pricingResolution);
  if (filters.inputClass) add(index => `pur.pricing_input_class = $${index}`, filters.inputClass);
  if (filters.status) {
    if (filters.status === 'completed') conditions.push("pur.status = 'success'");
    else if (filters.status === 'canceled') conditions.push("gt.status = 'canceled'");
    else conditions.push("pur.status <> 'success' AND coalesce(gt.status, '') <> 'canceled'");
  }
  if (filters.estimateStatus) {
    if (filters.estimateStatus === 'missing-usage') conditions.push('pur.billable_tokens IS NULL');
    else if (filters.estimateStatus === 'unsupported') conditions.push("pur.pricing_status = 'unpriced' AND pur.billable_tokens IS NOT NULL AND pur.resolution IS NOT NULL");
    else add(index => `pur.pricing_status = $${index}`, filters.estimateStatus === 'priced' || filters.estimateStatus === 'legacy-inferred' ? filters.estimateStatus : 'unpriced');
  }
  if (filters.usageEvidenceOrigin) add(index => `pur.usage_evidence_origin = $${index}`, filters.usageEvidenceOrigin);
  if (filters.pricingRuleStatus) add(index => `pur.pricing_rule_status = $${index}`, filters.pricingRuleStatus);
  if (filters.attributionConfidence) add(index => `pur.attribution_confidence = $${index}`, filters.attributionConfidence);
  if (filters.search) add(index => `(
    pur.task_id::text ILIKE '%' || $${index} || '%'
    OR coalesce(pur.provider_task_id, '') ILIKE '%' || $${index} || '%'
    OR coalesce(u.user_name, '') ILIKE '%' || $${index} || '%'
    OR coalesce(u.email, '') ILIKE '%' || $${index} || '%'
  )`, filters.search);
  values.push(asOf);
  return { sql: conditions.length ? `AND ${conditions.join('\n       AND ')}` : '', values };
}

function buildBusinessTaskFilter(
  filters: CostFilters | CostUserFilters,
  startIndex: number,
) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const add = (sql: (index: number) => string, value: unknown) => {
    values.push(value);
    conditions.push(sql(startIndex + values.length - 1));
  };
  if (filters.resolution) add(index => `task.resolution = $${index}`, filters.resolution);
  if (filters.status) add(index => `task.status = $${index}`, filters.status);
  if (filters.search) add(index => `(
    task.id::text ILIKE '%' || $${index} || '%'
    OR coalesce(task.user_name, '') ILIKE '%' || $${index} || '%'
    OR coalesce(task.email, '') ILIKE '%' || $${index} || '%'
  )`, filters.search);
  return { sql: conditions.join('\n       AND '), values };
}

function keysetPageTotalCountSql<Filters extends AnyCostFilters>(
  query: NormalizedKeysetQuery<Filters>,
) {
  return adminExactPageTotalCountSql(query);
}

function exactUtcTimestampSql(timestampSql: string) {
  return `to_char(${timestampSql} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

function makeKeysetPage<Row extends KeysetPageMetadata, Item, Filters extends AnyCostFilters>(
  rows: Row[],
  query: NormalizedKeysetQuery<Filters>,
  keyOf: (row: Row) => Array<string | number | null>,
  map: (row: Row) => Item,
) {
  return createAdminExactKeysetPage({ rows, query, keyOf, map });
}

function costKeysetOperator<Filters extends AnyCostFilters>(query: NormalizedKeysetQuery<Filters>) {
  return query.position === 'previous' ? '>' : '<';
}

function costKeysetDirection<Filters extends AnyCostFilters>(query: NormalizedKeysetQuery<Filters>) {
  return query.reverseQuery ? 'ASC' : 'DESC';
}

function emptyCostPage<Filters extends AnyCostFilters>(
  query: NormalizedKeysetQuery<Filters>,
  selection: CostSelection,
) {
  const page = createAdminExactKeysetPage({
    rows: [] as KeysetPageMetadata[], query, keyOf: () => [], map: () => null, totalItems: 0,
  });
  return {
    asOf: query.asOf,
    selection,
    items: [], pagination: page.pagination,
  };
}

function mapAttemptCost(row: AttemptCostRow) {
  const status = row.task_status === 'canceled'
    ? 'canceled' as const
    : row.usage_status === 'success' ? 'completed' as const : 'failed' as const;
  return {
    id: row.id,
    taskId: row.task_id,
    origin: row.origin === 'admin-direct' ? 'admin-direct' as const : 'generation-task' as const,
    providerTaskId: row.provider_task_id,
    attempt: Number(row.attempt),
    userId: row.user_id,
    userName: row.user_name ?? '-',
    email: row.email ?? '-',
    provider: row.provider,
    model: row.model,
    resolution: normalizeResolution(row.resolution),
    inputClass: normalizeInputClass(row.pricing_input_class),
    status,
    completionTokens: nullableInteger(row.completion_tokens),
    totalTokens: nullableInteger(row.total_tokens),
    billableTokens: nullableInteger(row.billable_tokens),
    billableBasis: row.billable_basis === 'completion_tokens'
      ? 'completion_tokens' as const
      : row.billable_basis === 'legacy_raw_units' ? 'raw_units_legacy' as const : 'unavailable' as const,
    unitPriceCnyPerMillion: nullableCny(row.unit_price_per_million),
    estimatedCostCny: nullableCny(row.estimated_cost),
    pricingVersion: row.price_version,
    estimateStatus: normalizeEstimateStatus(row),
    usageEvidenceOrigin: normalizeUsageEvidenceOrigin(row.usage_evidence_origin),
    pricingRuleStatus: normalizePricingRuleStatus(row.pricing_rule_status),
    reconciliationStatus: 'cannot-reconcile' as const,
    attributionConfidence: normalizeAttributionConfidence(row.attribution_confidence),
    costResolutionStatus: row.billable_tokens !== null && row.billable_tokens !== undefined
      ? 'recorded' as const
      : normalizeCostResolutionStatus(row.cost_resolution_case_status),
    costResolutionCaseId: row.cost_resolution_case_id ?? null,
    costResolutionCaseStatus: normalizeCostResolutionCaseStatus(row.cost_resolution_case_status),
    costResolutionEvidence: isJsonObject(row.cost_resolution_evidence)
      ? row.cost_resolution_evidence : null,
    accountingDate: row.local_accounting_date
      ? dateOnly(row.local_accounting_date)
      : beijingDate(row.completed_at ?? row.created_at),
    providerTerminalAt: row.provider_terminal_at ? toIsoDateTime(row.provider_terminal_at) : '-',
    usageObservedAt: row.usage_observed_at ? toIsoDateTime(row.usage_observed_at) : '-',
    createdAt: toIsoDateTime(row.created_at),
    completedAt: row.completed_at ? toIsoDateTime(row.completed_at) : '-',
    error: row.error,
  };
}

function mapBusinessTaskCost(row: BusinessTaskCostRow) {
  const missingUsageAttempts = toInt(row.missing_usage_attempts);
  const unpricedAttempts = toInt(row.unpriced_attempts);
  const estimatedCost = cnyMicros(row.estimated_cost_cny);
  const costFinalized = Boolean(row.cost_finalized);
  return {
    id: row.id,
    taskId: row.id,
    userId: row.user_id,
    userName: row.user_name ?? '-',
    email: row.email ?? '-',
    model: row.model,
    priceVersions: normalizePriceVersions(row.price_versions),
    status: normalizeGenerationStatus(row.status),
    resolution: normalizeResolution(row.resolution),
    configuredCredits: toInt(row.configured_credits),
    reservedCredits: toInt(row.reserved_credits),
    settledCredits: toInt(row.settled_credits),
    refundedCredits: toInt(row.refunded_credits),
    creditStatus: normalizeCreditStatus(row.credit_status),
    attemptCount: toInt(row.attempt_count),
    billableTokens: toInt(row.billable_tokens),
    estimatedCostCny: formatCnyMicros(estimatedCost),
    estimateCompleteness: businessEstimateCompleteness(
      costFinalized, estimatedCost, toInt(row.billable_tokens),
    ),
    costFinalized,
    costResolutionStatus: normalizeCostResolutionStatus(row.cost_resolution_status),
    costResolutionCaseId: row.cost_resolution_case_id ?? null,
    missingUsageAttempts,
    unpricedAttempts,
    createdAt: toIsoDateTime(row.created_at),
    completedAt: row.completed_at ? toIsoDateTime(row.completed_at) : '-',
  };
}

function mapBusinessUserCost(row: BusinessUserCostRow) {
  const taskCount = toInt(row.task_count);
  const totalCost = cnyMicros(row.estimated_cost_cny);
  const businessCost = cnyMicros(row.business_estimated_cost_cny);
  const operationalCost = cnyMicros(row.operational_estimated_cost_cny);
  const incompleteTaskCount = toInt(row.incomplete_task_count);
  const operationalUnpricedCallCount = toInt(row.operational_unpriced_call_count);
  return {
    id: row.id,
    userId: row.user_id,
    name: row.user_name ?? '-',
    email: row.email ?? '-',
    taskCount,
    operationalCallCount: toInt(row.operational_call_count),
    successfulTasks: toInt(row.successful_tasks),
    failedTasks: toInt(row.failed_tasks),
    canceledTasks: toInt(row.canceled_tasks),
    settledCredits: toInt(row.settled_credits),
    refundedCredits: toInt(row.refunded_credits),
    billableTokens: toInt(row.billable_tokens),
    estimatedCostCny: formatCnyMicros(totalCost),
    businessEstimatedCostCny: formatCnyMicros(businessCost),
    operationalEstimatedCostCny: formatCnyMicros(operationalCost),
    knownAccountCostCny: formatCnyMicros(totalCost),
    operationalUnpricedCallCount,
    estimateCompleteness: aggregateEstimateCompleteness(
      incompleteTaskCount + operationalUnpricedCallCount,
      totalCost,
    ),
    incompleteTaskCount,
    averageTaskCostCny: taskCount > 0
      ? formatCnyMicros(divideRounded(businessCost, BigInt(taskCount))) : null,
    lastTaskAt: row.last_task_at ? toIsoDateTime(row.last_task_at) : '-',
    lastActivityAt: toIsoDateTime(row.last_activity_at),
  };
}

function buildOperationsSummary(
  rows: BusinessTaskCostRow[],
  official: OfficialSummaryRow,
  officialAvailable: boolean,
  timingShiftCost: bigint,
  selectedModels: string[],
) {
  const taskCount = rows.length;
  const incompleteTaskCount = rows.filter(row => !row.cost_finalized).length;
  const estimatedCost = rows.reduce((sum, row) => sum + cnyMicros(row.estimated_cost_cny), 0n);
  const officialPriced = officialAvailable && toInt(official.unpriced_rows) === 0
    && official.list_equivalent_cost_cny !== null && official.list_equivalent_cost_cny !== undefined;
  const officialEquivalent = officialPriced ? cnyMicros(official.list_equivalent_cost_cny) : null;
  const { difference, status: reconciliationStatus } = resolveBusinessReconciliationStatus({
    incompleteTaskCount,
    estimatedCostMicros: estimatedCost,
    officialEquivalentMicros: officialEquivalent,
    timingShiftCostMicros: timingShiftCost,
  });
  const modelGroups = new Map<string, BusinessTaskCostRow[]>();
  for (const row of rows) modelGroups.set(row.model, [...(modelGroups.get(row.model) ?? []), row]);
  const operationModels = selectedModels
    .slice()
    .sort((left, right) => seedanceCostModelOrder(left) - seedanceCostModelOrder(right))
    .map(model => {
      const modelRows = modelGroups.get(model) ?? [];
      const modelCost = modelRows.reduce((sum, row) => sum + cnyMicros(row.estimated_cost_cny), 0n);
      const modelIncomplete = modelRows.filter(row => !row.cost_finalized).length;
      return {
        id: model,
        model,
        priceVersions: mergePriceVersions(modelRows.map(row => row.price_versions)),
        taskCount: modelRows.length,
        // 完整 dashboard 是业务任务审计视图；运营调用由主看盘与独立账单页读取。
        // 仍显式返回 0，避免把后台直连记录误算成业务任务。
        operationalCallCount: 0,
        settledCredits: modelRows.reduce((sum, row) => sum + toInt(row.settled_credits), 0),
        heldCredits: modelRows.reduce((sum, row) => (
          sum + (row.credit_status === 'held' ? toInt(row.reserved_credits) : 0)
        ), 0),
        refundedCredits: modelRows.reduce((sum, row) => sum + toInt(row.refunded_credits), 0),
        estimatedCostCny: formatCnyMicros(modelCost),
        businessEstimatedCostCny: formatCnyMicros(modelCost),
        operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: formatCnyMicros(modelCost),
        operationalUnpricedCallCount: 0,
        estimateCompleteness: aggregateEstimateCompleteness(modelIncomplete, modelCost),
        incompleteTaskCount: modelIncomplete,
        averageTaskCostCny: modelRows.length > 0
          ? formatCnyMicros(divideRounded(modelCost, BigInt(modelRows.length))) : null,
      };
    });
  return {
    taskCount,
    userCount: new Set(rows.map(row => row.user_id).filter(Boolean)).size,
    settledCredits: rows.reduce((sum, row) => sum + toInt(row.settled_credits), 0),
    heldCredits: rows.reduce((sum, row) => (
      sum + (row.credit_status === 'held' ? toInt(row.reserved_credits) : 0)
    ), 0),
    refundedCredits: rows.reduce((sum, row) => sum + toInt(row.refunded_credits), 0),
    estimatedCostCny: formatCnyMicros(estimatedCost),
    estimateCompleteness: aggregateEstimateCompleteness(incompleteTaskCount, estimatedCost),
    incompleteTaskCount,
    officialEquivalentCostCny: officialEquivalent === null ? null : formatCnyMicros(officialEquivalent),
    differenceCny: difference === null ? null : formatCnyMicros(difference),
    officialPayableCny: officialAvailable ? nullableCny(official.payable_amount_cny) : null,
    reconciliationStatus,
    models: operationModels,
  };
}

function normalizePriceVersions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => (
    typeof item === 'string' && item.trim().length > 0
  )))].sort((left, right) => left.localeCompare(right));
}

function mergePriceVersions(values: unknown[]) {
  return normalizePriceVersions(values.flatMap(value => (
    Array.isArray(value) ? value : []
  )));
}

export function resolveBusinessReconciliationStatus({
  incompleteTaskCount,
  estimatedCostMicros,
  officialEquivalentMicros,
  timingShiftCostMicros,
}: {
  incompleteTaskCount: number;
  estimatedCostMicros: bigint;
  officialEquivalentMicros: bigint | null;
  timingShiftCostMicros: bigint;
}) {
  const difference = officialEquivalentMicros === null
    ? null
    : officialEquivalentMicros - estimatedCostMicros;
  if (difference === null) return { difference, status: 'unavailable' as const };
  if (incompleteTaskCount > 0) return { difference, status: 'incomplete' as const };
  if (difference === 0n) return { difference, status: 'matched' as const };
  if (difference === timingShiftCostMicros) {
    return { difference, status: 'matched-adjusted' as const };
  }
  return { difference, status: 'difference' as const };
}

function businessEstimateCompleteness(finalized: boolean, cost: bigint, tokens: number) {
  if (finalized) return 'complete' as const;
  return cost > 0n || tokens > 0 ? 'partial' as const : 'unavailable' as const;
}

function aggregateEstimateCompleteness(incompleteTaskCount: number, knownCost: bigint) {
  if (incompleteTaskCount === 0) return 'complete' as const;
  return knownCost > 0n ? 'partial' as const : 'unavailable' as const;
}

function normalizeEstimateStatus(row: AttemptCostRow) {
  if (row.billable_tokens === null || row.billable_tokens === undefined) return 'missing-usage' as const;
  if (row.pricing_status === 'priced') return 'priced' as const;
  if (row.pricing_status === 'legacy-inferred') return 'legacy-inferred' as const;
  if (row.resolution && row.model) return 'unsupported' as const;
  return 'unpriced' as const;
}

function normalizeCostResolutionStatus(value: string | null) {
  if (value === 'recorded') return 'recorded' as const;
  if (value === 'approved' || value === 'approved-zero') return 'approved-zero' as const;
  if (value === 'open' || value === 'pending-final-bill') return 'pending-final-bill' as const;
  return 'unresolved' as const;
}

function normalizeCostResolutionCaseStatus(value: string | null) {
  if (value === 'open' || value === 'approved' || value === 'superseded') return value;
  return null;
}

function normalizeGenerationStatus(value: string) {
  if (value === 'queued' || value === 'processing' || value === 'completed'
    || value === 'failed' || value === 'canceled') return value;
  return 'failed' as const;
}

function normalizeCreditStatus(value: string) {
  if (value === 'none' || value === 'held' || value === 'settled'
    || value === 'refunded' || value === 'reversed') return value;
  return 'none' as const;
}

function normalizeResolution(value: string | null) {
  const normalized = value?.toLowerCase();
  if (normalized === '480p' || normalized === '720p' || normalized === '1080p' || normalized === '4k') return normalized;
  return 'unknown' as const;
}

function resolveAsOf(rawQuery: unknown) {
  const value = rawQuery && typeof rawQuery === 'object'
    ? (rawQuery as { asOf?: unknown }).asOf
    : undefined;
  const parsed = value === undefined ? new Date() : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error('asOf 时间无效'), { statusCode: 400, code: 'INVALID_AS_OF' });
  }
  if (parsed.getTime() > Date.now() + 5 * 60_000) {
    throw Object.assign(new Error('asOf 不能晚于当前时间'), { statusCode: 400, code: 'FUTURE_AS_OF' });
  }
  return parsed.toISOString();
}

function resolveSelectedModels(rawQuery: unknown) {
  const model = rawQuery && typeof rawQuery === 'object' ? (rawQuery as { model?: unknown }).model : undefined;
  if (model === undefined || model === null || model === '') return [...SEEDANCE_COST_MODEL_LABELS];
  if (!SEEDANCE_COST_MODEL_LABELS.includes(String(model) as (typeof SEEDANCE_COST_MODEL_LABELS)[number])) {
    throw Object.assign(new Error('不支持的 Seedance 模型筛选'), { statusCode: 400, code: 'INVALID_MODEL' });
  }
  return [String(model)];
}

async function readObservedCoverage(client: DbClient, asOf: string, model?: string) {
  const models = resolveSelectedModels({ model });
  const result = await client.query<CostCoverageRow>(
    `WITH limits AS (
       SELECT ($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::date AS today
     ), local_usage_days AS (
       SELECT DISTINCT coalesce(
                local_accounting_date,
                (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date
              ) AS start_date
       FROM provider_usage_records
       WHERE provider = $1 AND model = ANY($2::text[]) AND usage_unit = 'tokens'
         AND currency = 'CNY' AND created_at <= $3
     ), local_manifest_intervals AS (
       SELECT window_start AS start_date, least(window_end, limits.today) AS end_date
       FROM provider_reconciliation_runs, limits
       WHERE provider = $1 AND local_cutoff <= $3 AND window_start <= limits.today
     ), local_intervals AS (
       SELECT start_date, start_date AS end_date FROM local_usage_days
       UNION
       SELECT start_date, end_date FROM local_manifest_intervals
     ), latest_manifests AS MATERIALIZED (
       SELECT DISTINCT ON (official_sync_run_id) official_sync_run_id, bill_state
       FROM provider_reconciliation_runs
       WHERE official_sync_run_id IS NOT NULL
       ORDER BY official_sync_run_id, created_at DESC, id DESC
     ), valid_bill_runs AS MATERIALIZED (
       SELECT runs.id, runs.window_start, least(runs.window_end, limits.today) AS window_end,
              runs.completed_at, runs.is_final,
              coalesce(manifests.bill_state, CASE WHEN runs.is_final THEN 'final' ELSE 'provisional' END) AS bill_state
       FROM provider_billing_sync_runs runs
       LEFT JOIN latest_manifests manifests ON manifests.official_sync_run_id = runs.id
       CROSS JOIN limits
       WHERE runs.provider = $1 AND runs.kind = 'bill' AND runs.status = 'success'
         AND runs.completed_at <= $3 AND runs.window_start <= limits.today
         AND (
           EXISTS (
             SELECT 1 FROM provider_bill_sync_run_items evidence
             WHERE evidence.sync_run_id = runs.id
           )
           OR EXISTS (
             SELECT 1 FROM provider_reconciliation_runs evidence
             WHERE evidence.official_sync_run_id = runs.id
           )
         )
     ), official_run_day_candidates AS (
       SELECT days.day::date AS day, runs.id, runs.completed_at,
              runs.is_final, runs.bill_state,
              row_number() OVER (
                PARTITION BY days.day::date
                ORDER BY runs.completed_at DESC, runs.id DESC
              ) AS run_rank
       FROM valid_bill_runs runs
       CROSS JOIN generate_series(runs.window_start, runs.window_end, interval '1 day') days(day)
     ), official_run_days AS (
       SELECT day AS start_date, day AS end_date, is_final, bill_state
       FROM official_run_day_candidates
       WHERE run_rank = 1
     ), official_detail_days AS (
       SELECT DISTINCT details.expense_date AS start_date, details.expense_date AS end_date,
              details.is_final, CASE WHEN details.is_final THEN 'final' ELSE 'provisional' END AS bill_state
       FROM provider_bill_details details CROSS JOIN limits
       WHERE details.provider = $1 AND details.product = $4 AND details.active = true
         AND details.currency = 'CNY' AND details.recognized_model = ANY($2::text[])
         AND details.bill_line_type = 'usage' AND details.synced_at <= $3
         AND details.expense_date <= limits.today
         AND NOT EXISTS (
           SELECT 1 FROM official_run_days run_days WHERE run_days.start_date = details.expense_date
         )
     ), official_intervals AS (
       SELECT * FROM official_run_days
       UNION
       SELECT * FROM official_detail_days
     )
     SELECT (SELECT min(start_date) FROM local_intervals) AS local_start,
            (SELECT max(end_date) FROM local_intervals) AS local_end,
            (SELECT coalesce(jsonb_agg(jsonb_build_object('start', start_date, 'end', end_date)
                                      ORDER BY start_date, end_date), '[]'::jsonb)
             FROM local_intervals) AS local_intervals,
            (SELECT min(start_date) FROM official_intervals) AS official_start,
            (SELECT max(end_date) FROM official_intervals) AS official_end,
            (SELECT coalesce(jsonb_agg(jsonb_build_object(
                                      'start', start_date, 'end', end_date,
                                      'isFinal', is_final, 'billState', bill_state)
                                      ORDER BY start_date, end_date), '[]'::jsonb)
             FROM official_intervals) AS official_intervals`,
    [PROVIDER, models, asOf, OFFICIAL_PRODUCT],
  );
  return normalizeObservedCoverage(result.rows[0]);
}

async function readOfficialDetailsAsOf(
  client: DbClient,
  input: { start: string; end: string; asOf: string; product?: string; models?: string[] },
) {
  return (await readOfficialSnapshotAsOf(client, input)).details;
}

async function readOfficialSnapshotAsOf(
  client: DbClient,
  input: { start: string; end: string; asOf: string; product?: string; models?: string[] },
) {
  const result = await client.query<OfficialRevisionRow>(
    `WITH selected_dates AS MATERIALIZED (
       SELECT generated.day::date AS day
       FROM generate_series($1::date, $2::date, interval '1 day') generated(day)
       WHERE generated.day::date <= ($4::timestamptz AT TIME ZONE 'Asia/Shanghai')::date
     ), latest_manifests AS MATERIALIZED (
       SELECT DISTINCT ON (official_sync_run_id) official_sync_run_id, bill_state
       FROM provider_reconciliation_runs
       WHERE official_sync_run_id IS NOT NULL
       ORDER BY official_sync_run_id, created_at DESC, id DESC
     ), valid_bill_runs AS MATERIALIZED (
       SELECT runs.id, runs.window_start, runs.window_end, runs.completed_at,
              coalesce(manifests.bill_state, CASE WHEN runs.is_final THEN 'final' ELSE 'provisional' END) AS bill_state
       FROM provider_billing_sync_runs runs
       LEFT JOIN latest_manifests manifests ON manifests.official_sync_run_id = runs.id
       WHERE runs.provider = $3 AND runs.kind = 'bill' AND runs.status = 'success'
         AND runs.completed_at <= $4
         AND runs.window_start <= $2::date AND runs.window_end >= $1::date
         AND (
           EXISTS (
             SELECT 1 FROM provider_bill_sync_run_items evidence
             WHERE evidence.sync_run_id = runs.id
           )
           OR EXISTS (
             SELECT 1 FROM provider_reconciliation_runs evidence
             WHERE evidence.official_sync_run_id = runs.id
           )
         )
     ), selected_run_candidates AS (
       SELECT dates.day, runs.id, runs.bill_state,
              row_number() OVER (
                PARTITION BY dates.day
                ORDER BY runs.completed_at DESC, runs.id DESC
              ) AS run_rank
       FROM selected_dates dates
       JOIN valid_bill_runs runs
         ON runs.window_start <= dates.day AND runs.window_end >= dates.day
     ), selected_runs AS MATERIALIZED (
       SELECT day, id, bill_state = 'final' AS is_final
       FROM selected_run_candidates
       WHERE run_rank = 1
     ), revision_rows AS (
       SELECT revisions.id AS revision_id, items.source_detail_key, revisions.normalized_payload, runs.is_final
       FROM selected_runs runs
       JOIN provider_bill_sync_run_items items ON items.sync_run_id = runs.id
       JOIN provider_bill_detail_revisions revisions ON revisions.id = items.bill_detail_revision_id
       WHERE (revisions.normalized_payload->>'expenseDate')::date = runs.day
         AND ($5::text IS NULL OR revisions.normalized_payload->>'product' = $5)
         AND (
           $6::text[] IS NULL
           OR revisions.normalized_payload->>'recognizedModel' = ANY($6::text[])
           OR (
             revisions.normalized_payload->>'recognizedModel' IS NULL
             AND (
               revisions.normalized_payload->>'seedanceCandidate' = 'true'
               OR lower(concat_ws(' ', revisions.raw_payload->>'ConfigName',
                    revisions.raw_payload->>'ConfigurationCode', revisions.raw_payload->>'ElementCode',
                    revisions.raw_payload->>'FactorCode')) LIKE '%seedance%'
             )
           )
         )
         AND coalesce(revisions.normalized_payload->>'currency', 'CNY') = 'CNY'
     ), fallback_rows AS (
       SELECT coalesce(details.current_revision_id, details.id) AS revision_id, details.source_detail_key,
              jsonb_build_object(
                'billPeriod', details.bill_period,
                'expenseDate', details.expense_date,
                'product', details.product,
                'billLineType', details.bill_line_type,
                'recognizedModel', details.recognized_model,
                'seedanceCandidate', details.recognized_model = ANY($7::text[])
                  OR lower(concat_ws(' ', details.config_name, details.configuration_code,
                     details.element_code, details.factor_code)) LIKE '%seedance%',
                'pricingResolution', details.pricing_resolution,
                'pricingInputHasVideo', details.pricing_input_has_video,
                'normalizedUnitPricePerMillion', details.normalized_unit_price_per_million,
                'billableTokens', details.billable_tokens,
                'deductionCount', details.deduction_count,
                'listEquivalentCostCny', details.list_equivalent_cost_cny,
                'originalBillAmountCny', details.original_bill_amount_cny,
                'preferentialBillAmountCny', details.preferential_bill_amount_cny,
                'discountBillAmountCny', details.discount_bill_amount_cny,
                'couponAmountCny', details.coupon_amount_cny,
                'payableAmountCny', details.payable_amount_cny,
                'paidAmountCny', details.paid_amount_cny,
                'unpaidAmountCny', details.unpaid_amount_cny,
                'currency', details.currency,
                'instanceNo', details.instance_no
              ) AS normalized_payload,
              details.is_final
       FROM provider_bill_details details
       WHERE details.provider = $3 AND details.active = true
         AND details.expense_date BETWEEN $1::date AND $2::date
         AND details.expense_date <= ($4::timestamptz AT TIME ZONE 'Asia/Shanghai')::date
         AND details.synced_at <= $4 AND details.currency = 'CNY'
         AND ($5::text IS NULL OR details.product = $5)
         AND (
           $6::text[] IS NULL
           OR details.recognized_model = ANY($6::text[])
           OR (
             details.recognized_model IS NULL
             AND lower(concat_ws(' ', details.config_name, details.configuration_code,
                   details.element_code, details.factor_code)) LIKE '%seedance%'
           )
         )
         AND NOT EXISTS (SELECT 1 FROM selected_runs runs WHERE runs.day = details.expense_date)
     ), combined_rows AS (
       SELECT * FROM revision_rows
       UNION ALL
       SELECT * FROM fallback_rows
     ), coverage AS (
       SELECT count(*) FILTER (WHERE id IS NOT NULL) = count(*) AS complete
       FROM selected_dates dates
       LEFT JOIN selected_runs runs ON runs.day = dates.day
     )
     SELECT rows.*, coverage.complete AS coverage_complete
     FROM combined_rows rows CROSS JOIN coverage
     UNION ALL
     SELECT NULL::uuid AS revision_id, NULL::text AS source_detail_key,
            NULL::jsonb AS normalized_payload, NULL::boolean AS is_final,
            coverage.complete AS coverage_complete
     FROM coverage
     WHERE NOT EXISTS (SELECT 1 FROM combined_rows)`,
    [
      input.start, input.end, PROVIDER, input.asOf, input.product ?? null,
      input.models ?? null, [...SEEDANCE_COST_MODEL_LABELS],
    ],
  );
  return {
    details: result.rows.map(mapOfficialRevisionRow).filter((item): item is OfficialAsOfDetail => item !== null),
    coverageComplete: result.rows[0]?.coverage_complete === true,
  };
}

/**
 * 结算列表不能复用 readOfficialDetailsAsOf：后者会把整个账期快照搬进 Node.js。
 * 这里在同一条 SQL 内完成 as-of 修订选择、摘要聚合、筛选、四向 keyset 和 limit+1，
 * 最终只向进程返回当前页（外加一条判定边界的记录）。
 */
async function readOfficialSettlementPageSnapshot(
  client: DbClient,
  query: NormalizedKeysetQuery<CostSettlementFilters>,
  selection: CostSelection,
) {
  const cursor = query.cursor?.key ?? [];
  const direction = costKeysetDirection(query);
  const result = await client.query<SettlementSnapshotPageRow>(
    `WITH selected_dates AS MATERIALIZED (
       SELECT generated.day::date AS day
       FROM generate_series($1::date, $2::date, interval '1 day') generated(day)
       WHERE generated.day::date <= ($4::timestamptz AT TIME ZONE 'Asia/Shanghai')::date
     ), latest_manifests AS MATERIALIZED (
       SELECT DISTINCT ON (official_sync_run_id) official_sync_run_id, bill_state
       FROM provider_reconciliation_runs
       WHERE official_sync_run_id IS NOT NULL
       ORDER BY official_sync_run_id, created_at DESC, id DESC
     ), valid_bill_runs AS MATERIALIZED (
       SELECT runs.id, runs.window_start, runs.window_end, runs.completed_at,
              coalesce(manifests.bill_state, CASE WHEN runs.is_final THEN 'final' ELSE 'provisional' END) AS bill_state
       FROM provider_billing_sync_runs runs
       LEFT JOIN latest_manifests manifests ON manifests.official_sync_run_id = runs.id
       WHERE runs.provider = $3 AND runs.kind = 'bill' AND runs.status = 'success'
         AND runs.completed_at <= $4
         AND runs.window_start <= $2::date AND runs.window_end >= $1::date
         AND (
           EXISTS (
             SELECT 1 FROM provider_bill_sync_run_items evidence
             WHERE evidence.sync_run_id = runs.id
           )
           OR EXISTS (
             SELECT 1 FROM provider_reconciliation_runs evidence
             WHERE evidence.official_sync_run_id = runs.id
           )
         )
     ), selected_run_candidates AS (
       SELECT dates.day, runs.id, runs.bill_state,
              row_number() OVER (
                PARTITION BY dates.day
                ORDER BY runs.completed_at DESC, runs.id DESC
              ) AS run_rank
       FROM selected_dates dates
       JOIN valid_bill_runs runs
         ON runs.window_start <= dates.day AND runs.window_end >= dates.day
     ), selected_runs AS MATERIALIZED (
       SELECT day, id, bill_state = 'final' AS is_final
       FROM selected_run_candidates
       WHERE run_rank = 1
     ), revision_rows AS (
       SELECT revisions.id AS revision_id, items.source_detail_key, revisions.normalized_payload, runs.is_final
       FROM selected_runs runs
       JOIN provider_bill_sync_run_items items ON items.sync_run_id = runs.id
       JOIN provider_bill_detail_revisions revisions ON revisions.id = items.bill_detail_revision_id
       WHERE (revisions.normalized_payload->>'expenseDate')::date = runs.day
         AND revisions.normalized_payload->>'product' = $5
         AND (
           revisions.normalized_payload->>'recognizedModel' = ANY($6::text[])
           OR (
             revisions.normalized_payload->>'recognizedModel' IS NULL
             AND (
               revisions.normalized_payload->>'seedanceCandidate' = 'true'
               OR lower(concat_ws(' ', revisions.raw_payload->>'ConfigName',
                    revisions.raw_payload->>'ConfigurationCode', revisions.raw_payload->>'ElementCode',
                    revisions.raw_payload->>'FactorCode')) LIKE '%seedance%'
             )
           )
         )
         AND coalesce(revisions.normalized_payload->>'currency', 'CNY') = 'CNY'
     ), fallback_rows AS (
       SELECT coalesce(details.current_revision_id, details.id) AS revision_id, details.source_detail_key,
              jsonb_build_object(
                'billPeriod', details.bill_period,
                'expenseDate', details.expense_date,
                'product', details.product,
                'billLineType', details.bill_line_type,
                'recognizedModel', details.recognized_model,
                'seedanceCandidate', details.recognized_model = ANY($7::text[])
                  OR lower(concat_ws(' ', details.config_name, details.configuration_code,
                     details.element_code, details.factor_code)) LIKE '%seedance%',
                'pricingResolution', details.pricing_resolution,
                'pricingInputHasVideo', details.pricing_input_has_video,
                'normalizedUnitPricePerMillion', details.normalized_unit_price_per_million,
                'billableTokens', details.billable_tokens,
                'deductionCount', details.deduction_count,
                'listEquivalentCostCny', details.list_equivalent_cost_cny,
                'originalBillAmountCny', details.original_bill_amount_cny,
                'preferentialBillAmountCny', details.preferential_bill_amount_cny,
                'discountBillAmountCny', details.discount_bill_amount_cny,
                'couponAmountCny', details.coupon_amount_cny,
                'payableAmountCny', details.payable_amount_cny,
                'paidAmountCny', details.paid_amount_cny,
                'unpaidAmountCny', details.unpaid_amount_cny,
                'currency', details.currency,
                'instanceNo', details.instance_no
              ) AS normalized_payload,
              details.is_final
       FROM provider_bill_details details
       WHERE details.provider = $3 AND details.active = true
         AND details.expense_date BETWEEN $1::date AND $2::date
         AND details.expense_date <= ($4::timestamptz AT TIME ZONE 'Asia/Shanghai')::date
         AND details.synced_at <= $4 AND details.currency = 'CNY'
         AND details.product = $5
         AND (
           details.recognized_model = ANY($6::text[])
           OR (
             details.recognized_model IS NULL
             AND lower(concat_ws(' ', details.config_name, details.configuration_code,
                   details.element_code, details.factor_code)) LIKE '%seedance%'
           )
         )
         AND NOT EXISTS (SELECT 1 FROM selected_runs runs WHERE runs.day = details.expense_date)
     ), combined_rows AS (
       SELECT * FROM revision_rows
       UNION ALL
       SELECT * FROM fallback_rows
     ), text_rows AS (
       SELECT rows.*,
              CASE WHEN normalized_payload->>'billLineType' IN ('usage','package-purchase','refund','adjustment')
                THEN normalized_payload->>'billLineType' ELSE 'other' END AS bill_line_type,
              normalized_payload->>'recognizedModel' AS recognized_model,
              normalized_payload->>'seedanceCandidate' = 'true' AS seedance_candidate,
              (normalized_payload->>'expenseDate')::date AS expense_date,
              normalized_payload->>'originalBillAmountCny' AS original_text,
              normalized_payload->>'payableAmountCny' AS payable_text,
              normalized_payload->>'paidAmountCny' AS paid_text,
              normalized_payload->>'unpaidAmountCny' AS unpaid_text,
              normalized_payload->>'listEquivalentCostCny' AS list_price_text
       FROM combined_rows rows
     ), normalized_rows AS (
       SELECT rows.*,
              CASE WHEN original_text ~ '^-?[0-9]+([.][0-9]+)?$' THEN round(original_text::numeric, 6) ELSE 0::numeric END AS original_value,
              CASE WHEN payable_text ~ '^-?[0-9]+([.][0-9]+)?$' THEN round(payable_text::numeric, 6) ELSE 0::numeric END AS payable_value,
              CASE WHEN paid_text ~ '^-?[0-9]+([.][0-9]+)?$' THEN round(paid_text::numeric, 6) ELSE 0::numeric END AS paid_value,
              CASE WHEN unpaid_text ~ '^-?[0-9]+([.][0-9]+)?$' THEN round(unpaid_text::numeric, 6) ELSE 0::numeric END AS unpaid_value,
              CASE WHEN list_price_text ~ '^-?[0-9]+([.][0-9]+)?$' THEN round(list_price_text::numeric, 6) ELSE 0::numeric END AS list_price_value,
              CASE
                WHEN (CASE WHEN payable_text ~ '^-?[0-9]+([.][0-9]+)?$' THEN round(payable_text::numeric, 6) ELSE 0::numeric END) = 0 THEN 'zero'
                WHEN (CASE WHEN paid_text ~ '^-?[0-9]+([.][0-9]+)?$' THEN round(paid_text::numeric, 6) ELSE 0::numeric END) > 0
                 AND (CASE WHEN unpaid_text ~ '^-?[0-9]+([.][0-9]+)?$' THEN round(unpaid_text::numeric, 6) ELSE 0::numeric END) > 0 THEN 'partial'
                WHEN (CASE WHEN paid_text ~ '^-?[0-9]+([.][0-9]+)?$' THEN round(paid_text::numeric, 6) ELSE 0::numeric END) <= 0
                 AND (CASE WHEN unpaid_text ~ '^-?[0-9]+([.][0-9]+)?$' THEN round(unpaid_text::numeric, 6) ELSE 0::numeric END) > 0 THEN 'unpaid'
                WHEN (CASE WHEN paid_text ~ '^-?[0-9]+([.][0-9]+)?$' THEN round(paid_text::numeric, 6) ELSE 0::numeric END) > 0
                 AND (CASE WHEN unpaid_text ~ '^-?[0-9]+([.][0-9]+)?$' THEN round(unpaid_text::numeric, 6) ELSE 0::numeric END) <= 0 THEN 'paid'
                ELSE 'unknown'
              END AS payment_status
       FROM text_rows rows
     ), summary AS (
       SELECT
         CASE WHEN coalesce(bool_or(original_text IS NULL) FILTER (WHERE bill_line_type = 'usage'), false) THEN NULL
              ELSE coalesce(sum(original_value) FILTER (WHERE bill_line_type = 'usage'), 0) END AS usage_original_amount_cny,
         CASE WHEN coalesce(bool_or(payable_text IS NULL) FILTER (WHERE bill_line_type = 'usage'), false) THEN NULL
              ELSE coalesce(sum(payable_value) FILTER (WHERE bill_line_type = 'usage'), 0) END AS usage_payable_amount_cny,
         CASE WHEN coalesce(bool_or(paid_text IS NULL) FILTER (WHERE bill_line_type = 'usage'), false) THEN NULL
              ELSE coalesce(sum(paid_value) FILTER (WHERE bill_line_type = 'usage'), 0) END AS usage_paid_amount_cny,
         CASE WHEN coalesce(bool_or(unpaid_text IS NULL) FILTER (WHERE bill_line_type = 'usage'), false) THEN NULL
              ELSE coalesce(sum(unpaid_value) FILTER (WHERE bill_line_type = 'usage'), 0) END AS usage_unpaid_amount_cny,
         CASE WHEN coalesce(bool_or(payable_text IS NULL) FILTER (WHERE bill_line_type = 'package-purchase'), false) THEN NULL
              ELSE coalesce(sum(payable_value) FILTER (WHERE bill_line_type = 'package-purchase'), 0) END AS package_purchase_amount_cny,
         CASE WHEN coalesce(bool_or(paid_text IS NULL) FILTER (WHERE bill_line_type = 'package-purchase'), false) THEN NULL
              ELSE coalesce(sum(paid_value) FILTER (WHERE bill_line_type = 'package-purchase'), 0) END AS package_purchase_paid_amount_cny,
         CASE WHEN coalesce(bool_or(unpaid_text IS NULL) FILTER (WHERE bill_line_type = 'package-purchase'), false) THEN NULL
              ELSE coalesce(sum(unpaid_value) FILTER (WHERE bill_line_type = 'package-purchase'), 0) END AS package_purchase_unpaid_amount_cny,
         CASE WHEN coalesce(bool_or(payable_text IS NULL) FILTER (WHERE bill_line_type = 'refund'), false) THEN NULL
              ELSE coalesce(sum(payable_value) FILTER (WHERE bill_line_type = 'refund'), 0) END AS refund_amount_cny,
         CASE WHEN coalesce(bool_or(payable_text IS NULL) FILTER (WHERE bill_line_type = 'adjustment'), false) THEN NULL
              ELSE coalesce(sum(payable_value) FILTER (WHERE bill_line_type = 'adjustment'), 0) END AS billing_adjustment_amount_cny,
         CASE WHEN coalesce(bool_or(payable_text IS NULL), false) THEN NULL
              ELSE coalesce(sum(payable_value), 0) END AS net_official_payable_cny,
         CASE
           WHEN count(*) FILTER (WHERE bill_line_type = 'usage' OR (bill_line_type = 'other' AND seedance_candidate)) = 0 THEN NULL
           WHEN coalesce(bool_or(
             list_price_text IS NULL OR (seedance_candidate AND recognized_model IS NULL)
           ) FILTER (WHERE bill_line_type = 'usage' OR (bill_line_type = 'other' AND seedance_candidate)), false) THEN NULL
           ELSE coalesce(sum(list_price_value) FILTER (
             WHERE bill_line_type = 'usage' OR (bill_line_type = 'other' AND seedance_candidate)
           ), 0)
         END AS list_price_cost_cny,
         CASE
           WHEN count(*) FILTER (WHERE bill_line_type = 'usage' OR (bill_line_type = 'other' AND seedance_candidate)) = 0 THEN 'unavailable'
           WHEN coalesce(bool_or(
             list_price_text IS NULL OR (seedance_candidate AND recognized_model IS NULL)
           ) FILTER (WHERE bill_line_type = 'usage' OR (bill_line_type = 'other' AND seedance_candidate)), false) THEN 'unpriced'
           ELSE 'priced'
         END AS list_price_status
       FROM normalized_rows
     ), page_rows AS (
       SELECT rows.*,
              ${keysetPageTotalCountSql(query)} AS __pagination_total_count
       FROM normalized_rows rows
       WHERE ($8::text IS NULL OR rows.bill_line_type = $8)
         AND ($9::text IS NULL OR rows.payment_status = $9)
         AND ($10::numeric IS NULL OR (
           abs(rows.payable_value), rows.expense_date, rows.revision_id
         ) ${costKeysetOperator(query)} (
           $10::numeric, $11::date, $12::uuid
         ))
       ORDER BY abs(rows.payable_value) ${direction}, rows.expense_date ${direction},
                rows.revision_id ${direction}
       LIMIT $13
     )
     SELECT page.revision_id, page.source_detail_key, page.normalized_payload, page.is_final,
            page.__pagination_total_count,
            summary.usage_original_amount_cny, summary.usage_payable_amount_cny,
            summary.usage_paid_amount_cny, summary.usage_unpaid_amount_cny,
            summary.package_purchase_amount_cny, summary.package_purchase_paid_amount_cny,
            summary.package_purchase_unpaid_amount_cny, summary.refund_amount_cny,
            summary.billing_adjustment_amount_cny, summary.net_official_payable_cny,
            summary.list_price_cost_cny, summary.list_price_status
     FROM summary
     LEFT JOIN page_rows page ON true
     ORDER BY abs(page.payable_value) ${direction} NULLS LAST, page.expense_date ${direction} NULLS LAST,
              page.revision_id ${direction} NULLS LAST`,
    [
      selection.rangeStart,
      selection.rangeEnd,
      PROVIDER,
      query.asOf,
      OFFICIAL_PRODUCT,
      resolveSelectedModels(query.filters),
      [...SEEDANCE_COST_MODEL_LABELS],
      query.filters.billLineType ?? null,
      query.filters.paymentStatus ?? null,
      cursor[0] ?? null,
      cursor[1] ?? null,
      cursor[2] ?? null,
      query.limit + 1,
    ],
  );
  const summary = result.rows[0] ?? {} as SettlementSnapshotPageRow;
  const details = result.rows
    .map(mapOfficialRevisionRow)
    .filter((item): item is OfficialAsOfDetail => item !== null);
  return {
    details,
    totalCount: result.rows.find(row => row.source_detail_key !== null)
      ?.__pagination_total_count ?? null,
    summary: {
      usage_original_amount_cny: summary.usage_original_amount_cny,
      usage_payable_amount_cny: summary.usage_payable_amount_cny,
      usage_paid_amount_cny: summary.usage_paid_amount_cny,
      usage_unpaid_amount_cny: summary.usage_unpaid_amount_cny,
      package_purchase_amount_cny: summary.package_purchase_amount_cny,
      package_purchase_paid_amount_cny: summary.package_purchase_paid_amount_cny,
      package_purchase_unpaid_amount_cny: summary.package_purchase_unpaid_amount_cny,
      refund_amount_cny: summary.refund_amount_cny,
      billing_adjustment_amount_cny: summary.billing_adjustment_amount_cny,
      net_official_payable_cny: summary.net_official_payable_cny,
    } satisfies SettlementSummaryRow,
    listPrice: {
      cost: summary.list_price_status === 'priced' && summary.list_price_cost_cny !== null
        ? cnyMicros(summary.list_price_cost_cny) : null,
      status: summary.list_price_status ?? 'unavailable',
    } satisfies ListPriceSummary,
  };
}

function mapOfficialRevisionRow(row: OfficialRevisionRow): OfficialAsOfDetail | null {
  if (!row.source_detail_key || !isJsonObject(row.normalized_payload)) return null;
  const payload = row.normalized_payload;
  const expenseDate = String(payload.expenseDate ?? '').slice(0, 10);
  const billPeriod = String(payload.billPeriod ?? expenseDate.slice(0, 7));
  const product = String(payload.product ?? '');
  if (!isIsoDate(expenseDate) || !/^\d{4}-\d{2}$/.test(billPeriod) || !product) return null;
  const inputVideo = payload.pricingInputHasVideo;
  return {
    revisionId: row.revision_id ?? null,
    sourceDetailKey: row.source_detail_key,
    billPeriod,
    expenseDate,
    product,
    billLineType: normalizeBillLineType(String(payload.billLineType ?? 'other')),
    recognizedModel: typeof payload.recognizedModel === 'string' ? payload.recognizedModel : null,
    seedanceCandidate: payload.seedanceCandidate === true || payload.seedanceCandidate === 'true',
    pricingResolution: typeof payload.pricingResolution === 'string' ? payload.pricingResolution : null,
    pricingInputHasVideo: typeof inputVideo === 'boolean' ? inputVideo : null,
    normalizedUnitPricePerMillion: payload.normalizedUnitPricePerMillion ?? null,
    billableTokens: payload.billableTokens ?? null,
    deductionCount: payload.deductionCount ?? null,
    listEquivalentCostCny: payload.listEquivalentCostCny ?? null,
    originalBillAmountCny: payload.originalBillAmountCny ?? null,
    preferentialBillAmountCny: payload.preferentialBillAmountCny ?? null,
    discountBillAmountCny: payload.discountBillAmountCny ?? null,
    couponAmountCny: payload.couponAmountCny ?? null,
    payableAmountCny: payload.payableAmountCny ?? null,
    paidAmountCny: payload.paidAmountCny ?? null,
    unpaidAmountCny: payload.unpaidAmountCny ?? null,
    currency: 'CNY',
    instanceNo: typeof payload.instanceNo === 'string' ? payload.instanceNo : null,
    isFinal: Boolean(row.is_final),
  };
}

function normalizeObservedCoverage(row: CostCoverageRow | undefined): ObservedCoverage {
  const localStart = row?.local_start ? dateOnly(row.local_start) : null;
  const localEnd = row?.local_end ? dateOnly(row.local_end) : null;
  const officialStart = row?.official_start ? dateOnly(row.official_start) : null;
  const officialEnd = row?.official_end ? dateOnly(row.official_end) : null;
  return {
    localStart,
    localEnd,
    officialStart,
    officialEnd,
    localIntervals: normalizeCoverageIntervals(row?.local_intervals, localStart, localEnd),
    officialIntervals: normalizeCoverageIntervals(row?.official_intervals, officialStart, officialEnd),
  };
}

function normalizeCoverageIntervals(value: unknown, fallbackStart: string | null, fallbackEnd: string | null) {
  const rows = Array.isArray(value) ? value : [];
  const intervals = rows.flatMap((item): DateInterval[] => {
    if (!isJsonObject(item)) return [];
    const start = typeof item.start === 'string' ? dateOnly(item.start) : null;
    const end = typeof item.end === 'string' ? dateOnly(item.end) : null;
    const isFinal = typeof item.isFinal === 'boolean' ? item.isFinal : undefined;
    const billState = item.billState === 'final' || item.billState === 'reopened' || item.billState === 'provisional'
      ? item.billState : undefined;
    return start && end && isIsoDate(start) && isIsoDate(end) && start <= end
      ? [{ start, end, isFinal, billState }] : [];
  });
  if (intervals.length > 0) return intervals;
  // 兼容 036 迁移前快照和测试桩；新查询始终返回显式区间数组。
  return fallbackStart && fallbackEnd ? [{ start: fallbackStart, end: fallbackEnd }] : [];
}

function resolveCostSelection(
  rawQuery: unknown,
  observed: ObservedCoverage,
  asOf: Date | string = new Date(),
): CostSelection {
  const value = (rawQuery && typeof rawQuery === 'object' ? rawQuery : {}) as {
    range?: 'all' | 'month' | 'date' | 'custom'; month?: string; date?: string; from?: string; to?: string;
  };
  const today = beijingDateBoundaries(asOf).today;
  if (value.from || value.to) {
    if (!value.from || !value.to || !isIsoDate(value.from) || !isIsoDate(value.to) || value.from > value.to) {
      throw Object.assign(new Error('旧版 from/to 日期范围无效'), { statusCode: 400, code: 'INVALID_DATE_RANGE' });
    }
    if (value.to > today) throw Object.assign(new Error('不能查询未来日期'), { statusCode: 400, code: 'FUTURE_DATE' });
    const explicitCustom = value.range === 'custom';
    return {
      range: explicitCustom ? 'custom' : value.from === value.to ? 'date' : 'all',
      month: null,
      date: explicitCustom ? null : value.from === value.to ? value.from : null,
      rangeStart: value.from,
      rangeEnd: value.to,
      timezone: 'Asia/Shanghai',
      grain: explicitCustom ? 'day' : value.from === value.to ? 'bucket' : 'day',
    };
  }
  const mode = value.range ?? (value.month ? 'month' : value.date ? 'date' : 'month');
  if (mode === 'all') {
    const starts = [observed.localStart, observed.officialStart].filter((item): item is string => Boolean(item));
    const ends = [observed.localEnd, observed.officialEnd].filter((item): item is string => Boolean(item));
    return {
      range: 'all', month: null, date: null,
      rangeStart: starts.sort().at(0) ?? today,
      rangeEnd: minDate(ends.sort().at(-1) ?? today, today),
      timezone: 'Asia/Shanghai', grain: 'month',
    };
  }
  if (mode === 'date') {
    const date = value.date;
    if (!date || !isIsoDate(date)) throw Object.assign(new Error('日期模式必须提供有效 date'), { statusCode: 400, code: 'INVALID_DATE' });
    if (date > today) throw Object.assign(new Error('不能查询未来日期'), { statusCode: 400, code: 'FUTURE_DATE' });
    return {
      range: 'date', month: null, date, rangeStart: date, rangeEnd: date,
      timezone: 'Asia/Shanghai', grain: 'bucket',
    };
  }
  if (mode === 'custom') {
    throw Object.assign(new Error('自定义范围必须同时提供有效 from 与 to'), {
      statusCode: 400, code: 'INVALID_DATE_RANGE',
    });
  }
  const month = value.month ?? today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw Object.assign(new Error('月份格式无效'), { statusCode: 400, code: 'INVALID_MONTH' });
  }
  if (month > today.slice(0, 7)) throw Object.assign(new Error('不能查询未来月份'), { statusCode: 400, code: 'FUTURE_MONTH' });
  const start = `${month}-01`;
  return {
    range: 'month', month, date: null, rangeStart: start,
    rangeEnd: minDate(endOfMonth(start), today), timezone: 'Asia/Shanghai', grain: 'day',
  };
}

async function resolveDirectCostSelection(client: DbClient, rawQuery: unknown, asOf: string) {
  const value = rawQuery && typeof rawQuery === 'object'
    ? rawQuery as { range?: unknown; from?: unknown; to?: unknown; model?: unknown }
    : {};
  const needsObservedCoverage = value.range === 'all' && !value.from && !value.to;
  const observed = needsObservedCoverage
    ? await readObservedCoverage(client, asOf, typeof value.model === 'string' ? value.model : undefined)
    : emptyObservedCoverage();
  return resolveCostSelection(rawQuery, observed, asOf);
}

function emptyObservedCoverage(): ObservedCoverage {
  return {
    localStart: null,
    localEnd: null,
    officialStart: null,
    officialEnd: null,
    localIntervals: [],
    officialIntervals: [],
  };
}

function resolveFilterDateRange(filters: CostAttemptFilters) {
  if (filters.from && filters.to) return { start: filters.from, end: filters.to };
  if (filters.range === 'all') return null;
  const selection = resolveCostSelection(filters, {
    localStart: null, localEnd: null, officialStart: null, officialEnd: null,
    localIntervals: [], officialIntervals: [],
  });
  return { start: selection.rangeStart, end: selection.rangeEnd };
}

function resolveComparableWindow(selection: CostSelection, observed: ObservedCoverage) {
  if (!observed.localStart || !observed.localEnd || !observed.officialStart || !observed.officialEnd) {
    return { start: null, end: null, dates: [] as string[] };
  }
  const dates = enumerateDates(selection.rangeStart, selection.rangeEnd).filter(day => (
    observed.localIntervals.some(interval => day >= interval.start && day <= interval.end)
      && observed.officialIntervals.some(interval => day >= interval.start && day <= interval.end)
  ));
  return dates.length > 0
    ? { start: dates[0]!, end: dates.at(-1)!, dates }
    : { start: null, end: null, dates };
}

/** 本地成本看盘只受用户选择和本地已观测覆盖限制，不应被官方出账进度裁剪。 */
function resolveLocalSelectionDates(selection: CostSelection, observed: ObservedCoverage) {
  return enumerateDates(selection.rangeStart, selection.rangeEnd).filter(day => (
    observed.localIntervals.some(interval => day >= interval.start && day <= interval.end)
  ));
}

function buildCoverage(
  selection: CostSelection,
  observed: ObservedCoverage,
  comparable: { start: string | null; end: string | null; dates: string[] },
  stale: boolean,
) {
  const makeWindow = (
    start: string | null,
    end: string | null,
    name: string,
    markStale = false,
    coversSelection?: boolean,
    overlapsSelection = true,
  ) => {
    if (!start || !end) return { start, end, status: 'unavailable' as const, reason: `${name}尚无可用数据` };
    if (!overlapsSelection) {
      return { start, end, status: 'unavailable' as const, reason: `${name}未覆盖所选范围` };
    }
    const complete = coversSelection ?? (start <= selection.rangeStart && end >= selection.rangeEnd);
    return {
      start, end,
      status: markStale && stale ? 'stale' as const : complete ? 'complete' as const : 'partial' as const,
      reason: complete && !(markStale && stale)
        ? null : markStale && stale ? `${name}同步数据已过期` : `${name}只覆盖所选范围的一部分`,
    };
  };
  const selectedDates = enumerateDates(selection.rangeStart, selection.rangeEnd);
  const localCoveredDates = selectedDates.filter(day => observed.localIntervals.some(interval => (
    day >= interval.start && day <= interval.end
  )));
  const officialCoveredDates = selectedDates.filter(day => observed.officialIntervals.some(interval => (
    day >= interval.start && day <= interval.end
  )));
  const localComplete = localCoveredDates.length === selectedDates.length;
  const officialComplete = officialCoveredDates.length === selectedDates.length;
  const comparableSet = new Set(comparable.dates);
  const local = makeWindow(
    observed.localStart, observed.localEnd, '本地用量', false,
    localComplete, localCoveredDates.length > 0,
  );
  const official = makeWindow(
    observed.officialStart, observed.officialEnd, '官方账单', true,
    officialComplete, officialCoveredDates.length > 0,
  );
  const comparableWindow = makeWindow(
    comparable.start, comparable.end, '共同对账范围', true,
    selectedDates.every(day => comparableSet.has(day)),
  );
  const excludedPeriods = groupDateGaps(
    selectedDates.filter(day => !comparableSet.has(day)),
    comparable.dates.length > 0 ? '不在本地与官方共同覆盖范围内' : '本地与官方没有可比较的共同日期',
  );
  return { local, official, comparable: comparableWindow, excludedPeriods };
}

function groupDateGaps(days: string[], reason: string) {
  const result: Array<{ start: string; end: string; reason: string }> = [];
  for (const day of days) {
    const previous = result.at(-1);
    if (previous && shiftDate(previous.end, 1) === day) previous.end = day;
    else result.push({ start: day, end: day, reason });
  }
  return result;
}

function combinedStatusLabel(billState: string, matchState: string) {
  const bill = billState === 'final' ? '最终账单'
    : billState === 'reopened' ? '账单已重开'
      : billState === 'mixed' ? '账单状态混合'
        : billState === 'provisional' ? '出账中' : '账单未覆盖';
  const match = matchState === 'raw-matched' ? '原始采集一致'
    : matchState === 'adjusted-matched' ? '经调整后对齐'
      : matchState === 'residual' ? '仍有未解释残差' : '暂不可对账';
  return `${bill} · ${match}`;
}

function coveragePercent(local: number, official: number) {
  if (official <= 0) return null;
  return Math.min(100, round4(local / official * 100));
}

function estimateCompleteness(
  available: boolean,
  unpricedAttempts: number,
  unavailableUsageAttempts: number,
) {
  if (!available) return 'unavailable' as const;
  return unpricedAttempts > 0 || unavailableUsageAttempts > 0
    ? 'partial' as const
    : 'complete' as const;
}

function buildSettlementBook(
  row: SettlementSummaryRow,
  ledger: PackageLedgerSummaryRow,
  listPrice: ListPriceSummary,
  selection: CostSelection,
  officialCoverage: { status: 'complete' | 'partial' | 'stale' | 'unavailable'; reason: string | null },
) {
  const usagePayable = cnyMicros(row.usage_payable_amount_cny);
  const usagePayableKnown = row.usage_payable_amount_cny !== null
    && row.usage_payable_amount_cny !== undefined;
  const ledgerRows = toInt(ledger.row_count);
  const incompleteRows = toInt(ledger.incomplete_rows);
  const allocationStatus = ledgerRows === 0 ? 'unavailable' as const
    : incompleteRows > 0 ? 'partial' as const : 'complete' as const;
  const eventRows = toInt(ledger.event_rows);
  const openingCatchUpRows = toInt(ledger.opening_catch_up_rows);
  const uncertainTimeRows = toInt(ledger.uncertain_time_rows);
  const staleGapTimeRows = toInt(ledger.stale_gap_time_rows);
  const timeAttributionStatus = eventRows === 0 ? 'unavailable' as const
    : openingCatchUpRows > 0 || uncertainTimeRows > 0 || staleGapTimeRows > 0
      ? 'partial' as const : 'complete' as const;
  const ledgerValue = (value: unknown) => allocationStatus === 'complete' ? formatCny(value) : null;
  const hasOfficialCoverage = officialCoverage.status !== 'unavailable';
  const officialValue = (value: unknown) => hasOfficialCoverage ? nullableCny(value) : null;
  return {
    rangeStart: selection.rangeStart,
    rangeEnd: selection.rangeEnd,
    timezone: selection.timezone,
    coverageStatus: officialCoverage.status,
    coverageReason: officialCoverage.reason,
    usageOriginalAmountCny: officialValue(row.usage_original_amount_cny),
    usagePayableAmountCny: hasOfficialCoverage && usagePayableKnown
      ? formatCnyMicros(usagePayable) : null,
    usagePaidAmountCny: officialValue(row.usage_paid_amount_cny),
    usageUnpaidAmountCny: officialValue(row.usage_unpaid_amount_cny),
    packagePurchaseAmountCny: officialValue(row.package_purchase_amount_cny),
    packagePurchasePaidAmountCny: officialValue(row.package_purchase_paid_amount_cny),
    packagePurchaseUnpaidAmountCny: officialValue(row.package_purchase_unpaid_amount_cny),
    paygPayableAmountCny: hasOfficialCoverage && usagePayableKnown
      ? formatCnyMicros(usagePayable) : null,
    listPriceOffsetValueCny: !hasOfficialCoverage || !usagePayableKnown || listPrice.cost === null
      ? null : formatCnyMicros(maxMicros(0n, listPrice.cost - usagePayable)),
    listPriceOffsetStatus: !hasOfficialCoverage || !usagePayableKnown
      ? 'unavailable' as const : listPrice.status,
    refundAmountCny: officialValue(row.refund_amount_cny),
    billingAdjustmentAmountCny: officialValue(row.billing_adjustment_amount_cny),
    netOfficialPayableCny: officialValue(row.net_official_payable_cny),
    openingPrepaidAssetCny: ledgerValue(ledger.opening_prepaid_asset_cny),
    acquisitionCostCny: ledgerValue(ledger.acquisition_cost_cny),
    amortizedCostCny: ledgerValue(ledger.amortized_cost_cny),
    openingCatchUpCny: ledgerValue(ledger.opening_catch_up_cny),
    expiryLossCny: ledgerValue(ledger.expiry_loss_cny),
    adjustmentCny: ledgerValue(ledger.adjustment_cny),
    endingPrepaidAssetCny: ledgerValue(ledger.ending_prepaid_asset_cny),
    allocationStatus,
    timeAttributionStatus,
    timeAttributionReason: timeAttributionStatus === 'partial'
      ? [
        openingCatchUpRows > 0
          ? '范围包含首次观测前累计消耗，只能归入补记，不能精确归属到消费日期'
          : null,
        uncertainTimeRows > 0
          ? '存在仅能证明额度已归零的终态证据，无法区分真实消费与到期损失'
          : null,
        staleGapTimeRows > 0
          ? '资源包在缺失后重新出现，额度变化只能归属到缺失区间，不能精确到日'
          : null,
      ].filter((reason): reason is string => Boolean(reason)).join('；')
      : timeAttributionStatus === 'unavailable' ? '尚无资源包成本事件可用于时间归属' : null,
  };
}

async function readPackageLedgerSummary(client: DbClient, selection: CostSelection, asOf: string) {
  const result = await client.query<PackageLedgerSummaryRow>(
    `WITH acquisitions AS (
       SELECT coalesce(sum(payable_amount_cny) FILTER (WHERE acquisition_date < $2::date), 0) AS before_amount,
              coalesce(sum(payable_amount_cny) FILTER (WHERE acquisition_date BETWEEN $2::date AND $3::date), 0) AS range_amount,
              count(*) FILTER (
                WHERE acquisition_date <= $3::date
                  AND (cost_basis_status <> 'matched' OR payable_amount_cny IS NULL)
              ) AS incomplete_rows,
              count(*) FILTER (WHERE acquisition_date <= $3::date) AS row_count
       FROM provider_resource_package_acquisitions acquisitions
       WHERE acquisitions.provider = $1 AND acquisitions.currency = 'CNY' AND acquisitions.updated_at <= $4
         AND EXISTS (
           SELECT 1 FROM provider_resource_package_snapshots snapshots
           WHERE snapshots.provider = acquisitions.provider AND snapshots.package_id = acquisitions.package_id
             AND snapshots.recognized_model = ANY($5::text[])
             AND snapshots.captured_at <= $4
         )
     ), events AS (
       SELECT coalesce(sum(allocated_cost_cny) FILTER (WHERE event_date < $2::date), 0) AS before_cost,
              coalesce(sum(allocated_cost_cny) FILTER (
                WHERE event_date BETWEEN $2::date AND $3::date AND event_type = 'consumption'
              ), 0) AS amortized_cost,
              coalesce(sum(allocated_cost_cny) FILTER (
                WHERE event_date BETWEEN $2::date AND $3::date AND event_type = 'opening-balance'
              ), 0) AS opening_catch_up_cost,
              coalesce(sum(allocated_cost_cny) FILTER (WHERE event_date BETWEEN $2::date AND $3::date AND event_type = 'expiry-writeoff'), 0) AS expiry_loss,
              coalesce(sum(allocated_cost_cny) FILTER (WHERE event_date BETWEEN $2::date AND $3::date AND event_type IN ('refund','adjustment')), 0) AS adjustment_cost,
              coalesce(sum(allocated_cost_cny) FILTER (WHERE event_date <= $3::date), 0) AS through_cost,
              count(*) FILTER (
                WHERE event_date <= $3::date
                  AND (cost_basis_status <> 'allocated' OR allocated_cost_cny IS NULL)
              ) AS incomplete_rows,
              count(*) FILTER (
                WHERE event_date BETWEEN $2::date AND $3::date AND event_type = 'opening-balance'
                  AND coalesce(allocated_cost_cny, 0) <> 0
              ) AS opening_catch_up_rows,
              count(*) FILTER (
                WHERE event_date BETWEEN $2::date AND $3::date
                  AND evidence->>'allocationEligible' = 'false'
              ) AS uncertain_time_rows,
              count(*) FILTER (
                WHERE event_date BETWEEN $2::date AND $3::date
                  AND evidence->>'timeAttributionUncertain' = 'true'
              ) AS stale_gap_time_rows,
              count(*) FILTER (WHERE event_date <= $3::date) AS row_count,
              count(*) FILTER (WHERE event_date BETWEEN $2::date AND $3::date) AS range_event_rows
       FROM provider_resource_package_cost_events events
       WHERE events.provider = $1 AND events.created_at <= $4
         AND EXISTS (
           SELECT 1 FROM provider_resource_package_snapshots snapshots
           WHERE snapshots.provider = events.provider AND snapshots.package_id = events.package_id
             AND snapshots.recognized_model = ANY($5::text[])
             AND snapshots.captured_at <= $4
         )
     )
     SELECT (acquisitions.before_amount - events.before_cost)::numeric(20,6) AS opening_prepaid_asset_cny,
            acquisitions.range_amount::numeric(20,6) AS acquisition_cost_cny,
            events.amortized_cost::numeric(20,6) AS amortized_cost_cny,
            events.opening_catch_up_cost::numeric(20,6) AS opening_catch_up_cny,
            events.expiry_loss::numeric(20,6) AS expiry_loss_cny,
            events.adjustment_cost::numeric(20,6) AS adjustment_cny,
            (acquisitions.before_amount + acquisitions.range_amount - events.through_cost)::numeric(20,6) AS ending_prepaid_asset_cny,
            (acquisitions.incomplete_rows + events.incomplete_rows)::int AS incomplete_rows,
            (acquisitions.row_count + events.row_count)::int AS row_count,
            events.range_event_rows::int AS event_rows,
            events.opening_catch_up_rows::int AS opening_catch_up_rows,
            events.uncertain_time_rows::int AS uncertain_time_rows,
            events.stale_gap_time_rows::int AS stale_gap_time_rows
     FROM acquisitions CROSS JOIN events`,
    [PROVIDER, selection.rangeStart, selection.rangeEnd, asOf, [...SEEDANCE_COST_MODEL_LABELS]],
  );
  return result.rows[0] ?? {} as PackageLedgerSummaryRow;
}

function addSqlFilter(conditions: string[], values: unknown[], value: unknown, sql: (index: number) => string) {
  if (value === undefined || value === null || value === '') return;
  values.push(value);
  conditions.push(sql(values.length));
}

function mapReconciliationBucket(row: ReconciliationBucketRow) {
  return {
    id: row.id,
    periodStart: dateOnly(row.period_start),
    periodEnd: dateOnly(row.period_end),
    expenseDate: row.expense_date ? dateOnly(row.expense_date) : null,
    billLineType: normalizeBillLineType(row.bill_line_type),
    model: row.recognized_model ?? '未识别模型',
    resolutionBand: normalizePricingResolution(row.pricing_resolution_band),
    inputClass: normalizeInputClass(row.pricing_input_class),
    unitPriceCnyPerMillion: nullableCny(row.unit_price_per_million),
    currency: 'CNY' as const,
    rawLocalTokens: toInt(row.raw_local_tokens),
    inferredAdjustmentTokens: toInt(row.inferred_adjustment_tokens),
    adjustedLocalTokens: toInt(row.adjusted_local_tokens),
    officialTokens: toInt(row.official_tokens),
    timingShiftTokens: toInt(row.timing_adjustment_tokens),
    residualTokens: toInt(row.residual_tokens),
    rawLocalCostCny: formatCny(row.raw_local_cost_cny),
    inferredAdjustmentCostCny: formatCny(row.inferred_adjustment_cost_cny),
    adjustedLocalCostCny: formatCny(row.adjusted_local_cost_cny),
    officialListEquivalentCostCny: formatCny(row.official_cost_cny),
    timingShiftCostCny: formatCny(row.timing_adjustment_cost_cny),
    rateVarianceCny: null,
    roundingVarianceCny: null,
    residualCostCny: formatCny(row.residual_cost_cny),
    matchState: normalizeBucketMatchState(row.status),
    attributionConfidence: normalizeAttributionConfidence(row.attribution_confidence),
  };
}

function mapReconciliationEvidence(row: ReconciliationEvidenceRow) {
  return {
    id: row.id,
    side: row.side === 'adjustment'
      ? 'adjustment' as const
      : row.side === 'local'
        ? 'local' as const
        : row.side === 'zero-cost-candidate'
          ? 'zero-cost-candidate' as const
          : 'official' as const,
    usageRecordId: row.usage_record_id,
    billDetailRevisionId: row.bill_detail_revision_id,
    taskId: row.task_id,
    providerTaskId: row.provider_task_id,
    sourceDetailKey: row.source_detail_key,
    allocatedTokens: toInt(row.allocated_tokens),
    allocatedCostCny: formatCny(row.allocated_cost_cny),
    cause: row.cause,
    confidence: normalizeAttributionConfidence(row.confidence),
    evidence: isJsonObject(row.evidence) ? row.evidence : {},
  };
}

function applyTimingAdjustment(
  bucket: ReconciliationBucketRow,
  timing: TimingAdjustmentRow,
): ReconciliationBucketRow {
  const addedTokens = toInt(timing.timing_tokens);
  const addedCost = cnyMicros(timing.timing_cost_cny);
  const timingTokens = toInt(bucket.timing_adjustment_tokens) + addedTokens;
  const timingCost = cnyMicros(bucket.timing_adjustment_cost_cny) + addedCost;
  const residualTokens = toInt(bucket.residual_tokens) - addedTokens;
  const residualCost = cnyMicros(bucket.residual_cost_cny) - addedCost;
  const adjusted = toInt(bucket.inferred_adjustment_tokens) !== 0 || timingTokens !== 0;
  const status = bucket.status === 'not-comparable'
    ? 'not-comparable'
    : residualTokens === 0 && residualCost === 0n
      ? adjusted ? 'adjusted-matched' : 'raw-matched'
      : 'residual';
  return {
    ...bucket,
    timing_adjustment_tokens: timingTokens,
    timing_adjustment_cost_cny: formatCnyMicros(timingCost),
    residual_tokens: residualTokens,
    residual_cost_cny: formatCnyMicros(residualCost),
    status,
    attribution_confidence: adjusted ? 'high' : 'direct',
  };
}

function officialDetailMatchesBucket(detail: OfficialAsOfDetail, bucket: ReconciliationBucketRow) {
  if (!bucket.expense_date || detail.expenseDate !== dateOnly(bucket.expense_date)) return false;
  if (detail.billLineType !== normalizeBillLineType(bucket.bill_line_type)) return false;
  if (detail.recognizedModel !== bucket.recognized_model) return false;
  if (detail.billLineType !== 'usage') return true;
  const resolution = normalizeOfficialPricingResolution(detail.pricingResolution);
  const inputClass = detail.pricingInputHasVideo === true
    ? 'with-video' : detail.pricingInputHasVideo === false ? 'without-video' : 'unknown';
  const sameRate = detail.normalizedUnitPricePerMillion === null || detail.normalizedUnitPricePerMillion === undefined
    ? bucket.unit_price_per_million === null || bucket.unit_price_per_million === undefined
    : bucket.unit_price_per_million !== null && bucket.unit_price_per_million !== undefined
      && cnyMicros(detail.normalizedUnitPricePerMillion) === cnyMicros(bucket.unit_price_per_million);
  return resolution === normalizePricingResolution(bucket.pricing_resolution_band)
    && inputClass === normalizeInputClass(bucket.pricing_input_class)
    && sameRate;
}

function officialDetailToReconciliationEvidence(detail: OfficialAsOfDetail) {
  return {
    id: `official:${detail.sourceDetailKey}`,
    side: 'official' as const,
    usageRecordId: null,
    billDetailRevisionId: detail.revisionId,
    taskId: null,
    providerTaskId: null,
    sourceDetailKey: detail.sourceDetailKey,
    allocatedTokens: toInt(detail.billableTokens),
    allocatedCostCny: formatCny(detail.billLineType === 'usage'
      ? detail.listEquivalentCostCny : detail.payableAmountCny),
    cause: null,
    confidence: 'direct' as const,
    evidence: {
      product: detail.product,
      billPeriod: detail.billPeriod,
      billLineType: detail.billLineType,
      isFinal: detail.isFinal,
    },
  };
}

function normalizeOfficialPricingResolution(value: string | null) {
  const normalized = value?.toLowerCase().replace(/\s/g, '') ?? '';
  if (normalized.includes('480') || normalized.includes('720')) return '480p-720p' as const;
  if (normalized.includes('1080')) return '1080p' as const;
  if (normalized.includes('4k')) return '4k' as const;
  return 'unknown' as const;
}

function mapSettlementItem(row: SettlementItemRow) {
  const payable = cnyMicros(row.payable_amount_cny);
  const paid = cnyMicros(row.paid_amount_cny);
  const unpaid = cnyMicros(row.unpaid_amount_cny);
  const paymentStatus = settlementPaymentStatus(row);
  const billLineType = normalizeBillLineType(row.bill_line_type);
  return {
    id: row.id,
    sourceDetailKey: row.source_detail_key,
    billPeriod: row.bill_period,
    expenseDate: dateOnly(row.expense_date),
    billLineType,
    model: row.recognized_model,
    instanceNo: row.instance_no,
    packageId: row.package_id,
    originalAmountCny: formatCny(row.original_bill_amount_cny),
    preferentialAmountCny: formatCny(row.preferential_bill_amount_cny),
    discountAmountCny: formatCny(row.discount_bill_amount_cny),
    couponAmountCny: formatCny(row.coupon_amount_cny),
    payableAmountCny: formatCnyMicros(payable),
    paidAmountCny: formatCnyMicros(paid),
    unpaidAmountCny: formatCnyMicros(unpaid),
    currency: 'CNY' as const,
    paymentStatus,
    acquisitionLinkStatus: row.acquisition_link_status ?? (billLineType !== 'package-purchase'
      ? 'not-applicable' as const : 'missing' as const),
    isFinal: Boolean(row.is_final),
  };
}

function officialDetailToSettlementRow(
  detail: OfficialAsOfDetail,
  acquisitionLinks: Map<string, AcquisitionLinkRow>,
): SettlementItemRow {
  const acquisition = acquisitionLinks.get(detail.sourceDetailKey);
  const revisionMatches = Boolean(acquisition) && acquisition?.cost_basis_status === 'matched'
    && (detail.revisionId === null || acquisition.current_revision_id === detail.revisionId);
  return {
    id: detail.sourceDetailKey,
    revision_id: detail.revisionId
      ?? (() => { throw new Error('官方账单分页缺少稳定修订标识'); })(),
    source_detail_key: detail.sourceDetailKey,
    bill_period: detail.billPeriod,
    expense_date: detail.expenseDate,
    bill_line_type: detail.billLineType,
    recognized_model: detail.recognizedModel,
    instance_no: detail.instanceNo,
    package_id: detail.billLineType === 'package-purchase' && revisionMatches
      ? acquisition?.package_id ?? null : null,
    original_bill_amount_cny: detail.originalBillAmountCny,
    preferential_bill_amount_cny: detail.preferentialBillAmountCny,
    discount_bill_amount_cny: detail.discountBillAmountCny,
    coupon_amount_cny: detail.couponAmountCny,
    payable_amount_cny: detail.payableAmountCny,
    paid_amount_cny: detail.paidAmountCny,
    unpaid_amount_cny: detail.unpaidAmountCny,
    currency: 'CNY',
    is_final: detail.isFinal,
    acquisition_link_status: detail.billLineType !== 'package-purchase'
      ? 'not-applicable' : revisionMatches ? 'linked' : 'missing',
  };
}

async function readAcquisitionLinks(client: DbClient, details: OfficialAsOfDetail[], asOf: string) {
  const keys = details.filter(item => item.billLineType === 'package-purchase').map(item => item.sourceDetailKey);
  if (keys.length === 0) return new Map<string, AcquisitionLinkRow>();
  const result = await client.query<AcquisitionLinkRow>(
    `SELECT bill_source_detail_key, package_id, current_revision_id, cost_basis_status
     FROM provider_resource_package_acquisitions
     WHERE provider = $1 AND currency = 'CNY' AND updated_at <= $2
       AND bill_source_detail_key = ANY($3::text[])`,
    [PROVIDER, asOf, keys],
  );
  return new Map(result.rows.map(row => [row.bill_source_detail_key, row]));
}

function settlementPaymentStatus(row: Pick<SettlementItemRow, 'payable_amount_cny' | 'paid_amount_cny' | 'unpaid_amount_cny'>) {
  const payable = cnyMicros(row.payable_amount_cny);
  const paid = cnyMicros(row.paid_amount_cny);
  const unpaid = cnyMicros(row.unpaid_amount_cny);
  return payable === 0n ? 'zero' as const
    : paid > 0n && unpaid > 0n ? 'partial' as const
      : paid <= 0n && unpaid > 0n ? 'unpaid' as const
        : paid > 0n && unpaid <= 0n ? 'paid' as const : 'unknown' as const;
}

function normalizeBillLineType(value: string) {
  if (value === 'usage' || value === 'package-purchase' || value === 'refund' || value === 'adjustment') return value;
  return 'other' as const;
}

function normalizeBucketMatchState(value: string) {
  if (value === 'raw-matched' || value === 'adjusted-matched' || value === 'residual') return value;
  return 'cannot-reconcile' as const;
}

function normalizeUsageEvidenceOrigin(value: string) {
  if (value === 'provider-reported' || value === 'legacy-raw' || value === 'official-bill-inferred') return value;
  return 'unavailable' as const;
}

function normalizePricingRuleStatus(value: string) {
  if (value === 'priced' || value === 'unsupported') return value;
  return 'rule-missing' as const;
}

function normalizeAttributionConfidence(value: string | null | undefined) {
  if (value === 'direct' || value === 'high' || value === 'medium' || value === 'low') return value;
  return 'unallocated' as const;
}

function normalizeInputClass(value: string) {
  if (value === 'with-video' || value === 'without-video') return value;
  return 'unknown' as const;
}

function normalizePricingResolution(value: string) {
  if (value === '480p-720p' || value === '1080p' || value === '4k') return value;
  return 'unknown' as const;
}

function omitKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function endOfMonth(date: string) {
  const cursor = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  cursor.setUTCDate(0);
  return cursor.toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number) {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

function minDate(...dates: string[]) {
  return [...dates].sort().at(0) as string;
}

function beijingDate(value: Date | string) {
  return new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function beijingDateBoundaries(value: Date | string = new Date()) {
  const today = new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return {
    today,
    monthStart: `${today.slice(0, 7)}-01`,
    tomorrow: date.toISOString().slice(0, 10),
  };
}

function enumerateDates(from: string, to: string) {
  const result: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function enumerateMonths(from: string, to: string) {
  const result: string[] = [];
  const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

function dateOnly(value: Date | string) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function cnyMicros(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return 0n;
  const text = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return 0n;
  const sign = match[1] === '-' ? -1n : 1n;
  const fraction = (match[3] ?? '').padEnd(7, '0');
  let micros = BigInt(match[2]) * 1_000_000n + BigInt(fraction.slice(0, 6));
  if (fraction[6] >= '5') micros += 1n;
  return micros * sign;
}

function formatCny(value: unknown) {
  return formatCnyMicros(cnyMicros(value));
}

function nullableCny(value: unknown) {
  return value === null || value === undefined ? null : formatCny(value);
}

function formatCnyMicros(value: bigint) {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 1_000_000n}.${(absolute % 1_000_000n).toString().padStart(6, '0')}`;
}

function divideRounded(value: bigint, divisor: bigint) {
  if (divisor <= 0n) return 0n;
  const sign = value < 0n ? -1n : 1n;
  const absolute = value < 0n ? -value : value;
  return sign * ((absolute + divisor / 2n) / divisor);
}

function maxMicros(left: bigint, right: bigint) {
  return left > right ? left : right;
}

function nullableInteger(value: unknown) {
  if (value === null || value === undefined) return null;
  return toInt(value);
}

function nullablePositiveNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function pricingResolutionOrder(value: string) {
  return value === '480p-720p' ? 0 : value === '1080p' ? 1 : 2;
}

function isJsonObject(value: unknown): value is Record<string, string | number | boolean | null> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
