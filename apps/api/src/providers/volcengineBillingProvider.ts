import { createHash, createHmac } from 'node:crypto';
import { env } from '../config/env.js';
import { pool, withTransaction, type DbClient } from '../db/pool.js';
import { SEEDANCE_COST_MODEL_LABELS } from '../domain/seedanceModels.js';
import { listSeedancePricingRules, type SeedancePricingResolution } from '../domain/seedancePricing.js';

const PROVIDER = 'volcengine-ark';
const BILLING_PRODUCT = 'ark_bd';
const BILL_PAGE_LIMIT = 300;
const MAX_BILL_PAGES = 10_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const BILL_NORMALIZATION_VERSION = 'volcengine-billing-v3';

export type VolcengineBillingSyncKind = 'balance' | 'bill' | 'packages';
export type VolcengineBillingSyncScope = 'all' | VolcengineBillingSyncKind;

export interface NormalizedResourcePackage {
  packageId: string;
  provider: string;
  product: string;
  config: string;
  recognizedModel: string;
  status: string;
  totalQuota: number;
  remainingQuota: number;
  startsAt: string | null;
  expiresAt: string | null;
  payloadHash: string;
  rawPayload: Record<string, unknown>;
}

export interface NormalizedVolcengineBalance {
  provider: typeof PROVIDER;
  accountId: string | null;
  availableBalanceCny: string;
  cashBalanceCny: string;
  frozenAmountCny: string;
  arrearsBalanceCny: string;
  creditLimitCny: string;
  currency: 'CNY';
  requestId: string | null;
}

export interface NormalizedVolcengineBillDetail {
  provider: typeof PROVIDER;
  sourceDetailKey: string;
  payerId: string | null;
  billPeriod: string;
  expenseDate: string;
  product: string;
  productZh: string | null;
  billingMode: string | null;
  billCategory: string | null;
  instanceNo: string | null;
  configName: string | null;
  elementCode: string | null;
  configurationCode: string | null;
  factorCode: string | null;
  project: string | null;
  tag: unknown | null;
  price: string | null;
  priceUnit: string | null;
  usageCount: string | null;
  usageUnit: string | null;
  deductionCount: string | null;
  originalBillAmountCny: string | null;
  preferentialBillAmountCny: string | null;
  discountBillAmountCny: string | null;
  couponAmountCny: string | null;
  payableAmountCny: string | null;
  paidAmountCny: string | null;
  unpaidAmountCny: string | null;
  roundAmountCny: string | null;
  currency: string;
  settlementType: string | null;
  recognizedModel: string | null;
  seedanceCandidate: boolean;
  pricingResolution: '480p/720p' | SeedancePricingResolution | null;
  pricingInputHasVideo: boolean | null;
  billableTokens: string | null;
  listEquivalentCostCny: string | null;
  billLineType: 'usage' | 'package-purchase' | 'refund' | 'adjustment' | 'other';
  normalizedUnitPricePerMillion: string | null;
  normalizationVersion: typeof BILL_NORMALIZATION_VERSION;
  rawPayload: Record<string, unknown>;
}

interface ReconciliationBucketRow {
  expense_date: Date | string | null;
  product: string;
  recognized_model: string | null;
  pricing_resolution_band: string;
  pricing_input_class: string;
  unit_price_per_million: string | null;
  currency: string;
  raw_local_tokens: string;
  raw_local_cost_cny: string;
  inferred_adjustment_tokens: string;
  inferred_adjustment_cost_cny: string;
  official_tokens: string;
  official_cost_cny: string;
  zero_cost_candidate_count?: string;
}

interface ZeroCostReviewRunRow {
  id: string;
  bill_period: string;
  window_start: Date | string;
  window_end: Date | string;
  bill_state: 'unavailable' | 'provisional' | 'final' | 'reopened';
  coverage_state: 'complete' | 'partial' | 'stale';
  official_snapshot_hash: string;
  official_sync_is_final: boolean;
}

interface ZeroCostCaseLinkRow {
  case_id: string;
  case_key: string;
  case_status: 'open' | 'approved' | 'superseded';
  evidence: unknown;
  link_id: string | null;
  usage_record_id: string | null;
  completion_tokens: string | null;
  total_tokens: string | null;
  billable_tokens: string | null;
  estimated_cost: string | null;
  usage_evidence_origin: string | null;
}

interface ZeroCostBucketReviewRow {
  bucket_count: string;
  residual_tokens: string;
  residual_cost_cny: string;
  all_comparable: boolean;
}

export interface ZeroCostCaseReviewResult {
  reviewed: number;
  approved: number;
  reopened: number;
  superseded: number;
  metadataUpdated: number;
}

export interface VolcengineBillingSyncResult {
  ok: boolean;
  skipped: boolean;
  kind: VolcengineBillingSyncKind;
  pages: number;
  rows: number;
  reason?: string;
  error?: string;
  retryable?: boolean;
}

interface SyncOptions {
  force?: boolean;
  requestedBy?: string;
}

interface SyncWorkResult {
  pages: number;
  rows: number;
  requestId?: string | null;
}

interface PreparedSyncWork extends SyncWorkResult {
  persist: (client: DbClient, runId: string) => Promise<void>;
}

interface BillWindow {
  billPeriod: string;
  expenseDate?: string;
  windowStart: string;
  windowEnd: string;
  isFinal: boolean;
}

interface OpenApiOptions {
  method?: 'GET' | 'POST';
  maxRetries?: number;
  retryBaseDelayMs?: number;
  timeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

let lastPackageSyncAt = 0;
let activePackageSync: Promise<VolcengineBillingSyncResult> | null = null;
let lastBillRequestAt = 0;

export async function maybeSyncVolcengineBillingPackages() {
  if (!hasBillingCredentials()) {
    return { ok: false, skipped: true, reason: '火山费用中心 AK/SK 未配置' };
  }
  if (Date.now() - lastPackageSyncAt < env.VOLC_BILLING_SYNC_TTL_MS) {
    return { ok: true, skipped: true, reason: '同步缓存仍有效', packageCount: 0 };
  }
  if (activePackageSync) {
    const result = await activePackageSync;
    return {
      ok: result.ok,
      skipped: true,
      reason: '复用进行中的同步',
      packageCount: result.rows,
    };
  }

  activePackageSync = syncVolcengineBillingPackages();
  try {
    const result = await activePackageSync;
    if (result.ok) lastPackageSyncAt = Date.now();
    return {
      ok: result.ok,
      skipped: result.skipped,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.error ? { reason: result.error } : {}),
      packageCount: result.rows,
    };
  } finally {
    activePackageSync = null;
  }
}

export async function syncVolcengineBillingPackages(options: SyncOptions = {}): Promise<VolcengineBillingSyncResult> {
  return executeBillingSync({
    kind: 'packages',
    windowStart: null,
    windowEnd: null,
    isFinal: false,
    minIntervalMs: env.VOLC_BILLING_SYNC_TTL_MS,
    force: options.force,
    prepare: async () => {
      const { items, pages, requestId } = await fetchAllResourcePackages();
      const packages: NormalizedResourcePackage[] = [];
      const seenPackageIds = new Set<string>();
      for (const [index, item] of items.entries()) {
        if (!isSeedanceResourcePackageRaw(item)) continue;
        const normalized = mapVolcengineResourcePackage(item);
        if (!normalized) throw new Error(`资源包第 ${index + 1} 行缺少必需字段`);
        if (seenPackageIds.has(normalized.packageId)) {
          throw new Error(`资源包响应包含重复 packageId：${normalized.packageId}`);
        }
        seenPackageIds.add(normalized.packageId);
        packages.push(normalized);
      }
      return {
        pages,
        rows: packages.length,
        requestId,
        persist: async (client: DbClient, runId: string) => {
          const missingPackages = await client.query<{
            package_id: string;
            product: string;
            config: string;
            recognized_model: string;
            status: string;
            total_quota: number;
            remaining_quota: number;
            starts_at: Date | string | null;
            expires_at: Date | string | null;
          }>(
            `SELECT
               package_id, product, config, recognized_model, status,
               total_quota, remaining_quota, starts_at, expires_at
             FROM provider_resource_packages
             WHERE provider = $1
               AND (
                 (
                   status <> 'Stale'
                   AND status !~* '(expired|inactive|invalid|已过期|失效|到期)'
                 )
                 OR (
                   status = 'Stale'
                   AND expires_at IS NOT NULL
                   AND expires_at <= now()
                 )
               )
               AND NOT (package_id = ANY($2::text[]))`,
            [PROVIDER, packages.map(item => item.packageId)],
          );
          await client.query(
            `UPDATE provider_resource_packages
             SET status = CASE
                   WHEN expires_at IS NOT NULL AND expires_at <= now() THEN 'Expired'
                   ELSE 'Stale'
                 END,
                 updated_at = now()
             WHERE provider = $1`,
            [PROVIDER],
          );
          for (const item of packages) {
            await client.query(
              `INSERT INTO provider_resource_packages (
                 package_id, provider, product, config, recognized_model, status,
                 total_quota, remaining_quota, starts_at, expires_at
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (package_id) DO UPDATE
               SET provider = EXCLUDED.provider,
                   product = EXCLUDED.product,
                   config = EXCLUDED.config,
                   recognized_model = EXCLUDED.recognized_model,
                   status = EXCLUDED.status,
                   total_quota = EXCLUDED.total_quota,
                   remaining_quota = EXCLUDED.remaining_quota,
                   starts_at = EXCLUDED.starts_at,
                   expires_at = EXCLUDED.expires_at,
                   updated_at = now()`,
              [
                item.packageId,
                item.provider,
                item.product,
                item.config,
                item.recognizedModel,
                item.status,
                item.totalQuota,
                item.remainingQuota,
                item.startsAt,
                item.expiresAt,
              ],
            );
            await persistResourcePackageSnapshot(client, item, runId);
          }
          for (const missing of missingPackages.rows) {
            const expiresAt = missing.expires_at ? new Date(missing.expires_at) : null;
            const expiredByKnownDate = Boolean(
              expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= Date.now(),
            );
            const rawPayload = {
              synthetic: true,
              reason: 'missing-from-complete-package-sync',
              conclusion: expiredByKnownDate
                ? 'expired-by-known-expiration-time'
                : 'missing-is-not-proof-of-expiration',
              previousStatus: missing.status,
              previousRemainingQuota: Number(missing.remaining_quota),
              syncRunId: runId,
            };
            await persistResourcePackageSnapshot(client, {
              packageId: missing.package_id,
              provider: PROVIDER,
              product: missing.product,
              config: missing.config,
              recognizedModel: missing.recognized_model,
              status: expiredByKnownDate ? 'Expired' : 'Stale',
              totalQuota: Number(missing.total_quota),
              // 消失只表示这次列表没有返回该实例。保留最后可信余量；除非已知
              // expiresAt 确实到达，否则不能伪造成已全部核销。
              remainingQuota: Number(missing.remaining_quota),
              startsAt: missing.starts_at ? new Date(missing.starts_at).toISOString() : null,
              expiresAt: expiresAt?.toISOString() ?? null,
              payloadHash: sha256Hex(canonicalJsonStringify(rawPayload)),
              rawPayload,
            }, runId);
          }
        },
      };
    },
  });
}

