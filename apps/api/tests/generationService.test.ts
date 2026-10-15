import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  withTransaction: mocks.withTransaction,
}));

vi.mock('../src/domain/subscriptionLifecycle.js', () => ({
  reconcileSubscriptionWithClient: vi.fn(),
}));

import {
  beginGenerationTaskRecovery,
  createGenerationTasksBatch,
  failTaskWithRefund,
  finalizeRequestedTaskCancellation,
  isClaimedGenerationTaskCancellationRequested,
  markProviderSubmissionUnknown,
  recordProviderResponseCheckpoint,
  recordProviderUsageObservation,
  requeueExpiredGenerationTasks,
  recoverRefundedTaskSuccess,
  retryGenerationTaskWithClient,
  settleTaskSuccess,
  wakeGenerationProviderRunByCallback,
} from '../src/domain/generationService.js';
import {
  TK_PROMPT_NON_LIVE_PERSON_BOUNDARY,
  TK_PROMPT_VISUAL_TEXT_BOUNDARY,
} from '../src/domain/tkPromptEngine.js';
import type { ProviderSuccess } from '../src/domain/types.js';

describe('generationService', () => {
  beforeEach(() => {
    mocks.clientQuery.mockReset();
    mocks.withTransaction.mockReset();
    mocks.withTransaction.mockImplementation(async callback => callback({ query: mocks.clientQuery }));
  });

  it('Seedance 2.5 恶意携带提示词向导来源时在任何数据库操作前拒绝', async () => {
    await expect(createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'seedance-25-forged-prompt-wizard-source',
      requests: [{
        kind: 'video',
        model: 'Seedance 2.5',
        prompt: '恶意直调伪造向导来源',
        config: {
          mode: 'general',
          aspectRatio: '9:16',
          resolution: '720p',
          durationSeconds: 5,
        },
        promptWizardSource: {
          runId: '00000000-0000-4000-8000-000000000801',
          batchId: '00000000-0000-4000-8000-000000000802',
          planId: '00000000-0000-4000-8000-000000000803',
          engineVersion: 3,
          editBucket: 'none',
        },
      }],
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'PROMPT_WIZARD_MODEL_UNSUPPORTED',
      message: 'Seedance 2.5 暂不支持提示词向导来源，请移除 promptWizardSource 后重试。',
    });

    expect(mocks.withTransaction).not.toHaveBeenCalled();
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });

  it('Seedance 2.5 恶意携带 TK 来源时在任何数据库操作前拒绝', async () => {
    await expect(createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'seedance-25-forged-tk-prompt-source',
      requests: [{
        kind: 'video',
        model: 'Seedance 2.5',
        prompt: '恶意直调伪造 TK 来源',
        config: {
          mode: 'general',
          aspectRatio: '9:16',
          resolution: '720p',
          durationSeconds: 5,
        },
        tkPromptSource: {
          runId: '00000000-0000-4000-8000-000000000811',
          generationId: '00000000-0000-4000-8000-000000000812',
          optionId: '00000000-0000-4000-8000-000000000813',
          schemaVersion: 1,
          editBucket: 'none',
        },
      }],
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'TK_PROMPT_MODEL_UNSUPPORTED',
    });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('同一任务同时携带 V6 与 TK 来源时在数据库前拒绝', async () => {
    await expect(createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'conflicting-prompt-sources',
      requests: [{
        kind: 'video',
        model: 'Seedance 2.0',
        prompt: '冲突来源',
        config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        promptWizardSource: {
          runId: '00000000-0000-4000-8000-000000000821',
          batchId: '00000000-0000-4000-8000-000000000822',
          planId: '00000000-0000-4000-8000-000000000823',
          engineVersion: 4,
          editBucket: 'none',
        },
        tkPromptSource: {
          runId: '00000000-0000-4000-8000-000000000824',
          generationId: '00000000-0000-4000-8000-000000000825',
          optionId: '00000000-0000-4000-8000-000000000826',
          schemaVersion: 1,
          editBucket: 'none',
        },
      }],
    })).rejects.toMatchObject({ statusCode: 400, code: 'PROMPT_SOURCE_CONFLICT' });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('TK 来源拒绝真人演员素材，live_presenter 只由 Seedance 自动生成', async () => {
    await expect(createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'tk-source-with-real-portrait',
      requests: [{
        kind: 'video',
        model: 'Seedance 2.0',
        prompt: '人物出镜商品演示',
        config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 10 },
        realPortrait: {
          actorId: '00000000-0000-4000-8000-000000000827',
          portraitAssetId: '00000000-0000-4000-8000-000000000828',
        },
        tkPromptSource: {
          runId: '00000000-0000-4000-8000-000000000829',
          generationId: '00000000-0000-4000-8000-000000000830',
          optionId: '00000000-0000-4000-8000-000000000831',
          schemaVersion: 1,
          editBucket: 'none',
        },
      }],
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'TK_PROMPT_REAL_PORTRAIT_FORBIDDEN',
    });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });

  it('非法 Seedance 配置在预扣积分前拒绝创建任务', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('INSERT INTO generation_batches')) return queryResult([{ id: 'batch-1' }]);
      if (query.includes('FROM users') && query.includes('FOR UPDATE')) {
        return queryResult([
          {
            id: 'user-1',
            email: 'user@example.com',
            status: 'active',
            main_credits: 1000,
            addon_credits: 0,
          },
        ]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'invalid-config-100',
      requests: [{
        kind: 'video',
        model: 'Seedance 2.0 Fast',
        prompt: '生成产品视频',
        config: {
          resolution: '1080p',
          durationSeconds: 5,
          aspectRatio: '9:16',
        },
      }],
    })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Seedance 2.0 Fast 当前不支持 1080p 分辨率',
    });

    expect(mocks.clientQuery).toHaveBeenCalledTimes(2);
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      expect.any(Array),
    );
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO generation_tasks'),
      expect.any(Array),
    );
  });

  it('历史失败任务的参考素材失效时会在重试扣积分前拒绝', async () => {
    const task = {
      ...generationTaskRow(),
      config: {
        ...generationTaskRow().config,
        referenceAssets: [{
          id: '00000000-0000-4000-8000-000000000999',
          name: '已失效参考素材',
          thumbnail: '',
          objectKey: 'users/other-user/private.png',
          type: 'image',
        }],
      },
    };
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM generation_tasks') && query.includes('FOR UPDATE')) {
        return queryResult([task]);
      }
      if (query.includes('SELECT actor_id, portrait_asset_id')) return queryResult([]);
      if (query.includes('WITH requested(user_id, object_key)')) return queryResult([]);
      throw new Error(`重试不应继续执行查询：${query}`);
    });

    await expect(retryGenerationTaskWithClient(
      { query: mocks.clientQuery } as never,
      task.id,
      'admin-1',
    )).rejects.toMatchObject({
      statusCode: 400,
      message: '参考素材不存在或不属于当前用户',
    });

    expect(mocks.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      expect.any(Array),
    );
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO credit_ledger'),
      expect.any(Array),
    );
  });

  it('失败任务重试会用数据库规范素材和当前含视频档重新计费', async () => {
    const objectKey = 'users/user-1/reference.mp4';
    const task = {
      ...generationTaskRow(),
      config: {
        ...generationTaskRow().config,
        referenceAssets: [{
          id: '00000000-0000-4000-8000-000000000201',
          name: '客户端旧名称',
          thumbnail: 'https://client.example.test/old.jpg',
          objectKey,
          thumbnailKey: 'users/other-user/private.jpg',
          type: 'image',
        }],
      },
    };
    mocks.clientQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const query = String(sql);
      if (query.includes('FROM generation_tasks') && query.includes('FOR UPDATE')) {
        return queryResult([task]);
      }
      if (query.includes('SELECT actor_id, portrait_asset_id')) return queryResult([]);
      if (query.includes('WITH requested(user_id, object_key)')) {
        return queryResult([{
          id: '00000000-0000-4000-8000-000000000202',
          user_id: 'user-1',
          name: '数据库参考视频',
          object_key: objectKey,
          thumbnail_key: 'users/user-1/reference-thumb.jpg',
          type: 'video',
          duration_seconds: 5,
          size_bytes: 2048,
        }]);
      }
      if (query.includes('id = ANY($2::uuid[])')) {
        return queryResult([{
          id: '00000000-0000-4000-8000-000000000202',
          user_id: 'user-1',
          name: '数据库参考视频',
          object_key: objectKey,
          thumbnail_key: 'users/user-1/reference-thumb.jpg',
          type: 'video',
          duration_seconds: 5,
          size_bytes: 2048,
        }]);
      }
      if (query.includes('FROM consumption_settings')) {
        return queryResult([{ credits: 10, reference_video_credits: 30 }]);
      }
      if (query.includes('SELECT main_credits, addon_credits')) {
        return queryResult([{ main_credits: 100, addon_credits: 0 }]);
      }
      if (query.includes('UPDATE generation_tasks')) {
        return queryResult([{
          ...task,
          status: 'queued',
          config: params?.[3],
          credits: params?.[4],
          reserved_credits: params?.[4],
          refunded_credits: 0,
          credit_status: 'held',
        }]);
      }
      if (query.includes('SELECT amount') && query.includes('FROM credit_allocations')) return queryResult([]);
      if (query.includes('COALESCE(sum(available_amount)')) {
        return queryResult([{ main_credits: 70, addon_credits: 0 }]);
      }
      if (query.includes('FROM credit_lots')) {
        return queryResult([{ id: 'lot-main-1', bucket: 'main', available_amount: 100, held_amount: 0, expires_at: null }]);
      }
      if (query.includes('UPDATE credit_lots')) return queryResult([{ id: 'lot-main-1' }]);
      if (
        query.includes('INSERT INTO credit_allocations')
        || query.includes('INSERT INTO credit_ledger')
        || query.includes('INSERT INTO audit_logs')
      ) return queryResult([]);
      if (query.includes('UPDATE users')) return queryResult([{ id: 'user-1' }]);
      throw new Error(`未预期的重试查询：${query}`);
    });

    const retried = await retryGenerationTaskWithClient(
      { query: mocks.clientQuery } as never,
      task.id,
      'admin-1',
    );

    const canonicalReference = {
      id: '00000000-0000-4000-8000-000000000202',
      name: '数据库参考视频',
      thumbnail: '',
      objectKey,
      thumbnailKey: 'users/user-1/reference-thumb.jpg',
      type: 'video',
      role: 'reference_video',
      durationSeconds: 5,
      sizeBytes: 2048,
    };
    expect(retried.credits).toBe(30);
    expect(retried.config).toMatchObject({
      referenceAssets: [canonicalReference],
    });
    expect(retried.config).not.toHaveProperty('referenceImages');
    expect(findQueryCall('UPDATE generation_tasks')?.[1]).toEqual([
      task.id,
      30,
      0,
      expect.objectContaining({ referenceAssets: [canonicalReference] }),
      30,
    ]);
    expect(findQueryCall('UPDATE users')?.[1]).toEqual(['user-1', 70, 0, 70]);
    expect(findQueryCall('INSERT INTO credit_ledger')?.[1]?.[2]).toBe(-30);
  });

  it('供应商失败时按原有路径退还全部预扣积分并写入退款流水', async () => {
    const task = {
      ...generationTaskRow(),
      status: 'failed',
      processing_stage: 'failed',
      credit_status: 'held',
      main_credits_used: 7,
      addon_credits_used: 3,
      refunded_credits: 0,
      completed_at: null,
    };

    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM generation_tasks') && query.includes('FOR UPDATE')) {
        return queryResult([task]);
      }
      if (query.includes('SELECT main_credits, addon_credits')) {
        return queryResult([{ main_credits: 90, addon_credits: 20 }]);
      }
      if (query.includes('FROM credit_allocations allocation')) {
        return queryResult([
          { id: 'allocation-main', lot_id: 'lot-main', amount: 7, status: 'held', bucket: 'main', expires_at: null },
          { id: 'allocation-addon', lot_id: 'lot-addon', amount: 3, status: 'held', bucket: 'addon', expires_at: null },
        ]);
      }
      if (query.includes('COALESCE(sum(available_amount)')) {
        return queryResult([{ main_credits: 97, addon_credits: 23 }]);
      }
      if (query.includes('UPDATE users')) return queryResult([{ id: 'user-1' }]);
      if (query.includes('UPDATE credit_ledger')) {
        return queryResult([]);
      }
      if (query.includes('UPDATE credit_lots') || query.includes('UPDATE credit_allocations')) {
        return queryResult([{ id: 'updated' }]);
      }
      if (
        query.includes('INSERT INTO credit_ledger')
        || query.includes('INSERT INTO provider_usage_records')
      ) {
        return queryResult([]);
      }
      if (query.includes('INSERT INTO audit_logs')) return queryResult([]);
      if (query.includes('UPDATE generation_tasks')) {
        return queryResult([{
          ...task,
          status: 'failed',
          failure_category: 'provider-failed',
          failure_reason: '供应商响应失败',
          provider_task_id: 'provider-task-1',
          refunded_credits: 10,
          credit_status: 'refunded',
          completed_at: '2026-07-02T02:00:00.000Z',
        }]);
      }
      if (query.includes('UPDATE generation_provider_runs')) return queryResult([{ id: 'run-1' }]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(failTaskWithRefund('task-1', {
      ok: false,
      provider: 'volcengine-ark',
      providerTaskId: 'provider-task-1',
      category: 'provider-failed',
      reason: '供应商响应失败',
      rawUnits: 123,
      deductedUnits: 123,
      completionTokens: 123,
      totalTokens: 123,
      billableTokens: 123,
      billableBasis: 'completion_tokens',
      usageUnit: 'tokens',
    }, undefined, {
      adminUserId: 'admin-1',
      ip: '127.0.0.1',
      detail: '人工退回测试任务积分。',
    })).resolves.toMatchObject({
      id: 'task-1',
      status: 'failed',
      creditStatus: 'refunded',
      refundedCredits: 10,
    });

    expect(findQueryCall('UPDATE users')?.[1]).toEqual(['user-1', 97, 23, 120]);
    expect(findQueryCall('UPDATE credit_ledger')?.[1]).toEqual([
      'task-1',
      '视频生成失败，本次预扣已解除。',
    ]);
    expect(findQueryCall('INSERT INTO credit_ledger')?.[1]).toEqual([
      'user-1',
      'mixed',
      10,
      120,
      '视频生成失败，本次预扣积分已退回账户。',
      'task-1',
      'generation-failure-refund:task-1:0',
    ]);
    expect(findQueryCall('INSERT INTO provider_usage_records')?.[1]).toEqual([
      'volcengine-ark',
      'Seedance 2.0 Mini',
      'task-1',
      0,
      'provider-task-1',
      'failed',
      123,
      123,
      'tokens',
      '供应商响应失败',
      123,
      123,
      123,
      'completion_tokens',
      '480p',
      false,
      'volcengine-seedance-2026-08-10',
      '23.000000',
      '0.002829',
      'CNY',
      'priced',
      'provider-reported',
      'priced',
      'without-video',
      '480p-720p',
      'direct',
      null,
      expect.any(String),
      expect.any(String),
      'usage-observed',
    ]);
    expect(findQueryCall('UPDATE generation_tasks')?.[1]).toEqual([
      'task-1',
      'provider-task-1',
      'provider-failed',
      '供应商响应失败',
      10,
    ]);
    expect(findQueryCall('INSERT INTO audit_logs')?.[1]).toEqual([
      'admin-1',
      'task-1',
      '127.0.0.1',
      '人工退回测试任务积分。',
    ]);
    expect(String(findQueryCall('UPDATE generation_provider_runs')?.[0])).toMatch(
      /provider_response_url = CASE[\s\S]*provider_response_checkpoint IS NOT NULL THEN NULL/,
    );
  });

  it('失败任务释放已过期 lot 时不虚报积分已退回', async () => {
    const task = {
      ...generationTaskRow(),
      status: 'failed',
      processing_stage: 'failed',
      credit_status: 'held',
      provider_task_id: 'provider-task-expired',
      main_credits_used: 10,
      addon_credits_used: 0,
      refunded_credits: 0,
      completed_at: null,
    };

    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM generation_tasks') && query.includes('FOR UPDATE')) return queryResult([task]);
      if (query.includes('SELECT main_credits, addon_credits')) {
        return queryResult([{ main_credits: 90, addon_credits: 0 }]);
      }
      if (query.includes('FROM credit_allocations allocation')) {
        return queryResult([{
          id: 'allocation-expired',
          lot_id: 'lot-expired',
          amount: 10,
          status: 'held',
          bucket: 'main',
          expires_at: '2020-01-01T00:00:00.000Z',
        }]);
      }
      if (query.includes('UPDATE credit_lots')) {
        expect(query).toContain('expired_amount = expired_amount + $2');
        return queryResult([{ id: 'lot-expired' }]);
      }
      if (query.includes('UPDATE credit_allocations')) return queryResult([{ id: 'allocation-expired' }]);
      if (query.includes('COALESCE(sum(available_amount)')) {
        return queryResult([{ main_credits: 90, addon_credits: 0 }]);
      }
      if (query.includes('UPDATE users')) return queryResult([{ id: 'user-1' }]);
      if (query.includes('UPDATE credit_ledger') || query.includes('INSERT INTO credit_ledger')) return queryResult([]);
      if (query.includes('INSERT INTO provider_usage_records')) return queryResult([]);
      if (query.includes('UPDATE generation_tasks')) {
        return queryResult([{
          ...task,
          credit_status: 'refunded',
          refunded_credits: 0,
          failure_reason: '供应商确认未计费',
          completed_at: '2026-07-16T10:00:00.000Z',
        }]);
      }
      if (query.includes('UPDATE generation_provider_runs')) return queryResult([{ id: 'run-1' }]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(failTaskWithRefund('task-1', {
      ok: false,
      provider: 'volcengine-ark',
      providerTaskId: 'provider-task-expired',
      category: 'provider-failed',
      reason: '供应商确认未计费',
      terminal: true,
      providerStatus: 'failed',
      billingDisposition: 'unbilled',
    })).resolves.toMatchObject({
      creditStatus: 'refunded',
      refundedCredits: 0,
    });

    expect(findQueryCall('UPDATE credit_ledger')?.[1]).toEqual([
      'task-1',
      '视频生成失败，本次预扣已解除；原批次中已过期的积分未恢复。',
    ]);
    expect(findQueryCall('INSERT INTO credit_ledger')?.[1]).toEqual([
      'user-1',
      'main',
      0,
      90,
      '视频生成失败，未过期的预扣积分已退回；已过期积分未重新计入账户。',
      'task-1',
      'generation-failure-refund:task-1:0',
    ]);
    expect(findQueryCall('UPDATE generation_tasks')?.[1]).toEqual([
      'task-1',
      'provider-task-expired',
      'provider-failed',
      '供应商确认未计费',
      0,
    ]);
  });

  it('任务失败释放已撤销奖励时完成收口且不虚报到账', async () => {
    const task = { ...generationTaskRow(), status: 'failed', processing_stage: 'failed', credit_status: 'held',
      main_credits_used: 0, addon_credits_used: 10, refunded_credits: 0 };
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM generation_tasks')) return queryResult([task]);
      if (query.includes('SELECT main_credits, addon_credits') || query.includes('COALESCE(sum(available_amount)')) {
        return queryResult([{ main_credits: 90, addon_credits: 0 }]);
      }
      if (query.includes('FROM credit_allocations allocation')) return queryResult([{
        id: 'allocation-revoked', lot_id: 'lot-revoked', amount: 10, status: 'held', bucket: 'addon',
        expires_at: null, referral_revoked_at: new Date(),
      }]);
      if (query.includes('FROM referral_rewards reward')) return queryResult([{ user_id: 'user-1', order_id: 'order-1' }]);
      if (query.includes('UPDATE credit_lots')) {
        expect(query).toContain('reversed_amount = reversed_amount +');
        expect(query).not.toContain('available_amount = available_amount +');
      }
      if (query.includes('UPDATE generation_tasks')) return queryResult([{ ...task, credit_status: 'refunded' }]);
      if (query.includes('INSERT INTO provider_usage_records')) return queryResult([]);
      if (/^(\s*)(UPDATE|INSERT)/.test(query)) return queryResult([{ id: 'updated' }]);
      throw new Error(`未预期的查询：${query}`);
    });
    await expect(failTaskWithRefund('task-1', {
      ok: false, category: 'provider-failed', reason: '任务失败', terminal: true,
    })).resolves.toMatchObject({ creditStatus: 'refunded', refundedCredits: 0 });
    expect(findQueryCall('UPDATE generation_tasks')?.[1]?.[4]).toBe(0);
    const refunds = mocks.clientQuery.mock.calls.filter(([sql]) => String(sql).includes("VALUES ($1, 'refund'"));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.[1]?.[2]).toBe(0);
  });

  it('旧 worker 的 attempt 过期后不能退回新 attempt 的预扣积分', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM generation_tasks') && query.includes('attempt = $2')) {
        expect(params).toEqual(['task-1', 1, null]);
        return queryResult([]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(failTaskWithRefund('task-1', {
      ok: false,
      category: 'provider-failed',
      reason: '旧 worker 超时',
    }, 1)).resolves.toBeNull();
    expect(mocks.clientQuery).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: '计费证据未知',
      billingDisposition: 'unknown' as const,
      reason: 'failed without billing evidence',
      completionTokens: undefined,
      totalTokens: undefined,
    },
    {
      name: '已有计费用量',
      billingDisposition: 'billable' as const,
      reason: 'failed after billable work',
      completionTokens: 100,
      totalTokens: 100,
    },
  ])('普通供应商终态失败（$name）仍退回预扣并保留成本记录', async ({
    billingDisposition,
    reason,
    completionTokens,
    totalTokens,
  }) => {
    const claimToken = '00000000-0000-4000-8000-000000000301';
    const task = {
      ...generationTaskRow(),
      status: 'processing',
      processing_stage: 'provider-running',
      credit_status: 'held',
      refunded_credits: 0,
      claim_token: claimToken,
    };
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM generation_tasks') && query.includes('FOR UPDATE')) return queryResult([task]);
      if (query.includes('INSERT INTO provider_usage_records')) return queryResult([]);
      if (query.includes('SELECT main_credits, addon_credits')) {
        return queryResult([{ main_credits: 90, addon_credits: 0 }]);
      }
      if (query.includes('FROM credit_allocations allocation')) {
        return queryResult([{
          id: 'allocation-1',
          lot_id: 'lot-1',
          amount: 10,
          status: 'held',
          bucket: 'main',
          expires_at: null,
        }]);
      }
      if (query.includes('COALESCE(sum(available_amount)')) {
        return queryResult([{ main_credits: 100, addon_credits: 0 }]);
      }
      if (query.includes('UPDATE credit_lots') || query.includes('UPDATE credit_allocations')) {
        return queryResult([{ id: 'updated' }]);
      }
      if (query.includes('UPDATE users')) return queryResult([{ id: 'user-1' }]);
      if (query.includes('UPDATE credit_ledger') || query.includes('INSERT INTO credit_ledger')) return queryResult([]);
      if (query.includes('UPDATE generation_tasks')) return queryResult([{
        ...task,
        status: 'failed',
        processing_stage: 'failed',
        failure_reason: reason,
        credit_status: 'refunded',
        settled_credits: 0,
        refunded_credits: 10,
        claim_token: null,
      }]);
      if (query.includes('UPDATE generation_provider_runs')) return queryResult([{ id: 'run-1' }]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(failTaskWithRefund('task-1', {
      ok: false,
      provider: 'volcengine-ark',
      providerTaskId: 'cgt-20260701231431-ssx7t',
      category: 'provider-failed',
      reason,
      terminal: true,
      providerStatus: 'failed',
      billingDisposition,
      completionTokens,
      totalTokens,
    }, 0, undefined, claimToken)).resolves.toMatchObject({
      status: 'failed',
      creditStatus: 'refunded',
      settledCredits: 0,
      refundedCredits: 10,
    });
    expect(findQueryCall('UPDATE users')?.[1]).toEqual(['user-1', 100, 0, 100]);
    expect(findQueryCall('INSERT INTO credit_ledger')?.[1]).toEqual([
      'user-1',
      'main',
      10,
      100,
      '视频生成失败，本次预扣积分已退回账户。',
      'task-1',
      'generation-failure-refund:task-1:0',
    ]);
    expect(findQueryCall('INSERT INTO provider_usage_records')).toBeDefined();
    expect(findQueryCall('UPDATE generation_provider_runs')?.[1]).toEqual([
      task.active_provider_run_id,
      'cgt-20260701231431-ssx7t',
      reason,
      claimToken,
      'provider-failed',
    ]);
  });

  it('确定性 4xx 未创建且未计费时在退款事务内按 usage ID 幂等建立零成本候选', async () => {
    const usageId = '00000000-0000-4000-8000-000000000701';
    const caseId = '00000000-0000-4000-8000-000000000702';
    const task = refundableTaskWithoutProviderId();
    let caseInsertCount = 0;
    installRefundFailureQuery(task, {
      usageRow: {
        id: usageId,
        local_accounting_date: '2026-07-23',
        billable_tokens: null,
        estimated_cost: null,
      },
      onCaseInsert: () => queryResult(caseInsertCount++ === 0 ? [{ id: caseId }] : []),
      existingCaseId: caseId,
    });
    const failure = {
      ok: false as const,
      provider: 'volcengine-ark',
      category: 'provider-failed' as const,
      reason: 'HTTP 400，code=InputImageSensitiveContentDetected.PrivacyInformation,requestId=request-1234567890',
      terminal: true,
      providerStatus: 'not-created',
      submissionDisposition: 'not-created' as const,
      billingDisposition: 'unbilled' as const,
      providerHttpStatus: 400,
      providerErrorCode: 'InputImageSensitiveContentDetected.PrivacyInformation',
      providerRequestId: 'request-1234567890',
    };

    await expect(failTaskWithRefund('task-1', failure)).resolves.toMatchObject({ creditStatus: 'refunded' });
    await expect(failTaskWithRefund('task-1', failure)).resolves.toMatchObject({ creditStatus: 'refunded' });

    const caseCalls = mocks.clientQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO provider_reconciliation_cases'));
    expect(caseCalls).toHaveLength(2);
    expect(String(caseCalls[0]?.[0])).toContain('ON CONFLICT (provider, case_key) DO NOTHING');
    expect(caseCalls[0]?.[1]?.[0]).toBe(`zero-cost:${usageId}`);
    expect(JSON.parse(String(caseCalls[0]?.[1]?.[3]))).toMatchObject({
      resolutionKind: 'zero-cost',
      evidenceType: 'deterministic-provider-rejection',
      submissionDisposition: 'not-created',
      billingDisposition: 'unbilled',
      providerHttpStatus: 400,
      providerErrorCode: failure.providerErrorCode,
      requestId: failure.providerRequestId,
      review: { status: 'pending-final-bill' },
    });
    expect(mocks.clientQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO provider_reconciliation_case_links'))).toHaveLength(2);
    expect(mocks.clientQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("'建立确定性拒绝零成本候选'"))).toHaveLength(2);
  });

  it.each([
    {
      name: '提交结果未知的 503',
      submissionDisposition: 'unknown' as const,
      billingDisposition: 'unknown' as const,
      providerHttpStatus: 503,
    },
    {
      name: '即使上游误标未创建的 408',
      submissionDisposition: 'not-created' as const,
      billingDisposition: 'unbilled' as const,
      providerHttpStatus: 408,
    },
  ])('$name 不得自动建案', async ({ submissionDisposition, billingDisposition, providerHttpStatus }) => {
    const task = refundableTaskWithoutProviderId();
    installRefundFailureQuery(task, {
      usageRow: {
        id: '00000000-0000-4000-8000-000000000703',
        local_accounting_date: '2026-07-23',
        billable_tokens: null,
        estimated_cost: null,
      },
    });

    await failTaskWithRefund('task-1', {
      ok: false,
      provider: 'volcengine-ark',
      category: 'provider-failed',
      reason: `HTTP ${providerHttpStatus}`,
      terminal: true,
      submissionDisposition,
      billingDisposition,
      providerHttpStatus,
      providerErrorCode: 'UpstreamError',
      providerRequestId: 'request-unknown-123456',
    });

    expect(findQueryCall('INSERT INTO provider_reconciliation_cases')).toBeUndefined();
    expect(findQueryCall('INSERT INTO provider_reconciliation_case_links')).toBeUndefined();
  });

  it('重复失败回调不会重复释放 lot 或写退款流水', async () => {
    const task = {
      ...generationTaskRow(),
      status: 'failed',
      credit_status: 'refunded',
      settled_credits: 0,
      refunded_credits: 10,
    };
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM generation_tasks') && query.includes('FOR UPDATE')) {
        return queryResult([task]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(failTaskWithRefund('task-1', {
      ok: false,
      provider: 'volcengine-ark',
      providerTaskId: 'cgt-20260701231431-ssx7t',
      category: 'provider-failed',
      reason: 'duplicate terminal callback',
      terminal: true,
      providerStatus: 'failed',
      billingDisposition: 'billable',
    })).resolves.toMatchObject({
      status: 'failed',
      creditStatus: 'refunded',
      refundedCredits: 10,
    });
    expect(findQueryCall('INSERT INTO provider_usage_records')).toBeUndefined();
    expect(findQueryCall('UPDATE users')).toBeUndefined();
    expect(findQueryCall('INSERT INTO credit_ledger')).toBeUndefined();
  });

  it('已创建的供应商结果交付失败时，退分与 checkpoint 临时 URL 清理在同一事务', async () => {
    const task = refundableTaskWithoutProviderId();
    installRefundFailureQuery(task, {
      usageRow: {
        id: '00000000-0000-4000-8000-000000000704',
        local_accounting_date: '2026-07-27',
        billable_tokens: null,
        estimated_cost: null,
      },
    });

    await expect(failTaskWithRefund('task-1', {
      ok: false,
      provider: 'volcengine-ark',
      providerTaskId: 'seedream-sync:task-1:0',
      category: 'provider-failed',
      reason: 'Seedream 临时图片地址已失效',
      terminal: true,
      providerStatus: 'delivery-failed',
      submissionDisposition: 'created',
      billingDisposition: 'unknown',
    })).resolves.toMatchObject({ creditStatus: 'refunded' });

    expect(String(findQueryCall('UPDATE generation_provider_runs')?.[0])).toMatch(
      /provider_response_url = CASE[\s\S]*provider_response_checkpoint IS NOT NULL THEN NULL/,
    );
  });

  it('供应商任务尚未终态时继续冻结且不提前退款', async () => {
    const task = {
      ...generationTaskRow(),
      status: 'processing',
      processing_stage: 'provider-running',
      credit_status: 'held',
      refunded_credits: 0,
    };
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM generation_tasks') && query.includes('FOR UPDATE')) {
        return queryResult([task]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(failTaskWithRefund('task-1', {
      ok: false,
      provider: 'volcengine-ark',
      providerTaskId: 'cgt-20260701231431-ssx7t',
      category: 'provider-failed',
      reason: 'provider is still running',
      terminal: false,
      providerStatus: 'running',
      billingDisposition: 'unknown',
    })).resolves.toBeNull();
    expect(findQueryCall('INSERT INTO provider_usage_records')).toBeUndefined();
    expect(findQueryCall('UPDATE users')).toBeUndefined();
    expect(findQueryCall('INSERT INTO credit_ledger')).toBeUndefined();
  });

  it('供应商终态观察按真实 provider attempt 幂等保存并只用 completion token 计价', async () => {
    const task = {
      ...generationTaskRow(),
      status: 'processing',
      attempt: 4,
      provider_task_attempt: 2,
      config: {
        ...generationTaskRow().config,
        resolution: '720p',
        referenceAssets: [{ type: 'video', role: 'reference_video' }],
      },
    };
    mocks.clientQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM generation_tasks')) {
        expect(params).toEqual(['task-1', 4, 'provider-task-1', null]);
        return queryResult([task]);
      }
      if (query.includes('INSERT INTO provider_usage_records')) return queryResult([{ id: 'usage-1' }]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(recordProviderUsageObservation('task-1', 4, {
      provider: 'volcengine-ark',
      providerTaskId: 'provider-task-1',
      status: 'success',
      completionTokens: 605_700,
      totalTokens: 606_000,
      // 即使调用方传入其他值，持久化仍以 completionTokens 为唯一计价基础。
      billableTokens: 606_000,
      billableBasis: 'completion_tokens',
    })).resolves.toBe(true);

    expect(findQueryCall('INSERT INTO provider_usage_records')?.[1]).toEqual([
      'volcengine-ark',
      'Seedance 2.0 Mini',
      'task-1',
      2,
      'provider-task-1',
      'success',
      605_700,
      606_000,
      'tokens',
      null,
      605_700,
      606_000,
      605_700,
      'completion_tokens',
      '720p',
      true,
      'volcengine-seedance-2026-08-10',
      '14.000000',
      '8.479800',
      'CNY',
      'priced',
      'provider-reported',
      'priced',
      'with-video',
      '480p-720p',
      'direct',
      null,
      expect.any(String),
      expect.any(String),
      'usage-observed',
    ]);
    const usageSql = String(findQueryCall('INSERT INTO provider_usage_records')?.[0]);
    expect(usageSql).toContain('ON CONFLICT (provider, task_id, attempt)');
    expect(usageSql).toContain("accounting_date_origin = 'official-bill-inferred'");
    expect(usageSql).toContain('completed_at = provider_usage_records.completed_at');
    expect(usageSql).toContain('billable_tokens = coalesce(provider_usage_records.billable_tokens, EXCLUDED.billable_tokens)');
    expect(usageSql).toContain('estimated_cost = coalesce(provider_usage_records.estimated_cost, EXCLUDED.estimated_cost)');
    expect(usageSql).toContain('local_accounting_date = coalesce(provider_usage_records.local_accounting_date, EXCLUDED.local_accounting_date)');
  });

  it('取消中的外部任务成功时继续走普通成片交付而不提前收口', async () => {
    const task = {
      ...generationTaskRow(),
      status: 'processing',
      credit_status: 'refunded',
      refunded_credits: 10,
      provider_task_id: 'cgt-20260701231431-ssx7t',
      cancel_requested_at: '2026-07-13T06:00:00.000Z',
      cancel_requested_by: 'user-1',
      completed_at: null,
    };
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM generation_tasks') && query.includes('cancel_requested_at IS NOT NULL')) return queryResult([task]);
      if (query.includes('INSERT INTO provider_usage_records')) return queryResult([{ id: 'usage-1' }]);
      if (query.includes('UPDATE generation_tasks')) return queryResult([{
        ...task,
        status: 'canceled',
        processing_stage: 'canceled',
        failure_category: 'user-canceled',
        failure_reason: '用户取消请求已收口；供应商终态和成本用量已保留。',
        completed_at: '2026-07-13T06:10:00.000Z',
      }]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(finalizeRequestedTaskCancellation(
      'task-1',
      0,
      '00000000-0000-4000-8000-000000000301',
      providerSuccess(),
    )).resolves.toBeNull();
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });

  it('历史取消请求最终失败且计费证据不明时仍退回预扣并保留成本记录', async () => {
    const claimToken = '00000000-0000-4000-8000-000000000301';
    const task = {
      ...generationTaskRow(),
      status: 'processing',
      processing_stage: 'cancel-requested',
      credit_status: 'held',
      refunded_credits: 0,
      cancel_requested_at: '2026-07-13T06:00:00.000Z',
      claim_token: claimToken,
    };
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('cancel_requested_at IS NOT NULL')) return queryResult([task]);
      if (query.includes('INSERT INTO provider_usage_records')) return queryResult([]);
      if (query.includes('SELECT main_credits, addon_credits')) return queryResult([{ main_credits: 90, addon_credits: 0 }]);
      if (query.includes('FROM credit_allocations allocation')) {
        return queryResult([{
          id: 'allocation-1',
          lot_id: 'lot-1',
          amount: 10,
          status: 'held',
          bucket: 'main',
          expires_at: null,
        }]);
      }
      if (query.includes('COALESCE(sum(available_amount)')) {
        return queryResult([{ main_credits: 100, addon_credits: 0 }]);
      }
      if (query.includes('UPDATE credit_lots') || query.includes('UPDATE credit_allocations')) return queryResult([{ id: 'updated' }]);
      if (query.includes('UPDATE users')) return queryResult([{ id: 'user-1' }]);
      if (query.includes('UPDATE credit_ledger') || query.includes('INSERT INTO credit_ledger')) return queryResult([]);
      if (query.includes('UPDATE generation_tasks')) return queryResult([{
        ...task,
        status: 'canceled',
        processing_stage: 'canceled',
        cancel_state: 'canceled',
        credit_status: 'refunded',
        settled_credits: 0,
        refunded_credits: 10,
        failure_reason: '历史取消请求已收口；任务未生成可用成片，预扣积分已退回。',
        claim_token: null,
      }]);
      if (query.includes('UPDATE generation_provider_runs')) return queryResult([{ id: 'run-1' }]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(finalizeRequestedTaskCancellation('task-1', 0, claimToken, {
      ok: false,
      provider: 'volcengine-ark',
      providerTaskId: 'cgt-20260701231431-ssx7t',
      category: 'provider-failed',
      reason: 'failed without usage evidence',
      terminal: true,
      providerStatus: 'failed',
      billingDisposition: 'unknown',
    })).resolves.toMatchObject({
      status: 'canceled',
      processingStage: 'canceled',
      cancelState: 'canceled',
      creditStatus: 'refunded',
      refundedCredits: 10,
    });
    expect(findQueryCall('UPDATE users')?.[1]).toEqual(['user-1', 100, 0, 100]);
    expect(findQueryCall('INSERT INTO provider_usage_records')).toBeDefined();
    expect(findQueryCall('UPDATE generation_provider_runs')?.[1]).toEqual([
      task.active_provider_run_id,
      0,
      claimToken,
      'provider-failed',
    ]);
  });

  it('历史取消请求收到供应商 canceled 且未计费终态时退款并标记 run 已退款', async () => {
    const claimToken = '00000000-0000-4000-8000-000000000301';
    const task = {
      ...generationTaskRow(),
      status: 'processing',
      processing_stage: 'cancel-requested',
      credit_status: 'held',
      refunded_credits: 0,
      cancel_requested_at: '2026-07-13T06:00:00.000Z',
      claim_token: claimToken,
    };
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('cancel_requested_at IS NOT NULL')) return queryResult([task]);
      if (query.includes('INSERT INTO provider_usage_records')) return queryResult([]);
      if (query.includes('SELECT main_credits, addon_credits')) return queryResult([{ main_credits: 90, addon_credits: 0 }]);
      if (query.includes('FROM credit_allocations allocation')) {
        return queryResult([{ id: 'allocation-1', lot_id: 'lot-1', amount: 10, status: 'held', bucket: 'main', expires_at: null }]);
      }
      if (query.includes('COALESCE(sum(available_amount)')) {
        return queryResult([{ main_credits: 100, addon_credits: 0 }]);
      }
      if (query.includes('UPDATE credit_lots') || query.includes('UPDATE credit_allocations')) return queryResult([{ id: 'updated' }]);
      if (query.includes('UPDATE users')) return queryResult([{ id: 'user-1' }]);
      if (query.includes('UPDATE credit_ledger') || query.includes('INSERT INTO credit_ledger')) return queryResult([]);
      if (query.includes('UPDATE generation_tasks')) return queryResult([{
        ...task,
        status: 'canceled',
        processing_stage: 'canceled',
        cancel_state: 'canceled',
        credit_status: 'refunded',
        refunded_credits: 10,
        claim_token: null,
      }]);
      if (query.includes('UPDATE generation_provider_runs')) return queryResult([{ id: 'run-1' }]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(finalizeRequestedTaskCancellation('task-1', 0, claimToken, {
      ok: false,
      provider: 'volcengine-ark',
      providerTaskId: 'cgt-20260701231431-ssx7t',
      category: 'user-canceled',
      reason: 'canceled',
      terminal: true,
      providerStatus: 'canceled',
      billingDisposition: 'unbilled',
    })).resolves.toMatchObject({
      status: 'canceled',
      cancelState: 'canceled',
      creditStatus: 'refunded',
    });
    expect(findQueryCall('UPDATE users')?.[1]).toEqual(['user-1', 100, 0, 100]);
    expect(findQueryCall('UPDATE generation_provider_runs')?.[1]).toEqual([
      task.active_provider_run_id,
      0,
      claimToken,
      'refunded',
    ]);
  });

  it('批量幂等键已存在时返回原任务且不再扣积分', async () => {
    let requestHash = '';
    const existingTask = {
      ...generationTaskRow(),
      status: 'queued',
      credit_status: 'held',
      refunded_credits: 0,
      attempt: 0,
      processing_stage: 'queued',
    };
    mocks.clientQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const query = String(sql);
      if (query.includes('INSERT INTO generation_batches')) {
        requestHash = String(params?.[2]);
        return queryResult([]);
      }
      if (query.includes('FROM generation_batches') && query.includes('FOR UPDATE')) {
        return queryResult([{ request_hash: requestHash, task_ids: ['task-1'] }]);
      }
      if (query.includes('SELECT * FROM generation_tasks') && query.includes('array_position')) {
        return queryResult([existingTask]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'batch-request-0001',
      requests: [{
        kind: 'video', model: 'Seedance 2.0', prompt: '批量视频',
        config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
      }],
    })).resolves.toEqual([expect.objectContaining({ id: 'task-1', status: 'queued', attempt: 0 })]);
    expect(findQueryCall('UPDATE users')).toBeUndefined();
    expect(findQueryCall('INSERT INTO credit_ledger')).toBeUndefined();
  });

  it('批量预扣按数据库真实素材类型选择参考视频积分档', async () => {
    let taskIndex = 0;
    const promptWizardSource = {
      runId: '00000000-0000-4000-8000-000000000701',
      batchId: '00000000-0000-4000-8000-000000000702',
      planId: '00000000-0000-4000-8000-000000000703',
      engineVersion: 3 as const,
      editBucket: 'minor' as const,
    };
    mocks.clientQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const query = String(sql);
      if (query.includes('INSERT INTO generation_batches')) return queryResult([{ id: 'batch-1' }]);
      if (query.includes('FROM users') && query.includes('FOR UPDATE')) {
        return queryResult([{ id: 'user-1', status: 'active', main_credits: 100, addon_credits: 0 }]);
      }
      if (query.includes('FROM prompt_wizard_batches')) {
        return queryResult([{
          id: promptWizardSource.batchId,
          run_id: promptWizardSource.runId,
          user_id: 'user-1',
          status: 'completed',
          plans: [{ id: promptWizardSource.planId, deliveryVersion: 4, prompt: '向导原始提示词' }],
          image_asset_ids: ['00000000-0000-4000-8000-000000000402'],
          video_config: {
            model: 'seedance-2.0',
            aspectRatio: '9:16',
            resolution: '720p',
            durationSeconds: 5,
          },
          content_purged_at: null,
          run_status: 'ready',
          run_expires_at: '2099-01-01T00:00:00.000Z',
        }]);
      }
      if (query.includes('FROM assets')) {
        const assetIds = params?.[1] as string[];
        if (assetIds.includes('00000000-0000-4000-8000-000000000401')) {
          return queryResult([{
            id: '00000000-0000-4000-8000-000000000401',
            user_id: 'user-1',
            name: '数据库视频素材',
            object_key: 'declared-image.mp4',
            thumbnail_key: null,
            type: 'video',
            duration_seconds: 5,
            size_bytes: 1024,
          }]);
      }
        return queryResult([{
          id: '00000000-0000-4000-8000-000000000402',
          user_id: 'user-1',
          name: '数据库图片素材',
          object_key: 'declared-video.png',
          thumbnail_key: null,
          type: 'image',
          duration_seconds: null,
          size_bytes: 1024,
        }]);
      }
      if (query.includes('FROM consumption_settings')) {
        return queryResult([{ credits: 20, reference_video_credits: 35 }]);
      }
      if (query.includes('COALESCE(sum(available_amount)')) {
        return queryResult([{ main_credits: 45, addon_credits: 0 }]);
      }
      if (query.includes('UPDATE users')) return queryResult([{ id: 'user-1' }]);
      if (query.includes('INSERT INTO generation_tasks')) {
        taskIndex += 1;
        const credits = Number(params?.[5]);
        return queryResult([{
          ...generationTaskRow(),
          id: `task-${taskIndex}`,
          model: params?.[2],
          status: 'queued',
          failure_category: null,
          failure_reason: null,
          prompt: params?.[3],
          config: params?.[4],
          credits,
          reserved_credits: credits,
          settled_credits: 0,
          refunded_credits: 0,
          credit_status: 'held',
          main_credits_used: credits,
          processing_stage: 'queued',
          completed_at: null,
        }]);
      }
      if (query.includes('SELECT amount') && query.includes('FROM credit_allocations')) return queryResult([]);
      if (query.includes('FROM credit_lots')) {
        return queryResult([{ id: 'lot-main-1', bucket: 'main', available_amount: 1000, held_amount: 0, expires_at: null }]);
      }
      if (
        query.includes('INSERT INTO credit_ledger')
        || query.includes('UPDATE generation_batches')
        || query.includes('INSERT INTO prompt_wizard_daily_metrics')
      ) {
        return queryResult([]);
      }
      if (query.includes('UPDATE credit_lots')) return queryResult([{ id: 'lot-main-1' }]);
      if (query.includes('INSERT INTO credit_allocations')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    const tasks = await createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'batch-real-reference-types',
      requests: [
        {
          kind: 'video',
          model: 'Seedance 2.0',
          prompt: '向导原始提示词',
          config: {
            resolution: '720p',
            durationSeconds: 5,
          },
          references: [{
            assetId: '00000000-0000-4000-8000-000000000401',
            role: 'reference_video',
          }],
          promptWizardSource,
        },
        {
          kind: 'video',
          model: 'Seedance 2.0',
          prompt: '实际为图片',
          config: {
            resolution: '720p',
            durationSeconds: 5,
          },
          references: [{
            assetId: '00000000-0000-4000-8000-000000000402',
            role: 'reference_image',
          }],
        },
      ],
    });

    expect(tasks.map(task => task.credits)).toEqual([35, 20]);
    expect(tasks[0]?.config.referenceAssets).toEqual([
      expect.objectContaining({ type: 'video', role: 'reference_video' }),
    ]);
    expect(tasks[1]?.config.referenceAssets).toEqual([
      expect.objectContaining({ type: 'image', role: 'reference_image' }),
    ]);
    const taskInsert = mocks.clientQuery.mock.calls.find(([, params]) => params?.[3] === '向导原始提示词');
    expect(String(taskInsert?.[0])).toContain('prompt_wizard_source');
    // 提示词和四项配置均未改，但产品图被移除，只保留工作区原视频；
    // 编辑幅度必须由服务端升级为 material，不能接受浏览器声明的 minor。
    expect(taskInsert?.[1]?.[8]).toEqual({ ...promptWizardSource, editBucket: 'material' });
    expect(findQueryCall('INSERT INTO prompt_wizard_daily_metrics')?.[1]).toEqual([
      3, 0, 1, 0, 0, 0, 0, 0, 0,
    ]);
    expect(findQueryCall('UPDATE users')?.[1]).toEqual(['user-1', 45, 0, 45]);
  });

  it('TK 来源在积分预扣前绑定完成方案、视频配置和商品图片顺序', async () => {
    const imageId = '00000000-0000-4000-8000-000000000841';
    const videoId = '00000000-0000-4000-8000-000000000845';
    const source = {
      runId: '00000000-0000-4000-8000-000000000842',
      generationId: '00000000-0000-4000-8000-000000000843',
      optionId: '00000000-0000-4000-8000-000000000844',
      schemaVersion: 1 as const,
      editBucket: 'material' as const,
    };
    const executionPrompt = [
      '【目标市场】United States',
      '【参考图固定映射】@图片1=上传顺序第1张',
      '0–1秒：展示@图片1中的商品并配合真实环境声。',
      '1–3秒：继续@图片1中的同一商品动作。',
      '3–5秒：完成@图片1中的同一商品动作。',
      TK_PROMPT_NON_LIVE_PERSON_BOUNDARY,
      TK_PROMPT_VISUAL_TEXT_BOUNDARY,
    ].join('\n');
    const strategy = {
      slot: 'safe',
      labelZh: '最稳',
      objective: 'conversion',
      styleForm: 'product',
      style: 'pain_point',
      hookPatternId: 'sound_hook',
      firstFrameId: 'sound_sync',
      firstFrame: '商品动作与声音同步出现',
      openingAction: '立即执行一个可见商品动作',
      openingLine: '',
      relevanceBeat: '声音和动作证明商品相关性',
      productBridge: '镜头持续围绕同一商品',
      buyingMotivationId: 'problem_relief',
      buyingMotivation: '解决可见问题',
      proofMethodId: 'visible_operation',
      proofMethod: '使用图片可见结构完成操作',
      ctaStrategy: '查看商品详情',
      requiredMaterials: [],
      allowedFactIds: ['visible-001'],
      videoMode: 'product_closeup',
    } as const;
    const plan = {
      schemaVersion: 1,
      title: '五秒商品声音演示',
      whyItFits: '只使用图片可见事实',
      audioMode: 'sound-design-only',
      executionPrompt,
      beats: [{
        startSeconds: 0,
        endSeconds: 5,
        environment: '真实桌面',
        subject: '参考图中的商品',
        action: '完成一个可见操作',
        shotSize: '近景',
        cameraMovement: '稳定轻推',
        lighting: '自然光',
        editingCue: '动作完成时收束',
        soundDesign: '真实操作声',
        voiceoverTarget: '',
        voiceoverZh: '',
        factIds: ['visible-001'],
      }],
      factsUsed: ['visible-001'],
      assumptions: [],
      requiredMaterials: [],
      warnings: [],
    } as const;
    const confirmedFactPack = {
      schemaVersion: 1,
      factPack: {
        productName: '参考商品',
        category: '家居用品',
        confidence: 'high',
        facts: [{
          factId: 'visible-001',
          status: 'visible',
          text: '商品表面有可见结构',
          sourceImageIds: [imageId],
        }],
        internalHypotheses: [],
        demonstrableActions: [{
          actionId: 'action-001',
          text: '手部指向可见结构',
          supportingFactIds: ['visible-001'],
          sourceImageAssetIds: [imageId],
        }],
        forbiddenClaims: ['不要提医疗功效', 'avoid curing anxiety'],
        availableMaterials: ['product-images'],
        targetMarket: 'United States',
        spokenLanguage: null,
        verifiedOffer: null,
      },
      evidenceReview: {
        productName: '参考商品',
        category: '家居用品',
        rejectedVisibleFactIds: [],
        userConfirmedFacts: [],
        forbiddenClaims: ['不要提医疗功效', 'avoid curing anxiety'],
      },
      evidenceFlags: {
        beforeAfter: false,
        competitor: false,
        numeric: false,
        realComment: false,
        popularity: false,
        honestExperience: false,
        sealedPackage: false,
      },
    } as const;
    mocks.clientQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const query = String(sql);
      if (query.includes('INSERT INTO generation_batches')) return queryResult([{ id: 'batch-tk' }]);
      if (query.includes('FROM users') && query.includes('FOR UPDATE')) {
        return queryResult([{ id: 'user-1', status: 'active', main_credits: 100, addon_credits: 0 }]);
      }
      if (query.includes('FROM tk_prompt_runs run') && query.includes('JOIN tk_prompt_options option')) {
        return queryResult([{
          run_status: 'ready',
          run_image_asset_ids: [imageId],
          run_content_purged_at: null,
          run_expires_at: '2099-01-01T00:00:00.000Z',
          generation_status: 'completed',
          generation_video_config: {
            model: 'seedance-2.0', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5,
          },
          generation_confirmed_fact_pack: confirmedFactPack,
          generation_content_purged_at: null,
          generation_expires_at: '2099-01-01T00:00:00.000Z',
          option_status: 'completed',
          option_strategy_blueprint: strategy,
          option_plan: plan,
          option_content_purged_at: null,
        }]);
      }
      if (query.includes('FROM assets')) {
        const rows = [{
          id: imageId,
          user_id: 'user-1',
          name: '商品图',
          object_key: 'product.png',
          thumbnail_key: null,
          type: 'image',
          duration_seconds: null,
          size_bytes: 1024,
        }];
        return queryResult(
          params?.some(value => Array.isArray(value) && value.includes(videoId))
            ? [...rows, {
              id: videoId,
              user_id: 'user-1',
              name: '旧参考视频',
              object_key: 'legacy-video.mp4',
              thumbnail_key: null,
              type: 'video',
              duration_seconds: 5,
              size_bytes: 2048,
            }]
            : rows,
        );
      }
      if (query.includes('FROM consumption_settings')) {
        return queryResult([{ credits: 20, reference_video_credits: 35 }]);
      }
      if (query.includes('COALESCE(sum(available_amount)')) {
        return queryResult([{ main_credits: 20, addon_credits: 0 }]);
      }
      if (query.includes('FROM credit_lots')) {
        return queryResult([{ id: 'lot-main-tk', bucket: 'main', available_amount: 100, held_amount: 0, expires_at: null }]);
      }
      if (query.includes('SELECT amount') && query.includes('FROM credit_allocations')) {
        return queryResult([]);
      }
      if (query.includes('INSERT INTO generation_tasks')) {
        return queryResult([{
          ...generationTaskRow(),
          id: 'task-tk',
          model: params?.[2],
          prompt: params?.[3],
          config: params?.[4],
          credits: 20,
          reserved_credits: 20,
          credit_status: 'held',
          main_credits_used: 20,
          processing_stage: 'queued',
        }]);
      }
      if (
        query.includes('UPDATE users')
        || query.includes('UPDATE credit_lots')
        || query.includes('INSERT INTO credit_allocations')
        || query.includes('INSERT INTO credit_ledger')
        || query.includes('UPDATE generation_batches')
      ) return queryResult([{ id: 'ok' }]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'valid-tk-source',
      requests: [{
        kind: 'video',
        model: 'Seedance 2.0',
        prompt: executionPrompt,
        config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        references: [{ assetId: imageId, role: 'reference_image' }],
        tkPromptSource: source,
      }],
    })).resolves.toEqual([expect.objectContaining({ id: 'task-tk' })]);

    const taskInsert = findQueryCall('INSERT INTO generation_tasks');
    expect(String(taskInsert?.[0])).toContain('tk_prompt_source');
    expect(taskInsert?.[1]?.[9]).toEqual({ ...source, editBucket: 'none' });
    expect(String(findQueryCall('FROM tk_prompt_runs run')?.[0]))
      .toContain('FOR SHARE OF run, generation, option');
    expect(String(findQueryCall('FROM tk_prompt_runs run')?.[0]))
      .toContain('generation.confirmed_fact_pack AS generation_confirmed_fact_pack');

    const taskInsertCount = mocks.clientQuery.mock.calls
      .filter(([sql]) => String(sql).includes('INSERT INTO generation_tasks')).length;
    const creditLotReadCount = mocks.clientQuery.mock.calls
      .filter(([sql]) => String(sql).includes('FROM credit_lots')).length;
    await expect(createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'tk-source-invalid-final-prompt',
      requests: [{
        kind: 'video',
        model: 'Seedance 2.0',
        prompt: `${executionPrompt}\nshow a price sticker`,
        config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        references: [{ assetId: imageId, role: 'reference_image' }],
        tkPromptSource: source,
      }],
    })).rejects.toMatchObject({ code: 'TK_PROMPT_TEXT_OVERLAY_FORBIDDEN' });
    expect(mocks.clientQuery.mock.calls
      .filter(([sql]) => String(sql).includes('INSERT INTO generation_tasks'))).toHaveLength(taskInsertCount);
    expect(mocks.clientQuery.mock.calls
      .filter(([sql]) => String(sql).includes('FROM credit_lots'))).toHaveLength(creditLotReadCount);

    for (const [idempotencyKey, suffix, code] of [
      ['tk-source-image-id-leak', `商品素材 ${imageId}`, 'TK_PROMPT_INTERNAL_IDENTIFIER_LEAKED'],
      ['tk-source-action-id-leak', '动作：执行 action-001', 'TK_PROMPT_INTERNAL_IDENTIFIER_LEAKED'],
      ['tk-source-forbidden-zh', '动作：突出医疗功效', 'TK_PROMPT_FORBIDDEN_CLAIM_LEAKED'],
      ['tk-source-forbidden-en', 'Product claim: curing anxiety', 'TK_PROMPT_FORBIDDEN_CLAIM_LEAKED'],
      ['tk-source-unverified-price', '商品价格透明', 'TK_PROMPT_UNVERIFIED_PROMOTION_FORBIDDEN'],
      ['tk-source-persona-leak', '拥有10年经验和十亿 GMV 的顶级专家推荐', 'TK_PROMPT_EXPERT_HISTORY_LEAKED'],
      ['tk-source-hook-example-leak', '微距中的水流突然落入商品结构，镜头随水流移动到关键部位。', 'TK_PROMPT_INTERNAL_HOOK_EXAMPLE_LEAKED'],
      ['tk-source-ai-disclosure', '#AIGC', 'TK_PROMPT_AI_DISCLOSURE_FORBIDDEN'],
      ['tk-source-extra-image-token', '额外展示 @图片1', 'TK_PROMPT_IMAGE_REFERENCE_INVALID'],
      ['tk-source-person', 'a customer appears and holds the product', 'TK_PROMPT_PERSON_FORBIDDEN'],
      ['tk-source-screen-text', '屏幕显示一句文字', 'TK_PROMPT_TEXT_OVERLAY_FORBIDDEN'],
      ['tk-source-human-voice', '加入解说配音', 'TK_PROMPT_SOUND_ONLY_HUMAN_VOICE_INVALID'],
    ] as const) {
      await expect(createGenerationTasksBatch({
        userId: 'user-1',
        idempotencyKey,
        requests: [{
          kind: 'video',
          model: 'Seedance 2.0',
          prompt: `${executionPrompt}\n${suffix}`,
          config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
          references: [{ assetId: imageId, role: 'reference_image' }],
          tkPromptSource: source,
        }],
      })).rejects.toMatchObject({ code });
    }
    expect(mocks.clientQuery.mock.calls
      .filter(([sql]) => String(sql).includes('INSERT INTO generation_tasks'))).toHaveLength(taskInsertCount);
    expect(mocks.clientQuery.mock.calls
      .filter(([sql]) => String(sql).includes('FROM credit_lots'))).toHaveLength(creditLotReadCount);

    await expect(createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'tk-source-safe-edit',
      requests: [{
        kind: 'video',
        model: 'Seedance 2.0',
        prompt: `${executionPrompt}\n光线：保持自然室内光。`,
        config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        references: [{ assetId: imageId, role: 'reference_image' }],
        tkPromptSource: source,
      }],
    })).resolves.toEqual([expect.objectContaining({ id: 'task-tk' })]);
    const taskInsertCountAfterSafeEdit = mocks.clientQuery.mock.calls
      .filter(([sql]) => String(sql).includes('INSERT INTO generation_tasks')).length;
    const creditLotReadCountAfterSafeEdit = mocks.clientQuery.mock.calls
      .filter(([sql]) => String(sql).includes('FROM credit_lots')).length;

    await expect(createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'tk-source-extra-video',
      requests: [{
        kind: 'video',
        model: 'Seedance 2.0',
        prompt: executionPrompt,
        config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        references: [
          { assetId: imageId, role: 'reference_image' },
          { assetId: videoId, role: 'reference_video' },
        ],
        tkPromptSource: source,
      }],
    })).rejects.toMatchObject({ statusCode: 400, code: 'TK_PROMPT_SOURCE_INVALID' });
    expect(mocks.clientQuery.mock.calls
      .filter(([sql]) => String(sql).includes('INSERT INTO generation_tasks')))
      .toHaveLength(taskInsertCountAfterSafeEdit);
    expect(mocks.clientQuery.mock.calls
      .filter(([sql]) => String(sql).includes('FROM credit_lots')))
      .toHaveLength(creditLotReadCountAfterSafeEdit);
  });

  it('无效或跨用户的 TK 来源会在积分预扣前拒绝', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('INSERT INTO generation_batches')) return queryResult([{ id: 'batch-tk-invalid' }]);
      if (query.includes('FROM users') && query.includes('FOR UPDATE')) {
        return queryResult([{ id: 'user-1', status: 'active', main_credits: 100, addon_credits: 0 }]);
      }
      if (query.includes('FROM tk_prompt_runs run') && query.includes('JOIN tk_prompt_options option')) {
        return queryResult([]);
      }
      throw new Error(`未预期的查询：${query}`);
    });
    await expect(createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'invalid-tk-source',
      requests: [{
        kind: 'video',
        model: 'Seedance 2.0',
        prompt: '失效方案',
        config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        tkPromptSource: {
          runId: '00000000-0000-4000-8000-000000000851',
          generationId: '00000000-0000-4000-8000-000000000852',
          optionId: '00000000-0000-4000-8000-000000000853',
          schemaVersion: 1,
          editBucket: 'none',
        },
      }],
    })).rejects.toMatchObject({ statusCode: 400, code: 'TK_PROMPT_SOURCE_INVALID' });
    expect(findQueryCall('FROM credit_lots')).toBeUndefined();
    expect(findQueryCall('INSERT INTO generation_tasks')).toBeUndefined();
  });

  it('无效或已清理的提示词来源会在积分预扣前拒绝', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('INSERT INTO generation_batches')) return queryResult([{ id: 'batch-1' }]);
      if (query.includes('FROM users') && query.includes('FOR UPDATE')) {
        return queryResult([{ id: 'user-1', status: 'active', main_credits: 100, addon_credits: 0 }]);
      }
      if (query.includes('FROM prompt_wizard_batches')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'batch-invalid-prompt-wizard-source',
      requests: [{
        kind: 'video',
        model: 'Seedance 2.0',
        prompt: '来源已失效的视频提示词',
        config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        promptWizardSource: {
          runId: '00000000-0000-4000-8000-000000000711',
          batchId: '00000000-0000-4000-8000-000000000712',
          planId: '00000000-0000-4000-8000-000000000713',
          engineVersion: 3,
          editBucket: 'none',
        },
      }],
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'PROMPT_WIZARD_SOURCE_INVALID',
      message: '提示词方案来源已失效，请重新应用方案。',
    });

    expect(findQueryCall('FROM credit_lots')).toBeUndefined();
    expect(findQueryCall('INSERT INTO generation_tasks')).toBeUndefined();
    expect(findQueryCall('INSERT INTO credit_ledger')).toBeUndefined();
  });

  it('超过 24 小时但尚未执行清理的提示词来源会在积分预扣前拒绝', async () => {
    const source = {
      runId: '00000000-0000-4000-8000-000000000721',
      batchId: '00000000-0000-4000-8000-000000000722',
      planId: '00000000-0000-4000-8000-000000000723',
      engineVersion: 3 as const,
      editBucket: 'none' as const,
    };
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('INSERT INTO generation_batches')) return queryResult([{ id: 'batch-1' }]);
      if (query.includes('FROM users') && query.includes('FOR UPDATE')) {
        return queryResult([{ id: 'user-1', status: 'active', main_credits: 100, addon_credits: 0 }]);
      }
      if (query.includes('FROM prompt_wizard_batches')) {
        return queryResult([{
          id: source.batchId,
          run_id: source.runId,
          user_id: 'user-1',
          status: 'completed',
          plans: [{ id: source.planId, deliveryVersion: 4, prompt: '已过期提示词' }],
          image_asset_ids: [],
          video_config: {
            model: 'seedance-2.0',
            aspectRatio: '9:16',
            resolution: '720p',
            durationSeconds: 5,
          },
          content_purged_at: null,
          run_status: 'ready',
          run_expires_at: '2000-01-01T00:00:00.000Z',
        }]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'batch-expired-prompt-wizard-source',
      requests: [{
        kind: 'video',
        model: 'Seedance 2.0',
        prompt: '已过期提示词',
        config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        promptWizardSource: source,
      }],
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'PROMPT_WIZARD_SOURCE_INVALID',
    });

    expect(findQueryCall('FROM credit_lots')).toBeUndefined();
    expect(findQueryCall('INSERT INTO generation_tasks')).toBeUndefined();
    expect(findQueryCall('INSERT INTO credit_ledger')).toBeUndefined();
  });

  it('MCP 在同一预扣事务内按当前总价检查 maxCredits，超额不触碰积分账本', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('INSERT INTO generation_batches')) return queryResult([{ id: 'batch-1' }]);
      if (query.includes('FROM users') && query.includes('FOR UPDATE')) return queryResult([{ id: 'user-1', status: 'active', main_credits: 100, addon_credits: 0 }]);
      if (query.includes('FROM consumption_settings')) return queryResult([{ credits: 12, reference_video_credits: 12 }]);
      throw new Error(`超过上限后不应继续查询：${query}`);
    });
    await expect(createGenerationTasksBatch({
      userId: 'user-1', idempotencyKey: 'mcp-price-raised', maxCredits: 20,
      requests: [1, 2].map(index => ({ kind: 'video' as const, model: 'Seedance 2.0', prompt: `视频${index}`, config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 } })),
    })).rejects.toMatchObject({ code: 'GENERATION_CREDIT_LIMIT_EXCEEDED', statusCode: 409 });
    expect(findQueryCall('FROM credit_lots')).toBeUndefined();
    expect(findQueryCall('UPDATE users')).toBeUndefined();
    expect(findQueryCall('INSERT INTO generation_tasks')).toBeUndefined();
  });

  it('批量总积分不足时在任何用户更新或任务插入前整批失败', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('INSERT INTO generation_batches')) return queryResult([{ id: 'batch-1' }]);
      if (query.includes('FROM users') && query.includes('FOR UPDATE')) {
        return queryResult([{ id: 'user-1', status: 'active', main_credits: 5, addon_credits: 0 }]);
      }
      if (query.includes('FROM consumption_settings')) return queryResult([{ credits: 10, reference_video_credits: 10 }]);
      if (query.includes('FROM credit_lots')) {
        return queryResult([{ id: 'lot-main-1', bucket: 'main', available_amount: 5, held_amount: 0, expires_at: null }]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(createGenerationTasksBatch({
      userId: 'user-1',
      idempotencyKey: 'batch-request-0002',
      requests: [
        { kind: 'video', model: 'Seedance 2.0', prompt: '视频一', config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 } },
        { kind: 'video', model: 'Seedance 2.0', prompt: '视频二', config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 } },
      ],
    })).rejects.toThrow('积分不足');
    expect(findQueryCall('UPDATE users')).toBeUndefined();
    expect(findQueryCall('INSERT INTO generation_tasks')).toBeUndefined();
    expect(findQueryCall('INSERT INTO credit_ledger')).toBeUndefined();
  });

  it('结算时真人授权已撤回会保留供应商用量、释放预扣并隐私阻断交付', async () => {
    const claimToken = '00000000-0000-4000-8000-000000000301';
    const providerResult = providerSuccess();
    const task = {
      ...generationTaskRow(),
      status: 'processing' as const,
      failure_category: null,
      failure_reason: null,
      processing_stage: 'provider-succeeded',
      provider_result: providerResult,
      claim_token: claimToken,
      credit_status: 'held' as const,
      refunded_credits: 0,
      completed_at: null,
      cancel_reason_code: null,
      run_output_object_key: providerResult.objectKey,
      run_thumbnail_object_key: providerResult.thumbnailKey,
      run_staging_object_key: 'staging-object.mp4',
      prompt_wizard_engine_version: 3,
    };
    const failureReason = 'privacy-withheld: 真人授权已撤回，生成结果未保存或交付。';

    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT task.*') && query.includes('run.output_object_key')) {
        return queryResult([task]);
      }
      if (query.includes('SELECT auth.status AS authorization_status')) {
        return queryResult([{
          authorization_status: 'revoked',
          authorization_valid_now: true,
          actor_lifecycle_status: 'revoked',
          actor_deleted_at: null,
        }]);
      }
      if (query.includes('INSERT INTO provider_usage_records')) return queryResult([{ id: 'usage-withheld' }]);
      if (query.includes('SELECT main_credits, addon_credits FROM users')) {
        return queryResult([{ main_credits: 90, addon_credits: 0 }]);
      }
      if (query.includes('FROM credit_allocations allocation')) {
        return queryResult([{
          id: 'allocation-held',
          lot_id: 'lot-main-1',
          amount: 10,
          status: 'held',
          bucket: 'main',
          expires_at: null,
        }]);
      }
      if (query.includes('UPDATE credit_lots') || query.includes('UPDATE credit_allocations')) {
        return queryResult([{ id: 'updated' }]);
      }
      if (query.includes('COALESCE(sum(available_amount)')) {
        return queryResult([{ main_credits: 100, addon_credits: 0 }]);
      }
      if (query.includes('UPDATE users')) return queryResult([{ id: 'user-1' }]);
      if (query.includes('UPDATE credit_ledger') || query.includes('INSERT INTO credit_ledger')) {
        return queryResult([]);
      }
      if (query.includes('pg_advisory_xact_lock')) return queryResult([]);
      if (query.includes('SELECT 1') && query.includes('FROM assets')) return queryResult([]);
      if (query.includes('INSERT INTO object_deletion_outbox')) return queryResult([]);
      if (query.includes('UPDATE generation_tasks')) {
        return queryResult([{
          ...task,
          status: 'failed',
          processing_stage: 'privacy-withheld',
          provider_task_id: providerResult.providerTaskId,
          provider_result: null,
          failure_category: 'content-policy',
          failure_reason: failureReason,
          cancel_reason_code: 'privacy-withheld',
          claim_token: null,
          credit_status: 'refunded',
          settled_credits: 0,
          refunded_credits: 10,
          asset_id: null,
          completed_at: '2026-07-30T04:00:00.000Z',
        }]);
      }
      if (query.includes('INSERT INTO prompt_wizard_daily_metrics')) return queryResult([]);
      if (query.includes('UPDATE generation_provider_runs')) return queryResult([{ id: 'run-1' }]);
      throw new Error(`未预期的真人隐私阻断结算查询：${query}`);
    });

    await expect(settleTaskSuccess('task-1', 0, claimToken)).resolves.toMatchObject({
      id: 'task-1',
      status: 'failed',
      processingStage: 'privacy-withheld',
      failureCategory: 'content-policy',
      failureReason,
      creditStatus: 'refunded',
      settledCredits: 0,
      refundedCredits: 10,
      assetId: null,
    });

    expect(findQueryCall('INSERT INTO assets')).toBeUndefined();
    expect(findQueryCall('INSERT INTO provider_usage_records')?.[1]?.[5]).toBe('success');
    expect(findQueryCall('FROM credit_allocations allocation')).toBeDefined();
    expect(findQueryCall('UPDATE users')?.[1]).toEqual(['user-1', 100, 0, 100]);
    const taskUpdate = findQueryCall('UPDATE generation_tasks');
    expect(String(taskUpdate?.[0])).toContain("processing_stage = 'privacy-withheld'");
    expect(taskUpdate?.[1]).toEqual([
      'task-1',
      providerResult.providerTaskId,
      failureReason,
      10,
      0,
      claimToken,
    ]);
    const providerRunUpdate = findQueryCall('UPDATE generation_provider_runs');
    expect(String(providerRunUpdate?.[0])).toContain("SET status = 'refunded'");
    expect(String(providerRunUpdate?.[0])).toContain("AND status = 'settlement-pending'");
    expect(String(providerRunUpdate?.[0])).toContain('recovery_token = NULL');
    expect(findQueryCall('INSERT INTO prompt_wizard_daily_metrics')?.[1]).toEqual([
      3, 0, 0, 0, 0, 0, 0, 1, 1,
    ]);

    mocks.clientQuery.mockReset();
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      expect(query).toContain("task.processing_stage <> 'privacy-withheld'");
      expect(query).toContain("task.cancel_reason_code IS DISTINCT FROM 'privacy-withheld'");
      expect(query).toContain('AND NOT EXISTS');
      expect(query).toContain('FROM generation_real_portrait_references ref');
      expect(query).toContain("auth.status <> 'active'");
      expect(query).not.toContain('plan_access_status');
      return queryResult([]);
    });
    await expect(beginGenerationTaskRecovery('task-1')).rejects.toMatchObject({
      code: 'GENERATION_RECOVERY_CONFLICT',
      statusCode: 409,
    });
  });

  it('恢复已退款结果时真人授权已撤回会拒绝交付且不创建资产或补扣', async () => {
    const providerResult = providerSuccess();
    const recoveryToken = '00000000-0000-4000-8000-000000000401';
    const task = {
      ...generationTaskRow(),
      run_output_object_key: providerResult.objectKey,
      run_thumbnail_object_key: providerResult.thumbnailKey,
      run_staging_object_key: 'staging-object.mp4',
      cancel_reason_code: null,
    };

    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT task.*') && query.includes("run.status = 'delivery-failed'")) {
        return queryResult([task]);
      }
      if (query.includes('SELECT auth.status AS authorization_status')) {
        return queryResult([{
          authorization_status: 'revoked',
          authorization_valid_now: true,
          actor_lifecycle_status: 'revoked',
          actor_deleted_at: null,
        }]);
      }
      if (query.includes('INSERT INTO provider_usage_records')) return queryResult([{ id: 'usage-recovery-withheld' }]);
      if (query.includes('pg_advisory_xact_lock')) return queryResult([]);
      if (query.includes('SELECT 1') && query.includes('FROM assets')) return queryResult([]);
      if (query.includes('INSERT INTO object_deletion_outbox')) return queryResult([]);
      if (query.includes('UPDATE generation_tasks')) return queryResult([]);
      if (query.includes('UPDATE generation_provider_runs')) return queryResult([{ id: 'run-1' }]);
      throw new Error(`未预期的真人恢复隐私阻断查询：${query}`);
    });

    await expect(recoverRefundedTaskSuccess(
      'task-1',
      providerResult,
      recoveryToken,
      ['staging-object.mp4'],
    )).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_DELIVERY_WITHHELD',
      statusCode: 409,
      message: expect.stringContaining('真人授权已撤回'),
    });

    expect(findQueryCall('INSERT INTO provider_usage_records')?.[1]?.[5]).toBe('success');
    expect(findQueryCall('INSERT INTO assets')).toBeUndefined();
    expect(findQueryCall('SELECT main_credits, addon_credits')).toBeUndefined();
    expect(findQueryCall('FROM credit_lots')).toBeUndefined();
    expect(findQueryCall('INSERT INTO credit_allocations')).toBeUndefined();
    expect(findQueryCall('INSERT INTO credit_ledger')).toBeUndefined();
    const providerRunUpdate = findQueryCall('UPDATE generation_provider_runs');
    expect(String(providerRunUpdate?.[0])).toContain("SET status = 'refunded'");
    expect(String(providerRunUpdate?.[0])).toContain("AND status = 'delivery-failed'");
  });

  it('已提交任务在套餐被锁定但真人授权仍有效时允许正常结算', async () => {
    const claimToken = '00000000-0000-4000-8000-000000000301';
    const providerResult = providerSuccess();
    const task = {
      ...generationTaskRow(),
      status: 'processing' as const,
      failure_category: null,
      failure_reason: null,
      processing_stage: 'provider-succeeded',
      provider_result: providerResult,
      claim_token: claimToken,
      credit_status: 'held' as const,
      refunded_credits: 0,
      completed_at: null,
      run_output_object_key: providerResult.objectKey,
      run_thumbnail_object_key: providerResult.thumbnailKey,
      run_staging_object_key: 'staging-object.mp4',
      prompt_wizard_engine_version: 3,
    };

    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('SELECT task.*') && query.includes('run.output_object_key')) {
        return queryResult([task]);
      }
      if (query.includes('SELECT auth.status AS authorization_status')) {
        return queryResult([{
          authorization_status: 'active',
          authorization_valid_now: true,
          actor_lifecycle_status: 'active',
          actor_deleted_at: null,
          plan_access_status: 'plan_locked',
        }]);
      }
      if (query.includes('FROM asset_folders')) return queryResult([{ id: 'folder-ai-video' }]);
      if (query.includes('INSERT INTO assets')) return queryResult([{ id: 'asset-completed' }]);
      if (query.includes('SELECT id, lot_id, amount, status') && query.includes('FROM credit_allocations')) {
        return queryResult([{
          id: 'allocation-held',
          lot_id: 'lot-main-1',
          amount: 10,
          status: 'held',
        }]);
      }
      if (query.includes('UPDATE credit_lots') || query.includes('UPDATE credit_allocations')) {
        return queryResult([{ id: 'updated' }]);
      }
      if (query.includes('UPDATE credit_ledger')) return queryResult([]);
      if (query.includes('INSERT INTO provider_usage_records')) return queryResult([{ id: 'usage-completed' }]);
      if (query.includes('UPDATE generation_tasks')) {
        return queryResult([{
          ...task,
          status: 'completed',
          processing_stage: 'completed',
          provider_task_id: providerResult.providerTaskId,
          provider_result: null,
          claim_token: null,
          credit_status: 'settled',
          settled_credits: 10,
          refunded_credits: 0,
          asset_id: 'asset-completed',
          completed_at: '2026-07-30T04:00:00.000Z',
        }]);
      }
      if (
        query.includes('UPDATE generation_real_portrait_references')
        || query.includes('UPDATE real_portrait_materializations')
        || query.includes('UPDATE real_portrait_actors')
      ) return queryResult([]);
      if (query.includes('INSERT INTO prompt_wizard_daily_metrics')) return queryResult([]);
      if (query.includes('UPDATE generation_provider_runs')) return queryResult([{ id: 'run-1' }]);
      throw new Error(`未预期的套餐锁定后结算查询：${query}`);
    });

    await expect(settleTaskSuccess('task-1', 0, claimToken)).resolves.toMatchObject({
      id: 'task-1',
      status: 'completed',
      processingStage: 'completed',
      creditStatus: 'settled',
      settledCredits: 10,
      assetId: 'asset-completed',
    });

    const deliveryGuardQuery = findQueryCall('SELECT auth.status AS authorization_status');
    expect(deliveryGuardQuery).toBeDefined();
    expect(String(deliveryGuardQuery?.[0])).not.toContain('plan_access_status');
    expect(String(deliveryGuardQuery?.[0])).not.toContain('reconcileRealPortraitQuota');
    expect(findQueryCall('INSERT INTO assets')).toBeDefined();
    expect(findQueryCall("SET status = 'refunded'")).toBeUndefined();
    expect(findQueryCall('INSERT INTO prompt_wizard_daily_metrics')?.[1]).toEqual([
      3, 0, 0, 0, 0, 0, 1, 0, 0,
    ]);
  });

  it('恢复已退款的 Seedance 成功任务时创建资产、补扣积分并修正供应商用量', async () => {
    const task = generationTaskRow();
    const providerResult = providerSuccess();

    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM generation_tasks task') && query.includes('generation_provider_runs')) {
        return queryResult([task]);
      }
      if (query.includes('FROM generation_real_portrait_references ref')) return queryResult([]);
      if (query.includes('SELECT main_credits, addon_credits')) {
        return queryResult([{ main_credits: 100, addon_credits: 0 }]);
      }
      if (query.includes('FROM asset_folders')) {
        return queryResult([{ id: 'folder-ai-video' }]);
      }
      if (query.includes('INSERT INTO assets')) {
        return queryResult([{ id: 'asset-restored' }]);
      }
      if (query.includes('SELECT amount') && query.includes('FROM credit_allocations')) return queryResult([]);
      if (query.includes('COALESCE(sum(available_amount)')) {
        return queryResult([{ main_credits: 90, addon_credits: 0 }]);
      }
      if (query.includes('FROM credit_lots')) {
        return queryResult([{ id: 'lot-main-1', bucket: 'main', available_amount: 100, held_amount: 0, expires_at: null }]);
      }
      if (query.includes('SELECT id, lot_id, amount, status') && query.includes('FROM credit_allocations')) {
        return queryResult([{ id: 'allocation-recovery', lot_id: 'lot-main-1', amount: 10, status: 'held' }]);
      }
      if (query.includes('UPDATE users')) {
        return queryResult([{ id: 'user-1' }]);
      }
      if (query.includes('UPDATE credit_lots') || query.includes('UPDATE credit_allocations')) return queryResult([{ id: 'updated' }]);
      if (query.includes('INSERT INTO credit_allocations')) return queryResult([{ id: 'allocation-recovery' }]);
      if (query.includes('INSERT INTO credit_ledger')) {
        return queryResult([]);
      }
      if (query.includes('INSERT INTO provider_usage_records')) {
        return queryResult([{ id: 'usage-1' }]);
      }
      if (query.includes('UPDATE generation_tasks')) {
        return queryResult([{
          ...task,
          status: 'completed',
          failure_category: null,
          failure_reason: null,
          settled_credits: 10,
          refunded_credits: 0,
          credit_status: 'settled',
          asset_id: 'asset-restored',
          provider_task_id: providerResult.providerTaskId,
          completed_at: '2026-07-02T02:00:00.000Z',
        }]);
      }
      if (query.includes('UPDATE generation_provider_runs')) return queryResult([{ id: 'run-1' }]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(recoverRefundedTaskSuccess(
      'task-1',
      providerResult,
      '00000000-0000-4000-8000-000000000401',
    )).resolves.toMatchObject({
      id: 'task-1',
      status: 'completed',
      assetId: 'asset-restored',
      settledCredits: 10,
      refundedCredits: 0,
      creditStatus: 'settled',
    });

    expect(findQueryCall('INSERT INTO assets')?.[1]).toEqual(expect.arrayContaining([
      'user-1',
      'folder-ai-video',
      'video-object.mp4',
      'thumb-object.jpg',
    ]));
    expect(findQueryCall('INSERT INTO assets')?.[1]?.[13]).toMatchObject({
      durationSource: 'media-probe',
    });
    expect(String(findQueryCall('INSERT INTO assets')?.[0])).toContain('ON CONFLICT (user_id, object_key)');
    expect(findQueryCall('UPDATE users')?.[1]).toEqual(['user-1', 90, 0, 90]);
    expect(findQueryCall('INSERT INTO credit_ledger')?.[1]).toEqual([
      'user-1',
      'main',
      -10,
      90,
      'Seedance 2.0 Mini 恢复成片补扣',
      '视频已恢复并保存至数字资产，本次生成积分已扣除。',
      'task-1',
      'asset-restored',
      'generation-recovery-settle:task-1:0',
    ]);
    expect(findQueryCall('INSERT INTO provider_usage_records')?.[1]).toEqual([
      'volcengine-ark',
      'Seedance 2.0 Mini',
      'task-1',
      0,
      'cgt-20260701231431-ssx7t',
      'success',
      50_638,
      50_638,
      'tokens',
      null,
      50_638,
      50_638,
      50_638,
      'completion_tokens',
      '480p',
      false,
      'volcengine-seedance-2026-08-10',
      '23.000000',
      '1.164674',
      'CNY',
      'priced',
      'provider-reported',
      'priced',
      'without-video',
      '480p-720p',
      'direct',
      null,
      expect.any(String),
      expect.any(String),
      'usage-observed',
    ]);
  });

  it('拒绝恢复已绑定资产的任务，避免重复补扣', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM generation_tasks task') && query.includes('generation_provider_runs')) {
        return queryResult([{ ...generationTaskRow(), asset_id: 'asset-existing' }]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(recoverRefundedTaskSuccess(
      'task-1',
      providerSuccess(),
      '00000000-0000-4000-8000-000000000401',
    )).rejects.toMatchObject({
      statusCode: 400,
      message: '任务已绑定数字资产，不能重复恢复',
    });
  });

  it('恢复生成对象与已有资产类型冲突时不继续补扣', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('FROM generation_tasks task') && query.includes('generation_provider_runs')) return queryResult([generationTaskRow()]);
      if (query.includes('FROM generation_real_portrait_references ref')) return queryResult([]);
      if (query.includes('SELECT main_credits, addon_credits')) return queryResult([{ main_credits: 100, addon_credits: 0 }]);
      if (query.includes('FROM asset_folders')) return queryResult([{ id: 'folder-ai-video' }]);
      if (query.includes('INSERT INTO assets')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(recoverRefundedTaskSuccess(
      'task-1',
      providerSuccess(),
      '00000000-0000-4000-8000-000000000401',
    ))
      .rejects.toThrow('不同类型资产占用');
    expect(findQueryCall('UPDATE users')).toBeUndefined();
  });

  it('reconciler 只接管明确过期且非 submission-unknown 的 processing 任务', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      expect(query).toContain('lease_expires_at IS NOT NULL');
      expect(query).toContain("processing_stage NOT IN ('submission-unknown', 'manual-review')");
      expect(query).toContain("expired.provider_run_status = 'submitting'");
      expect(query).toContain("THEN 'submission-unknown'");
      expect(query).toContain("WHERE status = 'queued'");
      expect(query).not.toContain('attempt = attempt + 1');
      return queryResult([{ id: 'task-legacy', attempt: 1, claimEpoch: 3 }]);
    });

    await expect(requeueExpiredGenerationTasks(20)).resolves.toEqual([{
      id: 'task-legacy',
      attempt: 1,
      claimEpoch: 3,
    }]);
  });

  it('提交结果未知时保留供应商传入的原始字符串原因', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const query = String(sql);
      expect(params?.[3]).toBe('upstream unavailable（HTTP 503，code=InternalServiceError）');
      if (query.includes('UPDATE generation_provider_runs')) return queryResult([{ id: 'run-1' }]);
      if (query.includes('UPDATE generation_tasks')) return queryResult([{ id: 'task-1' }]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(markProviderSubmissionUnknown(
      'task-1',
      2,
      '00000000-0000-4000-8000-000000000301',
      'upstream unavailable（HTTP 503，code=InternalServiceError）',
    )).resolves.toBe(true);
  });

  it('Seedream checkpoint 更新显式限定 Provider Run 字段，避免 UPDATE FROM 同名列歧义', async () => {
    const checkpoint = {
      providerOperationId: 'seedream-sync:task-1:2',
      providerRequestId: 'seedream-logid-1',
      response: {
        version: 1,
        model: 'doubao-seedream-5-0-pro-260628',
        size: '1024x1024',
      },
      responseUrl: 'https://temporary.example.test/output.png',
      observedAt: '2026-07-28T12:20:55.000Z',
      responseUrlExpiresAt: '2026-07-29T12:20:55.000Z',
    };
    mocks.clientQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const query = String(sql);
      if (query.includes('UPDATE generation_provider_runs run')) {
        expect(query).toContain('COALESCE(run.provider_task_id, $4)');
        expect(query).toContain('COALESCE(run.provider_request_id, $5)');
        expect(query).toContain('COALESCE(run.provider_response_checkpoint, $6::jsonb)');
        expect(query).toContain('COALESCE(run.provider_response_url, $7)');
        expect(query).toContain('COALESCE(run.provider_response_observed_at, $8::timestamptz)');
        expect(query).toContain('COALESCE(run.provider_response_url_expires_at, $9::timestamptz)');
        expect(query).not.toMatch(/COALESCE\(provider_(?:task_id|request_id|response_)/);
        expect(params).toEqual([
          'task-1',
          2,
          '00000000-0000-4000-8000-000000000301',
          checkpoint.providerOperationId,
          checkpoint.providerRequestId,
          checkpoint.response,
          checkpoint.responseUrl,
          checkpoint.observedAt,
          checkpoint.responseUrlExpiresAt,
        ]);
        return queryResult([{ id: 'run-1' }]);
      }
      if (query.includes('UPDATE generation_tasks')) {
        return queryResult([{
          ...generationTaskRow(),
          status: 'processing',
          processing_stage: 'provider-succeeded',
          provider_task_id: checkpoint.providerOperationId,
          provider_task_attempt: 2,
          attempt: 2,
          claim_token: '00000000-0000-4000-8000-000000000301',
        }]);
      }
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(recordProviderResponseCheckpoint(
      'task-1',
      2,
      '00000000-0000-4000-8000-000000000301',
      checkpoint,
    )).resolves.toMatchObject({
      id: 'task-1',
      providerTaskId: checkpoint.providerOperationId,
      providerTaskAttempt: 2,
      processingStage: 'provider-succeeded',
    });
  });

  it('只有当前 generation claim 可以读取取消请求', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const query = String(sql);
      expect(query).toContain('run.lease_token = $3');
      expect(params).toEqual(['task-1', 2, '00000000-0000-4000-8000-000000000301']);
      return queryResult([{ requested: true }]);
    });

    await expect(isClaimedGenerationTaskCancellationRequested(
      'task-1',
      2,
      '00000000-0000-4000-8000-000000000301',
    )).resolves.toBe(true);
  });

  it('回调命中仍存活的 worker 租约时只补齐 provider id，不抢占或重复入队', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('WHERE run.callback_token = $1')) {
        return queryResult([{
          id: 'run-1',
          task_id: 'task-1',
          task_attempt: 2,
          provider: 'volcengine-ark',
          provider_task_id: null,
          lease_token: '00000000-0000-4000-8000-000000000301',
          lease_expires_at: '2999-01-01T00:00:00.000Z',
          task_status: 'processing',
          task_provider_task_id: null,
          task_claim_epoch: 4,
        }]);
      }
      if (query.includes('id <> $3')) return queryResult([]);
      if (query.includes('UPDATE generation_provider_runs')) return queryResult([{ id: 'run-1' }]);
      if (query.includes('UPDATE generation_tasks')) return queryResult([{ id: 'task-1' }]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(wakeGenerationProviderRunByCallback(
      '00000000-0000-4000-8000-000000000601',
      'provider-task-1',
    )).resolves.toEqual({
      taskId: 'task-1', attempt: 2, claimEpoch: 4, enqueue: false, conflict: false,
    });
    expect(findQueryCall("status = 'queued'")).toBeUndefined();
  });

  it('回调命中过期租约或 submission-unknown 时只唤醒原 run 查单', async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('WHERE run.callback_token = $1')) {
        return queryResult([{
          id: 'run-1',
          task_id: 'task-1',
          task_attempt: 2,
          provider: 'volcengine-ark',
          provider_task_id: null,
          lease_token: null,
          lease_expires_at: null,
          task_status: 'processing',
          task_provider_task_id: null,
          task_claim_epoch: 4,
        }]);
      }
      if (query.includes('id <> $3')) return queryResult([]);
      if (query.includes('UPDATE generation_provider_runs')) return queryResult([{ id: 'run-1' }]);
      if (query.includes('UPDATE generation_tasks')) return queryResult([{ id: 'task-1' }]);
      throw new Error(`未预期的查询：${query}`);
    });

    await expect(wakeGenerationProviderRunByCallback(
      '00000000-0000-4000-8000-000000000601',
      'provider-task-1',
    )).resolves.toEqual({
      taskId: 'task-1', attempt: 2, claimEpoch: 4, enqueue: true, conflict: false,
    });
    expect(findQueryCall("status = 'queued'")).toBeDefined();
  });
});

