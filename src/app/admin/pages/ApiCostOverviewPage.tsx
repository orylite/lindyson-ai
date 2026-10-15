import {
  ArrowRight,
  AlertTriangle,
  CalendarDays,
  CircleDollarSign,
  Coins,
  RefreshCw,
  WalletCards,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { PagePosition } from '../../api/cursor';
import type {
  AdminApiCostFilters,
  AdminApiCostLoadState,
  AdminApiCostOverviewSnapshot,
  AdminApiCostPageKind,
  AdminApiCostPaginationState,
  AdminApiCostResourceState,
  AdminApiCostTask,
  AdminApiCostUser,
} from '../../data/admin';
import { apiCostFilterKey } from '../../data/apiCostFilters';
import { Badge,Button,Card,DatePicker,LoadingState } from '../../ui';
import { formatBeijingDateTime } from '../../utils/beijingTime';
import {
  AdminDataTable,
  FilterChips,
  MetricCard,
  PageShell,
  SearchFilter,
  SelectFilter,
  Stack,
  number,
  statusBadge,
} from '../components/AdminPageShared';
import type { DetailState } from '../types';
import { AdminImageCostView } from './ImageCostView';
import { AdminMultimodalCostView } from './MultimodalCostView';

type OperatingRange = 'month' | 'custom';
export type CostType = 'video' | 'image' | 'multimodal';
type ModelFilter = 'all' | 'Seedance 2.5' | 'Seedance 2.0' | 'Seedance 2.0 Fast' | 'Seedance 2.0 Mini';
type TaskStatusFilter = 'all' | 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
type CostStateFilter = 'all' | 'unfinalized' | 'unresolved' | 'pending-final-bill' | 'approved-zero' | 'recorded';
type EstimateCompleteness = 'complete' | 'partial' | 'unavailable';

const MODEL_OPTIONS = new Set<ModelFilter>([
  'all', 'Seedance 2.5', 'Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini',
]);

export function AdminApiCostOverviewPage({
  overview,
  users,
  tasks,
  pagination,
  loadState,
  onOverviewLoad,
  onTasksLoad,
  onOverviewRefresh,
  onCancel,
  onPageNavigate,
  onSync,
  onNavigate,
  setDetail,
}: {
  overview: AdminApiCostOverviewSnapshot | null;
  users: AdminApiCostUser[];
  tasks: AdminApiCostTask[];
  pagination: AdminApiCostPaginationState;
  loadState: AdminApiCostLoadState;
  onOverviewLoad: (filters?: AdminApiCostFilters, taskFilters?: AdminApiCostFilters) => Promise<void>;
  onTasksLoad: (filters?: AdminApiCostFilters) => Promise<void>;
  onOverviewRefresh: (filters?: AdminApiCostFilters) => Promise<void>;
  onCancel: () => void;
  onPageNavigate: (kind: AdminApiCostPageKind, position: PagePosition) => Promise<void>;
  onSync: (filters?: AdminApiCostFilters) => Promise<void>;
  onNavigate: (path: string) => void;
  setDetail: (detail: DetailState) => void;
}) {
  const [initialSelection] = useState(readCostOverviewSelection);
  const [costType, setCostType] = useState<CostType>(initialSelection.costType);
  const [range, setRange] = useState<OperatingRange>(initialSelection.range);
  const [month, setMonth] = useState(initialSelection.month);
  const [from, setFrom] = useState(initialSelection.from);
  const [to, setTo] = useState(initialSelection.to);
  const [model, setModel] = useState<ModelFilter>(initialSelection.model);
  const [taskStatus, setTaskStatus] = useState<TaskStatusFilter>('all');
  const [costState, setCostState] = useState<CostStateFilter>('all');
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const requestedGlobalKeyRef = useRef<string | null>(null);
  const requestedTaskKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const taskSectionRef = useRef<HTMLElement | null>(null);
  const today = beijingToday();
  const currentMonth = today.slice(0, 7);

  const globalFilters = useMemo<AdminApiCostFilters>(() => ({
    range,
    ...(range === 'month' ? { month } : { from, to }),
    model: costType === 'video' && model !== 'all' ? model : undefined,
  }), [costType, from, model, month, range, to]);
  const taskFilters = useMemo<AdminApiCostFilters>(() => ({
    ...globalFilters,
    status: taskStatus === 'all' ? undefined : taskStatus,
    costState: costState === 'all' ? undefined : costState,
    search: search.trim() || undefined,
  }), [costState, globalFilters, search, taskStatus]);
  const globalKey = useMemo(() => apiCostFilterKey(globalFilters, 'overview'), [globalFilters]);
  const userKey = useMemo(() => apiCostFilterKey(globalFilters, 'users'), [globalFilters]);
  const taskKey = useMemo(() => apiCostFilterKey(taskFilters, 'tasks'), [taskFilters]);
  // 只展示与当前筛选键完全一致的数据。同键刷新失败仍保留成功快照；周期、搜索或状态
  // 改变后若请求失败，则由对应 ResourceBoundary 显示错误，绝不把旧筛选数据冒充为当前结果。
  const currentOverview = loadState.overview.dataKey === globalKey ? overview : null;
  const usersAreCurrent = loadState.users.dataKey === userKey;
  const tasksAreCurrent = loadState.tasks.dataKey === taskKey;
  const tableResetKey = `${currentOverview?.asOf ?? 'pending'}:${taskKey}`;
  const updating = Object.values(loadState).some(state => state.phase === 'loading' || state.phase === 'refreshing');

  useEffect(() => onCancel, [onCancel]);

  useEffect(() => {
    writeCostOverviewSelection({ costType, range, month, from, to, model });
  }, [costType, from, model, month, range, to]);

  useEffect(() => {
    const restore = () => {
      const next = readCostOverviewSelection();
      setCostType(next.costType);
      setRange(next.range);
      setMonth(next.month);
      setFrom(next.from);
      setTo(next.to);
      setModel(next.model);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    if (costType !== 'video') {
      onCancel();
      return;
    }
    requestedGlobalKeyRef.current = globalKey;
    requestedTaskKeyRef.current = taskKey;
    const timeout = window.setTimeout(() => {
      void onOverviewLoad(globalFilters, taskFilters).catch(() => undefined);
    }, mountedRef.current ? 200 : 0);
    mountedRef.current = true;
    return () => window.clearTimeout(timeout);
  }, [costType, globalFilters, globalKey, onCancel, onOverviewLoad]);

  useEffect(() => {
    if (costType !== 'video') return;
    if (requestedGlobalKeyRef.current !== globalKey || requestedTaskKeyRef.current === taskKey) return;
    requestedTaskKeyRef.current = taskKey;
    const timeout = window.setTimeout(() => {
      void onTasksLoad(taskFilters).catch(() => undefined);
    }, search ? 300 : 0);
    return () => window.clearTimeout(timeout);
  }, [costType, globalKey, onTasksLoad, search, taskFilters, taskKey]);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await onSync(globalFilters);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '同步请求提交失败');
    } finally {
      setSyncing(false);
    }
  };

  const retryAll = () => void onOverviewLoad(globalFilters, taskFilters).catch(() => undefined);

  const restoreLastSuccessfulRange = () => {
    const key = loadState.overview.dataKey;
    if (!key) return;
    const params = new URLSearchParams(key);
    const restoredModel = params.get('model');
    const restoredMonth = params.get('month');
    const restoredFrom = params.get('from');
    const restoredTo = params.get('to');
    if (restoredMonth) {
      setRange('month');
      setMonth(restoredMonth);
    } else if (restoredFrom && restoredTo) {
      setRange('custom');
      setFrom(restoredFrom);
      setTo(restoredTo);
    }
    setModel(restoredModel && MODEL_OPTIONS.has(restoredModel as ModelFilter)
      ? restoredModel as ModelFilter
      : 'all');
  };

  const handlePageNavigate = async (kind: 'users' | 'tasks', position: PagePosition) => {
    try {
      await onPageNavigate(kind, position);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '成本明细翻页失败');
    }
  };

  const openAudit = () => onNavigate(`/admin/api-usage/audit${window.location.search}`);
  const openOfficialBills = () => onNavigate(buildOfficialBillsEntryPath());
  const showUnfinalizedTasks = () => {
    setCostState('unfinalized');
    window.requestAnimationFrame(() => taskSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <PageShell
      width="cost"
      eyebrow="COST OPERATIONS"
      title="成本看盘"
      subtitle={costType === 'video'
        ? '按用户和任务查看最终实扣积分、供应商官网按量价估算成本与火山方舟当前余额；估算值不等同于实际应付'
        : costType === 'image'
          ? '查看 Seedream 图片任务、最终积分、真实输出像素、请求证据与官网列表价估算'
          : '查看 Doubao Seed 2.0 Lite 提示词向导的 Token 用量、最终实扣积分与官网列表价成本'}
      action={(
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={<ArrowRight className="h-4 w-4" />} onClick={openOfficialBills}>官方账单</Button>
          {costType === 'video' && (
            <>
              <Button variant="secondary" size="sm" icon={<ArrowRight className="h-4 w-4" />} onClick={openAudit}>高级对账</Button>
              <Button variant="secondary" size="sm" loading={syncing} icon={<RefreshCw className="h-4 w-4" />} onClick={() => void handleSync()}>同步费用中心</Button>
            </>
          )}
        </div>
      )}
    >
      <Card className="p-3">
        <FilterChips<CostType>
          value={costType}
          onChange={setCostType}
          label="成本类型"
          options={[
            { value: 'video', label: '视频生成' },
            { value: 'image', label: '图片生成' },
            { value: 'multimodal', label: '多模态模型' },
          ]}
        />
      </Card>

      <Card className="p-4">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-white">看盘周期</h2>
              {costType === 'video' && updating && <Badge variant="purple" dot>正在更新</Badge>}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {costType === 'multimodal'
                ? '业务周期按 run / batch 发起时间，平台调用按实际发生时间归属'
                : '业务周期按任务发起时间，平台调用按实际发生时间归属'}，日期均按北京时间计算。
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <FilterChips<OperatingRange> value={range} onChange={setRange} label="周期" options={[
              { value: 'month', label: '月份' },
              { value: 'custom', label: '自选周期' },
            ]} />
            {range === 'month' ? (
              <DatePicker mode="month" size="filter" label="月份" value={month} max={currentMonth} onValueChange={value => setMonth(validMonth(value, currentMonth) ? value : currentMonth)} />
            ) : (
              <>
                <DatePicker mode="date" size="filter" label="开始日期" value={from} max={to} onValueChange={value => setFrom(validDate(value, to) ? value : to)} />
                <DatePicker mode="date" size="filter" label="结束日期" value={to} max={today} onValueChange={value => setTo(validDate(value, today) && value >= from ? value : from)} />
              </>
            )}
            {costType === 'video' && (
              <SelectFilter value={model} onChange={setModel} label="模型" options={[
                { value: 'all', label: '全部模型' },
                { value: 'Seedance 2.5', label: '2.5' },
                { value: 'Seedance 2.0', label: '2.0' },
                { value: 'Seedance 2.0 Fast', label: 'Fast' },
                { value: 'Seedance 2.0 Mini', label: 'Mini' },
              ]} />
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-400">
          <span>当前范围：{costType === 'video' && currentOverview ? currentOverview.selection.rangeStart : selectedRange(globalFilters, today).start} 至 {costType === 'video' && currentOverview ? currentOverview.selection.rangeEnd : selectedRange(globalFilters, today).end}</span>
          {costType === 'video' && <span>数据截点：{currentOverview ? formatBeijingDateTime(currentOverview.asOf) : '等待当前周期数据'}</span>}
        </div>
      </Card>

      {costType === 'multimodal' ? (
        <AdminMultimodalCostView
          filters={{ range, ...(range === 'month' ? { month } : { from, to }) }}
          setDetail={setDetail}
        />
      ) : costType === 'image' ? (
        <AdminImageCostView
          filters={{ range, ...(range === 'month' ? { month } : { from, to }) }}
          setDetail={setDetail}
        />
      ) : (
        <>
      {!currentOverview ? (
        <ResourceBoundary
          state={loadState.overview}
          label="成本汇总"
          onRetry={retryAll}
          onRestore={loadState.overview.dataKey ? restoreLastSuccessfulRange : undefined}
        />
      ) : (
        <>
          {loadState.overview.phase === 'error' && (
            <StaleDataNotice label="成本汇总" state={loadState.overview} onRetry={() => void onOverviewRefresh(globalFilters).catch(() => undefined)} />
          )}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={WalletCards}
              label="当前可用人民币余额"
              value={cny(currentOverview.account.availableBalanceCny)}
              helper={`现金 ${cny(currentOverview.account.cashBalanceCny)} · 冻结 ${cny(currentOverview.account.frozenAmountCny)} · 同步 ${formatBeijingDateTime(currentOverview.account.syncedAt)} · 当前快照不随周期变化`}
              tone="purple"
            />
            <MetricCard
              icon={Coins}
              label="本期最终实扣积分"
              value={`${number(currentOverview.operations.settledCredits)} 积分`}
              helper={`待结算预扣 ${number(currentOverview.operations.heldCredits)} · 已退 ${number(currentOverview.operations.refundedCredits)}`}
              tone="blue"
            />
            <MetricCard
              icon={CircleDollarSign}
              label="本期供应商估算成本"
              value={costValue(currentOverview.operations.estimatedCostCny, currentOverview.operations.estimateCompleteness)}
              helper={`${number(currentOverview.operations.taskCount)} 个业务任务 / ${cny(currentOverview.operations.businessEstimatedCostCny)} · 平台调用 ${number(currentOverview.operations.operationalCallCount)} 次 / ${cny(currentOverview.operations.operationalEstimatedCostCny)} · 本地账户已知 ${cny(currentOverview.operations.knownAccountCostCny)}`}
              tone="orange"
            />
            <MetricCard
              icon={CalendarDays}
              label="官方对账"
              value={reconciliationLabel(
                currentOverview.operations.reconciliationStatus,
                currentOverview.operations.incompleteTaskCount,
                currentOverview.operations.differenceCny,
                currentOverview.operations.pendingFinalBillTaskCount,
                currentOverview.operations.approvedZeroCostTaskCount,
              )}
              helper={reconciliationHelper(currentOverview.operations)}
              action={currentOverview.operations.incompleteTaskCount > 0 ? (
                <Button variant="secondary" size="sm" onClick={showUnfinalizedTasks}>查看待补项</Button>
              ) : undefined}
              tone={reconciliationTone(currentOverview.operations.reconciliationStatus)}
            />
          </div>
        </>
      )}

      <section className="space-y-3">
        <SectionTitle title="模型成本汇总" description="同一周期内汇总最终实扣积分、供应商估算成本、价格版本与本地成本完整性；官方账单只做账户级对账，不按模型伪分摊。" />
        {currentOverview && currentOverview.models.length > 0 ? (
          <AdminDataTable
            items={currentOverview.models}
            paginationLabel="视频模型成本汇总分页导航"
            pageSize={6}
            gridTemplate="1.1fr .55fr .65fr .7fr 1.35fr 1.15fr .9fr 1fr .8fr"
            columns={[
              { header: '模型', render: row => row.model },
              { header: '业务任务', render: row => number(row.taskCount) },
              { header: '平台调用', render: row => number(row.operationalCallCount) },
              { header: '实扣积分', render: row => number(row.settledCredits) },
              { header: '供应商估算成本', render: row => (
                <Stack
                  title={costValue(row.knownAccountCostCny, row.estimateCompleteness)}
                  subtitle={`业务 ${cny(row.businessEstimatedCostCny)} · 平台 ${cny(row.operationalEstimatedCostCny)}`}
                />
              ) },
              {
                header: '价格版本',
                render: row => (
                  <PriceVersionsCell
                    versions={row.priceVersions}
                    taskCount={row.taskCount}
                    operationalCallCount={row.operationalCallCount}
                  />
                ),
              },
              { header: '成本完整性', render: row => (
                <ModelEstimateCompletenessCell
                  taskCount={row.taskCount}
                  operationalCallCount={row.operationalCallCount}
                  completeness={row.estimateCompleteness}
                />
              ) },
              { header: '账户级对账', render: row => (
                <ModelReconciliationCell
                  incompleteTaskCount={row.incompleteTaskCount}
                  operationalUnpricedCallCount={row.operationalUnpricedCallCount}
                />
              ) },
              { header: '单任务均值', render: row => row.averageTaskCostCny === null ? '—' : cny(row.averageTaskCostCny) },
            ]}
          />
        ) : currentOverview ? (
          <SuccessfulEmptyState label="所选周期暂无模型成本" />
        ) : (
          <ResourceBoundary state={loadState.overview} label="模型成本汇总" onRetry={retryAll} />
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle title="用户成本汇总" description="业务任务与平台测试调用分别计数；列表价成本均归成本承担账号，平台调用不会伪造任务或积分。" />
        {usersAreCurrent ? (
          <>
            {loadState.users.phase === 'error' && <StaleDataNotice label="用户成本汇总" state={loadState.users} onRetry={retryAll} />}
            {users.length > 0 ? (
              <>
                <AdminDataTable
                  items={users}
                  paginationLabel="视频用户成本汇总分页导航"
                  pageSize={8}
                  resetKey={`${overview?.asOf ?? 'pending'}:users:${userKey}`}
                  serverPagination={pagination.users}
                  serverLoading={pagination.users.loading || loadState.users.phase === 'loading' || loadState.users.phase === 'refreshing'}
                  onServerNavigate={position => void handlePageNavigate('users', position)}
                  gridTemplate="1.3fr .65fr .7fr .85fr 1.25fr 1fr"
                  columns={[
                    { header: '用户', render: row => <Stack title={row.name} subtitle={row.email} /> },
                    { header: '业务任务', render: row => number(row.taskCount) },
                    { header: '平台调用', render: row => number(row.operationalCallCount) },
                    { header: '实扣积分', render: row => number(row.settledCredits) },
                    { header: '供应商估算成本', render: row => (
                      <Stack
                        title={costValue(row.knownAccountCostCny, row.estimateCompleteness)}
                        subtitle={`业务 ${cny(row.businessEstimatedCostCny)} · 平台 ${cny(row.operationalEstimatedCostCny)}`}
                      />
                    ) },
                    { header: '最后活动', render: row => formatBeijingDateTime(row.lastActivityAt) },
                  ]}
                  onRowClick={row => setSearch(row.email)}
                />
              </>
            ) : <SuccessfulEmptyState label="所选周期暂无用户成本" />}
          </>
        ) : (
          <ResourceBoundary state={loadState.users} label="用户成本汇总" onRetry={retryAll} />
        )}
      </section>

      <Card className="p-4">
        <SearchFilter search={search} onSearch={setSearch} placeholder="搜索用户、邮箱或任务 ID...">
          <SelectFilter value={taskStatus} onChange={setTaskStatus} label="任务状态" options={[
            { value: 'all', label: '全部' },
            { value: 'queued', label: '排队中' },
            { value: 'processing', label: '生成中' },
            { value: 'completed', label: '成功' },
            { value: 'failed', label: '失败' },
            { value: 'canceled', label: '取消' },
          ]} />
          <SelectFilter value={costState} onChange={setCostState} label="成本状态" options={[
            { value: 'all', label: '全部' },
            { value: 'unfinalized', label: '全部待补项' },
            { value: 'unresolved', label: '待建案' },
            { value: 'pending-final-bill', label: '待终账' },
            { value: 'approved-zero', label: '已确认零成本' },
            { value: 'recorded', label: '用量已记录' },
          ]} />
        </SearchFilter>
        <p className="mt-3 text-xs text-gray-500">任务筛选只影响下方任务表，不改变账户级官方对账。</p>
      </Card>

      <section ref={taskSectionRef} className="scroll-mt-4 space-y-3">
        <SectionTitle title="任务成本明细" description="每个前端任务只显示一行，供应商重试的估算成本和去重价格版本已合并；估算值不等同于实际应付。" />
        {tasksAreCurrent ? (
          <>
            {loadState.tasks.phase === 'error' && (
              <StaleDataNotice label="任务成本明细" state={loadState.tasks} onRetry={() => void onTasksLoad(taskFilters).catch(() => undefined)} />
            )}
            {tasks.length > 0 ? (
              <>
                <AdminDataTable
                  items={tasks}
                  paginationLabel="视频任务成本明细分页导航"
                  pageSize={10}
                  resetKey={`${tableResetKey}:tasks`}
                  serverPagination={pagination.tasks}
                  serverLoading={pagination.tasks.loading || loadState.tasks.phase === 'loading' || loadState.tasks.phase === 'refreshing'}
                  onServerNavigate={position => void handlePageNavigate('tasks', position)}
                  gridTemplate="1.1fr 1.2fr 1fr .7fr .9fr 1fr .8fr"
                  columns={[
                    { header: '生成时间', render: row => formatBeijingDateTime(row.createdAt) },
                    { header: '用户', render: row => <Stack title={row.userName} subtitle={row.email} /> },
                    { header: '模型', render: row => row.model },
                    { header: '状态', render: row => statusBadge(row.status) },
                    { header: '实扣积分', render: row => creditValue(row) },
                    { header: '供应商估算成本', render: row => <TaskCostCell task={row} /> },
                    { header: '任务', render: row => shortId(row.taskId) },
                  ]}
                  onRowClick={row => setDetail({
                    title: row.taskId,
                    subtitle: '任务积分与供应商估算成本',
                    content: <TaskCostDetail task={row} />,
                    wide: true,
                  })}
                />
              </>
            ) : <SuccessfulEmptyState label="所选周期暂无任务" />}
          </>
        ) : (
          <ResourceBoundary
            state={loadState.tasks}
            label="任务成本明细"
            onRetry={() => void onTasksLoad(taskFilters).catch(() => undefined)}
          />
        )}
      </section>
        </>
      )}
    </PageShell>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-sm font-semibold text-white">{title}</h2><p className="mt-1 text-xs text-gray-500">{description}</p></div>;
}

function ResourceBoundary({ state, label, onRetry, onRestore }: {
  state: AdminApiCostResourceState;
  label: string;
  onRetry: () => void;
  onRestore?: () => void;
}) {
  if (state.phase !== 'error') {
    return <LoadingState label={`正在加载${label}`} />;
  }
  return (
    <Card className="border-orange-500/25 bg-orange-500/[0.06] p-5" role="alert">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-300" />
          <div>
            <p className="text-sm font-semibold text-white">{label}加载失败</p>
            <p className="mt-1 text-xs text-gray-400">{state.error ?? '请求失败，请稍后重试'}。未将失败结果显示为 0。</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-wrap gap-2">
          {onRestore && <Button variant="secondary" size="sm" onClick={onRestore}>恢复上次成功周期</Button>}
          <Button variant="secondary" size="sm" onClick={onRetry}>重新加载</Button>
        </div>
      </div>
    </Card>
  );
}

function StaleDataNotice({ state, label, onRetry }: {
  state: AdminApiCostResourceState;
  label: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl border border-orange-500/25 bg-orange-500/[0.06] px-4 py-3 text-xs sm:flex-row sm:items-center" role="status">
      <div>
        <p className="font-medium text-orange-100">{label}加载失败</p>
        <p className="mt-1 text-orange-100">
          更新失败，仍显示上次数据{state.updatedAt ? `（上次成功加载 ${formatBeijingDateTime(state.updatedAt)}）` : ''}。
          {state.error ? ` ${state.error}` : ''}
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={onRetry}>重试更新</Button>
    </div>
  );
}

function SuccessfulEmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-10 text-center text-sm text-gray-500" role="status">
      {label}
    </div>
  );
}

function TaskCostDetail({ task }: { task: AdminApiCostTask }) {
  const rows: Array<[string, ReactNode]> = [
    ['生成时间', formatBeijingDateTime(task.createdAt)],
    ['完成时间', formatBeijingDateTime(task.completedAt)],
    ['用户', `${task.userName} · ${task.email}`],
    ['模型', task.model],
    ['任务状态', statusBadge(task.status)],
    ['最终实扣积分', creditValue(task)],
    ['供应商估算成本', <TaskCostCell task={task} />],
    ['价格版本', priceVersionsLabel(task.priceVersions)],
    ['成本完整性', (
      <Stack
        title={estimateCompletenessBadge(task.estimateCompleteness)}
        subtitle={taskCompletenessDetail(task)}
      />
    )],
    ['成本确认 / 对账案件', (
      <Stack
        title={costResolutionStatusBadge(task.costResolutionStatus)}
        subtitle={task.costResolutionCaseId
          ? `案件 ${task.costResolutionCaseId}；不代表供应商逐任务回执`
          : '无案件；官方账单没有内部任务 ID，不进行官方逐任务匹配'}
      />
    )],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs text-gray-500">{label}</p>
          <div className="mt-2 text-sm text-white">{value}</div>
        </div>
      ))}
    </div>
  );
}

