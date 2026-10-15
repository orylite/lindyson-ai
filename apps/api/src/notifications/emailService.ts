import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

type EmailEventType =
  | 'welcome'
  | 'register-code-requested'
  | 'password-reset-requested'
  | 'payment-success'
  | 'support-ticket-submitted'
  | 'invoice-requested-admin';

interface SendEmailInput {
  eventType: EmailEventType;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  idempotencyKey?: string;
  relatedUserId?: string;
  relatedOrderId?: string;
  relatedTicketId?: string;
  relatedInvoiceId?: string;
  metadata?: Record<string, unknown>;
}

interface SendEmailResult {
  status: 'sent' | 'failed' | 'skipped';
  providerMessageId?: string;
  error?: string;
}

interface ResendDeliveryResult {
  status: 'sent' | 'failed';
  providerMessageId?: string;
  error?: string;
  attempts: number;
}

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;
const RESEND_MAX_ATTEMPTS = 2;

export function sendWelcomeEmail(input: { userId: string; email: string; userName: string }) {
  return sendTransactionalEmail({
    eventType: 'welcome',
    to: input.email,
    subject: '欢迎使用 Lindyson AI',
    html: `<p>${escapeHtml(input.userName)}，欢迎来到 Lindyson。</p><p>你的账号已创建，可以开始管理素材和创建 AI 视频任务。</p>`,
    text: `${input.userName}，欢迎来到 Lindyson。你的账号已创建，可以开始管理素材和创建 AI 视频任务。`,
    relatedUserId: input.userId,
  });
}

export function sendRegisterCodeEmail(input: {
  email: string;
  userName: string;
  code: string;
  expiresMinutes: number;
  idempotencyKey: string;
}) {
  return sendTransactionalEmail({
    eventType: 'register-code-requested',
    to: input.email,
    subject: 'Lindyson AI 注册邮箱验证码',
    html: `<p>${escapeHtml(input.userName)}，你的 Lindyson 注册验证码是：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px;">${escapeHtml(input.code)}</p><p>验证码将在 ${input.expiresMinutes} 分钟后失效。如果不是你本人操作，请忽略这封邮件。</p>`,
    text: `${input.userName}，你的 Lindyson 注册验证码是：${input.code}。验证码将在 ${input.expiresMinutes} 分钟后失效。如果不是你本人操作，请忽略这封邮件。`,
    idempotencyKey: input.idempotencyKey,
    metadata: { expiresMinutes: input.expiresMinutes },
  });
}

export function sendPasswordResetEmail(input: {
  userId: string;
  email: string;
  userName: string;
  resetUrl: string;
  expiresMinutes: number;
  idempotencyKey: string;
}) {
  const safeResetUrl = escapeHtml(input.resetUrl);

  return sendTransactionalEmail({
    eventType: 'password-reset-requested',
    to: input.email,
    subject: 'Lindyson AI 密码重置链接',
    html: `<p>${escapeHtml(input.userName)}，你正在重置 Lindyson 账号密码。</p><p><a href="${safeResetUrl}">点击这里设置新密码</a></p><p>链接将在 ${input.expiresMinutes} 分钟后失效。如果不是你本人操作，请忽略这封邮件。</p>`,
    text: `${input.userName}，你正在重置 Lindyson 账号密码。请打开链接设置新密码：${input.resetUrl}。链接将在 ${input.expiresMinutes} 分钟后失效。如果不是你本人操作，请忽略这封邮件。`,
    idempotencyKey: input.idempotencyKey,
    relatedUserId: input.userId,
    metadata: { expiresMinutes: input.expiresMinutes },
  });
}

export function sendPaymentSuccessEmail(input: {
  userId: string;
  email: string;
  orderId: string;
  planName: string;
  amount: number;
  credits: number;
  idempotencyKey?: string;
}) {
  return sendTransactionalEmail({
    eventType: 'payment-success',
    to: input.email,
    subject: 'Lindyson AI 订单支付成功',
    html: `<p>你的订单已支付成功。</p><p>套餐：${escapeHtml(input.planName)}</p><p>到账积分：${input.credits}</p>`,
    text: `你的订单已支付成功。套餐：${input.planName}，到账积分：${input.credits}。`,
    idempotencyKey: input.idempotencyKey,
    relatedUserId: input.userId,
    relatedOrderId: input.orderId,
    metadata: { amount: input.amount, credits: input.credits },
  });
}

