import type { EndpointRequestQuery } from '@lindyson/api-contracts';
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
import { toIsoDate, toIsoDateTime, toInt } from './serialization.js';

type OverviewFilters = EndpointRequestQuery<'adminProviderBillingOverview'>;
type DetailFilters = EndpointRequestQuery<'adminProviderBillingDetails'>;
type OperationalFilters = EndpointRequestQuery<'adminProviderBillingOperationalUsage'>;

type ServiceType = 'video' | 'image' | 'multimodal' | 'storage' | 'other';
type AttributionStatus = 'business' | 'admin-operational' | 'account-level' | 'unattributed';
type Finality = 'final' | 'provisional';

interface BillingSelection {
  range: 'all' | 'month' | 'date' | 'custom';
  month: string | null;
  date: string | null;
  rangeStart: string;
  rangeEnd: string;
  timezone: 'Asia/Shanghai';
  grain: 'month' | 'day' | 'bucket';
}

interface NormalizedFilters {
  range?: 'all' | 'month' | 'date' | 'custom';
  month?: string;
  date?: string;
  from?: string;
  to?: string;
  product?: string;
  serviceType?: ServiceType;
  model?: string;
  finality?: Finality;
  attributionStatus?: AttributionStatus;
  search?: string;
  asOf?: string;
  position?: 'first' | 'previous' | 'next' | 'last';
  cursor?: string;
  snapshotCursor?: string;
  limit?: number;
}

interface OverviewRow {
  kind: 'summary' | 'product' | 'service' | 'attribution';
  product: string | null;
  product_name: string | null;
  service_type: ServiceType | null;
  attribution_status: AttributionStatus | null;
  line_count: unknown;
  product_count: unknown;
  final_line_count: unknown;
  provisional_line_count: unknown;
  original_bill_amount_cny: unknown;
  preferential_bill_amount_cny: unknown;
  discount_bill_amount_cny: unknown;
  coupon_amount_cny: unknown;
  payable_amount_cny: unknown;
  paid_amount_cny: unknown;
  unpaid_amount_cny: unknown;
}

interface DetailRow {
  id: string;
  provider: string;
  source_detail_key: string;
  bill_period: string;
  expense_date: Date | string;
  product: string;
  product_name: string | null;
  service_type: ServiceType;
  model: string | null;
  bill_line_type: string;
  finality: Finality;
  attribution_status: AttributionStatus;
  attribution_evidence_id: string | null;
  billing_mode: string | null;
  bill_category: string | null;
  instance_no: string | null;
  config_name: string | null;
  usage_count: unknown;
  usage_unit: string | null;
  deduction_count: unknown;
  original_bill_amount_cny: unknown;
  preferential_bill_amount_cny: unknown;
  discount_bill_amount_cny: unknown;
  coupon_amount_cny: unknown;
  payable_amount_cny: unknown;
  paid_amount_cny: unknown;
  unpaid_amount_cny: unknown;
  round_amount_cny: unknown;
  currency: string;
  current_revision_id: string | null;
  synced_at: Date | string;
}

interface OperationalRow {
  id: string;
  origin: 'manifest-v1' | 'legacy-admin-direct';
  manifest_version: string | null;
  manifest_id: string | null;
  manifest_sha256: string | null;
  provider: string;
  service_type: 'video' | 'image' | 'multimodal';
  model: string;
  operation: string;
  operation_key: string;
  cost_owner_user_id: string;
  cost_owner_user_name: string | null;
  cost_owner_email: string | null;
  purpose: string;
  initiator_type: string;
  initiated_by_user_id: string | null;
  source_run_id: string | null;
  source_item_key: string | null;
  provider_task_id: string | null;
  provider_operation_id: string | null;
  provider_request_id: string | null;
  status: string;
  provider_reached: boolean | null;
  occurred_at: Date | string;
  local_accounting_date: Date | string;
  usage_evidence: unknown;
  evidence_status: 'verified' | 'admin-confirmed-missing-original' | null;
  approval_sha256: string | null;
  approved_at: Date | string | null;
  evidence_path: string | null;
  evidence_sha256: string | null;
  pricing_status: string;
  price_version: string | null;
  pricing_source_url: string | null;
  unit_price_snapshot: unknown;
  estimated_cost_cny: unknown;
  valuation_evidence_sha256: string | null;
  valuation_recorded_at: Date | string | null;
  official_attribution_count: unknown;
  official_bill_detail_id: string | null;
  official_source_detail_key: string | null;
  official_finality: Finality | null;
  official_attributed_amount_cny: unknown;
  reconciliation_status: 'unmatched' | 'partial' | 'matched';
  recorded_at: Date | string;
}

const serviceTypeSql = (alias: string) => `CASE
  WHEN lower(concat_ws(' ', ${alias}.product, ${alias}.product_zh, ${alias}.config_name))
       ~ '(对象存储|object[ -]?storage|(^|[^a-z])tos([^a-z]|$))' THEN 'storage'
  WHEN lower(concat_ws(' ', ${alias}.recognized_model, ${alias}.config_name, ${alias}.product_zh))
       ~ '(seedance|视频生成|video[ -]?generation)' THEN 'video'
  WHEN lower(concat_ws(' ', ${alias}.recognized_model, ${alias}.config_name, ${alias}.product_zh))
       ~ '(seedream|图片生成|图像生成|image[ -]?generation)' THEN 'image'
  WHEN ${alias}.product = 'ark_bd'
    OR lower(concat_ws(' ', ${alias}.product_zh, ${alias}.config_name))
       ~ '(豆包大模型|方舟|multimodal|大模型)' THEN 'multimodal'
  ELSE 'other'
END`;