export async function syncVolcengineBillingBalance(options: SyncOptions = {}): Promise<VolcengineBillingSyncResult> {
  return executeBillingSync({
    kind: 'balance',
    windowStart: null,
    windowEnd: null,
    isFinal: false,
    minIntervalMs: env.VOLC_BILLING_BALANCE_SYNC_INTERVAL_MS,
    force: options.force,
    prepare: async () => {
      const response = await volcengineOpenApiRequest<Record<string, unknown>>('QueryBalanceAcct', {}, {
        method: 'GET',
      });
      const balance = mapVolcengineBalance(response);
      return {
        pages: 1,
        rows: 1,
        requestId: balance.requestId,
        persist: async (client: DbClient) => {
          await client.query(
            `INSERT INTO provider_account_balance_snapshots (
               provider, account_id, available_balance_cny, cash_balance_cny,
               frozen_amount_cny, arrears_balance_cny, credit_limit_cny,
               currency, request_id, synced_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
            [
              balance.provider,
              balance.accountId,
              balance.availableBalanceCny,
              balance.cashBalanceCny,
              balance.frozenAmountCny,
              balance.arrearsBalanceCny,
              balance.creditLimitCny,
              balance.currency,
              balance.requestId,
            ],
          );
        },
      };
    },
  });
}

export async function syncVolcengineBillDetails(input: {
  billPeriod: string;
  expenseDate?: string;
  isFinal?: boolean;
  force?: boolean;
}): Promise<VolcengineBillingSyncResult> {
  const window = normalizeBillWindow(input);
  return executeBillingSync({
    kind: 'bill',
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    isFinal: window.isFinal,
    minIntervalMs: input.expenseDate
      ? env.VOLC_BILLING_BILL_SYNC_INTERVAL_MS
      : 24 * 60 * 60 * 1000,
    force: input.force,
    prepare: async () => {
      const fetched = await fetchAllBillDetails(window);
      const normalized = normalizeVolcengineBillDetails(fetched.items, window);
      return {
        pages: fetched.pages,
        rows: normalized.length,
        requestId: fetched.requestId,
        persist: async (client: DbClient, runId: string) => {
          await deactivateBillWindow(client, window, runId);
          for (const detail of normalized) {
            await upsertBillDetail(client, detail, runId, window.isFinal);
          }
          await reconcilePackageBillingState(client);
          const reconciliationInput = {
            billPeriod: window.billPeriod,
            windowStart: window.windowStart,
            windowEnd: window.windowEnd,
            officialSyncRunId: runId,
            isFinal: window.isFinal,
          };
          const reconciliationRunId = await generateProviderReconciliationSnapshot(
            client,
            reconciliationInput,
          );
          if (reconciliationRunId) {
            const review = await reviewFinalBillZeroCostCases(client, reconciliationRunId);
            // 零成本案件不改变 Token 或金额，但批准属于新的审计结论。再生成一份
            // 同口径快照，让最新快照时间晚于审批证据，便于页面和审计按截点还原。
            if (review.approved > 0 || review.superseded > 0 || review.reopened > 0) {
              await generateProviderReconciliationSnapshot(client, reconciliationInput);
            }
          }
        },
      };
    },
  });
}

export async function syncRecentVolcengineBillDetails(
  now = new Date(),
  options: SyncOptions = {},
) {
  const results: VolcengineBillingSyncResult[] = [];
  for (let dayOffset = 2; dayOffset >= 0; dayOffset -= 1) {
    const expenseDate = shanghaiDate(addShanghaiDays(now, -dayOffset));
    results.push(await syncVolcengineBillDetails({
      billPeriod: expenseDate.slice(0, 7),
      expenseDate,
      force: options.force,
    }));
  }
  return results;
}

export async function runScheduledVolcengineBillingSync(now = new Date()) {
  const results: VolcengineBillingSyncResult[] = [];
  results.push(await syncVolcengineBillingBalance());
  results.push(...await syncRecentVolcengineBillDetails(now));

  const today = shanghaiDate(now);
  const month = today.slice(0, 7);
  results.push(await syncVolcengineBillDetails({ billPeriod: month }));
  results.push(await syncVolcengineBillingPackages());

  const parts = shanghaiParts(now);
  if (parts.day > 2 || (parts.day === 2 && parts.hour >= 12)) {
    const previousMonth = shiftMonth(month, -1);
    results.push(await syncVolcengineBillDetails({
      billPeriod: previousMonth,
      isFinal: true,
    }));
  }
  return results;
}

export async function requestVolcengineBillingSync(input: VolcengineBillingSyncScope | {
  scope?: VolcengineBillingSyncScope;
  windowStart?: string;
  windowEnd?: string;
  requestedBy?: string;
} = {}) {
  const normalizedInput = typeof input === 'string' ? { scope: input } : input;
  const scope = normalizedInput.scope ?? 'all';
  const windowStart = normalizedInput.windowStart ? assertIsoDate(normalizedInput.windowStart, 'windowStart') : null;
  const windowEnd = normalizedInput.windowEnd ? assertIsoDate(normalizedInput.windowEnd, 'windowEnd') : null;
  if ((windowStart && !windowEnd) || (!windowStart && windowEnd)) {
    throw new Error('账单同步时间范围必须同时提供开始和结束日期');
  }
  if (windowStart && windowEnd && windowStart > windowEnd) {
    throw new Error('账单同步开始日期不能晚于结束日期');
  }
  if ((windowStart || windowEnd) && scope !== 'all' && scope !== 'bill') {
    throw new Error('只有账单同步支持指定日期范围');
  }

  const result = await pool.query<{ id: string; status: string; created_at: Date | string }>(
    `INSERT INTO provider_billing_sync_requests (
       provider, scope, window_start, window_end, status, requested_by
     )
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING id::text, status, created_at`,
    [PROVIDER, scope, windowStart, windowEnd, normalizedInput.requestedBy ?? null],
  );
  return result.rows[0];
}

export async function processPendingVolcengineBillingSyncRequests(limit = 5) {
  // 单次只领取一条，避免长日期范围让同批后续请求的租约在等待中失效。
  void limit;
  const claimed = await withTransaction(async client => client.query<{
    id: string;
    scope: VolcengineBillingSyncScope;
    window_start: Date | string | null;
    window_end: Date | string | null;
  }>(
    `WITH candidates AS (
       SELECT id
       FROM provider_billing_sync_requests
       WHERE provider = $1
         AND (
           status = 'pending'
           OR (status = 'processing' AND updated_at < now() - interval '15 minutes')
         )
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE provider_billing_sync_requests AS requests
     SET status = 'processing',
         attempt_count = attempt_count + 1,
         started_at = now(),
         updated_at = now()
     FROM candidates
     WHERE requests.id = candidates.id
     RETURNING requests.id::text, requests.scope, requests.window_start, requests.window_end`,
    [PROVIDER],
  ));

  let completed = 0;
  let failed = 0;
  let deferred = 0;
  for (const request of claimed.rows) {
    const heartbeat = setInterval(() => {
      void pool.query(
        `UPDATE provider_billing_sync_requests
         SET updated_at = now()
         WHERE id = $1 AND status = 'processing'`,
        [request.id],
      ).catch(() => undefined);
    }, 30_000);
    try {
      const results = await runRequestedSync(request);
      const failedResult = results.find(result => !result.ok);
      if (failedResult?.retryable) {
        await pool.query(
          `UPDATE provider_billing_sync_requests
           SET status = 'pending', started_at = NULL, error = $2, updated_at = now()
           WHERE id = $1`,
          [request.id, failedResult.reason ?? '等待同类账务同步完成'],
        );
        deferred += 1;
        continue;
      }
      const error = failedResult?.error ?? failedResult?.reason;
      if (error) throw new Error(error);
      await pool.query(
        `UPDATE provider_billing_sync_requests
         SET status = 'completed', completed_at = now(), error = NULL, updated_at = now()
         WHERE id = $1`,
        [request.id],
      );
      completed += 1;
    } catch (error) {
      await pool.query(
        `UPDATE provider_billing_sync_requests
         SET status = 'failed', completed_at = now(), error = $2, updated_at = now()
         WHERE id = $1`,
        [request.id, errorMessage(error)],
      );
      failed += 1;
    } finally {
      clearInterval(heartbeat);
    }
  }
  return { claimed: claimed.rowCount ?? claimed.rows.length, completed, failed, deferred };
}

async function runRequestedSync(request: {
  scope: VolcengineBillingSyncScope;
  window_start: Date | string | null;
  window_end: Date | string | null;
}) {
  const results: VolcengineBillingSyncResult[] = [];
  if (request.scope === 'all' || request.scope === 'balance') {
    results.push(await syncVolcengineBillingBalance({ force: true }));
  }
  if (request.scope === 'all' || request.scope === 'bill') {
    if (request.window_start && request.window_end) {
      const start = toIsoDate(request.window_start);
      const end = toIsoDate(request.window_end);
      for (const expenseDate of enumerateIsoDates(start, end, 93)) {
        results.push(await syncVolcengineBillDetails({
          billPeriod: expenseDate.slice(0, 7),
          expenseDate,
          force: true,
        }));
      }
    } else {
      results.push(...await syncRecentVolcengineBillDetails(new Date(), { force: true }));
      results.push(await syncVolcengineBillDetails({
        billPeriod: shanghaiDate(new Date()).slice(0, 7),
        force: true,
      }));
    }
  }
  // all 同步必须先形成购置基础，再拍资源包余量快照；否则首拍已经发生的
  // 消耗会被永久标为 opening-unallocated。
  if (request.scope === 'all' || request.scope === 'packages') {
    results.push(await syncVolcengineBillingPackages({ force: true }));
  }
  return results;
}

async function executeBillingSync(input: {
  kind: VolcengineBillingSyncKind;
  windowStart: string | null;
  windowEnd: string | null;
  isFinal: boolean;
  minIntervalMs: number;
  force?: boolean;
  prepare: () => Promise<PreparedSyncWork>;
}): Promise<VolcengineBillingSyncResult> {
  if (!hasBillingCredentials()) {
    return emptySyncResult(input.kind, false, '火山费用中心 AK/SK 未配置');
  }

  const client = await pool.connect();
  let lockAcquired = false;
  let runId: string | null = null;
  try {
    const lock = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS acquired`,
      [`${PROVIDER}:billing`, syncLockScope(input)],
    );
    if (!lock.rows[0]?.acquired) {
      if (input.force) {
        return {
          ok: false,
          skipped: true,
          retryable: true,
          kind: input.kind,
          pages: 0,
          rows: 0,
          reason: '另一 worker 正在同步相同账务类型',
        };
      }
      return emptySyncResult(input.kind, true, '另一 worker 正在同步相同账务类型');
    }
    lockAcquired = true;

    // session 锁已证明没有同类同步存活，可收口上次进程异常退出遗留的 running 记录。
    await client.query(
      `UPDATE provider_billing_sync_runs
       SET status = 'failed', error = '同步进程中断', completed_at = now()
       WHERE provider = $1 AND kind = $2 AND status = 'running'`,
      [PROVIDER, input.kind],
    );

    if (!input.force && await isFreshSync(client, input)) {
      return emptySyncResult(input.kind, true, '已有新鲜同步结果');
    }

    const run = await client.query<{ id: string }>(
      `INSERT INTO provider_billing_sync_runs (
         provider, kind, status, window_start, window_end, page_count,
         row_count, started_at, is_final
       )
       VALUES ($1, $2, 'running', $3, $4, 0, 0, now(), $5)
       RETURNING id::text`,
      [PROVIDER, input.kind, input.windowStart, input.windowEnd, input.isFinal],
    );
    runId = run.rows[0]!.id;

    let transactionStarted = false;
    try {
      // 先完整拉取所有分页，只有全部成功后才开启短事务替换本地快照。
      const result = await input.prepare();
      await client.query('BEGIN');
      transactionStarted = true;
      await result.persist(client, runId);
      await client.query(
        `UPDATE provider_billing_sync_runs
         SET status = 'success', page_count = $2, row_count = $3,
             request_id = $4, completed_at = now(), error = NULL
         WHERE id = $1`,
        [runId, result.pages, result.rows, result.requestId ?? null],
      );
      await client.query('COMMIT');
      transactionStarted = false;
      return {
        ok: true,
        skipped: false,
        kind: input.kind,
        pages: result.pages,
        rows: result.rows,
      };
    } catch (error) {
      if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
      const message = errorMessage(error);
      await client.query(
        `UPDATE provider_billing_sync_runs
         SET status = 'failed', error = $2, completed_at = now()
         WHERE id = $1`,
        [runId, message.slice(0, 2000)],
      ).catch(() => undefined);
      return failedSyncResult(input.kind, message);
    }
  } catch (error) {
    const message = errorMessage(error);
    if (runId) {
      await client.query(
        `UPDATE provider_billing_sync_runs
         SET status = 'failed', error = $2, completed_at = now()
         WHERE id = $1`,
        [runId, message.slice(0, 2000)],
      ).catch(() => undefined);
    } else {
      await recordFailedSync(input, new Date(), message).catch(() => undefined);
    }
    return failedSyncResult(input.kind, message);
  } finally {
    if (lockAcquired) {
      await client.query(
        `SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`,
        [`${PROVIDER}:billing`, syncLockScope(input)],
      ).catch(() => undefined);
    }
    client.release();
  }
}

async function isFreshSync(client: DbClient, input: {
  kind: VolcengineBillingSyncKind;
  windowStart: string | null;
  windowEnd: string | null;
  isFinal: boolean;
  minIntervalMs: number;
}) {
  const result = await client.query<{ completed_at: Date | string; fresh: boolean }>(
    `SELECT completed_at,
            completed_at >= now() - ($6::double precision * interval '1 millisecond') AS fresh
     FROM provider_billing_sync_runs
     WHERE provider = $1
       AND kind = $2
       AND status = 'success'
       AND window_start IS NOT DISTINCT FROM $3::date
       AND window_end IS NOT DISTINCT FROM $4::date
       AND ($5::boolean = false OR is_final = true)
       AND completed_at IS NOT NULL
     ORDER BY completed_at DESC
     LIMIT 1`,
    [PROVIDER, input.kind, input.windowStart, input.windowEnd, input.isFinal, input.minIntervalMs],
  );
  const completedAt = result.rows[0]?.completed_at;
  if (!completedAt) return false;
  return result.rows[0]!.fresh;
}

async function recordFailedSync(
  input: {
    kind: VolcengineBillingSyncKind;
    windowStart: string | null;
    windowEnd: string | null;
    isFinal: boolean;
  },
  startedAt: Date,
  error: string,
) {
  await pool.query(
    `INSERT INTO provider_billing_sync_runs (
       provider, kind, status, window_start, window_end, page_count,
       row_count, error, started_at, completed_at, is_final
     )
     VALUES ($1, $2, 'failed', $3, $4, 0, 0, $5, $6, now(), $7)`,
    [PROVIDER, input.kind, input.windowStart, input.windowEnd, error.slice(0, 2000), startedAt, input.isFinal],
  );
}

function emptySyncResult(kind: VolcengineBillingSyncKind, ok: boolean, reason: string): VolcengineBillingSyncResult {
  return { ok, skipped: true, kind, pages: 0, rows: 0, reason };
}

function failedSyncResult(kind: VolcengineBillingSyncKind, error: string): VolcengineBillingSyncResult {
  return { ok: false, skipped: false, kind, pages: 0, rows: 0, error };
}

export async function fetchAllResourcePackages() {
  const items: Record<string, unknown>[] = [];
  const seenTokens = new Set<string>();
  let nextToken: string | undefined;
  let pages = 0;
  let requestId: string | null = null;

  do {
    if (nextToken && seenTokens.has(nextToken)) throw new Error('资源包分页游标重复');
    if (nextToken) seenTokens.add(nextToken);
    const response = await volcengineOpenApiRequest<Record<string, unknown>>('ListResourcePackages', {
      ResourceType: 'Package',
      MaxResults: '20',
      ...(nextToken ? { NextToken: nextToken } : {}),
    });
    const pageItems = extractResourcePackageItems(response);
    items.push(...pageItems);
    requestId = extractRequestId(response) ?? requestId;
    pages += 1;
    // 火山 ListResourcePackages 在真实账户的末尾可能返回空列表但继续给出
    // NextToken；继续请求会循环回已见游标。空页已经是可靠的分页终点。
    if (pageItems.length === 0) {
      nextToken = undefined;
      break;
    }
    nextToken = extractNextToken(response);
    if (pages >= MAX_BILL_PAGES && nextToken) throw new Error('资源包分页超过安全上限');
  } while (nextToken);

  return { items, pages, requestId };
}

export function buildVolcengineBillDetailRequestBody(input: {
  billPeriod: string;
  expenseDate?: string;
  offset?: number;
}) {
  const window = normalizeBillWindow(input);
  return {
    BillPeriod: window.billPeriod,
    ...(window.expenseDate ? { ExpenseDate: window.expenseDate } : {}),
    GroupTerm: 0,
    GroupPeriod: 2,
    Limit: BILL_PAGE_LIMIT,
    Offset: input.offset ?? 0,
    IgnoreZero: 0,
    NeedRecordNum: 1,
  };
}

export async function fetchVolcengineBillDetailPages(input: {
  billPeriod: string;
  expenseDate?: string;
  pageDelayMs?: number;
}) {
  return fetchAllBillDetails(normalizeBillWindow(input), input.pageDelayMs);
}

async function fetchAllBillDetails(window: BillWindow, pageDelayMs = env.VOLC_BILLING_PAGE_DELAY_MS) {
  const items: Record<string, unknown>[] = [];
  let offset = 0;
  let pages = 0;
  let requestId: string | null = null;
  let expectedTotal: number | null = null;

  while (true) {
    if (pageDelayMs > 0) {
      const waitMs = pageDelayMs - (Date.now() - lastBillRequestAt);
      if (waitMs > 0) await delay(waitMs);
      lastBillRequestAt = Date.now();
    }
    const response = await volcengineOpenApiRequest<Record<string, unknown>>(
      'ListBillDetail',
      buildVolcengineBillDetailRequestBody({
        billPeriod: window.billPeriod,
        expenseDate: window.expenseDate,
        offset,
      }),
    );
    const pageItems = extractBillItems(response);
    const total = extractRequiredBillTotal(response);
    if (expectedTotal === null) expectedTotal = total;
    if (total !== expectedTotal) throw new Error('账单分页期间 Total 发生变化');
    if (pageItems.length > BILL_PAGE_LIMIT) throw new Error('账单单页数量超过 Limit');
    items.push(...pageItems);
    requestId = extractRequestId(response) ?? requestId;
    pages += 1;

    offset += BILL_PAGE_LIMIT;
    const hasNext = offset < total;
    if (!hasNext) break;
    if (pageItems.length === 0) throw new Error('账单分页在到达 Total 前提前结束');
    if (pages >= MAX_BILL_PAGES) throw new Error('账单分页超过安全上限');
  }
  if (expectedTotal === null || items.length !== expectedTotal) {
    throw new Error(`账单分页数量与 Total 不一致：${items.length}/${expectedTotal ?? 'missing'}`);
  }
  return { items, pages, requestId };
}

async function deactivateBillWindow(client: DbClient, window: BillWindow, runId: string) {
  await client.query(
    `UPDATE provider_bill_details
     SET active = false, synced_at = now()
     WHERE provider = $1
       AND bill_period = $2
       AND ($3::date IS NULL OR expense_date = $3::date)
       AND last_seen_run_id IS DISTINCT FROM $4::uuid`,
    [PROVIDER, window.billPeriod, window.expenseDate ?? null, runId],
  );
}

async function upsertBillDetail(
  client: DbClient,
  detail: NormalizedVolcengineBillDetail,
  runId: string,
  isFinal: boolean,
) {
  const normalizedPayload = normalizedBillDetailPayload(detail);
  const payloadHash = sha256Hex(canonicalJsonStringify({
    raw: detail.rawPayload,
    normalized: normalizedPayload,
  }));
  const revision = await client.query<{ id: string }>(
    `WITH inserted AS (
       INSERT INTO provider_bill_detail_revisions (
         provider, source_detail_key, sync_run_id, payload_hash, raw_payload,
         normalized_payload, normalization_version, observed_at
       )
       VALUES ($1, $2, $3::uuid, $4, $5::jsonb, $6::jsonb, $7, now())
       ON CONFLICT (provider, source_detail_key, payload_hash) DO NOTHING
       RETURNING id::text
     )
     SELECT id FROM inserted
     UNION ALL
     SELECT id::text
     FROM provider_bill_detail_revisions
     WHERE provider = $1 AND source_detail_key = $2 AND payload_hash = $4
     LIMIT 1`,
    [
      detail.provider,
      detail.sourceDetailKey,
      runId,
      payloadHash,
      JSON.stringify(detail.rawPayload),
      JSON.stringify(normalizedPayload),
      detail.normalizationVersion,
    ],
  );
  const revisionId = revision.rows[0]?.id;
  if (!revisionId) throw new Error(`无法保存账单修订：${detail.sourceDetailKey}`);

  await client.query(
    `INSERT INTO provider_bill_sync_run_items (
       sync_run_id, bill_detail_revision_id, source_detail_key
     ) VALUES ($1::uuid, $2::uuid, $3)
     ON CONFLICT (sync_run_id, source_detail_key) DO NOTHING`,
    [runId, revisionId, detail.sourceDetailKey],
  );

  const projection = await client.query<{ id: string }>(
    `INSERT INTO provider_bill_details (
       provider, source_detail_key, payer_id, bill_period, expense_date,
       product, product_zh, billing_mode, bill_category, instance_no,
       config_name, element_code, configuration_code, factor_code, project,
       tag, price, price_unit, usage_count, usage_unit, deduction_count,
       original_bill_amount_cny, preferential_bill_amount_cny,
       discount_bill_amount_cny, coupon_amount_cny, payable_amount_cny,
       paid_amount_cny, unpaid_amount_cny, round_amount_cny, currency,
       settlement_type, recognized_model, pricing_resolution,
       pricing_input_has_video, billable_tokens, list_equivalent_cost_cny,
       is_final, active, raw_payload, last_seen_run_id, synced_at,
       bill_line_type, normalized_unit_price_per_million,
       normalization_version, current_revision_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19, $20, $21,
       $22, $23, $24, $25, $26, $27, $28, $29, $30,
       $31, $32, $33, $34, $35, $36, $37, true, $38::jsonb, $39::uuid, now(),
       $40, $41, $42, $43::uuid
     )
     ON CONFLICT (provider, source_detail_key) DO UPDATE SET
       payer_id = EXCLUDED.payer_id,
       bill_period = EXCLUDED.bill_period,
       expense_date = EXCLUDED.expense_date,
       product = EXCLUDED.product,
       product_zh = EXCLUDED.product_zh,
       billing_mode = EXCLUDED.billing_mode,
       bill_category = EXCLUDED.bill_category,
       instance_no = EXCLUDED.instance_no,
       config_name = EXCLUDED.config_name,
       element_code = EXCLUDED.element_code,
       configuration_code = EXCLUDED.configuration_code,
       factor_code = EXCLUDED.factor_code,
       project = EXCLUDED.project,
       tag = EXCLUDED.tag,
       price = EXCLUDED.price,
       price_unit = EXCLUDED.price_unit,
       usage_count = EXCLUDED.usage_count,
       usage_unit = EXCLUDED.usage_unit,
       deduction_count = EXCLUDED.deduction_count,
       original_bill_amount_cny = EXCLUDED.original_bill_amount_cny,
       preferential_bill_amount_cny = EXCLUDED.preferential_bill_amount_cny,
       discount_bill_amount_cny = EXCLUDED.discount_bill_amount_cny,
       coupon_amount_cny = EXCLUDED.coupon_amount_cny,
       payable_amount_cny = EXCLUDED.payable_amount_cny,
       paid_amount_cny = EXCLUDED.paid_amount_cny,
       unpaid_amount_cny = EXCLUDED.unpaid_amount_cny,
       round_amount_cny = EXCLUDED.round_amount_cny,
       currency = EXCLUDED.currency,
       settlement_type = EXCLUDED.settlement_type,
       recognized_model = EXCLUDED.recognized_model,
       pricing_resolution = EXCLUDED.pricing_resolution,
       pricing_input_has_video = EXCLUDED.pricing_input_has_video,
       billable_tokens = EXCLUDED.billable_tokens,
       list_equivalent_cost_cny = EXCLUDED.list_equivalent_cost_cny,
       is_final = EXCLUDED.is_final,
       active = true,
       raw_payload = EXCLUDED.raw_payload,
       last_seen_run_id = EXCLUDED.last_seen_run_id,
       synced_at = now(),
       bill_line_type = EXCLUDED.bill_line_type,
       normalized_unit_price_per_million = EXCLUDED.normalized_unit_price_per_million,
       normalization_version = EXCLUDED.normalization_version,
       current_revision_id = EXCLUDED.current_revision_id
     RETURNING id::text`,
    [
      detail.provider,
      detail.sourceDetailKey,
      detail.payerId,
      detail.billPeriod,
      detail.expenseDate,
      detail.product,
      detail.productZh,
      detail.billingMode,
      detail.billCategory,
      detail.instanceNo,
      detail.configName,
      detail.elementCode,
      detail.configurationCode,
      detail.factorCode,
      detail.project,
      detail.tag === null ? null : JSON.stringify(detail.tag),
      detail.price,
      detail.priceUnit,
      detail.usageCount,
      detail.usageUnit,
      detail.deductionCount,
      detail.originalBillAmountCny,
      detail.preferentialBillAmountCny,
      detail.discountBillAmountCny,
      detail.couponAmountCny,
      detail.payableAmountCny,
      detail.paidAmountCny,
      detail.unpaidAmountCny,
      detail.roundAmountCny,
      detail.currency,
      detail.settlementType,
      detail.recognizedModel,
      detail.pricingResolution,
      detail.pricingInputHasVideo,
      detail.billableTokens,
      detail.listEquivalentCostCny,
      isFinal,
      JSON.stringify(detail.rawPayload),
      runId,
      detail.billLineType,
      detail.normalizedUnitPricePerMillion,
      detail.normalizationVersion,
      revisionId,
    ],
  );

  const billDetailId = projection.rows[0]?.id;
  if (billDetailId) {
    // 036 应用时，历史案件可能只能关联兼容投影；首次重拉后固定到当时的
    // 不可变 revision。后续官方修订保留原证据，不覆盖已绑定的 revision。
    await client.query(
      `UPDATE provider_reconciliation_case_links
       SET bill_detail_revision_id = $2::uuid
       WHERE bill_detail_id = $1::uuid
         AND bill_detail_revision_id IS NULL`,
      [billDetailId, revisionId],
    );
  }
  if (
    detail.billLineType === 'package-purchase'
    && detail.recognizedModel !== null
    && detail.instanceNo
    && billDetailId
    && detail.currency === 'CNY'
    && hasNonnegativePackageCost(detail)
  ) {
    await client.query(
      `INSERT INTO provider_resource_package_acquisitions (
         provider, package_id, bill_source_detail_key, bill_detail_id,
         current_revision_id, acquisition_date, acquired_quota,
         original_amount_cny, payable_amount_cny, paid_amount_cny, unpaid_amount_cny,
         currency, cost_basis_status, updated_at
       ) VALUES (
         $1, $2, $3, $4::uuid, $5::uuid, $6::date, NULL,
         $7, $8, $9, $10, $11, 'matched', now()
       )
       ON CONFLICT (provider, bill_source_detail_key) DO UPDATE SET
         package_id = EXCLUDED.package_id,
         bill_detail_id = EXCLUDED.bill_detail_id,
         current_revision_id = EXCLUDED.current_revision_id,
         acquisition_date = EXCLUDED.acquisition_date,
         original_amount_cny = EXCLUDED.original_amount_cny,
         payable_amount_cny = EXCLUDED.payable_amount_cny,
         paid_amount_cny = EXCLUDED.paid_amount_cny,
         unpaid_amount_cny = EXCLUDED.unpaid_amount_cny,
         currency = EXCLUDED.currency,
         cost_basis_status = 'matched',
         updated_at = CASE
           WHEN (
             provider_resource_package_acquisitions.package_id,
             provider_resource_package_acquisitions.bill_detail_id,
             provider_resource_package_acquisitions.current_revision_id,
             provider_resource_package_acquisitions.acquisition_date,
             provider_resource_package_acquisitions.original_amount_cny,
             provider_resource_package_acquisitions.payable_amount_cny,
             provider_resource_package_acquisitions.paid_amount_cny,
             provider_resource_package_acquisitions.unpaid_amount_cny,
             provider_resource_package_acquisitions.currency,
             provider_resource_package_acquisitions.cost_basis_status
           ) IS DISTINCT FROM (
             EXCLUDED.package_id,
             EXCLUDED.bill_detail_id,
             EXCLUDED.current_revision_id,
             EXCLUDED.acquisition_date,
             EXCLUDED.original_amount_cny,
             EXCLUDED.payable_amount_cny,
             EXCLUDED.paid_amount_cny,
             EXCLUDED.unpaid_amount_cny,
             EXCLUDED.currency,
             'matched'::text
           ) THEN now()
           ELSE provider_resource_package_acquisitions.updated_at
         END`,
      [
        detail.provider,
        detail.instanceNo,
        detail.sourceDetailKey,
        billDetailId,
        revisionId,
        detail.expenseDate,
        detail.originalBillAmountCny,
        detail.payableAmountCny,
        detail.paidAmountCny,
        detail.unpaidAmountCny,
        detail.currency,
      ],
    );
  } else if (
    (detail.billLineType === 'refund' || detail.billLineType === 'adjustment')
    && detail.recognizedModel !== null
    && detail.instanceNo
    && detail.currency === 'CNY'
  ) {
    // 退款/调账金额不能仅凭一行官方账单自动拆成“返还现金、冲回摊销、
    // 核销剩余资产”。先保存不可变账单证据并把成本基础标为待人工归因，
    // 避免继续展示一个看似完整但已经失真的预付资产余额。
    await client.query(
      `INSERT INTO provider_resource_package_cost_events (
         provider, package_id, source_bill_detail_revision_id, event_type,
         event_date, quota_delta, allocated_cost_cny, cost_basis_status, evidence
       ) VALUES (
         $1, $2, $3::uuid, $4, $5::date, 0, NULL, 'missing-acquisition', $6::jsonb
       )
       ON CONFLICT (provider, package_id, source_bill_detail_revision_id, event_type)
       DO UPDATE SET
         allocated_cost_cny = NULL,
         cost_basis_status = 'missing-acquisition',
         evidence = EXCLUDED.evidence`,
      [
        detail.provider,
        detail.instanceNo,
        revisionId,
        detail.billLineType,
        detail.expenseDate,
        JSON.stringify({
          sourceDetailKey: detail.sourceDetailKey,
          originalBillAmountCny: detail.originalBillAmountCny,
          payableAmountCny: detail.payableAmountCny,
          paidAmountCny: detail.paidAmountCny,
          unpaidAmountCny: detail.unpaidAmountCny,
          allocationReason: 'official-refund-or-adjustment-requires-reviewed-allocation',
          normalizationVersion: BILL_NORMALIZATION_VERSION,
        }),
      ],
    );
  }
}

export async function reconcileOpeningPackageCostBasis(
  client: DbClient,
  provider: string,
  packageId: string,
) {
  await client.query(
    `WITH acquisition AS (
       SELECT sum(coalesce(payable_amount_cny, paid_amount_cny))::numeric AS cost_cny
       FROM provider_resource_package_acquisitions
       WHERE provider = $1 AND package_id = $2 AND cost_basis_status = 'matched'
         AND currency = 'CNY'
     )
     UPDATE provider_resource_package_cost_events events
     SET allocated_cost_cny = CASE
           WHEN acquisition.cost_cny IS NOT NULL AND snapshots.total_quota > 0
             THEN round(
               abs(events.quota_delta)::numeric * acquisition.cost_cny
               / snapshots.total_quota::numeric,
               6
             )
           ELSE NULL
         END,
         cost_basis_status = CASE
           WHEN acquisition.cost_cny IS NOT NULL AND snapshots.total_quota > 0
             THEN 'allocated'
           ELSE 'missing-acquisition'
         END,
         evidence = events.evidence || jsonb_build_object(
           'costBasisReconciledAt', now(),
           'costBasisReconciledFrom', 'current-matched-package-acquisitions'
         )
     FROM provider_resource_package_snapshots snapshots, acquisition
     WHERE events.source_snapshot_id = snapshots.id
       AND events.provider = $1
       AND events.package_id = $2
       AND events.event_type IN ('opening-balance', 'consumption', 'expiry-writeoff')
       -- allocationEligible=false 表示证据只证明额度已归零，却不能区分真实
       -- 消费与到期损失。后续购置账单补齐也不能把这种不确定性洗成已分配。
       AND events.evidence->>'allocationEligible' IS DISTINCT FROM 'false'`,
    [provider, packageId],
  );
}

function hasNonnegativePackageCost(detail: NormalizedVolcengineBillDetail) {
  const amount = detail.payableAmountCny ?? detail.paidAmountCny;
  if (amount === null) return false;
  const parsed = parseDecimal(amount);
  return parsed !== null && parsed.numerator >= 0n;
}

async function reconcilePackageBillingState(client: DbClient) {
  // 同一退款/调账 revision 重拉不会重复记账；当该 revision 已被新的官方投影
  // 取代时，把旧的“待分配”事件归零并保留 superseded 证据。
  await client.query(
    `UPDATE provider_resource_package_cost_events events
     SET allocated_cost_cny = 0,
         cost_basis_status = 'allocated',
         evidence = events.evidence || jsonb_build_object(
           'supersededAt', now(),
           'supersededReason', 'official-bill-revision-is-no-longer-current'
         )
     FROM provider_bill_detail_revisions revisions
     LEFT JOIN provider_bill_details details
       ON details.provider = revisions.provider
      AND details.source_detail_key = revisions.source_detail_key
     WHERE events.provider = $1
       AND events.source_bill_detail_revision_id = revisions.id
       AND events.event_type IN ('refund', 'adjustment')
       AND (
         details.id IS NULL
         OR details.active = false
         OR details.current_revision_id IS DISTINCT FROM revisions.id
         OR details.bill_line_type IS DISTINCT FROM events.event_type
       )`,
    [PROVIDER],
  );

  // acquisition 是当前关联投影，不承担历史账本职责。只要购买行被删除、
  // 重分类，或同一实例出现尚未人工拆分的退款/调账，就把该实例置为 revised；
  // API 会把整组预付资产金额隐藏为“不完整”，避免高估。
  await client.query(
    `WITH desired AS (
       SELECT acquisitions.id,
              CASE
                WHEN acquisitions.currency = 'CNY'
                 AND coalesce(acquisitions.payable_amount_cny, acquisitions.paid_amount_cny) >= 0
                 AND EXISTS (
                   SELECT 1
                   FROM provider_bill_details purchase
                   WHERE purchase.id = acquisitions.bill_detail_id
                     AND purchase.provider = acquisitions.provider
                     AND purchase.active = true
                     AND purchase.bill_line_type = 'package-purchase'
                     AND purchase.current_revision_id IS NOT DISTINCT FROM acquisitions.current_revision_id
                 )
                 AND NOT EXISTS (
                   SELECT 1
                   FROM provider_bill_details adjustment
                   WHERE adjustment.provider = acquisitions.provider
                     AND adjustment.instance_no = acquisitions.package_id
                     AND adjustment.active = true
                     AND adjustment.bill_line_type IN ('refund', 'adjustment')
                 )
                 -- 多次购买或总额度上调需要分 tranche/移动平均；在实现前宁可
                 -- 整包标为不完整，也不能把未来购置价追溯分配给历史消费。
                 AND 1 = (
                   SELECT count(*)
                   FROM provider_resource_package_acquisitions siblings
                   WHERE siblings.provider = acquisitions.provider
                     AND siblings.package_id = acquisitions.package_id
                 )
                 AND NOT EXISTS (
                   SELECT 1
                   FROM provider_resource_package_snapshots snapshots
                   WHERE snapshots.provider = acquisitions.provider
                     AND snapshots.package_id = acquisitions.package_id
                   GROUP BY snapshots.provider, snapshots.package_id
                   HAVING min(snapshots.total_quota) <> max(snapshots.total_quota)
                 )
                  THEN 'matched'
                ELSE 'revised'
              END AS desired_status
       FROM provider_resource_package_acquisitions acquisitions
       WHERE acquisitions.provider = $1
     )
     UPDATE provider_resource_package_acquisitions acquisitions
     SET cost_basis_status = desired.desired_status,
         updated_at = now()
     FROM desired
     WHERE acquisitions.id = desired.id
       AND acquisitions.cost_basis_status IS DISTINCT FROM desired.desired_status`,
    [PROVIDER],
  );

  const packages = await client.query<{ package_id: string }>(
    `SELECT DISTINCT package_id
     FROM (
       SELECT package_id
       FROM provider_resource_package_acquisitions
       WHERE provider = $1
       UNION ALL
       SELECT package_id
       FROM provider_resource_package_cost_events
       WHERE provider = $1
     ) packages
     WHERE package_id IS NOT NULL`,
    [PROVIDER],
  );
  for (const row of packages.rows) {
    await reconcileOpeningPackageCostBasis(client, PROVIDER, row.package_id);
  }
}

async function persistResourcePackageSnapshot(
  client: DbClient,
  item: NormalizedResourcePackage,
  runId: string,
) {
  const snapshot = await client.query<{ id: string; captured_at: Date | string }>(
    `INSERT INTO provider_resource_package_snapshots (
       provider, sync_run_id, package_id, product, config, recognized_model,
       status, total_quota, remaining_quota, starts_at, expires_at,
       payload_hash, raw_payload, captured_at
     ) VALUES (
       $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       $12, $13::jsonb, now()
     )
     ON CONFLICT (sync_run_id, package_id) DO UPDATE SET
       payload_hash = provider_resource_package_snapshots.payload_hash
     RETURNING id::text, captured_at`,
    [
      item.provider,
      runId,
      item.packageId,
      item.product,
      item.config,
      item.recognizedModel,
      item.status,
      item.totalQuota,
      item.remainingQuota,
      item.startsAt,
      item.expiresAt,
      item.payloadHash,
      JSON.stringify(item.rawPayload),
    ],
  );
  const current = snapshot.rows[0];
  if (!current) throw new Error(`无法保存资源包快照：${item.packageId}`);

  const previousResult = await client.query<{
    id: string;
    remaining_quota: string;
    status: string;
  }>(
    `SELECT id::text, remaining_quota::text, status
     FROM provider_resource_package_snapshots
     WHERE provider = $1 AND package_id = $2 AND id <> $3::uuid
     ORDER BY captured_at DESC, id DESC
     LIMIT 1`,
    [item.provider, item.packageId, current.id],
  );
  const previous = previousResult.rows[0];
  const acquisition = await client.query<{ acquisition_cost_cny: string | null }>(
    `SELECT sum(coalesce(payable_amount_cny, paid_amount_cny))::text AS acquisition_cost_cny
     FROM provider_resource_package_acquisitions
     WHERE provider = $1 AND package_id = $2 AND cost_basis_status = 'matched'
       AND currency = 'CNY'`,
    [item.provider, item.packageId],
  );
  const acquisitionCostCny = acquisition.rows[0]?.acquisition_cost_cny ?? null;
  let eventType: 'opening-balance' | 'consumption' | 'expiry-writeoff' | 'adjustment';
  let quotaDelta: bigint;
  let costBasisStatus: 'allocated' | 'missing-acquisition' | 'opening-unallocated';
  let allocatedCostCny: string | null = null;
  let eventEvidence: Record<string, unknown> = {};
  const currentIsTerminal = isPackageExpiryStatus(item.status);
  if (!previous && currentIsTerminal) {
    const totalQuota = BigInt(item.totalQuota);
    const remainingQuota = BigInt(item.remainingQuota);
    if (remainingQuota === 0n && totalQuota > 0n) {
      await persistPackageCostEvent(client, item, current.id, 'expiry-writeoff',
        -totalQuota, { allocatedCostCny: null, costBasisStatus: 'missing-acquisition' }, {
          terminalFirstObservation: true,
          allocationEligible: false,
          attribution: 'terminal-first-provider-zero-cannot-split-consumption-from-expiry',
        });
      return;
    }
    const consumedBeforeFirstSnapshot = totalQuota - remainingQuota;
    const allocation = (quantity: bigint, missingStatus: 'opening-unallocated' | 'missing-acquisition') => {
      if (acquisitionCostCny !== null && totalQuota > 0n) {
        const cost = formatRatioCost(quantity, acquisitionCostCny, totalQuota);
        return {
          allocatedCostCny: cost,
          costBasisStatus: cost === null ? 'missing-acquisition' as const : 'allocated' as const,
        };
      }
      return { allocatedCostCny: null, costBasisStatus: missingStatus };
    };
    await persistPackageCostEvent(client, item, current.id, 'opening-balance',
      -consumedBeforeFirstSnapshot, allocation(consumedBeforeFirstSnapshot, 'opening-unallocated'), {
        terminalFirstObservation: true,
        attribution: 'consumed-before-first-snapshot',
      });
    await persistPackageCostEvent(client, item, current.id, 'expiry-writeoff',
      -remainingQuota, allocation(remainingQuota, 'missing-acquisition'), {
        terminalFirstObservation: true,
        attribution: 'remaining-at-terminal-first-snapshot',
      });
    return;
  }
  if (!previous) {
    eventType = 'opening-balance';
    const consumedBeforeFirstSnapshot = BigInt(item.totalQuota) - BigInt(item.remainingQuota);
    quotaDelta = -consumedBeforeFirstSnapshot;
    if (acquisitionCostCny !== null && item.totalQuota > 0) {
      allocatedCostCny = formatRatioCost(
        consumedBeforeFirstSnapshot,
        acquisitionCostCny,
        BigInt(item.totalQuota),
      );
      costBasisStatus = allocatedCostCny === null ? 'missing-acquisition' : 'allocated';
    } else if (acquisitionCostCny !== null && consumedBeforeFirstSnapshot === 0n) {
      allocatedCostCny = '0.000000';
      costBasisStatus = 'allocated';
    } else {
      costBasisStatus = 'opening-unallocated';
    }
  } else {
    const previousRemaining = BigInt(previous.remaining_quota);
    const currentRemaining = BigInt(item.remainingQuota);
    const previousWasStale = previous.status.toLowerCase() === 'stale';
    const previousWasTerminal = isPackageExpiryStatus(previous.status);
    if (currentIsTerminal && previousWasTerminal) return;
    const expiredNow = currentIsTerminal && !previousWasTerminal;
    if (expiredNow) {
      if (previousRemaining === 0n && currentRemaining === 0n) return;
      const allocate = (quantity: bigint) => {
        if (acquisitionCostCny !== null && item.totalQuota > 0) {
          const cost = formatRatioCost(quantity, acquisitionCostCny, BigInt(item.totalQuota));
          return {
            allocatedCostCny: cost,
            costBasisStatus: cost === null ? 'missing-acquisition' as const : 'allocated' as const,
          };
        }
        return { allocatedCostCny: null, costBasisStatus: 'missing-acquisition' as const };
      };
      if (currentRemaining === 0n) {
        await persistPackageCostEvent(client, item, current.id, 'expiry-writeoff',
          -previousRemaining,
          { allocatedCostCny: null, costBasisStatus: 'missing-acquisition' }, {
            previousSnapshotId: previous.id,
            allocationEligible: false,
            ...(previousWasStale ? { timeAttributionUncertain: true } : {}),
            attribution: 'terminal-provider-zero-cannot-split-consumption-from-expiry',
          });
        return;
      }
      if (currentRemaining > previousRemaining) {
        await persistPackageCostEvent(client, item, current.id, 'adjustment',
          currentRemaining - previousRemaining,
          { allocatedCostCny: null, costBasisStatus: 'missing-acquisition' }, {
            previousSnapshotId: previous.id,
            ...(previousWasStale ? { timeAttributionUncertain: true } : {}),
            attribution: previousWasStale
              ? 'quota-increased-during-stale-gap-before-terminal'
              : 'terminal-remaining-increased-requires-review',
          });
      } else if (previousRemaining > currentRemaining) {
        await persistPackageCostEvent(client, item, current.id, 'consumption',
          -(previousRemaining - currentRemaining), allocate(previousRemaining - currentRemaining), {
            previousSnapshotId: previous.id,
            ...(previousWasStale ? { timeAttributionUncertain: true } : {}),
            attribution: previousWasStale
              ? 'consumed-during-stale-gap-before-terminal'
              : 'consumed-between-last-active-and-terminal-snapshot',
          });
      }
      await persistPackageCostEvent(client, item, current.id, 'expiry-writeoff',
        -currentRemaining, allocate(currentRemaining), {
          previousSnapshotId: previous.id,
          attribution: 'remaining-at-terminal-snapshot',
        });
      return;
    } else {
      quotaDelta = currentRemaining - previousRemaining;
      if (quotaDelta === 0n) return;
      eventType = quotaDelta < 0n ? 'consumption' : 'adjustment';
      if (previousWasStale) {
        eventEvidence = {
          timeAttributionUncertain: true,
          attribution: quotaDelta < 0n
            ? 'consumed-during-stale-gap'
            : 'quota-increased-during-stale-gap',
        };
      }
    }
    if (eventType === 'adjustment' && quotaDelta > 0n) {
      // 余量恢复会让后续同一额度再次被消费；top-up 又需要购置 tranche 才能
      // 确定新旧单位成本。两者都不能安全记成“零成本且已完整分配”。
      allocatedCostCny = null;
      costBasisStatus = 'missing-acquisition';
    } else if (acquisitionCostCny !== null && item.totalQuota > 0) {
      allocatedCostCny = formatRatioCost(
        quotaDelta < 0n ? -quotaDelta : quotaDelta,
        acquisitionCostCny,
        BigInt(item.totalQuota),
      );
      costBasisStatus = allocatedCostCny === null ? 'missing-acquisition' : 'allocated';
    } else {
      costBasisStatus = 'missing-acquisition';
    }
  }

  await persistPackageCostEvent(client, item, current.id, eventType, quotaDelta, {
    allocatedCostCny,
    costBasisStatus,
  }, { previousSnapshotId: previous?.id ?? null, ...eventEvidence });
}

async function persistPackageCostEvent(
  client: DbClient,
  item: NormalizedResourcePackage,
  snapshotId: string,
  eventType: 'opening-balance' | 'consumption' | 'expiry-writeoff' | 'adjustment',
  quotaDelta: bigint,
  allocation: {
    allocatedCostCny: string | null;
    costBasisStatus: 'allocated' | 'missing-acquisition' | 'opening-unallocated';
  },
  extraEvidence: Record<string, unknown> = {},
) {
  await client.query(
    `INSERT INTO provider_resource_package_cost_events (
       provider, package_id, source_snapshot_id, event_type, event_date,
       quota_delta, allocated_cost_cny, cost_basis_status, evidence
     ) VALUES (
       $1, $2, $3::uuid, $4, (now() AT TIME ZONE 'Asia/Shanghai')::date,
       $5, $6, $7, $8::jsonb
     )
     ON CONFLICT (provider, package_id, source_snapshot_id, event_type) DO NOTHING`,
    [
      item.provider,
      item.packageId,
      snapshotId,
      eventType,
      quotaDelta.toString(),
      allocation.allocatedCostCny,
      allocation.costBasisStatus,
      JSON.stringify({
        totalQuota: item.totalQuota,
        remainingQuota: item.remainingQuota,
        acquisitionMatched: allocation.allocatedCostCny !== null,
        normalizationVersion: BILL_NORMALIZATION_VERSION,
        ...extraEvidence,
      }),
    ],
  );
}

function isPackageExpiryStatus(status: string) {
  // Stale 仅表示一次完整列表未返回该实例，不是供应商终止证据。
  return /expired|inactive|invalid|已过期|失效|到期/i.test(status);
}

function normalizedBillDetailPayload(detail: NormalizedVolcengineBillDetail) {
  const { rawPayload: _rawPayload, ...normalized } = detail;
  return normalized;
}

function canonicalJsonStringify(value: unknown) {
  return JSON.stringify(canonicalJsonValue(value));
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJsonValue(nested)]),
  );
}

function formatRatioCost(quantity: bigint, amount: string, denominator: bigint) {
  const parsed = parseDecimal(amount);
  if (!parsed || parsed.numerator < 0n || denominator <= 0n) return null;
  const micros = divideRoundHalfUp(
    quantity * parsed.numerator * 1_000_000n,
    parsed.denominator * denominator,
  );
  return formatMicros(micros);
}

export async function generateProviderReconciliationSnapshot(
  client: DbClient,
  input: {
    billPeriod: string;
    windowStart: string;
    windowEnd: string;
    officialSyncRunId: string;
    isFinal: boolean;
  },
) {
  const periodWindow = normalizeBillWindow({ billPeriod: input.billPeriod });
  const windowStart = assertIsoDate(input.windowStart, 'windowStart');
  const windowEnd = assertIsoDate(input.windowEnd, 'windowEnd');
  if (windowStart < periodWindow.windowStart || windowEnd > periodWindow.windowEnd || windowStart > windowEnd) {
    throw new Error('对账快照窗口必须位于账期内，且开始日期不能晚于结束日期');
  }
  const isFullMonth = windowStart === periodWindow.windowStart && windowEnd === periodWindow.windowEnd;
  const localCutoff = new Date().toISOString();
  const bucketsResult = await client.query<ReconciliationBucketRow>(
     `WITH zero_cost_candidate_usage AS (
       SELECT DISTINCT ON (usage.id)
         usage.id AS usage_record_id,
         (cases.evidence->>'expenseDate')::date AS expense_date,
         cases.evidence->>'model' AS recognized_model,
         cases.evidence->>'pricingResolutionBand' AS pricing_resolution_band,
         cases.evidence->>'pricingInputClass' AS pricing_input_class,
         (cases.evidence->>'unitPricePerMillion')::numeric AS unit_price_per_million
       FROM provider_reconciliation_cases cases
       JOIN provider_reconciliation_case_links links ON links.case_id = cases.id
       JOIN provider_usage_records usage ON usage.id = links.usage_record_id
       WHERE cases.provider = $1
         AND cases.case_type = 'missing-local-usage'
         AND cases.status IN ('open', 'approved')
         AND cases.evidence->>'resolutionKind' = 'zero-cost'
         AND cases.token_adjustment = 0
         AND cases.cost_adjustment_cny = 0
         AND usage.billable_tokens IS NULL
         AND usage.model = ANY($5::text[])
         AND (cases.evidence->>'expenseDate')::date BETWEEN $2::date AND $3::date
         AND cases.evidence->>'model' IS NOT NULL
         AND cases.evidence->>'pricingResolutionBand' IS NOT NULL
         AND cases.evidence->>'pricingInputClass' IS NOT NULL
         AND cases.evidence->>'unitPricePerMillion' IS NOT NULL
       ORDER BY usage.id,
                CASE cases.status WHEN 'approved' THEN 0 ELSE 1 END,
                cases.created_at DESC,
                cases.id DESC
     ), local_usage_rows AS (
       SELECT
         coalesce(
           usage.local_accounting_date,
           (coalesce(usage.completed_at, usage.created_at) AT TIME ZONE 'Asia/Shanghai')::date
         ) AS expense_date,
         'ark_bd'::text AS product,
         usage.model AS recognized_model,
         CASE
           WHEN usage.billable_tokens IS NULL
             OR usage.pricing_rule_status <> 'priced'
             OR usage.unit_price_per_million IS NULL THEN 'unknown'
           WHEN usage.pricing_resolution_band IN ('480p-720p', '480p/720p') THEN '480p-720p'
           WHEN usage.pricing_resolution_band IN ('1080p', '4k') THEN usage.pricing_resolution_band
           WHEN lower(coalesce(usage.resolution, '')) IN ('480p', '720p') THEN '480p-720p'
           WHEN lower(coalesce(usage.resolution, '')) IN ('1080p', '4k') THEN lower(usage.resolution)
           ELSE 'unknown'
         END AS pricing_resolution_band,
         CASE
           WHEN usage.billable_tokens IS NULL
             OR usage.pricing_rule_status <> 'priced'
             OR usage.unit_price_per_million IS NULL THEN 'unknown'
           WHEN usage.pricing_input_class IN ('with-video', 'without-video') THEN usage.pricing_input_class
           WHEN usage.has_video_input THEN 'with-video'
           WHEN usage.resolution IS NOT NULL THEN 'without-video'
           ELSE 'unknown'
         END AS pricing_input_class,
         CASE
           WHEN usage.billable_tokens IS NULL OR usage.pricing_rule_status <> 'priced' THEN NULL
           ELSE usage.unit_price_per_million
         END AS unit_price_per_million,
         usage.currency,
         CASE WHEN usage.usage_evidence_origin <> 'official-bill-inferred' THEN coalesce(usage.billable_tokens, 0) ELSE 0 END::bigint AS raw_local_tokens,
         CASE WHEN usage.usage_evidence_origin <> 'official-bill-inferred' THEN coalesce(usage.estimated_cost, 0) ELSE 0 END::numeric(20,6) AS raw_local_cost_cny,
         CASE WHEN usage.usage_evidence_origin = 'official-bill-inferred' THEN coalesce(usage.billable_tokens, 0) ELSE 0 END::bigint AS inferred_adjustment_tokens,
         CASE WHEN usage.usage_evidence_origin = 'official-bill-inferred' THEN coalesce(usage.estimated_cost, 0) ELSE 0 END::numeric(20,6) AS inferred_adjustment_cost_cny,
         0::bigint AS zero_cost_candidate_count
       FROM provider_usage_records usage
       WHERE usage.provider = $1
         AND usage.model = ANY($5::text[])
         AND usage.usage_unit = 'tokens'
         AND usage.currency = 'CNY'
         AND coalesce(
           usage.local_accounting_date,
           (coalesce(usage.completed_at, usage.created_at) AT TIME ZONE 'Asia/Shanghai')::date
         ) BETWEEN $2::date AND $3::date
         AND NOT EXISTS (
           SELECT 1
           FROM zero_cost_candidate_usage candidate
           WHERE candidate.usage_record_id = usage.id
         )

       UNION ALL

       SELECT candidate.expense_date, 'ark_bd'::text, candidate.recognized_model,
              candidate.pricing_resolution_band, candidate.pricing_input_class,
              candidate.unit_price_per_million, 'CNY'::text,
              0::bigint, 0::numeric(20,6), 0::bigint, 0::numeric(20,6), 1::bigint
       FROM zero_cost_candidate_usage candidate
     ), local_usage AS (
       SELECT expense_date, product, recognized_model, pricing_resolution_band,
              pricing_input_class, unit_price_per_million, currency,
              sum(raw_local_tokens)::bigint AS raw_local_tokens,
              sum(raw_local_cost_cny)::numeric(20,6) AS raw_local_cost_cny,
              sum(inferred_adjustment_tokens)::bigint AS inferred_adjustment_tokens,
              sum(inferred_adjustment_cost_cny)::numeric(20,6) AS inferred_adjustment_cost_cny,
              sum(zero_cost_candidate_count)::bigint AS zero_cost_candidate_count
       FROM local_usage_rows
       GROUP BY 1, 2, 3, 4, 5, 6, 7
     ), official_usage AS (
       SELECT
         expense_date,
         product,
         recognized_model,
         CASE
           WHEN pricing_resolution IN ('480p', '720p', '480p/720p') THEN '480p-720p'
           WHEN pricing_resolution IN ('1080p', '4k') THEN pricing_resolution
           ELSE 'unknown'
         END AS pricing_resolution_band,
         CASE
           WHEN pricing_input_has_video IS true THEN 'with-video'
           WHEN pricing_input_has_video IS false THEN 'without-video'
           ELSE 'unknown'
         END AS pricing_input_class,
         normalized_unit_price_per_million AS unit_price_per_million,
         currency,
         sum(coalesce(billable_tokens, 0))::bigint AS official_tokens,
         sum(coalesce(list_equivalent_cost_cny, 0))::numeric(20,6) AS official_cost_cny
       FROM provider_bill_details
       WHERE provider = $1
         AND bill_period = $4
         AND expense_date BETWEEN $2::date AND $3::date
         AND active = true
         AND product = 'ark_bd'
         AND bill_line_type = 'usage'
         AND (
           recognized_model = ANY($5::text[])
           OR (
             recognized_model IS NULL
             AND lower(concat_ws(' ', config_name, configuration_code, element_code, factor_code)) LIKE '%seedance%'
           )
         )
       GROUP BY 1, 2, 3, 4, 5, 6, 7
     )
     SELECT
       coalesce(local_usage.expense_date, official_usage.expense_date) AS expense_date,
       coalesce(local_usage.product, official_usage.product) AS product,
       coalesce(local_usage.recognized_model, official_usage.recognized_model) AS recognized_model,
       coalesce(local_usage.pricing_resolution_band, official_usage.pricing_resolution_band, 'unknown') AS pricing_resolution_band,
       coalesce(local_usage.pricing_input_class, official_usage.pricing_input_class, 'unknown') AS pricing_input_class,
       coalesce(local_usage.unit_price_per_million, official_usage.unit_price_per_million)::text AS unit_price_per_million,
       coalesce(local_usage.currency, official_usage.currency, 'CNY') AS currency,
       coalesce(local_usage.raw_local_tokens, 0)::text AS raw_local_tokens,
       coalesce(local_usage.raw_local_cost_cny, 0)::text AS raw_local_cost_cny,
       coalesce(local_usage.inferred_adjustment_tokens, 0)::text AS inferred_adjustment_tokens,
       coalesce(local_usage.inferred_adjustment_cost_cny, 0)::text AS inferred_adjustment_cost_cny,
       coalesce(official_usage.official_tokens, 0)::text AS official_tokens,
       coalesce(official_usage.official_cost_cny, 0)::text AS official_cost_cny,
       coalesce(local_usage.zero_cost_candidate_count, 0)::text AS zero_cost_candidate_count
     FROM local_usage
     FULL OUTER JOIN official_usage
       ON local_usage.expense_date = official_usage.expense_date
      AND local_usage.product = official_usage.product
      AND local_usage.recognized_model IS NOT DISTINCT FROM official_usage.recognized_model
      AND local_usage.pricing_resolution_band = official_usage.pricing_resolution_band
      AND local_usage.pricing_input_class = official_usage.pricing_input_class
      AND local_usage.unit_price_per_million IS NOT DISTINCT FROM official_usage.unit_price_per_million
      AND local_usage.currency = official_usage.currency
     ORDER BY 1, 2, 3, 4, 5, 6 NULLS LAST, 7`,
    [PROVIDER, windowStart, windowEnd, input.billPeriod, [...SEEDANCE_COST_MODEL_LABELS]],
  );
  const buckets = bucketsResult.rows;
  const rawTokens = sumBucketTokens(buckets, 'raw_local_tokens');
  const adjustmentTokens = sumBucketTokens(buckets, 'inferred_adjustment_tokens');
  const officialTokens = sumBucketTokens(buckets, 'official_tokens');
  const adjustedTokens = rawTokens + adjustmentTokens;
  const residualTokens = officialTokens - adjustedTokens;
  const rawCostMicros = sumBucketCostMicros(buckets, 'raw_local_cost_cny');
  const adjustmentCostMicros = sumBucketCostMicros(buckets, 'inferred_adjustment_cost_cny');
  const officialCostMicros = sumBucketCostMicros(buckets, 'official_cost_cny');
  const adjustedCostMicros = rawCostMicros + adjustmentCostMicros;
  const residualCostMicros = officialCostMicros - adjustedCostMicros;
  const officialRevisions = await client.query<{
    source_detail_key: string;
    payload_hash: string;
  }>(
    `SELECT items.source_detail_key, revisions.payload_hash
     FROM provider_bill_sync_run_items items
     JOIN provider_bill_detail_revisions revisions
       ON revisions.id = items.bill_detail_revision_id
     WHERE items.sync_run_id = $1::uuid
       AND revisions.normalized_payload->>'product' = 'ark_bd'
       AND revisions.normalized_payload->>'billLineType' = 'usage'
       AND (
         revisions.normalized_payload->>'recognizedModel' = ANY($2::text[])
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
     ORDER BY items.source_detail_key`,
    [input.officialSyncRunId, [...SEEDANCE_COST_MODEL_LABELS]],
  );
  // revision payload hash 覆盖原始和标准化账单，包括 Payable/Paid/Unpaid；
  // 即使 Token 不变，财务金额修订也会触发账期 reopened。
  const officialSnapshotHash = sha256Hex(canonicalJsonStringify(officialRevisions.rows));
  const localSnapshotHash = sha256Hex(canonicalJsonStringify(buckets
    .filter(bucket =>
      BigInt(bucket.raw_local_tokens) !== 0n
      || BigInt(bucket.inferred_adjustment_tokens) !== 0n
      || decimalToMicros(bucket.raw_local_cost_cny) !== 0n
      || decimalToMicros(bucket.inferred_adjustment_cost_cny) !== 0n
      || BigInt(bucket.zero_cost_candidate_count ?? '0') !== 0n)
    .map(bucket => ({
    expenseDate: normalizeDateValue(bucket.expense_date),
    product: bucket.product,
    model: bucket.recognized_model,
    resolution: bucket.pricing_resolution_band,
    inputClass: bucket.pricing_input_class,
    unitPrice: bucket.unit_price_per_million,
    currency: bucket.currency,
    rawTokens: bucket.raw_local_tokens,
    rawCost: bucket.raw_local_cost_cny,
    adjustmentTokens: bucket.inferred_adjustment_tokens,
    adjustmentCost: bucket.inferred_adjustment_cost_cny,
    zeroCostCandidateCount: bucket.zero_cost_candidate_count ?? '0',
    }))));
  const prior = await client.query<{
    bill_state: string;
    official_snapshot_hash: string;
    created_at: Date | string;
  }>(
    `SELECT bill_state, official_snapshot_hash, created_at
     FROM provider_reconciliation_runs
     WHERE provider = $1 AND bill_period = $2
       AND window_start = $3::date AND window_end = $4::date
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [PROVIDER, input.billPeriod, windowStart, windowEnd],
  );
  const previous = prior.rows[0];
  const sameOfficialSnapshot = previous?.official_snapshot_hash === officialSnapshotHash;
  const previousAgeMs = previous
    ? Date.now() - new Date(previous.created_at).getTime()
    : 0;
  const billState = previous?.bill_state === 'final'
    ? sameOfficialSnapshot ? 'final' : 'reopened'
    : input.isFinal && sameOfficialSnapshot && previousAgeMs >= 24 * 60 * 60 * 1000
      ? 'final'
      : 'provisional';
  const comparable = buckets.every(bucket =>
    bucket.recognized_model !== null
    && bucket.pricing_resolution_band !== 'unknown'
    && bucket.pricing_input_class !== 'unknown'
    && bucket.unit_price_per_million !== null);
  const hasComparableEvidence = buckets.length > 0;
  const matchState = !comparable || !hasComparableEvidence
    ? 'cannot-reconcile'
    : rawTokens === officialTokens && rawCostMicros === officialCostMicros
      ? 'raw-matched'
      : residualTokens === 0n && residualCostMicros === 0n
        ? 'adjusted-matched'
        : 'residual';
  const coverageState = comparable && (
    (officialTokens > 0n && adjustedTokens > 0n)
    || (input.isFinal && isFullMonth && hasComparableEvidence)
  )
    ? 'complete'
    : 'partial';

  const run = await client.query<{ id: string }>(
    `INSERT INTO provider_reconciliation_runs (
       provider, bill_period, window_start, window_end, official_sync_run_id,
       local_cutoff, normalization_version, official_snapshot_hash,
       local_snapshot_hash, bill_state, match_state, coverage_state,
       raw_local_tokens, raw_local_cost_cny, inferred_adjustment_tokens,
       inferred_adjustment_cost_cny, adjusted_local_tokens,
       adjusted_local_cost_cny, official_tokens, official_cost_cny,
       residual_tokens, residual_cost_cny, created_at
     ) VALUES (
       $1, $2, $3::date, $4::date, $5::uuid, $6::timestamptz, $7, $8,
       $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
       $21, $22, now()
     )
     RETURNING id::text`,
    [
      PROVIDER,
      input.billPeriod,
      windowStart,
      windowEnd,
      input.officialSyncRunId,
      localCutoff,
      BILL_NORMALIZATION_VERSION,
      officialSnapshotHash,
      localSnapshotHash,
      billState,
      matchState,
      coverageState,
      rawTokens.toString(),
      formatMicros(rawCostMicros),
      adjustmentTokens.toString(),
      formatMicros(adjustmentCostMicros),
      adjustedTokens.toString(),
      formatMicros(adjustedCostMicros),
      officialTokens.toString(),
      formatMicros(officialCostMicros),
      residualTokens.toString(),
      formatMicros(residualCostMicros),
    ],
  );
  const reconciliationRunId = run.rows[0]?.id;
  if (!reconciliationRunId) return null;

  for (const bucket of buckets) {
    const bucketRawTokens = BigInt(bucket.raw_local_tokens);
    const bucketAdjustmentTokens = BigInt(bucket.inferred_adjustment_tokens);
    const bucketOfficialTokens = BigInt(bucket.official_tokens);
    const bucketAdjustedTokens = bucketRawTokens + bucketAdjustmentTokens;
    const bucketResidualTokens = bucketOfficialTokens - bucketAdjustedTokens;
    const bucketRawCost = decimalToMicros(bucket.raw_local_cost_cny);
    const bucketAdjustmentCost = decimalToMicros(bucket.inferred_adjustment_cost_cny);
    const bucketOfficialCost = decimalToMicros(bucket.official_cost_cny);
    const bucketAdjustedCost = bucketRawCost + bucketAdjustmentCost;
    const bucketResidualCost = bucketOfficialCost - bucketAdjustedCost;
    const bucketComparable = bucket.recognized_model !== null
      && bucket.pricing_resolution_band !== 'unknown'
      && bucket.pricing_input_class !== 'unknown'
      && bucket.unit_price_per_million !== null;
    const status = !bucketComparable
      ? 'not-comparable'
      : bucketRawTokens === bucketOfficialTokens && bucketRawCost === bucketOfficialCost
        ? 'raw-matched'
        : bucketResidualTokens === 0n && bucketResidualCost === 0n
          ? 'adjusted-matched'
          : 'residual';
    await client.query(
      `INSERT INTO provider_reconciliation_buckets (
         reconciliation_run_id, provider, bill_period, expense_date,
         bill_line_type, product, recognized_model, pricing_resolution_band,
         pricing_input_class, unit_price_per_million, currency,
         raw_local_tokens, raw_local_cost_cny, inferred_adjustment_tokens,
         inferred_adjustment_cost_cny, adjusted_local_tokens,
         adjusted_local_cost_cny, official_tokens, official_cost_cny,
         timing_adjustment_tokens, timing_adjustment_cost_cny,
         rate_variance_cny, rounding_variance_cny, residual_tokens,
         residual_cost_cny, status
       ) VALUES (
         $1::uuid, $2, $3, $4::date, 'usage', $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, $18, 0, 0, NULL, NULL, $19, $20, $21
       )`,
      [
        reconciliationRunId,
        PROVIDER,
        input.billPeriod,
        normalizeDateValue(bucket.expense_date),
        bucket.product,
        bucket.recognized_model,
        bucket.pricing_resolution_band,
        bucket.pricing_input_class,
        bucket.unit_price_per_million,
        bucket.currency,
        bucketRawTokens.toString(),
        formatMicros(bucketRawCost),
        bucketAdjustmentTokens.toString(),
        formatMicros(bucketAdjustmentCost),
        bucketAdjustedTokens.toString(),
        formatMicros(bucketAdjustedCost),
        bucketOfficialTokens.toString(),
        formatMicros(bucketOfficialCost),
        bucketResidualTokens.toString(),
        formatMicros(bucketResidualCost),
        status,
      ],
    );
  }
  return reconciliationRunId;
}

/**
 * 审核由历史迁移或确定性 4xx 退款事务建立的零成本候选。审批依赖完整月终账，
 * 而不是任务错误文本：
 * 目标 usage 仍无正用量、官方账期稳定为 final、覆盖完整且对应计价桶残差为零。
 */
export async function reviewFinalBillZeroCostCases(
  client: DbClient,
  reconciliationRunId: string,
): Promise<ZeroCostCaseReviewResult> {
  const emptyResult: ZeroCostCaseReviewResult = {
    reviewed: 0,
    approved: 0,
    reopened: 0,
    superseded: 0,
    metadataUpdated: 0,
  };
  const runResult = await client.query<ZeroCostReviewRunRow>(
    `SELECT
       runs.id::text,
       runs.bill_period,
       runs.window_start,
       runs.window_end,
       runs.bill_state,
       runs.coverage_state,
       runs.official_snapshot_hash,
       sync_runs.is_final AS official_sync_is_final
     FROM provider_reconciliation_runs runs
     JOIN provider_billing_sync_runs sync_runs
       ON sync_runs.id = runs.official_sync_run_id
     WHERE runs.id = $1::uuid`,
    [reconciliationRunId],
  );
  const run = runResult.rows[0];
  if (!run) throw new Error(`零成本案件审核找不到对账快照：${reconciliationRunId}`);

  const windowStart = toIsoDate(run.window_start);
  const windowEnd = toIsoDate(run.window_end);
  const isFullMonth = windowStart === `${run.bill_period}-01`
    && windowEnd === lastDayOfMonth(run.bill_period);
  // 日账单与当月截至今日的观察都不能改变历史终账结论。
  if (!isFullMonth) return emptyResult;

  const candidateRows = await client.query<ZeroCostCaseLinkRow>(
    `SELECT
       cases.id::text AS case_id,
       cases.case_key,
       cases.status AS case_status,
       cases.evidence,
       links.id::text AS link_id,
       usage.id::text AS usage_record_id,
       usage.completion_tokens::text,
       usage.total_tokens::text,
       usage.billable_tokens::text,
       usage.estimated_cost::text,
       usage.usage_evidence_origin
     FROM provider_reconciliation_cases cases
     LEFT JOIN provider_reconciliation_case_links links
       ON links.case_id = cases.id
     LEFT JOIN provider_usage_records usage
       ON usage.id = links.usage_record_id
     WHERE cases.provider = $1
       AND cases.bill_period = $2
       AND cases.case_type = 'missing-local-usage'
       AND cases.evidence->>'resolutionKind' = 'zero-cost'
     ORDER BY cases.id, links.id NULLS LAST`,
    [PROVIDER, run.bill_period],
  );
  const rowsByCase = new Map<string, ZeroCostCaseLinkRow[]>();
  for (const row of candidateRows.rows) {
    const rows = rowsByCase.get(row.case_id) ?? [];
    rows.push(row);
    rowsByCase.set(row.case_id, rows);
  }

  const result = { ...emptyResult, reviewed: rowsByCase.size };
  for (const rows of rowsByCase.values()) {
    const first = rows[0]!;
    const evidence = isRecord(first.evidence) ? first.evidence : {};
    const expectedUsageRecordId = typeof evidence.usageRecordId === 'string'
      ? evidence.usageRecordId
      : null;
    const linkedUsage = rows.length === 1
      && first.link_id !== null
      && first.usage_record_id === expectedUsageRecordId
      ? first
      : null;
    const hasRecordedUsage = linkedUsage ? zeroCostCandidateHasRecordedUsage(linkedUsage) : false;

    let desiredStatus: ZeroCostCaseLinkRow['case_status'] = 'open';
    let reviewStatus = 'pending-final-bill';
    let reason = '官方最终账单尚未满足自动确认条件';
    let residualTokens = '0';
    let residualCostCny = '0.000000';

    if (!linkedUsage) {
      reviewStatus = 'unresolved';
      reason = rows.length === 1
        ? '零成本案件缺少唯一且匹配的 usage 证据链接'
        : `零成本案件存在 ${rows.length} 条证据链接，必须保持唯一`;
    } else if (hasRecordedUsage) {
      desiredStatus = 'superseded';
      reviewStatus = 'superseded-by-recorded-usage';
      reason = '目标 usage 已获得供应商用量或成本证据，零成本候选已失效';
    } else if (!run.official_sync_is_final || run.bill_state !== 'final') {
      reviewStatus = run.bill_state === 'reopened' ? 'reopened' : 'pending-final-bill';
      reason = run.bill_state === 'reopened'
        ? '官方最终账单发生修订，零成本结论已重新打开'
        : '官方账单尚未形成稳定 final 快照';
    } else if (run.coverage_state !== 'complete') {
      reviewStatus = 'reopened';
      reason = '官方账单覆盖不完整，不能确认零成本';
    } else {
      const dimensions = zeroCostEvidenceDimensions(evidence);
      if (!dimensions || dimensions.billPeriod !== run.bill_period) {
        reviewStatus = 'unresolved';
        reason = '零成本案件缺少完整或一致的受审计价桶维度';
      } else {
        const bucketResult = await client.query<ZeroCostBucketReviewRow>(
          `SELECT
             count(*)::text AS bucket_count,
             coalesce(sum(residual_tokens), 0)::text AS residual_tokens,
             coalesce(sum(residual_cost_cny), 0)::numeric(20,6)::text AS residual_cost_cny,
             coalesce(bool_and(status IN ('raw-matched', 'adjusted-matched')), false) AS all_comparable
           FROM provider_reconciliation_buckets
           WHERE reconciliation_run_id = $1::uuid
             AND provider = $2
             AND bill_period = $3
             AND expense_date = $4::date
             AND bill_line_type = 'usage'
             AND product = 'ark_bd'
             AND recognized_model = $5
             AND pricing_resolution_band = $6
             AND pricing_input_class = $7
             AND unit_price_per_million IS NOT DISTINCT FROM $8::numeric
             AND currency = 'CNY'`,
          [
            reconciliationRunId,
            PROVIDER,
            dimensions.billPeriod,
            dimensions.expenseDate,
            dimensions.model,
            dimensions.pricingResolutionBand,
            dimensions.pricingInputClass,
            dimensions.unitPricePerMillion,
          ],
        );
        const bucket = bucketResult.rows[0];
        residualTokens = bucket?.residual_tokens ?? '0';
        residualCostCny = bucket?.residual_cost_cny ?? '0.000000';
        const matched = bucket?.bucket_count === '1'
          && bucket.all_comparable
          && BigInt(residualTokens) === 0n
          && isZeroDecimal(residualCostCny);
        if (matched) {
          desiredStatus = 'approved';
          reviewStatus = 'approved-zero';
          reason = '最终账单覆盖完整，相关日期、模型和计价桶 Token/金额残差均为零';
        } else {
          reviewStatus = 'reopened';
          reason = bucket?.bucket_count !== '1'
            ? `相关计价桶数量为 ${bucket?.bucket_count ?? '0'}，无法唯一确认`
            : '相关计价桶仍有 Token、金额残差或不可比维度';
        }
      }
    }

    const previousReview = isRecord(evidence.review) ? evidence.review : {};
    const nextReviewCore = {
      status: reviewStatus,
      reason,
      reconciliationRunId,
      billState: run.bill_state,
      coverageState: run.coverage_state,
      residualTokens,
      residualCostCny,
      officialSnapshotHash: run.official_snapshot_hash,
    };
    const statusChanged = desiredStatus !== first.case_status;
    const reviewChanged = Object.entries(nextReviewCore).some(
      ([key, value]) => previousReview[key] !== value,
    );
    if (!statusChanged && !reviewChanged) continue;

    const reviewedAt = new Date().toISOString();
    const nextEvidence = {
      ...evidence,
      review: { ...nextReviewCore, reviewedAt },
    };
    const updated = await client.query(
      `UPDATE provider_reconciliation_cases
       SET status = $2,
           evidence = $3::jsonb
       WHERE id = $1::uuid
         AND status = $4`,
      [first.case_id, desiredStatus, JSON.stringify(nextEvidence), first.case_status],
    );
    if (updated.rowCount !== 1) {
      throw new Error(`零成本案件并发更新失败：${first.case_key}`);
    }
    result.metadataUpdated += 1;

    if (!statusChanged) continue;
    if (desiredStatus === 'approved') result.approved += 1;
    else if (desiredStatus === 'superseded') result.superseded += 1;
    else if (first.case_status === 'approved') result.reopened += 1;

    const action = desiredStatus === 'approved'
      ? '确认历史任务零成本'
      : desiredStatus === 'superseded'
        ? '废止历史零成本候选'
        : '重开历史零成本案件';
    const auditDetail = canonicalJsonStringify({
      version: '2026-07-15-v1',
      caseId: first.case_id,
      caseKey: first.case_key,
      taskId: evidence.taskId ?? null,
      usageRecordId: evidence.usageRecordId ?? null,
      previousStatus: first.case_status,
      newStatus: desiredStatus,
      review: nextReviewCore,
      reviewedAt,
      protectedFieldsUnchanged: [
        'completion_tokens', 'total_tokens', 'billable_tokens',
        'estimated_cost', 'task_status', 'credit_status',
      ],
    });
    await client.query(
      `INSERT INTO audit_logs (
         admin_user_id, admin_email, module, action, target, risk, detail
       )
       SELECT NULL, 'system@lindyson.local', 'API成本与用量', $1, $2, 'high', $3
       WHERE NOT EXISTS (
         SELECT 1
         FROM audit_logs
         WHERE module = 'API成本与用量'
           AND action = $1
           AND target = $2
           AND risk = 'high'
           AND detail = $3
       )`,
      [action, first.case_key, auditDetail],
    );
  }
  return result;
}

function zeroCostCandidateHasRecordedUsage(row: ZeroCostCaseLinkRow) {
  if (row.usage_evidence_origin === 'provider-reported') return true;
  return [row.completion_tokens, row.total_tokens, row.billable_tokens]
    .some(value => value !== null && BigInt(value) > 0n)
    || (row.estimated_cost !== null && !isZeroDecimal(row.estimated_cost));
}

function zeroCostEvidenceDimensions(evidence: Record<string, unknown>) {
  const billPeriod = typeof evidence.billPeriod === 'string' ? evidence.billPeriod : null;
  const expenseDate = typeof evidence.expenseDate === 'string' ? evidence.expenseDate : null;
  const model = typeof evidence.model === 'string' ? evidence.model : null;
  const pricingResolutionBand = typeof evidence.pricingResolutionBand === 'string'
    ? evidence.pricingResolutionBand
    : null;
  const pricingInputClass = typeof evidence.pricingInputClass === 'string'
    ? evidence.pricingInputClass
    : null;
  const unitPricePerMillion = typeof evidence.unitPricePerMillion === 'string'
    ? evidence.unitPricePerMillion
    : null;
  if (
    !billPeriod || !/^\d{4}-\d{2}$/.test(billPeriod)
    || !expenseDate || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)
    || !model || !pricingResolutionBand || !pricingInputClass
    || !unitPricePerMillion || parseDecimal(unitPricePerMillion) === null
  ) return null;
  return {
    billPeriod,
    expenseDate,
    model,
    pricingResolutionBand,
    pricingInputClass,
    unitPricePerMillion,
  };
}

function sumBucketTokens(
  buckets: ReconciliationBucketRow[],
  key: 'raw_local_tokens' | 'inferred_adjustment_tokens' | 'official_tokens',
) {
  return buckets.reduce((sum, bucket) => sum + BigInt(bucket[key]), 0n);
}

function sumBucketCostMicros(
  buckets: ReconciliationBucketRow[],
  key: 'raw_local_cost_cny' | 'inferred_adjustment_cost_cny' | 'official_cost_cny',
) {
  return buckets.reduce((sum, bucket) => sum + decimalToMicros(bucket[key]), 0n);
}

function decimalToMicros(value: string) {
  const parsed = parseDecimal(value);
  if (!parsed) throw new Error(`无法解析六位人民币金额：${value}`);
  return divideRoundHalfAwayFromZero(parsed.numerator * 1_000_000n, parsed.denominator);
}

export function mapVolcengineBalance(response: Record<string, unknown>): NormalizedVolcengineBalance {
  const result = getByPath(response, 'Result');
  if (!isRecord(result)) throw new Error('QueryBalanceAcct 未返回 Result');
  return {
    provider: PROVIDER,
    accountId: firstString(result, ['AccountID']) ?? null,
    availableBalanceCny: requiredDecimal(result, 'AvailableBalance'),
    cashBalanceCny: requiredDecimal(result, 'CashBalance'),
    frozenAmountCny: requiredDecimal(result, 'FreezeAmount'),
    arrearsBalanceCny: requiredDecimal(result, 'ArrearsBalance'),
    creditLimitCny: requiredDecimal(result, 'CreditLimit'),
    currency: 'CNY',
    requestId: extractRequestId(response),
  };
}

export function mapVolcengineBillDetail(raw: Record<string, unknown>): NormalizedVolcengineBillDetail | null {
  const product = firstString(raw, ['Product']);
  const billPeriod = firstString(raw, ['BillPeriod']);
  const expenseDate = normalizeIsoDateValue(getByPath(raw, 'ExpenseDate'));
  if (!product || !billPeriod || !/^\d{4}-\d{2}$/.test(billPeriod) || !expenseDate) return null;
  if (!expenseDate.startsWith(`${billPeriod}-`)) return null;

  const pricing = normalizeText(product) === BILLING_PRODUCT
    ? recognizeBillPricing(raw)
    : { recognizedModel: null, resolution: null, hasVideoInput: null, unitPricePerMillion: null };
  const usageCount = decimalString(getByPath(raw, 'Count'));
  const usageUnit = firstString(raw, ['Unit']) ?? null;
  const seedanceCandidate = normalizeText(product) === BILLING_PRODUCT
    && (pricing.recognizedModel !== null || isSeedanceCandidateBillLine(raw));
  const billableTokens = seedanceCandidate ? billableTokenString(usageCount, usageUnit) : null;
  const listEquivalentCostCny = billableTokens && pricing.unitPricePerMillion !== null
    ? formatTokenCost(billableTokens, pricing.unitPricePerMillion)
    : null;
  const billLineType = classifyVolcengineBillLine(raw, {
    recognizedModel: pricing.recognizedModel,
    billableTokens,
  });

  return {
    provider: PROVIDER,
    sourceDetailKey: sourceDetailKey(raw),
    payerId: firstString(raw, ['PayerID']) ?? null,
    billPeriod,
    expenseDate,
    product: product!,
    productZh: firstString(raw, ['ProductZh']) ?? null,
    billingMode: firstString(raw, ['BillingMode']) ?? null,
    billCategory: firstString(raw, ['BillCategory']) ?? null,
    instanceNo: firstString(raw, ['InstanceNo']) ?? null,
    configName: firstString(raw, ['ConfigName']) ?? null,
    elementCode: firstString(raw, ['ElementCode']) ?? null,
    configurationCode: firstString(raw, ['ConfigurationCode']) ?? null,
    factorCode: firstString(raw, ['FactorCode']) ?? null,
    project: firstString(raw, ['Project']) ?? null,
    tag: normalizeJsonValue(getByPath(raw, 'Tag')),
    price: decimalString(getByPath(raw, 'Price')),
    priceUnit: firstString(raw, ['PriceUnit']) ?? null,
    usageCount,
    usageUnit,
    // DeductionCount 是资源包抵扣证据，可能在换算为 token 后仍有小数。
    // 原始 DeductionCount/Unit 仍完整保留在 raw_payload；缺失或非法时保持 NULL，不从 Count 回填。
    deductionCount: deductedTokenString(
      decimalString(getByPath(raw, 'DeductionCount')),
      usageUnit,
    ),
    originalBillAmountCny: decimalString(getByPath(raw, 'OriginalBillAmount')),
    preferentialBillAmountCny: decimalString(getByPath(raw, 'PreferentialBillAmount')),
    discountBillAmountCny: decimalString(getByPath(raw, 'DiscountBillAmount')),
    couponAmountCny: decimalString(getByPath(raw, 'CouponAmount')),
    payableAmountCny: decimalString(getByPath(raw, 'PayableAmount')),
    paidAmountCny: decimalString(getByPath(raw, 'PaidAmount')),
    unpaidAmountCny: decimalString(getByPath(raw, 'UnpaidAmount')),
    roundAmountCny: decimalString(getByPath(raw, 'RoundAmount')),
    currency: firstString(raw, ['Currency']) ?? 'CNY',
    settlementType: firstString(raw, ['SettlementType']) ?? null,
    recognizedModel: pricing.recognizedModel,
    seedanceCandidate,
    pricingResolution: pricing.resolution,
    pricingInputHasVideo: pricing.hasVideoInput,
    billableTokens,
    listEquivalentCostCny,
    billLineType,
    normalizedUnitPricePerMillion: pricing.unitPricePerMillion,
    normalizationVersion: BILL_NORMALIZATION_VERSION,
    rawPayload: raw,
  };
}

export function classifyVolcengineBillLine(
  raw: Record<string, unknown>,
  pricing: { recognizedModel: string | null; billableTokens: string | null },
): NormalizedVolcengineBillDetail['billLineType'] {
  const text = normalizeText([
    firstString(raw, ['BillCategory']),
    firstString(raw, ['BillingMode']),
    firstString(raw, ['ConfigName']),
    firstString(raw, ['ConfigurationCode']),
    firstString(raw, ['SettlementType']),
  ].filter(Boolean).join(' '));
  if (/(退款|退订|refund)/i.test(text)) return 'refund';
  if (/(调账|调整|adjust)/i.test(text)) return 'adjustment';
  if (/(新购|购买|purchase)/i.test(text)
    || (/(预付|prepaid)/i.test(text) && /(资源包|package|pack_)/i.test(text))) {
    return 'package-purchase';
  }
  const billCategory = normalizeText(firstString(raw, ['BillCategory']));
  if (billCategory === '消费-使用' || billCategory === 'consume-use') return 'usage';
  if (pricing.recognizedModel && pricing.billableTokens !== null) return 'usage';
  if (decimalString(getByPath(raw, 'Count')) !== null && firstString(raw, ['Unit'])) return 'usage';
  return 'other';
}

function isSeedanceCandidateBillLine(raw: Record<string, unknown>) {
  return /seedance/i.test([
    firstString(raw, ['ConfigName']),
    firstString(raw, ['ConfigurationCode']),
    firstString(raw, ['Element']),
    firstString(raw, ['ElementCode']),
    firstString(raw, ['Factor']),
    firstString(raw, ['FactorCode']),
  ].filter(Boolean).join(' '));
}

export function normalizeVolcengineBillDetails(
  items: Record<string, unknown>[],
  expectedWindow?: Pick<BillWindow, 'billPeriod' | 'expenseDate' | 'windowStart' | 'windowEnd'>,
) {
  const normalized: NormalizedVolcengineBillDetail[] = [];
  const seenKeys = new Set<string>();
  for (const [index, item] of items.entries()) {
    const detail = mapVolcengineBillDetail(item);
    if (!detail) throw new Error(`账单第 ${index + 1} 行缺少 Product、BillPeriod 或 ExpenseDate`);
    validateNormalizedBillDetail(detail, index + 1);
    if (expectedWindow && (
      detail.billPeriod !== expectedWindow.billPeriod
      || detail.expenseDate < expectedWindow.windowStart
      || detail.expenseDate > expectedWindow.windowEnd
      || (expectedWindow.expenseDate !== undefined && detail.expenseDate !== expectedWindow.expenseDate)
    )) {
      throw new Error(`账单第 ${index + 1} 行超出请求窗口`);
    }
    if (seenKeys.has(detail.sourceDetailKey)) {
      throw new Error(`账单响应包含重复 sourceDetailKey：${detail.sourceDetailKey}`);
    }
    seenKeys.add(detail.sourceDetailKey);
    normalized.push(detail);
  }
  return normalized;
}

function validateNormalizedBillDetail(detail: NormalizedVolcengineBillDetail, rowNumber: number) {
  if (detail.currency === 'CNY') {
    const requiredAmounts: Array<[string, string | null]> = [
      ['OriginalBillAmount', detail.originalBillAmountCny],
      ['PayableAmount', detail.payableAmountCny],
      ['PaidAmount', detail.paidAmountCny],
      ['UnpaidAmount', detail.unpaidAmountCny],
    ];
    const missing = requiredAmounts.filter(([, value]) => value === null).map(([field]) => field);
    if (missing.length > 0) {
      throw new Error(`账单第 ${rowNumber} 行 CNY 核心金额缺失或非法：${missing.join(', ')}`);
    }
  }
  if (detail.product === BILLING_PRODUCT && detail.seedanceCandidate
    && !['package-purchase', 'refund', 'adjustment'].includes(detail.billLineType)) {
    if (detail.billLineType !== 'usage' || detail.billableTokens === null) {
      throw new Error(`账单第 ${rowNumber} 行 Seedance 候选用量无法将 Count/Unit 归一为 Token`);
    }
  }
}

function recognizeBillPricing(raw: Record<string, unknown>) {
  const text = [
    firstString(raw, ['ConfigName']),
    firstString(raw, ['ConfigurationCode']),
    firstString(raw, ['Element']),
    firstString(raw, ['ElementCode']),
    firstString(raw, ['Factor']),
    firstString(raw, ['FactorCode']),
    firstString(raw, ['InstanceName']),
  ].filter(Boolean).join(' ');
  const recognizedModel = recognizeResourcePackageModel(text);
  if (!recognizedModel) {
    return { recognizedModel: null, resolution: null, hasVideoInput: null, unitPricePerMillion: null };
  }

  const explicitResolution = resolutionFromText(text);
  const explicitVideo = videoInputFromText(text);
  const pricePerMillion = normalizePricePerMillion(
    decimalString(getByPath(raw, 'Price')),
    firstString(raw, ['PriceUnit']) ?? null,
  );
  const knownIntegerRate = pricePerMillion && /^\d+$/.test(pricePerMillion)
    ? Number(pricePerMillion)
    : null;
  const shouldFilterByKnownRate = knownIntegerRate !== null
    && listSeedancePricingRules().some(rule => rule.model === recognizedModel
      && rule.unitPricePerMillion === knownIntegerRate);
  const candidates = listSeedancePricingRules().filter(rule =>
    rule.model === recognizedModel
    && (!shouldFilterByKnownRate || rule.unitPricePerMillion === knownIntegerRate)
    && (explicitResolution === null
      || explicitResolution === '480p/720p'
      || rule.resolution === explicitResolution)
    && (explicitVideo === null || rule.hasVideoInput === explicitVideo));
  const resolutions = new Set(candidates.map(rule => collapseResolution(rule.resolution)));
  const videoValues = new Set(candidates.map(rule => rule.hasVideoInput));
  const rates = new Set(candidates.map(rule => rule.unitPricePerMillion));

  return {
    recognizedModel,
    resolution: explicitResolution
      ?? (resolutions.size === 1 ? [...resolutions][0]! : null),
    hasVideoInput: explicitVideo
      ?? (videoValues.size === 1 ? [...videoValues][0]! : null),
    // 官方明细价格优先；只有 Price 缺失/为 0 时才使用唯一可判定的受审规则兜底。
    unitPricePerMillion: pricePerMillion
      ?? (rates.size === 1 ? String([...rates][0]!) : null),
  };
}

function resolutionFromText(text: string): '480p/720p' | SeedancePricingResolution | null {
  const normalized = text.toLowerCase();
  if (/(?:^|[^0-9])1080\s*p(?:[^0-9]|$)/.test(normalized)) return '1080p';
  if (/(?:^|[^0-9])4\s*k(?:[^0-9]|$)/.test(normalized)) return '4k';
  if (/480\s*p[^0-9]+720\s*p|720\s*p[^0-9]+480\s*p/.test(normalized)) return '480p/720p';
  if (/(?:^|[^0-9])720\s*p(?:[^0-9]|$)/.test(normalized)) return '720p';
  if (/(?:^|[^0-9])480\s*p(?:[^0-9]|$)/.test(normalized)) return '480p';
  return null;
}

function videoInputFromText(text: string): boolean | null {
  const normalized = text.toLowerCase().replace(/[\s_-]+/g, '');
  if (/不含视频输入|无视频输入|novideoinput|withoutvideoinput/.test(normalized)) return false;
  if (/含视频输入|有视频输入|withvideoinput|referencevideo/.test(normalized)) return true;
  return null;
}

function collapseResolution(resolution: SeedancePricingResolution) {
  return resolution === '480p' || resolution === '720p' ? '480p/720p' as const : resolution;
}

function normalizePricePerMillion(price: string | null, unit: string | null) {
  if (!price) return null;
  const normalizedUnit = normalizeText(unit).replace(/\s+/g, '');
  let multiplier: bigint | null = null;
  if (/百万|million|mtokens?|1m/.test(normalizedUnit)) multiplier = 1n;
  else if (/千|ktokens?|1k/.test(normalizedUnit)) multiplier = 1_000n;
  else if (/tokens?|令牌/.test(normalizedUnit)) multiplier = 1_000_000n;
  else return null;
  const result = multiplyDecimalString(price, multiplier);
  if (result === null || /^-/.test(result) || isZeroDecimal(result)) return null;
  return result;
}

function billableTokenString(count: string | null, unit: string | null) {
  if (!count) return null;
  const multiplier = tokenUnitMultiplier(unit);
  if (multiplier === null) return null;
  const value = decimalTimesInteger(count, multiplier);
  return value !== null && value >= 0n ? value.toString() : null;
}

function deductedTokenString(count: string | null, unit: string | null) {
  if (!count) return null;
  const multiplier = tokenUnitMultiplier(unit);
  if (multiplier === null) return null;
  const parsed = parseDecimal(count);
  if (!parsed || parsed.numerator < 0n) return null;
  return fractionToDecimal(parsed.numerator * multiplier, parsed.denominator);
}

function tokenUnitMultiplier(unit: string | null) {
  if (!unit) return null;
  const normalizedUnit = normalizeText(unit).replace(/\s+/g, '');
  if (/百万|million|mtokens?|1m/.test(normalizedUnit)) return 1_000_000n;
  if (/千|ktokens?|1k/.test(normalizedUnit)) return 1_000n;
  if (/tokens?|令牌/.test(normalizedUnit)) return 1n;
  return null;
}

function formatTokenCost(tokens: string, unitPricePerMillion: string) {
  const rate = parseDecimal(unitPricePerMillion);
  if (!rate || rate.numerator < 0n) return null;
  const unroundedMicros = BigInt(tokens) * rate.numerator;
  const micros = divideRoundHalfUp(unroundedMicros, rate.denominator);
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}

function multiplyDecimalString(value: string, multiplier: bigint) {
  const parsed = parseDecimal(value);
  if (!parsed) return null;
  return fractionToDecimal(parsed.numerator * multiplier, parsed.denominator);
}

function fractionToDecimal(numerator: bigint, denominator: bigint) {
  const negative = numerator < 0n;
  let absolute = negative ? -numerator : numerator;
  const whole = absolute / denominator;
  absolute %= denominator;
  if (absolute === 0n) return `${negative ? '-' : ''}${whole}`;
  const scale = denominator.toString().length - 1;
  const fraction = absolute.toString().padStart(scale, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function divideRoundHalfAwayFromZero(numerator: bigint, denominator: bigint) {
  return numerator < 0n
    ? -divideRoundHalfUp(-numerator, denominator)
    : divideRoundHalfUp(numerator, denominator);
}

function formatMicros(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function isZeroDecimal(value: string) {
  const parsed = parseDecimal(value);
  return parsed?.numerator === 0n;
}

export function mapVolcengineResourcePackage(raw: Record<string, unknown>): NormalizedResourcePackage | null {
  const packageId = firstString(raw, [
    'PackageID', 'PackageId', 'package_id', 'ResourcePackageID', 'ResourcePackageId',
    'InstanceNo', 'InstanceID', 'InstanceId', 'ID', 'id',
  ]);
  if (!packageId) return null;

  const product = firstString(raw, [
    'ProductName', 'Product', 'product', 'ProductZh', 'BillingProduct',
  ]) ?? '火山引擎资源包';
  const config = firstString(raw, [
    'Config', 'ConfigName', 'ConfigurationName', 'ConfigurationCode',
    'ResourcePackageName', 'PackageName', 'Name', 'DisplayName', 'Description',
    'Spec', 'Specification',
  ]) ?? product;
  const recognizedModel = recognizeResourcePackageModel(`${product} ${config}`);
  if (!recognizedModel) return null;

  const totalQuota = firstNumber(raw, [
    'TotalQuota', 'TotalAmount', 'Total', 'Quota', 'TotalNum', 'TotalQuantity', 'Specification',
  ]);
  const remainingQuota = firstNumber(raw, [
    'RemainingQuota', 'RemainQuota', 'RemainingAmount', 'RemainAmount',
    'AvailableQuota', 'AvailableAmount', 'Balance', 'Remaining',
  ]);
  if (totalQuota === undefined || remainingQuota === undefined) return null;
  const multiplier = quotaUnitMultiplier(firstString(raw, ['Unit', 'SpecificationUnit', 'UnitName']) ?? '');
  const normalizedTotalQuota = Math.round(totalQuota * multiplier);
  const normalizedRemainingQuota = Math.round(remainingQuota * multiplier);
  if (
    !Number.isSafeInteger(normalizedTotalQuota)
    || !Number.isSafeInteger(normalizedRemainingQuota)
    || normalizedTotalQuota < 0
    || normalizedRemainingQuota < 0
    || normalizedRemainingQuota > normalizedTotalQuota
  ) return null;

  return {
    packageId,
    provider: PROVIDER,
    product,
    config,
    recognizedModel,
    status: firstString(raw, ['Status', 'status', 'State', 'state']) ?? 'Effective',
    totalQuota: normalizedTotalQuota,
    remainingQuota: normalizedRemainingQuota,
    startsAt: firstDateString(raw, ['StartTime', 'StartedAt', 'EffectiveTime', 'StartAt']),
    expiresAt: firstDateString(raw, ['ExpireTime', 'ExpiryTime', 'ExpiredAt', 'ExpiresAt', 'EndTime', 'ExpireAt']),
    payloadHash: sha256Hex(canonicalJsonStringify(raw)),
    rawPayload: raw,
  };
}

function isSeedanceResourcePackageRaw(raw: Record<string, unknown>) {
  const text = [
    firstString(raw, ['ProductName', 'Product', 'product', 'ProductZh', 'BillingProduct']),
    firstString(raw, [
      'Config', 'ConfigName', 'ConfigurationName', 'ConfigurationCode',
      'ResourcePackageName', 'PackageName', 'Name', 'DisplayName', 'Description',
      'Spec', 'Specification',
    ]),
  ].filter(Boolean).join(' ');
  return recognizeResourcePackageModel(text) !== null;
}

export function recognizeResourcePackageModel(text: string) {
  const normalized = text.toLowerCase();
  if (!/seedance/i.test(normalized)) return null;
  if (/(?:^|[^0-9])2[._-]?5(?:[^0-9]|$)/.test(normalized)) return 'Seedance 2.5';
  if (!/(?:^|[^0-9])2[._-]?0(?:[^0-9]|$)/.test(normalized)) return null;
  if (/mini/i.test(normalized)) return 'Seedance 2.0 Mini';
  if (/fast/i.test(normalized)) return 'Seedance 2.0 Fast';
  return 'Seedance 2.0';
}

export function buildVolcengineOpenApiRequest(input: {
  action: string;
  body?: Record<string, unknown>;
  method?: 'GET' | 'POST';
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const method = input.method ?? 'POST';
  const xDate = toAmzDate(now);
  const shortDate = xDate.slice(0, 8);
  const endpoint = new URL(env.VOLC_BILLING_ENDPOINT);
  const query = new URLSearchParams({
    Action: input.action,
    Version: env.VOLC_BILLING_VERSION,
  });
  const body = method === 'GET' ? '' : JSON.stringify(input.body ?? {});
  const canonicalQuery = canonicalizeQuery(query);
  const payloadHash = sha256Hex(body);
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalRequest = [
    method,
    endpoint.pathname || '/',
    canonicalQuery,
    'content-type:application/json',
    `host:${endpoint.host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${xDate}`,
    '',
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = [
    shortDate,
    env.VOLC_BILLING_REGION,
    env.VOLC_BILLING_SERVICE,
    'request',
  ].join('/');
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = getSigningKey(env.VOLC_BILLING_SECRET_ACCESS_KEY ?? '', shortDate);
  const signature = hmacHex(signingKey, stringToSign);
  const authorization = [
    `HMAC-SHA256 Credential=${env.VOLC_BILLING_ACCESS_KEY_ID}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ');
  endpoint.search = canonicalQuery;

  return {
    url: endpoint.toString(),
    method,
    body,
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      'X-Content-Sha256': payloadHash,
      'X-Date': xDate,
    },
    canonicalRequest,
  };
}

export async function volcengineOpenApiRequest<T>(
  action: string,
  body: Record<string, unknown>,
  options: OpenApiOptions = {},
) {
  const maxRetries = options.maxRetries ?? env.VOLC_BILLING_MAX_RETRIES;
  const baseDelay = options.retryBaseDelayMs ?? env.VOLC_BILLING_RETRY_BASE_DELAY_MS;
  const sleep = options.sleep ?? delay;
  let attempt = 0;

  while (true) {
    const request = buildVolcengineOpenApiRequest({ action, body, method: options.method });
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.method === 'POST' ? { body: request.body } : {}),
        signal: AbortSignal.timeout(options.timeoutMs ?? env.VOLC_BILLING_REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      let payload: Record<string, unknown> = {};
      if (text) {
        try {
          payload = JSON.parse(text) as Record<string, unknown>;
        } catch {
          if (response.ok) throw new Error('火山费用中心返回了无效 JSON');
        }
      }
      const apiError = getByPath(payload, 'ResponseMetadata.Error');
      const retryableApiError = isRecord(apiError) && isRetryableApiError(apiError);

      if (!response.ok || isRecord(apiError)) {
        const message = extractOpenApiError(text) || `火山费用中心请求失败：HTTP ${response.status}`;
        const retryable = response.status === 429 || response.status >= 500 || retryableApiError;
        if (!retryable || attempt >= maxRetries) throw new Error(message);
        const retryAfter = retryAfterMilliseconds(response.headers.get('retry-after'));
        await sleep(retryAfter ?? baseDelay * (2 ** attempt));
        attempt += 1;
        continue;
      }
      return payload as T;
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableNetworkError(error)) throw error;
      await sleep(baseDelay * (2 ** attempt));
      attempt += 1;
    }
  }
}

function extractResourcePackageItems(response: Record<string, unknown>) {
  const items = firstRecordArray(response, [
    'Result.ResourcePackages', 'Result.Packages', 'Result.Items', 'Result.List',
    'Result.Rows', 'ResponseMetadata.Result.ResourcePackages',
    'Data.ResourcePackages', 'Data.Items',
  ]);
  if (!items) throw new Error('ListResourcePackages 响应缺少已知的资源包数组');
  return items;
}

function extractBillItems(response: Record<string, unknown>) {
  const result = getByPath(response, 'Result');
  if (!isRecord(result) || !Array.isArray(result.List)) {
    throw new Error('ListBillDetail 响应缺少 Result.List 数组');
  }
  if (!result.List.every(isRecord)) throw new Error('ListBillDetail Result.List 包含非对象行');
  return result.List;
}

function firstRecordArray(response: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    const value = getByPath(response, path);
    if (Array.isArray(value)) {
      if (!value.every(isRecord)) throw new Error(`${path} 包含非对象行`);
      return value;
    }
  }
  return null;
}

