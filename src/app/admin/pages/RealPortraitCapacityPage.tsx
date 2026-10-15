import {
  AlertTriangle,
  Clock3,
  Database,
  Images,
  ShieldCheck,
} from 'lucide-react';
import { useMemo,useState } from 'react';
import type { AdminRealPortraitCapacity } from '../../api/queries';
import { Badge,Card,LoadingState } from '../../ui';
import {
  AdminDataTable,
  MetricCard,
  PageShell,
  SearchFilter,
  Stack,
  number,
} from '../components/AdminPageShared';

type CapacityUser = AdminRealPortraitCapacity['users'][number];
type QueueItem = AdminRealPortraitCapacity['queue'][number];
type DeleteFailure = AdminRealPortraitCapacity['remoteDeleteFailures'][number];

export function AdminRealPortraitCapacityPage({
  capacity,
  loading,
  error,
}: {
  capacity: AdminRealPortraitCapacity | null;
  loading: boolean;
  error: Error | null;
}) {
  const [search, setSearch] = useState('');
  const users = useMemo(() => (capacity?.users ?? [])
    .filter(user => `${user.userName} ${user.email} ${user.planCode ?? 'free'}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()))
    .map(user => ({ ...user, id: user.userId })), [capacity?.users, search]);

  if (loading && !capacity) {
    return (
      <PageShell
        title="真人容量管理"
        subtitle="查看套餐额度、共享热池、降级宽限、等待队列和远端清理失败。"
      >
        <LoadingState label="正在读取真人容量" />
      </PageShell>
    );
  }

  if (!capacity) {
    return (
      <PageShell
        title="真人容量管理"
        subtitle="查看套餐额度、共享热池、降级宽限、等待队列和远端清理失败。"
      >
        <Card className="border-red-500/20 bg-red-500/10 p-5">
          <p className="font-semibold text-red-100">真人容量数据加载失败</p>
          <p className="mt-2 text-sm text-red-200/70">{error?.message ?? '服务端暂未返回容量快照，请稍后刷新。'}</p>
        </Card>
      </PageShell>
    );
  }

  const waitingCount = capacity.listInfo.queue.waiting;
  const groupTotal = capacity.global.groupsUsed + capacity.global.groupsReserved;
  const assetTotal = capacity.global.assetsUsed + capacity.global.assetsReserved;

  return (
    <PageShell
      title="真人容量管理"
      subtitle={`当前 Entry 权益为 50 Group / 50 Asset；普通调度按 ${number(capacity.global.groupSoftLimit)} / ${number(capacity.global.assetSoftLimit)} 软上限运行，剩余位置保留给恢复操作。`}
      width="full"
    >
      {error && (
        <Card className="border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          当前展示上一次成功快照；刷新失败：{error.message}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Database}
          label="Group 热池"
          value={`${number(groupTotal)} / ${number(capacity.global.groupSoftLimit)}`}
          helper={`已占用 ${number(capacity.global.groupsUsed)}，已预留 ${number(capacity.global.groupsReserved)}；不提前释放删除中的容量。`}
          tone={capacityTone(groupTotal, capacity.global.groupSoftLimit)}
        />
        <MetricCard
          icon={Images}
          label="Asset 热池"
          value={`${number(assetTotal)} / ${number(capacity.global.assetSoftLimit)}`}
          helper={`已占用 ${number(capacity.global.assetsUsed)}，已预留 ${number(capacity.global.assetsReserved)}；容量紧张时优先释放第二张弹性图片。`}
          tone={capacityTone(assetTotal, capacity.global.assetSoftLimit)}
        />
        <MetricCard
          icon={Clock3}
          label="等待激活"
          value={number(waitingCount)}
          helper={`队列共 ${number(capacity.listInfo.queue.total)} 条；当前返回 ${number(capacity.listInfo.queue.returned)} 条。`}
          tone={waitingCount > 0 ? 'orange' : 'green'}
        />
        <MetricCard
          icon={AlertTriangle}
          label="远端删除失败"
          value={number(capacity.listInfo.remoteDeleteFailures.total)}
          helper="失败资源仍计入共享容量，由 worker 幂等重试，管理员不能手工伪造删除成功。"
          tone={capacity.listInfo.remoteDeleteFailures.total > 0 ? 'orange' : 'green'}
        />
      </div>

      {(capacity.listInfo.users.truncated
        || capacity.listInfo.queue.truncated
        || capacity.listInfo.remoteDeleteFailures.truncated) && (
        <Card className="border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
          当前快照数据量较大，表格仅返回服务端安全上限内的记录：用户 {number(capacity.listInfo.users.returned)} / {number(capacity.listInfo.users.total)}，
          队列 {number(capacity.listInfo.queue.returned)} / {number(capacity.listInfo.queue.total)}，
          删除失败 {number(capacity.listInfo.remoteDeleteFailures.returned)} / {number(capacity.listInfo.remoteDeleteFailures.total)}。顶部总数仍为完整统计。
        </Card>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-white">用户套餐额度与实际占用</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            档案用量包含套餐锁定演员；激活用量包含预留、认证、上传、处理及已有远端 Group。
          </p>
        </div>
        <SearchFilter
          search={search}
          onSearch={setSearch}
          placeholder="搜索用户名、邮箱或套餐代码..."
        />
        <AdminDataTable
          items={users}
          paginationLabel="真人容量用户分页导航"
          pageSize={12}
          minTableWidth={1120}
          gridTemplate="1.35fr .65fr .65fr 1fr 1fr .65fr 1fr"
          emptyLabel="暂无真人演员库用户"
          columns={[
            {
              header: '用户',
              render: user => <Stack title={user.userName} subtitle={user.email} />,
            },
            {
              header: '套餐',
              render: user => <Badge variant={user.entitlements.enabled ? 'purple' : 'default'}>{user.planCode ?? 'free'}</Badge>,
            },
            {
              header: '每人图片',
              render: user => `${number(user.entitlements.assetsPerActor)} 张`,
            },
            {
              header: '档案',
              render: user => quotaUsage(
                user.usage.profiles,
                user.entitlements.enabled ? user.entitlements.profileLimit : 0,
              ),
            },
            {
              header: '同时激活',
              render: user => quotaUsage(
                user.usage.active,
                user.entitlements.enabled ? user.entitlements.activeLimit : 0,
              ),
            },
            {
              header: '排队',
              render: user => number(user.usage.queued),
            },
            {
              header: '宽限状态',
              render: user => <QuotaState user={user} />,
            },
          ]}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-white">激活等待队列</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            近期没有可释放对象时按用户间等权顺序等待；这里不提供越过套餐或全局上限的人工操作。
          </p>
        </div>
        <AdminDataTable
          items={capacity.queue}
          paginationLabel="真人激活等待队列分页导航"
          pageSize={12}
          minTableWidth={900}
          gridTemplate=".45fr 1.2fr 1fr .7fr 1fr"
          emptyLabel="当前没有激活等待记录"
          columns={[
            { header: '账号内顺序', render: item => `#${number(item.position)}` },
            { header: '用户', render: item => <Stack title={item.userName} subtitle={shortId(item.userId)} /> },
            { header: '演员别名', render: item => item.actorAlias },
            { header: '状态', render: item => <QueueStatus item={item} /> },
            { header: '申请时间', render: item => formatDateTime(item.requestedAt) },
          ]}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-white">远端删除失败</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            仅展示业务标识和重试状态，不展示火山 Group ID、Asset ID、BytedToken 或任何密钥。
          </p>
        </div>
        <AdminDataTable
          items={capacity.remoteDeleteFailures}
          paginationLabel="真人远端删除失败分页导航"
          pageSize={12}
          minTableWidth={1080}
          gridTemplate="1.2fr .9fr .65fr .55fr .8fr .9fr"
          emptyLabel="没有待处理的远端删除失败"
          columns={[
            { header: '用户', render: item => <Stack title={item.userName} subtitle={shortId(item.userId)} /> },
            { header: '演员别名', render: item => item.actorAlias },
            { header: '资源类型', render: item => item.resourceKind === 'group' ? '素材组' : '素材' },
            { header: '尝试次数', render: item => number(item.attempts) },
            { header: '错误代码', render: item => item.errorCode ?? '-' },
            {
              header: '下次重试',
              render: item => <FailureRetryState item={item} />,
            },
          ]}
        />
      </section>

      <Card className="border-violet-400/15 bg-violet-500/[0.06] p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-violet-300" />
          <p className="text-xs leading-6 text-gray-400">
            容量页只用于观测和排障。真人认证、已撤回授权、一致性失败素材及套餐锁定状态均不能由管理员绕过。
          </p>
        </div>
      </Card>
    </PageShell>
  );
}