const OFFICIAL_BILLING_CTE = `WITH selected_dates AS (
  SELECT generated.day::date AS day
  FROM generate_series($2::date, $3::date, interval '1 day') generated(day)
  WHERE generated.day::date <= ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::date
), evidenced_bill_runs AS (
  SELECT DISTINCT sync_run_id AS id
  FROM provider_bill_sync_run_items
  WHERE created_at <= $1::timestamptz
), valid_bill_runs AS (
  SELECT runs.id, runs.provider, runs.window_start, runs.window_end, runs.completed_at,
         coalesce(manifest.bill_state = 'final', runs.is_final) AS is_final
  FROM provider_billing_sync_runs runs
  JOIN evidenced_bill_runs evidence ON evidence.id = runs.id
  LEFT JOIN LATERAL (
    SELECT reconciliation.bill_state
    FROM provider_reconciliation_runs reconciliation
    WHERE reconciliation.official_sync_run_id = runs.id
      AND reconciliation.created_at <= $1::timestamptz
    ORDER BY reconciliation.created_at DESC, reconciliation.id DESC
    LIMIT 1
  ) manifest ON true
  WHERE runs.kind = 'bill'
    AND runs.status = 'success'
    AND runs.completed_at <= $1::timestamptz
), selected_run_candidates AS (
  SELECT dates.day, runs.id, runs.provider, runs.completed_at, runs.is_final,
         row_number() OVER (
           PARTITION BY dates.day, runs.provider
           ORDER BY runs.completed_at DESC, runs.id DESC
         ) AS run_rank
  FROM selected_dates dates
  JOIN valid_bill_runs runs
    ON runs.window_start <= dates.day AND runs.window_end >= dates.day
), selected_runs AS (
  SELECT day, id, provider, completed_at, is_final
  FROM selected_run_candidates
  WHERE run_rank = 1
), revision_bill_details AS (
  SELECT projection.id,
         coalesce(payload->>'provider', runs.provider) AS provider,
         items.source_detail_key,
         payload->>'billPeriod' AS bill_period,
         (payload->>'expenseDate')::date AS expense_date,
         payload->>'product' AS product,
         payload->>'productZh' AS product_zh,
         payload->>'billingMode' AS billing_mode,
         payload->>'billCategory' AS bill_category,
         payload->>'instanceNo' AS instance_no,
         payload->>'configName' AS config_name,
         nullif(payload->>'usageCount', '')::numeric(30,6) AS usage_count,
         payload->>'usageUnit' AS usage_unit,
         nullif(payload->>'deductionCount', '')::numeric(30,6) AS deduction_count,
         nullif(payload->>'originalBillAmountCny', '')::numeric(20,6) AS original_bill_amount_cny,
         nullif(payload->>'preferentialBillAmountCny', '')::numeric(20,6) AS preferential_bill_amount_cny,
         nullif(payload->>'discountBillAmountCny', '')::numeric(20,6) AS discount_bill_amount_cny,
         nullif(payload->>'couponAmountCny', '')::numeric(20,6) AS coupon_amount_cny,
         nullif(payload->>'payableAmountCny', '')::numeric(20,6) AS payable_amount_cny,
         nullif(payload->>'paidAmountCny', '')::numeric(20,6) AS paid_amount_cny,
         nullif(payload->>'unpaidAmountCny', '')::numeric(20,6) AS unpaid_amount_cny,
         nullif(payload->>'roundAmountCny', '')::numeric(20,6) AS round_amount_cny,
         coalesce(payload->>'currency', 'CNY') AS currency,
         payload->>'recognizedModel' AS recognized_model,
         coalesce(payload->>'billLineType', 'other') AS bill_line_type,
         runs.is_final,
         revisions.id AS current_revision_id,
         runs.completed_at AS synced_at
  FROM selected_runs runs
  JOIN provider_bill_sync_run_items items ON items.sync_run_id = runs.id
  JOIN provider_bill_detail_revisions revisions ON revisions.id = items.bill_detail_revision_id
  JOIN provider_bill_details projection
    ON projection.provider = revisions.provider
   AND projection.source_detail_key = revisions.source_detail_key
  CROSS JOIN LATERAL (SELECT revisions.normalized_payload AS payload) normalized
  WHERE (payload->>'expenseDate')::date = runs.day
    AND items.created_at <= $1::timestamptz
    AND revisions.observed_at <= $1::timestamptz
), fallback_bill_details AS (
  SELECT details.id, details.provider, details.source_detail_key, details.bill_period,
         details.expense_date, details.product, details.product_zh, details.billing_mode,
         details.bill_category, details.instance_no, details.config_name, details.usage_count,
         details.usage_unit, details.deduction_count, details.original_bill_amount_cny,
         details.preferential_bill_amount_cny, details.discount_bill_amount_cny,
         details.coupon_amount_cny, details.payable_amount_cny, details.paid_amount_cny,
         details.unpaid_amount_cny, details.round_amount_cny, details.currency,
         details.recognized_model, details.bill_line_type, details.is_final,
         details.current_revision_id, details.synced_at
  FROM provider_bill_details details
  WHERE details.active = true
    AND details.expense_date BETWEEN $2::date AND $3::date
    AND details.expense_date <= ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::date
    AND details.synced_at <= $1::timestamptz
    AND NOT EXISTS (
      SELECT 1 FROM selected_runs runs
      WHERE runs.day = details.expense_date AND runs.provider = details.provider
    )
), as_of_bill_details AS (
  SELECT * FROM revision_bill_details
  UNION ALL
  SELECT * FROM fallback_bill_details
), current_operational_attributions AS (
  SELECT attribution.*
  FROM provider_bill_attribution_events attribution
  WHERE attribution.recorded_at <= $1::timestamptz
    AND attribution.event_type IN ('link', 'supersede')
    AND NOT EXISTS (
      SELECT 1
      FROM provider_bill_attribution_events successor
      WHERE successor.supersedes_event_id = attribution.id
        AND successor.recorded_at <= $1::timestamptz
    )
), classified_bill_details AS (
  SELECT details.*,
         details.product_zh AS product_name,
         ${serviceTypeSql('details')} AS service_type,
         CASE
           WHEN ${serviceTypeSql('details')} = 'storage'
             OR details.bill_line_type IN ('package-purchase', 'refund', 'adjustment')
             THEN 'account-level'
           WHEN (
             operational_evidence.id IS NOT NULL
             OR legacy_admin_evidence.id IS NOT NULL
           ) AND business_evidence.id IS NOT NULL THEN 'unattributed'
           WHEN operational_evidence.id IS NOT NULL
             OR legacy_admin_evidence.id IS NOT NULL THEN 'admin-operational'
           WHEN business_evidence.id IS NOT NULL THEN 'business'
           ELSE 'unattributed'
         END AS attribution_status,
         CASE
           WHEN ${serviceTypeSql('details')} = 'storage'
             OR details.bill_line_type IN ('package-purchase', 'refund', 'adjustment')
             THEN package_evidence.id
           WHEN (
             operational_evidence.id IS NOT NULL
             OR legacy_admin_evidence.id IS NOT NULL
           ) AND business_evidence.id IS NOT NULL THEN NULL
           WHEN operational_evidence.id IS NOT NULL THEN operational_evidence.id
           WHEN legacy_admin_evidence.id IS NOT NULL THEN legacy_admin_evidence.id
           WHEN business_evidence.id IS NOT NULL THEN business_evidence.id
           ELSE NULL
         END AS attribution_evidence_id,
         CASE WHEN details.is_final THEN 'final' ELSE 'provisional' END AS finality,
         CASE
           WHEN ${serviceTypeSql('details')} IN ('video', 'image', 'multimodal')
           THEN coalesce(details.recognized_model, nullif(details.config_name, ''))
           ELSE details.recognized_model
         END AS reporting_model
  FROM as_of_bill_details details
  LEFT JOIN LATERAL (
    SELECT attribution.id
    FROM current_operational_attributions attribution
    JOIN provider_operational_usage_records operational_usage
      ON operational_usage.id = attribution.operational_usage_record_id
    WHERE attribution.provider_bill_detail_id = details.id
      AND attribution.provider_bill_detail_revision_id = details.current_revision_id
      AND operational_usage.recorded_at <= $1::timestamptz
    ORDER BY attribution.recorded_at DESC, attribution.id DESC
    LIMIT 1
  ) operational_evidence ON true
  LEFT JOIN LATERAL (
    SELECT links.id
    FROM provider_reconciliation_case_links links
    JOIN provider_reconciliation_cases reconciliation_case
      ON reconciliation_case.id = links.case_id
    JOIN provider_usage_records usage ON usage.id = links.usage_record_id
    WHERE links.bill_detail_id = details.id
      AND links.bill_detail_revision_id = details.current_revision_id
      AND reconciliation_case.status IN ('approved', 'superseded')
      AND reconciliation_case.created_at <= $1::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM provider_reconciliation_cases successor_case
        WHERE successor_case.supersedes_case_id = reconciliation_case.id
          AND successor_case.created_at <= $1::timestamptz
      )
      AND links.created_at <= $1::timestamptz
      AND usage.created_at <= $1::timestamptz
      AND usage.task_id IS NULL
      AND usage.initiated_by_admin_user_id IS NOT NULL
    ORDER BY links.created_at DESC, links.id DESC
    LIMIT 1
  ) legacy_admin_evidence ON true
  LEFT JOIN LATERAL (
    SELECT links.id
    FROM provider_reconciliation_case_links links
    JOIN provider_reconciliation_cases reconciliation_case
      ON reconciliation_case.id = links.case_id
    JOIN provider_usage_records usage ON usage.id = links.usage_record_id
    WHERE links.bill_detail_id = details.id
      AND reconciliation_case.status IN ('approved', 'superseded')
      AND reconciliation_case.created_at <= $1::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM provider_reconciliation_cases successor_case
        WHERE successor_case.supersedes_case_id = reconciliation_case.id
          AND successor_case.created_at <= $1::timestamptz
      )
      AND links.created_at <= $1::timestamptz
      AND usage.created_at <= $1::timestamptz
      AND (
        links.bill_detail_revision_id IS NULL
        OR links.bill_detail_revision_id = details.current_revision_id
      )
      AND usage.task_id IS NOT NULL
    ORDER BY links.created_at DESC, links.id DESC
    LIMIT 1
  ) business_evidence ON true
  LEFT JOIN LATERAL (
    SELECT acquisition.id
    FROM provider_resource_package_acquisitions acquisition
    WHERE acquisition.bill_detail_id = details.id
      AND acquisition.updated_at <= $1::timestamptz
      AND (
        acquisition.current_revision_id IS NULL
        OR acquisition.current_revision_id = details.current_revision_id
      )
    ORDER BY acquisition.updated_at DESC, acquisition.id DESC
    LIMIT 1
  ) package_evidence ON true
)`;

