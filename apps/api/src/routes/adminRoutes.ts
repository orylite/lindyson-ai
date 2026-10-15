import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { endpointContracts } from '@lindyson/api-contracts';
import type { z } from 'zod';
import { requireAdmin } from '../auth/session.js';
import {
  pool,
  type DbClient,
  withCostReportingSession,
  withReadOnlyRepeatableRead,
} from '../db/pool.js';
import {
  resolveAdminIdempotencyKey,
  runAdminIdempotentAction,
} from '../domain/adminIdempotency.js';
import { prepareAdminAssetDownload } from '../domain/assetDownloadService.js';
import { mapAssetDetailRow } from '../domain/assets.js';
import {
  mapConsumptionSetting,
  SEEDANCE_25_CONSUMPTION_COMBINATIONS,
  setVideoModelConsumptionAvailabilityWithClient,
} from '../domain/consumption.js';
import {
  mapAdminCreditLedgerRow,
  type AdminCreditLedgerRow,
  type CreditLedgerRow,
} from '../domain/creditLedger.js';
import {
  adminCreditAdjustmentNote,
  adminSubscriptionCreditAdjustmentNote,
} from '../domain/creditLedgerNotes.js';
import {
  adjustCreditLotsWithClient,
  replaceSubscriptionMainLotWithClient,
  setUserAvailableCreditsWithClient,
} from '../domain/financialCredits.js';
import { getBillingDate } from '../domain/billingClock.js';
import {
  fourWayCursorCondition as adminCursorCondition,
  fourWayCursorValues as adminCursorValues,
  exactPageMetadataColumns as adminPageMetadataColumns,
  fourWayPageOrderBy as adminPageOrderBy,
  createExactCursorPage as createAdminPage,
  materializeExactCursorPageQuery as materializeAdminPageQuery,
  parseExactCursorPageRequest as parseAdminPageRequest,
  readAdminPaginationVersion,
  type ExactPageMetadata,
} from '../domain/cursorPagination.js';
import {
  failTaskWithRefundWithClient,
  retryGenerationTaskWithClient,
} from '../domain/generationService.js';
import { mapSafeGenerationTaskConfig } from '../domain/generationTaskResponse.js';
import {
  getAdminApiCostDashboard,
  getAdminApiCostOverview,
  getAdminApiCostReconciliationDetail,
  listAdminApiCostAttempts,
  listAdminApiCostReconciliation,
  listAdminApiCostSettlement,
  listAdminApiCostTasks,
  listAdminApiCostUsers,
} from '../domain/apiCostReporting.js';
import {
  getAdminMultimodalCostOverview,
  listAdminMultimodalCostOperations,
  listAdminMultimodalCostUsers,
} from '../domain/multimodalCostReporting.js';
import {
  getAdminImageCostOverview,
  listAdminImageCostTasks,
  listAdminImageCostUsers,
} from '../domain/imageCostReporting.js';
import {
  getAdminProviderBillingOverview,
  listAdminProviderBillingDetails,
  listAdminProviderOperationalUsage,
} from '../domain/providerBillingReporting.js';
import { readFeatureFlags } from '../domain/featureFlags.js';
import { getInvoiceById,mapInvoice } from '../domain/invoices.js';
import {
  countAdminOrders,
  getOrderById,
  listAdminOrdersPage,
  queueOrderRefundWithClient,
  syncOrderRefund,
} from '../domain/ordersService.js';
import { toIsoDate, toIsoDateTime, toInt } from '../domain/serialization.js';
import {
  assertPortraitEntitlements,
  type PortraitEntitlementValues,
  type PortraitPlanKind,
} from '../domain/portraitEntitlements.js';
import { reconcileSubscriptionWithClient } from '../domain/subscriptionLifecycle.js';
import {
  enqueuePlanPortraitReconciliationWithClient,
  enqueuePortraitEntitlementReconcileWithClient,
} from '../domain/realPortraitReconciliation.js';
import {
  readPromptWizardSettings,
  updatePromptWizardSettingsWithClient,
} from '../domain/promptWizardService.js';
import {
  readTkPromptEngineSettings,
  readTkPromptEngineV6WritesRetired,
  updateTkPromptEngineSettingsWithClient,
} from '../domain/tkPromptEngineRepository.js';
import {
  countAdminTickets,
  getAdminTicket,
  listAdminTicketsPage,
  listTicketMessages,
  mapTicketMessage,
} from '../domain/tickets.js';
import { enqueueGenerationTask } from '../queues/generationQueue.js';
import { requestVolcengineBillingSync } from '../providers/volcengineBillingProvider.js';
import {
  getPaymentChannelAdminView,
  getUnchangedPaymentChannelView,
  savePaymentChannel,
} from '../payments/paymentChannelService.js';

type DateTimeValue = Date | string | null;

interface PlanRow {
  id: string;
  code: string;
  name: string;
  name_en: string;
  kind: PortraitPlanKind;
  billing: string;
  description: string;
  monthly_price: unknown;
  yearly_price: unknown;
  credits: unknown;
  asset_retention_days: unknown;
  portrait_enabled: boolean;
  portrait_profile_limit: unknown;
  portrait_active_limit: unknown;
  portrait_assets_per_actor: unknown;
  storage_label: string;
  tiktok_accounts: string;
  recommendation: string | null;
  icon_key: string | null;
  cta_label: string;
  status: string;
  landing_visible: boolean;
  subscribers?: unknown;
  revenue?: unknown;
  features: unknown;
  created_at: DateTimeValue;
  updated_at: DateTimeValue;
}

interface AdminUserRow {
  id: string;
  email: string;
  user_name: string;
  role: string;
  status: string;
  plan_id: string | null;
  plan_code: string | null;
  plan_name: string | null;
  billing_cycle: 'monthly' | 'yearly';
  main_credits: unknown;
  addon_credits: unknown;
  total_credits: unknown;
  order_count: unknown;
  ticket_count: unknown;
  api_calls: unknown;
  plan_cycle_started_at: DateTimeValue;
  plan_reset_at: DateTimeValue;
  plan_expires_at: DateTimeValue;
  active_subscription_order_id: string | null;
  registered_at: Date | string;
  last_active_at: DateTimeValue;
}

interface AssignablePlanRow {
  id: string;
  code: string;
  name: string;
  kind: 'main' | 'addon';
  billing: 'monthly' | 'yearly' | 'both' | 'one-time';
  status: 'active' | 'disabled' | 'draft';
  credits: unknown;
}

interface AdminSubscriptionStateRow {
  id: string;
  email: string;
  plan_id: string | null;
  plan_code: string | null;
  plan_name: string | null;
  billing_cycle: 'monthly' | 'yearly';
  plan_cycle_started_at: DateTimeValue;
  plan_reset_at: DateTimeValue;
  plan_expires_at: DateTimeValue;
  active_subscription_order_id: string | null;
  main_credits: unknown;
  addon_credits: unknown;
}

type AdminUserSubscriptionPayload = z.infer<typeof endpointContracts.adminUserSubscription.body>;

interface AdminJobRow {
  id: string;
  user_id: string;
  user_name: string;
  email: string;
  kind: string;
  model: string;
  status: string;
  attempt: unknown;
  processing_stage: string | null;
  cancel_state: string | null;
  claim_epoch: unknown;
  active_provider_run_id: string | null;
  provider_run_status?: string | null;
  provider_task_id: string | null;
  failure_category: string | null;
  failure_reason: string | null;
  settlement_error: string | null;
  prompt: string;
  config: unknown;
  credits: unknown;
  reserved_credits: unknown;
  settled_credits: unknown;
  refunded_credits: unknown;
  main_credits_used: unknown;
  addon_credits_used: unknown;
  credit_status: string;
  asset_id: string | null;
  asset_name: string | null;
  asset_source: string | null;
  retry_count: unknown;
  ledger_ids: unknown;
  created_at: Date | string;
  started_at: DateTimeValue;
  heartbeat_at: DateTimeValue;
  lease_expires_at: DateTimeValue;
  completed_at: DateTimeValue;
}

interface AdminJobCardRow {
  id: string;
  user_id: string;
  user_name: string;
  email: string;
  kind: string;
  model: string;
  status: string;
  processing_stage: string;
  failure_category: string | null;
  credit_status: string;
  asset_id: string | null;
  asset_name: string | null;
  asset_source: string | null;
  retry_count: unknown;
  active_provider_run_id: string | null;
  provider_run_status: string | null;
  created_at: Date | string;
}

interface AuditLogRow {
  id: string;
  admin_user_id: string | null;
  admin_email: string;
  module: string;
  action: string;
  target: string;
  risk: string;
  ip: string | null;
  detail: string;
  created_at: Date | string;
}

