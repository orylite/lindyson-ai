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
import {
  SEEDREAM_5_PRO_MODEL_ID,
  SEEDREAM_5_PRO_MODEL_LABEL,
  SEEDREAM_ADDITIONAL_REFERENCE_PRICE_CNY_MICROS,
  SEEDREAM_LARGE_IMAGE_PRICE_CNY_MICROS,
  SEEDREAM_LIST_PRICE_SOURCE_URL,
  SEEDREAM_LIST_PRICE_VERSION,
  SEEDREAM_SMALL_IMAGE_MAX_PIXELS,
  SEEDREAM_SMALL_IMAGE_PRICE_CNY_MICROS,
} from './seedreamListPrice.js';
import { toIsoDateTime, toInt } from './serialization.js';

type ImageTaskStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
type ImageEvidenceStatus = 'known' | 'missing-evidence';

export interface ImageCostFilters {
  range?: 'month' | 'custom' | 'date';
  month?: string;
  date?: string;
  from?: string;
  to?: string;
  asOf?: string;
}

export interface ImageCostPageFilters extends ImageCostFilters {
  status?: ImageTaskStatus;
  evidenceStatus?: ImageEvidenceStatus;
  search?: string;
  position?: 'first' | 'previous' | 'next' | 'last';
  cursor?: string;
  snapshotCursor?: string;
  limit?: number;
}

interface ImageCostSelection {
  range: 'month' | 'custom';
  month: string | null;
  date: null;
  rangeStart: string;
  rangeEnd: string;
  timezone: 'Asia/Shanghai';
  grain: 'day';
}

interface ImageTaskCostRow {
  id: string;
  user_id: string;
  user_name: string;
  email: string;
  model: string;
  status: string;
  credit_status: string;
  reserved_credits: unknown;
  settled_credits: unknown;
  refunded_credits: unknown;
  attempt_count: unknown;
  known_usage_count: unknown;
  missing_usage_count: unknown;
  evidence_status: string;
  reference_image_count: unknown;
  additional_reference_image_count: unknown;
  output_width: unknown;
  output_height: unknown;
  output_pixels: unknown;
  output_tier: string | null;
  reference_unit_price_cny: unknown;
  reference_price_cny: unknown;
  output_pixel_threshold: unknown;
  small_output_price_cny: unknown;
  large_output_price_cny: unknown;
  output_price_cny: unknown;
  estimated_cost_cny: unknown;
  pricing_status: string | null;
  price_version: string | null;
  pricing_source_url: string | null;
  provider_operation_id: string | null;
  provider_request_id: string | null;
  request_evidence_status: string;
  generated_images: unknown;
  output_tokens: unknown;
  total_tokens: unknown;
  error: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
}

interface ImageOverviewRow {
  task_count: unknown;
  user_count: unknown;
  completed_task_count: unknown;
  failed_task_count: unknown;
  canceled_task_count: unknown;
  settled_credits: unknown;
  held_credits: unknown;
  refunded_credits: unknown;
  reference_image_count: unknown;
  output_pixels: unknown;
  known_cost_task_count: unknown;
  missing_evidence_task_count: unknown;
  known_cost_cny: unknown;
}

interface ImageOperationalOverviewRow {
  call_count: unknown;
  unpriced_call_count: unknown;
  estimated_cost_cny: unknown;
}

interface ImageUserCostRow {
  id: string;
  user_name: string;
  email: string;
  task_count: unknown;
  completed_task_count: unknown;
  failed_task_count: unknown;
  settled_credits: unknown;
  refunded_credits: unknown;
  reference_image_count: unknown;
  output_pixels: unknown;
  known_cost_task_count: unknown;
  missing_evidence_task_count: unknown;
  known_cost_cny: unknown;
  operational_call_count: unknown;
  operational_unpriced_call_count: unknown;
  business_estimated_cost_cny: unknown;
  operational_estimated_cost_cny: unknown;
  known_account_cost_cny: unknown;
  last_task_at: Date | string | null;
  last_activity_at: Date | string;
}