export async function getAdminProviderBillingOverview(
  client: DbClient,
  rawFilters: OverviewFilters | unknown = {},
) {
  const filters = normalizeFilterObject(rawFilters);
  const { asOf, selection } = await normalizeSelection(client, filters, 'official');
  const values: unknown[] = [asOf, selection.rangeStart, selection.rangeEnd];
  const conditions = buildOfficialConditions(filters, values);
  const where = conditions.length > 0 ? conditions.join(' AND ') : 'true';
  const result = await client.query<OverviewRow>(
    `${OFFICIAL_BILLING_CTE}, filtered_bill_details AS MATERIALIZED (
       SELECT * FROM classified_bill_details details
       WHERE details.expense_date BETWEEN $2::date AND $3::date
         AND ${where}
     )
     SELECT 'summary'::text AS kind,
            NULL::text AS product, NULL::text AS product_name,
            NULL::text AS service_type, NULL::text AS attribution_status,
            count(*)::bigint AS line_count,
            count(DISTINCT product)::bigint AS product_count,
            count(*) FILTER (WHERE finality = 'final')::bigint AS final_line_count,
            count(*) FILTER (WHERE finality = 'provisional')::bigint AS provisional_line_count,
            coalesce(sum(original_bill_amount_cny), 0)::numeric(20,6) AS original_bill_amount_cny,
            coalesce(sum(preferential_bill_amount_cny), 0)::numeric(20,6) AS preferential_bill_amount_cny,
            coalesce(sum(discount_bill_amount_cny), 0)::numeric(20,6) AS discount_bill_amount_cny,
            coalesce(sum(coupon_amount_cny), 0)::numeric(20,6) AS coupon_amount_cny,
            coalesce(sum(payable_amount_cny), 0)::numeric(20,6) AS payable_amount_cny,
            coalesce(sum(paid_amount_cny), 0)::numeric(20,6) AS paid_amount_cny,
            coalesce(sum(unpaid_amount_cny), 0)::numeric(20,6) AS unpaid_amount_cny
     FROM filtered_bill_details
     UNION ALL
     SELECT 'product', product, max(product_name), service_type, NULL,
            count(*)::bigint, 0::bigint,
            count(*) FILTER (WHERE finality = 'final')::bigint,
            count(*) FILTER (WHERE finality = 'provisional')::bigint,
            coalesce(sum(original_bill_amount_cny), 0)::numeric(20,6),
            coalesce(sum(preferential_bill_amount_cny), 0)::numeric(20,6),
            coalesce(sum(discount_bill_amount_cny), 0)::numeric(20,6),
            coalesce(sum(coupon_amount_cny), 0)::numeric(20,6),
            coalesce(sum(payable_amount_cny), 0)::numeric(20,6),
            coalesce(sum(paid_amount_cny), 0)::numeric(20,6),
            coalesce(sum(unpaid_amount_cny), 0)::numeric(20,6)
     FROM filtered_bill_details
     GROUP BY product, service_type
     UNION ALL
     SELECT 'service', NULL, NULL, service_type, NULL,
            count(*)::bigint, 0::bigint, 0::bigint, 0::bigint,
            coalesce(sum(original_bill_amount_cny), 0)::numeric(20,6),
            coalesce(sum(preferential_bill_amount_cny), 0)::numeric(20,6),
            coalesce(sum(discount_bill_amount_cny), 0)::numeric(20,6),
            coalesce(sum(coupon_amount_cny), 0)::numeric(20,6),
            coalesce(sum(payable_amount_cny), 0)::numeric(20,6),
            coalesce(sum(paid_amount_cny), 0)::numeric(20,6),
            coalesce(sum(unpaid_amount_cny), 0)::numeric(20,6)
     FROM filtered_bill_details
     GROUP BY service_type
     UNION ALL
     SELECT 'attribution', NULL, NULL, NULL, attribution_status,
            count(*)::bigint, 0::bigint, 0::bigint, 0::bigint,
            coalesce(sum(original_bill_amount_cny), 0)::numeric(20,6),
            coalesce(sum(preferential_bill_amount_cny), 0)::numeric(20,6),
            coalesce(sum(discount_bill_amount_cny), 0)::numeric(20,6),
            coalesce(sum(coupon_amount_cny), 0)::numeric(20,6),
            coalesce(sum(payable_amount_cny), 0)::numeric(20,6),
            coalesce(sum(paid_amount_cny), 0)::numeric(20,6),
            coalesce(sum(unpaid_amount_cny), 0)::numeric(20,6)
     FROM filtered_bill_details
     GROUP BY attribution_status`,
    values,
  );

  const summaryRow = result.rows.find(row => row.kind === 'summary');
  const amountBreakdown = (row: OverviewRow) => ({
    lineCount: toInt(row.line_count),
    originalBillAmountCny: formatCny(row.original_bill_amount_cny),
    preferentialBillAmountCny: formatCny(row.preferential_bill_amount_cny),
    discountBillAmountCny: formatCny(row.discount_bill_amount_cny),
    couponAmountCny: formatCny(row.coupon_amount_cny),
    payableAmountCny: formatCny(row.payable_amount_cny),
    paidAmountCny: formatCny(row.paid_amount_cny),
    unpaidAmountCny: formatCny(row.unpaid_amount_cny),
  });
  return {
    asOf,
    selection,
    summary: {
      lineCount: toInt(summaryRow?.line_count),
      productCount: toInt(summaryRow?.product_count),
      finalLineCount: toInt(summaryRow?.final_line_count),
      provisionalLineCount: toInt(summaryRow?.provisional_line_count),
      originalBillAmountCny: formatCny(summaryRow?.original_bill_amount_cny),
      preferentialBillAmountCny: formatCny(summaryRow?.preferential_bill_amount_cny),
      discountBillAmountCny: formatCny(summaryRow?.discount_bill_amount_cny),
      couponAmountCny: formatCny(summaryRow?.coupon_amount_cny),
      payableAmountCny: formatCny(summaryRow?.payable_amount_cny),
      paidAmountCny: formatCny(summaryRow?.paid_amount_cny),
      unpaidAmountCny: formatCny(summaryRow?.unpaid_amount_cny),
    },
    products: result.rows
      .filter(row => row.kind === 'product' && row.product && row.service_type)
      .map(row => ({
        product: row.product!,
        productName: row.product_name,
        serviceType: row.service_type!,
        ...amountBreakdown(row),
        finalLineCount: toInt(row.final_line_count),
        provisionalLineCount: toInt(row.provisional_line_count),
      }))
      .sort(compareBreakdown),
    byServiceType: result.rows
      .filter(row => row.kind === 'service' && row.service_type)
      .map(row => ({ serviceType: row.service_type!, ...amountBreakdown(row) }))
      .sort((left, right) => serviceOrder(left.serviceType) - serviceOrder(right.serviceType)),
    byAttribution: result.rows
      .filter(row => row.kind === 'attribution' && row.attribution_status)
      .map(row => ({ attributionStatus: row.attribution_status!, ...amountBreakdown(row) }))
      .sort((left, right) => attributionOrder(left.attributionStatus) - attributionOrder(right.attributionStatus)),
  };
}