export function sendSupportTicketEmail(input: {
  userId: string;
  email: string;
  userName: string;
  ticketId: string;
  title: string;
  priority: string;
}) {
  const recipients = env.RESEND_NOTIFY_TO ? [input.email, env.RESEND_NOTIFY_TO] : input.email;
  return sendTransactionalEmail({
    eventType: 'support-ticket-submitted',
    to: recipients,
    subject: `Lindyson AI 工单已提交：${input.title}`,
    html: `<p>${escapeHtml(input.userName)} 提交了工单。</p><p>标题：${escapeHtml(input.title)}</p><p>优先级：${escapeHtml(input.priority)}</p>`,
    text: `${input.userName} 提交了工单：${input.title}，优先级：${input.priority}。`,
    relatedUserId: input.userId,
    relatedTicketId: input.ticketId,
    metadata: { priority: input.priority },
  });
}

export function sendInvoiceRequestedAdminEmail(input: {
  idempotencyKey: string;
  userId: string;
  userName: string;
  accountEmail: string;
  invoiceId: string;
  orderId: string;
  planName: string;
  amount: number;
  invoiceTitle: string;
  taxId: string;
  receiveEmail: string;
  note: string;
}) {
  if (!env.RESEND_NOTIFY_TO) {
    const error = 'RESEND_NOTIFY_TO 未配置，发票申请已进入后台，但无法发送管理员通知。';
    console.error('高优先级：发票申请管理员通知邮箱未配置', {
      invoiceId: input.invoiceId,
      orderId: input.orderId,
      error,
    });
    return Promise.resolve<SendEmailResult>({ status: 'skipped', error });
  }

  const adminUrl = new URL('/admin/invoices', env.APP_BASE_URL).toString();
  const amountLabel = `¥${(input.amount / 100).toFixed(2)}`;
  const safeAdminUrl = escapeHtml(adminUrl);
  return sendTransactionalEmail({
    eventType: 'invoice-requested-admin',
    // receiveEmail 和账号邮箱只作为人工开票资料展示，绝不能作为自动邮件收件人。
    to: env.RESEND_NOTIFY_TO,
    subject: `Lindyson AI 新发票申请：${input.invoiceTitle}`,
    html: [
      '<p>收到一条新的发票申请，请在外部开票系统人工开具并发送。</p>',
      `<p>申请编号：${escapeHtml(input.invoiceId)}</p>`,
      `<p>订单编号：${escapeHtml(input.orderId)}</p>`,
      `<p>用户：${escapeHtml(input.userName)}（${escapeHtml(input.accountEmail)}）</p>`,
      `<p>套餐与金额：${escapeHtml(input.planName)} · ${amountLabel}</p>`,
      `<p>发票抬头：${escapeHtml(input.invoiceTitle)}</p>`,
      `<p>税号：${escapeHtml(input.taxId || '未填写')}</p>`,
      `<p>人工发送邮箱：${escapeHtml(input.receiveEmail)}</p>`,
      `<p>备注：${escapeHtml(input.note || '无')}</p>`,
      `<p><a href="${safeAdminUrl}">打开后台发票管理</a></p>`,
    ].join(''),
    text: [
      '收到一条新的发票申请，请在外部开票系统人工开具并发送。',
      `申请编号：${input.invoiceId}`,
      `订单编号：${input.orderId}`,
      `用户：${input.userName}（${input.accountEmail}）`,
      `套餐与金额：${input.planName} · ${amountLabel}`,
      `发票抬头：${input.invoiceTitle}`,
      `税号：${input.taxId || '未填写'}`,
      `人工发送邮箱：${input.receiveEmail}`,
      `备注：${input.note || '无'}`,
      `后台入口：${adminUrl}`,
    ].join('\n'),
    idempotencyKey: input.idempotencyKey,
    relatedUserId: input.userId,
    relatedOrderId: input.orderId,
    relatedInvoiceId: input.invoiceId,
    metadata: {
      deliveryMode: 'admin-notification-only',
      manualInvoiceDelivery: true,
    },
  });
}