const SEEDREAM_MODELS = [SEEDREAM_5_PRO_MODEL_LABEL, SEEDREAM_5_PRO_MODEL_ID] as const;

/**
 * 图片看盘只读取 Migration 063 固化的 image_provider_usage_records 价格证据。
 * 严禁关联 Seedance 的 provider_usage_records，也不允许按当前价格规则回算历史任务。
 */
const IMAGE_TASK_COST_CTE = `WITH image_run_counts AS (
  SELECT run.task_id, count(*)::int AS provider_run_count
  FROM generation_provider_runs run
  JOIN generation_tasks task ON task.id = run.task_id
  WHERE task.kind = 'image' AND task.model = ANY($1::text[])
    AND run.created_at <= $4::timestamptz
  GROUP BY run.task_id
), image_usage_ranked AS (
  SELECT usage.*,
         row_number() OVER (
           PARTITION BY usage.task_id
           ORDER BY usage.attempt DESC, usage.created_at DESC, usage.provider_run_id DESC
         ) AS latest_rank
  FROM image_provider_usage_records usage
  WHERE usage.model = ANY($1::text[])
    AND usage.created_at <= $4::timestamptz
), image_usage_aggregates AS (
  SELECT usage.task_id,
         count(*)::int AS usage_count,
         count(*) FILTER (
           WHERE usage.evidence_status = 'known'
             AND usage.pricing_status = 'priced'
             AND usage.estimated_cost_cny IS NOT NULL
         )::int AS known_usage_count,
         count(*) FILTER (
           WHERE usage.evidence_status <> 'known'
              OR usage.pricing_status <> 'priced'
              OR usage.estimated_cost_cny IS NULL
         )::int AS missing_usage_count,
         sum(usage.estimated_cost_cny) FILTER (
           WHERE usage.evidence_status = 'known'
             AND usage.pricing_status = 'priced'
             AND usage.estimated_cost_cny IS NOT NULL
         )::numeric(20,6) AS estimated_cost_cny,
         sum(usage.reference_price_cny) FILTER (
           WHERE usage.evidence_status = 'known' AND usage.pricing_status = 'priced'
         )::numeric(20,6) AS reference_price_cny,
         sum(usage.output_price_cny) FILTER (
           WHERE usage.evidence_status = 'known' AND usage.pricing_status = 'priced'
         )::numeric(20,6) AS output_price_cny,
         max(usage.reference_image_count) FILTER (WHERE usage.latest_rank = 1) AS reference_image_count,
         max(usage.additional_reference_image_count) FILTER (WHERE usage.latest_rank = 1) AS additional_reference_image_count,
         max(usage.output_width) FILTER (WHERE usage.latest_rank = 1) AS output_width,
         max(usage.output_height) FILTER (WHERE usage.latest_rank = 1) AS output_height,
         max(usage.output_pixels) FILTER (WHERE usage.latest_rank = 1) AS output_pixels,
         max(usage.output_tier) FILTER (WHERE usage.latest_rank = 1) AS output_tier,
         max(usage.reference_unit_price_cny) FILTER (WHERE usage.latest_rank = 1) AS reference_unit_price_cny,
         max(usage.output_pixel_threshold) FILTER (WHERE usage.latest_rank = 1) AS output_pixel_threshold,
         max(usage.small_output_price_cny) FILTER (WHERE usage.latest_rank = 1) AS small_output_price_cny,
         max(usage.large_output_price_cny) FILTER (WHERE usage.latest_rank = 1) AS large_output_price_cny,
         max(usage.pricing_status) FILTER (WHERE usage.latest_rank = 1) AS pricing_status,
         max(usage.price_version) FILTER (WHERE usage.latest_rank = 1) AS price_version,
         max(usage.pricing_source_url) FILTER (WHERE usage.latest_rank = 1) AS pricing_source_url,
         max(usage.provider_operation_id) FILTER (WHERE usage.latest_rank = 1) AS provider_operation_id,
         max(usage.provider_request_id) FILTER (WHERE usage.latest_rank = 1) AS provider_request_id,
         max(usage.request_evidence_status) FILTER (WHERE usage.latest_rank = 1) AS request_evidence_status,
         max(usage.generated_images) FILTER (WHERE usage.latest_rank = 1) AS generated_images,
         max(usage.output_tokens) FILTER (WHERE usage.latest_rank = 1) AS output_tokens,
         max(usage.total_tokens) FILTER (WHERE usage.latest_rank = 1) AS total_tokens,
         max(usage.error) FILTER (WHERE usage.latest_rank = 1) AS error
  FROM image_usage_ranked usage
  GROUP BY usage.task_id
), image_task_costs AS (
  SELECT task.id, task.user_id, users.user_name, users.email, task.model, task.status,
         task.credit_status, task.reserved_credits, task.settled_credits, task.refunded_credits,
         greatest(coalesce(runs.provider_run_count, 0), coalesce(usage.usage_count, 0))::int AS attempt_count,
         coalesce(usage.known_usage_count, 0)::int AS known_usage_count,
         (
           coalesce(usage.missing_usage_count, 0)
           + greatest(coalesce(runs.provider_run_count, 0) - coalesce(usage.usage_count, 0), 0)
         )::int AS missing_usage_count,
         CASE
           WHEN coalesce(usage.usage_count, 0) > 0
             AND coalesce(usage.missing_usage_count, 0) = 0
             AND coalesce(usage.usage_count, 0) >= coalesce(runs.provider_run_count, 0)
           THEN 'known'
           ELSE 'missing-evidence'
         END AS evidence_status,
         usage.reference_image_count, usage.additional_reference_image_count,
         usage.output_width, usage.output_height, usage.output_pixels,
         usage.output_tier, usage.reference_unit_price_cny, usage.reference_price_cny,
         usage.output_pixel_threshold, usage.small_output_price_cny, usage.large_output_price_cny,
         usage.output_price_cny, usage.estimated_cost_cny, usage.pricing_status, usage.price_version,
         usage.pricing_source_url, usage.provider_operation_id, usage.provider_request_id,
         coalesce(usage.request_evidence_status, 'missing') AS request_evidence_status,
         usage.generated_images, usage.output_tokens, usage.total_tokens, usage.error,
         task.created_at, task.completed_at
  FROM generation_tasks task
  JOIN users ON users.id = task.user_id
  LEFT JOIN image_run_counts runs ON runs.task_id = task.id
  LEFT JOIN image_usage_aggregates usage ON usage.task_id = task.id
  WHERE task.kind = 'image' AND task.model = ANY($1::text[])
    AND task.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Shanghai')
    AND task.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
    AND task.created_at <= $4::timestamptz
)`;

