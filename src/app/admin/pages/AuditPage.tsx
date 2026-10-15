import { useEffect,useState } from 'react';
import {
  type AdminAuditLog
} from '../../data/admin';

import {
  AdminDataTable,
  AuditDetail,
  PageShell,
  SearchFilter,
  SelectFilter,
  statusBadge
} from '../components/AdminPageShared';
import type { AdminListControls,DetailState } from '../types';

export function AdminAuditPage({ logs, control, setDetail }: { logs: AdminAuditLog[]; control: AdminListControls['audit']; setDetail: (detail: DetailState) => void }) {
  const [search, setSearch] = useState(control.filters.search ?? '');
  const [risk, setRisk] = useState<'all' | AdminAuditLog['risk']>(control.filters.risk ?? 'all');
  useEffect(() => {
    const timer = window.setTimeout(() => control.setFilters({
      search: search.trim() || undefined,
      risk: risk === 'all' ? undefined : risk,
      module: control.filters.module,
    }), 300);
    return () => window.clearTimeout(timer);
  }, [control.filters.module, control.setFilters, risk, search]);

  return (
    <PageShell title="操作审计日志" subtitle="只读记录管理员关键操作，方便追溯风险操作和权限边界">
      <SearchFilter search={search} onSearch={setSearch} placeholder="搜索管理员、模块、对象或操作...">
        <SelectFilter value={risk} onChange={setRisk} label="风险" options={[
          { value: 'all', label: '全部风险' },
          { value: 'high', label: '高风险' },
          { value: 'medium', label: '中风险' },
          { value: 'low', label: '低风险' },
        ]} />
      </SearchFilter>
      <AdminDataTable
        items={logs}
        paginationLabel="操作审计分页导航"
        gridTemplate="1fr .9fr .8fr .8fr .9fr .65fr .8fr"
        columns={[
          { header: '时间', render: log => log.time },
          { header: '管理员', render: log => log.admin },
          { header: '模块', render: log => log.module },
          { header: '操作', render: log => log.action },
          { header: '对象', render: log => log.target },
          { header: '风险', render: log => statusBadge(log.risk) },
          { header: 'IP', render: log => log.ip },
        ]}
        serverPagination={control.pagination}
        serverLoading={control.loading}
        onServerNavigate={control.navigate}
        onRowClick={log => setDetail({ title: log.action, subtitle: '审计详情', content: <AuditDetail log={log} /> })}
      />
    </PageShell>
  );
}
