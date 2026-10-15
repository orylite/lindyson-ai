import {
  CircleDollarSign,
  Coins,
  Image as ImageIcon,
  Images,
  RefreshCw,
  Ruler,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { isPaginationSnapshotChanged } from '../../api/client';
import * as queries from '../../api/queries';
import type { ExactCursorPagination, PagePosition } from '../../api/cursor';
import type {
  AdminImageCostOverview,
  AdminImageCostOverviewFilters,
  AdminImageCostTask,
  AdminImageCostTaskFilters,
  AdminImageCostTaskPage,
  AdminImageCostUserPage,
} from '../../data/admin';
import { Badge, Button, Card, LoadingState } from '../../ui';
import { formatBeijingDateTime } from '../../utils/beijingTime';
import {
  AdminDataTable,
  MetricCard,
  SearchFilter,
  SelectFilter,
  Stack,
  number,
  statusBadge,
} from '../components/AdminPageShared';
import type { DetailState } from '../types';
import { registerImageCostRefresh } from './imageCostRefresh';

type TaskStatusFilter = 'all' | AdminImageCostTask['status'];
type EvidenceFilter = 'all' | AdminImageCostTask['evidenceStatus'];
type ImageUserPageState = Omit<AdminImageCostUserPage, 'pagination'> & { pagination: ExactCursorPagination };
type ImageTaskPageState = Omit<AdminImageCostTaskPage, 'pagination'> & { pagination: ExactCursorPagination };

interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_RESOURCE = { data: null, loading: false, error: null };

export function AdminImageCostView({
  filters,
  setDetail,
}: {
  filters: AdminImageCostOverviewFilters;
  setDetail: (detail: DetailState) => void;
}) {
  const [status, setStatus] = useState<TaskStatusFilter>('all');
  const [evidence, setEvidence] = useState<EvidenceFilter>('all');
  const [search, setSearch] = useState('');
  const [overviewState, setOverviewState] = useState<ResourceState<AdminImageCostOverview>>(EMPTY_RESOURCE);
  const [usersState, setUsersState] = useState<ResourceState<ImageUserPageState>>(EMPTY_RESOURCE);
  const [tasksState, setTasksState] = useState<ResourceState<ImageTaskPageState>>(EMPTY_RESOURCE);
  const overviewControllerRef = useRef<AbortController | null>(null);
  const usersControllerRef = useRef<AbortController | null>(null);
  const tasksControllerRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);
  const snapshotNoticeShownRef = useRef(false);

  const baseFilters = useMemo<AdminImageCostOverviewFilters>(() => ({
    range: filters.range,
    month: filters.month,
    date: filters.date,
    from: filters.from,
    to: filters.to,
  }), [filters.date, filters.from, filters.month, filters.range, filters.to]);
  const baseKey = useMemo(() => imageFilterKey(baseFilters), [baseFilters]);
  const taskFilters = useMemo<AdminImageCostTaskFilters>(() => ({
    ...baseFilters,
    status: status === 'all' ? undefined : status,
    evidenceStatus: evidence === 'all' ? undefined : evidence,
    search: search.trim() || undefined,
  }), [baseFilters, evidence, search, status]);
  const taskKey = useMemo(() => imageFilterKey(taskFilters), [taskFilters]);
  const baseKeyRef = useRef(baseKey);
  const taskKeyRef = useRef(taskKey);
  baseKeyRef.current = baseKey;
  taskKeyRef.current = taskKey;

  const abortAll = useCallback(() => {
    sequenceRef.current += 1;
    overviewControllerRef.current?.abort();
    usersControllerRef.current?.abort();
    tasksControllerRef.current?.abort();
    overviewControllerRef.current = null;
    usersControllerRef.current = null;
    tasksControllerRef.current = null;
  }, []);

  const loadUsers = useCallback(async (
    overview: AdminImageCostOverview,
    sequence: number,
    position: PagePosition = 'first',
    cursor?: string,
    snapshotCursor?: string,
  ) => {
    usersControllerRef.current?.abort();
    const controller = new AbortController();
    usersControllerRef.current = controller;
    setUsersState(previous => ({ ...previous, loading: true, error: null }));
    try {
      const page = await queries.getAdminImageCostUsersPage({
        ...baseFilters,
        asOf: overview.asOf,
        position,
        ...(cursor ? { cursor } : {}),
        ...(snapshotCursor ? { snapshotCursor } : {}),
        limit: 20,
      }, controller.signal);
      assertPageConsistency(overview, page);
      if (sequence !== sequenceRef.current || usersControllerRef.current !== controller || baseKeyRef.current !== baseKey) return;
      setUsersState({ data: withPosition(page, position), loading: false, error: null });
      if (position === 'first') snapshotNoticeShownRef.current = false;
    } catch (error) {
      if (isAbortError(error) || usersControllerRef.current !== controller) return;
      setUsersState(previous => ({ ...previous, loading: false, error: errorMessage(error) }));
      throw error;
    } finally {
      if (usersControllerRef.current === controller) usersControllerRef.current = null;
    }
  }, [baseFilters, baseKey]);

  const loadTasks = useCallback(async (
    overview: AdminImageCostOverview,
    sequence: number,
    position: PagePosition = 'first',
    cursor?: string,
    snapshotCursor?: string,
  ) => {
    tasksControllerRef.current?.abort();
    const controller = new AbortController();
    tasksControllerRef.current = controller;
    setTasksState(previous => ({ ...previous, loading: true, error: null }));
    try {
      const page = await queries.getAdminImageCostTasksPage({
        ...taskFilters,
        asOf: overview.asOf,
        position,
        ...(cursor ? { cursor } : {}),
        ...(snapshotCursor ? { snapshotCursor } : {}),
        limit: 20,
      }, controller.signal);
      assertPageConsistency(overview, page);
      if (sequence !== sequenceRef.current || tasksControllerRef.current !== controller || taskKeyRef.current !== taskKey) return;
      setTasksState({ data: withPosition(page, position), loading: false, error: null });
      if (position === 'first') snapshotNoticeShownRef.current = false;
    } catch (error) {
      if (isAbortError(error) || tasksControllerRef.current !== controller) return;
      setTasksState(previous => ({ ...previous, loading: false, error: errorMessage(error) }));
      throw error;
    } finally {
      if (tasksControllerRef.current === controller) tasksControllerRef.current = null;
    }
  }, [taskFilters, taskKey]);

  const refreshOverview = useCallback(async () => {
    abortAll();
    const sequence = sequenceRef.current;
    const controller = new AbortController();
    overviewControllerRef.current = controller;
    setOverviewState({ data: null, loading: true, error: null });
    setUsersState({ data: null, loading: true, error: null });
    setTasksState({ data: null, loading: true, error: null });
    try {
      const overview = await queries.getAdminImageCostOverview(baseFilters, controller.signal);
      if (sequence !== sequenceRef.current || overviewControllerRef.current !== controller || baseKeyRef.current !== baseKey) return;
      setOverviewState({ data: overview, loading: false, error: null });
      await Promise.allSettled([
        loadUsers(overview, sequence),
        loadTasks(overview, sequence),
      ]);
    } catch (error) {
      if (isAbortError(error) || overviewControllerRef.current !== controller) return;
      const message = errorMessage(error);
      setOverviewState({ data: null, loading: false, error: message });
      setUsersState({ data: null, loading: false, error: message });
      setTasksState({ data: null, loading: false, error: message });
    } finally {
      if (overviewControllerRef.current === controller) overviewControllerRef.current = null;
    }
  }, [abortAll, baseFilters, baseKey, loadTasks, loadUsers]);
  const refreshOverviewRef = useRef(refreshOverview);
  refreshOverviewRef.current = refreshOverview;

  useEffect(() => registerImageCostRefresh(refreshOverview), [refreshOverview]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshOverviewRef.current(), 0);
    return () => {
      window.clearTimeout(timeout);
      abortAll();
    };
  }, [abortAll, baseKey]);

  const previousTaskKeyRef = useRef(taskKey);
  useEffect(() => {
    const changed = previousTaskKeyRef.current !== taskKey;
    previousTaskKeyRef.current = taskKey;
    if (!changed || !overviewState.data || overviewState.loading) return;
    const timeout = window.setTimeout(() => {
      void loadTasks(overviewState.data!, sequenceRef.current).catch(() => undefined);
    }, search ? 300 : 0);
    return () => window.clearTimeout(timeout);
  }, [loadTasks, overviewState.data, overviewState.loading, search, taskKey]);

  const navigateUsers = async (position: PagePosition) => {
    const overview = overviewState.data;
    const page = usersState.data;
    if (!overview || !page) return;
    const cursor = pageCursor(page.pagination, position);
    if ((position === 'previous' || position === 'next') && !cursor) return;
    try {
      await loadUsers(overview, sequenceRef.current, position, cursor ?? undefined, page.pagination.snapshotCursor);
    } catch (error) {
      if (isPaginationSnapshotChanged(error)) {
        if (!snapshotNoticeShownRef.current) {
          snapshotNoticeShownRef.current = true;
          toast.info('列表已更新，已返回第 1 页');
        }
        await refreshOverview();
        return;
      }
      toast.error(errorMessage(error));
    }
  };

  const navigateTasks = async (position: PagePosition) => {
    const overview = overviewState.data;
    const page = tasksState.data;
    if (!overview || !page) return;
    const cursor = pageCursor(page.pagination, position);
    if ((position === 'previous' || position === 'next') && !cursor) return;
    try {
      await loadTasks(overview, sequenceRef.current, position, cursor ?? undefined, page.pagination.snapshotCursor);
    } catch (error) {
      if (isPaginationSnapshotChanged(error)) {
        if (!snapshotNoticeShownRef.current) {
          snapshotNoticeShownRef.current = true;
          toast.info('列表已更新，已返回第 1 页');
        }
        await refreshOverview();
        return;
      }
      toast.error(errorMessage(error));
    }
  };

  const overview = overviewState.data;
  return (
    <>
      {!overview ? (
        <ResourceBoundary state={overviewState} label="图片成本汇总" onRetry={() => void refreshOverview()} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <MetricCard icon={ImageIcon} label="图片任务" value={number(overview.summary.taskCount)} helper={`${number(overview.summary.userCount)} 位用户 · 平台调用 ${number(overview.summary.operationalCallCount)} 次`} tone="purple" />
            <MetricCard icon={Coins} label="最终实扣积分" value={`${number(overview.summary.settledCredits)} 积分`} helper={`待结算 ${number(overview.summary.heldCredits)} · 已退 ${number(overview.summary.refundedCredits)}`} tone="green" />
            <MetricCard icon={CircleDollarSign} label="官网列表价成本" value={knownImageCostLabel(overview.summary.knownAccountCostCny, overview.summary.estimateCompleteness)} helper={`业务 ${cny(overview.summary.businessEstimatedCostCny)} · 平台 ${cny(overview.summary.operationalEstimatedCostCny)}`} tone="orange" />
            <MetricCard icon={Images} label="参考图片" value={`${number(overview.summary.referenceImageCount)} 张`} helper="首张免费，后续按张估算" tone="blue" />
            <MetricCard icon={Ruler} label="已观测输出像素" value={number(overview.summary.outputPixels)} helper="读取供应商真实输出宽高" tone="purple" />
            <MetricCard icon={Users} label="成本证据" value={`${number(overview.summary.knownCostTaskCount)} 项已知`} helper={`${number(overview.summary.missingEvidenceTaskCount)} 项缺证据`} tone={overview.summary.missingEvidenceTaskCount > 0 ? 'orange' : 'green'} />
          </div>
          <PricingNotice overview={overview} onRefresh={() => void refreshOverview()} refreshing={overviewState.loading} />
        </>
      )}

      <section className="space-y-3">
        <SectionTitle title="用户成本汇总" description="业务图片任务与平台测试调用分别计数；平台调用只归成本，不创建图片任务或积分。" />
        {usersState.data ? (
          <>
            {usersState.error && <StaleNotice label="用户成本汇总" error={usersState.error} />}
            {usersState.data.items.length > 0 ? (
              <AdminDataTable
                items={usersState.data.items}
                paginationLabel="图片用户成本汇总分页导航"
                pageSize={20}
                resetKey={`${usersState.data.asOf}:${baseKey}`}
                serverPagination={usersState.data.pagination}
                serverLoading={usersState.loading}
                onServerNavigate={position => void navigateUsers(position)}
                gridTemplate="1.35fr .6fr .65fr .8fr .75fr 1fr 1.3fr .95fr"
                columns={[
                  { header: '用户', render: row => <Stack title={row.userName} subtitle={row.email} /> },
                  { header: '业务任务', render: row => number(row.taskCount) },
                  { header: '平台调用', render: row => number(row.operationalCallCount) },
                  { header: '积分', render: row => <Stack title={number(row.settledCredits)} subtitle={row.refundedCredits > 0 ? `已退 ${number(row.refundedCredits)}` : undefined} /> },
                  { header: '参考图', render: row => `${number(row.referenceImageCount)} 张` },
                  { header: '输出像素', render: row => number(row.outputPixels) },
                  { header: '列表价成本', render: row => (
                    <Stack
                      title={knownImageCostLabel(row.knownAccountCostCny, row.estimateCompleteness)}
                      subtitle={`业务 ${cny(row.businessEstimatedCostCny)} · 平台 ${cny(row.operationalEstimatedCostCny)}`}
                    />
                  ) },
                  { header: '最后活动', render: row => formatBeijingDateTime(row.lastActivityAt) },
                ]}
                onRowClick={row => setSearch(row.email)}
              />
            ) : <EmptyState label="所选周期暂无图片用户成本" />}
          </>
        ) : <ResourceBoundary state={usersState} label="用户成本汇总" onRetry={() => overview && void loadUsers(overview, sequenceRef.current).catch(() => undefined)} />}
      </section>

      <Card className="p-4">
        <SearchFilter search={search} onSearch={setSearch} placeholder="搜索用户、邮箱、任务或供应商请求 ID...">
          <SelectFilter<TaskStatusFilter> value={status} onChange={setStatus} label="任务状态" options={[
            { value: 'all', label: '全部' },
            { value: 'queued', label: '排队中' },
            { value: 'processing', label: '生成中' },
            { value: 'completed', label: '已完成' },
            { value: 'failed', label: '失败' },
            { value: 'canceled', label: '已取消' },
          ]} />
          <SelectFilter<EvidenceFilter> value={evidence} onChange={setEvidence} label="价格证据" options={[
            { value: 'all', label: '全部' },
            { value: 'known', label: '已知' },
            { value: 'missing-evidence', label: '缺证据' },
          ]} />
        </SearchFilter>
        <p className="mt-3 text-xs text-gray-500">状态、证据和关键词只影响下方任务明细，不改变汇总与用户数据。</p>
      </Card>

      <section className="space-y-3">
        <SectionTitle title="图片任务成本明细" description="每个图片任务一行；价格来自生成时固化的逐 run 证据，缺失字段不会按当前价格回算。" />
        {tasksState.data ? (
          <>
            {tasksState.error && <StaleNotice label="图片任务成本明细" error={tasksState.error} />}
            {tasksState.data.items.length > 0 ? (
              <AdminDataTable
                items={tasksState.data.items}
                paginationLabel="图片任务成本明细分页导航"
                pageSize={20}
                resetKey={`${tasksState.data.asOf}:${taskKey}`}
                serverPagination={tasksState.data.pagination}
                serverLoading={tasksState.loading}
                onServerNavigate={position => void navigateTasks(position)}
                gridTemplate="1fr 1.3fr .7fr .9fr .8fr 1fr 1fr 1.2fr"
                columns={[
                  { header: '发起时间', render: row => formatBeijingDateTime(row.createdAt) },
                  { header: '用户', render: row => <Stack title={row.userName} subtitle={row.email} /> },
                  { header: '状态', render: row => statusBadge(row.status) },
                  { header: '结算积分', render: row => creditLabel(row) },
                  { header: '参考图', render: row => nullableCount(row.referenceImageCount, '张') },
                  { header: '真实输出', render: row => outputLabel(row) },
                  { header: '列表价成本', render: row => imageTaskCostLabel(row) },
                  { header: '请求证据', render: row => requestEvidenceLabel(row) },
                ]}
                onRowClick={row => setDetail({
                  title: 'Seedream 图片成本证据',
                  subtitle: row.taskId,
                  content: <TaskEvidenceDetail task={row} />,
                  wide: true,
                })}
              />
            ) : <EmptyState label="当前筛选暂无图片任务" />}
          </>
        ) : <ResourceBoundary state={tasksState} label="图片任务成本明细" onRetry={() => overview && void loadTasks(overview, sequenceRef.current).catch(() => undefined)} />}
      </section>
    </>
  );
}

