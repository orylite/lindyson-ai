import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  sendInvoiceRequestedAdminEmail: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
}));

vi.mock('../src/notifications/emailService.js', () => ({
  sendInvoiceRequestedAdminEmail: mocks.sendInvoiceRequestedAdminEmail,
}));

import {
  processInvoiceNotificationOutbox,
  scheduleInvoiceRequestedAdminNotification,
} from '../src/domain/notificationOutbox.js';

const INVOICE_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';

describe('发票管理员通知 Outbox', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.sendInvoiceRequestedAdminEmail.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('在业务事务中使用固定事件键幂等写入管理员通知', async () => {
    const client = { query: vi.fn().mockResolvedValue(queryResult([])) };

    await expect(scheduleInvoiceRequestedAdminNotification(client as never, notificationPayload()))
      .resolves.toBe(`invoice-requested-admin:${INVOICE_ID}`);

    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO invoice_notification_outbox[\s\S]*ON CONFLICT \(event_key\) DO NOTHING/),
      [`invoice-requested-admin:${INVOICE_ID}`, INVOICE_ID, JSON.stringify(notificationPayload())],
    );
  });

  it('投递成功后完成 Outbox，Resend 始终复用固定事件键', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([outboxRow({ attempts: 1 })]))
      .mockResolvedValueOnce(queryResult([]));
    mocks.sendInvoiceRequestedAdminEmail.mockResolvedValue({
      status: 'sent',
      providerMessageId: 'em_invoice_1',
    });

    await expect(processInvoiceNotificationOutbox(1)).resolves.toEqual({
      scanned: 1,
      completed: 1,
      skipped: 0,
      retried: 0,
      failed: 0,
    });

    expect(mocks.sendInvoiceRequestedAdminEmail).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `invoice-requested-admin:${INVOICE_ID}`,
      accountEmail: 'account@example.com',
      receiveEmail: 'invoice-delivery@example.com',
    }));
    expect(mocks.poolQuery).toHaveBeenLastCalledWith(
      expect.stringMatching(/SET status = 'completed'/),
      ['outbox-1', null, 'em_invoice_1'],
    );
  });

  it('投递异常不会回滚发票申请，而是释放租约等待重试', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([outboxRow({ attempts: 1 })]))
      .mockResolvedValueOnce(queryResult([]));
    mocks.sendInvoiceRequestedAdminEmail.mockRejectedValue(new Error('network down'));

    await expect(processInvoiceNotificationOutbox(1)).resolves.toEqual(expect.objectContaining({
      scanned: 1,
      retried: 1,
      failed: 0,
    }));

    expect(mocks.poolQuery).toHaveBeenLastCalledWith(
      expect.stringMatching(/SET status = 'pending'[\s\S]*available_at/),
      ['outbox-1', 'network down', 300],
    );
  });

  it('第八次仍失败会停止自动重试并记录高优先级告警', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([outboxRow({ attempts: 8 })]))
      .mockResolvedValueOnce(queryResult([]));
    mocks.sendInvoiceRequestedAdminEmail.mockResolvedValue({ status: 'failed', error: 'permanent error' });

    await expect(processInvoiceNotificationOutbox(1)).resolves.toEqual(expect.objectContaining({
      scanned: 1,
      retried: 0,
      failed: 1,
    }));

    expect(mocks.poolQuery).toHaveBeenLastCalledWith(
      expect.stringMatching(/SET status = 'failed'/),
      ['outbox-1', 'permanent error'],
    );
    expect(console.error).toHaveBeenCalledWith(
      '高优先级：发票申请管理员邮件未送达',
      expect.objectContaining({ invoiceId: INVOICE_ID, attempts: 8 }),
    );
  });

  it('迁移提供唯一事件键、租约与待处理索引', () => {
    const migration = readFileSync(
      new URL('../migrations/031_invoice_notification_outbox.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain('event_key text NOT NULL UNIQUE');
    expect(migration).toContain('invoice_id uuid NOT NULL UNIQUE');
    expect(migration).toContain('payload jsonb NOT NULL');
    expect(migration).toContain('lease_until timestamptz');
    expect(migration).toContain('idx_invoice_notification_outbox_pending');
  });
});

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'outbox-1',
    event_key: `invoice-requested-admin:${INVOICE_ID}`,
    invoice_id: INVOICE_ID,
    attempts: 1,
    payload: notificationPayload(),
    ...overrides,
  };
}

function notificationPayload() {
  return {
    invoiceId: INVOICE_ID,
    orderId: ORDER_ID,
    userId: 'user-1',
    userName: '测试用户',
    accountEmail: 'account@example.com',
    planName: '专业版',
    amount: 2900,
    invoiceTitle: '测试公司',
    taxId: '91310000TEST',
    receiveEmail: 'invoice-delivery@example.com',
    note: '电子发票',
  };
}

function queryResult(rows: unknown[]) {
  return { rowCount: rows.length, rows };
}