export function creditValue(task: Pick<AdminApiCostTask, 'creditStatus' | 'settledCredits' | 'reservedCredits' | 'refundedCredits'>) {
  if (task.creditStatus === 'held') return `待结算（预扣 ${number(task.reservedCredits)}）`;
  if (task.creditStatus === 'refunded' || task.creditStatus === 'reversed') {
    return `0（已退 ${number(task.refundedCredits)}）`;
  }
  return number(task.settledCredits);
}

export function costValue(value: string | null, completeness: EstimateCompleteness) {
  if (value === null || completeness === 'unavailable') return '待核对';
  return completeness === 'partial' ? `${cny(value)}+` : cny(value);
}

export function taskCostLabel(task: Pick<AdminApiCostTask, 'costResolutionStatus' | 'estimatedCostCny' | 'estimateCompleteness'>) {
  if (task.costResolutionStatus === 'pending-final-bill') return '待终账确认';
  if (task.costResolutionStatus === 'approved-zero') return `${cny(task.estimatedCostCny)} · 审计确认零成本`;
  return costValue(task.estimatedCostCny, task.estimateCompleteness);
}

function TaskCostCell({ task }: { task: AdminApiCostTask }) {
  if (task.costResolutionStatus === 'pending-final-bill') {
    return (
      <Stack
        title={<Badge variant="warning" dot>待终账确认</Badge>}
        subtitle="当前账单未发现额外费用"
      />
    );
  }
  if (task.costResolutionStatus === 'approved-zero') {
    return (
      <Stack
        title={cny(task.estimatedCostCny)}
        subtitle={<Badge variant="success">审计确认零成本</Badge>}
      />
    );
  }
  return costValue(task.estimatedCostCny, task.estimateCompleteness);
}