function PricingNotice({ overview, onRefresh, refreshing }: { overview: AdminImageCostOverview; onRefresh: () => void; refreshing: boolean }) {
  const pricing = overview.pricing;
  return (
    <Card className="p-4">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div>
          <p className="text-sm font-semibold text-white">Seedream 5.0 Pro 官网列表价估算</p>
          <p className="mt-1 text-xs leading-5 text-gray-400">
            首张参考图免费，后续每张 {cny(pricing.additionalReferenceUnitPriceCny)}；真实输出像素不超过 {number(pricing.outputPixelThreshold)} 时每张 {cny(pricing.smallOutputPriceCny)}，超过时每张 {cny(pricing.largeOutputPriceCny)}。
          </p>
          <p className="mt-1 text-xs text-orange-200">{pricing.disclaimer} 图片成本不进入 Seedance Token 定价或视频账单对账。</p>
          <a className="mt-2 inline-block text-xs font-medium text-purple-300 underline underline-offset-2" href={pricing.pricingSourceUrl} target="_blank" rel="noreferrer">火山方舟官方模型价格（{pricing.priceVersion}）</a>
        </div>
        <Button variant="secondary" size="sm" loading={refreshing} icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh}>刷新图片成本</Button>
      </div>
    </Card>
  );
}