interface AnnouncementRow {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  published_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

async function runCostReport<T>(
  request: FastifyRequest,
  timeoutMs: number,
  read: (client: import('pg').PoolClient) => Promise<T>,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (request.raw.aborted) abort();
  else request.raw.once('aborted', abort);
  try {
    return await withCostReportingSession({ timeoutMs, signal: controller.signal }, read);
  } finally {
    request.raw.off('aborted', abort);
  }
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get('/api/admin/navigation-summary', async request => {
    await requireAdmin(request);
    const result = await pool.query<{
      open_tickets: unknown;
      pending_invoices: unknown;
      active_jobs: unknown;
      manual_review_payments: unknown;
      manual_review_refunds: unknown;
      as_of: Date | string;
    }>(
      `SELECT
         (SELECT count(*) FROM tickets WHERE status <> 'resolved') AS open_tickets,
         (SELECT count(*) FROM invoice_requests WHERE status = 'unissued') AS pending_invoices,
         (SELECT count(*) FROM generation_tasks WHERE status IN ('queued', 'processing')) AS active_jobs,
         (SELECT count(*) FROM payment_attempts WHERE status = 'manual-review') AS manual_review_payments,
         (SELECT count(*) FROM order_refund_attempts WHERE status = 'manual-review') AS manual_review_refunds,
         now() AS as_of`,
    );
    const row = result.rows[0]!;
    return {
      openTickets: toInt(row.open_tickets),
      pendingInvoices: toInt(row.pending_invoices),
      activeJobs: toInt(row.active_jobs),
      manualReviewPayments: toInt(row.manual_review_payments),
      manualReviewRefunds: toInt(row.manual_review_refunds),
      asOf: toIsoDateTime(row.as_of),
    };
  });

  app.get('/api/admin/overview', async request => {
    await requireAdmin(request);
    const result = await pool.query(
      `WITH boundaries AS (
         SELECT
           date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai' AS day_start,
           date_trunc('month', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai' AS month_start
       ),
       revenue_days AS (
         SELECT generate_series(
           day_start - interval '6 days',
           day_start,
           interval '1 day'
         ) AS day_start
         FROM boundaries
       ),
       revenue_trend AS (
         SELECT
           rd.day_start,
           coalesce(sum(o.amount), 0)::bigint AS revenue,
           count(o.id)::int AS orders
         FROM revenue_days rd
         LEFT JOIN orders o
           ON o.status = 'paid'
          AND o.paid_at >= rd.day_start
          AND o.paid_at < rd.day_start + interval '1 day'
         GROUP BY rd.day_start
       ),
       model_usage_sources AS (
         SELECT
           pur.model,
           pur.billable_tokens::bigint AS token_count
         FROM provider_usage_records pur, boundaries
         WHERE pur.status = 'success'
           AND pur.usage_unit = 'tokens'
           AND pur.billable_tokens IS NOT NULL
           AND coalesce(pur.completed_at, pur.created_at) >= day_start - interval '29 days'
           AND coalesce(pur.completed_at, pur.created_at) < day_start + interval '1 day'
         UNION ALL
         SELECT
           image_usage.model,
           image_usage.total_tokens::bigint AS token_count
         FROM image_provider_usage_records image_usage, boundaries
         WHERE image_usage.status = 'success'
           AND image_usage.total_tokens IS NOT NULL
           AND image_usage.created_at >= day_start - interval '29 days'
           AND image_usage.created_at < day_start + interval '1 day'
         UNION ALL
         SELECT
           CASE
             WHEN prompt_usage.model = 'doubao-seed-2-0-lite-260428'
               THEN 'Doubao Seed 2.0 Lite'
             ELSE prompt_usage.model
           END AS model,
           (prompt_usage.input_tokens::bigint + prompt_usage.output_tokens::bigint) AS token_count
         FROM prompt_wizard_provider_requests prompt_usage, boundaries
         WHERE prompt_usage.request_status = 'succeeded'
           AND prompt_usage.input_tokens IS NOT NULL
           AND prompt_usage.output_tokens IS NOT NULL
           AND coalesce(prompt_usage.completed_at, prompt_usage.created_at) >= day_start - interval '29 days'
           AND coalesce(prompt_usage.completed_at, prompt_usage.created_at) < day_start + interval '1 day'
       ), model_usage AS (
         SELECT
           model,
           coalesce(sum(token_count), 0)::bigint AS billable_tokens
         FROM model_usage_sources
         GROUP BY model
         HAVING coalesce(sum(token_count), 0) > 0
       ), cost_sync_ranked AS (
         SELECT CASE WHEN kind LIKE 'bill%' THEN 'bill' ELSE kind END AS sync_kind,
                CASE WHEN completed_at > now() THEN 'running' ELSE status END AS status,
                CASE WHEN completed_at > now() THEN NULL ELSE completed_at END AS completed_at,
                row_number() OVER (
                  PARTITION BY CASE WHEN kind LIKE 'bill%' THEN 'bill' ELSE kind END
                  ORDER BY started_at DESC, id DESC
                ) AS row_number
         FROM provider_billing_sync_runs
         WHERE provider = 'volcengine-ark'
           AND started_at <= now()
           AND (kind = 'balance' OR kind = 'packages' OR kind LIKE 'bill%')
       ), cost_sync_health AS (
         SELECT CASE
                  WHEN count(*) FILTER (WHERE row_number = 1) < 3 THEN 'warning'
                  WHEN bool_or(status NOT IN ('success', 'running')) FILTER (WHERE row_number = 1) THEN 'error'
                  WHEN bool_or(status = 'running') FILTER (WHERE row_number = 1) THEN 'warning'
                  WHEN bool_or(
                    completed_at IS NULL OR completed_at < now() - CASE
                      WHEN sync_kind = 'balance' THEN interval '15 minutes'
                      ELSE interval '30 minutes'
                    END
                  ) FILTER (WHERE row_number = 1) THEN 'warning'
                  ELSE 'normal'
                END AS sync_status,
                max(completed_at) FILTER (
                  WHERE row_number = 1 AND status = 'success' AND completed_at <= now()
                ) AS last_synced_at
         FROM cost_sync_ranked
       ), latest_reconciliation AS (
         SELECT DISTINCT ON (provider) match_state, residual_tokens, residual_cost_cny
         FROM provider_reconciliation_runs
         WHERE provider = 'volcengine-ark'
         ORDER BY provider, created_at DESC, id DESC
       )
       SELECT
         (SELECT count(*)::int FROM users) AS total_users,
         (SELECT count(*)::int FROM users, boundaries WHERE registered_at >= day_start) AS today_new_users,
         (SELECT count(*)::int FROM users, boundaries WHERE registered_at >= month_start) AS month_new_users,
         (SELECT coalesce(sum(amount), 0)::bigint FROM orders WHERE status = 'paid') AS total_revenue,
         (SELECT coalesce(sum(amount), 0)::bigint FROM orders, boundaries WHERE status = 'paid' AND paid_at >= day_start) AS today_revenue,
         (SELECT coalesce(sum(amount), 0)::bigint FROM orders, boundaries WHERE status = 'paid' AND paid_at >= month_start) AS month_revenue,
         (SELECT coalesce(sum(amount), 0)::bigint FROM orders, boundaries WHERE status = 'paid' AND paid_at >= day_start - interval '6 days') AS seven_day_revenue,
         (SELECT count(*)::int FROM generation_tasks) AS total_jobs,
         (SELECT count(*)::int FROM generation_tasks, boundaries WHERE created_at >= day_start) AS today_jobs,
         (SELECT count(*)::int FROM generation_tasks WHERE status IN ('queued', 'processing')) AS active_jobs,
         (SELECT count(*)::int FROM tickets WHERE status <> 'resolved') AS open_tickets,
         (SELECT count(*)::int FROM invoice_requests WHERE status <> 'issued') AS pending_invoices,
         (SELECT count(*)::int
            FROM orders, boundaries
           WHERE status = 'failed'
             AND coalesce(failed_at, created_at) >= day_start - interval '6 days'
             AND coalesce(failed_at, created_at) < day_start + interval '1 day') AS seven_day_payment_failures,
         (SELECT count(*)::int
            FROM users, boundaries
           WHERE last_active_at < day_start - interval '30 days') AS inactive_users,
         (SELECT count(*)::int FROM generation_tasks WHERE status = 'failed') AS failed_jobs,
         (SELECT count(*)::int
            FROM provider_usage_records, boundaries
           WHERE coalesce(completed_at, created_at) >= day_start - interval '6 days'
             AND coalesce(completed_at, created_at) < day_start + interval '1 day') AS seven_day_api_requests,
         (SELECT count(*)::int
            FROM provider_usage_records, boundaries
           WHERE status = 'success'
             AND coalesce(completed_at, created_at) >= day_start - interval '6 days'
             AND coalesce(completed_at, created_at) < day_start + interval '1 day') AS seven_day_api_successes,
         (SELECT coalesce(
            jsonb_agg(
              jsonb_build_object(
                'day', to_char(day_start AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD'),
                'revenue', revenue,
                'orders', orders
              ) ORDER BY day_start
            ),
            '[]'::jsonb
          ) FROM revenue_trend) AS revenue_trend,
         (SELECT coalesce(
            jsonb_agg(
              jsonb_build_object('model', model, 'billableTokens', billable_tokens)
              ORDER BY billable_tokens DESC, model ASC
            ),
            '[]'::jsonb
          ) FROM model_usage) AS model_usage,
         (SELECT day_start FROM boundaries) AS day_start,
         (SELECT month_start FROM boundaries) AS month_start,
         (SELECT sync_status FROM cost_sync_health) AS cost_sync_status,
         (SELECT last_synced_at FROM cost_sync_health) AS cost_last_synced_at,
         (SELECT match_state FROM latest_reconciliation) AS cost_match_state,
         (SELECT residual_tokens FROM latest_reconciliation) AS cost_residual_tokens,
         (SELECT residual_cost_cny FROM latest_reconciliation) AS cost_residual_cost_cny`,
    );
    const row = result.rows[0] ?? {};
    const sevenDayApiRequests = toInt(row.seven_day_api_requests);
    const sevenDayApiSuccesses = toInt(row.seven_day_api_successes);
    return {
      summary: {
        totalUsers: toInt(row.total_users),
        todayNewUsers: toInt(row.today_new_users),
        monthNewUsers: toInt(row.month_new_users),
        totalRevenue: toInt(row.total_revenue),
        todayRevenue: toInt(row.today_revenue),
        monthRevenue: toInt(row.month_revenue),
        sevenDayRevenue: toInt(row.seven_day_revenue),
        totalJobs: toInt(row.total_jobs),
        todayJobs: toInt(row.today_jobs),
        activeJobs: toInt(row.active_jobs),
        openTickets: toInt(row.open_tickets),
        pendingInvoices: toInt(row.pending_invoices),
        sevenDayPaymentFailures: toInt(row.seven_day_payment_failures),
        inactiveUsers: toInt(row.inactive_users),
        failedJobs: toInt(row.failed_jobs),
        sevenDayApiRequests,
        sevenDayApiSuccesses,
        sevenDayApiSuccessRate: sevenDayApiRequests > 0
          ? Math.round((sevenDayApiSuccesses / sevenDayApiRequests) * 100)
          : 100,
        revenueTrend: mapAdminRevenueTrend(row.revenue_trend),
        modelUsage: mapAdminModelUsage(row.model_usage),
        timezone: 'Asia/Shanghai',
        dayStart: toIsoDateTime(row.day_start),
        monthStart: toIsoDateTime(row.month_start),
      },
      apiCostHealth: {
        syncStatus: normalizeCostSyncStatus(row.cost_sync_status),
        lastSyncedAt: toIsoDateTime(row.cost_last_synced_at) ?? '-',
        matchState: normalizeCostMatchState(row.cost_match_state),
        residualTokens: row.cost_match_state == null ? null : toInt(row.cost_residual_tokens),
        residualCostCny: row.cost_match_state == null ? null : formatAdminCny(row.cost_residual_cost_cny),
      },
    };
  });

  app.get('/api/admin/payment-channel', async request => {
    await requireAdmin(request);
    return { channel: await getPaymentChannelAdminView() };
  });

  app.put('/api/admin/payment-channel', async (request, reply) => {
    const admin = await requireAdmin(request);
    const payload = endpointContracts.adminPaymentChannelSave.body.parse(request.body);
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'payment-channel-save', target: 'jeepay', body: payload,
      responseSchema: endpointContracts.adminPaymentChannelSave.response,
      execute: async client => {
        const unchanged = await getUnchangedPaymentChannelView(client, payload);
        if (unchanged) return { channel: unchanged };

        const channel = await savePaymentChannel(client, admin.id, payload);
        await appendAuditWithClient(
          client,
          admin.id,
          '支付通道',
          '保存配置',
          '在线支付',
          'high',
          payload.enabled ? '支付通道配置已保存并启用。' : '支付通道配置已保存并停用。',
          request.ip,
        );
        return { channel };
      },
    });
  });

  app.get('/api/admin/plans', async request => {
    await requireAdmin(request);
    const result = await pool.query(
      `SELECT p.*,
              COALESCE(s.subscribers, 0) AS subscribers,
              COALESCE(r.revenue, 0) AS revenue
       FROM plans p
       LEFT JOIN (
         SELECT effective.plan_id, count(*)::integer AS subscribers
         FROM (
           SELECT COALESCE(u.plan_id, default_plan.id) AS plan_id
           FROM users u
           LEFT JOIN LATERAL (
             SELECT id FROM plans WHERE code = 'free' AND kind = 'main' LIMIT 1
           ) default_plan ON true
         ) effective
         WHERE effective.plan_id IS NOT NULL
         GROUP BY effective.plan_id
       ) s ON s.plan_id = p.id
       LEFT JOIN (
         SELECT plan_id, sum(amount)::bigint AS revenue
         FROM orders WHERE status = 'paid' AND plan_id IS NOT NULL GROUP BY plan_id
       ) r ON r.plan_id = p.id
       ORDER BY CASE WHEN p.kind = 'main' THEN 0 ELSE 1 END,
                p.monthly_price ASC,
                p.created_at ASC`,
    );
    return { items: result.rows.map(mapPlan) };
  });

  app.post('/api/admin/plans', async (request, reply) => {
    const admin = await requireAdmin(request);
    const payload = endpointContracts.adminPlanCreate.body.parse(request.body);
    if (payload.code.toLowerCase() === 'free') {
      throw publicRouteError('免费版套餐代码由系统保留', 400, 'FREE_PLAN_CODE_RESERVED');
    }
    if (payload.kind === 'addon' && (payload.assetRetentionDays ?? 0) !== 0) {
      throw publicRouteError('加购包不能设置 AI 生成素材保留天数', 400, 'ADDON_RETENTION_NOT_ALLOWED');
    }
    const iconKey = payload.kind === 'main' ? payload.iconKey ?? 'sparkles' : null;
    const landingVisible = payload.kind === 'main' ? payload.landingVisible ?? false : false;
    const assetRetentionDays = payload.kind === 'main' ? payload.assetRetentionDays ?? 0 : 0;
    const portraitEntitlements = requestedPortraitEntitlements(
      payload.kind,
      payload.portraitEntitlements,
      { requireExplicitMain: true },
    );
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'plan-create', target: 'collection', body: payload,
      responseSchema: endpointContracts.adminPlanCreate.response,
      execute: async client => {
        if (payload.recommendation) await clearPlanRecommendation(client, payload.recommendation);
        const result = await client.query(
          `INSERT INTO plans (
             code, name, name_en, kind, billing, description, monthly_price,
             yearly_price, credits, storage_label, tiktok_accounts,
             recommendation, icon_key, cta_label, status, landing_visible, features,
             asset_retention_days, portrait_enabled, portrait_profile_limit,
             portrait_active_limit, portrait_assets_per_actor
           )
           VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
           )
           RETURNING *`,
          [
            payload.code,
            payload.name,
            payload.nameEn ?? '',
            payload.kind,
            payload.billing,
            payload.description ?? '',
            payload.monthlyPrice ?? 0,
            payload.yearlyPrice ?? 0,
            payload.credits,
            payload.storage ?? '',
            payload.tiktokAccounts ?? '',
            payload.recommendation ?? null,
            iconKey,
            payload.ctaLabel ?? '',
            payload.status ?? 'draft',
            landingVisible,
            JSON.stringify(payload.features ?? []),
            assetRetentionDays,
            portraitEntitlements.portraitEnabled,
            portraitEntitlements.portraitProfileLimit,
            portraitEntitlements.portraitActiveLimit,
            portraitEntitlements.portraitAssetsPerActor,
          ],
        );
        await appendAuditWithClient(
          client, admin.id, '订阅套餐', '新增套餐', result.rows[0].code, 'medium',
          `新增套餐 ${result.rows[0].name}`, request.ip,
        );
        return { plan: mapPlan(result.rows[0]) };
      },
    });
  });

  app.patch('/api/admin/plans/:id', async (request, reply) => {
    const admin = await requireAdmin(request);
    const { id } = endpointContracts.adminPlanUpdate.params.parse(request.params);
    const rawPayload = request.body as Record<string, unknown> | null | undefined;
    if (!rawPayload || !Object.prototype.hasOwnProperty.call(rawPayload, 'portraitEntitlements')) {
      throw publicRouteError(
        '编辑套餐时必须显式提交真人演员库权益配置',
        400,
        'PORTRAIT_ENTITLEMENTS_REQUIRED',
      );
    }
    const payload = endpointContracts.adminPlanUpdate.body.parse(request.body);
    if (Object.keys(payload).length === 0) throw publicRouteError('请至少提交一个套餐字段', 400, 'EMPTY_PATCH');
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'plan-update', target: id, body: payload,
      responseSchema: endpointContracts.adminPlanUpdate.response,
      execute: async (client, actionId) => {
        const current = await client.query('SELECT * FROM plans WHERE id = $1 FOR UPDATE', [id]);
        if (!current.rowCount) throw Object.assign(new Error('套餐不存在'), { statusCode: 404 });
        const plan = current.rows[0];
        const nextKind = payload.kind ?? plan.kind;
        const nextCode = payload.code ?? plan.code;
        if (String(plan.code) === 'free'
          && (String(nextCode) !== 'free' || nextKind !== 'main')) {
          throw publicRouteError('免费版套餐代码和类型不能修改', 400, 'FREE_PLAN_IDENTITY_IMMUTABLE');
        }
        if (String(plan.code) !== 'free' && String(nextCode).toLowerCase() === 'free') {
          throw publicRouteError('免费版套餐代码由系统保留', 400, 'FREE_PLAN_CODE_RESERVED');
        }
        if (nextKind === 'addon' && payload.assetRetentionDays !== undefined && payload.assetRetentionDays !== 0) {
          throw publicRouteError('加购包不能设置 AI 生成素材保留天数', 400, 'ADDON_RETENTION_NOT_ALLOWED');
        }
        if (nextKind === 'addon' && !isDisabledPortraitEntitlements(payload.portraitEntitlements)) {
          throw publicRouteError('加购包不能包含真人人像素材库权益', 400, 'ADDON_PORTRAIT_ENTITLEMENTS_NOT_ALLOWED');
        }
        if (plan.kind === 'main' && nextKind === 'addon') {
          // plans 已由上方 FOR UPDATE 锁定；外键写入 users.plan_id 需要取得该计划行的键共享锁，
          // 因而检查完成至事务提交期间不会出现新的订阅者引用。
          const subscribers = await client.query(
            `SELECT 1
             FROM users
             WHERE plan_id = $1
             LIMIT 1`,
            [id],
          );
          if (subscribers.rowCount) {
            throw publicRouteError(
              '该主套餐仍有订阅用户，不能转换为加购包；请先迁移用户套餐',
              409,
              'PLAN_KIND_CHANGE_HAS_SUBSCRIBERS',
            );
          }
        }
        const nextIconKey = nextKind === 'main' ? payload.iconKey ?? plan.icon_key ?? 'sparkles' : null;
        const nextRecommendation = payload.recommendation === undefined ? plan.recommendation : payload.recommendation;
        const nextLandingVisible = nextKind === 'main'
          ? payload.landingVisible ?? Boolean(plan.landing_visible)
          : false;
        const nextFeatures = payload.features ?? plan.features ?? [];
        const nextPortraitEntitlements = nextKind === 'addon'
          ? disabledPortraitEntitlements()
          : requestedPortraitEntitlements('main', payload.portraitEntitlements);
        const previousPortraitEntitlements = planPortraitEntitlements(plan);
        const nextValues = [
          nextCode, payload.name ?? plan.name, payload.nameEn ?? plan.name_en,
          nextKind, payload.billing ?? plan.billing, payload.description ?? plan.description,
          payload.monthlyPrice ?? toInt(plan.monthly_price), payload.yearlyPrice ?? toInt(plan.yearly_price),
          payload.credits ?? toInt(plan.credits), payload.storage ?? plan.storage_label,
          payload.tiktokAccounts ?? plan.tiktok_accounts, nextRecommendation, nextIconKey,
          payload.ctaLabel ?? plan.cta_label, payload.status ?? plan.status,
          nextLandingVisible,
          nextKind === 'main' ? payload.assetRetentionDays ?? toInt(plan.asset_retention_days) : 0,
          nextPortraitEntitlements.portraitEnabled,
          nextPortraitEntitlements.portraitProfileLimit,
          nextPortraitEntitlements.portraitActiveLimit,
          nextPortraitEntitlements.portraitAssetsPerActor,
        ];
        const currentValues = [
          plan.code, plan.name, plan.name_en, plan.kind, plan.billing, plan.description,
          toInt(plan.monthly_price), toInt(plan.yearly_price), toInt(plan.credits), plan.storage_label,
          plan.tiktok_accounts, plan.recommendation, plan.icon_key, plan.cta_label, plan.status,
          Boolean(plan.landing_visible),
          toInt(plan.asset_retention_days),
          Boolean(plan.portrait_enabled),
          plan.portrait_profile_limit === null ? null : toInt(plan.portrait_profile_limit),
          toInt(plan.portrait_active_limit),
          toInt(plan.portrait_assets_per_actor),
        ];
        if (JSON.stringify(nextValues) === JSON.stringify(currentValues) && sameJson(nextFeatures, plan.features ?? [])) {
          return { plan: mapPlan(plan) };
        }
        if (nextRecommendation) await clearPlanRecommendation(client, nextRecommendation, id);
        const result = await client.query(
          `UPDATE plans
           SET code = $2, name = $3, name_en = $4, kind = $5, billing = $6,
               description = $7, monthly_price = $8, yearly_price = $9, credits = $10,
               storage_label = $11, tiktok_accounts = $12, recommendation = $13,
               icon_key = $14, cta_label = $15, status = $16, landing_visible = $17,
               asset_retention_days = $18, portrait_enabled = $19,
               portrait_profile_limit = $20, portrait_active_limit = $21,
               portrait_assets_per_actor = $22, features = $23, updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [id, ...nextValues, JSON.stringify(nextFeatures)],
        );
        await enqueuePlanPortraitReconciliationWithClient(client, {
          planId: id,
          planCode: String(nextCode),
          eventKeyPrefix: `portrait-plan-update:${actionId}`,
          reason: 'admin-plan-entitlements-updated',
          oldEntitlements: previousPortraitEntitlements,
          newEntitlements: nextPortraitEntitlements,
        });
        await appendAuditWithClient(
          client, admin.id, '订阅套餐', '修改套餐', id, 'medium',
          `修改套餐 ${result.rows[0].name}`, request.ip,
        );
        return { plan: mapPlan(result.rows[0]) };
      },
    });
  });

  app.get('/api/admin/users', async request => {
    const admin = await requireAdmin(request);
    const rawQuery = endpointContracts.adminUsers.query.parse(request.query);
    const filters = { search: rawQuery.search ?? '', status: rawQuery.status ?? null };
    const resource = 'admin-users';
    const pageRequest = parseAdminPageRequest({
      ...rawQuery,
      filters: adminExactPaginationFilters(admin.id, rawQuery.limit, filters),
      resource,
      defaultLimit: 20,
      maxLimit: 50,
    });
    return withReadOnlyRepeatableRead(async client => {
      const version = await readAdminPaginationVersion(client, resource);
      const totalItems = pageRequest.snapshot
        ? undefined
        : (await client.query<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM users u
             LEFT JOIN plans search_plan ON search_plan.id = u.plan_id
             WHERE ($1::text IS NULL OR u.status = $1)
               AND ($2::text IS NULL OR (
                 u.user_name ILIKE '%' || $2 || '%'
                 OR u.email::text ILIKE '%' || $2 || '%'
                 OR search_plan.name ILIKE '%' || $2 || '%'
               ))`,
            [rawQuery.status ?? null, rawQuery.search || null],
          )).rows[0]?.count;
      const query = materializeAdminPageQuery(pageRequest, {
        resourceVersion: version.version,
        snapshotAt: version.snapshotAt,
        totalItems,
      });
      const result = await client.query(
      `WITH paged_users AS MATERIALIZED (
         SELECT u.*,
                ${adminPageMetadataColumns('u.registered_at')}
         FROM users u
         LEFT JOIN plans search_plan ON search_plan.id = u.plan_id
         WHERE ${adminCursorCondition(query, 'u.registered_at', 'u.id')}
           AND ($3::text IS NULL OR u.status = $3)
           AND ($4::text IS NULL OR (
             u.user_name ILIKE '%' || $4 || '%'
             OR u.email::text ILIKE '%' || $4 || '%'
             OR search_plan.name ILIKE '%' || $4 || '%'
           ))
         ORDER BY ${adminPageOrderBy(query, 'u.registered_at', 'u.id')}
         LIMIT $5
       )
       SELECT u.*, p.code AS plan_code, p.name AS plan_name,
              (SELECT count(*)::int FROM orders o WHERE o.user_id = u.id) AS order_count,
              (SELECT count(*)::int FROM tickets t WHERE t.user_id = u.id) AS ticket_count,
              (
                SELECT count(pur.id)::int
                FROM provider_usage_records pur
                LEFT JOIN generation_tasks gt ON gt.id = pur.task_id
                WHERE coalesce(gt.user_id, pur.initiated_by_admin_user_id) = u.id
              ) AS api_calls
       FROM paged_users u
       LEFT JOIN plans p ON p.id = u.plan_id
       ORDER BY ${adminPageOrderBy(query, 'u.registered_at', 'u.id')}`,
      [...adminCursorValues(query), rawQuery.status ?? null, rawQuery.search || null, query.limit + 1],
    );
      return createAdminPage({
        rows: result.rows,
        query,
        getId: row => row.id,
        map: mapAdminUser,
      });
    });
  });

  app.patch('/api/admin/users/:id/status', async (request, reply) => {
    const admin = await requireAdmin(request);
    const { id } = endpointContracts.adminUserStatus.params.parse(request.params);
    const payload = endpointContracts.adminUserStatus.body.parse(request.body);
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'user-status-update', target: id, body: payload,
      responseSchema: endpointContracts.adminUserStatus.response,
      execute: async client => {
        const current = await client.query<{ email: string; status: string }>(
          'SELECT email, status FROM users WHERE id = $1 FOR UPDATE', [id],
        );
        if (!current.rowCount) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
        if (current.rows[0]!.status !== payload.status) {
          await client.query(
            `UPDATE users SET auth_version = auth_version + 1, status = $2, updated_at = now() WHERE id = $1`,
            [id, payload.status],
          );
          await appendAuditWithClient(
            client, admin.id, '用户管理', '修改用户状态', id, 'high',
            `用户 ${current.rows[0]!.email} 状态改为 ${payload.status}`, request.ip,
          );
        }
        const user = await getAdminUserDto(client, id);
        if (!user) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
        return { user };
      },
    });
  });

  app.patch('/api/admin/users/:id/subscription', async (request, reply) => {
    const admin = await requireAdmin(request);
    const { id } = endpointContracts.adminUserSubscription.params.parse(request.params);
    const payload = endpointContracts.adminUserSubscription.body.parse(request.body);
    return runAdminMutation({
      request,
      reply,
      adminUserId: admin.id,
      action: 'user-subscription-update',
      target: id,
      body: payload,
      responseSchema: endpointContracts.adminUserSubscription.response,
      execute: async (client, actionId) => {
        const locked = await getAdminSubscriptionState(client, id, true);
        if (!locked) throw publicRouteError('用户不存在', 404, 'USER_NOT_FOUND');
        assertExpectedSubscriptionSnapshot(locked, payload.expected);

        const targetPlan = await getAssignablePlan(client, payload.planId);
        assertTargetSubscription(payload, targetPlan);
        await assertNoBlockingMainPlanOrder(client, id);

        // expected 校验针对管理员打开弹窗时看到的快照；校验通过后先在同一事务
        // 结清已到期的旧周期，再根据结清后的真实状态应用管理员目标。
        await reconcileSubscriptionWithClient(client, id);
        const current = await getAdminSubscriptionState(client, id, true);
        if (!current) throw publicRouteError('用户不存在', 404, 'USER_NOT_FOUND');

        const billingDate = getBillingDate();
        const nextBillingCycle = payload.billingCycle ?? 'monthly';
        const nextResetAt = payload.planId === null ? null : payload.planResetAt;
        const nextExpiresAt = payload.planId === null ? null : payload.planExpiresAt;
        const planIdChanged = current.plan_id !== payload.planId;
        const nextMainCredits = planIdChanged
          ? targetPlan ? toInt(targetPlan.credits) : 0
          : toInt(current.main_credits);
        const entitlementStateChanged = planIdChanged
          || current.billing_cycle !== nextBillingCycle
          || toIsoDate(current.plan_cycle_started_at) !== billingDate
          || toIsoDate(current.plan_reset_at) !== nextResetAt
          || toIsoDate(current.plan_expires_at) !== nextExpiresAt;
        const subscriptionStateChanged = entitlementStateChanged
          || current.active_subscription_order_id !== null;

        let ledgerRow: CreditLedgerRow | null = null;
        if (entitlementStateChanged) {
          await replaceSubscriptionMainLotWithClient(client, {
            userId: id,
            expectedAvailable: toInt(current.main_credits),
            nextAmount: nextMainCredits,
            cycleEventKey: `admin-subscription:${actionId}:main-lot`,
            nextExpiresAt: nextResetAt,
          });
          const synced = await setUserAvailableCreditsWithClient(client, id);
          if (
            synced.mainCredits !== nextMainCredits
            || synced.addonCredits !== toInt(current.addon_credits)
          ) {
            throw publicRouteError(
              '套餐调整后的积分批次与用户缓存不一致，操作已回滚',
              409,
              'FINANCIAL_MANUAL_REVIEW_REQUIRED',
            );
          }

          const delta = nextMainCredits - toInt(current.main_credits);
          if (delta !== 0) {
            const inserted = await client.query<CreditLedgerRow>(
              `INSERT INTO credit_ledger (
                 user_id, type, bucket, settlement_status, amount, balance,
                 source, operator, note, business_event_key
               )
               VALUES ($1, 'adjust', 'main', 'settled', $2, $3,
                       '后台套餐调整', $4, $5, $6)
               ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO UPDATE
               SET business_event_key = EXCLUDED.business_event_key
               RETURNING id, user_id, type, bucket, settlement_status, amount, balance,
                         source, operator, note, related_order_id, related_job_id,
                         related_asset_id, created_at`,
              [
                id,
                delta,
                synced.balance,
                admin.email,
                adminSubscriptionCreditAdjustmentNote(targetPlan?.name ?? null),
                `admin-subscription:${actionId}:main-ledger`,
              ],
            );
            ledgerRow = inserted.rows[0] ?? null;
          }
        }

        if (subscriptionStateChanged) {
          await client.query(
            `UPDATE users
             SET plan_id = $2,
                 billing_cycle = $3,
                 plan_cycle_started_at = $4::date,
                 plan_reset_at = $5::date,
                 plan_expires_at = $6::date,
                 active_subscription_order_id = NULL,
                 updated_at = now()
             WHERE id = $1`,
            [id, payload.planId, nextBillingCycle, billingDate, nextResetAt, nextExpiresAt],
          );
          if (planIdChanged) {
            await enqueuePortraitEntitlementReconcileWithClient(client, {
              userId: id,
              eventKey: `portrait-admin-subscription:${actionId}`,
              reason: 'admin-user-plan-switched',
              oldPlanId: current.plan_id,
              newPlanId: payload.planId,
            });
          }
          await appendAuditWithClient(
            client,
            admin.id,
            '用户管理',
            '调整用户套餐',
            id,
            'high',
            subscriptionAuditDetail({
              email: current.email,
              previousPlanName: current.plan_name,
              nextPlanName: targetPlan?.name ?? null,
              billingCycle: payload.billingCycle,
              cycleStartedAt: billingDate,
              resetAt: nextResetAt,
              expiresAt: nextExpiresAt,
              previousMainCredits: toInt(current.main_credits),
              nextMainCredits,
              reason: payload.note,
            }),
            request.ip,
          );
        }

        const updatedUser = await getAdminUserDto(client, id);
        if (!updatedUser) throw publicRouteError('用户不存在', 404, 'USER_NOT_FOUND');
        return {
          user: updatedUser,
          entry: ledgerRow
            ? mapAdminCreditLedgerRow({
              ...ledgerRow,
              user_name: updatedUser.userName,
              email: updatedUser.email,
            })
            : null,
        };
      },
    });
  });

  app.post('/api/admin/credits/adjust', async (request, reply) => {
    const admin = await requireAdmin(request);
    const payload = endpointContracts.adminCreditsAdjust.body.parse(request.body);
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'credit-adjust', target: payload.userId,
      body: payload,
      responseSchema: endpointContracts.adminCreditsAdjust.response,
      execute: async (client, actionId) => {
        const userResult = await client.query<{
          main_credits: number;
          addon_credits: number;
          total_credits: number;
          plan_reset_at: Date | string | null;
        }>(
          `SELECT main_credits, addon_credits, total_credits, plan_reset_at
           FROM users WHERE id = $1 FOR UPDATE`,
          [payload.userId],
        );
        const user = userResult.rows[0];
        if (!user) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });

        const nextMain = toInt(user.main_credits) + payload.mainDelta;
        const nextAddon = toInt(user.addon_credits) + payload.addonDelta;
        const nextTotal = nextMain + nextAddon;
        if (nextMain < 0 || nextAddon < 0 || nextTotal < 0) {
          throw Object.assign(new Error('调整后积分不能为负数'), { statusCode: 400 });
        }

        for (const adjustment of [
          { bucket: 'main', amount: payload.mainDelta, expiresAt: user.plan_reset_at },
          { bucket: 'addon', amount: payload.addonDelta, expiresAt: null },
        ] as const) {
          await adjustCreditLotsWithClient(client, {
            userId: payload.userId,
            bucket: adjustment.bucket,
            delta: adjustment.amount,
            eventKey: `admin-credit-adjust:${actionId}:${adjustment.bucket}`,
            expiresAt: adjustment.expiresAt,
          });
        }

        const synced = await setUserAvailableCreditsWithClient(client, payload.userId);
        if (
          synced.mainCredits !== nextMain
          || synced.addonCredits !== nextAddon
          || synced.balance !== nextTotal
        ) {
          throw Object.assign(new Error('积分批次与用户缓存不一致，调整已回滚'), {
            statusCode: 409,
            code: 'FINANCIAL_MANUAL_REVIEW_REQUIRED',
          });
        }
        const ledgerRows: CreditLedgerRow[] = [];
        let runningBalance = toInt(user.main_credits) + toInt(user.addon_credits);
        for (const adjustment of [
          { bucket: 'main', amount: payload.mainDelta },
          { bucket: 'addon', amount: payload.addonDelta },
        ] as const) {
          if (adjustment.amount === 0) continue;
          runningBalance += adjustment.amount;
          const ledger = await client.query<CreditLedgerRow>(
            `INSERT INTO credit_ledger (
               user_id, type, bucket, settlement_status, amount, balance,
               source, operator, note, business_event_key
             )
             VALUES ($1, 'adjust', $2, 'settled', $3, $4, '后台人工调整', $5, $6, $7)
             ON CONFLICT (business_event_key) WHERE business_event_key IS NOT NULL DO UPDATE
             SET business_event_key = EXCLUDED.business_event_key
             RETURNING id, user_id, type, bucket, settlement_status, amount, balance,
                       source, operator, note, related_order_id, related_job_id,
                       related_asset_id, created_at`,
            [
              payload.userId,
              adjustment.bucket,
              adjustment.amount,
              runningBalance,
              admin.email,
              adminCreditAdjustmentNote(adjustment.amount),
              `admin-credit-adjust:${actionId}:${adjustment.bucket}`,
            ],
          );
          ledgerRows.push(ledger.rows[0]!);
        }
        await appendAuditWithClient(
          client,
          admin.id,
          '积分流水',
          '调整积分',
          payload.userId,
          'high',
          payload.note,
          request.ip,
        );
        const updatedUser = await getAdminUserDto(client, payload.userId);
        if (!updatedUser) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
        const entries = ledgerRows.map(row => mapAdminCreditLedgerRow({
          ...row,
          user_name: updatedUser.userName,
          email: updatedUser.email,
        }));
        return { entry: entries.at(-1) ?? null, entries, user: updatedUser };
      },
    });
  });

  app.get('/api/admin/orders', async request => {
    const admin = await requireAdmin(request);
    const rawQuery = endpointContracts.adminOrders.query.parse(request.query);
    const filters = {
      search: rawQuery.search ?? '', status: rawQuery.status ?? null, userId: rawQuery.userId ?? null,
      from: rawQuery.from ?? null, to: rawQuery.to ?? null,
    };
    const resource = 'admin-orders';
    const pageRequest = parseAdminPageRequest({
      ...rawQuery,
      filters: adminExactPaginationFilters(admin.id, rawQuery.limit, filters),
      resource,
      defaultLimit: 20,
      maxLimit: 50,
    });
    return withReadOnlyRepeatableRead(async client => {
      const version = await readAdminPaginationVersion(client, resource);
      const pageFilters = {
        search: rawQuery.search,
        status: rawQuery.status,
        userId: rawQuery.userId,
        from: rawQuery.from,
        to: rawQuery.to,
      };
      const totalItems = pageRequest.snapshot
        ? undefined
        : await countAdminOrders(client, pageFilters);
      const query = materializeAdminPageQuery(pageRequest, {
        resourceVersion: version.version,
        snapshotAt: version.snapshotAt,
        totalItems,
      });
      return listAdminOrdersPage(client, { ...query, ...pageFilters });
    });
  });

  app.get('/api/admin/orders/summary', async request => {
    await requireAdmin(request);
    const query = endpointContracts.adminOrdersSummary.query.parse(request.query);
    const result = await pool.query<{
      total_count: unknown; total_amount: unknown; paid_count: unknown; paid_amount: unknown;
      pending_count: unknown; refunded_count: unknown; refunded_amount: unknown;
      failed_count: unknown; failed_amount: unknown;
    }>(
      `SELECT count(*) AS total_count,
              coalesce(sum(amount), 0) AS total_amount,
              count(*) FILTER (WHERE status = 'paid') AS paid_count,
              coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0) AS paid_amount,
              count(*) FILTER (WHERE status = 'pending') AS pending_count,
              count(*) FILTER (WHERE status = 'refunded') AS refunded_count,
              coalesce(sum(amount) FILTER (WHERE status = 'refunded'), 0) AS refunded_amount,
              count(*) FILTER (WHERE status = 'failed') AS failed_count,
              coalesce(sum(amount) FILTER (WHERE status = 'failed'), 0) AS failed_amount
       FROM orders
       WHERE ($1::date IS NULL OR created_at >= $1::date)
         AND ($2::date IS NULL OR created_at < $2::date + interval '1 day')`,
      [query.from ?? null, query.to ?? null],
    );
    const row = result.rows[0]!;
    return {
      totalCount: toInt(row.total_count), totalAmount: toInt(row.total_amount),
      paidCount: toInt(row.paid_count), paidAmount: toInt(row.paid_amount),
      pendingCount: toInt(row.pending_count), refundedCount: toInt(row.refunded_count),
      refundedAmount: toInt(row.refunded_amount), failedCount: toInt(row.failed_count), failedAmount: toInt(row.failed_amount),
    };
  });

  app.get('/api/admin/orders/:id', async request => {
    await requireAdmin(request);
    const { id } = endpointContracts.adminOrderDetail.params.parse(request.params);
    const order = await getOrderById(pool, id);
    if (!order) throw Object.assign(new Error('订单不存在'), { statusCode: 404 });
    const [invoiceResult, ledgerResult] = await Promise.all([
      pool.query(
        `SELECT ir.*, u.email, u.user_name, o.plan_name, o.amount
         FROM invoice_requests ir JOIN users u ON u.id = ir.user_id JOIN orders o ON o.id = ir.order_id
         WHERE ir.order_id = $1 ORDER BY ir.requested_at DESC, ir.id DESC LIMIT 1`, [id],
      ),
      pool.query<AdminCreditLedgerRow>(
        `SELECT cl.*, u.email, u.user_name FROM credit_ledger cl JOIN users u ON u.id = cl.user_id
         WHERE cl.related_order_id = $1 ORDER BY cl.created_at ASC, cl.id ASC`, [id],
      ),
    ]);
    return {
      order,
      invoice: invoiceResult.rows[0] ? mapInvoice(invoiceResult.rows[0] as never) : null,
      creditLedger: ledgerResult.rows.map(mapAdminCreditLedgerRow),
    };
  });

  app.post('/api/admin/orders/:id/refund', async (request, reply) => {
    const admin = await requireAdmin(request);
    const { id } = endpointContracts.adminOrderRefund.params.parse(request.params);
    return runAdminMutation({
      request,
      reply,
      adminUserId: admin.id,
      action: 'order-refund',
      target: id,
      body: {},
      responseSchema: endpointContracts.adminOrderRefund.response,
      execute: async client => ({
        order: await queueOrderRefundWithClient(client, id, admin.id, request.ip),
      }),
    });
  });

  app.post('/api/admin/orders/:id/refund/sync', async request => {
    await requireAdmin(request);
    const { id } = endpointContracts.adminOrderRefundSync.params.parse(request.params);
    const order = await syncOrderRefund(id);
    return { order };
  });

  app.get('/api/admin/invoices', async request => {
    const admin = await requireAdmin(request);
    const rawQuery = endpointContracts.adminInvoices.query.parse(request.query);
    const filters = {
      search: rawQuery.search ?? '', status: rawQuery.status ?? null,
      userId: rawQuery.userId ?? null, orderId: rawQuery.orderId ?? null,
    };
    const resource = 'admin-invoices';
    const pageRequest = parseAdminPageRequest({
      ...rawQuery,
      filters: adminExactPaginationFilters(admin.id, rawQuery.limit, filters),
      resource,
      defaultLimit: 20,
      maxLimit: 50,
    });
    return withReadOnlyRepeatableRead(async client => {
      const version = await readAdminPaginationVersion(client, resource);
      const totalItems = pageRequest.snapshot
        ? undefined
        : (await client.query<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM invoice_requests ir
             JOIN users u ON u.id = ir.user_id
             JOIN orders o ON o.id = ir.order_id
             WHERE ($1::text IS NULL OR ir.status = $1)
               AND ($2::uuid IS NULL OR ir.user_id = $2)
               AND ($3::uuid IS NULL OR ir.order_id = $3)
               AND ($4::text IS NULL OR (
                 ir.id::text ILIKE '%' || $4 || '%'
                 OR ir.order_id::text ILIKE '%' || $4 || '%'
                 OR ir.invoice_title ILIKE '%' || $4 || '%'
                 OR ir.tax_id ILIKE '%' || $4 || '%'
                 OR u.user_name ILIKE '%' || $4 || '%'
                 OR u.email::text ILIKE '%' || $4 || '%'
               ))`,
            [
              rawQuery.status ?? null,
              rawQuery.userId ?? null,
              rawQuery.orderId ?? null,
              rawQuery.search || null,
            ],
          )).rows[0]?.count;
      const query = materializeAdminPageQuery(pageRequest, {
        resourceVersion: version.version,
        snapshotAt: version.snapshotAt,
        totalItems,
      });
      const result = await client.query(
      `SELECT ir.*, u.email, u.user_name, o.plan_name, o.amount,
              ${adminPageMetadataColumns('ir.requested_at')}
       FROM invoice_requests ir
       JOIN users u ON u.id = ir.user_id
       JOIN orders o ON o.id = ir.order_id
       WHERE ${adminCursorCondition(query, 'ir.requested_at', 'ir.id')}
         AND ($3::text IS NULL OR ir.status = $3)
         AND ($4::uuid IS NULL OR ir.user_id = $4)
         AND ($5::uuid IS NULL OR ir.order_id = $5)
         AND ($6::text IS NULL OR (
           ir.id::text ILIKE '%' || $6 || '%'
           OR ir.order_id::text ILIKE '%' || $6 || '%'
           OR ir.invoice_title ILIKE '%' || $6 || '%'
           OR ir.tax_id ILIKE '%' || $6 || '%'
           OR u.user_name ILIKE '%' || $6 || '%'
           OR u.email::text ILIKE '%' || $6 || '%'
         ))
       ORDER BY ${adminPageOrderBy(query, 'ir.requested_at', 'ir.id')}
       LIMIT $7`,
      [
        ...adminCursorValues(query), rawQuery.status ?? null, rawQuery.userId ?? null,
        rawQuery.orderId ?? null, rawQuery.search || null, query.limit + 1,
      ],
    );
      return createAdminPage({
        rows: result.rows,
        query,
        getId: row => row.id,
        map: mapInvoice,
      });
    });
  });

  app.get('/api/admin/tickets', async request => {
    const admin = await requireAdmin(request);
    const rawQuery = endpointContracts.adminTickets.query.parse(request.query);
    const filters = { search: rawQuery.search ?? '', status: rawQuery.status ?? null, priority: rawQuery.priority ?? null };
    const resource = 'admin-tickets';
    const pageRequest = parseAdminPageRequest({
      ...rawQuery,
      filters: adminExactPaginationFilters(admin.id, rawQuery.limit, filters),
      resource,
      defaultLimit: 20,
      maxLimit: 50,
    });
    return withReadOnlyRepeatableRead(async client => {
      const version = await readAdminPaginationVersion(client, resource);
      const pageFilters = {
        search: rawQuery.search,
        status: rawQuery.status,
        priority: rawQuery.priority,
      };
      const totalItems = pageRequest.snapshot
        ? undefined
        : await countAdminTickets(client, pageFilters);
      const query = materializeAdminPageQuery(pageRequest, {
        resourceVersion: version.version,
        snapshotAt: version.snapshotAt,
        totalItems,
      });
      return listAdminTicketsPage(client, { ...query, ...pageFilters });
    });
  });

  app.get('/api/admin/tickets/:id/messages', async request => {
    await requireAdmin(request);
    const { id } = endpointContracts.adminTicketMessages.params.parse(request.params);
    const ticket = await getAdminTicket(pool, id);
    if (!ticket) throw Object.assign(new Error('工单不存在'), { statusCode: 404 });

    return { items: await listTicketMessages(pool, id) };
  });

  app.post('/api/admin/tickets/:id/messages', async (request, reply) => {
    const admin = await requireAdmin(request);
    const { id } = endpointContracts.adminTicketMessageCreate.params.parse(request.params);
    const payload = endpointContracts.adminTicketMessageCreate.body.parse(request.body);
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'ticket-message-create', target: id, body: payload,
      responseSchema: endpointContracts.adminTicketMessageCreate.response,
      execute: async client => {
        const ticket = await client.query(
          `SELECT id, status, assignee FROM tickets WHERE id = $1 FOR UPDATE`, [id],
        );
        if (!ticket.rowCount) throw Object.assign(new Error('工单不存在'), { statusCode: 404 });
        if (ticket.rows[0].status === 'resolved') throw Object.assign(new Error('工单已关闭，不能继续回复'), { statusCode: 409 });
        const message = await client.query(
          `INSERT INTO ticket_messages (ticket_id, author_role, author_user_id, body)
           VALUES ($1, 'admin', $2, $3) RETURNING *`,
          [id, admin.id, payload.message],
        );
        await client.query(
          `UPDATE tickets SET status = 'pending',
             assignee = CASE WHEN assignee = 'unassigned' THEN $3 ELSE assignee END,
             last_message = $2, admin_read_at = now(), updated_at = now()
           WHERE id = $1`,
          [id, payload.message, admin.email],
        );
        const ticketSummary = await getAdminTicket(client, id);
        await appendAuditWithClient(
          client, admin.id, '工单管理', '回复工单', id, 'medium', `回复工单 ${id}`, request.ip,
        );
        return {
          message: mapTicketMessage({ ...message.rows[0], author_email: admin.email, author_name: admin.email }),
          ticket: ticketSummary,
        };
      },
    });
  });

  app.post('/api/admin/tickets/:id/read', async request => {
    await requireAdmin(request);
    const { id } = endpointContracts.adminTicketRead.params.parse(request.params);
    const result = await pool.query(
      `UPDATE tickets
       SET admin_read_at = now()
       WHERE id = $1
       RETURNING id`,
      [id],
    );
    if (!result.rowCount) throw Object.assign(new Error('工单不存在'), { statusCode: 404 });

    return { ticket: await getAdminTicket(pool, id) };
  });

  app.patch('/api/admin/tickets/:id/status', async (request, reply) => {
    const admin = await requireAdmin(request);
    const { id } = endpointContracts.adminTicketStatus.params.parse(request.params);
    const payload = endpointContracts.adminTicketStatus.body.parse(request.body);
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'ticket-status-update', target: id, body: payload,
      responseSchema: endpointContracts.adminTicketStatus.response,
      execute: async client => {
        const current = await client.query<{ status: string }>('SELECT status FROM tickets WHERE id = $1 FOR UPDATE', [id]);
        if (!current.rowCount) throw Object.assign(new Error('工单不存在'), { statusCode: 404 });
        if (current.rows[0]!.status !== payload.status) {
          await client.query('UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1', [id, payload.status]);
          await appendAuditWithClient(
            client, admin.id, '工单管理', '修改工单状态', id, 'medium',
            `工单状态改为 ${payload.status}`, request.ip,
          );
        }
        return { ticket: await getAdminTicket(client, id) };
      },
    });
  });

  app.patch('/api/admin/invoices/:id/status', async (request, reply) => {
    const admin = await requireAdmin(request);
    const { id } = endpointContracts.adminInvoiceStatus.params.parse(request.params);
    const payload = endpointContracts.adminInvoiceStatus.body.parse(request.body);
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'invoice-status-update', target: id, body: payload,
      responseSchema: endpointContracts.adminInvoiceStatus.response,
      execute: async client => {
        const current = await client.query<{ order_id: string; status: 'unissued' | 'issued' }>(
          'SELECT order_id, status FROM invoice_requests WHERE id = $1 FOR UPDATE', [id],
        );
        if (!current.rowCount) throw Object.assign(new Error('发票申请不存在'), { statusCode: 404 });
        if (current.rows[0]!.status !== payload.status) {
          await client.query(
            `UPDATE invoice_requests
             SET status = $2,
                 issued_at = CASE WHEN $2 = 'issued' THEN COALESCE(issued_at, now()) ELSE issued_at END
             WHERE id = $1`,
            [id, payload.status],
          );
          await client.query('UPDATE orders SET invoice_status = $2 WHERE id = $1', [current.rows[0]!.order_id, payload.status]);
          await appendAuditWithClient(
            client, admin.id, '发票管理', '修改发票状态', id, 'medium',
            payload.status === 'issued' ? '确认发票已人工开具并发送' : '恢复为未开票', request.ip,
          );
        }
        const invoice = await getInvoiceById(client, id);
        if (!invoice) throw Object.assign(new Error('发票申请不存在'), { statusCode: 404 });
        return { invoice };
      },
    });
  });

  app.get('/api/admin/assets/:id', async request => {
    await requireAdmin(request);
    const { id } = endpointContracts.adminAsset.params.parse(request.params);
    const result = await pool.query(
      `SELECT *
       FROM assets
       WHERE id = $1 AND deletion_status = 'active'
       LIMIT 1`,
      [id],
    );
    if (!result.rowCount) throw Object.assign(new Error('素材不存在'), { statusCode: 404 });

    return { asset: await mapAssetDetailRow(result.rows[0]) };
  });

  app.post('/api/admin/assets/:id/download', async request => {
    await requireAdmin(request);
    const { id } = endpointContracts.adminAssetDownload.params.parse(request.params);
    const download = await prepareAdminAssetDownload(id);
    return { download };
  });

  app.get('/api/admin/jobs', async request => {
    const admin = await requireAdmin(request);
    const rawQuery = endpointContracts.adminJobs.query.parse(request.query);
    const filters = { search: rawQuery.search ?? '', status: rawQuery.status ?? null, userId: rawQuery.userId ?? null };
    const resource = 'admin-jobs';
    const pageRequest = parseAdminPageRequest({
      ...rawQuery,
      filters: adminExactPaginationFilters(admin.id, rawQuery.limit, filters),
      resource,
      defaultLimit: 20,
      maxLimit: 50,
    });
    return withReadOnlyRepeatableRead(async client => {
      const version = await readAdminPaginationVersion(client, resource);
      const totalItems = pageRequest.snapshot
        ? undefined
        : (await client.query<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM generation_tasks gt
             JOIN users u ON u.id = gt.user_id
             WHERE ($1::text IS NULL OR gt.status = $1)
               AND ($2::uuid IS NULL OR gt.user_id = $2)
               AND ($3::text IS NULL OR (
                 gt.id::text ILIKE '%' || $3 || '%'
                 OR u.user_name ILIKE '%' || $3 || '%'
                 OR u.email::text ILIKE '%' || $3 || '%'
                 OR gt.model ILIKE '%' || $3 || '%'
                 OR gt.prompt ILIKE '%' || $3 || '%'
               ))`,
            [rawQuery.status ?? null, rawQuery.userId ?? null, rawQuery.search || null],
          )).rows[0]?.count;
      const query = materializeAdminPageQuery(pageRequest, {
        resourceVersion: version.version,
        snapshotAt: version.snapshotAt,
        totalItems,
      });
      const result = await client.query<AdminJobCardRow & ExactPageMetadata>(
      `WITH paged_jobs AS MATERIALIZED (
         SELECT gt.id, gt.user_id, gt.kind, gt.model, gt.status, gt.processing_stage, gt.failure_category,
                gt.credit_status, gt.asset_id, gt.retry_count, gt.active_provider_run_id,
                gt.created_at, u.email, u.user_name,
                ${adminPageMetadataColumns('gt.created_at')}
         FROM generation_tasks gt
         JOIN users u ON u.id = gt.user_id
         WHERE ${adminCursorCondition(query, 'gt.created_at', 'gt.id')}
           AND ($3::text IS NULL OR gt.status = $3)
           AND ($4::uuid IS NULL OR gt.user_id = $4)
           AND ($5::text IS NULL OR (
             gt.id::text ILIKE '%' || $5 || '%'
             OR u.user_name ILIKE '%' || $5 || '%'
             OR u.email::text ILIKE '%' || $5 || '%'
             OR gt.model ILIKE '%' || $5 || '%'
             OR gt.prompt ILIKE '%' || $5 || '%'
           ))
         ORDER BY ${adminPageOrderBy(query, 'gt.created_at', 'gt.id')}
         LIMIT $6
       )
       SELECT gt.id, gt.user_id, gt.kind, gt.model, gt.status, gt.processing_stage, gt.failure_category,
              gt.credit_status, gt.asset_id, gt.retry_count, gt.active_provider_run_id,
              gt.created_at, gt.email, gt.user_name,
              gt.__pagination_cursor_timestamp,
              a.name AS asset_name, a.source AS asset_source, gpr.status AS provider_run_status
       FROM paged_jobs gt
       LEFT JOIN assets a ON a.id = gt.asset_id
       LEFT JOIN generation_provider_runs gpr ON gpr.id = gt.active_provider_run_id
       ORDER BY ${adminPageOrderBy(query, 'gt.created_at', 'gt.id')}`,
      [...adminCursorValues(query), rawQuery.status ?? null, rawQuery.userId ?? null, rawQuery.search || null, query.limit + 1],
    );
      return createAdminPage({
        rows: result.rows,
        query,
        getId: row => row.id,
        map: mapAdminJobCard,
      });
    });
  });

  app.get('/api/admin/jobs/:id', async request => {
    await requireAdmin(request);
    const { id } = endpointContracts.adminJobDetail.params.parse(request.params);
    const task = await getAdminGenerationJobDto(pool, id);
    if (!task) throw Object.assign(new Error('任务不存在'), { statusCode: 404 });
    return { task };
  });

  app.post('/api/admin/jobs/:id/retry', async (request, reply) => {
    const admin = await requireAdmin(request);
    const { id } = endpointContracts.adminJobRetry.params.parse(request.params);
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'generation-job-retry', target: id, body: {},
      responseSchema: endpointContracts.adminJobRetry.response,
      execute: async client => {
        await retryGenerationTaskWithClient(client, id, admin.id);
        const task = await getAdminGenerationJobDto(client, id);
        if (!task) throw Object.assign(new Error('任务不存在'), { statusCode: 404 });
        return { task };
      },
      onFirstSuccess: async response => {
        const task = isRecord(response.task) ? response.task : null;
        if (
          !task
          || typeof task.id !== 'string'
          || typeof task.attempt !== 'number'
          || typeof task.claimEpoch !== 'number'
        ) return;
        try {
          await enqueueGenerationTask(task.id, task.attempt, task.claimEpoch);
        } catch (error) {
          console.error('任务重试已写入数据库，但暂未进入 Redis 队列。', error);
        }
      },
    });
  });

  app.post('/api/admin/jobs/:id/refund', async (request, reply) => {
    const admin = await requireAdmin(request);
    const { id } = endpointContracts.adminJobRefund.params.parse(request.params);
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'generation-job-refund', target: id, body: {},
      responseSchema: endpointContracts.adminJobRefund.response,
      execute: async client => {
        const task = await failTaskWithRefundWithClient(client, id, {
          ok: false,
          category: 'provider-failed',
          reason: '后台管理员核验后人工退回预扣积分；该操作不代表供应商未计费',
        }, undefined, {
          adminUserId: admin.id,
          ip: request.ip,
          detail: `为任务 ${id} 人工退回积分；管理员须另行核验供应商账单，该操作不代表上游未计费。`,
        });
        if (!task) throw Object.assign(new Error('任务不存在'), { statusCode: 404 });
        const fullTask = await getAdminGenerationJobDto(client, id);
        if (!fullTask) throw Object.assign(new Error('任务不存在'), { statusCode: 404 });
        return { task: fullTask };
      },
    });
  });

  app.get('/api/admin/credit-ledger', async request => {
    const admin = await requireAdmin(request);
    const rawQuery = endpointContracts.adminCreditLedger.query.parse(request.query);
    const filters = {
      search: rawQuery.search ?? '', type: rawQuery.type ?? null, userId: rawQuery.userId ?? null,
      relatedOrderId: rawQuery.relatedOrderId ?? null, relatedJobId: rawQuery.relatedJobId ?? null,
    };
    const resource = 'admin-credit-ledger';
    const pageRequest = parseAdminPageRequest({
      ...rawQuery,
      filters: adminExactPaginationFilters(admin.id, rawQuery.limit, filters),
      resource,
      defaultLimit: 20,
      maxLimit: 50,
    });
    return withReadOnlyRepeatableRead(async client => {
      const version = await readAdminPaginationVersion(client, resource);
      const totalItems = pageRequest.snapshot
        ? undefined
        : (await client.query<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM credit_ledger cl
             JOIN users u ON u.id = cl.user_id
             WHERE ($1::text IS NULL OR cl.type = $1)
               AND ($2::uuid IS NULL OR cl.user_id = $2)
               AND ($3::uuid IS NULL OR cl.related_order_id = $3)
               AND ($4::uuid IS NULL OR cl.related_job_id = $4)
               AND ($5::text IS NULL OR (
                 u.user_name ILIKE '%' || $5 || '%'
                 OR u.email::text ILIKE '%' || $5 || '%'
                 OR cl.source ILIKE '%' || $5 || '%'
                 OR cl.note ILIKE '%' || $5 || '%'
                 OR cl.related_order_id::text ILIKE '%' || $5 || '%'
                 OR cl.related_job_id::text ILIKE '%' || $5 || '%'
                 OR cl.related_asset_id::text ILIKE '%' || $5 || '%'
               ))`,
            [
              rawQuery.type ?? null,
              rawQuery.userId ?? null,
              rawQuery.relatedOrderId ?? null,
              rawQuery.relatedJobId ?? null,
              rawQuery.search || null,
            ],
          )).rows[0]?.count;
      const query = materializeAdminPageQuery(pageRequest, {
        resourceVersion: version.version,
        snapshotAt: version.snapshotAt,
        totalItems,
      });
      const result = await client.query<AdminCreditLedgerRow & ExactPageMetadata>(
      `SELECT cl.*, u.email, u.user_name,
              ${adminPageMetadataColumns('cl.created_at')}
       FROM credit_ledger cl
       JOIN users u ON u.id = cl.user_id
       WHERE ${adminCursorCondition(query, 'cl.created_at', 'cl.id')}
         AND ($3::text IS NULL OR cl.type = $3)
         AND ($4::uuid IS NULL OR cl.user_id = $4)
         AND ($5::uuid IS NULL OR cl.related_order_id = $5)
         AND ($6::uuid IS NULL OR cl.related_job_id = $6)
         AND ($7::text IS NULL OR (
           u.user_name ILIKE '%' || $7 || '%'
           OR u.email::text ILIKE '%' || $7 || '%'
           OR cl.source ILIKE '%' || $7 || '%'
           OR cl.note ILIKE '%' || $7 || '%'
           OR cl.related_order_id::text ILIKE '%' || $7 || '%'
           OR cl.related_job_id::text ILIKE '%' || $7 || '%'
           OR cl.related_asset_id::text ILIKE '%' || $7 || '%'
         ))
       ORDER BY ${adminPageOrderBy(query, 'cl.created_at', 'cl.id')}
       LIMIT $8`,
      [
        ...adminCursorValues(query), rawQuery.type ?? null, rawQuery.userId ?? null,
        rawQuery.relatedOrderId ?? null, rawQuery.relatedJobId ?? null, rawQuery.search || null, query.limit + 1,
      ],
    );
      return createAdminPage({
        rows: result.rows,
        query,
        getId: row => row.id,
        map: mapAdminCreditLedgerRow,
      });
    });
  });

  app.get('/api/admin/audit-logs', async request => {
    const admin = await requireAdmin(request);
    const rawQuery = endpointContracts.adminAuditLogs.query.parse(request.query);
    const filters = { search: rawQuery.search ?? '', risk: rawQuery.risk ?? null, module: rawQuery.module ?? '' };
    const resource = 'admin-audit-logs';
    const pageRequest = parseAdminPageRequest({
      ...rawQuery,
      filters: adminExactPaginationFilters(admin.id, rawQuery.limit, filters),
      resource,
      defaultLimit: 20,
      maxLimit: 50,
    });
    return withReadOnlyRepeatableRead(async client => {
      const version = await readAdminPaginationVersion(client, resource);
      const totalItems = pageRequest.snapshot
        ? undefined
        : (await client.query<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM audit_logs
             WHERE ($1::text IS NULL OR risk = $1)
               AND ($2::text IS NULL OR module = $2)
               AND ($3::text IS NULL OR (
                 admin_email::text ILIKE '%' || $3 || '%'
                 OR module ILIKE '%' || $3 || '%'
                 OR action ILIKE '%' || $3 || '%'
                 OR target ILIKE '%' || $3 || '%'
                 OR detail ILIKE '%' || $3 || '%'
               ))`,
            [rawQuery.risk ?? null, rawQuery.module || null, rawQuery.search || null],
          )).rows[0]?.count;
      const query = materializeAdminPageQuery(pageRequest, {
        resourceVersion: version.version,
        snapshotAt: version.snapshotAt,
        totalItems,
      });
      const result = await client.query(
      `SELECT audit_logs.*,
              ${adminPageMetadataColumns('created_at')}
       FROM audit_logs
       WHERE ${adminCursorCondition(query, 'created_at', 'id')}
         AND ($3::text IS NULL OR risk = $3)
         AND ($4::text IS NULL OR module = $4)
         AND ($5::text IS NULL OR (
           admin_email::text ILIKE '%' || $5 || '%'
           OR module ILIKE '%' || $5 || '%'
           OR action ILIKE '%' || $5 || '%'
           OR target ILIKE '%' || $5 || '%'
           OR detail ILIKE '%' || $5 || '%'
         ))
       ORDER BY ${adminPageOrderBy(query, 'created_at', 'id')}
       LIMIT $6`,
      [...adminCursorValues(query), rawQuery.risk ?? null, rawQuery.module || null, rawQuery.search || null, query.limit + 1],
    );
      return createAdminPage({
        rows: result.rows,
        query,
        getId: row => row.id,
        map: mapAuditLog,
      });
    });
  });

  app.get('/api/admin/feature-flags', async request => {
    await requireAdmin(request);
    return { flags: await readFeatureFlags(pool) };
  });

  app.patch('/api/admin/feature-flags', async (request, reply) => {
    const admin = await requireAdmin(request);
    const payload = endpointContracts.adminFeatureFlagsUpdate.body.parse(request.body);
    if (Object.keys(payload).length === 0) throw publicRouteError('请至少提交一个功能开关', 400, 'EMPTY_PATCH');
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'feature-flags-update', target: 'feature_flags', body: payload,
      responseSchema: endpointContracts.adminFeatureFlagsUpdate.response,
      execute: async client => {
        const current = await readFeatureFlags(client);
        const changed = Object.entries(payload).filter(([key, enabled]) => (
          enabled !== undefined && current[key as keyof typeof current] !== enabled
        ));
        for (const [key, enabled] of changed) {
          await client.query(
            `INSERT INTO feature_flags (key, enabled)
             VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
            [key, enabled],
          );
        }
        if (changed.length > 0) {
          await appendAuditWithClient(
            client, admin.id, '功能开关', '修改功能开关', 'feature_flags', 'medium',
            '修改用户端功能开关', request.ip,
          );
        }
        return { flags: await readFeatureFlags(client) };
      },
    });
  });

  app.get('/api/admin/api-usage', async request => {
    await requireAdmin(request);
    const query = endpointContracts.adminApiUsage.query.parse(request.query);
    return runCostReport(request, 10_000, client => getAdminApiCostDashboard(client, query));
  });

  app.get('/api/admin/api-usage/overview', async request => {
    await requireAdmin(request);
    const query = endpointContracts.adminApiUsageOverview.query.parse(request.query);
    return runCostReport(request, 5_000, client => getAdminApiCostOverview(client, query));
  });

  app.get('/api/admin/api-usage/tasks', async request => {
    const admin = await requireAdmin(request);
    const query = endpointContracts.adminApiUsageTasks.query.parse(request.query);
    return runCostReport(request, 5_000, client => listAdminApiCostTasks(client, query, `admin:${admin.id}:role:admin`));
  });

  app.get('/api/admin/api-usage/attempts', async request => {
    const admin = await requireAdmin(request);
    const query = endpointContracts.adminApiUsageAttempts.query.parse(request.query);
    return runCostReport(request, 10_000, client => listAdminApiCostAttempts(client, query, `admin:${admin.id}:role:admin`));
  });

  app.get('/api/admin/api-usage/users', async request => {
    const admin = await requireAdmin(request);
    const query = endpointContracts.adminApiUsageUsers.query.parse(request.query);
    return runCostReport(request, 5_000, client => listAdminApiCostUsers(client, query, `admin:${admin.id}:role:admin`));
  });

  app.get('/api/admin/api-usage/image/overview', async request => {
    await requireAdmin(request);
    const query = endpointContracts.adminApiUsageImageOverview.query.parse(request.query);
    return runCostReport(request, 5_000, client => getAdminImageCostOverview(client, query));
  });

  app.get('/api/admin/api-usage/image/users', async request => {
    const admin = await requireAdmin(request);
    const query = endpointContracts.adminApiUsageImageUsers.query.parse(request.query);
    return runCostReport(request, 5_000, client => listAdminImageCostUsers(client, query, `admin:${admin.id}:role:admin`));
  });

  app.get('/api/admin/api-usage/image/tasks', async request => {
    const admin = await requireAdmin(request);
    const query = endpointContracts.adminApiUsageImageTasks.query.parse(request.query);
    return runCostReport(request, 5_000, client => listAdminImageCostTasks(client, query, `admin:${admin.id}:role:admin`));
  });

  app.get('/api/admin/api-usage/multimodal/overview', async request => {
    await requireAdmin(request);
    const query = endpointContracts.adminApiUsageMultimodalOverview.query.parse(request.query);
    return runCostReport(request, 5_000, client => getAdminMultimodalCostOverview(client, query));
  });

  app.get('/api/admin/api-usage/multimodal/users', async request => {
    const admin = await requireAdmin(request);
    const query = endpointContracts.adminApiUsageMultimodalUsers.query.parse(request.query);
    return runCostReport(request, 5_000, client => listAdminMultimodalCostUsers(client, query, `admin:${admin.id}:role:admin`));
  });

  app.get('/api/admin/api-usage/multimodal/operations', async request => {
    const admin = await requireAdmin(request);
    const query = endpointContracts.adminApiUsageMultimodalOperations.query.parse(request.query);
    return runCostReport(request, 5_000, client => listAdminMultimodalCostOperations(client, query, `admin:${admin.id}:role:admin`));
  });

  app.get('/api/admin/api-usage/reconciliation', async request => {
    const admin = await requireAdmin(request);
    const query = endpointContracts.adminApiUsageReconciliation.query.parse(request.query);
    return runCostReport(request, 10_000, client => listAdminApiCostReconciliation(client, query, `admin:${admin.id}:role:admin`));
  });

  app.get('/api/admin/api-usage/reconciliation/:id', async request => {
    await requireAdmin(request);
    const { id } = endpointContracts.adminApiUsageReconciliationDetail.params.parse(request.params);
    const query = endpointContracts.adminApiUsageReconciliationDetail.query.parse(request.query);
    return runCostReport(request, 10_000, client => getAdminApiCostReconciliationDetail(client, id, query));
  });

  app.get('/api/admin/api-usage/settlement', async request => {
    const admin = await requireAdmin(request);
    const query = endpointContracts.adminApiUsageSettlement.query.parse(request.query);
    return runCostReport(request, 10_000, client => listAdminApiCostSettlement(client, query, `admin:${admin.id}:role:admin`));
  });

  app.post('/api/admin/provider-billing/sync', async (request, reply) => {
    const admin = await requireAdmin(request);
    const payload = endpointContracts.adminProviderBillingSync.body.parse(request.body ?? {});
    await requestVolcengineBillingSync({
      scope: payload.scope,
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd,
      requestedBy: admin.id,
    });
    return reply.code(202).send({
      accepted: true,
      scope: payload.scope,
      ...(payload.windowStart && payload.windowEnd
        ? { windowStart: payload.windowStart, windowEnd: payload.windowEnd }
        : {}),
    });
  });

  app.patch('/api/admin/consumption-settings/video-models/:model/availability', async (request, reply) => {
    const admin = await requireAdmin(request);
    const { model } = endpointContracts.adminVideoConsumptionAvailabilityUpdate.params.parse(request.params);
    const { videoDuration25 } = endpointContracts.adminVideoConsumptionAvailabilityUpdate.query.parse(request.query);
    const payload = endpointContracts.adminVideoConsumptionAvailabilityUpdate.body.parse(request.body);
    return runAdminMutation({
      request,
      reply,
      adminUserId: admin.id,
      action: 'video-consumption-model-availability-update',
      target: model,
      body: payload,
      responseSchema: endpointContracts.adminVideoConsumptionAvailabilityUpdate.response,
      execute: async client => {
        const result = await setVideoModelConsumptionAvailabilityWithClient(client, model, payload.available);
        if (result.changed) {
          await appendAuditWithClient(
            client,
            admin.id,
            '积分消耗',
            payload.available ? '全量开放视频模型' : '全量暂停视频模型',
            model,
            'high',
            `${model} 开放状态：${result.previousAvailableCount}/${result.settings.length} 个组合开放 → ${payload.available ? `${result.settings.length}/${result.settings.length} 全部开放` : `0/${result.settings.length} 全部暂停`}；普通与含参考视频积分未修改。`,
            request.ip,
          );
        }
        return {
          items: model === 'Seedance 2.5' && videoDuration25 !== '1'
            ? result.settings.filter(setting => setting.durationSeconds !== 25)
            : result.settings,
        };
      },
    });
  });

  app.get('/api/admin/provider-billing/overview', async request => {
    await requireAdmin(request);
    const query = endpointContracts.adminProviderBillingOverview.query.parse(request.query);
    return runCostReport(request, 10_000, client => getAdminProviderBillingOverview(client, query));
  });

  app.get('/api/admin/provider-billing/details', async request => {
    const admin = await requireAdmin(request);
    const query = endpointContracts.adminProviderBillingDetails.query.parse(request.query);
    return runCostReport(request, 10_000, client => listAdminProviderBillingDetails(client, query, `admin:${admin.id}:role:admin`));
  });

  app.get('/api/admin/provider-billing/operational-usage', async request => {
    const admin = await requireAdmin(request);
    const query = endpointContracts.adminProviderBillingOperationalUsage.query.parse(request.query);
    return runCostReport(request, 10_000, client => listAdminProviderOperationalUsage(client, query, `admin:${admin.id}:role:admin`));
  });

  app.patch('/api/admin/consumption-settings/:id', async (request, reply) => {
    const admin = await requireAdmin(request);
    const { id } = endpointContracts.adminConsumptionSettingUpdate.params.parse(request.params);
    const payload = endpointContracts.adminConsumptionSettingUpdate.body.parse(request.body);
    if (Object.keys(payload).length === 0) throw publicRouteError('请至少提交一个积分配置字段', 400, 'EMPTY_PATCH');
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'consumption-setting-update', target: id, body: payload,
      responseSchema: endpointContracts.adminConsumptionSettingUpdate.response,
      execute: async client => {
        const current = await client.query('SELECT * FROM consumption_settings WHERE id = $1 FOR UPDATE', [id]);
        if (!current.rowCount) throw Object.assign(new Error('积分消耗配置不存在'), { statusCode: 404 });
        const row = current.rows[0];
        if (row.kind === 'video' && row.model === 'Seedance 2.5' && payload.available !== undefined) {
          throw publicRouteError(
            `Seedance 2.5 必须使用模型级开关一次性切换全部 ${SEEDANCE_25_CONSUMPTION_COMBINATIONS.length} 个组合`,
            409,
            'SEEDANCE_25_AVAILABILITY_REQUIRES_MODEL_UPDATE',
          );
        }
        const nextCredits = payload.credits ?? toInt(row.credits);
        if (row.kind === 'image' && payload.referenceVideoCredits !== undefined) {
          throw Object.assign(new Error('图片积分配置不支持参考视频档'), { statusCode: 400 });
        }
        const nextReferenceVideoCredits = row.kind === 'video'
          ? payload.referenceVideoCredits ?? toInt(row.reference_video_credits)
          : null;
        const nextAvailable = payload.available ?? Boolean(row.available);
        if (
          row.kind === 'video'
          && row.model === 'Seedance 2.5'
          && nextAvailable
          && (
            !Number.isSafeInteger(nextCredits)
            || nextCredits <= 0
            || !Number.isSafeInteger(nextReferenceVideoCredits)
            || (nextReferenceVideoCredits ?? 0) <= 0
          )
        ) {
          throw publicRouteError(
            '已开放的 Seedance 2.5 组合必须保留正整数的普通与含参考视频积分；如需停用请使用模型级开关',
            409,
            'SEEDANCE_25_AVAILABLE_PRICE_INVALID',
          );
        }
        if (
          nextCredits === toInt(row.credits)
          && nextReferenceVideoCredits === (row.kind === 'video' ? toInt(row.reference_video_credits) : null)
          && nextAvailable === Boolean(row.available)
        ) {
          return { setting: mapConsumptionSetting(row) };
        }
        const result = await client.query(
          `UPDATE consumption_settings
           SET credits = $2, reference_video_credits = $3, available = $4, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [id, nextCredits, nextReferenceVideoCredits, nextAvailable],
        );
        const pricingDetail = row.kind === 'video'
          ? `无参考视频 ${toInt(row.credits)} → ${nextCredits}；含参考视频 ${toInt(row.reference_video_credits)} → ${nextReferenceVideoCredits}；开放状态 ${Boolean(row.available) ? '开放' : '关闭'} → ${nextAvailable ? '开放' : '关闭'}`
          : `${String(row.resolution || '未分档')} 图片消耗 ${toInt(row.credits)} → ${nextCredits}；开放状态 ${Boolean(row.available) ? '开放' : '关闭'} → ${nextAvailable ? '开放' : '关闭'}`;
        await appendAuditWithClient(
          client, admin.id, '积分消耗', '修改积分消耗', id,
          row.model === 'Seedance 2.5' ? 'high' : 'medium',
          `修改 ${row.model_label} 积分配置：${pricingDetail}`, request.ip,
        );
        return { setting: mapConsumptionSetting(result.rows[0]) };
      },
    });
  });

  app.patch('/api/admin/prompt-wizard-settings', async (request, reply) => {
    const admin = await requireAdmin(request);
    const payload = endpointContracts.adminPromptWizardSettingsUpdate.body.parse(request.body);
    return runAdminMutation({
      request,
      reply,
      adminUserId: admin.id,
      action: 'prompt-wizard-settings-update',
      target: 'prompt-wizard',
      body: payload,
      responseSchema: endpointContracts.adminPromptWizardSettingsUpdate.response,
      execute: async client => {
        if (payload.available !== undefined) {
          await lockPromptEngineCutoverSettings(client);
        }
        const before = await readPromptWizardSettings(client);
        if (payload.available === true) {
          if (await readTkPromptEngineV6WritesRetired(client)) {
            throw publicRouteError(
              'TK Prompt Engine 1.0 已切流，旧 V6 写入口不得重新开启。',
              409,
              'PROMPT_WIZARD_WRITE_RETIRED',
            );
          }
        }
        const promptWizard = await updatePromptWizardSettingsWithClient({
          client,
          adminUserId: admin.id,
          ...(payload.generationCredits !== undefined
            ? { generationCredits: payload.generationCredits }
            : {}),
          ...(payload.available !== undefined ? { available: payload.available } : {}),
        });
        const updatesCredits = payload.generationCredits !== undefined;
        const updatesAvailability = payload.available !== undefined;
        const updatedFieldCount = Number(updatesCredits) + Number(updatesAvailability);
        const auditModule = updatedFieldCount > 1
          ? '提示词向导设置'
          : updatesAvailability
            ? '功能开关'
            : '积分消耗';
        const auditAction = updatedFieldCount > 1
          ? '修改提示词向导设置'
          : updatesAvailability
            ? '修改提示词向导开关'
            : '修改提示词向导积分';
        const auditDetail = [
          ...(updatesCredits
            ? [`方案生成积分 ${before.generationCredits} → ${promptWizard.generationCredits}`]
            : []),
          ...(updatesAvailability ? [`功能状态 ${before.available ? '开启' : '关闭'} → ${promptWizard.available ? '开启' : '关闭'}`] : []),
        ].join('；');
        await appendAuditWithClient(
          client,
          admin.id,
          auditModule,
          auditAction,
          'prompt-wizard',
          'medium',
          auditDetail,
          request.ip,
        );
        return { promptWizard };
      },
    });
  });

  app.patch('/api/admin/tk-prompt-engine-settings', async (request, reply) => {
    const admin = await requireAdmin(request);
    const payload = endpointContracts.adminTkPromptEngineSettingsUpdate.body.parse(request.body);
    if (payload.available === true) {
      throw publicRouteError(
        'TK Prompt Engine 1.0 首次开放必须通过后端、付费 Canary 与双站静态验收后的受审计终结器',
        409,
        'TK_PROMPT_ENABLE_REQUIRES_FINALIZER',
      );
    }
    return runAdminMutation({
      request,
      reply,
      adminUserId: admin.id,
      action: 'tk-prompt-engine-settings-update',
      target: 'tk-prompt-engine',
      body: payload,
      responseSchema: endpointContracts.adminTkPromptEngineSettingsUpdate.response,
      execute: async client => {
        if (payload.available !== undefined) {
          await lockPromptEngineCutoverSettings(client);
        }
        const before = await readTkPromptEngineSettings(client);
        const settings = await updateTkPromptEngineSettingsWithClient({
          client,
          updatedBy: admin.id,
          ...(payload.generationCredits !== undefined
            ? { generationCredits: payload.generationCredits }
            : {}),
          ...(payload.available !== undefined ? { available: payload.available } : {}),
        });
        const updatesCredits = payload.generationCredits !== undefined;
        const updatesAvailability = payload.available !== undefined;
        const updatedFieldCount = Number(updatesCredits) + Number(updatesAvailability);
        const auditModule = updatedFieldCount > 1
          ? 'TK提示词引擎设置'
          : updatesAvailability
            ? '功能开关'
            : '积分消耗';
        const auditAction = updatedFieldCount > 1
          ? '修改TK提示词引擎设置'
          : updatesAvailability
            ? '修改TK提示词引擎开关'
            : '修改TK提示词引擎积分';
        const auditDetail = [
          ...(updatesCredits
            ? [`整批生成积分 ${before.generationCredits} → ${settings.generationCredits}`]
            : []),
          ...(updatesAvailability
            ? [`功能状态 ${before.available ? '开启' : '关闭'} → ${settings.available ? '开启' : '关闭'}`]
            : []),
        ].join('；');
        await appendAuditWithClient(
          client,
          admin.id,
          auditModule,
          auditAction,
          'tk-prompt-engine',
          'medium',
          auditDetail,
          request.ip,
        );
        return { settings };
      },
    });
  });

  app.get('/api/admin/announcements', async request => {
    const admin = await requireAdmin(request);
    const rawQuery = endpointContracts.adminAnnouncements.query.parse(request.query);
    const filters = { search: rawQuery.search ?? '' };
    const resource = 'admin-announcements-v1-published-desc';
    const pageRequest = parseAdminPageRequest({
      ...rawQuery,
      filters: adminExactPaginationFilters(admin.id, rawQuery.limit, filters),
      resource,
      defaultLimit: 20,
      maxLimit: 50,
    });
    return withReadOnlyRepeatableRead(async client => {
      const version = await readAdminPaginationVersion(client, resource);
      const totalItems = pageRequest.snapshot
        ? undefined
        : (await client.query<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM announcements
             WHERE ($1::text IS NULL OR title ILIKE '%' || $1 || '%' OR content ILIKE '%' || $1 || '%')`,
            [rawQuery.search || null],
          )).rows[0]?.count;
      const query = materializeAdminPageQuery(pageRequest, {
        resourceVersion: version.version,
        snapshotAt: version.snapshotAt,
        totalItems,
      });
      const result = await client.query<AnnouncementRow & ExactPageMetadata>(
      `SELECT announcements.*,
              ${adminPageMetadataColumns('published_at')}
       FROM announcements
       WHERE ${adminCursorCondition(query, 'published_at', 'id')}
         AND ($3::text IS NULL OR title ILIKE '%' || $3 || '%' OR content ILIKE '%' || $3 || '%')
       ORDER BY ${adminPageOrderBy(query, 'published_at', 'id')}
       LIMIT $4`,
      [...adminCursorValues(query), rawQuery.search || null, query.limit + 1],
    );
      return createAdminPage({
        rows: result.rows,
        query,
        getId: row => row.id,
        map: mapAnnouncement,
      });
    });
  });

  app.post('/api/admin/announcements', async (request, reply) => {
    const admin = await requireAdmin(request);
    const payload = endpointContracts.adminAnnouncementCreate.body.parse(request.body);
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'announcement-create', target: 'collection', body: payload,
      responseSchema: endpointContracts.adminAnnouncementCreate.response,
      execute: async client => {
        if (payload.pinned) await assertPinnedAnnouncementLimit(client);
        const result = await client.query(
          `INSERT INTO announcements (title, content, pinned) VALUES ($1, $2, $3) RETURNING *`,
          [payload.title, payload.content, payload.pinned],
        );
        await appendAuditWithClient(
          client, admin.id, '平台公告', '发布公告', result.rows[0].id, 'medium', payload.title, request.ip,
        );
        return { announcement: mapAnnouncement(result.rows[0]) };
      },
    });
  });

  app.patch('/api/admin/announcements/:id', async (request, reply) => {
    const admin = await requireAdmin(request);
    const { id } = endpointContracts.adminAnnouncementUpdate.params.parse(request.params);
    const payload = endpointContracts.adminAnnouncementUpdate.body.parse(request.body);
    if (Object.keys(payload).length === 0) throw publicRouteError('请至少提交一个公告字段', 400, 'EMPTY_PATCH');
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'announcement-update', target: id, body: payload,
      responseSchema: endpointContracts.adminAnnouncementUpdate.response,
      execute: async client => {
        const current = await client.query('SELECT * FROM announcements WHERE id = $1 FOR UPDATE', [id]);
        if (!current.rowCount) throw Object.assign(new Error('公告不存在'), { statusCode: 404 });
        const row = current.rows[0];
        const nextTitle = payload.title ?? row.title;
        const nextContent = payload.content ?? row.content;
        const nextPinned = payload.pinned ?? Boolean(row.pinned);
        if (nextTitle === row.title && nextContent === row.content && nextPinned === Boolean(row.pinned)) {
          return { announcement: mapAnnouncement(row) };
        }
        if (nextPinned && !row.pinned) await assertPinnedAnnouncementLimit(client);
        const result = await client.query(
          `UPDATE announcements SET title = $2, content = $3, pinned = $4, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [id, nextTitle, nextContent, nextPinned],
        );
        await appendAuditWithClient(
          client, admin.id, '平台公告', '修改公告', id, 'low', result.rows[0].title, request.ip,
        );
        return { announcement: mapAnnouncement(result.rows[0]) };
      },
    });
  });

  app.delete('/api/admin/announcements/:id', async (request, reply) => {
    const admin = await requireAdmin(request);
    const { id } = endpointContracts.adminAnnouncementDelete.params.parse(request.params);
    return runAdminMutation({
      request, reply, adminUserId: admin.id, action: 'announcement-delete', target: id, body: {},
      responseSchema: endpointContracts.adminAnnouncementDelete.response,
      execute: async client => {
        const result = await client.query('DELETE FROM announcements WHERE id = $1 RETURNING title', [id]);
        if (!result.rowCount) throw Object.assign(new Error('公告不存在'), { statusCode: 404 });
        await appendAuditWithClient(
          client, admin.id, '平台公告', '删除公告', id, 'medium',
          `删除公告 ${result.rows[0].title}`, request.ip,
        );
        return { ok: true };
      },
    });
  });
}

