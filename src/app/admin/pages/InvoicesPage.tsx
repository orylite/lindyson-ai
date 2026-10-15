import { useEffect,useState } from 'react';
import { toast } from 'sonner';
import {
  type AdminInvoiceRequest,
  type AdminOrder
} from '../../data/admin';
import { Button } from '../../ui';

import {
  AdminDataTable,
  InvoiceDetail,
  PageShell,
  SearchFilter,
  SelectFilter,
  Stack,
  money,
  statusBadge
} from '../components/AdminPageShared';
import type { AdminListControls,ConfirmState,DetailState } from '../types';

export function AdminInvoicesPage({ invoiceRequests, control, onOrderDetailLoad, onInvoiceStatusChange, setDetail, setConfirm }: {
  invoiceRequests: AdminInvoiceRequest[];
  control: AdminListControls['invoices'];
  onOrderDetailLoad: (id: string) => Promise<{ order: AdminOrder }>;
  onInvoiceStatusChange: (request: AdminInvoiceRequest, status: AdminInvoiceRequest['status']) => Promise<void>;
  setDetail: (detail: DetailState) => void;
  setConfirm: (confirm: ConfirmState) => void;
}) {
  const [search, setSearch] = useState(control.filters.search ?? '');
  const [status, setStatus] = useState<'all' | AdminInvoiceRequest['status']>(control.filters.status ?? 'all');
  useEffect(() => {
    const timer = window.setTimeout(() => control.setFilters({
      search: search.trim() || undefined,
      status: status === 'all' ? undefined : status,
      userId: control.filters.userId,
      orderId: control.filters.orderId,
    }), 300);
    return () => window.clearTimeout(timer);
  }, [control.filters.orderId, control.filters.userId, control.setFilters, search, status]);

  const openInvoiceDetail = async (request: AdminInvoiceRequest) => {
    try {
      const detail = await onOrderDetailLoad(request.orderId);
      setDetail({ title: request.id, subtitle: '发票申请详情', content: <InvoiceDetail invoice={request} order={detail.order} /> });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '关联订单加载失败');
    }
  };

  const updateInvoiceStatus = (request: AdminInvoiceRequest, nextStatus: AdminInvoiceRequest['status']) => {
    const markingIssued = nextStatus === 'issued';
    setConfirm({
      title: markingIssued ? '确认已人工开票并发送？' : '确认恢复为未开票？',
      description: markingIssued
        ? `请确认已将真实发票人工发送至 ${request.receiveEmail}。本操作只更新站内状态，系统不会发送邮件或附件。`
        : `${request.id} 与订单 ${request.orderId} 将恢复为未开票；系统不会发送邮件或附件。`,
      confirmLabel: markingIssued ? '确认已开票并已发送' : '恢复未开票',
      danger: nextStatus === 'unissued',
      onConfirm: async () => {
        try {
          await onInvoiceStatusChange(request, nextStatus);
          toast.success(markingIssued ? '已记录人工开票和发送状态' : '已恢复为未开票');
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '开票状态更新失败');
        }
      },
    });
  };

  return (
    <PageShell title="发票管理" subtitle="查看抬头和税号，人工开具并发送发票后再确认状态">
      <SearchFilter search={search} onSearch={setSearch} placeholder="搜索申请编号、订单、用户或抬头...">
        <SelectFilter value={status} onChange={setStatus} label="状态" options={[
          { value: 'all', label: '全部发票' },
          { value: 'unissued', label: '未开票' },
          { value: 'issued', label: '已开票' },
        ]} />
      </SearchFilter>
      <AdminDataTable
        items={invoiceRequests}
        paginationLabel="发票申请分页导航"
        gridTemplate="1.05fr 1.1fr .95fr .6fr .7fr .9fr 190px"
        columns={[
          { header: '申请编号', render: request => <Stack title={request.id} subtitle={request.invoiceTitle} /> },
          { header: '关联订单', render: request => <Stack title={request.orderId} subtitle={request.planName} /> },
          { header: '用户', render: request => <Stack title={request.userName} subtitle={request.email} /> },
          { header: '金额', render: request => money(request.amount) },
          { header: '开票状态', render: request => statusBadge(request.status) },
          { header: '申请时间', render: request => request.requestedAt },
          { header: '操作', className: 'justify-end', render: request => (
            <div className="flex gap-2" onClick={event => event.stopPropagation()}>
              <Button size="sm" variant="secondary" onClick={() => void openInvoiceDetail(request)}>详情</Button>
              <Button
                size="sm"
                variant={request.status === 'issued' ? 'secondary' : 'primary'}
                onClick={() => updateInvoiceStatus(request, request.status === 'issued' ? 'unissued' : 'issued')}
              >
                {request.status === 'issued' ? '恢复未开票' : '确认已开票并已发送'}
              </Button>
            </div>
          ) },
        ]}
        serverPagination={control.pagination}
        serverLoading={control.loading}
        onServerNavigate={control.navigate}
        onRowClick={request => void openInvoiceDetail(request)}
      />
    </PageShell>
  );
}