export async function getAdminImageCostOverview(
  client: DbClient,
  rawFilters: ImageCostFilters | unknown = {},
) {
  const { asOf, selection } = normalizeImageCostSelection(rawFilters);
  const result = await client.query<ImageOverviewRow>(
    `${IMAGE_TASK_COST_CTE}
     SELECT count(*)::int AS task_count,
            count(DISTINCT task.user_id)::int AS user_count,
            count(*) FILTER (WHERE task.status = 'completed')::int AS completed_task_count,
            count(*) FILTER (WHERE task.status = 'failed')::int AS failed_task_count,
            count(*) FILTER (WHERE task.status = 'canceled')::int AS canceled_task_count,
            coalesce(sum(task.settled_credits), 0)::bigint AS settled_credits,
            coalesce(sum(CASE WHEN task.credit_status = 'held' THEN task.reserved_credits ELSE 0 END), 0)::bigint AS held_credits,
            coalesce(sum(task.refunded_credits), 0)::bigint AS refunded_credits,
            coalesce(sum(task.reference_image_count), 0)::bigint AS reference_image_count,
            coalesce(sum(task.output_pixels), 0)::bigint AS output_pixels,
            count(*) FILTER (WHERE task.known_usage_count > 0)::int AS known_cost_task_count,
            count(*) FILTER (WHERE task.evidence_status = 'missing-evidence')::int AS missing_evidence_task_count,
            coalesce(sum(task.estimated_cost_cny), 0)::numeric(20,6) AS known_cost_cny
     FROM image_task_costs task`,
    [SEEDREAM_MODELS, selection.rangeStart, selection.rangeEnd, asOf],
  );
  const operationalResult = await client.query<ImageOperationalOverviewRow>(
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
     WHERE usage.provider = 'volcengine-ark'
       AND usage.service_type = 'image'
       AND usage.model = ANY($4::text[])
       AND usage.local_accounting_date BETWEEN $1::date AND $2::date
       AND usage.recorded_at <= $3::timestamptz`,
    [selection.rangeStart, selection.rangeEnd, asOf, SEEDREAM_MODELS],
  );
  const row = result.rows[0] ?? {} as ImageOverviewRow;
  const operational = operationalResult.rows[0] ?? {} as ImageOperationalOverviewRow;
  const knownCostTaskCount = toInt(row.known_cost_task_count);
  const missingEvidenceTaskCount = toInt(row.missing_evidence_task_count);
  const businessEstimatedCost = cnyMicros(row.known_cost_cny);
  const operationalEstimatedCost = cnyMicros(operational.estimated_cost_cny);
  const knownAccountCost = businessEstimatedCost + operationalEstimatedCost;
  const operationalUnpricedCallCount = toInt(operational.unpriced_call_count);
  return {
    asOf,
    selection,
    summary: {
      taskCount: toInt(row.task_count),
      userCount: toInt(row.user_count),
      completedTaskCount: toInt(row.completed_task_count),
      failedTaskCount: toInt(row.failed_task_count),
      canceledTaskCount: toInt(row.canceled_task_count),
      settledCredits: toInt(row.settled_credits),
      heldCredits: toInt(row.held_credits),
      refundedCredits: toInt(row.refunded_credits),
      referenceImageCount: toInt(row.reference_image_count),
      outputPixels: toInt(row.output_pixels),
      knownCostTaskCount,
      missingEvidenceTaskCount,
      knownCostCny: knownCostTaskCount > 0 ? formatCny(row.known_cost_cny) : null,
      operationalCallCount: toInt(operational.call_count),
      operationalUnpricedCallCount,
      businessEstimatedCostCny: formatCnyFromMicros(businessEstimatedCost),
      operationalEstimatedCostCny: formatCnyFromMicros(operationalEstimatedCost),
      knownAccountCostCny: formatCnyFromMicros(knownAccountCost),
      estimateCompleteness: missingEvidenceTaskCount === 0 && operationalUnpricedCallCount === 0
        ? 'complete' as const
        : knownCostTaskCount > 0 || operationalEstimatedCost > 0n
          ? 'partial' as const : 'unavailable' as const,
    },
    pricing: seedreamPricingDescription(),
  };
}

export async function listAdminImageCostTasks(
  client: DbClient,
  rawFilters: ImageCostPageFilters | unknown = {},
  authorizationScope = 'role:admin',
) {
  const filters = normalizePageFilterObject(rawFilters);
  const { asOf, selection } = normalizeImageCostSelection(filters);
  const businessFilters = {
    range: selection.range,
    month: selection.month,
    from: selection.rangeStart,
    to: selection.rangeEnd,
    status: filters.status ?? null,
    evidenceStatus: filters.evidenceStatus ?? null,
    search: filters.search ?? null,
    asOf,
    authorizationScope,
  };
  const pageQuery = await parseAdminExactKeysetQuery(client, {
    rawQuery: filters,
    filters: businessFilters,
    resource: 'admin-image-cost-tasks',
    versionResource: 'admin:cost-image',
    asOf,
    defaultLimit: 20,
    maxLimit: 100,
  });
  const values: unknown[] = [SEEDREAM_MODELS, selection.rangeStart, selection.rangeEnd, asOf];
  const conditions = buildImageTaskConditions(filters, values);
  const cursorIndex = values.length + 1;
  const limitIndex = cursorIndex + 2;
  const result = await client.query<ImageTaskCostRow & AdminExactTimestampPageMetadata>(
    `${IMAGE_TASK_COST_CTE}
     SELECT task.*,
            ${adminExactTimestampMetadataColumns(pageQuery, 'task.created_at')}
     FROM image_task_costs task
     WHERE ${conditions.length > 0 ? conditions.join(' AND ') : 'true'}
       AND ${adminExactTimestampCursorCondition(pageQuery, 'task.created_at', 'task.id', cursorIndex, cursorIndex + 1)}
     ORDER BY ${adminExactTimestampOrderBy(pageQuery, 'task.created_at', 'task.id')}
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
      map: mapImageTaskCost,
    }),
  };
}

