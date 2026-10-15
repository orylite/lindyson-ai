import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  const clientQuery = vi.fn();
  return {
    events,
    clientQuery,
    client: { query: clientQuery, release: vi.fn() },
    poolQuery: vi.fn(),
  };
});

vi.mock('../src/db/pool.js', () => ({
  pool: {
    connect: vi.fn(async () => mocks.client),
    query: mocks.poolQuery,
  },
  withTransaction: vi.fn(),
}));

import { env } from '../src/config/env.js';
import {
  generateProviderReconciliationSnapshot,
  reconcileOpeningPackageCostBasis,
  reviewFinalBillZeroCostCases,
  syncVolcengineBillDetails,
  syncVolcengineBillingBalance,
  syncVolcengineBillingPackages,
} from '../src/providers/volcengineBillingProvider.js';

const originalAccessKey = env.VOLC_BILLING_ACCESS_KEY_ID;
const originalSecretKey = env.VOLC_BILLING_SECRET_ACCESS_KEY;

describe('火山官方账单事务同步', () => {
  beforeEach(() => {
    mocks.events.length = 0;
    mocks.clientQuery.mockReset();
    mocks.poolQuery.mockReset();
    mocks.client.release.mockReset();
    env.VOLC_BILLING_ACCESS_KEY_ID = 'test-ak';
    env.VOLC_BILLING_SECRET_ACCESS_KEY = 'test-sk';
    installClientQuery();
  });

  afterAll(() => {
    env.VOLC_BILLING_ACCESS_KEY_ID = originalAccessKey;
    env.VOLC_BILLING_SECRET_ACCESS_KEY = originalSecretKey;
    vi.unstubAllGlobals();
  });

  it('全部分页成功后才开启短事务，并通过唯一键幂等 upsert', async () => {
    const fetchMock = vi.fn(async () => {
      mocks.events.push('FETCH ListBillDetail');
      return jsonResponse({
        ResponseMetadata: { RequestId: 'bill-request-1' },
        Result: {
          List: [{
            BillDetailId: 'detail-1', BillPeriod: '2026-07', ExpenseDate: '2026-07-13',
            Product: 'ark_bd', ConfigName: 'Seedance 2.0 720P 含视频输入',
            Price: '0.000028', PriceUnit: '元/token', Count: '605700', Unit: 'token',
            DeductionCount: '605700', OriginalBillAmount: '0.000000',
            PayableAmount: '0.000000', PaidAmount: '0.000000', UnpaidAmount: '0.000000',
          }],
          Total: 1,
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await syncVolcengineBillDetails({
      billPeriod: '2026-07', expenseDate: '2026-07-13', force: true,
    });

    expect(result).toMatchObject({ ok: true, rows: 1, pages: 1 });
    const fetchIndex = mocks.events.indexOf('FETCH ListBillDetail');
    const beginIndex = mocks.events.findIndex(event => event === 'BEGIN');
    expect(fetchIndex).toBeGreaterThanOrEqual(0);
    expect(beginIndex).toBeGreaterThan(fetchIndex);
    const upsert = mocks.clientQuery.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes('INSERT INTO provider_bill_details'));
    expect(upsert).toContain('ON CONFLICT (provider, source_detail_key) DO UPDATE');
    expect(mocks.clientQuery.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO provider_bill_detail_revisions'))).toBe(true);
    expect(mocks.clientQuery.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO provider_bill_sync_run_items'))).toBe(true);
    const evidenceBinding = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE provider_reconciliation_case_links'));
    expect(String(evidenceBinding?.[0])).toContain('bill_detail_revision_id IS NULL');
    expect(evidenceBinding?.[1]).toEqual([
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(mocks.clientQuery.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO provider_reconciliation_runs'))).toBe(true);
    expect(mocks.clientQuery.mock.calls.map(([sql]) => String(sql))).toEqual(expect.arrayContaining([
      'BEGIN',
      'COMMIT',
    ]));
    expect(mocks.client.release).toHaveBeenCalledOnce();
  });

  it('终账把小数资源包抵扣量精确归一后写入 v3 修订和当前投影', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ResponseMetadata: { RequestId: 'bill-request-fractional-deduction' },
      Result: {
        List: [{
          BillDetailId: 'detail-fractional-deduction',
          BillPeriod: '2026-07',
          ExpenseDate: '2026-07-13',
          Product: 'ark_bd',
          BillCategory: '消费-使用',
          ConfigName: 'Seedance 2.0 720P 无视频输入',
          Price: '0.046', PriceUnit: '元/千tokens',
          Count: '151.078', Unit: '千tokens',
          DeductionCount: '72.664544077',
          OriginalBillAmount: '6.949588',
          PayableAmount: '0.000000', PaidAmount: '0.000000', UnpaidAmount: '0.000000',
        }],
        Total: 1,
      },
    })));

    await expect(syncVolcengineBillDetails({
      billPeriod: '2026-07', isFinal: true, force: true,
    })).resolves.toMatchObject({ ok: true, rows: 1, pages: 1 });

    const revision = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_bill_detail_revisions'));
    expect(JSON.parse(String(revision?.[1]?.[4]))).toMatchObject({
      Count: '151.078', Unit: '千tokens', DeductionCount: '72.664544077',
    });
    expect(JSON.parse(String(revision?.[1]?.[5]))).toMatchObject({
      billableTokens: '151078',
      deductionCount: '72664.544077',
      normalizationVersion: 'volcengine-billing-v3',
    });
    expect(revision?.[1]?.[6]).toBe('volcengine-billing-v3');

    const projection = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_bill_details'));
    expect(projection?.[1]?.[18]).toBe('151.078');
    expect(projection?.[1]?.[20]).toBe('72664.544077');
    expect(projection?.[1]?.[34]).toBe('151078');
    expect(projection?.[1]?.[36]).toBe(true);
    expect(projection?.[1]?.[41]).toBe('volcengine-billing-v3');
  });

  it('响应结构漂移时标记运行失败，不开启替换事务也不清空旧数据', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Result: { Items: [], Total: 0 },
    })));

    const result = await syncVolcengineBillDetails({
      billPeriod: '2026-07', expenseDate: '2026-07-13', force: true,
    });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Result.List') });
    const queries = mocks.clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(queries).not.toContain('BEGIN');
    expect(queries.some(sql => sql.includes('UPDATE provider_bill_details'))).toBe(false);
    expect(queries.some(sql => sql.includes("SET status = 'failed'"))).toBe(true);
  });

  it('资源包购买账单按 instance_no 双写购置基础及未付金额', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Result: {
        List: [{
          BillDetailId: 'purchase-detail-1',
          BillPeriod: '2026-07',
          ExpenseDate: '2026-07-01',
          Product: 'ark_bd',
          BillCategory: '消费-新购',
          BillingMode: '预付费',
          InstanceNo: 'Ark_bd-package-1',
          ConfigName: 'Doubao-Seedance-2.0-Fast 在线推理资源包',
          Count: '1', Unit: '个', OriginalBillAmount: '22.000000',
          PayableAmount: '22.000000', PaidAmount: '20.000000', UnpaidAmount: '2.000000',
        }],
        Total: 1,
      },
    })));

    await expect(syncVolcengineBillDetails({
      billPeriod: '2026-07', expenseDate: '2026-07-01', force: true,
    })).resolves.toMatchObject({ ok: true });

    const acquisition = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_resource_package_acquisitions'));
    expect(acquisition?.[1]).toEqual(expect.arrayContaining([
      'volcengine-ark', 'Ark_bd-package-1', 'purchase-detail-1',
      '22.000000', '20.000000', '2.000000', 'CNY',
    ]));
    expect(String(acquisition?.[0])).toContain(
      'ON CONFLICT (provider, bill_source_detail_key) DO UPDATE',
    );
    expect(String(acquisition?.[0])).not.toContain(
      'ON CONFLICT (provider, package_id, bill_source_detail_key)',
    );
    expect(String(acquisition?.[0])).toContain("cost_basis_status = 'matched'");
    expect(mocks.clientQuery.mock.calls.some(([sql]) =>
      String(sql).includes('UPDATE provider_resource_package_cost_events'))).toBe(true);
  });

  it('资源包退款只保存待归因证据并把当前成本基础降级，不能继续展示完整资产', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Result: {
        List: [{
          BillDetailId: 'refund-detail-1',
          BillPeriod: '2026-07',
          ExpenseDate: '2026-07-13',
          Product: 'ark_bd',
          BillCategory: '退款',
          InstanceNo: 'Ark_bd-package-1',
          ConfigName: 'Doubao-Seedance-2.0-Fast 在线推理资源包',
          OriginalBillAmount: '-10.000000', PayableAmount: '-10.000000',
          PaidAmount: '-10.000000', UnpaidAmount: '0.000000',
        }],
        Total: 1,
      },
    })));

    await expect(syncVolcengineBillDetails({
      billPeriod: '2026-07', expenseDate: '2026-07-13', force: true,
    })).resolves.toMatchObject({ ok: true });

    const refundEvent = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('source_bill_detail_revision_id')
      && String(sql).includes("'missing-acquisition'"));
    expect(refundEvent?.[1]).toEqual(expect.arrayContaining([
      'volcengine-ark', 'Ark_bd-package-1', 'refund', '2026-07-13',
    ]));
    const acquisitionState = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE provider_resource_package_acquisitions acquisitions'));
    expect(String(acquisitionState?.[0])).toContain("bill_line_type IN ('refund', 'adjustment')");
    expect(String(acquisitionState?.[0])).toContain("ELSE 'revised'");
    expect(String(acquisitionState?.[0])).toContain('SELECT count(*)');
    expect(String(acquisitionState?.[0])).toContain('min(snapshots.total_quota) <> max(snapshots.total_quota)');
  });

  it('负数购置金额或非人民币购置行不进入资源包成本基础', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Result: {
        List: [{
          BillDetailId: 'negative-purchase', BillPeriod: '2026-07', ExpenseDate: '2026-07-13',
          Product: 'ark_bd', BillCategory: '消费-新购', BillingMode: '预付费',
          InstanceNo: 'Ark_bd-negative', ConfigName: 'Doubao-Seedance-2.0-Mini 在线推理资源包',
          OriginalBillAmount: '-14.000000', PayableAmount: '-14.000000',
          PaidAmount: '-14.000000', UnpaidAmount: '0.000000', Currency: 'CNY',
        }, {
          BillDetailId: 'usd-purchase', BillPeriod: '2026-07', ExpenseDate: '2026-07-13',
          Product: 'ark_bd', BillCategory: '消费-新购', BillingMode: '预付费',
          InstanceNo: 'Ark_bd-usd', ConfigName: 'Doubao-Seedance-2.0-Fast 在线推理资源包',
          PayableAmount: '22.000000', PaidAmount: '22.000000', Currency: 'USD',
        }],
        Total: 2,
      },
    })));

    await expect(syncVolcengineBillDetails({
      billPeriod: '2026-07', expenseDate: '2026-07-13', force: true,
    })).resolves.toMatchObject({ ok: true, rows: 2 });
    expect(mocks.clientQuery.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO provider_resource_package_acquisitions'))).toBe(false);
  });

  it('账单同步成功后追加月度三账快照与按日计价桶', async () => {
    installClientQuery(undefined, [{
      // node-postgres 的 DATE 解析器可返回 Date；快照必须保留费用日，不能静默写成 NULL。
      expense_date: new Date('2026-07-13T00:00:00.000Z'),
      product: 'ark_bd',
      recognized_model: 'Seedance 2.0',
      pricing_resolution_band: '480p-720p',
      pricing_input_class: 'with-video',
      unit_price_per_million: '28.000000',
      currency: 'CNY',
      raw_local_tokens: '0',
      raw_local_cost_cny: '0.000000',
      inferred_adjustment_tokens: '100',
      inferred_adjustment_cost_cny: '0.002800',
      official_tokens: '100',
      official_cost_cny: '0.002800',
    }]);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Result: {
        List: [{
          BillDetailId: 'detail-reconciliation', BillPeriod: '2026-07',
          ExpenseDate: '2026-07-13', Product: 'ark_bd',
          ConfigName: 'Seedance 2.0 720P 含视频输入', Price: '0.000028',
          PriceUnit: '元/token', Count: '100', Unit: 'token', DeductionCount: '100',
          OriginalBillAmount: '0.000000', PayableAmount: '0.000000',
          PaidAmount: '0.000000', UnpaidAmount: '0.000000',
        }],
        Total: 1,
      },
    })));

    await expect(syncVolcengineBillDetails({
      billPeriod: '2026-07', expenseDate: '2026-07-13', force: true,
    })).resolves.toMatchObject({ ok: true });
    const aggregation = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('FULL OUTER JOIN official_usage'));
    expect(String(aggregation?.[0])).toContain('expense_date BETWEEN $2::date AND $3::date');
    expect(String(aggregation?.[0])).not.toContain('AND billable_tokens IS NOT NULL');
    expect(String(aggregation?.[0])).toContain("AND usage.usage_unit = 'tokens'");
    expect(String(aggregation?.[0])).toContain("AND usage.currency = 'CNY'");
    expect(String(aggregation?.[0])).toContain("WHEN usage.billable_tokens IS NULL");
    expect(String(aggregation?.[0])).toContain('zero_cost_candidate_usage AS');
    expect(String(aggregation?.[0])).toContain('NOT EXISTS (');
    expect(String(aggregation?.[0])).toContain('zero_cost_candidate_count');
    expect(aggregation?.[1]?.slice(1, 3)).toEqual(['2026-07-13', '2026-07-13']);
    expect(mocks.clientQuery.mock.calls.some(([sql]) =>
      String(sql).includes('FROM provider_bill_sync_run_items'))).toBe(true);
    const run = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_reconciliation_runs'));
    expect(run?.[1]?.slice(2, 4)).toEqual(['2026-07-13', '2026-07-13']);
    expect(run?.[1]).toEqual(expect.arrayContaining([
      'adjusted-matched', 'complete', '100', '0.002800', '0', '0.000000',
    ]));
    const bucket = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_reconciliation_buckets'));
    expect(bucket?.[1]?.[3]).toBe('2026-07-13T00:00:00.000Z');
    expect(bucket?.[1]?.at(-1)).toBe('adjusted-matched');
  });

  it('日级重拉不继承旧 final，最终状态由本次完整同步决定', async () => {
    installClientQuery('final');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Result: {
        List: [{
          BillDetailId: 'detail-late', BillPeriod: '2026-06', ExpenseDate: '2026-06-30',
          Product: 'ark_bd', ConfigName: 'Seedance 2.0 Mini 720P 无视频输入',
          Price: '0.000023', PriceUnit: '元/token', Count: '100', Unit: 'token',
          DeductionCount: '100', OriginalBillAmount: '0.000000',
          PayableAmount: '0.000000', PaidAmount: '0.000000', UnpaidAmount: '0.000000',
        }],
        Total: 1,
      },
    })));

    await expect(syncVolcengineBillDetails({
      billPeriod: '2026-06', expenseDate: '2026-06-30', force: true,
    })).resolves.toMatchObject({ ok: true });

    const upsertCall = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_bill_details'));
    expect(upsertCall?.[1]?.[36]).toBe(false);
    expect(String(upsertCall?.[0])).toContain('is_final = EXCLUDED.is_final');
    expect(String(upsertCall?.[0])).not.toContain('provider_bill_details.is_final OR');
  });

  it('完整终账允许零成本候选形成明确的零 Token 桶，不落入 unknown', async () => {
    const runId = '00000000-0000-4000-8000-000000000710';
    const officialSnapshotHash = createHash('sha256').update('[]').digest('hex');
    const query = vi.fn(async (sqlValue: unknown, _params?: unknown[]) => {
      const sql = String(sqlValue);
      if (sql.includes('FULL OUTER JOIN official_usage')) return queryResult([{
        expense_date: '2026-06-23',
        product: 'ark_bd',
        recognized_model: 'Seedance 2.0',
        pricing_resolution_band: '480p-720p',
        pricing_input_class: 'with-video',
        unit_price_per_million: '28.000000',
        currency: 'CNY',
        raw_local_tokens: '0',
        raw_local_cost_cny: '0.000000',
        inferred_adjustment_tokens: '0',
        inferred_adjustment_cost_cny: '0.000000',
        official_tokens: '0',
        official_cost_cny: '0.000000',
        zero_cost_candidate_count: '1',
      }]);
      if (sql.includes('FROM provider_bill_sync_run_items')) return queryResult([]);
      if (sql.includes('FROM provider_reconciliation_runs') && sql.includes('ORDER BY created_at DESC')) {
        return queryResult([{
          bill_state: 'provisional',
          official_snapshot_hash: officialSnapshotHash,
          created_at: '2000-01-01T00:00:00.000Z',
        }]);
      }
      if (sql.includes('INSERT INTO provider_reconciliation_runs')) return queryResult([{ id: runId }]);
      if (sql.includes('INSERT INTO provider_reconciliation_buckets')) return queryResult([]);
      throw new Error(`未处理的零桶快照 SQL：${sql}`);
    });

    await expect(generateProviderReconciliationSnapshot({ query } as never, {
      billPeriod: '2026-06',
      windowStart: '2026-06-01',
      windowEnd: '2026-06-30',
      officialSyncRunId: '00000000-0000-4000-8000-000000000711',
      isFinal: true,
    })).resolves.toBe(runId);

    const aggregationSql = String(query.mock.calls[0]?.[0]);
    expect(aggregationSql).toContain('zero_cost_candidate_usage AS');
    expect(aggregationSql).toContain('candidate.pricing_resolution_band');
    expect(aggregationSql).toContain('NOT EXISTS (');
    const runInsert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_reconciliation_runs'));
    expect(runInsert?.[1]).toEqual(expect.arrayContaining([
      'final', 'raw-matched', 'complete', '0', '0.000000',
    ]));
    const bucketInsert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_reconciliation_buckets'));
    expect(bucketInsert?.[1]?.at(-1)).toBe('raw-matched');
  });

  it('余额快照九个参数严格对应官方余额字段', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ResponseMetadata: { RequestId: 'balance-request' },
      Result: {
        AccountID: 'account-1',
        AvailableBalance: '10.000001',
        CashBalance: '9.000002',
        FreezeAmount: '1.000003',
        ArrearsBalance: '2.000004',
        CreditLimit: '3.000005',
      },
    })));

    await expect(syncVolcengineBillingBalance({ force: true }))
      .resolves.toMatchObject({ ok: true, rows: 1 });
    const insert = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_account_balance_snapshots'));
    expect(insert?.[1]).toEqual([
      'volcengine-ark', 'account-1', '10.000001', '9.000002', '1.000003',
      '2.000004', '3.000005', 'CNY', 'balance-request',
    ]);
  });

  it('资源包同步同时保存当前投影、不可变快照和期初事件', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ResponseMetadata: { RequestId: 'package-request' },
      Result: {
        List: [{
          InstanceNo: 'Ark_bd-package-1',
          ProductName: '字节跳动大模型服务（豆包大模型）',
          ConfigurationName: 'Doubao-Seedance-2.0-Mini 在线推理资源包',
          TotalAmount: '1000',
          AvailableAmount: '900',
          Unit: '千tokens',
          Status: 'Effective',
        }],
      },
    })));

    await expect(syncVolcengineBillingPackages({ force: true }))
      .resolves.toMatchObject({ ok: true, rows: 1 });
    const queries = mocks.clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(queries.some(sql => sql.includes('INSERT INTO provider_resource_packages'))).toBe(true);
    expect(queries.some(sql => sql.includes('INSERT INTO provider_resource_package_snapshots'))).toBe(true);
    expect(queries.some(sql => sql.includes('INSERT INTO provider_resource_package_cost_events'))).toBe(true);
  });

  it('首个资源包快照按购置成本补记首拍前累计摊销', async () => {
    installClientQuery(undefined, [], { acquisitionCostCny: '196.000000' });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Result: {
        List: [{
          InstanceNo: 'Ark_bd-package-opening',
          ProductName: '豆包大模型',
          ConfigurationName: 'Doubao-Seedance-2.0-Mini 在线推理资源包',
          TotalAmount: '14000000', AvailableAmount: '7946987', Unit: 'token',
          Status: 'Effective',
        }],
      },
    })));

    await expect(syncVolcengineBillingPackages({ force: true }))
      .resolves.toMatchObject({ ok: true });
    const event = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_resource_package_cost_events'));
    expect(event?.[1]?.slice(3, 7)).toEqual([
      'opening-balance', '-6053013', '84.742182', 'allocated',
    ]);
  });

  it('首次看到终止资源包时拆分历史消耗与真实到期余量', async () => {
    installClientQuery(undefined, [], { acquisitionCostCny: '10.000000' });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Result: {
        List: [{
          InstanceNo: 'Ark_bd-package-terminal-first',
          ProductName: '豆包大模型',
          ConfigurationName: 'Doubao-Seedance-2.0-Mini 在线推理资源包',
          TotalAmount: '1000', AvailableAmount: '100', Unit: 'token',
          Status: 'Expired',
        }],
      },
    })));

    await expect(syncVolcengineBillingPackages({ force: true }))
      .resolves.toMatchObject({ ok: true });
    const events = mocks.clientQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO provider_resource_package_cost_events'));
    expect(events.map(([, params]) => params?.slice(3, 7))).toEqual([
      ['opening-balance', '-900', '9.000000', 'allocated'],
      ['expiry-writeoff', '-100', '1.000000', 'allocated'],
    ]);
  });

  it('活动资源包转终止时把末次消费与终止余量分开', async () => {
    installClientQuery(undefined, [], {
      acquisitionCostCny: '10.000000',
      previousSnapshot: {
        id: '00000000-0000-4000-8000-000000000097',
        remaining_quota: '100', status: 'Effective',
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Result: {
        List: [{
          InstanceNo: 'Ark_bd-package-terminal-transition', ProductName: '豆包大模型',
          ConfigurationName: 'Doubao-Seedance-2.0-Mini 在线推理资源包',
          TotalAmount: '100', AvailableAmount: '20', Unit: 'token', Status: 'Expired',
        }],
      },
    })));

    await expect(syncVolcengineBillingPackages({ force: true }))
      .resolves.toMatchObject({ ok: true });
    const events = mocks.clientQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO provider_resource_package_cost_events'));
    expect(events.map(([, params]) => params?.slice(3, 7))).toEqual([
      ['consumption', '-80', '8.000000', 'allocated'],
      ['expiry-writeoff', '-20', '2.000000', 'allocated'],
    ]);
  });

  it('供应商终止快照把余量强制清零时不猜测消费与到期拆分', async () => {
    installClientQuery(undefined, [], {
      acquisitionCostCny: '10.000000',
      previousSnapshot: {
        id: '00000000-0000-4000-8000-000000000096',
        remaining_quota: '100', status: 'Effective',
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Result: {
        List: [{
          InstanceNo: 'Ark_bd-package-terminal-zero', ProductName: '豆包大模型',
          ConfigurationName: 'Doubao-Seedance-2.0-Mini 在线推理资源包',
          TotalAmount: '100', AvailableAmount: '0', Unit: 'token', Status: 'Expired',
        }],
      },
    })));

    await expect(syncVolcengineBillingPackages({ force: true }))
      .resolves.toMatchObject({ ok: true });
    const event = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_resource_package_cost_events'));
    expect(event?.[1]?.slice(3, 7)).toEqual([
      'expiry-writeoff', '-100', null, 'missing-acquisition',
    ]);
    expect(JSON.parse(String(event?.[1]?.[7]))).toMatchObject({
      allocationEligible: false,
      attribution: 'terminal-provider-zero-cannot-split-consumption-from-expiry',
    });
  });

  it('首次看到余量被强制清零的终止资源包也保持不可归因', async () => {
    installClientQuery(undefined, [], { acquisitionCostCny: '10.000000' });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Result: {
        List: [{
          InstanceNo: 'Ark_bd-package-terminal-zero-first', ProductName: '豆包大模型',
          ConfigurationName: 'Doubao-Seedance-2.0-Mini 在线推理资源包',
          TotalAmount: '100', AvailableAmount: '0', Unit: 'token', Status: 'Expired',
        }],
      },
    })));

    await expect(syncVolcengineBillingPackages({ force: true }))
      .resolves.toMatchObject({ ok: true });
    const event = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_resource_package_cost_events'));
    expect(event?.[1]?.slice(3, 7)).toEqual([
      'expiry-writeoff', '-100', null, 'missing-acquisition',
    ]);
    expect(JSON.parse(String(event?.[1]?.[7]))).toMatchObject({
      allocationEligible: false,
      attribution: 'terminal-first-provider-zero-cannot-split-consumption-from-expiry',
    });
  });

  it('后续购置账单补齐不会把不可归因的终止事件重新分配', async () => {
    mocks.clientQuery.mockReset();
    mocks.clientQuery.mockResolvedValue(queryResult([]));
    await reconcileOpeningPackageCostBasis(
      mocks.client as never,
      'volcengine-ark',
      'Ark_bd-package-terminal-zero',
    );
    const sql = String(mocks.clientQuery.mock.calls[0]?.[0]);
    expect(sql).toContain("events.evidence->>'allocationEligible' IS DISTINCT FROM 'false'");
  });

  it('资源包余量正向调整降级为待归因，避免恢复额度被重复摊销', async () => {
    installClientQuery(undefined, [], {
      acquisitionCostCny: '14.000000',
      previousSnapshot: {
        id: '00000000-0000-4000-8000-000000000099',
        remaining_quota: '800000',
        status: 'Effective',
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Result: {
        List: [{
          InstanceNo: 'Ark_bd-package-adjustment',
          ProductName: '豆包大模型',
          ConfigurationName: 'Doubao-Seedance-2.0-Mini 在线推理资源包',
          TotalAmount: '1000000', AvailableAmount: '900000', Unit: 'token',
          Status: 'Effective',
        }],
      },
    })));

    await expect(syncVolcengineBillingPackages({ force: true }))
      .resolves.toMatchObject({ ok: true });
    const event = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_resource_package_cost_events'));
    expect(event?.[1]?.slice(3, 7)).toEqual([
      'adjustment', '100000', null, 'missing-acquisition',
    ]);
  });

  it('Stale 资源包重新出现后的余量下降只归属缺失区间', async () => {
    installClientQuery(undefined, [], {
      acquisitionCostCny: '14.000000',
      previousSnapshot: {
        id: '00000000-0000-4000-8000-000000000096',
        remaining_quota: '900000',
        status: 'Stale',
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Result: {
        List: [{
          InstanceNo: 'Ark_bd-package-reappeared',
          ProductName: '豆包大模型',
          ConfigurationName: 'Doubao-Seedance-2.0-Mini 在线推理资源包',
          TotalAmount: '1000000', AvailableAmount: '800000', Unit: 'token',
          Status: 'Effective',
        }],
      },
    })));

    await expect(syncVolcengineBillingPackages({ force: true }))
      .resolves.toMatchObject({ ok: true });
    const event = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_resource_package_cost_events'));
    expect(event?.[1]?.slice(3, 7)).toEqual([
      'consumption', '-100000', '1.400000', 'allocated',
    ]);
    expect(JSON.parse(String(event?.[1]?.[7]))).toMatchObject({
      timeAttributionUncertain: true,
      attribution: 'consumed-during-stale-gap',
    });
  });

  it('Stale 资源包直接终止时仍把缺口期消耗标记为时间归属不确定', async () => {
    installClientQuery(undefined, [], {
      acquisitionCostCny: '10.000000',
      previousSnapshot: {
        id: '00000000-0000-4000-8000-000000000095',
        remaining_quota: '900',
        status: 'Stale',
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Result: {
        List: [{
          InstanceNo: 'Ark_bd-package-stale-terminal',
          ProductName: '豆包大模型',
          ConfigurationName: 'Doubao-Seedance-2.0-Mini 在线推理资源包',
          TotalAmount: '1000', AvailableAmount: '600', Unit: 'token', Status: 'Expired',
        }],
      },
    })));

    await expect(syncVolcengineBillingPackages({ force: true }))
      .resolves.toMatchObject({ ok: true });
    const events = mocks.clientQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO provider_resource_package_cost_events'));
    expect(events.map(([, params]) => params?.slice(3, 7))).toEqual([
      ['consumption', '-300', '3.000000', 'allocated'],
      ['expiry-writeoff', '-600', '6.000000', 'allocated'],
    ]);
    expect(JSON.parse(String(events[0]?.[1]?.[7]))).toMatchObject({
      timeAttributionUncertain: true,
      attribution: 'consumed-during-stale-gap-before-terminal',
    });
  });

  it('完整同步中消失但无到期证据的资源包保留最后可信余量且不核销', async () => {
    installClientQuery(undefined, [], {
      acquisitionCostCny: '14.000000',
      previousSnapshot: {
        id: '00000000-0000-4000-8000-000000000098',
        remaining_quota: '900000',
        status: 'Effective',
      },
      missingPackages: [{
        package_id: 'Ark_bd-package-missing',
        product: '豆包大模型',
        config: 'Doubao-Seedance-2.0-Mini 在线推理资源包',
        recognized_model: 'Seedance 2.0 Mini',
        status: 'Effective',
        total_quota: 1000000,
        remaining_quota: 900000,
        starts_at: null,
        expires_at: null,
      }],
    });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ Result: { List: [] } })));

    await expect(syncVolcengineBillingPackages({ force: true }))
      .resolves.toMatchObject({ ok: true, rows: 0 });
    const staleProjection = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("ELSE 'Stale'"));
    expect(String(staleProjection?.[0])).not.toContain('remaining_quota = 0');
    const snapshot = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_resource_package_snapshots'));
    expect(snapshot?.[1]?.[6]).toBe('Stale');
    expect(snapshot?.[1]?.[8]).toBe(900000);
    const event = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_resource_package_cost_events'));
    expect(event).toBeUndefined();
  });

  it('完整同步中消失且已越过明确到期时间的资源包才核销最后可信余量', async () => {
    installClientQuery(undefined, [], {
      acquisitionCostCny: '14.000000',
      previousSnapshot: {
        id: '00000000-0000-4000-8000-000000000097',
        remaining_quota: '900000',
        status: 'Effective',
      },
      missingPackages: [{
        package_id: 'Ark_bd-package-expired-missing',
        product: '豆包大模型',
        config: 'Doubao-Seedance-2.0-Mini 在线推理资源包',
        recognized_model: 'Seedance 2.0 Mini',
        status: 'Effective',
        total_quota: 1000000,
        remaining_quota: 900000,
        starts_at: null,
        expires_at: '2020-01-01T00:00:00.000Z',
      }],
    });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ Result: { List: [] } })));

    await expect(syncVolcengineBillingPackages({ force: true }))
      .resolves.toMatchObject({ ok: true, rows: 0 });
    const snapshot = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_resource_package_snapshots'));
    expect(snapshot?.[1]?.[6]).toBe('Expired');
    expect(snapshot?.[1]?.[8]).toBe(900000);
    const event = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO provider_resource_package_cost_events'));
    expect(event?.[1]?.slice(3, 7)).toEqual([
      'expiry-writeoff', '-900000', '12.600000', 'allocated',
    ]);
  });
});

