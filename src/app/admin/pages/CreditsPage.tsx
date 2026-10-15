import { useEffect,useState } from 'react';
import {
  type AdminCreditLedgerEntry
} from '../../data/admin';
import { Button } from '../../ui';

import {
  AdminDataTable,
  CreditDetail,
  PageShell,
  RelationStack,
  SearchFilter,
  SelectFilter,
  Stack,
  creditBucketLabel,
  statusBadge
} from '../components/AdminPageShared';
import type { AdminListControls,DetailState } from '../types';

export function AdminCreditsPage({ entries, control, setDetail }: {
  entries: AdminCreditLedgerEntry[];
  control: AdminListControls['credits'];
  setDetail: (detail: DetailState) => void;
}) {
  const [search, setSearch] = useState(control.filters.search ?? '');
  const [type, setType] = useState<'all' | AdminCreditLedgerEntry['type']>(control.filters.type ?? 'all');
  useEffect(() => {
    const timer = window.setTimeout(() => control.setFilters({
      search: search.trim() || undefined,
      type: type === 'all' ? undefined : type,
      userId: control.filters.userId,
      relatedOrderId: control.filters.relatedOrderId,
      relatedJobId: control.filters.relatedJobId,
    }), 300);
    return () => window.clearTimeout(timer);
  }, [control.filters.relatedJobId, control.filters.relatedOrderId, control.filters.userId, control.setFilters, search, type]);

  return (
    <PageShell
      title="积分流水管理"
      subtitle="查看获得、消耗、退回和人工调整记录，用于积分对账"
      action={control.filters.userId ? (
        <Button variant="secondary" onClick={() => control.setFilters({ ...control.filters, userId: undefined })}>
          清除用户筛选
        </Button>
      ) : undefined}
    >
      <SearchFilter search={search} onSearch={setSearch} placeholder="搜索用户、来源或备注...">
        <SelectFilter value={type} onChange={setType} label="类型" options={[
          { value: 'all', label: '全部类型' },
          { value: 'earn', label: '获得' },
          { value: 'hold', label: '预扣' },
          { value: 'spend', label: '消耗' },
          { value: 'refund', label: '退回' },
          { value: 'adjust', label: '调整' },
          { value: 'void', label: '冲销' },
        ]} />
      </SearchFilter>
      <AdminDataTable
        items={entries}
        paginationLabel="积分流水分页导航"
        gridTemplate=".95fr .8fr .6fr .65fr .65fr .75fr 1fr 1fr"
        columns={[
          { header: '时间', render: entry => entry.time },
          { header: '用户', render: entry => <Stack title={entry.userName} subtitle={entry.email} /> },
          { header: '类型', render: entry => statusBadge(entry.type) },
          { header: '来源桶', render: entry => creditBucketLabel(entry.bucket) },
          { header: '积分变动', render: entry => <span className={entry.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}>{entry.amount > 0 ? '+' : ''}{entry.amount}</span> },
          { header: '结算状态', render: entry => entry.settlementStatus ? statusBadge(entry.settlementStatus) : '-' },
          { header: '来源', render: entry => entry.source },
          { header: '关联', render: entry => <RelationStack entry={entry} /> },
        ]}
        serverPagination={control.pagination}
        serverLoading={control.loading}
        onServerNavigate={control.navigate}
        onRowClick={entry => setDetail({ title: entry.source, subtitle: '积分流水详情', content: <CreditDetail entry={entry} /> })}
      />
    </PageShell>
  );
}