export async function listAdminProviderBillingDetails(
  client: DbClient,
  rawFilters: DetailFilters | unknown = {},
  authorizationScope = 'role:admin',
) {
  const filters = normalizeFilterObject(rawFilters);
  const { asOf, selection } = await normalizeSelection(client, filters, 'official');
  const pageQuery = await parseAdminExactKeysetQuery(client, {
    rawQuery: filters,
    filters: filterFingerprint(filters, asOf, selection),
    resource: 'admin-provider-billing-details',
    versionResource: 'admin:provider-billing',
    asOf,
    authorizationScope,
    defaultLimit: 20,
    maxLimit: 50,
  });
  const values: unknown[] = [asOf, selection.rangeStart, selection.rangeEnd];
  const conditions = buildOfficialConditions(filters, values);
  const cursorIndex = values.length + 1;
  const limitIndex = cursorIndex + 2;
  const timestampSql = `(details.expense_date::timestamp AT TIME ZONE 'Asia/Shanghai')`;
  const result = await client.query<DetailRow & AdminExactTimestampPageMetadata>(
    `${OFFICIAL_BILLING_CTE}
     SELECT details.id, details.provider, details.source_detail_key, details.bill_period,
            details.expense_date, details.product, details.product_name,
            details.service_type, details.reporting_model AS model,
            details.bill_line_type, details.finality, details.attribution_status,
            details.attribution_evidence_id, details.billing_mode, details.bill_category,
            details.instance_no, details.config_name, details.usage_count,
            details.usage_unit, details.deduction_count,
            details.original_bill_amount_cny, details.preferential_bill_amount_cny,
            details.discount_bill_amount_cny, details.coupon_amount_cny,
            details.payable_amount_cny, details.paid_amount_cny,
            details.unpaid_amount_cny, details.round_amount_cny, details.currency,
            details.current_revision_id, details.synced_at,
            ${adminExactTimestampMetadataColumns(pageQuery, timestampSql)}
     FROM classified_bill_details details
     WHERE details.expense_date BETWEEN $2::date AND $3::date
       AND ${conditions.length > 0 ? conditions.join(' AND ') : 'true'}
       AND ${adminExactTimestampCursorCondition(pageQuery, timestampSql, 'details.id', cursorIndex, cursorIndex + 1)}
     ORDER BY ${adminExactTimestampOrderBy(pageQuery, timestampSql, 'details.id')}
     LIMIT $${limitIndex}`,
    [...values, ...adminExactTimestampCursorValues(pageQuery), pageQuery.limit + 1],
  );
  return {
    asOf,
    selection,
    ...createAdminExactTimestampPage({
      rows: result.rows,
      query: pageQuery,
      getId: row => row.id,
      map: mapBillingDetail,
    }),
  };
}

