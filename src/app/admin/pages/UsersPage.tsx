import { ACQUISITION_SOURCES,ACQUISITION_SOURCE_LABELS,type AcquisitionSource } from '@lindyson/api-contracts';
import { useEffect,useState } from 'react';
import { toast } from 'sonner';
import type { AdminUser,AdminUserSubscriptionUpdate } from '../../data/admin';
import { Button } from '../../ui';

import {
  AdminDataTable,
  PageShell,
  SearchFilter,
  SelectFilter,
  Stack,
  UserDetail,
  acquisitionBadge,
  number,
  statusBadge,
} from '../components/AdminPageShared';
import { UserAccountAdjustment } from '../components/UserAccountAdjustment';
import type { AdminListControls,ConfirmState,DetailState } from '../types';

interface AdminUsersPageProps {
  users: AdminUser[];
  control: AdminListControls['users'];
  onOpenUserOrders: (user: AdminUser) => void;
  onOpenUserCredits: (user: AdminUser) => void;
  onUserStatusChange: (user: AdminUser, status: AdminUser['status']) => Promise<void>;
  onUserSubscriptionChange: (user: AdminUser, payload: AdminUserSubscriptionUpdate) => Promise<AdminUser>;
  onUserCreditsAdjust: (user: AdminUser, mainDelta: number, addonDelta: number, note: string) => Promise<AdminUser>;
  setDetail: (detail: DetailState) => void;
  setConfirm: (confirm: ConfirmState) => void;
}

export function AdminUsersPage({
  users,
  control,
  onOpenUserOrders,
  onOpenUserCredits,
  onUserStatusChange,
  onUserSubscriptionChange,
  onUserCreditsAdjust,
  setDetail,
  setConfirm,
}: AdminUsersPageProps) {
  const [search, setSearch] = useState(control.filters.search ?? '');
  const [status, setStatus] = useState<'all' | AdminUser['status']>(control.filters.status ?? 'all');
  const [source, setSource] = useState<'all' | AcquisitionSource>(control.filters.source ?? 'all');

  useEffect(() => {
    const timer = window.setTimeout(() => control.setFilters({
      search: search.trim() || undefined,
      status: status === 'all' ? undefined : status,
      source: source === 'all' ? undefined : source,
    }), 300);
    return () => window.clearTimeout(timer);
  }, [control.setFilters, search, status, source]);

  const toggleFreeze = (user: AdminUser) => {
    const nextStatus = user.status === 'frozen' ? 'active' : 'frozen';
    setConfirm({
      title: nextStatus === 'frozen' ? '确认冻结用户？' : '确认解冻用户？',
      description: `${user.userName} 的账号状态将被更新。`,
      confirmLabel: nextStatus === 'frozen' ? '冻结用户' : '解冻用户',
      danger: nextStatus === 'frozen',
      onConfirm: async () => {
        try {
          await onUserStatusChange(user, nextStatus);
          toast.success('用户状态已更新');
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '用户状态更新失败');
        }
      },
    });
  };

  return (
    <PageShell title="用户管理" subtitle="管理注册用户、订阅状态、积分余额与账号风险状态">
      <SearchFilter search={search} onSearch={setSearch} placeholder="搜索用户名、邮箱或套餐...">
        <SelectFilter value={status} onChange={setStatus} label="状态" options={[
          { value: 'all', label: '全部用户' },
          { value: 'active', label: '启用中' },
          { value: 'trial', label: '试用中' },
          { value: 'frozen', label: '已冻结' },
        ]} />
        <SelectFilter value={source} onChange={setSource} label="来源" options={[
          { value: 'all' as const, label: '全部来源' },
          ...ACQUISITION_SOURCES.map(value => ({ value, label: ACQUISITION_SOURCE_LABELS[value] })),
        ]} />
      </SearchFilter>
      <AdminDataTable
        items={users}
        paginationLabel="用户分页导航"
        gridTemplate="1.2fr .9fr .9fr .75fr .9fr .75fr .95fr 190px"
        columns={[
          { header: '用户', render: user => <Stack title={user.userName} subtitle={user.email} /> },
          { header: '来源', render: user => <Stack title={acquisitionBadge(user.acquisition)} subtitle={user.acquisition?.campaign ?? undefined} /> },
          { header: '套餐', render: user => user.planName },
          { header: '积分', render: user => `${number(user.credits)} / ${number(user.totalCredits)}` },
          { header: '套餐重置时间', render: user => user.planResetAt ?? '-' },
          { header: '状态', render: user => statusBadge(user.status) },
          { header: '最近活跃', render: user => user.lastActiveAt },
          { header: '操作', className: 'justify-end', render: user => (
            <div className="grid w-full grid-cols-2 gap-2" onClick={event => event.stopPropagation()}>
              <Button
                size="sm"
                variant="secondary"
                className="w-full px-2"
                onClick={() => onOpenUserOrders(user)}
              >
                历史订单
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="w-full px-2"
                onClick={() => onOpenUserCredits(user)}
              >
                积分流水
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="w-full px-2"
                onClick={() => setDetail({
                  title: '套餐与积分调整',
                  subtitle: `${user.userName} · 两项操作独立保存`,
                  wide: true,
                  content: (
                    <UserAccountAdjustment
                      user={user}
                      onUserSubscriptionChange={onUserSubscriptionChange}
                      onUserCreditsAdjust={onUserCreditsAdjust}
                      setConfirm={setConfirm}
                    />
                  ),
                })}
              >调整积分</Button>
              <Button size="sm" className="w-full px-2" variant={user.status === 'frozen' ? 'primary' : 'danger'} onClick={() => toggleFreeze(user)}>{user.status === 'frozen' ? '解冻' : '冻结'}</Button>
            </div>
          ) },
        ]}
        serverPagination={control.pagination}
        serverLoading={control.loading}
        onServerNavigate={control.navigate}
        onRowClick={user => setDetail({ title: user.userName, subtitle: '用户详情', content: <UserDetail user={user} /> })}
      />
    </PageShell>
  );
}