describe('历史零成本案件终账审核', () => {
  it('061 迁移锁定十二条历史证据，空库跳过、部分匹配失败且重复执行幂等', async () => {
    const migration = await readFile(
      new URL('../migrations/061_close_zero_cost_candidates.sql', import.meta.url),
      'utf8',
    );
    for (const id of [
      '69c708fd-d1ec-44ff-905b-f34b1195d342',
      '43af558a-7cc8-4801-90ab-c949b1ea4c24',
      '6dbac28a-0d18-4eec-a6fc-84a90f3382e0',
      'b46a846d-43f0-40c7-9afa-31c2987ca352',
      'a96a3c11-6dc4-4b77-a9b8-0b2e367b28e4',
      '4f251149-d565-440e-ab5c-7c20b1b7c778',
      '585dbfa8-30cb-4395-a462-27618cc9406b',
      '0d312c97-5e14-45ea-b218-c71c688e43ee',
      '4e587fb5-2108-4e1b-a2bc-e6365a03c703',
      '67ce6251-298d-4ed5-8d1d-90eb42e87482',
      'd87b78a4-a83a-4e99-9322-c5c31a1341ba',
      '937acb17-c72c-4eeb-b22d-458dc9ee5431',
    ]) expect(migration).toContain(id);
    expect(migration).toContain('target_task_count = 0 AND target_usage_count = 0');
    expect(migration).toContain('target_task_count <> 12 OR target_usage_count <> 12');
    expect(migration).toContain("'zero-cost:' || target.usage_record_id::text");
    expect(migration).toContain("substring(usage_record.error from 'requestId=");
    expect(migration).toContain("action = '人工退回积分'");
    expect(migration).toContain("action = '历史待核对收口'");
    expect(migration).toContain('将历史取消待核对任务收口并退回冻结积分。');
    expect(migration).toContain('将历史提交结果未知任务收口为失败并退回冻结积分。');
    expect(migration).toContain("target.evidence_type = 'http-400'");
    expect(migration).toContain('用户已请求取消；外部任务可能已提交，继续轮询终态并保留供应商成本。');
    expect(migration).toContain("status NOT IN ('open', 'approved', 'superseded')");
    expect(migration).toContain('existing_link_count <> 1');
    expect(migration).toContain('FROM audit_logs AS existing_audit');
    expect(migration).toContain('existing_audit.target = reconciliation_case.case_key');
    expect(migration).not.toMatch(/UPDATE\s+provider_usage_records/i);
    expect(migration).not.toMatch(/UPDATE\s+generation_tasks/i);
  });

  it('039 迁移使用完整确定性清单，且不改写原始用量、任务或积分', async () => {
    const migration = await readFile(
      new URL('../migrations/039_seed_zero_cost_reconciliation_cases.sql', import.meta.url),
      'utf8',
    );
    for (const id of [
      ZERO_COST_TASK_ID,
      ZERO_COST_USAGE_ID,
      '24f63ad0-e06b-4304-b3c6-c555417337c1',
      '27273444-826e-49a4-9728-3ad3e6b1d077',
      'c34327fc-301a-47a2-8352-769d5a525a1a',
      'ca1a2da6-522d-4d68-bc98-f604428e5b1b',
    ]) expect(migration).toContain(id);
    expect(migration).toContain('target_task_count = 0 AND target_usage_count = 0');
    expect(migration).toContain('target_task_count <> 3 OR target_usage_count <> 3');
    expect(migration).toContain("'zero-cost:' || target.task_id::text");
    expect(migration).toContain("'resolutionKind', 'zero-cost'");
    expect(migration).toContain("'status', 'pending-final-bill'");
    expect(migration).toContain('FROM audit_logs AS existing_audit');
    expect(migration).toContain('existing_audit.target = reconciliation_case.case_key');
    expect(migration).not.toMatch(/UPDATE\s+provider_usage_records/i);
    expect(migration).not.toMatch(/UPDATE\s+generation_tasks/i);
  });

  it('只在完整 final 月账、完整覆盖且唯一计价桶零残差时逐案批准', async () => {
    const query = installZeroCostReviewQuery({
      run: zeroCostReviewRun(),
      cases: [zeroCostCaseRow()],
      bucket: zeroCostBucket(),
    });

    await expect(reviewFinalBillZeroCostCases({ query } as never, ZERO_COST_RUN_ID))
      .resolves.toEqual({
        reviewed: 1,
        approved: 1,
        reopened: 0,
        superseded: 0,
        metadataUpdated: 1,
      });
    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE provider_reconciliation_cases'));
    expect(update?.[1]?.[1]).toBe('approved');
    expect(JSON.parse(String(update?.[1]?.[2]))).toMatchObject({
      review: {
        status: 'approved-zero',
        reconciliationRunId: ZERO_COST_RUN_ID,
        billState: 'final',
        coverageState: 'complete',
        residualTokens: '0',
        residualCostCny: '0.000000',
      },
    });
    const audit = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO audit_logs'));
    expect(audit?.[1]?.slice(0, 2)).toEqual([
      '确认历史任务零成本',
      `zero-cost:${ZERO_COST_TASK_ID}`,
    ]);
    expect(String(audit?.[0])).toContain("'high'");
  });

  it.each([
    {
      name: '同步运行尚未标记终账',
      run: zeroCostReviewRun({ official_sync_is_final: false }),
      expectedStatus: 'pending-final-bill',
      expectedReason: '尚未形成稳定 final 快照',
    },
    {
      name: '对账快照仍为 provisional',
      run: zeroCostReviewRun({ bill_state: 'provisional' }),
      expectedStatus: 'pending-final-bill',
      expectedReason: '尚未形成稳定 final 快照',
    },
    {
      name: '官方账单覆盖不完整',
      run: zeroCostReviewRun({ coverage_state: 'partial' }),
      expectedStatus: 'reopened',
      expectedReason: '覆盖不完整',
    },
  ])('$name 时保持 open 且拒绝批准', async ({ run, expectedStatus, expectedReason }) => {
    const query = installZeroCostReviewQuery({
      run,
      cases: [zeroCostCaseRow()],
      bucket: zeroCostBucket(),
    });

    await expect(reviewFinalBillZeroCostCases({ query } as never, ZERO_COST_RUN_ID))
      .resolves.toMatchObject({
        reviewed: 1,
        approved: 0,
        reopened: 0,
        superseded: 0,
        metadataUpdated: 1,
      });
    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE provider_reconciliation_cases'));
    expect(update?.[1]?.[1]).toBe('open');
    expect(JSON.parse(String(update?.[1]?.[2])).review).toMatchObject({
      status: expectedStatus,
      reason: expect.stringContaining(expectedReason),
    });
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('FROM provider_reconciliation_buckets'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO audit_logs'))).toBe(false);
  });

  it('相同终账快照重复审核保持幂等，不重复更新或写审计', async () => {
    const approvedReview = {
      status: 'approved-zero',
      reason: '最终账单覆盖完整，相关日期、模型和计价桶 Token/金额残差均为零',
      reconciliationRunId: ZERO_COST_RUN_ID,
      billState: 'final',
      coverageState: 'complete',
      residualTokens: '0',
      residualCostCny: '0.000000',
      officialSnapshotHash: 'snapshot-final',
      reviewedAt: '2026-08-03T00:00:00.000Z',
    };
    const query = installZeroCostReviewQuery({
      run: zeroCostReviewRun(),
      cases: [zeroCostCaseRow({ case_status: 'approved', review: approvedReview })],
      bucket: zeroCostBucket(),
    });

    await expect(reviewFinalBillZeroCostCases({ query } as never, ZERO_COST_RUN_ID))
      .resolves.toMatchObject({ reviewed: 1, approved: 0, metadataUpdated: 0 });
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('UPDATE provider_reconciliation_cases'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO audit_logs'))).toBe(false);
  });

  it.each([
    {
      name: '官方账单修订为 reopened',
      run: zeroCostReviewRun({ bill_state: 'reopened' }),
      bucket: zeroCostBucket(),
      expectedReason: '官方最终账单发生修订',
    },
    {
      name: '相关计价桶重新产生残差',
      run: zeroCostReviewRun(),
      bucket: zeroCostBucket({ residual_tokens: '1', residual_cost_cny: '0.000037' }),
      expectedReason: '仍有 Token、金额残差',
    },
  ])('$name 时把已批准案件恢复为 open', async ({ run, bucket, expectedReason }) => {
    const query = installZeroCostReviewQuery({
      run,
      cases: [zeroCostCaseRow({ case_status: 'approved' })],
      bucket,
    });

    await expect(reviewFinalBillZeroCostCases({ query } as never, ZERO_COST_RUN_ID))
      .resolves.toMatchObject({ reviewed: 1, reopened: 1, metadataUpdated: 1 });
    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE provider_reconciliation_cases'));
    expect(update?.[1]?.[1]).toBe('open');
    expect(JSON.parse(String(update?.[1]?.[2])).review.reason).toContain(expectedReason);
    const audit = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO audit_logs'));
    expect(audit?.[1]?.[0]).toBe('重开历史零成本案件');
  });

  it('目标 usage 获得正 Token 后废止候选，不再伪装成审计确认零成本', async () => {
    const query = installZeroCostReviewQuery({
      run: zeroCostReviewRun(),
      cases: [zeroCostCaseRow({ billable_tokens: '324900' })],
      bucket: zeroCostBucket(),
    });

    await expect(reviewFinalBillZeroCostCases({ query } as never, ZERO_COST_RUN_ID))
      .resolves.toMatchObject({ reviewed: 1, superseded: 1, metadataUpdated: 1 });
    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE provider_reconciliation_cases'));
    expect(update?.[1]?.[1]).toBe('superseded');
    expect(JSON.parse(String(update?.[1]?.[2])).review.status)
      .toBe('superseded-by-recorded-usage');
  });

  it('重复证据链接不能被批准，已批准案件会安全重开', async () => {
    const first = zeroCostCaseRow({ case_status: 'approved' });
    const query = installZeroCostReviewQuery({
      run: zeroCostReviewRun(),
      cases: [first, { ...first, link_id: '00000000-0000-4000-8000-000000000122' }],
      bucket: zeroCostBucket(),
    });

    await expect(reviewFinalBillZeroCostCases({ query } as never, ZERO_COST_RUN_ID))
      .resolves.toMatchObject({ reviewed: 1, approved: 0, reopened: 1 });
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('FROM provider_reconciliation_buckets'))).toBe(false);
    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE provider_reconciliation_cases'));
    expect(JSON.parse(String(update?.[1]?.[2])).review).toMatchObject({
      status: 'unresolved',
      reason: '零成本案件存在 2 条证据链接，必须保持唯一',
    });
  });

  it('日窗口和当月非完整窗口不会改变既有案件状态', async () => {
    const query = installZeroCostReviewQuery({
      run: zeroCostReviewRun({ window_end: '2026-07-15' }),
      cases: [zeroCostCaseRow()],
      bucket: zeroCostBucket(),
    });

    await expect(reviewFinalBillZeroCostCases({ query } as never, ZERO_COST_RUN_ID))
      .resolves.toEqual({
        reviewed: 0,
        approved: 0,
        reopened: 0,
        superseded: 0,
        metadataUpdated: 0,
      });
    expect(query).toHaveBeenCalledTimes(1);
  });
});