function TaskEvidenceDetail({ task }: { task: AdminImageCostTask }) {
  const rows: Array<[string, ReactNode]> = [
    ['任务', task.taskId],
    ['用户', `${task.userName} · ${task.email}`],
    ['模型', task.model],
    ['任务状态', statusBadge(task.status)],
    ['积分结算', creditLabel(task)],
    ['Provider 尝试', `${number(task.attemptCount)} 次（已知 ${number(task.knownUsageCount)} / 缺证据 ${number(task.missingUsageCount)}）`],
    ['参考图片', nullableCount(task.referenceImageCount, '张')],
    ['其中额外参考图', nullableCount(task.additionalReferenceImageCount, '张')],
    ['真实输出尺寸', outputLabel(task)],
    ['参考图列表价', nullableCny(task.referencePriceCny)],
    ['输出列表价', nullableCny(task.outputPriceCny)],
    ['已知成本小计', imageTaskCostLabel(task)],
    ['价格版本', task.priceVersion ?? '证据缺失'],
    ['本地 Provider operation', task.providerOperationId ?? '缺失'],
    ['外部 x-tt-logid', task.providerRequestId ?? '未取得'],
    ['请求证据状态', requestEvidenceLabel(task)],
    ['生成图片数', nullableCount(task.generatedImages, '张')],
    ['发起时间', formatBeijingDateTime(task.createdAt)],
    ['完成时间', task.completedAt ? formatBeijingDateTime(task.completedAt) : '尚未完成'],
    ...(task.error ? [['供应商错误', task.error] as [string, ReactNode]] : []),
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs text-gray-500">{label}</p>
          <div className="mt-2 break-words text-sm text-white">{value}</div>
        </div>
      ))}
    </div>
  );
}