export async function listAdminProviderOperationalUsage(
  client: DbClient,
  rawFilters: OperationalFilters | unknown = {},
  authorizationScope = 'role:admin',
) {
  const filters = normalizeFilterObject(rawFilters);
  const { asOf, selection } = await normalizeSelection(client, filters, 'operational');
  const pageQuery = await parseAdminExactKeysetQuery(client, {
    rawQuery: filters,
    filters: filterFingerprint(filters, asOf, selection),
    resource: 'admin-provider-operational-usage',
    versionResource: 'admin:provider-billing',
    asOf,
    authorizationScope,
    defaultLimit: 20,
    maxLimit: 50,
  });
  const values: unknown[] = [asOf, selection.rangeStart, selection.rangeEnd];
  const conditions = buildOperationalConditions(filters, values);
  const cursorIndex = values.length + 1;
  const limitIndex = cursorIndex + 2;
  const result = await client.query<OperationalRow & AdminExactTimestampPageMetadata>(
    `WITH current_valuations AS (
       SELECT valuation.*
       FROM provider_operational_usage_valuations valuation
       WHERE valuation.recorded_at <= $1::timestamptz
         AND NOT EXISTS (
           SELECT 1 FROM provider_operational_usage_valuations successor
           WHERE successor.supersedes_valuation_id = valuation.id
             AND successor.recorded_at <= $1::timestamptz
         )
     ), current_attributions AS (
       SELECT attribution.*
       FROM provider_bill_attribution_events attribution
       WHERE attribution.recorded_at <= $1::timestamptz
         AND attribution.event_type IN ('link', 'supersede')
         AND attribution.confidence IN ('direct', 'high')
         AND NOT EXISTS (
           SELECT 1 FROM provider_bill_attribution_events successor
           WHERE successor.supersedes_event_id = attribution.id
             AND successor.recorded_at <= $1::timestamptz
         )
     ), evidenced_bill_runs AS (
       SELECT DISTINCT item.sync_run_id AS id
       FROM provider_bill_sync_run_items item
       WHERE item.created_at <= $1::timestamptz
     ), valid_bill_runs AS (
       SELECT run.id, run.provider, run.window_start, run.window_end, run.completed_at
       FROM provider_billing_sync_runs run
       JOIN evidenced_bill_runs evidence ON evidence.id = run.id
       WHERE run.kind = 'bill'
         AND run.status = 'success'
         AND run.completed_at <= $1::timestamptz
     ), visible_bill_dates AS (
       SELECT DISTINCT revision.provider,
              (revision.normalized_payload->>'expenseDate')::date AS day
       FROM provider_bill_detail_revisions revision
       WHERE revision.observed_at <= $1::timestamptz
         AND (revision.normalized_payload->>'expenseDate')::date
           <= ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::date
     ), selected_bill_run_candidates AS (
       SELECT dates.provider, dates.day, run.id,
              row_number() OVER (
                PARTITION BY dates.provider, dates.day
                ORDER BY run.completed_at DESC, run.id DESC
              ) AS run_rank
       FROM visible_bill_dates dates
       JOIN valid_bill_runs run
         ON run.provider = dates.provider
        AND run.window_start <= dates.day
        AND run.window_end >= dates.day
     ), selected_bill_runs AS (
       SELECT provider, day, id
       FROM selected_bill_run_candidates
       WHERE run_rank = 1
     ), current_legacy_attributions AS (
       SELECT links.id, links.usage_record_id, links.bill_detail_id AS provider_bill_detail_id,
              links.allocated_cost_cny, links.created_at AS recorded_at,
              revision.source_detail_key,
              revision.normalized_payload->>'product' AS product,
              coalesce(manifest.bill_state = 'final', bill_run.is_final) AS is_final
       FROM provider_reconciliation_case_links links
       JOIN provider_reconciliation_cases reconciliation_case
         ON reconciliation_case.id = links.case_id
       JOIN provider_bill_detail_revisions revision
         ON revision.id = links.bill_detail_revision_id
       JOIN provider_bill_details bill_detail
         ON bill_detail.id = links.bill_detail_id
        AND bill_detail.provider = revision.provider
        AND bill_detail.source_detail_key = revision.source_detail_key
       JOIN provider_billing_sync_runs bill_run ON bill_run.id = revision.sync_run_id
       JOIN selected_bill_runs selected_bill_run
         ON selected_bill_run.id = bill_run.id
        AND selected_bill_run.provider = revision.provider
        AND selected_bill_run.day = (revision.normalized_payload->>'expenseDate')::date
       LEFT JOIN LATERAL (
         SELECT reconciliation.bill_state
         FROM provider_reconciliation_runs reconciliation
         WHERE reconciliation.official_sync_run_id = bill_run.id
           AND reconciliation.created_at <= $1::timestamptz
         ORDER BY reconciliation.created_at DESC, reconciliation.id DESC
         LIMIT 1
       ) manifest ON true
       WHERE links.usage_record_id IS NOT NULL
         AND links.created_at <= $1::timestamptz
         AND reconciliation_case.status IN ('approved', 'superseded')
         AND reconciliation_case.confidence IN ('direct', 'high')
         AND reconciliation_case.created_at <= $1::timestamptz
         AND NOT EXISTS (
           SELECT 1 FROM provider_reconciliation_cases successor_case
           WHERE successor_case.supersedes_case_id = reconciliation_case.id
             AND successor_case.created_at <= $1::timestamptz
         )
         AND revision.observed_at <= $1::timestamptz
         AND bill_run.kind = 'bill'
         AND bill_run.status = 'success'
         AND bill_run.completed_at <= $1::timestamptz
         AND EXISTS (
           SELECT 1
           FROM provider_bill_sync_run_items item
           WHERE item.sync_run_id = bill_run.id
             AND item.bill_detail_revision_id = revision.id
             AND item.created_at <= $1::timestamptz
         )
     ), legacy_attribution_totals AS (
       SELECT attribution.usage_record_id,
              count(*)::int AS attribution_count,
              sum(attribution.allocated_cost_cny)::numeric(20,6) AS allocated_cost_cny,
              bool_and(attribution.is_final) AS all_final,
              (array_agg(attribution.provider_bill_detail_id
                ORDER BY attribution.recorded_at DESC, attribution.id DESC))[1]
                AS provider_bill_detail_id,
              (array_agg(attribution.source_detail_key
                ORDER BY attribution.recorded_at DESC, attribution.id DESC))[1]
                AS source_detail_key,
              (array_agg(attribution.product
                ORDER BY attribution.recorded_at DESC, attribution.id DESC))[1]
                AS product,
              array_agg(DISTINCT attribution.product)
                FILTER (WHERE attribution.product IS NOT NULL) AS products
       FROM current_legacy_attributions attribution
       GROUP BY attribution.usage_record_id
     ), manifest_operational_rows AS (
       SELECT usage.id, 'manifest-v1'::text AS origin,
              usage.manifest_version, usage.manifest_id, usage.manifest_sha256,
              usage.provider, usage.service_type, usage.model, usage.operation,
              usage.source_run_id || ':' || usage.source_item_key AS operation_key,
              usage.cost_owner_user_id, owner.user_name AS cost_owner_user_name,
              owner.email AS cost_owner_email, usage.purpose, usage.initiator_type,
              usage.initiated_by_user_id, usage.source_run_id, usage.source_item_key,
              usage.provider_task_id, usage.provider_operation_id, usage.provider_request_id,
              usage.status, usage.provider_reached, usage.occurred_at,
              usage.local_accounting_date, usage.usage_evidence, usage.evidence_status,
              CASE
                WHEN usage.evidence_status = 'admin-confirmed-missing-original'
                  AND coalesce(usage.evidence_attestation->>'approvalSha256'
                    ~ '^[0-9a-f]{64}$', false)
                THEN usage.evidence_attestation->>'approvalSha256'
                ELSE NULL
              END AS approval_sha256,
              CASE
                WHEN usage.evidence_status = 'admin-confirmed-missing-original'
                  AND coalesce(usage.evidence_attestation->>'approvedAt'
                    ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$', false)
                THEN (usage.evidence_attestation->>'approvedAt')::timestamptz
                ELSE NULL
              END AS approved_at,
              usage.evidence_path,
              usage.evidence_sha256,
              valuation.pricing_status, valuation.price_version, valuation.pricing_source_url,
              valuation.unit_price_snapshot, valuation.estimated_cost_cny,
              valuation.evidence_sha256 AS valuation_evidence_sha256,
              valuation.recorded_at AS valuation_recorded_at,
              coalesce(attributions.attribution_count, 0)::int AS official_attribution_count,
              attributions.provider_bill_detail_id AS official_bill_detail_id,
              attributions.source_detail_key AS official_source_detail_key,
              attributions.product AS official_product,
              attributions.products AS official_products,
              CASE
                WHEN coalesce(attributions.attribution_count, 0) = 0 THEN NULL
                WHEN attributions.all_final THEN 'final'
                ELSE 'provisional'
              END AS official_finality,
              attributions.allocated_cost_cny AS official_attributed_amount_cny,
              -- 官方应付可能因优惠低于列表价；匹配状态只表示当前 revision 是否有显式归属。
              -- 多条分配仍由 attribution_count 与 allocated_cost_cny 原样披露，不据金额大小猜 partial。
              CASE
                WHEN coalesce(attributions.attribution_count, 0) = 0 THEN 'unmatched'
                ELSE 'matched'
              END AS reconciliation_status,
              usage.recorded_at AS recorded_at
       FROM provider_operational_usage_records usage
       JOIN users owner ON owner.id = usage.cost_owner_user_id
       LEFT JOIN current_valuations valuation
         ON valuation.operational_usage_record_id = usage.id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS attribution_count,
                sum(attribution.allocated_cost_cny)::numeric(20,6) AS allocated_cost_cny,
                bool_and(coalesce(manifest.bill_state = 'final', bill_run.is_final)) AS all_final,
                (array_agg(attribution.provider_bill_detail_id
                  ORDER BY attribution.recorded_at DESC, attribution.id DESC))[1]
                  AS provider_bill_detail_id,
                (array_agg(revision.source_detail_key
                  ORDER BY attribution.recorded_at DESC, attribution.id DESC))[1]
                  AS source_detail_key,
                (array_agg(revision.normalized_payload->>'product'
                  ORDER BY attribution.recorded_at DESC, attribution.id DESC))[1]
                  AS product,
                array_agg(DISTINCT revision.normalized_payload->>'product') AS products
         FROM current_attributions attribution
         JOIN provider_bill_detail_revisions revision
           ON revision.id = attribution.provider_bill_detail_revision_id
         JOIN provider_billing_sync_runs bill_run ON bill_run.id = revision.sync_run_id
         JOIN selected_bill_runs selected_bill_run
           ON selected_bill_run.id = bill_run.id
          AND selected_bill_run.provider = revision.provider
          AND selected_bill_run.day = (revision.normalized_payload->>'expenseDate')::date
         LEFT JOIN LATERAL (
           SELECT reconciliation.bill_state
           FROM provider_reconciliation_runs reconciliation
           WHERE reconciliation.official_sync_run_id = bill_run.id
             AND reconciliation.created_at <= $1::timestamptz
           ORDER BY reconciliation.created_at DESC, reconciliation.id DESC
           LIMIT 1
         ) manifest ON true
         WHERE attribution.operational_usage_record_id = usage.id
           AND revision.observed_at <= $1::timestamptz
           AND bill_run.kind = 'bill'
           AND bill_run.status = 'success'
           AND bill_run.completed_at <= $1::timestamptz
           AND EXISTS (
             SELECT 1
             FROM provider_bill_sync_run_items item
             WHERE item.sync_run_id = bill_run.id
               AND item.bill_detail_revision_id = revision.id
               AND item.created_at <= $1::timestamptz
           )
       ) attributions ON true
       WHERE usage.recorded_at <= $1::timestamptz
     ), legacy_operational_rows AS (
       SELECT usage.id, 'legacy-admin-direct'::text AS origin,
              NULL::text AS manifest_version, NULL::text AS manifest_id,
              NULL::text AS manifest_sha256,
              usage.provider, 'video'::text AS service_type, usage.model,
              'legacy-admin-direct'::text AS operation,
              'provider-usage-record:' || usage.id::text AS operation_key,
              usage.initiated_by_admin_user_id AS cost_owner_user_id,
              owner.user_name AS cost_owner_user_name, owner.email AS cost_owner_email,
              'admin-direct'::text AS purpose, 'admin-user'::text AS initiator_type,
              usage.initiated_by_admin_user_id AS initiated_by_user_id,
              NULL::text AS source_run_id, NULL::text AS source_item_key,
              usage.provider_task_id, NULL::text AS provider_operation_id,
              NULL::text AS provider_request_id, usage.status,
              NULL::boolean AS provider_reached,
              coalesce(
                usage.provider_terminal_at, usage.usage_observed_at,
                usage.completed_at, usage.created_at
              ) AS occurred_at,
              coalesce(
                usage.local_accounting_date,
                (coalesce(
                  usage.provider_terminal_at, usage.usage_observed_at,
                  usage.completed_at, usage.created_at
                ) AT TIME ZONE 'Asia/Shanghai')::date
              ) AS local_accounting_date,
              NULL::jsonb AS usage_evidence, NULL::text AS evidence_status,
              NULL::text AS approval_sha256, NULL::timestamptz AS approved_at,
              NULL::text AS evidence_path,
              NULL::text AS evidence_sha256,
              CASE
                WHEN usage.estimated_cost IS NOT NULL AND usage.pricing_rule_status = 'priced'
                  THEN 'priced'
                WHEN usage.usage_evidence_origin = 'unavailable' THEN 'missing-evidence'
                ELSE 'unpriced'
              END AS pricing_status,
              usage.price_version, NULL::text AS pricing_source_url,
              NULL::jsonb AS unit_price_snapshot,
              usage.estimated_cost AS estimated_cost_cny,
              NULL::text AS valuation_evidence_sha256,
              NULL::timestamptz AS valuation_recorded_at,
              coalesce(attributions.attribution_count, 0)::int AS official_attribution_count,
              attributions.provider_bill_detail_id AS official_bill_detail_id,
              attributions.source_detail_key AS official_source_detail_key,
              attributions.product AS official_product,
              attributions.products AS official_products,
              CASE
                WHEN coalesce(attributions.attribution_count, 0) = 0 THEN NULL
                WHEN attributions.all_final THEN 'final'
                ELSE 'provisional'
              END AS official_finality,
              attributions.allocated_cost_cny AS official_attributed_amount_cny,
              -- legacy 直连沿用相同定义：显式 current-revision 归属即 matched。
              CASE
                WHEN coalesce(attributions.attribution_count, 0) = 0 THEN 'unmatched'
                ELSE 'matched'
              END AS reconciliation_status,
              usage.created_at AS recorded_at
       FROM provider_usage_records usage
       JOIN users owner ON owner.id = usage.initiated_by_admin_user_id
       LEFT JOIN legacy_attribution_totals attributions
         ON attributions.usage_record_id = usage.id
       WHERE usage.task_id IS NULL
         AND usage.initiated_by_admin_user_id IS NOT NULL
         AND usage.created_at <= $1::timestamptz
         AND coalesce(
           usage.provider_terminal_at, usage.usage_observed_at,
           usage.completed_at, usage.created_at
         ) <= $1::timestamptz
         AND NOT EXISTS (
           SELECT 1
           FROM provider_operational_usage_records manifest_usage
           WHERE manifest_usage.recorded_at <= $1::timestamptz
             AND manifest_usage.provider = usage.provider
             AND (
               manifest_usage.id = usage.id
               OR (
                 usage.provider_task_id IS NOT NULL
                 AND manifest_usage.provider_task_id = usage.provider_task_id
               )
             )
         )
     ), operational_rows AS (
       SELECT * FROM manifest_operational_rows
       UNION ALL
       SELECT * FROM legacy_operational_rows
     )
     SELECT rows.id, rows.origin, rows.manifest_version, rows.manifest_id, rows.manifest_sha256,
            rows.provider, rows.service_type, rows.model, rows.operation,
            rows.operation_key,
            rows.cost_owner_user_id, rows.cost_owner_user_name, rows.cost_owner_email,
            rows.purpose, rows.initiator_type, rows.initiated_by_user_id,
            rows.source_run_id, rows.source_item_key, rows.provider_task_id,
            rows.provider_operation_id, rows.provider_request_id, rows.status,
            rows.provider_reached, rows.occurred_at, rows.local_accounting_date,
            rows.usage_evidence, rows.evidence_status, rows.approval_sha256, rows.approved_at,
            rows.evidence_path, rows.evidence_sha256,
            coalesce(rows.pricing_status, 'missing-evidence') AS pricing_status,
            rows.price_version, rows.pricing_source_url, rows.unit_price_snapshot,
            rows.estimated_cost_cny, rows.valuation_evidence_sha256,
            rows.valuation_recorded_at, rows.official_attribution_count,
            rows.official_bill_detail_id, rows.official_source_detail_key,
            rows.official_finality, rows.official_attributed_amount_cny,
            rows.reconciliation_status, rows.recorded_at,
            ${adminExactTimestampMetadataColumns(pageQuery, 'rows.occurred_at')}
     FROM operational_rows rows
     WHERE rows.local_accounting_date BETWEEN $2::date AND $3::date
       AND ${conditions.length > 0 ? conditions.join(' AND ') : 'true'}
       AND ${adminExactTimestampCursorCondition(pageQuery, 'rows.occurred_at', 'rows.id', cursorIndex, cursorIndex + 1)}
     ORDER BY ${adminExactTimestampOrderBy(pageQuery, 'rows.occurred_at', 'rows.id')}
     LIMIT $${limitIndex}`,
    [...values, ...adminExactTimestampCursorValues(pageQuery), pageQuery.limit + 1],
  );
  return {
    asOf,
    selection,
    ...createAdminExactTimestampPage({
      rows: result.rows,
      query: pageQuery,
      getId: row => row.id,
      map: mapOperationalUsage,
    }),
  };
}