const ZERO_COST_RUN_ID = '00000000-0000-4000-8000-000000000110';
const ZERO_COST_CASE_ID = '00000000-0000-4000-8000-000000000111';
const ZERO_COST_LINK_ID = '00000000-0000-4000-8000-000000000112';
const ZERO_COST_TASK_ID = '880deb21-3ce2-4a3a-8a0d-01af2a94e7ea';
const ZERO_COST_USAGE_ID = '796060ae-f80e-47c2-93e9-af0eebc8100b';

function zeroCostReviewRun(overrides: Record<string, unknown> = {}) {
  return {
    id: ZERO_COST_RUN_ID,
    bill_period: '2026-07',
    window_start: '2026-07-01',
    window_end: '2026-07-31',
    bill_state: 'final',
    coverage_state: 'complete',
    official_snapshot_hash: 'snapshot-final',
    official_sync_is_final: true,
    ...overrides,
  };
}

function zeroCostCaseRow(overrides: Record<string, unknown> = {}) {
  const review = overrides.review;
  const row = {
    case_id: ZERO_COST_CASE_ID,
    case_key: `zero-cost:${ZERO_COST_TASK_ID}`,
    case_status: 'open',
    evidence: {
      resolutionKind: 'zero-cost',
      taskId: ZERO_COST_TASK_ID,
      usageRecordId: ZERO_COST_USAGE_ID,
      billPeriod: '2026-07',
      expenseDate: '2026-07-02',
      model: 'Seedance 2.0 Fast',
      pricingResolutionBand: '480p-720p',
      pricingInputClass: 'without-video',
      unitPricePerMillion: '37.000000',
      ...(review ? { review } : {}),
    },
    link_id: ZERO_COST_LINK_ID,
    usage_record_id: ZERO_COST_USAGE_ID,
    completion_tokens: null,
    total_tokens: null,
    billable_tokens: null,
    estimated_cost: null,
    usage_evidence_origin: 'unavailable',
    ...overrides,
  };
  delete (row as Record<string, unknown>).review;
  return row;
}

