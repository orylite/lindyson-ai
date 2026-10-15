import { z } from 'zod';
import type { DbClient } from '../db/pool.js';
import { pool } from '../db/pool.js';
import { randomUUID } from 'node:crypto';
import { sendInvoiceRequestedAdminEmail, sendPaymentSuccessEmail } from '../notifications/emailService.js';

const INVOICE_NOTIFICATION_MAX_ATTEMPTS = 8;
const INVOICE_NOTIFICATION_LEASE_MINUTES = 2;
const INVOICE_NOTIFICATION_MAX_BACKOFF_SECONDS = 6 * 60 * 60;

interface InvoiceNotificationOutboxRow {
  id: string;
  event_key: string;
  invoice_id: string;
  attempts: number;
  payload: unknown;
}

const invoiceNotificationPayloadSchema = z.object({
  invoiceId: z.string().uuid(),
  orderId: z.string().uuid(),
  userId: z.string().min(1),
  userName: z.string(),
  accountEmail: z.string().email(),
  planName: z.string(),
  amount: z.number().int().nonnegative(),
  invoiceTitle: z.string(),
  taxId: z.string(),
  receiveEmail: z.string().email(),
  note: z.string(),
}).strict();

export type InvoiceRequestedAdminNotificationPayload = z.infer<typeof invoiceNotificationPayloadSchema>;

export interface InvoiceNotificationSweepResult {
  scanned: number;
  completed: number;
  skipped: number;
  retried: number;
  failed: number;
}

const paymentSuccessPayloadSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  orderId: z.string().uuid(),
  planName: z.string().min(1),
  amount: z.number().int().nonnegative(),
  credits: z.number().int().nonnegative(),
}).strict();

interface PaymentNotificationOutboxRow {
  id: string;
  event_key: string;
  attempts: number;
  lease_token: string;
  payload: unknown;
}

export async function processPaymentNotificationOutbox(limit = 20): Promise<InvoiceNotificationSweepResult> {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const summary: InvoiceNotificationSweepResult = {
    scanned: 0, completed: 0, skipped: 0, retried: 0, failed: 0,
  };
  for (let index = 0; index < safeLimit; index += 1) {
    const item = await claimNextPaymentNotification();
    if (!item) break;
    summary.scanned += 1;
    let delivery: Awaited<ReturnType<typeof sendPaymentSuccessEmail>>;
    try {
      const payload = paymentSuccessPayloadSchema.parse(item.payload);
      delivery = await sendPaymentSuccessEmail({ ...payload, idempotencyKey: item.event_key });
    } catch (error) {
      delivery = { status: 'failed', error: summarizeError(error) };
    }
    if (delivery.status === 'sent' || delivery.status === 'skipped') {
      const updated = await pool.query(
        `UPDATE payment_notification_outbox
         SET status = 'completed', lease_token = NULL, lease_until = NULL,
             last_error = $3, provider_message_id = $4,
             completed_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'processing' AND lease_token = $2::uuid`,
        [item.id, item.lease_token, delivery.error ?? null, delivery.providerMessageId ?? null],
      );
      if (!updated.rowCount) continue;
      if (delivery.status === 'skipped') summary.skipped += 1;
      else summary.completed += 1;
      continue;
    }
    const error = delivery.error ?? '支付成功邮件发送失败。';
    const terminal = item.attempts >= INVOICE_NOTIFICATION_MAX_ATTEMPTS;
    const updated = await pool.query(
      `UPDATE payment_notification_outbox
       SET status = $3,
           lease_token = NULL, lease_until = NULL,
           last_error = $4,
           available_at = CASE WHEN $3 = 'pending'
             THEN now() + ($5 * interval '1 second') ELSE available_at END,
           updated_at = now()
       WHERE id = $1 AND status = 'processing' AND lease_token = $2::uuid`,
      [
        item.id,
        item.lease_token,
        terminal ? 'failed' : 'pending',
        error,
        getRetryBackoffSeconds(item.attempts),
      ],
    );
    if (!updated.rowCount) continue;
    if (terminal) summary.failed += 1;
    else summary.retried += 1;
  }
  return summary;
}

async function claimNextPaymentNotification() {
  const leaseToken = randomUUID();
  const claimed = await pool.query<PaymentNotificationOutboxRow>(
    `WITH next_item AS (
       SELECT id FROM payment_notification_outbox
       WHERE (status = 'pending' AND available_at <= now())
          OR (status = 'processing' AND lease_until <= now())
       ORDER BY available_at, created_at
       FOR UPDATE SKIP LOCKED LIMIT 1
     )
     UPDATE payment_notification_outbox outbox
     SET status = 'processing', attempts = attempts + 1,
         lease_token = $1, lease_until = now() + interval '2 minutes',
         updated_at = now()
     FROM next_item
     WHERE outbox.id = next_item.id
     RETURNING outbox.id, outbox.event_key, outbox.attempts,
               outbox.lease_token::text AS lease_token, outbox.payload`,
    [leaseToken],
  );
  return claimed.rows[0] ?? null;
}