function mapAdminRevenueTrend(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.day !== 'string') return [];
    return [{
      day: item.day,
      revenue: toInt(item.revenue),
      orders: toInt(item.orders),
    }];
  });
}

function mapAdminModelUsage(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.model !== 'string') return [];
    return [{
      model: item.model,
      billableTokens: toInt(item.billableTokens),
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function publicRouteError(message: string, statusCode: number, code: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

/**
 * 新旧提示词引擎共享同一把切流锁，并始终按旧设置 → 新设置的顺序锁行。
 * 这样两个管理端点即使由不同管理员并发提交，也不可能观察到彼此提交前的开关快照。
 */
async function lockPromptEngineCutoverSettings(client: DbClient) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    ['prompt-engine-v1-cutover'],
  );
  await client.query(
    `SELECT singleton_id FROM prompt_wizard_settings
     WHERE singleton_id = 1
     FOR UPDATE`,
  );
  await client.query(
    `SELECT singleton_id FROM tk_prompt_engine_settings
     WHERE singleton_id = 1
     FOR UPDATE`,
  );
}

async function runAdminMutation<T extends Record<string, unknown>>(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  adminUserId: string;
  action: string;
  target: string;
  body: unknown;
  responseSchema: z.ZodType<T>;
  successStatus?: number;
  execute: (client: DbClient, actionId: string) => Promise<unknown>;
  onFirstSuccess?: (response: T) => Promise<void>;
}) {
  const idempotencyKey = resolveAdminIdempotencyKey({
    headerKey: input.request.headers['idempotency-key'],
  });
  const result = await runAdminIdempotentAction({
    adminUserId: input.adminUserId,
    action: input.action,
    target: input.target,
    idempotencyKey,
    body: input.body,
    responseSchema: input.responseSchema,
    successStatus: input.successStatus,
    execute: input.execute,
  });
  if (!result.reused && input.onFirstSuccess) await input.onFirstSuccess(result.response);
  if (result.reused) input.reply.header('Idempotency-Replayed', 'true');
  return input.reply.code(result.statusCode).send(result.response);
}

