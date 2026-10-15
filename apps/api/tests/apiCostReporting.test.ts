import { endpointContracts } from '@lindyson/api-contracts';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';
import {
  getAdminApiCostReconciliationDetail,
  getAdminApiCostDashboard,
  getAdminApiCostOverview,
  listAdminApiCostAttempts,
  listAdminApiCostTasks,
  listAdminApiCostUsers,
  listAdminApiCostReconciliation,
  listAdminApiCostSettlement,
  resolveBusinessReconciliationStatus,
} from '../src/domain/apiCostReporting.js';

const taskId = '00000000-0000-4000-8000-000000000001';
const usageId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';
const zeroCostCaseId = '00000000-0000-4000-8000-000000000009';

describe('API 人民币成本报告', () => {
  it('主看盘月份范围只执行四组经营查询，不加载覆盖、审计或资源包数据', async () => {
    const now = new Date().toISOString();
    const resolveQuery = async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('WITH latest_balance AS')) return rows([{
        balance: {
          provider: 'volcengine-ark', available_balance_cny: '0', cash_balance_cny: '0',
          frozen_amount_cny: '0', arrears_balance_cny: '0', credit_limit_cny: '0',
          currency: 'CNY', synced_at: now,
        },
        sync_runs: [syncRun('balance', now), syncRun('bill', now), syncRun('packages', now)],
      }]);
      if (text.includes('GROUP BY GROUPING SETS')) return rows([{
        model: 'Seedance 2.0', total_row: false, task_count: 3, user_count: 1,
        price_versions: [
          'volcengine-seedance-2026-07-10',
          'volcengine-seedance-2026-06-01',
          'volcengine-seedance-2026-07-10',
        ],
        settled_credits: '1433', held_credits: '0', refunded_credits: '472',
        estimated_cost_cny: '405.424506', incomplete_task_count: 3,
        pending_final_bill_task_count: 3, approved_zero_cost_task_count: 0,
        unresolved_task_count: 0, admin_direct_usage_count: 3,
        admin_direct_estimated_cost_cny: '37.488825',
        timing_shift_cost_cny: '0',
      }, {
        model: null, total_row: true, task_count: 3, user_count: 1,
        price_versions: [],
        settled_credits: '1433', held_credits: '0', refunded_credits: '472',
        estimated_cost_cny: '405.424506', incomplete_task_count: 3,
        pending_final_bill_task_count: 3, approved_zero_cost_task_count: 0,
        unresolved_task_count: 0, admin_direct_usage_count: 3,
        admin_direct_estimated_cost_cny: '37.488825',
        timing_shift_cost_cny: '0',
      }]);
      if (text.includes('FROM operational_sources') && text.includes('GROUP BY model')) return rows([{
        model: 'Seedance 2.0', call_count: 3, estimated_cost_cny: '37.488825',
        unpriced_call_count: 0, price_versions: ['volcengine-seedance-2026-07-10'],
      }]);
      if (text.includes('WITH selected_dates AS')) return rows([{
        ...officialRevision({
          sourceDetailKey: 'usage-overview', billLineType: 'usage', recognizedModel: 'Seedance 2.0',
          billableTokens: '9552570', deductionCount: '9552570', listEquivalentCostCny: '442.913331',
          originalBillAmountCny: '0', payableAmountCny: '0', paidAmountCny: '0', unpaidAmountCny: '0',
          expenseDate: '2026-06-30',
        }),
        coverage_complete: true,
      }]);
      throw new Error(`轻量主看盘执行了未预期 SQL：${text}`);
    };
    const queryProbe = serialQueryProbe(resolveQuery);
    const query = queryProbe.query;

    const overview = await getAdminApiCostOverview({ query } as unknown as DbClient, {
      range: 'month', month: '2026-06', asOf: now,
    });

    expect(() => endpointContracts.adminApiUsageOverview.response.parse(overview)).not.toThrow();
    expect(overview.operations).toMatchObject({
      taskCount: 3,
      userCount: 1,
      settledCredits: 1433,
      refundedCredits: 472,
      estimatedCostCny: '442.913331',
      businessEstimatedCostCny: '405.424506',
      operationalCallCount: 3,
      operationalEstimatedCostCny: '37.488825',
      operationalUnpricedCallCount: 0,
      adminDirectUsageCount: 3,
      adminDirectEstimatedCostCny: '37.488825',
      knownAccountCostCny: '442.913331',
      unresolvedTaskCount: 0,
      pendingFinalBillTaskCount: 3,
      approvedZeroCostTaskCount: 0,
      officialEquivalentCostCny: '442.913331',
      differenceCny: '0.000000',
      officialPayableCny: '0.000000',
      reconciliationStatus: 'incomplete',
    });
    expect(overview.models.map(model => model.model)).toEqual([
      'Seedance 2.5', 'Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini',
    ]);
    expect(overview.models[1]).toMatchObject({
      model: 'Seedance 2.0', taskCount: 3, operationalCallCount: 3,
      estimatedCostCny: '442.913331', businessEstimatedCostCny: '405.424506',
      operationalEstimatedCostCny: '37.488825', knownAccountCostCny: '442.913331',
      operationalUnpricedCallCount: 0, averageTaskCostCny: '135.141502',
      priceVersions: ['volcengine-seedance-2026-06-01', 'volcengine-seedance-2026-07-10'],
    });
    expect(overview.models.filter(model => model.model !== 'Seedance 2.0')).toEqual([
      expect.objectContaining({
        model: 'Seedance 2.5', taskCount: 0, operationalCallCount: 0, averageTaskCostCny: null,
      }),
      expect.objectContaining({
        model: 'Seedance 2.0 Fast', taskCount: 0, operationalCallCount: 0, averageTaskCostCny: null,
      }),
      expect.objectContaining({
        model: 'Seedance 2.0 Mini', taskCount: 0, operationalCallCount: 0, averageTaskCostCny: null,
      }),
    ]);
    expect(query).toHaveBeenCalledTimes(4);
    expect(queryProbe.peakActive()).toBe(1);
    const overviewQueries = query.mock.calls.map(call => String(call[0]));
    const accountSyncSql = overviewQueries.find(sql => sql.includes('WITH latest_balance AS'))!;
    const operationsSql = overviewQueries.find(sql => sql.includes('GROUP BY GROUPING SETS'))!;
    const operationalSql = overviewQueries.find(sql => (
      sql.includes('FROM operational_sources') && sql.includes('GROUP BY model')
    ))!;
    const officialSnapshotSql = overviewQueries.find(sql => sql.includes('WITH selected_dates AS'))!;
    expect(accountSyncSql).toContain(
      "CASE WHEN completed_at > $2::timestamptz THEN 'running' ELSE status END",
    );
    expect(accountSyncSql).toMatch(
      /max\(completed_at\) FILTER \(\s+WHERE status = 'success' AND completed_at <= \$2::timestamptz/,
    );
    expect(accountSyncSql).toMatch(
      /max\(window_end\) FILTER \(\s+WHERE status = 'success' AND completed_at <= \$2::timestamptz/,
    );
    expect(overviewQueries.join('\n')).not.toMatch(
      /AS local_start|provider_resource_packages|provider_pricing_rules|provider_reconciliation_buckets/,
    );
    expect(operationsSql).toContain("cases.evidence->>'resolutionKind' = 'zero-cost'");
    expect(operationsSql).toContain('SELECT DISTINCT case_id, usage_record_id');
    expect(operationsSql).toContain("cases.status IN ('open', 'approved')");
    expect(operationsSql).toContain('attempt_count - known_usage_attempts - approved_zero_attempts');
    expect(operationsSql).toContain('admin_direct_usage AS');
    expect(operationsSql).toContain('model_price_versions AS');
    expect(operationsSql).toContain('JOIN provider_usage_records version_usage');
    expect(operationsSql).not.toContain('unnest(task.price_versions)');
    expect(operationsSql.match(/FROM business_task_costs task/g)).toHaveLength(1);
    expect(operationsSql).toContain('pur.initiated_by_admin_user_id IS NOT NULL');
    expect(operationalSql).toContain('FROM provider_operational_usage_records usage');
    expect(operationalSql).toContain('usage.task_id IS NULL');
    expect(operationalSql).toContain('UNION ALL');
    expect(officialSnapshotSql).toContain('selected_dates AS MATERIALIZED');
    expect(officialSnapshotSql).toContain('valid_bill_runs AS MATERIALIZED');
    expect(officialSnapshotSql).toContain('selected_run_candidates AS');
    expect(officialSnapshotSql).toContain('PARTITION BY dates.day');
    expect(officialSnapshotSql).toContain('runs.window_start <= $2::date');
    expect(officialSnapshotSql).toContain('runs.window_end >= $1::date');
    expect(officialSnapshotSql).toContain('EXISTS (\n             SELECT 1 FROM provider_bill_sync_run_items evidence');
    expect(officialSnapshotSql).not.toContain('evidenced_bill_runs');
  });

  it.each([
    { name: '官方账单日期覆盖不完整', coverageComplete: false, billAgeMs: 0, billStatus: 'success' },
    { name: '官方账单同步超过 30 分钟', coverageComplete: true, billAgeMs: 31 * 60_000, billStatus: 'success' },
    { name: '最新账单同步在截点后才完成', coverageComplete: true, billAgeMs: 0, billStatus: 'running' },
  ])('$name 时不把已知官方行伪装成完整对账', async ({ coverageComplete, billAgeMs, billStatus }) => {
    const asOf = new Date().toISOString();
    const billLastSuccessAt = new Date(new Date(asOf).getTime() - billAgeMs).toISOString();
    const query = vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('WITH latest_balance AS')) {
        const bill = { ...syncRun('bill', asOf), status: billStatus, last_success_at: billLastSuccessAt };
        return rows([{
          balance: {
            provider: 'volcengine-ark', available_balance_cny: '0', cash_balance_cny: '0',
            frozen_amount_cny: '0', arrears_balance_cny: '0', credit_limit_cny: '0',
            currency: 'CNY', synced_at: asOf,
          },
          sync_runs: [syncRun('balance', asOf), bill, syncRun('packages', asOf)],
        }]);
      }
      if (text.includes('GROUP BY GROUPING SETS')) return rows([{
        model: null, total_row: true, task_count: 1, user_count: 1,
        settled_credits: '100', held_credits: '0', refunded_credits: '0',
        estimated_cost_cny: '46.000000', incomplete_task_count: 0,
        timing_shift_cost_cny: '0',
      }]);
      if (text.includes('FROM operational_sources') && text.includes('GROUP BY model')) return rows([]);
      if (text.includes('WITH selected_dates AS')) return rows([{
        ...officialRevision({
          sourceDetailKey: 'usage-gate', billLineType: 'usage', recognizedModel: 'Seedance 2.0',
          billableTokens: '1000000', deductionCount: '1000000', listEquivalentCostCny: '46.000000',
          originalBillAmountCny: '0', payableAmountCny: '0', paidAmountCny: '0', unpaidAmountCny: '0',
          expenseDate: '2026-06-30',
        }),
        coverage_complete: coverageComplete,
      }]);
      throw new Error(`门禁用例执行了未预期 SQL：${text}`);
    });

    const overview = await getAdminApiCostOverview({ query } as unknown as DbClient, {
      range: 'month', month: '2026-06', asOf,
    });

    expect(overview.operations).toMatchObject({
      estimatedCostCny: '46.000000',
      officialEquivalentCostCny: null,
      differenceCny: null,
      officialPayableCny: null,
      reconciliationStatus: 'unavailable',
    });
  });

  it('经营对账区分完整对齐、已知小计、跨期归因和未解释差额', () => {
    const resolve = (
      incompleteTaskCount: number,
      estimatedCostMicros: bigint,
      officialEquivalentMicros: bigint | null,
      timingShiftCostMicros = 0n,
    ) => resolveBusinessReconciliationStatus({
      incompleteTaskCount, estimatedCostMicros, officialEquivalentMicros, timingShiftCostMicros,
    });

    expect(resolve(0, 305_773_290n, 305_773_290n)).toEqual({
      difference: 0n, status: 'matched',
    });
    expect(resolve(2, 305_773_290n, 305_773_290n)).toEqual({
      difference: 0n, status: 'incomplete',
    });
    expect(resolve(0, 304_608_616n, 305_773_290n, 1_164_674n)).toEqual({
      difference: 1_164_674n, status: 'matched-adjusted',
    });
    expect(resolve(0, 300_000_000n, 305_773_290n)).toEqual({
      difference: 5_773_290n, status: 'difference',
    });
    expect(resolve(0, 0n, null)).toEqual({ difference: null, status: 'unavailable' });
    expect(resolve(2, 0n, null)).toEqual({ difference: null, status: 'unavailable' });
  });

  it('还原线上审计基线，小数抵扣量不伪造整数汇总，并保留各项零值', async () => {
    const now = new Date().toISOString();
    let unavailableUsageAttempts = 0;
    let unpricedAttempts = 0;
    let businessCostFinalized = true;
    const query = vi.fn(async (sql: unknown, _params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return rows([{
        local_start: '2026-07-01', local_end: '2026-07-13',
        official_start: '2026-07-01', official_end: '2026-07-13',
        local_intervals: [{ start: '2026-07-01', end: '2026-07-13' }],
        official_intervals: [{ start: '2026-07-13', end: '2026-07-13' }],
      }]);
      if (text.includes('FROM provider_account_balance_snapshots')) return rows([{
        provider: 'volcengine-ark', available_balance_cny: '0', cash_balance_cny: '0',
        frozen_amount_cny: '0', arrears_balance_cny: '0', credit_limit_cny: '0', currency: 'CNY', synced_at: now,
      }]);
      if (text.includes('WITH selected_dates AS')) return rows([
        officialRevision({
          sourceDetailKey: 'usage-1', billLineType: 'usage', recognizedModel: 'Seedance 2.0',
          billableTokens: '9227670', deductionCount: '72664.544077', listEquivalentCostCny: '305.773290',
          originalBillAmountCny: '0', payableAmountCny: '0', paidAmountCny: '0', unpaidAmountCny: '0',
          expenseDate: '2026-07-13',
        }),
        officialRevision({
          sourceDetailKey: 'package-fast', billLineType: 'package-purchase', recognizedModel: 'Seedance 2.0 Fast',
          billableTokens: null, deductionCount: null, listEquivalentCostCny: null,
          originalBillAmountCny: '198', payableAmountCny: '198', paidAmountCny: '198', unpaidAmountCny: '0',
        }),
        officialRevision({
          sourceDetailKey: 'package-mini', billLineType: 'package-purchase', recognizedModel: 'Seedance 2.0 Mini',
          billableTokens: null, deductionCount: null, listEquivalentCostCny: null,
          originalBillAmountCny: '196', payableAmountCny: '196', paidAmountCny: '196', unpaidAmountCny: '0',
        }),
      ]);
      if (text.includes('FROM provider_billing_sync_runs') && text.includes('WITH ranked AS')) return rows([
        syncRun('balance', now), syncRun('bill', now), syncRun('packages', now),
      ]);
      if (text.includes('today_estimated_cost_cny')) return rows([{
        billable_tokens: '9227670', estimated_cost_cny: '305.773290',
        raw_billable_tokens: '8042794', raw_estimated_cost_cny: '272.807868',
        inferred_adjustment_tokens: '1184876', inferred_adjustment_cost_cny: '32.965422',
        comparable_billable_tokens: '9227670', comparable_estimated_cost_cny: '305.773290',
        comparable_raw_billable_tokens: '8042794', comparable_raw_estimated_cost_cny: '272.807868',
        comparable_inferred_adjustment_tokens: '1184876',
        comparable_inferred_adjustment_cost_cny: '32.965422',
        unpriced_attempts: unpricedAttempts, unpriced_tokens: unpricedAttempts ? '108900' : '0',
        unavailable_usage_attempts: unavailableUsageAttempts,
        comparable_unpriced_attempts: unpricedAttempts,
        comparable_unpriced_tokens: unpricedAttempts ? '108900' : '0',
        comparable_unavailable_usage_attempts: unavailableUsageAttempts,
        today_estimated_cost_cny: '0', today_unpriced_attempts: unpricedAttempts,
        today_unavailable_usage_attempts: unavailableUsageAttempts,
        month_estimated_cost_cny: '305.773290', month_unpriced_attempts: unpricedAttempts,
        month_unavailable_usage_attempts: unavailableUsageAttempts,
      }]);
      if (text.includes('AS row_count')) return rows([{
        row_count: 5, billable_tokens: '9227670', unpriced_rows: 0, unpriced_tokens: '0',
        list_equivalent_cost_cny: '305.773290',
        original_bill_amount_cny: '0', payable_amount_cny: '0', paid_amount_cny: '0',
        unpaid_amount_cny: '0', deducted_tokens: null, all_final: false, any_final: false,
      }]);
      if (text.includes('all_account_payable_cny')) return rows([{
        all_account_payable_cny: '0', seedance_payable_cny: '0', seedance_list_cost_cny: '305.773290',
      }]);
      if (text.includes('successful_estimated_cost_cny')) return rows([
        localModel('Seedance 2.0', '171.072000', {
          unpriced_tasks: unpricedAttempts, unavailable_usage_attempts: unavailableUsageAttempts,
        }),
        localModel('Seedance 2.0 Fast', '40.000000', {
          unpriced_tasks: unpricedAttempts, unavailable_usage_attempts: unavailableUsageAttempts,
        }),
        localModel('Seedance 2.0 Mini', '61.735868', {
          unpriced_tasks: unpricedAttempts, unavailable_usage_attempts: unavailableUsageAttempts,
        }),
      ]);
      if (text.includes('recognized_model AS model')) return rows([
        officialModel('Seedance 2.0', '3955976', '171.072296'),
        officialModel('Seedance 2.0 Fast', '1350238', '49.958806'),
        officialModel('Seedance 2.0 Mini', '3921456', '84.742188'),
      ]);
      if (text.includes('GROUP BY day')) return rows([{
        day: '2026-07-13', billable_tokens: '9227670', estimated_cost_cny: '305.773290',
        unpriced_attempts: unpricedAttempts, unavailable_usage_attempts: unavailableUsageAttempts,
      }]);
      if (text.includes('FROM provider_pricing_rules')) return rows([]);
      if (text.includes('FROM provider_resource_packages') || text.includes('FROM provider_resource_package_snapshots')) return rows([]);
      if (text.includes('package_purchase_amount_cny')) return rows([{
        usage_original_amount_cny: '0', usage_payable_amount_cny: '0', usage_paid_amount_cny: '0',
        usage_unpaid_amount_cny: '0', package_purchase_amount_cny: '394',
        package_purchase_paid_amount_cny: '394', package_purchase_unpaid_amount_cny: '0',
      }]);
      if (text.includes('AS timing_tokens')) return rows([{ timing_tokens: '0', timing_cost_cny: '0' }]);
      if (text.includes('opening_prepaid_asset_cny')) return rows([{
        opening_prepaid_asset_cny: '0', acquisition_cost_cny: '394', amortized_cost_cny: '0',
        expiry_loss_cny: '0', adjustment_cny: '0', ending_prepaid_asset_cny: '394',
        incomplete_rows: 0, row_count: 1,
      }]);
      if (text.includes('FROM provider_operational_usage_records')) return rows([]);
      if (text.includes('business_task_aggregates AS')) return rows([
        businessTaskRow('305.773290', {
          billable_tokens: '9227670', settled_credits: 120, inferred_attempts: 1,
          cost_finalized: businessCostFinalized,
          missing_usage_attempts: businessCostFinalized ? 0 : 1,
        }),
      ]);
      throw new Error(`未预期 SQL：${text}`);
    });

    const dashboard = await getAdminApiCostDashboard({ query } as unknown as DbClient, {
      asOf: '2026-07-13T06:00:00.000Z',
    });
    expect(() => endpointContracts.adminApiUsage.response.parse(dashboard)).not.toThrow();
    expect(dashboard.account).toMatchObject({
      availableBalanceCny: '0.000000', cashBalanceCny: '0.000000', status: 'fresh',
    });
    expect(dashboard.sync).toMatchObject({ status: 'normal', stale: false });
    expect(dashboard.packages).toEqual([]);
    expect(dashboard.coverage.comparable).toMatchObject({ status: 'partial' });
    expect(dashboard.coverage.excludedPeriods).toEqual([{
      start: '2026-07-01', end: '2026-07-12', reason: '不在本地与官方共同覆盖范围内',
    }]);
    expect(dashboard.daily.find(item => item.day === '2026-07-01')?.officialBillableTokens).toBeNull();
    expect(dashboard.daily.find(item => item.day === '2026-07-13')?.officialBillableTokens).toBe(9_227_670);
    expect(dashboard.summary).toMatchObject({
      billStatus: 'provisional',
      officialBillableTokens: 9_227_670,
      officialUnpricedRows: 0,
      officialUnpricedTokens: 0,
      officialListEquivalentCostCny: '305.773290',
      localBillableTokens: 9_227_670,
      localEstimatedCostCny: '305.773290',
      localEstimateCompleteness: 'complete',
      localUnavailableUsageAttempts: 0,
      tokenDelta: 0,
      costDeltaCny: '0.000000',
      localCostUnderstatementPercent: 0,
      officialPayableAmountCny: '0.000000',
      officialDiscountAmountCny: '305.773290',
      resourcePackageDeductedTokens: null,
      noPackageRunwayDays: 0,
      noPackageProjectedDailyCostCny: '305.773290',
      noPackageProjectionCoveredDays: 1,
      noPackageProjectionStatus: 'partial',
    });
    expect(dashboard.combinedStatus).toMatchObject({
      billState: 'provisional', matchState: 'adjusted-matched', label: '出账中 · 经调整后对齐',
    });
    expect(dashboard.operations).toMatchObject({
      taskCount: 1, userCount: 1, settledCredits: 120, heldCredits: 0,
      estimatedCostCny: '305.773290', estimateCompleteness: 'complete', incompleteTaskCount: 0,
      officialEquivalentCostCny: null, differenceCny: null,
      officialPayableCny: null, reconciliationStatus: 'unavailable',
    });
    expect(dashboard.operations.models.map(model => model.model)).toEqual([
      'Seedance 2.5', 'Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini',
    ]);
    expect(dashboard.operations.models[1]).toMatchObject({
      model: 'Seedance 2.0', taskCount: 1, operationalCallCount: 0,
      businessEstimatedCostCny: '305.773290', operationalEstimatedCostCny: '0.000000',
      knownAccountCostCny: '305.773290', averageTaskCostCny: '305.773290',
      priceVersions: ['volcengine-seedance-2026-07-10'],
    });
    expect(dashboard.books).toMatchObject({
      usage: {
        rawLocalTokens: 8_042_794, inferredAdjustmentTokens: 1_184_876,
        adjustedLocalTokens: 9_227_670, officialTokens: 9_227_670, residualTokens: 0,
      },
      valuation: {
        localEstimateCompleteness: 'complete', officialEstimateCompleteness: 'complete',
        rawLocalCostCny: '272.807868', residualCostCny: '0.000000',
      },
      settlement: { usagePayableAmountCny: '0.000000', packagePurchasePaidAmountCny: '394.000000' },
    });
    const officialUsageQueries = query.mock.calls
      .map(([sql]) => String(sql))
      .filter(sql => sql.includes('FROM provider_bill_details') && !sql.includes('all_account_payable_cny'));
    expect(officialUsageQueries.some(sql => sql.includes("bill_line_type = 'usage'"))).toBe(true);
    expect(query.mock.calls.every(([sql]) => !String(sql).includes('ListBillDetail'))).toBe(true);
    const coverageSql = query.mock.calls.map(([sql]) => String(sql))
      .find(sql => sql.includes('AS local_start'))!;
    expect(coverageSql).toContain('latest_manifests AS MATERIALIZED');
    expect(coverageSql).toContain('valid_bill_runs AS MATERIALIZED');
    expect(coverageSql).toContain('EXISTS (\n             SELECT 1 FROM provider_bill_sync_run_items evidence');
    expect(coverageSql).not.toContain('evidenced_bill_runs');

    unavailableUsageAttempts = 3;
    businessCostFinalized = false;
    const partial = await getAdminApiCostDashboard({ query } as unknown as DbClient, {
      asOf: '2026-07-13T06:00:00.000Z',
    });
    expect(partial.summary).toMatchObject({
      localEstimatedCostCny: '305.773290', localEstimateCompleteness: 'partial',
      localUnpricedAttempts: 0, localUnpricedTokens: 0, localUnavailableUsageAttempts: 3,
      monthEstimatedCostCny: '305.773290', monthEstimateCompleteness: 'partial',
      monthUnavailableUsageAttempts: 3,
    });
    expect(partial.combinedStatus.matchState).toBe('cannot-reconcile');
    expect(partial.operations).toMatchObject({
      reconciliationStatus: 'unavailable', incompleteTaskCount: 1,
      estimateCompleteness: 'partial', differenceCny: null,
    });
    expect(partial.books.valuation).toMatchObject({
      localEstimateCompleteness: 'partial',
      rawLocalCostCny: '272.807868', adjustedLocalCostCny: '305.773290',
      officialListEquivalentCostCny: '305.773290', rawCostDeltaCny: null, residualCostCny: null,
    });
    expect(partial.models[1]).toMatchObject({
      estimatedCostCny: '171.072000', unavailableUsageAttempts: 3,
      estimateCompleteness: 'partial',
    });
    expect(partial.daily.find(item => item.day === '2026-07-13')).toMatchObject({
      localEstimatedCostCny: '305.773290', localUnpricedAttempts: 0,
      localUnavailableUsageAttempts: 3, localEstimateCompleteness: 'partial',
    });

    const localSummarySql = query.mock.calls.map(([sql]) => String(sql))
      .find(sql => sql.includes('today_estimated_cost_cny'))!;
    expect(localSummarySql).toContain('WHERE billable_tokens > 0');
    expect(localSummarySql).toContain('WHERE billable_tokens IS NULL');
    expect(localSummarySql).not.toContain('WHERE (estimated_cost IS NULL');
    const fullSyncSql = query.mock.calls.map(([sql]) => String(sql))
      .find(sql => sql.includes('FROM provider_billing_sync_runs') && sql.includes('WITH ranked AS'))!;
    expect(fullSyncSql).toContain(
      "CASE WHEN completed_at > $1::timestamptz THEN 'running' ELSE status END",
    );
    expect(fullSyncSql).toMatch(
      /max\(completed_at\) FILTER \(\s+WHERE status = 'success' AND completed_at <= \$1::timestamptz/,
    );
    expect(fullSyncSql).toMatch(
      /max\(window_end\) FILTER \(\s+WHERE status = 'success' AND completed_at <= \$1::timestamptz/,
    );

    unavailableUsageAttempts = 0;
    unpricedAttempts = 1;
    const positiveUnpriced = await getAdminApiCostDashboard({ query } as unknown as DbClient, {
      asOf: '2026-07-13T06:00:00.000Z',
    });
    expect(positiveUnpriced.summary).toMatchObject({
      localEstimatedCostCny: '305.773290', localEstimateCompleteness: 'partial',
      localUnpricedAttempts: 1, localUnpricedTokens: 108900,
      localUnavailableUsageAttempts: 0,
    });
    expect(positiveUnpriced.models[1]).toMatchObject({
      estimatedCostCny: '171.072000', unpricedTasks: 1,
      unavailableUsageAttempts: 0, estimateCompleteness: 'partial',
    });
  });

  it('最新官方批次零用量时仍保留 provisional/reopened 账单状态', async () => {
    const asOf = '2026-07-13T06:00:00.000Z';
    const projections: unknown[] = [];
    const run = async (
      billState: 'provisional' | 'reopened',
      model: 'Seedance 2.0 Fast' | 'Seedance 2.0 Mini',
    ) => {
      const resolveQuery = async (sql: unknown, params?: unknown[]) => {
        const text = String(sql);
        if (text.includes('AS local_start')) {
          const isAccountCoverage = Array.isArray(params?.[1]) && params?.[1]?.length === 4;
          return rows([{
          local_start: '2026-07-13', local_end: '2026-07-13',
          official_start: isAccountCoverage ? '2026-07-07' : '2026-07-13', official_end: '2026-07-13',
          local_intervals: [{ start: '2026-07-13', end: '2026-07-13' }],
          official_intervals: [{
            start: isAccountCoverage ? '2026-07-07' : '2026-07-13',
            end: '2026-07-13', isFinal: false, billState,
          }],
          }]);
        }
        if (text.includes('FROM provider_account_balance_snapshots')) return rows([]);
        if (text.includes('FROM provider_billing_sync_runs') && text.includes('WITH ranked AS')) {
          return rows([syncRun('bill', asOf)]);
        }
        if (text.includes('today_estimated_cost_cny')) return rows([{
          billable_tokens: '0', estimated_cost_cny: '0', raw_billable_tokens: '0',
          raw_estimated_cost_cny: '0', inferred_adjustment_tokens: '0',
          inferred_adjustment_cost_cny: '0', today_estimated_cost_cny: '0',
          comparable_billable_tokens: '0', comparable_estimated_cost_cny: '0',
          comparable_raw_billable_tokens: '0', comparable_raw_estimated_cost_cny: '0',
          comparable_inferred_adjustment_tokens: '0',
          comparable_inferred_adjustment_cost_cny: '0',
          month_estimated_cost_cny: '0',
        }]);
        if (text.includes('WITH selected_dates AS')) return rows([]);
        if (text.includes('successful_estimated_cost_cny')) return rows([]);
        if (text.includes('GROUP BY day')) return rows([]);
        if (text.includes('FROM provider_pricing_rules')) return rows([]);
        if (text.includes('FROM provider_resource_package_snapshots')) return rows([]);
        if (text.includes('AS timing_tokens')) return rows([{ timing_tokens: '0', timing_cost_cny: '0' }]);
        if (text.includes('opening_prepaid_asset_cny')) return rows([{
          incomplete_rows: 0, row_count: 0, event_rows: 0, opening_catch_up_rows: 0,
        }]);
        if (text.includes('business_task_aggregates AS')) return rows([]);
        throw new Error(`未预期 SQL：${text}`);
      };
      const queryProbe = serialQueryProbe(resolveQuery);
      const query = queryProbe.query;

      const dashboard = await getAdminApiCostDashboard({ query } as unknown as DbClient, {
        range: 'date', date: '2026-07-13', model, asOf,
      });
      expect(queryProbe.peakActive()).toBe(1);
      expect(dashboard.combinedStatus.billState).toBe(billState);
      expect(dashboard.summary.officialPayableAmountCny).toBe('0.000000');
      expect(dashboard.account.availableBalanceCny).toBeNull();
      expect(dashboard.summary).toMatchObject({
        noPackageProjectionCoveredDays: 7,
        noPackageProjectionStatus: 'complete',
        noPackageProjectedDailyCostCny: '0.000000',
      });
      projections.push({
        coveredDays: dashboard.summary.noPackageProjectionCoveredDays,
        status: dashboard.summary.noPackageProjectionStatus,
        daily: dashboard.summary.noPackageProjectedDailyCostCny,
      });
      const coverageSql = query.mock.calls.map(([sql]) => String(sql))
        .find(sql => sql.includes('AS local_start'))!;
      expect(coverageSql).toContain('official_run_day_candidates AS');
      expect(coverageSql).toContain('PARTITION BY days.day::date');
      expect(coverageSql).toContain('official_run_days AS');
      expect(coverageSql).toContain('WHERE run_rank = 1');
      expect(coverageSql).not.toContain('JOIN LATERAL (');
      expect(coverageSql).not.toContain('LIMIT 1');
      expect(coverageSql).toContain('manifests.bill_state');
      const officialSql = query.mock.calls.map(([sql]) => String(sql))
        .find(sql => sql.includes('WITH selected_dates AS'))!;
      expect(officialSql).toContain("bill_state = 'final' AS is_final");
      expect(officialSql).toContain('WHERE run_rank = 1');
    };

    await run('provisional', 'Seedance 2.0 Mini');
    await run('reopened', 'Seedance 2.0 Fast');
    expect(projections[0]).toEqual(projections[1]);
  });

  it('官方尚未覆盖当天时仍保留本地摘要、模型、任务和用户成本', async () => {
    const asOf = '2026-07-13T06:00:00.000Z';
    const observedLocalOnly = rows([{
      local_start: '2026-07-13', local_end: '2026-07-13',
      official_start: null, official_end: null,
      local_intervals: [{ start: '2026-07-13', end: '2026-07-13' }], official_intervals: [],
    }]);
    const dashboardQuery = vi.fn(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return observedLocalOnly;
      if (text.includes('FROM provider_account_balance_snapshots')) return rows([]);
      if (text.includes('FROM provider_billing_sync_runs') && text.includes('WITH ranked AS')) return rows([]);
      if (text.includes('today_estimated_cost_cny')) {
        expect(params?.[3]).toEqual(['2026-07-13']);
        expect(params?.[4]).toEqual([]);
        return rows([{
          billable_tokens: '605700', estimated_cost_cny: '16.959600',
          raw_billable_tokens: '605700', raw_estimated_cost_cny: '16.959600',
          inferred_adjustment_tokens: '0', inferred_adjustment_cost_cny: '0',
          comparable_billable_tokens: '0', comparable_estimated_cost_cny: '0',
          comparable_raw_billable_tokens: '0', comparable_raw_estimated_cost_cny: '0',
          comparable_inferred_adjustment_tokens: '0', comparable_inferred_adjustment_cost_cny: '0',
          today_estimated_cost_cny: '16.959600', month_estimated_cost_cny: '16.959600',
        }]);
      }
      if (text.includes('WITH selected_dates AS')) return rows([]);
      if (text.includes('successful_estimated_cost_cny')) return rows([localModel('Seedance 2.0', '16.959600', {
        successful_tasks: 2, successful_video_count: 1, successful_output_seconds: '5',
      })]);
      if (text.includes('GROUP BY day')) return rows([{
        day: '2026-07-13', billable_tokens: '605700', estimated_cost_cny: '16.959600',
      }]);
      if (text.includes('FROM provider_pricing_rules')) return rows([]);
      if (text.includes('FROM provider_resource_package_snapshots')) return rows([]);
      if (text.includes('AS timing_tokens')) return rows([{ timing_tokens: '0', timing_cost_cny: '0' }]);
      if (text.includes('opening_prepaid_asset_cny')) return rows([{
        incomplete_rows: 0, row_count: 0, event_rows: 0, opening_catch_up_rows: 0,
      }]);
      if (text.includes('FROM provider_operational_usage_records')) return rows([]);
      if (text.includes('business_task_aggregates AS')) return rows([]);
      throw new Error(`未预期 SQL：${text}`);
    });
    const dashboard = await getAdminApiCostDashboard(
      { query: dashboardQuery } as unknown as DbClient,
      { range: 'date', date: '2026-07-13', asOf },
    );
    expect(() => endpointContracts.adminApiUsage.response.parse(dashboard)).not.toThrow();
    expect(dashboard.coverage).toMatchObject({
      local: { status: 'complete' }, official: { status: 'unavailable' },
      comparable: { status: 'unavailable' },
    });
    expect(dashboard.summary).toMatchObject({
      localBillableTokens: 605_700, localEstimatedCostCny: '16.959600',
      officialBillableTokens: null, officialListEquivalentCostCny: null,
      tokenDelta: null, costDeltaCny: null, localCostUnderstatementPercent: null,
    });
    expect(dashboard.books.usage).toMatchObject({
      rawLocalTokens: null, adjustedLocalTokens: null, officialTokens: null, residualTokens: null,
    });
    expect(dashboard.books.valuation).toMatchObject({
      rawLocalCostCny: null, adjustedLocalCostCny: null,
      officialListEquivalentCostCny: null, residualCostCny: null,
    });
    expect(dashboard.models.map(model => model.model)).toEqual([
      'Seedance 2.5', 'Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini',
    ]);
    expect(dashboard.models[1]).toMatchObject({
      model: 'Seedance 2.0', estimatedCostCny: '16.959600', officialBillableTokens: null,
      successfulOutputSeconds: 5, costPerSuccessfulVideoCny: '16.959600',
      costPerOutputSecondCny: '3.391920',
    });
    expect(dashboard.models[0]).toMatchObject({
      successfulVideoCount: 0, averageSuccessfulTaskCostCny: null,
      costPerSuccessfulVideoCny: null, costPerOutputSecondCny: null,
    });
    const modelSql = dashboardQuery.mock.calls.map(([sql]) => String(sql))
      .find(sql => sql.includes('successful_output_seconds'))!;
    expect(modelSql).toContain('output_asset.duration_seconds');
    expect(modelSql).toContain("output_asset.generation_meta->>'durationSource' = 'media-probe'");
    expect(modelSql).toContain('output_asset.created_at <= $4');
    expect(modelSql).not.toContain("success_task.config->>'durationSeconds'");
    expect(modelSql).toContain('count(outputs.duration_seconds) = count(*)');
    expect(dashboard.daily).toEqual([expect.objectContaining({
      day: '2026-07-13', localBillableTokens: 605_700,
      localEstimatedCostCny: '16.959600', officialBillableTokens: null,
    })]);

    const taskQuery = vi.fn(async (sql: unknown, params?: unknown[]) => {
      if (String(sql).includes('AS local_start')) return observedLocalOnly;
      expect(params?.slice(0, 4)).toEqual([
        'volcengine-ark', ['Seedance 2.5', 'Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini'],
        '2026-07-13', '2026-07-13',
      ]);
      return rows([businessTaskRow('16.959600')]);
    });
    const tasks = await listAdminApiCostTasks({ query: taskQuery } as unknown as DbClient, {
      range: 'date', date: '2026-07-13', limit: 20, asOf,
    });
    expect(tasks.items).toHaveLength(1);
    expect(tasks.selection).toMatchObject({ rangeStart: '2026-07-13', rangeEnd: '2026-07-13' });

    const userQuery = vi.fn(async (sql: unknown, params?: unknown[]) => {
      if (String(sql).includes('AS local_start')) return observedLocalOnly;
      expect(params?.[2]).toBe('2026-07-13');
      return rows([{
        id: userId, user_id: userId, user_name: '测试用户', email: 'user@example.com',
        task_count: 1, successful_tasks: 1, failed_tasks: 0, canceled_tasks: 0,
        settled_credits: 100, refunded_credits: 0, billable_tokens: '605700',
        estimated_cost_cny: '16.959600', business_estimated_cost_cny: '16.959600',
        operational_estimated_cost_cny: '0.000000', operational_call_count: 0,
        operational_unpriced_call_count: 0, incomplete_task_count: 0,
        last_task_at: '2026-07-13T06:00:00.000Z',
        last_activity_at: '2026-07-13T06:00:00.000Z',
        __pagination_total_count: null,
        __pagination_cursor_timestamp: '2026-07-13T06:00:00.000000Z',
      }]);
    });
    const users = await listAdminApiCostUsers({ query: userQuery } as unknown as DbClient, {
      range: 'date', date: '2026-07-13', limit: 20, asOf,
    });
    expect(users.items).toEqual([expect.objectContaining({
      userId, billableTokens: 605_700, estimatedCostCny: '16.959600',
      businessEstimatedCostCny: '16.959600', operationalCallCount: 0,
      lastActivityAt: '2026-07-13T06:00:00.000Z',
    })]);
  });

  it('官方已覆盖但本地未覆盖时分开官方账单状态与正式对账状态', async () => {
    const asOf = '2026-07-13T06:00:00.000Z';
    const official = officialRevision({
      sourceDetailKey: 'official-only-usage', billLineType: 'usage', recognizedModel: 'Seedance 2.0',
      billableTokens: '100', deductionCount: '100', listEquivalentCostCny: '0.004600',
      originalBillAmountCny: '0', payableAmountCny: '0', paidAmountCny: '0', unpaidAmountCny: '0',
      expenseDate: '2026-07-13',
    });
    const renamedCandidate = officialRevision({
      sourceDetailKey: 'official-renamed-seedance', billLineType: 'usage', recognizedModel: null,
      seedanceCandidate: true, billableTokens: '50', deductionCount: '50', listEquivalentCostCny: null,
      originalBillAmountCny: '0', payableAmountCny: '0', paidAmountCny: '0', unpaidAmountCny: '0',
      expenseDate: '2026-07-13',
    });
    const resolveQuery = async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return rows([{
        local_start: null, local_end: null, official_start: '2026-07-13', official_end: '2026-07-13',
        local_intervals: [], official_intervals: [{
          start: '2026-07-13', end: '2026-07-13', billState: 'provisional', isFinal: false,
        }],
      }]);
      if (text.includes('FROM provider_account_balance_snapshots')) return rows([]);
      if (text.includes('FROM provider_billing_sync_runs') && text.includes('WITH ranked AS')) {
        return rows([syncRun('bill', asOf)]);
      }
      if (text.includes('today_estimated_cost_cny')) return rows([{
        billable_tokens: '0', estimated_cost_cny: '0', raw_billable_tokens: '0',
        raw_estimated_cost_cny: '0', inferred_adjustment_tokens: '0', inferred_adjustment_cost_cny: '0',
        comparable_billable_tokens: '0', comparable_estimated_cost_cny: '0',
        comparable_raw_billable_tokens: '0', comparable_raw_estimated_cost_cny: '0',
        comparable_inferred_adjustment_tokens: '0', comparable_inferred_adjustment_cost_cny: '0',
        today_estimated_cost_cny: '0', month_estimated_cost_cny: '0',
      }]);
      if (text.includes('WITH selected_dates AS')) return rows([official, renamedCandidate]);
      if (text.includes('successful_estimated_cost_cny')) return rows([]);
      if (text.includes('GROUP BY day')) return rows([]);
      if (text.includes('FROM provider_pricing_rules')) return rows([]);
      if (text.includes('FROM provider_resource_package_snapshots')) return rows([]);
      if (text.includes('AS timing_tokens')) return rows([{ timing_tokens: '0', timing_cost_cny: '0' }]);
      if (text.includes('opening_prepaid_asset_cny')) return rows([{
        incomplete_rows: 0, row_count: 0, event_rows: 0, opening_catch_up_rows: 0,
        uncertain_time_rows: 0,
      }]);
      if (text.includes('FROM provider_operational_usage_records')) return rows([]);
      if (text.includes('business_task_aggregates AS')) return rows([]);
      throw new Error(`未预期 SQL：${text}`);
    };
    const queryProbe = serialQueryProbe(resolveQuery);
    const query = queryProbe.query;

    const dashboard = await getAdminApiCostDashboard({ query } as unknown as DbClient, {
      range: 'date', date: '2026-07-13', asOf,
    });
    expect(queryProbe.peakActive()).toBe(1);
    expect(() => endpointContracts.adminApiUsage.response.parse(dashboard)).not.toThrow();
    expect(dashboard.combinedStatus).toMatchObject({
      billState: 'unavailable', matchState: 'cannot-reconcile', coverageState: 'unavailable',
    });
    expect(dashboard.summary).toMatchObject({
      billStatus: 'provisional', localBillableTokens: null, localEstimatedCostCny: null,
      todayEstimatedCostCny: null, monthEstimatedCostCny: null,
      officialBillableTokens: 150, officialUnpricedRows: 1, officialUnpricedTokens: 50,
      officialListEquivalentCostCny: null,
      officialPayableAmountCny: '0.000000', tokenDelta: null, costDeltaCny: null,
    });
    expect(dashboard.models.map(model => model.model)).toEqual([
      'Seedance 2.5', 'Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini',
    ]);
    expect(dashboard.models[1]).toMatchObject({
      model: 'Seedance 2.0', billableTokens: null, estimatedCostCny: null,
      successfulVideoCount: null, successfulOutputSeconds: null,
      costPerSuccessfulVideoCny: null, costPerOutputSecondCny: null,
      officialBillableTokens: 100,
    });
    expect(dashboard.daily).toEqual([expect.objectContaining({
      localBillableTokens: null, officialBillableTokens: 150,
    })]);
    expect(dashboard.summary.noPackageProjectionStatus).toBe('unpriced');
    const officialSql = query.mock.calls.map(([sql]) => String(sql))
      .find(sql => sql.includes('WITH selected_dates AS'))!;
    expect(officialSql).toContain("normalized_payload->>'seedanceCandidate' = 'true'");
    expect(officialSql).toContain("LIKE '%seedance%'");
  });

  it('attempt 接口按北京时间过滤、成本服务端排序并返回固定六位金额及游标', async () => {
    const query = vi.fn(async (sql: unknown, _params?: unknown[]) => {
      if (String(sql).includes('AS local_start')) return coverageRows('2026-07-13', '2026-07-13');
      return rows([taskRow('16.959600'), taskRow('12.021300', {
        id: '00000000-0000-4000-8000-000000000004',
        task_id: '00000000-0000-4000-8000-000000000005',
        model: 'Seedance 2.0 Fast',
      })]);
    });
    const client = { query } as unknown as DbClient;
    const filters = {
      from: '2026-07-13', to: '2026-07-13', search: '测试', limit: 1,
    } as const;
    const first = await listAdminApiCostAttempts(client, filters);

    expect(first.items).toEqual([expect.objectContaining({
      taskId,
      attempt: -1,
      completionTokens: 605700,
      totalTokens: 610000,
      billableTokens: 605700,
      billableBasis: 'raw_units_legacy',
      unitPriceCnyPerMillion: '28.000000',
      estimatedCostCny: '16.959600',
      estimateStatus: 'legacy-inferred',
      usageEvidenceOrigin: 'legacy-raw',
      pricingRuleStatus: 'priced',
    })]);
    expect(first.pagination).toMatchObject({
      limit: 1, hasPrevious: false, hasNext: true, previousCursor: null,
    });
    const taskCall = query.mock.calls.find(([sql]) => String(sql).includes('SELECT pur.id'))!;
    const [sql, params] = taskCall;
    expect(String(sql)).toContain("AT TIME ZONE 'Asia/Shanghai'");
    expect(String(sql)).toContain('ORDER BY coalesce(pur.estimated_cost');
    expect(String(sql)).toContain('count(*) OVER()::bigint AS __pagination_total_count');
    expect(String(sql)).not.toMatch(/\bOFFSET\b/i);
    const cursorTuple = String(sql).split('), page_attempts AS (')[1]?.split('ORDER BY')[0] ?? '';
    expect(cursorTuple.match(/coalesce\(pur\.estimated_cost/g)).toHaveLength(1);
    expect(cursorTuple.match(/coalesce\(pur\.billable_tokens/g)).toHaveLength(1);
    expect(cursorTuple).toContain('pur.id');
    expect(params?.slice(0, 2)).toEqual([['2026-07-13'], '测试']);
    expect(params?.at(-1)).toBe(2);

    const second = await listAdminApiCostAttempts(client, {
      ...filters, position: 'next', cursor: first.pagination.nextCursor!,
    });
    const taskCalls = query.mock.calls.filter(([sql]) => String(sql).includes('SELECT pur.id'));
    expect(taskCalls[1]?.[1]?.at(-1)).toBe(2);
    expect(second.pagination).toMatchObject({ hasPrevious: true, previousCursor: expect.any(String) });
    await listAdminApiCostAttempts(client, {
      ...filters, position: 'previous', cursor: second.pagination.previousCursor!,
    });
    const previousSql = query.mock.calls
      .filter(([sql]) => String(sql).includes('SELECT pur.id'))
      .at(-1)?.[0];
    expect(String(previousSql)).toContain(') > (');
    expect(String(previousSql)).toContain('pur.id ASC');

    query.mockClear();
    const last = await listAdminApiCostAttempts(client, { ...filters, position: 'last' });
    const lastCalls = query.mock.calls.filter(([sql]) => String(sql).includes('SELECT pur.id'));
    expect(lastCalls).toHaveLength(1);
    expect(String(lastCalls[0]?.[0])).toContain('pur.id ASC');
    expect(last.pagination).toMatchObject({ hasNext: false, nextCursor: null });
    await expect(listAdminApiCostAttempts(client, {
      ...filters, position: 'next', cursor: first.pagination.nextCursor!, asOf: 'not-a-date',
    })).rejects.toMatchObject({ code: 'INVALID_AS_OF', statusCode: 400 });
    await expect(listAdminApiCostAttempts(client, {
      ...filters, search: '其他筛选', position: 'next', cursor: first.pagination.nextCursor!,
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR', statusCode: 400 });
    await expect(listAdminApiCostAttempts(client, {
      ...filters, cursor: first.pagination.nextCursor!,
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR', statusCode: 400 });
    await expect(listAdminApiCostAttempts(client, {
      ...filters, position: 'next',
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR', statusCode: 400 });
    const cursorEnvelope = JSON.parse(
      Buffer.from(first.pagination.nextCursor!, 'base64url').toString('utf8'),
    ) as { payload: string; signature: string };
    const tamperedCursor = Buffer.from(JSON.stringify({
      ...cursorEnvelope,
      signature: `${cursorEnvelope.signature.slice(0, -1)}${cursorEnvelope.signature.endsWith('0') ? '1' : '0'}`,
    }), 'utf8').toString('base64url');
    await expect(listAdminApiCostAttempts(client, {
      ...filters, position: 'next', cursor: tamperedCursor,
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR', statusCode: 400 });
  });

  it('attempt 接口把无站内任务的 Provider 调用归属到管理员用户账本', async () => {
    const query = vi.fn(async (sql: unknown) => {
      if (String(sql).includes('AS local_start')) return coverageRows('2026-07-26', '2026-07-26');
      return rows([taskRow('12.496275', {
        task_id: null,
        origin: 'admin-direct',
        task_status: null,
        provider_task_id: 'cgt-20260726032941-6xzlt',
        attempt: 0,
        email: 'admin@lindyson.com',
        completion_tokens: '245025',
        total_tokens: '245025',
        billable_tokens: '245025',
        billable_basis: 'completion_tokens',
        resolution: '1080p',
        has_video_input: false,
        unit_price_per_million: '51',
        pricing_status: 'priced',
        usage_evidence_origin: 'provider-reported',
        pricing_input_class: 'without-video',
        pricing_resolution_band: '1080p',
        attribution_confidence: 'direct',
        local_accounting_date: '2026-07-26',
      })]);
    });

    const result = await listAdminApiCostAttempts({ query } as unknown as DbClient, {
      range: 'date', date: '2026-07-26', limit: 20,
    });

    expect(() => endpointContracts.adminApiUsageAttempts.response.parse(result)).not.toThrow();
    expect(result.items[0]).toMatchObject({
      taskId: null,
      origin: 'admin-direct',
      providerTaskId: 'cgt-20260726032941-6xzlt',
      email: 'admin@lindyson.com',
      billableTokens: 245025,
      estimatedCostCny: '12.496275',
    });
    const attemptSql = query.mock.calls.map(([sql]) => String(sql)).find(sql => sql.includes('SELECT pur.id'))!;
    expect(attemptSql).toContain('coalesce(gt.user_id, pur.initiated_by_admin_user_id)');
    expect(attemptSql).toContain('pur.initiated_by_admin_user_id IS NOT NULL');
  });

  it.each([
    { total: 0, expected: 0 },
    { total: 10, expected: 10 },
    { total: 20, expected: 20 },
    { total: 21, expected: 1 },
    { total: 40, expected: 20 },
    { total: 50, expected: 10 },
  ])('标准尾页矩阵：$total 条返回 $expected 条', async ({ total, expected }) => {
    let pageSql = '';
    const query = vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return coverageRows('2026-07-13', '2026-07-13');
      pageSql = text;
      const resultRows = Array.from({ length: Math.min(total, 21) }, (_, index) => (
        paginationAttemptRow(total - index, String(total))
      ));
      return rows(resultRows);
    });

    const result = await listAdminApiCostAttempts({ query } as unknown as DbClient, {
      from: '2026-07-13', to: '2026-07-13', position: 'last', limit: 20,
      asOf: '2026-07-13T06:00:00.000Z',
    });

    expect(result.items).toHaveLength(expected);
    expect(result.pagination).toMatchObject({
      limit: 20, hasPrevious: total > expected, hasNext: false, nextCursor: null,
    });
    expect(pageSql).toContain('count(*) OVER()::bigint AS __pagination_total_count');
    expect(pageSql).not.toMatch(/\bOFFSET\b/i);
  });

  it('50/20 从尾页连续向前得到 10、20、20 且无重复遗漏乱序', async () => {
    const ordered = Array.from({ length: 50 }, (_, index) => paginationAttemptRow(index + 1, null));
    const pageResults = [
      [...ordered].reverse().slice(0, 21).map(row => ({ ...row, __pagination_total_count: '50' })),
      ordered.slice(0, 40).reverse().slice(0, 21),
      ordered.slice(0, 20).reverse(),
    ];
    let pageCall = 0;
    const query = vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return coverageRows('2026-07-13', '2026-07-13');
      return rows(pageResults[pageCall++] ?? []);
    });
    const client = { query } as unknown as DbClient;
    const filters = {
      from: '2026-07-13', to: '2026-07-13', limit: 20,
      asOf: '2026-07-13T06:00:00.000Z',
    } as const;

    const last = await listAdminApiCostAttempts(client, { ...filters, position: 'last' });
    const middle = await listAdminApiCostAttempts(client, {
      ...filters, position: 'previous', cursor: last.pagination.previousCursor!,
    });
    const first = await listAdminApiCostAttempts(client, {
      ...filters, position: 'previous', cursor: middle.pagination.previousCursor!,
    });

    expect([last.items.length, middle.items.length, first.items.length]).toEqual([10, 20, 20]);
    const ids = [...first.items, ...middle.items, ...last.items].map(item => item.id);
    expect(ids).toEqual(ordered.map(row => row.id));
    expect(new Set(ids).size).toBe(50);
    expect(first.pagination.hasPrevious).toBe(false);
    expect(last.pagination.hasNext).toBe(false);
  });

  it('attempt 游标保留同毫秒内的 PostgreSQL 微秒，并用 UUID 继续解开同时间边界', async () => {
    const boundaryId = paginationUuid(2);
    let pageCall = 0;
    let secondParams: unknown[] = [];
    let firstSql = '';
    const boundaryRows = [
      taskRow('16.959600', {
        id: boundaryId,
        __pagination_total_count: null,
        __pagination_cursor_timestamp: '2026-07-13T06:00:00.123456Z',
      }),
      taskRow('16.959600', {
        id: paginationUuid(1),
        __pagination_total_count: null,
        __pagination_cursor_timestamp: '2026-07-13T06:00:00.123456Z',
      }),
    ];
    const query = vi.fn(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return coverageRows('2026-07-13', '2026-07-13');
      pageCall += 1;
      if (pageCall === 1) {
        firstSql = text;
        return rows(boundaryRows);
      }
      secondParams = params ?? [];
      return rows([taskRow('1.000000', {
        id: paginationUuid(3),
        __pagination_total_count: null,
        __pagination_cursor_timestamp: '2026-07-13T05:59:59.999999Z',
      })]);
    });
    const client = { query } as unknown as DbClient;
    const filters = {
      from: '2026-07-13', to: '2026-07-13', limit: 1,
      asOf: '2026-07-13T06:00:01.000Z',
    } as const;
    const first = await listAdminApiCostAttempts(client, filters);
    await listAdminApiCostAttempts(client, {
      ...filters, position: 'next', cursor: first.pagination.nextCursor!,
    });

    expect(secondParams.slice(-5, -1)).toEqual([
      '16.959600', '605700', '2026-07-13T06:00:00.123456Z', boundaryId,
    ]);
    expect(firstSql).toContain("to_char(coalesce(pur.completed_at, pur.created_at) AT TIME ZONE 'UTC'");
    expect(firstSql).toContain('coalesce(pur.completed_at, pur.created_at),');
  });

  it('首次成本快照在旧测试行未回填内部总数时仍建立精确单页元数据', async () => {
    const query = vi.fn(async (sql: unknown) => {
      if (String(sql).includes('AS local_start')) return coverageRows('2026-07-13', '2026-07-13');
      return rows([paginationAttemptRow(1, null)]);
    });

    const result = await listAdminApiCostAttempts({ query } as unknown as DbClient, {
      from: '2026-07-13', to: '2026-07-13', position: 'last', limit: 20,
      asOf: '2026-07-13T06:00:00.000Z',
    });
    expect(result.pagination).toMatchObject({
      currentPage: 1, totalPages: 1, totalItems: 1,
      snapshotCursor: expect.any(String),
    });
  });

  it('tasks、users、reconciliation、settlement 首次尾页快照都精确计数并使用标准余数', async () => {
    const asOf = '2026-07-13T06:00:00.000Z';
    const lastSql: string[] = [];
    const taskQuery = vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return coverageRows('2026-07-01', '2026-07-13');
      lastSql.push(text);
      return rows(Array.from({ length: 21 }, (_, index) => businessTaskRow('1.000000', {
        id: paginationUuid(100 + index),
        __pagination_total_count: '50',
        __pagination_cursor_timestamp: `2026-07-13T05:00:${String(index).padStart(2, '0')}.000000Z`,
      })));
    });
    const tasks = await listAdminApiCostTasks({ query: taskQuery } as unknown as DbClient, {
      range: 'date', date: '2026-07-13', position: 'last', limit: 20, asOf,
    });

    const userQuery = vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return coverageRows('2026-07-01', '2026-07-13');
      lastSql.push(text);
      return rows(Array.from({ length: 21 }, (_, index) => businessUserRow(index, '50')));
    });
    const users = await listAdminApiCostUsers({ query: userQuery } as unknown as DbClient, {
      range: 'date', date: '2026-07-13', position: 'last', limit: 20, asOf,
    });

    const reconciliationQuery = vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return coverageRows('2026-07-01', '2026-07-13');
      lastSql.push(text);
      return rows(Array.from({ length: 21 }, (_, index) => ({
        ...reconciliationBucket(paginationUuid(200 + index)),
        __pagination_total_count: '50',
      })));
    });
    const reconciliation = await listAdminApiCostReconciliation(
      { query: reconciliationQuery } as unknown as DbClient,
      { range: 'date', date: '2026-07-13', position: 'last', limit: 20, asOf },
    );

    const settlementQuery = vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return coverageRows('2026-07-01', '2026-07-13');
      if (text.includes('page_rows AS')) {
        lastSql.push(text);
        const details = Array.from({ length: 21 }, (_, index) => officialRevision({
          sourceDetailKey: `usage-tail-${String(index).padStart(2, '0')}`,
          billLineType: 'usage', recognizedModel: 'Seedance 2.0', billableTokens: '100',
          deductionCount: '100', listEquivalentCostCny: '0.004600', originalBillAmountCny: '0',
          payableAmountCny: String(21 - index), paidAmountCny: '0', unpaidAmountCny: String(21 - index),
          expenseDate: '2026-07-13',
        }));
        return settlementSnapshotRows(details, { __pagination_total_count: '50' });
      }
      if (text.includes('opening_prepaid_asset_cny')) return rows([emptyPackageLedger()]);
      throw new Error(`未预期 SQL：${text}`);
    });
    const settlement = await listAdminApiCostSettlement(
      { query: settlementQuery } as unknown as DbClient,
      { range: 'date', date: '2026-07-13', position: 'last', limit: 20, asOf },
    );

    expect([tasks.items.length, users.items.length, reconciliation.items.length, settlement.items.length])
      .toEqual([10, 10, 10, 10]);
    expect(lastSql).toHaveLength(4);
    for (const sql of lastSql) {
      expect(sql).toContain('count(*) OVER()::bigint AS __pagination_total_count');
      expect(sql).not.toMatch(/\bOFFSET\b/i);
    }
  });

  it('经营任务接口按创建日汇总 attempt、积分和已知成本小计', async () => {
    const asOf = '2026-07-13T06:00:00.000Z';
    const olderTaskId = '00000000-0000-4000-8000-000000000004';
    const query = vi.fn(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return coverageRows('2026-07-01', '2026-07-13');
      expect(text).toContain("gt.created_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Shanghai')");
      expect(text).toContain("gt.created_at < (($4::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')");
      expect(text).toContain('ORDER BY task.created_at DESC, task.id DESC');
      expect(text).not.toContain('ORDER BY task.estimated_cost_cny');
      expect(text).toContain("to_char(task.created_at AT TIME ZONE 'UTC'");
      expect(text).not.toMatch(/\bOFFSET\b/i);
      expect(params?.slice(2, 5)).toEqual(['2026-07-01', '2026-07-13', asOf]);
      return rows([
        businessTaskRow('16.959600', {
          attempt_count: 2, missing_usage_attempts: 1, cost_finalized: false,
        }),
        businessTaskRow('99.000000', {
          id: olderTaskId, created_at: '2026-07-12T05:00:00.000Z',
        }),
      ]);
    });
    const filters = {
      range: 'custom', from: '2026-07-01', to: '2026-07-13', limit: 1, asOf,
    } as const;
    const result = await listAdminApiCostTasks({ query } as unknown as DbClient, filters);
    expect(() => endpointContracts.adminApiUsageTasks.response.parse(result)).not.toThrow();
    expect(result.selection).toMatchObject({
      range: 'custom', rangeStart: '2026-07-01', rangeEnd: '2026-07-13', grain: 'day',
    });
    expect(result.items[0]).toMatchObject({
      id: taskId, taskId, attemptCount: 2, configuredCredits: 100,
      priceVersions: ['volcengine-seedance-2026-07-10'],
      settledCredits: 100, billableTokens: 605700, estimatedCostCny: '16.959600',
      missingUsageAttempts: 1, estimateCompleteness: 'partial', costFinalized: false,
    });
    expect(result.pagination).toMatchObject({
      limit: 1, hasPrevious: false, hasNext: true, previousCursor: null,
    });
    await listAdminApiCostTasks({ query } as unknown as DbClient, {
      ...filters, position: 'next', cursor: result.pagination.nextCursor!,
    });
    const taskCalls = query.mock.calls.filter(([sql]) => String(sql).includes('business_task_costs task'));
    expect(String(taskCalls[0]?.[0])).toContain('count(*) OVER()::bigint AS __pagination_total_count');
    expect(String(taskCalls[1]?.[0])).toContain('NULL::bigint AS __pagination_total_count');
    expect(taskCalls[1]?.[1]?.slice(5, 7)).toEqual([
      '2026-07-13T05:00:00.000000Z', taskId,
    ]);
    expect(taskCalls[1]?.[1]?.at(-1)).toBe(2);
  });

  it('最终账单批准的零成本案件补全任务成本但不伪造 Token', async () => {
    const query = vi.fn(async (sql: unknown) => {
      const text = String(sql);
      expect(text).toContain("cases.evidence->>'resolutionKind' = 'zero-cost'");
      expect(text).toContain("cases.status IN ('open', 'approved')");
      expect(text).toContain('attempt_count - known_usage_attempts - approved_zero_attempts');
      expect(text).toContain('pending_final_bill_case_id');
      return rows([businessTaskRow('0.000000', {
        status: 'failed', billable_tokens: '0', settled_credits: 0, refunded_credits: 100,
        credit_status: 'refunded', missing_usage_attempts: 0, cost_finalized: true,
        cost_resolution_status: 'approved-zero', cost_resolution_case_id: zeroCostCaseId,
      })]);
    });

    const result = await listAdminApiCostTasks({ query } as unknown as DbClient, {
      range: 'custom', from: '2026-07-01', to: '2026-07-13', limit: 20,
      asOf: '2026-07-13T06:00:00.000Z',
    });

    expect(() => endpointContracts.adminApiUsageTasks.response.parse(result)).not.toThrow();
    expect(result.items[0]).toMatchObject({
      billableTokens: 0,
      estimatedCostCny: '0.000000',
      estimateCompleteness: 'complete',
      costFinalized: true,
      costResolutionStatus: 'approved-zero',
      costResolutionCaseId: zeroCostCaseId,
      missingUsageAttempts: 0,
    });
  });

  it('任务成本状态筛选在聚合完成后执行，unfinalized 同时覆盖待建案与待终账', async () => {
    const query = vi.fn(async (sql: unknown) => {
      const text = String(sql);
      expect(text).toContain('FROM business_task_costs task');
      expect(text).toContain("task.cost_resolution_status <> 'recorded'");
      expect(text).toContain("task.cost_resolution_status <> 'approved-zero'");
      expect(text.indexOf('business_task_costs AS')).toBeLessThan(text.indexOf('page_tasks AS'));
      return rows([]);
    });

    await listAdminApiCostTasks({ query } as unknown as DbClient, {
      range: 'month', month: '2026-07', costState: 'unfinalized', limit: 20,
      asOf: '2026-07-26T10:00:00.000Z',
    });

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('高级 attempt 保留零成本案件状态和证据，正 Token 证据优先记为 recorded', async () => {
    const openUsageId = '00000000-0000-4000-8000-000000000010';
    const approvedUsageId = '00000000-0000-4000-8000-000000000011';
    const query = vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return coverageRows('2026-07-13', '2026-07-13');
      expect(text).toContain('SELECT DISTINCT case_id');
      expect(text).toContain("cases.evidence->>'resolutionKind' = 'zero-cost'");
      return rows([
        taskRow('0.000000', {
          id: openUsageId, completion_tokens: null, total_tokens: null, billable_tokens: null,
          billable_basis: null, estimated_cost: null, pricing_status: 'unpriced',
          cost_resolution_case_id: zeroCostCaseId, cost_resolution_case_status: 'open',
          cost_resolution_evidence: {
            resolutionKind: 'zero-cost',
            review: { status: 'pending-final-bill' },
          },
        }),
        taskRow('0.000000', {
          id: approvedUsageId, completion_tokens: null, total_tokens: null, billable_tokens: null,
          billable_basis: null, estimated_cost: null, pricing_status: 'unpriced',
          cost_resolution_case_id: zeroCostCaseId, cost_resolution_case_status: 'approved',
          cost_resolution_evidence: {
            resolutionKind: 'zero-cost',
            review: { status: 'approved-zero' },
          },
        }),
        taskRow('16.959600', {
          cost_resolution_case_id: zeroCostCaseId, cost_resolution_case_status: 'superseded',
          cost_resolution_evidence: {
            resolutionKind: 'zero-cost',
            review: { status: 'reopened' },
          },
        }),
      ]);
    });

    const result = await listAdminApiCostAttempts({ query } as unknown as DbClient, {
      from: '2026-07-13', to: '2026-07-13', limit: 20,
    });

    expect(() => endpointContracts.adminApiUsageAttempts.response.parse(result)).not.toThrow();
    expect(result.items.map(item => item.costResolutionStatus)).toEqual([
      'pending-final-bill', 'approved-zero', 'recorded',
    ]);
    expect(result.items[0]).toMatchObject({
      costResolutionCaseId: zeroCostCaseId,
      costResolutionCaseStatus: 'open',
      costResolutionEvidence: {
        resolutionKind: 'zero-cost',
        review: { status: 'pending-final-bill' },
      },
    });
    expect(result.items[2]).toMatchObject({
      billableTokens: 605700,
      costResolutionCaseStatus: 'superseded',
      costResolutionStatus: 'recorded',
    });
  });

  it('用户接口按任务创建范围汇总积分、成本和完整性', async () => {
    const query = vi.fn(async (sql: unknown, _params?: unknown[]) => {
      if (String(sql).includes('AS local_start')) return coverageRows('2026-07-01', '2026-07-13');
      return rows([{
        id: userId, user_id: userId, user_name: '测试用户', email: 'user@example.com',
        task_count: 2, successful_tasks: 1, failed_tasks: 1, canceled_tasks: 0,
        settled_credits: 100, refunded_credits: 50,
        billable_tokens: '930600', estimated_cost_cny: '28.980900',
        business_estimated_cost_cny: '28.980900', operational_estimated_cost_cny: '0.000000',
        operational_call_count: 0, operational_unpriced_call_count: 0, incomplete_task_count: 1,
        last_task_at: '2026-07-13T06:00:00.000Z',
        last_activity_at: '2026-07-13T06:00:00.000Z',
        __pagination_total_count: null,
        __pagination_cursor_timestamp: '2026-07-13T06:00:00.000000Z',
      }]);
    });
    const result = await listAdminApiCostUsers({ query } as unknown as DbClient, {
      from: '2026-07-01', to: '2026-07-13', model: 'Seedance 2.0', limit: 20,
    });

    expect(() => endpointContracts.adminApiUsageUsers.response.parse(result)).not.toThrow();
    expect(result.items[0]).toMatchObject({
      userId, name: '测试用户', taskCount: 2, successfulTasks: 1, failedTasks: 1,
      settledCredits: 100, refundedCredits: 50,
      billableTokens: 930600, estimatedCostCny: '28.980900',
      businessEstimatedCostCny: '28.980900', operationalEstimatedCostCny: '0.000000',
      knownAccountCostCny: '28.980900', operationalCallCount: 0,
      operationalUnpricedCallCount: 0,
      averageTaskCostCny: '14.490450', incompleteTaskCount: 1, estimateCompleteness: 'partial',
      lastActivityAt: '2026-07-13T06:00:00.000Z',
    });
    const userSql = query.mock.calls.map(([sql]) => String(sql)).find(sql => sql.includes('aggregated_users AS'))!;
    expect(userSql).toContain("gt.created_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Shanghai')");
    expect(userSql).toContain('operational_sources AS');
    expect(userSql).toContain('usage.initiated_by_admin_user_id AS user_id');
    expect(userSql).toContain('FROM provider_operational_usage_records usage');
    expect(userSql).toContain('UNION ALL');
    expect(userSql).toContain('FULL OUTER JOIN operational_user_costs operational');
    expect(userSql).toContain('count(*) FILTER (WHERE NOT task.cost_finalized)');
    expect(userSql).toContain('ORDER BY users.estimated_cost_cny DESC');
    expect(userSql).toContain('count(*) OVER()::bigint AS __pagination_total_count');
    expect(userSql).toContain("to_char(users.last_activity_at AT TIME ZONE 'UTC'");
    expect(userSql).not.toMatch(/\bOFFSET\b/i);
  });

  it('管理员普通用户汇总可精确承载三次首页 Seedance Provider 用量', async () => {
    const query = vi.fn(async (sql: unknown) => {
      if (String(sql).includes('AS local_start')) return coverageRows('2026-07-26', '2026-07-26');
      return rows([{
        id: userId, user_id: userId, user_name: '管理员', email: 'admin@lindyson.com',
        task_count: 0, successful_tasks: 0, failed_tasks: 0, canceled_tasks: 0,
        settled_credits: 0, refunded_credits: 0,
        billable_tokens: '735075', estimated_cost_cny: '37.488825',
        business_estimated_cost_cny: '0.000000', operational_estimated_cost_cny: '37.488825',
        operational_call_count: 3, operational_unpriced_call_count: 0, incomplete_task_count: 0,
        last_task_at: null, last_activity_at: '2026-07-25T19:33:45.000Z',
        __pagination_total_count: null,
        __pagination_cursor_timestamp: '2026-07-25T19:33:45.000000Z',
      }]);
    });

    const result = await listAdminApiCostUsers({ query } as unknown as DbClient, {
      range: 'date', date: '2026-07-26', model: 'Seedance 2.0', limit: 20,
    });

    expect(result.items).toEqual([expect.objectContaining({
      email: 'admin@lindyson.com', taskCount: 0, successfulTasks: 0, operationalCallCount: 3,
      settledCredits: 0, refundedCredits: 0,
      billableTokens: 735075, estimatedCostCny: '37.488825',
      businessEstimatedCostCny: '0.000000', operationalEstimatedCostCny: '37.488825',
      knownAccountCostCny: '37.488825', operationalUnpricedCallCount: 0,
      averageTaskCostCny: null, estimateCompleteness: 'complete', lastTaskAt: '-',
      lastActivityAt: '2026-07-25T19:33:45.000Z',
    })]);
  });

  it('对账详情按完整计价维度列出本地、官方与调整证据，并复用跨日调整口径', async () => {
    const bucketId = '00000000-0000-4000-8000-000000000006';
    const revisionId = '00000000-0000-4000-8000-000000000007';
    const adjustmentId = '00000000-0000-4000-8000-000000000008';
    const official = officialRevision({
      sourceDetailKey: 'Detail-cross-date', billLineType: 'usage', recognizedModel: 'Seedance 2.0 Mini',
      billableTokens: '50638', deductionCount: '50638', listEquivalentCostCny: '1.164674',
      originalBillAmountCny: '0', payableAmountCny: '0', paidAmountCny: '0', unpaidAmountCny: '0',
    });
    official.revision_id = revisionId;
    official.normalized_payload.normalizedUnitPricePerMillion = '23';
    const resolveQuery = async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('WHERE b.id = $1')) return rows([reconciliationBucket(bucketId)]);
      if (text.includes('links.allocated_tokens * shifted.direction')) {
        return rows([{ timing_tokens: '50638', timing_cost_cny: '1.164674' }]);
      }
      if (text.includes("'local'::text AS side")) return rows([{
        id: usageId, side: 'local', usage_record_id: usageId, bill_detail_revision_id: null,
        task_id: taskId, provider_task_id: 'provider-task-1', source_detail_key: null,
        allocated_tokens: '100', allocated_cost_cny: '0.002300', cause: null,
        confidence: 'direct', evidence: { usageEvidenceOrigin: 'provider-reported' },
      }]);
      if (text.includes("'zero-cost-candidate'::text AS side")) return rows([{
        id: '00000000-0000-4000-8000-000000000012', side: 'zero-cost-candidate',
        usage_record_id: usageId, bill_detail_revision_id: null,
        task_id: taskId, provider_task_id: null, source_detail_key: null,
        allocated_tokens: '0', allocated_cost_cny: '0',
        cause: 'provider-rejected-before-billing', confidence: 'high',
        evidence: { caseStatus: 'open', auditScope: 'account-billing-bucket' },
      }]);
      if (text.includes("'adjustment'::text AS side")) return rows([{
        id: adjustmentId, side: 'adjustment', usage_record_id: usageId,
        bill_detail_revision_id: revisionId, task_id: taskId, provider_task_id: 'provider-task-1',
        source_detail_key: 'Detail-cross-date', allocated_tokens: '50638',
        allocated_cost_cny: '1.164674', cause: 'provider-accounting-cutoff',
        confidence: 'high', evidence: { note: '仅移动对账日期' },
      }, {
        id: '00000000-0000-4000-8000-000000000011', side: 'adjustment', usage_record_id: null,
        bill_detail_revision_id: revisionId, task_id: null, provider_task_id: null,
        source_detail_key: 'Detail-official-only', allocated_tokens: '100',
        allocated_cost_cny: '0.002300', cause: 'official-only-adjustment',
        confidence: 'unallocated', evidence: { note: '仅有官方不可变修订' },
      }]);
      if (text.includes('WITH selected_dates AS')) return rows([official]);
      throw new Error(`未预期 SQL：${text}`);
    };
    const queryProbe = serialQueryProbe(resolveQuery);
    const query = queryProbe.query;

    const detail = await getAdminApiCostReconciliationDetail(
      { query } as unknown as DbClient,
      bucketId,
      { asOf: '2026-07-13T06:00:00.000Z' },
    );
    expect(queryProbe.peakActive()).toBe(1);

    expect(() => endpointContracts.adminApiUsageReconciliationDetail.response.parse(detail)).not.toThrow();
    expect(detail.bucket).toMatchObject({
      timingShiftTokens: 50_638, residualTokens: 0, timingShiftCostCny: '1.164674',
      residualCostCny: '0.000000', matchState: 'adjusted-matched', attributionConfidence: 'high',
    });
    expect(detail.evidence.map(item => item.side)).toEqual([
      'local', 'zero-cost-candidate', 'official', 'adjustment', 'adjustment',
    ]);
    expect(detail.evidence[1]).toMatchObject({
      taskId, allocatedTokens: 0, cause: 'provider-rejected-before-billing',
      evidence: { caseStatus: 'open', auditScope: 'account-billing-bucket' },
    });
    expect(detail.evidence[2]).toMatchObject({
      billDetailRevisionId: revisionId, sourceDetailKey: 'Detail-cross-date', allocatedTokens: 50_638,
    });
    expect(detail.evidence[4]).toMatchObject({ usageRecordId: null, billDetailRevisionId: revisionId });
    const adjustmentSql = query.mock.calls.map(([sql]) => String(sql))
      .find(sql => sql.includes("'adjustment'::text AS side"))!;
    expect(adjustmentSql).toContain('provider_bill_detail_revisions revisions');
    expect(adjustmentSql).toContain("coalesce(usage.model, revisions.normalized_payload->>'recognizedModel')");
  });

  it('结算 unknown 筛选与展示使用同一支付状态规则', async () => {
    const official = officialRevision({
      sourceDetailKey: 'usage-unknown-payment', billLineType: 'usage', recognizedModel: 'Seedance 2.0',
      billableTokens: '100', deductionCount: '0', listEquivalentCostCny: null,
      originalBillAmountCny: '10', payableAmountCny: '10', paidAmountCny: '0', unpaidAmountCny: '0',
    });
    const query = vi.fn(async (sql: unknown, _params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return coverageRows('2026-07-01', '2026-07-01');
      if (text.includes('WITH selected_dates AS')) return settlementSnapshotRows([official], {
        usage_original_amount_cny: '10', usage_payable_amount_cny: '10',
        usage_paid_amount_cny: '0', usage_unpaid_amount_cny: '0',
        net_official_payable_cny: '10', list_price_status: 'unpriced',
      });
      if (text.includes('opening_prepaid_asset_cny')) return rows([{
        opening_prepaid_asset_cny: '10', acquisition_cost_cny: '0', amortized_cost_cny: '0',
        opening_catch_up_cny: '5', expiry_loss_cny: '0', adjustment_cny: '0', ending_prepaid_asset_cny: '5',
        incomplete_rows: 0, row_count: 1, event_rows: 1, opening_catch_up_rows: 1,
      }]);
      throw new Error(`未预期 SQL：${text}`);
    });

    const settlement = await listAdminApiCostSettlement({ query } as unknown as DbClient, {
      range: 'date', date: '2026-07-01', paymentStatus: 'unknown', limit: 20,
      asOf: '2026-07-13T06:00:00.000Z',
    });
    expect(() => endpointContracts.adminApiUsageSettlement.response.parse(settlement)).not.toThrow();
    expect(settlement.items).toEqual([expect.objectContaining({
      sourceDetailKey: 'usage-unknown-payment', paymentStatus: 'unknown', payableAmountCny: '10.000000',
    })]);
    expect(settlement.summary).toMatchObject({
      allocationStatus: 'complete', openingPrepaidAssetCny: '10.000000', amortizedCostCny: '0.000000',
      openingCatchUpCny: '5.000000', endingPrepaidAssetCny: '5.000000',
      timeAttributionStatus: 'partial',
      listPriceOffsetStatus: 'unpriced', listPriceOffsetValueCny: null,
    });
    const settlementCall = query.mock.calls.find(([sql]) => String(sql).includes('page_rows AS'))!;
    const settlementSql = String(settlementCall[0]);
    const settlementParams = settlementCall[1] as unknown[];
    expect(settlementSql).toContain('FROM summary');
    expect(settlementSql).toContain('rows.payment_status = $9');
    expect(settlementSql).toContain('$12::uuid');
    expect(settlementSql).toContain('rows.revision_id');
    expect(settlementSql).not.toContain('rows.source_detail_key COLLATE');
    expect(settlementSql).toContain('LIMIT $13');
    expect(settlementSql).toContain('count(*) OVER()::bigint AS __pagination_total_count');
    expect(settlementSql).not.toMatch(/\bOFFSET\b/i);
    expect(settlementSql).toContain('selected_dates AS MATERIALIZED');
    expect(settlementSql).toContain('valid_bill_runs AS MATERIALIZED');
    expect(settlementSql).toContain('selected_run_candidates AS');
    expect(settlementSql).toContain('runs.window_start <= $2::date');
    expect(settlementSql).toContain('runs.window_end >= $1::date');
    expect(settlementSql).not.toContain('evidenced_bill_runs');
    expect(settlementParams.slice(7)).toEqual([
      null, 'unknown', null, null, null, 21,
    ]);
  });

  it('本地零用量但已有对账快照的日期仍进入 comparable 并保留官方残差', async () => {
    const bucketId = '00000000-0000-4000-8000-000000000009';
    const query = vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return coverageRows('2026-07-01', '2026-07-01');
      if (text.includes('WITH timing_adjustments AS')) return rows([{
        ...reconciliationBucket(bucketId),
        raw_local_tokens: '0', adjusted_local_tokens: '0', official_tokens: '100',
        raw_local_cost_cny: '0', adjusted_local_cost_cny: '0', official_cost_cny: '0.002300',
        residual_tokens: '100', residual_cost_cny: '0.002300', status: 'residual',
      }]);
      throw new Error(`未预期 SQL：${text}`);
    });

    const result = await listAdminApiCostReconciliation({ query } as unknown as DbClient, {
      range: 'date', date: '2026-07-01', limit: 20, asOf: '2026-07-13T06:00:00.000Z',
    });
    expect(() => endpointContracts.adminApiUsageReconciliation.response.parse(result)).not.toThrow();
    expect(result.items).toEqual([expect.objectContaining({
      rawLocalTokens: 0, officialTokens: 100, residualTokens: 100, matchState: 'residual',
    })]);
    expect(String(query.mock.calls[0]?.[0])).toContain('local_cutoff <= $3');
    const reconciliationSql = query.mock.calls.map(([sql]) => String(sql))
      .find(sql => sql.includes('WITH timing_adjustments AS'))!;
    expect(reconciliationSql).toContain('selected_runs AS');
    expect(reconciliationSql).toContain('JOIN provider_reconciliation_buckets b ON b.reconciliation_run_id = selected.id');
    expect(reconciliationSql).not.toContain('PARTITION BY b.provider');
    expect(reconciliationSql).toContain('count(*) OVER()::bigint AS __pagination_total_count');
    expect(reconciliationSql).not.toMatch(/\bOFFSET\b/i);
    expect(reconciliationSql).toContain(
      'ORDER BY coalesce(computed.expense_date, computed.period_start) DESC',
    );
    expect(reconciliationSql).toContain(
      'coalesce(computed.expense_date, computed.period_start), abs(computed.residual_cost_cny)',
    );
  });

  it('资源包购置发生退款修订后不再误报为已关联', async () => {
    const revisionId = '00000000-0000-4000-8000-000000000010';
    const official = officialRevision({
      sourceDetailKey: 'package-revised', billLineType: 'package-purchase', recognizedModel: 'Seedance 2.0 Fast',
      billableTokens: null, deductionCount: null, listEquivalentCostCny: null,
      originalBillAmountCny: '198', payableAmountCny: '198', paidAmountCny: '198', unpaidAmountCny: '0',
    });
    official.revision_id = revisionId;
    const query = vi.fn(async (sql: unknown, _params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return coverageRows('2026-07-01', '2026-07-01');
      if (text.includes('WITH selected_dates AS')) return settlementSnapshotRows([official], {
        package_purchase_amount_cny: '198', package_purchase_paid_amount_cny: '198',
        package_purchase_unpaid_amount_cny: '0', refund_amount_cny: '-50',
        billing_adjustment_amount_cny: '2', net_official_payable_cny: '150',
      });
      if (text.includes('SELECT bill_source_detail_key')) return rows([{
        bill_source_detail_key: 'package-revised', package_id: 'package-fast-1',
        current_revision_id: revisionId, cost_basis_status: 'revised',
      }]);
      if (text.includes('opening_prepaid_asset_cny')) return rows([{
        opening_prepaid_asset_cny: '0', acquisition_cost_cny: '0', amortized_cost_cny: '0',
        expiry_loss_cny: '0', adjustment_cny: '0', ending_prepaid_asset_cny: '0',
        incomplete_rows: 1, row_count: 1, event_rows: 1, opening_catch_up_rows: 0,
        uncertain_time_rows: 1,
      }]);
      throw new Error(`未预期 SQL：${text}`);
    });

    const settlement = await listAdminApiCostSettlement({ query } as unknown as DbClient, {
      range: 'date', date: '2026-07-01', billLineType: 'package-purchase', limit: 20,
      asOf: '2026-07-13T06:00:00.000Z',
    });
    expect(settlement.items).toEqual([expect.objectContaining({
      sourceDetailKey: 'package-revised', packageId: null, acquisitionLinkStatus: 'missing',
    })]);
    expect(settlement.summary).toMatchObject({
      allocationStatus: 'partial', openingPrepaidAssetCny: null, amortizedCostCny: null,
      endingPrepaidAssetCny: null, refundAmountCny: '-50.000000',
      billingAdjustmentAmountCny: '2.000000', netOfficialPayableCny: '150.000000',
      timeAttributionStatus: 'partial',
      timeAttributionReason: '存在仅能证明额度已归零的终态证据，无法区分真实消费与到期损失',
    });
    const ledgerSql = query.mock.calls.map(([sql]) => String(sql))
      .find(sql => sql.includes('opening_prepaid_asset_cny'))!;
    expect(ledgerSql).toContain('acquisition_date <= $3::date');
    expect(ledgerSql).toContain('event_date <= $3::date');
    expect(ledgerSql).toContain('event_date BETWEEN $2::date AND $3::date');
    const settlementCall = query.mock.calls.find(([sql]) => String(sql).includes('page_rows AS'))!;
    expect(String(settlementCall[0])).toContain('rows.bill_line_type = $8');
    expect((settlementCall[1] as unknown[]).slice(7)).toEqual([
      'package-purchase', null, null, null, null, 21,
    ]);
  });

  it('官方从未同步时结算金额保持不可用而不是回退为零', async () => {
    const query = vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('AS local_start')) return rows([{
        local_start: null, local_end: null, official_start: null, official_end: null,
        local_intervals: [], official_intervals: [],
      }]);
      if (text.includes('WITH selected_dates AS')) return settlementSnapshotRows([]);
      if (text.includes('opening_prepaid_asset_cny')) return rows([{
        incomplete_rows: 0, row_count: 0, event_rows: 0, opening_catch_up_rows: 0,
      }]);
      throw new Error(`未预期 SQL：${text}`);
    });
    const settlement = await listAdminApiCostSettlement({ query } as unknown as DbClient, {
      range: 'date', date: '2026-07-01', limit: 20, asOf: '2026-07-13T06:00:00.000Z',
    });
    expect(settlement.summary).toMatchObject({
      coverageStatus: 'unavailable', usagePayableAmountCny: null, packagePurchaseAmountCny: null,
      listPriceOffsetValueCny: null, listPriceOffsetStatus: 'unavailable', refundAmountCny: null,
      billingAdjustmentAmountCny: null, netOfficialPayableCny: null,
    });
  });
});