export function capacityTone(
  usedAndReserved: number,
  limit: number,
): 'green' | 'orange' | 'pink' {
  if (limit <= 0 || usedAndReserved >= limit) return 'pink';
  return usedAndReserved / limit >= 0.8 ? 'orange' : 'green';
}

function quotaUsage(used: number, limit: number | null) {
  const exceeded = limit !== null && used > limit;
  return (
    <span className={exceeded ? 'font-semibold text-red-300' : 'text-gray-300'}>
      {number(used)} / {limit === null ? '不限' : number(limit)}
      {exceeded && <span className="ml-2 text-xs">超额</span>}
    </span>
  );
}

function QuotaState({ user }: { user: CapacityUser }) {
  const state = user.quotaState;
  if (!state || state.graceStatus === 'none') return <Badge variant="default">无宽限</Badge>;
  if (state.graceStatus === 'active') {
    return (
      <Stack
        title={<Badge variant="warning" dot>7 天宽限中</Badge>}
        subtitle={state.graceUntil ? `截止 ${formatDateTime(state.graceUntil)}` : '等待截止时间'}
      />
    );
  }
  if (state.graceStatus === 'reconciling') return <Badge variant="orange" dot>清理中</Badge>;
  return <Badge variant="success">已完成</Badge>;
}

function QueueStatus({ item }: { item: QueueItem }) {
  const display = {
    waiting: { label: '等待容量', variant: 'warning' as const },
    promoted: { label: '已获得容量', variant: 'purple' as const },
    completed: { label: '已完成', variant: 'success' as const },
    cancelled: { label: '已取消', variant: 'default' as const },
  }[item.status];
  return <Badge variant={display.variant} dot={item.status === 'waiting'}>{display.label}</Badge>;
}

function FailureRetryState({ item }: { item: DeleteFailure }) {
  return (
    <Stack
      title={item.nextRetryAt ? formatDateTime(item.nextRetryAt) : '待人工排查'}
      subtitle={item.lastAttemptAt ? `最近 ${formatDateTime(item.lastAttemptAt)}` : '尚未执行重试'}
    />
  );
}

function shortId(id: string) {
  return `${id.slice(0, 8)}…`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      });
}