function extractRequiredBillTotal(response: Record<string, unknown>) {
  const value = getByPath(response, 'Result.Total');
  const total = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('ListBillDetail 响应缺少有效的 Result.Total');
  }
  return total;
}

function extractNextToken(response: Record<string, unknown>) {
  return firstString(response, [
    'Result.NextToken', 'ResponseMetadata.Result.NextToken', 'Data.NextToken', 'NextToken',
  ]);
}

function extractRequestId(response: Record<string, unknown>) {
  return firstString(response, ['ResponseMetadata.RequestId', 'RequestId']) ?? null;
}

function extractOpenApiError(text: string) {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return firstString(parsed, [
      'ResponseMetadata.Error.Message', 'Error.Message', 'Message', 'message',
    ]);
  } catch {
    return text.slice(0, 500);
  }
}

function isRetryableApiError(error: Record<string, unknown>) {
  const code = normalizeText(firstString(error, ['Code']));
  return /internal|throttl|limit|busy|timeout|unavailable/.test(code);
}

function isRetryableNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError'
    || error.name === 'TimeoutError'
    || error instanceof TypeError
    || /fetch|network|socket|timeout|econnreset|eai_again/i.test(error.message);
}

function retryAfterMilliseconds(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : Math.max(0, date.getTime() - Date.now());
}

