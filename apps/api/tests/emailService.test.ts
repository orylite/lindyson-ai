import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock('../src/config/env.js', () => ({
  env: {
    RESEND_API_KEY: 're_test_1234567890',
    RESEND_FROM: 'Lindyson AI <noreply@lindyson.com>',
    RESEND_NOTIFY_TO: 'junozdev@outlook.com',
    RESEND_BLOCKED_TO: 'admin@lindyson.com',
    APP_BASE_URL: 'https://lindyson.com',
  },
}));

vi.mock('../src/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
  },
}));

import { env } from '../src/config/env.js';
import {
  sendInvoiceRequestedAdminEmail,
  sendPasswordResetEmail,
  sendPaymentSuccessEmail,
  sendRegisterCodeEmail,
  sendSupportTicketEmail,
  sendTransactionalEmail,
  sendWelcomeEmail,
} from '../src/notifications/emailService.js';

describe('emailService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.poolQuery.mockReset();
    mocks.poolQuery.mockResolvedValue({ rowCount: 1, rows: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('通过 Resend API 发送成功并记录 sent 事件', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'em_123' }));

    const result = await sendSampleEmail();

    expect(result).toEqual({ status: 'sent', providerMessageId: 'em_123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer re_test_1234567890');
    expect(headers.get('idempotency-key')).toBe('verification-1');
    expect(JSON.parse(String(init.body))).toMatchObject({
      from: 'Lindyson AI <noreply@lindyson.com>',
      to: ['new.user@example.com'],
      subject: '测试邮件',
      html: '<p>ok</p>',
    });

    const params = lastEmailEventParams();
    expect(params[0]).toBe('register-code-requested');
    expect(params[3]).toBe('sent');
    expect(params[4]).toBe('em_123');
    expect(JSON.parse(String(params[10]))).toMatchObject({
      expiresMinutes: 10,
      resendAttempts: 1,
    });
  });

  it('所有用户邮件使用 Lindyson AI 品牌标题和发件人名称', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ id: 'em_branding' })));

    await sendWelcomeEmail({
      userId: 'user-1',
      email: 'user@example.com',
      userName: '测试用户',
    });
    await sendRegisterCodeEmail({
      email: 'user@example.com',
      userName: '测试用户',
      code: '123456',
      expiresMinutes: 10,
      idempotencyKey: 'register-code-1',
    });
    await sendPasswordResetEmail({
      userId: 'user-1',
      email: 'user@example.com',
      userName: '测试用户',
      resetUrl: 'https://lindyson.com/reset-password?token=test',
      expiresMinutes: 30,
      idempotencyKey: 'password-reset-1',
    });
    await sendPaymentSuccessEmail({
      userId: 'user-1',
      email: 'user@example.com',
      orderId: 'order-1',
      planName: '专业版',
      amount: 2900,
      credits: 100,
    });
    await sendSupportTicketEmail({
      userId: 'user-1',
      email: 'user@example.com',
      userName: '测试用户',
      ticketId: 'ticket-1',
      title: '测试工单',
      priority: 'normal',
    });

    const bodies = fetchMock.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)));
    expect(bodies.map(body => body.subject)).toEqual([
      '欢迎使用 Lindyson AI',
      'Lindyson AI 注册邮箱验证码',
      'Lindyson AI 密码重置链接',
      'Lindyson AI 订单支付成功',
      'Lindyson AI 工单已提交：测试工单',
    ]);
    expect(bodies.every(body => body.from === 'Lindyson AI <noreply@lindyson.com>')).toBe(true);
  });

  it('Resend 4xx 失败不重试并记录 failed 事件', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      name: 'validation_error',
      message: 'API key is invalid',
    }, 401));

    const result = await sendSampleEmail();

    expect(result).toEqual({
      status: 'failed',
      error: 'validation_error: API key is invalid',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const params = lastEmailEventParams();
    expect(params[3]).toBe('failed');
    expect(params[5]).toBe('validation_error: API key is invalid');
    expect(JSON.parse(String(params[10]))).toMatchObject({ resendAttempts: 1 });
  });

  it('Resend 5xx 失败会用同一个 Idempotency-Key 重试一次', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        name: 'application_error',
        message: 'temporary unavailable',
      }, 503))
      .mockResolvedValueOnce(jsonResponse({ id: 'em_after_retry' }));

    const result = await sendSampleEmail();

    expect(result).toEqual({ status: 'sent', providerMessageId: 'em_after_retry' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
    const secondHeaders = new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers);
    expect(firstHeaders.get('idempotency-key')).toBe('verification-1');
    expect(secondHeaders.get('idempotency-key')).toBe('verification-1');
    expect(JSON.parse(String(lastEmailEventParams()[10]))).toMatchObject({ resendAttempts: 2 });
  });

  it('网络错误只重试一次并记录最终失败', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('still down'));

    const result = await sendSampleEmail();

    expect(result).toEqual({ status: 'failed', error: 'still down' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const params = lastEmailEventParams();
    expect(params[3]).toBe('failed');
    expect(params[5]).toBe('still down');
    expect(JSON.parse(String(params[10]))).toMatchObject({ resendAttempts: 2 });
  });

  it('仅有被屏蔽收件人时不调用 Resend，并按大小写无关规则记录 skipped', async () => {
    const result = await sendTransactionalEmail({
      eventType: 'password-reset-requested',
      to: 'Admin@LINDYSON.com',
      subject: '测试屏蔽邮件',
      html: '<p>blocked</p>',
    });

    expect(result).toEqual({
      status: 'skipped',
      error: '所有收件人均已被全局屏蔽，邮件未发送。',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
    const params = lastEmailEventParams();
    expect(params[1]).toBe('Admin@LINDYSON.com');
    expect(params[3]).toBe('skipped');
    expect(params[5]).toContain('RESEND_BLOCKED_TO');
    expect(JSON.parse(String(params[10]))).toMatchObject({ resendAttempts: 0 });
  });

  it('混合收件人只向未屏蔽邮箱投递，并分别记录 skipped 与 sent', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'em_support_admin' }));

    const result = await sendTransactionalEmail({
      eventType: 'support-ticket-submitted',
      to: ['admin@lindyson.com', 'junozdev@outlook.com'],
      subject: '测试工单通知',
      html: '<p>ticket</p>',
      relatedTicketId: 'ticket-1',
    });

    expect(result).toEqual({ status: 'sent', providerMessageId: 'em_support_admin' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.to).toEqual(['junozdev@outlook.com']);
    expect(body.to).not.toContain('admin@lindyson.com');
    expect(mocks.poolQuery).toHaveBeenCalledTimes(2);

    const blockedParams = mocks.poolQuery.mock.calls[0][1] as unknown[];
    expect(blockedParams[1]).toBe('admin@lindyson.com');
    expect(blockedParams[3]).toBe('skipped');
    expect(blockedParams[5]).toContain('RESEND_BLOCKED_TO');

    const sentParams = mocks.poolQuery.mock.calls[1][1] as unknown[];
    expect(sentParams[1]).toBe('junozdev@outlook.com');
    expect(sentParams[3]).toBe('sent');
    expect(sentParams[4]).toBe('em_support_admin');
  });

  it('发票申请只向管理员邮箱发通知，账号邮箱和接收邮箱只出现在人工处理资料中', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'em_invoice_admin' }));

    await sendInvoiceRequestedAdminEmail({
      idempotencyKey: 'invoice-requested-admin:invoice-1',
      invoiceId: 'invoice-1',
      orderId: 'order-1',
      userId: 'user-1',
      userName: '测试用户',
      accountEmail: 'account@example.com',
      planName: '专业版',
      amount: 2900,
      invoiceTitle: '测试公司',
      taxId: '91310000TEST',
      receiveEmail: 'invoice-delivery@example.com',
      note: '电子发票',
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(['junozdev@outlook.com']);
    expect(body.to).not.toContain('account@example.com');
    expect(body.to).not.toContain('invoice-delivery@example.com');
    expect(body.subject).toBe('Lindyson AI 新发票申请：测试公司');
    expect(body.html).toContain('account@example.com');
    expect(body.html).toContain('invoice-delivery@example.com');
    expect(body.html).toContain('https://lindyson.com/admin/invoices');
    expect(new Headers(init.headers).get('idempotency-key')).toBe('invoice-requested-admin:invoice-1');

    const params = lastEmailEventParams();
    expect(params[0]).toBe('invoice-requested-admin');
    expect(params[1]).toBe('junozdev@outlook.com');
    expect(params[6]).toBe('user-1');
    expect(params[7]).toBe('order-1');
    expect(params[9]).toBe('invoice-1');
  });

  it('未配置管理员通知邮箱时跳过投递且不会回退发送给用户', async () => {
    const mutableEnv = env as typeof env & { RESEND_NOTIFY_TO?: string };
    const previousNotifyTo = mutableEnv.RESEND_NOTIFY_TO;
    mutableEnv.RESEND_NOTIFY_TO = undefined;

    try {
      await expect(sendInvoiceRequestedAdminEmail({
        idempotencyKey: 'invoice-requested-admin:invoice-2',
        invoiceId: 'invoice-2',
        orderId: 'order-2',
        userId: 'user-2',
        userName: '测试用户',
        accountEmail: 'account@example.com',
        planName: '专业版',
        amount: 2900,
        invoiceTitle: '测试公司',
        taxId: '',
        receiveEmail: 'invoice-delivery@example.com',
        note: '',
      })).resolves.toEqual(expect.objectContaining({ status: 'skipped' }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    } finally {
      mutableEnv.RESEND_NOTIFY_TO = previousNotifyTo;
    }
  });
});

function sendSampleEmail() {
  return sendTransactionalEmail({
    eventType: 'register-code-requested',
    to: 'new.user@example.com',
    subject: '测试邮件',
    html: '<p>ok</p>',
    idempotencyKey: 'verification-1',
    metadata: { expiresMinutes: 10 },
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function lastEmailEventParams() {
  const call = mocks.poolQuery.mock.calls.at(-1);
  expect(call).toBeTruthy();
  return call![1] as unknown[];
}