async function appendAuditWithClient(
  client: DbClient,
  adminUserId: string,
  moduleName: string,
  action: string,
  target: string,
  risk: 'low' | 'medium' | 'high',
  detail: string,
  ip?: string,
) {
  await client.query(
    `INSERT INTO audit_logs (admin_user_id, admin_email, module, action, target, risk, ip, detail)
     SELECT $1, email, $2, $3, $4, $5, $6, $7
     FROM users WHERE id = $1`,
    [adminUserId, moduleName, action, target, risk, ip ?? null, detail],
  );
}

async function clearPlanRecommendation(
  client: DbClient,
  recommendation: 'popular' | 'enterprise',
  exceptId?: string,
) {
  await client.query(
    `UPDATE plans
     SET recommendation = NULL, updated_at = now()
     WHERE recommendation = $1 AND ($2::uuid IS NULL OR id <> $2)`,
    [recommendation, exceptId ?? null],
  );
}

async function assertPinnedAnnouncementLimit(client: DbClient) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('announcements:pinned'))");
  const result = await client.query<{ count: string }>('SELECT count(*) FROM announcements WHERE pinned = true');
  if (Number(result.rows[0]?.count ?? 0) >= 3) {
    throw Object.assign(new Error('最多只能置顶 3 条公告'), { statusCode: 400 });
  }
}