function syncRun(kind: string, now: string) {
  return {
    kind, status: 'success', window_end: '2026-07-13', error: null, started_at: now, completed_at: now,
    last_success_at: now, last_success_window_end: '2026-07-13',
  };
}

function localModel(model: string, estimatedCost: string, patch: Record<string, unknown> = {}) {
  return {
    model, billable_tokens: '100', estimated_cost_cny: estimatedCost, successful_tasks: 1, failed_tasks: 0,
    attempt_count: 1, task_count: 1, successful_video_count: 1,
    failed_billable_tokens: '0', failed_estimated_cost_cny: '0', successful_estimated_cost_cny: estimatedCost,
    successful_output_seconds: null,
    without_video_cost_cny: estimatedCost, with_video_cost_cny: '0', unpriced_tasks: 0,
    unavailable_usage_attempts: 0, ...patch,
  };
}

function officialModel(model: string, tokens: string, cost: string) {
  return { model, billable_tokens: tokens, list_equivalent_cost_cny: cost, payable_amount_cny: '0' };
}

let officialRevisionSequence = 500;

function officialRevision(input: {
  sourceDetailKey: string;
  billLineType: string;
  recognizedModel: string | null;
  seedanceCandidate?: boolean;
  billableTokens: string | null;
  deductionCount: string | null;
  listEquivalentCostCny: string | null;
  originalBillAmountCny: string;
  payableAmountCny: string;
  paidAmountCny: string;
  unpaidAmountCny: string;
  expenseDate?: string;
}) {
  return {
    revision_id: paginationUuid(officialRevisionSequence++),
    source_detail_key: input.sourceDetailKey,
    is_final: false,
    normalized_payload: {
      billPeriod: '2026-07', expenseDate: input.expenseDate ?? '2026-07-01', product: 'ark_bd',
      billLineType: input.billLineType, recognizedModel: input.recognizedModel,
      seedanceCandidate: input.seedanceCandidate ?? input.recognizedModel !== null,
      pricingResolution: '480p/720p', pricingInputHasVideo: false,
      normalizedUnitPricePerMillion: '46', billableTokens: input.billableTokens,
      deductionCount: input.deductionCount, listEquivalentCostCny: input.listEquivalentCostCny,
      originalBillAmountCny: input.originalBillAmountCny, preferentialBillAmountCny: '0',
      discountBillAmountCny: '0', couponAmountCny: '0', payableAmountCny: input.payableAmountCny,
      paidAmountCny: input.paidAmountCny, unpaidAmountCny: input.unpaidAmountCny,
      currency: 'CNY', instanceNo: input.billLineType === 'package-purchase' ? input.sourceDetailKey : null,
    },
  };
}