export function normalizeBillWindow(input: {
  billPeriod: string;
  expenseDate?: string;
  isFinal?: boolean;
  now?: Date;
}): BillWindow {
  if (!/^\d{4}-\d{2}$/.test(input.billPeriod)) throw new Error('账期必须为 YYYY-MM');
  const today = shanghaiDate(input.now ?? new Date());
  const currentPeriod = today.slice(0, 7);
  if (input.expenseDate) {
    const expenseDate = assertIsoDate(input.expenseDate, 'ExpenseDate');
    if (!expenseDate.startsWith(`${input.billPeriod}-`)) throw new Error('ExpenseDate 必须与账期同月');
    if (expenseDate > today) throw new Error('不能同步未来账单日期');
    return {
      billPeriod: input.billPeriod,
      expenseDate,
      windowStart: expenseDate,
      windowEnd: expenseDate,
      isFinal: Boolean(input.isFinal),
    };
  }
  const periodStart = `${input.billPeriod}-01`;
  if (!input.isFinal && input.billPeriod > currentPeriod) {
    throw new Error('不能同步未来账期');
  }
  if (input.isFinal && input.billPeriod >= currentPeriod) {
    throw new Error('最终账单只能复核已经结束的历史账期');
  }
  return {
    billPeriod: input.billPeriod,
    windowStart: periodStart,
    // 当前账期的整月接口只是一次截至今天的观察，不能把尚未发生的未来日期
    // 写成“已覆盖零用量”。历史账期（以及经过复核的最终账期）才覆盖到月末。
    windowEnd: !input.isFinal && input.billPeriod === currentPeriod
      ? today
      : lastDayOfMonth(input.billPeriod),
    isFinal: Boolean(input.isFinal),
  };
}

