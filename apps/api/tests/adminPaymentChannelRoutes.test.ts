import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  requireAdmin: vi.fn(),
  getPaymentChannelAdminView: vi.fn(),
  getUnchangedPaymentChannelView: vi.fn(),
  savePaymentChannel: vi.fn(),
  runAdminIdempotentAction: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: vi.fn() },
  withTransaction: mocks.withTransaction,
}));

vi.mock('../src/auth/session.js', () => ({ requireAdmin: mocks.requireAdmin }));

vi.mock('../src/domain/adminIdempotency.js', () => ({
  resolveAdminIdempotencyKey: vi.fn(({ headerKey }: { headerKey?: string | string[] }) => (
    Array.isArray(headerKey) ? headerKey[0] : headerKey
  )),
  runAdminIdempotentAction: mocks.runAdminIdempotentAction,
}));

vi.mock('../src/payments/paymentChannelService.js', () => ({
  getPaymentChannelAdminView: mocks.getPaymentChannelAdminView,
  getUnchangedPaymentChannelView: mocks.getUnchangedPaymentChannelView,
  savePaymentChannel: mocks.savePaymentChannel,
}));

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';

describe('后台支付通道配置', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', role: 'admin' });
    mocks.withTransaction.mockImplementation(async callback => callback({ query: mocks.clientQuery }));
    mocks.runAdminIdempotentAction.mockImplementation(async input => mocks.withTransaction(async (client: { query: typeof mocks.clientQuery }) => ({
      response: await input.execute(client, 'action-1'),
      statusCode: input.successStatus ?? 200,
      reused: false,
      actionId: 'action-1',
    })));
    mocks.getPaymentChannelAdminView.mockResolvedValue({
      enabled: false,
      apiBase: '',
      mchNo: '',
      appId: '',
      hasApiKey: false,
      desktopWayCode: 'ALI_WAP',
      mobileWayCode: 'ALI_WAP',
      updatedAt: null,
    });
    mocks.getUnchangedPaymentChannelView.mockResolvedValue(null);
    mocks.savePaymentChannel.mockResolvedValue({
      enabled: true,
      apiBase: 'https://pay.example.com',
      mchNo: 'M100',
      appId: 'APP100',
      hasApiKey: true,
      desktopWayCode: 'ALI_WAP',
      mobileWayCode: 'ALI_WAP',
      updatedAt: '2026-07-11T10:00:00.000Z',
    });
    mocks.clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('保存配置与审计日志共用同一事务客户端', async () => {
    const app = fastify();
    await app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/payment-channel',
        headers: { 'Idempotency-Key': 'payment-channel-save-1' },
        payload: {
          enabled: true,
          apiBase: 'https://pay.example.com',
          mchNo: 'M100',
          appId: 'APP100',
          apiKey: 'secret',
          desktopWayCode: 'ALI_WAP',
          mobileWayCode: 'ALI_WAP',
        },
      });

      expect(response.statusCode, response.body).toBe(200);
      const transactionClient = mocks.savePaymentChannel.mock.calls[0]?.[0];
      expect(mocks.savePaymentChannel).toHaveBeenCalledWith(
        transactionClient,
        'admin-1',
        expect.objectContaining({ enabled: true, apiBase: 'https://pay.example.com' }),
      );
      expect(mocks.clientQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining(['admin-1', '支付通道', '保存配置', '在线支付', 'high']),
      );
      expect(mocks.withTransaction).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it('相同配置使用新幂等键时不重复保存或写审计', async () => {
    const currentChannel = {
      enabled: true,
      apiBase: 'https://pay.example.com',
      mchNo: 'M100',
      appId: 'APP100',
      hasApiKey: true,
      desktopWayCode: 'ALI_WAP' as const,
      mobileWayCode: 'ALI_WAP' as const,
      updatedAt: '2026-07-11T10:00:00.000Z',
    };
    mocks.getUnchangedPaymentChannelView.mockResolvedValue(currentChannel);
    const app = fastify();
    await app.register(registerAdminRoutes);
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/payment-channel',
        headers: { 'Idempotency-Key': 'payment-channel-noop-2' },
        payload: {
          enabled: true,
          apiBase: 'https://pay.example.com/',
          mchNo: 'M100',
          appId: 'APP100',
          desktopWayCode: 'ALI_WAP',
          mobileWayCode: 'ALI_WAP',
        },
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({ channel: currentChannel });
      expect(mocks.getUnchangedPaymentChannelView).toHaveBeenCalledWith(
        expect.objectContaining({ query: mocks.clientQuery }),
        expect.objectContaining({ apiBase: 'https://pay.example.com/' }),
      );
      expect(mocks.savePaymentChannel).not.toHaveBeenCalled();
      expect(mocks.clientQuery).not.toHaveBeenCalled();
      expect(mocks.withTransaction).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });
});