function buildOfficialConditions(filters: NormalizedFilters, values: unknown[]) {
  const conditions: string[] = [];
  if (filters.product) addCondition(values, conditions, filters.product, 'details.product =');
  if (filters.serviceType) addCondition(values, conditions, filters.serviceType, 'details.service_type =');
  if (filters.model) addCondition(values, conditions, filters.model, 'details.reporting_model =');
  if (filters.finality) addCondition(values, conditions, filters.finality, 'details.finality =');
  if (filters.attributionStatus) {
    addCondition(values, conditions, filters.attributionStatus, 'details.attribution_status =');
  }
  const search = filters.search?.trim();
  if (search) {
    values.push(`%${escapeLike(search)}%`);
    const index = values.length;
    conditions.push(`(
      details.source_detail_key ILIKE $${index} ESCAPE '\\'
      OR details.product ILIKE $${index} ESCAPE '\\'
      OR coalesce(details.product_name, '') ILIKE $${index} ESCAPE '\\'
      OR coalesce(details.reporting_model, '') ILIKE $${index} ESCAPE '\\'
      OR coalesce(details.config_name, '') ILIKE $${index} ESCAPE '\\'
      OR coalesce(details.instance_no, '') ILIKE $${index} ESCAPE '\\'
    )`);
  }
  return conditions;
}