function reconciliationBucket(id: string) {
  return {
    id, period_start: '2026-07-01', period_end: '2026-07-13', expense_date: '2026-07-01',
    bill_line_type: 'usage', recognized_model: 'Seedance 2.0 Mini', pricing_resolution_band: '480p-720p',
    pricing_input_class: 'without-video', unit_price_per_million: '23', currency: 'CNY',
    raw_local_tokens: '50638', inferred_adjustment_tokens: '0', adjusted_local_tokens: '50638',
    official_tokens: '50638', timing_adjustment_tokens: '0', residual_tokens: '50638',
    raw_local_cost_cny: '1.164674', inferred_adjustment_cost_cny: '0', adjusted_local_cost_cny: '1.164674',
    official_cost_cny: '1.164674', timing_adjustment_cost_cny: '0', rate_variance_cny: '0',
    rounding_variance_cny: '0', residual_cost_cny: '1.164674', status: 'residual',
    attribution_confidence: 'direct',
    __pagination_total_count: null,
  };
}

function taskRow(cost: string, patch: Record<string, unknown> = {}) {
  return {
    id: usageId, task_id: taskId, provider_task_id: 'provider-task-1', attempt: -1, user_id: userId,
    origin: 'generation-task',
    user_name: '测试用户', email: 'user@example.com', provider: 'volcengine-ark', model: 'Seedance 2.0',
    resolution: '720p', has_video_input: true, task_status: 'completed', usage_status: 'success',
    completion_tokens: '605700', total_tokens: '610000', billable_tokens: '605700', billable_basis: 'legacy_raw_units',
    unit_price_per_million: '28', estimated_cost: cost, price_version: 'volcengine-seedance-2026-07-10',
    pricing_status: 'legacy-inferred', created_at: '2026-07-13T05:00:00.000Z',
    usage_evidence_origin: 'legacy-raw', pricing_rule_status: 'priced',
    pricing_input_class: 'with-video', pricing_resolution_band: '480p-720p', attribution_confidence: 'medium',
    local_accounting_date: '2026-07-13', provider_terminal_at: null, usage_observed_at: '2026-07-13T06:00:00.000Z',
    completed_at: '2026-07-13T06:00:00.000Z', error: null,
    cost_resolution_case_id: null, cost_resolution_case_status: null,
    cost_resolution_evidence: null, __pagination_total_count: '2',
    __pagination_cursor_timestamp: '2026-07-13T06:00:00.000000Z', ...patch,
  };
}

