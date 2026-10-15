import type { DbClient } from '../db/pool.js';
import { toIsoDateTime,toInt } from './serialization.js';

export interface InvoiceRow {
  id: string;
  order_id: string;
  user_id: string;
  user_name: string;
  email: string;
  plan_name: string;
  amount: unknown;
  invoice_title: string;
  tax_id: string;
  receive_email: string;
  status: 'unissued' | 'issued';
  note: string;
  requested_at: Date | string;
  issued_at: Date | string | null;
}

export async function getInvoiceById(client: DbClient, invoiceId: string) {
  const result = await client.query<InvoiceRow>(
    `SELECT ir.*, u.email, u.user_name, o.plan_name, o.amount
     FROM invoice_requests ir
     JOIN users u ON u.id = ir.user_id
     JOIN orders o ON o.id = ir.order_id
     WHERE ir.id = $1
     LIMIT 1`,
    [invoiceId],
  );
  return result.rows[0] ? mapInvoice(result.rows[0]) : null;
}

export function mapInvoice(row: InvoiceRow) {
  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    userName: row.user_name,
    email: row.email,
    planName: row.plan_name,
    amount: toInt(row.amount),
    invoiceTitle: row.invoice_title,
    taxId: row.tax_id,
    receiveEmail: row.receive_email,
    status: row.status,
    note: row.note,
    requestedAt: toIsoDateTime(row.requested_at),
    issuedAt: toIsoDateTime(row.issued_at),
  };
}