export function knownImageCostLabel(value: string | null, completeness: AdminImageCostOverview['summary']['estimateCompleteness']) {
  if (value === null || completeness === 'unavailable') return '未知 / 缺证据';
  return completeness === 'partial' ? `${cny(value)} 已知小计 + 缺证据` : cny(value);
}

export function imageTaskCostLabel(task: Pick<AdminImageCostTask, 'estimatedCostCny' | 'evidenceStatus'>) {
  if (task.estimatedCostCny === null) return '未知 / 缺证据';
  return task.evidenceStatus === 'missing-evidence'
    ? `${cny(task.estimatedCostCny)} 已知小计 + 缺证据`
    : cny(task.estimatedCostCny);
}

function requestEvidenceLabel(task: Pick<AdminImageCostTask, 'requestEvidenceStatus' | 'providerRequestId' | 'providerOperationId'>) {
  if (task.requestEvidenceStatus === 'provider-id' && task.providerRequestId) return <Stack title={task.providerRequestId} subtitle="外部 x-tt-logid" />;
  if (task.requestEvidenceStatus === 'local-only') return <Stack title={task.providerOperationId ?? '本地 operation'} subtitle="未取得外部请求 ID" />;
  return <Badge variant="warning">请求证据缺失</Badge>;
}

function creditLabel(task: Pick<AdminImageCostTask, 'creditStatus' | 'reservedCredits' | 'settledCredits' | 'refundedCredits'>) {
  if (task.creditStatus === 'settled') return `${number(task.settledCredits)} 积分实扣`;
  if (task.creditStatus === 'held') return `${number(task.reservedCredits)} 积分预扣`;
  if (task.refundedCredits > 0 || task.creditStatus === 'refunded' || task.creditStatus === 'reversed') return `${number(task.refundedCredits)} 积分已退`;
  return statusBadge(task.creditStatus);
}