function businessTaskRow(cost: string, patch: Record<string, unknown> = {}) {
  return {
    id: taskId, user_id: userId, user_name: '测试用户', email: 'user@example.com',
    model: 'Seedance 2.0', status: 'completed', resolution: '720p',
    price_versions: ['volcengine-seedance-2026-07-10', 'volcengine-seedance-2026-07-10'],
    configured_credits: 100, reserved_credits: 100, settled_credits: 100,
    refunded_credits: 0, credit_status: 'settled', attempt_count: 1,
    billable_tokens: '605700', estimated_cost_cny: cost, unpriced_attempts: 0,
    missing_usage_attempts: 0, inferred_attempts: 0, cost_finalized: true,
    cost_resolution_status: 'recorded', cost_resolution_case_id: null,
    created_at: '2026-07-13T05:00:00.000Z', completed_at: '2026-07-13T06:00:00.000Z',
    __pagination_total_count: null,
    __pagination_cursor_timestamp: '2026-07-13T05:00:00.000000Z',
    ...patch,
  };
}

function paginationUuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function paginationAttemptRow(index: number, totalCount: string | null) {
  const second = String(59 - Math.max(0, Math.min(index, 59))).padStart(2, '0');
  return taskRow('16.959600', {
    id: paginationUuid(index),
    task_id: paginationUuid(1_000 + index),
    created_at: `2026-07-13T05:00:${second}.000Z`,
    completed_at: `2026-07-13T06:00:${second}.123Z`,
    __pagination_total_count: totalCount,
    __pagination_cursor_timestamp: `2026-07-13T06:00:${second}.123456Z`,
  });
}

