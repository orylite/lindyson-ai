import type { FastifyInstance } from 'fastify';
import { endpointContracts } from '@lindyson/api-contracts';
import { requireAuth } from '../auth/session.js';
import { pool, withReadOnlyRepeatableRead, withTransaction } from '../db/pool.js';
import {
  materializeExactCursorPageQuery,
  parseExactCursorPageRequest,
  readUserPaginationVersion,
} from '../domain/cursorPagination.js';
import { getInvoiceById } from '../domain/invoices.js';
import { scheduleInvoiceRequestedAdminNotification } from '../domain/notificationOutbox.js';
import { getUserTicket, listTicketMessages, listUserTickets, mapTicketMessage } from '../domain/tickets.js';
import { sendSupportTicketEmail } from '../notifications/emailService.js';

export async function registerSupportRoutes(app: FastifyInstance) {
  app.get('/api/support/summary', async request => {
    const user = await requireAuth(request);
    const result = await pool.query<{
      unread_tickets: number | string;
      open_tickets: number | string;
      as_of: Date | string;
    }>(
      `SELECT
         count(*) FILTER (
           WHERE EXISTS (
             SELECT 1
             FROM ticket_messages message
             WHERE message.ticket_id = ticket.id
               AND message.author_role = 'admin'
               AND (ticket.user_read_at IS NULL OR message.created_at > ticket.user_read_at)
           )
         )::integer AS unread_tickets,
         count(*) FILTER (WHERE ticket.status <> 'resolved')::integer AS open_tickets,
         now() AS as_of
       FROM tickets ticket
       WHERE ticket.user_id = $1`,
      [user.id],
    );
    const summary = result.rows[0];
    return {
      unreadTickets: Number(summary?.unread_tickets ?? 0),
      openTickets: Number(summary?.open_tickets ?? 0),
      asOf: new Date(summary?.as_of ?? Date.now()).toISOString(),
    };
  });

  app.get('/api/support/tickets', async request => {
    const user = await requireAuth(request);
    const rawQuery = endpointContracts.supportTickets.query.parse(request.query);
    const pageRequest = parseExactCursorPageRequest({
        ...rawQuery,
        resource: 'user-tickets',
        filters: {
          userId: user.id,
          status: rawQuery.status ?? null,
          priority: rawQuery.priority ?? null,
          search: rawQuery.search?.toLowerCase() ?? null,
        },
        defaultLimit: 20,
        maxLimit: 50,
      });
    return withReadOnlyRepeatableRead(async client => {
      const version = await readUserPaginationVersion(client, user.id, 'tickets');
      const totalItems = pageRequest.snapshot
        ? undefined
        : (await client.query<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM tickets t
             WHERE t.user_id = $1
               AND ($2::text IS NULL OR t.status = $2)
               AND ($3::text IS NULL OR t.priority = $3)
               AND ($4::text IS NULL OR (
                 t.id::text ILIKE '%' || $4 || '%'
                 OR t.title ILIKE '%' || $4 || '%'
                 OR t.last_message ILIKE '%' || $4 || '%'
               ))`,
            [user.id, rawQuery.status ?? null, rawQuery.priority ?? null, rawQuery.search || null],
          )).rows[0]?.count;
      const query = {
        ...materializeExactCursorPageQuery(pageRequest, {
          resourceVersion: version.version,
          snapshotAt: version.snapshotAt,
          totalItems,
        }),
        status: rawQuery.status,
        priority: rawQuery.priority,
        search: rawQuery.search,
      };
      return listUserTickets(client, user.id, query);
    });
  });

  app.post('/api/support/tickets', async request => {
    const user = await requireAuth(request);
    const payload = endpointContracts.supportTicketCreate.body.parse(request.body);
    const ticket = await withTransaction(async client => {
      const result = await client.query(
        `INSERT INTO tickets (user_id, title, priority, last_message, user_read_at)
         VALUES ($1, $2, $3, $4, now())
         RETURNING *`,
        [user.id, payload.title, payload.priority, payload.message],
      );
      const created = result.rows[0];
      await client.query(
        `INSERT INTO ticket_messages (ticket_id, author_role, author_user_id, body)
         VALUES ($1, 'user', $2, $3)`,
        [created.id, user.id, payload.message],
      );

      return getUserTicket(client, created.id, user.id);
    });

    if (!ticket) throw Object.assign(new Error('工单创建失败'), { statusCode: 500 });

    void sendSupportTicketEmail({
      userId: user.id,
      email: user.email,
      userName: user.email,
      ticketId: ticket.id,
      title: payload.title,
      priority: payload.priority,
    });

    return { ticket };
  });

  app.get('/api/support/tickets/:id/messages', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.supportTicketMessages.params.parse(request.params);
    const ticket = await getUserTicket(pool, id, user.id);
    if (!ticket) throw Object.assign(new Error('工单不存在'), { statusCode: 404 });

    return { items: await listTicketMessages(pool, id, 'user') };
  });

  app.post('/api/support/tickets/:id/messages', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.supportTicketMessageCreate.params.parse(request.params);
    const payload = endpointContracts.supportTicketMessageCreate.body.parse(request.body);
    const result = await withTransaction(async client => {
      const ticket = await client.query(
        `SELECT id, status
         FROM tickets
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [id, user.id],
      );
      if (!ticket.rowCount) throw Object.assign(new Error('工单不存在'), { statusCode: 404 });
      if (ticket.rows[0].status === 'resolved') throw Object.assign(new Error('工单已关闭，不能继续回复'), { statusCode: 409 });

      const message = await client.query(
        `INSERT INTO ticket_messages (ticket_id, author_role, author_user_id, body)
         VALUES ($1, 'user', $2, $3)
         RETURNING *`,
        [id, user.id, payload.message],
      );
      await client.query(
        `UPDATE tickets
         SET status = 'open',
             last_message = $2,
             user_read_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [id, payload.message],
      );
      const summary = await getUserTicket(client, id, user.id);
      return {
        message: mapTicketMessage(
          { ...message.rows[0], author_email: user.email, author_name: user.email },
          'user',
        ),
        ticket: summary,
      };
    });

    return result;
  });

  app.post('/api/support/tickets/:id/read', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.supportTicketRead.params.parse(request.params);
    const result = await pool.query(
      `UPDATE tickets
       SET user_read_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [id, user.id],
    );
    if (!result.rowCount) throw Object.assign(new Error('工单不存在'), { statusCode: 404 });

    return { ticket: await getUserTicket(pool, id, user.id) };
  });

  app.post('/api/invoices', async request => {
    const user = await requireAuth(request);
    const payload = endpointContracts.invoiceCreate.body.parse(request.body);
    const invoice = await withTransaction(async client => {
      const order = await client.query(
        `SELECT id, status, invoice_status
         FROM orders
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [payload.orderId, user.id],
      );
      if (!order.rowCount) throw Object.assign(new Error('订单不存在'), { statusCode: 404 });
      if (order.rows[0].status !== 'paid') throw Object.assign(new Error('只有已支付订单可以申请发票'), { statusCode: 400 });

      const existing = await client.query('SELECT id FROM invoice_requests WHERE order_id = $1', [payload.orderId]);
      if (existing.rowCount) throw Object.assign(new Error('该订单已提交过发票申请'), { statusCode: 409 });

      const result = await client.query(
        `INSERT INTO invoice_requests (
           order_id, user_id, invoice_title, tax_id, receive_email, note
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [payload.orderId, user.id, payload.invoiceTitle, payload.taxId, payload.receiveEmail, payload.note],
      );

      await client.query('UPDATE orders SET invoice_status = $2 WHERE id = $1', [payload.orderId, 'unissued']);
      const completeInvoice = await getInvoiceById(client, result.rows[0].id);
      if (!completeInvoice) throw Object.assign(new Error('发票申请创建失败'), { statusCode: 500 });
      await scheduleInvoiceRequestedAdminNotification(client, {
        invoiceId: completeInvoice.id,
        orderId: completeInvoice.orderId,
        userId: completeInvoice.userId,
        userName: completeInvoice.userName,
        accountEmail: completeInvoice.email,
        planName: completeInvoice.planName,
        amount: completeInvoice.amount,
        invoiceTitle: completeInvoice.invoiceTitle,
        taxId: completeInvoice.taxId,
        receiveEmail: completeInvoice.receiveEmail,
        note: completeInvoice.note,
      });
      return completeInvoice;
    });

    return { invoice };
  });
}