export async function listAdminImageCostUsers(
  client: DbClient,
  rawFilters: ImageCostPageFilters | unknown = {},
  authorizationScope = 'role:admin',
) {
  const filters = normalizePageFilterObject(rawFilters);
  const { asOf, selection } = normalizeImageCostSelection(filters);
  const search = filters.search?.trim() || null;
  const businessFilters = {
    range: selection.range,
    month: selection.month,
    from: selection.rangeStart,
    to: selection.rangeEnd,
    search,
    asOf,
    authorizationScope,
  };
  const pageQuery = await parseAdminExactKeysetQuery(client, {
    rawQuery: filters,
    filters: businessFilters,
    resource: 'admin-image-cost-users-v2',
    versionResource: 'admin:cost-image',
    asOf,
    defaultLimit: 20,
    maxLimit: 100,
  });
  const values: unknown[] = [SEEDREAM_MODELS, selection.rangeStart, selection.rangeEnd, asOf];
  let searchCondition = 'true';
  let operationalSearchCondition = 'true';
  if (search) {
    values.push(`%${escapeLike(search)}%`);
    searchCondition = `(task.user_name ILIKE $${values.length} ESCAPE '\\' OR task.email ILIKE $${values.length} ESCAPE '\\')`;
    operationalSearchCondition = `(owner.user_name ILIKE $${values.length} ESCAPE '\\' OR owner.email ILIKE $${values.length} ESCAPE '\\')`;
  }
  const cursorIndex = values.length + 1;
  const limitIndex = cursorIndex + 2;
  const result = await client.query<ImageUserCostRow & AdminExactTimestampPageMetadata>(
    `${IMAGE_TASK_COST_CTE}, latest_valuation AS (
       SELECT DISTINCT ON (valuation.operational_usage_record_id)
              valuation.operational_usage_record_id,
              valuation.pricing_status,
              valuation.estimated_cost_cny
       FROM provider_operational_usage_valuations valuation
       WHERE valuation.recorded_at <= $4::timestamptz
       ORDER BY valuation.operational_usage_record_id,
                valuation.recorded_at DESC, valuation.id DESC
     ), image_business_user_costs AS (
       SELECT task.user_id AS id, task.user_name, task.email,
              count(*)::int AS task_count,
              count(*) FILTER (WHERE task.status = 'completed')::int AS completed_task_count,
              count(*) FILTER (WHERE task.status = 'failed')::int AS failed_task_count,
              coalesce(sum(task.settled_credits), 0)::bigint AS settled_credits,
              coalesce(sum(task.refunded_credits), 0)::bigint AS refunded_credits,
              coalesce(sum(task.reference_image_count), 0)::bigint AS reference_image_count,
              coalesce(sum(task.output_pixels), 0)::bigint AS output_pixels,
              count(*) FILTER (WHERE task.known_usage_count > 0)::int AS known_cost_task_count,
              count(*) FILTER (WHERE task.evidence_status = 'missing-evidence')::int AS missing_evidence_task_count,
              coalesce(sum(task.estimated_cost_cny), 0)::numeric(20,6) AS known_cost_cny,
              max(task.created_at) AS last_task_at
       FROM image_task_costs task
       WHERE ${searchCondition}
       GROUP BY task.user_id, task.user_name, task.email
     ), image_operational_user_costs AS (
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
       WHERE usage.provider = 'volcengine-ark'
         AND usage.service_type = 'image'
         AND usage.model = ANY($1::text[])
         AND usage.local_accounting_date BETWEEN $2::date AND $3::date
         AND usage.recorded_at <= $4::timestamptz
         AND ${operationalSearchCondition}
       GROUP BY usage.cost_owner_user_id
     ), image_user_costs AS (
       SELECT coalesce(business.id, operational.id) AS id,
              coalesce(business.user_name, operational.user_name) AS user_name,
              coalesce(business.email, operational.email) AS email,
              coalesce(business.task_count, 0)::int AS task_count,
              coalesce(business.completed_task_count, 0)::int AS completed_task_count,
              coalesce(business.failed_task_count, 0)::int AS failed_task_count,
              coalesce(business.settled_credits, 0)::bigint AS settled_credits,
              coalesce(business.refunded_credits, 0)::bigint AS refunded_credits,
              coalesce(business.reference_image_count, 0)::bigint AS reference_image_count,
              coalesce(business.output_pixels, 0)::bigint AS output_pixels,
              coalesce(business.known_cost_task_count, 0)::int AS known_cost_task_count,
              coalesce(business.missing_evidence_task_count, 0)::int AS missing_evidence_task_count,
              business.known_cost_cny,
              coalesce(operational.operational_call_count, 0)::int AS operational_call_count,
              coalesce(operational.operational_unpriced_call_count, 0)::int
                AS operational_unpriced_call_count,
              coalesce(business.known_cost_cny, 0)::numeric(20,6) AS business_estimated_cost_cny,
              coalesce(operational.operational_estimated_cost_cny, 0)::numeric(20,6)
                AS operational_estimated_cost_cny,
              (coalesce(business.known_cost_cny, 0) + coalesce(operational.operational_estimated_cost_cny, 0))::numeric(20,6)
                AS known_account_cost_cny,
              business.last_task_at,
              greatest(
                coalesce(business.last_task_at, '-infinity'::timestamptz),
                coalesce(operational.last_activity_at, '-infinity'::timestamptz)
              ) AS last_activity_at
       FROM image_business_user_costs business
       FULL OUTER JOIN image_operational_user_costs operational ON operational.id = business.id
     )
     SELECT users.*,
            ${adminExactTimestampMetadataColumns(pageQuery, 'users.last_activity_at')}
     FROM image_user_costs users
     WHERE ${adminExactTimestampCursorCondition(pageQuery, 'users.last_activity_at', 'users.id', cursorIndex, cursorIndex + 1)}
     ORDER BY ${adminExactTimestampOrderBy(pageQuery, 'users.last_activity_at', 'users.id')}
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
      map: mapImageUserCost,
    }),
  };
}

function mapImageTaskCost(row: ImageTaskCostRow) {
  return {
    id: row.id,
    taskId: row.id,
    userId: row.user_id,
    userName: row.user_name,
    email: row.email,
    model: row.model,
    status: normalizeTaskStatus(row.status),
    creditStatus: row.credit_status,
    reservedCredits: toInt(row.reserved_credits),
    settledCredits: toInt(row.settled_credits),
    refundedCredits: toInt(row.refunded_credits),
    attemptCount: toInt(row.attempt_count),
    knownUsageCount: toInt(row.known_usage_count),
    missingUsageCount: toInt(row.missing_usage_count),
    evidenceStatus: normalizeEvidenceStatus(row.evidence_status),
    referenceImageCount: nullableInt(row.reference_image_count),
    additionalReferenceImageCount: nullableInt(row.additional_reference_image_count),
    outputWidth: nullableInt(row.output_width),
    outputHeight: nullableInt(row.output_height),
    outputPixels: nullableInt(row.output_pixels),
    outputTier: row.output_tier,
    referenceUnitPriceCny: nullableCny(row.reference_unit_price_cny),
    referencePriceCny: nullableCny(row.reference_price_cny),
    outputPixelThreshold: nullableInt(row.output_pixel_threshold),
    smallOutputPriceCny: nullableCny(row.small_output_price_cny),
    largeOutputPriceCny: nullableCny(row.large_output_price_cny),
    outputPriceCny: nullableCny(row.output_price_cny),
    estimatedCostCny: nullableCny(row.estimated_cost_cny),
    pricingStatus: row.pricing_status,
    priceVersion: row.price_version,
    pricingSourceUrl: row.pricing_source_url,
    providerOperationId: row.provider_operation_id,
    providerRequestId: row.provider_request_id,
    requestEvidenceStatus: normalizeRequestEvidence(row.request_evidence_status),
    generatedImages: nullableInt(row.generated_images),
    outputTokens: nullableInt(row.output_tokens),
    totalTokens: nullableInt(row.total_tokens),
    error: row.error,
    createdAt: toIsoDateTime(row.created_at),
    completedAt: row.completed_at ? toIsoDateTime(row.completed_at) : null,
  };
}

function mapImageUserCost(row: ImageUserCostRow) {
  const knownCostTaskCount = toInt(row.known_cost_task_count);
  const missingEvidenceTaskCount = toInt(row.missing_evidence_task_count);
  const operationalUnpricedCallCount = toInt(row.operational_unpriced_call_count);
  const businessEstimatedCost = cnyMicros(row.business_estimated_cost_cny);
  const operationalEstimatedCost = cnyMicros(row.operational_estimated_cost_cny);
  return {
    id: row.id,
    userId: row.id,
    userName: row.user_name,
    email: row.email,
    taskCount: toInt(row.task_count),
    completedTaskCount: toInt(row.completed_task_count),
    failedTaskCount: toInt(row.failed_task_count),
    settledCredits: toInt(row.settled_credits),
    refundedCredits: toInt(row.refunded_credits),
    referenceImageCount: toInt(row.reference_image_count),
    outputPixels: toInt(row.output_pixels),
    knownCostTaskCount,
    missingEvidenceTaskCount,
    knownCostCny: knownCostTaskCount > 0 ? formatCny(row.known_cost_cny) : null,
    operationalCallCount: toInt(row.operational_call_count),
    operationalUnpricedCallCount,
    businessEstimatedCostCny: formatCnyFromMicros(businessEstimatedCost),
    operationalEstimatedCostCny: formatCnyFromMicros(operationalEstimatedCost),
    knownAccountCostCny: formatCny(row.known_account_cost_cny),
    estimateCompleteness: missingEvidenceTaskCount === 0 && operationalUnpricedCallCount === 0
      ? 'complete' as const
      : knownCostTaskCount > 0 || operationalEstimatedCost > 0n
        ? 'partial' as const : 'unavailable' as const,
    lastTaskAt: row.last_task_at ? toIsoDateTime(row.last_task_at) : toIsoDateTime(row.last_activity_at),
    lastActivityAt: toIsoDateTime(row.last_activity_at),
  };
}

function buildImageTaskConditions(filters: ImageCostPageFilters, values: unknown[]) {
  const conditions: string[] = [];
  if (filters.status) {
    values.push(filters.status);
    conditions.push(`task.status = $${values.length}`);
  }
  if (filters.evidenceStatus) {
    values.push(filters.evidenceStatus);
    conditions.push(`task.evidence_status = $${values.length}`);
  }
  const search = filters.search?.trim();
  if (search) {
    values.push(`%${escapeLike(search)}%`);
    const index = values.length;
    conditions.push(`(
      task.user_name ILIKE $${index} ESCAPE '\\'
      OR task.email ILIKE $${index} ESCAPE '\\'
      OR task.id::text ILIKE $${index} ESCAPE '\\'
      OR coalesce(task.provider_operation_id, '') ILIKE $${index} ESCAPE '\\'
      OR coalesce(task.provider_request_id, '') ILIKE $${index} ESCAPE '\\'
    )`);
  }
  return conditions;
}

function seedreamPricingDescription() {
  return {
    model: SEEDREAM_5_PRO_MODEL_LABEL,
    modelId: SEEDREAM_5_PRO_MODEL_ID,
    currency: 'CNY' as const,
    firstReferenceImageIncluded: 1,
    additionalReferenceUnitPriceCny: formatCnyMicros(SEEDREAM_ADDITIONAL_REFERENCE_PRICE_CNY_MICROS),
    outputPixelThreshold: SEEDREAM_SMALL_IMAGE_MAX_PIXELS,
    smallOutputPriceCny: formatCnyMicros(SEEDREAM_SMALL_IMAGE_PRICE_CNY_MICROS),
    largeOutputPriceCny: formatCnyMicros(SEEDREAM_LARGE_IMAGE_PRICE_CNY_MICROS),
    priceVersion: SEEDREAM_LIST_PRICE_VERSION,
    pricingSourceUrl: SEEDREAM_LIST_PRICE_SOURCE_URL,
    disclaimer: '官网公开列表价估算，不等于火山账户实际扣款；历史任务只读取生成时固化的价格快照。',
  };
}

function normalizeImageCostSelection(raw: unknown): { asOf: string; selection: ImageCostSelection } {
  const filters = normalizePageFilterObject(raw);
  const now = new Date();
  const asOf = filters.asOf ? parseAsOf(filters.asOf, now) : now.toISOString();
  const today = beijingDate(now);
  const currentMonth = today.slice(0, 7);
  if (filters.range === 'custom') {
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
  if (filters.range === 'date') {
    const date = filters.date ?? '';
    assertDateRange(date, date, today);
    return {
      asOf,
      selection: {
        range: 'custom', month: null, date: null, rangeStart: date, rangeEnd: date,
        timezone: 'Asia/Shanghai', grain: 'day',
      },
    };
  }
  const month = filters.month ?? currentMonth;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > currentMonth) {
    throw reportError('月份格式无效', 'INVALID_MONTH');
  }
  const end = month === currentMonth ? today : `${month}-${daysInMonth(month)}`;
  return {
    asOf,
    selection: {
      range: 'month', month, date: null, rangeStart: `${month}-01`, rangeEnd: end,
      timezone: 'Asia/Shanghai', grain: 'day',
    },
  };
}

function normalizePageFilterObject(value: unknown): ImageCostPageFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as ImageCostPageFilters;
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
  const days = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
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

function normalizeTaskStatus(value: string): ImageTaskStatus {
  return ['queued', 'processing', 'completed', 'failed', 'canceled'].includes(value)
    ? value as ImageTaskStatus
    : 'failed';
}

function normalizeEvidenceStatus(value: string): ImageEvidenceStatus {
  return value === 'known' ? 'known' : 'missing-evidence';
}

function normalizeRequestEvidence(value: string) {
  if (value === 'provider-id' || value === 'local-only') return value;
  return 'missing' as const;
}

function nullableInt(value: unknown) {
  return value === null || value === undefined || value === '' ? null : toInt(value);
}

function nullableCny(value: unknown) {
  return value === null || value === undefined || value === '' ? null : formatCny(value);
}

function formatCny(value: unknown) {
  const normalized = String(value ?? '0');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return '0.000000';
  const [whole, fraction = ''] = normalized.split('.');
  return `${whole}.${fraction.padEnd(6, '0').slice(0, 6)}`;
}

function formatCnyMicros(value: number) {
  return (value / 1_000_000).toFixed(6);
}

function cnyMicros(value: unknown) {
  const normalized = String(value ?? '0');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return 0n;
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole ?? '0') * 1_000_000n
    + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}

function formatCnyFromMicros(value: bigint) {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}

function escapeLike(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function reportError(message: string, code: string) {
  return Object.assign(new Error(message), { statusCode: 400, code });
}