function businessUserRow(index: number, totalCount: string | null) {
  const second = String(index).padStart(2, '0');
  const id = paginationUuid(300 + index);
  return {
    id, user_id: id, user_name: `用户${index}`, email: `user${index}@example.com`,
    task_count: 1, successful_tasks: 1, failed_tasks: 0, canceled_tasks: 0,
    settled_credits: 100, refunded_credits: 0, billable_tokens: '100',
    estimated_cost_cny: '1.000000', business_estimated_cost_cny: '1.000000',
    operational_estimated_cost_cny: '0.000000', operational_call_count: 0,
    operational_unpriced_call_count: 0, incomplete_task_count: 0,
    last_task_at: `2026-07-13T05:00:${second}.000Z`,
    last_activity_at: `2026-07-13T05:00:${second}.000Z`,
    __pagination_total_count: totalCount,
    __pagination_cursor_timestamp: `2026-07-13T05:00:${second}.000000Z`,
  };
}

function emptyPackageLedger() {
  return {
    opening_prepaid_asset_cny: '0', acquisition_cost_cny: '0', amortized_cost_cny: '0',
    opening_catch_up_cny: '0', expiry_loss_cny: '0', adjustment_cny: '0',
    ending_prepaid_asset_cny: '0', incomplete_rows: 0, row_count: 0, event_rows: 0,
    opening_catch_up_rows: 0, uncertain_time_rows: 0, stale_gap_time_rows: 0,
  };
}