function buildOperationalConditions(filters: NormalizedFilters, values: unknown[]) {
  const conditions: string[] = [];
  if (filters.product) {
    values.push(filters.product);
    conditions.push(`$${values.length} = ANY(coalesce(rows.official_products, ARRAY[]::text[]))`);
  }
  if (filters.serviceType) {
    if (filters.serviceType === 'storage' || filters.serviceType === 'other') conditions.push('false');
    else addCondition(values, conditions, filters.serviceType, 'rows.service_type =');
  }
  if (filters.model) addCondition(values, conditions, filters.model, 'rows.model =');
  if (filters.finality) addCondition(values, conditions, filters.finality, 'rows.official_finality =');
  if (filters.attributionStatus && filters.attributionStatus !== 'admin-operational') {
    conditions.push('false');
  }
  const search = filters.search?.trim();
  if (search) {
    values.push(`%${escapeLike(search)}%`);
    const index = values.length;
    conditions.push(`(
      rows.operation_key ILIKE $${index} ESCAPE '\\'
      OR coalesce(rows.source_run_id, '') ILIKE $${index} ESCAPE '\\'
      OR coalesce(rows.source_item_key, '') ILIKE $${index} ESCAPE '\\'
      OR rows.operation ILIKE $${index} ESCAPE '\\'
      OR rows.model ILIKE $${index} ESCAPE '\\'
      OR rows.cost_owner_user_name ILIKE $${index} ESCAPE '\\'
      OR rows.cost_owner_email::text ILIKE $${index} ESCAPE '\\'
      OR coalesce(rows.provider_task_id, '') ILIKE $${index} ESCAPE '\\'
      OR coalesce(rows.provider_operation_id, '') ILIKE $${index} ESCAPE '\\'
      OR coalesce(rows.provider_request_id, '') ILIKE $${index} ESCAPE '\\'
      OR coalesce(rows.evidence_path, '') ILIKE $${index} ESCAPE '\\'
    )`);
  }
  return conditions;
}

function addCondition(
  values: unknown[],
  conditions: string[],
  value: unknown,
  left: string,
) {
  values.push(value);
  conditions.push(`${left} $${values.length}`);
}

function mapBillingDetail(row: DetailRow) {
  return {
    id: row.id,
    provider: row.provider,
    sourceDetailKey: row.source_detail_key,
    billPeriod: row.bill_period,
    expenseDate: toIsoDate(row.expense_date),
    product: row.product,
    productName: row.product_name,
    serviceType: row.service_type,
    model: row.model,
    billLineType: normalizeBillLineType(row.bill_line_type),
    finality: row.finality,
    attributionStatus: row.attribution_status,
    attributionEvidenceId: row.attribution_evidence_id,
    billingMode: row.billing_mode,
    billCategory: row.bill_category,
    instanceNo: row.instance_no,
    configName: row.config_name,
    usageCount: nullableDecimal(row.usage_count),
    usageUnit: row.usage_unit,
    deductionCount: nullableDecimal(row.deduction_count),
    originalBillAmountCny: nullableCny(row.original_bill_amount_cny),
    preferentialBillAmountCny: nullableCny(row.preferential_bill_amount_cny),
    discountBillAmountCny: nullableCny(row.discount_bill_amount_cny),
    couponAmountCny: nullableCny(row.coupon_amount_cny),
    payableAmountCny: nullableCny(row.payable_amount_cny),
    paidAmountCny: nullableCny(row.paid_amount_cny),
    unpaidAmountCny: nullableCny(row.unpaid_amount_cny),
    roundAmountCny: nullableCny(row.round_amount_cny),
    currency: row.currency,
    currentRevisionId: row.current_revision_id,
    syncedAt: toIsoDateTime(row.synced_at),
  };
}

function mapOperationalUsage(row: OperationalRow) {
  return {
    id: row.id,
    origin: row.origin,
    provider: row.provider,
    serviceType: row.service_type,
    model: row.model,
    operation: row.operation,
    operationKey: row.operation_key,
    costOwnerUserId: row.cost_owner_user_id,
    costOwnerUserName: row.cost_owner_user_name,
    costOwnerEmail: row.cost_owner_email,
    purpose: row.purpose,
    initiatorType: row.initiator_type,
    initiatedByUserId: row.initiated_by_user_id,
    sourceRunId: row.source_run_id,
    sourceItemKey: row.source_item_key,
    providerTaskId: row.provider_task_id,
    providerOperationId: row.provider_operation_id,
    providerRequestId: row.provider_request_id,
    status: row.status,
    providerReached: row.provider_reached === null ? null : Boolean(row.provider_reached),
    occurredAt: toIsoDateTime(row.occurred_at),
    localAccountingDate: toIsoDate(row.local_accounting_date),
    usageEvidence: isJsonObject(row.usage_evidence) ? row.usage_evidence : null,
    evidenceStatus: row.evidence_status,
    approvalSha256: row.approval_sha256,
    approvedAt: row.approved_at ? toIsoDateTime(row.approved_at) : null,
    evidencePath: row.evidence_path,
    evidenceSha256: row.evidence_sha256,
    manifestVersion: row.manifest_version,
    manifestId: row.manifest_id,
    manifestSha256: row.manifest_sha256,
    pricingStatus: row.pricing_status,
    priceVersion: row.price_version,
    pricingSourceUrl: row.pricing_source_url,
    unitPriceSnapshot: isJsonObject(row.unit_price_snapshot) ? row.unit_price_snapshot : null,
    estimatedCostCny: nullableNonnegativeCny(row.estimated_cost_cny),
    valuationEvidenceSha256: row.valuation_evidence_sha256,
    valuationRecordedAt: row.valuation_recorded_at ? toIsoDateTime(row.valuation_recorded_at) : null,
    officialAttributionCount: toInt(row.official_attribution_count),
    officialBillDetailId: row.official_bill_detail_id,
    officialSourceDetailKey: row.official_source_detail_key,
    officialFinality: row.official_finality,
    officialAttributedAmountCny: nullableCny(row.official_attributed_amount_cny),
    reconciliationStatus: row.reconciliation_status,
    createdAt: toIsoDateTime(row.recorded_at),
  };
}