function costResolutionStatusBadge(status: AdminApiCostTask['costResolutionStatus']) {
  if (status === 'pending-final-bill') return <Badge variant="warning" dot>待终账确认</Badge>;
  if (status === 'approved-zero') return <Badge variant="success">审计确认零成本</Badge>;
  if (status === 'unresolved') return <Badge variant="error">待补用量</Badge>;
  return <Badge variant="default">用量已记录</Badge>;
}

function PriceVersionsCell({
  versions,
  taskCount,
  operationalCallCount,
}: {
  versions: string[];
  taskCount: number;
  operationalCallCount: number;
}) {
  if (versions.length === 0) return <span className="text-gray-500">—</span>;
  const sourceLabel = taskCount > 0 && operationalCallCount > 0
    ? '业务任务与平台调用固化'
    : operationalCallCount > 0
      ? '平台调用价格快照'
      : '任务 attempt 固化';
  return (
    <Stack
      title={versions.length === 1 ? versions[0] : `${versions.length} 个版本`}
      subtitle={versions.length === 1 ? sourceLabel : versions.join(' · ')}
    />
  );
}

function EstimateCompletenessCell({ completeness }: { completeness: EstimateCompleteness }) {
  return estimateCompletenessBadge(completeness);
}

function ModelEstimateCompletenessCell({
  taskCount,
  operationalCallCount,
  completeness,
}: {
  taskCount: number;
  operationalCallCount: number;
  completeness: EstimateCompleteness;
}) {
  if (taskCount === 0 && operationalCallCount === 0) {
    return <Badge variant="default">本期无任务/调用</Badge>;
  }
  return <EstimateCompletenessCell completeness={completeness} />;
}