export async function sendTransactionalEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  const blockedTo = env.RESEND_BLOCKED_TO?.trim().toLowerCase();
  const blockedRecipients = blockedTo
    ? recipients.filter(recipient => recipient.trim().toLowerCase() === blockedTo)
    : [];
  const deliverableRecipients = blockedTo
    ? recipients.filter(recipient => recipient.trim().toLowerCase() !== blockedTo)
    : recipients;
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM;

  if (blockedRecipients.length > 0) {
    const error = `收件人已被 RESEND_BLOCKED_TO 全局屏蔽：${env.RESEND_BLOCKED_TO}`;
    await recordEmailEvents(input, blockedRecipients, 'skipped', undefined, error, 0);
  }

  if (deliverableRecipients.length === 0) {
    return {
      status: 'skipped',
      error: '所有收件人均已被全局屏蔽，邮件未发送。',
    };
  }

  if (!apiKey || !from) {
    const error = 'Resend 未配置，邮件已跳过。';
    await recordEmailEvents(input, deliverableRecipients, 'skipped', undefined, error, 0);
    return { status: 'skipped', error };
  }

  const delivery = await sendViaResend(input, deliverableRecipients, apiKey, from);
  if (delivery.status === 'sent') {
    await recordEmailEvents(input, deliverableRecipients, 'sent', delivery.providerMessageId, undefined, delivery.attempts);
    return { status: 'sent', providerMessageId: delivery.providerMessageId };
  }

  await recordEmailEvents(input, deliverableRecipients, 'failed', undefined, delivery.error, delivery.attempts);
  console.error('Resend 邮件发送失败', {
    eventType: input.eventType,
    recipients: deliverableRecipients,
    attempts: delivery.attempts,
    error: delivery.error,
  });
  return { status: 'failed', error: delivery.error };
}

async function sendViaResend(
  input: SendEmailInput,
  recipients: string[],
  apiKey: string,
  from: string,
): Promise<ResendDeliveryResult> {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  let lastError = 'Resend 邮件发送失败。';

  for (let attempt = 1; attempt <= RESEND_MAX_ATTEMPTS; attempt += 1) {
    const result = await sendResendAttempt(input, recipients, idempotencyKey, apiKey, from);
    if (result.status === 'sent') {
      return {
        status: 'sent',
        providerMessageId: result.providerMessageId,
        attempts: attempt,
      };
    }

    lastError = result.error;
    if (!result.retryable || attempt >= RESEND_MAX_ATTEMPTS) {
      return {
        status: 'failed',
        error: lastError,
        attempts: attempt,
      };
    }
  }

  return {
    status: 'failed',
    error: lastError,
    attempts: RESEND_MAX_ATTEMPTS,
  };
}

async function sendResendAttempt(
  input: SendEmailInput,
  recipients: string[],
  idempotencyKey: string,
  apiKey: string,
  from: string,
): Promise<{ status: 'sent'; providerMessageId?: string } | { status: 'failed'; error: string; retryable: boolean }> {
  try {
    const response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      return {
        status: 'failed',
        error: summarizeResendError(payload, `Resend HTTP ${response.status}`),
        retryable: response.status >= 500,
      };
    }

    return {
      status: 'sent',
      providerMessageId: extractString(payload, ['id', 'data.id']),
    };
  } catch (error) {
    return {
      status: 'failed',
      error: summarizeUnknownError(error),
      retryable: true,
    };
  }
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};

  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : { message: text };
  } catch {
    return { message: text };
  }
}

function summarizeResendError(payload: Record<string, unknown>, fallback: string) {
  const name = extractString(payload, ['name']);
  const message = extractString(payload, ['message']) ?? fallback;
  return trimError(name ? `${name}: ${message}` : message);
}

function summarizeUnknownError(error: unknown) {
  if (error instanceof Error) return trimError(error.message);
  return 'Resend 请求失败。';
}

async function recordEmailEvents(
  input: SendEmailInput,
  recipients: string[],
  status: 'sent' | 'failed' | 'skipped',
  providerMessageId?: string,
  error?: string,
  resendAttempts?: number,
) {
  try {
    for (const recipient of recipients) {
      const metadata = {
        ...(input.metadata ?? {}),
        resendAttempts,
      };
      await pool.query(
        `INSERT INTO notification_events (
           channel, event_type, recipient, subject, status, provider,
           provider_message_id, error, related_user_id, related_order_id,
           related_ticket_id, related_invoice_id, metadata
         )
         VALUES ('email', $1, $2, $3, $4, 'resend', $5, $6, $7, $8, $9, $10, $11)`,
        [
          input.eventType,
          recipient,
          input.subject,
          status,
          providerMessageId ?? null,
          error ?? null,
          input.relatedUserId ?? null,
          input.relatedOrderId ?? null,
          input.relatedTicketId ?? null,
          input.relatedInvoiceId ?? null,
          JSON.stringify(metadata),
        ],
      );
    }
  } catch (eventError) {
    console.error('邮件事件记录失败', eventError);
  }
}

function extractString(payload: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    const value = path.split('.').reduce<unknown>((current, key) => {
      if (!isRecord(current)) return undefined;
      return current[key];
    }, payload);
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimError(value: string) {
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