async function normalizeSelection(
  client: DbClient,
  filters: NormalizedFilters,
  source: 'official' | 'operational',
): Promise<{ asOf: string; selection: BillingSelection }> {
  const now = new Date();
  const asOf = filters.asOf ? parseAsOf(filters.asOf, now) : now.toISOString();
  const today = beijingDate(new Date(asOf));
  const impliedRange = filters.range
    ?? (filters.from || filters.to ? 'custom' : filters.date ? 'date' : filters.month ? 'month' : 'month');
  if (impliedRange === 'all') {
    const observed = await readObservedRange(client, source, asOf);
    return {
      asOf,
      selection: {
        range: 'all', month: null, date: null,
        rangeStart: observed.start ?? today,
        rangeEnd: observed.end && observed.end <= today ? observed.end : today,
        timezone: 'Asia/Shanghai', grain: 'month',
      },
    };
  }
  if (impliedRange === 'custom') {
    const from = filters.from ?? '';
    const to = filters.to ?? '';
    assertDateRange(from, to, today);
    return {
      asOf,
      selection: {
        range: 'custom', month: null, date: null, rangeStart: from, rangeEnd: to,
        timezone: 'Asia/Shanghai', grain: 'day',
      },
    };
  }
  if (impliedRange === 'date') {
    const date = filters.date ?? '';
    assertDateRange(date, date, today);
    return {
      asOf,
      selection: {
        range: 'date', month: null, date, rangeStart: date, rangeEnd: date,
        timezone: 'Asia/Shanghai', grain: 'day',
      },
    };
  }
  const month = filters.month ?? today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > today.slice(0, 7)) {
    throw reportError('月份格式无效', 'INVALID_MONTH');
  }
  const monthEnd = `${month}-${daysInMonth(month)}`;
  return {
    asOf,
    selection: {
      range: 'month', month, date: null, rangeStart: `${month}-01`,
      rangeEnd: monthEnd < today ? monthEnd : today,
      timezone: 'Asia/Shanghai', grain: 'day',
    },
  };
}

async function readObservedRange(client: DbClient, source: 'official' | 'operational', asOf: string) {
  if (source === 'operational') {
    const result = await client.query<{ start_date: Date | string | null; end_date: Date | string | null }>(
      `WITH observed_dates AS (
         SELECT usage.local_accounting_date
         FROM provider_operational_usage_records usage
         WHERE usage.recorded_at <= $1::timestamptz
         UNION ALL
         SELECT coalesce(
           usage.local_accounting_date,
           (coalesce(
             usage.provider_terminal_at, usage.usage_observed_at,
             usage.completed_at, usage.created_at
           ) AT TIME ZONE 'Asia/Shanghai')::date
         ) AS local_accounting_date
         FROM provider_usage_records usage
         WHERE usage.task_id IS NULL
           AND usage.initiated_by_admin_user_id IS NOT NULL
           AND usage.created_at <= $1::timestamptz
           AND coalesce(
             usage.provider_terminal_at, usage.usage_observed_at,
             usage.completed_at, usage.created_at
           ) <= $1::timestamptz
           AND NOT EXISTS (
             SELECT 1
             FROM provider_operational_usage_records manifest_usage
             WHERE manifest_usage.recorded_at <= $1::timestamptz
               AND manifest_usage.provider = usage.provider
               AND (
                 manifest_usage.id = usage.id
                 OR (
                   usage.provider_task_id IS NOT NULL
                   AND manifest_usage.provider_task_id = usage.provider_task_id
                 )
               )
           )
       )
       SELECT min(local_accounting_date) AS start_date,
              max(local_accounting_date) AS end_date
       FROM observed_dates`,
      [asOf],
    );
    return mapObservedRange(result.rows[0]);
  }
  const result = await client.query<{ start_date: Date | string | null; end_date: Date | string | null }>(
    `WITH observed_dates AS (
       SELECT (revision.normalized_payload->>'expenseDate')::date AS expense_date
       FROM provider_bill_detail_revisions revision
       JOIN provider_billing_sync_runs run ON run.id = revision.sync_run_id
       JOIN provider_bill_sync_run_items item
         ON item.sync_run_id = run.id
        AND item.bill_detail_revision_id = revision.id
       WHERE run.kind = 'bill' AND run.status = 'success'
         AND run.completed_at <= $1::timestamptz
         AND revision.observed_at <= $1::timestamptz
         AND item.created_at <= $1::timestamptz
       UNION
       SELECT details.expense_date
       FROM provider_bill_details details
       WHERE details.active = true AND details.synced_at <= $1::timestamptz
     )
     SELECT min(expense_date) AS start_date, max(expense_date) AS end_date
     FROM observed_dates`,
    [asOf],
  );
  return mapObservedRange(result.rows[0]);
}

function mapObservedRange(row?: { start_date: Date | string | null; end_date: Date | string | null }) {
  return {
    start: row?.start_date ? toIsoDate(row.start_date) : null,
    end: row?.end_date ? toIsoDate(row.end_date) : null,
  };
}

function filterFingerprint(filters: NormalizedFilters, asOf: string, selection: BillingSelection) {
  const { position: _position, cursor: _cursor, snapshotCursor: _snapshotCursor, limit: _limit, ...businessFilters } = filters;
  return { ...businessFilters, asOf, selection };
}

function normalizeFilterObject(value: unknown): NormalizedFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as NormalizedFilters;
}

function parseAsOf(value: string, now: Date) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > now.getTime() + 1_000) {
    throw reportError('asOf 时间无效', 'INVALID_AS_OF');
  }
  return parsed.toISOString();
}

function assertDateRange(from: string, to: string, max: string) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to || to > max) {
    throw reportError('日期范围无效', 'INVALID_DATE_RANGE');
  }
  const days = Math.floor(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
  if (days > 366) throw reportError('日期范围不能超过 367 天', 'INVALID_DATE_RANGE');
}

function isIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function beijingDate(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value);
}

function daysInMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0');
}

function compareBreakdown(
  left: { payableAmountCny: string; product: string },
  right: { payableAmountCny: string; product: string },
) {
  const amountOrder = Number(right.payableAmountCny) - Number(left.payableAmountCny);
  return amountOrder || left.product.localeCompare(right.product);
}

function serviceOrder(value: ServiceType) {
  return ['video', 'image', 'multimodal', 'storage', 'other'].indexOf(value);
}

function attributionOrder(value: AttributionStatus) {
  return ['business', 'admin-operational', 'account-level', 'unattributed'].indexOf(value);
}

function normalizeBillLineType(value: string) {
  return ['usage', 'package-purchase', 'refund', 'adjustment', 'other'].includes(value)
    ? value as 'usage' | 'package-purchase' | 'refund' | 'adjustment' | 'other'
    : 'other' as const;
}

function nullableDecimal(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value);
  return /^-?\d+(?:\.\d+)?$/.test(normalized) ? normalized : null;
}

function nullableCny(value: unknown) {
  return value === null || value === undefined || value === '' ? null : formatCny(value);
}

function nullableNonnegativeCny(value: unknown) {
  const formatted = nullableCny(value);
  return formatted?.startsWith('-') ? null : formatted;
}

function formatCny(value: unknown) {
  const normalized = String(value ?? '0');
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return '0.000000';
  const fraction = (match[3] ?? '').padEnd(6, '0').slice(0, 6);
  return `${match[1]}${match[2]}.${fraction}`;
}

function escapeLike(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function reportError(message: string, code: string) {
  return Object.assign(new Error(message), { statusCode: 400, code });
}
