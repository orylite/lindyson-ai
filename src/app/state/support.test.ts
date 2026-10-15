import { describe,expect,it } from 'vitest';
import type { AdminTicket } from '../data/admin';
import { getTicketUnreadTotal,isValidEmail,sortTicketsByRecentActivity } from './support';

describe('客服联系方式校验', () => {
  it('接受基础邮箱格式', () => {
    expect(isValidEmail('pro.user@lindyson.ai')).toBe(true);
  });

  it('拒绝缺少域名或 @ 的邮箱', () => {
    expect(isValidEmail('pro.user')).toBe(false);
    expect(isValidEmail('pro.user@')).toBe(false);
  });

  it('汇总工单未读并按最近消息排序', () => {
    const tickets: AdminTicket[] = [
      ticket({ id: 'old', unreadCount: 0, lastMessageAt: '2026-07-01 10:00' }),
      ticket({ id: 'new', unreadCount: 2, lastMessageAt: '2026-07-01 11:00' }),
    ];

    expect(getTicketUnreadTotal(tickets)).toBe(2);
    expect(sortTicketsByRecentActivity(tickets).map(item => item.id)).toEqual(['new', 'old']);
  });
});

function ticket(overrides: Partial<AdminTicket>): AdminTicket {
  return {
    id: 'ticket-1',
    title: '生成问题',
    userName: 'Lindyson Admin',
    email: 'admin@lindyson.com',
    priority: 'medium',
    status: 'open',
    assignee: 'unassigned',
    createdAt: '2026-07-01 09:00',
    updatedAt: '2026-07-01 09:00',
    slaHours: 24,
    lastMessage: '请协助确认',
    internalNote: '',
    unreadCount: 0,
    messageCount: 1,
    lastMessageAuthor: 'user',
    lastMessageAt: '2026-07-01 09:00',
    ...overrides,
  };
}
