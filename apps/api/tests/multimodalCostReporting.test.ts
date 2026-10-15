import { endpointContracts } from '@lindyson/api-contracts';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';
import {
  getAdminMultimodalCostOverview,
  listAdminMultimodalCostOperations,
  listAdminMultimodalCostUsers,
} from '../src/domain/multimodalCostReporting.js';

const runId = '11111111-1111-4111-8111-111111111111';
const batchId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const asOf = '2026-07-13T06:00:00.000Z';
const targetModelId = 'doubao-seed-2-0-lite-260428';

describe('多模态模型成本报表', () => {
  it('汇总分开业务安全账本与运营调用，partial 金额保持已知小计', async () => {
    const query = vi.fn(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('GROUP BY GROUPING SETS')) {
        expect(params?.[3]).toBe(targetModelId);
        return rows([
          aggregateRow(false, targetModelId),
          aggregateRow(true, null),
        ]);
      }
      if (text.includes('WITH latest_balance AS')) {
        return rows([{
          available_balance_cny: '88.123456', cash_balance_cny: '80.000000',
          frozen_amount_cny: '1.000000', arrears_balance_cny: '0.000000',
          credit_limit_cny: '10.000000', currency: 'CNY', synced_at: asOf,
          sync_status: 'success', sync_completed_at: asOf,
        }]);
      }
      if (text.includes('FROM provider_operational_usage_records usage')) {
        expect(params).toEqual([
          '2026-07-01', '2026-07-13', asOf,
          [targetModelId, 'Doubao Seed 2.0 Lite'], 'volcengine-ark',
        ]);
        return rows([{
          call_count: 2, unpriced_call_count: 1, estimated_cost_cny: '0.000500',
        }]);
      }
      if (text.includes('WITH owner_scope AS')) {
        expect(params).toEqual(['2026-07-01', '2026-07-13', asOf, targetModelId]);
        expect(text).toContain('historical_sources AS');
        expect(text).toContain('evidence.pricing_version AS price_version');
        expect(text).toContain('evidence.pricing_source_url AS source_url');
        expect(text).toContain('evidence.priced_at <= $3::timestamptz');
        expect(text).toContain('evidence.created_at <= $3::timestamptz');
        expect(text).toContain('requests.created_at <= $3::timestamptz');
        expect(text).toContain('tk_ledger_sources AS');
        expect(text).toContain('FROM tk_prompt_provider_requests requests');
        expect(text).toContain("requests.request_status IN ('succeeded', 'failed')");
        return rows([{
          price_version: 'volcengine-list-2026-07-23',
          source_url: 'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
        }]);
      }
      throw new Error(`未预期 SQL：${text}`);
    });

    const result = await getAdminMultimodalCostOverview({ query } as unknown as DbClient, {
      range: 'month', month: '2026-07', asOf,
    });

    expect(() => endpointContracts.adminApiUsageMultimodalOverview.response.parse(result)).not.toThrow();
    expect(result).toMatchObject({
      asOf,
      selection: { rangeStart: '2026-07-01', rangeEnd: '2026-07-13' },
      account: { availableBalanceCny: '88.123456', status: 'fresh' },
      summary: {
        analysisCount: 1, batchCount: 1, settledCredits: 1,
        knownInputTokens: 1200, knownCachedInputTokens: 200, knownOutputTokens: 300,
        knownCostCny: '0.001920', reconciledZeroRequestCount: 0,
        unknownUsageRequestCount: 1, historicalEvidenceOperationCount: 0,
        historicalPricedOperationCount: 1,
        operationalCallCount: 2, operationalUnpricedCallCount: 1,
        businessEstimatedCostCny: '0.001920', operationalEstimatedCostCny: '0.000500',
        knownAccountCostCny: '0.002420',
        estimateCompleteness: 'partial',
      },
      models: [{
        id: 'doubao-seed-2-0-lite-260428', model: 'Doubao Seed 2.0 Lite',
        incompleteOperationCount: 1, estimateCompleteness: 'partial',
        historicalPricedOperationCount: 1,
        operationalCallCount: 2, operationalUnpricedCallCount: 1,
        businessEstimatedCostCny: '0.001920', operationalEstimatedCostCny: '0.000500',
        knownAccountCostCny: '0.002420',
        pricingSources: [{
          priceVersion: 'volcengine-list-2026-07-23',
          sourceUrl: 'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
        }],
      }],
    });
    const reportSql = String(query.mock.calls[0]?.[0]);
    expect(reportSql.indexOf('WITH operation_sources AS')).toBeLessThan(
      reportSql.indexOf('request_aggregates AS'),
    );
    expect(reportSql).toContain('FROM prompt_wizard_provider_requests requests');
    expect(reportSql).toContain('FROM tk_prompt_provider_requests requests');
    expect(reportSql).toContain("SELECT 'tk'::text AS source_kind");
    expect(reportSql).toContain("requests.request_status IN ('succeeded', 'failed')");
    expect(reportSql).toContain('requests.completed_at <= $3::timestamptz');
    expect(reportSql).toContain('prompt_wizard_provider_request_reconciliations reconciliations');
    expect(reportSql).toContain("reconciliations.reconciliation_status = 'confirmed-zero'");
    expect(reportSql).toContain('reconciliations.reconciled_at <= $3::timestamptz');
    expect(reportSql).toContain('reconciliations.created_at <= $3::timestamptz');
    expect(reportSql).toContain('reconciliations.effective_input_tokens');
    expect(reportSql).toContain('count(*) FILTER (WHERE requests.reconciled_zero)');
    expect(reportSql).toContain('WHERE model_id = $4::text');
    expect(reportSql).toContain('request_presence AS');
    expect(reportSql).toContain('WHERE requests.created_at <= $3::timestamptz');
    expect(reportSql).toContain('historical_cost_evidence AS');
    expect(reportSql).toContain('FROM prompt_wizard_historical_operation_cost_evidence evidence');
    expect(reportSql).toContain('evidence.priced_at <= $3::timestamptz');
    expect(reportSql).toContain('evidence.created_at <= $3::timestamptz');
    expect(reportSql).toContain("requests.provider = 'volcengine-ark'");
    expect(reportSql).toContain('requests.model = $4::text');
    expect(reportSql).toMatch(
      /WHEN requests\.provider_request_count > 0 THEN \$4::text\s+WHEN presence\.any_request_count IS NULL AND historical\.operation_id IS NOT NULL\s+THEN \$4::text\s+WHEN presence\.any_request_count IS NULL AND source\.legacy_model = \$4::text THEN \$4::text/,
    );
    expect(reportSql).toMatch(
      /FROM prompt_wizard_provider_requests requests\s+JOIN operation_sources source\s+ON source\.source_kind = 'v6'\s+AND source\.run_id = requests\.run_id/,
    );
    expect(reportSql).toContain('GROUP BY requests.source_kind, requests.run_id, requests.batch_id');
    expect(reportSql).toMatch(
      /LEFT JOIN request_aggregates requests\s+ON requests\.source_kind = source\.source_kind/,
    );
    expect(reportSql).toContain('requests.batch_id IS NOT DISTINCT FROM source.batch_id');
    expect(reportSql).toContain("requests.cost_status = 'known'");
    expect(reportSql).toContain('CASE WHEN requests.provider_request_count > 0 THEN requests.known_input_tokens');
    expect(reportSql).toMatch(
      /WHEN source\.terminal_as_of AND requests\.provider_request_count > 0\s+AND requests\.known_cost_request_count = requests\.provider_request_count THEN 'complete'/,
    );
    expect(reportSql).toContain("WHEN requests.known_cost_request_count > 0 THEN 'partial'");
    expect(reportSql).toMatch(
      /batches\.completed_at IS NOT NULL AND batches\.completed_at <= \$3::timestamptz\s+AND batches\.credit_status = 'settled'/,
    );
    expect(reportSql).not.toMatch(/image_asset_ids|product_profile|creative_brief|video_config|\bplans\b|raw_payload/i);
    expect(reportSql).not.toContain('provider_bill_details');
    expect(reportSql).not.toContain('provider_reconciliation');
  });

  it('confirmed-zero 以零值纳入已知小计，并把 operation 标记为 ledger-reconciled', async () => {
    const query = vi.fn(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      expect(params?.slice(0, 4)).toEqual(['2026-07-01', '2026-07-13', asOf, targetModelId]);
      expect(text).toContain("WHEN requests.reconciled_zero_request_count > 0 THEN 'ledger-reconciled'");
      expect(text).toContain('requests.effective_cost_known');
      return rows([{
        id: runId, operation_type: 'analysis', run_id: runId, batch_id: null,
        user_id: userId, user_name: '测试用户', email: 'user@example.com',
        provider: 'volcengine-ark', model_id: targetModelId,
        status: 'failed', is_free: null, settled_credits: 0, refunded_credits: 0,
        known_input_tokens: '0', known_cached_input_tokens: '0', known_output_tokens: '0',
        known_cost_cny: '0.000000', provider_request_count: 1, reconciled_zero_request_count: 1,
        unknown_usage_request_count: 0, unpriced_request_count: 0, incomplete_request_count: 0,
        estimate_completeness: 'complete', usage_evidence: 'ledger-reconciled',
        failure_reason: 'provider unavailable', created_at: '2026-07-12T03:00:00.000Z',
        completed_at: '2026-07-12T03:01:00.000Z', __pagination_total_count: null,
        __pagination_cursor_timestamp: '2026-07-12T03:00:00.000000Z',
      }]);
    });

    const result = await listAdminMultimodalCostOperations({ query } as unknown as DbClient, {
      range: 'month', month: '2026-07', asOf, position: 'first', limit: 20,
    });

    expect(() => endpointContracts.adminApiUsageMultimodalOperations.response.parse(result)).not.toThrow();
    expect(result.items).toEqual([expect.objectContaining({
      id: runId, usageEvidence: 'ledger-reconciled', providerRequestCount: 1,
      reconciledZeroRequestCount: 1, unknownUsageRequestCount: 0,
      knownInputTokens: 0, knownCachedInputTokens: 0, knownOutputTokens: 0,
      knownCostCny: '0.000000', estimateCompleteness: 'complete',
    })]);
  });

  it('历史 operation 展示已有 Token，但成本与完整性保持 unavailable', async () => {
    const query = vi.fn(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      expect(params?.slice(0, 4)).toEqual(['2026-07-01', '2026-07-13', asOf, targetModelId]);
      expect(text).toContain("WHEN source.legacy_input_tokens IS NOT NULL OR source.legacy_output_tokens IS NOT NULL");
      expect(text).toContain('WHERE operation_costs.model_id = $4::text');
      return rows([{
        id: runId, operation_type: 'analysis', run_id: runId, batch_id: null,
        user_id: userId, user_name: '测试用户', email: 'user@example.com',
        provider: 'volcengine-ark', model_id: targetModelId,
        status: 'ready', is_free: null, settled_credits: 0, refunded_credits: 0,
        known_input_tokens: '900', known_cached_input_tokens: null, known_output_tokens: '120',
        known_cost_cny: null, provider_request_count: 0, unknown_usage_request_count: 0,
        unpriced_request_count: 0, incomplete_request_count: 0,
        estimate_completeness: 'unavailable', usage_evidence: 'historical',
        failure_reason: null, created_at: '2026-07-12T03:00:00.000Z', completed_at: '2026-07-12T03:01:00.000Z',
        __pagination_total_count: null,
        __pagination_cursor_timestamp: '2026-07-12T03:00:00.000000Z',
      }]);
    });
    const result = await listAdminMultimodalCostOperations({ query } as unknown as DbClient, {
      range: 'month', month: '2026-07', asOf, position: 'first', limit: 20,
    });

    expect(() => endpointContracts.adminApiUsageMultimodalOperations.response.parse(result)).not.toThrow();
    expect(result.items).toEqual([expect.objectContaining({
      id: runId, operationType: 'analysis', usageEvidence: 'historical',
      knownInputTokens: 900, knownOutputTokens: 120, knownCachedInputTokens: null,
      knownCostCny: null, estimateCompleteness: 'unavailable', providerRequestCount: 0,
      priceVersion: null, pricingSourceUrl: null,
    })]);
    expect(result.pagination).toMatchObject({
      limit: 20, hasPrevious: false, hasNext: false, previousCursor: null, nextCursor: null,
      currentPage: 1, totalPages: 1, totalItems: 1, snapshotCursor: expect.any(String),
    });
  });

  it('历史聚合定价证据仅在快照内且 owner 没有逐请求账本时覆盖成本', async () => {
    const query = vi.fn(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      expect(params?.slice(0, 4)).toEqual(['2026-07-01', '2026-07-13', asOf, targetModelId]);
      expect(text).toContain('historical_cost_evidence AS');
      expect(text).toContain('evidence.priced_at <= $3::timestamptz');
      expect(text).toContain('evidence.created_at <= $3::timestamptz');
      expect(text).toMatch(
        /WHEN presence\.any_request_count IS NULL AND historical\.operation_id IS NOT NULL\s+THEN historical\.cost_cny/,
      );
      expect(text).toContain("THEN 'historical-aggregate-priced'");
      expect(text).toContain('WHERE requests.created_at <= $3::timestamptz');
      return rows([{
        id: runId, operation_type: 'analysis', run_id: runId, batch_id: null,
        user_id: userId, user_name: '测试用户', email: 'user@example.com',
        provider: 'volcengine-ark', model_id: targetModelId,
        status: 'ready', is_free: null, settled_credits: 0, refunded_credits: 0,
        known_input_tokens: '900', known_cached_input_tokens: '0', known_output_tokens: '120',
        known_cost_cny: '0.000972', provider_request_count: 0,
        reconciled_zero_request_count: 0, unknown_usage_request_count: 0,
        unpriced_request_count: 0, incomplete_request_count: 0,
        estimate_completeness: 'complete', usage_evidence: 'historical-aggregate-priced',
        price_version: 'volcengine-list-2026-07-23',
        pricing_source_url: 'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
        failure_reason: null, created_at: '2026-07-12T03:00:00.000Z',
        completed_at: '2026-07-12T03:01:00.000Z', __pagination_total_count: null,
        __pagination_cursor_timestamp: '2026-07-12T03:00:00.000000Z',
      }]);
    });

    const result = await listAdminMultimodalCostOperations({ query } as unknown as DbClient, {
      range: 'month', month: '2026-07', asOf, position: 'first', limit: 20,
    });

    expect(() => endpointContracts.adminApiUsageMultimodalOperations.response.parse(result)).not.toThrow();
    expect(result.items).toEqual([expect.objectContaining({
      id: runId,
      usageEvidence: 'historical-aggregate-priced',
      providerRequestCount: 0,
      knownInputTokens: 900,
      knownCachedInputTokens: 0,
      knownOutputTokens: 120,
      knownCostCny: '0.000972',
      estimateCompleteness: 'complete',
      priceVersion: 'volcengine-list-2026-07-23',
      pricingSourceUrl: 'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
    })]);
  });

  it('completed_at 晚于 asOf 的 operation 即使已有请求全部 known 也只能为 partial', async () => {
    const query = vi.fn(async (sql: unknown, _params?: unknown[]) => {
      const text = String(sql);
      expect(text).toMatch(
        /CASE WHEN batches\.completed_at IS NOT NULL AND batches\.completed_at > \$3::timestamptz\s+THEN 'processing'/,
      );
      expect(text).toContain(
        '(batches.completed_at IS NOT NULL AND batches.completed_at <= $3::timestamptz) AS terminal_as_of',
      );
      return rows([{
        id: batchId, operation_type: 'plan-batch', run_id: runId, batch_id: batchId,
        user_id: userId, user_name: '测试用户', email: 'user@example.com',
        provider: 'volcengine-ark', model_id: 'doubao-seed-2-0-lite-260428',
        status: 'processing', is_free: false, settled_credits: 0, refunded_credits: 0,
        known_input_tokens: '1000', known_cached_input_tokens: '100', known_output_tokens: '200',
        known_cost_cny: '0.001200', provider_request_count: 1, unknown_usage_request_count: 0,
        unpriced_request_count: 0, incomplete_request_count: 0,
        estimate_completeness: 'partial', usage_evidence: 'ledger', failure_reason: null,
        created_at: '2026-07-12T03:00:00.000Z', completed_at: null,
        __pagination_total_count: null,
        __pagination_cursor_timestamp: '2026-07-12T03:00:00.000000Z',
      }, {
        id: runId, operation_type: 'analysis', run_id: runId, batch_id: null,
        user_id: userId, user_name: '测试用户', email: 'user@example.com',
        provider: 'volcengine-ark', model_id: 'doubao-seed-2-0-lite-260428',
        status: 'analyzing', is_free: null, settled_credits: 0, refunded_credits: 0,
        known_input_tokens: null, known_cached_input_tokens: null, known_output_tokens: null,
        known_cost_cny: null, provider_request_count: 1, unknown_usage_request_count: 1,
        unpriced_request_count: 0, incomplete_request_count: 1,
        estimate_completeness: 'unavailable', usage_evidence: 'ledger', failure_reason: null,
        created_at: '2026-07-12T02:00:00.000Z', completed_at: null,
        __pagination_total_count: null,
        __pagination_cursor_timestamp: '2026-07-12T02:00:00.000000Z',
      }]);
    });
    const result = await listAdminMultimodalCostOperations({ query } as unknown as DbClient, {
      range: 'month', month: '2026-07', asOf, position: 'first', limit: 20,
    });

    expect(result.items[0]).toMatchObject({
      id: batchId, status: 'processing', providerRequestCount: 1,
      knownCostCny: '0.001200', estimateCompleteness: 'partial',
    });
    expect(result.items[1]).toMatchObject({
      id: runId, status: 'analyzing', providerRequestCount: 1,
      knownCostCny: null, estimateCompleteness: 'unavailable',
    });
  });

  it('用户聚合保留模型字段，并对未知 owner 计入 incompleteOperationCount', async () => {
    const query = vi.fn(async (sql: unknown, params?: unknown[]) => {
      expect(String(sql)).toContain('WHERE model_id = $4::text');
      expect(params?.[3]).toBe(targetModelId);
      return rows([{
      id: userId, user_id: userId, user_name: '测试用户', email: 'user@example.com',
      model_ids: [targetModelId], analysis_count: 1, batch_count: 1,
      settled_credits: 1, refunded_credits: 0,
      known_input_tokens: '1200', known_cached_input_tokens: '200', known_output_tokens: '300',
      known_cost_cny: '0.001920', provider_request_count: 4,
      unknown_usage_request_count: 1, unpriced_request_count: 0,
      incomplete_operation_count: 1, estimate_completeness: 'partial',
      historical_evidence_operation_count: 0, historical_priced_operation_count: 2,
      last_activity_at: '2026-07-12T04:00:00.000Z',
      __pagination_total_count: null,
      __pagination_cursor_timestamp: '2026-07-12T04:00:00.000000Z',
    }]);
    });
    const result = await listAdminMultimodalCostUsers({ query } as unknown as DbClient, {
      range: 'month', month: '2026-07', asOf, search: 'user@example.com', position: 'first', limit: 20,
    });

    expect(() => endpointContracts.adminApiUsageMultimodalUsers.response.parse(result)).not.toThrow();
    expect(result.items[0]).toMatchObject({
      userId, models: ['Doubao Seed 2.0 Lite'], analysisCount: 1, batchCount: 1,
      settledCredits: 1, incompleteOperationCount: 1, estimateCompleteness: 'partial',
      reconciledZeroRequestCount: 0, historicalEvidenceOperationCount: 0,
      historicalPricedOperationCount: 2,
    });
  });

  it('all 范围按北京时间 owner 创建日确定，并拒绝未知模型', async () => {
    const query = vi.fn(async (sql: unknown, _params?: unknown[]) => {
      if (String(sql).includes('SELECT min(created_date)')) {
        expect(String(sql)).toContain('WITH request_scope AS');
        expect(String(sql)).toContain('tk_request_scope AS');
        expect(String(sql)).toContain('FROM tk_prompt_provider_requests requests');
        expect(String(sql)).toContain('FROM tk_prompt_runs runs');
        expect(String(sql)).toContain('FROM tk_prompt_generations generations');
        expect(String(sql)).toContain("requests.request_status IN ('succeeded', 'failed')");
        expect(String(sql)).toContain("bool_or(requests.provider = 'volcengine-ark' AND requests.model = $2::text)");
        expect(String(sql)).toContain('scope.has_any IS NULL');
        expect(String(sql)).not.toContain('coalesce(provider_model, $2::text)');
        return rows([{ start_date: '2026-06-30', end_date: '2026-07-12' }]);
      }
      return rows([]);
    });
    const result = await listAdminMultimodalCostOperations({ query } as unknown as DbClient, {
      range: 'all', asOf, position: 'first', limit: 20,
    });
    expect(result.selection).toMatchObject({
      range: 'all', rangeStart: '2026-06-30', rangeEnd: '2026-07-12', timezone: 'Asia/Shanghai',
    });
    expect(query.mock.calls[0]?.[1]).toEqual([asOf, targetModelId]);
    await expect(getAdminMultimodalCostOverview({ query } as unknown as DbClient, {
      range: 'month', month: '2026-07', asOf, model: 'unknown-model',
    })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_MODEL' });
  });

  it('翻页必须复用首屏 asOf，禁止游标漂移到新快照', async () => {
    const query = vi.fn();
    await expect(listAdminMultimodalCostUsers({ query } as unknown as DbClient, {
      range: 'month', month: '2026-07', position: 'next', cursor: 'signed-cursor', limit: 20,
    })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });
    expect(query).not.toHaveBeenCalled();
  });

  it('非法日历日期在进入 PostgreSQL 前返回 400', async () => {
    const query = vi.fn();
    await expect(getAdminMultimodalCostOverview({ query } as unknown as DbClient, {
      range: 'date', date: '2026-02-31', asOf,
    })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_DATE' });
    await expect(listAdminMultimodalCostOperations({ query } as unknown as DbClient, {
      range: 'custom', from: '2026-02-28', to: '2026-02-31', asOf,
      position: 'first', limit: 20,
    })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_DATE_RANGE' });
    expect(query).not.toHaveBeenCalled();
  });
});

function aggregateRow(totalRow: boolean, modelId: string | null) {
  return {
    provider: totalRow ? null : 'volcengine-ark', model_id: modelId, total_row: totalRow,
    analysis_count: 1, batch_count: 1, user_count: 1,
    settled_credits: 1, refunded_credits: 0,
    known_input_tokens: '1200', known_cached_input_tokens: '200', known_output_tokens: '300',
    known_cost_cny: '0.001920', provider_request_count: 4,
    reconciled_zero_request_count: 0, unknown_usage_request_count: 1,
    unpriced_request_count: 0, incomplete_operation_count: 1,
    historical_evidence_operation_count: 0,
    historical_priced_operation_count: 1,
  };
}

function rows<T>(items: T[]) {
  return { rows: items, rowCount: items.length };
}
