import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  sendPaymentSuccessEmail: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
}));
vi.mock('../src/notifications/emailService.js', () => ({
  sendInvoiceRequestedAdminEmail: vi.fn(),
  sendPaymentSuccessEmail: mocks.sendPaymentSuccessEmail,
}));

import { processPaymentNotificationOutbox } from '../src/domain/notificationOutbox.js';

describe('支付成功通知 Outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('发送成功只允许持有 claim token 的 worker 完成记录', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(result([outboxRow()]))
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mocks.sendPaymentSuccessEmail.mockResolvedValue({ status: 'sent', providerMessageId: 'email-1' });

    await expect(processPaymentNotificationOutbox(1)).resolves.toEqual({
      scanned: 1,
      completed: 1,
      skipped: 0,
      retried: 0,
      failed: 0,
    });
    expect(mocks.sendPaymentSuccessEmail).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'payment-succeeded:11111111-1111-4111-8111-111111111111',
    }));
    expect(mocks.poolQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/status = 'processing' AND lease_token = \$2::uuid/),
      [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        null,
        'email-1',
      ],
    );
  });

  it('暂时失败以同一 claim token CAS 退回 pending 并安排退避', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(result([outboxRow({ attempts: 2 })]))
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mocks.sendPaymentSuccessEmail.mockResolvedValue({ status: 'failed', error: 'network' });

    await expect(processPaymentNotificationOutbox(1)).resolves.toEqual({
      scanned: 1,
      completed: 0,
      skipped: 0,
      retried: 1,
      failed: 0,
    });
    expect(mocks.poolQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/status = 'processing' AND lease_token = \$2::uuid/),
      [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'pending',
        'network',
        expect.any(Number),
      ],
    );
  });

  it('旧 worker 的 CAS 更新为零行时不得虚报完成', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(result([outboxRow()]))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mocks.sendPaymentSuccessEmail.mockResolvedValue({ status: 'sent', providerMessageId: 'email-1' });

    await expect(processPaymentNotificationOutbox(1)).resolves.toEqual({
      scanned: 1,
      completed: 0,
      skipped: 0,
      retried: 0,
      failed: 0,
    });
  });
});

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    event_key: 'payment-succeeded:11111111-1111-4111-8111-111111111111',
    attempts: 1,
    lease_token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    payload: {
      userId: '22222222-2222-4222-8222-222222222222',
      email: 'user@example.com',
      orderId: '11111111-1111-4111-8111-111111111111',
      planName: '专业版',
      amount: 22800,
      credits: 10000,
    },
    ...overrides,
  };
}

function result<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}