function zeroCostBucket(overrides: Record<string, unknown> = {}) {
  return {
    bucket_count: '1',
    residual_tokens: '0',
    residual_cost_cny: '0.000000',
    all_comparable: true,
    ...overrides,
  };
}

function installZeroCostReviewQuery(input: {
  run: unknown;
  cases: unknown[];
  bucket: unknown;
}) {
  return vi.fn(async (sqlValue: unknown, _params?: unknown[]) => {
    const sql = String(sqlValue);
    if (sql.includes('FROM provider_reconciliation_runs runs')) return queryResult([input.run]);
    if (sql.includes('FROM provider_reconciliation_cases cases')) return queryResult(input.cases);
    if (sql.includes('FROM provider_reconciliation_buckets')) return queryResult([input.bucket]);
    if (sql.includes('UPDATE provider_reconciliation_cases')) {
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('INSERT INTO audit_logs')) return { rowCount: 1, rows: [] };
    throw new Error(`未处理的零成本审核 SQL：${sql}`);
  });
}

function installClientQuery(
  priorBillState?: string,
  reconciliationBuckets: unknown[] = [],
  packageState: {
    acquisitionCostCny?: string | null;
    previousSnapshot?: { id: string; remaining_quota: string; status: string };
    missingPackages?: unknown[];
  } = {},
) {
  mocks.clientQuery.mockImplementation(async (sqlValue: unknown) => {
    const sql = String(sqlValue);
    mocks.events.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
    if (sql.includes('pg_try_advisory_lock')) return queryResult([{ acquired: true }]);
    if (sql.includes('INSERT INTO provider_billing_sync_runs')) {
      return queryResult([{ id: '00000000-0000-4000-8000-000000000001' }]);
    }
    if (sql.includes('INSERT INTO provider_bill_detail_revisions')) {
      return queryResult([{ id: '00000000-0000-4000-8000-000000000002' }]);
    }
    if (sql.includes('INSERT INTO provider_bill_details')) {
      return queryResult([{ id: '00000000-0000-4000-8000-000000000003' }]);
    }
    if (sql.includes('INSERT INTO provider_resource_package_snapshots')) {
      return queryResult([{
        id: '00000000-0000-4000-8000-000000000005',
        captured_at: '2026-07-13T00:00:00.000Z',
      }]);
    }
    if (sql.includes('FROM provider_resource_packages') && sql.includes('NOT (package_id = ANY')) {
      return queryResult(packageState.missingPackages ?? []);
    }
    if (sql.includes('FROM provider_resource_package_snapshots') && sql.includes('id <>')) {
      return packageState.previousSnapshot
        ? queryResult([packageState.previousSnapshot])
        : queryResult([]);
    }
    if (sql.includes('SELECT sum(coalesce(payable_amount_cny, paid_amount_cny))')) {
      return queryResult([{
        acquisition_cost_cny: packageState.acquisitionCostCny ?? null,
      }]);
    }
    if (sql.includes('FROM provider_usage_records') && sql.includes('FULL OUTER JOIN')) {
      return queryResult(reconciliationBuckets);
    }
    if (sql.includes('SELECT bill_state, official_snapshot_hash')) {
      return priorBillState
        ? queryResult([{ bill_state: priorBillState, official_snapshot_hash: 'different' }])
        : queryResult([]);
    }
    if (sql.includes('INSERT INTO provider_reconciliation_runs')) {
      return queryResult([{ id: '00000000-0000-4000-8000-000000000004' }]);
    }
    if (sql.includes('FROM provider_reconciliation_runs runs')) {
      return queryResult([{
        id: '00000000-0000-4000-8000-000000000004',
        bill_period: '2026-07',
        window_start: '2026-07-13',
        window_end: '2026-07-13',
        bill_state: 'provisional',
        coverage_state: 'complete',
        official_snapshot_hash: 'snapshot-current',
        official_sync_is_final: false,
      }]);
    }
    return queryResult([]);
  });
}

function queryResult(rows: unknown[]) {
  return { rowCount: rows.length, rows };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
