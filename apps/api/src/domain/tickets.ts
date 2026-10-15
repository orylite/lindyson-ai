import type { DbClient } from '../db/pool.js';
import {
  fourWayCursorCondition,
  fourWayCursorValues,
  fourWayPageOrderBy,
  exactPageMetadataColumns,
  createExactCursorPage,
  type ExactCursorPageQuery,
  type ExactPageMetadata,
} from './cursorPagination.js';
import { toInt, toIsoDateTime } from './serialization.js';

export type TicketViewer = 'user' | 'admin';

interface TicketSummaryRow {
  id: string;
  user_id: string;
  title: string;
  user_name: string;
  email: string;
  priority: string;
  status: string;
  assignee: string;
  created_at: Date | string;
  updated_at: Date | string;
  sla_hours: number | string | null;
  last_message: string;
  unread_count: number | string;
  message_count: number | string;
  last_message_author?: string | null;
  last_message_at?: Date | string | null;
  internal_note?: string | null;
}

interface TicketMessageRow {
  id: string;
  ticket_id: string;
  author_role: 'user' | 'admin';
  author_name?: string | null;
  author_email?: string | null;
  body: string;
  created_at: Date | string;
}

export function mapTicket(row: TicketSummaryRow, viewer: TicketViewer = 'admin') {
  const lastMessageAt = row.last_message_at ?? row.updated_at;

  const ticket = {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    userName: row.user_name,
    email: row.email,
    priority: row.priority,
    status: row.status,
    assignee: row.assignee,
    createdAt: toIsoDateTime(row.created_at),
    updatedAt: toIsoDateTime(row.updated_at),
    slaHours: toInt(row.sla_hours),
    lastMessage: row.last_message,
    unreadCount: toInt(row.unread_count),
    messageCount: toInt(row.message_count),
    lastMessageAuthor: row.last_message_author ?? 'user',
    lastMessageAt: toIsoDateTime(lastMessageAt),
  };

  return viewer === 'admin'
    ? { ...ticket, internalNote: row.internal_note }
    : ticket;
}

export function mapTicketMessage(row: TicketMessageRow, viewer: TicketViewer = 'admin') {
  const message = {
    id: row.id,
    ticketId: row.ticket_id,
    authorRole: row.author_role,
    authorName: row.author_name ?? row.author_email ?? (row.author_role === 'admin' ? 'Lindyson Support' : '用户'),
    body: row.body,
    createdAt: toIsoDateTime(row.created_at),
  };
  return viewer === 'admin'
    ? { ...message, authorEmail: row.author_email ?? '' }
    : message;
}

export async function listUserTickets(client: DbClient, userId: string, query: ExactCursorPageQuery & {
  search?: string;
  status?: string;
  priority?: string;
}) {
  const result = await client.query<TicketSummaryRow & ExactPageMetadata>(
    ticketPageSql(
      'user',
      `WHERE t.user_id = $1
         AND ${fourWayCursorCondition(query, 't.updated_at', 't.id', 2, 3)}
         AND ($4::text IS NULL OR t.status = $4)
         AND ($5::text IS NULL OR t.priority = $5)
         AND ($6::text IS NULL OR (
           t.id::text ILIKE '%' || $6 || '%'
           OR t.title ILIKE '%' || $6 || '%'
           OR t.last_message ILIKE '%' || $6 || '%'
         ))`,
      fourWayPageOrderBy(query, 't.updated_at', 't.id'),
      '$7',
      exactPageMetadataColumns('t.updated_at'),
    ),
    [
      userId,
      ...fourWayCursorValues(query),
      query.status ?? null,
      query.priority ?? null,
      query.search || null,
      query.limit + 1,
    ],
  );

  return createExactCursorPage({
    rows: result.rows,
    query,
    getId: row => row.id,
    map: row => mapTicket(row, 'user'),
  });
}

interface AdminTicketPageFilters {
  search?: string;
  status?: string;
  priority?: string;
}

