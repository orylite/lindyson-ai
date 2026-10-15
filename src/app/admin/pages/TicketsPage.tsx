import { useEffect,useState } from 'react';
import { toast } from 'sonner';
import {
  type AdminTicket,
  type TicketMessage
} from '../../data/admin';
import { Badge,Button } from '../../ui';

import {
  AdminDataTable,
  PageShell,
  SearchFilter,
  SelectFilter,
  Stack,
  TicketConversation,
  TicketDetail,
  statusBadge
} from '../components/AdminPageShared';
import type { AdminListControls,ConfirmState,DetailState } from '../types';

export function AdminTicketsPage({ tickets, control, onTicketStatusChange, onTicketMessagesLoad, onTicketRead, onTicketReply, setDetail, setConfirm }: {
  tickets: AdminTicket[];
  control: AdminListControls['tickets'];
  onTicketStatusChange: (ticket: AdminTicket, status: AdminTicket['status']) => Promise<void>;
  onTicketMessagesLoad: (ticketId: string) => Promise<TicketMessage[]>;
  onTicketRead: (ticketId: string) => Promise<void>;
  onTicketReply: (ticketId: string, message: string) => Promise<TicketMessage>;
  setDetail: (detail: DetailState) => void;
  setConfirm: (confirm: ConfirmState) => void;
}) {
  const [search, setSearch] = useState(control.filters.search ?? '');
  const [status, setStatus] = useState<'all' | AdminTicket['status']>(control.filters.status ?? 'all');
  useEffect(() => {
    const timer = window.setTimeout(() => control.setFilters({
      search: search.trim() || undefined,
      status: status === 'all' ? undefined : status,
      priority: control.filters.priority,
    }), 300);
    return () => window.clearTimeout(timer);
  }, [control.filters.priority, control.setFilters, search, status]);

  const resolveTicket = (ticket: AdminTicket) => {
    setConfirm({
      title: '确认关闭工单？',
      description: `${ticket.id} 将标记为已解决。`,
      confirmLabel: '关闭工单',
      onConfirm: async () => {
        try {
          await onTicketStatusChange(ticket, 'resolved');
          toast.success('工单已关闭');
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '工单状态更新失败');
        }
      },
    });
  };

  const openConversation = (ticket: AdminTicket) => {
    setDetail({
      title: ticket.title,
      subtitle: ticket.id,
      wide: true,
      bodyMode: 'fixed-content',
      content: (
        <TicketConversation
          key={ticket.id}
          ticket={ticket}
          onMessagesLoad={onTicketMessagesLoad}
          onRead={onTicketRead}
          onReply={onTicketReply}
          onStatusChange={onTicketStatusChange}
          setConfirm={setConfirm}
        />
      ),
    });
  };

  return (
    <PageShell title="工单管理" subtitle="仅处理提交问题类工单，发票申请统一进入发票管理">
      <SearchFilter search={search} onSearch={setSearch} placeholder="搜索工单、用户或标题...">
        <SelectFilter value={status} onChange={setStatus} label="状态" options={[
          { value: 'all', label: '全部工单' },
          { value: 'open', label: '待响应' },
          { value: 'pending', label: '处理中' },
          { value: 'resolved', label: '已解决' },
        ]} />
      </SearchFilter>
      <AdminDataTable
        items={tickets}
        paginationLabel="工单分页导航"
        gridTemplate="1fr 1fr .6fr .7fr .55fr .8fr .8fr 190px"
        columns={[
          { header: '工单', render: ticket => <Stack title={`${ticket.id} · ${ticket.title}`} subtitle={ticket.lastMessage} /> },
          { header: '用户', render: ticket => <Stack title={ticket.userName} subtitle={ticket.email} /> },
          { header: '优先级', render: ticket => statusBadge(ticket.priority) },
          { header: '状态', render: ticket => statusBadge(ticket.status) },
          { header: '未读', render: ticket => ticket.unreadCount > 0 ? <TicketUnreadBadge count={ticket.unreadCount} /> : <span className="text-gray-500">-</span> },
          { header: '负责人', render: ticket => ticket.assignee },
          { header: 'SLA', render: ticket => `${ticket.slaHours}h` },
          { header: '操作', className: 'justify-end', render: ticket => (
            <div className="flex gap-2" onClick={event => event.stopPropagation()}>
              <Button size="sm" variant="secondary" onClick={() => setDetail({ title: ticket.title, subtitle: ticket.id, content: <TicketDetail ticket={ticket} /> })}>详情</Button>
              <Button size="sm" variant="secondary" onClick={() => openConversation(ticket)}>回复</Button>
              <Button size="sm" variant="primary" disabled={ticket.status === 'resolved'} onClick={() => resolveTicket(ticket)}>关闭</Button>
            </div>
          ) },
        ]}
        serverPagination={control.pagination}
        serverLoading={control.loading}
        onServerNavigate={control.navigate}
        onRowClick={openConversation}
      />
    </PageShell>
  );
}

function TicketUnreadBadge({ count }: { count: number }) {
  const label = count > 99 ? '99+' : String(count);
  return (
    <Badge
      variant="pink"
      dot
      className="border border-pink-400/40 bg-pink-500/25 text-pink-100 shadow-sm shadow-pink-950/20"
    >
      {label} 新消息
    </Badge>
  );
}