function syncLockScope(input: {
  kind: VolcengineBillingSyncKind;
  windowStart: string | null;
  windowEnd: string | null;
  isFinal: boolean;
}) {
  // 同一种账务类型串行执行，避免日窗口与整月窗口相互覆盖 active/is_final。
  return input.kind;
}

function requiredDecimal(source: Record<string, unknown>, key: string) {
  const value = decimalString(getByPath(source, key));
  if (value === null) throw new Error(`QueryBalanceAcct 缺少有效字段 ${key}`);
  return value;
}

function decimalString(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/,/g, '');
  return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(normalized)
    ? normalized
    : null;
}

function parseDecimal(value: string) {
  const expanded = expandScientificDecimal(value);
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(expanded);
  if (!match) return null;
  const fraction = match[3] ?? '';
  const numerator = BigInt(`${match[1] === '-' ? '-' : ''}${match[2]}${fraction}`);
  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}

function decimalTimesInteger(value: string, multiplier: bigint) {
  const parsed = parseDecimal(value);
  if (!parsed) return null;
  const numerator = parsed.numerator * multiplier;
  return numerator % parsed.denominator === 0n ? numerator / parsed.denominator : null;
}

function expandScientificDecimal(value: string) {
  if (!/[eE]/.test(value)) return value.replace(/^\+/, '');
  const match = /^([+-]?)(\d*)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(value);
  if (!match || (!match[2] && !match[3])) return value;
  const sign = match[1] === '-' ? '-' : '';
  const integer = match[2] ?? '';
  const fraction = match[3] ?? '';
  const exponent = Number(match[4]);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10_000) return value;
  const digits = `${integer}${fraction}` || '0';
  const decimalIndex = integer.length + exponent;
  if (decimalIndex <= 0) return `${sign}0.${'0'.repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function sourceDetailKey(raw: Record<string, unknown>) {
  const official = firstString(raw, ['BillDetailId', 'BillDetailID', 'DetailID', 'DetailId']);
  if (official) return official;
  const stable = [
    firstString(raw, ['BillID']), firstString(raw, ['BillPeriod']), firstString(raw, ['ExpenseDate']),
    firstString(raw, ['ExpenseBeginTime']), firstString(raw, ['ExpenseEndTime']),
    firstString(raw, ['PayerID']), firstString(raw, ['OwnerID']), firstString(raw, ['SellerID']),
    firstString(raw, ['Product']), firstString(raw, ['BillingMode']), firstString(raw, ['BillCategory']),
    firstString(raw, ['InstanceNo']), firstString(raw, ['Project']),
    firstString(raw, ['ConfigurationCode']), firstString(raw, ['ElementCode']),
    firstString(raw, ['FactorCode']), firstString(raw, ['RegionCode']), firstString(raw, ['ZoneCode']),
    firstString(raw, ['Price']), firstString(raw, ['PriceUnit']),
    firstString(raw, ['Count']), firstString(raw, ['Unit']), firstString(raw, ['Currency']),
  ].map(value => value ?? '').join('\u0000');
  return `sha256:${sha256Hex(stable)}`;
}

function normalizeJsonValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function firstString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getByPath(source, key);
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function firstNumber(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getByPath(source, key);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(/,/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function firstDateString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getByPath(source, key);
    const parsed = normalizeDateValue(value);
    if (parsed) return parsed;
  }
  return null;
}

function quotaUnitMultiplier(unit: string) {
  const normalized = unit.trim().toLowerCase();
  if (!normalized) return 1;
  if (normalized.includes('千') || /k\s*tokens?/.test(normalized) || normalized.includes('ktoken')) {
    return 1000;
  }
  return 1;
}

function normalizeDateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }
  return null;
}

function normalizeIsoDateValue(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match) return null;
  try {
    return assertIsoDate(match[1]!, 'ExpenseDate');
  } catch {
    return null;
  }
}

function assertIsoDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} 必须为 YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} 不是有效日期`);
  }
  return value;
}