function ModelReconciliationCell({
  incompleteTaskCount,
  operationalUnpricedCallCount,
}: {
  incompleteTaskCount: number;
  operationalUnpricedCallCount: number;
}) {
  const pendingCount = incompleteTaskCount + operationalUnpricedCallCount;
  return (
    <Stack
      title={pendingCount > 0
        ? <Badge variant="warning">存在 {number(pendingCount)} 项待补</Badge>
        : <Badge variant="default">账户级对账</Badge>}
      subtitle={operationalUnpricedCallCount > 0
        ? `${number(operationalUnpricedCallCount)} 次平台调用待计价`
        : '官方账单不按模型逐项分摊'}
    />
  );
}

function estimateCompletenessBadge(completeness: EstimateCompleteness) {
  if (completeness === 'complete') return <Badge variant="success">完整估值</Badge>;
  if (completeness === 'partial') return <Badge variant="warning">部分估值</Badge>;
  return <Badge variant="default">估值不可用</Badge>;
}

export function priceVersionsLabel(versions: string[]) {
  return versions.length > 0 ? versions.join('、') : '未命中价格版本';
}

export function taskCompletenessDetail(task: Pick<AdminApiCostTask, 'missingUsageAttempts' | 'unpricedAttempts'>) {
  const issues = [
    task.missingUsageAttempts > 0 ? `${number(task.missingUsageAttempts)} 次 attempt 缺少用量` : null,
    task.unpricedAttempts > 0 ? `${number(task.unpricedAttempts)} 次 attempt 未计价` : null,
  ].filter((item): item is string => item !== null);
  return issues.length > 0 ? issues.join(' · ') : '已知 attempt 均具备用量与有效价格证据';
}

