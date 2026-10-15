import type { UserTicket } from '../data/admin';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string) {
  return EMAIL_PATTERN.test(value.trim());
}

export function getTicketUnreadTotal(tickets: UserTicket[]) {
  return tickets.reduce((total, ticket) => total + Math.max(0, ticket.unreadCount), 0);
}

export function sortTicketsByRecentActivity(tickets: UserTicket[]) {
  return [...tickets].sort((a, b) => parseTicketTime(b.lastMessageAt || b.updatedAt) - parseTicketTime(a.lastMessageAt || a.updatedAt));
}

function parseTicketTime(value: string) {
  const parsed = new Date(value.replace(' ', 'T')).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
