import { endpointContracts } from '@lindyson/api-contracts';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';
import {
  getAdminImageCostOverview,
  listAdminImageCostTasks,
  listAdminImageCostUsers,
} from '../src/domain/imageCostReporting.js';

describe('Seedream 图片成本看盘', () => {
  it('只读取不可变图片用量快照，不进入 Seedance Token 计价', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        task_count: 3,
        user_count: 2,
        completed_task_count: 2,
        failed_task_count: 1,
        canceled_task_count: 0,
        settled_credits: 42,
        held_credits: 0,
        refunded_credits: 14,
        reference_image_count: 4,
        output_pixels: 5_242_880,
        known_cost_task_count: 2,
        missing_evidence_task_count: 1,
        known_cost_cny: '0.940000',
      }],
    });

    const result = await getAdminImageCostOverview({ query } as unknown as DbClient, {
      range: 'custom', from: '2026-07-01', to: '2026-07-27',
      asOf: '2026-07-27T05:00:00.000Z',
    });

    expect(result.summary).toMatchObject({
      taskCount: 3,
      settledCredits: 42,
      refundedCredits: 14,
      knownCostTaskCount: 2,
      missingEvidenceTaskCount: 1,
      knownCostCny: '0.940000',
      estimateCompleteness: 'partial',
    });
    expect(result.pricing).toMatchObject({
      firstReferenceImageIncluded: 1,
      additionalReferenceUnitPriceCny: '0.020000',
      outputPixelThreshold: 2_360_000,
      smallOutputPriceCny: '0.300000',
      largeOutputPriceCny: '0.600000',
    });
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('image_provider_usage_records');
    expect(sql).toContain("task.kind = 'image'");
    expect(sql).not.toContain('FROM provider_usage_records pur');
    expect(sql).not.toContain('completion_tokens');
    expect(sql).not.toContain('pricing_resolution_band');
  });

  it('任务明细区分外部请求 ID 与仅本地 operation 证据，并展示真实输出像素', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        user_id: '22222222-2222-4222-8222-222222222222',
        user_name: '图片用户',
        email: 'image@example.com',
        model: 'Seedream 5.0 Pro',
        status: 'completed',
        credit_status: 'settled',
        reserved_credits: 28,
        settled_credits: 28,
        refunded_credits: 0,
        attempt_count: 1,
        known_usage_count: 1,
        missing_usage_count: 0,
        evidence_status: 'known',
        reference_image_count: 3,
        additional_reference_image_count: 2,
        output_width: 2_048,
        output_height: 2_048,
        output_pixels: 4_194_304,
        output_tier: 'large',
        reference_unit_price_cny: '0.020000',
        reference_price_cny: '0.040000',
        output_pixel_threshold: 2_360_000,
        small_output_price_cny: '0.300000',
        large_output_price_cny: '0.600000',
        output_price_cny: '0.600000',
        estimated_cost_cny: '0.640000',
        pricing_status: 'priced',
        price_version: 'volcengine-seedream-5.0-pro-list-2026-07-27',
        pricing_source_url: 'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
        provider_operation_id: 'image-op-local-1',
        provider_request_id: null,
        request_evidence_status: 'local-only',
        generated_images: 1,
        output_tokens: 4_096,
        total_tokens: 4_096,
        error: null,
        created_at: '2026-07-27T03:00:00.000Z',
        completed_at: '2026-07-27T03:00:10.000Z',
        __pagination_total_count: null,
        __pagination_cursor_timestamp: '2026-07-27T03:00:00.000000Z',
      }],
    });

    const result = await listAdminImageCostTasks({ query } as unknown as DbClient, {
      range: 'custom', from: '2026-07-27', to: '2026-07-27',
      asOf: '2026-07-27T05:00:00.000Z', position: 'first', limit: 20,
    });

    expect(result.items[0]).toMatchObject({
      taskId: '11111111-1111-4111-8111-111111111111',
      referenceImageCount: 3,
      additionalReferenceImageCount: 2,
      outputWidth: 2_048,
      outputHeight: 2_048,
      outputPixels: 4_194_304,
      providerOperationId: 'image-op-local-1',
      providerRequestId: null,
      requestEvidenceStatus: 'local-only',
      estimatedCostCny: '0.640000',
    });
  });

  it('无任何已知快照时人民币金额保持 null，不伪装为零成本', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        task_count: 1,
        user_count: 1,
        completed_task_count: 0,
        failed_task_count: 1,
        canceled_task_count: 0,
        settled_credits: 0,
        held_credits: 0,
        refunded_credits: 14,
        reference_image_count: 0,
        output_pixels: 0,
        known_cost_task_count: 0,
        missing_evidence_task_count: 1,
        known_cost_cny: '0.000000',
      }],
    });

    const result = await getAdminImageCostOverview({ query } as unknown as DbClient, {
      range: 'custom', from: '2026-07-27', to: '2026-07-27',
    });
    expect(result.summary).toMatchObject({
      knownCostCny: null,
      estimateCompleteness: 'unavailable',
    });
  });

  it('Seedream 运营调用归 Admin，但不增加业务任务、积分或图片 run', async () => {
    const adminId = '33333333-3333-4333-8333-333333333333';
    const asOf = '2026-08-11T23:59:00.000Z';
    const query = vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM image_task_costs task') && !text.includes('FULL OUTER JOIN')) {
        return rows([{
          task_count: 0, user_count: 0, completed_task_count: 0, failed_task_count: 0,
          canceled_task_count: 0, settled_credits: 0, held_credits: 0, refunded_credits: 0,
          reference_image_count: 0, output_pixels: 0, known_cost_task_count: 0,
          missing_evidence_task_count: 0, known_cost_cny: '0.000000',
        }]);
      }
      if (text.includes('FROM provider_operational_usage_records usage') && text.includes('SELECT count(*)')) {
        return rows([{ call_count: 2, unpriced_call_count: 0, estimated_cost_cny: '0.600000' }]);
      }
      if (text.includes('image_operational_user_costs')) {
        expect(text).toContain('FULL OUTER JOIN image_operational_user_costs');
        expect(text).not.toContain('INSERT INTO generation_tasks');
        return rows([{
          id: adminId, user_name: 'Lindyson Admin', email: 'admin@lindyson.com',
          task_count: 0, completed_task_count: 0, failed_task_count: 0,
          settled_credits: 0, refunded_credits: 0, reference_image_count: 0,
          output_pixels: 0, known_cost_task_count: 0, missing_evidence_task_count: 0,
          known_cost_cny: null, operational_call_count: 2,
          operational_unpriced_call_count: 0, business_estimated_cost_cny: '0.000000',
          operational_estimated_cost_cny: '0.600000', known_account_cost_cny: '0.600000',
          last_task_at: null, last_activity_at: '2026-08-11T23:30:00.000Z',
          __pagination_total_count: null,
          __pagination_cursor_timestamp: '2026-08-11T23:30:00.000000Z',
        }]);
      }
      throw new Error(`未预期 SQL：${text}`);
    });
    const client = { query } as unknown as DbClient;
    const overview = await getAdminImageCostOverview(client, {
      range: 'date', date: '2026-08-12', asOf,
    });
    const users = await listAdminImageCostUsers(client, {
      range: 'date', date: '2026-08-12', asOf, position: 'first', limit: 20,
    });

    expect(overview.summary).toMatchObject({
      taskCount: 0, settledCredits: 0, operationalCallCount: 2,
      businessEstimatedCostCny: '0.000000', operationalEstimatedCostCny: '0.600000',
      knownAccountCostCny: '0.600000', estimateCompleteness: 'complete',
    });
    expect(users.items).toEqual([expect.objectContaining({
      userId: adminId, email: 'admin@lindyson.com', taskCount: 0, settledCredits: 0,
      operationalCallCount: 2, businessEstimatedCostCny: '0.000000',
      operationalEstimatedCostCny: '0.600000', knownAccountCostCny: '0.600000',
      lastActivityAt: '2026-08-11T23:30:00.000Z',
    })]);
    expect(() => endpointContracts.adminApiUsageImageOverview.response.parse(overview)).not.toThrow();
    expect(() => endpointContracts.adminApiUsageImageUsers.response.parse(users)).not.toThrow();
  });
});

function rows<T>(items: T[]) {
  return { rows: items, rowCount: items.length };
}