export function reconciliationLabel(
  status: 'matched' | 'matched-adjusted' | 'incomplete' | 'difference' | 'unavailable',
  incompleteTasks: number,
  difference: string | null,
  pendingFinalBillTasks = 0,
  approvedZeroCostTasks = 0,
) {
  if (pendingFinalBillTasks > 0 && difference === '0.000000') {
    return `已知金额已对上，${number(pendingFinalBillTasks)} 项待最终账单确认`;
  }
  if (approvedZeroCostTasks > 0 && (status === 'matched' || status === 'matched-adjusted')) {
    return `已对上，${number(approvedZeroCostTasks)} 项审计确认零成本`;
  }
  if (status === 'matched') return '已对上';
  if (status === 'matched-adjusted') return '存在跨期计费，已归因';
  if (status === 'incomplete') {
    return difference === '0.000000'
      ? `已知金额已对上，${number(incompleteTasks)} 项待补`
      : `${number(incompleteTasks)} 项成本待补`;
  }
  if (status === 'difference') return '有未解释差额';
  return '待同步';
}

export function reconciliationHelper(operations: Pick<
  AdminApiCostOverviewSnapshot['operations'],
  | 'officialEquivalentCostCny'
  | 'differenceCny'
  | 'knownAccountCostCny'
  | 'unresolvedTaskCount'
  | 'pendingFinalBillTaskCount'
  | 'approvedZeroCostTaskCount'
>) {
  const amountSummary = `官方同价折算 ${cny(operations.officialEquivalentCostCny)} · 本地账户已知 ${cny(operations.knownAccountCostCny)} · 已知差额 ${signedCny(operations.differenceCny)} · 应付/已付/未付请查看官方账单`;
  const states = [
    operations.unresolvedTaskCount > 0 ? `${number(operations.unresolvedTaskCount)} 项待建案` : null,
    operations.pendingFinalBillTaskCount > 0 ? `${number(operations.pendingFinalBillTaskCount)} 项待终账` : null,
    operations.approvedZeroCostTaskCount > 0 ? `${number(operations.approvedZeroCostTaskCount)} 项已确认零成本` : null,
  ].filter((item): item is string => item !== null);
  return states.length > 0 ? `${amountSummary} · ${states.join(' · ')}` : amountSummary;
}