function outputLabel(task: Pick<AdminImageCostTask, 'outputWidth' | 'outputHeight' | 'outputPixels'>) {
  if (task.outputWidth === null || task.outputHeight === null || task.outputPixels === null) return '未知 / 缺真实尺寸';
  return <Stack title={`${number(task.outputWidth)} × ${number(task.outputHeight)}`} subtitle={`${number(task.outputPixels)} 像素`} />;
}

function nullableCount(value: number | null, unit: string) {
  return value === null ? '未知 / 缺证据' : `${number(value)} ${unit}`;
}

function nullableCny(value: string | null) {
  return value === null ? '未知 / 缺证据' : cny(value);
}

function cny(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `¥${parsed.toFixed(6)}` : '未知 / 缺证据';
}

function withPosition<T extends AdminImageCostUserPage | AdminImageCostTaskPage>(page: T, position: PagePosition) {
  return { ...page, pagination: { ...page.pagination, position } };
}

function assertPageConsistency(
  overview: AdminImageCostOverview,
  page: Pick<AdminImageCostUserPage, 'asOf' | 'selection'>,
) {
  if (page.asOf !== overview.asOf
    || page.selection.rangeStart !== overview.selection.rangeStart
    || page.selection.rangeEnd !== overview.selection.rangeEnd) {
    throw new Error('图片成本明细未返回统一数据截点，请刷新后重试');
  }
}

