import {
  CheckCircle2,
  CreditCard,
  RefreshCw,
  XCircle
} from 'lucide-react';
import { useEffect,useState } from 'react';
import { toast } from 'sonner';
import {
  type AdminInvoiceRequest,
  type AdminOrder
} from '../../data/admin';
import { refundAttemptStatusLabel } from '../../data/paymentState';
import { Button,TabBar } from '../../ui';

import {
  AdminDataTable,
  MetricCard,
  ORDER_TIME_RANGE_LABEL,
  ORDER_TIME_RANGE_TABS,
  OrderDetail,
  PageShell,
  SearchFilter,
  SelectFilter,
  Stack,
  money,
  number,
  statusBadge
} from '../components/AdminPageShared';
import type { AdminListControls,ConfirmState,DetailState,OrderTimeRange } from '../types';

export function AdminOrdersPage({ orders, control, summary, onOrderDetailLoad, onOrderRefund, onOrderRefundSync, setDetail, setConfirm }: {
  orders: AdminOrder[];
  control: AdminListControls['orders'];
  summary: { paidCount: number; paidAmount: number; refundedCount: number; refundedAmount: number; failedCount: number; failedAmount: number } | null;
  onOrderDetailLoad: (id: string) => Promise<{ order: AdminOrder; invoice: AdminInvoiceRequest | null; creditLedger: import('../../data/admin').AdminCreditLedgerEntry[] }>;
  onOrderRefund: (order: AdminOrder) => Promise<void>;
  onOrderRefundSync: (order: AdminOrder) => Promise<void>;
  setDetail: (detail: DetailState) => void;
  setConfirm: (confirm: ConfirmState) => void;
}) {
  const [search, setSearch] = useState(control.filters.search ?? '');
  const [status, setStatus] = useState<'all' | AdminOrder['status']>(control.filters.status ?? 'all');
  const [timeRange, setTimeRange] = useState<OrderTimeRange>(() => orderTimeRangeFromFilters(control.filters.from, control.filters.to));
  const [syncingRefundId, setSyncingRefundId] = useState<string | null>(null);
  const rangeLabel = ORDER_TIME_RANGE_LABEL[timeRange];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const range = orderRangeDates(timeRange);
      control.setFilters({
        search: search.trim() || undefined,
        status: status === 'all' ? undefined : status,
        userId: control.filters.userId,
        ...range,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [control.filters.userId, control.setFilters, search, status, timeRange]);

  const openOrderDetail = async (order: AdminOrder) => {
    try {
      const detail = await onOrderDetailLoad(order.id);
      setDetail({
        title: detail.order.id,
        subtitle: '订单详情',
        content: <OrderDetail order={detail.order} invoiceRequest={detail.invoice ?? undefined} creditEntries={detail.creditLedger} />,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '订单详情加载失败');
    }
  };

  const refund = (order: AdminOrder) => {
    setConfirm({
      title: '确认退款？',
      description: `${order.id} 将向支付服务发起全额退款，并预留对应到账积分。`,
      confirmLabel: '发起全额退款',
      danger: true,
      onConfirm: () => onOrderRefund(order),
    });
  };

  const syncRefund = async (order: AdminOrder) => {
    if (syncingRefundId) return;
    setSyncingRefundId(order.id);
    try {
      await onOrderRefundSync(order);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '退款状态同步失败');
    } finally {
      setSyncingRefundId(null);
    }
  };

  return (
    <PageShell
      title="订单管理"
      subtitle="查看订阅订单、支付状态、退款状态与订单详情"
      action={<div className="flex flex-wrap items-center gap-2">
        <TabBar tabs={ORDER_TIME_RANGE_TABS} active={timeRange} onChange={setTimeRange} />
        {control.filters.userId && (
          <Button variant="secondary" onClick={() => control.setFilters({ ...control.filters, userId: undefined })}>
            清除用户筛选
          </Button>
        )}
      </div>}
    >
      <SearchFilter search={search} onSearch={setSearch} placeholder="搜索订单号、用户或套餐...">
        <SelectFilter value={status} onChange={setStatus} label="状态" options={[
          { value: 'all', label: '全部订单' },
          { value: 'paid', label: '已支付' },
          { value: 'pending', label: '待支付' },
          { value: 'refunded', label: '已退款' },
          { value: 'failed', label: '失败' },
        ]} />
      </SearchFilter>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard icon={CreditCard} label="已支付金额" value={money(summary?.paidAmount ?? 0)} helper={`${rangeLabel}已支付订单金额`} tone="green" />
        <MetricCard icon={RefreshCw} label="已退款金额" value={money(summary?.refundedAmount ?? 0)} helper={`${rangeLabel}已退款订单金额`} tone="blue" />
        <MetricCard icon={XCircle} label="支付失败金额" value={money(summary?.failedAmount ?? 0)} helper={`${rangeLabel}支付失败订单金额`} tone="orange" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard icon={CheckCircle2} label="已支付" value={number(summary?.paidCount ?? 0)} helper={`${rangeLabel}已支付订单`} tone="green" />
        <MetricCard icon={RefreshCw} label="已退款" value={number(summary?.refundedCount ?? 0)} helper={`${rangeLabel}已退款订单`} tone="blue" />
        <MetricCard icon={XCircle} label="支付失败" value={number(summary?.failedCount ?? 0)} helper={`${rangeLabel}支付失败订单`} tone="orange" />
      </div>
      <AdminDataTable
        items={orders}
        paginationLabel="订单分页导航"
        gridTemplate="1.12fr .95fr .72fr .62fr .68fr .7fr .7fr .72fr .72fr 128px"
        columns={[
          { header: '订单号', render: order => <Stack title={order.id} subtitle={order.createdAt} /> },
          { header: '用户', render: order => <Stack title={order.userName} subtitle={order.email} /> },
          { header: '套餐', render: order => order.planName },
          { header: '金额', render: order => money(order.amount) },
          { header: '积分到账', render: order => statusBadge(order.creditStatus) },
          { header: '支付状态', render: order => statusBadge(order.status) },
          { header: '开票状态', render: order => statusBadge(order.invoiceStatus) },
          { header: '支付方式', render: order => order.paymentMethodLabel ?? '在线支付' },
          { header: '退款状态', render: order => statusBadge(refundStatusLabel(order)) },
          { header: '操作', className: 'justify-end', render: order => {
            const manualReview = order.refundAttemptStatus === 'manual-review';
            const refreshable = isRefundAttemptRefreshable(order);
            const refunded = order.refundStatus === 'succeeded' || order.refundAttemptStatus === 'succeeded';
            return (
              <div className="flex gap-2" onClick={event => event.stopPropagation()}>
                <Button size="sm" variant="secondary" onClick={() => void openOrderDetail(order)}>详情</Button>
                {manualReview
                  ? <Button size="sm" variant="secondary" disabled>人工核对</Button>
                  : refreshable
                    ? <Button size="sm" variant="secondary" loading={syncingRefundId === order.id} disabled={Boolean(syncingRefundId && syncingRefundId !== order.id)} onClick={() => void syncRefund(order)}>刷新状态</Button>
                    : <Button size="sm" variant="danger" disabled={order.status !== 'paid' || refunded} onClick={() => refund(order)}>退款</Button>}
              </div>
            );
          } },
        ]}
        serverPagination={control.pagination}
        serverLoading={control.loading}
        onServerNavigate={control.navigate}
        onRowClick={order => void openOrderDetail(order)}
      />
    </PageShell>
  );
}

function orderRangeDates(range: OrderTimeRange) {
  if (range === 'all') return {};
  const today = new Date();
  const to = localIsoDate(today);
  if (range === 'today') return { from: to, to };
  const from = new Date(today);
  if (range === 'seven-days') from.setDate(from.getDate() - 6);
  else from.setDate(1);
  return { from: localIsoDate(from), to };
}

function localIsoDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function orderTimeRangeFromFilters(from?: string, to?: string): OrderTimeRange {
  if (!from || !to) return 'all';
  for (const range of ['today', 'seven-days', 'month'] as const) {
    const expected = orderRangeDates(range);
    if (expected.from === from && expected.to === to) return range;
  }
  return 'all';
}

function refundStatusLabel(order: AdminOrder) {
  if (order.refundAttemptStatus) return refundAttemptStatusLabel(order.refundAttemptStatus);
  if (order.refundStatus === 'pending') return '退款确认中';
  if (order.refundStatus === 'succeeded') return '已退款';
  if (order.refundStatus === 'failed') return '退款失败';
  return '未退款';
}

function isRefundAttemptRefreshable(order: AdminOrder) {
  if (order.refundAttemptStatus) {
    return ['queued', 'processing', 'submitted', 'uncertain'].includes(order.refundAttemptStatus);
  }
  return order.refundStatus === 'pending';
}