function findQueryCall(pattern: string) {
  return mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes(pattern));
}

function generationTaskRow() {
  return {
    id: 'task-1',
    user_id: 'user-1',
    kind: 'video',
    model: 'Seedance 2.0 Mini',
    status: 'failed',
    failure_category: 'provider-failed',
    failure_reason: 'Unable to calculate hash for flowing readable stream',
    prompt: '生成产品视频',
    config: {
      mode: 'general',
      resolution: '480p',
      aspectRatio: '9:16',
      durationSeconds: 5,
    },
    provider_task_id: 'cgt-20260701231431-ssx7t',
    provider_task_attempt: 0,
    credits: 10,
    reserved_credits: 10,
    settled_credits: 0,
    refunded_credits: 10,
    credit_status: 'refunded',
    main_credits_used: 10,
    addon_credits_used: 0,
    asset_id: null,
    retry_count: 0,
    attempt: 0,
    processing_stage: 'failed',
    claim_token: null,
    claim_epoch: 0,
    cancel_state: 'none',
    active_provider_run_id: '00000000-0000-4000-8000-000000000501',
    provider_result: null,
    lease_expires_at: null,
    heartbeat_at: null,
    settlement_error: null,
    cancel_requested_at: null,
    cancel_requested_by: null,
    created_at: '2026-07-01T23:16:59.351Z',
    started_at: '2026-07-01T23:16:59.351Z',
    completed_at: '2026-07-01T23:16:59.351Z',
    updated_at: '2026-07-01T23:16:59.351Z',
  };
}