function serialQueryProbe(
  resolver: (sql: unknown, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>,
) {
  let active = 0;
  let peak = 0;
  const query = vi.fn(async (sql: unknown, params?: unknown[]) => {
    active += 1;
    peak = Math.max(peak, active);
    try {
      // 主动让出一个微任务：若调用方同时提交多个 client.query，这里会稳定观测到并发。
      await Promise.resolve();
      return await resolver(sql, params);
    } finally {
      active -= 1;
    }
  });
  return { query, peakActive: () => peak };
}

function rows<T>(items: T[]) {
  return { rows: items, rowCount: items.length };
}

function settlementSnapshotRows(
  pageRows: ReturnType<typeof officialRevision>[],
  summaryPatch: Record<string, unknown> = {},
) {
  const summary = {
    usage_original_amount_cny: '0', usage_payable_amount_cny: '0',
    usage_paid_amount_cny: '0', usage_unpaid_amount_cny: '0',
    package_purchase_amount_cny: '0', package_purchase_paid_amount_cny: '0',
    package_purchase_unpaid_amount_cny: '0', refund_amount_cny: '0',
    billing_adjustment_amount_cny: '0', net_official_payable_cny: '0',
    list_price_cost_cny: null, list_price_status: 'unavailable',
    ...summaryPatch,
  };
  if (pageRows.length === 0) {
    return rows([{
      revision_id: null, source_detail_key: null, normalized_payload: null, is_final: null,
      ...summary,
    }]);
  }
  return rows(pageRows.map(row => ({ ...row, ...summary })));
}

function coverageRows(start: string, end: string) {
  return rows([{
    local_start: start, local_end: end, official_start: start, official_end: end,
    local_intervals: [{ start, end }], official_intervals: [{ start, end }],
  }]);
}