export async function countAdminTickets(client: DbClient, query: AdminTicketPageFilters) {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM tickets t
     JOIN users u ON u.id = t.user_id
     WHERE ($1::text IS NULL OR t.status = $1)
       AND ($2::text IS NULL OR t.priority = $2)
       AND ($3::text IS NULL OR (
         t.id::text ILIKE '%' || $3 || '%'
         OR t.title ILIKE '%' || $3 || '%'
         OR u.user_name ILIKE '%' || $3 || '%'
         OR u.email::text ILIKE '%' || $3 || '%'
       ))`,
    [query.status ?? null, query.priority ?? null, query.search || null],
  );
  return result.rows[0]?.count ?? '0';
}

export async function listAdminTicketsPage(client: DbClient, query: ExactCursorPageQuery & AdminTicketPageFilters) {
  const result = await client.query<TicketSummaryRow & ExactPageMetadata>(
    ticketPageSql(
      'admin',
      `WHERE ${fourWayCursorCondition(query, 't.updated_at', 't.id')}
         AND ($3::text IS NULL OR t.status = $3)
         AND ($4::text IS NULL OR t.priority = $4)
         AND ($5::text IS NULL OR (
           t.id::text ILIKE '%' || $5 || '%'
           OR t.title ILIKE '%' || $5 || '%'
           OR u.user_name ILIKE '%' || $5 || '%'
           OR u.email::text ILIKE '%' || $5 || '%'
         ))`,
      fourWayPageOrderBy(query, 't.updated_at', 't.id'),
      '$6',
      exactPageMetadataColumns('t.updated_at'),
    ),
    [...fourWayCursorValues(query), query.status ?? null, query.priority ?? null, query.search || null, query.limit + 1],
  );

  return createExactCursorPage({
    rows: result.rows,
    query,
    getId: row => row.id,
    map: row => mapTicket(row, 'admin'),
  });
}

export async function getUserTicket(client: DbClient, ticketId: string, userId: string) {
  const result = await client.query<TicketSummaryRow>(ticketSummarySql('user', 'WHERE t.id = $1 AND t.user_id = $2'), [ticketId, userId]);
  return result.rows[0] ? mapTicket(result.rows[0], 'user') : null;
}

export async function getAdminTicket(client: DbClient, ticketId: string) {
  const result = await client.query<TicketSummaryRow>(ticketSummarySql('admin', 'WHERE t.id = $1'), [ticketId]);
  return result.rows[0] ? mapTicket(result.rows[0]) : null;
}

export async function listTicketMessages(client: DbClient, ticketId: string, viewer: TicketViewer = 'admin') {
  const result = await client.query<TicketMessageRow>(
    `SELECT tm.*, u.email AS author_email, u.user_name AS author_name
     FROM ticket_messages tm
     LEFT JOIN users u ON u.id = tm.author_user_id
     WHERE tm.ticket_id = $1
     ORDER BY tm.created_at ASC, tm.id ASC`,
    [ticketId],
  );
  return result.rows.map(row => mapTicketMessage(row, viewer));
}

function ticketSummarySql(viewer: TicketViewer, whereClause = '', orderBy = 't.updated_at DESC, t.id DESC') {
  const unreadRole = viewer === 'user' ? 'admin' : 'user';
  const readColumn = viewer === 'user' ? 't.user_read_at' : 't.admin_read_at';

  return `
    SELECT t.*, u.email, u.user_name,
           COUNT(tm.id)::int AS message_count,
           MAX(tm.created_at) AS last_message_at,
           COALESCE(
             (ARRAY_AGG(tm.author_role ORDER BY tm.created_at DESC, tm.id DESC) FILTER (WHERE tm.id IS NOT NULL))[1],
             'user'
           ) AS last_message_author,
           COUNT(tm.id) FILTER (
             WHERE tm.author_role = '${unreadRole}'
               AND (${readColumn} IS NULL OR tm.created_at > ${readColumn})
           )::int AS unread_count
    FROM tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN ticket_messages tm ON tm.ticket_id = t.id
    ${whereClause}
    GROUP BY t.id, u.id
    ORDER BY ${orderBy}`;
}

/**
 * 列表必须先用键集条件选出当前页，再读取消息统计。若先 JOIN/聚合全部消息再 LIMIT，
 * 首页查询会随着历史工单和消息数量线性变慢，失去分页隔离历史数据的意义。
 */
function ticketPageSql(
  viewer: TicketViewer,
  whereClause: string,
  orderBy: string,
  limitPlaceholder: string,
  paginationMetadataColumns: string,
) {
  const unreadRole = viewer === 'user' ? 'admin' : 'user';
  const readColumn = viewer === 'user' ? 't.user_read_at' : 't.admin_read_at';

  return `
    WITH paged_tickets AS MATERIALIZED (
      SELECT t.*,
             ${paginationMetadataColumns}
      FROM tickets t
      JOIN users u ON u.id = t.user_id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ${limitPlaceholder}
    )
    SELECT t.*, u.email, u.user_name,
           COALESCE(message_stats.message_count, 0)::int AS message_count,
           message_stats.last_message_at,
           COALESCE(last_message.last_message_author, 'user') AS last_message_author,
           COALESCE(message_stats.unread_count, 0)::int AS unread_count
    FROM paged_tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS message_count,
             MAX(tm.created_at) AS last_message_at,
             COUNT(*) FILTER (
               WHERE tm.author_role = '${unreadRole}'
                 AND (${readColumn} IS NULL OR tm.created_at > ${readColumn})
             )::int AS unread_count
      FROM ticket_messages tm
      WHERE tm.ticket_id = t.id
    ) message_stats ON true
    LEFT JOIN LATERAL (
      SELECT tm.author_role AS last_message_author
      FROM ticket_messages tm
      WHERE tm.ticket_id = t.id
      ORDER BY tm.created_at DESC, tm.id DESC
      LIMIT 1
    ) last_message ON true
    ORDER BY ${orderBy}`;
}