function refundableTaskWithoutProviderId() {
  return {
    ...generationTaskRow(),
    status: 'processing' as const,
    processing_stage: 'provider-submitting',
    provider_task_id: null,
    provider_task_attempt: 0,
    credit_status: 'held',
    settled_credits: 0,
    refunded_credits: 0,
    completed_at: null,
  };
}

function installRefundFailureQuery(
  task: ReturnType<typeof refundableTaskWithoutProviderId>,
  options: {
    usageRow: Record<string, unknown>;
    onCaseInsert?: () => ReturnType<typeof queryResult>;
    existingCaseId?: string;
  },
) {
  mocks.clientQuery.mockImplementation(async (sql: unknown) => {
    const query = String(sql);
    if (query.includes('SELECT * FROM generation_tasks') && query.includes('FOR UPDATE')) return queryResult([task]);
    if (query.includes('INSERT INTO provider_usage_records')) return queryResult([options.usageRow]);
    if (query.includes('INSERT INTO provider_reconciliation_cases')) {
      return options.onCaseInsert?.() ?? queryResult([]);
    }
    if (query.includes('FROM provider_reconciliation_cases') && query.includes('case_key = $1')) {
      return queryResult(options.existingCaseId ? [{ id: options.existingCaseId }] : []);
    }
    if (query.includes('INSERT INTO provider_reconciliation_case_links')) return queryResult([]);
    if (query.includes('SELECT main_credits, addon_credits')) return queryResult([{ main_credits: 90, addon_credits: 0 }]);
    if (query.includes('FROM credit_allocations allocation')) {
      return queryResult([{
        id: 'allocation-1', lot_id: 'lot-1', amount: 10,
        status: 'held', bucket: 'main', expires_at: null,
      }]);
    }
    if (query.includes('COALESCE(sum(available_amount)')) {
      return queryResult([{ main_credits: 100, addon_credits: 0 }]);
    }
    if (query.includes('UPDATE credit_lots') || query.includes('UPDATE credit_allocations')) return queryResult([{ id: 'updated' }]);
    if (query.includes('UPDATE users')) return queryResult([{ id: 'user-1' }]);
    if (query.includes('UPDATE credit_ledger') || query.includes('INSERT INTO credit_ledger')) return queryResult([]);
    if (query.includes('INSERT INTO audit_logs')) return queryResult([]);
    if (query.includes('UPDATE generation_tasks')) return queryResult([{
      ...task,
      status: 'failed',
      processing_stage: 'failed',
      credit_status: 'refunded',
      refunded_credits: 10,
      completed_at: '2026-07-23T10:00:00.000Z',
    }]);
    if (query.includes('UPDATE generation_provider_runs')) return queryResult([{ id: 'run-1' }]);
    throw new Error(`未预期的查询：${query}`);
  });
}

function providerSuccess(): ProviderSuccess {
  return {
    ok: true,
    provider: 'volcengine-ark',
    providerTaskId: 'cgt-20260701231431-ssx7t',
    objectKey: 'video-object.mp4',
    thumbnailKey: 'thumb-object.jpg',
    publicUrl: 'https://storage.example.com/video-object.mp4',
    thumbnailUrl: 'https://storage.example.com/thumb-object.jpg',
    sizeBytes: 1024,
    width: 1080,
    height: 1920,
    durationSeconds: 5,
    durationSource: 'media-probe',
    rawUnits: 50638,
    deductedUnits: 50638,
    completionTokens: 50638,
    totalTokens: 50638,
    billableTokens: 50638,
    billableBasis: 'completion_tokens',
    usageUnit: 'tokens',
  };
}

function queryResult(rows: unknown[]) {
  return {
    rowCount: rows.length,
    rows,
  };
}