export async function scheduleInvoiceRequestedAdminNotification(
  client: DbClient,
  payload: InvoiceRequestedAdminNotificationPayload,
) {
  const stablePayload = invoiceNotificationPayloadSchema.parse(payload);
  const eventKey = `invoice-requested-admin:${stablePayload.invoiceId}`;
  await client.query(
    `INSERT INTO invoice_notification_outbox (event_key, invoice_id, payload)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (event_key) DO NOTHING`,
    [eventKey, stablePayload.invoiceId, JSON.stringify(stablePayload)],
  );
  return eventKey;
}

export async function processInvoiceNotificationOutbox(
  limit = 20,
): Promise<InvoiceNotificationSweepResult> {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const result: InvoiceNotificationSweepResult = {
    scanned: 0,
    completed: 0,
    skipped: 0,
    retried: 0,
    failed: 0,
  };

  for (let index = 0; index < safeLimit; index += 1) {
    const item = await claimNextInvoiceNotification();
    if (!item) break;
    result.scanned += 1;

    let delivery: Awaited<ReturnType<typeof sendInvoiceRequestedAdminEmail>>;
    try {
      const payload = invoiceNotificationPayloadSchema.parse(item.payload);
      delivery = await sendInvoiceRequestedAdminEmail({
        idempotencyKey: item.event_key,
        ...payload,
      });
    } catch (error) {
      delivery = {
        status: 'failed',
        error: summarizeError(error),
      };
    }

    if (delivery.status === 'sent' || delivery.status === 'skipped') {
      await pool.query(
        `UPDATE invoice_notification_outbox
         SET status = 'completed',
             lease_until = NULL,
             last_error = $2,
             provider_message_id = $3,
             completed_at = now(),
             updated_at = now()
         WHERE id = $1 AND status = 'processing'`,
        [item.id, delivery.error ?? null, delivery.providerMessageId ?? null],
      );
      if (delivery.status === 'skipped') {
        result.skipped += 1;
        logHighPriorityInvoiceNotificationFailure(item, delivery.error ?? '邮件服务未配置，管理员通知已跳过。');
      } else {
        result.completed += 1;
      }
      continue;
    }

    const error = delivery.error ?? '管理员发票通知发送失败。';
    if (item.attempts >= INVOICE_NOTIFICATION_MAX_ATTEMPTS) {
      await pool.query(
        `UPDATE invoice_notification_outbox
         SET status = 'failed',
             lease_until = NULL,
             last_error = $2,
             updated_at = now()
         WHERE id = $1 AND status = 'processing'`,
        [item.id, error],
      );
      result.failed += 1;
      logHighPriorityInvoiceNotificationFailure(item, error);
      continue;
    }

    const retryAfterSeconds = getRetryBackoffSeconds(item.attempts);
    await pool.query(
      `UPDATE invoice_notification_outbox
       SET status = 'pending',
           lease_until = NULL,
           last_error = $2,
           available_at = now() + ($3 * interval '1 second'),
           updated_at = now()
       WHERE id = $1 AND status = 'processing'`,
      [item.id, error, retryAfterSeconds],
    );
    result.retried += 1;
  }

  return result;
}

async function claimNextInvoiceNotification() {
  const claimed = await pool.query<InvoiceNotificationOutboxRow>(
    `WITH next_item AS (
       SELECT id
       FROM invoice_notification_outbox
       WHERE (
         status = 'pending' AND available_at <= now()
       ) OR (
         status = 'processing' AND lease_until <= now()
       )
       ORDER BY available_at ASC, created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     ), claimed AS (
       UPDATE invoice_notification_outbox outbox
       SET status = 'processing',
           attempts = outbox.attempts + 1,
           lease_until = now() + ($1 * interval '1 minute'),
           updated_at = now()
       FROM next_item
       WHERE outbox.id = next_item.id
       RETURNING outbox.*
     )
     SELECT claimed.id,
            claimed.event_key,
            claimed.invoice_id,
            claimed.attempts,
            claimed.payload
     FROM claimed`,
    [INVOICE_NOTIFICATION_LEASE_MINUTES],
  );
  return claimed.rows[0] ?? null;
}

function getRetryBackoffSeconds(attempts: number) {
  const exponentialSeconds = 5 * 60 * (2 ** Math.max(0, attempts - 1));
  return Math.min(exponentialSeconds, INVOICE_NOTIFICATION_MAX_BACKOFF_SECONDS);
}

function summarizeError(error: unknown) {
  const message = error instanceof Error ? error.message : '管理员发票通知发送失败。';
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}

function logHighPriorityInvoiceNotificationFailure(
  item: Pick<InvoiceNotificationOutboxRow, 'id' | 'event_key' | 'invoice_id' | 'attempts'>,
  error: string,
) {
  console.error('高优先级：发票申请管理员邮件未送达', {
    outboxId: item.id,
    eventKey: item.event_key,
    invoiceId: item.invoice_id,
    attempts: item.attempts,
    error,
  });
}