function pageCursor(pagination: ExactCursorPagination, position: PagePosition) {
  if (position === 'previous') return pagination.previousCursor;
  if (position === 'next') return pagination.nextCursor;
  return null;
}

function imageFilterKey(filters: object) {
  return new URLSearchParams(Object.entries(filters).flatMap(([key, value]) => (
    typeof value === 'string' && value.length > 0 ? [[key, value]] : []
  ))).toString();
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-sm font-semibold text-white">{title}</h2><p className="mt-1 text-xs text-gray-500">{description}</p></div>;
}

function ResourceBoundary<T>({ state, label, onRetry }: { state: ResourceState<T>; label: string; onRetry: () => void }) {
  if (!state.error) return <LoadingState label={`正在加载${label}`} />;
  return (
    <Card className="border-orange-500/25 bg-orange-500/[0.06] p-5" role="alert">
      <p className="text-sm font-semibold text-white">{label}加载失败</p>
      <p className="mt-1 text-xs text-gray-400">{state.error}。缺失数据不会显示为 0 或 ¥0.00。</p>
      <Button className="mt-3" variant="secondary" size="sm" onClick={onRetry}>重新加载</Button>
    </Card>
  );
}

function StaleNotice({ label, error }: { label: string; error: string }) {
  return <div className="rounded-xl border border-orange-500/25 bg-orange-500/[0.06] px-4 py-3 text-xs text-orange-100" role="status">{label}更新失败，仍显示上次数据：{error}</div>;
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-10 text-center text-sm text-gray-500" role="status">{label}</div>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}