function reconciliationTone(status: 'matched' | 'matched-adjusted' | 'incomplete' | 'difference' | 'unavailable') {
  return ({
    matched: 'green',
    'matched-adjusted': 'blue',
    incomplete: 'orange',
    difference: 'orange',
    unavailable: 'purple',
  } as const)[status];
}

function cny(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '数据不可用';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `¥${parsed.toFixed(6)}` : '数据不可用';
}

function signedCny(value: string | null) {
  if (value === null) return '数据不可用';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '数据不可用';
  return `${parsed > 0 ? '+' : parsed < 0 ? '-' : ''}¥${Math.abs(parsed).toFixed(6)}`;
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

export interface CostOverviewSelection {
  costType: CostType;
  range: OperatingRange;
  month: string;
  from: string;
  to: string;
  model: ModelFilter;
}

export function readCostOverviewSelection(search = typeof window === 'undefined' ? '' : window.location.search): CostOverviewSelection {
  const params = new URLSearchParams(search);
  const today = beijingToday();
  const currentMonth = today.slice(0, 7);
  const modelValue = params.get('model') as ModelFilter | null;
  const model = modelValue && MODEL_OPTIONS.has(modelValue) ? modelValue : 'all';
  const requestedCostType = params.get('costType');
  const costType: CostType = requestedCostType === 'multimodal'
    ? 'multimodal'
    : requestedCostType === 'image' ? 'image' : 'video';
  const requestedRange = params.get('range');
  const legacyDate = params.get('date');
  const requestedFrom = params.get('from');
  const requestedTo = params.get('to');
  const hasCustom = (requestedRange === 'custom' || (!requestedRange && requestedFrom && requestedTo))
    && validDate(requestedFrom ?? '', today)
    && validDate(requestedTo ?? '', today)
    && requestedFrom! <= requestedTo!;
  const hasLegacyDate = requestedRange === 'date' && validDate(legacyDate ?? '', today);
  if (hasCustom || hasLegacyDate) {
    const from = hasLegacyDate ? legacyDate! : requestedFrom!;
    const to = hasLegacyDate ? legacyDate! : requestedTo!;
    return { costType, range: 'custom', month: currentMonth, from, to, model };
  }
  const requestedMonth = params.get('month') ?? currentMonth;
  return {
    costType,
    range: 'month',
    month: validMonth(requestedMonth, currentMonth) ? requestedMonth : currentMonth,
    from: `${currentMonth}-01`,
    to: today,
    model,
  };
}

export function buildCostOverviewQuery(selection: CostOverviewSelection) {
  const params = new URLSearchParams();
  params.set('costType', selection.costType);
  params.set('range', selection.range);
  if (selection.range === 'month') params.set('month', selection.month);
  else {
    params.set('from', selection.from);
    params.set('to', selection.to);
  }
  if (selection.costType === 'video' && selection.model !== 'all') params.set('model', selection.model);
  return params.toString();
}

export function buildOfficialBillsEntryPath(
  search = typeof window === 'undefined' ? '' : window.location.search,
) {
  const source = new URLSearchParams(search);
  const target = new URLSearchParams();
  for (const key of ['range', 'month', 'date', 'from', 'to', 'model']) {
    const value = source.get(key);
    if (value) target.set(key, value);
  }
  const costType = source.get('costType');
  if (costType === 'image') target.set('serviceType', 'image');
  else if (costType === 'multimodal') target.set('serviceType', 'multimodal');
  else if (costType === 'video') target.set('serviceType', 'video');
  const query = target.toString();
  return `/admin/api-usage/bills${query ? `?${query}` : ''}`;
}

function writeCostOverviewSelection(selection: CostOverviewSelection) {
  if (typeof window === 'undefined') return;
  const query = buildCostOverviewQuery(selection);
  const next = `${window.location.pathname}?${query}`;
  if (`${window.location.pathname}${window.location.search}` !== next) {
    window.history.replaceState({}, '', next);
  }
}

function beijingToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function selectedRange(filters: AdminApiCostFilters, today: string) {
  if (filters.range === 'custom' && filters.from && filters.to) {
    return { start: filters.from, end: filters.to };
  }
  const month = filters.month ?? today.slice(0, 7);
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate().toString().padStart(2, '0');
  const end = month === today.slice(0, 7) ? today : `${month}-${lastDay}`;
  return { start: `${month}-01`, end };
}

function validMonth(value: string, max: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value <= max;
}

function validDate(value: string, max: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || value > max) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
