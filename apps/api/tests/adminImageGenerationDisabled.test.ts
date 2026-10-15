import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  requireAdmin: vi.fn(),
  withTransaction: vi.fn(),
  runAdminIdempotentAction: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: vi.fn() },
  withTransaction: mocks.withTransaction,
}));
vi.mock('../src/auth/session.js', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('../src/providers/volcengineBillingProvider.js', () => ({ maybeSyncVolcengineBillingPackages: vi.fn() }));
vi.mock('../src/domain/adminIdempotency.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/domain/adminIdempotency.js')>();
  return {
    ...actual,
    runAdminIdempotentAction: mocks.runAdminIdempotentAction,
  };
});

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';

describe('后台 Seedream 图片积分配置', () => {
  beforeEach(() => {
    mocks.clientQuery.mockReset();
    mocks.requireAdmin.mockReset();
    mocks.withTransaction.mockReset();
    mocks.runAdminIdempotentAction.mockReset();
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', role: 'admin' });
    mocks.withTransaction.mockImplementation(async callback => callback({ query: mocks.clientQuery }));
    mocks.runAdminIdempotentAction.mockImplementation(async input => mocks.withTransaction(async (client: DbClient) => ({
      response: await input.execute(client, 'test-admin-action'),
      statusCode: input.successStatus ?? 200,
      reused: false,
      actionId: 'test-admin-action',
    })));
  });

  it('可原子更新 Seedream 2K 积分和开放状态并写入审计', async () => {
    const current = {
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'image',
      model: 'Seedream 5.0 Pro',
      model_label: 'Seedream 5.0 Pro',
      duration_seconds: 0,
      resolution: '2K',
      credits: 28,
      reference_video_credits: null,
      available: false,
      updated_at: '2026-07-27T00:00:00.000Z',
    };
    mocks.clientQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [current] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...current, credits: 30, available: true, updated_at: '2026-07-27T01:00:00.000Z' }],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const app = fastify({ logger: false });
    app.register(registerAdminRoutes);
    app.setErrorHandler((error, _request, reply) => {
      const typedError = error as { statusCode?: number; message?: string };
      const statusCode = typedError.statusCode ?? 500;
      return reply.code(statusCode).send({ message: typedError.message });
    });
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/consumption-settings/11111111-1111-4111-8111-111111111111',
        headers: { 'idempotency-key': 'enable-seedream-2k' },
        payload: { credits: 30, available: true },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().setting).toMatchObject({
        modelLabel: 'Seedream 5.0 Pro',
        resolution: '2K',
        credits: 30,
        available: true,
      });
      expect(mocks.clientQuery.mock.calls[1]?.[1]).toEqual([current.id, 30, null, true]);
      expect(mocks.clientQuery.mock.calls[2]?.[1]?.[6]).toContain('2K 图片消耗 28 → 30；开放状态 关闭 → 开放');
    } finally {
      await app.close();
    }
  });

  it('视频无参考与含参考积分在一次后台操作中原子更新并写入审计', async () => {
    const current = {
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'video',
      model: 'Seedance 2.0',
      model_label: 'Seedance 2.0',
      duration_seconds: 15,
      resolution: '720p',
      credits: 80,
      reference_video_credits: 80,
      available: true,
      updated_at: '2026-07-01T10:00:00.000Z',
    };
    mocks.clientQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [current] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          ...current,
          credits: 82,
          reference_video_credits: 96,
          updated_at: '2026-07-15T10:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const app = fastify({ logger: false });
    app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/consumption-settings/11111111-1111-4111-8111-111111111111',
        headers: { 'idempotency-key': 'update-video-consumption-pairs' },
        payload: { credits: 82, referenceVideoCredits: 96 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().setting).toMatchObject({
        credits: 82,
        referenceVideoCredits: 96,
      });
      expect(mocks.clientQuery.mock.calls[1]?.[1]).toEqual([
        current.id,
        82,
        96,
        true,
      ]);
      expect(mocks.clientQuery.mock.calls[2]?.[1]?.[6]).toContain('无参考视频 80 → 82；含参考视频 80 → 96');
      expect(mocks.clientQuery.mock.calls[2]?.[1]?.[6]).toContain('开放状态 开放 → 开放');
    } finally {
      await app.close();
    }
  });

  it('拒绝用单行 PATCH 改 Seedance 2.5 开放状态，但保留逐行价格编辑入口', async () => {
    const current = seedance25Rows(false)[0]!;
    mocks.clientQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [current] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [current] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...current, credits: 50, reference_video_credits: 31 }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const app = fastify({ logger: false });
    app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/consumption-settings/${current.id}`,
        headers: { 'idempotency-key': 'reject-single-seedance-2-5-open' },
        payload: { available: true },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain('模型级开关一次性切换全部 12 个组合');
      expect(mocks.clientQuery).toHaveBeenCalledTimes(1);

      const pricingResponse = await app.inject({
        method: 'PATCH',
        url: `/api/admin/consumption-settings/${current.id}`,
        headers: { 'idempotency-key': 'edit-single-seedance-2-5-price' },
        payload: { credits: 50, referenceVideoCredits: 31 },
      });
      expect(pricingResponse.statusCode).toBe(200);
      expect(pricingResponse.json().setting).toMatchObject({
        credits: 50,
        referenceVideoCredits: 31,
        available: false,
      });
      expect(mocks.clientQuery).toHaveBeenCalledTimes(4);
      expect(mocks.clientQuery.mock.calls[3]?.[1]?.[4]).toBe('high');
    } finally {
      await app.close();
    }
  });

  it('已开放的 Seedance 2.5 行不能被改成零积分', async () => {
    const current = seedance25Rows(true)[0]!;
    mocks.clientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [current] });

    const app = fastify({ logger: false });
    app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/consumption-settings/${current.id}`,
        headers: { 'idempotency-key': 'reject-live-seedance-2-5-zero-price' },
        payload: { credits: 0 },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain('必须保留正整数');
      expect(mocks.clientQuery).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('Seedance 2.5 的 12 个组合在一次后台事务中全量开放并审计，新客户端收到 25 秒档', async () => {
    const currentRows = seedance25Rows(false);
    const updatedRows = seedance25Rows(true);
    mocks.clientQuery
      .mockResolvedValueOnce({ rowCount: 12, rows: currentRows })
      .mockResolvedValueOnce({ rowCount: 12, rows: updatedRows })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const app = fastify({ logger: false });
    app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/consumption-settings/video-models/Seedance%202.5/availability?videoDuration25=1',
        headers: { 'idempotency-key': 'open-seedance-2-5' },
        payload: { available: true },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            modelLabel: 'Seedance 2.5', durationSeconds: 30, resolution: '720p',
            credits: 244, referenceVideoCredits: 147, available: true,
          }),
          expect.objectContaining({
            modelLabel: 'Seedance 2.5', durationSeconds: 25, resolution: '720p',
            credits: 204, referenceVideoCredits: 123, available: true,
          }),
        ]),
      });
      expect(response.json().items).toHaveLength(12);
      expect(mocks.clientQuery.mock.calls[0]?.[0]).toContain('FOR UPDATE OF setting');
      expect(mocks.clientQuery.mock.calls[1]?.[0]).toContain('SET available = $2');
      expect(mocks.clientQuery.mock.calls[1]?.[1]).toEqual(['Seedance 2.5', true]);
      expect(mocks.clientQuery.mock.calls[2]?.[1]?.[6]).toContain('0/12 个组合开放 → 12/12 全部开放');
      expect(mocks.clientQuery.mock.calls[2]?.[1]?.[6]).toContain('积分未修改');
      expect(mocks.clientQuery.mock.calls[2]?.[1]?.[4]).toBe('high');
    } finally {
      await app.close();
    }
  });

  it('旧后台客户端不带标记时仍原子切换 12 档，但响应隐藏 25 秒两行', async () => {
    const currentRows = seedance25Rows(true);
    const updatedRows = seedance25Rows(false);
    mocks.clientQuery
      .mockResolvedValueOnce({ rowCount: 12, rows: currentRows })
      .mockResolvedValueOnce({ rowCount: 12, rows: updatedRows })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const app = fastify({ logger: false });
    app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/consumption-settings/video-models/Seedance%202.5/availability',
        headers: { 'idempotency-key': 'close-seedance-2-5-legacy-client' },
        payload: { available: false },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().items).toHaveLength(10);
      expect(response.json().items).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ durationSeconds: 25 }),
      ]));
      expect(mocks.clientQuery.mock.calls[1]?.[1]).toEqual(['Seedance 2.5', false]);
      expect(mocks.clientQuery.mock.calls[2]?.[1]?.[6]).toContain('12/12 个组合开放 → 0/12 全部暂停');
    } finally {
      await app.close();
    }
  });
});

function seedance25Rows(available: boolean) {
  const prices: Array<[number, string, number, number]> = [
    [5, '480p', 49, 30], [10, '480p', 86, 52], [15, '480p', 86, 52],
    [20, '480p', 115, 69], [25, '480p', 144, 87], [30, '480p', 172, 104],
    [5, '720p', 61, 37], [10, '720p', 107, 65], [15, '720p', 122, 74],
    [20, '720p', 163, 98], [25, '720p', 204, 123], [30, '720p', 244, 147],
  ];
  return prices.map(([duration, resolution, credits, referenceVideoCredits], index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    kind: 'video',
    model: 'Seedance 2.5',
    model_label: 'Seedance 2.5',
    duration_seconds: duration,
    resolution,
    credits,
    reference_video_credits: referenceVideoCredits,
    available,
    updated_at: '2026-08-12T00:00:00.000Z',
  }));
}