async function getAdminUserDto(client: DbClient, userId: string) {
  const result = await client.query<AdminUserRow>(
    `SELECT u.*, p.code AS plan_code, p.name AS plan_name,
            (SELECT count(*)::int FROM orders o WHERE o.user_id = u.id) AS order_count,
            (SELECT count(*)::int FROM tickets t WHERE t.user_id = u.id) AS ticket_count,
            (
              SELECT count(pur.id)::int
              FROM provider_usage_records pur
              LEFT JOIN generation_tasks gt ON gt.id = pur.task_id
              WHERE coalesce(gt.user_id, pur.initiated_by_admin_user_id) = u.id
            ) AS api_calls
     FROM users u
     LEFT JOIN plans p ON p.id = u.plan_id
     WHERE u.id = $1
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] ? mapAdminUser(result.rows[0]) : null;
}

async function getAdminSubscriptionState(
  client: DbClient,
  userId: string,
  lock: boolean,
) {
  const result = await client.query<AdminSubscriptionStateRow>(
    `SELECT u.id, u.email, u.plan_id, u.billing_cycle,
            u.plan_cycle_started_at, u.plan_reset_at, u.plan_expires_at,
            u.active_subscription_order_id, u.main_credits, u.addon_credits,
            p.code AS plan_code, p.name AS plan_name
     FROM users u
     LEFT JOIN plans p ON p.id = u.plan_id
     WHERE u.id = $1
     ${lock ? 'FOR UPDATE OF u' : ''}`,
    [userId],
  );
  return result.rows[0] ?? null;
}

function assertExpectedSubscriptionSnapshot(
  current: AdminSubscriptionStateRow,
  expected: AdminUserSubscriptionPayload['expected'],
) {
  const matches = current.plan_id === expected.planId
    && current.billing_cycle === expected.billingCycle
    && toIsoDate(current.plan_cycle_started_at) === expected.planCycleStartedAt
    && toIsoDate(current.plan_reset_at) === expected.planResetAt
    && toIsoDate(current.plan_expires_at) === expected.planExpiresAt
    && current.active_subscription_order_id === expected.activeSubscriptionOrderId
    && toInt(current.main_credits) === expected.mainCredits;
  if (!matches) {
    throw publicRouteError(
      '用户套餐或主积分已发生变化，请刷新后重新提交',
      409,
      'ADMIN_USER_SUBSCRIPTION_STALE',
    );
  }
}

async function getAssignablePlan(client: DbClient, planId: string | null) {
  if (planId === null) return null;
  const result = await client.query<AssignablePlanRow>(
    `SELECT id, code, name, kind, billing, status, credits
     FROM plans
     WHERE id = $1
     FOR SHARE`,
    [planId],
  );
  const plan = result.rows[0];
  if (!plan) throw publicRouteError('套餐不存在', 404, 'PLAN_NOT_FOUND');
  if (plan.code.toLowerCase() === 'free') {
    throw publicRouteError('免费版必须使用无套餐关联状态', 400, 'FREE_PLAN_REQUIRES_NULL_ID');
  }
  if (plan.kind !== 'main' || plan.status !== 'active') {
    throw publicRouteError('只能为用户分配已上架的主套餐', 409, 'ADMIN_PLAN_NOT_ASSIGNABLE');
  }
  return plan;
}

function assertTargetSubscription(
  payload: AdminUserSubscriptionPayload,
  plan: AssignablePlanRow | null,
) {
  if (payload.planId === null) {
    if (payload.expectedPlanCredits !== 0) {
      throw publicRouteError('免费版标准积分已发生变化，请刷新后重试', 409, 'ADMIN_PLAN_CREDITS_STALE');
    }
    return;
  }
  if (!plan || payload.billingCycle === null || payload.planResetAt === null || payload.planExpiresAt === null) {
    throw publicRouteError('付费套餐周期信息不完整', 400, 'SUBSCRIPTION_DATES_REQUIRED');
  }
  if (toInt(plan.credits) !== payload.expectedPlanCredits) {
    throw publicRouteError('套餐标准积分已发生变化，请刷新后重新提交', 409, 'ADMIN_PLAN_CREDITS_STALE');
  }
  if (
    plan.billing === 'one-time'
    || (plan.billing !== 'both' && plan.billing !== payload.billingCycle)
  ) {
    throw publicRouteError('所选套餐不支持该计费周期', 400, 'PLAN_BILLING_CYCLE_NOT_SUPPORTED');
  }
  const billingDate = getBillingDate();
  if (payload.planResetAt <= billingDate || payload.planExpiresAt <= billingDate) {
    throw publicRouteError('积分重置日期和套餐到期日期必须晚于今天', 400, 'SUBSCRIPTION_DATES_NOT_FUTURE');
  }
}

async function assertNoBlockingMainPlanOrder(client: DbClient, userId: string) {
  const result = await client.query<{
    id: string;
    status: string;
    refund_status: string;
  }>(
    `SELECT item.id, item.status, item.refund_status
     FROM orders item
     WHERE item.user_id = $1
       AND item.kind = 'main'
       AND (
         item.status = 'pending'
         OR item.refund_status = 'pending'
         OR EXISTS (
           SELECT 1 FROM payment_attempts attempt
           WHERE attempt.order_id = item.id
             AND attempt.status IN ('queued', 'processing', 'ready', 'uncertain', 'manual-review')
         )
         OR EXISTS (
           SELECT 1 FROM order_refund_attempts attempt
           WHERE attempt.order_id = item.id
             AND attempt.status IN ('queued', 'processing', 'submitted', 'uncertain', 'manual-review')
         )
       )
     ORDER BY item.created_at DESC
     LIMIT 1`,
    [userId],
  );
  if (result.rowCount) {
    throw publicRouteError(
      '存在未结束或待人工核对的主套餐支付/退款，暂不能调整套餐',
      409,
      'SUBSCRIPTION_CHANGE_BLOCKED_BY_ORDER_STATE',
    );
  }
}

function subscriptionAuditDetail(input: {
  email: string;
  previousPlanName: string | null;
  nextPlanName: string | null;
  billingCycle: 'monthly' | 'yearly' | null;
  cycleStartedAt: string;
  resetAt: string | null;
  expiresAt: string | null;
  previousMainCredits: number;
  nextMainCredits: number;
  reason: string;
}) {
  return [
    `用户 ${input.email}`,
    `套餐 ${input.previousPlanName ?? '免费版'} → ${input.nextPlanName ?? '免费版'}`,
    `计费周期 ${input.billingCycle ?? '-'}`,
    `周期起点 ${input.cycleStartedAt}`,
    `重置日期 ${input.resetAt ?? '-'}`,
    `到期日期 ${input.expiresAt ?? '-'}`,
    `主积分 ${input.previousMainCredits} → ${input.nextMainCredits}`,
    `内部原因：${input.reason}`,
  ].join('；');
}

async function getAdminGenerationJobDto(client: DbClient, taskId: string) {
  const result = await client.query<AdminJobRow>(
    `SELECT gt.*, u.email, u.user_name, a.name AS asset_name, a.source AS asset_source,
            gpr.status AS provider_run_status,
            ARRAY(
              SELECT cl.id FROM credit_ledger cl
              WHERE cl.related_job_id = gt.id
              ORDER BY cl.created_at ASC, cl.id ASC
            ) AS ledger_ids
     FROM generation_tasks gt
     JOIN users u ON u.id = gt.user_id
     LEFT JOIN assets a ON a.id = gt.asset_id
     LEFT JOIN generation_provider_runs gpr ON gpr.id = gt.active_provider_run_id
     WHERE gt.id = $1
     LIMIT 1`,
    [taskId],
  );
  return result.rows[0] ? mapAdminJob(result.rows[0]) : null;
}

function mapPlan(row: PlanRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameEn: row.name_en,
    kind: row.kind,
    billing: row.billing,
    description: row.description,
    monthlyPrice: toInt(row.monthly_price),
    yearlyPrice: toInt(row.yearly_price),
    credits: toInt(row.credits),
    assetRetentionDays: toInt(row.asset_retention_days),
    portraitEntitlements: {
      enabled: Boolean(row.portrait_enabled),
      profileLimit: row.portrait_profile_limit === null ? null : toInt(row.portrait_profile_limit),
      activeLimit: toInt(row.portrait_active_limit),
      assetsPerActor: toInt(row.portrait_assets_per_actor),
    },
    storage: row.storage_label,
    tiktokAccounts: row.tiktok_accounts,
    recommendation: row.recommendation,
    iconKey: row.icon_key,
    ctaLabel: row.cta_label,
    status: row.status,
    landingVisible: Boolean(row.landing_visible),
    subscribers: toInt(row.subscribers),
    revenue: toInt(row.revenue),
    features: row.features ?? [],
    createdAt: toIsoDateTime(row.created_at),
    updatedAt: toIsoDateTime(row.updated_at),
  };
}

interface PortraitEntitlementsInput {
  enabled: boolean;
  profileLimit: number | null;
  activeLimit: number;
  assetsPerActor: number;
}

function disabledPortraitEntitlements(): PortraitEntitlementValues {
  return {
    portraitEnabled: false,
    portraitProfileLimit: 0,
    portraitActiveLimit: 0,
    portraitAssetsPerActor: 0,
  };
}

function isDisabledPortraitEntitlements(input: PortraitEntitlementsInput) {
  return input.enabled === false
    && input.profileLimit === 0
    && input.activeLimit === 0
    && input.assetsPerActor === 0;
}

function requestedPortraitEntitlements(
  kind: PortraitPlanKind,
  input: PortraitEntitlementsInput | undefined,
  options: { requireExplicitMain?: boolean } = {},
): PortraitEntitlementValues {
  if (kind === 'addon') return disabledPortraitEntitlements();
  if (!input) {
    if (options.requireExplicitMain) {
      throw publicRouteError(
        '主套餐必须明确设置真人人像素材库权益',
        400,
        'PORTRAIT_ENTITLEMENTS_REQUIRED',
      );
    }
    return disabledPortraitEntitlements();
  }
  const values: PortraitEntitlementValues = {
    portraitEnabled: input.enabled,
    portraitProfileLimit: input.profileLimit,
    portraitActiveLimit: input.activeLimit,
    portraitAssetsPerActor: input.assetsPerActor,
  };
  assertPortraitEntitlements(kind, values);
  return values;
}

function planPortraitEntitlements(row: PlanRow): PortraitEntitlementValues {
  const values: PortraitEntitlementValues = {
    portraitEnabled: Boolean(row.portrait_enabled),
    portraitProfileLimit: row.portrait_profile_limit === null
      ? null
      : toInt(row.portrait_profile_limit),
    portraitActiveLimit: toInt(row.portrait_active_limit),
    portraitAssetsPerActor: toInt(row.portrait_assets_per_actor),
  };
  assertPortraitEntitlements(row.kind, values);
  return values;
}

function mapAdminUser(row: AdminUserRow) {
  return {
    id: row.id,
    email: row.email,
    userName: row.user_name,
    role: row.role,
    status: row.status,
    planId: row.plan_id,
    planCode: row.plan_code,
    planName: row.plan_name,
    billingCycle: row.billing_cycle,
    mainCredits: toInt(row.main_credits),
    addonCredits: toInt(row.addon_credits),
    credits: toInt(row.main_credits) + toInt(row.addon_credits),
    totalCredits: toInt(row.total_credits),
    orderCount: toInt(row.order_count),
    ticketCount: toInt(row.ticket_count),
    apiCalls: toInt(row.api_calls),
    planCycleStartedAt: toIsoDate(row.plan_cycle_started_at),
    planResetAt: toIsoDate(row.plan_reset_at),
    planExpiresAt: toIsoDate(row.plan_expires_at),
    activeSubscriptionOrderId: row.active_subscription_order_id,
    registeredAt: toIsoDateTime(row.registered_at),
    lastActiveAt: toIsoDateTime(row.last_active_at),
  };
}

function mapAdminJob(row: AdminJobRow) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    email: row.email,
    kind: row.kind,
    model: row.model,
    status: row.status,
    attempt: toInt(row.attempt),
    processingStage: row.processing_stage,
    cancelState: row.cancel_state ?? 'none',
    claimEpoch: toInt(row.claim_epoch),
    providerRunId: row.active_provider_run_id,
    providerRunStatus: row.provider_run_status ?? null,
    providerTaskId: row.provider_task_id,
    failureCategory: row.failure_category,
    failureReason: row.failure_reason,
    settlementError: row.settlement_error,
    prompt: row.prompt,
    config: mapSafeGenerationTaskConfig(row.config),
    credits: toInt(row.credits),
    reservedCredits: toInt(row.reserved_credits),
    settledCredits: toInt(row.settled_credits),
    refundedCredits: toInt(row.refunded_credits),
    mainCreditsUsed: toInt(row.main_credits_used),
    addonCreditsUsed: toInt(row.addon_credits_used),
    creditStatus: row.credit_status,
    assetId: row.asset_id,
    assetName: row.asset_name,
    assetSource: row.asset_source,
    retryCount: toInt(row.retry_count),
    ledgerIds: Array.isArray(row.ledger_ids) ? row.ledger_ids : [],
    createdAt: toIsoDateTime(row.created_at),
    startedAt: toIsoDateTime(row.started_at),
    heartbeatAt: toIsoDateTime(row.heartbeat_at),
    leaseExpiresAt: toIsoDateTime(row.lease_expires_at),
    completedAt: toIsoDateTime(row.completed_at),
  };
}

function mapAdminJobCard(row: AdminJobCardRow) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    email: row.email,
    kind: row.kind,
    model: row.model,
    status: row.status,
    processingStage: row.processing_stage,
    failureCategory: row.failure_category,
    creditStatus: row.credit_status,
    assetId: row.asset_id,
    assetName: row.asset_name,
    assetSource: row.asset_source,
    retryCount: toInt(row.retry_count),
    providerRunId: row.active_provider_run_id,
    providerRunStatus: row.provider_run_status,
    createdAt: toIsoDateTime(row.created_at),
  };
}

function mapAuditLog(row: AuditLogRow) {
  return {
    id: row.id,
    adminUserId: row.admin_user_id,
    adminEmail: row.admin_email,
    module: row.module,
    action: row.action,
    target: row.target,
    risk: row.risk,
    ip: row.ip,
    detail: row.detail,
    createdAt: toIsoDateTime(row.created_at),
  };
}

function mapAnnouncement(row: AnnouncementRow) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    pinned: Boolean(row.pinned),
    publishedAt: toIsoDateTime(row.published_at),
    createdAt: toIsoDateTime(row.created_at),
    updatedAt: toIsoDateTime(row.updated_at),
  };
}

function adminExactPaginationFilters(
  adminId: string,
  requestedLimit: number | undefined,
  filters: Record<string, unknown>,
) {
  return {
    adminId,
    pageLimit: requestedLimit ?? 20,
    ...filters,
  };
}

function normalizeCostSyncStatus(value: unknown) {
  return value === 'normal' || value === 'error' ? value : 'warning';
}

function normalizeCostMatchState(value: unknown) {
  if (value === 'raw-matched' || value === 'adjusted-matched' || value === 'residual') return value;
  return 'cannot-reconcile' as const;
}

function formatAdminCny(value: unknown) {
  const text = String(value ?? 0);
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  return `${negative ? '-' : ''}${whole}.${fraction.padEnd(6, '0').slice(0, 6)}`;
}