function enumerateIsoDates(start: string, end: string, maxDays: number) {
  const values: string[] = [];
  let cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last) {
    values.push(cursor.toISOString().slice(0, 10));
    if (values.length > maxDays) throw new Error(`账单同步范围不能超过 ${maxDays} 天`);
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return values;
}

function toIsoDate(value: Date | string) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function lastDayOfMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year!, monthNumber!, 0)).toISOString().slice(0, 10);
}

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year!, monthNumber! - 1 + delta, 1)).toISOString().slice(0, 7);
}

function shanghaiDate(date: Date) {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function addShanghaiDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}

function shanghaiParts(date: Date) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return { day: shifted.getUTCDate(), hour: shifted.getUTCHours() };
}

function getByPath(source: Record<string, unknown>, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((value, key) => {
    if (!isRecord(value)) return undefined;
    return value[key];
  }, source);
}

function canonicalizeQuery(query: URLSearchParams) {
  return [...query.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function toAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function getSigningKey(secretKey: string, shortDate: string) {
  const dateKey = hmacBuffer(secretKey, shortDate);
  const regionKey = hmacBuffer(dateKey, env.VOLC_BILLING_REGION);
  const serviceKey = hmacBuffer(regionKey, env.VOLC_BILLING_SERVICE);
  return hmacBuffer(serviceKey, 'request');
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function hmacBuffer(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

function hmacHex(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest('hex');
}

function delay(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

function hasBillingCredentials() {
  return Boolean(env.VOLC_BILLING_ACCESS_KEY_ID && env.VOLC_BILLING_SECRET_ACCESS_KEY);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知费用中心同步错误';
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
